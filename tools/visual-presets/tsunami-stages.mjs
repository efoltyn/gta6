/* THE TSUNAMI, STAGE BY STAGE — a storyboard for tools/visual-compare.mjs.

   Owner's brief, and the shot list is a direct read of it: (1) Miyako 2011 at
   landfall — the front is a churning GRAY-BLACK debris soup boiling over the
   seawall, foam shredding off the leading edge, cars and logs tumbling INSIDE
   the water as battering rams; (2) the open-sea face — a towering curling wall
   with a spray-torn crest. Every beat below exists to answer whether one of
   those two pictures is on the screen.

   Staged like nuke-sequence.mjs and disaster-sequence.mjs: boot the REAL game
   into survival free play, freeze the rAF loop so CBZ.stepSim is the only
   clock, force the director onto the tsunami and photograph named beats of ONE
   seeded run per side. Both builds therefore sample the same simulated seconds
   of the same match, and the pictures are comparable rather than merely
   similar.

   The beats are polled on STATE, not on wall-clock: CBZ.disasters.state()
   reports idle|warn|active and CBZ.disasters.tsunamiAudit().phase reports
   warn|sweep|flooded|drain, so a build whose pacing differs still gets
   photographed at the same physical moment of the event.

   Staging facts this depends on (verified 2026-08-02/03):
   - rAF stub after boot kills core/loop.js; CBZ.hitstop/slowmo zeroed per tick.
   - The island is CBZ.surv.arena {center:{x,z}, radius}; the sky rig
     (CBZ.skyDome.parent) must be recentered — or CBZ.skySync() called —
     before any manual render.
   - The event's travel bearing is random per run, so no camera may be a fixed
     world point: every tripod below is expressed RELATIVE to the live front
     (CBZ.waterEventGet().dx/dz/frontS), which is what makes the front-quarter
     Miyako shot reproducible across two builds that shuffled differently.
   - The player is healed every tick; the storyboard must not end in WASTED. */

const beats = [
  {
    id: "drawdown",
    label: "The drawdown — the only warning",
    focus: "Warn phase. The sea empties off the shelf and hundreds of metres of wet seabed appear; the crowd should already be running uphill. No siren text, no banner: this IS the warning.",
    wait: { state: "warn", phase: "warn", extraSecs: 6 },
    shot: { mode: "front", back: 250, side: 130, alt: 34, aimAhead: -60, aimY: 0 },
  },
  {
    id: "opensea",
    label: "The open-sea face",
    focus: "The bore still in deep water: long, low and FAST — c = √(g·d), so out here it has all its speed and not yet all its height. Blue-green and translucent, spray tearing off the lip. Watch frontV: this must be the fastest the wave moves before the crash.",
    wait: { state: "active", phase: "sweep", untilShoal: 0.55 },
    shot: { mode: "front", back: -118, side: 126, alt: 46, aimAhead: -6, aimY: 14 },
  },
  {
    id: "peak",
    label: "THE PEAK — the wave stands",
    focus: "The owner's reference frame. Shoaling has traded the wave's speed for height: metres off the beach it is at its tallest, steepest, most overhung — and SLOWEST. For a held beat the wall simply STANDS over the town, crawling, boiling. frontV must be the lowest of any beat; the before build has no stall and photographs the same wave mid-stride instead.",
    wait: { untilShoal: 0.975, extraSecs: 0.25 },
    shot: { mode: "front", back: -120, side: 92, alt: 24, aimAhead: -4, aimY: 20 },
  },
  {
    id: "crash",
    label: "THE CRASH — the lip comes down",
    focus: "The stand ends all at once: the curl folds, the crest drops, a line of white water erupts along the whole front, and the released bore accelerates into the streets. After = a breaking EVENT you can point at (crashAge just past zero, frontV surging); before = the same wall walking at cruise speed.",
    wait: { untilFrontPast: 5, extraSecs: 0.2 },
    shot: { mode: "front", back: -98, side: 108, alt: 36, aimAhead: -8, aimY: 10 },
  },
  {
    id: "landfall",
    label: "LANDFALL — the Miyako shot",
    focus: "THE reference frame. Front-quarter on the churning gray-black debris soup as it takes the shore town: sediment darkening the water, foam boiling off the leading edge, whitewater streaking back to sea, cars and trees tumbling inside it.",
    wait: { untilFrontPast: 24, extraSecs: 0.35 },
    shot: { mode: "front", back: -96, side: 104, alt: 42, aimAhead: -10, aimY: 9 },
  },
  {
    id: "crossing",
    label: "Mid-crossing — the wall spending itself",
    focus: "Halfway over the island. THE QUESTION THIS BEAT ASKS: is there still a wall here? A bore that has run 130 m inland has been climbing and tearing through a town the whole way, and what is left of it should be a fast, deep, dirty flood with an edge — not the same tower that broke on the beach. Watch faceH against the landfall frame.",
    wait: { untilFrontPast: 130 },
    shot: { mode: "front", back: -104, side: 118, alt: 44, aimAhead: -12, aimY: 8 },
  },
  {
    id: "inundation",
    label: "Inundation — roofs as islands",
    focus: "The town is under. Concrete towers and their roofs stand clear and dry (vertical evacuation works); light wood-frame footprints are gone. Debris drifts between the buildings that are left.",
    wait: { phase: "flooded", extraSecs: 5 },
    shot: { mode: "center", dist: 86, alt: 30, aimY: 5 },
  },
  {
    id: "undertow",
    label: "The drain — the undertow",
    focus: "The water tearing back out to sea. This is the half that drowns people: the current reverses, and the wreckage the wave carried in is stranded across the streets as it goes.",
    wait: { phase: "drain", extraSecs: 2.2 },
    shot: { mode: "center", dist: 150, alt: 40, aimY: 3 },
  },
  {
    id: "aftermath",
    label: "Aftermath — what it left",
    focus: "The sea is back where it started. What stayed is the evidence: cars on their roofs in the streets, logs across doorways, the swept footprints. The debris does not disappear with the water.",
    wait: { untilIdle: true, extraSecs: 2 },
    shot: { mode: "center", dist: 96, alt: 30, aimY: 2 },
  },
];

