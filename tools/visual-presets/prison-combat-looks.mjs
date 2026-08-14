/* Prison Escape combat/torch appearance proof for tools/visual-compare.mjs.

   The owner asked for the visible states, not a builder gallery: the real
   escape mode boots, rAF freezes, and the live player/guard rigs are staged in
   the north yard. The shot list covers the torch in the officer's hand, the
   beam while he searches, the player's actual third-person discharge, a
   living torch carrier on the impact frame of a real body hit, flashlight and
   gun corpse contact, close walk-over collection with no prompt, and the real
   stash slot. */

const subjects = [
  {
    id: "flashlight-in-hand",
    label: "Guard torch · in the hand",
    focus: "Close hand-level inspection. The torch must read as a real cylindrical duty flashlight with the fingers around its grip, not a block pistol, hammer, or object intersecting the wrist.",
    state: "torch-detail",
    daylight: true,
    cam: { x: 2.45, y: 1.72, z: 28.15, ax: -0.12, ay: 1.18, az: 25.45, fov: 39 },
  },
  {
    id: "flashlight-search",
    label: "Guard torch · searching",
    focus: "Full-body search silhouette at lights-out. Arm, wrist, torch, lens, cone and pool must agree on one forward direction; the beam may not leave the side of a dangling hand.",
    state: "torch-search",
    daylight: false,
    cam: { x: 5.30, y: 2.45, z: 31.30, ax: 0, ay: 1.12, az: 25.50, fov: 48 },
  },
  {
    id: "player-firing",
    label: "Prisoner · firing in third person",
    focus: "The real shoulder-fire impact frame. Both hands must support the weapon, the stock/slide must clear the body, and flash/tracer must leave the authored muzzle rather than the face or chest.",
    state: "player-fire",
    daylight: true,
    cam: { x: -4.25, y: 2.12, z: 36.05, ax: 0, ay: 1.27, az: 33.48, fov: 40 },
  },
  {
    id: "prison-loadout",
    label: "Prison loadout · fixed fists + 2–0",
    focus: "The real stash opened with the I key. Slot 1 must be a permanent FIST cell, gun assignments must occupy fixed keys 2 through 0, and the screen must explain that two taps or a drag swaps them.",
    state: "loadout-inventory",
    daylight: true,
    cam: { x: 5.30, y: 2.45, z: 31.30, ax: 0, ay: 1.12, az: 25.50, fov: 48 },
  },
  {
    id: "player-lmg-hold",
    label: "Player · weight-specific LMG hold",
    focus: "A live third-person M249 present pose. The firing hand must own the grip, the support hand must travel forward under the heavy receiver, and the gun may not float between two generic rifle arms.",
    state: "player-lmg-hold",
    daylight: true,
    cam: { x: 3.85, y: 1.92, z: 29.55, ax: 0, ay: 1.24, az: 34.05, fov: 36 },
  },
  {
    id: "ai-ak-hold",
    label: "AI · two-hand AK handling",
    focus: "The prison guard uses the shared actor weapon model and handling profile. His right hand must control the grip while the left supports the handguard; the AK must point downrange instead of dangling from one arm.",
    state: "ai-ak-hold",
    daylight: true,
    cam: { x: 3.75, y: 1.86, z: 30.45, ax: 0, ay: 1.22, az: 25.55, fov: 38 },
  },
  {
    id: "back-holster-mid",
    label: "Player · rifle to back",
    focus: "Mid-action, not the endpoint: the right arm must reach behind while the actual AK travels continuously from the hand toward the live back sling. It must not already be teleported flat onto the back.",
    state: "back-holster-mid",
    daylight: true,
    cam: { x: -2.85, y: 1.92, z: 38.20, ax: 0, ay: 1.18, az: 34.00, fov: 34 },
  },
  {
    id: "hip-holster-mid",
    label: "Player · pistol to hip",
    focus: "Mid-action, not the endpoint: the right hand and sidearm must travel together toward the real right-hip mount. The pistol may not pop into the holster while the arm remains at idle.",
    state: "hip-holster-mid",
    daylight: true,
    cam: { x: -3.10, y: 1.62, z: 36.35, ax: 0, ay: 1.04, az: 34.00, fov: 34 },
  },
  {
    id: "first-person-holster",
    label: "First person · restrained stow read",
    focus: "The first-person version should show only the close part of the same action: the gun dipping below/right before the fist rises, without trying to expose a third-person back or hip journey through the camera.",
    state: "first-person-holster",
    daylight: true,
    cam: { x: 0, y: 1.65, z: 34, ax: 0, ay: 1.65, az: 28, fov: 70 },
  },
  {
    id: "barrel-detail",
    label: "AK + LMG · real muzzle crowns",
    focus: "Canonical AK-47 and M249 actor models viewed from the dangerous end. Muzzle devices and barrels must be dark gunmetal with visibly recessed near-black bores, never flat grey plugs.",
    state: "barrel-detail",
    daylight: true,
    cam: { x: 0, y: 1.22, z: 21.55, ax: 0, ay: 1.17, az: 25.20, fov: 31 },
  },
  {
    id: "guard-shot",
    label: "Torch carrier · being shot",
    focus: "The instant a living guard absorbs a round. The body should recoil away from the hit with head, shoulders, knees and free arm participating; the wound belongs on the body and the torch stays gripped instead of intersecting the chest.",
    state: "guard-hit",
    daylight: true,
    cam: { x: 5.10, y: 2.18, z: 31.15, ax: 0, ay: 1.12, az: 25.45, fov: 46 },
  },
  {
    id: "flashlight-death-drop",
    label: "Guard torch · death drop",
    focus: "A killed torch carrier and what his real loadout leaves on the floor. The rigid flashlight must stay outside the corpse's actual posed body parts while remaining naturally close to the man who dropped it.",
    state: "guard-death-drop",
    daylight: true,
    cam: { x: 3.55, y: 1.05, z: 30.05, ax: 0, ay: 0.35, az: 25.45, fov: 43 },
  },
  {
    id: "gun-death-drop",
    label: "Guard gun · death drop",
    focus: "The firearm from a dead guard's real loadout under the same shared rigid-drop law. The gun must settle clear of the articulated corpse rather than entering the torso, arm or leg meshes.",
    state: "guard-gun-drop",
    daylight: true,
    cam: { x: 3.55, y: 1.05, z: 30.05, ax: 0, ay: 0.35, az: 25.45, fov: 40 },
  },
  {
    id: "walkover-pickup",
    label: "Floor loot · walk-over pickup",
    focus: "The player has stepped directly over a settled Guard Torch. It should enter inventory automatically and leave no keyboard hint or touch pickup button on screen.",
    state: "drop-walkover",
    daylight: true,
    cam: { x: 4.35, y: 2.05, z: 29.85, ax: 0.35, ay: 0.78, az: 25.35, fov: 44 },
  },
  {
    id: "flashlight-inventory",
    label: "Guard torch · inventory model",
    focus: "The actual Prison Escape stash after acquiring a Guard Torch. Its slot must contain a miniature render of the same flashlight model used in-hand and on the floor, matching the existing gun-thumbnail treatment rather than a generic dot or symbolic glyph.",
    state: "torch-inventory",
    daylight: true,
    cam: { x: 5.30, y: 2.45, z: 31.30, ax: 0, ay: 1.12, az: 25.50, fov: 48 },
  },
];

