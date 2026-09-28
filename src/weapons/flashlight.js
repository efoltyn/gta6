/* ============================================================
   weapons/flashlight.js — one physical hand torch.

   The guard hand, the player's hand (systems/playerflashlight.js), a dead
   guard's floor drop and the inventory thumbnail all ask this factory for the
   same model.  A torch is a straight tube: tail switch, tail cap, a knurled
   3 cm body the fist closes round, a flared head, bezel and glass.

   REAL METRES. It used to be drawn at ~3.5x life (an 11 cm thick body, a
   19 cm head) and no hand could close round it; the owner saw a torch that
   "isn't in the hand".  Now it is a 16 cm tactical torch with a 3.0 cm body,
   and systems/fphands.js has a 'torch' grip solved for exactly that tube.
   A consumer drawing a whole world larger (the first-person viewmodel, a gun
   built at 2x) scales the model, never the geometry.

   Contract (model's own frame, metres):
     +Z                  the light direction (tail -> lens)
     userData.handle     { center, axis, radius, halfLength } — the part the
                         fist closes on; fphands.torchMount() seats this centre
                         on the torch grip's centre
     userData.tailSwitch the switch face the thumb rests on
     userData.beamOrigin the lens (== userData.lens.position)
     userData.forward    (0, 0, 1)
     userData.length     tail button -> lens, metres
   opts.lit     the lens glows
   opts.private own material instances (the first-person viewmodel re-flags
                its materials for its own render queue; the shared set is
                used by every guard in the prison)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const GEO = new Map();
  const shared = {
    shell: new THREE.MeshLambertMaterial({ color: 0x20262d }),
    grip: new THREE.MeshLambertMaterial({ color: 0x0c1014 }),
    edge: new THREE.MeshLambertMaterial({ color: 0x4e5963 }),
    rubber: new THREE.MeshLambertMaterial({ color: 0x151719 }),
  };
  Object.keys(shared).forEach(function (key) { shared[key]._shared = true; });

  function cylGeo(top, bottom, len, sides) {
    const key = "c|" + top + "|" + bottom + "|" + len + "|" + (sides || 16);
    let geo = GEO.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(top, bottom, len, sides || 16, 1, false);
      geo._shared = true;
      GEO.set(key, geo);
    }
    return geo;
  }
  function torusGeo(radius, tube) {
    const key = "t|" + radius + "|" + tube;
    let geo = GEO.get(key);
    if (!geo) {
      geo = new THREE.TorusGeometry(radius, tube, 5, 18);
      geo._shared = true;
      GEO.set(key, geo);
    }
    return geo;
  }
  function boxGeo(x, y, z) {
    const key = "b|" + x + "|" + y + "|" + z;
    let geo = GEO.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(x, y, z);
      geo._shared = true;
      GEO.set(key, geo);
    }
    return geo;
  }
  function mesh(parent, geo, material, x, y, z, rx, ry, rz) {
    const part = new THREE.Mesh(geo, material);
    part.position.set(x || 0, y || 0, z || 0);
    part.rotation.set(rx || 0, ry || 0, rz || 0);
    part.castShadow = true;
    parent.add(part);
    return part;
  }

  // the numbers (metres, along +Z)
  const Z_TAIL = -0.080;            // tail switch face
  const R_BODY = 0.015;             // 3.0 cm body: what the fist closes round
  const Z_BODY0 = -0.058, Z_BODY1 = 0.040;
  const Z_LENS = 0.0775;
  const HANDLE_C = -0.036;          // where the fist sits: its tail edge just past the index knuckle
  const HALF = Math.PI / 2;

  CBZ.buildFlashlight = function (opts) {
    opts = opts || {};
    const m = opts.private ? {
      shell: shared.shell.clone(), grip: shared.grip.clone(), edge: shared.edge.clone(), rubber: shared.rubber.clone(),
    } : shared;
    const model = new THREE.Group();

    // THREE cylinders are Y-long; +PI/2 about X lays radiusTop on +Z.
    // tail: the rubber switch the thumb rests on, then the knurled tail cap
    mesh(model, cylGeo(0.0095, 0.0095, 0.006, 14), m.rubber, 0, 0, Z_TAIL + 0.003, HALF);
    mesh(model, cylGeo(0.0158, 0.0158, 0.016, 18), m.edge, 0, 0, -0.066, HALF);
    // the body tube and its grip rings
    mesh(model, cylGeo(R_BODY, R_BODY, Z_BODY1 - Z_BODY0, 18), m.shell, 0, 0, (Z_BODY0 + Z_BODY1) / 2, HALF);
    for (let i = 0; i < 3; i++) mesh(model, torusGeo(R_BODY, 0.0011), m.grip, 0, 0, -0.046 + i * 0.014);
    // a pocket clip on the body: the one asymmetry, so a torch on the floor
    // does not read as a featureless pipe
    mesh(model, boxGeo(0.004, 0.003, 0.046), m.edge, 0, R_BODY + 0.0012, -0.030);
    // flared head (radiusTop = the +Z end, so it widens toward the glass) and bezel
    mesh(model, cylGeo(0.0205, 0.0155, 0.030, 20), m.shell, 0, 0, 0.055, HALF);
    mesh(model, cylGeo(0.0215, 0.0215, 0.008, 20), m.edge, 0, 0, 0.074, HALF);

    const lensMat = new THREE.MeshLambertMaterial({
      color: 0xd9f1f8,
      emissive: opts.lit ? 0xcff6ff : 0x10242c,
      emissiveIntensity: opts.lit ? 1.6 : 0.18,
    });
    const lens = mesh(model, cylGeo(0.0180, 0.0180, 0.002, 20), lensMat, 0, 0, Z_LENS, HALF);
    lens.castShadow = false;

    model.userData.itemKind = "Guard Torch";
    model.userData.flashlight = true;
    model.userData.lens = lens;
    model.userData.lensMat = lensMat;
    model.userData.handle = {
      center: new THREE.Vector3(0, 0, HANDLE_C),
      axis: new THREE.Vector3(0, 0, 1),
      radius: R_BODY,
      halfLength: (Z_BODY1 - Z_BODY0) / 2,
    };
    model.userData.tailSwitch = new THREE.Vector3(0, 0, Z_TAIL);
    model.userData.beamOrigin = lens.position.clone();
    model.userData.forward = new THREE.Vector3(0, 0, 1);
    model.userData.length = Z_LENS + 0.001 - Z_TAIL;
    model.userData.headRadius = 0.0215;
    return model;
  };

  CBZ.flashlightModelAudit = function () {
    const model = CBZ.buildFlashlight();
    let meshes = 0;
    model.traverse(function (part) { if (part.isMesh) meshes++; });
    return {
      meshes: meshes,
      cylindrical: meshes >= 8,
      lens: !!model.userData.lens,
      forwardZ: !!(model.userData.forward && model.userData.forward.z === 1),
      bodyDiameterCm: Math.round(model.userData.handle.radius * 200 * 10) / 10,
    };
  };
})();
