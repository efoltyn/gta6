/* ============================================================
   weapons/appearances/sniper.js — the BOLT SNIPER block model.

   WHY: the 130-damage one-shot rifle was rendered with the M4 factory —
   the single most expensive shot in the game looked like the mid-tier
   auto. A blocky gun reads "sniper" through exactly four landmarks:
   the SCOPE (fat tube + objective/ocular bells on tall rings — the #1
   tell), a LONG thin barrel ending in a muzzle brake, the BOLT handle
   knob hanging off the right of the receiver, and a full wooden
   hunting stock with a raised cheek riser. NPCs holding one across
   the street should make you break for cover before the first shot.

   Perf: pure boxes/cyls on the caller's shared material table; wood is
   lazily added once and marked _shared (ak47.js pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.sniper = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    if (!mat.wood) {
      mat.wood = new THREE.MeshLambertMaterial({ color: 0x6e4424 });
      mat.wood._shared = true;
    }
    const g = new THREE.Group();
    // steel receiver sunk into the stock
    box(g, 0.110, 0.105, 0.34, mat.dark, 0, 0.045, -0.14);
    // BOLT handle: stem out the right side, knob swept down (the cycle you pay for)
    cyl(g, 0.016, 0.085, mat.steel, 0.085, 0.045, 0.005, 0, 0, Math.PI / 2 - 0.5);
    cyl(g, 0.030, 0.045, mat.steel, 0.125, 0.015, 0.005, 0, 0, Math.PI / 2 - 0.5);
    // THE SCOPE — fat tube high over the bore on two tall rings,
    // flared objective bell forward + ocular bell at the eye
    box(g, 0.030, 0.060, 0.035, mat.black, 0, 0.135, -0.215);
    box(g, 0.030, 0.060, 0.035, mat.black, 0, 0.135, -0.045);
    cyl(g, 0.042, 0.34, mat.black, 0, 0.185, -0.13, Math.PI / 2);
    cyl(g, 0.060, 0.10, mat.dark, 0, 0.185, -0.325, Math.PI / 2);
    cyl(g, 0.052, 0.075, mat.dark, 0, 0.185, 0.065, Math.PI / 2);
    // windage/elevation turret on top of the tube
    cyl(g, 0.020, 0.035, mat.steel, 0, 0.245, -0.13);
    // LONG thin free-floated barrel + muzzle brake at the very end
    cyl(g, 0.024, 0.92, mat.black, 0, 0.050, -0.77, Math.PI / 2);
    cyl(g, 0.034, 0.10, mat.steel, 0, 0.050, -1.26, Math.PI / 2);
    // flush hinged floorplate magazine ahead of the trigger
    box(g, 0.075, 0.045, 0.16, mat.steel, 0, -0.055, -0.235);
    // full WOOD hunting stock: slim forend under the barrel, wrist,
    // butt with a raised CHEEK RISER, dark recoil pad
    box(g, 0.090, 0.085, 0.62, mat.wood, 0, -0.015, -0.50);
    box(g, 0.090, 0.135, 0.26, mat.wood, 0, -0.045, 0.115, -0.16);
    box(g, 0.095, 0.165, 0.30, mat.wood, 0, -0.075, 0.325, 0.06);
    box(g, 0.080, 0.060, 0.22, mat.wood, 0, 0.035, 0.345);
    box(g, 0.100, 0.175, 0.035, mat.black, 0, -0.08, 0.48, 0.06);
    // trigger guard + blade
    box(g, 0.045, 0.018, 0.115, mat.black, 0, -0.105, -0.075);
    box(g, 0.014, 0.045, 0.012, mat.steel, 0, -0.065, -0.06, -0.2);
    // hand on the wrist of the stock
    box(g, 0.150, 0.105, 0.14, mat.skin, 0, -0.10, 0.10, -0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.050, -1.32);
    return g;
  };
})();
