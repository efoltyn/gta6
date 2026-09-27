/* ============================================================
   weapons/appearances/sniper.js — the bolt sniper (M24 SWS).

   weapon-data cites the M24, so this is one: a Remington 700 round action
   with the bolt knob out on the right at the back, a heavy barrel with a
   plain crown, the olive-drab synthetic stock with its wide flat
   beavertail fore-end, near-vertical grip and straight comb, a hinged
   floorplate running into the trigger guard, a rubber pad, and the 10x
   scope on two rings — the #1 tell. The scope comes from
   weapons/optics.js (shared with gunsmith optics, named "_baseOptic" so a
   fitted scope replaces it); pages without optics.js get a plain tube
   scope from the kit instead of no scope at all.
   Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.sniper = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), stock = K.fin("odStock");
    const g = new THREE.Group();
    const BORE = 0.050;

    // ROUND ACTION + bolt shroud, BOLT handle swept down on the right
    K.tube(g, 0.030, 0.030, 0.380, 16, blued, 0, 0.054, -0.110);
    K.tube(g, 0.020, 0.024, 0.050, 12, steel, 0, 0.056, 0.100);
    box(g, 0.070, 0.014, 0.014, K.fin("edge"), 0.062, 0.040, 0.030, 0, 0, -0.45);
    cyl(g, 0.019, 0.026, K.fin("edge"), 0.100, 0.022, 0.030, 0, 0, Math.PI / 2 - 0.45);

    // HEAVY BARREL tapering to a plain crown
    K.tube(g, 0.019, 0.026, 1.020, 14, blued, 0, BORE, -0.810);
    const bore = cyl(g, 0.011, 0.006, mat.bore || mat.black, 0, BORE, -1.320, Math.PI / 2);
    bore.userData.weaponBore = true;

    // OD SYNTHETIC STOCK: beavertail fore-end, near-vertical grip, straight comb
    K.prof(g, "m24.stock", [
      [0.820, 0.032], [0.828, 0.000], [0.812, -0.030], [0.240, -0.040], [0.020, -0.046],
      [0.012, -0.070], [-0.004, -0.150], [-0.030, -0.162], [-0.070, -0.154], [-0.076, -0.104],
      [-0.108, -0.082], [-0.466, -0.150], [-0.466, 0.084], [-0.132, 0.088], [-0.104, 0.074],
      [-0.084, 0.040], [0.300, 0.040], [0.320, 0.034],
    ], 0.074, stock, { bevel: 0.012 });
    K.prof(g, "m24.pad", [[-0.462, 0.088], [-0.490, 0.088], [-0.490, -0.154], [-0.462, -0.152]], 0.078, K.fin("rubber"), { bevel: 0.004 });
    // hinged floorplate running into the trigger guard
    K.prof(g, "m24.guard", [[0.250, -0.036], [0.250, -0.054], [0.140, -0.056], [0.128, -0.102], [0.034, -0.102], [0.016, -0.060], [0.016, -0.036]],
      0.042, steel, { bevel: 0.003, holes: [[[0.120, -0.058], [0.112, -0.092], [0.044, -0.092], [0.030, -0.058]]] });
    box(g, 0.010, 0.040, 0.010, mat.black, 0, -0.072, -0.078, -0.2);   // trigger

    // THE SCOPE on two rings
    if (CBZ.createWeaponOptic) {
      g.add(CBZ.createWeaponOptic({
        name: "_baseOptic", x: 0, y: 0.185, z: -0.13,
        length: 0.43, radius: 0.042, objectiveRadius: 0.066,
        highMag: true, tint: "#a9d8ff", materials: { dark: mat.black, steel: mat.steel },
      }));
    } else {
      const sc = new THREE.Group();
      sc.name = "_baseOptic";
      sc.position.set(0, 0.185, -0.130);
      g.add(sc);
      K.tube(sc, 0.042, 0.042, 0.300, 16, mat.black, 0, 0, 0);
      K.tube(sc, 0.066, 0.044, 0.110, 16, mat.black, 0, 0, -0.195);
      K.tube(sc, 0.050, 0.044, 0.080, 16, mat.black, 0, 0, 0.175);
      box(sc, 0.050, 0.110, 0.030, steel, 0, -0.080, -0.095);
      box(sc, 0.050, 0.110, 0.030, steel, 0, -0.080, 0.085);
    }

    // the firing hand on the grip
    const R = 14 * Math.PI / 180;
    K.hand(g, { at: [-0.060, 0.022], rake: R, gripW: 0.074, gripD: 0.080, size: 0.86, trigger: [-0.074, -0.074] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.323);
    // WHERE THE HANDS GO — see systems/gunhands.js.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.070, -0.520),   // under the beavertail fore-end
      mag: new THREE.Vector3(0, -0.060, -0.200),       // hinged floorplate
      charge: new THREE.Vector3(0.110, 0.020, 0.030),  // the BOLT knob — this gun is worked by hand
      style: "mag",
    };
    return g;
  };
})();
