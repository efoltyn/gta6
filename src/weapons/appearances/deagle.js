/* ============================================================
   weapons/appearances/deagle.js — the .50 Desert Eagle (Mk XIX, 6in).

   The flex handgun. It reads as a Deagle because of: a full-length flat
   top rail, the fixed barrel's TRIANGULAR cross-section (narrow at the top,
   wide at the bottom) running the front half, a slide of the same profile
   behind it with rear serrations and an exposed hammer, the long frame
   rounding off under the muzzle, the squared trigger guard with a hooked
   front, a big raked grip in black rubber, and a yawning .50 bore. Finish:
   brushed stainless with black grips, sights and hammer.
   Real proportions (265 mm long, 32 mm wide) at 2.4x.
   Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.deagle = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const ss = K.fin("stainless"), rubber = K.fin("rubber");
    const g = new THREE.Group();
    const BORE = 0.042;

    // SLIDE (rear) and fixed BARREL (front): both the tapering triangle-ish
    // section, split by a dark seam; the full-length rail on top
    K.tag(K.prof(g, "de.slide", [[-0.041, 0], [0.041, 0], [0.022, 0.088], [-0.022, 0.088]], 0.312, ss,
      { axis: "z", bevel: 0.004, z: -0.126 }), "part_slide");
    K.prof(g, "de.barrel", [[-0.039, 0], [0.039, 0], [0.016, 0.088], [-0.016, 0.088]], 0.322, ss,
      { axis: "z", bevel: 0.004, z: -0.446 });
    box(g, 0.080, 0.098, 0.004, mat.black, 0, 0.044, -0.296, 0.42);    // slide/barrel seam, raked
    K.prof(g, "de.rail", K.rail(-0.020, 0.600, 0.088, 0.006, 0.008, 0.024), 0.030, ss, { bevel: 0.0015 });
    // rear serrations, low on the flanks where the slide is widest
    // one rib set per flank, leaned in to lie on the tapered side
    const ribs = [];
    for (let i = 0; i < 7; i++) {
      const f = 0.000 + i * 0.013;
      ribs.push([[f, 0.010], [f + 0.006, 0.010], [f + 0.006, 0.066], [f, 0.066]]);
    }
    const lean = Math.atan2(0.019, 0.088);
    K.tag(K.prof(g, "de.serr", ribs, 0.006, mat.black, { bevel: 0, x: 0.0425, rz: lean }), "part_slide");
    K.tag(K.prof(g, "de.serr", ribs, 0.006, mat.black, { bevel: 0, x: -0.0425, rz: -lean }), "part_slide");
    // exposed HAMMER, safety lever, sights
    K.prof(g, "de.hammer", [[-0.030, 0.030], [-0.052, 0.050], [-0.058, 0.082], [-0.046, 0.090], [-0.032, 0.072]],
      0.022, mat.black, { bevel: 0.003 });
    box(g, 0.012, 0.018, 0.040, mat.black, -0.042, 0.062, 0.010);
    K.tag(K.prof(g, "de.rear", [[-0.024, 0], [0.024, 0], [0.024, 0.020], [0.007, 0.020], [0.005, 0.009],
      [-0.005, 0.009], [-0.007, 0.020], [-0.024, 0.020]], 0.022, mat.black, { axis: "z", bevel: 0.002, y: 0.100, z: 0.004 }), "part_slide");
    box(g, 0.010, 0.024, 0.030, mat.black, 0, 0.110, -0.580);
    // the .50 BORE, low in the barrel's wide base
    const bore = cyl(g, 0.017, 0.006, mat.bore || mat.black, 0, BORE, -0.606, Math.PI / 2);
    bore.userData.weaponBore = true;

    // FRAME: long dust cover rounding under the muzzle, hooked square guard
    K.prof(g, "de.frame", [
      [-0.050, -0.020], [-0.030, 0.004], [0.575, 0.004], [0.584, -0.022], [0.574, -0.050],
      [0.556, -0.060], [0.262, -0.060], [0.272, -0.146], [0.262, -0.160], [0.238, -0.162],
      [0.102, -0.162], [0.084, -0.140], [0.076, -0.080], [-0.030, -0.072], [-0.050, -0.042],
    ], 0.068, ss, { bevel: 0.004,
      holes: [[[0.244, -0.070], [0.252, -0.146], [0.110, -0.146], [0.096, -0.126], [0.092, -0.070]]] });
    box(g, 0.012, 0.056, 0.012, mat.black, 0, -0.096, -0.132, -0.2);    // trigger
    // big raked GRIP in black rubber + mag baseplate
    const R = 18 * Math.PI / 180;
    const gp = K.grip(0.084, -0.070, 0.142, 0.250, R, { grooves: 3, swellB: 0.008 });
    K.prof(g, "de.grip", gp, 0.086, rubber, { bevel: 0.006 });
    const b0 = gp[8], b1 = gp[9];
    K.tag(box(g, 0.090, 0.018, 0.150, ss, 0, (b0[1] + b1[1]) / 2 - 0.006, -(b0[0] + b1[0]) / 2, -R), "part_mag");

    // the firing hand on the grip
    K.hand(g, { at: [-0.062, -0.012], rake: R, gripW: 0.086, gripD: 0.142, trigger: [-0.096, -0.126] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -0.609);
    // WHERE THE HANDS GO — see systems/gunhands.js.
    g.userData.grips = {
      support: new THREE.Vector3(-0.110, -0.180, 0.000),
      mag: new THREE.Vector3(0, -0.320, 0.070),
      charge: new THREE.Vector3(0, 0.050, -0.040),     // rear slide serrations
      style: "mag",
    };
    return g;
  };
})();
