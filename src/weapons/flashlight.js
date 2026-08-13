/* ============================================================
   weapons/flashlight.js — one physical prison duty flashlight.

   The guard hand, a dead guard's floor drop, and the inventory thumbnail all
   ask this factory for the same model.  A flashlight is a straight cylindrical
   tool: grip, switch, flared reflector, glass and rear cap.  It is not a pistol
   with a vertical handle, and none of its consumers redraw a cheaper symbol.

   Local +Z is the light/barrel direction.  That contract lets guards parent a
   beam to the lens, lets weaponPhysics settle the released model from measured
   geometry, and lets the existing gun-thumbnail camera frame its long axis.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const GEO = new Map();
  const mats = {
    shell: new THREE.MeshLambertMaterial({ color: 0x20262d }),
    grip: new THREE.MeshLambertMaterial({ color: 0x0c1014 }),
    edge: new THREE.MeshLambertMaterial({ color: 0x4e5963 }),
    switch: new THREE.MeshLambertMaterial({ color: 0x303941 }),
  };
  Object.keys(mats).forEach(function (key) { mats[key]._shared = true; });

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
      geo = new THREE.TorusGeometry(radius, tube, 6, 18);
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

  CBZ.buildFlashlight = function (opts) {
    opts = opts || {};
    const model = new THREE.Group();

    // Straight aluminium body.  THREE cylinders are Y-long, so +PI/2 turns
    // their long axis onto this factory's promised local +Z light direction.
    mesh(model, cylGeo(0.054, 0.054, 0.285, 18), mats.shell, 0, 0, -0.035, Math.PI / 2);
    mesh(model, cylGeo(0.060, 0.060, 0.040, 18), mats.edge, 0, 0, -0.196, Math.PI / 2);
    mesh(model, cylGeo(0.052, 0.052, 0.018, 18), mats.grip, 0, 0, -0.224, Math.PI / 2);

    // Rubber grip bands give the hand and the thumbnail readable scale without
    // turning the tool into a stack of decorative boxes.
    for (let i = 0; i < 4; i++) {
      mesh(model, torusGeo(0.055, 0.007), mats.grip, 0, 0, -0.145 + i * 0.043);
    }

    // Flared reflector and metal bezel.  radiusTop is the +Z end after rotation,
    // so the head genuinely widens toward the lens.
    mesh(model, cylGeo(0.089, 0.060, 0.092, 20), mats.shell, 0, 0, 0.158, Math.PI / 2);
    mesh(model, cylGeo(0.094, 0.094, 0.030, 20), mats.edge, 0, 0, 0.219, Math.PI / 2);

    const lensMat = new THREE.MeshLambertMaterial({
      color: 0xd9f1f8,
      emissive: opts.lit ? 0xcff6ff : 0x10242c,
      emissiveIntensity: opts.lit ? 1.6 : 0.18,
    });
    const lens = mesh(model, cylGeo(0.077, 0.077, 0.012, 20), lensMat, 0, 0, 0.239, Math.PI / 2);

    // A real thumb switch sits proud of the barrel; this small asymmetry also
    // prevents a released torch from reading as a featureless pipe on the floor.
    mesh(model, boxGeo(0.048, 0.018, 0.065), mats.switch, 0, 0.057, -0.018, 0.10, 0, 0);
    mesh(model, boxGeo(0.028, 0.006, 0.032), mats.edge, 0, 0.068, -0.014, 0.10, 0, 0);

    model.userData.itemKind = "Guard Torch";
    model.userData.flashlight = true;
    model.userData.lens = lens;
    model.userData.lensMat = lensMat;
    model.userData.beamOrigin = new THREE.Vector3(0, 0, 0.248);
    model.userData.forward = new THREE.Vector3(0, 0, 1);
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
    };
  };
})();
