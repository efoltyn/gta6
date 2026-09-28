/* ============================================================
   weapons/appearances/smg.js — the compact SMG (H&K MP5A2).

   An MP5 is recognised by: the round stamped receiver with the cocking
   tube running forward over the barrel to a RING front sight, the cocking
   lever sticking out at ten o'clock on the left, the slim polymer
   handguard, the rotary drum rear sight, the one-piece polymer trigger
   group whose big guard wraps the grip, the slim 9 mm magazine that runs
   straight then curves forward, the three-lug barrel end, and the solid
   A2 fixed stock. weapon-data gives it optic "dot", so a micro red dot
   rides a claw mount over the receiver (named "_baseOptic" so a gunsmith
   scope replaces it). Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.smg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();
    const BORE = 0.050;

    // RECEIVER tube + magwell block welded under its front
    K.tube(g, 0.036, 0.036, 0.450, 14, steel, 0, 0.060, -0.195);
    K.prof(g, "mp5.magwell", [[0.250, 0.040], [0.372, 0.040], [0.372, -0.030], [0.362, -0.046], [0.258, -0.046], [0.250, -0.030]],
      0.054, steel, { bevel: 0.004 });
    // COCKING TUBE forward over the barrel, lever out on the left
    K.tube(g, 0.018, 0.018, 0.300, 12, steel, 0, 0.086, -0.560);
    K.tag(box(g, 0.050, 0.014, 0.018, mat.black, -0.036, 0.100, -0.500, 0, 0, 0.55), "part_charge");
    // slim polymer handguard with a front lip
    K.prof(g, "mp5.hg", [[0.410, 0.066], [0.610, 0.066], [0.620, 0.050], [0.620, -0.010], [0.600, -0.016], [0.410, 0.006]],
      0.070, poly, { bevel: 0.008 });
    // RING front sight on its base at the end of the cocking tube
    K.prof(g, "mp5.fsbase", [[0.680, 0.030], [0.720, 0.030], [0.720, 0.100], [0.700, 0.104], [0.680, 0.098]],
      0.034, steel, { bevel: 0.004 });
    const ring = [], hole = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.032, Math.sin(a) * 0.032]);
      hole.push([Math.cos(-a) * 0.022, Math.sin(-a) * 0.022]);
    }
    K.prof(g, "mp5.fsring", ring, 0.024, steel, { axis: "z", bevel: 0.003, holes: [hole], y: 0.132, z: -0.700 });
    box(g, 0.005, 0.026, 0.005, mat.black, 0, 0.122, -0.700);            // post inside the ring
    // barrel + three-lug end + open bore
    K.tube(g, 0.014, 0.015, 0.160, 12, blued, 0, BORE, -0.700);
    K.tube(g, 0.021, 0.021, 0.048, 6, blued, 0, BORE, -0.757);
    const bore = cyl(g, 0.010, 0.006, mat.bore || mat.black, 0, BORE, -0.780, Math.PI / 2);
    bore.userData.weaponBore = true;

    // rotary DRUM rear sight on its base
    box(g, 0.036, 0.030, 0.040, steel, 0, 0.100, -0.010);
    K.tube(g, 0.022, 0.022, 0.034, 12, mat.black, 0, 0.124, -0.010);
    // claw mount + micro red dot
    const dot = new THREE.Group();
    dot.name = "_baseOptic";
    dot.position.set(0, 0, -0.150);
    g.add(dot);
    K.prof(dot, "mp5.claw", [[-0.060, 0.090], [0.060, 0.090], [0.050, 0.112], [0.020, 0.112], [0.020, 0.122], [-0.020, 0.122], [-0.020, 0.112], [-0.060, 0.112]],
      0.056, steel, { bevel: 0.003 });
    K.tube(dot, 0.021, 0.021, 0.060, 14, mat.black, 0, 0.144, 0);
    box(dot, 0.018, 0.014, 0.024, mat.black, 0, 0.168, 0.004);
    cyl(dot, 0.017, 0.004, K.fin("lens"), 0, 0.144, 0.029, Math.PI / 2);
    box(dot, 0.004, 0.004, 0.002, K.fin("redDot"), 0, 0.144, 0.032);

    // curved 9 mm MAGAZINE: straight, then sweeping forward
    const mf = [], mb = [], D = 0.056;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, s = t * 0.300;
      const a = s < 0.080 ? 0 : (s - 0.080) / 0.40;          // radius 0.40 after 8 cm
      const cx = 0.340 - D / 2 + (a > 0 ? 0.40 * (1 - Math.cos(a)) : 0);
      const cy = -0.030 - (a > 0 ? 0.080 + 0.40 * Math.sin(a) : s);
      const nx = Math.cos(a), ny = Math.sin(a);                // across the mag
      mf.push([cx + nx * D / 2, cy + ny * D / 2]);
      mb.push([cx - nx * D / 2, cy - ny * D / 2]);
    }
    K.tag(K.prof(g, "mp5.mag", mf.concat(mb.reverse()), 0.040, mat.dark, { bevel: 0.003 }), "part_mag");

    // POLYMER TRIGGER GROUP: housing + the big wrap-around guard + grip
    K.prof(g, "mp5.tgroup", [
      [-0.020, 0.030], [0.236, 0.030], [0.240, -0.020], [0.226, -0.030], [0.214, -0.108],
      [0.196, -0.118], [0.104, -0.118], [0.080, -0.040], [-0.020, -0.030],
    ], 0.058, poly, { bevel: 0.004, holes: [[[0.200, -0.036], [0.188, -0.104], [0.114, -0.104], [0.100, -0.040]]] });
    box(g, 0.010, 0.040, 0.010, mat.black, 0, -0.056, -0.146, -0.25);    // trigger
    const R = 16 * Math.PI / 180;
    K.prof(g, "mp5.grip", K.grip(0.090, -0.034, 0.076, 0.170, R, { grooves: 3, swellB: 0.004 }), 0.054, poly, { bevel: 0.005 });

    // A2 FIXED STOCK + rubber pad
    K.prof(g, "mp5.stock", [
      [-0.018, 0.086], [-0.300, 0.080], [-0.312, 0.070], [-0.312, -0.098], [-0.286, -0.104],
      [-0.120, -0.004], [-0.040, 0.018], [-0.018, 0.024],
    ], 0.056, poly, { bevel: 0.006 });
    box(g, 0.060, 0.186, 0.018, K.fin("rubber"), 0, -0.010, 0.321);

    // the firing hand on the grip
    K.hand(g, { at: [-0.040, -0.050], rake: R, gripW: 0.054, gripD: 0.076, trigger: [-0.058, -0.140] });

    g.userData.muzzle = new THREE.Vector3(0, BORE, -0.783);
    // WHERE THE HANDS GO — see systems/gunhands.js for the contract.
    g.userData.grips = {
      support: new THREE.Vector3(0, -0.030, -0.510),   // under the slim handguard
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.025, z: -0.510, w: 0.070, h: 0.082, rc: 0.022, len: 0.20 },
      mag: new THREE.Vector3(0, -0.200, -0.330),
      charge: new THREE.Vector3(-0.055, 0.100, -0.500),// cocking lever, LEFT side (MP5 pattern)
      style: "mag",
    };
    return g;
  };
})();
