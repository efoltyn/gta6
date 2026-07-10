/* ============================================================
   systems/holsterprops.js — stowed guns VISIBLE on the player's body.

   Owned-but-not-drawn weapons now read on the rig instead of vanishing into
   a hammerspace: the best long gun rides diagonally across the back, the best
   pistol sits on the right hip. The moment a gun is actually in the hand
   (fpsmode's carried/viewmodel), its stowed prop hides — one gun never shows
   twice. Attached to CBZ.playerChar.body, so first-person (whole rig hidden)
   and the build-swap reload need no special-casing.

   Models come from CBZ.buildActorWeapon (systems/actorweapons.js) — the same
   cheap box guns NPCs carry — rebuilt ONLY when the chosen id changes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // hip = pistol-ish slots; back = everything long. utility (taser) stays
  // beltable; heavy launchers ride the back like rifles.
  function isHip(meta) { return meta && (meta.slot === "pistol" || meta.slot === "utility"); }

  const mounts = {
    back: { prop: null, id: null },
    hip: { prop: null, id: null },
  };

  function disposeProp(m) {
    if (!m.prop) return;
    if (m.prop.parent) m.prop.parent.remove(m.prop);
    m.prop.traverse((obj) => {
      if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
      const mm = obj.material;
      if (mm && !mm._shared && mm.dispose) mm.dispose();
    });
    m.prop = null; m.id = null;
  }

  function mountProp(m, id, body, place) {
    if (m.id !== id) {
      disposeProp(m);
      if (id && CBZ.buildActorWeapon) {
        m.prop = CBZ.buildActorWeapon(id);
        m.id = id;
        // stowed guns never cast the aim shadow of a drawn one; keep the
        // silhouette cheap (they're decorative, colliders/LOS never see them)
        m.prop.traverse((obj) => { obj.castShadow = false; });
        place(m.prop);
      }
    }
    if (m.prop) {
      if (m.prop.parent !== body) body.add(m.prop);
      m.prop.visible = true;
    }
  }

  function placeBack(prop) {
    // diagonal across the back: grip at the right shoulder blade, muzzle at
    // the left hip. Torso back plane is z≈-0.25 (0.5 deep), so the gun lies
    // just behind it. buildActorWeapon's barrel runs -Z before its hand
    // mount rotation — we overwrite that mount entirely for the body.
    prop.position.set(0.05, 1.42, -0.34);
    prop.rotation.set(0, Math.PI / 2, 0);      // barrel along body X (sideways)
    prop.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -0.62); // then tip it diagonal
  }

  function placeHip(prop) {
    // back-waistband carry: the hanging arm (x 0.47–0.77) completely masks a
    // true side holster from every camera angle that matters, so the pistol
    // tucks against the lower back instead — grip up over the belt line,
    // slight cant, clearly readable from the chase camera.
    prop.position.set(0.24, 1.08, -0.3);
    prop.rotation.set(-Math.PI / 2, 0, 0);     // barrel straight down
    prop.rotateZ(0.28);                        // canted toward the spine
  }

  // Choose what rides each mount. LATER entries in weaponInventory are newer
  // acquisitions — prefer them, GTA-style "latest primary on the back".
  function pickStowed(heldId) {
    let back = null, hip = null;
    const inv = CBZ.weaponInventory || [];
    for (let i = 0; i < inv.length; i++) {
      const id = inv[i];
      if (id === heldId) continue;
      const meta = CBZ.weaponById && CBZ.weaponById(id);
      if (!meta) continue;
      if (isHip(meta)) hip = id; else back = id;
    }
    return { back, hip };
  }

  if (CBZ.onUpdate) CBZ.onUpdate(37, function () {
    const ch = CBZ.playerChar;
    if (!ch || !ch.body) return;
    const g = CBZ.game;
    // survival/battle-royale keeps its own loadout drama; jail + city show steel.
    const show = g && (g.mode === "city" || g.mode === "escape") && !(CBZ.player && CBZ.player.dead);
    if (!show) {
      if (mounts.back.prop) mounts.back.prop.visible = false;
      if (mounts.hip.prop) mounts.hip.prop.visible = false;
      return;
    }
    // What's actually in the hand right now (drawn, not holstered/melee)?
    const armed = CBZ.playerArmed && CBZ.playerArmed();
    const heldId = armed ? CBZ.currentWeaponId : null;
    const stow = pickStowed(heldId);
    if (stow.back) mountProp(mounts.back, stow.back, ch.body, placeBack);
    else if (mounts.back.prop) mounts.back.prop.visible = false;
    if (stow.hip) mountProp(mounts.hip, stow.hip, ch.body, placeHip);
    else if (mounts.hip.prop) mounts.hip.prop.visible = false;
  });
})();
