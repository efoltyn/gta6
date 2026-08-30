/* THE TSUNAMI HAS A SIZE NOW — photograph the RANGE, not the event.

   Owner: "all the natural disasters are cookie cutter size — there's no BIG
   tsunami or a small one, they're all one size." city-tsunami-stages
   photographs one event beat by beat; this preset photographs TWO events —
   the smallest the roll can produce and very nearly the biggest — from the
   SAME tripods, so the size range is visible on one page.

   WHAT A SIZE IS (city/tsunami.js, magnitude wave 2026-08-29): a
   per-occurrence roll off the run seed moves the run-up (~0.6 m → ~12 m),
   the drawdown, the inland reach (~50 m → ~200 m+), the number of waves in
   the train (1 → 3, the biggest usually not first), the durations, the face
   height (a ~2 m dirty bore → a 56 m wall) and the undertow, together.

   ON A BUILD BEFORE THE ROLL both triggers below produce the identical
   5.4 m single wave — the before side of this comparison IS the cookie-cutter
   complaint, photographed.

   STAGING is city-tsunami-stages' machinery: boot Gang City, freeze rAF,
   stand the player on the beach, trigger with a PINNED magnitude
   (CBZ.cityTsunami({mag}) — opts win over the roll), and poll every beat to
   a PHYSICAL condition off cityTsunamiState(), never a wall clock. */

const SHOT_WALL = { mode: "front", back: -100, side: 82, alt: 26, aimAhead: -4, aimY: 10 };
const SHOT_REACH = { mode: "origin", back: -170, side: 55, alt: 95, aimAhead: 45, aimY: 0 };

const subjects = [
  {
    id: "small-wall",
    label: "THE SMALL ONE — a half-metre sea, standing up",
    focus: "Magnitude pinned to the bottom of the roll: ~0.6 m of run-up arriving as a ~2 m turbid bore. Frightening, survivable on foot, and photographed from the SAME tripod as the big one below — the size difference must be in the pixels, not the caption.",
    run: { id: "small", mag: 0.04 },
    wait: { wallUp: true },
    shot: SHOT_WALL,
  },
  {
    id: "small-reach",
    label: "The small one, all the way in",
    focus: "Its whole inland reach: the promenade and the first street are awash, the town behind is dry. On a one-size build this frame and 'the big one, all the way in' are the same picture.",
    run: { id: "small", mag: 0.04 },
    wait: { fullIn: true },
    shot: SHOT_REACH,
  },
  {
    // BEFORE big-wall: one run, one forward clock — wave 2 breaks before wave 3
    id: "big-train",
    label: "The train — the sea pulls out and comes BACK",
    focus: "A big tsunami is not one wave. Between waves the sea ebbs out below mean level — the false all-clear — and the next wave of the train re-crashes over it, taller. A build with a single-wave arc spends this beat draining, which is its own honest verdict.",
    run: { id: "big", mag: 0.97 },
    wait: { secondCrash: true },
    shot: { mode: "front", back: -95, side: 100, alt: 34, aimAhead: 0, aimY: 12 },
  },
  {
    /* A FRESH RUN ("big2"), not a later beat of "big": on a single-wave build
       the train beat above burns its run to the drain, and a wall shot taken
       after it would photograph the aftermath. Same magnitude, same seed. */
    id: "big-wall",
    label: "THE BIG ONE — the wall",
    focus: "Magnitude pinned near the top: 10 m+ of run-up, and the LAST wave of the train wearing a wall several times the seafront buildings. Same tripod, same beat as the small one's wall — one page, two sizes, or there is no size.",
    run: { id: "big2", mag: 0.97 },
    wait: { wallUp: true },
    shot: SHOT_WALL,
  },
  {
    id: "big-reach",
    label: "The big one, all the way in",
    focus: "Deep water hundreds of metres into the town, only roofs clear of it. Same tripod as the small one's reach frame: the pixels between these two frames are the owner's missing size axis.",
    run: { id: "big2", mag: 0.97 },
    wait: { fullIn: true },
    shot: SHOT_REACH,
  },
];

