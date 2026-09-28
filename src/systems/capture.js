/* ============================================================
   systems/capture.js — what happens to your BODY in the prison: hurt, downed,
   arrested, cuffed, held, carried, killed.

   THE LAW (2026-09-27, with systems/prisonlaw.js). Owner: "getting handcuffed
   is way too easy. It's way too easy to die." Before: a hunting screw that
   touched you tased, tackled and cuffed you; every cuffing was a strike and
   every strike below the top tier was a TRANSFER; losing a fistfight at 0 hp
   was a cuffing. Now:

     ARREST   a hunting guard inside ~4 m ORDERS you ("On the ground!").
              ~2.2 s to comply (stop, or crouch). No offense on file or a
              minor one: comply = a pat-down and a warning, no cuffs. A real
              offense + comply = he walks up and cuffs you. Resist (run,
              swing) = the taser (it can miss), then the lunge (it can miss).
              2026-09-28: the cuffs and the walk are systems/arrest.js's
              contest (CBZ.arrest.take): no camera, no forced fall, your
              controls live until his hands land, a struggle you can win.
     CUFFS    only an ESCAPE capture (offense "escape", out of bounds, the
              sterile zone, a hot exit run) goes up a tier. Every other
              cuffing is THE HOLE: walked to your cell, door sealed 25-40 s,
              contraband gone, a small cigarette cut, then released with a
              grace window. No strike.
     DOWNED   your body is CBZ.vitals (systems/vitals.js): a clean fist KNOCKS
              YOU OUT, a blade or a round that takes you past what you can
              stand puts you down BLEEDING. Either way the screws break it up
              and carry you to the infirmary. You DIE of a truly lethal hit
              (the neck, the heart, the head), of the blood running out before
              they get to you, of a long beating while you were out, or of
              tower fire on the sterile strip.
     REGEN    out of a fight for 8 s you heal slowly to 70; Doc Mercer in the
              infirmary closes what is open and heals you to full.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player } = CBZ;
  const g = CBZ.game;

  const fadeEl = document.getElementById("fade");

  // THE HOLE / ESCAPE STRIKES: confineT is the sealed-cell clock both use.
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
    // ...and never on the screw who walked you in: he steps out first
    for (const gd of CBZ.guards || []) {
      if (gd && gd.group && !gd.dead && inCellBox(cell, gd.group.position.x, gd.group.position.z, -0.1)) return false;
    }
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
  let towerSeq = 0;        // 0 idle, 1 warning shots, 2 final volley, 3 firing on you
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
  const _muz = new THREE.Vector3();
  function towerBurst(src, spreadR, count) {
    // from the rifle of the man on the tower (entities/towerwatch.js), or
    // the cabin if the build has no man in it
    let from = { x: src.x, y: (CBZ.TOWER_DECK || 5) + 1.5, z: src.z };
    const gd = src.guard;
    if (gd && gd.group) {
      from = { x: gd.group.position.x, y: gd.group.position.y + 1.45, z: gd.group.position.z };
      if (CBZ.actorMuzzle) { try { const m = CBZ.actorMuzzle(gd, _muz); if (m && isFinite(m.x)) from = { x: m.x, y: m.y, z: m.z }; } catch (e) {} }
    }
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

  // Every haul runs the pen's restraint/carry SCENE (startEscort below), never
  // a string and a teleport. opts.kind picks what the blackout means:
  //   "hole"     cuffed, walked to your cell, sealed in for a while (default)
  //   "transfer" cuffed after an ESCAPE: the strike/tier path (applyStrike)
  //   "medical"  carried to the infirmary (downed, starving): no cuffs, no strike
  // opts.strike:false (the old medical-drag flag) still means "medical".
  function haulToCell(msg, opts) {
    opts = Object.assign({}, opts || {});
    if (opts.strike === false && !opts.kind) opts.kind = "medical";
    if (!opts.kind) opts.kind = (CBZ.prisonEscapeCapture && CBZ.prisonEscapeCapture()) ? "transfer" : "hole";
    flash();
    startEscort(msg, opts);
  }
  CBZ.haulToCell = haulToCell;
  function law(k, n) { if (CBZ.prisonLawCount) CBZ.prisonLawCount(k, n); }
  function clock() { return (g && g.elapsed) || 0; }

  // AN ESCAPE CAPTURE, cuffed, at the blackout. The only path that moves the
  // tier ladder (systems/prisontiers.js transfer()); at the top of the ladder
  // it is a long stretch in the hole instead.
  function applyStrike() {
    if (g.mode !== "escape" || g.role === "cop") return;
    const campaign = !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
    const T = CBZ.prisonTier;
    const tiered = !!(T && T.enabled());
    if (tiered && T.top()) g.caughtCount = Math.min(g.caughtCount || 0, 2);
    const strike = g.caughtCount || 0;
    g.witnessReportT = 0; g.lastKnown = null;
    if (pipeOn() && (+g.jailSentence || 0) > 0) { g.jailSentence = (+g.jailSentence || 0) + STRIKE_TIME; sentShown = -1; }
    // a TRANSFER is the end of an ARREST: the cuffs must actually be on
    const restrained = !!(CBZ.playerChar && CBZ.playerChar.cuffed) || player.captureState === "cuffed";
    const transferring = tiered && !T.top() && !campaign && restrained;
    // the destination's reception search is the shakedown on a transfer
    let taken = transferring ? 0 : Math.floor((g.cigs || 0) / 2);
    if (taken > 0 && CBZ.posseShelterCut) taken = CBZ.posseShelterCut(taken);
    if (taken > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-taken);
    if (transferring || (!tiered && strike >= 3 && !campaign && restrained)) {
      endEscort();
      confineT = 0; confineShown = -1;
      releasePlayerCell();
      if (CBZ.escapePlan && CBZ.escapePlan.noteTransferLoss) { try { CBZ.escapePlan.noteTransferLoss(); } catch (e) {} }
      law("transfers");
      if (tiered && T.transfer()) return;
      if (CBZ.loseGame) CBZ.loseGame("transferred");
      return;
    }
    if (CBZ.escapePlan && CBZ.escapePlan.confiscate) { try { CBZ.escapePlan.confiscate(); } catch (e) {} }
    if (strike >= 2) {
      g.strikeHeatFloor = Math.max(g.strikeHeatFloor || 0, 12);
      g.detection = Math.max(g.detection, g.strikeHeatFloor);
      g.cellWatch = true;
    }
    confineT = strike >= 2 ? 40 : 32; confineShown = -1;
    law("shu");
    if (CBZ.shake) CBZ.shake(strike >= 2 ? 0.85 : 0.6);
    if (CBZ.sfx) { try { CBZ.sfx(taken > 0 ? "coin" : "punch"); } catch (e) {} }
    flash();
    g.invuln = Math.max(g.invuln || 0, confineT + 0.5);
  }

  // THE HOLE. Every cuffing that is not an escape: sealed in your own cell
  // for 25-40 s (severity scales it), contraband and tools gone, a small cut
  // of your cigarettes, and NO strike, NO tier change. It ends.
  function holeSentence(sev) {
    sev = Math.max(2, Math.min(4, sev || 2));
    confineT = Math.min(40, 13 + sev * 6.5 + Math.random() * 4); confineShown = -1;
    if (CBZ.escapePlan && CBZ.escapePlan.confiscate) { try { CBZ.escapePlan.confiscate(); } catch (e) {} }
    const cigs = g.cigs || 0;
    let cut = Math.min(cigs, Math.min(6, Math.ceil(cigs * 0.1)));
    if (cut > 0 && CBZ.posseShelterCut) cut = CBZ.posseShelterCut(cut);
    if (cut > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-cut);
    g.witnessReportT = 0; g.lastKnown = null;
    g.detection = g.strikeHeatFloor || 0;
    law("shu");
    if (CBZ.shake) CBZ.shake(0.5);
    g.invuln = Math.max(g.invuln || 0, confineT + 0.5);
  }

  // THE GRACE WINDOW after the hole, a warning or the infirmary: no screw
  // re-grabs you for a while, the record is wiped, the hunt is called off.
  let lawGraceT = 0;
  function lawGrace(secs) {
    lawGraceT = Math.max(lawGraceT, secs);
    g.invuln = Math.max(g.invuln || 0, Math.min(4, secs));
    if (CBZ.prisonOffenseClear) CBZ.prisonOffenseClear();
    for (const gd of CBZ.guards || []) {
      if (!gd) continue;
      gd.hunt = 0; gd._chase = null; gd.warnT = null; gd.radioT = null; gd.radioKind = null;
      if (gd.investigate && (gd.investigate.type === "search" || gd.investigate.looking)) gd.investigate = null;
      gd.capCD = Math.max(gd.capCD || 0, secs);
    }
    g.witnessReportT = 0; g.lastKnown = null;
    g.detection = Math.min(g.detection || 0, g.strikeHeatFloor || 0);
    // a man they just searched and let go is CLEARED: the tips and sightings
    // that sent them are answered, so the case file does not re-send them
    if (g.caseFile) { g.caseFile.heat = 0; g.caseFile.reports = []; }
  }
  // detection.js asks this before it lets a sighting or a tip turn into a
  // hunt: during the grace only a FRESH offense brings the screws back.
  CBZ.prisonLawGrace = function () {
    return lawGraceT > 0 && !(CBZ.prisonOffenseFresh && CBZ.prisonOffenseFresh());
  };

  // ============================================================
  //  THE ONE WAY THE PLAYER IS HURT IN THIS MODE (CBZ.hurtPlayer).
  //  opts: melee, by (actor), weapon "fist"|"shank"|"gun"|"blast", stun,
  //  shake, sfx, tower; zone/power/point/blunt/dirX/dirZ from a real strike.
  //  Being hurt is NOT heat: a man getting beaten is not a crime he committed.
  //
  //  WHAT IT DOES TO YOUR BODY IS CBZ.vitals (systems/vitals.js), as it is for
  //  every man in the yard: a fist dazes you and a clean one knocks you OUT
  //  (the screws carry you to the infirmary and you wake there); a blade or a
  //  round opens a BLEED, and when you can take no more you go down bleeding.
  //  You die of a truly lethal hit, of the blood, or of a long beating while
  //  you were out. hp is the gauge on the HUD, never the death.
  // ============================================================
  let playerHits = 0;
  let lastHurtT = -1e9;
  let down = null;                 // { t, weapon, by, wakeHp } while on the floor
  let deathT = 0;                  // seconds to the loss card once dead
  const DOWN_BEAT = 3.2;           // s on the floor before the screws carry you
  function weaponOf(opts) {
    if (opts.weapon) return opts.weapon;
    if (opts.melee) return opts.sfx === "hit" ? "shank" : "fist";
    return "gun";
  }
  CBZ.playerDowned = function () { return !!down || !!(esc && esc.kind === "medical"); };
  const VIT = () => CBZ.vitals || null;
  CBZ.hurtPlayer = function (dmg, fromX, fromZ, opts) {
    opts = opts || {};
    if (player.dead) return false;
    const weapon = weaponOf(opts);
    const steel = weapon !== "fist";
    const V = VIT();
    // ON THE FLOOR: fists stop (SOCIAL honours playerDowned); steel into a
    // man on the floor is another hole, and he is already bleeding hard
    if (down) {
      if (steel && !((g.invuln || 0) > 0)) {
        if (V) V.wound(player, { kind: weapon === "shank" ? "stab" : "bullet", zone: opts.zone, point: opts.point, by: opts.by || null, critical: true, cal: opts.cal });
        else die(weapon === "shank" ? "Stabbed on the floor" : "Shot on the floor", opts);
        return true;
      }
      return false;
    }
    if ((g.invuln || 0) > 0) return false;
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return false;
    playerHits++;
    lastHurtT = clock();
    if (opts.melee && CBZ.prisonLawNoteBlow) CBZ.prisonLawNoteBlow(opts.by || null, "player");
    player.hp = (player.hp == null ? 100 : player.hp) - (dmg || 30);
    // a fist is a reaction (combat.js poise), not the hard input lock
    if (opts.melee && CBZ.playerHitReact) CBZ.playerHitReact(opts.stun != null ? opts.stun : 0.42, opts);
    else player.stun = Math.max(player.stun || 0, opts.stun || 0.25);
    if (CBZ.shake) CBZ.shake(opts.shake || 0.6);
    flash();
    CBZ.sfx && CBZ.sfx(opts.sfx || (opts.melee ? "punch" : "hit"));
    // the blow on YOUR body: a strike through CBZ.verbs has already played
    // its reaction (opts.reacted); anything else gets the same one from here
    if (opts.melee && !opts.reacted && CBZ.verbs && CBZ.verbs.react && fromX != null && isFinite(fromX)) {
      const dx = player.pos.x - fromX, dz = player.pos.z - (fromZ || 0), l = Math.hypot(dx, dz) || 1;
      CBZ.verbs.react(CBZ.verbs.playerActor ? CBZ.verbs.playerActor() : { isPlayer: true, pos: player.pos },
        { zone: "head", kind: weapon === "shank" ? "stab" : "cross", dir: { x: dx / l, z: dz / l }, power: Math.min(1, 0.35 + (dmg || 10) / 30) });
    }
    // THE WIRE: tower fire on the sterile strip is not a wound, it is the end
    if (opts.tower && player.hp <= 0 && CBZ.prisonSterileAt && CBZ.prisonSterileAt(player.pos.x, player.pos.z)) {
      player.hp = 0; die("Shot on the wire", opts); return true;
    }
    if (!V) {
      // no body model loaded: the old gauge decides
      if (player.hp > 0) return false;
      player.hp = 0;
      goDown(weapon, opts);
      return true;
    }
    let dx = opts.dirX || 0, dz = opts.dirZ || 0;
    if (!dx && !dz && fromX != null && isFinite(fromX)) {
      dx = player.pos.x - fromX; dz = player.pos.z - (fromZ || 0);
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    if (!steel) {
      // A FIST: the gauge never runs out on its own; the jaw decides
      if (player.hp < 1) player.hp = 1;
      const out = V.blunt(player, { zone: opts.zone || "head", power: opts.power != null ? opts.power : Math.min(1, (dmg || 10) / 25),
        weapon: opts.blunt || "fist", heavy: !!opts.heavy, by: opts.by || null, dirX: dx, dirZ: dz, fromX, fromZ });
      return out === "ko" || out === "dead";
    }
    // STEEL OR A ROUND: a hole that bleeds; out of hp, down bleeding
    const crit = player.hp <= 0;
    if (player.hp < 1) player.hp = crit ? 0 : 1;
    const W = V.wound(player, { kind: weapon === "shank" ? "stab" : weapon === "blast" ? "blast" : "bullet",
      zone: opts.zone, point: opts.point, head: !!opts.head, cal: opts.cal, by: opts.by || null,
      dirX: dx, dirZ: dz, fromX, fromZ, critical: crit });
    return !!W && (W.outcome === "down" || W.outcome === "dead");
  };
  CBZ.shootPlayer = function (dmg, fromX, fromZ, opts) {
    return CBZ.hurtPlayer(dmg, fromX, fromZ, Object.assign({ weapon: "gun" }, opts || {}));
  };

  /* CBZ.vitals' seam for the player in the pen: it says when you go down
     (out cold, down bleeding, blood collapse) and when you die; this file
     owns what that LOOKS like here (the floor, the carry, the loss card). */
  const CAUSE_LINE = { "bled out": "Bled out", stabbed: "Stabbed", shot: "Shot", headshot: "Shot",
    "beaten to death": "Beaten to death", beaten: "Beaten to death" };
  if (CBZ.vitals && CBZ.vitals.on) {
    CBZ.vitals.on("escape", {
      playerDown(on, o) {
        if (!on || player.dead || down || esc) return;          // the carry stands you up, not the clock
        o = o || {};
        const by = o.by && o.by !== player ? o.by : null;
        if (player.hp == null || player.hp > 0) player.hp = Math.min(player.hp == null ? 100 : player.hp, 1);
        goDown(o.conscious ? "shank" : "fist", { by });
      },
      playerKill(cause, o) {
        die(CAUSE_LINE[cause] || "Dead", o || {});
      },
      // the pocket roll: a real Bandage from the infirmary / Doc Mercer
      rolls() { return (g.inventory && g.inventory.Bandage) | 0; },
      useRoll(n) {
        if (!CBZ.econ) return;
        if (n > 0) CBZ.econ.addItem("Bandage", n);
        else for (let i = 0; i < -n; i++) CBZ.econ.takeItem("Bandage");
      },
    });
  }
  function goDown(weapon, opts) {
    law("downs");
    cancelArrest();
    haulEnd(true);
    if (CBZ.killstreakBreak) CBZ.killstreakBreak("Down");
    down = { t: 0, weapon, by: opts.by || null, wakeHp: weapon === "fist" ? 55 : 30 };
    player.stun = Math.max(player.stun || 0, 1);
    setCaptureState("downed", 60);
    // a thief who put you down goes through your pockets
    const by = opts.by;
    if (by && (by.role === "thief" || (by.data && by.data.role === "thief")) && (g.cigs || 0) > 0 && CBZ.econ && CBZ.econ.addCigs) {
      const n = Math.min(g.cigs || 0, 1 + ((Math.random() * 3) | 0));
      CBZ.econ.addCigs(-n);
      by.cigs = (by.cigs || 0) + n;
    }
    if (CBZ.breakUpFight) { try { CBZ.breakUpFight(player.pos.x, player.pos.z, { reason: "down", starter: null }); } catch (e) {} }
  }
  function downTick(dt) {
    const d = down;
    d.t += dt;
    player.stun = Math.max(player.stun || 0, 0.5);
    player.captureState = "downed"; player.captureT = 60;
    const ch = CBZ.playerChar;
    ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, Math.PI / 2, 10, dt);
    if (d.t < DOWN_BEAT) return;
    // hauled off the floor: to the infirmary, or in cuffs if this was an escape
    const escapeCap = !!(CBZ.prisonEscapeCapture && CBZ.prisonEscapeCapture());
    const wake = d.wakeHp;
    // the screws have hands on you: pressure on the wound, and whatever kept
    // you on the floor (out cold, the blood) is theirs to carry now
    if (CBZ.vitals) CBZ.vitals.reset(player);
    down = null;
    if (escapeCap) { player.hp = wake; law("cuffs"); startEscort(null, { kind: "transfer", tased: true }); }
    else startEscort(null, { kind: "medical", wakeHp: wake, tased: true });
  }
  function die(cause, opts) {
    if (player.dead) return;
    law("deaths");
    down = null;
    cancelArrest();
    if (esc) endEscort();
    player.hp = 0;
    player.dead = true;
    g._deathLine = cause || "Dead";
    deathT = 2.6;                       // you see it happen before the card
    if (CBZ.shake) CBZ.shake(0.9);
    flash();
  }

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
      if (!gd || !gd.group || gd.kind === "warden" || gd.dead || gd.ko > 0 || gd.asleep || gd.bribed > 0 || gd.tied || gd._escort) continue;
      const dx = player.pos.x - gd.group.position.x, dz = player.pos.z - gd.group.position.z;
      out.push({ gd, d2: dx * dx + dz * dz });
    }
    out.sort((a, b) => a.d2 - b.d2);
    const picked = out.slice(0, 2).filter((o, i) => i === 0 || o.d2 < ESC.SECOND_R * ESC.SECOND_R);
    return picked.map((o) => o.gd);
  }
  // the warden never walks a man to the hole himself: he orders it (prisonwarden.js)
  function screwUsable(gd) { return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && gd.kind !== "warden"); }
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
    // a screw holding the man (CBZ.verbs) is walked by the verb, not here
    if (CBZ.verbs && CBZ.verbs.sessionOf && CBZ.verbs.sessionOf(gd)) return Math.hypot(tx - gd.group.position.x, tz - gd.group.position.z);
    const gp = gd.group.position;
    const dx = tx - gp.x, dz = tz - gp.z, d = Math.hypot(dx, dz);
    const sp = (gd.speed || 3) * (run ? 1.7 : 1.15);
    let step = Math.max(0, Math.min(d - stop, sp * dt));
    const M = CBZ.moves;
    if (M && M.motor && M.step) {
      // THE ONE LOCOMOTION LAYER: arrival, turn rate, the stride the legs get
      const ox = gp.x, oz = gp.z;
      const m = M.motor(gd);
      M.step(m, gp, gd.group.rotation.y, tx, tz, { speed: sp, stop: stop, lod: 1 }, dt);
      step = Math.hypot(gp.x - ox, gp.z - oz);
    } else if (step > 0 && d > 1e-4) { gp.x += dx / d * step; gp.z += dz / d * step; }
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
    if (CBZ.verbs && CBZ.verbs.setCuffs) CBZ.verbs.setCuffs(CBZ.verbs.playerActor(), !!on);
  }
  /* THE BODIES ARE CBZ.verbs' AND STRIKE'S. The screw's hands on you are the
     shared verbs (tackle, cuff, escort, carry: systems/verbs.js); you on the
     floor is the real fall (entities/meleeposes.js), held down until the lift,
     not the old whole-group rotation.z roll. */
  const VB = () => CBZ.verbs || null;
  const pa = () => (VB() ? VB().playerActor() : player);
  function holdDown(dt, side) {
    const ch = CBZ.playerChar, MP = CBZ.meleePoses;
    if (MP && MP.startFall && ch) {
      if (!(ch.fall && ch.fall.on)) MP.startFall(ch, { variant: "back", side: side, ko: true, hold: true });
      ch.fall.hold = true;
      if (ch.group.rotation.z) ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, 0, 10, dt);
      return;
    }
    ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, side * Math.PI / 2, 10, dt);   // no melee poses loaded
  }
  function standUp() {
    const ch = CBZ.playerChar, MP = CBZ.meleePoses;
    if (MP && MP.getUp && ch && ch.fall && ch.fall.on) MP.getUp(ch);
  }
  function dropHolds(e) {
    if (!e) return;
    for (const k of ["cuffS", "escS", "carryS"]) { const S = e[k]; if (S && !S.done) S.cancel(); e[k] = null; }
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

  // THE INFIRMARY (world/southblock.js: x[26,42] z[88,104], door W at z 96,
  // beds at x 30/38, z 92/100, Doc Mercer at (33,96)). You come to beside the
  // first ward bed, on your side, and get up.
  const INFIRMARY = { x0: 26, x1: 42, z0: 88, z1: 104, wakeX: 31.9, wakeZ: 92.2, docX: 33, docZ: 96 };
  function landInInfirmary() {
    player.pos.set(INFIRMARY.wakeX, 0, INFIRMARY.wakeZ);
    player.vy = 0;
    const ch = CBZ.playerChar;
    if (ch && ch.group) {
      ch.group.position.copy(player.pos);
      ch.group.rotation.y = -Math.PI / 2;          // facing the bed
      const MP = CBZ.meleePoses;
      if (MP && MP.startFall) {
        // still down: the real fall's lying key, held until the wake
        const f = MP.startFall(ch, { variant: "back", side: 1, ko: true, hold: true });
        f.t = MP.fallTimes("back").fall; f.phase = "down";
        ch.group.rotation.z = 0;
      } else ch.group.rotation.z = Math.PI / 2;    // still on his side
    }
    if (CBZ.cam) CBZ.cam.yaw = Math.PI / 2;
  }
  let docRef = null;
  function doc() {
    if (docRef && !docRef.dead && docRef.group) return docRef;
    docRef = null;
    for (const n of CBZ.npcs || []) if (n && n.data && n.data.name === "Doc Mercer") { docRef = n; break; }
    return docRef;
  }
  function inInfirmary(x, z) { return x > INFIRMARY.x0 && x < INFIRMARY.x1 && z > INFIRMARY.z0 && z < INFIRMARY.z1; }

  // EVERY haul ends here (haulToCell routes through it), so the cuffs are
  // always ON before applyStrike can ever say TRANSFERRED. opts.kind:
  // "hole" | "transfer" | "medical" (see haulToCell); opts.lead = the screw
  // who made the arrest; opts.tased = no drive-stun on the floor.
  function startEscort(msg, opts) {
    if (esc) return;
    opts = opts || {};
    const kind = opts.kind || (opts.strike === false ? "medical" : "hole");
    if (CBZ.killstreakBreak) CBZ.killstreakBreak(kind === "medical" ? "Down" : "Cuffed");
    cancelArrest();
    down = null;
    CBZ.playerChar.cuffed = false;
    player.stun = 2.2;
    // non-normal for the whole scene; escortTick keeps it alive
    setCaptureState(kind === "medical" ? "downed" : "cuffed", 60);
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd._chase = null; });
    if (opts.lead) opts.lead._escort = false;
    const screws = pickScrews();
    if (opts.lead && screwUsable(opts.lead) && screws[0] !== opts.lead) {
      const k = screws.indexOf(opts.lead);
      if (k >= 0) screws.splice(k, 1);
      screws.unshift(opts.lead);
      if (screws.length > 2) screws.length = 2;
    }
    for (const gd of screws) { gd._escort = true; gd.approach = null; }
    let cx = Math.sin(CBZ.playerChar.group.rotation.y + Math.PI * 0.5), cz = Math.cos(CBZ.playerChar.group.rotation.y + Math.PI * 0.5);
    if (screws[0]) {
      const ax = player.pos.x - screws[0].group.position.x, az = player.pos.z - screws[0].group.position.z, al = Math.hypot(ax, az);
      if (al > 0.5) { cx = ax / al; cz = az / al; }
    }
    esc = {
      cam: false, cx, cz,
      phase: "down", t: 0, total: 0,
      kind, severity: opts.severity || 2, wakeHp: opts.wakeHp || 55,
      strike: kind === "transfer",
      // a man tased on his feet, or one who lay down when told, is not tased
      // again on the floor; a medical carry is never tased
      tased: !!opts.tased || kind === "medical",
      tied: false, stall: 0,
      screws, tx: 0, tz: 0, hx: 0, hz: 1,
    };
  }
  // tear the scene down without landing anything: a transfer card, a new run,
  // a death, leaving play. Safe from anywhere, any number of times.
  function endEscort() {
    if (!esc) return;
    const e0 = esc;
    dropHolds(e0);
    camDrop();
    releaseScrews();
    esc = null;
    tiesOn(false);
    standUp();
    player.subdue = 0; player.stun = 0;
    setCaptureState("normal", 0);
    // a man waking in the infirmary gets up off his side (the normal-state
    // damp below stands him); everyone else is already on his feet
    if (!(e0 && e0.kind === "medical")) CBZ.playerChar.group.rotation.z = 0;
    if (fadeEl) fadeEl.style.opacity = "0";
  }
  function escortTick(dt) {
    const e = esc, ch = CBZ.playerChar, P = player;
    e.t += dt; e.total += dt;
    // nothing else may move, hit or grab you mid-scene
    P.stun = Math.max(P.stun || 0, 0.5); g.invuln = Math.max(g.invuln || 0, 0.6);
    P.captureT = 60; P.captureState = e.kind === "medical" ? "downed" : "cuffed";
    // a screw shot off the scene drops out of it; the man is still cuffed
    for (let i = e.screws.length - 1; i >= 0; i--) if (!screwUsable(e.screws[i])) { e.screws[i]._escort = false; e.screws.splice(i, 1); }
    const lead = e.screws[0], second = e.screws[1];
    const px = P.pos.x, pz = P.pos.z;
    // down on whichever side the hit put you on (a tackle lands you on the other)
    const side = ch.group.rotation.z < -0.05 ? -1 : 1;
    const lie = () => holdDown(dt, side);
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
        e.phase = e.kind === "medical" ? "carry" : (!e.tased && lead) ? "tase" : "lift"; e.t = 0;
      }
      return;
    }
    // THE CARRY (downed / starving): two screws get you off the floor and the
    // lens goes dark on the way to the infirmary. No cuffs, no strike.
    if (e.phase === "carry") {
      camGround(px, P.pos.y, pz);
      // the lead screw gets you up over his shoulder (CBZ.verbs.carry) and
      // walks off with you toward the infirmary; the lens goes dark on the way
      if (!e.carryS && !e.carryTried && lead && VB()) { e.carryTried = true; e.carryS = VB().carry(lead, pa(), { far: true }); }
      const S = e.carryS && !e.carryS.done ? e.carryS : null;
      if (!S) lie();
      if (S && S.phase === "hold") VB().walk(S, S, INFIRMARY.x0, (INFIRMARY.z0 + INFIRMARY.z1) / 2, 1.2, dt);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      const fadeAt = S ? 2.6 : 1.4;
      if (e.t >= fadeAt && fadeEl) fadeEl.style.opacity = Math.min(1, (e.t - fadeAt) / ESC.FADE).toFixed(2);
      if (e.t < fadeAt + ESC.FADE) return;
      dropHolds(e);
      camDrop(); releaseScrews();
      landInInfirmary();
      P.hp = Math.max(P.hp || 0, e.wakeHp || 55);
      lawGrace(12);
      g.invuln = Math.max(g.invuln || 0, 4);
      e.phase = "wake"; e.t = 0;
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
      if (e.t >= ESC.TASE) { e.phase = "lift"; e.t = 0; }
      return;
    }
    // UP, THEN THE CUFFS: the screws get you onto your feet, the lead turns
    // you round, both wrists behind your back and the ratchet (CBZ.verbs.cuff)
    if (e.phase === "lift") {
      camGround(px, P.pos.y, pz);
      standUp();
      if (ch.group.rotation.z) ch.group.rotation.z = CBZ.damp(ch.group.rotation.z, 0, 7, dt);
      if (ch.body && ch.body.rotation.x) ch.body.rotation.x = CBZ.damp(ch.body.rotation.x, 0, 9, dt);
      if (lead) screwStep(lead, px, pz, ESC.REACH * 0.75, px, pz, false, dt);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      // on his feet first (the get-up plays out), then the cuffs
      if ((e.t >= ESC.LIFT && !(ch.fall && ch.fall.on)) || e.t >= ESC.LIFT + 2.5) {
        ch.group.rotation.z = 0;
        const tied = function () {
          if (e.tied) return;
          e.tied = true;
          tiesOn(true);
          if (lead && CBZ.guardLine) { try { CBZ.guardLine(lead, "cuff", { force: true }); } catch (er) {} }
        };
        e.cuffS = lead && VB() ? VB().cuff(lead, pa(), { far: true, onOutcome: function (S, k) { if (k === "cuffed") tied(); } }) : null;
        if (!e.cuffS) { tied(); if (CBZ.sfx) { try { CBZ.sfx("reload"); } catch (er) {} } }
        e.phase = "cuff"; e.t = 0;
      }
      return;
    }
    if (e.phase === "cuff") {
      camGround(px, P.pos.y, pz);
      if (second) { const f = flank(px, pz, 1); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
      // HE TORE LOOSE before the cuffs closed (verbs.js struggle): the scene is
      // over, you are on your feet with a screw staggering off you, and it is
      // a chase again
      if (e.cuffS && e.cuffS.done && !e.tied && e.cuffS.result && e.cuffS.result.outcome === "escaped") {
        const gd = lead;
        endEscort();
        if (gd) { gd.capCD = 2.5; gd.hunt = Math.max(gd.hunt || 0, 4); }
        return;
      }
      const busy = e.cuffS && !e.cuffS.done;
      if (busy && e.t < ESC.CUFF + 2.5) return;
      if (!e.tied) { e.tied = true; tiesOn(true); }
      dropHolds(e);
      const w = walkTarget();
      e.tx = w.x; e.tz = w.z;
      const dx = e.tx - px, dz = e.tz - pz, d = Math.hypot(dx, dz);
      if (d > 0.01) { e.hx = dx / d; e.hz = dz / d; }
      else { e.hx = Math.sin(ch.group.rotation.y); e.hz = Math.cos(ch.group.rotation.y); }
      // the march: a hand on your arm, one on the ties (CBZ.verbs.escort)
      e.escS = lead && VB() ? VB().escort(lead, pa(), { far: true }) : null;
      if (CBZ.cineCam && e.cam) CBZ.cineCam.snap = true;      // CUT to the walk
      e.phase = "walk"; e.t = 0;
      return;
    }
    // ---- walk / fade: the march, with the blackout riding on the end of it
    const marching = e.phase === "walk" || e.phase === "fade";
    if (marching) {
      const dx = e.tx - px, dz = e.tz - pz, d = Math.hypot(dx, dz);
      // the legs follow the GROUND COVERED, never the intent: a wall between
      // you and the door must not make a cuffed man jog on the spot
      let moved = 0;
      const held = e.escS && !e.escS.done && e.phase === "walk" ? e.escS : null;
      if (d > 0.6) {
        e.hx = dx / d; e.hz = dz / d;
        const step = Math.min(d - 0.5, ESC.WALK_SPD * dt);
        const ox = P.pos.x, oz = P.pos.z;
        if (held) {
          // the screw walks behind you; you go where his hands send you
          // (you are placed at the end of this frame: measure last frame's step)
          const lp = e.lastP || (e.lastP = { x: ox, z: oz });
          VB().walk(held, held, e.tx - e.hx * 0.9, e.tz - e.hz * 0.9, ESC.WALK_SPD, dt, Math.atan2(e.hx, e.hz));
          moved = Math.hypot(ox - lp.x, oz - lp.z); lp.x = ox; lp.z = oz;
        } else {
          P.pos.x += e.hx * step; P.pos.z += e.hz * step; P.vy = 0;
          if (CBZ.collide) { try { CBZ.collide(P.pos, BODY_R, 0, 1.7); } catch (er) {} }
          moved = Math.hypot(P.pos.x - ox, P.pos.z - oz);
        }
        e.stall = moved < 0.25 * step ? e.stall + dt : 0;
      }
      if (!held) {
        ch.group.position.copy(P.pos);
        ch.group.rotation.y = lerpAng(ch.group.rotation.y, Math.atan2(e.hx, e.hz), 1 - Math.pow(0.002, dt));
      }
      ch.cuffed = true;
      if (CBZ.animChar) CBZ.animChar(ch, moved / Math.max(dt, 1e-4), dt);
      camWalk(P.pos.x, P.pos.y, P.pos.z, e.hx, e.hz);
      // the lens eases round behind the march — slowly, never a locked camera
      if (CBZ.cam) CBZ.cam.yaw = lerpAng(CBZ.cam.yaw, Math.atan2(e.hx, e.hz) + Math.PI, 1 - Math.pow(0.55, dt));
      const back = (CBZ.cityRestrain && CBZ.cityRestrain.ESCORT_D) || 0.9;
      if (lead && !held) screwStep(lead, P.pos.x - e.hx * (back + 0.55), P.pos.z - e.hz * (back + 0.55), 0.02, P.pos.x + e.hx, P.pos.z + e.hz, false, dt);
      if (second) screwStep(second, P.pos.x - e.hx * 0.6 - e.hz * 1.0, P.pos.z - e.hz * 0.6 + e.hx * 1.0, 0.02, P.pos.x + e.hx, P.pos.z + e.hz, false, dt);
      if (e.phase === "walk") {
        // arrived, walked long enough, or walled off: the rest is off-screen
        if ((d <= 0.6 && e.t >= ESC.WALK_MIN) || e.t >= ESC.WALK_MAX || (e.stall > 0.7 && e.t >= 1.0)) { e.phase = "fade"; e.t = 0; }
        return;
      }
      // fade
      if (fadeEl) fadeEl.style.opacity = Math.min(1, e.t / ESC.FADE).toFixed(2);
      if (e.t < ESC.FADE) return;
      // ---- THE HAUL SITE: your own cell door. An ESCAPE capture is the one
      // place a strike (and a transfer) can land, cuffed by construction; any
      // other cuffing is the hole, which is time, not a strike.
      dropHolds(e);
      camDrop(); releaseScrews();
      if (!landInCell()) { P.pos.copy(CBZ.SPAWN); P.vy = 0; ch.group.position.copy(P.pos); }
      g.detection = 0; g.invuln = 2.0;
      if (e.kind === "transfer") {
        g.caughtCount++;
        applyStrike();                            // a transfer ends the scene (and the run) in here
        if (!esc) return;
      } else holeSentence(e.severity);
      holeRelease = true;
      if (confineT > 0) sealPlayerCell();
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

  /* ============================================================
     THE ARREST (CBZ.tryCapture). guards.js calls this every frame a hunting
     screw has eyes on you inside ORDER_R, and walks him to the stand-off
     distance it returns.

     Owner, 2026-09-28: "when I get handcuffed it's almost like a cutscene...
     I'm getting handcuffed too easily." The haul used to take the camera,
     throw you on the floor and tase you AFTER you had complied, and the
     tackle always landed. Now it is systems/arrest.js's contest, the same as
     the city's, and nothing takes your controls until hands are on you:

       ORDER   he stops ~2 m off and says it once ("On the ground! Now!").
               You have WINDOW seconds. Stop moving (under COMPLY_SPD) or
               crouch = comply. Keep running away fast, or swing = resist.
       comply  no offense on file, or a minor one: a PAT-DOWN (his hands on
               you, CBZ.verbs.frisk) and a warning. NO cuffs. A real offense:
               he walks up and CUFFS you (CBZ.arrest.take): one wrist, then
               the other, and you can still fight it.
       resist  the TASER (arrest.js: it can MISS, and he has to reload). A hit
               drops you and he cuffs you while you are jelly. A miss, or up
               and running again: the TACKLE, a committed lunge from arm's
               reach that can miss and put HIM on the floor. A man swinging is
               tased, never tackled.
       cuffed  the ESCORT: his hand on your arm, walked to your cell door and
               in. Drop your weight, pull away (a lone screw can lose you: you
               are loose in cuffs and it is a real offense), a crewmate can
               jump him. Inside: uncuffed, the door racks shut, the hole.
     Only an escape capture goes up a tier (applyStrike); every other cuffing
     is the hole (holeSentence). No one re-grabs you during the grace.
     A wing backs its screw up: every other guard in reach of you is another
     pair of hands on the struggle (arrest.js backup).

     THE ORDER IS DECIDED BY CBZ.brain.authority (systems/brain.js).
     ============================================================ */
  const ARREST = {
    ORDER_R: 4.2,        // m: where the order is given (guards.js reads it)
    STANDOFF: 1.9,       // m: where he stands while you decide
    WINDOW: 2.2,         // s: the comply window
    COMPLY_SPD: 0.6,     // m/s: under this you are standing still
    COMPLY_HOLD: 0.6,    // s of standing still that reads as "complied"
    FLEE_SPD: 2.2,       // m/s: over this, moving away, is running
    FLEE_HOLD: 0.55,     // s of running that reads as "resisting"
    TASE_R: 5.5,         // m: the taser's reach
    LUNGE_R: 2.5,        // m: the tackle is a dive from here, not a sprint from across the yard
    AFTER_TASE: 3.0,     // s after the probes wear off to see what you do
    LOSE_R: 15,          // m: the order is void, it is a chase again
    WALK_MAX: 28,        // s: a walk to a cell that long is finished off-screen (the elevator law)
  };
  let arrest = null;
  let seizedBy = null;
  let holeRelease = false;          // the next confinement end is a hole release (grace)
  // the player's measured ground speed (not his input): what a screw sees
  let spdPX = null, spdPZ = null, pSpd = 0;
  function trackSpeed(dt) {
    const px = player.pos.x, pz = player.pos.z;
    if (spdPX != null && dt > 0) {
      const v = Math.min(12, Math.hypot(px - spdPX, pz - spdPZ) / dt);
      pSpd += (v - pSpd) * Math.min(1, dt * 10);
    }
    spdPX = px; spdPZ = pz;
  }
  function swungSince(t0) { return ((g._lawSwingT != null ? g._lawSwingT : -1e9)) > t0; }
  function arrestGuardOk(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !(gd.bribed > 0) &&
      !gd.tied && gd.intimidMode !== "scared");
  }
  function gdDist(gd) { return Math.hypot(player.pos.x - gd.group.position.x, player.pos.z - gd.group.position.z); }
  const AR = () => CBZ.arrest || null;
  // the ladder's case on this screw is over (the player's scene carries on here)
  function endLadder(gd) {
    if (!gd) return;
    const au = CBZ.brain && CBZ.brain.authority;
    if (au) { try { au.cancel(gd); } catch (e) {} }
    gd._brainNoMove = false;
  }
  function cancelArrest(chaseOn) {
    if (!arrest) return;
    const gd = arrest.gd;
    endLadder(gd);
    if (arrest.take && !arrest.take.done) { try { arrest.take.cancel(); } catch (e) {} }
    if (gd) {
      gd._escort = false;
      if (gd.char) gd.char.crouch = false;
      gd.capCD = chaseOn ? 0.4 : Math.max(gd.capCD || 0, 2.5);
      if (chaseOn && arrestGuardOk(gd)) gd.hunt = Math.max(gd.hunt || 0, 4);
    }
    arrest = null;
  }
  CBZ.prisonArrestPhase = function () { return arrest ? arrest.phase : null; };
  CBZ.lawOrderRange = ARREST.ORDER_R;

  function startArrest(gd) {
    const off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
    arrest = { gd, phase: "order", t: 0, t0: clock(), comply: 0, flee: 0, lastD: gdDist(gd), after: 0, taseCD: 0, tackles: 0 };
    gd.hunt = Math.max(gd.hunt || 0, 4);
    gd.capCD = 0;
    law("orders");
    // a man who already ran from an order does not get a second one
    if (off && off.resisted) { resist("again"); return; }
    const au = CBZ.brain && CBZ.brain.authority;
    if (au) {
      // guards.js walks him (the hunt branch stands him off at STANDOFF); the
      // ladder only DECIDES here, so its own steps must not move him too
      gd._brainNoMove = true;
      LADDER.orderRange = ARREST.ORDER_R; LADDER.cuffRange = ESC.REACH + 0.4; LADDER.patience = ARREST.WINDOW;
      au.begin(gd, player, off ? off.kind : "stop", LADDER);   // it says the order itself
    } else if (CBZ.guardLine) CBZ.guardLine(gd, "order", { force: true });
  }
  const LADDER = { roe: "nonlethal", skipWarn: true, warnRange: 30, orderRange: 4.2, cuffRange: 1.8, patience: 2.2 };
  const _sus = { speed: 0, handsUp: false, kneeling: false, prone: false, armed: false, aiming: false, attacking: false, fled: false, seen: true, dist: 0 };
  function complied() {
    const a = arrest, gd = a.gd;
    endLadder(gd);
    law("complied");
    const off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
    if (!off || off.severity <= 1) {
      // THE PAT-DOWN: his hands on you (CBZ.verbs.frisk), a word, he walks off
      law("warnings");
      arrest = null;
      const V = VB();
      const S = V && V.frisk ? V.frisk(gd, pa(), { far: true, onEnd: function () { gd._escort = false; } }) : null;
      if (S) gd._escort = true;          // the verb walks him to you and puts his hands on you
      else player.stun = Math.max(player.stun || 0, 1.1);
      if (CBZ.guardLine) CBZ.guardLine(gd, "warned", { force: true });
      lawGrace(60);
      gd.capCD = 60;
      gd.alert = 0.8;
      return;
    }
    cuffs(false);
  }
  // RESISTING: the record says so, then the taser (it can miss)
  function resist(why) {
    const a = arrest, gd = a.gd;
    endLadder(gd);
    law("resisted");
    let off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
    // running from an order is an offense of its own: serious enough for the hole
    if (!off && CBZ.prisonOffense) off = CBZ.prisonOffense("minor", { severity: 2, seenBy: gd });
    if (off) { off.resisted = true; off.severity = Math.max(off.severity, 2); }
    if (gdDist(gd) > ARREST.TASE_R) { cancelArrest(true); return; }
    a.phase = "chase"; a.t = 0; a.after = 0;
    gd._escort = false;
    tase();
  }
  function tase() {
    const a = arrest, gd = a.gd;
    law("tases");
    const r = AR() && AR().tase ? AR().tase(gd) : { hit: true };
    flash();
    if (!AR()) { player.stun = 1.85; }
    if (r.hit) {
      a.phase = "tased"; a.t = 0; a.after = 0; a.tasedAt = clock();
      // (the rig's own knockdown is the fall; "subdued" keeps the yard off you)
      setCaptureState(AR() ? "subdued" : "tased", 1.35);
      gd._escort = true;                 // this file walks him in to the body now
    } else {
      // the probes went wide: he reloads, and it is a chase
      a.phase = "chase"; a.taseCD = AR() ? AR().TASE.RELOAD : 2.6;
      gd._escort = false;
    }
  }
  // THE TACKLE: the committed lunge (verbs.js + arrest.js). Pinned = the cuffs,
  // missed = he is on the floor and you have a head start, broke it = loose.
  function tackle() {
    const a = arrest, gd = a.gd;
    law("tackles");
    a.phase = "tackle"; a.t = 0; a.tackles++;
    gd._escort = true;                   // the verb has his body
    const V = VB();
    if (V && V.tackle && !seizedBy) {
      const S = V.tackle(gd, pa(), {
        far: true,
        onEnd: function (S) {
          seizedBy = null;
          const k = S.result && S.result.outcome;
          if (k === "open" || k === "wall") {
            if (!arrest) arrest = { gd, phase: "tackle", t: 0, taseCD: 0, tackles: 1 };
            if (CBZ.sfx) { try { CBZ.sfx("punch"); } catch (e) {} }
            if (CBZ.shake) CBZ.shake(0.7);
            if (AR()) AR().subdue(2.2, "pinned");
            // he stays on you and cuffs you on the floor
            if (!V.cuffDown && V.getUp) { try { V.getUp(pa()); } catch (e) {} }
            cuffs(true, { pinned: true });
            return;
          }
          // missed (he is on the floor), shrugged off, torn loose: a chase
          if (arrest && arrest.gd === gd) { gd._escort = false; arrest.phase = "chase"; arrest.t = 0; arrest.taseCD = Math.max(arrest.taseCD || 0, 0.8); }
          if (k === "missed" || k === "shrugged") { if (arrest && arrest.gd === gd) cancelArrest(true); }
          setCaptureState("normal", 0);
        },
      });
      if (S) { seizedBy = S; return; }
    }
    // no lunge from here (out of reach): keep after him
    a.phase = "chase"; gd._escort = false;
  }

  // ---- THE CUFFS AND THE WALK (CBZ.arrest.take) ----------------------------
  // haul = the take and where it walks you: your door mouth, then your bunk.
  let haul = null;
  function cellGoals() {
    const goals = [];
    const c = beatOn() ? playerCell() : null;
    if (c && isFinite(+c.doorX) && isFinite(+c.doorZ)) goals.push({ x: +c.doorX, z: +c.doorZ, door: true });
    const cb = CBZ.cellblock;
    let inside = null;
    if (c && cb && typeof cb.playerSpawn === "function") { try { inside = cb.playerSpawn(); } catch (e) { inside = null; } }
    if (inside && isFinite(+inside.x) && isFinite(+inside.z)) goals.push({ x: +inside.x, z: +inside.z, inside: true });
    else if (c && isFinite(+c.x) && isFinite(+c.z)) goals.push({ x: +c.x, z: +c.z, inside: true });
    if (!goals.length && CBZ.SPAWN) goals.push({ x: CBZ.SPAWN.x, z: CBZ.SPAWN.z, inside: true });
    return goals;
  }
  function crewOf() {
    const out = [];
    const mine = player.gang;
    if (mine == null) return out;
    for (const n of CBZ.npcs || []) if (n && !n.dead && n.gang === mine) out.push(n);
    return out;
  }
  // down on the floor or on your knees (crouched) with your hands empty:
  // the only man the screw cuffs (systems/arrest.js's rule)
  function gaveUp() {
    const A = AR();
    if (A && A.downState && A.downState(pa())) return true;
    return !!player.crouch || !!(CBZ.playerChar && (CBZ.playerChar.handsUp || CBZ.playerChar.surrender));
  }
  function cuffs(rough, o) {
    o = o || {};
    const a = arrest, gd = a && a.gd;
    endLadder(gd);
    const off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
    const escapeCap = !!(CBZ.prisonEscapeCapture && CBZ.prisonEscapeCapture());
    const kind = escapeCap ? "transfer" : "hole";
    const severity = Math.max(2, (off && off.severity) || 2) + (rough ? 0.5 : 0);
    const A = AR();
    if (!A || !A.take || !gd) {
      // no arrest library: the old haul scene
      arrest = null;
      if (gd) gd._escort = false;
      law("cuffs");
      startEscort(null, { kind, severity, lead: gd, tased: true });
      return;
    }
    if (a) { a.phase = "take"; a.t = 0; }
    gd._escort = true;                   // guards.js leaves him to the verbs
    if (o.subdued && A.subdue) A.subdue(2.6, "tased");   // he keeps the trigger down while he cuffs you
    const h = A.take(gd, {
      pinned: !!o.pinned, walk: ESC.WALK_SPD,
      crew: crewOf,
      to: function () { return haul && haul.goals.length ? haul.goals[0] : null; },
      arrive: 0.55,
      onCuffed: function () {
        law("cuffs");
        if (CBZ.guardLine) { try { CBZ.guardLine(gd, "cuff", { force: true }); } catch (e) {} }
        if (CBZ.killstreakBreak) CBZ.killstreakBreak("Cuffed");
        haul = { h: h, gd: gd, kind: kind, severity: severity, goals: cellGoals(), t: 0, fade: -1 };
        arrest = null;
        g.detection = Math.min(g.detection || 0, 40);
        for (const other of CBZ.guards || []) { if (other !== gd) { other.hunt = 0; other._chase = null; } }
      },
      onEscaped: function () {
        // tore out of his hands before the cuffs closed: resisting, and he goes for the taser
        if (CBZ.prisonOffense) { try { const of = CBZ.prisonOffense("assault", { severity: 3, seenBy: gd }); if (of) of.resisted = true; } catch (e) {} }
        if (CBZ.addHeat) CBZ.addHeat(18);
        if (arrest && arrest.gd === gd) { gd._escort = false; arrest.phase = "chase"; arrest.t = 0; arrest.taseCD = 0.9; }
        setCaptureState("normal", 0);
      },
      onMissed: function () {
        // you walked off while he reached: that is not complying
        if (arrest && arrest.gd === gd) { gd._escort = false; resist("walked"); }
      },
      onArrived: function (hh) { haulArrived(hh); },
      onStall: function () { if (haul) haul.stall = (haul.stall || 0) + 1; },
      onBroke: function (hh, why) {
        // OUT OF HIS HANDS, STILL IN CUFFS: a real offense, the block comes down
        haulEnd(false);
        gd._escort = false; gd.capCD = 0; gd.hunt = Math.max(gd.hunt || 0, 8);
        if (CBZ.prisonOffense) { try { const of = CBZ.prisonOffense(escapeCap ? "escape" : "assault", { severity: escapeCap ? 4 : 3, seenBy: gd }); if (of) of.resisted = true; } catch (e) {} }
        if (CBZ.addHeat) CBZ.addHeat(30);
        for (const other of CBZ.guards || []) {
          if (!arrestGuardOk(other)) continue;
          const d = Math.hypot(player.pos.x - other.group.position.x, player.pos.z - other.group.position.z);
          if (d < 30) { other.hunt = Math.max(other.hunt || 0, 6); other.capCD = 0; }
        }
      },
    });
    if (!h) {
      arrest = null; gd._escort = false;
      law("cuffs");
      startEscort(null, { kind, severity, lead: gd, tased: true });
      return;
    }
    if (a) a.take = h;
    setCaptureState("normal", 0);
  }
  // reached a mark: the door mouth, then inside. Inside: the cuffs come off
  // and the door racks shut behind him.
  function haulArrived(hh) {
    const H = haul;
    if (!H || H.h !== hh) return;
    const at = H.goals.shift();
    if (H.goals.length && !(at && at.inside)) { hh.resume(); return; }
    haulLand(true);
  }
  // the end of the walk. walked = he got you all the way in (no cut)
  function haulLand(walked) {
    const H = haul;
    if (!H) return;
    const gd = H.gd;
    if (H.h && !H.h.done) H.h.finish();
    if (!walked) {
      if (!landInCell()) { player.pos.copy(CBZ.SPAWN); player.vy = 0; CBZ.playerChar.group.position.copy(player.pos); }
    }
    g.detection = 0; g.invuln = Math.max(g.invuln || 0, 1.5);
    haul = null;
    setCaptureState("normal", 0);
    if (gd) { gd._escort = false; gd.capCD = 3.0; gd.hunt = 0; gd._chase = null; }
    if (H.kind === "transfer") {
      g.caughtCount++;
      applyStrike();                            // a transfer ends the scene (and the run) in here
      return;
    }
    // out of the cuffs, and the door
    tiesOn(false);
    if (CBZ.sfx) { try { CBZ.sfx("reload"); } catch (e) {} }
    holeSentence(H.severity);
    holeRelease = true;
    if (confineT > 0) sealPlayerCell();
  }
  // tear the haul down without landing it (you broke loose, a new run)
  function haulEnd(dropTake) {
    const H = haul;
    haul = null;
    if (H) setCaptureState("normal", 0);
    if (fadeEl && H && H.fade >= 0) fadeEl.style.opacity = "0";
    if (H && H.gd) H.gd._escort = false;
    if (dropTake && H && H.h && !H.h.done) H.h.cancel();
  }
  function haulTick(dt) {
    const H = haul;
    if (!H) return;
    H.t += dt;
    if (!H.gd || H.gd.dead) { if (H.h && H.h.done) haulEnd(false); return; }
    // in custody: the yard's detectors and the schedule leave you alone
    // ("escorted" is not a prone state: your body is the verb's)
    player.captureState = "escorted"; player.captureT = 0.5;
    // A WALK THAT WILL NOT END (a far cell, a door he cannot open, a man who
    // has made himself dead weight for a long time) is finished off-screen:
    // the only cut in the whole arrest, a second of black at the end of it
    if (H.fade < 0 && (H.t > ARREST.WALK_MAX || (H.stall | 0) >= 1)) H.fade = 0;
    if (H.fade >= 0) {
      H.fade += dt;
      if (fadeEl) fadeEl.style.opacity = Math.min(1, H.fade / ESC.FADE).toFixed(2);
      if (H.fade >= ESC.FADE) {
        haulLand(false);
        if (fadeEl) fadeEl.style.opacity = "0";
      }
    }
  }
  CBZ.prisonHaul = function () { return haul ? { phase: haul.h ? haul.h.phase : null, goals: haul.goals.length, t: haul.t } : null; };

  function arrestTick(dt) {
    const a = arrest, gd = a.gd;
    if (a.phase === "take") return;                      // arrest.js has the hands; its callbacks move us on
    if (!arrestGuardOk(gd)) { cancelArrest(a.phase !== "order"); return; }
    a.t += dt;
    if (a.taseCD > 0) a.taseCD -= dt;
    const d = gdDist(gd);
    const px = player.pos.x, pz = player.pos.z;
    if (a.phase === "order") {
      gd.hunt = Math.max(gd.hunt || 0, 1.5);
      const swung = swungSince(a.t0);
      const au = CBZ.brain && CBZ.brain.authority;
      if (au && au.caseOf(gd)) {
        // THE LADDER DECIDES: what the screw sees of you, it reads
        _sus.speed = pSpd; _sus.kneeling = !!player.crouch; _sus.attacking = swung; _sus.dist = d;
        _sus.handsUp = !!(CBZ.playerChar && CBZ.playerChar.handsUp);
        _sus.prone = !!(AR() && AR().downState && AR().downState(pa()));
        const r = au.step(gd, dt, _sus);
        const ph = r ? r.phase : "done";
        if (ph === "approach" || ph === "cuff") { complied(); return; }
        if (ph === "escalate" || ph === "force" || ph === "lethal" || ph === "done") { resist(swung ? "swing" : a.t >= ARREST.WINDOW ? "ignored" : "run"); return; }
        return;
      }
      // no ladder on this screw (no brain loaded): the order stands as given
      if (a.t >= ARREST.WINDOW) complied();
      return;
    }
    if (a.phase === "tased") {
      // he walks in to the body while the probes hold you
      screwStep(gd, px, pz, ESC.REACH, px, pz, d > 2.5, dt);
      const subdued = AR() ? AR().subdued() : (player.stun || 0) > 0.05;
      if (subdued && d <= ESC.REACH + 0.5) {
        // on you while you are jelly: he kneels on you and cuffs you where
        // you lie (a verbs.js without the ground cuff hauls you up first)
        const V = VB();
        if (V && !V.cuffDown && V.getUp) { try { V.getUp(pa()); } catch (e) {} }
        cuffs(false, { subdued: true });
        return;
      }
      if (subdued) return;
      a.after += dt;
      if (swungSince(a.tasedAt + 0.05) || (pSpd > ARREST.FLEE_SPD && a.after > 0.25)) { a.phase = "chase"; a.t = 0; gd._escort = false; return; }
      if ((d <= ESC.REACH + 0.4 && a.after > 0.5) || a.after > ARREST.AFTER_TASE) {
        // the probes wore off before he got to you: still down or on your
        // knees = the cuffs; back on your feet = it is a chase again
        if (d <= 3.2 && gaveUp()) { cuffs(false); return; }
        if (d <= ARREST.TASE_R) { a.phase = "chase"; a.t = 0; gd._escort = false; return; }
        cancelArrest(true);
      }
      return;
    }
    if (a.phase === "chase") {
      // after the probes missed, or you got up and went again: the reload,
      // the lunge from arm's reach, and nothing on a man squared up swinging
      gd.hunt = Math.max(gd.hunt || 0, 3);
      const swinging = swungSince(clock() - 1.2);
      if (d > ARREST.LOSE_R) { cancelArrest(true); return; }
      if (a.taseCD <= 0 && d <= ARREST.TASE_R && (swinging || pSpd > 0.8)) { tase(); return; }
      if (!swinging && d <= ARREST.LUNGE_R && pSpd > 0.8 && a.tackles < 3 && !seizedBy) { tackle(); return; }
      // he went down on his knees for it (or is on the floor): compliance
      // after all. Standing there with his hands down is not: the taser.
      if (!swinging && pSpd < ARREST.COMPLY_SPD && d <= ESC.REACH + 0.6 && a.t > 0.6 && gaveUp()) { cuffs(false); return; }
      if (!swinging && pSpd < ARREST.COMPLY_SPD && a.taseCD <= 0 && d <= ARREST.TASE_R && a.t > 1.2) { tase(); return; }
      return;
    }
    // "tackle": the lunge owns the hold until its onEnd
  }

  // called from guards.js when a hunting guard has eyes on you inside
  // ORDER_R. Returns how close he should stand (null = his own reach).
  CBZ.tryCapture = function (gd, dt) {
    if (player.dead || g.role === "cop") return null;
    if (esc || down || haul) return null;
    if (arrest) {
      if (arrest.gd !== gd) return ARREST.STANDOFF + 1.2;
      return arrest.phase === "order" ? ARREST.STANDOFF : arrest.phase === "chase" ? 1.2 : ESC.REACH;
    }
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return null;
    if (gd._seizing || (gd.capCD || 0) > 0) return ARREST.STANDOFF;
    if ((g.invuln || 0) > 0) return ARREST.STANDOFF;
    // the grace after a release: only a NEW offense brings the order back
    if (lawGraceT > 0 && !(CBZ.prisonOffenseFresh && CBZ.prisonOffenseFresh())) return ARREST.STANDOFF;
    // cuffed and loose: nothing to order, a hand on your arm
    if (CBZ.playerChar && CBZ.playerChar.cuffed && gdDist(gd) <= ESC.REACH + 1.2) {
      arrest = { gd, phase: "order", t: 0, t0: clock(), taseCD: 0, tackles: 0 };
      cuffs(false);
      return ESC.REACH;
    }
    startArrest(gd);
    return arrest ? (arrest.phase === "order" ? ARREST.STANDOFF : ESC.REACH) : null;
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
      }
    }
    CBZ.addHeat(45); // gunfire brings the whole block down on you
    if (CBZ.prisonOffense) CBZ.prisonOffense("assault", { severity: 4, seenBy: null });
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
    // not on PAUSE: a pause mid-haul used to end the scene and set you loose
    CBZ.jailBoost.onStateExit(function () {
      endEscort(); releasePlayerCell(); confineT = 0; confineShown = -1;
      cancelArrest(false); haulEnd(true);
      arrest = null; down = null; deathT = 0; holeRelease = false;
    }, ["title", "won", "lost"]);
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
    if (s !== sentShown) sentShown = s;
    // the mode's OWN readout — state.js already writes this line on reset, so
    // the sentence rides the surface the prison run already has.
    sentCallT -= dt;
    if (sentCallT <= 0) {
      sentCallT = 1;
      if (CBZ.setObjective) {
        // one standing line: the time left and what the block is doing
        CBZ.setObjective("Time left: " + s + "s" + (sentCall ? ". " + sentCall : "") + ".");
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
      beatLock = false;
      releasePlayerCell(); muster(false);   // nothing of ours stays shut past the gate
      if (CBZ.cityJailRelease) { try { CBZ.cityJailRelease("served"); return; } catch (e) {} }
      if (CBZ.winGame) { try { CBZ.winGame("served"); } catch (e) {} }
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
    // NO SOUND REQUEST HERE. The bars racking shut on you is the one sound the
    // intake is about, and it was silent — this asked for a generic `door` cue
    // that had been retired months earlier, so it warned and played nothing.
    // The fix is not a corrected cue name at this line: a state change does not
    // get to voice hardware. sealPlayerCell() above drives the real leaf
    // through cellblock.setDoor, and that is where the leaf now speaks.
  }

  // ---- HEALING: out of a fight for REGEN_WAIT s you come back slowly to
  // REGEN_CAP; standing with Doc Mercer in the infirmary puts you back to full.
  const REGEN_WAIT = 8, REGEN_CAP = 70, REGEN_RATE = 2.2, DOC_RATE = 14, DOC_R = 3.6;
  function healTick(dt) {
    if (player.dead || down || esc) return;
    const hp = player.hp == null ? 100 : player.hp;
    const px = player.pos.x, pz = player.pos.z;
    const V = VIT();
    const hurt = !!V && (V.bleeding(player) || V.blood(player) < 0.98);
    if (hp >= 100 && !hurt) return;
    if (inInfirmary(px, pz)) {
      const d = doc();
      const dx = d ? d.group.position.x : INFIRMARY.docX, dz = d ? d.group.position.z : INFIRMARY.docZ;
      if ((!d || !(d.ko > 0)) && Math.hypot(px - dx, pz - dz) < DOC_R) {
        // Doc Mercer wraps what is open (real gauze on you) and the blood
        // comes back while you sit with him
        if (hurt) { if (V.dress) V.dress(player, { blood: 0.04 * dt }); else V.reset(player); }
        player.hp = Math.min(100, hp + DOC_RATE * dt);
        return;
      }
    }
    if (hp >= 100) return;
    if (clock() - lastHurtT < REGEN_WAIT || hp >= REGEN_CAP) return;
    player.hp = Math.min(REGEN_CAP, hp + REGEN_RATE * dt);
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

    // new run? clear every leftover before anything else ticks
    if (pollStrikeRun && pollStrikeRun()) {
      endEscort(); releasePlayerCell(); muster(false);
      cancelArrest(false); haulEnd(true);
      confineT = 0; confineShown = -1; cellWatchCD = 0; sentShown = -1; beatI = 0; beatT = 0; sentCall = "";
      beatLock = false; intakeDone = false; lastServed = -1;
      arrest = null; down = null; deathT = 0; lawGraceT = 0; holeRelease = false;
      if (CBZ.vitals) CBZ.vitals.reset(player);
      lastHurtT = -1e9; spdPX = null; pSpd = 0;
    }
    // ...and if you were SENT here, you wake in the cell with the door shut.
    intakeWatch();
    trackSpeed(dt);
    if (lawGraceT > 0) lawGraceT -= dt;
    for (const gd of CBZ.guards) if ((gd.capCD || 0) > 0 && !gd._escort) gd.capCD -= dt;

    // ---- confinement: the hole, the intake count, an escape strike ----
    if (confineT > 0 && !player.dead) {
      confineT -= dt;
      if (confineT > 0) {
        // retried every frame: a haul that landed you half in the doorway
        // refuses the lock on that frame and takes it the moment you're clear.
        sealPlayerCell();
        // the shut door holds you; you can pace the cell. Only with no door
        // to shut (no wing published) does the old stun stand in for it.
        if (heldDoor == null) player.stun = Math.max(player.stun || 0, Math.min(confineT, 0.4));
      } else {
        confineT = 0; confineShown = -1;
        releasePlayerCell();
        CBZ.hideHint();
        // out of the hole: a clean slate and a grace window, so the same
        // offense can never cuff you twice
        if (holeRelease) { holeRelease = false; lawGrace(15); }
      }
    }

    // ---- strike-2 cell-block watch: guards sweep past your cell more ----
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
          if (gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0 || gd.hunt > 0 || gd.approach || gd._escort || (gd.investigate && gd.investigate.t > 0)) continue;
          const dx = watchX - gd.group.position.x, dz = watchZ - gd.group.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = gd; }
        }
        if (best) {
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
      if (haul) haulEnd(true);
      if (arrest) cancelArrest(false);
      down = null;
      player.captureState = "dead";
      player.captureT = 0;
      player.stun = 0;
      player.subdue = 0;
      confineT = 0; confineShown = -1;
      releasePlayerCell();          // never leave a corpse sealed in
      CBZ.playerChar.cuffed = false;
      CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, Math.PI / 2, 11, dt);
      if (fadeEl) fadeEl.style.opacity = "0";
      // A REAL LOSS, seen first: the body drops, then the card (state.js
      // styleLossCard reads reason "dead").
      if (deathT > 0) {
        deathT -= dt;
        if (deathT <= 0 && g.state === "playing" && CBZ.loseGame) CBZ.loseGame("dead");
      }
      return;
    }

    // the haul owns the body, the screws and the lens until it is done
    if (esc) { escortTick(dt); return; }
    // cuffed and walked (CBZ.arrest.take has the bodies; this is the walk's clock)
    if (haul) haulTick(dt);
    // on the floor: the screws are coming, and steel can still finish you
    if (down) { downTick(dt); return; }
    if (arrest) {
      arrestTick(dt);
      // a lunge that never resolved (he was knocked off it): it is a chase again
      if (arrest && arrest.phase === "tackle" && arrest.t > 6 && !seizedBy) { arrest.phase = "chase"; arrest.gd._escort = false; }
    }
    healTick(dt);

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

    // ---- WATCH-TOWER ARMED RESPONSE (telegraphed, then real rounds) ----
    // Red-hot on the exit run or the sterile zone, the NEAREST tower lights
    // you up: a WIDE warning burst, a close volley, then it is shooting AT
    // you (real damage through hurtPlayer). Back off and it holds fire. Hit
    // to the floor in the sterile zone is death; on the sally-port run it is
    // a down, and the screws cuff you as an escapee.
    if (towerShotCD > 0) towerShotCD -= dt;
    const tzone = CBZ.restrictedZoneAt ? CBZ.restrictedZoneAt(player.pos) : null;
    const onTheRun = tzone === "the exit corridor" || tzone === "the sterile zone" ||
      (CBZ.prisonOutOfBounds && CBZ.prisonOutOfBounds(player.pos.x, player.pos.z));
    const inKillZone = g.detection >= 85 && onTheRun && g.invuln <= 0 && !(CBZ.door && CBZ.door.open);
    if (inKillZone) {
      /* A TOWER FIRES ONLY IF A MAN IS UP IT. The rounds come from the
         officer on the nearest manned post in range (entities/towerwatch.js:
         alive, on his feet, on the deck); take him down, or wait for him to
         come down at the change of shift, and that tower is silent. */
      const TW = CBZ.towerWatch;
      if (TW && TW.shooter) {
        const sh = TW.shooter(player.pos.x, player.pos.z);
        if (!sh) { towerSeq = 0; towerT = 0; towerSrc = null; }
        else {
          if (!towerSrc || towerSrc.guard !== sh) towerSrc = { x: 0, z: 0, guard: sh };
          towerSrc.x = sh.group.position.x; towerSrc.z = sh.group.position.z;
          if (towerSeq === 0) { towerSeq = 1; towerT = 0; towerShotCD = 0.6; }
          TW.engage(sh, player.pos);
        }
      } else if (towerSeq === 0) { towerSrc = nearestTower(player.pos.x, player.pos.z); towerSeq = 1; towerT = 0; towerShotCD = 0; }
    }
    if (inKillZone && towerSrc) {
      towerT += dt;
      if (towerSeq === 1 && towerShotCD <= 0) {
        towerBurst(towerSrc, 6.0, 3);                                   // warning shots, WIDE
        CBZ.shake && CBZ.shake(0.3);
        towerShotCD = 1.1;
        if (towerT > 1.4) towerSeq = 2;
      } else if (towerSeq === 2 && towerShotCD <= 0) {
        towerBurst(towerSrc, 2.4, 4);                                   // final volley, CLOSE
        CBZ.shake && CBZ.shake(0.5);
        flash();
        towerShotCD = 1.3;
        if (towerT > 3.2) towerSeq = 3;
      } else if (towerSeq === 3 && towerShotCD <= 0) {
        towerBurst(towerSrc, 0.8, 5);                                   // on you
        towerShotCD = 1.25;
        if (CBZ.prisonOffense) CBZ.prisonOffense("escape", { severity: 4 });
        CBZ.hurtPlayer(38, towerSrc.x, towerSrc.z, { weapon: "gun", tower: true, shake: 0.8, stun: 0.3 });
      }
    } else if (towerSeq !== 0) {
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
