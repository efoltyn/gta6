/* Nuclear detonation storyboard for tools/visual-compare.mjs.

   Unlike the studio presets, this stages the REAL game: it boots the full
   city world (seed pinned by urlParams), clicks through the title screen,
   freezes the rAF loop, fires one real nuke through the full game-rule path
   (CBZ.strategicNukeDetonate → stars, radiation, wave, car cook-offs), then
   drives time forward with CBZ.stepSim(1/60) bursts — nukefx.js advances on
   dt (seeded LCG, no wall clock), so every beat lands on the exact same
   simulated second on both sides.

   Subjects are TIME BEATS of one detonation, staged in order in one page per
   side. Each beat also measures the sim while it advances: per-tick CPU ms
   (the domino-effect cost the owner feels as a freeze) and draw calls after
   a render from the beat's declared tripod. Those land on the report's
   Measurements page as before/after deltas.

   Staging facts this preset depends on (verified 2026-08-02):
   - core/loop.js re-schedules itself via requestAnimationFrame each frame,
     so stubbing rAF after boot freezes the loop; CBZ.stepSim then runs the
     identical updater+always chain with a synthetic dt and no render.
   - core/sky.js keeps the whole sky on a rig that follows the camera at
     y=0 with an r=850 dome — the tripod must stay BELOW ~700 m and must
     recenter the rig itself (CBZ.skyDome.parent) before rendering, or the
     sky shows as an external ball.
   - The whiteout is the #nukeFlash DOM div (nukefx reuses strategic.js's
     element) — it must survive the HUD hide sweep.
   - The player spawns near the centroid; they are teleported to each
     tripod and healed every tick so the storyboard cannot end in WASTED.

   KNOWN HARNESS ARTIFACT, MEASURED 2026-08-05 — READ THIS BEFORE BELIEVING
   AN AFTER-SIDE SHOT. On a two-sided run, every AFTER frame carries a dark
   faceted disc at pixels (587,401)-(719,530) of the 1100x680 viewport,
   identical to the pixel in every beat regardless of camera distance, cloud
   size or simulated time. It is NOT the cloud and it is NOT whatever change
   is under test:
     * it is pixel-identical (darkpx 11447) with the build's own nuke flags
       flipped either way, i.e. it survives the A/B it appears to belong to;
     * it never appears on the BEFORE side, and never on a single-navigation
       run (--only after), no matter which build is loaded;
     * it does not reproduce in a standalone CDP probe that copies this
       preset's staging exactly — same seed, tripod, quality tier, hideHud
       and player teleport.
   So it is triggered by the SECOND Page.navigate in the same tab, not by
   page content. Until somebody roots it out: for a look judgement, run the
   two builds as two separate `--only after` runs (each is a first
   navigation, and both come back clean) and compare those. Numbers on the
   Measurements page are unaffected. */

const beats = [
  { id: "flash",    t: 0.18, label: "t=0.18s — Double flash",
    focus: "The whiteout and first maximum. The screen should read as light, not geometry.",
    dist: 1500, alt: 300, aim: 380 },
  { id: "dome",     t: 0.85, label: "t=0.85s — White dome",
    focus: "Taylor–Sedov shock dome climbing, opaque, silhouetting the skyline.",
    dist: 2200, alt: 380, aim: 520 },
  { id: "handoff",  t: 1.60, label: "t=1.60s — Dome handoff",
    focus: "The dome has lifted; the revealed fireball must be YOUNG (under ~1 km), never a pre-formed mature mushroom.",
    dist: 2200, alt: 380, aim: 600 },
  { id: "fireball", t: 3.50, label: "t=3.50s — Cooling fireball",
    focus: "Core cooling white→orange, stem igniting under it, base surge starting to roll.",
    dist: 3000, alt: 430, aim: 850 },
  { id: "cap",      t: 8.00, label: "t=8.00s — Cap forms",
    focus: "The cap is forming and flattening; glass ladder has walked the city; surge curtain out.",
    dist: 5000, alt: 550, aim: 1500 },
  { id: "rise",     t: 15.0, label: "t=15.0s — Column rise",
    focus: "Stem tall, collar under the cap rim, dark crown boiling over.",
    dist: 8000, alt: 620, aim: 2800 },
  { id: "mature",   t: 26.0, label: "t=26.0s — Mature cloud",
    focus: "Near max rise. One coherent cloud body — no detached lobes, no billboard seams.",
    dist: 12500, alt: 650, aim: 4500 },
  { id: "after",    t: 33.0, label: "t=33.0s — Formation complete",
    focus: "End of the 34s formation window. The old build deletes the whole cloud right after this frame.",
    dist: 12500, alt: 650, aim: 4500 },
  { id: "landmark", t: 90.0, label: "t=1:30 — Maturing landmark",
    focus: "NUKE_FX_AFTERMATH: the cloud keeps growing toward the researched mature object instead of vanishing. (Both sides carry the aftermath since 2026-08-02 — judge shading/haze, not presence.)",
    dist: 16000, alt: 650, aim: 5200 },
  { id: "icon",     t: 210.0, label: "t=3:30 — The icon",
    focus: "Fully matured: ~5.1km cap, centre at 8km, standing over the burning city. This is what a 16kt cloud looks like from across the map.",
    dist: 20000, alt: 650, aim: 6200 },
];

