/* ============================================================
   world/door.js — the locked red yard door (opens with the keycard).
   Exposes CBZ.door + openDoor()/closeDoor().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox } = CBZ;

  const mesh = addBox(0, 3.5, -8, 6, 7, 0.7, 0xb43b2c, {
    solid: true, blockLOS: true, emissive: 0x3a0d06, ei: 0.4,
  });
  mesh.userData.mover = true;

  // window slats + a keycard reader panel beside it
  addBox(0, 5.0, -7.6, 3.2, 0.3, 0.1, 0x2a2f38, { cast: false });
  addBox(0, 4.4, -7.6, 3.2, 0.3, 0.1, 0x2a2f38, { cast: false });
  const reader = addBox(2.6, 3.6, -7.6, 0.5, 0.7, 0.12, 0x222831, { cast: false });
  const readerLight = addBox(2.6, 3.8, -7.5, 0.18, 0.18, 0.06, 0xff3b3b, { emissive: 0xff0000, ei: 1.0, cast: false });
  readerLight.userData.mover = true;

  const door = {
    mesh, reader, readerLight,
    collider: mesh.userData.collider,
    open: false, closedY: 3.5, t: 0,
  };

  CBZ.door = door;

  CBZ.closeDoor = function () {
    door.open = false; door.t = 0; door.mesh.position.y = door.closedY;
    door.readerLight.material.color.setHex(0xff3b3b);
    door.readerLight.material.emissive.setHex(0xff0000);
    if (CBZ.colliders.indexOf(door.collider) === -1) CBZ.colliders.push(door.collider);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };

  CBZ.openDoor = function () {
    if (door.open) return;
    door.open = true;
    const i = CBZ.colliders.indexOf(door.collider);
    if (i >= 0) CBZ.colliders.splice(i, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    door.readerLight.material.color.setHex(0x39ff88);     // reader turns green
    door.readerLight.material.emissive.setHex(0x14c258);
    CBZ.sfx("door");
  };
})();
