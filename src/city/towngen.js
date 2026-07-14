/* ============================================================
   city/towngen.js — a REUSABLE per-biome TOWN generator.

   WHY THIS EXISTS (owner's why-first law):
   A biome that just SCATTERS a few landmarks reads as a theme-park
   diorama — props with no street between them. A real place has a
   SPINE (a main street), LOTS that line it (non-overlapping, each
   facing the road), a SQUARE where people gather, and a falloff from
   a dense civic core to sparse frontier edges. This file builds that
   skeleton ONCE, deterministically, from a recipe — so every biome
   (desert Old-West, future forest logging camp, snow ski village…)
   can grow a believable town from the same code by passing prefabs +
   a palette + a pattern, instead of hand-placing every box.

   THE CONTRACT — CBZ.buildTown(root, cfg) → townDescriptor | null
     cfg = {
       cx, cz,                 // town centre (world)
       cols, rows,             // block grid extent
       blockW, blockD,         // block size (m)
       roadW,                  // street width (m)
       pattern,                // 'grid' | 'mainstreet' | 'organic'
       zoning,                 // optional override of the concentric ring kinds
       prefabs,                // per-zone weighted asset/building recipes
       density,                // 0..1 build probability scalar (denser centre)
       palette,                // { ground, sidewalk, wood, accent, sign }
       rng,                    // REQUIRED seeded rng() — determinism
       name,                   // town name (square sign + region label)
       region,                 // optional {minX,maxX,minZ,maxZ} hard clamp
     }
   Returns { name, cx, cz, rect, lots, square, roads } or null if it
   can't build (missing THREE / no rng).

   FOUNDATION API (assets.js / placement.js) is OPTIONAL — every call
   is feature-detected. When CBZ.placement exists we RESERVE the lots
   and SCATTER street dressing through it (so it respects existing
   colliders + other towns); when it's absent we still build the whole
   town from our own non-overlapping lot math + cityMakeBuilding, so a
   biome that calls buildTown works either way.

   DRAW-CALL DISCIPLINE (owner rule #4): the ground/road decks are
   merged BufferGeometry; lamps / hitching-rails / parked dressing are
   InstancedMesh; buildings are the only individually-placed solids
   (they need colliders + enterable interiors). A town adds on the
   order of a few dozen draw calls, not thousands.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat;
  const BGU = THREE.BufferGeometryUtils;

  // ---- small helpers -------------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  // merge many transformed geometries → ONE mesh (fallback: per-geo meshes,
  // still one shared material so it batch-folds).
  function mergeAdd(root, geoms, material, opts) {
    opts = opts || {};
    if (!geoms.length) return null;
    if (BGU && BGU.mergeBufferGeometries) {
      const merged = BGU.mergeBufferGeometries(geoms);
      const m = new THREE.Mesh(merged, material);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
      return m;
    }
    for (const gm of geoms) {
      const m = new THREE.Mesh(gm, material);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
    }
    return null;
  }
  function planeGeo(x, z, w, d, y, rotY) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y == null ? 0.02 : y, z);
    return g;
  }
  function solid(x, z, w, d, y1) {
    if (!CBZ.colliders) return;
    CBZ.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: 0, y1: y1 == null ? 30 : y1 });
  }
  // weighted pick from [{key, w}] using rng
  function wpick(list, rng) {
    if (!list || !list.length) return null;
    let t = 0; for (const e of list) t += (e.w || 1);
    let x = rng() * t;
    for (const e of list) { x -= (e.w || 1); if (x <= 0) return e; }
    return list[list.length - 1];
  }
  // doorSide string from a unit direction toward the nearest road
  function sideFromNormal(nx, nz) {
    if (Math.abs(nx) > Math.abs(nz)) return nx > 0 ? "east" : "west";
    return nz > 0 ? "south" : "north";
  }
  // SETTLEMENTS_V2 FINDING: cityMakeBuilding's doorInfo() takes a NUMERIC side
  // (0=-z,1=+z,2=-x,3=+x — buildings.js:3075) but towngen always passed the
  // STRING ("north"/"south"/...), which matches none of 0/1/2 and falls through
  // to the +x branch — so every town building's REAL door gap sat on the +x
  // face while the sign/vendor/door-record used the computed side. Map it.
  const SIDE_IDX = { north: 0, south: 1, west: 2, east: 3 };

  // =========================================================================
  //  THE GENERATOR
  // =========================================================================
  CBZ.buildTown = function (root, cfg) {
    if (!root || !cfg || typeof cfg.rng !== "function") return null;
    const rng = cfg.rng;
    // KEYSTONE (T1): the lots/roads/shopLots a town builds must reach the SAME
    // arena arrays the mainland writes to (world.js:511 — lots/roads live on the
    // built `city` object, which mode.js stores as CBZ.city.arena). The old code
    // wrote to CBZ.city.lots / .roads (CBZ.city is the *mode* shell — those keys
    // are undefined there), so Dry Gulch's shops never reached Zillow/shops/jobs/
    // vendor staffing. `A` is the real arena; every later push targets A. The
    // `if (A)` guard keeps a headless / no-arena call building geometry + returning
    // the descriptor (zero regression for the desert fallback path).
    // SETTLEMENTS_V2 KEYSTONE FIX: mode.js only assigns CBZ.city.arena AFTER
    // buildCity() RETURNS (mode.js:213), but every town builds DURING buildCity
    // (world.js:865 cityWorldGeo) — so the old chain below resolved to null for
    // every town ever built and ALL town lots/shops/roads were silently dropped
    // (towns were economically dead: no vendors, no Zillow, no map POIs, no
    // traffic on their streets). settlements.js wraps cityWorldGeo and stashes
    // the LIVE under-construction city object here; cfg.arena is a per-call
    // override for direct callers.
    const A = cfg.arena || CBZ._settlementArena
      || (CBZ.city && CBZ.city.arena) || (CBZ.cityState && CBZ.cityState.arena) || null;
    const V2 = !CBZ.CONFIG || CBZ.CONFIG.SETTLEMENTS_V2 !== false;
    const cx = cfg.cx, cz = cfg.cz;
    // SETTLEMENT COMPOSITION (V2). A per-SITE rng (CBZ.lcgFromHash folds
    // WORLD_SEED + position — NEVER the shared cfg.rng determinism depends on)
    // composes a flavored ANCHOR PLAN: guaranteed purposeful shops (food +
    // general store, then rolled bar/bank/clinic/gunsmith/pawn/clothing/casino)
    // on the most-central lots. Pure — it does not draw a single cfg.rng value,
    // so the 2-draws-per-lot fill cadence below is untouched and the world stays
    // byte-identical per seed. The caller's authored prefabs/palette WIN; comp
    // only fills gaps (so Dry Gulch still reads Old-West) and supplies the
    // anchors' flavored names + sign tints. anchorPlan (built once lots[] exist)
    // is consulted by the fill loop to FORCE those lots to build the plan.
    let comp = null, siteRng = null, anchorPlan = null;
    if (V2 && CBZ.settlementsCompose && CBZ.lcgFromHash) {
      try {
        siteRng = CBZ.lcgFromHash(cx, cz, "settlement");
        comp = CBZ.settlementsCompose(cfg, siteRng);
        if (comp) {
          if (!cfg.prefabs && comp.prefabs) cfg = Object.assign({}, cfg, { prefabs: comp.prefabs });
          if (!cfg.palette && comp.palette) cfg = Object.assign({}, cfg, { palette: comp.palette });
        }
      } catch (e) { comp = null; }
    }
    const cols = Math.max(1, (cfg.cols || 3) | 0);
    const rows = Math.max(1, (cfg.rows || 3) | 0);
    const BW = cfg.blockW || 36, BD = cfg.blockD || 36;
    const ROAD = cfg.roadW || 12;
    const pattern = cfg.pattern || "grid";
    const density = cfg.density != null ? cfg.density : 0.7;
    const pal = cfg.palette || {};
    const GROUND = pal.ground != null ? pal.ground : 0xcdb98a;
    const SIDEWALK = pal.sidewalk != null ? pal.sidewalk : 0xb8a884;
    const WOOD = pal.wood != null ? pal.wood : 0x9c7b4e;
    const ACCENT = pal.accent != null ? pal.accent : 0x7a5a36;
    const region = cfg.region || null;

    const stepX = BW + ROAD, stepZ = BD + ROAD;
    const halfX = (cols * stepX) / 2, halfZ = (rows * stepZ) / 2;
    // centreline grids: cols+1 / rows+1 lines bounding cols×rows blocks
    const xLines = [], zLines = [];
    for (let k = 0; k <= cols; k++) xLines.push(cx - halfX + k * stepX);
    for (let k = 0; k <= rows; k++) zLines.push(cz - halfZ + k * stepZ);
    const minX = xLines[0] - ROAD / 2, maxX = xLines[cols] + ROAD / 2;
    const minZ = zLines[0] - ROAD / 2, maxZ = zLines[rows] + ROAD / 2;
    const rect = { minX, maxX, minZ, maxZ };
    const townRoads = [];   // {x,z,vertical,len}

    // ----- placement-API feature detect -----
    const P = CBZ.placement || null;
    if (P && P.seedFromColliders) { try { P.seedFromColliders(); } catch (e) {} }
    function reserveRect(r) { if (P && P.reserve) { try { P.reserve(r); } catch (e) {} } }

    // =====================================================================
    //  1) GROUND PAD — one merged sand/dirt slab under the whole town, a
    //     touch above grade so it reads as a swept, settled town floor.
    // =====================================================================
    mergeAdd(root, [planeGeo(cx, cz, maxX - minX + 6, maxZ - minZ + 6, 0.03)], cmat(GROUND), { receive: true });

    // =====================================================================
    //  2) STREET NETWORK — per the pattern. Push every segment to BOTH the
    //     town descriptor AND city.roads so traffic/citynav use the streets.
    // =====================================================================
    const roadGeoms = [], lineGeoms = [];
    function roadSeg(x, z, vertical, len, wide) {
      const w = wide || ROAD;
      roadGeoms.push(vertical ? planeGeo(x, z, w, len, 0.05) : planeGeo(x, z, len, w, 0.05));
      // Publish the same cross-section we just rendered. Without this metadata
      // traffic/props inherited the mainland's 18 m four-lane default on a
      // 7-12 m village street, putting AI lanes off the asphalt and making
      // correctly placed sidewalk lamps look like lane intrusions.
      const lanesPerDir = w >= 13 ? 2 : 1;
      const laneW = Math.min(3.6, w / (lanesPerDir * 2));
      const seg = { x, z, vertical, len, district: cfg.district || "town", w, lanesPerDir, laneW };
      townRoads.push(seg);
      // T1: push town streets onto the REAL arena road list (traffic/citynav read
      // arena.roads), not the empty CBZ.city.roads.
      if (cfg.pushCityRoads !== false && A && A.roads) A.roads.push(seg);
    }
    if (pattern === "mainstreet") {
      // one WIDE spine along x through the centre row, plus short cross-streets.
      roadSeg(cx, cz, false, maxX - minX, ROAD * 1.6);
      for (let k = 0; k <= cols; k++) roadSeg(xLines[k], cz, true, maxZ - minZ);
    } else if (pattern === "organic") {
      for (let k = 0; k <= cols; k++) roadSeg(xLines[k] + (rng() - 0.5) * ROAD * 0.4, cz, true, maxZ - minZ);
      for (let k = 0; k <= rows; k++) roadSeg(cx, zLines[k] + (rng() - 0.5) * ROAD * 0.4, false, maxX - minX);
    } else { // grid
      for (let k = 0; k <= cols; k++) roadSeg(xLines[k], cz, true, maxZ - minZ);
      for (let k = 0; k <= rows; k++) roadSeg(cx, zLines[k], false, maxX - minX);
    }
    mergeAdd(root, roadGeoms, cmat(pal.road != null ? pal.road : 0x5a4f3e), { receive: true });
    // faded centre dashes on the spine (mainstreet) — one merged mesh
    if (pattern === "mainstreet") {
      const n = Math.max(6, ((maxX - minX) / 7) | 0);
      for (let i = 0; i < n; i++) lineGeoms.push(planeGeo(minX + 8 + i * ((maxX - minX - 16) / n), cz, 2.4, 0.3, 0.07));
      mergeAdd(root, lineGeoms, cmat(pal.line != null ? pal.line : 0xc9bf8e), { receive: false });
    }

    // =====================================================================
    //  3) LOTS — subdivide each block into non-overlapping OBB lots by
    //     recursively splitting across the LONG axis until min frontage /
    //     min area. A sidewalk inset frames each block; each lot's doorSide
    //     faces the nearest road. Lots NEVER overlap by construction.
    // =====================================================================
    const SIDEWALK_INSET = 2.4;
    const MIN_FRONT = cfg.minFrontage || 12;
    const MIN_AREA = cfg.minLotArea || 150;
    const lots = [];           // {cx,cz,w,d,ring,zone,doorSide,door:{x,z,nx,nz}}
    const sidewalkGeoms = [];
    const centerRow = (rows - 1) / 2, centerCol = (cols - 1) / 2;
    let squareCell = null;
    let bestSq = 1e9;
    // pick the most-central block as the SQUARE
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const d = Math.abs(i - centerCol) + Math.abs(j - centerRow);
      if (d < bestSq) { bestSq = d; squareCell = { i, j }; }
    }

    function ringOf(i, j) {
      return Math.max(Math.abs(i - centerCol), Math.abs(j - centerRow));
    }
    function zoneForRing(ring) {
      if (cfg.zoning && cfg.zoning[Math.min(ring, cfg.zoning.length - 1)]) return cfg.zoning[Math.min(ring, cfg.zoning.length - 1)];
      if (ring <= 0) return "civic";
      if (ring <= 1) return "commercial";
      return "residential";
    }

    function subdivide(bx, bz, bw, bd, ring, out) {
      // recursive split across the long axis until frontage/area bottoms out
      const area = bw * bd;
      const longAxisX = bw >= bd;
      const longLen = longAxisX ? bw : bd;
      if (longLen / 2 < MIN_FRONT || area / 2 < MIN_AREA) {
        out.push({ cx: bx, cz: bz, w: bw, d: bd, ring });
        return;
      }
      // jittered split point (deterministic) so lots vary in width
      const t = lerp(0.4, 0.6, rng());
      if (longAxisX) {
        const w0 = bw * t, w1 = bw - w0;
        subdivide(bx - bw / 2 + w0 / 2, bz, w0, bd, ring, out);
        subdivide(bx + bw / 2 - w1 / 2, bz, w1, bd, ring, out);
      } else {
        const d0 = bd * t, d1 = bd - d0;
        subdivide(bx, bz - bd / 2 + d0 / 2, bw, d0, ring, out);
        subdivide(bx, bz + bd / 2 - d1 / 2, bw, d1, ring, out);
      }
    }

    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const bx = (xLines[i] + xLines[i + 1]) / 2;
      const bz = (zLines[j] + zLines[j + 1]) / 2;
      const ring = ringOf(i, j);
      // sidewalk slab framing the block (one inset rect per block)
      sidewalkGeoms.push(planeGeo(bx, bz, BW + 2, BD + 2, 0.04));
      if (squareCell && i === squareCell.i && j === squareCell.j) {
        squareCell.bx = bx; squareCell.bz = bz; squareCell.w = BW; squareCell.d = BD;
        continue;   // square block holds NO building lots
      }
      const inner = [];
      subdivide(bx, bz, BW - SIDEWALK_INSET * 2, BD - SIDEWALK_INSET * 2, ring, inner);
      for (const lt of inner) {
        // door faces the nearest road edge of the parent BLOCK
        const dxE = (xLines[i + 1]) - lt.cx, dxW = lt.cx - xLines[i];
        const dzS = (zLines[j + 1]) - lt.cz, dzN = lt.cz - zLines[j];
        const m = Math.min(dxE, dxW, dzS, dzN);
        let nx = 0, nz = 0;
        if (m === dxE) nx = 1; else if (m === dxW) nx = -1; else if (m === dzS) nz = 1; else nz = -1;
        lt.zone = zoneForRing(ring);
        lt.doorSide = sideFromNormal(nx, nz);
        lt.door = { x: lt.cx + nx * (lt.w / 2), z: lt.cz + nz * (lt.d / 2), nx, nz };
        lots.push(lt);
        reserveRect({ minX: lt.cx - lt.w / 2, maxX: lt.cx + lt.w / 2, minZ: lt.cz - lt.d / 2, maxZ: lt.cz + lt.d / 2 });
      }
    }
    mergeAdd(root, sidewalkGeoms, cmat(SIDEWALK), { receive: true });

    // ANCHOR PLAN — now that lots[] exist, ask the composer which central lots
    // must become which purposeful shop. Deterministic (siteRng only). The fill
    // loop below FORCES these; every one is furnished into a real trade so no
    // anchor is ever a hollow box.
    if (comp && comp.planAnchors) { try { anchorPlan = comp.planAnchors(lots, cx, cz); } catch (e) { anchorPlan = null; } }

    // =====================================================================
    //  4) FILL LOTS — density falls off from the centre; each lot rolls a
    //     buildProb, then places a prefab from its zone's weighted recipe.
    //     Building prefabs (enterable shells) go through cityMakeBuilding and
    //     are pushed to the ARENA lots/shopLots/homeLots (T1) so jobs/minimap/
    //     zillow/vendor-staffing see them — each shop carries a vendorSpot+owner+
    //     trade (T2). Solid props go through placement.placeAsset when present.
    // =====================================================================
    const mk = CBZ.cityMakeBuilding;
    const district = cfg.district || cfg.name || "town";
    const filled = [];
    function buildProbFor(ring) {
      // denser centre: ring0 ~density, falling ~25% per ring out
      const p = density * Math.pow(0.72, ring);
      return Math.max(0.18, Math.min(1, p));
    }

    // ---- OWNER STAMP (T2) ----------------------------------------------------
    // Mirror buildings.js stampOwner so a town's shops/homes carry the SAME
    // canonical owner shape Zillow/gangs/realestate consume. Shops are a buyable
    // 'business'; homes use a LIVE getter off home.owned so the per-life
    // realestate reset flips them back to 'landlord' with no parallel state;
    // anything else is a buyable 'landlord' lot — never a typeless one.
    const PROPRIETORS = ["Marcus Webb", "Lena Cho", "Tony Russo", "Dev Patel", "Rosa Vega",
      "Grant Okafor", "Mei Lin", "Sal Bianchi", "Nadia Haq", "Cole Brennan", "Yuki Tanaka",
      "Priya Rao", "Omar Said", "Greta Voss", "Hank Doyle", "Ivy Nguyen"];
    const LANDLORDS = ["Crestview Holdings", "B. Falcone", "Sunset Property Co", "M. Delgado",
      "Harborline LLC", "K. Sorensen", "Pinnacle Residential", "T. Okonkwo", "Ridgeway Estates",
      "V. Castellano", "Northgate Rentals", "A. Lindqvist"];
    // pre-company wallet float by trade, so a clerk can be paid on day one
    // (wallet.js lazily makes _acct; this is the fallback float, same as
    // buildings.js ACCT_SEED keys). Unknown trade → modest default.
    const ACCT_SEED = { bank: 9000, casino: 8000, jewelry: 6500, security: 5000, carlot: 4000, chop: 3000, gym: 2200, clothing: 2000, guns: 2400, pawn: 2600, bar: 2800, gas: 1600, hospital: 3500, hardware: 1700, food: 900 };
    let _ownerSeed = ((cx | 0) * 31 + (cz | 0) * 17) >>> 0;
    function ownerName(pool) { _ownerSeed = (_ownerSeed * 1103515245 + 12345) >>> 0; return pool[_ownerSeed % pool.length]; }
    // infer a real TRADE from a prefab name when the recipe gives no explicit
    // shopKind (so an existing caller — e.g. the desert's Dry Gulch, named
    // SHERIFF/BANK/SALOON but with no shopKind — still maps to a real shops.js
    // trade instead of all collapsing to 'food'). Pure string match; the
    // explicit pick.shopKind always wins.
    const TRADE_WORDS = [
      ["bank", "bank"], ["saloon", "bar"], ["bar", "bar"], ["tavern", "bar"], ["pub", "bar"],
      ["casino", "casino"], ["club", "bar"], ["lodge", "bar"], ["jewel", "jewelry"],
      ["pawn", "pawn"], ["gun", "guns"], ["clothing", "clothing"], ["outfitter", "clothing"],
      ["dry goods", "clothing"], ["apothecary", "hospital"], ["clinic", "hospital"], ["hospital", "hospital"],
      ["gym", "gym"], ["spa", "gym"], ["hardware", "hardware"], ["feed", "hardware"], ["seed", "hardware"],
      ["chandler", "pawn"], ["assay", "bank"], ["general", "hardware"], ["store", "hardware"],
      ["market", "food"], ["grocer", "food"], ["diner", "food"], ["seafood", "food"], ["food", "food"],
      ["car", "carlot"], ["motors", "carlot"], ["chop", "chop"], ["fuel", "gas"], ["gas", "gas"],
      ["security", "security"], ["sheriff", "security"], ["customs", "bank"], ["realty", "realtor"], ["realtor", "realtor"],
    ];
    function inferShopKind(name) {
      if (!name) return null;
      const n = String(name).toLowerCase();
      for (const [w, k] of TRADE_WORDS) if (n.indexOf(w) >= 0) return k;
      return null;
    }
    function stampShopOwner(b, sk, storeys) {
      const seed = (ACCT_SEED[sk] != null ? ACCT_SEED[sk] : 1500) + (((storeys || 1) - 1) * 250);
      b.owner = { type: "business", id: null, name: ownerName(PROPRIETORS), buyable: true, _acct: { cash: seed } };
    }
    function stampHomeOwner(b, storeys) {
      const home = b.home, landlord = ownerName(LANDLORDS);
      const rentSeed = Math.round(400 + (home.rent || 0) * 6 + (storeys || 1) * 80);
      b.owner = {
        id: null, buyable: home.listed !== false,
        _acct: { cash: rentSeed },
        get type() { return home.owned ? "player" : "landlord"; },
        get name() { return home.owned ? "You" : landlord; },
      };
    }

    // CH6 — TOWN HEIGHT HIERARCHY. A town is a MINI-city, never a rival downtown:
    // scale a prefab's storeys DOWN by ring (civic core tallest, edges low) and
    // CLAMP to a hard town max well under the main-city core range (Midtown towers
    // 20+ floors). Derived purely from lt.ring + the prefab — no new rng draw, so
    // the deterministic world build / MP stay byte-identical.
    const TOWN_MAX_STOREYS = Math.max(1, (cfg.skyline && cfg.skyline.townMax) || cfg.townMaxStoreys || 4);

    // Some placed towns need a visible centre skyline. That decision must happen
    // BEFORE geometry is built: the old mini-city placer built a normal shell,
    // then called cityMakeBuilding again on the same lot to make it taller. Both
    // shells, stairs, floors, doors and colliders survived at identical bounds.
    // An opt-in skyline plan selects central non-residential lots here and gives
    // their one-and-only shell its final height. No extra RNG draws are involved.
    const skylinePlan = new Map();
    if (cfg.integratedSkyline && cfg.skyline) {
      const sky = cfg.skyline;
      const candidates = lots.filter(function (lt) { return lt.zone !== "residential"; })
        .slice().sort(function (a, b) {
          const da = Math.hypot(a.cx - cx, a.cz - cz), db = Math.hypot(b.cx - cx, b.cz - cz);
          return da - db || a.cx - b.cx || a.cz - b.cz;
        });
      const count = Math.min(candidates.length, Math.max(1, Math.round(lots.length * (sky.towerFrac == null ? 0.2 : sky.towerFrac))));
      const minSky = Math.max(1, sky.minStoreys || 3);
      const maxSky = Math.max(minSky, Math.min(18, (sky.maxStoreys || 8) + (sky.megaChance ? 2 : 0)));
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        skylinePlan.set(candidates[i], Math.max(minSky, Math.round(maxSky - (maxSky - minSky) * t)));
      }
    }
    function storeysFor(base, ring, lot, isShop) {
      if (isShop && skylinePlan.has(lot)) return skylinePlan.get(lot);
      const fall = ring <= 0 ? 1 : ring === 1 ? 0.7 : 0.5;
      return Math.min(TOWN_MAX_STOREYS, Math.max(1, Math.round((base || 1) * fall)));
    }

    // a compact STOREFRONT sign mounted flush on the facade above the door (CH3):
    // a thin emissive sign-board plate, plus the cached name sprite seated tight
    // against the wall. The sprite material is cached per text (makeLabelSprite),
    // so repeated names cost no extra draw call; the plate shares cmat(accent).
    const SIGN_Y = 3.4;                                   // just above a standard door
    function mountShopSign(lt, color, name) {
      const nx = lt.door.nx, nz = lt.door.nz;
      const fx = lt.cx + nx * (lt.w / 2 + 0.06), fz = lt.cz + nz * (lt.d / 2 + 0.06);  // on the door face
      // sign-board plate: a thin lit box hugging the facade (rotated to the wall)
      const boardW = Math.min(lt.w - 1.2, name.length * 0.5 + 2.4);
      const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, 1.0, 0.2),
        new THREE.MeshLambertMaterial({ color: pal.signBoard != null ? pal.signBoard : 0x2a2622, emissive: color, emissiveIntensity: 0.35 }));
      board.position.set(fx, SIGN_Y, fz);
      if (nx !== 0) board.rotation.y = Math.PI / 2;       // face the wall normal
      board.castShadow = false; root.add(board);
      // name plate (cached sprite) pressed against the board, facing the street
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite(name, { color: pal.sign || "#f4e7c2" });
        if (s) { s.position.set(fx + nx * 0.16, SIGN_Y, fz + nz * 0.16); s.scale.set(Math.min(boardW, name.length * 0.42 + 1.4), 0.9, 1); root.add(s); }
      }
    }
    for (const lt of lots) {
      // DETERMINISM-SACRED: exactly the same two cfg.rng() draws per lot as the
      // baseline — draw #1 (density roll) then, if not skipped, draw #2 (wpick).
      // An anchor lot is FORCED to build (skips the density-skip) and then has
      // its pick OVERRIDDEN by the plan AFTER wpick has drawn, so a forced lot
      // consumes the identical draw count. With no anchorPlan (V2 off) this is
      // byte-identical to the original loop.
      const roll = rng();                                   // draw #1
      const forced = anchorPlan && anchorPlan.has(lt);
      if (roll > buildProbFor(lt.ring) && !forced) continue;
      const recipe = (cfg.prefabs && cfg.prefabs[lt.zone]) || (cfg.prefabs && cfg.prefabs.default) || null;
      let pick = wpick(recipe, rng);                        // draw #2
      if (forced) pick = anchorPlan.get(lt) || pick;
      if (!pick) continue;
      // building shell?  (kind:'building' or no explicit asset key)
      const isBuilding = !pick.asset || pick.building || pick.kind === "building";
      if (isBuilding && mk) {
        const w = Math.max(8, lt.w - 1.5), d = Math.max(8, lt.d - 1.5);
        // Decide the program before construction. Integrated skyline lots are
        // still the same shop/home records; only their final shell height differs.
        const isShop = (pick.lotKind || (lt.zone === "residential" ? "home" : "shop")) === "shop";
        const storeys = storeysFor(pick.storeys, lt.ring, lt, isShop); // one shell, final height
        const color = pick.color != null ? pick.color : WOOD;
        let b = null;
        // V2: numeric door side (see SIDE_IDX finding). Homes use the shared
        // clean glass shell; buildings.js deliberately normalizes the removed
        // residential/fortified punched-window archetypes to office glass.
        const sideArg = V2 && SIDE_IDX[lt.doorSide] != null ? SIDE_IDX[lt.doorSide] : lt.doorSide;
        const shellOpts = pick.opts || (V2 && !isShop ? { stairs: true } : { retail: true });
        try { b = mk(root, lt.cx, lt.cz, w, d, storeys, color, sideArg, shellOpts); } catch (e) { b = null; }
        if (!b) continue;
        const doorPt = { x: lt.door.x + lt.door.nx * 1.6, z: lt.door.z + lt.door.nz * 1.6, nx: lt.door.nx, nz: lt.door.nz };
        // is this a commercial lot or a home? (zone default, prefab override)
        // CONTRACT: shops.js reads lot.kind DIRECTLY (no b.shop.kind fallback) and
        // the mainland sets lot.kind = the TRADE (buildings.js:4788). So a town
        // shop's lot.kind must be the real trade key (food/bank/bar/...), or its
        // counter menu won't open. Homes stay kind:"home". Without a shopKind a
        // shop defaults to a buyable 'food' diner — never a typeless lot.
        const sk = isShop ? (pick.shopKind || inferShopKind(pick.name) || "food") : null;
        const kind = isShop ? sk : "home";
        const lotRec = {
          cx: lt.cx, cz: lt.cz, w, d, kind, district,
          ring: lt.ring, zone: lt.zone, town: cfg.name,
          skylineStoreys: skylinePlan.get(lt) || null,
          building: { ...b, name: pick.name || "Building", sign: color, side: lt.doorSide, door: doorPt, shop: isShop },
        };
        const bb = lotRec.building;
        if (isShop) {
          // T2 — a vendor STANDS at a counter just inside the door (mirror
          // buildings.js vsx/vsz: a couple metres in from the door face) and the
          // lot carries a REAL shop record Zillow/shops/peds-staffing consume.
          const ins = Math.min(w, d) / 2 - 2.6;
          bb.vendorSpot = { x: lt.cx - lt.door.nx * ins, z: lt.cz - lt.door.nz * ins, face: Math.atan2(lt.door.nx, lt.door.nz) };
          bb.shop = { kind: sk, name: pick.name || "Shop", sign: color };
          // trade-specific flags shops.js / careers feature-detect on the building
          if (sk === "gas") bb.gas = true;
          if (sk === "carlot") bb.carlot = true;
          if (sk === "hospital") bb.hospital = true;
          if (sk === "realtor") bb.realtor = true;
          stampShopOwner(bb, sk, storeys);
          // V2 — NO HOLLOW SHELLS: a real sales counter just inside the back
          // wall (mirrors buildings.js's mainland counter math incl. the stair-
          // strip clamp) + the full trade-specific interior dresser + dressed
          // upper floors. Town shops were bare boxes before this.
          if (V2 && b.lbox) {
            const inx = -lt.door.nx, inz = -lt.door.nz;              // inward unit
            const wt = b.wt != null ? b.wt : 0.6;
            let ccx = inx * (w / 2 - 2.8), ccz = inz * (d / 2 - 2.8);
            let cw = inx ? 0.8 : Math.min(w - 2, 4.5);
            const cdp = inz ? 0.8 : Math.min(d - 2, 4.5);
            if (b.hasStairs) {
              const stairRight = -w / 2 + wt + (b.stairW || 4.2);
              if (cw > 1) {
                const roomRight = w / 2 - wt;
                cw = Math.min(cw, Math.max(1.8, roomRight - stairRight - 1.0));
                ccx = (stairRight + roomRight) / 2;
              } else if (ccx - cw / 2 < stairRight + 0.5) {
                ccx = stairRight + 0.5 + cw / 2;
              }
              ccx = Math.max(ccx, stairRight + 0.4 - inx * 1.2);
            }
            b.lbox(ccx, 0.6, ccz, cw, 1.2, cdp, 0x6b4a2a, { solid: true });
            // vendor stands BEHIND the real counter (replaces the estimate above)
            bb.vendorSpot = { x: lt.cx + ccx + inx * 1.2, z: lt.cz + ccz + inz * 1.2, face: Math.atan2(lt.door.nx, lt.door.nz) };
            if (CBZ.cityFurnishInterior) { try { CBZ.cityFurnishInterior(b, sk, { nx: inx, nz: inz }); } catch (e) {} }
            if (CBZ.cityFurnishApartment) {
              const fh = b.FH || 3.2;
              for (let k = 1; k < (b.storeys || storeys); k++) {
                try { CBZ.cityFurnishApartment(b, k * fh, (((lt.cx | 0) * 7 + (lt.cz | 0)) ^ k) & 0x7fffffff); } catch (e) {}
              }
            }
          }
        } else {
          // cheap MICRO-unit home so a town resident can actually afford one;
          // listed:false → off the buy-ladder by default, but still a real home
          // with a landlord float whose owner getter flips on home.owned (T2).
          bb.home = { tier: 0, name: pick.name || "Home", price: 0, rent: pick.rent != null ? pick.rent : 90, listed: false, owned: false, floorY: 0, door: doorPt };
          stampHomeOwner(bb, storeys);
          // V2 — a LIVED-IN home: every storey dressed as a real flat, which
          // auto-registers sleepable beds/sittable seats (propRegisterBed/Seat
          // → the generic "Sleep til morning"/sit prompts). Minecraft-village
          // rule: a house is a place with a bed, not a decorated box.
          if (V2 && CBZ.cityFurnishApartment) {
            const fh = b.FH || 3.2;
            for (let k = 0; k < (b.storeys || storeys); k++) {
              try { CBZ.cityFurnishApartment(b, k * fh, (((lt.cx | 0) + (lt.cz | 0) * 3) ^ (k * 7)) & 0x7fffffff); } catch (e) {}
            }
          }
        }
        // T1 — expose to the REAL arena arrays so Zillow/shops/careers/vendor
        // staffing/minimap all see the town's lots (guarded; A may be null in a
        // headless build, in which case the descriptor still returns the lot).
        if (A) {
          (A.lots = A.lots || []).push(lotRec);
          if (isShop) (A.shopLots = A.shopLots || []).push(lotRec);
          else (A.homeLots = A.homeLots || []).push(lotRec);
        }
        // CH3 — NO floating per-shop name sprite hovering at storeys*4 in the sky.
        // A real town announces a shop on its STOREFRONT: a thin lit sign board
        // mounted FLUSH on the facade above the door, with the (cached, draw-call
        // neutral) name plate seated tight against the wall facing the street.
        // cityMakeBuilding does NOT hang signAwning (that lives in the mainland
        // shop pass), so the town mounts its own compact facade board here.
        if (isShop && pick.name) mountShopSign(lt, color, pick.name);
        filled.push(lotRec);
      } else if (pick.asset && CBZ.assets && CBZ.assets.has && CBZ.assets.has(pick.asset)) {
        // X5 FINDING: this used to route through P.placeAsset (respects
        // occupancy) — but step 3 above ALREADY reserved this exact lot's
        // full rect via reserveRect(), so placeAsset's own isFree() check
        // (scanning the SAME reservation hash) sees every candidate point,
        // including the lot centre, as already occupied and silently places
        // nothing — every time, for any asset prefab. No existing recipe
        // ever used the asset-prefab path (grep citytemplates.js), so this
        // never surfaced until city/villagekit.js (X5) became its first
        // caller. The lot is, by construction (non-overlapping recursive
        // subdivision — see step 3), already this prop's EXCLUSIVE ground:
        // no second occupancy check is needed. Build it directly — the same
        // geometry + collider math placeAsset uses, minus the redundant,
        // self-conflicting reserve/isFree dance.
        const def = CBZ.assets.get(pick.asset);
        if (def) {
          try {
            // V2: QUANTIZE prop facing to 90° multiples (one rng() draw either
            // way — draw count unchanged, so determinism holds). This keeps
            // enterable-hut wall AABBs axis-aligned with the hut mesh (their
            // doorway gap follows this quantized facing). V2 off → the original
            // free rotation, byte-identical.
            const rot = pick.rot != null ? pick.rot
              : (V2 ? (Math.floor(rng() * 4) * Math.PI / 2) : rng() * Math.PI * 2);
            const scale = pick.scale || 1;
            const grp = new THREE.Group();
            def.build({ group: grp, x: lt.cx, z: lt.cz, rot, rng, scale });
            grp.position.set(lt.cx, def.y0 || 0, lt.cz);
            grp.rotation.y = rot;
            grp.scale.set(scale, scale, scale);
            grp.updateMatrix(); grp.matrixAutoUpdate = false;
            root.add(grp);
            if (!def.noCollide && CBZ.colliders) {
              const fp = CBZ.assets.rotatedFootprint(def, rot);
              CBZ.colliders.push({ minX: lt.cx - fp.hx, maxX: lt.cx + fp.hx, minZ: lt.cz - fp.hz, maxZ: lt.cz + fp.hz, y0: def.y0 || 0, y1: def.y1 == null ? 30 : def.y1, ref: grp });
            }
          } catch (e) {}
        }
      }
    }

    // =====================================================================
    //  5) THE TOWN SQUARE — the nav anchor. A paved/sand pad + a central
    //     landmark (fountain/well/flagpole) + benches + the town-name sign.
    // =====================================================================
    let square = null;
    if (squareCell && squareCell.bx != null) {
      const sx = squareCell.bx, sz = squareCell.bz, sw = squareCell.w, sd = squareCell.d;
      mergeAdd(root, [planeGeo(sx, sz, sw - 3, sd - 3, 0.06)], cmat(pal.plaza != null ? pal.plaza : SIDEWALK), { receive: true });
      reserveRect({ minX: sx - sw / 2, maxX: sx + sw / 2, minZ: sz - sd / 2, maxZ: sz + sd / 2 });
      // central landmark — a stone WELL (cylinder base + low ring) by default,
      // or a flagpole if the recipe asks. Decor with a thin collider.
      if (cfg.squarePrefab === "flagpole") {
        mergeAdd(root, [(function () { const g = new THREE.CylinderGeometry(0.18, 0.22, 9, 6); g.translate(sx, 4.5, sz); return g; })()], cmat(ACCENT), { cast: true });
        solid(sx, sz, 0.6, 0.6, 9);
      } else {
        mergeAdd(root, [
          (function () { const g = new THREE.CylinderGeometry(1.5, 1.7, 1.1, 12); g.translate(sx, 0.55, sz); return g; })(),
          (function () { const g = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5); g.translate(sx - 1.2, 1.7, sz); return g; })(),
          (function () { const g = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5); g.translate(sx + 1.2, 1.7, sz); return g; })(),
          (function () { const g = new THREE.BoxGeometry(3.0, 0.16, 0.4); g.translate(sx, 2.9, sz); return g; })(),
        ], cmat(pal.stone != null ? pal.stone : 0x9a8d72), { cast: true });
        solid(sx, sz, 3.2, 3.2, 2);
      }
      // benches around the square (instanced)
      const benchIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.4, 0.6), cmat(WOOD), 4);
      const dummy = new THREE.Object3D();
      const off = Math.min(sw, sd) / 2 - 4;
      [[0, -off], [0, off], [-off, 0], [off, 0]].forEach((c, i) => {
        dummy.position.set(sx + c[0], 0.45, sz + c[1]);
        dummy.rotation.set(0, c[0] !== 0 ? Math.PI / 2 : 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); benchIM.setMatrixAt(i, dummy.matrix);
      });
      benchIM.instanceMatrix.needsUpdate = true; benchIM.matrixAutoUpdate = false; benchIM.castShadow = true; root.add(benchIM);
      // the town-name sign. V2: a PHYSICAL welcome board on two posts at the
      // square's edge (owner rule: no floating word labels) — the cached name
      // sprite sits pressed tight against the board face, same convention as
      // the storefront sign boards above.
      if (CBZ.makeLabelSprite && cfg.name) {
        if (V2) {
          const bw2 = Math.min(11, cfg.name.length * 0.72 + 3.2);
          const bx = sx, bz = sz + sd / 2 - 2.0;
          mergeAdd(root, [
            (function () { const g = new THREE.BoxGeometry(0.22, 3.2, 0.22); g.translate(bx - bw2 / 2 + 0.3, 1.6, bz); return g; })(),
            (function () { const g = new THREE.BoxGeometry(0.22, 3.2, 0.22); g.translate(bx + bw2 / 2 - 0.3, 1.6, bz); return g; })(),
            (function () { const g = new THREE.BoxGeometry(bw2, 1.5, 0.18); g.translate(bx, 2.7, bz); return g; })(),
          ], cmat(ACCENT), { cast: true });
          solid(bx, bz, bw2, 0.5, 3.5);
          const s = CBZ.makeLabelSprite(cfg.name, { color: pal.sign || "#f4e7c2" });
          if (s) { s.position.set(bx, 2.7, bz + 0.16); s.scale.set(Math.min(bw2 - 0.6, cfg.name.length * 0.6 + 1.6), 1.1, 1); root.add(s); }
        } else {
          const s = CBZ.makeLabelSprite(cfg.name, { color: pal.sign || "#f4e7c2" });
          if (s) { s.position.set(sx, 5.5, sz); s.scale.set(Math.min(14, cfg.name.length * 1.3 + 4), 3, 1); root.add(s); }
        }
      }
      square = { x: sx, z: sz, w: sw, d: sd };
    }

    // =====================================================================
    //  6) STREET DRESSING — instanced lamps + hitching rails along the
    //     spine, and a couple of parked cars at the kerb. Bounded count.
    // =====================================================================
    const dummy2 = new THREE.Object3D();
    const lampN = Math.min(20, cols * 4);
    const lampIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 4.6, 6), cmat(ACCENT), lampN);
    const headIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), cmat(pal.lamp != null ? pal.lamp : 0xf3e3a6), lampN);
    for (let i = 0; i < lampN; i++) {
      const t = (i + 0.5) / lampN;
      const x = lerp(minX + 6, maxX - 6, t);
      const z = cz + (i % 2 ? 1 : -1) * (ROAD / 2 + 2.2);
      dummy2.position.set(x, 2.3, z); dummy2.scale.set(1, 1, 1); dummy2.rotation.set(0, 0, 0);
      dummy2.updateMatrix(); lampIM.setMatrixAt(i, dummy2.matrix);
      dummy2.position.set(x, 4.6, z); dummy2.updateMatrix(); headIM.setMatrixAt(i, dummy2.matrix);
    }
    lampIM.instanceMatrix.needsUpdate = true; lampIM.matrixAutoUpdate = false; lampIM.castShadow = true; root.add(lampIM);
    headIM.instanceMatrix.needsUpdate = true; headIM.matrixAutoUpdate = false; root.add(headIM);
    // hitching rails (frontier flavour) — two posts + a top bar, instanced bars
    const railN = Math.min(8, lots.length);
    if (railN > 0) {
      const railIM = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.18, 0.18), cmat(WOOD), railN);
      for (let i = 0; i < railN; i++) {
        const lt = lots[(i * 7) % lots.length];
        dummy2.position.set(lt.door.x + lt.door.nx * 1.0, 1.0, lt.door.z + lt.door.nz * 1.0);
        dummy2.rotation.set(0, lt.door.nx !== 0 ? Math.PI / 2 : 0, 0); dummy2.scale.set(1, 1, 1);
        dummy2.updateMatrix(); railIM.setMatrixAt(i, dummy2.matrix);
      }
      railIM.instanceMatrix.needsUpdate = true; railIM.matrixAutoUpdate = false; railIM.castShadow = true; root.add(railIM);
    }

    // SETTLEMENT REGISTRY — record this place so the world knows every
    // settlement, its flavor/tier, and that it carries PURPOSE (shops with
    // vendors, homes with beds, an optional casino). Reset per rebuild by
    // settlements.js's cityWorldGeo wrapper.
    if (V2) {
      let shopsN = 0, homesN = 0, casinoN = false;
      for (const l of filled) {
        if (l.kind === "home") homesN++; else shopsN++;
        if (l.kind === "casino") casinoN = true;
      }
      let bedsN = 0;
      if (CBZ.propBeds) for (const bd of CBZ.propBeds) {
        if (bd.x >= rect.minX && bd.x <= rect.maxX && bd.z >= rect.minZ && bd.z <= rect.maxZ) bedsN++;
      }
      (CBZ.settlements = CBZ.settlements || []).push({
        name: cfg.name || "Town", cx: cx, cz: cz, rect: rect,
        biome: cfg.biome || cfg.district || null,
        flavor: comp ? comp.flavor : null,
        tier: comp ? comp.tier : (CBZ.settlementTier ? CBZ.settlementTier(cfg) : null),
        lots: filled, square: square,
        counts: { shops: shopsN, homes: homesN, vendors: shopsN, beds: bedsN },
        casino: casinoN,
      });
    }

    return { name: cfg.name || "Town", cx, cz, rect, lots: filled, square, roads: townRoads };
  };
})();
