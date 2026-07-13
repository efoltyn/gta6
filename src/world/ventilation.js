/* ============================================================
   world/ventilation.js — Secret Crawlspaces and Grates
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox } = CBZ;

  CBZ.vents = [];

  function makeGrate(x, y, z, ax, name) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    scene.add(grp);

    // Visual frame
    const w = ax === "x" ? 0.1 : 1.2;
    const d = ax === "x" ? 1.2 : 0.1;
    addBox(x, y, z, w, 1.2, d, 0x515a66, { solid: false, cast: false });
    // Slats
    for (let i = -2; i <= 2; i++) {
      const sx = ax === "x" ? x : x + i * 0.22;
      const sz = ax === "x" ? z + i * 0.22 : z;
      addBox(sx, y, sz, ax === "x" ? 0.12 : 0.14, 1.0, ax === "x" ? 0.08 : 0.08, 0x1a1d22, { cast: false });
    }

    const vent = {
      x: x + (ax === "x" ? (x < 0 ? 1.2 : -1.2) : 0),
      z: z + (ax === "z" ? (z < 0 ? 1.2 : -1.2) : 0),
      y: 0.1,
      name: name,
      dest: null,
    };
    CBZ.vents.push(vent);
    return vent;
  }

  // 1. Cell Block Vent (faces East)
  const cellVent = makeGrate(-15.4, 0.8, -31, "x", "Cell Block Aisle");
  // 2. Armory Vent (faces West)
  const armoryVent = makeGrate(18.6, 0.8, -4.5, "x", "Locked Armory");
  
  // Connect them
  cellVent.dest = armoryVent;
  armoryVent.dest = cellVent;

  // 3. Cafeteria Vent (faces East)
  const cafeVent = makeGrate(-18.6, 0.8, 8.5, "x", "Mess Hall");
  // 4. Lounge Vent (faces West)
  const loungeVent = makeGrate(18.6, 0.8, 41.5, "x", "Staff Lounge");

  // Connect them
  cafeVent.dest = loungeVent;
  loungeVent.dest = cafeVent;
})();
