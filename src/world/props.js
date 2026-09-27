/* ============================================================
   world/props.js — north-yard kit: the basketball hoop, a picnic table,
   the bench/bar/dumbbell/pull-up corner, the grounds crew's drums, and the
   cell block's breaker box.

   2026-09-27 DE-SLOP: every object here is the real thing drawn from
   world/prisonkit.js's yard kit (round plates and rims, a galvanised
   walk-through table, a net), not a box standing in for it. The three
   CBZ.spawnPiece pieces keep their contracts: the table is solid:false +
   walkTop (its piece is the invisible top the platform lands on), the
   bench solid, the drum pallets solid + blockLOS with an unseen hull mesh
   as the piece root (LOS rays test the blocker list non-recursively).
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
  /* THE ROOT IS THE PRISON, NOT THE SCENE. addBox parents into prisonRoot on
     its own, but spawnPiece defaults to a CHUNK root (systems/chunks.js), and
     chunk roots hang off CBZ.scene — they are the cross-world registry
     player building uses in the city, and they never hide with a mode switch.
     So the three pieces below (the picnic table, the weight bench, the green
     oil barrels) were the only prison objects still standing when the prison
     was hidden: in Shark Sim and Disaster Survival the island's sea runs 3 km
     and covers the prison's origin, and from the shark they were a bench and
     three barrels hovering half a metre over the swell 480 m off the beach
     (owner, 2026-09-08: "the fucking floating bench and barrels wtf"). Every
     piece this file spawns is parented here explicitly. */
  const ROOT = CBZ.prisonRoot || CBZ.scene;

  const K = CBZ.prisonKit || null;

  // ---- basketball hoop behind the half-court's baseline (world/ground.js
  // paints the court: baseline x=-28.4, key to -22.6). The kit's hoop: round
  // pole, gooseneck, a board with its square painted on, rim, net. It was a
  // square post, a white slab and a 50 cm ORANGE SQUARE for a rim, standing
  // inside the baseline. Board 1.2 m inside the baseline, rim over the key.
  if (K) K.hoop(-29.2, 14, 1, 0, { reach: 2.0 });
  CBZ.colliders.push({ minX: -29.45, maxX: -28.95, minZ: 13.75, maxZ: 14.25, noBreach: true });

  // ---- picnic table (F7 spawnPiece: solid:false, walkTop:true — the top is a
  // platform findSupport can return). What you see is the kit's galvanised
  // walk-through table (the one every yard in the compound uses); the piece
  // is its top, invisible, so the platform lands exactly on the planks. ----
  (function table(x, z) {
    if (K) K.picnicTable(x, z, 0);
    const def = {
      footprint: { hx: 0.9, hz: 0.38 },
      y0: -0.02, y1: 0.02,
      build: function () {
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.76), CBZ.mat(0x55705f, {}));
        top.visible = !K;
        return top;
      },
    };
    CBZ.spawnPiece(def, { pos: { x: x, y: 0.74, z: z }, solid: false, walkTop: true, parent: ROOT });
  })(18, 30);

  // ---- outdoor workout area: a flat bench, a loaded bar on its stands, a
  // dumbbell rack, a pull-up station. Round things are round now (the plates
  // and dumbbells were black squares), and the bench stands on steel legs,
  // not two grey cubes. ----
  (function gym(x, z) {
    const frame = K ? K.skin("steel", 0x3a4048) : null, iron = K ? K.skin("steel", 0x1c1e22, 0.7) : null;
    const bar = K ? K.skin("galv", 0xb4bcc4) : null;
    // 1. the bench (F7 piece: solid, no blockLOS)
    (function weightBench() {
      const legGeo = new THREE.BoxGeometry(0.05, 0.46, 0.05), footGeo = new THREE.BoxGeometry(0.42, 0.04, 0.06);
      const def = {
        footprint: { hx: 0.25, hz: 0.9 },
        y0: -0.07, y1: 0.07,
        build: function () {
          const top = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 1.7), CBZ.mat(0x222831, {}));
          top.castShadow = true; top.receiveShadow = true;
          for (const e of [-0.7, 0.7]) {
            const leg = new THREE.Mesh(legGeo, CBZ.mat(0x4f5663, {})); leg.position.set(0, -0.28, e); top.add(leg);
            const foot = new THREE.Mesh(footGeo, CBZ.mat(0x4f5663, {})); foot.position.set(0, -0.53, e); top.add(foot);
          }
          return top;
        },
      };
      CBZ.spawnPiece(def, { pos: { x: x, y: 0.55, z: z }, solid: true, parent: ROOT });
    })();
    if (!K) return;
    // the bar on its stands at the head of the bench
    for (const s of [-1, 1]) { K.tube(x + s * 0.5, 0, z - 0.95, x + s * 0.5, 1.2, z - 0.95, 0.03, frame, { cast: false }); K.stat(new THREE.BoxGeometry(0.1, 0.03, 0.4), frame, x + s * 0.5, 0.015, z - 0.95, { cast: false }); }
    K.stat(new THREE.CylinderGeometry(0.014, 0.014, 2.0, 8), bar, x, 1.2, z - 0.9, { rz: Math.PI / 2, cast: false });
    for (const s of [-1, 1]) {
      K.stat(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 20), iron, x + s * 0.78, 1.2, z - 0.9, { rz: Math.PI / 2, cast: false });
      K.stat(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 20), iron, x + s * 0.72, 1.2, z - 0.9, { rz: Math.PI / 2, cast: false });
    }
    // 2. the dumbbell rack: an A-frame of tube, two sloped rails, pairs of
    // round dumbbells heaviest at the bottom. Still solid (an unseen box).
    const rx = x + 3.5, rz = z;
    const rack = addBox(rx, 0.4, rz, 1.8, 0.8, 0.6, 0x3c424d, { solid: true });
    rack.visible = false;
    for (const e of [-0.85, 0.85]) {
      K.tube(rx + e, 0, rz - 0.3, rx + e, 0.8, rz - 0.05, 0.025, frame, { cast: false });
      K.tube(rx + e, 0, rz + 0.3, rx + e, 0.8, rz - 0.05, 0.025, frame, { cast: false });
    }
    for (const t of [0, 1]) K.stat(new THREE.BoxGeometry(1.8, 0.04, 0.2), frame, rx, 0.45 + t * 0.3, rz + 0.12 - t * 0.14, { rx: 0.35, cast: false });
    for (let i = -2; i <= 2; i++) for (const t of [0, 1]) {
      const dx = rx + i * 0.34, dy = 0.52 + t * 0.3, dz = rz + 0.12 - t * 0.14, r = t ? 0.06 : 0.08;
      K.stat(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6), bar, dx, dy, dz, { rz: Math.PI / 2, cast: false });
      for (const s of [-1, 1]) K.stat(new THREE.CylinderGeometry(r, r, 0.07, 14), iron, dx + s * 0.11, dy, dz, { rz: Math.PI / 2, cast: false });
    }
    // 3. pull-up station: two timber posts set in the ground, a steel bar through them
    const px = x - 3.5, pz = z;
    skinTimber(addBox(px, 1.8, pz - 0.9, 0.2, 3.6, 0.2, 0x6e4a22, { solid: true }));
    skinTimber(addBox(px, 1.8, pz + 0.9, 0.2, 3.6, 0.2, 0x6e4a22, { solid: true }));
    K.stat(new THREE.CylinderGeometry(0.018, 0.018, 2.0, 8), bar, px, 3.3, pz, { rx: Math.PI / 2, cast: false });
  })(-22, 32);
  function skinTimber(m) { if (K && m) K.skinBox(m, "concrete", 0x7a5530, 1); return m; }

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

  // ---- the grounds crew's drums: two pallets of four 55-gallon drums by the
  // wall (solid, LOS-blocking cover, F7 spawnPiece). They were three 1.1 m
  // wide, 1.6 m tall green cylinders with a faint GLOW (emissive) and SQUARE
  // bands round them, three overlapping in a heap: twice a drum's size and
  // not a drum. A drum is 0.58 m across and 0.88 m tall with rolling hoops.
  const DRUM = {
    body: new THREE.CylinderGeometry(0.29, 0.29, 0.88, 18),
    hoop: new THREE.TorusGeometry(0.292, 0.012, 4, 18),
    lid: new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8),
    board: new THREE.BoxGeometry(0.1, 0.022, 1.2),
    runner: new THREE.BoxGeometry(1.2, 0.1, 0.1),
  };
  const HULL = new THREE.MeshBasicMaterial({ visible: false });
  function drumPallet(x, z, tones) {
    const def = {
      footprint: { hx: 0.6, hz: 0.6 },
      y0: -0.51, y1: 0.51,
      build: function () {
        // the root is the stack's hull, unseen: guards' LOS rays test the
        // blocker list NON-recursively, so the cover must be a real mesh
        const g = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.02, 1.2), HULL);
        const wood = CBZ.mat(0x8a6c45, {}), rim = CBZ.mat(0x3a4048, {});
        for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(DRUM.board, wood); b.position.set(-0.48 + i * 0.24, -0.395, 0); g.add(b); }
        for (const lz of [-0.5, 0, 0.5]) { const r = new THREE.Mesh(DRUM.runner, wood); r.position.set(0, -0.46, lz); g.add(r); }
        for (let k = 0; k < 4; k++) {
          const dx = (k % 2 ? 0.3 : -0.3), dz = (k < 2 ? -0.3 : 0.3);
          const body = new THREE.Mesh(DRUM.body, CBZ.mat(tones[k % tones.length], {}));
          body.position.set(dx, 0.06, dz); body.castShadow = true; body.receiveShadow = true; g.add(body);
          for (const y of [-0.37, -0.09, 0.21, 0.49]) {
            const h = new THREE.Mesh(DRUM.hoop, rim); h.rotation.x = Math.PI / 2; h.position.set(dx, y, dz); g.add(h);
          }
          const bung = new THREE.Mesh(DRUM.lid, rim); bung.position.set(dx + 0.15, 0.51, dz + 0.05); g.add(bung);
        }
        return g;
      },
    };
    CBZ.spawnPiece(def, { pos: { x: x, y: 0.51, z: z }, solid: true, blockLOS: true, parent: ROOT });
  }
  drumPallet(-19.3, 43.6, [0x2f5e8a, 0x2f5e8a, 0x3f6f4a, 0x2f5e8a]);
  drumPallet(-19.3, 45.0, [0x3f6f4a, 0x2f5e8a, 0x3f6f4a, 0x3f6f4a]);
})();
