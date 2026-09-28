/* ============================================================
   world/yardfurniture.js — THE YARD IS A PRISON YARD.

   OWNER'S RULE: a real jail, not a prop dump. No treasure chests, no random
   crates of loot in the yard.

   Five packing cases used to stand in the exercise yard (world/crates.js,
   deleted 2026-09-28), kept purely because they BREAK GUARD LINE OF SIGHT
   and are the yard's whole stealth layer. Nothing bolts a packing case to
   the middle of an exercise yard.

   So the COVER SURVIVES AND THE BOXES DO NOT. Every installation below sits
   on a spot a crate used to hold, blocks at least as much sightline as the
   2.6 m case it replaces, and is a thing a real yard actually contains:

     handball wall (-9, 22)   the canonical yard object: a poured concrete
                              wall you play off. 6.0 x 3.2 — MORE cover than
                              the crate, and the reason a yard has one wall
                              standing in the middle of it.
     weight pile  (8, 28)     a squat rack with a loaded bar, a bench and a
                              plate tree. The rack's own back plate is the
                              LOS blocker.
     pavilion    (-12, 36)    a covered shelter with a solid back wall and
                              two bolted chow tables under it, out of the sun
                              and out of the tower's view.
     phone bank  (11, 17)     three hooded payphones on a back panel, on the
                              armoury approach — the one place in a prison
                              where standing still for two minutes is normal.
     notice board (3.6, 11)   the yard board, and a pair of tables opposite
                              it. Both sit BESIDE the central walkway rather
                              than in it: cover on each side of a lane reads
                              better, and world/clutter.js's own keep-out
                              already calls that lane sacred.

   Seating is CBZ.furnish/CBZ.prisonDress, never new geometry: PD.roundTable
   is the bolted four-stool chow table this compound already uses indoors,
   with real propuse anchors, so an inmate can sit at a yard table for the
   same reason he can sit at a mess table.

   ---- THE TWO TOOLS GET AN ADDRESS ------------------------------------
   The Hacksaw Blade and the Lockpick were lying ON TOP of two of the crates,
   which is better than inside them and still arbitrary. They are the keys to
   world/gunroom.js's inner cage and world/adminwing.js's office, so where
   they live is level design, not decoration:

       Hacksaw Blade -> the WORKSHOP bench, beside the vise and the stripped
                        gun already laid out on it (world/southblock.js).
       Lockpick      -> the LAUNDRY, on a linen cart. Contraband is made
                        where the machines are loud and the screws are not.

   Both are in the SOUTH BLOCK — which is where the schedule's `work` block
   (13:00) sends the whole population anyway. The prison hands you the tools
   during the hour it makes you walk past them.

   Ratchet CBZ.yardFurnitureAudit().cover — LOS blockers standing in the
   north yard — may never fall below the 5 the crates provided.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox) return;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const PD = CBZ.prisonDress || null;

  // the compound's textured kit (world/prisonkit.js): poured concrete,
  // painted and stainless steel, merged per material at load
  const K = CBZ.prisonKit || null;
  const skinned = (m, kind, tint) => { if (K && m) K.skinBox(m, kind, tint); return m; };

  // round things are ROUND: plates, the bar, the chalk bucket (they were
  // 50 cm black squares and a cube). Shared geometry per size, one material each.
  const _cg = {};
  function cyl(x, y, z, r, h, color, axis, seg) {
    const k = r + "|" + h + "|" + (seg || 18);
    const g = _cg[k] || (_cg[k] = new THREE.CylinderGeometry(r, r, h, seg || 18));
    const m = new THREE.Mesh(g, K ? K.skin("steel", color, color < 0x303030 ? 0.7 : undefined) : CBZ.mat(color));
    if (axis === "x") m.rotation.z = Math.PI / 2; else if (axis === "z") m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z); m.castShadow = true;
    ROOT.add(m);
    return m;
  }
  // the phone's face: brushed plate, a 4 x 3 keypad, a card reader slot
  let _phoneFace = null;
  function phoneFace() {
    if (_phoneFace) return _phoneFace;
    const c = document.createElement("canvas"); c.width = 128; c.height = 196;
    const g = c.getContext("2d");
    g.fillStyle = "#aab0b6"; g.fillRect(0, 0, 128, 196);
    for (let y = 0; y < 196; y += 2) { g.fillStyle = "rgba(255,255,255," + (0.03 + ((y * 13) % 7) / 120) + ")"; g.fillRect(0, y, 128, 1); }
    g.fillStyle = "#1d2126"; g.fillRect(34, 18, 60, 10);                    // card slot
    g.fillStyle = "#2b3138"; g.fillRect(22, 40, 84, 26);                    // display window
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
    g.font = "700 13px Arial, Helvetica, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let k = 0; k < 12; k++) {
      const kx = 30 + (k % 3) * 34, ky = 88 + ((k / 3) | 0) * 26;
      g.fillStyle = "#6b7178"; g.fillRect(kx - 12, ky - 9, 24, 18);
      g.fillStyle = "#d9dde0"; g.fillRect(kx - 11, ky - 8, 22, 15);
      g.fillStyle = "#23272c"; g.fillText(keys[k], kx, ky);
    }
    const t = new THREE.CanvasTexture(c);
    _phoneFace = new THREE.MeshLambertMaterial({ map: t });
    return _phoneFace;
  }
  const C_CONC = 0xa9a396, C_CONC_D = 0x8d8779, C_STEEL = 0x6b7480, C_STEEL_D = 0x4a525c;
  let cover = 0;                 // LOS blockers this file stands up
  function blocker(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    opts.solid = true; opts.blockLOS = true;
    cover++;
    return addBox(x, y, z, w, h, d, color, opts);
  }

  /* ==========================================================
     1. THE HANDBALL WALL. One poured slab, a painted service line, and the
        scuff where forty years of balls have hit it. It is the single best
        piece of cover in the yard and it needs no explanation at all.
     ========================================================== */
  (function handball(x, z) {
    const W = 6.0, HH = 3.2;
    skinned(blocker(x, HH / 2, z, W, HH, 0.5, C_CONC), "concrete", C_CONC);
    skinned(addBox(x, HH + 0.12, z, W + 0.2, 0.24, 0.66, C_CONC_D, { cast: false }), "concrete", C_CONC_D);   // coping
    // the service line, painted ON the face you play from (it was a 4 cm red
    // bar and a 3 cm grey slab standing proud of the wall as a "scuff")
    addBox(x, 1.72, z + 0.252, W - 0.3, 0.07, 0.004, 0xa4553f, { cast: false });
    // buttress piers, because a free-standing 3 m wall has them.
    // PRISON_PROP_USE_V1: drawn `{}` — 0.63 m3 of poured concrete EACH and the
    // two largest dead props in the north yard, standing 1.8 m tall against a
    // wall that is itself the yard's best cover, and you walked through both.
    // A pier is solid. It is NOT counted into `cover` below: it hides nothing
    // the 6 m wall it braces does not already hide, and the ratchet has to
    // keep meaning "installations that block a sightline".
    for (const s of [-1, 1]) skinned(addBox(x + s * (W / 2 - 0.4), 0.9, z - 0.55, 0.5, 1.8, 0.7, C_CONC_D, { solid: true }), "concrete", C_CONC_D);
    // the poured pad it stands on
    skinned(addBox(x, 0.025, z + 3.2, W + 1.6, 0.05, 6.4, 0x8f8a80, { cast: false }), "concrete", 0x8f8a80);
  })(-9, 22);

  /* ==========================================================
     2. THE WEIGHT PILE. world/props.js already has a bench and a dumbbell
        rack at (-22,32) and world/southblock.js has two more in the lower
        yard, so this is the SQUAT RACK neither of them has — and the rack's
        back plate is what does the sightline work the crate used to.
     ========================================================== */
  (function weights(x, z) {
    const steel = K ? K.skin("steel", C_STEEL_D) : null, vinyl = K ? K.skin("steel", 0x202328, 0.45) : null;
    const sk = (m, mat) => { if (mat && m) m.material = mat; return m; };
    // interlocking rubber tiles, 2 cm, a hair off the yard
    if (K) K.stat(new THREE.BoxGeometry(4.4, 0.02, 3.6), K.skin("concrete", 0x2f3237, 0.95), x, 0.012, z, { cast: false, uv: 1 });
    // the rack: two 80 mm uprights on base feet, a crossmember, J-cups with
    // the loaded bar in them. The back is its plate-storage board (the LOS
    // blocker), with horns and plates on the side away from the lifter.
    for (const s of [-1, 1]) {
      sk(addBox(x + s * 0.85, 1.15, z - 0.6, 0.08, 2.3, 0.08, C_STEEL_D, { solid: true }), steel);
      sk(addBox(x + s * 0.85, 0.02, z - 0.6, 0.1, 0.04, 0.7, C_STEEL_D, { cast: false }), steel);
    }
    sk(blocker(x, 1.15, z - 0.655, 1.62, 2.1, 0.03, C_STEEL_D, { cast: false }), K ? K.skin("steel", 0x4a525c) : null);
    sk(addBox(x, 2.28, z - 0.6, 1.78, 0.08, 0.08, C_STEEL, { cast: false }), steel);
    for (const s of [-1, 1]) sk(addBox(x + s * 0.85, 1.45, z - 0.53, 0.09, 0.1, 0.1, C_STEEL, { cast: false }), steel);
    cyl(x, 1.515, z - 0.53, 0.014, 2.2, 0x9aa0a8, "x", 8);                         // the bar
    for (const s of [-1, 1]) {
      cyl(x + s * 1.0, 1.515, z - 0.53, 0.225, 0.05, 0x1a1d22, "x");                 // 20 kg plates
      cyl(x + s * 0.94, 1.515, z - 0.53, 0.225, 0.05, 0x1a1d22, "x");
      cyl(x + s * 1.06, 1.515, z - 0.53, 0.03, 0.08, 0x9aa0a8, "x", 8);              // collar
    }
    for (const s of [-1, 1]) for (const hy of [0.45, 1.05]) {
      cyl(x + s * 0.5, hy, z - 0.77, 0.025, 0.2, C_STEEL, "z", 8);                    // storage horn
      cyl(x + s * 0.5, hy, z - 0.83, hy < 1 ? 0.225 : 0.16, 0.05, 0x1a1d22, "z");      // a plate on it
    }
    // THE THREE LOOSE THINGS IN THE WEIGHT PILE. The rack is bolted through
    // the mat and stays; the bench, the plate tree and the chalk bucket are
    // free-standing kit and every one of them prices its own shove. This is
    // where the differential is easiest to feel: the bucket skitters off your
    // shin, the bench takes a shoulder, and a loaded plate tree barely gives.
    // The bench is a real flat bench: a vinyl pad on a board, square-tube
    // legs on T-feet and a spine (it was a slab on two 46 cm cubes).
    const bz = z + 0.55;
    const wBench = sk(addBox(x, 0.48, bz, 0.29, 0.08, 1.2, 0x222831, { solid: true }), vinyl);
    const wFeet = [sk(addBox(x, 0.43, bz, 0.28, 0.02, 1.2, 0x6f5a3d, { cast: false }), K ? K.skin("concrete", 0x6f5a3d) : null),
      sk(addBox(x, 0.395, bz, 0.05, 0.05, 0.95, C_STEEL, { cast: false }), steel)];
    for (const e of [-0.45, 0.45]) {
      wFeet.push(sk(addBox(x, 0.22, bz + e, 0.05, 0.4, 0.05, C_STEEL, { cast: false }), steel));
      wFeet.push(sk(addBox(x, 0.02, bz + e, 0.44, 0.04, 0.06, C_STEEL, { cast: false }), steel));
    }
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [wBench].concat(wFeet), x: x, z: bz, hx: 0.22, hz: 0.62, y1: 0.52,
      mass: 45, kind: "bench", leash: 4.0, stand: true, mode: "escape",
    });
    // plate tree — four 20 kg plates on a steel post: it moves, grudgingly
    // (the collider box is the tree's footprint; it is hidden, the post and
    // plates are what you see)
    const treeBase = addBox(x + 2.0, 0.55, z + 0.4, 0.5, 1.1, 0.5, C_STEEL_D, { solid: true });
    treeBase.visible = false;
    const tree = [treeBase, cyl(x + 2.0, 0.03, z + 0.4, 0.26, 0.06, C_STEEL_D), cyl(x + 2.0, 0.58, z + 0.4, 0.035, 1.1, C_STEEL_D, null, 10)];
    for (let i = 0; i < 4; i++) {
      tree.push(cyl(x + 2.0, 0.34 + (i % 2) * 0.46, z + 0.4 + (i < 2 ? -0.09 : 0.09), 0.225, 0.05, 0x1a1d22, "z"));
      tree.push(cyl(x + 2.0, 0.34 + (i % 2) * 0.46, z + 0.4 + (i < 2 ? -0.14 : 0.14), 0.03, 0.12, C_STEEL, "z", 8));   // horn
    }
    if (CBZ.pushProp) CBZ.pushProp({
      parts: tree, x: x + 2.0, z: z + 0.4, hx: 0.25, hz: 0.28, y1: 1.10,
      mass: 110, kind: "platetree", leash: 2.5, mode: "escape",
    });
    // chalk bucket — 4 kg, and it is the lightest thing in the compound
    const bucket = cyl(x - 1.9, 0.18, z + 1.0, 0.16, 0.36, 0xd8d2c4);
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [bucket], x: x - 1.9, z: z + 1.0, hx: 0.18, hz: 0.18, y1: 0.36,
      mass: 4, kind: "bucket", solid: true, leash: 6.0, mode: "escape",
    });
  })(8, 28);

  /* ==========================================================
     3. THE PAVILION. A shade shelter with one solid back wall — the only
        square of the yard the towers cannot see into, which is exactly why
        the tables are under it and why it is worth walking to.
     ========================================================== */
  (function pavilion(x, z) {
    const W = 6.4, D = 5.0, HH = 2.7;
    // the back wall (north side): the LOS blocker
    skinned(blocker(x, 1.2, z - D / 2, W, 2.4, 0.34, C_CONC), "block", 0xb9b3a4);
    // posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (sz < 0) continue;                                  // the back wall carries that side
      skinned(addBox(x + sx * (W / 2 - 0.2), HH / 2, z + sz * (D / 2 - 0.2), 0.2, HH, 0.2, C_STEEL_D, { solid: true }), "steel", C_STEEL_D);
    }
    // the roof. Non-solid + blockLOS, the same contract world/roofs.js uses:
    // a tower cannot see through it, and no body is ever walled out by it.
    skinned(addBox(x, HH + 0.12, z, W, 0.24, D, 0x59616b, { solid: false, cast: false, blockLOS: true }), "steel", 0x59616b);
    skinned(addBox(x, HH + 0.3, z, W + 0.3, 0.12, D + 0.3, 0x4a525c, { cast: false }), "corrugated", 0x7d858e);
    for (let i = -1; i <= 1; i++) skinned(addBox(x + i * 2.0, HH - 0.08, z, 0.14, 0.16, D - 0.1, C_STEEL_D, { cast: false }), "steel", C_STEEL_D);
    // the slab and its two bolted tables — the shared kit's, with real seats
    skinned(addBox(x, 0.025, z, W + 0.8, 0.05, D + 0.8, 0x8f8a80, { cast: false }), "concrete", 0x8f8a80);
    if (PD && typeof PD.roundTable === "function") {
      PD.roundTable(x - 1.5, z + 0.5, { tone: 0xb9b3a4, seatTone: 0x54606d });
      PD.roundTable(x + 1.5, z + 0.5, { tone: 0xb9b3a4, seatTone: 0x54606d, spin: 0.35 });
    }
  })(-12, 36);

  /* ==========================================================
     4. THE PHONE BANK. On the armoury approach, where the crate that
        carried the hacksaw used to be. A man on the phone is a man standing
        still with his back to the yard — the one legitimate reason to be
        stationary within sight of the gun-room door.
     ========================================================== */
  (function phones(x, z) {
    skinned(blocker(x, 1.2, z, 3.6, 2.4, 0.36, C_CONC), "block", 0xb9b3a4);
    skinned(addBox(x, 2.48, z, 3.9, 0.2, 0.62, C_CONC_D, { cast: false }), "concrete", C_CONC_D);   // hood
    skinned(addBox(x, 0.025, z + 0.45, 4.4, 0.05, 1.7, 0x8f8a80, { cast: false }), "concrete", 0x8f8a80);   // poured pad
    /* THREE INMATE PHONES. A wall-mounted stainless housing with a
       twelve-key pad and a card reader (no coin box: nobody in a prison
       pays in coins), the handset on its side hook, the armoured cord
       looping to the housing's foot, a stainless privacy wing between each
       pair. They were five stacked dark boxes a phone. */
    if (K) {
      const stainless = K.skin("steel", 0xb5bbc1, 0.35), black = K.skin("steel", 0x1c1e22, 0.7);
      const faceMat = phoneFace();
      const fz = z + 0.18;                                   // the wall face
      for (let i = -1; i <= 1; i++) {
        const px = x + i * 1.15;
        K.stat(new THREE.BoxGeometry(0.34, 0.52, 0.1), stainless, px, 1.38, fz + 0.05, {});
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.46), faceMat);
        face.position.set(px, 1.38, fz + 0.1 + 0.002); ROOT.add(face);
        // handset on the hook on its left flank: earpiece, grip, mouthpiece
        const hx = px - 0.21;
        K.stat(new THREE.BoxGeometry(0.06, 0.08, 0.04), stainless, hx + 0.02, 1.5, fz + 0.06, { cast: false });   // hook
        K.stat(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), black, hx, 1.4, fz + 0.1, { cast: false });
        K.stat(new THREE.CylinderGeometry(0.04, 0.036, 0.05, 10), black, hx, 1.52, fz + 0.1, { cast: false });
        K.stat(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 10), black, hx, 1.28, fz + 0.1, { cast: false });
        const cord = new THREE.CatmullRomCurve3([
          new THREE.Vector3(hx, 1.25, fz + 0.1), new THREE.Vector3(hx - 0.02, 1.02, fz + 0.14),
          new THREE.Vector3(px - 0.08, 0.98, fz + 0.12), new THREE.Vector3(px - 0.06, 1.13, fz + 0.06),
        ]);
        K.stat(new THREE.TubeGeometry(cord, 16, 0.009, 5, false), stainless, 0, 0, 0, { cast: false });
      }
      for (const wx of [x - 1.73, x - 0.575, x + 0.575, x + 1.73])
        K.stat(new THREE.BoxGeometry(0.02, 0.8, 0.38), stainless, wx, 1.5, fz + 0.19, { cast: false });   // privacy wings
    }
  })(11, 17);

  /* ==========================================================
     5. THE BOARD AND THE TABLES, either side of the central lane.
        world/clutter.js keeps x[-3,3] clear from the wing door to the gate
        and it is right to: that lane is the yard's spine. So the cover goes
        BESIDE it — which is also better cover, because a lane with a blocker
        on each side is a lane you can cross unseen.
     ========================================================== */
  (function board(x, z) {
    // two posts, a steel cabinet with a cork back under glass, the sheets
    // pinned inside it (the count times, the rules, the visiting list), a hood
    for (const s of [-1, 1]) skinned(addBox(x + s * 1.35, 1.15, z, 0.16, 2.3, 0.16, C_STEEL_D, { solid: true }), "steel", C_STEEL_D);
    skinned(blocker(x, 1.85, z, 3.0, 1.5, 0.14, 0x3c4a45, { cast: false }), "steel", 0x3c4a45);
    addBox(x, 1.85, z - 0.072, 2.8, 1.3, 0.004, 0x9c7b56, { cast: false });                               // cork
    for (let i = 0; i < 6; i++)
      addBox(x - 0.9 + (i % 3) * 0.9 + ((i * 37) % 7 - 3) * 0.02, 2.12 - ((i / 3) | 0) * 0.56, z - 0.076, 0.62, 0.42 + (i % 2) * 0.06, 0.003,
        i % 2 ? 0xe8e2d2 : 0xd9d4c6, { cast: false });
    if (K) K.stat(new THREE.PlaneGeometry(2.86, 1.36), K.skin("glass", 0x9fb4c0), x, 1.85, z - 0.1, { ry: Math.PI, cast: false });
    for (const s of [-1, 1]) {
      addBox(x, 1.85 + s * 0.69, z - 0.09, 3.0, 0.06, 0.05, 0x9aa1a8, { cast: false });                  // the glazing frame
      addBox(x + s * 1.47, 1.85, z - 0.09, 0.06, 1.44, 0.05, 0x9aa1a8, { cast: false });
    }
    skinned(addBox(x, 2.68, z, 3.2, 0.16, 0.4, C_STEEL_D, { cast: false }), "steel", C_STEEL_D);          // rain hood
  })(3.6, 11);
  if (PD && typeof PD.roundTable === "function") {
    skinned(addBox(-4.0, 0.025, 11, 5.0, 0.05, 4.4, 0x8f8a80, { cast: false }), "concrete", 0x8f8a80);
    PD.roundTable(-3.0, 10.0, { tone: 0xb9b3a4, seatTone: 0x54606d });
    PD.roundTable(-5.0, 12.4, { tone: 0xb9b3a4, seatTone: 0x54606d, spin: 0.35 });
  }

  /* ==========================================================
     6. THE TOOLS. Same deferral world/crates.js used: systems/prisondrops.js
        registers its prop TYPE on the first tick, so a parse-time placement
        would silently do nothing. `world:true` inside prisonPlaceItem means
        a blade on a workbench survives a restart, which is what makes the
        route learnable.
     ========================================================== */
  const TOOLS = [
    // on the workshop bench, beside the vise and the stripped pistol
    { item: "Hacksaw Blade", x: -36.35, y: 0.95, z: 76.3 },
    // in a laundry cart, in the room with the loudest machines in the prison
    { item: "Lockpick", x: -31.0, y: 1.22, z: 92.0 },
  ];
  let laid = 0;
  CBZ.onUpdate(41.85, function () {
    if (laid || !CBZ.prisonPlaceItem) return;
    if (!CBZ.game || CBZ.game.mode !== "escape") return;
    for (let i = 0; i < TOOLS.length; i++) {
      const t = TOOLS[i];
      try { if (CBZ.prisonPlaceItem(t.item, t.x, t.y, t.z)) laid++; } catch (e) {}
    }
    if (!laid) laid = -1;                       // do not retry forever
  });

  /* ==========================================================
     7. THE RATCHET. `cover` is the owner's stealth layer stated as a number.
        The five crates were five LOS blockers in the north yard; a "fix"
        that de-props the yard by DELETING the cover would break the stealth
        game the yard exists for, so this may never read below 5.
     ========================================================== */
  CBZ.yardFurnitureAudit = function () {
    let placedTools = 0;
    const pl = (CBZ.prisonPlacedAudit && CBZ.prisonPlacedAudit()) || null;
    if (pl) placedTools = pl.standing;
    return {
      on: true,
      cover: cover,                       // >= 5: the crates' own count
      installations: 5,
      tools: TOOLS.length, toolsPlaced: laid > 0 ? laid : 0,
      placedStanding: placedTools,
      containers: 0,                      // MUST be 0 — nothing here opens
    };
  };
})();
