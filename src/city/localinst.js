/* ============================================================
   city/localinst.js — LOCAL_INSTANCING: collapse repeated STATIC props into
   per-tile InstancedMesh pools (round-3 teardown lever #1).

   The census (tools/perf-ab/census.mjs) found ~9,366 repeated static prop
   meshes — tiny trim/fixtures/glows — that core/batch.js leaves as individual
   draw calls (it skips emissive/transparent/textured/referenced meshes, which
   is most of these). Each is its own draw call; together they are the bulk of
   the ~99%-static draw-call bottleneck this pass targets.

   WHY IT'S SAFE (the trap prior rounds hit — ITER3 interior-LOD +428%):
     • runs AFTER CBZ.batchStaticUnder(root) so it only sees what batch LEFT
       (no double-processing of already-merged/removed deco);
     • candidate filter mirrors batch's exclusions — skips anything referenced
       by a collider/LOS/platform, anything carrying userData (interactive/
       mover/door), array materials, and whole dynamic/mover subtrees;
     • buckets PER TILE (112u, same as batch V2) so each pool has tight bounds
       and core/farcull can reject distant pools — draw distance still works;
     • DEMOLITION-SAFE: every instance is mapped to its owning top group (the
       direct child of the root, exactly what demolition.js passes to
       batchHideGroup). We wrap batchHideGroup/batchShowGroup so a collapsing
       building ZERO-SCALES its instanced trim too — no floating props (the
       demolition-check float invariant guards this);
     • DETERMINISTIC: pure traversal of the already-deterministic built world,
       no rng, identical on every client → MP-safe;
     • REVERSIBLE: flag off → inert (never runs); on → originals are only
       hidden (visible=false), never disposed, so state is fully restorable.

   Flag: CBZ.CONFIG.LOCAL_INSTANCING (default off). URL: ?cfg_LOCAL_INSTANCING=1
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.CONFIG && CBZ.CONFIG.LOCAL_INSTANCING == null) CBZ.CONFIG.LOCAL_INSTANCING = false;

  // Cell size + min pool size are tunable for A/B (bigger cells collapse more
  // in-view props per pool at the cost of coarser frustum granularity).
  // Defaults chosen by A/B (tools/perf-ab/inst-*.json): 672u cells collapse the
  // in-view props ~1:many (calm 90210 draw calls 5,441 → 3,826, −30%); the finer
  // 112u cell was a wash because in-view props scatter thinly across many tiles.
  function TILE_SIZE() { const v = CBZ.CONFIG && +CBZ.CONFIG.LOCAL_INST_TILE; return v > 0 ? v : 672; }
  function MIN_POOL() { const v = CBZ.CONFIG && +CBZ.CONFIG.LOCAL_INST_MIN; return v > 0 ? v : 4; }

  // topGroup(object) -> [{ im, idx, mat4 }] so demolition can zero this
  // building's instanced trim. WeakMap: entries vanish with the group.
  const topGroupInstances = new WeakMap();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // Wrap the demolition hide/show contract ONCE so instanced trim follows the
  // building it belongs to. Idempotent (copy the *Wrapped marker forward, per
  // the explosion-wrapper doctrine) — safe if batch.js loads before/after us.
  function wrapDemolition() {
    const oh = CBZ.batchHideGroup, os = CBZ.batchShowGroup;
    if (oh && !oh._localInstWrapped) {
      const wrapped = function (top) {
        const n = oh.apply(this, arguments);
        const arr = topGroupInstances.get(top);
        if (arr) for (let i = 0; i < arr.length; i++) {
          const e = arr[i]; if (e._hidden) continue;
          e.im.setMatrixAt(e.idx, ZERO); e.im.instanceMatrix.needsUpdate = true; e._hidden = true;
        }
        return n;
      };
      wrapped._localInstWrapped = true;
      CBZ.batchHideGroup = wrapped;
    }
    if (os && !os._localInstWrapped) {
      const wrapped = function (top) {
        const n = os.apply(this, arguments);
        const arr = topGroupInstances.get(top);
        if (arr) for (let i = 0; i < arr.length; i++) {
          const e = arr[i]; if (!e._hidden) continue;
          e.im.setMatrixAt(e.idx, e.mat4); e.im.instanceMatrix.needsUpdate = true; e._hidden = false;
        }
        return n;
      };
      wrapped._localInstWrapped = true;
      CBZ.batchShowGroup = wrapped;
    }
  }
  wrapDemolition();

  CBZ.instanceStaticUnder = function (root) {
    if (!CBZ.CONFIG || !CBZ.CONFIG.LOCAL_INSTANCING) return null;
    if (!root || (root.userData && root.userData._localInstanced)) return null;
    if (!root.userData) root.userData = {};
    root.userData._localInstanced = true;
    wrapDemolition();   // batch.js may have defined the hooks after our module loaded

    // reference sets — never touch a mesh some system reads (LOS raycasts,
    // collider/platform refs); identical policy to core/batch.js consider().
    const losSet = new Set(CBZ.losBlockers || []);
    const refSet = new Set();
    for (const c of (CBZ.colliders || [])) if (c && c.ref) refSet.add(c.ref);
    for (const p of (CBZ.platforms || [])) if (p && p.ref) refSet.add(p.ref);

    function topGroupOf(m) {
      let o = m, prev = m;
      while (o && o.parent && o.parent !== root) { prev = o; o = o.parent; }
      return (o && o.parent === root) ? o : prev;   // direct child of root == demolition's b.group
    }
    function isCandidate(m) {
      if (!m.isMesh || m.isInstancedMesh) return false;
      if (m.userData && m.userData._localInst) return false;         // our own output
      if (m.name === "batch-inert" || m.name === "batch-wall") return false;
      const mat = m.material;
      if (!mat || Array.isArray(mat)) return false;                  // shared single material only
      if (m.userData && Object.keys(m.userData).length > 0) return false; // interactive/mover/door
      if (losSet.has(m) || refSet.has(m)) return false;              // referenced — keep identity
      const g = m.geometry;
      if (!g || !g.attributes || !g.attributes.position) return false;
      return true;
    }

    const buckets = new Map();   // key -> { geo, mat, proto, items:[{mesh,mat4,top}], box }
    function collect(m) {
      m.updateWorldMatrix(true, false);
      const e = m.matrixWorld.elements;
      const T = TILE_SIZE(); const tx = Math.floor(e[12] / T), tz = Math.floor(e[14] / T);
      const key = tx + "," + tz + "|" + (m.geometry.uuid || m.geometry.id) + "|" + (m.material.uuid || m.material.id);
      let b = buckets.get(key);
      if (!b) { b = { geo: m.geometry, mat: m.material, proto: m, items: [], box: new THREE.Box3() }; buckets.set(key, b); }
      b.items.push({ mesh: m, mat4: m.matrixWorld.clone(), top: topGroupOf(m) });
      // grow a WORLD-space box over this pool's members (its bounding-sphere source
      // for the manual frustum cull below — the InstancedMesh built-in cull uses
      // the prototype geometry's origin sphere and can't see the tile spread).
      b.box.expandByObject(m);
    }
    function walk(o) {
      if (o.userData && (o.userData.dynamic || o.userData.mover)) return;  // whole live subtree — skip
      if (o.isMesh) { if (isCandidate(o)) collect(o); return; }
      const kids = o.children ? o.children.slice() : [];
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
    for (const c of root.children.slice()) walk(c);

    // All pools live under ONE container child of the root. core/farcull sweeps
    // root.children and would fight our per-pool visibility if the pools were
    // direct children; instead it sees the (map-spanning, always-visible-in-city)
    // container as a single node and leaves the per-pool cull to us.
    let poolRoot = root.getObjectByName ? root.getObjectByName("local-inst-pools") : null;
    if (!poolRoot) { poolRoot = new THREE.Group(); poolRoot.name = "local-inst-pools"; root.add(poolRoot); }
    const pools = CBZ.__localInstPools = CBZ.__localInstPools || [];

    let poolCount = 0, collapsed = 0;
    const _c = new THREE.Vector3(), _s = new THREE.Vector3();
    buckets.forEach(function (b) {
      if (b.items.length < MIN_POOL()) return;
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.items.length);
      im.name = "local-inst";
      im.userData._localInst = true;
      im.castShadow = b.proto.castShadow;
      im.receiveShadow = b.proto.receiveShadow;
      im.matrixAutoUpdate = false;
      // The built-in InstancedMesh frustum cull uses the prototype geometry's
      // ORIGIN-centred sphere, not the tile spread → wrong. Disable it and cull
      // each pool ourselves (onAlways sweep below) against its real world sphere.
      im.frustumCulled = false;
      for (let i = 0; i < b.items.length; i++) {
        const it = b.items[i];
        im.setMatrixAt(i, it.mat4);
        let arr = topGroupInstances.get(it.top);
        if (!arr) { arr = []; topGroupInstances.set(it.top, arr); }
        arr.push({ im: im, idx: i, mat4: it.mat4, _hidden: false });
        it.mesh.visible = false;                 // hide original (reversible; not disposed)
        it.mesh.userData = it.mesh.userData || {};
        it.mesh.userData._instHidden = true;
        collapsed++;
      }
      im.instanceMatrix.needsUpdate = true;
      im.updateMatrix();
      // world-space bounding sphere for the manual frustum cull
      b.box.getCenter(_c); b.box.getSize(_s);
      pools.push({ im: im, cx: _c.x, cy: _c.y, cz: _c.z, r: _s.length() * 0.5 + 1 });
      poolRoot.add(im);
      poolCount++;
    });

    // Per-frame frustum cull for the pools — replicates the exact per-object
    // culling the original individual props got (which is why disabling it
    // regressed draw calls: all-directions pools vs a view-cone of props).
    if (!CBZ.__localInstCull) {
      CBZ.__localInstCull = true;
      const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere();
      CBZ.onAlways(3.7, function () {
        const list = CBZ.__localInstPools;
        if (!list || !list.length || !CBZ.camera) return;
        const cam = CBZ.camera;
        cam.updateMatrixWorld();
        _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        _fr.setFromProjectionMatrix(_pm);
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          _sp.center.set(p.cx, p.cy, p.cz); _sp.radius = p.r;
          p.im.visible = _fr.intersectsSphere(_sp);
        }
      });
    }

    CBZ.localInstStats = { pools: poolCount, collapsed: collapsed, buckets: buckets.size };
    return CBZ.localInstStats;
  };

  // Test hook: for a top group, how many of its mapped instances are still LIVE
  // (non-zero-scaled). After CBZ.batchHideGroup(group) this must be 0 — the exact
  // demolition-safety invariant (tools/perf-ab/demo-inst-safety.mjs), immune to
  // the footprint-box inflation that a geometric check suffers.
  CBZ.localInstGroupLive = function (top) {
    const arr = topGroupInstances.get(top);
    if (!arr) return { mapped: 0, live: 0 };
    let live = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i]._hidden) live++;
    return { mapped: arr.length, live: live };
  };
})();