async function stagePrisonCombatLooks(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const groundAt = (x, z) => {
    try {
      const y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
      return Number.isFinite(y) ? y : 0;
    } catch (_) { return 0; }
  };
  const dropCorpseOverlaps = (inst, actor) => {
    if (!inst || !inst.mesh || !inst.mesh.parent || !actor || !actor.char || !actor.char.skinSlots) return 0;
    inst.mesh.updateWorldMatrix(true, true);
    actor.group.updateWorldMatrix(true, true);
    const db = new T.Box3().setFromObject(inst.mesh);
    const cb = new T.Box3();
    const seen = new Set();
    const keys = ["torso", "collar", "pelvis", "legs", "legsLower", "shoes", "arms", "armsLower", "hands", "head"];
    let n = 0;
    for (const key of keys) for (const part of actor.char.skinSlots[key] || []) {
      if (!part || !part.isMesh || !part.parent || !part.visible || seen.has(part)) continue;
      seen.add(part);
      cb.setFromObject(part);
      const ox = Math.min(db.max.x, cb.max.x) - Math.max(db.min.x, cb.min.x);
      const oy = Math.min(db.max.y, cb.max.y) - Math.max(db.min.y, cb.min.y);
      const oz = Math.min(db.max.z, cb.max.z) - Math.max(db.min.z, cb.min.z);
      if (ox > 0.004 && oy > 0.004 && oz > 0.004) n++;
    }
    return n;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__prisonCombatOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };
  const pressKey = (key) => {
    const ev = new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : "Key" + key.toUpperCase(), bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const pointBoxGap = (point, object) => {
    if (!point || !object || !object.parent) return null;
    object.updateWorldMatrix(true, true);
    const b = new T.Box3().setFromObject(object);
    const near = b.clampPoint(point, new T.Vector3());
    return point.distanceTo(near);
  };

  let S = window.__prisonCombatLooks;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    // startRunPresented hides its boot card two RAFs after the synchronous
    // build. Wait for those frames before freezing RAF for deterministic
    // staging, or a fast capture can preserve the compositor card forever.
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 20000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // Let the prison reveal rail finish. A detached inspection camera staged
    // during the reveal is silently overwritten and photographs a wall/sky.
    for (let i = 0; i < 360; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    }

    const guard = (CBZ.guards || []).find((g) => g && g.char && g.flashlight && g.kind === "guard");
    if (!guard) return { ok: false, err: "no live guard flashlight rig" };
    const overlay = document.createElement("div");
    overlay.id = "__prisonCombatOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    const detailGroup = new T.Group();
    detailGroup.name = "visual-proof-barrel-detail";
    (CBZ.prisonRoot || CBZ.scene).add(detailGroup);
    S = window.__prisonCombatLooks = { guard, overlay, detailGroup };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const guard = S.guard;
  const player = CBZ.player;
  const playerChar = CBZ.playerChar;
  if (!guard || !guard.group || !player || !playerChar) return { ok: false, err: "missing live combat actors" };
  const targetX = 0, targetZ = 25.5, targetY = groundAt(targetX, targetZ);
  const playerX = 0, playerZ = 34, playerY = groundAt(playerX, playerZ);

  // Subjects share a page within each side. Undo the one intentionally open
  // stash and remove prior physical drops before resetting the actors, so one
  // proof frame cannot leak chrome or loot into the next one.
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
  if (CBZ.prisonDropClear) CBZ.prisonDropClear();
  if (S.detailGroup) S.detailGroup.visible = false;
  setHud(true);

  // Every subject starts from the same clean yard tableau. The update step is
  // still the game's real step; we only pin the two actors so a patrol route
  // cannot move the subject between deployed/current captures.
  try { if (CBZ.clearGore) CBZ.clearGore(); } catch (_) {}
  try { if (CBZ.clearWounds) CBZ.clearWounds(); } catch (_) {}
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.dayPhase) CBZ.dayPhase(subject.daylight ? 0.25 : (17 / 24)); // noon or 23:00 (sunrise is phase 0)
  guard.dead = false; guard.ko = 0; guard.asleep = false; guard.bribed = 0;
  guard.hp = 140; guard.alert = 0; guard.hunt = 8; guard.investigate = null;
  guard.flashlightLost = false; guard.flashlightPatrol = true;
  guard.armed = false; guard._holstered = false; guard._gunLowered = false; guard._gunHidden = false;
  if (guard._weaponProp) guard._weaponProp.visible = false;
  guard.pause = 999;
  guard.group.position.set(targetX, targetY, targetZ);
  guard.group.rotation.set(0, 0, 0);
  guard.group.visible = true;
  player.dead = false; player.hp = 100; player.driving = false; player._swim = false;
  player.pos.set(playerX, playerY, playerZ);
  player.vy = 0; player.grounded = true;
  playerChar.group.position.copy(player.pos);
  playerChar.group.rotation.set(0, 0, 0);
  playerChar.group.visible = false;
  for (const g of CBZ.guards || []) if (g && g !== guard && g.group) g.group.visible = false;
  for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;

  const stepPinned = (frames) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      guard.group.position.set(targetX, targetY, targetZ);
      guard.group.rotation.y = 0;
      guard.hunt = 8;
      player.pos.set(playerX, playerY, playerZ);
      player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
      for (const g of CBZ.guards || []) if (g && g !== guard && g.group) g.group.visible = false;
      for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;
    }
  };

  // Let the real schedule, guard animation and torch driver settle. Search is
  // a legitimate always-on torch reason even in the daylight detail frame.
  stepPinned(subject.state === "torch-search" ? 100 : 35);
  guard.flashlightOn = true;
  guard.flashlightReason = subject.state === "torch-search" ? "night" : "search";
  guard.flashlight.group.visible = true;
  guard.flashlight.lensMat.emissive.setHex(0xcff6ff);
  guard.flashlight.lensMat.emissiveIntensity = 1.6;
  if (guard.wedge) guard.wedge.visible = subject.state === "torch-search";
  if (guard._torchCone) guard._torchCone.visible = subject.state === "torch-search";
  if (guard._torchPool) guard._torchPool.visible = subject.state === "torch-search";

  let hitPoint = null;
  let dropInst = null;
  let dropItem = "";
  let stagedWeaponProp = null;
  let stagedBoreCount = 0;
  let transitionSnapshot = null;
  let interactionBeforeI = 0;
  if (subject.state === "player-fire") {
    // Put the player on the real third-person weapon path, settle the authored
    // two-hand pose, then call the same trigger API touch/mouse input calls.
    guard.group.position.set(targetX, targetY, targetZ);
    guard.group.visible = true;
    player.pos.set(playerX, playerY, playerZ);
    playerChar.group.position.copy(player.pos);
    playerChar.group.rotation.y = 0;
    playerChar.group.visible = true;
    if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); else if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    try { if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true }); } catch (_) {}
    try { if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(90); } catch (_) {}
    // A first-ever prison weapon acquisition may arm the optional FP handoff.
    // Campaign Escape is authored in shoulder view, so disarm that handoff and
    // reassert third person AFTER acquisition—not before it.
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(true); } catch (_) {}
    for (let i = 0; i < 18; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
      playerChar.group.position.copy(player.pos);
      if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
      if (CBZ.fpsActive && CBZ.fpsActive() && CBZ.fpsSetActive) CBZ.fpsSetActive(false);
    }
    try { if (CBZ.fpsFire) CBZ.fpsFire(true); } catch (_) {}
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    try { if (CBZ.fpsFire) CBZ.fpsFire(false); } catch (_) {}
    playerChar.group.visible = true;
  } else if (subject.state === "loadout-inventory") {
    // Own several real guns, then use the actual I key. The deployed side has
    // no I-stash/fixed rail and therefore records the pre-change world HUD;
    // local opens the production modal and exposes its real swap surface.
    for (const id of ["sidearm", "shotgun", "ak47", "lmg"]) {
      try { if (CBZ.unlockWeapon) CBZ.unlockWeapon(id, { select: id === "ak47" }); } catch (_) {}
    }
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
    // Exercise the canonical move before showing it: AK goes to key 0 and the
    // displaced occupant swaps back into its old cell.
    try { if (CBZ.assignPrisonWeaponSlot) CBZ.assignPrisonWeaponSlot(8, "ak47"); } catch (_) {}
    // Put a real contextual card in range. This is the collision that used to
    // steal I for the first NPC verb; current input ownership must still open
    // the stash while deployed demonstrates the old behavior.
    for (let i = 0; i < 8; i++) {
      guard.group.position.set(playerX - 1.6, playerY, playerZ - 0.3);
      guard.pause = 999; guard.alert = 0; guard.hunt = 0;
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
    }
    interactionBeforeI = CBZ.interactionMenuOpen && CBZ.interactionMenuOpen() ? 1 : 0;
    pressKey("i");
    await wait(80);
  } else if (subject.state === "player-lmg-hold") {
    try { if (CBZ.unlockWeapon) CBZ.unlockWeapon("lmg", { select: true }); } catch (_) {}
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId("lmg"); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(true); } catch (_) {}
    playerChar.group.visible = true;
    if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    for (let i = 0; i < 44; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
      playerChar.group.position.copy(player.pos); playerChar.group.visible = true;
      if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    }
    stagedWeaponProp = playerChar.sockets && playerChar.sockets.thirdPersonWeapon &&
      Array.from(playerChar.sockets.thirdPersonWeapon.children).find((o) => o.userData && o.userData.weaponId === "lmg");
  } else if (subject.state === "ai-ak-hold") {
    const aiActor = {
      char: guard.char, group: guard.group, pos: guard.group.position,
      armed: true, weapon: "AK-47", dead: false, ko: 0,
      _holstered: false, _gunLowered: false, _gunHidden: false,
    };
    guard.flashlightOn = false;
    guard.flashlight.group.visible = false;
    if (guard.wedge) guard.wedge.visible = false;
    if (guard._torchCone) guard._torchCone.visible = false;
    if (guard._torchPool) guard._torchPool.visible = false;
    const aimTarget = { pos: player.pos };
    for (let i = 0; i < 36; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      guard.group.position.set(targetX, targetY, targetZ); guard.pause = 999;
      aiActor.dead = false; aiActor.ko = 0; aiActor.armed = true; aiActor.weapon = "AK-47";
      aiActor._holstered = false; aiActor._gunLowered = false; aiActor._gunHidden = false;
      try {
        if (CBZ.actorAimAt) CBZ.actorAimAt(aiActor, aimTarget, 1);
        else if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(aiActor);
      } catch (_) {}
      guard.flashlightOn = false;
      if (guard.flashlight) guard.flashlight.group.visible = false;
    }
    stagedWeaponProp = aiActor._weaponProp || null;
    if (stagedWeaponProp) stagedWeaponProp.visible = true;
    if (guard.flashlight) guard.flashlight.group.visible = false;
    guard.group.visible = true;
  } else if (subject.state === "back-holster-mid" || subject.state === "hip-holster-mid") {
    const id = subject.state === "back-holster-mid" ? "ak47" : "deagle";
    try { if (CBZ.unlockWeapon) CBZ.unlockWeapon(id, { select: true }); } catch (_) {}
    // Subjects share one browser page, but this proof is about one outgoing
    // weapon and one destination. Remove acquisitions leaked by earlier proof
    // states so another static sling cannot hide the travelling gun/hand.
    if (Array.isArray(CBZ.weaponInventory)) CBZ.weaponInventory.splice(0, CBZ.weaponInventory.length, id);
    try { if (CBZ.reconcilePrisonWeaponLoadout) CBZ.reconcilePrisonWeaponLoadout(); } catch (_) {}
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(id); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
    playerChar.group.visible = true;
    if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    for (let i = 0; i < 24; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
      playerChar.group.position.copy(player.pos); playerChar.group.visible = true;
      if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    }
    // The production key path is the subject: on deployed this selects its
    // first acquired gun; locally it means fists and begins the visible stow.
    pressKey("1");
    const frames = subject.state === "back-holster-mid" ? 29 : 18;
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
      playerChar.group.position.copy(player.pos); playerChar.group.visible = true;
      if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }
    }
    transitionSnapshot = CBZ.weaponTransferState ? CBZ.weaponTransferState() : { active: false };
  } else if (subject.state === "first-person-holster") {
    try { if (CBZ.unlockWeapon) CBZ.unlockWeapon("ak47", { select: true }); } catch (_) {}
    try { if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId("ak47"); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(true); } catch (_) {}
    for (let i = 0; i < 12; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
    }
    pressKey("1");
    for (let i = 0; i < 10; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true;
    }
    // This subject is only the near-field put-away. A shared page can still
    // have a late blood particle from a prior actor update; clear it after the
    // final step so unrelated combat FX cannot contaminate the matched frame.
    try { if (CBZ.clearGore) CBZ.clearGore(); } catch (_) {}
    try { if (CBZ.clearWounds) CBZ.clearWounds(); } catch (_) {}
  } else if (subject.state === "barrel-detail") {
    const root = S.detailGroup;
    while (root.children.length) root.remove(root.children[root.children.length - 1]);
    root.visible = true;
    guard.group.visible = false;
    const ids = ["ak47", "lmg"];
    for (let i = 0; i < ids.length; i++) {
      if (!CBZ.buildActorWeapon) continue;
      const prop = CBZ.buildActorWeapon(ids[i]);
      prop.position.set(i ? 0.72 : -0.72, 1.18, 25.20);
      prop.rotation.set(0, 0, 0);
      prop.scale.setScalar(1.65);
      prop.traverse((o) => { if (o.userData && o.userData.weaponBore) stagedBoreCount++; });
      root.add(prop);
    }
  } else if (subject.state === "guard-hit") {
    // Real shared body/wound/gore seams, stopped one frame into the live
    // reaction so the capture is the impact—not a timer's guess after it.
    guard.group.updateMatrixWorld(true);
    hitPoint = guard.group.localToWorld(new T.Vector3(-0.08, 1.28, 0.24));
    const dir = new T.Vector3(
      guard.group.position.x - player.pos.x, 0,
      guard.group.position.z - player.pos.z
    ).normalize();
    try { if (CBZ.bodyWound) CBZ.bodyWound(guard, hitPoint, { cal: 1, dir }); } catch (_) {}
    try { if (CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(hitPoint, 0.55, dir); } catch (_) {}
    guard.hp -= 18;
    try { if (CBZ.body && CBZ.body.hit) CBZ.body.hit(guard, { fromX: player.pos.x, fromZ: player.pos.z, dir, force: 5.5 }); } catch (_) {}
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    guard.group.position.set(targetX, targetY, targetZ);
    guard.group.visible = true;
    guard.flashlightOn = true;
    guard.flashlight.group.visible = true;
    if (guard.wedge) guard.wedge.visible = false;
    if (guard._torchCone) guard._torchCone.visible = false;
    if (guard._torchPool) guard._torchPool.visible = false;
  } else if (subject.state === "guard-death-drop" || subject.state === "guard-gun-drop" || subject.state === "drop-walkover") {
    // The kill owns the drop. Fix the loadout so this death produces exactly
    // one requested rigid item, then enter through CBZ.aiKill—the same choke point a
    // lethal prison bullet reaches. A short seeded random window makes the
    // toss and its resting side repeat on deployed/current builds.
    dropItem = subject.state === "guard-gun-drop" ? "Gun" : "Guard Torch";
    if (subject.state === "drop-walkover") {
      CBZ.game.inventory[dropItem] = 0;
      if (CBZ.refreshInventory) CBZ.refreshInventory();
    }
    guard.loadout = { cigs: 0, items: [dropItem] };
    guard.looted = false;
    guard._dropped = null;
    let vr = 0x5a17;
    const priorRandom = Math.random;
    Math.random = function () {
      vr = (Math.imul(vr, 1664525) + 1013904223) >>> 0;
      return vr / 4294967296;
    };
    try {
      if (CBZ.aiKill) CBZ.aiKill(guard, { group: playerChar.group }, { noKnock: true, noDrop: true, quiet: true, cause: "visual proof" });
    } finally {
      Math.random = priorRandom;
    }
    // Make the flashlight frame a deterministic CORPSE-SWEEP contact, not a
    // lucky toss. This is still the real death-created prop and its real shared
    // weapon body; we place that body on the patch of floor the guard's falling
    // torso is about to cross. The deployed floor/wall-only solver leaves it
    // there inside the corpse. The local solver must move the same settled body
    // out as the articulated rig topples through it.
    if (subject.state === "guard-death-drop") {
      const props = CBZ.propInstances || [];
      for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        if (!p || !p.alive || p.typeId !== "prisondrop" || !p.data || p.data.item !== dropItem || !p.data.body) continue;
        const b = p.data.body;
        b.pos.set(targetX - 0.78, targetY + 0.28, targetZ + 0.24);
        b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        b.bounces = 2;
        break;
      }
    }
    for (let i = 0; i < 210; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
      for (const g of CBZ.guards || []) if (g && g !== guard && g.group) g.group.visible = false;
      for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;
    }
    const props = CBZ.propInstances || [];
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (p && p.alive && p.typeId === "prisondrop" && p.data && p.data.item === dropItem) { dropInst = p; break; }
    }
    guard.group.visible = true;
    if (dropInst && dropInst.mesh) dropInst.mesh.visible = true;
    if (subject.state === "drop-walkover" && dropInst) {
      const walkX = dropInst.pos.x + 0.34, walkZ = dropInst.pos.z + 0.16;
      for (let i = 0; i < 30; i++) {
        player.pos.set(walkX, groundAt(walkX, walkZ), walkZ);
        player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.set(0, 0, 0);
        playerChar.group.visible = true;
        CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      }
      player.pos.set(walkX, groundAt(walkX, walkZ), walkZ);
      playerChar.group.position.copy(player.pos);
      playerChar.group.visible = true;
    }
  } else if (subject.state === "torch-inventory") {
    // Grant through the real economy wrapper so the actual slot model re-syncs
    // exactly as it does when the floor pickup is taken. Open the real stash;
    // the screenshot, not a test-only mock, is the acceptance surface.
    if (!CBZ.game.inventory["Guard Torch"] && CBZ.econ && CBZ.econ.addItem) CBZ.econ.addItem("Guard Torch", 1);
    else if (CBZ.refreshInventory) CBZ.refreshInventory();
    if (!CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
    await wait(80);
  }

  // fpsmode legitimately re-shows the third-person body while it owns an
  // armed player. Only the firing subject is about that body; keep the local
  // player and his carried gun out of every detached guard/item inspection.
  const playerBodyState = subject.state === "player-fire" || subject.state === "player-lmg-hold" ||
    subject.state === "back-holster-mid" || subject.state === "hip-holster-mid" ||
    subject.state === "drop-walkover";
  playerChar.group.visible = playerBodyState;

  setHud(subject.state === "torch-inventory" || subject.state === "loadout-inventory" ||
    subject.state === "drop-walkover");
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 50;
  camera.near = 0.15;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em";
  const stateLabels = {
    "guard-hit": "IMPACT FRAME",
    "player-fire": "DISCHARGE FRAME",
    "loadout-inventory": "REAL I-KEY STASH + FIXED NUMBER RAIL",
    "player-lmg-hold": "LIVE PLAYER RIG · WEIGHT-SPECIFIC SUPPORT",
    "ai-ak-hold": "LIVE AI RIG · TWO-HAND SUPPORT",
    "back-holster-mid": "MID-STOW · HAND TO BACK MOUNT",
    "hip-holster-mid": "MID-STOW · HAND TO HIP MOUNT",
    "first-person-holster": "MID-STOW · RESTRAINED FIRST-PERSON READ",
    "barrel-detail": "CANONICAL ACTOR MODELS · MUZZLE END",
    "guard-death-drop": "REAL DEATH + CORPSE CONTACT",
    "guard-gun-drop": "REAL DEATH + CORPSE CONTACT",
    "drop-walkover": "PLAYER CROSSED THE SETTLED ITEM",
    "torch-inventory": "REAL STASH SLOT",
  };
  q("state").textContent = stateLabels[subject.state] || "REAL GUARD TORCH RIG";
  q("state").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.08em";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  guard.group.updateMatrixWorld(true);
  playerChar.group.updateMatrixWorld(true);
  const hand = guard.char.sockets && guard.char.sockets.rightHand;
  const handPos = hand ? hand.getWorldPosition(new T.Vector3()) : new T.Vector3();
  const playerLeftHand = playerChar.sockets && playerChar.sockets.leftHand;
  const playerRightHand = playerChar.sockets && playerChar.sockets.rightHand;
  const playerLeftPos = playerLeftHand ? playerLeftHand.getWorldPosition(new T.Vector3()) : null;
  const playerRightPos = playerRightHand ? playerRightHand.getWorldPosition(new T.Vector3()) : null;
  const torchPos = guard.flashlight.group.getWorldPosition(new T.Vector3());
  const torchDir = new T.Vector3(0, 0, 1).applyQuaternion(guard.flashlight.group.getWorldQuaternion(new T.Quaternion())).normalize();
  const guardDir = new T.Vector3(0, 0, 1).applyQuaternion(guard.group.getWorldQuaternion(new T.Quaternion())).normalize();
  const torchAngle = Math.acos(Math.max(-1, Math.min(1, torchDir.dot(guardDir)))) * 180 / Math.PI;
  const guardLeftHand = guard.char.sockets && guard.char.sockets.leftHand;
  const guardRightHand = guard.char.sockets && guard.char.sockets.rightHand;
  const guardLeftPos = guardLeftHand ? guardLeftHand.getWorldPosition(new T.Vector3()) : null;
  const guardRightPos = guardRightHand ? guardRightHand.getWorldPosition(new T.Vector3()) : null;
  // wounds.js owns the pooled meshes and publishes the per-actor count. The
  // meshes intentionally carry no DOM/test marker, so traversing userData
  // falsely reported zero even when the entry hole and soak were on the rig.
  const woundDecals = guard._woundN || 0;
  const muzzle = CBZ.playerMuzzleWorld ? CBZ.playerMuzzleWorld(new T.Vector3()) : null;
  let dropMeshes = 0;
  if (dropInst && dropInst.mesh) dropInst.mesh.traverse((o) => { if (o.isMesh) dropMeshes++; });
  let torchSlotImages = 0;
  for (const cell of Array.from(document.querySelectorAll(".islot"))) {
    if (cell.textContent && cell.textContent.indexOf("Guard Torch") >= 0 && cell.querySelector("img.islot-img")) torchSlotImages++;
  }

  // Keep the PDF's measurement page about what each picture actually proves.
  // Publishing every live diagnostic on every state buried the death-drop and
  // inventory rows below the printable page even though those values were only
  // meaningful in one frame apiece.
  const metrics = {};
  if (subject.state === "torch-detail") {
    metrics.torchHandGapCm = Number((torchPos.distanceTo(handPos) * 100).toFixed(1));
    metrics.torchForwardErrorDeg = Number(torchAngle.toFixed(1));
  } else if (subject.state === "torch-search") {
    metrics.torchHandGapCm = Number((torchPos.distanceTo(handPos) * 100).toFixed(1));
    metrics.torchForwardErrorDeg = Number(torchAngle.toFixed(1));
  } else if (subject.state === "player-fire") {
    metrics.supportHandGapCm = playerLeftPos && playerRightPos
      ? Number((playerLeftPos.distanceTo(playerRightPos) * 100).toFixed(1)) : null;
    metrics.muzzleHeight = muzzle ? Number(muzzle.y.toFixed(2)) : null;
    metrics.fpsActive = CBZ.fps && CBZ.fps.active ? 1 : 0;
  } else if (subject.state === "loadout-inventory") {
    const cells = Array.from(document.querySelectorAll(".invLoadoutSlots .cSlot"));
    const first = cells.find((c) => c.dataset && c.dataset.key === "1");
    const audit = CBZ.prisonWeaponLoadoutAudit ? CBZ.prisonWeaponLoadoutAudit() : null;
    metrics.inventoryOpenedByI = CBZ.invOpen ? 1 : 0;
    metrics.interactionVisibleBeforeI = interactionBeforeI;
    metrics.fistsSlotFixed = first && !first.dataset.weaponId && first.dataset.prisonSlot === "-1" ? 1 : 0;
    metrics.weaponKeyRailCorrect = cells.map((c) => c.dataset.key || "").join("") === "1234567890" ? 1 : 0;
    metrics.loadoutAssignedUnique = audit ? (audit.assigned === audit.unique ? 1 : 0) : 0;
    metrics.akAssignedToZero = audit && audit.slots && audit.slots[8] === "ak47" ? 1 : 0;
  } else if (subject.state === "player-lmg-hold") {
    const leftGap = pointBoxGap(playerLeftPos, stagedWeaponProp);
    metrics.playerSupportToGunCm = leftGap == null ? null : Number((leftGap * 100).toFixed(1));
    metrics.playerHoldSupport = playerChar.aimSupport == null ? null : Number(playerChar.aimSupport.toFixed(2));
  } else if (subject.state === "ai-ak-hold") {
    const leftGap = pointBoxGap(guardLeftPos, stagedWeaponProp);
    const rightGap = pointBoxGap(guardRightPos, stagedWeaponProp);
    metrics.aiSupportToGunCm = leftGap == null ? null : Number((leftGap * 100).toFixed(1));
    metrics.aiGripToGunCm = rightGap == null ? null : Number((rightGap * 100).toFixed(1));
  } else if (subject.state === "back-holster-mid" || subject.state === "hip-holster-mid") {
    metrics.stowAnimationActive = transitionSnapshot && transitionSnapshot.active ? 1 : 0;
    metrics.stowDestinationCorrect = transitionSnapshot && transitionSnapshot.zone ===
      (subject.state === "back-holster-mid" ? "back" : "hip") ? 1 : 0;
    metrics.stowGripToGunCm = transitionSnapshot && transitionSnapshot.handGunGap != null
      ? Number((transitionSnapshot.handGunGap * 100).toFixed(1)) : null;
    metrics.slotOneLeavesFists = CBZ.game.prisonHolstered ? 1 : 0;
  } else if (subject.state === "first-person-holster") {
    const fpState = CBZ.fpsHolsterVisualState ? CBZ.fpsHolsterVisualState() : null;
    metrics.firstPersonStowActive = fpState && fpState.active ? 1 : 0;
    metrics.firstPersonStowPct = fpState && fpState.active ? Math.round(fpState.progress * 100) : 0;
    metrics.slotOneLeavesFists = CBZ.game.prisonHolstered ? 1 : 0;
  } else if (subject.state === "barrel-detail") {
    metrics.recessedBoreMeshes = stagedBoreCount;
  } else if (subject.state === "guard-hit") {
    metrics.torchHandGapCm = Number((torchPos.distanceTo(handPos) * 100).toFixed(1));
    metrics.woundDecals = woundDecals;
    metrics.hitBodyPitchDeg = Number((Math.abs(guard.char.body.rotation.x) * 180 / Math.PI).toFixed(1));
  } else if (subject.state === "guard-death-drop" || subject.state === "guard-gun-drop") {
    metrics.rigidDropShape = dropInst && dropInst.data &&
      ((dropItem === "Gun" && dropInst.data.shape === "gun") || (dropItem === "Guard Torch" && dropInst.data.shape === "torch")) ? 1 : 0;
    metrics.rigidDropMeshes = dropMeshes;
    metrics.dropCorpsePartOverlaps = dropCorpseOverlaps(dropInst, guard);
  } else if (subject.state === "drop-walkover") {
    const prompt = document.getElementById("prisonDropPrompt");
    metrics.walkoverTaken = dropInst && dropInst.data && dropInst.data.taken ? 1 : 0;
    metrics.walkoverDropRemaining = dropInst && dropInst.alive && dropInst.mesh && dropInst.mesh.parent ? 1 : 0;
    metrics.walkoverInventoryCount = (CBZ.game.inventory && CBZ.game.inventory[dropItem]) || 0;
    metrics.pickupPromptVisible = prompt && getComputedStyle(prompt).display !== "none" && getComputedStyle(prompt).visibility !== "hidden" ? 1 : 0;
  } else if (subject.state === "torch-inventory") {
    metrics.torchSlotModelImages = torchSlotImages;
  }

  CBZ.renderer.render(CBZ.scene, camera);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 50 },
    metrics,
    hitPoint: hitPoint ? { x: Number(hitPoint.x.toFixed(2)), y: Number(hitPoint.y.toFixed(2)), z: Number(hitPoint.z.toFixed(2)) } : null,
  };
}

