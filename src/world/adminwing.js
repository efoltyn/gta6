/* ============================================================
   world/adminwing.js — ADMINISTRATION, AND A WARDEN WHO LIVES SOMEWHERE.

   OWNER: the jail should be bigger, and the warden should live somewhere.

   He did not. entities/guards.js spawned him as a guard on a 12 x 6 m
   rectangle of open yard immediately outside the gun-room door and left him
   there for the entire run — the man whose talk lines are "This is MY block"
   and "The gun room stays locked. My key, my rules." spent every hour of
   every day standing in a car park. The two highest-value things in the
   prison (his key, and his authority) had no address.

   ---- THE BUILDING ------------------------------------------------------
   Administration goes where administration goes: at the HEAD of the wing,
   the other side of the staff door, so staff reach the block without ever
   crossing the yard. world/cellblock.js now opens that door (its north wall
   used to be one unbroken 32 m slab — CBZ.cellblockStaffGap) and this file
   builds what is behind it: a 40 x 20 m block containing

       CORRIDOR ......... the spine, running the width of the building
       RECORDS & PROPERTY  files, the property cage, confiscated contraband
       STAFF ROOM ....... lockers, a table, the muster board
       WARDEN'S OFFICE .. locked; his desk, his cabinets, his SAFE
       WARDEN'S QUARTERS  a bunk, off his own office

   CBZ.WORLD.adminWing is the rect, and CBZ.WORLD.minZ moved -45 -> -66 with
   it so the radar, the full map and the strategic overview all frame the new
   northern end of the compound. The wing's OUTER walls carry world/yard.js's
   `noBreach` — they are the compound perimeter now, and the perimeter holds.
   Its interior partitions do not: blowing a hole between the staff room and
   the warden's office is exactly the kind of route the charge table exists
   for.

   ---- THE PRIZE IS A TIME OF DAY, NOT A CONTAINER -----------------------
   The Gun-Room Key opens the armoury's inner cage — the reach-and-explosives
   tier. It has always come off the warden (bribe / pickpocket / knockout,
   systems/economy.js:321/488/550). Now WHERE he is decides which game you
   have to play for it:

       05:00-21:00  he is ON SHIFT and the key is ON HIS HIP. The hook in
                    his safe is EMPTY, and you can see that it is empty.
                    Getting the key means getting to the man — who is at his
                    desk, in a locked office, behind a locked staff door.
       21:00-05:00  he is off shift and asleep in his quarters, and the key
                    is HANGING IN THE SAFE, which is what a man does with his
                    keys when he goes to bed. Two routes: crack the safe, or
                    rob him where he sleeps.

   Nothing announces any of this. The hook is either wearing a key or it is
   not, and that is the entire readout.

   ---- LOCKS: THE LOCKPICK FINALLY HAS A VERB ----------------------------
   world/gunroom.js's inner cage taught the Hacksaw Blade its first verb.
   The Lockpick was the other tool in that pair and still had none — a fence
   price and nothing to do. It is this wing's key:

       staff door ..... Keycard (a card reader; the same card the yard door
                        and the armoury take) — or 5 lb of C4.
       office door .... LOCKPICK, ~3.4 s on the mortice — or 5 lb.
       the safe ....... LOCKPICK, ~9 s on the barrel — or 5 lb.

   Both card doors OPEN FOR STAFF, because a staff door with a reader on it
   does. The warden walks through them four times a day, which makes
   tailgating a real answer and makes his routine legible from the corridor.

   Flags PRISON_ADMIN_WING · PRISON_WARDEN_ROUTINE · PRISON_WARDEN_SUIT.
   Ratchet CBZ.adminWingAudit(): `unreachable` (a locked thing with no route)
   and `keyBothPlaces` (the key on his hip AND in the safe) both pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox || !CBZ.WORLD) return;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const PD = CBZ.prisonDress || null;          // world/cafeteria.js; degrade-safe

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_ADMIN_WING == null) CBZ.CONFIG.PRISON_ADMIN_WING = true;
  if (CBZ.CONFIG.PRISON_WARDEN_ROUTINE == null) CBZ.CONFIG.PRISON_WARDEN_ROUTINE = true;
  if (CBZ.CONFIG.PRISON_WARDEN_SUIT == null) CBZ.CONFIG.PRISON_WARDEN_SUIT = true;
  if (!CBZ.CONFIG.PRISON_ADMIN_WING) return;

  const AW = CBZ.WORLD.adminWing || { x0: -20, x1: 20, z0: -64, z1: -44 };
  const CB = CBZ.WORLD.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
  const SG = CBZ.cellblockStaffGap || { x0: -4.2, x1: -2.2, z: -44, h: 2.6 };

  const H = 6.0;              // wall height — a single-storey admin block
  const WT = 0.6;             // outer wall thickness
  const PT = 0.4;             // interior partition thickness
  const DH = 2.4;             // door head height

  // palette: institutional, but WARMER than the block. Administration is
  // where the paint budget went, and that difference is the whole reason a
  // player knows they have crossed out of the housing unit.
  const C_OUT = 0x8d9099, C_PART = 0x9fa5ad, C_FLOOR = 0x8b8479;
  const C_OFFICE_FLOOR = 0x5c4630;

  /* ==========================================================
     1. THE SHELL. Outer walls declare `noBreach` — world/yard.js's one-line
        perimeter policy, and this building IS the perimeter now. Partitions
        deliberately do not.
     ========================================================== */
  function outer(x, z, w, d) {
    const m = addBox(x, H / 2, z, w, H, d, C_OUT, { solid: true, blockLOS: true });
    if (m && m.userData && m.userData.collider) m.userData.collider.noBreach = true;
    return m;
  }
  const WIDE = AW.x1 - AW.x0, DEEP = AW.z1 - AW.z0;
  outer((AW.x0 + AW.x1) / 2, AW.z0, WIDE, WT);                                     // north
  outer(AW.x0, (AW.z0 + AW.z1) / 2, WT, DEEP);                                     // west
  outer(AW.x1, (AW.z0 + AW.z1) / 2, WT, DEEP);                                     // east
  // south: the cell block's own north wall closes x[-16,16]; only the
  // shoulders either side of it are ours.
  outer((AW.x0 + CB.x0) / 2, AW.z1, CB.x0 - AW.x0, WT);
  outer((CB.x1 + AW.x1) / 2, AW.z1, AW.x1 - CB.x1, WT);
  // red warning trim along the wall tops, so the block reads as one compound
  addBox((AW.x0 + AW.x1) / 2, H - 0.45, AW.z0 + 0.4, WIDE, 0.34, 0.3, CBZ.COL.TRIM, { cast: false });

  // interior clear faces
  const IX0 = AW.x0 + WT / 2, IX1 = AW.x1 - WT / 2;
  const IZ0 = AW.z0 + WT / 2, IZ1 = AW.z1 + 0.5;      // +0.5: the cell wall's own face

  // ---- the plan ---------------------------------------------------------
  const CORR_Z = -49.4;             // corridor / north-range partition plane
  const PX_A = -7.0, PX_B = 6.0;    // records|staff and staff|office partitions
  const QZ = -57.4;                 // office|quarters partition
  // door openings, each {x0,x1} on its partition
  const D_REC = { x0: -14.5, x1: -12.7 };
  const D_STAFF = { x0: -2.5, x1: -0.7 };
  const D_OFF = { x0: 10.5, x1: 12.3 };
  const D_QRT = { x0: 7.5, x1: 9.3 };

  // a partition run with gaps knocked in it. `gaps` are {x0,x1} (for a run
  // along x) or {z0,z1} (along z); every gap gets a real head above it, so a
  // doorway is an opening rather than a full-height slot.
  function partition(axis, plane, a0, a1, gaps, color) {
    const list = (gaps || []).slice().sort(function (p, q) { return (p.x0 != null ? p.x0 - q.x0 : p.z0 - q.z0); });
    let at = a0;
    for (let i = 0; i <= list.length; i++) {
      const g = list[i];
      const g0 = g ? (g.x0 != null ? g.x0 : g.z0) : a1;
      const g1 = g ? (g.x1 != null ? g.x1 : g.z1) : a1;
      if (g0 - at > 0.05) {
        const c = (at + g0) / 2, len = g0 - at;
        if (axis === "x") addBox(c, H / 2, plane, len, H, PT, color || C_PART, { solid: true, blockLOS: true });
        else addBox(plane, H / 2, c, PT, H, len, color || C_PART, { solid: true, blockLOS: true });
      }
      if (!g) break;
      // the head over the opening: never solid (systems/actorcollide.js
      // clamps NPCs with no vertical span, so a y-gated box still reads
      // full height to them and would seal the door for every body).
      const gc = (g0 + g1) / 2, gw = g1 - g0;
      if (axis === "x") addBox(gc, (DH + H) / 2, plane, gw, H - DH, PT, color || C_PART, { cast: false, blockLOS: true });
      else addBox(plane, (DH + H) / 2, gc, PT, H - DH, gw, color || C_PART, { cast: false, blockLOS: true });
      at = g1;
    }
  }
  partition("x", CORR_Z, IX0, IX1, [D_REC, D_STAFF, D_OFF]);
  partition("z", PX_A, IZ0, CORR_Z, []);
  partition("z", PX_B, IZ0, CORR_Z, []);
  partition("x", QZ, PX_B, IX1, [D_QRT]);

  // ---- floors: one slab per room, tinted by what the room is for --------
  function floor(x0, x1, z0, z1, color) {
    addBox((x0 + x1) / 2, 0.02, (z0 + z1) / 2, x1 - x0, 0.08, z1 - z0, color, { solid: false, cast: false });
  }
  floor(IX0, IX1, CORR_Z, IZ1, 0x9aa1a8);                     // corridor: polished
  floor(IX0, PX_A, IZ0, CORR_Z, C_FLOOR);                     // records
  floor(PX_A, PX_B, IZ0, CORR_Z, C_FLOOR);                    // staff room
  floor(PX_B, IX1, QZ, CORR_Z, C_OFFICE_FLOOR);               // the office gets carpet
  floor(PX_B, IX1, IZ0, QZ, 0x6a5340);                        // quarters

  // ---- ONE ROOF over the whole block (world/roofs.js's primitive) -------
  if (CBZ.prisonRoof) CBZ.prisonRoof({
    id: "adminwing", x0: AW.x0, x1: AW.x1, z0: AW.z0, z1: AW.z1,
    top: H, over: WT / 2, deck: 0x616a75,
  });

  /* ==========================================================
     2. FITTINGS + LIGHT. Every PD fitting queues itself onto the schedule
        (world/cafeteria.js) and world/roofs.js flushes the queue — so a
        strip drawn here is a strip that dies at lights-out, for free.
     ========================================================== */
  const ROOMS = [
    { id: "admin-corridor", x0: IX0, x1: IX1, z0: CORR_Z, z1: IZ1, n: 5, axis: "x" },
    { id: "admin-records", x0: IX0, x1: PX_A, z0: IZ0, z1: CORR_Z, n: 4, axis: "z" },
    { id: "admin-staff", x0: PX_A, x1: PX_B, z0: IZ0, z1: CORR_Z, n: 4, axis: "z" },
    { id: "warden-office", x0: PX_B, x1: IX1, z0: QZ, z1: CORR_Z, n: 3, axis: "x" },
    { id: "warden-quarters", x0: PX_B, x1: IX1, z0: IZ0, z1: QZ, n: 2, axis: "x" },
  ];
  if (PD && typeof PD.strip === "function") {
    for (let i = 0; i < ROOMS.length; i++) {
      const R = ROOMS[i], w = R.x1 - R.x0, d = R.z1 - R.z0;
      const len = Math.max(1.6, Math.min(4.0, (R.axis === "x" ? w : d) * 0.34));
      for (let k = 0; k < R.n; k++) {
        const u = (k + 1) / (R.n + 1);
        const x = R.axis === "x" ? R.x0 + u * w : (R.x0 + R.x1) / 2;
        const z = R.axis === "x" ? (R.z0 + R.z1) / 2 : R.z0 + u * d;
        PD.strip(x, H - 0.42, z, len, R.axis);
      }
    }
    // caged lamps either side of the two locked doors — a lock you cannot
    // see at 2 a.m. is a lock you cannot find.
    PD.lamp(-3.2, 2.9, -45.6, "z+");
    PD.lamp(11.4, 2.9, -48.7, "z-");
    PD.lamp(11.4, 2.9, -50.1, "z+");
  }
  // the wing is an INTERIOR as far as systems/prisonnight.js's sensors are
  // concerned: a body in here is lit by these fittings, not by the sky.
  CBZ.onUpdate(21.35, (function () {
    let done = false;
    return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return;
      done = true;
      CBZ.prisonLights.rooms.push({ id: "admin", x0: AW.x0, x1: AW.x1, z0: AW.z0, z1: AW.z1 });
    };
  })());

  /* ==========================================================
     3. DRESSING — through the shared kits, never new geometry where a kit
        verb exists. CBZ.roomFurnish (world/roombuild.js) plans a real
        layout against real clearances and draws it with CBZ.furnish; the
        hand-built pieces below are the ones no kit ships: the property
        cage, the key board, the muster board and the SAFE.
     ========================================================== */
  function furnish(id, x0, x1, z0, z1, program, door, seed) {
    if (!CBZ.roomFurnish) return null;
    try {
      return CBZ.roomFurnish({ x0: x0, x1: x1, z0: z0, z1: z1, y: 0 }, program, {
        seed: seed | 0, inset: 0.06, lot: id,
        door: { x: door[0], z: door[1] },
      });
    } catch (e) { return null; }
  }
  const plans = {};
  plans.records = furnish("admin-records", IX0, PX_A, IZ0, CORR_Z, "office", [-13.6, CORR_Z], 0x9101);
  plans.staff = furnish("admin-staff", PX_A, PX_B, IZ0, CORR_Z, "breakroom", [-1.6, CORR_Z], 0x9102);
  plans.office = furnish("warden-office", PX_B, IX1, QZ, CORR_Z, "bossoffice", [11.4, CORR_Z], 0x9103);
  plans.quarters = furnish("warden-quarters", PX_B, IX1, IZ0, QZ, "bedroom", [8.4, QZ], 0x9104);

  // ---- RECORDS: the property cage. Bars, not drywall — the same read the
  //      armoury's inner cage has, because it is the same idea: the things
  //      taken off men, kept where the men can see them.
  (function propertyCage() {
    const x0 = -19.4, x1 = -15.6, z0 = -63.4, z1 = -58.6, ch = 2.7;
    const pane = function (x, z, w, d) {
      const p = addBox(x, ch / 2, z, w, ch, d, 0x39424e, { solid: true });
      p.material.transparent = true; p.material.opacity = 0.05; p.material.depthWrite = false;
      p.castShadow = false; p.receiveShadow = false;
      return p;
    };
    pane((x0 + x1) / 2, z1, x1 - x0, 0.12);                 // front (barred)
    pane(x1, (z0 + z1) / 2, 0.12, z1 - z0);                 // east (barred)
    for (let i = 0; i < 9; i++) addBox(x0 + 0.2 + i * 0.44, 1.35, z1, 0.08, 2.62, 0.08, 0x2a2f38, { cast: false });
    for (let i = 0; i < 11; i++) addBox(x1, 1.35, z0 + 0.2 + i * 0.44, 0.08, 2.62, 0.08, 0x2a2f38, { cast: false });
    addBox((x0 + x1) / 2, 2.72, z1, x1 - x0, 0.12, 0.12, 0x2a2f38, { cast: false });
    addBox(x1, 2.72, (z0 + z1) / 2, 0.12, 0.12, z1 - z0, 0x2a2f38, { cast: false });
    // property shelves inside it, stacked with sealed bags
    for (let s = 0; s < 3; s++) {
      addBox(-17.6, 0.6 + s * 0.72, -61.0, 3.4, 0.07, 3.6, 0xb9a184, { cast: false });
      for (let i = 0; i < 4; i++)
        addBox(-18.8 + i * 0.82, 0.78 + s * 0.72, -61.0 + (i % 2) * 0.9, 0.6, 0.28, 0.5,
          [0xc9c2a8, 0x9aa8b4, 0xbfae8c, 0xa7b09a][i], { cast: false });
    }
  })();

  // ---- RECORDS: the key board. Every door in this prison hangs here, and
  //      the one empty hook is the wing's own small story.
  (function keyBoard() {
    addBox(-7.35, 2.0, -55.0, 0.12, 1.5, 3.2, 0x2a2f38, { cast: false });
    for (let i = 0; i < 14; i++)
      addBox(-7.24, 2.42 - ((i / 7) | 0) * 0.62, -56.3 + (i % 7) * 0.42, 0.05, 0.22, 0.05,
        i === 9 ? 0x2a2f38 : 0xd9b64c, { cast: false });
  })();

  // ---- STAFF ROOM: the muster board, and the schedule as an OBJECT.
  (function musterBoard() {
    addBox(5.75, 2.05, -55.5, 0.1, 1.7, 4.0, 0x16202a, { cast: false });
    for (let i = 0; i < 8; i++)
      addBox(5.68, 2.55 - ((i / 4) | 0) * 0.55, -57.1 + (i % 4) * 1.05, 0.03, 0.4, 0.72,
        i % 3 === 0 ? 0xe8e2d2 : 0xd2cdbe, { cast: false });
    // the wall clock. A prison runs on it; systems/prisonschedule.js drives
    // the hands below, which is the only place in this build where the time
    // of day is DRAWN rather than merely obeyed.
    const face = addBox(-6.75, 3.3, -53.0, 0.09, 0.9, 0.9, 0xf0ece2, { cast: false });
    const hh = addBox(-6.68, 3.3, -53.0, 0.03, 0.1, 0.34, 0x1a1d22, { cast: false });
    const mh = addBox(-6.68, 3.3, -53.0, 0.03, 0.06, 0.52, 0x1a1d22, { cast: false });
    hh.userData.mover = true; mh.userData.mover = true; face.userData.mover = true;
    CBZ.onUpdate(21.45, function () {
      const S = CBZ.prisonSchedule;
      if (!S || !S.clock || !CBZ.game || CBZ.game.mode !== "escape") return;
      const t = S.clock();
      const hAng = ((t.h % 12) + t.m / 60) / 12 * Math.PI * 2;
      const mAng = (t.m / 60) * Math.PI * 2;
      hh.rotation.x = -hAng; mh.rotation.x = -mAng;
      hh.position.set(-6.68, 3.3 + Math.cos(hAng) * 0.17, -53.0 - Math.sin(hAng) * 0.17);
      mh.position.set(-6.68, 3.3 + Math.cos(mAng) * 0.26, -53.0 - Math.sin(mAng) * 0.26);
    });
  })();

  // ---- THE OFFICE: the things a warden's office has that no kit ships.
  (function officeDress() {
    // barred window in the north wall — the outside world, three metres of
    // steel away. Fixed pane behind real bars; the wall behind it is solid,
    // so this is a view and never a route. (OWNER RULE: no grey panes — the
    // glass behind bars is the same clear tint the city and the wing use.)
    const pane = addBox(12.9, 3.3, -63.62, 3.6, 1.9, 0.08, 0xbfe9f7,
      { cast: false, emissive: 0x3f8aa6, ei: 0.35 });
    pane.material.transparent = true; pane.material.opacity = 0.62;
    for (let i = 0; i < 6; i++) addBox(11.2 + i * 0.68, 3.3, -63.45, 0.09, 1.9, 0.09, 0x2a2f38, { cast: false });
    // the state flag and the framed commission: the two things on the wall
    // of every warden's office ever photographed
    addBox(19.3, 3.4, -52.6, 0.09, 1.5, 2.4, 0x2c3f6b, { cast: false });
    addBox(19.22, 3.4, -52.6, 0.05, 0.5, 0.9, 0xd9b64c, { cast: false });
    addBox(19.3, 3.3, -55.6, 0.08, 0.9, 0.7, 0x6b5636, { cast: false });
    addBox(19.24, 3.3, -55.6, 0.04, 0.72, 0.54, 0xefe8d6, { cast: false });
    // a decanter set on the sideboard, because he is that kind of warden
    addBox(9.6, 1.02, -56.4, 0.22, 0.34, 0.22, 0x8a6a2c, { cast: false });
    addBox(9.95, 0.94, -56.4, 0.12, 0.18, 0.12, 0xc9d6dd, { cast: false });
  })();

  /* ==========================================================
     4. THE SAFE. NOT A CONTAINER VERB — world/crates.js's whole doctrine is
        that a box you hold [E] on for a randomised payout is a loot chest.
        This one is a LOCK: cracking it costs 9 s of standing still and it
        pays nothing. What it does is OPEN, and what is behind the door are
        physical objects lying on a shelf — a hook, and whatever the hook is
        or is not wearing.
     ========================================================== */
  const SAFE = { x: 18.6, z: -55.9, open: false, t: 0, msg: 0, stocked: false };
  (function safeBody() {
    addBox(SAFE.x, 0.95, SAFE.z, 1.0, 1.9, 1.2, 0x2b3038, { solid: true, blockLOS: false });
    addBox(SAFE.x, 0.06, SAFE.z, 1.1, 0.12, 1.3, 0x1c2026, { cast: false });        // plinth
    addBox(SAFE.x - 0.02, 1.42, SAFE.z, 0.9, 0.22, 1.0, 0x353c46, { cast: false }); // top rail
    // The door, on a pivot at its west edge, so it SWINGS toward the room.
    // Built with plain meshes rather than addBox: addBox parents to
    // CBZ.prisonRoot (materials.js:73), and a leaf that has to ride a pivot
    // must be built into that pivot, not adopted out of the world.
    const pivot = new THREE.Group();
    pivot.position.set(SAFE.x - 0.5, 0, SAFE.z - 0.55);
    pivot.userData.mover = true;
    ROOT.add(pivot);
    function part(w, h, d, color, px, py, pz) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), CBZ.mat(color, {}));
      m.position.set(px, py, pz);
      m.castShadow = false; m.receiveShadow = true;
      pivot.add(m);
      return m;
    }
    const leaf = part(0.12, 1.72, 1.06, 0x39424e, -0.02, 0.95, 0.53);
    const dial = part(0.10, 0.26, 0.26, 0x9aa0a8, -0.10, 1.05, 0.72);
    const spoke = part(0.11, 0.05, 0.22, 0x2b3038, -0.11, 1.05, 0.72);  // the dial's index mark
    part(0.09, 0.09, 0.42, 0x6b7480, -0.10, 0.68, 0.80);       // handle
    SAFE.dial = dial; SAFE.spoke = spoke;
    dial.userData.mover = true; spoke.userData.mover = true;
    // the HOOK. This is the readout: a key hanging on it, or nothing.
    const hook = addBox(SAFE.x + 0.1, 1.42, SAFE.z - 0.2, 0.07, 0.16, 0.07, 0x8b95a1, { cast: false });
    const keyFob = addBox(SAFE.x + 0.1, 1.22, SAFE.z - 0.2, 0.06, 0.3, 0.16, 0xd9b64c,
      { emissive: 0x6a5510, ei: 0.35, cast: false });
    keyFob.userData.mover = true;
    keyFob.visible = false;
    // an interior shelf with the confiscated property on it
    addBox(SAFE.x, 0.72, SAFE.z, 0.86, 0.05, 1.02, 0x4a525c, { cast: false });
    SAFE.pivot = pivot; SAFE.leaf = leaf; SAFE.hook = hook; SAFE.fob = keyFob;
  })();

  /* ==========================================================
     5. THE DOORS. Same shape as world/gunroom.js's armoury gate: the leaf
        and its collider move together, the collider is spliced in and out
        of CBZ.colliders, and the lock answer comes from CBZ.cityLock so the
        police/keycard routes stay whatever the shared ledger says they are.
     ========================================================== */
  function makeDoor(cfg) {
    const d = {
      id: cfg.id, x: (cfg.x0 + cfg.x1) / 2, z: cfg.z, open: false, t: 0,
      x0: cfg.x0, x1: cfg.x1, keys: cfg.keys, label: cfg.label, pick: cfg.pick || 0, picked: 0,
    };
    const w = cfg.x1 - cfg.x0;
    // pivot at the west jamb; the leaf swings into the room it serves
    const pivot = new THREE.Group();
    pivot.position.set(cfg.x0, 0, cfg.z);
    pivot.userData.mover = true;
    ROOT.add(pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, DH - 0.06, 0.1),
      CBZ.mat(cfg.color != null ? cfg.color : 0x3f4a57, {}));
    leaf.position.set(w / 2, (DH - 0.06) / 2, 0);
    leaf.castShadow = false; leaf.receiveShadow = true;
    pivot.add(leaf);
    // hardware: a plate, a handle, and a lamp that is the lock's whole HUD
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.05), CBZ.mat(0x21262e, {}));
    plate.position.set(w - 0.26, 1.02, 0.075); pivot.add(plate);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 }));
    lamp.position.set(w - 0.26, 1.42, 0.09); pivot.add(lamp);
    d.pivot = pivot; d.leaf = leaf; d.lamp = lamp;
    d.collider = { minX: cfg.x0, maxX: cfg.x1, minZ: cfg.z - 0.09, maxZ: cfg.z + 0.09, ref: leaf };
    CBZ.colliders.push(d.collider);
    if (CBZ.losBlockers) CBZ.losBlockers.push(leaf);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) return v;
      d.open = v;
      const i = CBZ.colliders.indexOf(d.collider);
      if (v && i >= 0) CBZ.colliders.splice(i, 1);
      else if (!v && i < 0) CBZ.colliders.push(d.collider);
      if (CBZ.losBlockers) {
        const li = CBZ.losBlockers.indexOf(leaf);
        if (v && li >= 0) CBZ.losBlockers.splice(li, 1);
        else if (!v && li < 0) CBZ.losBlockers.push(leaf);
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      lamp.material.color.setHex(v ? 0x39ff88 : 0xff3b3b);
      lamp.material.emissive.setHex(v ? 0x14c258 : 0xff0000);
      if (!quiet && CBZ.worldSfx) CBZ.worldSfx(v ? "door_open" : "door_close", d.x, d.z, { ref: 10 });
      if (!v) d.picked = 0;
      return v;
    };
    doors.push(d);
    return d;
  }
  const doors = [];
  const staffDoor = makeDoor({
    id: "prison-admin-staff", x0: SG.x0, x1: SG.x1, z: SG.z, keys: ["Keycard"],
    label: "The staff door", color: 0x4a5560,
  });
  const officeDoor = makeDoor({
    id: "prison-warden-office", x0: D_OFF.x0, x1: D_OFF.x1, z: CORR_Z, keys: null,
    label: "The Warden's office", color: 0x5c4326, pick: 3.4,
  });

  // A card door OPENS FOR STAFF. The warden crosses both of these four times
  // a day; that he does is the only reason his routine is legible from the
  // corridor, and it is what makes tailgating an answer.
  // 3.4 m: a card reader's range, and deliberately measured rather than
  // eyeballed — the warden's route turns for the staff door at (-3.2,-46.6),
  // which is EXACTLY 2.6 m from it, and a radius that only just contains his
  // turning point is a radius that fails the day somebody nudges a waypoint.
  // Still short enough that entities/guards.js's indoor tier patrol (nearest
  // approach 5.9 m at its own waypoint (0,-39)) can never hold it open.
  const READER_R2 = 3.4 * 3.4;
  function staffNear(d) {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.dead || g.ko > 0) continue;
      const dx = g.group.position.x - d.x, dz = g.group.position.z - d.z;
      if (dx * dx + dz * dz < READER_R2) return g;
    }
    return null;
  }

  /* ---- the breach routes. One line each, and neither this file nor
       systems/breach.js learns anything about the other: 5 lb is the
       doctrinal row for an opening one man moves through (FM 90-10-1
       app.M), the same row world/door.js's yard door already declares. ---- */
  if (CBZ.registerBreachTarget) {
    CBZ.registerBreachTarget({
      id: "prison-admin-staff", lb: 5, reach: 2.4,
      at: function () { return { x: staffDoor.x, y: 1.4, z: staffDoor.z }; },
      done: function () { return staffDoor.open; },
      defeat: function () { staffDoor.setOpen(true); staffDoor.blown = true; staffDoor.leaf.visible = false; },
    });
    CBZ.registerBreachTarget({
      id: "prison-warden-office", lb: 5, reach: 2.4,
      at: function () { return { x: officeDoor.x, y: 1.4, z: officeDoor.z }; },
      done: function () { return officeDoor.open; },
      defeat: function () { officeDoor.setOpen(true); officeDoor.blown = true; officeDoor.leaf.visible = false; },
    });
    CBZ.registerBreachTarget({
      id: "prison-warden-safe", lb: 5, reach: 2.0,
      at: function () { return { x: SAFE.x, y: 1.0, z: SAFE.z }; },
      done: function () { return SAFE.open; },
      defeat: function () { openSafe(); },
    });
  }

  /* ==========================================================
     6. THE WARDEN'S DAY. Read off CBZ.prisonSchedule, never a private clock.

        Routes are WALKABLE CHAINS, not destinations: entities/guards.js's
        patrol mover is a straight-line walk to g.waypoints[g.wi] with no
        steering at all (:952), so a post on the far side of three walls has
        to be spelled out as the corners of a route somebody could actually
        walk. `transit` is walked once and dropped; `post` is the cycle he
        settles into when he gets there.
     ========================================================== */
  /* HIS DAY IS ONE CORRIDOR LONG, AND THAT IS THE POINT. Every post below
     hangs off a SINGLE SPINE of nodes running from his bunk to the wing's
     staff checkpoint, and each consecutive pair is a straight walk through a
     real opening. That is not tidiness, it is the only thing that works:
     entities/guards.js's patrol mover walks straight at g.waypoints[g.wi]
     with no steering and no path (:952), so a post on the far side of three
     walls has to be spelled out corner by corner.

     THE SPINE DELIBERATELY STOPS AT THE CHECKPOINT. One node further south
     is world/door.js's yard door — the locked one the whole keycard hunt is
     about — and a warden who walked through it twice a day would either need
     it to open for him (handing the player a free tailgate through the
     game's central lock) or would grind against it forever. So the morning
     yard hour puts him AT the checkpoint looking out through it, which is
     where a warden stands at yard call anyway. */
  const SPINE = [
    [8.4, -59.5],    // 0  his quarters, inside the door
    [8.4, -55.5],    // 1  the quarters door, office side
    [11.4, -51.2],   // 2  his office, on the door line
    [11.4, -46.6],   // 3  the corridor, east end
    [-3.2, -46.6],   // 4  the corridor, at the staff door
    [-3.2, -42.0],   // 5  through it, west of the duty desk
    [0, -39],        // 6  the officer's post
    [0, -26],        // 7  mid-tier
    [0, -12.5],      // 8  the staff checkpoint at the wing's south end
  ];
  const POST = {
    // MEASURED, not typed: the bedroom plan puts his bunk at x[12.5,13.8]
    // z[-63.5,-61.4] and a locker in the north-east corner, and the first
    // draft of this cycle walked straight through both (20 blocked samples
    // on a 0.2 m sweep). z = -60.2 is the clear band between the bed's foot
    // and the partition.
    quarters: { at: 0, post: [[10.0, -60.2], [15.4, -60.2]], speed: 1.4 },
    office:   { at: 2, post: [[12.95, -53.6], [17.6, -52.2], [9.2, -52.2]], speed: 1.9 },
    wing:     { at: 6, post: [[0, -36], [0, -26], [0, -39]], speed: 2.6 },
    check:    { at: 8, post: [[-5, -11], [5, -11], [5, -12.5], [-5, -12.5]], speed: 2.4 },
  };
  // the walk between two posts is the slice of the spine between them
  function route(from, to) {
    const a = POST[from], b = POST[to];
    if (!a || !b || a.at === b.at) return [];
    return a.at < b.at ? SPINE.slice(a.at + 1, b.at + 1)
                       : SPINE.slice(b.at, a.at).reverse();
  }
  /* WHICH POST EACH SCHEDULE BLOCK PUTS HIM ON. The keys are
     systems/prisonschedule.js's own BLOCKS ids (:82-91) verbatim — wake ·
     yard · mess · work · supper · count · secure · night — and `secure` and
     `night` are the two that matter, because those are the hours his key is
     hanging in the safe instead of riding on his hip. A block id this table
     does not know is DECLARED rather than guessed at: it lands him at his
     desk and is counted, so a future block added next door shows up as a
     number instead of a warden quietly standing in the wrong room. */
  const DUTY = {
    wake: "wing",       // unlock and count: he is on the tier for it
    yard: "check",      // yard call: at the checkpoint, watching them go out
    mess: "office", work: "office", supper: "office",
    count: "wing",      // evening count: on the tier again
    secure: "quarters", night: "quarters",
  };
  let unknownBlocks = 0;
  function dutyFor(id) {
    if (!id) return "office";
    const k = String(id).toLowerCase().replace(/[^a-z]/g, "");
    if (!DUTY[k]) { unknownBlocks++; return "office"; }
    return DUTY[k];
  }

  const V3 = function (p) { return new THREE.Vector3(p[0], 0, p[1]); };
  const warden = { g: null, at: null, transit: 0, suited: false, dressT: 0 };
  function findWarden() {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) if (list[i].kind === "warden") return list[i];
    return null;
  }
  function sendTo(g, want) {
    const P = POST[want];
    if (!P) return;
    const chain = warden.at ? route(warden.at, want) : [];
    warden.at = want;
    g.waypoints = chain.concat(P.post).map(V3);
    g.wi = 0;
    warden.transit = chain.length;
    g.speed = P.speed;
    // a man walking his own corridors at 2 a.m. carries a torch
    g.flashlightPatrol = (want === "quarters" || want === "wing");
  }
  function offShift() { return warden.at === "quarters"; }

  /* ---- THE SUIT. city/clothes.js parses at index.html:821 — 280 tags after
       entities/guards.js — so this is a deferred first-tick call, the same
       deferral world/crates.js and world/cellblock.js use for their own
       cross-block reach. Style 8 is "Charcoal 3-Piece Suit"; the indices are
       a stable contract (clothes.js:1950). The peaked cap comes OFF with it:
       a warden in a three-piece and an officer's cap is two uniforms. The
       badge stays, because the badge is the point. ---- */
  function dress(g) {
    if (warden.suited || CBZ.CONFIG.PRISON_WARDEN_SUIT === false) return;
    if (!CBZ.applyClothes || !g.char || !g.char.skinSlots) return;
    let ok = null;
    try { ok = CBZ.applyClothes(g.char, { id: "suit", style: 8 }); } catch (e) { ok = null; }
    if (!ok) return;
    warden.suited = true;
    const cap = g.char.skinSlots.cap || [];
    for (let i = 0; i < cap.length; i++) if (cap[i]) cap[i].visible = false;
  }

  /* ==========================================================
     7. THE TICK — doors, the safe, and the day.
     ========================================================== */
  function openSafe() {
    if (SAFE.open) return false;
    SAFE.open = true;
    if (CBZ.worldSfx) CBZ.worldSfx("door_open", SAFE.x, SAFE.z, { ref: 8 });
    stockSafe();
    return true;
  }
  // WHAT IS ACTUALLY IN IT. Objects, laid where they lie — never a payout.
  function stockSafe() {
    if (SAFE.stocked || !CBZ.prisonPlaceItem) return;
    SAFE.stocked = true;
    try {
      CBZ.prisonPlaceItem("Contraband Map", SAFE.x - 0.05, 0.80, SAFE.z + 0.26);
      CBZ.prisonPlaceItem("Luxury Watch", SAFE.x + 0.12, 0.80, SAFE.z - 0.24);
    } catch (e) {}
  }
  let keyLaid = false;
  function driveHook() {
    // ON THE HOOK, OR ON HIS HIP. Never both — see CBZ.adminWingAudit.
    const hung = offShift();
    SAFE.fob.visible = hung && !keyLaid;
    if (!hung || !SAFE.open || keyLaid || !CBZ.prisonPlaceItem) return;
    keyLaid = true;
    SAFE.fob.visible = false;
    try { CBZ.prisonPlaceItem("Gun-Room Key", SAFE.x + 0.1, 1.10, SAFE.z - 0.2); } catch (e) {}
  }

  let lockReg = false, lastBlock = null;
  CBZ.onUpdate(41.4, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape") return;
    if (pollNewRun && pollNewRun()) CBZ.resetAdminWing();
    if (!lockReg && CBZ.cityLockRegister) {
      lockReg = true;
      CBZ.cityLockRegister("prison-admin-staff");
      CBZ.cityLockRegister("prison-warden-office");
    }

    // ---- the leaves swing (the physical half of "open") ----
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        d.t += (want - d.t) * Math.min(1, dt * 4.4);
        if (Math.abs(want - d.t) < 0.01) d.t = want;
        d.pivot.rotation.y = -d.t * 1.9;
      }
    }
    if (SAFE.open && SAFE.pivot.rotation.y > -1.7) SAFE.pivot.rotation.y -= dt * 2.6;
    driveHook();

    if (g.state !== "playing") return;
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;

    // ---- STAFF DOOR: a card reader. Staff walk through it; you need the card.
    if (!staffDoor.open) {
      const s = staffNear(staffDoor);
      if (s) staffDoor.setOpen(true);
      else {
        const dx = P.x - staffDoor.x, dz = P.z - staffDoor.z;
        if (dx * dx + dz * dz < 5.2) {
          const have = !!(g.hasKey || g.role === "cop");
          const L = CBZ.cityLock
            ? CBZ.cityLock({ id: "prison-admin-staff", verb: "press", label: "The staff door",
                have: have, keys: ["Keycard"], orgs: ["police"], power: false })
            : { open: have, line: "" };
          if (L.open) staffDoor.setOpen(true);
        }
      }
    } else if (!staffDoor.blown) {
      // it shuts behind whoever went through, which is what makes tailgating
      // a WINDOW rather than a permanent hole
      const dx = P.x - staffDoor.x, dz = P.z - staffDoor.z;
      const near = dx * dx + dz * dz < 9 || !!staffNear(staffDoor);
      staffDoor.shutT = near ? 2.6 : (staffDoor.shutT || 0) - dt;
      if (staffDoor.shutT <= 0) staffDoor.setOpen(false);
    }

    // ---- OFFICE DOOR: his own lock. He opens it; you pick it.
    if (!officeDoor.open) {
      const s = staffNear(officeDoor);
      if (s && s.kind === "warden") officeDoor.setOpen(true);
      else {
        const dx = P.x - officeDoor.x, dz = P.z - officeDoor.z;
        if (dx * dx + dz * dz < 5.2) pickBeat(officeDoor, dt, "warden-office", officeDoor.pick);
        else if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("warden-office");
      }
    } else if (!officeDoor.blown) {
      const s = staffNear(officeDoor);
      const dx = P.x - officeDoor.x, dz = P.z - officeDoor.z;
      const near = dx * dx + dz * dz < 9 || !!s;
      officeDoor.shutT = near ? 3.2 : (officeDoor.shutT || 0) - dt;
      if (officeDoor.shutT <= 0) officeDoor.setOpen(false);
    }

    // ---- THE SAFE: nine seconds of standing still in his office.
    if (!SAFE.open) {
      const dx = P.x - SAFE.x, dz = P.z - SAFE.z;
      if (dx * dx + dz * dz < 4.4) pickBeat(SAFE, dt, "warden-safe", 9.0, openSafe);
      else if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("warden-safe");
    }

    // ---- THE DAY ----
    if (CBZ.CONFIG.PRISON_WARDEN_ROUTINE === false) return;
    if (!warden.g) {
      warden.g = findWarden();
      if (warden.g) { warden.at = "check"; }   // entities/guards.js starts him there
    }
    const w = warden.g;
    if (!w) return;
    if (!warden.suited) { warden.dressT += dt; if (warden.dressT > 0.4) dress(w); }
    if (w.dead || w.ko > 0) return;
    // transit finished → settle into the post cycle
    if (warden.transit && w.wi >= warden.transit) {
      w.waypoints = POST[warden.at].post.map(V3);
      w.wi = 0; warden.transit = 0;
    }
    const S = CBZ.prisonSchedule;
    const block = S && S.id ? S.id() : null;
    if (block !== lastBlock) {
      lastBlock = block;
      const want = dutyFor(block);
      if (want !== warden.at) sendTo(w, want);
    }
  });

  /* ---- ONE hold-to-defeat beat, shared by the office lock and the safe.
       Same shape as world/gunroom.js's hacksaw: a polled [E], a touch pill
       for the same verb, and a physical tell (the shake) rather than a
       percentage. The Lockpick is the tool; without it there is no prompt,
       because a lock you have nothing to pick with is just a locked door. ---- */
  function pickBeat(target, dt, promptId, secs, onDone) {
    const econ = CBZ.econ;
    const has = !!(econ && econ.hasItem && econ.hasItem("Lockpick"));
    if (!has) { if (CBZ.prisonPromptClear) CBZ.prisonPromptClear(promptId); target.picked = 0; tell(target, 0, 0); return; }
    // The prompt is the TOUCH pill only (desktop arg null → systems/
    // interactions.js prints nothing). What tells a desktop player is the
    // world: the lock's own status lamp goes amber the moment you are stood
    // at a lock your pick will actually open, and it beats faster the further
    // through the shackle you are. That is the security-camera dot metaphor
    // applied to a door, and it is the entire readout.
    if (CBZ.prisonPrompt) CBZ.prisonPrompt(promptId, "e", target === SAFE ? "Pick the safe" : "Pick the lock", null);
    const working = !!(CBZ.keys && CBZ.keys.e);
    if (!working) { target.picked = Math.max(0, (target.picked || 0) - dt * 1.6); tell(target, target.picked / secs, 0); return; }
    target.picked = (target.picked || 0) + dt;
    tell(target, target.picked / secs, 1);
    if (CBZ.shake && target.picked % 0.55 < dt) CBZ.shake(0.02);
    if (target.picked >= secs) {
      target.picked = 0;
      if (CBZ.prisonPromptClear) CBZ.prisonPromptClear(promptId);
      tell(target, 0, 0);
      if (onDone) onDone();
      else target.setOpen(true);
    }
  }
  // p = 0..1 through the lock, live = the pick is actually turning.
  function tell(target, p, live) {
    if (target === SAFE) {
      // a safe dial TURNS. Nothing else needs saying, and while it is turning
      // you are stood still in the warden's office for nine seconds.
      if (SAFE.dial) {
        const a = p * Math.PI * 6;
        SAFE.dial.rotation.x = a;
        if (SAFE.spoke) {
          SAFE.spoke.rotation.x = a;
          SAFE.spoke.position.y = 1.05 + Math.cos(a) * 0.085;
          SAFE.spoke.position.z = 0.72 - Math.sin(a) * 0.085;
        }
      }
      return;
    }
    const lamp = target.lamp;
    if (!lamp || target.open) return;
    if (!p && !live) { lamp.material.color.setHex(0xff3b3b); lamp.material.emissive.setHex(0xff0000); return; }
    // amber, beating faster the closer the shackle is to giving
    const beat = live ? (Math.sin((CBZ.now || 0) * (0.010 + p * 0.024)) > 0) : true;
    lamp.material.color.setHex(beat ? 0xffb347 : 0x7a4f18);
    lamp.material.emissive.setHex(beat ? 0xff7a1a : 0x2a1a06);
  }

  /* A NEW RUN RE-LOCKS EVERYTHING. Hooked the way systems/prisonschedule.js
     hooks it — CBZ.jailBoost's run watcher and its state-exit list — rather
     than by editing systems/state.js's reset, which already has a dozen
     owners. Tear down on the RUN ending, never on a pause: unlocking the
     warden's office behind the pause card and re-locking it on resume is the
     exact bug that list exists to prevent. */
  CBZ.resetAdminWing = function () {
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      d.blown = false; d.picked = 0; d.shutT = 0;
      if (d.leaf) d.leaf.visible = true;
      d.setOpen(false, true);
      d.t = 0; d.pivot.rotation.y = 0;
    }
    SAFE.open = false; SAFE.picked = 0; SAFE.pivot.rotation.y = 0;
    keyLaid = false; lastBlock = null;
    if (warden.g) { warden.at = "check"; sendTo(warden.g, "check"); warden.transit = 0; }
  };
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit)
    CBZ.jailBoost.onStateExit(CBZ.resetAdminWing, ["title", "won", "lost"]);
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.5) : null;

  /* ==========================================================
     8. THE RATCHET.
        `unreachable` — a locked thing whose declared routes are all absent
        from the game (a door nothing in the world can open). `keyBothPlaces`
        — the Gun-Room Key visibly hanging in the safe while its owner is
        also wearing it: the one way this design can lie.
     ========================================================== */
  CBZ.adminWingAudit = function () {
    const econ = CBZ.econ;
    const routes = {
      staff: (CBZ.cityLock ? 1 : 0) + (CBZ.registerBreachTarget ? 1 : 0),
      office: (econ && econ.hasItem ? 1 : 0) + (CBZ.registerBreachTarget ? 1 : 0),
      safe: (econ && econ.hasItem ? 1 : 0) + (CBZ.registerBreachTarget ? 1 : 0),
    };
    let unreachable = 0;
    for (const k in routes) if (!routes[k]) unreachable++;
    const S = CBZ.prisonSchedule;
    return {
      on: true, rooms: ROOMS.length, doors: doors.length,
      rect: { x0: AW.x0, x1: AW.x1, z0: AW.z0, z1: AW.z1 },
      unreachable: unreachable,                       // MUST be 0
      keyBothPlaces: (SAFE.fob.visible && !offShift()) ? 1 : 0,   // MUST be 0
      unknownBlocks: unknownBlocks,                   // schedule ids DUTY has no post for
      warden: warden.g ? {
        post: warden.at, transit: warden.transit, suited: warden.suited,
        x: Math.round(warden.g.group.position.x * 10) / 10,
        z: Math.round(warden.g.group.position.z * 10) / 10,
      } : null,
      block: S && S.id ? S.id() : null,
      offShift: offShift(),
      safeOpen: SAFE.open, keyOnHook: !!SAFE.fob.visible,
      staffOpen: staffDoor.open, officeOpen: officeDoor.open,
      plans: {
        records: plans.records ? plans.records.pieces.length : 0,
        staff: plans.staff ? plans.staff.pieces.length : 0,
        office: plans.office ? plans.office.pieces.length : 0,
        quarters: plans.quarters ? plans.quarters.pieces.length : 0,
      },
    };
  };
})();
