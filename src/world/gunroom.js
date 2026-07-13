/* ============================================================
   world/gunroom.js - locked armory with physical weapon rack slots.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  const { addBox, roomShell } = CBZ;

  roomShell({
    x0: 19, x1: 29, z0: -6, z1: 8, h: 6,
    wall: 0x515a66, floor: 0x3a414b,
    door: { side: "W", center: 1, width: 3.0 },
  });

  addBox(19, 5.4, 1, 0.2, 0.8, 2.8, 0xc94d3a, { cast: false }); // red "ARMORY" band

  // the locked gate filling the doorway gap
  const gate = addBox(19, 3, 1, 0.6, 6, 3.0, 0x2a2f38, { solid: true, blockLOS: true, emissive: 0x111418, ei: 0.4 });
  // cross-bars on the gate
  addBox(19, 4.2, 1, 0.7, 0.18, 3.0, 0x4a525c, { cast: false });
  addBox(19, 2.0, 1, 0.7, 0.18, 3.0, 0x4a525c, { cast: false });
  const lamp = addBox(20, 4.4, 1, 0.18, 0.18, 0.18, 0xff3b3b, { emissive: 0xff0000, ei: 1.0, cast: false });

  const armory = { gate, lamp, collider: gate.userData.collider, open: false, t: 0, slots: [] };

  // Rack backboard and hooks.
  addBox(27.8, 1.75, 1, 0.55, 2.7, 11.6, 0x3c2f22, {});
  for (let i = -2; i <= 2; i++) {
    addBox(27.38, 2.38, 1 + i * 2.0, 0.5, 0.08, 1.35, 0x14181d, { cast: false });
    addBox(27.38, 1.38, 1 + i * 2.0, 0.5, 0.08, 1.35, 0x14181d, { cast: false });
  }

  const mats = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xf0c39a }),
  };

  function box(parent, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function fallbackGun() {
    const g = new THREE.Group();
    box(g, 0.15, 0.10, 0.54, mats.steel, 0, 0.04, -0.3);
    box(g, 0.12, 0.23, 0.12, mats.dark, 0, -0.15, -0.02, -0.2);
    g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.62);
    return g;
  }

  function buildRackModel(id) {
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[id];
    const model = builder ? builder({ THREE, box, cyl, mat: mats }) : fallbackGun();
    model.scale.setScalar(id === "sidearm" || id === "taser" ? 1.25 : 1.05);
    model.rotation.set(0.04, 0, 0);
    return model;
  }

  const rackData = [
    { id: "sidearm", z: -3.0, y: 2.35, name: "9MM SIDEARM" },
    { id: "shotgun", z: -1.0, y: 2.18, name: "12G PUMP" },
    { id: "carbine", z: 1.0, y: 2.18, name: "M4 CARBINE" },
    { id: "smg", z: 3.0, y: 2.20, name: "COMPACT SMG" },
    { id: "taser", z: 5.0, y: 2.35, name: "X26 TASER" },
  ];

  function makeSlot(data) {
    const pad = addBox(27.25, data.y - 0.52, data.z, 0.12, 0.09, 1.55, 0x202833, { cast: false, emissive: 0x080b10, ei: 0.5 });
    const model = buildRackModel(data.id);
    model.position.set(27.18, data.y, data.z + 0.46);
    CBZ.scene.add(model);
    const slot = { id: data.id, name: data.name, pad, model, taken: false, cool: 0, x: 26.2, z: data.z };
    armory.slots.push(slot);
    return slot;
  }
  rackData.forEach(makeSlot);

  function refreshSlotVisual(slot) {
    const owned = CBZ.hasWeapon && CBZ.hasWeapon(slot.id);
    slot.taken = !!owned;
    slot.pad.material.color.setHex(owned ? 0x254f35 : 0x202833);
    slot.pad.material.emissive.setHex(owned ? 0x0b3b1b : 0x080b10);
    slot.model.visible = true;
    slot.model.scale.setScalar((slot.id === "sidearm" || slot.id === "taser" ? 1.25 : 1.05) * (owned ? 0.92 : 1));
  }

  armory.resetSlots = function () {
    armory.slots.forEach((slot) => { slot.cool = 0; refreshSlotVisual(slot); });
  };

  function pickupSlot(slot) {
    const owned = CBZ.hasWeapon && CBZ.hasWeapon(slot.id);
    if (owned && CBZ.currentWeaponId === slot.id) return;
    const first = owned ? false : (CBZ.unlockWeapon && CBZ.unlockWeapon(slot.id, { select: true }));
    if (owned && CBZ.setCurrentWeapon) CBZ.setCurrentWeapon(slot.id);
    refreshSlotVisual(slot);
    CBZ.sfx(first ? "pickup" : "equip");
    CBZ.flashHint((first ? "Picked up " : "Equipped ") + slot.name + " — Q/wheel swaps.", 1.8);
  }

  // the prize: a big cigarette stash
  if (CBZ.addPack) {
    CBZ.addPack(24, 1, 20);
    CBZ.addPack(24, 4, 15);
    CBZ.addPack(24, -2, 15);
  }

  // key-gated opening + rack pickups
  CBZ.onUpdate(41, function (dt) {
    if (!armory.open) {
      const dx = CBZ.player.pos.x - 19, dz = CBZ.player.pos.z - 1;
      const near = dx * dx + dz * dz < 14;
      if (near) {
        if (CBZ.game.hasKey || CBZ.game.role === "cop") {
          armory.open = true;
          const i = CBZ.colliders.indexOf(armory.collider);
          if (i >= 0) CBZ.colliders.splice(i, 1);
          if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
          armory.lamp.material.color.setHex(0x39ff88);
          armory.lamp.material.emissive.setHex(0x14c258);
          CBZ.sfx("door");
          CBZ.flashHint("The armory rack's open — take what you need.", 2.6);
        } else {
          CBZ.flashHint("The armory door won't budge — it wants a keycard.", 1.2);
        }
      }
    } else if (armory.t < 1) {
      armory.t = Math.min(1, armory.t + dt * 1.6);
      armory.gate.position.y = 3 + armory.t * 6;
    } else {
      // shared gate: at most one rack pickup every ~0.35s, so walking past a
      // row of weapons collects them one-at-a-time instead of all at once
      // (which used to fire a burst of swap sounds).
      armory._pickCD = Math.max(0, (armory._pickCD || 0) - dt);
      let best = null, bestD = 5.2;
      for (const slot of armory.slots) {
        slot.cool = Math.max(0, slot.cool - dt);
        // Only AUTO-COLLECT weapons you don't own yet. Standing on a rack you
        // already own must NOT keep re-equipping it — that was overriding the
        // Q / scroll weapon switch every frame (switch, then snap back).
        if (CBZ.hasWeapon && CBZ.hasWeapon(slot.id)) continue;
        const dx = CBZ.player.pos.x - slot.x, dz = CBZ.player.pos.z - slot.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD && slot.cool <= 0) { best = slot; bestD = d2; }
      }
      if (best && armory._pickCD <= 0) {
        best.cool = 1.2;
        armory._pickCD = 0.35;
        pickupSlot(best);
      }
    }
  });

  CBZ.armory = armory;
})();
