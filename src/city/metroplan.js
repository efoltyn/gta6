/* ============================================================
   city/metroplan.js — THE URBAN PLAN. What a real city IS, as data.

   OWNER (2026-09-29): "making the Gang Life cities realistically large. Some
   absolutely massive cities could be made. Realistically sized cities, not
   just one mass of tall buildings."

   MEASURED BEFORE THIS FILE: the Gang City downtown is 330 m across (36 lots,
   one building each), every mini-city and capital is a 3x4 to 4x4 grid of
   ~240 m with a clump of 11-36 storey towers in the middle, and 232 of the
   world's 328 buildings are one storey. There was no city anywhere with a
   structure: no suburbs, no midrise ring, no industry, no rail, no river
   town, nothing that falls off from a centre. A real metro is kilometres
   across and most of it is NOT towers.

   This file is the PLANNER, and only the planner: pure data, no THREE, no
   CBZ state, no rng stream (it runs in node for the checks in
   tools/metro-plan-check.mjs). city/metro.js places cities with it and
   builds what it returns. One plan, one set of numbers, used by the
   renderer, the physics floor, the colliders, the map and the audit.

   THE STRUCTURE (field -> structure -> detail):
     1. LAND VALUE. A field, not a bullseye: the CBD peak, a MIDTOWN
        secondary centre, suburban MALL NODES at big arterial junctions,
        a river-front premium, low-frequency noise. Height and density
        follow it; nothing else decides how tall anything is.
     2. URBAN ENVELOPE. A noise-warped ellipse. Inside: city. Past it:
        exurb (big lots, farms). Past that: fields.
     3. ARTERIALS every A metres (400 in a metro: the half-mile grid of an
        American city at game scale) — the only streets that carry through
        traffic, registered as real road records. Beyond the envelope only
        every second one continues, as a country road.
     4. SUPERBLOCKS between arterials, each ZONED from the fields:
          cbd       towers on a 100 m grid, 25..coreStoreys
          midtown   office/residential 8-30 storeys, perimeter blocks
          inner     4-9 storey apartment perimeter blocks, shops on corners
          rows      2-4 storey rowhouse terraces on long blocks
          suburb    houses on CURVING streets, loops and cul-de-sacs, a
                    strip mall at the node corners
          exurb     big lots on the country road, farmsteads
          farm      fields
          industrial warehouses, yards, tanks along the rail and the river
          park / campus / stadium / mall / station — the landmarks
     5. A RIVER through the city (bridges where the arterials cross, a
        riverside park strip), a RAIL line (level crossings, a central
        station, a freight yard), and the EXISTING FREEWAYS read from the
        highway table (overpasses, diamond interchanges).
     6. DISTRICTS: connected superblocks of one class, named, and given ONE
        fixed look each — the same "one style per district" rule the
        downtown's street identity table follows (buildings.js STREET_STYLE).

   DETERMINISM: every choice is a hash of (seed, position, salt). No
   Math.random, no shared stream. A seed makes the same city byte for byte.

   Exposes CBZ.metroPlan(spec) / CBZ.metroPlanStats(plan) /
   CBZ.metroPlanAudit(plan) in the browser; module.exports in node.
============================================================ */
(function (G) {
  "use strict";

  // ---------------------------------------------------------------------
  //  HASHING (squirrel3-style, seeded) — position hashes and value noise
  // ---------------------------------------------------------------------
  function sq(n, seed) {
    let m = (Math.imul(n | 0, 0xB5297A4D) + (seed | 0)) | 0;
    m ^= m >>> 8; m = (m + 0x68E31DA4) | 0; m ^= m << 8;
    m = Math.imul(m, 0x1B56C4E9); return m ^ (m >>> 8);
  }
  function h01(seed, x, z, salt) {
    const h = sq(salt | 0, sq(Math.round(z * 4) | 0, sq(Math.round(x * 4) | 0, seed | 0)));
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(seed, x, z, cell, salt) {
    const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = smooth(gx - ix), fz = smooth(gz - iz);
    const a = h01(seed, ix, iz, salt), b = h01(seed, ix + 1, iz, salt);
    const c = h01(seed, ix, iz + 1, salt), d = h01(seed, ix + 1, iz + 1, salt);
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function r2(v) { return Math.round(v * 100) / 100; }

  // ---------------------------------------------------------------------
  //  TIERS — the numbers that make a metro a metro and a town a town
  // ---------------------------------------------------------------------
  const TIERS = {
    metro: { A: 400, artW: 22, locW: 12, colW: 14, rurW: 9, pitch: 100, core: 72, lanes: 2, riverHalf: 62 },
    city:  { A: 340, artW: 20, locW: 11, colW: 13, rurW: 9, pitch: 85,  core: 34, lanes: 2, riverHalf: 58 },
    town:  { A: 280, artW: 16, locW: 10, colW: 12, rurW: 8, pitch: 70,  core: 9,  lanes: 1, riverHalf: 58 },
  };

  // ---------------------------------------------------------------------
  //  DISTRICT LOOKS — one fixed style per district (the downtown's street
  //  identity law, buildings.js STREET_STYLE). `grammar` names the facade
  //  kit family this look is read from; the metro fabric shader
  //  (city/metro_fabric.js) renders each family procedurally.
  // ---------------------------------------------------------------------
  const LOOKS = {
    cbd: [
      { id: "glass-blue",  grammar: "intl",     walls: [0x5d7f99, 0x6f8fa6], glass: 0x3f6a86 },
      { id: "glass-green", grammar: "hightech", walls: [0x6d8a86, 0x5b7a78], glass: 0x3f6f6a },
      { id: "deco-stone",  grammar: "artdeco",  walls: [0xcdbf9f, 0xb9ab8d], glass: 0x3d4f5c },
    ],
    midtown: [
      { id: "mid-glass",   grammar: "intl",     walls: [0x8e9ba3, 0x7b8a93], glass: 0x46657a },
      { id: "mid-stone",   grammar: "stone",    walls: [0xc8b89a, 0xb5a585], glass: 0x3b4b57 },
      { id: "mid-deco",    grammar: "artdeco",  walls: [0xd2c3a3, 0xbfae8e], glass: 0x3c4c58 },
    ],
    inner: [
      { id: "walkup-brick", grammar: "brick",   walls: [0x8a3b26, 0x7a3524], glass: 0x2f3a44 },
      { id: "walkup-buff",  grammar: "stone",   walls: [0xbfa67f, 0xae966f], glass: 0x2f3a44 },
      { id: "block-concrete", grammar: "brutalist", walls: [0x8f8b84, 0x807c75], glass: 0x2c353e },
    ],
    rows: [
      { id: "row-brick",   grammar: "brickhouse", walls: [0x93452d, 0x7f3b27, 0xa0523a], glass: 0x2a333b },
      { id: "row-brown",   grammar: "brickhouse", walls: [0x6b4535, 0x5d3b2e, 0x7a5040], glass: 0x2a333b },
      { id: "row-painted", grammar: "victorian",  walls: [0xb8c7c9, 0xd9c9a3, 0xa9b89a, 0xc9a9a0], glass: 0x2a333b },
    ],
    suburb: [
      { id: "house-craftsman", grammar: "queenanne", walls: [0x7d8a6a, 0x8a7a5c, 0x6f7f86, 0xa89a7a], roofs: [0x3d3a36, 0x4a3b30], glass: 0x2b3238 },
      { id: "house-ranch",     grammar: "ranch",     walls: [0xcfc2a6, 0xb9b3a4, 0xd6cbb2, 0xa9b4b8], roofs: [0x5a4e44, 0x3f3b38], glass: 0x2b3238 },
      { id: "house-colonial",  grammar: "victorian", walls: [0xe6e1d6, 0xd8d2c2, 0xb9c4c9, 0xcdb99a], roofs: [0x3a3a3c, 0x4b4038], glass: 0x2b3238 },
      { id: "house-stucco",    grammar: "spanish",   walls: [0xe3d3b3, 0xd9c09a, 0xcfb89c, 0xeadfc8], roofs: [0x9a5a3c, 0x8a4e34], glass: 0x2b3238 },
    ],
    industrial: [
      { id: "ware-metal",  grammar: "industrial", walls: [0x8c9296, 0x7d858a, 0x9a8f7c], glass: 0x40505a },
      { id: "mill-brick",  grammar: "brick",      walls: [0x7a3a28, 0x6c3526], glass: 0x33404a },
    ],
    civic: [{ id: "civic-stone", grammar: "greekrev", walls: [0xd8d0bf, 0xc9c0ad], glass: 0x3a4650 }],
    // the Detroit neighbourhoods (style "detroit"): the brick streets nearer
    // the centre, the painted frame houses further out
    hood: [
      { id: "hood-brick", grammar: "queenanne", walls: [0x8a4a34, 0x7a3f2c, 0x9a5a40, 0x6e3a2a], roofs: [0x3a3634, 0x4a3b30, 0x2f2d2b], glass: 0x2b3238 },
      { id: "hood-wood", grammar: "victorian", walls: [0xb9b3a4, 0xcfc2a6, 0x8a9a8c, 0xa9b4b8, 0xd8d2c2], roofs: [0x3d3a36, 0x4a4540, 0x55504a], glass: 0x2b3238 },
    ],
  };

  const NAME_POOL = {
    cbd: ["Downtown", "The Loop", "Financial District"],
    midtown: ["Midtown", "Uptown", "Market Square"],
    inner: ["Old Town", "Riverside", "Lincoln Park", "Mercer", "Northgate", "Hollis", "Union Hill", "Eastside", "Garfield"],
    rows: ["Brookside", "Kensington", "Fairmount", "Irving Park", "Greenpoint", "Harlan Heights", "Bay View", "Cobble Hill", "Ridgewood"],
    suburb: ["Cedar Hills", "Fairview", "Oak Grove", "Lakeview", "Maple Ridge", "Westfield", "Pine Valley", "Briarwood", "Sunnyvale", "Clearwater", "Elmhurst", "Glen Park", "Willow Creek", "Stonegate", "Aspen Hollow"],
    industrial: ["The Yards", "Mill District", "Portside", "Foundry Row", "Canal Works", "South Terminal"],
    exurb: ["Hunter's Ridge", "Pleasant Hill", "Meadowbrook", "Cold Spring"],
    farm: ["Blue Creek Farms", "Ashby Fields", "Linden Acres"],
    hood: ["Elmwood", "Maplewood", "Ashland Park", "Birch Hill", "Rosewood", "Parkside", "Hillcrest", "Woodlawn", "Kenwood", "Glenhurst",
      "Cedar Heights", "Ivy Park", "Beechwood", "Grandview", "Oakdale", "Holbrook", "Laurel Park", "Westmoor", "Fenwick", "Sherwood"],
  };

  // ---------------------------------------------------------------------
  //  RECT HELPERS
  // ---------------------------------------------------------------------
  function rectHit(r, x0, z0, x1, z1) {
    return !(x1 <= r.minX || x0 >= r.maxX || z1 <= r.minZ || z0 >= r.maxZ);
  }
  function inRect(r, x, z) { return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ; }
  function padRect(r, p) { return { minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p, name: r.name }; }

  // distance from point to segment (and the closest t)
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = clamp(t, 0, 1);
    const qx = ax + dx * t, qz = az + dz * t;
    return Math.hypot(px - qx, pz - qz);
  }

  // =====================================================================
  //  THE PLANNER
  // =====================================================================
  function plan(spec) {
    const T0 = Date.now();
    const tier = TIERS[spec.tier] || TIERS.metro;
    // `seedKey` plans a city from another city's seed (a copy: city/metro.js
    // plans it in the source's frame, so every position hash is the source's)
    const seed = (spec.seed | 0) ^ hashStr(spec.seedKey || spec.id || "metro");
    // STYLE. "legacy" is the planner as it stood on 2026-09-29 (Kingsport's
    // plan the day the owner said "keep it as a communist place"): every line
    // below that is not under DET runs for it, unchanged. "detroit" is the
    // riverfront downtown, the radial avenues, the grid neighbourhoods of
    // houses and the auto-plant industry (see THE DETROIT PLAN below).
    const DET = spec.style === "detroit";
    const cx = spec.cx, cz = spec.cz;
    const A = spec.A || tier.A;
    const rx = spec.rx || 2000, rz = spec.rz || rx;
    const B = spec.bounds || { minX: cx - rx * 1.5, maxX: cx + rx * 1.5, minZ: cz - rz * 1.5, maxZ: cz + rz * 1.5 };
    const coreStoreys = spec.coreStoreys || tier.core;
    const obstacles = (spec.obstacles || []).map(function (o) { return padRect(o, o.pad != null ? o.pad : 14); });
    // A corridor arrives as {axis: the axis it RUNS along, at, a0, a1, half,
    // name}; inside the plan it speaks the street convention: `ax` is the
    // coordinate that is FIXED ('x' = a north-south line at x = at).
    const corridors = (spec.corridors || []).map(function (c) { return Object.assign({}, c, { ax: c.axis === "z" ? "x" : "z" }); });
    const cores = spec.cores || [];                     // existing downtowns to grow around: {minX..maxZ, name}
    // the world zoning field (city/zoning.js, via city/metro.js planSite):
    // { ceiling(x, z) | null, buffer(x, z, ext) } — see THE CEILING LAW and
    // THE FREEWAY FRONTAGE LAW below. Absent = the plan as it was.
    const ZN = spec.zoning || null;
    const ceilAt = ZN && ZN.ceiling ? ZN.ceiling : null;
    const P = {
      id: spec.id || "metro", name: spec.name || "Metro", tier: spec.tier || "metro", seed: seed,
      cx: cx, cz: cz, A: A, bounds: B, rx: rx, rz: rz,
      streets: [], junctions: [], blocks: [], pads: [], bldgs: [], parks: [], lots: [],
      trees: [], rail: [], stations: [], river: null, bridges: [], overpasses: [], interchanges: [],
      districts: [], landmarks: [], cells: [], xs: [], zs: [], obstacles: obstacles, corridors: corridors,
      walls: [], fields: [], parking: [], plazas: [], stats: null,
      style: spec.style || "legacy", uniform: !!spec.uniform, vacant: [], structs: null,
    };

    // ---------------------------------------------------------------
    // 0. FIELDS: envelope + land value (+ subcentres)
    // ---------------------------------------------------------------
    function envelope(x, z) {
      const dx = (x - cx) / rx, dz = (z - cz) / rz;
      const ang = Math.atan2(dz, dx);
      // a noise-warped radius: lobes along the arterial corridors and the
      // river, bays where the country presses in — never a clean ellipse
      const warp = 1 + 0.16 * (vnoise(seed, Math.cos(ang) * 3 + 11, Math.sin(ang) * 3 + 7, 1, 31) - 0.5) * 2
                     + 0.07 * (vnoise(seed, x, z, 900, 32) - 0.5) * 2;
      return Math.hypot(dx, dz) / warp;
    }
    // secondary centres: MIDTOWN on the far side of the CBD from the river,
    // mall nodes ringing the suburbs. Chosen by hash, kept inside the bounds.
    const subs = [];
    (function pickSubcentres() {
      const n = spec.tier === "town" ? 0 : 1;
      for (let k = 0; k < n; k++) {
        let best = null, bs = -1;
        for (let a = 0; a < 16; a++) {
          const th = (a / 16) * Math.PI * 2 + h01(seed, k, a, 41) * 0.2;
          const d = 0.42;
          const x = cx + Math.cos(th) * rx * d, z = cz + Math.sin(th) * rz * d;
          if (!inRect(B, x, z)) continue;
          let blocked = false;
          for (const o of obstacles) if (inRect(padRect(o, 200), x, z)) blocked = true;
          if (blocked) continue;
          const s = h01(seed, a, k, 43) + (spec.midtownBearing != null ? Math.cos(th - spec.midtownBearing) : 0);
          if (s > bs) { bs = s; best = { x: x, z: z }; }
        }
        if (best) subs.push({ x: best.x, z: best.z, w: 0.66, s: Math.min(rx, rz) * 0.2, kind: "midtown" });
      }
    })();
    function landValue(x, z) {
      const e = envelope(x, z);
      // ONE curve in metres from the centre (warped by the envelope, so the
      // core has lobes like the rest of the city): the CBD holds ~420 m, the
      // inner ring runs to ~1 km, rowhouses to ~1.4 km, then the suburbs (at
      // the metro's 1.9 km mean radius; a smaller city scales the same curve).
      let v = Math.exp(-1.84 * Math.pow(e, 1.4));
      for (const s of subs) {
        const d = Math.hypot(x - s.x, z - s.z) / s.s;
        v = Math.max(v, s.w * Math.exp(-d * d) + clamp(1 - e, 0, 1) * 0.2);
      }
      // existing downtowns this plan grows around carry the value they already have
      for (const c of cores) {
        const ccx = (c.minX + c.maxX) / 2, ccz = (c.minZ + c.maxZ) / 2;
        const rr = Math.max(c.maxX - c.minX, c.maxZ - c.minZ) * 0.5;
        const d = Math.max(0, Math.hypot(x - ccx, z - ccz) - rr) / Math.max(250, rr * 1.4);
        v = Math.max(v, 0.62 * Math.exp(-d * d));
      }
      if (P.river) {
        const rd = riverDist(x, z);
        if (rd < 300) v += 0.07 * (1 - rd / 300);
      }
      v += (vnoise(seed, x, z, 520, 51) - 0.5) * 0.12;
      return clamp(v, 0, 1);
    }
    P.landValue = landValue; P.envelope = envelope; P.subcentres = subs;

    // ---------------------------------------------------------------
    // 1. ARTERIAL LINES — the grid, centred so the CBD is a superblock
    // ---------------------------------------------------------------
    const xs = [], zs = [];
    {
      const x0 = cx - A / 2, z0 = cz - A / 2;
      for (let k = Math.floor((B.minX - x0) / A); x0 + k * A <= B.maxX; k++) { const x = x0 + k * A; if (x >= B.minX + 30 && x <= B.maxX - 30) xs.push(x); }
      for (let k = Math.floor((B.minZ - z0) / A); z0 + k * A <= B.maxZ; k++) { const z = z0 + k * A; if (z >= B.minZ + 30 && z <= B.maxZ - 30) zs.push(z); }
    }
    // an arterial never runs alongside a freeway (it would share its verge):
    // a line that close is dropped and the superblock simply grows
    function hugs(ax, v) {
      for (const c of corridors) if (c.ax === ax && Math.abs(c.at - v) < c.half + tier.artW / 2 + 40) return true;
      return false;
    }
    for (let k = xs.length - 1; k >= 0; k--) if (hugs("x", xs[k])) xs.splice(k, 1);
    for (let k = zs.length - 1; k >= 0; k--) if (hugs("z", zs[k])) zs.splice(k, 1);
    // NO LAND LEFT OUTSIDE THE GRID: land lies only BETWEEN arterials, so a
    // strip wider than ~half a superblock between the outermost line and the
    // bounds gets its own boundary road, and a gap a dropped line left wider
    // than 1.6 superblocks gets a line back (each nudged clear of freeways)
    function clearPos(ax, v, lo, hi) {
      for (let k = 0; k < 40; k++) for (const sgn of [1, -1]) {
        const q = v + sgn * k * 10;
        if (q >= lo && q <= hi && !hugs(ax, q)) return q;
      }
      return null;
    }
    function fillLines(ax, L, lo, hi) {
      L.sort(function (a, b) { return a - b; });
      if (!L.length) { const q = clearPos(ax, (lo + hi) / 2, lo, hi); if (q != null) L.push(q); }
      if (L.length && L[0] - lo > A * 0.45) { const q = clearPos(ax, lo, lo, L[0] - A * 0.3); if (q != null) L.unshift(q); }
      if (L.length && hi - L[L.length - 1] > A * 0.45) { const q = clearPos(ax, hi, L[L.length - 1] + A * 0.3, hi); if (q != null) L.push(q); }
      for (let k = 0; k + 1 < L.length; k++) {
        if (L[k + 1] - L[k] > A * 1.6) {
          const q = clearPos(ax, (L[k] + L[k + 1]) / 2, L[k] + A * 0.4, L[k + 1] - A * 0.4);
          if (q != null) { L.splice(k + 1, 0, q); k--; }
        }
      }
    }
    fillLines("x", xs, B.minX + 20, B.maxX - 20);
    fillLines("z", zs, B.minZ + 20, B.maxZ - 20);
    P.xs = xs; P.zs = zs;

    // ---------------------------------------------------------------
    // 2. THE RIVER (optional): a meander across the plan, N->S or W->E
    // ---------------------------------------------------------------
    if (spec.river) {
      const rv = spec.river;
      const half = rv.half || tier.riverHalf;
      const pts = [];
      const along = rv.axis === "x" ? "x" : "z";   // the axis the river flows ALONG
      const a0 = rv.from != null ? rv.from : (along === "z" ? B.minZ - 200 : B.minX - 200);
      const a1 = rv.to != null ? rv.to : (along === "z" ? B.maxZ + 200 : B.maxX + 200);
      const base = rv.at;
      const STEP = 60, WAVE = rv.wave || 1100, AMP = rv.amp || 170;
      for (let a = a0; a <= a1 + 1e-6; a += STEP) {
        // (phaseFrom: a river cut short at its head keeps the meanders of the
        // whole river it was cut from; a copy's river starts downstream)
        const ph = (a - (rv.phaseFrom != null ? rv.phaseFrom : a0)) / WAVE * Math.PI * 2;
        let off = Math.sin(ph + h01(seed, 3, 5, 61) * 6.28) * AMP * (0.7 + 0.3 * vnoise(seed, a, 0, 1500, 62))
                + (vnoise(seed, a, 17, 700, 63) - 0.5) * AMP * 0.6;
        // pinned where the caller asks (a crossing the plan must honour)
        if (rv.pins) for (const pin of rv.pins) {
          const w = Math.exp(-Math.pow((a - pin.a) / (pin.r || 400), 2));
          off = lerp(off, pin.off || 0, w);
        }
        const p = along === "z" ? { x: base + off, z: a } : { x: a, z: base + off };
        pts.push(p);
      }
      P.river = { pts: pts, half: half, along: along, name: rv.name || "River", bank: half + 16 };
      if (rv.island) riverIsland(rv.island, pts, half, along, a0, STEP);
    }
    // AN ISLAND IN THE RIVER (the park island a riverfront downtown looks
    // across at): the river splits into two arms round it. One bank (`keep`)
    // does not move, so the riverfront avenue on it stays where it is; the
    // island and the far arm push into the other bank. The water is then
    // FOUR channels (main above, the two arms, main below), overlapping where
    // the arms meet the main river, and riverDist() below measures to the
    // nearest channel EDGE (returned as distance-to-centreline for a river
    // of the plan's own half width, so every caller's `< half + pad` test is
    // unchanged).
    function riverIsland(I, pts, half, along, a0, STEP) {
      const T = I.ramp || 150, arm = I.arm || 40, ih = I.half || 80;
      const sg = (I.keep === "east" || I.keep === "south") ? 1 : -1;
      const keptOff = sg * (half - arm), islandOff = keptOff - sg * (arm + ih), farOff = islandOff - sg * (ih + arm);
      const aOf = function (p) { return along === "z" ? p.z : p.x; };
      const perpOf = function (p) { return along === "z" ? p.x : p.z; };
      const lo = aOf(pts[0]), hi = aOf(pts[pts.length - 1]);
      if (!(I.a0 - T > lo + STEP && I.a1 + T < hi - STEP)) return;
      function cAt(a) {
        const f = clamp((a - a0) / STEP, 0, pts.length - 1.0001), i = Math.floor(f), t = f - i;
        return lerp(perpOf(pts[i]), perpOf(pts[i + 1]), t);
      }
      function sAt(a) {
        if (a <= I.a0 - T || a >= I.a1 + T) return 0;
        if (a < I.a0) return smooth((a - (I.a0 - T)) / T);
        if (a > I.a1) return smooth((I.a1 + T - a) / T);
        return 1;
      }
      const P2 = function (a, off) { const c = cAt(a) + off; return along === "z" ? { x: r2(c), z: a } : { x: a, z: r2(c) }; };
      const main1 = [], main2 = [];
      for (const p of pts) { const a = aOf(p); if (a <= I.a0 - T + STEP) main1.push(p); if (a >= I.a1 + T - STEP) main2.push(p); }
      const kept = [], far = [], hk = [], hf = [];
      for (let a = I.a0 - T; a <= I.a1 + T + 1e-6; a += 30) {
        const s = sAt(a);
        kept.push(P2(a, s * keptOff)); hk.push(lerp(half, arm, s));
        far.push(P2(a, s * farOff)); hf.push(lerp(half, arm, s));
      }
      const full = function (list) { return list.map(function () { return half; }); };
      P.river.channels = [
        { pts: main1, half: full(main1) }, { pts: kept, half: hk }, { pts: far, half: hf }, { pts: main2, half: full(main2) },
      ];
      P.river.island = { a0: I.a0, a1: I.a1, T: T, off: islandOff, half: ih, cAt: cAt, sAt: sAt, name: I.name || "Island" };
    }
    function islandHit(x0, z0, x1, z1, pad) {
      const I = P.river && P.river.island;
      if (!I) return null;
      const al = P.river.along;
      const A0 = al === "z" ? z0 : x0, A1 = al === "z" ? z1 : x1;
      if (A1 < I.a0 - I.T || A0 > I.a1 + I.T) return null;
      const a = clamp((A0 + A1) / 2, I.a0 - I.T, I.a1 + I.T);
      const s = I.sAt(a); if (s <= 0.05) return null;
      const c = I.cAt(a) + s * I.off, h = s * I.half + (pad || 0);
      const Q0 = al === "z" ? x0 : z0, Q1 = al === "z" ? x1 : z1;
      return (Q1 > c - h && Q0 < c + h) ? { name: I.name } : null;
    }
    // river query: distance to the centreline polyline (bucketed)
    const rBuckets = new Map();
    const RB = 120;
    if (P.river) {
      const pts = P.river.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const minx = Math.floor((Math.min(a.x, b.x) - 400) / RB), maxx = Math.floor((Math.max(a.x, b.x) + 400) / RB);
        const minz = Math.floor((Math.min(a.z, b.z) - 400) / RB), maxz = Math.floor((Math.max(a.z, b.z) + 400) / RB);
        for (let ix = minx; ix <= maxx; ix++) for (let iz = minz; iz <= maxz; iz++) {
          const k = ix * 100003 + iz; let l = rBuckets.get(k); if (!l) rBuckets.set(k, l = []); l.push(i);
        }
      }
    }
    // an island river: the same buckets over every channel segment
    const chBuckets = new Map();
    if (P.river && P.river.channels) {
      P.river.channels.forEach(function (ch, ci) {
        const pts = ch.pts;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const minx = Math.floor((Math.min(a.x, b.x) - 400) / RB), maxx = Math.floor((Math.max(a.x, b.x) + 400) / RB);
          const minz = Math.floor((Math.min(a.z, b.z) - 400) / RB), maxz = Math.floor((Math.max(a.z, b.z) + 400) / RB);
          for (let ix = minx; ix <= maxx; ix++) for (let iz = minz; iz <= maxz; iz++) {
            const k = ix * 100003 + iz; let l = chBuckets.get(k); if (!l) chBuckets.set(k, l = []); l.push(ci, i);
          }
        }
      });
    }
    function channelDist(x, z) {
      const l = chBuckets.get(Math.floor(x / RB) * 100003 + Math.floor(z / RB));
      if (!l) return 1e9;
      const C = P.river.channels; let best = 1e9;
      for (let k = 0; k < l.length; k += 2) {
        const ch = C[l[k]], i = l[k + 1], a = ch.pts[i], b = ch.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0; t = clamp(t, 0, 1);
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - lerp(ch.half[i], ch.half[i + 1], t);
        if (d < best) best = d;
      }
      return best + P.river.half;
    }
    function riverDist(x, z) {
      if (!P.river) return 1e9;
      if (P.river.channels) return channelDist(x, z);
      const l = rBuckets.get(Math.floor(x / RB) * 100003 + Math.floor(z / RB));
      if (!l) return 1e9;
      const pts = P.river.pts; let best = 1e9;
      for (let k = 0; k < l.length; k++) { const i = l[k]; const d = segDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z); if (d < best) best = d; }
      return best;
    }
    P.riverDist = riverDist;
    function wet(x, z, pad) { return riverDist(x, z) < (P.river ? P.river.half + (pad || 0) : -1); }

    // ---------------------------------------------------------------
    // 3. THE RAIL LINE: straight, along the axis the river does NOT take,
    //    through the industrial belt south of the core
    // ---------------------------------------------------------------
    if (spec.rail) {
      const rl = spec.rail;
      const axis = rl.axis || (P.river && P.river.along === "z" ? "x" : "z");
      const at = rl.at;
      const a0 = axis === "x" ? B.minX : B.minZ, a1 = axis === "x" ? B.maxX : B.maxZ;
      P.rail.push({ axis: axis, at: at, a0: a0, a1: a1, half: rl.tracks ? rl.tracks * 2.5 + 4 : 9, tracks: rl.tracks || 2 });
      // a freight YARD alongside the main line (many tracks over a stretch):
      // a rail of its own to everything that reads P.rail, never a station
      if (rl.yard) {
        const Y = rl.yard, tr = Y.tracks || 6, yh = tr * 2.5 + 4, mh = P.rail[0].half;
        P.rail.push({ axis: axis, at: at + (Y.side || -1) * (mh + yh + 3), a0: Math.max(a0, Y.from), a1: Math.min(a1, Y.to), half: yh, tracks: tr, yard: true });
      }
    }
    function railHit(x0, z0, x1, z1, pad) {
      for (const r of P.rail) {
        const p = r.half + (pad || 0);
        if (r.axis === "x") { if (z1 > r.at - p && z0 < r.at + p && x1 > r.a0 && x0 < r.a1) return r; }
        else if (x1 > r.at - p && x0 < r.at + p && z1 > r.a0 && z0 < r.a1) return r;
      }
      return null;
    }

    // corridor helpers (freeways from the highway table)
    function corridorHit(x0, z0, x1, z1, pad) {
      for (const c of corridors) {
        const p = c.half + (pad || 0);
        if (c.ax === "x") { if (x1 > c.at - p && x0 < c.at + p && z1 > c.a0 - p && z0 < c.a1 + p) return c; }
        else if (z1 > c.at - p && z0 < c.at + p && x1 > c.a0 - p && x0 < c.a1 + p) return c;
      }
      return null;
    }
    function obstacleHit(x0, z0, x1, z1) {
      for (const o of obstacles) if (rectHit(o, x0, z0, x1, z1)) return o;
      return null;
    }
    function coreHit(x0, z0, x1, z1, pad) {
      for (const c of cores) if (rectHit(padRect(c, pad || 0), x0, z0, x1, z1)) return c;
      return null;
    }
    function blocked(x0, z0, x1, z1, pad) {
      return obstacleHit(x0 - (pad || 0), z0 - (pad || 0), x1 + (pad || 0), z1 + (pad || 0))
        || corridorHit(x0, z0, x1, z1, 10 + (pad || 0))
        || coreHit(x0, z0, x1, z1, 6 + (pad || 0))
        || railHit(x0, z0, x1, z1, 2 + (pad || 0))
        || (P.river && boxWet(x0, z0, x1, z1, 12 + (pad || 0)))
        || (P.stations.length && stationHit(x0, z0, x1, z1, 4 + (pad || 0)))
        || (P.river && P.river.island && islandHit(x0, z0, x1, z1, 10 + (pad || 0)))
        || (x0 < B.minX || x1 > B.maxX || z0 < B.minZ || z1 > B.maxZ ? { name: "bounds" } : null);
    }
    function boxWet(x0, z0, x1, z1, pad) {
      if (!P.river) return null;
      const cxx = (x0 + x1) / 2, czz = (z0 + z1) / 2, hr = Math.hypot(x1 - x0, z1 - z0) / 2;
      const d = riverDist(cxx, czz);
      if (d - hr > P.river.half + pad) return null;
      // sample the box (corners + centre + edge midpoints)
      const s = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cxx, czz], [cxx, z0], [cxx, z1], [x0, czz], [x1, czz]];
      for (const q of s) if (riverDist(q[0], q[1]) < P.river.half + pad) return { name: "river" };
      if (d < P.river.half + pad) return { name: "river" };
      return null;
    }
    P.blocked = blocked;
    // THE STATION is placed before any street: the platforms own their ground
    // the station: where the rail passes closest to the CBD
    for (const r of P.rail) {
      if (r.yard) continue;
      const sx = r.axis === "x" ? clamp(cx, r.a0 + 200, r.a1 - 200) : r.at, sz = r.axis === "x" ? r.at : clamp(cz, r.a0 + 200, r.a1 - 200);
      // slide it off any street and any freeway
      let best = null, bd = 1e9;
      for (let k = -8; k <= 8; k++) {
        const x = r.axis === "x" ? sx + k * 40 : sx, z = r.axis === "x" ? sz : sz + k * 40;
        const w = r.axis === "x" ? 190 : 40, d = r.axis === "x" ? 40 : 190;
        if (corridorHit(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 20)) continue;
        if (P.river && boxWet(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 20)) continue;
        if (obstacleHit(x - w / 2, z - d / 2, x + w / 2, z + d / 2) || coreHit(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 10)) continue;
        const dd = Math.abs(k);
        if (dd < bd) { bd = dd; best = { x: x, z: z, w: w, d: d }; }
      }
      if (best) {
        P.stations.push({ x: best.x, z: best.z, w: best.w, d: best.d, axis: r.axis, name: P.name + " Union Station" });
        P.landmarks.push({ kind: "station", x: best.x, z: best.z, name: P.name + " Union Station" });
      }
    }
    function stationHit(x0, z0, x1, z1, pad) {
      pad = pad || 0;
      for (const st of P.stations) if (!(x1 <= st.x - st.w / 2 - pad || x0 >= st.x + st.w / 2 + pad || z1 <= st.z - st.d / 2 - pad || z0 >= st.z + st.d / 2 + pad)) return st;
      return null;
    }
    // how close a local street may come to a FREEWAY: the arterials cross it
    // on 90 m ramps, and a junction on a ramp is not a junction
    function nearFreeway(x, z, d) {
      for (const c of corridors) {
        if (c.grade) continue;
        if (c.ax === "x" ? (Math.abs(x - c.at) < c.half + d && z > c.a0 - d && z < c.a1 + d) : (Math.abs(z - c.at) < c.half + d && x > c.a0 - d && x < c.a1 + d)) return true;
      }
      return false;
    }

    // ---------------------------------------------------------------
    // 4. SUPERBLOCK CELLS + ZONING
    // ---------------------------------------------------------------
    const cells = [];
    const NX = xs.length - 1, NZ = zs.length - 1;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const e = envelope(mx, mz), L = landValue(mx, mz);
      const c = { i: i, j: j, x0: x0, x1: x1, z0: z0, z1: z1, cx: mx, cz: mz, e: e, L: L, use: null, dist: -1, tpl: 0 };
      // fraction of the cell that is buildable (obstacles, corridors, cores, river)
      let free = 0, tot = 0;
      for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
        const px = x0 + (a + 0.5) * (x1 - x0) / 5, pz = z0 + (b + 0.5) * (z1 - z0) / 5;
        tot++;
        if (!blocked(px - 4, pz - 4, px + 4, pz + 4, 0)) free++;
      }
      c.free = free / tot;
      cells.push(c);
    }
    function cellAt(i, j) { return (i < 0 || j < 0 || i >= NX || j >= NZ) ? null : cells[i * NZ + j]; }
    P.cellAt = cellAt; P.NX = NX; P.NZ = NZ;
    // the industrial field: along the rail and downstream on the river,
    // never in the core, never out in the fields
    function industrialScore(c) {
      let s = 0;
      for (const r of P.rail) {
        const d = r.axis === "x" ? Math.abs(c.cz - r.at) : Math.abs(c.cx - r.at);
        if (d < A * 0.8) s += 0.55 * (1 - d / (A * 0.8));
      }
      if (P.river && spec.port) {
        const d = Math.hypot(c.cx - spec.port.x, c.cz - spec.port.z);
        if (d < spec.port.r) s += 0.7 * (1 - d / spec.port.r);
      }
      // a FREEWAY pulls warehouses to it (trucks); an ordinary road does not
      let fw = 0;
      for (const cr of corridors) {
        if (cr.grade) continue;
        const d = cr.ax === "x" ? Math.abs(c.cx - cr.at) : Math.abs(c.cz - cr.at);
        if (d < A * 0.6) fw = 0.18;
      }
      s += fw;
      s += (h01(seed, c.i, c.j, 71) - 0.5) * 0.3;
      if (c.L > 0.62 || c.e > 1.1) s -= 1;
      return s;
    }
    const minFree = 0.18;
    for (const c of cells) {
      if (c.free < minFree) { c.use = "void"; continue; }
      const L = c.L, e = c.e;
      if (e > 1.45) { c.use = h01(seed, c.i, c.j, 73) < 0.75 ? "farm" : "void"; continue; }
      if (e > 1.12) { c.use = h01(seed, c.i, c.j, 74) < 0.55 ? "exurb" : "farm"; continue; }
      if (spec.tier !== "town" && industrialScore(c) > (DET ? 0.36 : 0.42)) { c.use = "industrial"; continue; }
      if (L > 0.80) c.use = "cbd";
      else if (L > 0.62) c.use = "midtown";
      else if (L > 0.47) c.use = "inner";
      else if (L > 0.33) c.use = "rows";
      else c.use = "suburb";
    }
    // a town has no CBD towers: its best cells are its main street
    if (spec.tier === "town") for (const c of cells) if (c.use === "cbd" || c.use === "midtown") c.use = "inner";
    if (spec.tier === "city") for (const c of cells) if (c.use === "cbd" && c.L < 0.86) c.use = "midtown";
    // UNDER A CEILING the band is what the height allows: a tower district
    // that may only rise 7 storeys is a walk-up district, not stubby towers
    if (ceilAt) for (const c of cells) {
      const cap = c.cap = ceilAt(c.cx, c.cz);
      if (c.use === "cbd" && cap < 25) c.use = "midtown";
      if (c.use === "midtown" && cap < 9) c.use = "inner";
      if (c.use === "inner" && cap < 4) c.use = "rows";
    }

    // LANDMARK CELLS: the central park, the stadium, the campus, the mall
    // nodes, the station. Each one a deliberate place in the plan, picked
    // from the cells that satisfy it — never scattered.
    function pickCell(filter, score) {
      let best = null, bs = -1e9;
      for (const c of cells) { if (c.spokes || !filter(c)) continue; const s = score(c); if (s > bs) { bs = s; best = c; } }
      return best;
    }
    const full = function (c) { return (c.x1 - c.x0) > A * 0.9 && (c.z1 - c.z0) > A * 0.9; };
    const isBuildUse = function (u) { return u === "cbd" || u === "midtown" || u === "inner" || u === "rows" || u === "suburb"; };
    // THE DETROIT PLAN (1): the radial avenues claim their cells before any
    // landmark does (pickCell skips a cell an avenue runs through)
    if (DET) detroitSpokes();
    if (spec.tier === "metro") {
      const park = pickCell(function (c) { return full(c) && (c.use === "inner" || c.use === "midtown" || c.use === "rows") && c.free > 0.9 && c.e < 0.55; },
        function (c) { return -Math.abs(c.e - 0.34) + h01(seed, c.i, c.j, 81) * 0.1; });
      if (park) { park.use = "park"; park.landmark = "central-park"; }
      const stadium = pickCell(function (c) { return full(c) && (c.use === "rows" || c.use === "inner" || c.use === "industrial") && c.free > 0.85 && corridors.some(function (cr) { return !cr.grade && (cr.ax === "x" ? Math.abs(cr.at - c.cx) < (c.x1 - c.x0) / 2 + 80 : Math.abs(cr.at - c.cz) < (c.z1 - c.z0) / 2 + 80); }); },
        function (c) { return -Math.abs(c.e - 0.5) + h01(seed, c.i, c.j, 82) * 0.1; });
      if (stadium) { stadium.use = "stadium"; stadium.landmark = "stadium"; }
      const campus = pickCell(function (c) { return full(c) && (c.use === "rows" || c.use === "inner") && c.free > 0.9 && c.e > 0.35 && c.e < 0.7; },
        function (c) { return h01(seed, c.i, c.j, 83); });
      if (campus) { campus.use = "campus"; campus.landmark = "university"; }
    }
    if (spec.tier !== "town") {
      // mall nodes: where two arterials meet in the suburbs
      const want = spec.tier === "metro" ? 3 : 1;
      const taken = [];
      for (let k = 0; k < want; k++) {
        const m = pickCell(function (c) {
          if (c.use !== "suburb" || c.free < 0.9 || !full(c)) return false;
          for (const t of taken) if (Math.abs(t.i - c.i) + Math.abs(t.j - c.j) < 4) return false;
          return c.e > 0.45 && c.e < 0.95;
        }, function (c) { return h01(seed, c.i, c.j, 84 + k); });
        if (m) { m.use = "mall"; m.landmark = "mall"; taken.push(m); }
      }
    }
    // neighbourhood parks: one in about every eleventh built cell
    for (const c of cells) {
      if (!c.spokes && (c.use === "rows" || c.use === "inner") && c.free > 0.95 && full(c) && h01(seed, c.i, c.j, 91) < 0.07) { c.use = "park"; c.landmark = "park"; }
    }
    // THE DETROIT PLAN (2): a city of houses. The rowhouse terraces and the
    // curving subdivisions become the grid neighbourhood ("hood": long
    // blocks of detached houses on narrow lots), and every cell an avenue
    // runs through is one too, its avenue lined with a main street.
    if (DET) for (const c of cells) {
      if (c.use === "rows" || c.use === "suburb" || (c.spokes && (c.use === "inner" || c.use === "midtown"))) c.use = "hood";
      // the island's superblocks are mostly water, but they are the city's:
      // the arterials cross them (bridge, island, bridge) and the region
      // holds the island's ground. Nothing else is built on them.
      if (c.use === "void" && P.river && P.river.island && islandHit(c.x0, c.z0, c.x1, c.z1, 0)) c.use = "river";
    }
    P.cells = cells;

    // ---------------------------------------------------------------
    // 5. DISTRICTS: flood-fill connected cells of one class
    // ---------------------------------------------------------------
    const classOf = function (u) {
      if (u === "cbd") return "cbd"; if (u === "midtown") return "midtown";
      if (u === "inner" || u === "campus") return "inner"; if (u === "rows" || u === "park") return "rows";
      if (u === "suburb" || u === "mall") return "suburb"; if (u === "industrial" || u === "stadium") return "industrial";
      if (u === "exurb") return "exurb"; if (u === "farm") return "farm"; if (u === "hood") return "hood"; return null;
    };
    const usedNames = {};
    for (const c of cells) {
      const cl = classOf(c.use);
      if (!cl || c.dist >= 0) continue;
      const id = P.districts.length;
      const q = [c]; c.dist = id; const members = [];
      while (q.length) {
        const d = q.pop(); members.push(d);
        // big districts split: a suburb district tops out at 6 cells so the
        // names mean neighbourhoods, not "the whole west side"
        if (members.length >= (cl === "suburb" || cl === "rows" ? 6 : 10)) continue;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          const n = cellAt(d.i + o[0], d.j + o[1]);
          if (n && n.dist < 0 && classOf(n.use) === cl) { n.dist = id; q.push(n); }
        });
      }
      let sx = 0, sz = 0; for (const m of members) { sx += m.cx; sz += m.cz; }
      const pool = NAME_POOL[cl] || ["District"];
      let name = pool[(h01(seed, c.i, c.j, 101) * pool.length) | 0];
      for (let t = 0; usedNames[name] && t < pool.length; t++) name = pool[(pool.indexOf(name) + 1) % pool.length];
      if (usedNames[name]) name = name + " " + ["North", "South", "East", "West"][(h01(seed, c.i, c.j, 102) * 4) | 0];
      usedNames[name] = true;
      const looks = LOOKS[cl] || LOOKS.inner;
      let look = looks[(h01(seed, c.i, c.j, 103) * looks.length) | 0] || LOOKS.inner[0];
      if (DET) look = detroitLook(cl, members, look);
      P.districts.push({ id: id, name: name, kind: cl, cx: sx / members.length, cz: sz / members.length, cells: members.length, look: look, wealth: 0 });
    }
    for (const d of P.districts) {
      let s = 0, n = 0;
      for (const c of cells) if (c.dist === d.id) { s += c.L; n++; }
      d.wealth = r2(clamp((n ? s / n : 0.3) * 1.2 + (d.kind === "industrial" ? -0.15 : 0), 0.05, 1));
    }

    // ---------------------------------------------------------------
    // 6. STREETS
    // ---------------------------------------------------------------
    let sid = 0;
    function addStreet(k, pts, w, extra) {
      const s = Object.assign({ id: sid++, k: k, w: w, pts: pts }, extra || {});
      P.streets.push(s); return s;
    }
    // ARTERIALS: every line, clipped to where the plan actually builds
    // (cells not void) plus a country-road continuation every other line.
    function lineUse(axis, idx) {
      // which spans of this line border a non-void cell
      const spans = [];
      if (axis === "x") {      // a line at x = xs[idx], running along z
        for (let j = 0; j < NZ; j++) {
          const a = cellAt(idx - 1, j), b = cellAt(idx, j);
          const on = (a && a.use !== "void") || (b && b.use !== "void");
          const rural = !((a && isUrban(a.use)) || (b && isUrban(b.use)));
          spans.push({ a0: zs[j], a1: zs[j + 1], on: on, rural: rural });
        }
      } else {
        for (let i = 0; i < NX; i++) {
          const a = cellAt(i, idx - 1), b = cellAt(i, idx);
          const on = (a && a.use !== "void") || (b && b.use !== "void");
          const rural = !((a && isUrban(a.use)) || (b && isUrban(b.use)));
          spans.push({ a0: xs[i], a1: xs[i + 1], on: on, rural: rural });
        }
      }
      return spans;
    }
    function isUrban(u) { return u && u !== "void" && u !== "farm" && u !== "exurb"; }
    // merge spans into runs; rural runs survive only on every second line
    function runsOf(spans, keepRural) {
      const out = []; let cur = null;
      for (const s of spans) {
        const ok = s.on && (!s.rural || keepRural);
        if (ok) {
          if (cur && Math.abs(cur.a1 - s.a0) < 1e-6 && cur.rural === s.rural) cur.a1 = s.a1;
          else if (cur && Math.abs(cur.a1 - s.a0) < 1e-6) { out.push(cur); cur = { a0: s.a0, a1: s.a1, rural: s.rural }; }
          else { if (cur) out.push(cur); cur = { a0: s.a0, a1: s.a1, rural: s.rural }; }
        } else if (cur) { out.push(cur); cur = null; }
      }
      if (cur) out.push(cur);
      return out;
    }
    const artLines = { x: [], z: [] };
    for (let i = 0; i < xs.length; i++) {
      const keepRural = (i % 2) === 0;
      for (const r of runsOf(lineUse("x", i), keepRural)) artLines.x.push({ at: xs[i], a0: r.a0, a1: r.a1, rural: r.rural, idx: i });
    }
    for (let j = 0; j < zs.length; j++) {
      const keepRural = (j % 2) === 0;
      for (const r of runsOf(lineUse("z", j), keepRural)) artLines.z.push({ at: zs[j], a0: r.a0, a1: r.a1, rural: r.rural, idx: j });
    }
    // merge consecutive urban+rural runs of the same line into one record
    // (but keep the rural flag per span for the width), then cut by the
    // obstacles and cores (an arterial stops at a compound's fence)
    function cutByBlocks(axis, at, a0, a1, half) {
      // returns sub-spans that avoid obstacles/cores (pads included)
      const cuts = [];
      const list = obstacles.concat(cores.map(function (c) { return padRect(c, 8); }));
      for (const o of list) {
        if (axis === "x") { if (at + half > o.minX && at - half < o.maxX) cuts.push([o.minZ, o.maxZ]); }
        else if (at + half > o.minZ && at - half < o.maxZ) cuts.push([o.minX, o.maxX]);
      }
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      const out = []; let s = a0;
      for (const c of cuts) {
        if (c[1] <= s || c[0] >= a1) continue;
        if (c[0] > s + 20) out.push([s, Math.min(c[0], a1)]);
        s = Math.max(s, c[1]);
      }
      if (a1 > s + 20) out.push([s, a1]);
      return out;
    }
    function mkArterials(axis) {
      const list = artLines[axis];
      for (const L of list) {
        const w = L.rural ? tier.rurW : tier.artW;
        for (const span of cutByBlocks(axis, L.at, L.a0, L.a1, w / 2 + 2)) {
          const pts = axis === "x" ? [{ x: L.at, z: span[0] }, { x: L.at, z: span[1] }] : [{ x: span[0], z: L.at }, { x: span[1], z: L.at }];
          addStreet(L.rural ? "rural" : "art", pts, w, { axis: axis, at: L.at, a0: span[0], a1: span[1], lanes: L.rural ? 1 : tier.lanes, line: L.idx });
        }
      }
    }
    mkArterials("x"); mkArterials("z");
    // ONE network: an arterial stub left stranded by a compound's fence (it
    // meets nothing) is not a road anyone could reach, so it is not built
    (function pruneArterials() {
      const S = P.streets, par = S.map(function (_, i) { return i; });
      function f(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
        const a = S[i], b = S[j];
        let touch = false;
        if (a.axis !== b.axis) {
          const v = a.axis === "x" ? a : b, h = a.axis === "x" ? b : a;
          touch = v.at >= h.a0 - 0.5 && v.at <= h.a1 + 0.5 && h.at >= v.a0 - 0.5 && h.at <= v.a1 + 0.5;
        } else touch = Math.abs(a.at - b.at) < 0.5 && a.a0 <= b.a1 + 0.5 && b.a0 <= a.a1 + 0.5;
        if (touch) { const ra = f(i), rb = f(j); if (ra !== rb) par[ra] = rb; }
      }
      const n = {}; for (let i = 0; i < S.length; i++) { const r = f(i); n[r] = (n[r] || 0) + 1; }
      let big = -1, bn = 0; for (const r in n) if (n[r] > bn) { bn = n[r]; big = +r; }
      P.streets = S.filter(function (_, i) { return f(i) === big; });
    })();
    // THE DETROIT PLAN (3): an avenue only runs on across an arterial that
    // is really there (a compound's fence or a freeway can cut one)
    if (DET) detroitSpokesCheck();

    // ---------------------------------------------------------------
    // 7. INSIDE EACH CELL: local grid or suburban curves, then parcels
    // ---------------------------------------------------------------
    const artHalf = tier.artW / 2, locHalf = tier.locW / 2;
    // spatial hash of every street segment (for house clearance + height)
    const SH = 64; const sHash = new Map();
    function hashSeg(s, a, b) {
      const pad = s.w / 2 + 2;
      const minx = Math.floor((Math.min(a.x, b.x) - pad) / SH), maxx = Math.floor((Math.max(a.x, b.x) + pad) / SH);
      const minz = Math.floor((Math.min(a.z, b.z) - pad) / SH), maxz = Math.floor((Math.max(a.z, b.z) + pad) / SH);
      for (let ix = minx; ix <= maxx; ix++) for (let iz = minz; iz <= maxz; iz++) {
        const k = ix * 100003 + iz; let l = sHash.get(k); if (!l) sHash.set(k, l = []); l.push([s, a, b]);
      }
    }
    function roadClear(x, z, r) {
      // distance from (x,z) to the nearest street EDGE minus r (>0 = clear)
      let best = 1e9;
      const ix0 = Math.floor((x - r) / SH), ix1 = Math.floor((x + r) / SH), iz0 = Math.floor((z - r) / SH), iz1 = Math.floor((z + r) / SH);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const l = sHash.get(ix * 100003 + iz); if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const e = l[k];
          const d = segDist(x, z, e[1].x, e[1].z, e[2].x, e[2].z) - e[0].w / 2;
          if (d < best) best = d;
        }
      }
      return best - r;
    }
    P.bulbs = [];
    function hashStreet(s) { for (let i = 0; i < s.pts.length - 1; i++) hashSeg(s, s.pts[i], s.pts[i + 1]); }
    for (const s of P.streets) hashStreet(s);

    // occupancy hash for buildings (oriented boxes as circles + AABB test)
    const OH = 32; const oHash = new Map();
    function occKey(ix, iz) { return ix * 100003 + iz; }
    function occupied(x, z, rad) {
      const ix0 = Math.floor((x - rad - 30) / OH), ix1 = Math.floor((x + rad + 30) / OH);
      const iz0 = Math.floor((z - rad - 30) / OH), iz1 = Math.floor((z + rad + 30) / OH);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const l = oHash.get(occKey(ix, iz)); if (!l) continue;
        for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + rad) return true;
      }
      return false;
    }
    function occupy(x, z, rad) {
      const ix = Math.floor(x / OH), iz = Math.floor(z / OH);
      const k = occKey(ix, iz); let l = oHash.get(k); if (!l) oHash.set(k, l = []); l.push({ x: x, z: z, r: rad });
    }

    let bid = 0;
    function addBldg(b) {
      b.id = bid++;
      b.x = r2(b.x); b.z = r2(b.z); b.w = r2(b.w); b.d = r2(b.d);
      b.h = r2(b.h);
      P.bldgs.push(b);
      return b;
    }
    function look(c) { const d = P.districts[c.dist]; return d ? d.look : LOOKS.inner[0]; }
    function wallOf(c, salt, x, z) {
      const lk = look(c); const ws = lk.walls || [0x999999];
      // A/B alternation along the street with an occasional third: a street
      // reads as one district, never as a copy-paste run
      return ws[(h01(seed, x, z, salt) * ws.length) | 0];
    }

    // --- storey policy: a TABLE keyed on land value, never a clamp -------
    // THE CEILING LAW (city/zoning.js): a district grown round an existing
    // core never out-tops it. spec.zoning.ceiling(x, z) is the core's own
    // height falling with distance; every storey count the table below
    // makes passes through it (a metro's own CBD has no ceiling).
    function storeysFor(use, L, x, z) {
      const st = storeysTable(use, L, x, z);
      return ceilAt ? Math.max(1, Math.min(st, ceilAt(x, z))) : st;
    }
    function storeysTable(use, L, x, z) {
      const r = h01(seed, x, z, 201);
      if (use === "cbd") {
        const t = clamp((L - 0.78) / 0.22, 0, 1);
        const lo = 18 + t * 14, hi = 30 + t * (coreStoreys - 30);
        return Math.round(lerp(lo, hi, Math.pow(r, 1.6)));
      }
      // (the upper bound never drops under the lower one: a midtown or inner
      // parcel on land cheaper than its band's floor came out with zero or
      // NEGATIVE storeys, a lot drawn as a bare parapet ring)
      if (use === "midtown") return Math.round(lerp(8, Math.max(8, 12 + (L - 0.62) / 0.18 * 20), Math.pow(r, 1.4)));
      if (use === "inner") return Math.round(lerp(4, Math.max(4, 6 + (L - 0.47) / 0.15 * 4), r));
      if (use === "rows") return 2 + Math.round(r * r * 2);
      if (use === "suburb") return r < 0.62 ? 1 : 2;
      return 1;
    }

    // --- grid cells: local streets at `pitch`, blocks, parcels -----------
    function localLines(a0, a1, pitch) {
      const inner = [];
      const n = Math.max(0, Math.round((a1 - a0) / pitch) - 1);
      const step = (a1 - a0) / (n + 1);
      for (let k = 1; k <= n; k++) inner.push(a0 + k * step);
      return inner;
    }
    function gridCell(c, pxPitch, pzPitch, kind) {
      const lx = localLines(c.x0, c.x1, pxPitch), lz = localLines(c.z0, c.z1, pzPitch);
      const X = [c.x0].concat(lx, [c.x1]), Z = [c.z0].concat(lz, [c.z1]);
      // local streets (clipped to buildable land)
      for (const x of lx) addLocalRun("x", x, c.z0, c.z1, c);
      for (const z of lz) addLocalRun("z", z, c.x0, c.x1, c);
      // blocks
      for (let a = 0; a < X.length - 1; a++) for (let b = 0; b < Z.length - 1; b++) {
        const hx0 = a === 0 ? artHalf : locHalf, hx1 = a === X.length - 2 ? artHalf : locHalf;
        const hz0 = b === 0 ? artHalf : locHalf, hz1 = b === Z.length - 2 ? artHalf : locHalf;
        const blk = { x0: X[a] + hx0, x1: X[a + 1] - hx1, z0: Z[b] + hz0, z1: Z[b + 1] - hz1, use: kind, dist: c.dist, cell: c.i + "," + c.j };
        if (blk.x1 - blk.x0 < 24 || blk.z1 - blk.z0 < 24) continue;
        if (blocked(blk.x0, blk.z0, blk.x1, blk.z1, 0)) {
          // a partly blocked block keeps its free part if it is still a block
          const sh = shrinkBlock(blk);
          if (!sh) continue;
          blk.x0 = sh.x0; blk.x1 = sh.x1; blk.z0 = sh.z0; blk.z1 = sh.z1; blk.cut = true;
        }
        blk.sw = kind === "cbd" ? 4.5 : kind === "midtown" ? 4 : kind === "industrial" ? 2.5 : 3.2;
        blk.r = kind === "industrial" ? 6 : 5;
        blk.L = landValue((blk.x0 + blk.x1) / 2, (blk.z0 + blk.z1) / 2);
        P.blocks.push(blk);
        fillBlock(blk, c);
      }
    }
    function shrinkBlock(b) {
      // try trimming each side by steps until clear; keep the biggest result
      let best = null, area = 0;
      const W = b.x1 - b.x0, D = b.z1 - b.z0;
      for (let t = 0.1; t <= 0.6; t += 0.1) {
        const cands = [
          { x0: b.x0 + W * t, x1: b.x1, z0: b.z0, z1: b.z1 }, { x0: b.x0, x1: b.x1 - W * t, z0: b.z0, z1: b.z1 },
          { x0: b.x0, x1: b.x1, z0: b.z0 + D * t, z1: b.z1 }, { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 - D * t },
        ];
        for (const q of cands) {
          if (q.x1 - q.x0 < 26 || q.z1 - q.z0 < 26) continue;
          if (blocked(q.x0, q.z0, q.x1, q.z1, 0)) continue;
          const ar = (q.x1 - q.x0) * (q.z1 - q.z0);
          if (ar > area) { area = ar; best = q; }
        }
        if (best) return best;
      }
      return null;
    }
    function addLocalRun(axis, at, a0, a1, c) {
      // clip a local street to buildable land; drop stubs
      const pad = locHalf + 3;
      const step = 8; let s = null;
      const out = [];
      for (let a = a0; a <= a1 + 1e-6; a += step) {
        const aa = Math.min(a, a1);
        const x = axis === "x" ? at : aa, z = axis === "x" ? aa : at;
        const blockedHere = !!(obstacleHit(x - pad, z - pad, x + pad, z + pad) || corridorHit(x - 1, z - 1, x + 1, z + 1, 6)
          || coreHit(x - 1, z - 1, x + 1, z + 1, 4) || wet(x, z, 8) || nearFreeway(x, z, 112)
          || stationHit(x - 1, z - 1, x + 1, z + 1, 8) || (P.river && P.river.island && islandHit(x - 1, z - 1, x + 1, z + 1, 6)) || railHit(x - 1, z - 1, x + 1, z + 1, 0) && axis !== (P.rail[0] && P.rail[0].axis === "x" ? "x" : "z"));
        if (!blockedHere) { if (s == null) s = aa; }
        else if (s != null) { out.push([s, aa - step]); s = null; }
      }
      if (s != null) out.push([s, a1]);
      for (const r of out) {
        if (r[1] - r[0] < 30) continue;
        const pts = axis === "x" ? [{ x: at, z: r[0] }, { x: at, z: r[1] }] : [{ x: r[0], z: at }, { x: r[1], z: at }];
        const st = addStreet("loc", pts, tier.locW, { axis: axis, at: at, a0: r[0], a1: r[1], lanes: 1, cell: c.i + "," + c.j });
        hashStreet(st);
      }
    }

    // --- fill a grid block by use -----------------------------------------
    function fillBlock(blk, c) {
      const u = blk.use;
      const x0 = blk.x0 + blk.sw, x1 = blk.x1 - blk.sw, z0 = blk.z0 + blk.sw, z1 = blk.z1 - blk.sw;
      const W = x1 - x0, D = z1 - z0;
      if (W < 12 || D < 12) return;
      const L = blk.L, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const hh = h01(seed, mx, mz, 301);
      if (u === "cbd") {
        // a plaza now and then — downtown needs breathing room at its base
        if (hh < 0.08) { P.plazas.push({ x0: x0, x1: x1, z0: z0, z1: z1, dist: blk.dist }); treesInRect(x0 + 6, z0 + 6, x1 - 6, z1 - 6, 14, "plaza"); return; }
        // 1, 2 or 4 parcels per block; each a tower on a podium
        const split = hh < 0.35 ? 1 : hh < 0.75 ? 2 : 4;
        const parcels = splitRect(x0, z0, x1, z1, split, hh > 0.55);
        parcels.forEach(function (p, k) {
          const px = (p.x0 + p.x1) / 2, pz = (p.z0 + p.z1) / 2;
          const st = storeysFor("cbd", landValue(px, pz), px, pz);
          tower(p, st, c, blk, k);
        });
        return;
      }
      if (u === "midtown") {
        if (hh < 0.12) { parkingLot(x0, z0, x1, z1, blk.dist); return; }
        const split = hh < 0.5 ? 2 : 4;
        splitRect(x0, z0, x1, z1, split, hh > 0.3).forEach(function (p, k) {
          const px = (p.x0 + p.x1) / 2, pz = (p.z0 + p.z1) / 2;
          const st = storeysFor("midtown", landValue(px, pz), px, pz);
          if (st >= 14) tower(p, st, c, blk, k);
          else slab(p, st, c, "office", 3.9, true);
        });
        return;
      }
      if (u === "inner") { perimeterBlock(blk, x0, z0, x1, z1, c, "apt"); return; }
      if (u === "rows") { rowBlock(blk, x0, z0, x1, z1, c); return; }
      if (u === "industrial") { if (DET) plantBlock(blk, x0, z0, x1, z1, c); else industrialBlock(blk, x0, z0, x1, z1, c); return; }
    }
    function splitRect(x0, z0, x1, z1, n, alongX) {
      if (n <= 1) return [{ x0: x0, z0: z0, x1: x1, z1: z1 }];
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, g = 3;
      if (n === 2) return alongX ? [{ x0: x0, z0: z0, x1: mx - g, z1: z1 }, { x0: mx + g, z0: z0, x1: x1, z1: z1 }]
                                 : [{ x0: x0, z0: z0, x1: x1, z1: mz - g }, { x0: x0, z0: mz + g, x1: x1, z1: z1 }];
      return [{ x0: x0, z0: z0, x1: mx - g, z1: mz - g }, { x0: mx + g, z0: z0, x1: x1, z1: mz - g },
              { x0: x0, z0: mz + g, x1: mx - g, z1: z1 }, { x0: mx + g, z0: mz + g, x1: x1, z1: z1 }];
    }
    function tower(p, st, c, blk, k) {
      const W = p.x1 - p.x0, D = p.z1 - p.z0;
      const x = (p.x0 + p.x1) / 2, z = (p.z0 + p.z1) / 2;
      const fh = 3.9;
      const pod = Math.min(st, 3 + ((h01(seed, x, z, 311) * 3) | 0));
      const tiers = [];
      // podium fills the parcel (street wall), the shaft sets back from it
      tiers.push({ w: W, d: D, y0: 0, y1: pod * fh, x: x, z: z, part: "podium" });
      const sw = W * lerp(0.62, 0.8, h01(seed, x, z, 312)), sd = D * lerp(0.62, 0.8, h01(seed, x, z, 313));
      const shaftTop = st * fh;
      const setbacks = st > 40 ? 2 : st > 24 ? 1 : 0;
      let y = pod * fh, w = sw, d = sd;
      for (let s = 0; s <= setbacks; s++) {
        const frac = setbacks === 0 ? 1 : (s < setbacks ? 0.5 + 0.12 * s : 1);
        const top = s < setbacks ? lerp(y, shaftTop, frac) : shaftTop;
        tiers.push({ w: w, d: d, y0: y, y1: top, x: x, z: z, part: "shaft" });
        y = top; w *= 0.8; d *= 0.8;
      }
      const crown = st >= 50 ? "spire" : st >= 30 ? (h01(seed, x, z, 314) < 0.5 ? "crown" : "flat") : "flat";
      const lk = look(c);
      const older = lk.grammar === "artdeco" || h01(seed, x, z, 315) < 0.2;
      addBldg({ x: x, z: z, w: W, d: D, rot: 0, h: shaftTop, st: st, fh: fh, type: "tower", style: older ? "deco" : "glass",
        wall: older ? wallOf(c, 316, x, z) : lk.walls[(h01(seed, x, z, 317) * lk.walls.length) | 0], glass: lk.glass,
        roof: crown, tiers: tiers, shop: true, dist: c.dist });
      occupy(x, z, Math.hypot(W, D) / 2);
    }
    function slab(p, st, c, type, fh, shop) {
      const W = p.x1 - p.x0, D = p.z1 - p.z0, x = (p.x0 + p.x1) / 2, z = (p.z0 + p.z1) / 2;
      const lk = look(c);
      addBldg({ x: x, z: z, w: W, d: D, rot: 0, h: st * fh, st: st, fh: fh, type: type, style: styleOf(lk),
        wall: wallOf(c, 321, x, z), glass: lk.glass, roof: "flat", shop: !!shop, dist: c.dist });
      occupy(x, z, Math.hypot(W, D) / 2);
    }
    function styleOf(lk) {
      const g = lk.grammar;
      if (g === "intl" || g === "hightech") return "glass";
      if (g === "artdeco") return "deco";
      if (g === "brutalist") return "concrete";
      if (g === "stone" || g === "greekrev") return "stone";
      if (g === "industrial") return "metal";
      if (g === "brickhouse" || g === "victorian" && false) return "row";
      return "brick";
    }
    function perimeterBlock(blk, x0, z0, x1, z1, c, type) {
      // apartment buildings line all four faces, depth 14-16 m, courtyard
      // behind; the corner buildings wrap. Shops on arterial-facing ground
      // floors. Each face is cut into 2-4 buildings with their own heights.
      const depth = 15;
      const W = x1 - x0, D = z1 - z0;
      if (W < 40 || D < 40) { slab({ x0: x0, z0: z0, x1: x1, z1: z1 }, storeysFor("inner", blk.L, x0, z0), c, type, 3.2, true); return; }
      const faces = [
        { x0: x0, x1: x1, z0: z0, z1: z0 + depth, run: "x" },              // south face (full width incl. corners)
        { x0: x0, x1: x1, z0: z1 - depth, z1: z1, run: "x" },              // north face
        { x0: x0, x1: x0 + depth, z0: z0 + depth + 1, z1: z1 - depth - 1, run: "z" },   // west
        { x0: x1 - depth, x1: x1, z0: z0 + depth + 1, z1: z1 - depth - 1, run: "z" },   // east
      ];
      for (const f of faces) {
        const len = f.run === "x" ? f.x1 - f.x0 : f.z1 - f.z0;
        const n = Math.max(1, Math.round(len / lerp(22, 34, h01(seed, f.x0, f.z0, 331))));
        const step = len / n;
        for (let k = 0; k < n; k++) {
          const g = k < n - 1 ? 0.6 : 0;
          const p = f.run === "x" ? { x0: f.x0 + k * step, x1: f.x0 + (k + 1) * step - g, z0: f.z0, z1: f.z1 }
                                  : { x0: f.x0, x1: f.x1, z0: f.z0 + k * step, z1: f.z0 + (k + 1) * step - g };
          const px = (p.x0 + p.x1) / 2, pz = (p.z0 + p.z1) / 2;
          const st = storeysFor("inner", blk.L, px, pz);
          slab(p, st, c, type, 3.2, h01(seed, px, pz, 332) < 0.45);
        }
      }
      // the courtyard gets trees
      treesInRect(x0 + depth + 5, z0 + depth + 5, x1 - depth - 5, z1 - depth - 5, 16, "yard");
    }
    function rowBlock(blk, x0, z0, x1, z1, c) {
      // terraces on the two LONG faces: 5.5-7 m units, 11-13 m deep, a
      // small front step to the sidewalk; back gardens meet in the middle.
      const W = x1 - x0, D = z1 - z0;
      const alongX = W >= D;
      const len = alongX ? W : D, depth = Math.min(13, (alongX ? D : W) / 2 - 6);
      if (depth < 8) { slab({ x0: x0, z0: z0, x1: x1, z1: z1 }, 3, c, "apt", 3.1, true); return; }
      const lk = look(c);
      for (let side = 0; side < 2; side++) {
        let a = 0;
        while (a < len - 5) {
          const uw = lerp(5.5, 7, h01(seed, a + x0, side + z0, 341));
          const a1 = Math.min(len, a + uw);
          if (a1 - a < 4.5) break;
          let p;
          if (alongX) p = side === 0 ? { x0: x0 + a, x1: x0 + a1, z0: z0 + 1.5, z1: z0 + 1.5 + depth } : { x0: x0 + a, x1: x0 + a1, z0: z1 - 1.5 - depth, z1: z1 - 1.5 };
          else p = side === 0 ? { x0: x0 + 1.5, x1: x0 + 1.5 + depth, z0: z0 + a, z1: z0 + a1 } : { x0: x1 - 1.5 - depth, x1: x1 - 1.5, z0: z0 + a, z1: z0 + a1 };
          const px = (p.x0 + p.x1) / 2, pz = (p.z0 + p.z1) / 2;
          // a terrace's height runs in STRETCHES: the same builder did five
          // or six houses at once, then the next one did his
          const stretch = Math.floor(a / 36);
          const st = 2 + Math.round(h01(seed, stretch * 7 + side, blk.x0 + blk.z0, 342) * 1.6);
          const wall = lk.walls[((h01(seed, stretch, blk.z0 + side * 3, 343) * lk.walls.length) | 0)];
          // the corner unit on an arterial is the corner shop
          const corner = (a === 0 || a1 >= len - 0.5);
          const face = alongX ? (side === 0 ? "s" : "n") : (side === 0 ? "w" : "e");
          addBldg({ x: px, z: pz, w: p.x1 - p.x0, d: p.z1 - p.z0, rot: 0, h: st * 3.1 + 0.9, st: st, fh: 3.1, type: "row", style: "row",
            wall: wall, glass: lk.glass, roof: h01(seed, px, pz, 344) < 0.3 ? "mansard" : "flat", shop: corner && h01(seed, px, pz, 345) < 0.6, face: face, dist: c.dist });
          occupy(px, pz, Math.hypot(p.x1 - p.x0, p.z1 - p.z0) / 2 - 1);
          a = a1;
        }
      }
      // back-garden trees down the middle
      if (alongX) treesAlong(x0 + 5, (z0 + z1) / 2, x1 - 5, (z0 + z1) / 2, 17, "yard");
      else treesAlong((x0 + x1) / 2, z0 + 5, (x0 + x1) / 2, z1 - 5, 17, "yard");
      // street trees on the long faces
      if (alongX) { treesAlong(blk.x0 + 4, blk.z0 + 1.2, blk.x1 - 4, blk.z0 + 1.2, 11, "street"); treesAlong(blk.x0 + 4, blk.z1 - 1.2, blk.x1 - 4, blk.z1 - 1.2, 11, "street"); }
      else { treesAlong(blk.x0 + 1.2, blk.z0 + 4, blk.x0 + 1.2, blk.z1 - 4, 11, "street"); treesAlong(blk.x1 - 1.2, blk.z0 + 4, blk.x1 - 1.2, blk.z1 - 4, 11, "street"); }
    }
    function industrialBlock(blk, x0, z0, x1, z1, c) {
      const W = x1 - x0, D = z1 - z0;
      const lk = look(c);
      // one to three sheds with yards between; tanks and silos on some
      const n = W > 150 ? 3 : W > 90 ? 2 : 1;
      const step = W / n;
      for (let k = 0; k < n; k++) {
        const hx = h01(seed, x0 + k, z0, 351);
        const bw = step * lerp(0.62, 0.85, hx), bd = D * lerp(0.5, 0.78, h01(seed, x0 + k, z0, 352));
        const bx = x0 + k * step + step / 2, bz = z0 + bd / 2 + 4;
        const hgt = lerp(8, 14, h01(seed, bx, bz, 353));
        addBldg({ x: bx, z: bz, w: bw, d: bd, rot: 0, h: hgt, st: 1, fh: hgt, type: "ware", style: lk.grammar === "brick" ? "brick" : "metal",
          wall: lk.walls[((h01(seed, bx, bz, 354) * lk.walls.length) | 0)], glass: lk.glass, roof: h01(seed, bx, bz, 355) < 0.4 ? "saw" : "flat", dist: c.dist });
        occupy(bx, bz, Math.hypot(bw, bd) / 2);
        // the yard in front of the dock doors
        P.parking.push({ x0: bx - bw / 2, x1: bx + bw / 2, z0: bz + bd / 2 + 1, z1: Math.min(z1, bz + bd / 2 + 22), kind: "yard", dist: c.dist });
        if (h01(seed, bx, bz, 356) < 0.3) {
          const tx = bx + bw / 2 - 6, tz = z1 - 8;
          if (tz - 7 > bz + bd / 2 + 1) {
            addBldg({ x: tx, z: tz, w: 11, d: 11, rot: 0, h: lerp(9, 16, h01(seed, tx, tz, 357)), st: 1, fh: 10, type: "tank", style: "metal", wall: 0xb8bcbd, roof: "dome", dist: c.dist });
          }
        }
      }
    }
    function parkingLot(x0, z0, x1, z1, dist) {
      P.parking.push({ x0: x0, x1: x1, z0: z0, z1: z1, kind: "lot", dist: dist });
      treesAlong(x0 + 3, z0 + 3, x1 - 3, z0 + 3, 16, "street");
    }

    // --- trees ---------------------------------------------------------------
    // INTENT, not scatter (owner, 2026-09-29: "much much thinner but more
    // intentional"): street trees on the residential streets, rows in the
    // courtyards and back gardens, stands in the parks, one or two in a
    // house's yard. Nothing is sprinkled.
    function treeOK(x, z) {
      if (roadClear(x, z, 1.2) < 0) return false;
      if (occupied(x, z, 2.2)) return false;
      if (P.river && wet(x, z, 6)) return false;
      if (obstacleHit(x - 2, z - 2, x + 2, z + 2) || coreHit(x - 2, z - 2, x + 2, z + 2, 2)) return false;
      if (corridorHit(x - 2, z - 2, x + 2, z + 2, 4)) return false;
      if (railHit(x - 2, z - 2, x + 2, z + 2, 2)) return false;
      return true;
    }
    function addTree(x, z, kind) {
      const s = lerp(0.8, 1.25, h01(seed, x, z, 401));
      P.trees.push({ x: r2(x), z: r2(z), s: r2(s), k: kind });
    }
    function treesAlong(xa, za, xb, zb, spacing, kind) {
      const len = Math.hypot(xb - xa, zb - za); if (len < 2) return;
      const n = Math.max(1, Math.floor(len / spacing));
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n : 0.5;
        const x = lerp(xa, xb, t), z = lerp(za, zb, t);
        if (!treeOK(x, z)) continue;
        addTree(x, z, kind);
      }
    }
    function treesInRect(x0, z0, x1, z1, spacing, kind) {
      if (x1 - x0 < 4 || z1 - z0 < 4) return;
      for (let x = x0; x <= x1; x += spacing) for (let z = z0; z <= z1; z += spacing) {
        const jx = (h01(seed, x, z, 402) - 0.5) * spacing * 0.5, jz = (h01(seed, x, z, 403) - 0.5) * spacing * 0.5;
        if (h01(seed, x, z, 404) < 0.25) continue;
        const tx = clamp(x + jx, x0, x1), tz = clamp(z + jz, z0, z1);
        if (treeOK(tx, tz)) addTree(tx, tz, kind);
      }
    }

    // --- suburban cells: curving streets, loops, cul-de-sacs, houses -------
    function suburbCell(c) {
      const lk = look(c);
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      const W = x1 - x0, D = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: c.use, dist: c.dist, cell: c.i + "," + c.j });
      const tpl = (h01(seed, c.i, c.j, 501) * 3) | 0;
      c.tpl = tpl;
      const cw = tier.colW, lw = tier.locW;
      const streets = [];
      const inset = 62;
      if (tpl === 0) {
        // LOOP: a rounded rectangle ring road, two mouths onto the arterials,
        // two cul-de-sacs into the middle, a pocket park at its heart
        const r = 30;
        const ring = roundedRect(x0 + inset - artHalf, z0 + inset - artHalf, x1 - inset + artHalf, z1 - inset + artHalf, r, 6);
        streets.push(addStreet("col", ring, cw, { closed: true, cell: c.i + "," + c.j }));
        // mouths: from the middle of the south and north ring sides out to the arterials
        streets.push(addStreet("col", [{ x: mx, z: z0 - artHalf }, { x: mx, z: z0 + inset - artHalf }], cw, { cell: c.i + "," + c.j, mouth: true }));
        streets.push(addStreet("col", [{ x: mx, z: z1 - inset + artHalf }, { x: mx, z: z1 + artHalf }], cw, { cell: c.i + "," + c.j, mouth: true }));
        // two cul-de-sacs from the west and east ring sides
        const cdLen = (W - 2 * inset) / 2 - 38;
        if (cdLen > 40) {
          const zA = mz + (h01(seed, c.i, c.j, 502) - 0.5) * 40;
          streets.push(culdesac(x0 + inset - artHalf, zA, 1, 0, cdLen, lw, c));
          const zB = mz - (h01(seed, c.i, c.j, 503) - 0.5) * 40;
          streets.push(culdesac(x1 - inset + artHalf, zB, -1, 0, cdLen, lw, c));
        }
        P.parks.push({ x0: mx - 26, x1: mx + 26, z0: mz - 26, z1: mz + 26, kind: "pocket", dist: c.dist });
        treesInRect(mx - 22, mz - 22, mx + 22, mz + 22, 11, "park");
      } else if (tpl === 1) {
        // LOLLIPOPS: an east-west collector through the middle, cul-de-sacs
        // north and south off it
        const zc = mz + (h01(seed, c.i, c.j, 511) - 0.5) * 50;
        streets.push(addStreet("col", curvePts(c.x0 - artHalf + artHalf, zc, c.x1, zc, 0, 18, c), cw, { cell: c.i + "," + c.j, mouth: true }));
        const n = Math.max(2, Math.round(W / 105));
        for (let k = 0; k < n; k++) {
          const x = x0 + (k + 0.5) * W / n + (h01(seed, c.i + k, c.j, 512) - 0.5) * 16;
          const lenN = (z1 - zc) - 44, lenS = (zc - z0) - 44;
          if (lenN > 40) streets.push(culdesac(x, zc + cw / 2 - 1, 0, 1, lenN, lw, c));
          if (lenS > 40) streets.push(culdesac(x + 20, zc - cw / 2 + 1, 0, -1, lenS, lw, c));
        }
      } else {
        // CURVES: a winding collector across the cell and one winding local
        // crossing it — the post-war subdivision
        const zc = mz + (h01(seed, c.i, c.j, 521) - 0.5) * 60;
        streets.push(addStreet("col", curvePts(c.x0, zc, c.x1, zc, 34, 14, c), cw, { cell: c.i + "," + c.j, mouth: true }));
        const xc = mx + (h01(seed, c.i, c.j, 522) - 0.5) * 60;
        streets.push(addStreet("loc", curvePts(xc, c.z0, xc, c.z1, 28, 14, c, true), lw, { cell: c.i + "," + c.j, mouth: true }));
      }
      for (const s of streets) if (s) hashStreet(s);
      // STRIP MALL at the corner nearest the cell's best arterial junction
      if (c.use === "suburb" && h01(seed, c.i, c.j, 531) < 0.28) stripMall(c, x0, z0, x1, z1);
      // houses along every street of the cell, both sides
      const front = lerp(24, 17, clamp(c.L / 0.33, 0, 1));    // richer = wider lots
      for (const s of streets) if (s) housesAlong(s, c, lk, front);
      for (const b of P.bulbs) if (b.cell === c.i + "," + c.j) housesAroundBulb(b, c, lk);
      // the arterial edge: houses back onto it behind a sound wall
      P.walls.push({ x0: x0 + 2, x1: x1 - 2, z0: z0 + 1.2, z1: z0 + 1.2, h: 2.2, dist: c.dist });
      P.walls.push({ x0: x0 + 2, x1: x1 - 2, z0: z1 - 1.2, z1: z1 - 1.2, h: 2.2, dist: c.dist });
      // street trees along the arterial verges
      treesAlong(x0 + 8, z0 + 4, x1 - 8, z0 + 4, 14, "street");
      treesAlong(x0 + 8, z1 - 4, x1 - 8, z1 - 4, 14, "street");
      treesAlong(x0 + 4, z0 + 8, x0 + 4, z1 - 8, 14, "street");
      treesAlong(x1 - 4, z0 + 8, x1 - 4, z1 - 8, 14, "street");
    }
    function roundedRect(x0, z0, x1, z1, r, seg) {
      const pts = [];
      const cs = [[x1 - r, z0 + r, -Math.PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI]];
      for (const c of cs) for (let k = 0; k <= seg; k++) {
        const a = c[2] + (k / seg) * Math.PI / 2;
        pts.push({ x: c[0] + Math.cos(a) * r, z: c[1] + Math.sin(a) * r });
      }
      pts.push({ x: pts[0].x, z: pts[0].z });
      return pts;
    }
    function curvePts(xa, za, xb, zb, amp, step, c, vertical) {
      const len = Math.hypot(xb - xa, zb - za), n = Math.max(2, Math.ceil(len / step));
      const ph = h01(seed, c.i, c.j, 541) * 6.28, f = 1 + ((h01(seed, c.i, c.j, 542) * 2) | 0);
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        // taper the wiggle to zero at both ends so the mouths meet the
        // arterials square
        const env = Math.sin(t * Math.PI);
        const off = Math.sin(t * Math.PI * f + ph) * amp * env;
        const x = lerp(xa, xb, t) + (vertical ? off : 0), z = lerp(za, zb, t) + (vertical ? 0 : off);
        pts.push({ x: r2(x), z: r2(z) });
      }
      return pts;
    }
    function culdesac(x, z, dx, dz, len, w, c) {
      // a short curving spur ending in a bulb (turning circle r 13)
      const pts = [];
      const n = Math.max(2, Math.ceil(len / 12));
      const bend = (h01(seed, x, z, 551) - 0.5) * 22;
      for (let k = 0; k <= n; k++) {
        const t = k / n, off = Math.sin(t * Math.PI * 0.9) * bend;
        pts.push({ x: r2(x + dx * len * t + (dz !== 0 ? off : 0)), z: r2(z + dz * len * t + (dx !== 0 ? off : 0)) });
      }
      const end = pts[pts.length - 1];
      const bulb = { x: end.x + dx * 6, z: end.z + dz * 6, r: 13, cell: c.i + "," + c.j };
      P.bulbs.push(bulb);
      const st = addStreet("cds", pts, w, { cell: c.i + "," + c.j, bulb: bulb });
      bulb.street = st.id;
      // the turning circle is a street too, for every clearance query
      hashSeg({ w: bulb.r * 2 }, { x: bulb.x, z: bulb.z }, { x: bulb.x + 0.01, z: bulb.z });
      return st;
    }
    function housesAlong(s, c, lk, front) {
      const pts = s.pts; const half = s.w / 2;
      let carry = front * 0.5;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z); if (L < 1e-3) continue;
        const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L, nx = -tz, nz = tx;
        let t = carry;
        while (t < L) {
          const px = a.x + tx * t, pz = a.z + tz * t;
          for (let side = -1; side <= 1; side += 2) placeHouse(px, pz, nx * side, nz * side, half, c, lk, s.id);
          t += front;
        }
        carry = t - L;
      }
    }
    function housesAroundBulb(b, c, lk) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + h01(seed, b.x, b.z, 561);
        const nx = Math.cos(a), nz = Math.sin(a);
        placeHouse(b.x, b.z, nx, nz, b.r, c, lk, b.street);
      }
    }
    function placeHouse(px, pz, nx, nz, half, c, lk, sid) {
      const hx = h01(seed, px * 1.3 + nx, pz * 1.3 + nz, 571);
      const two = hx < (c.L > 0.2 ? 0.45 : 0.3);
      const w = lerp(11, 16, h01(seed, px, pz, 572)), d = lerp(9, 12, h01(seed, pz, px, 573));
      const setback = lerp(7, 10, h01(seed, px, pz, 574));
      const off = half + setback + d / 2;
      const x = px + nx * off, z = pz + nz * off;
      const rad = Math.hypot(w, d) / 2 + 1.5;
      // clear of every street edge, the bulbs, the arterial verge and the pad edge
      if (roadClear(x, z, Math.hypot(w, d) / 2 + 3) < 0) return;
      if (occupied(x, z, rad)) return;
      const cx0 = c.x0 + artHalf + 8, cx1 = c.x1 - artHalf - 8, cz0 = c.z0 + artHalf + 8, cz1 = c.z1 - artHalf - 8;
      if (x - rad < cx0 || x + rad > cx1 || z - rad < cz0 || z + rad > cz1) return;
      if (blocked(x - rad, z - rad, x + rad, z + rad, 2)) return;
      const rot = Math.atan2(-nx, -nz);               // the front faces the street
      const walls = lk.walls, roofs = lk.roofs || [0x444040];
      const st = two ? 2 : 1;
      addBldg({ x: x, z: z, w: w, d: d, rot: r2(rot), h: st * 3.0, st: st, fh: 3.0, type: "house", style: "house",
        wall: walls[(h01(seed, x, z, 575) * walls.length) | 0], roofCol: roofs[(h01(seed, x, z, 576) * roofs.length) | 0],
        roof: h01(seed, x, z, 577) < 0.6 ? "gable" : "hip", garage: h01(seed, x, z, 578) < 0.7, face: "rot", dist: c.dist,
        drive: { x: px + nx * (half + setback * 0.5), z: pz + nz * (half + setback * 0.5) }, street: sid });
      occupy(x, z, rad);
      // one back-yard tree, sometimes two
      const bx = x - nx * (d / 2 + 6), bz = z - nz * (d / 2 + 6);
      if (h01(seed, bx, bz, 579) < 0.7 && treeOK(bx, bz)) { addTree(bx, bz, "yard"); P.trees[P.trees.length - 1].street = sid; }
    }
    function stripMall(c, x0, z0, x1, z1) {
      // the corner at the cell's south-west or north-east (hash): a long one
      // storey row of shops set back behind its car park, facing the arterial
      const corner = (h01(seed, c.i, c.j, 581) * 4) | 0;
      const w = 110, d = 26, park = 44;
      const sx = corner & 1 ? x1 - w / 2 - 4 : x0 + w / 2 + 4;
      const southFace = corner < 2;
      const bz = southFace ? z0 + park + d / 2 : z1 - park - d / 2;
      if (roadClear(sx, bz, Math.hypot(w, d) / 2 + 2) < 0 || occupied(sx, bz, Math.hypot(w, d) / 2)) return;
      addBldg({ x: sx, z: bz, w: w, d: d, rot: 0, h: 6, st: 1, fh: 6, type: "strip", style: "strip", wall: 0xcfc6b4, glass: 0x33424c, roof: "flat", shop: true, face: southFace ? "s" : "n", dist: c.dist });
      occupy(sx, bz, Math.hypot(w, d) / 2);
      P.parking.push({ x0: sx - w / 2, x1: sx + w / 2, z0: southFace ? z0 + 2 : bz + d / 2 + 1, z1: southFace ? bz - d / 2 - 1 : z1 - 2, kind: "lot", dist: c.dist });
      occupy(sx, southFace ? z0 + park / 2 : z1 - park / 2, 30);
    }

    // --- exurb / farm cells --------------------------------------------------
    function exurbCell(c) {
      const lk = LOOKS.suburb[(h01(seed, c.i, c.j, 601) * LOOKS.suburb.length) | 0];
      const x0 = c.x0 + tier.rurW / 2, x1 = c.x1 - tier.rurW / 2, z0 = c.z0 + tier.rurW / 2, z1 = c.z1 - tier.rurW / 2;
      // fields fill the cell; a handful of big-lot houses on the country road
      fieldsIn(c, x0 + 6, z0 + 6, x1 - 6, z1 - 6);
      const n = 3 + ((h01(seed, c.i, c.j, 602) * 5) | 0);
      for (let k = 0; k < n; k++) {
        const side = (h01(seed, c.i + k, c.j, 603) * 4) | 0;
        const t = lerp(0.12, 0.88, h01(seed, c.i, c.j + k, 604));
        let px, pz, nx, nz;
        if (side === 0) { px = lerp(c.x0, c.x1, t); pz = c.z0; nx = 0; nz = 1; }
        else if (side === 1) { px = lerp(c.x0, c.x1, t); pz = c.z1; nx = 0; nz = -1; }
        else if (side === 2) { px = c.x0; pz = lerp(c.z0, c.z1, t); nx = 1; nz = 0; }
        else { px = c.x1; pz = lerp(c.z0, c.z1, t); nx = -1; nz = 0; }
        if (!streetOnLine(side < 2 ? "z" : "x", side < 2 ? pz : px, side < 2 ? px : pz)) continue;
        placeHouse(px, pz, nx, nz, tier.rurW / 2 + 12, c, lk);
      }
      if (h01(seed, c.i, c.j, 605) < 0.45) farmstead(c);
    }
    function streetOnLine(axis, at, a) {
      for (const s of P.streets) {
        if ((s.k !== "art" && s.k !== "rural") || s.axis !== (axis === "z" ? "z" : "x")) continue;
        if (Math.abs(s.at - at) < 0.5 && a >= s.a0 && a <= s.a1) return true;
      }
      return false;
    }
    function fieldsIn(c, x0, z0, x1, z1) {
      // strip fields, alternating crops, split by hedgerows (trees along the
      // splits — the one place a straight tree line is exactly right)
      const along = h01(seed, c.i, c.j, 611) < 0.5;
      const n = 2 + ((h01(seed, c.i, c.j, 612) * 3) | 0);
      for (let k = 0; k < n; k++) {
        const f = along ? { x0: lerp(x0, x1, k / n) + 2, x1: lerp(x0, x1, (k + 1) / n) - 2, z0: z0, z1: z1 }
                        : { x0: x0, x1: x1, z0: lerp(z0, z1, k / n) + 2, z1: lerp(z0, z1, (k + 1) / n) - 2 };
        if (blocked(f.x0, f.z0, f.x1, f.z1, 0)) continue;
        f.crop = (h01(seed, c.i + k, c.j, 613) * 4) | 0; f.dir = along ? "z" : "x";
        P.fields.push(f);
        if (k > 0 && h01(seed, c.i, c.j + k, 614) < 0.6) {
          if (along) treesAlong(f.x0 - 2, z0 + 4, f.x0 - 2, z1 - 4, 9, "hedge");
          else treesAlong(x0 + 4, f.z0 - 2, x1 - 4, f.z0 - 2, 9, "hedge");
        }
      }
    }
    function farmstead(c) {
      const x = lerp(c.x0, c.x1, 0.25 + 0.5 * h01(seed, c.i, c.j, 621)), z = c.z0 + 40;
      if (roadClear(x + 18, z + 4, 36) < 0 || occupied(x + 18, z + 4, 36) || blocked(x - 30, z - 30, x + 60, z + 40, 0)) return;
      addBldg({ x: x, z: z, w: 14, d: 11, rot: 0, h: 6, st: 2, fh: 3, type: "house", style: "house", wall: 0xe8e2d4, roofCol: 0x5a3a2c, roof: "gable", dist: c.dist });
      addBldg({ x: x + 26, z: z + 8, w: 18, d: 26, rot: 0, h: 9, st: 1, fh: 9, type: "barn", style: "barn", wall: 0x8a2e22, roofCol: 0x55565a, roof: "gambrel", dist: c.dist });
      addBldg({ x: x + 42, z: z - 4, w: 7, d: 7, rot: 0, h: 16, st: 1, fh: 16, type: "silo", style: "metal", wall: 0xc9cbc8, roof: "dome", dist: c.dist });
      occupy(x + 18, z + 4, 34);
      treesAlong(x - 14, z - 14, x + 50, z - 14, 10, "hedge");
    }

    // --- landmark cells -----------------------------------------------------
    function parkCell(c) {
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: "park", dist: c.dist, cell: c.i + "," + c.j });
      P.parks.push({ x0: x0, x1: x1, z0: z0, z1: z1, kind: c.landmark === "central-park" ? "central" : "park", dist: c.dist });
      // stands of trees, a lawn in the middle, a tree-lined perimeter walk
      treesAlong(x0 + 6, z0 + 6, x1 - 6, z0 + 6, 12, "avenue"); treesAlong(x0 + 6, z1 - 6, x1 - 6, z1 - 6, 12, "avenue");
      treesAlong(x0 + 6, z0 + 18, x0 + 6, z1 - 18, 12, "avenue"); treesAlong(x1 - 6, z0 + 18, x1 - 6, z1 - 18, 12, "avenue");
      const stands = c.landmark === "central-park" ? 7 : 3;
      for (let k = 0; k < stands; k++) {
        const sx = lerp(x0 + 40, x1 - 40, h01(seed, c.i + k, c.j, 701)), sz = lerp(z0 + 40, z1 - 40, h01(seed, c.i, c.j + k, 702));
        const R = lerp(22, 44, h01(seed, sx, sz, 703));
        for (let t = 0; t < R * 0.9; t++) {
          const a = h01(seed, sx + t, sz, 704) * 6.283, rr = Math.sqrt(h01(seed, sx, sz + t, 705)) * R;
          const tx = sx + Math.cos(a) * rr, tz = sz + Math.sin(a) * rr;
          if (treeOK(tx, tz)) addTree(tx, tz, "park");
        }
      }
      if (c.landmark === "central-park") {
        P.landmarks.push({ kind: "central-park", x: c.cx, z: c.cz, name: "Central Park" });
        // the bandshell and the boathouse-less pavilion, and a ballfield
        addBldg({ x: c.cx, z: z0 + 30, w: 22, d: 12, rot: 0, h: 7, st: 1, fh: 7, type: "pavilion", style: "stone", wall: 0xd8d0bf, roof: "gable", roofCol: 0x4a4540, dist: c.dist });
        occupy(c.cx, z0 + 30, 14);
        P.fields.push({ x0: x1 - 110, x1: x1 - 20, z0: z1 - 110, z1: z1 - 20, crop: 9, dir: "x", ballfield: true });
      }
    }
    function stadiumCell(c) {
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: "stadium", dist: c.dist, cell: c.i + "," + c.j });
      let x = c.cx, z = c.cz;
      // the bowl slides off a freeway that runs through its superblock
      // (only ever when it would stand on one: a clear centre never moves)
      if (blocked(x - 115, z - 95, x + 115, z + 95, 4)) {
        search: for (let k = 1; k <= 12; k++) for (const o of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const qx = c.cx + o[0] * k * 10, qz = c.cz + o[1] * k * 10;
          if (qx - 115 < x0 + 4 || qx + 115 > x1 - 4 || qz - 95 < z0 + 4 || qz + 95 > z1 - 4) continue;
          if (!blocked(qx - 115, qz - 95, qx + 115, qz + 95, 4)) { x = qx; z = qz; break search; }
        }
      }
      addBldg({ x: x, z: z, w: 230, d: 190, rot: 0, h: 34, st: 1, fh: 34, type: "stadium", style: "stadium", wall: 0xc8c6c0, roof: "bowl", dist: c.dist });
      occupy(x, z, 150);
      P.parking.push({ x0: x0 + 6, x1: x1 - 6, z0: z0 + 6, z1: z - 100, kind: "lot", dist: c.dist });
      P.parking.push({ x0: x0 + 6, x1: x1 - 6, z0: z + 100, z1: z1 - 6, kind: "lot", dist: c.dist });
      P.landmarks.push({ kind: "stadium", x: x, z: z, name: P.name + " Stadium" });
    }
    function campusCell(c) {
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: "campus", dist: c.dist, cell: c.i + "," + c.j });
      // the quad: halls around a lawn, a library at its head, a clock tower
      const qx0 = c.cx - 90, qx1 = c.cx + 90, qz0 = c.cz - 70, qz1 = c.cz + 70;
      P.parks.push({ x0: qx0 + 22, x1: qx1 - 22, z0: qz0 + 22, z1: qz1 - 22, kind: "quad", dist: c.dist });
      const halls = [
        { x: c.cx, z: qz1 + 4, w: 70, d: 24, st: 4 },
        { x: qx0 - 6, z: c.cz, w: 22, d: 100, st: 3 }, { x: qx1 + 6, z: c.cz, w: 22, d: 100, st: 3 },
        { x: c.cx - 60, z: qz0 - 6, w: 60, d: 22, st: 3 }, { x: c.cx + 60, z: qz0 - 6, w: 60, d: 22, st: 3 },
        { x: x0 + 50, z: z0 + 40, w: 50, d: 30, st: 5 }, { x: x1 - 50, z: z1 - 40, w: 50, d: 30, st: 5 },
        { x: x0 + 50, z: z1 - 40, w: 44, d: 26, st: 4 }, { x: x1 - 50, z: z0 + 40, w: 44, d: 26, st: 4 },
      ];
      for (const hl of halls) {
        addBldg({ x: hl.x, z: hl.z, w: hl.w, d: hl.d, rot: 0, h: hl.st * 3.8, st: hl.st, fh: 3.8, type: "civic", style: "brick", wall: 0x8a4a34, glass: 0x33414b, roof: hl.st >= 4 ? "gable" : "flat", roofCol: 0x3c4a44, dist: c.dist });
        occupy(hl.x, hl.z, Math.hypot(hl.w, hl.d) / 2);
      }
      addBldg({ x: c.cx, z: qz0 - 8, w: 9, d: 9, rot: 0, h: 38, st: 1, fh: 38, type: "clocktower", style: "brick", wall: 0x8a4a34, roof: "spire", roofCol: 0x3c4a44, dist: c.dist });
      occupy(c.cx, qz0 - 8, 7);
      treesInRect(qx0 + 24, qz0 + 24, qx1 - 24, qz1 - 24, 18, "park");
      treesInRect(x0 + 10, z0 + 10, x1 - 10, z1 - 10, 26, "park");
      P.landmarks.push({ kind: "university", x: c.cx, z: c.cz, name: P.name + " University" });
    }
    function mallCell(c) {
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: "mall", dist: c.dist, cell: c.i + "," + c.j });
      const x = c.cx, z = c.cz;
      // the regional mall: a long two-storey hall with anchor boxes at both
      // ends, an ocean of parking, a ring of out-parcel pads
      addBldg({ x: x, z: z, w: 190, d: 60, rot: 0, h: 12, st: 2, fh: 6, type: "mall", style: "strip", wall: 0xd6cfc0, glass: 0x33424c, roof: "flat", shop: true, dist: c.dist });
      addBldg({ x: x - 118, z: z, w: 46, d: 80, rot: 0, h: 14, st: 2, fh: 7, type: "mall", style: "strip", wall: 0xc7b9a2, glass: 0x33424c, roof: "flat", dist: c.dist });
      addBldg({ x: x + 118, z: z, w: 46, d: 80, rot: 0, h: 14, st: 2, fh: 7, type: "mall", style: "strip", wall: 0xbfc4c6, glass: 0x33424c, roof: "flat", dist: c.dist });
      occupy(x, z, 150);
      P.parking.push({ x0: x0 + 8, x1: x1 - 8, z0: z0 + 8, z1: z - 46, kind: "lot", dist: c.dist });
      P.parking.push({ x0: x0 + 8, x1: x1 - 8, z0: z + 46, z1: z1 - 8, kind: "lot", dist: c.dist });
      P.landmarks.push({ kind: "mall", x: x, z: z, name: (P.districts[c.dist] ? P.districts[c.dist].name : P.name) + " Mall" });
    }

    // a subdivision's curving streets need a whole superblock: one a
    // freeway, the river, the rail or the station runs through is laid out
    // on the grid instead (its streets clip cleanly at whatever cuts it)
    function crossed(c) {
      const x0 = c.x0 + 2, x1 = c.x1 - 2, z0 = c.z0 + 2, z1 = c.z1 - 2;
      const fw = corridors.some(function (cr) {
        if (cr.grade) return false;
        const p = cr.half + 30;
        return cr.ax === "x" ? (x1 > cr.at - p && x0 < cr.at + p && z1 > cr.a0 - p && z0 < cr.a1 + p)
                             : (z1 > cr.at - p && z0 < cr.at + p && x1 > cr.a0 - p && x0 < cr.a1 + p);
      });
      return !!(fw || railHit(x0, z0, x1, z1, 20) || (P.river && boxWet(x0, z0, x1, z1, 30)) || stationHit(x0, z0, x1, z1, 20)
        || obstacleHit(x0 + 60, z0 + 60, x1 - 60, z1 - 60));
    }
    // =================================================================
    //  THE DETROIT PLAN (style "detroit"; nothing below runs for "legacy").
    //  Owner, 2026-09-29: "a real one that has diversity and real facades
    //  and buildings, almost like a New York or Detroit. I like Detroit."
    //  What makes Detroit read as Detroit, as plan:
    //    * the downtown ON the river (the site puts the centre on the bank:
    //      the riverfront avenue is the first arterial, the CBD hugs it);
    //    * RADIAL AVENUES fanning out from downtown over the grid, lined
    //      with two-to-five storey brick main streets (the one diagonal
    //      element in an axis-aligned plan: they are pad streets, like the
    //      suburbs' curving collectors, and their buildings are rotated);
    //    * a city of HOUSES: long blocks of detached brick and frame houses
    //      on narrow lots, elm-lined, with some lots empty and some houses
    //      boarded;
    //    * AUTO-PLANT INDUSTRY: one plant per superblock along the rail and
    //      the river (a multi-storey concrete-and-brick factory on the
    //      street, a sawtooth assembly hall behind it, the powerhouse and
    //      its stacks), a freight yard, grain elevators by the water;
    //    * a park ISLAND in the river, and an elevated downtown LOOP.
    // =================================================================
    const SPOKE_W = 26;
    function cellOf(x, z) {
      let i = -1, j = -1;
      for (let k = 0; k + 1 < xs.length; k++) if (x >= xs[k] && x < xs[k + 1]) { i = k; break; }
      for (let k = 0; k + 1 < zs.length; k++) if (z >= zs[k] && z < zs[k + 1]) { j = k; break; }
      return i < 0 || j < 0 ? null : cellAt(i, j);
    }
    function nodeDist(p) {
      // how far a crossing point sits from the nearest junction on its line
      let onX = false;
      for (const x of xs) if (Math.abs(p.x - x) < 0.01) onX = true;
      let best = 1e9;
      if (onX) for (const z of zs) best = Math.min(best, Math.abs(p.z - z));
      else for (const x of xs) best = Math.min(best, Math.abs(p.x - x));
      return best;
    }
    function spokeOK(c) {
      const u = c.use;
      return (u === "inner" || u === "midtown" || u === "rows" || u === "suburb") && c.free > 0.9
        && (c.x1 - c.x0) > A * 0.8 && (c.z1 - c.z0) > A * 0.8 && !crossed(c);
    }
    function traceSpoke(hub, th) {
      const dx = Math.cos(th), dz = -Math.sin(th);
      const ts = [];
      for (const x of xs) if (Math.abs(dx) > 1e-6) { const t = (x - hub.x) / dx; if (t > 1) ts.push(t); }
      for (const z of zs) if (Math.abs(dz) > 1e-6) { const t = (z - hub.z) / dz; if (t > 1) ts.push(t); }
      ts.sort(function (a, b) { return a - b; });
      const segs = []; let clear = 1e9, len = 0, started = false;
      for (let q = 0; q + 1 < ts.length; q++) {
        const ta = ts[q], tb = ts[q + 1];
        if (tb - ta < 1e-3) return null;                  // through a junction: no
        const tm = (ta + tb) / 2, c = cellOf(hub.x + dx * tm, hub.z + dz * tm);
        if (!c) break;
        if (c.use === "cbd") { if (!started) continue; break; }
        if (!spokeOK(c)) break;
        if (tb - ta < 110) break;                          // a clipped corner is not a block
        started = true;
        const pa = { x: hub.x + dx * ta, z: hub.z + dz * ta }, pb = { x: hub.x + dx * tb, z: hub.z + dz * tb };
        clear = Math.min(clear, nodeDist(pa), nodeDist(pb));
        segs.push({ c: c, pa: pa, pb: pb });
        len += tb - ta;
      }
      return segs.length ? { segs: segs, len: len, clear: clear } : null;
    }
    function detroitSpokes() {
      const hub = spec.hub || { x: cx, z: cz };
      const angs = spec.spokes || [72, 42, 12, -38, -68];
      P.spokes = [];
      angs.forEach(function (deg, k) {
        let best = null;
        for (let d = -9; d <= 9.001; d += 0.5) {
          const tr = traceSpoke(hub, (deg + d) * Math.PI / 180);
          if (!tr || tr.clear < 55) continue;
          // the longest avenue, nearest the asked bearing, clear of junctions
          const sc = tr.len - Math.abs(d) * 6 + Math.min(tr.clear, 120);
          if (!best || sc > best.sc) { best = tr; best.sc = sc; best.deg = deg + d; }
        }
        if (!best || best.len < 380) return;
        for (const sg of best.segs) (sg.c.spokes = sg.c.spokes || []).push({ pa: sg.pa, pb: sg.pb, k: k });
        P.spokes.push({ k: k, deg: r2(best.deg), segs: best.segs });
      });
    }
    function arterialAt(p) {
      for (const s of P.streets) {
        if ((s.k !== "art" && s.k !== "rural") || !s.axis) continue;
        if (s.axis === "x" ? (Math.abs(p.x - s.at) < 0.5 && p.z >= s.a0 - 0.5 && p.z <= s.a1 + 0.5)
                           : (Math.abs(p.z - s.at) < 0.5 && p.x >= s.a0 - 0.5 && p.x <= s.a1 + 0.5)) return s;
      }
      return null;
    }
    function detroitSpokesCheck() {
      for (const sp of P.spokes || []) {
        let n = 0;
        while (n < sp.segs.length && arterialAt(sp.segs[n].pa) && arterialAt(sp.segs[n].pb)) n++;
        for (let q = n; q < sp.segs.length; q++) {
          const c = sp.segs[q].c;
          c.spokes = c.spokes.filter(function (e) { return e.k !== sp.k; });
          if (!c.spokes.length) delete c.spokes;
        }
        sp.segs = sp.segs.slice(0, n);
      }
      P.spokes = (P.spokes || []).filter(function (sp) { return sp.segs.length; }).map(function (sp) {
        let len = 0; for (const g of sp.segs) len += Math.hypot(g.pb.x - g.pa.x, g.pb.z - g.pa.z);
        return { k: sp.k, deg: sp.deg, len: Math.round(len), cells: sp.segs.length,
          from: { x: r2(sp.segs[0].pa.x), z: r2(sp.segs[0].pa.z) }, to: { x: r2(sp.segs[sp.segs.length - 1].pb.x), z: r2(sp.segs[sp.segs.length - 1].pb.z) } };
      });
    }
    function detroitLook(cl, members, look) {
      const h = h01(seed, members[0].i, members[0].j, 104);
      if (cl === "cbd") return LOOKS.cbd[2];                                   // stone and terracotta
      if (cl === "midtown") return h < 0.5 ? LOOKS.midtown[1] : LOOKS.midtown[2];
      if (cl === "inner") return h < 0.6 ? LOOKS.inner[0] : LOOKS.inner[1];     // brick and buff walk-ups
      if (cl === "industrial") return LOOKS.industrial[1];
      if (cl === "hood") {
        let e = 0; for (const m of members) e += m.e;
        return e / members.length < 0.74 ? LOOKS.hood[0] : LOOKS.hood[1];
      }
      return look;
    }
    // ---- a neighbourhood: long blocks, narrow lots, the avenue's main street
    function hoodCell(c) {
      const key = c.i + "," + c.j;
      const x0 = c.x0 + artHalf, x1 = c.x1 - artHalf, z0 = c.z0 + artHalf, z1 = c.z1 - artHalf;
      P.pads.push({ x0: x0, x1: x1, z0: z0, z1: z1, use: "hood", dist: c.dist, cell: key });
      const avenues = [];
      for (const sp of c.spokes || []) {
        const s = addStreet("col", [{ x: r2(sp.pa.x), z: r2(sp.pa.z) }, { x: r2(sp.pb.x), z: r2(sp.pb.z) }], SPOKE_W,
          { cell: key, mouth: true, avenue: true, spoke: sp.k });
        hashStreet(s); avenues.push(s);
      }
      // the residential streets run the way the avenue crosses most squarely
      let alongX = h01(seed, c.i, c.j, 801) < 0.5;
      if (avenues.length) { const a = avenues[0].pts; alongX = Math.abs(a[1].z - a[0].z) > Math.abs(a[1].x - a[0].x); }
      const span = alongX ? (c.z1 - c.z0) : (c.x1 - c.x0);
      const n = Math.max(2, Math.round(span / lerp(76, 90, h01(seed, c.i, c.j, 802))));
      const grid = [];
      for (let k = 1; k < n; k++) {
        const v = r2((alongX ? c.z0 : c.x0) + k * span / n);
        const pts = alongX ? [{ x: c.x0, z: v }, { x: c.x1, z: v }] : [{ x: v, z: c.z0 }, { x: v, z: c.z1 }];
        const s = addStreet("loc", pts, tier.locW - 1, { cell: key, mouth: true });
        hashStreet(s); grid.push(s);
      }
      // the avenue's trees first (between kerb and sidewalk), then its shops
      for (const s of avenues) {
        const a = s.pts[0], b = s.pts[1], L = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
        const off = s.w / 2 + 1.3;
        for (let side = -1; side <= 1; side += 2) treesAlong(a.x + tx * 16 - tz * off * side, a.z + tz * 16 + tx * off * side,
          b.x - tx * 16 - tz * off * side, b.z - tz * 16 + tx * off * side, 12, "avenue");
      }
      for (const s of avenues) mainStreet(s, c);
      const brick = look(c).id === "hood-brick";
      for (const s of grid) {
        housesAlongD(s, c, brick);
        const a = s.pts[0], b = s.pts[1], off = s.w / 2 + 1.1;
        if (alongX) { treesAlong(a.x + 14, a.z - off, b.x - 14, b.z - off, 13, "street"); treesAlong(a.x + 14, a.z + off, b.x - 14, b.z + off, 13, "street"); }
        else { treesAlong(a.x - off, a.z + 14, b.x - off, b.z - 14, 13, "street"); treesAlong(a.x + off, a.z + 14, b.x + off, b.z - 14, 13, "street"); }
      }
    }
    const MAIN_WALLS = [0x8a3b26, 0x7a3524, 0x9b5a3a, 0xb59a74, 0x6b4535, 0xa8906c];
    const mainList = [];
    function mainStreet(s, c) {
      const a = s.pts[0], b = s.pts[1], L = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
      const lim = { x0: c.x0 + artHalf + PADIN, x1: c.x1 - artHalf - PADIN, z0: c.z0 + artHalf + PADIN, z1: c.z1 - artHalf - PADIN };
      for (let side = -1; side <= 1; side += 2) {
        const nx = -tz * side, nz = tx * side, rot = r2(Math.atan2(-nx, -nz));
        let t = 6;
        while (t < L - 10) {
          const uw = lerp(8, 14, h01(seed, a.x + t, a.z + side, 811));
          const dd = lerp(15, 20, h01(seed, a.z + t, a.x - side, 812));
          const tm = t + uw / 2, off = s.w / 2 + 4.2 + dd / 2;
          const x = a.x + tx * tm + nx * off, z = a.z + tz * tm + nz * off;
          t += uw + 0.4;
          const b0 = { x: x, z: z, w: uw, d: dd, rot: rot };
          const cs = obbCorners(b0);
          let inside = true;
          for (const q of cs) if (q.x < lim.x0 || q.x > lim.x1 || q.z < lim.z0 || q.z > lim.z1) inside = false;
          if (!inside) continue;
          // clear of every other street (its edge) by a sidewalk: sample the
          // footprint, the front edge is allowed against its own avenue
          let clearOK = true;
          for (const q of cs.concat([{ x: x, z: z }])) if (roadClearExcept(q.x, q.z, 2.5, s) < 0) clearOK = false;
          if (!clearOK) continue;
          const bx0 = Math.min(cs[0].x, cs[1].x, cs[2].x, cs[3].x), bx1 = Math.max(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
          const bz0 = Math.min(cs[0].z, cs[1].z, cs[2].z, cs[3].z), bz1 = Math.max(cs[0].z, cs[1].z, cs[2].z, cs[3].z);
          if (blocked(bx0, bz0, bx1, bz1, 0)) continue;
          let hitOther = false;
          for (const o of mainList) if (Math.abs(o.x - x) < 30 && Math.abs(o.z - z) < 30 && obbOverlap(o, b0)) { hitOther = true; break; }
          if (hitOther) continue;
          const hv = h01(seed, x, z, 813);
          if (hv < 0.09) { P.vacant.push({ x: r2(x), z: r2(z), w: r2(uw), d: r2(dd), rot: rot, kind: "lot" }); continue; }
          const st = c.L > 0.47 ? 3 + ((h01(seed, x, z, 814) * 3) | 0) : 2 + ((h01(seed, x, z, 814) * 2) | 0);
          const bb = addBldg({ x: x, z: z, w: uw, d: dd, rot: rot, h: st * 3.6 + 0.9, st: st, fh: 3.6, type: "row", style: "row",
            wall: MAIN_WALLS[(h01(seed, x, z, 815) * MAIN_WALLS.length) | 0], glass: 0x2a333b, roof: "flat", shop: hv > 0.22,
            face: "rot", kind: "mainstreet", era: 1905 + ((h01(seed, x, z, 816) * 26) | 0), vacant: hv < 0.17, dist: c.dist, street: s.id });
          mainList.push(bb);
          occupy(x, z, Math.hypot(uw, dd) / 2);
        }
      }
    }
    // the distance to the nearest street edge, ignoring one street
    function roadClearExcept(x, z, r, skip) {
      let best = 1e9;
      const ix0 = Math.floor((x - r) / SH), ix1 = Math.floor((x + r) / SH), iz0 = Math.floor((z - r) / SH), iz1 = Math.floor((z + r) / SH);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const l = sHash.get(ix * 100003 + iz); if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const e = l[k]; if (e[0] === skip) continue;
          const d = segDist(x, z, e[1].x, e[1].z, e[2].x, e[2].z) - e[0].w / 2;
          if (d < best) best = d;
        }
      }
      return best - r;
    }
    const PADIN = 4.6;                 // pad footway ring (3.3) + a step
    const HOOD_BRICK = [0x8a4a34, 0x7a3f2c, 0x9a5a40, 0x6e3a2a, 0xa0826a], HOOD_WOOD = [0xb9b3a4, 0xcfc2a6, 0x8a9a8c, 0xa9b4b8, 0xd8d2c2, 0x9a8a6c, 0x7f8f98];
    function housesAlongD(s, c, brick) {
      const a = s.pts[0], b = s.pts[1], L = Math.hypot(b.x - a.x, b.z - a.z), half = s.w / 2;
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L, nx = -tz, nz = tx;
      const front = lerp(11.5, 13.5, h01(seed, c.i, c.j, 820));
      for (let t = front * 0.5; t < L; t += front) {
        const px = a.x + tx * t, pz = a.z + tz * t;
        for (let side = -1; side <= 1; side += 2) placeHouseD(px, pz, nx * side, nz * side, half, c, brick, s.id);
      }
    }
    function placeHouseD(px, pz, nx, nz, half, c, brick, sid) {
      const w = lerp(7.2, 9.6, h01(seed, px, pz, 822)), d = lerp(10, 12.5, h01(seed, pz, px, 823));
      const setback = lerp(5, 7, h01(seed, px, pz, 824));
      const off = half + setback + d / 2, x = px + nx * off, z = pz + nz * off;
      const rad = Math.hypot(w, d) / 2 + 1.0;
      if (roadClear(x, z, Math.hypot(w, d) / 2 + 2) < 0) return;
      if (occupied(x, z, rad)) return;
      const lx0 = c.x0 + artHalf + PADIN + 2, lx1 = c.x1 - artHalf - PADIN - 2, lz0 = c.z0 + artHalf + PADIN + 2, lz1 = c.z1 - artHalf - PADIN - 2;
      if (x - rad < lx0 || x + rad > lx1 || z - rad < lz0 || z + rad > lz1) return;
      if (blocked(x - rad, z - rad, x + rad, z + rad, 2)) return;
      const rot = r2(Math.atan2(-nx, -nz));
      const hv = h01(seed, x, z, 821);
      // an empty lot: the house is gone, the yard trees stayed
      if (hv < 0.11) {
        P.vacant.push({ x: r2(x), z: r2(z), w: r2(w), d: r2(d), rot: rot, kind: "house" });
        occupy(x, z, rad);
        if (h01(seed, x, z, 825) < 0.5 && treeOK(x, z)) { addTree(x, z, "yard"); P.trees[P.trees.length - 1].street = sid; }
        return;
      }
      const st = brick ? 2 : (h01(seed, x, z, 826) < 0.55 ? 2 : 1);
      const walls = brick ? HOOD_BRICK : HOOD_WOOD, roofs = look(c).roofs || [0x3d3a36];
      addBldg({ x: x, z: z, w: w, d: d, rot: rot, h: st * 3.0, st: st, fh: 3.0, type: "house", style: "house",
        wall: walls[(h01(seed, x, z, 827) * walls.length) | 0], roofCol: roofs[(h01(seed, x, z, 828) * roofs.length) | 0],
        roof: h01(seed, x, z, 829) < 0.78 ? "gable" : "hip", garage: false, face: "rot", dist: c.dist,
        drive: { x: px + nx * (half + setback * 0.5), z: pz + nz * (half + setback * 0.5) }, street: sid,
        kind: brick ? "house-brick" : "house-wood", era: brick ? 1915 + ((h01(seed, x, z, 830) * 14) | 0) : 1900 + ((h01(seed, x, z, 830) * 26) | 0),
        vacant: hv < 0.18 });
      occupy(x, z, rad);
      const bx = x - nx * (d / 2 + 6), bz = z - nz * (d / 2 + 6);
      if (h01(seed, bx, bz, 831) < 0.45 && treeOK(bx, bz)) { addTree(bx, bz, "yard"); P.trees[P.trees.length - 1].street = sid; }
    }
    // ---- a plant: the factory on the street, the assembly hall behind it,
    //      the powerhouse and its stacks; by the water, grain elevators
    let elevators = 0;
    function plantBlock(blk, x0, z0, x1, z1, c) {
      const W = x1 - x0, D = z1 - z0;
      if (W < 140 || D < 140) { industrialBlock(blk, x0, z0, x1, z1, c); return; }
      const alongX = W >= D, LA = alongX ? W : D, LB = alongX ? D : W, A0 = alongX ? x0 : z0, B0 = alongX ? z0 : x0;
      const hh = h01(seed, x0, z0, 841);
      const flip = hh < 0.5;                           // which long street the factory fronts
      // (along a0..a1, across b0..b1) -> a building rect; across measured from the front
      const put = function (a0, a1, b0, b1, extra) {
        const bf0 = flip ? B0 + LB - b1 : B0 + b0, bf1 = flip ? B0 + LB - b0 : B0 + b1;
        const r = alongX ? { x0: A0 + a0, x1: A0 + a1, z0: bf0, z1: bf1 } : { x0: bf0, x1: bf1, z0: A0 + a0, z1: A0 + a1 };
        const b = Object.assign({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0, rot: 0, dist: c.dist }, extra);
        if (blocked(r.x0, r.z0, r.x1, r.z1, 0)) return null;
        addBldg(b); occupy(b.x, b.z, Math.hypot(b.w, b.d) / 2);
        return b;
      };
      const nearWater = P.river && riverDist((x0 + x1) / 2, (z0 + z1) / 2) < P.river.half + 520;
      const nearRail = !!railHit(x0 - 120, z0 - 120, x1 + 120, z1 + 120, 0);
      let a = LA * 0.05;
      if (nearWater && nearRail && elevators < 2) {
        // GRAIN ELEVATORS: two rows of silos and the headhouse at their end
        elevators++;
        const n = 8, dS = 9, pitch = 9.3;
        for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) {
          put(a + k * pitch, a + k * pitch + dS, 8 + r * pitch, 8 + r * pitch + dS,
            { h: 36, st: 1, fh: 36, type: "silo", style: "metal", wall: 0xc9c4b8, roof: "dome", kind: "elevator", era: 1924 });
        }
        put(a + n * pitch + 2, a + n * pitch + 16, 4, 30,
          { h: 57.6, st: 12, fh: 4.8, type: "office", style: "concrete", wall: 0xbdb6a8, glass: 0x2c353e, roof: "flat", kind: "elevator-head", era: 1924 });
        P.landmarks.push({ kind: "elevator", x: alongX ? A0 + a + 60 : B0 + 20, z: alongX ? B0 + 20 : A0 + a + 60, name: P.name + " Grain Elevator" });
        a += n * pitch + 30;
      } else {
        // THE FACTORY: four to six storeys of concrete frame and brick on the street
        const fl = Math.min(LA - a - LA * 0.05, LA * lerp(0.62, 0.86, hh)), fd = Math.min(62, LB * 0.18);
        const st = 4 + ((h01(seed, x0, z0, 842) * 3) | 0);
        put(a, a + fl, 0, fd, { h: st * 4.4, st: st, fh: 4.4, type: "office", style: "brick", wall: h01(seed, x0, z0, 843) < 0.5 ? 0x7a3a28 : 0x9a8f7c,
          glass: 0x33404a, roof: "flat", kind: "factory", era: 1908 + ((h01(seed, x0, z0, 844) * 18) | 0) });
      }
      // THE ASSEMBLY HALL: one storey of sawtooth roof, a quarter-mile long
      const fdU = Math.min(62, LB * 0.18);
      const sa0 = LA * 0.06, sa1 = LA * lerp(0.7, 0.94, h01(seed, x1, z1, 845)), sb0 = fdU + 16, sb1 = sb0 + LB * lerp(0.36, 0.5, h01(seed, x1, z0, 846));
      put(sa0, sa1, sb0, sb1, { h: lerp(11, 15, h01(seed, x0, z1, 847)), st: 1, fh: 13, type: "ware", style: "brick", wall: 0x8c6a52,
        glass: 0x40505a, roof: "saw", kind: "plant-shed", era: 1920 + ((h01(seed, x0, z1, 848) * 20) | 0) });
      // yards between the hall and the far street
      if (LB - sb1 > 40) {
        const ya = alongX ? { x0: A0 + sa0, x1: A0 + sa1 } : null;
        const yb0 = flip ? B0 : B0 + sb1 + 6, yb1 = flip ? B0 + LB - sb1 - 6 : B0 + LB;
        P.parking.push(alongX ? { x0: ya.x0, x1: ya.x1, z0: yb0, z1: yb1, kind: "yard", dist: c.dist } : { x0: yb0, x1: yb1, z0: A0 + sa0, z1: A0 + sa1, kind: "yard", dist: c.dist });
      }
      // THE POWERHOUSE and its stacks, in the far corner
      if (h01(seed, x1, z1, 849) < 0.7 && LA - sa1 > 60) {
        const pa = sa1 + 12, pb = LB - 44;
        if (put(pa, pa + 36, pb, pb + 26, { h: 19.5, st: 3, fh: 6.5, type: "office", style: "brick", wall: 0x7a3a28, glass: 0x33404a, roof: "flat", kind: "powerhouse", era: 1916 })) {
          const ns = 2 + ((h01(seed, x1, z1, 850) * 2) | 0);
          for (let k = 0; k < ns; k++) put(pa + 4 + k * 10, pa + 9.5 + k * 10, pb - 12, pb - 6.5,
            { h: lerp(46, 64, h01(seed, x1 + k, z1, 851)), st: 1, fh: 10, type: "tank", style: "metal", wall: 0x8a7e72, roof: "dome", kind: "stack", era: 1916 });
        }
      }
    }
    // ---- the park island: lawn, paths and woods between the two arms
    function islandPark() {
      const I = P.river.island, al = P.river.along;
      let cmin = 1e9, cmax = -1e9;
      for (let a = I.a0; a <= I.a1; a += 20) { const c = I.cAt(a) + I.off; cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
      const q0 = cmax - (I.half - 16), q1 = cmin + (I.half - 16);
      if (q1 - q0 < 40) return;
      // cut where an arterial crosses the island (it runs over it at grade)
      const cuts = [];
      for (const s of P.streets) if (s.k === "art" && s.axis === (al === "z" ? "z" : "x") && s.at > I.a0 - 20 && s.at < I.a1 + 20) cuts.push([s.at - s.w / 2 - 2, s.at + s.w / 2 + 2]);
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      let a = I.a0 + 20; const pieces = [];
      for (const k of cuts) { if (k[0] - a > 60) pieces.push([a, k[0]]); a = Math.max(a, k[1]); }
      if (I.a1 - 20 - a > 60) pieces.push([a, I.a1 - 20]);
      pieces.forEach(function (pc, k) {
        const r = al === "z" ? { x0: q0, x1: q1, z0: pc[0], z1: pc[1] } : { x0: pc[0], x1: pc[1], z0: q0, z1: q1 };
        const hc = cellOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), dist = hc ? hc.dist : 0;
        P.pads.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, use: "park", dist: dist, cell: "island-" + k });
        P.parks.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, kind: "park", dist: dist });
        const X0 = r.x0 + PADIN + 3, X1 = r.x1 - PADIN - 3, Z0 = r.z0 + PADIN + 3, Z1 = r.z1 - PADIN - 3;
        // a tree-lined perimeter walk and a wood at each end
        treesAlong(X0, Z0, X1, Z0, 12, "avenue"); treesAlong(X0, Z1, X1, Z1, 12, "avenue");
        treesAlong(X0, Z0 + 12, X0, Z1 - 12, 12, "avenue"); treesAlong(X1, Z0 + 12, X1, Z1 - 12, 12, "avenue");
        const long = al === "z" ? (Z1 - Z0) : (X1 - X0);
        if (long > 140) {
          const w0 = al === "z" ? { x0: X0 + 12, x1: X1 - 12, z0: Z0 + 14, z1: Z0 + 14 + long * 0.28 } : { x0: X0 + 14, x1: X0 + 14 + long * 0.28, z0: Z0 + 12, z1: Z1 - 12 };
          treesInRect(w0.x0, w0.z0, w0.x1, w0.z1, 9, "park");
        }
      });
      if (pieces.length) {
        const m = (I.a0 + I.a1) / 2, c = I.cAt(m) + I.off;
        P.landmarks.push({ kind: "park", x: al === "z" ? r2(c) : m, z: al === "z" ? m : r2(c), name: I.name });
      }
    }
    // ---- kinds and years
    function detroitTags() {
      // the riverfront glass cluster: the five downtown towers nearest the water
      // (on the downtown's own bank)
      const bankOf = function (x, z) {
        if (!P.river) return 0;
        let best = null, bd = 1e9;
        for (const p of P.river.pts) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
        return P.river.along === "z" ? Math.sign(x - best.x) : Math.sign(z - best.z);
      };
      const hubBank = bankOf(cx, cz);
      const tw = P.bldgs.filter(function (b) { return b.type === "tower" && Math.hypot(b.x - cx, b.z - cz) < 560 && bankOf(b.x, b.z) === hubBank; });
      tw.sort(function (p, q) { return riverDist(p.x, p.z) - riverDist(q.x, q.z); });
      const cl = LOOKS.cbd[0];
      for (const b of tw.slice(0, 5)) {
        b.kind = "glass-cluster"; b.era = 1977; b.style = "glass"; b.wall = cl.walls[(h01(seed, b.x, b.z, 861) * cl.walls.length) | 0]; b.glass = cl.glass;
        if (b.roof === "crown") b.roof = "flat";
      }
      for (const b of P.bldgs) {
        if (b.kind) continue;
        const r = h01(seed, b.x, b.z, 862);
        if (b.type === "tower") { b.kind = "prewar-tower"; b.era = 1913 + ((r * 19) | 0); }
        else if (b.type === "apt") { b.kind = "apartment"; b.era = 1912 + ((r * 18) | 0); }
        else if (b.type === "office") b.era = 1920 + ((r * 12) | 0);
        else if (b.type === "row") b.era = 1895 + ((r * 25) | 0);
        else if (b.type === "ware" || b.type === "tank") { b.kind = b.type === "ware" ? "plant-shed" : "tank"; b.era = 1925 + ((r * 30) | 0); }
        else if (b.type === "house") { b.kind = "house-wood"; b.era = 1920 + ((r * 30) | 0); }
        else if (b.type === "civic" || b.type === "pavilion" || b.type === "clocktower") b.era = 1915 + ((r * 15) | 0);
        else if (b.type === "strip" || b.type === "mall") b.era = 1962 + ((r * 25) | 0);
        else if (b.type === "stadium") b.era = 2002;
        else b.era = 1920;
      }
    }
    // ---- the elevated downtown loop: a guideway over the kerb of the
    //      arterials round the downtown, columns on the sidewalk, stations
    function planMover() {
      const hx = cx, hz = cz, M = spec.mover === true ? {} : spec.mover;
      const near = function (list, v) { let b = null; for (const q of list) if (b == null || Math.abs(q - v) < Math.abs(b - v)) b = q; return b != null && Math.abs(b - v) < 30 ? b : null; };
      // (in superblocks from the hub: the downtown the loop rings)
      const xw = near(xs, hx - A * (M.west != null ? M.west : 0.5)), xe = near(xs, hx + A * (M.east != null ? M.east : 1.5)),
        zn = near(zs, hz - A * (M.north != null ? M.north : 1.5)), zsv = near(zs, hz + A * (M.south != null ? M.south : 1.5));
      if (xw == null || xe == null || zn == null || zsv == null) return;
      // all four sides must be continuous arterial
      const covered = function (axis, at, a0, a1) {
        return P.streets.some(function (s) { return s.k === "art" && s.axis === axis && Math.abs(s.at - at) < 0.5 && s.a0 <= a0 + 0.5 && s.a1 >= a1 - 0.5; });
      };
      if (!covered("x", xw, zn, zsv) || !covered("x", xe, zn, zsv) || !covered("z", zn, xw, xe) || !covered("z", zsv, xw, xe)) return;
      // THE GUIDEWAY RUNS OVER THE ARTERIALS' CENTRE LINES (the columns in
      // the middle of the road, between the inner lanes, like a median),
      // turning over the junctions on 14 m curves: over the centre it never
      // meets a lamp (they stand at the kerbs), a street tree or a facade.
      const CR = 14;
      const X0 = xw, X1 = xe, Z0 = zn, Z1 = zsv, hx0 = (X0 + X1) / 2, hz0 = (Z0 + Z1) / 2;
      const pts = [];
      const corner = function (ccx, ccz, a0) { for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * Math.PI / 2; pts.push({ x: r2(ccx + Math.cos(a) * CR), z: r2(ccz + Math.sin(a) * CR) }); } };
      corner(X1 - CR, Z0 + CR, -Math.PI / 2); corner(X1 - CR, Z1 - CR, 0); corner(X0 + CR, Z1 - CR, Math.PI / 2); corner(X0 + CR, Z0 + CR, Math.PI);
      // where something crosses or meets the ring, no column: every junction
      // on it, and the mouth of every pad street (the radial avenues) on it
      const keep = [];
      const onRing = function (x, z) {
        return ((Math.abs(x - X0) < 0.6 || Math.abs(x - X1) < 0.6) && z >= Z0 - 1 && z <= Z1 + 1) || ((Math.abs(z - Z0) < 0.6 || Math.abs(z - Z1) < 0.6) && x >= X0 - 1 && x <= X1 + 1);
      };
      for (const j of P.junctions) if (onRing(j.x, j.z)) keep.push({ x: j.x, z: j.z, r: Math.max(j.wa, j.wb) / 2 + 6 });
      for (const st of P.streets) if (!st.axis) for (const e of [st.pts[0], st.pts[st.pts.length - 1]]) {
        // a mouth ends on the arterial's centre line or its kerb
        for (const q of [[X0, null], [X1, null], [null, Z0], [null, Z1]]) {
          const d = q[0] != null ? Math.abs(e.x - q[0]) : Math.abs(e.z - q[1]);
          if (d < tier.artW / 2 + 1 && onRing(q[0] != null ? q[0] : e.x, q[1] != null ? q[1] : e.z)) keep.push({ x: q[0] != null ? q[0] : e.x, z: q[1] != null ? q[1] : e.z, r: st.w / 2 + 8 });
        }
      }
      const colFree = function (x, z) {
        for (const k of keep) if (Math.abs(x - k.x) < k.r && Math.abs(z - k.z) < k.r) return false;
        if (P.river && wet(x, z, 4)) return false;
        return true;
      };
      const cols = [];
      let total = 0, last = -1e9;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n], L = Math.hypot(q.x - p.x, q.z - p.z);
        if (L < 1e-6) continue;
        const straight = L > CR * 2;                     // the runs between the corner curves
        const tx = (q.x - p.x) / L, tz = (q.z - p.z) / L;
        if (straight) for (let s = 6; s < L - 6; s += 2) {
          const x = p.x + tx * s, z = p.z + tz * s;
          if (total + s - last >= 28 && colFree(x, z)) { cols.push({ x: r2(x), z: r2(z) }); last = total + s; }
        }
        total += L;
      }
      // the lamps metro_ground stands at the kerbs (its rule: every 36 m along
      // an arterial, alternate sides) — a stair tower keeps clear of them
      const lampNear = function (axis, at, along, side) {
        const sp = 36, off = at % 7;
        const k0 = Math.floor((along - off) / sp) - 1;
        for (let k = k0; k <= k0 + 3; k++) {
          const a = k * sp + off, sd = (k & 1) ? 1 : -1;
          if (sd === side && Math.abs(a - along) < 2.6) return true;
        }
        return false;
      };
      // stations: the middle of the north, east and south runs, a glazed box
      // round the track; its stair tower on the sidewalk beside it
      const stations = [];
      const mk = function (x, z, yaw, name) {
        const along = { x: Math.sin(yaw), z: Math.cos(yaw) }, across = { x: along.z, z: -along.x };
        const axis = Math.abs(along.x) < 0.5 ? "x" : "z", at = axis === "x" ? x : z;   // the arterial's fixed coordinate
        const st = { x: r2(x), z: r2(z), yaw: r2(yaw), len: 32, wid: 7, stair: null, name: name };
        const u = tier.artW / 2 + 1.6;
        search: for (const d of [8, -8, 14, -14, 20, -20, 26, -26]) for (const side of [1, -1]) {
          const sx = x + along.x * d + across.x * u * side, sz = z + along.z * d + across.z * u * side;
          const al = axis === "x" ? sz : sx;
          // which kerb (in metro_ground's sense: +1 = the +u side of the street)
          const gside = (axis === "x" ? sx - at : sz - at) > 0 ? 1 : -1;
          if (lampNear(axis, at, al, gside)) continue;
          let clear = true;
          for (const k of keep) if (Math.abs(sx - k.x) < k.r + 2 && Math.abs(sz - k.z) < k.r + 2) clear = false;
          const hw = 2.1;
          for (const b of P.bldgs) {
            if (Math.abs(b.x - sx) > 90 || Math.abs(b.z - sz) > 90) continue;
            const r = obbCorners({ x: sx, z: sz, w: 2.6, d: 4.2, rot: yaw });
            if (obbOverlap({ x: sx, z: sz, w: 2.6 + 1, d: 4.2 + 1, rot: yaw }, b)) { clear = false; break; }
            void r; void hw;
          }
          if (!clear) continue;
          st.stair = { x: r2(sx), z: r2(sz), w: 2.6, d: 4.2 };
          break search;
        }
        stations.push(st);
      };
      // a station stands where 40 m of the run are clear of every junction
      // and mouth, as near the middle of its side as that allows
      const place = function (x, z, yaw, lo, hi, name) {
        const alongX = Math.abs(Math.sin(yaw)) > 0.5, c0 = alongX ? x : z;
        for (let k = 0; k < 80; k++) for (const sg of [1, -1]) {
          const c = c0 + sg * k * 5;
          if (c - 20 < lo + CR + 4 || c + 20 > hi - CR - 4) continue;
          const px = alongX ? c : x, pz = alongX ? z : c;
          let ok = true;
          for (const q of keep) {
            const dAl = alongX ? Math.abs(q.x - px) : Math.abs(q.z - pz), dAc = alongX ? Math.abs(q.z - pz) : Math.abs(q.x - px);
            if (dAc < q.r && dAl < q.r + 20) { ok = false; break; }
          }
          if (ok) { mk(px, pz, yaw, name); return; }
        }
      };
      place(hx0, Z0, Math.PI / 2, X0, X1, "North");
      place(X1, hz0, 0, Z0, Z1, "East");
      place(hx0, Z1, Math.PI / 2, X0, X1, "South");
      // no tree under the deck's edge or in a stair tower
      P.trees = P.trees.filter(function (t) {
        for (const st of stations) if (st.stair && Math.abs(t.x - st.stair.x) < 4.5 && Math.abs(t.z - st.stair.z) < 4.5) return false;
        return true;
      });
      P.structs = P.structs || {};
      P.structs.mover = { pts: pts, closed: true, deckY: 8.2, depth: 1.5, width: 5.0, cols: cols, stations: stations, length: Math.round(total),
        rect: { x0: xw, x1: xe, z0: zn, z1: zsv } };
      P.landmarks.push({ kind: "mover", x: r2(hx0), z: r2(hz0), name: P.name + " Downtown Loop" });
    }
    // run the cells
    for (const c of cells) {
      if (c.use === "cbd") gridCell(c, tier.pitch, tier.pitch, "cbd");
      else if (c.use === "midtown") gridCell(c, tier.pitch, tier.pitch, "midtown");
      else if (c.use === "inner") gridCell(c, tier.pitch, tier.pitch * 1.3, "inner");
      else if (c.use === "rows") gridCell(c, tier.pitch, (c.z1 - c.z0) / 2, "rows");
      else if (c.use === "industrial") gridCell(c, (c.x1 - c.x0) / (DET ? 1 : 2), (c.z1 - c.z0) / (DET ? 1 : 2), "industrial");
    }
    if (DET) for (const c of cells) if (c.use === "hood") {
      // a neighbourhood a freeway, the rail or the river runs through is laid
      // out as terraces on the grid (its streets clip at the cut)
      if (!c.spokes && crossed(c)) gridCell(c, tier.pitch, (c.z1 - c.z0) / 2, "rows");
      else hoodCell(c);
    }
    if (DET && P.river && P.river.island) islandPark();
    for (const c of cells) {
      if (c.use === "suburb" && crossed(c)) gridCell(c, tier.pitch, (c.z1 - c.z0) / 2, "rows");
      else if (c.use === "suburb") suburbCell(c);
      else if (c.use === "mall") mallCell(c);
      else if (c.use === "park") parkCell(c);
      else if (c.use === "stadium") stadiumCell(c);
      else if (c.use === "campus") campusCell(c);
    }
    for (const c of cells) if (c.use === "exurb" || c.use === "farm") { if (c.use === "exurb") exurbCell(c); else fieldsIn(c, c.x0 + 8, c.z0 + 8, c.x1 - 8, c.z1 - 8); }

    // ---------------------------------------------------------------
    // 8. STREET TREES on the grid districts (rows handled in rowBlock)
    // ---------------------------------------------------------------
    for (const s of P.streets) {
      if (s.k !== "loc" && s.k !== "art") continue;
      const cell = s.cell ? s.cell.split(",").map(Number) : null;
      // arterials: trees in the inner-ring and midtown verges only
      if (s.k === "art") {
        const mid = { x: (s.pts[0].x + s.pts[1].x) / 2, z: (s.pts[0].z + s.pts[1].z) / 2 };
        const L = landValue(mid.x, mid.z);
        if (L < 0.47 || L > 0.8) continue;
      } else if (cell) {
        const c = cellAt(cell[0], cell[1]);
        if (!c || (c.use !== "inner" && c.use !== "midtown")) continue;
      }
      const a = s.pts[0], b = s.pts[1];
      const off = s.w / 2 + 1.1;
      if (s.axis === "x") { treesAlong(a.x - off, a.z + 6, b.x - off, b.z - 6, 12, "street"); treesAlong(a.x + off, a.z + 6, b.x + off, b.z - 6, 12, "street"); }
      else { treesAlong(a.x + 6, a.z - off, b.x - 6, b.z - off, 12, "street"); treesAlong(a.x + 6, a.z + off, b.x - 6, b.z + off, 12, "street"); }
    }

    // ---------------------------------------------------------------
    // 9. CROSSINGS: bridges over the river, overpasses over the freeways,
    //    diamond interchanges, the station on the rail
    // ---------------------------------------------------------------
    for (const s of P.streets) {
      if (s.pts.length !== 2 || !(s.k === "art" || s.k === "rural" || s.k === "loc")) continue;
      const a = s.pts[0], b = s.pts[1];
      // river crossings: sample along
      if (P.river) {
        const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 6);
        let inW = false, w0 = 0;
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
          const w = riverDist(x, z) < P.river.half + 10;
          if (w && !inW) { inW = true; w0 = t * L; }
          if (!w && inW) {
            inW = false;
            P.bridges.push({ street: s.id, axis: s.axis, at: s.at, a0: (s.axis === "x" ? a.z : a.x) + w0 - 8, a1: (s.axis === "x" ? a.z : a.x) + t * L + 8, w: s.w, k: s.k });
          }
        }
      }
      // freeway overpasses (arterials and rural roads only — locals were cut)
      for (const c of corridors) {
        if (c.grade) continue;                        // an ordinary road is crossed at grade
        if (c.ax === s.axis) continue;                // parallel: never crosses
        const along = c.at;                            // where the freeway cuts this street
        const sa0 = Math.min(s.axis === "x" ? a.z : a.x, s.axis === "x" ? b.z : b.x), sa1 = Math.max(s.axis === "x" ? a.z : a.x, s.axis === "x" ? b.z : b.x);
        if (along < sa0 || along > sa1) continue;
        if (s.at < c.a0 - c.half || s.at > c.a1 + c.half) continue;
        P.overpasses.push({ street: s.id, axis: s.axis, at: s.at, over: c.name, fwAxis: c.ax, fwAt: c.at, a0: along - c.half - 6, a1: along + c.half + 6, w: s.w, k: s.k });
      }
    }
    // diamond interchanges: the overpasses nearest the CBD and the midtown,
    // one per freeway leg (never two within 1.2 km on one leg)
    (function pickInterchanges() {
      const byFw = {};
      for (const o of P.overpasses) if (o.k === "art") (byFw[o.over + "|" + o.fwAt] = byFw[o.over + "|" + o.fwAt] || []).push(o);
      for (const key in byFw) {
        const list = byFw[key].slice().sort(function (p, q) {
          const pp = p.axis === "x" ? { x: p.at, z: p.fwAt } : { x: p.fwAt, z: p.at };
          const qq = q.axis === "x" ? { x: q.at, z: q.fwAt } : { x: q.fwAt, z: q.at };
          return -landValue(pp.x, pp.z) + landValue(qq.x, qq.z);
        });
        const picked = [];
        for (const o of list) {
          if (picked.length >= 3) break;
          if (picked.some(function (p) { return Math.abs(p.at - o.at) < 1200; })) continue;
          picked.push(o);
          const x = o.axis === "x" ? o.at : o.fwAt, z = o.axis === "x" ? o.fwAt : o.at;
          P.interchanges.push({ x: x, z: z, fwAxis: o.fwAxis, fwName: o.over, street: o.street, artAxis: o.axis, half: 15.3 });
          o.interchange = true;
        }
      }
    })();
    // THE DETROIT PLAN (4): who built what, and when (plan data the facade
    // pass reads: kind, era, vacant) — and the riverfront glass cluster,
    // whose tallest tower is the skyline's crown
    if (DET) detroitTags();
    // the tallest tower is the CBD's crown — tag it
    let tallest = null;
    for (const b of P.bldgs) if (b.type === "tower" && (!DET || b.kind === "glass-cluster") && (!tallest || b.h > tallest.h)) tallest = b;
    if (tallest && tallest.st < coreStoreys && spec.tier === "metro") {
      // the crown of the skyline is built to the city's full height
      const k = coreStoreys / tallest.st;
      for (const t of tallest.tiers) { if (t.part === "shaft") { t.y0 = t.y0 === tallest.tiers[0].y1 ? t.y0 : t.y0 * k; t.y1 *= k; } }
      tallest.st = coreStoreys; tallest.h = r2(coreStoreys * tallest.fh);
      tallest.tiers[tallest.tiers.length - 1].y1 = tallest.h;
    }
    if (tallest) { tallest.roof = "spire"; tallest.landmark = true; P.landmarks.push({ kind: "tower", x: tallest.x, z: tallest.z, name: P.name + " Tower", h: tallest.h }); }

    // ---------------------------------------------------------------
    // 10. JUNCTIONS (grid street crossings: art x art, art x loc, loc x loc)
    // ---------------------------------------------------------------
    const V = P.streets.filter(function (s) { return s.pts.length === 2 && s.axis === "x"; });
    const H = P.streets.filter(function (s) { return s.pts.length === 2 && s.axis === "z"; });
    const hb = new Map();
    for (const h of H) { const k = Math.round(h.at); let l = hb.get(k); if (!l) hb.set(k, l = []); l.push(h); }
    for (const v of V) {
      for (const [zk, list] of hb) {
        if (zk < v.a0 - 1 || zk > v.a1 + 1) continue;
        for (const h of list) {
          if (v.at < h.a0 - 1 || v.at > h.a1 + 1) continue;
          P.junctions.push({ x: v.at, z: h.at, a: v.id, b: h.id, ka: v.k, kb: h.k, wa: v.w, wb: h.w });
        }
      }
    }
    // ---------------------------------------------------------------
    // 11. ONE NETWORK. A street that cannot reach the arterials (its
    //     arterial was cut by a compound's fence, a mouth that met nothing)
    //     is not built, and neither is a house that fronts only it: a
    //     subdivision nobody can drive into is not a place.
    // ---------------------------------------------------------------
    (function pruneStreets() {
      const S = P.streets, idx = new Map();
      S.forEach(function (s, i) { idx.set(s.id, i); });
      const par = S.map(function (_, i) { return i; });
      function f(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      function u(a, b) { const ra = f(a), rb = f(b); if (ra !== rb) par[ra] = rb; }
      for (const j of P.junctions) u(idx.get(j.a), idx.get(j.b));
      S.forEach(function (s, i) {
        for (const e of [s.pts[0], s.pts[s.pts.length - 1]]) {
          const l = sHash.get(Math.floor(e.x / SH) * 100003 + Math.floor(e.z / SH));
          if (!l) continue;
          for (const q of l) { if (q[0] === s || !idx.has(q[0].id)) continue; if (segDist(e.x, e.z, q[1].x, q[1].z, q[2].x, q[2].z) < q[0].w / 2 + 0.6) u(i, idx.get(q[0].id)); }
        }
      });
      // the component with the most arterial metres is the city
      const score = new Map();
      S.forEach(function (s, i) { const r = f(i); score.set(r, (score.get(r) || 0) + (s.k === "art" || s.k === "rural" ? (s.a1 - s.a0) : 1)); });
      let best = -1, bs = -1; score.forEach(function (v, r) { if (v > bs) { bs = v; best = r; } });
      const gone = new Set();
      S.forEach(function (s, i) { if (f(i) !== best) gone.add(s.id); });
      if (!gone.size) return;
      P.streets = S.filter(function (s) { return !gone.has(s.id); });
      P.bulbs = P.bulbs.filter(function (b) { return !gone.has(b.street); });
      P.bldgs = P.bldgs.filter(function (b) { return b.street == null || !gone.has(b.street); });
      P.trees = P.trees.filter(function (t) { return t.street == null || !gone.has(t.street); });
      P.junctions = P.junctions.filter(function (j) { return !gone.has(j.a) && !gone.has(j.b); });
      P.bridges = P.bridges.filter(function (b) { return !gone.has(b.street); });
      P.overpasses = P.overpasses.filter(function (o) { return !gone.has(o.street); });
      P.interchanges = P.interchanges.filter(function (o) { return !gone.has(o.street); });
      P.pruned = gone.size;
    })();
    // THE DETROIT PLAN (5): the elevated downtown loop
    if (DET && spec.mover) planMover();
    // ---------------------------------------------------------------
    // 12. THE FREEWAY FRONTAGE LAW (city/zoning.js): nobody's front door is
    //     on a freeway. A home (house, rowhouse, walk-up) whose wall comes
    //     within the buffer of a deck edge is not built; its plot becomes
    //     the verge, a screen of trees between the lanes and the street
    //     behind. Measured before: 713 homes within 25 m of a freeway edge.
    // ---------------------------------------------------------------
    if (ZN && ZN.buffer) {
      const HOME = { house: 1, row: 1, apt: 1 };
      let cut = 0;
      const keep = [];
      for (const b of P.bldgs) {
        if (HOME[b.type] && ZN.buffer(b.x, b.z, Math.max(b.w, b.d) / 2)) {
          cut++;
          // (its own plot: still in the occupancy hash, so not treeOK's test)
          if (roadClear(b.x, b.z, 2) >= 0 && !corridorHit(b.x - 2, b.z - 2, b.x + 2, b.z + 2, 4)) addTree(b.x, b.z, "park");
          continue;
        }
        keep.push(b);
      }
      if (cut) { P.bldgs = keep; P.verge = cut; }
    }
    // ---------------------------------------------------------------
    // 13. NO STREET TO NOWHERE. A short local or country stub with one end
    //     touching no other street (cut off by a fence, a river bank, the
    //     plan's edge) and not one building along it is a road that "ends
    //     abruptly" (owner, 2026-09-29) and serves nobody: it is not built.
    //     A cul-de-sac (its bulb), a collector's mouth and an arterial are
    //     never stubs; a stub with a house on it is a lane and stays.
    // ---------------------------------------------------------------
    (function pruneStubs() {
      if (!ZN) return;
      const touches = function (s, e) {
        const l = sHash.get(Math.floor(e.x / SH) * 100003 + Math.floor(e.z / SH));
        if (l) for (const q of l) { if (q[0] === s || q[0]._stub) continue; if (segDist(e.x, e.z, q[1].x, q[1].z, q[2].x, q[2].z) < q[0].w / 2 + 1.5) return true; }
        for (const b of P.bulbs) if (b.street === s.id && Math.hypot(b.x - e.x, b.z - e.z) < (b.r || 12) + 4) return true;
        return false;
      };
      const gone = new Set();
      for (const s of P.streets) {
        if ((s.k !== "loc" && s.k !== "rural") || s.pts.length !== 2 || s.mouth || s.closed) continue;
        const a = s.pts[0], b = s.pts[1], L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L > 150) continue;
        if (touches(s, a) && touches(s, b)) continue;
        let served = false;
        for (let t = 0; t <= L && !served; t += 8) {
          const f = L ? t / L : 0, x = lerp(a.x, b.x, f), z = lerp(a.z, b.z, f);
          if (occupied(x, z, s.w / 2 + 16)) served = true;
        }
        if (served) continue;
        gone.add(s.id); s._stub = true;
      }
      if (!gone.size) return;
      P.streets = P.streets.filter(function (s) { return !gone.has(s.id); });
      P.junctions = P.junctions.filter(function (j) { return !gone.has(j.a) && !gone.has(j.b); });
      P.bridges = P.bridges.filter(function (b) { return !gone.has(b.street); });
      P.overpasses = P.overpasses.filter(function (o) { return !gone.has(o.street); });
      P.interchanges = P.interchanges.filter(function (o) { return !gone.has(o.street); });
      P.trees = P.trees.filter(function (t) { return t.street == null || !gone.has(t.street); });
      P.stubs = gone.size;
    })();
    P.ms = Date.now() - T0;
    P.stats = stats(P);
    return P;
  }

  // =====================================================================
  //  TRANSLATE — a plan made in one frame, moved to another. A COPY of a
  //  city (city/metro.js `frame`) is planned where its source stands, so
  //  every position hash is the source's and the copy is the same city
  //  wherever the land allows; this moves every coordinate the plan holds
  //  by (dx, dz) and wraps its field queries. Axis conventions: a street,
  //  bridge or overpass `axis` names the FIXED coordinate of its line (`at`),
  //  a rail `axis` the one it runs along, a corridor's `ax` its fixed one.
  // =====================================================================
  function translatePlan(P, dx, dz) {
    if (!dx && !dz) return P;
    const pt = function (p) { if (p) { p.x += dx; p.z += dz; } };
    const rect = function (r) { r.x0 += dx; r.x1 += dx; r.z0 += dz; r.z1 += dz; };
    const mm = function (r) { r.minX += dx; r.maxX += dx; r.minZ += dz; r.maxZ += dz; };
    const line = function (o, fixedAx) {           // fixedAx: the axis of `at`
      if (fixedAx === "x") { o.at += dx; o.a0 += dz; o.a1 += dz; } else { o.at += dz; o.a0 += dx; o.a1 += dx; }
    };
    P.cx += dx; P.cz += dz; mm(P.bounds);
    P.xs = P.xs.map(function (v) { return v + dx; }); P.zs = P.zs.map(function (v) { return v + dz; });
    for (const s of P.streets) { for (const p of s.pts) pt(p); if (s.axis) line(s, s.axis); }
    for (const b of P.bulbs || []) pt(b);                        // streets hold the same objects
    for (const j of P.junctions) pt(j);
    for (const k of ["blocks", "pads", "parks", "plazas", "parking", "fields", "walls", "lots", "cells"]) for (const r of P[k] || []) rect(r);
    for (const c of P.cells) { c.cx += dx; c.cz += dz; }
    for (const b of P.bldgs) {
      b.x += dx; b.z += dz;
      if (b.tiers) for (const t of b.tiers) { t.x += dx; t.z += dz; }
      if (b.drive) pt(b.drive);
    }
    for (const t of P.trees) pt(t);
    for (const v of P.vacant || []) pt(v);
    for (const r of P.rail) line(r, r.axis === "x" ? "z" : "x");
    for (const st of P.stations) pt(st);
    for (const b of P.bridges) line(b, b.axis);
    for (const o of P.overpasses) { line(o, o.axis); o.fwAt += o.fwAxis === "x" ? dx : dz; }
    for (const i of P.interchanges) pt(i);
    for (const d of P.districts) { d.cx += dx; d.cz += dz; }
    for (const l of P.landmarks) pt(l);
    for (const s of P.subcentres || []) pt(s);
    for (const o of P.obstacles) mm(o);
    for (const c of P.corridors) line(c, c.ax);
    if (P.river) {
      for (const p of P.river.pts) pt(p);
      if (P.river.channels) for (const ch of P.river.channels) for (const p of ch.pts) if (P.river.pts.indexOf(p) < 0) pt(p);
    }
    if (P.structs) translateStructs(P.structs, dx, dz);
    if (P.square) { P.square.x0 += dx; P.square.x1 += dx; P.square.z0 += dz; P.square.z1 += dz; }
    const lv = P.landValue, ev = P.envelope, rd = P.riverDist, bl = P.blocked;
    P.landValue = function (x, z) { return lv(x - dx, z - dz); };
    P.envelope = function (x, z) { return ev(x - dx, z - dz); };
    P.riverDist = function (x, z) { return rd(x - dx, z - dz); };
    P.blocked = function (x0, z0, x1, z1, pad) { return bl(x0 - dx, z0 - dz, x1 - dx, z1 - dz, pad); };
    P.frame = { dx: dx, dz: dz };
    P.stats = stats(P);
    return P;
  }
  function translateStructs(S, dx, dz) {
    const pt = function (p) { p.x += dx; p.z += dz; };
    if (S.mover) { for (const p of S.mover.pts) pt(p); for (const c of S.mover.cols) pt(c); for (const st of S.mover.stations) pt(st); }
    for (const m of S.monuments || []) pt(m);
  }

  // =====================================================================
  //  THE SQUARE — a copy's centre superblock cleared to one paved square
  //  with an abstract monument in the middle (Karvel: "a planned capital";
  //  a monument of no one: a stepped plinth and a tapering pylon, no
  //  figure, no symbol, no text). The rest of the plan is untouched.
  // =====================================================================
  function ceremonialSquare(P, opt) {
    let c = null;
    for (const q of P.cells) if (P.cx >= q.x0 && P.cx < q.x1 && P.cz >= q.z0 && P.cz < q.z1) { c = q; break; }
    if (!c || c.use !== "cbd") return P;
    const key = c.i + "," + c.j, T = TIERS[P.tier] || TIERS.metro, ah = T.artW / 2;
    const inside = function (x, z) { return x > c.x0 + ah && x < c.x1 - ah && z > c.z0 + ah && z < c.z1 - ah; };
    const gone = new Set();
    for (const st of P.streets) if (st.cell === key && st.k === "loc") gone.add(st.id);
    P.streets = P.streets.filter(function (st) { return !gone.has(st.id); });
    P.junctions = P.junctions.filter(function (j) { return !gone.has(j.a) && !gone.has(j.b); });
    P.blocks = P.blocks.filter(function (b) { return b.cell !== key; });
    P.bldgs = P.bldgs.filter(function (b) { return !inside(b.x, b.z); });
    P.trees = P.trees.filter(function (t) { return !inside(t.x, t.z); });
    P.plazas = P.plazas.filter(function (r) { return !inside((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2); });
    P.parking = P.parking.filter(function (r) { return !inside((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2); });
    P.landmarks = P.landmarks.filter(function (l) { return !(l.kind === "tower" && inside(l.x, l.z)); });
    const blk = { x0: c.x0 + ah, x1: c.x1 - ah, z0: c.z0 + ah, z1: c.z1 - ah, use: "cbd", dist: c.dist, cell: key, sw: 4.5, r: 5, L: 1, square: true };
    P.blocks.push(blk);
    P.plazas.push({ x0: blk.x0 + blk.sw, x1: blk.x1 - blk.sw, z0: blk.z0 + blk.sw, z1: blk.z1 - blk.sw, dist: c.dist, square: true });
    // one line of trees round the square, 10 m in: the middle stays open
    const i0 = blk.x0 + 14, i1 = blk.x1 - 14, j0 = blk.z0 + 14, j1 = blk.z1 - 14;
    const line = function (xa, za, xb, zb) {
      const L = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.floor(L / 14));
      for (let k = 0; k <= n; k++) P.trees.push({ x: r2(lerp(xa, xb, k / n)), z: r2(lerp(za, zb, k / n)), s: 1.1, k: "avenue" });
    };
    line(i0, j0, i1, j0); line(i0, j1, i1, j1); line(i0, j0 + 14, i0, j1 - 14); line(i1, j0 + 14, i1, j1 - 14);
    const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
    if (opt && opt.monument) {
      P.structs = P.structs || {};
      (P.structs.monuments = P.structs.monuments || []).push({ x: mx, z: mz, kind: "pylon", base: 38, h: 82 });
    }
    P.landmarks.push({ kind: "square", x: mx, z: mz, name: P.name + " Square" });
    P.square = { cell: key, x0: blk.x0, x1: blk.x1, z0: blk.z0, z1: blk.z1 };
    P.stats = stats(P);
    return P;
  }

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h | 0;
  }

  // =====================================================================
  //  STATS — the numbers the report and the map read
  // =====================================================================
  function stats(P) {
    const byType = {}, byUse = {}, hist = {};
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, units = 0, jobs = 0, floor = 0;
    for (const b of P.bldgs) {
      byType[b.type] = (byType[b.type] || 0) + 1;
      const band = b.st <= 1 ? "1" : b.st <= 2 ? "2" : b.st <= 4 ? "3-4" : b.st <= 9 ? "5-9" : b.st <= 19 ? "10-19" : b.st <= 39 ? "20-39" : "40+";
      hist[band] = (hist[band] || 0) + 1;
      const r = Math.hypot(b.w, b.d) / 2;
      minX = Math.min(minX, b.x - r); maxX = Math.max(maxX, b.x + r); minZ = Math.min(minZ, b.z - r); maxZ = Math.max(maxZ, b.z + r);
      const fa = b.w * b.d * (b.tiers ? 0.6 : 0.85) * (b.st || 1);
      floor += fa;
      if (b.type === "house") units += 1;
      else if (b.type === "row") units += b.st >= 3 ? 2 : 1;
      else if (b.type === "apt") units += Math.round(fa / 85);
      else if (b.type === "tower") { units += Math.round(fa * 0.35 / 95); jobs += Math.round(fa * 0.65 / 22); }
      else if (b.type === "office") jobs += Math.round(fa / 22);
      else if (b.type === "ware" || b.type === "strip" || b.type === "mall") jobs += Math.round(fa / 60);
    }
    for (const c of P.cells) byUse[c.use] = (byUse[c.use] || 0) + 1;
    const km = {};
    for (const s of P.streets) {
      let L = 0; for (let i = 0; i < s.pts.length - 1; i++) L += Math.hypot(s.pts[i + 1].x - s.pts[i].x, s.pts[i + 1].z - s.pts[i].z);
      km[s.k] = Math.round(((km[s.k] || 0) + L / 1000) * 100) / 100;
    }
    return {
      footprint: { minX: Math.round(minX), maxX: Math.round(maxX), minZ: Math.round(minZ), maxZ: Math.round(maxZ),
        w: Math.round(maxX - minX), d: Math.round(maxZ - minZ), km2: Math.round((maxX - minX) * (maxZ - minZ) / 1e4) / 100 },
      buildings: P.bldgs.length, byType: byType, storeyBands: hist, cells: byUse, streetKm: km,
      blocks: P.blocks.length, junctions: P.junctions.length, trees: P.trees.length, districts: P.districts.length,
      bridges: P.bridges.length, overpasses: P.overpasses.length, interchanges: P.interchanges.length,
      tallest: P.bldgs.reduce(function (m, b) { return Math.max(m, b.st || 0); }, 0),
      dwellings: units, population: Math.round(units * 2.4), jobs: jobs, floorAreaKm2: Math.round(floor / 1e4) / 100,
      planMs: P.ms,
    };
  }

  // =====================================================================
  //  AUDIT — the plan's own laws, checked in node and in the page
  //   • no building footprint on a street, a bulb, the river, a freeway,
  //     the rail or an obstacle
  //   • no two buildings overlap
  //   • every street reaches the arterial network (connectivity)
  //   • height falls off from the centre (mean storeys by envelope band)
  // =====================================================================
  function obbCorners(b) {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = b.w / 2, hd = b.d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(function (p) { return { x: b.x + p[0] * c + p[1] * s, z: b.z - p[0] * s + p[1] * c }; });
  }
  function obbOverlap(a, b) {
    const A = obbCorners(a), B = obbCorners(b);
    const axes = [];
    [A, B].forEach(function (P) { for (let i = 0; i < 2; i++) { const p = P[i], q = P[i + 1]; axes.push({ x: q.z - p.z, z: -(q.x - p.x) }); } });
    for (const ax of axes) {
      let a0 = 1e18, a1 = -1e18, b0 = 1e18, b1 = -1e18;
      for (const p of A) { const d = p.x * ax.x + p.z * ax.z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const p of B) { const d = p.x * ax.x + p.z * ax.z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      const L = Math.hypot(ax.x, ax.z) || 1;
      if (a1 <= b0 + 0.05 * L || b1 <= a0 + 0.05 * L) return false;
    }
    return true;
  }
  function audit(P) {
    const out = { onStreet: 0, onRiver: 0, onCorridor: 0, onObstacle: 0, overlaps: 0, disconnected: 0, streets: P.streets.length, bldgs: P.bldgs.length, bands: {}, examples: [] };
    // street hash for the audit (independent of the planner's)
    const SH = 64, sh = new Map();
    for (const s of P.streets) for (let i = 0; i < s.pts.length - 1; i++) {
      const a = s.pts[i], b = s.pts[i + 1], pad = s.w / 2;
      for (let ix = Math.floor((Math.min(a.x, b.x) - pad) / SH); ix <= Math.floor((Math.max(a.x, b.x) + pad) / SH); ix++)
        for (let iz = Math.floor((Math.min(a.z, b.z) - pad) / SH); iz <= Math.floor((Math.max(a.z, b.z) + pad) / SH); iz++) {
          const k = ix * 100003 + iz; let l = sh.get(k); if (!l) sh.set(k, l = []); l.push([s, a, b]);
        }
    }
    for (const b of P.bulbs || []) {
      for (let ix = Math.floor((b.x - b.r) / SH); ix <= Math.floor((b.x + b.r) / SH); ix++)
        for (let iz = Math.floor((b.z - b.r) / SH); iz <= Math.floor((b.z + b.r) / SH); iz++) {
          const k = ix * 100003 + iz; let l = sh.get(k); if (!l) sh.set(k, l = []); l.push([{ k: "bulb", w: b.r * 2 }, b, b]);
        }
    }
    function onStreet(x, z) {
      const l = sh.get(Math.floor(x / SH) * 100003 + Math.floor(z / SH)); if (!l) return null;
      for (const e of l) if (segDist(x, z, e[1].x, e[1].z, e[2].x, e[2].z) < e[0].w / 2 - 0.05) return e[0];
      return null;
    }
    const BH = 48, bh = new Map();
    for (const b of P.bldgs) {
      const r = Math.hypot(b.w, b.d) / 2;
      // sample the footprint (corners, edge midpoints, centre)
      const cs = obbCorners(b);
      const samples = cs.concat([{ x: b.x, z: b.z }], cs.map(function (p, i) { const q = cs[(i + 1) % 4]; return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; }));
      let hit = null;
      for (const p of samples) { hit = onStreet(p.x, p.z); if (hit) break; }
      if (hit) { out.onStreet++; if (out.examples.length < 6) out.examples.push({ bad: "street", type: b.type, x: b.x, z: b.z, street: hit.k }); }
      if (P.river) for (const p of samples) if (P.riverDist(p.x, p.z) < P.river.half) { out.onRiver++; break; }
      for (const c of P.corridors) {
        const hit2 = samples.some(function (p) { return (c.ax || (c.axis === "z" ? "x" : "z")) === "x" ? (Math.abs(p.x - c.at) < c.half && p.z > c.a0 && p.z < c.a1) : (Math.abs(p.z - c.at) < c.half && p.x > c.a0 && p.x < c.a1); });
        if (hit2) { out.onCorridor++; break; }
      }
      for (const o of P.obstacles) if (samples.some(function (p) { return inRect(o, p.x, p.z); })) { out.onObstacle++; break; }
      // overlaps via the bucket grid
      const ix0 = Math.floor((b.x - r) / BH), ix1 = Math.floor((b.x + r) / BH), iz0 = Math.floor((b.z - r) / BH), iz1 = Math.floor((b.z + r) / BH);
      const seen = new Set();
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const l = bh.get(ix * 100003 + iz); if (!l) continue;
        for (const o of l) {
          if (seen.has(o.id)) continue; seen.add(o.id);
          if (Math.hypot(o.x - b.x, o.z - b.z) > r + Math.hypot(o.w, o.d) / 2) continue;
          if (obbOverlap(o, b)) { out.overlaps++; if (out.examples.length < 12) out.examples.push({ bad: "overlap", a: o.type, b: b.type, x: b.x, z: b.z }); }
        }
      }
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) { const k = ix * 100003 + iz; let l = bh.get(k); if (!l) bh.set(k, l = []); l.push(b); }
    }
    // connectivity: union-find over streets that touch (endpoint on another
    // street's centreline, or two grid streets crossing)
    const parent = new Map();
    function find(a) { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; }
    function uni(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
    for (const s of P.streets) parent.set(s.id, s.id);
    for (const j of P.junctions) uni(j.a, j.b);
    for (const s of P.streets) {
      const ends = [s.pts[0], s.pts[s.pts.length - 1]];
      for (const e of ends) {
        const l = sh.get(Math.floor(e.x / SH) * 100003 + Math.floor(e.z / SH)); if (!l) continue;
        for (const q of l) { if (q[0] === s) continue; if (segDist(e.x, e.z, q[1].x, q[1].z, q[2].x, q[2].z) < q[0].w / 2 + 0.5) uni(s.id, q[0].id); }
      }
    }
    // the arterial network's biggest component is "the city"
    const size = new Map();
    for (const s of P.streets) { const r = find(s.id); size.set(r, (size.get(r) || 0) + 1); }
    let bigR = null, big = 0; for (const [r, n] of size) if (n > big) { big = n; bigR = r; }
    for (const s of P.streets) if (find(s.id) !== bigR) out.disconnected++;
    out.components = size.size;
    // height falls off: mean storeys per envelope band
    const acc = {};
    for (const b of P.bldgs) {
      const e = P.envelope(b.x, b.z), band = e < 0.25 ? "0-0.25" : e < 0.5 ? "0.25-0.5" : e < 0.75 ? "0.5-0.75" : e < 1 ? "0.75-1" : "1+";
      const a = acc[band] || (acc[band] = { n: 0, s: 0, max: 0 }); a.n++; a.s += b.st || 1; a.max = Math.max(a.max, b.st || 1);
    }
    for (const k in acc) out.bands[k] = { n: acc[k].n, mean: Math.round(acc[k].s / acc[k].n * 10) / 10, max: acc[k].max };
    out.ok = out.onStreet === 0 && out.onRiver === 0 && out.onCorridor === 0 && out.onObstacle === 0 && out.overlaps === 0 && out.disconnected === 0;
    return out;
  }

  const API = { plan: plan, stats: stats, audit: audit, translatePlan: translatePlan, ceremonialSquare: ceremonialSquare, TIERS: TIERS, LOOKS: LOOKS, h01: h01, vnoise: vnoise, segDist: segDist };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G && G.CBZ) {
    G.CBZ.metroPlan = plan; G.CBZ.metroPlanStats = stats; G.CBZ.metroPlanAudit = audit; G.CBZ.metroPlanLib = API;
  }
})(typeof window !== "undefined" ? window : globalThis);
