/* ============================================================
   world/cafeteria.js — the mess hall on the west side of the yard.
   Long tables, a serving counter, trays. Where inmates mill about.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, roomShell } = CBZ;

  roomShell({
    x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    wall: 0x8a929c, floor: 0xb9c0c8,
    door: { side: "E", center: 14, width: 3.4 },
  });

  // sign over the door
  addBox(-19, 5.4, 14, 0.2, 0.9, 3.2, 0xc94d3a, { cast: false });

  // two long mess tables with benches
  function messTable(z) {
    addBox(-24.5, 0.85, z, 4.4, 0.16, 1.0, 0xd9d2c4, {});
    addBox(-24.5, 0.42, z - 0.7, 4.4, 0.14, 0.35, 0x9aa0a8, {});
    addBox(-24.5, 0.42, z + 0.7, 4.4, 0.14, 0.35, 0x9aa0a8, {});
    addBox(-26.4, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });
    addBox(-22.6, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });
    // a couple of trays
    addBox(-25.4, 0.96, z, 0.5, 0.06, 0.36, 0x3ad17a, { cast: false });
    addBox(-23.6, 0.96, z, 0.5, 0.06, 0.36, 0xffd451, { cast: false });
  }
  messTable(10);
  messTable(18);

  // serving counter along the far (west) wall
  addBox(-27.8, 0.8, 14, 1.0, 1.6, 8, 0xbfc6cd, {});
  addBox(-27.2, 1.65, 14, 0.4, 0.1, 8, 0xe6e9ed, { cast: false });
  // hot-food trays glowing on the counter
  for (let i = -1; i <= 1; i++)
    addBox(-27.2, 1.74, 14 + i * 2.2, 0.5, 0.12, 0.7, 0xff7a1a, { emissive: 0xc85c00, ei: 0.5, cast: false });
})();
