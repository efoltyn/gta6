/* ============================================================
   core/losgrid.js — broadphase for raycasts against CBZ.losBlockers.

   WHY: CBZ.losBlockers holds ~17k wall meshes. Every occlusion/LOS test
   (camera occluders, clearLineOfFire's THREE passes, guard vision, cop
   shoot-checks, rain-roof probes…) called raycaster.intersectObjects(blk)
   which walks ALL ~17k meshes per call — measured at 6-8ms per frame for
   the camera alone and ~20ms/frame during a wanted-5 firefight. This
   module answers the same query through a uniform XZ grid: the ray only
   tests blockers whose AABB overlaps the cells it actually crosses
   (typically 10-100 meshes, not 17k).

   SEMANTICS (kept bit-compatible with the r128 path it replaces):
     • FRONT-FACE ONLY, like Mesh.raycast on FrontSide walls: a ray that
       STARTS INSIDE a box reports no hit for that box (this exact fact is
       load-bearing for city/los.js's dual-direction wall test — see the
       DUAL-DIRECTION note there).
     • Hits carry {distance, point, face:{normal}, object} sorted nearest-
       first — the fields every call site reads. `point` is world-space,
       `normal` is the struck axis face (object space == world space for
       the identity-rotation walls the fast path accepts — see below).
     • visible=false blockers still hit (r128 raycast ignores visibility;
       core/batch.js hides wall originals and relies on them still
       blocking LOS).
     • near/far are distances along the (normalized) ray, same as
       Raycaster.near/far.
   Blockers that the fast path can't mirror EXACTLY — rotated meshes,
   non-box geometry, non-FrontSide or transparent-tested materials — go to
   an "exact" list that still uses the real THREE raycast, so odd geometry
   keeps r128 behaviour verbatim (the list is tiny: walls are axis-aligned
   boxes in this game).

   REBUILD: lazy, and re-armed whenever the losBlockers array identity or
   length changes (demolition splices, mode resets). CBZ.losGridDirty()
   forces one for anything that mutates a blocker in place.

   HIT OBJECTS ARE POOLED: the returned array + hit objects are reused by
   the NEXT losRaycast call. Every current call site consumes hits before
   issuing another cast (verified); don't retain them across calls.

   Flag: CBZ.CONFIG.LOS_GRID (default ON) — false restores the plain
   intersectObjects path at every patched call site through this module.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG && CBZ.CONFIG.LOS_GRID == null) CBZ.CONFIG.LOS_GRID = true;

  const CELL = 24;                 // world units per grid cell (city blocks ~18-30u)
  let builtFor = null, builtLen = 0, dirty = true;

  // packed blocker data (parallel arrays — cache-friendly slab tests)
  let n = 0;
  let minX, minY, minZ, maxX, maxY, maxZ; // Float64Array AABBs
  let objs = [];                   // index -> mesh (for hit.object)
  let exact = [];                  // meshes the fast path must not approximate
  let cells = new Map();           // cellKey -> int[] blocker indices
  let stamps = null;               // Uint32Array dedupe stamps
  let stamp = 0;
  let gx0 = 0, gz0 = 0;            // grid origin (cell coords offset)

  const _box = new THREE.Box3();
  const _ray = new THREE.Raycaster();

  function keyOf(cx, cz) { return (cx - gx0) * 100003 + (cz - gz0); }

  function isIdentityRot(m) {
    const e = m.elements;
    // no rotation and no negative scale: off-diagonals ~0, diagonals > 0
    return Math.abs(e[1]) < 1e-6 && Math.abs(e[2]) < 1e-6 &&
           Math.abs(e[4]) < 1e-6 && Math.abs(e[6]) < 1e-6 &&
           Math.abs(e[8]) < 1e-6 && Math.abs(e[9]) < 1e-6 &&
           e[0] > 0 && e[5] > 0 && e[10] > 0;
  }

  function build(blk) {
    builtFor = blk; builtLen = blk.length; dirty = false;
    n = 0; objs.length = 0; exact.length = 0; cells = new Map();
    const cap = blk.length;
    minX = new Float64Array(cap); minY = new Float64Array(cap); minZ = new Float64Array(cap);
    maxX = new Float64Array(cap); maxY = new Float64Array(cap); maxZ = new Float64Array(cap);
    for (let i = 0; i < blk.length; i++) {
      const m = blk[i];
      if (!m || !m.geometry) continue;
      m.updateWorldMatrix(true, false);
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const geoOk = m.geometry.parameters && m.geometry.parameters.width != null; // Box(Buffer)Geometry
      const sideOk = !mat || (mat.side || 0) === 0;   // FrontSide only
      if (!geoOk || !sideOk || !isIdentityRot(m.matrixWorld)) { exact.push(m); continue; }
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      _box.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
      const j = n++;
      objs[j] = m;
      minX[j] = _box.min.x; minY[j] = _box.min.y; minZ[j] = _box.min.z;
      maxX[j] = _box.max.x; maxY[j] = _box.max.y; maxZ[j] = _box.max.z;
      const cx0 = Math.floor(_box.min.x / CELL), cx1 = Math.floor(_box.max.x / CELL);
      const cz0 = Math.floor(_box.min.z / CELL), cz1 = Math.floor(_box.max.z / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const k = cx * 100003 + cz;
          let arr = cells.get(k);
          if (!arr) { arr = []; cells.set(k, arr); }
          arr.push(j);
        }
      }
    }
    stamps = new Uint32Array(n);
    stamp = 0;
    CBZ.losGridStats = { blockers: blk.length, gridded: n, exact: exact.length, cells: cells.size };
  }

  // pooled hits (reused per call — see header)
  const hitPool = [];
  function getHit(k) {
    let h = hitPool[k];
    if (!h) {
      h = { distance: 0, point: new THREE.Vector3(), face: { normal: new THREE.Vector3() }, object: null };
      hitPool[k] = h;
    }
    return h;
  }
  const outHits = [];
  function byDist(a, b) { return a.distance - b.distance; }

  // slab test: returns entry distance in [near, far] or -1 (front faces only)
  function slab(j, ox, oy, oz, dx, dy, dz, near, far) {
    let tmin = near, tmax = far;
    // X
    if (dx !== 0) {
      const inv = 1 / dx;
      let t1 = (minX[j] - ox) * inv, t2 = (maxX[j] - ox) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    } else if (ox < minX[j] || ox > maxX[j]) return -1;
    // Y
    if (dy !== 0) {
      const inv = 1 / dy;
      let t1 = (minY[j] - oy) * inv, t2 = (maxY[j] - oy) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    } else if (oy < minY[j] || oy > maxY[j]) return -1;
    // Z
    if (dz !== 0) {
      const inv = 1 / dz;
      let t1 = (minZ[j] - oz) * inv, t2 = (maxZ[j] - oz) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    } else if (oz < minZ[j] || oz > maxZ[j]) return -1;
    // tmin==near means the entry face is at/behind near: r128 with ray.near
    // still reports hits AT near, so accept tmin>=near — but reject rays that
    // started INSIDE the box (entry face behind the origin = culled backface).
    const oxIn = ox > minX[j] && ox < maxX[j];
    const oyIn = oy > minY[j] && oy < maxY[j];
    const ozIn = oz > minZ[j] && oz < maxZ[j];
    if (oxIn && oyIn && ozIn) return -1;
    return tmin;
  }

  function normalFor(h, j, ox, oy, oz, dx, dy, dz, t) {
    // which slab produced t? re-derive by comparing entry distances
    const nrm = h.face.normal;
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    h.point.set(px, py, pz);
    const ex = Math.min(Math.abs(px - minX[j]), Math.abs(px - maxX[j]));
    const ey = Math.min(Math.abs(py - minY[j]), Math.abs(py - maxY[j]));
    const ez = Math.min(Math.abs(pz - minZ[j]), Math.abs(pz - maxZ[j]));
    if (ex <= ey && ex <= ez) nrm.set(dx > 0 ? -1 : 1, 0, 0);
    else if (ey <= ez) nrm.set(0, dy > 0 ? -1 : 1, 0);
    else nrm.set(0, 0, dz > 0 ? -1 : 1);
  }

  function testCell(k, ox, oy, oz, dx, dy, dz, near, far, nHits) {
    const arr = cells.get(k);
    if (!arr) return nHits;
    for (let i = 0; i < arr.length; i++) {
      const j = arr[i];
      if (stamps[j] === stamp) continue;
      stamps[j] = stamp;
      const t = slab(j, ox, oy, oz, dx, dy, dz, near, far);
      if (t < 0) continue;
      const h = getHit(nHits);
      h.distance = t; h.object = objs[j];
      normalFor(h, j, ox, oy, oz, dx, dy, dz, t);
      outHits[nHits++] = h;
    }
    return nHits;
  }

  // The drop-in: same result shape as raycaster.intersectObjects(blockers,false).
  // Falls back to the real raycast when the flag is off or blockers isn't the
  // canonical losBlockers array this grid indexes.
  CBZ.losRaycast = function (raycaster, blockers) {
    const blk = blockers || CBZ.losBlockers;
    if (!blk || !blk.length) { outHits.length = 0; return outHits; }
    if (!(CBZ.CONFIG && CBZ.CONFIG.LOS_GRID) || blk !== CBZ.losBlockers) {
      return raycaster.intersectObjects(blk, false);
    }
    if (dirty || blk !== builtFor || blk.length !== builtLen) build(blk);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const near = raycaster.near || 0;
    const far = (raycaster.far == null || raycaster.far === Infinity) ? 1e6 : raycaster.far;
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    stamp++;
    if (stamp === 0xffffffff) { stamps.fill(0); stamp = 1; }
    outHits.length = 0;
    let nHits = 0;

    // 2D DDA over the XZ cells the segment [0..far] crosses (near just trims
    // hit acceptance — walking from the origin keeps the traversal simple).
    const adx = Math.abs(dx), adz = Math.abs(dz);
    if (adx < 1e-9 && adz < 1e-9) {
      // vertical ray: one cell column holds every blocker whose AABB overlaps it
      nHits = testCell(Math.floor(ox / CELL) * 100003 + Math.floor(oz / CELL),
        ox, oy, oz, dx, dy, dz, near, far, nHits);
    } else {
      let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
      const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
      const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
      let tMaxX = adx > 1e-9
        ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / adx) : Infinity;
      let tMaxZ = adz > 1e-9
        ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / adz) : Infinity;
      let t = 0;
      // visit cells until past far (+1 cell of slack so a hit on the boundary isn't missed)
      const tEnd = far + CELL;
      let guard = 0;
      while (t <= tEnd && guard++ < 4096) {
        nHits = testCell(cx * 100003 + cz, ox, oy, oz, dx, dy, dz, near, far, nHits);
        if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
        else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
      }
    }

    // exact-list stragglers (rotated/non-box/DoubleSide) — real THREE raycast
    if (exact.length) {
      _ray.ray.origin.copy(o); _ray.ray.direction.copy(d);
      _ray.near = near; _ray.far = far;
      const ex = _ray.intersectObjects(exact, false);
      for (let i = 0; i < ex.length; i++) outHits[nHits++] = ex[i];
    }
    outHits.length = nHits;
    if (nHits > 1) outHits.sort(byDist);
    return outHits;
  };

  CBZ.losGridDirty = function () { dirty = true; };
})();
