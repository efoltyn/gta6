/* Disaster Survival storyboard for tools/visual-compare.mjs.

   Boots the REAL survival mode (title screen → Disaster Survival → Play),
   freezes the rAF loop, then FORCES the director through a fixed arc of
   disasters with CBZ.disasters.force(id) and advances time with
   CBZ.stepSim(1/60) bursts — so both builds photograph the exact same
   simulated seconds of the exact same seeded match.

   Subjects are sequenced beats of ONE live run per side. Two kinds:
   - world beats (HUD hidden): does the disaster physically read on the
     island — drawdown, wave, lava, collapse — without a single word?
   - HUD beats (hud: true): the screen as the player sees it. The before
     build narrates disasters through four concurrent text channels
     (#disasterBanner, #survStatus, #hint, #toast); the after build should
     show a clean screen whose WORLD carries the information.

   Every subject measures hudTextChars — the total rendered HUD text the
   player is being asked to read at that moment. Show-don't-tell is that
   number going DOWN while the scene still explains itself.

   Staging facts (same family as nuke-sequence.mjs, verified 2026-08-02):
   - rAF stub after boot kills core/loop.js; CBZ.stepSim is then the only
     clock. CBZ.hitstop/slowmo zeroed before each tick.
   - The survival island lives at CBZ.SURV.arena {cx:0, cz:600, r:120} in
     the shared scene; sky rig (CBZ.skyDome.parent) must be recentered on
     the camera before a manual render.
   - CBZ.disasters.force(id) jumps the shuffled arc to that disaster's
     warn; CBZ.disasters.state() reports idle|warn|active for polling.
   - The player is healed every tick (a WASTED screen would end the
     storyboard); bots are left to die honestly. */

const A = { cx: 0, cz: 600 }; // island centre (CBZ.SURV.arena)

const subjects = [
  { id: "tsunami-warn", label: "Tsunami — the drawdown", hud: false,
    focus: "Warn phase, no words: the sea pulls back and exposes the seabed. After-side bots should be sprinting uphill — the crowd IS the warning.",
    act: { force: "flood", untilState: "warn", extraSecs: 6 },
    cam: { x: 0, y: 18, z: 745, ax: 0, ay: 2, az: 700 } },
  { id: "tsunami-surge", label: "Tsunami — the wave", hud: false,
    focus: "Active phase mid-run. Before: a hand-animated curling ribbon mesh. After: the shared sea itself surging (waterSurgeSet), one water with the crest riding it.",
    act: { untilState: "active", extraSecs: 5 },
    cam: { x: 60, y: 36, z: 640, ax: -90, ay: 8, az: 610 } },
  { id: "tsunami-swim", label: "In the water", hud: true,
    focus: "Player dropped into the flood. Before: hidden DOT drain, stamina-as-air text. After: the real swim system — sink-unless-you-swim, breath meter, a survivable arc.",
    act: { extraSecs: 7, swim: true, thenSecs: 3 },
    cam: { player: true, back: 9, up: 5 } },
  { id: "hud-warn", label: "The screen during a warning", hud: true,
    focus: "Volcano warn as the player sees it. Before: pulsing banner + status line + hint + toast all narrating at once. After: a clean screen — rumble, ash, red glow tell it.",
    act: { force: "volcano", untilState: "warn", extraSecs: 2.5 },
    cam: { player: true, back: 7, up: 3.2 } },
  { id: "volcano-eruption", label: "Volcanic eruption", hud: false,
    focus: "Lava streams and ash over the island. Compare the mountain's read: glow, flow reach, smoke.",
    act: { untilState: "active", extraSecs: 8 },
    cam: { x: 95, y: 42, z: 675, ax: 0, ay: 22, az: 595 } },
  { id: "storm-strike", label: "Lightning storm", hud: false,
    focus: "Rain and strikes. After-side rain should be the engine's weather system (one rain, wet ground), not a private particle cloud.",
    act: { force: "storm", untilState: "active", extraSecs: 4 },
    cam: { x: 0, y: 20, z: 706, ax: 0, ay: 8, az: 618 } },
  { id: "hurricane-wind", label: "Hurricane", hud: false,
    focus: "Wind as a force: debris streaming one way, bots leaning/knocked down, rain driven on the same wind vector — one wind field, not three.",
    act: { force: "hurricane", untilState: "active", extraSecs: 6 },
    cam: { x: 35, y: 7, z: 668, ax: -30, ay: 4, az: 590 } },
  { id: "quake-collapse", label: "Earthquake", hud: false,
    focus: "Buildings coming down. Before: whole groups sink-and-tilt through the ground. After: real structural collapse (CBZ.structure), rubble that stays.",
    act: { force: "quake", untilState: "active", extraSecs: 5 },
    cam: { x: 42, y: 30, z: 662, ax: 0, ay: 6, az: 596 } },
  { id: "sinkhole", label: "Sinkholes", hud: false,
    focus: "Before: flat black discs that insta-kill anyone standing on them. After: holes with depth you actually fall into.",
    act: { force: "sinkhole", untilState: "active", extraSecs: 4 },
    cam: { x: 40, y: 26, z: 655, ax: 0, ay: 0, az: 605 } },
  { id: "nuke-finale", label: "The nuclear finale", hud: false,
    focus: "The closing strike. Blast should price through the shared impact bus; the front should read as light and pressure, not a growing circle.",
    act: { force: "nuke", untilState: "active", extraSecs: 4 },
    cam: { x: 0, y: 60, z: 780, ax: 0, ay: 45, az: 600 } },
];