const subjects = beats.map((beat) => ({
  id: beat.id,
  label: beat.label,
  focus: beat.focus,
  t: beat.t,
  dist: beat.dist,
  alt: beat.alt,
  aim: beat.aim,
}));

async function stageNuke(input) {
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
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__nukeOverlay" || child.id === "nukeFlash") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__nukeSeq;
  if (!S) {
    // ---- one-time: boot the real world into free play -------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // Headless SwiftShader settles into the LOW quality tier, which halves
    // the cloud's lobe counts — the owner plays at high tier, so shots must
    // match what he sees. Pin quality BEFORE the detonation composes.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop: from here CBZ.stepSim is the only clock, so both
    // sides sample identical simulated seconds regardless of machine speed.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700); // let the one already-scheduled frame fire and die

    // Deterministic pre-detonation settle (peds/cars/systems live).
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    // Ground zero: centroid of the built city → maximum honest domino.
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, count = 0;
    for (const lot of lots) {
      const x = Number(lot.x != null ? lot.x : lot.cx);
      const z = Number(lot.z != null ? lot.z : lot.cz);
      if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; count++; }
    }
    gx = count ? gx / count : 0;
    gz = count ? gz / count : 0;
    const gy = (CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0;

    const overlay = document.createElement("div");
    overlay.id = "__nukeOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__nukeSeq = { t: 0, gx, gz, gy, overlay, totalMs: 0 };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };

    // Fire through the FULL game path (crime, radiation, wave, cook-offs).
    if (typeof CBZ.strategicNukeDetonate === "function") {
      CBZ.strategicNukeDetonate(gx, gz, { byPlayer: false });
    } else if (typeof CBZ.detonate === "function") {
      CBZ.detonate(gx, gy + 1.2, gz, "nuke", { byPlayer: false });
    } else {
      return { ok: false, err: "no detonate handle" };
    }
  }

  // ---- move the player (and so the crowd bubble) to this beat's tripod --
  const camX = S.gx;
  const camZ = S.gz + Number(input.subject.dist);
  const groundY = (CBZ.floorAt && CBZ.floorAt(camX, camZ)) || 0;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(camX, groundY + 1.1, camZ);
    CBZ.player.hp = 100;
  }

  // ---- advance to this beat's simulated second, measuring every tick ----
  const target = Number(input.subject.t);
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0, over100 = 0;
  while (S.t < target - 1e-6) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    // Past the formation window the beats are minutes apart; a coarser dt
    // keeps the run tractable and nukefx is pure-dt so the cloud is identical.
    const dt = S.t > 40 ? 1 / 20 : 1 / 60;
    const t0 = performance.now();
    CBZ.stepSim(dt);
    const ms = performance.now() - t0;
    S.t += dt;
    ticks++; totalMs += ms;
    if (ms > maxMs) maxMs = ms;
    if (ms > 33) over33++;
    if (ms > 100) over100++;
    if (CBZ.player) CBZ.player.hp = 100; // the storyboard must not end WASTED
  }
  S.totalMs += totalMs;

  // ---- frame this beat from its declared tripod and render once ---------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 2;
  camera.far = 60000;
  camera.position.set(camX, S.gy + Number(input.subject.alt), camZ);
  camera.lookAt(S.gx, S.gy + Number(input.subject.aim), S.gz);
  camera.updateProjectionMatrix();
  // The loop that normally keeps the sky under the camera is frozen. Use
  // core/sky.js's own seam so the shot gets the SAME rig placement, palette
  // and sun elevation the live game would have written; the y=0 line below
  // is the pre-SKY_ALTITUDE fallback and is wrong for any camera high enough
  // to matter (it measures the sun's elevation from sea level, not the eye).
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camX, 0, camZ);
  }
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const info = CBZ.renderer.info || {};
  const render = info.render || {};

  const debug = (typeof CBZ.nukeFxDebug === "function") ? CBZ.nukeFxDebug() : null;
  const live = debug && debug.live ? debug.live : null;

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = input.subject.label;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = input.subject.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms · ${over33} ticks >33ms`
    : "";
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    t: Number(S.t.toFixed(3)),
    groundZero: [Number(S.gx.toFixed(1)), Number(S.gz.toFixed(1))],
    metrics: {
      tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
      tickMaxMs: Number(maxMs.toFixed(1)),
      ticksOver33: over33,
      ticksOver100: over100,
      drawCalls: Number(render.calls || 0),
    },
    live: live ? {
      t: live.t, capW: live.capWNow, rise: live.riseH,
      phase: live.cloudPhase, puffEvents: live.genericPuffEvents,
    } : null,
  };
}

export default {
  id: "nuke-sequence",
  title: "The Nuke: One Detonation, Eight Beats",
  description: "One real nuclear detonation at the city's centroid, fired through the full game path and stepped to eight exact simulated seconds on both builds. Every beat is photographed from a declared tripod, and the sim is timed while it advances — so the visual arc and the freeze cost are read side by side.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Per-beat cost of advancing the same simulated seconds on the same machine: average and worst CBZ.stepSim tick, ticks over the 33ms frame budget, and draw calls from the storyboard camera.",
  metrics: {
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    ticksOver33: { label: "Ticks over 33 ms", better: "lower" },
    ticksOver100: { label: "Ticks over 100 ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageNuke,
};
