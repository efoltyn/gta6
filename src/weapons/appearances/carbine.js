/* ============================================================
   weapons/appearances/carbine.js — the M4 CARBINE block model.

   WHY: the workhorse rifle must read "M4" against the AK one holster
   slot away — same class, opposite culture. The M4 landmarks that
   survive being boxes: a FLAT-TOP upper with a rail and a RAISED rear
   sight (vs the AK's low tangent sight), the triangular FRONT SIGHT
   POST out on the barrel, a near-straight 5.56 mag (vs the banana), a
   TELESCOPING stock on a visible buffer tube (vs fixed wood), an A2
   birdcage flash hider, the charging-handle T at the rear of the rail,
   and all-black polymer — zero wood anywhere.

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.carbine = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // upper + lower receiver with a deep magwell block
    box(g, 0.140, 0.095, 0.36, mat.dark, 0, 0.045, -0.20);
    box(g, 0.125, 0.085, 0.30, mat.dark, 0, -0.025, -0.135);
    // FLAT-TOP rail running the upper + charging-handle T at the rear
    box(g, 0.090, 0.028, 0.38, mat.black, 0, 0.105, -0.21);
    box(g, 0.095, 0.022, 0.045, mat.black, 0, 0.105, 0.005);
    // raised REAR SIGHT block with ears on the rail
    box(g, 0.070, 0.045, 0.055, mat.black, 0, 0.145, -0.075);
    box(g, 0.018, 0.030, 0.040, mat.black, -0.026, 0.18, -0.075);
    box(g, 0.018, 0.030, 0.040, mat.black, 0.026, 0.18, -0.075);
    // EJECTION PORT + forward assist nub on the right flank
    box(g, 0.016, 0.050, 0.10, mat.steel, 0.072, 0.05, -0.245);
    cyl(g, 0.018, 0.025, mat.black, 0.075, 0.045, -0.105, 0, 0, Math.PI / 2);
    // ribbed polymer handguard with a bottom rail strip
    box(g, 0.115, 0.105, 0.34, mat.polymer, 0, 0.030, -0.56);
    box(g, 0.070, 0.025, 0.30, mat.black, 0, -0.035, -0.55);
    // barrel + triangular FRONT SIGHT POST out on it + A2 flash hider
    cyl(g, 0.020, 0.42, mat.black, 0, 0.045, -0.92, Math.PI / 2);
    box(g, 0.030, 0.085, 0.030, mat.black, 0, 0.10, -0.80, 0, 0, 0);
    box(g, 0.030, 0.075, 0.055, mat.black, 0, 0.065, -0.775, 0.5);
    cyl(g, 0.027, 0.095, mat.steel, 0, 0.045, -1.10, Math.PI / 2);
    // 30rd 5.56 mag: near-straight, just a hint of forward curve
    box(g, 0.062, 0.19, 0.10, mat.dark, 0, -0.155, -0.265, 0.14);
    box(g, 0.062, 0.10, 0.095, mat.dark, 0, -0.285, -0.30, 0.28);
    // pistol grip + trigger guard + trigger
    box(g, 0.085, 0.175, 0.095, mat.polymer, 0, -0.15, -0.015, -0.24);
    box(g, 0.046, 0.018, 0.115, mat.black, 0, -0.095, -0.115);
    box(g, 0.014, 0.045, 0.012, mat.black, 0, -0.058, -0.09, -0.2);
    // BUFFER TUBE + telescoping stock slid onto it + rubber buttpad
    cyl(g, 0.030, 0.22, mat.dark, 0, 0.055, 0.115, Math.PI / 2);
    box(g, 0.090, 0.13, 0.17, mat.polymer, 0, 0.005, 0.225, 0.10);
    box(g, 0.095, 0.15, 0.03, mat.black, 0, -0.005, 0.315, 0.10);
    // hand on the grip
    box(g, 0.150, 0.105, 0.135, mat.skin, 0, -0.145, 0.015, -0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -1.16);
    return g;
  };
})();
