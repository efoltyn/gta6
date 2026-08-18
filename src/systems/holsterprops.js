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
  if (CBZ.weaponPhysics && CBZ.weaponPhysics.adopt) CBZ.weaponPhysics.adopt("tp-held");

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
  let transfer = null;
  let lastTransitionSeq = 0;
  const TRANSFER_POS_A = new THREE.Vector3(), TRANSFER_POS_B = new THREE.Vector3(), TRANSFER_POS = new THREE.Vector3();
  const TRANSFER_SCALE_A = new THREE.Vector3(), TRANSFER_SCALE_B = new THREE.Vector3(), TRANSFER_SCALE = new THREE.Vector3();
  const TRANSFER_Q_A = new THREE.Quaternion(), TRANSFER_Q_B = new THREE.Quaternion(), TRANSFER_Q = new THREE.Quaternion();
  const TRANSFER_WORLD = new THREE.Matrix4(), TRANSFER_LOCAL = new THREE.Matrix4(), TRANSFER_INV = new THREE.Matrix4();
  const TRANSFER_STATE_A = new THREE.Vector3(), TRANSFER_STATE_B = new THREE.Vector3(), TRANSFER_STATE_C = new THREE.Vector3();

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
  // A stowed gun is the same physical object as a drawn one, so it wears the
  // same real-dimension scale (weapons/weapon-scale.js); the caller's legacy
  // 0.92 remains only as the module-absent fallback.
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
        m.prop.scale.setScalar((CBZ.weaponHeldScale && CBZ.weaponHeldScale(id)) || scale);
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
    prop.position.set(-0.24, 1.08, -0.3);
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

  function transferZone(stow, id) {
    if (!id) return null;
    if (stow.hip === id) return "hip";
    if (stow.back === id) return "back";
    if (stow.back2 === id) return "back2";
    return null;
  }

  function endTransfer() {
    if (!transfer) return;
    if (transfer.prop && transfer.prop.parent) transfer.prop.parent.remove(transfer.prop);
    if (transfer.source && transfer.source.parent) transfer.source.parent.remove(transfer.source);
    transfer = null;
  }

  function beginTransfer(rec, ch, stow, mp) {
    if (!rec || !rec.from || !ch || !mp || (CBZ.fps && CBZ.fps.active)) return;
    const zone = transferZone(stow, rec.from);
    const target = zone && mp[zone];
    const source = mounts.hand.prop;
    if (!target || !source || mounts.hand.id !== rec.from || !source.parent) return;
    endTransfer();

    // Clone the exact visible hand model, including this weapon's dimensions
    // and materials. It lives under the common world root while every frame
    // recomputes BOTH moving endpoints: animated wrist and live body mount.
    // That is what keeps the weapon in the hand while the hand reaches.
    source.parent.updateWorldMatrix(true, true);
    target.updateWorldMatrix(true, true);
    const moving = source.clone(true);
    source.parent.add(moving);
    moving.position.copy(source.position);
    moving.quaternion.copy(source.quaternion);
    moving.scale.copy(source.scale);
    // Track the hand with a geometry-free anchor. A gun-to-gun switch replaces
    // the old visible hand prop later in this same frame; retaining that prop
    // as the endpoint made the outgoing transfer die on the next update.
    const sourceAnchor = new THREE.Group();
    sourceAnchor.name = "weapon-stow-hand-anchor";
    source.parent.add(sourceAnchor);
    sourceAnchor.position.copy(source.position);
    sourceAnchor.quaternion.copy(source.quaternion);
    sourceAnchor.scale.copy(source.scale);
    (CBZ.prisonRoot || CBZ.scene).attach(moving);
    moving.visible = true;
    moving.traverse((o) => { if (o.isMesh) o.castShadow = false; });

    const meta = CBZ.weaponById && CBZ.weaponById(rec.from);
    const heavy = meta && meta.hold ? Math.max(0, Math.min(1, meta.hold.heavy || 0)) : 0;
    const dur = (zone === "hip" ? 0.56 : 0.74) + heavy * (zone === "hip" ? 0.08 : 0.16);
    transfer = {
      seq: rec.seq,
      id: rec.from,
      to: rec.to || null,
      zone,
      prop: moving,
      source: sourceAnchor,
      target,
      t: 0,
      dur,
      progress: 0,
    };
    if (CBZ.charReach) {
      CBZ.charReach(ch, {
        arm: "r", dur, amt: 1,
        kind: zone === "hip" ? "holster-hip" : "holster-back",
        high: zone === "hip" ? 0.12 : 0.92,
        side: zone === "hip" ? 1 : -1,
        target,
      });
    }
  }

  function updateTransfer(dt) {
    if (!transfer || !transfer.prop || !transfer.prop.parent) { transfer = null; return; }
    transfer.t = Math.min(transfer.dur, transfer.t + Math.max(0, dt || 0));
    const p = transfer.t / transfer.dur;
    // Keep the gun physically welded to the animated grip through the reach.
    // At the reach dwell (62%) the hand begins handing it into the mount; only
    // that short final leg blends from the live wrist to the live back/hip
    // socket. Interpolating for the full duration made the gun visibly leave
    // the hand while the arm was still moving, especially on the short hip arc.
    const handoff = Math.max(0, Math.min(1, (p - 0.62) / 0.38));
    const e = handoff * handoff * (3 - 2 * handoff);
    transfer.progress = p;
    const source = transfer.source, target = transfer.target, parent = transfer.prop.parent;
    if (!source || !source.parent || !target || !target.parent || !parent) { endTransfer(); return; }
    source.updateWorldMatrix(true, false);
    target.updateWorldMatrix(true, false);
    parent.updateWorldMatrix(true, false);
    source.matrixWorld.decompose(TRANSFER_POS_A, TRANSFER_Q_A, TRANSFER_SCALE_A);
    target.matrixWorld.decompose(TRANSFER_POS_B, TRANSFER_Q_B, TRANSFER_SCALE_B);
    // land the travelling gun at the exact scale the destination mount will
    // show it at (real-dimension scale, or the legacy 0.92 stow fallback)
    TRANSFER_SCALE_B.multiplyScalar((CBZ.weaponHeldScale && CBZ.weaponHeldScale(transfer.id)) || 0.92);
    TRANSFER_POS.lerpVectors(TRANSFER_POS_A, TRANSFER_POS_B, e);
    TRANSFER_Q.slerpQuaternions(TRANSFER_Q_A, TRANSFER_Q_B, e);
    TRANSFER_SCALE.lerpVectors(TRANSFER_SCALE_A, TRANSFER_SCALE_B, e);
    TRANSFER_WORLD.compose(TRANSFER_POS, TRANSFER_Q, TRANSFER_SCALE);
    TRANSFER_INV.copy(parent.matrixWorld).invert();
    TRANSFER_LOCAL.multiplyMatrices(TRANSFER_INV, TRANSFER_WORLD);
    TRANSFER_LOCAL.decompose(transfer.prop.position, transfer.prop.quaternion, transfer.prop.scale);
    if (p >= 1) endTransfer();
  }

  CBZ.weaponTransferState = function () {
    if (!transfer) return { active: false };
    let handGunGap = null, handMountGap = null, gunMountGap = null;
    if (transfer.source && transfer.source.parent && transfer.prop && transfer.prop.parent && transfer.target && transfer.target.parent) {
      transfer.source.getWorldPosition(TRANSFER_STATE_A);
      transfer.prop.getWorldPosition(TRANSFER_STATE_B);
      transfer.target.getWorldPosition(TRANSFER_STATE_C);
      handGunGap = TRANSFER_STATE_A.distanceTo(TRANSFER_STATE_B);
      handMountGap = TRANSFER_STATE_A.distanceTo(TRANSFER_STATE_C);
      gunMountGap = TRANSFER_STATE_B.distanceTo(TRANSFER_STATE_C);
    }
    return {
      active: true,
      id: transfer.id,
      to: transfer.to,
      zone: transfer.zone === "back2" ? "back" : transfer.zone,
      progress: transfer.progress,
      duration: transfer.dur,
      handGunGap,
      handMountGap,
      gunMountGap,
    };
  };

  if (CBZ.onUpdate) CBZ.onUpdate(37, function (dt) {
    const ch = CBZ.playerChar;
    if (!ch || !ch.body) return;
    const g = CBZ.game;
    // survival/battle-royale keeps its own loadout drama; jail + city show steel.
    const show = g && (g.mode === "city" || g.mode === "escape") && !(CBZ.player && CBZ.player.dead);
    if (!show) {
      endTransfer();
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
    const rec = CBZ.weaponTransition;
    if (mp && rec && rec.seq !== lastTransitionSeq) {
      lastTransitionSeq = rec.seq;
      beginTransfer(rec, ch, stow, mp);
    }
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
    updateTransfer(dt);
    // The destination copy yields to the moving copy until contact. There is
    // one gun travelling, never a static gun already on the back underneath it.
    if (transfer && mounts[transfer.zone] && mounts[transfer.zone].prop) {
      mounts[transfer.zone].prop.visible = false;
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
  const _hgBodyQ = new THREE.Quaternion();
  // low-ready barrel directions in BODY space (+Z = facing, +X = right):
  // muzzle down-forward and OUT to the RIGHT so the barrel hangs past the right
  // thigh/knee (the gun-hand now rides beside the right hip — character.js
  // long-gun carry). The stock swings up-back-left toward the shoulder. Both
  // ends break the torso silhouette from the rear chase cam (round-2 fix: the
  // old across-the-body -X vector kept the whole rifle inside the torso box).
  const LOWREADY_LONG = new THREE.Vector3(0.34, -0.82, 0.36).normalize();
  const LOWREADY_PISTOL = new THREE.Vector3(0.20, -0.90, 0.38).normalize();  // hangs down the lowered arm beside the thigh, slight forward cant
  /* ---- A BARREL MAY NOT POINT INTO THE GROUND ------------------------------
     OWNER: "when player is laying down and crouched make gun look right
     especially in third person — rn gun can go under ground."
     TWO faults, and the first one is why prone is the worst case:
     (a) the low-ready vectors above are authored in BODY space against an
         UPRIGHT torso, and prone PITCHES that frame by 1.42 rad. Worked
         through: (0.34, -0.82, 0.36) leaves the pitched body pointing
         (0.34, -0.48, -0.76) — 28° below horizontal and BACKWARD, out of a
         hand that prone has put ~0.1 m off the deck. The rifle is under the
         terrain before its own length is even considered. So a pitched torso
         no longer aims the gun: past PITCH_FREE we take the body's YAW only
         and present the rifle down-range, which is what a prone shooter does.
     (b) even upright, "muzzle down" plus a slope, a kerb or a crouch can put
         the tip below the floor. That is one inequality, not a stance table:
         with the muzzle at hand + dir·len, staying clear means
             dir.y >= (floorY + MUZZLE_CLEAR - handY) / len
         so the direction is rotated UP to exactly that grazing angle, keeping
         its azimuth. No pose is tested, and it covers every stance, every gun
         length and every piece of ground the player can stand on. */
  const PRONE_READY = new THREE.Vector3(0.16, 0.06, 0.99).normalize();  // down-range, a touch up and right
  const PITCH_FREE = 0.8;      // rad of torso pitch past which the body stops aiming the gun
  const MUZZLE_CLEAR = 0.05;   // m of air under the muzzle at the grazing angle
  const _hgUpAxis = new THREE.Vector3(0, 1, 0);
  /* ---- A GUN BEING RELOADED IS NOT A GUN BEING AIMED ---------------------
     systems/gunhands.js owns the reload clock (it reads fpsmode's own
     fps.reloading, so there is one timer, not two) and publishes the envelope
     here. Two things happen to the weapon while that envelope is up:
       · it comes off the crosshair to a WORK position — muzzle forward and a
         little down, in body space — because a magazine change happens in
         front of your chest, not down the sights. This is also what makes a
         reload read when the player never raised the sights at all;
       · it ROLLS about its own barrel toward the body, presenting the magwell
         to the hand that is coming for it. From the chase camera that roll is
         most of the animation; the arm is the other half.
     Absent the module, gunReloadPose is undefined and every line below is
     skipped — the gun poses exactly as it always has. */
  const RELOAD_WORK = new THREE.Vector3(0.12, -0.30, 0.95).normalize();
  const _rlDir = new THREE.Vector3();
  function reloadPose() {
    if (!CBZ.gunReloadPose || CBZ.CONFIG.CHAR_RELOAD_ANIM === false) return null;
    const r = CBZ.gunReloadPose();
    return r && r.active && r.weight > 0.001 ? r : null;
  }
  // blend the aim/low-ready direction toward the work position
  function reloadAimBlend(rl, ch, dir) {
    if (!rl || !ch || !ch.body) return;
    ch.body.getWorldQuaternion(_hgBodyQ);
    _rlDir.copy(RELOAD_WORK).applyQuaternion(_hgBodyQ);
    dir.lerp(_rlDir, rl.weight).normalize();
  }

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
      CBZ.player && !CBZ.player.dead && !CBZ.player.driving && !CBZ.player._swim &&
      CBZ.playerArmed && CBZ.playerArmed();
    // heldId: currentWeaponId is the canonical drawn id, but fpsmode's
    // normalizeWeapon() can leave it null while fps.weapon still points at a
    // real owned weapon (stale legacy-"Gun" fallback path) — fall back to the
    // fps slot id, gated on actually OWNING weapons so a ghost "Gun" item
    // never conjures a prop the character canonically doesn't have.
    let heldId = show ? (CBZ.currentWeaponId || null) : null;
    if (!heldId && show && CBZ.weaponInventory && CBZ.weaponInventory.length &&
        CBZ.fps && CBZ.FPS_WEAPONS && CBZ.FPS_WEAPONS[CBZ.fps.weapon]) {
      const fid = CBZ.FPS_WEAPONS[CBZ.fps.weapon].id;
      if (CBZ.weaponInventory.indexOf(fid) >= 0) heldId = fid;
    }
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
        // REAL-DIMENSION SIZING (weapons/weapon-scale.js): derived from the
        // researched real gun length. The class READ factors were calibrated
        // against THIS display's screenshot-tuned 1.25/1.15 pair, so the
        // player's rifles keep their approved size within a few percent —
        // what changes is that every OTHER display of the same gun (NPC
        // hands, mounts, racks, drops) now lands on the same world length.
        hand.prop.scale.setScalar(
          (CBZ.weaponHeldScale && CBZ.weaponHeldScale(heldId)) || (hand.long ? 1.25 : 1.15)
        );
        // THE GUN'S OWN REACH, measured once per drawn weapon — the muzzle
        // clearance below needs a length, and a per-weapon table of lengths
        // would be wrong the day somebody adds a gun. Box3 on an unparented
        // prop is its local box WITH the scale just set; the socket chain adds
        // the rig's metre conversion, so multiply it in. The sniper (the game's
        // longest barrel) is therefore the worst case and is solved by the same
        // line as the pistol.
        hand.len = 0;
        if (THREE.Box3) {
          const bb = new THREE.Box3().setFromObject(hand.prop);
          if (isFinite(bb.min.x) && isFinite(bb.max.x)) {
            const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
            hand.len = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * hs;
          }
        }
      }
    }
    if (!hand.prop) return;
    if (hand.prop.parent !== socket) socket.add(hand.prop);
    // During a gun-to-gun swap the outgoing piece reaches its mount before the
    // incoming piece appears. Gameplay selection is already live, but visually
    // this prevents two guns occupying the same hand halfway through a stow.
    const drawingBlocked = !!(transfer && transfer.to && transfer.t < transfer.dur * 0.62);
    hand.prop.visible = !drawingBlocked;
    hand.prop.position.set(0.02, 0.02, 0.03);
    aimHandProp();
  });

  /* ---- ORIENT THE DRAWN GUN, callable more than once a frame -------------
     Extracted so systems/gunhands.js can re-run it AFTER it has moved the
     arms. It has to: the weapon's world orientation is written as a LOCAL
     quaternion relative to the wrist socket, and the aim ray is
     parallax-corrected from the gun's own POSITION — so a pass that shoulders
     the rifle (pulling the firing hand back until the off hand can reach the
     handguard) invalidates both inputs. Re-running is cheap and is the only
     thing that keeps the barrel on the crosshair afterwards. */
  function aimHandProp() {
    const hand = mounts.hand;
    const ch = CBZ.playerChar;
    if (!hand.prop || !hand.prop.parent || !ch || !ch.body) return;
    const socket = hand.prop.parent;
    const rl = reloadPose();
    const presenting = (CBZ.tpPresenting && CBZ.tpPresenting()) || !!rl;
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
      reloadAimBlend(rl, ch, _hgDir);   // …unless it is being reloaded
      // Physics wins over a point-blank aim ray: when crouched/prone beside a
      // slope, the crosshair may be below the muzzle's physically possible
      // line. Keep the bullet ray authoritative, but do not render half the gun
      // inside the ground. The shared solver samples hand→muzzle, not just the
      // floor under the hand.
      if ((!CBZ.CONFIG || CBZ.CONFIG.TP_GUN_GROUND_CLEAR !== false) &&
          hand.len > 0 && CBZ.weaponPhysics && CBZ.weaponPhysics.clearDirection) {
        CBZ.weaponPhysics.clearDirection(_hgPos, _hgDir, hand.len, MUZZLE_CLEAR);
      }
      _hgMat.lookAt(_hgZero, _hgDir, _hgUp);       // -Z along the aim dir = barrel on target
      _hgWorldQ.setFromRotationMatrix(_hgMat);
      socket.getWorldQuaternion(_hgParentQ);
      hand.prop.quaternion.copy(_hgParentQ.invert()).multiply(_hgWorldQ);
      if (rl) {
        // roll the magwell toward the hand coming for it, and drop the muzzle
        hand.prop.rotateZ(rl.cant);
        hand.prop.rotateX(rl.dip);
      }
    } else {
      // LOW-READY (screenshot-diagnosed): the old socket-local pose pointed
      // the barrel straight down the lowered forearm — dead away from the
      // chase camera and buried inside the arm boxes, so from behind the gun
      // rendered as NOTHING (the owner's "can't see it in hand"). Orient in
      // WORLD space off the BODY's facing instead, like the barrel-lock:
      //   · long guns lie ACROSS the body (muzzle down-left past the hip —
      //     the Fortnite two-hand low carry; a 1.9u rifle breaks the body
      //     silhouette on both sides from any angle);
      //   · pistols hang muzzle-down BESIDE the right thigh, nudged outward
      //     so the flank shows at the silhouette edge from behind.
      // (a) a PITCHED torso does not aim the gun — see the note by PRONE_READY
      const groundClear = !CBZ.CONFIG || CBZ.CONFIG.TP_GUN_GROUND_CLEAR !== false;
      const pitched = groundClear && Math.abs(ch.body.rotation.x || 0) > PITCH_FREE;
      if (pitched) {
        _hgDir.copy(PRONE_READY).applyAxisAngle(_hgUpAxis, (ch.group && ch.group.rotation.y) || 0);
      } else {
        ch.body.getWorldQuaternion(_hgBodyQ);
        _hgDir.copy(hand.long ? LOWREADY_LONG : LOWREADY_PISTOL).applyQuaternion(_hgBodyQ);
      }
      // (b) the muzzle stays above the floor, whatever the stance or the slope
      if (groundClear && hand.len > 0 && CBZ.weaponPhysics && CBZ.weaponPhysics.clearDirection) {
        hand.prop.getWorldPosition(_hgPos);
        CBZ.weaponPhysics.clearDirection(_hgPos, _hgDir, hand.len, MUZZLE_CLEAR);
      } else if (groundClear && hand.len > 0 && CBZ.floorAt) {
        // Degrade path for a partial load without actorweapons.js's shared
        // physics owner. It keeps the old under-hand sample; the normal path
        // above additionally samples the muzzle and every point between.
        hand.prop.getWorldPosition(_hgPos);
        const yMin = (CBZ.floorAt(_hgPos.x, _hgPos.z) + MUZZLE_CLEAR - _hgPos.y) / hand.len;
        if (_hgDir.y < yMin) {
          const yT = yMin > 0.95 ? 0.95 : yMin;               // never past straight up
          const h = Math.sqrt(_hgDir.x * _hgDir.x + _hgDir.z * _hgDir.z) || 1e-4;
          const k = Math.sqrt(Math.max(0, 1 - yT * yT)) / h;  // keep the azimuth, lift the pitch
          _hgDir.set(_hgDir.x * k, yT, _hgDir.z * k);
        }
      }
      _hgMat.lookAt(_hgZero, _hgDir, _hgUp);
      _hgWorldQ.setFromRotationMatrix(_hgMat);
      socket.getWorldQuaternion(_hgParentQ);
      hand.prop.quaternion.copy(_hgParentQ.invert()).multiply(_hgWorldQ);
    }
  }
  CBZ.tpHandWeaponRelock = aimHandProp;

  /* THE DRAWN GUN, for anything that has to reason about where it physically
     ended up this frame rather than where the pose meant to put it. This
     module is the one owner of that prop and of its final world orientation,
     so it is the one place that can answer honestly. Null unless a weapon is
     actually visible in the third-person hand.
     Consumer: systems/gunhands.js (support-hand IK + the reload animation). */
  CBZ.tpHandWeapon = function () {
    return mounts.hand.prop && mounts.hand.prop.visible && mounts.hand.prop.parent
      ? mounts.hand.prop : null;
  };
})();
