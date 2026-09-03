/* ============================================================
   world/terrain_overhaul.js — SOLID MOUNTAINS + EROSION V3.

   Loads right after world/terrain.js and overrides its oracle + builder.

   V3 (CBZ.CONFIG.TERRAIN_EROSION_V3, default ON — the owner's reference
   terrain algorithm, ported):

     The owner supplied a generator from another app ("this is just better")
     whose mountain character comes from four coupled ideas, all ported here
     onto this repo's seed-free position-hash noise (window.noise.rangeVnoise
     + world-seed coordinate offsets — no noise.seed(), no Math.random, no
     shared rng streams → byte-identical per seed across clients):

       1. EROSION — an fbm field folded with pingpong, exponentiated by a
          regionally-varying "softness", then MULTIPLIED into the base fbm
          scaled by local height (erosion * terrainNoise): tall areas get
          carved ridge-and-gully structure instead of smooth gaussian lobes.
       2. RIVERS — folded |fbm| bands remapped to carved channels subtracted
          AFTER shaping: real valleys/fjords cut through the mass at every
          altitude, and sea-level channels split the coast into organic
          islands.
       3. BIOME-SCALE VARIATION — one very-low-frequency noise varies base
          ALTITUDE and EROSION SOFTNESS regionally, so no two stretches of
          the range repeat character (some coast sinks into open water, some
          rears into massifs).
       4. smoothLowerPlanes — a signed-square vs cube lerp of (noise +
          altitude): lowlands flatten toward a calm shelf easing UNDER the
          sea (no vertical waterline), peaks are exaggerated into dramatic
          silhouettes. (Deviation from the reference: t*|t| instead of t*t
          for the square term so negative altitudes stay below sea level —
          the reference app had no ocean; this world does.)

   THE OFFSHORE RANGE THIS FILE DRAWS IS REMOVED (TERRAIN_DARK_RANGE, default
   false — owner order, see the flag's block below for the material and scale
   evidence that made it "the black mountain"). Everything the pipeline does
   BELOW the waterline is untouched and still shipping: the tiles are the sea
   floor, the shelf-land cutout still owns its pixels, and terrainFogScale /
   terrainDayTint / terrainShelfLandCutout still serve their consumers in
   world.js, worldmap.js, biome_snow.js and continent.js. Read the paragraph
   below as the description of the field the flag switches back on.

     WHERE THE RELIEF LIVES: the live playable world (city + islands +
     biomes + countries + the continent's driveable Backcountry) is a ~7 km
     plate whose union AABB is synced into FLAT at build time. The oracle is
     EXACTLY 0 over FLAT + MARGIN — byte-identical physics contract — and
     relief exists only OFFSHORE, beyond the continent's own carved coast,
     rising out of the real animated sea (world.js SEA_OVERHAUL spans 16 km,
     so every range stands in true water). ALL relief is confined to the ONE
     sector due north of the snow country (snowSector: its X-window × past
     its north shore, both riding the snow world-layout dial) — layered
     depth: white reachable alpine range in front, hazy eroded ranges
     behind. Every other bearing is open sea; the bespoke titans (Mount
     Colossus / Mount Everest) are REMOVED by owner order. The physics floor
     NEVER reads this field (mode.js groundHeightAt only consults registered
     providers), so nothing here can ever be walked on — pure skyline
     geography.

     COLOR LANGUAGE is unified with the snow biome (the one range the owner
     already likes): identical granite (0x5f5b54/0x293033) and snow
     (0xf8fafb/0xd4dfe2) hues, vegetation tinted by a moisture field that
     follows the river valleys, sand shores, deep-teal shelf. Atmospheric
     perspective via the uFogScale hook (0.12): far ranges genuinely recede
     toward the live fog color (day/night/weather correct) instead of
     popping forward like stickers.

     WHY THE MODULE NOW ACTUALLY RUNS: these three world/ scripts load
     BEFORE config.js, so `window.CBZ` did not exist and every one of them
     silently bailed at parse — the whole backdrop pipeline was dead code.
     They now self-create the namespace (exactly core/seed.js's idiom), and
     this file pre-seeds a landmass builder record (order 98: after the
     continent registers the Backcountry underlay at 97, before wildnature's
     forest at 99) so buildTerrain finally has a call site.

   V2 (CBZ.CONFIG.TERRAIN_SOLID) is preserved verbatim below as the
   fallback: TERRAIN_EROSION_V3=false → the previous solid-mountain look
   (which, with config.js's PROC_TERRAIN=false default, means "no backdrop
   at all" — today's shipped world, one-line revert).

   REALNESS PASS (world/mountain_detail.js — the shared geology kit):
     • RIVERS V2 — the old carve was a near-inert scalar (its mapLinear window
       sat outside pingpong's own range, so it never exceeded ~6% of its
       nominal depth: "rivers" were a smooth dip). Now a real cross-section —
       flat gravel bed, V walls, floodplain terrace shelf, cut-bank crest —
       with gravel/wetted-channel colours to match.
     • STRATA — warped, non-parallel bedding cut as geometry (mtnTerrace) and
       painted from the SAME field (mtnStrataTint), so the colour bands land on
       the geometric risers. Rock↔soil now blends by SLOPE, not altitude alone.
     • SNOW — coverage, not a contour: slope sheds it, sun ASPECT raises the
       line on lit faces and drops it on shaded ones, noise feathers the edge.
       (faceLight was already computed and thrown away on brightness alone.)
     • SHADING SEAM — the tiles were flat-shaded while the walkable Mount
       Mercy / Greater Mercy meshes right in front of them are smooth-shaded,
       so the two ranges met at a hard faceted-vs-smooth line. Both smooth now.
     • RESOLUTION — one adaptive CDF axis computed across the whole 4×4 span
       and SLICED per tile (shared boundary samples ⇒ no T-junction cracks),
       so grid lines concentrate on the relief sector and thin over open sea.
     • SCALE — TERRAIN_RING_AMP compensates the foreshortening of a range that
       stands 150-2050u further out than the walkable one.
   All of it obeys the kit's two safety laws, so the math gate's
   city-on-mountain / mountains-outside-snow cell sets can only shrink.

   Perf: 4×4 tiles at TERRAIN_TILE_SEG (88) ≈ 248k tris / 16 draws + one
   90-boulder talus scatter (≤3 InstancedMesh draws). Smooth shading means the
   colour loop runs per VERTEX rather than per de-indexed triangle corner, so
   it is ~4x cheaper than the old flat-shaded build despite the higher segment
   count. Oracle is analytic + allocation-free.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  if (!window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.TERRAIN_SOLID == null) CFG.TERRAIN_SOLID = true;
  // The whole new relief pipeline in one flag (defaulted HERE; config.js also
  // flips PROC_TERRAIN/WILD_NATURE on when it is true). One-line revert.
  if (CFG.TERRAIN_EROSION_V3 == null) CFG.TERRAIN_EROSION_V3 = true;
  // OWNER: "mountains only in a fully white area — cities should not spawn on a
  // giant mountain." The backdrop range used to span the whole northern edge,
  // so it stood behind forest / kesh / mbeya too. This confines the grand range
  // to the X-span of the SNOW COUNTRY (biome_snow footprint: centre x=350,
  // half=420), so relief rises ONLY behind the white country and the rest of the
  // horizon reads as open sea. Flip false to restore the map-wide range.
  if (CFG.TERRAIN_SNOW_ONLY_RANGES == null) CFG.TERRAIN_SNOW_ONLY_RANGES = true;
  // ---- REALNESS PASS (world/mountain_detail.js kit) ---------------------
  // TERRAIN_RIVER_BANKS — the V3 river term used to be a near-inert smooth dip
  // (its mapLinear window sat outside pingpong's own range, so the carve never
  // exceeded ~6% of its nominal depth). Replaced by a real valley cross-section:
  // a flat gravel bed, V walls, a floodplain terrace shelf and a cut-bank crest,
  // with matching bed/wet-band colours. Off → the old scalar dip.
  if (CFG.TERRAIN_RIVER_BANKS == null) CFG.TERRAIN_RIVER_BANKS = true;
  // TERRAIN_STRATA — warped, non-parallel altitude bedding: geometry (benches
  // and risers via mtnTerrace) plus the matching banded rock colour, shared
  // with the snow biome so both ranges are the same rock. Off → the old
  // single-ramp granite lerp on a smooth surface.
  if (CFG.TERRAIN_STRATA == null) CFG.TERRAIN_STRATA = true;
  // TERRAIN_SMOOTH_SHADE — the backdrop tiles were de-indexed + flatShading
  // while Mount Mercy / Greater Mercy right in front of them are smooth-shaded,
  // so the exact place the two ranges meet showed a faceted-vs-smooth style
  // seam. Both are smooth now. Off → the old flat facets.
  if (CFG.TERRAIN_SMOOTH_SHADE == null) CFG.TERRAIN_SMOOTH_SHADE = true;
  // TERRAIN_TILE_SEG — segments per backdrop tile (was a hard 76). The axes are
  // computed ONCE across the whole 4x4 span and then sliced per tile, so tile
  // edges share identical vertices (no T-junction cracks) while the adaptive
  // CDF concentrates lines on the relief sector and thins them over open sea.
  if (CFG.TERRAIN_TILE_SEG == null) CFG.TERRAIN_TILE_SEG = 88;
  // TERRAIN_SHELF_LAND_CUTOUT — the visual field keeps a teal seabed at -1.8
  // below the playable world. That belongs under real water, but it used to
  // remain opaque below dry land too. From an aircraft the depth buffer can no
  // longer resolve its ~1.8 m separation from the country plate; the later
  // teal draw then replaces green ground around biome/stadium/highway slabs.
  // Use the ocean's published shoreline texture as the ONE pixel-ownership
  // mask. Off restores the old overlapping shelf as a one-line revert.
  if (CFG.TERRAIN_SHELF_LAND_CUTOUT == null) CFG.TERRAIN_SHELF_LAND_CUTOUT = true;
  // TERRAIN_RING_AMP — scale foreshortening dial. The offshore ranges are the
  // same world-unit height as the walkable ones but sit 150-2050u further out,
  // so they read SMALLER. This multiplies their upper two-thirds only, through
  // CBZ.mtnHiGate: a sample at or below 45u is untouched and a sample already
  // above the math gate's 25u threshold stays above it, so the gate's
  // mountains-outside-snow / city-on-mountain counts are provably unchanged.
  // 1.18 → 4.5 (owner: "the terrain should be absolutely massive"): at 1.18
  // the offshore skyline crested ~140u — SHORTER than the walkable Greater
  // Mercy in front of it, so the backdrop read as foothills and the horizon
  // as a pancake from any altitude. 4.5 lifts the drawn crests to ~450-550u
  // (genre norm is peak ≈ extent/10; this world spans ~11km), which finally
  // puts summits above a 300-400m canopy/aircraft eye line so they can notch
  // the horizon. Same provably-gate-safe construction as before — only the
  // number moved. `?cfg_TERRAIN_RING_AMP=1.18` is the exact old skyline.
  if (CFG.TERRAIN_RING_AMP == null) CFG.TERRAIN_RING_AMP = 4.5;
  /* ==================================================================
     TERRAIN_SEABED_BATHY — THE FLOOR LAW (owner, 2026-08-03: "there should
     ALWAYS be a bottom of water — even the deepest part of the ocean should
     have a floor; it just gets dark blue there").

     MEASURED BEFORE (tools/probe.mjs raycast straight down, seed 90210, the
     coast at x=7159 z=-300):

        10 m offshore   game depth  1.9 m   drawn floor -1.86
       200 m offshore   game depth 16.1 m   drawn floor -1.86
      1000 m offshore   game depth 62.0 m   drawn floor -1.86
      4000 m offshore   game depth 62.0 m   drawn floor -26.06  (SHELF_MIN)
      6000 m offshore   game depth 62.0 m   NO FLOOR — zero ray hits
      8000 m offshore   game depth 62.0 m   NO FLOOR — zero ray hits

     So the sea had a floor 1.4 m under the surface everywhere a swimmer can
     actually reach, and none at all in the deep. Diving 20 m offshore put the
     eye straight through the drawn bottom into a void that the fog then
     painted, which is precisely why the underwater view had no depth cue.

     v3Visual's interior constant (-1.8) was a placeholder for "under the
     playable world the plate/city/sea own the view" — true for LAND, wrong
     for every metre of water. It now reads the SAME bathymetry the swimmer
     is clamped against (city/swim.js's bed model, published as
     CBZ.citySeaBedDepthAt), so the floor you can see is the floor you stand
     on. SHELF_MIN moves with it: -26 could not express a 62 m water column.

     Land is untouched — over dry ground the helper returns the old -1.8 and
     the shelf stays buried exactly where it was. The PHYSICS oracle
     (v3Height) is not involved at all; this is the visual field only.
     `?cfg_TERRAIN_SEABED_BATHY=0` restores the flat -1.8 shelf and -26 clamp.
  ================================================================== */
  if (CFG.TERRAIN_SEABED_BATHY == null) CFG.TERRAIN_SEABED_BATHY = true;

  // originals (terrain.js loaded just before this file)
  const orig = {
    height: CBZ.terrainHeight,
    normal: CBZ.terrainNormal,
    build: CBZ.buildTerrain,
  };
  if (!orig.build || !orig.height) return;   // terrain.js absent — nothing to do

  const N = window.noise;
  function vn(x, z) { return N && N.rangeVnoise ? N.rangeVnoise(x, z) : 0.5; }
  function rfbm(x, z) { return N && N.rangeRidgedFbm ? N.rangeRidgedFbm(x, z) : 0.3; }

  // ---- the flat contract (identical constants to terrain.js) ------------
  // Stage-2 map enlargement grows this shared object at build time via
  // CBZ.syncTerrainFlat (terrain.js merges CBZ.WORLD_ENLARGE_FLAT there);
  // the literal below is only the last-resort seed and the module bails
  // just under here anyway when terrain.js (orig.build) is absent.
  const FLAT = CBZ.TERRAIN_FLAT || { minX: -960, maxX: 1580, minZ: -1790, maxZ: 760 };
  CBZ.TERRAIN_FLAT = FLAT;
  const MARGIN = 150, RAMP = 460;
  function smooth(e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    let t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }
  // Stage-2: the walkable continent plate extends past the shared FLAT rect
  // by the continent margin; terrain.js publishes the exact clearance as
  // CBZ.TERRAIN_PLATE_CLEAR at build time (0 in the authored world, so the
  // compact world stays byte-identical). Both the relief gate AND the
  // ring-of-ranges band ride this distance, so subtracting the clearance
  // recedes the whole offshore composition past the plate edge — ranges can
  // never stand on walkable wilds. Read lazily (this file loads before the
  // value exists; it is set inside buildTerrain, before any field sample).
  // ---- TERRAIN_BACKDROP_CLEAR --------------------------------------------
  // OWNER: "there's also a very tall darker mountain than the rest of the
  // mountains and it can be flown straight through."
  //
  // That mountain is THIS FILE'S offshore skyline range, and it is DARKER
  // because it is the only range in the world drawn with a lit
  // MeshLambertMaterial — Mount Mercy and the Greater Mercy Range are unlit
  // MeshBasicMaterial with baked shading. It is collision-free ON PURPOSE
  // ("decorative mountains are not geography"), and that contract is only
  // honest while you cannot reach it.
  //
  // You could. `CBZ.TERRAIN_PLATE_CLEAR` is computed in terrain.js as the
  // CONTINENT MARGIN (PAD + 120 = 2320) on the assumption that the walkable
  // plate is FLAT plus that margin. It is not: the plate is padded around the
  // REGION UNION, and the Greater Mercy Range region reaches 2.2 km further
  // north than FLAT does — so the plate's north edge sits 4410 m past
  // FLAT.minZ while the backdrop believed 2320. The range therefore stood on
  // 2.1 km of real, driveable backcountry: measured tops of 1441 m and 1270 m
  // with CBZ.floorAt reading 0 underneath them.
  //
  // The fix is to stop assuming the number and MEASURE it, against the rect
  // continent.js publishes for the plate it actually built. Everything
  // downstream already rides this one value — the relief ring band, the side
  // weights, and the tile SPAN (which is literally `liveSpan + 4400 +
  // 2*plateClear()`), so the tiles grow to keep covering the receded range and
  // no second constant needs to learn about this.
  //
  // COST: nothing per query. The value cannot change after the plate is built,
  // so it is solved once and cached. No collision is added anywhere and
  // CBZ.floorAt is untouched — the physics floor still never reads this field.
  if (CFG.TERRAIN_BACKDROP_CLEAR == null) CFG.TERRAIN_BACKDROP_CLEAR = true;
  const BACKDROP_KEEPOUT = 260;   // clear water between the last land and the first relief
  let _pcVal = 0, _pcFor = null;
  function plateClear() {
    const base = CBZ.TERRAIN_PLATE_CLEAR || 0;
    if (CFG.TERRAIN_BACKDROP_CLEAR === false) return base;
    const P = CBZ.CONTINENT_PLATE;
    if (!P || !Number.isFinite(P.minX)) return base;
    if (_pcFor === P) return _pcVal;
    const F = CBZ.TERRAIN_FLAT || FLAT;
    const need = Math.max(F.minX - P.minX, P.maxX - F.maxX,
                          F.minZ - P.minZ, P.maxZ - F.maxZ) + BACKDROP_KEEPOUT;
    _pcFor = P; _pcVal = need > base ? need : base;
    return _pcVal;
  }
  /* ==================================================================
     TERRAIN_DARK_RANGE — THE BLACK HORIZON MOUNTAIN IS GONE.

     OWNER, twice. First: "there's also a very tall darker mountain than the
     rest of the mountains and it can be flown straight through." That was
     answered above by making it UNREACHABLE (TERRAIN_BACKDROP_CLEAR) rather
     than by removing it. Then, having looked at it again: "THERES A NORMAL
     MOUNTAIN RANGE AND THEN ONE BIGGER BLACK MOUNTAIN ON THE EDGE, REMOVE
     THAT BLACK MOUNTAIN."

     The object is THIS FILE'S OFFSHORE SKYLINE RANGE — the eroded relief the
     V3 field raises in the sector due north of the snow country. Two
     independent reasons it reads as a black mountain instead of as a
     mountain, and both are structural rather than a matter of taste:

       • MATERIAL. The backdrop tiles are the ONLY range in this world drawn
         with a LIT MeshLambertMaterial (buildV3's terrMat / buildV2's,
         below). The two ranges the owner is comparing it against —
         biome_snow.js's Mount Mercy and the Greater Mercy Range — are unlit
         MeshBasicMaterial with their shading baked into vertex colour, so
         they hold their authored albedo while this one takes the scene's
         real light and goes near-black under every low sun. terrainDayTint
         (below) exists because that luminance seam was visible from the
         other side, and it cannot help here: a Lambert surface is ALREADY
         dark; the tint only pulls the unlit ranges DOWN to meet it.
       • SCALE. TERRAIN_RING_AMP (4.5) multiplies the upper two thirds of
         this field and nothing else, so the decorative range out-tops the
         walkable one standing in front of it. "One BIGGER black mountain on
         the edge" is that dial, precisely.

     REMOVING IT IS ONE GATE, NOT A DEMOLITION. snowSector() is the single
     function that says where positive relief is permitted to exist, and the
     hard sector law (`if (h > 0) h *= sec`) already routes every raised
     sample through it. Returning 0 severs the whole composition BY
     CONSTRUCTION: no ring lift, no positive biome excursion, CBZ.terrainHeight
     identically 0 everywhere (so the math gate's mountain-cell sets can only
     shrink and backdropAudit's onPlate invariant holds with nothing left to
     violate it), terrainTreeInfo density 0 (wildnature plants nothing
     offshore), the talus scatter finds no apron to sit in. The northern
     horizon becomes exactly what every OTHER bearing has always been: open
     sea over the same visual shelf, drawn by the same tiles.

     WHAT SURVIVES, DELIBERATELY:
       • the 4x4 tiles themselves. They are not the mountain — they are the
         SEA FLOOR (v3Visual eases from -1.8 under the playable world out to
         the SHELF_MIN clamp at -26), and they are the ground the 16 km ocean
         is drawn over. Deleting the mesh to delete the mountain would take
         the seabed with it.
       • every UNLIT range. Mount Mercy and the Greater Mercy Range are
         biome_snow.js's, walkable, and untouched by this file.
       • terrainFogScale / terrainDayTint / terrainShelfLandCutout, which are
         shared helpers with consumers in world.js, worldmap.js,
         biome_snow.js and continent.js. None of them knows this range
         existed and none of them is told.

     true restores the range exactly as it shipped — a one-line revert.
  ================================================================== */
  if (CFG.TERRAIN_DARK_RANGE == null) CFG.TERRAIN_DARK_RANGE = false;
  const RANGE_ON = () => CFG.TERRAIN_DARK_RANGE === true;

  /* ==================================================================
     CBZ.backdropAudit() — CAN YOU TOUCH THE SCENERY?

     The decorative range is allowed to have no collision ONLY while it is
     unreachable. So the invariant is a DISTANCE, measured by sampling the
     real field rather than by trusting the gates: for every grid point that
     carries relief, how far OUTSIDE the walkable continent plate does it
     sit? `onPlate` is the ratchet — a relief sample standing on driveable
     ground is the fly-through mountain, and it must be 0.

     SINCE TERRAIN_DARK_RANGE, the honest answer to that sweep is that there
     is nothing to measure: the field carries no positive relief anywhere, so
     `reliefCells` reads 0 and `onPlate` is 0 with nothing left that could
     make it otherwise. The sweep is deliberately still RUN rather than
     short-circuited — reliefCells === 0 measured over the real oracle is the
     PROOF that the range is gone, and it is the same proof the day somebody
     flips the flag back on. `rangeRemoved` says which world you are looking
     at so a reader never mistakes "audit reports nothing" for "audit did not
     run"; `minClearance` / `worstAt` are null when there is no relief,
     because a clearance to an object that does not exist is not a number.
  ================================================================== */
  CBZ.backdropAudit = function (opts) {
    opts = opts || {};
    const P = CBZ.CONTINENT_PLATE, F = CBZ.TERRAIN_FLAT || FLAT;
    const g = plateClear();
    if (!P || !Number.isFinite(P.minX)) {
      return { plate: null, plateClear: +g.toFixed(0), rangeRemoved: !RANGE_ON(),
               note: "continent plate not published" };
    }
    const MIN_H = Number.isFinite(+opts.h) ? +opts.h : 8;    // "relief", not a ripple
    const N = Number.isFinite(+opts.step) && +opts.step > 8 ? +opts.step : 150;
    const span = Math.max(F.maxX - F.minX, F.maxZ - F.minZ) + 2 * g + 5200;
    const cx = (F.minX + F.maxX) / 2, cz = (F.minZ + F.maxZ) / 2;
    let onPlate = 0, minClear = Infinity, maxH = 0, worst = null, cells = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = cx - span / 2 + (i + 0.5) * span / N;
      const z = cz - span / 2 + (j + 0.5) * span / N;
      const h = CBZ.terrainHeight(x, z);
      if (!(h > MIN_H)) continue;
      cells++;
      if (h > maxH) maxH = h;
      // signed distance outside the plate rect: negative = ON the plate
      const dx = Math.max(P.minX - x, 0, x - P.maxX), dz = Math.max(P.minZ - z, 0, z - P.maxZ);
      const outside = (dx > 0 || dz > 0) ? Math.hypot(dx, dz)
        : -Math.min(x - P.minX, P.maxX - x, z - P.minZ, P.maxZ - z);
      if (outside <= 0) onPlate++;
      if (outside < minClear) { minClear = outside; worst = { x: Math.round(x), z: Math.round(z), h: Math.round(h) }; }
    }
    return {
      plateClear: +g.toFixed(0),
      reliefCells: cells,                   // 0 once the range is removed
      maxHeight: Math.round(maxH),
      onPlate: onPlate,                     // RATCHET: must be 0
      minClearance: Number.isFinite(minClear) ? Math.round(minClear) : null,
      worstAt: worst,
      rangeRemoved: !RANGE_ON(),            // TERRAIN_DARK_RANGE — why cells is 0
      enabled: CFG.TERRAIN_BACKDROP_CLEAR !== false,
    };
  };
  function distOutsideFlat(x, z) {
    const g = plateClear();
    const dx = Math.max((FLAT.minX - g) - x, 0, x - (FLAT.maxX + g));
    const dz = Math.max((FLAT.minZ - g) - z, 0, z - (FLAT.maxZ + g));
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ======================================================================
     V2 — the previous "solid mountains" pipeline, preserved as fallback.
     (Unchanged math; see git history for its original commentary.)
  ====================================================================== */
  const SO1 = ((CBZ.hashN ? CBZ.hashN(7331) % 997 : 137) + 13) * 1.71;
  const SO2 = ((CBZ.hashN ? CBZ.hashN(9227) % 997 : 411) + 7) * 2.33;

  const HILL_AMP = 60, HILL_FREQ = 1 / 620;
  function fbm2(x, z) {
    let f = HILL_FREQ, a = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += a * (vn(x * f + SO1 + o * 13.7, z * f - SO1 - o * 7.3) * 2 - 1);
      norm += a; f *= 2.03; a *= 0.5;
    }
    return (sum / norm) * HILL_AMP;
  }
  const RIDGE_AMP = 320, RIDGE_FREQ = 1 / 780;
  function ridged2(x, z) {
    return rfbm(x * RIDGE_FREQ + SO2, z * RIDGE_FREQ - SO2) * RIDGE_AMP;
  }

  let CX = (FLAT.minX + FLAT.maxX) / 2;
  let CZ = (FLAT.minZ + FLAT.maxZ) / 2;
  // Snow-country footprint (biome_snow.js: authored rect centre (350,-1450),
  // half (420,330)). The backdrop range is confined to this X-span so it
  // stands only behind the white country (owner: mountains snow-only).
  // FOLLOWS THE SNOW DIAL FULLY (world/layout.js CBZ.worldOff("snow") — both
  // axes): the window and the north-shore line ride the offset, so moving the
  // snow island drags every backdrop range with it.
  // THE SNOW COUNTRY'S RECT, ASKED FOR RATHER THAN RE-TYPED. These three
  // numbers were biome_snow.js's `CX`, `HX` and `CZ - HZ` copied by hand into
  // this file — the whole backdrop composition is aimed with them, and this
  // file parses ~300 script tags BEFORE biome_snow.js, which is exactly why
  // the copy existed. world/layout.js (which parses FIRST, and which owns the
  // dial and the footprint scale that produce the rect) publishes it instead,
  // so the ranges follow a snow country that moves OR grows. The old literals
  // are the degrade-safe fallback and nothing else reads them.
  const _SNOWOFF = (CBZ.worldOff && CBZ.worldOff("snow")) || { dx: 0, dz: 0 };
  const _SNOWFOOT = (CBZ.worldFoot && CBZ.worldFoot("snow")) || null;
  const SNOW_CX = _SNOWFOOT ? _SNOWFOOT.cx : (350 + _SNOWOFF.dx);
  const SNOW_HX = _SNOWFOOT ? _SNOWFOOT.hx : 420;
  const SNOW_NZ = _SNOWFOOT ? _SNOWFOOT.minZ : (-1780 + _SNOWOFF.dz);   // north shore (world z)
  const SNOW_ONLY = () => CFG.TERRAIN_SNOW_ONLY_RANGES !== false;
  // ---- BIOME_ORGANIC_EDGES MARGIN ----------------------------------------
  // With organic edges on, "is this cell snow" stops being a rectangle test
  // and becomes a domain-warped one (city/worldmap.js). The whole doctrine
  // this file enforces — relief exists ONLY where the world reads snow — is
  // therefore keyed to a boundary that now moves, so the margin is stated
  // rather than assumed: the first metre of offshore relief starts one warp
  // amplitude FURTHER NORTH than it used to. 110 u against a 7.4 km ring
  // radius is free, and the direction is the safe one (less relief, further
  // out) whichever way the warp happens to fall on a given seed.
  //
  // The X WINDOW IS DELIBERATELY NOT NARROWED. worldmap.js's law is that the
  // warp may hand a rect point to a NEIGHBOURING biome that genuinely
  // dominates it, or extend a biome outward — never punch a hole — and the
  // nearest other biome to this one is Redhollow Forest, 982 u away. Snow
  // classification inside and around this window can therefore only ever GROW,
  // so narrowing the window would cost visible backdrop for no safety at all.
  const SNOW_WARP = (CFG.BIOME_ORGANIC_EDGES === false) ? 0 : 110;
  // 1 inside the snow country's X-span (feathered), 0 beyond.
  function snowWindowX(x) {
    const f = 240;
    return smooth(SNOW_CX - SNOW_HX - f, SNOW_CX - SNOW_HX, x) *
      (1 - smooth(SNOW_CX + SNOW_HX, SNOW_CX + SNOW_HX + f, x));
  }
  // 1 only in the sector due NORTH of the snow country (inside its X-window,
  // past its north shore) — the one bearing allowed to carry offshore relief.
  // Everything else on the horizon stays open sea (owner: mountains only on
  // the snow island's side, far from every city, from any angle).
  function snowSector(x, z) {
    // TERRAIN_DARK_RANGE (above): the offshore skyline range is REMOVED. This
    // is the one gate the whole V3 composition hangs off — zero here and no
    // positive relief can be raised on any bearing, so the horizon is open
    // sea and the shelf tiles draw the seabed alone.
    if (!RANGE_ON()) return 0;
    if (!SNOW_ONLY()) return 1;
    return snowWindowX(x) * smooth(60 + SNOW_WARP, 420 + SNOW_WARP, SNOW_NZ - z);
  }
  let RANGE_WEST_X = CX - 850;
  let RANGE_EAST_X = CX + 1050;
  // NOTE: the two bespoke titans (HEROES2 "Mount Colossus"/"Mount Everest"
  // gaussian bumps) are REMOVED by owner order — V2 relief is ONLY the
  // standard rangeMask2 ridged lobes below, snow-window confined.
  function layoutRanges2() {
    CX = (FLAT.minX + FLAT.maxX) / 2;
    CZ = (FLAT.minZ + FLAT.maxZ) / 2;
    const width = FLAT.maxX - FLAT.minX;
    if (SNOW_ONLY()) {
      // Both range lobes stand INSIDE the snow country's X-span so the ridges
      // (and their bell tails) never bleed over non-snow biomes.
      RANGE_WEST_X = SNOW_CX - SNOW_HX * 0.5;   // ~140
      RANGE_EAST_X = SNOW_CX + SNOW_HX * 0.5;   // ~560
    } else {
      RANGE_WEST_X = CX - Math.min(980, width * 0.2);
      RANGE_EAST_X = CX + Math.min(1180, width * 0.24);
    }
  }
  layoutRanges2();
  function bell(x, centre, sigma) {
    const q = (x - centre) / sigma;
    return Math.exp(-0.5 * q * q);
  }
  function rangeMask2(x, z) {
    // TERRAIN_DARK_RANGE: the V2 fallback draws the SAME object with the SAME
    // lit Lambert material (buildV2's terrMat), so it is removed here too —
    // otherwise flipping TERRAIN_EROSION_V3 off would quietly bring the black
    // mountain back.
    if (!RANGE_ON()) return 0;
    const north = FLAT.minZ - z;
    if (north <= MARGIN + 20) return 0;
    const depth = smooth(MARGIN + 20, MARGIN + RAMP * 0.9, north) *
      (1 - smooth(1250, 1850, north));
    if (depth <= 0) return 0;
    const lobes = Math.max(
      bell(x, RANGE_WEST_X, 500),
      bell(x, RANGE_EAST_X, 430) * 0.96
    );
    let m = depth * smooth(0.16, 0.58, lobes);
    if (SNOW_ONLY()) m *= snowWindowX(x);   // relief only behind the white country
    return m;
  }
  CBZ.terrainRangeMask = rangeMask2;

  function solidHeight2(x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return 0;
    const range = rangeMask2(x, z);
    if (range <= 0) return 0;
    const north = Math.max(0, FLAT.minZ - z);
    const outer = 1 - smooth(1450, 1950, north);
    if (outer <= 0) return 0;
    const hills = Math.max(0, 18 + fbm2(x, z) * 0.72) * range;
    const mtn = ridged2(x, z) * range;
    return Math.max(0, hills + mtn) * outer;
  }
  function visualHeight2(x, z) {
    const h = CBZ.terrainHeight(x, z);
    return h - 1.8 * (1 - smooth(0, 40, h));
  }
  const _EPS = 2.0;
  function visualNormal2(x, z, out) {
    out = out || new THREE.Vector3();
    const hL = visualHeight2(x - _EPS, z), hR = visualHeight2(x + _EPS, z);
    const hD = visualHeight2(x, z - _EPS), hU = visualHeight2(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  }

  const COL2_DEEP = new THREE.Color(0x183f59);
  const COL2_SAND = new THREE.Color(0x92795d);
  const COL2_GRASS = new THREE.Color(0x4d6242);
  const COL2_GRASS2 = new THREE.Color(0x354637);
  const COL2_ROCK = new THREE.Color(0x4b4845);
  const COL2_ROCKH = new THREE.Color(0x756f67);
  const COL2_SNOW = new THREE.Color(0xeef2f5);   // brighter, harmonized with the snow-biome white (0xf8fafb/0xd4dfe2)
  function bandColor2(y, slope, wob, out) {
    const j = (wob - 0.5) * 26;
    if (y < -0.2) { out.copy(COL2_DEEP); return; }
    if (y < 6 + j * 0.2) { out.copy(COL2_SAND).lerp(COL2_GRASS, smooth(1.5, 6, y)); return; }
    if (y < 95 + j) {
      out.copy(COL2_GRASS).lerp(COL2_GRASS2, smooth(10, 85, y));
      if (slope > 0.42) out.lerp(COL2_ROCK, smooth(0.42, 0.75, slope));
      return;
    }
    if (y < 235 + j * 1.6) {
      out.copy(COL2_ROCK).lerp(COL2_ROCKH, smooth(95, 220, y));
      if (slope < 0.55) out.lerp(COL2_SNOW, smooth(165 + j, 240 + j, y) * (1 - slope));
      return;
    }
    out.copy(COL2_SNOW);
    if (slope > 0.62) out.lerp(COL2_ROCKH, smooth(0.62, 0.95, slope));
    out.multiplyScalar(0.90 + wob * 0.12);
  }

  // ---- the fogDepth scale — terrain reads solid past the city fog wall.
  //      r128: fog_vertex sets `fogDepth = -mvPosition.z` (varying). Shared
  //      helper (biome_snow + continent also call it). 0.12: from the city
  //      core the far ranges sit ~40-55% into fog (genuine atmospheric
  //      recession, still tracking the LIVE fog color day/night); from the
  //      outer country coasts ~10-20% (solid presence); airborne (fog.far
  //      4200) ~12% (crisp panorama).
  const FOG_SCALE = 0.12;
  /* ---- ATMOSPHERIC PERSPECTIVE IS AN ABOVE-WATER IDEA -------------------
     uFogScale exists so a range 3 km out recedes toward the sky instead of
     popping forward like a sticker, and 0.12 is right for that. Underwater it
     is a disaster, and it is what made the shallow bottom read as a
     featureless pale sheet: `fogDepth *= 0.12` means the seabed 9 m in front
     of a diver is shaded as though it were ONE metre away, so it never takes
     the water's colour at all. No amount of albedo work can fix that — the
     medium was simply never being applied to the ground.

     MEASURED: shot 01 of the shallow set came back with fog #3a9dae (correct
     turquoise) and a bottom that was still near-white and completely ungraded
     across nine metres of depth change.

     So the uniform becomes SHARED and drivable — the same idiom this file
     already uses for the shelf land mask below — and world/water_underwater.js
     eases it to 1.0 while the eye is under, on the same ~0.22 s ramp as the
     tint. Surfacing restores every consumer's authored scale exactly. One
     value per distinct scale, so world.js / worldmap.js / biome_snow.js /
     continent.js keep their own dials. */
  const _fogScaleU = new Map();
  function fogScaleUniform(scale) {
    const k = scale == null ? FOG_SCALE : scale;
    let u = _fogScaleU.get(k);
    if (!u) { u = { value: k, base: k }; _fogScaleU.set(k, u); }
    return u;
  }
  // 0 = the authored above-water scale, 1 = fully submerged (no scaling).
  CBZ.terrainFogScaleSubmerged = function (k01) {
    const t = k01 > 1 ? 1 : (k01 > 0 ? k01 : 0);
    _fogScaleU.forEach(function (u) { u.value = u.base + (1 - u.base) * t; });
    return t;
  };
  CBZ.terrainFogScale = function (mat, scale) {
    // tagged so the worldSurface fog sweep (worldmap.js) never double-wraps a
    // material a builder already dialled by hand
    mat.userData = mat.userData || {};
    mat.userData._cbzFogScaled = true;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uFogScale = fogScaleUniform(scale);
      sh.vertexShader = "uniform float uFogScale;\n" + sh.vertexShader
        .replace("#include <fog_vertex>",
          "#include <fog_vertex>\n#ifdef USE_FOG\n\tfogDepth *= uFogScale;\n#endif");
    };
    return mat;
  };

  // ---- dry-land ownership for the visual seabed ------------------------
  // city/world.js publishes the same 640² shoreline field the ocean samples:
  // red > 0.5 means dry land and the water fragment discards itself. The
  // decorative shelf must make that identical decision. Draw order, a larger
  // vertical gap, or another polygon offset only moves the camera distance at
  // which two opaque owners collapse onto one depth value.
  const _shelfLandMaskU = { value: null };
  const _shelfLandBoundsU = { value: new THREE.Vector4(0, 0, 1, 1) };
  const _shelfHasLandMaskU = { value: 0 };
  function syncShelfLandMask() {
    const tex = CBZ.citySeaFieldTexture || null;
    _shelfLandMaskU.value = tex;
    _shelfHasLandMaskU.value = tex ? 1 : 0;
    if (CBZ.citySeaFieldBounds) _shelfLandBoundsU.value.copy(CBZ.citySeaFieldBounds);
  }
  function terrainShelfLandCutout(mat) {
    if (!mat || CFG.TERRAIN_SHELF_LAND_CUTOUT === false) return mat;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh) {
      if (prev) prev.call(this, sh);
      syncShelfLandMask();
      sh.uniforms.uCbzShelfLandMask = _shelfLandMaskU;
      sh.uniforms.uCbzShelfLandBounds = _shelfLandBoundsU;
      sh.uniforms.uCbzShelfHasLandMask = _shelfHasLandMaskU;
      sh.vertexShader = "varying vec2 vCbzShelfWorldXZ;\n" + sh.vertexShader
        .replace("#include <worldpos_vertex>",
          "#include <worldpos_vertex>\n" +
          "vCbzShelfWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      sh.fragmentShader =
        "uniform sampler2D uCbzShelfLandMask;\n" +
        "uniform vec4 uCbzShelfLandBounds;\n" +
        "uniform float uCbzShelfHasLandMask;\n" +
        "varying vec2 vCbzShelfWorldXZ;\n" +
        sh.fragmentShader.replace("#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\n" +
          "if (uCbzShelfHasLandMask > 0.5) {\n" +
          "  vec2 cbzSpan = max(uCbzShelfLandBounds.zw - uCbzShelfLandBounds.xy, vec2(1.0));\n" +
          "  vec2 cbzUv = (vCbzShelfWorldXZ - uCbzShelfLandBounds.xy) / cbzSpan;\n" +
          "  if (all(greaterThanEqual(cbzUv, vec2(0.0))) && all(lessThanEqual(cbzUv, vec2(1.0))) &&\n" +
          "      texture2D(uCbzShelfLandMask, cbzUv).r > 0.5) discard;\n" +
          "}");
    };
    mat.userData = mat.userData || {};
    mat.userData._cbzShelfLandCutout = true;
    return mat;
  }

  // ---- day-tracking brightness for UNLIT terrain/world materials ---------
  // A MeshBasicMaterial renders its authored colours at full brightness
  // through dawn, dusk and midnight — which is why the snow massifs (both
  // Basic with baked shading) read as self-lit white cardboard standing on a
  // correctly darkened Lambert plate whenever the sun is low. Owner, from
  // the air: "mountains look brighter than the ground that they sit on — it
  // makes the ground look gray and it makes it look computer generated and
  // dumb." The luminance SEAM is the ugliness: lit and unlit surfaces must
  // move together. This multiplies the fragment by ONE shared day factor
  // (tracking the same dayness the Lambert ground effectively renders with),
  // injected just before tone mapping so it dims in linear light exactly
  // like a real light change. Chain-safe: composes with any onBeforeCompile
  // the material already carries (terrainFogScale), every adopter shares one
  // uniform object, and one lazy per-frame hook drives them all.
  // Flag TERRAIN_DAY_TINT — false pins the factor at 1 (the old always-noon
  // look) without touching any adopter.
  if (CFG.TERRAIN_DAY_TINT == null) CFG.TERRAIN_DAY_TINT = true;
  const _dayU = { value: 1 };
  let _dayHooked = false;
  function dayTintTick() {
    // Lambert ground swings roughly 1.0 (noon sun+hemi) -> ~0.4 (night
    // 0.16 sun + 0.38 hemi). 0.40 + 0.60·dayness tracks that swing without
    // crushing the snow's high albedo; dusk lands in between exactly as the
    // lit ground does. Flag off -> 1 (byte-identical old brightness).
    const day = CBZ.dayness != null ? +CBZ.dayness : 1;
    // NIGHT_TRUE_DARK (core/lights.js): the 0.40 floor mirrored a night rig
    // that no longer exists. Past astronomical dusk the lit ground goes to
    // ~0.015 of noon, so the tint follows it down on the same curve — or
    // every tinted texture would float as a grey slab over black Lambert.
    const depth = (CBZ.CONFIG && CBZ.CONFIG.NIGHT_TRUE_DARK && CBZ.nightDepth) ? Math.max(0, Math.min(1, +CBZ.nightDepth)) : 0;
    _dayU.value = CFG.TERRAIN_DAY_TINT === false
      ? 1 : (0.40 + 0.60 * Math.max(0, Math.min(1, day))) * (1 - 0.96 * depth);
  }
  CBZ.terrainDayTint = function (mat) {
    if (!mat) return mat;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh) {
      if (prev) prev.call(this, sh);
      sh.uniforms.uCbzDay = _dayU;                 // SHARED object — one write drives all
      let fs = sh.fragmentShader;
      // pre-tonemap when possible (dims in linear light, like a real lamp);
      // pre-fog as the fallback so the fogged colour still converges on the
      // live fog tint either way.
      if (fs.indexOf("#include <tonemapping_fragment>") >= 0) {
        fs = fs.replace("#include <tonemapping_fragment>",
          "gl_FragColor.rgb *= uCbzDay;\n#include <tonemapping_fragment>");
      } else {
        fs = fs.replace("#include <fog_fragment>",
          "gl_FragColor.rgb *= uCbzDay;\n#include <fog_fragment>");
      }
      sh.fragmentShader = "uniform float uCbzDay;\n" + fs;
    };
    mat.needsUpdate = true;
    if (!_dayHooked && CBZ.onAlways) { _dayHooked = true; CBZ.onAlways(91.5, dayTintTick); }
    return mat;
  };

  /* ---- AERIAL PERSPECTIVE — a far range must go PALE, not merely dim ----
     Fog converges everything on ONE colour at ONE length scale, and this
     file's terrain deliberately runs it at 0.12 (see FOG_SCALE) so a 3 km
     range keeps its presence instead of dissolving. That is right for
     PRESENCE and wrong for DEPTH, and the two are separate problems:

       • fog is a grey/cyan LERP — it takes a saturated green ridge to the
         sky colour along a straight line, so at 40% fog the ridge is still
         40% as green as the headland in front of it and the two read at the
         same distance;
       • real aerial perspective DESATURATES FIRST and only then brightens
         (Rayleigh scatter adds a blue-white veil in front of the object
         while absorption eats its own colour), and it acts over KILOMETRES,
         not across the city's fog wall.

     In the owner's reference photographs the near headlands are almost
     black-green while a snow range four ridgelines behind them is a pale
     desaturated blue-white that reads nearly as sky — and every ridgeline
     between is a distinct step paler than the one in front. That LAYERING is
     the whole depth cue, and it is what the game's mountains had none of.

     So this is one extra term, not a second fog: a saturate→pale-blue ramp
     over [start, full] metres of view distance, applied before <fog_fragment>
     so the live fog (day/night/weather correct) still lands on top.
     TWO GATES keep it inside this territory:
       • it acts only on land above `minY` — the sea bed and the shoreline
         belong to the water look and must not be touched;
       • the pale colour TRACKS THE LIVE FOG COLOUR (lifted toward blue-white
         and scaled by CBZ.dayness), so a range does not glow pale blue at
         midnight or stay cold under a sunset sky.
     Chain-safe exactly like terrainDayTint. `?cfg_TERRAIN_AERIAL_V1=0`
     reverts to the pure-fog look. */
  if (CFG.TERRAIN_AERIAL_V1 == null) CFG.TERRAIN_AERIAL_V1 = true;
  const _aerColU = { value: new THREE.Color(0xc9d8e4) };
  const _aerDefault = new THREE.Color(0xc9d8e4);
  const _aerTmp = new THREE.Color();
  let _aerHooked = false;
  function aerialTick() {
    const c = _aerColU.value;
    const fog = CBZ.scene && CBZ.scene.fog;
    if (fog && fog.color) _aerTmp.copy(fog.color); else _aerTmp.copy(_aerDefault);
    // Lift the fog hue toward a cool blue-white: haze over a distant range is
    // brighter and bluer than the fog immediately around the camera, because
    // there are kilometres more air scattering into the line of sight.
    _aerTmp.r = _aerTmp.r * 0.80 + 0.16;
    _aerTmp.g = _aerTmp.g * 0.82 + 0.18;
    _aerTmp.b = _aerTmp.b * 0.84 + 0.22;
    // Night must not leave a self-lit pale veil hanging on the ridgelines.
    const day = CBZ.dayness != null ? Math.max(0, Math.min(1, +CBZ.dayness)) : 1;
    const k = 0.34 + 0.66 * day;
    c.setRGB(_aerTmp.r * k, _aerTmp.g * k, _aerTmp.b * k);
  }
  const _aerRangeU = new Map();     // one shared uniform per distinct band
  CBZ.terrainAerial = function (mat, o) {
    if (!mat || CFG.TERRAIN_AERIAL_V1 === false) return mat;
    o = o || {};
    const start = o.start == null ? 900 : o.start;
    const full = o.full == null ? 5200 : o.full;
    const minY = o.minY == null ? 8 : o.minY;
    const maxY = o.maxY == null ? 40 : o.maxY;      // fully "land" by here
    const amt = o.amount == null ? 0.72 : o.amount;
    const key = start + "|" + full + "|" + minY + "|" + maxY + "|" + amt;
    let u = _aerRangeU.get(key);
    if (!u) {
      u = {
        range: { value: new THREE.Vector4(start, full, minY, maxY) },
        amount: { value: amt },
      };
      _aerRangeU.set(key, u);
    }
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh) {
      if (prev) prev.call(this, sh);
      sh.uniforms.uCbzAerRange = u.range;
      sh.uniforms.uCbzAerAmt = u.amount;
      sh.uniforms.uCbzAerCol = _aerColU;            // SHARED — one tick drives all
      sh.vertexShader = "varying vec2 vCbzAer;\n" + sh.vertexShader
        .replace("#include <project_vertex>",
          "#include <project_vertex>\n" +
          "vCbzAer = vec2(-mvPosition.z, (modelMatrix * vec4(transformed, 1.0)).y);");
      sh.fragmentShader = "uniform vec4 uCbzAerRange;\nuniform float uCbzAerAmt;\n" +
        "uniform vec3 uCbzAerCol;\nvarying vec2 vCbzAer;\n" +
        sh.fragmentShader.replace("#include <fog_fragment>",
          "float cbzAerD = smoothstep(uCbzAerRange.x, uCbzAerRange.y, vCbzAer.x);\n" +
          "float cbzAerL = smoothstep(uCbzAerRange.z, uCbzAerRange.w, vCbzAer.y);\n" +
          "float cbzAer = cbzAerD * cbzAerL * uCbzAerAmt;\n" +
          "float cbzAerLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n" +
          "gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(cbzAerLum), 0.85 * cbzAer);\n" +
          "gl_FragColor.rgb = mix(gl_FragColor.rgb, uCbzAerCol, cbzAer);\n" +
          "#include <fog_fragment>");
    };
    mat.needsUpdate = true;
    mat.userData = mat.userData || {};
    mat.userData._cbzAerial = true;
    // The live uniform objects, hung where a probe can reach them. Aerial
    // perspective is the one part of this that cannot be checked by reading
    // numbers off the world — it lives in the fragment shader — so the tuning
    // loop needs to be able to drive it from outside without a rebuild.
    mat.userData._cbzAerialU = u;
    mat.userData._cbzAerialColU = _aerColU;
    if (!_aerHooked && CBZ.onAlways) { _aerHooked = true; CBZ.onAlways(91.6, aerialTick); }
    return mat;
  };

  /* ======================================================================
     V3 — the reference algorithm, ported.
  ====================================================================== */

  // ---- tiny math (local, allocation-free; r128's MathUtils has pingpong
  //      too, but the oracle is hot — keep it dependency-free) -------------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pingpong(x, len) {
    const p = len * 2;
    let m = x % p; if (m < 0) m += p;
    return len - Math.abs(m - len);
  }
  function smooth01(v) { v = clamp01(v); return v * v * (3 - 2 * v); }

  // ---- WORLD-SEED COORDINATE OFFSETS, lazily initialised ----------------
  // This file loads before core/seed.js, so CBZ.hashN does not exist at
  // parse time. Offsets init on first field evaluation (build time, long
  // after seed.js) and are cached; until hashN exists the oracle returns 0
  // (nothing samples it that early). The reference's seed/seed+1/seed+4/
  // riversSeed become distinct large offsets — value AT a place, never the
  // Nth draw of a stream.
  let SEEDED = false;
  let SB = 0, SE = 0, SR = 0, SM = 0, SC2 = 0, SW = 0;
  function initSeeds() {
    if (SEEDED) return true;
    if (!CBZ.hashN) return false;
    const golden = 0.6180339887;
    SB = 500 + (CBZ.hashN(3101) % 8192) * golden;          // base field
    SE = 9000 + (CBZ.hashN(3103) % 8192) * golden;         // erosion field
    SR = 17000 + (CBZ.hashN(3107) % 8192) * golden;        // rivers field
    SM = 25000 + (CBZ.hashN(3109) % 8192) * golden;        // biome/altitude
    SC2 = 33000 + (CBZ.hashN(3113) % 8192) * golden;       // clearings/moisture
    SW = 41000 + (CBZ.hashN(3119) % 8192) * golden;        // color wobble/snowline
    SEEDED = true;
    return true;
  }

  // ---- fbm on the seed-free hash value-noise (signed, normalised) -------
  // (octaves / lacunarity / gain / frequency / offset mirror the reference
  // FbmNoiseBuilder args; "off" is the per-purpose world-seed offset.)
  function fbmN(x, z, off, oct, lac, gain, freq, offset) {
    let f = freq, a = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * (vn(x * f + off + o * 19.7, z * f - off - o * 11.3) * 2 - 1);
      norm += a; f *= lac; a *= gain;
    }
    return offset + (sum / norm);
  }
  // unsigned variant (0..1-centred) — the reference's fbmBiomes maps 0..1,
  // and its downstream constants (`*1.4-0.75`, `*0.6-0.1`) assume that.
  function fbm01(x, z, off, freq) {
    return vn(x * freq + off, z * freq - off);
  }

  // ---- the reference args, tuned for this world's scale -----------------
  const V3P = {
    // base fbm: ~1.35 km features, 5 octaves — the raw mountain mass
    OCT: 5, LAC: 2.03, GAIN: 0.5, FREQ: 1 / 1350, OFFSET: 0.25,
    // erosion fbm (3 oct, lac 1.8, offset .3, amp .2 — reference values)
    E_OCT: 3, E_LAC: 1.8, E_AMP: 0.2, E_OFFSET: 0.3,
    EROSION: 0.85,             // args.erosion — carve strength (∝ height)
    EROSION_SOFT: 0.3,         // args.erosionSoftness (regional noise adds ±0.39)
    // rivers fbm (4 oct, gain .35) — carve bands at |fbm|≈0.25 and 0.75
    R_OCT: 4, R_GAIN: 0.35, R_FREQ: 1 / 1900,
    RIVER_W: 0.47, RIVER_F: 0.2,   // riverWidth / riverFalloff (band mapping)
    RIVERS: 0.5,               // args.rivers — post-shaping carve depth (norm.)
    // biome-scale noise: ~2.4 km — regional altitude ±0.49 + softness ±0.39
    B_FREQ: 1 / 2400,
    SMOOTH_LOWER: 0.62,        // args.smoothLowerPlanes — sq-vs-cube lerp
    ALT_BASE: -0.42,           // open-sea baseline (below water)
    ALT_RING: 0.78,            // ring-of-ranges altitude lift at full mask
    AMP: 380,                  // world units per shaped-noise unit
    // Visual seabed clamp. -26 predates the 62 m gameplay water column and was
    // the reason the open ocean bottomed out at a quarter of its own depth;
    // -62.5 is exactly SEA_Y - the bathymetry cap, so the drawn abyssal plain
    // meets the depth a swimmer is actually clamped at. (TERRAIN_SEABED_BATHY
    // off → the historical -26.)
    SHELF_MIN: -62.5,
    SHELF_MIN_LEGACY: -26,
  };
  function shelfMin() {
    return CFG.TERRAIN_SEABED_BATHY === false ? V3P.SHELF_MIN_LEGACY : V3P.SHELF_MIN;
  }

  /* ---- THE BATHYMETRY THE SHELF IS DRAWN FROM ---------------------------
     ONE model, not a second one: city/swim.js publishes CBZ.citySeaBedDepthAt
     (metres of water column) and clamps the swimmer against it, so reading it
     here is what makes the drawn bottom and the swimmable bottom the same
     surface. The inline fallback reproduces that model from the water field
     for the case where swim.js has not parsed, and returns the historical flat
     shelf over dry land (where the country plate owns every pixel anyway).

     Pure analytic terrain arithmetic — no rng, no build-path draw, so the
     determinism law is untouched. */
  const SHELF_FLAT = -1.8;          // the historical under-the-world constant
  function seabedVisualY(x, z) {
    if (CFG.TERRAIN_SEABED_BATHY === false) return SHELF_FLAT;
    const seaY = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    let d = NaN;
    if (CBZ.citySeaBedDepthAt) d = +CBZ.citySeaBedDepthAt(x, z);
    if (!Number.isFinite(d)) {
      const wf = CBZ.waterField;
      if (!wf || !wf.shoreAt) return SHELF_FLAT;
      const s = +wf.shoreAt(x, z);
      if (!Number.isFinite(s) || s >= 0) return SHELF_FLAT;      // dry land
      const shelf = Math.max(0, -s) * 1.10;                      // swim.js SHELF_SLOPE
      const deep = CBZ.cityWaterDepthAt ? +CBZ.cityWaterDepthAt(x, z) : 24;
      d = Math.min(shelf, deep > 0 ? deep : 24);
    }
    if (!(d > 0)) return SHELF_FLAT;                             // dry land
    // Never ABOVE the old shelf: the country plate carves its own sandy rim
    // down to ~-2.07 in the first metres of water and must keep owning it,
    // and a bottom that rose over SHELF_FLAT would z-fight the plate.
    const y = seaY - Math.max(1.45, d);
    return y < SHELF_FLAT ? y : SHELF_FLAT;
  }

  // ---- WHERE the ranges stand: an offshore ring around the live world.
  //      ringIn starts past the flat margin (the contract zone stays a calm
  //      shelf), ringOut sinks every range's far side back under the sea —
  //      solid closed backs from any aircraft angle, no walls, no shells.
  function ringMask(d) {
    return smooth(MARGIN + 60, MARGIN + 560, d) * (1 - smooth(MARGIN + 1300, MARGIN + 1900, d));
  }
  // side weights: kept for the corner blend, but snowSector (in v3Field)
  //      zeroes every bearing except the north snow window — the W/E/S
  //      weights only matter inside that sector's feathered corners.
  const SIDE_N = 1.0, SIDE_W = 0.68, SIDE_E = 0.68, SIDE_S = 0.40;
  function sideWeight(x, z) {
    const g = plateClear();
    const eW = Math.max(0, (FLAT.minX - g) - x), eE = Math.max(0, x - (FLAT.maxX + g));
    const eN = Math.max(0, (FLAT.minZ - g) - z), eS = Math.max(0, z - (FLAT.maxZ + g));
    const sum = eW + eE + eN + eS;
    if (sum <= 1e-6) return 0;
    return (eW * SIDE_W + eE * SIDE_E + eN * SIDE_N + eS * SIDE_S) / sum;
  }

  // ---- NO SIGNATURE GIANTS. The bespoke V3 titans (Mount Colossus / Mount
  //      Everest altitude bumps) are REMOVED by owner order: "the giant one
  //      just needs to be gone — I wanted bigger versions of the small one,
  //      EXACT big versions, not new stupid ones." V3 relief is ONLY the one
  //      standard ring-altitude recipe below; a taller crest, if ever wanted,
  //      is the SAME field with a larger ALT_RING — never a one-off bump.
  function layoutV3() {
    CX = (FLAT.minX + FLAT.maxX) / 2;
    CZ = (FLAT.minZ + FLAT.maxZ) / 2;
  }
  if (CFG.TERRAIN_EROSION_V3 !== false) layoutV3();

  // ---- THE FIELD — the reference pipeline, one evaluation ----------------
  // Returns world height h (signed: <0 = under the sea shelf) plus the
  // intermediate fields the color ramp / vegetation ecology reuse.
  const _fld = { h: 0, carve: 0, altN: 0, moist: 0, snowY: 260, rivT: 1, rivBed: 0, rivWet: 0 };
  const KIT = function () {
    return !!(CBZ.mtnTerrace && CBZ.mtnHiGate && CBZ.mtnStrataTint && CBZ.mtnSnowCover);
  };
  function v3Field(x, z, out) {
    out = out || _fld;
    if (!initSeeds()) {
      out.h = 0; out.carve = 0; out.altN = 0; out.moist = 0; out.snowY = 260;
      out.rivT = 1; out.rivBed = 0; out.rivWet = 0; return out;
    }

    // base mountain mass
    let t = fbmN(x, z, SB, V3P.OCT, V3P.LAC, V3P.GAIN, V3P.FREQ, V3P.OFFSET);

    // erosion: pingpong-folded, softness-exponentiated, height-scaled carve.
    // The reference's lerp deliberately EXTRAPOLATES where erosion*height > 1
    // (tall ground gets carved harder than the erosion field alone) — capped
    // at 1.2 here so the factor can dig gorges without wild sign flips.
    const biomeE = fbm01(x + 500, z + 500, SM, V3P.B_FREQ) * 0.6 - 0.1;
    const softness = biomeE + V3P.EROSION_SOFT;
    let e = V3P.E_OFFSET + fbmN(x, z, SE, V3P.E_OCT, V3P.E_LAC, 0.5, V3P.FREQ, 0) * V3P.E_AMP;
    e = smooth01(e);
    e = Math.pow(e, 1 + softness);
    e = Math.min(1, Math.max(0, pingpong(e * 2, 1) - 0.3));
    t *= lerp(1, e, Math.min(1.05, V3P.EROSION * Math.max(0, t)));

    // rivers: folded |fbm| bands → carved channels (applied after shaping)
    let r = (Math.abs(fbmN(x, z, SR, V3P.R_OCT, 2, V3P.R_GAIN, V3P.R_FREQ, 0)) - 0.5) * 2;
    r = pingpong(r, 0.5);
    r = clamp01((r - V3P.RIVER_W) / V3P.RIVER_F * (0 - 1) + 1);   // mapLinear(r, W, W+F, 1, 0)
    r = (1 - smooth01(r)) * 0.5;
    // ---- RIVERS V2: the channel-distance profile a real valley has ------
    // `rivT` is 0 on the thalweg and 1 at the valley rim. Zero crossings of a
    // continuous field are continuous CURVES, so these channels branch and
    // merge into a drainage network instead of scattering as dents.
    let rivT = 1, rivBed = 0, rivTer = 0, rivBank = 0;
    if (CFG.TERRAIN_RIVER_BANKS !== false) {
      const raw = Math.abs(fbmN(x, z, SR, V3P.R_OCT, 2, V3P.R_GAIN, V3P.R_FREQ, 0));
      rivT = clamp01(pingpong(raw, 0.26) / 0.26);
      rivBed = clamp01(1 - rivT / 0.18);                  // flat gravel bed / bars
      rivTer = clamp01(1 - Math.abs(rivT - 0.55) / 0.20); // floodplain terrace shelf
      rivBank = clamp01(1 - Math.abs(rivT - 0.90) / 0.11);// cut-bank crest
    }

    // regional altitude: biome noise + the offshore ring, CONFINED to the
    // sector behind the snow country. snowSector gates BOTH the ring lift
    // and the positive biome excursions, so no range and no stray island
    // ever rises off the west/east/south coasts — the whole horizon there
    // is open sea; the negative excursions survive everywhere (the sea
    // keeps its varying depth). Owner: nothing mountainous near the city
    // from any angle; relief only on the far snow side.
    const d = distOutsideFlat(x, z);
    const sec = snowSector(x, z);
    const ring = ringMask(d) * sec;
    const biomeA = fbm01(x, z, SM, V3P.B_FREQ) * 1.4 - 0.75;   // ∈ [-0.75, 0.65]
    const altShape = ring * V3P.ALT_RING * sideWeight(x, z);
    const alt = V3P.ALT_BASE + (biomeA > 0 ? biomeA * sec : biomeA) * 0.7 + altShape;
    t = t + alt;

    // smoothLowerPlanes: signed-square vs cube (flat calm lowlands/shelf,
    // exaggerated peaks)
    t = lerp(t * Math.abs(t), t * t * t, V3P.SMOOTH_LOWER);

    // subtract the rivers, scale to world units. HARD sector law: positive
    // relief exists ONLY behind the snow country — on every other bearing
    // the field may carve the sea deeper but never raise land, so no stray
    // fbm island can surface off the city/nation coasts.
    const carve = (CFG.TERRAIN_RIVER_BANKS !== false)
      ? 0.5 * (1 - rivT)                   // 0..0.5, honest channel-ness
      : r;                                 // 0..0.5 (0.5 = full channel)
    t = t - carve * V3P.RIVERS;
    let h = t * V3P.AMP;

    // ---- CUT BANKS, GRAVEL BARS, FLOODPLAIN TERRACES --------------------
    // Everything here except the cut-bank crest SUBTRACTS, so it can only move
    // samples DOWN through the math gate's 25u mountain threshold. The crest is
    // the one additive term and rides CBZ.mtnHiGate (identically 0 below 45u),
    // so it can never lift a sub-threshold sample over the line. Both counts
    // the gate tracks are therefore subsets of what they were.
    // The gate sees the FINAL height, which is this h times the sector mask
    // AND the flat-contract ramp `fo` that v3Height/v3Visual apply afterwards.
    // Both additive terms below must therefore be gated on h * sec * fo, not on
    // the raw h — gating on the raw value would let a 0.25 sector/ramp weight
    // scale a "safely high" sample back down across the 25u line.
    const foGate = (d <= MARGIN) ? 0 : smooth(MARGIN, MARGIN + RAMP, d);
    const finalScale = sec * foGate;
    if (h > 0 && CFG.TERRAIN_RIVER_BANKS !== false && KIT()) {
      const land = smooth01(h / 34);                     // no shredding at the shore
      const depth = 26 * land;
      // flat-bottomed V + a shelf cut one step above the bed
      h -= depth * ((1 - rivT) * (1 - 0.55 * rivBed) + rivTer * 0.26);
      if (h < 0) h = 0;
      h += 5.0 * rivBank * land * CBZ.mtnHiGate(h * finalScale);
    }

    // ---- STRATA GEOMETRY: warped bedding benches and risers -------------
    // mtnTerrace is <= h by construction (its in-bed profile is pow(frac, k>1)),
    // so this is a pure LAW 1 multiplier-class term.
    if (h > 0 && CFG.TERRAIN_STRATA !== false && KIT()) {
      h = CBZ.mtnTerrace(h, x, z, {
        amount: 0.42 * smooth01((h - 55) / 120),
        step: 26, dip: 44, dipCell: 900, dipCell2: 250, salt: 0x7e11,
      });
    }

    // ---- SCALE FORESHORTENING (TERRAIN_RING_AMP) ------------------------
    // Gated by mtnHiGate: a sample at or under 45u is untouched, and a sample
    // already over 25u stays over it — the gate's cell counts are unchanged.
    const ampX = +CFG.TERRAIN_RING_AMP;
    if (h > 0 && Number.isFinite(ampX) && ampX !== 1 && KIT()) {
      h *= 1 + (ampX - 1) * CBZ.mtnHiGate(h * finalScale);
    }

    if (h > 0) h *= sec;
    out.rivT = rivT; out.rivBed = rivBed; out.rivWet = clamp01(rivBed * 1.2);

    // snowline: wobbled band, dropping toward the cold north — the high
    // crests cap deep white (harmonizing with the snow country)
    const wob = vn(x * 0.0011 + SW, z * 0.0011 - SW);
    const northness = clamp01((FLAT.minZ - z) / 2200);
    const snowY = 235 + wob * 90 - northness * 50;

    // moisture: biome dampness + river valleys − altitude (drives both the
    // vegetation tint and the wildnature tree clustering)
    const biomeM = fbm01(x + 900, z - 900, SC2, V3P.B_FREQ * 1.6) * 2 - 1;
    const altFrac = clamp01(h / Math.max(1, snowY - 60));
    const moist = clamp01(0.52 + biomeM * 0.55 + carve * 1.5 - altFrac * 0.55);

    out.h = h; out.carve = carve; out.altN = altFrac; out.moist = moist; out.snowY = snowY;
    return out;
  }

  // ---- THE V3 ORACLE — exact flat contract preserved ---------------------
  // fo ramps relief in past the margin; the physics-facing oracle is never
  // negative (the shelf is visual-only), and EXACTLY 0 over FLAT + MARGIN.
  function v3Height(x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return 0;                       // dead flat — physics-safe
    const fo = smooth(MARGIN, MARGIN + RAMP, d);
    if (fo <= 0) return 0;
    const h = v3Field(x, z, _fld).h;
    return h > 0 ? h * fo : 0;
  }
  // visual: over the flat interior this is the SEA BED (seabedVisualY — the
  // real water column where there is water, the old buried -1.8 under land),
  // then eases through the shelf and meets the oracle as fo→1.
  function v3Visual(x, z) {
    const d = distOutsideFlat(x, z);
    const lo = shelfMin();
    const fo = d <= MARGIN ? 0 : smooth(MARGIN, MARGIN + RAMP, d);
    // Past the ramp the bed term has zero weight, so the ~126k build-time
    // vertex evaluations out there never pay for a shore-field query.
    if (fo >= 1) {
      const h1 = v3Field(x, z, _fld).h;
      return h1 < lo ? lo : h1;
    }
    const base = seabedVisualY(x, z);
    if (fo <= 0) return base < lo ? lo : base;
    const h = v3Field(x, z, _fld).h;
    const v = lerp(base, h, fo);
    return v < lo ? lo : v;
  }
  function v3VisualNormal(x, z, out) {
    out = out || new THREE.Vector3();
    const hL = v3Visual(x - _EPS, z), hR = v3Visual(x + _EPS, z);
    const hD = v3Visual(x, z - _EPS), hU = v3Visual(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  }

  // ---- V3 COLOR RAMP — ONE height/slope/moisture ramp, hues shared with
  //      the snow biome so the two mountain systems speak one language:
  //      granite 0x5f5b54→0x293033 and snow 0xf8fafb/0xd4dfe2 are the exact
  //      Greater Mercy values; vegetation follows the moisture field (river
  //      valleys richer, dry shoulders scrubby); shores sand; shelf deep
  //      teal fading with depth. Slope exposes rock, altitude loads snow.
  const C3 = {
    deep: new THREE.Color(0x14364d), shallow: new THREE.Color(0x2e5a74),
    sand: new THREE.Color(0x8b7a5f),
    /* ---- SEA BED ALBEDO, read off the reference photographs ------------
       ref 3 (Tiger Beach, ~5 m): the bottom is near-WHITE shell sand, warm
       and bright enough that the whole scene's light comes back up off it —
       0x14364d/0x2e5a74 could never do that, which is why shallow water read
       as a dark teal plate instead of a beach.
       ref 5 (open ocean): whatever is down there is nearly black-navy; the
       colour the eye reads at depth is the WATER, not the ground.
       So the bed ramps sand → silt → shelf grey-teal → deep sediment BY
       WATER COLUMN, and the underwater fog in world/water_underwater.js does
       the rest. */
    // WARMER AND BRIGHTER (2026-08-03, second pass). 0xb9b298/0x7c8168 were
    // grey-OLIVE, and olive under a cyan medium is grey — the shallow bottom
    // composed into a featureless pale sheet with no sand in it at all. Ref 3's
    // foreground sand is unmistakably warm (R > G > B by a wide margin) and it
    // only cools with DISTANCE, which the fog already does. So the near stop
    // goes cream and the far stop stays warm rather than turning olive.
    // Second correction: the tiles are lit ~1.2x harder than the albedo reads,
    // so a cream value CLIPPED to white on screen. Warmer (R-B 0.27 rather
    // than 0.13 — a neutral albedo under a teal medium is grey by
    // construction, however bright it is) and a little darker so the highlight
    // has somewhere to go.
    bedSand: new THREE.Color(0xc9b184),    // ref 3 — warm foreground shell sand
    bedSilt: new THREE.Color(0x928363),    // ref 3 middle distance
    bedShelf: new THREE.Color(0x3d5c67),   // ref 4 — the shelf going over
    bedDeep: new THREE.Color(0x101d2c),    // ref 5 — abyssal sediment
    // The vegetated flank is the reference's loudest colour: a coastal range
    // is DENSE saturated green from the waterline up, not the grey-olive a
    // desaturated ramp gives. dry (the exposed shoulder) is unchanged — the
    // contrast between a wet gully and a dry spur is what makes the moisture
    // field visible at all; only the wet/forest stops go greener.
    dry: new THREE.Color(0x707252), moistV: new THREE.Color(0x44693f),
    forest: new THREE.Color(0x2f4a33),
    granite: new THREE.Color(0x5f5b54), graniteD: new THREE.Color(0x293033),
    snow: new THREE.Color(0xf8fafb), snowSh: new THREE.Color(0xd4dfe2),
  };
  const _veg = new THREE.Color();
  const _rk = new THREE.Color();
  const C3_GRAVEL = new THREE.Color(0x8a8579);   // river bed / point bars
  const C3_WET = new THREE.Color(0x4b5a5c);      // wetted channel
  const C3_TALUS = new THREE.Color(0x777064);    // scree apron below the cliffs
  // x,z are needed now: the strata bands are warped by a world-space field
  // (the SAME one mtnTerrace cut the benches with), so colour lands ON the
  // risers instead of running across them. faceLight drives both aspect
  // shading and — crucially — the snow LINE, not just its brightness.
  function bandColor3(x, z, y, slope, faceLight, wob, fld, out) {
    const snowY = fld.snowY;
    if (y < -0.6) {                                     // the sea BED
      if (CFG.TERRAIN_SEABED_BATHY === false) {
        out.copy(C3.deep).lerp(C3.shallow, smooth(-20, -0.6, y));
        return;
      }
      // metres of water standing over this vertex — the one thing the bed's
      // colour should depend on (refs 3 and 5).
      const col = (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48) - y;
      // THE WINDOWS WERE FAR TOO TIGHT. smooth(1.8, 10) meant 8 m of water had
      // already spent 89% of the sand ramp, so the whole visible bottom of a
      // shallow bay sat on one flat value of the curve: no sand colour left,
      // and no tonal variation across a sloping bed either. Ref 3's bottom is
      // still cream at the diver's depth and only turns teal tens of metres
      // out, so the sand holds much longer and the shelf starts much later.
      out.copy(C3.bedSand).lerp(C3.bedSilt, smooth(5, 24, col));
      // A sloping bed should also read as a slope. One multiplicative tone
      // fall-off with the column gives the plane continuous shading that the
      // hue ramp alone cannot — colour only, no geometry, no texture. Applied
      // BEFORE the shelf/deep lerps so both deep endpoints stay exact.
      out.multiplyScalar(1 - smooth(1, 22, col) * 0.26);
      out.lerp(C3.bedShelf, smooth(18, 38, col));
      out.lerp(C3.bedDeep, smooth(22, 56, col));
      return;
    }
    /* ---- A BEACH ONLY WHERE THE SHORE IS FLAT -------------------------
       A fjord wall has no beach: the forest goes straight into the water,
       and that abrupt green-meets-sea edge is most of what makes the
       reference read as a drowned mountain range rather than an island with
       hills on it. The old ramp gave EVERY metre of coastline the same 12 m
       sand apron whatever the ground did behind it, which hung a pale collar
       around ranges that should rise green out of the sea. Both stops now
       collapse with slope — 12 m of apron on a flat strand, under 2 m on a
       headland — so a beach is somewhere the land arrives gently. */
    const steepShore = smooth(0.15, 0.44, slope);
    const shoreTop = 2.6 - 2.1 * steepShore;
    if (y < shoreTop) {                                 // shoreline sand
      out.copy(C3.shallow).lerp(C3.sand, smooth(-0.6, 1.6, y));
      return;
    }
    // vegetation base: dry↔moist by the moisture field, deepening to forest
    _veg.copy(C3.dry).lerp(C3.moistV, fld.moist);
    _veg.lerp(C3.forest, smooth(18, 150, y) * (0.42 + fld.moist * 0.5));
    out.copy(C3.sand).lerp(_veg, smooth(shoreTop, shoreTop + 12 - 10 * steepShore, y));
    // ---- RIVER BED: gravel bars in the channel, a wetted line at the thalweg
    if (CFG.TERRAIN_RIVER_BANKS !== false && fld.rivBed > 0.01 && y < snowY - 30) {
      out.lerp(C3_GRAVEL, Math.min(0.85, fld.rivBed * 0.9));
      out.lerp(C3_WET, Math.min(0.7, fld.rivWet * fld.rivWet * 0.75));
    }
    if (CFG.TERRAIN_STRATA !== false && CBZ.mtnStrataTint) {
      // ---- BANDED ROCK: per-bed hue + a shadowed bedding contact, blended in
      // by SLOPE (steep = bare rock, shallow = soil), not by altitude alone.
      // THE GREEN CLIMBS BEFORE IT GIVES WAY. Below the treeline, and most of
      // all in the wet valleys, vegetation survives ground far too steep for
      // the old pure-slope window — so the exposure band slides uphill in
      // slope by up to 0.30 (about 17°) down there and sits exactly where it
      // did above the treeline, where bare rock genuinely is the answer.
      const treeline = snowY - 95;
      const vegHold = (1 - smooth(treeline - 130, treeline, y)) * (0.34 + 0.66 * fld.moist);
      const bare = CBZ.mtnStrataTint(_rk, x, z, y, slope, faceLight, {
        rock: C3.granite, rockDark: C3.graniteD,
        // identical bedding params to the mtnTerrace call in v3Field
        step: 26, dip: 44, dipCell: 900, dipCell2: 250,
        slope0: 0.22, slope1: 0.58, salt: 0x7e11, aspect: 1,
        vegHold: vegHold, vegSlope: 0.30,
      });
      out.lerp(_rk, Math.min(0.94, bare));
      // talus apron: just below the steep bands the ground is loose scree
      const apron = smooth(0.10, 0.26, slope) * (1 - smooth(0.30, 0.48, slope)) * smooth(30, 90, y);
      out.lerp(C3_TALUS, apron * 0.42);
    } else {
      if (slope > 0.34) out.lerp(C3.granite, smooth(0.34, 0.62, slope));
      if (slope > 0.55) out.lerp(C3.graniteD, smooth(0.55, 0.9, slope) * 0.8);
    }
    // ---- SNOW: coverage, not a contour. Shallow slopes and shaded faces hold
    // it far lower than steep sunlit ones, and the edge is noise-feathered.
    let sn;
    if (CBZ.mtnSnowCover && CFG.MOUNT_SNOW_ASPECT_V1 !== false) {
      // CONCAVITY IS FREE HERE. v3Field's drainage already computed `carve`
      // (0 on an interfluve rim, 0.5 on the thalweg), so the couloir signal
      // costs nothing but a remap — and it is the SAME field that cut the
      // channels geometrically, so the white streaks land in the real gullies
      // instead of floating across them.
      sn = CBZ.mtnSnowCover(x, z, y, slope, faceLight, {
        line: snowY - 40, band: 74, aspect: 62, wob: 40,
        shed0: 0.20, shed1: 0.66, salt: 0x7e22,
        concave: fld.carve * 4 - 1, gully: 70, spine: 0.55,
        patch: 0.85, patchCell: 300,
      });
    } else {
      sn = smooth(snowY - 70, snowY, y + (wob - 0.5) * 44);
    }
    if (sn > 0) {
      _veg.copy(C3.snow).lerp(C3.snowSh, smooth(0.1, 0.5, slope));
      if (slope > 0.55) _veg.lerp(C3.graniteD, smooth(0.55, 0.88, slope));  // rock windows
      out.lerp(_veg, sn);
    }
    // gully AO: river carves and steep faces sit a touch darker (reads as
    // shadowed erosion cuts even under flat backdrop lighting)
    out.multiplyScalar(1 - fld.carve * 0.22 - slope * 0.06);
  }

  // ---- WILDNATURE ECOLOGY EXPORT — the tree scatter reads the SAME field:
  //      density follows moisture/valleys, fades to zero at the treeline,
  //      none above the snowline; stunt shortens trees near the treeline.
  const _ti = { dens: 0, stunt: 0, alt: 0, snow: false };
  CBZ.terrainTreeInfo = function (x, z) {
    if (CFG.TERRAIN_EROSION_V3 === false) return null;
    const f = v3Field(x, z, _fld);
    const d = distOutsideFlat(x, z);
    const fo = d <= MARGIN ? 0 : smooth(MARGIN, MARGIN + RAMP, d);
    const y = f.h > 0 ? f.h * fo : 0;    // == v3Height without re-evaluating
    const altFrac = clamp01(y / Math.max(1, f.snowY - 60));
    // low-frequency clearing mask: meadows/burns break the uniform blanket
    const clearing = smooth01((vn(x * 0.004 + SC2, z * 0.004 - SC2) - 0.30) / 0.28);
    let dens = (0.22 + 0.78 * f.moist) * clearing * (1 - smooth(0.72, 1.0, altFrac));
    if (y < 1) dens = 0;
    _ti.dens = dens;
    _ti.stunt = smooth(0.5, 0.95, altFrac);
    _ti.alt = altFrac;
    _ti.snow = y > f.snowY;
    return _ti;
  };

  // ---- ORACLE DISPATCH (flat contract byte-identical in every mode) -----
  CBZ.terrainHeight = function (x, z) {
    if (CBZ.PROC_TERRAIN === false) return 0;
    if (CFG.TERRAIN_EROSION_V3 !== false) return v3Height(x, z);
    if (CFG.TERRAIN_SOLID === false) return orig.height(x, z);
    return solidHeight2(x, z);
  };
  CBZ.terrainNormal = function (x, z, out) {
    out = out || new THREE.Vector3();
    const hL = CBZ.terrainHeight(x - _EPS, z), hR = CBZ.terrainHeight(x + _EPS, z);
    const hD = CBZ.terrainHeight(x, z - _EPS), hU = CBZ.terrainHeight(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  };
  // exposed for probes/tooling (mesh-exact samplers)
  CBZ.terrainVisualHeight = function (x, z) {
    if (CFG.TERRAIN_EROSION_V3 !== false) return v3Visual(x, z);
    return visualHeight2(x, z);
  };

  /* ======================================================================
     BUILDERS
  ====================================================================== */
  let _built = null;

  // ---- V3 BUILD — 4×4 relief tiles spanning the live world + the offshore
  //      ring, one talus boulder scatter at the range feet. 16 tile draws
  //      (frustum-culled per tile) + ≤3 InstancedMesh rock draws.
  function buildV3(root) {
    if (CBZ.syncTerrainFlat) CBZ.syncTerrainFlat(CBZ.city && CBZ.city.arena);
    layoutV3();
    initSeeds();
    // publish the FLAT-derived ring numbers for the closed-loop probes —
    // V3's relief band is a distance ring off the flat EDGE, so the derived
    // centre-based radii bound it from above (land can never reach relief).
    if (CBZ.terrainRingRadii) CBZ.TERRAIN_RING_DEBUG = CBZ.terrainRingRadii(FLAT);

    // span: the live world + ~1.7 km of sea/relief on every side (the ring
    // masks guarantee the field is back under the sea before the tile edge;
    // world.js's 16 km SEA_OVERHAUL ocean underlies the whole span).
    const liveSpan = Math.max(FLAT.maxX - FLAT.minX, FLAT.maxZ - FLAT.minZ);
    const SPAN = Math.ceil((liveSpan + 4400 + 2 * plateClear()) / 500) * 500;   // ring receded by the plate clearance must still fit inside the tile field
    const TILES = 4, TSPAN = SPAN / TILES;
    const TSEG = Math.max(24, Math.min(192, +CFG.TERRAIN_TILE_SEG || 76));
    const SMOOTH_SHADE = CFG.TERRAIN_SMOOTH_SHADE !== false;
    const terrMat = terrainShelfLandCutout(CBZ.terrainFogScale(new THREE.MeshLambertMaterial({
      // SMOOTH now: the walkable Mount Mercy / Greater Mercy meshes sitting
      // directly in front of this backdrop are smooth-shaded, so flat facets
      // here drew a hard style seam exactly where the two ranges meet. The
      // crispness the facets were buying is bought back by TERRAIN_TILE_SEG +
      // the adaptive axes below, which put real geometry where the facets
      // were only implying it.
      color: 0xffffff, vertexColors: true, flatShading: !SMOOTH_SHADE, fog: true,
      transparent: false, opacity: 1, depthTest: true, depthWrite: true,
    })));
    // Layered depth: this backdrop is the ring of headlands and ranges BEHIND
    // everything else, spanning ~1-8 km from the coast, so it is where the
    // reference's receding pale ridgelines have to happen. Gated to land above
    // 8 m — the seabed and the surf line inside these same tiles keep exactly
    // the colour the water pass gave them.
    CBZ.terrainAerial(terrMat, { start: 1100, full: 6400, minY: 8, maxY: 46, amount: 0.74 });
    const _c = new THREE.Color();
    const _nrm = new THREE.Vector3();
    const _lightDir = new THREE.Vector3(-0.36, 0.83, 0.43).normalize();
    const terrainTiles = [];
    // ---- ONE global adaptive axis, then sliced per tile -----------------
    // Adapting each tile INDEPENDENTLY would give neighbours different vertex
    // counts along their shared edge → T-junction cracks. Computing the axis
    // once over the whole span and slicing it means every tile boundary is a
    // shared sample, so the field is watertight while the CDF still puts the
    // grid lines on the relief sector and takes them off the open sea.
    const N = TILES * TSEG;
    const X0 = CX - SPAN / 2, X1 = CX + SPAN / 2;
    const Z0 = CZ - SPAN / 2, Z1 = CZ + SPAN / 2;
    let AX = null, AZ = null;
    // TERRAIN_DARK_RANGE: with no relief there is nothing for the CDF to
    // concentrate on — every weight is the floor, so the adaptive axis
    // degenerates to the uniform one the fallback below already builds, and
    // solving it would cost ~26k field evaluations to learn that. Tiles still
    // share their edge samples exactly (same TSEG both sides), so the seabed
    // stays watertight.
    if (CBZ.mtnAdaptiveAxis && CBZ.mtnGridGeometry && RANGE_ON()) {
      const PN = 36;
      AX = CBZ.mtnAdaptiveAxis(N, X0, X1, function (x) {
        let m = 0;
        for (let k = 0; k <= PN; k++) {
          const zz = Z0 + (Z1 - Z0) * (k / PN);
          const h = v3Height(x, zz); if (h > m) m = h;
        }
        return Math.pow(Math.min(1, m / 340), 0.65);
      }, { floor: 0.26 });
      AZ = CBZ.mtnAdaptiveAxis(N, Z0, Z1, function (z) {
        let m = 0;
        for (let k = 0; k <= PN; k++) {
          const xx = X0 + (X1 - X0) * (k / PN);
          const h = v3Height(xx, z); if (h > m) m = h;
        }
        return Math.pow(Math.min(1, m / 340), 0.65);
      }, { floor: 0.26 });
    }
    function axisSlice(A, t) {
      const out = new Float64Array(TSEG + 1);
      for (let k = 0; k <= TSEG; k++) out[k] = A[t * TSEG + k];
      return out;
    }
    for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) {
      const tcx = X0 + (ti + 0.5) * TSPAN;
      const tcz = Z0 + (tj + 0.5) * TSPAN;
      let geo;
      if (AX) {
        geo = CBZ.mtnGridGeometry(axisSlice(AX, ti), axisSlice(AZ, tj));   // world-space verts
      } else {
        geo = new THREE.PlaneGeometry(TSPAN, TSPAN, TSEG, TSEG);
        geo.rotateX(-Math.PI / 2);
        geo.translate(tcx, 0, tcz);
      }
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, v3Visual(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;
      // Indexed + smooth normals (SMOOTH_SHADE) or de-indexed per-face facets.
      const outGeo = SMOOTH_SHADE ? geo : geo.toNonIndexed();
      outGeo.computeVertexNormals();
      const fp = outGeo.attributes.position;
      const fn = outGeo.attributes.normal;
      const fcolors = new Float32Array(fp.count * 3);
      for (let i = 0; i < fp.count; i++) {
        const vx = fp.getX(i), vz = fp.getZ(i);
        const y = fp.getY(i);
        const ny = Math.min(1, Math.max(0, fn.getY(i)));
        const slope = 1 - ny;
        // aspect: which way the face turns relative to the sun. This is what
        // moves the snowline and warms/cools the rock — the old ramp computed
        // nothing of the sort and read every face identically.
        _nrm.set(fn.getX(i), fn.getY(i), fn.getZ(i));
        const faceLight = Math.max(0, _nrm.dot(_lightDir));
        const fld = v3Field(vx, vz, _fld);
        const wob = vn(vx * 0.012 + SW, vz * 0.012 - SW);
        bandColor3(vx, vz, y, slope, faceLight, wob, fld, _c);
        // bake the aspect into the vertex value too, so a smooth-shaded face
        // still reads its own light direction under the flat backdrop lighting
        const shade = 0.86 + faceLight * 0.20;
        fcolors[i * 3] = _c.r * shade; fcolors[i * 3 + 1] = _c.g * shade; fcolors[i * 3 + 2] = _c.b * shade;
      }
      outGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
      if (outGeo !== geo) geo.dispose();
      outGeo.computeBoundingSphere();
      const tile = new THREE.Mesh(outGeo, terrMat);
      tile.position.y = -0.06;             // city ground always wins the flat depth fight
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.matrixAutoUpdate = false; tile.updateMatrix();
      tile.userData.terrain = true;        // batch + farcull exempt
      tile.userData.terrainBackdropTile = true;
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];

    // ---- TALUS — fractured boulders at the mountain feet (rockscliffs'
    //      slope-aware scatter; angle-of-repose keeps them off cliff faces,
    //      the height window keeps them in the apron/gully zone where real
    //      rockfall collects). Sits exactly on the mesh (visual samplers).
    const heroMeshes = [];
    // TERRAIN_DARK_RANGE: talus is what collects at the FOOT of a cliff. With
    // the range removed `pick` could only ever fail its own h >= 14 window and
    // return null 90 times over; not asking is the same world for less work.
    if (CBZ.scatterRocks && RANGE_ON()) {
      const band0 = MARGIN + 220, band1 = MARGIN + 1500;
      const scat = CBZ.scatterRocks(root, {
        count: 90,
        pick: function (rng) {
          for (let tries = 0; tries < 14; tries++) {
            // sample a ring position: pick a side by weight-ish area, then a
            // distance within the talus band
            const a = rng() * Math.PI * 2;
            const d = band0 + rng() * (band1 - band0);
            // project the angle onto the flat rect's outside ring
            const px = CX + Math.cos(a) * ((FLAT.maxX - FLAT.minX) / 2 + d);
            const pz = CZ + Math.sin(a) * ((FLAT.maxZ - FLAT.minZ) / 2 + d);
            const h = CBZ.terrainHeight(px, pz);
            if (h < 14 || h > 320) continue;        // apron/gully window only
            return { x: px, z: pz };
          }
          return null;
        },
        heightAt: v3Visual,                // rocks sit on the MESH, exactly
        normalAt: v3VisualNormal,
        repeatAngleDeg: 38,
        minSize: 3, maxSize: 9,
        baseRadius: 1, detail: 1,
        variants: 3,
        colorHex: 0x5f5b54,                // the shared granite hue
        seed: 4242,
        // Placement is UNCHANGED (same pick, same seed, same rng draw order —
        // these options consume no rng). They only change how each instance
        // SITS: wedged into the apron slope instead of standing world-up, with
        // plate-ish proportions and position-hashed size variation. Zero extra
        // draw calls.
        alignToSlope: 0.7, flatten: 0.28, bury: 0.30, hashVary: true,
        rockTune: { scrapes: 11, depthMin: 0.06, depthMax: 0.38, squashY: 0.82 },
        tag: "backdrop-talus",
      });
      if (scat && scat.meshes) for (const m of scat.meshes) heroMeshes.push(m);
    }

    // ---- perf/quality tier gate (tiers 0-1: hide scatter, drop shadow rx)
    function applyTerrainTier() {
      const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
      const showBackdrop = q >= 2;
      for (const m of heroMeshes) m.visible = showBackdrop;
      const recv = q >= 2;
      if (terrMat.userData._recv !== recv) {
        terrMat.userData._recv = recv;
        for (const t of terrainTiles) t.receiveShadow = recv;
        terrMat.needsUpdate = true;
      }
    }
    if (CBZ.onQualityChange) CBZ.onQualityChange(applyTerrainTier);

    return terrain;
  }

  // ---- V2 BUILD — the previous solid-mountain build, preserved ----------
  function buildV2(root) {
    if (CBZ.syncTerrainFlat) CBZ.syncTerrainFlat(CBZ.city && CBZ.city.arena);
    layoutRanges2();
    if (CBZ.terrainRingRadii) CBZ.TERRAIN_RING_DEBUG = CBZ.terrainRingRadii(FLAT);
    const liveSpan = Math.max(FLAT.maxX - FLAT.minX, FLAT.maxZ - FLAT.minZ) + 1500;
    const SPAN = Math.max(6000, Math.ceil(liveSpan / 500) * 500);
    const TILES = 4, TSPAN = SPAN / TILES, TSEG = 76;
    const terrMat = terrainShelfLandCutout(CBZ.terrainFogScale(new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, fog: true,
      transparent: false, opacity: 1, depthTest: true, depthWrite: true,
    }), 0.16));
    const _c = new THREE.Color();
    const terrainTiles = [];
    for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) {
      const tcx = CX - SPAN / 2 + (ti + 0.5) * TSPAN;
      const tcz = CZ - SPAN / 2 + (tj + 0.5) * TSPAN;
      const geo = new THREE.PlaneGeometry(TSPAN, TSPAN, TSEG, TSEG);
      geo.rotateX(-Math.PI / 2);
      geo.translate(tcx, 0, tcz);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, visualHeight2(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;
      const flatGeo = geo.toNonIndexed();
      flatGeo.computeVertexNormals();
      const fp = flatGeo.attributes.position;
      const fn = flatGeo.attributes.normal;
      const fcolors = new Float32Array(fp.count * 3);
      for (let i = 0; i < fp.count; i++) {
        const y = fp.getY(i);
        const slope = 1 - Math.min(1, Math.max(0, fn.getY(i)));
        const wob = vn(fp.getX(i) * 0.012 + SO1, fp.getZ(i) * 0.012 - SO1);
        bandColor2(y, slope, wob, _c);
        fcolors[i * 3] = _c.r; fcolors[i * 3 + 1] = _c.g; fcolors[i * 3 + 2] = _c.b;
      }
      flatGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
      geo.dispose();
      flatGeo.computeBoundingSphere();
      const tile = new THREE.Mesh(flatGeo, terrMat);
      tile.position.y = -0.06;
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.matrixAutoUpdate = false; tile.updateMatrix();
      tile.userData.terrain = true;
      tile.userData.terrainBackdropTile = true;
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];

    const heroMeshes = [];
    if (CBZ.scatterRocks && RANGE_ON()) {          // TERRAIN_DARK_RANGE — no range, no talus
      const scat = CBZ.scatterRocks(root, {
        count: 90,
        pick: function (rng) {
          for (let tries = 0; tries < 12; tries++) {
            const x = FLAT.minX - 180 + rng() * ((FLAT.maxX - FLAT.minX) + 360);
            const z = FLAT.minZ - 240 - rng() * 1080;
            if (rangeMask2(x, z) < 0.08) continue;
            if (CBZ.terrainHeight(x, z) < 25) continue;
            return { x, z };
          }
          return null;
        },
        heightAt: visualHeight2,
        normalAt: visualNormal2,
        repeatAngleDeg: 38,
        minSize: 3, maxSize: 9,
        baseRadius: 1, detail: 1,
        variants: 3,
        colorHex: 0x716b60,
        seed: 4242,
      });
      if (scat && scat.meshes) for (const m of scat.meshes) heroMeshes.push(m);
    }

    function applyTerrainTier() {
      const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
      const showBackdrop = q >= 2;
      for (const m of heroMeshes) m.visible = showBackdrop;
      const recv = q >= 2;
      if (terrMat.userData._recv !== recv) {
        terrMat.userData._recv = recv;
        for (const t of terrainTiles) t.receiveShadow = recv;
        terrMat.needsUpdate = true;
      }
    }
    if (CBZ.onQualityChange) CBZ.onQualityChange(applyTerrainTier);
    return terrain;
  }

  CBZ.buildTerrain = function (parent) {
    if (CBZ.PROC_TERRAIN === false) return null;
    if (CFG.TERRAIN_EROSION_V3 === false && CFG.TERRAIN_SOLID === false) return orig.build(parent);
    if (_built) return _built;
    const root = parent || CBZ.scene;
    if (!root) return null;
    _built = CFG.TERRAIN_EROSION_V3 !== false ? buildV3(root) : buildV2(root);
    return _built;
  };

  // Render-ownership probe for the orchestrator. The physics-facing height
  // oracle is intentionally flat over this visual shelf, so backdropAudit()
  // cannot detect whether its material still owns dry-land pixels.
  CBZ.terrainShelfAudit = function () {
    syncShelfLandMask();
    let tiles = 0, protectedTiles = 0;
    const root = CBZ.city && CBZ.city.root;
    if (root && root.traverse) root.traverse(function (o) {
      if (!o.isMesh || !o.userData || !o.userData.terrainBackdropTile) return;
      tiles++;
      const m = o.material;
      if (m && m.userData && m.userData._cbzShelfLandCutout) protectedTiles++;
    });
    return {
      tiles: tiles,
      protectedTiles: protectedTiles,
      maskReady: !!_shelfLandMaskU.value,
      unprotected: CFG.TERRAIN_SHELF_LAND_CUTOUT === false ? 0 : (tiles - protectedTiles),
    };
  };

  // ---- CALL SITE — nothing ever invoked buildTerrain (the index.html
  //      comment promised world.js would; it never did). Register as a
  //      landmass builder so cityWorldGeo runs it: order 98 = after the
  //      continent (97) registers the Backcountry underlay region (so
  //      syncTerrainFlat sees the FINAL live world bounds), before
  //      wildnature (99) forests the relief. worldmap.js loads after this
  //      file, so pre-seed the registry array it merges with.
  CBZ._landmassBuilders = CBZ._landmassBuilders || [];
  CBZ._landmassBuilders.push({
    fn: function (city) { CBZ.buildTerrain(city && city.root); },
    order: 98,
  });
})();
