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

  // ============================================================
  //  THE CELL IS A PLACE (CBZ.CONFIG.PRISON_CELL_BEAT)
  //
  //  OWNER: "player cell should be an actual cell." Every capture path in this
  //  file used to answer "back to your cell" by copying the player onto
  //  CBZ.SPAWN — a bare coordinate in the middle of the wing — and flashing the
  //  screen red. Nothing was closed behind you, so the CONFINEMENT beat below
  //  (which has always existed) was a stun timer and a hint line, not a room.
  //
  //  world/cellblock.js now publishes a real wing, and this file consumes it as
  //  a CONTRACT, never by reaching at its geometry:
  //      CBZ.cellblock.playerSpawn()      -> {x,z} inside YOUR cell
  //      CBZ.cellblock.playerCell         -> the cell record (or its index)
  //      CBZ.cellblock.cells[]            -> {i,x,z,doorX,doorZ,half,locked,owner}
  //      CBZ.cellblock.setDoor(i, locked) -> collider-safe door toggle
  //      CBZ.cellblock.assign(npc, i)     -> put an inmate on a bunk
  //  EVERY field is guarded on its own. With the flag off, or with no wing
  //  published at all, every path below falls back to exactly what shipped
  //  before: CBZ.SPAWN, a red flash and a stun timer.
  //
  //  DOOR OWNERSHIP. Only the door we ourselves closed is ever re-opened —
  //  same discipline as CBZ.jailBoost's speed ledger, for the same reason: a
  //  facility lockdown (systems/lockdown.js) locks doors too, and two owners
  //  fighting over one collider is how a player ends up sealed in forever.
  //  This file owns the PLAYER's cell; lockdown.js skips it and owns the rest.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_CELL_BEAT == null) CBZ.CONFIG.PRISON_CELL_BEAT = true;
  function beatOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_CELL_BEAT); }

  const BODY_R = 0.55;       // player capsule radius (systems/physics.js)
  const INTAKE_T = 8;        // intake hold when a city arrest lands you here
  let heldDoor = null;       // the ONE cell index this file has locked (or null)

  // the wing, or null. Never trust a half-published contract: the list must be
  // a real array before anything below indexes it.
  function wing() {
    const c = CBZ.cellblock;
    return (c && Array.isArray(c.cells)) ? c : null;
  }
  // cells may carry their own id; fall back to array position.
  function cellIndex(cell) {
    if (!cell) return -1;
    if (typeof cell.i === "number" && cell.i >= 0) return cell.i;
    const w = wing();
    if (!w) return -1;
    const k = w.cells.indexOf(cell);
    return k >= 0 ? k : -1;
  }
  // playerCell is documented as a record; a bare index costs one line to accept
  // and buys immunity to that being the shape that actually ships.
  function playerCell() {
    const c = CBZ.cellblock;
    if (!c) return null;
    const pc = c.playerCell;
    if (pc == null) return null;
    if (typeof pc === "number") {
      const w = wing();
      return (w && pc >= 0 && pc < w.cells.length) ? w.cells[pc] : null;
    }
    return (typeof pc === "object") ? pc : null;
  }
  // is (x,z) inside this cell's declared box, shrunk by `pad`? `pad = BODY_R`
  // is "fully inside, clear of the door plane"; `pad = 0` is "in your cell".
  function inCellBox(cell, x, z, pad) {
    if (!cell) return false;
    const cx = +cell.x, cz = +cell.z, h = +cell.half;
    if (!isFinite(cx) || !isFinite(cz) || !isFinite(h) || h <= 0) return false;
    const r = h - (pad || 0);
    if (r <= 0) return false;               // cell too small to stand clear in
    return Math.abs(x - cx) <= r && Math.abs(z - cz) <= r;
  }
  function doorSet(i, locked) {
    const c = CBZ.cellblock;
    if (!c || typeof c.setDoor !== "function" || !(i >= 0)) return false;
    try { c.setDoor(i, !!locked); return true; } catch (e) { return false; }
  }

  // THE ONE ANSWER to "is the player standing in his own cell". lockdown.js
  // reads it for the count-time grace; detection/guard code may adopt it as a
  // one-line gate. Degrade-safe: false whenever there is no wing.
  CBZ.playerInOwnCell = function () {
    if (!beatOn()) return false;
    return inCellBox(playerCell(), player.pos.x, player.pos.z, 0);
  };
  // the door is shut on the player right now (drives the confinement copy)
  CBZ.playerCellSealed = function () { return heldDoor != null; };

  // put the player IN the cell. Returns false when there is no wing to land in,
  // and every caller then does exactly what it did before.
  // NOTE: playerSpawn() answers {x,z} — no y — so this must never .copy() it.
  function landInCell() {
    if (!beatOn()) return false;
    const c = CBZ.cellblock;
    if (!c || typeof c.playerSpawn !== "function") return false;
    let p = null;
    try { p = c.playerSpawn(); } catch (e) { p = null; }
    if (!p || !isFinite(+p.x) || !isFinite(+p.z)) return false;
    player.pos.set(+p.x, isFinite(+p.y) ? +p.y : 0, +p.z);
    player.vy = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(player.pos);
    return true;
  }

  // shut the player's door — ONLY once he is standing fully clear of the door
  // plane. A door closed on a body straddling its collider is how you get
  // wedged in geometry, and skipping the lock costs nothing: the confinement
  // clock runs either way, and this is retried every frame while it does.
  function sealPlayerCell() {
    if (!beatOn() || heldDoor != null) return false;
    const cell = playerCell();
    if (!cell) return false;
    if (!inCellBox(cell, player.pos.x, player.pos.z, BODY_R)) return false;
    const i = cellIndex(cell);
    if (i < 0 || !doorSet(i, true)) return false;
    heldDoor = i;
    if (CBZ.sfx) try { CBZ.sfx("door"); } catch (e) {}
    return true;
  }
  // open only what we closed. Safe to call from anywhere, any number of times.
  function releasePlayerCell() {
    if (heldDoor == null) return false;
    doorSet(heldDoor, false);
    heldDoor = null;
    return true;
  }
  CBZ.releasePlayerCell = releasePlayerCell;

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
    // HAUL SITE 1 — land in the real cell when there is one, else the old spot
    if (!landInCell()) { player.pos.copy(CBZ.SPAWN); player.vy = 0; }
    player.stun = 0; player.subdue = 0;
    setCaptureState("normal", 0);
    CBZ.playerChar.group.rotation.z = 0;
    g.detection = 0; g.invuln = 1.6; g.caughtCount++;
    applyStrike();                               // sets confineT (or ends the run)
    if (confineT > 0) sealPlayerCell();          // the door shuts behind you
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

    // ---- AND IT COSTS YOU TIME. A strike used to be worth nothing at all
    // until the third one; now every capture lengthens the thing you are
    // actually in here spending. It is the same clock the release runs on, so
    // there is no second penalty ledger.
    if (pipeOn() && (+g.jailSentence || 0) > 0) {
      g.jailSentence = (+g.jailSentence || 0) + STRIKE_TIME;
      sentShown = -1;
      if (CBZ.flashHint) CBZ.flashHint("+" + STRIKE_TIME + "s on your sentence.", 2.2);
    }

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
      releasePlayerCell();        // a transferred man leaves no door of ours shut
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
    // A door we shut must never outlive the mode that shut it: the escape tick
    // below returns early outside "escape", so the release cannot live there.
    if (heldDoor != null && CBZ.game.mode !== "escape") { releasePlayerCell(); confineT = 0; confineShown = -1; }
    if (!sprayEl) return;
    if (sprayT > 0) { sprayT -= dt; sprayEl.style.opacity = Math.min(0.85, sprayT * 0.6).toFixed(2); }
    else if (sprayEl.style.opacity !== "0") sprayEl.style.opacity = "0";
  });
  // leaving play (title / won / lost) — the shared run-lifecycle dispatcher
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) {
    CBZ.jailBoost.onStateExit(function () { releasePlayerCell(); confineT = 0; confineShown = -1; });
  }

  // ============================================================
  //  THE SENTENCE (CBZ.CONFIG.PRISON_PIPE) — you are HERE FOR A REASON.
  //
  //  OWNER: "we have a whole jail minigame built that is for where you go when
  //  you are arrested… that minigame needs a lot of improving and pairing with
  //  the main game." The pen used to be a room with one exit: escape or be
  //  transferred. Nothing in it knew you had been sentenced, so serving time
  //  was not a thing you could do, and the only way back to the city was over
  //  the wall as a 3★ convict.
  //
  //  This is the whole pairing, and it is a CLOCK, not a system: an arrest
  //  stamps g.jailSentence (games/jail.js's ONE formula, handed over by
  //  systems/state.js's reset), it runs down while you are inside, and at zero
  //  a guard opens the gate — CBZ.cityJailRelease puts you back on the
  //  precinct step with your property, clean. A run that did NOT start with an
  //  arrest carries no sentence and is the pure escape game it always was.
  //
  //  It gives the three-strikes law teeth BEFORE strike three, too: every
  //  capture ADDS to the sentence, so getting caught costs you the thing you
  //  are actually spending in here — time.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_PIPE == null) CBZ.CONFIG.PRISON_PIPE = true;
  function pipeOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_PIPE); }
  const STRIKE_TIME = 45;          // seconds added to the stretch per capture
  let sentShown = -1, sentCallT = 0, sentCall = "";
  // THE DAY BEAT. No new rooms and no new geometry: the block simply CALLS the
  // rooms the prison already has, on a rotation, so being inside has a rhythm
  // and the yard/chow hall are somewhere you are meant to be rather than
  // scenery you happen to walk through.
  //
  //  `lock` is the phase's MECHANIC, not its prose. This table used to be read
  //  back with /LOCKDOWN/.test(b.s) — a regex over a display string driving a
  //  behaviour, which breaks the day the copy is reworded (and collided with
  //  the FACILITY lockdown, which is a different event entirely). The row says
  //  what it does; the copy is free to change.
  const DAY_BEAT = [
    { t: 55, s: "YARD CALL — the block empties into the yard." },
    { t: 40, s: "CHOW — the line's forming in the cafeteria." },
    { t: 35, s: "REC — the lounge is open." },
    { t: 30, s: "LOCKUP — back to your cell, count time.", lock: true },
  ];
  let beatI = 0, beatT = 0, beatLock = false;
  // the block musters to its cells (lockdown.js owns the routine; this is its
  // second consumer, and the reason it lives there rather than here).
  function muster(on) {
    if (!beatOn() || !CBZ.cellMuster) return;
    try { CBZ.cellMuster(!!on); } catch (e) {}
  }
  function sentenceTick(dt) {
    if (!pipeOn() || g.role === "cop") return;
    const left = +g.jailSentence || 0;
    if (left <= 0) return;
    if (player.dead) return;
    g.jailSentence = Math.max(0, left - dt);
    g.jailServed = (g.jailServed || 0) + dt;
    const s = Math.ceil(g.jailSentence);
    if (s !== sentShown) {
      sentShown = s;
      if (s === 60 || s === 30 || s === 10) CBZ.flashHint && CBZ.flashHint("Sentence: " + s + "s left.", 2.0);
    }
    // the mode's OWN readout — state.js already writes this line on reset, so
    // the sentence rides the surface the prison run already has.
    sentCallT -= dt;
    if (sentCallT <= 0) {
      sentCallT = 1;
      if (CBZ.setObjective) {
        CBZ.setObjective("Serving " + s + "s" + (sentCall ? " · " + sentCall : "") +
          " — or find a keycard, a vent or a tunnel and don't wait.");
      }
    }
    // the day beat rotates the block
    beatT -= dt;
    if (beatT <= 0) {
      const b = DAY_BEAT[beatI % DAY_BEAT.length];
      beatI++;
      beatT = b.t;
      sentCall = b.s.split(" —")[0];
      if (CBZ.flashHint) CBZ.flashHint(b.s, 2.4);
      // LOCKUP puts the screws on your block — the cell-watch sweep the
      // strike-2 rule already drives, reused rather than re-authored.
      g.cellWatch = b.lock ? true : !!(g.caughtCount >= 2);
      // ...and it is when the wing actually FILLS: the block walks to its
      // bunks and the doors rack shut for the count, released at the next call.
      beatLock = !!b.lock;
      muster(beatLock);
    }
    // Re-assert while the phase lasts. Leaving play hands the block back (the
    // shared onStateExit teardown), so a pause mid-count would otherwise drop
    // lockup until the next phase two minutes later. cellMuster(true) on an
    // already-running muster is a no-op, so this is self-healing and free.
    if (beatLock) muster(true);
    if (g.jailSentence <= 0) {
      g.jailSentence = 0;
      if (CBZ.flashToast) CBZ.flashToast("TIME SERVED — GATE'S OPEN");
      beatLock = false;
      releasePlayerCell(); muster(false);   // nothing of ours stays shut past the gate
      if (CBZ.cityJailRelease) { try { CBZ.cityJailRelease("served"); return; } catch (e) {} }
      if (CBZ.winGame) { try { CBZ.winGame("route"); } catch (e) {} }
    }
  }
  CBZ.jailSentenceLeft = function () { return Math.max(0, Math.ceil(+g.jailSentence || 0)); };

  // ---- SENT BACK: the intake beat ----------------------------------------
  // A run that STARTED with an arrest (city -> games/jail.js -> state.js's
  // reset stamps g.jailSentence) does not begin with you loose in the yard.
  // You arrive in your cell and the door is shut behind you for the count —
  // the same confinement machinery a strike uses, so there is no second timer,
  // no second hint surface and no second door owner. It is NOT a strike: the
  // sentence is the punishment, and caughtCount stays where it was.
  //
  // WHY THIS IS NOT HUNG OFF THE NEW-RUN WATCHER ALONE. pollStrikeRun() fires
  // when game.elapsed FALLS, and it is only polled inside the escape tick — so
  // on the first prison run of a session there is nothing for it to fall from
  // and it never fires. That is precisely the arrest the owner is describing.
  // The honest trigger is the SENTENCE ARRIVING: a positive stretch with
  // essentially none of it served can only mean you just got here.
  let lastServed = -1, intakeDone = false;
  function intakeWatch() {
    const served = +g.jailServed || 0;
    if (served + 0.25 < lastServed) intakeDone = false;      // a new stretch
    lastServed = served;
    if (intakeDone) return;
    if ((+g.jailSentence || 0) <= 0) return;                 // no sentence yet
    intakeDone = true;
    if (served > 1.5) return;                                // joined mid-stretch
    intake();
  }
  function intake() {
    if (!beatOn() || !pipeOn()) return;
    if (g.role === "cop" || player.dead) return;
    if ((+g.jailSentence || 0) <= 0) return;      // no arrest, no intake
    if (!landInCell()) return;                    // no wing published — old behavior
    confineT = INTAKE_T; confineShown = -1;
    g.invuln = Math.max(g.invuln || 0, INTAKE_T + 0.5);
    sealPlayerCell();
    beatT = INTAKE_T + 2;                         // first yard call AFTER the count
    if (CBZ.flashToast) CBZ.flashToast("BOOKED — YOUR CELL");
    if (CBZ.flashHint) {
      CBZ.flashHint("Intake. The door stays shut for the count — " +
        Math.ceil(+g.jailSentence) + "s to serve.", 3.0);
    }
    if (CBZ.sfx) try { CBZ.sfx("alarm"); } catch (e) {}
  }

  // per-frame bookkeeping
  CBZ.onUpdate(31, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // prison capture/arrest only in escape (survival + city own theirs)
    if (fireCD > 0) fireCD -= dt;
    // A served sentence RELEASES you mid-tick (mode -> city, world rebuilt).
    // Everything below this line is escape-mode plumbing and must not run
    // against a city that has just been built underneath it.
    sentenceTick(dt);
    if (CBZ.game.mode !== "escape") return;

    // new run? clear strike-beat leftovers before anything else ticks
    if (pollStrikeRun && pollStrikeRun()) {
      releasePlayerCell(); muster(false);
      confineT = 0; confineShown = -1; cellWatchCD = 0; sentShown = -1; beatI = 0; beatT = 0; sentCall = "";
      beatLock = false; intakeDone = false; lastServed = -1;
    }
    // ...and if you were SENT here, you wake in the cell with the door shut.
    intakeWatch();

    // ---- strike confinement: held in your cell for a beat after a capture ----
    if (confineT > 0 && !player.dead) {
      confineT -= dt;
      if (confineT > 0) {
        // retried every frame: a haul that landed you half in the doorway
        // refuses the lock on that frame and takes it the moment you're clear.
        sealPlayerCell();
        player.stun = Math.max(player.stun || 0, Math.min(confineT, 0.4));
        const s = Math.ceil(confineT);
        if (s !== confineShown) {
          confineShown = s;
          CBZ.showHint(heldDoor != null ? `Cell door locked — ${s}s` : `Confined to your cell — ${s}s`);
        }
      } else {
        confineT = 0; confineShown = -1;
        const wasShut = releasePlayerCell();
        CBZ.hideHint();
        CBZ.flashHint(wasShut ? "The door racks open. Yard time." : "The screws lose interest. Yard time.", 1.6);
      }
    }

    // ---- strike-2 cell-block watch: guards sweep past your cell more ----
    // reuses the ordinary investigate plumbing (guards.js) — no new movement
    // code, and any disturbance (hunt/social/ko) naturally takes priority.
    // The sweep now walks past the REAL cell. It used to orbit CBZ.SPAWN — the
    // coordinate the player happened to start on — which was only ever "your
    // cell" by accident of the old geometry. The cell record knows where it is;
    // the door mouth is where a screw actually stands to look in.
    if (g.cellWatch) {
      const watchCell = beatOn() ? playerCell() : null;
      const watchX = watchCell && isFinite(+watchCell.doorX) ? +watchCell.doorX
        : (watchCell && isFinite(+watchCell.x) ? +watchCell.x : (CBZ.SPAWN ? CBZ.SPAWN.x : null));
      const watchZ = watchCell && isFinite(+watchCell.doorZ) ? +watchCell.doorZ
        : (watchCell && isFinite(+watchCell.z) ? +watchCell.z : (CBZ.SPAWN ? CBZ.SPAWN.z : null));
      cellWatchCD -= dt;
      if (cellWatchCD <= 0 && watchX != null && watchZ != null) {
        cellWatchCD = 9 + Math.random() * 6;
        let best = null, bd = Infinity;
        for (const gd of CBZ.guards) {
          if (gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0 || gd.hunt > 0 || gd.approach || (gd.investigate && gd.investigate.t > 0)) continue;
          const dx = watchX - gd.group.position.x, dz = watchZ - gd.group.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = gd; }
        }
        if (best) {
          // a tighter scatter on a real door than on an open patch of floor
          const spread = watchCell ? 3.2 : 8;
          best.investigate = {
            x: watchX + (Math.random() - 0.5) * spread,
            z: watchZ + (Math.random() - 0.5) * spread,
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
      confineT = 0; confineShown = -1;
      releasePlayerCell();          // never leave a corpse sealed in
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
        // HAUL SITE 2 — the cuffed escort ends at the same real door
        if (!landInCell()) { player.pos.copy(CBZ.SPAWN); player.vy = 0; }
        g.detection = 0; g.invuln = 2.0; g.caughtCount++;
        applyStrike();                             // strike 3 ends the run here
        if (confineT > 0) sealPlayerCell();
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
