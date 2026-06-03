/* ============================================================
   weapons/appearances/smg.js - compact fast SMG block model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.smg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    box(g, 0.17, 0.12, 0.34, mat.dark, 0, 0.005, -0.22);
    box(g, 0.15, 0.10, 0.46, mat.polymer, 0, 0.010, -0.52);
    cyl(g, 0.020, 0.42, mat.black, 0, 0.046, -0.86, Math.PI / 2);
    box(g, 0.10, 0.24, 0.10, mat.black, 0, -0.17, -0.18, -0.12);
    box(g, 0.11, 0.19, 0.10, mat.steel, 0, -0.14, -0.46, -0.08);
    box(g, 0.26, 0.07, 0.18, mat.polymer, 0, 0.035, 0.08, 0.10);
    box(g, 0.05, 0.045, 0.11, mat.black, 0, 0.110, -0.32);
    box(g, 0.16, 0.105, 0.14, mat.skin, 0, -0.16, 0.01, -0.08);
    g.userData.muzzle = new THREE.Vector3(0, 0.050, -1.09);
    return g;
  };
})();
