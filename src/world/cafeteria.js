/* ============================================================
   world/cafeteria.js — the mess hall on the west side of the yard.
   Long tables, a serving counter, trays. Where inmates mill about.

   NO-DECOY FIX (world/clutter.js's doctrine: every prop a body can meet
   must be solid). Every piece in here was drawn with `addBox(..., {})` —
   opts.solid defaults FALSY (world/materials.js:196) — so the mess tables,
   the benches and the 8 m serving counter were all walk-through scenery.
   They are real bodies now.

   PROPS WITH PURPOSE. The benches were sittable-LOOKING geometry that
   nothing could ever sit on. They now route through CBZ.furnish.bench
   (city/furniture.js — the ONE shared furniture kit), which owns the
   geometry AND registers the propuse sit anchors; the serving counter
   routes through CBZ.furnish.counter. Feature-detected: when the kit is
   absent the authored boxes below run instead, now solid and registering
   their own anchors, so the room is correct either way.

   The refectory layout, footprint and palette are UNCHANGED — this is an
   authored prison space, not a generated one. Only the furniture is real.

   LOAD ORDER: index.html parses this file at :405; city/furniture.js and
   city/propuse.js live in the CITY block (:629+). CBZ.roomSeatAnchor
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
    x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    wall: 0x8a929c, floor: 0xb9c0c8,
    door: { side: "E", center: 14, width: 3.4 },
  });

  // sign over the door
  addBox(-19, 5.4, 14, 0.2, 0.9, 3.2, 0xc94d3a, { cast: false });

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

  // ---- two long mess tables with benches ---------------------------------
  // Refectory grammar: the table's long axis runs along X, a bench down each
  // side at 0.7 m off the centreline, each bench facing the table.
  const TABLE_X = -24.5, TABLE_LEN = 4.4, BENCH_OFF = 0.7;
  function messTable(z) {
    // the table slab — SOLID, and height-gated so it's a waist-high obstacle
    // rather than a full-height pillar (its legs stay decorative).
    addBox(TABLE_X, 0.85, z, TABLE_LEN, 0.16, 1.0, 0xd9d2c4, { solid: true, y0: 0, y1: 0.95 });
    addBox(-26.4, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });   // end supports
    addBox(-22.6, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });

    // a bench each side, facing the table (yaw 0 = looks +z, yaw pi = looks -z)
    for (const s of [-1, 1]) {
      const bz = z + s * BENCH_OFF;
      const face = s < 0 ? 0 : Math.PI;
      // back:false — a mess bench is a backless plank you slide onto from the
      // end (that is the authored geometry, and what the kit's default adds).
      const fBench = kit("bench", TABLE_X, 0, bz, face,
        { len: TABLE_LEN, back: false, solid: true, tone: 0x9aa0a8 });
      let sat = false;
      if (fBench) {
        sat = reseat(fBench.rec, face, "bench");
      } else {
        addBox(TABLE_X, 0.42, bz, TABLE_LEN, 0.14, 0.35, 0x9aa0a8, { solid: true });  // seat (SOLID)
      }
      // three sit spots down each bench — only if the kit reported none.
      // cushion 0.49 = the authored plank's real top (centre 0.42 + half of 0.14).
      if (!sat) for (const dx of [-1.5, 0, 1.5]) seat(TABLE_X + dx, bz, face, "bench", 0.49);
    }

    // a couple of trays
    addBox(-25.4, 0.96, z, 0.5, 0.06, 0.36, 0x3ad17a, { cast: false });
    addBox(-23.6, 0.96, z, 0.5, 0.06, 0.36, 0xffd451, { cast: false });
  }
  messTable(10);
  messTable(18);

  // ---- serving counter along the far (west) wall -------------------------
  // Front faces +x into the room (yaw = +90 deg), 8 m long.
  const COUNTER_X = -27.8, COUNTER_Z = 14, COUNTER_LEN = 8;
  const fCounter = kit("counter", COUNTER_X, 0, COUNTER_Z, HALF, { len: COUNTER_LEN, solid: true, tone: 0xbfc6cd });
  let topY = 1.6;   // authored worktop height (counter centre 0.8 + half of 1.6)
  if (fCounter) {
    if (fCounter.rec && fCounter.rec.top != null) topY = fCounter.rec.top;
  } else {
    addBox(COUNTER_X, 0.8, COUNTER_Z, 1.0, 1.6, COUNTER_LEN, 0xbfc6cd, { solid: true });  // SOLID
  }
  addBox(-27.2, topY + 0.05, COUNTER_Z, 0.4, 0.1, COUNTER_LEN, 0xe6e9ed, { cast: false }); // serving lip
  // hot-food trays glowing on the counter
  for (let i = -1; i <= 1; i++)
    addBox(-27.2, topY + 0.14, COUNTER_Z + i * 2.2, 0.5, 0.12, 0.7, 0xff7a1a, { emissive: 0xc85c00, ei: 0.5, cast: false });
})();