async function stageCityTsunamiSizes(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return { ok: false, missing: "CBZ/THREE" };
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
      if (child.id === "__ctszOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__ctszSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="city"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    const built = await until(() => CBZ.city && CBZ.city.arena && CBZ.city.arena.shore, 240000, 300);
    if (!built) return { ok: false, err: "city never built" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    if (CBZ.setFPS) CBZ.setFPS(false);
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    const overlay = document.createElement("div");
    overlay.id = "__ctszOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__ctszSeq = { overlay, runId: null, simT: 0, lat: null, smallPeak: 0 };
    /* THE UNDERWATER-FOG LEAK: water_underwater.js writes scene.fog while the
       LIVE camera's eye is under, and restores it on a later sim tick — but a
       staged render happens between ticks, so whatever the game camera did on
       the last wait tick leaks a teal fog bank into the capture. Snapshot the
       dry boot fog and put it back before every render. */
    const fg = CBZ.scene && CBZ.scene.fog;
    S.fog0 = fg ? { c: fg.color.getHex(), n: fg.near, f: fg.far } : null;
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const heal = () => { if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } };
  const parkOnBeach = () => {
    const SH = CBZ.city.arena.shore;
    if (CBZ.player && CBZ.player.pos && SH && SH.beach) {
      CBZ.player.pos.set((SH.beach.x0 + SH.beach.x1) / 2, 0, SH.ES + 14);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
  };
  const st = () => { try { return CBZ.cityTsunamiState(); } catch (_) { return null; } };
  /* THE UNDERWATER-FOG TRAP (curtain-breach wave): the underwater tint and
     the teal scene.fog are driven by the PLAYER's submergence, and a player
     left standing in the flood washes every aerial frame pale. Once the event
     is live the player is hoisted clear of the water — the origin and bearing
     were already read off them at trigger time, on the beach. */
  const hoist = () => {
    if (!CBZ.player || !CBZ.player.pos) return;
    if (st() && CBZ.player.pos.y < 42) { CBZ.player.pos.y = 60; if (CBZ.player.vy != null) CBZ.player.vy = 0; }
  };
  let ticks = 0, totalMs = 0, maxMs = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms; S.simT += 1 / 60;
      if (ms > maxMs) maxMs = ms;
      heal(); hoist();
    }
  };
  // every poll latches the run's physical extremes, because the beat a
  // number peaks at is not always the beat that photographs best
  const latch = () => {
    const s = st(); if (!s || !S.lat) return s;
    S.lat.maxFront = Math.max(S.lat.maxFront, s.frontS);
    S.lat.maxSurge = Math.max(S.lat.maxSurge, s.surge);
    S.lat.minSurge = Math.min(S.lat.minSurge, s.surge);
    S.lat.maxFaceH = Math.max(S.lat.maxFaceH, s.faceH || 0);
    if (s.crestVar != null) S.lat.crestVar = s.crestVar;
    if (s.endTaper != null) S.lat.endTaper = s.endTaper;
    if (s.waves != null) S.lat.waves = s.waves;
    if (s.peak != null) S.lat.peak = s.peak;
    if (s.frontTo != null) S.lat.frontTo = s.frontTo;
    return s;
  };

  // ---- one run per size: stop whatever is live, park, trigger pinned ------
  if (S.runId !== subject.run.id) {
    try { if (CBZ.cityTsunamiStop) CBZ.cityTsunamiStop(); } catch (_) {}
    parkOnBeach();
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); heal(); }
    if (!CBZ.cityTsunami) return { ok: false, err: "no CBZ.cityTsunami" };
    if (!CBZ.cityTsunami({ mag: subject.run.mag })) return { ok: false, err: "cityTsunami() refused to fire" };
    S.runId = subject.run.id;
    S.simT = 0;
    S.lat = { maxFront: -1e9, maxSurge: -1e9, minSurge: 1e9, maxFaceH: 0, crestVar: null, endTaper: null, waves: 1, peak: 0, frontTo: null };
  }

  /* ---- poll to this subject's PHYSICAL beat ------------------------------ */
  const w = subject.wait || {};
  let guard = 0;
  if (w.wallUp) {
    // the wall at its moment: the LAST wave of the train breaking (each wave
    // wears its own height, and the last is the event's peak) — or, failing
    // a crash, the level fraction past the stand. Same beat at any size; a
    // single-wave build has no waveN and breaks at its only crash.
    while (guard++ < 8000) {
      const s = latch(); if (!s) break;
      const lastWave = s.waveN == null || s.waves == null || s.waveN >= s.waves;
      if ((s.crashed || s.u >= 0.86) && lastWave) break;
      step(1 / 60);
    }
    step(0.25);
  }
  if (w.secondCrash) {
    // wave 2+ of the train breaking. A single-wave build never gets here and
    // falls through at the drain, which is the honest picture of "no train".
    while (guard++ < 6000) {
      const s = latch(); if (!s) break;
      if ((s.waveN || 1) >= 2 && s.crashed) break;
      if (s.phase === "drain") break;
      step(1 / 30);
    }
    step(0.25);
  }
  if (w.fullIn) {
    // the flood at its fullest: the last hold's back half (train-aware —
    // wave count comes off the live state), or wherever the surge maxes out
    while (guard++ < 8000) {
      const s = latch(); if (!s) break;
      if (s.phase === "drain") break;
      if (s.phase === "hold" && (s.waveN == null || s.waves == null || s.waveN >= s.waves) && (s.phaseU == null || s.phaseU >= 0.5)) break;
      step(1 / 30);
    }
  }

  // ---- frame it, from the SAME tripod for both sizes ----------------------
  const s2 = latch();
  const E = s2 || S.lastE || {};
  if (s2) S.lastE = { cx: s2.cx, cz: s2.cz, dx: s2.dx, dz: s2.dz, frontS: s2.frontS };
  const dx = Number.isFinite(E.dx) ? E.dx : 1;
  const dz = Number.isFinite(E.dz) ? E.dz : 0;
  const px = -dz, pz = dx;
  const ox = Number.isFinite(E.cx) ? E.cx : 0, oz = Number.isFinite(E.cz) ? E.cz : 0;
  const fs = Number.isFinite(E.frontS) ? E.frontS : 0;
  const sh = subject.shot || {};
  const anchor = sh.mode === "origin" ? 0 : fs;
  const fx = ox + dx * anchor, fz = oz + dz * anchor;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5; camera.far = 20000;
  const cx = fx - dx * (sh.back || 80) + px * (sh.side || 90);
  const cz = fz - dz * (sh.back || 80) + pz * (sh.side || 90);
  camera.position.set(cx, sh.alt || 30, cz);
  camera.lookAt(fx + dx * (sh.aimAhead || 0), sh.aimY || 4, fz + dz * (sh.aimAhead || 0));
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) { skyRig.position.set(cx, 0, cz); skyRig.updateMatrixWorld(); }
  }
  hideHud();
  if (S.fog0 && CBZ.scene && CBZ.scene.fog) {
    CBZ.scene.fog.color.setHex(S.fog0.c);
    CBZ.scene.fog.near = S.fog0.n; CBZ.scene.fog.far = S.fog0.f;
  }
  CBZ.renderer.render(CBZ.scene, camera);

  const L = S.lat || {};
  if (subject.run.id === "small" && L.peak) S.smallPeak = L.peak;
  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:56px;left:22px;padding:6px 12px;border-radius:8px;background:rgba(6,12,17,.62);font-size:25px;font-weight:800;letter-spacing:-.02em;max-width:660px";
  query("focus").textContent = subject.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:22px;padding:8px 12px;border-radius:8px;background:rgba(6,12,17,.62);color:#cfdce6;font-size:12.5px;font-weight:550;max-width:640px;line-height:1.45";
  query("perf").textContent =
    `run-up ${L.peak ? L.peak.toFixed(1) + "m" : "—"}`
    + ` · waves ${L.waves || 1}`
    + ` · drawdown ${Number.isFinite(L.minSurge) && L.minSurge < 0 ? L.minSurge.toFixed(1) + "m" : "—"}`
    + ` · reach ${L.maxFront > -1e8 ? L.maxFront.toFixed(0) + "m" : "—"}`
    + ` · wall ${L.maxFaceH ? L.maxFaceH.toFixed(1) + "m" : "—"}`
    + ` · t ${S.simT.toFixed(1)}s`
    + `${s2 ? " · " + s2.phase + (s2.waveN ? " w" + s2.waveN : "") : " · over"}`;
  query("perf").style.cssText = "position:absolute;right:20px;top:20px;padding:7px 11px;border-radius:8px;background:rgba(6,12,17,.62);font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right;max-width:520px";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:12px;left:22px;padding:4px 9px;border-radius:6px;background:rgba(6,12,17,.55);color:#a8bccb;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    runupPeak: Number((L.peak || 0).toFixed(2)),
    waves: Number(L.waves || 1),
    drawdown: Number((Number.isFinite(L.minSurge) ? Math.min(0, L.minSurge) : 0).toFixed(2)),
    inlandReach: Number((L.maxFront > -1e8 ? L.maxFront : 0).toFixed(0)),
    wallPeak: Number((L.maxFaceH || 0).toFixed(1)),
    crestVar: Number((L.crestVar || 0).toFixed(3)),
    endTaper: L.endTaper != null ? Number(L.endTaper.toFixed(3)) : 1,
    eventT: Number(S.simT.toFixed(1)),
    /* THE HEADLINE: metres of run-up between the smallest and the biggest
       event this build can produce. A one-size build scores 0. */
    magSpread: Number(Math.max(0, (subject.run.id === "big" && L.peak ? L.peak - (S.smallPeak || 0) : 0)).toFixed(2)),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
  };
  return { ok: true, phase: s2 ? s2.phase : "over", metrics };
}

