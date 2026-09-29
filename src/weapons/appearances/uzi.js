/* ============================================================
   weapons/appearances/uzi.js — the IMI MICRO UZI, stock folded.

   What makes it an Uzi, all modelled at the real proportions (267 mm long
   folded, 40 mm wide receiver) at k 2.25, the Glock's scale:
     · the stamped sheet-steel RECEIVER, a squared tube with a pressed
       stiffening flute down each flank and the ejection port on the right;
     · the ribbed TOP COVER with the COCKING KNOB standing up out of its slot
       (serrated cap on a stem) near the front;
     · the telescoping bolt's whole point: the MAGAZINE RUNS UP THROUGH THE
       PISTOL GRIP at the centre of the gun, so the grip is fat and nearly
       vertical, with checkered polymer panels on a steel frame, the GRIP
       SAFETY lever on its back strap and the fire selector on the left;
     · the big stamped TRIGGER GUARD with a real hole, the trigger inside;
     · the knurled BARREL NUT and the stub of barrel with its crown;
     · the HOODED FRONT SIGHT (post inside a protective hood) and the rear
       flip aperture between its ears;
     · the FOLDING STOCK, folded along the right flank: the skeleton arm,
       the hinge knuckle at the rear, the rubber-faced butt plate up front.
   Built on CBZ.gunKit (sidearm.js); anchors per the contract up there.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const K_M = 2.25;                    // model units per real metre
  const BY = 0.050;                    // bore height
  const R = 10 * Math.PI / 180;        // grip rake: the Uzi grip is near vertical
  const S = Math.sin(R), C = Math.cos(R);
  // grip: front strap top (forward, up), depth front-to-back, length down it
  const GF = 0.258, GY = -0.030, GD = 0.118, GL = 0.225, GW = 0.074;
  // a point on the grip: u down the front strap, w back from it (both model units)
  function gp(u, w) { return [GF - S * u - C * w, GY - C * u + S * w]; }

  CBZ.weaponAppearance.uzi = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const steel = K.fin("parker"), blued = K.fin("blued"), poly = K.fin("polymer"),
      rubber = K.fin("rubber"), edge = K.fin("edge");
    const g = new THREE.Group();

    /* ---------------------------------------------------------- RECEIVER
       the squared stamped tube, its cross-section with the flank flutes */
    const half = [[0.045, -0.022], [0.045, 0.022], [0.0405, 0.029], [0.0405, 0.047], [0.045, 0.054], [0.045, 0.086], [0.040, 0.093]];
    const recv = [[-0.041, -0.030], [0.041, -0.030]].concat(half)
      .concat(half.slice().reverse().map(function (p) { return [-p[0], p[1]]; }));
    K.prof(g, "uzi.recv", recv, 0.430, steel, { axis: "z", bevel: 0.003, z: -0.215 });
    // rounded rear end cap
    K.prof(g, "uzi.cap", [[0.004, -0.028], [0.004, 0.090], [-0.010, 0.089], [-0.022, 0.074],
      [-0.029, 0.046], [-0.028, 0.004], [-0.018, -0.022]], 0.086, steel, { bevel: 0.004 });
    // ejection port on the right flank, and the bolt face seen through it
    box(g, 0.004, 0.026, 0.074, mat.black, 0.0445, 0.070, -0.318);
    box(g, 0.003, 0.014, 0.030, blued, 0.0452, 0.068, -0.300);

    /* ---------------------------------------------------------- TOP COVER
       stamped sheet with two raised ribs, the cocking slot between them */
    K.prof(g, "uzi.cover", [[-0.042, 0.090], [0.042, 0.090], [0.042, 0.100], [0.030, 0.103],
      [0.030, 0.111], [0.018, 0.111], [0.018, 0.104], [-0.018, 0.104], [-0.018, 0.111],
      [-0.030, 0.111], [-0.030, 0.103], [-0.042, 0.100]], 0.372, steel, { axis: "z", bevel: 0.0015, z: -0.214 });
    box(g, 0.012, 0.004, 0.240, mat.black, 0, 0.1045, -0.230);        // the cocking slot
    // COCKING KNOB: stem up out of the slot, a serrated cap on top
    K.tag(K.lathe(g, "uzi.knobStem", [[0, 0], [0.0075, 0], [0.0075, 0.018], [0, 0.018]], 12, blued, 0, 0.100, -0.336, { axis: "y" }), "part_charge");
    K.tag(K.prof(g, "uzi.knobCap", K.ribs(0.0165, 0.0140, 12), 0.016, blued, { axis: "z", bevel: 0.002, y: 0.122, z: -0.336, rx: Math.PI / 2 }), "part_charge");
    K.tag(K.lathe(g, "uzi.knobTop", [[0, 0.008], [0.013, 0.008], [0.0145, 0.003], [0.0145, 0]], 16, edge, 0, 0.126, -0.336, { axis: "y" }), "part_charge");

    /* ---------------------------------------------------------- SIGHTS
       rear: an L flip aperture between two ears; front: a post in a hood */
    K.prof(g, "uzi.rearEars", [[-0.034, 0.100], [0.034, 0.100], [0.034, 0.158], [0.026, 0.160],
      [0.022, 0.116], [-0.022, 0.116], [-0.026, 0.160], [-0.034, 0.158]], 0.024, steel, { axis: "z", bevel: 0.002, z: -0.046 });
    const peep = [];
    for (let i = 0; i < 10; i++) { const a = -(i / 10) * Math.PI * 2; peep.push([Math.cos(a) * 0.0045, 0.142 + Math.sin(a) * 0.0045]); }
    K.prof(g, "uzi.rearLeaf", [[-0.012, 0.110], [0.012, 0.110], [0.012, 0.150], [0.007, 0.156], [-0.007, 0.156], [-0.012, 0.150]],
      0.006, blued, { axis: "z", bevel: 0.001, z: -0.046, holes: [peep] });
    K.prof(g, "uzi.frontBase", [[0.372, 0.104], [0.426, 0.104], [0.426, 0.116], [0.404, 0.122], [0.380, 0.122]], 0.040, steel, { bevel: 0.002 });
    K.prof(g, "uzi.hood", [[-0.029, 0.112], [0.029, 0.112], [0.029, 0.158], [0.021, 0.170], [-0.021, 0.170], [-0.029, 0.158]],
      0.030, steel, { axis: "z", bevel: 0.002, z: -0.404, holes: [[[-0.019, 0.118], [-0.019, 0.159], [-0.013, 0.163], [0.013, 0.163], [0.019, 0.159], [0.019, 0.118]]] });
    K.prof(g, "uzi.post", [[0.398, 0.114], [0.410, 0.114], [0.408, 0.142], [0.400, 0.142]], 0.005, blued, { bevel: 0 });

    /* ---------------------------------------------------------- BARREL
       knurled nut screwed on the receiver's nose, the stub barrel, crown */
    K.prof(g, "uzi.nut", K.ribs(0.037, 0.0345, 20), 0.050, steel, { axis: "z", bevel: 0.002, y: BY, z: -0.455 });
    K.lathe(g, "uzi.nutFace", [[0.020, 0.479], [0.034, 0.479], [0.030, 0.483], [0.020, 0.483]], 20, blued, 0, BY, 0);
    K.lathe(g, "uzi.barrel", [[0, 0.470], [0.019, 0.470], [0.019, 0.556], [0.017, 0.568], [0.0105, 0.570], [0.0095, 0.566], [0, 0.566]],
      16, blued, 0, BY, 0);
    const bore = cyl(g, 0.0095, 0.004, mat.bore || mat.black, 0, BY, -0.5685, Math.PI / 2);
    if (bore) bore.userData.weaponBore = true;

    /* ---------------------------------------------------------- LOWER
       trigger housing + the big stamped guard (a real hole), the trigger */
    K.prof(g, "uzi.lower", [
      [0.108, -0.024], [0.414, -0.024], [0.418, -0.056], [0.410, -0.096], [0.392, -0.118],
      [0.362, -0.126], [0.262, -0.126], [0.256, -0.062], [0.150, -0.062], [0.110, -0.046],
    ], 0.066, steel, { bevel: 0.003,
      holes: [[[0.396, -0.040], [0.401, -0.064], [0.394, -0.094], [0.374, -0.110], [0.274, -0.111], [0.270, -0.040]]] });
    K.prof(g, "uzi.trigger", [[0.300, -0.036], [0.312, -0.036], [0.316, -0.058], [0.313, -0.080],
      [0.304, -0.094], [0.300, -0.090], [0.306, -0.076], [0.306, -0.058]], 0.012, blued, { bevel: 0.0015 });
    // fire selector on the left of the frame above the grip
    K.lathe(g, "uzi.selector", [[0, 0], [0.009, 0], [0.009, 0.006], [0.006, 0.010], [0, 0.010]], 12, blued,
      -0.033, -0.042, -0.200, { axis: "y", rz: Math.PI / 2 });

    /* ---------------------------------------------------------- GRIP
       steel frame, checkered polymer panels, grip safety on the back strap */
    K.prof(g, "uzi.gripFrame", K.grip(GF, GY, GD, GL, R, { swellB: 0.004 }), 0.064, steel, { bevel: 0.004 });
    K.prof(g, "uzi.gripPanel", [gp(0.040, 0.006), gp(GL - 0.020, 0.008), gp(GL - 0.020, GD - 0.014), gp(0.040, GD - 0.014)],
      GW, poly, { bevel: 0.005 });
    const chk = [];
    for (let i = 0; i < 6; i++) {
      const u = 0.058 + i * 0.024;
      chk.push([gp(u, 0.018), gp(u + 0.010, 0.018), gp(u + 0.010, GD - 0.028), gp(u, GD - 0.028)]);
    }
    K.prof(g, "uzi.gripChecks", chk, GW + 0.004, mat.black, { bevel: 0 });
    // grip safety: a lever standing proud of the back strap's top half
    K.prof(g, "uzi.gripSafety", [gp(0.020, GD - 0.004), gp(0.110, GD - 0.004), gp(0.104, GD + 0.008),
      gp(0.030, GD + 0.010), gp(0.014, GD + 0.004)], 0.036, blued, { bevel: 0.002 });

    /* ---------------------------------------------------------- MAGAZINE
       straight double stack running up inside the grip, base out the bottom */
    const MD = 0.080, MI = (GD - MD) / 2, M0 = GL * 0.80, M1 = GL + 0.070;
    K.tag(K.prof(g, "uzi.mag", [gp(M0, MI), gp(M1, MI), gp(M1, MI + MD), gp(M0, MI + MD)], 0.050, blued, { bevel: 0.003 }), "part_mag");
    K.tag(K.prof(g, "uzi.magBase", [gp(M1 - 0.004, MI - 0.006), gp(M1 + 0.012, MI - 0.006), gp(M1 + 0.012, MI + MD + 0.006),
      gp(M1 - 0.004, MI + MD + 0.006)], 0.058, steel, { bevel: 0.003 }), "part_mag");

    /* ---------------------------------------------------------- STOCK
       folded along the right flank: hinge knuckle at the rear, the skeleton
       arm (a plate with the lightening window), the butt plate up front */
    K.lathe(g, "uzi.hinge", [[0, -0.018], [0.011, -0.018], [0.012, -0.012], [0.012, 0.078], [0.011, 0.084], [0, 0.084]],
      12, steel, 0.052, 0, 0.010, { axis: "y" });
    K.prof(g, "uzi.stockArm", [[-0.018, -0.014], [0.334, -0.014], [0.334, 0.080], [-0.018, 0.080]], 0.008, steel,
      { bevel: 0.0015, x: 0.053, holes: [[[0.012, 0.004], [0.312, 0.004], [0.312, 0.062], [0.012, 0.062]]] });
    K.prof(g, "uzi.butt", [[0.324, -0.034], [0.352, -0.034], [0.358, -0.020], [0.358, 0.088], [0.350, 0.100], [0.324, 0.100]],
      0.022, steel, { bevel: 0.003, x: 0.068 });
    K.prof(g, "uzi.buttPad", [[0.328, -0.028], [0.352, -0.028], [0.352, 0.094], [0.328, 0.094]], 0.006, rubber, { bevel: 0.001, x: 0.081 });

    /* ---------------------------------------------------------- HAND + ANCHORS */
    K.hand(g, { at: [GY + S * GD / 2, -(GF - C * GD / 2)], rake: R, gripW: GW, gripD: GD, trigger: [-0.070, -0.312] });

    const muzzle = new THREE.Vector3(0, BY, -0.571);
    g.userData.muzzle = muzzle;
    const mid = gp((M0 + M1) / 2, MI + MD / 2), well = gp(GL, MI + MD / 2), hc = gp(0.100, GD / 2);
    // WHERE THE HANDS GO — see systems/gunhands.js. Mag-in-grip, so the off
    // hand has no handguard: it wraps the receiver's nose ahead of the guard.
    g.userData.grips = {
      support: new THREE.Vector3(0, 0.000, -0.290),
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "guard", y: 0.037, z: -0.270, w: 0.090, h: 0.134, rc: 0.012, len: 0.16, slide: 0 },
      mag: new THREE.Vector3(0, mid[1], -mid[0]),       // the magazine IS the grip
      charge: new THREE.Vector3(0, 0.126, -0.336),      // top-cover cocking knob
      style: "mag",
    };
    K.anchors(g, {
      k: K_M,
      grip: { pos: [0, hc[1], -hc[0]], rake: R },
      trigger: [0, -0.070, -0.313],
      support: { pos: [0, 0.037, -0.290], kind: "frame", len: 0.16 },
      muzzle: muzzle,
      mag: { pos: [0, mid[1], -mid[0]], well: [0, well[1], -well[0]], rake: R },
      stock: { pos: [0.084, 0.033, -0.340], folded: true },
      charge: [0, 0.126, -0.336],
      // the Micro Uzi is shot folded, held out at the chin: a long relief
      sight: { rear: [0, 0.142, -0.046], front: [0, 0.142, -0.404], eyeRelief: 0.36, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
