/* ============================================================
   weapons/appearances/rifles.js — the service rifles that are not their
   weapon row's own model: the L85A3, the Tavor, the QBZ-95 and the black
   AK-74M / AK-12 / AK-203.

   A rifle a country issues (battle/core/countries.js `rifle`) is two things:
   the ROW that fires it (weapons/weapon-data.js: "carbine" is the 5.56 /
   5.8 class, "ak47" the AK class: ballistics, magazine, recoil) and the
   MODEL a man holds. Three armies' rifles are bullpups and look nothing like
   an M4: the action and magazine BEHIND the grip, the butt straight off the
   receiver, a short gun with a long barrel. So each is its own model here,
   and a man carries it as a LOOK on his row (actor.weaponLook, read by
   systems/actorweapons.js): the row stays "carbine", the hand holds a Tavor.

   CBZ.WEAPON_LOOKS[id] = { label, base, real: { len, ref } }: the real
   overall length sizes the model (weapons/weapon-scale.js weaponLookScale),
   the base row is the one it fires as.

   Built on CBZ.gunKit (sidearm.js), the same contract every appearance
   honours: side profiles in [forward, up] model units (forward = -z), the
   firing hand's grip spec, userData.grips for the off hand, the anchors.
   All four are drawn at k = 1.8 model units per real metre (the M4's).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.WEAPON_LOOKS = Object.assign(CBZ.WEAPON_LOOKS || {}, {
    l85: { label: "L85A3", base: "carbine", real: { len: 0.785, ref: "L85A2/A3: 785 mm OAL (MoD)" } },
    tavor: { label: "TAVOR X95", base: "carbine", real: { len: 0.720, ref: "IWI TAR-21: 720 mm OAL (IWI)" } },
    qbz95: { label: "QBZ-95", base: "carbine", real: { len: 0.745, ref: "QBZ-95: 745 mm OAL (Norinco)" } },
    ak74m: { label: "AK-74M", base: "ak47", real: { len: 0.943, ref: "AK-74M, stock extended: 943 mm OAL (Kalashnikov Concern)" } },
  });

  // a finish this file needs that the kit's table does not carry, cached on
  // the caller's material table the way the kit caches its own
  function own(ctx, key, hex, shin, spec) {
    const k = "rf_" + key, M = ctx.mat;
    if (M[k]) return M[k];
    const THREE = ctx.THREE;
    const m = shin ? new THREE.MeshPhongMaterial({ color: hex, shininess: shin, specular: spec || 0x222222 })
      : new THREE.MeshLambertMaterial({ color: hex });
    m._shared = true;
    M[k] = m;
    return m;
  }
  function gripCentre(ff, fy, depth, rake, t) {
    const s = Math.sin(rake), c = Math.cos(rake);
    return [0, fy + s * depth / 2 - c * t, -(ff - c * depth / 2 - s * t)];
  }
  function triggerBlade(fFace, y, top) {
    return [[fFace - 0.009, top], [fFace - 0.001, top], [fFace, y + 0.010], [fFace + 0.001, y],
      [fFace + 0.004, y - 0.012], [fFace + 0.010, y - 0.020], [fFace + 0.006, y - 0.023],
      [fFace - 0.004, y - 0.013], [fFace - 0.008, y], [fFace - 0.010, y + 0.012]];
  }
  // a 30-round STANAG body behind the grip: front edge at f0, top at y0
  function stanag(K, g, key, f0, y0, material, curve) {
    const mf = [], mb = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, y = y0 - t * 0.290, sweep = (curve || 0.030) * t * t;
      mf.push([f0 + sweep, y]);
      mb.push([f0 - 0.116 + sweep * 1.15, y]);
    }
    K.tag(K.prof(g, key, mf.concat(mb.reverse()), 0.046, material, { bevel: 0.003 }), "part_mag");
    const c = curve || 0.030, yb = y0 - 0.290;
    K.tag(K.prof(g, key + ".floor", [[f0 - 0.122 + c * 1.15, yb + 0.004], [f0 + 0.008 + c, yb + 0.004], [f0 + 0.012 + c, yb - 0.008],
      [f0 + 0.004 + c, yb - 0.020], [f0 - 0.118 + c * 1.15, yb - 0.022], [f0 - 0.128 + c * 1.15, yb - 0.010]],
      0.054, material, { bevel: 0.003 }), "part_mag");
  }
  function birdcage(K, g, key, f0, len, bore, material) {
    K.lathe(g, key, [[0.014, f0], [0.019, f0 + 0.004], [0.020, f0 + 0.012], [0.020, f0 + len - 0.008], [0.018, f0 + len - 0.002],
      [0.013, f0 + len], [0.010, f0 + len]], 14, material, 0, bore, 0);
  }
  // the bullpup's full-hand trigger guard: a bar from the grip's heel
  // forward and up into the handguard
  function handGuard(K, g, key, ff, fy, len, rake, fFront, yFront, material) {
    const s = Math.sin(rake), c = Math.cos(rake);
    const hx = ff - s * len - 0.018, hy = fy - c * len;           // the grip's heel
    const P = [
      [hx - 0.012, hy + 0.012], [hx + 0.020, hy - 0.020], [hx + 0.140, hy - 0.012], [fFront - 0.030, (hy + yFront) / 2 - 0.030],
      [fFront + 0.012, yFront + 0.004], [fFront - 0.024, yFront + 0.004], [fFront - 0.064, (hy + yFront) / 2 - 0.006],
      [hx + 0.130, hy + 0.012], [hx + 0.030, hy + 0.012],
    ];
    K.prof(g, key, P, 0.044, material, { bevel: 0.006 });
  }

  /* ---------------------------------------------------------- L85A3
     The British Army's SA80: a long pressed-steel receiver box that IS the
     butt at its rear, the STANAG magazine behind the pistol grip, a black
     handguard round the barrel's root, the Picatinny top rail and the
     Trijicon ACOG on it, the cocking handle running in its slot down the
     right flank. 785 mm, 518 mm of it barrel. */
  CBZ.weaponAppearance.l85 = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();
    const BORE = 0.028;
    // the receiver box, its rear the butt: the heel drops away under the cheek
    K.prof(g, "l85.body", [[-0.506, 0.066], [0.560, 0.066], [0.560, 0.026], [0.180, 0.026], [0.180, -0.046],
      [-0.290, -0.046], [-0.450, -0.162], [-0.506, -0.168]], 0.064, steel, { bevel: 0.006 });
    K.prof(g, "l85.pad", [[-0.504, 0.062], [-0.528, 0.060], [-0.534, 0.044], [-0.534, -0.156], [-0.528, -0.170], [-0.504, -0.166]],
      0.068, K.fin("rubber"), { bevel: 0.004 });
    // the cheek piece over the butt
    K.prof(g, "l85.cheek", [[-0.500, 0.064], [-0.250, 0.064], [-0.270, 0.080], [-0.480, 0.082]], 0.050, poly, { bevel: 0.004 });
    // handguard round the barrel's root
    K.prof(g, "l85.hg", [[0.180, 0.030], [0.570, 0.030], [0.586, 0.004], [0.576, -0.058], [0.200, -0.074], [0.180, -0.058]],
      0.074, poly, { bevel: 0.008 });
    // the right flank: ejection port, the cocking-handle slot and its handle
    box(g, 0.004, 0.034, 0.120, mat.black, 0.032, 0.012, 0.160);
    box(g, 0.004, 0.010, 0.420, mat.black, 0.032, 0.040, 0.100);
    K.tag(cyl(g, 0.009, 0.034, blued, 0.046, 0.040, 0.080, 0, 0, Math.PI / 2), "part_charge");
    // pistol grip, the big guard, the trigger
    const R = 22 * Math.PI / 180;
    K.prof(g, "l85.grip", K.grip(0.074, -0.046, 0.072, 0.168, R, { swellF: 0.008, swellB: 0.004 }), 0.052, poly, { bevel: 0.005 });
    K.prof(g, "l85.guard", [[0.074, -0.046], [0.212, -0.046], [0.206, -0.066], [0.176, -0.128], [0.070, -0.132]], 0.030, poly,
      { bevel: 0.003, holes: [[[0.090, -0.058], [0.190, -0.058], [0.166, -0.116], [0.090, -0.120]]] });
    K.prof(g, "l85.trig", triggerBlade(0.134, -0.068, -0.048), 0.010, mat.black, { bevel: 0.001 });
    // the magazine BEHIND the grip
    stanag(K, g, "l85.mag", -0.040, -0.040, mat.dark, 0.020);
    // top rail, barrel, gas block, birdcage
    K.prof(g, "l85.rail", K.rail(-0.300, 0.540, 0.066, 0.010, 0.009), 0.050, mat.black, { bevel: 0.0015 });
    K.tube(g, 0.016, 0.017, 0.270, 12, blued, 0, BORE, -0.705);
    K.prof(g, "l85.gas", [[0.590, -0.012], [0.640, -0.012], [0.640, 0.046], [0.590, 0.046]], 0.040, steel, { bevel: 0.003 });
    birdcage(K, g, "l85.fh", 0.836, 0.064, BORE, mat.black);
    const bore = cyl(g, 0.010, 0.008, mat.bore || mat.black, 0, BORE, -0.898, Math.PI / 2);
    bore.userData.weaponBore = true;
    // TRIJICON ACOG (TA31) on its mount
    const opt = new THREE.Group();
    opt.name = "_baseOptic";
    g.add(opt);
    const WY = 0.141;
    K.prof(opt, "acog.mount", [[-0.060, 0.076], [0.090, 0.076], [0.080, 0.112], [-0.050, 0.112]], 0.044, mat.black, { bevel: 0.003 });
    K.lathe(opt, "acog.body", [[0.026, -0.120], [0.030, -0.112], [0.030, -0.070], [0.026, -0.060], [0.026, 0.060], [0.034, 0.080],
      [0.038, 0.090], [0.038, 0.136], [0.034, 0.140], [0, 0.140]], 18, mat.black, 0, WY, 0);
    box(opt, 0.026, 0.022, 0.030, mat.black, 0, WY + 0.034, -0.010);           // the elevation turret
    box(opt, 0.022, 0.026, 0.030, mat.black, 0.034, WY, -0.010);               // windage
    const glass = K.fin("lens");
    cyl(opt, 0.024, 0.002, glass, 0, WY, 0.120, Math.PI / 2);
    cyl(opt, 0.032, 0.002, glass, 0, WY, -0.141, Math.PI / 2);
    K.opticAnchors(opt, { type: "scope", mag: 4, rear: [0, WY, 0.121], front: [0, WY, -0.140], lensR: 0.022, eyeRelief: 0.038, k: 1.8 });

    K.hand(g, { at: [-0.036, -0.037], rake: R, gripW: 0.052, gripD: 0.072, trigger: [-0.068, -0.128] });
    g.userData.muzzle = new THREE.Vector3(0, BORE, -0.900);
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.040, -0.400),
      hold: { kind: "guard", y: -0.020, z: -0.400, w: 0.074, h: 0.104, rc: 0.030, len: 0.34 },
      mag: new THREE.Vector3(0, -0.190, 0.100),
      charge: new THREE.Vector3(0.046, 0.040, 0.080),
      style: "mag",
    };
    K.anchors(g, {
      k: 1.8,
      grip: { pos: gripCentre(0.074, -0.046, 0.072, R, 0.075), rake: R },
      trigger: [0, -0.068, -0.135],
      support: { pos: [0, -0.024, -0.400], kind: "guard", len: 0.34 },
      mag: { pos: [0, -0.180, 0.100], well: [0, -0.044, 0.098] },
      stock: [0, -0.052, 0.533],
      charge: [0.046, 0.040, 0.080],
      optic: { type: "scope", mag: 4 },
    });
    return g;
  };

  /* ---------------------------------------------------------- TAVOR
     IWI's TAR-21 / X95 line: one rounded polymer shell from butt to nose,
     the trigger guard a bar that runs from the grip's heel into the
     handguard so the whole hand is inside it, the magazine behind the grip,
     the short top rail with the Meprolight reflex sight on it. 720 mm. */
  CBZ.weaponAppearance.tavor = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const blued = K.fin("blued"), poly = K.fin("polymer");
    const shell = own(ctx, "tavorShell", 0x202224, 0);
    const g = new THREE.Group();
    const BORE = 0.034;
    K.prof(g, "tav.shell", [[-0.470, 0.072], [0.380, 0.072], [0.440, 0.060], [0.530, 0.034], [0.536, -0.024], [0.500, -0.056],
      [0.290, -0.066], [0.200, -0.052], [-0.250, -0.052], [-0.400, -0.130], [-0.470, -0.136]], 0.070, shell, { bevel: 0.012 });
    K.prof(g, "tav.pad", [[-0.468, 0.068], [-0.490, 0.064], [-0.495, 0.048], [-0.495, -0.124], [-0.490, -0.134], [-0.468, -0.134]],
      0.072, K.fin("rubber"), { bevel: 0.004 });
    // the right flank's ejection port and the charging handle forward on the left
    box(g, 0.004, 0.036, 0.120, mat.black, 0.036, 0.010, 0.190);
    K.tag(cyl(g, 0.009, 0.036, blued, -0.048, 0.040, -0.300, 0, 0, Math.PI / 2), "part_charge");
    const R = 18 * Math.PI / 180;
    K.prof(g, "tav.grip", K.grip(0.074, -0.052, 0.072, 0.162, R, { swellF: 0.008, swellB: 0.006 }), 0.054, poly, { bevel: 0.006 });
    handGuard(K, g, "tav.guard", 0.074, -0.052, 0.162, R, 0.300, -0.064, shell);
    K.prof(g, "tav.trig", triggerBlade(0.118, -0.074, -0.054), 0.010, mat.black, { bevel: 0.001 });
    stanag(K, g, "tav.mag", -0.058, -0.046, mat.dark, 0.018);
    K.prof(g, "tav.rail", K.rail(-0.040, 0.380, 0.072, 0.008, 0.008), 0.044, mat.black, { bevel: 0.0015 });
    K.tube(g, 0.016, 0.017, 0.270, 12, blued, 0, BORE, -0.670);
    birdcage(K, g, "tav.fh", 0.792, 0.034, BORE, mat.black);
    const bore = cyl(g, 0.010, 0.008, mat.bore || mat.black, 0, BORE, -0.826, Math.PI / 2);
    bore.userData.weaponBore = true;
    // MEPROLIGHT reflex sight: a rounded housing round one window
    const opt = new THREE.Group();
    opt.name = "_baseOptic";
    opt.position.set(0, 0, -0.200);
    g.add(opt);
    const WY = 0.132;
    K.prof(opt, "mepro.base", [[-0.050, 0.086], [0.050, 0.086], [0.044, 0.104], [-0.046, 0.104]], 0.040, mat.black, { bevel: 0.003 });
    const ring = K.arc(0, 0, 0.034, 0, Math.PI * 2, 24).slice(0, 24);
    K.prof(opt, "mepro.hood", ring.map(function (p) { return [p[0], p[1] + WY]; }), 0.070, mat.black,
      { axis: "z", bevel: 0.003, holes: [K.arc(0, WY, 0.025, 0, Math.PI * 2, 24).slice(0, 24).reverse()] });
    const glass = own(ctx, "reflexGlass", 0x7fa0a8, 90, 0xd8ecff);
    box(opt, 0.046, 0.046, 0.002, glass, 0, WY, -0.030);
    K.opticAnchors(opt, { type: "reddot", mag: 1, rear: [0, WY, 0.035], front: [0, WY, -0.035], lensR: 0.024, k: 1.8 });

    K.hand(g, { at: [-0.042, -0.037], rake: R, gripW: 0.054, gripD: 0.072, trigger: [-0.074, -0.112] });
    g.userData.muzzle = new THREE.Vector3(0, BORE, -0.828);
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.044, -0.420),
      hold: { kind: "guard", y: -0.010, z: -0.420, w: 0.070, h: 0.096, rc: 0.034, len: 0.22 },
      mag: new THREE.Vector3(0, -0.190, 0.118),
      charge: new THREE.Vector3(-0.048, 0.040, -0.300),
      style: "mag",
    };
    K.anchors(g, {
      k: 1.8,
      grip: { pos: gripCentre(0.074, -0.052, 0.072, R, 0.072), rake: R },
      trigger: [0, -0.074, -0.118],
      support: { pos: [0, -0.020, -0.420], kind: "guard", len: 0.22 },
      mag: { pos: [0, -0.180, 0.118], well: [0, -0.050, 0.116] },
      stock: [0, -0.034, 0.494],
      charge: [-0.048, 0.040, -0.300],
      optic: { type: "reddot", mag: 1 },
    });
    return g;
  };

  /* ---------------------------------------------------------- QBZ-95
     The PLA's Type 95: a bullpup whose top is a long CARRY HANDLE with the
     sights in it, the magazine behind the full-hand trigger guard, a short
     ribbed handguard and the barrel's bayonet lug. 745 mm. */
  CBZ.weaponAppearance.qbz95 = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();
    const BORE = 0.026;
    K.prof(g, "qbz.shell", [[-0.520, 0.050], [0.360, 0.050], [0.424, 0.030], [0.424, -0.040], [0.300, -0.062], [0.200, -0.050],
      [-0.280, -0.050], [-0.440, -0.124], [-0.520, -0.130]], 0.064, poly, { bevel: 0.009 });
    K.prof(g, "qbz.pad", [[-0.518, 0.046], [-0.540, 0.044], [-0.545, 0.030], [-0.545, -0.120], [-0.540, -0.130], [-0.518, -0.128]],
      0.066, K.fin("rubber"), { bevel: 0.004 });
    // the carry handle, the sights riding its top
    K.prof(g, "qbz.handle", [[-0.170, 0.050], [0.340, 0.050], [0.340, 0.100], [0.290, 0.156], [-0.110, 0.156], [-0.170, 0.122]], 0.034, poly,
      { bevel: 0.004, holes: [[[-0.100, 0.068], [0.240, 0.068], [0.274, 0.100], [0.244, 0.136], [-0.084, 0.136]]] });
    K.prof(g, "qbz.rear", [[-0.110, 0.154], [-0.070, 0.154], [-0.072, 0.176], [-0.106, 0.176]], 0.020, mat.black,
      { bevel: 0.002, holes: [[[-0.096, 0.162], [-0.084, 0.162], [-0.084, 0.170], [-0.096, 0.170]]] });
    K.prof(g, "qbz.post", [[0.276, 0.150], [0.290, 0.150], [0.287, 0.176], [0.279, 0.176]], 0.008, mat.black, { bevel: 0.001 });
    K.tag(cyl(g, 0.008, 0.026, blued, 0.018, 0.066, -0.020, 0, 0, Math.PI / 2), "part_charge");
    box(g, 0.004, 0.034, 0.110, mat.black, 0.033, 0.006, 0.190);
    const R = 20 * Math.PI / 180;
    K.prof(g, "qbz.grip", K.grip(0.074, -0.050, 0.072, 0.162, R, { swellF: 0.008, swellB: 0.005 }), 0.052, poly, { bevel: 0.006 });
    handGuard(K, g, "qbz.guard", 0.074, -0.050, 0.162, R, 0.290, -0.060, poly);
    K.prof(g, "qbz.trig", triggerBlade(0.120, -0.072, -0.052), 0.010, mat.black, { bevel: 0.001 });
    stanag(K, g, "qbz.mag", -0.068, -0.044, mat.dark, 0.040);
    // ribs across the handguard
    for (let i = 0; i < 5; i++) box(g, 0.066, 0.004, 0.010, mat.black, 0, -0.010 - i * 0.008, -0.320 - i * 0.012);
    K.tube(g, 0.015, 0.017, 0.356, 12, blued, 0, BORE, -0.602);
    K.prof(g, "qbz.lug", [[0.470, -0.020], [0.530, -0.020], [0.530, 0.010], [0.470, 0.010]], 0.024, steel, { bevel: 0.002 });
    birdcage(K, g, "qbz.fh", 0.780, 0.040, BORE, mat.black);
    const bore = cyl(g, 0.009, 0.008, mat.bore || mat.black, 0, BORE, -0.820, Math.PI / 2);
    bore.userData.weaponBore = true;

    K.hand(g, { at: [-0.040, -0.037], rake: R, gripW: 0.052, gripD: 0.072, trigger: [-0.072, -0.114] });
    g.userData.muzzle = new THREE.Vector3(0, BORE, -0.822);
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.044, -0.360),
      hold: { kind: "guard", y: -0.010, z: -0.360, w: 0.064, h: 0.092, rc: 0.030, len: 0.18 },
      mag: new THREE.Vector3(0, -0.190, 0.128),
      charge: new THREE.Vector3(0.018, 0.066, -0.020),
      style: "mag",
    };
    K.anchors(g, {
      k: 1.8,
      grip: { pos: gripCentre(0.074, -0.050, 0.072, R, 0.072), rake: R },
      trigger: [0, -0.072, -0.120],
      support: { pos: [0, -0.020, -0.360], kind: "guard", len: 0.18 },
      mag: { pos: [0, -0.180, 0.128], well: [0, -0.048, 0.126] },
      stock: [0, -0.040, 0.544],
      charge: [0.018, 0.066, -0.020],
      sight: { rear: [0, 0.166, 0.090], front: [0, 0.176, -0.283], eyeRelief: 0.08, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };

  /* ---------------------------------------------------------- AK-74M
     The Kalashnikov in its modern dress (the AK-74M, and the AK-12 and
     AK-203 that keep its lines): the same receiver, sights and gas system as
     the AK-47 model, in black polymer furniture where the AK-47 has red
     wood, and the 5.45 magazine in its plum polymer. */
  CBZ.weaponAppearance.ak74m = function (ctx) {
    const base = CBZ.weaponAppearance.ak47;
    if (!base) return null;
    const g = base(ctx);
    const K = CBZ.gunKit(ctx);
    const wood = K.fin("akWood"), poly = K.fin("polymer");
    const plum = own(ctx, "ak74Plum", 0x5a2a22, 8, 0x1a0c0a);
    g.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.material === wood) o.material = poly;
      else if (o.name === "part_mag") o.material = plum;
    });
    return g;
  };
})();
