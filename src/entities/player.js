/* ============================================================
   entities/player.js — the escapee: model + movement state container
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  CBZ.SPAWN = new THREE.Vector3(-11, 0, -39);
  CBZ.COP_SPAWN = new THREE.Vector3(23, 0, 36);

  // orange prison jumpsuit with darker stripes — unmistakably "the convict"
  const playerChar = CBZ.makeCharacter({
    legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a,
    skin: 0xf0c39a, hair: 0x4a3526, shoes: 0x2b2b2b,
    stripes: 0xc85c00, belt: 0x6b4a2a,
  });
  CBZ.scene.add(playerChar.group);

  // Cop-mode accessories live on the same rig so existing systems keep
  // their references and only the outfit changes.
  const copCap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.66), CBZ.mat(0x17223c));
  copCap.position.y = 0.67; copCap.visible = false; playerChar.neck.add(copCap);
  const copBrim = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.3), CBZ.mat(0x17223c));
  copBrim.position.set(0, 0.58, 0.42); copBrim.visible = false; playerChar.neck.add(copBrim);
  const copBadge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), CBZ.mat(0xffd451));
  copBadge.position.set(-0.28, 1.55, 0.27); copBadge.visible = false; playerChar.body.add(copBadge);
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.08), CBZ.mat(0x0b0f18));
  radio.position.set(0.33, 1.55, 0.29); radio.visible = false; playerChar.body.add(radio);
  playerChar.skinSlots.cap.push(copCap, copBrim);
  playerChar.skinSlots.badge.push(copBadge, radio);

  function paint(list, color, visible) {
    list.forEach((m) => {
      if (!m) return;
      if (color != null && m.material && m.material.color) {
        // characters now share cached materials (world/materials.js cmat) —
        // clone-on-write so recolouring the PLAYER never bleeds onto NPCs
        // that share that colour.
        if (m.material._shared) m.material = m.material.clone();
        m.material.color.setHex(color);
      }
      if (visible != null) m.visible = visible;
    });
  }

  function applyPlayerRole(role) {
    const cop = role === "cop";
    const s = playerChar.skinSlots;
    paint(s.legs, cop ? 0x202a44 : 0xff7a1a);
    paint(s.torso, cop ? 0x263a67 : 0xff7a1a);
    paint(s.collar, cop ? 0x1b2848 : 0xff9747);
    paint(s.arms, cop ? 0x263a67 : 0xff7a1a);
    paint(s.shoes, cop ? 0x101010 : 0x2b2b2b);
    paint(s.stripes, 0xc85c00, !cop);
    paint(s.belt, cop ? 0x0d111c : 0x6b4a2a, true);
    paint(s.badge, null, cop);
    paint(s.cap, null, cop);
    paint(s.hair, null, !cop);
    CBZ.player.role = cop ? "cop" : "inmate";
  }

  const player = {
    pos: CBZ.SPAWN.clone(),
    vy: 0,
    grounded: true,
    crouch: false,
    radius: CBZ.TUNE.playerRadius,
    speed: 0,
    hp: 100,
    dead: false,
    ko: 0,
    // capability ratings + a combat record so the protagonist ranks on the
    // yard dashboard alongside everyone else (record is credited by ai.js).
    ratings: { fighting: 78, toughness: 72, speed: 80, stealth: 70, marksman: 74, cunning: 68 },
    behavior: "player",
    record: { kills: 0, knockdowns: 0, downs: 0, fights: 0 },
  };
  playerChar.group.position.copy(player.pos);

  CBZ.player = player;
  CBZ.playerChar = playerChar;
  CBZ.applyPlayerRole = applyPlayerRole;
})();
