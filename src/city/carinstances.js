/* ============================================================
   city/carinstances.js — PARKED CARS DRAW INSTANCED, NOT ONE BY ONE.

   WHY: a city car is ~22 draw calls (the per-material merge buckets, four
   wheels, the cabin, the baked shut doors). vehicles.js already hides
   parked cars past 150 m (the sleepers), but every settled parked car
   INSIDE that ring still paid its full ~22 draws, and a street has dozens
   of them. On the iPad that was most of the car half of the frame.

   WHAT (render-only, nothing about the car changes): a settled, sleepable
   parked car between PROXY_IN and the 150 m sleep ring is PROXIED. Its
   group is hidden and every mesh it was drawing becomes one instance in a
   shared THREE.InstancedMesh, one per (geometry, material, shadow flags,
   renderOrder, handedness). Same geometry objects, same material objects,
   same world matrices, so the picture is the same one the car drew itself.
   Cars of one style share the merged geometry (vehicles.js sharedMerge) and
   the fleet materials (playercars.js mats cache), so N parked cars of a
   style cost ~22 draws total instead of 22 x N.

   FAR TIER: past carlod.js's pixel-space switch a proxied car's meshes are
   drawn with their simplified twins (CBZ.carLod.lodOf: same materials, same
   attributes, geometric error < 1 px there) in their own pools; crossing the
   switch (with hysteresis) releases and re-acquires the car on the other
   tier. The captured real car is always at full detail (carLodRestore).

   PAINT is the one per-car material (recolorBody clones it per car). It is
   drawn through ONE shared paint material per paint signature (white base,
   identical clearcoat/env/roughness, emissive k*white) with instanceColor =
   the car's own paint colour, read off the car's live paint material at
   proxy time, so resprays and liveries are honoured. r128 multiplies the
   diffuse by instanceColor (fragment USE_COLOR -> diffuseColor.rgb *= vColor);
   one onBeforeCompile line multiplies the emissive by it too, so the paint's
   3% colour lift (recolorBody: emissive = colour x 0.03) stays exact. A paint
   that does not fit that shape (vertex colours, emissive not a multiple of
   its colour) keeps its own material in its own pool: still exact, just not
   shared.

   LIFECYCLE: a car is AWAKE (drawn itself), PROXIED (here) or ASLEEP
   (vehicles.js, hidden). vehicles.js's parked branch calls acquire(); the
   car then skips both per-car passes exactly like a sleeper. Every existing
   wake hook (CBZ.cityWakeCar: damage, fire, tyres, enter, carjack, hold,
   scrap, door pose, crash deform) releases a proxy. On top of that, the
   LAST runner before the draw (always 999.5) validates every proxy every
   frame: moved, heading/attitude changed, became unsleepable (car.ai set,
   wreck timer, driver, fire...), shown by someone else, removed from the
   graph, any source mesh's material/geometry/visibility swapped (brake
   lamps, door split, frost, a dent's copy-on-write), paint colour changed,
   children added (an occupant), too close, too far (-> sleep). So a proxy
   can never show a stale car, and a car is never drawn twice or zero times.

   CULLING: r128 culls an InstancedMesh as ONE object against its geometry's
   bounding sphere at the mesh's own transform, which for a pool spread over
   a 300 m ring is meaningless (and the geometry is shared with the real
   cars, so its sphere cannot be touched). Pools are frustumCulled=false and
   culled HERE per car instead: each proxy carries a world sphere that bounds
   all its meshes, tested against the camera's side and near planes each
   frame; a pool only rewrites (compacts) its instance buffer when one of
   its cars crosses in or out of view. Top/bottom/far planes are skipped on
   purpose (a street-level view never loses a car to them, and the ocean
   mirror sees just above/below the screen). city/cctv.js calls
   CBZ.carInstanceFullDraw() before its feed render so a monitor looking
   the other way still sees every proxied car.

   ZERO per-frame allocation: pools grow in doubling chunks, entries/records
   are recycled, released members are swap-removed, and instance buffers are
   uploaded only when a pool actually changed. New pools (each a new shader
   variant the first time it draws) are rate-limited per frame so the
   first proxy wave never compiles a dozen programs in one frame.

   Audit: CBZ.carInstanceAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const PROXY_IN = 35, PROXY_OUT = 31;          // enter past 35 m, back to the real car inside 31 m (hysteresis)
  const PROXY_IN2 = PROXY_IN * PROXY_IN, PROXY_OUT2 = PROXY_OUT * PROXY_OUT;
  const SLEEP_D2 = 150 * 150;                   // == vehicles.js SLEEP_D2 (past it the car sleeps, hidden)
  const CHUNK = 16;                             // first pool capacity; doubles on demand
  const NEW_POOLS_PER_FRAME = 2;                // shader-variant compiles spread over frames
  const CULL_PAD = 1.0;                         // m of slack on every car sphere test

  const pools = new Map();                      // key -> pool
  const poolList = [];                          // same pools, iterable without allocation
  const proxies = [];                           // live proxy records
  const freeRecs = [], freeEntries = [];
  const paintMats = new Map();                  // paint signature -> { mat, refs }
  const safeHook = new WeakMap();               // material -> onBeforeCompile is instancing-safe
  let newPoolsThisFrame = 0, frame = 0, fullDraw = false;
  const _found = [];                            // acquire scratch: meshes
  const _keys = [];                             // acquire scratch: pool keys
  const _sigs = [];                             // acquire scratch: paint signature or null
  const _negs = [];                             // acquire scratch: mirrored (negative determinant)
  const _geos = [];                             // acquire scratch: the geometry each mesh is drawn with (full or LOD)
  const NOOP_RENDER = THREE.Object3D.prototype.onBeforeRender;
  function noRaycast() {}
  const WARM = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1e4, 0, 1]);

  let _v = null, _v2 = null, _fr = null, _pm = null, _sph = null;
  function scratch() {
    if (_v) return true;
    if (!THREE.Vector3 || !THREE.Frustum || !THREE.Matrix4) return false;
    _v = new THREE.Vector3(); _v2 = new THREE.Vector3();
    _fr = new THREE.Frustum(); _pm = new THREE.Matrix4();
    return true;
  }
  function ready() {
    return !!(THREE.InstancedMesh && THREE.InstancedBufferAttribute && CBZ.scene && scratch());
  }

  /* ---- what may be drawn instanced ------------------------------------ */
  // An onBeforeCompile that reads modelMatrix (weather's surface coat, the
  // world detail shader) would see the POOL's matrix, not the car's.
  function hookSafe(m) {
    let ok = safeHook.get(m);
    if (ok !== undefined) return ok;
    ok = !(m.userData && m.userData._cbzCoat);
    if (ok && m.onBeforeCompile) ok = String(m.onBeforeCompile).indexOf("modelMatrix") < 0;
    safeHook.set(m, ok);
    return ok;
  }
  function matOk(m) {
    return !!m && !m.isShaderMaterial && !m.isRawShaderMaterial && hookSafe(m);
  }
  function isPaint(m) { return !!(m && (m._bodyPaint || m._playerCarOwned)); }

  // Walk the car exactly as projectObject would: an invisible node hides its
  // subtree. Returns false for anything this module cannot reproduce.
  function collect(o) {
    if (o.visible === false) return true;
    if (o.isMesh) {
      if (o.isSkinnedMesh || o.isInstancedMesh) return false;
      if (o.userData && o.userData.occupant) return false;            // a seated body: vehicles.js owns its show/hide
      if (o.onBeforeRender !== NOOP_RENDER) return false;
      const geo = o.geometry;
      if (!geo || !geo.isBufferGeometry || !geo.attributes.position) return false;
      if (geo.morphAttributes && geo.morphAttributes.position && geo.morphAttributes.position.length) return false;
      const m = o.material;
      if (Array.isArray(m)) {
        for (let i = 0; i < m.length; i++) if (!matOk(m[i]) || isPaint(m[i])) return false;
      } else {
        if (!matOk(m)) return false;
        if (m.visible === false) return true;                         // r128 never draws it
      }
      _found.push(o);
    } else if (o.isPoints || o.isLine || o.isSprite || o.isLOD) return false;
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) if (!collect(ch[i])) return false;
    return true;
  }

  /* ---- the shared paint --------------------------------------------------
     Signature = every property that shapes the paint except its colour. */
  function uuidOf(t) { return t ? t.uuid : "-"; }
  function emissiveK(m) {
    if (!m.emissive) return 0;
    const c = m.color, e = m.emissive, cs = c.r + c.g + c.b;
    if (cs <= 1e-6) return (e.r + e.g + e.b) <= 1e-6 ? 0 : -1;
    const k = (e.r + e.g + e.b) / cs;
    if (Math.abs(e.r - k * c.r) > 1e-4 || Math.abs(e.g - k * c.g) > 1e-4 || Math.abs(e.b - k * c.b) > 1e-4) return -1;
    return k;
  }
  function paintSig(m, k) {
    return [m.type, m.side, m.flatShading ? 1 : 0, m.transparent ? 1 : 0, m.opacity, m.depthWrite ? 1 : 0,
      m.depthTest ? 1 : 0, m.blending, m.alphaTest, m.fog ? 1 : 0, m.wireframe ? 1 : 0,
      m.polygonOffset ? m.polygonOffsetFactor + "/" + m.polygonOffsetUnits : 0,
      m.roughness, m.metalness, m.clearcoat, m.clearcoatRoughness, m.reflectivity, m.envMapIntensity,
      m.emissiveIntensity, m.transmission, m.sheen ? 1 : 0, Math.round(k * 1e5),
      uuidOf(m.map), uuidOf(m.envMap), uuidOf(m.normalMap), uuidOf(m.roughnessMap), uuidOf(m.metalnessMap),
      uuidOf(m.clearcoatMap), uuidOf(m.clearcoatNormalMap), uuidOf(m.clearcoatRoughnessMap), uuidOf(m.aoMap),
      uuidOf(m.emissiveMap), uuidOf(m.alphaMap), uuidOf(m.bumpMap), uuidOf(m.lightMap),
      m.onBeforeCompile ? String(m.onBeforeCompile).length : 0].join(",");
  }
  function paintEmissive(sh) {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor;\n#endif");
  }
  // null = this paint cannot be shared (it keeps its own material)
  function paintKey(m) {
    if (!m.color || m.vertexColors) return null;
    const k = emissiveK(m);
    if (k < 0) return null;
    return "P" + paintSig(m, k);
  }
  function paintShared(sig, src) {
    let rec = paintMats.get(sig);
    if (rec) return rec;
    const k = emissiveK(src);
    const mat = src.clone();
    mat.color.setRGB(1, 1, 1);
    if (mat.emissive) mat.emissive.setRGB(k, k, k);
    const prev = src.onBeforeCompile && src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? src.onBeforeCompile : null;
    mat.onBeforeCompile = prev ? function (sh, r) { prev.call(this, sh, r); paintEmissive(sh); } : paintEmissive;
    const prevKey = prev ? String(prev) : "";
    mat.customProgramCacheKey = function () { return "cbzCarInstPaint|" + prevKey; };
    mat._shared = true; mat._bodyPaint = false; mat._carInstancePaint = true;
    mat.name = "car-instance-paint";
    rec = { mat: mat, refs: 0 };
    paintMats.set(sig, rec);
    return rec;
  }

  /* ---- pools ------------------------------------------------------------- */
  function makeMesh(p, cap) {
    const mesh = new THREE.InstancedMesh(p.geo, p.mat, cap);
    if (mesh.instanceMatrix.setUsage && THREE.DynamicDrawUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (p.colored) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      if (mesh.instanceColor.setUsage && THREE.DynamicDrawUsage) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;                  // culled per car here (see header)
    mesh.castShadow = p.cast; mesh.receiveShadow = p.recv;
    mesh.renderOrder = p.order;
    if (p.neg) mesh.scale.x = -1;                // mirrored parts: r128 flips the winding off the OBJECT's determinant
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.raycast = noRaycast;                    // the hidden real car still answers every raycast
    mesh.name = "car-instances";
    mesh.userData.carInstancePool = true;
    return mesh;
  }
  function getPool(key, src, geo, paint, neg, paintSigKey) {
    let p = pools.get(key);
    if (p) return p;
    p = {
      key: key, geo: geo, mat: null, paintRec: null, colored: false,
      cast: !!src.castShadow, recv: !!src.receiveShadow, order: src.renderOrder | 0, neg: neg,
      mesh: null, cap: 0, members: [], dirty: true, emptyAt: 0, warmUntil: frame + 3,
    };
    if (paint) { p.paintRec = paintShared(paintSigKey, src.material); p.paintRec.refs++; p.mat = p.paintRec.mat; p.colored = true; }
    else p.mat = src.material;
    p.cap = CHUNK;
    p.mesh = makeMesh(p, p.cap);
    CBZ.scene.add(p.mesh);
    pools.set(key, p); poolList.push(p);
    newPoolsThisFrame++;
    return p;
  }
  function grow(p, need) {
    if (need <= p.cap) return;
    let cap = p.cap;
    while (cap < need) cap *= 2;
    const old = p.mesh;
    p.cap = cap;
    p.mesh = makeMesh(p, cap);
    if (old.parent) old.parent.add(p.mesh);
    if (old.parent) old.parent.remove(old);
    old.dispose();                               // frees ONLY the instance buffers (geometry/material are shared)
    p.dirty = true;
  }
  function dropPool(p) {
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    p.mesh.dispose();
    pools.delete(p.key);
    const i = poolList.indexOf(p);
    if (i >= 0) { poolList[i] = poolList[poolList.length - 1]; poolList.pop(); }
    if (p.paintRec && --p.paintRec.refs <= 0) {
      for (const [sig, rec] of paintMats) if (rec === p.paintRec) { paintMats.delete(sig); break; }
      p.paintRec.mat.dispose();
    }
  }
  // write the pool's drawn instances contiguously (in-view members only)
  function rebuild(p) {
    const arr = p.mesh.instanceMatrix.array;
    const col = p.colored ? p.mesh.instanceColor.array : null;
    const all = fullDraw || p.cast;             // a caster may shadow into view from off-screen
    let n = 0;
    if (p.warmUntil && !p.members.length) {      // compile-only draw: one instance collapsed to a point far below the map
      arr.set(WARM, 0);
      if (col) { col[0] = col[1] = col[2] = 1; }
      p.mesh.count = 1; p.mesh.visible = true;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (col) p.mesh.instanceColor.needsUpdate = true;
      p.dirty = false;
      return;
    }
    for (let i = 0; i < p.members.length; i++) {
      const e = p.members[i];
      if (!all && !e.rec.inView) continue;
      arr.set(e.m, n * 16);
      if (col) { col[n * 3] = e.cr; col[n * 3 + 1] = e.cg; col[n * 3 + 2] = e.cb; }
      n++;
    }
    p.mesh.count = n;
    p.mesh.visible = n > 0;
    p.mesh.instanceMatrix.needsUpdate = true;
    if (col) p.mesh.instanceColor.needsUpdate = true;
    p.dirty = false;
    if (!p.members.length && !p.emptyAt) p.emptyAt = frame || 1;
  }

  /* ---- records ------------------------------------------------------------ */
  function newEntry() {
    return freeEntries.pop() || { pool: null, idx: -1, rec: null, src: null, mat: null, geo: null, paint: false,
      m: new Float32Array(16), cr: 1, cg: 1, cb: 1 };
  }
  function newRec() {
    return freeRecs.pop() || { car: null, entries: [], cx: 0, cy: 0, cz: 0, r: 0, inView: true, px: 0, pz: 0, ph: 0,
      gx: 0, gy: 0, gz: 0, rx: 0, ry: 0, rz: 0, vis: null, gch: 0, vch: 0, lod: false, lodPending: false };
  }
  function carDist2(c) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
    return dx * dx + dz * dz;
  }
  function frustumReady() {
    const cam = CBZ.camera;
    if (!cam || !cam.projectionMatrix) return false;
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    return true;
  }
  // side + near planes only (r128 plane order: 0 right, 1 left, 2 bottom, 3 top, 4 far, 5 near)
  function sphereInView(r) {
    const P = _fr.planes;
    _v.set(r.cx, r.cy, r.cz);
    const rad = -(r.r + CULL_PAD);
    return P[0].distanceToPoint(_v) >= rad && P[1].distanceToPoint(_v) >= rad && P[5].distanceToPoint(_v) >= rad;
  }

  /* ACQUIRE: vehicles.js calls this for a settled, sleepable, awake parked car
     past PROXY_IN. Returns true when the car is now drawn by the pools. */
  function acquire(c) {
    if (!c || c._proxy || c._sleep || !c.group || !c.pos || !ready()) return false;
    if (c._proxyRetry && frame < c._proxyRetry) return false;       // refused or invalidated recently
    const grp = c.group;
    if (grp.visible === false || !grp.parent) return false;
    const d2 = carDist2(c);
    if (d2 <= PROXY_IN2 || d2 >= SLEEP_D2) return false;
    // the real car is captured at full detail; the pools pick the tier (carlod.js)
    if (CBZ.carLodRestore) CBZ.carLodRestore(c);
    const L = CBZ.carLod, lod = !!(L && L.wantLod(d2, false));
    let lodPending = false;
    _found.length = 0; _keys.length = 0; _sigs.length = 0; _negs.length = 0; _geos.length = 0;
    if (!collect(grp) || !_found.length) { _found.length = 0; c._proxyRetry = frame + 120; return false; }
    // world matrices straight from the transforms (updateWorldMatrix is not
    // subject to core/matrixskip's hidden/stamped skips)
    grp.updateWorldMatrix(true, true);
    let missing = 0;
    for (let i = 0; i < _found.length; i++) {
      const o = _found[i], m = o.material;
      let mk, paint = false, sig = null;
      if (Array.isArray(m)) { mk = "A"; for (let j = 0; j < m.length; j++) mk += m[j].id + ","; }
      else if (isPaint(m) && (sig = paintKey(m))) { mk = sig; paint = true; }
      else mk = "M" + m.id;
      const neg = o.matrixWorld.determinant() < 0;
      // FAR TIER: the same mesh drawn with its simplified twin (null = still being built -> full)
      let geo = o.geometry;
      if (lod) {
        const lg = L.lodOf(geo, L.relScale(o, grp), m);
        if (lg) geo = lg; else lodPending = true;
      }
      _geos.push(geo);
      const key = geo.id + "|" + mk + "|" + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + "|" + (o.renderOrder | 0) + "|" + (neg ? "n" : "p");
      _keys.push(key); _sigs.push(paint ? sig : null); _negs.push(neg);
      if (!pools.has(key)) {
        // A NEW POOL IS A NEW SHADER VARIANT (instancing, + instanceColor for
        // paint). It is created now and WARMS for a couple of frames (drawn
        // with one zero-scale instance, so r128 compiles its program), at most
        // NEW_POOLS_PER_FRAME per frame; the car proxies once all of its pools
        // exist. The first sight of a style never compiles 20 programs at once.
        if (newPoolsThisFrame < NEW_POOLS_PER_FRAME) getPool(key, o, geo, paint, neg, sig);
        missing++;
      } else if (pools.get(key).warmUntil) missing++;
    }
    // Its pools are still warming (3 frames) or not made yet (2 per frame).
    // Nothing this walk found can change before a pool warms, so ask again
    // then, not on every frame in between: the retry re-walked the whole car,
    // re-composed its world matrices and rebuilt a key string per mesh, for
    // every waiting car, every frame (the top cost under vehicles.js's
    // traffic pass while driving). The car draws itself meanwhile, as before.
    if (missing) { _found.length = 0; c._proxyRetry = frame + 3; return false; }
    const view = frustumReady();
    const rec = newRec();
    rec.car = c;
    rec.px = c.pos.x; rec.pz = c.pos.z; rec.ph = c.heading;
    rec.gx = grp.position.x; rec.gy = grp.position.y; rec.gz = grp.position.z;
    rec.rx = grp.rotation.x; rec.ry = grp.rotation.y; rec.rz = grp.rotation.z;
    rec.vis = (grp.userData && grp.userData.carVisual) || null;
    rec.gch = grp.children.length; rec.vch = rec.vis ? rec.vis.children.length : 0;
    grp.getWorldPosition(_v2);
    rec.cx = _v2.x; rec.cy = _v2.y; rec.cz = _v2.z;
    let rad = 0;
    for (let i = 0; i < _found.length; i++) {
      const o = _found[i], mw = o.matrixWorld, key = _keys[i];
      const m = o.material, sig = _sigs[i], paint = sig !== null;
      const p = getPool(key, o, _geos[i], paint, _negs[i], sig);
      const e = newEntry();
      e.pool = p; e.rec = rec; e.src = o; e.mat = m; e.geo = o.geometry; e.paint = paint;
      const src = mw.elements, dst = e.m;
      for (let k = 0; k < 16; k++) dst[k] = src[k];
      if (p.neg) { dst[0] = -dst[0]; dst[4] = -dst[4]; dst[8] = -dst[8]; dst[12] = -dst[12]; }   // pool carries scale.x = -1
      if (paint) { e.cr = m.color.r; e.cg = m.color.g; e.cb = m.color.b; }
      e.idx = p.members.length;
      p.members.push(e);
      if (p.members.length > p.cap) grow(p, p.members.length);
      p.dirty = true; p.emptyAt = 0;
      rec.entries.push(e);
      // car sphere: bounds every mesh's own sphere in world space
      const geo = o.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const bs = geo.boundingSphere;
      _v.copy(bs.center).applyMatrix4(mw);
      const d = Math.sqrt((_v.x - rec.cx) * (_v.x - rec.cx) + (_v.y - rec.cy) * (_v.y - rec.cy) + (_v.z - rec.cz) * (_v.z - rec.cz));
      rad = Math.max(rad, d + bs.radius * mw.getMaxScaleOnAxis());
    }
    rec.r = rad;
    rec.inView = view ? sphereInView(rec) : true;
    rec.lod = lod; rec.lodPending = lodPending;
    _found.length = 0; _keys.length = 0; _sigs.length = 0; _geos.length = 0;
    grp.visible = false;
    c._proxy = true;
    proxies.push(rec);
    c._proxyRec = rec;
    return true;
  }

  /* RELEASE: the car draws itself again (group shown), instances gone. */
  function release(c) {
    if (!c || !c._proxy) return;
    const rec = c._proxyRec;
    c._proxy = false; c._proxyRec = null;
    if (c.group) c.group.visible = true;
    if (!rec) return;
    for (let i = 0; i < rec.entries.length; i++) {
      const e = rec.entries[i], p = e.pool, mem = p.members;
      const last = mem.pop();                    // swap-remove
      if (last !== e) { mem[e.idx] = last; last.idx = e.idx; }
      p.dirty = true;
      e.pool = null; e.rec = null; e.src = null; e.mat = null; e.geo = null; e.idx = -1;
      freeEntries.push(e);
    }
    rec.entries.length = 0; rec.car = null; rec.vis = null;
    const k = proxies.indexOf(rec);
    if (k >= 0) { proxies[k] = proxies[proxies.length - 1]; proxies.pop(); }
    freeRecs.push(rec);
  }
  function releaseAll() {
    while (proxies.length) {
      const r = proxies[proxies.length - 1];
      if (r.car) release(r.car); else proxies.pop();
    }
  }

  // Is this proxy still exactly the car it was captured from?
  function stillExact(rec) {
    const c = rec.car, grp = c.group;
    if (!grp || grp.visible !== false || !grp.parent || c.dead) return false;
    if (c.pos.x !== rec.px || c.pos.z !== rec.pz || c.heading !== rec.ph) return false;
    if (grp.position.x !== rec.gx || grp.position.y !== rec.gy || grp.position.z !== rec.gz) return false;
    if (grp.rotation.x !== rec.rx || grp.rotation.y !== rec.ry || grp.rotation.z !== rec.rz) return false;
    const vis = (grp.userData && grp.userData.carVisual) || null;
    if (vis !== rec.vis || grp.children.length !== rec.gch || (vis && vis.children.length !== rec.vch)) return false;
    const sl = CBZ.cityCarSleepable;
    if (sl && !sl(c)) return false;
    const E = rec.entries;
    for (let i = 0; i < E.length; i++) {
      const e = E[i], o = e.src;
      if (o.material !== e.mat || o.geometry !== e.geo || o.visible === false || !o.parent) return false;
      if (e.paint) { const col = e.mat.color; if (col.r !== e.cr || col.g !== e.cg || col.b !== e.cb) return false; }
    }
    return true;
  }

  // THE LAST WORD BEFORE THE DRAW: validate, cull, upload.
  function frameTick() {
    frame++;
    newPoolsThisFrame = 0;
    const g = CBZ.game;
    if (!g || g.mode !== "city") {
      if (proxies.length) releaseAll();
      for (let i = 0; i < poolList.length; i++) if (poolList[i].dirty) rebuild(poolList[i]);
      return;
    }
    if (!proxies.length && !poolList.length) return;
    const view = scratch() && frustumReady();
    for (let i = proxies.length - 1; i >= 0; i--) {
      const rec = proxies[i];
      if (i >= proxies.length) continue;          // a release above swapped the list
      const c = rec.car;
      if (!c) { proxies[i] = proxies[proxies.length - 1]; proxies.pop(); continue; }
      // something changed the car: it draws itself, and is not re-captured for
      // ~2 s (a lightbar or anything else that swaps materials on a timer
      // would otherwise be captured and released every other frame)
      if (!stillExact(rec)) { release(c); c._proxyRetry = frame + 120; continue; }
      const d2 = carDist2(c);
      if (d2 < PROXY_OUT2) { release(c); continue; }
      if (d2 > SLEEP_D2) {
        release(c);
        if (CBZ.citySleepCar) CBZ.citySleepCar(c);  // hidden past the ring, exactly like vehicles.js would next frame
        continue;
      }
      // crossed the LOD switch (carlod.js, hysteresis in pixel space), or a
      // far-tier LOD it was waiting on has landed: re-proxy on the right tier.
      // If the other tier's pools are still warming, acquire() refuses and the
      // car draws itself at full detail until vehicles.js re-proxies it.
      const L = CBZ.carLod;
      if (L && (L.wantLod(d2, rec.lod) !== rec.lod || (rec.lodPending && (frame & 63) === 0))) {
        release(c);
        acquire(c);
        continue;
      }
      if (view) {
        const iv = sphereInView(rec);
        if (iv !== rec.inView) {
          rec.inView = iv;
          for (let k = 0; k < rec.entries.length; k++) rec.entries[k].pool.dirty = true;
        }
      }
    }
    for (let i = poolList.length - 1; i >= 0; i--) {
      const p = poolList[i];
      if (p.warmUntil && frame >= p.warmUntil) { p.warmUntil = 0; p.dirty = true; p.emptyAt = 0; }
      if (p.dirty) rebuild(p);
      // an empty pool is kept a while (a car re-proxies on the next block);
      // one empty for ~10 s at 60 fps goes, so crashed/one-off buckets don't pile up
      if (!p.members.length && p.emptyAt && frame - p.emptyAt > 600) dropPool(p);
    }
  }
  if (CBZ.onAlways) CBZ.onAlways(999.5, frameTick);

  // city/cctv.js: a second camera may look where the player is not.
  CBZ.carInstanceFullDraw = function () {
    if (!poolList.length) return;
    fullDraw = true;
    for (let i = 0; i < poolList.length; i++) rebuild(poolList[i]);
    fullDraw = false;
    for (let i = 0; i < poolList.length; i++) poolList[i].dirty = true;   // recompacted before the main draw
  };

  CBZ.carInstances = {
    acquire: acquire, release: release, releaseAll: releaseAll,
    PROXY_IN: PROXY_IN, PROXY_OUT: PROXY_OUT,
    _frameTick: frameTick,                       // exposed for the pure-node bookkeeping check
  };
  CBZ.carInstanceAudit = function () {
    let instances = 0, drawn = 0, drawnPools = 0, tris = 0;
    for (let i = 0; i < poolList.length; i++) {
      const p = poolList[i];
      instances += p.members.length;
      if (p.mesh.visible && p.mesh.count > 0) {
        drawnPools++; drawn += p.mesh.count;
        const g = p.geo, n = g.index ? g.index.count : g.attributes.position.count;
        tris += (n / 3) * p.mesh.count;
      }
    }
    return { proxied: proxies.length, pools: poolList.length, drawnPools: drawnPools, instances: instances,
      drawnInstances: drawn, drawnTris: Math.round(tris), paintMaterials: paintMats.size };
  };
})();
