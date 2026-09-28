/* ============================================================
   world/clutter.js — the yard's wall benches.

   2026-09-27 DE-SLOP. This file used to scatter "lived-in" clutter across the
   north yard with a seeded random stream: seven glossy black SPHERES as trash
   bags, twelve white paper squares, six dark translucent squares as puddles on
   the turf, seven traffic cones (four at random spots, three "cordoning" a
   spot of grass), and a laundry line of coloured slabs on the east wall. None
   of it had a reason to be where it was, and from eye height it read exactly
   as what it was: random primitives dropped on a lawn (owner: "there's just
   some unrealistic random slop"). A prison yard is policed clean every count;
   what it has is fixed furniture. All of that is deleted. What is left is the
   one thing here with a purpose: three benches against the side walls, built
   by the shared furniture kit and registered as seats.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;

  // `cushion` = cushion top above the floor (propuse's 7th `geom` argument).
  // LOAD ORDER: this file parses before world/roombuild.js defines
  // CBZ.roomSeatAnchor, so the anchor defers to `load` when neither pipe
  // exists yet; it still lands ahead of core/batch.js's merge pass.
  function seatAnchor(x, z, face, cushion) {
    const reg = function () {
      const f = CBZ.roomSeatAnchor || CBZ.propRegisterSeat;
      if (f) f(x, 0, z, face, "bench", null, cushion != null ? { cushion: cushion, floorBelow: 0 } : null);
    };
    if (CBZ.roomSeatAnchor || CBZ.propRegisterSeat) reg();
    else if (window.addEventListener) window.addEventListener("load", reg, { once: true });
  }

  // A slatted bench flush to the west (bs -1) or east (bs +1) wall, long axis
  // along z, facing into the yard. The seat is solid (real cover).
  function bench(x, z, bs) {
    const len = 2.6;
    const face = bs < 0 ? Math.PI / 2 : -Math.PI / 2;
    const F = CBZ.furnish;
    let r = null, drew = false;
    if (F && typeof F.bench === "function") {
      try { r = F.bench(x, 0, z, face, { len: len, solid: true, tone: 0xa9742f }); drew = true; }
      catch (e) { drew = false; }
    }
    if (drew && r && r.seats && r.seats.length) {
      for (const s of r.seats) if (s) seatAnchor(s.x, s.z, s.face != null ? s.face : (s.yaw != null ? s.yaw : face), s.cushion);
      return;
    }
    // (no furniture kit: no bench. The four-box stand-in is deleted.)
    if (!drew) return;
    for (const dz of [-0.7, 0.7]) seatAnchor(x, z + dz, face, 0.58);
  }

  bench(-28.6, 4, -1);
  bench(-28.6, 38, -1);
  bench(28.6, 14, 1);          // z 20 stood the solid bench in the east yard gate (z 19..25)
})();
