/* Prison Escape taser storyboard for tools/visual-compare.mjs.

   The three requested player-visible states are staged through the real Escape
   mode and the real FPS weapon path: the taser resting in the player's hand,
   the exact trigger frame, and the struck guard during the electrical collapse.
   The deployed camera is returned and reused verbatim by the local capture. */

const subjects = [
  {
    id: "held",
    label: "Taser in hand",
    focus: "Normal first-person carry. Match the supplied reference's simple read: one continuous yellow shell, one blunt black cartridge, one open trigger window and one swept grip — no stacked rails, panels, lights or finger-band clutter.",
    state: "held",
  },
  {
    id: "firing",
    label: "Trigger frame",
    focus: "The instant of discharge. It should read as two launched probes and trailing wires with a tight blue-white electrical snap — never a firearm muzzle blast, bullet tracer or ejected brass.",
    state: "firing",
  },
  {
    id: "struck",
    label: "Guard struck by the taser",
    focus: "Close player-world view during incapacitation. Twin contact points, attached wires, electrical arcing and a tense physical collapse should make the non-lethal hit readable without explanatory text.",
    state: "struck",
  },
];

async function stageJailTaser(input) {
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
      if (child.id === "__jailTaserOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__jailTaserSeq;
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
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };
    // Let the prison reveal finish before the first subject. Capturing during
    // that camera rail points the held view into the sky while later subjects
    // happen to look correct only because their reset ticks outlive the intro.
    step(360);

    const target = (CBZ.guards || []).find((a) => a && a.group && a.char && !a.dead) ||
      (CBZ.npcs || []).find((a) => a && a.group && a.char && !a.dead);
    if (!target) return { ok: false, err: "no live prison actor for taser target" };

    const overlay = document.createElement("div");
    overlay.id = "__jailTaserOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-diag></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__jailTaserSeq = { target, overlay, step, px: 0, pz: 34 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const target = S.target;
  const px = S.px, pz = S.pz;
  const py = groundAt(px, pz);
  const tx = px, tz = pz - 8.5;
  const ty = groundAt(tx, tz);

  // Reset the same live guard before every frame so subjects also work alone.
  S.step(70);
  target.dead = false;
  target.ko = 0;
  target.hp = target.maxHp || (target.kind === "guard" ? 140 : 100);
  target.hunt = 0;
  target.alert = 0;
  target.pause = 999;
  target.group.visible = true;
  target.group.position.set(tx, ty, tz);
  target.group.rotation.set(0, 0, 0);
  if (target.pos && target.pos !== target.group.position && target.pos.copy) target.pos.copy(target.group.position);
  if (target.target && target.target.copy) target.target.copy(target.group.position);
  if (target.char) {
    target.char.taserT = 0;
    target.char.koT = 0;
    target.char.koPose = false;
    target.char.koK = 0;
  }

  if (CBZ.player && CBZ.player.pos) {
    CBZ.player.pos.set(px, py, pz);
    CBZ.player.vy = 0;
    CBZ.player.grounded = true;
    CBZ.player.dead = false;
    CBZ.player.stun = 0;
  }
  if (CBZ.playerChar && CBZ.playerChar.group) {
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    CBZ.playerChar.group.rotation.set(0, 0, 0);
  }

  if (!CBZ.unlockWeapon) return { ok: false, err: "no weapon acquisition API" };
  CBZ.unlockWeapon("taser", { select: true });
  if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId("taser");
  if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(20, "taser");
  if (CBZ.fps && CBZ.fps.rounds) CBZ.fps.rounds[CBZ.fps.weapon] = 2;
  if (CBZ.cam) CBZ.cam.yaw = 0;
  if (CBZ.fps) CBZ.fps.fp = -0.045;
  if (CBZ.fpsSetActive) CBZ.fpsSetActive(true);
  S.step(12);
  // A first-ever Escape acquisition and the cinematic handoff can both write
  // the FPS latch during this opening beat. Reassert the real FPS owner after
  // it has laid out the viewmodel, then pin the exact eye/aim used for the shot.
  if (CBZ.fpsSetActive) CBZ.fpsSetActive(true);
  CBZ.camera.position.set(px, py + 1.65, pz);
  CBZ.camera.lookAt(px, py + 1.65 + Math.sin(-0.045), pz - Math.cos(-0.045));
  CBZ.camera.updateMatrixWorld(true);

  // Keep the visual studio clean without changing actor selection or hit logic.
  for (const a of [...(CBZ.guards || []), ...(CBZ.npcs || [])]) {
    if (a && a !== target && a.group) a.group.visible = false;
  }
  target.group.visible = true;

  if (subject.state === "firing" || subject.state === "struck") {
    if (!CBZ.fpsFire) return { ok: false, err: "no real FPS fire control" };
    CBZ.fpsFire(true);
    CBZ.fpsFire(false);
  }

  if (subject.state === "struck") {
    // Nine real sim frames: enough for the body to begin collapsing, still
    // inside a conducted-energy weapon's visible arc/wire beat.
    S.step(9);
    if (CBZ.fpsSetActive) CBZ.fpsSetActive(false);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    CBZ.camera.position.set(tx + 5.3, ty + 2.35, tz + 5.8);
    CBZ.camera.lookAt(tx, ty + 1.0, tz);
  }

  const ref = input.referenceStage && input.referenceStage.camera;
  if (ref && Array.isArray(ref.position) && Array.isArray(ref.quaternion)) {
    CBZ.camera.position.fromArray(ref.position);
    CBZ.camera.quaternion.fromArray(ref.quaternion);
  }
  CBZ.camera.aspect = input.width / input.height;
  CBZ.camera.fov = subject.state === "struck" ? 48 : 65;
  CBZ.camera.near = 0.05;
  CBZ.camera.far = 20000;
  CBZ.camera.updateProjectionMatrix();
  CBZ.camera.updateMatrixWorld(true);
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  setHud(false);

  const currentIndex = CBZ.fpsWeaponIndex ? CBZ.fpsWeaponIndex() : (CBZ.fps ? CBZ.fps.weapon : -1);
  const model = CBZ.fpsWeaponModels && CBZ.fpsWeaponModels[currentIndex];
  let modelParts = 0;
  if (model && model.traverse) model.traverse((o) => { if (o.isMesh) modelParts++; });
  let fxAudit = null;
  try { fxAudit = CBZ.taserFxAudit ? CBZ.taserFxAudit() : null; } catch (_) {}

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em";
  query("diag").textContent = `real Escape mode · YELLOW TASER · model ${modelParts} parts · wires ${fxAudit ? fxAudit.wires : 0} · arcs ${fxAudit ? fxAudit.arcs : 0}`;
  query("diag").style.cssText = "position:absolute;top:105px;left:27px;color:#c0cfda;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  CBZ.renderer.render(CBZ.scene, CBZ.camera);
  return {
    ok: true,
    target: target.data && target.data.name || target.kind || "guard",
    targetKo: Number((target.ko || 0).toFixed(2)),
    camera: {
      position: CBZ.camera.position.toArray(),
      quaternion: CBZ.camera.quaternion.toArray(),
    },
    metrics: {
      modelParts,
      visibleWires: fxAudit ? Number(fxAudit.wires || 0) : 0,
      visibleArcs: fxAudit ? Number(fxAudit.arcs || 0) : 0,
    },
  };
}

export default {
  id: "jail-taser",
  title: "Prison Escape Taser: Held, Fired, Struck",
  description: "Matched player-view evidence from the real Escape weapon path. The same seeded guard, player position, aim, lighting, viewport and deployed camera are used on both sides.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL REPAIR",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  pairNote: "Same Escape mode · seed 90210 · guard · position · aim · camera · lighting",
  method: "Each side boots the registered Prison Escape mode, grants the real X26 through CBZ.unlockWeapon, fires through CBZ.fpsFire, and carries the exact deployed camera into the local capture.",
  metricsNote: "Model-part and live FX counts are read from the actual equipped viewmodel and taser effect pool during each captured state.",
  metrics: {
    modelParts: { label: "Equipped taser model parts", better: "higher" },
    visibleWires: { label: "Visible conducted wires", better: "higher" },
    visibleArcs: { label: "Visible electrical arcs", better: "higher" },
  },
  subjects,
  stage: stageJailTaser,
};
