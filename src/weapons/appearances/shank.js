/* ============================================================
   weapons/appearances/shank.js — the improvised prison blade.

   WHY THIS IS NOT city/itemassets.js's `melee` knife. That branch draws a
   KNIFE: a symmetric blade, a moulded handle and a finger guard — a thing
   bought in a shop. A shank is the opposite object. Nobody issued it, nobody
   finished it, and every one of its shapes is an apology for a missing tool:

     · the blade is a STRIP OF SCAVENGED FLAT BAR (bed-frame stock, a strap
       hinge) filed on a floor: flat, wide enough to show a face, with a
       narrow tang running back into the grip. Its taper is asymmetric — the
       left edge was ground in a long sweep, the right (the spine) only
       knocked in near the point — so the point sits off the old centreline
       of the bar and the tip is a flat chisel wedge, not a needle;
     · only the GROUND EDGE is bright: one extrusion for the dark oxidised
       bar and a thinner one for the filed bevel beside it, so the grind line
       is a real step you can see catch the light;
     · there is NO GUARD. What stops the hand is the wrap: bedsheet strip
       wound wet into a lumpy oval (a lathe, fattest under the palm), bound
       over with four turns of black electrical tape that do not sit square,
       and the loose tail of the strip hanging off the butt;
     · a finger's width of bare tang shows between the wrap and the blade.

   Authored on this file family's convention: long axis on Z with the working
   end at -Z (systems/actorweapons.js's hand-mount transform puts -Z past the
   fingers), grip toward +Z where the fist closes. `userData.muzzle` is the
   POINT — the one place a consumer that thinks in barrels can ask this weapon
   where its business end is, so prisondrops' ground solve, the icon camera and
   the stab's reach all read the same tip instead of three guesses.
   ~2.2 model units per real metre (0.26 m overall).

   Perf: every geometry and material is built once and shared (_shared) by
   every shank in the world; 9 meshes. Cheap enough for a whole wing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const Y0 = 0.004;            // the blade's mid-plane height
  const TIP = [0, 0.362];      // [x, forward] of the point
  const WRAP0 = -0.012, WRAP_LEN = 0.162;   // the wrap runs z -0.012 .. 0.150
  const OVAL = [1.25, 0.85];   // the wrap is wound round a FLAT tang: an oval

  // [x, forward (= -z)] edges of the bar, tang tail -> point
  const LEFT = [[-0.013, -0.150], [-0.013, 0.008], [-0.022, 0.026], [-0.0225, 0.100], [-0.022, 0.160],
    [-0.018, 0.240], [-0.011, 0.300], [-0.004, 0.340]];
  const RIGHT = [[0.006, 0.346], [0.013, 0.318], [0.019, 0.262], [0.022, 0.180], [0.023, 0.030], [0.013, 0.010], [0.013, -0.150]];
  // the grind line: where the filed bevel meets the flat of the bar
  const GRIND = [[-0.0225, 0.100], [-0.015, 0.140], [-0.013, 0.200], [-0.009, 0.260], [-0.004, 0.310], [0.000, 0.345]];

  let LOCAL = null;
  function locals(THREE) {
    if (LOCAL) return LOCAL;
    /* These are DARK on purpose, and it was measured rather than chosen: a
       prison yard is white concrete under a noon sun and mid-grey on
       near-white is no silhouette at all. Scavenged bar stock is oxidised
       nearly black; the only bright thing on a shank is the few square
       centimetres somebody has actually ground. */
    const mats = {
      stock: new THREE.MeshLambertMaterial({ color: 0x3b424b }),
      honed: new THREE.MeshPhongMaterial({ color: 0xb9c4cd, shininess: 70, specular: 0x9aa6b0 }),
      wrap: new THREE.MeshLambertMaterial({ color: 0x6d6555 }),
      wrapDark: new THREE.MeshLambertMaterial({ color: 0x453f34 }),
      tape: new THREE.MeshPhongMaterial({ color: 0x17181a, shininess: 26, specular: 0x2a2c30 }),
    };
    const shape = (pts) => {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
      return s;
    };
    // an outline in [x, forward] extruded through the blade's thickness (y)
    const plate = (pts, thick, bev) => {
      const g = new THREE.ExtrudeGeometry(shape(pts), {
        depth: Math.max(0.0005, thick - 2 * bev), steps: 1, bevelEnabled: true,
        bevelThickness: bev, bevelSize: bev * 1.1, bevelSegments: 1, curveSegments: 2,
      });
      g.translate(0, 0, -(thick - 2 * bev) / 2);
      g.rotateX(-Math.PI / 2);          // shape y (forward) -> -z, extrusion -> +y
      g.computeVertexNormals();
      return g;
    };
    // the flat of the bar: tang, the unground left edge, the grind line, the spine
    const bar = [].concat(LEFT.slice(0, 4), GRIND.slice(1), [TIP], RIGHT);
    // the filed bevel: the left edge from the grind's start to the point, back up the grind line
    const bevel = [].concat(LEFT.slice(3), [TIP], GRIND.slice().reverse().slice(0, -1));
    // the wrap: lumpy, fattest under the palm; [radius, along the handle]
    const wrapPts = [[0, 0], [0.013, 0], [0.018, 0.006], [0.021, 0.022], [0.0235, 0.046], [0.0225, 0.070],
      [0.0245, 0.094], [0.0235, 0.120], [0.021, 0.142], [0.017, 0.157], [0.010, WRAP_LEN], [0, WRAP_LEN]];
    const wrap = new THREE.LatheGeometry(wrapPts.map((p) => new THREE.Vector2(p[0], p[1])), 14);
    wrap.rotateX(Math.PI / 2);          // lathe +y -> +z (toward the butt)
    wrap.computeVertexNormals();
    // one tape turn at unit radius, 1.3 cm-model wide; scaled per turn
    const band = new THREE.LatheGeometry([[0.93, 0], [1, 0.0015], [1, 0.0115], [0.93, 0.013]]
      .map((p) => new THREE.Vector2(p[0], p[1])), 16);
    band.rotateX(Math.PI / 2);
    band.computeVertexNormals();
    // the loose tail: a strip of sheet hanging off the butt, drawn as a side
    // profile [z, y] and extruded across its width (x)
    const tc = [[0.144, -0.008], [0.160, -0.012], [0.172, -0.020], [0.180, -0.034], [0.184, -0.050]];
    const tailPts = tc.map((p) => [p[0], p[1] + 0.0022]).concat(tc.slice().reverse().map((p) => [p[0] + 0.0012, p[1] - 0.0022]));
    const tail = new THREE.ExtrudeGeometry(shape(tailPts), { depth: 0.017, bevelEnabled: false, curveSegments: 2 });
    tail.translate(0, 0, -0.0085);
    tail.rotateY(-Math.PI / 2);         // shape x -> z, extrusion -> x
    tail.computeVertexNormals();
    LOCAL = {
      mat: mats,
      geo: { bar: plate(bar, 0.0105, 0.0022), bevel: plate(bevel, 0.0055, 0.0012), wrap: wrap, band: band, tail: tail },
    };
    Object.keys(LOCAL.mat).forEach((k) => { LOCAL.mat[k]._shared = true; });
    Object.keys(LOCAL.geo).forEach((k) => { LOCAL.geo[k]._shared = true; });
    return LOCAL;
  }

  function part(parent, THREE, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  CBZ.weaponAppearance.shank = function (ctx) {
    const THREE = ctx.THREE;
    const L = locals(THREE), G = L.geo, M = L.mat;
    const g = new THREE.Group();

    part(g, THREE, G.bar, M.stock, 0, Y0, 0);
    part(g, THREE, G.bevel, M.honed, 0, Y0, 0);

    const wrap = part(g, THREE, G.wrap, M.wrap, 0, Y0, WRAP0);
    wrap.scale.set(OVAL[0], OVAL[1], 1);
    // four tape turns, each a little crooked, sized to the wrap under it
    const TURNS = [[0.008, 0.0212, 0.10, -0.06], [0.040, 0.0242, -0.07, 0.05], [0.090, 0.0256, 0.05, 0.09], [0.132, 0.0236, -0.09, -0.04]];
    for (const t of TURNS) {
      const b = part(g, THREE, G.band, M.tape, 0, Y0, WRAP0 + t[0], t[2], t[3], 0);
      b.scale.set(t[1] * OVAL[0], t[1] * OVAL[1], 1);
    }
    part(g, THREE, G.tail, M.wrapDark, 0.002, Y0, 0);

    // The working end, for every consumer that needs one point: the stab's
    // reach, the ground solve, the icon framing.
    g.userData.muzzle = new THREE.Vector3(TIP[0], Y0, -TIP[1]);
    g.userData.meleeTip = g.userData.muzzle;

    /* THE ANCHORS (contract: sidearm.js). A blade has no bore: `muzzle` is
       the POINT (the business end), its -Z the way it stabs. The grip is the
       wrap's centre; its quat keeps +Y UP like every grip (the fist closes
       round a level handle), and the handle's own axis rides along as `axis`,
       running from the butt toward the point (-Z). */
    if (CBZ.gunAnchors) CBZ.gunAnchors.stamp(THREE, g, {
      k: 2.2,
      grip: { pos: [0, Y0, WRAP0 + WRAP_LEN * 0.5], rake: 0, axis: [0, 0, -1] },
      trigger: null, support: null, mag: null, stock: null, charge: null,
      optic: { type: "none", mag: 1 },
    });
    return g;
  };

  // Older prison prose (and every loot table shipped so far) says "Shiv".
  // Same object, same model — the alias keeps a stale name from falling
  // through to the generic fallback gun.
  CBZ.weaponAppearance.shiv = CBZ.weaponAppearance.shank;
})();
