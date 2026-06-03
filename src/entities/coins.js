/* ============================================================
   entities/coins.js — cigarette-pack pickups (the yard's loose cash).
   Each pack is worth a few cigarettes; collection is handled in
   systems/interactions.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  const mat = CBZ.mat;

  function addPack(x, z, value) {
    const grp = new THREE.Group();
    // white pack body with a coloured top band + a little "filter" stripe
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), mat(0xf6f3ea, { emissive: 0x554b33, ei: 0.25 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.3), mat(0xc94d3a));
    band.position.y = 0.22;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.24), mat(0xffd451));
    lid.position.y = 0.31;
    grp.add(body, band, lid);
    grp.position.set(x, 1.0, z);
    grp.castShadow = true;
    scene.add(grp);

    // floor glow ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.6, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd451, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    scene.add(ring);

    CBZ.coins.push({ group: grp, ring, collected: false, baseY: 1.0, anim: 0, value: value || 5 });
  }

  // scattered around the cells and yard — bigger stashes further from spawn
  [[8, -30, 4], [-8, -20, 4], [-14, 12, 6], [14, 12, 6], [0, 30, 6], [-12, 40, 8], [12, 40, 8], [0, 48, 10]]
    .forEach((p) => addPack(p[0], p[1], p[2]));

  CBZ.addPack = addPack;
})();