export default {
  id: "city-tsunami-sizes",
  title: "The Tsunami Has a Size: Small vs Big, Same Tripods",
  description: "Two pinned-magnitude city tsunamis — the smallest the roll produces (~0.6 m, one wave, the promenade) and nearly the biggest (10 m+, a three-wave train, deep inland) — photographed at the same beats from the same tripods, so the size range the owner asked for is visible on one page. On a build before the magnitude roll, both triggers produce the identical 5.4 m wave: the before side IS the cookie-cutter complaint.",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metricsNote: "magSpread is the headline: metres of run-up between the small and the big event — a one-size build scores 0. runupPeak / drawdown / inlandReach / wallPeak / waves are the axes a magnitude must move (per size, so compare them across the small-* and big-* rows, not against each other). crestVar and endTaper are the face's un-ruler evidence: variance along the crest (0 = a ruler) and the end columns' height over the mean (1 = the old flat end-cap).",
  metrics: {
    runupPeak: { label: "Run-up peak", unit: "m" },
    waves: { label: "Waves in the train", better: "higher" },
    drawdown: { label: "Deepest drawdown", unit: "m" },
    inlandReach: { label: "Inland reach", unit: "m" },
    wallPeak: { label: "Tallest wall", unit: "m" },
    crestVar: { label: "Crest variance along front", better: "higher" },
    endTaper: { label: "End-cap height / mean", better: "lower" },
    eventT: { label: "Clock at beat", unit: "s" },
    magSpread: { label: "Size spread (big − small)", unit: "m", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageCityTsunamiSizes,
};
