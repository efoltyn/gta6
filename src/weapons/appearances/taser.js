/* ============================================================
   weapons/appearances/taser.js - bright compact stun device.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.taser = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x4a3100, emissiveIntensity: 0.18 });
    box(g, 0.18, 0.11, 0.35, yellow, 0, 0.025, -0.25);
    box(g, 0.13, 0.22, 0.11, mat.black, 0, -0.15, -0.04, -0.26);
    box(g, 0.08, 0.05, 0.11, mat.black, -0.06, 0.030, -0.48);
    box(g, 0.08, 0.05, 0.11, mat.black, 0.06, 0.030, -0.48);
    cyl(g, 0.013, 0.18, mat.steel, -0.052, 0.032, -0.58, Math.PI / 2);
    cyl(g, 0.013, 0.18, mat.steel, 0.052, 0.032, -0.58, Math.PI / 2);
    box(g, 0.05, 0.04, 0.025, mat.black, 0, 0.105, -0.14);
    box(g, 0.14, 0.10, 0.13, mat.skin, 0, -0.16, 0.03, -0.16);
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.72);
    return g;
  };
})();
