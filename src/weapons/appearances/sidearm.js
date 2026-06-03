/* ============================================================
   weapons/appearances/sidearm.js - compact 9mm block model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.sidearm = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    box(g, 0.17, 0.10, 0.44, mat.steel, 0, 0.045, -0.30);
    box(g, 0.15, 0.09, 0.34, mat.dark, 0, -0.03, -0.22);
    cyl(g, 0.030, 0.38, mat.black, 0, 0.060, -0.42, Math.PI / 2);
    box(g, 0.04, 0.035, 0.12, mat.black, 0, 0.125, -0.16);
    box(g, 0.13, 0.25, 0.12, mat.dark, 0, -0.18, -0.04, -0.28);
    box(g, 0.04, 0.08, 0.025, mat.black, 0, -0.07, -0.22, -0.2);
    box(g, 0.15, 0.11, 0.13, mat.skin, 0, -0.18, 0.03, -0.18);
    g.userData.muzzle = new THREE.Vector3(0, 0.065, -0.62);
    return g;
  };
})();
