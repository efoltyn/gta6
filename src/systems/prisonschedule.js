/* ============================================================
   systems/prisonschedule.js — THE PRISON DAY.

   OWNER: time of day is the PILLAR of the escape game. A cell key matters
   because your cell locks at night. A dark corner matters because the yard
   is floodlit and the block is not. The best escape window is the one you
   have to break out of your own cell to use.

   None of that is possible while "time of day" is a lighting effect. Before
   this file the prison had a 150-second sun and NOTHING that read it except
   the searchlights' brightness and one soft NPC curfew keyed to
   CBZ.nightAmount > 0.72 — a number, not a schedule. Nothing locked, nothing
   opened, nobody was ever anywhere because of the hour.

   So the day is carved into the blocks a real prison actually runs, and the
   blocks are ENGINE TRUTH: CBZ.prisonSchedule answers "what block is it",
   "how long until the next one" and "is this body supposed to be here right
   now". Guard behaviour, NPC routines, lighting and (later) the security
   tiers all read THIS clock instead of each inventing another one.

   ------------------------------------------------------------------
   THE TIMETABLE (in-game hours; core/daynight.js gives escape mode a
   12-minute day, so an in-game hour is 30 real seconds).

     05:00  wake     Unlock and morning count — doors rack open, block only
     07:00  yard     Morning yard — the compound is open
     11:30  mess     Chow
     13:00  work     Afternoon yard / work detail
     17:00  supper   Evening chow
     18:30  count    Evening return — everyone back to the block
     21:00  secure   Secure and count — cell doors LOCK, lights still on
     22:00  night    LIGHTS OUT — dark, curfew, searchlights own the yard

   Sunrise is 06:00 and sunset 18:00 (the sun's own arc — see hourNow()), so
   the morning unlock and the evening return both happen in the dark, which
   is when the torches come out. That is not decoration: it is the hour the
   block is most confused and least well lit.

   ------------------------------------------------------------------
   SHOW, DON'T TELL. This file prints NOTHING. A block change is a PA klaxon
   from a real horn on a real wall (the nearest one to you, so it has a
   place), the cell doors racking on world/cellblock.js's own sliding leaves,
   the lights going out (systems/prisonnight.js) and the guards changing
   post. If you want to know what time it is, look at the sky and listen.

   THE CELL KEY IS THE WHOLE POINT. Cell doors lock through cellblock.js's
   setDoor — the SAME collider-and-leaf mechanism the keycard door uses — so
   there is exactly one kind of locked door in this prison. Beating it is
   physical and takes no prompt: walk into your own locked door holding a
   Cell Key and it slides. A door you opened that way stays open for the
   rest of the night (`_keyed`), because staff re-securing the wing at
   lights-out do not re-check a door that reads as locked.

   ------------------------------------------------------------------
   THE BLOCK GATE IS PART OF THE TIMETABLE, AND WAS NEVER WIRED TO IT
   (2026-08-16). The table above says men cross between the block and the
   compound twice a day — `wake` is "Unlock and morning count", `count` is
   "Evening return — everyone back to the block". world/door.js's 5.72 x 0.34 m
   leaf at (0, -8) is the only way across, and nothing but the player's keycard
   had ever moved it. MEASURED at the night block: thirteen mustered men
   standing in a heap at z -6.2..-7.3, all thirteen aimed at (0, -9.8) on the
   far side of that slab, and all fifty cell-house racks behind it. A 0.5 m
   body cannot pass the band z[-8.5,-7.5] at any x. The evening return has
   therefore never once been physically possible.

   So §3 racks it, and the rule is the narrowest one that works: THE GATE IS
   OPEN ONLY WHILE A COUNT IS BEING TAKEN, MEN ARE STILL OUT, AND THE LIGHTS
   ARE STILL ON. It never opens for yard, chow, work or supper — at those hours
   the keycard is the only way through, byte for byte as before — and it shuts
   the moment the last man is in, at the 22:00 lights-out klaxon, or when the
   hold below runs out, whichever comes first. Every hour the escape is
   actually played, it is shut and the card is the only answer.

   The cell leaves get the same rule for the same reason: a leaf does not rack
   shut while a man who sleeps behind it is still outside it, which is what
   "secure and count" means and is already the shape of the refusal that will
   not close a door on the player. Both holds are bounded — GATE_HOLD from the
   evening return, CELL_HOLD from secure — because the wing will wait for a
   straggler and it will not wait all night; a man it stops waiting for loses
   his rack to somebody who can reach one. The PLAYER's cell is never held: it
   has no NPC on its racks, so it locks on the 21:00 klaxon exactly as before
   and the Cell Key is worth exactly what it was worth.

   Flags: PRISON_SCHEDULE_V1 (all of it), PRISON_SCHEDULE_DOORS (the night
   lock alone), PRISON_SCHEDULE_PA (the klaxon alone),
   PRISON_LIGHTSOUT_V2 (the 2026-08-16 routing wave: the count gate, the door
   hold, the route home, and the housing predicate).
   Ratchet: CBZ.prisonScheduleAudit().gaps pinned at 0 — every hour of the
   day belongs to exactly one block — and .hudText pinned at 0.
   Ratchet: CBZ.prisonScheduleAudit().gateOpenOffCount pinned at 0 — the block
   gate is never open outside a count, which is the keycard's whole value.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // systems/dayplan.js owns the CLOCK; this file owns the TIMETABLE. Tagged
  // before us in index.html, so its absence is a mis-wired page, not a mode.
  if (!CBZ || typeof CBZ.onUpdate !== "function" || !CBZ.dayPlan) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PRISON_SCHEDULE_V1 == null) CFG.PRISON_SCHEDULE_V1 = true;
  if (CFG.PRISON_SCHEDULE_DOORS == null) CFG.PRISON_SCHEDULE_DOORS = true;
  if (CFG.PRISON_SCHEDULE_PA == null) CFG.PRISON_SCHEDULE_PA = true;
  // one flag for the whole 2026-08-16 lights-out wave, shared with
  // systems/prisonrest.js and entities/npc.js — see the header
  if (CFG.PRISON_LIGHTSOUT_V2 == null) CFG.PRISON_LIGHTSOUT_V2 = true;
  function v2() { return CFG.PRISON_LIGHTSOUT_V2 !== false; }

  const root = CBZ.prisonRoot || CBZ.scene;
  const WORLD = CBZ.WORLD || { cellBlock: { x0: -16, x1: 16, z0: -44, z1: -8 } };
  const CB = WORLD.cellBlock;

  /* ==========================================================
     1. THE TIMETABLE. `from` is the in-game hour the block starts;
        each block runs until the next one starts (wrapping midnight).

          cells    "lock" | "open" | null (leave the wing as it is)
          lightsOut the wing's own lamps are killed (prisonnight.js)
          home     where a body is supposed to be: "cell" | "block" | null
          pa       how many klaxon blasts announce it (0 = silent)
          torches  the night shift draws flashlights during this block
     ========================================================== */
  const BLOCKS = [
    { id: "wake",   label: "Unlock & Count",  from: 5.0,  cells: "open", lightsOut: false, home: "block", pa: 2, torches: true },
    { id: "yard",   label: "Morning Yard",    from: 7.0,  cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "mess",   label: "Chow",            from: 11.5, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "work",   label: "Work & Yard",     from: 13.0, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "supper", label: "Evening Chow",    from: 17.0, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "count",  label: "Evening Return",  from: 18.5, cells: null,   lightsOut: false, home: "block", pa: 2, torches: true },
    { id: "secure", label: "Secure & Count",  from: 21.0, cells: "lock", lightsOut: false, home: "cell",  pa: 3, torches: true },
    { id: "night",  label: "Lights Out",      from: 22.0, cells: "lock", lightsOut: true,  home: "cell",  pa: 1, torches: true },
  ];
  // Curfew = the hours a body found in the open is a break in progress. Both
  // "cell" blocks; kept as its own predicate so a later security tier can
  // widen it without re-reading the table.
  function isCurfew(b) { return !!b && b.home === "cell"; }

  /* ---- THE CLOCK IS NOT OURS. systems/dayplan.js owns the arithmetic every
       game with a day in it needs and gets subtly wrong: the last block
       wrapping through midnight, "how long until the next one" wrapping with
       it, the SILENT arm when a run begins mid-block (a klaxon for an hour
       that passed while nobody was playing is a lie) and the day length,
       which is the world's own sun (CBZ.dayPhase, sunrise 6) and never a
       private accumulator — that is what makes a saved/restored world land in
       the right block.

       THE TABLE ABOVE IS HANDED OVER BY REFERENCE AND IS NEVER COPIED.
       systems/prisontiers.js mutates `from`/`cells`/`home`/`pa` in place per
       regime, and the plan reads the new numbers on the next question. ---- */
  const PLAN = CBZ.dayPlan.define("prison", BLOCKS, { enabled: on });
  function hourNow() { return PLAN.hour(); }
  function daySecs() { return PLAN.dayLength(); }
  function secsPerHour() { return PLAN.hourLength(); }
  function nextOf(b) { return BLOCKS[(BLOCKS.indexOf(b) + 1) % BLOCKS.length]; }

  /* ==========================================================
     2. THE PA. A klaxon that comes from nowhere is a HUD line you cannot
        read, so the block change is voiced by the horn NEAREST the player
        — real geometry, on a real wall — through CBZ.worldSfx, which is
        the surface for "somebody else did this" and already collapses a
        facility full of speakers into the one voice that means anything.

        `lockdown` is the bank's klaxon (125 dB, systems/audio.js). It is
        NOT a new cue: a prison PA and a lockdown alarm are the same horn,
        and what tells them apart is the PATTERN — one blast for chow, two
        for a count, three to secure the wing, against systems/lockdown.js's
        continuous 1.2 s re-fire. Volume/ref are the horn's own carry, not
        the fist-sized default worldSfx assumes.
     ========================================================== */
  const horns = [];
  function paHorn(x, y, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    // the bell, opening along the group's forward (+z) axis
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.11, 0.46, 10, 1, true), CBZ.mat(0x8d949d));
    bell.rotation.x = Math.PI / 2;
    bell.position.z = 0.23;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.16), CBZ.mat(0x5b6470));
    back.position.z = -0.06;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.22), CBZ.mat(0x3c424d));
    arm.position.z = -0.20;
    // the mouth glows only while it is sounding — a speaker you can SEE
    // shouting is the difference between a cue and an announcement.
    const lit = new THREE.Mesh(new THREE.CircleGeometry(0.27, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
    lit.position.z = 0.455;
    g.add(bell, back, arm, lit);
    g.traverse(function (o) { o.castShadow = false; });
    root.add(g);
    const rec = { x: x, y: y, z: z, group: g, lit: lit, flash: 0 };
    horns.push(rec);
    return rec;
  }
  // cell wing (walls at |x| = 16 and z = -44; the wing is open-topped so a
  // horn at 5.6 m is above every partition and below the razorwire line)
  paHorn(0, 5.6, -43.2, 0);
  paHorn(0, 5.6, -8.9, Math.PI);
  paHorn(-15.2, 5.6, -26, Math.PI / 2);
  paHorn(15.2, 5.6, -26, -Math.PI / 2);
  // north exercise yard
  paHorn(-29.4, 5.4, 20, Math.PI / 2);
  paHorn(29.4, 5.4, 20, -Math.PI / 2);
  paHorn(0, 5.4, 51.4, Math.PI);
  // south block
  paHorn(-43.4, 5.4, 84, Math.PI / 2);
  paHorn(43.4, 5.4, 84, -Math.PI / 2);
  paHorn(-43.4, 5.4, 118, Math.PI / 2);

  function nearestHorn() {
    const p = CBZ.player && CBZ.player.pos;
    if (!p || !horns.length) return horns[0] || null;
    let best = horns[0], bd = Infinity;
    for (let i = 0; i < horns.length; i++) {
      const h = horns[i];
      const d = (h.x - p.x) * (h.x - p.x) + (h.z - p.z) * (h.z - p.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  let blasts = 0, blastT = 0;
  function soundPA(n) {
    if (!CFG.PRISON_SCHEDULE_PA || !n) return;
    blasts = n; blastT = 0;
  }
  function pumpPA(dt) {
    if (blasts <= 0) return;
    blastT -= dt;
    if (blastT > 0) return;
    blasts--;
    blastT = 0.62;
    const h = nearestHorn();
    if (!h) return;
    h.flash = 0.45;
    if (CBZ.worldSfx) {
      // ref 120 m: a horn on a wall is heard across the whole compound, which
      // is what a PA IS — but the one beside you is still the loud one.
      CBZ.worldSfx("lockdown", h.x, h.z, { ref: 120, volume: 0.8, gap: 0.18, cutoff: 400, y: h.y });
    }
  }
  function pumpHornLamps(dt) {
    for (let i = 0; i < horns.length; i++) {
      const h = horns[i];
      if (h.flash <= 0) continue;
      h.flash = Math.max(0, h.flash - dt);
      h.lit.material.opacity = h.flash * 1.6;
    }
  }

  /* ==========================================================
     3. THE DOORS. Everything goes through world/cellblock.js's setDoor —
        the collider and the sliding leaf move together and the leaf voices
        itself, which is the repo's door contract. Two refusals live here:

          · a door whose opening the PLAYER is standing in is never pushed
            (that collider would appear around a body); the lock is retried
            every tick until he steps clear, which reads as the door waiting
            for him — because that is what it is doing;
          · a door the player defeated with a Cell Key this cycle is not
            re-locked at lights-out (`_keyed`, cleared at the morning
            unlock). That is the key's whole value.
     ========================================================== */
  function cells() {
    const cb = CBZ.cellblock;
    return (cb && cb.v2 && cb.cells) ? cb.cells : null;
  }
  function inDoorway(p, col, R) {
    return p.x > col.minX - R && p.x < col.maxX + R && p.z > col.minZ - R && p.z < col.maxZ + R;
  }
  /* NEVER CLOSE A DOOR ON A BODY — any body. The player's refusal has been
     here since the first draft; the residents needed none while the leash
     kept them off their own thresholds. Now they walk through those leaves
     all day, and a collider spliced in around an inmate mid-doorway is a man
     shoved through a wall by systems/actorcollide.js on the next frame. */
  function playerInDoorway(c) {
    const col = c.doorCol;
    if (!col) return false;
    const p = CBZ.player && CBZ.player.pos;
    if (p && inDoorway(p, col, 0.62)) return true;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || n.dead || n.escaped || n._crowd || !n.group) continue;
      if (inDoorway(n.group.position, col, 0.6)) return true;
    }
    return false;
  }
  let wantLocked = false, doorRetry = 0;

  /* ---- THE HOLD. A wing that secures on the clock alone secures its own men
       OUT, and behind those leaves is most of the building — fifty of the
       sixty-six racks. So a leaf waits for the man who sleeps behind it, the
       same refusal shape `playerInDoorway` already has one line down, and the
       block gate waits for the same reason on the same timer.

       BOUNDED, because a wing that waits forever is a wing that never locks
       and the escape game is built on it locking. Ninety seconds is 3 in-game
       hours at escape's 30 s/hour — long enough for the walk in from the sally
       port (165 m at 1.5-2.8 m/s), short enough that the wing is sealed well
       before the useful part of the night. When a hold expires the stragglers
       lose their racks (prisonRest.release) so a mattress is not held all
       night by a man in the yard, and everything shuts.

       TWO TIMERS, BECAUSE THERE ARE TWO RULES AND THEY START AT DIFFERENT
       KLAXONS. The block gate's patience runs from the EVENING RETURN, which
       is when the men are ordered in; the cell leaves' runs from SECURE, which
       is when the wing is ordered shut. A single timer armed at the return has
       about fifteen seconds left by the time the leaves are asked for any,
       which is no patience at all. ---- */
  /* 110 s is the evening return through to lights-out — 18:30 to 22:00 is
     3.5 in-game hours at 30 s each — and it is a CEILING, not a duration: the
     gate shuts the moment the count is in, and `lightsOut` shuts it regardless.
     Measured at 90: eight men still in the south block when the budget ran out,
     locked out of a wing with fifteen free racks in it, `abed` 0.78. The walk
     in from the sally port is 165 m and the timetable already allows for it. */
  const GATE_HOLD = 110, CELL_HOLD = 90;
  let gateT = 0, holdT = 0, waiting = [], gateOpen = false, gateOffCount = 0;
  function rest() { return CBZ.prisonRest || null; }
  function counting() { const b = live(); return !!(b && b.home !== null); }
  // is the block gate one this file may move at all — a blown slab is a hole
  // (LAW 4) and a leaf the player deliberately latched shut is his
  function gateUsable() { const d = CBZ.door; return !!(d && !d.blown); }
  /* THE GATE THIS FILE MOVES IS THE ONE THIS FILE OPENED. Two refusals, and
     both are the player's:
       · a leaf he DELIBERATELY latched shut (systems/interactions.js's LAW 3)
         is not re-opened by staff on the next count;
       · a leaf HE opened with the keycard is never slammed on him — the whole
         escape is built on that card, and a schedule that undid it would be
         this file taking the game's own objective away. So the close only
         fires on a gate `gateMine` says we racked. */
  let gateMine = false;
  function setGate(want) {
    if (!v2() || !gateUsable()) return;
    const d = CBZ.door;
    gateOpen = !!d.open;
    if (gateOpen === want) { if (!want) gateMine = false; return; }
    if (want) {
      if (CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-yard-door")) return;
      if (CBZ.openDoor) CBZ.openDoor();
      gateMine = !!d.open;
    } else {
      if (!gateMine) return;                      // his card, his door
      if (CBZ.closeDoor) {
        CBZ.closeDoor(true);                      // soft: interactions.js ramps the leaf
        if (CBZ.worldSfx) CBZ.worldSfx("door_close", 0, -8, { ref: 12 });
      }
      gateMine = false;
    }
    gateOpen = !!d.open;
  }

  function driveDoors(dt) {
    if (!CFG.PRISON_SCHEDULE_DOORS) return;
    const list = cells();
    if (!list) return;
    doorRetry -= dt;
    if (doorRetry > 0) return;
    doorRetry = 0.35;
    const cb = CBZ.cellblock;
    const R = rest();
    // WHO THE WING IS STILL WAITING FOR, asked once for the whole sweep.
    const hold = v2() && wantLocked && holdT > 0 && R && R.unsettled;
    if (hold) R.unsettled(waiting); else waiting.length = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const want = wantLocked && !c._keyed && !(hold && waiting.indexOf(c) >= 0);
      if (!!c.locked === want) continue;
      if (playerInDoorway(c)) continue;         // never close a door on a body
      cb.setDoor(c, want);
    }
    /* ---- and the block gate. It is open only while a count is running and
         the wing is not yet full; every other hour it is exactly the keycard
         door it has always been. `gateOffCount` is the ratchet: this file must
         never leave it open outside a count. ---- */
    if (v2()) {
      setGate(gateWanted());
      // …and only ever OUR gate: a leaf the player opened with his own card at
      // 02:00 is the game working, not this file leaving the wing unlocked.
      if (gateMine && gateOpen && !counting()) gateOffCount++;
    }
  }

  /* THE CELL KEY, and no prompt for it. A locked door you are pressed
     against, with the key in your pocket, opens — the contact IS the verb
     (doctrine LAW 5: physics, not another button). `_keyed` survives until
     the morning unlock, so one stolen key buys one whole night. */
  function tryCellKey() {
    const list = cells();
    const p = CBZ.player && CBZ.player.pos;
    if (!list || !p || !wantLocked) return;
    if (!(CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Cell Key"))) return;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.locked) continue;
      const dx = p.x - c.doorX, dz = p.z - c.doorZ;
      if (dx * dx + dz * dz > 1.45 * 1.45) continue;
      c._keyed = true;
      CBZ.cellblock.setDoor(c, false);          // voices its own leaf
      if (CBZ.sfx) CBZ.sfx("key");              // YOU turned it: global is honest
      return;
    }
  }

  /* ==========================================================
     4. WHERE A BODY BELONGS. The one question later phases ask.
     ========================================================== */
  function inBlock(x, z, pad) {
    pad = pad || 0;
    return x > CB.x0 - pad && x < CB.x1 + pad && z > CB.z0 - pad && z < CB.z1 + pad;
  }
  function inHousing(x, z, pad) {
    if (inBlock(x, z, pad)) return true;
    const h = CBZ.prisonHousing;
    return !!(h && h.contains && h.contains(x, z, pad));
  }
  function inAssignedHousing(n, x, z, pad) {
    const m = n && n._muster;
    const h = CBZ.prisonHousing;
    if (m && m.unit && h && h.id === m.unit && h.contains)
      return !!h.contains(x, z, pad);
    return inBlock(x, z, pad);
  }
  /* CAN THIS MAN GET TO THAT RACK — the question systems/prisonrest.js must
     ask before it writes his name on a mattress, and the reason it has to ask
     THIS file is that this file is the one holding the keys. Two doors can
     stand between a body and a bed:

       the block gate   world/door.js's leaf. Passable if it is open, blown, or
                        going to be racked for the count that is running.
       his own cell     passable if the leaf is not locked, and a leaf being
                        HELD open for him counts as not locked because
                        driveDoors above is holding it for exactly this man.

     Optimistic on purpose while the hold is live: the wing IS about to open
     for him, and re-shuffling every claim on the frame the klaxon sounds is a
     game of musical chairs. Pessimistic the moment the hold expires, which is
     what re-homes a straggler onto a rack he can still reach. */
  /* Is the block gate open, or about to be racked for the count that is
     running? One sentence: OPEN ONLY WHILE A COUNT IS RUNNING, MEN ARE STILL
     OUT, AND THE LIGHTS ARE STILL ON.

     `lightsOut` is the hard floor and it is the timetable's own field, not a
     timer — at 22:00 the leaf is shut whatever the count says, which is every
     hour the escape is actually played. Before that the gate follows the COUNT
     rather than the clock, because a wing that racks its gate at 21:00 with
     men still in the yard has not secured them, it has locked them out: that
     read `!wantLocked` in the first draft and left four men outside with
     nowhere to lie down. `gateT` bounds it either way (90 s from the return,
     i.e. shut by 21:30 in-game at 30 s/hour) so the gate closes on its own
     even if a straggler never arrives. */
  function gateWanted() {
    const b = live(), R = rest();
    return counting() && !(b && b.lightsOut) && gateT > 0 && !!R && R.afoot() > 0;
  }
  function gatePassable() {
    const d = CBZ.door;
    if (!d) return true;                       // no such door in this build
    if (d.open || d.blown) return true;
    return gateWanted();
  }
  function canReach(n, x, z) {
    if (!v2()) return true;
    const p = n && n.group && n.group.position;
    if (!p) return true;
    const dest = inBlock(x, z, -0.4);
    if (dest && !inBlock(p.x, p.z, -0.4) && !gatePassable()) return false;
    const cb = CBZ.cellblock;
    if (!cb || !cb.cellAt) return true;
    const c = cb.cellAt(x, z, -0.1);
    if (!c || !c.locked) return true;
    return cb.cellAt(p.x, p.z, -0.1) === c;    // already behind it: he is home
  }

  function inOwnCell(x, z) {
    const cb = CBZ.cellblock;
    if (!cb || !cb.v2 || !cb.playerCell) return inBlock(x, z);
    const c = cb.playerCell;
    return x > c.x - c.hx && x < c.x + c.hx && z > c.z - c.hz && z < c.z + c.hz;
  }
  // "cell" | "block" | "compound" — coarse enough that a caller never has to
  // know the geometry, precise enough to price an offence.
  function whereIs(x, z) {
    if (!inBlock(x, z, 0.4)) return "compound";
    const cb = CBZ.cellblock;
    if (cb && cb.v2 && cb.cellAt && cb.cellAt(x, z, -0.15)) return "cell";
    return "block";
  }
  function belongs(x, z) {
    const b = live();
    if (!b || !b.home) return true;
    if (b.home === "block") return inBlock(x, z, 0.4);
    return inOwnCell(x, z) || (whereIs(x, z) === "cell");
  }

  /* ==========================================================
     5. GUARDS CHANGE POST. Derived from each guard's OWN day route rather
        than an index table, so a patrol added by systems/reinforcements.js
        (or by a later phase) is scheduled too without being listed here.

        A guard whose whole day route lives in the north yard becomes the
        BLOCK APRON detail for the indoor blocks: he walks the ground in
        front of the wing door, which is exactly where a man who is supposed
        to be inside gets turned round. Perimeter and south-block patrols do
        not move — a wire is watched at every hour.
     ========================================================== */
  const APRON = [[-7, 3], [-7, -4], [7, -4], [7, 3]];
  function yardPatrol(g) {
    if (!g.waypoints || g.waypoints.length < 2 || g.kind === "warden") return false;
    for (let i = 0; i < g.waypoints.length; i++) {
      const w = g.waypoints[i];
      if (w.z < -8 || w.z > 52 || w.x < -24 || w.x > 24) return false;
    }
    return true;
  }
  function setPost(g, night) {
    if (night) {
      if (g._dayRoute) return;
      if (!yardPatrol(g)) return;
      g._dayRoute = g.waypoints;
      g._dayTorch = g.flashlightPatrol;
      const phase2 = (g.id || 0) % APRON.length;
      g.waypoints = APRON.map(function (p, i) {
        const q = APRON[(i + phase2) % APRON.length];
        return new THREE.Vector3(q[0], 0, q[1]);
      });
      g.wi = 0;
      g.flashlightPatrol = true;               // a night shift carries a torch
    } else if (g._dayRoute) {
      g.waypoints = g._dayRoute;
      g.flashlightPatrol = g._dayTorch;
      g._dayRoute = null; g._dayTorch = null;
      g.wi = 0;
    }
  }
  function drivePosts(indoors) {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) setPost(list[i], indoors);
  }

  /* CURFEW IS A RULE ABOUT BEING SEEN, not a magic tripwire. During the two
     cell blocks a guard who lays eyes on you does not need heat first — an
     inmate in the open at 02:00 is the whole offence — so the sighting goes
     straight to a hunt. The counterweight is systems/prisonnight.js: he can
     barely see, unless he has a torch on you. */
  let curfewT = 0;
  function enforceCurfew(dt) {
    const g = CBZ.game;
    if (!isCurfew(live()) || !g || g.state !== "playing" || (g.invuln || 0) > 0) return;
    const p = CBZ.player && CBZ.player.pos;
    if (!p || (CBZ.player.captureState && CBZ.player.captureState !== "normal")) return;
    if (belongs(p.x, p.z)) return;
    const out = whereIs(p.x, p.z) === "compound";
    curfewT -= dt;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0) continue;
      if (!CBZ.guardSees || !CBZ.guardSees(gd)) continue;
      // out in the yard after lights-out is a break; out of your cell but
      // still in the wing is a lesser thing, and prices lower.
      if (CBZ.addHeat) CBZ.addHeat((out ? 26 : 10) * dt);
      gd.alert = 1.0;
      gd.investigate = null;
      gd.hunt = Math.max(gd.hunt || 0, out ? 3.4 : 2.2);
    }
    // A body crossing a floodlit yard at night is also a thing the TOWER
    // eventually notices: once every few seconds the nearest able screw is
    // sent to look, through the existing investigate plumbing. No omniscience
    // — it is a point on the ground, and it goes stale.
    if (out && curfewT <= 0 && CBZ.litBySearchlight && CBZ.litBySearchlight(p, CBZ.player.crouch)) {
      curfewT = 6;
      let best = null, bd = Infinity;
      for (let i = 0; i < list.length; i++) {
        const gd = list[i];
        if (gd.dead || gd.ko > 0 || gd.corrupt || gd.hunt > 0) continue;
        const d = (gd.group.position.x - p.x) * (gd.group.position.x - p.x) + (gd.group.position.z - p.z) * (gd.group.position.z - p.z);
        if (d < bd) { bd = d; best = gd; }
      }
      if (best) {
        best.investigate = { x: p.x, z: p.z, t: 8, scan: 0, type: "curfew" };
        best.alert = Math.max(best.alert || 0, 0.9);
      }
    }
  }

  /* ==========================================================
     6. INMATES LIVE ON THE CLOCK. At the evening return the wing's own
        residents are already leashed by world/cellblock.js; everybody ELSE
        is walked inside and given a patch of floor to stand count on.

        The owner's standing rule (entities/npc.js NPC_SCHEDULES) is that
        the GANGS keep their night hustle — so crews, dealers, thieves and
        the merchant stay out, which is also what keeps the dark yard worth
        crossing. Regions are saved and restored, never overwritten.
     ========================================================== */
  /* LOCKDOWN MEANS LOCKDOWN. This predicate read
         n.gang == null && n._cellIdx == null
     and the comment above it explained that the gangs keep their night hustle.
     MEASURED, at 02:00 on a fresh run: 42 live inmates, 32 of them carrying a
     gang, and every one of the other TEN already holding a cell — so the
     conjunction selected ZERO BODIES OUT OF FORTY-TWO. The muster was not
     lenient, it was empty, and the yard held 32 awake men in the dark because
     nothing had ever been told to move them.

     A prison closes on everybody. What the gangs keep is the NIGHT ITSELF —
     the wing is where the hustle happens after dark, not the exercise yard —
     and that is now enforced by the same clock rather than by an exemption
     nobody could see. The one class still excluded is the wing's own
     residents (`_cellIdx`): world/cellblock.js's order-22.6 leash already owns
     those bodies, and a second system writing their `target` is two movers on
     one Vector3, which is a man vibrating in his own doorway. */
  /* ...AND A SECOND CLASS WAS EXCLUDED BY ACCIDENT, FOR THE THIRD TIME.
     `role === "inmate"` is a TRADE, not a sentence — systems/prisonrest.js's
     §2 header spells this out and was widened on 2026-08-15 — and this
     predicate, which is the thing that actually MOVES a body, was not widened
     with it. MEASURED 2026-08-16 at the night block: six men with no muster,
     no bed claim and no walk — one dealer, one merchant and four thieves,
     every one of them a convict out of the same factory in the same orange.
     Asked of the factory now (entities/npc.js:26 stamps `kind`), with the old
     role test kept as an OR so nothing that counted before drops out. */
  /* ...AND THE WING'S RESIDENTS ARE HOUSED TOO, NOW (2026-09-04). The
     `_cellIdx == null` exclusion above was right while the cell leash pinned
     its men into their cells at every hour; it no longer does — a resident
     with an OPEN leaf walks the tier like anybody else (world/cellblock.js,
     "THE DOOR DECIDES") — so at the evening count he is a man in the aisle
     who has to be walked home like the rest. cellblock.held() is the one
     question that still excludes: a man behind a SHUT leaf is the leash's,
     and a second mover on his Vector3 is the vibration this comment has
     always warned about. */
  function housed(n) {
    if (!n || n._crowd || n.dead || n.escaped || !n.group) return false;
    if (!(v2() ? (n.kind === "inmate" || n.role === "inmate") : n.role === "inmate")) return false;
    const cb = CBZ.cellblock;
    if (n._cellIdx != null && cb && cb.held) return !cb.held(n);
    return n._cellIdx == null;
  }
  /* A deterministic patch of open wing floor, clear of the x = 0 patrol spine.
     THE FALLBACK ONLY: a man is sent to the place he actually sleeps whenever
     systems/prisonrest.js can name one (see muster()).

     THE GRID WAS WRITTEN FOR A THREE-ROW WING. `x = ±(3.0 + (row % 4) * 2.6)`
     reaches ±10.8 and `z` starts at -11.5, and on 2026-08-15 the cell house
     grew two inner rows into what had been 23.4 m of empty aisle: rows D and E
     now occupy x[-7.9,-4.1] and x[4.1,7.9] from z = -14.1 north, so four of
     the eight lanes park a man inside a cell wall. Never observed firing — it
     only runs when prisonRest.place() returns null, i.e. before the fittings
     have drained — but a fallback that is wrong is worse than no fallback.
     The wing's own open floor is the south cross-passage (z -13.5..-9.0, clear
     x -11..+11, measured) and the centre hall (x -1..1 at its narrowest, where
     the door pockets pinch it), so the grid lays men across the cross-passage
     and never north of it. */
  function musterSpot(i) {
    if (!v2()) {
      const side0 = (i & 1) ? 1 : -1;
      const row0 = (i / 2) | 0;
      return { x: side0 * (3.0 + (row0 % 4) * 2.6), z: -11.5 - ((row0 / 4) | 0) * 3.1 };
    }
    const side = (i & 1) ? 1 : -1;
    const row = (i / 2) | 0;                          // 48 lanes, all of them floor
    return { x: side * (1.0 + (row % 6) * 1.8), z: -9.6 - ((row / 6) | 0) * 1.1 };
  }
  /* WHERE HE IS SENT IS WHERE HE SLEEPS. The first draft parked every mustered
     man on a hash of a floor grid, and systems/prisonrest.js then walked him
     off it to a bed — one body, two destinations, seconds apart. prisonrest
     owns the housing (racks, then mats, one stable claim for the whole run),
     so it is asked, and the fallback grid is for the frames before the wing's
     fittings have been drained (index.html: this file 588, prisonrest 600). */
  function bedSpotFor(n) {
    const R = CBZ.prisonRest;
    if (!R || !R.place) return null;
    let bed = null;
    try { bed = R.place(n); } catch (e) { bed = null; }
    if (!bed) return null;
    let e = null;
    try { e = CBZ.propEntryPoint ? CBZ.propEntryPoint(bed) : null; } catch (err) { e = null; }
    const unit = bed._housingUnit || null;
    const spot = (e && e.ok) ? { x: e.x, z: e.z } : { x: bed.x, z: bed.z };
    if (unit) {
      spot.unit = unit.id || null;
      spot.route = unit.route ? { x: unit.route.x, z: unit.route.z } : null;
    }
    spot.bed = bed;
    if (v2()) spot.way = routeHome(n, bed, spot);
    return spot;
  }

  /* ==========================================================
     6b. THE ROUTE HOME IS A ROUTE, NOT A POINT.

     entities/npc.js's mover is a straight line to `target` and
     systems/actorcollide.js says so out loud: "It's not full pathfinding, so
     an NPC may bump a wall its target is behind." A single destination is
     therefore only ever correct in an empty field. MEASURED at the night
     block: thirteen men in a heap at the wing gate all aimed at one point, and
     nine more pressed against the laundry's south wall aimed diagonally
     through it at the dorm door.

     systems/navigation.js's A* was tried first and cannot do this: its escape
     grid is 2.15 m cells with 0.72 m of collider pad, which closes every
     doorway in the compound. Seven of the eight routes a man actually needs
     came back `kind: "fallback"` — no path at all. So the legs are AUTHORED
     off the wing's own published records, which is what the rest of this file
     already does with doorX/doorZ and the housing unit's `route`.

     Every coordinate below was read off a free-space sweep of the live
     colliders at a 0.5 m grid with the actor's own 0.5 m radius:

       the throat        z[-8.5,-7.5] is solid at every x until the gate racks;
                         inside it the south cross-passage z[-13.5,-9.0] is
                         clear from x -11 to +11.
       the galleries     x -11..-9 and x +9..+11, clear the whole length.
       the centre hall   x -3..+3, pinching to x -1..+1 at each door pocket, so
                         the hall is walked on x = 0 and stepped out of only
                         when the man is abeam his own door.
       the cross-aisle   z -37..-35, clear across, which is how the north row
                         (row A, doors facing +z) is reached.
       the dorm          a 1.5 m slot at z ~105.5 between the laundry's south
                         wall (z 104.3) and the dorm's north wall (z 105.8),
                         open only from the EAST — its west end is the
                         compound wall.

     THE LAST LEG IS THE DOORWAY, not the mattress, for rows B/C/D/E: standing
     in his own door a man is 2.2-2.5 m from the rack's solved entry point, and
     systems/rest.js hands over at 2.6 m, so propuse's own arc walks the last
     stretch. Row A is 3.8 m deep and he walks in.
     ========================================================== */
  const THROAT_OUT = -6.2, THROAT_IN = -10.2, CROSS_Z = -11.8, AISLE_Z = -36.2;
  function routeHome(n, bed, spot) {
    const p = n.group.position;
    const unit = bed._housingUnit || null;
    const way = [];
    if (unit && unit.route) {
      /* A PUBLISHED HOUSING UNIT STATES ITS OWN ENTRANCE and this file walks
         to it down the lane outside: 1.6 m short of the route point is the
         slot between the unit's north wall and whatever is built in front of
         it, and the lead-in comes from the open side (measured: east). */
      const apron = unit.route.z - 1.6;
      /* THE LEAD-IN IS THE COMPOUND'S CENTRE LANE, NOT THE UNIT'S OWN CORNER.
         Measured: with the lead-in at the dorm's east edge (bounds.x1 + 3),
         men coming from the yard walked a diagonal straight into the
         workshop's north-east corner and stopped there — two of them pinned at
         (-25.5, 79.3) and (-24.7, 79.3) at 23:00, both still on leg 0 with a
         reachable rack waiting. x = 0 is open from z 60 to the sally port and
         the apron lane is open from x -43 eastward, so the dog-leg out to the
         middle and back is the only pair of legs with no building on them. */
      way.push({ x: 0, z: apron });
      way.push({ x: unit.route.x, z: apron });
      way.push({ x: unit.route.x, z: unit.route.z });
    } else {
      // HIS OWN LANE ACROSS THE THROAT. One aim point for thirteen men is a
      // plug; the lane is a hash of the RACK, so it is the same every night.
      const h = CBZ.hash01 ? CBZ.hash01(bed.x, bed.z, 4517) : 0.5;
      const lane = -2.1 + h * 4.2;
      way.push({ x: lane, z: THROAT_OUT });
      way.push({ x: lane, z: THROAT_IN });
      const cb = CBZ.cellblock;
      const c = (cb && cb.cellAt) ? cb.cellAt(bed.x, bed.z, -0.1) : null;
      if (c) {
        const mid = (c.oa + c.ob) / 2;
        if (c.dx !== 0) {
          // a side row: up its own gallery, or up the middle of the hall when
          // the door opens onto the hall (|mouth| < 8 m from the spine)
          const mouthX = c.faceX + c.dx * 1.35;
          const aisleX = Math.abs(mouthX) > 8 ? mouthX : 0;
          way.push({ x: aisleX, z: CROSS_Z });
          way.push({ x: aisleX, z: c.faceZ + mid });
          if (aisleX !== mouthX) way.push({ x: mouthX, z: c.faceZ + mid });
        } else {
          // the north row: up the hall to the cross-aisle, then across it
          way.push({ x: 0, z: CROSS_Z });
          way.push({ x: 0, z: AISLE_Z });
          way.push({ x: c.faceX + mid, z: AISLE_Z });
        }
        way.push({ x: c.doorX, z: c.doorZ });
      } else {
        way.push({ x: 0, z: CROSS_Z });
      }
    }
    way.push({ x: spot.x, z: spot.z });
    /* START HIM ON THE LEG HE HAS NOT ALREADY WALKED. A man rounded up INSIDE
       his own housing must not be marched back out to the gate to come in
       again — which is what a route always starting at leg 0 would do to every
       body the muster catches indoors. */
    const home = unit && unit.contains ? unit.contains : function (x, z, pad) { return inBlock(x, z, pad); };
    let wi = 0;
    if (home(p.x, p.z, -0.4)) while (wi < way.length - 1 && !home(way[wi].x, way[wi].z, -0.4)) wi++;
    n._wayI = wi;
    return way;
  }

  /* ---- TAKING THE COUNT. It used to be a one-shot edge (`if (on ===
       mustered) return`), so a man who was fighting, KO'd, out of the wing or
       simply not yet born when the klaxon sounded never got a destination for
       the rest of the night, and a man whose rack was released got no second
       one. MEASURED: six men with no muster at all at 23:00 and three racks
       with two names. The count is now RE-TAKEN on a cadence for as long as a
       count block is running, and it only touches men who need it. ---- */
  let mustered = false, nextSpot = 0;
  function musterOne(n, i) {
    if (!n._dayRegion) n._dayRegion = n.region;
    // his lane is HIS: a man the recount keeps re-asking about must not shuffle
    // sideways across the cross-passage every half second while he waits
    if (n._spotI == null) n._spotI = i;
    const s = bedSpotFor(n) || musterSpot(n._spotI);
    if (s.z < CB.z0 + 2) return false;                   // ran out of wing floor
    n.region = [s.x - 1.1, s.x + 1.1, s.z - 1.1, s.z + 1.1];
    n.target.set(s.x, 0, s.z);
    n._muster = s;
    n._bedX = n._bedZ = null;                            // npc.js re-reads the new spot
    n._homeD = Infinity; n._homeT = 0; n._homeLeg = null; // the stall detector starts over
    return true;
  }
  /* THE FALLBACK GRID IS A RING, NOT A RAY. `nextSpot` is bumped by every
     re-count, and unbounded it walks the lanes north out of the cross-passage
     and into the cell rows — measured, men parked at z -26 inside row D. There
     are 48 authored lanes; index 49 is lane 1 again, which is a man standing
     beside another man and not a man standing inside a wall. */
  const SPOTS = 48;
  function bumpSpot() { nextSpot = (nextSpot + 1) % SPOTS; }
  function muster(on) {
    if (on === mustered) return;
    mustered = on;
    nextSpot = 0;
    const list = CBZ.npcs || [];
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      if (!housed(n)) continue;
      if (on) { if (musterOne(n, nextSpot)) bumpSpot(); }
      else if (n._dayRegion) {
        n.region = n._dayRegion;
        n._dayRegion = null; n._muster = null; n._wayI = 0; n._spotI = null;
        n._bedX = n._bedZ = null;                        // npc.js re-rolls at the next curfew
      }
    }
  }
  /* Everybody the first pass could not place, and everybody whose rack has
     since gone. Bounded: at most RECOUNT bodies per tick, so a wing that loses
     twenty claims at once does not land twenty route builds on one frame. */
  const RECOUNT = 3;
  let recountAt = 0;
  function recount(dt) {
    if (!v2() || !mustered) return;
    recountAt -= dt;
    if (recountAt > 0) return;
    recountAt = 0.5;
    const list = CBZ.npcs || [];
    let did = 0;
    for (let k = 0; k < list.length && did < RECOUNT; k++) {
      const n = list[k];
      if (!housed(n) || n._propLie) continue;
      const m = n._muster;
      // a spot with a rack that is still his is fine; a man standing on the
      // FALLBACK grid has no rack at all and is asked again every pass, because
      // the thing he is waiting for is a mattress coming free
      if (m && m.bed && m.bed._claim === n && n._restBed === m.bed) continue;
      if (musterOne(n, nextSpot)) { bumpSpot(); did++; }
    }
  }

  /* ---- THE STALL. The legs above are authored, so they are right about the
       geometry this wing has today and will be wrong the first time somebody
       builds a wall across one. Rather than trust them, MEASURE: a man who has
       not closed a metre on his own bed in STALL seconds is not walking there,
       whatever the route says. He gives the rack back — permanently, so
       CBZ.rest.claim does not hand him the same unreachable one next tick —
       and the recount above finds him another. That is also the only thing
       standing between a bad waypoint and a body pressed against a wall until
       dawn, which is the fault this whole wave is about. ---- */
  const STALL = 14, STALL_STEP = 1.0;
  let stallAt = 0;
  function stalls(dt) {
    if (!v2() || !mustered) return;
    stallAt -= dt;
    if (stallAt > 0) return;
    stallAt = 1.0;
    const R = rest();
    const list = CBZ.npcs || [];
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      if (!housed(n) || n._propLie || !n._muster) continue;
      if (n.ko > 0 || n.aiState === "fight" || n.aiState === "flee") { n._homeT = 0; continue; }
      /* MEASURED AGAINST THE LEG HE IS WALKING, NOT THE BED. A route is a
         dog-leg by construction — up the hall, across the cross-aisle, into
         the door — so a man obeying it perfectly spends whole legs getting
         FURTHER from the mattress. The first draft measured to the bed and
         took five men's racks away for walking their own route correctly. */
      const p = n.group.position, m = n._muster;
      const way = m.way;
      const leg = (way && way.length) ? way[Math.min(n._wayI | 0, way.length - 1)] : m;
      const d = Math.hypot(leg.x - p.x, leg.z - p.z);
      // reaching a leg resets the clock: progress is progress
      if (n._homeLeg !== leg) { n._homeLeg = leg; n._homeD = d; n._homeT = 0; continue; }
      if (d < (n._homeD == null ? Infinity : n._homeD) - STALL_STEP) { n._homeD = d; n._homeT = 0; continue; }
      n._homeT = (n._homeT || 0) + 1.0;
      if (n._homeT < STALL) continue;
      n._homeT = 0; n._homeD = Infinity; n._homeLeg = null;
      if (R && R.release) R.release(n, true);
      n._muster = null; n._wayI = 0;              // recount() gives him another
    }
  }
  /* …and the guards physically move them. WHERE an inmate walks is npc.js's
     curfew branch (it reads `_muster` and routes through the wing door);
     what a screw closing on you changes is WHETHER YOU DAWDLE. So herding
     drops the stand/idle routine and the pause on any loose inmate inside
     8 m of an apron guard, and nothing here fights the mover for the target
     — two systems writing one Vector3 is how a body vibrates in place. */
  /* HOW HARD THE WING CLOSES IS THE SECURITY LEVEL, and it is two numbers a
     player can feel without a word on screen:

       herdR  how close a screw has to be before you stop dawdling. On the
              county farm (6 m) you have to be almost standing on him; in
              segregation (15 m) his being anywhere near the lane is enough.
       grace  what fraction of the muster block may elapse before a straggler
              is actively COLLECTED. LOW spends more than half the block
              tolerating men drifting in; ULTRA has none — the horn is the
              order and the screws walk the compound on the next breath.
       sweep  whether anybody comes to get you at all. Off below HIGH: at the
              easy end being late is simply being late.

     The sweep reuses the investigate plumbing entities/guards.js already has,
     so a "sweep" is one able screw walking to the furthest man still outside
     and looking at him. No new AI state, no narration, and it reads exactly
     like what it is: an officer coming to collect you. */
  // how far through the current block we are, 0..1 — the plan's, so the
  // sweep's grace window and the public `progress()` cannot disagree
  function progress() { return PLAN.progress(); }
  function musterRule() {
    const T = CBZ.prisonTier;
    const m = (T && T.knob) ? T.knob("muster") : null;
    return m || { herdR: 8.0, grace: 0.35, sweep: false };
  }
  let sweepCd = 0;
  function herd(dt) {
    if (!mustered) return;
    const rule = musterRule();
    const R2 = rule.herdR * rule.herdR;
    const list = CBZ.npcs || [];
    const gl = CBZ.guards || [];
    let worst = null, wd = 0;
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      if (!housed(n) || !n._muster || n.ko > 0) continue;
      if (n.aiState === "fight" || n.aiState === "flee") continue;
      const p = n.group.position;
      if (inAssignedHousing(n, p.x, p.z, -0.5)) continue;
      const far = (p.x - n._muster.x) * (p.x - n._muster.x) + (p.z - n._muster.z) * (p.z - n._muster.z);
      if (far > wd) { wd = far; worst = n; }
      for (let j = 0; j < gl.length; j++) {
        const gd = gl[j];
        if (!gd._dayRoute || gd.dead || gd.ko > 0) continue;
        const dx = gd.group.position.x - p.x, dz = gd.group.position.z - p.z;
        if (dx * dx + dz * dz > R2) continue;
        n.pause = 0;
        n._lifeActivity = null; n._lifeT = 0;              // move, inmate
        break;
      }
    }
    // ---- THE SWEEP -------------------------------------------------------
    sweepCd -= dt || 0;
    if (!rule.sweep || !worst || sweepCd > 0) return;
    if (progress() < rule.grace) return;                   // still inside the grace window
    sweepCd = 5;
    const p = worst.group.position;
    let best = null, bd = Infinity;
    for (let j = 0; j < gl.length; j++) {
      const gd = gl[j];
      if (gd.dead || gd.ko > 0 || gd.corrupt || (gd.hunt || 0) > 0) continue;
      const d = (gd.group.position.x - p.x) * (gd.group.position.x - p.x)
        + (gd.group.position.z - p.z) * (gd.group.position.z - p.z);
      if (d < bd) { bd = d; best = gd; }
    }
    if (best) {
      best.investigate = { x: p.x, z: p.z, t: 9, scan: 0, type: "muster" };
      best.alert = Math.max(best.alert || 0, 0.55);
    }
  }

  /* ==========================================================
     7. APPLYING A BLOCK
     ========================================================== */
  function live() { return PLAN.block(); }

  function apply(b, announce, prev) {
    if (b.cells === "lock") wantLocked = true;
    else if (b.cells === "open") {
      wantLocked = false;
      const list = cells();
      if (list) for (let i = 0; i < list.length; i++) list[i]._keyed = false;   // the night's key expires
    }
    // never rack a wing open in the middle of a facility lockdown
    if (!wantLocked && (CBZ.game.detection || 0) >= 90) wantLocked = true;
    // THE DOORS MOVE ON THE KLAXON, not up to a retry interval later. The
    // 0.35 s gate below exists for the deferred case (a body in the opening),
    // and core/loop.js clamps world dt to 0.10 s — so on a slow frame that
    // gate is many real seconds, and a wing that racks shut long after the
    // horn reads as two unrelated events instead of one order being obeyed.
    doorRetry = 0;
    /* A LOCK-UP ARMS THE HOLD ONCE, ON ITS FIRST BLOCK. count -> secure ->
       night is ONE lock-up with three klaxons in it, not three; re-arming on
       each of them (which the first draft did) hands the wing a fresh ninety
       seconds of patience at 22:00 and the gate is still standing open at
       23:00, which is the escape objective left ajar all night. Measured:
       `hold` read 89.4 and `gateOpen` true at the night block. */
    if (b.home === null) { gateT = 0; holdT = 0; }
    else {
      // the two blocks that ORDER men across the gate: `wake` (cells open) and
      // `count` (cells null). `secure` and `night` lock the wing and arm the
      // leaves' own patience instead — the gate's own budget carries over from
      // the return, so the count can finish across the 21:00 klaxon.
      if (b.cells !== "lock") gateT = GATE_HOLD;
      else if (!prev || prev.cells !== "lock") holdT = CELL_HOLD;
    }
    drivePosts(b.home !== null);
    muster(b.home !== null);
    if (announce) soundPA(b.pa);
  }

  /* ==========================================================
     8. THE TICK
     ========================================================== */
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.5) : null;

  /* A RUN CAN START AT ANY HOUR — the sky clock runs on the title screen — so
     the plan lands in the block that is ACTUALLY running and tells us it was
     not a change (`first`). Every later transition announces itself. */
  PLAN.on(function (b, prev, first) { apply(b, !first, prev); });

  function reset() {
    PLAN.rearm(); blasts = 0;
    const list = cells();
    if (list) for (let i = 0; i < list.length; i++) list[i]._keyed = false;
    muster(false);
    drivePosts(false);
    wantLocked = false;
    gateT = 0; holdT = 0; waiting.length = 0; gateOpen = false; gateOffCount = 0; gateMine = false;
    // the block gate goes back the way the build left it — shut, keycard only
    if (v2() && gateUsable() && CBZ.door.open && CBZ.closeDoor) CBZ.closeDoor();
    if (list && CBZ.cellblock.resetDoors) CBZ.cellblock.resetDoors();
  }
  // Tear down when the RUN ends, never on a PAUSE: `paused` is a state exit
  // like any other to the shared dispatcher, and unlocking the wing there
  // would slide twenty-five leaves open behind the pause card and slam them shut
  // again the instant you resumed. (states: title/playing/paused/won/lost —
  // systems/state.js setState.)
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) CBZ.jailBoost.onStateExit(reset, ["title", "won", "lost"]);

  function on() { return CFG.PRISON_SCHEDULE_V1 !== false && CBZ.game && CBZ.game.mode === "escape"; }

  CBZ.onUpdate(19.5, function (dt) {
    if (!on()) return;
    if (pollNewRun && pollNewRun()) reset();

    PLAN.poll(dt);            // fires apply() through the listener above

    /* THE HOLD RUNS DOWN WHILE THE COUNT IS BEING TAKEN, and the instant it
       reaches zero the wing stops waiting: every man still holding a rack he
       has not reached gives it up (so the mattress is not held all night by a
       body in the yard) and driveDoors racks everything shut on the next
       0.35 s pass. This is the one thing that guarantees the compound is
       sealed at night whatever happened during the count. */
    if (v2() && counting()) {
      if (gateT > 0) gateT = Math.max(0, gateT - dt);
      if (holdT > 0) {
        holdT -= dt;
        if (holdT <= 0) {
          holdT = 0;
          const R = rest(), list = CBZ.npcs || [];
          for (let k = 0; k < list.length; k++) {
            const n = list[k];
            if (!housed(n) || n._propLie || !n._restBed) continue;
            if (canReach(n, n._restBed.x, n._restBed.z)) continue;
            if (R && R.release) R.release(n, true);
            n._muster = null; n._wayI = 0;
          }
        }
      }
    }

    driveDoors(dt);
    tryCellKey();
    enforceCurfew(dt);
    herd(dt);
    recount(dt);
    stalls(dt);
    pumpPA(dt);
  });
  // the horn's own lamp fades on menus too, so a paused game does not freeze
  // a speaker mid-shout
  CBZ.onAlways(19.6, function (dt) { pumpHornLamps(dt); });

  /* ==========================================================
     9. THE CONTRACT — what every later phase reads instead of inventing
        its own clock.
     ========================================================== */
  CBZ.prisonSchedule = {
    enabled: on,
    blocks: BLOCKS,
    hour: hourNow,
    // {h, m} — for anything that needs a real time (a wall clock prop, a
    // guard's watch). Deliberately NOT a HUD string.
    clock: function () { const h = hourNow(); return { h: h | 0, m: ((h % 1) * 60) | 0 }; },
    block: live,
    id: function () { return live().id; },
    is: function (id) { return live().id === id; },
    next: function () { return nextOf(live()); },
    // real seconds until the next block starts
    until: function () { return PLAN.until(); },
    progress: progress,
    dayLength: daySecs,
    hourLength: secsPerHour,
    curfew: function () { return isCurfew(live()); },
    lightsOut: function () { return !!live().lightsOut && on(); },
    indoors: function () { return live().home !== null; },
    torches: function () { return !!live().torches; },
    cellsLocked: function () { return wantLocked; },
    // "is this body supposed to be here right now"
    belongs: belongs,
    where: whereIs,
    inBlock: inBlock,
    inHousing: inHousing,
    inAssignedHousing: inAssignedHousing,
    // "can this man get to that rack right now" — systems/prisonrest.js's
    // reachability test, answered by the file holding the keys
    canReach: canReach,
    counting: counting,
    // the PA, for anything that legitimately announces itself (a later
    // security tier, a recapture): n blasts from the nearest real horn
    announce: soundPA,
    horns: horns,
  };

  /* THE RATCHET. `gaps` is the invariant that makes the table trustworthy:
     every one of the 24 hours belongs to exactly one block, so nothing can
     fall through into "no schedule". `hudText` is pinned at 0 because this
     system's whole design is that it never prints — if it ever grows a
     toast, this number is where it shows up. */
  CBZ.prisonScheduleAudit = function () {
    // both invariants are the shared plan's, measured on the LIVE table, so a
    // regime that rewrites `from` is checked by the same test as the default
    const pa = PLAN.audit();
    const gaps = pa.gaps, sorted = pa.ordered;
    const list = cells();
    let locked = 0, keyed = 0;
    if (list) for (let i = 0; i < list.length; i++) { if (list[i].locked) locked++; if (list[i]._keyed) keyed++; }
    return {
      on: on(), gaps: gaps, ordered: sorted, hudText: 0,
      blocks: BLOCKS.length, horns: horns.length,
      dayLength: daySecs(), hourLength: secsPerHour(),
      hour: Math.round(hourNow() * 100) / 100,
      block: live().id, until: Math.round(CBZ.prisonSchedule.until() * 10) / 10,
      curfew: isCurfew(live()), lightsOut: !!live().lightsOut,
      wantLocked: wantLocked, lockedDoors: locked, keyedDoors: keyed,
      mustered: mustered,
      nightPosts: (CBZ.guards || []).filter(function (g) { return !!g._dayRoute; }).length,
      // the 2026-08-16 count gate. `gateOpenOffCount` is the ratchet: the
      // keycard leaf may only ever stand open while a count is being taken.
      v2: v2(), counting: counting(),
      hold: Math.round(holdT * 10) / 10, gateHold: Math.round(gateT * 10) / 10,
      gateOpen: !!(CBZ.door && CBZ.door.open), gateOpenOffCount: gateOffCount,
      heldOpenCells: waiting.length,
    };
  };
})();
