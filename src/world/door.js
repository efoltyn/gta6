/* ============================================================
   world/door.js — THE HOUSING UNIT'S SALLY PORT: the wing's only way in
   and out, on the keycard. Exposes CBZ.door + openDoor()/closeDoor().

   OWNER (2026-09-29): "I don't think there are doors that are so fancy,
   like the one you have at the exit of the housing area. I don't think
   those doors really exist. I think every jail just has many, many sets
   of those real doors that are in the warden area."

   He is right. This was a 5.7 x 3.4 m armoured slab with a picture window
   that rose 4.35 m into the wall like a hangar door. A housing unit's
   entrance is a SALLY PORT: "a security vestibule with two or more doors
   ... to prevent continuous and unobstructed passage" — an inner door in
   the unit wall, a small vestibule, an outer door, each a detention steel
   door, released from control, with a card reader, an intercom and a
   camera. That is what stands here now, built from the prison's one door
   kit (world/corridorkit.js: the frame, the leaf, the reader, the infill).

   WHAT DID NOT MOVE. The door is still ONE gameplay door: CBZ.door.open,
   .t, .blown, .collider, .readerLight, .padPos, openDoor()/closeDoor(),
   the breach row and the registry spec are the same contract every caller
   (interactions, schedule, lockdown, state, compass, AI) already reads.
   The control post runs this port in MOVEMENT mode — both leaves released
   together for a mass movement, which is what the interlock override on a
   real unit console is for — so the yard-time schedule, the evening muster
   and the keycard all move the pair as one, exactly as they moved the slab.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/door.js", function () {
  const { addBox } = CBZ;
  const CK = CBZ.corridorKit;
  const K = CBZ.prisonKit || null;
  if (!CK) return;

  const WALL = CBZ.COL && CBZ.COL.WALL != null ? CBZ.COL.WALL : 0x9aa0a8;
  const WZ = -8, WT = 1.0, WTOP = 9;          // the unit's south wall line, its thickness and height
  const GAP = 3;                               // the wall's opening, x[-3,3] (world/yard.js, cellblock.js)
  const DC = 1.2, DH = 2.7;                    // the door's rough opening x[-1.2,1.2], head height
  const VX = 2.5, VT = 0.3, VZ1 = -3.75, VH = 3.3;   // the vestibule: x[-2.5,2.5], out wall at z -3.75
  const FRAME = 0x39424e, LEAF = 0x4f5d6b;

  // ---- the inner door in the unit wall: block either side of a steel pair
  CK.infill({ axis: "x", a0: -GAP, a1: GAP, c0: -DC, c1: DC, fixed: WZ, t: WT, top: WTOP, head: DH,
    color: WALL, skin: "panel" });
  const inner = CK.doorSet({ axis: "x", a0: -DC, a1: DC, fixed: WZ, t: WT, h: DH, open: 1, hinge: 0,
    frame: FRAME, build: CK.detentionLeaf({ color: LEAF }) });

  // ---- the vestibule: two side walls, the out wall, a roof, a light
  const vz0 = WZ + WT / 2, vzc = (vz0 + VZ1 + VT / 2) / 2, vlen = VZ1 + VT / 2 - vz0;
  for (const s of [-1, 1]) {
    const m = addBox(s * (VX - VT / 2), VH / 2, vzc, VT, VH, vlen, WALL, { solid: true, blockLOS: true });
    if (m.userData.collider) m.userData.collider.noBreach = true;
    if (K) K.skinBox(m, "panel", WALL);
  }
  CK.infill({ axis: "x", a0: -VX, a1: VX, c0: -DC, c1: DC, fixed: VZ1, t: VT, top: VH, head: DH,
    color: WALL, skin: "panel" });
  const outer = CK.doorSet({ axis: "x", a0: -DC, a1: DC, fixed: VZ1, t: VT, h: DH, open: 1, hinge: 0,
    frame: FRAME, build: CK.detentionLeaf({ color: LEAF }) });
  {
    const roof = addBox(0, VH + 0.1, vzc, 2 * VX + 0.2, 0.2, vlen + 0.2, 0x8f959c, { cast: true, blockLOS: true });
    if (K) K.skinBox(roof, "concrete", 0x9ea3a8);
    if (K) {
      const fl = new THREE.BoxGeometry(2 * (VX - VT), 0.02, vlen);
      K.stat(fl, K.skin("polished", 0x9a9fa6), 0, 0.01, vzc, { uv: 2, cast: false });
    }
    CK.strip(0, VH - 0.02, vzc, 2.2, "x");
    // the cameras: a dome in the vestibule ceiling, one on the out wall's yard face
    for (const c of [{ x: 1.5, y: VH - 0.02, z: vzc }, { x: -1.9, y: DH + 0.55, z: VZ1 + VT / 2 + 0.11 }]) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        K ? K.skin("glass", 0x202830) : new THREE.MeshLambertMaterial({ color: 0x202830 }));
      dome.position.set(c.x, c.y, c.z);
      (CBZ.prisonRoot || CBZ.scene).add(dome);
      addBox(c.x, c.y + 0.02, c.z, 0.22, 0.04, 0.22, 0x3a4048, { cast: false });
    }
  }

  // ---- access control: the card reader beside the inner door on the unit
  // side (where a man in the block holds his card), and its twin on the
  // yard face of the out door. ONE LED material, because
  // systems/interactions.js beats it amber on a refusal and this file turns
  // it green on open. An intercom to control beside each.
  const RX = DC + 0.075 + 0.28;
  const rIn = CK.cardReader(RX, 1.2, WZ - WT / 2, 0, -1);
  const rOut = CK.cardReader(RX, 1.2, VZ1 + VT / 2, 0, 1);
  rOut.led.material = rIn.led.material;
  CK.intercom(-RX, 1.45, WZ - WT / 2, 0, -1);
  CK.intercom(-RX, 1.45, VZ1 + VT / 2, 0, 1);
  CK.intercom(VX - VT, 1.45, (vz0 + VZ1) / 2, -1, 0);

  // ---- the gameplay door
  const pivots = inner.leaves.concat(outer.leaves).map(function (L) { return L.pivot; });
  const slabs = inner.leaves.concat(outer.leaves).map(function (L) { return L.slab; }).filter(Boolean);
  // each shut pair is its own slab, floor to frame head (world/corridorkit.js
  // leafCollider), not the wall's depth to the sky
  const collider = CK.leafCollider(inner, -DC, DC, 0, DH, slabs[0] || pivots[0]);
  const outCollider = CK.leafCollider(outer, -DC, DC, 0, DH, slabs[2] || pivots[2]);
  CBZ.colliders.push(collider, outCollider);
  if (CBZ.losBlockers) for (const s of slabs) CBZ.losBlockers.push(s);
  if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  function losTo(on) {
    const L = CBZ.losBlockers;
    if (!L) return;
    for (const s of slabs) {
      const i = L.indexOf(s);
      if (on && i < 0) L.push(s);
      else if (!on && i >= 0) L.splice(i, 1);
    }
  }

  const door = {
    mesh: slabs[0] || pivots[0], pivots: pivots, slabs: slabs,
    reader: rIn.body, readerLight: rIn.led,
    collider: collider, outCollider: outCollider,
    open: false, t: 0,
    // the leaves SWING now; `drive(t)` is the one thing that moves them
    // (systems/interactions.js ramps t at its authored 1.6 rate). closedY /
    // travel stay for old callers that still read them: a swing has no lift.
    closedY: 0, travel: 0,
    drive: function (t) { inner.set(t); outer.set(t); },
    readerPos: rIn.readerPos,
    // the read pad's face and the way it faces: where a card is held to it
    // (systems/interactions.js, CBZ.verbs.touch)
    padPos: rIn.padPos,
    padN: rIn.padN,
    // the port's two faces, for anything that asks where the doorway is
    inner: { x: 0, z: WZ }, outer: { x: 0, z: VZ1 },
  };
  CBZ.door = door;

  function colSet(on) {
    for (const c of [collider, outCollider]) {
      const i = CBZ.colliders.indexOf(c);
      if (on && i < 0) CBZ.colliders.push(c);
      else if (!on && i >= 0) CBZ.colliders.splice(i, 1);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* closeDoor(soft) — with `soft`, the colliders, the reader lamp and the
     open flag change on this frame but the leaves are left where they are
     for systems/interactions.js's ramp to swing shut at the authored 1.6
     rate. Callers that pass nothing (systems/lockdown.js's slam,
     systems/state.js's reset, the storyboards) snap the pair shut — a
     lockdown SHOULD slam and a reset must not animate behind the fade. */
  CBZ.closeDoor = function (soft) {
    if (door.blown) return;
    door.open = false;
    if (!soft) { door.t = 0; door.drive(0); }
    door.readerLight.material.color.setHex(0xff3b3b);
    door.readerLight.material.emissive.setHex(0xff0000);
    colSet(true);
    losTo(true);
  };

  CBZ.openDoor = function () {
    if (door.open) return;
    door.open = true;
    colSet(false);
    losTo(false);
    door.readerLight.material.color.setHex(0x39ff88);     // reader turns green
    door.readerLight.material.emissive.setHex(0x14c258);
    if (CBZ.sfx) CBZ.sfx("door_open");
  };

  /* ---- A SECOND WAY THROUGH (systems/breach.js) ---------------------------
     THE KEYCARD STORY, doctrine LAW 1: this door is the one the whole escape
     game is built around, and a breaching charge is a second answer with a
     different PRICE: the keycard is quiet and needs a plan; 5 lb of C4 on the
     reader is loud, costs a charge you had to steal from the armory, and
     brings every guard in the block. 5 lb is the doctrinal row for a hole
     one man can move through (FM 90-10-1 app.M). The charge takes BOTH
     leaves of the pair it is set on, and the out door with them. */
  if (CBZ.registerBreachTarget) {
    CBZ.registerBreachTarget({
      id: "prison-yard-door",
      lb: 5,
      reach: 3.0,
      at: function () { return { x: 0, y: 1.4, z: WZ }; },
      done: function () { return !!door.open; },    // already blown/opened: not a target
      defeat: function () {
        CBZ.openDoor();
        door.blown = true;
        for (const p of pivots) p.visible = false;
        losTo(false);
        if (CBZ.addHeat) CBZ.addHeat(60);           // every screw in the block heard that
        if (CBZ.guards) for (const gd of CBZ.guards) { gd.alert = 1; gd.hunt = Math.max(gd.hunt || 0, 6); }
        if (CBZ.jailTell) CBZ.jailTell.hint("THE DOOR IS GONE", 2.4);
        else if (CBZ.flashHint) CBZ.flashHint("THE DOOR IS GONE", 2.4);
      },
    });
  }
  // A NEW RUN HANGS THE PAIR AGAIN. closeDoor() refuses a blown door (a
  // lockdown must not resurrect it mid-run), so a blown port used to stay a
  // hole in every run after it; systems/state.js's reset calls this instead.
  door.reset = function () {
    door.blown = false;
    for (const p of pivots) p.visible = true;
    CBZ.closeDoor();
  };

  /* ---- AND A WAY TO SHUT IT (systems/interactions.js's CBZ.prisonDoors) ----
     One declaration into the shared registry; the tap path and the polled [E]
     both end in the set() below. The credential is `hasKey` — the exact
     condition interactions.js's approach-open tests. `autoR` is 4 m: that
     open test is `ddx*ddx + ddz*ddz < 16` on the same point. */
  (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
    id: "prison-yard-door", label: "the unit door", autoR: 4.0, keys: ["Keycard"],
    // the face you are at: the inner door from the wing and the vestibule's
    // back, the out door from the yard (both faces carry a reader)
    at: function () {
      const P = CBZ.player && CBZ.player.pos;
      return { x: 0, y: 1.6, z: P && P.z > (WZ + VZ1) / 2 ? VZ1 : WZ };
    },
    pick: function () { return pivots; },
    col: function () { return door.collider; },
    cols: function () { return [collider, outCollider]; },
    isOpen: function () { return !!door.open; },
    permanent: function () { return !!door.blown; },
    // the stolen card, or the officer's own keys (CBZ.prisonStaffKey)
    canUse: function () { return !!(CBZ.game && (CBZ.game.hasKey || (CBZ.prisonStaffKey && CBZ.prisonStaffKey()))); },
    set: function (v) {
      if (v) { CBZ.openDoor(); return !!door.open; }
      CBZ.closeDoor(true);
      if (CBZ.worldSfx) CBZ.worldSfx("door_close", 0, WZ, { ref: 12 });
      return !door.open;
    },
  });
  });
})();
