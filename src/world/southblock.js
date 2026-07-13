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

  // ---- ground: a worn asphalt apron + the walkway leading to the gate ----
  function slab(x, z, w, d, a, b, rx, rz) {
    const tex = CBZ.checkerTex(a, b, 2); tex.repeat.set(rx, rz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.receiveShadow = true; scene.add(m);
    return m;
  }
  slab(0, 90, 88, 76, "#586069", "#4f5760", 14, 12);          // lower-yard asphalt
  slab(0, 90, 9, 76, CBZ.COL.ASPHALT_A, CBZ.COL.ASPHALT_B, 2, 16); // central path to the gate

  // a basketball half-court painted into the apron
  (function court() {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(16, 22),
      new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    c.rotation.x = -Math.PI / 2; c.position.set(-11, 0.02, 96); scene.add(c);
    const line = (x, z, w, d) => addBox(x, 0.04, z, w, 0.02, d, 0xe7e2d2, { cast: false });
    line(-11, 85.2, 16, 0.16); line(-11, 96, 5.0, 5.0); line(-3.2, 96, 0.16, 22);
  })();

  // running-track oval outline around the infield (just painted lines)
  (function track() {
    const seg = 26, R = 30;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * (R * 0.9), z = 94 + Math.sin(a) * (R * 0.62);
      addBox(x, 0.03, z, 0.7, 0.02, 0.7, 0xe2c049, { cast: false });
    }
  })();

  // ---- floodlight poles ringing the lower yard ----
  function floodPole(x, z) {
    addBox(x, 4.0, z, 0.4, 8, 0.4, 0x3c424d, {});
    addBox(x, 8.1, z, 1.6, 0.4, 0.7, 0x2a2f38, { cast: false });
    addBox(x, 7.95, z + 0.3, 1.5, 0.3, 0.18, 0xfff1a8, { emissive: 0xffe066, ei: 0.9, cast: false });
  }
  [[-20, 74], [20, 74], [-20, 112], [20, 112]].forEach((p) => floodPole(p[0], p[1]));

  // ============================================================
  //  WORKSHOP (south-west) — welding bay
  // ============================================================
  roomShell({ x0: -42, x1: -24, z0: 58, z1: 80, h: 6, wall: 0x7c8590, floor: 0x6a6f78, door: { side: "E", center: 69, width: 4.2 } });
  addBox(-24, 5.4, 69, 0.2, 0.9, 4.0, 0xc85c00, { cast: false }); // sign band
  // workbenches with vices + scattered parts
  function bench2(x, z) {
    addBox(x, 0.8, z, 3.2, 0.18, 1.2, 0x8a939d, {});                 // top
    addBox(x - 1.4, 0.4, z, 0.2, 0.8, 1.0, 0x5b6470, { cast: false });
    addBox(x + 1.4, 0.4, z, 0.2, 0.8, 1.0, 0x5b6470, { cast: false });
    addBox(x + 1.0, 1.0, z, 0.4, 0.3, 0.4, 0x2a2f38, { cast: false }); // vice
    addBox(x - 0.6, 0.98, z, 0.7, 0.12, 0.5, 0xb07a3c, { cast: false }); // wood block
  }
  bench2(-37, 62); bench2(-37, 76);
  // a glowing forge + sparks
  addBox(-40, 0.9, 69, 1.6, 1.8, 2.0, 0x2a2f38, {});
  addBox(-40, 1.2, 70.2, 1.2, 0.7, 0.3, 0xff6a1a, { emissive: 0xc83000, ei: 0.9, cast: false });
  // stacked steel stock + a parts crate
  for (let i = 0; i < 4; i++) addBox(-27 + (i % 2) * 0.4, 0.3 + Math.floor(i / 2) * 0.34, 75 + (i % 2) * 0.5, 2.6, 0.28, 0.28, 0x6b7480, { cast: false });
  addBox(-28, 0.5, 62, 1.6, 1.0, 1.6, CBZ.COL.CRATE, { solid: true });

  // ============================================================
  //  CHAPEL (south-east) — the quiet wing
  // ============================================================
  roomShell({ x0: 24, x1: 42, z0: 58, z1: 80, h: 6.5, wall: 0xbfb6a4, floor: 0x6e5a3c, door: { side: "W", center: 69, width: 4.2 } });
  addBox(42, 5.8, 69, 0.2, 0.9, 4.0, 0x6d5a8f, { cast: false }); // sign band
  // altar + a tall cross on the far (east) wall
  addBox(40, 0.6, 69, 1.4, 1.2, 2.4, 0xece3d1, {});
  addBox(41, 2.6, 69, 0.22, 2.4, 0.22, 0xe8d44f, { emissive: 0x6a5a10, ei: 0.4, cast: false });
  addBox(41, 3.0, 69, 0.22, 0.22, 1.1, 0xe8d44f, { emissive: 0x6a5a10, ei: 0.4, cast: false });
  // rows of pews
  function pew(z) {
    addBox(31, 0.45, z, 7.2, 0.16, 0.5, 0x9a6a2d, {});
    addBox(31, 0.8, z - 0.28, 7.2, 0.5, 0.12, 0x8a5e2b, { cast: false });
  }
  [62, 64.4, 66.8, 71.2, 73.6, 76]. forEach(pew);
  // narrow stained-glass slits on the east wall
  for (let i = -1; i <= 1; i++) addBox(41.78, 4.0, 69 + i * 5, 0.06, 2.0, 1.0, [0x6fb0ff, 0xff8e6f, 0x8dff9f][i + 1], { emissive: [0x2a4a7a, 0x7a3a20, 0x2a6a3a][i + 1], ei: 0.6, cast: false });

  // ============================================================
  //  INFIRMARY (east, lower) — beds + screens
  // ============================================================
  roomShell({ x0: 26, x1: 42, z0: 88, z1: 104, h: 6, wall: 0xd7dde2, floor: 0xb9c0c8, door: { side: "W", center: 96, width: 4.0 } });
  addBox(42, 5.4, 96, 0.2, 0.9, 3.4, 0x2f9e6a, { cast: false }); // green cross band
  addBox(42.0, 5.4, 96, 0.22, 0.6, 0.2, 0xffffff, { emissive: 0xbfeada, ei: 0.5, cast: false });
  function bed(x, z) {
    addBox(x, 0.45, z, 1.5, 0.2, 2.6, 0x9aa0a8, {});               // frame
    addBox(x, 0.62, z, 1.3, 0.14, 2.4, 0xeef2f5, { cast: false }); // sheet
    addBox(x, 0.78, z - 0.9, 1.1, 0.16, 0.5, 0xdfe6ec, { cast: false }); // pillow
    addBox(x - 0.95, 0.7, z, 0.08, 1.0, 2.4, 0xcfd6dc, { cast: false }); // privacy screen
  }
  bed(30, 92); bed(30, 100); bed(38, 92); bed(38, 100);
  // a supply cabinet + a glowing monitor
  addBox(34, 0.9, 90, 1.2, 1.8, 0.7, 0xc7ccd2, {});
  addBox(34, 1.6, 90.4, 0.6, 0.4, 0.06, 0x6fb7ff, { emissive: 0x2a6ea5, ei: 0.7, cast: false });

  // ============================================================
  //  LAUNDRY (west, lower) — steam, machines & carts
  // ============================================================
  roomShell({ x0: -42, x1: -26, z0: 88, z1: 104, h: 6, wall: 0x8a929c, floor: 0x7a828c, door: { side: "E", center: 96, width: 4.0 } });
  addBox(-26, 5.4, 96, 0.2, 0.9, 3.4, 0x3a6ea5, { cast: false });
  // a bank of industrial washers along the west wall
  for (let i = 0; i < 4; i++) {
    const z = 90 + i * 3.5;
    addBox(-40, 0.9, z, 1.8, 1.8, 1.8, 0xbfc6cd, {});
    addBox(-39.1, 1.2, z, 0.1, 0.9, 0.9, 0x223047, { cast: false });          // door
    addBox(-39.05, 1.2, z, 0.06, 0.7, 0.7, 0x6fb7ff, { emissive: 0x2a5e85, ei: 0.4, cast: false }); // glass glow
  }
  // rolling laundry carts (canvas bins on a frame)
  function cart(x, z) {
    addBox(x, 0.7, z, 1.2, 0.9, 1.4, 0xe2e2e2, {});
    addBox(x, 0.18, z, 1.3, 0.12, 1.5, 0x3c424d, { cast: false });
  }
  cart(-31, 92); cart(-29.5, 99);

  // ============================================================
  //  LOWER-YARD FITTINGS — hoop, weights, pull-up rig, bleachers
  // ============================================================
  // basketball hoop on the painted court
  addBox(-11, 2.0, 84.4, 0.2, 4.0, 0.2, 0x6b7480, {});
  addBox(-11, 3.6, 85.0, 1.6, 0.12, 0.9, 0xff7a1a, { cast: false });
  addBox(-11, 3.95, 84.6, 1.4, 0.7, 0.08, 0xffffff, { cast: false });
  // weight benches + plates
  function weightBench(x, z) {
    addBox(x, 0.45, z, 0.7, 0.16, 2.2, 0x3a3f47, { solid: true });
    addBox(x, 1.1, z - 1.3, 1.9, 0.12, 0.12, 0x2a2f38, { cast: false }); // bar
    addBox(x - 0.85, 1.1, z - 1.3, 0.16, 0.5, 0.5, 0x1a1a1a, { cast: false });
    addBox(x + 0.85, 1.1, z - 1.3, 0.16, 0.5, 0.5, 0x1a1a1a, { cast: false });
  }
  weightBench(8, 100); weightBench(11, 106);
  // pull-up / dip rig
  addBox(4, 1.4, 110, 0.16, 2.8, 0.16, 0x515a66, {});
  addBox(13, 1.4, 110, 0.16, 2.8, 0.16, 0x515a66, {});
  addBox(8.5, 2.7, 110, 9.0, 0.16, 0.16, 0x6b7480, { cast: false });
  // tiered bleachers along the west edge of the infield
  for (let i = 0; i < 3; i++) addBox(-17, 0.4 + i * 0.5, 96, 2.2, 0.4, 14 - i * 2, 0x6e7682, { solid: i === 0 });

  // ============================================================
  //  SALLY PORT — checkpoint flanking the gate, guard hut, transport
  // ============================================================
  // checkpoint pillars + boom-gate look either side of the central path
  addBox(-6.5, 1.6, 118, 1.0, 3.2, 1.0, 0x515a66, { solid: true });
  addBox(6.5, 1.6, 118, 1.0, 3.2, 1.0, 0x515a66, { solid: true });
  addBox(0, 3.4, 118, 14, 0.5, 0.5, 0xc94d3a, { cast: false }); // overhead beam
  // guard hut (small roofed booth)
  roomShell({ x0: -22, x1: -14, z0: 116, z1: 124, h: 3.2, wall: 0x515a66, floor: 0x3c424d, door: { side: "E", center: 120, width: 2.2 } });
  addBox(-18, 3.4, 120, 8.4, 0.4, 8.4, 0x44505a, { cast: false }); // roof
  addBox(-18, 1.7, 116.1, 3.0, 0.9, 0.08, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.4, cast: false });
  // a parked transport bus (big prop) on the east side
  (function bus() {
    const bx = 16, bz = 120;
    addBox(bx, 1.5, bz, 4.6, 2.2, 9.0, 0x2b3a67, { solid: true });   // body
    addBox(bx, 2.9, bz, 4.2, 0.6, 8.6, 0x223057, { cast: false });   // roof
    for (let i = -3; i <= 3; i++) addBox(bx - 2.32, 1.8, bz + i * 1.2, 0.06, 0.7, 0.8, 0x0a0d18, { cast: false }); // windows
    addBox(bx, 0.45, bz - 3.2, 1.0, 0.9, 0.5, 0x14181f, { cast: false }); // front wheel
    addBox(bx, 0.45, bz + 3.2, 1.0, 0.9, 0.5, 0x14181f, { cast: false }); // rear wheel
    addBox(bx - 2.34, 1.4, bz + 4.2, 0.06, 0.5, 0.3, 0xffd451, { emissive: 0x6a5510, ei: 0.5, cast: false }); // headlight
  })();
  // jersey barriers funnelling toward the gate
  function barrier(x, z) { addBox(x, 0.55, z, 3.0, 1.1, 0.8, 0xd8d2c4, { solid: true }); addBox(x, 0.16, z, 3.4, 0.2, 1.1, 0xb9b3a4, { cast: false }); }
  barrier(-10, 124); barrier(10, 124);

  // ---- water tower in the south-west corner (a tall landmark) ----
  (function waterTower() {
    const x = -38, z = 116;
    for (const dx of [-1.4, 1.4]) for (const dz of [-1.4, 1.4]) addBox(x + dx, 4.0, z + dz, 0.3, 8.0, 0.3, 0x6b7480, { cast: false });
    addBox(x, 9.4, z, 5.2, 3.0, 5.2, 0x9aa3ad, {});
    addBox(x, 11.0, z, 4.0, 1.4, 4.0, 0x7d8794, { cast: false }); // conical-ish top
    addBox(x, 9.4, z + 2.65, 3.0, 1.0, 0.1, 0xc94d3a, { cast: false }); // painted band
  })();

  // ---- scatter: dumpsters, barrels, crates, cones across the apron ----
  function dumpster(x, z) {
    addBox(x, 0.7, z, 3.0, 1.3, 1.7, 0x2f6b3a, { solid: true });
    addBox(x, 1.45, z, 3.1, 0.2, 1.8, 0x274f2c, { cast: false });
  }
  function barrel(x, z, c) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12), CBZ.mat(c || 0xc94d3a));
    b.position.set(x, 0.6, z); b.castShadow = true; scene.add(b);
  }
  dumpster(-21, 64); dumpster(22, 110);
  barrel(20, 84, 0x3b7bff); barrel(21, 85.4, 0xc94d3a); barrel(-21, 104, 0x4aa14a);
  addBox(-15, 0.5, 78, 1.4, 1.0, 1.4, CBZ.COL.CRATE, { solid: true });
  addBox(14, 0.5, 76, 1.4, 1.0, 1.4, CBZ.COL.CRATE, { solid: true });
  addBox(14, 1.5, 76, 1.2, 1.0, 1.2, CBZ.COL.CRATE_D, { solid: true });

  // ---- a few cigarette packs to reward exploring the new wing ----
  if (CBZ.addPack) {
    CBZ.addPack(-37, 76, 6);   // workshop
    CBZ.addPack(31, 64, 5);    // chapel pews
    CBZ.addPack(30, 100, 6);   // infirmary
    CBZ.addPack(-31, 99, 5);   // laundry
    CBZ.addPack(8, 106, 7);    // weights
    CBZ.addPack(16, 120, 8);   // by the transport bus
  }
})();
