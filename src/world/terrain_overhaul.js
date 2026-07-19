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

     WHERE THE RELIEF LIVES: the live playable world (city + islands +
     biomes + countries + the continent's driveable Backcountry) is a ~7 km
     plate whose union AABB is synced into FLAT at build time. The oracle is
     EXACTLY 0 over FLAT + MARGIN — byte-identical physics contract — and
     relief exists only OFFSHORE, beyond the continent's own carved coast,
     rising out of the real animated sea (world.js SEA_OVERHAUL spans 16 km,
     so every range stands in true water). North (behind the snow country's
     real Greater Mercy Range) carries the grand ranges + the two signature
     giants — layered depth: white reachable alpine range in front, huge
     hazy eroded titans behind. West/east get lower coastal ranges; south a
     low archipelago. The physics floor NEVER reads this field (mode.js
     groundHeightAt only consults registered providers), so nothing here can
     ever be walked on — pure skyline geography.

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

   Perf: 4×4 tiles at 76 segs ≈ 185k tris / 16 draws + one 90-boulder talus
   scatter (≤3 InstancedMesh draws). Oracle is analytic + allocation-free.
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
  function distOutsideFlat(x, z) {
    const dx = Math.max(FLAT.minX - x, 0, x - FLAT.maxX);
    const dz = Math.max(FLAT.minZ - z, 0, z - FLAT.maxZ);
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
  // Snow-country footprint (biome_snow.js: rect centre (350,-1450), half (420,330)).
  // The backdrop range is confined to this X-span so it stands only behind the
  // white country (owner: mountains snow-only).
  // Follows the snow biome's world-layout offset (world/layout.js) so a
  // stage-2 biome move keeps the mountain range standing behind the white
  // country instead of behind its old empty spot.
  const _SNOWOFF = (CBZ.worldOff && CBZ.worldOff("snow")) || { dx: 0, dz: 0 };
  const SNOW_CX = 350 + _SNOWOFF.dx, SNOW_HX = 420;
  const SNOW_ONLY = () => CFG.TERRAIN_SNOW_ONLY_RANGES !== false;
  // 1 inside the snow country's X-span (feathered), 0 beyond.
  function snowWindowX(x) {
    const f = 240;
    return smooth(SNOW_CX - SNOW_HX - f, SNOW_CX - SNOW_HX, x) *
      (1 - smooth(SNOW_CX + SNOW_HX, SNOW_CX + SNOW_HX + f, x));
  }
  let RANGE_WEST_X = CX - 850;
  let RANGE_EAST_X = CX + 1050;
  const HEROES2 = [
    { name: "Mount Colossus", x: RANGE_WEST_X, z: FLAT.minZ - 720, amp: 650, sig: 260, ns: 0.006 },
    { name: "Mount Everest", x: RANGE_EAST_X, z: FLAT.minZ - 820, amp: 900, sig: 350, ns: 0.0048 },
  ];
  function layoutRanges2() {
    CX = (FLAT.minX + FLAT.maxX) / 2;
    CZ = (FLAT.minZ + FLAT.maxZ) / 2;
    const width = FLAT.maxX - FLAT.minX;
    if (SNOW_ONLY()) {
      // Both signature giants stand INSIDE the snow country's X-span so the two
      // hero bumps (and their gaussian tails) never bleed over non-snow biomes.
      RANGE_WEST_X = SNOW_CX - SNOW_HX * 0.5;   // ~140
      RANGE_EAST_X = SNOW_CX + SNOW_HX * 0.5;   // ~560
    } else {
      RANGE_WEST_X = CX - Math.min(980, width * 0.2);
      RANGE_EAST_X = CX + Math.min(1180, width * 0.24);
    }
    HEROES2[0].x = RANGE_WEST_X; HEROES2[0].z = FLAT.minZ - 720;
    HEROES2[1].x = RANGE_EAST_X; HEROES2[1].z = FLAT.minZ - 820;
    CBZ.MOUNT_COLOSSUS = { name: HEROES2[0].name, x: HEROES2[0].x, z: HEROES2[0].z, height: HEROES2[0].amp };
    CBZ.MOUNT_EVEREST = { name: HEROES2[1].name, x: HEROES2[1].x, z: HEROES2[1].z, height: HEROES2[1].amp };
  }
  layoutRanges2();
  function heroBump2(x, z, P) {
    const dx = x - P.x, dz = z - P.z;
    const g = Math.exp(-(dx * dx + dz * dz) / (2 * P.sig * P.sig));
    if (g < 1e-3) return 0;
    const crag = 0.55 + 0.45 * rfbm(x * P.ns + SO1, z * P.ns - SO2);
    return P.amp * g * crag;
  }
  function bell(x, centre, sigma) {
    const q = (x - centre) / sigma;
    return Math.exp(-0.5 * q * q);
  }
  function rangeMask2(x, z) {
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
    let hero = 0;
    for (let i = 0; i < HEROES2.length; i++) hero += heroBump2(x, z, HEROES2[i]);
    if (SNOW_ONLY()) hero *= snowWindowX(x);   // giants stay behind the white country
    if (range <= 0 && hero <= 0.01) return 0;
    const north = Math.max(0, FLAT.minZ - z);
    const outer = 1 - smooth(1450, 1950, north);
    if (outer <= 0) return 0;
    const hills = Math.max(0, 18 + fbm2(x, z) * 0.72) * range;
    const mtn = ridged2(x, z) * range;
    return Math.max(0, hills + mtn + hero) * outer;
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
  CBZ.terrainFogScale = function (mat, scale) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uFogScale = { value: scale == null ? FOG_SCALE : scale };
      sh.vertexShader = "uniform float uFogScale;\n" + sh.vertexShader
        .replace("#include <fog_vertex>",
          "#include <fog_vertex>\n#ifdef USE_FOG\n\tfogDepth *= uFogScale;\n#endif");
    };
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
    SHELF_MIN: -26,            // visual seabed clamp (never a yawning trench)
  };

  // ---- WHERE the ranges stand: an offshore ring around the live world.
  //      ringIn starts past the flat margin (the contract zone stays a calm
  //      shelf), ringOut sinks every range's far side back under the sea —
  //      solid closed backs from any aircraft angle, no walls, no shells.
  function ringMask(d) {
    return smooth(MARGIN + 60, MARGIN + 560, d) * (1 - smooth(MARGIN + 1300, MARGIN + 1900, d));
  }
  // side weights: the grand ranges live NORTH (layered behind the snow
  //      country's real white Greater Mercy Range); west/east get lower
  //      coastal ranges; south a low archipelago. Blended by each side's
  //      excess so corners transition smoothly.
  const SIDE_N = 1.0, SIDE_W = 0.68, SIDE_E = 0.68, SIDE_S = 0.40;
  function sideWeight(x, z) {
    const eW = Math.max(0, FLAT.minX - x), eE = Math.max(0, x - FLAT.maxX);
    const eN = Math.max(0, FLAT.minZ - z), eS = Math.max(0, z - FLAT.maxZ);
    const sum = eW + eE + eN + eS;
    if (sum <= 1e-6) return 0;
    return (eW * SIDE_W + eE * SIDE_E + eN * SIDE_N + eS * SIDE_S) / sum;
  }

  // ---- the two signature giants: ALTITUDE bumps (not surface bumps) — fed
  //      through the same erosion/rivers/shaping as everything else, so the
  //      titans erode like real geology instead of sitting on it. Laid out
  //      from the LIVE flat bounds at build time (countries/continent regs).
  const HEROES3 = [
    { name: "Mount Colossus", x: 0, z: 0, amp: 0.78, sig: 470 },
    { name: "Mount Everest", x: 0, z: 0, amp: 1.25, sig: 680 },
  ];
  function layoutV3() {
    CX = (FLAT.minX + FLAT.maxX) / 2;
    CZ = (FLAT.minZ + FLAT.maxZ) / 2;
    HEROES3[0].x = CX - 1250; HEROES3[0].z = FLAT.minZ - 780;
    HEROES3[1].x = CX + 950;  HEROES3[1].z = FLAT.minZ - 1150;
    // exported peak info (crest heights measured from the shaped field —
    // ±10% by seed since the fbm crest rides on the altitude bump)
    CBZ.MOUNT_COLOSSUS = { name: HEROES3[0].name, x: HEROES3[0].x, z: HEROES3[0].z, height: 950 };
    CBZ.MOUNT_EVEREST = { name: HEROES3[1].name, x: HEROES3[1].x, z: HEROES3[1].z, height: 1250 };
  }
  if (CFG.TERRAIN_EROSION_V3 !== false) layoutV3();
  function heroAlt(x, z) {
    let a = 0;
    for (let i = 0; i < 2; i++) {
      const P = HEROES3[i];
      const dx = x - P.x, dz = z - P.z;
      const q = (dx * dx + dz * dz) / (2 * P.sig * P.sig);
      if (q < 9) a += P.amp * Math.exp(-q);
    }
    return a;
  }

  // ---- THE FIELD — the reference pipeline, one evaluation ----------------
  // Returns world height h (signed: <0 = under the sea shelf) plus the
  // intermediate fields the color ramp / vegetation ecology reuse.
  const _fld = { h: 0, carve: 0, altN: 0, moist: 0, snowY: 260 };
  function v3Field(x, z, out) {
    out = out || _fld;
    if (!initSeeds()) { out.h = 0; out.carve = 0; out.altN = 0; out.moist = 0; out.snowY = 260; return out; }

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

    // regional altitude: biome noise + the offshore ring + the two giants.
    // The giants locally override the regional noise (a titan is not allowed
    // to be talled-down by an unlucky biome sample at its own summit).
    const d = distOutsideFlat(x, z);
    const ring = ringMask(d);
    const biomeA = fbm01(x, z, SM, V3P.B_FREQ) * 1.4 - 0.75;   // ∈ [-0.75, 0.65]
    const hero = heroAlt(x, z);
    const altShape = ring * (V3P.ALT_RING * sideWeight(x, z) + hero);
    const alt = V3P.ALT_BASE + biomeA * 0.7 * (1 - Math.min(0.75, hero)) + altShape;
    t = t + alt;

    // smoothLowerPlanes: signed-square vs cube (flat calm lowlands/shelf,
    // exaggerated peaks)
    t = lerp(t * Math.abs(t), t * t * t, V3P.SMOOTH_LOWER);

    // subtract the rivers, scale to world units
    const carve = r;                       // 0..0.5 (0.5 = full channel)
    t = t - carve * V3P.RIVERS;
    const h = t * V3P.AMP;

    // snowline: wobbled band, dropping toward the cold north — giants cap
    // deep white (harmonizing with the snow country), side crests only dust
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
  // visual: sinks under the sea over the flat interior (plate/city/sea own
  // the view there), eases through the shelf, meets the oracle as fo→1.
  function v3Visual(x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return -1.8;
    const fo = smooth(MARGIN, MARGIN + RAMP, d);
    if (fo <= 0) return -1.8;
    const h = v3Field(x, z, _fld).h;
    const v = lerp(-1.8, h, fo);
    return v < V3P.SHELF_MIN ? V3P.SHELF_MIN : v;
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
    dry: new THREE.Color(0x707252), moistV: new THREE.Color(0x4b6a49),
    forest: new THREE.Color(0x374f3a),
    granite: new THREE.Color(0x5f5b54), graniteD: new THREE.Color(0x293033),
    snow: new THREE.Color(0xf8fafb), snowSh: new THREE.Color(0xd4dfe2),
  };
  const _veg = new THREE.Color();
  function bandColor3(y, slope, wob, fld, out) {
    const snowY = fld.snowY;
    if (y < -0.6) {                                     // the sea shelf
      out.copy(C3.deep).lerp(C3.shallow, smooth(-20, -0.6, y));
      return;
    }
    if (y < 2.6) {                                      // shoreline sand
      out.copy(C3.shallow).lerp(C3.sand, smooth(-0.6, 1.6, y));
      return;
    }
    // vegetation base: dry↔moist by the moisture field, deepening to forest
    _veg.copy(C3.dry).lerp(C3.moistV, fld.moist);
    _veg.lerp(C3.forest, smooth(24, 170, y) * (0.35 + fld.moist * 0.5));
    out.copy(C3.sand).lerp(_veg, smooth(2.6, 12, y));
    // slope exposes granite (stronger with steepness, full on cliffs)
    if (slope > 0.34) out.lerp(C3.granite, smooth(0.34, 0.62, slope));
    if (slope > 0.55) out.lerp(C3.graniteD, smooth(0.55, 0.9, slope) * 0.8);
    // ragged snowline band (wobble breaks the contour), then snow country
    const sn = smooth(snowY - 70, snowY, y + (wob - 0.5) * 44);
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
    const SPAN = Math.ceil((liveSpan + 4400) / 500) * 500;
    const TILES = 4, TSPAN = SPAN / TILES, TSEG = 76;
    const terrMat = CBZ.terrainFogScale(new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, fog: true,
      transparent: false, opacity: 1, depthTest: true, depthWrite: true,
    }));
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
        pos.setY(i, v3Visual(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;
      // flat-shaded crisp facets: de-index, per-face normals
      const flatGeo = geo.toNonIndexed();
      flatGeo.computeVertexNormals();
      const fp = flatGeo.attributes.position;
      const fn = flatGeo.attributes.normal;
      const fcolors = new Float32Array(fp.count * 3);
      for (let i = 0; i < fp.count; i++) {
        const vx = fp.getX(i), vz = fp.getZ(i);
        const y = fp.getY(i);
        const slope = 1 - Math.min(1, Math.max(0, fn.getY(i)));
        const fld = v3Field(vx, vz, _fld);
        const wob = vn(vx * 0.012 + SW, vz * 0.012 - SW);
        bandColor3(y, slope, wob, fld, _c);
        fcolors[i * 3] = _c.r; fcolors[i * 3 + 1] = _c.g; fcolors[i * 3 + 2] = _c.b;
      }
      flatGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
      geo.dispose();
      flatGeo.computeBoundingSphere();
      const tile = new THREE.Mesh(flatGeo, terrMat);
      tile.position.y = -0.06;             // city ground always wins the flat depth fight
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.matrixAutoUpdate = false; tile.updateMatrix();
      tile.userData.terrain = true;        // batch + farcull exempt
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];

    // ---- TALUS — fractured boulders at the mountain feet (rockscliffs'
    //      slope-aware scatter; angle-of-repose keeps them off cliff faces,
    //      the height window keeps them in the apron/gully zone where real
    //      rockfall collects). Sits exactly on the mesh (visual samplers).
    const heroMeshes = [];
    if (CBZ.scatterRocks) {
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
    const terrMat = CBZ.terrainFogScale(new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, fog: true,
      transparent: false, opacity: 1, depthTest: true, depthWrite: true,
    }), 0.16);
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
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];

    const heroMeshes = [];
    if (CBZ.scatterRocks) {
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
