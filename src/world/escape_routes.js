/* ============================================================
   world/escape_routes.js - checkpoint dressing + alternate routes.

   The keycard still matters because it opens staff checkpoints, but
   the block now has maintenance crawls, ceiling hatches, drainage, and
   a culvert so the map plays like a place with systems instead of a
   single locked hallway.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene || !CBZ.addBox) return;
  const THREE = window.THREE;
  const { addBox, scene } = CBZ;

  CBZ.vents = CBZ.vents || [];
  CBZ.altExitZones = CBZ.altExitZones || [];

  function sign(text, x, y, z, w, h, ry, fg, bg) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = bg || "#202833";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,.38)";
    g.lineWidth = 10;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = fg || "#ffd451";
    g.font = "700 48px Fredoka, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry || 0;
    scene.add(mesh);
    return mesh;
  }

  function floorHatch(x, z, name, accent) {
    addBox(x, 0.055, z, 1.75, 0.11, 1.75, 0x26313a, { cast: false });
    addBox(x, 0.13, z, 1.35, 0.08, 1.35, accent || 0x515a66, { cast: false });
    for (let i = -2; i <= 2; i++) {
      addBox(x + i * 0.26, 0.2, z, 0.08, 0.08, 1.25, 0x11171c, { cast: false });
      addBox(x, 0.22, z + i * 0.26, 1.25, 0.05, 0.06, 0x11171c, { cast: false });
    }
    const vent = { x, z, y: 0.12, name, dest: null, route: true };
    CBZ.vents.push(vent);
    return vent;
  }

  function pipe(x, y, z, r, len, axis, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, len, 18, 1, true),
      CBZ.mat(color || 0x4c5864, { emissive: 0x080a0c, ei: 0.35 })
    );
    mesh.position.set(x, y, z);
    if (axis === "x") mesh.rotation.z = Math.PI / 2;
    if (axis === "z") mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  // ---- ceiling structure so the cell block reads like an enclosed facility ----
  for (let z = -41; z <= -12; z += 5.8) addBox(0, 8.9, z, 31.4, 0.16, 0.22, 0x515a66, { cast: false });
  for (let x = -12; x <= 12; x += 6) addBox(x, 8.78, -26, 0.16, 0.14, 35, 0x3f4852, { cast: false });
  pipe(-14.9, 7.55, -28, 0.16, 27, "z", 0x47515c);
  pipe(14.9, 7.35, -26, 0.12, 24, "z", 0x5a6570);

  // overhead catwalk and cable tray: visual route language above the cells.
  addBox(0, 6.45, -17, 24, 0.18, 1.65, 0x333c46, { cast: false });
  addBox(0, 7.15, -16.1, 24, 0.14, 0.14, 0x8b95a1, { cast: false });
  addBox(0, 7.15, -17.9, 24, 0.14, 0.14, 0x8b95a1, { cast: false });
  for (let x = -11; x <= 11; x += 2.2) {
    addBox(x, 6.82, -16.1, 0.08, 0.72, 0.08, 0x6b7480, { cast: false });
    addBox(x, 6.82, -17.9, 0.08, 0.72, 0.08, 0x6b7480, { cast: false });
  }

  // ---- make the red door read as a checkpoint, not a random common-room lock ----
  sign("STAFF CHECKPOINT", 0, 7.35, -7.45, 5.4, 1.05, 0, "#ffd451", "#3a1f1a");
  addBox(-3.2, 1.15, -10.5, 0.18, 2.3, 3.8, 0x2a2f38, { cast: false });
  addBox(3.2, 1.15, -10.5, 0.18, 2.3, 3.8, 0x2a2f38, { cast: false });
  addBox(-1.5, 1.0, -10.6, 0.18, 2.0, 0.18, 0x4f5663, { cast: false });
  addBox(1.5, 1.0, -10.6, 0.18, 2.0, 0.18, 0x4f5663, { cast: false });
  addBox(-2.45, 1.7, -9.35, 0.38, 2.4, 0.42, 0x222831, { cast: false });
  addBox(2.45, 1.7, -9.35, 0.38, 2.4, 0.42, 0x222831, { cast: false });
  addBox(-2.45, 2.25, -9.08, 0.18, 0.18, 0.08, 0xff3b3b, { emissive: 0xff0000, ei: 1.0, cast: false });
  addBox(2.45, 2.25, -9.08, 0.18, 0.18, 0.08, 0xffd451, { emissive: 0x7a5100, ei: 0.8, cast: false });

  // ---- route 1: cell utility crawl to the west drainage ditch ----
  const cellCrawl = floorHatch(-12.2, -38.2, "Cell Utility Crawl", 0x6b7480);
  const yardDrainIn = floorHatch(-25.4, 10.5, "Yard Drainage Ditch", 0x4f6d75);
  cellCrawl.dest = yardDrainIn;
  yardDrainIn.dest = cellCrawl;

  // ---- route 2: drainage ditch to an outer culvert beyond the FAR south
  // wall (a long maintenance run that spits you out past the new gate) ----
  const SZ = (CBZ.WORLD && CBZ.WORLD.southBlock.z1) || 52;
  const yardCulvert = floorHatch(-25.2, 18.2, "Perimeter Culvert", 0x4f6d75);
  const outerCulvert = floorHatch(-9, SZ + 3, "Outer Culvert Mouth", 0x39ff88);
  yardCulvert.dest = outerCulvert;
  outerCulvert.dest = yardCulvert;
  CBZ.altExitZones.push({ x: -9, z: SZ + 3, r: 3.4 });

  // Give the ditch a readable path and some stealth cover.
  addBox(-25.3, 0.035, 14.4, 6.3, 0.07, 14.8, 0x3f4c54, { cast: false });
  addBox(-28.4, 0.22, 14.4, 0.32, 0.45, 14.8, 0x2d373f, { cast: false });
  addBox(-22.2, 0.22, 14.4, 0.32, 0.45, 14.8, 0x2d373f, { cast: false });
  pipe(-25.3, 0.72, 24.3, 0.42, 5.0, "z", 0x3f4852);
  pipe(-9, 0.9, SZ + 1.3, 0.62, 3.4, "z", 0x1b242b);
  sign("CULVERT", -9, 2.3, SZ + 0.2, 2.6, 0.7, 0, "#39ff88", "#17211c");

  // ---- route 3: a ceiling service hatch that bypasses the checkpoint ----
  const ceilingCell = floorHatch(11.6, -36.4, "Ceiling Service Hatch", 0x8b95a1);
  const checkpointDrop = floorHatch(12.4, -5.4, "Checkpoint Ceiling Drop", 0x8b95a1);
  ceilingCell.dest = checkpointDrop;
  checkpointDrop.dest = ceilingCell;
  addBox(11.6, 6.7, -36.4, 2.2, 0.18, 2.2, 0x59636f, { cast: false });
  addBox(12.4, 6.65, -5.4, 2.2, 0.18, 2.2, 0x59636f, { cast: false });
  pipe(12.0, 7.2, -20.5, 0.14, 30, "z", 0x717c86);

  // ---- route 4: cafeteria grease duct into the same ditch network ----
  const kitchenDuct = floorHatch(-27.1, 19.2, "Kitchen Grease Duct", 0x9a6a2d);
  const ditchService = floorHatch(-25.5, 25.3, "Drain Service Grate", 0x4f6d75);
  kitchenDuct.dest = ditchService;
  ditchService.dest = kitchenDuct;
  pipe(-27.8, 2.6, 20.2, 0.22, 5.4, "z", 0x6f604e);
  sign("MAINT", -28.7, 3.5, 19.2, 1.5, 0.55, Math.PI / 2, "#ffd451", "#3b3329");

  // Extra yard detail that makes routes legible from the camera.
  for (let z = 5; z <= 47; z += 7) {
    addBox(-29.45, 5.2, z, 0.12, 0.12, 3.3, 0x66717c, { cast: false });
    addBox(29.45, 5.2, z + 2.5, 0.12, 0.12, 3.0, 0x66717c, { cast: false });
  }
  pipe(0, 9.8, 22, 0.10, 48, "z", 0x5b6470);
})();
