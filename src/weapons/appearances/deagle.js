/* ============================================================
   weapons/appearances/deagle.js — the .50 DESERT EAGLE block model.

   WHY: the Deagle is a FLEX — the most expensive handgun in the game —
   so it cannot share the 9mm's compact silhouette (it did). What makes
   a blocky gun read "Deagle" at viewmodel distance: a MASSIVE slab
   slide that is taller than the frame and runs the full length, the
   angular tapered NOSE, a yawning .50 bore, a flat top rib with bold
   sights, and a wide squared grip. It should look like it outweighs
   the 9mm three to one — because in damage, it does.

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.deagle = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // the SLAB: one huge full-length slide, taller than it is wide
    box(g, 0.185, 0.135, 0.52, mat.dark, 0, 0.055, -0.30);
    // angular nose taper (a rotated cap suggests the Deagle's wedge front)
    box(g, 0.185, 0.10, 0.10, mat.dark, 0, 0.105, -0.535, 0.42);
    // flat top RIB running the slide + bold front/rear sights
    box(g, 0.060, 0.025, 0.46, mat.black, 0, 0.130, -0.29);
    box(g, 0.024, 0.045, 0.04, mat.black, 0, 0.160, -0.50);
    box(g, 0.018, 0.040, 0.035, mat.black, -0.028, 0.155, -0.075);
    box(g, 0.018, 0.040, 0.035, mat.black, 0.028, 0.155, -0.075);
    // rear slide serrations (a lighter inset panel = machined grasping grooves)
    box(g, 0.190, 0.085, 0.085, mat.steel, 0, 0.050, -0.105);
    // the .50 BORE — a bore you can see into, plus a fat barrel stub
    cyl(g, 0.042, 0.085, mat.black, 0, 0.052, -0.575, Math.PI / 2);
    // frame + squared trigger guard with a flat front (the Deagle hook)
    box(g, 0.165, 0.075, 0.34, mat.steel, 0, -0.035, -0.21);
    box(g, 0.052, 0.022, 0.13, mat.dark, 0, -0.105, -0.115);
    box(g, 0.052, 0.075, 0.022, mat.dark, 0, -0.075, -0.185);
    box(g, 0.016, 0.05, 0.014, mat.black, 0, -0.055, -0.09, -0.2);
    // wide squared grip (it holds .50AE — it's a 2x4) + mag baseplate
    box(g, 0.150, 0.24, 0.135, mat.dark, 0, -0.165, 0.005, -0.24);
    box(g, 0.155, 0.035, 0.145, mat.black, 0, -0.275, 0.035, -0.24);
    // hand wrapping the grip
    box(g, 0.165, 0.11, 0.14, mat.skin, 0, -0.155, 0.035, -0.18);
    g.userData.muzzle = new THREE.Vector3(0, 0.052, -0.66);
    return g;
  };
})();
