/* ============================================================
   weapons/appearances/revolver.js — the .357 MAGNUM block model.

   WHY: the revolver is the SHOW-OFF pistol — one slow, loud, huge hit.
   It must NOT share a silhouette with the 9mm (it did — both used the
   sidearm factory, so the .357 you paid for looked like the free gun).
   The landmarks that make any blocky gun read "revolver" at viewmodel
   distance: the fat CYLINDER bulge mid-frame, the exposed HAMMER spur,
   a vent-rib barrel with a full UNDERLUG + ejector rod beneath, and
   curved wood grips. Blued steel + walnut = the classic magnum look.

   Perf: pure boxes/cyls on the caller's shared material table; the wood
   material is lazily added once and marked _shared (ak47.js pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.revolver = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    if (!mat.wood) {
      mat.wood = new THREE.MeshLambertMaterial({ color: 0x6e4424 });
      mat.wood._shared = true;
    }
    const g = new THREE.Group();
    // blued frame: top strap over the cylinder + standing breech behind it
    box(g, 0.075, 0.04, 0.30, mat.dark, 0, 0.085, -0.13);
    box(g, 0.085, 0.13, 0.10, mat.dark, 0, 0.005, -0.015);
    // THE CYLINDER — the revolver-maker: a fat drum on the bore axis,
    // two thin flute shadows so it reads machined, not a pipe
    cyl(g, 0.062, 0.17, mat.steel, 0, 0.030, -0.175, Math.PI / 2);
    box(g, 0.128, 0.022, 0.15, mat.black, 0, 0.030, -0.175);
    box(g, 0.022, 0.128, 0.15, mat.black, 0, 0.030, -0.175);
    // 6" barrel with a VENT RIB on top and a FULL UNDERLUG beneath
    cyl(g, 0.030, 0.36, mat.dark, 0, 0.045, -0.45, Math.PI / 2);
    box(g, 0.030, 0.026, 0.34, mat.black, 0, 0.082, -0.44);
    box(g, 0.040, 0.045, 0.30, mat.dark, 0, 0.005, -0.42);
    // ejector rod poking from the underlug toward the muzzle
    cyl(g, 0.012, 0.10, mat.steel, 0, 0.000, -0.575, Math.PI / 2);
    // ramp FRONT sight + rear notch ears (you aim down the rib)
    box(g, 0.022, 0.035, 0.045, mat.black, 0, 0.110, -0.60);
    box(g, 0.016, 0.030, 0.035, mat.black, -0.026, 0.105, -0.005);
    box(g, 0.016, 0.030, 0.035, mat.black, 0.026, 0.105, -0.005);
    // exposed HAMMER spur raked back over the web of the hand
    box(g, 0.026, 0.075, 0.030, mat.steel, 0, 0.085, 0.055, 0.55);
    // open trigger guard + trigger blade
    box(g, 0.050, 0.020, 0.115, mat.dark, 0, -0.085, -0.075);
    box(g, 0.016, 0.045, 0.014, mat.steel, 0, -0.045, -0.06, -0.2);
    // curved walnut GRIPS, slightly flared at the heel
    box(g, 0.082, 0.21, 0.095, mat.wood, 0, -0.135, 0.045, -0.34);
    box(g, 0.086, 0.06, 0.105, mat.wood, 0, -0.225, 0.085, -0.34);
    // hand wrapping the grip
    box(g, 0.15, 0.11, 0.13, mat.skin, 0, -0.15, 0.07, -0.24);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.64);
    return g;
  };
})();
