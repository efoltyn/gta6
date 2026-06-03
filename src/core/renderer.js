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

  // Refresh the shadow map below frame rate. At the sun's angular speed this
  // is visually close to per-frame shadows but avoids a duplicate scene pass
  // on most frames. Lower adaptive-quality tiers use a gentler cadence.
  let _shadowTick = 0;
  CBZ.onAlways(1, function () {
    const stride = CBZ.qualityLevel != null && CBZ.qualityLevel < 2 ? 3 : 2;
    if ((_shadowTick++ % stride) === 0) renderer.shadowMap.needsUpdate = true;
  });

  addEventListener("resize", () => {
    CBZ.camera.aspect = innerWidth / innerHeight;
    CBZ.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
})();
