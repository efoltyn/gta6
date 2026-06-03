/* ============================================================
   world/roombuild.js — helper that stamps a rectangular room: a
   tinted floor and four open-top walls, with an optional doorway
   gap on one side. Used by cafeteria / gunroom / lounge.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox } = CBZ;
  const T = 0.5; // wall thickness

  // cfg: { x0,x1,z0,z1, h, wall, floor, door:{side:'N|S|E|W', center, width} }
  function roomShell(cfg) {
    const { x0, x1, z0, z1 } = cfg;
    const h = cfg.h || 6;
    const wall = cfg.wall != null ? cfg.wall : CBZ.COL.WALL_D;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0, d = z1 - z0;

    // floor slab
    if (cfg.floor != null) {
      addBox(cx, 0.02, cz, w, 0.08, d, cfg.floor, { solid: false, cast: false });
    }

    const door = cfg.door;
    // build one wall, splitting it if the doorway sits on this side
    function wallRun(side, fixed, from, to, horizontal) {
      const hasDoor = door && door.side === side;
      if (!hasDoor) {
        if (horizontal) addBox((from + to) / 2, h / 2, fixed, to - from, h, T, wall, { solid: true, blockLOS: true });
        else addBox(fixed, h / 2, (from + to) / 2, T, h, to - from, wall, { solid: true, blockLOS: true });
        return;
      }
      const gap0 = door.center - door.width / 2, gap1 = door.center + door.width / 2;
      // two segments either side of the gap
      if (horizontal) {
        if (gap0 > from) addBox((from + gap0) / 2, h / 2, fixed, gap0 - from, h, T, wall, { solid: true, blockLOS: true });
        if (to > gap1) addBox((gap1 + to) / 2, h / 2, fixed, to - gap1, h, T, wall, { solid: true, blockLOS: true });
      } else {
        if (gap0 > from) addBox(fixed, h / 2, (from + gap0) / 2, T, h, gap0 - from, wall, { solid: true, blockLOS: true });
        if (to > gap1) addBox(fixed, h / 2, (gap1 + to) / 2, T, h, to - gap1, wall, { solid: true, blockLOS: true });
      }
    }

    wallRun("N", z0, x0, x1, true);   // north (z0)
    wallRun("S", z1, x0, x1, true);   // south (z1)
    wallRun("W", x0, z0, z1, false);  // west  (x0)
    wallRun("E", x1, z0, z1, false);  // east  (x1)

    return { cx, cz };
  }

  CBZ.roomShell = roomShell;
})();
