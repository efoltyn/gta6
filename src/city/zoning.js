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
    //    biome that are not roads), and the airport / base / arena / track
    for (const r of regions) {
      if (!r || r.metro || r.underlay || r.kind === "circle") continue;
      const b = r.biome || "";
      if ((!b && r.name && !ROADLIKE.test(r.name)) || PROTECT_BIOMES.test(b)) {
        Z.protect.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, name: r.name || b, kind: b || "estate" });
      }
    }

    // 3. FREEWAYS: the network's routes (filleted exactly as highways.js
    //    draws them, when it is loaded) + the 3+3 island causeways
    const table = CBZ.highwayNetTable ? CBZ.highwayNetTable() : [];
    const H = CBZ.HIGHWAY_NET_HALF || 15.3;
    for (const route of table) {
      const pts = CBZ.highwaySmoothPath ? CBZ.highwaySmoothPath(route.pts, route.fillet || 60, 9) : route.pts;
      for (let i = 0; i + 1 < pts.length; i++) Z.freeways.push({ ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, half: H, name: route.name });
    }
    for (const r of (city && city.roads) || []) {
      if (!r || r.district !== "highway" || r.frontier || !isFinite(r.x) || (r.w || 0) < 20) continue;
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
    Z.protectedAt = function (x, z) {
      for (const p of Z.protect) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return p;
      return null;
    };
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
  CBZ.zoningLib = { build: build, fall: fall, CORE_ST: CORE_ST, FLOOR_ST: FLOOR_ST, FREEWAY_BUFFER: FREEWAY_BUFFER };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.zoningLib;
})(typeof window !== "undefined" ? window : globalThis);
