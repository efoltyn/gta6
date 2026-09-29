/* ============================================================
   core/instcull.js — InstancedMesh pools get REAL frustum culling.

   THE WASTE (measured 2026-09-28, tools/speed.mjs --shadows, seed 90210,
   tier 2, real GPU): every sun-map refresh drew 15-19 M vertices, and
   10-14 M of them were InstancedMesh pools (Redhollow canopies and crowns,
   backcountry forest chunks, scatter rocks, arena seats) lying ENTIRELY
   outside the 220 m shadow box. The main view and the CCTV feed paid the
   same way for pools behind the camera. They are drawn because r128 tests
   an InstancedMesh by its prototype geometry's sphere (one tree at the
   origin), which is wrong for a pool, so r128 itself builds every
   InstancedMesh with `frustumCulled = false` and draws it from anywhere.

   THE FIX. An InstancedMesh now reports frustumCulled = true whenever its
   instances can be bounded from instanceMatrix alone, and the frustum test it
   then meets (every camera: the view, the sun's shadow camera, mirrors, CCTV)
   uses the UNION of its instances' bounds: each instance's transformed
   prototype-sphere centre, padded by the prototype radius times that
   instance's largest axis scale. That box contains every vertex any instance
   can emit, so a pool whose box misses the frustum cannot put a single
   fragment or shadow texel on screen: skipping it is exact, not a LOD.

   WHEN A POOL IS LEFT ALONE (drawn exactly as before, whatever its owner set):
     - its instanceMatrix is not StaticDrawUsage (actors, traffic, FX, sky);
     - its instanceMatrix has not been uploaded to the GPU yet;
     - it has an onBeforeRender hook;
     - its material (or its customDepthMaterial) is a Shader/RawShaderMaterial,
       has a displacementMap, or has an onBeforeCompile that WRITES vertex
       positions (transformed =, gl_Position =, or replaces <begin_vertex>):
       those shaders can move vertices anywhere, instanceMatrix does not say.
       (Read-only uses like core/gfx.js's world-position varyings are fine.)
     - its geometry has morph targets.
   The owner's own frustumCulled value is kept and is what the property reads
   for any such pool, so nothing that sets or reads it changes meaning.

   Why an accessor and not a registry: every InstancedMesh ever built gets the
   behaviour through its prototype, with no scene walk, no list to keep in
   sync, and nothing for builders to remember. This file loads straight after
   three.r128.min.js so no pool is constructed before the accessor exists.

   Bounds are cached per pool and re-measured only when its instanceMatrix
   version, count or geometry changes. Pools that rewrite every frame
   (instanced crowds, traffic) are re-measured once per frame: O(count).
============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  if (!THREE || !THREE.InstancedMesh || !THREE.Frustum) return;
  const IMP = THREE.InstancedMesh.prototype;
  if (Object.getOwnPropertyDescriptor(IMP, "frustumCulled")) return;

  const ctl = { on: true, tested: 0, culled: 0, measured: 0 };
  const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
  const NOOP_OBR = THREE.Object3D.prototype.onBeforeRender;
  const MOVES = /(transformed|mvPosition|gl_Position)\s*(\.[xyzw]+)?\s*[-+*\/]?=(?!=)|<begin_vertex>/;

  const matOk = new WeakMap();
  function materialPredictable(m) {
    if (!m) return true;
    let v = matOk.get(m);
    if (v !== undefined && v.obc === m.onBeforeCompile) return v.ok;
    let ok = !(m.isShaderMaterial || m.isRawShaderMaterial || m.displacementMap);
    if (ok && m.onBeforeCompile !== DEFAULT_OBC) {
      let src = "";
      try { src = String(m.onBeforeCompile); } catch (e) { src = "gl_Position="; }
      ok = !MOVES.test(src);
    }
    matOk.set(m, { obc: m.onBeforeCompile, ok: ok });
    return ok;
  }
  function predictable(o) {
    const g = o.geometry;
    if (!g || !o.instanceMatrix) return false;
    // SCENERY ONLY: pools whose owner declared them static (r128's default
    // StaticDrawUsage). Actor, traffic, FX and camera-following pools are
    // DynamicDrawUsage; they are few, move every frame, and one of them at the
    // Gang City spawn (40 instances, rewritten after build) was measured
    // drawing where its array said it wasn't. They keep stock behaviour.
    if (o.instanceMatrix.usage !== THREE.StaticDrawUsage) return false;
    // A pool that places its instances in onBeforeRender only gets that call
    // when it is drawn: culled once, it would never move back into view.
    if (o.onBeforeRender !== NOOP_OBR) return false;
    const ma = g.morphAttributes;
    if (ma && ma.position && ma.position.length) return false;
    const m = o.material;
    if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) if (!materialPredictable(m[i])) return false; }
    else if (!materialPredictable(m)) return false;
    if (o.customDepthMaterial !== undefined && !materialPredictable(o.customDepthMaterial)) return false;
    return true;
  }

  Object.defineProperty(IMP, "frustumCulled", {
    configurable: true,
    get: function () { return this._cbzFrustumCulled || (ctl.on && predictable(this)); },
    set: function (v) { this._cbzFrustumCulled = v; },
  });

  // THE GPU'S COPY IS THE TRUTH, NOT THE ARRAY. three uploads instanceMatrix
  // at the pool's first draw with whatever the array holds at that moment, and
  // after that only when `version` moves. Builders legally write matrices
  // after construction without flagging needsUpdate (the first upload takes
  // them anyway), so bounds measured before that upload can be stale with an
  // unchanged version: that is exactly how a 40-instance pool at the Gang City
  // spawn got culled out of half the screen. So a pool is never culled until
  // its instanceMatrix has been uploaded (r128 calls onUploadCallback right
  // after the first bufferData), and its bounds are re-measured at that point.
  // r128 assigns onUploadCallback per attribute in the constructor, so the hook
  // is an accessor: whatever callback is assigned still runs, after the mark.
  // It sits on BufferAttribute because r128's instanceMatrix is a plain
  // BufferAttribute (InstancedBufferAttribute came later).
  function uploaded() { this._cbzUploaded = true; const f = this._cbzUploadCb; if (f) return f.apply(this, arguments); }
  Object.defineProperty(THREE.BufferAttribute.prototype, "onUploadCallback", {
    configurable: true,
    get: function () { return uploaded; },
    set: function (f) { this._cbzUploadCb = f; },
  });

  // Local-space union box of a pool's instances, cached per matrix version.
  const cache = new WeakMap();
  function localBounds(o) {
    const im = o.instanceMatrix, n = o.count | 0, g = o.geometry;
    let b = cache.get(o);
    if (b && b.a === im && b.v === im.version && b.n === n && b.g === g && b.u === !!im._cbzUploaded) return b;
    if (!b) { b = { a: null, v: -1, n: -1, g: null, box: new THREE.Box3() }; cache.set(o, b); }
    b.a = im; b.u = !!im._cbzUploaded; b.v = im.version; b.n = n; b.g = g;
    ctl.measured++;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const gs = g.boundingSphere;
    const cx = gs.center.x, cy = gs.center.y, cz = gs.center.z, gr = gs.radius;
    const a = im.array;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < n; i++) {
      const q = i * 16;
      const e0 = a[q], e1 = a[q + 1], e2 = a[q + 2], e4 = a[q + 4], e5 = a[q + 5], e6 = a[q + 6], e8 = a[q + 8], e9 = a[q + 9], e10 = a[q + 10];
      const x = e0 * cx + e4 * cy + e8 * cz + a[q + 12];
      const y = e1 * cx + e5 * cy + e9 * cz + a[q + 13];
      const z = e2 * cx + e6 * cy + e10 * cz + a[q + 14];
      const r = gr * Math.sqrt(Math.max(e0 * e0 + e1 * e1 + e2 * e2, e4 * e4 + e5 * e5 + e6 * e6, e8 * e8 + e9 * e9 + e10 * e10));
      if (x - r < mnx) mnx = x - r; if (x + r > mxx) mxx = x + r;
      if (y - r < mny) mny = y - r; if (y + r > mxy) mxy = y + r;
      if (z - r < mnz) mnz = z - r; if (z + r > mxz) mxz = z + r;
    }
    // NaN anywhere (a degenerate matrix) leaves the box unusable: draw it.
    if (n > 0 && mnx <= mxx && mny <= mxy && mnz <= mxz) { b.box.min.set(mnx, mny, mnz); b.box.max.set(mxx, mxy, mxz); b.all = false; }
    else { b.box.makeEmpty(); b.all = n > 0; }
    return b;
  }

  const _box = new THREE.Box3();
  const baseIntersects = THREE.Frustum.prototype.intersectsObject;
  THREE.Frustum.prototype.intersectsObject = function (object) {
    if (!object.isInstancedMesh || !ctl.on || !predictable(object)) return baseIntersects.call(this, object);
    // not on the GPU yet: draw it (that first draw uploads the real matrices)
    if (!object.instanceMatrix._cbzUploaded) return true;
    ctl.tested++;
    const b = localBounds(object);
    if (b.all) return true;
    if (b.box.isEmpty()) { ctl.culled++; return false; }
    _box.copy(b.box).applyMatrix4(object.matrixWorld);
    if (this.intersectsBox(_box)) return true;
    ctl.culled++;
    return false;
  };

  // Audit / A-B handle for tools (tools/speed.mjs --shadows flips `on`).
  THREE.InstancedMesh.cbzCull = ctl;
})();
