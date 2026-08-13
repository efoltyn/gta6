/* ============================================================
   weapons/appearances/taser.js — clean yellow conducted-energy device.

   The silhouette follows the player's supplied reference: one continuous
   yellow polymer shell, a blunt black cartridge, one open trigger window and
   a rear-swept grip. Detail stays subordinate to those four shapes so the
   device reads instantly in first person instead of becoming a stack of rails,
   panels, lights and finger blocks. The shared builder still serves player,
   NPC, armory, thumbnail and dropped-weapon consumers.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.taser = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    const visual = new THREE.Group();
    visual.position.y = 0.050;
    visual.position.z = -0.120;
    visual.rotation.y = 0.120;
    visual.scale.setScalar(0.82);
    g.add(visual);
    const yellow = new THREE.MeshLambertMaterial({
      color: 0xffd21c,
      emissive: 0x3d2a00,
      emissiveIntensity: 0.10,
    });

    // Extrude a side profile across the device width. One profile with one
    // trigger-window hole gives the body and swept grip a continuous molded
    // silhouette instead of assembling them from visible cuboids.
    function profile(points, width, material, holes, bevel) {
      const shape = new THREE.Shape();
      points.forEach(function (point, index) {
        if (index === 0) shape.moveTo(point[0], point[1]);
        else shape.lineTo(point[0], point[1]);
      });
      shape.closePath();
      (holes || []).forEach(function (pointsForHole) {
        const hole = new THREE.Path();
        pointsForHole.forEach(function (point, index) {
          if (index === 0) hole.moveTo(point[0], point[1]);
          else hole.lineTo(point[0], point[1]);
        });
        hole.closePath();
        shape.holes.push(hole);
      });
      const edge = bevel || 0;
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: width,
        steps: 1,
        bevelEnabled: edge > 0,
        bevelSegments: 1,
        bevelSize: edge,
        bevelThickness: edge,
      });
      geometry.translate(0, 0, -width * 0.5);
      geometry.rotateY(Math.PI * 0.5);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      visual.add(mesh);
      return mesh;
    }

    profile([
      [0.405, 0.105],  // blunt nose / top
      [-0.060, 0.105], // uninterrupted upper shell
      [-0.125, 0.060],
      [-0.145, -0.020],
      [-0.040, -0.335], // rear edge of the forward-swept grip
      [0.080, -0.345],
      [0.140, -0.285],
      [0.125, -0.120],
      [0.290, -0.120], // lower trigger bridge
      [0.405, -0.040],
    ], 0.148, yellow, [[
      [0.105, 0.030],
      [0.275, 0.030],
      [0.265, -0.078],
      [0.130, -0.078],
    ]], 0.008);

    // BLUNT BLACK CARTRIDGE — a single compact front module with a broad metal
    // face. Tiny contacts remain only where the two real probe wires originate.
    box(visual, 0.180, 0.142, 0.145, mat.black, 0, 0.028, -0.460);
    box(visual, 0.148, 0.098, 0.014, mat.worn, 0, 0.028, -0.540);
    cyl(visual, 0.012, 0.018, mat.steel, -0.046, 0.028, -0.553, Math.PI / 2);
    cyl(visual, 0.012, 0.018, mat.steel, 0.046, 0.028, -0.553, Math.PI / 2);

    // The reference has one strong side release, one recessed grip control and
    // a black heel. They are accents, not a second layer of surface machinery.
    cyl(visual, 0.026, 0.012, mat.dark, -0.091, 0.018, -0.402, 0, 0, Math.PI / 2);
    box(visual, 0.012, 0.082, 0.052, mat.dark, -0.086, -0.095, 0.025, -0.42);
    profile([
      [-0.040, -0.335],
      [0.080, -0.345],
      [0.140, -0.285],
      [-0.020, -0.278],
    ], 0.152, mat.black, null, 0.003);

    // One trigger blade and one low top control complete the functional read.
    box(visual, 0.025, 0.074, 0.018, mat.black, 0, -0.020, -0.180, -0.28);
    box(visual, 0.052, 0.018, 0.048, mat.black, 0, 0.116, -0.050);

    // One quiet palm shows the held relationship without wrapping the grip in
    // extra finger bands that compete with the device silhouette.
    box(visual, 0.138, 0.100, 0.105, mat.skin, 0, -0.225, 0.040, -0.30);

    visual.updateMatrix();
    g.userData.muzzle = new THREE.Vector3(0, 0.028, -0.553).applyMatrix4(visual.matrix);
    g.userData.taserContacts = [
      new THREE.Vector3(-0.046, 0.028, -0.553).applyMatrix4(visual.matrix),
      new THREE.Vector3(0.046, 0.028, -0.553).applyMatrix4(visual.matrix),
    ];
    return g;
  };
})();
