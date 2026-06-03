/* ============================================================
   systems/navigation.js - shared route planning for every mode.

   The full map and corner radars consume the same route object. Prison
   routes use a coarse collision grid plus vents, city routes use the real
   street graph, and survival routes stay inside the island shoreline.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const point = (x, z) => ({ x, z });

  function copyPoint(p) { return point(p.x, p.z); }

  function clean(points) {
    const out = [];
    for (const p of points) {
      if (!p) continue;
      const prev = out[out.length - 1];
      if (prev && distance(prev, p) < 0.12) {
        if (p.teleportToNext) {
          prev.teleportToNext = true;
          prev.portalLabel = p.portalLabel;
        }
        continue;
      }
      out.push(p);
    }
    return out;
  }

  function edgeLength(a, b) { return a.teleportToNext ? 4 : distance(a, b); }

  function finish(mode, points, goal, kind) {
    points = clean(points);
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += edgeLength(points[i], points[i + 1]);
    return { mode, points, goal: copyPoint(goal), distance: total, kind, plannedAt: now() };
  }

  function direct(mode, from, to, kind) {
    return finish(mode, [copyPoint(from), copyPoint(to)], to, kind || "direct");
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(id, score) {
      const a = this.a; let i = a.length;
      a.push({ id, score });
      while (i) {
        const p = (i - 1) >> 1;
        if (a[p].score <= score) break;
        a[i] = a[p]; i = p;
      }
      a[i] = { id, score };
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const root = a[0], tail = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          const l = i * 2 + 1, r = l + 1;
          if (l >= a.length) break;
          const c = r < a.length && a[r].score < a[l].score ? r : l;
          if (a[c].score >= tail.score) break;
          a[i] = a[c]; i = c;
        }
        a[i] = tail;
      }
      return root;
    }
  }

  // ---- prison: coarse walkability A* with grate/hatch portal edges ----
  function escapeRoute(from, to) {
    const B = CBZ.WORLD;
    if (!B) return direct("escape", from, to);
    const STEP = 2.15, PAD = 0.72;
    const minX = B.minX, minZ = B.minZ;
    const nx = Math.max(1, Math.ceil((B.maxX - minX) / STEP));
    const nz = Math.max(1, Math.ceil((B.maxZ - minZ) / STEP));
    const count = nx * nz, blocked = new Uint8Array(count);
    const idx = (x, z) => z * nx + x;
    const gx = (x) => Math.max(0, Math.min(nx - 1, Math.floor((x - minX) / STEP)));
    const gz = (z) => Math.max(0, Math.min(nz - 1, Math.floor((z - minZ) / STEP)));
    const world = (id) => point(minX + (id % nx + 0.5) * STEP, minZ + (((id / nx) | 0) + 0.5) * STEP);

    for (const c of CBZ.colliders || []) {
      if (c.maxX < B.minX || c.minX > B.maxX || c.maxZ < B.minZ || c.minZ > B.maxZ) continue;
      if (c.y0 != null && (c.y0 >= 1.7 || c.y1 <= 0)) continue;
      const x0 = gx(c.minX - PAD), x1 = gx(c.maxX + PAD);
      const z0 = gz(c.minZ - PAD), z1 = gz(c.maxZ + PAD);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) blocked[idx(x, z)] = 1;
    }

    function nearestFree(x, z) {
      const sx = gx(x), sz = gz(z);
      for (let radius = 0; radius <= 8; radius++) {
        for (let ox = -radius; ox <= radius; ox++) for (let oz = -radius; oz <= radius; oz++) {
          if (radius && Math.abs(ox) !== radius && Math.abs(oz) !== radius) continue;
          const xx = sx + ox, zz = sz + oz;
          if (xx >= 0 && xx < nx && zz >= 0 && zz < nz && !blocked[idx(xx, zz)]) return idx(xx, zz);
        }
      }
      return idx(sx, sz);
    }

    const start = nearestFree(from.x, from.z), goal = nearestFree(to.x, to.z);
    blocked[start] = blocked[goal] = 0;
    const portals = new Map();
    for (const v of CBZ.vents || []) {
      if (!v.dest) continue;
      const a = nearestFree(v.x, v.z), b = nearestFree(v.dest.x, v.dest.z);
      let list = portals.get(a);
      if (!list) portals.set(a, list = []);
      list.push({ id: b, cost: 4, portal: v.name || "maintenance route" });
    }

    const open = new MinHeap(), cost = new Float64Array(count), parent = new Int32Array(count);
    const edgePortal = new Array(count);
    cost.fill(Infinity); parent.fill(-1); cost[start] = 0;
    open.push(start, 0);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    function estimate(id) {
      const x = id % nx, z = (id / nx) | 0, tx = goal % nx, tz = (goal / nx) | 0;
      return Math.hypot(tx - x, tz - z) * STEP;
    }
    function relax(a, b, stepCost, portalName) {
      const next = cost[a] + stepCost;
      if (next >= cost[b]) return;
      cost[b] = next; parent[b] = a; edgePortal[b] = portalName || null;
      open.push(b, next + estimate(b));
    }
    while (open.a.length) {
      const cur = open.pop().id;
      if (cur === goal) break;
      const x = cur % nx, z = (cur / nx) | 0;
      for (const d of dirs) {
        const xx = x + d[0], zz = z + d[1];
        if (xx < 0 || xx >= nx || zz < 0 || zz >= nz) continue;
        const ni = idx(xx, zz);
        if (blocked[ni]) continue;
        if (d[0] && d[1] && (blocked[idx(x + d[0], z)] || blocked[idx(x, z + d[1])])) continue;
        relax(cur, ni, d[2] * STEP);
      }
      const exits = portals.get(cur);
      if (exits) for (const e of exits) relax(cur, e.id, e.cost, e.portal);
    }
    if (parent[goal] < 0 && goal !== start) return direct("escape", from, to, "fallback");
    const ids = []; let at = goal;
    while (at >= 0) { ids.push(at); if (at === start) break; at = parent[at]; }
    ids.reverse();
    const points = [copyPoint(from)];
    for (let i = 0; i < ids.length; i++) {
      const p = world(ids[i]);
      if (i < ids.length - 1 && edgePortal[ids[i + 1]]) {
        p.teleportToNext = true;
        p.portalLabel = edgePortal[ids[i + 1]];
      }
      points.push(p);
    }
    points.push(copyPoint(to));
    return finish("escape", points, to, "grid");
  }

  // ---- city: route along actual road centerlines, including bridge/island ----
  let cityGraphCache = null;
  function cityGraph() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.roads || !A.roads.length) return null;
    if (cityGraphCache && cityGraphCache.arena === A && cityGraphCache.roadCount === A.roads.length && cityGraphCache.intersectionCount === A.intersections.length) return cityGraphCache;
    const nodes = [], byKey = new Map(), edges = [];
    function addNode(x, z) {
      const key = Math.round(x * 10) + ":" + Math.round(z * 10);
      let id = byKey.get(key);
      if (id != null) return id;
      id = nodes.length; byKey.set(key, id); nodes.push(point(x, z)); edges.push([]);
      return id;
    }
    function link(a, b) {
      if (a === b) return;
      const w = distance(nodes[a], nodes[b]);
      edges[a].push({ id: b, cost: w }); edges[b].push({ id: a, cost: w });
    }
    for (const r of A.roads) {
      if (r.vertical) { addNode(r.x, r.z - r.len / 2); addNode(r.x, r.z + r.len / 2); }
      else { addNode(r.x - r.len / 2, r.z); addNode(r.x + r.len / 2, r.z); }
    }
    for (const it of A.intersections || []) addNode(it.x, it.z);
    for (const r of A.roads) {
      const along = [];
      for (let id = 0; id < nodes.length; id++) {
        const p = nodes[id];
        if (r.vertical) {
          if (Math.abs(p.x - r.x) < 0.25 && Math.abs(p.z - r.z) <= r.len / 2 + 0.25) along.push(id);
        } else if (Math.abs(p.z - r.z) < 0.25 && Math.abs(p.x - r.x) <= r.len / 2 + 0.25) along.push(id);
      }
      along.sort((a, b) => r.vertical ? nodes[a].z - nodes[b].z : nodes[a].x - nodes[b].x);
      for (let i = 1; i < along.length; i++) link(along[i - 1], along[i]);
    }
    cityGraphCache = { arena: A, roadCount: A.roads.length, intersectionCount: A.intersections.length, nodes, edges, roads: A.roads };
    return cityGraphCache;
  }

  function projectRoad(graph, p) {
    let best = copyPoint(p), bd = Infinity;
    for (const r of graph.roads) {
      let x = p.x, z = p.z;
      if (r.vertical) { x = r.x; z = Math.max(r.z - r.len / 2, Math.min(r.z + r.len / 2, z)); }
      else { z = r.z; x = Math.max(r.x - r.len / 2, Math.min(r.x + r.len / 2, x)); }
      const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
      if (d < bd) { bd = d; best = point(x, z); }
    }
    return best;
  }

  function nearestNode(graph, p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < graph.nodes.length; i++) {
      const q = graph.nodes[i], d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function cityRoute(from, to) {
    const graph = cityGraph();
    if (!graph) return direct("city", from, to);
    const a = projectRoad(graph, from), b = projectRoad(graph, to);
    const start = nearestNode(graph, a), goal = nearestNode(graph, b);
    const heap = new MinHeap(), cost = new Float64Array(graph.nodes.length), parent = new Int32Array(graph.nodes.length);
    cost.fill(Infinity); parent.fill(-1); cost[start] = 0; heap.push(start, 0);
    while (heap.a.length) {
      const cur = heap.pop().id;
      if (cur === goal) break;
      for (const e of graph.edges[cur]) {
        const next = cost[cur] + e.cost;
        if (next >= cost[e.id]) continue;
        cost[e.id] = next; parent[e.id] = cur;
        heap.push(e.id, next + distance(graph.nodes[e.id], graph.nodes[goal]));
      }
    }
    if (parent[goal] < 0 && goal !== start) return direct("city", from, to, "fallback");
    const ids = []; let at = goal;
    while (at >= 0) { ids.push(at); if (at === start) break; at = parent[at]; }
    ids.reverse();
    return finish("city", [copyPoint(from), a].concat(ids.map((id) => copyPoint(graph.nodes[id])), [b, copyPoint(to)]), to, "streets");
  }

  // ---- survival: the terrain is traversable, but the ocean is not ----
  function survivalRoute(from, to) {
    const A = CBZ.surv && CBZ.surv.arena;
    const S = A || (CBZ.SURV && CBZ.SURV.arena);
    if (!S) return direct("survival", from, to);
    const c = A ? A.center : { x: S.cx, z: S.cz }, r = Math.max(4, (A ? A.radius : S.radius) - 3);
    const dx = to.x - c.x, dz = to.z - c.z, d = Math.hypot(dx, dz);
    const goal = d > r ? point(c.x + dx / d * r, c.z + dz / d * r) : copyPoint(to);
    return finish("survival", [copyPoint(from), goal], goal, "terrain");
  }

  function progress(route, pos) {
    if (!route || !route.points || route.points.length < 2) return null;
    const pts = route.points;
    let best = Infinity, segment = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      let d;
      if (a.teleportToNext) d = Math.min(distance(pos, a), distance(pos, b));
      else {
        const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
        const t = len2 ? Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / len2)) : 0;
        d = Math.hypot(pos.x - (a.x + dx * t), pos.z - (a.z + dz * t));
      }
      if (d < best) { best = d; segment = i; }
    }
    let index = segment + 1;
    while (index < pts.length - 1 && !pts[index].teleportToNext && distance(pos, pts[index]) < 4.2) index++;
    const target = pts[index];
    let remaining = distance(pos, target);
    for (let i = index; i < pts.length - 1; i++) remaining += edgeLength(pts[i], pts[i + 1]);
    const usePortal = !!target.teleportToNext;
    return {
      target, index, remaining, offRoute: best,
      instruction: usePortal ? "Use " + (target.portalLabel || "maintenance route") : (index === pts.length - 1 ? "Arrive" : "Next turn"),
    };
  }

  CBZ.navigation = {
    plan(which, from, to) {
      if (!from || !to) return null;
      if (which === "city") return cityRoute(from, to);
      if (which === "survival") return survivalRoute(from, to);
      return escapeRoute(from, to);
    },
    next(route, pos) { return progress(route, pos); },
    remaining(route, pos) { const p = progress(route, pos); return p ? p.remaining : 0; },
    offRoute(route, pos) { const p = progress(route, pos); return p ? p.offRoute : Infinity; },
  };
})();
