/* ============================================================
   core/profile.js - query-gated city performance benchmark.

   Enable with:
     ?profile=1&scenario=calm&seconds=12
     ?profile=1&scenario=wanted5&seconds=12
     ?profile=1&scenario=chaos&seconds=12

   Normal sessions return immediately and pay no frame-time cost.
============================================================ */
(function () {
  "use strict";
  if (typeof location === "undefined" || !/(?:\?|&)profile=1(?:&|$)/.test(location.search || "")) return;
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const params = new URLSearchParams(location.search);
  const scenario = params.get("scenario") || "calm";
  const seconds = Math.max(4, Math.min(60, Number(params.get("seconds")) || 12));
  const targetFrames = Math.max(30, Math.min(1800, Number(params.get("frames")) || 180));
  let startedAt = performance.now(), measuring = false;
  const errors = [], longFrames = [], frameTimes = [];
  const glitches = {
    nanActors: 0, nearInvisiblePeds: 0, outOfBoundsActors: 0,
    carOverlaps: 0, duplicateColliders: 0,
  };
  const updaterStats = [], alwaysStats = [];
  let renderStats = { calls: 0, triangles: 0, points: 0, lines: 0, samples: 0, cpu: 0, peakCpu: 0 };
  let prevFrame = 0, finished = false, scanTimer = 0;

  function statFor(entry, kind, index) {
    return {
      kind, index, order: entry.order, source: entry.source || "",
      calls: 0, total: 0, peak: 0, over2ms: 0,
    };
  }

  function wrapEntries(entries, kind, stats) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], original = entry.fn, stat = statFor(entry, kind, i);
      stats.push(stat);
      entry.fn = function (dt) {
        const t0 = performance.now();
        try { return original(dt); }
        finally {
          const ms = performance.now() - t0;
          if (measuring) {
            stat.calls++; stat.total += ms;
            if (ms > stat.peak) stat.peak = ms;
            if (ms > 2) stat.over2ms++;
          }
        }
      };
    }
  }

  wrapEntries(CBZ.updaters, "update", updaterStats);
  wrapEntries(CBZ.always, "always", alwaysStats);

  const originalRender = CBZ.renderer && CBZ.renderer.render && CBZ.renderer.render.bind(CBZ.renderer);
  if (originalRender) {
    CBZ.renderer.render = function (scene, camera) {
      const t0 = performance.now();
      const result = originalRender(scene, camera);
      const ms = performance.now() - t0;
      if (!measuring) return result;
      renderStats.cpu += ms; renderStats.samples++;
      if (ms > renderStats.peakCpu) renderStats.peakCpu = ms;
      const r = CBZ.renderer.info && CBZ.renderer.info.render;
      if (r) {
        renderStats.calls += r.calls || 0;
        renderStats.triangles += r.triangles || 0;
        renderStats.points += r.points || 0;
        renderStats.lines += r.lines || 0;
      }
      return result;
    };
  }

  const originalRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return originalRAF(function (t) {
      if (measuring && prevFrame) {
        const ms = t - prevFrame;
        frameTimes.push(ms);
        if (ms >= 25) longFrames.push(ms);
      }
      cb(t);
      if (measuring) {
        prevFrame = t;
        if (!finished && t - scanTimer > 1000) { scanTimer = t; scanGlitches(); }
        if (!finished && frameTimes.length >= targetFrames) finish();
      }
    });
  };

  addEventListener("error", function (e) {
    errors.push(String((e && (e.error && e.error.stack || e.message)) || "window error"));
  });
  addEventListener("unhandledrejection", function (e) {
    errors.push(String((e && e.reason && (e.reason.stack || e.reason)) || "unhandled rejection"));
  });

  function finitePos(actor) {
    const p = actor && actor.pos;
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  }

  function scanGlitches() {
    const P = CBZ.player && CBZ.player.pos;
    const peds = CBZ.cityPeds || [], cops = CBZ.cityCops || [], cars = CBZ.cityCars || [];
    const actors = peds.concat(cops);
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!finitePos(a)) { glitches.nanActors++; continue; }
      if (Math.abs(a.pos.x) > 5000 || Math.abs(a.pos.z) > 5000) glitches.outOfBoundsActors++;
      if (P && a.group && a.enterT <= 0 && !a.dead) {
        const dx = a.pos.x - P.x, dz = a.pos.z - P.z;
        if (dx * dx + dz * dz < 15 * 15 && a.group.visible === false) glitches.nearInvisiblePeds++;
      }
    }
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (!finitePos(a)) { glitches.nanActors++; continue; }
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j]; if (!finitePos(b)) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz < 0.35) glitches.carOverlaps++;
      }
    }
  }

  function sceneCounts() {
    const counts = { objects: 0, meshes: 0, instancedMeshes: 0, visibleMeshes: 0, groups: 0, lights: 0, sprites: 0 };
    if (!CBZ.scene || !CBZ.scene.traverse) return counts;
    CBZ.scene.traverse(function (o) {
      counts.objects++;
      if (o.isMesh) { counts.meshes++; if (o.visible) counts.visibleMeshes++; }
      if (o.isInstancedMesh) counts.instancedMeshes++;
      if (o.isGroup) counts.groups++;
      if (o.isLight) counts.lights++;
      if (o.isSprite) counts.sprites++;
    });
    return counts;
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }

  function ranked(stats) {
    return stats.filter(function (s) { return s.calls; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 30).map(function (s) {
      return {
        kind: s.kind, order: s.order, source: s.source, calls: s.calls,
        totalMs: +s.total.toFixed(2), avgMs: +(s.total / s.calls).toFixed(4),
        peakMs: +s.peak.toFixed(3), over2ms: s.over2ms,
      };
    });
  }

  function colliderDuplicates() {
    const cols = CBZ.colliders || [], seen = new Set(), dups = new Set();
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const key = [c.minX, c.maxX, c.minZ, c.maxZ, c.y0 == null ? "" : c.y0, c.y1 == null ? "" : c.y1].join("|");
      if (seen.has(key)) dups.add(key); else seen.add(key);
    }
    return dups.size;
  }

  // Query-only render attribution. These extra renders run after measurement
  // has finished and temporarily hide one category at a time, so normal play
  // pays nothing and the report can distinguish a static-world draw-call
  // problem from peds/cars/crowd without guessing.
  function renderAttribution() {
    if (!originalRender || !CBZ.scene || !CBZ.camera) return null;
    const renderer = CBZ.renderer;
    const shadowEnabled = renderer.shadowMap.enabled;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    function sample(hidden) {
      const old = [];
      for (let i = 0; i < hidden.length; i++) {
        const o = hidden[i]; if (!o) continue;
        old.push([o, o.visible]); o.visible = false;
      }
      originalRender(CBZ.scene, CBZ.camera);
      const r = renderer.info && renderer.info.render;
      const out = r ? { calls: r.calls || 0, triangles: r.triangles || 0 } : null;
      for (let i = 0; i < old.length; i++) old[i][0].visible = old[i][1];
      return out;
    }
    const peds = (CBZ.cityPeds || []).concat(CBZ.cityCops || []).map(function (p) { return p && p.group; }).filter(Boolean);
    const cars = (CBZ.cityCars || []).map(function (c) { return c && c.group; }).filter(Boolean);
    const crowd = CBZ.scene.getObjectByName ? CBZ.scene.getObjectByName("city-crowd") : null;
    const cityRoot = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    const allDynamic = peds.concat(cars); if (crowd) allDynamic.push(crowd);
    const result = {
      full: sample([]),
      withoutPedsAndCops: sample(peds),
      withoutCars: sample(cars),
      withoutAmbientCrowd: sample(crowd ? [crowd] : []),
      withoutCityDynamic: sample(allDynamic),
      withoutCityRoot: sample(cityRoot ? [cityRoot] : []),
    };
    renderer.shadowMap.enabled = shadowEnabled;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = true;
    return result;
  }

  // Query-only census explaining WHY the city root still costs draw calls after
  // the static batcher runs. Counts are non-exclusive: a textured interactive
  // mesh appears in both buckets. Repeated geometry/material pairs are the
  // strongest candidates for the next instancing A/B.
  function cityRootCensus() {
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (!root || !root.traverse) return null;
    const los = new Set(CBZ.losBlockers || []);
    const colRefs = new Set(), platformRefs = new Set();
    const knownDynamic = new Set();
    for (const c of (CBZ.colliders || [])) if (c && c.ref) colRefs.add(c.ref);
    for (const p of (CBZ.platforms || [])) if (p && p.ref) platformRefs.add(p.ref);
    const actorRoots = (CBZ.cityPeds || []).concat(CBZ.cityCops || [], CBZ.cityCars || [])
      .map(function (a) { return a && a.group; }).filter(Boolean);
    const crowdRoot = CBZ.scene.getObjectByName ? CBZ.scene.getObjectByName("city-crowd") : null;
    if (crowdRoot) actorRoots.push(crowdRoot);
    for (let i = 0; i < actorRoots.length; i++) actorRoots[i].traverse(function (o) { if (o.isMesh) knownDynamic.add(o); });
    const counts = {
      meshes: 0, visibleMeshes: 0, instanced: 0, textured: 0, transparent: 0,
      emissive: 0, materialArrays: 0, userData: 0, losRefs: 0, colliderRefs: 0,
      platformRefs: 0, knownActorDynamic: 0, mergeEligible: 0, staticMergeEligible: 0,
    };
    const pairCounts = new Map(), geos = new Set(), mats = new Set();
    function materialList(m) { return Array.isArray(m.material) ? m.material : [m.material]; }
    function meshCount(o) {
      let meshes = 0, visibleMeshes = 0;
      o.traverse(function (n) {
        if (!n.isMesh) return;
        meshes++; if (n.visible) visibleMeshes++;
      });
      return { meshes, visibleMeshes };
    }
    root.traverse(function (m) {
      if (!m.isMesh) return;
      counts.meshes++; if (m.visible) counts.visibleMeshes++;
      if (m.isInstancedMesh) counts.instanced++;
      const ml = materialList(m);
      if (Array.isArray(m.material)) counts.materialArrays++;
      let textured = false, transparent = false, emissive = false;
      for (let i = 0; i < ml.length; i++) {
        const mat = ml[i]; if (!mat) continue;
        mats.add(mat.uuid || mat.id);
        if (mat.map) textured = true;
        if (mat.transparent || mat.opacity < 1) transparent = true;
        if (mat.emissive && mat.emissive.getHex && mat.emissive.getHex() !== 0) emissive = true;
      }
      if (textured) counts.textured++;
      if (transparent) counts.transparent++;
      if (emissive) counts.emissive++;
      const hasUserData = !!(m.userData && Object.keys(m.userData).length);
      if (hasUserData) counts.userData++;
      if (los.has(m)) counts.losRefs++;
      if (colRefs.has(m)) counts.colliderRefs++;
      if (platformRefs.has(m)) counts.platformRefs++;
      if (knownDynamic.has(m)) counts.knownActorDynamic++;
      if (m.geometry) {
        geos.add(m.geometry.uuid || m.geometry.id);
        const matKey = ml.map(function (x) { return x && (x.uuid || x.id); }).join(",");
        const key = (m.geometry.uuid || m.geometry.id) + "|" + matKey;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
      if (!m.isInstancedMesh && !Array.isArray(m.material) && !textured && !transparent && !emissive &&
          !hasUserData && !los.has(m) && !colRefs.has(m) && !platformRefs.has(m)) {
        counts.mergeEligible++;
        if (!knownDynamic.has(m)) counts.staticMergeEligible++;
      }
    });
    counts.uniqueGeometries = geos.size;
    counts.uniqueMaterials = mats.size;
    const repeatedPairs = Array.from(pairCounts.values()).filter(function (n) { return n > 1; }).sort(function (a, b) { return b - a; });
    counts.repeatedGeometryMaterialPairs = repeatedPairs.length;
    counts.meshesInRepeatedPairs = repeatedPairs.reduce(function (a, b) { return a + b; }, 0);
    counts.largestRepeatedPair = repeatedPairs[0] || 0;
    counts.topLevelChildren = root.children.map(function (o, index) {
      const c = meshCount(o);
      return { index, name: o.name || "", type: o.type || "", meshes: c.meshes, visibleMeshes: c.visibleMeshes };
    }).sort(function (a, b) { return b.visibleMeshes - a.visibleMeshes; }).slice(0, 20);
    return counts;
  }

  function finish() {
    if (finished) return;
    finished = true;
    scanGlitches();
    glitches.duplicateColliders = colliderDuplicates();
    const elapsed = (performance.now() - startedAt) / 1000;
    const frames = frameTimes.length;
    const report = {
      scenario, requestedSeconds: seconds, requestedFrames: targetFrames, elapsedSeconds: +elapsed.toFixed(2),
      fps: frames && elapsed ? +(frames / elapsed).toFixed(2) : 0,
      frameMs: {
        avg: frames ? +(frameTimes.reduce(function (a, b) { return a + b; }, 0) / frames).toFixed(3) : 0,
        p50: +percentile(frameTimes, 0.5).toFixed(3),
        p95: +percentile(frameTimes, 0.95).toFixed(3),
        p99: +percentile(frameTimes, 0.99).toFixed(3),
        max: frameTimes.length ? +Math.max.apply(Math, frameTimes).toFixed(3) : 0,
        over25ms: longFrames.length,
        over50ms: longFrames.filter(function (x) { return x >= 50; }).length,
      },
      render: {
        avgCpuMs: renderStats.samples ? +(renderStats.cpu / renderStats.samples).toFixed(3) : 0,
        peakCpuMs: +renderStats.peakCpu.toFixed(3),
        avgCalls: renderStats.samples ? +(renderStats.calls / renderStats.samples).toFixed(1) : 0,
        avgTriangles: renderStats.samples ? Math.round(renderStats.triangles / renderStats.samples) : 0,
      },
      counts: {
        peds: (CBZ.cityPeds || []).length, cops: (CBZ.cityCops || []).length,
        cars: (CBZ.cityCars || []).length,
        crowd: CBZ.cityCrowdCount ? CBZ.cityCrowdCount() : null,
        colliders: (CBZ.colliders || []).length, platforms: (CBZ.platforms || []).length,
        losBlockers: (CBZ.losBlockers || []).length,
      },
      scene: sceneCounts(),
      renderAttribution: renderAttribution(),
      cityRootCensus: cityRootCensus(),
      batch: CBZ.batchStats || null,
      colliderBroadphase: CBZ.colliderBroadphaseStats || null,
      heapUsedMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      glitches, errors: errors.slice(0, 20),
      topFrameWork: ranked(updaterStats.concat(alwaysStats)),
    };
    CBZ.perfReport = report;
    const pre = document.createElement("pre");
    pre.id = "perf-report";
    pre.textContent = JSON.stringify(report, null, 2);
    pre.style.cssText = "position:fixed;inset:0;z-index:999999;overflow:auto;background:#071018;color:#d9f7e8;padding:16px;font:12px/1.35 monospace;white-space:pre-wrap";
    document.body.appendChild(pre);
    console.log("CBZ_PERF_REPORT " + JSON.stringify(report));
  }

  function applyScenario() {
    if (scenario === "wanted5" || scenario === "chaos") {
      CBZ.game.wanted = 5; CBZ.game.heat = 12000;
      if (CBZ.cityReport) CBZ.cityReport(220, { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "benchmark" });
    }
    if (scenario === "chaos") {
      if (CBZ.spawnCityPeds) CBZ.spawnCityPeds(260);
      if (CBZ.spawnCityCrowd) CBZ.spawnCityCrowd(360);
      if (CBZ.spawnCityTraffic) CBZ.spawnCityTraffic(100);
      if (CBZ.cityAlarm) CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 120, 1, CBZ.city.playerActor);
    }
  }

  addEventListener("load", function () {
    setTimeout(function () {
      try {
        CBZ.setMode("city");
        CBZ.resetGame();
        applyScenario();
        CBZ.setState("playing");
        startedAt = performance.now();
        prevFrame = 0; scanTimer = 0; measuring = true;
      } catch (e) {
        errors.push(String(e && (e.stack || e)));
      }
      setTimeout(finish, seconds * 1000);
    }, 0);
  }, { once: true });

  CBZ.finishPerfProfile = finish;
})();
