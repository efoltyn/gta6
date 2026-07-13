/* ============================================================
   world/ground.js — base terrain, grass yard, concrete cell floor
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { mat, addBox, checkerTex, concreteTex } = CBZ;

  // huge base ground so the world continues past the exit gate
  const base = new THREE.Mesh(new THREE.PlaneGeometry(420, 520), mat(0x4ea84e));
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, -0.02, 40);
  base.receiveShadow = true;
  scene.add(base);

  // yard grass — checker texture
  const grass = checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2);
  grass.repeat.set(15, 15);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshLambertMaterial({ map: grass })
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, 0, 22);
  yard.receiveShadow = true;
  scene.add(yard);

  // central asphalt walkway from the cell door toward the exit
  const asphalt = checkerTex(CBZ.COL.ASPHALT_A, CBZ.COL.ASPHALT_B, 2);
  asphalt.repeat.set(2, 12);
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 56),
    new THREE.MeshLambertMaterial({ map: asphalt })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 24);
  path.receiveShadow = true;
  scene.add(path);

  // cell-block concrete floor
  const ctex = concreteTex("#6e7682", "#3b424c");
  ctex.repeat.set(8, 9);
  const cell = new THREE.Mesh(
    new THREE.BoxGeometry(32, 0.1, 36),
    new THREE.MeshLambertMaterial({ map: ctex })
  );
  cell.position.set(0, -0.04, -26);
  cell.receiveShadow = true;
  scene.add(cell);
})();
