/* ============================================================
   city/continent.js — ONE LANDMASS. The archipelago becomes a continent.

   Every POI (airport, military base, casino strip, speedway, biomes,
   mini-cities) used to sit on its own island with dead ocean between —
   "circles on the map". This builder runs AFTER every other landmass and
   fills the water between them with real, walkable backcountry:

     • ONE vertex-coloured ground plate spanning the union of every
       registered region (grass/dirt/scrub patches from the position hash —
       deterministic per seed, byte-identical across clients).
     • Sparse deterministic dressing (trees + rocks) as three InstancedMesh
       draws, only OUTSIDE existing regions so nothing decorates a runway.
     • Walkable "underlay" region(s) registered LAST so specific places
       keep winning point-in-region queries; swim.js treats the covered
       span as land, clampToCity lets you walk POI to POI.

   THE COAST PASS (CBZ.CONFIG.CONTINENT_COAST, default on) — the plate used
   to be a RAZOR-STRAIGHT rectangle meeting the sea: a game board, not a
   landmass. Now a deterministic noise field carves an IRREGULAR coastline
   into the plate's outer rim, slopes it down through
   a dry-sand → wet-sand rim into the water, and drops the sea floor below
   the (world.js) animated sea surface. A merged strip of foam "breakers"
   is marched along the true zero-crossing of the shore field, so the foam
   always hugs the actual coast (corners, bays, region bulges included).

   THE HARBOR PASS (CBZ.CONFIG.CONTINENT_HARBOR, default on) — the plate
   also used to pave over the mainland city's WATERFRONT: the seawall,
   beach and moored boats all faced a lawn. This re-opens a ~67u water
   ring around the city rect (starting exactly at swim.js's QUAY=28 line,
   so the wall-jump → swim → climb-out loop works again), and registers
   the walkable underlay as a set of rects that EXCLUDE the ring — so
   swim.js reads it as real water and clampToCity keeps NPCs out of it.
   Causeways/bridges keep their own walkable regions and now read as
   decks over water again. Revert either pass with its flag.

   The old bridges/causeways stay — now they're just the paved roads of a
   continuous country instead of the only way across an ocean.
   regionlife spawns nothing here (biome "wilds" has no budget) — open
   country is open, not filled with pointless NPCs.
   Revert: CBZ.CONFIG.CITY_CONTINENT = false (archipelago returns).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_CONTINENT == null) CFG.CITY_CONTINENT = true;
  if (CFG.CONTINENT_COAST == null) CFG.CONTINENT_COAST = true;
  if (CFG.CONTINENT_HARBOR == null) CFG.CONTINENT_HARBOR = true;
  if (CFG.CONTINENT_EXPANSION_V2 == null) CFG.CONTINENT_EXPANSION_V2 = true;
  // Stage-2 map enlargement (world/layout.js) needs a wider country belt:
  // the V3 backdrop-relief band rises MARGIN+60..MARGIN+1900 (≈2050u) past
  // the FLAT edge, and FLAT now hugs the region union — so the plate (and
  // its wilds/backcountry labeling) must reach ≥2094u past the union or the
  // ring's mountains stand on unlabeled "open sea" cells that read as city
  // in the terrain audit. config.js owns the authoritative default (2200
  // enlarged / 1200 compact — it parses first); this guard only mirrors it
  // for a build without config.js.
  if (CFG.CONTINENT_COUNTRY_MARGIN == null)
    CFG.CONTINENT_COUNTRY_MARGIN = (CFG.WORLD_ENLARGE_V2 !== false) ? 2200 : 1200;
  if (CFG.CONTINENT_RELIEF_V1 == null) CFG.CONTINENT_RELIEF_V1 = true;
  // Adopted terrain/forest techniques from the reference generators (see
  // tools/adoption-terrain-forest.md). Both default ON, one-line revert each.
  //  RELIEF_EROSION — derivative-damped ("Quilez erosion") octaves + domain
  //   warp + per-octave domain rotation replace the plain value-fbm hill core
  //   in countryHeightAt, giving weathered ridgelines and meandering valleys.
  //  FOREST_V2 — the backcountry dressing becomes an ecological instanced
  //   forest: squashed-icosphere blob canopy with baked AO, per-instance
  //   colour, and slope/treeline/clearing rejection sampling.
  if (CFG.CONTINENT_RELIEF_EROSION == null) CFG.CONTINENT_RELIEF_EROSION = true;
  if (CFG.CONTINENT_FOREST_V2 == null) CFG.CONTINENT_FOREST_V2 = true;

  CBZ.addLandmass(function (city) {
    if (CFG.CITY_CONTINENT === false) return;
    const regs = (city.regions || []).slice();
    const waterBodies = (city.waterBodies || []).slice();
    if (!regs.length) return;
    const COAST = CFG.CONTINENT_COAST !== false;
    const HARBOR = COAST && CFG.CONTINENT_HARBOR !== false;

    // ---- union bounds of everything walkable (mainland + every region) ----
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    function grow(x0, x1, z0, z1) {
      if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1;
      if (z0 < minZ) minZ = z0; if (z1 > maxZ) maxZ = z1;
    }
    for (const r of regs) grow(r.minX, r.maxX, r.minZ, r.maxZ);
    if (isFinite(city.minX)) grow(city.minX, city.maxX, city.minZ, city.maxZ);
    // Preserve every authored coordinate and expand OUTWARD from their union.
    // Legacy coast padding was only 40m; after the 44m coast safety inset that
    // left no traversable country beyond the outermost region. V2 creates a
    // substantial dry belt without scaling/moving a single city, biome or POI.
    const authoredBounds = { minX, maxX, minZ, maxZ };
    const LEGACY_PAD = 40;
    const requestedMargin = Number(CFG.CONTINENT_COUNTRY_MARGIN);
    // clamp roof 2400 (was 1800): the enlarged world's 2200 belt must fit —
    // the W ≤ 12000 bail below still bounds the total plate.
    const PAD = CFG.CONTINENT_EXPANSION_V2 === false ? LEGACY_PAD
      : Math.max(180, Math.min(2400, Number.isFinite(requestedMargin) ? requestedMargin : 1200));
    minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
    const W = maxX - minX, D = maxZ - minZ;
    if (!isFinite(W) || W <= 0 || W > 12000) return;

    function insideAnything(x, z, margin) {
      margin = margin || 0;
      if (isFinite(city.minX) &&
          x > city.minX - margin && x < city.maxX + margin &&
          z > city.minZ - margin && z < city.maxZ + margin) return true;
      for (const r of regs) {
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + margin) return true;
        } else if (x > r.minX - margin && x < r.maxX + margin &&
                   z > r.minZ - margin && z < r.maxZ + margin) return true;
      }
      return false;
    }

    // The country plate is an UNDERLAY, not another full floor below every
    // authored place. At aircraft distances the 0.06u height gap is smaller
    // than one depth-buffer step (camera far expands to 2200), so the plate's
    // green triangles used to win randomly over runways, roads and biome pads.
    // Collect the already-built authored surface footprints now; the terrain
    // backdrop is intentionally built after this pass and cannot enter the set.
    const authoredSurfaceBounds = [];
    const surfaceBox = new THREE.Box3();
    // Most biome builders position a parent group after creating its local
    // floor. Box3.setFromObject updates the mesh itself but does not guarantee
    // a stale ancestor chain is refreshed. The former ordering therefore
    // recorded translated floors (most visibly Saltlands) at local origin and
    // carved country out of the wrong part of the map beside the speedway.
    // Resolve the complete hierarchy once before collecting world footprints.
    city.root.updateMatrixWorld(true);
    city.root.traverse(function (o) {
      if (!o || !o.isMesh || !o.userData || !o.userData.worldSurface) return;
      // Circle/Ring bounds are rectangles, not coverage. Treating those AABBs
      // as filled floors carved four clear-colour corners around every round
      // island. Sparse heightfields likewise own only their indexed mountain
      // faces; their unused rectangular attribute extent is not land cover.
      const gt = o.geometry && o.geometry.type;
      if (o.userData.sparseTerrain || o.userData.nonRectSurface || gt === "CircleGeometry" || gt === "RingGeometry") return;
      try {
        surfaceBox.setFromObject(o);
        if ([surfaceBox.min.x, surfaceBox.max.x, surfaceBox.min.z, surfaceBox.max.z].every(Number.isFinite)) {
          authoredSurfaceBounds.push({
            name: o.name || "(unnamed)", geometry: gt || "",
            minX: surfaceBox.min.x, maxX: surfaceBox.max.x,
            minZ: surfaceBox.min.z, maxZ: surfaceBox.max.z,
          });
        }
      } catch (e) {}
    });
    function insideAuthoredSurface(x, z, margin) {
      margin = margin || 0;
      // Only actual rendered surfaces may carve geometry. Region records are
      // gameplay/label bounds and are often deliberately broader than their
      // floor mesh; using them here created dry-land holes where the ocean then
      // correctly discarded itself. The mainland plane is already captured
      // below with its real 29u apron, so no synthetic city AABB is needed.
      const annex = city.annex;
      if (annex && Number.isFinite(annex.cx) && Number.isFinite(annex.cz) && Number.isFinite(annex.radius) &&
          Math.hypot(x - annex.cx, z - annex.cz) <= annex.radius + 2 + margin) return true;
      for (const b of authoredSurfaceBounds) {
        if (x >= b.minX - margin && x <= b.maxX + margin &&
            z >= b.minZ - margin && z <= b.maxZ + margin) return true;
      }
      return false;
    }
    function insideTerrainGrade(x, z, margin) {
      margin = margin || 0;
      for (const r of regs) {
        if (!r || !r.terrainGrade) continue;
        const p = (r.pad || 0) + margin;
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) <= r.r + p) return true;
        } else if (x >= r.minX - p && x <= r.maxX + p && z >= r.minZ - p && z <= r.maxZ + p) return true;
      }
      return false;
    }

    // ================= THE SHORE FIELD (deterministic) ====================
    // s(x,z): metres of dry land between the point and the nearest water.
    // Positive on land, negative in water. Two water bodies: the OUTER
    // COAST (a noise-wobbled inset of the plate rect) and, with HARBOR on,
    // the city bay ring. Any NON-bridge region force-holds land so a POI
    // can never be carved. All noise is CBZ.hash01 — byte-identical/seed.
    function sm(t) { return t * t * (3 - 2 * t); }
    function noise2(x, z, cell, salt) {
      if (!CBZ.hash01) return 0.5;
      const gx = x / cell, gz = z / cell;
      const x0 = Math.floor(gx), z0 = Math.floor(gz);
      const fx = sm(gx - x0), fz = sm(gz - z0);
      const h00 = CBZ.hash01(x0 * cell, z0 * cell, salt);
      const h10 = CBZ.hash01((x0 + 1) * cell, z0 * cell, salt);
      const h01 = CBZ.hash01(x0 * cell, (z0 + 1) * cell, salt);
      const h11 = CBZ.hash01((x0 + 1) * cell, (z0 + 1) * cell, salt);
      const a = h00 + (h10 - h00) * fx, b = h01 + (h11 - h01) * fx;
      return a + (b - a) * fz;
    }
    // Signed distance inside a rounded continental frame. The old min-to-four-
    // edges field made the whole world a perfect square in orbital views even
    // after noise was added. A broad corner radius changes the land silhouette
    // while the expanded margin keeps the full authored union untouched.
    const coastCX = (minX + maxX) * 0.5, coastCZ = (minZ + maxZ) * 0.5;
    const coastRadius = Math.min(320, Math.min(W, D) * 0.12);
    function plateInsideDistance(x, z) {
      const qx = Math.abs(x - coastCX) - (W * 0.5 - coastRadius);
      const qz = Math.abs(z - coastCZ) - (D * 0.5 - coastRadius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, qz), 0);
      return -(outside + inside - coastRadius);
    }
    // Broad headlands/bays plus a smaller notch field; these amplitudes remain
    // below the relocated frontier loop's dry-land clearance.
    function coastInset(x, z) {
      return 10 + (
        noise2(x, z, 620, 8809) * 0.46 +
        noise2(x, z, 220, 8810) * 0.36 +
        noise2(x, z, 82, 8811) * 0.18
      ) * 64;
    }
    const BAY0 = 28, BAY1 = 95;          // bay ring: QUAY line → 95u out
    const hasCity = isFinite(city.minX);
    function bayDist(x, z) {
      // CHEBYSHEV distance outside the city rect — deliberately square, so
      // the water ring is the EXACT complement of the rectangular underlay
      // regions below AND lines up with swim.js's own rectangular
      // mainland-QUAY test (28u). Euclidean corners would leave slivers
      // where land shows but waterAt() says water (swim-on-land bug).
      if (!hasCity) return 1e9;
      const dx = Math.max(city.minX - x, 0, x - city.maxX);
      const dz = Math.max(city.minZ - z, 0, z - city.maxZ);
      return Math.max(dx, dz);
    }
    function isLinkReg(r) { return !!(r && r.name && /bridge|causeway|link/i.test(r.name)); }
    function inSolidRegion(x, z, m) {    // non-bridge regions hold their land
      for (const r of regs) {
        if (isLinkReg(r)) continue;
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + m) return true;
        } else if (x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m) return true;
      }
      return false;
    }
    function waterBodyField(b, x, z) {
      if (!b) return Infinity;
      if (b.kind === "circle") return Math.hypot(x - b.cx, z - b.cz) - b.r;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
      return -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    }
    function inlandWaterField(x, z) {
      let nearest = Infinity;
      for (let i = 0; i < waterBodies.length; i++) nearest = Math.min(nearest, waterBodyField(waterBodies[i], x, z));
      return nearest;
    }
    function shoreField(x, z) {
      const e = plateInsideDistance(x, z);
      let s = e - coastInset(x, z);
      if (HARBOR) {
        const bd = bayDist(x, z);
        const sBay = bd <= BAY0 ? (BAY0 - bd)
                   : (bd >= BAY1 ? (bd - BAY1) : -Math.min(bd - BAY0, BAY1 - bd));
        if (sBay < s) s = sBay;
      }
      if (s < 12 && inSolidRegion(x, z, 8)) s = 12;   // POIs are never carved
      // Explicit inland water wins over its enclosing biome region. This same
      // signed result drives the sea cutout, swimmers, boats, wildlife and map.
      const inland = inlandWaterField(x, z);
      if (inland < s) s = inland;
      return s;
    }

    // ================= CONTINUOUS COUNTRY RELIEF =========================
    // The old continent only changed Y inside the 20m beach rim.  Everywhere
    // else its 100k vertices were mathematically flat, so even a huge map read
    // as a tabletop.  This height oracle is shared by the plate, floorAt and
    // country dressing.  Authored towns/airports/biomes remain graded pads;
    // broad hills rise only in the land between them.
    function countryFbm(x, z) {
      let sum = 0, amp = 0.58, freq = 1;
      for (let o = 0; o < 4; o++) {
        sum += (noise2(x * freq, z * freq, 310, 8890 + o) - 0.5) * amp;
        freq *= 2.07; amp *= 0.5;
      }
      return sum;
    }
    // Derivative-damped fractal ("Quilez erosion") + domain warp + per-octave
    // domain rotation — adopted from the reference TerrainGenerator (see
    // tools/adoption-terrain-forest.md). Each octave is divided down where the
    // running gradient is already steep, so detail collapses on slopes and
    // concentrates into weathered ridgelines while valley floors flatten; the
    // domain is warped (ridges meander) and rotated ~37deg per octave (no grid
    // lock). Same ~[-0.5,0.5] envelope as countryFbm, so the height composition
    // + coastFade/frontier gating in countryHeightAt are untouched. Analytic,
    // allocation-free, deterministic (noise2 -> CBZ.hash01; no shared rng stream,
    // no Math.random) -> byte-identical per seed across clients.
    const EROS_DAMP = 0.75;   // higher = flatter valleys, sharper ridges
    const EROS_LAC = 2.03;    // lacunarity (off 2 so octaves do not grid-lock)
    const EROS_WARP = 120;    // domain-warp amplitude (world units)
    function countryErodedHills(x, z) {
      const wx = x + (noise2(x + 130, z + 720, 900, 8898) - 0.5) * EROS_WARP;
      const wz = z + (noise2(x + 520, z + 130, 900, 8899) - 0.5) * EROS_WARP;
      let sum = 0, amp = 0.58, dX = 0, dZ = 0, px = wx, pz = wz, freq = 1;
      for (let o = 0; o < 5; o++) {
        const cell = 300 / freq;
        const step = cell * 0.3;
        const salt = 8890 + o;
        const n = noise2(px, pz, cell, salt);
        const nx = noise2(px + step, pz, cell, salt);
        const nz = noise2(px, pz + step, cell, salt);
        // per-cell (dimensionless) running gradient across octaves
        dX += (nx - n) / 0.3;
        dZ += (nz - n) / 0.3;
        sum += amp * (n - 0.5) / (1 + EROS_DAMP * (dX * dX + dZ * dZ));
        const rx = 0.80 * px - 0.60 * pz;   // rotate domain ~37deg per octave
        pz = 0.60 * px + 0.80 * pz; px = rx;
        freq *= EROS_LAC; amp *= 0.5;
      }
      return sum;
    }
    const FUTURE_ROUTE_IN = COAST ? 190 : 36;
    const futureX0 = minX + FUTURE_ROUTE_IN, futureX1 = maxX - FUTURE_ROUTE_IN;
    const futureZ0 = minZ + FUTURE_ROUTE_IN, futureZ1 = maxZ - FUTURE_ROUTE_IN;
    function frontierDistance(x, z) {
      if (CFG.CONTINENT_EXPANSION_V2 === false || PAD <= LEGACY_PAD + 80) return 1e9;
      let best = 1e9;
      if (x >= futureX0 - 28 && x <= futureX1 + 28) best = Math.min(best, Math.abs(z - futureZ0), Math.abs(z - futureZ1));
      if (z >= futureZ0 - 28 && z <= futureZ1 + 28) best = Math.min(best, Math.abs(x - futureX0), Math.abs(x - futureX1));
      return best;
    }
    function countryHeightAt(x, z) {
      if (CFG.CONTINENT_RELIEF_V1 === false) return 0;
      if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;
      if (insideAuthoredSurface(x, z, 8) || insideTerrainGrade(x, z, 8)) return 0;
      const shore = COAST ? shoreField(x, z) : 100;
      if (shore <= 38) return 0;
      const coastFade = smooth01((shore - 38) / 74);
      const n = (CFG.CONTINENT_RELIEF_EROSION === false)
        ? countryFbm(x + 1400, z - 900)
        : countryErodedHills(x + 1400, z - 900);
      const broad = noise2(x, z, 540, 8896);
      const ridge = 1 - Math.abs(2 * noise2(x + 700, z - 300, 250, 8897) - 1);
      let h = (2.0 + Math.max(0, n + 0.18) * 17 + Math.pow(ridge, 2.4) * broad * 8) * coastFade;
      // Frontier highways are cut into the landscape with broad shoulders;
      // their visible planes never hover over a noisy heightfield.
      const fd = frontierDistance(x, z);
      h *= smooth01((fd - 10) / 36);
      return Math.max(0, h);
    }
    function smooth01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }
    CBZ.countryTerrainHeightAt = countryHeightAt;
    if (CBZ.registerCityGroundHeight) {
      CBZ.registerCityGroundHeight(countryHeightAt, { name: "Backcountry relief", biome: "wilds" });
    }

    // Publish the exact coast oracle used by the rendered continent.  The
    // navigation map samples this instead of inventing rounded rectangles or
    // drawing the underlay registry bands as enormous roads.  One coastline
    // now owns world geometry, swimming and cartography.
    city.mapTerrain = {
      bounds: { minX, maxX, minZ, maxZ },
      shoreAt: COAST ? shoreField : function () { return 1; },
      waterBodies: waterBodies,
      inlandWaterAt: function (x, z) { return inlandWaterField(x, z) < 0; },
    };

    // ---- the ground plate: one draw call, vertex-coloured country ---------
    // With COAST on the grid is denser (the rim needs resolution) and the
    // outer band slopes through sand into carved seabed under the sea plane.
    // A 160-cell plate left 20-35m shoreline triangles in this world. Those
    // triangles visibly sliced through the animated sea as large green/tan
    // checker patches from aircraft. The denser coast remains one draw call
    // and is tiny beside the city geometry budget.
    const SEG = COAST ? 320 : 72;
    const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // Keep country unmistakably terrestrial through flight-distance fog.
    // The former pale cyan-leaning greens converged on the sea colour and
    // made correctly grounded trees read as if they were floating in water.
    const cGrass = new THREE.Color(0x4f7445), cDry = new THREE.Color(0x7f7a4a);
    const cDirt = new THREE.Color(0x795d42), cScrub = new THREE.Color(0x45684e);
    const cLush = new THREE.Color(0x37684a);                 // moist shore band
    const cSand = new THREE.Color(0xdcc794), cWet = new THREE.Color(0xbfa877);
    const cBed = new THREE.Color(0x8a8a6b);                  // submerged seabed
    const c = new THREE.Color(), c2 = new THREE.Color();
    const biomeBlends = (city.biomeBlends || CBZ._biomeBlendSpecs || []).slice();
    const biomePalettes = biomeBlends.map(function (spec) {
      return {
        spec: spec,
        inner: new THREE.Color(spec.inner == null ? 0x65724c : spec.inner),
        outer: new THREE.Color(spec.outer == null ? 0x58704c : spec.outer),
      };
    });
    function applyBiomeLandCover(base, x, z) {
      if (!biomePalettes.length || !CBZ.biomeBlendWeightAt) return;
      let sum = 0, rr = 0, gg = 0, bb = 0;
      for (let j = 0; j < biomePalettes.length; j++) {
        const p = biomePalettes[j];
        const w = CBZ.biomeBlendWeightAt(p.spec, x, z);
        if (w <= 0.002) continue;
        const ww = w * w;
        const r = p.outer.r + (p.inner.r - p.outer.r) * w;
        const g = p.outer.g + (p.inner.g - p.outer.g) * w;
        const b = p.outer.b + (p.inner.b - p.outer.b) * w;
        sum += ww; rr += r * ww; gg += g * ww; bb += b * ww;
      }
      if (sum <= 0) return;
      c2.setRGB(rr / sum, gg / sum, bb / sum);
      // Multiple neighboring influences mix by weight instead of one biome
      // painting over another. Their overlap becomes a real ecotone.
      base.lerp(c2, blendSmooth(Math.min(1, sum)) * 0.94);
    }
    function blendSmooth(v) { return v * v * (3 - 2 * v); }
    const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    const GROUND_Y = -0.06;                                   // interior land level
    const SEA_Y = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    // world.js's current swell reaches ±0.355m. Keep submerged coast vertices
    // below the *real* trough with margin; the stale 0.18m offset let every
    // trough reveal the continent mesh through the water.
    const SUBMERGED_Y = SEA_Y - 0.44;
    // cache the shore field per vertex — the foam pass re-reads it below
    const sGrid = COAST ? new Float32Array(pos.count) : null;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx0, wz = pos.getZ(i) + cz0;
      // two octaves of position-hash "noise" pick the patch tone —
      // deterministic per seed, no shared rng stream touched.
      const h1 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 90), Math.floor(wz / 90), 8801) : 0.5;
      const h2 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 22), Math.floor(wz / 22), 8802) : 0.5;
      c.copy(h1 < 0.55 ? cGrass : (h1 < 0.8 ? cScrub : cDry));
      if (h2 > 0.86) c.copy(cDirt);                        // dirt breaks
      // large-scale hue drift (300u) so kilometres of country stop reading
      // as one repeated swatch — dryer here, greener there.
      const drift = noise2(wx, wz, 300, 8812) - 0.5;
      c.lerp(cDry, Math.max(0, drift) * 0.5);
      c.lerp(cLush, Math.max(0, -drift) * 0.4);
      applyBiomeLandCover(c, wx, wz);
      const reliefY = countryHeightAt(wx, wz);
      let y = GROUND_Y + reliefY;
      if (COAST) {
        const s = shoreField(wx, wz);
        sGrid[i] = s;
        if (s < 0) {
          // Underwater: begin below the lowest swell, then slope into a real
          // seabed. The former -0.44 start sat above the mean sea and caused
          // the filmed checkerboard as waves crossed it.
          const t = Math.min(1, -s / 9);
          y = SUBMERGED_Y - t * 1.15;
          c.copy(cWet).lerp(cBed, t);
        } else if (s < 26) {
          // Shore rim: the exact zero crossing starts safely under the moving
          // surface, then rises through wet/dry sand onto solid country. Wave
          // wash can cover the first metres without exposing a coplanar slab.
          y = SUBMERGED_Y + sm(Math.min(1, s / 26)) * (GROUND_Y + reliefY - SUBMERGED_Y);
          if (s < 6) c.copy(cWet).lerp(cSand, sm(s / 6));
          else if (s < 15) c.copy(cSand);
          else c2.copy(c), c.copy(cSand).lerp(c2, sm((s - 15) / 11));
        } else if (s < 52) {
          // moist band just behind the sand — the coast reads vegetated
          c.lerp(cLush, (1 - (s - 26) / 26) * 0.35);
        }
      }
      const shade = 0.92 + h2 * 0.1;                       // subtle facet variation
      pos.setY(i, y);
      colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Physically remove the underlay triangles whose centres sit below an
    // authored floor. Border triangles stay as a continuous seam and receive
    // a GPU depth bias below; the large interiors no longer overdraw at all.
    let carvedTriangles = 0;
    // A triangle is removed only when its *entire footprint* is safely under
    // an authored surface.  The old centroid-only test carved right up to a
    // region boundary.  On this ~17m grid a removed triangle can extend over
    // 20m beyond its centre, so circular pads (most visibly Diamond Speedway)
    // were left with a saw-toothed ring containing neither country nor ocean:
    // the sea shader correctly discarded "land" there and the clear/fog colour
    // showed through as fake blue water.  Keep one grid diagonal of underlay
    // beneath every authored edge; its lower Y + polygon offset make the real
    // pad win while guaranteeing continuous earth at the seam.
    const CARVE_SEAM_INSET = Math.min(32, Math.hypot(W / SEG, D / SEG) + 2);
    if (geo.index) {
      const src = geo.index.array, kept = [];
      for (let i = 0; i < src.length; i += 3) {
        const ia = src[i], ib = src[i + 1], ic = src[i + 2];
        const tx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3 + cx0;
        const tz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3 + cz0;
        if (insideAuthoredSurface(tx, tz, -CARVE_SEAM_INSET)) { carvedTriangles++; continue; }
        kept.push(ia, ib, ic);
      }
      geo.setIndex(kept);
    }
    if (COAST || CFG.CONTINENT_RELIEF_V1 !== false) geo.computeVertexNormals(); // coast + country slopes want real shading
    let plateMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Positive polygon offset pushes this UNDERLAY away in depth space. It
      // protects the few seam triangles even when 0.06 world units quantise to
      // the same aircraft-distance depth value as a runway or road.
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 8,
    });
    // Keep the dry continent's colour identity through aerial haze. Normal fog
    // made every point beyond the short city fog wall equal the sky's cyan and
    // therefore indistinguishable from flat water. This retains atmospheric
    // depth at distance while keeping grass/dirt legible from aircraft.
    // Aircraft regularly sees several kilometres of this mesh.  At the normal
    // city fog rate (and even the former 0.40 multiplier) its green/brown
    // vertex colours still converged to the horizon grey, creating the exact
    // visual illusion of a second flat water sheet.  Eight percent keeps a
    // light atmospheric veil while preserving an unmistakably dry hue.
    if (CBZ.terrainFogScale) plateMat = CBZ.terrainFogScale(plateMat, 0.08);
    const plate = new THREE.Mesh(geo, plateMat);
    // interior sits just under the islands' y=0 slabs (no z-fight), well
    // above the sea; carved verts carry their own absolute depth.
    plate.position.set(cx0, COAST ? 0 : -0.06, cz0);
    plate.receiveShadow = true;
    plate.name = "continent-underlay";
    plate.renderOrder = -10;
    plate.userData.terrain = true;         // farcull: backdrop class, never culled
    plate.userData.underlay = true;
    plate.userData.carvedTriangles = carvedTriangles;
    plate.userData.carveSeamInset = CARVE_SEAM_INSET;
    // Kept as compact build-time evidence for the visual terrain audit. Some
    // official assets replace their loading shell asynchronously; recording
    // the exact carve inputs makes those transient bounds diagnosable later.
    plate.userData.authoredSurfaceBounds = authoredSurfaceBounds.map(function (b) {
      return { name: b.name, geometry: b.geometry, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    });
    city.root.add(plate);

    // ---- FRONTIER EXPANSION: real travel distance, not a camera trick -------
    // Four long rural highway legs live wholly OUTSIDE the old authored union,
    // 190m inside the rounded/noisy coast, keeping the road shoulders dry at
    // straight shores and broad corners. Four navigation
    // beacons sit on the INLAND side of that loop: tall enough to provide scale
    // while approaching, physically reachable, and named on the real map.
    const WALK_IN = COAST ? 44 : -4;
    let frontier = null;
    if (CFG.CONTINENT_EXPANSION_V2 !== false && PAD > LEGACY_PAD + 80) frontier = (function buildFrontier() {
      const ROAD_W = 12, ROUTE_IN = COAST ? 190 : 36;
      const x0 = minX + ROUTE_IN, x1 = maxX - ROUTE_IN;
      const z0 = minZ + ROUTE_IN, z1 = maxZ - ROUTE_IN;
      if (!(x1 - x0 > 600 && z1 - z0 > 600)) return null;

      const group = new THREE.Group();
      group.name = "frontier-loop";
      group.userData.terrain = true; // one world-spanning route; never disappear as one far-cull blob
      const roadMat = new THREE.MeshLambertMaterial({ color: 0x30343a });
      const paintMat = new THREE.MeshBasicMaterial({ color: 0xe6c45a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const roadDefs = [
        { x: (x0 + x1) / 2, z: z0, len: x1 - x0, vertical: false },
        { x: x1, z: (z0 + z1) / 2, len: z1 - z0, vertical: true },
        { x: (x0 + x1) / 2, z: z1, len: x1 - x0, vertical: false },
        { x: x0, z: (z0 + z1) / 2, len: z1 - z0, vertical: true },
      ];
      const roadRecords = [];
      for (let i = 0; i < roadDefs.length; i++) {
        const d = roadDefs[i];
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.vertical ? ROAD_W : d.len, d.vertical ? d.len : ROAD_W), roadMat);
        mesh.rotation.x = -Math.PI / 2; mesh.position.set(d.x, 0.025, d.z);
        mesh.receiveShadow = true; mesh.name = "frontier-highway-" + i;
        group.add(mesh);
        const rec = { x: d.x, z: d.z, len: d.len, vertical: d.vertical,
          w: ROAD_W, width: ROAD_W, lanesPerDir: 1, laneW: 3.25,
          district: "highway", frontier: true, noLamps: true };
        city.roads.push(rec); roadRecords.push(rec);
      }

      // One merged centre-dash mesh for the entire ~17km circuit. Geometry
      // scales with visible paint length, but remains exactly one draw call.
      const dashPos = [];
      function quad(cx, cz, w, d, y) {
        const x0q = cx - w / 2, x1q = cx + w / 2, z0q = cz - d / 2, z1q = cz + d / 2;
        dashPos.push(x0q,y,z0q, x0q,y,z1q, x1q,y,z1q, x0q,y,z0q, x1q,y,z1q, x1q,y,z0q);
      }
      for (const d of roadDefs) {
        const n = Math.max(1, Math.floor(d.len / 22));
        for (let i = 0; i < n; i++) {
          const t = -d.len / 2 + (i + 0.5) * d.len / n;
          quad(d.x + (d.vertical ? 0 : t), d.z + (d.vertical ? t : 0),
            d.vertical ? 0.24 : 9, d.vertical ? 9 : 0.24, 0.043);
        }
      }
      if (dashPos.length) {
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.Float32BufferAttribute(dashPos, 3));
        const dm = new THREE.Mesh(dg, paintMat); dm.name = "frontier-highway-paint";
        dm.userData.roadPaint = true; dm.renderOrder = 1; group.add(dm);
      }
      city.root.add(group);
      city.frontierRoads = roadRecords;

      // Small open shelters + tall survey masts. They are navigation objects,
      // not sealed fake buildings, and their footprint is published for the
      // world audit's full 3x3 coast test.
      const gravelMat = new THREE.MeshLambertMaterial({ color: 0x817b68 });
      const steelMat = new THREE.MeshLambertMaterial({ color: 0x68727d });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x39434d });
      const beaconMat = new THREE.MeshLambertMaterial({ color: 0xff6a45, emissive: 0x7a1d10, emissiveIntensity: 0.45 });
      const mastGeo = new THREE.CylinderGeometry(0.34, 0.62, 30, 6);
      const beamGeoX = new THREE.BoxGeometry(5.6, 0.18, 0.18);
      const beamGeoZ = new THREE.BoxGeometry(0.18, 0.18, 5.6);
      const beaconGeo = new THREE.SphereGeometry(0.46, 8, 6);
      const postGeo = new THREE.BoxGeometry(0.22, 3.2, 0.22);
      const roofGeo = new THREE.BoxGeometry(9, 0.32, 5.6);
      const padGeo = new THREE.PlaneGeometry(32, 24);
      const landmarks = [];
      function footprintShoreMin(x, z, hx, hz) {
        let best = Infinity;
        for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
          const s = shoreField(x + ix * hx, z + iz * hz);
          if (s < best) best = s;
        }
        return best;
      }
      function landmark(name, x, z) {
        const hx = 16, hz = 12, shoreMin = footprintShoreMin(x, z, hx, hz);
        if (COAST && shoreMin < 24) return; // fail closed: never erect anything near/open in water
        const g = new THREE.Group(); g.name = "frontier-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        g.position.set(x, 0, z); g.userData.terrain = true; g.userData.frontierLandmark = true;
        const pad = new THREE.Mesh(padGeo, gravelMat); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.012; pad.receiveShadow = true; g.add(pad);
        const mast = new THREE.Mesh(mastGeo, steelMat); mast.position.set(-7, 15, 0); mast.castShadow = true; g.add(mast);
        for (const y of [10, 20, 29]) {
          const bx = new THREE.Mesh(beamGeoX, steelMat), bz = new THREE.Mesh(beamGeoZ, steelMat);
          bx.position.set(-7, y, 0); bz.position.set(-7, y, 0); g.add(bx, bz);
        }
        const beacon = new THREE.Mesh(beaconGeo, beaconMat); beacon.position.set(-7, 30.7, 0); g.add(beacon);
        const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.set(7, 3.25, 0); roof.castShadow = true; g.add(roof);
        for (const px of [3.2, 10.8]) for (const pz of [-2.1, 2.1]) {
          const post = new THREE.Mesh(postGeo, steelMat); post.position.set(px, 1.6, pz); g.add(post);
        }
        city.root.add(g);
        if (CBZ.colliders) CBZ.colliders.push({ minX: x - 7.7, maxX: x - 6.3, minZ: z - 0.7, maxZ: z + 0.7, y0: 0, y1: 31, noCam: true, ref: mast });
        const rec = { name, subtitle: "Frontier Lookout", biome: "frontier", kind: "rect",
          minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz,
          x, z, shoreMin, pad: 2 };
        CBZ.registerCityRegion(city, rec); landmarks.push(rec);
      }
      const MID_IN = 26;
      landmark("North Range", cx0, z0 + MID_IN);
      landmark("East Range", x1 - MID_IN, cz0);
      landmark("South Range", cx0, z1 - MID_IN);
      landmark("West Range", x0 + MID_IN, cz0);
      city.frontierLandmarks = landmarks;

      let roadMinShore = Infinity;
      for (const d of roadDefs) for (let i = 0; i <= 64; i++) {
        const t = -d.len / 2 + d.len * i / 64;
        for (const side of [-ROAD_W / 2, 0, ROAD_W / 2]) {
          const sx = d.x + (d.vertical ? side : t), sz = d.z + (d.vertical ? t : side);
          roadMinShore = Math.min(roadMinShore, shoreField(sx, sz));
        }
      }
      function near(x, z, margin) {
        margin = margin || 0;
        for (const d of roadDefs) {
          const along = d.vertical ? Math.abs(z - d.z) : Math.abs(x - d.x);
          const across = d.vertical ? Math.abs(x - d.x) : Math.abs(z - d.z);
          if (along <= d.len / 2 + margin && across <= ROAD_W / 2 + margin) return true;
        }
        for (const l of landmarks) if (x >= l.minX - margin && x <= l.maxX + margin && z >= l.minZ - margin && z <= l.maxZ + margin) return true;
        return false;
      }
      return { roads: roadRecords, landmarks, near, loopMeters: roadDefs.reduce((s, d) => s + d.len, 0), roadMinShore };
    })();

    const legacyW = authoredBounds.maxX - authoredBounds.minX;
    const legacyD = authoredBounds.maxZ - authoredBounds.minZ;
    const playableBounds = {
      minX: Math.min(authoredBounds.minX, minX + WALK_IN),
      maxX: Math.max(authoredBounds.maxX, maxX - WALK_IN),
      minZ: Math.min(authoredBounds.minZ, minZ + WALK_IN),
      maxZ: Math.max(authoredBounds.maxZ, maxZ - WALK_IN),
    };
    const playableW = playableBounds.maxX - playableBounds.minX;
    const playableD = playableBounds.maxZ - playableBounds.minZ;
    const legacyArea = legacyW * legacyD, playableArea = playableW * playableD;
    city.worldScale = {
      version: "continent-expansion-v2", enabled: CFG.CONTINENT_EXPANSION_V2 !== false,
      countryMargin: PAD, legacyMargin: LEGACY_PAD,
      authoredBounds: Object.assign({}, authoredBounds), terrainBounds: { minX, maxX, minZ, maxZ }, playableBounds,
      authoredWidth: legacyW, authoredDepth: legacyD, playableWidth: playableW, playableDepth: playableD,
      authoredArea: legacyArea, playableArea, addedArea: Math.max(0, playableArea - legacyArea),
      areaGainPct: legacyArea > 0 ? (playableArea / legacyArea - 1) * 100 : 0,
      frontierLoopMeters: frontier ? frontier.loopMeters : 0,
      frontierRoadMinShore: frontier ? frontier.roadMinShore : null,
      frontierLandmarkMinShore: frontier && frontier.landmarks.length ? Math.min.apply(null, frontier.landmarks.map(l => l.shoreMin)) : null,
      frontierLandmarks: frontier ? frontier.landmarks.length : 0,
      biomeBlends: biomeBlends.map(function (b) {
        return { biome: b.biome, name: b.name || b.owner, minX: b.minX, maxX: b.maxX,
          minZ: b.minZ, maxZ: b.maxZ, areaScale: b.areaScale || null,
          sources: b.sources ? b.sources.length : 0 };
      }),
      terrainVertices: pos.count,
    };

    // ---- FOAM BREAKERS: marched along the true coast ----------------------
    // Scan the plate grid for zero crossings of the cached shore field and
    // drop a small white dash at each, oriented along the coast (perpendicular
    // to the field gradient). One merged mesh, one Basic material whose
    // opacity pulses in onAlways — the shoreline visibly breathes.
    let foamMat = null;
    // The overhauled ocean shader already owns shore wash/whitecaps using the
    // same signed field. A second transparent foam mesh was literally another
    // water-looking surface at a fixed height and crossed the moving waves.
    // Retain it only for the explicitly selected legacy sea.
    if (COAST && CBZ.hash01 && CFG.SEA_OVERHAUL === false) (function foam() {
      const wCells = SEG + 1;
      const quads = [];
      function vAt(ix, iz) { return iz * wCells + ix; }
      function crossing(iA, iB) {
        const sA = sGrid[iA], sB = sGrid[iB];
        if (!((sA < 0) !== (sB < 0))) return null;
        const t = sA / (sA - sB);
        return {
          x: pos.getX(iA) + (pos.getX(iB) - pos.getX(iA)) * t + cx0,
          z: pos.getZ(iA) + (pos.getZ(iB) - pos.getZ(iA)) * t + cz0,
        };
      }
      for (let iz = 0; iz < wCells - 1 && quads.length < 2600; iz++) {
        for (let ix = 0; ix < wCells - 1; ix++) {
          const i00 = vAt(ix, iz);
          const pH = crossing(i00, vAt(ix + 1, iz));
          const pV = crossing(i00, vAt(ix, iz + 1));
          for (const p of [pH, pV]) {
            if (!p) continue;
            // coast tangent = perpendicular of the shore-field gradient
            const eps = 6;
            const gx = shoreField(p.x + eps, p.z) - shoreField(p.x - eps, p.z);
            const gz = shoreField(p.x, p.z + eps) - shoreField(p.x, p.z - eps);
            const gl = Math.hypot(gx, gz) || 1;
            const tx = -gz / gl, tz = gx / gl;
            // jitter length/offset a touch so the dashes read as surf
            const j = CBZ.hash01(p.x, p.z, 8813);
            quads.push({ x: p.x, z: p.z, tx, tz, L: 2.2 + j * 2.4, Wd: 0.9 + j * 0.8 });
            if (quads.length >= 2600) break;
          }
        }
      }
      if (!quads.length) return;
      const fpos = new Float32Array(quads.length * 18);
      let fp = 0;
      const FY = -0.40;                    // just above the sea's wave crests
      for (const q of quads) {
        const hx = q.tx * q.L / 2, hz = q.tz * q.L / 2;      // along the coast
        const wx = -q.tz * q.Wd / 2, wz = q.tx * q.Wd / 2;   // across it
        const ax = q.x - hx - wx, az = q.z - hz - wz;
        const bx = q.x + hx - wx, bz = q.z + hz - wz;
        const cxq = q.x + hx + wx, czq = q.z + hz + wz;
        const dx = q.x - hx + wx, dz = q.z - hz + wz;
        fpos[fp++] = ax; fpos[fp++] = FY; fpos[fp++] = az;
        fpos[fp++] = bx; fpos[fp++] = FY; fpos[fp++] = bz;
        fpos[fp++] = cxq; fpos[fp++] = FY; fpos[fp++] = czq;
        fpos[fp++] = ax; fpos[fp++] = FY; fpos[fp++] = az;
        fpos[fp++] = cxq; fpos[fp++] = FY; fpos[fp++] = czq;
        fpos[fp++] = dx; fpos[fp++] = FY; fpos[fp++] = dz;
      }
      const fgeo = new THREE.BufferGeometry();
      fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
      foamMat = new THREE.MeshBasicMaterial({
        color: 0xeef6f2, transparent: true, opacity: 0.4,
        depthWrite: false, fog: true,
      });
      const foamMesh = new THREE.Mesh(fgeo, foamMat);
      foamMesh.name = "legacy-continent-foam";
      foamMesh.renderOrder = 2;
      foamMesh.frustumCulled = false;
      foamMesh.matrixAutoUpdate = false;
      foamMesh.userData.terrain = true;
      city.root.add(foamMesh);
      const cityRoot = city.root;
      CBZ.onAlways(93.7, function () {     // runtime-only FX — Math-free pulse
        if (!cityRoot.visible || !foamMat) return;
        const tNow = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
        foamMat.opacity = 0.3 + 0.14 * Math.sin(tNow * 1.25);
      });
    })();

    // ---- dressing: sparse trees + rocks, instanced (3 draw calls) ---------
    const CELL = 46;
    const spots = [];
    for (let gx = minX + CELL / 2; gx < maxX; gx += CELL) {
      for (let gz = minZ + CELL / 2; gz < maxZ; gz += CELL) {
        const h = CBZ.hash01 ? CBZ.hash01(Math.floor(gx), Math.floor(gz), 8803) : 1;
        const coverHit = CBZ.biomeBlendDominantAt ? CBZ.biomeBlendDominantAt(biomeBlends, gx, gz) : null;
        // Land-cover expansion changes ecology as well as colour: forest and
        // alpine transitions thicken with trees, farm verges stay sparse, and
        // the desert opens up. Density fades naturally with the same weight.
        let density = 0.34;
        if (coverHit) {
          if (coverHit.biome === "forest") density += 0.48 * coverHit.weight;
          else if (coverHit.biome === "snow") density += 0.20 * coverHit.weight;
          else if (coverHit.biome === "farmland") density -= 0.11 * coverHit.weight;
          else if (coverHit.biome === "desert") density -= 0.22 * coverHit.weight;
        }
        if (h > Math.max(0.08, Math.min(0.84, density))) continue;
        const jx = gx + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8804) : 0.5) - 0.5) * CELL * 0.8;
        const jz = gz + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8805) : 0.5) - 0.5) * CELL * 0.8;
        if (insideAnything(jx, jz, 14)) continue;            // never dress a place
        if (frontier && frontier.near(jx, jz, 12)) continue; // road shoulder/lookouts stay physically clear
        // The underlay triangles are cut away beneath every authored world
        // surface, including a few meshes whose footprint is slightly wider
        // than its gameplay region (the mainland floor is the common case).
        // Use that exact carve oracle here too: otherwise a tree can survive
        // over a removed triangle and appear to grow straight out of the sea.
        if (insideAuthoredSurface(jx, jz, 12)) continue;
        if (COAST && shoreField(jx, jz) < 16) continue;      // never dress the water/sand
        // FOREST_V2 ecological rejection (adopted from the reference forest —
        // see tools/adoption-terrain-forest.md): slope limit / treeline fade /
        // clearing mask. All hash01/noise2, so adding these gates shifts NO
        // other placement (nothing rides a sequential rng stream). Steep ground
        // is kept but flagged so the build turns it into scree, not trees.
        let steep = false;
        if (CFG.CONTINENT_FOREST_V2 !== false) {
          const reliefY = countryHeightAt(jx, jz);
          const e = 4;                                        // slope: 2-tap finite diff of the SAME height fn the prop sits on
          const sxg = countryHeightAt(jx + e, jz) - countryHeightAt(jx - e, jz);
          const szg = countryHeightAt(jx, jz + e) - countryHeightAt(jx, jz - e);
          const slope = Math.sqrt(sxg * sxg + szg * szg) / (2 * e);   // rise/run
          steep = slope > 0.85;                               // ridge faces -> rock, not tree
          const treeline = smooth01((22 - reliefY) / 7);      // canopy thins out on the high ridges
          const clearing = noise2(jx, jz, 240, 8815);         // low-freq meadow/clearing field
          const keep = steep ? 0.55 : treeline * smooth01((clearing - 0.30) / 0.22);
          const die = CBZ.hash01 ? CBZ.hash01(jx, jz, 8816) : 0.5;
          if (die > 0.05 + keep * 0.9) continue;              // clearing / treeline reject
        }
        spots.push({ x: jx, z: jz, h, cover: coverHit, steep: steep });
      }
    }
    if (spots.length) {
      const V2 = CFG.CONTINENT_FOREST_V2 !== false;
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      function isTreeSpot(s) {
        if (V2 && s.steep) return false;                     // steep ground -> scree, never a tree
        if (s.cover && (s.cover.biome === "forest" || s.cover.biome === "snow")) return true;
        if (s.cover && s.cover.biome === "desert") return false;
        return s.h < (s.cover && s.cover.biome === "farmland" ? 0.14 : 0.24);
      }
      // Blob canopy: a low-poly squashed icosahedron (20 faces, non-indexed ->
      // flat-shaded chunky facets = voxel look) tapered into a teardrop with a
      // small baked lump, base at y=0. A dark-underside -> bright-crown AO ramp
      // is baked into the vertex `color` attribute; per-instance green rides
      // `instanceColor` (r128: vColor = color(AO) *= instanceColor). One draw
      // call carries the whole forest with depth + per-tree hue.
      function blobCanopyGeo() {
        const g = new THREE.IcosahedronGeometry(1, 0);
        const pos = g.attributes.position, N = pos.count;
        const colors = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
          const hh = (uy + 1) / 2;                            // 0 base .. 1 crown
          const taper = 1 - 0.60 * hh;
          const lump = 1 + 0.16 * Math.sin(ux * 3.1) * Math.sin(uy * 2.7 + 1.3) * Math.sin(uz * 3.5 + 2.1);
          const r = taper * lump;
          pos.setXYZ(i, ux * r, hh, uz * r);                 // base y=0, crown y~1
          const ao = 0.55 + 0.45 * hh;
          colors[i * 3] = ao; colors[i * 3 + 1] = ao; colors[i * 3 + 2] = ao;
        }
        pos.needsUpdate = true;
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
      }
      const nTree = spots.filter(isTreeSpot).length;
      const nRock = Math.max(1, spots.length - nTree);
      const trunkG = new THREE.BoxGeometry(0.5, 2.6, 0.5);
      const canopyG = V2 ? blobCanopyGeo() : new THREE.ConeGeometry(2.0, 4.4, 6);
      const rockG = new THREE.BoxGeometry(1.6, 1.1, 1.4);
      const trunkMat = new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff } : { color: 0x6b4a2a });
      const canopyMat = new THREE.MeshLambertMaterial(V2
        ? { color: 0xffffff, vertexColors: true, flatShading: true }
        : { color: 0x3f7a3f });
      const rockMat = new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff, flatShading: true } : { color: 0x8b8f96 });
      const trunks = new THREE.InstancedMesh(trunkG, trunkMat, Math.max(1, nTree));
      const canopies = new THREE.InstancedMesh(canopyG, canopyMat, Math.max(1, nTree));
      const rocks = new THREE.InstancedMesh(rockG, rockMat, nRock);
      trunks.name = "backcountry-tree-trunks";
      canopies.name = "backcountry-tree-canopies";
      rocks.name = "backcountry-rocks";
      const tCol = V2 ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const cCol = V2 ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const rCol = V2 ? new Float32Array(nRock * 3) : null;
      let ti = 0, ri = 0;
      for (const s of spots) {
        const scale = 0.8 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8806) : 0.5) * 0.7;
        const rot = (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8807) : 0.3) * Math.PI * 2;
        if (isTreeSpot(s)) {
          const gy = countryHeightAt(s.x, s.z);
          if (V2) {
            const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8808) : 0.5;
            const sc = 0.75 + hs * hs * 1.15;                // squared-bias scale (biases small)
            const trunkH = 2.6 * sc;
            dummy.position.set(s.x, gy + trunkH * 0.5 - 0.06, s.z);
            dummy.rotation.set(0, rot, 0);
            dummy.scale.set(sc * 0.9, sc, sc * 0.9);
            dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
            const cr = (1.9 + hs * 1.1) * (0.85 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8809) : 0.5) * 0.3);
            const ch = 3.6 + hs * 2.0;
            dummy.position.set(s.x, gy + trunkH - 0.06, s.z); // blob base sits on the trunk top
            dummy.rotation.set(0, rot, 0);
            dummy.scale.set(cr, ch, cr);
            dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
            // per-instance colour: low-freq regional green drift + hash jitter
            const drift = noise2(s.x, s.z, 520, 8817);
            const gr = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8818) : 0.5;
            let baseG = 0.46 + drift * 0.14;
            if (s.cover && s.cover.biome === "snow") baseG -= 0.10; // darker, cooler up high
            col.setRGB(0.16 + gr * 0.10, baseG + (gr - 0.5) * 0.10, 0.13 + gr * 0.06);
            cCol[ti * 3] = col.r; cCol[ti * 3 + 1] = col.g; cCol[ti * 3 + 2] = col.b;
            const bk = 0.30 + gr * 0.16;
            col.setRGB(bk, bk * 0.62, bk * 0.38);
            tCol[ti * 3] = col.r; tCol[ti * 3 + 1] = col.g; tCol[ti * 3 + 2] = col.b;
          } else {
            dummy.position.set(s.x, gy + 1.3 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
            dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
            dummy.position.y = (2.6 + 2.15) * scale - 0.06;
            dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
          }
          ti++;
        } else {
          dummy.position.set(s.x, countryHeightAt(s.x, s.z) + 0.45 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
          dummy.updateMatrix(); rocks.setMatrixAt(ri, dummy.matrix);
          if (V2) {
            const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8819) : 0.5;
            const g = 0.42 + hs * 0.22;                      // grey with a warm-brown hint
            col.setRGB(g, g * (0.94 + hs * 0.08), g * 0.9);
            rCol[ri * 3] = col.r; rCol[ri * 3 + 1] = col.g; rCol[ri * 3 + 2] = col.b;
          }
          ri++;
        }
      }
      trunks.count = canopies.count = ti; rocks.count = ri;
      if (V2) {
        trunks.instanceColor = new THREE.InstancedBufferAttribute(tCol, 3);
        canopies.instanceColor = new THREE.InstancedBufferAttribute(cCol, 3);
        rocks.instanceColor = new THREE.InstancedBufferAttribute(rCol, 3);
      }
      trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = rocks.instanceMatrix.needsUpdate = true;
      trunks.frustumCulled = canopies.frustumCulled = rocks.frustumCulled = false;
      trunks.userData.terrain = canopies.userData.terrain = rocks.userData.terrain = true;
      city.root.add(trunks, canopies, rocks);
    }

    // ---- the walkable underlay region(s) (registered LAST on purpose:
    //      every specific place wins point-in-region queries; these only
    //      catch the country between them) --------------------------------
    // COAST shrinks the underlay 44u in from the plate rect so nobody can
    // walk onto carved water (max coast inset is 42u). HARBOR additionally
    // punches the city bay ring OUT of the underlay: 4 country bands + one
    // city-surround rect that ends exactly at the QUAY/BAY0 waterline, so
    // swim.js reads the ring as real water again.
    function reg(x0, x1, z0, z1) {
      if (!(x1 > x0 && z1 > z0)) return;
      CBZ.registerCityRegion(city, {
        name: "The Backcountry", subtitle: "Open Country", biome: "wilds", kind: "rect",
        minX: x0, maxX: x1, minZ: z0, maxZ: z1, pad: 0, underlay: true,
      });
    }
    if (HARBOR && hasCity) {
      reg(city.minX - BAY0, city.maxX + BAY0, city.minZ - BAY0, city.maxZ + BAY0); // city + quay apron
      reg(minX + WALK_IN, city.minX - BAY1, minZ + WALK_IN, maxZ - WALK_IN);                      // west country
      reg(city.maxX + BAY1, maxX - WALK_IN, minZ + WALK_IN, maxZ - WALK_IN);                      // east country
      reg(city.minX - BAY1, city.maxX + BAY1, city.maxZ + BAY1, maxZ - WALK_IN);                  // north band
      reg(city.minX - BAY1, city.maxX + BAY1, minZ + WALK_IN, city.minZ - BAY1);                  // south band
    } else {
      reg(minX + WALK_IN, maxX - WALK_IN, minZ + WALK_IN, maxZ - WALK_IN);
    }
  }, 97);   // after every island/biome/mini-city/country builder
})();
