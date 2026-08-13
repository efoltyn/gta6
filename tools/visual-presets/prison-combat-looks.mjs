/* Prison Escape combat/torch appearance proof for tools/visual-compare.mjs.

   The owner asked for the visible states, not a builder gallery: the real
   escape mode boots, rAF freezes, and the live player/guard rigs are staged in
   the north yard. The shot list covers the torch in the officer's hand, the
   beam while he searches, the player's actual third-person discharge, a
   living torch carrier on the impact frame of a real body hit, the physical
   thing his real death pipeline leaves behind, and the real stash slot. */

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
    focus: "A killed torch carrier and what his real loadout leaves on the floor. The dropped object must be the same rigid flashlight as the held prop, lying under shared weapon-style physics—not a pouch, box, glow pickup, or substitute.",
    state: "guard-death-drop",
    daylight: true,
    cam: { x: 3.55, y: 1.05, z: 30.05, ax: 0, ay: 0.35, az: 25.45, fov: 43 },
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
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__prisonCombatOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
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
    S = window.__prisonCombatLooks = { guard, overlay };
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
  if (CBZ.invOpen && subject.state !== "torch-inventory" && CBZ.toggleInventory) CBZ.toggleInventory();
  if (CBZ.prisonDropClear) CBZ.prisonDropClear();
  setHud(true);

  // Every subject starts from the same clean yard tableau. The update step is
  // still the game's real step; we only pin the two actors so a patrol route
  // cannot move the subject between deployed/current captures.
  try { if (CBZ.clearGore) CBZ.clearGore(); } catch (_) {}
  try { if (CBZ.clearWounds) CBZ.clearWounds(); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.dayPhase) CBZ.dayPhase(subject.daylight ? 0.25 : (17 / 24)); // noon or 23:00 (sunrise is phase 0)
  guard.dead = false; guard.ko = 0; guard.asleep = false; guard.bribed = 0;
  guard.hp = 140; guard.alert = 0; guard.hunt = 8; guard.investigate = null;
  guard.flashlightLost = false; guard.flashlightPatrol = true;
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
  } else if (subject.state === "guard-death-drop") {
    // The kill owns the drop. Fix the loadout so this death produces exactly
    // one Guard Torch, then enter through CBZ.aiKill—the same choke point a
    // lethal prison bullet reaches. A short seeded random window makes the
    // toss and its resting side repeat on deployed/current builds.
    guard.loadout = { cigs: 0, items: ["Guard Torch"] };
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
    for (let i = 0; i < 210; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      player.pos.set(playerX, playerY, playerZ); player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
      for (const g of CBZ.guards || []) if (g && g !== guard && g.group) g.group.visible = false;
      for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;
    }
    const props = CBZ.propInstances || [];
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (p && p.alive && p.typeId === "prisondrop" && p.data && p.data.item === "Guard Torch") { dropInst = p; break; }
    }
    guard.group.visible = true;
    if (dropInst && dropInst.mesh) dropInst.mesh.visible = true;
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
  playerChar.group.visible = subject.state === "player-fire";

  setHud(subject.state === "torch-inventory");
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
  q("state").textContent = subject.state === "guard-hit" ? "IMPACT FRAME" :
    (subject.state === "player-fire" ? "DISCHARGE FRAME" :
      (subject.state === "guard-death-drop" ? "REAL DEATH + LOADOUT DROP" :
        (subject.state === "torch-inventory" ? "REAL STASH SLOT" : "REAL GUARD TORCH RIG")));
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
  } else if (subject.state === "guard-hit") {
    metrics.torchHandGapCm = Number((torchPos.distanceTo(handPos) * 100).toFixed(1));
    metrics.woundDecals = woundDecals;
    metrics.hitBodyPitchDeg = Number((Math.abs(guard.char.body.rotation.x) * 180 / Math.PI).toFixed(1));
  } else if (subject.state === "guard-death-drop") {
    metrics.droppedTorchShape = dropInst && dropInst.data && dropInst.data.shape === "torch" ? 1 : 0;
    metrics.droppedTorchMeshes = dropMeshes;
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
  title: "Prison Escape: Flashlight and Combat Appearance",
  description: "Six matched player-visible states from the real Prison Escape runtime: the guard flashlight at hand scale, its live search beam, the prisoner's third-person discharge, a living carrier on the shot-impact frame, the flashlight produced by his real death-drop pipeline, and its actual stash slot.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 360000,
  pairNote: "Same escape mode · seed · actor · camera · lighting · action state",
  method: "The visual runner boots the registered Prison Escape mode on both sources, freezes the game clock, and stages the same live player and guard rigs through their real flashlight, firing, wound, gore, body-reaction, death-drop, economy, and inventory APIs. The deployed camera is carried into the local capture.",
  metricsNote: "Live measurements support the pixels: flashlight-to-hand distance, search direction, firing support-hand gap, body-wound presence, impact torso pitch, real muzzle height, death-drop shape/mesh count, and whether the stash drew a model thumbnail.",
  metrics: {
    torchHandGapCm: { label: "Torch origin to hand", unit: "cm", better: "lower" },
    torchForwardErrorDeg: { label: "Torch/guard forward error", unit: "deg", better: "lower" },
    supportHandGapCm: { label: "Firing support-hand gap", unit: "cm", better: "lower" },
    woundDecals: { label: "Body wound decals", better: "higher" },
    hitBodyPitchDeg: { label: "Impact torso overfold", unit: "deg", better: "lower" },
    muzzleHeight: { label: "Player muzzle height", unit: "m" },
    droppedTorchShape: { label: "Death drop uses torch shape", better: "higher" },
    droppedTorchMeshes: { label: "Dropped torch model meshes", better: "higher" },
    torchSlotModelImages: { label: "Torch slots using model render", better: "higher" },
    fpsActive: { label: "First-person camera active", better: "lower" },
  },
  subjects,
  stage: stagePrisonCombatLooks,
};
