/* ============================================================
   world/lounge.js — the cops' lounge on the east side of the yard.
   Couches, a coffee machine, a TV. Off-limits, naturally.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, roomShell } = CBZ;

  roomShell({
    x0: 19, x1: 29, z0: 30, z1: 44, h: 6,
    wall: 0x6b7480, floor: 0x4a5560,
    door: { side: "W", center: 37, width: 3.4 },
  });

  // "STAFF ONLY" sign band over the door
  addBox(19, 5.4, 37, 0.2, 0.8, 3.0, 0x1d2a4d, { cast: false });

  // a couch facing the TV
  addBox(27.5, 0.6, 37, 1.2, 0.7, 4.0, 0x2b3a67, {});
  addBox(28.1, 1.1, 37, 0.5, 1.0, 4.0, 0x223057, { cast: false });
  // armchair
  addBox(24.5, 0.6, 41.5, 1.3, 0.7, 1.3, 0x2b3a67, {});

  // coffee table + mug
  addBox(25.5, 0.45, 37, 1.6, 0.12, 1.2, 0x3c424d, {});
  addBox(25.5, 0.62, 37, 0.18, 0.22, 0.18, 0xffffff, { cast: false });

  // wall-mounted TV glowing blue
  addBox(21.0, 2.6, 33, 0.2, 1.4, 2.4, 0x0a0d18, {});
  addBox(21.15, 2.6, 33, 0.06, 1.2, 2.1, 0x6fb7ff, { emissive: 0x2a6ea5, ei: 0.8, cast: false });

  // coffee machine in the corner
  addBox(28.2, 1.0, 31.5, 0.9, 1.2, 0.9, 0x222831, {});
  addBox(28.2, 1.5, 31.5, 0.5, 0.2, 0.5, 0xff3b3b, { emissive: 0xff0000, ei: 0.6, cast: false });

  // a couple of loose cigarette packs left on the table (steal-bait)
  if (CBZ.addPack) { CBZ.addPack(25.5, 37, 8); CBZ.addPack(24.5, 41.5, 6); }
})();
