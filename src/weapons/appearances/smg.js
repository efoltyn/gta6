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

  // coated see-through glass, cached on the caller's material table
  function smgGlass(ctx, hex) {
    const key = "gk_glass_" + hex.toString(16);
    if (!ctx.mat[key]) {
      const m = new ctx.THREE.MeshPhongMaterial({ color: hex, specular: 0xd8ecff, shininess: 110, transparent: true,
        opacity: 0.3, depthWrite: false, side: ctx.THREE.DoubleSide });
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
    // (axis-z profiles mirror x: drawn at +x, it lands on the LEFT)
    K.prof(g, "mp5.lever", [[0.008, 0.080], [0.014, 0.090], [0.046, 0.104], [0.056, 0.104], [0.058, 0.112], [0.048, 0.117],
      [0.040, 0.112], [0.010, 0.098], [0.004, 0.090]], 0.014, mat.black, { axis: "z", bevel: 0.002, z: -0.500 });
    // slim polymer handguard with a front lip
    K.prof(g, "mp5.hg", [[0.410, 0.066], [0.610, 0.066], [0.620, 0.050], [0.620, -0.010], [0.600, -0.016], [0.410, 0.006]],
      0.070, poly, { bevel: 0.008 });
    // RING front sight on its base at the end of the cocking tube, the
    // tapered post standing up inside the ring
    K.prof(g, "mp5.fsbase", [[0.680, 0.030], [0.720, 0.030], [0.720, 0.100], [0.700, 0.104], [0.680, 0.098]],
      0.034, steel, { bevel: 0.004 });
    const ring = [], hole = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.032, Math.sin(a) * 0.032]);
      hole.push([Math.cos(-a) * 0.022, Math.sin(-a) * 0.022]);
    }
    K.prof(g, "mp5.fsring", ring, 0.024, steel, { axis: "z", bevel: 0.003, holes: [hole], y: 0.132, z: -0.700 });
    K.prof(g, "mp5.post", [[0.697, 0.106], [0.703, 0.106], [0.702, 0.131], [0.701, 0.135], [0.699, 0.135], [0.698, 0.131]],
      0.005, mat.black, { bevel: 0.0008 });
    // barrel + the three-lug end (suppressor/flash-hider lugs) + open bore
    K.tube(g, 0.014, 0.015, 0.160, 12, blued, 0, BORE, -0.700);
    const lugs = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const r = Math.cos(3 * a) > 0.55 ? 0.0235 : 0.019;
      lugs.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    K.prof(g, "mp5.lugs", lugs, 0.046, blued, { axis: "z", bevel: 0.0015, y: BORE, z: -0.757 });
    const bore = cyl(g, 0.010, 0.006, mat.bore || mat.black, 0, BORE, -0.780, Math.PI / 2);
    bore.userData.weaponBore = true;

    // rotary DRUM rear sight: base hugging the receiver, the knurled drum
    // turning about the bore axis, the aperture in use at its top
    K.prof(g, "mp5.drumBase", [[-0.022, 0.088], [0.022, 0.088], [0.022, 0.104], [0.016, 0.110], [-0.016, 0.110], [-0.022, 0.104]],
      0.040, steel, { axis: "z", bevel: 0.003, z: -0.010 });
    K.lathe(g, "mp5.drum", [[0, -0.017], [0.019, -0.017], [0.021, -0.015], [0.021, 0.015], [0.019, 0.017], [0, 0.017]],
      16, mat.black, 0, 0.124, -0.010);
    K.prof(g, "mp5.drumKnurl", K.ribs(0.0225, 0.0205, 18), 0.012, mat.black, { axis: "z", bevel: 0, y: 0.124, z: -0.010 });
    cyl(g, 0.0032, 0.002, mat.bore || mat.black, 0, 0.1405, 0.0072, Math.PI / 2);   // the rear aperture

    // HK CLAW MOUNT: a bar with four claws hooking the receiver, the
    // locking knob on the left, a Picatinny top for the micro dot
    const dot = new THREE.Group();
    dot.name = "_baseOptic";
    dot.position.set(0, 0, -0.150);
    g.add(dot);
    K.prof(dot, "mp5.clawBar", [[-0.060, 0.100], [0.060, 0.100], [0.060, 0.110], [0.054, 0.117], [-0.054, 0.117], [-0.060, 0.110]],
      0.044, steel, { bevel: 0.002 });
    for (const z of [-0.045, 0.045]) {
      K.prof(dot, "mp5.claw", [[-0.028, 0.110], [0.028, 0.110], [0.028, 0.084], [0.024, 0.079], [0.020, 0.086], [0.020, 0.098],
        [-0.020, 0.098], [-0.020, 0.086], [-0.024, 0.079], [-0.028, 0.084]], 0.020, steel, { axis: "z", bevel: 0.0015, z: z });
    }
    K.prof(dot, "mp5.clawKnob", K.ribs(0.011, 0.0095, 12).map((p) => [p[0], p[1] + 0.104]), 0.010, mat.black,
      { bevel: 0.001, x: -0.031 });
    K.prof(dot, "mp5.clawRail", K.rail(-0.050, 0.050, 0.116, 0.006, 0.006), 0.040, mat.black, { bevel: 0.0015 });
    // AIMPOINT MICRO T-2: clamp base, the short turned housing with its
    // front hood, elevation cap on top, windage cap and brightness dial on
    // the right, coated glass both ends, the dot seen on the objective
    const AX = 0.160;
    K.prof(dot, "t2.base", [[-0.024, 0.118], [-0.0205, 0.118], [-0.0205, 0.128], [0.0205, 0.128], [0.0205, 0.118], [0.024, 0.118],
      [0.024, 0.132], [0.014, 0.142], [-0.014, 0.142], [-0.024, 0.132]], 0.050, mat.black, { axis: "z", bevel: 0.0015 });
    cyl(dot, 0.006, 0.008, steel, 0.027, 0.124, 0, 0, 0, Math.PI / 2);                // cross-bolt nut
    K.lathe(dot, "t2.body", [
      [0.0165, -0.056], [0.0205, -0.056], [0.0205, -0.055], [0.022, -0.051], [0.0245, -0.047], [0.0245, -0.047],
      [0.0245, 0.036], [0.0245, 0.036], [0.026, 0.040], [0.026, 0.056], [0.026, 0.056], [0.0215, 0.056], [0.0215, 0.056],
      [0.0205, 0.046], [0.0175, 0.040], [0.0175, -0.046], [0.0165, -0.050], [0.0165, -0.056],
    ], 22, mat.black, 0, AX, 0);
    K.lathe(dot, "t2.turret", [[0, 0.016], [0.0105, 0.016], [0.0105, 0.030], [0.0092, 0.0325], [0, 0.0325]], 14, mat.black,
      0, AX, 0.002, { axis: "y" });
    K.lathe(dot, "t2.turret", [[0, 0.016], [0.0105, 0.016], [0.0105, 0.030], [0.0092, 0.0325], [0, 0.0325]], 14, mat.black,
      0, AX, -0.016, { axis: "y", rz: -Math.PI / 2 });
    K.prof(dot, "t2.dial", K.ribs(0.0145, 0.013, 16).map((p) => [p[0] - 0.024, p[1] + AX]), 0.010, mat.black,
      { bevel: 0.001, x: 0.026 });
    const glass = smgGlass(ctx, 0xa890c8);
    cyl(dot, 0.0165, 0.0015, glass, 0, AX, 0.052, Math.PI / 2);
    cyl(dot, 0.0205, 0.0015, glass, 0, AX, -0.047, Math.PI / 2);
    cyl(dot, 0.0012, 0.0008, K.fin("redDot"), 0, AX, -0.046, Math.PI / 2);
    K.opticAnchors(dot, { type: "reddot", mag: 1, rear: [0, AX, 0.052], front: [0, AX, -0.047], lensR: 0.0165, eyeRelief: 0.20, k: 1.64 });

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
    K.prof(g, "mp5.mag", mf.concat(mb.reverse()), 0.040, mat.dark, { bevel: 0.003 });

    // POLYMER TRIGGER GROUP: housing + the big wrap-around guard + grip
    K.prof(g, "mp5.tgroup", [
      [-0.020, 0.030], [0.236, 0.030], [0.240, -0.020], [0.226, -0.030], [0.214, -0.108],
      [0.196, -0.118], [0.104, -0.118], [0.080, -0.040], [-0.020, -0.030],
    ], 0.058, poly, { bevel: 0.004, holes: [[[0.200, -0.036], [0.188, -0.104], [0.114, -0.104], [0.100, -0.040]]] });
    K.prof(g, "mp5.trig", triggerBlade(0.141, -0.058, -0.030), 0.010, mat.black, { bevel: 0.001 });
    const R = 16 * Math.PI / 180;
    K.prof(g, "mp5.grip", K.grip(0.090, -0.034, 0.076, 0.170, R, { grooves: 3, swellB: 0.004 }), 0.054, poly, { bevel: 0.005 });

    // A2 FIXED STOCK + rubber pad
    K.prof(g, "mp5.stock", [
      [-0.018, 0.086], [-0.300, 0.080], [-0.312, 0.070], [-0.312, -0.098], [-0.286, -0.104],
      [-0.120, -0.004], [-0.040, 0.018], [-0.018, 0.024],
    ], 0.056, poly, { bevel: 0.006 });
    K.prof(g, "mp5.pad", [[-0.310, 0.074], [-0.328, 0.072], [-0.332, 0.062], [-0.332, -0.094], [-0.326, -0.102], [-0.310, -0.098]],
      0.060, K.fin("rubber"), { bevel: 0.003 });

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
    // THE ANCHORS (contract: sidearm.js); sight/lens/optic from the T-2
    const mm = [(mf[4][0] + mb[4][0]) / 2, (mf[4][1] + mb[4][1]) / 2];
    const ma = Math.atan2(mf[5][0] - mf[3][0], -(mf[5][1] - mf[3][1]));   // the curve's lean at mid-body
    K.anchors(g, {
      k: 1.64,
      grip: { pos: gripCentre(0.090, -0.034, 0.076, R, 0.070), rake: R },
      trigger: [0, -0.058, -0.142],
      support: { pos: [0, 0.025, -0.510], kind: "guard", len: 0.20 },
      mag: { pos: [0, mm[1], -mm[0]], well: [0, -0.040, -0.312], rake: -ma },
      stock: [0, -0.012, 0.332],
      bolt: null,
      charge: [-0.052, 0.110, -0.500],
      optic: { type: "reddot", mag: 1 },
    });
    return g;
  };
})();
