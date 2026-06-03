/* ============================================================
   weapons/appearances/carbine.js - short carbine block model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.carbine = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    box(g, 0.18, 0.13, 0.36, mat.dark, 0, 0.010, -0.22);
    box(g, 0.15, 0.105, 0.48, mat.polymer, 0, 0.020, -0.58);
    cyl(g, 0.024, 0.58, mat.black, 0, 0.055, -0.97, Math.PI / 2);
    box(g, 0.12, 0.26, 0.11, mat.dark, 0, -0.19, -0.22, -0.16);
    box(g, 0.20, 0.12, 0.33, mat.polymer, 0.015, -0.035, 0.11, 0.10);
    box(g, 0.06, 0.055, 0.13, mat.black, 0, 0.125, -0.35);
    box(g, 0.055, 0.050, 0.10, mat.black, 0, 0.120, -0.80);
    box(g, 0.16, 0.105, 0.14, mat.skin, 0, -0.17, 0.00, -0.1);
    g.userData.muzzle = new THREE.Vector3(0, 0.058, -1.27);
    return g;
  };
})();
