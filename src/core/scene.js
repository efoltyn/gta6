/* ============================================================
   core/scene.js — the Three.js scene + camera + atmospheric fog
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const scene = new THREE.Scene();
  // soft blue-grey haze so far walls melt into the sky. Pushed back so the
  // much larger compound (the south block sits ~180u from the cell wing)
  // stays legible instead of vanishing into haze.
  scene.fog = new THREE.Fog(0xbfe0ff, 95, 360);

  const camera = new THREE.PerspectiveCamera(
    62, innerWidth / innerHeight, 0.1, 1000
  );
  // Camera children are used for first-person viewmodels.
  scene.add(camera);

  // Prison content used to be attached directly to the global scene. That
  // meant every guard, inmate and prison prop was still submitted while the
  // city was active (and the prison collider/render world leaked into the
  // other modes). Give the jail one ownership root, matching the city and
  // survival arenas, so a mode switch can reject the entire subtree at once.
  const prisonRoot = new THREE.Group();
  prisonRoot.name = "prison-world";
  scene.add(prisonRoot);

  CBZ.scene = scene;
  CBZ.camera = camera;
  CBZ.prisonRoot = prisonRoot;
})();
