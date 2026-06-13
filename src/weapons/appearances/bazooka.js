/* ============================================================
   weapons/appearances/bazooka.js — shoulder-fired RPG/bazooka block model.

   WHY: the building-wrecker should read "rocket launcher" instantly,
   but from the SHOOTER's eye most of the tube sits beside your cheek —
   so the on-screen read lives in the muzzle end: the flared bell, and
   a warhead nose poking out of it. The classic proportions stay (they
   read right); realism comes from restrained landmarks: an olive
   conical warhead with a thin red band (not a balloon), a flared
   exhaust venturi, a ladder sight, a shoulder pad, a front support
   grip. NO fat shoulder-wrap cylinder — anything wide at z≈0 sits
   right against the camera and swallows half the screen.

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.bazooka = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // long launch tube (dark sleeve + steel liner, the classic pairing)
    cyl(g, 0.11, 1.7, mat.dark, 0, 0.05, -0.55, Math.PI / 2);
    cyl(g, 0.085, 1.74, mat.steel, 0, 0.05, -0.55, Math.PI / 2);
    // wide muzzle bell at the front (flared cone)
    cyl(g, 0.17, 0.26, mat.black, 0, 0.05, -1.30, Math.PI / 2);
    // rear blast venturi
    cyl(g, 0.13, 0.18, mat.black, 0, 0.05, 0.34, Math.PI / 2);
    // WARHEAD out of the bell, the real PG-7 anatomy: a slim booster stem,
    // then the fat BULB wider than the tube, closed by a true CONE down to
    // the fuze tip (stacked flat cylinders read as a pencil — the cone is
    // what says "rocket-propelled grenade"). Olive body, thin red band.
    cyl(g, 0.055, 0.16, mat.dark, 0, 0.05, -1.42, Math.PI / 2);          // booster stem
    cyl(g, 0.105, 0.20, mat.polymer, 0, 0.05, -1.56, Math.PI / 2);       // the bulb
    cyl(g, 0.107, 0.04, mat.redShell, 0, 0.05, -1.49, Math.PI / 2);      // live-round band
    (function () {                                                        // cone nose
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.105, 0.30, 12), mat.polymer);
      cone.position.set(0, 0.05, -1.81); cone.rotation.x = -Math.PI / 2;
      g.add(cone);
    })();
    cyl(g, 0.013, 0.05, mat.steel, 0, 0.05, -1.97, Math.PI / 2);         // fuze tip
    // pistol grip + trigger guard / fire block
    box(g, 0.075, 0.20, 0.10, mat.polymer, 0, -0.14, -0.05, -0.18);
    box(g, 0.09, 0.085, 0.20, mat.dark, 0, -0.02, -0.06);
    box(g, 0.012, 0.04, 0.011, mat.steel, 0, -0.045, -0.10, -0.2);
    // forward support grip under the tube
    box(g, 0.07, 0.15, 0.09, mat.polymer, 0, -0.105, -0.42, -0.1);
    // shoulder rest pad at the rear
    box(g, 0.16, 0.12, 0.09, mat.tan, 0, -0.06, 0.20);
    // folded ladder sight off the top — small, it's a landmark not a mast
    box(g, 0.022, 0.10, 0.028, mat.black, -0.04, 0.16, -0.42);
    box(g, 0.05, 0.05, 0.012, mat.steel, -0.04, 0.225, -0.42);
    // hand on the fire grip
    box(g, 0.15, 0.11, 0.13, mat.skin, 0, -0.13, -0.02, -0.10);
    g.userData.muzzle = new THREE.Vector3(0, 0.05, -1.4);
    return g;
  };
})();