export default {
  id: "prison-combat-looks",
  title: "Prison Escape: Loadout, Handling, Holstering, and Weapon Contact",
  description: "Matched player-visible states from the real Prison Escape runtime: fixed fists/loadout keys, player and AI weapon handling, live back/hip/first-person stow actions, dark recessed muzzle bores, and existing flashlight/drop contact coverage.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 360000,
  pairNote: "Same escape mode · seed · actor · camera · lighting · action state",
  method: "The visual runner boots the registered Prison Escape mode on both sources, freezes the game clock, and stages the same live player and guard rigs through real keyboard, inventory, firearm selection, aim, stow, actor-weapon, wound, death-drop, economy, and pickup APIs. Each deployed camera is carried into the matched local capture.",
  metricsNote: "Live measurements support the pixels: fixed number ownership, I-key modal state, loadout uniqueness, player/AI hand-to-gun contact, handling profile values, active stow destination/progress, first-person stow state, recessed bore geometry, plus the existing combat/drop invariants.",
  metrics: {
    torchHandGapCm: { label: "Torch origin to hand", unit: "cm", better: "lower" },
    torchForwardErrorDeg: { label: "Torch/guard forward error", unit: "deg", better: "lower" },
    supportHandGapCm: { label: "Firing support-hand gap", unit: "cm", better: "lower" },
    woundDecals: { label: "Body wound decals", better: "higher" },
    hitBodyPitchDeg: { label: "Impact torso overfold", unit: "deg", better: "lower" },
    muzzleHeight: { label: "Player muzzle height", unit: "m" },
    rigidDropShape: { label: "Death drop uses rigid item shape", better: "higher" },
    rigidDropMeshes: { label: "Rigid drop model meshes", better: "higher" },
    dropCorpsePartOverlaps: { label: "Drop/corpse part overlaps", better: "lower" },
    walkoverTaken: { label: "Walk-over collected item", better: "higher" },
    walkoverDropRemaining: { label: "Drop remaining after walk-over", better: "lower" },
    walkoverInventoryCount: { label: "Item count after walk-over", better: "higher" },
    pickupPromptVisible: { label: "Pickup prompt visible", better: "lower" },
    torchSlotModelImages: { label: "Torch slots using model render", better: "higher" },
    fpsActive: { label: "First-person camera active", better: "lower" },
    inventoryOpenedByI: { label: "I opened prison stash", better: "higher" },
    interactionVisibleBeforeI: { label: "NPC context visible before I" },
    fistsSlotFixed: { label: "Slot 1 fixed to fists", better: "higher" },
    weaponKeyRailCorrect: { label: "Visible key rail is 1 through 0", better: "higher" },
    loadoutAssignedUnique: { label: "Assigned weapons unique", better: "higher" },
    akAssignedToZero: { label: "AK rearranged to key 0", better: "higher" },
    playerSupportToGunCm: { label: "Player support hand to gun", unit: "cm" },
    playerHoldSupport: { label: "Player support reach profile" },
    aiSupportToGunCm: { label: "AI support hand to gun", unit: "cm" },
    aiGripToGunCm: { label: "AI grip hand to gun", unit: "cm", better: "lower" },
    stowAnimationActive: { label: "Physical stow active", better: "higher" },
    stowDestinationCorrect: { label: "Stow uses requested body mount", better: "higher" },
    stowGripToGunCm: { label: "Stowing grip to moving gun", unit: "cm" },
    slotOneLeavesFists: { label: "Key 1 leaves fists active", better: "higher" },
    firstPersonStowActive: { label: "First-person stow active", better: "higher" },
    firstPersonStowPct: { label: "First-person stow progress", unit: "%" },
    recessedBoreMeshes: { label: "Recessed dark bore meshes", better: "higher" },
  },
  subjects,
  stage: stagePrisonCombatLooks,
};
