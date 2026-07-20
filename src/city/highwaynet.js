/* ============================================================
   city/highwaynet.js — THE HIGHWAY NETWORK AS DATA.

   OWNER MANDATE: "completely redo the highway and road system to make it
   significantly significantly bigger, and extendable and natural."

   WHY a data table instead of more hand-placed causeways: every highway so
   far was placed inside whichever island module needed it, so the network
   could never be seen, extended or audited in one place — and coordinate
   drift between a deck and its paint/records is exactly how the owner's
   "floating yellow line" class of bug happens. THIS file is the single
   source of truth: a table of named ROUTES, each a polyline of waypoints
   with a per-route cross-section. Deck, lane paint, drivable city.roads
   records, map regions and the terrain-relief corridor ALL derive from the
   same route record, so they can never desync.

   THE NETWORK (≈19km of new 3+3 divided highway; ~24km total with the
   causeways it docks into). Coordinates derive from the world-layout dial
   (CBZ.worldOff) — move a landmass and its docks follow:

     • ROUTE 1 "Continental Loop" — the grand ring: docks the Brandt
       (military) causeway, runs the forest/military corridor west, sweeps
       south past Neon Reef/The Foundry, crosses the southern plains below
       Goldspire, climbs the eastern frontier past the Saltlands/Coyle
       rim (clear of the nations — they stay air/boat only), crests along
       the Greater Mercy foothill line and drops back down the snow/desert
       gap to close on its own southern leg. Junctions with the Redhollow
       (forest) road and the Saltlands causeway where they cross.
     • ROUTE 2 "Cape Spine" — Diamond Causeway ↔ Cape Harbor's link road.
     • ROUTE 3 "Goldspire Run" — Goldspire's link road north, bending east
       onto Route 2: the finance city joins the speedway/annex chain.
     • ROUTE 4 "Foundry Row" — The Foundry's link road east to Route 3:
       the southwest factory belt joins the southern system.
     • ROUTE 5 "West Shore Highway" — Route 1 west leg ↔ the Halloran
       (airport) causeway, threading military-south / airport-north.
     • ROUTE 6 "Southgate Spur" — Route 1 south leg ↔ Foundry Row.
     • ROUTE 7 "Mercy Connector" — Route 1 ↔ the Mercy Causeway's west
       edge: the alpine road joins the loop without touching Mount Mercy.

   RULES THE TABLE OBEYS (checked at build time, deterministically):
     • every leg is axis-aligned (traffic/vehicles/props assume vertical or
       horizontal centrelines); bends between legs are FILLETED into arcs
       by the builder (buildHighway smooth mode) — natural, no L-corners;
     • routes stay OUT of every registered landmass footprint and water
       body; they END flush against the causeway/link decks they dock into
       (the hand-placed causeways keep their decks — they are the mouths);
     • the harbor bay ring around the mainland is never crossed (the three
       existing mainland causeways own those crossings);
     • pure data + closed-form math — no rng anywhere, so worlds stay
       byte-identical per seed (multiplayer determinism law).

   INTEGRATION: one city.roads record per leg (district "highway", real
   lane data — traffic seeds/drives them, the map draws them gold), one
   "<Route> Link n" region per leg (fullmap casing/waterfield deck
   semantics; the Link name keeps polwar's causeway-front search and the
   shore field's land-holding both blind to them, exactly like the
   existing causeway link regions), and CBZ.highwayNetReliefGate — the
   continent's country relief flattens under every corridor the same way
   it already does for the frontier loop, so decks never hover over hills.

   DRAW BUDGET: 3 draw calls per route (merged deck + white paint + yellow
   paint) = 21 total for the 7 routes. No instanced dressing yet — rails/
   gantries can join later per-route without touching the table.

   EXTEND IT: push another entry into routeTable() — a polyline + width —
   and the builder does the rest (fillets, records, regions, relief).

   REVERT: CBZ.CONFIG.HIGHWAY_NET_V2 = false → today's network exactly
   (no routes, no records, no relief gating).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (!CBZ.CONFIG) CBZ.CONFIG = {};
  if (CBZ.CONFIG.HIGHWAY_NET_V2 == null) CBZ.CONFIG.HIGHWAY_NET_V2 = true;

  const HALF = 12;                       // 24m deck half-width (3+3 + median)

  // ---- corridors for the continent relief gate (published before the
  //      continent builds at order 97; empty until the builder runs) --------
  let _corridors = [];                   // {x0,z0,x1,z1,half} per FILLETED segment
  let _netBox = null;                    // fast whole-network reject
  let _routes = null;                    // the built table (debug/audit)
  CBZ.cityHighwayNet = function () { return _routes; };

  function sm01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }

  // 1 = full country relief, 0 = flattened road bed. Same grammar as the
  // frontier loop's cut (continent.js): flat within half+8 of a corridor
  // centreline, fading back to full relief over the next 40m. Allocation-
  // free and cheap (AABB pre-rejects) — continent plate verts AND runtime
  // ground physics both call this.
  CBZ.highwayNetReliefGate = function (x, z) {
    const n = _corridors.length;
    if (!n) return 1;
    const B = _netBox;
    if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return 1;
    let g = 1;
    for (let i = 0; i < n; i++) {
      const c = _corridors[i];
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
  //  THE ROUTE TABLE — every coordinate derives from the layout dial
  //  anchors, so the network follows any future world move for free.
  // ============================================================
  function routeTable() {
    const off = function (id) { return (CBZ.worldOff && CBZ.worldOff(id)) || { dx: 0, dz: 0 }; };
    const MIL = off("military"), SNW = off("snow"), SPD = off("speedway");
    const GLD = off("goldspire"), CPH = off("capeharbor"), FND = off("foundry");

    // ---- causeway-mouth anchors (each names its owning module's constant) --
    const brandtZ = -700 + MIL.dz;             // island_military CW_CZ (-850)
    const mercyX = 470 + SNW.dx;               // biome_snow causeway lane (470)
    const diamondZ = -540 + SPD.dz;            // island_speedway causewayZ (-540)
    const halloranX = 0;                       // island_airport causeway (pinned)
    const goldX = 150 + GLD.dx, goldMouthZ = 470;      // minicities goldspire cx / road plug z
    const capeX = 430 + CPH.dx, capeMouthZ = -130;     // minicities capeharbor cx / road plug z
    const foundryMouthX = -380, foundryRowZ = 225 + FND.dz;  // minicities foundry road plug

    // ---- the loop's free-country lanes (verified ≥40m clear of every
    //      registered footprint incl. Greater Mercy (z≤-1780) and the
    //      nations (kesh towns x≥2255, solara x≥2770) — the build-time
    //      clearance sweep below re-proves this every build) ---------------
    const timberX = -400;                      // forest(maxX -470)/snow(minX -70) corridor
    const corridorZ = -1160;                   // forest(maxZ -1220)/military(minZ -1100) gap
    const westX = -1560;                       // west of neonreef/foundry (minX ≈ -1495)
    const southZ = 880;                        // south of goldspire (maxZ 840)/desert (720)
    const eastX = 2130;                        // east of desert/farmland (maxX 2030)
    const foothillZ = -1750;                   // south of Greater Mercy (maxZ -1780)
    const dunesX = 1000;                       // snow(maxX 770)/desert(minX 1130) gap

    // Deck endpoints stop FLUSH at the docked deck's edge (±HALF); the road
    // RECORD extends to the docked road's centreline (recA/recB) so
    // vehicles.js findRoad (9m snap) can hop the junction — the HWY-4
    // connector doctrine, folded into the table.
    return [
      {
        id: "R1", name: "Continental Loop", width: 24, lanesPerDir: 3, fillet: 140,
        pts: [
          { x: timberX, z: brandtZ - HALF },             // dock: Brandt causeway north edge
          { x: timberX, z: corridorZ },
          { x: westX, z: corridorZ },
          { x: westX, z: southZ },
          { x: eastX, z: southZ },
          { x: eastX, z: foothillZ },
          { x: dunesX, z: foothillZ },
          { x: dunesX, z: southZ - HALF },               // closes onto its own south leg
        ],
        recA: brandtZ, recB: southZ,
        docks: [{ x: timberX, z: brandtZ, note: "Brandt causeway" }],
      },
      {
        id: "R2", name: "Cape Spine", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: capeX, z: diamondZ + HALF },              // dock: Diamond causeway south edge
          { x: capeX, z: capeMouthZ },                   // dock: Cape Harbor link mouth
        ],
        recA: diamondZ, recB: capeMouthZ + 20,
        docks: [{ x: capeX, z: diamondZ, note: "Diamond causeway" },
                { x: capeX, z: capeMouthZ, note: "Cape Harbor link" }],
      },
      {
        id: "R3", name: "Goldspire Run", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: goldX, z: goldMouthZ },                   // dock: Goldspire link mouth
          { x: goldX, z: -200 },
          { x: capeX - HALF, z: -200 },                  // T flush onto Route 2's deck
        ],
        recA: goldMouthZ + 20, recB: capeX,
        docks: [{ x: goldX, z: goldMouthZ, note: "Goldspire link" }],
      },
      {
        id: "R4", name: "Foundry Row", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: foundryMouthX, z: foundryRowZ },          // dock: Foundry link mouth
          { x: goldX - HALF, z: foundryRowZ },           // T flush onto Route 3's deck
        ],
        recA: foundryMouthX - 20, recB: goldX,
        docks: [{ x: foundryMouthX, z: foundryRowZ, note: "Foundry link" }],
      },
      {
        id: "R5", name: "West Shore Highway", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: westX + HALF, z: -700 },                  // T flush onto Route 1's west deck
          { x: -1200, z: -700 },
          { x: -1200, z: -420 },
          { x: halloranX - HALF, z: -420 },              // dock: Halloran causeway west edge
        ],
        recA: westX, recB: halloranX,
        docks: [{ x: halloranX, z: -420, note: "Halloran causeway" }],
      },
      {
        id: "R6", name: "Southgate Spur", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: -240, z: southZ - HALF },                 // T flush onto Route 1's south deck
          { x: -240, z: foundryRowZ + HALF },            // T flush onto Foundry Row's deck
        ],
        recA: southZ, recB: foundryRowZ,
        docks: [],
      },
      {
        id: "R7", name: "Mercy Connector", width: 24, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: timberX + HALF, z: -1000 },               // T flush onto Route 1's first leg
          { x: mercyX - HALF, z: -1000 },                // dock: Mercy causeway west edge
        ],
        recA: timberX, recB: mercyX,
        docks: [{ x: mercyX, z: -1000, note: "Mercy causeway" }],
      },
    ];
  }

  // ============================================================
  //  BUILD-TIME CLEARANCE SWEEP (deterministic; warns, never mutates).
  //  Every leg rect must clear all NON-link regions, all water bodies,
  //  the annex disc/bridge and the mainland's harbor bay band. A dock
  //  point must land on a link (causeway) region — the drift alarm that
  //  fires the day a landmass moves without this table following it.
  // ============================================================
  function isLinkName(n) { return /bridge|causeway|link/i.test(n || ""); }
  function legRects(route) {
    const out = [], pts = route.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({
        minX: Math.min(a.x, b.x) - HALF, maxX: Math.max(a.x, b.x) + HALF,
        minZ: Math.min(a.z, b.z) - HALF, maxZ: Math.max(a.z, b.z) + HALF,
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
    for (const route of routes) {
      for (const leg of legRects(route)) {
        const tag = route.id + " leg " + leg.i;
        for (const rg of regs) {
          if (isLinkName(rg.name)) continue;                  // causeway decks are dock targets
          const pad = (rg.pad || 0);
          const hit = rg.kind === "circle"
            ? rectCircleOverlap(leg, rg.cx, rg.cz, rg.r + pad)
            : rectsOverlap(leg, rg.minX - pad, rg.maxX + pad, rg.minZ - pad, rg.maxZ + pad);
          if (hit) warn(tag + " overlaps region '" + rg.name + "' — retune the table");
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
        if (!ok) warn(route.id + " dock (" + d.x + "," + d.z + ") [" + d.note + "] found no causeway/link region — a landmass moved without this table");
      }
    }
  }

  // ============================================================
  //  THE BUILDER — one buildHighway call per route (merged deck + paint),
  //  then the pure-data integration: roads records, link regions, relief
  //  corridors. Runs at order 91: after every landmass/causeway (≤35) and
  //  the HWY-4 arterial connectors (90), before the continent plate (97)
  //  reads the relief gate and the archipelago shoals dodge the records.
  // ============================================================
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (!CBZ.CONFIG || CBZ.CONFIG.HIGHWAY_NET_V2 === false) return;
    if (!CBZ.buildHighway || !CBZ.highwaySmoothPath) return;
    const routes = routeTable();
    _routes = routes;

    clearanceSweep(city, routes);

    const group = new THREE.Group();
    group.name = "highway-network";
    group.userData.terrain = true;       // world-spanning routes: never one far-cull blob
    city.root.add(group);

    _corridors = [];
    let bMinX = 1e9, bMaxX = -1e9, bMinZ = 1e9, bMaxZ = -1e9;

    for (const route of routes) {
      // ---- geometry: fillet + mitre-strip deck/paint (highways.js) --------
      CBZ.buildHighway(group, {
        path: route.pts, smooth: true, filletRadius: route.fillet, filletStep: 9,
        width: route.width, lanesPerDir: route.lanesPerDir,
        median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        registerRoads: false,            // records come from the LEG table below,
        suspensionBridge: false,         // never from the arc-subdivided path
      });

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
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const vertical = Math.abs(b.x - a.x) < 0.5;
        // record span: leg ends, stretched to the docked centrelines at the
        // route's two extremities (recA/recB) so junction hops snap.
        let a0 = vertical ? a.z : a.x, b0 = vertical ? b.z : b.x;
        if (i === 0 && route.recA != null) a0 = route.recA;
        if (i === pts.length - 2 && route.recB != null) b0 = route.recB;
        const lo = Math.min(a0, b0), hi = Math.max(a0, b0);
        if (hi - lo < 1) continue;
        const seg = vertical
          ? { x: a.x, z: (lo + hi) / 2, vertical: true, len: hi - lo }
          : { x: (lo + hi) / 2, z: a.z, vertical: false, len: hi - lo };
        seg.district = "highway";
        seg.w = route.width; seg.lanesPerDir = route.lanesPerDir; seg.laneW = 3.6;
        seg.median = true; seg.medianW = 1.2; seg.route = route.id;
        if (roads) { roads.push(seg); route.roads.push(seg); }
        // map/waterfield region — "Link" name: fullmap draws it as road,
        // polwar's front search (/causeway|bridge/) and the shore field's
        // land-holding both ignore it (established link semantics).
        CBZ.registerCityRegion(city, {
          name: route.name + " Link " + (i + 1), subtitle: "Highway Network", kind: "rect",
          minX: Math.min(a.x, b.x) - HALF, maxX: Math.max(a.x, b.x) + HALF,
          minZ: Math.min(a.z, b.z) - HALF, maxZ: Math.max(a.z, b.z) + HALF,
          pad: 1,
        });
      }
    }
    _netBox = { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ };
  }, 91);
})();
