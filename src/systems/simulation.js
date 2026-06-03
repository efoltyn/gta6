/* ============================================================
   systems/simulation.js - bird's-eye mass-simulation console.

   B toggles a strategic overview. The close game keeps rendering every
   frame, but the overview switches the mass tier to one marker per agent.
   +/- accelerate or slow the worker-backed off-screen society clock.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const el = document.getElementById("simHud");
  if (!CBZ || !el) return;

  const W = CBZ.WORLD || { minX: -46, maxX: 46, minZ: -45, maxZ: 131 };
  const SPEEDS = [1, 4, 16, 64];
  const view = {
    active: false,
    x: (W.minX + W.maxX) * 0.5,
    z: (W.minZ + W.maxZ) * 0.5,
    height: 155,
    speedIndex: 0,
  };
  CBZ.simView = view;
  CBZ.simOverviewBudget = CBZ.SIM_OVERVIEW_BUDGET || 12000;

  // Dedicated layer-1 strategic map. The overview camera renders this cheap
  // board plus crowd markers instead of the detailed prison scene.
  const mapRoot = new THREE.Group();
  mapRoot.name = "simulation-map";
  CBZ.scene.add(mapRoot);
  function mapPlane(x, z, w, d, color) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0, z);
    m.layers.set(1);
    mapRoot.add(m);
    return m;
  }
  mapPlane((W.minX + W.maxX) * 0.5, (W.minZ + W.maxZ) * 0.5, W.maxX - W.minX + 10, W.maxZ - W.minZ + 10, 0x172130);
  mapPlane(0, -26, 34, 36, 0x3a4655);   // cell block
  mapPlane(0, 22, 60, 60, 0x53635f);    // north yard
  mapPlane(0, 90, 88, 76, 0x465768);    // south block

  // Zone-level overlays remain cheap at any population size. Their tint is
  // driven by worker CTMC state: blue is calm, red is unrest/pressure.
  function zoneOverlay(x, z, w, d) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color: 0x4b92ff, transparent: true, opacity: 0.12, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.08, z); m.layers.set(1); mapRoot.add(m);
    return m;
  }
  const zoneOverlays = [
    zoneOverlay(0, 22, 58, 58),
    zoneOverlay(0, 66, 42, 26),
    zoneOverlay(0, 102, 86, 48),
  ];
  // Portal flow guide: strategic movement is corridor/portal based, not a
  // claim that every distant person is physically steering every frame.
  const flowPos = new Float32Array([
    0, 0.16, -8,  0, 0.16, 52,   0, 0.16, 52,  0, 0.16, 80,
    0, 0.16, 80,  0, 0.16, 128,  -2, 0.16, 47,  0, 0.16, 52,
    2, 0.16, 47,   0, 0.16, 52,  -2, 0.16, 75,  0, 0.16, 80,
    2, 0.16, 75,   0, 0.16, 80,
  ]);
  const flowGeom = new THREE.BufferGeometry();
  flowGeom.setAttribute("position", new THREE.BufferAttribute(flowPos, 3));
  const flowLines = new THREE.LineSegments(flowGeom, new THREE.LineBasicMaterial({ color: 0x7de7ff, transparent: true, opacity: 0.72 }));
  flowLines.layers.set(1); mapRoot.add(flowLines);

  function setSpeedIndex(i) {
    view.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i | 0));
    const speed = SPEEDS[view.speedIndex];
    if (CBZ.crowdSociety) CBZ.crowdSociety.setSpeed(speed);
    return speed;
  }

  function setActive(on) {
    view.active = !!on && CBZ.game.mode === "escape";
    document.body.classList.toggle("sim-view", view.active);
    CBZ.camera.layers.set(view.active ? 1 : 0);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !view.active;
    for (const n of CBZ.npcs || []) if (n.group) n.group.visible = !view.active && !n.escaped;
    for (const g of CBZ.guards || []) if (g.group) g.group.visible = !view.active;
    if (CBZ.crowdSociety) {
      CBZ.crowdSociety.setOverview(view.active);
      CBZ.crowdSociety.snapshot();
    }
    if (CBZ.refreshCrowdBudget) CBZ.refreshCrowdBudget();
  }

  CBZ.setSimulationView = setActive;
  CBZ.toggleSimulationView = function () { setActive(!view.active); };
  CBZ.setSimulationSpeed = function (speed) {
    let best = 0;
    for (let i = 1; i < SPEEDS.length; i++) if (Math.abs(SPEEDS[i] - speed) < Math.abs(SPEEDS[best] - speed)) best = i;
    return setSpeedIndex(best);
  };

  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "u" && CBZ.game.mode === "escape") {   // B now opens the bag; sim-overview moved to U
      CBZ.toggleSimulationView();
      e.preventDefault();
    } else if (view.active && (e.key === "+" || e.key === "=")) {
      setSpeedIndex(view.speedIndex + 1);
      e.preventDefault();
    } else if (view.active && (e.key === "-" || e.key === "_")) {
      setSpeedIndex(view.speedIndex - 1);
      e.preventDefault();
    } else if (view.active && e.key === "0") {
      setSpeedIndex(0);
      e.preventDefault();
    } else if (view.active && k === "p") {
      CBZ.AB_TEST = CBZ.AB_TEST === "A" ? "B" : "A";
      console.log(`[A/B TEST] Toggled mode to: ${CBZ.AB_TEST}`);
      if (CBZ.refreshCrowdBudget) CBZ.refreshCrowdBudget();
      e.preventDefault();
    }
  });

  addEventListener("wheel", function (e) {
    if (!view.active) return;
    view.height = Math.max(48, Math.min(340, view.height + e.deltaY * 0.13));
    e.preventDefault();
  }, { passive: false });

  function n(v) { return Math.round(v || 0).toLocaleString(); }
  let hudAcc = 0;
  CBZ.onAlways(49, function (dt) {
    if (!view.active) return;
    const keys = CBZ.keys || {};
    const pan = view.height * 0.48 * dt;
    if (keys["w"] || keys["arrowup"]) view.z -= pan;
    if (keys["s"] || keys["arrowdown"]) view.z += pan;
    if (keys["a"] || keys["arrowleft"]) view.x -= pan;
    if (keys["d"] || keys["arrowright"]) view.x += pan;
    view.x = Math.max(W.minX - 24, Math.min(W.maxX + 24, view.x));
    view.z = Math.max(W.minZ - 24, Math.min(W.maxZ + 24, view.z));

    hudAcc += dt;
    if (hudAcc < 0.18) return;
    hudAcc = 0;
    const crowd = CBZ.crowdStats || {};
    const society = CBZ.crowdSociety ? CBZ.crowdSociety.stats : {};
    const perf = CBZ.crowdPerformance || { simTimeMs: 0, renderTimeMs: 0 };
    const currentModeName = CBZ.AB_TEST === "A" ? "Standard (OoA Boxes)" : "Scaled SoA (GPU Points)";
    const zones = society.zones || {}, unrest = zones.unrest || [], pressure = zones.pressure || [];
    let unrestAvg = 0, pressureAvg = 0;
    for (let i = 0; i < zoneOverlays.length; i++) {
      const u = unrest[i] || 0, p = pressure[i] || 0, heat = Math.min(1, u * 0.66 + p * 0.72);
      zoneOverlays[i].material.color.setRGB(0.18 + heat * 0.82, 0.52 - heat * 0.34, 0.98 - heat * 0.72);
      zoneOverlays[i].material.opacity = 0.08 + heat * 0.28;
      unrestAvg += u; pressureAvg += p;
    }
    unrestAvg /= zoneOverlays.length; pressureAvg /= zoneOverlays.length;

    el.innerHTML =
      '<div class="sim-title">Mass Simulation</div>' +
      `<div class="sim-sub">Active Mode: <b style="color: #39ff88">${currentModeName}</b></div>` +
      `<div class="sim-sub">Resolution: <b>${crowd.mode === "density" ? "Density cells" : "Individual markers"}</b></div>` +
      `<div class="sim-sub">Clock speed: <b>${society.timeScale || 1}x</b></div>` +
      '<div class="sim-grid">' +
        `<span>Population</span><b>${n(crowd.total)}</b>` +
        `<span>Map markers</span><b>${n(crowd.visible)}</b>` +
        `<span>Close steering</span><b>${n(crowd.active)}</b>` +
        `<span>Sim CPU Cost</span><b style="color: #ff5b5b">${perf.simTimeMs.toFixed(3)} ms</b>` +
        `<span>Render CPU Cost</span><b style="color: #5b8bff">${perf.renderTimeMs.toFixed(3)} ms</b>` +
        `<span>Worker ticks</span><b>${n(society.simTicks)}</b>` +
        `<span>Interactions</span><b>${n(society.interactions)}</b>` +
        `<span>Conflicts</span><b>${n(society.conflicts)}</b>` +
        `<span>Injuries</span><b>${n(society.injuries)}</b>` +
        `<span>Event queue</span><b>${n(society.queuedEvents)}</b>` +
        `<span>Unrest</span><b>${Math.round(unrestAvg * 100)}%</b>` +
        `<span>Faction pressure</span><b>${Math.round(pressureAvg * 100)}%</b>` +
      '</div>' +
      `<div class="sim-worker">${society.worker ? "Parallel worker active" : "Main-thread fallback"} · ${n(society.hidden)} off-screen minds</div>` +
      '<div class="sim-help"><b>B</b> close view · <b>WASD</b> pan · <b>P</b> toggle A/B test · <b>Wheel</b> altitude · <b>+/-</b> time</div>';
  });
})();
