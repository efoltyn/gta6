/* ============================================================
   core/quality.js — adaptive quality ("smoothmaxx").
   Auto-scales render resolution + shadow detail to hold ~60fps on
   any GPU. Strong devices get full-res crisp shadows; weak ones step
   down quietly instead of dropping frames, and step back up when
   there's headroom — nothing is permanently nerfed.

   CBZ.qualityLocked (default false) lets src/systems/settings.js pin a
   manual tier: sampleFPS() below no-ops while it's true, and
   CBZ.setQualityLevel(n) is the one call the settings panel needs to set
   qLevel + applyQuality() together (capped at the live host-aware
   CBZ.qualityTopTier()). Untouched (panel never opened) → byte-identical.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const renderer = CBZ.renderer, sun = CBZ.sun;

  // With MSAA now handling edge aliasing (see core/renderer.js), a lower
  // device-pixel-ratio looks nearly identical to brute-force supersampling
  // but renders far fewer pixels — so the top tiers are capped lower than
  // before. That's a net win: comparable sharpness, noticeably smoother.
  // Each tier also carries a ped LOD ({ vis, shadow } in world units). The city
  // is DRAW-CALL bound, not pixel bound (full rigs are ~16 calls each), so the
  // single most effective thing a weak tier can do is render FEWER full rigs —
  // pulling in their visibility radius and killing their shadows. Resolution
  // scaling (pr) alone never fixed it because pixels were never the bottleneck.
  // fog  = city fog.far per tier (near scales with it). Tier 4 = today's 430.
  // cull = distance-cull radius for whole static city groups (core/farcull.js);
  //        0 = off. Set a hair past the tier's fog.far so everything culled is
  //        ALREADY 100% fog-dissolved — the player can't see the difference,
  //        the GPU absolutely can (it stops drawing entire building shells +
  //        their un-batchable glass). Tiers 3-4 keep cull OFF = today, exactly.
  const QUALITY = [
    { pr: 0.28, shadow: 512, crowd: 24,   ped: { vis: 20,  shadow: 0  }, sunShadow: false, fog: 170, cull: 235 },  // 0 — emergency: sun shadows OFF, minimal render budget/radius/res
    { pr: 0.8, shadow: 1024, crowd: 360,  ped: { vis: 70,  shadow: 28 }, fog: 260, cull: 330 },  // 1
    { pr: 1.0, shadow: 1024, crowd: 520,  ped: { vis: 85,  shadow: 38 }, fog: 350, cull: 430 },  // 2
    { pr: Math.min(devicePixelRatio, 1.25), shadow: 2048, crowd: 720,  ped: { vis: 95,  shadow: 42 }, fog: 430, cull: 0 },  // 3
    { pr: Math.min(devicePixelRatio, 1.5),  shadow: 2048, crowd: 1000, ped: { vis: 110, shadow: 50 }, fog: 430, cull: 0 },  // 4 — full fat
  ];
  const QUALITY_LABELS = ["Fastest", "Fast", "Balanced", "High", "Best"];
  // A fresh session is a first impression, not a benchmark screen. Starting at
  // the emergency tier hid most of the archipelago behind a 170m fog wall and
  // made the aerial world look unfinished until the tuner slowly climbed up.
  // Start from the coherent High presentation; the adaptive sampler still
  // steps down immediately when a device genuinely needs it.
  let qLevel = 3;

  // ---- manual override (pause-screen Performance↔Quality slider) ----------
  // Default is full auto (the adaptive sampler below). Dragging the slider
  // pins qLevel to the chosen tier and disables auto-adjust entirely — a
  // manual choice should stick, not get silently overridden. Persisted so it
  // survives a reload.
  CBZ.qualityAuto = true;
  try {
    const saved = localStorage.getItem("cbz_qualityLevel");
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n < QUALITY.length) { qLevel = n; CBZ.qualityAuto = false; }
    }
  } catch (e) {}

  // ONE setQualityLevel for both manual surfaces (pause slider + settings
  // panel): pins the tier, disables auto (qualityAuto=false is what the
  // sampler checks), persists, and never exceeds the live host-aware ceiling.
  function setQualityLevel(n) {
    n = Math.max(0, Math.min(QUALITY.length - 1, n | 0));
    n = Math.min(n, topTier());
    qLevel = n;
    CBZ.qualityAuto = false;
    try { localStorage.setItem("cbz_qualityLevel", String(n)); } catch (e) {}
    applyQuality();
    return qLevel;
  }
  CBZ.setQualityLevel = setQualityLevel;
  CBZ.qualityLabels = QUALITY_LABELS;

  // ---- QUALITY-V2 (smarter FEEL-aware tier control) -----------------------
  // Gated behind CBZ.qualityV2 (default ON). When OFF we run the ORIGINAL
  // sampler verbatim (see the `else` branch of sampleFPS) → today's behaviour
  // byte-for-byte. V2 fixes three things the old sampler got wrong for FEEL:
  //
  //   1) TRUE frame time. loop.js calls sampleFPS(dt) with the WORLD dt, which
  //      is clamped to 0.05 and further scaled by hit-stop/slow-mo. Under load
  //      (~0.2s/frame) that clamp makes the sampler think every frame is 50ms
  //      (= "20fps") no matter how bad it really is — so it can't tell a 5fps
  //      grind from a 20fps one and reacts to a LIE. V2 instead times its OWN
  //      performance.now() gaps between calls = the real wall-clock frame time.
  //
  //   2) STEADY BEATS SPIKY. A session whose MEAN fps looks ok but whose frames
  //      are spiky feels worse than a steady lower fps (frame-time consistency,
  //      not average, is what reads as smooth — Martin Fuller / Doug Binks DRS
  //      notes; askagamedev). V2 adds a step-DOWN trigger on the window's p95
  //      frame time (we reject the single worst outlier so a lone GC/upload
  //      hitch never nukes a tier), independent of the mean.
  //
  //   3) HOSTING COSTS. When this client is the elected sim-host it carries the
  //      whole NPC/traffic/physics world for the guests too — measurably more
  //      load than solo. V2 caps the eligible TOP tier one notch lower while
  //      hosting so a demo doesn't tank the host. Re-evaluated every window, so
  //      a mid-session host promotion/demotion (networld becomeHost) is handled
  //      with NO net hook here. Solo (net inactive → isHost()===false) is never
  //      biased — full fidelity preserved.
  //
  // React on a SHORTER window (0.5s) so a real slump is caught fast; keep the
  // up-step hysteresis STRONG (need several good windows) + a brief cooldown
  // after any down-step so we never ping-pong (DRS oscillation is itself felt
  // as stutter — ktcplay/Apex). Nothing here touches population, AI, sim dt or
  // any net hook: only the pre-existing pr/shadow/crowd-render/pedLOD knobs.
  if (CBZ.qualityV2 === undefined) CBZ.qualityV2 = true;

  // ---- MANUAL QUALITY LOCK (src/systems/settings.js) -----------------------
  // The settings panel lets a player pick a fixed tier instead of letting the
  // V2/legacy sampler drive it. CBZ.qualityLocked is the ONLY new piece of
  // state needed for that: when true, sampleFPS() below returns immediately
  // before touching qLevel, so a manual pick sticks until the player flips
  // back to Auto. Default false (=Auto) → untouched byte-identical sampler
  // behaviour for anyone who never opens the panel. CBZ.setQualityLevel is the
  // single entry point settings.js calls — it owns the qLevel write + the
  // applyQuality() call so the panel never has to poke qLevel directly.
  if (CBZ.qualityLocked === undefined) CBZ.qualityLocked = false;
  // (setQualityLevel is defined once above — shared by the pause slider and
  // the settings panel; it already clamps to the host-aware ceiling.)
  CBZ.getQualityLevel = function () { return qLevel; };
  CBZ.qualityTierCount = QUALITY.length;

  // host-aware eligible-top-tier cap. Live-evaluated so promotion is handled.
  function topTier() {
    let top = QUALITY.length - 1;
    if (CBZ.qualityV2) {
      let hosting = false;
      try { hosting = !!(CBZ.net && CBZ.net.isHost && CBZ.net.isHost()); } catch (e) {}
      if (hosting) top = Math.max(0, top - 1); // one notch down while hosting
    }
    return top;
  }
  CBZ.qualityTopTier = topTier; // exposed so the settings panel can grey out / cap its slider

  // ---- shadow-frustum info (for core/daynight.js's texel-snapped re-centering)
  // The ortho frustum's world-space WIDTH changes at runtime (city/mode.js and
  // modes/survival.js both widen it for their arenas), so this reads the LIVE
  // camera rect rather than caching the boot-time value — texel size must track
  // whatever frustum is actually active this frame. Returns a reused object
  // (called once/frame from onAlways(2); no allocation churn).
  const _shadowInfo = { width: 140, mapSize: 2048, texel: 140 / 2048 };
  CBZ.shadowFrustumInfo = function () {
    const cam = sun.shadow && sun.shadow.camera;
    const width = cam ? (cam.right - cam.left) : _shadowInfo.width;
    const mapSize = sun.shadow.mapSize.x || _shadowInfo.mapSize;
    _shadowInfo.width = width;
    _shadowInfo.mapSize = mapSize;
    _shadowInfo.texel = width / mapSize;
    return _shadowInfo;
  };

  function syncSliderUI() {
    const slider = document.getElementById("qualitySlider");
    const label = document.getElementById("qualityCurrentLabel");
    if (slider) slider.value = qLevel;
    if (label) label.textContent = QUALITY_LABELS[qLevel];
  }

  // ---- quality-change listener bus ----------------------------------------
  // Systems with tier-dependent state that can't just read CBZ.qScale live
  // every frame (fog ranges, InstancedMesh counts, receiveShadow flips…)
  // register here and get called after every tier change. Fired once at boot
  // too (via the applyQuality() below), so late registrants should self-apply
  // on registration if they need boot-time state.
  const qListeners = [];
  CBZ.onQualityChange = function (fn) { qListeners.push(fn); try { fn(qLevel); } catch (e) {} };

  function applyQuality() {
    const q = QUALITY[qLevel];
    CBZ.qualityLevel = qLevel;
    syncSliderUI();
    CBZ.crowdRenderBudget = q.crowd;
    if (CBZ.refreshCrowdBudget) CBZ.refreshCrowdBudget();
    CBZ.pedLOD = q.ped;
    if (CBZ.refreshPedLOD) CBZ.refreshPedLOD();
    renderer.setPixelRatio(q.pr);
    renderer.setSize(innerWidth, innerHeight);
    if (sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    // tier 0: kill the sun's shadow pass outright — this is the single biggest
    // GPU cost in the scene (a full shadow-map render every frame), way more
    // impactful than shrinking its resolution.
    sun.castShadow = q.sunShadow !== false;
    renderer.shadowMap.needsUpdate = true;
    // per-tier draw distance: city fog range + the farcull radius. Published
    // as plain numbers; city/mode.js reads cityFogFar on reset and
    // core/farcull.js reads cityCullRadius every sweep. Survival/prison fog
    // is owned per-frame by their own overrides — only the city consumes these.
    CBZ.cityFogFar = q.fog;
    CBZ.cityCullRadius = q.cull;
    if (CBZ.game && CBZ.game.mode === "city" && CBZ.scene && CBZ.scene.fog) {
      CBZ.scene.fog.far = q.fog;
      CBZ.scene.fog.near = Math.round(80 * q.fog / 430);   // keep today's 80/430 shape
    }
    for (const fn of qListeners) { try { fn(qLevel); } catch (e) { console.error("[quality listener]", e); } }
  }
  applyQuality();

  // rolling FPS sampler with hysteresis (no quality ping-pong)
  let _accum = 0, _frames = 0, _window = 0, _good = 0, _warmup = 1.5;

  // V2 state: true-frame-time timing + per-window spike tracking + cooldown.
  // _vPrev is the wall-clock timestamp of the previous sampleFPS call; the gap
  // between calls IS the true frame time (loop.js calls us once per frame, near
  // the top, BEFORE the world updates — so this is the full real frame delta).
  const V_WIN = 0.5;          // s — shorter window: catch a slump ~2× faster
  const V_FPS_DOWN = 50;      // mean-fps step-down threshold (matches old 50)
  const V_FPS_UP = 58;        // mean-fps step-up threshold (matches old 58)
  const V_GOOD_NEED = 4;      // up-step needs 4 good 0.5s windows (~2s) — strong
                              // hysteresis so we rise cautiously, never twitchy
  const V_SPIKE_MS = 90;      // p95 frame-time over this = "spiky" → step down
                              // even if the mean looks fine (steady beats spiky)
  const V_SPIKE_NEED = 2;     // need the spike condition in 2 windows running so
                              // one transient stall can't strip a tier
  let _vPrev = 0;             // performance.now() of last call (0 = uninit)
  let _vWorst = 0, _v2nd = 0; // worst + 2nd-worst true frame ms this window
                              // (p95 ≈ 2nd-worst → the single outlier is ignored)
  let _vCool = 0;             // step-up cooldown (windows) after any step-down
  let _vSpikeRun = 0;         // consecutive spiky windows

  function sampleFPS(dt) {
    // manual pin — user's choice, no auto-adjustment. Two flags feed this:
    // qualityAuto=false (pause-screen slider) and qualityLocked=true (settings
    // panel); either one wins over the auto-tuner.
    if (!CBZ.qualityAuto || CBZ.qualityLocked) return;

    // ---- legacy path (flag off) : EXACTLY today's behaviour ----------------
    if (!CBZ.qualityV2) {
      if (_warmup > 0) { _warmup -= dt; return; } // ignore first 1.5s of upload jank
      _accum += dt; _frames++; _window += dt;
      if (_window < 1) return;
      const fps = _frames / _accum;
      _accum = 0; _frames = 0; _window = 0;
      if (fps < 50 && qLevel > 0) { qLevel--; applyQuality(); _good = 0; }
      else if (fps >= 58) { if (++_good >= 3 && qLevel < QUALITY.length - 1) { qLevel++; applyQuality(); _good = 0; } }
      else { _good = 0; }
      return;
    }

    // ---- V2 path : true frame time + p95 spike trigger + host bias ---------
    const now = (typeof performance !== "undefined") ? performance.now() : Date.now();
    if (_vPrev === 0) { _vPrev = now; return; }   // first call: no prior stamp
    let trueMs = now - _vPrev;                     // REAL wall-clock frame time
    _vPrev = now;
    // Reject pathological gaps (tab-switch / debugger pause) so they neither
    // pollute the mean nor masquerade as a render spike — they're not the GPU.
    if (trueMs > 1000) trueMs = 0;                 // drop, don't count this frame
    if (trueMs <= 0) return;
    const trueDt = trueMs / 1000;

    if (_warmup > 0) { _warmup -= trueDt; return; } // first 1.5s upload jank

    _accum += trueDt; _frames++; _window += trueDt;
    // track worst + 2nd-worst frame this window for a cheap p95 (no array)
    if (trueMs > _vWorst) { _v2nd = _vWorst; _vWorst = trueMs; }
    else if (trueMs > _v2nd) { _v2nd = trueMs; }

    if (_window < V_WIN) return;
    const fps = _frames / _accum;
    const p95 = (_frames >= 4) ? _v2nd : 0;  // need a few frames for p95 to mean
                                             // anything; else don't spike-trigger
    const top = topTier();                   // host-aware eligible ceiling (live)
    // window done — reset accumulators
    _accum = 0; _frames = 0; _window = 0; _vWorst = 0; _v2nd = 0;
    if (_vCool > 0) _vCool--;

    // SPIKY? p95 frame time too high → the session reads as stutter even if the
    // mean is acceptable. Require it to persist (V_SPIKE_NEED) so a lone hitch
    // is forgiven; then step down once and arm the cooldown.
    const spiky = p95 > 0 && p95 > V_SPIKE_MS;
    if (spiky) _vSpikeRun++; else _vSpikeRun = 0;

    // 1) if we're above the host-aware ceiling, drop toward it immediately.
    if (qLevel > top) { qLevel--; applyQuality(); _good = 0; _vCool = 4; return; }

    // 2) mean too low → step down (fast, this is the primary guard).
    if (fps < V_FPS_DOWN && qLevel > 0) {
      qLevel--; applyQuality(); _good = 0; _vSpikeRun = 0; _vCool = 4; return;
    }

    // 3) steady-beats-spiky: sustained p95 spikes → shed a tier even if mean ok.
    if (_vSpikeRun >= V_SPIKE_NEED && qLevel > 0) {
      qLevel--; applyQuality(); _good = 0; _vSpikeRun = 0; _vCool = 6; return;
    }

    // 4) headroom → step UP, but only when smooth (mean high AND not spiky),
    //    not during the post-down cooldown, never above the host-aware ceiling.
    if (fps >= V_FPS_UP && !spiky && _vCool === 0) {
      if (++_good >= V_GOOD_NEED && qLevel < top) { qLevel++; applyQuality(); _good = 0; }
    } else {
      _good = 0;
    }
  }

  CBZ.sampleFPS = sampleFPS;

  // The pause-card quality slider was removed — systems/settings.js's panel is
  // the single performance surface and drives setQualityLevel directly.
  // syncSliderUI() above self-no-ops with the DOM gone.
})();
