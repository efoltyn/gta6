/* ============================================================
   city/minicities.js — drop the standalone mini-city RECIPES into the
   empty map bands as self-registering landmasses with skylines (T4).

   WHY (owner's why-first law): the archipelago had wide DEAD bands between
   the mainland core and the far biomes. citytemplates.js answers each one
   with an ECONOMY (port / finance / casino / factory). This module is the
   PLACER: for every standalone template it (a) picks a CLEAR footprint in
   open map space (verified against the known island/biome rects), (b) lays
   a ground pad + seeds placement, (c) calls CBZ.buildTown — now that the
   keystone (T1) wired the arena, EVERY shop/home/road registers itself into
   Zillow/shops/jobs automatically, (d) grows a real SKYLINE on the central
   lots (mid-rise towers, height-capped UNDER the mainland core so downtown
   still reads as downtown — CH3/CH6), (e) registers the walkable region +
   a causeway toward the nearest road so you can drive there, and (f) drops
   a work-anchor at the central shops so NPCs commute.

   DRAW-CALL DISCIPLINE: a city is ~30-60 buildings, each an enterable shell
   that batches via cityMakeBuilding's instanced glass + the wall batcher.
   The ground pad / causeway decks are single merged-or-flat planes. Tower
   count is capped by towerFrac. Each builder is fully try/caught (worldmap
   contract) so one bad city can never take down the world.

   The two BIOME-TIED recipes (harvestmarket→farmland, pinecrest→snow) are
   NOT placed here — biome_farmland.js (T7) + biome_snow.js (T8) drop those
   inside their own footprints.

   Loads AFTER citytemplates.js + the biome scripts (index.html order), and
   registers at landmass order 34 (after biomes/placement at 30-33).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const BGU = THREE.BufferGeometryUtils;

  // ---- the 4 standalone placements (all footprints VERIFIED clear of the
  //      known island/biome rects: mainland(0,-700 ±~184), annex(348,-700 r120),
  //      speedway(470,-330 r200), airport(-40,-120 rect), military(-620,-700),
    //      desert(1115,150 ±445,470 → x[670,1560] z[-320,620], MASSIVE),
  //      forest(-560,-1350), snow(350,-1450), farmland(1180,-880)).
  //      Each city is its OWN biome string so crowd/regionlife populate it. The
  //      `road` point is where its causeway plugs toward the existing network.
  //      STAGE-2 MAP ENLARGEMENT: each city rides the world-layout dial
  //      (world/layout.js) like the biomes — neonreef/foundry slide west with
  //      the airport (preserving the authored Neon Reef 50u seam), goldspire/
  //      capeharbor slide south off the mainland shore. Mainland-side `road`
  //      plug points stay authored; neonreef's plugs the AIRPORT's west edge,
  //      so it re-derives from the airport anchor (butt-exact — the old fixed
  //      -860 overlapped Halloran Field by 40u, a standing audit clash). ----
  const _MOFF = function (id) { return (CBZ.worldOff && CBZ.worldOff(id)) || { dx: 0, dz: 0 }; };
  const _OG = _MOFF("goldspire"), _OC = _MOFF("capeharbor"), _ON = _MOFF("neonreef"), _OF = _MOFF("foundry");
  // Halloran Field west edge (island_airport.js A_MINX). Only the ENLARGED
  // world butts the causeway to it — the compact world keeps its authored
  // -860 plug (40u inside the field) so the flag-off world stays identical.
  const _EN = !!(CBZ.CONFIG && CBZ.CONFIG.WORLD_ENLARGE_V2 !== false);
  const _NR_PLUG_X = _EN ? (-900 + _MOFF("airport").dx) : -860;
  // WORLD_LAYOUT_V2 (world/layout.js owns the flag; this only mirrors the
  // default for a build without it). Two behaviours ride it here — see
  // buildMiniCity: AUTHORED-FRAME SEEDING and the SIZE GRADIENT.
  if (CBZ.CONFIG && CBZ.CONFIG.WORLD_LAYOUT_V2 == null) CBZ.CONFIG.WORLD_LAYOUT_V2 = true;
  const LAYOUT_V2 = function () { return !!(CBZ.CONFIG && CBZ.CONFIG.WORLD_LAYOUT_V2 !== false); };
  // `ax`/`az` are the STAGE-1 AUTHORED anchors — the same literals cx/cz are
  // built from, before the dial. They exist so a city's INTERIOR can be
  // seeded from where it was DESIGNED rather than from where it currently
  // stands (see buildMiniCity). Keep them in lockstep with cx/cz.
  const PLACEMENTS = [
    // FINANCE — south-central plains, WEST of the (now much larger) desert.
    // Moved off its old SE spot (760,430), which the enlarged desert swallowed.
    { id: "goldspire",  ax: 150,   az: 470,  cx: 150 + _OG.dx,   cz: 470 + _OG.dz,  hx: 118, hz: 120, road: { x: 340, z: 470 } },
    // PORT — south coast, south of the speedway, west of the desert.
    { id: "capeharbor", ax: 430,   az: 175,  cx: 430 + _OC.dx,   cz: 175 + _OC.dz,  hx: 120, hz: 120, road: { x: 470, z: -130 } },
    // CASINO — west plains, west of the military base.
    // road "network": dock on the nearest highwaynet lane (the Continental
    // Loop's west leg, 130 m off its west edge). Its old plug was the
    // airport's west fence, where there is no road; kept only as the
    // no-network fallback.
    { id: "neonreef",   ax: -1080, az: -260, cx: -1080 + _ON.dx, cz: -260 + _ON.dz, hx: 130, hz: 128, road: "network", fallbackRoad: { x: _NR_PLUG_X, z: -260 + _ON.dz } },
    // FACTORY — SW plains, south of the casino strip.
    { id: "foundry",    ax: -1080, az: 225,  cx: -1080 + _OF.dx, cz: 225 + _OF.dz,  hx: 135, hz: 130, road: { x: -380, z: 225 + _OF.dz } },
  ];

  // ---- WHERE IS THIS PLACE, AS A FRACTION OF THE MAP? -----------------------
  // 0 = dead centre, 1 = the map rim. Box metric over the published layout
  // rect (the same metric continent.js's rim relief uses, so the "rim" a
  // town is judged against is the SAME rim the mountains rise on).
  // DELIBERATELY reads ONLY CBZ.WORLD_ENLARGE_FLAT — a parse-time constant
  // that nothing mutates. CBZ.TERRAIN_FLAT looks like the same rect but is
  // GROWN in place at build time (terrain.js syncTerrainFlat), so reading it
  // from a landmass builder would make the answer depend on build ORDER,
  // i.e. non-deterministic in the one way this repo cannot tolerate. No
  // rect -> 0 -> no gradient: degrade-safe, never a broken town.
  // WORLD_SCALE_V5: read the PINNED reference rect when world/layout.js
  // publishes one (CBZ.WORLD_RIM_REF — the stage-4 FLAT). "How rim-side is
  // this town" has to be asked against where the world's PEOPLE are, not
  // against its total extent: stage 5 grew an empty 21 km^2 erg and a 108 km
  // sea, which walks the FLAT centre 1.6 km east and would have handed
  // Goldspire 17 storeys and Cape Harbor its full crown back, purely because
  // a desert three biomes away got bigger. Degrade-safe both ways — no
  // layout.js, or a stage that publishes no reference, and this is the old
  // rect byte for byte.
  function rimFraction(cx, cz) {
    const F = CBZ.WORLD_RIM_REF || CBZ.WORLD_ENLARGE_FLAT;
    if (!F || !isFinite(F.minX)) return 0;
    const fx = (F.minX + F.maxX) / 2, fz = (F.minZ + F.maxZ) / 2;
    const hx = Math.max(1, (F.maxX - F.minX) / 2), hz = Math.max(1, (F.maxZ - F.minZ) / 2);
    const t = Math.max(Math.abs(cx - fx) / hx, Math.abs(cz - fz) / hz);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }
  // OWNER: "mountains … on the edges of the map with just small cities."
  // A town's FABRIC (lots, roads, shops, its economy) is untouched — only its
  // SILHOUETTE bends: the further out a place sits, the lower its skyline and
  // the fewer of its lots grow towers. Downtown stays the one tall place,
  // which is what makes the rim read as frontier instead of as more suburb.
  // Deliberately NOT a footprint scale: shrinking the rect would delete lots,
  // shops and jobs, and "small" is a look, not a missing economy.
  //
  // The curve is tuned so a mid-map economy is UNTOUCHED and only genuinely
  // rim-side places bend. Measured against the stage-3 rect:
  //   Neon Reef  t=0.43 -> k=1.00  (casino strip keeps its 38-storey crown)
  //   Foundry    t=0.65 -> k=0.85  (already low-rise; barely moves)
  //   Cape Harbor t=0.72 -> k=0.76 (port softens)
  //   Goldspire  t=0.84 -> k=0.60  (finance city at the south rim: 44 -> 27)
  // The floor is 0.55, not 0.42, on purpose: a rim city should read SMALLER
  // than downtown, not be demolished into a hamlet.
  const SIZE_IN = 0.45, SIZE_OUT = 0.95, SIZE_FLOOR = 0.55;
  function skylineForPlace(tpl, cx, cz) {
    const sky = tpl && tpl.skyline;
    if (!sky || !LAYOUT_V2()) return sky;
    let t = (rimFraction(cx, cz) - SIZE_IN) / (SIZE_OUT - SIZE_IN);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const k = 1 - (1 - SIZE_FLOOR) * (t * t * (3 - 2 * t));    // 1 central -> 0.55 at the rim
    if (k >= 0.999) return sky;
    const minS = sky.minStoreys || 1;
    const out = Object.assign({}, sky);
    out.maxStoreys = Math.max(minS, Math.round((sky.maxStoreys || 8) * k));
    if (sky.landmarkStoreys) out.landmarkStoreys = Math.max(out.maxStoreys, Math.round(sky.landmarkStoreys * k));
    if (sky.towerFrac) out.towerFrac = sky.towerFrac * k;
    if (k < 0.8) out.megaChance = false;
    return out;
  }

  // tiny local LCG factory so each city is deterministic + independent of any
  // global rng (no Math.random in layout — owner rule #5).
  function lcg(seed) {
    let s = seed >>> 0 || 1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // merge helper (one mesh per pad; fallback = a single flat plane mesh).
  // `step` > 0: a private clone pulled that many polygonOffset steps forward
  // (never the shared cmat, which every same-coloured wall draws with).
  function addPad(root, cx, cz, w, d, color, y, step) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y == null ? 0.02 : y, cz);
    let mt = cmat(color);
    if (step) { mt = mt.clone(); mt.polygonOffset = true; mt.polygonOffsetFactor = -step; mt.polygonOffsetUnits = -2 * step; }
    const m = new THREE.Mesh(g, mt);
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.terrain = true;
    m.userData.worldSurface = true;
    m.name = "mini-city-surface";
    root.add(m);
    return m;
  }

  /* ---- THE LINK: network plug -> the town's own street ---------------------
     OWNER: "glitch where roads end abruptly in the gang city game."

     Every mini-city link used to be a flat dark PLANE (no paint, no
     shoulder) laid from the plug point to `cx +- hx` — the PLACEMENT's half
     extent, a number that has nothing to do with where the generated town's
     streets are. The town's grid is cols x (block + road) wide, so the link
     stopped short of it on every city: 32 m of grass before Goldspire's
     perimeter street, 28 m before Cape Harbor's, 22 m before Foundry Flats',
     9 m before Neon Reef's main street. And Neon Reef's far end "plugged" the
     airport's west fence, where no road has ever been: a causeway that ends
     square against an airfield.

     Now both ends dock on something real:
       · the PLUG is the network lane the link meets (its deck edge, record to
         its centreline) — authored per place, or, for `road: "network"`, the
         nearest highwaynet leg the town's centreline can reach square-on;
       · the TOWN END is the outer edge of the town's own perimeter street
         facing the plug (record to that street's centreline), read from the
         descriptor buildTown returned.
     The deck is the shared highway builder's (lane paint, shoulders, junction
     gaps where it meets the town street), not a bare plane. */
  const LINK_W = 24, LINK_HALF = 14.4;       // highways.js deck half for a 24 m 3+3 record
  function resolvePlug(place) {
    if (place.road !== "network") return place.road ? { x: place.road.x, z: place.road.z, rx: place.road.x, rz: place.road.z } : null;
    const table = CBZ.highwayNetTable ? CBZ.highwayNetTable() : [];
    const HALF = CBZ.HIGHWAY_NET_HALF || 15.3;
    let best = null;
    for (const route of table) {
      if (route.rural) continue;                 // a country road is not a freeway to plug a city into
      const pts = route.pts || [], fil = (route.fillet || 60) + HALF;
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        const vertical = Math.abs(B.x - A.x) < 0.5;
        const lo = vertical ? Math.min(A.z, B.z) : Math.min(A.x, B.x);
        const hi = vertical ? Math.max(A.z, B.z) : Math.max(A.x, B.x);
        const along = vertical ? place.cz : place.cx;          // where our centreline meets it
        // square-on, clear of the fillet arcs at a leg's corners
        if (along < lo + (i > 0 ? fil : 0) || along > hi - (i < pts.length - 2 ? fil : 0)) continue;
        const line = vertical ? A.x : A.z, c = vertical ? place.cx : place.cz;
        const edge = line + (c > line ? HALF : -HALF);           // deck edge facing the town
        const d = Math.abs(edge - c);
        if (!best || d < best.d) {
          best = vertical ? { d: d, x: edge, z: place.cz, rx: line, rz: place.cz }
                          : { d: d, x: place.cx, z: edge, rx: place.cx, rz: line };
        }
      }
    }
    return best || (place.fallbackRoad ? { x: place.fallbackRoad.x, z: place.fallbackRoad.z, rx: place.fallbackRoad.x, rz: place.fallbackRoad.z } : null);
  }
  function buildLink(city, root, place, tpl, town, plug) {
    const cx = place.cx, cz = place.cz;
    const horiz = Math.abs(plug.x - cx) >= Math.abs(plug.z - cz);
    const sgn = horiz ? Math.sign(plug.x - cx) : Math.sign(plug.z - cz);   // plug side
    // the town's perimeter street facing the plug, spanning the link's width
    let dock = null, dockC = null;
    for (const r of (town.roads || [])) {
      if (!!r.vertical !== horiz) continue;                   // must cross our axis
      const lat = horiz ? cz : cx;
      const span0 = (horiz ? r.z : r.x) - r.len / 2, span1 = (horiz ? r.z : r.x) + r.len / 2;
      if (lat - LINK_HALF < span0 - 0.5 || lat + LINK_HALF > span1 + 0.5) continue;
      const c = horiz ? r.x : r.z;
      if (dockC == null || (c - dockC) * sgn > 0) { dockC = c; dock = r; }
    }
    const R = town.rect || { minX: cx - place.hx, maxX: cx + place.hx, minZ: cz - place.hz, maxZ: cz + place.hz };
    const townEdge = dock ? dockC + sgn * (dock.w || 12) / 2
      : (horiz ? (sgn > 0 ? R.maxX : R.minX) : (sgn > 0 ? R.maxZ : R.minZ));
    const recTown = dock ? dockC : townEdge;
    const a = horiz ? plug.x : plug.z;                         // deck: plug edge -> street edge
    if ((a - townEdge) * sgn <= 1) return;                     // already touching
    const path = horiz ? [{ x: a, z: cz }, { x: townEdge, z: cz }] : [{ x: cx, z: a }, { x: cx, z: townEdge }];
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: path, width: LINK_W, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6,
        theme: "asphalt", registerRoads: false, owner: place.id,
      });
    } else {
      addPad(root, (path[0].x + path[1].x) / 2, (path[0].z + path[1].z) / 2,
        horiz ? Math.abs(a - townEdge) : LINK_W, horiz ? LINK_W : Math.abs(a - townEdge),
        (tpl.palette && tpl.palette.road != null ? tpl.palette.road : 0x3c3f46), 0.04, 1);
    }
    const lo = Math.min(a, townEdge), hi = Math.max(a, townEdge);
    CBZ.registerCityRegion(city, {
      name: tpl.name + " Causeway", subtitle: tpl.subtitle || "Mini-City", biome: place.id, kind: "rect",
      minX: horiz ? lo : cx - LINK_W / 2, maxX: horiz ? hi : cx + LINK_W / 2,
      minZ: horiz ? cz - LINK_W / 2 : lo, maxZ: horiz ? cz + LINK_W / 2 : hi, pad: 1,
    });
    if (city.roads) {
      // the RECORD runs centreline to centreline (network lane -> town
      // street), so both ends are derived junctions traffic can turn at
      const r0 = horiz ? plug.rx : plug.rz;
      const rl = Math.min(r0, recTown), rh = Math.max(r0, recTown);
      const link = horiz
        ? { x: (rl + rh) / 2, z: cz, vertical: false, len: rh - rl }
        : { x: cx, z: (rl + rh) / 2, vertical: true, len: rh - rl };
      Object.assign(link, { district: "highway", w: LINK_W, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
      // THE CLEARANCE LAW (city/roadrules.js): both ends are legitimate
      // destinations, but nothing says the line between them is empty; the
      // link docks at any place it would otherwise have driven through.
      if (CBZ.roadClamp) CBZ.roadClamp(link, { owner: place.id });
      city.roads.push(link);
    }
  }

  // ---- build ONE mini-city from a placement record + its template -----------
  function buildMiniCity(city, place) {
    const tpl = CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES[place.id];
    if (!tpl || typeof CBZ.buildTown !== "function") return;   // nothing to do without the recipe + generator
    const root = city.root; if (!root) return;
    const cx = place.cx, cz = place.cz, hx = place.hx, hz = place.hz;
    const rect = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
    // AUTHORED-FRAME SEEDING (WORLD_LAYOUT_V2). This stream used to be keyed
    // on the town's WORLD centre, so the world-layout dial doubled as a
    // re-roll button: sliding a city 300m re-dealt its whole street plan and
    // moved the math gate's golden lot/shop counts with it (the gate's own
    // comment — "recal: snow move re-rolled Pinecrest" — is the scar). Keying
    // on the AUTHORED anchor decouples WHERE a place is from WHAT it is:
    // layout work is now free of generator churn, and the flag-off world is
    // byte-identical because at zero offset authored == world.
    const seedX = (LAYOUT_V2() && place.ax != null) ? place.ax : cx;
    const seedZ = (LAYOUT_V2() && place.az != null) ? place.az : cz;
    const rng = lcg((Math.abs(seedX) * 73856093) ^ (Math.abs(seedZ) * 19349663) ^ (CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : 0x53170));

    // (a) GROUND PAD — a settled town floor under the whole footprint, a touch
    //     above grade so it reads as reclaimed land/plaza, then seed placement so
    //     the generator's prop scatter respects what we (and others) already laid.
    // (the VERGE colour: this pad is the land round the town, and the recipe's
    // ground tone — Neon Reef's purple, Goldspire's grey — read as a void of
    // asphalt a district wide)
    const P0 = tpl.palette || {};
    addPad(root, cx, cz, hx * 2 + 18, hz * 2 + 18, P0.verge != null ? P0.verge : (P0.ground != null ? P0.ground : 0x6f7480), 0.018);
    if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }

    // (b)+(c) GROW THE TOWN — now that T1 wired the arena, all shops/homes/roads
    //     register automatically into Zillow/shops/jobs/vendor-staffing.
    const town = CBZ.buildTown(root, Object.assign({}, tpl, {
      cx: cx, cz: cz, rng: rng, region: rect,
      name: tpl.name, district: place.id,
      // SIZE GRADIENT: a fresh skyline block (never a mutation of the shared
      // template — CITY_TEMPLATES is pure data every other consumer reads).
      skyline: skylineForPlace(tpl, cx, cz),
      // towngen chooses central skyline lots before it creates geometry. This
      // replaces the former post-build pass that constructed a second shell at
      // the exact same lot centre and guaranteed interpenetrating buildings.
      integratedSkyline: true,
    }));
    if (!town) return;

    // (e) REGISTER the walkable region + a causeway to the network, so the
    //     placement reads as a real landmass and you can drive there. The
    //     biome string = the template id so crowd/regionlife flavour it.
    CBZ.registerCityRegion(city, {
      name: tpl.name, subtitle: tpl.subtitle || "Mini-City", biome: place.id, kind: "rect",
      minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, pad: 8,
    });
    const plug = resolvePlug(place);
    if (plug) buildLink(city, root, place, tpl, town, plug);
    // (f) WORK-ANCHORS — the central shops are jobs people commute to (the SAME
    //     schedule/goal brain the mainland uses). Anchor the 1-2 most-central
    //     shop lots so the city actually staffs up. (No new geometry.)
    if (CBZ.registerWorkAnchor && town.lots && town.lots.length) {
      const shops = town.lots
        .filter(function (l) { return l.building && l.building.shop && l.building.vendorSpot; })
        .sort(function (a, b) { return Math.hypot(a.cx - cx, a.cz - cz) - Math.hypot(b.cx - cx, b.cz - cz); })
        .slice(0, 2);
      for (const s of shops) {
        try {
          CBZ.registerWorkAnchor({
            biome: place.id, kind: "shop", role: "shopkeeper",
            x: s.cx, z: s.cz, cap: 1,
            spots: [{ x: s.building.vendorSpot.x, z: s.building.vendorSpot.z }],
            home: { x: s.cx, z: s.cz },
          });
        } catch (e) {}
      }
    }
  }

  // ---- register ALL four as ONE landmass builder (order 34: after biomes/
  //      placement). Each city is independently try/caught so one bad city can
  //      never sink the rest of the world (worldmap contract). --------------
  // ONE BUILDER PER CITY (same order, same sequence): a city slice or the
  // streamed live city (core/slice.js, core/citystream.js) skips a builder
  // whose footprint it cannot see, so four cities in one builder meant the
  // phone built all four (~80k meshes) to see a corner of one.
  for (const place of PLACEMENTS) {
    CBZ.addLandmass(function (city) {
      try { buildMiniCity(city, place); } catch (e) { try { console.error("[minicity]", place.id, e); } catch (e2) {} }
    }, 34);
  }
})();
