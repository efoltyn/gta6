/* ============================================================
   weapons/appearances/lmg.js — the M249 SAW.

   An M249 reads as a belt-fed gun because of: a long box receiver with a
   hinged feed-tray cover on top, a 100-round ammo box hanging under it and
   a brass belt climbing the LEFT side into the feed tray (the M249 feeds
   from the left — also the flank the first-person camera sees), a heavy
   barrel under a ribbed heat shield with the carry handle on the barrel,
   the gas cylinder and ribbed handguard beneath, a bipod folded forward
   under the barrel, a tall front sight post and the folded rear leaf, and
   the M145 machine-gun optic weapon-data gives it: the Elcan's boxy prism
   body with its offset objective/ocular, roof BUIS and BDC drum (a child
   named "_baseOptic", so a gunsmith scope replaces it; it stamps its own
   anchors, 3.4x, 84 mm eye relief). M249: 1041 mm at k = 1.58.
   Built on CBZ.gunKit (sidearm.js).

   Bipod contract (entities/character.js, tools/visual-presets/weapon-holds):
   userData.bipod.hinges/feet are the DEPLOYED leg geometry, unchanged.
   The legs themselves are drawn folded; userData.bipod.setDeployed(k) swings
   them (0 = folded, 1 = planted on those feet) and userData.bipod.drive(on,
   dt) animates toward either end — see the note by DEPLOY_S for who drives.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  // coated see-through glass, cached on the caller's material table
  function sawGlass(ctx, hex) {
    const key = "gk_glass_" + hex.toString(16);
    if (!ctx.mat[key]) {
      const m = new ctx.THREE.MeshPhongMaterial({ color: hex, specular: 0xd8ecff, shininess: 110, transparent: true,
        opacity: 0.34, depthWrite: false, side: ctx.THREE.DoubleSide });
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

  CBZ.weaponAppearance.lmg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();
    const BORE = 0.045;

    // RECEIVER + FEED-TRAY COVER with its rail
    K.prof(g, "saw.recv", [[-0.050, -0.056], [0.420, -0.056], [0.420, 0.080], [0.020, 0.080], [-0.050, 0.060]],
      0.086, steel, { bevel: 0.005 });
    K.tag(K.prof(g, "saw.cover", [[0.010, 0.074], [0.380, 0.074], [0.380, 0.100], [0.350, 0.110], [0.030, 0.110], [0.010, 0.098]],
      0.092, blued, { bevel: 0.005 }), "part_cover");
    K.tag(K.prof(g, "saw.rail", K.rail(0.060, 0.340, 0.108, 0.008, 0.008), 0.054, mat.black, { bevel: 0.0015 }), "part_cover");
    // charging handle out of the right flank (axis-z profiles mirror x)
    K.prof(g, "saw.ch", [[-0.042, -0.008], [-0.066, -0.006], [-0.076, 0.000], [-0.076, 0.010], [-0.068, 0.016], [-0.042, 0.014]],
      0.040, steel, { axis: "z", bevel: 0.003, z: -0.350 });
    // REAR SIGHT: the leaf folded forward on its base at the back of the cover
    K.tag(K.prof(g, "saw.rsBase", [[0.014, 0.100], [0.056, 0.104], [0.056, 0.114], [0.018, 0.114], [0.014, 0.108]],
      0.040, steel, { bevel: 0.002 }), "part_cover");
    K.tag(K.prof(g, "saw.rsLeaf", [[0.020, 0.113], [0.054, 0.113], [0.056, 0.118], [0.024, 0.121]], 0.030, mat.black, { bevel: 0.001 }), "part_cover");
    cyl(g, 0.007, 0.010, mat.black, 0.024, 0.109, -0.030, 0, 0, Math.PI / 2);   // windage knob
    // TRIGGER GUARD + trigger, pistol grip
    K.prof(g, "saw.guard", [[0.090, -0.050], [0.250, -0.050], [0.250, -0.066], [0.232, -0.122], [0.112, -0.122], [0.094, -0.070]],
      0.044, steel, { bevel: 0.003, holes: [[[0.224, -0.064], [0.218, -0.110], [0.124, -0.110], [0.108, -0.066]]] });
    K.prof(g, "saw.trig", triggerBlade(0.157, -0.084, -0.052), 0.010, mat.black, { bevel: 0.001 });
    const R = 20 * Math.PI / 180;
    K.prof(g, "saw.grip", K.grip(0.092, -0.050, 0.080, 0.176, R, { swellF: 0.008, swellB: 0.004 }), 0.056, poly, { bevel: 0.005 });

    // AMMO BOX under the receiver + the brass BELT up the left side
    K.tag(K.prof(g, "saw.box", [[0.140, -0.058], [0.340, -0.058], [0.346, -0.230], [0.330, -0.244], [0.150, -0.244], [0.134, -0.230]],
      0.110, poly, { bevel: 0.006, x: -0.012 }), "part_box");
    K.tag(K.prof(g, "saw.lid", [[0.140, -0.058], [0.340, -0.058], [0.342, -0.072], [0.138, -0.072]], 0.116, mat.black,
      { bevel: 0.002, x: -0.012 }), "part_box");                                      // the lid's lip
    const rounds = [];
    for (let i = 0; i < 7; i++) {
      const y = -0.070 + i * 0.020;
      rounds.push([[0.208, y], [0.262, y], [0.290, y + 0.008], [0.262, y + 0.016], [0.208, y + 0.016]]);
    }
    K.tag(K.prof(g, "saw.belt", rounds, 0.020, mat.brass, { bevel: 0.002, x: -0.0535 }), "part_box");
    // the M27 links: two loops round each round's case
    const links = [];
    for (let i = 0; i < 7; i++) {
      const y = -0.072 + i * 0.020;
      links.push([[0.214, y], [0.228, y], [0.228, y + 0.020], [0.214, y + 0.020]],
        [[0.240, y + 0.002], [0.250, y + 0.002], [0.250, y + 0.018], [0.240, y + 0.018]]);
    }
    K.tag(K.prof(g, "saw.links", links, 0.023, mat.black, { bevel: 0.0008, x: -0.0535 }), "part_box");

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
    K.prof(g, "saw.gasBlock", [[-0.034, -0.034], [0.034, -0.034], [0.034, 0.020], [0.024, 0.034], [-0.024, 0.034], [-0.034, 0.020]],
      0.050, steel, { axis: "z", bevel: 0.004, z: -0.810 });
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
      K.lathe(leg, "saw.foot", [[0, -0.012], [0.013, -0.012], [0.016, 0.002], [0.011, 0.012], [0, 0.013]], 12, mat.black,
        0, len, 0, { axis: "y" });
      const out = new THREE.Vector3().subVectors(d[1], d[0]).normalize();
      const fold = new THREE.Vector3(-d[2] * 0.012, -0.050, -1).normalize();
      leg.userData.qFold = new THREE.Quaternion().setFromUnitVectors(Y, fold);
      leg.userData.qOut = new THREE.Quaternion().setFromUnitVectors(Y, out);
      leg.quaternion.copy(leg.userData.qFold);
      return leg;
    });
    /* setDeployed(k) poses the legs exactly (0 folded .. 1 planted). drive(on,
       dt) is what a holder calls every frame with its OWN notion of
       "supported" — it eases the legs there over DEPLOY_S with a smoothstep,
       so a shooter dropping prone sees them swing down, not snap. Three
       holders call it: fpsmode's viewmodel and the player's third-person gun
       (holsterprops) off fpsmode's bipodActive(), and an armed NPC off its
       posture (actorweapons bipodFromPosture). The ground rest
       (entities/character.js gunGroundRest) measures the model's bounds once
       and caches them on the prop; the legs change those bounds, so every leg
       move drops the cache and the next rest solve measures the FEET. */
    const DEPLOY_S = 0.35;
    g.userData.bipod = {
      attached: true, functional: true,
      hinges: [hingeL.clone(), hingeR.clone()], feet: [footL.clone(), footR.clone()],
      deployed: 0,      // eased leg angle actually drawn, 0..1
      t: 0,             // linear progress the easing is read off
      want: false,
      setDeployed: function (k) {
        k = k < 0 ? 0 : k > 1 ? 1 : k;
        if (k === this.deployed && this._posed) return;
        this._posed = true;
        this.deployed = k;
        legs.forEach(function (leg) { leg.quaternion.copy(leg.userData.qFold).slerp(leg.userData.qOut, k); });
        if (g.userData._restBounds) g.userData._restBounds = null;
      },
      drive: function (on, dt) {
        this.want = !!on;
        const goal = on ? 1 : 0;
        if (this.t === goal && this._posed) return this.deployed;
        const step = Math.max(0, dt || 0) / DEPLOY_S;
        this.t = goal > this.t ? Math.min(goal, this.t + step) : Math.max(goal, this.t - step);
        this.setDeployed(this.t * this.t * (3 - 2 * this.t));
        return this.deployed;
      },
    };

    // M145 MACHINE GUN OPTIC (Elcan Specter 3.4x) on its throw-lever mount:
    // the long boxy prism body with the round objective bell out the front
    // and the ocular + rubber eyecup out the back, both LOW on the body (the
    // offset optical axis; the housing towers over it), the flip-up back-up
    // irons on top, the BDC elevation drum on the left, windage on the right
    const mgo = new THREE.Group();
    mgo.name = "_baseOptic";
    mgo.position.set(0, 0, -0.200);
    g.add(mgo);
    const AXY = 0.178;
    K.prof(mgo, "mgo.clamp", [[-0.031, 0.110], [-0.0285, 0.110], [-0.0285, 0.124], [0.0285, 0.124], [0.0285, 0.110], [0.031, 0.110],
      [0.032, 0.126], [0.030, 0.141], [-0.030, 0.141], [-0.032, 0.126]], 0.120, steel, { axis: "z", bevel: 0.002 });
    K.prof(mgo, "mgo.levers", [
      [[-0.052, 0.113], [-0.012, 0.116], [-0.004, 0.124], [-0.012, 0.131], [-0.052, 0.125]],
      [[0.004, 0.113], [0.044, 0.116], [0.052, 0.124], [0.044, 0.131], [0.004, 0.125]],
    ], 0.005, mat.black, { bevel: 0.001, x: -0.034 });
    K.prof(mgo, "mgo.body", [[-0.110, 0.138], [0.096, 0.138], [0.102, 0.146], [0.102, 0.196], [0.074, 0.226],
      [-0.084, 0.226], [-0.110, 0.210]], 0.066, mat.black, { bevel: 0.006 });
    K.lathe(mgo, "mgo.obj", [[0.024, 0.098], [0.026, 0.098], [0.031, 0.104], [0.034, 0.112], [0.034, 0.160], [0.034, 0.160],
      [0.029, 0.162], [0.029, 0.162], [0.028, 0.152], [0.024, 0.142], [0.024, 0.098]], 22, mat.black, 0, AXY, 0);
    K.lathe(mgo, "mgo.oc", [[0.020, -0.152], [0.026, -0.150], [0.026, -0.104], [0.024, -0.100]], 20, mat.black, 0, AXY, 0);
    K.lathe(mgo, "mgo.cup", [[0.022, -0.178], [0.030, -0.176], [0.031, -0.168], [0.030, -0.142], [0.026, -0.138],
      [0.020, -0.140], [0.021, -0.170], [0.022, -0.178]], 20, K.fin("rubber"), 0, AXY, 0);
    // BUIS on the roof: aperture ear at the back, blade at the front
    K.prof(mgo, "mgo.buisR", [[-0.012, 0.222], [0.012, 0.222], [0.012, 0.244], [0.006, 0.250], [-0.006, 0.250], [-0.012, 0.244]],
      0.008, mat.black, { axis: "z", bevel: 0.001, z: 0.070,
        holes: [[[-0.0022, 0.2425], [-0.0022, 0.2385], [0.0022, 0.2385], [0.0022, 0.2425]]] });
    K.prof(mgo, "mgo.buisF", [[0.052, 0.222], [0.070, 0.222], [0.066, 0.232], [0.062, 0.2455], [0.058, 0.2455], [0.056, 0.232]],
      0.006, mat.black, { bevel: 0.0008 });
    // BDC elevation drum (left), windage cap (right)
    K.lathe(mgo, "mgo.elev", [[0, 0.030], [0.020, 0.030], [0.020, 0.036], [0.022, 0.037], [0.022, 0.050], [0.018, 0.052], [0, 0.052]],
      18, mat.black, 0, AXY + 0.006, -0.010, { axis: "y", rz: Math.PI / 2 });
    K.prof(mgo, "mgo.elevKnurl", K.ribs(0.0235, 0.0215, 20).map((p) => [p[0] + 0.010, p[1] + AXY + 0.006]), 0.012, mat.black,
      { bevel: 0, x: -0.0435 });
    K.lathe(mgo, "mgo.wind", [[0, 0.030], [0.014, 0.030], [0.014, 0.042], [0.012, 0.044], [0, 0.044]], 14, mat.black,
      0, AXY + 0.006, -0.010, { axis: "y", rz: -Math.PI / 2 });
    // amber-coated glass both ends
    const glass = sawGlass(ctx, 0xd8a860);
    cyl(mgo, 0.0275, 0.0015, glass, 0, AXY, -0.150, Math.PI / 2);
    cyl(mgo, 0.020, 0.0015, glass, 0, AXY, 0.150, Math.PI / 2);
    K.opticAnchors(mgo, { type: "scope", mag: 3.4, rear: [0, AXY, 0.150], front: [0, AXY, -0.150], lensR: 0.020, eyeRelief: 0.084, k: 1.58 });

    // FIXED STOCK + rubber buttplate
    K.prof(g, "saw.stock", [
      [-0.046, 0.070], [-0.400, 0.056], [-0.420, 0.046], [-0.420, -0.118], [-0.380, -0.124],
      [-0.160, -0.040], [-0.060, -0.046], [-0.046, -0.050],
    ], 0.066, poly, { bevel: 0.006 });
    K.prof(g, "saw.pad", [[-0.418, 0.054], [-0.434, 0.052], [-0.438, 0.044], [-0.438, -0.114], [-0.434, -0.122], [-0.418, -0.120]],
      0.072, K.fin("rubber"), { bevel: 0.003 });

    // the firing hand on the grip
    K.hand(g, { at: [-0.052, -0.052], rake: R, gripW: 0.056, gripD: 0.080, trigger: [-0.084, -0.156] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.204);
    // WHERE THE HANDS GO — see systems/gunhands.js. A belt gun is reloaded
    // through the feed cover and the ammo box, not a magwell.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.090, -0.520),   // under the ribbed handguard
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: -0.033, z: -0.520, w: 0.080, h: 0.074, rc: 0.020, len: 0.23 },
      mag: new THREE.Vector3(-0.012, -0.070, -0.240),  // ammo-box lid
      charge: new THREE.Vector3(0, 0.112, -0.030),     // feed-tray cover latch
      style: "belt",
    };
    // THE ANCHORS (contract: sidearm.js). The "mag" is the ammo box; its
    // well is where the belt enters the feed tray on the receiver's left.
    K.anchors(g, {
      k: 1.58,
      grip: { pos: gripCentre(0.092, -0.050, 0.080, R, 0.072), rake: R },
      trigger: [0, -0.084, -0.158],
      support: { pos: [0, -0.033, -0.520], kind: "guard", len: 0.23 },
      mag: { pos: [-0.012, -0.150, -0.240], well: [-0.043, 0.066, -0.235] },
      stock: [0, -0.034, 0.438],
      bolt: null,
      charge: [0.066, 0.004, -0.350],
      optic: { type: "scope", mag: 3.4 },
    });
    return g;
  };
})();
