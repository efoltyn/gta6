/* ============================================================
   weapons/appearances/carbine.js — the M4 carbine (flat-top, red dot).

   What makes it an M4 and not "a black rifle": the flat-top upper with a
   toothed Picatinny rail, a 1x red dot on it (weapon-data gives this gun
   optic "dot"), the tall triangular A2 front sight tower out on the barrel,
   the round ribbed two-piece handguard between the delta ring and the cap,
   the forward assist and port cover on the right flank, the charging-handle
   latch at the back of the rail, the buffer tube carrying the telescoping
   stock, a near-straight 30-round STANAG mag and the A2 pistol grip.
   Built on CBZ.gunKit (sidearm.js). The dot is a child named "_baseOptic"
   so a gunsmith scope replaces it instead of clipping through it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.carbine = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const parker = K.fin("parker"), poly = K.fin("polymer"), blued = K.fin("blued");
    const g = new THREE.Group();
    const BORE = 0.045;

    // UPPER receiver + toothed flat-top rail
    K.prof(g, "m4.upper", [[-0.050, 0.000], [0.350, 0.000], [0.400, 0.016], [0.400, 0.082], [-0.050, 0.082]],
      0.060, parker, { bevel: 0.004 });
    K.prof(g, "m4.rail", K.rail(-0.046, 0.396, 0.080, 0.010, 0.009), 0.054, mat.black, { bevel: 0.0015 });
    // right flank: dust cover over the ejection port, brass deflector, forward assist
    box(g, 0.004, 0.034, 0.112, mat.dark, 0.032, 0.040, -0.140);
    box(g, 0.014, 0.030, 0.022, parker, 0.034, 0.062, -0.034);
    cyl(g, 0.012, 0.036, blued, 0.040, 0.052, 0.008, 0, 0, Math.PI / 2);
    // charging-handle latch behind the rail
    box(g, 0.072, 0.012, 0.024, mat.black, 0, 0.076, 0.058);

    // LOWER: flared magwell, trigger guard hole, buffer-tube housing
    K.prof(g, "m4.lower", [
      [-0.072, 0.006], [0.354, 0.006], [0.354, -0.022], [0.346, -0.096], [0.360, -0.110],
      [0.214, -0.110], [0.210, -0.100], [0.200, -0.104], [0.086, -0.104], [0.070, -0.060],
      [-0.030, -0.052], [-0.072, -0.018],
    ], 0.058, parker, { bevel: 0.004,
      holes: [[[0.192, -0.030], [0.192, -0.092], [0.094, -0.092], [0.084, -0.064], [0.100, -0.030]]] });
    box(g, 0.010, 0.040, 0.010, mat.black, 0, -0.052, -0.130, -0.25);   // trigger
    cyl(g, 0.008, 0.062, blued, 0, -0.030, -0.214, 0, 0, Math.PI / 2);  // mag release / pin
    // A2 pistol grip with its finger nub
    const R = 25 * Math.PI / 180;
    K.prof(g, "m4.grip", K.grip(0.074, -0.050, 0.074, 0.170, R, { swellF: 0.010, swellB: 0.004 }),
      0.052, poly, { bevel: 0.005 });
    // 30-round STANAG: straight body, slight forward sweep at the floor
    const mf = [], mb = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, y = -0.020 - t * 0.300, sweep = 0.030 * t * t;
      mf.push([0.340 + sweep, y]);
      mb.push([0.224 + sweep * 1.15, y]);
    }
    K.prof(g, "m4.mag", mf.concat(mb.reverse()), 0.046, mat.dark, { bevel: 0.003 });
    box(g, 0.054, 0.014, 0.128, mat.black, 0, -0.322, -0.314, 0.08);

    // HANDGUARD: round, ribbed, between the delta ring and the cap
    K.prof(g, "m4.hg", K.ribs(0.048, 0.043, 14), 0.320, poly, { axis: "z", bevel: 0.002, y: BORE, z: -0.580 });
    K.tube(g, 0.054, 0.054, 0.030, 16, parker, 0, BORE, -0.418);        // delta ring
    K.tube(g, 0.040, 0.046, 0.022, 16, parker, 0, BORE, -0.750);        // handguard cap
    // barrel with the M203 step, A2 birdcage, open bore
    K.tube(g, 0.016, 0.018, 0.320, 12, blued, 0, BORE, -0.905);
    K.tube(g, 0.022, 0.022, 0.095, 8, mat.black, 0, BORE, -1.112);
    const bore = cyl(g, 0.012, 0.008, mat.bore || mat.black, 0, BORE, -1.157, Math.PI / 2);
    bore.userData.weaponBore = true;
    // A2 FRONT SIGHT tower: collar, sloped rear, bayonet lug, winged post
    K.prof(g, "m4.fsb", [
      [0.768, 0.018], [0.812, 0.018], [0.812, 0.072], [0.804, 0.072], [0.804, 0.138],
      [0.790, 0.138], [0.778, 0.072], [0.768, 0.070],
    ], 0.030, parker, { bevel: 0.003 });
    box(g, 0.014, 0.020, 0.024, parker, 0, 0.010, -0.796);             // bayonet lug
    K.prof(g, "m4.ears", [[-0.026, 0], [0.026, 0], [0.026, 0.040], [0.016, 0.040], [0.012, 0.010],
      [-0.012, 0.010], [-0.016, 0.040], [-0.026, 0.040]], 0.018, parker, { axis: "z", bevel: 0.002, y: 0.128, z: -0.800 });
    box(g, 0.005, 0.030, 0.005, mat.black, 0, 0.152, -0.800);

    // RED DOT (Aimpoint-style) on a QD mount: tube, sunshade, glass, dot
    const dot = new THREE.Group();
    dot.name = "_baseOptic";
    dot.position.set(0, 0, -0.180);
    g.add(dot);
    box(dot, 0.048, 0.032, 0.064, parker, 0, 0.114, 0);
    K.tube(dot, 0.030, 0.030, 0.120, 16, mat.black, 0, 0.162, 0);
    K.tube(dot, 0.034, 0.033, 0.036, 16, mat.black, 0, 0.162, -0.070);
    box(dot, 0.026, 0.020, 0.030, mat.black, 0, 0.196, 0.004);          // elevation turret
    box(dot, 0.020, 0.026, 0.030, mat.black, 0.036, 0.162, 0.004);      // windage turret
    const lens = K.fin("lens");
    cyl(dot, 0.029, 0.004, lens, 0, 0.162, -0.086, Math.PI / 2);
    cyl(dot, 0.027, 0.004, lens, 0, 0.162, 0.061, Math.PI / 2);
    box(dot, 0.005, 0.005, 0.002, K.fin("redDot"), 0, 0.162, 0.064);
    // folded rear back-up sight behind it
    box(g, 0.040, 0.016, 0.034, mat.black, 0, 0.100, -0.010);

    // BUFFER TUBE + six-position stock + rubber pad
    K.tube(g, 0.023, 0.023, 0.270, 16, parker, 0, BORE + 0.004, 0.200);
    K.prof(g, "m4.stock", [
      [-0.128, 0.082], [-0.326, 0.082], [-0.326, -0.100], [-0.302, -0.106], [-0.196, -0.006],
      [-0.150, 0.004], [-0.134, 0.024],
    ], 0.058, poly, { bevel: 0.005 });
    box(g, 0.062, 0.192, 0.018, K.fin("rubber"), 0, -0.010, 0.337);

    // the firing hand on the A2 grip
    K.hand(g, { at: [-0.040, -0.036], rake: R, gripW: 0.052, gripD: 0.074, trigger: [-0.060, -0.126] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.16);
    // WHERE THE HANDS GO (systems/gunhands.js reads these; model space,
    // barrel along -Z, +X = the gun's right flank).
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.022, -0.580),   // under the ribbed handguard
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.045, z: -0.580, w: 0.096, h: 0.096, rc: 0.048, len: 0.32 },
      mag: new THREE.Vector3(0, -0.220, -0.290),       // magwell / mag body
      charge: new THREE.Vector3(0, 0.076, 0.058),      // charging-handle latch
      style: "mag",
    };
    return g;
  };
})();
