/* ============================================================
   world/southblock.js — the big new SOUTH BLOCK that the compound now
   extends into: a lower exercise yard ringed by a workshop, a chapel,
   an infirmary and an industrial laundry, ending at a guarded sally
   port and the freedom gate. Built from the same addBox / roomShell
   primitives as the rest of the world. Load order: after roombuild
   (needs roomShell) and after coins (needs addPack).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox || !CBZ.roomShell || !CBZ.scene) return;
  const { addBox, roomShell } = CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const S = CBZ.WORLD.southBlock;

  /* The dressing below (serving lines, wall wear, pipe runs, caged lamps,
     fire kit, door heads, the chow pad) and the rule it keeps: EVERY PROP IS
     EITHER USABLE OR IT GOES (owner, 2026-08-15: "just leave an empty room
     if you want, or find a way to make it used"). Usable = it has a collider,
     a propuse seat or bed anchor, holds a placed item, is a door or lock, is
     a pushable, or is a light fitting systems/prisonnight.js drives. The two
     flags that used to guard this (PRISON_DRESS_V2, PRISON_PROP_USE_V1) are
     burnt in: the other files that read them still declare them. */
  const PD = CBZ.prisonDress || null;   // world/cafeteria.js; degrade-safe
  // the interior finish layer (floors, trim, ceilings) and its small helpers
  const FIN = PD && PD.finish ? PD : null;
  const K = CBZ.prisonKit || null;
  const PD_M = PD && PD.Merge ? PD.Merge : null;
  const PD_PIPE = function () { if (PD && PD.pipe) return PD.pipe.apply(PD, arguments); };
  const stat = K ? K.stat : null;

  // ---- ground: a poured concrete apron + the walkway leading to the gate ----
  // PRISON_GROUND_V2 (owner: "the checkered ground is dumb" — world/ground.js
  // owns the flag). The apron is a slab, so it gets REAL EXPANSION JOINTS on a
  // ~3.1 m panel grid instead of a draughts board; joints are drawn on the
  // tile seam as well as mid-tile, so the place the texture wraps IS a joint.
  // The central path is bitumen and now reads as bitumen. Same planes, same
  // positions, same `tex.repeat.set(rx, rz)` shape — only the canvas changed.
  function slab(x, z, w, d, a, b, rx, rz, kind, y) {
    if (y == null) y = 0.012;
    const tex = CBZ.prisonGroundTex ? CBZ.prisonGroundTex(kind || "concrete", { a: a, b: b, srgb: true })
      : CBZ.checkerTex(a, b, 2);
    tex.repeat.set(rx, rz);
    const lm = new THREE.MeshLambertMaterial({ map: tex });
    if (CBZ.groundLayer) CBZ.groundLayer(lm, y);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lm);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
    return m;
  }
  // apron: repeat UNCHANGED at 14x12 on purpose — that is a 6.3 m tile, and at
  // two panels per tile the joints land on 3.15 m centres, which is what a
  // real poured apron uses. A slab is the one tiling surface allowed to show
  // where it repeats.
  slab(0, 90, 88, 76, "#8e908b", "#858782", 14, 12, "concrete");   // lower-yard apron (sRGB weathered concrete)
  // path: 1x8 -> a ~9 m square tile. The old 2x16 repeated a 4.6 m cell
  // sixteen times down the corridor you walk the whole length of.
  // PRISON_ROAD_FIX (world/ground.js owns the flag and PUBLISHES the width).
  // This is the southern 76 m of the SAME walkway ground.js draws; the two used
  // to type "9" independently, which is exactly how a 132 m two-lane band ended
  // up running the length of the compound. One number, read, never retyped.
  const WALK = (CBZ.prisonWalkway && CBZ.prisonWalkway.w) || 9;
  // THE FLICKER (owner, phone screenshot 2026-09-28: "this path flickers").
  // The path and the apron were BOTH laid at y = 0.012: two coplanar planes,
  // so the depth test flipped a coin per pixel and the bitumen's edge came
  // and went in stair-stepped teeth as you walked. The path now sits 8 mm
  // proud of the apron AND both carry the prison's one ground-layer polygon
  // offset (world/prisonkit.js CBZ.groundLayer), so the apron is pushed back
  // under the path at every distance. Square 6.3 m tile, like every patch.
  slab(0, 90, WALK, 76, "#4e5257", "#474b50", WALK / 6.3, 76 / 6.3, "asphalt", 0.02); // central path to the gate
  // (No kerb: world/ground.js dropped the pale 12 cm curb strips that ran
  // both edges; the bitumen against the concrete apron IS the path's edge.)

  /* THE HALF-COURT (rebuilt 2026-09-28). It was a flat brown 16 x 22 plane
     with white box lines, a 0.2 m box for a pole, an orange box and a white
     box for a board, and bleachers standing ON the court. Now: a sealed
     acrylic court on its own poured patch at FIBA size (15 m wide, 14 m to
     the half-court line), flush lines with the lane, free-throw circle,
     no-charge arc, three-point line and the centre half-circle
     (world/prisonkit.js courtHalf), a padded gooseneck hoop behind the
     baseline, and the bleachers off the west sideline facing it.
     x[-20.1,-5.1] z[84,98]; the 9 m walkway starts at x -4.5. */
  const CT = { cx: -12.6, bz: 84, w: 15, d: 14 };
  if (K) {
    K.ground(CT.cx - 0.05, CT.bz + CT.d / 2 - 0.7, CT.w + 1.0, CT.d + 2.6, "asphalt", { y: 0.03, a: "#3d5a6b", b: "#38535f" });
    const PY = 0.034, line = (x, z, w, d) => K.paint(x, z, w, d, 0xe9e9e4, PY);
    line(CT.cx, CT.bz, CT.w, 0.05);
    for (const s of [-1, 1]) line(CT.cx + s * CT.w / 2, CT.bz + CT.d / 2, 0.05, CT.d);
    K.courtHalf(CT.cx, CT.bz, 1, { w: CT.w, halfLine: true, keyFill: 0x7a3b30 });
    const pz = CT.bz - 0.6;
    K.hoop(CT.cx, pz, 0, 1, { reach: 1.8 });
    CBZ.colliders.push({ minX: CT.cx - 0.2, maxX: CT.cx + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2, noBreach: true });
  }

  // (The "running track" was 40 white 0.42 m squares dotted in an oval over
  // the concrete apron. Deleted 2026-09-27. The four walk-through 8 m
  // floodlight poles that stood 2-8 m from systems/prisonnight.js's real
  // yard masts were deleted 2026-08-15; the light was always the masts'.)

  // ============================================================
  //  WORKSHOP (south-west) — welding bay
  // ============================================================
  roomShell({ x0: -42, x1: -24, z0: 58, z1: 80, h: 6, wall: 0x7c8590, floor: null, skin: null, door: { side: "E", center: 69, width: 4.2 } });
  // FINISHES (2026-09-27): sealed slab, block walls with a painted dado, and a
  // hard ceiling at 5.2 m with industrial pendants: a shop keeps its height.
  if (FIN) FIN.finish({ x0: -41.75, x1: -24.25, z0: 58.25, z1: 79.75 }, {
    id: "workshop", floor: "slab", floorTint: 0x9fa3a6,
    doors: [{ side: "E", a0: 66.9, a1: 71.1 }], dado: 0x5f6975, dadoH: 1.4, base: 0x2b2d30,
    ceilingY: 5.2, ceiling: { kind: "slab", tint: 0xc9ccce, lights: "pendant", nx: 4, nz: 5, drop: 0.8 },
  });
  /* THE SHOP'S KIT (rebuilt 2026-09-28): each piece was a box standing in for
     a thing. A 3.2 m workbench is a steel frame on square legs with a lower
     shelf and a hardwood top, a bench vice bolted at one end; the forge is a
     firebrick hearth on a steel stand under a sheet-steel hood whose flue
     goes up through the ceiling (it was a black 1.8 m cube with a glowing
     orange block stuck to it); the bar stock lies on a floor rack. Colliders
     keep the same footprints, height-gated to what a body walks into. */
  const shopFrame = K ? K.skin("steel", 0x4a525c) : null, ironDark = K ? K.skin("steel", 0x2a2f36, 0.6) : null;
  // the two benches are the kit's (world/prisonkit.js workbench)
  if (K) { K.workbench(-37, 62, 3.2, 1.0); K.workbench(-37, 76, 3.2, 1.0); }
  (function forge() {
    const x = -40, z = 69;
    CBZ.colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 1.0, maxZ: z + 1.0 });
    if (!K) return;
    const brick = K.skin("block", 0x8a4b36), hood = K.skin("steel", 0x55606b);
    // the stand: four angle legs and a steel pan at waist height
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.9, 0.9]) stat(new THREE.BoxGeometry(0.07, 0.8, 0.07), shopFrame, x + sx, 0.4, z + sz, {});
    stat(new THREE.BoxGeometry(1.5, 0.06, 1.9), shopFrame, x, 0.8, z, {});
    // firebrick hearth, the fire pot sunk in it, a low back wall of brick
    stat(new THREE.BoxGeometry(1.44, 0.22, 1.84), brick, x, 0.94, z, { uv: 1 });
    stat(new THREE.BoxGeometry(0.3, 0.5, 1.84), brick, x - 0.57, 1.3, z, { uv: 1 });
    stat(new THREE.BoxGeometry(0.5, 0.02, 0.5), ironDark, x + 0.1, 1.055, z, { cast: false });
    // the tuyere and the blower on its crank at the front
    stat(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), ironDark, x + 0.1, 0.72, z + 0.5, { rx: Math.PI / 2, cast: false });
    stat(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14), ironDark, x + 0.1, 0.72, z + 0.82, { rx: Math.PI / 2, cast: false });
    // the hood on two straps off the back wall, the flue up through the 5.2 m ceiling
    stat(new THREE.CylinderGeometry(0.16, 0.72, 0.6, 4, 1, true), hood, x + 0.05, 2.25, z, { ry: Math.PI / 4, cast: false });
    stat(new THREE.CylinderGeometry(0.15, 0.15, 2.7, 12), hood, x + 0.05, 3.85, z, { cast: false });
    for (const sz of [-0.4, 0.4]) stat(new THREE.BoxGeometry(0.04, 0.45, 0.04), shopFrame, x - 0.45, 1.765, z + sz, { cast: false });
    // the coke bed: a dull red, the one thing in the room that should glow a little
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 12),
      new THREE.MeshLambertMaterial({ color: 0x3a1a10, emissive: 0x7a2208, emissiveIntensity: 0.55 }));
    bed.position.set(x + 0.1, 1.07, z); scene.add(bed);
  })();
  // bar stock on a floor rack: two steel stands, round bar and box section.
  // Solid, y-gated to the stack's own top: an obstacle, never a pillar.
  (function stock() {
    const x = -26.8, z = 75.25;
    CBZ.colliders.push({ minX: x - 1.3, maxX: x + 1.3, minZ: z - 0.45, maxZ: z + 0.45, y0: 0, y1: 0.78 });
    if (!K) return;
    const bar = K.skin("steel", 0x6b7480, 0.45), rust = K.skin("steel", 0x6b4a3a, 0.8);
    for (const sx of [-0.9, 0.9]) {
      for (const sz of [-0.38, 0.38]) stat(new THREE.BoxGeometry(0.06, 0.56, 0.06), shopFrame, x + sx, 0.28, z + sz, { cast: false });
      for (const y of [0.2, 0.46]) stat(new THREE.BoxGeometry(0.06, 0.05, 0.82), shopFrame, x + sx, y, z, { cast: false });
    }
    for (let i = 0; i < 7; i++) stat(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 8), i % 3 ? bar : rust, x, 0.245 + (i & 1) * 0.03, z - 0.33 + i * 0.11, { rz: Math.PI / 2, cast: false });
    for (let i = 0; i < 5; i++) stat(new THREE.BoxGeometry(2.6, 0.05, 0.05), bar, x + (i & 1) * 0.08, 0.51, z - 0.3 + i * 0.15, { cast: false });
  })();
  // (the 1.6 m wooden crate that stood alone in the corner is gone: no reason)

  // ============================================================
  //  CHAPEL (south-east) — the quiet wing
  // ============================================================
  roomShell({ x0: 24, x1: 42, z0: 58, z1: 80, h: 6.5, wall: 0xbfb6a4, floor: null, skin: null, door: { side: "W", center: 69, width: 4.2 } });
  /* THE CHAPEL, REBUILT (2026-09-27). The pews ran EAST-WEST with the altar at
     the east wall — every seat faced the side wall — and they were a plank
     and a board, full-height colliders. The cross was two glowing yellow
     boxes and the "stained glass" three glowing coloured slabs at 4 m.
     Now: warm VCT with a carpet runner up the aisle from the door, a 4.6 m
     ceiling with pendants, twelve pews in two banks FACING the altar, a
     draped altar table on a low dais, a plain wooden cross on the east wall,
     and three tall narrow windows set into it. */
  if (FIN) {
    FIN.finish({ x0: 24.25, x1: 41.75, z0: 58.25, z1: 79.75 }, {
      id: "chapel", floor: "vct", floorTint: 0xcbb99a,
      doors: [{ side: "W", a0: 66.9, a1: 71.1 }], base: 0x3a2c20,
      ceilingY: 4.6, ceiling: { kind: "slab", tint: 0xe2dccd, lights: "pendant", nx: 3, nz: 4, drop: 0.7 },
    });
    FIN.floor(24.25, 38.6, 67.4, 70.6, "carpet", 0x7a2f2f, { top: 0.068 });          // the aisle runner
  }
  // the dais and the altar table with its cloth
  addBox(39.6, 0.1, 69, 3.2, 0.2, 7.0, 0x8a7358, { solid: true, y0: 0, y1: 0.2 });
  addBox(40.2, 0.62, 69, 0.9, 0.84, 2.0, 0x6b4a2a, { solid: true, y0: 0, y1: 1.05 });   // altar
  addBox(40.2, 1.055, 69, 0.96, 0.03, 2.06, 0xefe9da, { cast: false });                 // altar cloth
  addBox(39.73, 0.8, 69, 0.02, 0.5, 2.06, 0xefe9da, { cast: false });                   // its front fall
  addBox(39.72, 0.86, 69, 0.012, 0.3, 0.18, 0x7a2f2f, { cast: false });                 // the stole mark
  // the cross: plain wood, on the wall, lit by the room
  addBox(41.68, 2.7, 69, 0.08, 2.0, 0.16, 0x6b4a2a, { cast: false });
  addBox(41.68, 3.15, 69, 0.08, 0.16, 1.0, 0x6b4a2a, { cast: false });
  // three tall narrow windows in the east wall, clear leaded glass in a frame
  for (let i = -1; i <= 1; i += 2) {
    const z = 69 + i * 4.2;
    addBox(41.72, 2.6, z, 0.06, 2.6, 0.9, 0x3a3f46, { cast: false });                  // frame
    addBox(41.68, 2.6, z, 0.02, 2.44, 0.74, 0x9fb4be, { cast: false });                // clear glass (it glowed at midnight)
    for (const t of [-0.6, 0, 0.6]) addBox(41.665, 2.6 + t, z, 0.01, 0.02, 0.74, 0x3a3f46, { cast: false });
    addBox(41.665, 2.6, z, 0.01, 2.44, 0.02, 0x3a3f46, { cast: false });
  }
  // PEWS, facing +x at the altar: seat, raked back, two end panels. The seat
  // is the collider (waist-gated), and each pew declares three seats.
  function pew(x, zc, len) {
    addBox(x, 0.45, zc, 0.46, 0.05, len, 0x8a5e2b, { solid: true, y0: 0, y1: 0.95 });
    const back = addBox(x - 0.25, 0.72, zc, 0.05, 0.52, len, 0x7a5226, { cast: false });
    back.rotation.z = 0.1;
    addBox(x - 0.1, 0.24, zc, 0.03, 0.2, len - 0.1, 0x6e4a22, { cast: false });       // stretcher
    for (const e of [-1, 1]) addBox(x - 0.02, 0.47, zc + e * (len / 2 + 0.03), 0.58, 0.94, 0.05, 0x6e4a22, { cast: false });
    for (let k = 0; k < 3; k++) if (CBZ.roomSeatAnchor)
      CBZ.roomSeatAnchor(x + 0.04, 0, zc - len / 3 + k * len / 3, Math.PI / 2, "bench", null, { cushion: 0.475, floorBelow: 0 });
  }
  for (let r = 0; r < 6; r++) { const x = 27.2 + r * 1.55; pew(x, 63.2, 5.2); pew(x, 74.8, 5.2); }

  // ============================================================
  //  INFIRMARY (east, lower) — beds + screens
  // ============================================================
  roomShell({ x0: 26, x1: 42, z0: 88, z1: 104, h: 6, wall: 0xd7dde2, floor: null, skin: null, door: { side: "W", center: 96, width: 4.0 } });
  /* THE INFIRMARY, REBUILT (2026-09-27). Four beds stood in the middle of a
     6 m-high room, each with a grey board beside it as a "privacy screen",
     and a cabinet with a glowing blue rectangle stuck to it. A ward is beds
     with their heads to the wall, curtain tracks on the ceiling between
     them, a treatment area, a sink, and a nurse's desk by the door — under a
     3 m lay-in ceiling with troffers, on sheet vinyl. */
  const IR = { x0: 26.25, x1: 41.75, z0: 88.25, z1: 103.75 }, ICEIL = 3.0;
  if (FIN) FIN.finish(IR, {
    id: "infirmary", floor: "vct", floorTint: 0xb9c2bd,
    doors: [{ side: "W", a0: 94, a1: 98 }], dado: 0xa9c1b8, dadoH: 1.1, base: 0x39514a, rail: 0x7f9a91,
    ceilingY: ICEIL, ceiling: { kind: "acoustic", lights: "troffer", along: "x", nx: 4, nz: 4 },
  });
  const BED_X = [29.0, 32.5, 36.0, 39.5], BED_Z = 89.62;
  function bed(x, z) {
    // THE WARD BED IS THE SHARED KIT'S (CBZ.furnish.bed, "clinic" tone), head
    // at -z against the north wall; the authored slabs are the degrade path.
    const F = CBZ.furnish;
    let kitTop = null;
    if (F && typeof F.bed === "function") {
      try { if (F.bed(x, 0, z, Math.PI, { len: 2.4, wide: 1.2, tone: "clinic" })) kitTop = 0.55; }
      catch (e) { kitTop = null; }
    }
    if (kitTop == null) {
      addBox(x, 0.45, z, 1.2, 0.2, 2.4, 0x9aa0a8, { solid: true });
      addBox(x, 0.62, z, 1.1, 0.14, 2.3, 0xeef2f5, { cast: false });
      addBox(x, 0.78, z - 0.9, 0.9, 0.16, 0.5, 0xdfe6ec, { cast: false });
    }
    const topY = kitTop != null ? kitTop : 0.69;
    if (CBZ.roomBedAnchor) CBZ.roomBedAnchor(x, 0, z, 0, -1, 2.4, topY, "bed", null);
    else if (CBZ.propRegisterBed) CBZ.propRegisterBed(x, 0, z, 0, -1, 2.4, topY, "bed", null);
    // bedside locker at the head, right-hand side
    addBox(x + 0.95, 0.42, z - 0.8, 0.46, 0.72, 0.46, 0xe4e1d8, { solid: true, y0: 0, y1: 0.8 });
    addBox(x + 0.95, 0.785, z - 0.8, 0.5, 0.03, 0.5, 0xc9c4b8, { cast: false });
    addBox(x + 0.71, 0.45, z - 0.8, 0.012, 0.3, 0.36, 0xd1cdc2, { cast: false });
    // the headwall service rail: oxygen/suction outlets and a call button
    addBox(x, 1.45, IR.z0 + 0.03, 1.6, 0.16, 0.05, 0xe9e7e0, { cast: false });
    addBox(x - 0.4, 1.45, IR.z0 + 0.06, 0.08, 0.08, 0.03, 0x3a8a4a, { cast: false });
    addBox(x - 0.2, 1.45, IR.z0 + 0.06, 0.08, 0.08, 0.03, 0xe8e8e8, { cast: false });
  }
  for (const x of BED_X) bed(x, BED_Z);
  // CUBICLE CURTAINS: tracks screwed to the ceiling between and in front of
  // the beds; the dividers drawn, the front curtains pushed back to the walls
  if (PD_M) (function curtains() {
    const trackY = ICEIL - 0.04, front = BED_Z + 1.75;
    const rail = new PD_M(), cloth = new PD_M(), mesh = new PD_M();
    rail.box((IR.x0 + IR.x1) / 2, trackY, front, IR.x1 - IR.x0 - 0.2, 0.03, 0.05);
    for (let i = 0; i < 3; i++) {
      const x = (BED_X[i] + BED_X[i + 1]) / 2;
      rail.box(x, trackY, (IR.z0 + front) / 2, 0.05, 0.03, front - IR.z0);
      // the drawn divider: fabric from the knees to the mesh band, gently folded
      for (let k = 0; k < 7; k++) {
        const z = IR.z0 + 0.25 + k * (front - IR.z0 - 0.4) / 6.5;
        cloth.box(x + (k & 1 ? 0.03 : -0.03), 1.33, z, 0.02, 1.9, (front - IR.z0 - 0.4) / 6.2);
      }
      mesh.box(x, 2.6, (IR.z0 + front) / 2, 0.015, 0.5, front - IR.z0 - 0.2);
    }
    // the front curtains, gathered back at the two ends of the run
    for (const x of [IR.x0 + 0.45, IR.x1 - 0.45]) {
      for (let k = 0; k < 4; k++) cloth.box(x + (k - 1.5) * 0.08, 1.33, front + (k & 1 ? 0.03 : -0.03), 0.07, 1.9, 0.05);
      mesh.box(x, 2.6, front, 0.32, 0.5, 0.015);
    }
    rail.mesh(CBZ.cmat(0xc9ccd0));
    cloth.mesh(CBZ.cmat(0x8fb3ad));
    mesh.mesh(CBZ.cmat(0xe6ebe8));
  })();
  // an IV pole and a vitals monitor by the first bed
  PD_PIPE(BED_X[0] - 0.85, 0.95, BED_Z - 0.4, 1.8, "y", 0.013, 0xc3c9d0);
  addBox(BED_X[0] - 0.85, 0.07, BED_Z - 0.4, 0.5, 0.03, 0.5, 0x6b7480, { cast: false });
  addBox(BED_X[0] - 0.85, 1.72, BED_Z - 0.45, 0.14, 0.2, 0.05, 0xe8f0f2, { cast: false });   // bag
  addBox(BED_X[0] - 0.85, 1.25, BED_Z - 0.3, 0.3, 0.24, 0.14, 0x2a2f38, { cast: false });   // monitor
  addBox(BED_X[0] - 0.85, 1.25, BED_Z - 0.225, 0.26, 0.18, 0.005, 0x10261c, { emissive: 0x1d6a3a, ei: 0.55, cast: false });
  // THE TREATMENT AREA (south-east): an exam couch with its paper roll, a
  // sink run on the east wall with wall cabinets over it, a glazed supply
  // cabinet, and the sharps box. The door lane (z 94..98) is clear to x 40.
  addBox(38.2, 0.36, 102.4, 1.9, 0.6, 0.62, 0xd9d4c8, { solid: true, y0: 0, y1: 0.8 });      // couch base
  addBox(38.0, 0.72, 102.4, 1.5, 0.1, 0.7, 0x2f6f73, { cast: false });                       // pad
  const headRest = addBox(39.1, 0.83, 102.4, 0.62, 0.1, 0.7, 0x2f6f73, { cast: false });      // raised head
  headRest.rotation.z = 0.32;
  addBox(38.0, 0.78, 102.4, 1.5, 0.006, 0.5, 0xf4f1e8, { cast: false });                     // paper sheet
  PD_PIPE(37.2, 0.78, 102.4, 0.58, "z", 0.05, 0xf4f1e8);                                     // the roll
  // sink run: base cabinets, a laminate top, a steel basin, a gooseneck
  addBox(41.43, 0.45, 97.2 + 3.3, 0.6, 0.78, 2.6, 0xe4e1d8, { solid: true, y0: 0, y1: 0.95 });
  addBox(41.42, 0.88, 100.5, 0.66, 0.04, 2.66, 0xcfd6d4, { cast: false });
  addBox(41.4, 0.885, 100.1, 0.4, 0.012, 0.5, 0x8d959c, { cast: false });                  // basin
  addBox(41.64, 1.0, 100.1, 0.04, 0.24, 0.04, 0xc3c9d0, { cast: false });                    // faucet
  addBox(41.56, 1.12, 100.1, 0.18, 0.03, 0.03, 0xc3c9d0, { cast: false });
  for (let i = 0; i < 4; i++) addBox(41.12, 0.47, 99.53 + i * 0.65, 0.012, 0.62, 0.6, 0xd6d2c7, { cast: false });  // doors
  addBox(41.55, 1.9, 100.5, 0.35, 0.7, 2.6, 0xe4e1d8, { cast: false });                     // wall cabinets
  for (let i = 0; i < 4; i++) addBox(41.37, 1.9, 99.53 + i * 0.65, 0.012, 0.62, 0.58, 0xbfd6dc, { cast: false });
  addBox(41.6, 1.3, 98.6, 0.14, 0.3, 0.22, 0xd8b021, { cast: false });                      // sharps box
  // glazed supply cabinet on the south wall
  addBox(34.0, 0.95, 103.45, 1.2, 1.9, 0.5, 0xd9dcdf, { solid: true });
  addBox(34.0, 1.2, 103.19, 1.1, 1.3, 0.012, 0xbfd6dc, { cast: false });
  for (let i = 0; i < 3; i++) addBox(34.0, 0.75 + i * 0.42, 103.3, 1.1, 0.02, 0.4, 0xc9ccd0, { cast: false });
  for (let i = 0; i < 6; i++) addBox(33.6 + (i % 3) * 0.35, 0.83 + ((i / 3) | 0) * 0.42, 103.32, 0.24, 0.14, 0.2, [0xeef0f2, 0x7aa6c2, 0xe0d6c0][i % 3], { cast: false });
  // GAUZE ON THE COUNTER: real rolls (systems/prisondrops.js "gauze", the
  // economy's "Bandage") by the sink, where a nurse leaves them out. Walk
  // over one and it is in your pocket; it wraps a bleed (systems/vitals.js).
  // Laid on the first escape tick (prisondrops parses after the world).
  {
    let laidGauze = false;
    CBZ.onUpdate(41.43, function () {
      if (laidGauze || !CBZ.prisonPlaceItem || !CBZ.game || CBZ.game.mode !== "escape") return;
      laidGauze = true;
      for (const z of [101.25, 101.5, 99.45]) { try { CBZ.prisonPlaceItem("Bandage", 41.22, 0.937, z); } catch (e) {} }
    });
  }
  // the nurse's desk by the door, facing into the ward
  if (CBZ.furnish && CBZ.furnish.desk) { try { CBZ.furnish.desk(28.0, 0, 101.9, 0, { len: 1.6 }); } catch (e) {} }
  if (CBZ.furnish && CBZ.furnish.chair) { try { CBZ.furnish.chair(28.0, 0, 102.9, Math.PI, {}); } catch (e) {} }

  // ============================================================
  //  LAUNDRY (west, lower) — steam, machines & carts
  // ============================================================
  roomShell({ x0: -42, x1: -26, z0: 88, z1: 104, h: 6, wall: 0x8a929c, floor: null, skin: null, door: { side: "E", center: 96, width: 4.0 } });
  if (FIN) FIN.finish({ x0: -41.75, x1: -26.25, z0: 88.25, z1: 103.75 }, {
    id: "laundry", floor: "slab", floorTint: 0xa3a8ac,
    doors: [{ side: "E", a0: 94, a1: 98 }], dado: 0x6b7784, dadoH: 1.4, base: 0x2b2d30,
    ceilingY: 4.4, ceiling: { kind: "slab", tint: 0xcfd2d3, lights: "vapor", nx: 3, nz: 4, along: "z" },
  });
  // a bank of industrial washer-extractors along the west wall: a steel
  // cabinet on a plinth, a round porthole door in a chrome ring, the control
  // panel over it. (The "glass" was a glowing blue square.)
  for (let i = 0; i < 4; i++) {
    const z = 90 + i * 3.5;
    addBox(-40.3, 0.1, z, 1.6, 0.2, 1.7, 0x3c424d, { cast: false });                 // plinth
    const body = addBox(-40.3, 1.0, z, 1.5, 1.6, 1.6, 0xc4cad0, { solid: true });   // cabinet
    if (K) K.skinBox(body, "steel", 0xc4cad0);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 20), CBZ.cmat(0x9aa3ad));
    ring.rotation.z = Math.PI / 2; ring.position.set(-39.52, 0.95, z); scene.add(ring);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 20), CBZ.cmat(0x2a3440));
    glass.rotation.z = Math.PI / 2; glass.position.set(-39.51, 0.95, z); scene.add(glass);
    addBox(-39.53, 1.6, z, 0.04, 0.3, 1.3, 0x3a4048, { cast: false });                // control panel
    addBox(-39.5, 1.62, z + 0.35, 0.02, 0.08, 0.2, 0x1e4a2e, { emissive: 0x1a5a30, ei: 0.5, cast: false });
    addBox(-39.5, 1.3, z - 0.55, 0.05, 0.16, 0.06, 0xc3c9d0, { cast: false });        // door latch
  }
  /* ROLLING LAUNDRY CARTS: a canvas bag slung in a galvanised tube frame on
     four swivel casters, heaped with the day's wash (it was a white box on a
     grey box). Solid (the only cover on this floor, height-gated to the rim);
     the (-29.5, 99) cart is a PUSHABLE, the (-31, 92) one stays put because
     world/yardfurniture.js lays the LOCKPICK on its heap at y 1.22. Each cart
     builds its own geometry: core/batch.js disposes what it merges, so a
     static cart must never share a buffer with a moving one. */
  const BGU = THREE.BufferGeometryUtils;
  const cartCanvas = new THREE.MeshLambertMaterial({ color: 0xc9c1aa, side: THREE.DoubleSide });
  const cartWash = new THREE.MeshLambertMaterial({ color: 0xe4e0d6 });
  const cartFrame = K ? K.skin("galv", 0xb4bcc4) : CBZ.cmat(0xb4bcc4);
  function mergeParts(list) {
    const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of flat) for (const n of Object.keys(g.attributes)) if (n !== "position" && n !== "normal" && n !== "uv") g.deleteAttribute(n);
    const out = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(flat, false) : null;
    return out || flat[0];
  }
  function cart(x, z, push) {
    const X = 0.6, Z = 0.7, R0 = 0.3, R1 = 1.13;
    const rod = (ax, ay, az, bx, by, bz, r) => {
      const d = new THREE.Vector3(bx - ax, by - ay, bz - az), len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, 6);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
      g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      return g;
    };
    const fr = [];
    for (const sx of [-X, X]) for (const sz of [-Z, Z]) {
      fr.push(rod(sx, 0.16, sz, sx, R1, sz, 0.016));
      const f = new THREE.BoxGeometry(0.06, 0.05, 0.05); f.translate(sx, 0.11, sz); fr.push(f);              // caster fork
      const w = new THREE.CylinderGeometry(0.055, 0.055, 0.035, 12); w.rotateZ(Math.PI / 2); w.translate(sx, 0.055, sz); fr.push(w);
    }
    for (const y of [0.16, R0, R1]) {
      fr.push(rod(-X, y, -Z, X, y, -Z, 0.014), rod(-X, y, Z, X, y, Z, 0.014));
      fr.push(rod(-X, y, -Z, -X, y, Z, 0.014), rod(X, y, -Z, X, y, Z, 0.014));
    }
    const bag = [];
    const side = (w, h, px, py, pz, ry) => { const g = new THREE.PlaneGeometry(w, h); if (ry) g.rotateY(ry); g.translate(px, py, pz); bag.push(g); };
    const bh = R1 - R0 - 0.02, by = (R0 + R1) / 2;
    side(2 * X - 0.04, bh, 0, by, -Z + 0.02, 0); side(2 * X - 0.04, bh, 0, by, Z - 0.02, 0);
    side(2 * Z - 0.04, bh, -X + 0.02, by, 0, Math.PI / 2); side(2 * Z - 0.04, bh, X - 0.02, by, 0, Math.PI / 2);
    const floor = new THREE.PlaneGeometry(2 * X - 0.04, 2 * Z - 0.04); floor.rotateX(-Math.PI / 2); floor.translate(0, R0 + 0.01, 0); bag.push(floor);
    const heap = new THREE.SphereGeometry(0.5, 14, 8); heap.scale(1.1, 0.3, 1.3); heap.translate(0, 1.06, 0);
    const mk = (g, m, cast) => { const me = new THREE.Mesh(g, m); me.position.set(x, 0, z); me.castShadow = cast; me.receiveShadow = true; scene.add(me); return me; };
    const bagM = mk(mergeParts(bag), cartCanvas, true), frameM = mk(mergeParts(fr), cartFrame, true), heapM = mk(heap, cartWash, false);
    if (push && CBZ.pushProp) {
      CBZ.pushProp({ parts: [bagM, frameM, heapM], x: x, z: z, hx: 0.65, hz: 0.75, y1: 1.15, mass: 30, kind: "cart", leash: 5.0, mode: "escape" });
    } else {
      CBZ.colliders.push({ minX: x - 0.65, maxX: x + 0.65, minZ: z - 0.75, maxZ: z + 0.75, y0: 0, y1: 1.15 });
    }
  }
  cart(-31, 92, false); cart(-29.5, 99, true);

  // ============================================================
  //  HOUSING D — controlled open-bay dormitory, 16 real beds
  // ============================================================
  /* The playable cast needs forty-two places to sleep. The cell house owns
     twenty-six; the old answer was sixteen loose mats scattered through its
     dayroom and the route to the yard gate. This room closes that exact gap
     with eight double stacks, using cellblock.js's own bunk builder and bed
     registration. It also puts the beds where a jail puts beds: inside one
     bounded, observable housing unit with sanitation, a bolted table, a
     controlled opening, and a clear sightline from the staffed sally-port
     side. Nothing below is generic yard garnish.

     GEOMETRY: the former water-tower corner, x[-42,-24] z[106,124]. Its north
     entrance faces the program yard; the west observation bay lets staff see
     the central aisle without stepping inside; the 3.4 m door lane remains
     clear through the first third of the room. */
  const HD = { id: "south-dorm", x0: -42, x1: -24, z0: 106, z1: 124, doorX: -33, doorZ: 106 };
  roomShell({
    x0: HD.x0, x1: HD.x1, z0: HD.z0, z1: HD.z1, h: 6,
    wall: 0x76818c, floor: null, skin: null,
    doors: [
      { side: "N", center: HD.doorX, width: 3.4 },
      { side: "N", center: -38.5, width: 3.0 },
    ],
  });
  // Human-scale entrance head + jambs. Like the main housing gate, the head
  // is visual/LOS structure only: a solid overhead box would be a full-height
  // 2-D collider to the actor system.
  addBox(HD.doorX, 4.65, HD.z0, 3.4, 2.7, 0.5, 0x76818c, { cast: false, blockLOS: true });
  addBox(HD.doorX - 1.78, 1.65, HD.z0 - 0.02, 0.18, 3.3, 0.62, 0x39424e, { cast: false });
  addBox(HD.doorX + 1.78, 1.65, HD.z0 - 0.02, 0.18, 3.3, 0.62, 0x39424e, { cast: false });
  addBox(HD.doorX, 3.28, HD.z0 - 0.02, 3.74, 0.18, 0.62, 0x39424e, { cast: false });

  // Observation opening: real gap in roomShell, rebuilt as wall below/above a
  // clear pane and a security grille. The pane's collider is the wall here;
  // staff can see through it, nobody can walk through it.
  addBox(-38.5, 0.67, HD.z0, 3.0, 1.34, 0.5, 0x76818c, { solid: true, blockLOS: true });
  addBox(-38.5, 4.30, HD.z0, 3.0, 3.40, 0.5, 0x76818c, { cast: false, blockLOS: true });
  const dormPane = addBox(-38.5, 2.05, HD.z0 - 0.03, 2.82, 1.42, 0.16, 0xa9d9ea,
    { solid: true, cast: false });
  dormPane.material.transparent = true; dormPane.material.opacity = 0.34; dormPane.material.depthWrite = false;
  for (let i = -2; i <= 2; i++)
    addBox(-38.5 + i * 0.55, 2.05, HD.z0 - 0.16, 0.08, 1.46, 0.08, 0x39424e, { cast: false });
  addBox(-38.5, 1.36, HD.z0 - 0.16, 2.9, 0.10, 0.10, 0x39424e, { cast: false });
  addBox(-38.5, 2.74, HD.z0 - 0.16, 2.9, 0.10, 0.10, 0x39424e, { cast: false });

  const housing = {
    id: HD.id, bounds: HD, beds: [],
    route: { x: HD.doorX, z: HD.z0 + 1.1 },
    contains: function (x, z, pad) {
      pad = pad || 0;
      return x > HD.x0 - pad && x < HD.x1 + pad && z > HD.z0 - pad && z < HD.z1 + pad;
    },
  };
  CBZ.prisonHousing = housing;
  const dormZ = [109.2, 113.1, 117.0, 120.9];
  const blankets = [0x4a5b46, 0x5c6470, 0x6b6152, 0x53535e];
  if (CBZ.prisonBunk) {
    for (let side = 0; side < 2; side++) for (let i = 0; i < dormZ.length; i++) {
      const stack = CBZ.prisonBunk({
        id: "D-" + (side ? "E" : "W") + (i + 1), unit: housing,
        x: side ? -26.0 : -40.0, z: dormZ[i], along: "z", double: true,
        blanket: blankets[(i + side) % blankets.length],
      });
      if (stack) housing.beds.push(stack);
    }
  }

  // One bolted day table, offset from the entrance lane: the prison's own
  // welded round table with its four stools (world/cafeteria.js roundTable
  // declares the seats and the colliders). It was a grey slab on a post with
  // four square pads.
  if (PD && PD.roundTable) PD.roundTable(-36.0, 116.0, { seatTone: 0x52606d });

  /* Sanitation on the back wall, screened from the bunks but open to staff
     observation above shoulder height. Each fixture is the stainless combi
     unit a jail bolts to a wall: a chase with the basin and push-button tap
     on top, the bowl with its rolled rim cantilevered off the front, no seat
     (it was four boxes). The two screens are stainless sheet on a top rail. */
  if (K) {
    const ss = K.skin("steel", 0xc9ced3, 0.28), ssDark = K.skin("steel", 0x6b7480, 0.4);
    const WZ = 123.75;                                           // the dorm's back wall, inner face
    for (const x of [-34.4, -31.6]) K.combi(x, WZ, 0, -1);
    for (const x of [-35.55, -30.45]) {
      stat(new THREE.BoxGeometry(0.03, 1.8, 1.9), ss, x, 1.05, WZ - 1.0, {});
      stat(new THREE.BoxGeometry(0.05, 0.05, 2.0), ssDark, x, 1.97, WZ - 1.0, { cast: false });
      stat(new THREE.BoxGeometry(0.05, 0.14, 0.05), ssDark, x, 0.07, WZ - 1.9, { cast: false });   // the foot
    }
  }
  if (FIN) FIN.finish({ x0: -41.75, x1: -24.25, z0: 106.25, z1: 123.75 }, {
    id: "south-dorm", floor: "slab", floorTint: 0x9da2a6,
    doors: [{ side: "N", a0: -34.7, a1: -31.3 }, { side: "N", a0: -40, a1: -37 }], dado: 0x5d6873, dadoH: 1.3, base: 0x2b2d30,
    ceilingY: 3.6, ceiling: { kind: "slab", tint: 0xc9ccce, lights: "vapor", nx: 3, nz: 4, along: "z",
      skip: (x, z) => z > 121.4 && x > -36 && x < -30 },
  });

  // ============================================================
  //  LOWER-YARD FITTINGS: weights, pull-up rig, bleachers
  // ============================================================
  /* WEIGHT BENCHES (rebuilt 2026-09-28). A flat press bench is a padded top
     on a tube frame with a T-foot, a base bar and two uprights carrying the
     racked bar on J-hooks; it was a 0.7 x 2.2 slab with a box for a bar and
     two boxes for plates. The pad's top is 0.53 m, where the propuse seat
     anchor has always sat. The loaded bar (shaft, sleeves, two plates a side,
     spring collars) is two meshes and a PUSHABLE, as before: 60 kg of free
     weight in the hooks, not something welded to the sky. */
  const benchVinyl = K ? K.skin("steel", 0x1c1e22, 0.7) : CBZ.cmat(0x1c1e22);
  const benchFrame = K ? K.skin("steel", 0x3a4048) : CBZ.cmat(0x3a4048);
  const barSteel = K ? K.skin("galv", 0xb4bcc4) : CBZ.cmat(0xb4bcc4);
  const plateIron = K ? K.skin("steel", 0x1c1e22, 0.7) : CBZ.cmat(0x1c1e22);
  function barbell(x, y, z) {
    const bar = [], plates = [];
    const cyl = (list, r, len, cx, seg) => { const g = new THREE.CylinderGeometry(r, r, len, seg || 12); g.rotateZ(Math.PI / 2); g.translate(cx, 0, 0); list.push(g); };
    cyl(bar, 0.014, 1.31, 0);
    for (const s of [-1, 1]) {
      cyl(bar, 0.032, 0.03, s * 0.67);                 // the inner collar
      cyl(bar, 0.025, 0.41, s * 0.89);                 // the sleeve
      cyl(plates, 0.225, 0.05, s * 0.715, 24);         // two 20 kg plates
      cyl(plates, 0.225, 0.05, s * 0.768, 24);
      cyl(bar, 0.04, 0.03, s * 0.81);                  // spring collar
    }
    const mk = (list, m) => { const me = new THREE.Mesh(mergeParts(list), m); me.position.set(x, y, z); me.castShadow = true; scene.add(me); return me; };
    return [mk(plates, plateIron), mk(bar, barSteel)];
  }
  function weightBench(x, z) {
    // yaw 0 looks +z; the bar is racked at the -z end, so PI faces the lifter up the bench
    CBZ.colliders.push({ minX: x - 0.62, maxX: x + 0.62, minZ: z - 0.66, maxZ: z + 0.72 });
    if (K) {
      const pad = K.profileGeo([[-0.58, 0.46], [-0.58, 0.51], [0.58, 0.51], [0.58, 0.46]], 0.28, 0.02);
      stat(pad, benchVinyl, x, 0, z + 0.1, {});
      stat(new THREE.BoxGeometry(0.24, 0.03, 1.14), benchFrame, x, 0.425, z + 0.1, { cast: false });
      K.tube(x, 0.38, z - 0.6, x, 0.38, z + 0.66, 0.035, benchFrame, { cast: false });                 // the spine
      K.tube(x, 0.03, z + 0.66, x, 0.4, z + 0.66, 0.035, benchFrame, { cast: false });                  // front post
      K.tube(x - 0.25, 0.03, z + 0.66, x + 0.25, 0.03, z + 0.66, 0.03, benchFrame, { cast: false });    // T-foot
      K.tube(x - 0.6, 0.03, z - 0.6, x + 0.6, 0.03, z - 0.6, 0.03, benchFrame, { cast: false });        // base bar
      for (const s of [-1, 1]) {
        K.tube(x + s * 0.55, 0.0, z - 0.6, x + s * 0.55, 1.22, z - 0.6, 0.035, benchFrame, {});        // upright
        stat(new THREE.BoxGeometry(0.06, 0.12, 0.1), benchFrame, x + s * 0.55, 1.12, z - 0.53, { cast: false });   // J-hook
      }
    }
    if (CBZ.roomSeatAnchor)
      CBZ.roomSeatAnchor(x, 0, z + 0.3, Math.PI, "bench", null, { cushion: 0.53, floorBelow: 0 });
    const parts = barbell(x, 1.2, z - 0.5);
    if (CBZ.pushProp) CBZ.pushProp({
      parts: parts, x: x, z: z - 0.5, hx: 1.1, hz: 0.26, y1: 1.35,
      mass: 60, kind: "barbell", leash: 3.0, mode: "escape",
    });
  }
  weightBench(8, 100); weightBench(11, 106);
  /* PULL-UP AND DIP STATION: three posts on base plates carrying two bars at
     different heights (2.25 and 2.55 m), and a pair of parallel dip bars on
     their own four posts. It was a 9 m box crossbar on two box sticks. The
     posts and the dip frame are solid; the bars are overhead. */
  (function pullups() {
    const z = 110, posts = [4, 7.5, 11];
    for (const px of posts) CBZ.colliders.push({ minX: px - 0.12, maxX: px + 0.12, minZ: z - 0.12, maxZ: z + 0.12 });
    CBZ.colliders.push({ minX: 12.55, maxX: 13.65, minZ: z - 0.36, maxZ: z + 0.36, y0: 0, y1: 1.3 });
    if (!K) return;
    const plate = K.skin("galv", 0x9aa1a8);
    for (const px of posts) {
      stat(new THREE.BoxGeometry(0.3, 0.02, 0.3), plate, px, 0.01, z, { cast: false });
      K.tube(px, 0, z, px, 2.7, z, 0.05, benchFrame, { seg: 10 });
      stat(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 10), benchFrame, px, 2.71, z, { cast: false });
    }
    K.tube(4, 2.25, z, 7.5, 2.25, z, 0.017, barSteel, { cast: false });
    K.tube(7.5, 2.55, z, 11, 2.55, z, 0.017, barSteel, { cast: false });
    for (const sz of [-0.28, 0.28]) {
      for (const px of [12.65, 13.55]) K.tube(px, 0, z + sz, px, 1.25, z + sz, 0.03, benchFrame, { cast: false });
      K.tube(12.6, 1.25, z + sz, 13.6, 1.25, z + sz, 0.022, barSteel, { cast: false });
    }
  })();
  // BLEACHERS off the half-court's west sideline, facing it: three rows of
  // aluminium plank on stringers (world/prisonkit.js), four seats a row. The
  // old three stepped slabs stood on the court itself.
  if (K) K.bleacher(-21.4, 88.9, 7.5, { rows: 3, seats: 4 });

  // ============================================================
  //  SALLY PORT — checkpoint flanking the gate, guard hut, transport
  // ============================================================
  // The checkpoint pillars, the red boom and the jersey barriers that stood
  // here until 2026-09-05 are gone: the exit is a building now
  // (world/sallyport.js — a fenced walkway into a vestibule with a barred
  // grille on the wall line), and nothing a prison does not have stands in
  // front of it.
  // guard hut (small roofed booth)
  roomShell({ x0: -22, x1: -14, z0: 116, z1: 124, h: 3.2, wall: 0x515a66, floor: null, skin: null, door: { side: "E", center: 120, width: 2.2 } });
  if (FIN) FIN.finish({ x0: -21.75, x1: -14.25, z0: 116.25, z1: 123.75 }, {
    id: "gatehouse", floor: "vct", floorTint: 0xb8b6ae,
    doors: [{ side: "E", a0: 118.9, a1: 121.1 }], dado: 0x3f4751, dadoH: 1.1, base: 0x1d1f22,
    ceilingY: 2.8, ceiling: { kind: "acoustic", lights: "troffer", nx: 2, nz: 2 },
  });
  /* the hut's doorway was a 3.2 m slot to the roof slab with no head and no
     door. A head over 2.4 m (never solid: see the dorm's note below) and a
     pair of steel leaves in a frame, hooked back against the yard face: the
     post is manned all day and its door stands open. */
  addBox(-14, 2.8, 120, 0.5, 0.8, 2.2, 0x515a66, { cast: false, blockLOS: true });
  if (CBZ.corridorKit && CBZ.corridorKit.doorSet) {
    CBZ.corridorKit.doorSet({ axis: "z", a0: 118.9, a1: 121.1, fixed: -14, t: 0.5, h: 2.4, y0: 0.06,
      open: -1, hinge: 0, max: 1.0, build: CBZ.corridorKit.steelLeaf(0x4f5d6b) }).set(1);
  }
  // the hut's roof: a poured slab on its walls with a steel drip fascia
  // (world/roofs.js knows it is roofed and hangs no second lid)
  const hutRoof = addBox(-18, 3.4, 120, 8.4, 0.4, 8.4, 0x44505a, { cast: true });
  if (K) {
    K.skinBox(hutRoof, "concrete", 0x9ea3a8);
    const fas = K.skin("steel", 0x3a4048);
    for (const s of [-1, 1]) {
      stat(new THREE.BoxGeometry(8.5, 0.22, 0.05), fas, -18, 3.45, 120 + s * 4.225, { cast: false });
      stat(new THREE.BoxGeometry(0.05, 0.22, 8.5), fas, -18 + s * 4.225, 3.45, 120, { cast: false });
    }
    /* the hut's yard window, on its north face: tinted glass in a steel
       frame over a concrete sill, the same pane on the inside face. It was a
       glowing blue slab buried in the wall's own thickness. */
    const gl = K.skin("steel", 0x141b22, 0.12), fr = K.skin("steel", 0x39424e), sill = K.skin("concrete", 0xa0a5aa);
    for (const f of [-1, 1]) {
      const zf = f < 0 ? 115.75 - 0.012 : 116.25 + 0.012;
      stat(new THREE.BoxGeometry(1.6, 0.9, 0.02), gl, -18, 1.75, zf, { cast: false });
      for (const s of [-1, 1]) {
        stat(new THREE.BoxGeometry(1.72, 0.06, 0.05), fr, -18, 1.75 + s * 0.48, zf + f * 0.01, { cast: false });
        stat(new THREE.BoxGeometry(0.06, 1.02, 0.05), fr, -18 + s * 0.83, 1.75, zf + f * 0.01, { cast: false });
      }
      stat(new THREE.BoxGeometry(0.04, 0.9, 0.03), fr, -18, 1.75, zf + f * 0.01, { cast: false });
    }
    stat(new THREE.BoxGeometry(1.84, 0.06, 0.16), sill, -18, 1.25, 115.7, { cast: false });
  }
  /* THE TRANSPORT BUS (rebuilt 2026-09-28): the kit's prison bus
     (world/prisonkit.js vehicle: white shell, screened window band, glazed
     door, lamp clusters that are lenses, not glowing blobs) parked nose
     north in a painted bay east of the walkway. It was a navy box with a box
     roof, box wheels and a yellow emissive block for a headlight. The
     cigarette pack at (16, 120) lies beside its west flank. */
  if (K) {
    const bx = 18.2, bz = 119;
    K.vehicle("bus", bx, bz, 0);
    for (const s of [-1, 1]) K.paint(bx + s * 2.0, bz, 0.12, 13.2, 0xe1c744);
    K.paint(bx, bz - 6.6, 4.12, 0.12, 0xe1c744);
  } else addBox(16, 1.5, 120, 2.6, 2.8, 11, 0xe4e6e2, { solid: true });

  // service waste belongs at the workshop, not across circulation: a
  // front-load dumpster with its back to the workshop's east wall, clear of
  // the door lane and of the facade's window (it was a flat green box)
  if (K) K.dumpster(-22.75, 59.8, -Math.PI / 2);
  else addBox(-22.75, 0.7, 59.8, 1.7, 1.3, 2.0, 0x2f6b3a, { solid: true });

  // ---- a few cigarette packs to reward exploring the new wing ----
  if (CBZ.addPack) {
    CBZ.addPack(-37, 76, 6);   // workshop
    CBZ.addPack(31, 64, 5);    // chapel pews
    CBZ.addPack(30, 100, 6);   // infirmary
    CBZ.addPack(-31, 99, 5);   // laundry
    CBZ.addPack(8, 106, 7);    // weights
    CBZ.addPack(16, 120, 8);   // by the transport bus
  }

  // ========================================================================
  //  INSTITUTIONAL TEXTURE  (PRISON_DRESS_V2)
  // ========================================================================
  // The south block had four good ROOMS standing in a very empty yard: 88 x 76
  // metres of apron with a hoop, some weights and nothing that says a
  // government runs this place. What follows is the layer every institution
  // accumulates and no generated one has — paint on the deck, wear at shoulder
  // height, pipework under the wall head, caged light, fire kit, and a chow
  // pad you can actually sit at.
  //
  // GEOMETRY IT IS BUILT AGAINST — measured, not guessed:
  //   perimeter inner faces  x = -43.5 / +43.5, south z = 127.5 (gate gap x +/-4)
  //   central path slab      x[-4.5,4.5], z 52..128
  //   half-court             x[-20.1,-5.1] z[84,98]   bleachers x[-23.5,-21] z[85.2,92.7]
  //   workshop  x[-42,-24] z[58,80]  door E z[66.9,71.1]
  //   chapel    x[ 24, 42] z[58,80]  door W z[66.9,71.1]
  //   infirmary x[ 26, 42] z[88,104] door W z[94,98]
  //   laundry   x[-42,-26] z[88,104] door E z[94,98]
  //   transport bus bay      x[16.2,20.2] z[112.4,125.6]; dumpster x[-23.6,-21.9] z[58.7,60.9]
  //   guard hut x[-22,-14] z[116,124] door E z[118.9,121.1]
  // ROUTES HELD: the 9 m central path is never built on (only painted), every
  // door lane above stays clear by >= 1.2 m, and the exit gap x[-4,4] at
  // z=128 keeps both its width and its approach.
  if (PD) (function institutional() {
    const WX = 43.5, SZ1 = 127.5;                 // perimeter inner faces

    // ---- 1. WAYFINDING PAINT: DELETED (2026-09-27) --------------------------
    // Five coloured trunks (gate yellow, medical green, workshop blue, chapel
    // violet, laundry white) ran down the OUTDOOR yard walkway with chevrons,
    // plus a matching coloured band beside each door. Coloured routing lines
    // are an indoor hospital-corridor device; on an open prison yard they read
    // as a board-game track, and from a phone at eye level they were thick
    // bright bars (owner: "lines on ground are dumb"). The yard is navigated by
    // the doors, the signs over them and the walkway itself.

    // ---- 2. PERIMETER WEAR ------------------------------------------------
    // A 76 m concrete wall with one red trim line on top is a boundary; the
    // same wall with a scuffed hand-height band is somewhere people have been
    // walked past ten thousand times.
    PD.scuff(-WX + 0.04, 1.4, 90, 74, "z", { color: 0x7a828c, h: 0.12 });
    PD.scuff(WX - 0.04, 1.4, 90, 74, "z", { color: 0x7a828c, h: 0.12 });
    PD.band(-WX + 0.04, 0.55, 90, 74, "z", 0x8a929c, { h: 0.5 });     // kerb wash
    PD.band(WX - 0.04, 0.55, 90, 74, "z", 0x8a929c, { h: 0.5 });
    for (const s of [-1, 1]) {                                        // south wall, each side of the gate
      PD.scuff(s * 23.75, 1.4, SZ1 - 0.04, 39.5, "x", { color: 0x7a828c, h: 0.12 });
    }

    // ---- 3. THE ROOMS -----------------------------------------------------
    // One table, four rooms. Each row is the shell rect, the wall the yard
    // sees, and where its door lane is — so nothing below is a hand-typed
    // coordinate that can drift away from the shell it belongs to.
    //   [id, x0,x1,z0,z1, wallTop, doorSide, doorCenter, doorWidth]
    const ROOMS = [
      ["workshop", -42, -24, 58, 80, 6, "E", 69, 4.2],
      ["chapel", 24, 42, 58, 80, 6.5, "W", 69, 4.2],
      ["infirmary", 26, 42, 88, 104, 6, "W", 96, 4.0],
      ["laundry", -42, -26, 88, 104, 6, "E", 96, 4.0],
    ];
    for (const R of ROOMS) {
      const x0 = R[1] + 0.25, x1 = R[2] - 0.25, z0 = R[3] + 0.25, z1 = R[4] - 0.25;  // inner faces
      const h = R[5], side = R[6], dc = R[7], dw = R[8];
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dz = z1 - z0;
      const east = side === "E";
      const wallX = east ? R[2] : R[1];                     // the wall the door is in
      const inX = east ? x1 : x0;                           // its inner face
      const outX = east ? R[2] + 0.25 : R[1] - 0.25;        // its outer (yard) face
      const dirIn = east ? -1 : 1;                          // into the room from that wall

      // A DOORWAY NEEDS A HEAD. roomShell splits its wall floor-to-top for the
      // gap, so every door in this block is a 6 m slot; this box closes it
      // from 3.1 m to the wall top. Over the door, outside, the prison's caged
      // wall lamp (world/cafeteria.js PD.lamp) FLUSH on the head: it is on the
      // lights-out circuit. It was a grey box over a permanently glowing
      // cream box, which at night was a lit block by the yard's flood masts.
      addBox(wallX, (3.1 + h) / 2, dc, 0.5, h - 3.1, dw,
        { workshop: 0x7c8590, chapel: 0xbfb6a4, infirmary: 0xd7dde2, laundry: 0x8a929c }[R[0]], { cast: false });   // the wall's own tone
      addBox(outX + (east ? 0.07 : -0.07), 3.02, dc, 0.14, 0.16, dw + 0.2, 0x5b6470, { cast: false }); // drip nose, tight under the head
      if (PD.lamp) PD.lamp(outX + (east ? 0.06 : -0.06), 3.5, dc, east ? "x+" : "x-");

      // (the dado plank + scuff stripe, and the caged wall lamp, are gone: each
      // room has its finish layer and ceiling fittings now.) A service run
      // under the ceiling, with hangers, in the two working rooms only.
      if (R[0] === "workshop" || R[0] === "laundry") {
        const py = (R[0] === "workshop" ? 5.2 : 4.4) - 0.35;
        PD.pipe(inX + dirIn * 0.45, py, cz, dz - 1.2, "z", 0.09, 0x6f7a86);
        for (const t of [-0.3, 0.3]) PD.hanger(inX + dirIn * 0.45, py, cz + t * dz, 0.35);
      }
    }

    // ---- 4. FIRE KIT ------------------------------------------------------
    // Red is the only colour in this block that is not a warning stripe, so
    // it has to be earned: a cabinet where a hose really would be racked
    // (the workshop, which contains the only open flame in the compound) and
    // extinguishers where a fire would start.
    PD.hoseCab(-24.6, 1.6, 73.2, "x-");                 // workshop, inside the door wall
    PD.extinguisher(-24.55, 1.1, 64.4, "x-");           // workshop, by the forge end
    PD.extinguisher(-26.6, 1.1, 92.6, "x-");            // laundry (dryers)
    PD.extinguisher(26.6, 1.1, 100.4, "x+");            // infirmary

    // ---- 5. THE CHOW PAD --------------------------------------------------
    // Bolted round tables on a poured pad, south-east of the path and clear of
    // the chapel's door lane (which starts at z 66.9). This is where the yard
    // eats when the hall is full, and it is the one place in 6,700 m2 of apron
    // with a reason to stand still. Seats register with city/propuse.js at
    // their real cushion height, so bodies can be sat here with no new code.
    if (K) K.ground(18, 60.6, 9, 6.5, "concrete", { y: 0.028 });
    PD.roundTable(15.6, 59.6, { seatTone: 0x3a6ea5 });
    PD.roundTable(20.4, 59.6, { seatTone: 0x2f6b3a, spin: 1.2 });
    // the bussing point at the pad edge: a 55 gal drum, which is what a yard
    // actually uses (it was a green cylinder with a square lid on it)
    if (K) K.drum(21.8, 62.0, 0x2f5a3a);
    if (CBZ.colliders) CBZ.colliders.push({ minX: 21.5, maxX: 22.1, minZ: 61.7, maxZ: 62.3, y0: 0, y1: 0.9 });

    // ---- 6. THE SALLY PORT ------------------------------------------------
    // The last thing between you and the gate should look like it was built to
    // stop a vehicle, not like two posts and a stick.
    PD.floorLine(0, 112.4, 9, "x", 0xe8e2d2, { w: 0.3, y: 0.05 });            // stop line at the walkway mouth
    // The rules board on the guard hut's yard face — the last words you read.
    // SOUTH of the hut's own doorway (z 118.9..121.1), not across it.
    addBox(-13.70, 2.3, 117.2, 0.08, 1.3, 1.8, 0x6a563c, { cast: false });
    addBox(-13.645, 2.3, 117.2, 0.03, 1.14, 1.64, 0x3f4a3c, { cast: false });
    for (const n of [[2.72, 116.7, 0.42, 0.32], [2.7, 117.7, 0.4, 0.28],
    [2.18, 116.9, 0.38, 0.42]])
      PD.paper(-13.61, n[0], n[1], "x+", n[2], n[3], {});
    // Caged lamps at the gate and the hut. Every plate sits FLUSH on a real
    // face: the hut's east wall face is -13.75 and the pillars' inner faces
    // are +/-6.0, and the hut lamp ducks under its own 3.2-3.6 m roof slab.
    PD.lamp(-13.69, 2.9, 122.4, "x+");
  })();

  /* ---- THE FOUR ROOM DOORWAYS WERE 4 m HOLES (2026-09-28). A raw slot in a
     block wall with a lintel over it, no frame, no door, nothing to say what
     closes it at night. Each now gets what that room would really have, and
     every one of them stays OPEN for the day's traffic (inmates are walked in
     and out of all four on the schedule; nothing here is a collider):
       workshop, laundry  a steel roller shutter, raised: guides on the inner
                          face, the coil hood over the opening, the curtain's
                          last slats and bottom bar showing under the head
       chapel             a pair of panelled oak doors, hooked back square to
                          the wall inside the nave, clear of the pews
       infirmary          a pair of steel-framed glazed doors, hooked back
     All four openings get a steel frame lining the reveal and an angle trim
     on the yard face. ---- */
  if (K && K.stat) (function roomDoorways() {
    const stat = K.stat, steel = K.skin("steel", 0x4a525c, 0.5), galv = K.skin("galv", 0xa9b0b7);
    const roller = K.skin("roller", 0x9aa1a8), rubber = K.skin("steel", 0x1c1e22, 0.8);
    const CK = CBZ.corridorKit;
    const HEAD = 3.1, T = 0.5;
    function lining(wallX, dc, dw) {
      for (const s of [-1, 1]) {
        stat(new THREE.BoxGeometry(T + 0.02, HEAD, 0.04), steel, wallX, HEAD / 2, dc + s * (dw / 2 - 0.02), { cast: false });   // reveal
        for (const f of [-1, 1])
          stat(new THREE.BoxGeometry(0.02, HEAD + 0.08, 0.08), steel, wallX + f * (T / 2 + 0.01), (HEAD + 0.08) / 2, dc + s * (dw / 2 + 0.04), { cast: false });
      }
      stat(new THREE.BoxGeometry(T + 0.02, 0.04, dw), steel, wallX, HEAD - 0.02, dc, { cast: false });                          // head soffit
      for (const f of [-1, 1]) stat(new THREE.BoxGeometry(0.02, 0.08, dw + 0.16), steel, wallX + f * (T / 2 + 0.01), HEAD + 0.04, dc, { cast: false });
    }
    function shutter(wallX, dc, dw, dirIn) {
      const inX = wallX + dirIn * T / 2;
      lining(wallX, dc, dw);
      for (const s of [-1, 1]) {
        stat(new THREE.BoxGeometry(0.1, HEAD + 0.05, 0.1), steel, inX + dirIn * 0.05, (HEAD + 0.05) / 2, dc + s * (dw / 2 + 0.06), { cast: false });   // guide
        stat(new THREE.BoxGeometry(0.06, 0.34, 0.26), steel, inX + dirIn * 0.2, HEAD + 0.27, dc + s * (dw / 2 + 0.13), { cast: false });              // bracket
      }
      stat(new THREE.BoxGeometry(0.44, 0.52, dw + 0.34), steel, inX + dirIn * 0.24, HEAD + 0.29, dc, { cast: false });                            // coil hood
      stat(new THREE.BoxGeometry(0.03, 0.26, dw + 0.06), roller, inX + dirIn * 0.05, HEAD - 0.13, dc, { cast: false, uv: 1 });                   // last slats
      stat(new THREE.BoxGeometry(0.07, 0.06, dw + 0.06), galv, inX + dirIn * 0.05, HEAD - 0.29, dc, { cast: false });                             // bottom bar
      stat(new THREE.BoxGeometry(0.05, 0.02, dw + 0.02), rubber, inX + dirIn * 0.05, HEAD - 0.33, dc, { cast: false });                           // seal
      stat(new THREE.BoxGeometry(0.1, 0.05, 0.16), galv, inX + dirIn * 0.1, HEAD - 0.29, dc, { cast: false });                                    // pull handle
      // the hand-chain drive on one side: a gearbox on the guide, the loop to hand height
      const cz = dc + dw / 2 + 0.2;
      stat(new THREE.BoxGeometry(0.16, 0.2, 0.14), steel, inX + dirIn * 0.14, HEAD + 0.05, cz, { cast: false });
      for (const o of [-0.03, 0.03]) stat(new THREE.CylinderGeometry(0.006, 0.006, HEAD - 1.05, 5), galv, inX + dirIn * 0.14, (HEAD + 1.05) / 2, cz + o, { cast: false });
    }
    function woodPair(g, w, h, dir) {
      if (!PD || !PD.Paint) return null;
      const P = new PD.Paint(), OAK = 0x7a5530, OAKD = 0x5e3f22, IRON = 0x2a2d31, xs = function (u) { return dir * u; };
      P.box(xs(w / 2), h / 2, 0, w, h, 0.05, OAKD);
      for (let i = 0; i < 6; i++) P.box(xs(0.02 + (i + 0.5) * (w - 0.04) / 6), h / 2, 0, (w - 0.04) / 6 - 0.012, h - 0.02, 0.058, OAK);   // boards
      for (const f of [-1, 1]) for (const hy of [0.35, h / 2, h - 0.35]) P.box(xs(w * 0.36), hy, f * 0.032, w * 0.66, 0.06, 0.008, IRON);   // strap hinges
      for (const f of [-1, 1]) P.add(new THREE.TorusGeometry(0.06, 0.01, 6, 14).translate(xs(w - 0.16), 1.05, f * 0.045), IRON);           // ring pull
      const geo = P.geometry();
      if (!geo) return null;
      const m = new THREE.Mesh(geo, PD.vcMat()); m.receiveShadow = true; g.add(m);
      return m;
    }
    function heldPair(wallX, dc, dw, open, build) {
      if (!CK || !CK.doorSet) { lining(wallX, dc, dw); return; }
      const set = CK.doorSet({ axis: "z", a0: dc - dw / 2, a1: dc + dw / 2, fixed: wallX, t: T, h: HEAD, y0: 0.06,
        open: open, hinge: 0, build: build, frame: 0x4a525c });
      set.set(1);                 // hooked back, square to the wall
    }
    shutter(-24, 69, 4.2, -1);    // workshop (east wall, room to the west)
    shutter(-26, 96, 4.0, -1);    // laundry
    // chapel / infirmary: west wall, room to the east = world +x = local -z
    heldPair(24, 69, 4.2, -1, woodPair);
    heldPair(26, 96, 4.0, -1, CK && CK.glassLeaf ? CK.glassLeaf : woodPair);
  })();

  // The facade pass (world/building_dress.js) dresses whatever registers here.
  if (PD && PD.shell) {
    // `face` = the elevation the yard actually looks at. `quiet` = do not punch
    // windows: the chapel already has authored stained-glass slits, and a
    // barred window is the wrong idea for a nave.
    PD.shell({ id: "workshop", x0: -42, x1: -24, z0: 58, z1: 80, h: 6, door: "E", dc: 69, dw: 4.2, tone: 0x7c8590, face: "E" });
    PD.shell({ id: "chapel", x0: 24, x1: 42, z0: 58, z1: 80, h: 6.5, door: "W", dc: 69, dw: 4.2, tone: 0xbfb6a4, face: "W", quiet: true });
    PD.shell({ id: "infirmary", x0: 26, x1: 42, z0: 88, z1: 104, h: 6, door: "W", dc: 96, dw: 4.0, tone: 0xd7dde2, face: "W" });
    PD.shell({ id: "laundry", x0: -42, x1: -26, z0: 88, z1: 104, h: 6, door: "E", dc: 96, dw: 4.0, tone: 0x8a929c, face: "E" });
    PD.shell({ id: "south-dorm", x0: -42, x1: -24, z0: 106, z1: 124, h: 6, door: "N", dc: -33, dw: 3.4, tone: 0x76818c, face: "N", quiet: true });
  }
})();
