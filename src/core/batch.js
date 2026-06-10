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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  function mergeableKey(m) {
    const mat = m.material;
    if (!mat || Array.isArray(mat)) return null;
    if (mat.map || mat.transparent || mat.opacity < 1) return null;
    if (mat.emissive && mat.emissive.getHex() !== 0) return null;
    const geo = m.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    // colour + shadow behaviour + render side define a visually-identical bucket
    return [
      mat.color ? mat.color.getHex() : 0,
      m.castShadow ? 1 : 0,
      m.receiveShadow ? 1 : 0,
      mat.side || 0,
    ].join("|");
  }

  // concatenate position/normal/uv of several (world-baked) non-indexed
  // BufferGeometries into one. r128 ships no BufferGeometryUtils on the page,
  // so we do the splice by hand — boxes/cylinders all expose these three.
  function mergeGeometries(geos) {
    let nPos = 0;
    for (const g of geos) nPos += g.attributes.position.count;
    const pos = new Float32Array(nPos * 3);
    const nrm = new Float32Array(nPos * 3);
    const uv = new Float32Array(nPos * 2);
    let op = 0, ou = 0;
    for (const g of geos) {
      const p = g.attributes.position.array;
      pos.set(p, op);
      const n = g.attributes.normal ? g.attributes.normal.array : null;
      if (n) nrm.set(n, op);
      const t = g.attributes.uv ? g.attributes.uv.array : null;
      if (t) uv.set(t, ou);
      op += p.length;
      ou += g.attributes.position.count * 2;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
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
    const losSet = new Set(CBZ.losBlockers || []);
    // every mesh a collider points back to (buildings register colliders with a
    // `ref` mesh but no userData tag, so this is the only way to spare them) —
    // and platforms, which are stood on. Merging these would orphan the physics
    // /camera-occlusion reference. Keep every referenced mesh's identity.
    const refSet = new Set();
    for (const c of (CBZ.colliders || [])) if (c && c.ref) refSet.add(c.ref);
    for (const p of (CBZ.platforms || [])) if (p && p.ref) refSet.add(p.ref);
    const buckets = new Map();      // key -> [mesh,…]

    function consider(m) {
      if (!m.isMesh || m.isInstancedMesh) return;
      if (losSet.has(m) || refSet.has(m)) return;
      if (m.userData && Object.keys(m.userData).length > 0) return;  // referenced/interactive
      if (m.userData && m.userData.collider) return;                 // physics box — keep identity
      const key = mergeableKey(m);
      if (!key) return;
      (buckets.get(key) || buckets.set(key, []).get(key)).push(m);
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

    let mergedMeshes = 0, removed = 0;
    buckets.forEach((meshes) => {
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
      mesh.castShadow = proto.castShadow;
      mesh.receiveShadow = proto.receiveShadow;
      mesh.matrixAutoUpdate = false;              // static — skip per-frame matrix work
      target.add(mesh);                           // baked to world space; target is identity
      meshes.forEach((m) => { if (m.parent) m.parent.remove(m); m.geometry.dispose && m.geometry.dispose(); removed++; });
      mergedMeshes++;
    });

    // the shadow map was baked from the pre-merge scene; force one refresh
    if (CBZ.renderer) CBZ.renderer.shadowMap.needsUpdate = true;
    const prev = CBZ.batchStats || { mergedMeshes: 0, removed: 0 };
    CBZ.batchStats = { mergedMeshes: prev.mergedMeshes + mergedMeshes, removed: prev.removed + removed };
    return { mergedMeshes, removed };
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
