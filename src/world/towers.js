/* ============================================================
   world/towers.js — guard watchtowers ringing the enlarged compound
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, WORLD } = CBZ;

  CBZ.towers = CBZ.towers || [];   // {x,z} of each cabin — used by capture.js tower fire

  function tower(x, z) {
    CBZ.towers.push({ x: x, z: z });
    addBox(x, 3, z, 2.2, 6, 2.2, 0x6b7480, {});                       // stilt body
    addBox(x, 6.4, z, 3.4, 1.1, 3.4, 0x515a66, {});                   // cabin
    // windows on the cabin
    addBox(x, 6.5, z + 1.72, 2.6, 0.7, 0.08, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.5, cast: false });
    addBox(x, 6.5, z - 1.72, 2.6, 0.7, 0.08, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.5, cast: false });
    addBox(x, 7.3, z, 3.0, 0.7, 3.0, 0xc94d3a, { cast: false });      // roof
    addBox(x, 7.9, z, 0.4, 0.6, 0.4, 0x2a2f38, { cast: false });      // antenna
    // support cross-braces
    addBox(x - 1.0, 3, z, 0.18, 6, 0.18, 0x515a66, { cast: false });
    addBox(x + 1.0, 3, z, 0.18, 6, 0.18, 0x515a66, { cast: false });
  }

  const N = WORLD.northYard, S = WORLD.southBlock, EZ = WORLD.exit.z;
  // north yard corners (near the cell block) + the step junction
  tower(N.x0, N.z0); tower(N.x1, N.z0);
  tower(N.x0, N.z1); tower(N.x1, N.z1);
  // south block: mid-wall + far corners flanking the gate
  tower(S.x0, (S.z0 + S.z1) / 2); tower(S.x1, (S.z0 + S.z1) / 2);
  tower(S.x0, EZ); tower(S.x1, EZ);
})();
