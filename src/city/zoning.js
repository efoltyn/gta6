/* ============================================================
   city/zoning.js — THE WORLD'S ONE ZONING FIELD.

   OWNER (iPad, 2026-10-08): "It's a more general problem of the map layout
   and ground and road locations, everything feeling overly sparse, not
   dense in the right places. Sparse is fine, but it just feels like
   different parts were done unintentionally."

   MEASURED BEFORE THIS FILE (tools/layout-audit.mjs, seed 90210): every
   generator decided density on its own. The Gang City downtown (the spawn)
   is a 330 m grid of 2-5 storey blocks; the borough the metro planner grew
   round it (Gang City West) put 35 towers of 10-27 storeys across the
   harbour, so the suburb out-topped the core it grew from. Goldspire's ring
   topped out at 32 storeys round a core whose towers stop at 25; Cape
   Harbor's ring stood 3-7 storeys round a core of one-storey shops. 713
   rowhouses and houses stood within 25 m of a freeway's edge. Nothing in
   the world could answer "how dense SHOULD it be here?".

   THIS IS THAT ANSWER: one deterministic field, a pure function of the
   region layout and the highway table (no rng stream, no meshes, runs in
   node), that every generator reads:

     intensityAt(x, z)  0..1 — the urban gradient. Every settlement is a
                        CENTRE with a peak and a radius; intensity is the
                        strongest centre's falloff, the same curve the metro
                        planner's land value uses (exp(-1.84 * t^1.4)).
     useAt(x, z)        what belongs there: core / midrise / inner / rows /
                        suburb / exurb / rural, or protected (estates,
                        compounds, the airport, the base, the arena) or
                        verge (the freeway's buffer).
     ceilingAt(x, z, core)  how tall a district GROWN ROUND an existing
                        core may build: the core's own height, falling with
                        distance. A borough never out-tops its downtown.
     freewayEdge(x, z)  metres from the nearest freeway deck edge (the
                        filleted centreline highways.js draws, when loaded).
     inFreewayBuffer(x, z, pad)  no homes here: the verge + sound buffer.
     protectedAt / protectedHit  protected land (bases, airfields, bunkers,
                        estates), each with its clear buffer. No generator
                        builds or lays a street there.
     CBZ.protectedSite(id)  where a fixed fixture (the B-2 pad, the Brandt
                        shelter) stands, riding the layout dial.
     snapshot()         the field on a 100 m grid, for tools/layout-audit.mjs.

   WHO READS IT: city/metroplan.js (through city/metro.js planSite: the
   ceiling law for grown districts, the freeway frontage law, cells zoned
   down when the ceiling is low), city/metro.js (the Gang City North site is
   placed off it), tools/layout-audit.mjs (zoning fit). Build once per
   world: CBZ.zoningFor(city) caches on the city object.

   Determinism: everything here is closed-form over data a slice replays
   (regions, road records, the highway table), so a streamed slice and the
   whole city see the same field.
============================================================ */
(function (G) {
  "use strict";
  const CBZ = (G.CBZ = G.CBZ || {});

  // ---- PROTECTED LAND: bases, airfields, bunkers. The region rect is the
  //      fence; the BUFFER is the clear ground round it no generator may
  //      build or lay a street in (a runway's clear zone, a base's
  //      standoff). Airfields keep 60 m, a military base 80 m, a fixture 30.
  const PROTECT_BUFFER = { military: 80, airport: 60 };
  const FIXTURE_BUFFER = 30;
  // THE FIXED FORT BRANDT HARDWARE, in the base's AUTHORED (stage-1) frame.
  // The base rides the layout dial (island_military.js: CBZ.worldOff
  // ("military"), today dx -900 dz -480); everything parked on it must ride
  // the same dial. strategic.js used to park the B-2 at the authored literal
  // (-560, -566) and bunkers.js dug the deep shelter at (-762, -872): after
  // stage 2 moved the island those spots were the mainland, and by stage 4
  // the B-2 stood in Gang City West between office blocks while its base was
  // 1 km away. They ask here now (CBZ.protectedSite), so there is one answer.
  //   b2-pad          the parked B-2 (52.4 m span along x, 21 m long), just
  //                   north of the strip, nose toward the runway
  //   brandt-shelter  the command bunker, NW quadrant
  const FIXTURES = {
    "b2-pad":         { base: "military", ax: -560, az: -566, w: 52.4, d: 21 },
    "brandt-shelter": { base: "military", ax: -762, az: -872, w: 36, d: 30 },
  };
  function protectedSite(id) {
    const f = FIXTURES[id];
    if (!f) return null;
    const o = (CBZ.worldOff && CBZ.worldOff(f.base)) || { dx: 0, dz: 0 };
    const cx = f.ax + o.dx, cz = f.az + o.dz;
    return { id: id, name: id, kind: "fixture", base: f.base, cx: cx, cz: cz, w: f.w, d: f.d,
      minX: cx - f.w / 2, maxX: cx + f.w / 2, minZ: cz - f.d / 2, maxZ: cz + f.d / 2, buffer: FIXTURE_BUFFER };
  }
  CBZ.protectedSite = protectedSite;

  // ---- the curve (metroplan.js landValue's): 1 at the centre, ~0.16 at R
  function fall(t) { return t <= 0 ? 1 : Math.exp(-1.84 * Math.pow(t, 1.4)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rectDist(r, x, z) {
    const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    return Math.hypot(dx, dz);
  }
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  }

  // ---- THE CENTRES' HEIGHTS. A grown district may rise to its core's
  //      typical tall block, never past it. Measured off the walk-in cores
  //      (layout-audit, seed 90210: storeys p85 of each core's own lots):
  //        Gang City downtown  10  (buildings.js STREET_STYLE: the commercial
  //                                 streets' towers, 8-10; the 52-storey
  //                                 flagship is the crown, not the street)
  //        Goldspire           20  (towngen skyline lots, p85 20, max 25)
  //        Neon Reef           29  (p85 29, max 36)
  //        Cape Harbor          1  -> FLOOR (a ring of rowhouses round a
  //                                 harbour town of shops is right)
  //      A metro's own CBD is its own centre (tier core 72): nothing caps it.
  const CORE_ST = { downtown: 10, goldspire: 20, neonreef: 29, capeharbor: 1 };
  const FLOOR_ST = 4;               // rowhouses + a corner walk-up, everywhere urban
  // how far a core's height carries before it is down to the floor
  const CEIL_R = { downtown: 950, goldspire: 700, neonreef: 650, capeharbor: 500 };
  const TOWN_BIOMES = /^(veridiacity|lowport|keshtown|kesh_north|kesh_east|solaracity|mbeyacity|mbeya_west|mbeya_south|mbeya_east|foundry)$/;
  const PROTECT_BIOMES = /^(airport|military|speedway|arena)$/;
  const ROADLIKE = /bridge|causeway|link|approach|spur|connector|corridor|ramp|highway|road/i;
  // the freeway buffer: no home's wall within this many metres of a deck edge
  // (the verge, a tree screen, the noise). 30 m is a US sound-wall setback
  // plus a back garden.
  const FREEWAY_BUFFER = 30;

  function build(city) {
    const regions = (city && city.regions) || [];
    const Z = { centres: [], freeways: [], protect: [], built: true };

    // 1. CENTRES
    // the Gang City downtown: the world's first core
    if (city && isFinite(city.minX)) {
      Z.centres.push({ name: "Gang City", key: "downtown", minX: city.minX, maxX: city.maxX, minZ: city.minZ, maxZ: city.maxZ,
        peak: 1, R: 1500, st: CORE_ST.downtown, ceilR: CEIL_R.downtown });
    }
    // the metros: their own CBD (metro.js siteTable is pure data)
    const sites = (CBZ.metroLib && CBZ.metroLib.siteTable && city) ? CBZ.metroLib.siteTable(city) : [];
    for (const s of sites) {
      if (s.tier !== "metro") continue;
      Z.centres.push({ name: s.name, key: s.id, minX: s.cx - 150, maxX: s.cx + 150, minZ: s.cz - 150, maxZ: s.cz + 150,
        peak: 1, R: (s.rx + s.rz) / 2, st: 72, ceilR: (s.rx + s.rz) / 2 });
    }
    // the walk-in towngen cities the rings grow round
    for (const id of ["goldspire", "capeharbor", "neonreef"]) {
      const name = { goldspire: "Goldspire", capeharbor: "Cape Harbor", neonreef: "Neon Reef" }[id];
      const reg = regions.find(function (g) { return g && g.biome === id && g.name === name && g.kind !== "circle" && !g.metro; });
      if (!reg) continue;
      Z.centres.push({ name: name, key: id, minX: reg.minX, maxX: reg.maxX, minZ: reg.minZ, maxZ: reg.maxZ,
        peak: 0.78, R: 900, st: CORE_ST[id], ceilR: CEIL_R[id] });
    }
    // the small towns and villages (their regions)
    for (const r of regions) {
      if (!r || r.metro || !TOWN_BIOMES.test(r.biome || "") || r.kind === "circle") continue;
      if (ROADLIKE.test(r.name || "")) continue;
      const big = Math.max(r.maxX - r.minX, r.maxZ - r.minZ);
      Z.centres.push({ name: r.name, key: r.biome, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ,
        peak: big > 200 ? 0.5 : 0.36, R: 280 + big, st: 3, ceilR: 300 });
    }

    // 2. PROTECTED SITES: compounds, estates, civic sites (regions with no
    //    biome that are not roads), and the airport / base / arena / track.
    //    A base or an airfield carries its BUFFER (PROTECT_BUFFER); its
    //    road-like links (an airport causeway) are roads, not apron, and
    //    keep none. A bunker's region (a remote shelter) is a fixture.
    for (const r of regions) {
      if (!r || r.metro || r.underlay || r.kind === "circle") continue;
      const b = r.biome || "";
      if ((!b && r.name && !ROADLIKE.test(r.name)) || PROTECT_BIOMES.test(b)) {
        const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
        const link = ROADLIKE.test(r.name || "") && Math.min(w, d) <= 40;
        const bunker = !b && /station|shelter|bunker/i.test((r.name || "") + " " + (r.subtitle || ""));
        const buffer = link ? 0 : (PROTECT_BUFFER[b] || (bunker ? FIXTURE_BUFFER : 0));
        Z.protect.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, name: r.name || b, kind: b || (bunker ? "bunker" : "estate"), buffer: buffer });
      }
    }
    for (const id in FIXTURES) Z.protect.push(protectedSite(id));

    // 3. FREEWAYS: the network's routes (filleted exactly as highways.js
    //    draws them, when it is loaded) + the 3+3 island causeways
    const table = CBZ.highwayNetTable ? CBZ.highwayNetTable() : [];
    const H = CBZ.HIGHWAY_NET_HALF || 15.3;
    for (const route of table) {
      if (route.rural) continue;                 // a two-lane country road wants houses on it
      const pts = CBZ.highwaySmoothPath ? CBZ.highwaySmoothPath(route.pts, route.fillet || 60, 9) : route.pts;
      for (let i = 0; i + 1 < pts.length; i++) Z.freeways.push({ ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, half: H, name: route.name });
    }
    for (const r of (city && city.roads) || []) {
      if (!r || r.district !== "highway" || r.frontier || r.rural || !isFinite(r.x) || (r.w || 0) < 20) continue;   // a country road (r.rural) is no freeway
      if (table.length && Math.abs((r.w || 0) - H * 2) < 0.5) continue;     // a network leg: already in from its table
      const h = r.len / 2, half = (r.w || 24) / 2 + 3;
      if (r.vertical) Z.freeways.push({ ax: r.x, az: r.z - h, bx: r.x, bz: r.z + h, half: half, name: "causeway" });
      else Z.freeways.push({ ax: r.x - h, az: r.z, bx: r.x + h, bz: r.z, half: half, name: "causeway" });
    }
    // a coarse bucket grid over the freeway segments (the field is asked
    // per building: tens of thousands of queries per plan)
    const FB = 200, fgrid = new Map();
    for (const f of Z.freeways) {
      const pad = f.half + 120;
      const i0 = Math.floor((Math.min(f.ax, f.bx) - pad) / FB), i1 = Math.floor((Math.max(f.ax, f.bx) + pad) / FB);
      const j0 = Math.floor((Math.min(f.az, f.bz) - pad) / FB), j1 = Math.floor((Math.max(f.az, f.bz) + pad) / FB);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 65536 + j; let l = fgrid.get(k); if (!l) fgrid.set(k, l = []); l.push(f); }
    }

    // ---- queries
    Z.freewayEdge = function (x, z) {
      const l = fgrid.get(Math.floor(x / FB) * 65536 + Math.floor(z / FB));
      if (!l) return Infinity;
      let best = Infinity;
      for (const f of l) { const d = segDist(x, z, f.ax, f.az, f.bx, f.bz) - f.half; if (d < best) best = d; }
      return best;
    };
    // a footprint (centre + half extents) inside the buffer?
    Z.inFreewayBuffer = function (x, z, ext, pad) {
      return Z.freewayEdge(x, z) - (ext || 0) < (pad == null ? FREEWAY_BUFFER : pad);
    };
    // a point on protected land (its buffer included)
    Z.protectedAt = function (x, z) {
      for (const p of Z.protect) {
        const b = p.buffer || 0;
        if (x >= p.minX - b && x <= p.maxX + b && z >= p.minZ - b && z <= p.maxZ + b) return p;
      }
      return null;
    };
    // a footprint (AABB) touching protected land (its buffer included)
    Z.protectedHit = function (minX, minZ, maxX, maxZ) {
      for (const p of Z.protect) {
        const b = p.buffer || 0;
        if (maxX > p.minX - b && minX < p.maxX + b && maxZ > p.minZ - b && minZ < p.maxZ + b) return p;
      }
      return null;
    };
    // the sites that carry a buffer: bases, airfields, bunkers, fixtures
    // (metro.js plans round them at that pad; the node check reads them)
    Z.airfields = function () { return Z.protect.filter(function (p) { return (p.buffer || 0) > 0; }); };
    Z.intensityAt = function (x, z) {
      let v = 0;
      for (const c of Z.centres) {
        const d = rectDist(c, x, z);
        if (d > c.R * 2.6) continue;
        const s = c.peak * fall(d / c.R);
        if (s > v) v = s;
      }
      return v;
    };
    Z.useAt = function (x, z) {
      const p = Z.protectedAt(x, z);
      if (p) return "protected";
      const v = Z.intensityAt(x, z);
      if (v >= 0.18 && Z.freewayEdge(x, z) < FREEWAY_BUFFER) return "verge";
      return v >= 0.8 ? "core" : v >= 0.62 ? "midrise" : v >= 0.47 ? "inner" : v >= 0.33 ? "rows" : v >= 0.18 ? "suburb" : v >= 0.08 ? "exurb" : "rural";
    };
    Z.centre = function (key) { for (const c of Z.centres) if (c.key === key) return c; return null; };
    // the storey ceiling for a district grown round core `key`
    Z.ceilingAt = function (x, z, key) {
      const c = Z.centre(key);
      if (!c) return Infinity;
      const d = rectDist(c, x, z);
      const t = d / c.ceilR;
      return Math.max(FLOOR_ST, Math.round(c.st * Math.exp(-1.2 * Math.pow(t, 1.5))));
    };
    // the field on a grid (tools/layout-audit.mjs reads it)
    Z.snapshot = function (g) {
      g = g || { x0: -5400, z0: -4800, cell: 100, nx: 140, nz: 100 };
      const grid = new Array(g.nx * g.nz), use = new Array(g.nx * g.nz);
      for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
        const x = g.x0 + (i + 0.5) * g.cell, z = g.z0 + (j + 0.5) * g.cell;
        grid[j * g.nx + i] = Math.round(Z.intensityAt(x, z) * 100);
        use[j * g.nx + i] = Z.useAt(x, z);
      }
      return { x0: g.x0, z0: g.z0, cell: g.cell, nx: g.nx, nz: g.nz, grid: grid, use: use,
        centres: Z.centres.map(function (c) { return { name: c.name, key: c.key, x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, peak: c.peak, R: c.R, st: c.st }; }) };
    };
    Z.BUFFER = FREEWAY_BUFFER; Z.FLOOR_ST = FLOOR_ST;
    return Z;
  }

  // one field per world (the city object); rebuilt when the world is
  CBZ.zoningFor = function (city) {
    if (!city) return null;
    if (city._zoning && city._zoning.built) return city._zoning;
    const Z = build(city);
    try { Object.defineProperty(city, "_zoning", { value: Z, configurable: true, writable: true, enumerable: false }); } catch (e) { city._zoning = Z; }
    CBZ.zoning = Z;
    return Z;
  };
  CBZ.zoningLib = { build: build, fall: fall, CORE_ST: CORE_ST, FLOOR_ST: FLOOR_ST, FREEWAY_BUFFER: FREEWAY_BUFFER,
    PROTECT_BUFFER: PROTECT_BUFFER, FIXTURE_BUFFER: FIXTURE_BUFFER, protectedSite: protectedSite };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.zoningLib;
})(typeof window !== "undefined" ? window : globalThis);
