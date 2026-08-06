/* THE FLASH FLOOD HYDROGRAPH as a storyboard, for tools/visual-compare.mjs.

   OWNER, 2026-08-06: make the flood make sense "in terms of how quickly the
   water comes in and comes out."

   The old curve was rise 0.42 -> stand 0.26 -> drain 0.32 of the event, with a
   comment above it claiming "water goes UP fast and out slowly". Those two
   statements are the opposite of each other, and the numbers won: the water
   took longer to arrive than it took to leave. A flood hydrograph's rising
   limb is ALWAYS steeper than its falling limb, and a FLASH flood is the
   extreme case — near-vertical rise, then a long exponential recession.

   So the beats are sampled off the WATER ITSELF rather than off the clock:
   each one polls the standing depth on the streets until it crosses a
   threshold on the way up or on the way down. That way both builds are
   photographed at the same PHYSICAL moment even though their curves are
   completely different shapes, which is the only honest way to compare them.

   Beats:
     dry-warn    the rain has started, the gutters are standing, nothing else
     wall        the front crossing the streets — the rising limb
     peak        the deepest the water gets
     half        the moment it has lost half its depth (the two builds reach
                 this at very different times, which IS the comparison)
     tail        deep into the recession: still ankle-to-knee, still a river
     residue     the event is over and the street is still wet
*/

const subjects = [
  {
    id: "dry-warn",
    label: "The warning — rain, and the gutters standing",
    focus: "Warn phase. The sky opens, the light goes, and the streets start to stand before anything else happens. A player who reads it is already walking uphill.",
    wait: { state: "warn", extraSecs: 3.5 },
    shot: { dist: 96, alt: 26, aimY: 2 },
  },
  {
    id: "wall",
    label: "The rising limb — it comes in FAST",
    focus: "The front crossing the low streets. This is the part that should be near-vertical on the hydrograph: in a flash flood everything runs off at once and the water arrives as a wall, not as a tide.",
    wait: { untilRising: 0.55, extraSecs: 0.2 },
    shot: { dist: 78, alt: 18, aimY: 1.5 },
  },
  {
    id: "peak",
    label: "Peak — cars float at two feet",
    focus: "The deepest it gets. Well over two feet of standing water in the channel, so cars are picked up and carried instead of sitting in a puddle looking bolted down, and the low streets genuinely swim. The hills and every building floor slab stay clear: the flood takes the streets, never the refuges.",
    wait: { untilPeak: true, extraSecs: 0.2 },
    shot: { dist: 86, alt: 24, aimY: 2 },
  },
  {
    id: "half",
    label: "Half drained — and look how long that took",
    focus: "THE COMPARISON. Both builds are photographed the moment the water has lost half its depth. On the before-side that happens almost as fast as the rise did — the old drain was shorter than the old rise. On the after-side the recession is an exponential tail, so this frame lands much later and there is still a lot of water in the picture.",
    wait: { untilFalling: 0.5, extraSecs: 0.2 },
    shot: { dist: 86, alt: 24, aimY: 2 },
  },
  {
    id: "tail",
    label: "The tail — the street is still a river",
    focus: "Deep into the recession. This is the part that actually strands people: not the wall, but the fact that the street you waded into is still moving water a long time after the peak has gone.",
    wait: { untilFalling: 0.18, extraSecs: 0.2 },
    shot: { dist: 78, alt: 16, aimY: 1.2 },
  },
  {
    id: "residue",
    label: "After — a flood does not recede to a dry street",
    focus: "The event is over and the ground is still wet. The pool bottoms out at a film rather than at zero, so the streets are still shining when the next warning starts.",
    wait: { untilIdle: true, extraSecs: 1.5 },
    shot: { dist: 92, alt: 22, aimY: 1.5 },
  },
];

