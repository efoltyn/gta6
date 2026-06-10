/* ============================================================
   core/quality.js — adaptive quality ("smoothmaxx").
   Auto-scales render resolution + shadow detail to hold ~60fps on
   any GPU. Strong devices get full-res crisp shadows; weak ones step
   down quietly instead of dropping frames, and step back up when
   there's headroom — nothing is permanently nerfed.
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
  const QUALITY = [
    { pr: 0.6, shadow: 512,  crowd: 220,  ped: { vis: 55,  shadow: 0  } },  // 0 — emergency: rigs close-only, no rig shadows
    { pr: 0.8, shadow: 1024, crowd: 360,  ped: { vis: 70,  shadow: 28 } },  // 1
    { pr: 1.0, shadow: 1024, crowd: 520,  ped: { vis: 85,  shadow: 38 } },  // 2
    { pr: Math.min(devicePixelRatio, 1.25), shadow: 2048, crowd: 720,  ped: { vis: 95,  shadow: 42 } },  // 3
    { pr: Math.min(devicePixelRatio, 1.5),  shadow: 2048, crowd: 1000, ped: { vis: 110, shadow: 50 } },  // 4 — full fat
  ];
  let qLevel = QUALITY.length - 1; // start optimistic; only fall if needed

  function applyQuality() {
    const q = QUALITY[qLevel];
    CBZ.qualityLevel = qLevel;
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
    renderer.shadowMap.needsUpdate = true;
  }
  applyQuality();

  // rolling 1s FPS sampler with hysteresis (no quality ping-pong)
  let _accum = 0, _frames = 0, _window = 0, _good = 0, _warmup = 1.5;
  function sampleFPS(dt) {
    if (_warmup > 0) { _warmup -= dt; return; } // ignore first 1.5s of upload jank
    _accum += dt; _frames++; _window += dt;
    if (_window < 1) return;
    const fps = _frames / _accum;
    _accum = 0; _frames = 0; _window = 0;
    if (fps < 50 && qLevel > 0) { qLevel--; applyQuality(); _good = 0; }
    else if (fps >= 58) { if (++_good >= 3 && qLevel < QUALITY.length - 1) { qLevel++; applyQuality(); _good = 0; } }
    else { _good = 0; }
  }

  CBZ.sampleFPS = sampleFPS;
})();
