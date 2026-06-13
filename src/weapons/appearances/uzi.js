/* ============================================================
   weapons/appearances/uzi.js — the MICRO UZI block model.

   WHY: the Uzi shared the MP5-style SMG factory, so the two bullet
   hoses were indistinguishable in the hand and on a corpse. The Uzi's
   whole identity is MAG-IN-GRIP: a stubby square receiver with the
   long magazine dropping straight out of the pistol grip at the
   weapon's CENTER, a knurled barrel nut on a sawn-off snout, a top
   cocking knob, and a folded wire stock hugging the rear. Short +
   centered = readably "spray gun", not "carbine's little brother".

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.uzi = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // stubby SQUARE receiver — almost as tall as it is long
    box(g, 0.150, 0.150, 0.34, mat.dark, 0, 0.02, -0.16);
    // top cover with the COCKING KNOB riding its middle
    box(g, 0.110, 0.030, 0.30, mat.black, 0, 0.110, -0.16);
    box(g, 0.060, 0.040, 0.060, mat.steel, 0, 0.145, -0.13);
    // sawn-off snout: knurled barrel NUT + short barrel
    cyl(g, 0.046, 0.055, mat.steel, 0, 0.045, -0.355, Math.PI / 2);
    cyl(g, 0.024, 0.16, mat.black, 0, 0.045, -0.43, Math.PI / 2);
    // flip sights front + rear (small ears, you spray over them)
    box(g, 0.030, 0.040, 0.025, mat.black, 0, 0.145, -0.30);
    box(g, 0.030, 0.035, 0.025, mat.black, 0, 0.140, -0.01);
    // MAG-IN-GRIP — the Uzi-maker: grip at weapon CENTER, mag pouring
    // straight down out of it with a brass top round peeking at the lips
    box(g, 0.095, 0.20, 0.115, mat.dark, 0, -0.155, -0.16, -0.08);
    box(g, 0.062, 0.26, 0.075, mat.black, 0, -0.36, -0.175, -0.04);
    box(g, 0.066, 0.025, 0.080, mat.steel, 0, -0.495, -0.18, -0.04);
    // trigger guard ahead of the grip + trigger
    box(g, 0.050, 0.020, 0.115, mat.black, 0, -0.085, -0.28);
    box(g, 0.014, 0.045, 0.012, mat.steel, 0, -0.05, -0.255, -0.2);
    // folded WIRE stock: two thin steel struts down the sides to a butt bar
    box(g, 0.016, 0.022, 0.20, mat.steel, -0.082, -0.01, 0.09);
    box(g, 0.016, 0.022, 0.20, mat.steel, 0.082, -0.01, 0.09);
    box(g, 0.180, 0.060, 0.035, mat.dark, 0, -0.01, 0.20);
    // hand wrapping the center grip
    box(g, 0.160, 0.105, 0.135, mat.skin, 0, -0.155, -0.13, -0.06);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.52);
    return g;
  };
})();
