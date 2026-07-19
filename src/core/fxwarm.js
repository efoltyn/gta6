/* ============================================================
   core/fxwarm.js — play-start SHADER/FX PREWARM (the first-rocket freeze).

   three.js r128 compiles a material's GLSL program the FIRST time an object
   using it is actually RENDERED — and every combat-FX pool in this game
   (muzzle flashes, tracer lines, rocket smoke, explosion point-bursts,
   fireball/smoke sprites) sits parked visible=false until the first shot.
   Their programs therefore used to compile SYNCHRONOUSLY mid-fight: on iPad
   Safari several compileShader/linkProgram calls stacked into the first
   fire/impact frame — a multi-hundred-ms freeze, "sometimes" because it is
   exactly once per session (per program variant).

   renderer.compile(scene, camera) walks the scene with traverse() — NOT
   traverseVisible() — initializing programs for INVISIBLE objects too, which
   is exactly what a hidden pool needs. Run it once per mode entry on the
   first playing frame (the play-start transition beat, where a one-time cost
   is invisible; quality.js's governor also ignores this warmup window), after
   the sibling prewarm blocks in crashfx/gunfx/gore have parked every
   once-lazy pool object in the scene at load.

   Cost: one scene traverse + only the not-yet-compiled programs (already-
   compiled materials are cache hits). Feature-detected everywhere; a stub
   renderer without .compile silently skips. No flag: this only moves work
   that was already guaranteed to happen from mid-fight to the load beat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  let warmed = "";                 // mode we last compiled for ("" = never)
  CBZ.onAlways(1.2, function () {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return;
    const key = g.mode || "?";
    if (key === warmed) return;
    warmed = key;                  // one attempt per mode entry, success or not
    const r = CBZ.renderer, sc = CBZ.scene, cam = CBZ.camera;
    if (!r || typeof r.compile !== "function" || !sc || !cam) return;
    try { r.compile(sc, cam); } catch (e) {}
  });
})();
