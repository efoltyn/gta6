/* ============================================================
   core/lights.js — sun (shadow-casting) + sky/ground hemisphere
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;

  // warm/cool ambient fill from sky above, grass below
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6f7a55, 0.85);
  scene.add(hemi);

  // key light — the sun. casts the shadows that sell the blocky look.
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
  sun.position.set(48, 90, -10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); // retuned live by core/quality.js
  const sc = 70;
  sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc;  sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.near = 1;  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0, 0, 18);
  scene.add(sunTarget);
  sun.target = sunTarget;

  CBZ.hemi = hemi;
  CBZ.sun = sun;
  CBZ.sunTarget = sunTarget;
})();
