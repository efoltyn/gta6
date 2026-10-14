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
  CBZ.streamBegin = function (cx, cz) {
    if (!streamWanted() || CBZ.slice) return false;
    /* what must be the real thing: core/sight.js's `detail` ring (the ground
       fog's end + 36 m). Past it, out to the airborne horizon, only content
       with a FAR FORM may be seen (the metro HLOD, which carries the far
       copy of every building, city/metro.js BUILT; the forest's mid copies
       and impostors, scenery pools, which never park: core/slice.js
       isHorizon). The ring is measured from the EYE: keepR adds how far the
       camera stands off the body (a heli boom, a lifted lens). */
    const view = function () { return CBZ.sight().detail; };
    const S = {
      name: "stream", stream: true, x: cx, z: cz, r: 300,
      label: "Gang City (streamed)",
      view: view,
      /* THE KEEP CIRCLE IS WHAT CAN BE SEEN, NO MORE, PLUS WHERE THE PLAYER
         IS GOING. The player is never more than RECENTRE from the centre
         (the centre follows at that distance) and sees `view` from there.
         A moving player keeps a CAPSULE (core/slice.js): the circle swept
         along (ax, az), where the body will be after 6 s of travel at its
         speed and heading (core/sight.js sightAhead: up to 450 m on the
         ground, 2 km in a plane), so everything ahead is built before the
         camera gets there. `lead` is a quarter of that on every side (a
         turn). It was r + view: the whole playable radius again on top. */
      lead: 0, ax: 0, az: 0,
      keepR: function () { return RECENTRE_M + S.view() + S.lead + Math.min(400, CBZ.sight().eyeOff); },
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
  /* WHAT A JOB DRAWS IS NOT ITS RECT. A builder's rect is where it was asked
     to build; what it builds can stand past it (a lot's forecourt, a town's
     edge parcels, a pruned cell's long buildings): measured, up to 60 m and
     more. Wanted and judged "in view" by its rect alone, such a job was built
     at the edge of the keep circle with its near edge already inside the view
     (a pop, measured on the drive). So a job is wanted, and counted in view,
     by its rect grown by its SPILL: measured when it settles (its objects'
     bounds past the rect, +10 m), SPILL_UNKNOWN until it has been built. */
  const SPILL_UNKNOWN = 60;
  function spillOf(j) { return j.spill != null ? j.spill : SPILL_UNKNOWN; }
  const _sb = window.THREE ? new window.THREE.Box3() : null, _gb = window.THREE ? new window.THREE.Box3() : null;
  function measureSpill(job) {
    if (!_sb || !job.rect || !job.objs || !job.objs.length) return;
    _sb.makeEmpty();
    for (const it of job.objs) {
      const o = it.o; if (!o) continue;
      o.updateWorldMatrix(true, true);
      o.traverse(function (c) {
        if (!c.isMesh || c.isInstancedMesh) return;            // a pool's box is its prototype's, not its spread
        const g = c.geometry; if (!g) return;
        if (!g.boundingBox) { const p = g.attributes && g.attributes.position; if (!p || !p.array) return; try { g.computeBoundingBox(); } catch (e) { return; } }
        if (!g.boundingBox || g.boundingBox.isEmpty()) return;
        _gb.copy(g.boundingBox).applyMatrix4(c.matrixWorld); _sb.union(_gb);
      });
    }
    if (_sb.isEmpty()) { job.spill = 0; return; }
    const r = job.rect;
    const sp = Math.max(0, r.minX - _sb.min.x, _sb.max.x - r.maxX, r.minZ - _sb.min.z, _sb.max.z - r.maxZ);
    job.spill = Math.min(400, Math.round(sp)) + (sp > 0 ? 10 : 0);
  }

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

  // run body under capture: what it adds at the top of the city root and the
  // scene, every collider/platform it pushes and every list it grows
  function capture(job, body, opt) {
    // a job in steps is finished before anything else captures: its panes
    // wait unflushed between steps, and another job's flush would take them
    if (stepping && stepping !== job && stepping.state === "building") { const st = stepping; while (!stepJob(st)) {} settle(st); stepping = null; }
    const root = cityRoot(), scene = CBZ.scene;
    // what is already pending pools up now, so the job's pools hold only its own panes
    if (!(opt && opt.noPre) && CBZ.cityFlushPools) { try { CBZ.cityFlushPools(); } catch (e) {} }
    const r0 = root ? root.children.length : 0, s0 = scene ? scene.children.length : 0;
    const c0 = (CBZ.colliders || []).length, p0 = (CBZ.platforms || []).length;
    // the broadphase grid was current before the job: index only what it appends
    const gridWas = !!(CBZ.colliderGridInSync && CBZ.colliderGridInSync()), lastCol = c0 ? CBZ.colliders[c0 - 1] : null;
    const buses = busList();
    const marks = busHooks.map(function (h) { try { return h.mark(); } catch (e) { return null; } });
    const t0 = performance.now();
    const outer = capturing; capturing = job;
    try { body(); } catch (e) { console.error("[stream job " + (job.name || "?") + "]", e); }
    capturing = outer;
    // late pools (glass, room deco, masonry) of what it built: now, so they are this job's
    if (!(opt && opt.noPost) && CBZ.cityFlushPools) { try { CBZ.cityFlushPools(); } catch (e) {} }
    const R = { ms: performance.now() - t0, bus: [], data: [], hooks: [], objs: [], cols: null, plats: null };
    busHooks.forEach(function (h, i) { if (marks[i] == null) return; try { const items = h.since(marks[i]); if (items && items.length) R.hooks.push({ h: h, items: items }); } catch (e) {} });
    for (const b of buses) {
      if (b.arr.length <= b.n) continue;
      const items = b.arr.slice(b.n);
      (DATA_BUSES[b.name] || DATA_BUSES[b.name.replace(/^arena\./, "")] ? R.data : R.bus).push({ arr: b.arr, items: items });
    }
    if (root) for (let i = r0; i < root.children.length; i++) R.objs.push({ o: root.children[i], parent: root });
    if (scene) for (let i = s0; i < scene.children.length; i++) { const o = scene.children[i]; if (o !== root) R.objs.push({ o: o, parent: scene }); }
    R.cols = (CBZ.colliders || []).slice(c0);
    R.plats = (CBZ.platforms || []).slice(p0);
    if (gridWas && R.cols.length && CBZ.colliderIndexAppended && (c0 === 0 || CBZ.colliders[c0 - 1] === lastCol)) CBZ.colliderIndexAppended(c0);
    return R;
  }
  function adoptCapture(job, R) {
    job.ms = R.ms; job.bus = R.bus; job.data = R.data; job.hooks = R.hooks;
    job.objs = R.objs; job.cols = R.cols; job.plats = R.plats;
    job.state = "built";
  }
  function runCaptured(job) {
    // a re-run: its last run's world data comes out first (it registers it again)
    if (job.data) { for (const d of job.data) dropItems(d.arr, d.items); job.data = null; }
    if (job.steps && job.stepI != null) { while (!stepJob(job)) {} return; }   // one in flight: finish it
    adoptCapture(job, capture(job, job.fn));
  }
  /* A JOB IN STEPS (CBZ.sliceAt with an array of fns: a cell of apartment
     blocks, one block a step). A builder is not resumable, but a list of
     independent parts is: each frame runs as many of them as its share
     allows, each under its own capture, and what a step made is held OUT
     of the scene (it is past the fog anyway) until the last step, when the
     job joins the scene and settles (batch, freeze) as one unit, exactly as
     a one-piece job does. The 200 ms cell became twenty 10 ms steps.
     Returns true when the job is built. */
  function stepJob(job) {
    if (job.stepI == null) {
      if (job.data) { for (const d of job.data) dropItems(d.arr, d.items); job.data = null; }
      job.stepI = 0; job.state = "building"; job.ms = 0;
      job._acc = { ms: 0, bus: [], data: [], hooks: [], objs: [], cols: [], plats: [] };
    }
    const A = job._acc;
    const first = job.stepI === 0, last = job.stepI === job.steps.length - 1;
    // the last step: the held parts rejoin the scene first, so the one pool
    // flush at its end (glass, deco, trim, masonry for every part: one set of
    // pools for the job, as a one-piece job gets) finds them under the root
    if (last) for (const it of A.objs) if (it.parent && !it.o.parent) it.parent.add(it.o);
    const R = capture(job, job.steps[job.stepI++], { noPre: !first, noPost: !last });
    A.ms += R.ms; job.ms = A.ms;
    for (const k of ["bus", "data", "hooks", "objs", "cols", "plats"]) for (const it of R[k]) A[k].push(it);
    if (!last) {
      // held out of the scene until the job is whole
      for (const it of R.objs) if (it.o.parent === it.parent) it.parent.remove(it.o);
      return false;
    }
    job.stepI = null; job._acc = null;
    adoptCapture(job, A);
    return true;
  }

  /* NESTED JOBS. A job's builder may itself defer parts (a town defers each
     parcel's shell). Inside a running job, a part that is in sight runs
     inline and belongs to that job; one that is not is queued as the job's
     CHILD: it builds when seen, and goes when its parent is parked or freed. */
  let capturing = null;
  CBZ.sliceAt = function (rect, fn, opts) {
    // fn: one function, or an ARRAY of independent parts (a job in steps)
    let steps = null;
    if (Array.isArray(fn)) {
      steps = fn.filter(function (f) { return typeof f === "function"; });
      if (!steps.length) return null;
      fn = function () { for (const f of steps) { try { f(); } catch (e) { console.error("[stream step]", e); } } };
    }
    if (typeof fn !== "function") return null;
    const s = CBZ.slice;
    if (!s) { fn(); return null; }
    if (s.stream && capturing && rectKeeps(rect)) { fn(); return null; }
    const job = { rect: rect, fn: fn, steps: steps && steps.length > 1 ? steps : null, name: (opts && opts.name) || "", pure: !!(opts && opts.pure), state: "queued", parent: s.stream ? capturing : null };
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
        /* THE FOG SWEEP COVERS WHAT THIS BUILDER ADDED, not the whole city
           root: a full traverse of the root (every building, prop and pool
           of the world) ran inside every streamed landmass job, and was most
           of the 500 ms the smallest of them (metro_structs: one mesh) took
           on a drive. A builder that hangs a world surface inside a group
           that already existed wraps its own material (metro_structs,
           metro_ground, streetkit all call terrainFogScale themselves). */
        const n0 = city.root.children.length;
        fn(city);
        if (CBZ.cityWorldFogSweep) for (let i = n0; i < city.root.children.length; i++) CBZ.cityWorldFogSweep(city.root.children[i]);
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
  /* PARKED GEOMETRY, HALF SIZE. A parked job's merged buffers (core/batch.js
     "batch-inert" / "batch-wall": its own, never shared) keep their
     positions as 16-bit steps across their own box (<= 2 mm on a 112 m tile)
     while nobody can see them, and are expanded back to floats before they
     rejoin the scene. Normals and colour are already 8-bit there. */
  function ownArray(a) { const d = Object.getOwnPropertyDescriptor(a, "array"); return !!(d && !d.get && d.value instanceof Float32Array); }
  // normals: 16-bit (a 1/32767 step: no visible difference in shading)
  function compactNormals(g) {
    const a = g.attributes.normal;
    if (!a || a._cbzQn || !ownArray(a) || a.itemSize !== 3 || a.isInterleavedBufferAttribute) return 0;
    const N = a.array, q = new Int16Array(N.length);
    for (let i = 0; i < N.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, N[i])) * 32767);
    a._cbzQn = q; a.array = null;
    return N.byteLength - q.byteLength;
  }
  function compactGeo(g, owned) {
    const a = g && g.attributes && g.attributes.position;
    if (!a || a._cbzQ || !ownArray(a) || a.itemSize !== 3 || a.isInterleavedBufferAttribute || g._shared || (g.userData && g.userData._shared)) return 0;
    if (!owned && inUse && inUse.has(g)) return 0;   // also drawn by something still in the scene
    const P = a.array, n = P.length / 3;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (!(x1 >= x0)) return 0;
    const sx = (x1 - x0) / 65535 || 1, sy = (y1 - y0) / 65535 || 1, sz = (z1 - z0) / 65535 || 1;
    const q = new Uint16Array(n * 3);
    for (let i = 0; i < P.length; i += 3) {
      q[i] = Math.round((P[i] - x0) / sx); q[i + 1] = Math.round((P[i + 1] - y0) / sy); q[i + 2] = Math.round((P[i + 2] - z0) / sz);
    }
    a._cbzQ = { q: q, o: [x0, y0, z0], s: [sx, sy, sz] };
    a.array = null;
    // THE RENDERER WILL NOT DRAW IT (vendor three.r128 projectObject checks
    // _cbzNoDraw): a packed geometry reaching a frame by any path is skipped,
    // not uploaded from a null array (the a19b4eb4 render stop)
    g._cbzNoDraw = true;
    return P.byteLength - q.byteLength + compactNormals(g);
  }
  function expandAttr(a) {
    const Q = a && a._cbzQ; if (!Q) return;
    const q = Q.q, P = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3) {
      P[i] = Q.o[0] + q[i] * Q.s[0]; P[i + 1] = Q.o[1] + q[i + 1] * Q.s[1]; P[i + 2] = Q.o[2] + q[i + 2] * Q.s[2];
    }
    a.array = P; a._cbzQ = null; a.needsUpdate = true;
  }
  function expandGeo(g) {
    const a = g.attributes.position; if (a && a._cbzQ) expandAttr(a);
    g._cbzNoDraw = false;
    const n = g.attributes.normal;
    if (n && n._cbzQn) { const q = n._cbzQn, N = new Float32Array(q.length); for (let i = 0; i < q.length; i++) N[i] = q[i] / 32767; n.array = N; n._cbzQn = null; n.needsUpdate = true; }
  }
  CBZ.geoExpand = function (attr) { expandAttr(attr); };
  CBZ.geoExpandAll = expandGeo;
  // an owned, never-uploaded geometry the caller keeps out of sight (core/batch.js rooms)
  CBZ.geoCompactOwned = function (g) { return (g && reuploadable(g)) ? compactGeo(g, true) : 0; };
  /* The geometries still drawn by the scene: a builder that shares one
     geometry between a parked and a live mesh without flagging it _shared
     must never lose its arrays. It was a whole-scene traverse (72k objects,
     8 ms on the desktop, ~25 on a phone) inside the frame that parked, at
     most every 4 s. Now the walk is SPREAD: a parked job's packing waits in
     a queue, the scene is walked WALK_N objects a frame, and a job is packed
     once a walk that began after it was parked has finished (the same
     freshness the old 4 s rebuild gave, without the frame). Boot-time
     packing (streamCompactParked, inside the load) still walks at once. */
  let inUse = null, inUseAt = -1e9;
  function refreshInUse() {
    const now = performance.now();
    if (inUse && now - inUseAt < 4000) return;
    inUseAt = now; inUse = new WeakSet();
    if (CBZ.scene) CBZ.scene.traverse(function (c) { if (c.geometry) inUse.add(c.geometry); });
  }
  const WALK_N = 4000;
  let walk = null;                  // { set, stack, t0 }
  const packQ = [];                 // { job, t } parked, waiting to be packed
  function walkStep() {
    if (!walk) { if (!CBZ.scene) return; walk = { set: new WeakSet(), stack: [CBZ.scene], t0: performance.now() }; }
    const st = walk.stack, set = walk.set;
    let n = 0;
    while (st.length && n < WALK_N) {
      const o = st.pop(); n++;
      if (o.geometry) set.add(o.geometry);
      const ch = o.children; for (let i = 0; i < ch.length; i++) st.push(ch[i]);
    }
    if (!st.length) { inUse = set; inUseAt = walk.t0; walk = null; }
  }
  // (every frame, from workFrame): walk on while something waits; pack one
  // job whose wait is over
  function packStep() {
    if (!packQ.length) return;
    const it = packQ[0];
    if (!(inUseAt > it.t)) { walkStep(); return; }
    packQ.shift();
    const job = it.job;
    if (job.state !== "parked" || !job.objs) return;     // came back, or freed meanwhile
    for (const o of job.objs) compactTreeNow(o.o);
  }
  function compactTree(o) {
    if (CFG.STREAM_COMPACT === false) return;
    refreshInUse();
    compactTreeNow(o);
  }
  function compactTreeNow(o) {
    if (CFG.STREAM_COMPACT === false || !inUse) return;
    let saved = 0;
    o.traverse(function (c) {
      if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || !c.geometry || !c.geometry.attributes) return;
      if (c.userData && c.userData.dynamic) return;
      if (reuploadable(c.geometry)) saved += compactGeo(c.geometry);
    });
    if (CBZ.streamStats) CBZ.streamStats.compactMB = +(((CBZ.streamStats.compactMB || 0) + saved / 1048576)).toFixed(1);
  }
  function expandTree(o) {
    o.traverse(function (c) { const g = c.geometry; if (g && g.attributes && ((g.attributes.position && g.attributes.position._cbzQ) || (g.attributes.normal && g.attributes.normal._cbzQn))) expandGeo(g); });
  }
  function park(job) {
    for (const k of childrenOf(job)) if (k.state === "built" && k.objs) park(k);
    takeLos(job);
    for (const it of job.objs) { if (it.o.parent) it.o.parent.remove(it.o); releaseGPU(it.o); }
    if (!job.pure && CFG.STREAM_COMPACT !== false) packQ.push({ job: job, t: performance.now() });
    const inSync = CBZ.colliderRemoveMany && CBZ.colliderGridInSync && CBZ.colliderGridInSync();
    if (inSync) CBZ.colliderRemoveMany(job.cols); else removeFrom(CBZ.colliders, job.cols);
    removeFrom(CBZ.platforms, job.plats);
    if (job.pure) { job.objs = null; job.cols = job.plats = null; job.los = null; job.state = "queued"; }
    else job.state = "parked";
    if (!inSync && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  /* FREE a far job: everything it made goes, and it is queued to run again.
     Materials are left alone (they are cached and shared across builds). */
  function childrenOf(job) { const out = []; for (const j of jobs) if (j.parent === job) out.push(j); return out; }
  function freeJob(job) {
    // a job in steps caught half-built: what it made so far is its to free
    if (job.state === "building" && job._acc) { const A = job._acc; job.stepI = null; job._acc = null; adoptCapture(job, A); }
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

  // how near the player a job's content joined the scene (a probe reads it:
  // anything under the fog's end is content appearing in view)
  function noteAdd(job, how) {
    const P = CBZ.player && CBZ.player.pos; if (!P || !job.rect) return;
    const d = Math.sqrt(distTo(job.rect, P.x, P.z));
    const L = CBZ.streamStats.adds || (CBZ.streamStats.adds = []);
    if (L.length < 60) L.push([how, Math.round(d), job.name || "?"]);
  }
  function unpark(job) {
    noteAdd(job, "unpark");
    for (const it of job.objs) { expandTree(it.o); if (it.parent) it.parent.add(it.o); if (CBZ.farcullAdopt) CBZ.farcullAdopt(it.o); }
    const inSync = CBZ.colliderAddMany && CBZ.colliderGridInSync && CBZ.colliderGridInSync();
    // a collider its owner had TAKEN OUT while the job was built (`_out`: an
    // open door, interior_programs.js) stays out: re-attaching all of them
    // put a solid body back in every doorway left open when the player left
    const cols = job.cols.filter(function (c) { return !c._out; });
    if (inSync) CBZ.colliderAddMany(cols); else for (const c of cols) CBZ.colliders.push(c);
    for (const p of job.plats) (CBZ.platforms = CBZ.platforms || []).push(p);
    if (job.los && CBZ.losBlockers) { for (const m of job.los) CBZ.losBlockers.push(m); job.los = null; }
    job.state = "built";
    if (!inSync && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
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
        G.name = "stream-job"; G.userData.streamJob = true;
        root.add(G);
        for (const it of mine) { root.remove(it.o); G.add(it.o); }
        try { CBZ.batchStaticUnder(G); } catch (e) { console.error("[stream batch " + (job.name || "?") + "]", e); }
        try { if (CBZ.instanceStaticUnder) CBZ.instanceStaticUnder(G); } catch (e) {}
        job.objs = job.objs.filter(function (it) { return mine.indexOf(it) < 0; });
        job.objs.push({ o: G, parent: root });
      }
    }
    if (job.spill == null) { try { measureSpill(job); } catch (e) {} }
    for (const it of job.objs || []) {
      try { CBZ.freeStaticArrays(it.o); } catch (e) {}
      try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(it.o); } catch (e) {}
      try { if (CBZ.shaderQueue) CBZ.shaderQueue(it.o, { full: true }); } catch (e) {}
      try { if (CBZ.farcullAdopt) CBZ.farcullAdopt(it.o); } catch (e) {}
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
      // (still evictable: core/farcull.js reads a GPU-only merged buffer back,
      // packed, before it leaves the GPU; the GPU used to keep everything a
      // drive had seen: +220 MB of GL after a tour, memscope)
      if (merged && !(CBZ.batchGpuSliceable && CBZ.batchGpuSliceable())) g._evictable = false;
      if (g._cbzFreed) return;
      g._cbzFreed = true;
      /* GPU-ONLY MERGED GEOMETRY. A merged render copy is never a raycast
         target (LOS, bullets and the camera test the hidden originals and the
         blocker lists), and its slice hides go to the GPU buffer directly
         (core/batch.js rangeSet, WebGL2). So once uploaded it keeps NO CPU
         copy at all: positions and index go too. */
      const gpuOnly = merged && CBZ.batchGpuSliceable && CBZ.batchGpuSliceable();
      if (gpuOnly) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        g.computeBoundingSphere = g.computeBoundingBox = function () {};
        o.raycast = function () {};
        const ix = g.index;
        if (ix && ix.array) { if (ix._cbzUploaded) { ix.array = null; CBZ.freedStaticArrays = true; } else ix.onUpload(dropArray); }
      }
      for (const k in g.attributes) {
        if (KEEP[k] && !gpuOnly) continue;
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
  /* PARKED, BUT MERGED. What the prune parks was built for real and never
     went through the batch pass (the prune runs before it), so a far cell
     sat in memory as thousands of single meshes (the estates alone: ~7.8k)
     and came back as thousands of draw calls. Each parked cell's root-level
     subtrees are batched here, exactly as a streamed job's are when it
     settles: static parts merge into a few buffers, live parts stay. */
  /* THE PASSES SEE THE REFERENCES THE BOOT BATCH SEES. The prune takes a
     parked subtree's LOS blockers out of CBZ.losBlockers (job.los) BEFORE
     this runs, and core/batch.js / localinst decide "keep this mesh's
     identity" from that very list. So every mesh known only as a blocker
     (a floor slab, the carved slab a stair opened, a parapet) was merged as
     inert deco here and its original thrown away. When the stair core was
     built on the way in (elevators.js cityStairCore, the first time anybody
     walks up) buildings.js carved the slab: the walk surface left, but
     batchWallHide had no slice for a mesh that went down the inert path, so
     the drawn slab stayed across the stairwell in the merged buffer.
     OWNER (iPad, the Mansion): "there's this white floor in the stairwell,
     and you have to walk through the floor". Every parked building on a
     streamed boot had it. The parked blockers are put back in the list for
     the two passes (walls path: hidden originals with their own slices, LOS
     raycasts keep a mesh that is in the graph) and taken out again after. */
  CBZ.streamCompactParked = function (root) {
    if (!root || !window.THREE || !CBZ.batchStaticUnder) return 0;
    root.updateWorldMatrix(true, false);
    if (!root.matrixWorld.equals(new window.THREE.Matrix4())) return 0;   // merged verts are root-space
    let n = 0;
    const L = CBZ.losBlockers;
    prunedCells.forEach(function (job) {
      if (job.state !== "parked" || !job.objs || !job.objs.length) return;
      const mine = job.objs.filter(function (it) { return it.parent === root && it.o && !it.o.parent; });
      if (mine.length < 2) { for (const it of job.objs) if (it.o) compactTree(it.o); return; }
      const G = new window.THREE.Group();
      G.name = "stream-job"; G.userData.streamJob = true;
      for (const it of mine) G.add(it.o);
      const los = L && job.los && job.los.length ? job.los : null;
      const base = L ? L.length : 0;
      if (los) for (let i = 0; i < los.length; i++) L.push(los[i]);
      try { CBZ.batchStaticUnder(G); } catch (e) { console.error("[park batch " + job.name + "]", e); }
      try { if (CBZ.instanceStaticUnder) CBZ.instanceStaticUnder(G); } catch (e) {}
      if (los) L.length = base;           // (nothing else touches the list between: the passes only read it)
      root.remove(G);
      job.objs = job.objs.filter(function (it) { return mine.indexOf(it) < 0; });
      job.objs.push({ o: G, parent: root });
      for (const it of job.objs) if (it.o) compactTree(it.o);
      n++;
    });
    return n;
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

  /* ---- the streamer ---------------------------------------------------------
     PLANNED AT 10 Hz, WORKED EVERY FRAME. The tick used to do everything at
     once every sixth frame: re-attach EVERY parked job that came into range,
     build up to 16 ms, park and free everything that left: one heavy frame
     in six (the drive's p95), however little was asked of the frames between.
     Now the 10 Hz plan only decides (re-centre, what is wanted, nearest
     first, what is to be parked or freed), and every frame does a share of
     it under a budget of milliseconds PER SECOND, spread by the frame's dt:
     the same work per second, never the whole second's work in one frame.
     What the camera could already see (inside the view distance) is still
     done at once, whatever the budget: nothing may assemble itself in view.
     A job always finishes once started (builders are not resumable), so a
     frame starts a second job only while it is under its share. */
  const HYST = 250;                 // park only this far past the keep circle
  const FREE_DIST = 700;            // ... and free it outright this far past it
  const RATE_MS = 60;               // build / unpark work per second of play
  const RATE_SOON_MS = 200;         // ... while something will be in sight within a few seconds
  const FRAME_MIN_MS = 1;           // a frame's share is never less than this
  const FRAME_MAX_MS = 8;           // ... nor more (a 10 fps frame does not take 20 ms of builds)
  const OUT_MS = 1.5;               // park + free per frame (never urgent: past keep + HYST)
  let acc = 0;
  const plan = { want: [], wi: 0, out: [], oi: 0, soon: false };
  let stepping = null;              // the job in steps now in flight
  CBZ.streamStats = { built: 0, parked: 0, queued: 0, recentres: 0, lastJobMs: 0, maxJobMs: 0,
    ms: { plan: 0, unpark: 0, build: 0, park: 0, free: 0 }, frameMaxMs: 0 };
  // the streamer's own cost per frame (ms), last 600 frames: CBZ.streamPerf()
  const RING = new Float32Array(600); let ringN = 0;
  CBZ.streamPerf = function () {
    const n = Math.min(ringN, RING.length), a = Array.prototype.slice.call(RING, 0, n).sort(function (x, y) { return x - y; });
    let sum = 0; for (let i = 0; i < n; i++) sum += a[i];
    const at = function (f) { return n ? +a[Math.min(n - 1, Math.floor(n * f))].toFixed(2) : 0; };
    return { frames: n, mean: n ? +(sum / n).toFixed(3) : 0, p95: at(0.95), p99: at(0.99), max: n ? +a[n - 1].toFixed(2) : 0, phases: CBZ.streamStats.ms };
  };
  // one share of work on j; true when j is in the scene (built / unparked)
  function bringIn(j, urgent) {
    const t0 = performance.now();
    if (j.state === "parked") { unpark(j); CBZ.streamStats.ms.unpark += performance.now() - t0; return true; }
    if (j.steps && !urgent) {
      // a job in steps: one step now, the rest on the next frames
      const done = stepJob(j);
      CBZ.streamStats.ms.build += performance.now() - t0;
      if (!done) return false;
      settle(j); noteAdd(j, "build");
      CBZ.streamStats.lastJobMs = Math.round(j.ms); CBZ.streamStats.maxJobMs = Math.max(CBZ.streamStats.maxJobMs, Math.round(j.ms));
      return true;
    }
    runCaptured(j); settle(j); noteAdd(j, urgent ? "build!" : "build");
    CBZ.streamStats.ms.build += performance.now() - t0;
    CBZ.streamStats.lastJobMs = Math.round(j.ms); CBZ.streamStats.maxJobMs = Math.max(CBZ.streamStats.maxJobMs, Math.round(j.ms));
    if (urgent) CBZ.streamStats.urgent = (CBZ.streamStats.urgent || 0) + 1;
    return true;
  }
  function takeOut(j) {
    const t0 = performance.now();
    if (j.state === "built" && j.objs && !rectKeeps(j.rect, HYST + (j.spill || 0))) { park(j); CBZ.streamStats.ms.park += performance.now() - t0; }
    if (j.state === "parked" && j.fn && !j.noFree && !rectKeeps(j.rect, FREE_DIST)) { freeJob(j); CBZ.streamStats.ms.free += performance.now() - t0; }
  }
  // THE PLAN (10 Hz): re-centre, what is wanted (nearest first, what lies
  // ahead counts as nearer), what is in view now (done now), what goes
  function planTick(force) {
    const s = CBZ.slice; if (!s || !s.stream) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    const t0 = performance.now();
    const dx = P.pos.x - s.x, dz = P.pos.z - s.z;
    // WHERE THE PLAYER IS GOING (core/sight.js sightAhead: the body's speed
    // and heading on GAME time, a car, a horse, a plane alike): the keep
    // capsule reaches 6 s of travel ahead (core/slice.js tests it), a
    // quarter of that on every side for a turn
    const AH = CBZ.sightAhead ? CBZ.sightAhead(6) : null;
    const V = AH ? AH.speed : 0;
    const lead = AH ? AH.lead : 0;
    if (lead > s.lead * 4 + 20 || lead < s.lead * 4 - 60) s.lead = lead / 4;     // grows at once, shrinks lazily
    s.ax = AH ? AH.hx * lead : 0; s.az = AH ? AH.hz * lead : 0;
    if (force || dx * dx + dz * dz > RECENTRE_M * RECENTRE_M) {
      s.x = P.pos.x; s.z = P.pos.z;
      s.r = CBZ.SLICE_MANIFEST ? CBZ.streamRadius(s.x, s.z, s.view()) : s.r;
      CBZ.streamStats.recentres++;
    }
    const want = [];
    for (let i = 0; i < jobs.length; i++) { const j = jobs[i]; if (j.state !== "built" && rectKeeps(j.rect, spillOf(j))) want.push(j); }
    // nearest first, but what lies AHEAD of a moving player counts as nearer
    // (at 30 m/s the road ahead reaches view distance in seconds; the ground
    // beside and behind can wait): distance minus half its forward reach
    const hx = V > 3 && AH ? AH.hx : 0, hz = V > 3 && AH ? AH.hz : 0;
    for (const j of want) {
      const r = j.rect, d = Math.sqrt(distTo(r, P.pos.x, P.pos.z));
      if (!hx && !hz) { j._key = d; continue; }
      const cx = (r.minX + r.maxX) / 2 - P.pos.x, cz = (r.minZ + r.maxZ) / 2 - P.pos.z;
      j._key = d - 0.5 * Math.max(0, cx * hx + cz * hz) * (d > 0 ? Math.min(1, 400 / (d + 1)) : 1);
    }
    want.sort(function (a, b) { return a._key - b._key; });
    // A job the player could already SEE (its rect inside the view distance
    // of the eye or the body) is done NOW: a build there is a pop (counted in
    // streamStats.urgent). The rest go to the frames, at RATE_MS a second, or
    // RATE_SOON_MS while one of them will be in sight within the next few
    // seconds (inside view + the speed lead), so the queue drains BEFORE
    // anything reaches the view distance.
    const EYE = CBZ.sight();
    const VIEW = s.view(), V2 = VIEW * VIEW, SOON = VIEW + lead + 60, SOON2 = SOON * SOON;
    let soon = false;
    const rest = [];
    for (const j of want) {
      if (j.state === "built") continue;           // a parent's run built it inline
      if (force) { while (!bringIn(j, false)) {} continue; }
      const sp = spillOf(j), Vs = (VIEW + sp) * (VIEW + sp), Ss = (SOON + sp) * (SOON + sp);
      if (distTo(j.rect, EYE.x, EYE.z) < Vs || distTo(j.rect, P.pos.x, P.pos.z) < Vs) { bringIn(j, true); continue; }
      if (!soon && (distTo(j.rect, EYE.x, EYE.z) < Ss || distTo(j.rect, P.pos.x, P.pos.z) < Ss ||
          (lead > 20 && distTo(j.rect, AH.x, AH.z) < Vs))) soon = true;
      rest.push(j);
    }
    plan.want = rest; plan.wi = 0; plan.soon = soon;
    const out = [];
    for (const j of jobs) {
      if (j.state === "built" && j.objs && !rectKeeps(j.rect, HYST + (j.spill || 0))) out.push(j);
      // a parked job this far out is freed outright (it re-runs if the player
      // comes back); pruned boot content has no fn and stays parked
      else if (j.state === "parked" && j.fn && !j.noFree && !rectKeeps(j.rect, FREE_DIST)) out.push(j);
    }
    plan.out = out; plan.oi = 0;
    if (force) { for (const j of out) takeOut(j); plan.out = []; }
    CBZ.streamStats.ms.plan += performance.now() - t0;
    let b = 0, p = 0, qd = 0;
    for (const j of jobs) { if (j.state === "built") b++; else if (j.state === "parked") p++; else qd++; }
    CBZ.streamStats.built = b; CBZ.streamStats.parked = p; CBZ.streamStats.queued = qd;
  }
  // THE WORK (every frame): a share of the plan, by the frame's dt
  function workFrame(dt) {
    const s = CBZ.slice; if (!s || !s.stream) return;
    const t0 = performance.now();
    const share = Math.max(FRAME_MIN_MS, Math.min(FRAME_MAX_MS, (plan.soon ? RATE_SOON_MS : RATE_MS) * Math.max(0.001, dt || 1 / 60)));
    let did = false;
    // a job in steps keeps going until it is whole (its parts are held out
    // of the scene meanwhile), wherever the player went
    while (stepping && performance.now() - t0 < share) {
      if (stepping.state !== "building" || bringIn(stepping, false)) stepping = null;
      did = true;
    }
    while (!stepping && plan.wi < plan.want.length) {
      if (did && performance.now() - t0 >= share) break;
      const j = plan.want[plan.wi++];
      if (j.state === "built" || !rectKeeps(j.rect, spillOf(j))) continue;   // done meanwhile, or left range since the plan
      if (j.parent && jobs.indexOf(j) < 0) continue;                 // a freed parent's child
      if (!bringIn(j, false)) stepping = j;
      did = true;
      while (stepping && performance.now() - t0 < share) { if (bringIn(stepping, false)) stepping = null; }
    }
    const t1 = performance.now();
    while (plan.oi < plan.out.length && performance.now() - t1 < OUT_MS) takeOut(plan.out[plan.oi++]);
    packStep();
    const ms = performance.now() - t0;
    RING[ringN++ % RING.length] = ms;
    if (ms > CBZ.streamStats.frameMaxMs) CBZ.streamStats.frameMaxMs = +ms.toFixed(1);
  }
  // force = everything now (a boot, a teleport, tools); otherwise only the
  // plan (the frames do the work)
  CBZ.streamTick = function (force) {
    planTick(!!force);
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
      if (acc >= 0.1) { acc = 0; planTick(false); }     // 10 Hz: a fast car covers 4 m a plan
      workFrame(dt);
    });
  }
})();
