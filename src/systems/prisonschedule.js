/* ============================================================
   systems/prisonschedule.js — THE PRISON DAY.

   A real 24-hour day on the world's own sun (core/daynight.js: escape runs
   a 12-minute day, 30 real seconds an hour). NOTHING ON SCREEN SAYS WHAT
   TIME IT IS. The hour shows only in the world: the sky, the lamps, the PA
   horn, the doors racking and what the officers do.

     00:00  blackout  every lamp in the wing out (systems/prisonnight.js reads
                      is("blackout")), cells locked, curfew
     05:00  wake      the morning count in LOCKED cells, then the doors rack
     07:00  yard      the block is taken OUT: the gate opens, an officer calls
                      it, every man walks out to the yard, and an officer
                      comes to YOUR cell and sends you out with them
     11:30  mess      chow, in the yard's mess hall
     13:00  work      yard / work detail
     17:00  supper    chow
     18:30  count     the evening return: the gate opens, everyone walks in,
                      and if you are still out an officer comes for you
     21:00  secure    the cells lock and the count walks the tiers
     22:00  night     lights out, curfew
   ...and one or two counts nobody announces, between 23:00 and 04:15,
   walked with torches.

   THE COUNT. One or two officers walk the galleries and look into every
   cell. You in yours: they walk on. Not there: the count is short. The PA
   says so and they search: your cell first, then where you were last seen,
   then the places a man hides (vents, hatches, yard corners), torches out in
   the dark. The officer who finds you orders you back and walks behind you
   to your cell, which is held open for you. Not found in 2.5 hours, it is an
   escape and the warden locks the prison down.

   EVERY MOVE OF YOU IS AN ORDER (systems/command.js toPlayer): said, said
   again, the last word, then hands (CBZ.verbs.escort, an arm-bar walk). Do
   it and the officer walks a pace behind you; stop or turn back and he says
   it again, then takes your arm. Pull free or run and it is the arrest
   (systems/capture.js) and the hole.

   THE GATE (world/door.js) is shut every hour but two: the morning move out
   and the evening return. It also opens for a man being walked across it.
   At any other time the keycard is the only way through. A lockdown shuts
   it and cancels the yard.

   Officers on these jobs carry `_duty`; entities/guards.js hands their legs
   to dutyStep() below (after a hunt, which always wins).
   Console: CBZ.dayJump(7) starts the yard move, (18.5) the return, (21) the
   lock-in count, (0) the blackout, (5) the morning count.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // This file's CONFIG defaults are published at parse: other files read
  // them before (or without) the prison ever being built.
  if (CBZ.CONFIG.PRISON_SCHEDULE_V1 == null) CBZ.CONFIG.PRISON_SCHEDULE_V1 = true;
  if (CBZ.CONFIG.PRISON_SCHEDULE_DOORS == null) CBZ.CONFIG.PRISON_SCHEDULE_DOORS = true;
  if (CBZ.CONFIG.PRISON_SCHEDULE_PA == null) CBZ.CONFIG.PRISON_SCHEDULE_PA = true;
  if (CBZ.CONFIG.PRISON_LIGHTSOUT_V2 == null) CBZ.CONFIG.PRISON_LIGHTSOUT_V2 = true;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("systems/prisonschedule.js", function () {
  // systems/dayplan.js owns the CLOCK; this file owns the TIMETABLE. Tagged
  // before us in index.html, so its absence is a mis-wired page, not a mode.
  if (!CBZ || typeof CBZ.onUpdate !== "function" || !CBZ.dayPlan) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // one flag for the whole 2026-08-16 lights-out wave, shared with
  // systems/prisonrest.js and entities/npc.js — see the header
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
          count    the officers walk the tiers and count the cells

        BLACKOUT IS FIRST because the table is ascending from midnight
        (systems/dayplan.js); `night` now runs 22:00 to 00:00.
        systems/prisontiers.js rewrites from/cells/home/pa/torches of the
        eight ids it knows and leaves the blackout alone.
     ========================================================== */
  const BLOCKS = [
    { id: "blackout", label: "Blackout",      from: 0.0,  cells: "lock", lightsOut: true,  home: "cell",  pa: 0, torches: true },
    { id: "wake",   label: "Unlock & Count",  from: 5.0,  cells: "open", lightsOut: false, home: "block", pa: 2, torches: true, count: true },
    { id: "yard",   label: "Morning Yard",    from: 7.0,  cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "mess",   label: "Chow",            from: 11.5, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "work",   label: "Work & Yard",     from: 13.0, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "supper", label: "Evening Chow",    from: 17.0, cells: null,   lightsOut: false, home: null,    pa: 1, torches: false },
    { id: "count",  label: "Evening Return",  from: 18.5, cells: null,   lightsOut: false, home: "block", pa: 2, torches: true },
    { id: "secure", label: "Secure & Count",  from: 21.0, cells: "lock", lightsOut: false, home: "cell",  pa: 3, torches: true, count: true },
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
  /* ...AND THE SAME TABLE IS EVERY INMATE'S ROUTINE IN CBZ.brain.needs, so
     brain.needs.current(inmate) (and brain.tick's routine) answers with the
     prison's own block — `activity` is the block id. Handed over by
     reference like the plan, so prisontiers' regime edits land in both. */
  for (let i = 0; i < BLOCKS.length; i++) if (BLOCKS[i].activity == null) BLOCKS[i].activity = BLOCKS[i].id;
  if (CBZ.brain && CBZ.brain.needs) CBZ.brain.needs.define("inmate", BLOCKS);
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
  /* THE HORN ITSELF (rebuilt 2026-09-28; owner, iPad at night: a PA horn
     "floating in the sky" with no pole or wall). It was a straight open cone,
     a box and a stick, placed at a typed coordinate whether or not a wall was
     still there, and its mouth glowed yellow while it sounded (a speaker does
     not light up). Now: a real re-entrant PA horn (a flared spun-aluminium
     bell on a compression driver) in a U-bracket on a wall plate, and it is
     MOUNTED: at build it looks for the wall behind it and bolts itself to
     that face; with no wall there it stands on its own galvanized pole. */
  const HORN = (function () {
    const BGU = THREE.BufferGeometryUtils;
    const merge = function (list) { return BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(list, false) : list[0]; };
    const m4 = new THREE.Matrix4(), eu = new THREE.Euler();
    const at = function (g, x, y, z, rx, ry, rz) { eu.set(rx || 0, ry || 0, rz || 0); m4.makeRotationFromEuler(eu).setPosition(x || 0, y || 0, z || 0); return g.applyMatrix4(m4); };
    const noUv = function (g) { if (g.getAttribute("uv")) g.deleteAttribute("uv"); return g; };
    // the bell: an exponential flare from the 5 cm throat to a 27 cm mouth
    // with a rolled lip, lathed about +y then laid along +z
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(0.05 + 0.2 * Math.pow(t, 2.2), t * 0.42));
    }
    pts.push(new THREE.Vector2(0.272, 0.425), new THREE.Vector2(0.278, 0.415), new THREE.Vector2(0.262, 0.41));
    const bell = noUv(at(new THREE.LatheGeometry(pts, 20), 0, 0, 0.02, Math.PI / 2));
    const driver = merge([
      noUv(at(new THREE.CylinderGeometry(0.1, 0.1, 0.15, 16), 0, 0, -0.06, Math.PI / 2)),     // the driver can
      noUv(at(new THREE.CylinderGeometry(0.075, 0.1, 0.04, 16), 0, 0, -0.155, Math.PI / 2)),  // its domed back
      noUv(at(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 12), 0, 0, 0.03, Math.PI / 2)),  // throat collar
      noUv(at(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), 0.07, -0.1, -0.12, 0.6)),    // the cable gland
    ]);
    // U-bracket round the driver, pivot bolts, and a 12 cm arm to a wall plate
    const bracket = merge([
      noUv(at(new THREE.BoxGeometry(0.02, 0.05, 0.2), -0.115, 0, -0.08)),
      noUv(at(new THREE.BoxGeometry(0.02, 0.05, 0.2), 0.115, 0, -0.08)),
      noUv(at(new THREE.BoxGeometry(0.25, 0.05, 0.02), 0, 0, -0.19)),
      noUv(at(new THREE.CylinderGeometry(0.018, 0.018, 0.27, 8), 0, 0, -0.06, 0, 0, Math.PI / 2)),
      noUv(at(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), 0, 0, -0.25, Math.PI / 2)),
      noUv(at(new THREE.BoxGeometry(0.16, 0.22, 0.014), 0, 0, -0.317)),
    ]);
    // a pole mount: a 76 mm galvanized pole and its base plate (unit height)
    const pole = new THREE.CylinderGeometry(0.038, 0.045, 1, 10);
    pole.translate(0, 0.5, 0);
    const plate = new THREE.BoxGeometry(0.3, 0.02, 0.3);
    const alu = new THREE.MeshLambertMaterial({ color: 0xb9bec3, side: THREE.DoubleSide });
    return {
      bell: bell, driver: driver, bracket: bracket, pole: pole, plate: plate,
      alu: alu,
      dark: new THREE.MeshLambertMaterial({ color: 0x2e3238 }),
      galv: new THREE.MeshLambertMaterial({ color: 0x9aa2aa }),
    };
  })();
  // How far behind (x, z) at height y is the nearest solid face, looking
  // back along -forward? null = nothing within reach.
  function wallBehind(x, y, z, fx, fz) {
    const cs = CBZ.colliders || [];
    for (let d = 0.05; d <= 1.6; d += 0.05) {
      const px = x - fx * d, pz = z - fz * d;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (!c || c.rail) continue;
        if (px > c.minX && px < c.maxX && pz > c.minZ && pz < c.maxZ &&
            (c.y1 == null || c.y1 >= y + 0.3) && (c.y0 == null || c.y0 <= y)) return d;
      }
    }
    return null;
  }
  function paHorn(x, y, z, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const d = wallBehind(x, y, z, fx, fz);
    if (d != null) {
      // bolt the plate (0.324 m behind the bell's pivot) onto the wall face
      const k = d - 0.33;
      x -= fx * k; z -= fz * k;
    } else {
      // no wall: its own pole, the horn clamped on top, 33 cm behind the bell
      const px = x - fx * 0.33, pz = z - fz * 0.33;
      const floor = CBZ.floorAt ? Math.max(0, CBZ.floorAt(px, pz, 0) || 0) : 0;
      const pole = new THREE.Mesh(HORN.pole, HORN.galv);
      pole.position.set(px, floor, pz);
      pole.scale.y = y + 0.28 - floor;
      root.add(pole);
      const plate = new THREE.Mesh(HORN.plate, HORN.galv);
      plate.position.set(px, floor + 0.01, pz);
      root.add(plate);
      if (CBZ.colliders) CBZ.colliders.push({ minX: px - 0.08, maxX: px + 0.08, minZ: pz - 0.08, maxZ: pz + 0.08, noBreach: true });
    }
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.order = "YXZ";
    g.rotation.y = yaw;
    g.rotation.x = 0.18;                                // aimed a little down at the people it talks to
    g.add(new THREE.Mesh(HORN.bell, HORN.alu), new THREE.Mesh(HORN.driver, HORN.dark), new THREE.Mesh(HORN.bracket, HORN.galv));
    root.add(g);
    const rec = { x: x, y: y, z: z, group: g, flash: 0, mount: d != null ? "wall" : "pole" };
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
  paHorn(6.0, 5.4, 51.4, Math.PI);   // on the wall beside the walkway gate; at x 0 it hung in the gate's open air
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
  // (the horn used to light its mouth while it sounded; a speaker does not glow)
  function pumpHornLamps(dt) {
    for (let i = 0; i < horns.length; i++) if (horns[i].flash > 0) horns[i].flash = Math.max(0, horns[i].flash - dt);
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
    // ...and the officer who just walked a man to it, or is counting at it
    const gl = CBZ.guards || [];
    for (let i = 0; i < gl.length; i++) {
      const gd = gl[i];
      if (gd && gd.group && !gd.dead && inDoorway(gd.group.position, col, 0.6)) return true;
    }
    return false;
  }
  let wantLocked = false, doorRetry = 0;

  /* ---- THE HOLDS. A leaf waits for the man who sleeps behind it, and the
       gate waits for the men still walking in at the evening return. Both are
       bounded: CELL_HOLD from secure, GATE_HOLD (a ceiling, 18:30 to 22:00)
       from the return. When the cell hold runs out the stragglers lose their
       racks (prisonRest.release) and everything shuts. ---- */
  const GATE_HOLD = 110, CELL_HOLD = 90;
  let gateT = 0, holdT = 0, waiting = [], gateOpen = false, gateOffMove = 0;
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
  // a body standing in either doorway of the sally port (the inner pair at
  // z -8, the out pair at z -3.75): the leaves wait for him to step through
  function inGateway(p) { return Math.abs(p.x) < 1.7 && ((p.z > -9.3 && p.z < -6.7) || (p.z > -5.0 && p.z < -2.5)); }
  function gateBodies() {
    const p = CBZ.player && CBZ.player.pos;
    if (p && inGateway(p)) return true;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n && n.group && !n.dead && !n.escaped && !n._crowd && inGateway(n.group.position)) return true;
    }
    const gl = CBZ.guards || [];
    for (let i = 0; i < gl.length; i++) {
      const gd = gl[i];
      if (gd && gd.group && !gd.dead && inGateway(gd.group.position)) return true;
    }
    return false;
  }
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
      if (gateBodies()) return;                   // never shut on a man in the doorway
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
    // the hole is systems/capture.js's: a sealed cell is never opened from here
    const sealed = !!(CBZ.playerCellSealed && CBZ.playerCellSealed());
    // YOUR door waits for you while an officer (or an arrest) is walking you to it
    const yours = playerDoorHeld();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.player && sealed) continue;
      const want = wantLocked && !c._keyed && !(hold && waiting.indexOf(c) >= 0) && !(c.player && yours);
      if (!!c.locked === want) continue;
      if (playerInDoorway(c)) continue;         // never close a door on a body
      cb.setDoor(c, want);
    }
    /* ---- and the block gate: open for the day's two moves and for a man
         being walked across it, shut every other minute (the keycard's whole
         value). `gateOffMove` counts passes that leave OUR gate open with no
         move to justify it; it stays at 0. A leaf the player opened with his
         own card is his and is never counted or closed. ---- */
    if (v2()) {
      const want = gateWanted();
      setGate(want);
      if (gateMine && gateOpen && !want && !gateBodies()) gateOffMove++;
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
      if (Math.abs((p.y || 0) - (c.fy || 0)) > 1.2) continue;   // the tier over it is not at it
      c._keyed = true;
      CBZ.cellblock.setDoor(c, false, true);    // voices its own leaf
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
  /* IS THE GATE WANTED OPEN. Never in a lockdown. Open while a man is being
     walked across it (an order to the yard or home, an arrest walking him in),
     for the morning move out, and for the evening return while men are still
     out and the lights are on (`gateT` bounds it). Shut every other minute. */
  function gateWanted() {
    if (lockdownOn()) return false;
    if (crossing()) return true;
    if (move) return true;
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

  /* A BODY IN A FLOODLIT YARD AT NIGHT is a thing the TOWER eventually
     notices: every few seconds the nearest able screw is sent to look,
     through the investigate plumbing. A point on the ground, and it goes
     stale. (What a screw who SEES you out does is watchOut() below.) */
  let curfewT = 0;
  function towerNotice(dt) {
    curfewT -= dt;
    const g = CBZ.game;
    if (curfewT > 0 || !isCurfew(live()) || !g || g.state !== "playing" || (g.invuln || 0) > 0 || g.role === "cop") return;
    const p = CBZ.player && CBZ.player.pos;
    if (!p || whereIs(p.x, p.z) !== "compound") return;
    if (!(CBZ.litBySearchlight && CBZ.litBySearchlight(p, CBZ.player.crouch))) return;
    curfewT = 6;
    const list = CBZ.guards || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (gd.dead || gd.ko > 0 || gd.corrupt || gd.hunt > 0 || gd._duty) continue;
      const d = (gd.group.position.x - p.x) * (gd.group.position.x - p.x) + (gd.group.position.z - p.z) * (gd.group.position.z - p.z);
      if (d < bd) { bd = d; best = gd; }
    }
    if (best) {
      best.investigate = { x: p.x, z: p.z, t: 8, scan: 0, type: "curfew" };
      best.alert = Math.max(best.alert || 0, 0.9);
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
                         since 2026-09-29 it is a sally port: inner pair
                         x[-1.2,1.2] at z -8, a vestibule to z -3.6, the out
                         pair x[-1.2,1.2] at z -3.75 (world/door.js);
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
  const THROAT_APRON = -1.4, THROAT_OUT = -6.2, THROAT_IN = -10.2, CROSS_Z = -11.8, AISLE_Z = -36.2;
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
      // The throat is the unit's SALLY PORT now (world/door.js): a 2.4 m
      // steel pair at each end of a vestibule. The lane is inside that
      // clear width, and the first leg is the apron in front of the out
      // door, so nobody walks a diagonal into the vestibule's side wall.
      const h = CBZ.hash01 ? CBZ.hash01(bed.x, bed.z, 4517) : 0.5;
      const lane = -0.7 + h * 1.4;
      way.push({ x: lane, z: THROAT_APRON });
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
     7. OFFICERS ON A SCHEDULE JOB carry `_duty` ({ kind: "take" | "count",
        torch }). entities/guards.js calls dutyStep() for them every frame,
        after a hunt (which always wins): they still see, and in the dark
        their torch is on.
     ========================================================== */
  function lockdownOn() { return !!(CBZ.lockdownActive && CBZ.lockdownActive()); }
  function ableGuard(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !gd.tied && gd.kind !== "warden" &&
      !gd.towerPost && gd.intimidMode !== "scared");
  }
  // on somebody else's job (the warden's, an arrest, a yard case, a door)
  function otherJob(gd) {
    return !!(gd._escort || gd._wardenEscort || gd._wardenCall || gd._shakedown || gd._snitchTask ||
      gd._pcEscort || gd._yardCase || gd._doorCase || gd._wardenDetail);
  }
  function freeGuard(gd) {
    return ableGuard(gd) && !gd._duty && !otherJob(gd) && !(gd.hunt > 0) &&
      !(gd.investigate && gd.investigate.t > 0) && !(gd.pause > 0) &&
      !(CBZ.verbs && CBZ.verbs.sessionOf && CBZ.verbs.sessionOf(gd));
  }
  function nearestGuard(x, z, maxD, test) {
    let best = null, bd = maxD * maxD;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!test(gd)) continue;
      const dx = gd.group.position.x - x, dz = gd.group.position.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    return best;
  }
  function say(actor, line, secs) {
    if (!line || !actor || !CBZ.prisonSay) return false;
    try { return !!CBZ.prisonSay(actor, line, { force: true, secs: secs || 2.0 }); } catch (e) { return false; }
  }
  // the PA's words come out of the horn nearest you, after its blasts
  let paLine = null, paLineT = 0;
  function paSay(line, n) {
    if (!CFG.PRISON_SCHEDULE_PA) return;
    soundPA(n || 1);
    paLine = line; paLineT = 0.4 + (n || 1) * 0.62;
  }
  function pumpPaLine(dt) {
    if (!paLine) return;
    paLineT -= dt;
    if (paLineT > 0) return;
    const h = nearestHorn(), line = paLine;
    paLine = null;
    if (h) say({ kind: "pa", data: { name: "Control" }, pos: { x: h.x, y: (h.y || 3.5) - 1.85, z: h.z } }, line, 2.6);
  }

  // ---- the player, as the timetable sees him
  function P() { return CBZ.player && CBZ.player.pos; }
  function inmatePlayer() {
    const g = CBZ.game;
    return !!(g && g.state === "playing" && g.mode === "escape" && g.role !== "cop" && CBZ.player && !CBZ.player.dead);
  }
  // somebody else's hands are on him: an arrest, the walk to the hole, the medics
  function inCustody() {
    const pl = CBZ.player;
    if (!pl || pl.dead) return true;
    if (CBZ.jailEscortPhase && CBZ.jailEscortPhase()) return true;
    if (CBZ.playerDowned && CBZ.playerDowned()) return true;
    if (CBZ.prisonArrestPhase && CBZ.prisonArrestPhase()) return true;
    if (CBZ.prisonHaul && CBZ.prisonHaul()) return true;
    if (CBZ.arrest && CBZ.arrest.active && CBZ.arrest.active()) return true;
    return !!(pl.captureState && pl.captureState !== "normal");
  }
  function wardenHas() { const W = CBZ.warden; return !!(W && W.pass && W.pass()); }
  function noYard() { const W = CBZ.warden; return !!(W && W.noYard && W.noYard()); }
  function orderLive() { const C = CBZ.command; return !!(C && C.playerOrders && C.playerOrders().length); }
  // nobody sends him anywhere: not an inmate, already in somebody's hands, in
  // the hole, with the warden, or behind a wheel
  function excused() {
    return !inmatePlayer() || inCustody() || wardenHas() || !!CBZ.player.driving ||
      !!(CBZ.playerCellSealed && CBZ.playerCellSealed());
  }
  function pcell() {
    const cb = CBZ.cellblock, c = cb && cb.v2 ? cb.playerCell : null;
    return c && typeof c === "object" ? c : null;
  }
  // standing in his own cell
  function playerHome() {
    const p = P(), c = pcell();
    if (!p || !c) return false;
    return p.x > c.x - c.hx && p.x < c.x + c.hx && p.z > c.z - c.hz && p.z < c.z + c.hz && Math.abs((p.y || 0) - (c.fy || 0)) < 1.6;
  }
  // what a count needs of him: in his cell (the hole counts), or in custody
  function accounted() {
    if (!inmatePlayer()) return true;
    if (CBZ.playerCellSealed && CBZ.playerCellSealed()) return true;
    return playerHome() || inCustody();
  }
  // the aisle point in front of a cell's door
  function mouthOf(c) { return { x: c.doorX + c.dx * 1.3, z: c.doorZ + c.dz * 1.3 }; }
  // the sally port between the wing wall (z -8) and the out door (z -3.75)
  const OUT_DOOR_Z = -3.75;
  function vestibule(x, z) { return Math.abs(x) < 2.6 && z < OUT_DOOR_Z + 0.4 && z > -8.6; }

  /* ==========================================================
     8. AN OFFICER SENDS YOU. kind "yard" (out of the wing), "in" (back
        into it), "cell" (into your own cell).
          fetch  he walks up to you
          order  he says it (command.toPlayer). Obeyed means you made real
                 progress, never "be there already".
          walk   he walks a pace behind you. Stall or turn back and he says
                 it again; the second time he takes you.
          reach  he closes to arm's length
          hands  CBZ.verbs.escort: his hand on your arm, walked there round
                 the walls (the nav grid's path, re-planned as you go)
        Pull free, run off, or keep out of his hands and it is an offense and
        a hunt: systems/capture.js's arrest and the hole.
     ========================================================== */
  const TAKE_LINES = {
    yard: ["Yard. Let's go.", "I said yard. Move.", "Last time. Out."],
    in: ["Count. Inside.", "Inside. Now.", "Last call. Move."],
    cell: ["Back to your cell.", "Your cell. Now.", "Last time. Cell."],
  };
  const TAKE_ORDER = { yard: "go", in: "line", cell: "cell" };
  const GATE_OUT = { x: 0, z: -1.6 }, GATE_IN = { x: 0, z: -10.4 };
  let take = null, lastTake = null;
  function takeArrived(k) {
    const p = P();
    if (!p) return false;
    if (k === "cell") return playerHome();
    if (k === "in") return inBlock(p.x, p.z, -0.6);
    return !inBlock(p.x, p.z, 0.2) && !vestibule(p.x, p.z);
  }
  // how far he still has to go: it falls as he goes, whatever the route bends
  function toGo(k) {
    const p = P();
    if (!p) return 0;
    const inside = inBlock(p.x, p.z, 0) || vestibule(p.x, p.z);
    if (k === "yard") return inside ? Math.hypot(p.x - GATE_OUT.x, p.z - GATE_OUT.z) : 0;
    if (k === "in") return inside ? 0 : Math.hypot(p.x - GATE_IN.x, p.z - GATE_IN.z);
    const c = pcell();
    if (!c) return 0;
    const mx = c.doorX + c.dx * 1.3, mz = c.doorZ + c.dz * 1.3;      // his door's aisle point
    if (inside) return Math.hypot(p.x - mx, p.z - mz);
    return Math.hypot(p.x - GATE_IN.x, p.z - GATE_IN.z) + Math.hypot(GATE_IN.x - mx, GATE_IN.z - mz);
  }
  function takeGoal(k) {
    if (k === "yard") return { x: 0, z: 1.5 };
    if (k === "in") return { x: 0, z: -12 };
    let s = null;
    try { s = CBZ.cellblock && CBZ.cellblock.playerSpawn ? CBZ.cellblock.playerSpawn() : null; } catch (e) { s = null; }
    const c = pcell();
    if (s && isFinite(+s.x) && isFinite(+s.z)) return { x: +s.x, z: +s.z };
    return c ? { x: c.x, z: c.z } : { x: 0, z: -12 };
  }
  function startTake(kind, gd, lines) {
    if (take || !gd || excused() || takeArrived(kind)) return false;
    take = {
      kind: kind, gd: gd, lines: lines || TAKE_LINES[kind], phase: "fetch", t: 0, pt: 0, nearest: Infinity,
      orders: 0, best0: 0, best: Infinity, stall: 0, rec: null, S: null, tries: 0, tryT: 0, esc: false,
      goal: null, path: null, pathT: 0, pi: 0,
    };
    gd._duty = { kind: "take", torch: true };
    gd.investigate = null; gd._returning = false;
    return true;
  }
  function endTake(why) {
    const T = take;
    if (!T) return;
    take = null;
    lastTake = { kind: T.kind, why: why, t: Math.round(T.t * 10) / 10, orders: T.orders };
    if (T.S && !T.S.done && CBZ.verbs && CBZ.verbs.release) { try { CBZ.verbs.release(T.S); } catch (e) {} }
    const gd = T.gd;
    if (gd) {
      if (T.esc) gd._escort = false;
      if (gd._duty && gd._duty.kind === "take") gd._duty = null;
      gd._returning = true;
    }
    if (T.rec && T.rec.outcome == null && CBZ.command && CBZ.command.cancelPlayer) CBZ.command.cancelPlayer(gd);
    if (why === "done" && T.kind === "cell") {
      say(gd, "Stay in there.", 1.6);
      if (search) endSearch("home");
    }
  }
  // he would not go: on file, and the officer comes for him (the arrest)
  function resist(T, why) {
    const gd = T.gd;
    endTake("resisted: " + why);
    if (!ableGuard(gd)) return;
    if (CBZ.prisonOffense) { try { CBZ.prisonOffense("restricted", { severity: 2, seenBy: gd }); } catch (e) {} }
    gd.hunt = Math.max(gd.hunt || 0, 4); gd.alert = 1; gd.capCD = 0; gd.investigate = null;
  }
  function order(T) {
    T.phase = "order"; T.pt = T.t;
    T.orders++;
    T.best0 = toGo(T.kind);
    const L = T.orders > 1 ? T.lines.slice(1) : T.lines;
    const C = CBZ.command;
    let rec = null;
    if (C && C.toPlayer) {
      rec = C.toPlayer(T.gd, TAKE_ORDER[T.kind], {
        lines: L, patience: [6, 5, 4], maxDist: 45,
        complied: function () { return takeArrived(T.kind) || T.best0 - toGo(T.kind) > 3.5; },
        alive: function () { return take === T && T.phase === "order"; },
        onForce: function (r, out) {
          if (take !== T) return;
          if (out === "left" || out === "fled") resist(T, "ran");
          else hands(T);
        },
        onDone: function (r, out) {
          if (take !== T || out !== "complied") return;
          T.phase = "walk"; T.pt = T.t; T.best = toGo(T.kind); T.stall = 0;
        },
      });
    }
    T.rec = rec;
    if (!rec) {
      // no order layer on this page: the words, and the walk is watched the same
      say(T.gd, L[0]);
      T.phase = "walk"; T.best = toGo(T.kind); T.stall = 0;
    }
  }
  function hands(T) {
    if (T.rec && T.rec.outcome == null && CBZ.command && CBZ.command.cancelPlayer) CBZ.command.cancelPlayer(T.gd);
    T.rec = null;
    T.phase = "reach"; T.pt = T.t; T.tryT = 0; T.tries = 0;
  }
  function grab(T) {
    const V = CBZ.verbs;
    if (!V || !V.escort || !V.playerActor) { resist(T, "no hands"); return; }
    const A = CBZ.arrest, o = { far: true };
    if (A) {
      if (A.tier) o.tierHold = A.tier(T.gd).hold;
      if (A.pullMul) o.pullMulFn = A.pullMul;
      if (A.backup) o.backupN = A.backup(T.gd) | 0;
    }
    let S = null;
    try { S = V.escort(T.gd, V.playerActor(), o); } catch (e) { S = null; }
    if (!S) { if (++T.tries > 8) resist(T, "kept clear"); return; }
    T.S = S; T.phase = "hands"; T.pt = T.t;
    T.gd._escort = true; T.esc = true;            // his body is the verb's now (entities/guards.js)
    T.goal = takeGoal(T.kind); T.path = null; T.pathT = 0; T.pi = 0;
    say(T.gd, "Walk.", 1.4);
  }
  // hands on: walk him there (the same march systems/arrest.js walks a cuffed man)
  function holdTick(T, dt) {
    const S = T.S, V = CBZ.verbs, p = P();
    if (!S || !V || !p) { resist(T, "lost hold"); return; }
    if (S.done) {
      const k = S.result && S.result.outcome;
      if (k === "escaped" || k === "interrupted") { resist(T, "broke loose"); return; }
      // the hands never closed (he stepped off as they came): reach again
      T.S = null;
      if (T.esc) { T.gd._escort = false; T.esc = false; }
      T.phase = "reach"; T.pt = T.t; T.tryT = 0.5;
      return;
    }
    if (S.phase !== "hold") return;
    if (takeArrived(T.kind)) { endTake("done"); return; }
    if (T.t - T.pt > 50) { endTake("stalled"); return; }
    const goal = T.goal;
    let tx = goal.x, tz = goal.z;
    const NG = CBZ.navGrid;
    if (NG && NG.plan && NG.ready && NG.ready()) {
      T.pathT -= dt;
      if (!T.path || T.pathT <= 0) {
        let path = null;
        try { path = NG.plan({ x: p.x, z: p.z }, goal, { actor: T.gd }); } catch (e) { path = null; }
        T.path = path && path.length ? path : null; T.pathT = 2.5; T.pi = 0;
      }
      const w = T.path;
      if (w) {
        while (T.pi < w.length - 1 && Math.hypot(w[T.pi].x - p.x, w[T.pi].z - p.z) < 0.8) T.pi++;
        if (T.pi < w.length - 1) { tx = w[T.pi].x; tz = w[T.pi].z; }
      }
    }
    let ux = tx - p.x, uz = tz - p.z;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    const pull = !!(S.cst && S.cst.pullNow > 0);
    V.walk(S, S, tx - ux * S.work, tz - uz * S.work, pull ? 0.8 : 1.35, dt, Math.atan2(ux, uz));
  }
  // every frame while there is one: one man, one officer
  function takeTick(dt) {
    const T = take;
    if (!T) return;
    T.t += dt;
    const gd = T.gd, p = P();
    if (!p || !inmatePlayer() || lockdownOn()) { endTake("off"); return; }
    if (!ableGuard(gd) || (gd.hunt || 0) > 0) { endTake("officer busy"); return; }
    if (T.phase === "hands") { holdTick(T, dt); return; }
    if (excused()) { endTake("custody"); return; }
    if (takeArrived(T.kind)) { endTake("done"); return; }
    const d = Math.hypot(p.x - gd.group.position.x, p.z - gd.group.position.z);
    if (T.phase === "fetch") {
      if (d < T.nearest) T.nearest = d;
      // up close he says it; a man drawing away from him, or a long walk over,
      // gets it called from where he stands (it is an order he never heard
      // only if he was out of earshot, and then the walk goes on)
      if (d < 2.8 || ((d > T.nearest + 10 || T.t > 12) && d < 30)) order(T);
      else if (T.t > 45) endTake("never reached");
      return;
    }
    if (T.phase === "walk") {
      const left = toGo(T.kind);
      if (left < T.best - 0.4) { T.best = left; T.stall = 0; }
      else T.stall += dt;
      if (T.stall > 9 || left > T.best + 7) { if (T.orders < 2) order(T); else hands(T); }
      return;
    }
    if (T.phase === "reach") {
      if (d < 2.2) { T.tryT -= dt; if (T.tryT <= 0) { T.tryT = 0.5; grab(T); } }
      if (take === T && T.phase === "reach" && T.t - T.pt > 14) resist(T, "kept clear");
    }
  }
  // his legs while he is on it (entities/guards.js asks every frame)
  function stepTake(gd, dt) {
    const T = take, p = P();
    const W = CBZ.guardWalkTo, ST = CBZ.guardStand, F = CBZ.guardFaceTo;
    if (!T || T.gd !== gd || !p || !W || !ST || !F) return false;
    const gp = gd.group.position;
    const dx = p.x - gp.x, dz = p.z - gp.z, d = Math.hypot(dx, dz);
    if (T.phase === "fetch" || T.phase === "reach") {
      const stop = T.phase === "reach" ? 0.8 : 2.0;
      if (d > stop + 0.25) W(gd, p.x, p.z, (gd.speed || 2.4) * (T.phase === "reach" ? 1.5 : 1.25), dt, stop, false, p.y);
      else { ST(gd, dt); F(gd, p.x, p.z, 0.0001, dt); }
      return true;
    }
    if (T.phase === "walk" && d > 2.8) {
      // a pace behind him, the way an officer walks a man who is going
      const k = (d - 2.0) / d;
      W(gd, gp.x + dx * k, gp.z + dz * k, Math.max(gd.speed || 2.4, 2.8), dt, 0.4, false, p.y);
      return true;
    }
    ST(gd, dt); F(gd, p.x, p.z, 0.0001, dt);
    return true;
  }
  // a man being walked across the gate right now: ours, or an arrest's
  function crossing() {
    const p = P();
    if (!p) return false;
    const inside = inBlock(p.x, p.z, -0.3);
    if (take && take.phase !== "fetch") return take.kind === "yard" ? (inside || vestibule(p.x, p.z)) : !inside;
    return !!(CBZ.prisonHaul && CBZ.prisonHaul()) && !inside;
  }
  // his own door waits for him while he is being walked to it
  function playerDoorHeld() {
    if (playerHome()) return false;
    if (take && take.kind === "cell" && take.phase !== "fetch") return true;
    return !!(CBZ.prisonHaul && CBZ.prisonHaul());
  }

  /* ==========================================================
     9. THE COUNT. One or two officers walk the galleries, the north row
        and the hall; the one who passes YOUR door stops and looks in. In
        there (or in the hole, or in custody): they walk on. Not: the count
        is short (10). The morning count is taken in locked cells and the
        doors rack only once it clears (`morningHold`).
     ========================================================== */
  const COUNT_WALKS = [
    [[-1.0, -11.8], [-10.3, -11.8], [-10.3, -36.2], [0, -36.2], [0, -12.6]],   // west gallery, the north row, the hall
    [[1.0, -11.8], [10.3, -11.8], [10.3, -36.2], [1.4, -36.2]],               // east gallery
  ];
  const COUNT_MAX = 55;
  let count = null, countDue = null, countDueT = 0, morningHold = false, lastCount = null;
  function walkPts(base) {
    const pts = [];
    for (let i = 0; i < base.length; i++) pts.push({ x: base[i][0], z: base[i][1], look: null });
    return pts;
  }
  function segD(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz;
    let u = L > 0 ? ((px - ax) * vx + (pz - az) * vz) / L : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return Math.hypot(px - (ax + vx * u), pz - (az + vz * u));
  }
  // his door goes into whichever walk passes nearest it, as a stop to look in
  function addLook(routes, c) {
    if (!c || c.fy) return;                       // an upper cell is counted from the floor below
    const m = mouthOf(c);
    let best = null, bi = -1, bd = Infinity;
    for (let r = 0; r < routes.length; r++) {
      const pts = routes[r];
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segD(m.x, m.z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
        if (d < bd) { bd = d; best = pts; bi = i; }
      }
    }
    if (best) best.splice(bi + 1, 0, { x: m.x, z: m.z, look: { x: c.x, z: c.z } });
  }
  function startCount(kind) {
    if (count || search || lockdownOn() || !(CBZ.cellblock && CBZ.cellblock.v2)) return false;
    const a = nearestGuard(-10, -24, 90, freeGuard);
    if (!a) return false;
    a._duty = { kind: "count", torch: true, pts: null, i: 0, look: 0, best: Infinity, stall: 0 };   // spoken for
    const b = nearestGuard(10, -24, 90, freeGuard);
    const men = b ? [a, b] : [a];
    const routes = b ? [walkPts(COUNT_WALKS[0]), walkPts(COUNT_WALKS[1])]
      : [walkPts(COUNT_WALKS[0]).concat(walkPts(COUNT_WALKS[1]))];
    const c = pcell();
    addLook(routes, c);
    count = { kind: kind, t: 0, men: men, checked: !inmatePlayer() || !c, present: true, by: null };
    for (let k = 0; k < men.length; k++) {
      const gd = men[k];
      gd._duty = { kind: "count", torch: true, pts: routes[k], i: 0, look: 0, best: Infinity, stall: 0 };
      gd.investigate = null; gd._returning = false;
    }
    return true;
  }
  function stepCount(gd, D, dt) {
    const W = CBZ.guardWalkTo, ST = CBZ.guardStand, F = CBZ.guardFaceTo;
    if (!D.pts || D.i >= D.pts.length || !W || !ST || !F) return false;
    const w = D.pts[D.i];
    if (D.look > 0) {
      // at the bars, looking in
      D.look -= dt;
      ST(gd, dt);
      F(gd, w.look.x, w.look.z, 0.0001, dt);
      if (D.look <= 0) { D.i++; D.best = Infinity; D.stall = 0; }
      return true;
    }
    const d = W(gd, w.x, w.z, (gd.speed || 2.4) * 0.85, dt, 0.4);
    if (d < D.best - 0.2) { D.best = d; D.stall = 0; } else D.stall += dt;
    if (d < 0.8 || D.stall > 4) {
      if (w.look && d < 2.5) D.look = 1.3;
      else { D.i++; D.best = Infinity; D.stall = 0; }
    }
    return true;
  }
  function endCount() {
    const C = count;
    if (!C) return;
    count = null;
    for (let k = 0; k < C.men.length; k++) {
      const gd = C.men[k];
      if (gd && gd._duty && gd._duty.kind === "count") { gd._duty = null; gd._returning = true; }
    }
  }
  function countClear(kind, skipped) {
    lastCount = { kind: kind, clear: true, skipped: !!skipped };
    if (kind === "wake" && !skipped) paSay("Count's clear.", 1);
  }
  function countTick(step) {
    if (countDue && !count && !search) {
      countDueT -= step;
      if (countDueT <= 0) {
        const k = countDue;
        countDue = null;
        if (!startCount(k)) countClear(k, true);  // nobody free to walk it: counted from the desk
      }
    }
    const C = count;
    if (!C) return;
    C.t += step;
    if (lockdownOn()) { endCount(); return; }
    const c = pcell();
    let walking = 0;
    for (let k = 0; k < C.men.length; k++) {
      const gd = C.men[k];
      const D = gd && gd._duty;
      if (!D || D.kind !== "count" || !ableGuard(gd)) continue;
      if (D.pts && D.i < D.pts.length) walking++;
      if (!C.checked && c) {
        const gp = gd.group.position;
        if ((gp.y || 0) < 1.5 && Math.hypot(gp.x - c.doorX, gp.z - c.doorZ) < 3.4) {
          C.checked = true; C.by = gd; C.present = accounted();
          if (!C.present && !(take && take.kind === "cell")) say(gd, "This one's empty.", 1.8);
        }
      }
    }
    const over = walking === 0 || C.t > COUNT_MAX;
    if (!C.checked && over) { C.checked = true; C.present = accounted(); }
    if (C.checked && !C.present && accounted()) C.present = true;     // he got home before it was called
    if (C.checked && !C.present) {
      if (take && take.kind === "cell") return;                       // an officer is walking him home: wait
      const k = C.kind, by = C.by;
      endCount();
      startSearch(k, by);
      return;
    }
    if (over) { const k = C.kind; endCount(); countClear(k, false); }
  }

  /* ==========================================================
     10. THE COUNT IS SHORT. The PA says so, and the officers search with
         entities/guards.js's own search (walk to a spot, look round two or
         three points near it, torch on in the dark): YOUR CELL first, then
         WHERE YOU WERE LAST SEEN, then the likely places nearest that (the
         vents and hatches, the culvert, the wall, the yard corners), each
         party going on to the next place as it finishes. Whoever sees you
         sends you home (11). Home, in custody or in the hole: the count
         clears. Not found in SEARCH_H hours it is an escape: the warden's
         lockdown (systems/prisonwarden.js -> systems/lockdown.js).
     ========================================================== */
  const SEARCH_H = 2.5, PARTIES = 4;
  let search = null, lastSearch = null;
  function lastSeen() {
    const g = CBZ.game, now = (g && g.elapsed) || 0;
    const lk = g && g.lastKnown;
    if (lk && lk.t > 0 && !lk.heardOnly && isFinite(lk.x) && isFinite(lk.z)) return { x: +lk.x, z: +lk.z };
    let best = null, at = -Infinity;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (gd && gd.lkAt != null && gd.lkAt > at && isFinite(gd.lkX) && isFinite(gd.lkZ)) { at = gd.lkAt; best = gd; }
    }
    if (best && now - at < 4 * secsPerHour()) return { x: best.lkX, z: best.lkZ };
    return null;
  }
  function likelyPlaces(from) {
    const out = [];
    const add = function (x, z) { if (isFinite(x) && isFinite(z) && Math.abs(x) < 118 && z > -108 && z < 122) out.push({ x: +x, z: +z }); };
    add(0, -1.6); add(-24, 14); add(0, 24); add(-22, 46); add(22, 44); add(0, 50);
    const V = CBZ.vents || [];
    for (let i = 0; i < V.length; i++) if (V[i]) add(V[i].x, V[i].z);
    const A = CBZ.altExitZones || [];
    for (let i = 0; i < A.length; i++) if (A[i]) add(A[i].x, A[i].z);
    out.sort(function (a, b) { return Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z); });
    return out;
  }
  function startSearch(kind, by) {
    if (search || lockdownOn()) return;
    const c = pcell();
    const home = c ? { x: c.x, z: c.z } : { x: 0, z: -24 };
    const seen = lastSeen();
    search = { kind: kind, t: 0, home: home, seen: seen, places: likelyPlaces(seen || home), next: 0, sent: 0,
      parties: [], found: false, retaskT: 1 };
    paSay("Count's short.", 2);
    if (by && freeGuard(by)) send(by, home, 2);
    else { const gd = nearestGuard(home.x, home.z, 90, freeGuard); if (gd) send(gd, home, 2); }
    if (seen) { const gd = nearestGuard(seen.x, seen.z, 120, freeGuard); if (gd) send(gd, seen, 3); }
    fillParties();
  }
  function send(gd, at, npts) {
    gd.investigate = { x: at.x, z: at.z, t: 10, scan: 0, type: "search", npts: npts || 3 };
    gd._returning = false;
    gd.alert = Math.max(gd.alert || 0, 0.6);
    if (search.parties.indexOf(gd) < 0) search.parties.push(gd);
    search.sent++;
  }
  function nextPlace() {
    const S = search;
    if (S.sent % 4 === 3 && !playerHome()) return S.home;      // every fourth look is his cell again
    if (!S.places.length) return S.home;
    const q = S.places[S.next % S.places.length];
    S.next++;
    return q;
  }
  function fillParties() {
    const S = search;
    for (let i = S.parties.length - 1; i >= 0; i--) {
      const gd = S.parties[i];
      if (!ableGuard(gd) || gd._duty || (gd.hunt || 0) > 0 || otherJob(gd)) S.parties.splice(i, 1);
    }
    if (S.found) return;
    for (let i = 0; i < S.parties.length; i++) {
      const gd = S.parties[i];
      if (!(gd.investigate && gd.investigate.t > 0)) send(gd, nextPlace(), 3);
    }
    let tries = 0;
    while (S.parties.length < PARTIES && tries++ < PARTIES) {
      const q = nextPlace();
      const gd = nearestGuard(q.x, q.z, 140, freeGuard);
      if (!gd) break;
      send(gd, q, 3);
    }
  }
  function endSearch(why) {
    const S = search;
    if (!S) return;
    search = null;
    lastSearch = { why: why, t: Math.round(S.t * 10) / 10, parties: S.parties.length, sent: S.sent };
    // the parties finish the look they are on and go back to their rounds
  }
  function searchTick(step) {
    const S = search;
    if (!S) return;
    S.t += step;
    if (lockdownOn()) { endSearch("lockdown"); return; }
    if (accounted() && !(take && take.kind === "cell")) { endSearch("home"); return; }
    if (S.found && !(take && take.kind === "cell")) S.found = false;    // the walk home fell through: look again
    S.retaskT -= step;
    if (S.retaskT <= 0) { S.retaskT = 1; fillParties(); }
    if (!S.found && S.t > SEARCH_H * secsPerHour()) {
      const at = S.seen || S.home;
      endSearch("escape");
      const W = CBZ.warden;
      if (W && W.incident) { try { W.incident("escape", { player: true, seen: false, at: at }); } catch (e) {} }
      else if (CBZ.lockdown && CBZ.lockdown.begin) { try { CBZ.lockdown.begin("count", { hunt: true }); } catch (e) {} }
    }
  }

  /* ==========================================================
     11. SEEN WHERE YOU SHOULD NOT BE. After lock-in, or while the count is
         short, a screw who has eyes on you needs no heat first: he comes
         over and sends you back to your cell (8). It is a hunt only if you
         will not go. In the dark he barely sees you unless his torch is on
         you (systems/prisonnight.js). A bent screw looks the other way.
     ========================================================== */
  function watchOut() {
    if (take || excused() || (CBZ.game.invuln || 0) > 0) return;
    if (!search && !isCurfew(live())) return;
    const p = P();
    if (!p || (search ? playerHome() : belongs(p.x, p.z))) return;
    if (orderLive()) return;
    const list = CBZ.guards || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!ableGuard(gd) || !gd.seesPlayer || gd.corrupt || gd.bribed > 0 || otherJob(gd)) continue;
      const d = Math.hypot(gd.group.position.x - p.x, gd.group.position.z - p.z);
      if (d < bd) { bd = d; best = gd; }
    }
    if (best) found(best);
  }
  function found(gd) {
    if ((gd.hunt || 0) > 0) {
      if (CBZ.prisonArrestPhase && CBZ.prisonArrestPhase()) return;   // the arrest already has him
      gd.hunt = 0; gd._chase = null;
    }
    if (gd._duty && gd._duty.kind === "count") gd._duty = null;
    gd.investigate = null;
    if (startTake("cell", gd) && search) search.found = true;
  }

  /* ==========================================================
     12. THE DAY'S TWO MOVES.
         OUT, the first open block of the day (07:00 yard), once the morning
         count has cleared: the gate opens, an officer calls it, the wing's
         men walk out (its own residents too, each given a patch of yard;
         their aisle is kept in `_dayRegion` for the evening), the yard
         patrol stands the apron, and an officer comes for you. When the
         wing is empty and you are out (or excused), or after MOVE_OUT_H
         hours, the gate shuts for the day. A lockdown cancels it; the
         warden taking your yard leaves you inside.
         IN, the evening return: the muster above walks the men home; if
         you are still out IN_WAIT seconds after the horn, an officer comes.
     ========================================================== */
  const MOVE_OUT_H = 3, IN_WAIT = 6;
  const YARD_PATCHES = [[-12, -4, 8, 18], [4, 12, 8, 18], [-6, 6, 16, 26], [-12, -4, 26, 36], [4, 12, 26, 36], [-16, -8, 38, 46], [8, 16, 38, 46]];
  let move = null, outKey = null, lastMove = null, inArmed = false, inT = 0;
  function dayKey() { return CBZ.dayCount ? (CBZ.dayCount() | 0) : 0; }
  // an open block with a day still in front of it (not the last one before the return)
  function outBlock(b) {
    if (!b || b.home !== null) return false;
    const n = nextOf(b);
    return (!!n && n.home === null) || PLAN.until() > 1.5 * secsPerHour();
  }
  function startMoveOut() {
    outKey = dayKey();
    move = { dir: "out", t: 0, left: 0, called: false };
    drivePosts(true);
    const list = CBZ.npcs || [];
    let k = 0;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!housed(n) || n._cellIdx == null || n._cellIdx < 0) continue;
      const q = n.group.position;
      if (!inBlock(q.x, q.z, 0)) continue;
      if (!n._dayRegion) n._dayRegion = n.region;
      n.region = YARD_PATCHES[k++ % YARD_PATCHES.length];
    }
  }
  function endMove(why) {
    if (!move) return;
    lastMove = { dir: move.dir, why: why, t: Math.round(move.t * 10) / 10, left: move.left };
    move = null;
    drivePosts(live().home !== null);
  }
  // the officer nearest you in the wing calls it
  function callIt() {
    const p = P();
    const x = p ? p.x : 0, z = p ? p.z : -24;
    const gd = nearestGuard(x, z, 45, function (o) { return ableGuard(o) && inBlock(o.group.position.x, o.group.position.z, 0); });
    if (gd) say(gd, "Yard. Move out.", 2.0);
  }
  function moveTick(step) {
    const b = live();
    // (a new arrival from Gang City is counted in his locked cell first:
    // systems/capture.js's intake; the move out waits for it)
    const intake = !!(CBZ.prisonIntakeActive && CBZ.prisonIntakeActive());
    if (!move && outKey !== dayKey() && outBlock(b) && !morningHold && !count && !countDue && !search && !intake) {
      if (lockdownOn()) outKey = dayKey();          // a lockdown cancels the yard
      else startMoveOut();
    }
    if (!move) return;
    move.t += step;
    if (lockdownOn() || b.home !== null) { endMove("cut"); return; }
    let left = 0;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!housed(n) || n.ko > 0 || n._propLie) continue;
      const q = n.group.position;
      if (!inBlock(q.x, q.z, 0) && !vestibule(q.x, q.z)) continue;
      left++;
      // move along: up off the bunk, no standing about
      n._bunkGiveUp = Math.max(n._bunkGiveUp || 0, 30);
      if (n._propSeat || n._propBed) continue;
      if (n.pause > 0) n.pause = 0;
      if ((n._lifeActivity === "stand" || n._lifeActivity === "activity") && (!n.aiState || n.aiState === "wander")) {
        n._lifeActivity = "walk"; n._lifeT = 8;
        if (CBZ.npcPickTarget) CBZ.npcPickTarget(n);
      }
    }
    move.left = left;
    if (!move.called && move.t > 0.6) { move.called = true; callIt(); }
    const p = P();
    const youDone = !p || excused() || noYard() || takeArrived("yard");
    if (!youDone && !take && move.t > 2.5 && !orderLive()) {
      const gd = nearestGuard(p.x, p.z, 70, freeGuard);
      if (gd) startTake("yard", gd);
    }
    if ((left === 0 && youDone && !take) || move.t > MOVE_OUT_H * secsPerHour()) endMove(left === 0 ? "out" : "time");
  }
  function inTick(step) {
    if (!inArmed) return;
    const b = live();
    if (b.home !== "block" || lockdownOn()) { inArmed = false; return; }
    if (inT > 0) { inT -= step; return; }
    if (take || excused() || orderLive() || takeArrived("in")) return;
    const p = P();
    const gd = p ? nearestGuard(p.x, p.z, 120, freeGuard) : null;
    if (gd) startTake("in", gd);
  }

  /* ---- THE COUNTS NOBODY ANNOUNCES: one or two a night, rolled per night
       off the calendar, between 23:00 and 04:15. ---- */
  const surprise = { key: null, at: [], done: [] };
  function lateHours() { return ((hourNow() - 22) % 24 + 24) % 24; }      // hours since 22:00
  function nightKey() { return hourNow() >= 12 ? dayKey() : dayKey() - 1; }
  function skipPast() {
    const late = lateHours();
    if (late > 7.5) return;
    for (let i = 0; i < surprise.at.length; i++) if (late >= surprise.at[i]) surprise.done[i] = true;
  }
  function rollSurprise() {
    const key = nightKey();
    if (surprise.key === key) return;
    surprise.key = key;
    surprise.at.length = 0; surprise.done.length = 0;
    const r = function (salt) { return CBZ.hash01 ? CBZ.hash01(key, 31, salt) : Math.random(); };
    surprise.at.push(1 + r(1) * 2.5);                   // 23:00 .. 01:30
    if (r(2) < 0.5) surprise.at.push(4.5 + r(3) * 1.75); // 02:30 .. 04:15
    for (let i = 0; i < surprise.at.length; i++) surprise.done.push(false);
    skipPast();                                         // a run that starts at 03:00 skips 01:00's
  }
  function surpriseTick() {
    if (!isCurfew(live()) || lockdownOn()) return;
    const late = lateHours();
    if (late > 7.5) return;
    for (let i = 0; i < surprise.at.length; i++) {
      if (surprise.done[i] || late < surprise.at[i]) continue;
      surprise.done[i] = true;
      if (!count && !search && !countDue) { countDue = "night"; countDueT = 0; }
    }
  }

  // four times a second
  function dayTick(step) {
    surpriseTick();
    countTick(step);
    searchTick(step);
    moveTick(step);
    inTick(step);
    watchOut();
    towerNotice(step);
    // the morning doors rack once the count is clear (or the trouble is over)
    if (morningHold && !count && !countDue && !search && !lockdownOn()) {
      morningHold = false;
      if (live().cells !== "lock") openCells();
    }
  }

  // entities/guards.js: an officer on one of these jobs, every frame
  function dutyStep(gd, dt) {
    const D = gd && gd._duty;
    if (!D || !on()) return false;
    if (D.kind === "take") return stepTake(gd, dt);
    if (D.kind === "count") return stepCount(gd, D, dt);
    return false;
  }

  /* ==========================================================
     13. APPLYING A BLOCK
     ========================================================== */
  function live() { return PLAN.block(); }
  function openCells() {
    wantLocked = false;
    doorRetry = 0;
    const list = cells();
    if (list) for (let i = 0; i < list.length; i++) list[i]._keyed = false;   // the night's key expires
  }

  function apply(b, announce, prev) {
    if (prev === b) prev = null;                  // a replayed block (CBZ.dayJump) starts fresh
    if (b.cells === "lock") { wantLocked = true; morningHold = false; }
    else if (b.cells === "open") {
      // THE MORNING COUNT IS TAKEN IN LOCKED CELLS, then the doors rack
      if (b.count && v2()) { wantLocked = true; morningHold = true; countDue = b.id; countDueT = 1.0; }
      else openCells();
    } else if (b.home === null && wantLocked && !morningHold) {
      // an open day never keeps the cells racked (a clock jumped from 02:00
      // straight to the yard skipped the morning count that opens them)
      openCells();
    }
    // never rack a wing open in the middle of a facility lockdown
    if (!wantLocked && (CBZ.game.detection || 0) >= 90) wantLocked = true;
    // the doors move on the klaxon, not a retry interval later
    doorRetry = 0;
    if (b.home === null) { gateT = 0; holdT = 0; inArmed = false; }
    else {
      /* THE EVENING RETURN: the first indoor block after the open day (or a
         run that starts in one before lights out) opens the gate for the men
         coming in, and sends an officer for you if you are out. count ->
         secure -> night is ONE lock-up: neither timer re-arms inside it. */
      if (prev ? prev.home === null : (!b.lightsOut && b.cells !== "open")) {
        gateT = GATE_HOLD;
        if (b.home === "block") { inArmed = true; inT = IN_WAIT; }
      }
      if (b.cells === "lock" && (!prev || prev.cells !== "lock")) holdT = CELL_HOLD;
      // the lock-in count walks once the leaves have racked
      if (b.count && b.cells !== "open") { countDue = b.id; countDueT = 0.3 * secsPerHour(); }
    }
    if (b.home === null && (!prev || prev.home !== null)) outKey = null;   // a new open day: the yard is due
    if (b.home !== null && move) endMove("block");
    if (isCurfew(b)) rollSurprise();
    drivePosts(b.home !== null || !!move);
    muster(b.home !== null);
    if (announce) soundPA(b.pa);
  }

  /* ==========================================================
     14. THE TICK
     ========================================================== */
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.5) : null;

  /* A RUN CAN START AT ANY HOUR — the sky clock runs on the title screen — so
     the plan lands in the block that is ACTUALLY running and tells us it was
     not a change (`first`). Every later transition announces itself. */
  PLAN.on(function (b, prev, first) { apply(b, !first, prev); });

  function reset() {
    PLAN.rearm(); blasts = 0; paLine = null;
    endTake("reset"); endCount(); search = null; move = null;
    countDue = null; morningHold = false; inArmed = false; outKey = null; surprise.key = null;
    const G = CBZ.guards || [];
    for (let i = 0; i < G.length; i++) if (G[i] && G[i]._duty) G[i]._duty = null;
    const list = cells();
    if (list) for (let i = 0; i < list.length; i++) list[i]._keyed = false;
    muster(false);
    drivePosts(false);
    wantLocked = false;
    gateT = 0; holdT = 0; waiting.length = 0; gateOpen = false; gateOffMove = 0; gateMine = false;
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

  let seenJumps = CBZ.dayJumps || 0, dayAcc = 0;
  CBZ.onUpdate(19.5, function (dt) {
    if (!on()) return;
    if (pollNewRun && pollNewRun()) reset();

    // a clock moved by hand (CBZ.dayJump) lands like a real hour change
    const jumped = (CBZ.dayJumps || 0) !== seenJumps;
    if (jumped) {
      seenJumps = CBZ.dayJumps || 0;
      // the hours between have passed: whatever was running belonged to them
      endTake("jump"); endCount(); endSearch("jump"); endMove("jump");
      countDue = null; morningHold = false;
      if (PLAN.replay) PLAN.replay();
    }
    PLAN.poll(dt);            // fires apply() through the listener above
    if (jumped) skipPast();

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

    takeTick(dt);
    dayAcc += dt;
    if (dayAcc >= 0.25) { const s = dayAcc; dayAcc = 0; dayTick(s); }
    driveDoors(dt);
    tryCellKey();
    herd(dt);
    recount(dt);
    stalls(dt);
    pumpPA(dt);
    pumpPaLine(dt);
  });
  // the horn's own lamp fades on menus too, so a paused game does not freeze
  // a speaker mid-shout
  CBZ.onAlways(19.6, function (dt) { pumpHornLamps(dt); });

  /* ==========================================================
     15. THE CONTRACT — what every later phase reads instead of inventing
         its own clock.
     ========================================================== */
  CBZ.prisonSchedule = {
    enabled: on,
    blocks: BLOCKS,
    hour: hourNow,
    // {h, m} — for a thing in the world that tells time (the warden's wall
    // clock). Never a HUD string.
    clock: function () { const h = hourNow(); return { h: h | 0, m: ((h % 1) * 60) | 0 }; },
    block: live,
    id: function () { return live().id; },
    // is("blackout") is what the lights read for the pitch-black hours
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
    // the day's moves, the counts and the officers on them
    dutyStep: dutyStep,
    moving: function () { return !!move; },
    taking: function () { return !!take; },
    countLive: function () { return !!count; },
    searching: function () { return !!search; },
    // a count right now, unannounced (as at night)
    countNow: function () { if (count || search || countDue) return false; countDue = "night"; countDueT = 0; return true; },
    // an officer brings the player into the wing (the warden taking his yard)
    bringIn: function (gd, lines) { return !take && freeGuard(gd) && startTake("in", gd, lines); },
  };

  /* THE RATCHET. `gaps`: every one of the 24 hours belongs to exactly one
     block. `hudText` is pinned at 0: this system never prints. `gateOpenOffMove`
     stays 0: our gate never stands open with no move or escorted man to
     justify it (the keycard's whole value). */
  CBZ.prisonScheduleAudit = function () {
    const pa = PLAN.audit();
    const gaps = pa.gaps, sorted = pa.ordered;
    const list = cells();
    let locked = 0, keyed = 0;
    if (list) for (let i = 0; i < list.length; i++) { if (list[i].locked) locked++; if (list[i]._keyed) keyed++; }
    const T = take, C = count, S = search;
    return {
      on: on(), gaps: gaps, ordered: sorted, hudText: 0,
      blocks: BLOCKS.length, horns: horns.length,
      dayLength: daySecs(), hourLength: secsPerHour(),
      hour: Math.round(hourNow() * 100) / 100,
      block: live().id, until: Math.round(CBZ.prisonSchedule.until() * 10) / 10,
      curfew: isCurfew(live()), lightsOut: !!live().lightsOut,
      wantLocked: wantLocked, morningHold: morningHold, lockedDoors: locked, keyedDoors: keyed,
      mustered: mustered,
      nightPosts: (CBZ.guards || []).filter(function (g) { return !!g._dayRoute; }).length,
      v2: v2(), counting: counting(),
      hold: Math.round(holdT * 10) / 10, gateHold: Math.round(gateT * 10) / 10,
      gateOpen: !!(CBZ.door && CBZ.door.open), gateWanted: gateWanted(),
      gateOpenOffMove: gateOffMove, gateOpenOffCount: gateOffMove,   // (old name, same number)
      heldOpenCells: waiting.length,
      move: move ? { dir: move.dir, t: Math.round(move.t * 10) / 10, left: move.left } : null, lastMove: lastMove,
      take: T ? { kind: T.kind, phase: T.phase, t: Math.round(T.t * 10) / 10, orders: T.orders, toGo: Math.round(toGo(T.kind) * 10) / 10 } : null,
      lastTake: lastTake,
      count: C ? { kind: C.kind, t: Math.round(C.t * 10) / 10, men: C.men.length, checked: C.checked, present: C.present } : null,
      countDue: countDue, lastCount: lastCount,
      search: S ? { t: Math.round(S.t * 10) / 10, parties: S.parties.length, sent: S.sent, found: S.found, seen: S.seen } : null,
      lastSearch: lastSearch,
      surprise: { at: surprise.at.slice(), done: surprise.done.slice() },
      playerHome: playerHome(), accounted: accounted(),
    };
  };
  });
})();
