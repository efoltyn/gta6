/* ============================================================
   systems/holsterprops.js — every gun VISIBLE on the player's body.

   Owned-but-not-drawn weapons read on the rig instead of vanishing into a
   hammerspace, Fortnite-style:
     · best long gun strapped DIAGONALLY across the back;
     · a SECOND long gun crosses it in an X (mirrored diagonal, staggered);
     · best pistol rides a real holster on the RIGHT HIP;
     · the DRAWN weapon shows in the HAND in third person, barrel-locked to
       the crosshair while presenting (owner: "gun still not visible in
       hands when aiming in TP" — this module now owns that display and
       hides fpsmode's legacy carriedGun so one gun never shows twice).
   Mount transforms live on the rig itself (CBZ.charMounts, entities/
   character.js) and are parented to rig.body, so everything follows the
   walk/sprint/crouch animation and first-person (whole rig hidden) needs
   no special-casing.

   Models come from CBZ.buildActorWeapon (systems/actorweapons.js) — the same
   cheap box guns NPCs carry — rebuilt ONLY when the chosen id changes.

   Flags (one-line reverts):
     CHAR_WEAPON_MOUNTS  false → the old single-back/waistband placement.
     CHAR_TP_HAND_GUN    false → hand display off (fpsmode's carriedGun
                                 becomes visible again untouched).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.CONFIG.CHAR_WEAPON_MOUNTS == null) CBZ.CONFIG.CHAR_WEAPON_MOUNTS = true;
  if (CBZ.CONFIG.CHAR_TP_HAND_GUN == null) CBZ.CONFIG.CHAR_TP_HAND_GUN = true;

  // hip = pistol-ish slots; back = everything long. utility (taser) stays
  // beltable; heavy launchers ride the back like rifles.
  function isHip(meta) { return meta && (meta.slot === "pistol" || meta.slot === "utility"); }
  function isLongSlot(slot) { return slot === "long" || slot === "rifle" || slot === "auto"; }

  const mounts = {
    back: { prop: null, id: null },
    back2: { prop: null, id: null },
    hip: { prop: null, id: null },
    hand: { prop: null, id: null, long: false },
  };

  function disposeProp(m) {
    if (!m.prop) return;
    if (m.prop.parent) m.prop.parent.remove(m.prop);
    m.prop.traverse((obj) => {
      if (obj.geometry && obj.geometry.dispose && !obj.geometry._shared) obj.geometry.dispose();
      const mm = obj.material;
      if (mm && !mm._shared && mm.dispose) mm.dispose();
    });
    m.prop = null; m.id = null;
  }

  // ---- STOWED props on the body mounts ------------------------------------
  // scale: 0.92 on the back reads a touch oversized (stylized-rig trick —
  // Fortnite scales stowed guns up) vs the 0.82 NPC hand scale; hip pistols
  // keep their 0.92 build scale.
  function mountTo(m, id, mountGroup, scale) {
    if (m.id !== id) {
      disposeProp(m);
      if (id && CBZ.buildActorWeapon) {
        m.prop = CBZ.buildActorWeapon(id);
        m.id = id;
        // OVERWRITE the hand-mount transform buildActorWeapon ships (see
        // charMounts contract): the mount group carries the whole pose.
        m.prop.position.set(0, 0, 0);
        m.prop.rotation.set(0, 0, 0);
        m.prop.scale.setScalar(scale);
        // stowed guns never cast the aim shadow of a drawn one; keep the
        // silhouette cheap (decorative — colliders/LOS never see them)
        m.prop.traverse((obj) => { obj.castShadow = false; });
      }
    }
    if (m.prop) {
      if (m.prop.parent !== mountGroup) mountGroup.add(m.prop);
      m.prop.visible = true;
    }
  }

  // ---- legacy placement (CHAR_WEAPON_MOUNTS=false revert path) ------------
  function mountLegacy(m, id, body, place) {
    if (m.id !== id) {
      disposeProp(m);
      if (id && CBZ.buildActorWeapon) {
        m.prop = CBZ.buildActorWeapon(id);
        m.id = id;
        m.prop.traverse((obj) => { obj.castShadow = false; });
        place(m.prop);
      }
    }
    if (m.prop) {
      if (m.prop.parent !== body) body.add(m.prop);
      m.prop.visible = true;
    }
  }
  function placeBackLegacy(prop) {
    prop.position.set(0.05, 1.42, -0.34);
    prop.rotation.set(0, Math.PI / 2, 0);      // barrel along body X (sideways)
    prop.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -0.62); // then tip it diagonal
  }
  function placeHipLegacy(prop) {
    prop.position.set(0.24, 1.08, -0.3);
    prop.rotation.set(-Math.PI / 2, 0, 0);     // barrel straight down
    prop.rotateZ(0.28);                        // canted toward the spine
  }

  // Choose what rides each mount. LATER entries in weaponInventory are newer
  // acquisitions — prefer them, GTA-style "latest primary on the back". Up to
  // TWO long guns stow (the X-cross); the drawn copy is skipped exactly once
  // so a duplicate id still shows.
  function pickStowed(heldId) {
    const longs = [];
    let hip = null;
    const inv = CBZ.weaponInventory || [];
    let heldSkipped = !heldId;
    for (let i = inv.length - 1; i >= 0; i--) {
      const id = inv[i];
      if (!heldSkipped && id === heldId) { heldSkipped = true; continue; }
      const meta = CBZ.weaponById && CBZ.weaponById(id);
      if (!meta) continue;
      if (isHip(meta)) { if (!hip) hip = id; }
      else if (longs.length < 2) longs.push(id);
    }
    return { back: longs[0] || null, back2: longs[1] || null, hip };
  }

  if (CBZ.onUpdate) CBZ.onUpdate(37, function () {
    const ch = CBZ.playerChar;
    if (!ch || !ch.body) return;
    const g = CBZ.game;
    // survival/battle-royale keeps its own loadout drama; jail + city show steel.
    const show = g && (g.mode === "city" || g.mode === "escape") && !(CBZ.player && CBZ.player.dead);
    if (!show) {
      if (mounts.back.prop) mounts.back.prop.visible = false;
      if (mounts.back2.prop) mounts.back2.prop.visible = false;
      if (mounts.hip.prop) mounts.hip.prop.visible = false;
      return;
    }
    // What's actually in the hand right now (drawn, not holstered/melee)?
    const armed = CBZ.playerArmed && CBZ.playerArmed();
    const heldId = armed ? CBZ.currentWeaponId : null;
    const stow = pickStowed(heldId);
    const mp = (CBZ.CONFIG.CHAR_WEAPON_MOUNTS !== false && CBZ.charMounts) ? CBZ.charMounts(ch) : null;
    if (mp) {
      if (stow.back) mountTo(mounts.back, stow.back, mp.back, 0.92);
      else if (mounts.back.prop) mounts.back.prop.visible = false;
      if (stow.back2) mountTo(mounts.back2, stow.back2, mp.back2, 0.92);
      else if (mounts.back2.prop) mounts.back2.prop.visible = false;
      if (stow.hip) mountTo(mounts.hip, stow.hip, mp.hip, 0.92);
      else if (mounts.hip.prop) mounts.hip.prop.visible = false;
    } else {
      if (stow.back) mountLegacy(mounts.back, stow.back, ch.body, placeBackLegacy);
      else if (mounts.back.prop) mounts.back.prop.visible = false;
      if (mounts.back2.prop) mounts.back2.prop.visible = false;   // legacy shows one long gun only
      if (stow.hip) mountLegacy(mounts.hip, stow.hip, ch.body, placeHipLegacy);
      else if (mounts.hip.prop) mounts.hip.prop.visible = false;
    }
  });

  // ---- DRAWN weapon IN THE HAND (third person) -----------------------------
  // Runs at onAlways(54): after animChar posed the arm, after systems/camera
  // (50) fixed the lens, and after fpsmode's onAlways(52) wrote its own
  // carriedGun state — so our hide of that legacy prop wins the frame.
  const _hgPos = new THREE.Vector3(), _hgDir = new THREE.Vector3(), _hgTarget = new THREE.Vector3();
  const _hgZero = new THREE.Vector3(0, 0, 0), _hgUp = new THREE.Vector3(0, 1, 0);
  const _hgMat = new THREE.Matrix4();
  const _hgWorldQ = new THREE.Quaternion(), _hgParentQ = new THREE.Quaternion();

  if (CBZ.onAlways) CBZ.onAlways(54, function () {
    const hand = mounts.hand;
    if (CBZ.CONFIG.CHAR_TP_HAND_GUN === false) {
      if (hand.prop) hand.prop.visible = false;
      return;
    }
    const ch = CBZ.playerChar;
    const g = CBZ.game;
    const inTP = !(CBZ.fps && CBZ.fps.active);
    const show = ch && ch.sockets && inTP &&
      g && (g.mode === "city" || g.mode === "escape") &&
      CBZ.player && !CBZ.player.dead && !CBZ.player.driving &&
      CBZ.playerArmed && CBZ.playerArmed();
    const heldId = show ? (CBZ.currentWeaponId || null) : null;
    if (!heldId) {
      if (hand.prop) hand.prop.visible = false;
      return;
    }
    // one gun never shows twice: fpsmode's legacy TP carriedGun (the parent
    // group of CBZ.fpsCarriedModels) yields ONLY while this display is live —
    // survival keeps its own carried-gun drama untouched. Runs after
    // fpsmode's onAlways(52) visibility write, so the hide wins the frame.
    // Guard-called — if fpsmode ever drops the export this is a no-op.
    const cm = CBZ.fpsCarriedModels;
    const cg = cm && cm.length ? cm[0].parent : null;
    if (cg && cg !== hand.prop) cg.visible = false;
    const socket = ch.sockets.thirdPersonWeapon || ch.sockets.weapon || ch.sockets.rightHand;
    if (!socket) return;
    if (hand.id !== heldId) {
      disposeProp(hand);
      if (CBZ.buildActorWeapon) {
        hand.prop = CBZ.buildActorWeapon(heldId);
        hand.id = heldId;
        hand.long = isLongSlot(hand.prop.userData && hand.prop.userData.weaponSlot);
        // TP guns read BIGGER than build scale (standard third-person trick:
        // the over-shoulder camera sits metres away — at NPC scale the held
        // gun vanished into the blocky hand).
        hand.prop.scale.setScalar(hand.long ? 1.12 : 0.98);
      }
    }
    if (!hand.prop) return;
    if (hand.prop.parent !== socket) socket.add(hand.prop);
    hand.prop.visible = true;
    hand.prop.position.set(0.02, 0.02, 0.03);
    const presenting = CBZ.tpPresenting && CBZ.tpPresenting();
    if (presenting && CBZ.camera) {
      // WORLD BARREL LOCK while presenting: the pose chain (body-yaw damp →
      // shoulder → elbow → hand) only APPROXIMATES the aim, so a socket-posed
      // barrel drifts off the crosshair. Keep POSITION parented to the hand
      // but override ORIENTATION in world space so the barrel points exactly
      // at the crosshair ray's far point (parallax-correct from the gun's own
      // position) — the same technique fpsmode.js validated.
      hand.prop.getWorldPosition(_hgPos);          // r128: refreshes parent matrices itself
      _hgDir.set(0, 0, -1).applyQuaternion(CBZ.camera.quaternion);
      _hgTarget.copy(CBZ.camera.position).addScaledVector(_hgDir, 120);
      _hgDir.copy(_hgTarget).sub(_hgPos).normalize();
      _hgMat.lookAt(_hgZero, _hgDir, _hgUp);       // -Z along the aim dir = barrel on target
      _hgWorldQ.setFromRotationMatrix(_hgMat);
      socket.getWorldQuaternion(_hgParentQ);
      hand.prop.quaternion.copy(_hgParentQ.invert()).multiply(_hgWorldQ);
    } else {
      // low-ready: buildActorWeapon's own hand-mount orientation (barrel down
      // the forearm) — with animChar's carryPose arm the gun rides at the hip
      // pointing down-forward.
      hand.prop.rotation.set(Math.PI / 2, Math.PI, 0);
    }
  });
})();
