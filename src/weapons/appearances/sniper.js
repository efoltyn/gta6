/* ============================================================
   weapons/appearances/sniper.js — the bolt sniper (M24 SWS).

   weapon-data cites the M24, so this is one: a Remington 700 round action
   with the bolt knob out on the right at the back, a heavy barrel with a
   plain crown, the olive-drab synthetic stock with its wide flat
   beavertail fore-end, near-vertical grip and straight comb, a hinged
   floorplate running into the trigger guard, a rubber pad, and the
   Leupold M3A 10x42 on two rings — the #1 tell. No iron sights (the real
   M24 has none either). 1092 mm at k = 1.66. The scope comes from
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
    K.tag(K.tube(g, 0.030, 0.030, 0.380, 16, blued, 0, 0.054, -0.110), "part_action");
    K.tag(K.tube(g, 0.020, 0.024, 0.050, 12, steel, 0, 0.056, 0.100), "part_bolt");
    // one turned piece: the stem swept down-and-out, the pear knob on its end
    K.tag(K.lathe(g, "m24.boltHandle", [[0, 0], [0.0065, 0], [0.0065, 0.056], [0.009, 0.061], [0.013, 0.065], [0.016, 0.070],
      [0.0168, 0.077], [0.016, 0.084], [0.013, 0.089], [0.008, 0.093], [0, 0.094]], 14, K.fin("edge"),
      0.030, 0.054, 0.030, { axis: "y", rz: -1.993 }), "part_boltKnob");

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
    K.prof(g, "m24.trig", [[0.066, -0.034], [0.074, -0.034], [0.075, -0.058], [0.076, -0.068], [0.079, -0.080],
      [0.085, -0.088], [0.081, -0.091], [0.071, -0.081], [0.067, -0.068], [0.065, -0.056]], 0.010, mat.black, { bevel: 0.001 });

    // THE SCOPE: a Leupold Ultra M3A 10x42 (30 mm tube, 318 mm long) on two
    // rings and a one-piece base across the action. weapons/optics.js draws
    // it and stamps its anchors (10x, 90 mm eye relief).
    if (CBZ.createWeaponOptic) {
      g.add(CBZ.createWeaponOptic({
        name: "_baseOptic", x: 0, y: 0.170, z: -0.170,
        length: 0.50, radius: 0.028, objectiveRadius: 0.046, ocularRadius: 0.036, mountDrop: 0.083,
        highMag: true, mag: 10, k: 1.66, tint: "#a9d8ff", materials: { dark: mat.black, steel: mat.steel || steel },
      }));
    } else {
      // a page without optics.js: the same turned shell from the kit
      const sc = new THREE.Group();
      sc.name = "_baseOptic";
      sc.position.set(0, 0.170, -0.170);
      g.add(sc);
      K.lathe(sc, "m24.fbScope", [[0.032, -0.250], [0.036, -0.246], [0.036, -0.165], [0.029, -0.120], [0.028, -0.115],
        [0.028, 0.080], [0.030, 0.095], [0.046, 0.180], [0.046, 0.250], [0.040, 0.250], [0.040, 0.235], [0.024, 0.150],
        [0.024, -0.110], [0.031, -0.200], [0.031, -0.250], [0.032, -0.250]], 24, mat.black, 0, 0, 0);
      for (const z of [0.105, -0.055]) {
        K.prof(sc, "m24.fbRing", [[-0.036, 0], [-0.036, -0.030], [-0.020, -0.040], [-0.020, -0.083], [0.020, -0.083], [0.020, -0.040],
          [0.036, -0.030], [0.036, 0]].concat(K.arc(0, 0, 0.036, 0, Math.PI, 12)), 0.024, steel,
        { axis: "z", bevel: 0.002, z: z, holes: [K.arc(0, 0, 0.028, Math.PI, 0, 12)] });
      }
      const lens = K.fin("lens");
      cyl(sc, 0.031, 0.0015, lens, 0, 0, 0.240, Math.PI / 2);
      cyl(sc, 0.040, 0.0015, lens, 0, 0, -0.238, Math.PI / 2);
      K.opticAnchors(sc, { type: "scope", mag: 10, rear: [0, 0, 0.240], front: [0, 0, -0.238], lensR: 0.031, eyeRelief: 0.09, k: 1.66 });
    }

    // the firing hand on the grip
    const R = 14 * Math.PI / 180;
    K.hand(g, { at: [-0.060, 0.022], rake: R, gripW: 0.074, gripD: 0.080, trigger: [-0.074, -0.074] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.323);
    // WHERE THE HANDS GO — see systems/gunhands.js.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.070, -0.520),   // under the beavertail fore-end
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.000, z: -0.520, w: 0.074, h: 0.080, rc: 0.024, len: 0.40 },
      mag: new THREE.Vector3(0, -0.060, -0.200),       // hinged floorplate
      charge: new THREE.Vector3(0.110, 0.020, 0.030),  // the BOLT knob — this gun is worked by hand
      style: "bolt",     // top-fed through the open action, the bolt worked by the firing hand (CBZ.gunReload)
    };
    // THE ANCHORS (contract: sidearm.js); sight/lens/optic from the scope.
    // The "mag" is the 5-round internal box over the hinged floorplate.
    K.anchors(g, {
      k: 1.66,
      grip: { pos: [0, -0.105, 0.030], rake: R },
      trigger: [0, -0.074, -0.0775],
      support: { pos: [0, 0.000, -0.520], kind: "guard", len: 0.40 },
      mag: { pos: [0, -0.015, -0.170], well: [0, 0.030, -0.170] },
      stock: [0, -0.033, 0.490],
      bolt: [0.100, 0.022, 0.030],
      charge: [0.100, 0.022, 0.030],
      optic: { type: "scope", mag: 10 },
    });
    return g;
  };
})();