async function stageDisaster(input) {
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
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__disasterOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };
  // Rendered HUD text the player must read right now. Measured with the HUD
  // restored (innerText skips visibility:hidden nodes), before any hide.
  const hudTextChars = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    let chars = 0;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__disasterOverlay") continue;
      if (getComputedStyle(child).display === "none") continue;
      chars += (child.innerText || "").replace(/\s+/g, "").length;
    }
    return chars;
  };

  let S = window.__disasterSeq;
  if (!S) {
    // ---- one-time: boot the real game into survival free play -----------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") {
      return { ok: false, err: "no CBZ.disasters.force" };
    }
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__disasterOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__disasterSeq = { overlay };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null && !act.swim) CBZ.player.stamina = 100;
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };
  const stepUntilState = (want, budgetSecs) => {
    let guard = Math.round((budgetSecs || 20) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  if (act.force) {
    CBZ.disasters.force(act.force);
    step(0.1);
  }
  if (act.untilState) stepUntilState(act.untilState, 30);
  if (act.extraSecs) step(act.extraSecs);
  if (act.swim) {
    // drop the player INTO the flood over the drowned town: low ground, and
    // start him just under the risen surface so the swim system owns him
    // (island centre is CBZ.SURV.arena; the stage function is serialized
    // into the page, so read it live rather than from module scope)
    const arena = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600 };
    const gx = arena.cx + 20, gz = arena.cz + 70;
    if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
      let surfY = 6;
      try {
        if (CBZ.survSeaHeightAt) surfY = CBZ.survSeaHeightAt(gx, gz);
        else if (CBZ.waterSeaY) surfY = CBZ.waterSeaY() + (CBZ.waterSurge ? CBZ.waterSurge() : 0);
      } catch (_) {}
      CBZ.player.pos.set(gx, Math.max(1, surfY - 0.6), gz);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
    step(act.thenSecs || 3);
  }

  // ---- measure HUD pressure with the HUD as the game left it ------------
  setHud(true);
  void document.documentElement.offsetHeight;
  const hudChars = hudTextChars();

  // ---- frame and render -------------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.5;
  camera.far = 20000;
  const cam = subject.cam || {};
  if (cam.player && CBZ.player && CBZ.player.pos) {
    const p = CBZ.player.pos;
    camera.position.set(p.x, p.y + (cam.up || 3), p.z + (cam.back || 8));
    camera.lookAt(p.x, p.y + 1.2, p.z - 6);
  } else {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
  }
  camera.updateProjectionMatrix();
  // core/sky.js's own seam (rig + palette + sun placement), with the historic
  // y=0 follow as the degrade path for a build that predates it.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:340px";
  query("focus").textContent = `disaster ${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()}`;
  query("focus").style.cssText = "position:absolute;top:244px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms · HUD ${hudChars} chars`
    : `HUD ${hudChars} chars`;
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    hudTextChars: hudChars,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };
  // ratchet exports land as extra metrics when the build carries them
  try {
    if (typeof CBZ.disasterAudit === "function") {
      const audit = CBZ.disasterAudit();
      for (const key of Object.keys(audit || {})) {
        if (Number.isFinite(Number(audit[key]))) metrics[`audit_${key}`] = Number(audit[key]);
      }
    }
  } catch (_) {}

  return {
    ok: true,
    disaster: CBZ.disasters.current(),
    state: CBZ.disasters.state(),
    metrics,
  };
}

export default {
  id: "disaster-sequence",
  title: "Disaster Survival: Show, Don't Tell",
  description: "One seeded survival match per build, the director forced through the same arc of disasters and stepped to the same simulated seconds. World beats ask whether the disaster physically reads without a word of HUD; HUD beats show the screen as the player sees it. hudTextChars is the telling being deleted; the pictures are the showing that replaces it.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "hudTextChars = rendered HUD text at the beat (show-don't-tell is this falling while the scene still explains itself). Sim tick costs cover advancing the same simulated seconds on the same machine.",
  metrics: {
    hudTextChars: { label: "HUD text", unit: "chars", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    ticksOver33: { label: "Ticks over 33 ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageDisaster,
};
