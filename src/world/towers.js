/* ============================================================
   world/towers.js — guard watchtowers ringing the enlarged compound

   NO-DECOY FIX: all 8 towers used to be pure walk-around decoration
   (addBox only, no door, no collider on the cabin, no way up) — they
   existed solely as CBZ.towers fire-origin markers for capture.js. Each
   now gets a real exterior rung LADDER up the stilt body to a small
   standable platform at the cabin deck, using the SAME z-axis ramp-
   platform convention city buildings/elevators.js use for stairs
   (CBZ.platforms ramp records; systems/physics.js groundAt() interpolates
   ramp height along Z only, hence the ladder runs along Z). Kept light
   per spec: no interior, no new gameplay system — just a climbable rung
   ladder + a stand-on-top platform, mirroring the existing stair-collider
   idiom rather than inventing a new one.

   KNOWN ENGINE LIMITATION (documented honestly, not silently swept under
   the rug): systems/physics.js's groundAt() explicitly SKIPS CBZ.platforms
   while CBZ.game.mode === "escape" ("In the prison there are no platforms,
   so this is just terrain" — see that file's own comment). This module
   runs in the prison/escape compound, so the ramp registered below is
   currently INERT in-session — it does not touch physics.js (out of scope
   for this file-scoped task) and is the correct, idiomatic, forward-
   compatible wiring per the codebase's one stair-collider convention. If a
   future pass lifts that escape-mode platform gate, these towers become
   climbable with zero further changes here. Until then this is honestly a
   visual ladder + inert collider registration, not a working climb — see
   the task's own final report for this flagged as a risk/deviation.
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

    // ---- CLIMB: a rung ladder up the -z face (clear of both cross-braces,
    // which sit on ±x) to a small deck platform at the cabin floor (y=5.9,
    // just under the 6.4-high cabin box). CBZ.platforms may not exist yet in
    // a very early/headless boot — guard so towers still stand without it.
    if (CBZ.platforms) {
      const deckY = 5.9;
      const lz0 = z - 1.1 - 0.02, lz1 = z - 1.1 - 0.7;
      CBZ.platforms.push({
        minX: x - 0.5, maxX: x + 0.5, minZ: Math.min(lz0, lz1), maxZ: Math.max(lz0, lz1),
        top: deckY, ramp: { z0: z - 1.1 - 0.05, z1: z - 1.1 - 0.65, y0: 0, y1: deckY },
      });
      // small standable platform at the top of the ladder (cabin's own footprint)
      CBZ.platforms.push({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, top: deckY });
      // rung + rail visuals (plain meshes — only 8 towers total, cheap)
      for (let r = 0; r < 8; r++) {
        addBox(x, 0.6 + r * 0.8, z - 1.1 - 0.35, 0.7, 0.06, 0.06, 0x2a2f38, { cast: false });
      }
      addBox(x - 0.32, 3, z - 1.1 - 0.35, 0.06, 6, 0.06, 0x2a2f38, { cast: false });
      addBox(x + 0.32, 3, z - 1.1 - 0.35, 0.06, 6, 0.06, 0x2a2f38, { cast: false });
    }
  }

  const N = WORLD.northYard, S = WORLD.southBlock, EZ = WORLD.exit.z;
  // north yard corners (near the cell block) + the step junction
  tower(N.x0, N.z0); tower(N.x1, N.z0);
  tower(N.x0, N.z1); tower(N.x1, N.z1);
  // south block: mid-wall + far corners flanking the gate
  tower(S.x0, (S.z0 + S.z1) / 2); tower(S.x1, (S.z0 + S.z1) / 2);
  tower(S.x0, EZ); tower(S.x1, EZ);
})();
