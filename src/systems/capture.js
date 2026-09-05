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
      endEscort();
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

  // ============================================================
  //  THE HAUL IS A SCENE — OWNER: "goes to this stupid screen way too fast,
  //  it should show the player getting handcuffed or at least getting tased,
  //  I want to see my death, not get cut to this stupid screen early."
  //
  //  The old escort was 1.9 s long and the screen was BLACK from 0.95 s: the
  //  fade began on the frame the cuffs flag flipped, the strike/transfer
  //  landed at the blackout, and the TRANSFERRED card was up before a hand had
  //  visibly touched you. On the tower/beat-down paths (haulToCell) there was
  //  never a taser at all — you dropped and the card came.
  //
  //  Every haul now runs the city's arrest grammar (wanted.js: hands → cuff →
  //  walk → ride) in the pen's own vocabulary, ON CAMERA, before any fade:
  //
  //    down  — you are on the floor; the nearest screws RUN to the body
  //    tase  — a drive-stun from the lead screw if nobody tased you yet
  //    cuff  — he kneels on you, the ties go on (restrain.js's real wrist
  //            meshes when present), the ratchet clicks, he says so
  //    lift  — hauled to your feet, still cuffed
  //    walk  — marched toward your own cell door, screws one pace behind,
  //            the lens easing round behind you
  //    fade  — THEN the blackout. The strike/transfer lands there, in the
  //            cuffs, exactly where it always did (the ONE place).
  //    wake  — fade back in on the bunk, ties off (in-tier strike only; a
  //            transfer's card is up at the blackout and this never runs)
  //
  //  The screws are real guards put on `_escort` duty (entities/guards.js
  //  yields the body while the flag is set; this file steers it). No screw
  //  alive = a short down beat and the cuffs go on anyway (the tower crew),
  //  so a capture can never wait forever on an empty wing.
  // ============================================================
  const ESC = {
    DOWN_MAX: 4.5,     // s — longest the body lies waiting for the screws
    DOWN_ALONE: 1.2,   // s — the wait when there is nobody to run in
    TASE: 1.0,         // s — the drive-stun on the ground
    CUFF: 1.5,         // s — kneel + ties
    LIFT: 1.0,         // s — up on your feet
    WALK_MIN: 2.4,     // s — you always SEE yourself marched
    WALK_MAX: 5.5,     // s — a far cell is walked off-screen (elevator law)
    WALK_SPD: 1.35,    // m/s — a perp walk, not a jog
    FADE: 1.0, WAKE: 0.9,
    REACH: 1.45,       // m — where a screw stops to work on a body (actorcollide.js
                       //     holds two standing bodies ~1.4 m apart; asking for less
                       //     is a man pushed back out every frame and never "arriving")
    SECOND_R: 30,      // m — a second screw only if he is already near; a far one
                       //     is a man jogging into a wall for the whole scene
  };
  let esc = null;      // the live scene, or null
  const lerpAng = CBZ.lerpAngle || function (a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  };
  // screws for the haul: the two nearest guards who can walk.
  function pickScrews() {
    const out = [];
    for (const gd of CBZ.guards || []) {
      if (!gd || !gd.group || gd.dead || gd.ko > 0 || gd.asleep || gd.bribed > 0 || gd.tied || gd._escort) continue;
      const dx = player.pos.x - gd.group.position.x, dz = player.pos.z - gd.group.position.z;
      out.push({ gd, d2: dx * dx + dz * dz });
    }
    out.sort((a, b) => a.d2 - b.d2);
    const picked = out.slice(0, 2).filter((o, i) => i === 0 || o.d2 < ESC.SECOND_R * ESC.SECOND_R);
    return picked.map((o) => o.gd);
  }
  function screwUsable(gd) { return !!(gd && gd.group && !gd.dead && !(gd.ko > 0)); }
  function releaseScrews() {
    if (!esc) return;
    for (const gd of esc.screws) {
      if (!gd) continue;
      gd._escort = false;
      if (gd.char) gd.char.crouch = false;
      gd.capCD = 3.0;              // he does not re-grab the man he just booked
    }
    esc.screws.length = 0;
  }
  // move a screw toward (tx,tz), stopping `stop` short of it, facing (fx,fz).
  // Returns the distance still to go.
  function screwStep(gd, tx, tz, stop, fx, fz, run, dt) {
    const gp = gd.group.position;
    const dx = tx - gp.x, dz = tz - gp.z, d = Math.hypot(dx, dz);
    const sp = (gd.speed || 3) * (run ? 1.7 : 1.15);
    const step = Math.max(0, Math.min(d - stop, sp * dt));
    if (step > 0 && d > 1e-4) { gp.x += dx / d * step; gp.z += dz / d * step; }
    // a body on the gallery is worked on at the gallery's height
    if (d < 3) gp.y = CBZ.damp(gp.y, player.pos.y, 8, dt);
    const ax = fx - gp.x, az = fz - gp.z;
    if (Math.abs(ax) + Math.abs(az) > 1e-3) gd.group.rotation.y = lerpAng(gd.group.rotation.y, Math.atan2(ax, az), 1 - Math.pow(0.0005, dt));
    if (gd.group.rotation.z !== 0) gd.group.rotation.z = CBZ.damp(gd.group.rotation.z, 0, 9, dt);
    if (CBZ.animChar && gd.char) CBZ.animChar(gd.char, step / Math.max(dt, 1e-4), dt);
    return Math.max(0, d - stop);
  }
  function flash() {
    if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
  }
  function tiesOn(on) {
    CBZ.playerChar.cuffed = !!on;
    const R = CBZ.cityRestrain;
    if (R && R.cuffPlayer) { try { R.cuffPlayer(!!on); } catch (e) {} }
  }
  // THE LENS. The pen's camera is a tight room-aware boom over your shoulder,
  // so a scene played under it is a wall: you lie under the pivot and the
  // screw kneels behind the camera. city/cinematics.js publishes a scripted
  // camera channel (CBZ.cineCam) that systems/camera.js yields to outright;
  // we write it directly — no director steps, no holster, and it hands back
  // the moment the scene does. Two shots: a low side-on of the body with the
  // screws arriving behind it, then a CUT to the perp walk, backing away in
  // front of the cuffed man with the screws on his heels.
  function camOwn() {
    const cc = CBZ.cineCam;
    if (!cc || (CBZ.cineBusy && CBZ.cineBusy())) return null;   // a real director has the lens
    if (!esc.cam) {
      esc.cam = true; cc.snap = true;
      // systems/fpsmode.js writes the camera AFTER camera.js (always-order 52
      // vs 50) whenever first person is on — the pen auto-drops into FP in
      // tight rooms (CAM_TIGHT_FP) — so a scripted shot under FP is a shot
      // nobody sees. The city director drops FP for its scenes; so do we,
      // and hand it back with the lens.
      esc.fpWas = !!(CBZ.fps && CBZ.fps.active);
      if (esc.fpWas && CBZ.setFPS) { try { CBZ.setFPS(false); } catch (er) {} }
    }
    cc.active = true;
    return cc;
  }
  function camDrop() {
    if (!esc || !esc.cam) return;
    esc.cam = false;
    if (CBZ.cineCam) CBZ.cineCam.active = false;
    if (esc.fpWas && CBZ.setFPS && !player.dead) { try { CBZ.setFPS(true); } catch (er) {} }
    esc.fpWas = false;
  }
  function camGround(px, py, pz) {
    const cc = camOwn(); if (!cc) return;
    const e = esc;
    cc.x = px + e.cx * 2.5; cc.y = py + 1.45; cc.z = pz + e.cz * 2.5;
    cc.lx = px; cc.ly = py + 0.45; cc.lz = pz;
  }
  function camWalk(px, py, pz, hx, hz) {
    const cc = camOwn(); if (!cc) return;
    const sx = -hz, sz = hx;
    cc.x = px + hx * 3.2 + sx * 1.5; cc.y = py + 1.7; cc.z = pz + hz * 3.2 + sz * 1.5;
    cc.lx = px; cc.ly = py + 1.0; cc.lz = pz;
  }
  // where the walk goes: your own cell's door mouth, else the cell, else the
  // spawn — the same "back to your cell" the blackout lands you at.
  function walkTarget() {
    const c = beatOn() ? playerCell() : null;
    if (c && isFinite(+c.doorX) && isFinite(+c.doorZ)) return { x: +c.doorX, z: +c.doorZ };
    if (c && isFinite(+c.x) && isFinite(+c.z)) return { x: +c.x, z: +c.z };
    return CBZ.SPAWN ? { x: CBZ.SPAWN.x, z: CBZ.SPAWN.z } : { x: player.pos.x, z: player.pos.z };
  }

  // EVERY capture path ends here (haulToCell routes through it), so the cuffs
  // are always ON before applyStrike can ever say TRANSFERRED.
  function startEscort(msg, opts) {
    if (esc) return;
    if (CBZ.killstreakBreak) CBZ.killstreakBreak(msg || "Cuffed");
    CBZ.playerChar.cuffed = false;
    player.stun = 2.2;
    setCaptureState("cuffed", 60);             // non-normal for the whole scene; escortTick keeps it alive
    tellToast(msg || "CUFFED · BACK TO YOUR CELL");
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd.capCD = 0; });
    const screws = pickScrews();
    for (const gd of screws) { gd._escort = true; gd.approach = null; }
    let cx = Math.sin(CBZ.playerChar.group.rotation.y + Math.PI * 0.5), cz = Math.cos(CBZ.playerChar.group.rotation.y + Math.PI * 0.5);
    if (screws[0]) {
      const ax = player.pos.x - screws[0].group.position.x, az = player.pos.z - screws[0].group.position.z, al = Math.hypot(ax, az);
      if (al > 0.5) { cx = ax / al; cz = az / al; }
    }
    esc = {
      cam: false, cx, cz,
      phase: "down", t: 0, total: 0,
      strike: !(opts && opts.strike === false),
      // a man tased on his feet (tryCapture) is not tased again on the floor
      tased: (player.subdue || 0) >= 1,
      tied: false, stall: 0,
      screws, tx: 0, tz: 0, hx: 0, hz: 1,
    };
  }
  // tear the scene down without landing anything: a transfer card, a new run,
  // a death, leaving play. Safe from anywhere, any number of times.
  function endEscort() {
    if (!esc) return;
    camDrop();
    releaseScrews();
    esc = null;
    tiesOn(false);
    player.subdue = 0; player.stun = 0;
    setCaptureState("normal", 0);
    CBZ.playerChar.group.rotation.z = 0;
    if (fadeEl) fadeEl.style.opacity = "0";
  }
  function escortTick(dt) {
    const e = esc, ch = CBZ.playerChar, P = player;
    e.t += dt; e.total += dt;
    // nothing else may move, hit or grab you mid-scene
    P.stun = Math.max(P.stun || 0, 0.5); g.invuln = Math.max(g.invuln || 0, 0.6);
    P.captureT = 60; P.captureState = "cuffed";
    // a screw shot off the scene drops out of it; the man is still cuffed
    for (let i = e.screws.length - 1; i >= 0; i--) if (!screwUsable(e.screws[i])) { e.screws[i]._escort = false; e.screws.splice(i, 1); }
    const lead = e.screws[0], second = e.screws[1];
    const px = P.pos.x, pz = P.pos.z;
    // down on whichever side the hit put you on (a tackle lands you on the other)
    const side = ch.group.rotation.z < -0.05 ? -1 : 1;
    const lie = () => { ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, side * Math.PI / 2, 10, dt); };
    // the second screw takes the far side of the body
    const flank = (sx, sz, sgn) => {
      const ax = lead ? lead.group.position.x - px : 1, az = lead ? lead.group.position.z - pz : 0;
      const al = Math.hypot(ax, az) || 1;
      return { x: px - az / al * 1.5 * sgn - ax / al * 0.3, z: pz + ax / al * 1.5 * sgn - az / al * 0.3 };
    };

    if (e.phase === "down") {
      lie(); camGround(px, P.pos.y, pz);
      let near = Infinity;
      if (lead) near = screwStep(lead, px, pz, ESC.REACH, px, pz, true, dt);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, true, dt); }
      // arrived = within reach, OR he has stopped gaining on you (a body on a
      // ledge, a wall on the straight line): the beat goes on from where he is
      if (lead) { if (near < (e.gain == null ? Infinity : e.gain) - 0.02) { e.gain = near; e.stuck = 0; } else e.stuck = (e.stuck || 0) + dt; }
      const arrived = lead ? (near <= 0.35 || (e.stuck > 0.8 && near < 3.0)) : false;
      if (arrived || e.t >= (lead ? ESC.DOWN_MAX : ESC.DOWN_ALONE)) {
        e.phase = (!e.tased && lead) ? "tase" : "cuff"; e.t = 0;
      }
      return;
    }
    if (e.phase === "tase") {
      lie(); camGround(px, P.pos.y, pz);
      if (!e.tased) {
        e.tased = true;
        // the drive-stun: the lead screw's own taser on the body, same event
        // the standing tase fires, same body-pose signal
        if (CBZ.taserFx && CBZ.taserFx.actorTasePlayer) { try { CBZ.taserFx.actorTasePlayer(lead); } catch (er) {} }
        if (CBZ.sfx) { try { CBZ.sfx("tase"); } catch (er) {} }
        if (CBZ.shake) CBZ.shake(0.55);
        flash();
      }
      if (ch.body) ch.body.rotation.x += 0.28 * Math.max(0, 1 - e.t / ESC.TASE);
      if (lead) screwStep(lead, px, pz, ESC.REACH, px, pz, false, dt);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      if (e.t >= ESC.TASE) { e.phase = "cuff"; e.t = 0; }
      return;
    }
    if (e.phase === "cuff") {
      lie(); camGround(px, P.pos.y, pz);
      if (lead) { screwStep(lead, px, pz, ESC.REACH * 0.75, px, pz, false, dt); if (lead.char) lead.char.crouch = true; }
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      if (!e.tied && e.t >= 0.45) {
        e.tied = true;
        tiesOn(true);
        if (CBZ.sfx) { try { CBZ.sfx("reload"); } catch (er) {} }   // the ratchet click
        if (lead && CBZ.prisonSay) { try { CBZ.prisonSay(lead, "Hands. Behind your back.", { secs: 2.0, rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 }); } catch (er) {} }
      }
      if (e.t >= ESC.CUFF) { e.phase = "lift"; e.t = 0; if (lead && lead.char) lead.char.crouch = false; }
      return;
    }
    if (e.phase === "lift") {
      camGround(px, P.pos.y, pz);
      ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, 0, 7, dt);
      if (ch.body && ch.body.rotation.x) ch.body.rotation.x = CBZ.damp(ch.body.rotation.x, 0, 9, dt);
      if (lead) screwStep(lead, px, pz, ESC.REACH * 0.75, px, pz, false, dt);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      if (e.t >= ESC.LIFT) {
        const w = walkTarget();
        e.tx = w.x; e.tz = w.z;
        const dx = e.tx - px, dz = e.tz - pz, d = Math.hypot(dx, dz);
        if (d > 0.01) { e.hx = dx / d; e.hz = dz / d; }
        else { e.hx = Math.sin(ch.group.rotation.y); e.hz = Math.cos(ch.group.rotation.y); }
        ch.group.rotation.z = 0;
        if (CBZ.cineCam && e.cam) CBZ.cineCam.snap = true;      // CUT to the walk
        e.phase = "walk"; e.t = 0;
      }
      return;
    }
    // ---- walk / fade: the march, with the blackout riding on the end of it
    const marching = e.phase === "walk" || e.phase === "fade";
    if (marching) {
      const dx = e.tx - px, dz = e.tz - pz, d = Math.hypot(dx, dz);
      // the legs follow the GROUND COVERED, never the intent: a wall between
      // you and the door must not make a cuffed man jog on the spot
      let moved = 0;
      if (d > 0.6) {
        e.hx = dx / d; e.hz = dz / d;
        const step = Math.min(d - 0.5, ESC.WALK_SPD * dt);
        const ox = P.pos.x, oz = P.pos.z;
        P.pos.x += e.hx * step; P.pos.z += e.hz * step; P.vy = 0;
        if (CBZ.collide) { try { CBZ.collide(P.pos, BODY_R, 0, 1.7); } catch (er) {} }
        moved = Math.hypot(P.pos.x - ox, P.pos.z - oz);
        e.stall = moved < 0.25 * step ? e.stall + dt : 0;
      }
      ch.group.position.copy(P.pos);
      ch.group.rotation.y = lerpAng(ch.group.rotation.y, Math.atan2(e.hx, e.hz), 1 - Math.pow(0.002, dt));
      ch.cuffed = true;
      if (CBZ.animChar) CBZ.animChar(ch, moved / Math.max(dt, 1e-4), dt);
      camWalk(P.pos.x, P.pos.y, P.pos.z, e.hx, e.hz);
      // the lens eases round behind the march — slowly, never a locked camera
      if (CBZ.cam) CBZ.cam.yaw = lerpAng(CBZ.cam.yaw, Math.atan2(e.hx, e.hz) + Math.PI, 1 - Math.pow(0.55, dt));
      const back = (CBZ.cityRestrain && CBZ.cityRestrain.ESCORT_D) || 0.9;
      if (lead) screwStep(lead, P.pos.x - e.hx * (back + 0.55), P.pos.z - e.hz * (back + 0.55), 0.02, P.pos.x + e.hx, P.pos.z + e.hz, false, dt);
      if (second) screwStep(second, P.pos.x - e.hx * 0.6 - e.hz * 1.0, P.pos.z - e.hz * 0.6 + e.hx * 1.0, 0.02, P.pos.x + e.hx, P.pos.z + e.hz, false, dt);
      if (e.phase === "walk") {
        // arrived, walked long enough, or walled off: the rest is off-screen
        if ((d <= 0.6 && e.t >= ESC.WALK_MIN) || e.t >= ESC.WALK_MAX || (e.stall > 0.7 && e.t >= 1.0)) { e.phase = "fade"; e.t = 0; }
        return;
      }
      // fade
      if (fadeEl) fadeEl.style.opacity = Math.min(1, e.t / ESC.FADE).toFixed(2);
      if (e.t < ESC.FADE) return;
      // ---- THE HAUL SITE — every capture (and every drag) ends at the same
      // real door; this blackout is the ONE place a strike can land, and the
      // player is cuffed by construction when it does.
      camDrop(); releaseScrews();
      if (!landInCell()) { P.pos.copy(CBZ.SPAWN); P.vy = 0; ch.group.position.copy(P.pos); }
      g.detection = 0; g.invuln = 2.0;
      if (e.strike) {
        g.caughtCount++;
        applyStrike();                            // a transfer ends the scene (and the run) in here
        if (!esc) return;
        if (confineT > 0) sealPlayerCell();
      }
      e.phase = "wake"; e.t = 0;
      return;
    }
    if (e.phase === "wake") {
      if (fadeEl) fadeEl.style.opacity = Math.max(0, 1 - e.t / ESC.WAKE).toFixed(2);
      if (e.tied && e.t >= 0.3) { e.tied = false; tiesOn(false); }
      if (e.t >= ESC.WAKE) endEscort();
      return;
    }
    endEscort();   // unknown phase: never strand the player in a half-scene
  }
  CBZ.jailEscortPhase = function () { return esc ? esc.phase : null; };

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
    CBZ.jailBoost.onStateExit(function () { endEscort(); releasePlayerCell(); confineT = 0; confineShown = -1; });
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
      endEscort(); releasePlayerCell(); muster(false);
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
      if (esc) { camDrop(); releaseScrews(); esc = null; tiesOn(false); }
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

    // the haul owns the body, the screws and the lens until it is done
    if (esc) { escortTick(dt); return; }

    if (player.captureT > 0) {
      player.captureT -= dt;
      const prone = player.captureState === "tased" || player.captureState === "tackled" || player.captureState === "cuffed";
      if (prone) {
        const side = player.captureState === "tackled" ? -1 : 1;
        CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, side * Math.PI / 2, 10, dt);
        if (CBZ.playerChar.body) CBZ.playerChar.body.rotation.x += player.captureState === "tased" ? 0.28 : 0.10;
      }
      if (player.captureT <= 0 && !esc) setCaptureState("normal", 0);
    } else if ((!player.captureState || player.captureState === "normal") && Math.abs(CBZ.playerChar.group.rotation.z) > 0.001) {
      CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, 0, 9, dt);
      if (Math.abs(CBZ.playerChar.group.rotation.z) < 0.02) CBZ.playerChar.group.rotation.z = 0;
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
