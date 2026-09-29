/* ============================================================
   core/citystream.js — GANG CITY STREAMS: the whole city never exists at once.

   Owner, 2026-09-29: "The point is that jail opens on my phone and runs on
   my phone and Gang City doesn't." The jail is a few hectares of dense,
   authored world. Gang City was a continent built in one go: every town,
   every estate, every highway, 130k colliders, in memory at once. On an
   iPhone that is an OOM kill before the first frame.

   THE MODEL. The live game boots a SLICE (core/slice.js) centred on where
   the player will stand: everything that can be seen from there is built,
   the rest of the continent is data only (regions, roads, water, the map)
   plus the far terrain. Then, as the player moves, this file keeps the
   slice under them:
     • the slice centre follows the player (re-centred when they have moved
       half its radius), so every "keep" question core/slice.js answers
       tracks the player;
     • JOBS that were out of range run when their rect comes into range:
         - a landmass builder the boot skipped (its replayed data records are
           swapped for the real ones it registers),
         - any CBZ.sliceAt(rect, fn) a builder deferred (the per-area unit:
           a town, a compound, a tile of dressing);
     • built content that falls out of range is PARKED: detached from the
       scene, its GPU buffers released, its colliders and platforms taken out
       of the broadphase. Walking back re-attaches it (three re-uploads).
       A job declared `pure` (only geometry + colliders/platforms) is freed
       outright and simply re-runs next time: its JS memory goes too.

   THE BUDGET. A slice is sized by COST, not distance: the jail's measured
   footprint (speed.mjs --modes escape: ~11.3k meshes, ~2.3M visible tris,
   ~0.44 s build) is the proven phone budget. The per-cell cost map comes from
   the slice manifest (src/city/slice_manifest.js: every builder's meshes and
   build ms over its 400 m cells); CBZ.streamRadius() grows the playable
   radius until the keep circle (radius + fog band) would pass the budget.
   Dense downtown gets a small slice, the countryside a big one.

   API (for builders):
     CBZ.sliceAt(rect, fn, opts)   rect {minX,maxX,minZ,maxZ}; fn builds the
       geometry for that rect (adding to the scene / city.root, pushing
       colliders/platforms). Runs NOW when there is no slice or the rect is in
       range; is QUEUED when streaming; is DROPPED in a tool slice. opts:
       { name, pure: true when fn only adds objects + colliders/platforms
         and nothing else holds what it made (then it can be freed and re-run) }.
       Nothing may depend synchronously on fn having run.

   ?stream=1 streams (opt-in for now, see CFG.CITY_STREAM below); without it
   the whole city builds as before. ?slice=<name> is a fixed tool slice.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  const streamParam = q ? q.get("stream") : null;
  // OPT-IN until it wins memory (measured 2026-09-29: at the downtown spawn the
  // keep circle still holds ~all of the heavy builders, so a streamed boot is
  // the full city's heap plus parking; see docs/plan/city-streaming.md).
  // ?stream=1 turns it on; flip this default when the builders are split.
  if (CFG.CITY_STREAM == null) CFG.CITY_STREAM = streamParam === "1" || streamParam === "true";

  /* THE JAIL BUDGET. Measured with tools/speed.mjs --modes escape (seed 90210,
     2026-09-29): 11,334 meshes, 2.29M visible tris, 64 programs, build 439 ms
     + first frame 812 ms, load 4.9 s under a load-95 box. A streamed slice's
     keep circle may hold about this much (meshes as built, before batching). */
  const BUDGET = CBZ.STREAM_BUDGET = { meshes: 12000, buildMs: 900, geoMB: 80, tris: 3000000 };

  // Is streaming the way this boot runs? Decided when the city first builds
  // (the mode is known then): a city boot with no fixed ?slice= and no trace.
  function streamWanted() {
    if (CFG.CITY_STREAM === false) return false;
    if (CBZ.SLICE_TRACE) return false;
    if (CBZ.slice && !CBZ.slice.stream) return false;     // a fixed tool slice
    return true;
  }

  /* ---- the cost map (per 400 m cell, from the slice manifest) ---------- */
  let costMap = null;
  function buildCostMap() {
    const M = CBZ.SLICE_MANIFEST; if (!M || !M.builders) return null;
    const cell = M.cell || 400, map = new Map();
    // MEASURED: the finished city's own per-cell census (city-slice-trace)
    if (M.cellCost) {
      for (const k in M.cellCost) {
        const c = k.split(",").map(Number), v = M.cellCost[k];
        map.set(k, { meshes: v[0], tris: v[1], kb: v[2], ms: 0, x: (c[0] + 0.5) * cell, z: (c[1] + 0.5) * cell });
      }
      return { cell, map, measured: true };
    }
    for (const k in M.builders) {
      const b = M.builders[k];
      if (!b.cells || !b.cells.length || b.terrain) continue;
      const w = 1 / b.cells.length;
      for (const c of b.cells) {
        const key = c[0] + "," + c[1];
        const e = map.get(key) || { meshes: 0, ms: 0, x: (c[0] + 0.5) * cell, z: (c[1] + 0.5) * cell };
        e.meshes += b.meshes * w; e.ms += b.ms * w;
        map.set(key, e);
      }
    }
    return { cell, map };
  }
  // what the keep circle (x, z, keepR) costs
  CBZ.streamCost = function (x, z, keepR) {
    if (!costMap) costMap = buildCostMap();
    if (!costMap) return { meshes: 0, ms: 0, tris: 0, geoMB: 0 };
    let meshes = 0, ms = 0, tris = 0, kb = 0;
    const h = costMap.cell / 2;
    for (const e of costMap.map.values()) {
      const cx = Math.max(e.x - h, Math.min(x, e.x + h)), cz = Math.max(e.z - h, Math.min(z, e.z + h));
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > keepR * keepR) continue;
      meshes += e.meshes; ms += e.ms; tris += e.tris || 0; kb += e.kb || 0;
    }
    return { meshes: Math.round(meshes), ms: Math.round(ms), tris: Math.round(tris), geoMB: Math.round(kb / 1024) };
  };
  // the playable radius at (x, z) the jail budget allows (150..900 m)
  CBZ.streamRadius = function (x, z, view) {
    let r = 150;
    for (let t = 200; t <= 900; t += 50) {
      const c = CBZ.streamCost(x, z, t + view);
      if (c.meshes > BUDGET.meshes || c.ms > BUDGET.buildMs || c.geoMB > BUDGET.geoMB || c.tris > BUDGET.tris) break;
      r = t;
    }
    return r;
  };

  /* ---- boot: become a slice centred on the spawn ----------------------- */
  // Called by city/world.js at the top of buildCity. The spawn is the city
  // centre (the rooftop / street spawn is downtown); reset() places the
  // player and the streamer re-centres on them from the first tick.
  CBZ.streamBegin = function (cx, cz) {
    if (!streamWanted() || CBZ.slice) return false;
    const view = function () { return Math.max(380, +CBZ.cityFogFar || 760) + 60; };
    const S = {
      name: "stream", stream: true, x: cx, z: cz, r: 300,
      label: "Gang City (streamed)",
      view: view,
      keepR: function () { return S.r + S.view(); },
    };
    CBZ.slice = S;
    S.r = CBZ.SLICE_MANIFEST ? CBZ.streamRadius(cx, cz, view()) : 300;
    armTicker();
    return true;
  };

  /* ---- jobs ------------------------------------------------------------- */
  const jobs = [];            // { rect, fn, name, pure, state: 'queued'|'built'|'parked', objs, cols, plats, ms }
  CBZ.streamJobs = jobs;

  function rectKeeps(r, pad) { return CBZ.sliceKeepsRect(r.minX, r.maxX, r.minZ, r.maxZ, pad || 0); }

  function cityRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || (CBZ._cityRootBuilding || null); }

  // run fn, capturing what it adds at the top of the city root and the scene
  // and every collider/platform it pushes
  function runCaptured(job) {
    const root = cityRoot(), scene = CBZ.scene;
    const r0 = root ? root.children.length : 0, s0 = scene ? scene.children.length : 0;
    const c0 = (CBZ.colliders || []).length, p0 = (CBZ.platforms || []).length;
    const t0 = performance.now();
    try { job.fn(); } catch (e) { console.error("[stream job " + (job.name || "?") + "]", e); }
    job.ms = performance.now() - t0;
    job.objs = [];
    if (root) for (let i = r0; i < root.children.length; i++) job.objs.push({ o: root.children[i], parent: root });
    if (scene) for (let i = s0; i < scene.children.length; i++) { const o = scene.children[i]; if (o !== root) job.objs.push({ o: o, parent: scene }); }
    job.cols = (CBZ.colliders || []).slice(c0);
    job.plats = (CBZ.platforms || []).slice(p0);
    job.state = "built";
  }

  CBZ.sliceAt = function (rect, fn, opts) {
    if (typeof fn !== "function") return null;
    const s = CBZ.slice;
    if (!s) { fn(); return null; }
    const job = { rect: rect, fn: fn, name: (opts && opts.name) || "", pure: !!(opts && opts.pure), state: "queued" };
    if (rectKeeps(rect)) {
      if (s.stream) { jobs.push(job); runCaptured(job); } else fn();
      return job;
    }
    if (s.stream) jobs.push(job);         // later, when the player comes near
    return job;
  };

  // a whole landmass builder the boot skipped (city/worldmap.js)
  CBZ.streamQueueBuilder = function (key, rec, fn, replayed) {
    if (!CBZ.slice || !CBZ.slice.stream) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const cell = (CBZ.SLICE_MANIFEST && CBZ.SLICE_MANIFEST.cell) || 400;
    for (const c of rec.cells) {
      minX = Math.min(minX, c[0] * cell); maxX = Math.max(maxX, (c[0] + 1) * cell);
      minZ = Math.min(minZ, c[1] * cell); maxZ = Math.max(maxZ, (c[1] + 1) * cell);
    }
    jobs.push({
      rect: { minX, maxX, minZ, maxZ }, name: key, pure: false, state: "queued", builder: true,
      fn: function () {
        const city = CBZ.city && CBZ.city.arena;
        if (!city) return;
        // the real builder registers the real records: take the replayed copies out first
        if (replayed) for (const k in replayed) {
          const arr = k === "biomeBlends" ? CBZ._biomeBlendSpecs : city[k];
          if (!arr) continue;
          const drop = new Set(replayed[k]);
          let w = 0; for (let i = 0; i < arr.length; i++) if (!drop.has(arr[i])) arr[w++] = arr[i];
          arr.length = w;
        }
        fn(city);
        if (CBZ.cityWorldFogSweep) CBZ.cityWorldFogSweep(city.root);
      },
    });
  };

  /* ---- park / unpark ------------------------------------------------------ */
  function releaseGPU(o) {
    o.traverse(function (c) { if (c.geometry && c.geometry.dispose) c.geometry.dispose(); });
  }
  function removeFrom(arr, list) {
    if (!arr || !list || !list.length) return;
    const drop = new Set(list);
    let w = 0; for (let i = 0; i < arr.length; i++) if (!drop.has(arr[i])) arr[w++] = arr[i];
    arr.length = w;
  }
  // the LOS blockers under a job's objects leave CBZ.losBlockers with it
  function takeLos(job) {
    const L = CBZ.losBlockers; if (!L || !L.length || !job.objs || !job.objs.length) return;
    const tops = new Set(); for (const it of job.objs) tops.add(it.o);
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const m = L[i]; let p = m, hit = false;
      while (p) { if (tops.has(p)) { hit = true; break; } p = p.parent; }
      if (hit) (job.los || (job.los = [])).push(m); else L[w++] = m;
    }
    L.length = w;
  }
  function park(job) {
    takeLos(job);
    for (const it of job.objs) { if (it.o.parent) it.o.parent.remove(it.o); releaseGPU(it.o); }
    removeFrom(CBZ.colliders, job.cols); removeFrom(CBZ.platforms, job.plats);
    if (job.pure) { job.objs = null; job.cols = job.plats = null; job.los = null; job.state = "queued"; }
    else job.state = "parked";
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function unpark(job) {
    for (const it of job.objs) if (it.parent) it.parent.add(it.o);
    for (const c of job.cols) CBZ.colliders.push(c);
    for (const p of job.plats) (CBZ.platforms = CBZ.platforms || []).push(p);
    if (job.los && CBZ.losBlockers) { for (const m of job.los) CBZ.losBlockers.push(m); job.los = null; }
    job.state = "built";
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function settle(job) {
    // late content: freeze its matrices and queue its shaders (the batch pass
    // is a once-per-world step; late content keeps its own draws, like the
    // metro's streamed tiles)
    for (const it of job.objs || []) {
      try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(it.o); } catch (e) {}
      try { if (CBZ.shaderQueue) CBZ.shaderQueue(it.o, { full: true }); } catch (e) {}
    }
  }

  /* ---- the pruned downtown/world content (core/slice.js slicePrune) ------
     In a streamed boot the prune parks instead of discarding: each removed
     subtree becomes a parked job keyed by its bounds. */
  CBZ.streamParkColliders = function (rect, cols, plats) {
    jobs.push({ rect: rect, name: "colliders", pure: false, state: "parked", objs: [], cols: cols || [], plats: plats || [] });
  };
  // one parked job per 400 m cell (by the subtree's centre), not per object:
  // the streamer scans its job list twice a second
  const prunedCells = new Map();
  const jobOfTop = new WeakMap();
  // a pruned LOS blocker rides with the parked job that holds its subtree
  CBZ.streamParkLos = function (top, m) {
    const job = jobOfTop.get(top); if (!job) return;
    (job.los || (job.los = [])).push(m);
  };
  CBZ.streamParkPruned = function (o, parent, box) {
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const k = Math.floor(cx / 400) + "," + Math.floor(cz / 400);
    let job = prunedCells.get(k);
    if (!job || job.state !== "parked") {
      job = { rect: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }, name: "pruned " + k, pure: false, state: "parked", objs: [], cols: [], plats: [] };
      prunedCells.set(k, job); jobs.push(job);
    }
    const r = job.rect;
    r.minX = Math.min(r.minX, box.min.x); r.maxX = Math.max(r.maxX, box.max.x);
    r.minZ = Math.min(r.minZ, box.min.z); r.maxZ = Math.max(r.maxZ, box.max.z);
    job.objs.push({ o: o, parent: parent });
    jobOfTop.set(o, job);
    releaseGPU(o);
  };

  /* ---- the streamer --------------------------------------------------------- */
  const HYST = 250;                 // park only this far past the keep circle
  const STEP_MS = 6;                // per-tick build budget (a job always gets to finish)
  let acc = 0;
  CBZ.streamStats = { built: 0, parked: 0, queued: 0, recentres: 0, lastJobMs: 0, maxJobMs: 0 };
  CBZ.streamTick = function (force) {
    const s = CBZ.slice; if (!s || !s.stream) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    const dx = P.pos.x - s.x, dz = P.pos.z - s.z;
    if (force || dx * dx + dz * dz > (s.r * 0.5) * (s.r * 0.5)) {
      s.x = P.pos.x; s.z = P.pos.z;
      s.r = CBZ.SLICE_MANIFEST ? CBZ.streamRadius(s.x, s.z, s.view()) : s.r;
      CBZ.streamStats.recentres++;
    }
    const t0 = performance.now();
    // nearest first
    const order = jobs.filter(function (j) { return j.state !== "built" && rectKeeps(j.rect); });
    order.sort(function (a, b) { return dist(a.rect, s) - dist(b.rect, s); });
    for (const j of order) {
      if (j.state === "parked") unpark(j);
      else { runCaptured(j); settle(j); CBZ.streamStats.lastJobMs = Math.round(j.ms); CBZ.streamStats.maxJobMs = Math.max(CBZ.streamStats.maxJobMs, Math.round(j.ms)); }
      if (performance.now() - t0 > STEP_MS && !force) break;
    }
    for (const j of jobs) if (j.state === "built" && j.objs && !rectKeeps(j.rect, HYST)) park(j);
    let b = 0, p = 0, qd = 0;
    for (const j of jobs) { if (j.state === "built") b++; else if (j.state === "parked") p++; else qd++; }
    CBZ.streamStats.built = b; CBZ.streamStats.parked = p; CBZ.streamStats.queued = qd;
  };
  function dist(r, s) {
    const cx = Math.max(r.minX, Math.min(s.x, r.maxX)), cz = Math.max(r.minZ, Math.min(s.z, r.maxZ));
    return (cx - s.x) * (cx - s.x) + (cz - s.z) * (cz - s.z);
  }
  // registered when the first streamed city builds (the loop exists by then;
  // this file loads right after config.js, before core/)
  let ticking = false;
  function armTicker() {
    if (ticking || !CBZ.onUpdate) return;
    ticking = true;
    CBZ.onUpdate(0.05, function (dt) {
      if (!CBZ.slice || !CBZ.slice.stream || !CBZ.game || CBZ.game.mode !== "city") return;
      acc += dt || 0;
      if (acc < 0.5) return;
      acc = 0;
      CBZ.streamTick(false);
    });
  }
})();
