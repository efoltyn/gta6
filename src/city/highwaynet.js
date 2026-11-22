/* ============================================================
   city/highwaynet.js — THE HIGHWAY NETWORK, BUILT FROM THE WORLD PLAN.

   The routes are the plan's (src/world/worldplan.js `routes`): each goes
   from somewhere to somewhere and says why there. This file turns that data
   into roads: the deck and its paint, the drivable city.roads records, the
   map regions and the terrain-relief corridor ALL derive from the same route
   record, so they can never desync.

   It used to hold the table itself, as one grand rectangular loop round the
   desert plus spurs, with seven "free-country lane" literals that had to be
   re-measured every time the layout dial slid the land out from under them.
   A ring round a rectangle goes nowhere; that table is gone.

   RULES A ROUTE OBEYS:
     • every leg that carries traffic is axis-aligned (traffic/vehicles/
       props assume vertical or horizontal centrelines); the corners sweep
       on wide radii and long open legs get S-bends (THE SHAPE OF THE ROAD
       below), and cars drive those curves on the deck's own centreline
       (CBZ.highwayBendFor);
     • a deck stops FLUSH at the edge of the deck or street it meets (the
       plan's trimA / trimB) while its drivable RECORD runs on to that
       road's centreline, so vehicles.js findRoad can hop the junction;
     • pure data + closed-form math, no rng anywhere.

   INTEGRATION: one city.roads record per leg (district "highway", real
   lane data: traffic seeds/drives them, the map draws them gold), one
   "<Route> Link" region per leg (fullmap casing/waterfield deck semantics;
   the Link name keeps the shore field's land-holding blind to them, so a
   route that crosses water is a deck over it), and CBZ.highwayNetReliefGate:
   the continent's relief flattens under every corridor, which is what makes
   a pass a pass.

   DRAW BUDGET: highways.js merges each route per ~400 m chunk (deck, paint,
   furniture); far chunks drop paint/furniture. The R5/R1 interchange
   (city/interchange.js) is planned here and built in the late pass.

   EXTEND IT: add a route to the plan.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (!CBZ.CONFIG) CBZ.CONFIG = {};

  // THE CROSS-SECTION (highways.js builds it; these are the numbers the table
  // docks by). 3+3 lanes of 3.6 m either side of a 3.0 m median (a 0.6 m
  // F-shape barrier between two 1.2 m inner shoulders), 3.0 m outer
  // shoulders: travelled half 12.3, deck half 15.3. Traffic reads the lane
  // centres off the records (medianW 3.0), so the paint and the cars agree.
  const MEDIAN_W = 3.0, LANE_W = 3.6, LANES = 3, SHOULDER = 3.0;
  const HALF = MEDIAN_W / 2 + LANES * LANE_W + SHOULDER;   // 15.3: a network deck's half-width
  const WIDTH = HALF * 2;
  // Island causeways keep their own 24 m records (1.2 m median); highways.js
  // adds the same 3 m shoulder outside them, so their deck half is 14.4.
  const CW_HALF = 1.2 / 2 + 3 * 3.6 + SHOULDER;

  // ---- corridors for the continent relief gate (published before the
  //      continent builds at order 97; empty until the builder runs) --------
  let _corridors = [];                   // {x0,z0,x1,z1,half} per FILLETED segment
  let _netBox = null;                    // fast whole-network reject
  let _routes = null;                    // the built table (debug/audit)
  CBZ.cityHighwayNet = function () { return _routes; };
  // the filleted corridor segments themselves ({x0,z0,x1,z1,half}), read-only:
  // continent.js rasterises them into its road-clearance field so the land
  // lies low along a highway instead of being cut away in a 40 m trench
  CBZ.highwayNetCorridors = function () { return _corridors; };

  function sm01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }

  // 1 = full country relief, 0 = flattened road bed. Same grammar as the
  // frontier loop's cut (continent.js): flat within half+8 of a corridor
  // centreline, fading back to full relief over the next 40m. Allocation-
  // free and cheap (AABB pre-rejects) — continent plate verts AND runtime
  // ground physics both call this.
  /* THE GATE ASKS ONLY THE CORRIDORS NEAR IT. Every continent plate vertex
     and every ground query calls this, and it walked every filleted segment
     of the network per call: the single hottest function of the continent
     build (364 ms self of its 2.2 s unthrottled, phone profile x4). A 256 m
     grid of which segments' reach (AABB + half + 48) touches each cell gives
     the same segments in the same order for any point, so the answer is the
     same number; built once per corridor set. */
  const GG_CELL = 256;
  let _gg = null, _ggFor = null, _ggN = -1;
  function gateGrid() {
    if (_gg && _ggFor === _corridors && _ggN === _corridors.length) return _gg;
    const B = _netBox, n = _corridors.length;
    const nx = Math.max(1, Math.ceil((B.maxX - B.minX) / GG_CELL) + 1), nz = Math.max(1, Math.ceil((B.maxZ - B.minZ) / GG_CELL) + 1);
    const cells = new Array(nx * nz);
    for (let i = 0; i < n; i++) {
      const c = _corridors[i], outer = c.half + 48;
      const i0 = Math.max(0, Math.floor((c.minX - outer - B.minX) / GG_CELL)), i1 = Math.min(nx - 1, Math.floor((c.maxX + outer - B.minX) / GG_CELL));
      const j0 = Math.max(0, Math.floor((c.minZ - outer - B.minZ) / GG_CELL)), j1 = Math.min(nz - 1, Math.floor((c.maxZ + outer - B.minZ) / GG_CELL));
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * nx + k; (cells[q] || (cells[q] = [])).push(c); }
    }
    _gg = { nx: nx, nz: nz, cells: cells, B: B }; _ggFor = _corridors; _ggN = n;
    return _gg;
  }
  CBZ.highwayNetReliefGate = function (x, z) {
    const n0 = _corridors.length;
    if (!n0) return 1;
    const B = _netBox;
    if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return 1;
    const G = gateGrid();
    const list = G.cells[Math.min(G.nz - 1, Math.floor((z - B.minZ) / GG_CELL)) * G.nx + Math.min(G.nx - 1, Math.floor((x - B.minX) / GG_CELL))];
    if (!list) return 1;
    const n = list.length;
    let g = 1;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const inner = c.half + 8, outer = inner + 40;
      if (x < c.minX - outer || x > c.maxX + outer || z < c.minZ - outer || z > c.maxZ + outer) continue;
      // exact point-to-segment distance
      const dx = c.x1 - c.x0, dz = c.z1 - c.z0;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 1e-9 ? ((x - c.x0) * dx + (z - c.z0) * dz) / L2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const px = c.x0 + dx * t - x, pz = c.z0 + dz * t - z;
      const d = Math.hypot(px, pz);
      if (d <= inner) return 0;
      if (d < outer) { const s = sm01((d - inner) / 40); if (s < g) g = s; }
    }
    return g;
  };

  // ============================================================
  //  THE ROUTE TABLE, from the plan. A plan route is centreline points
  //  junction to junction plus how far the deck stops short of each end
  //  (trimA / trimB); here that becomes the deck's own end points and the
  //  record's (recA / recB), which is the shape the builder below takes.
  // ============================================================
  const RURAL_W = 11;                          // 3.6 + 3.6 lanes + 1.9 m shoulders
  function routeTable() {
    const plan = CBZ.worldPlan;
    const src = (plan && plan.routes) || [];
    const out = [];
    for (const r of src) {
      const pts = r.pts.map(function (q) { return { x: q[0], z: q[1] }; });
      if (pts.length < 2) continue;
      const rural = r.kind === "road";
      const rec = { id: r.id, name: r.name, width: rural ? RURAL_W : WIDTH, lanesPerDir: rural ? 1 : 3,
        fillet: rural ? 40 : 60, sweep: !!r.sweep, pts: pts, docks: [] };
      if (rural) { rec.median = false; rec.rural = true; }
      const n = pts.length;
      const vA = Math.abs(pts[1].x - pts[0].x) < 0.5, vB = Math.abs(pts[n - 1].x - pts[n - 2].x) < 0.5;
      if (r.trimA) {
        rec.recA = vA ? pts[0].z : pts[0].x;
        const d = unitTo(pts[0], pts[1]);
        pts[0] = { x: pts[0].x + d.x * r.trimA, z: pts[0].z + d.z * r.trimA };
      }
      if (r.trimB) {
        rec.recB = vB ? pts[n - 1].z : pts[n - 1].x;
        const d = unitTo(pts[n - 1], pts[n - 2]);
        pts[n - 1] = { x: pts[n - 1].x + d.x * r.trimB, z: pts[n - 1].z + d.z * r.trimB };
      }
      out.push(rec);
    }
    return out;
  }
  function unitTo(a, b) { const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / L, z: (b.z - a.z) / L }; }

  // ============================================================
  //  THE SHAPE OF THE ROAD (owner: "highways that are rectangular loops
  //  with right-angle corners running hard against the cities"). The table
  //  above says WHERE a route runs; this says how it runs there:
  //    • its corners SWEEP: each a 750 m radius unless a junction on either
  //      leg needs the road straight sooner (a T must meet a straight deck);
  //    • its long legs across open country carry gentle S-BENDS: the road
  //      drifts 230 m to one side over 1.15 km on a 3.2 km radius, runs on,
  //      and drifts back. Never within 1.5 km of a corner, 700 m of a
  //      junction, or near a metro, a biome or a town it would cut into —
  //      all read from the layout's own records (footprints, the metro
  //      site table, the other routes), never from coordinates of its own.
  //  Every leg between the bends is still axis-aligned and carries the
  //  drivable record; a car crosses a bend on the bend's own curve
  //  (CBZ.highwayBendFor below, driven by vehicles.js), never across grass.
  // ============================================================
  const SWEEP_R = 750;
  const S_R = 3200, S_AMP = 230, S_RAMP = 1150, S_HOLD_MIN = 700, S_HOLD_MAX = 2600;
  const S_END = 1100, S_JUNC = 700, S_MIN_LEG = 4200, S_CLEAR = 260;
  function isAxis(a, b) { return Math.abs(a.x - b.x) < 0.5 || Math.abs(a.z - b.z) < 0.5; }
  function legLen(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }
  // the tangent length the smooth path will give the corner at pts[i]
  // (highways.js highwaySmoothPath's own clamp, repeated: one answer)
  function cornerT(pts, i, radius) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    let ax = p1.x - p0.x, az = p1.z - p0.z, bx = p2.x - p1.x, bz = p2.z - p1.z;
    const la = Math.hypot(ax, az) || 1e-6, lb = Math.hypot(bx, bz) || 1e-6;
    const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
    const turn = Math.acos(dot);
    if (turn < 0.02) return 0;
    return Math.min((p1.r || radius) * Math.tan(turn / 2), la * 0.45, lb * 0.45);
  }
  // where every route meets another: its two ends
  function junctions(routes) {
    const J = [];
    for (const r of routes) { const p = r.pts; if (p.length) { J.push(p[0]); J.push(p[p.length - 1]); } }
    return J;
  }
  // distance along the axis leg a->b to q, or null when q is not on it
  function alongLeg(q, a, b, tol) {
    const vert = Math.abs(a.x - b.x) < 0.5;
    const lat = vert ? Math.abs(q.x - a.x) : Math.abs(q.z - a.z);
    const s = vert ? (q.z - a.z) * Math.sign(b.z - a.z) : (q.x - a.x) * Math.sign(b.x - a.x);
    return lat < tol && s > -tol && s < legLen(a, b) + tol ? s : null;
  }
  // what a bend must keep clear of: the biomes, the metros, the towns the
  // country roads serve, the desert spine
  function keepOuts(routes) {
    const K = [];
    const F = CBZ.WORLD_FOOTPRINTS || {};
    for (const id in F) { const f = F[id]; K.push({ minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ }); }
    const sites = CBZ.metroLib && CBZ.metroLib.siteTable ? CBZ.metroLib.siteTable({}) : [];
    for (const s of sites) if (s.bounds) K.push({ minX: s.bounds.minX - 150, maxX: s.bounds.maxX + 150, minZ: s.bounds.minZ - 150, maxZ: s.bounds.maxZ + 150 });
    for (const r of routes) if (r.rural) for (const p of r.pts) K.push({ minX: p.x - 250, maxX: p.x + 250, minZ: p.z - 250, maxZ: p.z + 250 });
    return K;
  }
  // a drift may not wander into the sea: the whole strip it needs is land,
  // by the plan's own coast
  function onLand(R) {
    const P = CBZ.worldPlan; if (!P || !P.landAt) return true;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) {
      const x = R.minX + (R.maxX - R.minX) * (R.maxX - R.minX > R.maxZ - R.minZ ? i / 6 : j / 2);
      const z = R.minZ + (R.maxZ - R.minZ) * (R.maxX - R.minX > R.maxZ - R.minZ ? j / 2 : i / 6);
      if (P.landAt(x, z) < 90) return false;
    }
    return true;
  }
  function meander(route, J, K) {
    const out = [route.pts[0]];
    let nS = 0;
    for (let i = 0; i + 1 < route.pts.length; i++) {
      const a = route.pts[i], b = route.pts[i + 1], L = legLen(a, b);
      if (isAxis(a, b) && L >= S_MIN_LEG) {
        const vert = Math.abs(a.x - b.x) < 0.5, ux = vert ? 0 : Math.sign(b.x - a.x), uz = vert ? Math.sign(b.z - a.z) : 0;
        // forbidden stretches: the ends, and every junction on the leg
        const bad = [[-1e9, S_END], [L - S_END, 1e9]];
        for (const q of J) { const s = alongLeg(q, a, b, HALF + 30); if (s != null) bad.push([s - S_JUNC, s + S_JUNC]); }
        bad.sort(function (p, q) { return p[0] - q[0]; });
        const free = []; let s0 = 0;
        for (const f of bad) { if (f[0] > s0) free.push([s0, Math.min(f[0], L)]); s0 = Math.max(s0, f[1]); }
        for (const sp of free) {
          const len = sp[1] - sp[0];
          if (len < 2 * S_RAMP + S_HOLD_MIN) continue;
          const hold = Math.min(S_HOLD_MAX, len - 2 * S_RAMP), st = sp[0] + (len - 2 * S_RAMP - hold) / 2;
          const P = function (s, lat) { return { x: a.x + ux * s + (vert ? lat : 0), z: a.z + uz * s + (vert ? 0 : lat) }; };
          const pref = ((i + nS) % 2) ? 1 : -1;
          let side = 0;
          for (const sg of [pref, -pref]) {
            // the room the drift needs: clear ground on the side it drifts to
            // (the road already runs where it runs on the other)
            const p0 = P(st - S_CLEAR, -sg * (HALF + 20)), p1 = P(st + 2 * S_RAMP + hold + S_CLEAR, sg * (S_AMP + HALF + S_CLEAR));
            const R = { minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x), minZ: Math.min(p0.z, p1.z), maxZ: Math.max(p0.z, p1.z) };
            if (!K.some(function (k) { return rectsOverlap(R, k.minX, k.maxX, k.minZ, k.maxZ); }) && onLand(R)) { side = sg; break; }
          }
          if (!side) continue;
          const q0 = P(st, 0), q1 = P(st + S_RAMP, side * S_AMP), q2 = P(st + S_RAMP + hold, side * S_AMP), q3 = P(st + 2 * S_RAMP + hold, 0);
          q0.r = q1.r = q2.r = q3.r = S_R;
          out.push(q0, q1, q2, q3);
          nS++;
        }
      }
      out.push(b);
    }
    route.pts = out;
    route.bends = nS;
  }
  // the corners: as wide as the junctions on their two legs allow
  function sweep(route, J) {
    const pts = route.pts;
    for (let i = 1; i + 1 < pts.length; i++) {
      const v = pts[i], p = pts[i - 1], n = pts[i + 1];
      if (v.r || !isAxis(p, v) || !isAxis(v, n)) continue;
      let room = Math.min(legLen(p, v), legLen(v, n)) * 0.45;
      for (const q of J) {
        if (Math.hypot(q.x - v.x, q.z - v.z) < HALF + 30) continue;           // the corner's own dock
        const s1 = alongLeg(q, v, p, HALF + 30), s2 = alongLeg(q, v, n, HALF + 30);
        if (s1 != null) room = Math.min(room, s1 - HALF - 150);
        if (s2 != null) room = Math.min(room, s2 - HALF - 150);
      }
      v.r = Math.max(route.fillet || 60, Math.min(SWEEP_R, room));            // a 90 degree corner: t == r
    }
    let tMax = route.fillet || 60;
    for (let i = 1; i + 1 < pts.length; i++) tMax = Math.max(tMax, cornerT(pts, i, route.fillet || 60));
    route.fillet = Math.round(tMax);
  }
  function shapeRoutes(routes) {
    const J = junctions(routes), K = keepOuts(routes);
    for (const r of routes) {
      if (!r.sweep) continue;
      meander(r, J, K);
      sweep(r, J);
    }
    return routes;
  }

  // The table is pure data off the plan, so a builder that runs BEFORE the
  // network (a mini-city at order 34, a metro at 43) can ask where the lanes
  // will be and dock onto one instead of plugging into empty country.
  CBZ.highwayNetTable = function () { return shapeRoutes(routeTable()); };
  CBZ.HIGHWAY_NET_HALF = HALF;

  // ============================================================
  //  BUILD-TIME CLEARANCE SWEEP (deterministic).
  //
  //  IT NOW ENFORCES. For its whole life this function detected routes
  //  crossing registered footprints and only console.warn'd — and it was
  //  RIGHT: "R1 leg 3 overlaps region 'Defence Headquarters Approach 1'"
  //  has been true and ignored. CLAUDE.md names that failure mode exactly
  //  ("an audit nobody has executed is not a measurement"), and a warning
  //  that has been true for months and changed nothing is worse than no
  //  check, because it teaches the next reader to scroll past it.
  //
  //  Two things changed:
  //    • the REGION test is no longer this file's private rect math. It
  //      calls CBZ.roadClearance (city/roadrules.js), the ONE definition of
  //      "may a road be here" that props, mini-cities, buildHighway and the
  //      post-build law all share. That instantly retires the false alarm
  //      above: an "Approach" corridor is a road, not a place, and the
  //      shared law knows it — this file's private isLinkName never did.
  //    • a leg that genuinely crosses a place has its drivable RECORD
  //      clamped to the boundary (CBZ.roadClamp), so no car, no spawn and
  //      no streetlight can enter even if the table is never retuned.
  //  Degrade-safe: with roadrules.js absent, every branch falls back to the
  //  original warn-only rect test, byte for byte.
  //
  //  Water bodies, the annex disc, the east bridge, the harbor-bay band and
  //  the dock drift alarm stay as warnings — those are table-authoring
  //  mistakes with no safe automatic repair.
  // ============================================================
  function isLinkName(n) { return /bridge|causeway|link/i.test(n || ""); }
  function legRects(route) {
    const out = [], pts = route.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const h = route.width / 2;
      out.push({
        minX: Math.min(a.x, b.x) - h, maxX: Math.max(a.x, b.x) + h,
        minZ: Math.min(a.z, b.z) - h, maxZ: Math.max(a.z, b.z) + h,
        a: a, b: b, i: i,
      });
    }
    return out;
  }
  function rectsOverlap(r, minX, maxX, minZ, maxZ) {
    return r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ;
  }
  function rectCircleOverlap(r, cx, cz, rad) {
    const dx = Math.max(r.minX - cx, 0, cx - r.maxX);
    const dz = Math.max(r.minZ - cz, 0, cz - r.maxZ);
    return dx * dx + dz * dz < rad * rad;
  }
  function clearanceSweep(city, routes) {
    const regs = city.regions || [], waters = city.waterBodies || [];
    const warn = function (msg) { console.warn("[highwaynet] " + msg); };
    let blocked = 0;
    for (const route of routes) {
      const dest = route.pts[route.pts.length - 1];
      for (const leg of legRects(route)) {
        const tag = route.id + " leg " + leg.i;
        // THE SHARED LAW (roadrules.js) — one line, and it replaces the whole
        // private rect sweep below it. `dest` is the ROUTE's final point, so a
        // leg that clips the place the route is going to is legal and one that
        // cuts an unrelated town is not.
        if (CBZ.roadClearance) {
          const res = CBZ.roadClearance(leg.a.x, leg.a.z, leg.b.x, leg.b.z, {
            w: route.width, owner: route.id, dest: dest, city: city,
          });
          if (!res.ok) {
            blocked++;
            warn(tag + " crosses '" + res.blockedBy + "' by " + Math.round(res.depth) +
              " m, the drivable record is CLAMPED to the boundary; retune the table so the DECK stops there too");
            leg.blockedBy = res.blockedBy;
          }
        } else for (const rg of regs) {
          if (isLinkName(rg.name)) continue;                  // causeway decks are dock targets
          const pad = (rg.pad || 0);
          const hit = rg.kind === "circle"
            ? rectCircleOverlap(leg, rg.cx, rg.cz, rg.r + pad)
            : rectsOverlap(leg, rg.minX - pad, rg.maxX + pad, rg.minZ - pad, rg.maxZ + pad);
          if (hit) warn(tag + " overlaps region '" + rg.name + "', retune the table");
        }
        for (const wb of waters) {
          const hit = wb.kind === "circle"
            ? rectCircleOverlap(leg, wb.cx, wb.cz, wb.r)
            : rectsOverlap(leg, wb.minX, wb.maxX, wb.minZ, wb.maxZ);
          if (hit) warn(tag + " crosses water body '" + (wb.name || "?") + "'");
        }
        const A = city.annex;
        if (A && rectCircleOverlap(leg, A.cx, A.cz, A.radius)) warn(tag + " enters the commerce annex");
        const B = city.bridge;
        if (B && rectsOverlap(leg, B.minX, B.maxX, B.minZ, B.maxZ)) warn(tag + " crosses the east bridge");
        // mainland + harbor bay ring (water 28..95u out, Chebyshev — see
        // continent.js bayDist): the leg's Chebyshev range to the city rect
        // must sit entirely beyond 97 (or the leg would wade the bay/city).
        if (isFinite(city.minX)) {
          const dxMin = Math.max(city.minX - leg.maxX, 0, leg.minX - city.maxX);
          const dzMin = Math.max(city.minZ - leg.maxZ, 0, leg.minZ - city.maxZ);
          if (Math.max(dxMin, dzMin) < 97) warn(tag + " enters the mainland/harbor-bay band");
        }
      }
      for (const d of route.docks || []) {
        let ok = false;
        for (const rg of regs) {
          if (!isLinkName(rg.name) || rg.kind === "circle") continue;
          if (d.x >= rg.minX - 6 && d.x <= rg.maxX + 6 && d.z >= rg.minZ - 6 && d.z <= rg.maxZ + 6) { ok = true; break; }
        }
        if (!ok) warn(route.id + " dock (" + d.x + "," + d.z + ") [" + d.note + "] found no causeway/link region, a landmass moved without this table");
      }
    }
    return blocked;
  }

  // ============================================================
  //  THE BUILDER — one buildHighway call per route (merged deck + paint),
  //  then the pure-data integration: roads records, link regions, relief
  //  corridors. Runs at order 91: after every landmass/causeway (≤35) and
  //  the HWY-4 arterial connectors (90), before the continent plate (97)
  //  reads the relief gate and the archipelago shoals dodge the records.
  // ============================================================
  /* THE BENDS, AS TRAFFIC DRIVES THEM. A lane follower holds an axis-
     aligned record; between two such legs the deck sweeps a 750 m corner
     or an S-bend. For every pair of consecutive axis legs this publishes,
     per record and direction of travel, where the curve leaves the leg
     (`along`, the tangent point), the deck's centreline through the curve
     (`pts`, the very path the deck was built on) and the leg and direction
     it joins. vehicles.js offsets the centreline by the car's own lane and
     drives it as a turning polyline, so a car takes the curve the deck
     takes. CBZ.highwayBendFor(record, dirSign) -> entry | null. */
  let _bends = new Map();
  CBZ.highwayBendFor = function (r, dir) {
    const l = _bends.get(r);
    return l ? (dir > 0 ? l.pos : l.neg) : null;
  };
  function bendEntries(route, legRec, sp) {
    const pts = route.pts;
    const nearest = function (p) { let bi = 0, bd = 1e18; for (let k = 0; k < sp.length; k++) { const d = (sp[k].x - p.x) * (sp[k].x - p.x) + (sp[k].z - p.z) * (sp[k].z - p.z); if (d < bd) { bd = d; bi = k; } } return bi; };
    const unit = function (a, b) { const L = legLen(a, b) || 1; return { x: (b.x - a.x) / L, z: (b.z - a.z) / L }; };
    for (let i = 0; i < legRec.length; i++) {
      if (!legRec[i]) continue;
      let j = i + 1;
      while (j < legRec.length && !legRec[j] && !isAxis(pts[j], pts[j + 1])) j++;
      if (j >= legRec.length || !legRec[j]) continue;
      const ri = legRec[i], rj = legRec[j];
      if (ri.noTraffic || rj.noTraffic) continue;
      const di = unit(pts[i], pts[i + 1]), dj = unit(pts[j], pts[j + 1]);
      const ti = cornerT(pts, i + 1, route.fillet), tj = cornerT(pts, j, route.fillet);
      if (ti < 20 && j === i + 1) continue;                                  // no real curve: the junction turn does it
      const S = { x: pts[i + 1].x - di.x * ti, z: pts[i + 1].z - di.z * ti };
      const E = { x: pts[j].x + dj.x * tj, z: pts[j].z + dj.z * tj };
      const k0 = nearest(S), k1 = nearest(E);
      if (k1 <= k0 + 1) continue;
      const mid = sp.slice(k0 + 1, k1).map(function (p) { return { x: p.x, z: p.z }; });
      const fwd = [S].concat(mid, [E]), rev = fwd.slice().reverse();
      const dirI = ri.vertical ? Math.sign(di.z) : Math.sign(di.x), dirJ = rj.vertical ? Math.sign(dj.z) : Math.sign(dj.x);
      const put = function (rec, dir, e) { let l = _bends.get(rec); if (!l) _bends.set(rec, l = { pos: null, neg: null }); if (dir > 0) l.pos = e; else l.neg = e; };
      put(ri, dirI, { along: ri.vertical ? S.z : S.x, pts: fwd, exit: rj, exitDir: dirJ, exitAlong: rj.vertical ? E.z : E.x });
      put(rj, -dirJ, { along: rj.vertical ? E.z : E.x, pts: rev, exit: ri, exitDir: -dirI, exitAlong: ri.vertical ? S.z : S.x });
    }
  }

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    _bends = new Map();
    if (!CBZ.buildHighway || !CBZ.highwaySmoothPath) return;
    const routes = CBZ.highwayNetTable();
    _routes = routes;

    clearanceSweep(city, routes);

    const group = new THREE.Group();
    group.name = "highway-network";
    group.userData.terrain = true;       // world-spanning routes: never one far-cull blob
    city.root.add(group);

    _corridors = [];
    let bMinX = 1e9, bMaxX = -1e9, bMinZ = 1e9, bMaxZ = -1e9;
    const recs = {};

    for (const route of routes) {
      // ---- geometry: fillet + mitre-strip deck/paint (highways.js) --------
      const hw = CBZ.buildHighway(group, {
        path: route.pts, smooth: true, filletRadius: route.fillet, filletStep: 9,
        width: route.width, lanesPerDir: route.lanesPerDir,
        median: route.median !== false, medianW: MEDIAN_W, laneW: LANE_W, theme: route.theme || "asphalt",
        registerRoads: false,            // records come from the LEG table below,
        route: route.id,                 // never from the arc-subdivided path
      });
      recs[route.id] = hw;

      // ---- relief corridors: the exact filleted centreline the deck used —
      //      same pure function, same inputs, zero drift ---------------------
      const sp = CBZ.highwaySmoothPath(route.pts, route.fillet, 9);
      for (let i = 0; i < sp.length - 1; i++) {
        const a = sp[i], b = sp[i + 1];
        const c = {
          x0: a.x, z0: a.z, x1: b.x, z1: b.z, half: route.width / 2 + 2,
          minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
          minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
        };
        _corridors.push(c);
        bMinX = Math.min(bMinX, c.minX - 60); bMaxX = Math.max(bMaxX, c.maxX + 60);
        bMinZ = Math.min(bMinZ, c.minZ - 60); bMaxZ = Math.max(bMaxZ, c.maxZ + 60);
      }

      // ---- drivable records (one per axis-aligned leg) + link regions -----
      route.roads = [];
      const pts = route.pts, roads = city.roads;
      const legRec = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!isAxis(a, b)) {
          // AN S-BEND'S DRIFT LEG: no lane follower can hold a diagonal, so
          // cars cross it on the bend's own curve (bendEntries); the graph
          // still joins through two closed records on its L, and the map and
          // the shore field get the deck as a chain of short link rects
          if (roads) for (const q of [[a.x, a.z, b.x, a.z], [b.x, a.z, b.x, b.z]]) {
            const v = Math.abs(q[0] - q[2]) < 0.5, len = v ? Math.abs(q[3] - q[1]) : Math.abs(q[2] - q[0]);
            if (len < 1) continue;
            const seg = v ? { x: q[0], z: (q[1] + q[3]) / 2, vertical: true, len: len } : { x: (q[0] + q[2]) / 2, z: q[1], vertical: false, len: len };
            Object.assign(seg, { district: "highway", w: route.width, lanesPerDir: route.lanesPerDir, laneW: LANE_W, route: route.id, noTraffic: true, bendLink: true });
            if (route.median !== false) { seg.median = true; seg.medianW = MEDIAN_W; }
            roads.push(seg); route.roads.push(seg);
          }
          const L = legLen(a, b), n = Math.max(1, Math.ceil(L / 60)), h = route.width / 2;
          for (let k = 0; k < n; k++) {
            const p0 = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }, p1 = { x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n };
            CBZ.registerCityRegion(city, { name: route.name + " Link", subtitle: "Highway", kind: "rect", road: true, route: route.id,
              minX: Math.min(p0.x, p1.x) - h, maxX: Math.max(p0.x, p1.x) + h, minZ: Math.min(p0.z, p1.z) - h, maxZ: Math.max(p0.z, p1.z) + h, pad: 1 });
          }
          legRec.push(null);
          continue;
        }
        const vertical = Math.abs(b.x - a.x) < 0.5;
        // record span: leg ends, stretched to the docked centrelines at the
        // route's two extremities (recA/recB) so junction hops snap.
        let a0 = vertical ? a.z : a.x, b0 = vertical ? b.z : b.x;
        if (i === 0 && route.recA != null) a0 = route.recA;
        if (i === pts.length - 2 && route.recB != null) b0 = route.recB;
        const lo = Math.min(a0, b0), hi = Math.max(a0, b0);
        if (hi - lo < 1) { legRec.push(null); continue; }
        const seg = vertical
          ? { x: a.x, z: (lo + hi) / 2, vertical: true, len: hi - lo }
          : { x: (lo + hi) / 2, z: a.z, vertical: false, len: hi - lo };
        seg.district = "highway";
        seg.w = route.width; seg.lanesPerDir = route.lanesPerDir; seg.laneW = LANE_W;
        if (route.median !== false) { seg.median = true; seg.medianW = MEDIAN_W; }
        seg.route = route.id;
        if (route.rural) seg.rural = true;
        // ENFORCE (roadrules.js): dock at a place's edge, never cross it. The
        // route's FINAL point is the destination, so the leg that arrives is
        // allowed in and a leg that merely passes a town is cut at the kerb.
        if (CBZ.roadClamp) CBZ.roadClamp(seg, { dest: pts[pts.length - 1], owner: route.id, city: city });
        if (roads) { roads.push(seg); route.roads.push(seg); }
        legRec.push(seg);
        // map/waterfield region — "Link" name: fullmap draws it as road,
        // polwar's front search (/causeway|bridge/) and the shore field's
        // land-holding both ignore it (established link semantics).
        CBZ.registerCityRegion(city, {
          name: route.name + " Link", subtitle: route.rural ? "Country Road" : "Highway", kind: "rect",
          road: true, route: route.id,
          minX: Math.min(a.x, b.x) - route.width / 2, maxX: Math.max(a.x, b.x) + route.width / 2,
          minZ: Math.min(a.z, b.z) - route.width / 2, maxZ: Math.max(a.z, b.z) + route.width / 2,
          pad: 1,
        });
      }
      bendEntries(route, legRec, sp);
    }
    // ---- THE INTERCHANGE (city/interchange.js): Route 5 T's onto Route 1's
    //      west leg on flat open country — the flyover carries the crossing
    //      movement, the at-grade T stays for traffic. Its footprint joins
    //      the relief gate so the ground under the ramps is flat too. -------
    if (CBZ.planInterchange) {
      const byId = {};
      for (const r of routes) byId[r.id] = r;
      try {
        const res = byId.R1 && byId.R5 ? CBZ.planInterchange({ through: byId.R1, stem: byId.R5, recs: recs, city: city }) : null;
        if (res) for (const c of res.corridors) {
          _corridors.push(c);
          bMinX = Math.min(bMinX, c.minX - 60); bMaxX = Math.max(bMaxX, c.maxX + 60);
          bMinZ = Math.min(bMinZ, c.minZ - 60); bMaxZ = Math.max(bMaxZ, c.maxZ + 60);
        }
        else console.warn("[highwaynet] R5/R1 interchange could not be planned; the T stays at grade");
      } catch (e) { console.error("[highwaynet] interchange", e); }
    }
    _netBox = { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ };
  }, 91);
})();
