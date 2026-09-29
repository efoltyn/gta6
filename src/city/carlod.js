/* ============================================================
   city/carlod.js — A FAR CAR IS THE SAME CAR WITH FEWER TRIANGLES.

   WHY: a city car is ~21k triangles (tesla-3: 7k in four tyres with tread,
   5.6k in the cabin room seen through the glass, 0.9k steering wheel, the
   rest a lofted body, trim, lamps). That count is the same at 5 m and at
   140 m, where the whole car is ~30 pixels tall. Parked cars past 35 m are
   already instanced (carinstances.js) but instancing cuts DRAW CALLS, not
   vertices: every proxied car still pushed its 21k triangles.

   WHAT: every geometry a car draws gets ONE simplified twin, built once and
   cached (per geometry object, so per style: the fleet shares the merged
   buckets through vehicles.js sharedMerge and the template geometries):

     decimateSteps(geo, eps) — quadric edge collapse (Garland & Heckbert)
     onto existing vertices, stopped at a geometric tolerance `eps` metres.
       - vertices welded by position for topology; the attribute "wedges"
         (normal / uv / colour splits: hard creases, uv seams, shade bands)
         are carried through every collapse. A wedge of the removed vertex
         maps onto the kept vertex's wedge across the collapsed edge, or
         onto one whose normal is within 25 deg and colour within 6%;
         anything else (rubber vs alloy, a textured uv) blocks the collapse.
         The output reuses original attribute values only (no invented
         normals, uvs or colours: paint, glass and lamp colours and the
         baked cabin shade are the source's own).
       - open borders and attribute seams carry constraint planes weighted
         16x, so a panel outline / lamp-lens edge moves <= eps/4 and a lamp
         strip cannot fold away unless it is thinner than that (< 0.25 px).
       - no flips, no non-manifold collapses (link condition), no face
         turning > 60 deg off its original normal.
       - whole connected parts smaller than eps (bolts, lug nuts, badges)
         are dropped: their removal is itself an error < eps.

   THE SWITCH IS MEASURED, NOT GUESSED. On screen an error of EPS metres at
   distance d is

       px = EPS * H / (2 * d * tan(fov / 2))

   with H the drawing-buffer height in pixels and fov the vertical field
   of view. A car goes LOD when px < LOD_IN_PX and back to full detail when
   px > LOD_OUT_PX (hysteresis in pixel space, so no boundary flicker):

       1080p, fov 60:  H / (2 tan 30) = 935 px per m at 1 m
       EPS = 0.03 m -> 1 px at 28 m (LOD_OUT), 0.75 px at 37 m (LOD_IN).
       fov 46 (the city chase cam): 1272 px/m -> 38 m out, 51 m in.

   Measured on the whole road fleet (15 styles, merged like buildCar):
   max surface deviation 1.9 cm (< EPS), max silhouette shift 0.6 px at
   the 28 m LOD_OUT point (1080p/60), triangles 320,858 -> 197,153 (61%).

   WHY NOT 5-10%: the fleet is already modelled at about the pixel scale
   of the switch (~35 m^2 of surface in 21k tris = ~4 cm triangles), so
   there is little sub-pixel detail to remove at 37-51 m; what goes is the
   tread, lug nuts, flat-panel over-tessellation and cabin curvature finer
   than 3 cm. A 5-10% car needs ~15 cm of error, which is 1 px only at
   ~140-190 m, past the 150 m ring where cars stop drawing at all. The
   decimator itself does reach 15% on smooth, over-tessellated input.

   Because the switch is computed from the live camera every frame, a
   sniper scope (narrow fov) or a 4K buffer automatically pushes the switch
   out: the removed detail is below one pixel wherever the LOD is drawn.

   WHO USES IT:
     - carinstances.js: a proxied parked car past the switch draws the LOD
       geometry in its own instanced pool (same materials, same instance
       colour paint); crossing the switch re-proxies it on the other tier.
     - this file's runner: every AWAKE car (moving traffic, parked cars
       inside the proxy ring, wrecks) swaps each of its tracked meshes'
       GEOMETRY past the switch. Only geometry pointers change, so per-car
       state that lives in MATERIALS (brake lamps, frost, dead headlights,
       paint) or in transforms (wheel spin/steer, doors) is untouched.
       A mesh wearing a geometry somebody else set (crashdeform's
       copy-on-write dent) is never touched; crashdeform itself swaps a
       twin back to its source before it dents.

   BUILT OFF THE FRAME: vehicles.js buildCar queues a style's geometries
   (CBZ.carLodPrepare); a Web Worker runs the decimator (~0.2 s of work per
   new style) and the main thread only wraps the result. Without a Worker
   the runner falls back to working the queue ~2 ms a frame through the
   decimator's generator slices. Until a twin lands that mesh simply draws
   at full detail. Only
   fleet-shared (`_shared`) geometries get twins: a per-car geometry's twin
   would outlive the car's teardown on the GPU.

   Audit: CBZ.carLodAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const EPS = 0.03;                 // m: max geometric deviation of a LOD surface
  const LOD_IN_PX = 0.75;           // EPS projects below this -> LOD
  const LOD_OUT_PX = 1.0;           // EPS projects above this -> full detail again
  const MIN_SAVE = 0.1;             // a LOD that saves < 10% of the tris is not worth a buffer (and a far-tier pool)
  const DEFAULT_K = 1080 / (2 * Math.tan(Math.PI / 6));   // 1080p / 60 deg, before a camera exists

  /* ================================================================
     THE DECIMATOR (pure: geometry-shaped data in, plain arrays out)

     Self-contained ON PURPOSE: DECIMATOR is shipped to a Web Worker as its
     own source text (see THE WORKER below), so nothing in it may reach the
     enclosing scope. Its input is anything shaped like a BufferGeometry
     (attributes {array,itemSize,count,normalized}, index {array}, groups,
     drawRange) — a real one on the main thread, a structured clone in the
     worker — and its output is plain typed arrays that toGeo() wraps.
     ================================================================ */
  function DECIMATOR() {
  const EDGE_WEIGHT = 16;            // borders + attribute seams move <= EPS/4: a lamp strip thinner than that is < 0.25 px
  const SEAM_NORMAL_DOT = 0.9;       // a wedge may be re-homed across a seam onto a normal within 25 deg...
  const SEAM_COLOR_TOL = 0.06;       // ...and a vertex colour within 6% per channel (tread vs groove rubber, not rubber vs alloy)
  function qAddPlane(Q, o, a, b, c, d, w) {
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  }
  function qEval2(Q, a, b, x, y, z) {    // (Q[a] + Q[b]) evaluated at (x,y,z)
    const q0 = Q[a] + Q[b], q1 = Q[a + 1] + Q[b + 1], q2 = Q[a + 2] + Q[b + 2], q3 = Q[a + 3] + Q[b + 3];
    const q4 = Q[a + 4] + Q[b + 4], q5 = Q[a + 5] + Q[b + 5], q6 = Q[a + 6] + Q[b + 6];
    const q7 = Q[a + 7] + Q[b + 7], q8 = Q[a + 8] + Q[b + 8], q9 = Q[a + 9] + Q[b + 9];
    return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x
      + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
  }

  // min-heap of (cost, u, v, su, sv) in parallel arrays
  function Heap() { this.c = []; this.u = []; this.v = []; this.su = []; this.sv = []; this.n = 0; }
  Heap.prototype.push = function (cost, u, v, su, sv) {
    let i = this.n++;
    const C = this.c, U = this.u, V = this.v, SU = this.su, SV = this.sv;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (C[p] <= cost) break;
      C[i] = C[p]; U[i] = U[p]; V[i] = V[p]; SU[i] = SU[p]; SV[i] = SV[p];
      i = p;
    }
    C[i] = cost; U[i] = u; V[i] = v; SU[i] = su; SV[i] = sv;
  };
  Heap.prototype.pop = function (out) {
    const C = this.c, U = this.u, V = this.v, SU = this.su, SV = this.sv;
    out[0] = C[0]; out[1] = U[0]; out[2] = V[0]; out[3] = SU[0]; out[4] = SV[0];
    const n = --this.n;
    if (n <= 0) return;
    const c = C[n], u = U[n], v = V[n], su = SU[n], sv = SV[n];
    let i = 0;
    for (;;) {
      let k = 2 * i + 1;
      if (k >= n) break;
      if (k + 1 < n && C[k + 1] < C[k]) k++;
      if (C[k] >= c) break;
      C[i] = C[k]; U[i] = U[k]; V[i] = V[k]; SU[i] = SU[k]; SV[i] = SV[k];
      i = k;
    }
    C[i] = c; U[i] = u; V[i] = v; SU[i] = su; SV[i] = sv;
  };

  function rnd(x) { return x >= 0 ? (x + 0.5) | 0 : -((0.5 - x) | 0); }   // int32 round, no -0 / double boxing

  /* The work is a GENERATOR so the runtime can spread it over frames (a
     couple of ms each); decimate() below runs it to the end in one go. */
  function* decimateSteps(geo, eps, opt) {
    opt = opt || {};
    const pa = geo.attributes.position;
    if (!pa || pa.itemSize !== 3) return null;
    const index = geo.index ? geo.index.array : null;
    const nCorner = index ? index.length : pa.count;
    const nTri0 = (nCorner / 3) | 0;
    if (nTri0 < 4) return null;
    const names = Object.keys(geo.attributes);
    for (let i = 0; i < names.length; i++) {
      const a = geo.attributes[names[i]];
      if (a.isInterleavedBufferAttribute || !a.array) return null;
    }
    if (geo.morphAttributes && geo.morphAttributes.position && geo.morphAttributes.position.length) return null;
    const P = pa.array;
    const eps2 = eps * eps;
    const EW = opt.edgeWeight || EDGE_WEIGHT;

    // --- groups (multi-material geometries keep their ranges) ---
    const triGroup = new Int32Array(nTri0);
    const groups = geo.groups && geo.groups.length ? geo.groups : null;
    if (groups) {
      triGroup.fill(-1);
      for (let g = 0; g < groups.length; g++) {
        const s = (groups[g].start / 3) | 0, e = Math.min(nTri0, ((groups[g].start + groups[g].count) / 3) | 0);
        for (let t = s; t < e; t++) triGroup[t] = g;
      }
    }
    const dr = geo.drawRange;
    const drS = dr ? (dr.start / 3) | 0 : 0;
    const drE = dr && isFinite(dr.count) ? Math.min(nTri0, ((dr.start + dr.count) / 3) | 0) : nTri0;

    // --- weld: positions, then wedges (every attribute equal), by sorting ---
    const used = new Uint8Array(pa.count);
    const TA = new Int32Array(nTri0 * 3);       // corner -> source attribute vertex
    const inRange = new Uint8Array(nTri0);
    for (let t = 0; t < nTri0; t++) {
      if (t < drS || t >= drE || (groups && triGroup[t] < 0)) continue;
      inRange[t] = 1;
      for (let k = 0; k < 3; k++) { const ai = index ? index[t * 3 + k] : t * 3 + k; TA[t * 3 + k] = ai; used[ai] = 1; }
    }
    let nu = 0;
    for (let i = 0; i < pa.count; i++) if (used[i]) nu++;
    const U = new Int32Array(nu);
    for (let i = 0, j = 0; i < pa.count; i++) if (used[i]) U[j++] = i;
    const QP = new Int32Array(pa.count * 3);
    for (let j = 0; j < nu; j++) {
      const i = U[j];
      QP[i * 3] = rnd(P[i * 3] * 1e5); QP[i * 3 + 1] = rnd(P[i * 3 + 1] * 1e5); QP[i * 3 + 2] = rnd(P[i * 3 + 2] * 1e5);
    }
    // the other attributes, quantized, one row per source vertex
    const others = [];
    let K = 0;
    const ignore = opt.ignore || [];
    for (let i = 0; i < names.length; i++) if (names[i] !== "position" && ignore.indexOf(names[i]) < 0) { others.push(geo.attributes[names[i]]); K += geo.attributes[names[i]].itemSize; }
    const NA = geo.attributes.normal && ignore.indexOf("normal") < 0 ? geo.attributes.normal : null;
    const CA = geo.attributes.color && ignore.indexOf("color") < 0 ? geo.attributes.color : null;
    // every other keyed attribute (uv of a textured material...) must match exactly to re-home
    const strict = [];
    for (let i = 0; i < others.length; i++) if (others[i] !== NA && others[i] !== CA) strict.push(others[i]);
    const QA = new Int32Array(Math.max(1, pa.count * K));
    for (let j = 0; j < nu; j++) {
      const i = U[j];
      let o = i * K;
      for (let a = 0; a < others.length; a++) {
        const at = others[a], sz = at.itemSize, arr = at.array;
        for (let k = 0; k < sz; k++) QA[o++] = rnd(arr[i * sz + k] * 4096);
      }
    }
    yield 0;
    const byPos = Array.from(U);
    byPos.sort(function (a, b) {
      return (QP[a * 3] - QP[b * 3]) || (QP[a * 3 + 1] - QP[b * 3 + 1]) || (QP[a * 3 + 2] - QP[b * 3 + 2]);
    });
    const pvOf = new Int32Array(pa.count);
    const px = [];
    for (let j = 0; j < nu; j++) {
      const i = byPos[j];
      if (j === 0 || QP[i * 3] !== QP[byPos[j - 1] * 3] || QP[i * 3 + 1] !== QP[byPos[j - 1] * 3 + 1] || QP[i * 3 + 2] !== QP[byPos[j - 1] * 3 + 2]) px.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      pvOf[i] = px.length / 3 - 1;
    }
    yield 0;
    const byW = byPos;                  // positions already grouped: sort within by attributes
    byW.sort(function (a, b) {
      const d = pvOf[a] - pvOf[b];
      if (d) return d;
      for (let k = 0; k < K; k++) { const e = QA[a * K + k] - QA[b * K + k]; if (e) return e; }
      return 0;
    });
    yield 0;
    const wedgeOfAttr = new Int32Array(pa.count);
    const wedgeSrc = [], wedgeP = [];
    for (let j = 0; j < nu; j++) {
      const i = byW[j];
      let same = j > 0 && pvOf[i] === pvOf[byW[j - 1]];
      if (same) { const b = byW[j - 1]; for (let k = 0; k < K; k++) if (QA[i * K + k] !== QA[b * K + k]) { same = false; break; } }
      if (!same) { wedgeSrc.push(i); wedgeP.push(pvOf[i]); }
      wedgeOfAttr[i] = wedgeSrc.length - 1;
    }
    const TW = new Int32Array(nTri0 * 3);       // corner wedges
    const alive = new Uint8Array(nTri0);
    for (let t = 0; t < nTri0; t++) {
      if (!inRange[t]) continue;
      for (let k = 0; k < 3; k++) TW[t * 3 + k] = wedgeOfAttr[TA[t * 3 + k]];
      const a = wedgeP[TW[t * 3]], b = wedgeP[TW[t * 3 + 1]], c = wedgeP[TW[t * 3 + 2]];
      if (a !== b && b !== c && a !== c) alive[t] = 1;
    }
    const nP = px.length / 3;
    const X = new Float64Array(px);
    const TP = new Int32Array(nTri0 * 3);
    for (let i = 0; i < nTri0 * 3; i++) TP[i] = alive[(i / 3) | 0] ? wedgeP[TW[i]] : -1;

    yield 0;
    // --- face normals (current + original) ---
    const FN = new Float64Array(nTri0 * 3), FN0 = new Float64Array(nTri0 * 3);
    function faceNormal(a, b, c, out, o) {
      const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2];
      const ux = X[b * 3] - ax, uy = X[b * 3 + 1] - ay, uz = X[b * 3 + 2] - az;
      const vx = X[c * 3] - ax, vy = X[c * 3 + 1] - ay, vz = X[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-14) { out[o] = out[o + 1] = out[o + 2] = 0; return 0; }
      out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
      return l;
    }

    yield 0;
    // --- tiny connected parts go (their removal is an error < eps) ---
    const uf = new Int32Array(nP);
    for (let i = 0; i < nP; i++) uf[i] = i;
    const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    for (let t = 0; t < nTri0; t++) {
      if (!alive[t]) continue;
      const a = find(TP[t * 3]), b = find(TP[t * 3 + 1]), c = find(TP[t * 3 + 2]);
      uf[b] = a; uf[find(c)] = a;
    }
    const bb = new Map();
    for (let i = 0; i < nP; i++) {
      const r = find(i);
      let B = bb.get(r);
      if (!B) { B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; bb.set(r, B); }
      for (let k = 0; k < 3; k++) { const v = X[i * 3 + k]; if (v < B[k]) B[k] = v; if (v > B[k + 3]) B[k + 3] = v; }
    }
    let dropped = 0;
    for (let t = 0; t < nTri0; t++) {
      if (!alive[t]) continue;
      const B = bb.get(find(TP[t * 3]));
      const dx = B[3] - B[0], dy = B[4] - B[1], dz = B[5] - B[2];
      if (dx * dx + dy * dy + dz * dz < eps2) { alive[t] = 0; dropped++; }
    }

    yield 0;
    // --- adjacency: position vertex -> triangles ---
    const vt = new Array(nP);
    for (let i = 0; i < nP; i++) vt[i] = [];
    for (let t = 0; t < nTri0; t++) {
      if (!alive[t]) continue;
      faceNormal(TP[t * 3], TP[t * 3 + 1], TP[t * 3 + 2], FN, t * 3);
      FN0[t * 3] = FN[t * 3]; FN0[t * 3 + 1] = FN[t * 3 + 1]; FN0[t * 3 + 2] = FN[t * 3 + 2];
      vt[TP[t * 3]].push(t); vt[TP[t * 3 + 1]].push(t); vt[TP[t * 3 + 2]].push(t);
    }

    yield 0;
    // --- edges: border / seam / non-manifold ---
    const edgeMap = new Map();          // "a,b" (a<b) -> [tri, tri, ...]
    for (let t = 0; t < nTri0; t++) {
      if (!alive[t]) continue;
      for (let k = 0; k < 3; k++) {
        const a = TP[t * 3 + k], b = TP[t * 3 + (k + 1) % 3];
        const key = a < b ? a * nP + b : b * nP + a;
        const l = edgeMap.get(key);
        if (l) l.push(t); else edgeMap.set(key, [t]);
      }
    }
    const border = new Uint8Array(nP), locked = new Uint8Array(nP);
    const Q = new Float64Array(nP * 10);
    for (let t = 0; t < nTri0; t++) {
      if (!alive[t]) continue;
      const nx = FN[t * 3], ny = FN[t * 3 + 1], nz = FN[t * 3 + 2];
      if (nx === 0 && ny === 0 && nz === 0) continue;
      const a = TP[t * 3];
      const d = -(nx * X[a * 3] + ny * X[a * 3 + 1] + nz * X[a * 3 + 2]);
      for (let k = 0; k < 3; k++) qAddPlane(Q, TP[t * 3 + k] * 10, nx, ny, nz, d, 1);
    }
    function wedgeAt(t, p) {
      for (let k = 0; k < 3; k++) if (TP[t * 3 + k] === p) return TW[t * 3 + k];
      return -1;
    }
    function constrain(t, a, b) {       // plane through edge ab, perpendicular to face t
      const ex = X[b * 3] - X[a * 3], ey = X[b * 3 + 1] - X[a * 3 + 1], ez = X[b * 3 + 2] - X[a * 3 + 2];
      const nx = FN[t * 3], ny = FN[t * 3 + 1], nz = FN[t * 3 + 2];
      let cx = ey * nz - ez * ny, cy = ez * nx - ex * nz, cz = ex * ny - ey * nx;
      const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (l < 1e-12) return;
      cx /= l; cy /= l; cz /= l;
      const d = -(cx * X[a * 3] + cy * X[a * 3 + 1] + cz * X[a * 3 + 2]);
      qAddPlane(Q, a * 10, cx, cy, cz, d, EW);
      qAddPlane(Q, b * 10, cx, cy, cz, d, EW);
    }
    edgeMap.forEach(function (tl, key) {
      const a = Math.floor(key / nP), b = key - a * nP;
      if (tl.length === 1) { border[a] = border[b] = 1; constrain(tl[0], a, b); }
      else if (tl.length > 2) { locked[a] = locked[b] = 1; }
      else {
        const t0 = tl[0], t1 = tl[1];
        if (wedgeAt(t0, a) !== wedgeAt(t1, a) || wedgeAt(t0, b) !== wedgeAt(t1, b)) { constrain(t0, a, b); constrain(t1, a, b); }
      }
    });

    yield 0;
    // --- the collapse loop ---
    const stamp = new Int32Array(nP);
    const dead = new Uint8Array(nP);
    const mark = new Int32Array(nP);        // neighbour marking for the link test
    let markId = 0;
    const heap = new Heap();
    const mapFrom = [], mapTo = [];

    function sharedTris(u, v, out) {
      out.length = 0;
      const L = vt[u];
      for (let i = 0; i < L.length; i++) {
        const t = L[i];
        if (!alive[t]) continue;
        if (TP[t * 3] === v || TP[t * 3 + 1] === v || TP[t * 3 + 2] === v) out.push(t);
      }
      return out;
    }
    const _sh = [];
    // v's wedge whose attributes are near enough to stand in for wedge wu, or -1
    function closestWedge(wu, v) {
      const a = wedgeSrc[wu];
      let best = -1, bestD = Infinity;
      const Lv = vt[v];
      for (let i = 0; i < Lv.length; i++) {
        const t = Lv[i];
        if (!alive[t]) continue;
        const wv = wedgeAt(t, v);
        if (wv === best) continue;
        const b = wedgeSrc[wv];
        let d = 0, ok = true;
        if (NA) {
          const n = NA.array;
          const dot = n[a * 3] * n[b * 3] + n[a * 3 + 1] * n[b * 3 + 1] + n[a * 3 + 2] * n[b * 3 + 2];
          if (dot < SEAM_NORMAL_DOT) ok = false; else d += 1 - dot;
        }
        if (ok && CA) {
          const c = CA.array, s = CA.itemSize;
          for (let k = 0; k < Math.min(3, s); k++) { const e = Math.abs(c[a * s + k] - c[b * s + k]); if (e > SEAM_COLOR_TOL) { ok = false; break; } d += e; }
        }
        for (let j = 0; ok && j < strict.length; j++) {
          const at = strict[j], s = at.itemSize, arr = at.array;
          for (let k = 0; k < s; k++) if (Math.abs(arr[a * s + k] - arr[b * s + k]) > 1e-4) { ok = false; break; }
        }
        if (ok && d < bestD) { bestD = d; best = wv; }
      }
      return best;
    }
    // cost of u -> v, or -1 when the collapse is illegal
    function tryCost(u, v) {
      if (locked[u] || dead[u] || dead[v]) return -1;
      const sh = sharedTris(u, v, _sh);
      if (!sh.length) return -1;
      if (border[u] && sh.length !== 1) return -1;        // a border vertex only slides along its border
      // link condition: common neighbours == the apexes of the shared tris
      markId++;
      const Lu = vt[u], Lv = vt[v];
      for (let i = 0; i < Lu.length; i++) {
        const t = Lu[i]; if (!alive[t]) continue;
        for (let k = 0; k < 3; k++) mark[TP[t * 3 + k]] = markId;
      }
      let common = 0;
      markId++;
      const m2 = markId;
      for (let i = 0; i < Lv.length; i++) {
        const t = Lv[i]; if (!alive[t]) continue;
        for (let k = 0; k < 3; k++) {
          const w = TP[t * 3 + k];
          if (w === u || w === v) continue;
          if (mark[w] === m2 - 1) { mark[w] = m2; common++; }
        }
      }
      if (common !== sh.length) return -1;
      // wedge map: each wedge of u must land on exactly one wedge of v
      mapFrom.length = 0; mapTo.length = 0;
      for (let i = 0; i < sh.length; i++) {
        const wu = wedgeAt(sh[i], u), wv = wedgeAt(sh[i], v);
        let j = mapFrom.indexOf(wu);
        if (j < 0) { mapFrom.push(wu); mapTo.push(wv); } else if (mapTo[j] !== wv) return -1;
      }
      const vx = X[v * 3], vy = X[v * 3 + 1], vz = X[v * 3 + 2];
      for (let i = 0; i < Lu.length; i++) {
        const t = Lu[i];
        if (!alive[t]) continue;
        const o = t * 3;
        if (TP[o] === v || TP[o + 1] === v || TP[o + 2] === v) continue;
        const wu = wedgeAt(t, u);
        if (mapFrom.indexOf(wu) < 0) {                   // not on the collapsed edge: re-home it onto v's closest wedge
          const wv = closestWedge(wu, v);
          if (wv < 0) return -1;
          mapFrom.push(wu); mapTo.push(wv);
        }
        // the moved face: no flip, no collapse to a sliver, stays near its original facing
        let ax, ay, az, bx, by, bz, cx, cy, cz;
        const i0 = TP[o], i1 = TP[o + 1], i2 = TP[o + 2];
        if (i0 === u) { ax = vx; ay = vy; az = vz; } else { ax = X[i0 * 3]; ay = X[i0 * 3 + 1]; az = X[i0 * 3 + 2]; }
        if (i1 === u) { bx = vx; by = vy; bz = vz; } else { bx = X[i1 * 3]; by = X[i1 * 3 + 1]; bz = X[i1 * 3 + 2]; }
        if (i2 === u) { cx = vx; cy = vy; cz = vz; } else { cx = X[i2 * 3]; cy = X[i2 * 3 + 1]; cz = X[i2 * 3 + 2]; }
        const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (l < 1e-12) return -1;
        nx /= l; ny /= l; nz /= l;
        if (nx * FN[o] + ny * FN[o + 1] + nz * FN[o + 2] < 0.2) return -1;
        if (nx * FN0[o] + ny * FN0[o + 1] + nz * FN0[o + 2] < 0.5) return -1;
      }
      const e = qEval2(Q, u * 10, v * 10, vx, vy, vz);
      return e < 0 ? 0 : e;
    }
    // queue both directions on the quadric alone; the full legality test runs when one is popped
    function pushEdge(a, b) {
      if (!locked[a]) {
        const c = qEval2(Q, a * 10, b * 10, X[b * 3], X[b * 3 + 1], X[b * 3 + 2]);
        if (c <= eps2) heap.push(c < 0 ? 0 : c, a, b, stamp[a], stamp[b]);
      }
      if (!locked[b]) {
        const c = qEval2(Q, a * 10, b * 10, X[a * 3], X[a * 3 + 1], X[a * 3 + 2]);
        if (c <= eps2) heap.push(c < 0 ? 0 : c, b, a, stamp[b], stamp[a]);
      }
    }
    let nEdge = 0;
    for (const [key, tl] of edgeMap) {
      if ((++nEdge & 2047) === 0) yield 0;
      const a = Math.floor(key / nP), b = key - a * nP;
      let any = false;
      for (let i = 0; i < tl.length; i++) if (alive[tl[i]]) { any = true; break; }
      if (any) pushEdge(a, b);
    }
    const top = [0, 0, 0, 0, 0];
    const nbr = [];
    let collapses = 0;
    let pops = 0;
    while (heap.n > 0) {
      if ((++pops & 63) === 0) yield 0;
      heap.pop(top);
      const u = top[1], v = top[2];
      if (dead[u] || dead[v] || stamp[u] !== top[3] || stamp[v] !== top[4]) continue;
      const cost = tryCost(u, v);                        // re-validate against the live mesh
      if (cost < 0 || cost > eps2) continue;
      if (cost > top[0] + 1e-12) { heap.push(cost, u, v, stamp[u], stamp[v]); continue; }
      // apply u -> v (mapFrom/mapTo were filled by tryCost)
      const Lu = vt[u], Lv = vt[v];
      for (let i = 0; i < Lu.length; i++) {
        const t = Lu[i];
        if (!alive[t]) continue;
        const o = t * 3;
        if (TP[o] === v || TP[o + 1] === v || TP[o + 2] === v) { alive[t] = 0; continue; }
        for (let k = 0; k < 3; k++) if (TP[o + k] === u) {
          TP[o + k] = v;
          TW[o + k] = mapTo[mapFrom.indexOf(TW[o + k])];
        }
        faceNormal(TP[o], TP[o + 1], TP[o + 2], FN, o);
        Lv.push(t);
      }
      Lu.length = 0;
      for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
      dead[u] = 1;
      stamp[v]++;
      collapses++;
      // compact v's list and re-queue its edges
      let n = 0;
      for (let i = 0; i < Lv.length; i++) if (alive[Lv[i]]) Lv[n++] = Lv[i];
      Lv.length = n;
      markId++;
      nbr.length = 0;
      for (let i = 0; i < n; i++) {
        const o = Lv[i] * 3;
        for (let k = 0; k < 3; k++) {
          const w = TP[o + k];
          if (w !== v && mark[w] !== markId) { mark[w] = markId; nbr.push(w); }
        }
      }
      for (let i = 0; i < nbr.length; i++) pushEdge(v, nbr[i]);
    }

    yield 0;
    // --- output: indexed, original attribute values only ---
    let nTri = 0;
    for (let t = 0; t < nTri0; t++) if (alive[t]) nTri++;
    const outOfWedge = new Int32Array(wedgeSrc.length).fill(-1);
    const order = [];
    const ngroups = groups ? groups.length : 1;
    const out = { attrs: [], index: null, groups: [], userData: null };
    const idx = [];
    for (let g = 0; g < ngroups; g++) {
      const start = idx.length;
      for (let t = 0; t < nTri0; t++) {
        if (!alive[t] || (groups && triGroup[t] !== g)) continue;
        for (let k = 0; k < 3; k++) {
          const w = TW[t * 3 + k];
          if (outOfWedge[w] < 0) { outOfWedge[w] = order.length; order.push(w); }
          idx.push(outOfWedge[w]);
        }
      }
      if (groups) out.groups.push({ start: start, count: idx.length - start, materialIndex: groups[g].materialIndex });
    }
    const nv = order.length;
    for (let i = 0; i < names.length; i++) {
      const src = geo.attributes[names[i]], s = src.itemSize, arr = src.array;
      const dst = new arr.constructor(nv * s);
      for (let j = 0; j < nv; j++) {
        const ai = wedgeSrc[order[j]];
        for (let k = 0; k < s; k++) dst[j * s + k] = arr[ai * s + k];
      }
      out.attrs.push({ name: names[i], array: dst, itemSize: s, normalized: !!src.normalized });
    }
    out.index = nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    let nb = 0, nl = 0, nseam = 0;
    for (let i = 0; i < nP; i++) { if (border[i]) nb++; if (locked[i]) nl++; }
    out.userData = { carLod: true, srcTris: nTri0, tris: nTri, eps: eps, dropped: dropped, collapses: collapses, nP: nP, nW: wedgeSrc.length, border: nb, locked: nl };
    return out;
  }
  return decimateSteps;
  }
  const decimateSteps = DECIMATOR();

  // the decimator's plain output -> a BufferGeometry that culls like its source
  function toGeo(o, src) {
    if (!o) return null;
    const g = new THREE.BufferGeometry();
    for (let i = 0; i < o.attrs.length; i++) {
      const a = o.attrs[i];
      g.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    }
    g.setIndex(new THREE.BufferAttribute(o.index, 1));
    for (let i = 0; i < o.groups.length; i++) g.addGroup(o.groups[i].start, o.groups[i].count, o.groups[i].materialIndex);
    if (src.boundingSphere) g.boundingSphere = src.boundingSphere.clone();   // same car, same cull sphere
    else g.computeBoundingSphere();
    if (src.boundingBox) g.boundingBox = src.boundingBox.clone();
    g.userData = o.userData;
    return g;
  }
  function decimate(geo, eps, opt) {
    const it = decimateSteps(geo, eps, opt);
    for (;;) { const r = it.next(); if (r.done) return toGeo(r.value, geo); }
  }

  /* ================================================================
     THE CACHE: one LOD per (geometry, world scale, uv-matters). The value
     is the LOD geometry, or the source itself when simplifying does not
     pay. Built in a Web Worker (THE WORKER below; BUDGET_MS a frame on the main thread without one), never in one
     go: until a geometry's LOD lands, cars draw that mesh at full detail.
     ================================================================ */
  const BUDGET_MS = 2;
  const cache = new WeakMap();          // geo -> Map(key -> geo)
  let built = 0, kept = 0, srcTrisTotal = 0, lodTrisTotal = 0, workMs = 0;
  const TEX = ["map", "roughnessMap", "metalnessMap", "normalMap", "emissiveMap", "alphaMap", "aoMap", "bumpMap",
    "lightMap", "specularMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "displacementMap"];
  function textured(m) {
    if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) if (textured(m[i])) return true; return false; }
    if (!m) return false;
    for (let i = 0; i < TEX.length; i++) if (m[TEX[i]]) return true;
    return false;
  }
  function keyOf(s, tex) { return Math.round(s * 100) * 2 + (tex ? 1 : 0); }
  function slot(geo) { let m = cache.get(geo); if (!m) { m = new Map(); cache.set(geo, m); } return m; }
  // the scale a mesh has relative to its car's group (the group itself may be scaled by a crash squash)
  function relScale(o, root) {
    let s = 1, n = o;
    while (n && n !== root) { s *= Math.max(Math.abs(n.scale.x), Math.abs(n.scale.y), Math.abs(n.scale.z)); n = n.parent; }
    return s;
  }
  function shaderMat(m) {
    if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) if (shaderMat(m[i])) return true; return false; }
    return !m || !!(m.isShaderMaterial || m.isRawShaderMaterial);
  }
  function lodMeshOk(o) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return false;
    if (o.userData && o.userData.noLod) return false;
    if (shaderMat(o.material)) return false;               // a custom shader may read its vertices its own way
    const g = o.geometry;
    // only fleet-shared sources: a per-car geometry (a dent copy) would leak its twin's GPU buffers at teardown
    return !!(g && g._shared && g.isBufferGeometry && g.attributes.position && !g._carLodSrc && !(g.userData && g.userData.carLod));
  }
  // every LOD-able mesh under a car, skipping a seated occupant's whole body (vehicles.js owns it)
  function eachLodMesh(o, fn) {
    if (o.userData && o.userData.occupant) return;
    if (lodMeshOk(o)) fn(o);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) eachLodMesh(ch[i], fn);
  }

  const jobs = [];                      // { geo, s, tex, key, it }
  const PENDING = 0;                    // cache marker while a job is queued
  function enqueue(geo, s, tex) {
    const m = slot(geo), k = keyOf(s, tex);
    if (m.has(k)) return;
    m.set(k, PENDING);
    jobs.push({ geo: geo, s: s, tex: tex, key: k, it: null });
  }
  function finish(job, d) {
    let lod = job.geo;
    if (d && d.userData.tris <= (1 - MIN_SAVE) * d.userData.srcTris) {
      d._shared = true;                 // never disposed by teardown; crashdeform copies before it dents
      d._carLodSrc = job.geo;
      d.name = "car-lod";
      // readers that size a part off its geometry (vehicles.js flat tyre, crashdeform popWheel:
      // parameters.radiusTop) must read the same numbers off the twin
      if (job.geo.parameters) d.parameters = job.geo.parameters;
      if (job.geo.userData) for (const k in job.geo.userData) if (!(k in d.userData)) d.userData[k] = job.geo.userData[k];
      lod = d;
      built++; srcTrisTotal += d.userData.srcTris; lodTrisTotal += d.userData.tris;
    } else kept++;
    slot(job.geo).set(job.key, lod);
  }
  function work(budgetMs) {
    if (!jobs.length) return;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now(), end = t0 + budgetMs;
    while (jobs.length && now() < end) {
      const job = jobs[0];
      try {
        if (!job.it) job.it = decimateSteps(job.geo, EPS / Math.max(1e-3, job.s), job.tex ? null : { ignore: ["uv", "uv2"] });
        let r;
        do { r = job.it.next(); } while (!r.done && now() < end);
        if (!r.done) break;
        jobs.shift();
        finish(job, toGeo(r.value, job.geo));
      } catch (e) { jobs.shift(); finish(job, null); }
    }
    workMs += now() - t0;
  }

  /* ---- THE WORKER --------------------------------------------------------
     The queue above used to be worked ON THE MAIN THREAD, 2 ms of every
     frame, for as long as it held anything — and a city boot queues every
     style the fleet spawns with (~0.2 s of decimation each), so the first
     minutes of play paid a flat 2+ ms a frame for twins nobody could see
     yet. The decimator is pure arithmetic on typed arrays, so it runs in a
     Web Worker built from DECIMATOR's own source: the main thread only
     copies a geometry's arrays out (structured clone) and wraps the result
     (toGeo). Same function, same output, off the frame — and the twins land
     sooner, since a worker is not capped at 2 ms per frame. No Worker (node
     checks, a sandbox that refuses blob: workers, a worker that errors) and
     the time-sliced main-thread path above takes the queue exactly as before. */
  // Jobs are small (~3 ms of decimation each, measured: 197 twins in 532 ms),
  // so the worker is kept a few deep: results only come back when the main
  // thread is between tasks, and a shallow pipe would leave it idle for a
  // whole frame after every pair. Each dispatch structured-clones one car
  // part's arrays (tens of KB), so a pump sends at most PER_PUMP.
  const MAX_INFLIGHT = 8, PER_PUMP = 4;
  let worker = null, workerDead = false, inflight = 0, jobSeq = 0, workerJobs = 0;
  const inFlight = new Map();             // id -> job
  function failWorker() {
    workerDead = true;
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    inFlight.forEach(function (job) { job.it = null; jobs.unshift(job); });   // the main thread redoes them
    inFlight.clear(); inflight = 0;
  }
  function getWorker() {
    if (worker || workerDead) return worker;
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) { workerDead = true; return null; }
      const src = "var decimateSteps = (" + DECIMATOR.toString() + ")();\n" +
        "onmessage = function (e) { var j = e.data, out = null;\n" +
        "  try { var it = decimateSteps(j.geo, j.eps, j.opt), r; do { r = it.next(); } while (!r.done); out = r.value; } catch (err) { out = null; }\n" +
        "  var tr = []; if (out) { for (var i = 0; i < out.attrs.length; i++) tr.push(out.attrs[i].array.buffer); tr.push(out.index.buffer); }\n" +
        "  postMessage({ id: j.id, out: out }, tr); };\n";
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = onWorkerDone;
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); failWorker(); };
    } catch (e) { workerDead = true; worker = null; }
    return worker;
  }
  // the geometry as the decimator reads it, with arrays the clone can copy
  // cheaply (a view into a bigger buffer would ship the whole buffer)
  function plainGeo(geo) {
    const attrs = {};
    for (const k in geo.attributes) {
      const a = geo.attributes[k];
      if (!a || a.isInterleavedBufferAttribute || !a.array) return null;
      const arr = a.array, own = arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength;
      attrs[k] = { array: own ? arr : arr.slice(), itemSize: a.itemSize, count: a.count, normalized: !!a.normalized };
    }
    const ia = geo.index && geo.index.array;
    const mp = geo.morphAttributes && geo.morphAttributes.position;
    return {
      attributes: attrs,
      index: ia ? { array: ia.byteOffset === 0 && ia.byteLength === ia.buffer.byteLength ? ia : ia.slice() } : null,
      groups: geo.groups ? geo.groups.map(function (g) { return { start: g.start, count: g.count, materialIndex: g.materialIndex }; }) : [],
      drawRange: geo.drawRange ? { start: geo.drawRange.start, count: geo.drawRange.count } : null,
      morphAttributes: mp && mp.length ? { position: [0] } : {},
    };
  }
  function onWorkerDone(e) {
    const d = e.data, job = d && inFlight.get(d.id);
    if (!job) return;
    inFlight.delete(d.id); inflight--; workerJobs++;
    try { finish(job, toGeo(d.out, job.geo)); } catch (err) { finish(job, null); }
    if (jobs.length && inflight < MAX_INFLIGHT / 2) pump();   // refill between frames too, not only at the next tick
  }
  function pump() {
    const w = getWorker();
    if (!w) { work(BUDGET_MS); return; }
    let sent = 0;
    while (inflight < MAX_INFLIGHT && jobs.length && sent++ < PER_PUMP) {
      const job = jobs.shift();
      if (job.it) { jobs.unshift(job); work(BUDGET_MS); return; }   // a main-thread job already half done: finish it there
      const pg = plainGeo(job.geo);
      if (!pg) { finish(job, null); continue; }
      job.id = ++jobSeq;
      inFlight.set(job.id, job); inflight++;
      try { w.postMessage({ id: job.id, geo: pg, eps: EPS / Math.max(1e-3, job.s), opt: job.tex ? null : { ignore: ["uv", "uv2"] } }); }
      catch (err) { inFlight.delete(job.id); inflight--; jobs.unshift(job); failWorker(); return; }
    }
  }

  /* PREPARE (vehicles.js buildCar, with the car's GROUP): queue every geometry this car draws. */
  CBZ.carLodPrepare = function (root) {
    if (!root || !root.traverse) return;
    eachLodMesh(root, function (o) { enqueue(o.geometry, relScale(o, root), textured(o.material)); });
  };
  // (geo, scale, material) -> the LOD geometry | the source itself (no LOD) | null (not built yet, now queued)
  function lodOf(geo, s, mat) {
    if (!geo || !geo._shared || geo._carLodSrc || !geo.attributes || !geo.attributes.position || shaderMat(mat)) return geo;
    const tex = textured(mat), m = cache.get(geo), k = keyOf(s, tex);
    const l = m ? m.get(k) : undefined;
    if (l === undefined) { enqueue(geo, s, tex); return null; }
    return l === PENDING ? null : l;
  }

  /* ================================================================
     THE SWITCH (pixel space, from the live camera)
     ================================================================ */
  let kPx = DEFAULT_K;                 // px per metre at 1 m
  let inD2 = 0, outD2 = 0;
  function updateK() {
    const cam = CBZ.camera, r = CBZ.renderer;
    let H = 1080;
    if (r && r.domElement && r.domElement.height) H = r.domElement.height;
    let fov = cam && cam.fov ? cam.fov : 60;
    if (cam && cam.zoom && cam.zoom !== 1) fov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) / cam.zoom) * 180 / Math.PI;
    kPx = H / (2 * Math.tan(fov * Math.PI / 360));
    const dIn = EPS * kPx / LOD_IN_PX, dOut = EPS * kPx / LOD_OUT_PX;
    inD2 = dIn * dIn; outD2 = dOut * dOut;
  }
  updateK();
  // hysteresis: `wasLod` is the car's current tier
  function wantLod(d2, wasLod) { return wasLod ? d2 > outD2 : d2 > inD2; }

  /* ================================================================
     AWAKE CARS: swap mesh geometry pointers past the switch
     ================================================================ */
  function trackOf(c) {
    const grp = c.group;
    const vis = (grp.userData && grp.userData.carVisual) || grp;
    let tr = c._lodTrack;
    if (tr && tr.vis === vis && tr.gch === grp.children.length && tr.vch === vis.children.length &&
        !(tr.pending && (frame - tr.at) >= 60)) return tr;
    if (tr && tr.on) apply(tr, false);
    tr = { vis: vis, gch: grp.children.length, vch: vis.children.length, meshes: [], full: [], lod: [], on: false, pending: false, at: frame };
    eachLodMesh(grp, function (o) {
      const l = lodOf(o.geometry, relScale(o, grp), o.material);
      if (l === null) { tr.pending = true; return; }       // still being built: this mesh stays full, re-checked in ~1 s
      if (l === o.geometry) return;                         // simplifying it does not pay
      tr.meshes.push(o); tr.full.push(o.geometry); tr.lod.push(l);
    });
    c._lodTrack = tr;
    return tr;
  }
  // Only ever swaps between the two geometries it recorded. A mesh wearing
  // anything else (crashdeform's dented copy) is left exactly as it is.
  function apply(tr, on) {
    const M = tr.meshes;
    for (let i = 0; i < M.length; i++) {
      const o = M[i];
      if (on) { if (o.geometry === tr.full[i]) o.geometry = tr.lod[i]; }
      else if (o.geometry === tr.lod[i]) o.geometry = tr.full[i];
    }
    tr.on = on;
  }
  // back to full detail right now (carinstances.js before it captures a car, crash deform)
  function restore(c) {
    const tr = c && c._lodTrack;
    if (tr && tr.on) apply(tr, false);
  }
  CBZ.carLodRestore = restore;

  let frame = 0, swapsLast = 0;
  function tick() {
    frame++;
    swapsLast = 0;
    if (jobs.length) pump();
    const g = CBZ.game;
    const cars = CBZ.cityCars;
    if (!g || g.mode !== "city" || !cars || !CBZ.camera) return;
    updateK();
    const cam = CBZ.camera.position;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      // asleep / proxied / hidden cars draw nothing of their own; whatever
      // makes one visible again runs before this pass (999.4), so it is
      // re-tiered before the frame that shows it
      if (!c || !c.group || c._sleep || c._proxy || c.group.visible === false) continue;
      const tr0 = c._lodTrack, was = !!(tr0 && tr0.on);
      let on = false;
      if (!c.player && !c.dead) {
        const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
        on = wantLod(dx * dx + dz * dz, was);
      }
      if (!on && !was) continue;                      // near and full: nothing to do, not even a track
      const tr = trackOf(c);
      if (tr.on !== on) swapsLast++;
      apply(tr, on);                                  // also catches meshes a crash repair handed back
    }
  }
  if (CBZ.onAlways) CBZ.onAlways(999.4, tick);     // just before carinstances.js (999.5), after all car motion

  /* ================================================================
     PUBLIC
     ================================================================ */
  CBZ.carLod = {
    EPS: EPS, LOD_IN_PX: LOD_IN_PX, LOD_OUT_PX: LOD_OUT_PX,
    decimate: decimate,
    steps: decimateSteps,               // the same work as a generator (one yield per slice; plain-array output, see toGeo)
    lodOf: lodOf,                       // (geo, scale, material) -> LOD geo | the geo itself | null (queued)
    work: work,                         // (budgetMs) run the build queue (node checks, a loading screen)
    relScale: relScale,
    wantLod: function (d2, wasLod) { return wantLod(d2, wasLod); },
    switchDistances: function () { return { lodIn: Math.sqrt(inD2), lodOut: Math.sqrt(outD2), pxPerMetreAt1m: kPx }; },
    _tick: tick,
  };
  CBZ.carLodAudit = function () {
    let tracked = 0, lodCars = 0;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) { const t = cars[i] && cars[i]._lodTrack; if (t) { tracked++; if (t.on) lodCars++; } }
    const sd = CBZ.carLod.switchDistances();
    return { geometries: built, keptFull: kept, srcTris: srcTrisTotal, lodTris: lodTrisTotal,
      ratio: srcTrisTotal ? +(lodTrisTotal / srcTrisTotal).toFixed(3) : null, buildMs: Math.round(workMs),
      trackedCars: tracked, lodCars: lodCars, swapsLastFrame: swapsLast, queued: jobs.length, inWorker: inflight, workerJobs: workerJobs, worker: !!worker,
      lodIn: +sd.lodIn.toFixed(1), lodOut: +sd.lodOut.toFixed(1) };
  };
})();
