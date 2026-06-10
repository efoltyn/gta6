/* ============================================================
   weapons/appearances/bazooka.js - shoulder-fired RPG/bazooka block model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.bazooka = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // long fat launch tube
    cyl(g, 0.11, 1.7, mat.dark, 0, 0.05, -0.55, Math.PI / 2);
    cyl(g, 0.085, 1.74, mat.steel, 0, 0.05, -0.55, Math.PI / 2);
    // wide muzzle bell at the front (flared cone)
    cyl(g, 0.17, 0.26, mat.black, 0, 0.05, -1.30, Math.PI / 2);
    // rear blast venturi
    cyl(g, 0.13, 0.18, mat.black, 0, 0.05, 0.34, Math.PI / 2);
    // warhead nose poking out of the bell
    cyl(g, 0.075, 0.30, mat.redShell, 0, 0.05, -1.46, Math.PI / 2);
    box(g, 0.07, 0.07, 0.07, mat.worn, 0, 0.05, -1.62);
    // pistol grip
    box(g, 0.075, 0.20, 0.10, mat.polymer, 0, -0.14, -0.05, -0.18);
    // trigger guard / fire block
    box(g, 0.09, 0.085, 0.20, mat.dark, 0, -0.02, -0.06);
    // shoulder rest pad at the rear
    box(g, 0.16, 0.12, 0.09, mat.tan, 0, -0.06, 0.20);
    // crude top sight
    box(g, 0.03, 0.05, 0.10, mat.steel, 0, 0.18, -0.40);
    g.userData.muzzle = new THREE.Vector3(0, 0.05, -1.4);
    return g;
  };
})();
