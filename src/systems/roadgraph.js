/* ============================================================
   systems/roadgraph.js — CBZ.roadGraph: THE ONE WAY A VEHICLE FINDS ITS WAY,
   on any map. Pure maths: no THREE, no DOM, no page globals; runs in the
   browser (Gang City, NPC War) and in node.

   WHAT IT REPLACED. Gang City had two road routers: motorcade.js §1-§2 (a
   real graph, crossings, docks, lanes, a filleted drive path with a speed
   profile) and systems/navigation.js's cityGraph (a second graph that
   scanned every node against every road, O(n x m), for the map arrows).
   NPC War had none: a vehicle drove a straight line at the enemy. Both
   routers are gone; this file is the motorcade's router lifted out whole
   and made map-agnostic, plus a terrain planner for ground with no roads.

   ROADS. A map hands over whatever road records it has:
     axis-aligned  { x, z, vertical, len, w, district?, access?, ... }
                   (every Gang City builder, NPC War's downtown)
     any heading   { ax, az, bx, bz, w, ... }  (a custom map's diagonal road)
   Nodes are segment ends, crossings (within half a road width of each
   other's ends, so T-junctions meet), and the projection of any end that
   stops within a road width of another segment (causeway docks, spurs).
   Edges run between consecutive nodes along each segment, weighted by
   length x the segment's cost (a service spur 2.5, a highway 0.85).
   Built once per road list (cached on the array and its length).

   LANES. Everyone drives on the right: a leg's lane is offset to the
   driver's right of travel by CBZ.roadLaneCenter's distance (the same
   number traffic.js drives), corners are the intersections of the offset
   legs, filleted by makePath at 11 m in town and 45 m on a highway.

   NO ROADS (NPC War's dunes, snow, fields, the wood; any custom map): the
   terrain planner. An A* over a grid on the window between the two ends,
   each cell costed by its grade (rise over run, worst axis) off the map's
   own groundAt, with water, walls and steeper-than-the-vehicle-can-climb
   cells closed. The cell path is string-pulled to straight legs that stay
   on passable, no-steeper ground, and the corners filleted the same way.

   CLOSING A ROAD. close(G, x, z, r) shuts every segment that passes within
   r of the point (a blown bridge, a crater, a wreck across the lane): the
   router never uses it again until reopen(). G.ver counts the changes so a
   driver can tell its route went stale (systems/convoy.js re-routes).

   PUBLIC  CBZ.roadGraph = {
     build(roads) -> G           of(roads) -> G (cached)
     snap(G, x, z) -> { si, t, x, z, d }
     route(G, from, to, opts?) -> { pts, legs, junctions, from, to, ok, cost }
         opts.avoid(si, seg) -> true skips a segment; closed ones always are
     lanes(G, R, opts?) -> { pts, radii }      the drivable right-hand lane
     close(G, x, z, r) / reopen(G, x, z, r) -> count     G.ver, G.closed
     path(pts, radii, zones?) -> P  { x, z, s, h, k, n, len, poly, caps(vmax, lat, brake, zoneMul) }
     pathAt(P, s) / capAt(P, s, caps) / projectS(P, x, z, s0, s1) / pathSlice(P, s0, s1) / segIdx(P, s)
     terrain(from, to, world, opts?) -> { pts, radii, ok, kind: "terrain" }
         world { groundAt(x, z), waterAt?(x, z), blockedAt?(x, z, r), avoid?: [{x, z, r}] }
         opts  { maxGrade (0.36), cell, margin (160), maxCells (60000), r (body radius) }
     plan(world, from, to, opts?) -> { pts, radii, junctions, kind: "road"|"terrain"|"direct", ok, segs }
         world.roads (array) is used when both ends are within opts.offRoad (140 m) of one;
         `to` goes through driveTarget first, so a column never drives into a building
     driveTarget(world, x, z, opts?) -> { x, z, road, entry }   THE ONE PLACE a
         "drive to this point / this man" goal is made drivable: a point inside a
         building or compound (world.entryAt) becomes its way in, then the kerb
         beside it; open ground off the road is kept only when the drive is clear
   }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});

  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapA(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }
  function lerpAng(a, b, t) { return a + wrapA(b - a) * t; }

  /* ============================================================
     THE GRAPH
     ============================================================ */
  const CELL = 64;
  function ckey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
  function segCost(r) {
    if (r.access === "service") return 2.5;            // other compounds' private spurs
    if (r.district === "highway") return 0.85;         // a column takes the fast road
    return 1;
  }
  // one record -> a segment from a to b (t runs 0..len along u)
  function toSeg(r) {
    if (!r) return null;
    let ax, az, bx, bz;
    if (isFinite(r.ax) && isFinite(r.az) && isFinite(r.bx) && isFinite(r.bz)) { ax = +r.ax; az = +r.az; bx = +r.bx; bz = +r.bz; }
    else {
      if (!isFinite(r.x) || !isFinite(r.z) || !(r.len > 1)) return null;
      const h = r.len / 2;
      if (r.vertical) { ax = r.x; bx = r.x; az = r.z - h; bz = r.z + h; }
      else { az = r.z; bz = r.z; ax = r.x - h; bx = r.x + h; }
    }
    const len = d2(ax, az, bx, bz);
    if (!(len > 1)) return null;
    return { r: r, ax: ax, az: az, bx: bx, bz: bz, ux: (bx - ax) / len, uz: (bz - az) / len, len: len,
      hw: Math.max(2, (r.w != null ? +r.w : 18) / 2), cost: segCost(r), st: [] };
  }
  function pt(sg, t) { return { x: sg.ax + sg.ux * t, z: sg.az + sg.uz * t }; }
  function project(sg, x, z) { return clamp((x - sg.ax) * sg.ux + (z - sg.az) * sg.uz, 0, sg.len); }
  function cellsOf(sg, pad, fn) {
    const x0 = Math.min(sg.ax, sg.bx) - sg.hw - pad, x1 = Math.max(sg.ax, sg.bx) + sg.hw + pad;
    const z0 = Math.min(sg.az, sg.bz) - sg.hw - pad, z1 = Math.max(sg.az, sg.bz) + sg.hw + pad;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) fn(ckey(cx, cz));
  }
  function build(roads) {
    const segs = [];
    for (let i = 0; i < roads.length; i++) { const s = toSeg(roads[i]); if (s) segs.push(s); }
    const nx = [], nz = [], adj = [];
    function node(x, z) { nx.push(x); nz.push(z); adj.push([]); return nx.length - 1; }
    function edge(a, b, w, si) { adj[a].push(b, w, si); adj[b].push(a, w, si); }
    const grid = new Map();
    for (let i = 0; i < segs.length; i++) {
      cellsOf(segs[i], 4, function (k) { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); });
    }
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      sg.na = node(sg.ax, sg.az); sg.nb = node(sg.bx, sg.bz);
      sg.st.push({ t: 0, n: sg.na }, { t: sg.len, n: sg.nb });
    }
    // crossings: each pair once, each line stretched by the other's half
    // width + 2 m so a T-junction that stops at the kerb still meets
    const mark = new Int32Array(segs.length).fill(-1);
    for (let i = 0; i < segs.length; i++) {
      const A = segs[i];
      cellsOf(A, 4, function (k) {
        const a = grid.get(k); if (!a) return;
        for (let q = 0; q < a.length; q++) {
          const j = a[q]; if (j <= i || mark[j] === i) continue; mark[j] = i;
          const B = segs[j];
          const den = A.ux * B.uz - A.uz * B.ux;
          if (Math.abs(den) < 0.08) continue;              // parallel: a dock joins them, not a crossing
          const wx = B.ax - A.ax, wz = B.az - A.az;
          const ta = (wx * B.uz - wz * B.ux) / den, tb = (wx * A.uz - wz * A.ux) / den;
          const ea = B.hw + 2, eb = A.hw + 2;
          if (ta < -ea || ta > A.len + ea || tb < -eb || tb > B.len + eb) continue;
          const p = pt(A, ta), n = node(p.x, p.z);
          A.st.push({ t: ta, n: n }); B.st.push({ t: tb, n: n });
        }
      });
    }
    // loose ends: an end within a road width of another segment docks onto it
    const stamp = new Int32Array(segs.length).fill(-1);
    let sid = 0;
    for (let i = 0; i < segs.length; i++) {
      const A = segs[i];
      for (let e = 0; e < 2; e++) {
        const px = e ? A.bx : A.ax, pz = e ? A.bz : A.az, n = e ? A.nb : A.na;
        const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
        sid++;
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
          const a = grid.get(ckey(cx + ox, cz + oz)); if (!a) continue;
          for (let q = 0; q < a.length; q++) {
            const j = a[q]; if (j === i || stamp[j] === sid) continue; stamp[j] = sid;
            const B = segs[j];
            const tb = project(B, px, pz), qp = pt(B, tb);
            const d = d2(px, pz, qp.x, qp.z);
            if (d > Math.max(6, B.hw + 2)) continue;
            const m = node(qp.x, qp.z);
            B.st.push({ t: tb, n: m });
            edge(n, m, Math.max(0.01, d), -1);
          }
        }
      }
    }
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], st = sg.st;
      st.sort(function (a, b) { return a.t - b.t || a.n - b.n; });
      for (let k = 0; k + 1 < st.length; k++) edge(st[k].n, st[k + 1].n, Math.max(0.001, (st[k + 1].t - st[k].t) * sg.cost), i);
    }
    return { segs: segs, nx: nx, nz: nz, adj: adj, grid: grid, pt: pt, closed: new Set(), ver: 0 };
  }
  const CACHE = new WeakMap();
  function of(roads) {
    if (!Array.isArray(roads) || !roads.length) return null;
    const c = CACHE.get(roads);
    if (c && c.n === roads.length) return c.G;
    let G = null;
    try { G = build(roads); } catch (e) { G = null; if (W.console) console.error("[roadGraph] build", e); }
    CACHE.set(roads, { n: roads.length, G: G });
    return G;
  }

  function snap(G, x, z) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const seen = new Set();
    function test(i) {
      if (seen.has(i)) return; seen.add(i);
      const sg = G.segs[i];
      if (G.closed.has(i)) return;
      const t = project(sg, x, z), p = pt(sg, t);
      const d = d2(x, z, p.x, p.z) * (sg.r.access === "service" ? 1.6 : 1);
      if (d < bd) { bd = d; best = { si: i, t: t, x: p.x, z: p.z, d: d }; }
    }
    const RINGS = [1, 3, 8, 20];
    for (let r = 0; r < RINGS.length; r++) {
      const R = RINGS[r];
      for (let ox = -R; ox <= R; ox++) for (let oz = -R; oz <= R; oz++) {
        const a = G.grid.get(ckey(cx + ox, cz + oz)); if (!a) continue;
        for (let q = 0; q < a.length; q++) test(a[q]);
      }
      if (best && bd <= R * CELL) return best;
    }
    for (let i = 0; i < G.segs.length; i++) test(i);
    return best;
  }

  // a binary min-heap on parallel arrays (no allocation per push)
  function Heap() { this.k = []; this.n = []; }
  Heap.prototype.push = function (k, n) {
    const hk = this.k, hn = this.n;
    let i = hk.length; hk.push(k); hn.push(n);
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; let t = hk[p]; hk[p] = hk[i]; hk[i] = t; t = hn[p]; hn[p] = hn[i]; hn[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const hk = this.k, hn = this.n;
    const n = hn[0], lk = hk.pop(), ln = hn.pop();
    if (hk.length) {
      hk[0] = lk; hn[0] = ln; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; let t = hk[m]; hk[m] = hk[i]; hk[i] = t; t = hn[m]; hn[m] = hn[i]; hn[i] = t; i = m; }
    }
    return n;
  };

  // Dijkstra from a snapped point to a snapped point. Returns the point chain
  // (start, nodes..., end), the segment of each leg (-1 = a dock connector)
  // and the junction nodes passed (degree >= 3).
  function route(G, from, to, opts) {
    const avoid = opts && opts.avoid;
    const A = snap(G, from.x, from.z), B = snap(G, to.x, to.z);
    if (!A || !B) return null;
    const N = G.nx.length;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), pseg = new Int32Array(N).fill(-2);
    const H = new Heap();
    function bracket(sn) {
      const sg = G.segs[sn.si], st = sg.st;
      let lo = st[0], hi = st[st.length - 1];
      for (let k = 0; k < st.length; k++) {
        if (st[k].t <= sn.t + 1e-6) lo = st[k];
        if (st[k].t >= sn.t - 1e-6) { hi = st[k]; break; }
      }
      return [{ n: lo.n, c: Math.abs(sn.t - lo.t) * sg.cost }, { n: hi.n, c: Math.abs(hi.t - sn.t) * sg.cost }];
    }
    const srcs = bracket(A), dsts = bracket(B);
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (s.c < dist[s.n]) { dist[s.n] = s.c; prev[s.n] = -1; pseg[s.n] = A.si; H.push(s.c, s.n); }
    }
    let best = Infinity, bestN = -1;
    if (A.si === B.si) best = Math.abs(A.t - B.t) * G.segs[A.si].cost;
    const tgt = new Map();
    for (let i = 0; i < dsts.length; i++) { const o = tgt.get(dsts[i].n); if (o == null || dsts[i].c < o) tgt.set(dsts[i].n, dsts[i].c); }
    const done = new Uint8Array(N);
    while (H.k.length) {
      const k = H.k[0], n = H.pop();
      if (done[n]) continue; done[n] = 1;
      if (k >= best) break;
      const tc = tgt.get(n);
      if (tc != null && k + tc < best) { best = k + tc; bestN = n; }
      const a = G.adj[n];
      for (let q = 0; q < a.length; q += 3) {
        const si = a[q + 2];
        if (si >= 0 && (G.closed.has(si) || (avoid && avoid(si, G.segs[si])))) continue;
        const m = a[q], nk = k + a[q + 1];
        if (nk < dist[m]) { dist[m] = nk; prev[m] = n; pseg[m] = si; H.push(nk, m); }
      }
    }
    const pts = [{ x: A.x, z: A.z }], legs = [], junctions = [];
    if (bestN < 0) {
      pts.push({ x: B.x, z: B.z }); legs.push(A.si === B.si ? A.si : -1);
      return { pts: pts, legs: legs, junctions: junctions, from: A, to: B, ok: A.si === B.si, cost: best };
    }
    const chain = [];
    for (let n = bestN; n >= 0; n = prev[n]) chain.push(n);
    chain.reverse();
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i];
      pts.push({ x: G.nx[n], z: G.nz[n] });
      legs.push(i === 0 ? A.si : pseg[n]);
      if (G.adj[n].length >= 9) junctions.push({ x: G.nx[n], z: G.nz[n] });
    }
    pts.push({ x: B.x, z: B.z }); legs.push(B.si);
    return { pts: pts, legs: legs, junctions: junctions, from: A, to: B, ok: true, cost: best };
  }

  // how far right of the centreline a lane runs (traffic.js's own number)
  function laneOff(r, lane) {
    if (CBZ.roadLaneCenter) {
      try { const o = +CBZ.roadLaneCenter(r, 1, lane | 0); if (isFinite(o)) return Math.abs(o); } catch (e) {}
    }
    return r && r.w ? Math.min(r.w / 4, 3.6) : 2.1;
  }
  // the drivable lane polyline for a node chain: each leg that runs along its
  // segment shifted onto the lane to the driver's right; corners where two
  // offset legs meet
  function lanes(G, R, opts) {
    const lane = opts && opts.lane != null ? opts.lane : 0;
    const legs = [];
    for (let i = 0; i + 1 < R.pts.length; i++) {
      const a = R.pts[i], b = R.pts[i + 1];
      const L0 = d2(a.x, a.z, b.x, b.z);
      if (L0 < 0.3) continue;
      const si = R.legs[i], sg = si >= 0 ? G.segs[si] : null;
      let A = { x: a.x, z: a.z }, B = { x: b.x, z: b.z }, along = false, dir = 0;
      const fx = (b.x - a.x) / L0, fz = (b.z - a.z) / L0;
      if (sg && Math.abs(fx * sg.uz - fz * sg.ux) * L0 < 0.5) {
        dir = (fx * sg.ux + fz * sg.uz) >= 0 ? 1 : -1;
        const o = laneOff(sg.r, lane), rx = -fz * o, rz = fx * o;      // the driver's right
        A.x += rx; A.z += rz; B.x += rx; B.z += rz;
        along = true;
      }
      const L = legs[legs.length - 1];
      if (L && L.si === si && si >= 0 && L.dir === dir && L.along === along) { L.b = B; continue; }
      legs.push({ a: A, b: B, si: si, along: along, dir: dir, fx: fx, fz: fz, hw: sg ? sg.r.district === "highway" : false });
    }
    if (!legs.length) return { pts: R.pts.slice(), radii: R.pts.map(function () { return 10; }) };
    const pts = [legs[0].a], radii = [0];
    for (let i = 0; i + 1 < legs.length; i++) {
      const A = legs[i], B = legs[i + 1];
      const den = A.fx * B.fz - A.fz * B.fx;
      if (A.along && B.along && Math.abs(den) > 0.1) {
        // where the two offset lines cross
        const wx = B.a.x - A.a.x, wz = B.a.z - A.a.z;
        const ta = (wx * B.fz - wz * B.fx) / den;
        pts.push({ x: A.a.x + A.fx * ta, z: A.a.z + A.fz * ta });
        radii.push(A.hw && B.hw ? 45 : 11);
      } else {
        pts.push(A.b); radii.push(5);
        pts.push(B.a); radii.push(5);
      }
    }
    pts.push(legs[legs.length - 1].b); radii.push(0);
    // drop near-duplicates (keep the larger radius)
    const op = [pts[0]], orad = [radii[0]];
    for (let i = 1; i < pts.length; i++) {
      const q = op[op.length - 1];
      if (d2(q.x, q.z, pts[i].x, pts[i].z) < 0.6) { orad[orad.length - 1] = Math.max(orad[orad.length - 1], radii[i]); continue; }
      op.push(pts[i]); orad.push(radii[i]);
    }
    return { pts: op, radii: orad };
  }

  // A ROAD OR A BRIDGE IS GONE: every segment within r of the point shuts
  function close(G, x, z, r, open) {
    if (!G) return 0;
    let n = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), R = Math.ceil((r + 20) / CELL);
    const seen = new Set();
    for (let ox = -R; ox <= R; ox++) for (let oz = -R; oz <= R; oz++) {
      const a = G.grid.get(ckey(cx + ox, cz + oz)); if (!a) continue;
      for (let q = 0; q < a.length; q++) {
        const i = a[q]; if (seen.has(i)) continue; seen.add(i);
        const sg = G.segs[i], p = pt(sg, project(sg, x, z));
        if (d2(x, z, p.x, p.z) > r + sg.hw) continue;
        if (open) { if (G.closed.delete(i)) n++; }
        else if (!G.closed.has(i)) { G.closed.add(i); n++; }
      }
    }
    if (n) G.ver++;
    return n;
  }

  /* ============================================================
     THE DRIVE PATH — fillet the corners, measure it, and know how fast
     every metre of it can be taken.
     ============================================================ */
  function path(pts, radii, zones) {
    // fillet: each corner becomes a sampled quadratic arc of its radius,
    // never eating more than 48 % of either leg
    const fx = [], fz = [];
    function add(x, z) {
      const n = fx.length;
      if (n && Math.abs(fx[n - 1] - x) < 0.05 && Math.abs(fz[n - 1] - z) < 0.05) return;
      fx.push(x); fz.push(z);
    }
    add(pts[0].x, pts[0].z);
    for (let i = 1; i + 1 < pts.length; i++) {
      const A = pts[i - 1], B = pts[i], C = pts[i + 1];
      const l1 = d2(A.x, A.z, B.x, B.z), l2 = d2(B.x, B.z, C.x, C.z);
      if (l1 < 0.01 || l2 < 0.01) { add(B.x, B.z); continue; }
      const u1x = (B.x - A.x) / l1, u1z = (B.z - A.z) / l1, u2x = (C.x - B.x) / l2, u2z = (C.z - B.z) / l2;
      const dot = clamp(u1x * u2x + u1z * u2z, -1, 1), th = Math.acos(dot);
      const R = (radii && radii[i]) || 0;
      if (th < 0.02 || th > 2.9 || R <= 0) { add(B.x, B.z); continue; }
      let T = R * Math.tan(th / 2);
      T = Math.min(T, l1 * 0.48, l2 * 0.48);
      const p1x = B.x - u1x * T, p1z = B.z - u1z * T, p2x = B.x + u2x * T, p2z = B.z + u2z * T;
      const Reff = T / Math.tan(th / 2);
      const m = Math.max(2, Math.ceil(th * Reff / 1.5));
      for (let k = 0; k <= m; k++) {
        const t = k / m, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        add(a * p1x + b * B.x + c * p2x, a * p1z + b * B.z + c * p2z);
      }
    }
    const last = pts[pts.length - 1]; add(last.x, last.z);
    if (fx.length < 2) { fx.push(fx[0] + 0.01); fz.push(fz[0]); }
    // densify long straights to <= 8 m so zone limits and braking curves are
    // sampled along them, not just at their ends
    for (let i = fx.length - 1; i > 0; i--) {
      const L = d2(fx[i], fz[i], fx[i - 1], fz[i - 1]);
      if (L <= 8) continue;
      const m = Math.ceil(L / 8), ins = [], inz = [];
      for (let k = 1; k < m; k++) { ins.push(fx[i - 1] + (fx[i] - fx[i - 1]) * k / m); inz.push(fz[i - 1] + (fz[i] - fz[i - 1]) * k / m); }
      fx.splice.apply(fx, [i, 0].concat(ins)); fz.splice.apply(fz, [i, 0].concat(inz));
    }
    const n = fx.length, s = new Float64Array(n), hv = new Float64Array(n), k = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + d2(fx[i], fz[i], fx[i - 1], fz[i - 1]);
    const hs = [];
    for (let i = 0; i + 1 < n; i++) hs.push(Math.atan2(fx[i + 1] - fx[i], fz[i + 1] - fz[i]));
    if (!hs.length) hs.push(0);
    for (let i = 0; i < n; i++) {
      const a = hs[Math.max(0, i - 1)], b = hs[Math.min(hs.length - 1, i)];
      hv[i] = i === 0 ? hs[0] : i === n - 1 ? hs[hs.length - 1] : lerpAng(a, b, 0.5);
      if (i > 0 && i < n - 1) {
        const ds = Math.max(0.3, (s[i + 1] - s[i - 1]) / 2);
        k[i] = Math.abs(wrapA(b - a)) / ds;
      }
    }
    // zone caps (compounds, towns): any vertex inside a slow rect
    const zc = new Float64Array(n).fill(Infinity);
    if (zones) for (let i = 0; i < n; i++) for (let q = 0; q < zones.length; q++) {
      const Z = zones[q];
      if (fx[i] >= Z.minX && fx[i] <= Z.maxX && fz[i] >= Z.minZ && fz[i] <= Z.maxZ) zc[i] = Math.min(zc[i], Z.v);
    }
    // a speed profile: the bend (lateral grip budget), the zone, and the
    // braking distance back from every slower stretch
    function caps(vmax, lat, brake, zoneMul) {
      const c = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let v = vmax;
        if (k[i] > 1e-4) v = Math.min(v, Math.sqrt(lat / k[i]));
        if (zc[i] < Infinity) v = Math.min(v, zc[i] * (zoneMul || 1));
        c[i] = Math.max(2.5, v);
      }
      for (let i = n - 2; i >= 0; i--) c[i] = Math.min(c[i], Math.sqrt(c[i + 1] * c[i + 1] + 2 * brake * (s[i + 1] - s[i])));
      return c;
    }
    return { x: fx, z: fz, s: s, h: hv, k: k, n: n, len: s[n - 1], caps: caps };
  }
  function segIdx(P, s) {
    let lo = 0, hi = P.n - 1;
    if (s <= 0) return 0;
    if (s >= P.len) return Math.max(0, P.n - 2);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.s[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  // position + heading at arc length s (extrapolated straight past either end)
  function pathAt(P, s, out) {
    out = out || {};
    if (P.n < 2) { out.x = P.x[0]; out.z = P.z[0]; out.h = P.h[0] || 0; return out; }
    const i = segIdx(P, s), j = i + 1;
    const L = P.s[j] - P.s[i] || 1e-6;
    const f = (s - P.s[i]) / L;
    out.x = P.x[i] + (P.x[j] - P.x[i]) * f; out.z = P.z[i] + (P.z[j] - P.z[i]) * f;
    out.h = (f <= 0 || f >= 1) ? Math.atan2(P.x[j] - P.x[i], P.z[j] - P.z[i]) : lerpAng(P.h[i], P.h[j], f);
    return out;
  }
  function capAt(P, s, c) {
    if (s <= 0) return c[0];
    if (s >= P.len) return c[P.n - 1];
    // v^2 is linear in s under constant braking, so interpolate the square
    const i = segIdx(P, s), L = P.s[i + 1] - P.s[i] || 1e-6, f = clamp((s - P.s[i]) / L, 0, 1);
    return Math.sqrt(c[i] * c[i] + (c[i + 1] * c[i + 1] - c[i] * c[i]) * f);
  }
  // nearest arc length to a point (optionally within [s0, s1])
  function projectS(P, x, z, s0, s1) {
    let best = 0, bd = Infinity;
    const a = s0 == null ? 0 : s0, b = s1 == null ? P.len : s1;
    let i0 = 0, i1 = P.n - 1;
    if (s0 != null) i0 = segIdx(P, a);
    if (s1 != null) i1 = Math.min(P.n - 1, segIdx(P, b) + 1);
    for (let i = i0; i < i1; i++) {
      if (P.s[i + 1] < a || P.s[i] > b) continue;
      const ax = P.x[i], az = P.z[i], bx = P.x[i + 1], bz = P.z[i + 1];
      const L2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az) || 1e-9;
      const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2, 0, 1);
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const d = d2(x, z, px, pz);
      if (d < bd) { bd = d; best = P.s[i] + t * (P.s[i + 1] - P.s[i]); }
    }
    return best;
  }
  // the points of P between two arc lengths (a formation keeps its stretch
  // of the old path while a new route is appended ahead of it)
  function pathSlice(P, s0, s1) {
    const out = [], rad = [];
    const a = pathAt(P, s0); out.push({ x: a.x, z: a.z }); rad.push(0);
    for (let i = 0; i < P.n; i++) if (P.s[i] > s0 + 0.2 && P.s[i] < s1 - 0.2) { out.push({ x: P.x[i], z: P.z[i] }); rad.push(0); }
    const b = pathAt(P, s1); out.push({ x: b.x, z: b.z }); rad.push(0);
    return { pts: out, radii: rad };
  }

  /* ============================================================
     OPEN GROUND — the terrain planner (no roads, or off them)
     ============================================================ */
  /* The window between the two ends may be too tight for the way round (a
     dune field whose ridges run across the line): widen it twice, then let
     the grade out a step at a time (a column crawls up what it must). */
  function terrain(from, to, world, opts) {
    opts = opts || {};
    const m0 = opts.margin != null ? opts.margin : 160, g0 = opts.maxGrade || 0.36;
    const tries = [[m0, g0], [m0 * 2.5, g0], [m0 * 5, g0], [m0 * 2.5, g0 * 1.3], [m0 * 2.5, g0 * 1.7]];
    let T = null;
    for (let i = 0; i < tries.length; i++) {
      T = terrainOnce(from, to, world, Object.assign({}, opts, { margin: tries[i][0], maxGrade: tries[i][1] }));
      if (T.ok) { T.grade = tries[i][1]; return T; }
    }
    return T;
  }
  function terrainOnce(from, to, world, opts) {
    const g = world.groundAt;
    const maxGrade = opts.maxGrade || 0.36;              // ~20 deg: a loaded truck's practical limit
    const margin = opts.margin != null ? opts.margin : 160;
    const x0 = Math.min(from.x, to.x) - margin, x1 = Math.max(from.x, to.x) + margin;
    const z0 = Math.min(from.z, to.z) - margin, z1 = Math.max(from.z, to.z) + margin;
    const maxCells = opts.maxCells || 60000;
    const cell = Math.max(opts.cell || 6, Math.sqrt((x1 - x0) * (z1 - z0) / maxCells));
    const w = Math.max(2, Math.ceil((x1 - x0) / cell)), h = Math.max(2, Math.ceil((z1 - z0) / cell));
    const avoid = world.avoid || null, rad = opts.r || 2;
    const mul = new Float32Array(w * h).fill(-1);          // -1 unknown, 0 closed, else cost per metre
    function cx(i) { return x0 + (i + 0.5) * cell; }
    function cz(j) { return z0 + (j + 0.5) * cell; }
    function costAt(x, z) {
      if (avoid) for (let q = 0; q < avoid.length; q++) { const A = avoid[q]; if (d2(x, z, A.x, A.z) < A.r) return 0; }
      if (world.waterAt && world.waterAt(x, z)) return 0;
      if (world.blockedAt && world.blockedAt(x, z, rad)) return 0;
      if (!g) return 1;
      const e = cell * 0.5;
      const gx = Math.abs(g(x + e, z) - g(x - e, z)) / (2 * e), gz = Math.abs(g(x, z + e) - g(x, z - e)) / (2 * e);
      const gr = Math.max(gx, gz);
      if (gr > maxGrade) return 0;
      const q = gr / maxGrade;
      return 1 + 8 * q * q;
    }
    function C(i, j) {
      const k = j * w + i;
      let m = mul[k];
      if (m < 0) { m = costAt(cx(i), cz(j)); mul[k] = m; }
      return m;
    }
    const si = clamp(Math.floor((from.x - x0) / cell), 0, w - 1), sj = clamp(Math.floor((from.z - z0) / cell), 0, h - 1);
    const ti = clamp(Math.floor((to.x - x0) / cell), 0, w - 1), tj = clamp(Math.floor((to.z - z0) / cell), 0, h - 1);
    // the two ends are where they are: open them whatever the grid says
    mul[sj * w + si] = Math.max(1, costAt(cx(si), cz(sj)) || 1); mul[tj * w + ti] = Math.max(1, costAt(cx(ti), cz(tj)) || 1);
    const N = w * h, G = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const H = new Heap();
    const goal = tj * w + ti;
    function hcost(i, j) { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return cell * (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz)); }
    G[sj * w + si] = 0; H.push(hcost(si, sj), sj * w + si);
    const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBZ = [0, 0, 1, -1, 1, -1, 1, -1];
    let found = false, pops = 0;
    while (H.k.length) {
      const k = H.pop();
      if (done[k]) continue; done[k] = 1;
      if (k === goal) { found = true; break; }
      if (++pops > N * 2) break;
      const i = k % w, j = (k / w) | 0, m0 = C(i, j);
      for (let q = 0; q < 8; q++) {
        const ni = i + NBX[q], nj = j + NBZ[q];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (done[nk]) continue;
        const m1 = C(ni, nj);
        if (m1 <= 0) continue;
        // no corner-cutting past a closed cell
        if (q >= 4 && (C(ni, j) <= 0 || C(i, nj) <= 0)) continue;
        const step = (q < 4 ? cell : cell * 1.41421) * (m0 + m1) * 0.5;
        const nd = G[k] + step;
        if (nd < G[nk]) { G[nk] = nd; prev[nk] = k; H.push(nd + hcost(ni, nj), nk); }
      }
    }
    if (!found) return { pts: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], radii: [0, 0], ok: false, kind: "terrain" };
    const chain = [];
    for (let k = goal; k >= 0; k = prev[k]) chain.push(k);
    chain.reverse();
    const raw = chain.map(function (k) { return { x: cx(k % w), z: cz((k / w) | 0) }; });
    raw[0] = { x: from.x, z: from.z }; raw[raw.length - 1] = { x: to.x, z: to.z };
    // STRING-PULL: from each kept point, the farthest point of the chain whose
    // straight line stays on open ground no worse than the chain's own cost
    function lineOk(a, b) {
      const L = d2(a.x, a.z, b.x, b.z), n = Math.max(1, Math.ceil(L / (cell * 0.5)));
      let worst = 0;
      for (let q = 1; q < n; q++) {
        const x = a.x + (b.x - a.x) * q / n, z = a.z + (b.z - a.z) * q / n;
        const i = clamp(Math.floor((x - x0) / cell), 0, w - 1), j = clamp(Math.floor((z - z0) / cell), 0, h - 1);
        const m = C(i, j);
        if (m <= 0) return -1;
        if (m > worst) worst = m;
      }
      return worst;
    }
    const pts = [raw[0]];
    let at = 0;
    while (at < raw.length - 1) {
      let best = at + 1;
      // the chain's own worst cell from here on (the line must be no steeper)
      let chainWorst = 0;
      for (let j = at + 1; j < raw.length; j++) {
        const k = chain[j], m = mul[k] > 0 ? mul[k] : 1;
        if (m > chainWorst) chainWorst = m;
        const lw = lineOk(raw[at], raw[j]);
        if (lw < 0) break;
        if (lw <= chainWorst * 1.25 + 0.3) best = j;
        if (j - at > 400) break;
      }
      pts.push(raw[best]);
      at = best;
    }
    const radii = pts.map(function (p, i) { return i === 0 || i === pts.length - 1 ? 0 : (opts.radius || 16); });
    return { pts: pts, radii: radii, ok: true, kind: "terrain" };
  }

  /* WHERE A VEHICLE MAY DRIVE TO, for a point somebody wants it at (a man, a
     building, a mark on the map). A vehicle never takes a building interior
     or a point it cannot reach off the road as its goal: it drives to the
     kerb by the way in, parks, and the people go on through the door on foot.
       1. world.entryAt(x, z) -> { x, z } | null: the point is inside a
          building or a walled compound, so the goal is its way in (the step
          outside the door, the compound's gate).
       2. snapped to the road network: the kerb lane beside the road point
          nearest that goal, on the goal's side.
       3. a goal off the road (a yard, open ground) is kept only when it is
          not itself inside something and the straight drive from the kerb
          to it is clear (world.blockedAt over the hull's radius).
     Returns { x, z, road, entry }: road = the goal is the kerb. */
  function blockedLine(world, ax, az, bx, bz, r) {
    if (!world.blockedAt) return false;
    const n = Math.max(1, Math.ceil(d2(ax, az, bx, bz) / 2));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (world.blockedAt(ax + (bx - ax) * t, az + (bz - az) * t, r)) return true;
    }
    return false;
  }
  function driveTarget(world, x, z, opts) {
    const r = opts && opts.r != null ? opts.r : 1.6;
    let gx = x, gz = z, entry = false;
    if (world && world.entryAt) {
      let e = null;
      try { e = world.entryAt(x, z); } catch (err) { e = null; }
      if (e && isFinite(e.x) && isFinite(e.z)) { gx = e.x; gz = e.z; entry = true; }
    }
    const G = world && world.roads ? of(world.roads) : null;
    const S = G ? snap(G, gx, gz) : null;
    if (!S) return { x: gx, z: gz, road: false, entry: entry };
    if (S.d <= 3) return { x: S.x, z: S.z, road: true, entry: entry };
    const sg = G.segs[S.si], nx = -sg.uz, nz = sg.ux;
    const side = (gx - S.x) * nx + (gz - S.z) * nz >= 0 ? 1 : -1;
    const k = Math.max(0, sg.hw - Math.max(1.6, r + 0.4));
    const kx = S.x + nx * side * k, kz = S.z + nz * side * k;
    if (!entry && !(world.blockedAt && world.blockedAt(gx, gz, r)) && !blockedLine(world, kx, kz, gx, gz, r)) {
      return { x: gx, z: gz, road: false, entry: false };
    }
    return { x: kx, z: kz, road: true, entry: entry };
  }

  /* ROAD WHERE THERE IS ROAD, GROUND WHERE THERE IS NOT. */
  function plan(world, from, to, opts) {
    opts = opts || {};
    const G = world.roads ? of(world.roads) : null;
    const offRoad = opts.offRoad != null ? opts.offRoad : 140;
    if (G) to = driveTarget(world, to.x, to.z, { r: opts.r });
    if (G) {
      const A = snap(G, from.x, from.z), B = snap(G, to.x, to.z);
      if (A && B && A.d <= offRoad && B.d <= offRoad) {
        let R = null;
        try { R = route(G, from, to, { avoid: opts.avoidSeg }); } catch (e) { R = null; }
        if (R && R.ok) {
          const L = lanes(G, R, { lane: opts.lane });
          let pts = L.pts, radii = L.radii;
          // the drive on and off the road (a yard, a compound, open ground)
          if (A.d > 3) { pts = [{ x: from.x, z: from.z }].concat(pts); radii = [0].concat(radii); radii[1] = Math.max(radii[1], 8); }
          if (B.d > 3) { pts = pts.concat([{ x: to.x, z: to.z }]); radii = radii.concat([0]); radii[radii.length - 2] = Math.max(radii[radii.length - 2], 8); }
          const segs = new Set();
          for (let i = 0; i < R.legs.length; i++) if (R.legs[i] >= 0) segs.add(R.legs[i]);
          return { pts: pts, radii: radii, junctions: R.junctions, kind: "road", ok: true, segs: segs, G: G, ver: G.ver };
        }
      }
    }
    if (world.groundAt || world.waterAt || world.blockedAt) {
      const T = terrain(from, to, world, opts);
      return { pts: T.pts, radii: T.radii, junctions: [], kind: "terrain", ok: T.ok, segs: null, G: null, ver: 0 };
    }
    return { pts: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], radii: [0, 0], junctions: [], kind: "direct", ok: true, segs: null, G: null, ver: 0 };
  }

  CBZ.roadGraph = {
    build: build, of: of, snap: snap, route: route, lanes: lanes,
    close: function (G, x, z, r) { return close(G, x, z, r, false); },
    reopen: function (G, x, z, r) { return close(G, x, z, r, true); },
    path: path, pathAt: pathAt, capAt: capAt, projectS: projectS, pathSlice: pathSlice, segIdx: segIdx,
    terrain: terrain, plan: plan, segCost: segCost, driveTarget: driveTarget,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.roadGraph;
})();
