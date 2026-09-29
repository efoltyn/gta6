/* ============================================================
   weapons/appearances/taser.js — the TASER X26 with its cartridge.

   THE DEVICE: what makes it read as an X26 and not a yellow toy pistol:
   the one-piece safety-yellow polymer body with the rear housing humped
   over the web of the hand and the grip swept back under it, the long
   closed trigger guard, the deep lower frame in front of it carrying the
   LASER and LED windows, the REPLACEABLE CARTRIDGE — a separate grey block
   in the front bay with ribbed release tabs and a black blast-door face
   with its two stacked probe doors (the upper and lower probe) — the
   ambidextrous SAFETY switch at the top rear, the CID display on the back
   face, and the black battery pack (DPM) forming the base of the grip.
   Drawn one-handed: the other hand stays free for cuffs and radio.

   Authored in real millimetres (185 mm long with the cartridge, 33 mm wide;
   f forward from the rear of the body, y up from its top) at k 2.25 (the
   Glock's) through P(). Built on CBZ.gunKit (sidearm.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const K_REAL = 2.25;
  const S = K_REAL / 1000;
  const F0 = 28, Y0 = 0.0465;          // grip top centre at z 0, y -0.03
  const P = (f, y) => [(f - F0) * S, y * S + Y0];
  const PS = (a) => a.map((p) => P(p[0], p[1]));
  const Z = (f) => -(f - F0) * S;
  const Yb = (y) => y * S + Y0;
  const MM = (a) => a.map((p) => [p[0] * S, p[1] * S]);
  function circ(cx, cy, r, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return out;
  }

  CBZ.weaponAppearance.taser = function (ctx) {
    const { THREE, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const yellow = K.fin("taserYellow"), grey = K.fin("cartGrey"), rubber = K.fin("rubber"), black = mat.black;
    const g = new THREE.Group();

    // BODY: rear housing, cartridge bay wall, the laser housing under the
    // bay, the long closed trigger guard (a real hole) and the swept grip
    K.prof(g, "x26.body", PS([
      [6, 0], [143, 0], [143, -33], [178, -33], [180, -37], [179, -45], [172, -49], [140, -50], [132, -58],
      [124, -65], [116, -67], [58, -67], [46, -64], [40, -60], [36, -68], [35, -71], [-2, -56], [8, -30],
      [6, -24], [0, -14], [0, -6],
    ]), 33 * S, yellow, { bevel: 2.5 * S, holes: [
      PS([[58, -38], [118, -38], [126, -46], [120, -58], [112, -61], [62, -61], [53, -57], [50, -46]]),
    ] });
    // grip panels (rubberised, both sides) and the battery pack at the base
    K.prof(g, "x26.panel", PS([[44, -38], [37.5, -62], [20, -60], [4, -52], [8, -33]]), 34.2 * S, rubber, { bevel: 0 });
    K.prof(g, "x26.dpm", PS([[36, -69.5], [-3, -54], [-7.5, -65], [-4, -68.5], [29, -82], [33, -81]]), 34 * S, rubber, { bevel: 1.5 * S });
    // TRIGGER, its face forward
    K.prof(g, "x26.trig", PS([[88, -37], [94, -37], [93, -46], [90, -53], [86, -57], [87, -51], [88.5, -45]]), 7 * S, black, { bevel: 0.6 * S });
    // ambidextrous SAFETY switch, top rear, proud of both flanks
    K.prof(g, "x26.safety", PS([[20, -6], [34, -6], [35, -11], [21, -12]]), 35.4 * S, black, { bevel: 0.4 * S });
    // CID display on the back face of the rear housing
    K.prof(g, "x26.cid", MM([[-9, -6.5], [9, -6.5], [9, -13.5], [-9, -13.5]]), 1 * S, K.fin("lens"), { axis: "z", bevel: 0, y: Y0, z: Z(-2.8) });
    // LASER + LED windows on the front of the lower frame
    K.prof(g, "x26.laser", MM(circ(-5.5, 0, 3, 12)), 1 * S, K.fin("redDot"), { axis: "z", bevel: 0, y: Yb(-41), z: Z(180.4) });
    K.prof(g, "x26.led", MM(circ(6, 0, 3.6, 12)), 1 * S, K.fin("lens"), { axis: "z", bevel: 0, y: Yb(-41), z: Z(180.4) });

    // THE CARTRIDGE: a separate grey block in the bay, ribbed release tabs
    // on both sides, a black blast-door face with two stacked probe doors
    K.tag(K.prof(g, "x26.cart", PS([[143.5, -2.5], [183, -2.5], [185, -5], [185, -31], [183, -33], [143.5, -33]]), 30 * S, grey, { bevel: 1 * S }), "part_mag");
    const tabs = [];
    for (let i = 0; i < 5; i++) { const f = 150 + i * 3.4; tabs.push(PS([[f, -11], [f + 1.6, -11], [f + 1.6, -25], [f, -25]])); }
    K.tag(K.prof(g, "x26.tabs", tabs, 33 * S, black, { bevel: 0 }), "part_mag");
    K.tag(K.prof(g, "x26.face", MM([[-12, -4.5], [12, -4.5], [12, -31], [-12, -31]]), 1 * S, black, { axis: "z", bevel: 0, y: Y0, z: Z(185.6) }), "part_mag");
    K.tag(K.prof(g, "x26.doors", [MM([[-8, -6.5], [8, -6.5], [8, -14.5], [-8, -14.5]]), MM([[-8, -20.5], [8, -20.5], [8, -28.5], [-8, -28.5]])],
      0.8 * S, grey, { axis: "z", bevel: 0, y: Y0, z: Z(186.2) }), "part_mag");

    // the firing hand closed on the swept grip
    const R = 0.384, gTop = P(28, -34), trig = P(93.4, -44);
    K.hand(g, { at: [gTop[1], -gTop[0]], rake: R, gripW: 33 * S, gripD: 40 * S, trigger: [trig[1], -trig[0]] });

    const muzzle = [0, Yb(-18), Z(186.6)];
    g.userData.muzzle = new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]);
    const cart = [0, Yb(-18), Z(164)];
    // WHERE THE HANDS GO — see systems/gunhands.js. A taser is the one
    // firearm-shaped thing in the game that is drawn ONE-HANDED (the other
    // hand stays free for cuffs/radio), so it publishes no support grip and
    // the off arm keeps its ordinary swing.
    g.userData.grips = {
      support: null,
      mag: new THREE.Vector3(cart[0], cart[1], cart[2]),       // spent cartridge
      charge: null,
      style: "mag",
    };
    // the two probe doors (upper and lower probe) on the blast-door face
    g.userData.taserContacts = [
      new THREE.Vector3(0, Yb(-10.5), Z(186.6)),
      new THREE.Vector3(0, Yb(-24.5), Z(186.6)),
    ];
    const gc = P(28 - 18 * Math.sin(R), -34 - 18 * Math.cos(R));
    K.anchors(g, {
      k: K_REAL,
      grip: { pos: [0, gc[1], -gc[0]], rake: R },
      trigger: [0, trig[1], -trig[0]],
      support: { pos: [-16.8 * S, gc[1], -gc[0]], kind: "cup", len: 40 * S },
      muzzle: muzzle,
      mag: { pos: cart, well: [0, Yb(-18), Z(143.5)],
        quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)) },
      stock: null, bolt: null,
      charge: [16.9 * S, Yb(-9), Z(27)],
      optic: { type: "none", mag: 1 },
    });
    return g;
  };
})();
