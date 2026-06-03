/* ============================================================
   world/yard.js — the outdoor perimeter. The compound is now far
   larger: the original north exercise yard is unchanged, then the
   walls STEP OUTWARD at z=52 into a wider, longer "South Block"
   (workshops, chapel, infirmary, lower yard, sally port) with the
   freedom gate at the very far south. All extents come from
   CBZ.WORLD so the perimeter, clamp, minimap and towers agree.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, COL, DIM, WORLD } = CBZ;
  const { WALL, TRIM } = COL;
  const YH = DIM.YH;
  const N = WORLD.northYard, S = WORLD.southBlock, gap = WORLD.exit.gap;

  const wall = (x, z, w, d) => addBox(x, YH / 2, z, w, YH, d, WALL, { solid: true, blockLOS: true });
  // red warning trim hugging a wall top; ax 'x' runs along x, 'z' along z
  function trim(x, z, len, ax) {
    if (ax === "z") addBox(x, YH - 0.5, z, 0.4, 0.4, len, TRIM, { cast: false });
    else addBox(x, YH - 0.5, z, len, 0.4, 0.4, TRIM, { cast: false });
  }

  // ---- north exercise yard (original footprint, x[-30,30] z[-8,52]) ----
  const nW = N.x1 - N.x0, nCx = (N.x0 + N.x1) / 2;
  const nLen = N.z1 - N.z0, nCz = (N.z0 + N.z1) / 2;
  wall(N.x0, nCz, 1, nLen);  // west
  wall(N.x1, nCz, 1, nLen);  // east
  trim(N.x0, nCz, nLen, "z");
  trim(N.x1, nCz, nLen, "z");

  // close the gap between the (narrow) cell block and the yard's north end
  wall(-23, N.z0, 14, 1);  // x[-30,-16]
  wall(23, N.z0, 14, 1);   // x[16,30]

  // ---- step the walls outward at z=52 (the yard widens going south) ----
  // only the widened shoulders are walled; the central x[-30,30] is an
  // open throat connecting the two yards.
  const stepW = (S.x1 - N.x1);               // how far each side juts out (14)
  wall(N.x0 - stepW / 2, N.z1, stepW, 1);    // west shoulder  x[-44,-30]
  wall(N.x1 + stepW / 2, N.z1, stepW, 1);    // east shoulder  x[30,44]

  // ---- south block (wider + longer, x[-44,44] z[52,128]) ----
  const sLen = S.z1 - S.z0, sCz = (S.z0 + S.z1) / 2;
  wall(S.x0, sCz, 1, sLen);  // west
  wall(S.x1, sCz, 1, sLen);  // east
  trim(S.x0, sCz, sLen, "z");
  trim(S.x1, sCz, sLen, "z");

  // far south wall with the exit gap in the middle
  const halfRun = (S.x1 - gap);              // length of each side segment (40)
  const segC = (gap + S.x1) / 2;             // centre of each segment (24)
  wall(-segC, S.z1, halfRun, 1);             // south-left   x[-44,-4]
  wall(segC, S.z1, halfRun, 1);              // south-right  x[4,44]
  trim(-segC, S.z1, halfRun, "x");
  trim(segC, S.z1, halfRun, "x");
})();
