/* ============================================================
   world/rockscliffs.js — PROCEDURAL FRACTURED ROCKS + SLOPE-AWARE SCATTER.

   WHY THIS EXISTS: the backdrop mountain ring (world/terrain.js) and the
   desert biome (city/biome_desert.js) both want boulders/rock clusters, but
   a plain IcosahedronGeometry (what biome_desert.js's old boulder field
   used) reads as a smooth potato, not a fractured rock. Real-world boulders
   look angular because they SPALL along roughly-planar fracture faces, not
   because they wobble under smooth noise. One shared system fixes that for
   both callers instead of two rock hacks drifting apart.

   TECHNIQUE 1 — THE "SCRAPE" ALGORITHM (modeled on Erkaman/gl-rock):
   Start from a unit icosahedron. Repeat N times: pick a random seed vertex,
   flood-fill outward over the edge-adjacency graph to collect every vertex
   within a given hop-radius, then PROJECT each collected vertex onto a plane
   that passes through the seed vertex (offset inward along the seed's own
   position-as-normal by a random "scrape depth"). Projecting a vertex onto a
   plane is just: move it along the plane normal by -(dot(v-planePoint, n)),
   but only if that pushes it INWARD (so scrapes only ever carve material
   away, never bulge the rock outward) — repeated at random points/radii/
   depths this carves flat chipped facets into the sphere, which is exactly
   the "fractured boulder" look plain displacement noise can't produce (noise
   gives you bumps, not planar chips). This is a ONE-TIME CPU cost at rock
   creation (baked into a static BufferGeometry) — nothing here runs per
   frame.

   TECHNIQUE 2 — SLOPE-AWARE SCATTER (modeled on IceCreamYou/THREE.Terrain's
   ScatterMeshes): candidate points are tested against the ground normal's
   up-component; if the slope exceeds an angle-of-repose cutoff (~35-40deg,
   i.e. the steepest angle loose rock can rest on before sliding), the point
   is rejected — rocks don't spawn plastered on a cliff face. Survivors get
   position + a size-jitter + a random yaw/tilt, then are placed into a
   shared InstancedMesh (a couple of variant geometries/materials cycle by
   index — NOT one draw call per rock; draw-call discipline per repo rule).

   Both callers (terrain.js backdrop peaks, biome_desert.js town outskirts)
   share the SAME rock geometry variants + scatter loop, only differing by
   palette/scale/placement callback — so there is exactly one rock system in
   the codebase, not two.

   Headless-safe: guards on THREE/CBZ; makeRock tolerates a stub geometry
   with zero vertices (returns it unmodified rather than throwing) so a
   minimal test harness never crashes even though this file isn't currently
   in tools/harness.js's load list.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ----------------------------------------------------------------------
  //  DETERMINISTIC LCG — same rock every run for a given seed (owner rule:
  //  never Math.random()).
  // ----------------------------------------------------------------------
  function makeRng(seed) {
    let _s = (seed >>> 0) || 1;
    return function () {
      _s = (_s * 1103515245 + 12345) & 0x7fffffff;
      return _s / 0x7fffffff;
    };
  }

  // ----------------------------------------------------------------------
  //  ADJACENCY GRAPH — build once per source geometry (a unit icosahedron
  //  at a given subdivision "detail"): vertex -> [neighbor vertex indices],
  //  derived from the triangle index buffer. Needed so the scrape's flood-
  //  fill can walk "nearby vertices" without a spatial index.
  // ----------------------------------------------------------------------
  function buildAdjacency(index, vcount) {
    const adj = new Array(vcount);
    for (let i = 0; i < vcount; i++) adj[i] = null;
    function link(a, b) {
      if (!adj[a]) adj[a] = [];
      if (adj[a].indexOf(b) === -1) adj[a].push(b);
    }
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      link(a, b); link(b, a);
      link(b, c); link(c, b);
      link(a, c); link(c, a);
    }
    return adj;
  }

  // ----------------------------------------------------------------------
  //  ONE SCRAPE — pick a random seed vertex, flood-fill its neighbors up to
  //  `hops` edge-steps away, and project every collected vertex onto the
  //  plane through the seed vertex whose normal is the seed's own outward
  //  direction (offset inward by `depth`). Only ever pulls verts INWARD
  //  (max with 0) so the rock only ever loses volume — never bulges.
  // ----------------------------------------------------------------------
  const _seedN = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _planePt = new THREE.Vector3();
  function scrapeOnce(positions, adj, rng, hops, depthMin, depthMax) {
    const vcount = positions.length;
    if (!vcount) return;
    const seedI = (rng() * vcount) | 0;
    const seed = positions[seedI];
    _seedN.copy(seed).normalize();               // outward normal at the seed
    const depth = depthMin + rng() * (depthMax - depthMin);
    // plane passes through a point pulled slightly inward from the seed
    _planePt.copy(seed).addScaledVector(_seedN, -depth);

    // BFS flood-fill over the adjacency graph, `hops` edge-steps out.
    const visited = new Set([seedI]);
    let frontier = [seedI];
    for (let h = 0; h < hops; h++) {
      const next = [];
      for (let k = 0; k < frontier.length; k++) {
        const nb = adj[frontier[k]];
        if (!nb) continue;
        for (let n = 0; n < nb.length; n++) {
          const ni = nb[n];
          if (!visited.has(ni)) { visited.add(ni); next.push(ni); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }

    // project every collected vertex onto the plane (point-onto-plane: move
    // along the plane normal by -(dot(v - planePt, n)) ), but only inward —
    // a vertex already past the plane (closer to center) is left untouched
    // so scrapes never push material outward and bulge the silhouette.
    visited.forEach(function (i) {
      const p = positions[i];
      _v.subVectors(p, _planePt);
      const d = _v.dot(_seedN);                    // signed distance from plane
      if (d > 0) {                                 // vertex sits outside the plane -> carve it in
        p.addScaledVector(_seedN, -d);
      }
    });
  }

  // ----------------------------------------------------------------------
  //  CBZ.makeRock(radius, seed, detail) -> THREE.BufferGeometry
  //  Builds an icosahedron, runs the scrape algorithm `scrapes` times, then
  //  recomputes flat facet normals (crisp chipped-rock read, matches the
  //  flat-shaded low-poly look every other prop in this codebase uses).
  //  ONE-TIME CPU COST — call this at world-build time, cache the result,
  //  never call it per-frame.
  // ----------------------------------------------------------------------
  function makeRock(radius, seed, detail) {
    radius = radius || 1;
    detail = detail == null ? 1 : detail;
    const rng = makeRng(seed == null ? 1 : seed);
    const src = new THREE.IcosahedronGeometry(radius, detail);

    // pull raw positions into plain Vector3s we can freely mutate + a shared
    // index buffer for adjacency (r128 IcosahedronGeometry is indexed).
    const posAttr = src.attributes && src.attributes.position;
    if (!posAttr || !posAttr.count) return src;      // headless/stub-safe bail

    const vcount = posAttr.count;
    const positions = new Array(vcount);
    for (let i = 0; i < vcount; i++) {
      positions[i] = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    }
    const idxAttr = src.index;
    let indexArr;
    if (idxAttr && idxAttr.count) {
      indexArr = new Array(idxAttr.count);
      for (let i = 0; i < idxAttr.count; i++) indexArr[i] = idxAttr.getX ? idxAttr.getX(i) : idxAttr.array[i];
    } else if (idxAttr && idxAttr.array) {
      indexArr = idxAttr.array;
    } else {
      indexArr = [];   // no index available (stub) — adjacency empty, scrape no-ops safely
    }

    const adj = buildAdjacency(indexArr, vcount);

    // ---- run the scrape N times at random points/strengths -------------
    const SCRAPES = 8 + ((rng() * 6) | 0);          // 8-13 chips per rock
    const HOPS = 1 + ((rng() * 2) | 0);             // 1-2 edge-hops per chip (keeps facets small)
    for (let s = 0; s < SCRAPES; s++) {
      scrapeOnce(positions, adj, rng, HOPS, radius * 0.05, radius * 0.32);
    }

    // ---- write back into a fresh non-indexed BufferGeometry so each
    //      triangle owns its own verts -> flat per-face normals (crisp
    //      angular chipped-rock silhouette, matches this repo's flat-
    //      shaded low-poly style everywhere else). ------------------------
    const triCount = indexArr.length / 3;
    const out = new THREE.BufferGeometry();
    if (triCount > 0) {
      const arr = new Float32Array(triCount * 3 * 3);
      let o = 0;
      for (let t = 0; t < indexArr.length; t++) {
        const p = positions[indexArr[t]];
        arr[o++] = p.x; arr[o++] = p.y; arr[o++] = p.z;
      }
      out.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      out.computeVertexNormals();          // per-face normals on non-indexed geo = flat facets
    } else {
      out.setAttribute("position", posAttr);   // stub fallback: nothing to scrape, pass through
    }
    src.dispose();
    return out;
  }
  CBZ.makeRock = makeRock;

  // ----------------------------------------------------------------------
  //  SLOPE-AWARE SCATTER (modeled on THREE.Terrain's ScatterMeshes):
  //  CBZ.scatterRocks(root, opts) places `count` rock instances across a
  //  region via a supplied `pick(rng)` candidate generator, rejecting any
  //  candidate whose local slope exceeds the angle-of-repose cutoff (rocks
  //  can't cling to a cliff face steeper than loose rock's natural rest
  //  angle). Builds a small pool of shared rock-geometry variants (so the
  //  whole field is a couple of InstancedMeshes, not one draw call per rock)
  //  and returns {count, meshes} for the caller's own bookkeeping.
  //
  //  opts:
  //    count            — how many rocks to attempt to place (some may be
  //                        rejected by the slope test; the loop over-samples)
  //    pick(rng)         — () -> {x,z} candidate point generator (required)
  //    heightAt(x,z)     — ground height sampler (required)
  //    normalAt(x,z)     — ground normal sampler; if absent, a central-
  //                        difference fallback is derived from heightAt
  //    repeatAngleDeg    — angle-of-repose cutoff in degrees (default 37,
  //                        the middle of the requested 35-40deg range)
  //    minSize/maxSize   — per-instance uniform scale range (world units)
  //    colorHex          — tint applied via a shared cmat (or CBZ.cmat)
  //    variants          — how many distinct makeRock() shapes to cycle
  //                        through (default 3) — visual variety without
  //                        extra draw calls (all variants share ONE material)
  //    seed              — RNG seed (deterministic placement)
  //    rng               — supply an existing seeded rng instead of `seed`
  //    maxAttempts        — over-sample factor guard (default count*4)
  // ----------------------------------------------------------------------
  const _EPS = 1.5;
  function centralNormal(heightAt, x, z, out) {
    const hL = heightAt(x - _EPS, z), hR = heightAt(x + _EPS, z);
    const hD = heightAt(x, z - _EPS), hU = heightAt(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  }

  function scatterRocks(root, opts) {
    opts = opts || {};
    if (!root || typeof opts.pick !== "function" || typeof opts.heightAt !== "function") return null;

    const count = opts.count || 0;
    if (count <= 0) return null;
    const rng = opts.rng || makeRng(opts.seed == null ? 777 : opts.seed);
    const repeatAngleDeg = opts.repeatAngleDeg == null ? 37 : opts.repeatAngleDeg;
    const repeatCos = Math.cos(repeatAngleDeg * Math.PI / 180);   // slope test: normal.y must exceed this
    const minSize = opts.minSize == null ? 1.2 : opts.minSize;
    const maxSize = opts.maxSize == null ? 3.4 : opts.maxSize;
    const variantN = Math.max(1, opts.variants || 3);
    const maxAttempts = opts.maxAttempts || count * 4;
    const cmat = CBZ.cmat || CBZ.mat;
    const material = cmat ? cmat(opts.colorHex == null ? 0x7d766a : opts.colorHex, { }) : new THREE.MeshLambertMaterial({ color: opts.colorHex == null ? 0x7d766a : opts.colorHex, flatShading: true });
    material.flatShading = true;   // crisp scrape facets need flat shading regardless of cache origin

    // ---- build the shared geometry variants ONCE (one-time CPU cost) ----
    const baseR = opts.baseRadius == null ? 1 : opts.baseRadius;
    const geomVariants = [];
    for (let v = 0; v < variantN; v++) {
      geomVariants.push(makeRock(baseR, (opts.seed == null ? 777 : opts.seed) * 31 + v * 97 + 1, opts.detail == null ? 1 : opts.detail));
    }

    // ---- gather placements first (slope-tested), THEN size the instanced
    //      meshes exactly — no wasted/hidden instances. -------------------
    const placed = [];   // { x, y, z, s, rotY, rotTilt, variant }
    const nrm = new THREE.Vector3();
    let attempts = 0;
    while (placed.length < count && attempts < maxAttempts) {
      attempts++;
      const c = opts.pick(rng);
      if (!c) continue;
      const gy = opts.heightAt(c.x, c.z);
      if (opts.minHeight != null && gy < opts.minHeight) continue;
      if (opts.maxHeight != null && gy > opts.maxHeight) continue;
      const n = opts.normalAt ? opts.normalAt(c.x, c.z, nrm) : centralNormal(opts.heightAt, c.x, c.z, nrm);
      if (!n || n.y < repeatCos) continue;             // too steep — loose rock would slide off
      const s = minSize + rng() * (maxSize - minSize);
      placed.push({
        x: c.x, y: gy, z: c.z, s: s,
        rotY: rng() * Math.PI * 2,
        rotTilt: (rng() - 0.5) * 0.35,
        variant: (rng() * variantN) | 0,
      });
    }
    if (!placed.length) return { count: 0, meshes: [] };

    // ---- bucket by variant so each variant gets its own InstancedMesh
    //      (shared material -> still just `variantN` draw calls total, not
    //      one per rock). -------------------------------------------------
    const buckets = [];
    for (let v = 0; v < variantN; v++) buckets.push([]);
    for (let i = 0; i < placed.length; i++) buckets[placed[i].variant].push(placed[i]);

    const dummy = new THREE.Object3D();
    const meshes = [];
    for (let v = 0; v < variantN; v++) {
      const list = buckets[v];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geomVariants[v], material, list.length);
      im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;         // backdrop/scatter spans a wide area; never let it pop
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        // partially bury the rock so it reads as sitting IN the ground, not
        // floating on top of it (a plain sphere-ish shape looks glued-on
        // otherwise).
        dummy.position.set(p.x, p.y - p.s * 0.18, p.z);
        dummy.rotation.set(p.rotTilt, p.rotY, p.rotTilt * 0.6);
        dummy.scale.set(p.s, p.s * (0.85 + (i % 3) * 0.08), p.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.matrixAutoUpdate = false;
      root.add(im);
      meshes.push(im);
    }

    return { count: placed.length, meshes: meshes };
  }
  CBZ.scatterRocks = scatterRocks;
})();
