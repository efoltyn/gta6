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

   Flags: PRISON_SCHEDULE_V1 (all of it), PRISON_SCHEDULE_DOORS (the night
   lock alone), PRISON_SCHEDULE_PA (the klaxon alone).
   Ratchet: CBZ.prisonScheduleAudit().gaps pinned at 0 — every hour of the
   day belongs to exactly one block — and .hudText pinned at 0.
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
  function playerInDoorway(c) {
    const p = CBZ.player && CBZ.player.pos;
    const col = c.doorCol;
    if (!p || !col) return false;
    const R = 0.62;
    return p.x > col.minX - R && p.x < col.maxX + R && p.z > col.minZ - R && p.z < col.maxZ + R;
  }
  let wantLocked = false, doorRetry = 0;
  function driveDoors(dt) {
    if (!CFG.PRISON_SCHEDULE_DOORS) return;
    const list = cells();
    if (!list) return;
    doorRetry -= dt;
    if (doorRetry > 0) return;
    doorRetry = 0.35;
    const cb = CBZ.cellblock;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const want = wantLocked && !c._keyed;
      if (!!c.locked === want) continue;
      if (playerInDoorway(c)) continue;         // never close a door on a body
      cb.setDoor(c, want);
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
  function housed(n) {
    return n && !n._crowd && !n.dead && !n.escaped && n.role === "inmate" &&
      n._cellIdx == null && n.group;
  }
  // a deterministic patch of open wing floor, clear of the x = 0 patrol spine.
  // THE FALLBACK ONLY: a man is sent to the place he actually sleeps whenever
  // systems/prisonrest.js can name one (see muster()).
  function musterSpot(i) {
    const side = (i & 1) ? 1 : -1;
    const row = (i / 2) | 0;
    return { x: side * (3.0 + (row % 4) * 2.6), z: -11.5 - ((row / 4) | 0) * 3.1 };
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
    return spot;
  }
  let mustered = false;
  function muster(on) {
    if (on === mustered) return;
    mustered = on;
    const list = CBZ.npcs || [];
    let i = 0;
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      if (!housed(n)) continue;
      if (on) {
        if (!n._dayRegion) n._dayRegion = n.region;
        const s = bedSpotFor(n) || musterSpot(i++);
        if (s.z < CB.z0 + 2) continue;                     // ran out of wing floor
        n.region = [s.x - 1.1, s.x + 1.1, s.z - 1.1, s.z + 1.1];
        n.target.set(s.x, 0, s.z);
        n._muster = s;
      } else if (n._dayRegion) {
        n.region = n._dayRegion;
        n._dayRegion = null; n._muster = null;
        n._bedX = n._bedZ = null;                          // npc.js re-rolls at the next curfew
      }
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

  function apply(b, announce) {
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
  PLAN.on(function (b, prev, first) { apply(b, !first); });

  function reset() {
    PLAN.rearm(); blasts = 0;
    const list = cells();
    if (list) for (let i = 0; i < list.length; i++) list[i]._keyed = false;
    muster(false);
    drivePosts(false);
    wantLocked = false;
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

    driveDoors(dt);
    tryCellKey();
    enforceCurfew(dt);
    herd(dt);
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
    };
  };
})();
