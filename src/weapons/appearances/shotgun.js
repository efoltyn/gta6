/* ============================================================
   weapons/appearances/shotgun.js — the 12-gauge pump (Remington 870).

   Reads as a pump gun because of: TWO tubes up front (the barrel over the
   magazine tube, tied by the barrel lug at the mag cap), the grooved walnut
   fore-end riding the mag tube with its action bars running back into the
   receiver, a long flat-sided receiver with the ejection port on the right,
   a brass bead at the muzzle instead of a post, a straight walnut stock
   with a wrist (no pistol grip) and a rubber recoil pad, and a side saddle
   of red shells on the receiver's left flank.

   Contract: fpsmode.js slides userData.pump along +z by pumpBaseZ +
   sin(t)*0.22 to rack it, so the fore-end and its action bars are one
   group, parked far enough forward that the rack stops at the receiver.
   Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.shotgun = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("blued"), parker = K.fin("parker"), wood = K.fin("walnut");
    const g = new THREE.Group();
    const BORE = 0.090, TUBE = 0.030;

    // RECEIVER: flat sides, the top sweeping down into the stock tang
    K.prof(g, "870.recv", [[-0.050, -0.030], [0.345, -0.030], [0.345, 0.118], [0.320, 0.124], [0.040, 0.124], [-0.020, 0.108], [-0.050, 0.080]],
      0.066, steel, { bevel: 0.005 });
    box(g, 0.004, 0.050, 0.150, mat.black, 0.032, 0.070, -0.180);         // ejection port
    // trigger plate + guard with its hole, trigger blade
    K.prof(g, "870.guard", [[-0.030, -0.020], [0.150, -0.020], [0.150, -0.040], [0.134, -0.100], [0.020, -0.100], [-0.010, -0.048]],
      0.040, parker, { bevel: 0.003, holes: [[[0.126, -0.040], [0.120, -0.088], [0.034, -0.088], [0.018, -0.046]]] });
    box(g, 0.010, 0.044, 0.010, mat.black, 0, -0.058, -0.080, -0.25);

    // BARREL over the MAGAZINE TUBE; cap + barrel lug tie them together
    K.tube(g, 0.021, 0.022, 0.760, 14, steel, 0, BORE, -0.725);
    K.tube(g, 0.022, 0.022, 0.560, 14, steel, 0, TUBE, -0.625);
    K.tube(g, 0.024, 0.026, 0.040, 14, parker, 0, TUBE, -0.925);          // mag cap
    box(g, 0.022, 0.050, 0.030, parker, 0, 0.062, -0.890);                // barrel lug
    cyl(g, 0.008, 0.012, mat.brass, 0, BORE + 0.026, -1.080);             // brass bead
    const bore = cyl(g, 0.017, 0.006, mat.bore || mat.black, 0, BORE, -1.104, Math.PI / 2);
    bore.userData.weaponBore = true;

    // the PUMP: grooved walnut fore-end + action bars, racked as one group
    const pump = new THREE.Group();
    pump.position.set(0, 0, -0.660);
    g.add(pump);
    K.prof(pump, "870.pump", [[-0.135, 0.064], [0.135, 0.064], [0.142, 0.040], [0.142, 0.000], [0.128, -0.014],
      [-0.128, -0.014], [-0.142, 0.000], [-0.142, 0.040]], 0.066, wood, { bevel: 0.009 });
    box(pump, 0.078, 0.006, 0.250, mat.black, 0, 0.018, 0);              // grip grooves
    box(pump, 0.078, 0.006, 0.250, mat.black, 0, 0.040, 0);
    box(pump, 0.054, 0.010, 0.230, parker, 0, TUBE, 0.235);              // action bars

    // SIDE SADDLE on the left of the receiver (where the real ones go, and
    // the flank the first-person camera sees): four shells, brass down
    box(g, 0.006, 0.090, 0.150, parker, -0.036, 0.050, -0.120);
    const shell = mat.redShell;
    for (let i = 0; i < 4; i++) cyl(g, 0.016, 0.086, shell, -0.052, 0.060, -0.068 - i * 0.035);
    box(g, 0.034, 0.018, 0.140, mat.brass, -0.052, 0.012, -0.120);

    // straight WALNUT stock with a wrist, rubber recoil pad
    K.prof(g, "870.stock", [
      [-0.046, 0.112], [-0.100, 0.100], [-0.442, 0.070], [-0.442, -0.150], [-0.392, -0.150],
      [-0.190, -0.074], [-0.110, -0.056], [-0.066, -0.040], [-0.046, -0.030],
    ], 0.062, wood, { bevel: 0.012 });
    K.prof(g, "870.pad", [[-0.440, 0.074], [-0.470, 0.074], [-0.470, -0.156], [-0.440, -0.154]], 0.070, K.fin("rubber"), { bevel: 0.004 });

    // the firing hand around the wrist
    const R = 52 * Math.PI / 180;
    K.hand(g, { at: [0.060, 0.005], rake: R, gripW: 0.062, gripD: 0.085, trigger: [-0.056, -0.084], heading: [0, -0.45, -1] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.106);
    g.userData.pump = pump;
    g.userData.pumpBaseZ = pump.position.z;
    // WHERE THE HANDS GO — see systems/gunhands.js. The support hand rides
    // the PUMP (it is what racks the gun), and shells go in one at a time
    // through the loading port under the receiver.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.040, -0.660),
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.025, z: -0.660, w: 0.066, h: 0.078, rc: 0.022, len: 0.284 },   // the pump (the hand rides it)
      mag: new THREE.Vector3(0, -0.050, -0.170),
      charge: new THREE.Vector3(0, -0.040, -0.660),    // racking IS the pump
      style: "shell",
    };
    return g;
  };
})();
