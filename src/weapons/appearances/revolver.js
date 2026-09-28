/* ============================================================
   weapons/appearances/revolver.js — the .357 Magnum: a Colt Python, 6in.

   THE GUN: the show-off wheelgun, and it has to read as a PYTHON, not as
   "a revolver". Its tells, all modelled at real size (mm x k 2.25, like the
   Glock): the full-length VENTILATED RIB standing on the barrel (seven slots
   you can see daylight through), the full-length UNDERLUG shrouding the
   ejector rod right to the muzzle face (the barrel + lug are one keyhole
   section, as the real forging is), the FLUTED six-shot cylinder hanging
   below the bore (chamber mouths on its face, brass case heads in the
   breech gap, the forcing cone across the cylinder gap), the frame window
   and TOP STRAP carrying the adjustable rear sight, the ramped front blade
   with its red insert, the exposed hammer with a checkered spur, the
   cylinder latch on the left, the ROUND trigger guard with a real hole, and
   walnut target grips (finger swell, checkered panels). Colt Royal Blue.

   Coordinates: authored in real millimetres (f forward from the back of the
   top strap, y up from the bore axis) through P(), so every number below is
   a measurement. Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const K_REAL = 2.25;                 // model units per real metre (the Glock's)
  const S = K_REAL / 1000;             // per millimetre
  const F0 = 23, Y0 = 0.03;           // grip top centre at z 0, bore at y 0.03 (TP aim-down arm clearance)
  const P = (f, y) => [(f - F0) * S, y * S + Y0];
  const PS = (a) => a.map((p) => P(p[0], p[1]));
  const Z = (f) => -(f - F0) * S;
  const Yb = (y) => y * S + Y0;
  const LA = (a) => a.map((p) => [p[0] * S, (p[1] - F0) * S]);   // lathe [radius mm, f mm]
  const MM = (a) => a.map((p) => [p[0] * S, p[1] * S]);     // front profiles about the axis
  function ellipse(cx, cy, rx, ry, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return out;
  }

  // the fluted cylinder's cross-section: R 19.75 with six flutes (circles of
  // r 5.5 centred 23 out) BETWEEN the chambers (chambers sit at 90 + 60i)
  function flutedSection() {
    const R = 19.75, D = 23, rf = 5.5;
    const al = Math.acos((R * R + D * D - rf * rf) / (2 * R * D));
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const phi = i * Math.PI / 3, next = (i + 1) * Math.PI / 3;
      const cx = D * Math.cos(phi), cy = D * Math.sin(phi);
      const ang = (x, y) => Math.atan2(y - cy, x - cx);
      let gA = ang(R * Math.cos(phi - al), R * Math.sin(phi - al));
      let gB = ang(R * Math.cos(phi + al), R * Math.sin(phi + al));
      const mid = phi + Math.PI;
      const wrap = (a) => mid + Math.atan2(Math.sin(a - mid), Math.cos(a - mid));
      gA = wrap(gA); gB = wrap(gB);
      for (let s = 0; s <= 6; s++) {
        const g = gA + (gB - gA) * (s / 6);
        pts.push([cx + rf * Math.cos(g), cy + rf * Math.sin(g)]);
      }
      for (let s = 1; s < 6; s++) {
        const a = phi + al + (next - al - (phi + al)) * (s / 6);
        pts.push([R * Math.cos(a), R * Math.sin(a)]);
      }
    }
    return pts;
  }
  const circle = (cx, cy, r, n) => ellipse(cx, cy, r, r, 0, Math.PI * 2 * (1 - 1 / n), n - 1);

  CBZ.weaponAppearance.revolver = function (ctx) {
    const { THREE, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const blue = K.fin("royalBlue"), wood = K.fin("walnut"), cut = K.fin("walnutCheck");
    const black = mat.black, brass = K.fin("caseBrass"), red = K.fin("redInsert");
    const g = new THREE.Group();
    const CYL_Y = -12.5;                 // cylinder axis below the bore (the top chamber fires)

    // FRAME: top strap, cylinder window, the round trigger guard with its
    // hole, and the grip-frame tang rising behind the grips under the hammer
    K.prof(g, "py.frame", PS([
      [121, 18], [121, -30], [118, -40], [100, -41]]
      .concat(ellipse(71, -44, 26, 24, 0, -Math.PI, 12))
      .concat([[40, -50], [30, -57], [2, -31], [-2, -23], [-5, -13], [-3, -4], [2, 6], [7, 14], [13, 18]])),
      30 * S, blue, { bevel: 1.2 * S, holes: [
        PS([[71.5, -34], [118.5, -34], [118.5, 8], [71.5, 8]]),
        PS(ellipse(71, -44, 20, 18, 0, -Math.PI, 10).concat([[51, -38], [91, -38]])),
      ] });

    // BARREL + UNDERLUG: one keyhole section (round barrel, flat-sided lug
    // shrouding the ejector rod) from the frame to the muzzle
    const lug = ellipse(0, 0, 10.5, 10.5, -0.63, Math.PI + 0.63, 14)
      .concat(ellipse(0, -20, 8.5, 8.5, Math.PI, Math.PI * 2, 8));
    K.prof(g, "py.barrel", MM(lug), 148 * S, blue, { axis: "z", bevel: 0.8 * S, y: Y0, z: Z(193) });
    // the VENTILATED RIB: posts and daylight, full length
    const vents = [];
    for (let i = 0; i < 7; i++) { const f = 128 + i * 16; vents.push(PS([[f, 11.5], [f + 11, 11.5], [f + 11, 15.8], [f, 15.8]])); }
    K.prof(g, "py.rib", PS([[118, 8], [267, 8], [267, 18], [118, 18]]), 7 * S, blue, { bevel: 0.5 * S, holes: vents });
    // bore, and the ejector rod's head in the lug's face
    const bore = cyl(g, 4.55 * S, 1.6 * S, mat.bore || black, 0, Y0, Z(267), Math.PI / 2);
    if (bore) bore.userData.weaponBore = true;
    cyl(g, 3.2 * S, 1.2 * S, K.fin("edge"), 0, Yb(-20), Z(267), Math.PI / 2);
    // forcing cone across the cylinder gap (0.6 mm of daylight)
    K.lathe(g, "py.cone", LA([[0, 115.6], [7.4, 115.6], [8.6, 117], [8.6, 119.5]]), 16, blue, 0, Y0, 0);

    // THE CYLINDER: plain rear band, fluted body, plain front band
    K.lathe(g, "py.cylR", LA([[0, 73], [18.8, 73], [19.75, 74], [19.75, 80]]), 30, blue, 0, Yb(CYL_Y), 0);
    K.prof(g, "py.cylF", MM(flutedSection()), 31 * S, blue, { axis: "z", bevel: 0, y: Yb(CYL_Y), z: Z(95.5) });
    K.lathe(g, "py.cylFr", LA([[19.75, 111], [19.75, 113.8], [18.8, 115], [0, 115]]), 30, blue, 0, Yb(CYL_Y), 0);
    const ch = [], heads = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3, cx = 12.5 * Math.cos(a), cy = 12.5 * Math.sin(a);
      ch.push(MM(circle(cx, cy, 4.6, 12)));
      heads.push(MM(circle(cx, cy, 5.4, 12)));
    }
    K.prof(g, "py.mouths", ch, 0.6 * S, mat.bore || black, { axis: "z", bevel: 0, y: Yb(CYL_Y), z: Z(115.2) });
    K.prof(g, "py.heads", heads, 0.8 * S, brass, { axis: "z", bevel: 0, y: Yb(CYL_Y), z: Z(72.6) });

    // SIGHTS: adjustable rear on the top strap, ramped front blade with its
    // red insert facing the eye
    K.prof(g, "py.rsBase", PS([[5, 16], [31, 16], [31, 19.5], [27, 21.2], [8, 21.2], [5, 19.5]]), 12 * S, blue, { bevel: 0.6 * S });
    K.prof(g, "py.rsBlade", MM([[-7, 0], [7, 0], [7, 7], [1.5, 7], [1.5, 3.5], [-1.5, 3.5], [-1.5, 7], [-7, 7]]),
      4 * S, black, { axis: "z", bevel: 0.4 * S, y: Yb(21), z: Z(10) });
    cyl(g, 1.4 * S, 2 * S, K.fin("edge"), 6.8 * S, Yb(23.5), Z(20), 0, 0, Math.PI / 2);   // windage screw
    K.prof(g, "py.front", PS([[247, 17], [266, 17], [266, 19.5], [249.5, 29.5], [247, 29.5]]), 3.2 * S, blue, { bevel: 0.3 * S });
    K.prof(g, "py.insert", PS([[246.6, 21.5], [249, 21.5], [249, 28.8], [246.6, 28.8]]), 2.6 * S, red, { bevel: 0 });

    // HAMMER with the checkered spur, raked back over the web of the hand
    K.prof(g, "py.hammer", PS([[10, 12], [6, 20], [0, 24], [-8, 27], [-16, 28.5], [-21, 27], [-19, 24.5],
      [-12, 23], [-4, 19], [0, 10], [1, 0], [6, 2]]), 7 * S, blue, { bevel: 0.6 * S });
    const spurTop = (f) => f < -16 ? 27 + (f + 21) * 0.3 : 28.5 - (f + 16) * 0.1875;
    const teeth = [];
    for (let f = -19; f <= -7; f += 2.2) { const y = spurTop(f + 0.5); teeth.push(PS([[f, y - 0.9], [f + 1, y - 0.9], [f + 1, y + 0.5], [f, y + 0.5]])); }
    K.prof(g, "py.spur", teeth, 7.8 * S, black, { bevel: 0 });
    // cylinder release latch (left, behind the cylinder) + side-plate screws
    K.prof(g, "py.latch", PS([[55, -3], [66, -3], [67.5, 4], [57, 6]]), 3.5 * S, blue, { bevel: 0.5 * S, x: -16.2 * S });
    cyl(g, 2.3 * S, 0.8 * S, K.fin("edge"), 15.2 * S, Yb(-12), Z(40), 0, 0, Math.PI / 2);
    cyl(g, 2.3 * S, 0.8 * S, K.fin("edge"), 15.2 * S, Yb(-30), Z(56), 0, 0, Math.PI / 2);
    // TRIGGER: a curved blade in the guard, its face forward
    K.prof(g, "py.trigger", PS([[77, -37], [81, -37], [80.5, -44], [79, -51], [76, -57], [72.5, -60],
      [73.5, -56], [75.5, -50], [76.5, -44]]), 6 * S, blue, { bevel: 0.5 * S });

    // WALNUT TARGET GRIPS: raked, a finger swell on the front strap, flared
    // heel, and a checkered panel (diamonds proud of the cut field) per side
    const R = 0.30, gd = 44 * S, gl = 96 * S;
    const gff = P(44, -42);
    const gp = K.grip(gff[0], gff[1], gd, gl, R, { swellF: 4 * S, swellB: 3 * S, grooves: 2 });
    K.prof(g, "py.grip", gp, 38 * S, wood, { bevel: 2.2 * S });
    const ax = [-Math.sin(R), -Math.cos(R)], nr = [Math.cos(R), -Math.sin(R)];
    const at = (t, u) => [gff[0] + ax[0] * gl * t - nr[0] * gd * u, gff[1] + ax[1] * gl * t - nr[1] * gd * u];
    K.prof(g, "py.chkField", [at(0.2, 0.2), at(0.2, 0.8), at(0.84, 0.82), at(0.84, 0.18)], 38.5 * S, cut, { bevel: 0 });
    const dia = [], h = 1.7 * S;
    for (let t = 0.23; t < 0.82; t += 0.052) for (let u = 0.26; u < 0.78; u += 0.12) {
      const c = at(t, u);
      dia.push([[c[0] + ax[0] * h, c[1] + ax[1] * h], [c[0] + nr[0] * h, c[1] + nr[1] * h],
        [c[0] - ax[0] * h, c[1] - ax[1] * h], [c[0] - nr[0] * h, c[1] - nr[1] * h]]);
    }
    K.prof(g, "py.chk", dia, 39.1 * S, wood, { bevel: 0 });

    // the firing hand on the grip (top centre a few mm down the grip)
    const top = at(0.05, 0.5), trig = P(80.3, -46);
    K.hand(g, { at: [top[1], -top[0]], rake: R, gripW: 38 * S, gripD: gd, trigger: [trig[1], -trig[0]] });

    const muzzle = [0, Y0, Z(267)];
    g.userData.muzzle = new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]);
    const gc = at(0.38, 0.5), cylC = [0, Yb(CYL_Y), Z(94)], spur = P(-13, 26.5);
    // WHERE THE HANDS GO — see systems/gunhands.js. A wheelgun is fed
    // through the cylinder, which swings out to the gun's LEFT.
    g.userData.grips = {
      support: new THREE.Vector3(-0.090, gc[1] - 0.03, -gc[0]),
      mag: new THREE.Vector3(-0.105, cylC[1], cylC[2]),
      charge: new THREE.Vector3(0, spur[1], -spur[0]),      // the hammer spur
      style: "cylinder",
    };
    const well = [0, Y0, Z(72.6)];
    const magQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(well[0] - cylC[0], well[1] - cylC[1], well[2] - cylC[2]).normalize());
    const rs = [0, Yb(24.5), Z(10)], fs = P(247.6, 29.5);
    K.anchors(g, {
      k: K_REAL,
      grip: { pos: [0, gc[1], -gc[0]], rake: R },
      trigger: [0, trig[1], -trig[0]],
      support: { pos: [-17 * S, gc[1], -gc[0]], kind: "cup", len: gd },
      muzzle: muzzle,
      mag: { pos: cylC, well: well, quat: magQ },
      stock: null, bolt: null,
      charge: [0, spur[1], -spur[0]],
      sight: { rear: rs, front: [0, fs[1], -fs[0]], eyeRelief: 0.42, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
