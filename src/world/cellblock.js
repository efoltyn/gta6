/* ============================================================
   world/cellblock.js — the indoor cell wing: walls, cells, bunks
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, COL, DIM } = CBZ;
  const { WALL, TRIM } = COL;
  const WH = DIM.WH;

  // ---- outer walls (open top) ----
  addBox(0, WH / 2, -44, 32, WH, 1, WALL, { solid: true, blockLOS: true });   // north
  addBox(-16, WH / 2, -26, 1, WH, 36, WALL, { solid: true, blockLOS: true });  // west
  addBox(16, WH / 2, -26, 1, WH, 36, WALL, { solid: true, blockLOS: true });   // east
  addBox(-9.5, WH / 2, -8, 13, WH, 1, WALL, { solid: true, blockLOS: true });  // south-left  (door gap x[-3,3])
  addBox(9.5, WH / 2, -8, 13, WH, 1, WALL, { solid: true, blockLOS: true });   // south-right

  // red trim line along the north wall top
  addBox(0, WH - 0.6, -43.55, 32, 0.5, 0.4, TRIM, { cast: false });

  // barred windows punched into the north wall — OWNER RULE (bda61ab): no
  // gray panes; glass behind the bars is the same clear tint as the city.
  // addBox uses mat() (fresh per call) so mutating the material is safe, and
  // transparent:true keeps the pane out of batch.js's opaque merge pass.
  for (let wx = -11; wx <= 11; wx += 11) {
    const pane = addBox(wx, 6, -43.4, 2.6, 2.6, 0.2, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 }); // clear glass
    pane.material.transparent = true; pane.material.opacity = 0.6;
    for (let i = 0; i < 4; i++)
      addBox(wx - 1 + i * 0.66, 6, -43.2, 0.1, 2.4, 0.1, 0x2a2f38, { cast: false }); // bars
  }

  // ---- a row of cells along the back, divided by low partitions ----
  function bunk(x, z) {
    addBox(x, 0.5, z, 2.6, 0.3, 1.3, 0x4f5663, {});       // lower frame
    addBox(x, 0.7, z, 2.4, 0.18, 1.1, 0xd9d2c4, {});      // lower mattress
    addBox(x, 1.7, z, 2.6, 0.3, 1.3, 0x4f5663, {});       // upper frame
    addBox(x, 1.9, z, 2.4, 0.18, 1.1, 0xd9d2c4, {});      // upper mattress
    addBox(x, 1.0, z, 0.2, 0.3, 1.1, 0x9aa0a8, {});       // pillow-ish
    addBox(x - 1.2, 1.0, z, 0.16, 2.0, 1.3, 0x3c424d, {}); // posts
    addBox(x + 1.2, 1.0, z, 0.16, 2.0, 1.3, 0x3c424d, {});
  }
  bunk(-12.5, -41);
  bunk(12.5, -41);

  // a small steel toilet + sink combo in the corner (classic cell prop)
  addBox(-14.4, 0.5, -34, 1.0, 1.0, 0.9, 0xc7ccd2, {});
  addBox(-14.4, 1.05, -34, 0.9, 0.1, 0.8, 0xe6e9ed, {});

  // ---- cell bars near spawn (decorative, climbable look) ----
  for (let i = 0; i < 6; i++)
    addBox(-7 + i * 0.6, 2.4, -37.5, 0.12, 4.6, 0.12, 0x2a2f38, { cast: false });
  addBox(-4.0, 4.85, -37.5, 4.0, 0.25, 0.25, 0x2a2f38, { cast: false }); // top rail
  addBox(-4.0, 0.15, -37.5, 4.0, 0.25, 0.25, 0x2a2f38, { cast: false }); // bottom rail

  // a hanging caged ceiling lamp over the cells (warm point of interest)
  addBox(0, 8.6, -30, 0.5, 0.3, 0.5, 0x3c424d, { cast: false });
  const ceilingLamp = addBox(0, 8.2, -30, 0.7, 0.2, 0.7, 0xffe9a8, { emissive: 0xffcf66, ei: 0.9, cast: false });
  CBZ.ceilingLamp = ceilingLamp;
})();
