/* ============================================================
   world/props.js — yard flavour: basketball hoop, picnic table,
   oil barrels. Makes the exercise yard feel lived-in.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox } = CBZ;

  // ---- basketball hoop against the west wall ----
  (function hoop(x, z) {
    addBox(x, 2.5, z, 0.25, 5, 0.25, 0x3c424d, { cast: false });        // pole
    addBox(x + 0.9, 4.6, z, 1.5, 1.0, 0.12, 0xffffff, { cast: false }); // backboard
    addBox(x + 1.5, 4.2, z, 0.5, 0.1, 0.5, 0xff7a1a, { cast: false });  // rim
  })(-28, 14);

  // ---- picnic / mess table ----
  (function table(x, z) {
    addBox(x, 0.85, z, 2.6, 0.16, 1.0, 0xb07a3c, {});       // top
    addBox(x, 0.42, z - 0.7, 2.6, 0.16, 0.4, 0x8a5e2b, {}); // bench
    addBox(x, 0.42, z + 0.7, 2.6, 0.16, 0.4, 0x8a5e2b, {}); // bench
    addBox(x - 1.1, 0.42, z, 0.16, 0.84, 1.0, 0x6e4a22, { cast: false });
    addBox(x + 1.1, 0.42, z, 0.16, 0.84, 1.0, 0x6e4a22, { cast: false });
  })(18, 30);
  
  // ---- outdoor workout gym area (Reds' turf recreation zone) ----
  (function gym(x, z) {
    // 1. weight bench
    // concrete support legs
    addBox(x, 0.25, z - 0.7, 0.4, 0.5, 0.4, 0x7d8794, {});
    addBox(x, 0.25, z + 0.7, 0.4, 0.5, 0.4, 0x7d8794, {});
    // padded bench top (solid so players can stand/hide behind it)
    addBox(x, 0.55, z, 0.5, 0.14, 1.8, 0x222831, { solid: true });
    // barbell rack stands
    addBox(x - 0.22, 0.7, z, 0.08, 0.9, 0.08, 0x4f5663, { cast: false });
    addBox(x + 0.22, 0.7, z, 0.08, 0.9, 0.08, 0x4f5663, { cast: false });
    // barbell bar (runs along x)
    addBox(x, 1.15, z, 2.0, 0.06, 0.06, 0x9aa0a8, { cast: false });
    // weight plates (runs along y/z)
    addBox(x - 0.9, 1.15, z, 0.12, 0.5, 0.5, 0x111111, {});
    addBox(x - 0.75, 1.15, z, 0.12, 0.42, 0.42, 0x111111, {});
    addBox(x + 0.9, 1.15, z, 0.12, 0.5, 0.5, 0x111111, {});
    addBox(x + 0.75, 1.15, z, 0.12, 0.42, 0.42, 0x111111, {});

    // 2. dumbbell rack
    const rx = x + 3.5, rz = z;
    // rack frame
    addBox(rx, 0.4, rz, 1.8, 0.8, 0.6, 0x3c424d, { solid: true });
    // dumbbells on the rack
    for (let i = -2; i <= 2; i++) {
      const dx = rx + i * 0.34;
      // left plate, handle, right plate
      addBox(dx - 0.08, 0.85, rz, 0.06, 0.2, 0.2, 0x111111, { cast: false });
      addBox(dx, 0.85, rz, 0.18, 0.04, 0.04, 0x9aa0a8, { cast: false });
      addBox(dx + 0.08, 0.85, rz, 0.06, 0.2, 0.2, 0x111111, { cast: false });
    }

    // 3. pull-up station
    const px = x - 3.5, pz = z;
    // vertical timber posts
    addBox(px, 1.8, pz - 0.9, 0.24, 3.6, 0.24, 0x6e4a22, { solid: true });
    addBox(px, 1.8, pz + 0.9, 0.24, 3.6, 0.24, 0x6e4a22, { solid: true });
    // pull-up bar (high steel bar)
    addBox(px, 3.4, pz, 0.06, 0.06, 1.8, 0x8b95a1, { cast: false });
  })(-22, 32);

  // ---- electrical breaker box inside the cell block ----
  (function breakerBox() {
    const bx = -3.5, by = 1.8, bz = -43.4;
    // main box container (grey metal box)
    const box = addBox(bx, by, bz, 0.8, 1.2, 0.16, 0x6b7480, { solid: false, cast: true });
    // dynamic indicator light
    const light = addBox(bx - 0.22, by + 0.38, bz + 0.09, 0.1, 0.1, 0.04, 0x39ff88, { emissive: 0x14c258, ei: 1.2, cast: false });
    // caution stripes / label panel
    addBox(bx + 0.14, by - 0.22, bz + 0.09, 0.32, 0.42, 0.02, 0xffd451, { cast: false });
    // door handle latch
    addBox(bx + 0.32, by, bz + 0.09, 0.04, 0.18, 0.04, 0x2b2b2b, { cast: false });

    // export it so the interaction system can access the breaker box and its light
    CBZ.breaker = {
      box,
      light,
      sabotaged: false,
      timer: 0,
      x: bx,
      z: bz + 0.7, // interaction trigger spot slightly in front of the box
    };
  })();

  // ---- a cluster of oil barrels (extra cover, solid) ----
  function barrel(x, z) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.6, 14),
      CBZ.mat(0x3f7d4a, { emissive: 0x10260f, ei: 0.2 })
    );
    m.position.set(x, 0.8, z);
    m.castShadow = m.receiveShadow = true;
    CBZ.scene.add(m);
    // banding rings
    addBox(x, 1.1, z, 1.14, 0.1, 1.14, 0x2f5e38, { cast: false });
    addBox(x, 0.5, z, 1.14, 0.1, 1.14, 0x2f5e38, { cast: false });
    CBZ.colliders.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6, ref: m });
    CBZ.losBlockers.push(m);
  }
  barrel(-19, 44); barrel(-20.2, 45); barrel(-19.6, 43);
})();
