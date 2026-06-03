/* ============================================================
   weapons/appearances/shotgun.js - pump shotgun block model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.shotgun = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    box(g, 0.18, 0.15, 0.34, mat.dark, 0, 0.005, -0.18);
    cyl(g, 0.034, 0.95, mat.black, 0, 0.095, -0.68, Math.PI / 2);
    cyl(g, 0.023, 0.88, mat.steel, 0, 0.040, -0.65, Math.PI / 2);
    const pump = box(g, 0.20, 0.095, 0.31, mat.tan, 0, -0.035, -0.54);
    box(g, 0.19, 0.15, 0.38, mat.tan, 0.015, -0.055, 0.10, 0.20);
    box(g, 0.045, 0.035, 0.04, mat.worn, 0, 0.145, -1.03);
    box(g, 0.17, 0.12, 0.16, mat.skin, 0, -0.18, -0.08, -0.1);
    g.userData.muzzle = new THREE.Vector3(0, 0.10, -1.12);
    g.userData.pump = pump;
    g.userData.pumpBaseZ = pump.position.z;
    return g;
  };
})();
