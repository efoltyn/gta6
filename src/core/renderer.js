/* ============================================================
   core/renderer.js — WebGL renderer, mounted into #game
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,                 // MSAA — crisp edges on the blocky geometry
    powerPreference: "high-performance",
    stencil: false,                  // we never use the stencil buffer
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // softer shadow edges; res driven by core/quality.js
  // The sun creeps across the sky over a 150s day/night cycle, so the shadow
  // map barely changes frame-to-frame. Re-rendering the entire scene from the
  // light's POV every frame is wasted work — instead we drive updates manually
  // (see the throttle below), which reclaims a full shadow pass on most frames.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputEncoding = THREE.sRGBEncoding;

  document.getElementById("game").appendChild(renderer.domElement);

  CBZ.renderer = renderer;
  CBZ.canvas = renderer.domElement;

  // One scheduler owns shadow refreshes. Previously this file requested a
  // shadow pass every 2-3 frames while daynight.js independently requested one
  // whenever the player crossed a ~7cm shadow texel; together those paths often
  // restored a full shadow-scene render every frame. Wall-clock scheduling is
  // stable at any display refresh rate: 18Hz while moving, 10Hz while still.
  let shadowDirty = true;
  let shadowForce = true;
  let lastShadowMs = -Infinity;
  const shadowStats = CBZ.shadowUpdateStats = { requests: 0, forced: 0, commits: 0, movingCommits: 0 };
  CBZ.requestShadowUpdate = function (force) {
    shadowStats.requests++;
    shadowDirty = true;
    if (force) { shadowForce = true; shadowStats.forced++; }
  };
  CBZ.onAlways(1, function () {
    // A background tab can still receive very sparse animation callbacks on
    // some browsers. Do not spend one of those callbacks rebuilding a shadow
    // map; the elapsed interval guarantees an immediate refresh on return.
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return;
    if (!renderer.shadowMap.enabled || !CBZ.sun || !CBZ.sun.castShadow) return;
    const p = CBZ.player;
    const moving = !!(p && ((p.speed || 0) > 0.08 || Math.abs(p.vy || 0) > 0.08 || p.driving));
    const interval = 1000 / (moving ? 18 : 10);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Periodic refresh carries the slowly moving sun even when no producer is
    // dirty. Dirty producers still respect the same cap; force is reserved for
    // teleports, mode/tier changes and rebuilt geometry.
    if (!shadowForce && now - lastShadowMs < interval) return;
    if (shadowForce || shadowDirty || now - lastShadowMs >= interval) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
      shadowForce = false;
      lastShadowMs = now;
      shadowStats.commits++;
      if (moving) shadowStats.movingCommits++;
    }
  });

  addEventListener("resize", () => {
    CBZ.camera.aspect = innerWidth / innerHeight;
    CBZ.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
})();
