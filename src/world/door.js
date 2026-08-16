/* ============================================================
   world/door.js — the locked red yard door (opens with the keycard).
   Exposes CBZ.door + openDoor()/closeDoor().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox } = CBZ;

  /* A HOUSING-UNIT GATE, not a red wall that disappears into the ceiling.
     The armory and Gang City doors both use the same readable grammar:
     structural jambs stay with the wall; one leaf owns every piece of leaf
     hardware; access control stays on the jamb. The old door violated all
     three — its two "window slats" were scene-level boxes, so opening the
     slab left them floating across the clear route, while its reader was
     visually stranded on the leaf edge.

     Keep the established vertical-slide mechanism and collider contract, but
     make the moving object a coherent 3.35 m detention leaf. The opaque wall
     above is its pocket, so the raised leaf has somewhere physical to go. */
  const CLOSED_Y = 1.68;
  const TRAVEL = 4.35;
  const LEAF_W = 5.72, LEAF_H = 3.36;
  const mesh = addBox(0, CLOSED_Y, -8, LEAF_W, LEAF_H, 0.34, 0x39424e, {
    solid: true, blockLOS: true, emissive: 0x3a0d06, ei: 0.4,
  });
  mesh.userData.mover = true;

  // The parent is the transparent physics/LOS pane. Every visible fitting is
  // local to it, exactly like the armory's welded barred leaf, so one transform
  // moves the whole door and bullet marks inherit the same coordinate space.
  mesh.material.transparent = true;
  mesh.material.opacity = 0.035;
  mesh.material.depthWrite = false;
  mesh.material.emissive.setHex(0x000000);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  function leafBox(w, h, d, color, x, y, z, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), CBZ.cmat(color));
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = !(opts && opts.cast === false);
    m.receiveShadow = true;
    mesh.add(m);
    return m;
  }
  const STEEL = 0x3d4651, EDGE = 0x20262d, KICK = 0x66717d;
  leafBox(5.28, 1.48, 0.28, STEEL, 0, -0.70, 0);             // lower armor plate
  leafBox(5.28, 0.22, 0.30, EDGE, 0, 0.17, 0);              // vision sill
  leafBox(5.28, 0.48, 0.28, STEEL, 0, 1.30, 0);             // upper armor band
  leafBox(0.24, 0.92, 0.30, EDGE, 0, 0.70, 0);              // window divider
  for (const x of [-1.36, 1.36]) {
    const pane = leafBox(2.42, 0.72, 0.12, 0x9fd6e8, x, 0.69, -0.02, { cast: false });
    pane.material.transparent = true;
    pane.material.opacity = 0.38;
    pane.material.depthWrite = false;
    leafBox(2.52, 0.10, 0.31, EDGE, x, 0.30, 0);
    leafBox(2.52, 0.10, 0.31, EDGE, x, 1.08, 0);
  }
  leafBox(0.28, 3.22, 0.34, EDGE, -2.67, 0, 0);              // perimeter stiles
  leafBox(0.28, 3.22, 0.34, EDGE, 2.67, 0, 0);
  leafBox(5.48, 0.22, 0.34, EDGE, 0, -1.55, 0);              // head / sill rails
  leafBox(5.48, 0.22, 0.34, EDGE, 0, 1.55, 0);
  leafBox(4.82, 0.08, 0.04, 0xb44534, 0, -1.10, -0.18, { cast: false }); // earned warning stripe
  leafBox(1.58, 0.54, 0.04, KICK, 1.56, -0.55, -0.18, { cast: false });  // replaceable kick plate
  leafBox(0.12, 0.54, 0.14, 0xaeb7c0, 2.31, 0.03, -0.23);                // pull handle

  // Static structure: the 9 m wall now closes over a human-scale opening and
  // visibly contains the lifted leaf. These are not colliders — actors in this
  // game are 2-D AABBs, so a solid overhead lintel would invisibly seal the
  // doorway — but the masonry and header still block sight.
  const WALL = CBZ.COL && CBZ.COL.WALL != null ? CBZ.COL.WALL : 0x9aa0a8;
  addBox(0, 6.38, -8, 6.35, 5.24, 0.72, WALL, { cast: false, blockLOS: true });
  addBox(-3.10, 1.78, -8, 0.34, 3.56, 0.72, EDGE, { cast: false });
  addBox(3.10, 1.78, -8, 0.34, 3.56, 0.72, EDGE, { cast: false });
  addBox(0, 3.50, -8, 6.54, 0.34, 0.78, EDGE, { cast: false });
  addBox(-2.78, 5.70, -7.60, 0.10, 4.00, 0.12, KICK, { cast: false });
  addBox(2.78, 5.70, -7.60, 0.10, 4.00, 0.12, KICK, { cast: false });

  // Access control is bolted to the housing-side jamb. It changes material at
  // runtime but never changes transform, so it is dynamic, not a mover.
  const reader = addBox(3.52, 1.48, -8.42, 0.48, 0.78, 0.18, 0x222831, { cast: false });
  reader.userData.dynamic = true;
  addBox(3.52, 1.35, -8.53, 0.24, 0.08, 0.04, 0xaeb7c0, { cast: false });
  const readerLight = addBox(3.52, 1.72, -8.54, 0.18, 0.18, 0.06, 0xff3b3b,
    { emissive: 0xff0000, ei: 1.0, cast: false });
  readerLight.userData.dynamic = true;

  const door = {
    mesh, reader, readerLight,
    collider: mesh.userData.collider,
    open: false, closedY: CLOSED_Y, travel: TRAVEL, t: 0,
    readerPos: { x: 3.52, y: 1.72, z: -8.54 },
  };

  CBZ.door = door;

  /* closeDoor(soft) — `soft` is the ONE addition: with it, the collider, the
     reader lamp and the open flag change on this frame exactly as before, but
     the leaf is left where it is for systems/interactions.js's ramp to lower
     at the authored 1.6 rate. Callers that pass nothing (systems/lockdown.js's
     slam, systems/state.js's reset, the storyboards) get the historic
     teleport, byte for byte — a lockdown SHOULD snap and a reset must not
     animate behind the fade. */
  CBZ.closeDoor = function (soft) {
    door.open = false;
    if (!soft) { door.t = 0; door.mesh.position.y = door.closedY; }
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

  /* ---- AND A WAY TO SHUT IT (systems/interactions.js's CBZ.prisonDoors) ----
     One declaration into the shared registry; the tap path and the polled [E]
     both end in the set() below, so this file still owns the only code that
     moves the leaf. The credential is `hasKey` — the exact condition
     interactions.js's approach-open tests — because a door you could not have
     opened is not a door you may close. `autoR` is 4 m: that open test is
     `ddx*ddx + ddz*ddz < 16` on the same point. */
  (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
    id: "prison-yard-door", label: "the yard checkpoint", autoR: 4.0,
    at: function () { return { x: 0, y: 1.8, z: -8 }; },
    pick: function () { return [mesh]; },
    col: function () { return door.collider; },
    isOpen: function () { return !!door.open; },
    permanent: function () { return !!door.blown; },
    canUse: function () { return !!(CBZ.game && CBZ.game.hasKey); },
    set: function (v) {
      if (v) { CBZ.openDoor(); return !!door.open; }
      CBZ.closeDoor(true);
      // the existing 85 dB door_close cue, from the leaf's own coordinates —
      // CBZ.openDoor's counterpart cue is CBZ.sfx because it fires at arm's
      // length; a door you shut is likewise yours, but the slab is 5.7 m of
      // steel across the yard from anyone else, so it speaks from where it is.
      if (CBZ.worldSfx) CBZ.worldSfx("door_close", 0, -8, { ref: 12 });
      return !door.open;
    },
  });
})();
