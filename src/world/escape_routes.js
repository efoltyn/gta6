/* ============================================================
   world/escape_routes.js - cell-block services + alternate routes.

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
  const { addBox } = CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;

  CBZ.vents = CBZ.vents || [];
  CBZ.altExitZones = CBZ.altExitZones || [];

  // PRISON_PROP_USE_V1 — canonical declaration + doctrine: world/southblock.js.
  // Two things in this file failed the "usable or gone" test and one passed it;
  // the reasoning for all three is written at the site.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_PROP_USE_V1 == null) CBZ.CONFIG.PRISON_PROP_USE_V1 = true;

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

  /* opts.grate: the bars are a real, cuttable grate (systems/escapeplan.js
     owns the cut). They are flagged dynamic so core/batch.js never bakes them
     into a static merge, which would leave a cut grate still drawn shut. */
  /* A FLOOR HATCH IS FLUSH WITH THE FLOOR. It was a 22 cm stack — an 11 cm
     curb, a plate on it and a grid of bars standing on the plate — which read
     as a crate lid lying on the concrete. Now a steel curb frame 3 cm proud,
     the plate inside it and the bars as a grating in the plate's own plane.
     `opts.size` scales it (a hatch inside a cell is not a yard culvert);
     `opts.floor` is the surface it is set into (the ditch slab is 7 cm). */
  function floorHatch(x, z, name, accent, opts) {
    const k = (opts && opts.size ? opts.size : 1.75) / 1.75, f = (opts && opts.floor) || 0;
    addBox(x, f + 0.015, z, 1.75 * k, 0.03, 1.75 * k, 0x26313a, { cast: false });
    const plate = addBox(x, f + 0.035, z, 1.45 * k, 0.012, 1.45 * k, accent || 0x515a66, { cast: false });
    const bars = [];
    for (let i = -2; i <= 2; i++) {
      bars.push(addBox(x + i * 0.26 * k, f + 0.045, z, 0.05 * k, 0.012, 1.3 * k, 0x11171c, { cast: false }));
      bars.push(addBox(x, f + 0.047, z + i * 0.26 * k, 1.3 * k, 0.012, 0.04 * k, 0x11171c, { cast: false }));
    }
    const vent = { x, z, y: 0.12, name, dest: null, route: true };
    if (opts && opts.grate) {
      for (const b of bars) if (b) b.userData.dynamic = true;
      if (plate) plate.userData.dynamic = true;
      // the open shaft under a cut grate: black, a hair above the plate
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * k, 1.2 * k), new THREE.MeshBasicMaterial({ color: 0x050607 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, f + 0.043, z);
      hole.visible = false;
      hole.userData.dynamic = true;
      scene.add(hole);
      vent.grate = {
        cut: false,
        set: function (cut) {
          this.cut = !!cut;
          for (let i = 0; i < bars.length; i++) {
            // a cut grate keeps its two outer rails: the frame, not the bars
            const edge = i === 0 || i === 1 || i === bars.length - 1 || i === bars.length - 2;
            if (bars[i]) bars[i].visible = !cut || edge;
          }
          if (plate) plate.visible = !cut;
          hole.visible = !!cut;
        },
      };
    }
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

  /* THE CELL HOUSE ROOF IS world/cellblock.js's. This file drew a SECOND
     purlin grid under the same 9 m lid (the same five x-lines, 12 cm apart
     from cellblock's own purlins, fighting them) plus a 24 m "catwalk and
     cable tray" slab at 6.45 m that nobody could reach, whose ends ran 30 cm
     into the upper-tier cells. Both deleted: one roof, built once.

     The service pipes stay, but where pipes go: along the side walls in the
     bay between the truss chords (8.15..8.80), clear of every upper cell.
     They were at 7.2-7.55 m, i.e. INSIDE the east and west upper cells, run
     through their partitions and their roof slabs. */
  pipe(-15.28, 8.45, -28, 0.14, 27, "z", 0x47515c);
  pipe(15.30, 8.45, -26, 0.12, 24, "z", 0x5a6570);
  pipe(14.72, 8.45, -21.9, 0.12, 27.2, "z", 0x717c86);
  for (let z = -40; z <= -13; z += 3) for (const x of [-15.28, 15.3])       // wall brackets
    addBox(x + (x < 0 ? -0.12 : 0.12), 8.45, z, 0.18, 0.05, 0.05, 0x3a4048, { cast: false });

  // The housing gate already owns its jambs, reader, signal and moving leaf.
  // The old "checkpoint dressing" duplicated all of that with freestanding
  // rails, posts and two fake reader pylons in the clear route. Keep one
  // literal, wall-mounted identifier; circulation in front of it stays empty.
  sign("HOUSING UNIT A", 0, 4.30, -8.38, 4.6, 0.78, Math.PI, "#e8edf2", "#202833");

  // ---- route 1: cell utility crawl to the west drainage ditch ----
  // Inside A-1 on purpose (cellblock.js header): a way out through your own
  // floor. At (-12.2, -38.2) and 1.75 m square it straddled the cell's barred
  // front, half in the cell and half in the aisle under the bars; a 0.9 m
  // access plate between the bunk's foot and the door sits wholly inside.
  const cellCrawl = floorHatch(-12.2, -39.6, "Cell Utility Crawl", 0x6b7480, { size: 0.9 });
  const yardDrainIn = floorHatch(-25.4, 10.5, "Yard Drainage Ditch", 0x4f6d75, { floor: 0.07 });
  cellCrawl.dest = yardDrainIn;
  yardDrainIn.dest = cellCrawl;

  // ---- route 2: drainage ditch to an outer culvert beyond the FAR south
  // wall (a long maintenance run that spits you out past the new gate) ----
  const SZ = (CBZ.WORLD && CBZ.WORLD.southBlock.z1) || 52;
  // THE CULVERT IS A PLAN, NOT A DOOR (systems/escapeplan.js). Its yard
  // grate is welded: a hacksaw blade and a few unseen seconds cut it, and the
  // crawl only goes when nobody is watching the ditch. The mouth outside the
  // wall is where the route is won, and escapeplan.js checks the grate was
  // really cut before it counts.
  const yardCulvert = floorHatch(-25.2, 18.2, "Perimeter Culvert", 0x4f6d75, { grate: true, floor: 0.07 });
  const outerCulvert = floorHatch(-9, SZ + 3, "Outer Culvert Mouth", 0x39ff88);
  yardCulvert.dest = outerCulvert;
  yardCulvert.culvert = true;
  outerCulvert.dest = yardCulvert;
  outerCulvert.culvertMouth = true;
  CBZ.culvertGrate = yardCulvert;
  CBZ.altExitZones.push({ x: -9, z: SZ + 3, r: 3.4, name: "culvert" });

  // (2026-09-27) The dark 6.3 x 14.8 m "ditch path" slab and its two 45 cm
  // kerbs ran straight through the middle of the MESS HALL floor — a drainage
  // ditch across a dining room. Deleted: the hatches are the route.
  pipe(-25.3, 0.72, 24.3, 0.42, 5.0, "z", 0x3f4852);
  pipe(-9, 0.9, SZ + 1.3, 0.62, 3.4, "z", 0x1b242b);
  sign("CULVERT", -9, 2.3, SZ + 0.2, 2.6, 0.7, 0, "#39ff88", "#17211c");

  // ---- route 3: a ceiling service hatch that bypasses the checkpoint ----
  const ceilingCell = floorHatch(11.6, -36.4, "Ceiling Service Hatch", 0x8b95a1);
  const checkpointDrop = floorHatch(12.4, -5.4, "Checkpoint Ceiling Drop", 0x8b95a1);
  ceilingCell.dest = checkpointDrop;
  checkpointDrop.dest = ceilingCell;
  // THE TWO CEILING PATCHES ARE GONE (PRISON_PROP_USE_V1). Route 3's two ends
  // are drawn by floorHatch() on the line above: a 1.75 m grated hatch ON THE
  // FLOOR, flush, with the CBZ.vents record — the thing the player
  // actually crawls into — registered at y 0.12. These two boxes were 2.2 x
  // 0.18 x 2.2 grey squares hung 6.5 m ABOVE those hatches, saying "ceiling"
  // because the route is named "Ceiling Service Hatch", with nothing at that
  // height to enter and no relationship to the grate you use. 0.871 m3 each:
  // the single largest dead prop in the north yard and the second largest in
  // the cell house. A grey square in the air is the definition of the thing
  // this pass deletes.

  // ---- route 4: cafeteria grease duct into the same ditch network ----
  const kitchenDuct = floorHatch(-27.1, 19.2, "Kitchen Grease Duct", 0x9a6a2d, { floor: 0.07 });
  const ditchService = floorHatch(-25.5, 25.3, "Drain Service Grate", 0x4f6d75);
  kitchenDuct.dest = ditchService;
  ditchService.dest = kitchenDuct;
  pipe(-27.8, 2.6, 20.2, 0.22, 5.4, "z", 0x6f604e);
  sign("MAINT", -28.7, 3.5, 19.2, 1.5, 0.55, Math.PI / 2, "#ffd451", "#3b3329");

  // "Extra yard detail that makes routes legible from the camera" — DELETED
  // (PRISON_PROP_USE_V1). Fourteen 3.3 m sticks, 12 cm square, bolted 5.2 m up
  // the two yard perimeter walls with 3.7 m of nothing between each one. They
  // make no route legible: every route in this file is a hatch in the floor or
  // a painted ditch, both of them at ankle height, and a dashed line of stubs
  // halfway up a 6 m wall is not a conduit run — a conduit run is continuous.
  // Nothing reaches them, nothing reads them, nothing is lit by them.
  // (The 48 m, 10 cm "pipe" hung 9.8 m over the middle of the north yard is
  // GONE. It touched no wall and no roof: from the ground it was a grey line
  // drawn diagonally across the sky, and the owner saw exactly that.)
})();
