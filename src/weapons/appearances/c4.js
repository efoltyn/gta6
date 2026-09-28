/* ============================================================
   weapons/appearances/c4.js — THE CHARGE AND THE DETONATOR, AS OBJECTS.

   The old charge was a box with three tan sticks and a red cube. This is
   the thing people picture: an olive putty brick in a clear film wrap with
   a printed label, a small receiver box taped to its face with a blinking
   LED and a stub antenna, and two short wires running from the receiver
   into the brick's end. Its thin axis is local +Y (thickness 5.5 cm, see
   systems/helditem_model.js BRICK) so "flush on a surface" is one
   setFromUnitVectors(+Y, normal).

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
    const B = { len: 0.28, thick: 0.055, wide: 0.11 };
    const lab = labelTexture(THREE);
    A = {
      B: B,
      geo: {
        brick: new THREE.BoxGeometry(B.len, B.thick, B.wide),
        film: new THREE.BoxGeometry(B.len + 0.006, B.thick + 0.004, B.wide + 0.006),
        label: new THREE.PlaneGeometry(B.len * 0.8, B.wide * 0.62),
        rx: new THREE.BoxGeometry(0.075, 0.03, 0.05),
        led: new THREE.SphereGeometry(0.0055, 6, 4),
        ant: new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 4),
        wire: new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4),
        cap: new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 6),
        tape: new THREE.BoxGeometry(0.02, B.thick + 0.036, B.wide + 0.008),
        // detonator
        body: new THREE.BoxGeometry(0.045, 0.11, 0.032),
        lever: new THREE.BoxGeometry(0.036, 0.1, 0.008),
        bail: new THREE.TorusGeometry(0.014, 0.0022, 4, 10, Math.PI),
        port: new THREE.CylinderGeometry(0.008, 0.008, 0.014, 8),
        coil: new THREE.TorusGeometry(0.03, 0.004, 5, 14),
      },
      mat: {
        brick: new THREE.MeshLambertMaterial({ color: 0x5b6443 }),
        film: new THREE.MeshPhongMaterial({ color: 0xdfe6d8, transparent: true, opacity: 0.22, shininess: 90, specular: 0x999999, depthWrite: false }),
        label: new THREE.MeshLambertMaterial({ map: lab, color: lab ? 0xffffff : 0xcfc59a }),
        rx: new THREE.MeshLambertMaterial({ color: 0x23262a }),
        led: new THREE.MeshBasicMaterial({ color: 0xff2a22 }),
        ant: new THREE.MeshLambertMaterial({ color: 0x111111 }),
        red: new THREE.MeshLambertMaterial({ color: 0xa3231b }),
        blk: new THREE.MeshLambertMaterial({ color: 0x151515 }),
        cap: new THREE.MeshLambertMaterial({ color: 0x9a8d6a }),
        tape: new THREE.MeshLambertMaterial({ color: 0x2c2f2a }),
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
  // a straight wire segment between two local points
  function wire(THREE, parent, geo, mat, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1e-3;
    const w = new THREE.Mesh(geo, mat);
    w.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    w.scale.set(1, L, 1);
    w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    parent.add(w);
    return w;
  }

  /* The brick. Local frame: +X along its length, +Y out of its face (the
     surface normal when stuck), +Z across. Origin = its centre. */
  CBZ.buildC4Brick = function (THREE) {
    THREE = THREE || window.THREE;
    const a = assets(THREE), G = a.geo, M = a.mat, B = a.B;
    const g = new THREE.Group();
    g.name = "c4_brick";
    mesh(THREE, G.brick, M.brick, g);
    mesh(THREE, G.film, M.film, g);
    const lab = mesh(THREE, G.label, M.label, g, -0.02, B.thick / 2 + 0.0035, 0);
    lab.rotation.x = -Math.PI / 2;
    // two bands of tape holding the receiver on
    mesh(THREE, G.tape, M.tape, g, 0.07, 0, 0);
    mesh(THREE, G.tape, M.tape, g, 0.105, 0, 0);
    // the receiver box on the face, LED + stub antenna
    const rx = mesh(THREE, G.rx, M.rx, g, 0.088, B.thick / 2 + 0.017, 0);
    const led = mesh(THREE, G.led, M.led, rx, -0.025, 0.016, 0.014);
    mesh(THREE, G.ant, M.ant, rx, 0.03, 0.045, -0.016);
    // the cap seated in the brick's end and its two leads into the receiver
    const cap = mesh(THREE, G.cap, M.cap, g, B.len / 2 + 0.012, 0.004, 0.012);
    cap.rotation.z = Math.PI / 2;
    const ex = B.len / 2 + 0.034;
    wire(THREE, g, G.wire, M.red, [ex, 0.004, 0.009], [ex + 0.01, B.thick / 2 + 0.03, 0.006]);
    wire(THREE, g, G.wire, M.red, [ex + 0.01, B.thick / 2 + 0.03, 0.006], [0.125, B.thick / 2 + 0.02, 0.012]);
    wire(THREE, g, G.wire, M.blk, [ex, 0.004, 0.016], [ex + 0.006, B.thick / 2 + 0.026, 0.02]);
    wire(THREE, g, G.wire, M.blk, [ex + 0.006, B.thick / 2 + 0.026, 0.02], [0.125, B.thick / 2 + 0.018, 0.02]);
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

  CBZ.c4PropDims = function () { return { len: 0.28, thick: 0.055, wide: 0.11 }; };
})();
