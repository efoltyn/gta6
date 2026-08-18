/* ============================================================
   weapons/appearances/glauncher.js — 40mm revolver grenade launcher.

   WHY: the "less reloading than the RPG" gun must read as its own
   thing at a glance — NOT a shoulder tube but a stubby carbine with a
   fat revolver DRUM. The drum is the landmark that says "six grenades
   before a reload"; from the shooter's eye the read lives in the drum
   face + the short fat muzzle. Same contract as every other factory:
   pure boxes/cyls on the caller's shared material table, and a
   userData.muzzle socket at the bore tip (the launched grenade and the
   muzzle flash originate there, never inside the drum).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.glauncher = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // stubby fat barrel (40mm bore) + muzzle collar
    cyl(g, 0.052, 0.46, mat.dark, 0, 0.05, -0.52, Math.PI / 2);
    cyl(g, 0.058, 0.06, mat.black, 0, 0.05, -0.73, Math.PI / 2);
    // the revolver DRUM — the landmark (fat, steel, axis on the bore)
    cyl(g, 0.115, 0.17, mat.steel, 0, 0.02, -0.18, Math.PI / 2);
    // chamber mouths ringed on the drum face
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      cyl(g, 0.026, 0.03, mat.black, Math.cos(a) * 0.062, 0.02 + Math.sin(a) * 0.062, -0.275, Math.PI / 2);
    }
    // one 40mm nose proud of the top chamber — the "loaded" read
    cyl(g, 0.02, 0.05, mat.redShell, 0, 0.082, -0.305, Math.PI / 2);
    // receiver bridging drum to stock + top rail
    box(g, 0.075, 0.09, 0.22, mat.dark, 0, 0.055, 0.02);
    box(g, 0.05, 0.03, 0.34, mat.black, 0, 0.115, -0.10);
    // pistol grip + trigger blade
    box(g, 0.07, 0.19, 0.09, mat.polymer, 0, -0.10, 0.06, -0.15);
    box(g, 0.012, 0.04, 0.011, mat.steel, 0, -0.02, 0.0, -0.2);
    // folding stock back to the shoulder pad
    box(g, 0.05, 0.05, 0.24, mat.dark, 0, 0.03, 0.24);
    box(g, 0.11, 0.13, 0.05, mat.tan, 0, 0.01, 0.37);
    // forward vertical grip under the barrel
    box(g, 0.06, 0.13, 0.08, mat.polymer, 0, -0.075, -0.42, -0.1);
    // ladder sight off the top — a landmark, not a mast
    box(g, 0.022, 0.08, 0.024, mat.black, -0.03, 0.17, -0.30);
    box(g, 0.05, 0.04, 0.012, mat.steel, -0.03, 0.22, -0.30);
    // hand on the fire grip
    box(g, 0.14, 0.10, 0.12, mat.skin, 0, -0.09, 0.09, -0.1);
    // projectile + flash originate at the bore tip
    g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.78);
    // WHERE THE HANDS GO — see systems/gunhands.js. Six chambers in a drum:
    // reloaded like a revolver, swung out to the weapon's LEFT.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.130, -0.420),   // the authored forward vertical grip
      mag: new THREE.Vector3(-0.140, 0.020, -0.180),
      charge: null,
      style: "cylinder",
    };
    return g;
  };
})();
