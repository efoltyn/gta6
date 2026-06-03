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

  function run() {
    const losSet = new Set(CBZ.losBlockers || []);
    const buckets = new Map();      // key -> [mesh,…]
    // snapshot children first (we mutate scene.children as we go)
    const kids = scene.children.slice();
    for (const m of kids) {
      if (!m.isMesh || m.isInstancedMesh) continue;
      if (losSet.has(m)) continue;
      if (m.userData && Object.keys(m.userData).length > 0) continue;  // referenced/interactive
      const key = mergeableKey(m);
      if (!key) continue;
      (buckets.get(key) || buckets.set(key, []).get(key)).push(m);
    }

    let mergedMeshes = 0, removed = 0;
    buckets.forEach((meshes, key) => {
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
      scene.add(mesh);
      meshes.forEach((m) => { scene.remove(m); m.geometry.dispose && m.geometry.dispose(); removed++; });
      mergedMeshes++;
    });

    // the shadow map was baked from the pre-merge scene; force one refresh
    if (CBZ.renderer) CBZ.renderer.shadowMap.needsUpdate = true;
    CBZ.batchStats = { mergedMeshes, removed };
  }

  // Run after every load-time world/entity module has populated the scene.
  // The window 'load' event fires once all scripts have executed, so the
  // scene is fully built. Guard so it can only ever collapse once.
  let done = false;
  function runOnce() { if (done) return; done = true; run(); }
  if (document.readyState === "complete") runOnce();
  else addEventListener("load", runOnce, { once: true });
  CBZ.runStaticBatch = runOnce;
})();
