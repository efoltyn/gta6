/* ============================================================
   weapons/appearances/smg.js — the COMPACT SMG (MP5-style) block model.

   WHY: the spray gun has to read "SMG" instantly — at viewmodel
   distance and in an NPC's hands across the street — or every
   firefight threat-read fails. The MP5 landmarks that survive being
   boxes: the HOODED DRUM front sight (a ring at the muzzle end — the
   #1 MP5 tell), a tubular upper over a slim polymer lower, a LONG
   slim 9mm magazine with a slight forward sweep, the charging handle
   tube riding above the handguard, and a fixed stock with a buttpad.
   Distinct from the Uzi (mag-in-grip) and the carbine (flat-top).

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.smg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // tubular UPPER receiver running the gun's length
    cyl(g, 0.052, 0.62, mat.dark, 0, 0.055, -0.29, Math.PI / 2);
    // slim polymer LOWER: grip frame rear + handguard forward
    box(g, 0.115, 0.095, 0.30, mat.polymer, 0, -0.025, -0.135);
    box(g, 0.105, 0.105, 0.26, mat.polymer, 0, -0.015, -0.46);
    // charging handle TUBE above the handguard + forward cocking knob
    cyl(g, 0.024, 0.30, mat.steel, 0, 0.105, -0.43, Math.PI / 2);
    box(g, 0.052, 0.022, 0.045, mat.black, -0.030, 0.105, -0.50);
    // slim barrel + three-lug stub at the muzzle
    cyl(g, 0.018, 0.18, mat.black, 0, 0.055, -0.67, Math.PI / 2);
    cyl(g, 0.026, 0.045, mat.steel, 0, 0.055, -0.73, Math.PI / 2);
    // HOODED DRUM front sight: a ring around a thin post (the MP5-maker)
    cyl(g, 0.040, 0.035, mat.black, 0, 0.135, -0.595, Math.PI / 2);
    box(g, 0.012, 0.050, 0.012, mat.black, 0, 0.125, -0.595);
    // rear drum sight over the receiver
    cyl(g, 0.030, 0.040, mat.black, 0, 0.130, -0.045, Math.PI / 2);
    // LONG slim 9mm mag, two segments with a slight forward sweep
    box(g, 0.058, 0.17, 0.085, mat.dark, 0, -0.135, -0.295, 0.16);
    box(g, 0.058, 0.16, 0.080, mat.dark, 0, -0.275, -0.33, 0.34);
    // pistol grip + wrap-around trigger guard
    box(g, 0.090, 0.19, 0.10, mat.black, 0, -0.155, -0.045, -0.20);
    box(g, 0.046, 0.018, 0.115, mat.black, 0, -0.10, -0.155);
    box(g, 0.014, 0.045, 0.012, mat.steel, 0, -0.062, -0.125, -0.2);
    // fixed stock: shoulder arm with a slight drop + rubber buttpad
    box(g, 0.085, 0.085, 0.30, mat.polymer, 0, 0.01, 0.155, 0.08);
    box(g, 0.095, 0.155, 0.035, mat.black, 0, -0.01, 0.305, 0.08);
    // hand on the grip
    box(g, 0.150, 0.105, 0.135, mat.skin, 0, -0.15, -0.005, -0.10);
    g.userData.muzzle = new THREE.Vector3(0, 0.055, -0.78);
    return g;
  };
})();
