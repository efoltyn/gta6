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
  // (history: opt-in until it won memory; measured on phone-fit it takes the
  // phone profile from 1909 to ~970 MB live at the downtown spawn)
  // ON by default on a phone / tablet (core/slice.js CBZ.STREAM_WANTED, which
  // also decided whether the manifest loads), opt-in elsewhere with ?stream=1
  if (CFG.CITY_STREAM == null) CFG.CITY_STREAM = CBZ.STREAM_WANTED != null ? !!CBZ.STREAM_WANTED : (streamParam === "1" || streamParam === "true");

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
  /* THE CENTRE FOLLOWS THE PLAYER WITHIN RECENTRE_M metres (the 10 Hz tick
     re-centres cheaply). It was r * 0.3 (45 m at r 150): every metre of it is
     a ring of city built all round that nobody can see. */
  const RECENTRE_M = 30;
  const lastP = { x: 0, z: 0, t: 0 };
  CBZ.streamBegin = function (cx, cz) {
    if (!streamWanted() || CBZ.slice) return false;
    /* what can be drawn: core/farcull.js draws everything to the fog's end
       + 30 m, measured from the player; + 6 m for the camera boom behind them.
       (It was fog + 60: 24 m more ring than anything draws.) */
    const view = function () { return Math.max(380, +CBZ.cityFogFar || 760) + 36; };
    const S = {
      name: "stream", stream: true, x: cx, z: cz, r: 300,
      label: "Gang City (streamed)",
      view: view,
      /* THE KEEP CIRCLE IS WHAT CAN BE SEEN, NO MORE. The player is never
         more than RECENTRE (half the playable radius) from the centre (the
         centre follows at that distance), and sees `view` (fog + 60 m) from
         there; `lead` adds the ground a moving player covers before the next
         tick builds it (speed x 2.5 s, up to 250 m). It was r + view: the
         whole playable radius again on top, ~35% more city in memory at the
         downtown spawn for ground nobody could see yet. */
      lead: 0,
      keepR: function () { return RECENTRE_M + S.view() + S.lead; },
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

  /* WHAT A JOB LEAVES BEHIND, SO IT CAN BE TAKEN BACK. A builder writes
     into shared lists (CBZ.* arrays: shops, lots, work anchors, doors,
     updaters...; the arena's arrays; any module list registered with
     CBZ.streamBus). runCaptured notes each list's length before the job and
     keeps what was appended. A far job is then FREED, not just parked
     (freeJob below): its objects leave and are disposed, its entries leave
     every list, and next time it simply runs again. The world's plain DATA
     (regions, roads, water, no-spawn, frontier, biome blends) stays: the map
     and traffic read it everywhere; a re-run takes its own old copies out
     first so nothing is registered twice. */
  const DATA_BUSES = { regions: 1, roads: 1, waterBodies: 1, noSpawn: 1, frontierRoads: 1, frontierLandmarks: 1, _biomeBlendSpecs: 1 };
  const OWN_BUSES = { colliders: 1, platforms: 1, losBlockers: 1, streamJobs: 1, updaters: 1, always: 1 };
  const moduleBuses = [];
  CBZ.streamBus = function (arr, name) { if (Array.isArray(arr) && moduleBuses.indexOf(arr) < 0) { moduleBuses.push(arr); arr._busName = name || "module"; } };
  // a registry that is not a plain list (city/placement.js's cell hash) says
  // how to count, list and take back what a job added: { mark(), since(m), drop(items) }
  const busHooks = [];
  CBZ.streamBusHook = function (h) { if (h && busHooks.indexOf(h) < 0) busHooks.push(h); };
  function busList() {
    const out = [];
    const add = function (arr, name) { if (Array.isArray(arr) && Object.isExtensible(arr) && out.every(function (e) { return e.arr !== arr; })) out.push({ arr: arr, name: name, n: arr.length }); };
    for (const k of Object.keys(CBZ)) { if (OWN_BUSES[k]) continue; const v = CBZ[k]; if (Array.isArray(v)) add(v, k); }
    const A = CBZ.city && CBZ.city.arena;
    if (A) for (const k of Object.keys(A)) { const v = A[k]; if (Array.isArray(v)) add(v, "arena." + k); }
    for (const m of moduleBuses) add(m, m._busName);
    return out;
  }
  function dropItems(arr, items) {
    if (!arr || !items || !items.length) return;
    const drop = new Set(items);
    let w = 0; for (let i = 0; i < arr.length; i++) if (!drop.has(arr[i])) arr[w++] = arr[i];
    arr.length = w;
  }

  // run fn, capturing what it adds at the top of the city root and the scene,
  // every collider/platform it pushes and every list it grows
  function runCaptured(job) {
    const root = cityRoot(), scene = CBZ.scene;
    // a re-run: its last run's world data comes out first (it registers it again)
    if (job.data) { for (const d of job.data) dropItems(d.arr, d.items); job.data = null; }
    // what is already pending pools up now, so the job's pools hold only its own panes
    if (CBZ.cityFlushPools) { try { CBZ.cityFlushPools(); } catch (e) {} }
    const r0 = root ? root.children.length : 0, s0 = scene ? scene.children.length : 0;
    const c0 = (CBZ.colliders || []).length, p0 = (CBZ.platforms || []).length;
    const buses = busList();
    const marks = busHooks.map(function (h) { try { return h.mark(); } catch (e) { return null; } });
    const t0 = performance.now();
    const outer = capturing; capturing = job;
    try { job.fn(); } catch (e) { console.error("[stream job " + (job.name || "?") + "]", e); }
    capturing = outer;
    // late pools (glass, room deco, masonry) of what it built: now, so they are this job's
    if (CBZ.cityFlushPools) { try { CBZ.cityFlushPools(); } catch (e) {} }
    job.ms = performance.now() - t0;
    job.bus = []; job.data = [];
    job.hooks = [];
    busHooks.forEach(function (h, i) { if (marks[i] == null) return; try { const items = h.since(marks[i]); if (items && items.length) job.hooks.push({ h: h, items: items }); } catch (e) {} });
    for (const b of buses) {
      if (b.arr.length <= b.n) continue;
      const items = b.arr.slice(b.n);
      (DATA_BUSES[b.name] || DATA_BUSES[b.name.replace(/^arena\./, "")] ? job.data : job.bus).push({ arr: b.arr, items: items });
    }

    job.objs = [];
    if (root) for (let i = r0; i < root.children.length; i++) job.objs.push({ o: root.children[i], parent: root });
    if (scene) for (let i = s0; i < scene.children.length; i++) { const o = scene.children[i]; if (o !== root) job.objs.push({ o: o, parent: scene }); }
    job.cols = (CBZ.colliders || []).slice(c0);
    job.plats = (CBZ.platforms || []).slice(p0);
    job.state = "built";
  }

  /* NESTED JOBS. A job's builder may itself defer parts (a town defers each
     parcel's shell). Inside a running job, a part that is in sight runs
     inline and belongs to that job; one that is not is queued as the job's
     CHILD: it builds when seen, and goes when its parent is parked or freed. */
  let capturing = null;
  CBZ.sliceAt = function (rect, fn, opts) {
    if (typeof fn !== "function") return null;
    const s = CBZ.slice;
    if (!s) { fn(); return null; }
    if (s.stream && capturing && rectKeeps(rect)) { fn(); return null; }
    const job = { rect: rect, fn: fn, name: (opts && opts.name) || "", pure: !!(opts && opts.pure), state: "queued", parent: s.stream ? capturing : null };
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
  // a geometry that dropped its CPU arrays after upload (metro far tiles) can
  // never be uploaded again: it keeps its GPU buffers
  // (an attribute whose array is an accessor, city/buildings.js's lazy trim
  // boxes, can always make its array again: never read it here, that would
  // build what the park is trying not to hold)
  function hasArray(a) {
    const d = Object.getOwnPropertyDescriptor(a, "array");
    if (d && d.get) return true;
    return !!(a.array || (a.data && a.data.array));
  }
  function reuploadable(g) {
    if (g.index && !hasArray(g.index)) return false;
    for (const k in g.attributes) { const a = g.attributes[k]; if (a && !hasArray(a)) return false; }
    return true;
  }
  CBZ.geoReuploadable = reuploadable;
  function releaseGPU(o) {
    o.traverse(function (c) { const g = c.geometry; if (g && g.dispose && g.attributes && reuploadable(g)) g.dispose(); });
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
    for (const k of childrenOf(job)) if (k.state === "built" && k.objs) park(k);
    takeLos(job);
    for (const it of job.objs) { if (it.o.parent) it.o.parent.remove(it.o); releaseGPU(it.o); }
    removeFrom(CBZ.colliders, job.cols); removeFrom(CBZ.platforms, job.plats);
    if (job.pure) { job.objs = null; job.cols = job.plats = null; job.los = null; job.state = "queued"; }
    else job.state = "parked";
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  /* FREE a far job: everything it made goes, and it is queued to run again.
     Materials are left alone (they are cached and shared across builds). */
  function childrenOf(job) { const out = []; for (const j of jobs) if (j.parent === job) out.push(j); return out; }
  function freeJob(job) {
    // its children first (built ones are freed; queued ones simply leave: the
    // parent's next run queues them again)
    const kids = childrenOf(job);
    if (kids.length) {
      for (const k of kids) if (k.state !== "queued") freeJob(k);
      removeFrom(jobs, kids);
    }
    if (job.state === "built") park(job);
    // (its textures leave the GPU too: three uploads a texture again from its
    // image the next time anything draws it, so this is safe for a shared one;
    // a texture whose canvas core/texfree.js already released is left alone,
    // it could only come back as 1x1)
    const texDone = new Set();
    for (const it of job.objs || []) {
      if (it.o.parent) it.o.parent.remove(it.o);
      it.o.traverse(function (c) {
        const g = c.geometry;
        if (g && g.dispose && !g._shared && !(g.userData && g.userData._shared)) g.dispose();
        const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : null;
        if (mats) for (const m of mats) {
          if (!m) continue;
          for (const k in m) {
            const t = m[k];
            // ONLY a canvas texture whose canvas is intact: a render target's
            // texture (the environment map, a feed) has no pixels to upload
            // again, and disposing one made every later render throw (the
            // world stopped drawing after a drive: orchestrator, 8540e9bc)
            if (!t || !t.isCanvasTexture || texDone.has(t) || t._cbzFreed) continue;
            const im = t.image;
            if (!im || typeof im.getContext !== "function" || !(im.width > 1)) continue;
            texDone.add(t);
            t.dispose();
          }
        }
      });
    }
    for (const b of job.bus || []) dropItems(b.arr, b.items);
    for (const k of job.hooks || []) { try { k.h.drop(k.items); } catch (e) {} }
    job.hooks = null;
    // (frame work a job registered is left running: a builder's first run can
    // wire a whole system's tick once, and its lists are what just emptied)
    job.objs = null; job.cols = job.plats = null; job.los = null; job.bus = null;
    job.state = "queued"; job.freed = (job.freed || 0) + 1;
    CBZ.streamStats.freed = (CBZ.streamStats.freed || 0) + 1;
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
    // LATE CONTENT IS BATCHED LIKE BOOT CONTENT. What the job added under the
    // city root moves into one identity group, and that group gets the same
    // passes the boot world got (core/batch.js merge, local instancing): a
    // streamed town draws in a handful of calls, not one per box, and parks
    // and returns as one unit. Only after the world's own batch ran (a job
    // that runs during the build is batched with everything else).
    const root = cityRoot();
    if (root && root.userData && root.userData._batched && job.objs && job.objs.length && CBZ.batchStaticUnder && window.THREE) {
      const mine = job.objs.filter(function (it) { return it.parent === root && it.o.parent === root; });
      if (mine.length) {
        const G = new window.THREE.Group();
        G.name = "stream-job";
        root.add(G);
        for (const it of mine) { root.remove(it.o); G.add(it.o); }
        try { CBZ.batchStaticUnder(G); } catch (e) { console.error("[stream batch " + (job.name || "?") + "]", e); }
        try { if (CBZ.instanceStaticUnder) CBZ.instanceStaticUnder(G); } catch (e) {}
        job.objs = job.objs.filter(function (it) { return mine.indexOf(it) < 0; });
        job.objs.push({ o: G, parent: root });
      }
    }
    for (const it of job.objs || []) {
      try { CBZ.freeStaticArrays(it.o); } catch (e) {}
      try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(it.o); } catch (e) {}
      try { if (CBZ.shaderQueue) CBZ.shaderQueue(it.o, { full: true }); } catch (e) {}
    }
  }

  /* ---- ONE COPY OF STATIC GEOMETRY, NOT TWO -------------------------------
     three keeps every attribute's array in JS after it uploads it, so a static
     mesh costs its bytes twice (heap + GPU). For the world's static surfaces
     (terrain, ground skins: userData.terrain / worldSurface), nothing reads
     the NON-POSITION arrays again after the build: raycasts touch position
     and index only. So once an attribute is
     on the GPU its normal / colour / uv / material arrays are dropped. A lost
     GL context cannot re-upload them: systems/glcontext.js reloads the page
     at the player's position instead (CBZ.freedStaticArrays says so). */
  function dropArray() { this.array = null; CBZ.freedStaticArrays = true; }
  const KEEP = { position: 1 };
  CBZ.freeStaticArrays = function (root) {
    if (!root || (CBZ.CONFIG && CBZ.CONFIG.FREE_STATIC_ARRAYS === false)) return 0;
    let n = 0;
    root.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      const u = o.userData || {};
      // Batch-merged meshes: on the desktop they keep theirs (core/farcull.js
      // evicts them from the GPU when far and three re-uploads from these
      // arrays). In the streamed (phone) city the streamer frees far content
      // anyway, so one copy wins: normals + colours go (the wall / group hide
      // writes position only), and the mesh is no longer evictable.
      const g = o.geometry;
      const merged = g._evictable && CFG.CITY_STREAM === true;
      if (!(u.terrain || u.worldSurface || merged)) return;
      if (merged) g._evictable = false;
      if (g._cbzFreed) return;
      g._cbzFreed = true;
      for (const k in g.attributes) {
        if (KEEP[k]) continue;
        const a = g.attributes[k];
        if (!a || a.isInterleavedBufferAttribute || !a.array) continue;
        if (a._cbzUploaded) { a.array = null; CBZ.freedStaticArrays = true; } else a.onUpload(dropArray);
        n++;
      }
    });
    return n;
  };

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
  const FREE_DIST = 700;            // ... and free it outright this far past it
  const STEP_MS = 6;                // per-tick build budget (a job always gets to finish)
  const STEP_SOON_MS = 16;          // ... while something will be in sight within a few ticks
  let acc = 0;
  CBZ.streamStats = { built: 0, parked: 0, queued: 0, recentres: 0, lastJobMs: 0, maxJobMs: 0 };
  CBZ.streamTick = function (force) {
    const s = CBZ.slice; if (!s || !s.stream) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    const dx = P.pos.x - s.x, dz = P.pos.z - s.z;
    // how far a moving player gets before the next few ticks (vehicle or feet)
    // (measured from the position between ticks: a car, a plane, a horse,
    // a teleport all count the same way; a jump of > 400 m is a teleport)
    const tNow = performance.now();
    let V = 0;
    if (lastP.t && tNow > lastP.t) {
      const mdx = P.pos.x - lastP.x, mdz = P.pos.z - lastP.z, d = Math.sqrt(mdx * mdx + mdz * mdz);
      if (d < 400) V = d / ((tNow - lastP.t) / 1000);
    }
    lastP.x = P.pos.x; lastP.z = P.pos.z; lastP.t = tNow;
    const lead = Math.min(250, V * 2.5);
    if (lead > s.lead + 20 || lead < s.lead - 60) s.lead = lead;     // grows at once, shrinks lazily
    if (force || dx * dx + dz * dz > RECENTRE_M * RECENTRE_M) {
      s.x = P.pos.x; s.z = P.pos.z;
      s.r = CBZ.SLICE_MANIFEST ? CBZ.streamRadius(s.x, s.z, s.view()) : s.r;
      CBZ.streamStats.recentres++;
    }
    const t0 = performance.now();
    // nearest first
    const order = jobs.filter(function (j) { return j.state !== "built" && rectKeeps(j.rect); });
    order.sort(function (a, b) { return dist(a.rect, s) - dist(b.rect, s); });
    // A job the player could already SEE (its rect inside the view distance
    // of where the player stands) is built now, whatever the budget: nothing
    // may assemble itself in view. The rest spend STEP_MS a tick, nearest first.
    // Re-attaching parked content is cheap: all of it, now. Building has a
    // budget that GROWS with need: a job that will be in sight within the
    // next few ticks (inside view + the speed lead) raises it to STEP_SOON_MS,
    // so the queue drains BEFORE anything reaches view distance (a build that
    // only happens inside view is a pop: counted in streamStats.urgent).
    const VIEW = s.view(), V2 = VIEW * VIEW, SOON = VIEW + s.lead + 60, SOON2 = SOON * SOON;
    let budget = STEP_MS;
    for (const j of order) {
      if (j.state === "parked") { unpark(j); continue; }
      if (distTo(j.rect, P.pos.x, P.pos.z) < SOON2) budget = STEP_SOON_MS;
    }
    for (const j of order) {
      if (j.state !== "queued") continue;
      const urgent = distTo(j.rect, P.pos.x, P.pos.z) < V2;
      if (!force && !urgent && performance.now() - t0 > budget) break;
      runCaptured(j); settle(j);
      CBZ.streamStats.lastJobMs = Math.round(j.ms); CBZ.streamStats.maxJobMs = Math.max(CBZ.streamStats.maxJobMs, Math.round(j.ms));
      if (urgent) CBZ.streamStats.urgent = (CBZ.streamStats.urgent || 0) + 1;
    }
    for (const j of jobs) if (j.state === "built" && j.objs && !rectKeeps(j.rect, HYST)) park(j);
    // a parked job this far out is freed outright (it re-runs if the player
    // comes back); pruned boot content has no fn and stays parked
    for (const j of jobs) if (j.state === "parked" && j.fn && !j.noFree && !rectKeeps(j.rect, FREE_DIST)) freeJob(j);
    let b = 0, p = 0, qd = 0;
    for (const j of jobs) { if (j.state === "built") b++; else if (j.state === "parked") p++; else qd++; }
    CBZ.streamStats.built = b; CBZ.streamStats.parked = p; CBZ.streamStats.queued = qd;
  };
  function distTo(r, x, z) {
    const cx = Math.max(r.minX, Math.min(x, r.maxX)), cz = Math.max(r.minZ, Math.min(z, r.maxZ));
    return (cx - x) * (cx - x) + (cz - z) * (cz - z);
  }
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
      if (acc < 0.1) return;           // 10 Hz: a fast car covers 4 m a tick
      acc = 0;
      CBZ.streamTick(false);
    });
  }
})();
