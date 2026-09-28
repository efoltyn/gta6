/* ============================================================
   weapons/appearances/ak47.js — the AK-47.

   The street's status rifle; it has to read as an AK from across an
   intersection. The tells, all modelled: red-lacquered wood (dropped
   stock, pistol grip, lower handguard and the upper handguard over the
   gas tube), the rounded dust cover with the rear tangent sight in front
   of it, the big selector lever down the right flank, the 45-degree gas
   block, the tall front sight tower with its open wings, the cleaning rod
   under the barrel, a slant brake, and the deep-curved 30-round banana
   magazine. Built on CBZ.gunKit (sidearm.js). One builder serves the
   viewmodel, the player's carry and every NPC carrying "AK-47".
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.ak47 = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), wood = K.fin("akWood");
    const g = new THREE.Group();
    const BORE = 0.035;

    // RECEIVER with the trigger guard cut through it
    K.prof(g, "ak.recv", [
      [-0.030, 0.046], [0.410, 0.046], [0.410, -0.040], [0.236, -0.040], [0.228, -0.098],
      [0.112, -0.098], [0.098, -0.050], [-0.030, -0.042],
    ], 0.068, steel, { bevel: 0.004,
      holes: [[[0.214, -0.048], [0.212, -0.088], [0.124, -0.088], [0.112, -0.048]]] });
    // rounded DUST COVER, its rear button proud of the receiver
    K.prof(g, "ak.cover", [[-0.040, 0.040], [0.300, 0.040], [0.300, 0.078], [0.020, 0.086], [-0.030, 0.080], [-0.040, 0.068]],
      0.060, blued, { bevel: 0.009 });
    // rear sight block (the ramp base), then the TANGENT LEAF hinged at its
    // front and lying back up the ramp, its range slider, and the notch plate
    // standing at the leaf's rear end: the U the eye lays the post in
    K.prof(g, "ak.rsight", [[0.296, 0.040], [0.430, 0.040], [0.430, 0.064], [0.330, 0.094], [0.296, 0.094]],
      0.050, steel, { bevel: 0.004 });
    K.prof(g, "ak.leaf", [[0.300, 0.094], [0.300, 0.110], [0.330, 0.106], [0.420, 0.072], [0.420, 0.064]],
      0.030, blued, { bevel: 0.002 });
    K.prof(g, "ak.slider", [[0.352, 0.086], [0.380, 0.076], [0.380, 0.094], [0.352, 0.104]],
      0.040, steel, { bevel: 0.002 });
    K.prof(g, "ak.notch", [[-0.018, 0], [0.018, 0], [0.018, 0.030], [0.005, 0.030], [0.003, 0.024],
      [-0.003, 0.024], [-0.005, 0.030], [-0.018, 0.030]], 0.008, blued, { axis: "z", bevel: 0.001, y: 0.096, z: -0.304 });
    // SELECTOR lever down the right flank + charging handle on the carrier
    box(g, 0.005, 0.020, 0.150, K.fin("edge"), 0.036, 0.020, -0.135, -0.06);
    cyl(g, 0.011, 0.050, blued, 0.050, 0.050, -0.285, 0, 0, Math.PI / 2);
    box(g, 0.010, 0.044, 0.012, mat.black, 0, -0.062, -0.150, -0.30);   // trigger

    // FURNITURE: lower handguard (palm swell at the back), upper over the gas tube
    K.prof(g, "ak.lhg", [[0.440, -0.030], [0.470, -0.044], [0.720, -0.030], [0.720, 0.052], [0.440, 0.054]],
      0.074, wood, { bevel: 0.010 });
    K.tube(g, 0.016, 0.016, 0.400, 10, steel, 0, 0.078, -0.620);          // gas tube
    K.prof(g, "ak.uhg", [[0.460, 0.058], [0.690, 0.058], [0.700, 0.084], [0.480, 0.098], [0.460, 0.090]],
      0.052, wood, { bevel: 0.012 });
    box(g, 0.080, 0.100, 0.024, steel, 0, 0.014, -0.735);                 // handguard retainer
    // BARREL, cleaning rod, 45-degree gas block, front sight tower, slant brake
    K.tube(g, 0.017, 0.018, 0.460, 12, blued, 0, BORE, -0.950);
    K.tube(g, 0.005, 0.005, 0.380, 6, steel, 0, -0.010, -0.930);         // cleaning rod
    K.prof(g, "ak.gasblock", [[0.800, 0.014], [0.860, 0.014], [0.860, 0.052], [0.830, 0.096], [0.780, 0.096], [0.780, 0.060]],
      0.044, steel, { bevel: 0.004 });
    K.prof(g, "ak.fsb", [
      [1.070, 0.006], [1.130, 0.006], [1.130, 0.062], [1.118, 0.064], [1.112, 0.110],
      [1.092, 0.110], [1.084, 0.064], [1.070, 0.060],
    ], 0.040, steel, { bevel: 0.004 });
    K.prof(g, "ak.fsbWings", [[-0.028, 0], [0.028, 0], [0.028, 0.060], [0.016, 0.060], [0.010, 0.016],
      [-0.010, 0.016], [-0.016, 0.060], [-0.028, 0.060]], 0.022, steel, { axis: "z", bevel: 0.003, y: 0.090, z: -1.102 });
    // the post: round stem, its tip level with the rear notch's floor
    K.lathe(g, "ak.post", [[0.0035, 0], [0.0035, 0.018], [0.0028, 0.020], [0, 0.020]], 8, mat.black, 0, 0.100, -1.102, { axis: "y" });
    K.prof(g, "ak.brake", [[1.150, 0.012], [1.246, 0.012], [1.246, 0.042], [1.214, 0.060], [1.150, 0.060]],
      0.046, mat.black, { bevel: 0.006 });
    const bore = cyl(g, 0.011, 0.006, mat.bore || mat.black, 0, BORE, -1.249, Math.PI / 2);
    bore.userData.weaponBore = true;

    // BANANA MAG: an arc about a centre out in front of the gun
    const C = [1.080, -0.030], Rc = 0.780, h0 = 0.066, h1 = 0.058, pts = [], back = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * 0.56, h = h0 + (h1 - h0) * (i / 8);
      const cx = C[0] - Math.cos(a) * Rc, cy = C[1] - Math.sin(a) * Rc;
      const ux = Math.cos(a), uy = Math.sin(a);   // unit vector from centre toward the mag
      pts.push([cx + ux * -h, cy + uy * -h]);       // front edge (toward the centre)
      back.push([cx + ux * h, cy + uy * h]);
    }
    K.prof(g, "ak.mag", pts.concat(back.reverse()), 0.052, steel, { bevel: 0.004 });
    // floorplate, square to the curve where it ends
    const aEnd = 0.56, bx = C[0] - Math.cos(aEnd) * Rc + Math.sin(aEnd) * 0.006, by = C[1] - Math.sin(aEnd) * Rc - Math.cos(aEnd) * 0.006;
    box(g, 0.058, 0.014, 0.128, blued, 0, by, -bx, aEnd);

    // wood pistol grip + the dropped wood stock with a steel buttplate
    const R = 20 * Math.PI / 180;
    K.prof(g, "ak.grip", K.grip(0.096, -0.040, 0.078, 0.180, R, { swellF: 0.006, swellB: 0.006 }), 0.056, wood, { bevel: 0.006 });
    K.prof(g, "ak.stock", [
      [-0.025, 0.044], [-0.110, 0.030], [-0.472, -0.006], [-0.472, -0.188], [-0.400, -0.172],
      [-0.140, -0.078], [-0.060, -0.052], [-0.025, -0.044],
    ], 0.060, wood, { bevel: 0.010 });
    K.prof(g, "ak.buttplate", [[-0.470, 0.000], [-0.488, 0.000], [-0.488, -0.190], [-0.470, -0.194]], 0.068, steel, { bevel: 0.003 });

    // the firing hand on the grip
    K.hand(g, { at: [-0.050, -0.056], rake: R, gripW: 0.056, gripD: 0.078, trigger: [-0.066, -0.146] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.25);
    // WHERE THE HANDS GO — see systems/gunhands.js for the contract.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.050, -0.580),   // under the wood handguard
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.008, z: -0.580, w: 0.074, h: 0.098, rc: 0.026, len: 0.27 },
      mag: new THREE.Vector3(0, -0.230, -0.330),       // the banana, mid-curve
      charge: new THREE.Vector3(0.060, 0.050, -0.285), // AK charging handle: RIGHT side of the carrier
      style: "mag",
    };
    /* THE ANCHORS (contract: sidearm.js). 1.738 model units over the real
       880 mm: k 1.975. Eye relief to the AK's notch is long: the rear sight
       sits ahead of the receiver, so a cheek on the low comb puts the eye
       ~30 cm behind it. */
    const down = (t) => [0, -0.027 - Math.cos(R) * t, -0.060 + Math.sin(R) * t];
    const mid = 0.28, MAG = [0, -0.030 - Math.sin(mid) * Rc, -(C[0] - Math.cos(mid) * Rc)], WELL = [0, -0.042, -0.300];
    K.anchors(g, {
      k: 1.975,
      grip: { pos: down(0.078), rake: R },
      trigger: [0, -0.064, -0.154],
      support: { pos: [0, -0.046, -0.580], kind: "guard", len: 0.27 },
      mag: { pos: MAG, well: WELL, quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(WELL[0] - MAG[0], WELL[1] - MAG[1], WELL[2] - MAG[2]).normalize()) },
      stock: [0, -0.095, 0.489],
      charge: [0.060, 0.050, -0.285],
      sight: { rear: [0, 0.120, -0.304], front: [0, 0.120, -1.102], eyeRelief: 0.30, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
