/* ============================================================
   weapons/appearances/c4.js — THE CHARGE AND THE DETONATOR, AS OBJECTS.

   The charge is the real 5 lb breaching bundle: four M112 blocks taped
   two by two, a blasting cap in one end, its leads to a receiver taped on
   the face with a blinking LED and a stub antenna. Its thin axis is local
   +Y (7.6 cm, see systems/helditem_model.js BRICK) so "flush on a surface"
   is one setFromUnitVectors(+Y, normal).

   The DETONATOR is a hand-sized olive firing device with a hinged squeeze
   lever on its back and a safety bail; userData.lever is the lever pivot the
   hand animates (rotation.x 0 = open, -0.5 = squeezed). The lever is the
   whole reason it reads: you see your hand close on it and things go off.

   ONE geometry + material set, built on first use, shared by every copy
   (planted charges, the held prop, the store's display crate).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  let A = null;

  function labelTexture(THREE) {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = 256; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#4a5236"; x.fillRect(0, 0, 256, 64);
    // film sheen streaks
    for (let i = 0; i < 18; i++) {
      x.fillStyle = "rgba(255,255,255," + (0.02 + (i % 5) * 0.012) + ")";
      x.fillRect((i * 37) % 256, 0, 3 + (i % 3) * 2, 64);
    }
    x.fillStyle = "#d8cf9f"; x.fillRect(18, 14, 220, 36);
    x.fillStyle = "#1f2216";
    x.font = "bold 13px Arial, sans-serif";
    x.fillText("CHARGE, DEMOLITION", 26, 29);
    x.font = "11px Arial, sans-serif";
    x.fillText("COMPOSITION C-4  1.25 LB", 26, 44);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function assets(THREE) {
    if (A) return A;
    A = {
      geo: {
        // detonator
        body: new THREE.BoxGeometry(0.045, 0.11, 0.032),
        lever: new THREE.BoxGeometry(0.036, 0.1, 0.008),
        bail: new THREE.TorusGeometry(0.014, 0.0022, 4, 10, Math.PI),
        port: new THREE.CylinderGeometry(0.008, 0.008, 0.014, 8),
        coil: new THREE.TorusGeometry(0.03, 0.004, 5, 14),
      },
      mat: {
        film: new THREE.MeshPhongMaterial({ color: 0xdfe6d8, transparent: true, opacity: 0.22, shininess: 90, specular: 0x999999, depthWrite: false }),
        led: new THREE.MeshBasicMaterial({ color: 0xff2a22 }),
        det: new THREE.MeshLambertMaterial({ color: 0x4b5438 }),
        steel: new THREE.MeshLambertMaterial({ color: 0x6f757a }),
        wireG: new THREE.MeshLambertMaterial({ color: 0x39402c }),
      },
    };
    Object.keys(A.geo).forEach((k) => { A.geo[k]._shared = true; });
    Object.keys(A.mat).forEach((k) => { A.mat[k]._shared = true; });
    return A;
  }

  /* THE ANCHORS (contract: weapons/appearances/sidearm.js, "ANCHOR
     CONTRACT"), written inline in plain THREE: disaster.html loads this file
     without the appearances index. Metres, so k = 1. Every point is
     { pos, quat } in the prop's own frame; an absent part is null. */
  function stampAnchors(THREE, g, s) {
    const pt = function (p, q) {
      return p ? { pos: new THREE.Vector3(p[0], p[1], p[2]), quat: q ? q.clone() : new THREE.Quaternion() } : null;
    };
    g.userData.anchors = {
      k: 1,
      grip: pt(s.grip), trigger: pt(s.trigger), support: null, muzzle: null,
      mag: null, stock: null, bolt: null, charge: pt(s.charge),
      sight: null, lens: null, optic: { type: "none", mag: 1 },
    };
  }

  function mesh(THREE, g, m, parent, x, y, z) {
    const o = new THREE.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); parent.add(o); return o;
  }
  /* THE CHARGE: five pounds of C-4, which is FOUR M112 demolition blocks
     (each 11 x 2 x 1.5 in = 279 x 51 x 38 mm, 1.25 lb, olive film wrap with a
     printed label) bundled two wide by two deep and bound with two wraps of
     black tape. A blasting cap is pushed into the end of one block; its two
     leads run over the top to the small radio receiver/initiator taped on
     the face, which carries the arming LED and a stub antenna.
     Local frame: +X along its length, +Y out of its face (the surface normal
     when stuck), +Z across. Origin = its centre. Thin axis = +Y (76 mm).
     Draw cost: ONE merged vertex-coloured body + the film + the label + the
     LED = 4 meshes (was 16), all geometry built once. */
  const BLK = { len: 0.279, w: 0.051, t: 0.038 };
  const B = { len: BLK.len, thick: BLK.t * 2, wide: BLK.w * 2 };
  function brickAssets(THREE) {
    const a = assets(THREE);
    if (a.brick) return a.brick;
    const K = CBZ.munitions.kit;
    const P = [];
    const gap = 0.0015;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const y = (i - 0.5) * BLK.t, z = (j - 0.5) * BLK.w;
      // each block slightly rounded at the ends: a box a hair short plus end pads
      P.push({ g: K.box(BLK.len - 0.006, BLK.t - gap, BLK.w - gap, 0, y, z), c: 0x5b6443 });
      P.push({ g: K.box(0.003, BLK.t - gap * 3, BLK.w - gap * 3, BLK.len / 2 - 0.0015, y, z), c: 0x4d5538 });
      P.push({ g: K.box(0.003, BLK.t - gap * 3, BLK.w - gap * 3, -BLK.len / 2 + 0.0015, y, z), c: 0x4d5538 });
    }
    // two wraps of black tape round the bundle
    for (const x of [-0.075, 0.07]) P.push({ g: K.box(0.024, B.thick + 0.003, B.wide + 0.003, x, 0, 0), c: 0x1d1f1c });
    // the receiver/initiator on the face, taped down by the forward wrap
    const RX = { x: 0.07, y: B.thick / 2 + 0.014, w: 0.07, h: 0.026, d: 0.046 };
    P.push({ g: K.box(RX.w, RX.h, RX.d, RX.x, RX.y, 0), c: 0x23262a });
    P.push({ g: K.box(0.026, 0.028, 0.049, RX.x, RX.y, 0), c: 0x1d1f1c });              // tape over it
    P.push({ g: K.box(0.012, 0.006, 0.012, RX.x - 0.024, RX.y + RX.h / 2 + 0.002, 0.012), c: 0x3a0d0b });   // LED bezel
    // stub antenna, standing off the receiver's far end
    const ant = new THREE.CylinderGeometry(0.0022, 0.0028, 0.075, 5); ant.translate(RX.x + 0.028, RX.y + RX.h / 2 + 0.037, -0.016);
    P.push({ g: ant, c: 0x111111 });
    // the blasting cap in the end of the top block, crimped to its leads
    const capY = BLK.t / 2, capZ = BLK.w / 2;
    const cap = new THREE.CylinderGeometry(0.0038, 0.0038, 0.045, 8); cap.rotateZ(Math.PI / 2); cap.translate(BLK.len / 2 + 0.014, capY, capZ);
    P.push({ g: cap, c: 0xa8966a });
    // the two leads: from the cap, up over the end and along the face to the receiver
    const ex = BLK.len / 2 + 0.036;
    const lead = function (dz, col) {
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ex, capY, capZ + dz),
        new THREE.Vector3(ex + 0.016, capY + 0.02, capZ * 0.7 + dz),
        new THREE.Vector3(ex + 0.004, B.thick / 2 + 0.018, capZ * 0.3 + dz),
        new THREE.Vector3(BLK.len / 2 - 0.02, B.thick / 2 + 0.008, dz),
        new THREE.Vector3(RX.x + RX.w / 2 + 0.002, RX.y - 0.004, dz * 2),
      ]);
      P.push({ g: new THREE.TubeGeometry(c, 16, 0.0019, 4, false), c: col });
    };
    lead(-0.0035, 0xa3231b); lead(0.0035, 0x151515);
    const lab = labelTexture(THREE);
    a.brick = {
      body: K.merge(P),
      film: new THREE.BoxGeometry(B.len + 0.004, B.thick + 0.003, B.wide + 0.004),
      label: new THREE.PlaneGeometry(BLK.len * 0.62, BLK.w * 0.8),
      led: new THREE.SphereGeometry(0.0045, 6, 4),
      mat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      labelMat: new THREE.MeshLambertMaterial({ map: lab, color: lab ? 0xffffff : 0xcfc59a }),
      rx: RX,
    };
    a.brick.film._shared = a.brick.label._shared = a.brick.led._shared = a.brick.mat._shared = a.brick.labelMat._shared = true;
    return a.brick;
  }
  CBZ.buildC4Brick = function (THREE) {
    THREE = THREE || window.THREE;
    const a = assets(THREE), M = a.mat, K = brickAssets(THREE);
    const g = new THREE.Group();
    g.name = "c4_brick";
    g.add(new THREE.Mesh(K.body, K.mat));
    g.add(new THREE.Mesh(K.film, M.film));
    // the printed label on the top block's face, behind the tape wrap
    const lab = new THREE.Mesh(K.label, K.labelMat);
    lab.rotation.x = -Math.PI / 2;
    lab.position.set(-0.035, B.thick / 2 + 0.0022, -BLK.w / 2);
    g.add(lab);
    const led = new THREE.Mesh(K.led, M.led);
    led.position.set(K.rx.x - 0.024, K.rx.y + K.rx.h / 2 + 0.005, 0.012);
    g.add(led);
    g.userData.led = led;
    g.userData.thick = B.thick;
    // held across the palm by its middle; +Y (the face) outward
    stampAnchors(THREE, g, { grip: [0, 0, 0] });
    return g;
  };

  /* The detonator, held upright in a fist: local +Y up the body, the lever
     on its -Z face (the palm side), hinged at its top. */
  CBZ.buildC4Detonator = function (THREE) {
    THREE = THREE || window.THREE;
    const a = assets(THREE), G = a.geo, M = a.mat;
    const g = new THREE.Group();
    g.name = "c4_detonator";
    mesh(THREE, G.body, M.det, g);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.05, -0.02);
    g.add(pivot);
    const lever = mesh(THREE, G.lever, M.det, pivot, 0, -0.05, -0.004);
    lever.rotation.x = 0;
    pivot.rotation.x = 0.42;           // open (sprung out)
    // safety bail over the lever top
    const bail = mesh(THREE, G.bail, M.steel, g, 0, 0.055, -0.022);
    bail.rotation.y = Math.PI / 2;
    // firing wire port on the base, and a coil of the lead
    const port = mesh(THREE, G.port, M.steel, g, 0, -0.062, 0);
    port.rotation.x = 0;
    const coil = mesh(THREE, G.coil, M.wireG, g, 0, -0.075, 0.02);
    coil.rotation.x = Math.PI / 2;
    g.userData.lever = pivot;
    g.userData.leverOpen = 0.42;
    g.userData.leverShut = 0.02;
    // the fist closes on the body's middle; the fingers press the lever's
    // outer (-Z) face, measured where the sprung-open lever actually is;
    // the safety bail's crown is what the thumb flips first
    g.updateMatrixWorld(true);
    const face = lever.localToWorld(new THREE.Vector3(0, -0.01, -0.004));
    stampAnchors(THREE, g, { grip: [0, 0, 0], trigger: [face.x, face.y, face.z], charge: [0, 0.069, -0.022] });
    return g;
  };

  CBZ.c4PropDims = function () { return { len: B.len, thick: B.thick, wide: B.wide }; };
})();
