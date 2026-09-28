/* ============================================================
   world/props.js — north-yard kit: a picnic table,
   the bench/bar/dumbbell/pull-up corner, the grounds crew's drums, and the
   officer post's electrical panel.

   2026-09-27 DE-SLOP: every object here is the real thing drawn from
   world/prisonkit.js's yard kit (round plates and rims, a galvanised
   walk-through table, a net), not a box standing in for it. The three
   CBZ.spawnPiece pieces keep their contracts: the table is solid:false +
   walkTop (its piece is the invisible top the platform lands on), the
   bench solid, the drum pallets solid + blockLOS with an unseen hull mesh
   as the piece root (LOS rays test the blocker list non-recursively).
   The breaker panel is NOT a piece: it exports CBZ.breaker, a live registry
   read by entities/security.js, systems/interactions.js, systems/state.js
   and systems/prisonnight.js, so its box and lamp are plain meshes with
   stable refs.
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

  // (The north-yard basketball hoop stood inside the mess hall's west wall,
  // backboard facing the diners; deleted with world/ground.js's court pad.)

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
  // dumbbell rack, a pull-up station. Every piece is the real kit: a vinyl
  // pad on a square-tube frame with T-feet, round plates, galvanised bars
  // set in concrete footings. ----
  const HULL = new THREE.MeshBasicMaterial({ visible: false });
  (function gym(x, z) {
    if (!K) return;
    const frame = K.skin("steel", 0x3a4048), iron = K.skin("steel", 0x1c1e22, 0.7);
    const bar = K.skin("galv", 0xb4bcc4), vinyl = K.skin("steel", 0x202328, 0.45);
    const footing = K.skin("concrete", 0x9ea3a8);
    // 1. the bench (F7 piece: solid, no blockLOS). The piece root is its
    // unseen hull; what you see is merged kit: a padded top on a plywood
    // board, two square-tube legs on T-feet and a spine rail between them.
    CBZ.spawnPiece({
      footprint: { hx: 0.25, hz: 0.9 },
      y0: -0.28, y1: 0.28,
      build: function () { return new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.56, 1.7), HULL); },
    }, { pos: { x: x, y: 0.28, z: z }, solid: true, parent: ROOT });
    K.stat(new THREE.BoxGeometry(0.28, 0.02, 1.2), K.skin("concrete", 0x6f5a3d), x, 0.43, z, { cast: false });
    K.stat(new THREE.BoxGeometry(0.29, 0.08, 1.2), vinyl, x, 0.48, z, {});
    for (const e of [-0.45, 0.45]) {
      K.stat(new THREE.BoxGeometry(0.05, 0.4, 0.05), frame, x, 0.22, z + e, { cast: false });
      K.stat(new THREE.BoxGeometry(0.44, 0.04, 0.06), frame, x, 0.02, z + e, { cast: false });
      for (const s of [-1, 1]) K.stat(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10), iron, x + s * 0.2, 0.004, z + e, { cast: false });
    }
    K.stat(new THREE.BoxGeometry(0.05, 0.05, 0.95), frame, x, 0.395, z, { cast: false });
    // the bar on its stands at the head of the bench
    for (const s of [-1, 1]) {
      K.tube(x + s * 0.5, 0, z - 0.95, x + s * 0.5, 1.26, z - 0.95, 0.03, frame, { cast: false });
      K.stat(new THREE.BoxGeometry(0.1, 0.03, 0.4), frame, x + s * 0.5, 0.015, z - 0.95, { cast: false });
      K.stat(new THREE.BoxGeometry(0.06, 0.1, 0.1), frame, x + s * 0.5, 1.2, z - 0.9, { cast: false });   // J-cup
    }
    K.stat(new THREE.CylinderGeometry(0.014, 0.014, 2.0, 8), bar, x, 1.265, z - 0.9, { rz: Math.PI / 2, cast: false });
    for (const s of [-1, 1]) {
      K.stat(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 20), iron, x + s * 0.78, 1.265, z - 0.9, { rz: Math.PI / 2, cast: false });
      K.stat(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 20), iron, x + s * 0.72, 1.265, z - 0.9, { rz: Math.PI / 2, cast: false });
    }
    // 2. the dumbbell rack: an A-frame of tube, two sloped rails, pairs of
    // round dumbbells heaviest at the bottom, sitting ON the rails. Still
    // solid (an unseen box).
    const rx = x + 3.5, rz = z;
    const rack = addBox(rx, 0.4, rz, 1.8, 0.8, 0.6, 0x3c424d, { solid: true });
    rack.visible = false;
    for (const e of [-0.85, 0.85]) {
      K.tube(rx + e, 0, rz - 0.3, rx + e, 0.8, rz - 0.05, 0.025, frame, { cast: false });
      K.tube(rx + e, 0, rz + 0.3, rx + e, 0.8, rz - 0.05, 0.025, frame, { cast: false });
    }
    for (const t of [0, 1]) K.stat(new THREE.BoxGeometry(1.8, 0.04, 0.2), frame, rx, 0.45 + t * 0.3, rz + 0.12 - t * 0.14, { rx: 0.35, cast: false });
    for (let i = -2; i <= 2; i++) for (const t of [0, 1]) {
      const dx = rx + i * 0.34, r = t ? 0.06 : 0.08, dy = 0.47 + t * 0.3 + r, dz = rz + 0.12 - t * 0.14;
      K.stat(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6), bar, dx, dy, dz, { rz: Math.PI / 2, cast: false });
      for (const s of [-1, 1]) K.stat(new THREE.CylinderGeometry(r, r, 0.07, 14), iron, dx + s * 0.11, dy, dz, { rz: Math.PI / 2, cast: false });
    }
    // 3. pull-up station: two galvanised posts in poured footings, the bar
    // clamped between them. (Was two 3.6 m brown boxes skinned as concrete.)
    const px = x - 3.5, pz = z;
    for (const s of [-1, 1]) {
      const post = addBox(px, 1.4, pz + s * 0.9, 0.12, 2.8, 0.12, 0x9aa1a8, { solid: true });
      post.visible = false;
      K.tube(px, 0, pz + s * 0.9, px, 2.62, pz + s * 0.9, 0.057, bar, { seg: 12 });
      K.stat(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 14), footing, px, 0.03, pz + s * 0.9, { cast: false });
      K.stat(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 12), frame, px, 2.64, pz + s * 0.9, { cast: false });   // cap
      K.stat(new THREE.BoxGeometry(0.13, 0.09, 0.13), frame, px, 2.4, pz + s * 0.9, { cast: false });              // bar clamp
    }
    K.stat(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 8), bar, px, 2.4, pz, { rx: Math.PI / 2, cast: false });
  })(-22, 32);

  /* ---- THE ELECTRICAL DISTRIBUTION PANEL in the officer's post ----------
     It was a grey slab with a green glowing square, a yellow box and a latch
     box, hung at x -3.5: INSIDE the staff doorway to the admin wing
     (world/cellblock.js's CBZ.cellblockStaffGap, x[-4.2,-2.2]), floating in
     the opening. Now a real surface-mount board on the duty board panel east
     of the key cabinet: a steel cabinet with a hinged door (two hinge
     barrels, a quarter-turn handle), a louvre, the hazard label, a pilot
     lamp in a bezel, and two conduits running from its top to the tier slab
     overhead (3.6 m). CBZ.breaker keeps its fields: `box` is the cabinet,
     `light` the pilot lens with its OWN material (systems/interactions.js
     and systems/state.js write its color + emissive). */
  (function breakerBox() {
    const bx = 3.2, face = -43.14, by = 1.5;        // the duty board's front face (cellblock officerPost)
    const W = 0.6, H = 0.9, D = 0.2, bz = face + D / 2;
    const grey = K ? K.skin("steel", 0x9aa0a4) : null, dark = K ? K.skin("steel", 0x2b2f34, 0.6) : null;
    const galv = K ? K.skin("galv", 0xb4bcc4) : null;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), grey || CBZ.mat(0x9aa0a4));
    body.position.set(bx, by, bz); body.castShadow = true; body.receiveShadow = true;
    ROOT.add(body);
    // pilot lamp: a chrome bezel and a 36 mm lens. Private material.
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x39ff88, emissive: 0x14c258, emissiveIntensity: 1.0 });
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14), lampMat);
    light.rotation.x = Math.PI / 2;
    light.position.set(bx + 0.18, by + 0.34, face + D + 0.028);
    light.userData.dynamic = true;
    ROOT.add(light);
    if (K) {
      const fz = face + D;                          // cabinet front
      // the door: a slab 12 mm proud with a dark 4 mm shadow gap round it
      K.stat(new THREE.BoxGeometry(W - 0.03, H - 0.03, 0.006), dark, bx, by, fz + 0.003, { cast: false });
      K.stat(new THREE.BoxGeometry(W - 0.04, H - 0.04, 0.014), grey, bx, by, fz + 0.009, { cast: false });
      for (const hy of [0.3, -0.3]) K.stat(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 8), galv, bx - W / 2 + 0.006, by + hy, fz + 0.01, { cast: false });
      // quarter-turn handle
      K.stat(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 12), dark, bx + W / 2 - 0.06, by, fz + 0.026, { rx: Math.PI / 2, cast: false });
      K.stat(new THREE.BoxGeometry(0.018, 0.09, 0.016), dark, bx + W / 2 - 0.06, by - 0.03, fz + 0.04, { cast: false });
      // louvre: a dark recess with six angled blades across the lower door
      K.stat(new THREE.PlaneGeometry(0.34, 0.16), dark, bx - 0.04, by - 0.3, fz + 0.0165, { cast: false });
      for (let i = 0; i < 6; i++) K.stat(new THREE.BoxGeometry(0.34, 0.024, 0.004), grey, bx - 0.04, by - 0.37 + i * 0.028, fz + 0.02, { rx: -0.6, cast: false });
      // bezel for the pilot lamp
      K.stat(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 16), galv, bx + 0.18, by + 0.34, fz + 0.022, { rx: Math.PI / 2, cast: false });
      // the hazard label: the standard yellow triangle and bolt, no words
      K.stat(new THREE.PlaneGeometry(0.12, 0.105), hazardMat(), bx - 0.02, by + 0.2, fz + 0.0165, { cast: false });
      // conduits: two EMT runs from knockouts in the top to the slab, with
      // their couplings and one-hole straps back to the board
      for (const cx of [bx - 0.14, bx + 0.1]) {
        K.stat(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), dark, cx, by + H / 2 + 0.02, bz, { cast: false });   // connector
        K.tube(cx, by + H / 2 + 0.04, bz, cx, 3.6, bz, 0.018, galv, { cast: false, seg: 10 });
        for (const sy of [2.3, 2.85]) K.stat(new THREE.BoxGeometry(0.05, 0.022, 0.12), galv, cx, sy, bz - 0.04, { cast: false });
        K.stat(new THREE.CylinderGeometry(0.023, 0.023, 0.04, 10), galv, cx, 3.2, bz, { cast: false });                // coupling
      }
    }
    CBZ.breaker = {
      box: body,
      light,
      sabotaged: false,
      timer: 0,
      x: bx,
      z: face + 0.7, // the spot you stand on to throw it
    };
  })();
  function hazardMat() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 112;
    const g = c.getContext("2d");
    g.fillStyle = "#9aa0a4"; g.fillRect(0, 0, 128, 112);
    g.beginPath(); g.moveTo(64, 6); g.lineTo(122, 106); g.lineTo(6, 106); g.closePath();
    g.fillStyle = "#16181a"; g.fill();
    g.beginPath(); g.moveTo(64, 20); g.lineTo(110, 99); g.lineTo(18, 99); g.closePath();
    g.fillStyle = "#e8c02a"; g.fill();
    g.beginPath(); g.moveTo(70, 38); g.lineTo(52, 72); g.lineTo(64, 72); g.lineTo(56, 94); g.lineTo(78, 62); g.lineTo(66, 62); g.lineTo(74, 38); g.closePath();
    g.fillStyle = "#16181a"; g.fill();
    return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
  }

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
  function drumPallet(x, z, tones) {
    const def = {
      footprint: { hx: 0.6, hz: 0.6 },
      y0: -0.51, y1: 0.51,
      build: function () {
        // the root is the stack's hull, unseen: guards' LOS rays test the
        // blocker list NON-recursively, so the cover must be a real mesh
        const g = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.02, 1.2), HULL);
        const wood = K ? K.skin("concrete", 0x9c7a4e) : CBZ.mat(0x8a6c45), rim = K ? K.skin("steel", 0x3a4048) : CBZ.mat(0x3a4048);
        for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(DRUM.board, wood); b.position.set(-0.48 + i * 0.24, -0.395, 0); g.add(b); }
        for (const lz of [-0.5, 0, 0.5]) { const r = new THREE.Mesh(DRUM.runner, wood); r.position.set(0, -0.46, lz); g.add(r); }
        for (let k = 0; k < 4; k++) {
          const dx = (k % 2 ? 0.3 : -0.3), dz = (k < 2 ? -0.3 : 0.3);
          const body = new THREE.Mesh(DRUM.body, (K ? K.skin("steel", tones[k % tones.length]) : CBZ.mat(tones[k % tones.length])));
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
