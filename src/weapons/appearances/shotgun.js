/* ============================================================
   weapons/appearances/shotgun.js — the 12-gauge pump (Remington 870).

   Reads as a pump gun because of: TWO tubes up front (the barrel over the
   magazine tube, tied by the barrel lug at the mag cap), the vent rib
   down the barrel with a mid-bead and a brass front bead, the grooved walnut
   fore-end riding the mag tube with its action bars running back into the
   receiver, a long flat-sided receiver with the ejection port on the right,
   a straight walnut stock
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
    K.tag(K.prof(g, "870.recv", [[-0.050, -0.030], [0.345, -0.030], [0.345, 0.118], [0.320, 0.124], [0.040, 0.124], [-0.020, 0.108], [-0.050, 0.080]],
      0.066, steel, { bevel: 0.005 }), "part_receiver");
    box(g, 0.004, 0.050, 0.150, mat.black, 0.032, 0.070, -0.180);         // ejection port
    box(g, 0.002, 0.026, 0.118, steel, 0.0345, 0.072, -0.186);            // the bolt's flank in the port
    // the two trigger-group pins through the receiver, the safety button
    // through the guard behind the blade, the slide release ahead of it,
    // and the barrel's collar where it seats in the receiver
    cyl(g, 0.0058, 0.070, parker, 0, 0.012, -0.040, 0, 0, Math.PI / 2);
    cyl(g, 0.0058, 0.070, parker, 0, 0.012, -0.300, 0, 0, Math.PI / 2);
    cyl(g, 0.0062, 0.050, mat.black, 0, -0.030, -0.010, 0, 0, Math.PI / 2);
    box(g, 0.004, 0.012, 0.030, parker, -0.034, -0.026, -0.150);
    K.tube(g, 0.0255, 0.0255, 0.030, 16, steel, 0, BORE, -0.360);
    // the matted sighting groove down the receiver's top: the rear of the
    // bead gun's sight line (the eye lays the bead in its rear end)
    K.prof(g, "870.groove", [[0.030, 0.1215], [0.322, 0.1215], [0.322, 0.1245], [0.030, 0.1245]],
      0.010, mat.black, { bevel: 0 });
    // trigger plate + guard with its hole, trigger blade
    // (the bow's rear stands nearly upright where it meets the plate: the
    // middle finger lies against it; it used to slope back under the wrist
    // and the finger went through it)
    K.tag(K.prof(g, "870.guard", [[-0.012, -0.020], [0.150, -0.020], [0.150, -0.040], [0.134, -0.100], [0.020, -0.100], [0.004, -0.056]],
      0.040, parker, { bevel: 0.003, holes: [[[0.126, -0.040], [0.120, -0.088], [0.034, -0.088], [0.018, -0.046]]] }), "part_guard");
    // the blade hangs in the rear half of the bow, as on the real gun (it was
    // 1 cm further forward, past the reach of a hand on the wrist)
    box(g, 0.010, 0.044, 0.010, mat.black, 0, -0.058, -0.054, -0.25);

    // BARREL over the MAGAZINE TUBE; cap + barrel lug tie them together
    K.tube(g, 0.021, 0.022, 0.760, 14, steel, 0, BORE, -0.725);
    K.tube(g, 0.022, 0.022, 0.560, 14, steel, 0, TUBE, -0.625);
    K.tube(g, 0.024, 0.026, 0.040, 14, parker, 0, TUBE, -0.925);          // mag cap
    box(g, 0.022, 0.050, 0.030, parker, 0, 0.062, -0.890);                // barrel lug
    /* THE SIGHT: a VENTILATED RIB down the barrel, its matted top flush
       with the receiver's groove, posts and daylight under it; an ivory
       MID-BEAD half way and a brass FRONT BEAD at the muzzle, both sitting
       on the rib. The eye rides a centimetre over the rib (cheek on the
       comb), so the rib reads as a flat lane running out to the bead and
       the mid-bead stacks under the front bead: the shotgunner's
       "figure 8". (It was a lone bead on a stem with its crown exactly level
       with the receiver top, and the eye 8 cm behind the receiver ON that
       plane: the receiver filled the lower screen, sliced by the near
       plane, the stock and the firing hand were behind the eye, and the
       bead hid behind the receiver's top edge.) */
    const RIB = 0.1245, RIB0 = 0.345, RIB1 = 1.090;
    const vents = [];
    for (let f = RIB0 + 0.022; f + 0.040 < RIB1 - 0.012; f += 0.052) vents.push([[f, 0.1125], [f + 0.040, 0.1125], [f + 0.040, RIB - 0.0035], [f, RIB - 0.0035]]);
    K.tag(K.prof(g, "870.rib", [[RIB0, 0.1085], [RIB1, 0.1085], [RIB1, RIB], [RIB0, RIB]], 0.014, steel, { bevel: 0, holes: vents }), "part_rib");
    // the rib's matted (black, non-glare) top, the lane the eye runs down
    K.prof(g, "870.ribTop", [[RIB0, RIB - 0.0008], [RIB1 - 0.004, RIB - 0.0008], [RIB1 - 0.004, RIB + 0.0004], [RIB0, RIB + 0.0004]], 0.010, mat.black, { bevel: 0 });
    // brass front bead (5.3 mm real) seated in the rib at the muzzle
    const BEAD_Z = -1.080, MID_Z = -0.700;
    K.tag(K.lathe(g, "870.bead2", [[0.0026, 0], [0.0040, 0.0012], [0.0043, 0.0040], [0.0036, 0.0066], [0.0020, 0.0080], [0, 0.0084]],
      12, mat.brass, 0, RIB - 0.0006, BEAD_Z, { axis: "y" }), "part_bead");
    // the smaller ivory mid-bead
    K.tag(K.lathe(g, "870.midbead", [[0.0016, 0], [0.0025, 0.0008], [0.0027, 0.0024], [0.0021, 0.0040], [0, 0.0046]],
      10, K.fin("whiteDot"), 0, RIB - 0.0004, MID_Z, { axis: "y" }), "part_midbead");
    const bore = cyl(g, 0.017, 0.006, mat.bore || mat.black, 0, BORE, -1.104, Math.PI / 2);
    bore.userData.weaponBore = true;

    // the PUMP: grooved walnut fore-end + action bars, racked as one group
    const pump = new THREE.Group();
    pump.name = "870:pump";
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
    for (let i = 0; i < 4; i++) K.tag(cyl(g, 0.016, 0.086, shell, -0.052, 0.060, -0.068 - i * 0.035), "part_shell");
    box(g, 0.034, 0.018, 0.140, mat.brass, -0.052, 0.012, -0.120);

    // straight WALNUT stock with a wrist, rubber recoil pad. The comb drops
    // away from the rib line (about 4 cm at the comb, 6 at the heel) the way
    // a field stock does: the cheek lies on it with the eye on the rib.
    // (It used to run 1.5 cm under the rib, so an eye on the rib sat with
    // the comb's edges inside the camera's near plane.)
    K.prof(g, "870.stock", [
      [-0.046, 0.104], [-0.092, 0.068], [-0.442, 0.030], [-0.442, -0.150], [-0.392, -0.150],
      [-0.190, -0.074], [-0.110, -0.056], [-0.066, -0.040], [-0.046, -0.030],
    ], 0.062, wood, { bevel: 0.012 });
    K.prof(g, "870.pad", [[-0.440, 0.034], [-0.470, 0.034], [-0.470, -0.156], [-0.440, -0.154]], 0.070, K.fin("rubber"), { bevel: 0.004 });

    // the firing hand around the wrist, the web low on it and the THUMB
    // LAID FORWARD DOWN THE RIGHT FLANK (thumbAim): down the sights the whole
    // hand is under and behind the eye, out of the picture. (It rode 3 cm
    // higher with its knuckles level with the receiver top, and once the
    // finished gun re-closed its thumb (fphands.regraspWithSolids) the thumb
    // went up over the wrist to eye height: a white ball beside the rib.)
    const R = 52 * Math.PI / 180;
    K.hand(g, { at: [0.025, 0.035], rake: R, gripW: 0.062, gripD: 0.085, trigger: [-0.056, -0.058], heading: [0, -0.45, -1], thumbAim: [0.5, 0.0, -1], thumbAim2: [0.2, -0.2, -1] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -1.106);
    g.userData.pump = pump;
    g.userData.pumpBaseZ = pump.position.z;
    // WHERE THE HANDS GO — see systems/gunhands.js. The support hand rides
    // the PUMP (it is what racks the gun), and shells go in one at a time
    // through the loading port under the receiver.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.040, -0.660),
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.025, z: -0.660, w: 0.066, h: 0.078, rc: 0.022, len: 0.284, slide: 0.10 },   // the pump (the hand rides it), held on its rear half: a real arm reaches it there
      mag: new THREE.Vector3(0, -0.050, -0.170),
      charge: new THREE.Vector3(0, -0.040, -0.660),    // racking IS the pump
      style: "shell",
    };
    /* THE ANCHORS (contract: sidearm.js). 1.576 model units over the real
       978 mm: k 1.61. The pump points are its REST position in model space;
       `node` names the pump group they ride with when it racks. The wrist is
       a straight stock's (52 deg), but the fist on it closes canted (the
       fingers run diagonally, K.hand's heading), so the grip frame carries
       the hand's own axis, 26 deg back from vertical. */
    const PZ = pump.position.z;
    const MAG = [0, TUBE, -0.625], WELL = [0, -0.032, -0.230];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(WELL[0] - MAG[0], WELL[1] - MAG[1], WELL[2] - MAG[2]).normalize());   // +Y: body -> well
    const SF = [0, RIB - 0.0006 + 0.0042, BEAD_Z];                    // front bead centre
    const MID_TOP = RIB - 0.0004 + 0.0046, EYE_Z = 0.160, REAR_Z = -0.034;
    const fig8 = (MID_TOP - RIB) / (MID_Z - BEAD_Z);                      // over the mid-bead crown to the bead's foot
    const EYE_Y = MID_TOP + fig8 * (EYE_Z - MID_Z);
    const sl = (EYE_Y - SF[1]) / (EYE_Z - SF[2]);
    const SR = [0, SF[1] + sl * (REAR_Z - SF[2]), REAR_Z];
    const SIGHT_RELIEF = Math.hypot(EYE_Z - REAR_Z, EYE_Y - SR[1]) / 1.61;
    K.anchors(g, {
      k: 1.61,
      grip: { pos: [0, -0.040, 0.135], rake: 26 * Math.PI / 180 },
      trigger: [0, -0.060, -0.058],
      support: { pos: [0, -0.016, PZ], kind: "pump", len: 0.284, node: "870:pump" },
      // shells go up through the loading port (receiver belly, ahead of the
      // guard) and forward into the tube under the barrel
      mag: { pos: MAG, well: WELL, quat: q },
      stock: [0, -0.050, 0.472],
      charge: { pos: [0, -0.016, PZ], node: "870:pump" },
      // the line of aim: eye -> the FRONT BEAD's centre. The eye's height
      // is set by the figure 8 (the line over the mid-bead's crown meets the
      // front bead's foot), its distance by the cheek on the comb, nose over
      // the thumb, ~12 cm behind the receiver (further back, the firing hand
      // on the wrist came up into the bottom of the picture); `rear` is that
      // line where it passes over the receiver's rear end (a bead gun has no
      // rear sight: the rib is it)
      sight: { rear: SR, front: SF, eyeRelief: SIGHT_RELIEF, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
