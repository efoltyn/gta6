/* ============================================================
   world/exit.js — the glowing freedom gate, now at the FAR south end
   of the enlarged compound (CBZ.WORLD.exit).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox, COL, WORLD } = CBZ;
  const { GLOW, GLOW_E } = COL;
  const EX = WORLD.exit.x, EZ = WORLD.exit.z;

  // glowing pillars + lintel framing the gap
  addBox(EX - 4.2, 4, EZ, 0.9, 8, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });
  addBox(EX + 4.2, 4, EZ, 0.9, 8, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });
  addBox(EX, 8.4, EZ, 9.5, 1.2, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });

  // glowing floor pad
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 4),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.55 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(EX, 0.05, EZ - 1);
  scene.add(pad);

  // soft light shaft
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 18, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(EX, 9, EZ);
  scene.add(beam);

  // gentle pulse on the pad so it reads as "the goal"
  CBZ.onAlways(6, function () {
    pad.material.opacity = 0.4 + 0.2 * Math.sin(CBZ.now * 0.004);
  });

  CBZ.EXIT = new THREE.Vector3(EX, 0, EZ);
})();
