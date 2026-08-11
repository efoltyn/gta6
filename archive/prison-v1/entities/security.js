/* ============================================================
   entities/security.js — Rotating Security Cameras
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox, mat } = CBZ;

  CBZ.cameras = [];

  function makeCamera(x, y, z, baseAngle, options) {
    options = options || {};
    const sweepRange = options.range != null ? options.range : 1.2; // sweep angle in radians (~70 deg)
    const sweepSpeed = options.speed != null ? options.speed : 0.0016; // speed multiplier
    const offset = options.offset != null ? options.offset : 0;

    const grp = new THREE.Group();
    grp.userData.dynamic = true;
    grp.position.set(x, y, z);
    scene.add(grp);

    // 1. Mount bracket (connected to wall)
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.36), mat(0x515a66));
    mount.position.set(0, 0.2, -0.18);
    grp.add(mount);

    // 2. Camera body (rotates)
    const bodyGrp = new THREE.Group();
    bodyGrp.position.set(0, 0, 0);
    grp.add(bodyGrp);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.6), mat(0x2d3238));
    body.position.set(0, 0, 0.1);
    body.castShadow = true;
    bodyGrp.add(body);

    // 3. Glowing lens / status light
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.06),
      mat(0xff3b3b, { emissive: 0xff0000, ei: 1.2 })
    );
    lens.position.set(0, 0, 0.4);
    bodyGrp.add(lens);

    // 4. Sweeping red detection cone
    const coneLen = 10;
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 4.4, coneLen, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    // align cylinder to point along +z (cylinder defaults to y-up)
    cone.rotation.x = Math.PI / 2;
    cone.position.set(0, 0, coneLen / 2 + 0.3);
    bodyGrp.add(cone);

    const cam = {
      group: grp,
      body: bodyGrp,
      lens: lens,
      cone: cone,
      pos: new THREE.Vector3(x, y, z),
      baseAngle: baseAngle,
      sweepRange: sweepRange,
      sweepSpeed: sweepSpeed,
      offset: offset,
      active: true,
      destroyed: false,
      hp: 10,
    };

    CBZ.cameras.push(cam);
    return cam;
  }

  // Spawn cameras in key locations:
  // 1. Cell Block Hallway: sweeping the aisle from the back wall
  makeCamera(0, 8.0, -42.8, 0, { offset: 0, range: 0.8 });
  
  // 2. Cafeteria entrance: sweeping the entryway on the west wall
  makeCamera(-19.5, 5.2, 14, -Math.PI / 2, { offset: Math.PI / 2, range: 1.1 });

  // 3. Lounge restricted entrance: sweeping the staff door on the east wall
  makeCamera(19.5, 5.2, 37, Math.PI / 2, { offset: -Math.PI / 2, range: 1.1 });

  // Camera animation loop
  CBZ.onUpdate(25, function (dt) {
    if (CBZ.game.mode !== "escape") return;
    const breaker = CBZ.breaker;
    const powerOut = breaker && breaker.sabotaged;

    for (const cam of CBZ.cameras) {
      if (cam.destroyed) {
        cam.cone.visible = false;
        cam.lens.material.color.setHex(0x1a1a1a);
        cam.lens.material.emissive.setHex(0x000000);
        continue;
      }

      if (powerOut) {
        cam.active = false;
        cam.cone.visible = false;
        cam.lens.material.color.setHex(0x2b2b2b);
        cam.lens.material.emissive.setHex(0x000000);
        continue;
      }

      // Restore camera function if power is back
      if (!cam.active && !powerOut) {
        cam.active = true;
        cam.cone.visible = true;
        cam.lens.material.color.setHex(0xff3b3b);
        cam.lens.material.emissive.setHex(0xff0000);
      }

      // Sweep animation back and forth
      const sweep = Math.sin(CBZ.now * cam.sweepSpeed + cam.offset) * cam.sweepRange;
      cam.body.rotation.y = cam.baseAngle + sweep;
      // slight downward pitch so it points toward the floor
      cam.body.rotation.x = 0.45; 
    }
  });

  CBZ.resetCameras = function () {
    for (const cam of CBZ.cameras) {
      cam.destroyed = false;
      cam.active = true;
      cam.cone.visible = true;
      cam.hp = 10;
      cam.lens.material.color.setHex(0xff3b3b);
      cam.lens.material.emissive.setHex(0xff0000);
    }
  };
})();
