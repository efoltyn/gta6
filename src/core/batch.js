/* ============================================================
   core/batch.js — one-time static geometry batcher.

   The world is assembled from a couple THOUSAND individual flat-colour
   boxes (trim, bars, slats, clutter…). Each is its own draw call, and at
   ~2200 calls the renderer is CPU/draw-call bound long before it's
   triangle-bound (the whole map is well under 60k tris). Three.js groups
   draws by material but still issues one call per mesh, so the fix is to
   physically MERGE compatible static meshes into a handful of big ones.

   This runs ONCE at load. It is deliberately conservative — a mesh is
   only merged when it is provably inert decoration:
     • a top-level scene Mesh (never a character/light/sprite group)
     • NOT a collider and NOT a LOS blocker (those are referenced by the
       physics + guard-vision raycasters and must keep their identity)
     • opaque, untextured, non-emissive (glow/lamps/FX get recoloured at
       runtime — we leave anything emissive/transparent alone)
     • carries no userData (interactive props stash refs there)
   Everything excluded keeps working exactly as before; we only collapse
   the dumb scenery. Merged meshes are grouped by colour + shadow flags so
   they stay visually identical.

   WALL-BATCH (CBZ.wallBatch, default ON) — the big draw-call win.
   ~96% of city draw calls are the STATIC SHELL: per-storey per-face wall
   boxes, floor/roof slabs, parapets, plinths, headers — every one a
   separate mesh because it's referenced by a collider and/or the guard-LOS
   raycaster, so the inert pass above SKIPS them all (6k+ collider refs +
   5k+ LOS refs). The flag-gated pass below collapses the ones that are
   PROVABLY STATIC FOR THE WHOLE SESSION using two verified r128 facts:
     (1) THREE.Raycaster does NOT skip visible=false meshes (only a
         layers.test, no visible check) — so an original wall can render
         NOTHING (0 draw calls) yet still be hit by NPC line-of-sight rays
         (CBZ.losBlockers) and stay a live collider.ref backpointer.
     (2) Collision + camera-occlusion here are RECT-based (collider AABBs
         carry {minX..y1, ref}); resolution reads the NUMBERS, never the
         mesh geometry. So hiding the render mesh leaves physics intact.
   We therefore: group the static-structural wall/slab meshes by building
   (so off-screen blocks still frustum-cull) + colour/shadow/vertexColors,
   bake a merged copy into world space parented to the (identity) city
   root, give it a bounding sphere, and set every original visible=false
   (kept in the graph — NOT removed/disposed — so LOS rays, collider.ref
   and camera all keep working). Net: originals draw nothing, the city
   draws in a handful of calls.

   What is EXCLUDED from the wall pass (must NOT be frozen):
     • CARVEABLE walls — any opaque wall box a runtime hole could punch
       (cityFracture.carveHole / RPG cityBreach pick a collider with
       y1!=null, height ≥ ~1.0, min-horizontal-extent ≤ 0.9, opaque, and
       then TOGGLE wall.visible + read wall.material/.parent). Merging a
       wall whose render copy is shared would freeze it shut on a hit.
     • door leaves / elevator parts / anything that MOVES or swaps material
       at runtime (door leaves are carveable-thin → already excluded;
       buttons/lamps are emissive → already excluded; both are also nested
       below the building group, so the direct-child guard re-excludes).
     • textured / transparent / emissive / array-material / userData meshes
       (same guards as the inert pass).
   The memory cost is the originals (kept, invisible) + the merged copies —
   geometry is duplicated, but the city is <60k tris so the extra buffers
   are cheap (a few MB) and the draw-call win is the whole point.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // ---- WALL-BATCH master switch -----------------------------------------
  // Default ON: collapse the provably-static structural shell too. Flip to
  // false (e.g. CBZ.wallBatch = false before mode reset, or hard-code here)
  // to fall back to the original behaviour — inert deco merged, every
  // collider/LOS wall kept as its own draw call. Read live inside run() so
  // a console toggle before the city's first batch takes effect.
  if (CBZ.wallBatch === undefined) CBZ.wallBatch = true;

  // mergeableKey decides the visually-identical bucket. `allowColored` opens
  // it up for the wall pass: structural LOS boxes carry a fake-AO `color`
  // vertex attribute (vertexColors:true) — historically the reason the
  // batcher SPARED them (the old hand-rolled merge dropped `color`, so a
  // merged shaded wall rendered black). We now propagate `color`, so a wall
  // is mergeable as long as we bucket coloured + non-coloured separately
  // (a bucket must be homogeneous or BufferGeometryUtils/our splice would
  // mismatch attribute counts). The inert deco pass keeps allowColored=false
  // so its behaviour is byte-identical to before.
  function mergeableKey(m, allowColored) {
    const mat = m.material;
    if (!mat || Array.isArray(mat)) return null;
    if (mat.map || mat.transparent || mat.opacity < 1) return null;
    if (mat.emissive && mat.emissive.getHex() !== 0) return null;
    if (!allowColored && mat.vertexColors) return null;   // inert pass never merged shaded boxes
    const geo = m.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    const hasColor = !!(geo.attributes.color);
    // colour + shadow behaviour + render side + has-color-attr define a
    // visually-identical, attribute-homogeneous bucket
    return [
      mat.color ? mat.color.getHex() : 0,
      m.castShadow ? 1 : 0,
      m.receiveShadow ? 1 : 0,
      mat.side || 0,
      hasColor ? "c" : "p",
    ].join("|");
  }

  // concatenate position/normal/uv (and, when present, the fake-AO `color`)
  // of several (world-baked) non-indexed BufferGeometries into one. Every
  // geometry in `geos` MUST agree on whether it has a `color` attribute —
  // mergeableKey's bucket key guarantees that, so we sample the first.
  // (BufferGeometryUtils.mergeBufferGeometries exists in r128 via the
  // vendored src/vendor/BufferGeometryUtils.js, but the by-hand splice keeps
  // this pass dependency-free and lets us bake world matrices in place.)
  function mergeGeometries(geos) {
    let nPos = 0;
    for (const g of geos) nPos += g.attributes.position.count;
    const hasColor = !!(geos[0] && geos[0].attributes.color);
    const pos = new Float32Array(nPos * 3);
    const nrm = new Float32Array(nPos * 3);
    const uv = new Float32Array(nPos * 2);
    const col = hasColor ? new Float32Array(nPos * 3) : null;
    let op = 0, ou = 0;
    for (const g of geos) {
      const p = g.attributes.position.array;
      pos.set(p, op);
      const n = g.attributes.normal ? g.attributes.normal.array : null;
      if (n) nrm.set(n, op);
      const t = g.attributes.uv ? g.attributes.uv.array : null;
      if (t) uv.set(t, ou);
      if (col) {
        const c = g.attributes.color;
        if (c) col.set(c.array, op);
        else { for (let i = op, e = op + p.length; i < e; i++) col[i] = 1; }  // missing → full-bright (no-op multiply)
      }
      op += p.length;
      ou += g.attributes.position.count * 2;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return out;
  }

  // Merge eligible meshes found under `target`. When `recurse` is true we walk
  // the whole subtree (used for the city, whose thousands of static boxes live
  // nested inside building groups under one root that loads AFTER the page —
  // so the top-level load-time pass below never reached them). Merged meshes are
  // baked to WORLD space and re-parented to `target`, so they inherit its
  // mode-visibility toggle (A.root.visible) while costing one draw call apiece.
  function run(target, recurse) {
    target = target || scene;
    const wallBatch = !!CBZ.wallBatch && recurse;   // only the recursive city pass walls-batches
    const losSet = new Set(CBZ.losBlockers || []);
    // every mesh a collider points back to (buildings register colliders with a
    // `ref` mesh but no userData tag, so this is the only way to spare them) —
    // and platforms, which are stood on. Merging these would orphan the physics
    // /camera-occlusion reference. Keep every referenced mesh's identity.
    const refSet = new Set();
    for (const c of (CBZ.colliders || [])) if (c && c.ref) refSet.add(c.ref);
    for (const p of (CBZ.platforms || [])) if (p && p.ref) refSet.add(p.ref);

    // ---- CARVEABLE-WALL lookup (wall pass only) ----------------------------
    // A wall mesh is "carveable" if some collider that points at it matches the
    // EXACT filter cityFracture.carveHole / RPG cityBreach use to pick a wall to
    // punch a runtime hole through (they then TOGGLE wall.visible + read
    // wall.material/.parent). We mirror that filter verbatim — the UNION of
    // carveHole (height ≥ 1.6) and fracture.resolve (height ≥ 1.0), i.e. the
    // looser 1.0 — and refuse to merge any wall a hole could ever reach, since
    // a shared merged copy can't be punched on a per-wall basis.
    const carveable = new Set();
    if (wallBatch) {
      const cs = CBZ.colliders || [];
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (!c || !c.ref || c.y1 == null) continue;
        if (c.y1 - c.y0 < 1.0) continue;                                  // sills/furniture aren't walls
        if (Math.min(c.maxX - c.minX, c.maxZ - c.minZ) > 0.9) continue;  // thick = counters/plinths (NOT carved)
        const mt = c.ref.material;
        if (mt && (Array.isArray(mt) ? false : mt.transparent)) continue; // glass/doors run their own systems
        carveable.add(c.ref);
      }
    }

    // building-group bucketing: the wall pass merges PER top-level building group
    // so off-screen blocks still frustum-cull (a single city-spanning mesh never
    // would, and its verts still hit the shader on a weak GPU). `grpIndex` maps
    // each candidate to the index of its ancestor that is a direct child of the
    // city root; the inert deco pass ignores this and merges city-wide (groupKey
    // "" → one bucket per colour, exactly as before).
    const grpIndexOf = new Map();   // top-level group object -> stable index
    function topGroupIndex(m) {
      let o = m, prev = m;
      while (o && o.parent && o.parent !== target) { prev = o; o = o.parent; }
      const g = (o && o.parent === target) ? o : prev;   // direct child of the root
      let gi = grpIndexOf.get(g);
      if (gi === undefined) { gi = grpIndexOf.size; grpIndexOf.set(g, gi); }
      return { gi, top: g };
    }

    const buckets = new Map();      // key -> {meshes:[…], hide:bool}

    function add(key, m, hide) {
      let b = buckets.get(key);
      if (!b) { b = { meshes: [], hide: hide }; buckets.set(key, b); }
      b.meshes.push(m);
    }

    function consider(m) {
      if (!m.isMesh || m.isInstancedMesh) return;
      const referenced = losSet.has(m) || refSet.has(m);
      if (referenced) {
        // INERT path can't touch referenced meshes. The WALL path may — but only
        // for provably-static structural boxes that NO runtime system mutates.
        if (!wallBatch) return;
        if (carveable.has(m)) return;                                  // a hole could punch it → keep live
        if (m.userData && m.userData.collider) return;                 // explicit physics box tag — keep identity
        // structural boxes that DON'T move never carry interactive userData; any
        // userData here means an interactive/elevator/door prop — leave it alone.
        if (m.userData && Object.keys(m.userData).length > 0) return;
        const key = mergeableKey(m, true);
        if (!key) return;
        // bucket PER BUILDING so each merged shell frustum-culls independently.
        const tg = topGroupIndex(m);
        add("W" + tg.gi + "|" + key, m, true);   // hide=true: original stays for LOS/collider, draws nothing
        return;
      }
      if (m.userData && Object.keys(m.userData).length > 0) return;  // referenced/interactive
      if (m.userData && m.userData.collider) return;                 // physics box — keep identity
      const key = mergeableKey(m, false);
      if (!key) return;
      add(key, m, false);                          // inert deco: removed outright (unchanged)
    }
    function walk(o) {
      // never descend into a subtree flagged dynamic (peds/cars/crowd rigs that
      // move every frame — baking them static would freeze them in place).
      if (o.userData && o.userData.dynamic) return;
      if (o.isMesh) { consider(o); return; }
      const kids = o.children ? o.children.slice() : [];
      for (const c of kids) walk(c);
    }
    if (recurse) { for (const c of target.children.slice()) walk(c); }
    else { for (const m of target.children.slice()) consider(m); }

    let mergedMeshes = 0, removed = 0, wallMerged = 0, wallHidden = 0;
    buckets.forEach((b) => {
      const meshes = b.meshes;
      if (meshes.length < 2) return;              // nothing to gain
      const geos = meshes.map((m) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);            // bake into world space (transforms normals too)
        return g;
      });
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose && g.dispose());
      const proto = meshes[0];
      const mesh = new THREE.Mesh(merged, proto.material);
      mesh.castShadow = proto.castShadow;         // invisible originals can't cast — merged copy carries it
      mesh.receiveShadow = proto.receiveShadow;
      mesh.matrixAutoUpdate = false;              // static — skip per-frame matrix work
      // a merged-per-building shell needs a bounding sphere or frustum culling
      // can't reject it; computeBoundingSphere walks the baked world verts.
      merged.computeBoundingSphere();
      target.add(mesh);                           // baked to world space; target is identity
      if (b.hide) {
        // WALL pass: KEEP the originals (LOS raycasts hit visible=false meshes in
        // r128; collider.ref + camera-occlusion read rects, not the mesh) — just
        // stop them drawing. Do NOT remove from the graph or dispose geometry.
        meshes.forEach((m) => { m.visible = false; wallHidden++; });
        wallMerged++;
      } else {
        // INERT deco: nothing references these — remove + dispose outright.
        meshes.forEach((m) => { if (m.parent) m.parent.remove(m); m.geometry.dispose && m.geometry.dispose(); removed++; });
        mergedMeshes++;
      }
    });

    // the shadow map was baked from the pre-merge scene; force one refresh
    if (CBZ.renderer) CBZ.renderer.shadowMap.needsUpdate = true;
    const prev = CBZ.batchStats || { mergedMeshes: 0, removed: 0, wallMerged: 0, wallHidden: 0 };
    CBZ.batchStats = {
      mergedMeshes: (prev.mergedMeshes || 0) + mergedMeshes,
      removed: (prev.removed || 0) + removed,
      wallMerged: (prev.wallMerged || 0) + wallMerged,     // merged structural shells added
      wallHidden: (prev.wallHidden || 0) + wallHidden,     // originals hidden (kept for LOS/collision)
    };
    return { mergedMeshes, removed, wallMerged, wallHidden };
  }

  // Collapse the static geometry under a freshly-built root (the city). Call
  // ONCE, after the world is assembled but BEFORE any dynamic actors (peds /
  // cars) are added to it — they'd otherwise be baked static. Idempotent guard
  // per-root so a re-entered mode can't double-merge.
  CBZ.batchStaticUnder = function (root) {
    if (!root || root.userData._batched) return null;
    root.userData._batched = true;
    return run(root, true);
  };

  // Run after every load-time world/entity module has populated the scene.
  // The window 'load' event fires once all scripts have executed, so the
  // scene is fully built. Guard so it can only ever collapse once.
  let done = false;
  function runOnce() { if (done) return; done = true; run(); }
  if (document.readyState === "complete") runOnce();
  else addEventListener("load", runOnce, { once: true });
  CBZ.runStaticBatch = runOnce;
})();
