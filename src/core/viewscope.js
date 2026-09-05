/* ============================================================
   core/viewscope.js — HIDE WHOLE BUILDINGS THE CAMERA CANNOT SEE, EXACTLY.

   MEASURED 2026-09-05 (Gang City, Balanced, headed Chrome on the owner's Mac,
   CPU sampling profiler + per-updater timers): the frame was CPU-bound at
   ~67 ms, and ~14 ms of it was three.js's OWN walk before a single draw —
   with the player indoors and 22 draw calls on screen. r128 frustum-tests
   every MESH one by one (projectObject → Frustum.intersectsObject, a sphere
   transform each) and never a GROUP, so a building whose 3,700 interior meshes
   are all behind the camera still costs 3,700 sphere tests in the main pass,
   3,700 more in the shadow pass, and a matrix recompose check each. A census
   at street level: 373 static arena groups inside the cull radius, 261 of them
   entirely outside the view frustum, holding 17,600 of the ~30,000 visible
   nodes. Hiding a group makes projectObject, the shadow walk and
   core/matrixskip.js skip its whole subtree in one comparison.

   EXACT, NOT APPROXIMATE. A group is hidden for THIS frame's render only when
   its measured sphere (padded) misses the camera frustum AND, on a frame the
   sun shadow map is refreshed, also misses the sun's shadow frustum — which is
   precisely the pair of tests r128 was about to apply to every mesh inside it.
   Nothing that would have drawn or cast is dropped, so the picture is byte-
   identical; only the walk is shorter. The shadow frustum is built the way
   WebGLShadowMap builds it (LightShadow.updateMatrices from the light's world
   matrix), one frame ahead of the renderer doing the same.

   ONE FRAME AT A TIME. Everything hidden here is shown again at the head of the
   next frame (first updater AND first always runner, so a paused game restores
   too) before any simulation code can read `.visible`. farcull.js's distance
   hides are a different owner and are left alone (we skip anything already
   hidden); a group that moves is an actor and is blacklisted, exactly like
   farcull does.

   CBZ.subtreeSphere(o) is the ONE 3-D subtree measurement (moved here from
   city/cctv.js, which now calls it): a cached world-space sphere per top-level
   arena child, instanced pools measured over their instances, world-spanning
   things marked dyn and never scoped.

   Audit: CBZ.viewScopeAudit(). Revert: ?cfg_VIEW_SCOPE=0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.VIEW_SCOPE == null) CBZ.CONFIG.VIEW_SCOPE = true;

  const MAX_R = 400;   // a footprint wider than this (terrain, sea, road web) is never scoped
  const PAD = 12;      // metres of slack on every sphere: shader displacement, late matrices

  // ---- the measurement ----------------------------------------------------
  const cache = new WeakMap();                 // object -> { x,y,z,r, px,pz, iv, dyn }
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();
  CBZ.subtreeSphereMeasured = function (o) { return cache.has(o); };
  CBZ.subtreeSphere = function (o) {
    let b = cache.get(o);
    // an InstancedMesh that re-wrote its matrices moved its own footprint;
    // the version counter is the measurement's own receipt (farcull's trick).
    if (b && b.iv != null && o.instanceMatrix && o.instanceMatrix.version !== b.iv) b = null;
    if (b) return b;
    b = { x: 0, y: 0, z: 0, r: 0, px: o.position.x, pz: o.position.z, iv: null, dyn: false, loose: false };
    try {
      if (o.userData && o.userData.dynamic) b.dyn = true;
      else if (o.isInstancedMesh) {
        // r128's Box3.expandByObject uses geometry.boundingBox * matrixWorld
        // and NEVER looks at instance matrices, so a pool measured that way
        // reads as one prototype sitting at the pool origin. Scan the instances.
        const a = o.instanceMatrix && o.instanceMatrix.array, n = o.count | 0;
        if (!a || !n) b.dyn = true;
        else {
          let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9, maxS = 0;
          for (let i = 0; i < n; i++) {
            const q = i * 16, x = a[q + 12], y = a[q + 13], z = a[q + 14];
            if (x < mnx) mnx = x; if (x > mxx) mxx = x;
            if (y < mny) mny = y; if (y > mxy) mxy = y;
            if (z < mnz) mnz = z; if (z > mxz) mxz = z;
            // columns 0..2 are the SCALED basis vectors — their lengths are
            // the instance's per-axis scale.
            const sx = Math.hypot(a[q], a[q + 1], a[q + 2]);
            const sy = Math.hypot(a[q + 4], a[q + 5], a[q + 6]);
            const sz = Math.hypot(a[q + 8], a[q + 9], a[q + 10]);
            if (sx > maxS) maxS = sx; if (sy > maxS) maxS = sy; if (sz > maxS) maxS = sz;
          }
          // computeBoundingBox does NOT write boundingSphere, so a pool that
          // hand-published a sector sphere keeps it (and keeps frustum-culling).
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          const protoR = bb
            ? Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 0.5
            : 2;
          const proto = Math.max(0.5, protoR * (maxS > 0 ? maxS : 1));
          b.x = (mnx + mxx) / 2 + o.position.x;
          b.y = (mny + mxy) / 2 + o.position.y;
          b.z = (mnz + mxz) / 2 + o.position.z;
          b.r = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) * 0.5 + proto;
          b.iv = o.instanceMatrix.version;
        }
      }
      else if (o.isMesh && o.geometry) {
        // O(1): batch.js/buildings.js already computed these spheres.
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const s = o.geometry.boundingSphere;
        if (!s) b.dyn = true;
        else {
          _v.copy(s.center).applyMatrix4(o.matrixWorld);
          b.x = _v.x; b.y = _v.y; b.z = _v.z;
          b.r = s.radius * Math.max(o.scale.x, o.scale.y, o.scale.z, 1);
        }
      }
      else {
        _box.setFromObject(o);           // the expensive case: a subtree walk
        // EXACT MEANS: only what r128 would have frustum-rejected anyway may
        // be skipped. A mesh with frustumCulled=false is drawn wherever it is
        // (the sea, the far thickets, an airfield's lights), and an instanced
        // pool inside a group is measured by Box3 from its PROTOTYPE at the
        // pool origin, not its instances — its true footprint is unknown here.
        // Either one inside this subtree makes the group unscopeable for the
        // main camera. `loose` is separate from `dyn` because the CCTV feed
        // (city/cctv.js) accepts that approximation for its 256 px monitor.
        o.traverse(function (x) { if (x.isMesh && (x.frustumCulled === false || x.isInstancedMesh)) b.loose = true; });
        if (isFinite(_box.min.x) && isFinite(_box.max.x)) {
          _box.getCenter(_v);
          b.x = _v.x; b.y = _v.y; b.z = _v.z;
          b.r = Math.hypot(_box.max.x - _box.min.x,
                           _box.max.y - _box.min.y,
                           _box.max.z - _box.min.z) * 0.5;
        } else b.dyn = true;
      }
      // world-spanning things (terrain tiles, the sea, the road web, the
      // whole-world dressing pools) can never be dropped wholesale and their
      // measured sphere is the least trustworthy — stop testing them forever.
      if (b.r > MAX_R) b.dyn = true;
    } catch (e) { b.dyn = true; }
    cache.set(o, b);
    return b;
  };

  // ---- the pass -----------------------------------------------------------
  const hidden = [];
  const viewF = new THREE.Frustum(), sunF = new THREE.Frustum();
  const _m = new THREE.Matrix4(), _s = new THREE.Sphere();
  const A = CBZ.viewScopeStats = { frames: 0, shadowFrames: 0, tested: 0, hidden: 0, measures: 0, lastHidden: 0 };
  const MEASURES_PER_FRAME = 24;   // fresh Box3 subtree walks allowed per frame (the 30-50 ms hitch-stack farcull budgets against)

  function restore() {
    for (let i = hidden.length - 1; i >= 0; i--) hidden[i].visible = true;
    hidden.length = 0;
  }
  // Both chains: updaters do not run while paused, the always chain does.
  if (CBZ.onUpdate) CBZ.onUpdate(-99, restore); else CBZ.updaters.push({ order: -99, fn: restore });
  if (CBZ.onAlways) CBZ.onAlways(-99, restore); else CBZ.always.push({ order: -99, fn: restore });

  function pass() {
    if (CBZ.CONFIG.VIEW_SCOPE === false || CBZ.loopHold) return;
    if (!CBZ.CONFIG || CBZ.CONFIG.RENDER_FRAMES === false) return;   // nothing is drawn, nothing to save
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (!root || !root.visible) return;
    const cam = CBZ.camera, R = CBZ.renderer;
    if (!cam || !R) return;
    // The same matrices renderer.render() is about to build its frustum from
    // (ancestors too — a camera parented to a rig is otherwise a frame stale).
    cam.updateWorldMatrix(true, false);
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    viewF.setFromProjectionMatrix(_m);
    const sun = CBZ.sun;
    const shadowFrame = !!(R.shadowMap && R.shadowMap.enabled && sun && sun.castShadow && sun.shadow &&
      (R.shadowMap.needsUpdate || R.shadowMap.autoUpdate));
    if (shadowFrame) {
      // WebGLShadowMap.render builds the shadow camera from the light's world
      // matrix and its target's; do the identical thing one frame early.
      try {
        sun.updateWorldMatrix(true, false);
        if (sun.target) sun.target.updateWorldMatrix(true, false);
        sun.shadow.updateMatrices(sun);
        sunF.copy(sun.shadow.getFrustum());
      } catch (e) { return; }              // cannot be exact → hide nothing this frame
      A.shadowFrames++;
    }
    const kids = root.children;
    let n = 0, measures = MEASURES_PER_FRAME;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o.visible) continue;                                   // farcull's (or anyone's) hide — theirs
      if (!o.isGroup && !o.isInstancedMesh) continue;             // a lone mesh is one O(1) test already
      if (o.isGroup && !o.children.length) continue;
      if (!cache.has(o)) { if (measures <= 0) continue; measures--; A.measures++; }
      const b = CBZ.subtreeSphere(o);
      if (b.dyn || b.loose) continue;
      if (o.position.x !== b.px || o.position.z !== b.pz) { b.dyn = true; continue; }   // it moved: an actor, not a building
      A.tested++;
      _s.center.set(b.x, b.y, b.z); _s.radius = b.r + PAD;
      if (viewF.intersectsSphere(_s)) continue;
      if (shadowFrame && sunF.intersectsSphere(_s)) continue;
      o.visible = false; hidden.push(o); n++;
    }
    A.frames++; A.hidden += n; A.lastHidden = n;
  }
  // Last thing before the draw: after the camera (50), first person (52), the
  // sky rig (99) and the campaign's late syncs (999.x) have all had their say.
  if (CBZ.onAlways) CBZ.onAlways(999.9, pass); else CBZ.always.push({ order: 999.9, fn: pass });

  // Tools: apply / undo by hand around a manual render (the pixel-exactness
  // check and the render benchmark both need the two halves separately).
  CBZ.viewScopePass = pass;
  CBZ.viewScopeRestore = restore;

  CBZ.viewScopeAudit = function () {
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    return {
      on: CBZ.CONFIG.VIEW_SCOPE !== false, frames: A.frames, shadowFrames: A.shadowFrames,
      lastHidden: A.lastHidden, avgHidden: A.frames ? +(A.hidden / A.frames).toFixed(1) : 0,
      tested: A.tested, measures: A.measures, arenaChildren: root ? root.children.length : 0,
    };
  };
})();
