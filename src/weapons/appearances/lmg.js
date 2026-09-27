/* ============================================================
   weapons/appearances/lmg.js — the M249 SAW.

   An M249 reads as a belt-fed gun because of: a long box receiver with a
   hinged feed-tray cover on top, a 100-round ammo box hanging under it and
   a brass belt climbing the LEFT side into the feed tray (the M249 feeds
   from the left — also the flank the first-person camera sees), a heavy
   barrel under a ribbed heat shield with the carry handle on the barrel,
   the gas cylinder and ribbed handguard beneath, a bipod folded forward
   under the barrel, a tall front sight post, and the M145 machine-gun optic
   weapon-data gives it (a child named "_baseOptic", so a gunsmith scope
   replaces it). Built on CBZ.gunKit (sidearm.js).

   Bipod contract (entities/character.js, tools/visual-presets/weapon-holds):
   userData.bipod.hinges/feet are the DEPLOYED leg geometry, unchanged.
   The legs themselves are drawn folded; userData.bipod.setDeployed(k) swings
   them (0 = folded, 1 = planted on those feet) for whoever owns the prone
   pose to call.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.lmg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();
    const BORE = 0.045;

    // RECEIVER + FEED-TRAY COVER with its rail
    K.prof(g, "saw.recv", [[-0.050, -0.056], [0.420, -0.056], [0.420, 0.080], [0.020, 0.080], [-0.050, 0.060]],
      0.086, steel, { bevel: 0.005 });
    K.prof(g, "saw.cover", [[0.010, 0.074], [0.380, 0.074], [0.380, 0.100], [0.350, 0.110], [0.030, 0.110], [0.010, 0.098]],
      0.092, blued, { bevel: 0.005 });
    K.prof(g, "saw.rail", K.rail(0.060, 0.340, 0.108, 0.008, 0.008), 0.054, mat.black, { bevel: 0.0015 });
    box(g, 0.040, 0.030, 0.050, steel, 0.058, 0.004, -0.350);            // charging handle, right
    // TRIGGER GUARD + trigger, pistol grip
    K.prof(g, "saw.guard", [[0.090, -0.050], [0.250, -0.050], [0.250, -0.066], [0.232, -0.122], [0.112, -0.122], [0.094, -0.070]],
      0.044, steel, { bevel: 0.003, holes: [[[0.224, -0.064], [0.218, -0.110], [0.124, -0.110], [0.108, -0.066]]] });
    box(g, 0.010, 0.044, 0.010, mat.black, 0, -0.080, -0.160, -0.25);
    const R = 20 * Math.PI / 180;
    K.prof(g, "saw.grip", K.grip(0.092, -0.050, 0.080, 0.176, R, { swellF: 0.008, swellB: 0.004 }), 0.056, poly, { bevel: 0.005 });

    // AMMO BOX under the receiver + the brass BELT up the left side
    K.prof(g, "saw.box", [[0.140, -0.058], [0.340, -0.058], [0.346, -0.230], [0.330, -0.244], [0.150, -0.244], [0.134, -0.230]],
      0.110, poly, { bevel: 0.006, x: -0.012 });
    box(g, 0.116, 0.014, 0.206, mat.black, -0.012, -0.066, -0.240);      // lid seam
    const rounds = [];
    for (let i = 0; i < 7; i++) {
      const y = -0.070 + i * 0.020;
      rounds.push([[0.208, y], [0.262, y], [0.290, y + 0.008], [0.262, y + 0.016], [0.208, y + 0.016]]);
    }
    K.prof(g, "saw.belt", rounds, 0.020, mat.brass, { bevel: 0.002, x: -0.058 });
    box(g, 0.008, 0.144, 0.024, mat.black, -0.056, -0.008, -0.228);      // the links

    // HEAT SHIELD over the heavy barrel, gas cylinder + ribbed handguard under
    K.tube(g, 0.021, 0.022, 0.740, 14, blued, 0, BORE, -0.790);
    const shield = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI, r = i % 2 ? 0.034 : 0.038;
      shield.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 12; i >= 0; i--) {
      const a = (i / 12) * Math.PI;
      shield.push([Math.cos(a) * 0.026, Math.sin(a) * 0.026]);
    }
    K.prof(g, "saw.shield", shield, 0.240, steel, { axis: "z", bevel: 0.002, y: BORE, z: -0.545 });
    K.tube(g, 0.017, 0.017, 0.380, 12, steel, 0, -0.012, -0.610);        // gas cylinder
    const hg = [[0.400, 0.004], [0.620, 0.004], [0.630, -0.020]];
    for (let i = 0; i < 7; i++) {
      const f = 0.620 - i * 0.030;
      hg.push([f, -0.062], [f - 0.015, -0.062], [f - 0.015, -0.070], [f - 0.030, -0.070]);
    }
    hg.push([0.400, -0.066]);
    K.prof(g, "saw.hg", hg, 0.080, poly, { bevel: 0.004 });
    // CARRY HANDLE on the barrel
    K.prof(g, "saw.handle", [[0.470, 0.070], [0.500, 0.150], [0.640, 0.150], [0.660, 0.070]], 0.022, poly,
      { bevel: 0.004, holes: [[[0.500, 0.084], [0.520, 0.132], [0.620, 0.132], [0.636, 0.084]]] });
    // gas block / bipod yoke, tall front sight, flash hider, open bore
    box(g, 0.070, 0.070, 0.050, steel, 0, 0.002, -0.810);
    K.prof(g, "saw.fsight", [[0.990, 0.030], [1.036, 0.030], [1.036, 0.070], [1.022, 0.074], [1.018, 0.140], [1.008, 0.140], [1.004, 0.074], [0.990, 0.070]],
      0.030, steel, { bevel: 0.003 });
    K.tube(g, 0.025, 0.025, 0.080, 8, mat.black, 0, BORE, -1.160);
    const bore = cyl(g, 0.014, 0.006, mat.bore || mat.black, 0, BORE, -1.201, Math.PI / 2);
    bore.userData.weaponBore = true;

    // BIPOD: legs pivot at the yoke. Drawn folded forward under the barrel.
    const hingeL = new THREE.Vector3(-0.042, -0.020, -0.805);
    const hingeR = new THREE.Vector3(0.042, -0.020, -0.805);
    const footL = new THREE.Vector3(-0.165, -0.285, -1.015);
    const footR = new THREE.Vector3(0.165, -0.285, -1.015);
    const Y = new THREE.Vector3(0, 1, 0);
    const legs = [[hingeL, footL, -1], [hingeR, footR, 1]].map(function (d) {
      const leg = new THREE.Group();
      leg.position.copy(d[0]);
      g.add(leg);
      const len = d[1].distanceTo(d[0]);
      cyl(leg, 0.011, len, steel, 0, len / 2, 0);
      box(leg, 0.030, 0.020, 0.030, mat.black, 0, len, 0);
      const out = new THREE.Vector3().subVectors(d[1], d[0]).normalize();
      const fold = new THREE.Vector3(-d[2] * 0.012, -0.050, -1).normalize();
      leg.userData.qFold = new THREE.Quaternion().setFromUnitVectors(Y, fold);
      leg.userData.qOut = new THREE.Quaternion().setFromUnitVectors(Y, out);
      leg.quaternion.copy(leg.userData.qFold);
      return leg;
    });
    g.userData.bipod = {
      attached: true, functional: true,
      hinges: [hingeL.clone(), hingeR.clone()], feet: [footL.clone(), footR.clone()],
      deployed: 0,
      setDeployed: function (k) {
        k = k < 0 ? 0 : k > 1 ? 1 : k;
        this.deployed = k;
        legs.forEach(function (leg) { leg.quaternion.copy(leg.userData.qFold).slerp(leg.userData.qOut, k); });
      },
    };

    // M145 MACHINE GUN OPTIC on the cover rail
    const mgo = new THREE.Group();
    mgo.name = "_baseOptic";
    mgo.position.set(0, 0, -0.200);
    g.add(mgo);
    box(mgo, 0.050, 0.030, 0.090, steel, 0, 0.130, 0);
    K.tube(mgo, 0.028, 0.028, 0.150, 14, mat.black, 0, 0.170, 0);
    K.tube(mgo, 0.036, 0.030, 0.050, 14, mat.black, 0, 0.170, -0.090);
    K.tube(mgo, 0.030, 0.032, 0.036, 14, mat.black, 0, 0.170, 0.090);
    box(mgo, 0.012, 0.022, 0.030, mat.black, 0, 0.206, -0.020);          // backup iron on top
    cyl(mgo, 0.026, 0.004, K.fin("lens"), 0, 0.170, 0.109, Math.PI / 2);

    // FIXED STOCK + rubber buttplate
    K.prof(g, "saw.stock", [
      [-0.046, 0.070], [-0.400, 0.056], [-0.420, 0.046], [-0.420, -0.118], [-0.380, -0.124],
      [-0.160, -0.040], [-0.060, -0.046], [-0.046, -0.050],
    ], 0.066, poly, { bevel: 0.006 });
    box(g, 0.072, 0.176, 0.020, K.fin("rubber"), 0, -0.034, 0.428);

    // the firing hand on the grip
    K.hand(g, { at: [-0.052, -0.052], rake: R, gripW: 0.056, gripD: 0.080, size: 0.86, trigger: [-0.084, -0.156] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.204);
    // WHERE THE HANDS GO — see systems/gunhands.js. A belt gun is reloaded
    // through the feed cover and the ammo box, not a magwell.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.090, -0.520),   // under the ribbed handguard
      mag: new THREE.Vector3(-0.012, -0.070, -0.240),  // ammo-box lid
      charge: new THREE.Vector3(0, 0.112, -0.030),     // feed-tray cover latch
      style: "belt",
    };
    return g;
  };
})();
