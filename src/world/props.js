/* ============================================================
   world/props.js — yard flavour: basketball hoop, picnic table,
   oil barrels. Makes the exercise yard feel lived-in.

   F7 MIGRATION: three props below now route through CBZ.spawnPiece
   (systems/pieces.js, F4) as the migration proof set — table(), the
   weight-bench inside gym(), and barrel(). Each demonstrates a distinct
   spawnPiece path:
     - table:  solid:false, walkTop:true  (a NEW capability — the old
               table had no collider AND no platform at all; findSupport
               can now snap onto its top. This is the one deliberate,
               additive behaviour change in this migration, called out
               here and in BUILD-PLAN F7 rather than silently added.)
     - weightBench (in gym()): solid:true, no blockLOS.
     - barrel: solid:true, blockLOS:true (the manual CBZ.colliders.push /
               CBZ.losBlockers.push this file used to do by hand — now
               spawnPiece owns both, so this is also the reap/despawn
               proof: a piece built from something OTHER than boxes, i.e.
               a CylinderGeometry mesh returned directly from build()).
   hoop() and the rest of gym() (dumbbell rack, pull-up station) stay on
   addBox — purely decorative/already-solid-via-addBox, no proof value
   added by moving them too.
   breakerBox() is SKIPPED on purpose: it exports CBZ.breaker, a live
   registry read by entities/security.js, systems/interactions.js and
   systems/state.js. Piece meshRefs are expected to get reaped/replaced
   later (B-stage instancing, structural collapse...) — until whatever
   system owns "sabotage-able world objects" is itself piece-aware, this
   stays on addBox so CBZ.breaker.box/.light keep pointing at stable,
   never-reaped THREE.Mesh refs, exactly like world/towers.js's own
   registry-backed props (also left untouched, out of scope for this file).
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

  // ---- picnic / mess table (F7: migrated to spawnPiece — solid:false
  // matches the old table exactly (it never had a collider), walkTop:true
  // is new: the tabletop is now a real platform findSupport can return) ----
  (function table(x, z) {
    const def = {
      footprint: { hx: 1.3, hz: 0.5 },  // the tabletop's own half-extents (2.6 x 1.0)
      y0: -0.08, y1: 0.08,              // tabletop's own half-height (0.16/2), world top = pos.y+0.08
      build: function () {
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.0), CBZ.mat(0xb07a3c, {}));
        top.castShadow = true; top.receiveShadow = true;

        const benchA = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.4), CBZ.mat(0x8a5e2b, {}));
        benchA.position.set(0, -0.43, -0.7);
        benchA.castShadow = true; benchA.receiveShadow = true;
        top.add(benchA);

        const benchB = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.4), CBZ.mat(0x8a5e2b, {}));
        benchB.position.set(0, -0.43, 0.7);
        benchB.castShadow = true; benchB.receiveShadow = true;
        top.add(benchB);

        const legA = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.84, 1.0), CBZ.mat(0x6e4a22, {}));
        legA.position.set(-1.1, -0.43, 0);
        legA.castShadow = false; legA.receiveShadow = true;
        top.add(legA);

        const legB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.84, 1.0), CBZ.mat(0x6e4a22, {}));
        legB.position.set(1.1, -0.43, 0);
        legB.castShadow = false; legB.receiveShadow = true;
        top.add(legB);

        return top;
      },
    };
    CBZ.spawnPiece(def, { pos: { x: x, y: 0.85, z: z }, solid: false, walkTop: true });
  })(18, 30);

  // ---- outdoor workout gym area (Reds' turf recreation zone) ----
  (function gym(x, z) {
    // 1. weight bench (F7 migration proof #3: a simple solid-only piece,
    // no blockLOS. The padded top used to be a manual addBox({solid:true})
    // — the old comment "solid so players can stand/hide behind it" still
    // holds, just via spawnPiece's opts.solid path now. Support legs are
    // decorative children of the returned top mesh, exactly as before
    // (they were never solid).
    (function weightBench() {
      const def = {
        footprint: { hx: 0.25, hz: 0.9 }, // top's own half-extents (0.5 x 1.8)
        y0: -0.07, y1: 0.07,              // top's own half-height (0.14/2)
        build: function () {
          const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 1.8), CBZ.mat(0x222831, {}));
          top.castShadow = true; top.receiveShadow = true;

          const legA = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), CBZ.mat(0x7d8794, {}));
          legA.position.set(0, -0.3, -0.7);
          legA.castShadow = true; legA.receiveShadow = true;
          top.add(legA);

          const legB = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), CBZ.mat(0x7d8794, {}));
          legB.position.set(0, -0.3, 0.7);
          legB.castShadow = true; legB.receiveShadow = true;
          top.add(legB);

          return top;
        },
      };
      CBZ.spawnPiece(def, { pos: { x: x, y: 0.55, z: z }, solid: true });
    })();

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
  // SKIPPED for F7 (see file header): exports CBZ.breaker, a live registry
  // read by entities/security.js, systems/interactions.js, systems/state.js.
  // Stays on addBox until whatever owns "interactive sabotage props" is
  // itself piece-aware.
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
  // F7: migrated to spawnPiece. Old code manually did
  // CBZ.colliders.push({...}) + CBZ.losBlockers.push(m) by hand right here
  // — spawnPiece now owns both (opts.solid + opts.blockLOS), and reap/
  // despawn cleanup (previously nonexistent for this prop) comes for free.
  function barrel(x, z) {
    const def = {
      footprint: { hx: 0.6, hz: 0.6 }, // matches the old manual collider's half-extents exactly
      y0: -0.8, y1: 0.8,               // the cylinder's own physical extent (height 1.6, centred on pos.y)
      build: function () {
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.55, 1.6, 14),
          CBZ.mat(0x3f7d4a, { emissive: 0x10260f, ei: 0.2 })
        );
        m.castShadow = true; m.receiveShadow = true;

        // banding rings (old world y 1.1 / 0.5 -> local offset from pos.y=0.8)
        const ringTop = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.1, 1.14), CBZ.mat(0x2f5e38, {}));
        ringTop.position.set(0, 0.3, 0);
        ringTop.castShadow = false; ringTop.receiveShadow = true;
        m.add(ringTop);

        const ringBot = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.1, 1.14), CBZ.mat(0x2f5e38, {}));
        ringBot.position.set(0, -0.3, 0);
        ringBot.castShadow = false; ringBot.receiveShadow = true;
        m.add(ringBot);

        return m;
      },
    };
    CBZ.spawnPiece(def, { pos: { x: x, y: 0.8, z: z }, solid: true, blockLOS: true });
  }
  barrel(-19, 44); barrel(-20.2, 45); barrel(-19.6, 43);
})();
