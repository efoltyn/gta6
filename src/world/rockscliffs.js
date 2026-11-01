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
  // Loads BEFORE config.js (index.html order) — self-create the namespace
  // (core/seed.js's idiom). The old `if (!CBZ) return;` guard made this whole
  // module dead code, which silently disabled every scatterRocks caller.
  const CBZ = (window.CBZ = window.CBZ || {});
  if (!window.THREE) return;
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
  //  `tune` (OPTIONAL, added for the real-mountain deployment — omitted by
  //  every legacy caller, so their geometry is byte-identical): {scrapes,
  //  hops, depthMin, depthMax, squashY} lets a caller ask for a FLATTER, more
  //  heavily-spalled slab (cliff-band rubble / talus plates) instead of the
  //  default rounded-ish boulder. Real talus is plate-shaped because it splits
  //  along bedding, so a uniform boulder scatter reads wrong at a cliff foot.
  function makeRock(radius, seed, detail, tune) {
    radius = radius || 1;
    detail = detail == null ? 1 : detail;
    const rng = makeRng(seed == null ? 1 : seed);
    // ONE SUBDIVISION FINER than asked (capped at 3): the scrapes, cleaves
    // and bedding ledges below need vertices to cut. Rock counts per call
    // are tens to a few hundred, so 80 -> 320 triangles is affordable; the
    // scrape hop radius doubles to keep the chips the same size in metres.
    const fine = Math.min(3, detail + 1), hopMul = fine > detail ? 2 : 1;
    const src = new THREE.IcosahedronGeometry(radius, fine);

    // Pull raw positions into mutable vectors. Indexed inputs retain their
    // topology; r128's unindexed polyhedra are welded below for adjacency.
    const posAttr = src.attributes && src.attributes.position;
    if (!posAttr || !posAttr.count) return src;      // headless/stub-safe bail

    let vcount = posAttr.count;
    let positions = new Array(vcount);
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
      // r128 polyhedra are triangle soup. Weld coincident corners before
      // building adjacency, otherwise scrapes never leave a single corner
      // and the fallback below returns the untouched source sphere.
      const unique = [], byPosition = new Map();
      indexArr = [];
      for (const p of positions) {
        const key = [p.x, p.y, p.z].map(v => Math.round(v / radius * 1e6)).join(",");
        let ix = byPosition.get(key);
        if (ix == null) { ix = unique.length; unique.push(p); byPosition.set(key, ix); }
        indexArr.push(ix);
      }
      positions = unique;
      vcount = positions.length;
    }

    const adj = buildAdjacency(indexArr, vcount);

    // ---- run the scrape N times at random points/strengths -------------
    // NOTE the draw ORDER is preserved exactly when `tune` is absent: the two
    // rng() draws below happen either way, so a legacy caller's rock is
    // byte-identical whether or not this branch exists.
    const rS = (rng() * 6) | 0, rH = (rng() * 2) | 0;
    const SCRAPES = (tune && tune.scrapes) ? tune.scrapes + rS : 8 + rS;   // 8-13 chips per rock
    const HOPS = ((tune && tune.hops) ? tune.hops + rH : 1 + rH) * hopMul; // 1-2 edge-hops per chip (keeps facets small)
    const dMin = radius * ((tune && tune.depthMin != null) ? tune.depthMin : 0.05);
    const dMax = radius * ((tune && tune.depthMax != null) ? tune.depthMax : 0.32);
    for (let s = 0; s < SCRAPES; s++) {
      scrapeOnce(positions, adj, rng, HOPS, dMin, dMax);
    }
    // CLEAVES — two or three big planar fractures through the whole rock.
    // A boulder is bounded by a few large joint faces and THEN chipped; the
    // scrapes alone give a chipped sphere. Every vertex past the plane is
    // projected onto it, so each cleave is one broad flat face.
    // the block is first stretched along random axes (no boulder is round)
    const ax = 0.82 + rng() * 0.33, ay = 0.72 + rng() * 0.33, az = 0.82 + rng() * 0.33;
    for (let i = 0; i < vcount; i++) { positions[i].x *= ax; positions[i].y *= ay; positions[i].z *= az; }
    const cleaves = 4 + ((rng() * 3) | 0);
    const cn = new THREE.Vector3(), cv = new THREE.Vector3();
    for (let c = 0; c < cleaves; c++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
      cn.set(Math.cos(a) * rr, z, Math.sin(a) * rr).normalize();
      if (cn.y < -0.5) cn.y = -0.5 + (cn.y + 0.5) * 0.3;            // keep the base broad: it sits on its bed
      cn.normalize();
      const off = radius * (0.40 + rng() * 0.24);
      for (let i = 0; i < vcount; i++) {
        const d = positions[i].dot(cn) - off;
        if (d > 0) positions[i].addScaledVector(cn, -d);
      }
    }
    // BEDDING — the rock's strata. A dipping set of parallel planes cuts it
    // into beds; alternate beds are recessed a few percent (the softer
    // layers weather back), which prints the ledges a sedimentary or
    // foliated boulder shows. The bed index rides on to the colours below.
    const dip = new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize();
    const bedH = radius * (0.22 + rng() * 0.12), bedOff = rng() * bedH;
    const bedOf = function (p) { return Math.floor((p.dot(dip) + bedOff) / bedH); };
    for (let i = 0; i < vcount; i++) {
      const p = positions[i];
      if (bedOf(p) & 1) { cv.set(p.x, 0, p.z); p.addScaledVector(cv, -0.085); }
    }
    // Plate/slab shaping: a uniform vertical squash AFTER the scrapes keeps
    // every chipped facet (they just become shallower), which is exactly how a
    // split slab looks — angular in plan, thin in section.
    if (tune && tune.squashY != null && tune.squashY !== 1) {
      const sq = tune.squashY;
      for (let i = 0; i < vcount; i++) positions[i].y *= sq;
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
      // ROCK COLOUR, per face, around 1.0 so the caller's colorHex keeps the
      // hue: the beds alternate light/dark (lithology), faces cut deep by a
      // scrape or cleave are FRESH (paler — unweathered stone), up-facing
      // faces carry lichen and dust (lighter, a touch green-grey), the
      // undersides and the buried foot are dark with soil, and every face is
      // jittered a little so no two facets match.
      const col = new Float32Array(arr.length);
      const N = out.attributes.normal;
      const fc = new THREE.Vector3();
      for (let t = 0; t < triCount; t++) {
        const o3 = t * 9;
        fc.set((arr[o3] + arr[o3 + 3] + arr[o3 + 6]) / 3, (arr[o3 + 1] + arr[o3 + 4] + arr[o3 + 7]) / 3, (arr[o3 + 2] + arr[o3 + 5] + arr[o3 + 8]) / 3);
        const ny = N.getY(t * 3);
        const fresh = Math.max(0, Math.min(1, (1 - fc.length() / radius) * 3.2));   // how deep the face was cut
        const bed = (bedOf(fc) & 1) ? 0.82 : 1.06;
        const low = Math.max(0, Math.min(1, (-fc.y / radius + 0.15) * 1.6));      // the foot, in the soil
        let r = bed * (0.94 + 0.16 * fresh), g = r, b = r;
        if (ny > 0.35) { const k = (ny - 0.35) / 0.65 * (1 - fresh); r *= 1 + 0.08 * k; g *= 1 + 0.12 * k; b *= 1 + 0.02 * k; }
        if (ny < -0.2) { const k = Math.min(1, (-ny - 0.2) * 1.5); r *= 1 - 0.28 * k; g *= 1 - 0.28 * k; b *= 1 - 0.24 * k; }
        r *= 1 - 0.22 * low; g *= 1 - 0.25 * low; b *= 1 - 0.30 * low;
        const j = 0.94 + rng() * 0.12, jh = (rng() - 0.5) * 0.05;
        r *= j * (1 + jh); g *= j; b *= j * (1 - jh);
        for (let k = 0; k < 3; k++) { col[o3 + k * 3] = r; col[o3 + k * 3 + 1] = g; col[o3 + k * 3 + 2] = b; }
      }
      out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    } else {
      out.setAttribute("position", posAttr);   // stub fallback: nothing to scrape, pass through
    }
    src.dispose();
    out.computeBoundingBox();
    out.computeBoundingSphere();
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
  //
  //  REAL-MOUNTAIN EXTENSIONS (all default-OFF, so every legacy caller —
  //  terrain.js / terrain_overhaul.js's backdrop talus, biome_desert — keeps
  //  byte-identical placement AND an identical rng draw sequence):
  //    alignToSlope      — 0..1, tilt each rock's up-axis toward the GROUND
  //                        NORMAL by this fraction. A boulder wedged on a 35°
  //                        face sits IN the face; a world-up boulder reads as
  //                        a sticker. Required for cliff-band rubble.
  //    flatten           — 0..1, squash Y / spread XZ per instance: talus
  //                        plates and scree flakes instead of potatoes.
  //    bury              — fraction of the instance's size sunk below the
  //                        surface (default 0.18, i.e. today's behaviour).
  //    hashVary          — use CBZ.hash01(x,z,…) for per-instance size/roll
  //                        variation instead of the legacy `i % 3` cycle.
  //                        Position-hashed, so it adds ZERO rng draws.
  //    rockTune          — passed straight to makeRock (scrapes/hops/squashY).
  //    tag               — stamped into userData.rockPopulation for debugging.
  // ----------------------------------------------------------------------
  const _EPS = 1.5;
  // module-scope scratch for the slope-alignment path (allocation-free)
  const _UP = new THREE.Vector3(0, 1, 0);
  const _alignN = new THREE.Vector3();
  const _alignQ = new THREE.Quaternion();
  const _spinQ = new THREE.Quaternion();
  function centralNormal(heightAt, x, z, out) {
    const hL = heightAt(x - _EPS, z), hR = heightAt(x + _EPS, z);
    const hD = heightAt(x, z - _EPS), hU = heightAt(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  }

  const _rockMats = Object.create(null);
  function rockMaterial(hex) {
    if (_rockMats[hex]) return _rockMats[hex];
    const m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true, vertexColors: true });
    m.name = "CBZ rock " + hex.toString(16); m._shared = true;
    return (_rockMats[hex] = m);
  }
  CBZ.rockMaterial = rockMaterial;

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
    // One material per colour, OWNED here: the rocks carry per-face colour
    // (beds, fresh faces, lichen, soil), so the material needs vertexColors
    // — and flipping that on a shared CBZ.cmat would recolour every other
    // user of the same hex.
    const material = rockMaterial(opts.colorHex == null ? 0x7d766a : opts.colorHex);

    // ---- build the shared geometry variants ONCE (one-time CPU cost) ----
    const baseR = opts.baseRadius == null ? 1 : opts.baseRadius;
    const geomVariants = [];
    for (let v = 0; v < variantN; v++) {
      geomVariants.push(makeRock(baseR, (opts.seed == null ? 777 : opts.seed) * 31 + v * 97 + 1, opts.detail == null ? 1 : opts.detail, opts.rockTune));
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
        nx: n.x, ny: n.y, nz: n.z,                     // ground normal at the spot
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
    const align = opts.alignToSlope == null ? 0 : Math.max(0, Math.min(1, opts.alignToSlope));
    const flatten = opts.flatten == null ? 0 : Math.max(0, Math.min(1, opts.flatten));
    const bury = opts.bury == null ? 0.18 : opts.bury;
    // opts.solidMin: horizontal radius (metres) at or above which a rock gets a
    // collider. 0 / absent = the old draw-only behaviour, so no existing caller
    // changes until it asks. See the push inside the instance loop below.
    const solidMin = (CBZ.CONFIG && CBZ.CONFIG.BIOME_SOLID_TRUNKS === false) ? 0 : (+opts.solidMin || 0);
    let solidN = 0;
    const hashVary = !!opts.hashVary;
    const hash01 = CBZ.hash01;
    for (let v = 0; v < variantN; v++) {
      const list = buckets[v];
      if (!list.length) { if (geomVariants[v].dispose) geomVariants[v].dispose(); continue; }   // unused variant this call — free it
      const im = new THREE.InstancedMesh(geomVariants[v], material, list.length);
      im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;         // backdrop/scatter spans a wide area; never let it pop
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        // partially bury the rock so it reads as sitting IN the ground, not
        // floating on top of it (a plain sphere-ish shape looks glued-on
        // otherwise).
        dummy.position.set(p.x, p.y - p.s * bury, p.z);
        if (align > 0 && p.ny != null) {
          // Wedge the rock INTO the slope: rotate world-up onto (a fraction of)
          // the ground normal, then spin it about that new up. On a 35° cliff
          // face this is the whole difference between "wedged block" and
          // "sticker".
          _alignN.set(p.nx, p.ny, p.nz);
          if (_alignN.lengthSq() < 1e-9) _alignN.set(0, 1, 0);
          _alignN.normalize().lerp(_UP, 1 - align).normalize();
          _alignQ.setFromUnitVectors(_UP, _alignN);
          _spinQ.setFromAxisAngle(_UP, p.rotY);
          dummy.quaternion.copy(_alignQ).multiply(_spinQ);
        } else {
          dummy.rotation.set(p.rotTilt, p.rotY, p.rotTilt * 0.6);
        }
        // per-instance size variation. hashVary derives it from POSITION (no
        // extra rng draws → the shared stream stays order-stable); the legacy
        // `i % 3` cycle is preserved verbatim when it is off.
        const vary = hashVary
          ? (hash01 ? hash01(p.x, p.z, 0x0c1a) : 0.5)
          : ((i % 3) / 3);
        const yS = p.s * (0.85 + vary * 0.24) * (1 - flatten * 0.62);
        const xzS = p.s * (1 + flatten * 0.40);
        dummy.scale.set(xzS, yS, xzS * (hashVary ? 0.84 + vary * 0.32 : 1));
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        // SOLIDITY (opt-in per caller, `opts.solidMin` = the smallest radius
        // worth colliding). This file is the ONE rock factory in the game —
        // terrain.js, terrain_overhaul.js x2, mountain_detail.js and
        // biome_desert.js all come through here — and it had never pushed a
        // single collider, so every boulder in every mountain range was
        // silhouette. One AABB per rock, and only for rocks big enough that
        // walking through one is noticeable; the pebbles stay free.
        // The AABB is the BURIED body's real footprint: xzS is the horizontal
        // scale actually written into the matrix above, so it can never drift
        // from what is drawn, and the top is the instance's own yS.
        if (solidMin > 0 && xzS >= solidMin && CBZ.colliders) {
          const e = xzS * 0.82;                  // inset: a rounded rock is not a cube
          CBZ.colliders.push({
            minX: p.x - e, maxX: p.x + e, minZ: p.z - e, maxZ: p.z + e,
            y0: 0, y1: p.y - p.s * bury + yS, ref: null, noCam: true,
          });
          solidN++;
        }
      }
      im.instanceMatrix.needsUpdate = true;
      im.matrixAutoUpdate = false;
      if (opts.tag) im.userData.rockPopulation = opts.tag;   // non-empty userData also spares it from the batcher
      im.name = "rock-scatter" + (opts.tag ? ":" + opts.tag : "");
      root.add(im);
      meshes.push(im);
    }

    return { count: placed.length, meshes: meshes, solids: solidN };
  }
  CBZ.scatterRocks = scatterRocks;
})();
