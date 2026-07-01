/* ============================================================
   entities/player.js — the escapee: model + movement state container
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  CBZ.SPAWN = new THREE.Vector3(-11, 0, -39);
  CBZ.COP_SPAWN = new THREE.Vector3(23, 0, 36);

  // ---- W4: player build (m/f) — persisted across sessions -------------------
  // The rig's proportions (character.js's c.build gate) are baked in at
  // makeCharacter() time, and everything downstream (cop accessories below,
  // bling/armor/outfit systems in 30+ other files) grabs live mesh references
  // off THIS object at various points during play. Re-pointing every one of
  // those in place is fragile, so the choice is only read at BOOT: change it
  // via CBZ.setPlayerBuild(), which persists + reloads. See that function for
  // the full reasoning.
  function readSavedBuild() {
    try {
      const v = localStorage.getItem("cbz_playerBuild");
      return v === "f" ? "f" : "m";
    } catch (e) { return "m"; }
  }
  const playerBuild = readSavedBuild();

  // orange prison jumpsuit with darker stripes — unmistakably "the convict"
  const playerChar = CBZ.makeCharacter({
    legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a,
    skin: 0xf0c39a, hair: 0x4a3526, shoes: 0x2b2b2b,
    stripes: 0xc85c00, belt: 0x6b4a2a,
    build: playerBuild, longHair: playerBuild === "f",
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

  // current saved build ("m"/"f") — read once at boot; the panel toggle
  // (city/charpanel.js) reads this to highlight the active choice.
  CBZ.getPlayerBuild = function () { return playerBuild; };

  // ---- W4: change build ------------------------------------------------------
  // WHY RELOAD INSTEAD OF A LIVE REBUILD: makeCharacter's fem/male proportions
  // (leg/torso/arm width, head size, hip flare — character.js) are structural,
  // not a recolor, and CBZ.playerChar is dereferenced live all over the place —
  // cop accessories mounted directly onto THIS rig's neck/body at boot above,
  // bling.js/armor.js mounting worn jewellery+kit shells onto specific mesh
  // anchors, gore.js severed-leg state tied to specific leg meshes, facial.js
  // rewriting eye/mouth mesh positions, ragdoll/physics/capture/combat reading
  // ch.parts directly, plus outfit/clothes canvas painting on the current
  // skinSlots meshes. Re-pointing every one of those consumers to a freshly
  // built rig's new meshes (and moving/re-mounting every attachment) is a long
  // tail of easy-to-miss breakage for a cosmetic toggle. Persist + reload is
  // simple, always correct, and the boot path above already re-creates the
  // rig with the saved build.
  CBZ.setPlayerBuild = function (build) {
    build = (build === "f") ? "f" : "m";
    if (build === readSavedBuild()) return false;   // already the active build
    try { localStorage.setItem("cbz_playerBuild", build); } catch (e) {}
    if (typeof CBZ.flashHint === "function") {
      CBZ.flashHint((build === "f" ? "Female" : "Male") + " build set — reloading…", 1.6);
    }
    const doReload = function () { try { location.reload(); } catch (e) {} };
    // small delay so the hint has a chance to paint before a blocking confirm()
    setTimeout(function () {
      let ok = true;
      try { ok = window.confirm ? window.confirm("Changing build reloads the game. Continue?") : true; } catch (e) { ok = true; }
      if (ok) doReload();
    }, 30);
    return true;
  };
})();
