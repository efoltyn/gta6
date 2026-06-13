/* ============================================================
   weapons/appearances/shotgun.js — the 12G PUMP block model.

   WHY: the room-clearer must read "pump shotgun" before you hear it.
   The landmarks that survive being boxes: TWO parallel tubes up front
   (barrel OVER the magazine tube — no rifle has that), the sliding
   wood FORE-END with grasping grooves, a brass BEAD sight (not a
   post) at the muzzle, a receiver with a visible ejection port, a
   side SADDLE of red shells on the receiver (ammo you can SEE — this
   gun's whole rhythm is feeding it), and a full wood stock with a
   recoil pad.

   Contract: fpsmode.js slides userData.pump along +z by pumpBaseZ +
   sin(t)*0.22 for the pump cycle — the grooves are CHILDREN of the
   pump mesh so they rack with it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.shotgun = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    if (!mat.wood) {
      mat.wood = new THREE.MeshLambertMaterial({ color: 0x6e4424 });
      mat.wood._shared = true;
    }
    const g = new THREE.Group();
    // steel receiver + EJECTION PORT cut into the right flank
    box(g, 0.150, 0.150, 0.36, mat.dark, 0, 0.015, -0.17);
    box(g, 0.016, 0.065, 0.13, mat.black, 0.072, 0.035, -0.20);
    // BARREL over MAGAZINE TUBE — the twin-tube shotgun silhouette —
    // with a clamp ring tying them together near the muzzle
    cyl(g, 0.032, 0.80, mat.black, 0, 0.095, -0.70, Math.PI / 2);
    cyl(g, 0.026, 0.68, mat.steel, 0, 0.020, -0.62, Math.PI / 2);
    box(g, 0.075, 0.115, 0.035, mat.steel, 0, 0.058, -0.93);
    // brass BEAD sight at the muzzle (shotguns point, they don't aim)
    cyl(g, 0.012, 0.020, mat.brass, 0, 0.135, -1.07);
    // sliding wood PUMP riding the mag tube; grooves are children so
    // they rack back with it (fpsmode slides this mesh on z)
    const pump = box(g, 0.105, 0.095, 0.30, mat.wood, 0, 0.005, -0.52);
    box(pump, 0.110, 0.099, 0.020, mat.dark, 0, 0, -0.09);
    box(pump, 0.110, 0.099, 0.020, mat.dark, 0, 0, 0);
    box(pump, 0.110, 0.099, 0.020, mat.dark, 0, 0, 0.09);
    // pump ARM connecting the fore-end back into the receiver — also a
    // child of the pump so the whole assembly racks together
    box(pump, 0.020, 0.030, 0.26, mat.steel, 0.058, -0.025, 0.16);
    // side SADDLE: three red spare shells with brass heads, right side
    cyl(g, 0.020, 0.085, mat.redShell, 0.085, 0.045, -0.085, Math.PI / 2);
    cyl(g, 0.020, 0.085, mat.redShell, 0.085, -0.005, -0.085, Math.PI / 2);
    cyl(g, 0.020, 0.085, mat.redShell, 0.085, 0.095, -0.085, Math.PI / 2);
    box(g, 0.012, 0.16, 0.10, mat.dark, 0.095, 0.045, -0.085);
    // trigger guard + trigger
    box(g, 0.048, 0.020, 0.13, mat.black, 0, -0.085, -0.10);
    box(g, 0.014, 0.045, 0.012, mat.steel, 0, -0.05, -0.085, -0.2);
    // full WOOD stock: dropped comb wrist into the butt + recoil pad
    box(g, 0.105, 0.13, 0.24, mat.wood, 0, -0.025, 0.115, -0.18);
    box(g, 0.110, 0.155, 0.26, mat.wood, 0, -0.075, 0.305, 0.08);
    box(g, 0.115, 0.165, 0.035, mat.black, 0, -0.085, 0.44, 0.08);
    // hand on the wrist
    box(g, 0.160, 0.115, 0.15, mat.skin, 0, -0.09, 0.07, -0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.095, -1.10);
    g.userData.pump = pump;
    g.userData.pumpBaseZ = pump.position.z;
    return g;
  };
})();
