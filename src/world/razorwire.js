/* ============================================================
   world/razorwire.js — concertina on every wall top.

   It used to be a torus every 1.5 m along the OLD walls only: a row of
   rings, not a coil, and the outer wire the compound grew in 2026-08-11
   had nothing on it at all. Now it is a continuous helix (prisonkit's
   coilRun — one TubeGeometry per run, merged per 40 m cell) on the old
   division walls, on the outer perimeter, and on the two short walls that
   close the yard against the cell house. The vehicle gate's gap in the
   north wall and the freedom gate's gap in the south stay clear.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.prisonKit || !CBZ.WORLD) return;
  const K = CBZ.prisonKit;
  const YH = CBZ.DIM.YH;
  const W = CBZ.WORLD;
  const N = W.northYard, S = W.southBlock, gap = W.exit.gap;
  const OUT = W.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
  const VG = CBZ.prisonVehicleGate || { x0: 92, x1: 112 };
  const wire = K.skin("galv", 0xdfe4e9);

  const run = (x0, z0, x1, z1, r) => K.coilRun(x0, z0, x1, z1, YH + 0.55, r || 0.36, wire);

  // ---- the old compound's own walls (now internal division fences)
  run(N.x0, N.z0 + 1, N.x0, N.z1 - 1);
  run(N.x1, N.z0 + 1, N.x1, N.z1 - 1);
  run(N.x0 - 14, N.z1, N.x0, N.z1); run(N.x1, N.z1, N.x1 + 14, N.z1);      // step shoulders
  run(S.x0, S.z0 + 1, S.x0, S.z1 - 1);
  run(S.x1, S.z0 + 1, S.x1, S.z1 - 1);
  run(-30, N.z0, -16, N.z0); run(16, N.z0, 30, N.z0);                     // against the cell house
  // far south wall, either side of the freedom gate
  run(S.x0 + 1, S.z1, -gap - 1, S.z1); run(gap + 1, S.z1, S.x1 - 1, S.z1);

  // ---- the outer wire: a heavier coil, the gate gap left open
  run(OUT.x0, OUT.z0 + 2, OUT.x0, OUT.z1 - 2, 0.45);
  run(OUT.x1, OUT.z0 + 2, OUT.x1, OUT.z1 - 2, 0.45);
  run(OUT.x0 + 2, OUT.z0, VG.x0 - 0.5, OUT.z0, 0.45);
  run(VG.x1 + 0.5, OUT.z0, OUT.x1 - 2, OUT.z0, 0.45);
  run(OUT.x0 + 2, OUT.z1, S.x0 - 1, OUT.z1, 0.45);
  run(S.x1 + 1, OUT.z1, OUT.x1 - 2, OUT.z1, 0.45);
})();
