/* ============================================================
   weapons/appearances/ak47.js — the AK-47 block model.

   WHY: the AK is the street's STATUS rifle — the gun you buy to be SEEN
   holding. It must read as an AK at a glance from across an intersection:
   wood furniture (stock/handguard), black stamped steel, the curved BANANA
   mag, and the tall front-sight post. One builder serves the first-person
   viewmodel, the player's third-person carry, and every NPC carrying
   "AK-47" (actorweapons.js) — same silhouette everywhere, zero new assets.

   Perf: pure boxes/cyls on the caller's SHARED material table. The wood
   material is lazily added to that table once per system and marked
   _shared so per-actor prop disposal never frees it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.ak47 = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    // signature warm wood — added ONCE to this system's shared mat table
    if (!mat.wood) {
      mat.wood = new THREE.MeshLambertMaterial({ color: 0x6e4424 });
      mat.wood._shared = true;
    }
    const g = new THREE.Group();
    // stamped-steel receiver + raised dust cover on top
    box(g, 0.16, 0.13, 0.40, mat.dark, 0, 0.01, -0.16);
    box(g, 0.13, 0.05, 0.34, mat.steel, 0, 0.09, -0.14);
    // wood handguard: lower grip + upper gas-tube cover
    box(g, 0.155, 0.115, 0.34, mat.wood, 0, 0.0, -0.53);
    box(g, 0.115, 0.065, 0.26, mat.wood, 0, 0.095, -0.51);
    // barrel + gas block where the tube meets it
    cyl(g, 0.026, 0.52, mat.black, 0, 0.035, -0.94, Math.PI / 2);
    box(g, 0.06, 0.075, 0.06, mat.black, 0, 0.075, -0.78);
    // tall hooded FRONT SIGHT POST near the muzzle (the AK profile-maker)
    box(g, 0.05, 0.05, 0.045, mat.black, 0, 0.085, -1.08);
    box(g, 0.018, 0.085, 0.02, mat.black, 0, 0.15, -1.08);
    // slant muzzle brake
    cyl(g, 0.034, 0.11, mat.steel, 0, 0.035, -1.18, Math.PI / 2);
    // rear tangent sight on the dust cover
    box(g, 0.05, 0.035, 0.13, mat.steel, 0, 0.105, -0.34);
    // CURVED BANANA MAG — three segments sweeping down + forward
    box(g, 0.07, 0.17, 0.12, mat.dark, 0, -0.135, -0.255, 0.30);
    box(g, 0.07, 0.17, 0.115, mat.dark, 0, -0.27, -0.315, 0.62);
    box(g, 0.07, 0.16, 0.11, mat.dark, 0, -0.385, -0.41, 0.95);
    // raked wood pistol grip + trigger guard
    box(g, 0.085, 0.20, 0.10, mat.wood, 0, -0.16, -0.01, -0.22);
    box(g, 0.055, 0.03, 0.14, mat.black, 0, -0.105, -0.13);
    // full wood stock drooping slightly to the butt, steel buttplate
    box(g, 0.10, 0.135, 0.40, mat.wood, 0, -0.045, 0.255, 0.10);
    box(g, 0.105, 0.17, 0.04, mat.steel, 0, -0.075, 0.455, 0.10);
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -1.24);
    return g;
  };
})();
