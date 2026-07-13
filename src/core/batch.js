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

  // ---- BATCH-V2 (draw-call collapse, 2026-07) -----------------------------
  // Three measured upgrades over the original pass, one flag
  // (CBZ.CONFIG.BATCH_V2, default ON; OFF = the original behaviour verbatim):
  //   1) CROSS-COLOR MERGE: the old buckets split by material colour, and the
  //      hash-tinted palettes make nearly every colour unique (~19.5k distinct
  //      materials measured) — so buckets stayed tiny and ~1.9k static meshes
  //      still drew individually. V2 bakes material.color INTO the vertex
  //      `color` attribute (multiplying the fake-AO shade when present) and
  //      merges across colours with one shared white vertexColors material
  //      per (materialType|shadow|side) — mathematically the same shaded
  //      pixel: lambert = light × matColor × vColor either way.
  //   2) CARVEABLE WALLS MERGE TOO: the majority of a building shell was
  //      deliberately left un-merged so cityFracture.carveHole could hide ONE
  //      wall (wall.visible=false). V2 merges them and records each wall's
  //      vertex range in the merged buffer; CBZ.batchWallHide/Show zero and
  //      restore that slice (same trick batchHideGroup already uses for
  //      whole buildings), and buildings.js's carve/reset call them.
  //   3) TILED INERT BUCKETS: inert deco used to merge into CITY-WIDE colour
  //      buckets whose bounding spheres spanned the map — never frustum- or
  //      far-culled, ~1M triangles always drawn at every tier. V2 buckets
  //      per 112u ground tile; each tile mesh is a direct child of the root
  //      with a tight bounding sphere, so frustum culling AND core/farcull
  //      finally reject the far ones.
  //   Also: subtrees whose GROUP is a collider ref (knockable street props —
  //   cans/cones/meters tip by moving the group) are skipped entirely; the
  //   old pass merged some of their meshes away, which froze far-town props
  //   mid-air when a car clipped them.
  if (CBZ.CONFIG && CBZ.CONFIG.BATCH_V2 == null) CBZ.CONFIG.BATCH_V2 = true;
  const TILE = 112;   // inert-bucket tile size (world units)

  // ---- PER-GROUP MERGE LEDGER (demolition support) -----------------------
  // The merges below are one-way: inert deco is disposed into city-wide
  // colour buckets, wall shells into per-building merged copies parented to
  // the root. That makes "remove ONE building" impossible after the fact —
  // unless we remember, at merge time, which slice of which merged buffer
  // each top-level group contributed. groupRanges does exactly that:
  //   topGroup → [ {mesh, whole:true}            (wall-pass merged copy —
  //                                               the whole mesh is one
  //                                               building's shell)
  //              | {mesh, start, count} ]        (vertex range inside a
  //                                               shared inert-deco mesh)
  // CBZ.batchHideGroup(g)/batchShowGroup(g) then hide/restore a building's
  // batched geometry: whole meshes flip .visible; shared ranges stash their
  // position slice and zero it (all verts collapse to the origin → zero-area
  // triangles → nothing rasterizes), reversibly. Zero draw-call cost either
  // way — the buffers stay merged.
  const groupRanges = new WeakMap();
  function addRange(top, entry) {
    if (!top) return;
    let arr = groupRanges.get(top);
    if (!arr) { arr = []; groupRanges.set(top, arr); }
    arr.push(entry);
  }
  CBZ.batchHideGroup = function (top) {
    const arr = groupRanges.get(top);
    if (!arr) return 0;
    let n = 0;
    for (const e of arr) {
      if (e.whole) { if (e.mesh.visible) { e.mesh.visible = false; n++; } continue; }
      if (e._stash) continue;                       // already hidden
      const attr = e.mesh.geometry.attributes.position;
      const i0 = e.start * 3, i1 = (e.start + e.count) * 3;
      e._stash = attr.array.slice(i0, i1);          // keep the verts for restore
      attr.array.fill(0, i0, i1);
      attr.needsUpdate = true; n++;
    }
    return n;
  };
  CBZ.batchShowGroup = function (top) {
    const arr = groupRanges.get(top);
    if (!arr) return 0;
    let n = 0;
    for (const e of arr) {
      if (e.whole) { if (!e.mesh.visible) { e.mesh.visible = true; n++; } continue; }
      if (!e._stash) continue;
      const attr = e.mesh.geometry.attributes.position;
      attr.array.set(e._stash, e.start * 3);
      e._stash = null;
      attr.needsUpdate = true; n++;
    }
    return n;
  };

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

  // V2 bucket key: NO colour (it gets baked into vertex colours — see
  // mergeGeometriesV2), so a whole palette collapses into one bucket per
  // lighting-identical class. Material TYPE is in the key because Basic
  // (unlit) and Lambert (lit) genuinely shade differently, as is fog
  // participation and side.
  function mergeableKeyV2(m) {
    const mat = m.material;
    if (!mat || Array.isArray(mat)) return null;
    if (mat.map || mat.transparent || mat.opacity < 1) return null;
    if (mat.emissive && mat.emissive.getHex() !== 0) return null;
    if (!(mat.isMeshLambertMaterial || mat.isMeshBasicMaterial)) return null; // Standard/Phong keep their look
    const geo = m.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    return [
      mat.isMeshBasicMaterial ? "B" : "L",
      m.castShadow ? 1 : 0,
      m.receiveShadow ? 1 : 0,
      mat.side || 0,
      mat.fog === false ? 0 : 1,
    ].join("|");
  }

  // shared white vertex-colour materials for V2 merged output, one per class
  const _v2Mats = new Map();
  function v2Material(key) {
    let mt = _v2Mats.get(key);
    if (mt) return mt;
    const [type, , , side, fog] = key.split("|");
    const opts = { color: 0xffffff, vertexColors: true, side: +side, fog: fog === "1" };
    mt = type === "B" ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts);
    _v2Mats.set(key, mt);
    return mt;
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

  // V2 merge: ALWAYS emits a colour attribute = (existing colour attr or 1) ×
  // that mesh's material colour, so one white shared material renders every
  // source colour identically (lambert/basic multiply colour and vColor).
  // `tints` is parallel to `geos`: the source material colour per geometry.
  function mergeGeometriesV2(geos, tints) {
    let nPos = 0;
    for (const g of geos) nPos += g.attributes.position.count;
    const pos = new Float32Array(nPos * 3);
    const nrm = new Float32Array(nPos * 3);
    const uv = new Float32Array(nPos * 2);
    const col = new Float32Array(nPos * 3);
    let op = 0, ou = 0;
    for (let gi = 0; gi < geos.length; gi++) {
      const g = geos[gi];
      const p = g.attributes.position.array;
      pos.set(p, op);
      const n = g.attributes.normal ? g.attributes.normal.array : null;
      if (n) nrm.set(n, op);
      const t = g.attributes.uv ? g.attributes.uv.array : null;
      if (t) uv.set(t, ou);
      const tint = tints[gi];
      const tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
      const c = g.attributes.color ? g.attributes.color.array : null;
      for (let i = op, s = 0, e = op + p.length; i < e; i += 3, s += 3) {
        col[i] = (c ? c[s] : 1) * tr;
        col[i + 1] = (c ? c[s + 1] : 1) * tg;
        col[i + 2] = (c ? c[s + 2] : 1) * tb;
      }
      op += p.length;
      ou += g.attributes.position.count * 2;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return out;
  }

  // ---- PER-WALL slice ledger (V2 carveable-wall support) -------------------
  // wall mesh -> {mesh: mergedMesh, start, count, _stash} — lets carveHole hide
  // ONE wall inside a merged shell by zeroing its vertex slice (reversible),
  // exactly like batchHideGroup's shared-range path.
  const wallSlices = new WeakMap();
  function sliceSet(rec, hidden) {
    const attr = rec.mesh.geometry.attributes.position;
    const i0 = rec.start * 3, i1 = (rec.start + rec.count) * 3;
    if (hidden) {
      if (rec._stash) return true;             // already hidden
      rec._stash = attr.array.slice(i0, i1);
      attr.array.fill(0, i0, i1);
    } else {
      if (!rec._stash) return true;            // already shown
      attr.array.set(rec._stash, i0);
      rec._stash = null;
    }
    attr.needsUpdate = true;
    return true;
  }
  // Returns true when the wall was batch-merged and the slice op handled it —
  // callers fall back to plain wall.visible toggling when false (flag off,
  // wall not merged, or pre-V2 world).
  CBZ.batchWallHide = function (wall) {
    const rec = wallSlices.get(wall);
    return rec ? sliceSet(rec, true) : false;
  };
  CBZ.batchWallShow = function (wall) {
    const rec = wallSlices.get(wall);
    return rec ? sliceSet(rec, false) : false;
  };

  // Merge eligible meshes found under `target`. When `recurse` is true we walk
  // the whole subtree (used for the city, whose thousands of static boxes live
  // nested inside building groups under one root that loads AFTER the page —
  // so the top-level load-time pass below never reached them). Merged meshes are
  // baked to WORLD space and re-parented to `target`, so they inherit its
  // mode-visibility toggle (A.root.visible) while costing one draw call apiece.
  function run(target, recurse) {
    target = target || scene;
    const v2 = !!(CBZ.CONFIG && CBZ.CONFIG.BATCH_V2);
    const wallBatch = !!CBZ.wallBatch && recurse;   // only the recursive city pass walls-batches
    const losSet = new Set(CBZ.losBlockers || []);
    // groups a collider points back at = props gameplay may SHOVE later
    // (knockable cans/cones/meters tip by writing the group transform); their
    // meshes must never bake into a static buffer. (v2 only — the old pass
    // merged some and far-town knockables visibly froze mid-air when hit.)
    const liveGroups = new Set();
    if (v2) {
      for (const c of (CBZ.colliders || [])) if (c && c.ref && c.ref.isGroup) liveGroups.add(c.ref);
    }
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
    if (wallBatch && !v2) {
      // V2 MERGES carveable walls too — each wall's vertex range is recorded
      // in wallSlices and CBZ.batchWallHide/Show zero/restore it when
      // cityFracture punches or repairs a hole, so the exclusion set is only
      // needed on the legacy path.
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

    const buckets = new Map();      // key -> {meshes:[…], tops:[…], hide:bool}

    function add(key, m, top, hide) {
      let b = buckets.get(key);
      if (!b) { b = { meshes: [], tops: [], hide: hide }; buckets.set(key, b); }
      b.meshes.push(m);
      b.tops.push(top);              // parallel array: which top-level group contributed this mesh
    }

    function consider(m) {
      if (!m.isMesh || m.isInstancedMesh) return;
      const referenced = losSet.has(m) || refSet.has(m);
      if (referenced) {
        // INERT path can't touch referenced meshes. The WALL path may — but only
        // for provably-static structural boxes that NO runtime system mutates.
        if (!wallBatch) return;
        if (!v2 && carveable.has(m)) return;                           // legacy: a hole could punch it → keep live
        if (m.userData && m.userData.collider) return;                 // explicit physics box tag — keep identity
        // structural boxes that DON'T move never carry interactive userData; any
        // userData here means an interactive/elevator/door prop — leave it alone.
        if (m.userData && Object.keys(m.userData).length > 0) return;
        const key = v2 ? mergeableKeyV2(m) : mergeableKey(m, true);
        if (!key) return;
        // bucket PER BUILDING so each merged shell frustum-culls independently.
        const tg = topGroupIndex(m);
        add("W" + tg.gi + "|" + key, m, tg.top, true);   // hide=true: original stays for LOS/collider, draws nothing
        return;
      }
      if (m.userData && Object.keys(m.userData).length > 0) return;  // referenced/interactive
      if (m.userData && m.userData.collider) return;                 // physics box — keep identity
      let key = v2 ? mergeableKeyV2(m) : mergeableKey(m, false);
      if (!key) return;
      if (v2) {
        // per-TILE buckets: each tile mesh gets a tight bounding sphere, so
        // frustum culling and core/farcull can reject the far ones (the old
        // city-wide colour buckets spanned the map and never culled).
        m.updateWorldMatrix(true, false);
        const e = m.matrixWorld.elements;
        key = "T" + Math.floor(e[12] / TILE) + "," + Math.floor(e[14] / TILE) + "|" + key;
      }
      // inert deco: removed outright (unchanged) — but remember whose it was,
      // so batchHideGroup can later zero this building's slice of the shared mesh.
      add(key, m, topGroupIndex(m).top, false);
    }
    function walk(o) {
      // never descend into a subtree flagged dynamic (peds/cars/crowd rigs that
      // move every frame — baking them static would freeze them in place).
      if (o.userData && o.userData.dynamic) return;
      // v2: movers (door hinge pivots) and collider-ref'd groups (knockable
      // props) move at runtime — everything under them stays live.
      if (v2 && ((o.userData && o.userData.mover) || liveGroups.has(o))) return;
      if (o.isMesh) { consider(o); return; }
      const kids = o.children ? o.children.slice() : [];
      for (const c of kids) walk(c);
    }
    if (recurse) { for (const c of target.children.slice()) walk(c); }
    else { for (const m of target.children.slice()) consider(m); }

    let mergedMeshes = 0, removed = 0, wallMerged = 0, wallHidden = 0;
    buckets.forEach((b, bkey) => {
      const meshes = b.meshes;
      if (meshes.length < 2) return;              // nothing to gain
      const tints = v2 ? [] : null;
      const geos = meshes.map((m) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);            // bake into world space (transforms normals too)
        if (v2) tints.push(m.material && m.material.color ? m.material.color : null);
        return g;
      });
      const merged = v2 ? mergeGeometriesV2(geos, tints) : mergeGeometries(geos);
      const proto = meshes[0];
      // v2: shared white vertexColors material per lighting class (the source
      // colour was baked into the verts) — the material half of the key sits
      // after the W<gi>|/T<x>,<z>| prefix.
      const mesh = new THREE.Mesh(merged, v2 ? v2Material(bkey.slice(bkey.indexOf("|") + 1)) : proto.material);
      mesh.name = b.hide ? "batch-wall" : "batch-inert";
      mesh.castShadow = proto.castShadow;         // invisible originals can't cast — merged copy carries it
      mesh.receiveShadow = proto.receiveShadow;
      mesh.matrixAutoUpdate = false;              // static — skip per-frame matrix work
      // a merged-per-building shell (or per-tile bucket) needs a bounding
      // sphere or frustum culling can't reject it.
      merged.computeBoundingSphere();
      target.add(mesh);                           // baked to world space; target is identity
      if (b.hide) {
        // WALL pass: KEEP the originals (LOS raycasts hit visible=false meshes in
        // r128; collider.ref + camera-occlusion read rects, not the mesh) — just
        // stop them drawing. Do NOT remove from the graph or dispose geometry.
        let off = 0;
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i], cnt = geos[i].attributes.position.count;
          // v2: remember each wall's slice so carveHole can hide JUST it later
          if (v2) wallSlices.set(m, { mesh, start: off, count: cnt, _stash: null });
          off += cnt;
          m.visible = false; wallHidden++;
        }
        // the bucket key is per-building ("W<gi>|…") — the whole merged copy
        // belongs to ONE top group; register it for batchHideGroup/ShowGroup.
        addRange(b.tops[0], { mesh, whole: true });
        wallMerged++;
      } else {
        // INERT deco: nothing references these — remove + dispose outright.
        // Before disposing, ledger each top group's vertex range in the shared
        // merged buffer (consecutive meshes from one group coalesce into one
        // range — walk order is depth-first per building, so slices are contiguous).
        let off = 0, runTop = null, runStart = 0;
        for (let i = 0; i < geos.length; i++) {
          const cnt = geos[i].attributes.position.count;
          const top = b.tops[i];
          if (top !== runTop) {
            if (runTop && off > runStart) addRange(runTop, { mesh, start: runStart, count: off - runStart });
            runTop = top; runStart = off;
          }
          off += cnt;
        }
        if (runTop && off > runStart) addRange(runTop, { mesh, start: runStart, count: off - runStart });
        meshes.forEach((m) => { if (m.parent) m.parent.remove(m); m.geometry.dispose && m.geometry.dispose(); removed++; });
        mergedMeshes++;
      }
      geos.forEach((g) => g.dispose && g.dispose());
    });

    // the shadow map was baked from the pre-merge scene; force one refresh
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
    else if (CBZ.renderer) CBZ.renderer.shadowMap.needsUpdate = true;
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
  function runOnce() {
    if (done) return;
    done = true;
    // The jail is a real mode root now, so recurse through it exactly like the
    // lazily-built city. Dynamic inmate/guard subtrees carry userData.dynamic
    // and are skipped; static prison decoration is merged, then matrix-frozen.
    if (CBZ.prisonRoot) {
      CBZ.batchStaticUnder(CBZ.prisonRoot);
      if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(CBZ.prisonRoot);
    }
    // Keep the conservative top-level pass for shared/global scene objects.
    run();
  }
  if (document.readyState === "complete") runOnce();
  else addEventListener("load", runOnce, { once: true });
  CBZ.runStaticBatch = runOnce;
})();
