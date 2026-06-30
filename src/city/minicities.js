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
  //      desert(1050,-20), forest(-560,-1350), snow(350,-1450), farmland(1180,-880)).
  //      Each city is its OWN biome string so crowd/regionlife populate it. The
  //      `road` point is where its causeway plugs toward the existing network. ----
  const PLACEMENTS = [
    // FINANCE — SE plains, south of the desert, east of the port.
    { id: "goldspire",  cx: 760,   cz: 430,  hx: 118, hz: 120, road: { x: 470, z: 430 } },
    // PORT — south coast, south of the speedway, west of the desert.
    { id: "capeharbor", cx: 430,   cz: 175,  hx: 120, hz: 120, road: { x: 470, z: -130 } },
    // CASINO — west plains, west of the military base.
    { id: "neonreef",   cx: -1080, cz: -260, hx: 130, hz: 128, road: { x: -860, z: -260 } },
    // FACTORY — SW plains, south of the casino strip.
    { id: "foundry",    cx: -1080, cz: 225,  hx: 135, hz: 130, road: { x: -380, z: 225 } },
  ];

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
    root.add(m);
    return m;
  }

  // a buyable owner stamp matching buildings.js stampOwner, for the skyline
  // tower lots the placer hand-adds (so they SELL like every other lot).
  const TOWER_OWNERS = ["Apex Holdings", "Meridian Estates", "Skyline Group", "V. Castellano",
    "Crownpoint LLC", "Harborline Trust", "Northgate Capital", "T. Okonkwo"];
  function stampTowerOwner(b, seed) {
    const nm = TOWER_OWNERS[(seed >>> 3) % TOWER_OWNERS.length];
    b.owner = { type: "landlord", id: null, name: nm, buyable: true, _acct: { cash: 1200 + (b.storeys || 1) * 120 } };
  }

  // ---- build ONE mini-city from a placement record + its template -----------
  function buildMiniCity(city, place) {
    const tpl = CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES[place.id];
    if (!tpl || typeof CBZ.buildTown !== "function") return;   // nothing to do without the recipe + generator
    const root = city.root; if (!root) return;
    const cx = place.cx, cz = place.cz, hx = place.hx, hz = place.hz;
    const rect = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
    const rng = lcg((Math.abs(cx) * 73856093) ^ (Math.abs(cz) * 19349663) ^ 0x53170);

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
    }));
    if (!town) return;

    // (d) SKYLINE — pick the most-CENTRAL few built lots and raise TALL towers so
    //     the city has a real silhouette. Heights come from template.skyline and
    //     are CAPPED under the mainland core (CH3/CH6: maxStoreys < Midtown 20+),
    //     so the main downtown always reads as THE downtown. The central lot may
    //     get a taller "mega-ish" spire (reuse cityMakeBuilding — NOT the mainland
    //     singleton cityMegaTower). Each new tower lot is owner-stamped so it sells.
    const sky = tpl.skyline || {};
    const mk = CBZ.cityMakeBuilding;
    if (mk && town.lots && town.lots.length) {
      // sort built lots by distance from the town centre (closest first)
      const byCentre = town.lots.slice().sort(function (a, b) {
        return (Math.hypot(a.cx - cx, a.cz - cz)) - (Math.hypot(b.cx - cx, b.cz - cz));
      });
      const towerFrac = sky.towerFrac != null ? sky.towerFrac : 0.2;
      const wantTowers = Math.max(1, Math.round(byCentre.length * towerFrac));
      const minS = sky.minStoreys || 4, maxS = sky.maxStoreys || 8;
      let made = 0;
      const A = (CBZ.city && CBZ.city.arena) || null;
      for (let i = 0; i < byCentre.length && made < wantTowers; i++) {
        const lt = byCentre[i];
        // only re-tower a SHOP/commercial lot (homes keep their domestic scale);
        // the most-central lot becomes the spire if the recipe allows a mega.
        if (lt.building && lt.building.home) continue;
        const w = Math.max(10, lt.w), d = Math.max(10, lt.d);
        let storeys;
        if (made === 0 && sky.megaChance) {
          // the central SPIRE — the tallest in THIS city's skyline, but a HARD
          // cap (CH3/CH6) keeps every mini-city clearly UNDER the mainland: the
          // mainland's regular towers reach ~12 and the ONE flagship mega-tower
          // is 30, so a mini-city spire tops out at 18 — taller than its own
          // blocks, never rivaling the center core/flagship. Height hierarchy
          // reads: main downtown is THE downtown.
          storeys = Math.min(18, maxS + 2);
        } else {
          const t = made / Math.max(1, wantTowers - 1);
          storeys = Math.round(maxS - (maxS - minS) * t);
        }
        storeys = Math.max(minS, Math.min(18, storeys));   // hard mini-city ceiling (< mainland flagship 30)
        const color = (lt.building && lt.building.sign != null) ? lt.building.sign : (tpl.palette && tpl.palette.accent) || 0x556070;
        const side = (lt.building && lt.building.side) || 0;
        let tb = null;
        try { tb = mk(root, lt.cx, lt.cz, w, d, storeys, color, side, { glassKind: "reflective" }); } catch (e) { tb = null; }
        if (!tb) continue;
        // register the tower as its OWN sellable lot (kind:'tower') on the arena
        const trec = {
          cx: lt.cx, cz: lt.cz, w: w, d: d, kind: "tower", district: place.id,
          building: Object.assign({}, tb, { name: tpl.name + " Tower", sign: color, side: side }),
        };
        stampTowerOwner(trec.building, (lt.cx | 0) * 31 + (lt.cz | 0) * 17);
        if (A) (A.lots = A.lots || []).push(trec);
        made++;
      }
    }

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
      if (city.roads) city.roads.push({ x: midX, z: midZ, vertical: vertical, len: len, district: "highway" });
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
