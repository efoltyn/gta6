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
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/props.js", function () {
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

  /* ---- THE CELL HOUSE LIGHTING PANEL, in the utility chase -------------
     OWNER (2026-09-28, at the officer's post): "there's literally the power
     thing right there." It had been a grey slab with a glowing green square
     floating in the staff doorway, then a panel bolted to the duty board
     beside the officer's desk. Neither is where a building keeps its power:
     a cell house's lighting board lives in the services chase, with the mop
     sink and the return-air grille. world/cellblock.js leaves exactly that
     room in the west row (the utility alcove, x[-15.5,-11.7] z[-34.5,-30.9]),
     open to the aisle and never lockable, so an inmate can reach it, but in
     full view of the flats while he does.
     Mounted on the alcove's south partition face (z -34.5, facing +z), front
     half of the bay, clear of the mop basin (x[-14,-13.2]) and the grille
     crawl (-14.15,-32.2): a steel NEMA cabinet with a HINGED door on two
     barrels, a quarter-turn latch, the hazard label, the pilot lamp on the
     door, and behind the door a dead-front with two columns of branch
     breakers and the main handle. Two EMT conduits run from knockouts in its
     top up to the tier slab at 3.6 m with couplings and straps.
     Throwing the main (CBZ.prisonSabotagePower) swings the door open; it
     shuts again when the power comes back (CBZ.breaker.setOpen). CBZ.breaker
     keeps its fields: `box` is the cabinet, `light` the lens with its OWN
     material (systems/interactions.js and systems/state.js write it). */
  (function breakerBox() {
    const bx = -12.6, wallZ = -34.5, by = 1.45;     // cellblock WEST_ROW "util" bay, south partition face
    const W = 0.56, H = 0.82, D = 0.16, bz = wallZ + D / 2, fz = wallZ + D;
    const grey = K ? K.skin("steel", 0x8f969c) : CBZ.mat(0x8f969c), dark = K ? K.skin("steel", 0x24282d, 0.6) : CBZ.mat(0x24282d);
    const galv = K ? K.skin("galv", 0xb4bcc4) : CBZ.mat(0xb4bcc4), dead = K ? K.skin("steel", 0x6e757c, 0.5) : CBZ.mat(0x6e757c);
    const put = (geo, mat, x, y, z, o) => {
      if (K) return K.stat(geo, mat, x, y, z, o || { cast: false });
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); ROOT.add(m); return m;
    };
    // the cabinet: five sheet-steel walls (open front) so the door opening
    // shows the inside, not a solid block
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.012), grey);          // back pan
    body.position.set(bx, by, wallZ + 0.006); body.receiveShadow = true;
    ROOT.add(body);
    put(new THREE.BoxGeometry(0.012, H, D), grey, bx - W / 2 + 0.006, by, bz);
    put(new THREE.BoxGeometry(0.012, H, D), grey, bx + W / 2 - 0.006, by, bz);
    put(new THREE.BoxGeometry(W, 0.012, D), grey, bx, by + H / 2 - 0.006, bz);
    put(new THREE.BoxGeometry(W, 0.012, D), grey, bx, by - H / 2 + 0.006, bz);
    // inside: the dead-front plate, two columns of branch breakers, the main
    put(new THREE.BoxGeometry(W - 0.06, H - 0.08, 0.006), dead, bx, by, fz - 0.05);
    for (let r = 0; r < 8; r++) for (const c of [-1, 1]) {
      const y = by - 0.26 + r * 0.055;
      put(new THREE.BoxGeometry(0.1, 0.04, 0.03), dark, bx + c * 0.09, y, fz - 0.04);
      put(new THREE.BoxGeometry(0.014, 0.024, 0.02), galv, bx + c * 0.09 + c * 0.02, y, fz - 0.018);   // the toggle
    }
    put(new THREE.BoxGeometry(0.2, 0.1, 0.04), dark, bx, by + 0.28, fz - 0.04);      // main breaker
    put(new THREE.BoxGeometry(0.03, 0.07, 0.03), K ? K.skin("steel", 0x9a2a22, 0.5) : dark, bx, by + 0.3, fz - 0.012);
    put(new THREE.BoxGeometry(0.015, H - 0.12, 0.02), galv, bx, by - 0.02, fz - 0.06);   // neutral bus
    // THE DOOR: hinged on its west edge. A group pivoting on the hinge line,
    // dynamic (core/batch.js leaves it alone) because it swings.
    const door = new THREE.Group();
    door.position.set(bx - W / 2, by, fz);
    door.userData.dynamic = true;
    const dm = (geo, mat, x, y, z, rx) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx;
      m.userData.dynamic = true; door.add(m); return m;
    };
    dm(new THREE.BoxGeometry(W - 0.004, H - 0.004, 0.014), grey, W / 2, 0, 0.007).castShadow = true;
    dm(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 12), dark, W - 0.06, 0, 0.024, Math.PI / 2);   // latch boss
    dm(new THREE.BoxGeometry(0.018, 0.09, 0.014), dark, W - 0.06, -0.03, 0.036);                  // quarter-turn handle
    dm(new THREE.PlaneGeometry(0.12, 0.105), hazardMat(), W / 2 - 0.02, 0.2, 0.0145);
    dm(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16), galv, W / 2 + 0.18, 0.32, 0.02, Math.PI / 2);   // lamp bezel
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x39ff88, emissive: 0x14c258, emissiveIntensity: 1.0 });
    const light = dm(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 14), lampMat, W / 2 + 0.18, 0.32, 0.028, Math.PI / 2);
    ROOT.add(door);
    for (const hy of [0.28, -0.28]) put(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 8), galv, bx - W / 2 - 0.004, by + hy, fz + 0.004);
    // conduits: two EMT runs from knockouts in the top to the tier slab
    for (const cx of [bx - 0.14, bx + 0.12]) {
      put(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), dark, cx, by + H / 2 + 0.02, bz - 0.02);
      if (K) K.tube(cx, by + H / 2 + 0.04, bz - 0.02, cx, 3.6, bz - 0.02, 0.018, galv, { cast: false, seg: 10 });
      for (const sy of [2.35, 3.1]) put(new THREE.BoxGeometry(0.05, 0.022, 0.07), galv, cx, sy, wallZ + 0.035);
      put(new THREE.CylinderGeometry(0.023, 0.023, 0.04, 10), galv, cx, 2.75, bz - 0.02);
    }
    let open = 0;
    CBZ.breaker = {
      box: body,
      light,
      door,
      sabotaged: false,
      timer: 0,
      x: bx,
      z: fz + 0.62,                     // the spot you stand on to throw it
      face: { x: bx, y: by, z: fz },    // where the verb hangs
      // the door swings 105 degrees out on its hinge (about +y, west edge)
      setOpen: function (v) {
        const want = v ? 1 : 0;
        if (want === open) return;
        open = want;
        door.rotation.y = -want * 1.83;
      },
      isOpen: function () { return !!open; },
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
  });
})();
