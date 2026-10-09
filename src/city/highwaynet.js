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

   DRAW BUDGET: highways.js merges each route per ~400 m chunk (deck, paint,
   furniture); far chunks drop paint/furniture. The R5/R1 interchange
   (city/interchange.js) is planned here and built in the late pass.

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
    // island_military CW_MAXX: the Brandt deck's EAST end is pinned at the
    // authored mainland shore point while the base slides with the dial
    const brandtEastX = -133;
    // WHAT FOUNDRY ROW ACTUALLY MEETS. It was written to "T flush onto Route
    // 3's deck", but Route 3 runs NORTH from the Goldspire mouth; once the
    // re-lay pushed Foundry Row south of that mouth it met the Goldspire LINK
    // (minicities.js, a 24 m causeway deck, half 14.4) instead — and stopped
    // 15.3 m short of the line, i.e. ~1 m of grass short of that deck with a
    // square end. Dock on whichever deck is really there.
    const r4EndX = foundryRowZ > goldMouthZ ? goldX - CW_HALF : goldX - HALF;

    // ---- the loop's free-country lanes (verified ≥40m clear of every
    //      registered footprint incl. Greater Mercy and the nations — the
    //      build-time clearance sweep below re-proves this every build) -----
    // WORLD_LAYOUT_V2 MOVED THE LAND UNDERNEATH THESE. Every DOCK in this file
    // derives from CBZ.worldOff and therefore followed its landmass when the
    // stage-3 spread pushed the regions apart — but these seven free-country
    // lane constants are raw literals measured against the stage-2 gaps, so
    // they stayed put while the continents moved out from under them. The
    // build-time clearanceSweep below only console.warns, so nothing threw:
    // route R1 simply began cutting through Fort Brandt, the Saltlands, Coyle
    // Valley and the speedway, silently.
    //
    // WORLD_SCALE_V4 MOVED IT AGAIN — AND THIS TIME THE BIOMES GREW TOO, so a
    // lane that was 40 m clear of a rect could be inside it without the rect
    // having moved at all. All seven are re-measured below against the stage-4
    // geometry, each showing the two edges it threads between; the eighth
    // literal (R5's dog-leg) and R7's crossing z are re-derived further down.
    // A lane is chosen as the MIDPOINT of the corridor it runs in wherever the
    // corridor has two sides, so the next world move has the largest possible
    // margin before it needs this table again.
    // The STAGE layout.js resolved to, not the raw flag — WORLD_SCALE_V4 rides
    // on top of WORLD_LAYOUT_V2, and a stage-2 world must keep stage-2 lanes.
    //
    // WORLD_SCALE_V5 MOVED TWO OF THEM, AND ONLY TWO. The Saltlands went 10x
    // by area (x 1719..6171, z -301..4455), which puts the Continental Loop's
    // south leg (southZ 1650) and its east leg (eastX 3700) INSIDE the basin —
    // 2 km and 2.5 km of six-lane motorway through open erg respectively. The
    // other five lanes are untouched because the basin grew east and south,
    // away from every one of them: dunesX 1300 still threads the snow/desert
    // gap (desert minX did not move), timberX/corridorZ/westX/foothillZ are
    // all west or north of a biome that only went the other way.
    const V5 = (CBZ.WORLD_LAYOUT_STAGE || 1) >= 5;
    const V4 = (CBZ.WORLD_LAYOUT_STAGE || 1) >= 4;
    //  name        stage-4 value   the corridor it threads (stage-4 world AABBs)
    //  timberX      -560   forest maxX -894 .. snow minX -196; also >= 273 off
    //                      the mainland harbour band (x -165 +- 97) and inside
    //                      the Brandt deck's x-span (-1280 .. -133).
    //  corridorZ   -1600   forest maxZ -1771 .. military minZ -1430 (midpoint
    //                      -1600.5): 151 m clear of the trees, 150 of the base.
    //  westX       -2380   west of foundry minX -2245 and neonreef minX -2240
    //                      by 115/120 m, and 1734 m east of mbeya_east -4114.
    //  southZ       1650   south of goldspire maxZ 1490 by 140 m (the civic
    //                      campus ends at 1378) and 448 m south of the desert.
    //  eastX        3700   east of farmland maxX 3200 (480 m) and desert maxX
    //                      3124 (556), west of keshtown minX 4200 (488).
    //  foothillZ   -3400   south of Greater Mercy maxZ -4279 by 879 m, north of
    //                      farmland minZ -2570 by 810.
    //  dunesX       1300   snow maxX 896 .. desert minX 1716: 392 m of dune and
    //                      404 m of snowfield either side.
    const timberX = V4 ? -560 : -400;          // forest/snow corridor
    const corridorZ = V4 ? -1600 : -1415;      // forest/military gap
    const westX = V4 ? -2380 : -1960;          // west of neonreef/foundry
    //  stage-5 re-measure (the two the basin now covers):
    //  southZ       4700   south of desert maxZ 4455 by 245 m and 3.2 km south
    //                      of goldspire maxZ 1490; still 2.0 km inside the
    //                      stage-5 plate's south edge (z 6700).
    //  eastX        6800   east of desert maxX 6171 (629 m), west of keshtown
    //                      minX 7400 (600) and veridia minX 7455 — the
    //                      midpoint of the corridor between the erg's new east
    //                      shore and the nations that moved to clear it.
    const southZ = V5 ? 4700 : (V4 ? 1650 : 1230);   // south of goldspire/desert
    const eastX = V5 ? 6800 : (V4 ? 3700 : 2560);    // east of desert/farmland
    const foothillZ = V4 ? -3400 : -3250;      // south of Greater Mercy
    const dunesX = V4 ? 1300 : 1200;           // snow/desert gap

    // Deck endpoints stop FLUSH at the docked deck's edge (±HALF); the road
    // RECORD extends to the docked road's centreline (recA/recB) so
    // vehicles.js findRoad (9m snap) can hop the junction — the HWY-4
    // connector doctrine, folded into the table.
    return [
      {
        id: "R1", name: "Continental Loop", width: WIDTH, lanesPerDir: 3, fillet: 140,
        pts: [
          { x: timberX, z: brandtZ - CW_HALF },          // dock: Brandt causeway north edge
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
        id: "R2", name: "Cape Spine", width: WIDTH, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: capeX, z: diamondZ + CW_HALF },           // dock: Diamond causeway south edge
          { x: capeX, z: capeMouthZ },                   // dock: Cape Harbor link mouth
        ],
        recA: diamondZ, recB: capeMouthZ + 20,
        docks: [{ x: capeX, z: diamondZ, note: "Diamond causeway" },
                { x: capeX, z: capeMouthZ, note: "Cape Harbor link" }],
      },
      {
        id: "R3", name: "Goldspire Run", width: WIDTH, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: goldX, z: goldMouthZ },                   // dock: Goldspire link mouth
          { x: goldX, z: -200 },
          { x: capeX - HALF, z: -200 },                  // T flush onto Route 2's deck
        ],
        recA: goldMouthZ + 20, recB: capeX,
        docks: [{ x: goldX, z: goldMouthZ, note: "Goldspire link" }],
      },
      {
        id: "R4", name: "Foundry Row", width: WIDTH, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: foundryMouthX, z: foundryRowZ },          // dock: Foundry link mouth
          { x: r4EndX, z: foundryRowZ },                 // T flush onto the Goldspire link / Route 3
        ],
        recA: foundryMouthX - 20, recB: goldX,
        docks: [{ x: foundryMouthX, z: foundryRowZ, note: "Foundry link" }],
      },
      {
        id: "R5", name: "West Shore Highway", width: WIDTH, lanesPerDir: 3, fillet: 60,
        pts: [
          { x: westX + HALF, z: -700 },                  // T flush onto Route 1's west deck
          // -1500, not -1200: WORLD_LAYOUT_V2 widened Fort Brandt's span to
          // x[-1420,-940], so the old dog-leg ran straight through the base.
          // RE-MEASURED for WORLD_SCALE_V4 and deliberately UNCHANGED: the base
          // moved to x[-1760,-1280] z[-1430,-930], so -1500 is now inside its
          // x-span — but this leg runs z -700..-420, which is 230 m SOUTH of
          // the base's southern edge, so it never meets it. What the leg does
          // have to clear is the airport (x[-1120,70] z[-280,40]): the turn
          // east at z -420 passes 120 m north of its apron. Both hold.
          { x: -1500, z: -700 },
          { x: -1500, z: -420 },
          { x: halloranX - CW_HALF, z: -420 },           // dock: Halloran causeway west edge
        ],
        recA: westX, recB: halloranX,
        docks: [{ x: halloranX, z: -420, note: "Halloran causeway" }],
      },
      {
        id: "R6", name: "Southgate Spur", width: WIDTH, lanesPerDir: 3, fillet: 60,
        pts: [
          // -280, not -240: originally chosen to clear the Goldspire Civic
          // Campus (minX -230 after the spread), which the old x cut through.
          // The campus was deleted 2026-08-15; the spur stays at -280 because
          // every deck T, fillet and dock length downstream is solved off it —
          // moving it now would reroute the network for no gain.
          { x: -280, z: southZ - HALF },                 // T flush onto Route 1's south deck
          { x: -280, z: foundryRowZ + HALF },            // T flush onto Foundry Row's deck
        ],
        recA: southZ, recB: foundryRowZ,
        docks: [],
      },
      {
        id: "R7", name: "Mercy Connector", width: WIDTH, lanesPerDir: 3, fillet: 60,
        // THE EIGHTH LITERAL, NOW DERIVED. This crossing was authored as
        // z = -1000, which is the value `brandtZ` happened to have when it was
        // written — i.e. it is the Brandt causeway's own centreline, the south
        // end of Route 1's first leg, and it only looked like a constant. Left
        // as -1000 a world move would have floated this connector off the leg
        // it T's into and off the Mercy lane it docks against. It is the same
        // number in the stage-3 world, so this changes nothing there.
        //
        // AND IT STARTS WHERE THE BRANDT DECK ENDS. "T flush onto Route 1's
        // first leg" stopped being true when the base moved north: brandtZ is
        // the Brandt causeway's own centreline, so this connector was laid ON
        // TOP of that causeway from Route 1 to its pinned east end (411 m of
        // two decks stacked, two sets of lane paint 0.9 m apart), and the
        // Brandt deck's paint, rumble strips and median ended abruptly in the
        // middle of this one. Where the Brandt deck reaches past Route 1, the
        // connector now carries on from its end, flush, end to end.
        pts: [
          { x: Math.max(timberX + HALF, brandtEastX), z: brandtZ },   // Brandt deck end (or T onto Route 1)
          { x: mercyX - CW_HALF, z: brandtZ },           // dock: Mercy causeway west edge
        ],
        recA: brandtEastX > timberX + HALF ? brandtEastX - 20 : timberX, recB: mercyX,
        docks: [{ x: mercyX, z: brandtZ, note: "Mercy causeway" }],
      },
    ].concat(V5 ? townLinks(eastX, westX) : []);
  }

  // ============================================================
  //  THE COUNTRY ROADS (layout wave 2, 2026-10-08). tools/layout-audit.mjs
  //  measured nine settlements whose streets touched no other road: the
  //  nations east of the Loop (Veridia + Lowport, Keshtown + Nur Hollow +
  //  Adar's Well, Solara) and Mbeya with its three villages in the west.
  //  You could only reach them across open grass. Each now has a REAL
  //  two-lane country road from the same kit as every highway (one 3.6 m
  //  lane each way, 1.9 m shoulders, centre line, edge furniture, relief
  //  flattened under it by the same corridor gate, a drivable record per
  //  leg that T's at grade into the Loop exactly as Routes 5/6 do — the
  //  Loop's barriers gap at every junction a record makes).
  //
  //  Every coordinate is a TOWN STREET's centreline or edge, read off the
  //  towngen grids these places build (countries.js; numbers measured on
  //  the live world, seed-independent: the nations' grids are authored).
  //  A deck stops flush at the street edge it meets and its record runs on
  //  to the street's centreline (recA / recB), the HWY-4 dock doctrine.
  //  The route's final point is always inside the place it serves, so the
  //  clearance law (roadrules.js) lets the arriving leg in.
  // ============================================================
  const RURAL_W = 11;                          // 3.6 + 3.6 lanes + 1.9 m shoulders
  function townLinks(eastX, westX) {
    const LX = eastX + HALF, WX = westX - HALF;   // the Loop's east / west deck edges
    const R = function (id, name, pts, recA, recB, fillet) {
      return { id: id, name: name, width: RURAL_W, lanesPerDir: 1, median: false, rural: true, fillet: fillet || 40,
        pts: pts, recA: recA, recB: recB, docks: [] };
    };
    return [
      // east of the Loop: the nations
      R("C1", "Veridia Road", [{ x: LX, z: -400 }, { x: 7465, z: -400 }], eastX, 7472),
      R("C2", "Lowport Lane", [{ x: 7600, z: -624 }, { x: 7600, z: -523 }], -630, -516),
      R("C3", "Kesh Road", [{ x: LX, z: -2265.5 }, { x: 7411, z: -2265.5 }], eastX, 7417.5),
      R("C4", "Nur Hollow Lane", [{ x: 7501.5, z: -2157 }, { x: 7501.5, z: -2069 }], -2163.5, -2063.5),
      R("C5", "Adar's Well Lane", [{ x: 7589, z: -2238.5 }, { x: 7705.6, z: -2238.5 }], 7582.5, 7711.1),
      R("C6", "Solara Road", [{ x: LX, z: 1620 }, { x: 7679.5, z: 1620 }], eastX, 7686),
      // west of the Loop: Mbeya and its villages. The road leaves the Loop's
      // west leg 60 m south of the corner fillet's end (the arc spans z
      // -1600..-1460) and turns on 40 m fillets onto Ruvu's main street.
      R("C7", "Mbeya Road", [{ x: WX, z: -1400 }, { x: -2700, z: -1400 }, { x: -2700, z: -1558.5 }, { x: -4130.2, z: -1558.5 }], westX, -4135.7),
      R("C8", "Ruvu Lane", [{ x: -4356, z: -1576 }, { x: -4231.9, z: -1576 }], -4362, -4226.4),
      R("C9", "Kolo Lane", [{ x: -4648.4, z: -1576 }, { x: -4524, z: -1576 }], -4653.9, -4518),
      R("C10", "Tende Lane", [{ x: -4439.9, z: -1771.8 }, { x: -4439.9, z: -1678 }], -1777.3, -1672),
    ].concat(saltlandsRoad(eastX));
  }
  // The Saltlands spine (biome_desert.js, published as CBZ.DESERT_SPINE) ran
  // to the basin's east shore and stopped in the sand. It carries on to the
  // Continental Loop's east leg, so Dry Gulch is reached from both sides.
  function saltlandsRoad(eastX) {
    const S = CBZ.DESERT_SPINE;
    if (!S || !isFinite(S.z) || !isFinite(S.east) || S.east >= eastX - HALF - 20) return [];
    return [{ id: "C11", name: "Saltlands Road", width: RURAL_W, lanesPerDir: 1, median: false, rural: true, fillet: 40,
      pts: [{ x: eastX - HALF, z: S.z }, { x: S.east, z: S.z }], recA: eastX, recB: S.east, docks: [] }];
  }

  // The table is pure data off the layout dial, so a builder that runs
  // BEFORE the network (a mini-city at order 34) can ask where the lanes will
  // be and dock onto one instead of plugging into empty country.
  CBZ.highwayNetTable = function () {
    if (!CBZ.CONFIG || CBZ.CONFIG.HIGHWAY_NET_V2 === false) return [];
    return routeTable();
  };
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
        seg.w = route.width; seg.lanesPerDir = route.lanesPerDir; seg.laneW = LANE_W;
        if (route.median !== false) { seg.median = true; seg.medianW = MEDIAN_W; }
        seg.route = route.id;
        if (route.rural) seg.rural = true;
        // ENFORCE (roadrules.js): dock at a place's edge, never cross it. The
        // route's FINAL point is the destination, so the leg that arrives is
        // allowed in and a leg that merely passes a town is cut at the kerb.
        if (CBZ.roadClamp) CBZ.roadClamp(seg, { dest: pts[pts.length - 1], owner: route.id, city: city });
        if (roads) { roads.push(seg); route.roads.push(seg); }
        // map/waterfield region — "Link" name: fullmap draws it as road,
        // polwar's front search (/causeway|bridge/) and the shore field's
        // land-holding both ignore it (established link semantics).
        CBZ.registerCityRegion(city, {
          name: route.name + " Link " + (i + 1), subtitle: route.rural ? "Country Road" : "Highway Network", kind: "rect",
          minX: Math.min(a.x, b.x) - route.width / 2, maxX: Math.max(a.x, b.x) + route.width / 2,
          minZ: Math.min(a.z, b.z) - route.width / 2, maxZ: Math.max(a.z, b.z) + route.width / 2,
          pad: 1,
        });
      }
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
