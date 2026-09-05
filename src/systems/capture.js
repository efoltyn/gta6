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

  // ============================================================
  //  SHOW DON'T TELL (CBZ.CONFIG.JAIL_SHOW_DONT_TELL) — declared in
  //  entities/ai.js, consumed here. OWNER: "the HUD is cluttered with 4th-wall
  //  breakers — summaries of events when the events should just HAPPEN."
  //
  //  This file was the worst offender in the prison because it had the classic
  //  shape: every capture beat already SHOWED itself — the screen flashes red,
  //  the camera shakes, the body goes prone, the cell door racks shut, tracers
  //  stitch past your head — and then a toast was printed BESIDE the thing that
  //  had just happened, telling you it had happened. "TASED — you hit the
  //  floor!" was printed on the same frame the player hit the floor.
  //
  //  Every one of those is deleted below. Nothing that carried real state is
  //  lost: the sentence still rides CBZ.setObjective (a bounded readout, not a
  //  popup), a death still rides city/killfeed.js, and the physical beats keep
  //  every shake, flash, stun and sound they always had. `tell()` is what the
  //  flag reverts through, so the popups come back in one line.
  //  Ratchet: CBZ.jailShowAudit() at the bottom of this file.
  // ============================================================
  function showing() { return CBZ.CONFIG.JAIL_SHOW_DONT_TELL !== false; }
  let toldToasts = 0, toldHints = 0;
  // Both return TRUE when the line was SUPPRESSED, so a caller that has a
  // diegetic replacement can do `if (tellHint(old)) { say it over his head }`
  // and still revert to the exact popup with the flag off.
  function tellToast(m) { if (showing()) { toldToasts++; return true; } if (CBZ.flashToast) CBZ.flashToast(m); return false; }
  function tellHint(m, s) { if (showing()) { toldHints++; return true; } if (CBZ.flashHint) CBZ.flashHint(m, s); return false; }
  // THE ONE GATE, shared with every other file in the prison's territory
  // (lockdown · killstreaks · detection · gunroom · games/jail). One-line
  // adoption, degrade-safe: a consumer that loads before this file falls
  // straight through to the popup it used to write.
  CBZ.jailTell = { toast: tellToast, hint: tellHint, on: showing };

  // A MAN IS RESTRAINED BEFORE HE IS MOVED. This used to be the "instant
  // version": string → teleport → strike on the same frame — and with the
  // tier ladder on, applyStrike() turns a strike straight into the
  // TRANSFERRED card, so a tower round or an empty stomach reclassified you
  // to a higher security level without a hand ever landing on you (USER:
  // "you can just get transferred without being physically restrained").
  // The city never does that — wanted.js's bust() runs hands → cuff → walk →
  // ride before book-in — so every haul now runs the pen's own restraint
  // beat: you are already down (every caller fires at hp<=0 or
  // dead-to-rights), the screws cuff you, fade to black, wake in the cell.
  // The strike/transfer fires at the blackout, cuffed, like every capture.
  // opts.strike:false = a medical drag (starvation), not a capture: no
  // strike, no transfer — the screws just put you back in your bunk.
  function haulToCell(msg, opts) {
    // the red flash IS the hit that dropped you; the cuffs follow it
    if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
    startEscort(msg || "BACK TO YOUR CELL", opts);
  }
  CBZ.haulToCell = haulToCell;

  // one CAUGHT = one strike. Called right after g.caughtCount++ from both
  // capture paths (instant tower haul + cuffed-escort blackout).
  function applyStrike() {
    if (!(CBZ.CONFIG && CBZ.CONFIG.JAIL_STRIKES)) return;
    if (g.mode !== "escape" || g.role === "cop") return;
    const campaign = !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
    /* THE LADDER MOVES ON EVERY CAPTURE (systems/prisontiers.js). OWNER:
       "each time you get caught escaping you go to the higher level" — so
       below ULTRA-MAX any capture ships you UP a security level, not just
       the third; the in-tier strike squeeze now belongs to the campaign and
       to the top of the ladder. At ULTRA-MAX there is nowhere left to send
       you, so the count is held at the final-warning rung and every further
       capture is what a segregation unit actually does with you — the door
       of your own cell. The regime IS the punishment there, which is the
       whole point of having built one. With the ladder OFF this file is the
       legacy three-strikes-then-loss it always was. */
    const T = CBZ.prisonTier;
    const tiered = !!(T && T.enabled());
    if (tiered && T.top()) g.caughtCount = Math.min(g.caughtCount || 0, 2);
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
      // no "+45s" popup: the number the popup announced is the number already
      // standing in the objective readout, and it visibly jumps.
      tellHint("+" + STRIKE_TIME + "s on your sentence.", 2.2);
    }

    /* Shakedown: the screws pocket half your cigs on every strike — EXCEPT
       the capture that is a transfer. A man cannot be robbed twice for one
       arrest, and the destination's reception search (systems/prisontiers.js
       packs it as you leave) is a strictly harder one: half into MEDIUM, a
       quarter into HIGH, nothing at all into segregation. Skipping the wing
       shakedown here is what keeps the tier table's own rule TRUE rather than
       silently a half of a half. */
    // BELT + BRACES on the city's law (wanted.js: hands → cuff → ride before
    // book-in): a TRANSFER is the end of an ARREST, so it requires the cuffs
    // to actually be on. Every live caller reaches here through the escort
    // blackout and IS cuffed; a future unrestrained caller degrades to the
    // in-tier strike below, never to the card.
    const restrained = !!(CBZ.playerChar && CBZ.playerChar.cuffed) || player.captureState === "cuffed";
    const transferring = tiered && !T.top() && !campaign && restrained;
    let taken = transferring ? 0 : Math.floor((g.cigs || 0) / 2);
    // CREW PALM A CUT. systems/prisonfriends.js: each of your men within
    // arm's reach of the shakedown quietly holds a slice (0.25/man, cap
    // 0.75) — and the nearest one tells you what he palmed a beat later.
    // Banking through people you earned is what a posse is FOR.
    if (taken > 0 && CBZ.posseShelterCut) taken = CBZ.posseShelterCut(taken);
    if (taken > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-taken);

    if (transferring || (!tiered && strike >= 3 && !campaign && restrained)) {
      // TRANSFERRED TO MAX SECURITY — the run is over. Clean up any capture
      // theatrics first so the lose screen isn't hidden under the fade.
      escortT = 0; escorted = false;
      if (fadeEl) fadeEl.style.opacity = "0";
      CBZ.playerChar.cuffed = false; player.subdue = 0; player.stun = 0;
      setCaptureState("normal", 0);
      CBZ.playerChar.group.rotation.z = 0;
      confineT = 0; confineShown = -1;
      releasePlayerCell();        // a transferred man leaves no door of ours shut
      // TRANSFERRED, and now it means it. The tier owns the whole beat from
      // here — it packs what survives a reception shakedown, moves you up the
      // ladder and shows the between-levels card through CBZ.loseGame, which
      // is the same result screen this line always ended on. It only declines
      // when the ladder is off, and then this is the flat loss it always was.
      if (tiered && T.transfer()) return;
      if (CBZ.loseGame) CBZ.loseGame("transferred");
      return;
    }

    if (strike >= 2) {
      // strike two (and every campaign strike after it): the block stays hot
      g.strikeHeatFloor = Math.max(g.strikeHeatFloor || 0, 12);
      g.detection = Math.max(g.detection, g.strikeHeatFloor);
      g.cellWatch = true;               // extra sweeps past your cell (below)
      confineT = 7;
      tellToast(campaign && strike >= 3 ? "STRIKE · THE WARDEN KEEPS YOU"
        : (tiered && T.top() ? "STRIKE · SEGREGATION" : "STRIKE 2 · FINAL WARNING"));
      tellHint(campaign && strike >= 3
        ? `The warden blocks your transfer${taken ? ` — but the screws take ${taken} cigs` : ""} and the block stays hot.`
        : (tiered && T.top()
          ? `${taken ? taken + " cigs confiscated. " : ""}Nowhere left to send you. The block stays hot.`
          : `${taken ? taken + " cigs confiscated. " : ""}One more capture = TRANSFER TO MAX SECURITY. Guards now sweep your block.`), 3.4);
    } else {
      confineT = 4;
      tellToast("STRIKE 1 · SHAKEDOWN");
      tellHint(`${taken ? taken + " cigs confiscated. " : ""}Two more strikes and you're shipped to max security.`, 3.2);
    }
    // THE SHAKEDOWN IS A THING THAT HAPPENS TO YOU, not a sentence about a
    // thing. Cigs already left your pocket above (the counter drops in front of
    // you); the strike now also lands ON the body — a shove into the cell and a
    // hard flash — so a capture reads as being handled rather than being told.
    if (showing()) {
      if (CBZ.shake) CBZ.shake(strike >= 2 ? 0.85 : 0.6);
      if (CBZ.sfx) { try { CBZ.sfx(taken > 0 ? "coin" : "punch"); } catch (e) {} }
      if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
    }
    // the confinement beat is safe time: guards can't re-grab you in the cell
    g.invuln = Math.max(g.invuln || 0, confineT + 0.5);
  }

  // ============================================================
  //  THE ONE WAY THE PLAYER IS HURT IN THIS MODE (CBZ.hurtPlayer).
  //
  //  OWNER: "don't say you're getting beat up — have an NPC punch the player
  //  and health go down." The pen had exactly one damage entry and it was
  //  called `shootPlayer`, so a FIST had nowhere to go: entities/ai.js's
  //  jump-you wrote `player.stun = 0.5` by hand and printed a sentence, because
  //  the only function that could take health off you was named after a bullet.
  //
  //  Same body, honest name, one added seam (`opts.melee` picks the sound and a
  //  softer sting). `CBZ.shootPlayer` stays exactly what it was — it is the
  //  gun-shaped call and towers/guards.js still make it — so nothing migrates
  //  and nothing can break. Anything that lands a HIT calls this.
  //  Hurt counter is exported through CBZ.jailShowAudit().playerHits, which is
  //  what proves the beating is real damage rather than another caption.
  // ============================================================
  let playerHits = 0;
  CBZ.hurtPlayer = function (dmg, fromX, fromZ, opts) {
    opts = opts || {};
    if (player.dead || (g.invuln || 0) > 0) return false;
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return false;
    playerHits++;
    player.hp = (player.hp == null ? 100 : player.hp) - (dmg || 30);
    // A FIST IS NOT A TASER. `player.stun` is the hard lock — no input at all
    // — and it is the right thing for a drive-stun or a tackle. A punch used
    // to write the same lock for 0.42-0.72 s, so three men hitting you on
    // their own clocks kept it armed forever ("they freeze you"). A melee hit
    // goes through the reaction in systems/combat.js instead: a short slow,
    // an impact beat you cannot swing through, and POISE so the next fist
    // inside the window still hurts but does not re-arm the reaction.
    if (opts.melee && CBZ.playerHitReact) CBZ.playerHitReact(opts.stun != null ? opts.stun : 0.42, opts);
    else player.stun = Math.max(player.stun || 0, opts.stun || 0.25);
    if (CBZ.addHeat) CBZ.addHeat(opts.heat != null ? opts.heat : 10);
    if (CBZ.shake) CBZ.shake(opts.shake || 0.6);
    if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
    // a fist is not a rifle round: it gets the punch report, and it ROCKS the
    // head rather than punching a hole. (systems/wounds.js is deliberately NOT
    // called: bodyWound wants an actor with a `.char` and a world impact point,
    // and the player here is a bare `pos` — a call that would silently return
    // on its first guard is a dead path, not a wound system.)
    CBZ.sfx && CBZ.sfx(opts.sfx || (opts.melee ? "punch" : "hit"));
    // The NECK is the rig's head joint (character.js's head layer damps it back
    // to level over ~9/s), so a shove here reads as the head snapping and
    // recovering without fighting the animator for ownership.
    if (opts.melee && CBZ.playerChar && CBZ.playerChar.neck) {
      CBZ.playerChar.neck.rotation.x += 0.34;
      CBZ.playerChar.neck.rotation.z += (Math.random() < 0.5 ? -1 : 1) * 0.22;
    }
    if (player.hp <= 0) {
      player.hp = 100;
      haulToCell(opts.haulMsg || (opts.melee ? "BEATEN DOWN" : "SHOT · DRAGGED TO YOUR CELL"));
      return true;
    }
    // NO "You're hit — get to cover!". The red flash IS the hit, and the health
    // bar you can see falling is the report.
    tellHint(opts.hint || "You're hit, get to cover!", 1.1);
    return false;
  };
  // An NPC (or a tower) lands a SHOT on the player. Unchanged contract; it is
  // now one word of configuration on the shared entry above.
  CBZ.shootPlayer = function (dmg, fromX, fromZ, opts) {
    return CBZ.hurtPlayer(dmg, fromX, fromZ, opts || {});
  };

  // cuffed-escort: hands behind back, fade to black, wake in cell. EVERY
  // capture path ends here now (haulToCell routes through it), so the cuffs
  // are always ON before applyStrike can ever say TRANSFERRED.
  let escortT = 0, escorted = false, escortStrike = true;
  function startEscort(msg, opts) {
    if (escortT > 0) return;
    escortStrike = !(opts && opts.strike === false);
    if (CBZ.killstreakBreak) CBZ.killstreakBreak(msg || "Cuffed");
    escortT = 1.9; escorted = false;
    CBZ.playerChar.cuffed = true; player.stun = 2.2;
    setCaptureState("cuffed", 1.9);
    tellToast(msg || "CUFFED · BACK TO YOUR CELL");
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd.capCD = 0; });
  }

  // orange pepper-spray sting overlay
  let sprayT = 0;
  const sprayEl = document.getElementById("spray");
  function spray(sec) { sprayT = sec; }

  // called from guards.js when a hunting guard is right on top of you.
  // less-lethal escalation: baton → taser → TACKLE → hauled off.
  //
  // THE TEXT WAS DOING THE WORK THE ANIMATION SHOULD HAVE DONE. "TASED — you
  // hit the floor!" was printed on the exact frame the body went prone and the
  // camera shook; the sentence added nothing except a fourth wall. All three
  // beats keep their physics and lose their captions, and the THIRD one — the
  // one that used to jump straight from a string to a fade-to-black — is now a
  // real grab: CBZ.predatorSeize's wind → strike → hold arc with its ONE
  // telegraphed break-free press, style "pin" (a screw kneeling on you; the
  // stillness is the beat), nonLethal because a guard inside the wire is
  // taking you IN. Break the hold and you are loose with a stun to run off;
  // lose it and the escort starts, exactly as before.
  //
  // Degrade: no predator.js, no seize — startEscort() fires directly and this
  // file behaves byte-for-byte the way it always did.
  let seizedBy = null;
  CBZ.tryCapture = function (gd, dt) {
    if (player.dead) return;
    if (g.role === "cop") return;
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return;
    if (gd._seizing) return;                       // this screw already has you
    gd.capCD = (gd.capCD || 0) - dt;
    if (gd.capCD > 0) return;
    gd.capCD = 1.6;
    player.subdue = (player.subdue || 0) + 1;
    if (player.subdue === 1) {
      player.stun = 1.85; setCaptureState("tased", 1.35);
      // The guard visibly draws the shared taser, launches its twin probes and
      // energizes the same body-pose signal used when the player fires one.
      // Capture still owns stun/state; taserfx owns only what that event looks like.
      if (CBZ.taserFx && CBZ.taserFx.actorTasePlayer) CBZ.taserFx.actorTasePlayer(gd);
      tellHint("TASED, you hit the floor!", 1.6);
      CBZ.sfx("tase"); CBZ.shake && CBZ.shake(0.55);
      if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
    } else if (player.subdue === 2) {
      player.stun = 2.05; setCaptureState("tackled", 1.55);
      tellHint("TACKLED, cuffs coming out!", 1.6);
      CBZ.sfx("punch"); CBZ.shake && CBZ.shake(0.7);
      spray(1.1);                                   // the OC goes in your eyes — an overlay, not a line
    } else if (showing() && CBZ.predatorSeize && !seizedBy) {
      const h = CBZ.predatorSeize(gd, player, {
        style: "pin", nonLethal: true, hold: 2.4, dps: 4, thrash: 0.55, escape: 0.5,
        cause: "restrained by a guard",
        // predator.js resolves a hold as "escaped" (you made the window),
        // "taken"/"killed" (it ran out — nonLethal maps killed→taken) or
        // "aborted" (the grab became invalid: the screw died, the distance blew
        // out, the mode changed). ONLY a completed hold cuffs you — an aborted
        // one must not, or a guard shot off you mid-grab would still book you.
        onEnd: function (res) {
          seizedBy = null;
          if (res === "taken" || res === "killed") { startEscort(); return; }
          // YOU GOT OUT OF IT. That is the reward for the press: he is on the
          // floor for a beat and the escalation resets, so the run continues.
          player.subdue = 0; gd.capCD = 3.2;
          if (res === "escaped") gd.ko = Math.max(gd.ko || 0, 1.2);
          setCaptureState("normal", 0);
        },
      });
      if (h) { seizedBy = h; setCaptureState("tackled", 2.4); }
      else startEscort();
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
    if (best) {
      if (CBZ.aiKill) CBZ.aiKill(best, { group: CBZ.playerChar.group }, { noKnock: true });
      else { best.dead = true; best.ko = 0; best.hp = 0; best.hunt = 0; best.alert = 0; }
      if (g.koLog && best.data && best.data.name) g.koLog[best.data.name] = true;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(best, "panic-fire");
      // a kill has ONE surface in this game and it is the corner feed.
      if (CBZ.cityLogDeath && best.data) {
        try { CBZ.cityLogDeath(best.data.name, "shot", { by: "You" }); } catch (e) {}
      } else tellHint(`You dropped ${best.data.name}!`, 1.6);
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
  //  The CALL is its own field (not split back out of the prose with " —" —
  //  the same display-string-as-data disease the `lock` note above already
  //  cured once): the call is what the screw shouts and what the objective
  //  line carries; the prose only ever rode the suppressed hint path.
  const DAY_BEAT = [
    { t: 55, call: "YARD CALL", s: "the block empties into the yard." },
    { t: 40, call: "CHOW", s: "the line's forming in the cafeteria." },
    { t: 35, call: "REC", s: "the lounge is open." },
    { t: 30, call: "LOCKUP", s: "back to your cell, count time.", lock: true },
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
      // the countdown lives in the objective line below — printing it twice was
      // the whole disease.
      if (s === 60 || s === 30 || s === 10) tellHint("Sentence: " + s + "s left.", 2.0);
    }
    // the mode's OWN readout — state.js already writes this line on reset, so
    // the sentence rides the surface the prison run already has.
    sentCallT -= dt;
    if (sentCallT <= 0) {
      sentCallT = 1;
      if (CBZ.setObjective) {
        /* STRIKES BELONG HERE, NOT IN A TOAST.
           Being caught is the one piece of prison bookkeeping that is both
           invisible and permanent: three and you are shipped to max security.
           It was announced by a popup you could be looking away from, and then
           never shown again — so the fact that decides your run lived for two
           seconds and then only inside a variable.
           This line already rewrites every second on the readout the mode
           always has, so the count rides it. A standing fact on a standing
           surface, instead of a warning you had to catch. */
        const st = CBZ.game.caughtCount || 0;
        const strikes = st > 0 ? " · caught " + st + "/3" : "";
        CBZ.setObjective("Serving " + s + "s" + strikes + (sentCall ? " · " + sentCall : "") +
          ". Or find a keycard, a vent or a tunnel and don't wait.");
      }
    }
    // the day beat rotates the block
    beatT -= dt;
    if (beatT <= 0) {
      const b = DAY_BEAT[beatI % DAY_BEAT.length];
      beatI++;
      beatT = b.t;
      sentCall = b.call;
      // THE CALL IS A CALL. A yard call is a thing an officer SHOUTS across a
      // block and a thing the block then physically does (muster() below walks
      // them); it is not a caption. So it goes over the nearest screw's head
      // (diegetic) and the phase name rides the objective readout — never a
      // popup. With nobody in earshot it is silent, which is correct: you
      // missed the call, and that is information you get by being somewhere
      // else, not information the HUD owes you.
      tellHint(b.call + ". " + b.s, 2.4);
      if (showing() && CBZ.citySay && CBZ.guards) {
        let crier = null, cd = 34 * 34;
        for (const gd of CBZ.guards) {
          if (!gd || gd.dead || gd.ko > 0 || !gd.group) continue;
          const dx = gd.group.position.x - player.pos.x, dz = gd.group.position.z - player.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < cd) { cd = d2; crier = gd; }
        }
        if (crier) { try { CBZ.citySay(crier, "“" + sentCall + "!”", "#ffd27b", 2.4); } catch (e) {} }
      }
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
      // the gate opening is the announcement.
      tellToast("TIME SERVED · GATE'S OPEN");
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
    // YOU WAKE UP IN A CELL WITH THE DOOR SHUT. That is the intake. The two
    // lines that used to say so are gone; what is left is the room, the bars
    // racking across in front of you (sealPlayerCell, above) and the sentence
    // standing in the objective readout the pipe already writes.
    tellToast("BOOKED · YOUR CELL");
    tellHint("Intake. The door stays shut for the count · " +
      Math.ceil(+g.jailSentence) + "s to serve.", 3.0);
    // NO SOUND REQUEST HERE. The bars racking shut on you is the one sound the
    // intake is about, and it was silent — this asked for a generic `door` cue
    // that had been retired months earlier, so it warned and played nothing.
    // The fix is not a corrected cue name at this line: a state change does not
    // get to voice hardware. sealPlayerCell() above drives the real leaf
    // through cellblock.setDoor, and that is where the leaf now speaks.
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
          // the SHUT DOOR is the confinement. A per-second countdown line was a
          // caption on a locked cell you are standing inside.
          if (!showing()) CBZ.showHint(heldDoor != null ? `Cell door locked. ${s}s` : `Confined to your cell. ${s}s`);
          else toldHints++;
        }
      } else {
        confineT = 0; confineShown = -1;
        const wasShut = releasePlayerCell();
        CBZ.hideHint();
        // the leaf sliding into its pocket + the rack is the "yard time" line.
        tellHint(wasShut ? "The door racks open. Yard time." : "The screws lose interest. Yard time.", 1.6);
        // (releasePlayerCell drives the same leaf, and the leaf speaks — see
        // the intake note above.)
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
        // THE HAUL SITE — every capture (and every drag) ends at the same
        // real door; this blackout is the ONE place a strike can land, and
        // the player is cuffed by construction when it does.
        if (!landInCell()) { player.pos.copy(CBZ.SPAWN); player.vy = 0; }
        g.detection = 0; g.invuln = 2.0;
        if (escortStrike) {
          g.caughtCount++;
          applyStrike();                           // strike 3 / transfer ends the run here
          if (confineT > 0) sealPlayerCell();
        }
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
        tellHint("TOWER · WARNING SHOTS! TURN BACK!", 1.6);
        towerShotCD = 1.1;
        if (towerT > 1.4) towerSeq = 2;
      } else if (towerSeq === 2 && towerShotCD <= 0) {
        towerBurst(towerSrc, 2.4, 4);                                   // final volley, CLOSE
        CBZ.shake && CBZ.shake(0.5);
        if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
        tellHint("LAST WARNING · GET OUT OF THE OPEN!", 1.6);
        towerShotCD = 1.3;
        if (towerT > 3.2) towerSeq = 3;
      } else if (towerSeq === 3 && towerShotCD <= 0) {
        towerBurst(towerSrc, 0.8, 5);                                   // dead-to-rights
        haulToCell("TOWER OPENS FIRE!");
        towerSeq = 0; towerT = 0;
      }
    } else if (towerSeq !== 0) {
      if (towerSeq >= 2) tellHint("Tower holds fire.", 1.0);
      towerSeq = 0; towerT = 0;
    }
  });

  /* ==========================================================
     THE RATCHET (BLOCK LAW rule 5) — CBZ.jailShowAudit().

     `toasts`, `hints` and `narrations` are the count of RAW emitters still
     standing in the prison's territory: a `CBZ.flashToast` / `CBZ.flashHint`
     that narrates an event instead of routing through this file's tell*()
     gate or entities/ai.js's nar() sink. Every file in the territory that
     could not convert one declares it on CBZ._jailShowRaw, so the number is
     read off the code rather than asserted. ALL THREE MAY ONLY GO DOWN.

     Everything beside them is printed so a "fix" that just stops drawing
     cannot pass:
       seizeAdopted  — capture paths running the SHARED grab arc
                       (CBZ.predatorSeize) rather than jumping from a string to
                       a fade. May only go UP.
       playerHits    — real damage taken through CBZ.hurtPlayer this run. A
                       beating that prints nothing and also does nothing is
                       not a fix; this is what proves it lands.
       sittableProps / ventsAnchored / roadsInPrison — the other three owner
                       complaints, answered by their own files and surfaced
                       here so one call answers the whole wave.
     ========================================================== */
  CBZ._jailShowRaw = CBZ._jailShowRaw || { toasts: [], hints: [], narrations: [] };
  CBZ.jailShowAudit = function () {
    const raw = CBZ._jailShowRaw;
    const vents = (CBZ.ventAudit && CBZ.ventAudit()) || null;
    const props = (CBZ.prisonPropAudit && CBZ.prisonPropAudit()) || null;
    const road = (CBZ.prisonRoadAudit && CBZ.prisonRoadAudit()) || null;
    const nar = (CBZ.aiNarrationAudit && CBZ.aiNarrationAudit()) || null;
    return {
      on: showing(),
      // ---- the three that may only go DOWN ----
      toasts: raw.toasts.length,
      hints: raw.hints.length,
      narrations: raw.narrations.length,
      // ---- the four that may only go UP / must hold ----
      seizeAdopted: SEIZE_SITES.length,
      sittableProps: props ? (props.sittable | 0) : 0,
      ventsAnchored: vents ? (vents.anchored | 0) : 0,
      roadsInPrison: road ? (road.roadsInPrison | 0) : 0,
      // ---- evidence the replacement is live, not just the deletion ----
      suppressedToasts: toldToasts,
      suppressedHints: toldHints,
      droppedNarrations: nar ? (nar.dropped | 0) : 0,
      playerHits: playerHits,
      seizesStarted: seizesStarted,
      chests: (CBZ.crateAudit && CBZ.crateAudit().containers) | 0,
      vents: vents ? (vents.vents | 0) : 0,
      ventHubs: vents ? (vents.hubs | 0) : 0,
      props: props ? (props.props | 0) : 0,
      walkwayW: road ? road.walkwayW : 0,
      regions: road ? (road.regions | 0) : 0,
    };
  };
  // the capture paths that have adopted the shared grab. Declared, not counted
  // at runtime, so an audit taken before anybody was ever tackled is honest.
  const SEIZE_SITES = ["capture:tryCapture", "ai:huntPlayer"];
  let seizesStarted = 0;
  CBZ.jailSeizeCount = function () { return seizesStarted; };
  // capture.js's own seize bumps the counter (ai.js's runs through predator.js
  // directly and is counted by CBZ.predatorAudit).
  const _seizeWrapT = setInterval(function () {
    if (typeof CBZ.predatorSeize !== "function" || CBZ.predatorSeize._jailWrapped) { clearInterval(_seizeWrapT); return; }
    const orig = CBZ.predatorSeize;
    const wrapped = function (a, v, o) {
      const h = orig.apply(this, arguments);
      if (h && v === player) seizesStarted++;
      return h;
    };
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._jailWrapped = true;
    CBZ.predatorSeize = wrapped;
    clearInterval(_seizeWrapT);
  }, 0);
})();