const subjects = beats.map((b) => ({
  id: b.id, label: b.label, focus: b.focus, wait: b.wait, shot: b.shot,
}));

async function stageTsunami(input) {
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
      if (child.id === "__tsuOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__tsuSeq;
  if (!S) {
    // ---- one-time: boot the real game into survival free play -------------
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
    // Headless SwiftShader settles into the LOW quality tier; the owner plays
    // high, and the ocean's segment count is tier-driven. Pin it before the
    // event composes or the shots understate the water.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    const overlay = document.createElement("div");
    overlay.id = "__tsuOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__tsuSeq = { overlay, started: false, ticks: 0 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };

    // settle, then put the director on the tsunami and leave it there
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    CBZ.disasters.force("flood");
    S.started = true;
  }

  const subject = input.subject;
  const w = subject.wait || {};
  const heal = () => {
    if (!CBZ.player) return;
    // swim.js owns the breath meter and will happily drown the storyboard;
    // restoring hp every tick is what keeps the run alive through it
    CBZ.player.hp = 100; CBZ.player.dead = false;
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
  const audit = () => {
    try { return CBZ.disasters.tsunamiAudit() || {}; } catch (_) { return {}; }
  };

  // ---- poll to this beat's PHYSICAL moment (never a wall clock) -----------
  let guard = 0;
  if (w.state) while (guard++ < 4000 && CBZ.disasters.state() !== w.state) step(0.1);
  if (w.phase) { guard = 0; while (guard++ < 4000 && audit().phase !== w.phase) step(0.1); }
  /* SHOAL, NOT SECONDS. The bore crosses its open water in under two seconds
     at this pacing, so "2.5 s into the sweep" would photograph the landfall on
     one build and the beach on another. `shoal` is the physical fraction of
     the way the front has come through that open water — 0 out at sea, 1 at
     the instant it breaks — so both builds get the same wave. */
  if (w.untilShoal != null) {
    guard = 0;
    while (guard++ < 4000) {
      const a = audit();
      if (a.phase === "sweep" && a.shoal != null && a.shoal >= w.untilShoal) break;
      if (a.phase && a.phase !== "sweep" && a.phase !== "warn") break;   // missed it; do not hang
      step(1 / 60);
    }
  }
  if (w.untilFrontPast != null) {
    guard = 0;
    const A0 = CBZ.surv.arena;
    while (guard++ < 4000) {
      const a = audit();
      if (a.phase !== "sweep") { step(0.1); continue; }
      // frontS is measured from the island centre and -R IS the beach, so
      // `untilFrontPast` is metres INLAND: the Miyako beat is the bore already
      // in the streets, not still standing off the shore.
      if (a.frontS != null && a.frontS > -A0.radius + w.untilFrontPast) break;
      step(0.05);
    }
  }
  if (w.untilIdle) { guard = 0; while (guard++ < 6000 && CBZ.disasters.state() === "active") step(0.1); }
  if (w.extraSecs) step(w.extraSecs);

  // ---- frame it, RELATIVE TO THE LIVE FRONT -------------------------------
  const A = CBZ.surv.arena;
  const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
  const a2 = audit();
  const dx = ev && Number.isFinite(ev.dx) ? ev.dx : 1;
  const dz = ev && Number.isFinite(ev.dz) ? ev.dz : 0;
  const px = -dz, pz = dx;                     // the front's own lateral axis
  const fs = a2.frontS != null && a2.frontS > -1e8 ? a2.frontS : -A.radius;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.5;
  camera.far = 20000;
  const sh = subject.shot || {};
  let cx, cz, ax, az, ay;
  if (sh.mode === "front") {
    const fx = A.center.x + dx * fs, fz = A.center.z + dz * fs;
    cx = fx - dx * (sh.back || 80) + px * (sh.side || 90);
    cz = fz - dz * (sh.back || 80) + pz * (sh.side || 90);
    ax = fx + dx * (sh.aimAhead || 0);
    az = fz + dz * (sh.aimAhead || 0);
    ay = sh.aimY || 4;
  } else {
    cx = A.center.x - dx * (sh.dist || 120);
    cz = A.center.z - dz * (sh.dist || 120);
    ax = A.center.x; az = A.center.z; ay = sh.aimY || 4;
  }
  camera.position.set(cx, (sh.alt || 30), cz);
  camera.lookAt(ax, ay, az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(cx, 0, cz);
  }
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:60px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em;max-width:640px";
  query("focus").textContent = subject.focus;
  query("focus").style.cssText = "position:absolute;top:96px;left:28px;color:#c0cfda;font-size:12.5px;font-weight:550;max-width:660px;line-height:1.45";
  query("perf").textContent =
    `phase ${a2.phase || "—"} · front ${fs.toFixed(0)}m · v ${a2.frontV != null ? a2.frontV.toFixed(1) + "m/s" : "—"}`
    + `${a2.stalled ? " · STANDING" : ""}${a2.crashAge != null ? " · crash+" + a2.crashAge.toFixed(1) + "s" : ""}`
    + ` · turbid ${(a2.sediment != null ? a2.sediment : 0).toFixed(2)}`
    + ` · faceH ${a2.faceH != null ? a2.faceH.toFixed(1) + "m" : "—"} (spent ${a2.spent != null ? a2.spent.toFixed(2) : "—"})`
    + ` · debris ${a2.debrisEntrained || 0} (${a2.debrisStrikes || 0} strikes)`
    + ` · undertow ${(a2.undertowPull || 0).toFixed(1)}`
    + ` · refuges ${a2.refugesStanding != null ? a2.refugesStanding + "/" + a2.refugesTotal : "—"}`;
  query("perf").style.cssText = "position:absolute;right:24px;top:24px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:14px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    debrisEntrained: Number(a2.debrisEntrained || 0),
    debrisStrikes: Number(a2.debrisStrikes || 0),
    debrisKills: Number(a2.debrisKills || 0),
    sediment: Number((a2.sediment || 0).toFixed(3)),
    /* THE WALL'S LIVE HEIGHT, so "did it come down as it crossed" is a number
       and not an argument about a screenshot. Neither reading has a good
       direction on its own — tall is right at landfall and wrong halfway over
       the island — so they are reported plainly and read per beat. */
    faceH: Number(a2.faceH || 0),
    spent: Number(a2.spent != null ? a2.spent : 0),
    /* THE SPEED OF THE FRONT AT THE SHOT — the whole shoaling argument as one
       number per beat: fast at opensea, a crawl at the peak, surging again
       after the crash. Like faceH it has no good direction on its own; it is
       read per beat, and a build that predates it reports 0 = not measured. */
    frontV: Number(a2.frontV || 0),
    undertowPull: Math.abs(Number(a2.undertowPull || 0)),
    refugesStanding: Number(a2.refugesStanding || 0),
    lightSwept: Number(a2.lightSwept || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return {
    ok: true,
    phase: a2.phase || null,
    frontS: Number(fs.toFixed(1)),
    state: CBZ.disasters.state(),
    metrics,
  };
}

export default {
  id: "tsunami-stages",
  title: "The Tsunami: Drawdown, Stand, Crash, Undertow",
  description: "One seeded survival tsunami per build, polled to the same PHYSICAL beats — the drawdown that is the only warning, the fast open-sea curl, the PEAK where shoaling has traded all that speed for height and the wall STANDS over the beach at a crawl, the CRASH where the lip comes down and releases the bore, the Miyako landfall on the debris churn, the inundation with roofs as islands, the undertow tearing back out, and the wreckage it leaves. Every tripod is placed relative to the live wave front, so the shots line up even though the bearing is random per run.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "Debris counts and the undertow are read from CBZ.disasters.tsunamiAudit() at the moment of the shot: what the water was carrying, how often it hit somebody, and how hard it pulled on the way out. refugesStanding is the invariant — the wave may wound a concrete tower but must never take one down. NOTE: faceH, spent and frontV are NEW audit fields — a build that predates them reports 0, which means 'not measured', not 'no wave'. frontV is the shoaling arc in one number per beat: fastest at OPEN SEA, a crawl at THE PEAK while the wave stands, surging again after THE CRASH. For these the pictures are the comparison; the numbers only speak within a side.",
  metrics: {
    debrisEntrained: { label: "Debris entrained", better: "higher" },
    debrisStrikes: { label: "Debris strikes", better: "higher" },
    debrisKills: { label: "Debris kills", better: "higher" },
    sediment: { label: "Turbidity", better: "higher" },
    faceH: { label: "Face height", unit: "m" },
    spent: { label: "Bore left", },
    frontV: { label: "Front speed", unit: "m/s" },
    undertowPull: { label: "Undertow", unit: "m/s", better: "higher" },
    refugesStanding: { label: "Refuges standing", better: "higher" },
    lightSwept: { label: "Light frames swept", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageTsunami,
};
