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
  const INTAKE_T = 12;       // intake hold when a city arrest lands you here (lock, line, count)
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
    let px = +p.x, pz = +p.z;
    // THE SPAWN STANDS 1 m BEHIND THE DOOR PLANE, which is inside the bars
    // but not clear of them by a body's width: sealPlayerCell() refused the
    // door on every frame of the intake and a new arrival stood in an open
    // cell. Landed a step further in, clear of the door, so it can shut.
    const cell = playerCell();
    if (cell && !inCellBox(cell, px, pz, BODY_R)) {
      const r = +cell.half - BODY_R - 0.08;
      if (r > 0) {
        px = Math.max(+cell.x - r, Math.min(+cell.x + r, px));
        pz = Math.max(+cell.z - r, Math.min(+cell.z + r, pz));
      }
    }
    player.pos.set(px, isFinite(+p.y) ? +p.y : 0, pz);
    if (CBZ.bodyTeleported) CBZ.bodyTeleported(player);
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

  // THE INFIRMARY CARRY (startEscort below): a body the law does not want,
  // got off the floor by the screws and carried to Doc Mercer. No cuffs, no
  // strike. hunger.js calls it for a man who starved. (Every arrest, the
  // floor included, is CBZ.arrest.take now: see "WHO PICKS YOU UP".)
  function haulToCell(msg, opts) {
    startEscort(msg, Object.assign({}, opts || {}, { kind: "medical" }));
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
  /* ---- THE HOLE IS ON YOU (2026-09-29). Owner: "they know by blood coming
     out, by looking down and seeing a hole, they know by limping." Every
     round or blade that opens a bleed in you (CBZ.vitals) now also leaves
     the hole on YOUR rig, the same way it does on every man in the yard
     (CBZ.bodyWound, systems/wounds.js): a dark entry, a cut in the shirt,
     a small blood ring round it. It rides the body part, so you see it over
     the shoulder and when you look down in first person (fpsmode.js keeps
     your body under the lens in this mode).
     A screw's or a tower's round has no ray behind it, only a roll, so the
     roll picks WHERE on a standing man it went: legs, gut, chest, an arm.
     Never the head: a stray roll does not get to end a run outright. The
     same zone goes to CBZ.vitals, so the hole, the bleed and the limp agree. */
  const WOUND_ACTOR = {
    isPlayer: true,
    get char() { return CBZ.playerChar || null; },
    get group() { return CBZ.playerChar ? CBZ.playerChar.group : null; },
    get pos() { return player.pos; },
    get dead() { return !!player.dead; },
  };
  CBZ.playerWoundActor = WOUND_ACTOR;
  const ZONE_Y = { head: 1.66, neck: 1.5, chest: 1.28, abdomen: 1.0, legL: 0.58, legR: 0.58, armL: 1.22, armR: 1.22 };
  const ZONE_SIDE = { legL: -0.1, legR: 0.1, armL: -0.26, armR: 0.26 };
  function rollZone() {
    const r = Math.random();
    if (r < 0.32) return Math.random() < 0.5 ? "legL" : "legR";
    if (r < 0.58) return "abdomen";
    if (r < 0.9) return "chest";
    return Math.random() < 0.5 ? "armL" : "armR";
  }
  function playerWound(weapon, opts, dx, dz) {
    let zone = opts.zone || null;
    let point = opts.point || null;
    if (!point) {
      if (!zone || !(zone in ZONE_Y)) zone = opts.head ? "head" : rollZone();
      const ch = CBZ.playerChar, yaw = ch && ch.group ? ch.group.rotation.y : 0;
      const side = ZONE_SIDE[zone] || 0;
      const lying = !!(down || (ch && ch.fall && ch.fall.on));
      const y = lying ? 0.28 : ZONE_Y[zone];
      // on the surface facing where it came from (dx,dz points shooter -> you)
      point = { x: player.pos.x + Math.cos(yaw) * side - dx * 0.12,
        y: (player.pos.y || 0) + y,
        z: player.pos.z - Math.sin(yaw) * side - dz * 0.12 };
    }
    if (CBZ.bodyWound && CBZ.playerChar && !player.dead) {
      const blade = weapon === "shank";
      try {
        CBZ.bodyWound(WOUND_ACTOR, point, { melee: blade ? "blade" : undefined, head: !!opts.head || zone === "head",
          cal: opts.cal != null ? opts.cal : (blade ? 0.7 : 1), dir: (dx || dz) ? { x: dx, y: 0, z: dz } : null });
      } catch (e) { /* wounds off */ }
    }
    return { zone: zone, point: point };
  }
  /* ---- A BLAST IS NOT A BULLET (2026-10-13). Owner: "when I shoot an RPG
     ... my player does this dumb slow fall and death." A blast came in here
     as weapon "gun": one random-zone bullet hole, and when the hp ran out
     vitals put you DOWN CRITICAL (a held KO fall, the whole rig tipped over
     on its heels) to bleed out on the floor, or rolled a "heart" and you
     were "Shot". An explosion does neither. It throws you:
       · survived: lifted and hurled away from the seat (physics.js flies
         player._phys.air; you land on your back and get up), stunned, a
         fragment wound that bleeds;
       · killed: dead NOW, and the body is a real verlet ragdoll launched by
         the blast (city/ragdoll.js, the same one the city's dead fly on),
         not a plank rotating about its feet. No slow motion. */
  function blastHit(dmg, fromX, fromZ, opts) {
    if ((g.invuln || 0) > 0) return false;
    if (!down && player.captureState && player.captureState !== "normal" && player.captureT > 0) return false;
    playerHits++;
    lastHurtT = clock();
    let dx = 0, dz = 0;
    if (fromX != null && isFinite(fromX)) { dx = player.pos.x - fromX; dz = player.pos.z - (fromZ || 0); }
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-3) { dx /= dl; dz /= dl; }
    else {   // standing on the seat: it throws you back the way you face
      const yaw = CBZ.playerChar && CBZ.playerChar.group ? CBZ.playerChar.group.rotation.y : 0;
      dx = -Math.sin(yaw); dz = -Math.cos(yaw);
    }
    player.hp = (player.hp == null ? 100 : player.hp) - (dmg || 30);
    if (CBZ.sfx) CBZ.sfx("hit");
    if (player.hp <= 0) {
      die("Killed by the blast", { blast: true, dirX: dx, dirZ: dz, dmg: dmg, fromX, fromZ, by: opts.by || null });
      return true;
    }
    // SURVIVED: the hole, then the throw
    const V = VIT();
    const hole = playerWound("blast", opts, dx, dz);
    if (V) V.wound(player, { kind: "blast", zone: hole.zone, point: hole.point, by: opts.by || null,
      dirX: dx, dirZ: dz, fromX, fromZ, noKill: true });
    const k = Math.max(0, Math.min(1, (dmg || 30) / 80));
    if (k > 0.15 && !down) {
      const ph = CBZ.body && CBZ.body.phys ? CBZ.body.phys(player) : player._phys;
      if (ph) {
        ph.air = true; ph.down = 0; ph.kx = ph.kz = 0;
        const v = 2.5 + 6.5 * k;
        ph.vx = dx * v; ph.vz = dz * v;
        ph.vy = 2.2 + 4.2 * k;
        ph.spin = -(2.2 + 3.5 * k);       // over backwards, away from the seat
      }
    }
    player.stun = Math.max(player.stun || 0, 0.4 + 0.9 * k);
    if (CBZ.shake) CBZ.shake(opts.shake || (0.7 + 0.7 * k));
    return false;
  }
  CBZ.hurtPlayer = function (dmg, fromX, fromZ, opts) {
    opts = opts || {};
    if (player.dead) return false;
    const weapon = weaponOf(opts);
    if (weapon === "blast") return blastHit(dmg, fromX, fromZ, opts);
    const steel = weapon !== "fist";
    const V = VIT();
    // ON THE FLOOR: fists stop (SOCIAL honours playerDowned); steel into a
    // man on the floor is another hole, and he is already bleeding hard
    if (down) {
      if (steel && !((g.invuln || 0) > 0)) {
        const hole = playerWound(weapon, opts, opts.dirX || 0, opts.dirZ || 0);
        if (V) V.wound(player, { kind: weapon === "shank" ? "stab" : "bullet", zone: hole.zone, point: hole.point, by: opts.by || null, critical: true, cal: opts.cal });
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
    const hole = playerWound(weapon, opts, dx, dz);
    const W = V.wound(player, { kind: weapon === "shank" ? "stab" : weapon === "blast" ? "blast" : "bullet",
      zone: hole.zone, point: hole.point, head: !!opts.head, cal: opts.cal, by: opts.by || null,
      dirX: dx, dirZ: dz, fromX, fromZ, critical: crit });
    if (weapon === "gun") roundOnYou(W, hole, dx, dz, opts);
    return !!W && (W.outcome === "down" || W.outcome === "dead");
  };
  /* ---- A FALL (2026-09-29). physics.js hands every hard landing here
     (cityFallLand, off the height fallen); climb.js hands a man knocked off
     the rungs. It was a bullet wound (climb.js called hurtPlayer with
     weapon "fall", which this file read as a round) or nothing at all (a
     vault off a tower catwalk was free). What the ground does, by height:
       under 2.8 m   nothing: the knees take it
       to 4.5 m      a turned ankle: a limp for a minute
       to 8 m        a broken ankle: a hard limp for the run, down a beat
       to 17 m       broken legs (a tower is 12.75): on the ground for the
                     count, then a crawl-paced hobble; you live
       17 m and up   dead
     The limp is CBZ.vitals.fall (speedMul); Doc Mercer splints it. The
     landing is loud, and every screw in earshot is sent to it. */
  let lastFallT = -1e9;
  CBZ.prisonFallLand = function (h, o) {
    if (!g || g.mode !== "escape" || player.dead || !(h > 2.8)) return null;
    const t = clock();
    if (t - lastFallT < 0.6) return null;              // one landing, whoever reports it
    lastFallT = t;
    if ((g.invuln || 0) > 0) return null;
    if (h >= 17) { die("Fell", {}); return "dead"; }
    const sev = h < 4.5 ? "sprain" : h < 8 ? "fracture" : "broken";
    const hp = player.hp == null ? 100 : player.hp;
    player.hp = Math.max(sev === "broken" ? 8 : 20, Math.min(hp, hp - Math.round((h - 2.8) * 6.5)));
    lastHurtT = t;
    const V = VIT();
    if (V && V.fall) V.fall(player, h);
    if (CBZ.shake) CBZ.shake(Math.min(1.3, 0.35 + h * 0.07));
    if (CBZ.sfx) { CBZ.sfx("hit"); if (sev !== "sprain") CBZ.sfx("ko"); }
    if (sev === "broken") player.ko = Math.max(player.ko || 0, 2.6);
    else player.stun = Math.max(player.stun || 0, sev === "fracture" ? 1.1 : 0.35);
    if (CBZ.guardHear) { try { CBZ.guardHear(player.pos.x, player.pos.z, sev === "sprain" ? 10 : 26, { type: "impact", player: true }); } catch (e) {} }
    return sev;
  };
  /* ---- THE LIMP YOU SEE. vitals.js already SLOWS a man with a hole in a
     leg or legs hurt in a fall (speedMul, which physics.js applies to you);
     entities/character.js already knows how a hurt leg WALKS (ch.legHurt: a
     short stiff stride on that side, the dip onto it each step). wounds.js
     writes legHurt for every man but you, so the player limped in speed only
     and his legs walked sound. This keeps your rig's legHurt on what
     CBZ.vitals says about your legs, every frame, in this mode: the worst open
     leg hole (its side; a wrapped one still favoured, half as hard) or the
     fall (a turned ankle, a broken one, broken legs). Nothing else writes the
     player's legHurt here, so it is set and cleared only by this. */
  let limpSet = false;
  function playerLimp() {
    const ch = CBZ.playerChar;
    if (!ch) return null;
    const V = VIT();
    const R = V && V.peek ? V.peek(player) : null;
    let side = 0, sev = 0;
    if (R && !player.dead) {
      for (let i = 0; i < R.bleeds.length; i++) {
        const b = R.bleeds[i];
        if (b.zone !== "legL" && b.zone !== "legR") continue;
        const k = Math.min(1, 0.5 + (b.rate0 || b.rate) * 55) * (b.band >= 0.5 ? 0.5 : 1);
        if (k > sev) { sev = k; side = b.zone === "legL" ? -1 : 1; }
      }
      const lame = V.lame ? V.lame(player) : 1;
      if (lame < 1) {
        const k = Math.min(1, (1 - lame) / 0.55);
        if (k > sev) { sev = k; side = side || -1; }
      }
    }
    if (sev > 0.02 && !ch.legGone) {
      const lh = ch.legHurt;
      if (!lh || lh.side !== side || Math.abs(lh.sev - sev) > 0.01) ch.legHurt = { side: side, sev: sev, t: 9999 };
      else lh.t = 9999;
      limpSet = true;
    } else if (limpSet) {
      ch.legHurt = null;
      limpSet = false;
    }
    return ch.legHurt || null;
  }
  CBZ.prisonPlayerLimp = playerLimp;
  CBZ.onUpdate(9.5, function () {
    if (g.mode !== "escape") { if (limpSet && CBZ.playerChar) { CBZ.playerChar.legHurt = null; limpSet = false; } return; }
    playerLimp();
  });
  /* ---- THE ROUND ON YOUR BODY (the same language as every man's,
     systems/verbs_strike.js V.shot and systems/bodyfall.js): it lands where
     the hole is, you fold or snap or lose the arm, a heavy one in a leg
     takes you to that knee; floored or killed, the rig goes down along the
     round in the fall picked for that hit (never the plank rolled about the
     feet, never the same fall). physics.js holds the stick only while the
     rig is off its feet. */
  const ZONE_RIG = { head: "head", neck: "head", chest: "torso", abdomen: "torso", armL: "armL", armR: "armR", legL: "legL", legR: "legR" };
  const _yShot = { point: null, dir: { x: 0, z: 0 }, cal: 1, wkey: "", dist: 8, head: false };
  function roundOnYou(W, hole, dx, dz, opts) {
    const ch = CBZ.playerChar;
    if (!ch || !W) return;
    if (W.outcome === "down" || player.dead) {
      if (CBZ.bodyFall && CBZ.bodyFall.floorOnly) {
        try {
          CBZ.bodyFall.floorOnly(ch, { dirX: dx, dirZ: dz, zone: ZONE_RIG[hole.zone] || "torso", cal: opts.cal || 1,
            wkey: opts.wkey || "", dist: opts.dist, point: hole.point, dead: !!player.dead, ko: !!player.dead,
            runSp: player.speed || 0 });
        } catch (e) { /* no rig fall */ }
      }
      return;
    }
    const VB = CBZ.verbs;
    if (VB && VB.shot && VB.playerActor) {
      _yShot.point = hole.point; _yShot.dir.x = dx; _yShot.dir.z = dz; _yShot.cal = opts.cal || 1;
      _yShot.wkey = opts.wkey || ""; _yShot.dist = opts.dist != null ? opts.dist : 8; _yShot.head = hole.zone === "head";
      try { VB.shot(VB.playerActor(), _yShot); } catch (e) { /* no rig */ }
    }
  }
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
        // already in their hands on the floor, or cuffed and walked: the
        // arrest carries on with the body it has (a standing cuff that loses
        // its man to the floor goes down and is taken there instead)
        const hk = AR() && AR().active ? AR().active() : null;
        if (haul || (hk && hk.onGround)) return;
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
  /* ============================================================
     WHO PICKS YOU UP OFF THE FLOOR (2026-11-22).

     OWNER: "Rn when arresting cops throw me over their shoulder all of a
     sudden instead of the great handcuffing they used to do." Every down in
     here (out cold, the blood, steel at 0 hp) ended in the infirmary carry,
     over a screw's shoulder with no cuffs, unless it was an escape: so a man
     the screws were in the middle of arresting who got put down was carried
     off like a patient. THE RULE NOW:

       THE LAW HAS YOU (lawWants) when any of
         · it is an escape capture (the wire, the sterile strip, the exit run)
         · an offense worth the cuffs is on file (severity 2+)
         · an arrest was under way (the order, the taser, the chase, a lunge)
         · a screw put you down (opts.by is a guard)
         · a screw is hunting you within LAW_R
       and then you are CUFFED WHERE YOU LIE: the screw who was on you (or the
       nearest one who can walk, sent at a run along his own nav route, not
       placed) comes to the body; inside LAW.NEAR with nothing between he
       kneels on you, one wrist, then the other (CBZ.arrest.take, the ground
       cuff), comes up off his knee with his hand on your arm, and walks you
       to your cell (the hole; a transfer for an escape). The rig's fall is
       the one body all the way: it is held where it landed until his hands
       take it, never stood up and dropped again.

       THE INFIRMARY CARRY is for a body the law does not want: put down by
       an inmate, a fall or the blood with nothing on file and nobody after
       you; and a man who starved (hunger.js). A wanted man bleeding out is
       still cuffed first: the knee on him is the pressure on the wound (the
       vitals reset at the cuffs, as the carry did at the pick-up).

     Nobody can come (every screw down, dead, bribed, tied): a man who comes
     to gets up on his own and it is a chase; one who is bleeding out or
     still out cold goes to the infirmary the old way. A sent screw who
     stops gaining on you (a locked door, a stair) hands it to the next man.
     ============================================================ */
  const LAW_R = 30;
  const LAW = { BEAT: 0.6, NEAR: 4.0, REPICK: 0.5, STALL: 6, WAKE: 7, GIVEUP: 40 };
  function isGuard(a) { return !!a && (CBZ.guards || []).indexOf(a) >= 0; }
  function lawWants(by, arrestGd) {
    if (CBZ.prisonEscapeCapture && CBZ.prisonEscapeCapture()) return true;
    const off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
    if (off && off.severity >= 2) return true;
    if (arrestGd) return true;
    if (isGuard(by)) return true;
    for (const gd of CBZ.guards || []) {
      if (!(gd.hunt > 0) || !arrestGuardOk(gd) || gd.kind === "warden") continue;
      if (gdDist(gd) < LAW_R) return true;
    }
    return false;
  }
  // lawLead: undefined = nobody wants you (the carry); null/guard = the law
  function newDown(weapon, by, wakeHp, lawLead) {
    return { t: 0, weapon, by: by || null, wakeHp,
      law: lawLead !== undefined, lead: lawLead || null, pickT: 0, best: Infinity, stall: 0, excl: [] };
  }
  function goDown(weapon, opts) {
    law("downs");
    // read the law off the scene BEFORE it is torn down: the screw who was
    // arresting you is the one who comes to the body
    const arrestGd = arrest && arrest.gd && arrestGuardOk(arrest.gd) ? arrest.gd : null;
    const byGuard = isGuard(opts.by) && arrestGuardOk(opts.by) ? opts.by : null;
    const wanted = lawWants(opts.by, arrestGd);
    cancelArrest();
    haulEnd(true);
    if (CBZ.killstreakBreak) CBZ.killstreakBreak("Down");
    const wake = weapon === "fist" ? 55 : 30;
    down = newDown(weapon, opts.by, wake, wanted ? (arrestGd || byGuard || null) : undefined);
    if (wanted) {
      // the record says why (a screw who put you down with nothing on file
      // put you down because you were fighting him)
      const off = CBZ.prisonOffenseNow ? CBZ.prisonOffenseNow() : null;
      if ((!off || off.severity < 2) && CBZ.prisonOffense) {
        try { CBZ.prisonOffense(byGuard ? "assault" : "minor", { severity: byGuard ? 3 : 2, seenBy: down.lead || null }); } catch (e) {}
      }
    }
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
    // ON THE FLOOR IS THE RIG'S FALL (meleeposes.js), held: the same body the
    // cuffs (or the carry) pick up. This used to roll the whole group onto its
    // side, then the haul's holdDown started a real fall from standing on top
    // of it (he unrolled, stood, and fell over a second time).
    holdDown(dt, 1);
    if (d.law) { lawFloorTick(d, dt); return; }
    if (d.t < DOWN_BEAT) return;
    // nobody wants you: hands on you, pressure on the wound, and whatever
    // kept you on the floor is theirs to carry to the infirmary
    toInfirmary(d);
  }
  function toInfirmary(d) {
    if (CBZ.vitals) CBZ.vitals.reset(player);
    down = null;
    startEscort(null, { kind: "medical", wakeHp: d.wakeHp });
  }
  // the vitals say he is awake and not bleeding out (he can get up himself)
  function playerConscious() {
    const VT = VIT();
    const R = VT && VT.peek ? VT.peek(player) : null;
    return !R || (!(R.koT > 0) && !R.collapsed && !R.critical && !(R.tasedT > 0));
  }
  // the nearest screw who could walk to (px,pz) and use his hands, skipping `excl`
  function nearestScrew(px, pz, excl, maxR) {
    let best = null, bd = maxR != null ? maxR : Infinity;
    for (const gd of CBZ.guards || []) {
      if (!arrestGuardOk(gd) || gd.kind === "warden" || gd._escort) continue;
      if (excl && excl.indexOf(gd) >= 0) continue;
      if (CBZ.verbs && CBZ.verbs.sessionOf && CBZ.verbs.sessionOf(gd)) continue;
      const d = Math.hypot(px - gd.group.position.x, pz - gd.group.position.z);
      if (d < bd) { bd = d; best = gd; }
    }
    return best;
  }
  function lineTo(gd) {
    const V = VB();
    if (!V || !V.lineBlocked) return true;
    const p = gd.group.position;
    try { return !V.lineBlocked(p.x, p.y || 0, p.z, player.pos.x, player.pos.z); } catch (e) { return true; }
  }
  /* SENT: a screw runs to (x,z) on guards.js's own hunt walk (its nav route
     round the walls, its stride). With eyes on you that branch walks him to
     you and asks tryCapture; blind, his chase point is where you lie (a
     primed search point the radio cannot move). */
  function sendTo(gd, x, z) {
    gd.hunt = Math.max(gd.hunt || 0, 6); gd.alert = 1; gd.investigate = null; gd.capCD = 0;
    const c = gd._chase;
    if (!gd.seesPlayer && (!c || Math.hypot(c.x - x, c.z - z) > 1.5)) {
      gd._chase = { x, z, vx: 0, vz: 0, phase: "goto", i: 0, look: 0, atPt: false, best: Infinity, stall: 0, walkT: 0,
        rings: 0, npts: 3, _primed: true, fixAt: 1e12 };
    }
  }
  function lawFloorTick(d, dt) {
    if (d.t < LAW.BEAT) return;                       // the body lands first
    const px = player.pos.x, pz = player.pos.z;
    let gd = d.lead;
    if (gd && (!arrestGuardOk(gd) || gd.kind === "warden" || gd._escort || d.excl.indexOf(gd) >= 0)) gd = d.lead = null;
    d.pickT -= dt;
    if (!gd && d.pickT <= 0) {
      d.pickT = LAW.REPICK;
      gd = d.lead = nearestScrew(px, pz, d.excl);
      d.best = Infinity; d.stall = 0;
    }
    if (!gd) {
      if (d.t < DOWN_BEAT) return;
      // nobody alive who can come and put hands on you
      if (playerConscious()) lawWake(d); else if (d.t >= DOWN_BEAT + 1.5) toInfirmary(d);
      return;
    }
    const dist = gdDist(gd);
    // in reach, nothing between: his hands (the ground cuff walks the last steps)
    if (dist <= LAW.NEAR && lineTo(gd) && floorTake(gd)) return;
    sendTo(gd, px, pz);
    // not getting any closer (a locked door, a stair he will not take): the next man goes
    if (dist < d.best - 0.3) { d.best = dist; d.stall = 0; } else d.stall += dt;
    if (d.stall > LAW.STALL) { d.excl.push(gd); d.lead = null; d.pickT = 0; }
    // awake (not out cold, not bleeding out) before anybody reached him: he
    // can get up and go the moment he pushes the stick, and does by himself
    // after LAW.WAKE. Either way it is a chase.
    if (playerConscious()) {
      const K = CBZ.keys || {};
      const pushing = !!(K.w || K.a || K.s || K.d || K[" "]);
      if ((pushing && d.t >= 1.5) || d.t >= LAW.WAKE) { lawWake(d); return; }
    }
    if (d.t >= LAW.GIVEUP) toInfirmary(d);
  }
  function lawWake(d) {
    const gd = d.lead;
    down = null;
    standUp();
    player.stun = 0;
    setCaptureState("normal", 0);
    if (gd && arrestGuardOk(gd)) { gd.hunt = Math.max(gd.hunt || 0, 6); gd.capCD = 0; }
  }
  /* HANDS ON A MAN ON THE FLOOR: the arrest's take (systems/arrest.js) from
     the down beat, by the screw who is at you. False = not yet (no reach):
     the body stays down and he keeps coming. */
  function floorTake(gd) {
    const d = down;
    if (!d || haul || (arrest && arrest.phase === "take")) return false;
    arrest = { gd, phase: "order", t: 0, t0: clock(), comply: 0, flee: 0, lastD: gdDist(gd), after: 0, taseCD: 0, tackles: 0 };
    down = null;
    cuffs(true, { floor: d });
    if (arrest && arrest.phase === "take") return true;
    // refused this frame: still on the floor, still waiting for him
    down = d;
    arrest = null;
    gd._escort = false;
    player.captureState = "downed"; player.captureT = 60;
    return false;
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
    if (CBZ.shake) CBZ.shake(opts && opts.blast ? 1.6 : 0.9);
    if (opts && opts.blast) blastBody(opts);
  }
  // the body a blast kills: thrown by the blow, a real ragdoll (city/ragdoll.js)
  let ragged = false;
  const _bp = { x: 0, y: 0, z: 0 }, _bd = { x: 0, y: 0, z: 0 };
  function blastBody(o) {
    const ch = CBZ.playerChar;
    if (!ch || !ch.group) return;
    ch.group.visible = true;
    ch.cuffed = false;
    if (player._phys) { player._phys.air = false; player._phys.down = 0; player._phys.kx = player._phys.kz = 0; }
    const dx = o.dirX || 0, dz = o.dirZ || 0;
    _bd.x = dx; _bd.y = 0.35; _bd.z = dz;
    // the push lands low on the side facing the seat: the body leaves the floor
    _bp.x = player.pos.x - dx * 0.25; _bp.y = (player.pos.y || 0) + 0.9; _bp.z = player.pos.z - dz * 0.25;
    ragged = !!(CBZ.playerRagdoll && CBZ.playerRagdoll(WOUND_ACTOR, _bp, _bd, 24));
    if (CBZ.gore) {
      try { CBZ.gore(player.pos.x, (player.pos.y || 0) + 1.0, player.pos.z, { dir: { x: dx, z: dz }, amount: 1.4, player: true }); } catch (e) {}
    }
  }

  // ============================================================
  //  THE INFIRMARY CARRY — a body the law does not want (see WHO PICKS YOU
  //  UP OFF THE FLOOR): the nearest screws run to it, the lead gets you up
  //  over his shoulder (CBZ.verbs.carry) and walks off toward the infirmary,
  //  the lens goes dark on the way, and you come to on the ward bed.
  //
  //    down  — you are on the floor; the nearest screws RUN to the body
  //    carry — over the shoulder, walked off; the fade rides on the end
  //    wake  — fade back in by the bed, getting up off your side
  //
  //  (2026-11-22: this scene used to be every haul, the cuffs included: a
  //  tase on the floor, then STOOD UP and cuffed standing, then a scripted
  //  march under a cine camera. That was a second arrest running beside
  //  CBZ.arrest.take, and the over-the-shoulder carry was what a wanted man
  //  got whenever he went down. Every cuffing is the take now; this is only
  //  the carry.)
  //
  //  The screws are real guards put on `_escort` duty (entities/guards.js
  //  yields the body while the flag is set; this file steers it). No screw
  //  alive = a short down beat and the fade (the infirmary orderlies).
  // ============================================================
  const ESC = {
    DOWN_MAX: 4.5,     // s — longest the body lies waiting for the screws
    DOWN_ALONE: 1.2,   // s — the wait when there is nobody to run in
    FADE: 1.0, WAKE: 0.9,
    REACH: 1.45,       // m — where a screw stops to work on a body (actorcollide.js
                       //     holds two standing bodies ~1.4 m apart; asking for less
                       //     is a man pushed back out every frame and never "arriving")
    SECOND_R: 30,      // m — a second screw only if he is already near; a far one
                       //     is a man jogging into a wall for the whole scene
    WALK_SPD: 1.35,    // m/s — the perp walk (CBZ.arrest.take's escort pace)
  };
  let esc = null;      // the live scene, or null
  const lerpAng = CBZ.lerpAngle || function (a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  };
  // screws for the carry: the two nearest guards who can walk.
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
  // the warden never carries a man himself: he orders it (prisonwarden.js)
  function screwUsable(gd) { return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && gd.kind !== "warden"); }
  function releaseScrews() {
    if (!esc) return;
    for (const gd of esc.screws) {
      if (!gd) continue;
      gd._escort = false;
      if (gd.char) gd.char.crouch = false;
      gd.capCD = 3.0;
    }
    esc.screws.length = 0;
  }
  // move a screw toward (tx,tz), stopping `stop` short of it, facing (fx,fz).
  // Returns the distance still to go.
  const SCREW_MV = { speed: 3, stop: 0.3, lod: 1, leg: false };
  const SCREW_NAV = { speed: 3, arrive: 0.55, goalY: 0 };
  let _screwT = null;
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
      /* THE WAY THERE (systems/navgrid.js): round the wall, through the door,
         and up the stair when the man is on the gallery. This walked straight
         at him and then LIFTED the screw to his height wherever he stood
         (gp.y damped to the player's y inside 3 m): a screw under the flight
         or the deck rose through the steel to work on a man above him, and
         his raised collision band let him walk through the stair's side. His
         feet are the floor's now (systems/actorcollide.js settleFeet). */
      let wx = tx, wz = tz, routed = false;
      // up a tower the way is its ladder (systems/climb.js, as guards.js walkTo)
      const CL = CBZ.climb;
      const Dc = CL && CL.list && CL.list.length ? CL.detour(gd, tx, player.pos.y, tz) : null;
      if (Dc && Dc.climbing) return Math.max(0, d - stop);
      if (Dc) { wx = Dc.x; wz = Dc.z; routed = true; }
      const NG = CBZ.navGrid;
      if (!Dc && NG && NG.step && NG.ready && NG.ready()) {
        const T = _screwT || (_screwT = new THREE.Vector3());
        T.set(tx, 0, tz);
        SCREW_NAV.speed = sp; SCREW_NAV.goalY = player.pos.y;
        if (NG.step(gd, gp, T, dt, SCREW_NAV)) { wx = T.x; wz = T.z; routed = Math.hypot(wx - tx, wz - tz) > 0.3; }
      }
      SCREW_MV.speed = sp; SCREW_MV.stop = routed ? 0.3 : stop; SCREW_MV.leg = routed;
      M.step(m, gp, gd.group.rotation.y, wx, wz, SCREW_MV, dt);
      step = Math.hypot(gp.x - ox, gp.z - oz);
    } else if (step > 0 && d > 1e-4) { gp.x += dx / d * step; gp.z += dz / d * step; }
    const ax = fx - gp.x, az = fz - gp.z;
    if (Math.abs(ax) + Math.abs(az) > 1e-3) gd.group.rotation.y = lerpAng(gd.group.rotation.y, Math.atan2(ax, az), 1 - Math.pow(0.0005, dt));
    if (gd.group.rotation.z !== 0) gd.group.rotation.z = CBZ.damp(gd.group.rotation.z, 0, 9, dt);
    if (CBZ.animChar && gd.char) CBZ.animChar(gd.char, step / Math.max(dt, 1e-4), dt);
    // a man a storey above or below is not in reach however close he stands
    // over the screw's head: the height counts (as guards.js's hunt counts it)
    const lift = Math.max(0, Math.abs(player.pos.y - (gp.y || 0)) - 0.9) * 3;
    return Math.max(0, (lift > 0 ? Math.hypot(d, lift) : d) - stop);
  }
  /* NO RED SCREEN. This file used to fire the full-screen #flash (a #ff2a3a
     wash at 55%) on every blow, fall, tase, tower round, haul and death, so a
     man taking a beating watched his screen strobe red (owner: "the screen
     turning red when I'm low health is dumb"). Being hurt reads on the BODY:
     the hole and the blood on you (wounds.js, playerWound below), the drip
     and the trail (vitals.js), the limp (playerLimp below), the shake and the
     sound. Nothing is painted over the view. */
  function tiesOn(on) {
    CBZ.playerChar.cuffed = !!on;
    if (CBZ.verbs && CBZ.verbs.setCuffs) CBZ.verbs.setCuffs(CBZ.verbs.playerActor(), !!on);
  }
  /* THE BODIES ARE CBZ.verbs' AND STRIKE'S. The screw's hands on you are the
     shared verbs (tackle, cuff, escort, carry: systems/verbs.js); you on the
     floor is the real fall (entities/meleeposes.js), held down until the
     hands take you, not the old whole-group rotation.z roll. */
  const VB = () => CBZ.verbs || null;
  const pa = () => (VB() ? VB().playerActor() : player);
  function holdDown(dt, side) {
    const ch = CBZ.playerChar, MP = CBZ.meleePoses;
    if (MP && MP.startFall && ch) {
      if (!(ch.fall && ch.fall.on)) MP.startFall(ch, { variant: "back", side: side, ko: true, hold: true });
      ch.fall.hold = true;
      // a fall already getting up (its own clock ran out a frame early) is
      // laid back down where it is, not dropped again from standing
      if (ch.fall.phase === "getup" && (ch.fall.gt || 0) < 0.4) { ch.fall.phase = "down"; ch.fall.gt = 0; }
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
    const S = e.carryS;
    if (S && !S.done) S.cancel();
    e.carryS = null;
  }
  // THE LENS. The pen's camera is a tight room-aware boom over your shoulder,
  // so a scene played under it is a wall: you lie under the pivot and the
  // screw kneels behind the camera. city/cinematics.js publishes a scripted
  // camera channel (CBZ.cineCam) that systems/camera.js yields to outright;
  // we write it directly — no director steps, no holster, and it hands back
  // the moment the scene does: a low side-on of the body with the screws
  // arriving behind it.
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

  // THE INFIRMARY (world/southblock.js: x[26,42] z[88,104], door W at z 96,
  // beds at x 30/38, z 92/100, Doc Mercer at (33,96)). You come to beside the
  // first ward bed, on your side, and get up.
  const INFIRMARY = { x0: 26, x1: 42, z0: 88, z1: 104, wakeX: 31.9, wakeZ: 92.2, docX: 33, docZ: 96 };
  function landInInfirmary() {
    player.pos.set(INFIRMARY.wakeX, 0, INFIRMARY.wakeZ);
    if (CBZ.bodyTeleported) CBZ.bodyTeleported(player);
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

  // the carry to the infirmary (haulToCell / a down nobody wants). opts.wakeHp
  // = the hp you come to with.
  function startEscort(msg, opts) {
    if (esc) return;
    opts = opts || {};
    if (CBZ.killstreakBreak) CBZ.killstreakBreak("Down");
    cancelArrest();
    down = null;
    tiesOn(false);
    player.stun = 2.2;
    // non-normal for the whole scene; escortTick keeps it alive
    setCaptureState("downed", 60);
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd._chase = null; });
    const screws = pickScrews();
    for (const gd of screws) { gd._escort = true; }
    let cx = Math.sin(CBZ.playerChar.group.rotation.y + Math.PI * 0.5), cz = Math.cos(CBZ.playerChar.group.rotation.y + Math.PI * 0.5);
    if (screws[0]) {
      const ax = player.pos.x - screws[0].group.position.x, az = player.pos.z - screws[0].group.position.z, al = Math.hypot(ax, az);
      if (al > 0.5) { cx = ax / al; cz = az / al; }
    }
    esc = {
      cam: false, cx, cz,
      phase: "down", t: 0, total: 0,
      kind: "medical", wakeHp: opts.wakeHp || 55,
      screws, carryS: null, carryTried: false,
    };
  }
  // tear the scene down without landing anything: a new run, a death,
  // leaving play. Safe from anywhere, any number of times.
  function endEscort() {
    if (!esc) return;
    dropHolds(esc);
    camDrop();
    releaseScrews();
    esc = null;
    standUp();
    player.subdue = 0; player.stun = 0;
    setCaptureState("normal", 0);
    if (fadeEl) fadeEl.style.opacity = "0";
  }
  function escortTick(dt) {
    const e = esc, P = player;
    e.t += dt; e.total += dt;
    // nothing else may move, hit or grab you mid-scene
    P.stun = Math.max(P.stun || 0, 0.5); g.invuln = Math.max(g.invuln || 0, 0.6);
    P.captureT = 60; P.captureState = "downed";
    // a screw shot off the scene drops out of it
    for (let i = e.screws.length - 1; i >= 0; i--) if (!screwUsable(e.screws[i])) { e.screws[i]._escort = false; e.screws.splice(i, 1); }
    const lead = e.screws[0], second = e.screws[1];
    const px = P.pos.x, pz = P.pos.z;
    const lie = () => holdDown(dt, 1);
    // the second screw takes the far side of the body
    const flank = () => {
      const ax = lead ? lead.group.position.x - px : 1, az = lead ? lead.group.position.z - pz : 0;
      const al = Math.hypot(ax, az) || 1;
      return { x: px - az / al * 1.5 - ax / al * 0.3, z: pz + ax / al * 1.5 - az / al * 0.3 };
    };

    if (e.phase === "down") {
      lie(); camGround(px, P.pos.y, pz);
      let near = Infinity;
      if (lead) near = screwStep(lead, px, pz, ESC.REACH, px, pz, true, dt);
      if (second) { const f = flank(); screwStep(second, f.x, f.z, 0.2, px, pz, true, dt); }
      // arrived = within reach, OR he has stopped gaining on you (a body on a
      // ledge, a wall on the straight line): the beat goes on from where he is
      if (lead) { if (near < (e.gain == null ? Infinity : e.gain) - 0.02) { e.gain = near; e.stuck = 0; } else e.stuck = (e.stuck || 0) + dt; }
      const arrived = lead ? (near <= 0.35 || (e.stuck > 0.8 && near < 3.0)) : false;
      if (arrived || e.t >= (lead ? ESC.DOWN_MAX : ESC.DOWN_ALONE)) { e.phase = "carry"; e.t = 0; }
      return;
    }
    // THE CARRY: the lead screw gets you up over his shoulder
    // (CBZ.verbs.carry) and walks off with you toward the infirmary; the
    // lens goes dark on the way. No cuffs, no strike.
    if (e.phase === "carry") {
      camGround(px, P.pos.y, pz);
      if (!e.carryS && !e.carryTried && lead && VB()) { e.carryTried = true; e.carryS = VB().carry(lead, pa(), { far: true }); }
      const S = e.carryS && !e.carryS.done ? e.carryS : null;
      if (!S) lie();
      if (S && S.phase === "hold") VB().walk(S, S, INFIRMARY.x0, (INFIRMARY.z0 + INFIRMARY.z1) / 2, 1.2, dt);
      if (second) { const f = flank(); screwStep(second, f.x, f.z, 0.2, px, pz, false, dt); }
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
    if (e.phase === "wake") {
      if (fadeEl) fadeEl.style.opacity = Math.max(0, 1 - e.t / ESC.WAKE).toFixed(2);
      if (e.t >= ESC.WAKE) endEscort();
      return;
    }
    endEscort();   // unknown phase: never strand the player in a half-scene
  }
  CBZ.jailEscortPhase = function () { return esc ? esc.phase : null; };

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
    // ALREADY ON THE FLOOR (a tackle, a knockdown, the last tase still
    // riding): no second shot, he walks in to the body. Firing again here was
    // the re-tase that stood you up and dropped you a second time.
    const A0 = AR();
    if (A0 && A0.downState && A0.downState(pa())) {
      a.phase = "tased"; a.t = 0; a.after = 0; a.tasedAt = clock();
      a.taseCD = Math.max(a.taseCD || 0, A0.TASE ? A0.TASE.RELOAD : 2.6);
      gd._escort = true;
      return;
    }
    law("tases");
    const r = AR() && AR().tase ? AR().tase(gd) : { hit: true };
    if (!AR()) { player.stun = 1.85; }
    if (r.hit) {
      // the cartridge is spent: no new probes until this cycle is over and
      // he has reloaded (getting up and running is not an instant re-tase)
      a.taseCD = Math.max(a.taseCD || 0, A0 && A0.TASE ? A0.TASE.STUN + A0.TASE.RELOAD : 4.5);
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
    // NO HANDS, NO CUFFS. This used to fall back to the old haul scene, which
    // put the cuffs on you with nobody's hands on you (the owner's "phantom
    // handcuffed"). Without the arrest library, or a screw, it is a chase.
    if (!A || !A.take || !gd) { backToChase(gd); return; }
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
        if (o.floor) {
          // the knee on you was the pressure on the wound: you come up in
          // their hands awake (what the carry did at the pick-up)
          if (CBZ.vitals) CBZ.vitals.reset(player);
          player.hp = Math.max(player.hp || 0, o.floor.wakeHp || 30);
          // his hand is on your arm from the lift into the walk: no free step between
          player.stun = 0.8;
        }
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
        if (o.floor) {
          // he never got his knee on you (a bunk in the way, the approach ran
          // out): you are still on the floor and he, or the next man, comes again
          if (arrest && arrest.gd === gd) arrest = null;
          gd._escort = false;
          const ch = CBZ.playerChar;
          if (ch && ch.fall && ch.fall.on && !player.dead) {
            down = newDown(o.floor.weapon, o.floor.by, o.floor.wakeHp, gd);
            down.t = Math.max(LAW.BEAT, o.floor.t || 0);
            down.excl = (o.floor.excl || []).slice();
            down.tries = (o.floor.tries || 0) + 1;
            if (down.tries >= 2) { down.excl.push(gd); down.lead = null; down.tries = 0; }   // the next man tries it
            setCaptureState("downed", 60);
          } else {
            arrest = { gd, phase: "chase", t: 0, t0: clock(), taseCD: 0, tackles: 0, after: 0 };
            setCaptureState("normal", 0);
          }
          return;
        }
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
      // THE TAKE REFUSED (arrest.js: he is not at you, there is a wall or a
      // floor between you, or you are on your feet and have not given up):
      // that is not an arrest, it is still a chase. Never cuffs from nowhere.
      backToChase(gd);
      return;
    }
    if (a) a.take = h;
    // standing, your controls are yours until his hands land; on the floor
    // you are his already and the yard stays off you
    if (o.floor || o.subdued || o.pinned) setCaptureState("subdued", 10);
    else setCaptureState("normal", 0);
  }
  function backToChase(gd) {
    if (gd) gd._escort = false;
    if (arrest && arrest.gd === gd) { arrest.phase = "chase"; arrest.t = 0; arrest.take = null; }
    else arrest = null;
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
      if (!landInCell()) { player.pos.copy(CBZ.SPAWN); player.vy = 0; if (CBZ.bodyTeleported) CBZ.bodyTeleported(player); CBZ.playerChar.group.position.copy(player.pos); }
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
    // the take under the walk ended without landing it or breaking it (a
    // cancel from outside): no 28 s of a man stood in place, you are loose in
    // cuffs and the screws come for you (tryCapture re-takes a cuffed man)
    if (H.h && H.h.done && H.h.result && H.h.result.outcome !== "arrived") {
      const gd = H.gd;
      haulEnd(false);
      if (arrestGuardOk(gd)) { gd.hunt = Math.max(gd.hunt || 0, 6); gd.capCD = 0; }
      return;
    }
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

  /* ---- THE SECOND OFFICER ---------------------------------------------------
     A wing backs its screw up with HANDS, not a number. While a take is live
     (CBZ.arrest.active: his hands are reaching for you, cuffing you, or
     walking you) the nearest other screw inside HELP.R comes in and joins it
     (CBZ.verbs.assist): on the floor he kneels across the backs of your legs
     from the other side; on your feet he takes your other arm and walks with
     you. Standing next to you he is what arrest.js's backup counts, so the
     hold is harder to beat and you can see why. Nobody near and you are
     winning (the struggle more than HELP.CALL_PROG off his grip): the officer
     calls it in and the nearest screw in HELP.CALL_R runs over (sent on his
     own hunt walk). The take ends: he lets go; you got loose: he chases. */
  const HELP = { R: 9, JOIN_R: 3.5, CALL_R: 45, CALL_PROG: 0.35 };
  let helper = null, helpCalled = null;
  function dropHelper(chase) {
    if (!helper) return;
    const gd = helper;
    helper = null;
    const V = VB();
    if (V && V.unassist) V.unassist(gd);
    gd._escort = false;
    if (gd.char) gd.char.crouch = false;
    if (chase && arrestGuardOk(gd)) { gd.hunt = Math.max(gd.hunt || 0, 6); gd.capCD = 0; }
    else gd.capCD = Math.max(gd.capCD || 0, 3);
  }
  function helperTick(dt) {
    const A = AR(), V = VB();
    const h = A && A.active ? A.active() : null;
    if (!h || !V || !V.assist || player.dead) {
      dropHelper(!!(arrest && arrest.phase === "chase"));
      helpCalled = null;
      return;
    }
    const lead = h.officer;
    const px = player.pos.x, pz = player.pos.z;
    if (helper && (!arrestGuardOk(helper) || helper === lead || helper.kind === "warden")) dropHelper(false);
    // the session he would join: the cuffs, else the walk
    const S = h.cuffS && !h.cuffS.done ? h.cuffS : h.escS && !h.escS.done ? h.escS : null;
    if (!helper) {
      const c = nearestScrew(px, pz, [lead], HELP.R);
      if (c) { helper = c; c._escort = true; c.hunt = 0; c._chase = null; }
      else if (S && S.cst && S.cst.prog > HELP.CALL_PROG && helpCalled !== h) {
        // he is losing you: he calls it in, and the nearest man comes running
        helpCalled = h;
        const far = nearestScrew(px, pz, [lead], HELP.CALL_R);
        if (far) sendTo(far, px, pz);
        if (A.say) A.say(lead, "Need a hand here!", 1.8);
      }
    }
    if (!helper) return;
    if (V.assisting && V.assisting(helper) === S && S) return;      // his hands are on you: the verb walks him
    const d = gdDist(helper);
    // nothing to join yet (his partner is still stepping in, or you are being
    // got up off the floor): he closes in and stands ready at your shoulder
    const ready = S && !(S.verb === "cuff" && S.phase === "approach" && !S.ground);
    if (!ready || d > HELP.JOIN_R || !V.assist(helper, S)) {
      screwStep(helper, px, pz, ready ? 0.9 : 1.6, px, pz, d > 4, dt);
    }
  }

  function arrestTick(dt) {
    const a = arrest, gd = a.gd;
    if (a.phase === "take") {
      // arrest.js has the hands; its callbacks move us on. A take that ended
      // with none of them (cancelled under us) must not leave the arrest
      // parked on "take" for good: it is a chase again.
      if (a.take && a.take.done && arrest === a) backToChase(gd);
      return;
    }
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
      // the probes are still landing / he is still locked upright: hands go
      // on the man on the FLOOR, never on one half way down (that was a
      // standing cuff started under a fall that began a beat later)
      const settling = !!(AR() && AR().tasePending && AR().tasePending());
      if (subdued && !settling && d <= ESC.REACH + 0.5) {
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
    if (esc || haul) return null;
    if (down) {
      // A WANTED MAN ON THE FLOOR: the screw with eyes on him goes to the
      // body and, in reach with nothing between, kneels on him for the cuffs
      if (!down.law || gd.kind === "warden" || !arrestGuardOk(gd) || down.excl.indexOf(gd) >= 0) return null;
      if (!down.lead || !arrestGuardOk(down.lead) || down.lead._escort) down.lead = gd;
      if (down.lead !== gd) return ARREST.STANDOFF + 1.2;
      if (down.t >= LAW.BEAT && gdDist(gd) <= LAW.NEAR && lineTo(gd) && floorTake(gd)) return ESC.REACH;
      return ESC.REACH;
    }
    // AT THE WHEEL OF A STAFF CAR (world/prisonoutside.js). A screw cannot
    // cuff a man in a moving car; one that has stopped, he opens the door on
    // and takes him out of, and the arrest goes on as on foot.
    if (player.driving) {
      const car = player._vehicle;
      const sp = car ? Math.max(Math.abs(car.v || 0), Math.hypot(car.vx || 0, car.vz || 0)) : 0;
      if (sp > 1.5 || gdDist(gd) > ESC.REACH + 2.2) return ARREST.STANDOFF;
      if (CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      if (player.driving) return ARREST.STANDOFF;
    }
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
  // prison only: in the city F is get in / get out, never a trigger
  addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "f" && g.mode === "escape") fire(); });

  // (runs even when not playing)
  CBZ.onAlways(70, function () {
    // A door we shut must never outlive the mode that shut it: the escape tick
    // below returns early outside "escape", so the release cannot live there.
    if (heldDoor != null && CBZ.game.mode !== "escape") { releasePlayerCell(); confineT = 0; confineShown = -1; }
  });
  // leaving play (title / won / lost) — the shared run-lifecycle dispatcher
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) {
    // not on PAUSE: a pause mid-haul used to end the scene and set you loose
    CBZ.jailBoost.onStateExit(function () {
      endEscort(); releasePlayerCell(); confineT = 0; confineShown = -1;
      dropHelper(false);
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
  let sentShown = -1, sentCallT = 0;
  // (THE DAY BEAT that lived here — "Yard time!", "Chow!", "Count time!" on its
  // own 160-second loop, racking the cells whatever the hour — is gone. The
  // prison's one day is systems/prisonschedule.js, and a sentence is served
  // inside it like any other run.)
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
      // the stretch, for whatever reads the objective string (not painted)
      if (CBZ.setObjective) CBZ.setObjective("Time left: " + s + "s.");
    }
    if (g.jailSentence <= 0) {
      g.jailSentence = 0;
      // the gate opening is the announcement.
      releasePlayerCell();                  // nothing of ours stays shut past the gate
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
    intakeT = 0; intakeStep = 0;
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

  /* THE INTAKE, IN ORDER. You are in the cell; the door locks; then the man
     who brought you in has his line (the warden if he is on the wing to say
     it, else the nearest screw); then the count is called and cleared; and
     only after that does the block's day go on: systems/prisonschedule.js's
     move out to the yard and the warden's "Yard's open" PA both wait on
     CBZ.prisonIntakeActive. Lines go over the speaker's head, nowhere else. */
  let intakeT = -1, intakeStep = 0;
  function nearestGuard(r) {
    let best = null, bd = r * r;
    for (const gd of CBZ.guards || []) {
      if (!gd || gd.dead || gd.ko > 0 || !gd.group || gd.kind === "warden") continue;
      const dx = gd.group.position.x - player.pos.x, dz = gd.group.position.z - player.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    return best;
  }
  function guardLine(line, r) {
    const gd = nearestGuard(r || 40);
    if (!gd) return false;
    try { if (CBZ.prisonSay) return !!CBZ.prisonSay(gd, line, { secs: 2.6, force: true }); } catch (e) {}
    return false;
  }
  function intakeTick(dt) {
    if (intakeT < 0) return;
    if (player.dead || g.mode !== "escape") { intakeT = -1; return; }
    intakeT += dt;
    // 1. the door must actually be shut on him before anybody speaks
    if (intakeStep === 0) {
      if (heldDoor == null && intakeT < 4) return;
      intakeStep = 1; intakeT = 0;
    }
    // 2. the greeting, or a screw's line
    if (intakeStep === 1 && intakeT >= 0.8) {
      intakeStep = 2;
      const said = CBZ.prisonWardenGreet ? CBZ.prisonWardenGreet({ x: player.pos.x, z: player.pos.z }) : false;
      if (!said) guardLine("Fresh one. On your bunk, it's count.");
    }
    // 3. the count, called and cleared
    if (intakeStep === 2 && intakeT >= 3.6) { intakeStep = 3; guardLine("Count! Stand by your bunks!"); }
    if (intakeStep === 3 && intakeT >= 7.2) { intakeStep = 4; guardLine("Count's clear."); }
    // 4. the day goes on once the confinement has let him out
    if (intakeStep >= 4 && confineT <= 0) intakeT = -1;
  }
  CBZ.prisonIntakeActive = function () { return intakeT >= 0; };

  /* BAIL ON THE INMATE PHONES. A man Gang City sent here with a bail set
     (g.jailBail, consumed from the booking by state.js) can make the call
     from the yard's phone bank (world/yardfurniture.js, three handsets on the
     back panel at x 11 +/- 1.15, z 17.2): his own money if the street wallet
     holds it, else Lou's Bonds for the premium, else his crew. The call is
     city/wanted.js's CBZ.cityBail, the same door the booking desk uses; a
     posted bail opens the gate (games/jail.js cityJailRelease "bail") with
     the charge still open. */
  const PHONES = [{ x: 9.85, z: 17.2 }, { x: 11, z: 17.2 }, { x: 12.15, z: 17.2 }];
  let phoneBusy = 0;
  function bailWay() {
    const T = CBZ.cityBailTerms ? CBZ.cityBailTerms() : null;
    if (!T || !T.amount) return null;
    const m = function (n) { return "$" + Math.round(n).toLocaleString(); };
    if (T.self) return { how: "self", verb: "Call", sub: "post your bail, " + m(T.amount) };
    if (T.bond) return { how: "bond", verb: "Call", sub: "Lou's Bonds, " + m(T.bondFee) };
    if (T.crew) return { how: "crew", verb: "Call", sub: "your crew, for the " + m(T.amount) };
    return { how: null, verb: "Call", sub: "bail " + m(T.amount) + ", nobody to pay it" };
  }
  CBZ.cityBailPhone = function () {
    if (phoneBusy > 0) return false;
    const w = bailWay();
    phoneBusy = 1.5;
    if (!w || !w.how) { if (CBZ.prisonSay) { try { CBZ.prisonSay({ pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, kind: "pa", data: { name: "" } }, "No answer.", { secs: 1.6, force: true }); } catch (e) {} } return false; }
    return !!(CBZ.cityBail && CBZ.cityBail(w.how));
  };
  function phoneTick(dt) {
    if (phoneBusy > 0) phoneBusy -= dt;
    if (!CBZ.prisonPrompt || (+g.jailBail || 0) <= 0 || !g.cityWorld || player.dead || confineT > 0) return;
    let best = null, bd = 2.2 * 2.2;
    for (let i = 0; i < PHONES.length; i++) {
      const dx = player.pos.x - PHONES[i].x, dz = player.pos.z - (PHONES[i].z + 0.7);
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = PHONES[i]; }
    }
    if (!best) return;
    const w = bailWay(); if (!w) return;
    if (CBZ.prisonPrompt("bail-phone", "@cityBailPhone", w.verb, { at: { x: best.x, y: 1.4, z: best.z + 0.15 }, d2: bd, sub: w.sub, bind: true, noReach: true }) && CBZ.keys && CBZ.keys.e) CBZ.cityBailPhone();
  }

  // ---- HEALING: out of a fight for REGEN_WAIT s you come back slowly to
  // REGEN_CAP; standing with Doc Mercer in the infirmary puts you back to full.
  const REGEN_WAIT = 8, REGEN_CAP = 70, REGEN_RATE = 2.2, DOC_RATE = 14, DOC_R = 3.6;
  function healTick(dt) {
    if (player.dead || down || esc) return;
    const hp = player.hp == null ? 100 : player.hp;
    const px = player.pos.x, pz = player.pos.z;
    const V = VIT();
    const hurt = !!V && (V.bleeding(player) || V.blood(player) < 0.98 || (V.lame && V.lame(player) < 0.75));
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
    // new run? clear every leftover before anything else ticks
    if (pollStrikeRun && pollStrikeRun()) {
      endEscort(); releasePlayerCell();
      dropHelper(false);
      cancelArrest(false); haulEnd(true);
      confineT = 0; confineShown = -1; cellWatchCD = 0; sentShown = -1;
      intakeDone = false; lastServed = -1; intakeT = -1; intakeStep = 0;
      arrest = null; down = null; deathT = 0; lawGraceT = 0; holeRelease = false;
      if (CBZ.vitals) CBZ.vitals.reset(player);
      lastHurtT = -1e9; spdPX = null; pSpd = 0;
    }
    // ...and if you were SENT here, you wake in the cell with the door shut.
    // (BEFORE the sentence clock: its first frame calls the yard, and a new
    // arrival is counted in his locked cell first, then let out to it)
    intakeWatch();
    // A served sentence RELEASES you mid-tick (mode -> city, world rebuilt).
    // Everything below this line is escape-mode plumbing and must not run
    // against a city that has just been built underneath it.
    sentenceTick(dt);
    if (CBZ.game.mode !== "escape") return;

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

    intakeTick(dt);
    phoneTick(dt);

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
          if (gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0 || gd.hunt > 0 || gd._escort || (gd.investigate && gd.investigate.t > 0)) continue;
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
      dropHelper(false);
      if (arrest) cancelArrest(false);
      down = null;
      player.captureState = "dead";
      player.captureT = 0;
      player.stun = 0;
      player.subdue = 0;
      confineT = 0; confineShown = -1;
      releasePlayerCell();          // never leave a corpse sealed in
      CBZ.playerChar.cuffed = false;
      // a ragdolled body is posed by its points (city/ragdoll.js, order 25);
      // tipping the group over here would twist the pose it just wrote
      if (ragged && !(CBZ.ragdollPoints && CBZ.ragdollPoints(WOUND_ACTOR))) ragged = false;
      // (a body already lying in the rig's fall stays as it lies: rolling the
      // group on top of the fall laid him down twice)
      // a death that did not floor the rig (bled out, a fall): it goes down
      // in the rig's own collapse, not the plank rolled about its feet
      if (!ragged && !(CBZ.playerChar.fall && CBZ.playerChar.fall.on) && CBZ.bodyFall && CBZ.bodyFall.floorOnly) {
        try { CBZ.bodyFall.floorOnly(CBZ.playerChar, { dead: true, ko: true }); } catch (e) { /* no rig fall */ }
      }
      if (!ragged && !(CBZ.playerChar.fall && CBZ.playerChar.fall.on)) CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, Math.PI / 2, 11, dt);
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
    // the second officer's hands on any live take (cuffs, the walk)
    helperTick(dt);
    // on the floor: the screws are coming, and steel can still finish you
    if (down) { downTick(dt); return; }
    if (arrest) {
      arrestTick(dt);
      // a lunge that never resolved (he was knocked off it): it is a chase again
      if (arrest && arrest.phase === "tackle" && arrest.t > 6 && !seizedBy) { arrest.phase = "chase"; arrest.gd._escort = false; }
    }
    healTick(dt);

    /* THE OLD PRONE ROLL IS GONE. A "tased" / "tackled" / "cuffed" capture
       state used to roll the whole player group 90 degrees onto its side AND
       add 0.28 rad to the torso pitch every frame, on top of the real fall
       the rig was already playing (meleeposes.js): two bodies lying down at
       once, one of them spinning. The rig's fall is the one way down now;
       this only counts the state's clock and eases a stale roll back out. */
    if (player.captureT > 0) {
      player.captureT -= dt;
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
