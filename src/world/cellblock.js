/* ============================================================
   world/cellblock.js — THE CELL WING. Not set dressing: a real two-tier
   cell house — 28 cells in three rows on two storeys, a railed gallery and
   two stairs — with sliding barred doors on real colliders and inmates
   living inside them.

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
       spine are left completely clear. That USED to read "nothing this file
       builds sits at |x| < 11.7 south of z = -38" — which was a statement
       about the 23.4 m of empty aisle rows D and E now stand in. The live
       statement is the CENTRE HALL x[-4.1,4.1], and NOTHING this file builds
       stands in it — the two bolted day tables that used to sit at |x| = 2.6
       are gone (see section 7). The nearest fitting is the officer desk at
       z = -42.6, north of the rows.
       CBZ.cellblockAudit().spineBlocked measures the x[-0.55,0.55] patrol
       lane over this file's own colliders and is pinned at 0.

   ------------------------------------------------------------------
   EVERY MAN HAS A BED (PRISON_CELL_ROWS_V3).

   OWNER, 2026-08-15 (verbatim): "Scale the number of cells so every single
   NPC has a bed."

   MEASURED on bfaccbd, live escape run, at the night block: the compound
   carried 50 prisoner rigs against 42 registered mattresses — 26 here (13
   doubles) and 16 in world/southblock.js's dorm. Eight men were walked
   indoors by systems/prisonschedule.js's muster every night with nowhere to
   lie down. `CBZ.prisonRestAudit().sleepGap` did not say so: it counted
   `role === "inmate"` and read 0, because 8 of the 50 carry a TRADE in that
   field ("thief" x5, "merchant" x2, "dealer" x1) while being the same body
   out of the same factory — entities/npc.js:26 stamps `kind: "inmate"` on
   every one of them. A bed is owed to a man and not to his trade, so
   systems/prisonrest.js's predicate was widened to the whole factory in this
   same change and the honest gap is what this file is now sized against.

   WHY ELEVEN MORE CELLS AND NOT EIGHT. A cell is not +2 beds. This file
   deals a resident into every non-vacant cell, so a cell is +2 racks and +1
   body — +1 NET PLACE. entities/npc.js:547 then sizes its anonymous tier as
   `houses - npcs.length - cells`, which turns positive past 24 cells and
   takes a place straight back. 13 -> 24 cells is therefore 42 -> 64 beds
   against 50 -> 59 men, and sleepGap +8 -> -5.

   WHERE THE ELEVEN WENT, AND WHY NOWHERE ELSE. Both ends of the shell are
   spoken for: the north row is shower / A-1..A-4 / officer post / store with
   the post pinned by guards.js's waypoint, and the side rows are pinned at
   the top by the cross-aisle escape_routes.js's ceiling hatch sits in. What
   the wing had instead was a 23.4 m AISLE — cells only 3.8 m deep against
   each side wall and absolutely nothing between them. A 23 m corridor is not
   a cell house, it is a hangar. So the wasted floor becomes what a real
   double cell house puts there: a second PAIR of rows, D and E, backs to the
   galleries and barred fronts onto the centre hall. And the WEST row finally
   runs the last 4.5 m south to the day-room end it always stopped short of
   (B-5) — the east row cannot, because the keycard duty post stands on that
   floor; see the segment table. Three parallel runs come out of it — two 3.5 m galleries in
   front of the outer cells, an 8.2 m centre hall with cell fronts down both
   sides, and the patrol spine straight down the middle of that.

   NOT ONE EXISTING PRISON COORDINATE MOVES. The discipline is world/
   prisonwings.js's header, applied here. The shell is byte-for-byte what it
   was; every number in NORTH_ROW, WEST_ROW and EAST_ROW is untouched, and the
   two new side segments are APPENDED past the old ends so that no running
   total is ever retyped. tools/prison-beds-check.mjs asserts it from a live
   run rather than from this comment: CBZ.SPAWN (-11,-39) still on A-1's
   centre-line 1.0 m north of its own door with spawnBlocked 0, the
   ventilation crawl (-14.2,-31) and the officer-post waypoint (0,-39) still
   outside every cell, the utility crawl (-12.2,-38.2) still inside A-1, the
   ceiling hatch (11.6,-36.4) still in the cross-aisle, doorGapBlocked and
   spineBlocked still 0.

   THE ONE THING THAT DID MOVE IS THIS FILE'S OWN. The two |x| = 7.5 cage
   lamps are inside row E now, so they become four gallery lamps at |x| = 9.9.
   (The two day tables were the other one — they were shuffled 6.6 -> 2.6 by
   the same collision and are now deleted outright; section 7 says why.)

   REVERT: CBZ.CONFIG.PRISON_CELL_ROWS_V3 = false (or ?cfg_PRISON_CELL_ROWS_V3=0)
   restores the 13-cell wing exactly — D and E are not built, B-5 is not
   appended, and the lamps go back to 7.5.

   DRAW-CALL BUDGET. Partitions carry colliders + LOS refs, so core/batch.js
   spares them (~20 draw calls, unavoidable — they are walls). Everything
   else is arranged so it MERGES: fixed grille bars, bunks, toilets, roofs
   and fittings are plain meshes with empty userData and go into the static
   batch. Only the 25 SLIDING DOOR LEAVES stay live (userData.dynamic keeps
   both core/batch.js and core/staticfreeze.js off them), and each leaf is
   ONE merged BufferGeometry, not eleven bars.

   DETERMINISM. This is a world-build path: every varied choice (which
   cells stand empty, which inmate does what, blanket colours, personal
   effects) comes off CBZ.hash01 of the cell's own coordinates. No
   Math.random, no shared rng stream.

   REVERT: CBZ.CONFIG.PRISON_CELLS_V2 = false (or ?cfg_PRISON_CELLS_V2=0)
   restores the original 59-line dressing byte for byte, and CBZ.cellblock
   degrades to a null-safe stub whose playerSpawn() falls back to CBZ.SPAWN.

   ------------------------------------------------------------------
   THE TIER (2026-09-04). OWNER, with a photograph of a real cell house —
   cells stacked two high along the long walls, a steel gallery with a rail
   in front of the upper row, an open stair at the end of it, one big
   concrete floor, pendant lamps on stems off a trussed roof: "LOOK HOW THIS
   JAIL LOOKS. Our cells are not laid out in a realistic way and our cell
   room has floating shit like the desk the keycard is on and some lights.
   The jail room just needs improvement overall."

   WHAT WAS WRONG, MEASURED (tools/visual-presets/prison-tier.mjs, HEAD):
     · 24 cells on ONE storey under a 9 m lid. Rows D and E (the 2026-08-15
       bed fix) stood as two 21 m concrete blocks in the middle of the hall,
       3.6 m tall with 5.4 m of air over them — a hangar with sheds in it, the
       exact opposite of the photograph, where the middle is the one thing
       that is EMPTY and the cells are what is stacked.
     · Seven cage lamps hung at y 8.2 with nothing between their caps and the
       lid at 9.0: fittings in mid-air. The roofs.js strips at 8.05, likewise.
     · The duty desk really was floating — its legs and drawers were baked at
       the world origin by core/batch.js (the hidden-root matrix trap, fixed
       in that file the same day). Not this file's bug; it is in this preset
       so the fix is photographed.

   WHAT IS HERE NOW. Rows D and E are gone. The bed capacity they carried
   goes UP instead: a second storey of cells over rows A, B and C, drawn by
   the SAME builders through one file-wide `LIFT` (see addBox below) so an
   upper cell is a ground cell with 3.9 added to every y — same bunk, same
   toilet, same grille, same sliding leaf on a banded collider. A 1.35 m
   steel gallery cantilevers off the cell fronts at FY with a rail, the two
   side galleries meet the north one at the corners, and an open stair rises
   along the south wall at each end onto the gallery — real CBZ.platforms
   ramp/landing records, so the player climbs it with the physics he already
   has. The lid gets four lattice trusses and every lamp hangs off a chord.

   THE TOP TIER IS A LOCKDOWN TIER, AND THAT IS A STATED LIMIT, NOT A CHOICE
   ABOUT PRISONS. systems/navgrid.js is ONE grid at ground height (it skips
   colliders above HEAD, which is right for the men it was built for). A
   free upper resident would be pathed straight through the gallery rail
   toward the hall, pinned on it by actorcollide, and spend the day walking
   into a rail — the treadmill "THE DOOR DECIDES" below just removed. So an
   upper leaf never unlocks: setDoor refuses, the interaction says why, the
   residents up there live behind their bars (they are `held`, so the
   schedule never musters them and prisonrest gives each his own rack), and
   freeCell never offers a transfer a cell it cannot walk to. Lift it by
   giving the navigator a second layer, not by unlocking the doors.

   Every pinned coordinate in the header above still holds — the ground rows
   are byte-for-byte the same tables — and tools/prison-beds-check.mjs still
   asserts them from a live run.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { COL, DIM } = CBZ;
  /* ONE LIFT FOR THE WHOLE FILE. Every helper below places geometry against
     a floor at y = 0 — bunk tops, toilet bands, door colliders, lamp heights,
     all typed for the ground. The upper tier is the same cells drawn FY
     higher, so rather than thread a floor height through forty signatures
     the file's own addBox adds `LIFT` to y (and to a solid's y0/y1 band) and
     the tier builder sets it for the duration of one cell. Zero on the
     ground floor: byte-identical to bare CBZ.addBox. */
  const addBox0 = CBZ.addBox;
  let LIFT = 0;
  function addBox(x, y, z, w, hgt, d, color, opts) {
    if (LIFT && opts && (opts.y0 != null || opts.y1 != null)) {
      const o = {};
      for (const k in opts) o[k] = opts[k];
      if (o.y0 != null) o.y0 += LIFT;
      if (o.y1 != null) o.y1 += LIFT;
      opts = o;
    }
    return addBox0(x, y + LIFT, z, w, hgt, d, color, opts);
  }
  const { WALL, TRIM } = COL;
  const WH = DIM.WH;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  const root = CBZ.prisonRoot || CBZ.scene;

  // ONE-LINE REVERT. config.js's generic ?cfg_ sweep runs before this file,
  // so a URL override already sits in CONFIG and this guard leaves it alone.
  if (CFG.PRISON_CELLS_V2 == null) CFG.PRISON_CELLS_V2 = true;
  // The two halves of "a man sits ON his bunk": where his hips go (the pose,
  // see bunkSpot) and whether there is room for his head when they get there
  // (the geometry, see bunkRig). Declared together and up here because the
  // rack is BUILT at parse time — a default written further down the file
  // would arrive after the bunk it governs.
  if (CFG.PRISON_BUNK_PERCH == null) CFG.PRISON_BUNK_PERCH = true;
  if (CFG.PRISON_BUNK_HEADROOM == null) CFG.PRISON_BUNK_HEADROOM = true;

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
      return { v2: false, rows3: false, cells: 0, rows: {}, occupied: 0, empty: 0, locked: 0,
        vacantWanted: 0, spawnInPlayerCell: false, spawnMargin: 0, spawnBlocked: 0,
        doorGapBlocked: 0, spineBlocked: 0, colliders: 0 };
    };
  }

  if (!CFG.PRISON_CELLS_V2) { buildLegacy(); return; }

  /* ==========================================================
     PRISON_PROP_HONESTY_V1 — THE ONE-LINE REVERT FOR THE 2026-08-15 PROP PASS.

     OWNER: "there's chairs and tables that are real, but then there's … rooms
     that have, like, random blocks, just very stupid stuff. I don't like
     stupid details. Just leave an empty room if you want, or find a way to
     make it used."

     The rule this flag turns on: EVERY PROP IS EITHER USABLE OR IT GOES.
     Usable means at least one of — a collider (you are stopped by it or take
     cover behind it), a propuse seat or bed anchor, it holds a placed item,
     it is a door/lock/breach target, or it is a light fitting. Deck paint and
     signage (~2-5 cm surface graphics) are NOT props and are untouched.

     Declared HERE because this file parses first of the four that read it
     (index.html:499, then gunroom 568, adminwing 599, prisonwings 614), using
     the idempotent `== null` idiom world/southblock.js documents. Set it false
     and all four fall back to the geometry and the physics they shipped with.

     Ratchets it must not move: CBZ.cellblockAudit().spawnBlocked 0,
     doorGapBlocked 0, spineBlocked 0; tools/prison-doors-check.mjs 24/24;
     tools/prison-beds-check.mjs sleepGap <= 0 and bunkStanders 0.
     Measured by tools/visual-presets/prison-wing-props.mjs.
     ========================================================== */
  if (CFG.PRISON_PROP_HONESTY_V1 == null) CFG.PRISON_PROP_HONESTY_V1 = true;
  const HONEST = CFG.PRISON_PROP_HONESTY_V1 !== false;

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

  /* ---- THE TIER. The upper storey's floor is the ground cells' own roof
     slab (CH + RT), so nothing is typed twice: raise CH and the tier rises.
     The gallery is a steel deck GW wide cantilevered off the cell fronts, the
     rail RAIL_H over it; the stairs are STAIR_W wide against the south wall.
     The hall between the two galleries is what the photograph has in the
     middle: nothing.                                                      */
  const FY = CH + RT;                   //  3.90 : upper tier floor
  const GW = 1.35;                      // gallery deck, out from the cell fronts
  const GDECK = 0.14;                   // gallery deck thickness
  const RAIL_H = 1.05;                  // rail over the deck
  const STAIR_W = 1.20;
  const STAIR_X0 = 4.0;                 // |x| where each flight leaves the floor (door gap is |x| < 3)
  const SZ0 = -9.95, SZ1 = -8.75;       // the flights' z band, along the south wall

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
     returns its own mattress top, and the shower bench and the cell stool
     already know where a body would sit on them.

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
          // WHAT IS OVER THIS BED. Only the LOWER rack of a stack has a
          // ceiling, and it is the thing that decides whether a body sitting
          // on the edge can hold its head up (entities/character.js reads it
          // through seatRef.ceiling). Same frame as the anchor's own floor,
          // which for both racks in this wing is y=0.
          const bnk = j.own.bunk;
          if (j.slot === "bed" && bnk && bnk.rackUnder != null) rec.ceiling = bnk.rackUnder;
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

  /* A SOLID BOX MUST DECLARE HOW TALL IT IS. (OWNER: "as if there's an
     invisible wall.")

     world/materials.js:205 pushes a collider with no y0/y1 unless the caller
     hands it one, and systems/physics.js's contract is that a band-less
     collider blocks at EVERY height. So a `{ solid: true }` box drawn 10 cm
     thick at knee height registers as a column of solid air from the floor to
     the ceiling — invisible to the eye, invisible to tools/ghost-collider-
     check.mjs (which measures FOOTPRINT, and the footprint is honestly drawn),
     and visible only when something else reads the ledger and believes it.
     systems/gore.js's wall-splat scan is that something else: it found a
     wall-sized opaque face and painted a floor-to-head blood plane down the
     side of a day table, which is how the owner found this at all.

     `solidTo(y, hgt)` is that declaration, and it takes the SAME two numbers
     the addBox/sbox call beside it already takes, so the band cannot drift
     from the mesh the way a typed 0.79 would. It bands floor-up rather than to
     the box's literal extent, because that is what this wing's furniture IS —
     a shower bench is a plinth, not a plank floating at 0.42 with walkable air
     underneath, and a rack shelf has a rack under it.

     Pass it to every solid this file places that is SHORTER THAN A WALL.
     Structure (partitions, the shell, the grille) keeps its full-height
     collider: those boxes ARE their own height, and writing the band by hand
     there would just be a second, driftable copy of CH. `on` carries the
     caller's own solid gate through (the duty chair is solid only under
     HONEST) so a flag-gated prop does not need a second spelling. */
  function solidTo(y, hgt, on) { return { solid: on == null ? true : on, y0: 0, y1: y + hgt / 2 }; }

  // Every collider this file pushes, kept so CBZ.cellblockAudit() can judge
  // OUR work and never blame world/door.js or the yard for a blocked lane.
  const mine = [];
  function solid(minX, minZ, maxX, maxZ, y0, y1) {
    const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
      y0: (y0 == null ? 0 : y0) + LIFT, y1: (y1 == null ? CH : y1) + LIFT };
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

  /* B-5 IS APPENDED, NEVER RETYPED. The west row stopped at z = -14.00 with
     the south wall's inner face still 5.5 m away at -8.5 — floor the wing had
     never used. One more 3.80 cell and its 0.34 partition spend 4.14 of it.
     Only the new segments are written here, so nothing above is re-derived
     and no existing running total can drift:
        west   -14.00 +3.80 = -10.20 +0.34 = -9.86   (1.36 clear of -8.5)

     THE EAST ROW GETS NO C-6, AND THE REASON IS THE WHOLE GAME. That floor
     is NOT unused: entities/keycard.js:111 stands THE DUTY POST there — the
     guard's desk the KEYCARD rests on, a 1.90 x 0.95 steel top at
     (13.9, -11.50) with its drawer bank, its lamp and the card itself. Its
     own comment states why that corner: "clear of the bunks, the toilet
     block and the cell bars". A C-6 spanning -13.80..-10.00 puts the card
     the entire escape is built around INSIDE a cell, with the desk across
     the cell's centre — measured, C-6 was the one cell in the wing whose
     centre a 0.38 m body could not stand in, and it is the fault
     prison-polish-check's walkable-lane sweep was reporting.

     "Empty floor" in this wing means empty of CELL FURNITURE, never empty of
     purpose. Checking the four coordinates the header lists is not the same
     as checking the floor, and this one was not on that list. It is now:
     the gate below asserts no cell contains the duty post. The west side has
     no such tenant, so B-5 stands and the wing sleeps 64. */
  WEST_ROW.push({ kind: "cell", a: -14.00, b: -10.20, tag: "B-5" },
    { kind: "wall", a: -10.20, b: -9.86 });

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
    g.translate(x, y + LIFT, z);
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
    const col = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: LIFT, y1: CH + LIFT };
    mine.push(col);
    return col;
  }

  /* ---------- cell fittings. NON-SOLID on purpose: a 3.8 m cell holding a
       0.55-radius player plus a 0.5-radius inmate cannot also carry a solid
       bunk and a solid toilet and stay walkable. What is SOLID in this wing
       is the STRUCTURE (partitions, grille, door) — the same call
       city/arena_venue.js made about its seat banks, for the same reason. */
  /* ---------- HOW HIGH THE TOP RACK SITS. It is a solved number, not a taste.

     OWNER: "the bunk beds should be much taller." He is right, and the cell
     itself says by how much. Four measurements, all of them already in this
     repo, box the answer in:

       LOW_TOP  0.79  lower mattress top          (drawn below; the propuse
                      anchor and the lying-body solve are both pinned to it)
       DECK_T   0.41  upper frame underside -> upper mattress top (0.28 frame
                      + 0.18 mattress, less the 0.05 they overlap)
       CH       3.60  cell interior height, floor -> roof slab (line 187)
       SIT_UP   0.95  seated vertex above the surface you are sitting on.
                      Derived from this engine's own body, not a catalogue:
                      systems/fpsmode.js puts the standing eye at 1.65, so
                      stature ~= 1.65/0.936 = 1.76 m, and erect sitting height
                      is ~0.52 of stature = 0.92 m. 0.95 carries the 95th
                      percentile.

     WHAT WAS WRONG WITH 1.97. Two clearances, and they were absurdly lopsided:

       bottom man:  1.56 (old deck underside) - 0.79 = 0.77 m  -> 0.18 SHORT of
                    sitting up. You could not sit on your own bed.
       top man:     3.60 - 1.97                     = 1.63 m  -> an entire
                    standing person of dead air (the engine's standing eye is
                    1.65) doing nothing above the top rack.

     THE SOLVE — give both men the same room, because neither has any claim on
     the other's air. With T the upper mattress top:

       bottom clearance  c1 = (T - DECK_T) - LOW_TOP = T - 1.20
       top clearance     c2 = CH - T                 = 3.60 - T
       c1 = c2   ->   2T = LOW_TOP + DECK_T + CH = 4.80   ->   T = 2.40

     T = 2.40 m, and c1 = c2 = 1.20 m — 0.25 m of slack over SIT_UP for each.
     Feasible band was T in [2.15, 2.65] (2.15 = the bottom man can just sit
     up, 2.65 = the top man can just sit up); 2.40 is its midpoint, which is
     what "equal clearance" means when the two constraints are symmetric.

     THREE CHECKS IT ALSO PASSES, none of which drove it:
       · deck underside 1.99 > stature 1.76 — a standing body now clears the
         upper rack instead of having the camera clip through it at 1.56.
       · rail head 2.74 < CH 3.60, so nothing touches the roof slab.
       · 2.40 / STEP_UP(0.45, systems/physics.js) = 5.33 -> 6 steps of 0.40,
         which is what the ladder below is rebuilt to. The old ladder's first
         rung was at 1.05 — chest height, reachable by nobody.

     Net: +0.43 m on the top mattress (1.97 -> 2.40, +22%), +0.43 on the
     silhouette (2.31 -> 2.74, +19%), and +56% on the clearance that was
     actually broken (0.77 -> 1.20). One stack, one number, every consumer
     (cells here, south-block dorm via CBZ.prisonBunk) reads it off the rig. */
  /* SIT_CROWN IS MEASURED, NOT ESTIMATED, and that is the whole correction.
     An earlier pass here derived the seated head from anthropometry (0.52 of
     stature) and got 0.95. entities/character.js will simply TELL you:
     charSeatMetrics(ch) returns hipPad and topOverHip, and the seat solve is
     hip = max(cushion + hipPad, hipFloor), so

       crown above the cushion = hipPad + topOverHip = 0.070 + 1.071 = 1.141

     …and the drawn rig's bounding box tops out 0.035 higher than the head box
     (hair), measured 1.966 for a body seated on a 0.79 mattress. So 1.18, and
     it is the SAME for every rig in the world — humanScale is 0.70 across all
     50 of them, so this is not a mean, it is the number.

     0.95 was 0.23 short, which is why the bottom man's head went through the
     deck at 0.77 of clearance AND why raising the top rack alone did not fix
     it: 1.20 of clearance clears a 1.18 crown by 20 mm, i.e. not at all. */
  const SIT_CROWN = 1.18;               // measured; see tools/prison-polish-check.mjs
  const HEAD_AIR = 0.14;                // a hand's width of air over the crown
  const BERTH = SIT_CROWN + HEAD_AIR;   // 1.32 — what ONE sleeper needs to sit up
  const DECK_T = 0.34;                  // frame 0.20 + mattress 0.18 - 0.04 overlap
  const STEP_UP = 0.45;                 // systems/physics.js

  /* THE STACK IS A CHAIN, NOT AN OPTIMISATION. A cell is CH tall and holds two
     men who each need BERTH, with one deck between them and one under the
     bottom man. That is the whole budget and it closes exactly:

       CH  =  LOW_TOP + BERTH + DECK_T + BERTH
       3.60 = 0.620   + 1.320 + 0.340  + 1.320                    ✓

     so, top down:
       UP_TOP  = CH     - BERTH  = 2.28     upper mattress
       DECK_Y  = UP_TOP - DECK_T = 1.94     upper deck underside
       LOW_TOP = DECK_Y - BERTH  = 0.62     lower mattress

     WHY 2.28 AND NOT THE 2.40 THIS FILE SHIPPED FOR ONE COMMIT. 2.40 came from
     equalising the two clearances while holding LOW_TOP at 0.79 and DECK_T at
     0.41. Equalising was right; the two constants it held were not. c1 + c2 is
     fixed at CH - LOW_TOP - DECK_T, so with 0.79 and 0.41 the BEST either man
     can get is 1.20 — below the measured 1.18 + air. The cell cannot seat two
     men who can both sit up until those two numbers move, and 2.40 bought the
     bottom man his 20 mm by taking the top man down to the same 20 mm.

     So the two numbers that were never derived from anything move instead:
       · 0.79 -> 0.62 lower mattress. 0.79 is a high bed by any standard and the
         shared kit (city/furniture.js) has always used 0.55; 0.62 still clears
         a footlocker under the bottom rack.
       · 0.41 -> 0.34 deck. A prison bunk deck is pressed steel, not a timber
         box beam; 0.28 of frame was drawn thickness, not structure.

     UP_TOP = 2.28 is therefore a CEILING, not a preference: any higher and the
     top man's head is in the roof slab. If this wing ever gets a taller cell,
     raise CH and every number below follows it. */
  const UP_TOP = CH - BERTH;            // 2.28
  const DECK_Y = UP_TOP - DECK_T;       // 1.94 — the underside a seated man clears
  const LOW_TOP = DECK_Y - BERTH;       // 0.62
  const RAIL_TOP = UP_TOP + 0.34;       // 2.62

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
    // `bb` is sbox-aware now (see sbox's note: a structural box that skips the
    // ledger makes CBZ.cellblockAudit() measure half the wing) — the two bunk
    // frames are the first boxes in this rig that carry a collider at all.
    function bb(lat, y, lon, wLat, h, wLon, col, o) {
      const m = addBox(x + (AZ ? lat : lon), y, z + (AZ ? lon : lat),
        AZ ? wLat : wLon, h, AZ ? wLon : wLat, col, o || { cast: false });
      if (o && o.solid && m && m.userData && m.userData.collider) mine.push(m.userData.collider);
      return m;
    }
    // 1.25 was a generous bed. It is also now a SOLID one, and CBZ.SPAWN sits on
    // the player cell's centre-line 1.20 m off the bunk's: at LAT 1.25 the frame
    // reached to within 25 mm of the audit's 0.55 sweep around the spawn, which
    // is not a margin, it is a coincidence. 1.12 is a real prison mattress (0.96
    // sleeping surface) and buys 90 mm at that radius, 260 mm at the player's
    // actual 0.38 (config.js:196).
    const LAT = 1.12, LON = 2.60, MLAT = 0.96, MLON = 2.35;

    /* ONE RACK, DRAWN TWICE. The two berths used to be two blocks of literals
       that happened to agree; the deck thickness the solve above depends on was
       therefore a claim about code rather than a property of it. Written once,
       against its own mattress top `M`, DECK_T is structural: frame top sits
       0.14 under the mattress top and the frame is 0.20 deep, so the underside
       is exactly M - DECK_T and the solve cannot silently stop being true.
       `solidY0` makes the frame a real obstacle (see the collider note below). */
    function rack(M, solidY0) {
      bb(0, M - 0.24, 0, LAT, 0.20, LON, C_BUNK,                         // frame → M-0.34..M-0.14
        { cast: true, solid: true, y0: solidY0, y1: M - 0.14 });
      bb(0, M - 0.09, 0, MLAT, 0.18, MLON, C_MATT);                      // mattress → M
      if (DET) {
        // a TUCKED SHEET: a thin lip of linen overhanging the frame all round.
        // It is the line that separates "mattress" from "slab on a shelf".
        bb(0, M - 0.175, 0, MLAT + 0.10, 0.09, MLON + 0.08, C_MATT);
        bb(0, M - 0.20, LON / 2 - 0.05, LAT, 0.14, 0.10, C_DARK);        // foot rail
      }
      bb(0, M + 0.01, 0.55, MLAT * 0.94, 0.10, 1.30, blanket);           // blanket over the legs
      if (DET) bb(0, M + 0.03, -0.09, MLAT * 0.96, 0.12, 0.18, C_MATT);  // TURNED-DOWN fold
      bb(0, M + 0.03, -1.00, 0.90, 0.16, 0.42, 0xe6e9ed);                // pillow
    }

    /* THE COLLIDERS, and why they arrive now. This file's fittings were all
       non-solid on the stated grounds that "a 3.8 m cell holding a 0.55-radius
       player plus a 0.5-radius inmate cannot also carry a solid bunk and stay
       walkable". The premise was wrong twice: config.js:196 puts the player at
       0.38, and the bunk is 1.25 of a 3.80 cell laid against a wall, so the
       walk lane is 2.55 — six player-widths. What the doctrine actually bought
       was a bed you walk through, which is the owner's "that shouldn't be able
       to overlap" in its most literal form.

       Solid: the two FRAMES only, [0, frame top] below and [DECK_Y, UP_TOP]
       above. The upper slab sits at 1.94, clear over a 1.76 stature, so it can
       never block a walking body — it exists so nothing passes THROUGH the deck.
       Bedding, pillow, rail, ladder and posts stay non-solid: they are 0.07-thick
       boxes at head height and a collider on any of them is a snag, not a bed.
       The leash in §10 is widened off `latOut` below so a cell resident is never
       clamped INTO the frame it now has. */
    rack(LOW_TOP, 0);
    // FOUR corner legs, not the two diagonal ones this used to draw (a bunk
    // resting on opposite corners is a thing the eye reads as broken).
    for (const a of [-1, 1]) for (const b2 of [-1, 1]) {
      if (!DET && a !== b2) continue;
      bb(a * 0.55, 0.14, b2 * 1.25, 0.12, 0.28, 0.12, C_DARK);
    }
    if (dbl) {
      rack(UP_TOP, DECK_Y);
      if (DET) {
        // GUARD RAIL down the open side + the ladder at the foot: the two
        // fittings that say "somebody sleeps up there" rather than "shelf".
        bb(LAT / 2 - 0.06, RAIL_TOP - 0.15, 0.30, 0.08, 0.30, 1.60, C_DARK);
        // A REAL FLIGHT, not two rungs starting at chest height. The rise is
        // pinned to systems/physics.js's STEP_UP — the tallest riser a body in
        // this engine takes in one step — so the count follows the height
        // instead of being a literal: ceil(2.28/0.45) = 6 steps of 0.38, the
        // sixth of which is the deck itself. Stiles carry them, because five
        // rungs hanging off nothing is not a ladder. Outboard of the lower foot
        // rail (which ends at LON/2 - 0.05 + 0.05) so the two never z-fight.
        const RUNGS = Math.max(2, Math.ceil(UP_TOP / STEP_UP));
        const LADZ = LON / 2 + 0.05;
        for (let r = 1; r < RUNGS; r++)
          bb(0, (UP_TOP / RUNGS) * r, LADZ, 0.60, 0.07, 0.07, C_DARK);
        for (const a of [-1, 1]) bb(a * 0.28, UP_TOP / 2, LADZ, 0.07, UP_TOP, 0.07, C_DARK);
      }
      // FOUR corner posts, carried from the lower frame's underside all the way
      // to the rail head. The old pair stopped at 1.75 and stood on opposite
      // DIAGONAL corners — the same "the eye reads it as broken" fault the legs
      // above were fixed for, and at this height a rail resting on nothing is
      // the first thing you would notice.
      const PY0 = LOW_TOP - 0.34, PH = RAIL_TOP - PY0;
      for (const a of [-1, 1]) for (const b2 of [-1, 1]) {
        if (!DET && a !== b2) continue;
        bb(a * 0.60, PY0 + PH / 2, b2 * 1.28, 0.10, PH, 0.10, C_DARK);
      }
    }
    /* WHAT THE RIG PUBLISHES, and why it is more than two mattress tops now.
       `headroom` is the air a body sitting on the LOWER rack actually has, taken
       off the boxes just drawn — so "can a man sit here" is a question anybody
       can ask the furniture instead of a number they have to know. `latOut` is
       how far the frame reaches into the room from the bunk's centre-line: the
       leash, the seat spot and the fight scatter all need the footprint, and
       all three used to carry their own 0.62 copy of it. */
    // WORLD heights: an upper-tier rack publishes its tops FY higher, so every
    // consumer (propuse anchors, the seat solve, the leash) reads the mattress
    // where it is drawn. The clearances are differences and do not move.
    return {
      x: x, z: z, top: LOW_TOP + LIFT, topBunk: dbl ? UP_TOP + LIFT : null, along: along,
      deckY: dbl ? DECK_Y + LIFT : null, floor: LIFT,
      headroom: dbl ? DECK_Y - LOW_TOP : CH - LOW_TOP,
      headroomTop: dbl ? CH - UP_TOP : null,
      latOut: LAT / 2, lonOut: LON / 2, railTop: dbl ? RAIL_TOP + LIFT : null,
    };
  }

  /* CAN THIS BODY SIT ON THAT RACK? The one question the overlap in the owner's
     screenshot is an unchecked answer to. It is asked of the RIG, not of a
     constant: entities/character.js measures each body, so a profile this file
     has never heard of gets a true answer, and the geometry above is sized so
     the answer is yes for the shipped rig with 0.14 to spare. Falls back to
     SIT_CROWN when a rig cannot be measured — never to "sure, go ahead". */
  function seatFits(char, headroom) {
    if (!(headroom > 0)) return false;
    let crown = SIT_CROWN;
    try {
      const m = CBZ.charSeatMetrics && CBZ.charSeatMetrics(char);
      if (m) crown = m.hipPad + m.topOverHip + 0.04;    // +hair, as measured
    } catch (e) {}
    return crown <= headroom;
  }
  CBZ.prisonBunkSeatFits = seatFits;

  /* The cell is already the venue's best furniture. South-block housing must
     compound that owner, not redraw a cheaper bunk beside it. This is the one
     narrow construction seam: identical frame/bedding/rail/ladder geometry,
     identical deferred registration, and records returned on the stack that
     drew them. world/southblock.js supplies only placement and unit ownership. */
  const housingStacks = (CBZ.prisonHousingStacks = CBZ.prisonHousingStacks || []);
  /* PUNITIVE RACKS — REAL BEDS, NOT WING CAPACITY. world/prisonwings.js's
     segregation block draws sixteen racks that were raw addBox slabs: no
     useBed, no CBZ.propRegisterBed, no CBZ.prisonBunk. They come through this
     file's canonical builder now, so they are real propuse anchors a body can
     lie on and CBZ._prisonProps.beds counts them.
     They are kept in their OWN list and out of everything CBZ.prisonBeds()
     publishes, because segregation is ISOLATION and not housing:
       · `houses` is what entities/npc.js:547 and entities/ambientstate.js turn
         into ANONYMOUS BODIES. Counting the hole as capacity puts more men in
         the yard because the punishment block has bunks in it, which is
         backwards, and tools/prison-polish-check.mjs's population pair says so.
       · systems/prisonrest.js builds its muster from the cell house and
         CBZ.prisonHousing (the south dorm) — the buildings men are HOUSED in.
         A rack the muster never assigns must not be counted as one it does, or
         tools/prison-beds-check.mjs's `restAudit.beds === prisonBeds.beds`
         goes red telling the truth.
     So `prisonRestAudit().beds` deliberately does NOT move for these sixteen.
     What moves is the thing the owner actually asked for: they stopped being
     mattresses no body in the game can lie on. */
  const punitiveStacks = (CBZ.prisonPunitiveStacks = CBZ.prisonPunitiveStacks || []);
  CBZ.prisonBunk = function (spec) {
    spec = spec || {};
    const stack = {
      id: spec.id || ("housing-bunk-" + housingStacks.length),
      _housingUnit: spec.unit || null,
      /* `punitive` — A RACK IS NOT ALWAYS CAPACITY. world/prisonwings.js's
         segregation block draws sixteen racks that are unquestionably beds:
         they register through this exact path, they are propuse anchors, a
         body lies on them, and CBZ.prisonRestAudit().beds counts them. But
         segregation is ISOLATION, not general housing, and `houses` below is
         the number entities/npc.js and entities/ambientstate.js turn into
         ANONYMOUS BODIES. Counting the hole as capacity would put sixteen
         more men in the yard because the punishment block has bunks in it,
         which is backwards. So a punitive stack is counted in `beds`/`racks`
         (the honest mattress count, and what prisonrest must agree with) and
         excluded from `houses` (design occupancy). */
      _punitive: !!spec.punitive,
      bed: null, bedTop: null, bunk: null,
    };
    stack.bunk = bunkRig(stack, +spec.x || 0, +spec.z || 0, spec.along === "x" ? "x" : "z",
      spec.double !== false, spec.blanket == null ? 0x5c6470 : spec.blanket);
    useBed(stack.bunk.x, stack.bunk.z, stack.bunk.along, stack.bunk.top, 2.60, stack, "bed", 0);
    if (stack.bunk.topBunk)
      // The head clearance is MEASURED off the rig that was just drawn
      // (origin/main, "Measure the body before you build the bed") rather
      // than the 1.18 this line used to type — a typed gap and a rig that
      // moves are the same bug twice.
      useBed(stack.bunk.x, stack.bunk.z, stack.bunk.along, stack.bunk.topBunk, 2.60, stack, "bedTop",
        stack.bunk.topBunk - stack.bunk.top);
    (stack._punitive ? punitiveStacks : housingStacks).push(stack);
    return stack;
  };

  // the combined steel toilet/sink every cell in the world actually has.
  // (nx,nz) points INTO the cell's back wall, so the cistern and the tap are
  // placed by ADDING it — the unit's back is always the masonry, never the room.
  /* EVERY CELL IN THE PRISON HAD A WALK-THROUGH TOILET, and the comment above
     is why — except the comment argues about a solid bunk AND a solid toilet
     TOGETHER, and the bunk is not solid and never was. Re-derived at today's
     sizes rather than trusting it: a north cell is 3.80 x 5.50 m and a side
     cell 3.80 x ~3.0 m; the bunk stands 1.25 m across one wall, leaving a
     2.55 m clear lane; the combo is 0.52-0.66 m and stands in the BACK
     corner of that lane, so a 0.55 m player and a 0.50 m inmate still pass
     each other with 1.3 m to spare. It is one collider for the whole unit —
     pedestal, cistern, basin — because a stainless combo is one casting, and
     0..1.27 m so a body is stopped by it at the height it actually exists.
     CBZ.cellblockAudit().spawnBlocked is the ratchet that says this did not
     land on top of CBZ.SPAWN; it must stay 0. */
  function toiletSink(x, z, nx, nz) {
    const side = Math.abs(nx) > 0.5;
    const bw = side ? 0.52 : 0.66, bd = side ? 0.66 : 0.52;
    if (HONEST) solid(Math.min(x - bw / 2, x + nx * 0.26 - (side ? 0.08 : 0.33)),
      Math.min(z - bd / 2, z + nz * 0.26 - (side ? 0.33 : 0.08)),
      Math.max(x + bw / 2, x + nx * 0.26 + (side ? 0.08 : 0.33)),
      Math.max(z + bd / 2, z + nz * 0.26 + (side ? 0.33 : 0.08)), 0, 1.27);
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
    // and UP_TOP) as the declared cushion, so an anchor can never drift off the
    // mesh it belongs to. `c` + "bed"/"bunkTop" is where the records land once
    // the queue above is drained. A man on the top rack is a man who is not on
    // a floor mat, which is the whole point of drawing it.
    // The upper anchor's own floor reference is the STACK PITCH, and it is now
    // subtracted from the two tops rather than written down as 1.18 — the pitch
    // moved with the rack, and a hardcoded copy of it would have registered
    // every top-bunk sleeper against a floor that no longer exists.
    useBed(c.bunk.x, c.bunk.z, "z", c.bunk.top, 2.60, c, "bed", LIFT);
    if (c.bunk.topBunk)
      useBed(c.bunk.x, c.bunk.z, "z", c.bunk.topBunk, 2.60, c, "bedTop", LIFT + c.bunk.topBunk - c.bunk.top);

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
    // …and never upstairs: systems/pushprops.js slides a stool on the ground
    // plane, and a shovable on a floor it cannot see is a stool through a slab.
    if (north && !LIFT) {
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
      // hung off the frame the rig actually drew — it used to be two literals
      // that happened to match a 0.79 mattress and stopped matching a 0.62 one.
      addBox(c.bunk.x + c.bunk.latOut, c.bunk.top + 0.09, c.bunk.z + 0.70, 0.10, 0.56, 0.34,
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
    // The photographs ride with the rack they are taped beside. At 2.35 they
    // used to sit just over a 1.97 mattress; against the raised stack that is
    // level with the upper mattress itself, i.e. behind it. UP_TOP + 0.56 keeps
    // them where they always were relative to the man who looks at them —
    // above his own pillow, clear of the 2.74 rail, under the 3.46 light strip.
    if (c.player) {
      const PHOTO_Y = (c.bunk.topBunk || 1.97) + 0.56;
      for (let i = 0; i < 3; i++)
        addBox(oppX + (north ? 0.03 : 0), PHOTO_Y, oppZ + (north ? -0.34 + i * 0.34 : 0.03), north ? 0.03 : 0.24, 0.30, north ? 0.24 : 0.03,
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
      // which storey, and where its floor is. Every y this cell publishes
      // (leaf, bed anchors, the resident's own feet) is measured from `fy`.
      tier: opts.tier ? 1 : 0, fy: opts.tier ? FY : 0,
    };
    // Which side the leaf pockets into. Alternated so the wing reads like a
    // real tier and not a wallpaper repeat — but the PLAYER's cell is pinned
    // unflipped, because that is the side CBZ.SPAWN stands on.
    c.flip = c.player ? false : ((cells.length & 1) === 1);
    if (c.flip) { c.ob = c.half - POCKET; c.oa = c.ob - DOOR_W; }
    else { c.oa = -c.half + POCKET; c.ob = c.oa + DOOR_W; }
    const dc = facePoint(c, (c.oa + c.ob) / 2, 0);
    c.doorX = dc.x; c.doorZ = dc.z;
    /* WHERE THE RESIDENT WANDERS FOLLOWS THE DOOR. `room` is the cell's own
       floor and is his box while the leaf is SHUT; `aisle` is the lane outside
       his door — the cross-aisle for row A, a gallery for B/C, the centre hall
       for D/E — and is his box while it is OPEN. Both are entities/npc.js
       `region` rects ([minX,maxX,minZ,maxZ]) and both are shared by reference,
       so nothing may mutate them in place (assign() below used to). The lanes
       are the wing's own free space as systems/prisonschedule.js measured it:
       galleries x 8.8..11.1, hall x -3.3..3.3, cross-aisle z -37.4..-35.5.
       Wander targets are still sampled against live colliders, so a generous
       edge costs a rejected sample, never a body in a wall. */
    c.room = [c.x - c.hx + 0.85, c.x + c.hx - 0.85, c.z - c.hz + 0.85, c.z + c.hz - 0.85];
    if (c.dz !== 0) c.aisle = [-11, 11, NFACE + 0.6, NFACE + 2.5];
    else if (Math.abs(c.faceX) > 8) c.aisle = c.dx > 0 ? [c.faceX + 0.6, c.faceX + 2.9, -37.4, -9.8]
      : [c.faceX - 2.9, c.faceX - 0.6, -37.4, -9.8];
    else c.aisle = [-3.3, 3.3, -37.4, -9.8];
    // an upper resident's "aisle" is his room: the tier is locked (header)
    if (c.tier) c.aisle = c.room;
    cells.push(c);
    if (c.player) playerCell = c;
    LIFT = c.fy;
    try { buildCell(c); } finally { LIFT = 0; }
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
     5b. THE TIER — the same three rows, one storey up, and the steel that
         lets a body get there. Read the header's "THE TIER" first.
     ========================================================== */
  // the slab that IS the tier's floor over a bay that has no cell (and so no
  // per-cell roof): alcoves, the officer's post, the four corners. C_ROOF so
  // it reads as the same pour as the cells' own lids beside it.
  function tierSlab(x0, x1, z0, z1) {
    addBox((x0 + x1) / 2, CH + RT / 2, (z0 + z1) / 2, x1 - x0, RT, z1 - z0, C_ROOF, { cast: false, blockLOS: true });
  }
  // a partition on the tier: the ground partition under it already carries a
  // full-height collider (sbox with no band), so this is the concrete only.
  function tierWall(x, z, w, d) {
    addBox(x, FY + CH / 2, z, w, CH, d, C_PART, { cast: false, blockLOS: true });
  }
  // a bay on the tier with no cell in it: a closed utility room — concrete
  // front, a louvred steel panel, its own lid. Nothing in it, on purpose.
  function tierBlank(cx, cz, w, d, dx, dz) {
    const fx = cx + dx * (d / 2 - 0.10), fz = cz + dz * (d / 2 - 0.10);
    addBox(fx, FY + CH / 2, fz, dx ? 0.20 : w, CH, dz ? 0.20 : w, C_PART_D, { cast: false, blockLOS: true,
      solid: true, y0: FY, y1: FY + CH });
    for (let i = 0; i < 5; i++)
      addBox(fx + dx * 0.11, FY + 1.30 + i * 0.16, fz + dz * 0.11, dx ? 0.03 : w * 0.5, 0.06, dz ? 0.03 : w * 0.5, C_STEEL_D, { cast: false });
    addBox(cx, FY + CH + RT / 2, cz, dx ? d + WT : w + WT, RT, dx ? w + WT : d + WT, C_ROOF, { cast: false, blockLOS: true });
  }

  // ---- the cells, from the same tables ---------------------------------
  for (const seg of NORTH_ROW) {
    const w = seg.b - seg.a, cx = (seg.a + seg.b) / 2;
    if (seg.kind === "cell") {
      addCell({ tag: "2A-" + seg.tag.split("-")[1] },
        { x: cx, z: NZ, hx: w / 2, hz: NHZ, dx: 0, dz: 1, faceX: cx, faceZ: NFACE, tier: 1 });
    } else {
      tierSlab(seg.a - WT / 2, seg.b + WT / 2, IZN - 0.5, NFACE + WT / 2);
      if (seg.kind === "wall") tierWall(cx, NZ, w, ND);
      else if (seg.kind !== "post") tierBlank(cx, NZ, w, ND, 0, 1);
      // over the post: the tier's open landing, nothing but floor and rail
    }
  }
  for (const seg of WEST_ROW) {
    const len = seg.b - seg.a, cz = (seg.a + seg.b) / 2;
    if (seg.kind === "cell") {
      addCell({ tag: "2B-" + seg.tag.split("-")[1] },
        { x: WX, z: cz, hx: WHX, hz: len / 2, dx: 1, dz: 0, faceX: WFACE, faceZ: cz, tier: 1 });
    } else {
      tierSlab(IX0 - 0.5, WFACE + WT / 2, seg.a - WT / 2, seg.b + WT / 2);
      if (seg.kind === "wall") tierWall(WX, cz, SD, len);
      else tierBlank(WX, cz, len, SD, 1, 0);
    }
  }
  for (const seg of EAST_ROW) {
    const len = seg.b - seg.a, cz = (seg.a + seg.b) / 2;
    if (seg.kind === "cell") {
      addCell({ tag: "2C-" + seg.tag.split("-")[1] },
        { x: EX, z: cz, hx: EHX, hz: len / 2, dx: -1, dz: 0, faceX: EFACE, faceZ: cz, tier: 1 });
    } else {
      tierSlab(EFACE - WT / 2, IX1 + 0.5, seg.a - WT / 2, seg.b + WT / 2);
      if (seg.kind === "wall") tierWall(EX, cz, SD, len);
      else tierBlank(EX, cz, len, SD, -1, 0);
    }
  }
  // the four corners the rows leave open at ground level get a floor on the
  // tier: the two cross-aisle ends up north, the stair landings down south.
  const WEND = WEST_ROW[WEST_ROW.length - 1].b, EEND = EAST_ROW[EAST_ROW.length - 1].b;
  tierSlab(IX0 - 0.5, WFACE, NFACE, WEST_ROW[0].a);
  tierSlab(EFACE, IX1 + 0.5, NFACE, EAST_ROW[0].a);
  tierSlab(IX0 - 0.5, WFACE, WEND, -8.0);
  tierSlab(EFACE, IX1 + 0.5, EEND, -8.0);

  // ---- the gallery: a steel deck GW out from every cell front, its rail,
  //      and the brackets it hangs on. Colliders: the RAIL only, banded
  //      [FY, FY+RAIL_H] — a rail 3.9 m up is nothing to a man on the
  //      ground, to his navigator, or to the lane audits below. ------------
  const gal = [];                       // merged dark steel: rails, brackets, treads
  const dk = [];                        // the deck plates, a lighter grey
  function deckRun(x0, x1, z0, z1) {
    pushBox(dk, (x0 + x1) / 2, FY - GDECK / 2, (z0 + z1) / 2, x1 - x0, GDECK, z1 - z0);
  }
  // rail along one edge. `ax` = the axis the rail runs along; (ox,oz) the edge.
  function railRun(ax, a0, a1, ox, oz) {
    const len = a1 - a0, mid = (a0 + a1) / 2;
    const box = (t, y, along, h, across) => {
      if (ax === "z") pushBox(gal, ox, y, t, across, h, along);
      else pushBox(gal, t, y, oz, along, h, across);
    };
    box(mid, FY + RAIL_H, len, 0.06, 0.06);          // top rail
    box(mid, FY + RAIL_H * 0.55, len, 0.05, 0.05);   // mid rail
    box(mid, FY + 0.07, len, 0.14, 0.04);            // kick plate
    const N = Math.max(1, Math.round(len / 1.9));
    for (let i = 0; i <= N; i++) box(a0 + (len * i) / N, FY + RAIL_H / 2, 0.06, RAIL_H, 0.06);
    // the collider, on the same edge, the rail's own height
    if (ax === "z") solid(ox - 0.08, a0, ox + 0.08, a1, FY, FY + RAIL_H);
    else solid(a0, oz - 0.08, a1, oz + 0.08, FY, FY + RAIL_H);
  }
  // steel angle brackets under the deck, one per cell partition
  function bracket(x, z, dx, dz) {
    for (let i = 0; i < 2; i++) {
      const t = 0.35 + i * 0.55;
      pushBox(gal, x + dx * t, FY - GDECK - 0.10, z + dz * t, dx ? 0.12 : 0.12, 0.12, dz ? 0.12 : 0.12);
    }
    pushBox(gal, x + dx * 0.55, FY - GDECK - 0.24, z + dz * 0.55, dx ? 1.05 : 0.12, 0.10, dz ? 1.05 : 0.12);
  }
  // north gallery (in front of row A and across the post), then the sides
  const NG1 = NFACE + GW;
  deckRun(WFACE, EFACE, NFACE, NG1);
  deckRun(WFACE, WFACE + GW, NG1, SZ1);
  deckRun(EFACE - GW, EFACE, NG1, SZ1);
  railRun("x", WFACE + GW, EFACE - GW, 0, NG1);
  railRun("z", NG1, SZ0, WFACE + GW, 0);
  railRun("z", NG1, SZ0, EFACE - GW, 0);
  for (const seg of NORTH_ROW) if (seg.kind === "wall") bracket((seg.a + seg.b) / 2, NFACE, 0, 1);
  for (const seg of WEST_ROW) if (seg.kind === "wall") bracket(WFACE, (seg.a + seg.b) / 2, 1, 0);
  for (const seg of EAST_ROW) if (seg.kind === "wall") bracket(EFACE, (seg.a + seg.b) / 2, -1, 0);

  // ---- the stairs: one open flight per side along the south wall, from
  //      |x| = STAIR_X0 on the floor up to the gallery's end. A ramp record
  //      for the physics (systems/physics.js groundAt interpolates it), the
  //      treads and stringers for the eye, a handrail on the open side, and a
  //      band under the low end so nobody walks into the underside. -------
  function stair(side) {
    const xB = side * STAIR_X0, xT = side * (Math.abs(WFACE) - GW);   // bottom, top
    const run = Math.abs(xT - xB);
    const N = Math.round(FY / 0.19);                                // risers
    const tread = run / N, rise = FY / N;
    for (let i = 1; i <= N; i++) {
      const x = xB + side * (tread * (i - 0.5)), y = rise * i;
      pushBox(gal, x, y - 0.03, (SZ0 + SZ1) / 2, tread + 0.02, 0.06, STAIR_W);   // tread
      pushBox(gal, x - side * (tread * 0.5 - 0.02), y - rise / 2 - 0.03, (SZ0 + SZ1) / 2, 0.04, rise, STAIR_W); // riser
    }
    // stringers: two sloped plates, drawn as rotated meshes (addBox has no yaw)
    for (const z of [SZ0 + 0.05, SZ1 - 0.05]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(run, FY) + 0.3, 0.32, 0.06), CBZ.cmat(C_DARK));
      m.position.set((xB + xT) / 2, FY / 2 - 0.10, z);
      m.rotation.z = side * Math.atan2(FY, run);
      m.castShadow = false; m.receiveShadow = true;
      root.add(m);
    }
    // handrail on the open (north) side: posts, and a rail that climbs with them
    const NP = 5;
    for (let i = 0; i <= NP; i++) {
      const t = i / NP, x = xB + side * run * t, y = FY * t;
      pushBox(gal, x, y + 0.5, SZ0 + 0.05, 0.05, 1.0, 0.05);
    }
    const hr = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(run, FY), 0.05, 0.05), CBZ.cmat(C_DARK));
    hr.position.set((xB + xT) / 2, FY / 2 + 1.0, SZ0 + 0.05);
    hr.rotation.z = side * Math.atan2(FY, run);
    hr.castShadow = false; root.add(hr);
    // colliders: the handrail as a stepped band, and the underside
    for (let i = 0; i < NP; i++) {
      const xa = xB + side * run * (i / NP), xb = xB + side * run * ((i + 1) / NP);
      const y = FY * (i / NP);
      solid(Math.min(xa, xb), SZ0 - 0.03, Math.max(xa, xb), SZ0 + 0.13, y, y + FY / NP + 1.0);
    }
    // the low end: headroom under a tread is less than a body until the flight
    // has climbed ~1.9 m, so that stretch is a wall to the floor
    const xLow = xB + side * run * (1.9 / FY);
    solid(Math.min(xB, xLow), SZ0, Math.max(xB, xLow), SZ1, 0, 1.9);
    // the physics: a ramp from the floor at xB to FY at xT
    (CBZ.platforms || (CBZ.platforms = [])).push({
      minX: Math.min(xB, xT), maxX: Math.max(xB, xT), minZ: SZ0, maxZ: SZ1, top: FY,
      ramp: { axis: "x", x0: xB, x1: xT, y0: 0, y1: FY },
    });
  }
  stair(-1); stair(1);
  mergedMesh(gal, C_DARK, false);
  mergedMesh(dk, 0x5d656f, false);

  // ---- what a body stands on up there: the walkway and every upper floor.
  //      A record per band; groundAt only offers it within a step of the
  //      body's own height, so a man in a ground cell never sees it. -------
  (CBZ.platforms || (CBZ.platforms = [])).push(
    { minX: IX0, maxX: WFACE + GW, minZ: NFACE, maxZ: SZ1, top: FY },
    { minX: EFACE - GW, maxX: IX1, minZ: NFACE, maxZ: SZ1, top: FY },
    { minX: IX0, maxX: IX1, minZ: IZN, maxZ: NG1, top: FY });
  if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

  /* ==========================================================
     6. THE ALCOVES — the three breaks in the cell line, each of them a
        thing the wing needs rather than a hole in the row.
     ========================================================== */
  /* THE SHOWERS WERE 9 PROPS, 0 SOLID, 0 USED — measured, prison-rooms
     baseline, room `cell-showers`. Every one of them was scenery: two shower
     heads with their risers 0.33 m away from them, a curtain rail with no
     curtain, and a 5 cm plank floating at y=1.0 with no legs called a bench.
     Now: the riser stands where the rose is, so pipe, mixer and rose are one
     solid column a body is stopped by; the rail with nothing on it is gone;
     and the bench is a real bench with a propuse SEAT anchor on it, which is
     what makes this alcove somewhere a man goes rather than a tiled hole.
     The pan and the drain stay and are meant to: at 5 cm they are the floor's
     own surface, the same class as a painted circulation line. */
  function showerAlcove(cx, cz, w, d) {
    if (!HONEST) {                                     // the shipped alcove, byte for byte
      addBox(cx, 0.03, cz + 0.6, w - 0.1, 0.06, d - 1.6, 0x7c8894, { cast: false });
      addBox(cx, 0.05, cz + 0.6, 0.34, 0.10, 0.34, 0x5b6470, { cast: false });
      for (let i = 0; i < 2; i++) {
        const zz = cz - 1.5 + i * 2.6;
        addBox(cx - w / 2 + 0.14, 2.35, zz, 0.14, 0.14, 0.14, C_STEEL_D, { cast: false });
        addBox(cx - w / 2 + 0.45, 2.28, zz, 0.5, 0.10, 0.22, C_STEEL, { cast: false });
        addBox(cx - w / 2 + 0.12, 1.30, zz, 0.10, 2.00, 0.10, C_STEEL_D, { cast: false });
      }
      addBox(cx, 2.9, cz + d / 2 - 0.2, w - 0.2, 0.16, 0.16, C_STEEL_D, { cast: false });
      addBox(cx, 1.0, cz - d / 2 + 0.35, w - 0.6, 0.05, 0.3, 0xb9a184, { cast: false });
      return;
    }
    addBox(cx, 0.025, cz + 0.6, w - 0.1, 0.05, d - 1.6, 0x7c8894, { cast: false });    // tiled pan
    addBox(cx, 0.05, cz + 0.6, 0.34, 0.05, 0.34, 0x5b6470, { cast: false });           // drain grating
    for (let i = 0; i < 2; i++) {
      const zz = cz - 1.5 + i * 2.6, rx = cx - w / 2 + 0.45;
      addBox(rx, 1.14, zz, 0.12, 2.28, 0.12, C_STEEL_D, solidTo(1.14, 2.28));           // riser, floor to rose
      addBox(rx, 1.35, zz, 0.17, 0.17, 0.17, C_STEEL_D, { cast: false });              // mixer, on the riser
      addBox(rx, 2.36, zz, 0.40, 0.10, 0.30, C_STEEL, { cast: false });                // rose, over the riser
    }
    // the bench: a solid plinth with a seat anchor, not a plank in mid-air.
    const bz = cz - d / 2 + 0.45;
    sbox(cx, 0.21, bz, w - 0.6, 0.42, 0.42, 0xb9a184, solidTo(0.21, 0.42));
    useSeat(cx, bz, 0, 0.42);
  }
  /* THE LINEN STORE WAS 5 PROPS, 0 SOLID, 0 USED, 3.61 m3 — three cream planes
     sized to the alcove and a 2.145 m3 laundry cart a body walked through,
     which was the single biggest dead box in the whole cell house. The planes
     become a real rack on the existing back frame; the cart becomes the thing
     a wheeled cart obviously is — a SHOVABLE, through the same
     systems/pushprops.js call the cell stool already uses, so it is `used` by
     the only definition that matters: the player can move it. */
  function storeAlcove(cx, cz, w, d) {
    if (!HONEST) {                                     // the shipped alcove, byte for byte
      for (let i = 0; i < 3; i++)
        addBox(cx, 0.7 + i * 0.72, cz - 0.7, w - 0.3, 0.07, d - 2.6, 0xb9a184, { cast: false });
      sbox(cx, 1.35, cz - d / 2 + 0.25, w - 0.3, 2.7, 0.10, C_PART_D, solidTo(1.35, 2.7));
      addBox(cx, 0.55, cz + d / 2 - 1.1, 1.3, 1.1, 1.5, 0xe2e2e2, { cast: false });
      addBox(cx, 1.12, cz + d / 2 - 1.1, 1.4, 0.12, 1.6, 0xd0d0d0, { cast: false });
      return;
    }
    sbox(cx, 1.35, cz - d / 2 + 0.25, w - 0.3, 2.7, 0.10, C_PART_D, solidTo(1.35, 2.7));  // back rack frame
    for (let i = 0; i < 3; i++)
      sbox(cx, 0.42 + i * 0.62, cz - d / 2 + 0.62, w - 0.3, 0.05, 0.62, 0xb9a184, solidTo(0.42 + i * 0.62, 0.05));
    const cartZ = cz + d / 2 - 1.1;
    const tub = addBox(cx, 0.55, cartZ, 1.3, 1.1, 1.5, 0xe2e2e2, { cast: false });
    const lip = addBox(cx, 1.12, cartZ, 1.4, 0.12, 1.6, 0xd0d0d0, { cast: false });
    if (HONEST && CBZ.pushProp) CBZ.pushProp({
      parts: [tub, lip], x: cx, z: cartZ, hx: 0.7, hz: 0.8, y1: 1.18,
      mass: 34, kind: "cart", solid: true, leash: 3.0, mode: "escape",
      room: { x0: cx - w / 2 + 0.8, x1: cx + w / 2 - 0.8, z0: cz - d / 2 + 1.6, z1: cz + d / 2 - 0.9 },
    });
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
    sbox(cx, 0.55, cz - d / 2 + 1.1, 3.4, 1.1, 0.9, 0x33200f, solidTo(0.55, 1.1));      // desk
    addBox(cx, 1.16, cz - d / 2 + 1.1, 3.6, 0.12, 1.0, 0x4a3a22, { cast: false });
    addBox(cx - 0.9, 1.34, cz - d / 2 + 1.0, 0.7, 0.42, 0.06, 0x9fd6ff, { emissive: 0x2a6ea5, ei: 0.7, cast: false }); // monitor
    addBox(cx + 1.5, 1.75, cz - d / 2 + 0.42, 0.9, 1.1, 0.10, 0x2a2f38, { cast: false });   // key board
    for (let i = 0; i < 8; i++)
      addBox(cx + 1.15 + (i % 4) * 0.24, 1.95 - ((i / 4) | 0) * 0.36, cz - d / 2 + 0.36, 0.07, 0.20, 0.04, 0xd9b64c, { cast: false });
    // the duty chair. It was two dead boxes in front of a solid desk; it is a
    // propuse seat now, so the post is somewhere a body sits and not a prop
    // shaped like one. `face` looks north at the desk.
    const chZ = cz - d / 2 + 2.0;
    sbox(cx, 0.45, chZ, 0.6, 0.9, 0.6, C_DARK, solidTo(0.45, 0.9, HONEST));            // chair
    addBox(cx, 1.05, cz - d / 2 + 2.25, 0.6, 0.7, 0.1, C_DARK, { cast: false });       // back
    if (HONEST) useSeat(cx, chZ, Math.PI, 0.45);
    // WING SIGN — the block announces itself over the post.
    // …under the tier's floor slab (3.6-3.9), not through it
    // The lit plate goes on the SOUTH face, the side the hall sees. It used
    // to sit 0.1 north of the board — behind it — and read fine only because
    // the board itself was one of the boxes the batcher had baked at the
    // origin; the day the board came back the sign went dark.
    addBox(cx, 3.15, cz + d / 2 - 0.1, 5.0, 0.7, 0.14, 0x11151b, { cast: false });
    addBox(cx, 3.15, cz + d / 2 + 0.005, 4.4, 0.34, 0.06, 0xe8b64c, { emissive: 0x6a4f10, ei: 0.6, cast: false });
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
  /* NO DINING FURNITURE IN THE CELL HOUSE. (OWNER, with the shot: "there prob
     shouldn't be table and chairs in the cell room.")

     Two bolted day tables and eight stools used to stand here. They were never
     placed on purpose: they were authored at |x| = 6.6 back when that was open
     floor, and when row E (since demolished for the tier) went out over 6.6 they were SHUFFLED inward
     to |x| = 2.6 to keep them off the new cells — i.e. into the CENTRE HALL,
     the one strip of this building that is a corridor between two facing tiers
     of cell fronts. A mess table in the middle of a tier walkway is not a day
     room, it is furniture parked in a fire lane, and it read exactly that way
     down the barrel: a picnic table two metres from a locked door.

     Deleted rather than re-sited, because the compound already owns the rooms
     this furniture belongs in and both are dressed: world/cafeteria.js (the
     chow hall's mess tables, 0.95 m banded colliders and real seats) and
     world/lounge.js (the DAYROOM proper — round bolted table, four stools,
     phone bank). Moving these two here as well would have made the wing's
     walkway the third-best day room in a prison that has two good ones.

     WHAT THE HALL IS FOR INSTEAD: nothing. The spine at x = 0 is guards.js's
     patrol lane and the south throat x[-3,3] at z = -8 is world/door.js's; the
     tables sat between them and now the whole centre hall is clear concrete,
     which is what a tier walkway is. `spineBlocked` was 0 with them and is
     still 0 without them. Eight seat anchors and two pushable-stool records go
     with them — CBZ._prisonProps just counts fewer props in this file, and the
     seats an inmate actually uses on this floor are the per-cell stool
     (fitOutCell) and his own bunk. */
  // NO centre line down the spine. The dashed yellow one that lived here was
  // road grammar — from the air it joined the walkway and the track oval into
  // the owner's "yellow dotted road going through the middle of the jail".
  // The aisle already reads as the walk; nothing on a prison floor should
  // read as a carriageway.

  // ---- caged ceiling lamps, one per stretch of cells ----------------------
  // CBZ.ceilingLamp is a PUBLISHED handle: systems/interactions.js's breaker
  // sabotage and systems/state.js's reset both write its material directly.
  // Keep the original at (0, 8.2, -30) exactly and mirror it onto the rest.
  /* THE ROOF IS A STRUCTURE, AND THE LAMPS HANG OFF IT. Four lattice
     trusses span the hall under the lid, one at each lamp line; a cage lamp
     is a stem off the bottom chord with the cage on the end of it, which is
     what a pendant is. Before this the cage sat at 8.2 with 25 cm of air
     between its cap and the 9.0 lid — the owner's "some lights" floating.
     `TRUSS_Z` is the one list both read, so a lamp is on a chord by
     construction, and cellblockAudit().floatingFixtures counts any cage whose
     stem does not reach one. */
  const TRUSS_Z = [-37.5, -30, -22.5, -15];
  const CHORD_LO = 8.05, CHORD_HI = 8.90;     // bottom / top chord centres
  const LAMP_Y = 7.55;                        // the cage, hung 0.4 m under the chord
  const cages = [];
  (function trusses() {
    const g = [];
    for (const z of TRUSS_Z) {
      pushBox(g, 0, CHORD_LO, z, 32, 0.20, 0.16);
      pushBox(g, 0, CHORD_HI, z, 32, 0.20, 0.16);
      for (let x = -15; x <= 15.01; x += 2.5) pushBox(g, x, (CHORD_LO + CHORD_HI) / 2, z, 0.10, CHORD_HI - CHORD_LO - 0.2, 0.10);
    }
    // purlins the long way, tying the trusses together under the lid
    for (const x of [-12, -6, 0, 6, 12]) pushBox(g, x, CHORD_HI, -26, 0.12, 0.16, 36);
    mergedMesh(g, 0x4a525c, false);
  })();
  function cageLamp(x, z) {
    const zc = TRUSS_Z.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a), TRUSS_Z[0]);
    const onChord = Math.abs(zc - z) < 0.2;
    const stemTop = onChord ? CHORD_LO - 0.10 : WH - 0.05;
    const capTop = LAMP_Y + 0.10 + 0.30;
    addBox(x, (capTop + stemTop) / 2, z, 0.06, stemTop - capTop, 0.06, C_DARK, { cast: false });   // stem
    addBox(x, LAMP_Y + 0.25, z, 0.5, 0.3, 0.5, C_DARK, { cast: false });                           // cap
    const l = addBox(x, LAMP_Y, z, 0.7, 0.2, 0.7, 0xffe9a8, { emissive: 0xffcf66, ei: 0.9, cast: false });
    for (let i = -1; i <= 1; i += 2) addBox(x + i * 0.36, LAMP_Y, z, 0.06, 0.26, 0.62, C_DARK, { cast: false });
    cages.push({ x: x, z: z, hung: onChord });
    return l;
  }
  const ceilingLamp = cageLamp(0, -30);
  CBZ.ceilingLamp = ceilingLamp;
  // the published handle stays on the spine at (0, -30); the rest of the hall
  // line hangs off the other three trusses, and each gallery gets a pair over
  // the walkway's edge — a deck with cell fronts down one side and dark
  // concrete down the other is where a wing goes dark. interactions.js's
  // breaker owns all of them through the mirror below.
  lamps.push(cageLamp(0, -37.5), cageLamp(0, -22.5), cageLamp(0, -15));
  lamps.push(cageLamp(-9.6, -22.5), cageLamp(9.6, -22.5), cageLamp(-9.6, -30), cageLamp(9.6, -30));

  /* ==========================================================
     8. THE DOOR — jail.js's setDoor, ported. The collider and the visual
        move TOGETHER; nothing else in this file may touch either.
     ========================================================== */
  function placeLeaf(c) {
    if (!c.bars) return;
    c.bars.position.x = c.leafClosed.x + (c.leafOpen.x - c.leafClosed.x) * c.slide;
    c.bars.position.z = c.leafClosed.z + (c.leafOpen.z - c.leafClosed.z) * c.slide;
  }
  /* LAW 3, the cell-front instance. systems/prisonschedule.js drives EVERY
     leaf in this wing to the block plan every 0.35 s — which during the day
     means "open" — so a cell the player pulled shut by hand was slid back
     open under him within a third of a second. That is the auto-open owner
     for a cell, and it is answered the same way every other door in the
     compound answers it: the shared latch (CBZ.prisonDoorLatched, declared in
     systems/interactions.js) out-ranks an automatic UNLOCK while the man who
     shut it is still standing there, and stops mattering the moment he walks
     away. A LOCK is never refused — a lockdown, an intake and the schedule's
     lights-out must always be able to shut a door on you. */
  function handLatched(c) {
    return !!(CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-cell-" + c.i));
  }
  function setDoor(which, locked) {
    const c = typeof which === "number" ? cells[which] : which;
    if (!c || !c.doorCol) return false;
    if (!locked && c.tier) return false;          // the lockdown tier (header)
    if (!locked && handLatched(c)) return false;
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

  /* ---- AND A WAY TO SHUT ONE BY HAND --------------------------------------
     systems/interactions.js's shared door registry: a tap on the bars and the
     polled [E] both end in setDoor above, which stays the only code in this
     file that moves a leaf or a collider.

     A CELL FRONT HAS NO CREDENTIAL ON EITHER SIDE. Nothing here checks a key
     to open one — they all stand open at build and the schedules/lockdowns
     that shut them are systems, not the player — so the close must not invent
     a key the open never asked for. Same test in both directions, which here
     is no test. `autoR` is 6 m and that number is NOT a reader radius: a cell
     has no approach-open, its re-opener is systems/prisonschedule.js driving
     the whole wing to the block plan, which has no radius at all. So the
     latch's own release distance is the ROOM — shut your cell and stand in
     it, or in the aisle outside it, and it stays shut; leave the wing and the
     day plan gets its door back. Measured: a cell is 3.2 m across, so 6 + 2 m
     of release pad covers the cell and its aisle and nothing else.
     Not reversible-proof by luck either: a man who shuts himself in can shut
     it open again, because the credential is the same both ways. */
  for (let i = 0; i < cells.length; i++) {
    (function (c) {
      if (!c.doorCol || !c.bars || !c.leafClosed) return;
      (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
        id: "prison-cell-" + c.i, label: c.player ? "your cell door" : (c.tier ? "the cell door (tier lockdown)" : "the cell door"),
        autoR: 6.0,
        at: function () { return { x: c.leafClosed.x, y: 1.4 + c.fy, z: c.leafClosed.z }; },
        pick: function () { return [c.bars]; },
        col: function () { return c.doorCol; },
        isOpen: function () { return !c.locked; },
        permanent: function () { return !!c.tier; },
        canUse: function () { return !c.tier; },
        // OPENING IT AGAIN IS ALSO DELIBERATE, so it drops its own latch
        // before asking — otherwise the guard above would refuse the very
        // man it exists to protect.
        set: function (v) { if (v) this._latch = false; setDoor(c, !v); return c.locked === !v; },
      });
    })(cells[i]);
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
    // …except the tier, which is shut from the first frame and stays shut
    if (c.tier) { setDoor(c, true); c.slide = 0; placeLeaf(c); }
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
  // …and it is a SHARE of the wing, not a constant. Two empty cells in a
  // thirteen-cell block is one in six; two in a twenty-five-cell block is one
  // in twelve, which is a wing with nowhere left to move anybody — the exact
  // property this line exists to protect, quietly halved by growing the rows.
  // 1 in 8, floor 2: 13 cells -> 2 (byte-identical to what it always was),
  // 25 -> 3. It is also the wing's only slack in the bed arithmetic — each
  // vacant cell is two racks the cell house does not consume itself.
  // …and only on the GROUND: an empty cell exists to be moved into, and the
  // tier is somewhere nobody can be walked to (header). A full top tier is
  // also simply what the photograph shows.
  const groundCells = cells.filter(function (c) { return !c.tier; });
  const EMPTY_WANTED = Math.max(2, Math.round(groundCells.length / 8));
  const order = groundCells.filter(function (c) { return !c.player; })
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

  /* ---- THE PACING BOX, AND THE LAW THAT A POST MUST BE INSIDE IT ----------
     THE FLICKER (owner, 2026-08-19, video from his own cell): "ai is flickering
     like moving super fast front back while trying to run while in cell."

     Two numbers in this file disagreed and nothing made them agree. The leash
     confines a resident to a box — the cell inset by a body radius, minus the
     bunk footprint — and separately sends him to a POST derived from the door
     frame (`barsSpot`, the door's centreline). Half this wing's doors are
     offset over the bunk, so on the shipped tree TWELVE of twenty residents
     were being sent to a post their own leash forbids. The result is a frame
     loop with no fixed point: entities/npc.js walks the man at the post at
     order 22, the clamp here shoves him back off it at order 22.6, and neither
     ever wins. Measured on the pre-fix tree: 1.4 m of travel per second, net
     displacement zero, a body vibrating at 60 Hz — which is exactly what a
     screenshot cannot show and a video can.

     The box is the authority now: `postIn` clamps the pose spot into it, so a
     post is by construction somewhere the man is allowed to stand. He walks
     there once, gets inside the settle radius, and stops.

     The BUNK pose is deliberately exempt from the bunk exclusion: that strip
     is off-limits to a PACING body, not to the man sitting on the mattress —
     his spot is the seat the SIT_PHYS_V1 ratchet measures (cellblockAudit's
     seatDrift), and it must stay exactly on the rig. */
  function paceBox(c, forBunk) {
    let x0 = c.x - c.hx + 0.62, x1 = c.x + c.hx - 0.62;
    const z0 = c.z - c.hz + 0.62, z1 = c.z + c.hz - 0.62;
    // THE PACING LANE STOPS AT THE BED. Taken off the rig's own footprint, so
    // it tracks the bunk if it moves.
    if (c.bunk && !forBunk) {
      const wide = (c.bunk.along === "z" ? c.bunk.latOut : c.bunk.lonOut) + BODY_R;
      if (c.bunk.x < c.x) x0 = Math.max(x0, c.bunk.x + wide);
      else x1 = Math.min(x1, c.bunk.x - wide);
      if (x1 < x0) x1 = x0 = (x0 + x1) / 2;      // a cell too narrow to pace
    }
    return { x0: x0, x1: x1, z0: z0, z1: z1 };
  }
  function clampInto(b, v) {
    if (v.x < b.x0) v.x = b.x0; else if (v.x > b.x1) v.x = b.x1;
    if (v.z < b.z0) v.z = b.z0; else if (v.z > b.z1) v.z = b.z1;
  }
  // the post a resident of `c` is sent to, as a point he is ALLOWED to occupy
  function postV2() { return !CBZ.CONFIG || CBZ.CONFIG.CELL_POST_V2 !== false; }
  function postIn(c, pose) {
    const b = paceBox(c, pose === "bunk");
    const s = pose === "bars" ? barsSpot(c)
      : (pose === "bunk" && c.bunk ? bunkSpot(c, bunkStyle(c)) : { x: c.x, z: c.z });
    if (postV2()) clampInto(b, s);
    return s;
  }
  function bunkSpot(c, style) {
    // THE NEAR LONG EDGE OF THE BUNK — and it is always an X offset, because
    // every bunk in this wing is laid out ALONG Z (fitOutCell passes "z" for
    // both rows). The side-row branch used to offset in Z, which is offsetting
    // ALONG the mattress: the body landed 0.62 m up the bed with the frame
    // through his shins, and that is precisely the owner's "they stand
    // overlapping them". The lateral sign points INTO the room, away from the
    // wall the bunk's back is against (north/west rows +x, east row -x).
    // The lateral reach is the FRAME's, read off the rig, not a 0.62 copy of it
    // kept in step by hand — the frame is a collider now and a seat spot that
    // disagrees with it by a centimetre is a body inside a wall.
    const b = c.bunk;
    const lat = c.dz !== 0 ? 1 : c.dx;
    if (style === "back") {
      // Hips a body's depth off the head end, so the shoulders land against
      // the pillow and the wall behind it, and the legs run down the bed.
      // Barely off centre laterally: he is IN the bed, not on its lip.
      return { x: b.x + lat * 0.06, z: b.z - 0.72, face: Math.atan2(0, 1) };
    }
    return { x: b.x + lat * (b.latOut - 0.01), z: b.z };
  }
  /* THREE WAYS TO SIT ON YOUR OWN BUNK (owner: "they should be laying back
     sitting in the bed more relaxed... add more variants, not too many").

     Perching on the edge is what you do when you are ABOUT to do something —
     waiting for a door, talking through the bars, putting your boots on. It
     is not what a man does with eight hours of his own bed and nowhere to be,
     and thirteen cells of identical edge-perchers read as one animation
     played thirteen times.

       edge   perched on the near edge, feet on the concrete, ducked forward.
       back   sat INTO the bed at the head end, back against the wall the
              pillow is under, legs out along the mattress. The lean is
              BACKWARD; the duck solve still applies, leaned the other way.
       brace  edge again, but weight thrown back onto straight arms planted
              behind the hips. Half-relaxed: the pose of a man mid-sentence.

     It is a POSITION HASH like cellPose above, so a cell always holds the
     same man doing the same thing — a trait, not a die re-rolled every few
     seconds. */
  function bunkStyle(c) {
    const r = h01(c.x, c.z, 8451);
    return r < 0.40 ? "edge" : (r < 0.74 ? "back" : "brace");
  }
  /* A BODY THAT IS NOT LYING OR SITTING ON THE BUNK MUST NOT BE INSIDE IT.
     `unseat` handed the rig back to the walk pose and left it standing exactly
     where it had been sitting — on the mattress, inside the frame. That was
     invisible while the bunk was a hologram; with the frame solid it is a body
     in a collider, and it is the state every cell FIGHT starts from, because
     aiState "fight" is one of the things that unseats. So stepping clear is
     part of standing up, not a separate tidy-up somebody has to remember. */
  const BODY_R = 0.5;                   // inmate radius (entities/npc.js)
  function stepClearOfBunk(c, n) {
    const b = c && c.bunk, p = n && n.group && n.group.position;
    if (!b || !p) return;
    const wide = b.along === "z" ? b.latOut : b.lonOut;
    const deep = b.along === "z" ? b.lonOut : b.latOut;
    if (Math.abs(p.z - b.z) > deep + BODY_R) return;          // already past the ends
    const out = wide + BODY_R + 0.02;
    const side = (p.x - b.x) >= 0 ? 1 : -1;                   // leave the way he faces
    if (Math.abs(p.x - b.x) < out) {
      p.x = b.x + side * out;
      if (n.target) n.target.x = p.x;
    }
  }
  const SEAT_KIND = { edge: "bunk", back: "bunk-back", brace: "bunk-brace" };

  let cast = false;
  function dealCast() {
    if (cast || typeof CBZ.spawnJailNpc !== "function") return;
    cast = true;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.vacant || c.owner) continue;
      const pose = cellPose(c);
      // spawned ON his post, and the post is the leash's own answer — a man
      // dealt onto a spot his leash forbids spends his first seconds being
      // shoved off it (see postIn).
      const seat = postIn(c, pose);
      const hh = h01(c.x, c.z, 6001);
      let n = null;
      try {
        n = CBZ.spawnJailNpc({
          pos: [seat.x, seat.z],
          // every leaf stands open at build, so he is born with the run of the
          // aisle; wanderBox() hands him the room the moment his door shuts
          region: c.aisle,
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
      if (c.fy && n.group) n.group.position.y = c.fy;   // born on his own floor
      c.owner = n;
    }
  }

  /* ==========================================================
     10. THE LEASH + the door slide + the lamp mirror. The leash runs on BOTH
         sides of entities/npc.js's order-22 mover: order 21.9 decides where a
         resident is allowed to go, order 22.6 has the last word on where he
         ended the frame. A clamp with no say before the mover can only ever
         undo the step — which is a body vibrating, not a body in a cell.
     ========================================================== */
  const SLIDE_RATE = 4.2;
  let lampHex = -1, lampT = 0, lastElapsed = 0;

  // hand the rig back: the seated pose is HELD, so something has to release it.
  // `c` is optional only because the dead/escaped branch has no use for the
  // step-out; every live caller passes its cell, and standing up out of a bunk
  // means standing up OUT of it.
  function unseat(n, c) {
    if (!n || !n.char) return;
    const was = n.char.sitting;
    if (was && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand");
    if (was && c) stepClearOfBunk(c, n);
  }

  /* ==========================================================
     THE DOOR DECIDES. (OWNER, 2026-09-04: "npc will run at the open cell
     door and can't escape the cell, it's dumb coding. when cell door is
     open they should be able to run thru — they are tied to their spot and
     they run at the open cell door glitchily like they're running in place.")

     He was describing this file exactly. The leash below clamped every
     resident into his cell's box EVERY FRAME and never once asked whether
     the leaf was shut — and every leaf in this wing stands OPEN from 05:00
     to 21:00. So a man whose brain wanted the hall (a grudge, a friend, a
     fight, the player standing four metres away) was aimed through his open
     door by entities/ai.js at order 22, stepped into it by the mover, and
     shoved back by the order-22.6 pass — a body on a treadmill in its own
     doorway, walk cycle playing, going nowhere. Measured (tools/visual-
     presets/prison-cell-free.mjs): a hunted resident ending six seconds
     0.62 m INSIDE his open door with the player in plain sight.

     Now the leash HOLDS a man only while his own leaf is shut and he is
     behind it. With the door open he is an inmate of the wing: his wander
     box is the aisle outside his door, systems/navgrid.js walks him through
     the leaf like anybody else, and systems/prisonschedule.js musters him
     home at the evening count exactly as it does the yard's men — his own
     rack, through his own door, via the route it already authors. The cell
     keeps one claim on a free man: a resident whose trait is his bunk sits
     on it until something gives him a reason to get up, and then he is
     gone rather than pinned.
     ========================================================== */
  function inBox(b, p, pad) {
    return p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.z >= b.z0 - pad && p.z <= b.z1 + pad;
  }
  function cellBox(c) { return { x0: c.x - c.hx, x1: c.x + c.hx, z0: c.z - c.hz, z1: c.z + c.hz }; }
  // "is the cell holding this man right now" — shut leaf, and he is behind it.
  // A man locked OUT of his cell is not held: he is a straggler for the
  // schedule and prisonrest to deal with, the same as any other inmate.
  function held(n) {
    if (!n || n === "player" || n._cellIdx == null || n._cellIdx < 0 || !n.group) return false;
    const c = cells[n._cellIdx];
    if (!c || c.owner !== n || !c.locked) return false;
    return inBox(cellBox(c), n.group.position, 0.4);
  }
  // nothing in the brain wants him anywhere: the only state a man lounges in
  function calm(n) {
    return !(n.ko > 0) && !n.intimidMode && !(n.huntPlayer > 0) && !n.approach && !n.rage
      && (!n.aiState || n.aiState === "wander");
  }
  /* His wander box follows the door — the room while it is shut, the aisle
     while it is open. NOT while systems/prisonschedule.js has him mustered:
     it saves `region` into `_dayRegion` and restores it after the count, and
     would restore whatever this wrote over its own 2.2 m patch. */
  function wanderBox(c, n, hold) {
    if (n._muster || n._dayRegion) return;
    const want = hold ? c.room : c.aisle;
    if (n.region !== want) n.region = want;
  }
  /* SIT ON YOUR OWN BUNK — and STAY sat.

     THE FLICKER, MEASURED (2026-09-04, tools: a per-frame position trace with
     the writer's stack on every jump): Bishop, cell 14, socialising with a
     man he could not reach, moved 1,836 m in sixty seconds without leaving
     his cell. Every frame: the pre-pass unseated him (stepClearOfBunk, +0.5 m),
     the post-pass pinned him back onto the mattress WITHOUT the sit pose, the
     wall resolver threw the standing body out of the frame (-0.5 m), and the
     next pre-pass found a standing man at the entry point and sat him down
     again. At the 21:30 count three ground-floor men did the same at 60 m a
     second. Two faults, one function:

       · THE ENTRY POINT WAS THE SEAT PLUS HALF A METRE, and "am I still
         walking" was `distance to the entry > 0.5`. A seated man's distance
         to the entry is 0.5 by construction, so floating point decided every
         frame whether he had arrived. A seated body needs a HYSTERESIS: he
         gets up for a reason (the brain wants out, a fight, a shove of more
         than a metre), never because a threshold was re-measured.
       · THE POST-PASS PINNED A STANDING MAN INTO THE FRAME. Only the pre-pass
         has a pose to give him; the post-pass may re-pin a body that is
         SEATED and was nudged, and nothing else.

     THE ENTRY POINT IS A BODY'S RADIUS CLEAR OF THE FRAME, NOT OF THE SEAT.
     The "back" style seats a man INSIDE the mattress (b.x + 0.06), and an
     entry measured off THAT sat on the frame's own collider edge — a point
     the wall resolver never let a 0.5 m body reach. Measured: Kessler,
     cell 11, 4.4 of 4.8 s stalled at x 13.72 walking at an entry at 14.24 =
     the frame's edge, legs going, gaining nothing — the "stuck in cell" in
     the owner's own words. A man who still makes no progress toward the
     entry (something else in the way) gives the bunk up for a while instead
     of pressing into it for as long as he is calm. */
  const LOUNGE_ARRIVE = 0.75;   // metres from the entry at which the sit begins (mover stops at 0.3; the frame holds a body 0.08 short)
  const LOUNGE_HOLD = 1.1;      // a seated man shoved further than this off his seat stands up
  const LOUNGE_STALL = 1.5;     // seconds of no progress toward the entry before he gives it up
  const LOUNGE_GIVEUP = 25;     // ...and for how long
  function loungeEntry(c, s) {
    const b = c.bunk;
    const lat = c.dz !== 0 ? 1 : c.dx;
    const wide = b.along === "z" ? b.latOut : b.lonOut;
    return { x: b.x + lat * (wide + BODY_R + 0.08), z: s.z };
  }
  function lounge(c, n, dt, pre) {
    const s = postIn(c, "bunk");
    const p = n.group.position;
    const seated = !!(n.char && n.char.sitting);
    // THE BUNK IS HIS ROUTINE while this runs: entities/npc.js's calm routine
    // otherwise parks him mid-walk for a stretch ("stand"/"activity" write
    // `target` back to where he is and hand the mover a speed of zero), and
    // a man told "walk to your bunk" by one system and "stand there" by the
    // other every frame is a man who does neither. `walk` leaves the target
    // alone.
    if (pre) { n._lifeActivity = "walk"; n._lifeT = Math.max(n._lifeT || 0, 2); }
    if (seated) {
      if (Math.hypot(p.x - s.x, p.z - s.z) > LOUNGE_HOLD) { if (pre) unseat(n, c); return; }
      p.x = s.x; p.z = s.z;
      if (!pre) return;
      n.target.set(s.x, 0, s.z);
      n.pause = Math.max(n.pause || 0, 0.6);
      loungeFace(c, n, s, dt);
      return;
    }
    const e = loungeEntry(c, s);
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > LOUNGE_ARRIVE) {
      if (!pre) return;
      // no progress counts only while he is actually being walked: a man
      // stood still by his own routine (a stretch, a spell at the wall — the
      // mover's velocity is zero and he is not paused) is not stuck
      // ...and only within reach of it: a man held up across the room (a
      // crowd in the door, a fight in the aisle) has not found the frame in
      // his way, and must not lose his bunk to that
      const trying = !(n.pause > 0) && d < 2.5 && Math.hypot(n._vx || 0, n._vz || 0) > 0.3;
      const prog = n._lgD == null ? 1 : n._lgD - d;
      n._lgD = d;
      n._lgStall = !trying ? (n._lgStall || 0) : (prog < 0.004 ? (n._lgStall || 0) + dt : 0);
      if (n._lgStall > LOUNGE_STALL) {
        n._lgStall = 0; n._lgD = null; n._bunkGiveUp = LOUNGE_GIVEUP;
        n.pause = 0;
        return;
      }
      n.target.set(e.x, 0, e.z); n.pause = 0;
      return;
    }
    if (!pre) return;   // no pose to give in the post-pass: a standing body in the frame is a body the wall resolver throws out
    n._lgD = null; n._lgStall = 0;
    p.x = s.x; p.z = s.z;
    n.target.set(s.x, 0, s.z);
    n.pause = Math.max(n.pause || 0, 0.6);
    loungeFace(c, n, s, dt);
    if (n.char && CBZ.setCharPose) {
      // `kind` is not decoration: entities/character.js's SEAT_POSTURE
      // reads it — edge is the ducked bunk perch, back/brace are the two
      // relaxed reads of the same mattress. `ceiling` is the upper deck's
      // underside so the pose ducks this particular body under it.
      const style = n._bunkStyle || (n._bunkStyle = bunkStyle(c));
      n.char.seatRef = n.char.seatRef || { cushion: c.bunk.top, floorBelow: c.fy,
        ceiling: c.bunk.deckY || 0, kind: SEAT_KIND[style] || "bunk" };
      CBZ.setCharPose(n.char, "sit");
    }
  }
  // FACE OUT OF THE BED for the edge/brace perch; the "back" style publishes
  // its own yaw (down the mattress, against the pillow wall).
  function loungeFace(c, n, s, dt) {
    const face = s.face == null ? Math.atan2(c.dx, c.dz) : s.face;
    n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, face, 1 - Math.pow(0.02, dt));
  }
  // the bunk trait, asked once per man per pass: on, and not given up for now
  function wantsBunk(n, dt, pre) {
    if (n._cellPose !== "bunk") return false;
    if (n._bunkGiveUp > 0) { if (pre) n._bunkGiveUp -= dt; return false; }
    return true;
  }

  /* One pass of the cell leash over every occupied cell. `pre` runs before the
     mover and owns the DECISIONS (the post, the pause, the facing); the post-
     mover pass only re-clamps a body that was pushed since. */
  function leashPass(dt, pre) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], n = c.owner;
      if (!n || n === "player") continue;
      if (n.dead || n.escaped) { if (pre) unseat(n, c); continue; }
      // A BODY IN ITS BUNK IS NOT A BODY TO BE CLAMPED. Once systems/
      // prisonrest.js has put a man to bed (or a propuse arc is walking him
      // to it) the transform belongs to that hold: propuse re-pins the lie
      // spot at order 42, and an AABB clamp or a target write here would be
      // two systems arguing over one Vector3 — the exact way a body vibrates
      // in place that prisonschedule.js's herd() already warns about.
      if (n._propLie || n._propBed || (CBZ.propArcActive && CBZ.propArcActive(n))) continue;
      const hold = held(n);
      if (pre) wanderBox(c, n, hold);
      if (!hold) {
        // THE DOOR IS OPEN (or he is already through it): no box, no post.
        // entities/ai.js owns him. The one thing the cell still asks is the
        // bunk trait, and only of a calm man who is actually in the room.
        if (!wantsBunk(n, dt, pre) || !c.bunk || !calm(n) || !inBox(cellBox(c), n.group.position, 0)) {
          if (pre) unseat(n, c);
          continue;
        }
        if (n.char && !seatFits(n.char, c.bunk.headroom)) { n._cellPose = "bars"; unseat(n, c); continue; }
        lounge(c, n, dt, pre);
        continue;
      }
      // A REAL BRAIN STATE OUTRANKS THE POST — the same precedence poses.js
      // documents: hands-up, a KO or a hunt owns the rig, and the held pose
      // must LET GO rather than freeze a seated body mid-fight. The box still
      // holds: a fight inside a LOCKED cell is a fight inside THAT cell.
      const owned = n.ko > 0 || n.intimidMode || n.huntPlayer > 0
        || n.aiState === "fight" || n.aiState === "flee";
      const pose = owned ? "pace" : (n._cellPose === "bunk" && !wantsBunk(n, dt, pre) ? "pace" : n._cellPose);
      // A bunk too low for this rig is not this man's bunk — `seatFits`
      // measures HIS body against the clearance the bunk PUBLISHES, so the
      // overlap is unreachable rather than "fixed by being taller". The
      // fallback is a pose this wing already has, not a special case.
      if (pose === "bunk" && (!c.bunk || (n.char && !seatFits(n.char, c.bunk.headroom)))) {
        n._cellPose = "bars"; unseat(n, c); continue;
      }
      const b = paceBox(c, pose === "bunk");
      const p = n.group.position;
      clampInto(b, p);
      // an upper resident's feet are on the tier. Nothing else in the game
      // writes an inmate's y (ai.js's restart reset zeroes it), so the cell
      // that holds him is what puts him back on his own floor.
      if (c.fy) p.y = c.fy;
      if (n.target) clampInto(b, n.target);
      if (owned) { if (pre) unseat(n, c); continue; }
      if (pose === "bunk") {
        lounge(c, n, dt, pre);
      } else if (pose === "bars" && pre) {
        const s = postIn(c, pose);
        n.target.set(s.x, 0, s.z);
        // THE SETTLE RADIUS IS THE MOVER'S. entities/npc.js stops walking at
        // 0.4 m of the target; a post that only counts as reached at a
        // TIGHTER radius than that is a post nobody ever reaches, so the man
        // paces the last handspan forever. Half a metre of Euclidean slack
        // clears the mover's own stop distance with room to spare.
        if (Math.hypot(p.x - s.x, p.z - s.z) < 0.5) {
          n.pause = Math.max(n.pause || 0, 0.5);
          n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(c.dx, c.dz), 1 - Math.pow(0.02, dt));
        }
      }
    }
  }

  /* THE LAST WORD BEFORE THE MOVER. entities/npc.js's brain writes `target`
     at order 22 — AFTER the pre-pass and BEFORE the step — so a hunt, a flee
     or a friend in the hall aimed a HELD man through his own bars every
     frame, the mover stepped him into the leaf and the post-pass took the
     step back: the same treadmill, at a door that is genuinely shut. npc.js
     calls this right before it moves anybody; a held man's target is clamped
     into his box here, so the navigator is handed a point he can reach and he
     walks to the bars and STOPS there, facing whatever he wanted. */
  CBZ.npcConfine = function (n) {
    if (!n || !n.target || !n.group) return false;
    if (held(n)) {
      const c = cells[n._cellIdx];
      clampInto(paceBox(c, !!(n.char && n.char.sitting)), n.target);
      return true;
    }
    /* A FREE MAN CROSSES A CELL LINE THROUGH ITS LEAF. The brain aims at a
       friend, a foe or a bed as a point, and a point inside a cell is reached
       through a 1.6 m opening in a 3.8 m box. systems/navgrid.js copes with
       the aisles but a goal pressed against a bunk frame comes back PARTIAL
       — "the reachable cell nearest the goal", which from the next cell over
       is the partition between them — and that was three men grinding at
       walls the first hour this wing let them out (tools/prison-nav-check).
       So the target is staged: out of the cell he is in through its own
       door, and into the cell he wants through that one's door. Both legs
       land in open aisle, where the navigator is already right. */
    if (n._propLie || n._propBed || (CBZ.propArcActive && CBZ.propArcActive(n))) return false;
    const p = n.group.position, t = n.target;
    const from = cellAt(p.x, p.z, -0.25), to = cellAt(t.x, t.z, -0.25);
    if (from === to) return false;
    if (from) {                                    // leave through my own door
      const m = facePoint(from, (from.oa + from.ob) / 2, 1.3);
      t.x = m.x; t.z = m.z;
      return true;
    }
    if (to) {                                      // enter through that one's door
      /* THE DOOR LANE, NOT A RADIUS. This used to aim at the mouth (1.3 m
         out) until he was within 0.7 m of it, then at a point 0.9 m inside
         — and the moment he was 0.7 m past the mouth on his way IN, the test
         aimed him back OUT at it. A man walking home at the count ping-
         ponged in his own doorway for the whole block (measured: 129 s of
         door-band stall across the cast, 44 bodies grinding, every trace a
         target flipping between x -10.4 and -12.6). Once he is in the lane
         through the leaf — level with the mouth or nearer, and inside the
         opening's width — the point inside is the only thing he aims at. */
      const mid = (to.oa + to.ob) / 2;
      const depth = to.dx !== 0 ? (p.x - to.faceX) * to.dx : (p.z - to.faceZ) * to.dz;
      const lat = to.dx !== 0 ? p.z - (to.faceZ + mid) : p.x - (to.faceX + mid);
      const inLane = depth < 1.45 && Math.abs(lat) < DOOR_W / 2 + 0.15;
      const aim = facePoint(to, mid, inLane ? -0.9 : 1.3);
      t.x = aim.x; t.z = aim.z;
      return true;
    }
    return false;
  };

  // pass one: BEFORE entities/npc.js's order-22 mover, so the step it takes is
  // a step toward somewhere this file will let him stand.
  CBZ.onUpdate(21.9, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape" || !cast || !postV2()) return;
    leashPass(dt, true);
  });

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
    //
    //      IT RUNS TWICE, AND THE FIRST PASS IS THE ONE THAT MATTERS. A clamp
    //      that only runs AFTER entities/npc.js (order 22) can never do better
    //      than undo the step the mover just took — undoing a step every frame
    //      forever is precisely the flicker. Pass one (order 21.9, `pre`)
    //      settles where the man is ALLOWED to go before he is moved; pass two
    //      (order 22.6) is the cheap safety net that catches the step itself.
    leashPass(dt, !postV2());
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
  // `y` is optional: without it the GROUND cell at (x,z) answers, which is
  // what every existing caller (capture, lockdown, the schedule) means. With
  // it, the storey whose floor band holds y.
  function cellAt(x, z, pad, y) {
    pad = pad || 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (y != null ? (y < c.fy - 0.5 || y > c.fy + CH) : c.tier) continue;
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
      if (c.player || c.tier || (c.owner && c.owner !== "player")) continue;
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
      // by reference, never mutated: `room` and `aisle` are the cell's own
      npc.region = c.locked ? c.room : c.aisle;
      if (npc.group) npc.group.position.set(c.x, c.fy || npc.group.position.y || 0, c.z);
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
    bunkStyle: bunkStyle,
    // "is the cell holding this man right now" — shut leaf, and he is behind
    // it. systems/prisonschedule.js musters everybody this says no to.
    held: held,
    // geometry other systems may want without re-deriving it
    height: CH, doorWidth: DOOR_W,
    /* THE HALL PUBLISHES ITS OWN HALF-WIDTH: the clear floor between the two
       gallery edges (the cell fronts less the deck cantilevered off them),
       minus a little. A route test may not retype the route's width — it
       reads it here so its samples stay inside the lane by construction. */
    hallHalf: Math.abs(WFACE) - GW - 0.5,
    bounds: { minX: IX0, maxX: IX1, minZ: IZN, maxZ: -7.5 },
    // the tier, for anything that wants to know there is one
    tiers: 2, tierFloor: FY, galleryWidth: GW,
  };

  /* IS THE MAN ON HIS BUNK ACTUALLY ON IT — measured, not eyeballed.
     One number per seated body: how far his hips are from the bunk's centre
     line, across the mattress. The mattress half-width is MLAT/2 = 0.525
     (bunkRig), so anything beyond that is a body sitting on air in front of
     his own bed, and `offMattress` is the count of them. A storyboard can
     publish this beside the picture instead of arguing about the picture. */
  const MATT_HALF = 0.525, MATT_HALF_LON = 1.175;
  CBZ.cellSitAudit = function () {
    const out = { seated: 0, offMattress: 0, worstOverhangCm: 0, latCm: [], styles: {} };
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], n = c.owner;
      if (!n || n === "player" || !c.bunk || !n.group) continue;
      if (n._cellPose !== "bunk" || !n.char || !n.char.sitting) continue;
      const lat = Math.abs(n.group.position.x - c.bunk.x);
      // Both axes, because "back" sits down the bed rather than across it and
      // an audit that only measured lateral drift would pass a man sitting on
      // the pillow, in mid-air, at the head end.
      const lon = Math.abs(n.group.position.z - c.bunk.z);
      const st = n._bunkStyle || "edge";
      out.styles[st] = (out.styles[st] || 0) + 1;
      out.seated++;
      out.latCm.push(Math.round(lat * 100));
      const over = Math.max(lat - MATT_HALF, lon - MATT_HALF_LON);
      if (over > 0) {
        out.offMattress++;
        if (over * 100 > out.worstOverhangCm) out.worstOverhangCm = Math.round(over * 100);
      }
    }
    return out;
  };

  /* ==========================================================
     WHAT THIS PRISON CAN SLEEP — counted from actual mattresses.

     The named playable cast is the population to house. Treating a 26-bed
     cell wing as permission to scatter sixteen permanent floor mats through
     its dayroom made the arithmetic pass and the venue fail. The compound has
     two authored housing units: these twenty-eight double cells and the
     south-block open-bay dorm. Both call the same bunk builder above; both
     publish the records they actually draw; every population/rest consumer
     reads their sum.

     Design occupancy is therefore 1.0 here. Overcrowding can still be a live
     simulation fact (the audit reports bodies minus beds), but it is no longer
     used as a content generator that adds people or bedding to circulation.

     AND THE SUM IS NOW BIGGER THAN THE CAST, WHICH IT WAS NOT. 24 cells x 2
     racks + 8 dorm stacks x 2 = 64 beds against 59 prisoner rigs, measured
     live at the night block: `CBZ.prisonRestAudit().sleepGap` -5. At 13 cells
     it was 42 against 50 and the same figure read +8 the moment
     systems/prisonrest.js stopped counting only the men whose `role` happened
     to say "inmate". Every one of the 22 racks added is a real propuse anchor
     through `useBed` above and the pending-fittings queue — `beds` rises with
     `racks` or the wing is drawing mattresses nobody can lie on, which is
     what tools/prison-beds-check.mjs asserts as two numbers on one line.
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
  // reported, never added to `beds` — see `_punitive` above.
  function punitiveRackCount() {
    let n = 0;
    for (let i = 0; i < punitiveStacks.length; i++) {
      const b = punitiveStacks[i] && punitiveStacks[i].bunk;
      if (b) n += b.topBunk ? 2 : 1;
    }
    return n;
  }
  CBZ.prisonBeds = function () {
    const beds = rackCount();
    const cellBeds = cellRackCount();
    return { cells: cells.length, perCell: cells.length ? +(cellBeds / cells.length).toFixed(2) : 0,
      beds: beds, racks: beds, housingStacks: housingStacks.length,
      punitiveRacks: punitiveRackCount(),      // real beds, deliberately not capacity
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
      if (c.y0 != null && c.y0 >= 1.8) continue;                  // a gallery rail is not in a lane
      if (c.minX < 3.2 && c.maxX > -3.2 && c.minZ < -6.5 && c.maxZ > -9.5) gap++;
      if (c.minX < R && c.maxX > -R && c.minZ < -12 && c.maxZ > -40) spine++;
    }
    let floating = 0;
    for (let i = 0; i < cages.length; i++) if (!cages[i].hung) floating++;
    let occupied = 0, empty = 0, locked = 0;
    /* seatDrift (SIT_PHYS_V1) — bunk-posed residents NOT at their bunk spot.
       The leash pins a "bunk" man to bunkSpot every frame at order 22.6;
       systems/actorcollide.js's clamp at order 25 used to depenetrate him
       back out of the (now solid) frame — measured at latOut + body radius =
       1.06 m into the room, ten men at once, each seated on air half a metre
       clear of his own mattress. The number is the fault: geometry only, no
       flag reads, so a revert run measures the defect and a fixed run pins 0.
       Fight/flee/KO men are excluded — unseat() owns them, not the pin. */
    let seatDrift = 0;
    /* postDrift (CELL_POST_V2) — residents being walked at a post their own
       leash forbids. Pure geometry: the man's live target measured against the
       box this file clamps him to. A non-zero reading IS the flicker — the
       mover spends every frame closing on a point the clamp spends every frame
       taking back. Was 12 of 20 on the shipped wing; pinned at 0. */
    let postDrift = 0;
    // cells per row, off the cells' OWN tags — so "how big is this wing"
    // cannot be answered by a number typed anywhere but the row tables.
    const rows = {};
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const r = String(c.tag || "?").split("-")[0];
      rows[r] = (rows[r] | 0) + 1;
      if (c.locked) locked++;
      if (c.owner && c.owner !== "player") occupied++; else empty++;
      const n = c.owner;
      if (n && n !== "player" && n.group && n.char && n.char.sitting
          && n._cellPose === "bunk" && c.bunk
          && !(n.ko > 0) && !n.intimidMode && !(n.huntPlayer > 0)
          && n.aiState !== "fight" && n.aiState !== "flee"
          && !(CBZ.propArcActive && CBZ.propArcActive(n))) {
        const sp = bunkSpot(c, bunkStyle(c)), p = n.group.position;
        if (Math.hypot(p.x - sp.x, p.z - sp.z) > 0.3) seatDrift++;
      }
      // …and only of a man the cell is actually HOLDING: with his leaf open
      // his target is the wing's business, not this box's.
      if (n && n !== "player" && n.target && !n.dead && !n.escaped && !(n.ko > 0) && held(n)
          && !n._propLie && !n._propBed && !(CBZ.propArcActive && CBZ.propArcActive(n))
          && n.aiState !== "fight" && n.aiState !== "flee" && !n.intimidMode && !(n.huntPlayer > 0)) {
        const bx = paceBox(c, n._cellPose === "bunk"), t = n.target;
        if (t.x < bx.x0 - 1e-3 || t.x > bx.x1 + 1e-3 || t.z < bx.z0 - 1e-3 || t.z > bx.z1 + 1e-3) postDrift++;
      }
    }
    const pc = playerCell;
    const margin = pc ? Math.min(pc.hx - Math.abs(s.x - pc.x), pc.hz - Math.abs(s.z - pc.z)) : 0;
    return {
      v2: true, cells: cells.length, rows: rows, tiers: 2,
      floatingFixtures: floating,                            // MUST be 0
      occupied: occupied, empty: empty, locked: locked, vacantWanted: EMPTY_WANTED,
      castDealt: cast,
      spawnInPlayerCell: !!(pc && margin > 0),
      spawnMargin: Math.round(margin * 100) / 100,          // metres of cell around CBZ.SPAWN
      spawnBlocked: spawnBlocked,                            // MUST be 0
      doorGapBlocked: gap,                                   // MUST be 0
      spineBlocked: spine,                                   // MUST be 0
      seatDrift: seatDrift,                                  // MUST be 0 (SIT_PHYS_V1)
      postDrift: postDrift,                                  // MUST be 0 (CELL_POST_V2)
      colliders: mine.length,
      lamps: lamps.length + 1,
    };
  };
})();
