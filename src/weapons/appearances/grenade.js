/* ============================================================
   weapons/appearances/grenade.js — the thrown GRENADE: an M67 frag.

   Grenades are a KEY-THROWN throwable (city/combat.js owns the lob + arc +
   fuse + detonation), NOT a selectable FPS weapon slot, so this file does NOT
   register a CBZ.weaponAppearance. It only exposes the mesh factory the
   combat.js grenade pool, the held frag (systems/helditems.js) and the scale
   pass (weapons/weapon-scale.js) call:
       CBZ.grenadeMesh(THREE) -> THREE.Group

   THE OBJECT, in real metres (64 mm body, 89 mm tall to the fuze top):
     · the BODY is a smooth steel sphere, not an egg, with a shallow neck
       collar where the fuze threads in (one lathe);
     · the M213 FUZE: a turned body proud of the neck, its striker housing
       and the two lugs the lever hooks under;
     · the SPOON (safety lever) is the tell: a pressed strip that starts
       over the fuze top, hooks down past the lugs and runs down the body's
       side, hugging it, to below the equator;
     · the SAFETY PIN crosses the fuze through the lever's ears, its PULL
       RING hanging off the far side, and the wire SAFETY CLIP loops the fuze
       neck and over the lever.
   Axes: +Y up the fuze axis, the lever down the +X side.
   userData.ring is the pin + ring (the held frag hides it when the pin is
   pulled). Geometry and materials are built once and shared by every
   grenade in the world (no per-throw allocation).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  const R = 0.032;                  // body radius (64 mm)
  const NECK_Y = 0.029;             // where the sphere meets the fuze collar
  const TOP_Y = 0.057;              // fuze top (89 mm overall)
  const LEVER_R = R + 0.0016;       // the lever rides just proud of the body

  let A = null;
  function assets(T) {
    if (A) return A;
    const V = (p) => new T.Vector2(p[0], p[1]);
    // the steel body: sphere from the bottom pole up to the neck collar
    const body = [];
    const aTop = Math.asin(NECK_Y / R);
    for (let i = 0; i <= 14; i++) {
      const a = -Math.PI / 2 + (aTop + Math.PI / 2) * (i / 14);
      body.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
    body.push([0.0128, NECK_Y + 0.0012], [0.0122, NECK_Y + 0.0035], [0, NECK_Y + 0.0035]);
    // the M213 fuze body: threaded skirt, the lug band, striker housing, cap
    const fuze = [
      [0, NECK_Y], [0.0108, NECK_Y], [0.0108, 0.036], [0.0118, 0.037], [0.0118, 0.043],
      [0.0098, 0.0445], [0.0092, 0.052], [0.0078, 0.0555], [0.0050, TOP_Y], [0, TOP_Y],
    ];
    // the lever, a side outline in the XY plane (x out from the fuze axis):
    // over the top, down past the lug, then hugging the body down its side
    const outer = [[-0.004, TOP_Y + 0.0006], [0.0085, TOP_Y + 0.0006], [0.0135, 0.052], [0.0150, 0.043]];
    const inner = [[-0.004, TOP_Y - 0.0010], [0.0078, TOP_Y - 0.0010], [0.0120, 0.0515], [0.0134, 0.043]];
    for (let i = 0; i <= 10; i++) {
      const a = 1.10 - (1.10 + 0.42) * (i / 10);           // from 63 deg above the equator to 24 below
      outer.push([Math.cos(a) * (LEVER_R + 0.0016), Math.sin(a) * (LEVER_R + 0.0016)]);
      inner.push([Math.cos(a) * LEVER_R, Math.sin(a) * LEVER_R]);
    }
    const lever = new T.Shape();
    const pts = outer.concat(inner.reverse());
    lever.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) lever.lineTo(pts[i][0], pts[i][1]);
    lever.closePath();
    const leverGeo = new T.ExtrudeGeometry(lever, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0005, bevelSegments: 1, curveSegments: 2 });
    leverGeo.translate(0, 0, -0.006);
    leverGeo.computeVertexNormals();
    A = {
      geo: {
        body: new T.LatheGeometry(body.map(V), 22),
        fuze: new T.LatheGeometry(fuze.map(V), 16),
        lever: leverGeo,
        lug: new T.BoxGeometry(0.004, 0.006, 0.016),            // the fuze lug under the lever's hook
        pin: new T.CylinderGeometry(0.0009, 0.0009, 0.030, 6),  // the split pin across the fuze
        ring: new T.TorusGeometry(0.0115, 0.0013, 6, 18),
        clip: new T.TorusGeometry(0.0122, 0.0008, 4, 18),
      },
      mat: {
        body: new T.MeshPhongMaterial({ color: 0x3a4430, shininess: 18, specular: 0x2a3024 }),   // OD over steel
        fuze: new T.MeshPhongMaterial({ color: 0x6b7178, shininess: 40, specular: 0x777d84 }),   // bare fuze steel
        lever: new T.MeshPhongMaterial({ color: 0x565c52, shininess: 30, specular: 0x555a50 }),
        ring: new T.MeshPhongMaterial({ color: 0xb49a52, shininess: 60, specular: 0x9a8a60 }),   // brass-plated pin + ring
      },
    };
    Object.keys(A.geo).forEach((k) => { A.geo[k]._shared = true; });
    Object.keys(A.mat).forEach((k) => { A.mat[k]._shared = true; });
    return A;
  }

  function mesh(T, parent, geo, mat, x, y, z, rx, ry, rz) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  CBZ.grenadeMesh = function (THREE) {
    const T = THREE || window.THREE;
    const a = assets(T), G = a.geo, M = a.mat;
    const g = new T.Group();
    g.name = "m67";

    mesh(T, g, G.body, M.body);
    mesh(T, g, G.fuze, M.fuze);
    mesh(T, g, G.lug, M.fuze, 0.0122, 0.040, 0);
    mesh(T, g, G.lever, M.lever);
    // the wire safety clip round the fuze collar (it stays when the pin goes)
    mesh(T, g, G.clip, M.fuze, 0, NECK_Y + 0.0045, 0, Math.PI / 2, 0, 0);

    // pin + ring, one group: the pin runs across the fuze (along Z) through
    // the lever's ears; the ring hangs off its -Z end, standing in the YZ plane
    const ring = new T.Group();
    ring.name = "m67:pin";
    mesh(T, ring, G.pin, M.ring, 0.006, 0.047, -0.003, Math.PI / 2, 0, 0);
    mesh(T, ring, G.ring, M.ring, 0.006, 0.047, -0.0285, 0, Math.PI / 2, 0);
    g.add(ring);
    g.userData.ring = ring;   // the held frag drops it when you pull the pin (systems/helditems.js)

    /* THE ANCHORS (contract: weapons/appearances/sidearm.js, "ANCHOR
       CONTRACT"), inline plain THREE (a page may load this without the
       appearances index). Metres: k = 1.
         grip     the body's centre, where the fist closes (+Y up the fuze)
         trigger  the lever where the palm holds it down, mid-body on +X
         charge   the pull ring (what the other hand yanks)             */
    const q = () => new T.Quaternion();
    const la = 0.25;   // lever point: 14 deg above the equator
    g.userData.anchors = {
      k: 1,
      grip: { pos: new T.Vector3(0, 0, 0), quat: q(), rake: 0 },
      trigger: { pos: new T.Vector3(Math.cos(la) * (LEVER_R + 0.0008), Math.sin(la) * (LEVER_R + 0.0008), 0), quat: q() },
      support: null, muzzle: null, mag: null, stock: null, bolt: null,
      charge: { pos: new T.Vector3(0.006, 0.047 - 0.0115, -0.0285), quat: q() },
      sight: null, lens: null, optic: { type: "none", mag: 1 },
    };

    // REAL-DIMENSION SIZING (weapons/weapon-scale.js): the model is authored
    // in real metres; weaponRealScale measures this factory and applies the
    // thrown READ boost. Guard-called so a build without the scale module
    // throws a real-size frag.
    if (CBZ.grenadeRealScale) {
      const s = CBZ.grenadeRealScale();
      if (s > 0) g.scale.setScalar(s);
    }
    return g;
  };
})();
