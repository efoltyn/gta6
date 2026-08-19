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
    warm(r, sc, cam);
  });

  /* ==================================================================
     WHY THIS IS NOT JUST `r.compile(sc, cam)` IN A TRY/CATCH ANY MORE.

     `renderer.compile` walks the scene with `scene.traverse` and, for every
     object, calls `properties.get(material)` — and `WebGLProperties` is a raw
     `WeakMap`. A WeakMap key MUST be an object, so the instant it reaches a
     mesh whose `.material` is a raw colour INTEGER instead of a Material, it
     throws `TypeError: Invalid value used as weak map key`.

     THE BLAST RADIUS IS THE PART THAT WAS MISSED. `traverse` is depth-first
     and the throw unwinds the WHOLE walk — so the first bad material does not
     merely fail to warm itself, it ABORTS PREWARMING FOR EVERY OBJECT AFTER IT
     IN TRAVERSAL ORDER. The old body was `try { r.compile(sc, cam); } catch
     (e) {}`: completely silent. So the loss was never even 29% of the scene
     with certainty — it was "everything after the first offender", and nobody
     could tell, because the catch printed nothing for however long it was live.

     THE FIX IS TO MAKE THE WALK ANTIFRAGILE, not to chase the current
     offenders. Before compiling we swap a shared dummy Material over anything
     whose `.material` is not a Material, compile, then restore. `compile()`
     never renders a frame, so the swap is invisible by construction. A future
     bad material costs one warning line instead of the rest of the scene.

     r128 NOTE, checked against the vendored source: `compileAsync` and
     `KHR_parallel_shader_compile` do not exist here — they landed in r158, 30
     revisions later — so this is synchronous by necessity, not by choice.
     `renderer.info.programs` and `renderer.properties` ARE public in r128,
     which is what makes the audit below possible without patching three.js.
     ================================================================== */
  let DUMMY = null;
  let lastReport = null;

  function warm(r, sc, cam) {
    const THREE = window.THREE;
    if (!DUMMY && THREE) { DUMMY = new THREE.MeshBasicMaterial({ color: 0x808080 }); DUMMY._fxwarmDummy = true; }
    const swapped = [];
    let bad = 0;
    try {
      sc.traverse(function (o) {
        if (!o || !("material" in o) || !o.material) return;
        const m = o.material;
        if (Array.isArray(m)) {
          let dirty = false;
          for (let i = 0; i < m.length; i++) if (!m[i] || !m[i].isMaterial) dirty = true;
          if (dirty) { bad++; swapped.push([o, m]); o.material = DUMMY; }
          return;
        }
        if (!m.isMaterial) { bad++; swapped.push([o, m]); o.material = DUMMY; }
      });
    } catch (e) {
      try { console.warn("[fxwarm] material scan failed:", e && e.message); } catch (e2) {}
    }
    let err = null;
    try { r.compile(sc, cam); } catch (e) { err = e; }
    for (let i = 0; i < swapped.length; i++) swapped[i][0].material = swapped[i][1];
    // LOUD, ONCE. The whole reason this bug survived is that its predecessor
    // said nothing at all.
    if (bad || err) {
      try {
        console.warn("[fxwarm] " + bad + " object(s) carry a non-Material `.material` (a raw colour?) · " +
          "they were swapped for a dummy so the prewarm walk could finish" +
          (err ? "; compile still threw: " + (err && err.message) : ""));
      } catch (e2) {}
    }
    lastReport = { badMaterials: bad, threw: !!err, programs: (r.info && r.info.programs && r.info.programs.length) || 0 };
  }

  /* THE RATCHET. `renderer.properties` is public in r128, and a material that
     was actually compiled has a non-empty `programs` set on its property
     record — so "how much of the scene never got warmed" stops being a guess.
     `unwarmed` and `badMaterials` both belong at 0. `programs` is evidence:
     it is the count of unique SHADER PERMUTATIONS, and permutations are keyed
     on a ~50-field tuple that includes the exact COUNTS of each light type —
     so a world with dynamic lighting can still compile fresh programs after
     boot, and a rising number here is the thing to look at if a stutter
     survives this fix. */
  CBZ.fxWarmAudit = function () {
    const r = CBZ.renderer, sc = CBZ.scene;
    const out = { materials: 0, unwarmed: 0, badMaterials: 0, programs: 0, warmedMode: warmed };
    if (!r || !sc) return out;
    out.programs = (r.info && r.info.programs && r.info.programs.length) || 0;
    if (lastReport) out.badMaterials = lastReport.badMaterials;
    const seen = new Set();
    try {
      sc.traverse(function (o) {
        if (!o || !("material" in o) || !o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (!m) continue;
          if (!m.isMaterial) { out.badMaterials++; continue; }
          if (seen.has(m)) continue;
          seen.add(m);
          out.materials++;
          let p = null;
          try { p = r.properties && r.properties.get(m); } catch (e) { p = null; }
          if (!p || !p.programs || !p.programs.size) out.unwarmed++;
        }
      });
    } catch (e) {}
    return out;
  };
})();
