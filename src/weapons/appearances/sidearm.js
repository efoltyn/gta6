/* ============================================================
   weapons/appearances/sidearm.js — compact 9mm block model.

   WHY: the starter pistol is on screen more than any other model and
   it kept reading as a BRICK — a pistol viewmodel lives inches from
   the lens, so every centimetre of width/height shows up triple.
   Round 2 (user filmed round 1, still hated it): the whole gun is
   ~15% smaller and meaningfully SLIMMER, the slide is a low flat
   band (not a tall slab), the frame tucks underneath instead of
   matching the slide's width, and the only proud details are the
   ones a pistol actually shows at arm's length: sights, ejection
   port, the barrel crown, the mag baseplate.

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.sidearm = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // SLIDE — a low, flat gunmetal band (height is what made it a brick)
    box(g, 0.115, 0.072, 0.38, mat.dark, 0, 0.036, -0.26);
    // rear serration block, slightly proud only at the back corner
    box(g, 0.119, 0.06, 0.06, mat.black, 0, 0.036, -0.10);
    // ejection port on the right flank
    box(g, 0.01, 0.04, 0.08, mat.black, 0.058, 0.042, -0.315);
    // sights: a short front post + a low rear notch bar
    box(g, 0.016, 0.02, 0.02, mat.black, 0, 0.082, -0.43);
    box(g, 0.034, 0.018, 0.02, mat.black, 0, 0.081, -0.095);
    // barrel crown just proud of the slide nose
    cyl(g, 0.021, 0.07, mat.black, 0, 0.042, -0.475, Math.PI / 2);
    // polymer FRAME tucked under the slide + a short dust-cover rail
    box(g, 0.105, 0.062, 0.28, mat.polymer, 0, -0.022, -0.20);
    box(g, 0.07, 0.018, 0.09, mat.black, 0, -0.06, -0.295);
    // trigger guard + blade
    box(g, 0.03, 0.062, 0.018, mat.black, 0, -0.062, -0.19, -0.15);
    box(g, 0.011, 0.034, 0.01, mat.black, 0, -0.052, -0.135, -0.2);
    // raked GRIP + mag baseplate
    box(g, 0.095, 0.19, 0.092, mat.polymer, 0, -0.135, -0.03, -0.28);
    box(g, 0.102, 0.02, 0.10, mat.black, 0, -0.225, -0.004, -0.28);
    // hand wrapping the grip
    box(g, 0.125, 0.095, 0.105, mat.skin, 0, -0.135, 0.025, -0.18);
    g.userData.muzzle = new THREE.Vector3(0, 0.042, -0.52);
    return g;
  };
})();