async function stageFlood(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  // hide the game's own chrome so the frame is the WORLD; the caption overlay
  // is exempt by id (same sweep tsunami-stages.mjs uses)
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__floodOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__floodSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__floodOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#eef5fa;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__floodSeq = { overlay, peak: 0 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const w = subject.wait || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    // core/loop.js only ticks updaters while playing, and a flood that drowns
    // the last bot resolves the round mid-event and freezes the sim
    if (CBZ.game && CBZ.game.state !== "playing") CBZ.game.state = "playing";
  };
  let ticks = 0, totalMs = 0, maxMs = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms; if (ms > maxMs) maxMs = ms;
      heal();
    }
  };

  /* THE DEPTH IS THE CLOCK. Every beat below polls this, never a wall time,
     because the whole point of the comparison is that the two builds put the
     same depth at very different moments. Deepest of a ring, because
     groundWaterAt returns 0 ahead of the travelling front and on anything
     standing above its local reference floor — one probe point reads a
     confident zero for reasons that have nothing to do with the flood. */
  const A0 = CBZ.surv && CBZ.surv.arena;
  const ring = [];
  if (A0) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = A0.radius * (0.22 + 0.42 * ((i % 3) / 2));
      ring.push([A0.center.x + Math.cos(a) * r, A0.center.z + Math.sin(a) * r]);
    }
  }
  const depth = () => {
    let m = 0;
    for (let i = 0; i < ring.length; i++) {
      const d = CBZ.groundWaterAt ? CBZ.groundWaterAt(ring[i][0], ring[i][1]) : 0;
      if (d > m) m = d;
    }
    return m;
  };

  // the flood is forced once, at the first beat, and every later beat rides
  // the SAME event — that is what makes the sequence a hydrograph
  if (subject.id === "dry-warn") {
    S.peak = 0;
    CBZ.disasters.force("flashflood");
    step(0.1);
  }

  let guard = 0;
  if (w.state) while (guard++ < 3000 && CBZ.disasters.state() !== w.state) step(0.1);
  if (w.untilRising != null) {
    guard = 0;
    while (guard++ < 6000 && depth() < w.untilRising) {
      if (CBZ.disasters.current() !== "FLASH FLOOD") break;
      step(1 / 30);
    }
  }
  if (w.untilPeak) {
    guard = 0;
    let last = -1, falling = 0;
    while (guard++ < 6000) {
      const d = depth();
      if (d > S.peak) S.peak = d;
      if (d < last - 0.004) { if (++falling > 3) break; } else falling = 0;
      last = d;
      if (CBZ.disasters.current() !== "FLASH FLOOD") break;
      step(1 / 20);
    }
  }
  if (w.untilFalling != null) {
    guard = 0;
    const target = Math.max(0.02, (S.peak || depth()) * w.untilFalling);
    while (guard++ < 9000 && depth() > target) {
      if (CBZ.disasters.state() !== "active") break;
      step(1 / 20);
    }
  }
  if (w.untilIdle) { guard = 0; while (guard++ < 6000 && CBZ.disasters.state() === "active") step(0.1); }
  if (w.extraSecs) step(w.extraSecs);

  // ---- frame it: a fixed tripod over the low ground, because the flood has
  //      no travelling subject to track once the wall is through ------------
  const A = CBZ.surv.arena;
  const sh = subject.shot || {};
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5;
  /* STAND IT OFF THE ISLAND. The first pass put the tripod at 0.7R on a fixed
     bearing and it landed INSIDE a tower on four of the six beats — the frame
     was a grey slab with a caption on it. The camera sits outside the shore
     now and looks back across the low ground, which is also the only angle
     that shows a water LEVEL rather than a puddle. */
  /* HIGH AND INSIDE THE FOG. Two earlier framings failed for opposite
     reasons: at 0.7R on a fixed bearing the tripod stood INSIDE a tower, and
     at 1.6R it stood outside the event's own 150 m fog far plane, so the
     island came back as a black silhouette in haze. This looks DOWN on the
     low ground from just inside the shore — the only angle where a water
     LEVEL reads as a level rather than as a puddle. */
  const ang = 2.35;                            // one fixed bearing for every beat
  const dist = A.radius * 0.92 + (sh.dist || 0) * 0.12;
  const oy = A.oceanY != null ? A.oceanY : 0;
  camera.position.set(
    A.center.x + Math.cos(ang) * dist,
    oy + (sh.alt || 24) + 30,
    A.center.z + Math.sin(ang) * dist
  );
  camera.lookAt(A.center.x, oy + (sh.aimY || 2), A.center.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  hideHud();
  void document.documentElement.offsetHeight;
  const query = (k) => S.overlay.querySelector(`[data-${k}]`);
  query("side").textContent = input.sideLabel;
  query("side").style.cssText = "position:absolute;top:22px;left:24px;padding:7px 13px;border-radius:8px;font-weight:700;font-size:12px;letter-spacing:.08em;background:" + (input.side === "before" ? "#b3384a" : "#1f8f6a");
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:62px;left:26px;font-size:23px;font-weight:750;letter-spacing:-.01em";
  query("focus").textContent = subject.focus;
  query("focus").style.cssText = "position:absolute;top:96px;left:28px;color:#c6d7e2;font-size:12.5px;font-weight:550;max-width:680px;line-height:1.45";
  const d = depth();
  query("perf").textContent =
    `depth ${d.toFixed(2)} m · peak ${(S.peak || 0).toFixed(2)} m`
    + ` · surge ${(CBZ.waterSurge ? CBZ.waterSurge() : 0).toFixed(2)} m`
    + ` · ${CBZ.disasters.current() || "—"} ${CBZ.disasters.state()}`;
  query("perf").style.cssText = "position:absolute;right:24px;top:24px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:14px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    state: CBZ.disasters.state(),
    metrics: {
      depth: Number(d.toFixed(3)),
      peakDepth: Number((S.peak || 0).toFixed(3)),
      surge: Number((CBZ.waterSurge ? CBZ.waterSurge() : 0).toFixed(3)),
      tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
      tickMaxMs: Number(maxMs.toFixed(1)),
    },
  };
}

export default {
  id: "flashflood-stages",
  title: "The Flash Flood: a hydrograph, the right way round",
  description: "One seeded survival flash flood per build, polled to the same PHYSICAL depths rather than to the clock — the warning, the rising limb, the peak, the moment half the water has gone, the long tail, and the wet street it leaves. The rising limb of a flood hydrograph is always steeper than the falling limb; the old curve had it backwards while carrying a comment that said otherwise.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "Depth is the deepest standing water on a ring of street points, read at the moment of the shot. The two builds are photographed at matching DEPTHS, so the interesting number is not the depth itself — it is how long each build took to get there.",
  metrics: {
    depth: { label: "Standing depth", unit: "m", better: "higher" },
    peakDepth: { label: "Peak depth", unit: "m", better: "higher" },
    surge: { label: "Surge", unit: "m", better: "higher" },
    tickAvgMs: { label: "Sim tick", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageFlood,
};
