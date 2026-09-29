/* ============================================================
   systems/meshcollider.js — the drawing IS the collider.

   THE BUG CLASS THIS ENDS. Every solid object in the game used to be typed
   twice: once as a drawing (BoxGeometry(w,h,d) at x,y,z) and once more as a
   collider ({minX: x - w/2, ...}), usually a few lines apart and sometimes
   in a different file. Nothing tied the two numbers together, so they
   drifted: a mesh got rotated and the box did not, a prop grew and the box
   did not, a log was laid on its side at a random yaw and nobody could be
   bothered to work out its AABB, so it got no collider at all. "Drawn but not
   solid" was the default outcome, and CBZ.solidityAudit's "bare" backlog is
   the list of places it happened.

   This file measures the REAL geometry, in WORLD space, and hands back the
   engine's own collider record ({minX,maxX,minZ,maxZ, [y0,y1], [cx,cz,hw,hd,
   yaw]}, config.js:46 / physics.js orientedCollider) — the same record every
   resolver, broadphase, camera sweep and traversal probe already reads.

     CBZ.meshCollider.fromMesh(obj, opts)  -> [record]   (NOT registered)
     CBZ.meshCollider.fromBox3(box3, opts) -> record     (NOT registered)
     CBZ.meshCollider.add(rec | [rec])     -> count      (registers + indexes)
     CBZ.meshCollider.remove(rec | ref)    -> count      (one record, or every
                                                          record for that ref)
     CBZ.meshCollider.removeAllFor(ref)    -> count
     CBZ.solidFromMesh(obj, opts)          -> [record]   (fromMesh + add)

   obj: a Mesh, a Group (every Mesh below it), or an InstancedMesh (one
   collider per instance — r128's Box3.setFromObject IGNORES instance
   matrices, which is why nothing could do this before). The world matrix
   chain is refreshed first, so a mesh parented under a translated/rotated
   group measures where it is actually drawn.

   FOOTPRINT: the vertices are projected to XZ, the convex hull is taken
   (Akl-Toussaint prefilter + monotone chain, exact, no decimation loss) and
   the minimum-area enclosing rectangle is found over the hull edges
   (rotating-calipers theorem: the optimum has a side flush with a hull
   edge). That rectangle becomes an ORIENTED collider; within AXIS_SNAP of an
   axis it becomes a plain AABB (tight: the points' own AABB). The y band is
   the real min/max Y.

   opts
     merge      Group: one hull over every mesh instead of one per mesh
     compound   split each mesh into connected triangle islands (welded by
                position), each its own OBB; then any island whose rectangle
                is mostly air (an L, a U, a T) is cut, in its own frame, at
                the line that removes the most empty area, recursively, up
                to `slices` pieces (default 4). Cuts clip real triangle
                edges, so each piece is tight to what is drawn inside it.
     slices     max pieces per island for `compound` (default 4)
     pad        metres added to each half-extent (default 0)
     minSpan    skip a piece whose LARGER horizontal span is under this
                (default 0.05 — slivers, decals)
     minHeight  skip a piece shorter than this (default 0.05 — flat ground
                decals are floors, not walls)
     maxSize    safety: skip a piece whose larger span exceeds this
                (default 250 m; a collider that big is a bug upstream)
     fullHeight omit y0/y1 (a full-height wall to every actor)
     y0 / y1    override the measured band
     trunkOnly  trees: the footprint comes from the vertices in the bole band
                only (so a root flare / crown never widens it); the band is
                `trunkY` = [lo, hi] metres above the piece's lowest vertex
                (default [0.8, 2.0]). The collider still spans the full
                measured height.
     noCam      camera sweep ignores it (thin poles, trunks, hedges)
     noBreach   default TRUE: everything measured here is an object, not
                architecture (props-are-not-walls). A real wall that should
                carve under an RPG passes noBreach:false; it is forced true
                anyway when both spans are under POST_SPAN (1.2 m).
     cityTag    stamp _city (city-only solid; physics.js skips it in other
                modes). City content built inside CBZ.buildCity is stamped by
                city/mode.js anyway; this is for lazy builds after that.
     ref        default: the measured mesh (the InstancedMesh for instances).
                Pass null to keep a static mesh batchable (core/batch.js
                spares every mesh a collider refs). The source object is
                always kept on `_src`, which remove()/removeAllFor() also
                match, so ref:null records can still be removed by mesh.
     tag        free string stamped on `src` (audits: c.src === "mesh:<tag>")

   Tall thin pieces (larger span < 0.8 m and taller than 2.5x it: posts,
   masts, trunks) become a small axis-aligned SQUARE — their orientation is
   noise and a square is what every other post in the game already is.

   LOAD ORDER. Depends on nothing but THREE at call time. Warlord / battle
   slice pages do not load physics.js (core/microboot.js owns the collider
   registry there), so orientedCollider / colliderAdd / markCollidersDirty
   are feature-detected at CALL time and this file carries its own identical
   OBB record builder.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  const AXIS_SNAP = 0.5 * Math.PI / 180;   // yaw closer than 0.5 deg to an axis -> AABB
  const ORI_EPS = 1e-4;                    // physics.js's own "genuinely diagonal" test
  const POST_SPAN = 1.2;                   // props-are-not-walls: both spans under this = furniture
  const MIN_HALF = 0.04;                   // a drawn plane still gets a 8 cm body
  const THIN_SPAN = 0.8, THIN_RATIO = 2.5; // tall-thin -> square

  // ---------------------------------------------------------------- scratch
  // Grown on demand, never shrunk; nothing per call but the results.
  let cap = 0, PX = null, PY = null, PZ = null;
  function ensure(n) {
    if (n <= cap) return;
    let c = cap || 1024;
    while (c < n) c *= 2;
    const nx = new Float64Array(c), ny = new Float64Array(c), nz = new Float64Array(c);
    if (PX) { nx.set(PX); ny.set(PY); nz.set(PZ); }
    PX = nx; PY = ny; PZ = nz; cap = c;
  }
  let hcap = 0, HX = null, HZ = null, IDX = null, KEEP = null;
  function ensureHull(n) {
    if (n <= hcap) return;
    let c = hcap || 1024;
    while (c < n + 2) c *= 2;
    HX = new Float64Array(c); HZ = new Float64Array(c); IDX = new Uint32Array(c); KEEP = new Uint32Array(c);
    hcap = c;
  }

  // ------------------------------------------------------ record builder
  // physics.js's CBZ.orientedCollider, verbatim in behaviour, for pages that
  // never load physics.js. The live one wins when present so the two can
  // never disagree about a record's shape.
  function ownOriented(cx, cz, hw, hd, yaw, y0, y1) {
    yaw = +yaw || 0;
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
    if (as > ORI_EPS && ac > ORI_EPS) { c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw; }
    if (y0 != null) { c.y0 = y0; c.y1 = y1; }
    return c;
  }
  function oriented(cx, cz, hw, hd, yaw, y0, y1) {
    return (typeof CBZ.orientedCollider === "function" ? CBZ.orientedCollider : ownOriented)(cx, cz, hw, hd, yaw, y0, y1);
  }

  // ------------------------------------------------ gather world vertices
  // appends obj's vertices (world space, transformed by m = 16 floats) into
  // PX/PY/PZ starting at n; returns the new n.
  function pushGeo(geo, e, n) {
    const pos = geo && geo.attributes && geo.attributes.position;
    if (!pos) return n;
    const cnt = pos.count;
    ensure(n + cnt);
    const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6],
      e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
    const arr = pos.isInterleavedBufferAttribute ? null : pos.array;
    const st = arr ? (pos.itemSize || 3) : 0;
    for (let i = 0; i < cnt; i++) {
      let x, y, z;
      if (arr) { const k = i * st; x = arr[k]; y = arr[k + 1]; z = arr[k + 2]; }
      else { x = pos.getX(i); y = pos.getY(i); z = pos.getZ(i); }
      PX[n] = e0 * x + e4 * y + e8 * z + e12;
      PY[n] = e1 * x + e5 * y + e9 * z + e13;
      PZ[n] = e2 * x + e6 * y + e10 * z + e14;
      n++;
    }
    return n;
  }

  let _m4 = null;
  function m4() { if (!_m4 && window.THREE) _m4 = { a: new window.THREE.Matrix4(), b: new window.THREE.Matrix4() }; return _m4; }

  // the list of "parts": {geo, e (Float32/64 16), ref, src}. One per mesh,
  // one per instance.
  function collectParts(obj, out) {
    if (!obj) return out;
    const visit = function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (o.userData && o.userData.noMeshCollider) return;
      if (o.isInstancedMesh) {
        const M = m4();
        const im = o.instanceMatrix && o.instanceMatrix.array;
        const count = o.count != null ? o.count : 0;
        for (let i = 0; i < count && im; i++) {
          M.a.fromArray(im, i * 16);
          // a zero-scaled instance is a hidden one (the engine's way of
          // "removing" an instance) — it has no body
          if (Math.abs(M.a.determinant()) < 1e-12) continue;
          M.b.multiplyMatrices(o.matrixWorld, M.a);
          out.push({ geo: o.geometry, e: M.b.elements.slice(0), obj: o, inst: i });
        }
        return;
      }
      out.push({ geo: o.geometry, e: o.matrixWorld.elements, obj: o, inst: -1 });
    };
    if (obj.traverse) obj.traverse(visit); else visit(obj);
    return out;
  }

  // ------------------------------------------------------------ the hull
  // Akl-Toussaint: drop every point strictly inside the octagon of the 8
  // extreme points (x, z, x+z, x-z), then Andrew's monotone chain over the
  // survivors. Exact; a 20k-vertex prop hulls ~40 points.
  // Reads PX/PZ[s..e) filtered by `use` (Uint8 mask or null). Writes the CCW
  // hull into HX/HZ, returns its length.
  const OCT = new Int32Array(8);
  function cross(ox, oz, ax, az, bx, bz) { return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox); }
  function hull(s, e, use) {
    const n = e - s;
    ensureHull(n);
    // extremes
    let iMinX = -1, iMaxX = -1, iMinZ = -1, iMaxZ = -1, iMinS = -1, iMaxS = -1, iMinD = -1, iMaxD = -1;
    for (let i = s; i < e; i++) {
      if (use && !use[i - s]) continue;
      const x = PX[i], z = PZ[i], sm = x + z, df = x - z;
      if (iMinX < 0) { iMinX = iMaxX = iMinZ = iMaxZ = iMinS = iMaxS = iMinD = iMaxD = i; continue; }
      if (x < PX[iMinX]) iMinX = i; if (x > PX[iMaxX]) iMaxX = i;
      if (z < PZ[iMinZ]) iMinZ = i; if (z > PZ[iMaxZ]) iMaxZ = i;
      if (sm < PX[iMinS] + PZ[iMinS]) iMinS = i; if (sm > PX[iMaxS] + PZ[iMaxS]) iMaxS = i;
      if (df < PX[iMinD] - PZ[iMinD]) iMinD = i; if (df > PX[iMaxD] - PZ[iMaxD]) iMaxD = i;
    }
    if (iMinX < 0) return 0;
    // octagon CCW (x right, z up in the XZ plane math; orientation only has
    // to be consistent): minX, minS(x+z min), minZ, maxD(x-z max), maxX,
    // maxS, maxZ, minD
    const oct = OCT;
    oct[0] = iMinX; oct[1] = iMinS; oct[2] = iMinZ; oct[3] = iMaxD;
    oct[4] = iMaxX; oct[5] = iMaxS; oct[6] = iMaxZ; oct[7] = iMinD;
    let k = 0;
    for (let i = s; i < e; i++) {
      if (use && !use[i - s]) continue;
      const x = PX[i], z = PZ[i];
      let inside = true;
      for (let j = 0; j < 8; j++) {
        const a = oct[j], b = oct[(j + 1) & 7];
        if (a === b) continue;
        const cr = (PX[b] - PX[a]) * (z - PZ[a]) - (PZ[b] - PZ[a]) * (x - PX[a]);
        if (cr <= 1e-12) { inside = false; break; }
      }
      if (!inside) KEEP[k++] = i;
    }
    // sort survivors by x then z
    for (let i = 0; i < k; i++) IDX[i] = KEEP[i];
    const sub = IDX.subarray(0, k);
    sub.sort(function (a, b) { return PX[a] - PX[b] || PZ[a] - PZ[b]; });
    // monotone chain into HX/HZ (lower then upper)
    let h = 0;
    for (let i = 0; i < k; i++) {
      const p = sub[i], x = PX[p], z = PZ[p];
      while (h >= 2 && cross(HX[h - 2], HZ[h - 2], HX[h - 1], HZ[h - 1], x, z) <= 1e-12) h--;
      HX[h] = x; HZ[h] = z; h++;
    }
    const lo = h + 1;
    for (let i = k - 2; i >= 0; i--) {
      const p = sub[i], x = PX[p], z = PZ[p];
      while (h >= lo && cross(HX[h - 2], HZ[h - 2], HX[h - 1], HZ[h - 1], x, z) <= 1e-12) h--;
      HX[h] = x; HZ[h] = z; h++;
    }
    return h > 1 ? h - 1 : h;   // last point repeats the first
  }

  // ------------------------------------------------ minimum-area rectangle
  // Over the hull edges (the optimum has one side flush with an edge).
  // O(h^2) on the hull, which is tens of points. Result in RECT.
  const RECT = { cx: 0, cz: 0, hw: 0, hd: 0, yaw: 0 };
  // A round hull (a trunk, a drum, a boulder) has near-equal rectangles at
  // every angle; the arbitrary winner used to be a square rotated 20 deg —
  // honest, but its outer AABB (what the broadphase buckets) is 30 % wider
  // than the thing. So among rectangles within ROUND_TIE of the best area,
  // the one closest to an axis wins; the axis itself is always a candidate.
  const ROUND_TIE = 0.02;
  function rectFor(h, ux, uz, R) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < h; k++) {
      const px = HX[k], pz = HZ[k];
      const a = px * ux + pz * uz, b = -px * uz + pz * ux;
      if (a < a0) a0 = a; if (a > a1) a1 = a;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    if (R) {
      const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
      R.cx = am * ux - bm * uz;
      R.cz = am * uz + bm * ux;
      R.hw = (a1 - a0) / 2; R.hd = (b1 - b0) / 2;
      // the box's local +x is world (ux, uz). physics.js: local +x ->
      // world (cos yaw, -sin yaw), so yaw = atan2(-uz, ux).
      R.yaw = Math.atan2(-uz, ux);
      normYaw(R);
    }
    return (a1 - a0) * (b1 - b0);
  }
  function foldAbs(ux, uz) {
    let y = Math.atan2(-uz, ux);
    const Q = Math.PI / 2;
    while (y > Math.PI / 4) y -= Q;
    while (y <= -Math.PI / 4) y += Q;
    return y < 0 ? -y : y;
  }
  function minRect(h) {
    if (h === 0) return false;
    if (h === 1) { RECT.cx = HX[0]; RECT.cz = HZ[0]; RECT.hw = RECT.hd = 0; RECT.yaw = 0; return true; }
    let best = rectFor(h, 1, 0, null);             // the axis frame
    for (let i = 0; i < h; i++) {
      const j = (i + 1) % h;
      const ux = HX[j] - HX[i], uz = HZ[j] - HZ[i];
      const L = Math.hypot(ux, uz);
      if (L < 1e-9) continue;
      const a = rectFor(h, ux / L, uz / L, null);
      if (a < best) best = a;
    }
    const lim = best * (1 + ROUND_TIE) + 1e-9;
    let bux = 1, buz = 0, byaw = rectFor(h, 1, 0, null) <= lim ? 0 : Infinity;
    for (let i = 0; i < h && byaw > 0; i++) {
      const j = (i + 1) % h;
      let ux = HX[j] - HX[i], uz = HZ[j] - HZ[i];
      const L = Math.hypot(ux, uz);
      if (L < 1e-9) continue;
      ux /= L; uz /= L;
      const fy = foldAbs(ux, uz);
      if (fy >= byaw) continue;
      if (rectFor(h, ux, uz, null) <= lim) { byaw = fy; bux = ux; buz = uz; }
    }
    rectFor(h, bux, buz, RECT);
    return true;
  }
  // fold yaw into (-PI/4, PI/4] by swapping the half-extents a quarter turn
  // at a time — the same box, the smallest rotation, so near-axis snapping
  // (and orientedCollider's own AABB test) sees it.
  function normYaw(r) {
    const Q = Math.PI / 2;
    let y = r.yaw;
    while (y > Math.PI / 4 + 1e-12) { y -= Q; const t = r.hw; r.hw = r.hd; r.hd = t; }
    while (y <= -Math.PI / 4 + 1e-12) { y += Q; const t = r.hw; r.hw = r.hd; r.hd = t; }
    r.yaw = y;
  }

  // ------------------------------------------------------- one record
  const stats = { built: 0, skipped: 0, slivers: 0, oversize: 0, flat: 0, compoundPieces: 0 };
  // footprint points = PX/PZ[s..e) (optionally masked); band y0..y1 given.
  function finish(out, s, e, use, y0, y1, opts, part) {
    const h = hull(s, e, use);
    if (!minRect(h)) { stats.skipped++; return; }
    let cx = RECT.cx, cz = RECT.cz, hw = RECT.hw, hd = RECT.hd, yaw = RECT.yaw;
    if (Math.abs(yaw) < AXIS_SNAP) {
      // near an axis: the points' own AABB (tight, and a plain AABB record)
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < h; i++) {
        if (HX[i] < x0) x0 = HX[i]; if (HX[i] > x1) x1 = HX[i];
        if (HZ[i] < z0) z0 = HZ[i]; if (HZ[i] > z1) z1 = HZ[i];
      }
      cx = (x0 + x1) / 2; cz = (z0 + z1) / 2; hw = (x1 - x0) / 2; hd = (z1 - z0) / 2; yaw = 0;
    }
    return emit(out, cx, cz, hw, hd, yaw, y0, y1, opts, part);
  }
  function emit(out, cx, cz, hw, hd, yaw, y0, y1, opts, part) {
    const big = Math.max(hw, hd) * 2;
    if (big < opts.minSpan) { stats.slivers++; stats.skipped++; return; }
    if (big > opts.maxSize) { stats.oversize++; stats.skipped++; return; }
    if (y1 - y0 < opts.minHeight) { stats.flat++; stats.skipped++; return; }
    if (big < THIN_SPAN && (y1 - y0) > THIN_RATIO * big) {
      const r = Math.max(hw, hd); hw = hd = r; yaw = 0;          // a post is a square
    }
    hw = Math.max(MIN_HALF, hw + opts.pad);
    hd = Math.max(MIN_HALF, hd + opts.pad);
    const by0 = opts.y0 != null ? opts.y0 : y0, by1 = opts.y1 != null ? opts.y1 : y1;
    const c = oriented(cx, cz, hw, hd, yaw, opts.fullHeight ? null : by0, by1);
    const src = part ? part.obj : null;
    c.ref = opts.ref !== undefined ? opts.ref : src;
    c._src = src;
    if (part && part.inst >= 0) c._inst = part.inst;
    c.src = opts.tag ? "mesh:" + opts.tag : "mesh";
    if (opts.noCam) c.noCam = true;
    c.noBreach = (hw * 2 < POST_SPAN && hd * 2 < POST_SPAN) ? true : opts.noBreach !== false;
    if (opts.cityTag) c._city = true;
    stats.built++;
    out.push(c);
    return c;
  }

  // ------------------------------------------------------- compound
  // islands by union-find over triangles, vertices welded by position so a
  // BoxGeometry's 6 split faces are one box while two boxes merged into one
  // BufferGeometry are two (unless they touch — then the cut pass below
  // separates them).
  function islands(geo, n0, n) {
    const cnt = n - n0;
    const parent = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) parent[i] = i;
    const find = function (a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const unite = function (a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    // weld
    const weld = new Map();
    const Q = 1e4;
    for (let i = 0; i < cnt; i++) {
      const k = Math.round(PX[n0 + i] * Q) + "," + Math.round(PY[n0 + i] * Q) + "," + Math.round(PZ[n0 + i] * Q);
      const w = weld.get(k);
      if (w === undefined) weld.set(k, i); else unite(i, w);
    }
    const tris = triIndex(geo, cnt);
    for (let t = 0; t < tris.length; t += 3) { unite(tris[t], tris[t + 1]); unite(tris[t], tris[t + 2]); }
    return { find: find, tris: tris };
  }
  function triIndex(geo, cnt) {
    if (geo.index) return geo.index.array;
    const a = new Uint32Array(cnt - (cnt % 3));
    for (let i = 0; i < a.length; i++) a[i] = i;
    return a;
  }

  // edges of an island's triangles in the island's (u,v) frame, with y
  function frameEdges(tris, members, n0, co, si, ox, oz) {
    const E = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      if (!members[a]) continue;
      const ids = [a, b, c, a];
      for (let q = 0; q < 3; q++) {
        const p = n0 + ids[q], r = n0 + ids[q + 1];
        const dx0 = PX[p] - ox, dz0 = PZ[p] - oz, dx1 = PX[r] - ox, dz1 = PZ[r] - oz;
        E.push(dx0 * co - dz0 * si, dx0 * si + dz0 * co, PY[p],
               dx1 * co - dz1 * si, dx1 * si + dz1 * co, PY[r]);
      }
    }
    return new Float64Array(E);
  }
  // tight bounds (u,v,y) of every edge clipped to [u0,u1]x[v0,v1]
  const CB = { u0: 0, u1: 0, v0: 0, v1: 0, y0: 0, y1: 0, any: false };
  function clipBounds(E, u0, u1, v0, v1) {
    CB.u0 = CB.v0 = CB.y0 = Infinity; CB.u1 = CB.v1 = CB.y1 = -Infinity; CB.any = false;
    for (let i = 0; i < E.length; i += 6) {
      const ax = E[i], av = E[i + 1], ay = E[i + 2];
      const du = E[i + 3] - ax, dv = E[i + 4] - av, dy = E[i + 5] - ay;
      let t0 = 0, t1 = 1;
      // Liang-Barsky on the rect
      const P = [-du, du, -dv, dv], Qv = [ax - u0, u1 - ax, av - v0, v1 - av];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        if (Math.abs(P[k]) < 1e-12) { if (Qv[k] < -1e-9) { ok = false; break; } continue; }
        const r = Qv[k] / P[k];
        if (P[k] < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
        else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
      if (!ok) continue;
      for (const t of [t0, t1]) {
        const u = ax + du * t, v = av + dv * t, y = ay + dy * t;
        if (u < CB.u0) CB.u0 = u; if (u > CB.u1) CB.u1 = u;
        if (v < CB.v0) CB.v0 = v; if (v > CB.v1) CB.v1 = v;
        if (y < CB.y0) CB.y0 = y; if (y > CB.y1) CB.y1 = y;
      }
      CB.any = true;
    }
    return CB.any;
  }
  function areaOf(E, u0, u1, v0, v1) {
    if (!clipBounds(E, u0, u1, v0, v1)) return 0;
    return Math.max(0, CB.u1 - CB.u0) * Math.max(0, CB.v1 - CB.v0);
  }
  // recursive best-cut. pieces: array of [u0,u1,v0,v1,y0,y1] tight rects.
  const CUT_EPS = 1e-3;
  function cutRegion(E, r, budget, pieces) {
    const area = (r[1] - r[0]) * (r[3] - r[2]);
    if (budget <= 1 || area < 1e-6) { pieces.push(r); return; }
    // candidate cuts: every distinct edge endpoint coordinate strictly inside
    // the rect, plus 16 even ones; capped at 64 per axis
    let bestCost = area * 0.8, best = null;
    for (let ax = 0; ax < 2; ax++) {
      const lo = ax ? r[2] : r[0], hi = ax ? r[3] : r[1];
      const span = hi - lo;
      if (span < 0.2) continue;
      const cand = [];
      for (let i = 0; i < E.length; i += 3) {
        const c = E[i + ax];
        if (c > lo + 0.05 && c < hi - 0.05) cand.push(c);
      }
      cand.sort(function (a, b) { return a - b; });
      const uniq = [];
      for (let i = 0; i < cand.length; i++) if (!uniq.length || cand[i] - uniq[uniq.length - 1] > 1e-4) uniq.push(cand[i]);
      for (let i = 1; i < 16; i++) uniq.push(lo + span * i / 16);
      const stride = Math.max(1, Math.ceil(uniq.length / 64));
      for (let i = 0; i < uniq.length; i += stride) {
        const c = uniq[i];
        // each side is measured an EPS short of the cut: a face lying IN the
        // cut plane (the inner face of an L's other arm) belongs to neither
        const a = ax ? areaOf(E, r[0], r[1], r[2], c - CUT_EPS) : areaOf(E, r[0], c - CUT_EPS, r[2], r[3]);
        if (a >= bestCost) continue;
        const b = ax ? areaOf(E, r[0], r[1], c + CUT_EPS, r[3]) : areaOf(E, c + CUT_EPS, r[1], r[2], r[3]);
        if (a + b < bestCost) { bestCost = a + b; best = [ax, c]; }
      }
    }
    if (!best) { pieces.push(r); return; }
    const ax = best[0], c = best[1];
    const lo = c - CUT_EPS, hi = c + CUT_EPS;
    const sides = ax ? [[r[0], r[1], r[2], lo], [r[0], r[1], hi, r[3]]] : [[r[0], lo, r[2], r[3]], [hi, r[1], r[2], r[3]]];
    const half = [Math.ceil(budget / 2), Math.floor(budget / 2)];
    for (let k = 0; k < 2; k++) {
      const s = sides[k];
      if (!clipBounds(E, s[0], s[1], s[2], s[3])) continue;
      const q = [CB.u0, CB.u1, CB.v0, CB.v1, CB.y0, CB.y1];
      // close the EPS seam: the two pieces meet AT the cut, no crack
      const slot = ax ? (k ? 2 : 3) : (k ? 0 : 1);
      if (Math.abs(q[slot] - (k ? hi : lo)) < 1e-6) q[slot] = c;
      cutRegion(E, q, half[k], pieces);
    }
  }
  function compoundPart(out, part, n0, n, opts) {
    const cnt = n - n0;
    const isl = islands(part.geo, n0, n);
    const roots = new Map();
    for (let i = 0; i < cnt; i++) {
      const r = isl.find(i);
      let m = roots.get(r);
      if (!m) { m = new Uint8Array(cnt); roots.set(r, m); }
      m[i] = 1;
    }
    roots.forEach(function (mask) {
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < cnt; i++) if (mask[i]) { const y = PY[n0 + i]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const h = hull(n0, n, mask);
      if (!minRect(h)) { stats.skipped++; return; }
      const R = { cx: RECT.cx, cz: RECT.cz, hw: RECT.hw, hd: RECT.hd, yaw: RECT.yaw };
      const budget = opts.slices;
      if (budget <= 1) { finish(out, n0, n, mask, y0, y1, opts, part); return; }
      // cut in the island's own frame (yaw snapped to 0 when near-axis)
      const yaw = Math.abs(R.yaw) < AXIS_SNAP ? 0 : R.yaw;
      const co = Math.cos(yaw), si = Math.sin(yaw);
      const E = frameEdges(isl.tris, mask, n0, co, si, R.cx, R.cz);
      if (!E.length) { finish(out, n0, n, mask, y0, y1, opts, part); return; }
      if (!clipBounds(E, -Infinity, Infinity, -Infinity, Infinity)) return;
      const pieces = [];
      cutRegion(E, [CB.u0, CB.u1, CB.v0, CB.v1, CB.y0, CB.y1], budget, pieces);
      if (pieces.length === 1 && yaw === R.yaw) { finish(out, n0, n, mask, y0, y1, opts, part); return; }
      for (const p of pieces) {
        const uc = (p[0] + p[1]) / 2, vc = (p[2] + p[3]) / 2;
        // local (u,v) -> world: dx = u*co + v*si, dz = -u*si + v*co
        const wx = R.cx + uc * co + vc * si, wz = R.cz - uc * si + vc * co;
        if (emit(out, wx, wz, (p[1] - p[0]) / 2, (p[3] - p[2]) / 2, yaw, p[4], p[5], opts, part)) stats.compoundPieces++;
      }
    });
  }

  // ------------------------------------------------------------ public
  function norm(opts) {
    opts = opts || {};
    const o = {};
    for (const k in opts) o[k] = opts[k];
    o.pad = +opts.pad || 0;
    o.minSpan = opts.minSpan == null ? 0.05 : +opts.minSpan;
    o.minHeight = opts.minHeight == null ? 0.05 : +opts.minHeight;
    o.maxSize = opts.maxSize == null ? 250 : +opts.maxSize;
    o.slices = opts.slices == null ? 4 : Math.max(1, opts.slices | 0);
    const ty = opts.trunkY;
    o.trunkLo = Array.isArray(ty) ? +ty[0] : 0.8;
    o.trunkHi = Array.isArray(ty) ? +ty[1] : (ty != null ? +ty : 2.0);
    return o;
  }

  function fromMesh(obj, opts) {
    const out = [];
    if (!obj || !window.THREE) return out;
    const o = norm(opts);
    // refresh the world matrix chain from the top ancestor down: a mesh built
    // a line ago under a translated group has a stale identity matrixWorld
    if (obj.updateWorldMatrix) obj.updateWorldMatrix(true, true);
    else if (obj.updateMatrixWorld) obj.updateMatrixWorld(true);
    const parts = collectParts(obj, []);
    if (!parts.length) return out;

    if (o.merge && !o.compound) {
      let n = 0;
      for (const p of parts) n = pushGeo(p.geo, p.e, n);
      one(out, 0, n, o, { obj: obj, inst: -1 });
      return out;
    }
    for (const p of parts) {
      const n = pushGeo(p.geo, p.e, 0);
      if (!n) continue;
      if (o.compound) compoundPart(out, p, 0, n, o);
      else one(out, 0, n, o, p);
    }
    return out;
  }
  // one hull over PX..[s,e): band + trunk filter + record
  function one(out, s, e, o, part) {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = s; i < e; i++) { const y = PY[i]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (o.trunkOnly) {
      // THE BOLE BAND. A tree's vertices live at its rims (a 1-segment
      // cylinder has none between root and crown), so the band is SAMPLED:
      // every vertex inside it plus every triangle edge's crossing of its
      // two planes. Those points are the trunk's real cross-section at knee
      // and head height, root flare and crown excluded.
      let lo = y0 + o.trunkLo, hi = y0 + o.trunkHi;
      if (hi > y1) { hi = y1; lo = Math.min(lo, (y0 + y1) / 2); }
      const tris = part && part.geo ? triIndex(part.geo, e - s) : null;
      ensure(e + (e - s) + (tris ? tris.length * 2 : 0) + 4);
      let k = e;
      for (let i = s; i < e; i++) {
        const y = PY[i];
        if (y >= lo && y <= hi) { PX[k] = PX[i]; PY[k] = y; PZ[k] = PZ[i]; k++; }
      }
      if (tris) for (let t = 0; t + 2 < tris.length; t += 3) {
        for (let q = 0; q < 3; q++) {
          const p = s + tris[t + q], r = s + tris[t + (q + 1) % 3];
          const ya = PY[p], yb = PY[r];
          for (let pl = 0; pl < 2; pl++) {
            const Y = pl ? hi : lo;
            if ((ya - Y) * (yb - Y) >= 0) continue;
            const f = (Y - ya) / (yb - ya);
            PX[k] = PX[p] + (PX[r] - PX[p]) * f; PY[k] = Y; PZ[k] = PZ[p] + (PZ[r] - PZ[p]) * f; k++;
          }
        }
      }
      if (k - e >= 3) return finish(out, e, k, null, y0, y1, o, part);
    }
    return finish(out, s, e, null, y0, y1, o, part);
  }

  // a THREE.Box3 (or {min,max}) -> one banded AABB record
  function fromBox3(b, opts) {
    if (!b || !b.min || !b.max || !(b.max.x >= b.min.x)) return null;
    const o = norm(opts), out = [];
    emit(out, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2,
      0, b.min.y, b.max.y, o, { obj: opts && opts.ref !== undefined ? opts.ref : null, inst: -1 });
    return out[0] || null;
  }

  function dirty() {
    if (typeof CBZ.markCollidersDirty === "function") { try { CBZ.markCollidersDirty(); } catch (e) { /* registry not up yet */ } }
  }
  function add(recs) {
    if (!recs) return 0;
    const list = Array.isArray(recs) ? recs : [recs];
    const cols = CBZ.colliders || (CBZ.colliders = []);
    const inc = typeof CBZ.colliderAdd === "function";
    let n = 0;
    for (const c of list) {
      if (!c) continue;
      if (inc) CBZ.colliderAdd(c); else cols.push(c);
      n++;
    }
    // physics.js's colliderAdd indexes in place when the grid is in sync;
    // everywhere else (microboot, a stale grid) the bell is what rebuilds it
    if (n && !inc) dirty();
    return n;
  }
  function removeAt(cols, i) {
    if (typeof CBZ.colliderRemove === "function") return CBZ.colliderRemove(cols[i], i);
    cols.splice(i, 1);
    return true;
  }
  function removeAllFor(ref) {
    const cols = CBZ.colliders;
    if (!cols || ref == null) return 0;
    let n = 0;
    for (let i = cols.length - 1; i >= 0; i--) {
      const c = cols[i];
      if (c && (c.ref === ref || c._src === ref)) { removeAt(cols, i); n++; }
    }
    if (n && typeof CBZ.colliderRemove !== "function") dirty();
    return n;
  }
  function remove(x) {
    const cols = CBZ.colliders;
    if (!cols || x == null) return 0;
    if (Array.isArray(x)) { let n = 0; for (const r of x) n += remove(r); return n; }
    const i = cols.indexOf(x);
    if (i >= 0) {
      removeAt(cols, i);
      if (typeof CBZ.colliderRemove !== "function") dirty();
      return 1;
    }
    return removeAllFor(x);
  }

  CBZ.meshCollider = {
    fromMesh: fromMesh,
    fromBox3: fromBox3,
    add: add,
    remove: remove,
    removeAllFor: removeAllFor,
    stats: stats,
    AXIS_SNAP: AXIS_SNAP,
  };
  CBZ.solidFromMesh = function (obj, opts) {
    const recs = fromMesh(obj, opts);
    add(recs);
    return recs;
  };
})();
