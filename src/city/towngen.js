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

   STREETS: the town's grid is laid by city/streetkit.js, the SAME kit as
   the downtown (kerbs, footways, corners, crosswalks, lane paint, lot pads
   painted by city/cityground.js); see section 1. Rural recipes
   (streetStyle "rural") get swept-dirt lanes instead.

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
  /* THE TOWN FLOOR IS FOUR SHEETS A CENTIMETRE APART: ground pad 0.03,
     sidewalk 0.04 (running 1 m under every street), road 0.05, square 0.06.
     A centimetre is below the depth buffer's resolution past ~50 m, so the
     dark street shimmered through the sidewalk band in stair-steps. Each
     sheet above the pad is pulled FORWARD one more step (the pad stays put:
     it is the one sitting on terrain), so an upper sheet always wins its
     overlap. A private clone, never the shared cmat: that material is used
     by walls and props of the same colour. Paint (PY 0.075) sits one step
     beyond the road. core/batch.js never merges a polygonOffset material. */
  const _layerMats = new Map();
  function layerMat(hex, step) {
    const k = hex + "|" + step;
    let m = _layerMats.get(k);
    if (!m) {
      m = cmat(hex).clone();
      m.polygonOffset = true; m.polygonOffsetFactor = -step; m.polygonOffsetUnits = -2 * step;
      _layerMats.set(k, m);
    }
    return m;
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

    /* =====================================================================
       1) THE STREET PLAN — centrelines and widths from the town's OWN road
          spec, then ONE street surface laid by city/streetkit.js, the same
          kit the downtown grid is built with.

       WHY (owner, from a respawn in a small town: "our road system and city
       building code don't generalize"): towns used to be four flat sheets a
       centimetre apart — a ground pad the colour of the recipe (Veridia's
       and Neon Reef's are asphalt grey/purple, so every empty lot read as a
       void of road), road planes, sidewalk slabs 1 m wider than each block,
       and decal paint — while the mainland stood on a real cross-section.
       city/props.js then dropped the mainland's raised kerb returns onto the
       town's flat corners and approach.js laid a grey "dropped kerb" slab on
       the carriageway at every door, which is the loose floating kerb pieces
       the owner saw. Two more faults were in the plan itself:
         · "mainstreet" laid its wide spine at cz whatever the row count, so
           on any odd-row town (Kesh, Mbeya) it ran THROUGH the middle blocks'
           lots, with block sidewalks and crosswalks painted across it and no
           cross-streets between the back lanes and the spine;
         · "organic" jittered the streets but framed the blocks and lots from
           the UN-jittered lines, so kerbs and frontages missed each other by
           up to 2.6 m.
       Now the plan is solved once: every street is a real centreline with its
       own width (the spine is one of the grid lines, 1.6x wide), blocks keep
       their authored size between road EDGES, and lots are cut from the
       blocks the kit actually drew. The kit gives every block a continuous
       granite kerb and footway with rounded corners, ramps and crosswalks at
       the real interior junctions, lane paint only on carriageway, and a lot
       pad that city/cityground.js paints lawn / slab / pavers per parcel.
       Rural settlements (villagekit's dirt villages) keep swept-dirt lanes:
       no kerb, no paint — a hut village has neither.
       ===================================================================== */
    const FOOTWAY = 2.4;                               // kerb face to lot line
    const RURAL = cfg.streetStyle === "rural" || !(CBZ.streetKit && CBZ.streetKit.build);
    const xW = [], zW = [];
    for (let k = 0; k <= cols; k++) xW.push(ROAD);
    for (let k = 0; k <= rows; k++) zW.push(ROAD);
    // the main street is a GRID LINE (the middle one), never a strip laid
    // through the middle of a row of blocks
    const spineJ = pattern === "mainstreet" ? ((rows / 2) | 0) : -1;
    if (spineJ >= 0) zW[spineJ] = Math.round(ROAD * 1.6 * 10) / 10;
    // centrelines on the authored pitch (block + street), so the town keeps
    // the footprint every placer reserved for it (biome TOWN rects, minicity
    // links docking on the perimeter street); the wide spine takes its extra
    // width out of the two rows of blocks it runs between
    function lay(n, B, c) {
      const p = [];
      for (let k = 0; k <= n; k++) p.push(c - (n * (B + ROAD)) / 2 + k * (B + ROAD));
      return p;
    }
    const xLines = lay(cols, BW, cx), zLines = lay(rows, BD, cz);
    if (pattern === "organic") {
      // unplanned streets: each line wanders a little (same draws, same order
      // as ever: every vertical, then every horizontal), and EVERYTHING below
      // — kerbs, blocks, lots, doors — is framed from the wandered lines
      for (let k = 0; k <= cols; k++) xLines[k] += (rng() - 0.5) * ROAD * 0.4;
      for (let k = 0; k <= rows; k++) zLines[k] += (rng() - 0.5) * ROAD * 0.4;
    }
    const minX = xLines[0] - xW[0] / 2, maxX = xLines[cols] + xW[cols] / 2;
    const minZ = zLines[0] - zW[0] / 2, maxZ = zLines[rows] + zW[rows] / 2;
    const rect = { minX, maxX, minZ, maxZ };
    const townRoads = [];   // {x,z,vertical,len,w,...}
    // the block (i,j): the rectangle between its four road edges
    function blockOf(i, j) {
      const x0 = xLines[i] + xW[i] / 2, x1 = xLines[i + 1] - xW[i + 1] / 2;
      const z0 = zLines[j] + zW[j] / 2, z1 = zLines[j + 1] - zW[j + 1] / 2;
      return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
    }

    // ----- placement-API feature detect -----
    const P = CBZ.placement || null;
    if (P && P.seedFromColliders) { try { P.seedFromColliders(); } catch (e) {} }
    function reserveRect(r) { if (P && P.reserve) { try { P.reserve(r); } catch (e) {} } }

    // the settled ground the town stands on (and what shows outside the grid)
    mergeAdd(root, [planeGeo(cx, cz, maxX - minX + 6, maxZ - minZ + 6, 0.03)], cmat(RURAL ? GROUND : (pal.verge != null ? pal.verge : GROUND)), { receive: true });

    // ----- the street RECORDS: exactly the cross-section that is drawn, so
    // traffic, lamps, approaches and the junction solver read the real street
    function lanesFor(w) { return w >= 13 ? 2 : 1; }
    function roadRec(vertical, k) {
      const w = vertical ? xW[k] : zW[k];
      const lanesPerDir = lanesFor(w);
      const laneW = Math.min(3.6, w / (lanesPerDir * 2));
      // litByTown: section 6 lights this street with the town's own lamps;
      // city/props.js's lamp walk skips it instead of lighting it twice.
      // kit: the corners, kerbs and crossings are drawn with the surface, so
      // props.js's junction pass leaves them alone (as for the downtown grid).
      const seg = vertical
        ? { x: xLines[k], z: (minZ + maxZ) / 2, vertical: true, len: maxZ - minZ }
        : { x: (minX + maxX) / 2, z: zLines[k], vertical: false, len: maxX - minX };
      Object.assign(seg, { district: cfg.district || "town", w, lanesPerDir, laneW, litByTown: true,
        kit: true, footway: RURAL ? 0 : FOOTWAY, rural: RURAL || undefined, main: (!vertical && k === spineJ) || undefined });
      townRoads.push(seg);
      // T1: town streets go on the REAL arena road list (traffic/citynav)
      if (cfg.pushCityRoads !== false && A && A.roads) A.roads.push(seg);
      return seg;
    }
    for (let k = 0; k <= cols; k++) roadRec(true, k);
    for (let k = 0; k <= rows; k++) roadRec(false, k);

    // =====================================================================
    //  2) THE STREET SURFACE
    // =====================================================================
    let kit = null;
    if (!RURAL) {
      const baseV = townRoads[0], baseH = townRoads.find(function (r) { return !r.vertical && !r.main; }) || townRoads[cols + 1];
      try {
        kit = CBZ.streetKit.build({
          root, name: "town", surfaceName: "town-street-surface",
          xLines, zLines, ROAD, xWidths: xW, zWidths: zW,
          xLanes: xW.map(lanesFor), zLanes: zW.map(lanesFor),
          laneW: 3.6, lanesPerDir: lanesFor(ROAD), footway: FOOTWAY,
          cornerR: CBZ.roadCornerRadius ? CBZ.roadCornerRadius(baseV, baseH, FOOTWAY) : 4.5,
          apron: 0,                        // the road edge eases into the town's ground
          sharedMaterial: true, driveways: [],
        });
      } catch (e) { try { console.error("[towngen] street kit", cfg.name, e); } catch (e2) {} kit = null; }
    }
    if (!kit) {
      // RURAL LANES: swept dirt, flush with the ground, no kerb and no paint
      const roadGeoms = [];
      for (const s of townRoads) roadGeoms.push(s.vertical ? planeGeo(s.x, s.z, s.w, s.len, 0.05) : planeGeo(s.x, s.z, s.len, s.w, 0.05));
      mergeAdd(root, roadGeoms, layerMat(pal.road != null ? pal.road : 0x5a4f3e, 2), { receive: true });
      for (const s of townRoads) { s.footway = 0; s.rural = true; }
    }
    // the ground under a point of this town: the kit's surface (road 0.05,
    // footway 0.18, lot pad 0.125), else the dirt floor
    function gy(x, z) {
      if (kit) { const y = kit.heightAt(x, z); if (y != null) return y; }
      return 0.03;
    }
    const LOT_Y = kit ? kit.profile.yLot : 0.03;

    // =====================================================================
    //  3) LOTS — subdivide each block (inside its footway) into non-overlapping
    //     lots by recursively splitting across the LONG axis until min
    //     frontage / min area. Each lot's door faces the nearest road edge of
    //     its block. Lots NEVER overlap by construction.
    // =====================================================================
    const MIN_FRONT = cfg.minFrontage || 12;
    const MIN_AREA = cfg.minLotArea || 150;
    const lots = [];           // {cx,cz,w,d,ring,zone,doorSide,door:{x,z,nx,nz}}
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
      const B = blockOf(i, j);
      const ring = ringOf(i, j);
      if (squareCell && i === squareCell.i && j === squareCell.j) {
        squareCell.bx = B.cx; squareCell.bz = B.cz; squareCell.w = B.w; squareCell.d = B.d;
        continue;   // square block holds NO building lots
      }
      const inner = [];
      subdivide(B.cx, B.cz, B.w - FOOTWAY * 2, B.d - FOOTWAY * 2, ring, inner);
      for (const lt of inner) {
        // door faces the nearest road edge of the parent BLOCK
        const dxE = B.maxX - lt.cx, dxW = lt.cx - B.minX;
        const dzS = B.maxZ - lt.cz, dzN = lt.cz - B.minZ;
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
      const frac = sky.towerFrac == null ? 0.2 : sky.towerFrac;
      const minSky = Math.max(1, sky.minStoreys || 3);
      const maxSky = Math.max(minSky, Math.min(20, (sky.maxStoreys || 8) + (sky.megaChance ? 2 : 0)));
      // A real skyline is a CLUSTER, never one absurd needle dropped into a
      // little town. Only recipes that are actually urban opt in; ports get at
      // least eight related towers and major finance/casino cores get ten. Farm,
      // factory and alpine settlements keep their authored low-rise scale.
      const wantsTall = (sky.landmarkStoreys || 0) >= 12 && (sky.maxStoreys || 0) >= 7 && frac >= 0.16;
      const requested = wantsTall
        ? Math.max(sky.megaChance ? 10 : 8, Math.round(lots.length * frac))
        : 0;
      const count = Math.min(candidates.length, requested);
      const landmark = Math.max(maxSky, Math.min(48, sky.landmarkStoreys || maxSky));
      for (let i = 0; i < count; i++) {
        // Dense crown: the second/third towers remain substantial, then the
        // cluster tapers into its surrounding mid-rise fabric. This removes the
        // lonely-super-tall silhouette without making every roof identical.
        const t = i / Math.max(1, count - 1);
        const crown = Math.round(landmark * (0.96 - 0.54 * Math.pow(t, 0.82)));
        skylinePlan.set(candidates[i], Math.max(minSky, Math.max(maxSky, crown)));
      }
    }
    function storeysFor(base, ring, lot, isShop) {
      if (skylinePlan.has(lot)) return skylinePlan.get(lot);
      const fall = ring <= 0 ? 1 : ring === 1 ? 0.7 : 0.5;
      return Math.min(TOWN_MAX_STOREYS, Math.max(1, Math.round((base || 1) * fall)));
    }

    // THE SHOP FRONT: a sign board on the facade over the door, a canopy under
    // it, and for the clinic (the hospital trade, the door a fallen player wakes
    // outside) a deep entrance canopy on two posts with a lit soffit.
    // BOTH ARE MEASURED OFF THE SHELL, NOT THE LOT: the shell is built 1.5 m
    // narrower than its lot (w = lt.w - 1.5), so a board placed at the lot edge
    // (the old `lt.w / 2 + 0.06`) hung 0.8 m in front of the wall in mid air,
    // and its width came from lt.w even on a door that faces +-x. `bw`/`bd` are
    // the shell's own footprint.
    const SIGN_Y = 3.4;                                   // just above the canopy
    const _boardMats = new Map();
    function boardMat(color) {
      const k = (pal.signBoard != null ? pal.signBoard : 0x2a2622) + "|" + color;
      let m = _boardMats.get(k);
      if (!m) { m = new THREE.MeshLambertMaterial({ color: pal.signBoard != null ? pal.signBoard : 0x2a2622, emissive: color, emissiveIntensity: 0.35 }); _boardMats.set(k, m); }
      return m;
    }
    function frontOf(lt, bw, bd) {
      const nx = lt.door.nx, nz = lt.door.nz, alongZ = Math.abs(nx) > 0.5;
      const half = alongZ ? bw / 2 : bd / 2, span = alongZ ? bd : bw;
      return { nx: nx, nz: nz, tx: -nz, tz: nx, alongZ: alongZ, span: span, x: lt.cx + nx * half, z: lt.cz + nz * half };
    }
    function mountShopSign(lt, color, name, bw, bd) {
      const f = frontOf(lt, bw, bd);
      const fx = f.x + f.nx * 0.12, fz = f.z + f.nz * 0.12;          // 2 cm off the wall
      const boardW = Math.min(f.span - 1.2, name.length * 0.5 + 2.4);
      const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, 1.0, 0.2), boardMat(color));
      board.position.set(fx, SIGN_Y, fz);
      if (f.alongZ) board.rotation.y = Math.PI / 2;       // face the wall normal
      board.castShadow = false; root.add(board);
      // name plate (cached sprite) pressed against the board, facing the street
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite(name, { color: pal.sign || "#f4e7c2" });
        if (s) { s.position.set(fx + f.nx * 0.12, SIGN_Y, fz + f.nz * 0.12); s.scale.set(Math.min(boardW, name.length * 0.42 + 1.4), 0.9, 1); root.add(s); }
      }
    }
    // canopies are collected here and merged after the lot loop: every canopy
    // in a town is one draw, every lit soffit another, every post a third.
    const canopyGeo = [], soffitGeo = [], postGeo = [];
    // merge what the shop canopies queued (the town's end-of-fill merge, and
    // a streamed parcel's own when it is built later)
    function flushCanopies() {
      const CANOPY = cfg.canopyColor != null ? cfg.canopyColor : (kit ? 0x3a3d42 : WOOD);
      if (canopyGeo.length) mergeAdd(root, canopyGeo.splice(0), cmat(CANOPY), { cast: true });
      if (postGeo.length) mergeAdd(root, postGeo.splice(0), cmat(CANOPY), { cast: true });
      if (soffitGeo.length) mergeAdd(root, soffitGeo.splice(0), cmat(0xfff0d2, { emissive: 0xfff0d2, ei: 0.5 }), {});
    }
    function frontBox(list, x, y, z, w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); }
    function shopCanopy(lt, bw, bd, trade) {
      const f = frontOf(lt, bw, bd), er = trade === "hospital";
      const W = Math.min(f.span - 1.0, er ? 7.0 : 3.6);
      if (W < 1.8) return;
      // never past the kerb: the shell stands `setback` inside its lot line and
      // the footway runs FOOTWAY beyond that (a rural lane has no footway)
      const setback = ((f.alongZ ? lt.w - bw : lt.d - bd) / 2) || 0;
      const D = Math.min(er ? 5.0 : 1.3, setback + (kit ? FOOTWAY : 1.2) - 0.45), th = er ? 0.28 : 0.14;
      if (D < 0.8) return;
      const y0 = SIGN_Y - 0.5 - th;                       // the board stands on it
      const cx0 = f.x + f.nx * D / 2, cz0 = f.z + f.nz * D / 2;
      const sx = f.alongZ ? D : W, sz = f.alongZ ? W : D;
      frontBox(canopyGeo, cx0, y0 + th / 2, cz0, sx, th, sz);
      frontBox(soffitGeo, cx0, y0 - 0.012, cz0, sx - 0.3, 0.02, sz - 0.3);
      if (!er) return;
      // the entrance canopy stands on two posts at its outer corners (solid)
      for (const sg of [-1, 1]) {
        const px = f.x + f.nx * (D - 0.3) + f.tx * sg * (W / 2 - 0.3), pz = f.z + f.nz * (D - 0.3) + f.tz * sg * (W / 2 - 0.3);
        frontBox(postGeo, px, y0 / 2, pz, 0.26, y0, 0.26);
        solid(px, pz, 0.32, 0.32, y0);
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
      const forced = (anchorPlan && anchorPlan.has(lt)) || skylinePlan.has(lt);
      if (roll > buildProbFor(lt.ring) && !forced) continue;
      const recipe = (cfg.prefabs && cfg.prefabs[lt.zone]) || (cfg.prefabs && cfg.prefabs.default) || null;
      let pick = wpick(recipe, rng);                        // draw #2
      if (anchorPlan && anchorPlan.has(lt)) pick = anchorPlan.get(lt) || pick;
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
        // V2: numeric door side (see SIDE_IDX finding). Homes use the shared
        // clean glass shell; buildings.js deliberately normalizes the removed
        // residential/fortified punched-window archetypes to office glass.
        const sideArg = V2 && SIDE_IDX[lt.doorSide] != null ? SIDE_IDX[lt.doorSide] : lt.doorSide;
        const shellOpts = pick.opts || (V2 && !isShop ? { stairs: true } : { retail: true });
        const doorPt = { x: lt.door.x + lt.door.nx * 1.6, z: lt.door.z + lt.door.nz * 1.6, nx: lt.door.nx, nz: lt.door.nz };
        // is this a commercial lot or a home? (zone default, prefab override)
        // CONTRACT: shops.js reads lot.kind DIRECTLY (no b.shop.kind fallback) and
        // the mainland sets lot.kind = the TRADE (buildings.js:4788). So a town
        // shop's lot.kind must be the real trade key (food/bank/bar/...), or its
        // counter menu won't open. Homes stay kind:"home". Without a shopKind a
        // shop defaults to a buyable 'food' diner — never a typeless lot.
        const sk = isShop ? (pick.shopKind || inferShopKind(pick.name) || "food") : null;
        const kind = isShop ? sk : "home";
        /* THE LOT IS DATA NOW, THE BUILDING WHEN IT CAN BE SEEN. Everything a
           system asks of a town lot (its kind, door, shop, owner, home, where the
           vendor stands) is decided here, in the same order with the same draws
           as always (the shell never drew from the town rng). The shell, its
           counter, its furnished floors, its sign and canopy are one
           CBZ.sliceAt job over the parcel: with no streaming it runs right here
           exactly as before; in the streamed city a far parcel of a big town
           is built only when the player comes within sight of it (and goes
           with the town when the town is freed). */
        const lotRec = {
          cx: lt.cx, cz: lt.cz, w, d, kind, district,
          ring: lt.ring, zone: lt.zone, town: cfg.name,
          skylineStoreys: skylinePlan.get(lt) || null,
          building: { name: pick.name || "Building", sign: color, side: lt.doorSide, door: doorPt, shop: isShop, storeys: storeys },
          // the street this parcel fronts, as drawn: approach.js reads it to
          // stop its crossing at the footway (the kit owns the kerb) and to
          // leave the driveway to the painted lot ground
          street: kit ? { footway: FOOTWAY, yLot: LOT_Y, ground: true } : { footway: 0, yLot: 0.03, rural: true },
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
        } else {
          // cheap MICRO-unit home so a town resident can actually afford one;
          // listed:false → off the buy-ladder by default, but still a real home
          // with a landlord float whose owner getter flips on home.owned (T2).
          bb.home = { tier: 0, name: pick.name || "Home", price: 0, rent: pick.rent != null ? pick.rent : 90, listed: false, owned: false, floorY: 0, door: doorPt };
          stampHomeOwner(bb, storeys);
        }
        const buildShell = function (late) {
          let b = null;
          try { b = mk(root, lt.cx, lt.cz, w, d, storeys, color, sideArg, shellOpts); } catch (e) { b = null; }
          if (!b) return;
          // the shell's record under the data decided above (which wins, as the
          // object spread used to make it)
          const keep = {};
          for (const k in bb) keep[k] = bb[k];
          Object.assign(bb, b, keep);
          bb.storeys = b.storeys != null ? b.storeys : storeys;
          if (isShop) {
            // V2 — NO HOLLOW SHELLS: a real sales counter just inside the back
            // wall (buildings.js's mainland counter math, slid clear of the stair
            // core the shell reserved) + the full trade-specific interior dresser + dressed
            // upper floors. Town shops were bare boxes before this.
            if (V2 && b.lbox) {
              const inx = -lt.door.nx, inz = -lt.door.nz;              // inward unit
              let ccx = inx * (w / 2 - 2.8), ccz = inz * (d / 2 - 2.8);
              let cw = inx ? 0.8 : Math.min(w - 2, 4.5);
              const cdp = inz ? 0.8 : Math.min(d - 2, 4.5);
              let cdp2 = cdp;
              if (CBZ.cityFitCounter) ({ ccx, ccz, cw, cd: cdp2 } = CBZ.cityFitCounter(b, inx, ccx, ccz, cw, cdp));
              const drawCounter = function () {
                return b.lbox(ccx, 0.6, ccz, cw, 1.2, cdp2, 0x6b4a2a, { solid: true });
              };
              if (CBZ.interiorBounded) CBZ.interiorBounded(b, drawCounter, "town-counter");
              else drawCounter();
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
          } else if (V2 && CBZ.cityFurnishApartment) {
            // V2 — a LIVED-IN home: every storey dressed as a real flat, which
            // auto-registers sleepable beds/sittable seats (propRegisterBed/Seat
            // → the generic "Sleep til morning"/sit prompts). Minecraft-village
            // rule: a house is a place with a bed, not a decorated box.
            const fh = b.FH || 3.2;
            for (let k = 0; k < (b.storeys || storeys); k++) {
              try { CBZ.cityFurnishApartment(b, k * fh, (((lt.cx | 0) + (lt.cz | 0) * 3) ^ (k * 7)) & 0x7fffffff); } catch (e) {}
            }
          }
          // CH3 — NO floating per-shop name sprite hovering at storeys*4 in the sky.
          // A real town announces a shop on its STOREFRONT: a thin lit sign board
          // mounted FLUSH on the facade above the door, with the (cached, draw-call
          // neutral) name plate seated tight against the wall facing the street.
          // cityMakeBuilding does NOT hang signAwning (that lives in the mainland
          // shop pass), so the town mounts its own compact facade board here.
          if (isShop && pick.name) mountShopSign(lt, color, pick.name, w, d);
          if (isShop) shopCanopy(lt, w, d, sk);
          // a late parcel's canopy is merged with it (the town's merge ran long
          // ago), and a late shop's shelves are planned now (city/storegoods.js)
          if (late) { flushCanopies(); if (isShop && CBZ.storeGoodsPlan) CBZ.storeGoodsPlan(lotRec); }
          // a casino shell that landed after the order-90 dress pass
          if (late && kind === "casino" && CBZ.dressCasino) CBZ.dressCasino(root, lotRec);
        };
        let lateShell = false;
        if (CBZ.sliceAt) {
          const hw = w / 2 + 6, hd = d / 2 + 6;
          CBZ.sliceAt({ minX: lt.cx - hw, maxX: lt.cx + hw, minZ: lt.cz - hd, maxZ: lt.cz + hd }, function () { buildShell(lateShell); }, { name: "town lot " + (cfg.name || "") });
        } else buildShell(false);
        lateShell = true;
        // T1 — expose to the REAL arena arrays so Zillow/shops/careers/vendor
        // staffing/minimap all see the town's lots (guarded; A may be null in a
        // headless build, in which case the descriptor still returns the lot).
        if (A) {
          (A.lots = A.lots || []).push(lotRec);
          if (isShop) (A.shopLots = A.shopLots || []).push(lotRec);
          else (A.homeLots = A.homeLots || []).push(lotRec);
        }
        filled.push(lotRec);
        lt._rec = lotRec;
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
    flushCanopies();

    // =====================================================================
    //  5) THE TOWN SQUARE — the nav anchor. A paved/sand pad + a central
    //     landmark (fountain/well/flagpole) + benches + the town-name sign.
    // =====================================================================
    let square = null;
    if (squareCell && squareCell.bx != null) {
      const sx = squareCell.bx, sz = squareCell.bz, sw = squareCell.w, sd = squareCell.d;
      // On a kerbed town the square is the block's own lot pad inside its
      // footway, painted as a small park (lawn quarters, gravel paths, a paved
      // round at the landmark) by city/cityground.js; a dirt village keeps a
      // swept plaza sheet.
      const Y0 = kit ? LOT_Y : 0.06;
      const inW = kit ? sw - FOOTWAY * 2 : sw - 3, inD = kit ? sd - FOOTWAY * 2 : sd - 3;
      if (!kit) mergeAdd(root, [planeGeo(sx, sz, inW, inD, 0.06)], layerMat(pal.plaza != null ? pal.plaza : SIDEWALK, 3), { receive: true });
      reserveRect({ minX: sx - sw / 2, maxX: sx + sw / 2, minZ: sz - sd / 2, maxZ: sz + sd / 2 });
      // central landmark — a stone WELL (cylinder base + low ring) by default,
      // or a flagpole if the recipe asks. Decor with a thin collider.
      if (cfg.squarePrefab === "flagpole") {
        // a real pole with the nation's flag on it (city/flags.js), not a bare post
        if (CBZ.flags) CBZ.flags.pole(root, { x: sx, y: Y0, z: sz, height: 9, base: true });
        solid(sx, sz, 0.6, 0.6, 9);
      } else {
        mergeAdd(root, [
          (function () { const g = new THREE.CylinderGeometry(1.5, 1.7, 1.1, 12); g.translate(sx, Y0 + 0.55, sz); return g; })(),
          (function () { const g = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5); g.translate(sx - 1.2, Y0 + 1.7, sz); return g; })(),
          (function () { const g = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5); g.translate(sx + 1.2, Y0 + 1.7, sz); return g; })(),
          (function () { const g = new THREE.BoxGeometry(3.0, 0.16, 0.4); g.translate(sx, Y0 + 2.9, sz); return g; })(),
        ], cmat(pal.stone != null ? pal.stone : 0x9a8d72), { cast: true });
        solid(sx, sz, 3.2, 3.2, 2);
      }
      // benches around the square (instanced). On the park square they sit
      // beside the four paths, where cityground wears the turf bald at a
      // bench (its own bench spots), not floating over a lawn.
      const benchIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.4, 0.6), cmat(WOOD), 4);
      const dummy = new THREE.Object3D();
      const bo = Math.min(inW, inD) * 0.23, off = Math.min(sw, sd) / 2 - 4;
      const benchAt = kit
        ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(function (q) { return [q[0] * bo + (q[0] === 0 ? 2 : 0), q[1] * bo + (q[1] === 0 ? 2 : 0), q[0] === 0]; })
        : [[0, -off, false], [0, off, false], [-off, 0, true], [off, 0, true]];
      benchAt.forEach((c, i) => {
        const yaw90 = c[2];
        dummy.position.set(sx + c[0], Y0 + 0.45, sz + c[1]);
        dummy.rotation.set(0, yaw90 ? Math.PI / 2 : 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); benchIM.setMatrixAt(i, dummy.matrix);
        // SOLID: a 2.2 m plank whose top is 0.65 — over physics.js's 0.45
        // STEP_UP, so it is not something you walk over, it is something you
        // walked THROUGH. An InstancedMesh has no per-instance collider, so
        // the AABB is pushed here, from the SAME rotation the matrix used.
        solid(sx + c[0], sz + c[1], yaw90 ? 0.6 : 2.2, yaw90 ? 2.2 : 0.6, Y0 + 0.65);
      });
      benchIM.instanceMatrix.needsUpdate = true; benchIM.matrixAutoUpdate = false; benchIM.castShadow = true; root.add(benchIM);
      // the town-name sign: a PHYSICAL welcome board on two posts at the
      // square's edge (owner rule: no floating word labels), inside the lot
      // line on a kerbed town so it stands on the square, not the footway.
      if (CBZ.makeLabelSprite && cfg.name) {
        if (V2) {
          const bw2 = Math.min(11, cfg.name.length * 0.72 + 3.2);
          const bx = sx, bz = sz + (kit ? inD / 2 - 1.2 : sd / 2 - 2.0);
          mergeAdd(root, [
            (function () { const g = new THREE.BoxGeometry(0.22, 3.2, 0.22); g.translate(bx - bw2 / 2 + 0.3, Y0 + 1.6, bz); return g; })(),
            (function () { const g = new THREE.BoxGeometry(0.22, 3.2, 0.22); g.translate(bx + bw2 / 2 - 0.3, Y0 + 1.6, bz); return g; })(),
            (function () { const g = new THREE.BoxGeometry(bw2, 1.5, 0.18); g.translate(bx, Y0 + 2.7, bz); return g; })(),
          ], cmat(ACCENT), { cast: true });
          // only the two POSTS are solid: the board spans y 1.95-3.45, over a
          // standing head, and the gap between the posts is walkable
          for (const ps of [-1, 1]) solid(bx + ps * (bw2 / 2 - 0.3), bz, 0.4, 0.4, Y0 + 3.2);
          const s = CBZ.makeLabelSprite(cfg.name, { color: pal.sign || "#f4e7c2" });
          if (s) { s.position.set(bx, Y0 + 2.7, bz + 0.16); s.scale.set(Math.min(bw2 - 0.6, cfg.name.length * 0.6 + 1.6), 1.1, 1); root.add(s); }
        } else {
          const s = CBZ.makeLabelSprite(cfg.name, { color: pal.sign || "#f4e7c2" });
          if (s) { s.position.set(sx, 5.5, sz); s.scale.set(Math.min(14, cfg.name.length * 1.3 + 4), 3, 1); root.add(s); }
        }
      }
      square = { x: sx, z: sz, w: sw, d: sd };
    }

    // =====================================================================
    //  5b) THE LOT GROUND — one pad per block inside its footway, wearing
    //      city/cityground.js: built parcels get their lawn/beds/slab/pavers
    //      from what stands on them, empty ones are grass or a poured slab
    //      by zone, the square is a park. One draw call for the whole town.
    // =====================================================================
    if (kit) {
      const flavor = comp ? comp.flavor : null;
      const yard = flavor === "factory" || flavor === "port";
      const groundLots = [];
      for (const lt of lots) {
        const rec = lt._rec || null;
        const kind = lt.zone === "residential" ? "residential" : (yard ? "industrial" : (lt.zone === "civic" ? "core" : "commercial"));
        groundLots.push({ cx: lt.cx, cz: lt.cz, w: lt.w, d: lt.d, groundKind: kind,
          groundWealth: lt.zone === "civic" ? 0.7 : (lt.zone === "commercial" ? 0.55 : 0.45),
          building: rec ? rec.building : null });
      }
      if (square) {
        groundLots.push({ cx: square.x, cz: square.z, w: square.w - FOOTWAY * 2, d: square.d - FOOTWAY * 2,
          groundKind: "core", groundWealth: 0.7, building: { park: true } });
      }
      const gmat = CBZ.cityGround
        ? CBZ.cityGround.material({ lots: groundLots, xLines, zLines, splat: 512, main: false,
            // inside a world build the order-68 pass paints it once, driveways included
            paintNow: !(CBZ._settlementArena && A === CBZ._settlementArena) })
        : new THREE.MeshLambertMaterial({ color: GROUND });
      kit.lotMesh("town-lot-ground", null, gmat, 1 / 8);
    }

    // =====================================================================
    //  6) STREET DRESSING — instanced lamps + hitching rails along the
    //     spine, and a couple of parked cars at the kerb. Bounded count.
    // =====================================================================
    const dummy2 = new THREE.Object3D();
    // ---- STREET LAMPS -----------------------------------------------------
    // OWNER, with a screenshot: "street lamps stand as bare cylinders."
    // They did, and it was worse than that. This was a 4.6 m cylinder with a
    // 0.5 m CUBE balanced on top of it — no arm, no luminaire, the "head"
    // directly over the pole so it lit the PAVEMENT and left the lane dark,
    // NO COLLIDER at all (you walked through every one), and marched down
    // `cz` — which for any town with an odd row count is not a street at all,
    // so a whole row of them stood in the middle of a block.
    //
    // All four are fixed by using what the file already has: the town's own
    // road records, and city/props.js's shared CBZ.lampMast solve — the same
    // one the mainland's lamps and utility_lines.js's cobra heads run on, so a
    // town lamp is now the same object as a city lamp at a village's scale.
    // Determinism: positional only. No cfg.rng draw is taken here, so the
    // shared stream stays byte-identical whatever this does.
    // 6 m shaft, 2 m arm: a small-town street light. (The old 4.6 m stub was
    // shorter than the buildings' ground floor and its "head" never left the
    // pavement.) The offset below is the kerb + 1 m, so head = kerb - 1 m,
    // i.e. genuinely over the near travel lane on a 7 m lane or a 12 m street.
    const LM = CBZ.lampMast ? CBZ.lampMast({ poleH: 6.0, reach: 2.0, rise: 0.32, poleR: 0.12 })
      : { poleH: 6.0, poleCY: 3.0, armLen: 2.01, armRotX: Math.PI / 2, armCY: 6.10,
          armCZ: 1.03, headY: 6.22, headZ: 2.0, reach: 2.0 };
    // POLE + ARM AS ONE PROTOTYPE, so a real fixture still costs the two
    // InstancedMesh this town always spent — the arm is free.
    const lampGeoms = [];
    {
      const gp = new THREE.CylinderGeometry(0.12, 0.16, LM.poleH, 6);
      gp.translate(0, LM.poleCY, 0); lampGeoms.push(gp);
      const ga = new THREE.CylinderGeometry(0.06, 0.06, LM.armLen, 5);
      ga.rotateX(LM.armRotX); ga.translate(0, LM.armCY, LM.armCZ); lampGeoms.push(ga);
    }
    const lampProto = (BGU && BGU.mergeBufferGeometries) ? BGU.mergeBufferGeometries(lampGeoms) : lampGeoms[0];
    // The head gets its OWN material (not the shared cmat cache) because it is
    // pushed into the city's dusk driver, which writes emissiveIntensity — on a
    // cached material that would light every other prop sharing that colour.
    const headMat = new THREE.MeshLambertMaterial({
      color: pal.lamp != null ? pal.lamp : 0xf3e3a6,
      emissive: pal.lamp != null ? pal.lamp : 0xffd9a0, emissiveIntensity: 0,
    });
    // WHERE: on the kerb of a real town street, alternating sides, never inside
    // a junction box, and never where the ground is already claimed.
    const lampSpots = [];
    // The town OWNS its streets' light now (city/props.js skips roads tagged
    // litByTown), so the cap must not leave the last streets dark: 24 ran out
    // on a 4x3 grid (~27 stations). The spacing already bounds the count; 64
    // is a sanity ceiling, and any street the cap still cuts off is handed
    // back to the city lamp walk below.
    const LAMP_MAX = 64;
    let si = 0;
    for (; si < townRoads.length && lampSpots.length < LAMP_MAX; si++) {
      const seg = townRoads[si];
      const half = seg.w / 2;
      const n = Math.max(1, Math.floor(seg.len / 26));
      for (let k = 1; k < n && lampSpots.length < LAMP_MAX; k++) {
        const t = -seg.len / 2 + k * (seg.len / n);
        let sgn = (k % 2 === 0 ? 1 : -1);
        // a perimeter street has footway on its town side only: light it from there
        const edgeLo = seg.vertical ? seg.x <= xLines[0] + 0.01 : seg.z <= zLines[0] + 0.01;
        const edgeHi = seg.vertical ? seg.x >= xLines[cols] - 0.01 : seg.z >= zLines[rows] - 0.01;
        if (!RURAL && edgeLo) sgn = 1; else if (!RURAL && edgeHi) sgn = -1;
        const off = half + 1.0;                  // on the kerb, arm out over the lane
        const lx = seg.vertical ? seg.x + sgn * off : seg.x + t;
        const lz = seg.vertical ? seg.z + t : seg.z + sgn * off;
        // never in the mouth of a cross street
        let clash = false;
        for (let q = 0; q < townRoads.length; q++) {
          const o = townRoads[q];
          if (o === seg || o.vertical === seg.vertical) continue;
          const oh = o.w / 2 + 2.0 + (kit ? kit.solve.R : 0);   // clear of the kerb return too
          if (o.vertical ? Math.abs(lx - o.x) < oh : Math.abs(lz - o.z) < oh) { clash = true; break; }
        }
        if (clash) continue;
        // the arm reaches toward the carriageway; +Z is the road in lampMast's
        // frame, so the yaw is just the bearing from the lamp to the centreline
        const fx = seg.vertical ? -sgn : 0, fz = seg.vertical ? 0 : -sgn;
        lampSpots.push({ x: lx, z: lz, ang: Math.atan2(fx, fz), fx: fx, fz: fz, half: half, off: off });
      }
    }
    for (; si < townRoads.length; si++) townRoads[si].litByTown = false;   // cap cut these off: the city walk lights them
    const lampN = lampSpots.length;
    const lampIM = lampN ? new THREE.InstancedMesh(lampProto, cmat(ACCENT), lampN) : null;
    const headIM = lampN ? new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.16, 0.56), headMat, lampN) : null;
    const townLampCensus = A ? (A._lampCensus = A._lampCensus || { lamps: 0, noCollider: 0, overRoad: 0 }) : null;
    for (let i = 0; i < lampN; i++) {
      const sp = lampSpots[i];
      const gy0 = gy(sp.x, sp.z);                  // the pole stands ON the footway
      dummy2.position.set(sp.x, gy0, sp.z); dummy2.scale.set(1, 1, 1);
      dummy2.rotation.set(0, sp.ang, 0);
      dummy2.updateMatrix(); lampIM.setMatrixAt(i, dummy2.matrix);
      // the head sits on the arm's TIP, out over the lane — derived, never
      // authored beside it
      dummy2.position.set(sp.x + sp.fx * LM.headZ, gy0 + LM.headY, sp.z + sp.fz * LM.headZ);
      dummy2.updateMatrix(); headIM.setMatrixAt(i, dummy2.matrix);
      // the head's light on the road: city/props.js builds one ground pool per
      // entry with the city's lamp pools (these streets are skipped by its walk)
      if (A) (A._townLampHeads = A._townLampHeads || []).push({ x: sp.x + sp.fx * LM.headZ, z: sp.z + sp.fz * LM.headZ, y: gy0 + LM.headY - 0.08, h: gy0 + LM.headY, ang: sp.ang });
      // A POLE YOU CAN WALK THROUGH IS SCENERY. Slim, matched to the 0.16 butt.
      if (CBZ.colliders) {
        CBZ.colliders.push({ minX: sp.x - 0.18, maxX: sp.x + 0.18, minZ: sp.z - 0.18, maxZ: sp.z + 0.18, ref: null, noCam: true });
      } else if (townLampCensus) townLampCensus.noCollider++;
      if (townLampCensus) {
        townLampCensus.lamps++;
        // measured, not asserted: where the head landed relative to the kerb
        if (sp.off - LM.headZ < sp.half) townLampCensus.overRoad++;
      }
    }
    if (lampIM) {
      lampIM.instanceMatrix.needsUpdate = true; lampIM.matrixAutoUpdate = false; lampIM.castShadow = true; root.add(lampIM);
      headIM.instanceMatrix.needsUpdate = true; headIM.matrixAutoUpdate = false; root.add(headIM);
      // Join the city's EXISTING dusk driver instead of inventing a second one
      // (props.js walks city._nightLamps every frame writing emissiveIntensity).
      // Town lamps have never lit at night; this is one push.
      if (A) { (A._nightLamps = A._nightLamps || []).push(headIM); }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    // hitching rails (frontier flavour) — two posts + a top bar, instanced.
    // THE COMMENT ABOVE HAS ALWAYS SAID "two posts"; the code drew ONE BAR and
    // nothing else, so every town had up to eight 3.2 m sticks floating at
    // waist height on nothing, one metre in front of a shop door — and with no
    // collider, so you walked through the float as well as looking at it.
    // Both halves are fixed here: the posts are drawn (a second InstancedMesh,
    // one extra draw call for the whole town) and the rail gets an AABB from
    // the SAME yaw its matrix was built with.
    // FRONTIER ONLY: a hitching rail belongs to a Western main street or a
    // farm town, not to a finance district's glass towers or a casino strip.
    const FRONTIER = { desert: 1, farmland: 1, forest: 1, village: 1, snow: 1 };
    const frontier = !comp || !comp.flavor || FRONTIER[comp.flavor] === 1;
    const railN = frontier ? Math.min(8, lots.length) : 0;
    if (railN > 0) {
      const railIM = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.18, 0.18), cmat(WOOD), railN);
      const postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), cmat(WOOD), railN * 2);
      let pi = 0;
      for (let i = 0; i < railN; i++) {
        const lt = lots[(i * 7) % lots.length];
        const rx = lt.door.x + lt.door.nx * 1.0, rz = lt.door.z + lt.door.nz * 1.0;
        const yaw90 = lt.door.nx !== 0;                 // rail runs along Z
        const ry = gy(rx, rz);
        dummy2.position.set(rx, ry + 1.0, rz);
        dummy2.rotation.set(0, yaw90 ? Math.PI / 2 : 0, 0); dummy2.scale.set(1, 1, 1);
        dummy2.updateMatrix(); railIM.setMatrixAt(i, dummy2.matrix);
        // the two posts the rail was always described as resting on: at the bar
        // ends, base on the ground, top just under the 1.09 bar underside.
        for (const ps of [-1.45, 1.45]) {
          dummy2.position.set(rx + (yaw90 ? 0 : ps), ry + 0.55, rz + (yaw90 ? ps : 0));
          dummy2.rotation.set(0, 0, 0);
          dummy2.updateMatrix(); postIM.setMatrixAt(pi++, dummy2.matrix);
        }
        // ONE AABB for the whole rail (not one per post): it is a single
        // waist-high fence, and y1 = 1.09 is the bar's real top.
        solid(rx, rz, yaw90 ? 0.36 : 3.2, yaw90 ? 3.2 : 0.36, ry + 1.09);
      }
      railIM.instanceMatrix.needsUpdate = true; railIM.matrixAutoUpdate = false; railIM.castShadow = true; root.add(railIM);
      postIM.count = pi;
      postIM.instanceMatrix.needsUpdate = true; postIM.matrixAutoUpdate = false; postIM.castShadow = true; root.add(postIM);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
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
