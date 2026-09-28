/* ============================================================
   weapons/appearances/glauncher.js — the 40mm: a Milkor M32 MGL.

   THE GUN: the six-shot revolving grenade launcher, stock extended. What
   makes it read as an MGL and not "a fat tube": the huge spring-driven
   CYLINDER in the middle, drawn as six real chamber tubes you can see into
   (a 40mm round seated in each), held between a round REAR FRAME PLATE and
   a FRONT FRAME PLATE that carries the barrel up top and the axle knob in
   the middle, the two joined by the axle and the TOP STRAP with its
   Picatinny rail; the short fat rifled BARREL (40mm bore you can look down)
   with a clamp and a bottom rail carrying the vertical FOREGRIP; the
   receiver with its trigger guard and AR-pattern pistol grip; the
   collapsing stock on its buffer tube with a rubber butt pad. Sights: the
   flip-up LADDER leaf on the rail (lowest rung for the close shot) and a
   winged front post on the front plate. Parkerized steel + flat dark earth
   polymer, olive drab rounds.

   Authored in real millimetres (f forward from the butt pad, y up from the
   bore) at k 1.6 through P(). Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const K_REAL = 1.6;
  const S = K_REAL / 1000;
  const F0 = 296, Y0 = 0.06;          // grip top centre near z 0.046, bore at y 0.06
  const P = (f, y) => [(f - F0) * S, y * S + Y0];
  const PS = (a) => a.map((p) => P(p[0], p[1]));
  const Z = (f) => -(f - F0) * S;
  const Yb = (y) => y * S + Y0;
  const MM = (a) => a.map((p) => [p[0] * S, p[1] * S]);
  const LA = (a) => a.map((p) => [p[0] * S, (p[1] - F0) * S]);      // lathe [radius mm, f mm]
  function arcPts(cx, cy, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return out;
  }
  const CYL_Y = -45, CH_R = 45, TUBE_R = 24, BORE_R = 20.5;

  // the six-tube cluster's outline: each tube's outer arc between the points
  // where it meets its neighbours (the deep flutes between tubes)
  function clusterSection() {
    const d = CH_R * Math.cos(Math.PI / 6), h = Math.sqrt(TUBE_R * TUBE_R - (CH_R * Math.sin(Math.PI / 6)) ** 2);
    const q = d + h;                   // outer meeting point, from the axis
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      const cx = CH_R * Math.cos(a), cy = CH_R * Math.sin(a);
      const m0 = [q * Math.cos(a - Math.PI / 6), q * Math.sin(a - Math.PI / 6)];
      const m1 = [q * Math.cos(a + Math.PI / 6), q * Math.sin(a + Math.PI / 6)];
      let g0 = Math.atan2(m0[1] - cy, m0[0] - cx), g1 = Math.atan2(m1[1] - cy, m1[0] - cx);
      while (g1 < g0) g1 += Math.PI * 2;
      for (let s = 0; s < 10; s++) { const gg = g0 + (g1 - g0) * (s / 10); pts.push([cx + TUBE_R * Math.cos(gg), cy + TUBE_R * Math.sin(gg)]); }
    }
    return pts;
  }
  function chamberHoles() {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      out.push(arcPts(CH_R * Math.cos(a), CH_R * Math.sin(a), BORE_R, 0, Math.PI * 2 * (15 / 16), 15));
    }
    return out;
  }

  CBZ.weaponAppearance.glauncher = function (ctx) {
    const { THREE, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const park = K.fin("parker"), tan = K.fin("mglTan"), rubber = K.fin("rubber"), od = K.fin("odStock");
    const g = new THREE.Group();

    // STOCK: buffer tube, the collapsing stock body riding it (extended),
    // rubber butt pad
    K.lathe(g, "mgl.tube", LA([[0, 70], [13, 70], [15, 73], [15, 262]]), 16, park, 0, Yb(-22), 0);
    K.prof(g, "mgl.stock", PS([[8, 10], [148, -2], [152, -9], [150, -38], [118, -46], [60, -72], [8, -98]]), 44 * S, tan,
      { bevel: 3 * S, holes: [PS([[28, -66], [70, -48], [96, -44], [96, -52], [70, -58], [28, -78]])] });
    K.prof(g, "mgl.pad", PS([[0, 8], [2, 12], [10, 12], [10, -100], [2, -100], [0, -96]]), 48 * S, rubber, { bevel: 2 * S });
    K.prof(g, "mgl.latch", PS([[120, -38], [146, -38], [146, -44], [124, -48]]), 12 * S, park, { bevel: 1 * S });

    // RECEIVER with the trigger guard (a real hole), trigger, pistol grip
    K.prof(g, "mgl.recv", PS([[255, 4], [268, 26], [333, 26], [333, -80], [335, -86], [333, -118], [326, -124],
      [282, -124], [276, -116], [272, -80], [262, -62], [255, -38]]), 50 * S, park,
    { bevel: 2 * S, holes: [PS([[328, -88], [328, -113], [322, -118], [292, -118], [286, -108], [288, -88]])] });
    K.prof(g, "mgl.trig", PS([[310, -80], [316, -80], [315, -92], [312, -103], [307, -108], [308, -101], [310.5, -92]]),
      7 * S, K.fin("blued"), { bevel: 0.8 * S });
    const R = 20 * Math.PI / 180, gd = 48 * S, gl = 105 * S, gf = P(290, -80);
    const gp = K.grip(gf[0], gf[1], gd, gl, R, { grooves: 3, swellB: 3 * S });
    K.prof(g, "mgl.grip", gp, 32 * S, tan, { bevel: 2.5 * S });
    const b0 = gp[8], b1 = gp[9];
    // the grip's bottom plug: a lip a touch proud of the straps
    const gd0 = [-Math.sin(R), -Math.cos(R)], gn0 = [Math.cos(R), -Math.sin(R)];
    const off = (b, a, n) => [b[0] + gd0[0] * a * S + gn0[0] * n * S, b[1] + gd0[1] * a * S + gn0[1] * n * S];
    K.prof(g, "mgl.gripCap", [off(b0, -5, 0), off(b0, 3, 1.5), off(b1, 3, -1.5), off(b1, -5, 0)], 34 * S, tan, { bevel: 1 * S });

    // FRAME PLATES + TOP STRAP + RAIL (the cylinder hangs between them)
    const rearPlate = arcPts(0, 0, 66, 110 * Math.PI / 180, 430 * Math.PI / 180, 28).concat([[22.6, 81], [-22.6, 81]]);
    K.prof(g, "mgl.rplate", MM(rearPlate), 14 * S, park, { axis: "z", bevel: 1.5 * S, y: Yb(CYL_Y), z: Z(338) });
    const frontPlate = arcPts(0, 45, 36, -0.2, Math.PI + 0.2, 14).concat(arcPts(0, 0, 30, Math.PI, Math.PI * 2, 10));
    K.prof(g, "mgl.fplate", MM(frontPlate), 14 * S, park, { axis: "z", bevel: 1.5 * S, y: Yb(CYL_Y), z: Z(489) });
    K.prof(g, "mgl.strap", PS([[268, 26], [496, 26], [496, 36], [268, 36]]), 36 * S, park, { bevel: 1.5 * S });
    const r0 = P(272, 36), r1 = P(494, 36);
    K.prof(g, "mgl.rail", K.rail(r0[0], r1[0], r0[1], 4 * S, 4 * S, 10 * S), 21 * S, park, { bevel: 0.6 * S });
    // axle knob (the cylinder release) on the front plate
    K.prof(g, "mgl.knob", MM(K.ribs(13, 11.5, 12)), 12 * S, K.fin("blued"), { axis: "z", bevel: 0.6 * S, y: Yb(CYL_Y), z: Z(502) });

    // THE CYLINDER: six hollow chamber tubes (the deep flutes between them),
    // a 40mm round seated in each
    K.prof(g, "mgl.cyl", MM(clusterSection()), 131 * S, park, { axis: "z", bevel: 0, holes: chamberHoles().map(MM), y: Yb(CYL_Y), z: Z(412.5) });
    const round = LA([[0, 380], [20, 380], [20, 452], [19, 460], [15, 466], [8, 469.5], [0, 470]]);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      K.lathe(g, "mgl.round", round, 10, od, CH_R * Math.cos(a) * S, Yb(CYL_Y + CH_R * Math.sin(a)), 0);
    }

    // BARREL: short, fat, hollow — the 40mm bore reads from the front
    K.lathe(g, "mgl.barrel", LA([[20.5, 490], [27, 490], [27, 752], [29.5, 755], [29.5, 775], [28, 778], [21.5, 778], [20.5, 776], [20.5, 492]]),
      24, park, 0, Y0, 0);
    const bore = cyl(g, BORE_R * S, 1.5 * S, mat.bore || mat.black, 0, Y0, Z(762), Math.PI / 2);
    if (bore) bore.userData.weaponBore = true;
    // barrel clamp bands + the bottom rail under the barrel
    K.lathe(g, "mgl.band", LA([[27, 0], [31, 2], [31, 12], [27, 14]].map((p) => [p[0], p[1] + 530])), 20, park, 0, Y0, 0);
    K.lathe(g, "mgl.band2", LA([[27, 0], [31, 2], [31, 12], [27, 14]].map((p) => [p[0], p[1] + 688])), 20, park, 0, Y0, 0);
    K.prof(g, "mgl.railBlk", PS([[536, -20], [700, -20], [700, -30], [536, -30]]), 24 * S, park, { bevel: 1 * S });
    const u0 = P(538, 0), u1 = P(698, 0);
    K.prof(g, "mgl.railLo", K.rail(u0[0], u1[0], 0, 4 * S, 4 * S, 10 * S), 21 * S, park, { bevel: 0.6 * S, y: Yb(-30) - 0 * S, rz: Math.PI });

    // VERTICAL FOREGRIP: rail clamp + a finger-grooved grip, raked like a
    // pistol grip (top forward)
    const VR = 0.10, vTop = [640, -46];
    K.prof(g, "mgl.vClamp", PS([[622, -37], [658, -37], [658, -47], [622, -47]]), 30 * S, park, { bevel: 1 * S });
    // (a side profile with chamfered edges: its section is the rounded
    // square the off hand's grasp closes on, finger grooves up the front)
    const VD = 36, VB = 5, vn = [Math.cos(VR), -Math.sin(VR)];
    const vf = P(vTop[0] + vn[0] * (VD / 2 - VB), vTop[1] + vn[1] * (VD / 2 - VB));
    K.prof(g, "mgl.vgrip", K.grip(vf[0], vf[1], (VD - 2 * VB) * S, 112 * S, VR, { grooves: 3, swellB: 1.5 * S }), 34 * S, tan, { bevel: VB * S });

    // SIGHTS: flip-up ladder leaf (rungs with daylight between) on the rail,
    // winged front post on the front plate's rail end
    K.prof(g, "mgl.leafBase", PS([[292, 44], [318, 44], [316, 52], [294, 52]]), 26 * S, park, { bevel: 1 * S });
    K.prof(g, "mgl.leaf", MM([[-13, 0], [13, 0], [13, 44], [3, 44], [2, 41], [-2, 41], [-3, 44], [-13, 44]]), 3 * S, mat.black,
      { axis: "z", bevel: 0.3 * S, y: Yb(52), z: Z(303), holes: [
        MM([[-9, 4], [9, 4], [9, 16], [-9, 16]]), MM([[-9, 21], [9, 21], [9, 30], [-9, 30]]), MM([[-9, 34], [9, 34], [9, 38], [-9, 38]])] });
    K.prof(g, "mgl.post", MM([[-14, 0], [14, 0], [14, 30], [10, 30], [10, 8], [2, 8], [2, 29], [-2, 29], [-2, 8], [-10, 8], [-10, 30], [-14, 30]]),
      8 * S, mat.black, { axis: "z", bevel: 0.4 * S, y: Yb(44), z: Z(486) });

    // the hand on the fire grip (top centre a few mm down the grip)
    const ax = [-Math.sin(R), -Math.cos(R)], nr = [Math.cos(R), -Math.sin(R)];
    const at = (t, u) => [gf[0] + ax[0] * gl * t - nr[0] * gd * u, gf[1] + ax[1] * gl * t - nr[1] * gd * u];
    const top = at(0.04, 0.5), trig = P(315, -90);
    K.hand(g, { at: [top[1], -top[0]], rake: R, gripW: 32 * S, gripD: gd, trigger: [trig[1], -trig[0]] });

    const muzzle = [0, Y0, Z(778)];
    g.userData.muzzle = new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]);
    const vy = Yb(vTop[1]), vz = Z(vTop[0]);
    const vAx = [0, Math.cos(VR), -Math.sin(VR)];
    const vMid = [0, vy + vAx[1] * -50 * S, vz + vAx[2] * -50 * S];
    const cylC = [0, Yb(CYL_Y), Z(412)];
    // WHERE THE HANDS GO — see systems/gunhands.js. Six chambers in a drum:
    // reloaded like a revolver, swung out to the weapon's LEFT.
    g.userData.grips = {
      support: new THREE.Vector3(vMid[0], vMid[1], vMid[2]),   // the vertical foregrip
      // the part the first-person off hand closes on (fpsmode.js fitOffHand)
      hold: { kind: "vgrip", y: vy, z: vz, rake: VR, w: 34 * S, d: 36 * S },
      mag: new THREE.Vector3(-0.17, cylC[1], cylC[2]),
      charge: null,
      style: "cylinder",
    };
    const well = [0, Y0, Z(440)];
    const magQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(well[0] - cylC[0], well[1] - cylC[1], well[2] - cylC[2]).normalize());
    const gc = at(0.4, 0.5);
    K.anchors(g, {
      k: K_REAL,
      grip: { pos: [0, gc[1], -gc[0]], rake: R },
      trigger: [0, trig[1], -trig[0]],
      support: { pos: vMid, rake: VR, kind: "vgrip", len: 115 * S },
      muzzle: muzzle,
      mag: { pos: cylC, well: well, quat: magQ },
      stock: [0, Yb(-44), Z(0)],
      bolt: null,
      charge: [0, Yb(CYL_Y), Z(507)],
      sight: { rear: [0, Yb(73), Z(303)], front: [0, Yb(73), Z(486)], eyeRelief: 0.08, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
