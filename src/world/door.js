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
    if (CBZ.sfx) CBZ.sfx("door_open");
  };

  /* ---- A SECOND WAY THROUGH (systems/breach.js) ---------------------------
     THE KEYCARD STORY, doctrine LAW 1: the owner ran for the keycard hundreds
     of times because it opened a door to a bigger room. This door is the one
     the whole escape game is built around — and until now it had exactly ONE
     answer. A breaching charge is a second answer with a different PRICE:
     the keycard is quiet and needs a plan; 5 lb of C4 on the reader is loud,
     costs a charge you had to steal from the armory, and brings every guard
     in the block. That is not a shortcut, it is a different game, and it is
     the gun-room grammar chained — the RPG and the C4 are both ON the armory
     wall (world/gunroom.js), so the door you cannot open is the reason to go
     get the thing that opens it.

     5 lb is not chosen: it is the doctrinal row for a hole one man can move
     through (FM 90-10-1 app.M). Declaring the requirement in POUNDS rather
     than as a boolean is the whole point of the shared table — the bank vault
     next door states its price the same way, in the same unit.

     One line of declaration; this file learns nothing about explosives, and
     the charge learns nothing about prisons. */
  if (CBZ.registerBreachTarget) {
    CBZ.registerBreachTarget({
      id: "prison-yard-door",
      lb: 5,
      reach: 3.0,                                   // stuck anywhere on a 6 m slab
      at: function () { return { x: 0, y: 2.0, z: -8 }; },
      done: function () { return !!door.open; },    // already blown/opened: not a target
      defeat: function () {
        CBZ.openDoor();
        // the door does not politely slide — it is GONE. The blast owns the
        // picture; this just makes sure the slab reads as destroyed and can
        // never be "closed" back over the hole by a later lockdown.
        door.blown = true;
        if (door.mesh) door.mesh.visible = false;
        if (CBZ.losBlockers) { const li = CBZ.losBlockers.indexOf(door.mesh); if (li >= 0) CBZ.losBlockers.splice(li, 1); }
        if (CBZ.addHeat) CBZ.addHeat(60);           // every screw in the block heard that
        if (CBZ.guards) for (const gd of CBZ.guards) { gd.alert = 1; gd.hunt = Math.max(gd.hunt || 0, 6); }
        if (CBZ.jailTell) CBZ.jailTell.hint("THE DOOR IS GONE", 2.4);
        else if (CBZ.flashHint) CBZ.flashHint("THE DOOR IS GONE", 2.4);
      },
    });
  }
  // a blown door stays blown for the run — closeDoor must not resurrect it
  const _close = CBZ.closeDoor;
  CBZ.closeDoor = function () {
    if (door.blown) return;
    return _close.apply(this, arguments);
  };
})();
