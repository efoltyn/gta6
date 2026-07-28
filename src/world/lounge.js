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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, roomShell } = CBZ;
  const HALF = Math.PI / 2;

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

  // ---- armchair, angled at the TV ---------------------------------------
  const CHAIR_X = 24.5, CHAIR_Z = 41.5;
  const CHAIR_FACE = Math.atan2(21.0 - CHAIR_X, 33.0 - CHAIR_Z);   // look at the screen
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

  // wall-mounted TV glowing blue (2.6 m up — over a body's head, stays open)
  addBox(21.0, 2.6, 33, 0.2, 1.4, 2.4, 0x0a0d18, {});
  // Bezel's room-facing surface is x=21.10; keep real air behind the glass.
  addBox(21.17, 2.6, 33, 0.06, 1.2, 2.1, 0x6fb7ff,
    { emissive: 0x2a6ea5, ei: 0.8, cast: false });

  // coffee machine in the corner — floor-standing, so SOLID like the rest.
  addBox(28.2, 1.0, 31.5, 0.9, 1.2, 0.9, 0x222831, { solid: true });
  addBox(28.2, 1.5, 31.5, 0.5, 0.2, 0.5, 0xff3b3b, { emissive: 0xff0000, ei: 0.6, cast: false });

  // a couple of loose cigarette packs left on the table (steal-bait)
  if (CBZ.addPack) { CBZ.addPack(25.5, 37, 8); CBZ.addPack(24.5, 41.5, 6); }
})();
