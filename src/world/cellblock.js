/* ============================================================
   world/cellblock.js — THE CELL WING. Not set dressing: a real two-row
   cell house with 13 individual cells, sliding barred doors on real
   colliders, and inmates living inside them.

   OWNER (verbatim): "player cell should be an actual cell and there
   should be many others in cell, county jail from gang city is DUMB AF
   not a part of prison escape game rn but it actually has real player
   cell and real other players in cells which is the only part done
   right."

   So this file adopts games/jail.js's grammar rather than inventing a
   second one: a cell is a record ({i, lx/lz, doorX, half, doorCol,
   bars, locked}), the DOOR is a real y0/y1 collider toggled beside its
   visual bars (jail.js setDoor), the PLAYER's cell stands OPEN until
   somebody locks it, and every other cell holds a body.

   ------------------------------------------------------------------
   WHY THE GEOMETRY IS WHAT IT IS (constraints, not taste). Six fixed
   points inside this footprint were measured before a wall was moved,
   and every one of them is a thing another file already owns:

     · CBZ.SPAWN = (-11, 0, -39)  (entities/player.js:8) — systems/state.js
       and systems/capture.js both teleport to it. It MUST land inside the
       player's own cell, on standing floor, clear of every collider. The
       north row is therefore 5.5 m deep (door plane z = -38.0) and the
       player's cell is x[-12.90,-9.10] — so the spawn sits EXACTLY on that
       cell's centre-line and 1.0 m north of its own door.
     · guards.js:79 patrols [[0,-13],[0,-39]] — (0,-39) is 1 m INSIDE the
       north row's depth, so the north row cannot be continuous. The middle
       of the north wall is the wing's OFFICER POST, open to the floor, and
       the patrol walks into it and turns around.
     · escape_routes.js:96 floor-hatches the "Cell Utility Crawl" at
       (-12.2,-38.2). That is inside the player's cell — deliberately kept
       there: a physical route out of your own floor is worth more than any
       marker (CLAUDE.md LAW 1).
     · escape_routes.js:119 hatches the "Ceiling Service Hatch" at
       (11.6,-36.4) — the side rows start at z = -34.84, so that hatch sits
       in the CROSS-AISLE, never behind a door.
     · ventilation.js:41 puts the "Cell Block Aisle" grate on the west wall
       at z = -31 (crawl point x = -14.2). The west row breaks there for a
       UTILITY ALCOVE, so the vent route can never be locked away.
     · the south door gap x[-3,3] at z = -8 (world/door.js) and the central
       spine are left completely clear: nothing this file builds sits at
       |x| < 11.7 south of z = -38, except the two bolted day tables at
       |x| = 6.6 and the officer desk at z = -42.6.

   DRAW-CALL BUDGET. Partitions carry colliders + LOS refs, so core/batch.js
   spares them (~20 draw calls, unavoidable — they are walls). Everything
   else is arranged so it MERGES: fixed grille bars, bunks, toilets, roofs
   and fittings are plain meshes with empty userData and go into the static
   batch. Only the 13 SLIDING DOOR LEAVES stay live (userData.dynamic keeps
   both core/batch.js and core/staticfreeze.js off them), and each leaf is
   ONE merged BufferGeometry, not eleven bars.

   DETERMINISM. This is a world-build path: every varied choice (which
   cells stand empty, which inmate does what, blanket colours, personal
   effects) comes off CBZ.hash01 of the cell's own coordinates. No
   Math.random, no shared rng stream.

   REVERT: CBZ.CONFIG.PRISON_CELLS_V2 = false (or ?cfg_PRISON_CELLS_V2=0)
   restores the original 59-line dressing byte for byte, and CBZ.cellblock
   degrades to a null-safe stub whose playerSpawn() falls back to CBZ.SPAWN.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, COL, DIM } = CBZ;
  const { WALL, TRIM } = COL;
  const WH = DIM.WH;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  const root = CBZ.prisonRoot || CBZ.scene;

  // ONE-LINE REVERT. config.js's generic ?cfg_ sweep runs before this file,
  // so a URL override already sits in CONFIG and this guard leaves it alone.
  if (CFG.PRISON_CELLS_V2 == null) CFG.PRISON_CELLS_V2 = true;

  /* ==========================================================
     0. THE SHELL — identical on BOTH paths. The footprint never moves,
        so world/yard.js, world/ground.js, escape_routes.js and the actor
        clamp in CBZ.WORLD.cellBlock stay true whichever branch runs.
     ========================================================== */
  /* THE HEAD OF THE WING IS A DOOR, NOT A DEAD END (CBZ.cellblockStaffGap).
     The north wall was one unbroken 32 m slab, so the only way out of this
     building was the south throat every guard in the game watches. A real
     wing hangs off the ADMINISTRATION block — staff walk in at the top, past
     the officer's post, and never cross the yard to do it — and world/
     adminwing.js now builds that block on the far side of this wall.

     The opening is placed WEST OF THE DUTY DESK on purpose: the officer post
     (§6) puts a 3.4 m desk on the centreline at x[-1.7,1.7] and its key board
     at x[1.05,1.95], so x[-4.2,-2.2] is the only 2 m of this wall that is
     free floor on both faces — and it is 5 m from the officer's own patrol
     waypoint (0,-39), which is the point: the first door you can try is the
     one with a screw standing next to it.

     This file draws the HOLE and publishes it. The leaf, the collider, the
     lock and the reader belong to whoever owns the other side — and if that
     side is not being built, THERE IS NO HOLE: a 2 m gap in the compound's
     northern face with no door in it is not a shortcut, it is the end of the
     escape game. The flag is declared with the same idempotent `== null`
     idiom world/southblock.js documents, so whichever of the two files
     parses first sets it and the other no-ops. */
  if (CFG.PRISON_ADMIN_WING == null) CFG.PRISON_ADMIN_WING = true;
  const SG = CFG.PRISON_ADMIN_WING !== false ? { x0: -4.2, x1: -2.2, z: -44, h: 2.6, t: 1 } : null;
  CBZ.cellblockStaffGap = SG;
  if (!SG) {
    addBox(0, WH / 2, -44, 32, WH, 1, WALL, { solid: true, blockLOS: true });   // north, unbroken
  } else {
    addBox((-16 + SG.x0) / 2, WH / 2, -44, SG.x0 + 16, WH, 1, WALL, { solid: true, blockLOS: true });  // west of the gap
    addBox((SG.x1 + 16) / 2, WH / 2, -44, 16 - SG.x1, WH, 1, WALL, { solid: true, blockLOS: true });   // east of the gap
    // the door HEAD: wall above the opening. Never solid — a full-height AABB
    // here would seal the doorway for every body in the game (systems/
    // actorcollide.js clamps NPCs with no vertical span, so a y-gated collider
    // still reads full height to them). It blocks LOS, which is all a lintel owes.
    addBox((SG.x0 + SG.x1) / 2, (SG.h + WH) / 2, -44, SG.x1 - SG.x0, WH - SG.h, 1, WALL, { cast: false, blockLOS: true });
  }
  addBox(-16, WH / 2, -26, 1, WH, 36, WALL, { solid: true, blockLOS: true });  // west
  addBox(16, WH / 2, -26, 1, WH, 36, WALL, { solid: true, blockLOS: true });   // east
  addBox(-9.5, WH / 2, -8, 13, WH, 1, WALL, { solid: true, blockLOS: true });  // south-left  (door gap x[-3,3])
  addBox(9.5, WH / 2, -8, 13, WH, 1, WALL, { solid: true, blockLOS: true });   // south-right

  // red trim line along the north wall top
  addBox(0, WH - 0.6, -43.55, 32, 0.5, 0.4, TRIM, { cast: false });

  /* ==========================================================
     LEGACY PATH — the original set dressing, kept callable so the flag
     is a true one-line revert (and so the before-state stays visible).
     ========================================================== */
  function buildLegacy() {
    // barred windows punched into the north wall — OWNER RULE (bda61ab): no
    // gray panes; glass behind the bars is the same clear tint as the city.
    for (let wx = -11; wx <= 11; wx += 11) {
      const pane = addBox(wx, 6, -43.4, 2.6, 2.6, 0.2, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 });
      pane.material.transparent = true; pane.material.opacity = 0.6;
      for (let i = 0; i < 4; i++)
        addBox(wx - 1 + i * 0.66, 6, -43.2, 0.1, 2.4, 0.1, 0x2a2f38, { cast: false }); // bars
    }
    function bunk(x, z) {
      addBox(x, 0.5, z, 2.6, 0.3, 1.3, 0x4f5663, {});
      addBox(x, 0.7, z, 2.4, 0.18, 1.1, 0xd9d2c4, {});
      addBox(x, 1.7, z, 2.6, 0.3, 1.3, 0x4f5663, {});
      addBox(x, 1.9, z, 2.4, 0.18, 1.1, 0xd9d2c4, {});
      addBox(x, 1.0, z, 0.2, 0.3, 1.1, 0x9aa0a8, {});
      addBox(x - 1.2, 1.0, z, 0.16, 2.0, 1.3, 0x3c424d, {});
      addBox(x + 1.2, 1.0, z, 0.16, 2.0, 1.3, 0x3c424d, {});
    }
    bunk(-12.5, -41);
    bunk(12.5, -41);
    addBox(-14.4, 0.5, -34, 1.0, 1.0, 0.9, 0xc7ccd2, {});
    addBox(-14.4, 1.05, -34, 0.9, 0.1, 0.8, 0xe6e9ed, {});
    for (let i = 0; i < 6; i++)
      addBox(-7 + i * 0.6, 2.4, -37.5, 0.12, 4.6, 0.12, 0x2a2f38, { cast: false });
    addBox(-4.0, 4.85, -37.5, 4.0, 0.25, 0.25, 0x2a2f38, { cast: false });
    addBox(-4.0, 0.15, -37.5, 4.0, 0.25, 0.25, 0x2a2f38, { cast: false });
    addBox(0, 8.6, -30, 0.5, 0.3, 0.5, 0x3c424d, { cast: false });
    CBZ.ceilingLamp = addBox(0, 8.2, -30, 0.7, 0.2, 0.7, 0xffe9a8, { emissive: 0xffcf66, ei: 0.9, cast: false });

    // null-safe stub so every consumer (capture.js / lockdown.js) can call the
    // same API with the flag off and get honest "there are no cells" answers.
    CBZ.cellblock = {
      v2: false, cells: [], playerCell: null,
      setDoor: function () { return false; },
      assign: function () { return false; },
      cellAt: function () { return null; },
      freeCell: function () { return null; },
      lockAll: function () { return 0; },
      resetDoors: function () { return 0; },
      playerSpawn: function () { return { x: CBZ.SPAWN.x, z: CBZ.SPAWN.z }; },
    };
    CBZ.cellblockAudit = function () {
      return { v2: false, cells: 0, occupied: 0, empty: 0, locked: 0,
        spawnInPlayerCell: false, spawnMargin: 0, spawnBlocked: 0,
        doorGapBlocked: 0, spineBlocked: 0, colliders: 0 };
    };
  }

  if (!CFG.PRISON_CELLS_V2) { buildLegacy(); return; }

  /* ==========================================================
     1. DIMENSIONS. Every length below is derived from the shell's own
        inner faces, so moving a shell wall moves the wing with it.
     ========================================================== */
  const IX0 = -15.5, IX1 = 15.5;        // interior x (inner faces of the side walls)
  const IZN = -43.5;                    // interior z at the north wall's inner face
  const WT = 0.34;                      // partition thickness
  const CH = 3.6;                       // cell interior height (floor -> roof slab)
  const RT = 0.30;                      // roof slab thickness
  const ND = 5.5;                       // NORTH row cell depth  (see the SPAWN constraint above)
  const SD = 3.8;                       // SIDE row cell depth
  const NFACE = IZN + ND;               // -38.0 : the north row's door plane
  const WFACE = IX0 + SD;               // -11.7 : the west row's door plane
  const EFACE = IX1 - SD;               //  11.7 : the east row's door plane
  const DOOR_W = 1.60;                  // the sliding leaf's clear opening
  const POCKET = DOOR_W + 0.30;         // the fixed grille the leaf hides behind
  const COL_T = 0.24;                   // barred-face collider thickness
  const BAR = 0.09, BAR_P = 0.42;       // bar section / pitch (jail.js's pitch)
  const BACK_IN = 0.32;                 // how far a back-wall fitting's CENTRE sits
                                        // off the wall plane, so the unit lands flush

  // palette
  const C_PART = 0x8f98a3;   // cell partition concrete
  const C_PART_D = 0x767f8a; // shaded face / row end walls
  const C_ROOF = 0x6a727d;
  const C_BAR = 0x2a2f38;
  const C_BUNK = 0x4f5663;
  const C_MATT = 0xd9d2c4;
  const C_STEEL = 0xc7ccd2;
  const C_STEEL_D = 0x9aa0a8;
  const C_DARK = 0x3c424d;

  /* ==========================================================
     EVERY PROP IS INTERACTABLE OR LOAD-BEARING (PRISON_REAL_PROPS).

     OWNER: "there's fake props." world/_template.js states the law and this
     wing was breaking it in the one place it matters most: the BUNK IN YOUR OWN
     CELL. It is drawn beautifully — frame, tucked sheet, turned-down fold,
     guard rail, ladder — and it was a shelf. Thirteen of them. The inmates
     could sit on theirs (the leash below sets `char.seatRef` by hand); the
     player could not do anything with his at all.

     The cure is not a bed system. city/propuse.js already owns "a place a body
     can lie down or sit", and its two registrars take a coordinate and a top
     height — which this file has always computed and thrown away. So the
     existing geometry is registered rather than re-drawn: `bunkRig` already
     returns its own mattress top, and `dayTable` already knows where its four
     stools are.

     Degrade: no propuse.js → nothing registers and every mesh is exactly what
     it was. Counted on CBZ._prisonProps so one audit can answer for the whole
     wave (games/jail.js's CBZ.prisonPropAudit merges it).
     ========================================================== */
  if (CFG.PRISON_REAL_PROPS == null) CFG.PRISON_REAL_PROPS = true;
  const PP = (CBZ._prisonProps = CBZ._prisonProps || { props: 0, seats: 0, beds: 0, plain: 0 });
  function propsOn() { return CFG.PRISON_REAL_PROPS !== false; }

  /* ---- LOAD ORDER WAS EATING ALL OF IT (measured 2026-08-11) ------------
     A live escape run read `CBZ._prisonProps = {props:21, seats:0, beds:0,
     plain:21}`. Not one bunk and not one stool had EVER become a propuse
     anchor: `city/propuse.js` is index.html:817 and this file is :469, so
     `CBZ.propRegisterBed` simply does not exist when fitOutCell runs and
     every call took the degrade branch and counted itself `plain`. The whole
     block above described a system that had never once run — which is the
     real reason an inmate in a cell stood in his bunk instead of lying on it.

     world/roombuild.js already solved this for SEATS with a queue flushed on
     `load` (roomSeatAnchor/roomBedAnchor) — but roombuild is :531, also after
     us, so we cannot call it at parse time either. The queue therefore lives
     here and is drained from the wing's OWN first tick, the same deferral
     dealCast() below and crates.js:205 already use. Degrade is unchanged: no
     propuse at flush time and every fitting still counts `plain`. */
  const pendFit = [];
  let fitFlushed = false;
  function flushFittings() {
    if (!pendFit.length) return 0;
    const okB = propsOn() && !!CBZ.propRegisterBed, okS = propsOn() && !!CBZ.propRegisterSeat;
    let n = 0;
    for (let i = 0; i < pendFit.length; i++) {
      const j = pendFit[i];
      let rec = null;
      try {
        if (j.bed) { if (okB) rec = CBZ.propRegisterBed.apply(null, j.a); }
        else if (okS) rec = CBZ.propRegisterSeat.apply(null, j.a);
      } catch (e) { rec = null; }
      if (rec) {
        n++;
        if (j.bed) PP.beds++; else PP.seats++;
        if (j.own) {
          j.own[j.slot] = rec;
          // A housing stack outside this cell row still registers through the
          // same canonical bunk builder. Carry its unit record onto the anchor
          // so schedules can route a body to the building that owns its bed.
          if (j.own._housingUnit) {
            rec._housingUnit = j.own._housingUnit;
            rec._housingStack = j.own;
          }
        }
      }
      else PP.plain++;
    }
    pendFit.length = 0;
    fitFlushed = true;
    return n;
  }
  // a bunk you can lie on. (hx,hz) points at the PILLOW, `top` the mattress.
  // bunkRig draws the pillow at -lon, so a bunk laid out "along z" has its
  // head at -z: this said +1 for its whole life and would have laid every
  // sleeper in head-first at the FOOT of his own bunk the moment anything
  // actually used the record.
  // `anchorY` separates the two racks of one stack. city/propuse.js dedupes a
  // bed on (x, y, z), so the upper rack registered at the lower one's y is
  // silently thrown away — the stack would draw two mattresses and register
  // one. It is the anchor's own floor reference, not the cushion (that is
  // `top`), and it is what makes "which rack" a coordinate rather than a flag.
  function useBed(x, z, along, top, len, own, slot, anchorY) {
    PP.props++;
    const hx = along === "z" ? 0 : -1, hz = along === "z" ? -1 : 0;
    pendFit.push({ bed: 1, a: [x, anchorY || 0, z, hx, hz, len, top, "bunk", null], own: own || null, slot: slot || "bed" });
    if (fitFlushed) flushFittings();
    return null;
  }
  // a stool you can sit on. `face` looks at the table.
  function useSeat(x, z, face, cushion) {
    PP.props++;
    pendFit.push({ a: [x, 0, z, face, "stool", null, { cushion: cushion, floorBelow: 0 }] });
    if (fitFlushed) flushFittings();
    return null;
  }

  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }
  function pick(list, x, z, salt) { return list[(h01(x, z, salt) * list.length) | 0] || list[0]; }

  // Every collider this file pushes, kept so CBZ.cellblockAudit() can judge
  // OUR work and never blame world/door.js or the yard for a blocked lane.
  const mine = [];
  function solid(minX, minZ, maxX, maxZ, y0, y1) {
    const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0 == null ? 0 : y0, y1: y1 == null ? CH : y1 };
    (CBZ.colliders || (CBZ.colliders = [])).push(c);
    mine.push(c);
    return c;
  }
  // addBox with its collider RECORDED. Structural boxes must go through this,
  // not bare addBox, or the audit below is measuring half the wing.
  function sbox(x, y, z, w, hgt, d, color, opts) {
    const m = addBox(x, y, z, w, hgt, d, color, opts);
    if (m && m.userData && m.userData.collider) mine.push(m.userData.collider);
    return m;
  }

  /* ==========================================================
     2. THE ROW TABLES. Each row is a strip of segments read west->east
        (north row) or north->south (side rows). "cell" segments become
        real cells; everything else is an open alcove or a partition.
        Widths are exact and sum to the shell's inner span — check the
        running totals in the comments before you retype one.
     ========================================================== */
  //  -15.50 +2.26 = -13.24 +0.34 = -12.90 +3.80 = -9.10 +0.34 = -8.76
  //  +3.80 = -4.96 +0.34 = -4.62 +9.24 = 4.62 +0.34 = 4.96 +3.80 = 8.76
  //  +0.34 = 9.10 +3.80 = 12.90 +0.34 = 13.24 +2.26 = 15.50  (exact)
  const NORTH_ROW = [
    { kind: "shower", a: -15.50, b: -13.24 },
    { kind: "wall", a: -13.24, b: -12.90 },
    { kind: "cell", a: -12.90, b: -9.10, tag: "A-1", player: true },   // CBZ.SPAWN lives here
    { kind: "wall", a: -9.10, b: -8.76 },
    { kind: "cell", a: -8.76, b: -4.96, tag: "A-2" },
    { kind: "wall", a: -4.96, b: -4.62 },
    { kind: "post", a: -4.62, b: 4.62 },                               // officer post (guards.js waypoint 0,-39)
    { kind: "wall", a: 4.62, b: 4.96 },
    { kind: "cell", a: 4.96, b: 8.76, tag: "A-3" },
    { kind: "wall", a: 8.76, b: 9.10 },
    { kind: "cell", a: 9.10, b: 12.90, tag: "A-4" },
    { kind: "wall", a: 12.90, b: 13.24 },
    { kind: "store", a: 13.24, b: 15.50 },
  ];
  const WEST_ROW = [
    { kind: "wall", a: -34.84, b: -34.50 },
    { kind: "util", a: -34.50, b: -30.90 },                            // ventilation.js grate at z = -31
    { kind: "wall", a: -30.90, b: -30.56 },
    { kind: "cell", a: -30.56, b: -26.76, tag: "B-1" },
    { kind: "wall", a: -26.76, b: -26.42 },
    { kind: "cell", a: -26.42, b: -22.62, tag: "B-2" },
    { kind: "wall", a: -22.62, b: -22.28 },
    { kind: "cell", a: -22.28, b: -18.48, tag: "B-3" },
    { kind: "wall", a: -18.48, b: -18.14 },
    { kind: "cell", a: -18.14, b: -14.34, tag: "B-4" },
    { kind: "wall", a: -14.34, b: -14.00 },
  ];
  const EAST_ROW = [
    { kind: "wall", a: -34.84, b: -34.50 },
    { kind: "cell", a: -34.50, b: -30.70, tag: "C-1" },
    { kind: "wall", a: -30.70, b: -30.36 },
    { kind: "cell", a: -30.36, b: -26.56, tag: "C-2" },
    { kind: "wall", a: -26.56, b: -26.22 },
    { kind: "cell", a: -26.22, b: -22.42, tag: "C-3" },
    { kind: "wall", a: -22.42, b: -22.08 },
    { kind: "cell", a: -22.08, b: -18.28, tag: "C-4" },
    { kind: "wall", a: -18.28, b: -17.94 },
    { kind: "cell", a: -17.94, b: -14.14, tag: "C-5" },
    { kind: "wall", a: -14.14, b: -13.80 },
  ];

  const cells = [];
  let playerCell = null;

  /* ==========================================================
     3. GEOMETRY HELPERS
     ========================================================== */

  // A fresh BoxGeometry translated into place and parked in `list` for one
  // merge. NEVER CBZ.boxGeom here: that cache is SHARED and .translate()
  // mutates it in place (the bug crashdeform/strategic.js already paid for).
  function pushBox(list, x, y, z, w, hgt, d) {
    const g = new THREE.BoxGeometry(w, hgt, d);
    g.translate(x, y, z);
    list.push(g);
  }
  function mergedMesh(list, color, dynamic) {
    if (!list.length) return null;
    const BGU = THREE.BufferGeometryUtils;
    let geo = null;
    if (BGU && BGU.mergeBufferGeometries && list.length > 1) {
      try { geo = BGU.mergeBufferGeometries(list, false); } catch (e) { geo = null; }
    } else if (list.length === 1) geo = list[0];
    let obj;
    if (geo) {
      if (geo !== list[0]) for (let i = 0; i < list.length; i++) list[i].dispose();
      obj = new THREE.Mesh(geo, CBZ.cmat(color));
      obj.castShadow = false; obj.receiveShadow = true;
    } else {
      // degrade: no merge utility -> a group of boxes. Same look, more calls.
      obj = new THREE.Group();
      for (let i = 0; i < list.length; i++) {
        const m = new THREE.Mesh(list[i], CBZ.cmat(color));
        m.castShadow = false; obj.add(m);
      }
    }
    if (dynamic) { obj.userData.dynamic = true; obj.userData.mover = true; }
    root.add(obj);
    return obj;
  }

  // The barred FACE of a cell lives in a 1-D frame: `t` runs along the face,
  // `off` runs out of it. Both axes are world-aligned, so a box's dimensions
  // map straight through and every collider AABB stays true.
  function faceBox(list, c, t, y, off, wt, hgt, wo) {
    if (c.dx !== 0) pushBox(list, c.faceX + c.dx * off, y, c.faceZ + t, wo, hgt, wt);
    else pushBox(list, c.faceX + t, y, c.faceZ + c.dz * off, wt, hgt, wo);
  }
  function barRun(list, c, t0, t1, pitch, off) {
    const len = t1 - t0, tc = (t0 + t1) / 2;
    faceBox(list, c, tc, 0.17, off, len, 0.30, 0.20);            // bottom rail
    faceBox(list, c, tc, CH - 0.17, off, len, 0.30, 0.20);       // top rail
    for (let t = t0 + 0.24; t <= t1 - 0.20 + 1e-6; t += pitch)
      faceBox(list, c, t, CH / 2, off, BAR, CH - 0.34, BAR);
  }

  /* ==========================================================
     4. ONE CELL. Structure, then the barred face, then the fittings.
     ========================================================== */
  function buildCell(c) {
    const g = [];            // merged into the static batch (fixed grille + track)

    // ---- roof slab: a cell has a CEILING. A partition that stops short of
    //      one is the exact "reads fake" fault jail.js:427 names, and the
    //      hemisphere ambient (core/lights.js, 0.85, unshadowed) keeps a
    //      roofed cell readable, so enclosing costs nothing in legibility.
    //      blockLOS because it is 30 cm of concrete and nothing can see through
    //      it — the wing itself is open-topped, so this slab is the ONLY lid in
    //      the prison and the only thing that can tell a cell apart from the
    //      corridor outside it. systems/camera.js's room probe asks exactly that
    //      question (CAM_TIGHT_FP / CAM_ROOM_BOOM: a room has a ceiling AND
    //      walls; a corridor has walls and open sky), and with no LOS-visible
    //      lid anywhere it could only ever answer "outdoors". It costs no draw
    //      call — core/batch.js still merges an LOS blocker's geometry and keeps
    //      the hidden original purely as a raycast target.
    addBox(c.x, CH + RT / 2, c.z, c.hx * 2 + WT, RT, c.hz * 2 + WT, C_ROOF, { cast: false, blockLOS: true });

    // ---- the FACE: fixed grille + a jamb + the sliding leaf's floor track.
    const gA = c.flip ? [c.ob, c.half] : [-c.half, c.oa];        // the pocket
    const gB = c.flip ? [-c.half, c.oa] : [c.ob, c.half];        // the narrow side
    barRun(g, c, gA[0], gA[1], BAR_P, 0);
    if (gB[1] - gB[0] >= 0.7) barRun(g, c, gB[0], gB[1], BAR_P, 0);
    else faceBox(g, c, (gB[0] + gB[1]) / 2, CH / 2, 0, gB[1] - gB[0], CH, 0.22);   // jamb post
    faceBox(g, c, 0, 0.045, 0.14, c.half * 2, 0.09, 0.30);        // floor track (sliding doors run on one)
    mergedMesh(g, C_BAR, false);

    // the fixed halves of the face are permanent walls; only the OPENING toggles
    faceSolid(c, gA[0], gA[1], true);
    faceSolid(c, gB[0], gB[1], true);
    c.doorCol = faceSolid(c, c.oa, c.ob, false);                  // pushed/spliced by setDoor

    // ---- the sliding leaf: ONE merged mesh, live (userData.dynamic) so the
    //      static batcher and staticfreeze both leave it alone.
    const leaf = [];
    const lc = { dx: c.dx, dz: c.dz, faceX: 0, faceZ: 0 };
    barRun(leaf, lc, -DOOR_W / 2, DOOR_W / 2, 0.36, 0);
    faceBox(leaf, lc, -DOOR_W / 2 + 0.06, CH / 2, 0, 0.14, CH - 0.30, 0.16);   // stiles
    faceBox(leaf, lc, DOOR_W / 2 - 0.06, CH / 2, 0, 0.14, CH - 0.30, 0.16);
    faceBox(leaf, lc, DOOR_W / 2 - 0.30, 1.15, 0, 0.34, 0.16, 0.22);           // the pull handle
    const leafMesh = mergedMesh(leaf, C_BAR, true);
    c.bars = leafMesh;
    const oc = (c.oa + c.ob) / 2;
    c.leafClosed = facePoint(c, oc, 0.13);
    c.leafOpen = facePoint(c, oc + (c.flip ? DOOR_W : -DOOR_W), 0.13);
    if (leafMesh) leafMesh.position.set(c.leafClosed.x, 0, c.leafClosed.z);

    fitOutCell(c);
  }

  // a world point on the face frame
  function facePoint(c, t, off) {
    return c.dx !== 0
      ? { x: c.faceX + c.dx * off, z: c.faceZ + t }
      : { x: c.faceX + t, z: c.faceZ + c.dz * off };
  }
  // an AABB across the face frame from t0..t1. `perm` = pushed now and never
  // removed; otherwise the caller owns it (the door).
  function faceSolid(c, t0, t1, perm) {
    let minX, maxX, minZ, maxZ;
    if (c.dx !== 0) {
      minX = c.faceX - COL_T / 2; maxX = c.faceX + COL_T / 2;
      minZ = c.faceZ + t0; maxZ = c.faceZ + t1;
    } else {
      minX = c.faceX + t0; maxX = c.faceX + t1;
      minZ = c.faceZ - COL_T / 2; maxZ = c.faceZ + COL_T / 2;
    }
    if (perm) return solid(minX, minZ, maxX, maxZ, 0, CH);
    const col = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: 0, y1: CH };
    mine.push(col);
    return col;
  }

  /* ---------- cell fittings. NON-SOLID on purpose: a 3.8 m cell holding a
       0.55-radius player plus a 0.5-radius inmate cannot also carry a solid
       bunk and a solid toilet and stay walkable. What is SOLID in this wing
       is the STRUCTURE (partitions, grille, door) — the same call
       city/arena_venue.js made about its seat banks, for the same reason. */
  function bunkRig(c, x, z, along, dbl, blanket) {
    // ONE local frame instead of eleven `along === "z" ? … : …` ternaries.
    // `lat` = across the bunk, `lon` = along the lie axis with the PILLOW at
    // -lon. Writing it once is not tidiness: the old ternaries disagreed with
    // each other — the blanket's 0.55 foot-ward shift and the pillow's -1.00
    // head-ward shift were applied on the z axis ONLY, so every bunk laid out
    // along X got a full-length blanket with no fold and a pillow parked in the
    // middle of the mattress. In this frame both orientations are the same bunk.
    const AZ = along === "z";
    const DET = !CBZ.CONFIG || CBZ.CONFIG.FURNISH_DETAIL !== false;
    function bb(lat, y, lon, wLat, h, wLon, col, o) {
      addBox(x + (AZ ? lat : lon), y, z + (AZ ? lon : lat),
        AZ ? wLat : wLon, h, AZ ? wLon : wLat, col, o || { cast: false });
    }
    const LAT = 1.25, LON = 2.60, MLAT = 1.05, MLON = 2.35;
    bb(0, 0.50, 0, LAT, 0.30, LON, C_BUNK, {});                          // frame
    bb(0, 0.70, 0, MLAT, 0.18, MLON, C_MATT);                            // mattress → 0.79
    if (DET) {
      // a TUCKED SHEET: a thin lip of linen overhanging the frame all round.
      // It is the line that separates "mattress" from "slab on a shelf".
      bb(0, 0.615, 0, MLAT + 0.10, 0.09, MLON + 0.08, C_MATT);
      bb(0, 0.42, LON / 2 - 0.05, LAT, 0.14, 0.10, C_DARK);              // foot rail
    }
    bb(0, 0.80, 0.55, MLAT * 0.94, 0.10, 1.30, blanket);                 // blanket over the legs
    if (DET) bb(0, 0.82, -0.09, MLAT * 0.96, 0.12, 0.18, C_MATT);        // TURNED-DOWN fold
    bb(0, 0.82, -1.00, 0.90, 0.16, 0.42, 0xe6e9ed);                      // pillow
    // FOUR corner legs, not the two diagonal ones this used to draw (a bunk
    // resting on opposite corners is a thing the eye reads as broken).
    for (const a of [-1, 1]) for (const b2 of [-1, 1]) {
      if (!DET && a !== b2) continue;
      bb(a * 0.55, 0.25, b2 * 1.25, 0.12, 0.50, 0.12, C_DARK);
    }
    if (dbl) {
      bb(0, 1.70, 0, LAT, 0.28, LON, C_BUNK, {});                        // upper frame
      bb(0, 1.88, 0, MLAT, 0.18, MLON, C_MATT);                          // upper mattress → 1.97
      if (DET) {
        bb(0, 1.815, 0, MLAT + 0.10, 0.09, MLON + 0.08, C_MATT);         // tucked sheet
        bb(0, 1.98, 0.55, MLAT * 0.94, 0.10, 1.30, blanket);             // the top bunk gets bedding too
        bb(0, 2.00, -0.09, MLAT * 0.96, 0.12, 0.18, C_MATT);             // turned-down fold
        // GUARD RAIL down the open side + a two-rung ladder at the foot: the
        // two fittings that say "somebody sleeps up there" rather than "shelf".
        bb(LAT / 2 - 0.06, 2.16, 0.30, 0.08, 0.30, 1.60, C_DARK);
        for (let r = 0; r < 2; r++) bb(0, 1.05 + r * 0.42, LON / 2 - 0.02, 0.60, 0.07, 0.07, C_DARK);
      }
      bb(0, 1.98, -1.00, 0.90, 0.14, 0.42, 0xdfe3ea);                    // upper pillow
      for (const a of [-1, 1]) bb(a * 0.60, 1.05, a * 1.28, 0.10, 1.40, 0.10, C_DARK);   // corner posts
    }
    // `topBunk` is the UPPER mattress surface, and it is null when there is no
    // upper rack — so "does this stack sleep two" is answered by the geometry
    // that drew it and never by a constant somewhere else. The 1.97 matches the
    // `bb(0, 1.88, 0, MLAT, 0.18, …)` upper mattress above, exactly the way
    // `top: 0.79` matches the lower one.
    return { x: x, z: z, top: 0.79, topBunk: dbl ? 1.97 : null, along: along };
  }

  /* The cell is already the venue's best furniture. South-block housing must
     compound that owner, not redraw a cheaper bunk beside it. This is the one
     narrow construction seam: identical frame/bedding/rail/ladder geometry,
     identical deferred registration, and records returned on the stack that
     drew them. world/southblock.js supplies only placement and unit ownership. */
  const housingStacks = (CBZ.prisonHousingStacks = CBZ.prisonHousingStacks || []);
  CBZ.prisonBunk = function (spec) {
    spec = spec || {};
    const stack = {
      id: spec.id || ("housing-bunk-" + housingStacks.length),
      _housingUnit: spec.unit || null,
      bed: null, bedTop: null, bunk: null,
    };
    stack.bunk = bunkRig(stack, +spec.x || 0, +spec.z || 0, spec.along === "x" ? "x" : "z",
      spec.double !== false, spec.blanket == null ? 0x5c6470 : spec.blanket);
    useBed(stack.bunk.x, stack.bunk.z, stack.bunk.along, stack.bunk.top, 2.60, stack, "bed", 0);
    if (stack.bunk.topBunk)
      useBed(stack.bunk.x, stack.bunk.z, stack.bunk.along, stack.bunk.topBunk, 2.60, stack, "bedTop", 1.18);
    housingStacks.push(stack);
    return stack;
  };

  // the combined steel toilet/sink every cell in the world actually has.
  // (nx,nz) points INTO the cell's back wall, so the cistern and the tap are
  // placed by ADDING it — the unit's back is always the masonry, never the room.
  function toiletSink(x, z, nx, nz) {
    const side = Math.abs(nx) > 0.5;
    const bw = side ? 0.52 : 0.66, bd = side ? 0.66 : 0.52;
    addBox(x, 0.28, z, bw, 0.56, bd, C_STEEL, {});                                   // pedestal
    addBox(x, 0.58, z, bw * 0.95, 0.10, bd * 0.95, 0xe6e9ed, { cast: false });       // rim
    addBox(x + nx * 0.26, 0.92, z + nz * 0.26, side ? 0.16 : 0.66, 0.70, side ? 0.66 : 0.16, C_STEEL_D, { cast: false }); // cistern
    addBox(x, 1.06, z, bw * 0.86, 0.12, bd * 0.86, 0xeef2f5, { cast: false });       // sink basin
    addBox(x + nx * 0.20, 1.22, z + nz * 0.20, 0.06, 0.20, 0.06, 0xd7dce2, { cast: false }); // tap
  }

  // a shelf + its two brackets, sized along the wall it hangs on
  function shelf(x, y, z, w, d) {
    addBox(x, y, z, w, 0.06, d, 0xb9a184, { cast: false });
    if (w > d) {
      addBox(x - w * 0.4, y - 0.09, z, 0.05, 0.12, d * 0.7, C_STEEL_D, { cast: false });
      addBox(x + w * 0.4, y - 0.09, z, 0.05, 0.12, d * 0.7, C_STEEL_D, { cast: false });
    } else {
      addBox(x, y - 0.09, z - d * 0.4, w * 0.7, 0.12, 0.05, C_STEEL_D, { cast: false });
      addBox(x, y - 0.09, z + d * 0.4, w * 0.7, 0.12, 0.05, C_STEEL_D, { cast: false });
    }
  }

  // a barred window punched through the north wall, inside one cell
  function cellWindow(x) {
    const pane = addBox(x, 2.30, -43.40, 1.60, 1.50, 0.20, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 });
    pane.material.transparent = true; pane.material.opacity = 0.6;   // OWNER RULE (bda61ab): clear glass, never grey
    addBox(x, 3.10, -43.34, 1.80, 0.16, 0.28, C_PART_D, { cast: false });   // lintel
    addBox(x, 1.52, -43.34, 1.80, 0.14, 0.34, C_PART_D, { cast: false });   // sill
    for (let i = 0; i < 4; i++) addBox(x - 0.60 + i * 0.40, 2.30, -43.22, 0.09, 1.40, 0.09, C_BAR, { cast: false });
    addBox(x, 1.62, -43.22, 1.50, 0.10, 0.10, C_BAR, { cast: false });
    addBox(x, 2.98, -43.22, 1.50, 0.10, 0.10, C_BAR, { cast: false });
  }

  function fitOutCell(c) {
    const north = c.dz !== 0;                                           // north row?
    const inx = c.dx !== 0 ? -c.dx : 0, inz = c.dz !== 0 ? -c.dz : 0;   // "into the cell"
    const backX = c.x + inx * (c.hx - BACK_IN), backZ = c.z + inz * (c.hz - BACK_IN);
    const blanket = c.player ? 0xa8442f : pick([0x5c6470, 0x4a5b46, 0x6b6152, 0x53535e], c.x, c.z, 3311);

    /* BUNK — against the cell's "left" wall as seen from the door, head to the
       back.

       EVERY CELL IS A DOUBLE NOW, AND THAT IS A CORRECTION, NOT A CHANGE OF
       MIND. This line read `bunkRig(..., north, ...)` — the 5.5 m north row got
       a stack and the nine 3.8 m side cells got a single, on the stated grounds
       that "a stack in a small cell is what reads fake means". Meanwhile the
       arithmetic every population number in this game is a subtraction against
       — CBZ.prisonBeds() below — has published `perCell: 2` since the day it
       was written. Thirteen of the twenty-six places this prison claims to have
       did not physically exist, and systems/prisonrest.js measured the
       consequence: 42 live inmates against 13 registered mattresses.

       Of the two ways to reconcile that, shrinking the claim shrinks the game
       (houses -> cast) and shrinking a prison's design capacity to make an
       overcrowding statistic look better is the exact move Brown v. Plata was
       about. So the geometry is what moves: a 3.8 m cell with a stack in it is
       not "fake", it is the single most photographed object in American
       corrections. `bunkRig` already draws the whole upper rack — frame,
       mattress, bedding, guard rail, ladder — so this costs one argument. */
    const bx = north ? c.x - (c.hx - 0.70) : c.x - c.dx * (c.hx - 0.70);
    const bz = north ? c.z - c.dz * (c.hz - 1.55) : c.z - (c.hz - 1.40);
    c.bunk = bunkRig(c, bx, bz, "z", true, blanket);
    // THE BUNK IS A BED — BOTH RACKS. Each returns its own mattress top (0.79
    // and 1.97) as the declared cushion, so an anchor can never drift off the
    // mesh it belongs to. `c` + "bed"/"bunkTop" is where the records land once
    // the queue above is drained. A man on the top rack is a man who is not on
    // a floor mat, which is the whole point of drawing it.
    useBed(c.bunk.x, c.bunk.z, "z", c.bunk.top, 2.60, c, "bed", 0);
    if (c.bunk.topBunk) useBed(c.bunk.x, c.bunk.z, "z", c.bunk.topBunk, 2.60, c, "bedTop", 1.18);

    // TOILET + SINK at the back corner opposite the bunk, its back to masonry.
    const tx = north ? c.x + (c.hx - 0.55) : backX;
    const tz = north ? backZ : c.z + (c.hz - 0.55);
    toiletSink(tx, tz, inx, inz);
    // the shelf/mirror over the sink — one shelf, and everything small sits ON it
    shelf(tx, 1.62, tz, north ? 0.78 : 0.44, north ? 0.44 : 0.78);
    addBox(tx + inx * 0.24, 2.02, tz + inz * 0.24, north ? 0.44 : 0.06, 0.52, north ? 0.06 : 0.44, 0xd6e2ea, { cast: false }); // mirror
    // a stool, only where the 5.5 m north cells have the depth for one — and
    // deliberately 1.4 m clear of CBZ.SPAWN so the player never boots inside it.
    // IT IS THE FIRST THING IN THIS PRISON YOU CAN SHOVE. 7 kg of moulded
    // plastic on a concrete floor: walk into it and it slides, and its collider
    // and its sit anchor go with it (systems/pushprops.js).
    if (north) {
      const st = addBox(c.x + 1.15, 0.22, c.z + 1.00, 0.44, 0.44, 0.44, 0x6b6152, { cast: false });
      useSeat(c.x + 1.15, c.z + 1.00, Math.atan2(-1.15, -1.00), 0.44);
      if (CBZ.pushProp) CBZ.pushProp({
        // `stand`: THE CELL STOOL IS THE OWNER'S OWN EXAMPLE. 7 kg, a 0.44 m
        // flat pad — shove it against a wall and stand on it. The leash keeps
        // it inside the cell, so what it buys you is height in YOUR OWN ROOM.
        parts: [st], x: c.x + 1.15, z: c.z + 1.00, hx: 0.22, hz: 0.22, y1: 0.44,
        mass: 7, kind: "stool", solid: true, leash: 3.2, stand: true, mode: "escape", seat: { x: c.x + 1.15, z: c.z + 1.00 },
        room: { x0: c.x - c.hx + 0.4, x1: c.x + c.hx - 0.4, z0: c.z - c.hz + 0.4, z1: c.z + c.hz - 0.4 },
      });
    }

    // CEILING STRIP — every cell is lit. Mirrored by the wing lamp driver so
    // systems/interactions.js's breaker sabotage takes the whole block dark.
    lamps.push(addBox(c.x, CH - 0.14, c.z + (north ? c.dz * 0.6 : 0), north ? 0.7 : 0.26, 0.08, north ? 0.26 : 0.7,
      0xfff3cf, { emissive: 0xffd98a, ei: 0.95, cast: false }));

    // ---- PERSONAL EFFECTS. Deterministic per cell (position hash), because a
    //      cell that looks like every other cell is a corridor with doors. They
    //      hang on the PARTITIONS, never the back wall — that is where the
    //      barred window is, and a poster over a window is a poster in a hole.
    const sideX = north ? c.x + c.hx - 0.05 : c.x + inx * 0.55;     // the "right-hand" partition
    const sideZ = north ? c.z + 0.55 : c.z + c.hz - 0.05;
    const oppX = north ? c.x - c.hx + 0.05 : c.x + inx * 0.55;      // the bunk-head partition
    const oppZ = north ? c.z - 1.30 : c.z - c.hz + 0.05;
    if (h01(c.x, c.z, 5501) < 0.62) {   // a poster taped up on the partition
      addBox(sideX, 1.95, sideZ, north ? 0.05 : 0.58, 0.78, north ? 0.58 : 0.05,
        pick([0xc9a24a, 0x4a7fc9, 0xb2544a, 0x4fa06b], c.x, c.z, 5503), { cast: false });
    }
    if (h01(c.x, c.z, 5502) < 0.55) {   // a towel over the bunk rail
      addBox(c.bunk.x + 0.62, 0.70, c.bunk.z + 0.70, 0.10, 0.56, 0.34,
        pick([0xe2e2e2, 0xd8c9a8, 0xbcd2df], c.x, c.z, 5504), { cast: false });
    }
    if (h01(c.x, c.z, 5505) < 0.50) {   // a cup on the sink shelf
      addBox(tx + (north ? -0.24 : 0), 1.74, tz + (north ? 0 : -0.24), 0.13, 0.17, 0.13, 0xdfe6ec, { cast: false });
    }
    if (h01(c.x, c.z, 5506) < 0.42) {   // a stack of books on it
      addBox(tx + (north ? 0.24 : 0), 1.73, tz + (north ? 0 : 0.24), north ? 0.24 : 0.18, 0.16, north ? 0.18 : 0.24, 0x8a5e2b, { cast: false });
    }

    // THE PLAYER'S CELL IS MARKED AS OURS — a red blanket (above), three taped
    // photographs over the bunk head and a scratched tally by the door. No
    // prompt and no icon: you recognise your own cell, which is the whole point.
    if (c.player) {
      for (let i = 0; i < 3; i++)
        addBox(oppX + (north ? 0.03 : 0), 2.35, oppZ + (north ? -0.34 + i * 0.34 : 0.03), north ? 0.03 : 0.24, 0.30, north ? 0.24 : 0.03,
          [0xe8e2cf, 0xd9cdb4, 0xefe8d6][i], { cast: false });
      for (let i = 0; i < 6; i++)
        addBox(sideX - (north ? 0.03 : 0), 1.62 - ((i / 4) | 0) * 0.24, sideZ + (north ? -0.9 + (i % 4) * 0.11 : -0.03),
          north ? 0.02 : 0.03, 0.20, north ? 0.03 : 0.02, 0xdfe4ea, { cast: false });
    }

    // a barred window through the north wall, one per north-row cell
    if (north) cellWindow(c.x);
  }

  /* ==========================================================
     5. BUILD THE THREE ROWS
     ========================================================== */
  const lamps = [];

  function addCell(seg, opts) {
    const c = {
      i: cells.length, tag: seg.tag, player: !!seg.player,
      x: opts.x, z: opts.z, hx: opts.hx, hz: opts.hz,
      dx: opts.dx, dz: opts.dz,
      faceX: opts.faceX, faceZ: opts.faceZ,
      half: opts.dx !== 0 ? opts.hz : opts.hx,
      locked: false, owner: null,
      doorCol: null, bars: null, slide: 0, slideT: 0,
    };
    // Which side the leaf pockets into. Alternated so the wing reads like a
    // real tier and not a wallpaper repeat — but the PLAYER's cell is pinned
    // unflipped, because that is the side CBZ.SPAWN stands on.
    c.flip = c.player ? false : ((cells.length & 1) === 1);
    if (c.flip) { c.ob = c.half - POCKET; c.oa = c.ob - DOOR_W; }
    else { c.oa = -c.half + POCKET; c.ob = c.oa + DOOR_W; }
    const dc = facePoint(c, (c.oa + c.ob) / 2, 0);
    c.doorX = dc.x; c.doorZ = dc.z;
    cells.push(c);
    if (c.player) playerCell = c;
    buildCell(c);
    return c;
  }

  // ---- NORTH ROW: doors face SOUTH (+z), cells 3.80 wide x 5.50 deep -------
  const NZ = (IZN + NFACE) / 2, NHZ = ND / 2;
  for (const seg of NORTH_ROW) {
    const w = seg.b - seg.a, cx = (seg.a + seg.b) / 2;
    if (seg.kind === "wall") {
      sbox(cx, CH / 2, NZ, w, CH, ND, C_PART, { solid: true, blockLOS: true });
    } else if (seg.kind === "cell") {
      addCell(seg, { x: cx, z: NZ, hx: w / 2, hz: NHZ, dx: 0, dz: 1, faceX: cx, faceZ: NFACE });
    } else if (seg.kind === "shower") {
      showerAlcove(cx, NZ, w, ND);
    } else if (seg.kind === "store") {
      storeAlcove(cx, NZ, w, ND);
    } else {
      officerPost(cx, NZ, w, ND);
    }
  }

  // ---- WEST ROW: doors face EAST (+x) --------------------------------------
  const WX = (IX0 + WFACE) / 2, WHX = SD / 2;
  for (const seg of WEST_ROW) {
    const len = seg.b - seg.a, cz = (seg.a + seg.b) / 2;
    if (seg.kind === "wall") sbox(WX, CH / 2, cz, SD, CH, len, C_PART, { solid: true, blockLOS: true });
    else if (seg.kind === "cell") addCell(seg, { x: WX, z: cz, hx: WHX, hz: len / 2, dx: 1, dz: 0, faceX: WFACE, faceZ: cz });
    else utilityAlcove(WX, cz, SD, len, 1);
  }

  // ---- EAST ROW: doors face WEST (-x) --------------------------------------
  const EX = (IX1 + EFACE) / 2, EHX = SD / 2;
  for (const seg of EAST_ROW) {
    const len = seg.b - seg.a, cz = (seg.a + seg.b) / 2;
    if (seg.kind === "wall") sbox(EX, CH / 2, cz, SD, CH, len, C_PART, { solid: true, blockLOS: true });
    else if (seg.kind === "cell") addCell(seg, { x: EX, z: cz, hx: EHX, hz: len / 2, dx: -1, dz: 0, faceX: EFACE, faceZ: cz });
    else utilityAlcove(EX, cz, SD, len, -1);
  }

  /* ==========================================================
     6. THE ALCOVES — the three breaks in the cell line, each of them a
        thing the wing needs rather than a hole in the row.
     ========================================================== */
  function showerAlcove(cx, cz, w, d) {
    addBox(cx, 0.03, cz + 0.6, w - 0.1, 0.06, d - 1.6, 0x7c8894, { cast: false });     // tiled pan
    addBox(cx, 0.05, cz + 0.6, 0.34, 0.10, 0.34, 0x5b6470, { cast: false });           // drain
    for (let i = 0; i < 2; i++) {
      const zz = cz - 1.5 + i * 2.6;
      addBox(cx - w / 2 + 0.14, 2.35, zz, 0.14, 0.14, 0.14, C_STEEL_D, { cast: false });
      addBox(cx - w / 2 + 0.45, 2.28, zz, 0.5, 0.10, 0.22, C_STEEL, { cast: false });  // head
      addBox(cx - w / 2 + 0.12, 1.30, zz, 0.10, 2.00, 0.10, C_STEEL_D, { cast: false }); // riser
    }
    addBox(cx, 2.9, cz + d / 2 - 0.2, w - 0.2, 0.16, 0.16, C_STEEL_D, { cast: false }); // curtain rail
    addBox(cx, 1.0, cz - d / 2 + 0.35, w - 0.6, 0.05, 0.3, 0xb9a184, { cast: false });  // bench
  }
  function storeAlcove(cx, cz, w, d) {
    for (let i = 0; i < 3; i++)
      addBox(cx, 0.7 + i * 0.72, cz - 0.7, w - 0.3, 0.07, d - 2.6, 0xb9a184, { cast: false });
    sbox(cx, 1.35, cz - d / 2 + 0.25, w - 0.3, 2.7, 0.10, C_PART_D, { solid: true }); // back rack frame
    addBox(cx, 0.55, cz + d / 2 - 1.1, 1.3, 1.1, 1.5, 0xe2e2e2, { cast: false });       // laundry cart
    addBox(cx, 1.12, cz + d / 2 - 1.1, 1.4, 0.12, 1.6, 0xd0d0d0, { cast: false });
  }
  // The wing's control point. Open to the floor on purpose: guards.js:79
  // patrols to (0,-39), which is 3.6 m south of this desk.
  function officerPost(cx, cz, w, d) {
    // NO window here: this bay's back is a panelled duty board, and a pane
    // behind a panel is a pane nobody will ever see.
    // …except where the STAFF DOOR passes through it (see §0). The panel is
    // drawn as the run east of the opening plus whatever stub survives west
    // of it, so the duty board never hangs across the doorway.
    const pz = cz - d / 2 + 0.3, p0 = cx - (w - 0.6) / 2, p1 = cx + (w - 0.6) / 2;
    if (SG.x1 > p0 && SG.x0 < p1) {
      if (SG.x0 - p0 > 0.2) addBox((p0 + SG.x0) / 2, 1.5, pz, SG.x0 - p0, 3.0, 0.12, C_PART_D, { cast: false });
      if (p1 - SG.x1 > 0.2) addBox((SG.x1 + p1) / 2, 1.5, pz, p1 - SG.x1, 3.0, 0.12, C_PART_D, { cast: false });
      // reveal: the jambs of the opening, so the hole reads as a doorway
      for (const jx of [SG.x0, SG.x1])
        addBox(jx, SG.h / 2, cz - d / 2 - 0.05, 0.16, SG.h, 0.72, C_PART_D, { cast: false });
      addBox((SG.x0 + SG.x1) / 2, SG.h + 0.09, cz - d / 2 - 0.05, SG.x1 - SG.x0 + 0.32, 0.18, 0.72, C_PART_D, { cast: false });
    } else {
      addBox(cx, 1.5, pz, w - 0.6, 3.0, 0.12, C_PART_D, { cast: false });               // back panel
    }
    sbox(cx, 0.55, cz - d / 2 + 1.1, 3.4, 1.1, 0.9, 0x33200f, { solid: true });         // desk
    addBox(cx, 1.16, cz - d / 2 + 1.1, 3.6, 0.12, 1.0, 0x4a3a22, { cast: false });
    addBox(cx - 0.9, 1.34, cz - d / 2 + 1.0, 0.7, 0.42, 0.06, 0x9fd6ff, { emissive: 0x2a6ea5, ei: 0.7, cast: false }); // monitor
    addBox(cx + 1.5, 1.75, cz - d / 2 + 0.42, 0.9, 1.1, 0.10, 0x2a2f38, { cast: false });   // key board
    for (let i = 0; i < 8; i++)
      addBox(cx + 1.15 + (i % 4) * 0.24, 1.95 - ((i / 4) | 0) * 0.36, cz - d / 2 + 0.36, 0.07, 0.20, 0.04, 0xd9b64c, { cast: false });
    addBox(cx, 0.45, cz - d / 2 + 2.0, 0.6, 0.9, 0.6, C_DARK, { cast: false });         // chair
    addBox(cx, 1.05, cz - d / 2 + 2.25, 0.6, 0.7, 0.1, C_DARK, { cast: false });
    // WING SIGN — the block announces itself over the post.
    addBox(cx, 3.6, cz + d / 2 - 0.1, 5.0, 0.7, 0.14, 0x11151b, { cast: false });
    addBox(cx, 3.6, cz + d / 2 - 0.2, 4.4, 0.34, 0.06, 0xe8b64c, { emissive: 0x6a4f10, ei: 0.6, cast: false });
  }
  // The break the ventilation grate lives in (ventilation.js:41, z = -31) — a
  // recess, never a cell, so that escape route can never be locked away.
  function utilityAlcove(cx, cz, depth, len, side) {
    const wallX = cx - side * (depth / 2 - 0.06);
    addBox(cx, 0.55, cz - len / 2 + 0.7, 0.8, 1.1, 0.8, 0x6b7480, { cast: false });     // mop sink
    addBox(cx, 1.12, cz - len / 2 + 0.7, 0.7, 0.06, 0.7, 0xd7dce2, { cast: false });
    for (let i = 0; i < 3; i++)
      addBox(cx + side * 0.9, 0.32 + i * 0.4, cz + len / 2 - 0.8 - i * 0.12, 0.55, 0.4, 0.55,
        [0x4f7f4f, 0xb07a3c, 0x54606d][i], { cast: false });                            // stacked buckets
    addBox(wallX, 2.55, cz, 0.10, 0.3, len - 0.6, C_STEEL_D, { cast: false });          // conduit run
    addBox(cx, 3.1, cz, depth - 0.3, 0.14, len - 0.4, C_PART_D, { cast: false });       // low soffit
  }

  /* ==========================================================
     7. THE FLOOR — corridor fittings, kept out of the two lanes that
        matter: the spine at x = 0 (guards.js patrol) and the south
        throat x[-3,3] at z = -8 (world/door.js).
     ========================================================== */
  // The table is BOLTED (sbox → a real collider that never moves). The four
  // stools are not: a day-room stool is a loose 9 kg pedestal and the block
  // rearranges them all day, so each one is a pushable with its own collider
  // and carries its propuse sit anchor with it when it slides.
  function dayTable(x, z) {
    sbox(x, 0.74, z, 2.2, 0.10, 1.0, 0x8a939d, { solid: true });
    addBox(x, 0.37, z, 0.28, 0.74, 0.28, C_STEEL_D, { cast: false });
    for (let i = -1; i <= 1; i += 2) for (const j of [1, -1]) {
      const sx = x + i * 0.85, sz = z + j * 0.85;
      const pad = addBox(sx, 0.44, sz, 0.42, 0.08, 0.42, 0x6b7480, { cast: false });
      const post = addBox(sx, 0.22, sz, 0.14, 0.44, 0.14, C_STEEL_D, { cast: false });
      if (CBZ.pushProp) CBZ.pushProp({
        parts: [pad, post], x: sx, z: sz, hx: 0.21, hz: 0.21, y1: 0.48,
        mass: 9, kind: "stool", solid: true, leash: 3.0, stand: true, mode: "escape", seat: { x: sx, z: sz },
      });
    }
  }
  dayTable(-6.6, -26.0);
  dayTable(6.6, -26.0);
  // ...and its four stools are seats. The day room is where a block SITS; two
  // tables with eight bolted stools nobody could use is the fake-prop fault in
  // its purest form. Stool cushion is 0.48 (the 0.44-thick pad on a 0.22 post,
  // matching dayTable's own numbers) and each looks at the table centre.
  for (const tx of [-6.6, 6.6]) for (const i of [-1, 1]) for (const j of [-1, 1]) {
    useSeat(tx + i * 0.85, -26.0 + j * 0.85, Math.atan2(-i * 0.85, -j * 0.85), 0.48);
  }
  // NO centre line down the spine. The dashed yellow one that lived here was
  // road grammar — from the air it joined the walkway and the track oval into
  // the owner's "yellow dotted road going through the middle of the jail".
  // The aisle already reads as the walk; nothing on a prison floor should
  // read as a carriageway.

  // ---- caged ceiling lamps, one per stretch of cells ----------------------
  // CBZ.ceilingLamp is a PUBLISHED handle: systems/interactions.js's breaker
  // sabotage and systems/state.js's reset both write its material directly.
  // Keep the original at (0, 8.2, -30) exactly and mirror it onto the rest.
  function cageLamp(x, z) {
    addBox(x, 8.6, z, 0.5, 0.3, 0.5, C_DARK, { cast: false });
    const l = addBox(x, 8.2, z, 0.7, 0.2, 0.7, 0xffe9a8, { emissive: 0xffcf66, ei: 0.9, cast: false });
    for (let i = -1; i <= 1; i += 2) addBox(x + i * 0.36, 8.2, z, 0.06, 0.26, 0.62, C_DARK, { cast: false });
    return l;
  }
  const ceilingLamp = cageLamp(0, -30);
  CBZ.ceilingLamp = ceilingLamp;
  lamps.push(cageLamp(0, -37.5), cageLamp(0, -22.5), cageLamp(0, -15), cageLamp(-7.5, -33), cageLamp(7.5, -33));

  /* ==========================================================
     8. THE DOOR — jail.js's setDoor, ported. The collider and the visual
        move TOGETHER; nothing else in this file may touch either.
     ========================================================== */
  function placeLeaf(c) {
    if (!c.bars) return;
    c.bars.position.x = c.leafClosed.x + (c.leafOpen.x - c.leafClosed.x) * c.slide;
    c.bars.position.z = c.leafClosed.z + (c.leafOpen.z - c.leafClosed.z) * c.slide;
  }
  function setDoor(which, locked) {
    const c = typeof which === "number" ? cells[which] : which;
    if (!c || !c.doorCol) return false;
    const arr = CBZ.colliders || (CBZ.colliders = []);
    const i = arr.indexOf(c.doorCol);
    if (locked && i < 0) arr.push(c.doorCol);
    else if (!locked && i >= 0) arr.splice(i, 1);
    const moved = c.locked !== !!locked;
    c.locked = !!locked;
    c.slideT = locked ? 0 : 1;                 // 0 = shut, 1 = pocketed
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // THE LEAF IS THE THING THAT MAKES THE NOISE, so it is voiced HERE, from
    // the moving hardware at the door's own coordinates — never at whatever
    // state change asked for it (tools/test-sound-source-contracts.mjs holds
    // that line, and systems/capture.js was breaking it by asking for a
    // generic `door` cue that had not existed for months: the bars racking
    // shut on you at intake played nothing at all). Every caller gets it free:
    // intake, release, a facility lockdown racking the whole wing. `ref` is
    // wider than a fist's because a steel gate at 85 dB carries further than
    // an 80 dB body blow, and CBZ.worldSfx collapses lockAll's hundred
    // simultaneous leaves into ONE voice — the nearest one, which is the only
    // one that means anything.
    if (moved && CBZ.worldSfx && c.leafClosed) {
      CBZ.worldSfx(locked ? "door_close" : "door_open", c.leafClosed.x, c.leafClosed.z, { ref: 14 });
    }
    return true;
  }

  // Build state: every door OPEN, and the LEAF SNAPPED INTO ITS POCKET — a
  // logically-open door still drawn across its own opening is the lie this
  // grammar exists to prevent. The wing's day flow is free movement, and the
  // PLAYER's cell in particular must never be shut at boot: state.js and
  // capture.js both drop the player at CBZ.SPAWN with no door handling of
  // their own. Schedules/lockdowns are somebody else's call (setDoor is theirs).
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    c.locked = false; c.slide = 1; c.slideT = 1;
    placeLeaf(c);
  }

  /* ==========================================================
     9. INMATES. The wing does not mint a character system: it asks
        entities/npc.js's own factory (CBZ.spawnJailNpc) for the same
        inmate the yard is already full of, and then LEASHES it to a cell.
        npc.js loads at index.html:461, ~78 tags after this file, so the
        cast is dealt on the first tick instead of at parse time — the same
        deferral games/jail.js uses for its own queued cast.
     ========================================================== */
  const NAMES = ["Marchetti", "Pike", "Osei", "Vance", "Two-Time", "Bishop", "Halloran", "Renke",
    "Ortiz", "Dobbs", "Kessler", "Whistler", "Ash"];
  const BEH = ["defensive", "pacifist", "opportunist", "hothead", "unpredictable", "protector"];
  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xb5825a];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede];
  const TALK = [
    ["Bunk's mine. Floor's yours.", "Lights out at nine. Don't be loud."],
    ["I been in this cell longer than that paint.", "Count comes twice. Be in here for it."],
    ["You hear the pipes at night? That's the whole block talking.", "Keep your door open, keep your friends closer."],
    ["Third time in this same box. Feels like home now.", "Don't touch my shelf."],
    ["They move you when they feel like it. Not before.", "Sleep light."],
  ];
  function jump(skin, hair) {
    return { legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a,
      skin: skin, hair: hair, stripes: 0xc85c00, shoes: 0x2b2b2b };
  }

  // WHO GETS A CELL. The player's own cell plus the two lowest-hashing cells
  // stand empty — an all-full wing has nowhere to hide and nowhere to be moved
  // to, and an empty cell is the thing a lockdown can put you in.
  const EMPTY_WANTED = 2;
  const order = cells.filter(function (c) { return !c.player; })
    .map(function (c) { return { c: c, h: h01(c.x, c.z, 4211) }; })
    .sort(function (a, b) { return a.h - b.h; });
  for (let i = 0; i < order.length; i++) order[i].c.vacant = i < EMPTY_WANTED;
  if (playerCell) { playerCell.vacant = true; playerCell.owner = "player"; }

  // Where in the cell an occupant lives, and what they are doing there. The
  // choice is a POSITION HASH, so the same cell always holds the same kind of
  // person — a trait, not a die re-rolled every few seconds.
  function cellPose(c) {
    const r = h01(c.x, c.z, 8123);
    return r < 0.34 ? "bars" : (r < 0.72 ? "bunk" : "pace");
  }
  function barsSpot(c) { return facePoint(c, (c.oa + c.ob) / 2, -0.85); }
  function bunkSpot(c) {
    // THE NEAR LONG EDGE OF THE BUNK — and it is always an X offset, because
    // every bunk in this wing is laid out ALONG Z (fitOutCell passes "z" for
    // both rows). The side-row branch used to offset in Z, which is offsetting
    // ALONG the mattress: the body landed 0.62 m up the bed with the frame
    // through his shins, and that is precisely the owner's "they stand
    // overlapping them". The lateral sign points INTO the room, away from the
    // wall the bunk's back is against (north/west rows +x, east row -x).
    const b = c.bunk;
    return { x: b.x + (c.dz !== 0 ? 1 : c.dx) * 0.62, z: b.z };
  }

  let cast = false;
  function dealCast() {
    if (cast || typeof CBZ.spawnJailNpc !== "function") return;
    cast = true;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.vacant || c.owner) continue;
      const pose = cellPose(c);
      const seat = pose === "bars" ? barsSpot(c) : (pose === "bunk" ? bunkSpot(c) : { x: c.x, z: c.z });
      const hh = h01(c.x, c.z, 6001);
      let n = null;
      try {
        n = CBZ.spawnJailNpc({
          pos: [seat.x, seat.z],
          region: [c.x - c.hx + 0.85, c.x + c.hx - 0.85, c.z - c.hz + 0.85, c.z + c.hz - 0.85],
          role: "inmate", speed: 1.3 + hh * 0.7, forceNeutral: true,
          behavior: pick(BEH, c.x, c.z, 6002),
          tagText: "Inmate", tagColor: "#cfe9ff",
          skin: jump(pick(SKIN, c.x, c.z, 6003), pick(HAIR, c.x, c.z, 6004)),
          data: {
            name: pick(NAMES, c.x, c.z, 6005), pool: "goods",
            cell: c.tag, talk: pick(TALK, c.x, c.z, 6006),
          },
        });
      } catch (e) { n = null; }
      if (!n) continue;
      if (n.data && !n.data.offer && CBZ.econ && CBZ.econ.pickOffer) {
        try { n.data.offer = CBZ.econ.pickOffer("goods"); } catch (e) {}
      }
      n._cellIdx = c.i; n._cellPose = pose;
      c.owner = n;
    }
  }

  /* ==========================================================
     10. THE LEASH + the door slide + the lamp mirror. One updater, and it
         runs after entities/npc.js's order-22 movement so the clamp is the
         last word on where a cell resident ended the frame.
     ========================================================== */
  const SLIDE_RATE = 4.2;
  let lampHex = -1, lampT = 0, lastElapsed = 0;

  // hand the rig back: the seated pose is HELD, so something has to release it
  function unseat(n) {
    if (n && n.char && n.char.sitting && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand");
  }

  CBZ.onUpdate(22.6, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape") return;

    // a fresh run resets state.js's clock — put every door back the way the
    // build left it so a restart cannot inherit a lockdown.
    const el = +g.elapsed || 0;
    if (el < lastElapsed - 0.5) resetDoors();
    lastElapsed = el;

    // every script tag has run by now — the bunks and stools become real
    // propuse anchors here (see flushFittings' note on the load order)
    if (!fitFlushed) flushFittings();

    if (!cast) dealCast();

    // ---- sliding leaves (only the ones actually moving cost anything) ----
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.bars) continue;
      if (c.slide !== c.slideT) {
        const step = SLIDE_RATE * dt;
        c.slide += Math.max(-step, Math.min(step, c.slideT - c.slide));
        if (Math.abs(c.slideT - c.slide) < 0.004) c.slide = c.slideT;
        placeLeaf(c);
      }
    }

    // ---- the leash. Whatever the 4995-line brain wanted, a cell resident
    //      ends the frame inside his own cell: this is what "in cell" means,
    //      and it costs one AABB clamp per occupant.
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], n = c.owner;
      if (!n || n === "player") continue;
      if (n.dead || n.escaped) { unseat(n); continue; }
      // A BODY IN ITS BUNK IS NOT A BODY TO BE CLAMPED. Once systems/
      // prisonrest.js has put a man to bed (or a propuse arc is walking him
      // to it) the transform belongs to that hold: propuse re-pins the lie
      // spot at order 42, and an AABB clamp or a target write here would be
      // two systems arguing over one Vector3 — the exact way a body vibrates
      // in place that prisonschedule.js's herd() already warns about.
      if (n._propLie || n._propBed || (CBZ.propArcActive && CBZ.propArcActive(n))) continue;
      const p = n.group.position;
      const x0 = c.x - c.hx + 0.62, x1 = c.x + c.hx - 0.62;
      const z0 = c.z - c.hz + 0.62, z1 = c.z + c.hz - 0.62;
      if (p.x < x0) p.x = x0; else if (p.x > x1) p.x = x1;
      if (p.z < z0) p.z = z0; else if (p.z > z1) p.z = z1;
      if (n.target) {
        if (n.target.x < x0) n.target.x = x0; else if (n.target.x > x1) n.target.x = x1;
        if (n.target.z < z0) n.target.z = z0; else if (n.target.z > z1) n.target.z = z1;
      }
      // A REAL BRAIN STATE OUTRANKS THE POST — the same precedence poses.js
      // documents: hands-up, a KO or a hunt owns the rig, and the held pose
      // must LET GO rather than freeze a seated body mid-fight.
      if (n.ko > 0 || n.intimidMode || n.huntPlayer > 0 || n.aiState === "fight" || n.aiState === "flee") { unseat(n); continue; }
      if (n._cellPose === "bars") {
        const s = barsSpot(c);
        n.target.set(s.x, 0, s.z);
        if (Math.abs(p.x - s.x) + Math.abs(p.z - s.z) < 0.55) {
          n.pause = Math.max(n.pause || 0, 0.5);
          n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(c.dx, c.dz), 1 - Math.pow(0.02, dt));
        }
      } else if (n._cellPose === "bunk") {
        const s = bunkSpot(c);
        p.x = s.x; p.z = s.z;
        n.target.set(s.x, 0, s.z);
        n.pause = Math.max(n.pause || 0, 0.6);
        n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(c.dx, c.dz), 1 - Math.pow(0.02, dt));
        if (n.char && CBZ.setCharPose) {
          n.char.seatRef = n.char.seatRef || { cushion: c.bunk.top, floorBelow: 0 };
          CBZ.setCharPose(n.char, "sit");
        }
      }
    }

    // ---- lamp mirror: interactions.js's breaker only knows about
    //      CBZ.ceilingLamp, so the rest of the wing follows it. Polled at
    //      4 Hz and written only on a change.
    lampT -= dt;
    if (lampT <= 0) {
      lampT = 0.25;
      const hex = ceilingLamp.material.emissive.getHex();
      if (hex !== lampHex) {
        lampHex = hex;
        const col = ceilingLamp.material.color.getHex();
        const dark = hex === 0;
        for (let i = 0; i < lamps.length; i++) {
          const m = lamps[i].material;
          const isStrip = lamps[i].geometry && lamps[i].geometry.parameters && lamps[i].geometry.parameters.height < 0.12;
          m.color.setHex(dark ? 0x2b2b2b : (isStrip ? 0xfff3cf : col));
          m.emissive.setHex(dark ? 0x000000 : (isStrip ? 0xffd98a : 0xffcf66));
        }
      }
    }
  });

  /* ==========================================================
     11. THE CONTRACT. systems/capture.js and systems/lockdown.js drive
         the wing through this and nothing else.
     ========================================================== */
  function cellAt(x, z, pad) {
    pad = pad || 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (x >= c.x - c.hx - pad && x <= c.x + c.hx + pad && z >= c.z - c.hz - pad && z <= c.z + c.hz + pad) return c;
    }
    return null;
  }
  function lockAll(locked) {
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (setDoor(cells[i], locked)) n++;
    return n;
  }
  // "which cell can I put somebody in" — the question a transfer, a lockdown or
  // a fresh sentence actually asks. Nearest empty cell that is not the player's.
  function freeCell(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.player || (c.owner && c.owner !== "player")) continue;
      const d = x == null ? c.i : (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function resetDoors() { return lockAll(false); }
  function assign(npc, which) {
    const c = typeof which === "number" ? cells[which] : which;
    if (!c || !npc) return false;
    if (c.owner && c.owner !== npc && c.owner !== "player") c.owner._cellIdx = -1;
    c.owner = npc; c.vacant = false;
    if (npc !== "player") {
      npc._cellIdx = c.i;
      if (!npc._cellPose) npc._cellPose = cellPose(c);
      if (npc.region) { npc.region[0] = c.x - c.hx + 0.85; npc.region[1] = c.x + c.hx - 0.85; npc.region[2] = c.z - c.hz + 0.85; npc.region[3] = c.z + c.hz - 0.85; }
      if (npc.group) npc.group.position.set(c.x, npc.group.position.y || 0, c.z);
    }
    return true;
  }
  function playerSpawn() {
    const s = CBZ.SPAWN;
    const c = playerCell;
    if (c && s && s.x >= c.x - c.hx + 0.6 && s.x <= c.x + c.hx - 0.6 && s.z >= c.z - c.hz + 0.6 && s.z <= c.z + c.hz - 0.6)
      return { x: s.x, z: s.z };
    return c ? { x: c.x, z: c.z } : { x: s.x, z: s.z };
  }

  CBZ.cellblock = {
    v2: true,
    cells: cells,
    playerCell: playerCell,
    setDoor: setDoor,
    assign: assign,
    cellAt: cellAt,
    freeCell: freeCell,
    lockAll: lockAll,
    resetDoors: resetDoors,
    playerSpawn: playerSpawn,
    // geometry other systems may want without re-deriving it
    height: CH, doorWidth: DOOR_W,
    bounds: { minX: IX0, maxX: IX1, minZ: IZN, maxZ: -7.5 },
  };

  /* ==========================================================
     WHAT THIS PRISON CAN SLEEP — counted from actual mattresses.

     The named playable cast is the population to house. Treating a 26-bed
     cell wing as permission to scatter sixteen permanent floor mats through
     its dayroom made the arithmetic pass and the venue fail. The compound now
     has two authored housing units: these thirteen double cells and the
     south-block open-bay dorm. Both call the same bunk builder above; both
     publish the records they actually draw; every population/rest consumer
     reads their sum.

     Design occupancy is therefore 1.0 here. Overcrowding can still be a live
     simulation fact (the audit reports bodies minus beds), but it is no longer
     used as a content generator that adds people or bedding to circulation.
     ========================================================== */
  const OCCUPANCY = 1.0;
  function cellRackCount() {
    let n = 0;
    for (let i = 0; i < cells.length; i++) {
      const b = cells[i].bunk;
      if (!b) continue;
      n += b.topBunk ? 2 : 1;
    }
    return n;
  }
  function rackCount() {
    let n = cellRackCount();
    for (let i = 0; i < housingStacks.length; i++) {
      const b = housingStacks[i] && housingStacks[i].bunk;
      if (b) n += b.topBunk ? 2 : 1;
    }
    return n;
  }
  CBZ.prisonBeds = function () {
    const beds = rackCount();
    const cellBeds = cellRackCount();
    return { cells: cells.length, perCell: cells.length ? +(cellBeds / cells.length).toFixed(2) : 0,
      beds: beds, racks: beds, housingStacks: housingStacks.length,
      occupancy: OCCUPANCY, houses: Math.round(beds * OCCUPANCY) };
  };

  /* ==========================================================
     12. THE RATCHET. Numbers, not screenshots. Everything here is a hard
         invariant of THIS file's own colliders, so a regression cannot be
         blamed on world/door.js or the yard.
           spawnBlocked  — colliders the player capsule overlaps at
                           CBZ.SPAWN. MUST be 0 or the game cannot start.
           spawnInPlayerCell / spawnMargin — the owner's actual ask.
           doorGapBlocked / spineBlocked — the south throat x[-3,3]@z=-8 and
                           the guard patrol lane x=0, z[-40,-12]. MUST be 0.
     ========================================================== */
  CBZ.cellblockAudit = function () {
    const R = 0.55;                       // physics.js player radius
    const s = CBZ.SPAWN;
    // spawnBlocked sweeps EVERY live collider, not just ours: "the player can
    // stand where the game puts him" is an invariant of the world, and it does
    // not care which file produced the wall.
    let spawnBlocked = 0, gap = 0, spine = 0;
    const all = CBZ.colliders || [];
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (s.x > c.minX - R && s.x < c.maxX + R && s.z > c.minZ - R && s.z < c.maxZ + R) spawnBlocked++;
    }
    // the two LANES are ours to answer for, so they are measured over our own
    // records — world/door.js's red door legitimately fills the south gap.
    for (let i = 0; i < mine.length; i++) {
      const c = mine[i];
      if (all.indexOf(c) < 0) continue;                           // an open door is not a wall
      if (c.minX < 3.2 && c.maxX > -3.2 && c.minZ < -6.5 && c.maxZ > -9.5) gap++;
      if (c.minX < R && c.maxX > -R && c.minZ < -12 && c.maxZ > -40) spine++;
    }
    let occupied = 0, empty = 0, locked = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.locked) locked++;
      if (c.owner && c.owner !== "player") occupied++; else empty++;
    }
    const pc = playerCell;
    const margin = pc ? Math.min(pc.hx - Math.abs(s.x - pc.x), pc.hz - Math.abs(s.z - pc.z)) : 0;
    return {
      v2: true, cells: cells.length, occupied: occupied, empty: empty, locked: locked,
      castDealt: cast,
      spawnInPlayerCell: !!(pc && margin > 0),
      spawnMargin: Math.round(margin * 100) / 100,          // metres of cell around CBZ.SPAWN
      spawnBlocked: spawnBlocked,                            // MUST be 0
      doorGapBlocked: gap,                                   // MUST be 0
      spineBlocked: spine,                                   // MUST be 0
      colliders: mine.length,
      lamps: lamps.length + 1,
    };
  };
})();
