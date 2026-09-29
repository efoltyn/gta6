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

   (2026-09-28) The key is ONE object that moves (driveHook): pocket on shift,
   hook at night, back at shift change; lifted off him means an empty hook.
   He is no longer the only holder: the run's armory sergeant wears a
   duplicate (systems/economy.js armorySergeant), so the cage has a key on a
   reachable belt on every run. tools/armory-reach-check.mjs proves it.

   ---- LOCKS: THE LOCKPICK FINALLY HAS A VERB ----------------------------
   world/gunroom.js's inner cage taught the Hacksaw Blade its first verb.
   The Lockpick was the other tool in that pair and still had none — a fence
   price and nothing to do. It is this wing's key:

       staff door ..... Keycard (a card reader; the same card the yard door
                        and the armoury take) — or 5 lb of C4.
       office door .... LOCKPICK, ~3.4 s on the mortice — or 5 lb.
       the safe ....... LOCKPICK, ~9 s on the barrel — or 5 lb.

   Both card doors OPEN FOR STAFF, because a staff door with a reader on it
   does. The warden walks through them several times a day, which makes
   tailgating a real answer and makes his routine legible from the corridor.

   ---- HIS DAY -----------------------------------------------------------
   systems/prisonwarden.js owns his head: the DUTY table (office most of the
   working day, rounds at 11:30 and 17:00 with officers at his shoulders, the
   wing throat for the evening count, quarters from 21:00), his incident
   orders and his summons. This file owns his BODY: the posts, the walk
   between them, the chair, the doors. Each frame it asks CBZ.warden which
   post he belongs on and walks him there.

   Flags PRISON_ADMIN_WING, PRISON_WARDEN_SEATED.
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
  const HALF = Math.PI / 2;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_ADMIN_WING == null) CBZ.CONFIG.PRISON_ADMIN_WING = true;
  /* HE SITS DOWN (owner 2026-08-11: "the warden should be seated at his own
     locked office"). He had the office, the lock and the routine, and then
     PACED it: POST.office was a three-point walking cycle, so the man whose
     whole design is "getting the key means getting to the man at his desk"
     spent his working day doing laps of his own carpet. A boss who is walking
     is a boss you can meet in a corridor; a boss in a CHAIR, behind a desk, at
     the far end of a room whose door needs a lockpick, is the approach the
     bossoffice program (world/roombuild.js) was drawn for.
     CBZ.furnish.bossDesk already reports the throne's seat anchor and
     city/propuse.js already owns the seated rig (entities/character.js's
     `ch.sitting` branch owns the whole body). Nothing new is authored here:
     this finds his own chair and puts him in it. Flag off -> the pacing cycle
     returns byte for byte. */
  if (CBZ.CONFIG.PRISON_WARDEN_SEATED == null) CBZ.CONFIG.PRISON_WARDEN_SEATED = true;
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
  // door openings, each {x0,x1} on its partition. A room door is a 1.1 m
  // rough opening for one 0.9 m leaf in a frame (they were 1.8 m holes with
  // no door at all); the Warden's office keeps its 1.8 m for a PAIR of leaves,
  // the one room in the block that gets double doors.
  const D_REC = { x0: -14.15, x1: -13.05 };
  const D_STAFF = { x0: -2.15, x1: -1.05 };
  const D_OFF = { x0: 10.5, x1: 12.3 };
  const D_QRT = { x0: 7.85, x1: 8.95 };      // centred on the warden's route x = 8.4
  const FL = 0.06;                            // finished floor (PD.floor's top)

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

  // ---- floors: a real finish per room, at real tile scale ----------------
  // (2026-09-27: they were five flat-colour slabs; the "carpet" was brown paint)
  function floor(x0, x1, z0, z1, color, kind) {
    if (PD && PD.floor) return PD.floor(x0, x1, z0, z1, kind || "vct", color);
    addBox((x0 + x1) / 2, 0.02, (z0 + z1) / 2, x1 - x0, 0.08, z1 - z0, color, { solid: false, cast: false });
  }
  // corridor VCT: mid grey. At 0xc9 under five troffers it read as a white
  // void through the staff door from the cell block (owner's screenshot).
  floor(IX0, IX1, CORR_Z, IZ1, 0xa3a59f, "vct");
  floor(IX0, PX_A, IZ0, CORR_Z, 0xc3bdae, "vct");              // records
  floor(PX_A, PX_B, IZ0, CORR_Z, 0xbfc3bd, "vct");             // staff room
  floor(PX_B, IX1, QZ, CORR_Z, 0x6e5d4c, "carpet");            // the office gets carpet tile
  floor(PX_B, IX1, IZ0, QZ, 0x5f6670, "carpet");               // quarters

  // ---- ONE ROOF over the whole block (world/roofs.js's primitive) -------
  if (CBZ.prisonRoof) CBZ.prisonRoof({
    id: "adminwing", x0: AW.x0, x1: AW.x1, z0: AW.z0, z1: AW.z1,
    top: H, over: WT / 2, deck: 0x616a75, soffit: false,   // the rooms have ceilings
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
  /* CEILINGS AT 3.0 m (2026-09-27). An office block is not a 6 m shed: each
     room gets a lay-in ceiling with 2 x 4 troffers on the schedule, and every
     wall a vinyl base and a painted dado. `F` = the room's FACES (partitions
     are 0.4 thick, so a face is 0.2 off its plane); the corridor's south side
     is the cell house's north wall face. */
  const PH = PT / 2, CEIL = 3.0, SOUTH = -44.45;
  const FACES = {
    "admin-corridor": { x0: IX0, x1: IX1, z0: CORR_Z + PH, z1: SOUTH,
      doors: [{ side: "N", a0: D_REC.x0, a1: D_REC.x1 }, { side: "N", a0: D_STAFF.x0, a1: D_STAFF.x1 },
        { side: "N", a0: D_OFF.x0, a1: D_OFF.x1 }, { side: "S", a0: SG.x0, a1: SG.x1 }], dado: 0x7d838c },
    "admin-records": { x0: IX0, x1: PX_A - PH, z0: IZ0, z1: CORR_Z - PH,
      doors: [{ side: "S", a0: D_REC.x0, a1: D_REC.x1 }], dado: 0x7d838c },
    "admin-staff": { x0: PX_A + PH, x1: PX_B - PH, z0: IZ0, z1: CORR_Z - PH,
      doors: [{ side: "S", a0: D_STAFF.x0, a1: D_STAFF.x1 }], dado: 0x6f7f8c },
    "warden-office": { x0: PX_B + PH, x1: IX1, z0: QZ + PH, z1: CORR_Z - PH,
      doors: [{ side: "S", a0: D_OFF.x0, a1: D_OFF.x1 }, { side: "N", a0: D_QRT.x0, a1: D_QRT.x1 }], dado: 0x6b5a48, rail: 0x4a3a2a },
    "warden-quarters": { x0: PX_B + PH, x1: IX1, z0: IZ0, z1: QZ - PH,
      doors: [{ side: "S", a0: D_QRT.x0, a1: D_QRT.x1 }], dado: 0x707a86 },
  };
  if (PD && PD.ceiling) {
    for (let i = 0; i < ROOMS.length; i++) {
      const R = ROOMS[i], F = FACES[R.id];
      PD.trim(F, F.doors, { dado: F.dado, dadoH: 1.0, base: 0x2b2d30, rail: F.rail });
      PD.ceiling(F, CEIL, { id: R.id, kind: "acoustic", lights: "troffer", along: R.axis,
        nx: R.axis === "x" ? R.n : 1, nz: R.axis === "x" ? 1 : R.n });
    }
    // a caged lamp over each locked door, ON the wall above its architrave
    // (x,y,z = the plate 6 cm off the face, `face` = the wall's outward
    // normal). They hung 0.5-1.1 m out in the air facing the wrong way.
    PD.lamp(-3.2, 2.84, SG.z - 0.5 - 0.06, "z-", { w: 0.36, h: 0.22 });   // staff door, admin side
    PD.lamp(11.4, 2.66, CORR_Z + PH + 0.06, "z+");           // the Warden's doors, corridor side
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
  plans.records = furnish("admin-records", IX0, PX_A, IZ0, CORR_Z, "office", [(D_REC.x0 + D_REC.x1) / 2, CORR_Z], 0x9101);
  plans.staff = furnish("admin-staff", PX_A, PX_B, IZ0, CORR_Z, "breakroom", [(D_STAFF.x0 + D_STAFF.x1) / 2, CORR_Z], 0x9102);
  // the office is NOT planner-furnished: see WARDEN'S OFFICE below
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
    // the kit's bars (world/corridorkit.js BARS): 25 mm round at 125 mm on
    // flat straps, channel rails, tube posts; one mesh, and it casts
    const CKb = CBZ.corridorKit, B = CKb.BARS, BC = 0x2a2f38, BP = new CKb.Paint();
    const run = function (along, f, a, b) {
      const w = b - a, n = Math.max(1, Math.round(w / B.pitch));
      const at = function (u) { return along ? [f, u] : [u, f]; };
      for (let k = 1; k < n; k++) { const p = at(a + k * w / n); BP.cyl(p[0], ch / 2, p[1], B.r, ch - 0.2, BC, 8); }
      const m = at((a + b) / 2);
      const bx = function (y, hh, thin) { along ? BP.box(m[0], y, m[1], thin, hh, w, BC) : BP.box(m[0], y, m[1], w, hh, thin, BC); };
      bx(0.05, 0.1, 0.06); bx(ch - 0.05, 0.1, 0.06);
      for (let k = 1; k < 5; k++) bx(0.1 + k * (ch - 0.2) / 5, B.strap, B.strapT);
      for (const u of [a, b]) { const p = at(u); BP.box(p[0], ch / 2, p[1], 0.08, ch, 0.08, BC); }
    };
    run(false, z1, x0, x1);
    run(true, x1, z0, z1);
    BP.mesh(ROOT, true);
    /* PROPERTY SHELVES, AND THEY WERE THE SAME LIE THE CAGES TOLD. This drew
       three 3.4 x 3.6 m cream planes 7 cm thick — one per level, sized to the
       WHOLE cage — and scattered twelve bags across them. Measured
       (prison-rooms baseline, room `admin-records`): the two upper planes are
       the block's two biggest dead boxes at 0.857 m3 EACH, 1.71 m3 of the
       admin wing's 3.11 m3 total, and a body walked through all of it.
       One rack instead: 0.70 m deep against the cage's back wall, three decks,
       four uprights, ONE collider over its own footprint. The bags stand on
       the decks in a row where a property clerk would actually put them, and
       every one of them is inside reach from the aisle. */
    // PRISON_PROP_HONESTY_V1 (world/cellblock.js) — one-line revert.
    if (!(CBZ.CONFIG && CBZ.CONFIG.PRISON_PROP_HONESTY_V1 !== false)) {
      for (let s2 = 0; s2 < 3; s2++) {                 // the shipped shelves, byte for byte
        addBox(-17.6, 0.6 + s2 * 0.72, -61.0, 3.4, 0.07, 3.6, 0xb9a184, { cast: false });
        for (let i = 0; i < 4; i++)
          addBox(-18.8 + i * 0.82, 0.78 + s2 * 0.72, -61.0 + (i % 2) * 0.9, 0.6, 0.28, 0.5,
            [0xc9c2a8, 0x9aa8b4, 0xbfae8c, 0xa7b09a][i], { cast: false });
      }
      return;
    }
    const RX0 = -19.20, RX1 = -16.00, RZ = -63.00, RD = 0.70, RH = 2.32;
    for (let s = 0; s < 3; s++) {
      addBox((RX0 + RX1) / 2, 0.58 + s * 0.72, RZ, RX1 - RX0 - 0.14, 0.05, RD - 0.10, 0x9aa2aa, { cast: false });
      for (let i = 0; i < 4; i++)
        addBox(RX0 + 0.5 + i * 0.73, 0.75 + s * 0.72, RZ, 0.6, 0.28, 0.5,
          [0xc9c2a8, 0x9aa8b4, 0xbfae8c, 0xa7b09a][i], { cast: false });
    }
    for (const ux of [RX0 + 0.05, RX1 - 0.05]) for (const uz of [RZ - RD / 2 + 0.05, RZ + RD / 2 - 0.05])
      addBox(ux, RH / 2, uz, 0.08, RH, 0.08, 0x5b6470, { cast: false });
    addBox((RX0 + RX1) / 2, RH / 2, RZ - RD / 2 + 0.03, RX1 - RX0, RH, 0.05, 0x6f7883, { cast: false });
    (CBZ.colliders || (CBZ.colliders = [])).push({
      minX: RX0, maxX: RX1, minZ: RZ - RD / 2, maxZ: RZ + RD / 2, y0: 0, y1: RH });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  })();

  // ---- RECORDS: the key board. Every door in this prison hangs here, and
  //      the one empty hook is the wing's own small story.
  //      It stood 9 cm off the wall with its fourteen "keys" (gold sticks)
  //      drawn BEHIND it, in the gap. Now it is on the wall: a ply board in a
  //      steel edge, labelled hook pins, a ring and a key on every hook but
  //      one, each with its coloured tag.
  (function keyBoard() {
    if (!PD || !PD.Paint) return;
    const WX = -7.2, V = new PD.Paint();               // the records side of the partition; front faces -x
    V.box(-0.03, 0, 0, 0.05, 1.5, 3.2, 0x6a563c);                                     // board
    for (const s2 of [-1, 1]) {
      V.box(-0.035, s2 * 0.77, 0, 0.06, 0.04, 3.28, 0x5b6470);                         // steel edge
      V.box(-0.035, 0, s2 * 1.62, 0.06, 1.58, 0.04, 0x5b6470);
    }
    for (let i = 0; i < 14; i++) {
      const y = 0.42 - ((i / 7) | 0) * 0.62, z = -1.3 + (i % 7) * 0.42;
      V.box(-0.058, y + 0.08, z, 0.004, 0.04, 0.12, 0xe8e2d2);                           // the hook's label
      V.cyl(-0.085, y, z, 0.006, 0.006, 0.06, 0x9aa3ad, 6, 0, HALF);                     // pin
      if (i === 9) continue;                                                               // the empty hook
      V.add(new THREE.TorusGeometry(0.022, 0.003, 4, 12).rotateY(HALF).translate(-0.1, y - 0.025, z), 0x9aa3ad);
      V.box(-0.1, y - 0.085, z, 0.004, 0.07, 0.024, 0xc9a44a);                            // key
      V.box(-0.098, y - 0.065, z + 0.03, 0.004, 0.05, 0.035, [0xc94d3a, 0x3a6ec9, 0xd9d4c8, 0x3aa06a][i % 4]);   // tag
    }
    V.mesh(WX, 2.0, -55.0);
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
    // a ROUND school clock (it was a square white board): white dial,
    // black bezel, twelve hour marks, the hub the hands turn on
    const face = addBox(-6.75, 2.45, -53.0, 0.09, 0.62, 0.62, 0xf0ece2, { cast: false });
    if (PD && PD.Paint) {
      const C = new PD.Paint();
      C.cyl(0, 0, 0, 0.29, 0.29, 0.06, 0xf0ece2, 32, 0, HALF);
      C.add(new THREE.TorusGeometry(0.3, 0.028, 6, 32).rotateY(HALF).translate(0.012, 0, 0), 0x1a1d22);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, big = i % 3 === 0;
        C.box(0.032, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.004, big ? 0.06 : 0.035, big ? 0.018 : 0.01, 0x1a1d22, 0);
      }
      C.cyl(0.05, 0, 0, 0.018, 0.018, 0.04, 0x1a1d22, 10, 0, HALF);
      face.geometry.dispose(); face.geometry = C.geometry(); face.material = PD.vcMat();
    }
    const hh = addBox(-6.68, 2.45, -53.0, 0.03, 0.1, 0.34, 0x1a1d22, { cast: false });
    const mh = addBox(-6.68, 2.45, -53.0, 0.03, 0.06, 0.52, 0x1a1d22, { cast: false });
    hh.userData.mover = true; mh.userData.mover = true; face.userData.mover = true;
    CBZ.onUpdate(21.45, function () {
      const S = CBZ.prisonSchedule;
      if (!S || !S.clock || !CBZ.game || CBZ.game.mode !== "escape") return;
      const t = S.clock();
      const hAng = ((t.h % 12) + t.m / 60) / 12 * Math.PI * 2;
      const mAng = (t.m / 60) * Math.PI * 2;
      hh.rotation.x = -hAng; mh.rotation.x = -mAng;
      hh.position.set(-6.68, 2.45 + Math.cos(hAng) * 0.17, -53.0 - Math.sin(hAng) * 0.17);
      mh.position.set(-6.68, 2.45 + Math.cos(mAng) * 0.26, -53.0 - Math.sin(mAng) * 0.26);
    });
  })();

  // ---- THE QUARTERS' WINDOW, in the building's north wall behind his bed.
  //      Fixed pane behind real bars; the wall behind it is solid, so this is
  //      a view and never a route. (It sat in "officeDress" for years although
  //      the office has no north outside wall. The pane no longer glows: an
  //      emissive window read as a lit panel at 3 a.m.)
  (function quartersWindow() {
    const pane = addBox(12.9, 1.8, -63.62, 3.0, 1.3, 0.08, 0xbfe9f7, { cast: false });
    pane.material.transparent = true; pane.material.opacity = 0.62;
    addBox(12.9, 1.8, -63.6, 3.16, 1.46, 0.05, 0x3a3f46, { cast: false });           // frame
    addBox(12.9, 1.1, -63.5, 3.2, 0.05, 0.2, 0xd8d2c4, { cast: false });             // sill
    for (let i = 0; i < 5; i++) addBox(11.7 + i * 0.6, 1.8, -63.45, 0.05, 1.3, 0.05, 0x2a2f38, { cast: false });
  })();

  /* ==========================================================
     THE WARDEN'S OFFICE, BUILT BY HAND (2026-09-28).
     The owner looked through the door and saw a planner room: CBZ.furnish's
     boxy bossDesk + two kitchen chairs in 100 m2 of carpet, a flag that was a
     blue rectangle painted flat on the wall, a "commission" that was a cream
     card, and no door. A warden's office is a set piece every prison film
     agrees on, so it is drawn as one: a panelled executive desk facing the
     door with a tufted leather chair behind it, two leather guest chairs, a
     flag on a stand, a bookcase, filing cabinets, the CCTV bank he watches
     the block on, framed photographs and his diploma, a window with the
     blinds drawn, a rug, a credenza with the decanter, and the GUN CASE on
     the wall behind him.
     One Paint (merged, vertex-coloured, one draw) per piece; two small
     canvas atlases (the CCTV feeds, the pictures); no lights. Everything
     stands on the finished floor (FL) or hangs on a wall face.
     Room faces: x 6.2 .. 19.7, z -57.2 (north) .. -49.6 (south, the doors).
     ========================================================== */
  const OFF = { x0: PX_B + PH, x1: IX1, zN: QZ + PH, zS: CORR_Z - PH };
  const OFFICE = { pieces: [] };
  plans.office = OFFICE;
  const WALNUT = 0x5b3a22, WALNUT_D = 0x3e2716, WALNUT_L = 0x70492a, BRASS = 0xb08d4a;
  const LEATHER = 0x5a2118, LEATHER_D = 0x3a130e, NYLON = 0x1f1f22;
  function solid(x0, x1, z0, z1, y1) {
    (CBZ.colliders || (CBZ.colliders = [])).push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: 0, y1: y1 });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function seatAt(x, z, face, kind, cushion) {
    const geom = { cushion: cushion, floorBelow: 0 };
    try {
      if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(x, 0, z, face, kind, "warden-office", geom);
      else if (CBZ.roomSeatAnchor) CBZ.roomSeatAnchor(x, 0, z, face, kind, "warden-office", geom);
    } catch (e) {}
  }
  // a tiny seeded LCG so the bookcase is the same bookcase every load
  function lcg(seed) { let s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  // an atlas tile: a plane whose UVs cover tile (col,row) of a cols x rows
  // canvas; row 0 is the TOP row of the canvas
  function tilePlane(w, h, col, cols, row, rows) {
    rows = rows || 1; row = row || 0;
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setX(k, (col + uv.getX(k)) / cols);
      uv.setY(k, (rows - 1 - row + uv.getY(k)) / rows);
    }
    return g;
  }
  function mergeGeos(list) {
    const BGU = THREE.BufferGeometryUtils;
    if (!list.length) return null;
    return list.length === 1 || !BGU ? list[0] : BGU.mergeBufferGeometries(list, false);
  }
  // THE CCTV FEEDS: six grey camera views of corridors and a yard, drawn once
  // (no text, no timestamp: a feed is a picture)
  let cctvMat = null, picMat = null;
  function cctvMaterial() {
    if (cctvMat) return cctvMat;
    const c = document.createElement("canvas"); c.width = 768; c.height = 256;
    const g = c.getContext("2d"), r = lcg(0x5eed);
    for (let i = 0; i < 6; i++) {
      const ox = (i % 3) * 256, oy = ((i / 3) | 0) * 128, W = 256, H = 128;
      const base = 70 + ((r() * 30) | 0);
      g.fillStyle = "rgb(" + base + "," + (base + 6) + "," + base + ")"; g.fillRect(ox, oy, W, H);
      // a corridor in one-point perspective, or a yard with a fence
      const vx = ox + 60 + r() * 136, vy = oy + 30 + r() * 30;
      g.fillStyle = "rgb(" + (base + 40) + "," + (base + 46) + "," + (base + 40) + ")";
      g.beginPath(); g.moveTo(ox, oy + H); g.lineTo(vx - 12, vy + 14); g.lineTo(vx + 12, vy + 14); g.lineTo(ox + W, oy + H); g.fill();
      g.strokeStyle = "rgba(20,24,20,0.8)"; g.lineWidth = 2;
      for (const ex of [ox, ox + W]) { g.beginPath(); g.moveTo(ex, oy); g.lineTo(vx + (ex > vx ? 12 : -12), vy - 14); g.stroke(); }
      for (let k = 0; k < 4; k++) {                 // doors / cell fronts down the side
        const t = 0.25 + k * 0.17, dx = ox + (vx - ox) * t, dh = (1 - t) * 60 + 8;
        g.fillStyle = "rgba(30,34,30,0.75)"; g.fillRect(dx, vy + (oy + H - vy) * t - dh, 6 + (1 - t) * 10, dh);
      }
      if (r() < 0.5) {                               // a figure somewhere on the floor
        const fx = vx + (r() - 0.5) * 60, fy = vy + 30 + r() * 30;
        g.fillStyle = "rgba(25,28,25,0.9)"; g.fillRect(fx, fy - 18, 6, 18); g.beginPath(); g.arc(fx + 3, fy - 21, 3.5, 0, 6.3); g.fill();
      }
      const img = g.getImageData(ox, oy, W, H), d = img.data;
      for (let p = 0; p < d.length; p += 4) {        // sensor noise + scanlines + vignette
        const y = ((p / 4) / W) | 0, x = (p / 4) % W;
        const v = (Math.random() - 0.5) * 18 - (y % 3 === 0 ? 10 : 0) - Math.hypot(x - W / 2, y - H / 2) * 0.22;
        d[p] += v; d[p + 1] += v + 3; d[p + 2] += v;
      }
      g.putImageData(img, ox, oy);
    }
    const tex = new THREE.CanvasTexture(c);
    cctvMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xaebbb2 });
    return cctvMat;
  }
  // THE PICTURES: his diploma (a seal and ruled script lines, no words) and
  // three photographs (a group on steps, a lake, a handshake before a flag)
  function pictureMaterial() {
    if (picMat) return picMat;
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    // 0 diploma
    g.fillStyle = "#efe8d6"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#8a7440"; g.lineWidth = 3; g.strokeRect(8, 8, 112, 112); g.lineWidth = 1; g.strokeRect(13, 13, 102, 102);
    g.fillStyle = "#3b3326"; g.fillRect(34, 26, 60, 6);
    g.fillStyle = "#6d6555";
    for (let i = 0; i < 6; i++) g.fillRect(26 + (i % 2) * 6, 44 + i * 8, 76 - (i % 3) * 10, 2);
    g.fillStyle = "#b0892f"; g.beginPath(); g.arc(64, 100, 11, 0, 6.3); g.fill();
    g.fillStyle = "#8a2020"; g.fillRect(58, 108, 4, 12); g.fillRect(66, 108, 4, 12);
    // 1 group photo on steps
    let grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, "#9aa3a0"); grd.addColorStop(1, "#6d6a62");
    g.fillStyle = grd; g.fillRect(128, 0, 128, 128);
    g.fillStyle = "#58564f"; for (let i = 0; i < 3; i++) g.fillRect(128, 84 + i * 14, 128, 6);
    for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
      const x = 140 + k * 18 + row * 9, y = 58 + row * 22;
      g.fillStyle = row ? "#2e3440" : "#3a3a3a"; g.fillRect(x, y, 12, 26);
      g.fillStyle = "#c9a88a"; g.beginPath(); g.arc(x + 6, y - 4, 5, 0, 6.3); g.fill();
    }
    // 2 a lake at dusk
    grd = g.createLinearGradient(0, 0, 0, 70); grd.addColorStop(0, "#5f7c9a"); grd.addColorStop(1, "#e2b98a");
    g.fillStyle = grd; g.fillRect(256, 0, 128, 70);
    g.fillStyle = "#35463a"; g.beginPath(); g.moveTo(256, 70); g.lineTo(290, 40); g.lineTo(318, 58); g.lineTo(350, 34); g.lineTo(384, 62); g.lineTo(384, 70); g.fill();
    grd = g.createLinearGradient(0, 70, 0, 128); grd.addColorStop(0, "#8a8474"); grd.addColorStop(1, "#3d4a55");
    g.fillStyle = grd; g.fillRect(256, 70, 128, 58);
    // 3 a handshake before a flag
    g.fillStyle = "#7d8288"; g.fillRect(384, 0, 128, 128);
    g.fillStyle = "#23315e"; g.fillRect(452, 6, 40, 58); g.fillStyle = "#b0892f"; g.fillRect(450, 4, 3, 110);
    for (const x of [404, 452]) { g.fillStyle = "#26282c"; g.fillRect(x, 46, 26, 82); g.fillStyle = "#c29c80"; g.beginPath(); g.arc(x + 13, 38, 10, 0, 6.3); g.fill(); }
    g.fillStyle = "#c29c80"; g.fillRect(428, 78, 26, 6);
    const tex = new THREE.CanvasTexture(c);
    picMat = new THREE.MeshLambertMaterial({ map: tex });
    return picMat;
  }
  function paintMesh(P, x, y, z, ry, parent) {
    const geo = P.geometry();
    if (!geo) return null;
    const m = new THREE.Mesh(geo, PD.vcMat());
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    m.castShadow = false; m.receiveShadow = true;
    (parent || ROOT).add(m);
    return m;
  }
  function atlasMesh(geos, mat, x, y, z, ry) {
    const geo = mergeGeos(geos);
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    ROOT.add(m);
    return m;
  }

  // THE DESK — faces the door. 2.2 x 0.95, twin pedestals with drawers on
  // his side, a panelled modesty front on yours, a green leather writing
  // surface, and what is on it. Local +z = toward the door.
  const DESK = { x: 14.0, z: -55.1, L: 2.2, D: 0.95, top: 0.76 };
  if (PD && PD.Paint) (function desk() {
    const P = new PD.Paint(), L = DESK.L, D = DESK.D, T = DESK.top;
    P.box(0, T - 0.02, 0, L, 0.04, D, WALNUT);                                   // top
    P.box(0, T - 0.047, 0, L - 0.05, 0.014, D - 0.05, WALNUT_D);                 // shadow line under it
    P.box(0, T + 0.0015, -0.06, 1.16, 0.003, 0.6, 0xa88a4a);                     // gilt tooling
    P.box(0, T + 0.003, -0.06, 1.12, 0.004, 0.56, 0x2f4a33);                     // green leather
    for (const s of [-1, 1]) {
      const px = s * (L / 2 - 0.25);
      P.box(px, 0.03, 0, 0.42, 0.06, D - 0.12, WALNUT_D);                        // toe kick
      P.box(px, 0.06 + 0.33, 0, 0.46, 0.66, D - 0.06, WALNUT);                   // pedestal
      // his side: a pencil drawer, a box drawer, a file drawer, brass pulls
      const bands = [[0.55, 0.70], [0.38, 0.535], [0.07, 0.365]];
      for (const b of bands) {
        const cy = (b[0] + b[1]) / 2, hh = b[1] - b[0];
        P.box(px, cy, -(D - 0.06) / 2 - 0.006, 0.42, hh, 0.012, WALNUT_L);
        P.box(px, cy + hh * 0.18, -(D - 0.06) / 2 - 0.022, 0.12, 0.012, 0.012, BRASS);
        for (const e of [-0.05, 0.05]) P.box(px + e, cy + hh * 0.18, -(D - 0.06) / 2 - 0.015, 0.012, 0.012, 0.018, BRASS);
      }
      P.box(px, 0.4, (D - 0.06) / 2 + 0.004, 0.34, 0.5, 0.008, WALNUT_L);        // raised panel, your side
    }
    const mw = L - 2 * 0.48;
    P.box(0, 0.4, D / 2 - 0.1, mw, 0.62, 0.025, WALNUT);                          // modesty front
    P.box(0, 0.42, D / 2 - 0.085, mw - 0.14, 0.44, 0.008, WALNUT_L);              // its raised panel
    // on the desk: a banker's lamp, a monitor turned to him, a keyboard, the
    // phone, a stack of files, a pen stand
    P.cyl(-0.86, T + 0.012, 0.22, 0.075, 0.08, 0.024, BRASS, 18);
    P.cyl(-0.86, T + 0.17, 0.22, 0.009, 0.009, 0.3, BRASS, 8);
    P.add(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(-0.86, T + 0.33, 0.14), 0x1f5a36);
    P.box(0.5, T + 0.006, 0.26, 0.2, 0.012, 0.15, NYLON);                          // monitor foot
    P.box(0.5, T + 0.14, 0.28, 0.04, 0.26, 0.03, NYLON);                           // neck
    P.box(0.5, T + 0.36, 0.26, 0.58, 0.35, 0.03, 0x16181b);                        // monitor
    P.box(0.5, T + 0.36, 0.244, 0.55, 0.32, 0.003, 0x0d1115);                      // its dark glass, toward him
    P.box(0.42, T + 0.01, -0.16, 0.44, 0.018, 0.14, 0x2a2c30);                     // keyboard
    P.box(0.94, T + 0.028, -0.12, 0.2, 0.05, 0.18, NYLON);                         // phone
    P.box(0.94, T + 0.066, -0.13, 0.22, 0.03, 0.05, NYLON);                        // handset
    for (let i = 0; i < 4; i++) P.box(-0.38 + i * 0.006, T + 0.008 + i * 0.016, -0.18, 0.24, 0.014, 0.32, [0xc9b27a, 0xb89f68, 0x8fa0b0, 0xc9b27a][i], 0.03 * (i % 2 ? 1 : -1));
    P.cyl(0.08, T + 0.05, 0.25, 0.035, 0.035, 0.1, WALNUT_D, 12);                 // pen stand
    const m = paintMesh(P, DESK.x, FL, DESK.z, 0);
    if (m) m.castShadow = true;
    solid(DESK.x - L / 2, DESK.x + L / 2, DESK.z - D / 2, DESK.z + D / 2, FL + T + 0.02);
    OFFICE.pieces.push({ tag: "desk", x: DESK.x, z: DESK.z });
  })();

  // HIS CHAIR — a high-back leather executive chair on a five-star base,
  // buttoned back, headroll, padded arms. The seat anchor is his ("throne",
  // the kind findChair() asks for).
  const CHAIR = { x: DESK.x, z: -56.1 };
  if (PD && PD.Paint) (function chair() {
    const P = new PD.Paint(), t = -0.12;
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      P.box(Math.sin(a) * 0.15, 0.085, Math.cos(a) * 0.15, 0.05, 0.035, 0.3, 0x9aa0a6, a);
      P.cyl(Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29, 0.028, 0.028, 0.03, NYLON, 10, HALF);
    }
    P.cyl(0, 0.26, 0, 0.026, 0.026, 0.32, NYLON, 10);                              // gas lift
    P.box(0, 0.43, -0.02, 0.24, 0.05, 0.24, NYLON);                                // tilt mechanism
    P.box(0, 0.47, 0, 0.54, 0.07, 0.52, LEATHER_D);                                // seat pan
    P.box(0, 0.5, 0.01, 0.5, 0.04, 0.48, LEATHER);                                 // cushion -> 0.52
    P.cyl(0, 0.495, 0.25, 0.035, 0.035, 0.5, LEATHER, 10, 0, HALF);                // front roll
    const bk = function (x, y, z) {                 // a point on the reclined back
      return [x, 0.92 + y * Math.cos(t) - z * Math.sin(t), -0.27 + y * Math.sin(t) + z * Math.cos(t)];
    };
    P.add(new THREE.BoxGeometry(0.54, 0.7, 0.1).rotateX(t).translate(0, 0.92, -0.27), LEATHER);
    P.add(new THREE.BoxGeometry(0.5, 0.64, 0.02).rotateX(t).translate(bk(0, 0, -0.058)[0], bk(0, 0, -0.058)[1], bk(0, 0, -0.058)[2]), LEATHER_D);
    const hr = bk(0, 0.36, 0.01);
    P.cyl(hr[0], hr[1], hr[2], 0.06, 0.06, 0.52, LEATHER, 12, 0, HALF);           // headroll
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {                      // buttoning
      const q = bk(-0.15 + c * 0.15 + (r % 2) * 0.075 - 0.0375, -0.24 + r * 0.15, 0.052);
      P.add(new THREE.SphereGeometry(0.012, 6, 4).translate(q[0], q[1], q[2]), LEATHER_D);
    }
    for (const s of [-1, 1]) {
      P.box(s * 0.3, 0.6, -0.04, 0.035, 0.22, 0.05, NYLON);                          // arm post
      P.box(s * 0.3, 0.725, 0.0, 0.075, 0.045, 0.36, LEATHER);                       // arm pad
    }
    const m = paintMesh(P, CHAIR.x, FL, CHAIR.z, 0);
    if (m) m.castShadow = true;
    seatAt(CHAIR.x, CHAIR.z + 0.01, 0, "throne", FL + 0.52);
    OFFICE.pieces.push({ tag: "chair", x: CHAIR.x, z: CHAIR.z });
  })();

  // TWO GUEST CHAIRS across the desk: leather on turned walnut legs, facing him
  if (PD && PD.Paint) (function guests() {
    for (const gx of [DESK.x - 0.62, DESK.x + 0.62]) {
      const P = new PD.Paint(), gz = DESK.z + DESK.D / 2 + 0.66;
      for (const lx of [-0.21, 0.21]) for (const lz of [-0.2, 0.2]) P.cyl(lx, 0.21, lz, 0.022, 0.016, 0.42, WALNUT, 8);
      P.box(0, 0.44, 0, 0.5, 0.07, 0.48, LEATHER_D);                                // seat frame
      P.box(0, 0.465, 0.01, 0.48, 0.03, 0.46, LEATHER);                             // cushion -> 0.48
      P.add(new THREE.BoxGeometry(0.5, 0.46, 0.07).rotateX(-0.1).translate(0, 0.73, -0.23), LEATHER);
      for (const s of [-1, 1]) {
        P.box(s * 0.265, 0.62, -0.02, 0.05, 0.03, 0.46, WALNUT);                    // arm rail
        P.cyl(s * 0.265, 0.53, 0.19, 0.016, 0.016, 0.16, WALNUT, 8);                 // arm post
      }
      paintMesh(P, gx, FL, gz, Math.PI);                                             // facing the desk
      seatAt(gx, gz, Math.PI, "chair", FL + 0.48);
      OFFICE.pieces.push({ tag: "guest", x: gx, z: gz });
    }
  })();

  // THE RUG under the desk group: a navy border round an oxblood field
  (function rug() {
    const x0 = 12.35, x1 = 15.65, z0 = -56.85, z1 = -53.25;
    const b = addBox((x0 + x1) / 2, FL + 0.005, (z0 + z1) / 2, x1 - x0, 0.01, z1 - z0, 0x27294a, { cast: false });
    const f = addBox((x0 + x1) / 2, FL + 0.0065, (z0 + z1) / 2, x1 - x0 - 0.36, 0.013, z1 - z0 - 0.36, 0x6a2a24, { cast: false });
    const i = addBox((x0 + x1) / 2, FL + 0.0075, (z0 + z1) / 2, x1 - x0 - 0.7, 0.015, z1 - z0 - 0.7, 0x7b3a2c, { cast: false });
    for (const m of [b, f, i]) m.receiveShadow = true;
  })();

  // FILING CABINETS: three four-drawer steel cabinets on the west wall
  if (PD && PD.Paint) (function files() {
    const P = new PD.Paint(), STEEL = 0x8a877c;
    for (const cx of [-0.48, 0, 0.48]) {
      P.box(cx, 0.665, 0, 0.47, 1.33, 0.62, STEEL);
      P.box(cx, 1.337, 0, 0.475, 0.014, 0.625, 0x77746a);
      for (let i = 0; i < 4; i++) {
        const cy = 0.17 + i * 0.325;
        P.box(cx, cy, 0.316, 0.43, 0.305, 0.012, 0x97948a);                          // drawer front
        P.box(cx, cy + 0.03, 0.334, 0.15, 0.028, 0.024, 0xc2c6ca);                   // pull
        P.box(cx, cy + 0.095, 0.323, 0.085, 0.035, 0.003, 0xd8d4c8);                 // blank label card
      }
    }
    const x = OFF.x0 + 0.03 + 0.31, z = -50.9;
    paintMesh(P, x, FL, z, HALF);
    solid(OFF.x0, OFF.x0 + 0.66, z - 0.72, z + 0.72, FL + 1.35);
    OFFICE.pieces.push({ tag: "files", x: x, z: z });
  })();

  // THE CCTV BANK: a console on the west wall, six monitors on a wall rack
  // above it, the block's feeds on them. The screens are the one thing in
  // the room that glows, because they are screens.
  if (PD && PD.Paint) (function cctv() {
    const P = new PD.Paint(), L = 2.6, x = OFF.x0 + 0.03 + 0.3, z = -53.85;
    P.box(0, 0.78, 0, L, 0.04, 0.6, 0x3b3f45);                                      // worktop
    for (const s of [-1, 1]) P.box(s * (L / 2 - 0.02), 0.39, 0, 0.04, 0.78, 0.58, 0x2c3036);
    P.box(0, 0.42, -0.27, L - 0.08, 0.7, 0.02, 0x2c3036);                           // back panel
    P.box(0, 0.08, 0.27, L - 0.08, 0.12, 0.02, 0x2c3036);                           // kick
    P.box(-0.4, 0.81, 0.12, 0.45, 0.02, 0.15, 0x2a2c30);                            // keyboard
    P.box(0.35, 0.82, 0.1, 0.3, 0.04, 0.2, NYLON);                                  // PTZ controller
    P.cyl(0.42, 0.88, 0.1, 0.012, 0.016, 0.1, NYLON, 8);                            // its joystick
    P.add(new THREE.SphereGeometry(0.022, 8, 6).translate(0.42, 0.94, 0.1), 0x8a1a14);
    for (const s of [-1, 1]) P.box(s * 1.24, 1.8, -0.27, 0.05, 1.2, 0.04, 0x4a5058);   // rack uprights
    for (const ry of [1.2, 2.34]) P.box(0, ry, -0.27, 2.52, 0.04, 0.04, 0x4a5058);        // rails
    const screens = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const sx = -0.82 + c * 0.82, sy = 1.5 + r * 0.54;
      P.box(sx, sy, -0.22, 0.78, 0.5, 0.06, 0x16181b);                               // monitor
      P.box(sx, sy - 0.27, -0.26, 0.08, 0.06, 0.06, 0x4a5058);                        // bracket
      screens.push(tilePlane(0.72, 0.43, c, 3, r, 2).translate(sx, sy, -0.188));
    }
    paintMesh(P, x, FL, z, HALF);
    atlasMesh(screens, cctvMaterial(), x, FL, z, HALF);
    solid(OFF.x0, OFF.x0 + 0.66, z - L / 2, z + L / 2, FL + 0.8);
    OFFICE.pieces.push({ tag: "cctv", x: x, z: z });
  })();

  // THE BOOKCASE on the north wall, west of his chair: two bays, five shelves
  if (PD && PD.Paint) (function books() {
    const P = new PD.Paint(), r = lcg(0xb00c), W = 2.0, Dd = 0.36;
    const x = 10.6, z = OFF.zN + 0.03 + Dd / 2;
    for (const s of [-1, 0, 1]) P.box(s * (W / 2 - 0.015), 1.05, 0, s ? 0.03 : 0.025, 2.1, Dd, WALNUT);
    P.box(0, 2.12, 0.005, W + 0.04, 0.04, Dd + 0.03, WALNUT_D);                     // cornice
    P.box(0, 0.05, -0.01, W - 0.03, 0.1, Dd - 0.02, WALNUT_D);                       // plinth
    P.box(0, 1.06, -Dd / 2 + 0.006, W - 0.03, 2.0, 0.012, WALNUT_D);                 // back
    const PAL = [0x5a1f1b, 0x1f2c4a, 0x2d4a2f, 0x8a6a3e, 0x1e1d1b, 0x6b2e2a, 0x3a4a5e, 0x9a8a62, 0x4a2a3a];
    for (let sh = 0; sh < 5; sh++) {
      const sy = 0.12 + sh * 0.4;
      P.box(0, sy, 0, W - 0.04, 0.025, Dd - 0.02, WALNUT);
      for (const bay of [-1, 1]) {
        let bx = bay < 0 ? -W / 2 + 0.04 : 0.02;
        const end = bay < 0 ? -0.02 : W / 2 - 0.04;
        const binders = sh === 0 && bay > 0;
        while (bx < end - 0.1) {
          if (!binders && r() < 0.06) { bx += 0.08 + r() * 0.1; continue; }      // a gap
          const bw = binders ? 0.06 : 0.022 + r() * 0.03, bh = binders ? 0.31 : 0.2 + r() * 0.13, bd = binders ? 0.28 : 0.19 + r() * 0.07;
          if (bx + bw > end) break;
          const col = binders ? (r() < 0.5 ? 0x1e2a44 : 0x1b1b1d) : PAL[(r() * PAL.length) | 0];
          P.box(bx + bw / 2, sy + 0.0125 + bh / 2, -Dd / 2 + 0.02 + bd / 2, bw, bh, bd, col);
          bx += bw + 0.002;
        }
        if (!binders) {                                                               // one leaning at the end
          const lh = 0.24;
          P.add(new THREE.BoxGeometry(0.03, lh, 0.21).rotateZ(0.22).translate(end - 0.05, sy + 0.0125 + lh / 2 - 0.012, -Dd / 2 + 0.13), PAL[(r() * PAL.length) | 0]);
        }
      }
    }
    paintMesh(P, x, FL, z, 0);
    solid(x - W / 2 - 0.02, x + W / 2 + 0.02, OFF.zN, OFF.zN + 0.03 + Dd, FL + 2.14);
    OFFICE.pieces.push({ tag: "bookcase", x: x, z: z });
  })();

  // THE FLAG, on a stand in the corner behind the desk: weighted base, a
  // turned pole, a spear finial, and the flag hanging off it in folds with a
  // gold fringe. No state is named: a plain navy field.
  if (PD && PD.Paint) (function flag() {
    const P = new PD.Paint(), H = 2.3, x = 12.35, z = -56.72;
    P.cyl(0, 0.03, 0, 0.17, 0.19, 0.06, 0x3a2d1c, 20);
    P.cyl(0, 0.08, 0, 0.05, 0.08, 0.06, BRASS, 14);
    P.cyl(0, H / 2, 0, 0.016, 0.019, H - 0.1, 0x6e4c2a, 10);
    P.add(new THREE.SphereGeometry(0.032, 10, 8).translate(0, H - 0.02, 0), BRASS);
    P.add(new THREE.ConeGeometry(0.028, 0.14, 8).translate(0, H + 0.08, 0), BRASS);
    const N = 6, fly = 0.72;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, w = fly / N;
      const drop = 1.3 - (u0 + u1) / 2 * 0.28;                      // the fly sags lower than the hoist
      const cx = 0.03 + (u0 + u1) / 2 * fly, zz = (i % 2 ? 0.035 : -0.035);
      const yaw = i % 2 ? 0.55 : -0.55;
      P.add(new THREE.BoxGeometry(w * 1.12, drop, 0.008).rotateY(yaw).translate(cx, H - 0.08 - drop / 2, zz), 0x1f2c55);
      P.add(new THREE.BoxGeometry(w * 1.12, 0.045, 0.012).rotateY(yaw).translate(cx, H - 0.08 - drop - 0.02, zz), 0xc9a449);
    }
    paintMesh(P, x, FL, z, 0);
    OFFICE.pieces.push({ tag: "flag", x: x, z: z });
  })();

  // THE WALLS: his diploma and three photographs in real frames, a big one
  // behind the desk, and the east window with its venetian blind drawn.
  if (PD && PD.Paint) (function walls() {
    const F = new PD.Paint(), pics = [];
    // hung(x, y, z, ry, w, h, tile, frameColour): frame + mat + picture,
    // local +z out of the wall, the frame's back on the wall face
    function hung(x, y, z, ry, w, h, tile, fc) {
      const c = Math.cos(ry), s = Math.sin(ry);
      const at = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
      const box = (lx, ly, lz, bw, bh, bd, col) => {
        const p = at(lx, ly, lz);
        F.add(new THREE.BoxGeometry(bw, bh, bd).rotateY(ry).translate(p[0], p[1], p[2]), col);
      };
      const fw = 0.045;
      box(0, h / 2 - fw / 2, 0.02, w, fw, 0.04, fc); box(0, -h / 2 + fw / 2, 0.02, w, fw, 0.04, fc);
      box(-w / 2 + fw / 2, 0, 0.02, fw, h - 2 * fw, 0.04, fc); box(w / 2 - fw / 2, 0, 0.02, fw, h - 2 * fw, 0.04, fc);
      box(0, 0, 0.006, w - 2 * fw, h - 2 * fw, 0.012, 0xe9e4d8);                     // mat board
      const p = at(0, 0, 0.0135);
      pics.push(tilePlane(w - 2 * fw - 0.08, h - 2 * fw - 0.08, tile, 4).rotateY(ry).translate(p[0], p[1], p[2]));
    }
    const E = OFF.x1, N = OFF.zN;
    hung(DESK.x, FL + 1.95, N, 0, 1.0, 0.72, 1, 0x2a1c12);                         // the group photo, behind him
    hung(E, FL + 1.72, -50.55, -HALF, 0.5, 0.64, 0, 0x8a6a2e);                     // the diploma, gilt
    hung(E, FL + 1.92, -51.4, -HALF, 0.46, 0.36, 2, 0x1e1e20);
    hung(E, FL + 1.44, -51.4, -HALF, 0.46, 0.36, 3, 0x1e1e20);
    // THE WINDOW + BLIND on the east wall (local +z = into the room)
    const wz = -53.2, W = 1.8, y0 = FL + 0.98, y1 = FL + 2.38;
    const B = new PD.Paint();
    B.box(0, (y0 + y1) / 2, 0.004, W, y1 - y0, 0.008, 0x7f97a6);                    // the glass behind the slats
    for (const s of [-1, 1]) B.box(s * (W / 2 + 0.03), (y0 + y1) / 2, 0.03, 0.06, y1 - y0 + 0.12, 0.06, 0xc9cdd0);
    B.box(0, y1 + 0.03, 0.03, W + 0.12, 0.06, 0.06, 0xc9cdd0);
    B.box(0, y0 - 0.02, 0.07, W + 0.2, 0.035, 0.14, 0xd8d4c8);                       // sill
    B.box(0, y1 - 0.03, 0.08, W - 0.02, 0.05, 0.06, 0xe6e3dc);                       // blind head rail
    for (let yy = y1 - 0.08; yy > y0 + 0.04; yy -= 0.045)
      B.add(new THREE.BoxGeometry(W - 0.06, 0.004, 0.05).rotateX(0.55).translate(0, yy, 0.08), 0xe9e6de);
    B.box(0, y0 + 0.03, 0.08, W - 0.04, 0.02, 0.05, 0xe6e3dc);                       // bottom rail
    B.cyl(W / 2 - 0.12, (y0 + y1) / 2 + 0.2, 0.11, 0.006, 0.006, 0.9, 0xd8d4cc, 6);  // tilt wand
    paintMesh(B, E, 0, wz, -HALF);
    const fm = paintMesh(F, 0, 0, 0, 0);
    atlasMesh(pics, pictureMaterial(), 0, 0, 0, 0);
    OFFICE.pieces.push({ tag: "window", x: E, z: wz });
    if (fm) fm.castShadow = false;
  })();

  // THE CREDENZA on the south wall east of the doors, and the decanter on it
  // (it used to stand on whatever sideboard the planner happened to place)
  if (PD && PD.Paint) (function credenza() {
    const P = new PD.Paint(), L = 1.8, Dd = 0.46, T = 0.76;
    const x = 15.3, z = OFF.zS - 0.03 - Dd / 2;
    P.box(0, 0.03, 0, L - 0.08, 0.06, Dd - 0.08, WALNUT_D);
    P.box(0, 0.06 + (T - 0.1) / 2, 0, L - 0.02, T - 0.1, Dd - 0.02, WALNUT);
    P.box(0, T - 0.02, 0, L, 0.04, Dd, WALNUT);
    for (let i = 0; i < 4; i++) {
      const dx = -L / 2 + 0.03 + (i + 0.5) * ((L - 0.06) / 4);
      P.box(dx, 0.38, Dd / 2, (L - 0.06) / 4 - 0.012, 0.6, 0.012, WALNUT_L);
      P.box(dx + (i % 2 ? -1 : 1) * 0.16, 0.52, Dd / 2 + 0.018, 0.012, 0.12, 0.012, BRASS);
    }
    // the decanter set, on the top
    const D = (lx, ly, lz) => [lx, T + ly, lz];
    let q = D(-0.35, 0.09, 0); P.cyl(q[0], q[1], q[2], 0.075, 0.085, 0.18, 0x7a4f1c, 16);
    q = D(-0.35, 0.19, 0); P.cyl(q[0], q[1], q[2], 0.03, 0.075, 0.03, 0xb8c6cc, 16);
    q = D(-0.35, 0.24, 0); P.cyl(q[0], q[1], q[2], 0.025, 0.025, 0.07, 0xb8c6cc, 12);
    q = D(-0.35, 0.3, 0); P.add(new THREE.SphereGeometry(0.035, 10, 8).translate(q[0], q[1], q[2]), 0xb8c6cc);
    q = D(-0.1, 0.006, 0); P.box(q[0], q[1], q[2], 0.36, 0.012, 0.22, 0xb9bec2);  // silver tray
    for (const dz of [-0.06, 0.06]) { q = D(-0.05 + dz, 0.05, dz); P.cyl(q[0], q[1], q[2], 0.035, 0.03, 0.08, 0xc9d6dd, 12, 0, 0, true); }
    q = D(0.45, 0.14, -0.08); P.box(q[0], q[1], q[2], 0.26, 0.2, 0.03, 0x2a1c12);   // a standing photo frame, back to the wall
    paintMesh(P, x, FL, z, Math.PI);
    solid(x - L / 2, x + L / 2, OFF.zS - 0.03 - Dd, OFF.zS, FL + T);
    OFFICE.pieces.push({ tag: "credenza", x: x, z: z });
  })();

  /* THE GUN CASE: a steel wall case on the north wall east of his chair, a
     wired-glass door on a piano hinge, green baize, a pistol on two pegs and
     a box of rounds on the floor of it. Locked: the Lockpick opens it (the
     same held pick the office door takes, shorter: a cabinet lock is not a
     mortice). What is inside is the REAL pistol the moment the door is open:
     systems/prisondrops.js lays a "Gun" drop on the case's shelf and the
     walk-over pickup takes it like any gun on any floor. Nothing announces it. */
  const CASE = { x: 16.3, z: OFF.zN + 0.13, y: FL + 1.5, open: false, t: 0, picked: 0, laid: false, gun: null };
  (function gunCase() {
    const W = 0.84, H = 0.9, Dd = 0.24, cz = CASE.z, cy = CASE.y, x = CASE.x;
    const STEEL = 0x2e3338;
    if (PD && PD.Paint) {
      const P = new PD.Paint();
      P.box(0, 0, -Dd / 2 + 0.01, W, H, 0.02, STEEL);                               // back
      for (const s of [-1, 1]) P.box(s * (W / 2 - 0.015), 0, 0, 0.03, H, Dd, STEEL);
      for (const s of [-1, 1]) P.box(0, s * (H / 2 - 0.015), 0, W, 0.03, Dd, STEEL);
      P.box(0, 0, -Dd / 2 + 0.023, W - 0.06, H - 0.06, 0.006, 0x2f4a36);          // baize
      P.box(0, -H / 2 + 0.05, 0, W - 0.06, 0.02, Dd - 0.02, 0x3a4048);             // shelf
      for (const px of [-0.12, 0.1]) P.cyl(px, 0.02, -Dd / 2 + 0.05, 0.007, 0.007, 0.06, 0x9aa3ad, 6, HALF);   // pegs
      P.box(0.22, -H / 2 + 0.09, -0.02, 0.12, 0.06, 0.08, 0x3d5a2e);                 // rounds
      P.box(0.22, -H / 2 + 0.121, -0.02, 0.121, 0.004, 0.081, 0xc9a449);
      paintMesh(P, x, cy, cz, 0);
    }
    CASE.shelfY = cy - H / 2 + 0.06;
    // the door, on a pivot at its west edge so it SWINGS out toward the room
    const pivot = new THREE.Group();
    pivot.position.set(x - W / 2 + 0.03, cy, cz + Dd / 2);
    pivot.userData.mover = true;
    ROOT.add(pivot);
    const frameM = CBZ.mat(0x3a4048, {});
    const bar = function (w, h, d, px, py) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameM);
      m.position.set(px, py, 0.012); pivot.add(m); return m;
    };
    const dw = W - 0.06;
    bar(dw, 0.04, 0.024, dw / 2, H / 2 - 0.05); bar(dw, 0.04, 0.024, dw / 2, -H / 2 + 0.05);
    bar(0.04, H - 0.06, 0.024, 0.02, 0); bar(0.04, H - 0.06, 0.024, dw - 0.02, 0);
    const K2 = CBZ.prisonKit;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.06, H - 0.14, 0.006),
      K2 ? K2.skin("glass", 0xa9bcc4) : new THREE.MeshLambertMaterial({ color: 0xa9bcc4, transparent: true, opacity: 0.35 }));
    glass.position.set(dw / 2, 0, 0.012); pivot.add(glass);
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12).rotateX(HALF), CBZ.mat(0xb9bfc4, {}));
    lock.position.set(dw - 0.02, 0, 0.03); pivot.add(lock);
    CASE.pivot = pivot;
    // the display pistol: the game's own pistol model, side-on, on the pegs
    if (CBZ.buildActorWeapon) {
      try {
        const gun = CBZ.buildActorWeapon("Gun");
        gun.position.set(x + 0.02, cy + 0.06, cz - Dd / 2 + 0.058);
        gun.rotation.set(0, HALF, 0);
        gun.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale("Gun")) || 0.66);
        gun.userData.mover = true;
        ROOT.add(gun);
        CASE.display = gun;
      } catch (e) { CASE.display = null; }
    }
    // the shelf is a support the dropped pistol can rest on
    (CBZ.platforms || (CBZ.platforms = [])).push({
      minX: x - W / 2 + 0.03, maxX: x + W / 2 - 0.03, minZ: cz - Dd / 2 + 0.02, maxZ: cz + Dd / 2 - 0.01, top: CASE.shelfY });
    OFFICE.pieces.push({ tag: "guncase", x: x, z: cz });
  })();
  function openCase() {
    if (CASE.open) return false;
    CASE.open = true;
    if (CBZ.worldSfx) CBZ.worldSfx("door_open", CASE.x, CASE.z, { ref: 6 });
    layCaseGun();
    return true;
  }
  // the real pistol, laid where the display hung. prisonDropOne rather than
  // prisonPlaceItem: a placed item is re-laid by every new run whether the
  // case is open or not (and would be walked over through the glass); a drop
  // exists only once the case is open, and a new run sweeps it.
  function layCaseGun() {
    if (CASE.laid || !CBZ.prisonDropOne) return;
    const SPAWN_Y = 1.06;                               // prisondrops.js's chest-height offset
    let inst = null;
    try {
      inst = CBZ.prisonDropOne("Gun", CASE.x + 0.02, CASE.y + 0.06 - SPAWN_Y, CASE.z - 0.04, { dir: 0, speed: 0, up: 0 });
    } catch (e) { inst = null; }
    if (!inst) return;
    CASE.laid = true; CASE.gun = inst;
    if (inst.data) inst.data.life = Infinity;          // it lies in his case until someone takes it
    if (CASE.display) CASE.display.visible = false;
    // it leaves the pegs the way it hung (side-on along the wall), not
    // spinning: a gun slipping off two pegs onto a shelf 30 cm below
    const b = inst.data && inst.data.body;
    if (b) {
      if (b.q) b.q.setFromEuler(new THREE.Euler(0, HALF, 0));
      b.wx = 0; b.wy = 0; b.wz = 0;
    }
    if (inst.data && inst.data.mesh) inst.data.mesh.rotation.set(0, HALF, 0);
  }

  /* THE SEAM: CBZ.wardenGun. The warden's behaviour and the missing-gun
     lockdown feature-detect exactly this shape. `present()` is true while the
     pistol is in his case (on the pegs, or lying on the case shelf once the
     glass is open); `take(who)` removes it for whoever takes it (the caller
     arms them); `put(who)` hangs it back. */
  function caseGunLying() {
    const g = CASE.gun;
    if (!g || !g.data || g.data.taken) return false;
    const m = g.data.mesh;
    if (m && !m.parent) return false;
    const p = m ? m.position : null;
    return !p || (Math.abs(p.x - CASE.x) < 1.2 && Math.abs(p.z - CASE.z) < 1.2);
  }
  CBZ.wardenGun = {
    x: CASE.x, z: CASE.z, weapon: "Gun",
    present: function () {
      if (CASE.taken) return false;
      return CASE.laid ? caseGunLying() : true;
    },
    take: function (who) {
      if (!CBZ.wardenGun.present()) return false;
      CASE.taken = true;
      if (CASE.laid && CASE.gun) {
        try { CASE.gun.data.taken = true; if (CBZ.removeProp) CBZ.removeProp(CASE.gun); } catch (e) {}
        CASE.gun = null;
      }
      if (CASE.display) CASE.display.visible = false;
      return true;
    },
    put: function (who) {
      if (CBZ.wardenGun.present()) return false;
      CASE.taken = false;
      if (CASE.open) { CASE.laid = false; CASE.gun = null; layCaseGun(); }
      else if (CASE.display) CASE.display.visible = true;
      return true;
    },
  };

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
    dial.geometry.dispose();
    dial.geometry = new THREE.CylinderGeometry(0.12, 0.125, 0.06, 28).rotateZ(Math.PI / 2);   // a dial is round
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
    // ...and the shelf is a support, so what is laid on it stays on it
    (CBZ.platforms || (CBZ.platforms = [])).push({
      minX: SAFE.x - 0.43, maxX: SAFE.x + 0.43, minZ: SAFE.z - 0.51, maxZ: SAFE.z + 0.51, top: 0.745 });
    SAFE.pivot = pivot; SAFE.leaf = leaf; SAFE.hook = hook; SAFE.fob = keyFob;
  })();

  /* ==========================================================
     5. THE DOORS. Every doorway in the block is a real door set now
     (world/corridorkit.js's CBZ.corridorKit.doorSet): a steel frame that
     wraps the wall, a stop, architraves both faces, leaves on three hinges
     at the face they swing to, animated open and shut, SOLID when shut (the
     collider spans the wall's depth and is spliced in and out of
     CBZ.colliders with the leaf) and out of the way when open (square to the
     wall). The owner's "stupid opening, the door has no physics": the staff
     door was a 2 m slab pivoting on the wall's centre line that swung 109
     degrees back through its own wall; the Warden's office door was the same
     slab in a raw hole; the records room, staff room and his quarters had
     1.8 m holes and no door at all.
     The lock answer still comes from CBZ.cityLock / the Lockpick, so the
     police/keycard routes stay whatever the shared ledger says they are.
     ========================================================== */
  const CK = CBZ.corridorKit || null;
  const LEAF_T = 0.05;
  // one lever set: rose, neck and lever on BOTH faces, pointing at the hinge
  function lever(P, x, y, dir, col) {
    for (const f of [-1, 1]) {
      P.cyl(x, y, f * (LEAF_T / 2 + 0.006), 0.027, 0.027, 0.012, col, 14, HALF);
      P.cyl(x, y, f * (LEAF_T / 2 + 0.03), 0.009, 0.009, 0.045, col, 8, HALF);
      P.box(x - dir * 0.055, y, f * (LEAF_T / 2 + 0.05), 0.13, 0.018, 0.02, col);
      P.cyl(x, y - 0.09, f * (LEAF_T / 2 + 0.004), 0.017, 0.017, 0.008, col, 12, HALF);   // key escutcheon
    }
  }
  function leafMesh(P, g) {
    const geo = P.geometry();
    if (!geo) return null;
    const m = new THREE.Mesh(geo, PD.vcMat());
    m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function glassPane(g, w, h, x, y) {
    const K2 = CBZ.prisonKit;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.008),
      K2 ? K2.skin("glass", 0xa9bcc4) : new THREE.MeshLambertMaterial({ color: 0xa9bcc4, transparent: true, opacity: 0.35 }));
    m.position.set(x, y, 0); g.add(m);
    return m;
  }
  /* A PANELLED WALNUT OFFICE LEAF: stiles and rails round a raised lower
     panel and a glazed upper light, kick plates, a lever set. `hold` gets
     the leaf's lock LED when this leaf carries the lock. */
  function woodLeaf(hold, lockOn) {
    return function (g, w, h, dir, i) {
      if (!PD || !PD.Paint) return null;
      const P = new PD.Paint(), WD = 0x6b4426, WDD = 0x55361e, ST = 0.13, xs = function (u) { return dir * u; };
      P.box(xs(ST / 2), h / 2, 0, ST, h, LEAF_T, WD);                                   // hinge stile
      P.box(xs(w - ST / 2), h / 2, 0, ST, h, LEAF_T, WD);                               // lock stile
      const iw = w - 2 * ST, ic = xs(w / 2);
      P.box(ic, 0.12, 0, iw, 0.24, LEAF_T, WD);                                         // bottom rail
      P.box(ic, 1.0, 0, iw, 0.2, LEAF_T, WD);                                           // lock rail
      P.box(ic, h - 0.09, 0, iw, 0.18, LEAF_T, WD);                                     // top rail
      P.box(ic, 0.57, 0, iw, 0.66, LEAF_T - 0.018, WDD);                                // lower panel (sunk)
      P.box(ic, 0.57, 0, iw - 0.12, 0.54, LEAF_T - 0.004, WD);                          // its raised field
      for (const f of [-1, 1]) P.box(ic, 0.13, f * (LEAF_T / 2 + 0.001), w - 0.05, 0.22, 0.002, 0xa7adb3);   // kick plates
      // the glazed light: beads round the glass, both faces
      const gy0 = 1.1, gy1 = h - 0.18, gh = gy1 - gy0;
      for (const f of [-1, 1]) {
        P.box(ic, gy0 + 0.01, f * 0.016, iw, 0.02, 0.012, WDD); P.box(ic, gy1 - 0.01, f * 0.016, iw, 0.02, 0.012, WDD);
        P.box(xs(ST + 0.01), (gy0 + gy1) / 2, f * 0.016, 0.02, gh, 0.012, WDD);
        P.box(xs(w - ST - 0.01), (gy0 + gy1) / 2, f * 0.016, 0.02, gh, 0.012, WDD);
      }
      lever(P, xs(w - 0.075), 1.02, dir, 0xb9bfc4);
      const slab = leafMesh(P, g);
      glassPane(g, iw - 0.02, gh - 0.02, ic, (gy0 + gy1) / 2);
      if (lockOn === i && hold) {
        // the lock's status LED in its escutcheon, corridor face
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12).rotateX(HALF),
          new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 }));
        lamp.position.set(xs(w - 0.075), 1.19, LEAF_T / 2 + 0.004);
        g.add(lamp);
        hold.lamp = lamp;
      }
      return slab;
    };
  }
  /* The staff door's leaf is THE prison's detention leaf now: it was
     drawn here first and every barred door in the compound has been
     replaced by it (world/corridorkit.js CBZ.corridorKit.detentionLeaf). */
  /* cfg { id, label, x0, x1, z, t (wall), h, pair, build, keys, pick, free,
           frame, lamp (a mesh, if the lock's LED lives off the leaf) } */
  function makeDoor(cfg) {
    const d = {
      id: cfg.id, x: (cfg.x0 + cfg.x1) / 2, z: cfg.z, open: false, t: 0,
      x0: cfg.x0, x1: cfg.x1, keys: cfg.keys, label: cfg.label, pick: cfg.pick || 0, picked: 0,
      free: !!cfg.free, lamp: null,
    };
    const T = cfg.t || PT;
    const hold = {};
    d.set = CK.doorSet({ axis: "x", a0: cfg.x0, a1: cfg.x1, fixed: cfg.z, t: T, h: cfg.h || DH, y0: FL,
      open: -1, hinge: cfg.pair ? 0 : -1, build: cfg.build(hold), frame: cfg.frame != null ? cfg.frame : 0x5b636d });
    d.pivots = d.set.leaves.map(function (L) { return L.pivot; });
    d.slabs = d.set.leaves.map(function (L) { return L.slab; }).filter(Boolean);
    d.lamp = cfg.lamp || hold.lamp || null;
    // the leaf's own slab, floor to frame head (world/corridorkit.js leafCollider)
    d.collider = CK.leafCollider(d.set, cfg.x0, cfg.x1, FL, cfg.h || DH, d.slabs[0] || d.pivots[0]);   // (the set's h is the head's height, from 0)
    CBZ.colliders.push(d.collider);
    if (CBZ.losBlockers) for (const s of d.slabs) CBZ.losBlockers.push(s);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) return v;
      d.open = v;
      const i = CBZ.colliders.indexOf(d.collider);
      if (v && i >= 0) CBZ.colliders.splice(i, 1);
      else if (!v && i < 0) CBZ.colliders.push(d.collider);
      if (CBZ.losBlockers) for (const s of d.slabs) {
        const li = CBZ.losBlockers.indexOf(s);
        if (v && li >= 0) CBZ.losBlockers.splice(li, 1);
        else if (!v && li < 0) CBZ.losBlockers.push(s);
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (d.lamp) {
        d.lamp.material.color.setHex(v ? 0x39ff88 : 0xff3b3b);
        d.lamp.material.emissive.setHex(v ? 0x14c258 : 0xff0000);
      }
      if (!quiet && CBZ.worldSfx) CBZ.worldSfx(v ? "door_open" : "door_close", d.x, d.z, { ref: 10 });
      if (!v) d.picked = 0;
      return v;
    };
    d.blow = function () {
      d.setOpen(true); d.blown = true;
      for (const p of d.pivots) p.visible = false;
    };
    /* ---- AND A WAY TO SHUT IT: the shared registry in
       systems/interactions.js. The credential is the tick's own test: the
       staff door reads the Keycard (or the uniform); the Warden's office is
       picked, so its spec wants the Lockpick and refuses to be OPENED by a
       tap; a room door (free) asks nothing. */
    /* Every door takes a key AT THE DOOR: the staff door the Keycard, the
       Warden's office his own ring (the Gun-Room Key rides on it; a Lockpick
       is the other way, through pickBeat's hold, which `beat` hands the
       verb). The free side of a locked door (the admin side's push bar, the
       office's thumb turn: cfg.freeSide) is a handle, not a lock. */
    const doorKeys = d.free ? null : (d.keys ? d.keys.slice() : (d.pick ? ["Gun-Room Key"] : null));
    const hasItem = function (k) { const e = CBZ.econ; return !!(e && e.hasItem && e.hasItem(k)); };
    const onFreeSide = function () { return !!(cfg.freeSide && cfg.freeSide()); };
    (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
      id: d.id, label: d.label, autoR: d.free ? 1.6 : 2.3,
      keyed: !!(d.keys || d.pick),   // needs a card or a pick (systems/prisondoorwatch.js)
      keys: function () { return onFreeSide() ? null : doorKeys; },
      at: function () { return { x: d.x, y: 1.4, z: d.z }; },
      pick: function () { return d.pivots; },
      col: function () { return d.collider; },
      isOpen: function () { return !!d.open; },
      permanent: function () { return !!d.blown; },
      beat: function () { return !!(d.pick && !d.open && !onFreeSide() && hasItem("Lockpick")); },
      canUse: function () {
        if (d.free || onFreeSide()) return true;
        const g = CBZ.game;
        if (g && (CBZ.prisonStaffKey ? CBZ.prisonStaffKey() : g.role === "cop")) return true;
        if (doorKeys) for (let i = 0; i < doorKeys.length; i++) {
          if (doorKeys[i] === "Keycard" ? !!(g && g.hasKey) : hasItem(doorKeys[i])) return true;
        }
        return !!(d.pick && d.open && hasItem("Lockpick"));
      },
      set: function (v) { d.setOpen(v); return d.open === !!v; },
    });
    doors.push(d);
    return d;
  }
  const doors = [];
  // the staff door's card reader: on the WING face beside the frame, a
  // stainless back plate, the reader body, its read pad, and the LED
  const readerLed = CK.cardReader(SG.x0 - 0.3, 1.2, SG.z + (SG.t || 1) / 2, 0, 1).led;
  const staffDoor = makeDoor({
    id: "prison-admin-staff", x0: SG.x0, x1: SG.x1, z: SG.z, t: SG.t || 1, h: SG.h || 2.6, keys: ["Keycard"],
    label: "The staff door", pair: true, build: function () { return CK.detentionLeaf({ color: 0x4f5d6b }); }, lamp: readerLed,
    // the admin side has a push bar (the tick below): a handle, not a lock
    freeSide: function () { const P = CBZ.player && CBZ.player.pos; return !!(P && P.z < SG.z - 0.35); },
  });
  const officeDoor = makeDoor({
    id: "prison-warden-office", x0: D_OFF.x0, x1: D_OFF.x1, z: CORR_Z, keys: null,
    label: "The Warden's office", pick: 3.4, pair: true, frame: 0x3e2d1e,
    // from inside the office it is a thumb turn (the tick below)
    freeSide: function () { const P = CBZ.player && CBZ.player.pos; return !!(P && P.z < CORR_Z - 0.3 && P.x > PX_B + 0.2); },
    build: function (hold) { return woodLeaf(hold, 1); },
  });
  // the three room doors: unlocked, they open as you (or staff) walk up
  const roomDoors = [
    makeDoor({ id: "prison-admin-records", x0: D_REC.x0, x1: D_REC.x1, z: CORR_Z, free: true,
      label: "The records room", build: function () { return woodLeaf(null, -1); } }),
    makeDoor({ id: "prison-admin-staffroom", x0: D_STAFF.x0, x1: D_STAFF.x1, z: CORR_Z, free: true,
      label: "The staff room", build: function () { return woodLeaf(null, -1); } }),
    makeDoor({ id: "prison-warden-quarters", x0: D_QRT.x0, x1: D_QRT.x1, z: QZ, free: true, frame: 0x3e2d1e,
      label: "The Warden's quarters", build: function () { return woodLeaf(null, -1); } }),
  ];

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
      defeat: function () { staffDoor.blow(); },
    });
    CBZ.registerBreachTarget({
      id: "prison-warden-office", lb: 5, reach: 2.4,
      at: function () { return { x: officeDoor.x, y: 1.4, z: officeDoor.z }; },
      done: function () { return officeDoor.open; },
      defeat: function () { officeDoor.blow(); },
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
     game's central lock) or would grind against it forever. So the evening
     count puts him AT the checkpoint (the wing throat) watching the block
     file in through it, which is where a warden stands at count anyway. */
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
    // where entities/guards.js starts him; a new run walks him home from here
    check:    { at: 8, post: [[-5, -11], [5, -11], [5, -12.5], [-5, -12.5]], speed: 2.4 },
    // ROUNDS: the length of the tier and back, slow, where the whole wing
    // sees him. prisonwarden.js walks one or two officers at his shoulders.
    rounds:   { at: 6, post: [[0, -39], [0, -26], [0, -14], [0, -26]], speed: 1.5 },
    // THE THROAT: the evening count. He stands at the wing's mouth and the
    // block files in past him. One point: he does not pace, he watches.
    throat:   { at: 8, post: [[-3.6, -11.8]], speed: 2.0 },   // to one side: the file walks past, not round him
  };
  // the walk between two posts is the slice of the spine between them
  function route(from, to) {
    const a = POST[from], b = POST[to];
    if (!a || !b || a.at === b.at) return [];
    return a.at < b.at ? SPINE.slice(a.at + 1, b.at + 1)
                       : SPINE.slice(b.at, a.at).reverse();
  }
  /* WHICH POST HE IS ON is systems/prisonwarden.js's DUTY table (the one
     copy of his day) plus its override (his office while he has you called
     in, the tier during a lockdown he ordered). An id that table does not
     know lands him at his desk. */
  let unknownBlocks = 0;
  function dutyFor(id) {
    const W = CBZ.warden;
    const o = W && W.override ? W.override() : null;
    if (o && POST[o]) return o;
    const want = W && W.duty ? W.duty(id) : (id === "secure" || id === "night" ? "quarters" : "office");
    if (!POST[want]) { unknownBlocks++; return "office"; }
    return want;
  }

  const V3 = function (p) { return new THREE.Vector3(p[0], 0, p[1]); };
  const warden = { g: null, at: null, transit: 0, seat: null, seatTries: 0,
    tresT: 0, tresStage: 0 };   // the trespass ladder — see wardenTerritory()

  /* ---- HIS CHAIR ---------------------------------------------------------
     Asked for, never typed. The office is furnished by CBZ.roomFurnish's
     "bossoffice" program, which places CBZ.furnish.bossDesk against the far
     wall and registers its THREE seats — the throne behind the desk and two
     lower supplicant chairs across it. Typing a coordinate here would be a
     copy of a layout that is planned at build time against real clearances
     and can legitimately move; asking city/propuse.js for the seats inside
     the office rect cannot go stale. `boss`/`throne` wins so he takes his own
     chair and not the one a visitor sits in; if the kit named it something
     else we fall back to the seat FURTHEST from the door, which is the same
     chair by the bossoffice program's own construction (the desk is at the
     far end and the throne is behind it).                                   */
  function findChair() {
    if (!CBZ.propSeatsIn) return null;
    let list = [];
    try { list = CBZ.propSeatsIn(PX_B, IX1, QZ, CORR_Z, 0, []) || []; } catch (e) { list = []; }
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const k = String(list[i].kind || "").toLowerCase();
      if (k.indexOf("boss") >= 0 || k.indexOf("throne") >= 0) return list[i];
    }
    let best = null, bd = -1;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i].z - CORR_Z);        // the door is on the corridor plane
      if (d > bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  // A SEATED MAN STANDS UP WHEN SOMETHING HAPPENS. entities/guards.js's own
  // branches (approach / hunt / alert / investigate) all move the body, and a
  // rig held in `sitting` while its owner sprints at you is the exact defect
  // the propuse arc engine exists to prevent — so the seat is released the
  // instant he has anything to do, and retaken when he settles again.
  function busy(g) {
    return !!(g.hunt > 0 || g.alert > 0 || g.approach || (g.investigate && g.investigate.t > 0) ||
      g.dead || (g.ko | 0) > 0 || g.asleep);
  }
  function sitAtDesk(g) {
    if (CBZ.CONFIG.PRISON_WARDEN_SEATED === false || !CBZ.propSit) return false;
    if (g._propSeat) return true;
    if (!warden.seat) {
      if (warden.seatTries > 30) return false;       // the kit never furnished it; stop asking
      warden.seatTries++;
      warden.seat = findChair();
      if (!warden.seat) return false;
    }
    const s = warden.seat;
    // park the patrol mover ON the chair: one waypoint, at zero distance, so
    // guards.js's straight-line walker has nothing left to walk to and cannot
    // drag a seated body off its own cushion.
    g.waypoints = [new THREE.Vector3(s.x, 0, s.z)];
    g.wi = 0;
    g.group.position.set(s.x, s.y || 0, s.z);
    let ok = false;
    try { ok = CBZ.propSit(g, s, { instant: true }); } catch (e) { ok = false; }
    if (!ok) return false;
    g.group.rotation.y = s.face;
    g.flashlightPatrol = false;
    return true;
  }
  function standUp(g) {
    if (!g || !g._propSeat) return;
    try { CBZ.propStand(g, { instant: true }); } catch (e) {}
    // propStand writes state="walk" for a ped brain; the warden is a GUARD and
    // guards.js owns his movement, so all that is owed here is the pose.
    if (g.char) g.char.sitting = false;
  }
  function findWarden() {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) if (list[i].kind === "warden") return list[i];
    return null;
  }
  function sendTo(g, want) {
    const P = POST[want];
    if (!P) return;
    standUp(g);                                    // leaving a post means leaving the chair
    const chain = warden.at ? route(warden.at, want) : [];
    warden.at = want;
    g.waypoints = chain.concat(P.post).map(V3);
    g.wi = 0;
    warden.transit = chain.length;
    g.speed = P.speed;
    // a man walking his own corridors in the dark carries a torch
    const S = CBZ.prisonSchedule;
    g.flashlightPatrol = want === "quarters" || ((want === "rounds" || want === "throat") && !!(S && S.torches && S.torches()));
  }
  function offShift() { return warden.at === "quarters"; }

  /* ---- HIS ROOMS ANSWER BACK (owner, 2026-08-19: "I legit followed the
     warden into his quarters... he legit acted like an inmate, didn't
     [react to me] following him in"). systems/detection.js now counts the
     whole wing as restricted ground — the mechanical half. This is the
     PERSONAL half: an inmate standing in his office or his quarters gets
     the warden himself, on a ladder — an order, a warning with heat behind
     it, and finally his officers — through the three channels everything
     else already uses (CBZ.prisonSay, CBZ.addHeat, guards.js's investigate
     beat). Asleep, tied, held at gunpoint or dead he says nothing, so the
     2 a.m. sneak past his bunk is still a sneak; and while the campaign has
     authored business between you (the spy offer), you were summoned, so
     the ladder holds its tongue. He only reacts to what he can KNOW: same
     room, or close enough to hear you through the quarters doorway. */
  function sayWarden(w, group) {
    const line = CBZ.warden && CBZ.warden.line ? CBZ.warden.line(group) : "";
    if (line && CBZ.prisonSay) CBZ.prisonSay(w, line, { force: true });
  }
  function wardenTerritory(w, dt, P) {
    if (CBZ.game.role === "cop") return;
    const inRooms = P.x > PX_B + 0.2 && P.x < IX1 && P.z > IZ0 && P.z < CORR_Z - 0.2;
    const silent = w.asleep || w.tied || w.intimidMode === "scared";
    const invited = !!(CBZ.cityCampaignPrisonVerbs && CBZ.cityCampaignPrisonVerbs(w)) ||
      !!(CBZ.warden && CBZ.warden.pass && CBZ.warden.pass());      // he sent for you
    let knows = false;
    if (inRooms && !silent && !invited) {
      const wp = w.group.position;
      const pInOffice = P.z > QZ;
      const wInOffice = wp.z > QZ - 0.2 && wp.z < CORR_Z + 1.6 && wp.x > PX_B - 1.5;
      const wInQuarters = wp.z <= QZ - 0.2 && wp.z > IZ0 - 0.5 && wp.x > PX_B - 1.5;
      knows = (pInOffice && wInOffice) || (!pInOffice && wInQuarters) ||
        Math.hypot(wp.x - P.x, wp.z - P.z) < 6;
    }
    if (!knows) {
      warden.tresT = Math.max(0, warden.tresT - dt * 0.6);
      if (warden.tresT === 0) warden.tresStage = 0;
      return;
    }
    warden.tresT += dt;
    w.alert = Math.max(w.alert || 0, 0.8);          // he stops and faces you
    if (warden.tresStage < 1 && warden.tresT > 0.5) {
      warden.tresStage = 1;
      sayWarden(w, "trespass1");
    } else if (warden.tresStage < 2 && warden.tresT > 4.5) {
      warden.tresStage = 2;
      sayWarden(w, "trespass2");
      if (CBZ.addHeat) CBZ.addHeat(8);
    } else if (warden.tresStage < 3 && warden.tresT > 9) {
      warden.tresStage = 3;
      sayWarden(w, "trespass3");
      if (CBZ.addHeat) CBZ.addHeat(18);
      // he calls it in; he does not chase you round his own desk
      if (CBZ.prisonOffense) { try { CBZ.prisonOffense("restricted", { by: w, seenBy: w, severity: 2, at: { x: P.x, z: P.z } }); } catch (e) {} }
      let sent = 0;
      for (const gd of CBZ.guards || []) {
        if (gd === w || gd.dead || gd.ko > 0 || gd.asleep || gd.hunt > 0) continue;
        gd.investigate = { x: P.x, z: P.z, t: 15 };
        if (++sent >= 2) break;
      }
    }
  }

  /* THE SUIT is no longer applied here: systems/prisonoutfits.js dresses him
     from city/outfits.js CAT.warden (a pinned charcoal three-piece, no cap,
     no badge), the one record every other system reads him by. */

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
  /* WHAT IS ACTUALLY IN IT. Objects, laid where they lie — never a payout.
     Laid as DROPS the moment the door opens (they were prisonPlaceItem world
     items, which every new run re-lays whether the safe is open or not — and
     the walk-over radius reaches through a shut safe door). A new run sweeps
     the drops and re-stocks on the next opening. */
  function layDrop(item, x, y, z) {
    if (!CBZ.prisonDropOne) return null;
    try { return CBZ.prisonDropOne(item, x, y - 1.06, z, { dir: 0, speed: 0, up: 0 }); } catch (e) { return null; }
  }
  function stockSafe() {
    if (SAFE.stocked || !CBZ.prisonDropOne) return;
    SAFE.stocked = true;
    layDrop("Contraband Map", SAFE.x - 0.05, 0.80, SAFE.z + 0.26);
    layDrop("Luxury Watch", SAFE.x + 0.12, 0.80, SAFE.z - 0.24);
  }
  /* ON THE HOOK, OR ON HIS HIP. Never both, and never NEITHER by accident.
     The key is ONE object that moves: it is in his pocket (econ loadout)
     while he is on shift; at bedtime he takes it off and hangs it in the
     safe (it leaves the loadout); at shift change he takes it back. If it
     was lifted off him, it is not on the hook that night. If you took it
     from the safe, he has none in the morning. */
  let keyLaid = false, keyOnHook = false;
  function wardenLoad() {
    const w = warden.g;
    const E = CBZ.econ;
    if (!w || w.dead || !E || !E.rollLoadout) return null;
    try { return E.rollLoadout(w); } catch (e) { return null; }
  }
  function driveHook() {
    const L = wardenLoad();
    if (L && !keyLaid) {
      const i = L.items.indexOf("Gun-Room Key");
      const w = warden.g;
      const free = !(w.ko > 0) && !w.tied && !(w.char && w.char.cuffed);
      if (offShift() && i >= 0 && !keyOnHook && free) { L.items.splice(i, 1); keyOnHook = true; }
      else if (!offShift() && keyOnHook && free) { L.items.push("Gun-Room Key"); keyOnHook = false; }
    }
    SAFE.fob.visible = keyOnHook && !keyLaid;
    if (!keyOnHook || !SAFE.open || keyLaid || !CBZ.prisonDropOne) return;
    keyLaid = true; keyOnHook = false;
    SAFE.fob.visible = false;
    layDrop("Gun-Room Key", SAFE.x + 0.1, 0.80, SAFE.z - 0.2);
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
        d.set.set(d.t);
      }
    }
    if (SAFE.open && SAFE.pivot.rotation.y > -1.7) SAFE.pivot.rotation.y -= dt * 2.6;
    if (CASE.open && CASE.t < 1) { CASE.t = Math.min(1, CASE.t + dt * 2.2); CASE.pivot.rotation.y = -CASE.t * 1.75; }
    driveHook();

    if (g.state !== "playing") return;
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;

    // ---- STAFF DOOR: a card reader. Staff walk through it; you need the card.
    if (!staffDoor.open) {
      const s = staffNear(staffDoor);
      if (s) staffDoor.setOpen(true);
      else if (!(CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-admin-staff"))) {
        // LAW 3 (systems/interactions.js): a door shut by hand stays shut
        // while you stand on its reader. Staff above are exempt — the warden
        // opening his own door is the routine this wing is legible by.
        const dx = P.x - staffDoor.x, dz = P.z - staffDoor.z;
        if (dx * dx + dz * dz < 5.2) {
          /* A LOCK KEEPS PEOPLE OUT, NOT IN (owner, 2026-08-19: "followed
             the warden into his quarters... but then door is one way, you
             can't get out"). The reader is on the WING side; the admin side
             has a push bar, because that is how a card door in a staffed
             building is actually built — and because a tailgater sealed in
             the wing with a dead warden was a soft-locked run. Getting IN
             still costs the card, the pick, the tailgate or the charge;
             getting OUT is a door handle. The hand-shut latch (LAW 3) is
             honoured from both sides. */
          if (P.z < SG.z - 0.35) staffDoor.setOpen(true);
          else {
            const have = !!(g.hasKey || (CBZ.prisonStaffKey ? CBZ.prisonStaffKey() : g.role === "cop"));
            const L = CBZ.cityLock
              ? CBZ.cityLock({ id: "prison-admin-staff", verb: "press", label: "The staff door",
                  have: have, keys: ["Keycard"], orgs: ["police"], power: false })
              : { open: have, line: "" };
            if (L.open) staffDoor.setOpen(true);
          }
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

    // ---- OFFICE DOOR: his own lock. He opens it; you pick it — from the
    //      CORRIDOR. From inside the office it is a mortice with a thumb
    //      turn, like every real office door: the pick ritual guards entry,
    //      never exit (same one-way-lock law as the staff door above).
    if (!officeDoor.open) {
      const s = staffNear(officeDoor);
      if (s && (s.kind === "warden" || s._wardenCall)) officeDoor.setOpen(true);
      else {
        const dx = P.x - officeDoor.x, dz = P.z - officeDoor.z;
        const insideOffice = P.z < CORR_Z - 0.3 && P.x > PX_B + 0.2;
        if (insideOffice) {
          if (dx * dx + dz * dz < 5.2 &&
              !(CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-warden-office"))) officeDoor.setOpen(true);
          if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("warden-office");
        }
        else if (dx * dx + dz * dz < 5.2) pickBeat(officeDoor, dt, "warden-office", officeDoor.pick);
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
    // ---- THE GUN CASE: a cabinet lock, three seconds with the pick
    if (!CASE.open) {
      const dx = P.x - CASE.x, dz = P.z - CASE.z;
      if (dx * dx + dz * dz < 2.6) pickBeat(CASE, dt, "warden-case", 3.0, openCase);
      else if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("warden-case");
    }

    // ---- THE ROOM DOORS: unlocked; they open for whoever walks up to them
    //      (you, an officer, the warden going to bed) and swing shut behind
    for (let i = 0; i < roomDoors.length; i++) {
      const d = roomDoors[i];
      if (d.blown) continue;
      const dx = P.x - d.x, dz = P.z - d.z, you = dx * dx + dz * dz;
      let staff = false;
      const list = CBZ.guards || [];
      for (let k = 0; k < list.length && !staff; k++) {
        const q = list[k];
        if (!q || q.dead || q.ko > 0 || !q.group) continue;
        const ex = q.group.position.x - d.x, ez = q.group.position.z - d.z;
        if (ex * ex + ez * ez < 3.2) staff = true;
      }
      // an unlocked door opens for an inmate walking through it too
      const men = CBZ.npcs || [];
      for (let k = 0; k < men.length && !staff; k++) {
        const q = men[k];
        if (!q || q.dead || q._crowd || !q.group) continue;
        const ex = q.group.position.x - d.x, ez = q.group.position.z - d.z;
        if (ex * ex + ez * ez < 2.4) staff = true;
      }
      const latched = CBZ.prisonDoorLatched && CBZ.prisonDoorLatched(d.id);
      if (!d.open) {
        if (staff || (you < 2.2 && !latched)) { d.setOpen(true); d.shutT = 2.5; }
      } else {
        d.shutT = (staff || you < 4.8) ? 2.5 : (d.shutT || 0) - dt;
        if (d.shutT <= 0) d.setOpen(false);
      }
    }

    // ---- THE DAY ----
    if (!warden.g) {
      warden.g = findWarden();
      if (warden.g) { warden.at = "check"; }   // entities/guards.js starts him there
    }
    const w = warden.g;
    if (!w) return;
    if (w.dead || w.ko > 0) return;
    wardenTerritory(w, dt, P);
    // transit finished → settle into the post cycle
    if (warden.transit && w.wi >= warden.transit) {
      w.waypoints = POST[warden.at].post.map(V3);
      w.wi = 0; warden.transit = 0;
    }
    /* ---- AND AT HIS DESK, HE SITS. The office post is the only one that is
         a CHAIR rather than a beat — his quarters cycle is him pacing before
         bed, the wing and the checkpoint are him supervising, and those are
         all things a man does on his feet. This runs every frame rather than
         once on arrival because guards.js can take the body away at any
         instant (a shout, a sighting, a hunt) and the honest answer is that
         he gets up, deals with it, and sits back down when it is over. ---- */
    if (!warden.transit && warden.at === "office") {
      if (busy(w)) standUp(w);
      else if (!w._propSeat) sitAtDesk(w);
    } else if (w._propSeat) standUp(w);
    // asked every frame: an order (a summons, a lockdown) moves him mid-block
    const S = CBZ.prisonSchedule;
    const block = S && S.id ? S.id() : null;
    lastBlock = block;
    const want = dutyFor(block);
    if (want !== warden.at) sendTo(w, want);
  });
  // prisonwarden.js reads his body through this, never through the roster
  CBZ.wardenRoutine = {
    guard: function () { return warden.g; },
    post: function () { return warden.at; },
    transit: function () { return warden.transit > 0; },
  };

  /* ---- ONE hold-to-defeat beat, shared by the office lock and the safe.
       Same shape as world/gunroom.js's hacksaw: a polled [E], a touch pill
       for the same verb, and a physical tell (the shake) rather than a
       percentage. The Lockpick is the tool; without it there is no prompt,
       because a lock you have nothing to pick with is just a locked door. ---- */
  function pickBeat(target, dt, promptId, secs, onDone) {
    const econ = CBZ.econ;
    const has = !!(econ && econ.hasItem && econ.hasItem("Lockpick"));
    if (!has) { if (CBZ.prisonPromptClear) CBZ.prisonPromptClear(promptId); target.picked = 0; tell(target, 0, 0); return; }
    // "Pick", held, pinned over the lock itself. The lock's own status lamp
    // still goes amber at a lock your pick will open and beats faster the
    // further through the shackle you are — that is the progress readout.
    // (prisonPrompt refuses a lock you cannot reach: other floor, a wall between)
    const reach = !CBZ.prisonPrompt || CBZ.prisonPrompt(promptId, "e", "Pick",
      { at: { x: target.x, y: target === SAFE ? 1.15 : 1.5, z: target.z }, hold: true, skip: target.collider ? [target.collider] : null });
    const working = reach && !!(CBZ.keys && CBZ.keys.e);
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
      d.setOpen(false, true);
      for (const p of d.pivots) p.visible = true;
      d.t = 0; d.set.set(0);
    }
    SAFE.open = false; SAFE.picked = 0; SAFE.pivot.rotation.y = 0; SAFE.stocked = false;
    CASE.open = false; CASE.picked = 0; CASE.t = 0; CASE.pivot.rotation.y = 0; CASE.laid = false; CASE.gun = null; CASE.taken = false;
    if (CASE.display) CASE.display.visible = true;
    keyLaid = false; keyOnHook = false; lastBlock = null;
    warden.tresT = 0; warden.tresStage = 0;
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
      keyBothPlaces: (SAFE.fob.visible && (wardenLoad() || { items: [] }).items.indexOf("Gun-Room Key") >= 0) ? 1 : 0,   // MUST be 0
      unknownBlocks: unknownBlocks,                   // duty posts this file has no POST for
      seated: !!(warden.g && warden.g._propSeat),
      chair: warden.seat ? { x: Math.round(warden.seat.x * 10) / 10, z: Math.round(warden.seat.z * 10) / 10, kind: warden.seat.kind } : null,
      warden: warden.g ? {
        post: warden.at, transit: warden.transit, suited: !!(warden.g && warden.g.char && warden.g.char._prisonOutfitKey === "warden"),
        x: Math.round(warden.g.group.position.x * 10) / 10,
        z: Math.round(warden.g.group.position.z * 10) / 10,
      } : null,
      block: S && S.id ? S.id() : null,
      offShift: offShift(),
      safeOpen: SAFE.open, keyOnHook: !!SAFE.fob.visible,
      caseOpen: CASE.open, caseGunLaid: CASE.laid,
      staffOpen: staffDoor.open, officeOpen: officeDoor.open,
      tres: { t: Math.round(warden.tresT * 10) / 10, stage: warden.tresStage },
      plans: {
        records: plans.records ? plans.records.pieces.length : 0,
        staff: plans.staff ? plans.staff.pieces.length : 0,
        office: plans.office ? plans.office.pieces.length : 0,
        quarters: plans.quarters ? plans.quarters.pieces.length : 0,
      },
    };
  };
})();
