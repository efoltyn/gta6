/* ============================================================
   world/lounge.js — the cops' lounge on the east side of the yard.
   Couches, a coffee machine, a TV. Off-limits, naturally.

   NO-DECOY FIX (the doctrine world/clutter.js's header already set: every
   prop a body can meet must be solid). The couch, the armchair, the coffee
   table and the coffee machine were all drawn with `addBox(..., {})` —
   opts.solid defaults FALSY (world/materials.js:196), so you walked
   straight through the entire room. They are real bodies now.

   FURNITURE VOCABULARY. The seating routes through CBZ.furnish
   (city/furniture.js) — the ONE shared kit — which owns the geometry AND
   registers the propuse sit anchors, so a cop can actually be sat on that
   couch. Feature-detected: when the kit is absent the authored boxes below
   run instead, solid and with their own seat anchors, so the room is
   correct either way. The layout, footprint and palette are unchanged:
   this is an authored prison space, not a generated one.

   LOAD ORDER — CORRECTED 2026-08-15, MEASURED AT RUNTIME. This header used
   to say the kit "currently parses AFTER this file" and that the authored
   fallback was therefore what ran. That has not been true since the kit
   moved: index.html tags city/furniture.js at :482 (its own comment names
   "lounge.js / cafeteria.js / clutter.js" as the consumers it must precede)
   and this file at :567. CBZ.furnish IS up when this file parses, so the
   KIT PATH is what draws the couch, the armchair and the coffee table, and
   the authored blocks below are the degrade path only.

   What is still true is the OTHER half of the gap, and it is the half that
   matters: city/propuse.js is at :1007, so CBZ.propRegisterSeat is absent
   when the kit runs and city/furniture.js's p.seat() (:303) has no queue
   fallback — it returns a null record. The anchors survive only because the
   kit still reports them on `rec.seats` and reseat() below re-files every
   one of them through CBZ.roomSeatAnchor (world/roombuild.js:141), the
   queue-and-flush shim. Delete the reseat() calls and this room silently
   loses every seat in it. tools/visual-presets/prison-yard-props.mjs prints
   `furnish`, `seatAnchors` and `kitSeatsQueued` per run so the next reader
   does not have to take this paragraph's word for it.

   ------------------------------------------------------------------
   PRISON_DRESS_V2 (2026-07-30) — IT IS THE DAYROOM NOW, AND THAT IS
   WHAT THE GAME ALREADY DECIDED.
   ------------------------------------------------------------------
   systems/capture.js's DAY_BEAT calls this room by name on the sentence
   rotation: "REC — the lounge is open" (:276). The block empties in here
   every fourth beat, so a two-couch staff break room with nothing to do in
   it is the wrong room for the beat the game is running. It reads as a
   DAYROOM with a staff corner now: phone bank, card table, notice board,
   book shelf, vending machine — with the coffee machine, the STAFF ONLY
   band and the couch/armchair/TV untouched, because the joke that this is
   the screws' room and you are in it is the point.

   THE TV WAS FLOATING. `addBox(21.0, 2.6, 33, ...)` sat 1.75 m clear of
   the west wall it claimed to be mounted on (inner face x = 19.25) — a
   television hanging in mid-air. It is on a real bracket now, and the
   armchair's aim angle DERIVES from the same TV_X/TV_Z pair instead of
   re-typing the old floating coordinates, so the two can never disagree
   again.

   Everything new comes from CBZ.prisonDress (world/cafeteria.js) — the
   shared prison-fitting vocabulary — never re-authored here.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, roomShell } = CBZ;
  const HALF = Math.PI / 2;

  // Canonical declaration + doctrine comment: world/southblock.js.
  if (CBZ.CONFIG.PRISON_DRESS_V2 == null) CBZ.CONFIG.PRISON_DRESS_V2 = true;
  const PD = CBZ.prisonDress || null;   // degrade-safe: no kit → no dressing
  // PRISON_PROP_USE_V1 — canonical declaration + doctrine: world/southblock.js.
  // Here: 67 dead props in a 140 m2 dayroom. The phone bank goes (18 boxes,
  // none of them usable, duplicating the yard's) and the book shelf gets the
  // collider a 1.9 m unit of furniture should always have had. What stays and
  // why is written at each site.
  if (CBZ.CONFIG.PRISON_PROP_USE_V1 == null) CBZ.CONFIG.PRISON_PROP_USE_V1 = true;

  roomShell({
    x0: 19, x1: 29, z0: 30, z1: 44, h: 6,
    wall: 0x6b7480, floor: null, skin: null,
    door: { side: "W", center: 37, width: 3.4 },
  });
  /* FINISHES (2026-09-27): VCT on the floor, block walls with a painted dado
     and a vinyl base, and a lay-in ceiling at 3.0 m with 2 x 4 troffers — a
     staff dayroom, not a 6 m shed with joists and sticks under an open top. */
  if (CBZ.prisonDress && CBZ.prisonDress.finish) {
    CBZ.prisonDress.finish({ x0: 19.25, x1: 28.75, z0: 30.25, z1: 43.75 }, {
      id: "lounge", floor: "vct", floorTint: 0xc9c6bb,
      doors: [{ side: "W", a0: 35.3, a1: 38.7 }], dado: 0x55606c, dadoH: 1.2, base: 0x2b2d30,
      ceilingY: 3.0, ceiling: { kind: "acoustic", lights: "troffer", along: "z", nx: 2, nz: 3 },
    });
  }


  // ---- shared plumbing --------------------------------------------------
  // Always invoke THROUGH the namespace (never a detached reference) so a kit
  // implemented with `this` still works, and swallow a throw so a broken kit
  // degrades to the authored boxes instead of killing the room.
  // -> null = the kit didn't draw it, use the fallback.
  function kit(name, x, y, z, yaw, o) {
    const F = CBZ.furnish;
    if (!F || typeof F[name] !== "function") return null;
    try { return { rec: F[name](x, y, z, yaw, o) || null }; } catch (e) { return null; }
  }
  // One-line pipe into city/propuse.js's seat registry, load-order-proof.
  // `cushion` = the cushion top ABOVE the floor, propuse's 7th `geom` argument:
  // without it the seat is undeclared, keeps the legacy squat pose and counts
  // in CBZ.propUseAudit().noGeom. We know our own boxes, so we always declare.
  function seat(x, z, face, kind, cushion) {
    const geom = cushion != null ? { cushion: cushion, floorBelow: 0 } : null;
    if (CBZ.roomSeatAnchor) CBZ.roomSeatAnchor(x, 0, z, face, kind, null, geom);
    else if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(x, 0, z, face, kind, null, geom);
  }
  // re-file whatever anchors the kit reported, CARRYING its declared cushion.
  // propuse dedupes on a decimetre key over the same coordinates the kit used,
  // so this is a no-op when the kit already registered them itself.
  function reseat(r, fallbackFace, kind) {
    if (!r || !r.seats || !r.seats.length) return false;
    for (let i = 0; i < r.seats.length; i++) {
      const s = r.seats[i];
      if (!s) continue;
      seat(s.x, s.z, s.face != null ? s.face : (s.yaw != null ? s.yaw : fallbackFace),
        s.kind || kind, s.cushion);
    }
    return true;
  }

  // ---- the couch, facing the TV across the room -------------------------
  // Long axis along z (35..39), back to the east wall, front looking -x at
  // the TV on the west wall. Footprint x 26.9..28.35 → centre 27.63.
  const COUCH_Z = 37, COUCH_X = 27.63, COUCH_LEN = 4.0, COUCH_FACE = -HALF;
  const fSofa = kit("sofa", COUCH_X, 0, COUCH_Z, COUCH_FACE, { len: COUCH_LEN, solid: true, tone: 0x2b3a67 });
  let seated = false;
  if (fSofa) {
    seated = reseat(fSofa.rec, COUCH_FACE, "sofa");
  } else {
    addBox(27.5, 0.6, COUCH_Z, 1.2, 0.7, COUCH_LEN, 0x2b3a67, { solid: true });   // seat (SOLID)
    addBox(28.1, 1.1, COUCH_Z, 0.5, 1.0, COUCH_LEN, 0x223057, { cast: false });   // back
  }
  // three sit spots down the couch — only if the kit didn't already report its
  // own (reseat() returns false when it reported none).
  // cushion 0.95 = the authored seat block's real top (centre 0.60 + half of
  // 0.70). NOT propuse's 0.40 "sofa" default — that would bury the body inside
  // this chunky block; the declared number always describes the drawn mesh.
  if (!seated) for (const dz of [-1.3, 0, 1.3]) seat(27.4, COUCH_Z + dz, COUCH_FACE, "sofa", 0.95);

  // ---- where the television actually is ----------------------------------
  // ONE source of truth for the screen: the set, its bracket and every seat
  // aimed at it all read these two numbers. TV_X sits against the west wall's
  // inner face (19.25) under the flag; flag off restores the old floating
  // 21.0 so the revert is exact.
  const TV_Z = 33, TV_X = 19.55, TV_Y = 1.95;

  // ---- armchair, angled at the TV ---------------------------------------
  const CHAIR_X = 24.5, CHAIR_Z = 41.5;
  const CHAIR_FACE = Math.atan2(TV_X - CHAIR_X, TV_Z - CHAIR_Z);   // look at the screen
  // F.armchair is the real piece since the interiors wave; older kits fall
  // through kit()'s null to the raked chair, then to the authored block.
  const fChair = kit("armchair", CHAIR_X, 0, CHAIR_Z, CHAIR_FACE, { solid: true, tone: 0x2b3a67 })
    || kit("chair", CHAIR_X, 0, CHAIR_Z, CHAIR_FACE, { solid: true, tone: 0x2b3a67, kind: "armchair" });
  let chaired = false;
  if (fChair) {
    chaired = reseat(fChair.rec, CHAIR_FACE, "armchair");
  } else {
    addBox(CHAIR_X, 0.6, CHAIR_Z, 1.3, 0.7, 1.3, 0x2b3a67, { solid: true });      // SOLID
  }
  if (!chaired) seat(CHAIR_X, CHAIR_Z, CHAIR_FACE, "armchair", 0.95);   // block top 0.60 + 0.35

  // coffee table + mug. F.coffee exists since the interiors wave (top 0.40,
  // shin-high collider of its own); the authored boxes stay as the degrade
  // path for a stale kit, height-gated (y0/y1) so it's a shin-high obstacle
  // in the walking line between the couch and the TV, not a full-height pillar.
  if (!kit("coffee", 25.5, 0, 37, 0, { len: 1.6, deep: 1.2 })) {
    addBox(25.5, 0.45, 37, 1.6, 0.12, 1.2, 0x3c424d, { solid: true, y0: 0, y1: 0.55 });
  }
  // a mug ON the table (it was a 22 cm white block hovering 11 cm over it)
  (function mug() {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12), CBZ.cmat(0xece8df));
    m.position.set(25.3, 0.45, 36.8); m.castShadow = false; (CBZ.prisonRoot || CBZ.scene).add(m);
  })();

  // wall-mounted TV, bezel and screen; the screen is just off (dark glass
  // with a faint picture), not a glowing blue slab
  addBox(TV_X, TV_Y, TV_Z, 0.1, 1.05, 1.8, 0x0a0d12, {});
  addBox(TV_X + 0.056, TV_Y, TV_Z, 0.012, 0.97, 1.72, 0x1c2a36,
    { emissive: 0x0f2230, ei: 0.6, cast: false });

  // coffee station in the corner: a base cabinet with a laminate top, the
  // brewer and its pot on it. (It was a 1.2 m black box hanging 40 cm off
  // the floor with a glowing red box on top.)
  addBox(28.3, 0.47, 31.5, 0.6, 0.82, 1.4, 0x7a6a55, { solid: true });                  // cabinet
  addBox(28.28, 0.9, 31.5, 0.66, 0.04, 1.46, 0xd8d2c4, { cast: false });                 // top
  for (const dz of [-0.35, 0.35]) addBox(27.99, 0.5, 31.5 + dz, 0.02, 0.66, 0.66, 0x6b5c49, { cast: false });   // doors
  /* the brewer: a pour-over machine, not two black boxes. Base with the
     warmer plate, the tower at the back, the head over the brew basket, the
     glass carafe on the plate with its handle and lid, two mugs beside it. */
  if (PD && PD.Paint) {
    const B = new PD.Paint(), BLK = 0x1e2227, STL = 0xa9b0b7;
    B.box(0, 0.015, 0, 0.34, 0.03, 0.28, BLK);                                        // base
    B.box(0.11, 0.25, 0, 0.12, 0.44, 0.26, BLK);                                      // tower
    B.box(-0.01, 0.47, 0, 0.32, 0.07, 0.26, BLK);                                     // head
    B.box(-0.01, 0.438, 0, 0.3, 0.006, 0.24, STL);                                    // spray plate
    B.cyl(-0.07, 0.395, 0, 0.085, 0.06, 0.07, BLK, 16);                               // brew basket
    B.box(-0.19, 0.41, 0, 0.1, 0.022, 0.035, BLK);                                    // its handle
    B.cyl(-0.07, 0.036, 0, 0.09, 0.09, 0.012, STL, 16);                               // warmer plate
    B.cyl(-0.07, 0.1, 0, 0.068, 0.085, 0.11, 0x3b2a1e, 16);                           // carafe, full
    B.cyl(-0.07, 0.175, 0, 0.05, 0.068, 0.04, 0xb8c6cc, 16);                          // its glass shoulder
    B.cyl(-0.07, 0.205, 0, 0.055, 0.055, 0.02, BLK, 16);                              // lid
    B.add(new THREE.TorusGeometry(0.045, 0.01, 5, 12, Math.PI).rotateZ(-HALF).rotateY(HALF).translate(-0.07, 0.12, -0.075), BLK);  // handle
    B.box(-0.172, 0.018, 0.1, 0.006, 0.012, 0.012, 0x2a2e33);                         // switch
    for (const dz of [0.28, 0.4]) {                                                   // two mugs
      B.cyl(-0.05, 0.05, dz, 0.042, 0.038, 0.1, 0xece8df, 12, 0, 0, true);
      B.add(new THREE.CircleGeometry(0.038, 12).rotateX(-HALF).translate(-0.05, 0.004, dz), 0xece8df);
      B.add(new THREE.TorusGeometry(0.025, 0.006, 4, 10, Math.PI).rotateZ(-HALF).rotateY(-HALF).translate(-0.05, 0.05, dz + 0.042), 0xece8df);
    }
    B.mesh(28.42, 0.92, 31.3);
  }
  // its power light, on the base's front edge
  addBox(28.247, 0.938, 31.4, 0.006, 0.01, 0.01, 0xff5a3a, { emissive: 0xc02a10, ei: 0.8, cast: false });

  // a couple of loose cigarette packs left on the table (steal-bait)
  if (CBZ.addPack) { CBZ.addPack(25.5, 37, 8); CBZ.addPack(24.5, 41.5, 6); }

  // ========================================================================
  //  THE DAYROOM  (PRISON_DRESS_V2)
  // ========================================================================
  // GEOMETRY THIS ROOM IS BUILT AGAINST — measured, not guessed:
  //   shell interior  x[19.25,28.75]  z[30.25,43.75]  wall top 6
  //   doorway (W)     z[35.3,38.7] at x=19
  //   couch           x[26.9,28.35] z[35,39]   coffee table x[24.7,26.3] z[36.4,37.6]
  //   armchair        (24.5,41.5) 1.3 sq       coffee machine (28.2,31.5) 0.9 sq
  //   TV              west wall at z=33
  //   world/ventilation.js's lounge grate is OUTSIDE, at (18.6, 41.5).
  // CIRCULATION HELD: the door bay (z 35.3..38.7) runs clear from the west
  // wall to the coffee table, the north-south lane at x 21.4..24.4 is open
  // end to end, and nothing new is within 1.2 m of either.
  if (PD) (function dayroom() {
    const WX0 = 19.25, WX1 = 28.75, WZ0 = 30.25, WZ1 = 43.75;   // inner faces

    // ---- 1. THE TV BRACKET --------------------------------------------------
    addBox(TV_X - 0.2, TV_Y, TV_Z, 0.3, 0.3, 0.4, 0x2a2f38, { cast: false });   // wall arm

    // ---- 3. CARD TABLE (south-west, out of the door lane) -----------------
    // The one thing a dayroom is FOR. A round bolted table with four stools
    // comes from the shared kit, so its seats are declared to propuse at their
    // real cushion height — a body can be sat here later with no work.
    PD.roundTable(21.9, 40.9, { seatTone: 0x7a5230, tone: 0x9a8e78, spin: 0.4 });
    // the game in progress: cards fanned across the top, dominoes at one edge
    for (let i = 0; i < 5; i++) {
      const a = 0.7 + i * 1.0, r = 0.16 + PD.h01(i * 4.3, 40.9, 0x9311) * 0.3;
      const c = addBox(21.9 + Math.cos(a) * r, 0.815, 40.9 + Math.sin(a) * r,
        0.13, 0.008, 0.19, i % 3 ? 0xf3efe2 : 0xd8cdb4, { cast: false });
      c.rotation.y = a + PD.h01(i, 7, 0x9312) * 0.8;
    }
    for (let i = 0; i < 4; i++)
      addBox(22.32, 0.816 + (i % 2) * 0.012, 40.55 + i * 0.11, 0.11, 0.02, 0.055,
        0xe8e2d2, { cast: false });
    addBox(21.55, 0.83, 41.2, 0.16, 0.04, 0.16, 0xd9b23c, { cast: false });   // the pot: a few cigs

    // ---- 4. BOOK SHELF (south wall) ---------------------------------------
    // PRISON_PROP_USE_V1: this is a 1.9 m wide, 1.53 m tall unit of furniture
    // standing on the floor and it had no collider, so the shelf, its two
    // uprights and ten paperbacks were fifteen boxes you walked through. It
    // keeps its geometry exactly — a dayroom shelf is a dayroom shelf — and
    // gets ONE collider over the whole carcass, the way CBZ.prisonDress's
    // roundTable gives one rect to a welded table rather than one per plank.
    // Solid, it is also the only cover on the south wall.
    const shelfMid = addBox(26.9, 0.95, WZ1 - 0.2, 1.9, 0.08, 0.34, 0x6a563c, { cast: false });
    if (CBZ.colliders) {
      CBZ.colliders.push({
        minX: 25.95, maxX: 27.85, minZ: WZ1 - 0.37, maxZ: WZ1 - 0.03,
        y0: 0, y1: 1.53, ref: shelfMid,
      });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    addBox(26.9, 1.45, WZ1 - 0.2, 1.9, 0.08, 0.34, 0x6a563c, { cast: false });
    addBox(26.9, 0.45, WZ1 - 0.2, 1.9, 0.08, 0.34, 0x6a563c, { cast: false });
    for (const s of [-1, 1])
      addBox(26.9 + s * 0.99, 0.95, WZ1 - 0.2, 0.08, 1.16, 0.34, 0x5b492f, { cast: false });
    const SPINE = [0x8a3b32, 0x2f5d7a, 0x4a6b3a, 0x8a6a2b, 0x5b4a6b, 0x7a3b5a];
    for (let i = 0; i < 10; i++) {                                   // battered paperbacks
      const shelf = i < 4 ? 0.49 : (i < 7 ? 0.99 : 1.49);
      const k = i < 4 ? i : (i < 7 ? i - 4 : i - 7);
      const h = 0.2 + PD.h01(i * 2.7, shelf, 0x9321) * 0.1;
      const b = addBox(26.05 + k * 0.31 + PD.h01(i, 1, 0x9322) * 0.05, shelf + h / 2,
        WZ1 - 0.2, 0.055 + PD.h01(i, 2, 0x9323) * 0.05, h, 0.24,
        SPINE[i % SPINE.length], { cast: false });
      if (PD.h01(i, 3, 0x9324) > 0.8) b.rotation.z = 0.22;           // one always leaning
    }

    // ---- 5. NOTICE BOARD (west wall, south of the door) -------------------
    addBox(WX0 + 0.04, 1.75, 41.0, 0.05, 1.2, 2.0, 0x6a563c, { cast: false });
    addBox(WX0 + 0.075, 1.75, 41.0, 0.02, 1.06, 1.86, 0x8a6f4a, { cast: false });   // cork
    const NOTES = [[2.05, 40.4, 0.3, 0.21], [2.02, 41.3, 0.3, 0.21], [1.55, 40.7, 0.21, 0.3],
    [1.5, 41.6, 0.3, 0.21]];
    for (const n of NOTES)
      PD.paper(WX0 + 0.09, n[0], n[1], "x+", n[2], n[3],
        { color: PD.h01(n[0], n[1], 0x9331) > 0.6 ? 0xf1ecdd : 0xe0d8c2 });

    // ---- 6. VENDING MACHINE (north-east, beside the coffee machine) -------
    /* A SNACK MACHINE, not a navy box with three coloured bricks in it and
       a glowing orange slab stuck on its face (at night: a dark cube with an
       orange block on it). Cabinet on levelling feet; a framed glass front
       over a lit-from-inside cavity with five spiral trays of product; the
       selection panel beside it with its keypad, coin slot and note reader;
       the push flap at the bottom. Nothing on it emits: the room's troffers
       light it like everything else, and at lights-out it goes dark. */
    const VX = 28.2, VZ = 33.6, FX = VX - 0.45;         // front face plane (faces -x)
    // the carcass behind the cavity; the front 25 cm is built open below
    const cab = addBox(VX + 0.125, 0.98, VZ, 0.65, 1.84, 1.0, 0x243049, { cast: true });
    if (CBZ.prisonKit) CBZ.prisonKit.skinBox(cab, "steel", 0x243049);
    if (CBZ.colliders) {
      CBZ.colliders.push({ minX: VX - 0.45, maxX: VX + 0.45, minZ: VZ - 0.5, maxZ: VZ + 0.5, y0: 0, y1: 1.9, ref: cab });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    const V = new PD.Paint(), BODY = 0x243049;
    for (const b of [-1, 1]) V.box(-0.325, 0.98, b * 0.485, 0.25, 1.84, 0.03, BODY);   // cheeks
    V.box(-0.325, 1.84, 0, 0.25, 0.12, 1.0, BODY);                                    // head
    V.box(-0.325, 0.29, 0, 0.25, 0.46, 1.0, BODY);                                    // base
    V.box(-0.325, 1.15, 0.36, 0.25, 1.26, 0.25, BODY);                                // panel column
    for (const a of [-1, 1]) for (const b of [-1, 1]) V.cyl(a * 0.36, 0.03, b * 0.42, 0.035, 0.04, 0.06, 0x1a1c1f, 8);   // feet
    V.box(0, 0.06, 0, 0.84, 0.04, 0.94, 0x15181c);                                   // toe recess
    // the cavity behind the glass and its five trays of stock
    const GZ0 = -0.44, GZ1 = 0.2, GY0 = 0.52, GY1 = 1.78;
    V.box(-0.205, (GY0 + GY1) / 2, (GZ0 + GZ1) / 2, 0.012, GY1 - GY0, GZ1 - GZ0 + 0.06, 0x2e3440);  // back of the cavity
    const STOCK = [0xc94d3a, 0xe8c33c, 0x3a7fd1, 0x3ab06a, 0xd9803a, 0x8a3b8f, 0xe6e1d3];
    for (let r = 0; r < 5; r++) {
      const y = GY0 + 0.05 + r * 0.25;
      V.box(-0.32, y, (GZ0 + GZ1) / 2, 0.22, 0.012, GZ1 - GZ0 - 0.04, 0x9aa3ad);   // tray
      for (let k = 0; k < 5; k++) {
        const z = GZ0 + 0.08 + k * 0.12, col = STOCK[(r * 3 + k * 2) % STOCK.length];
        const tall = r < 2 ? 0.17 : r === 4 ? 0.12 : 0.15;
        if (r === 4) V.cyl(-0.33, y + 0.066, z, 0.032, 0.032, 0.12, col, 10);     // cans on the bottom row
        else V.box(-0.33, y + tall / 2 + 0.006, z, 0.05, tall, 0.1, col);          // bags and bars
        V.add(new THREE.TorusGeometry(0.035, 0.004, 4, 10).rotateY(HALF).translate(-0.39, y + 0.04, z), 0x9aa3ad);  // the spiral's front coil
      }
    }
    // the door frame round the glass, the selection panel, the flap
    V.box(-0.462, GY1 + 0.03, (GZ0 + GZ1) / 2, 0.03, 0.06, GZ1 - GZ0 + 0.08, 0x3a4150);
    V.box(-0.462, GY0 - 0.03, (GZ0 + GZ1) / 2, 0.03, 0.06, GZ1 - GZ0 + 0.08, 0x3a4150);
    V.box(-0.462, (GY0 + GY1) / 2, GZ0 - 0.02, 0.03, GY1 - GY0, 0.04, 0x3a4150);
    V.box(-0.462, (GY0 + GY1) / 2, GZ1 + 0.02, 0.03, GY1 - GY0, 0.04, 0x3a4150);
    V.box(-0.458, 1.2, 0.33, 0.02, 0.9, 0.2, 0x1d222b);                              // selection panel
    V.box(-0.47, 1.52, 0.33, 0.01, 0.1, 0.15, 0x3c5a4a);                             // the price readout, unlit
    for (let i = 0; i < 12; i++)
      V.box(-0.472, 1.38 - ((i / 3) | 0) * 0.055, 0.29 + (i % 3) * 0.04, 0.012, 0.035, 0.03, 0xc8ced4);   // keypad
    V.box(-0.47, 1.05, 0.33, 0.012, 0.06, 0.02, 0x9aa3ad);                           // coin slot
    V.box(-0.47, 0.95, 0.33, 0.012, 0.03, 0.12, 0x0e1014);                           // note reader
    V.box(-0.462, 0.3, -0.1, 0.03, 0.22, 0.6, 0x1a1e24);                            // the push flap
    V.box(-0.47, 0.38, -0.1, 0.012, 0.03, 0.5, 0x3a4150);
    V.mesh(VX, 0, VZ);
    const glass = addBox(FX - 0.012, (GY0 + GY1) / 2, VZ + (GZ0 + GZ1) / 2, 0.012, GY1 - GY0, GZ1 - GZ0, 0xbfe9f7, { cast: false, receive: false });
    glass.material.transparent = true; glass.material.opacity = 0.22; glass.material.depthWrite = false;

    // ---- 7. THE DOOR HEAD + FIRE KIT ----------------------------------------
    // (the dado/scuff planks, joists, sticks, wall lamps, conduit and the blue
    // floor line are gone: the finish kit above is the shell now)
    // the head runs to the wall top (it stopped at 5.0 and a blank blue
    // "STAFF ONLY" board with nothing on it half-filled the hole above it)
    addBox(19, 4.45, 37, 0.5, 3.1, 3.4, 0x6b7480, { cast: false });
    addBox(19.3, 2.88, 37, 0.14, 0.16, 3.5, 0x515a66, { cast: false });
    // the door that was never hung in this 3.4 m hole: a framed steel pair,
    // hooked back against the yard face (corridorkit's door set, no collider)
    if (CBZ.corridorKit && CBZ.corridorKit.doorSet) {
      CBZ.corridorKit.doorSet({ axis: "z", a0: 35.3, a1: 38.7, fixed: 19, t: 0.5, h: 2.8, y0: 0.06,
        open: 1, hinge: 0, max: 1.0, build: CBZ.corridorKit.steelLeaf(0x4f5d6b) }).set(1);
    }
    PD.extinguisher(WX0 + 0.18, 1.1, 34.9, "x+");
  })();

  // The facade pass (world/building_dress.js) dresses whatever is registered.
  if (PD && PD.shell) PD.shell({
    id: "lounge", x0: 19, x1: 29, z0: 30, z1: 44, h: 6,
    door: "W", dc: 37, dw: 3.4, tone: 0x6b7480, face: "W",
  });
})();
