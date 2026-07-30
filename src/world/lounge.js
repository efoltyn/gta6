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
   couch. Feature-detected: when the kit is absent (it currently parses
   AFTER this file — see the LOAD ORDER note below) the authored boxes
   below run instead, now solid and with their own seat anchors, so the
   room is correct either way. The layout, footprint and palette are
   unchanged: this is an authored prison space, not a generated one.

   LOAD ORDER: index.html parses this file at :406, but city/furniture.js
   and city/propuse.js live in the CITY block (:629+). CBZ.roomSeatAnchor
   (world/roombuild.js, :404) is the pipe that makes seat registration
   survive that gap — it queues and flushes on `load`. Move furniture.js
   above roombuild.js and the CBZ.furnish path lights up with no edit here.

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
  const DRESS = !!CBZ.CONFIG.PRISON_DRESS_V2;
  const PD = CBZ.prisonDress || null;   // degrade-safe: no kit → no dressing

  roomShell({
    x0: 19, x1: 29, z0: 30, z1: 44, h: 6,
    wall: 0x6b7480, floor: 0x4a5560,
    door: { side: "W", center: 37, width: 3.4 },
  });

  // "STAFF ONLY" sign band over the door
  addBox(19, 5.4, 37, 0.2, 0.8, 3.0, 0x1d2a4d, { cast: false });

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
  const TV_Z = 33, TV_X = DRESS ? 19.55 : 21.0;

  // ---- armchair, angled at the TV ---------------------------------------
  const CHAIR_X = 24.5, CHAIR_Z = 41.5;
  const CHAIR_FACE = Math.atan2(TV_X - CHAIR_X, TV_Z - CHAIR_Z);   // look at the screen
  const fChair = kit("chair", CHAIR_X, 0, CHAIR_Z, CHAIR_FACE, { solid: true, tone: 0x2b3a67, kind: "armchair" });
  let chaired = false;
  if (fChair) {
    chaired = reseat(fChair.rec, CHAIR_FACE, "armchair");
  } else {
    addBox(CHAIR_X, 0.6, CHAIR_Z, 1.3, 0.7, 1.3, 0x2b3a67, { solid: true });      // SOLID
  }
  if (!chaired) seat(CHAIR_X, CHAIR_Z, CHAIR_FACE, "armchair", 0.95);   // block top 0.60 + 0.35

  // coffee table + mug. Left as authored boxes on purpose: CBZ.furnish has no
  // low occasional table (its `table` is dining height) — see the report note.
  // Now SOLID, and height-gated (y0/y1) so it's a shin-high obstacle in the
  // walking line between the couch and the TV, not a full-height pillar.
  addBox(25.5, 0.45, 37, 1.6, 0.12, 1.2, 0x3c424d, { solid: true, y0: 0, y1: 0.55 });
  addBox(25.5, 0.62, 37, 0.18, 0.22, 0.18, 0xffffff, { cast: false });

  // wall-mounted TV (2.6 m up — over a body's head, stays open)
  addBox(TV_X, 2.6, TV_Z, 0.2, 1.4, 2.4, 0x0a0d18, {});
  // Bezel's room-facing surface is TV_X+0.10; keep real air behind the glass.
  addBox(TV_X + 0.17, 2.6, TV_Z, 0.06, 1.2, 2.1, 0x6fb7ff,
    { emissive: 0x2a6ea5, ei: 0.8, cast: false });

  // coffee machine in the corner — floor-standing, so SOLID like the rest.
  addBox(28.2, 1.0, 31.5, 0.9, 1.2, 0.9, 0x222831, { solid: true });
  addBox(28.2, 1.5, 31.5, 0.5, 0.2, 0.5, 0xff3b3b, { emissive: 0xff0000, ei: 0.6, cast: false });

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
  if (DRESS && PD) (function dayroom() {
    const WX0 = 19.25, WX1 = 28.75, WZ0 = 30.25, WZ1 = 43.75;   // inner faces

    // ---- 1. THE TV, ON A REAL BRACKET -------------------------------------
    addBox(TV_X - 0.22, 2.6, TV_Z, 0.26, 0.5, 0.5, 0x3c424d, { cast: false });  // wall plate + arm
    addBox(TV_X - 0.02, 3.34, TV_Z, 0.1, 0.16, 1.9, 0x2a2f38, { cast: false }); // top trim
    // The screen carries a picture instead of one flat blue rectangle: two
    // dim bands over the bright pane read as a broadcast from across the room.
    // STATIC on purpose — this file registers no per-frame work and a dayroom
    // TV is not worth being the first thing in it that does.
    addBox(TV_X + 0.19, 2.98, TV_Z, 0.02, 0.34, 2.0, 0xdff0ff,
      { emissive: 0x6fa8d0, ei: 0.6, cast: false });
    addBox(TV_X + 0.19, 2.16, TV_Z, 0.02, 0.22, 2.0, 0x16324a,
      { emissive: 0x0d2436, ei: 0.5, cast: false });

    // ---- 2. PHONE BANK (north wall) ---------------------------------------
    // Three kiosks with dividers: the one fitting that says "this is where you
    // are allowed to talk to the outside" without a line of dialogue.
    for (let i = 0; i < 3; i++) {
      const x = 21.3 + i * 1.7;
      addBox(x, 1.35, WZ0 + 0.14, 0.9, 1.5, 0.14, 0x5b6470, { cast: false });        // backboard
      addBox(x, 1.42, WZ0 + 0.3, 0.26, 0.5, 0.2, 0x1e232b, { cast: false });         // phone body
      addBox(x - 0.19, 1.42, WZ0 + 0.34, 0.1, 0.34, 0.12, 0x2f3641, { cast: false }); // handset
      addBox(x - 0.19, 1.16, WZ0 + 0.3, 0.03, 0.22, 0.03, 0x14181f, { cast: false }); // cord
      addBox(x, 1.0, WZ0 + 0.32, 0.62, 0.06, 0.24, 0x8b95a1, { cast: false });        // shelf
    }
    for (let i = 0; i < 3; i++)                                                        // privacy dividers
      addBox(22.15 + i * 1.7, 1.5, WZ0 + 0.48, 0.08, 1.7, 0.66, 0x3c424d, { cast: false });

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
    addBox(26.9, 0.95, WZ1 - 0.2, 1.9, 0.08, 0.34, 0x6a563c, { cast: false });
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
    addBox(WX0 + 0.05, 2.5, 41.0, 0.07, 1.5, 2.4, 0x6a563c, { cast: false });
    addBox(WX0 + 0.1, 2.5, 41.0, 0.03, 1.32, 2.22, 0x3f4a3c, { cast: false });   // cork
    const NOTES = [[2.9, 40.2, 0.44, 0.3], [2.88, 41.4, 0.5, 0.34], [2.35, 40.6, 0.4, 0.5],
    [2.3, 41.8, 0.46, 0.32]];
    for (const n of NOTES)
      PD.paper(WX0 + 0.13, n[0], n[1], "x+", n[2], n[3],
        { color: PD.h01(n[0], n[1], 0x9331) > 0.6 ? 0xf1ecdd : 0xe0d8c2 });

    // ---- 6. VENDING MACHINE (north-east, beside the coffee machine) -------
    addBox(28.2, 0.95, 33.6, 0.9, 1.9, 1.0, 0x2a3550, { solid: true });
    const glass = addBox(27.7, 1.15, 33.6, 0.06, 1.3, 0.8, 0xbfe9f7, { cast: false });
    glass.material.transparent = true; glass.material.opacity = 0.3;
    for (let i = 0; i < 3; i++)                                        // stock behind the glass
      addBox(27.82, 0.72 + i * 0.42, 33.6, 0.16, 0.2, 0.66,
        [0xc94d3a, 0xe8c33c, 0x3ad17a][i], { cast: false });
    addBox(27.75, 1.92, 33.6, 0.1, 0.16, 0.8, 0xff8a3c,
      { emissive: 0xc85c00, ei: 0.5, cast: false });                   // header glow

    // ---- 7. THE SHELL: wear, structure, light -----------------------------
    // West wall runs are SPLIT around the doorway (z 35.3..38.7) — a roomShell
    // gap is full height, so an unbroken band hangs across the opening.
    const RUNS = [
      [24.0, WZ0 + 0.03, 9.5, "x"], [24.0, WZ1 - 0.03, 9.5, "x"],
      [WX1 - 0.03, 37.0, 13.5, "z"],
      [WX0 + 0.03, 32.775, 5.05, "z"], [WX0 + 0.03, 41.225, 5.05, "z"],
    ];
    for (const r of RUNS) {
      PD.dado(r[0], 0.5, r[1], r[2], r[3], 0x55606c);
      PD.scuff(r[0], 1.32, r[1], r[2], r[3], { color: 0x454e58 });
    }
    // door head — stops at 5.0, the underside of the STAFF ONLY band that
    // hangs in this gap (y 5.0..5.8), for the same reason as the cafeteria's
    addBox(19, 3.95, 37, 0.5, 2.1, 3.4, 0x6b7480, { cast: false });
    addBox(19.3, 2.88, 37, 0.14, 0.16, 3.5, 0x515a66, { cast: false });
    for (const z of [33.0, 41.0]) PD.beam(24.0, 5.62, z, 9.6, "x");
    PD.beam(24.0, 5.82, 37.0, 13.6, "z", { w: 0.14, h: 0.16 });
    for (const z of [34.0, 40.0]) PD.strip(24.0, 5.44, z, 4.0, "x");
    PD.lamp(WX0 + 0.06, 3.6, 34.0, "x+");
    PD.lamp(WX1 - 0.06, 3.6, 41.6, "x-");
    PD.pipe(28.4, 5.05, 37.0, 12.6, "z", 0.08, 0x66717c);
    for (const z of [33.0, 41.0]) PD.hanger(28.4, 5.14, z, 0.55);
    PD.extinguisher(WX0 + 0.18, 1.1, 34.9, "x+");

    // ---- 8. WAYFINDING ----------------------------------------------------
    // Blue = rec. It meets the yard's blue line at the door, so the two rooms
    // the DAY BEAT rotates you between are painted as one route.
    PD.floorLine(22.4, 37.0, 6.0, "x", 0x3f7fd0);
    PD.chevron(24.6, 37.0, "x", 1, 0x3f7fd0);
    PD.band(WX0 + 0.03, 1.55, 41.225, 5.05, "z", 0x3f7fd0);
  })();

  // The facade pass (world/building_dress.js) dresses whatever is registered.
  if (PD && PD.shell) PD.shell({
    id: "lounge", x0: 19, x1: 29, z0: 30, z1: 44, h: 6,
    door: "W", dc: 37, dw: 3.4, tone: 0x6b7480, face: "W",
  });
})();
