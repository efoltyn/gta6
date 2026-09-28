/* ============================================================
   weapons/appearances/carbine.js — the M4 carbine (flat-top, EOTech holo).

   What makes it an M4 and not "a black rifle": the flat-top upper with a
   toothed Picatinny rail, the tall triangular A2 front sight tower out on
   the barrel with its square post, the round ribbed two-piece handguard
   between the delta ring and the cap, the dust cover, brass deflector and
   forward assist on the right flank, the T charging handle at the back of
   the rail, the buffer tube carrying the telescoping stock, a near-straight
   30-round STANAG mag and the A2 pistol grip with its finger nub.

   THE SIGHT (weapon-data optic "dot"): an EOTech EXPS3 holographic sight —
   the hood with its trapezoid window box (a front and a rear window of
   coated glass, the 65 MOA ring + dot reticle floating in it), the lower
   body with the transverse battery cap on the right and the up/down/NV
   buttons on the left flank, the QD throw lever on its rail clamp. The
   window sits at ABSOLUTE CO-WITNESS: the A2 post tip lies dead centre in
   it. A folded MBUS rear sight rides behind it. The holo is the child named
   "_baseOptic" (a gunsmith scope hides it) and stamps its own anchors.

   Real proportions (M4A1: 838 mm stock extended) at k = 1.8.
   Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  // coated see-through window glass, cached on the caller's material table
  function windowGlass(ctx, hex) {
    const key = "gk_glass_" + hex.toString(16);
    if (!ctx.mat[key]) {
      const m = new ctx.THREE.MeshPhongMaterial({ color: hex, specular: 0xd8ecff, shininess: 110, transparent: true,
        opacity: 0.26, depthWrite: false, side: ctx.THREE.DoubleSide });
      m._shared = true;
      ctx.mat[key] = m;
    }
    return ctx.mat[key];
  }
  // a curved trigger blade whose FRONT face sits at forward fFace, height y
  function triggerBlade(fFace, y, top) {
    return [[fFace - 0.009, top], [fFace - 0.001, top], [fFace, y + 0.010], [fFace + 0.001, y],
      [fFace + 0.004, y - 0.012], [fFace + 0.010, y - 0.020], [fFace + 0.006, y - 0.023],
      [fFace - 0.004, y - 0.013], [fFace - 0.008, y], [fFace - 0.010, y + 0.012]];
  }
  // the firing hand's centre, `t` down the kit grip outline's axis, mid-depth
  function gripCentre(ff, fy, depth, rake, t) {
    const s = Math.sin(rake), c = Math.cos(rake);
    return [0, fy + s * depth / 2 - c * t, -(ff - c * depth / 2 - s * t)];
  }

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
    // right flank: hinged dust cover over the port, brass deflector hump,
    // forward assist (a turned plunger housing, button at the back)
    K.prof(g, "m4.dust", [[0.084, 0.024], [0.196, 0.024], [0.196, 0.056], [0.092, 0.056], [0.084, 0.050]],
      0.004, mat.dark, { bevel: 0.001, x: 0.031 });
    K.prof(g, "m4.defl", [[0.014, 0.046], [0.052, 0.046], [0.052, 0.058], [0.030, 0.080], [0.014, 0.080]],
      0.012, parker, { bevel: 0.002, x: 0.032 });
    K.lathe(g, "m4.fa", [[0, -0.036], [0.009, -0.036], [0.010, -0.030], [0.012, -0.028], [0.013, -0.018],
      [0.013, 0.010], [0.010, 0.022], [0, 0.024]], 12, blued, 0.037, 0.050, 0.000);
    // T charging handle + latch at the back of the rail
    K.prof(g, "m4.ch", [[-0.072, 0.070], [-0.044, 0.070], [-0.044, 0.080], [-0.050, 0.086], [-0.068, 0.086], [-0.072, 0.080]],
      0.072, mat.black, { bevel: 0.002 });

    // LOWER: flared magwell, trigger guard hole, buffer-tube housing
    K.prof(g, "m4.lower", [
      [-0.072, 0.006], [0.354, 0.006], [0.354, -0.022], [0.346, -0.096], [0.360, -0.110],
      [0.214, -0.110], [0.210, -0.100], [0.200, -0.104], [0.086, -0.104], [0.070, -0.060],
      [-0.030, -0.052], [-0.072, -0.018],
    ], 0.058, parker, { bevel: 0.004,
      holes: [[[0.192, -0.030], [0.192, -0.092], [0.094, -0.092], [0.084, -0.064], [0.100, -0.030]]] });
    K.prof(g, "m4.trig", triggerBlade(0.134, -0.060, -0.024), 0.010, mat.black, { bevel: 0.001 });
    cyl(g, 0.008, 0.062, blued, 0, -0.030, -0.214, 0, 0, Math.PI / 2);  // mag release / pin
    // A2 pistol grip with its finger nub
    const R = 25 * Math.PI / 180;
    K.prof(g, "m4.grip", K.grip(0.074, -0.050, 0.074, 0.170, R, { swellF: 0.010, swellB: 0.004 }),
      0.052, poly, { bevel: 0.005 });
    // 30-round STANAG: straight body, slight forward sweep at the floor,
    // the flared floorplate following the sweep
    const mf = [], mb = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, y = -0.020 - t * 0.300, sweep = 0.030 * t * t;
      mf.push([0.340 + sweep, y]);
      mb.push([0.224 + sweep * 1.15, y]);
    }
    K.prof(g, "m4.mag", mf.concat(mb.reverse()), 0.046, mat.dark, { bevel: 0.003 });
    K.prof(g, "m4.floor", [[0.250, -0.314], [0.376, -0.312], [0.382, -0.322], [0.374, -0.334], [0.256, -0.336], [0.246, -0.326]],
      0.054, mat.black, { bevel: 0.003 });

    // HANDGUARD: round, ribbed, between the delta ring and the cap
    K.prof(g, "m4.hg", K.ribs(0.048, 0.043, 14), 0.320, poly, { axis: "z", bevel: 0.002, y: BORE, z: -0.580 });
    K.tube(g, 0.054, 0.054, 0.030, 16, parker, 0, BORE, -0.418);        // delta ring
    K.tube(g, 0.040, 0.046, 0.022, 16, parker, 0, BORE, -0.750);        // handguard cap
    // barrel with the M203 step, A2 birdcage (turned, closed bottom), open bore
    K.tube(g, 0.016, 0.018, 0.320, 12, blued, 0, BORE, -0.905);
    K.lathe(g, "m4.birdcage", [[0.015, 1.062], [0.019, 1.066], [0.021, 1.074], [0.021, 1.146], [0.019, 1.156],
      [0.014, 1.160], [0.011, 1.160]], 14, mat.black, 0, BORE, 0);
    const bore = cyl(g, 0.012, 0.008, mat.bore || mat.black, 0, BORE, -1.157, Math.PI / 2);
    bore.userData.weaponBore = true;
    // A2 FRONT SIGHT tower: collar, sloped rear, bayonet lug, winged ears
    // round the square post (its tip is the front sight point)
    K.prof(g, "m4.fsb", [
      [0.768, 0.018], [0.812, 0.018], [0.812, 0.072], [0.804, 0.072], [0.804, 0.138],
      [0.790, 0.138], [0.778, 0.072], [0.768, 0.070],
    ], 0.030, parker, { bevel: 0.003 });
    K.prof(g, "m4.lug", [[0.784, -0.004], [0.808, -0.004], [0.810, 0.020], [0.788, 0.020]], 0.014, parker, { bevel: 0.002 });
    K.prof(g, "m4.ears", [[-0.026, 0], [0.026, 0], [0.026, 0.040], [0.016, 0.040], [0.012, 0.010],
      [-0.012, 0.010], [-0.016, 0.040], [-0.026, 0.040]], 0.018, parker, { axis: "z", bevel: 0.002, y: 0.128, z: -0.800 });
    K.prof(g, "m4.post", [[0.795, 0.130], [0.805, 0.130], [0.803, 0.160], [0.801, 0.167], [0.799, 0.167], [0.797, 0.160]],
      0.006, mat.black, { bevel: 0.0008 });

    // MBUS rear back-up sight, folded flat behind the holo
    K.prof(g, "m4.mbus", [[0.018, 0.098], [0.074, 0.098], [0.074, 0.108], [0.066, 0.114], [0.026, 0.114], [0.018, 0.108]],
      0.046, poly, { bevel: 0.002 });
    K.prof(g, "m4.mbusLeaf", [[0.028, 0.113], [0.070, 0.113], [0.072, 0.119], [0.036, 0.124], [0.028, 0.120]],
      0.036, poly, { bevel: 0.0015 });

    // EOTECH EXPS3 on its QD mount
    const holo = new THREE.Group();
    holo.name = "_baseOptic";
    holo.position.set(0, 0, -0.170);
    g.add(holo);
    const WY = 0.1675;                                                  // window centre = the A2 post tip
    // rail clamp: jaws down both sides of the rail
    K.prof(holo, "exps.clamp", [[-0.031, 0.100], [-0.031, 0.118], [0.031, 0.118], [0.031, 0.100], [0.030, 0.085],
      [0.0285, 0.085], [0.0285, 0.099], [-0.0285, 0.099], [-0.0285, 0.085], [-0.030, 0.085]],
      0.122, parker, { axis: "z", bevel: 0.002 });
    // lower body: the laser/electronics housing, nose sloped
    K.prof(holo, "exps.body", [[-0.078, 0.116], [0.060, 0.116], [0.074, 0.128], [0.074, 0.146], [-0.078, 0.146]],
      0.060, mat.black, { bevel: 0.004 });
    // the hood: trapezoid box round the window, open front and back
    K.prof(holo, "exps.hood", [[-0.037, 0.140], [0.037, 0.140], [0.033, 0.190], [0.028, 0.197], [-0.028, 0.197], [-0.033, 0.190]],
      0.130, mat.black, { axis: "z", bevel: 0.002, z: 0.001,
        holes: [[[-0.028, 0.147], [-0.025, 0.188], [0.025, 0.188], [0.028, 0.147]]] });
    // front + rear windows, coated glass
    const glass = windowGlass(ctx, 0x86b4c6);
    box(holo, 0.052, 0.040, 0.0015, glass, 0, WY, -0.058);
    box(holo, 0.052, 0.040, 0.0015, glass, 0, WY, 0.058);
    // the 65 MOA ring + 1 MOA dot, seen in the front window
    const ring = K.arc(0, 0, 0.0075, 0, Math.PI * 2, 20).slice(0, 20);
    K.prof(holo, "exps.ret", [ring, [[-0.0009, -0.0009], [0.0009, -0.0009], [0.0009, 0.0009], [-0.0009, 0.0009]]],
      0.0008, K.fin("redDot"), { axis: "z", bevel: 0, y: WY, z: -0.0555,
        holes: [K.arc(0, 0, 0.0063, 0, Math.PI * 2, 20).slice(0, 20).reverse()] });
    // transverse CR123 battery cap, knurled, on the right
    K.prof(holo, "exps.cap", K.ribs(0.013, 0.0118, 16).map((p) => [p[0] + 0.020, p[1] + 0.131]), 0.010, mat.black,
      { bevel: 0.001, x: 0.034 });
    // up / down / NV buttons, left flank at the back
    K.prof(holo, "exps.btn", [
      [[-0.074, 0.124], [-0.062, 0.124], [-0.062, 0.140], [-0.074, 0.140]],
      [[-0.058, 0.124], [-0.046, 0.124], [-0.046, 0.140], [-0.058, 0.140]],
      [[-0.040, 0.128], [-0.032, 0.128], [-0.032, 0.138], [-0.040, 0.138]],
    ], 0.008, poly, { bevel: 0.001, x: -0.030 });
    // QD throw lever lying forward along the left of the clamp
    K.prof(holo, "exps.qd", [[-0.052, 0.101], [0.028, 0.104], [0.046, 0.110], [0.042, 0.117], [-0.052, 0.115]],
      0.005, parker, { bevel: 0.001, x: -0.0345 });
    cyl(holo, 0.007, 0.010, blued, -0.036, 0.108, 0.046, 0, 0, Math.PI / 2);
    K.opticAnchors(holo, { type: "holo", mag: 1, rear: [0, WY, 0.058], front: [0, WY, -0.058], lensR: 0.020, eyeRelief: 0.18, k: 1.8 });

    // BUFFER TUBE + six-position stock + rubber pad
    K.tube(g, 0.023, 0.023, 0.270, 16, parker, 0, BORE + 0.004, 0.200);
    K.prof(g, "m4.stock", [
      [-0.128, 0.082], [-0.326, 0.082], [-0.326, -0.100], [-0.302, -0.106], [-0.196, -0.006],
      [-0.150, 0.004], [-0.134, 0.024],
    ], 0.058, poly, { bevel: 0.005 });
    K.prof(g, "m4.pad", [[-0.324, 0.082], [-0.344, 0.080], [-0.348, 0.070], [-0.348, -0.094], [-0.344, -0.104], [-0.324, -0.100]],
      0.062, K.fin("rubber"), { bevel: 0.003 });

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
    // THE ANCHORS (contract: sidearm.js); sight/lens/optic from the holo
    K.anchors(g, {
      k: 1.8,
      grip: { pos: gripCentre(0.074, -0.050, 0.074, R, 0.075), rake: R },
      trigger: [0, -0.060, -0.135],
      support: { pos: [0, BORE, -0.580], kind: "guard", len: 0.32 },
      mag: { pos: [0, -0.170, -0.290], well: [0, -0.030, -0.282] },
      stock: [0, -0.010, 0.348],
      bolt: null,
      charge: [0, 0.078, 0.058],
      optic: { type: "holo", mag: 1 },
    });
    return g;
  };
})();
