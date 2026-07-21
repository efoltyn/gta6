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
  // fog  = city fog.far per tier (near scales with it). These are honest view
  //        distances: the world has real distant buildings/coast/terrain now,
  //        so fog is atmosphere rather than a curtain hiding fake skyline art.
  // cull = FULL-DETAIL radius for static city groups (core/farcull.js); beyond
  //        it real buildings continue as one measured instanced skyline draw,
  //        while invisible rooms/windows stop consuming thousands of calls.
  const QUALITY = [
    // Even emergency mode remains legible. The city is dominated by draw
    // submission/shadow work, so crushing DPR to 0.28 blurred the image without
    // reliably moving the bottleneck. Emergency instead disables the sun pass
    // and trims render distance/actors while keeping a sane resolution floor.
    { pr: 0.72, shadow: 512, crowd: 180,  ped: { vis: 45,  shadow: 0  }, sunShadow: false, fog: 420,  cull: 230 },  // 0 — emergency
    { pr: 0.85, shadow: 1024, crowd: 360, ped: { vis: 70,  shadow: 28 }, fog: 580,  cull: 300 },  // 1
    { pr: 1.0, shadow: 1024, crowd: 520,  ped: { vis: 85,  shadow: 38 }, fog: 760,  cull: 390 },  // 2
    // The actor visibility leak used to spend ~2.3k calls before the scenery
    // was considered. With that fixed, High/Best can show the real skyline and
    // landforms while farcull still rejects geometry only after it is fogged.
    // Aircraft use a wider full-detail bubble and the same measured proxies.
    { pr: Math.min(devicePixelRatio, 1.25), shadow: 2048, crowd: 720,  ped: { vis: 95,  shadow: 42 }, fog: 1000, cull: 500 },  // 3
    { pr: Math.min(devicePixelRatio, 1.5),  shadow: 2048, crowd: 1000, ped: { vis: 110, shadow: 50 }, fog: 1400, cull: 700 },  // 4 — full world
  ];
  const QUALITY_LABELS = ["Fastest", "Fast", "Balanced", "High", "Best"];
  // A fresh session is a first impression, not a benchmark screen. Starting at
  // the emergency tier hid most of the archipelago behind a 170m fog wall and
  // made the aerial world look unfinished until the tuner slowly climbed up.
  // Start from the coherent High presentation; the adaptive sampler still
  // steps down immediately when a device genuinely needs it.
  let qLevel = 3;
  // Changing DPR/shadow storage can itself hitch. Do not feed that transition
  // back into the sampler and trigger a downgrade cascade.
  let qualitySettlingUntil = 0;

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
  // Owner-facing shadow override (auto|off|low|high) — re-applies live so a
  // settings toggle or console call takes effect without a reload. applyQuality
  // (hoisted below) owns the actual sun.castShadow / mapSize write.
  CBZ.setShadowMode = function (mode) {
    CBZ.CONFIG = CBZ.CONFIG || {};
    CBZ.CONFIG.CITY_SHADOW_MODE = mode;
    try { applyQuality(); } catch (e) { console.error("[setShadowMode]", e); }
    return CBZ.CONFIG.CITY_SHADOW_MODE;
  };

  // ---- QUALITY-V2 (smarter FEEL-aware tier control) -----------------------
  // Gated behind CBZ.qualityV2 (default ON). When OFF we retain the legacy
  // visible-frame sampler, with the same background-visibility safety guard.
  // V2 fixes three things the old sampler got wrong for FEEL:
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
    // Hosting is measured by the same frame sampler as everything else. A good
    // GPU must not be denied Best quality merely because this client is host.
    return QUALITY.length - 1;
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
    // Three r128 setPixelRatio() already reapplies the cached logical size.
    // A second setSize() repeated the drawing-buffer reset/allocation work.
    // Shadow policy: the quality tier sets the baseline (tier 0 kills the sun
    // shadow outright — a full shadow-map render every frame is the single
    // biggest GPU cost, way more impactful than shrinking its resolution). The
    // owner-facing CBZ.CONFIG.CITY_SHADOW_MODE then OVERRIDES it without dropping
    // the whole tier, so shadows can be tuned in isolation (the #2 GPU cost per
    // the round-3 teardown). Keep the PCFSoft type fixed — flipping shadowMap.type
    // at runtime would force a recompile of every material (39k of them).
    let wantShadow = q.sunShadow !== false, wantMap = q.shadow;
    const smode = CBZ.CONFIG && CBZ.CONFIG.CITY_SHADOW_MODE;
    if (smode === "off") wantShadow = false;
    else if (smode === "low") { wantShadow = true; wantMap = Math.min(wantMap, 1024); }
    else if (smode === "high") { wantShadow = true; wantMap = 2048; }
    if (sun.shadow.mapSize.x !== wantMap) {
      sun.shadow.mapSize.set(wantMap, wantMap);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    sun.castShadow = wantShadow;
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
    else renderer.shadowMap.needsUpdate = true;
    // per-tier draw distance: city fog range + the farcull radius. Published
    // as plain numbers; city/mode.js reads cityFogFar on reset and
    // core/farcull.js reads cityCullRadius every sweep. Survival/prison fog
    // is owned per-frame by their own overrides — only the city consumes these.
    CBZ.cityFogFar = q.fog;
    CBZ.cityCullRadius = q.cull;
    if (CBZ.game && CBZ.game.mode === "city" && CBZ.scene && CBZ.scene.fog) {
      CBZ.scene.fog.far = q.fog;
      CBZ.scene.fog.near = Math.max(90, Math.round(q.fog * 0.16));
    }
    for (const fn of qListeners) { try { fn(qLevel); } catch (e) { console.error("[quality listener]", e); } }
    const stamp = typeof performance !== "undefined" ? performance.now() : Date.now();
    qualitySettlingUntil = stamp + 800;
  }
  applyQuality();

  // rolling FPS sampler with hysteresis (no quality ping-pong)
  let _accum = 0, _frames = 0, _window = 0, _good = 0, _warmup = 1.5;

  // V2 state: true-frame-time timing + per-window spike tracking + cooldown.
  // _vPrev is the wall-clock timestamp of the previous sampleFPS call; the gap
  // between calls IS the true frame time (loop.js calls us once per frame, near
  // the top, BEFORE the world updates — so this is the full real frame delta).
  const V_WIN = 0.75;         // s — enough frames to distinguish load from a hitch
  const V_FPS_DOWN = 50;      // mean-fps step-down threshold (matches old 50)
  const V_FPS_UP = 58;        // mean-fps step-up threshold (matches old 58)
  const V_GOOD_NEED = 4;      // up-step needs 4 good 0.75s windows (~3s) — strong
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
  let _vBadRun = 0;           // sustained mean-load windows (one is never enough)
  let _vEmergencyRun = 0;     // very-low-fps windows before tier 0 is allowed
  let _vLongRun = 0;          // consecutive visible >250ms frames (real severe load)

  function resetVWindow(resetPrev) {
    _accum = 0; _frames = 0; _window = 0; _vWorst = 0; _v2nd = 0;
    if (resetPrev) _vPrev = 0;
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      resetVWindow(true);
      _vBadRun = 0; _vEmergencyRun = 0; _vSpikeRun = 0; _vLongRun = 0; _good = 0;
    });
  }

  function sampleFPS(dt) {
    // manual pin — user's choice, no auto-adjustment. Two flags feed this:
    // qualityAuto=false (pause-screen slider) and qualityLocked=true (settings
    // panel); either one wins over the auto-tuner.
    if (!CBZ.qualityAuto || CBZ.qualityLocked) return;
    // Visibility is a correctness guard for both V2 and the opt-in legacy
    // sampler. Some browsers deliver sparse background callbacks; accumulating
    // those as render frames would manufacture a low-FPS window.
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") {
      resetVWindow(true);
      _vBadRun = 0; _vEmergencyRun = 0; _vSpikeRun = 0; _vLongRun = 0; _good = 0;
      return;
    }

    // ---- legacy path (flag off): original visible-frame timing --------------
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
    // A tier's own drawing-buffer/shadow-map realloc must not feed back into
    // another downgrade. Likewise, a multi-second debugger/tab gap is not GPU
    // load (hidden documents were already rejected above).
    if (trueMs <= 0 || trueMs > 5000 || now < qualitySettlingUntil) {
      resetVWindow(false);
      _vLongRun = 0;
      return;
    }
    const trueDt = trueMs / 1000;

    // Advance warmup with a capped wall delta so a genuinely slow machine can
    // eventually leave warmup, without letting one loading pause consume it.
    if (_warmup > 0) { _warmup -= Math.min(trueDt, 0.25); resetVWindow(false); return; }

    // One 250-5000ms frame is a load/GC/debugger hitch and is ignored. Three in
    // succession while the document is visible is unambiguously sustained,
    // severe load; step only one tier, then let applyQuality's settle window
    // absorb the resize. This closes the old <4fps blind spot without allowing
    // a single hitch to cascade through quality levels.
    if (trueMs > 250) {
      resetVWindow(false);
      _vBadRun = 0; _vSpikeRun = 0; _good = 0;
      _vLongRun++;
      CBZ.qualityAutoStats = { fps: 1000 / trueMs, p95: trueMs, level: qLevel, longFrames: _vLongRun };
      if (_vLongRun >= 3 && qLevel > 0) {
        qLevel--; applyQuality(); _vCool = 4; _vEmergencyRun = 0; _vLongRun = 0;
      }
      return;
    }
    _vLongRun = 0;

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
    CBZ.qualityAutoStats = { fps, p95, level: qLevel, badWindows: _vBadRun, emergencyWindows: _vEmergencyRun };

    // SPIKY? p95 frame time too high → the session reads as stutter even if the
    // mean is acceptable. Require it to persist (V_SPIKE_NEED) so a lone hitch
    // is forgiven; then step down once and arm the cooldown.
    const spiky = p95 > 0 && p95 > V_SPIKE_MS;
    if (spiky) _vSpikeRun++; else _vSpikeRun = 0;

    // 1) if we're above the host-aware ceiling, drop toward it immediately.
    if (qLevel > top) { qLevel--; applyQuality(); _good = 0; _vCool = 4; return; }

    if (fps < V_FPS_DOWN) _vBadRun++; else _vBadRun = 0;
    if (fps < 22) _vEmergencyRun++; else _vEmergencyRun = 0;

    // 2) sustained mean load. Auto quality normally stops at Balanced: a
    // 30/40Hz display or CPU-bound draw stream should not destroy presentation
    // chasing an impossible 60. Fast is allowed below 28fps; the shadow-off
    // emergency tier requires four genuinely dire windows below 22fps.
    let autoFloor = fps < 28 ? 1 : 2;
    if (fps < 22 && _vEmergencyRun >= 4) autoFloor = 0;
    if (_vBadRun >= 2 && qLevel > autoFloor) {
      qLevel--; applyQuality(); _good = 0; _vSpikeRun = 0; _vCool = 4; _vBadRun = 0; return;
    }

    // 3) steady-beats-spiky: sustained p95 spikes → shed a tier even if mean ok.
    if (_vSpikeRun >= V_SPIKE_NEED && qLevel > 2) {
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
