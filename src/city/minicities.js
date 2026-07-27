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
    { id: "neonreef",   ax: -1080, az: -260, cx: -1080 + _ON.dx, cz: -260 + _ON.dz, hx: 130, hz: 128, road: { x: _NR_PLUG_X, z: -260 + _ON.dz } },
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
  function rimFraction(cx, cz) {
    const F = CBZ.WORLD_ENLARGE_FLAT;
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
  function addPad(root, cx, cz, w, d, color, y) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y == null ? 0.02 : y, cz);
    const m = new THREE.Mesh(g, cmat(color));
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.terrain = true;
    m.userData.worldSurface = true;
    m.name = "mini-city-surface";
    root.add(m);
    return m;
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
    addPad(root, cx, cz, hx * 2 + 18, hz * 2 + 18, tpl.palette && tpl.palette.ground != null ? tpl.palette.ground : 0x6f7480, 0.018);
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

    // (e) REGISTER the walkable region + a causeway toward the nearest road, so
    //     the placement reads as a real landmass and you can drive there. The
    //     biome string = the template id so crowd/regionlife flavour it.
    CBZ.registerCityRegion(city, {
      name: tpl.name, subtitle: tpl.subtitle || "Mini-City", biome: place.id, kind: "rect",
      minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, pad: 8,
    });
    // causeway: a thin walkable+drivable rect from the city edge toward `road`.
    // Built along whichever axis the link runs (X or Z) so it stays a corridor.
    if (place.road) {
      const rx = place.road.x, rz = place.road.z;
      const horiz = Math.abs(rx - cx) >= Math.abs(rz - cz);
      const HW = 12;                                   // half-width ~ a 24m deck
      let cMinX, cMaxX, cMinZ, cMaxZ, midX, midZ, vertical, len;
      if (horiz) {
        const x0 = Math.min(rx, cx + (rx > cx ? hx : -hx));
        const x1 = Math.max(rx, cx + (rx > cx ? hx : -hx));
        cMinX = Math.min(x0, x1); cMaxX = Math.max(x0, x1);
        cMinZ = cz - HW; cMaxZ = cz + HW; midZ = cz; midX = (cMinX + cMaxX) / 2;
        vertical = false; len = cMaxX - cMinX;
      } else {
        const z0 = Math.min(rz, cz + (rz > cz ? hz : -hz));
        const z1 = Math.max(rz, cz + (rz > cz ? hz : -hz));
        cMinZ = Math.min(z0, z1); cMaxZ = Math.max(z0, z1);
        cMinX = cx - HW; cMaxX = cx + HW; midX = cx; midZ = (cMinZ + cMaxZ) / 2;
        vertical = true; len = cMaxZ - cMinZ;
      }
      // deck plane + region + a traffic road segment down the corridor
      addPad(root, midX, midZ, vertical ? HW * 2 : (cMaxX - cMinX), vertical ? (cMaxZ - cMinZ) : HW * 2,
        (tpl.palette && tpl.palette.road != null ? tpl.palette.road : 0x3c3f46), 0.04);
      CBZ.registerCityRegion(city, {
        name: tpl.name + " Causeway", subtitle: tpl.subtitle || "Mini-City", biome: place.id, kind: "rect",
        minX: cMinX, maxX: cMaxX, minZ: cMinZ, maxZ: cMaxZ, pad: 1,
      });
      if (city.roads) city.roads.push({ x: midX, z: midZ, vertical: vertical, len: len, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }

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
  CBZ.addLandmass(function (city) {
    for (const place of PLACEMENTS) {
      try { buildMiniCity(city, place); } catch (e) { try { console.error("[minicity]", place.id, e); } catch (e2) {} }
    }
  }, 34);
})();
