/* ============================================================
   city/biome_snow.js — THE SNOWY MOUNTAIN RANGE biome.

   An archipelago landmass module (see worldmap.js CONTRACT). Builds a
   snowy valley rising into one REAL northern massif. The mountain mesh and
   city floor oracle share the same analytic height function, so the slopes
   can be walked, landed on and used by physics — no decorative skyline ring.
   A
   frozen LAKE (icy plane), instanced snowy PINES, rocky outcrops and
   snowdrifts fill it; the WHY-justified landmarks are a cozy enterable SKI
   LODGE (fireplace), a moving CHAIRLIFT up a slope, a slalom SKI RUN, a
   low mountain cabin. A winding causeway connects the
   south edge down toward the speedway island.

   REAL GEOLOGY (MOUNT_EROSION_V4, world/mountain_detail.js): both massifs
   were hand-placed Gaussian lobes soft-maxed together under a light ridged-fbm
   "crag" multiplier — no drainage, no bedding, no cirques, no talus. They now
   run the shared erosion stack (domain-warped ridged multifractal crests,
   derivative-damped fbm, branching V-valleys, cirque headwalls, warped strata
   benches, talus aprons) over the SAME authored summits, and are shaded from
   the same bedding field so the colour bands sit on the geometric risers.
   Snow is a real coverage model (slope + sun aspect + noise), not an altitude
   contour. Meshes are denser and ADAPTIVE: a CDF over each mountain's own
   height profile spends the grid lines on summits and cliffs instead of the
   flat lake/resort valley. Both mountains keep ONE function feeding the mesh
   AND CBZ.registerCityGroundHeight, via a shared bilinear memo — mesh and
   collision cannot fork.

   DRAW-CALL DISCIPLINE: pines / rocks / drifts / lift-chairs / guardrail
   posts are InstancedMesh (one draw call each); the massif is one mesh.
   Bright point-sprite snowfall is disabled: from aircraft it read as dots
   stuck to the HUD. Everything is deterministic from a local seeded rng.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const CFGS = (CBZ.CONFIG = CBZ.CONFIG || {});
  // SOLID rim ranges: the old buildRidgedRange sheets hang their back edge
  // ~25% peak height in MID-AIR (hollow shells from the air). The solid
  // path builds closed "massif pads" whose height envelope reaches the
  // ground on every border. Revert: CBZ.CONFIG.SNOW_SOLID_RANGE = false.
  if (CFGS.SNOW_SOLID_RANGE == null) CFGS.SNOW_SOLID_RANGE = true;
  if (CFGS.SNOWFALL_POINTS == null) CFGS.SNOWFALL_POINTS = false;
  // V2 replaces the separate flat snow plane + mountain "pad" with one
  // continuous heightfield.  The same function feeds vertices, props,
  // player collision and snowboard physics.  Keep the old massif behind a
  // flag so a low-end/debug build can still compare the previous path.
  if (CFGS.SNOW_TERRAIN_V2 == null) CFGS.SNOW_TERRAIN_V2 = true;

  // ---- footprint (per spec): authored rect center (350,-1450), half (420,330)
  // Anchored through the world-layout dial (world/layout.js). The dial is
  // UN-PINNED: the biome's interior is authored in the STAGE-1 frame (every
  // peak/piste/lake/lodge/lift/town literal below), builders add (DX,DZ) to
  // each authored anchor, and the exported oracles map world → authored at
  // entry — so the interior math is byte-identical at zero offset and the
  // snow island translates RIGIDLY wherever the dial sends it (owner:
  // mountains on the snow island, very far from everything else).
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("snow")) || { dx: 0, dz: 0 };
  const DX = _WOFF.dx, DZ = _WOFF.dz;
  // WORLD_LAYOUT_V2 (world/layout.js owns the flag; this only mirrors the
  // default for a build without it). Consumed once, at the Pinecrest seed.
  if (CFGS.WORLD_LAYOUT_V2 == null) CFGS.WORLD_LAYOUT_V2 = true;
  const LAYOUT_V2 = function () { return CFGS.WORLD_LAYOUT_V2 !== false; };
  // The half-extents come from world/layout.js (CBZ.worldFoot), which owns the
  // authored anchor, the dial AND the stage-4 footprint scale. This biome is
  // the one that had a hand-copy living somewhere else: terrain_overhaul.js
  // re-typed `SNOW_CX = 350 + dx, SNOW_HX = 420, SNOW_NZ = -1780 + dz` to aim
  // the whole backdrop range, and that copy would have gone stale the moment
  // the snow country scaled — the mountains would stand behind a country that
  // had grown out from under them. It reads the same published rect now.
  //
  // SNOW TAKES THE SMALLEST SCALE IN THE WORLD (1.30) on purpose: every peak,
  // piste knuckle, lift line and lodge pad in Mount Mercy is an authored
  // literal in the stage-1 frame, so growing this rect grows the WHITE COUNTRY
  // around a fixed massif — which is what we want (more snowfield, same
  // mountain) but is not something to be greedy with. It also drags the
  // Greater Mercy envelope, whose south edge IS this rect's north edge.
  const _SFOOT = (CBZ.worldFoot && CBZ.worldFoot("snow")) ||
    { cx: 350 + DX, cz: -1450 + DZ, hx: 420, hz: 330 };
  const CX = _SFOOT.cx, CZ = _SFOOT.cz, HX = _SFOOT.hx, HZ = _SFOOT.hz;
  const FSC = (CBZ.worldFootScale && CBZ.worldFootScale("snow")) || 1;   // linear footprint scale
  const MINX = CX - HX, MAXX = CX + HX;     // world (authored -70 .. 770)
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;     // world (authored -1780 .. -1120)
  const A_MINX = MINX - DX, A_MAXX = MAXX - DX;   // authored-frame bounds
  const A_MINZ = MINZ - DZ, A_MAXZ = MAXZ - DZ;
  // Mercy Causeway south terminus. The lane (x 458..482) runs from the snow
  // shore toward the speedway; when the speedway's own annex causeway
  // (island_speedway.js: horizontal leg at ACCESS_Z, x 336..ACCESS_X+12)
  // has slid east across the lane (stage-2 dial), the lane ends BUTTED on
  // that leg's north edge and hands traffic to it — two decks at one level
  // must join, not overlap. Compact world (leg west of the lane): authored
  // -530, byte-identical.
  const _SPOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };
  const _SP_ACCESS_X = (490 + _SPOFF.dx) - 98, _SP_ACCESS_Z = (-350 + _SPOFF.dz) - 190;
  const CAUSEWAY_HANDOFF_Z = (_SP_ACCESS_X + 12 > 458 + _WOFF.dx) ? (_SP_ACCESS_Z - 12) : -530;

  // THE LANE, IN ONE PLACE. The deck, the berms, the reserve rect, the region
  // record, the road record and the island-clearance test below all need the
  // same x-span, and four of them used to retype it. `HW` is the DECK half
  // width (buildHighway width 24); `OUTER_HW` includes the snow berms, whose
  // outer faces sit at ±13.2 ± 1.1 — that is the widest thing the corridor
  // actually puts on the ground and therefore the thing that has to clear.
  const CW_CX = 470 + DX, CW_HW = 12, CW_OUTER_HW = 14.3;

  /* ==========================================================================
     THE CAUSEWAY DRIVES THROUGH A CITY, AND IT ALWAYS HAS.

     MEASURED, not assumed. With the shipped dials (snow dx 0, speedway dx 400)
     the hand-off above resolves to z = -552, so the deck runs from the snow
     shore (MAXZ = -2620) south to -552 at x 458..482, berms 455.7..484.3.

     The Commerce Annex — city/expansion.js — is a 120 m disc at
     (city.maxX + 215, city.center.z) = (380, -700) with a 14 m sand ring, so
     it occupies x 246..514, z -834..-566. At the deck's WEST edge (455.7) the
     island's half-chord in z is sqrt(134^2 - 75.7^2) = 110.4, i.e. the island
     spans z -810.4..-589.6 right where the lane is. The lane's z-span covers
     that whole interval, so ~200 m of 24 m concrete deck and white snow berms
     at y 0..0.6 lie across the island's east side, over its street grid, with
     island ground at y 0 and island asphalt at y 0.05. That z-fight is the
     owner's "ghost city next to the real city".

     It is NOT a regression from the world re-lay — it has been true since this
     lane was first derived from the speedway — and it escaped every clearance
     rule in the game twice over: the deck is raw GEOMETRY (roadrules.js only
     clamps `city.roads` records) and the name "Mercy Causeway" matches its
     CONNECTOR exemption. The annex was also missing from `city.regions`
     entirely until expansion.js registered it, so nothing could even SEE it.

     THE ISLAND CANNOT DODGE. West of the lane is the mainland's harbour bay
     ring; east is the Ironjaw Arena, whose region is a 120 m disc at
     (640, -950) with pad 6 — its west edge is x 514 and the annex's sand ring
     ends at x 514. There is literally a zero-metre gap. So the CORRIDOR moves,
     and the only move available is to stop short.

     WHAT THIS DOES. The deck now TERMINATES at the island's north shore, which
     is roadrules.js's own DESTINATION RULE: a road is allowed to reach where it
     is going. The alpine causeway lands ON the Commerce Annex instead of
     driving over it, and the Ironjaw Arena's approach causeway (x 482..527 at
     z -950) is 130 m NORTH of the new terminus, so the arena keeps its link to
     the mountain. WHAT IS LOST, stated plainly: the butt-joint onto the
     speedway's annex leg at z -540. That leg runs east-west 26 m off the
     island's south beach across its whole width, so the through-route is the
     annex's own street grid — and building that link belongs in expansion.js,
     not here.

     DERIVED, NEVER TYPED. The cut is computed from `city.annex`'s published
     cx/cz/radius at BUILD time (expansion.js runs inside buildCity, before
     cityWorldGeo runs any landmass builder, so the record exists). A
     hard-coded z is exactly what produced this bug. No rng, no Math.random,
     idempotent — a rebuild recomputes the same number.
     ========================================================================== */
  const ANNEX_SAND = 14;      // expansion.js's beach ring (terrainFlattenUnder R+14)
  const ANNEX_MARGIN = 8;     // shoulder between the deck's end and the sand
  function causewayCut(city) {
    const A = city && city.annex;
    if (!A || A.radius == null || A.cx == null || A.cz == null) return CAUSEWAY_HANDOFF_Z;
    // The first part of the corridor that would touch the island is whichever
    // berm edge is nearest its centre — not the centreline.
    const x0 = CW_CX - CW_OUTER_HW, x1 = CW_CX + CW_OUTER_HW;
    const dx = A.cx < x0 ? (x0 - A.cx) : (A.cx > x1 ? (A.cx - x1) : 0);
    const RR = A.radius + ANNEX_SAND + ANNEX_MARGIN;
    if (dx >= RR) return CAUSEWAY_HANDOFF_Z;          // the lane misses it entirely
    const dz = Math.sqrt(RR * RR - dx * dx);
    // south is +z here (the snow shore is the most negative), so "stop north
    // of the island" is the SMALLER z of the two.
    return Math.min(CAUSEWAY_HANDOFF_Z, A.cz - dz);
  }
  // Re-derived at the top of the landmass builder; the parse-time value is the
  // degrade-safe fallback for a build with no annex at all.
  let CAUSEWAY_MAXZ = CAUSEWAY_HANDOFF_Z;
  // Buildings are laid out before landmass builders run.  Keep a per-build
  // list of their occupied footprints so the terrain oracle can grade a real
  // shelf beneath them instead of letting a later mountain grow through a
  // tower.  This is terrain shaping, not a second collision/floor system.
  const SNOW_BUILDING_CLEARINGS = [];
  const GREAT_BUILDING_CLEARINGS = [];

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function smooth01(v) { v = clamp01(v); return v * v * (3 - 2 * v); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function noiseAt(x, z) {
    const N = window.noise;
    if (N && N.rangeVnoise) return N.rangeVnoise(x, z);
    const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function ridgedAt(x, z) {
    const N = window.noise;
    if (N && N.rangeRidgedFbm) return N.rangeRidgedFbm(x, z);
    return 1 - Math.abs(noiseAt(x, z) * 2 - 1);
  }
  function gaussian(x, z, cx, cz, sx, sz, amp) {
    const dx = (x - cx) / sx, dz = (z - cz) / sz;
    return amp * Math.exp(-0.5 * (dx * dx + dz * dz));
  }
  function flatCircleFactor(x, z, cx, cz, inner, outer) {
    return smooth01((Math.hypot(x - cx, z - cz) - inner) / Math.max(1, outer - inner));
  }
  function flatRectFactor(x, z, cx, cz, hx, hz, feather) {
    const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
    const outside = Math.hypot(Math.max(0, dx), Math.max(0, dz));
    const inside = Math.max(dx, dz);
    return inside <= 0 ? 0 : smooth01(outside / Math.max(1, feather));
  }

  // The authored snowboard trail meanders very slightly instead of reading
  // as a ruler-straight decal.  Both terrain carving and trail geometry call
  // this exact function, so there can be no floating/cutting strip.
  // (…AtA = authored frame; the exported snowRunXAt is world frame.)
  function snowRunXAtA(z) {
    const t = clamp01((-z - 1290) / 400);
    return 470 + Math.sin(t * Math.PI * 1.35) * 9 + Math.sin(t * Math.PI * 3.2) * 3;
  }
  function snowRunXAt(z) { return snowRunXAtA(z - DZ) + DX; }

  // =====================================================================
  //  MOUNT MERCY — from Gaussian blobs to real geology (MOUNT_EROSION_V4).
  // =====================================================================
  //  The old field was five hand-placed Gaussian lobes soft-maxed together and
  //  multiplied by a light ridged-fbm "crag" term. It had no drainage, no
  //  bedding, no cirques and no talus: geologically arbitrary. The V4 field
  //  keeps the AUTHORED SILHOUETTE (the same five summits, the same shoulder,
  //  the same footprint — the ski run, lodge pads and lift all still land where
  //  they were designed) and replaces the crag multiplier with the real erosion
  //  stack from world/mountain_detail.js:
  //     1. domain-warped RIDGED MULTIFRACTAL  → sinuous, connected crest lines
  //     2. DERIVATIVE-DAMPED fbm ("Quilez")   → detail dies on ground that is
  //        already steep, so faces weather into planes instead of noise mush
  //     3. DRAINAGE NETWORK                   → branching V-valleys with a flat
  //        gravel bed, converging downhill
  //     4. CIRQUE headwalls on each summit's shaded flank
  //     5. STRATA TERRACING                   → warped, non-parallel bedding
  //        benches and risers = actual cliff bands, aligned with the colour
  //        bands the shading pass paints from the SAME field
  //     6. TALUS aprons building out from the foot of those cliffs
  //
  //  MATH-GATE SAFETY (see mountain_detail.js's LAW 1). EVERY term above is a
  //  MULTIPLIER, and the multiplier is clamped so it can never exceed 0.95 —
  //  exactly the value the old `crag` term took wherever highFace→0. There is
  //  no additive term anywhere in this field (the talus apron is expressed as
  //  the carve being filled back in, not as material added). So at any sample
  //  the old field left at or below ~26u — which is where the gate's 25u
  //  mountain threshold lives — highFace is ~0 and the new factor is <= 0.95
  //  <= the old one: the new field is never taller there. The set of cells the
  //  gate counts as "mountain" can only shrink, never grow.
  const S_RIDGE = 0x4d31, S_ERODE = 0x4d32, S_RIVER = 0x4d33;
  const S_STRATA = 0x4d34, S_TALUS = 0x4d35, S_FINE = 0x4d36, S_SNOW = 0x4d37;
  const S_GRIDGE = 0x6e41, S_GERODE = 0x6e42, S_GRIVER = 0x6e43;
  const S_GSTRATA = 0x6e44, S_GTALUS = 0x6e45, S_GFINE = 0x6e46, S_GSNOW = 0x6e47;
  /* ---- TERRAIN_PEAKS_V2 ------------------------------------------------
     OWNER: "all the mountains have these curved yet sharp multi-peaks that
     don't look like realistic mountain shape."

     That is a precise description of what the Greater Mercy Range's field
     actually computes, and all three words are separate arithmetic faults:

       CURVED  — 50 Gaussian lobes, unioned by sqrt(sum of squares). A
                 Gaussian is a perfectly round bell, and a soft-max union
                 keeps every one of them visible as its own dome.
       SHARP   — each lobe carries a radial rib term
                 `0.5 + 0.5*cos(angle*k + radius*7.0 + phase)`. `radius` is
                 in SIGMA units and a lobe is evaluated out to 4 sigma, so
                 that cosine completes ~4.5 FULL CYCLES between the summit
                 and the base. A ridgeline is therefore creased into four or
                 five concentric rings on the way down. Real ridgelines
                 DESCEND MONOTONICALLY from a summit; they do not oscillate
                 along their own crest.
       MULTI   — the ten summits run a scale ladder 1.0 -> 10.0, but it is
                 compressed by pow(s, 0.62), so the tallest is only 4.17x the
                 shortest; then each summit is given four shoulders at up to
                 0.555x its own amplitude. Worked through, the summit
                 amplitudes are 92 / 114 / 132 / 164 / 183 / 210 / 241 / 279 /
                 341 / 384, and the BIGGEST summit's shoulders reach
                 0.555 x 384 = 213 — which out-tops SIX OF THE TEN SUMMITS.
                 There is no hierarchy left to read: it is a field of similar
                 bumps, which is exactly what "multi-peaks" describes.

     The fix is three terms and no new noise call:
       1. MONOTONE RIBS — drop `radius*7.0`. A rib becomes what a rib is:
          an azimuthal crease whose depth DECAYS outward from the summit, so
          every ridgeline falls all the way to the base without a single
          reversal. (Cheaper too: one multiply instead of an add + a term.)
       2. HIERARCHY — steepen the summit ladder (pow 0.62 -> 0.76, so the
          tallest is 5.75x the shortest) and cap the shoulder share at 0.168
          (was 0.555). The tallest shoulder in the whole range drops from 213
          to 65, which is UNDER the shortest summit (67) — stated as an
          inequality, not as taste. A few dominant summits, a lot of
          subordinate shoulders.
       3. A BROAD BASE — add `base*(1-base)` mass, which is ZERO at the
          summit and ZERO in the far field and peaks at mid-slope: an apron.
          It is zero at the crest BY CONSTRUCTION, so no summit gets taller
          and the math gate's 25 u mountain threshold cannot be crossed by
          a cell that was not already over it.
     Every term only reshapes the existing lobe sum — no octave is added, so
     the field costs the same. Determinism is untouched (no rng, no hash
     stream: the lobe table is built from the same greaterHash it always was).
     `?cfg_TERRAIN_PEAKS_V2=0` restores the exact prior silhouette.
  ---------------------------------------------------------------------- */
  if (CFGS.TERRAIN_PEAKS_V2 == null) CFGS.TERRAIN_PEAKS_V2 = true;
  const PEAKS_V2 = function () { return CFGS.TERRAIN_PEAKS_V2 !== false; };

  const HAS_KIT = !!(CBZ.mtnErode && CBZ.mtnRidgeMF && CBZ.mtnDrainage &&
                     CBZ.mtnTerrace && CBZ.mtnCirque && CBZ.mtnTalus && CBZ.mtnHiGate);
  const EROSION_V4 = function () { return HAS_KIT && CFGS.MOUNT_EROSION_V4 !== false; };
  // the five authored summits, reused for cirque placement and for the
  // adaptive mesh's density profile (authored frame)
  const MERCY_PEAKS = [
    { x: 315, z: -1720, r0: 26, r1: 172, w: 1.00 },
    { x: 115, z: -1690, r0: 22, r1: 142, w: 0.86 },
    { x: 545, z: -1705, r0: 26, r1: 162, w: 0.94 },
    { x: 700, z: -1645, r0: 20, r1: 130, w: 0.78 },
    { x: 410, z: -1570, r0: 28, r1: 178, w: 0.70 },
  ];
  const _erO = { v: 0, slope: 0, gx: 0, gz: 0 };
  const _drO = { carve: 0, bed: 0, terrace: 0, bank: 0, t: 1 };
  const _tlO = { smooth: 0, fill: 0 };

  // The EXPENSIVE part: everything that does not depend on build-time state
  // (no piste, no building pads, no edge feather). Memoised below — the mesh
  // vertex loop and the registered physics provider both read the memo through
  // ONE function, so they cannot fork.
  function mercyMacroA(x, z) {
    // Domain-warped ridged lobes form several summits and real saddles.  A
    // max-composition retains the silhouette of individual peaks; the broad
    // shoulder underneath makes them one geological mass rather than props.
    const warpX = (noiseAt(x * 0.0048 + 17, z * 0.0048 - 31) - 0.5) * 58;
    const warpZ = (noiseAt(x * 0.0041 - 43, z * 0.0041 + 19) - 0.5) * 42;
    const wx = x + warpX, wz = z + warpZ;
    const shoulder = gaussian(wx, wz, 365, -1680, 330, 205, 62);
    // An eighth-power union is visually indistinguishable from the old max
    // silhouette at distance, but removes the hard mathematical creases where
    // two lobes meet. That keeps the authored five-peak outline while making
    // the actual rideable surface read as wind-rounded geology.
    const p0 = gaussian(wx, wz, 315, -1720, 116, 92, 196);
    const p1 = gaussian(wx, wz, 115, -1690, 105, 105, 142);
    const p2 = gaussian(wx, wz, 545, -1705, 126, 98, 174);
    const p3 = gaussian(wx, wz, 700, -1645, 92, 112, 126);
    const p4 = gaussian(wx, wz, 410, -1570, 165, 125, 104);
    const peaks = Math.pow(
      Math.pow(p0, 8) + Math.pow(p1, 8) + Math.pow(p2, 8) +
      Math.pow(p3, 8) + Math.pow(p4, 8), 1 / 8
    );
    const north = smooth01((-z - 1350) / 285);
    const mass = shoulder + peaks;
    const highFace = smooth01((mass - 20) / 105);

    if (!EROSION_V4()) {
      // ---- LEGACY crag path, byte-identical (one-line revert) ------------
      const macroRidge = ridgedAt((x + 880) * 0.0062, (z - 420) * 0.0062);
      const fineRidge = ridgedAt((x - 130) * 0.0175, (z + 760) * 0.0175);
      const radialPhase = Math.atan2(wz + 1720, wx - 315) * 9 + Math.hypot(wx - 315, wz + 1720) * 0.018;
      const radial = 0.5 + 0.5 * Math.cos(radialPhase);
      const crag = mix(0.95, 0.76 + macroRidge * 0.16 + fineRidge * 0.07 + radial * 0.07, highFace);
      return Math.max(0, mass * crag * north);
    }

    // 1. sinuous ridgelines — a domain-warped ridged multifractal sharpens the
    //    crest lines without moving a single authored summit.
    const ridge = CBZ.mtnRidgeMF(x, z, {
      oct: 5, cell: 260, lac: 2.07, gain: 0.54, sharp: 1.6,
      warp: 130, warpCell: 700, salt: S_RIDGE,
    });
    // 2. derivative-damped fbm — er.slope is the bedrock steepness signal the
    //    talus/terrace/strata terms all key off.
    const er = CBZ.mtnErode(x, z, {
      oct: 5, cell: 210, lac: 2.03, gain: 0.5, damp: 1.35,
      warp: 90, warpCell: 620, salt: S_ERODE,
    }, _erO);
    // 3. drainage — branching V-valleys, deepest between the crests
    const dr = CBZ.mtnDrainage(x, z, {
      oct: 4, cell: 760, width: 0.34, warp: 190, salt: S_RIVER,
    }, _drO);

    // fine rock-face relief, ~11-27u — the scale the (now 2.2 u/vertex) mesh
    // resolves and the scale the old field had nothing at. Gated by STEEPNESS:
    // broken rock on the cliff faces, smooth on the rideable shoulders and the
    // piste, nothing in the valley. Inside the memo, so it costs nothing extra.
    const chipA = CBZ.mtnNoise(x, z, 27, S_FINE);
    const chipB = CBZ.mtnNoise(x, z, 11, S_FINE + 3);
    const chip = (1 - Math.abs(2 * chipA - 1)) * 0.6 + (1 - Math.abs(2 * chipB - 1)) * 0.4;
    const faceRough = highFace * smooth01((er.slope - 0.08) / 0.32);

    let f = 0.95
      - 0.30 * highFace * (1 - Math.pow(ridge, 0.60))                      // flanks fall away from the crest
      - 0.24 * highFace * dr.carve * (1 - 0.42 * dr.bed)                   // valleys, flat-bottomed
      - 0.09 * highFace * clamp01(-er.v * 2.2)                             // eroded hollows
      - 0.15 * faceRough * (1 - chip)                                      // chipped rock faces
      - 0.06 * highFace * (1 - er.slope) * clamp01(0.55 - er.v)            // damped roughness on gentle ground
      - 0.05 * (1 - highFace) * dr.carve * dr.carve;                       // the valley floor drains too
    if (f > 0.95) f = 0.95; else if (f < 0.36) f = 0.36;
    // SUMMIT GUARD — a real peak is the RESISTANT remnant left standing while
    // everything around it is stripped away; erosion that eats the summit as
    // hard as the flanks just makes a lower, rounder hill. Holding the five
    // authored summits at the baseline while the flanks lose up to 60% is what
    // turns "eroded" into "dramatic".
    let guard = 0;
    for (let gi = 0; gi < MERCY_PEAKS.length; gi++) {
      const pk = MERCY_PEAKS[gi];
      const gd = 1 - smooth01((Math.hypot(x - pk.x, z - pk.z) - 16) / 52);
      if (gd > guard) guard = gd;
    }
    if (guard > 0) f = f + (0.95 - f) * guard;
    // 4. TALUS — rockfall piles into an apron at the foot of every cliff, so
    //    the apron is LESS eroded than the face above it: a fuller, smoother
    //    wedge resting near the angle of repose. Expressed as the carve being
    //    FILLED BACK IN toward the 0.95 baseline rather than as material being
    //    added, so it needs no height gate at all — LAW 1 holds unconditionally
    //    (f can never exceed 0.95, the value the old `crag` took on low ground).
    const tl = CBZ.mtnTalus(x, z, { alt: clamp01(mass / 240), steep: er.slope, cell: 124, salt: S_TALUS }, _tlO);
    // mtnHiGate(mass) keeps the apron on ground that is already cliff-height:
    // it is identically 0 below 45u, so filling the carve back in can never
    // raise a sample in the 20-26u band above what the old `crag` term gave.
    f = f + (0.95 - f) * clamp01(0.60 * tl.fill + 0.28 * tl.smooth) * CBZ.mtnHiGate(mass);
    // 5. cirque headwalls on the shaded (NE) flank of every summit
    f *= CBZ.mtnCirque(x, z, MERCY_PEAKS, { depth: 0.17, shadeDir: -2.15 });

    let h = Math.max(0, mass * f * north);
    // 6. STRATA — quantise the steep high faces into warped bedding benches.
    //    mtnTerrace is <= h by construction, so LAW 1 still holds.
    h = CBZ.mtnTerrace(h, x, z, {
      amount: 0.80 * highFace * smooth01((er.slope - 0.05) / 0.28),
      step: 16, dip: 24, dipCell: 560, dipCell2: 155, salt: S_STRATA,
    });
    return h;
  }

  // Fine rock-face relief, ~9-24u wavelength — the scale a 2.2 u/vertex mesh
  // can actually resolve and the scale the old field had NOTHING at (its
  // ridging bottomed out around 60u). Kept OUTSIDE the memo so the cache cell
  // size can never wash it out; a pure multiplier <= 1 (LAW 1).
  // Sub-memo-cell grit, ~4-6u: below the mesh's own resolution, so it exists
  // purely for FOOT-LEVEL feel (the player's collision capsule and the
  // snowboard read it) and for normals sampled at e=3.0. Kept outside the memo
  // because a 2.5u grid cannot carry it. Multiplier <= 1 (LAW 1).
  function mercyFineA(x, z, h) {
    if (!(h > 8) || !HAS_KIT || !EROSION_V4()) return 1;
    const alt = smooth01((h - 22) / 95);
    const a = CBZ.mtnNoise(x, z, 6.5, S_FINE + 7);
    return 1 - 0.012 * alt * (1 - Math.abs(2 * a - 1));
  }

  // The memo. Cell 2.5 over the biome rect: the macro field's finest feature
  // is ~40u, so bilinear interpolation at 2.5u is exact to well under a
  // centimetre, while cutting the erosion stack's evaluation count by ~4x
  // across the (much denser) mesh. MESH AND PHYSICS BOTH GO THROUGH HERE.
  let _mercyMacro = null;
  function mercyMacro(x, z) {
    if (!_mercyMacro) {
      _mercyMacro = (CBZ.mtnGridCache && HAS_KIT)
        ? CBZ.mtnGridCache({
            fn: mercyMacroA, cell: 2.5,
            minX: A_MINX - 8, maxX: A_MAXX + 8, minZ: A_MINZ - 8, maxZ: A_MAXZ + 8,
          })
        : mercyMacroA;
    }
    return _mercyMacro(x, z);
  }
  CBZ.mtnMercyBounds = { minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };

  // AUTHORED-frame field — every constant in the body is stage-1
  // coordinates; the world-facing snowTerrainHeightAt below maps through
  // the dial, so the whole massif translates rigidly with the biome.
  function snowTerrainHeightAtA(x, z) {
    if (x < A_MINX || x > A_MAXX || z < A_MINZ || z > A_MAXZ) return 0;

    let h = mercyMacro(x, z);
    h *= mercyFineA(x, z, h);

    // Low polar hummocks keep the valley/ice field from being a mathematically
    // perfect plane, but remain subtle enough for the resort and lake.
    const polar = Math.pow(noiseAt(x * 0.018 - 8, z * 0.018 + 12), 2) * 1.15 * smooth01((-z - 1180) / 130);
    h += polar;

    // A deliberately graded piste cuts through the mountain shoulder.  Its
    // height is continuous, includes broad takeoff/landing knuckles, and is
    // blended into the surrounding geology across a 35m corridor.
    if (z >= -1705 && z <= -1275) {
      const t = clamp01((-z - 1290) / 400);
      let trail = 1.4 + 113 * Math.pow(t, 1.28);
      const jumps = [
        { z: -1392, a: 2.8, w: 11 },
        { z: -1472, a: 4.2, w: 14 },
        { z: -1553, a: 5.5, w: 16 },
        { z: -1622, a: 3.7, w: 12 },
      ];
      for (let i = 0; i < jumps.length; i++) {
        const j = jumps[i], dz = (z - j.z) / j.w;
        // Gaussian front with a quicker lee-side fall produces a lip without
        // a discontinuity.  Snowboard ground-snap releases at the curvature.
        trail += j.a * Math.exp(-0.5 * dz * dz) * (dz > 0 ? 0.72 : 1);
      }
      const trailBlend = 1 - smooth01((Math.abs(x - snowRunXAtA(z)) - 11) / 25);
      h = mix(h, trail, trailBlend);
    }

    // Real resorts grade pads for structures and freeze lakes in basins.  The
    // feathers prevent the old vertical "prop meets floor" seams.
    h *= flatCircleFactor(x, z, 180, -1380, 91, 126);                 // frozen lake
    h *= flatRectFactor(x, z, 360, -1250, 31, 25, 34);               // lodge
    h *= flatRectFactor(x, z, 640, -1230, 122, 92, 46);              // Pinecrest
    h *= flatRectFactor(x, z, 600, -1600, 18, 15, 24);               // cabin shelf
    h *= flatRectFactor(x, z, 300, -1275, 26, 22, 28);               // lift base
    for (let i = 0; i < SNOW_BUILDING_CLEARINGS.length; i++) {
      const c = SNOW_BUILDING_CLEARINGS[i];
      h *= flatRectFactor(x, z, c.cx, c.cz, c.hx, c.hz, c.feather);
    }

    // The terrain itself dies into the surrounding continent on every edge.
    const edge = Math.min(x - A_MINX, A_MAXX - x, z - A_MINZ, A_MAXZ - z);
    h *= smooth01(edge / 30);
    return Math.max(0, h);
  }
  // world-facing oracle (physics/audit/consumers) — dial-mapped.
  function snowTerrainHeightAt(x, z) { return snowTerrainHeightAtA(x - DX, z - DZ); }

  function snowTerrainNormalAt(x, z, out) {
    out = out || new THREE.Vector3();
    // 3.0, not 2.2: the macro field is read through a 2.5u memo grid, and a
    // central difference narrower than the memo cell would amplify the memo's
    // bilinear creases into visible faceting. One cell + a margin samples the
    // real surface slope instead of the interpolant's seams.
    const e = 3.0;
    const dx = snowTerrainHeightAt(x + e, z) - snowTerrainHeightAt(x - e, z);
    const dz = snowTerrainHeightAt(x, z + e) - snowTerrainHeightAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }

  // -----------------------------------------------------------------------
  // GREATER MERCY RANGE — ten deliberately different mountain families,
  // expanded into fifty rounded alpine lobes. These are not cloned cone props: one
  // continuous, collision-backed heightfield connects the whole northern
  // skyline. Family scale still runs from 1x through 10x, but geological height
  // and footprint grow sub-linearly; multiplying every dimension literally by
  // ten produced kilometre-high featureless Gaussian balloons. A sharpened
  // crown plus multi-scale erosion keeps broad rounded bases without the blank
  // snowball silhouette. The original Mount Mercy above stays untouched
  // as the foreground hero/run and joins this range at its zero-height north
  // edge.
  // -----------------------------------------------------------------------
  // authored-frame envelope; the world-frame GREAT_* below ride the dial so
  // the whole ten-family range translates rigidly with the snow island.
  const GREAT_A_MINX = -1450, GREAT_A_MAXX = 1750;
  const GREAT_A_MINZ = -4100, GREAT_A_MAXZ = A_MINZ;
  const GREAT_MINX = GREAT_A_MINX + DX, GREAT_MAXX = GREAT_A_MAXX + DX;
  const GREAT_MINZ = GREAT_A_MINZ + DZ, GREAT_MAXZ = GREAT_A_MAXZ + DZ;
  const GREAT_MAJOR = [
    { x: -1120, z: -2200, s: 1.0 },
    { x: -790,  z: -2580, s: 1.4 },
    { x: -390,  z: -2150, s: 1.8 },
    { x: 40,    z: -2700, s: 2.4 },
    { x: 430,   z: -2220, s: 3.0 },
    { x: 880,   z: -2780, s: 3.8 },
    { x: 1370,  z: -2180, s: 4.7 },
    { x: -820,  z: -3440, s: 6.0 },
    { x: 250,   z: -3500, s: 10.0 },
    { x: 1260,  z: -3420, s: 8.0 },
  ];
  const GREAT_LOBES = [];
  function greaterHash(i, j) {
    const h = Math.sin((i + 1) * 91.713 + (j + 3) * 37.119) * 43758.5453;
    return h - Math.floor(h);
  }
  // TERRAIN_PEAKS_V2 term 2 — HIERARCHY. A steeper summit ladder (0.76) and
  // a shoulder share capped at 0.34 of the parent. Before: the biggest
  // summit's shoulders reached 232 u and out-topped six of the ten summits.
  // After: no shoulder can reach the smallest summit. Amplitude is renormalised
  // (92 -> 74) so the RANGE's own top stays where it was — this redistributes
  // mass into a hierarchy, it does not grow the massif.
  // GP_AMP is solved, not chosen: 92*10^0.62 = 384 was the old top summit, so
  // 384/10^0.76 = 67 keeps the RANGE EXACTLY AS TALL while the ladder under it
  // gets steeper. A shape change that also grows the massif is a different
  // change, and it would move the math gate's mountain-cell sets.
  // The shoulder share is solved too: the tallest parent is 10^0.76 = 5.754x
  // the smallest SUMMIT, so 1/5.754 = 0.1738 is the exact share at which the
  // biggest summit's biggest shoulder EQUALS the smallest summit. The share
  // below tops out at 0.168, strictly under it — so no shoulder anywhere in the
  // range can out-top any summit. That is the hierarchy, stated as an
  // inequality instead of as taste.
  const GP_EXP = PEAKS_V2() ? 0.76 : 0.62;
  const GP_AMP = PEAKS_V2() ? 67 : 92;
  const GP_SH0 = PEAKS_V2() ? 0.072 : 0.30;     // shoulder share, innermost
  const GP_SHJ = PEAKS_V2() ? 0.021 : 0.055;    // …per ring outward
  const GP_SHV = PEAKS_V2() ? 0.033 : 0.09;     // …hash jitter (max share 0.168)
  for (let gi = 0; gi < GREAT_MAJOR.length; gi++) {
    const m = GREAT_MAJOR[gi];
    const scaled = Math.pow(m.s, GP_EXP);
    const mainAmp = GP_AMP * scaled;
    GREAT_LOBES.push({
      x: m.x, z: m.z,
      sx: 48 + 67 * scaled, sz: 44 + 61 * scaled,
      a: mainAmp, major: true,
    });
    // Four offset shoulders per summit = 10 mains + 40 shoulders = 50
    // independently sized masses. They are deterministic and allocate once.
    for (let j = 0; j < 4; j++) {
      const u = greaterHash(gi, j), v = greaterHash(gi + 17, j + 9);
      const angle = (j / 4) * Math.PI * 2 + (u - 0.5) * 0.9;
      const ring = (70 + j * 23) * Math.pow(m.s, 0.38) * (0.82 + v * 0.36);
      const ss = scaled * (0.33 + j * 0.075 + u * 0.10);
      GREAT_LOBES.push({
        x: m.x + Math.cos(angle) * ring,
        z: m.z + Math.sin(angle) * ring,
        sx: 30 + 58 * ss,
        sz: 28 + 52 * ss,
        a: mainAmp * (GP_SH0 + j * GP_SHJ + v * GP_SHV), major: false,
      });
    }
  }

  // AUTHORED-frame field (lobes/erosion constants are stage-1 coordinates);
  // the world-facing greaterMercyHeightAt below maps through the dial.
  //
  // Same V4 treatment as Mount Mercy, tuned one scale coarser (these summits
  // are 2-8x larger and are read at kilometre distances, so the erosion works
  // at ~600u crest wavelength instead of ~260u and the strata beds are 34u
  // thick instead of 16u). The Gaussian lobe union, the 4σ reject, the family
  // ribs and the whole footprint are UNCHANGED — this only replaces the two
  // flat ridged multipliers with the shared erosion stack.
  const GREAT_MACRO_PEAKS = GREAT_MAJOR.map(function (m) {
    const s = Math.pow(m.s, 0.62);
    return { x: m.x, z: m.z, r0: 40 + 30 * s, r1: 150 + 230 * s, w: 0.85 };
  });
  function greaterMercyMacroA(x, z) {
    let sum2 = 0;
    for (let i = 0; i < GREAT_LOBES.length; i++) {
      const l = GREAT_LOBES[i];
      const dx = (x - l.x) / l.sx, dz = (z - l.z) / l.sz;
      // exp() is the only costly part. A four-sigma reject makes floor queries
      // near one peak inspect 50 cheap AABBs but evaluate only its local family.
      if (dx < -4 || dx > 4 || dz < -4 || dz > 4) continue;
      const base = Math.exp(-0.5 * (dx * dx + dz * dz));
      // A narrower upper crown turns each broad Gaussian foundation into an
      // alpine summit while retaining the wind-rounded base requested for the
      // rideable terrain. Shoulders stay softer and knit nearby peaks together.
      // TERRAIN_PEAKS_V2 term 3 — A BROAD BASE. `base*(1-base)` is zero at the
      // summit (base=1) and zero in the far field (base=0) and peaks at
      // mid-slope, so it is an APRON: it widens the skirt and makes the lower
      // slopes concave without adding one centimetre to any crest. That is the
      // single loudest missing tell — real massifs have a long shallow foot.
      let profile = l.major
        ? base * (0.22 + 0.78 * Math.pow(base, 1.35))
        : base * (0.76 + 0.24 * base);
      if (PEAKS_V2()) profile += (l.major ? 0.42 : 0.18) * base * (1 - base);
      // Each main summit gets long radial ribs.
      // TERRAIN_PEAKS_V2 term 1 — MONOTONE RIDGELINES. The old term added
      // `radius * 7.0` inside the cosine; `radius` is in sigma and lobes reach
      // 4 sigma, so the crease oscillated ~4.5 times between summit and base
      // and every ridge went up and down on its way down. The rib is now purely
      // AZIMUTHAL, and its depth DECAYS with radius, so a ridgeline descends
      // once and keeps descending — which is the only thing a real one does.
      const angle = Math.atan2(dz, dx);
      const radius = Math.sqrt(dx * dx + dz * dz);
      const ribs = PEAKS_V2()
        ? 0.5 + 0.5 * Math.cos(angle * (6 + (i % 4)) + i * 1.37)
        : 0.5 + 0.5 * Math.cos(angle * (6 + (i % 4)) + radius * 7.0 + i * 1.37);
      const ribFade = PEAKS_V2() ? 1 / (1 + 0.45 * radius * radius) : 1;
      const face = l.major ? (1 - (1 - ribs) * 0.20 * ribFade) : (1 - (1 - ribs) * 0.09 * ribFade);
      const h = l.a * profile * face;
      sum2 += h * h;
    }
    if (sum2 <= 0.0001) return 0;
    let h = Math.sqrt(sum2);
    const soft = 0.95 + 0.08 * noiseAt(x * 0.0017 + 61, z * 0.0017 - 27);
    const southJoin = smooth01((GREAT_A_MAXZ - z) / 155);
    const edge = Math.min(x - GREAT_A_MINX, GREAT_A_MAXX - x, z - GREAT_A_MINZ);
    const skirt = soft * southJoin * smooth01(edge / 125);

    if (!EROSION_V4()) {
      // ---- LEGACY erosion path, byte-identical (one-line revert) ---------
      const macro = ridgedAt(x * 0.0044 + 61, z * 0.0044 - 27);
      const detail = ridgedAt(x * 0.0105 - 18, z * 0.0105 + 43);
      const erosion = 0.64 + Math.min(1, macro * 0.68 + detail * 0.32) * 0.36;
      return Math.max(0, h * erosion * skirt);
    }

    const highFace = smooth01((h - 40) / 220);
    const ridge = CBZ.mtnRidgeMF(x, z, {
      oct: 5, cell: 600, lac: 2.07, gain: 0.55, sharp: 1.7,
      warp: 300, warpCell: 1700, salt: S_GRIDGE,
    });
    const er = CBZ.mtnErode(x, z, {
      oct: 5, cell: 470, lac: 2.03, gain: 0.5, damp: 1.25,
      warp: 210, warpCell: 1400, salt: S_GERODE,
    }, _erO);
    const dr = CBZ.mtnDrainage(x, z, {
      oct: 4, cell: 1750, width: 0.32, warp: 430, salt: S_GRIVER,
    }, _drO);
    const gchipA = CBZ.mtnNoise(x, z, 76, S_GFINE);
    const gchipB = CBZ.mtnNoise(x, z, 30, S_GFINE + 3);
    const gchip = (1 - Math.abs(2 * gchipA - 1)) * 0.6 + (1 - Math.abs(2 * gchipB - 1)) * 0.4;
    const gFace = highFace * smooth01((er.slope - 0.08) / 0.32);
    let f = 0.80                                     // ~ the legacy `erosion` mean
      - 0.30 * highFace * (1 - Math.pow(ridge, 0.58))
      - 0.24 * highFace * dr.carve * (1 - 0.40 * dr.bed)
      - 0.09 * highFace * clamp01(-er.v * 2.2)
      - 0.18 * gFace * (1 - gchip)
      - 0.07 * highFace * (1 - er.slope) * clamp01(0.55 - er.v)
      - 0.06 * (1 - highFace) * dr.carve * dr.carve;
    if (f > 0.80) f = 0.80; else if (f < 0.32) f = 0.32;
    let gguard = 0;
    for (let gi = 0; gi < GREAT_MACRO_PEAKS.length; gi++) {
      const pk = GREAT_MACRO_PEAKS[gi];
      const gd = 1 - smooth01((Math.hypot(x - pk.x, z - pk.z) - pk.r0 * 0.6) / (pk.r0 * 2.2));
      if (gd > gguard) gguard = gd;
    }
    if (gguard > 0) f = f + (0.80 - f) * gguard;
    // talus aprons — same fill-the-carve-back-in formulation as Mount Mercy,
    // so the factor stays <= 1 and no additive gate is needed
    const tl = CBZ.mtnTalus(x, z, { alt: clamp01(h / 380), steep: er.slope, cell: 280, salt: S_GTALUS }, _tlO);
    f = f + (0.80 - f) * clamp01(0.60 * tl.fill + 0.28 * tl.smooth) * CBZ.mtnHiGate(h);
    f *= CBZ.mtnCirque(x, z, GREAT_MACRO_PEAKS, { depth: 0.15, shadeDir: -2.15 });
    h = Math.max(0, h * f * skirt);
    // strata benches, one scale up from Mount Mercy's
    h = CBZ.mtnTerrace(h, x, z, {
      amount: 0.74 * highFace * smooth01((er.slope - 0.05) / 0.28),
      step: 34, dip: 52, dipCell: 1250, dipCell2: 340, salt: S_GSTRATA,
    });
    return h;
  }
  // Fine face relief for the range — 26-70u, the scale its ~7u/vertex mesh
  // resolves. Multiplier <= 1 (LAW 1), kept outside the memo.
  function greaterFineA(x, z, h) {
    if (!(h > 14) || !HAS_KIT || !EROSION_V4()) return 1;
    const alt = smooth01((h - 30) / 220);
    const a = CBZ.mtnNoise(x, z, 15, S_GFINE + 7);
    return 1 - 0.014 * alt * (1 - Math.abs(2 * a - 1));
  }
  // memo: cell 6 over a 3.2 x 2.3 km envelope (~207k floats). The clearings
  // list is applied OUTSIDE it, because it is build-time state.
  let _greatMacro = null;
  function greatMacro(x, z) {
    if (!_greatMacro) {
      _greatMacro = (CBZ.mtnGridCache && HAS_KIT)
        ? CBZ.mtnGridCache({
            fn: greaterMercyMacroA, cell: 6,
            minX: GREAT_A_MINX - 12, maxX: GREAT_A_MAXX + 12,
            minZ: GREAT_A_MINZ - 12, maxZ: GREAT_A_MAXZ + 12,
          })
        : greaterMercyMacroA;
    }
    return _greatMacro(x, z);
  }
  // ---- SNOW_MASSIF_AMP: the "absolutely massive" dial (owner order) -------
  // Scales ONLY the Greater Mercy massif — never Mount Mercy, whose field
  // carries the authored ski piste/jump knuckles/lift line, gameplay that a
  // blanket multiplier would silently re-grade. Applied through mtnHiGate
  // (identically 0 below 45u, 1 above 70u), the same provably-gate-safe
  // construction TERRAIN_RING_AMP uses: a sample under 45u is untouched, a
  // sample over the math gate's 25u mountain threshold stays over it, so the
  // gate's city-on-mountain / mountains-outside-snow cell sets are unchanged
  // by construction. Feet, pads, clearings, the causeway skirt — all live in
  // the untouched sub-45u band. `?cfg_SNOW_MASSIF_AMP=1` is the revert.
  function massifAmp() {
    const C = CBZ.CONFIG || {};
    if (C.SNOW_MASSIF_AMP == null) C.SNOW_MASSIF_AMP = 1.9;
    const v = +C.SNOW_MASSIF_AMP;
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  function greaterMercyHeightAtA(x, z) {
    if (x < GREAT_A_MINX || x > GREAT_A_MAXX || z < GREAT_A_MINZ || z > GREAT_A_MAXZ) return 0;
    let h = greatMacro(x, z);
    if (h <= 0) return 0;
    h *= greaterFineA(x, z, h);
    for (let i = 0; i < GREAT_BUILDING_CLEARINGS.length; i++) {
      const c = GREAT_BUILDING_CLEARINGS[i];
      h *= flatRectFactor(x, z, c.cx, c.cz, c.hx, c.hz, c.feather);
    }
    const K = massifAmp();
    if (K !== 1 && h > 0 && CBZ.mtnHiGate) h *= 1 + (K - 1) * CBZ.mtnHiGate(h);
    return Math.max(0, h);
  }
  CBZ.mtnGreatBounds = { minX: GREAT_MINX, maxX: GREAT_MAXX, minZ: GREAT_MINZ, maxZ: GREAT_MAXZ };

  /* ==================================================================
     CBZ.peakShapeAudit() — THE SILHOUETTE AS NUMBERS (TERRAIN_PEAKS_V2).

     "Multi-peaks that don't look like a real mountain" is a shape claim,
     and shape claims are measurable. Four numbers over the Greater Mercy
     envelope, sampled on the AUTHORED frame so the dial cannot move them:

       summits    — 8-neighbour local maxima above SUM_H. A range has a few
                    dominant summits; a field of similar bumps has dozens.
       maxH       — the top of the massif (must not grow: a shape change
                    that also raises the range is a different change).
       meanSlope  — mean |gradient| over the massif. Sharper spikes on a
                    narrow base read as a HIGHER mean slope; an apron
                    lowers it.
       baseWidth  — (cells above 5 u) / (cells above half the summit). The
                    ratio a real massif has is large — a long shallow foot
                    under a small crest. Spikes rising straight out of flat
                    ground score near 1.
  ================================================================== */
  CBZ.peakShapeAudit = function (opts) {
    opts = opts || {};
    const N = Number.isFinite(+opts.step) && +opts.step > 16 ? +opts.step : 220;
    const SUM_H = Number.isFinite(+opts.summit) ? +opts.summit : 60;
    const x0 = GREAT_A_MINX, x1 = GREAT_A_MAXX, z0 = GREAT_A_MINZ, z1 = GREAT_A_MAXZ;
    const dx = (x1 - x0) / N, dz = (z1 - z0) / N;
    const H = new Float32Array(N * N);
    let maxH = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = greaterMercyHeightAtA(x0 + (i + 0.5) * dx, z0 + (j + 0.5) * dz);
      H[j * N + i] = h; if (h > maxH) maxH = h;
    }
    let summits = 0, slopeSum = 0, slopeN = 0, wide = 0, crest = 0;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i, h = H[k];
      if (h > 5) wide++;
      if (h > maxH * 0.5) crest++;
      if (h > 1) {
        const gx = (H[k + 1] - H[k - 1]) / (2 * dx), gz = (H[k + N] - H[k - N]) / (2 * dz);
        slopeSum += Math.sqrt(gx * gx + gz * gz); slopeN++;
      }
      if (h < SUM_H) continue;
      let top = true;
      for (let a = -1; a <= 1 && top; a++) for (let b = -1; b <= 1; b++) {
        if ((a || b) && H[(j + a) * N + (i + b)] > h) { top = false; break; }
      }
      if (top) summits++;
    }
    return {
      summits: summits,
      maxH: Math.round(maxH),
      meanSlope: +(slopeSum / Math.max(1, slopeN)).toFixed(3),
      baseWidth: +(wide / Math.max(1, crest)).toFixed(2),
      lobes: GREAT_LOBES.length,
      shoulderTop: Math.round(GREAT_LOBES.reduce(function (m, l) { return l.major ? m : Math.max(m, l.a); }, 0)),
      smallestSummit: Math.round(GREAT_LOBES.reduce(function (m, l) { return l.major ? Math.min(m, l.a) : m; }, 1e9)),
      v2: PEAKS_V2(),
    };
  };
  // AUTHORED-frame fields exposed for numeric probes/tooling (the world-facing
  // dial-mapped oracles are still published by the landmass builder, and they
  // remain the ONE function that feeds both the mesh and the physics floor —
  // these are the same closures, not a second implementation).
  CBZ.mtnMercyFieldA = snowTerrainHeightAtA;
  CBZ.mtnGreatFieldA = greaterMercyHeightAtA;
  // world-facing oracle — dial-mapped.
  function greaterMercyHeightAt(x, z) { return greaterMercyHeightAtA(x - DX, z - DZ); }

  function greaterMercyNormalAt(x, z, out) {
    out = out || new THREE.Vector3();
    // >= the 6u memo cell, for the same reason Mount Mercy's is >= its 2.5u.
    const e = 7.5;
    const dx = greaterMercyHeightAt(x + e, z) - greaterMercyHeightAt(x - e, z);
    const dz = greaterMercyHeightAt(x, z + e) - greaterMercyHeightAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }

  // local seeded rng — never touch Math.random (determinism contract)
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // shared palette — snow, ice, rock, pine, lodge timber
  const COL = {
    // Fresh snow is a very high-albedo, nearly neutral surface. Keep the blue
    // in its shadow palette (and the much denser lake ice), not across every
    // lit face. Rock is deliberately warmer/neutral so exposed geology cannot
    // be mistaken for another blue snow band at aircraft distance.
    snow: 0xf6f8f9, snowShade: 0xd9e2e6, ice: 0xbfd9e6, iceDeep: 0x9cc2d6,
    rock: 0x74736f, rockDark: 0x454a4d, pine: 0x2f5d44, pineDk: 0x244a36,
    trunk: 0x5a4632, timber: 0x7a5638, timberDk: 0x5e4129, roofSnow: 0xf0f3f5,
    steel: 0x8a8f97, cable: 0x3a3d42, chair: 0xc23a3a, ember: 0xff7a2a, flag: 0xd23b3b,
  };

  // ============================================================
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    // WHERE THE CAUSEWAY STOPS, decided against the world that actually exists
    // (see causewayCut's block comment). Must run before the layout reserve,
    // the deck, the region record and the road record — all four read it.
    CAUSEWAY_MAXZ = causewayCut(city);
    const mat = CBZ.mat, cmat = CBZ.cmat || CBZ.mat;
    // AUTHORED-FRAME SEEDING (WORLD_LAYOUT_V2). Everything in this file is
    // already authored in the stage-1 frame and mapped world<->authored at the
    // oracle boundary — except this stream, which was keyed on the WORLD
    // centre. That made the world-layout dial a re-roll button: sliding the
    // alpine island re-dealt Pinecrest's entire street plan, which is exactly
    // the recalibration the math gate's golden table still carries a comment
    // about ("snow move re-rolled Pinecrest"). Keying on the authored anchor
    // (CX-DX, CZ-DZ — i.e. the literal 350,-1450) finishes the rigid-translate
    // contract the rest of the file already keeps. At zero offset authored ==
    // world, so the flag-off build is byte-identical.
    const _SEEDX = LAYOUT_V2() ? (CX - DX) : CX, _SEEDZ = LAYOUT_V2() ? (CZ - DZ) : CZ;
    const rng = mulberry((CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : 0x53170) ^ ((_SEEDX * 73856093) ^ (_SEEDZ * 19349663)));

    // shared materials (one instance each — draw-call friendly)
    const mSnow = cmat(COL.snow), mSnowShade = cmat(COL.snowShade);
    const mRock = cmat(COL.rock), mPine = cmat(COL.pine), mPineDk = cmat(COL.pineDk);
    const mTrunk = cmat(COL.trunk), mSteel = cmat(COL.steel);
    const mTimber = cmat(COL.timber), mTimberDk = cmat(COL.timberDk);

    // Mainland/town buildings already exist at this point in buildCity.  Find
    // only occupied lots that actually intersect raised alpine terrain and
    // grade a generous, feathered pad beneath them.  Empty lots remain natural
    // ground and future builders are kept out by the massif reservations below.
    SNOW_BUILDING_CLEARINGS.length = 0;
    GREAT_BUILDING_CLEARINGS.length = 0;
    const builtLots = (city.lots || []).concat(city.annex && city.annex.lots || []);
    for (let i = 0; i < builtLots.length; i++) {
      const lot = builtLots[i];
      if (!lot || !lot.building || !Number.isFinite(+lot.cx) || !Number.isFinite(+lot.cz)) continue;
      const b = lot.building;
      const w = Math.max(8, +lot.w || +b.w || +b.width || 12);
      const d = Math.max(8, +lot.d || +b.d || +b.depth || 12);
      const pad = { cx: +lot.cx, cz: +lot.cz, hx: w * 0.5 + 10, hz: d * 0.5 + 10, feather: 52 };
      // the clearing lists live in the AUTHORED frame (the oracle bodies map
      // world → authored at entry) — translate each world lot before storing.
      const padA = { cx: pad.cx - DX, cz: pad.cz - DZ, hx: pad.hx, hz: pad.hz, feather: pad.feather };
      if (pad.cx >= MINX && pad.cx <= MAXX && pad.cz >= MINZ && pad.cz <= MAXZ &&
          snowTerrainHeightAt(pad.cx, pad.cz) > 0.8) {
        SNOW_BUILDING_CLEARINGS.push(padA);
      }
      if (pad.cx >= GREAT_MINX && pad.cx <= GREAT_MAXX && pad.cz >= GREAT_MINZ && pad.cz <= GREAT_MAXZ &&
          greaterMercyHeightAt(pad.cx, pad.cz) > 0.8) {
        GREAT_BUILDING_CLEARINGS.push(padA);
      }
    }

    function pushCol(minX, maxX, minZ, maxZ, y0, y1, ref) {
      const c = { minX, maxX, minZ, maxZ, ref: ref || null };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      CBZ.colliders.push(c);
      return c;
    }
    function box(x, y, z, w, h, d, m, solid) {
      const me = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), m);
      me.position.set(x, y, z);
      me.castShadow = true; me.receiveShadow = true;
      root.add(me);
      if (solid) pushCol(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h / 2, y + h / 2, me);
      return me;
    }
    function tag(group, text, y) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(7, 1.68, 1);
      group.add(s);
    }

    // ---- PINECREST resort town (T8) ---------------------------------------
    // A real alpine RESORT VILLAGE grown from the reusable generator using the
    // snow-tied recipe (citytemplates.js: lodge/outfitter/clinic/gear-pawn/spa).
    // Placed on FLAT base ground SE of the existing lodge + ski run (the snow
    // valley is dead-flat per terrain.js, so it sits level), clear of the lodge,
    // ski run, lake, cabin + lift. The pine/rock scatter SKIPS this rect
    // via inTown so trees don't grow in the village — gated on HAS_TOWN so the
    // biome is byte-identical if towngen is absent (zero regression).
    const HAS_TOWN = typeof CBZ.buildTown === "function" && !!(CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES.pinecrest);
    const TOWN_CX = 640 + DX, TOWN_CZ = -1230 + DZ, TOWN_HX = 110, TOWN_HZ = 80;
    const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
    function inTown(x, z) {
      return HAS_TOWN && x > TOWN.minX - 8 && x < TOWN.maxX + 8 && z > TOWN.minZ - 8 && z < TOWN.maxZ + 8;
    }
    // OWNER: "a mountain still overlaps with the town." Per-lot pads flattened
    // each BUILDING, but the town's streets/space BETWEEN lots still rode the
    // raw massif slope — the mountain visibly ran through the village. One
    // whole-town feathered clearing fixes the overlap for the entire rect;
    // oracle + mesh share the field, so physics stays consistent. Sits HERE
    // (after the TOWN consts — a copy above the declarations threw a TDZ
    // ReferenceError and aborted the whole landmass build). The clearing
    // arrays were reset just above; pad order within them is irrelevant.
    // Flip SNOW_TOWN_CLEARING=false to restore the slope-through-town look.
    if (CBZ.CONFIG.SNOW_TOWN_CLEARING == null) CBZ.CONFIG.SNOW_TOWN_CLEARING = true;
    if (HAS_TOWN && CBZ.CONFIG.SNOW_TOWN_CLEARING !== false) {
      // authored frame (see the clearing-list contract above)
      const townPad = { cx: TOWN_CX - DX, cz: TOWN_CZ - DZ, hx: TOWN_HX + 14, hz: TOWN_HZ + 14, feather: 90 };
      SNOW_BUILDING_CLEARINGS.push(townPad);
      GREAT_BUILDING_CLEARINGS.push(townPad);
    }
    const layout = CBZ.worldLayout;
    // Declare the resort's future landmarks before vegetation is scattered.
    // This prevents pines, rocks, and drifts from being generated through the
    // lodge, lake, lift, ski run, village, and causeway.
    if (layout) {
      if (HAS_TOWN) layout.reserve("snow:pinecrest", TOWN, { pad: 12 });
      layout.reserveCircle("snow:lake", 180 + DX, -1380 + DZ, 104, { pad: 2 });
      layout.reserve("snow:lodge", { minX: 344 + DX, maxX: 376 + DX, minZ: -1264 + DZ, maxZ: -1236 + DZ }, { pad: 8 });
      layout.reserve("snow:cabin", { minX: 590 + DX, maxX: 610 + DX, minZ: -1610 + DZ, maxZ: -1590 + DZ }, { pad: 8 });
      layout.reserve("snow:ski-run", { minX: 448 + DX, maxX: 492 + DX, minZ: -1735 + DZ, maxZ: -1285 + DZ }, { pad: 5 });
      layout.reserve("snow:lift", { minX: 226 + DX, maxX: 484 + DX, minZ: -1734 + DZ, maxZ: -1166 + DZ }, { pad: 5 });
      // north end = the snow shore (rides the dial); south end stays butted
      // on the speedway leg — the deck STRETCHES as the island moves away.
      layout.reserve("snow:causeway", { minX: CW_CX - CW_HW, maxX: CW_CX + CW_HW, minZ: MAXZ, maxZ: CAUSEWAY_MAXZ }, { pad: 3 });
      for (let i = 0; i < GREAT_MAJOR.length; i++) {
        const m = GREAT_MAJOR[i], scaled = Math.pow(m.s, 0.62);
        layout.reserveCircle("snow:massif-family:" + i, m.x + DX, m.z + DZ,
          120 + 115 * scaled, { pad: 24, kind: "massif", source: "snow-terrain" });
      }
    }
    function claimNature(x, z, r) { return !layout || layout.claimNature(x, z, r, { pad: 0.35 }); }
    function openNature(x, z, r) { return !layout || layout.canPlaceNature(x, z, r, { pad: 0.2 }); }
    let mountainHeightAt = CFGS.SNOW_TERRAIN_V2 !== false ? snowTerrainHeightAt : function () { return 0; };
    CBZ.snowTerrainHeightAt = mountainHeightAt;
    CBZ.snowTerrainNormalAt = snowTerrainNormalAt;
    CBZ.snowRunXAt = snowRunXAt;
    CBZ.greaterSnowTerrainHeightAt = greaterMercyHeightAt;
    CBZ.greaterSnowTerrainNormalAt = greaterMercyNormalAt;
    CBZ.greaterSnowMountainCount = GREAT_MAJOR.length;
    CBZ.greaterSnowLobeCount = GREAT_LOBES.length;

    // ---- one continuous SNOW / ROCK heightfield --------------------------
    (function ground() {
      if (CFGS.SNOW_TERRAIN_V2 === false) {
        const legacy = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 40, HZ * 2 + 40),
          new THREE.MeshLambertMaterial({ color: COL.snow }));
        legacy.rotation.x = -Math.PI / 2;
        legacy.position.set(CX, 0.02, CZ);
        legacy.receiveShadow = true;
        legacy.userData.terrain = true;
        legacy.userData.worldSurface = true;
        legacy.name = "snow-valley-surface";
        root.add(legacy);
        return;
      }

      // ---- MESH RESOLUTION -------------------------------------------
      // 260x200 over 840x660 was ~3.2 u/vertex, which physically cannot
      // resolve a cliff band, a bedding riser or a talus lobe — the old colour
      // code painted "cliff"/"scour"/"brokenFace" onto geometry that was
      // smooth. MOUNT_MESH_DENSITY raises the count (1.45 → ~2.2 u/vertex) and
      // MOUNT_ADAPTIVE_GRID then REDISTRIBUTES those grid lines: a CDF over the
      // mountain's own height profile puts them on the summits and cliffs and
      // takes them off the dead-flat lake/resort valley, so the effective
      // resolution on the peaks is ~1.5 u/vertex at no extra triangle cost.
      const DENS = Math.max(0.5, Math.min(2.4, +CFGS.MOUNT_MESH_DENSITY || 1));
      const segX = Math.round(260 * DENS), segZ = Math.round(200 * DENS);
      // density profiles: the tallest ground along each axis, plus an explicit
      // floor under the ski-run corridor so the piste never loses resolution.
      let xs = null, zs = null;
      if (CBZ.mtnAdaptiveAxis && CBZ.mtnGridGeometry) {
        const PN = 40;
        function colMax(fixedX) {
          let m = 0;
          for (let k = 0; k <= PN; k++) {
            const z = A_MINZ + (A_MAXZ - A_MINZ) * (k / PN);
            const v = mercyMacro(fixedX, z);
            if (v > m) m = v;
          }
          return m;
        }
        function rowMax(fixedZ) {
          let m = 0;
          for (let k = 0; k <= PN; k++) {
            const x = A_MINX + (A_MAXX - A_MINX) * (k / PN);
            const v = mercyMacro(x, fixedZ);
            if (v > m) m = v;
          }
          return m;
        }
        const PEAK = 260;
        xs = CBZ.mtnAdaptiveAxis(segX, A_MINX, A_MAXX, function (x) {
          const run = (x > 444 && x < 500) ? 0.9 : 0;      // ski-run corridor
          return Math.max(run, Math.pow(Math.min(1, colMax(x) / PEAK), 0.75));
        }, { floor: 0.36 });
        zs = CBZ.mtnAdaptiveAxis(segZ, A_MINZ, A_MAXZ, function (z) {
          const run = (z > -1715 && z < -1265) ? 0.55 : 0;
          return Math.max(run, Math.pow(Math.min(1, rowMax(z) / PEAK), 0.75));
        }, { floor: 0.36 });
        // authored frame → mesh-local (the mesh sits at CX,CZ)
        for (let i = 0; i < xs.length; i++) xs[i] = xs[i] + DX - CX;
        for (let i = 0; i < zs.length; i++) zs[i] = zs[i] + DZ - CZ;
      }
      const geo = xs ? CBZ.mtnGridGeometry(xs, zs)
                     : (function () { const g = new THREE.PlaneGeometry(HX * 2, HZ * 2, segX, segZ); g.rotateX(-Math.PI / 2); return g; })();
      const pa = geo.attributes.position;
      const colors = new Float32Array(pa.count * 3);
      // Natural-colour snow is nearly neutral white; only sky-lit shadow planes
      // skew blue. These values stay below display white so erosion normals do
      // not clip, while removing the old all-over cyan cast.
      const c = new THREE.Color(), rc = new THREE.Color(), snowLit = new THREE.Color(0xf9fafb);
      const snowShadow = new THREE.Color(0xd4dfe4), iceBlue = new THREE.Color(0xaec7d4);
      const lakeIce = new THREE.Color(COL.ice), lakeIceDeep = new THREE.Color(COL.iceDeep);
      const granite = new THREE.Color(0x5d5952), graniteDark = new THREE.Color(0x262b2e);
      const tundraEdge = new THREE.Color(0x66745d);
      // Alpine soil/tundra/turf — what shows on SHALLOW ground below the snow.
      // The old field had no soil at all: every non-snow pixel was granite, so
      // gentle benches read as bare rock slabs.
      const alpSoil = new THREE.Color(0x5c6250), alpTurf = new THREE.Color(0x687059);
      const screeCol = new THREE.Color(0x7a7469);
      const STRATA = HAS_KIT && CFGS.MOUNT_STRATA_V1 !== false;
      const _mixOut = { v: 0 };
      const n = new THREE.Vector3(), light = new THREE.Vector3(-0.35, 0.82, 0.45).normalize();
      for (let i = 0; i < pa.count; i++) {
        const wx = CX + pa.getX(i), wz = CZ + pa.getZ(i);
        const y = mountainHeightAt(wx, wz);
        pa.setY(i, y);
        snowTerrainNormalAt(wx, wz, n);
        const slope = 1 - n.y;
        const grain = noiseAt(wx * 0.027 + 9, wz * 0.027 - 4);
        const bedrock = noiseAt(wx * 0.0081 - 37, wz * 0.0081 + 22);
        const cold = smooth01((3.5 - y) / 3.5) * (0.18 + 0.16 * grain);
        const faceLight = Math.max(0, n.dot(light));
        if (STRATA) {
          // --- GROUND MATERIAL: soil on shallow ground, banded rock on steep.
          // mtnStrataTint returns the "how bare is the bedrock here" weight and
          // writes a WARPED, non-parallel, per-bed-hued rock colour — the same
          // bedding field mtnTerrace used to cut the actual benches, so the
          // colour bands land ON the geometric risers instead of floating
          // across them like the old sin(y*0.19) ripple did.
          const bare = CBZ.mtnStrataTint(rc, wx - DX, wz - DZ, y, slope, faceLight, {
            rock: granite, rockDark: graniteDark,
            // bedding params IDENTICAL to the mtnTerrace call in mercyMacroA,
            // so the colour bands sit exactly on the geometric risers.
            step: 16, dip: 24, dipCell: 560, dipCell2: 155,
            slope0: 0.05, slope1: 0.30, salt: S_STRATA, aspect: 1, mixOut: _mixOut,
          });
          // soil/turf base, drier and greyer as it climbs toward the treeline
          c.copy(alpTurf).lerp(alpSoil, smooth01((y - 8) / 70));
          // scree/talus band: below the cliffs the ground is loose broken rock
          const scree = smooth01((bedrock - 0.42) / 0.30) * smooth01((slope - 0.07) / 0.13) *
                        (1 - smooth01((y - 150) / 90));
          c.lerp(screeCol, scree * 0.55);
          c.lerp(rc, Math.min(0.94, bare * (0.55 + 0.45 * smooth01((bedrock - 0.34) / 0.34))));
          // --- SNOW COVERAGE: altitude sets the line, slope sheds it, sun
          // aspect raises it on lit faces and drops it on shaded ones, two
          // noise octaves feather the edge. faceLight was already being
          // computed here and thrown away on brightness alone.
          const cover = CBZ.mtnSnowCover(wx - DX, wz - DZ, y, slope, faceLight, {
            line: 24, band: 58, aspect: 40, wob: 22, shed0: 0.13, shed1: 0.50, salt: S_SNOW,
          });
          rc.copy(snowShadow).lerp(snowLit, 0.70 + 0.27 * faceLight);
          rc.lerp(iceBlue, cold);
          c.lerp(rc, cover);
          // wind-scoured crowns keep a hint of blue-white even where rock wins
          c.lerp(iceBlue, cold * (1 - cover) * 0.5);
        } else {
          // ---- LEGACY colour path (MOUNT_STRATA_V1 = false) ----------------
          const cliff = smooth01((slope - 0.04) / 0.16);
          const brokenFace = smooth01((bedrock - 0.50) / 0.20);
          const highSnowLoad = smooth01((y - 14) / 86);
          const scour = cliff * smooth01((grain - 0.64) / 0.25);
          const rockMix = Math.min(0.88,
            cliff * (0.16 + brokenFace * 0.78) * (1 - highSnowLoad * 0.14) + scour * 0.05);
          c.copy(snowShadow).lerp(snowLit, 0.70 + 0.27 * faceLight);
          c.lerp(iceBlue, cold);
          if (rockMix > 0) {
            rc.copy(granite).lerp(graniteDark,
              smooth01((slope - 0.27) / 0.39) * (0.68 + (1 - faceLight) * 0.32));
            rc.multiplyScalar(0.94 + 0.06 * Math.sin(y * 0.19 + grain * 4));
            c.lerp(rc, rockMix);
          }
        }
        // The frozen lake is the terrain skin itself. The old ice disc and
        // three nearly-coplanar crack rings stacked above this flat basin and
        // shimmered from aircraft altitude.
        const iceD = Math.hypot(wx - (180 + DX), wz - (-1380 + DZ));
        if (iceD < 92) {
          const ring = 0.5 + 0.5 * Math.sin(iceD * 0.19 + Math.atan2(wz - (-1380 + DZ), wx - (180 + DX)) * 5.0);
          c.copy(lakeIce).lerp(lakeIceDeep, 0.12 + ring * 0.10);
        }
        // Eighty metres of tundra -> snow transition prevents the playable
        // cold biome from advertising its rectangular allocation boundary.
        const edgeD = Math.min(wx - MINX, MAXX - wx, wz - MINZ, MAXZ - wz);
        rc.copy(c); c.copy(tundraEdge).lerp(rc, smooth01(edgeD / 82));
        // Most of snow's form comes from its subtly cool shadow hue. A shallow
        // value multiplier preserves its high albedo instead of turning the
        // shaded half of every peak into slate-blue terrain.
        const shade = 0.84 + faceLight * 0.14;
        colors[i * 3] = c.r * shade;
        colors[i * 3 + 1] = c.g * shade;
        colors[i * 3 + 2] = c.b * shade;
      }
      pa.needsUpdate = true;
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      // Lighting direction is already baked per vertex above. Basic keeps that
      // authored snow/rock value without a second Lambert multiply, while the
      // shared shallow terrain-fog scale gives the massif atmospheric depth at
      // distance instead of leaving a self-lit white cardboard cutout.
      const groundMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, flatShading: false, fog: true,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
      });
      if (CBZ.terrainFogScale) CBZ.terrainFogScale(groundMat, 0.12);
      // unlit material — must darken with the day like the Lambert plate it
      // stands on, or it glows as a self-lit white massif at dawn/night
      if (CBZ.terrainDayTint) CBZ.terrainDayTint(groundMat);
      const g = new THREE.Mesh(geo, groundMat);
      g.position.set(CX, 0, CZ);
      g.matrixAutoUpdate = false; g.updateMatrix();
      g.receiveShadow = true;
      g.castShadow = true;
      g.userData.terrain = true;
      g.userData.worldSurface = true;
      g.userData.realGround = true;
      g.userData.distantLandmark = true;
      g.name = "mount-mercy-earth-terrain";
      g.frustumCulled = false;
      root.add(g);
      if (CBZ.registerCityGroundHeight) {
        CBZ.registerCityGroundHeight(mountainHeightAt, { name: "Mount Mercy terrain", biome: "snow" });
      }
      CBZ.cityDistantLandmarkFar = Math.max(CBZ.cityDistantLandmarkFar || 0, 5600);
      // Feather only beyond the snow plateau; a larger full plane underneath
      // made the biome visibly overlap the sea/terrain as a square tile.
      if (CBZ.makeBiomeEdgeRing) {
        CBZ.makeBiomeEdgeRing(root, {
          cx: CX, cz: CZ, hx: HX + 20, hz: HZ + 20, feather: 20, segments: 20,
          // Rides the footprint scale: with BIOME_ORGANIC_EDGES on this field
          // is what says "snow" outside the rect, and it is what the backdrop
          // ranges (world/terrain_overhaul.js snowSector) stand behind.
          spread: { west: 220 * FSC, east: 230 * FSC, north: 430 * FSC, south: 220 * FSC },
          inner: 0xe1e8e8, outer: 0x9fb2a8, featherNorm: 0.30,
          y: 0.006, seed: 0x53170, owner: "snow",
        });
      }
    })();

    // ---- the GREATER RANGE: 10 scaled families / 50 rounded summits -------
    (function greaterRangeGround() {
      if (CFGS.SNOW_TERRAIN_V2 === false) return;
      const gcx = (GREAT_MINX + GREAT_MAXX) * 0.5;
      const gcz = (GREAT_MINZ + GREAT_MAXZ) * 0.5;
      const gw = GREAT_MAXX - GREAT_MINX, gd = GREAT_MAXZ - GREAT_MINZ;
      // Same adaptive treatment as Mount Mercy: raise the count, then spend it
      // on the summits. This range's rectangle is mostly EMPTY (zero-height
      // cells are index-stripped below), so a uniform grid wasted most of its
      // vertices on triangles that get thrown away — the CDF puts them on the
      // ten families instead.
      const DENSG = Math.max(0.5, Math.min(2.4, +CFGS.MOUNT_MESH_DENSITY || 1)) * 0.9;
      const segX = Math.round(300 * DENSG), segZ = Math.round(216 * DENSG);
      let gxs = null, gzs = null;
      if (CBZ.mtnAdaptiveAxis && CBZ.mtnGridGeometry) {
        const PN = 44, GPEAK = 400;
        gxs = CBZ.mtnAdaptiveAxis(segX, GREAT_A_MINX, GREAT_A_MAXX, function (x) {
          let m = 0;
          for (let k = 0; k <= PN; k++) {
            const z = GREAT_A_MINZ + (GREAT_A_MAXZ - GREAT_A_MINZ) * (k / PN);
            const v = greatMacro(x, z); if (v > m) m = v;
          }
          return Math.pow(Math.min(1, m / GPEAK), 0.7);
        }, { floor: 0.30 });
        gzs = CBZ.mtnAdaptiveAxis(segZ, GREAT_A_MINZ, GREAT_A_MAXZ, function (z) {
          let m = 0;
          for (let k = 0; k <= PN; k++) {
            const x = GREAT_A_MINX + (GREAT_A_MAXX - GREAT_A_MINX) * (k / PN);
            const v = greatMacro(x, z); if (v > m) m = v;
          }
          return Math.pow(Math.min(1, m / GPEAK), 0.7);
        }, { floor: 0.30 });
        for (let i = 0; i < gxs.length; i++) gxs[i] = gxs[i] + DX - gcx;
        for (let i = 0; i < gzs.length; i++) gzs[i] = gzs[i] + DZ - gcz;
      }
      const geo = gxs ? CBZ.mtnGridGeometry(gxs, gzs)
                      : (function () { const g = new THREE.PlaneGeometry(gw, gd, segX, segZ); g.rotateX(-Math.PI / 2); return g; })();
      const pa = geo.attributes.position;
      const colors = new Float32Array(pa.count * 3);
      const c = new THREE.Color(), rc = new THREE.Color();
      // Distant families still need tonal range through fog, but their lit snow
      // is neutral and the blue component is limited to sky-facing shadows.
      // Neutral granite then reads as geology rather than a third blue layer.
      const snow = new THREE.Color(0xf8fafb), coldSnow = new THREE.Color(0xd2dde2);
      const shadeSnow = new THREE.Color(0xbac9d0);
      const granite = new THREE.Color(0x5f5b54), graniteDark = new THREE.Color(0x293033);
      const alpineFoot = new THREE.Color(0x566452);
      const screeCol = new THREE.Color(0x746e63);
      const STRATA_G = HAS_KIT && CFGS.MOUNT_STRATA_V1 !== false;
      const _mixG = { v: 0 };
      const n = new THREE.Vector3(), light = new THREE.Vector3(-0.36, 0.83, 0.43).normalize();
      for (let i = 0; i < pa.count; i++) {
        const wx = gcx + pa.getX(i), wz = gcz + pa.getZ(i);
        const y = greaterMercyHeightAt(wx, wz);
        pa.setY(i, y);
        greaterMercyNormalAt(wx, wz, n);
        const slope = 1 - n.y;
        const grain = noiseAt(wx * 0.011 + 39, wz * 0.011 - 71);
        const bedrock = noiseAt(wx * 0.0048 - 23, wz * 0.0048 + 54);
        const faceLight = Math.max(0, n.dot(light));
        if (STRATA_G) {
          // rock first (banded, warped, aspect-shaded), snow laid over it by a
          // real coverage model — same grammar as Mount Mercy, one scale up.
          const bare = CBZ.mtnStrataTint(rc, wx - DX, wz - DZ, y, slope, faceLight, {
            rock: granite, rockDark: graniteDark,
            // identical bedding params to greaterMercyMacroA's mtnTerrace call
            step: 34, dip: 52, dipCell: 1250, dipCell2: 340,
            slope0: 0.05, slope1: 0.32, salt: S_GSTRATA, aspect: 1, mixOut: _mixG,
          });
          c.copy(alpineFoot);
          const scree = smooth01((bedrock - 0.44) / 0.30) * smooth01((slope - 0.07) / 0.14) *
                        (1 - smooth01((y - 260) / 160));
          c.lerp(screeCol, scree * 0.5);
          c.lerp(rc, Math.min(0.92, bare * (0.55 + 0.45 * smooth01((bedrock - 0.36) / 0.34))));
          const cover = CBZ.mtnSnowCover(wx - DX, wz - DZ, y, slope, faceLight, {
            line: 46, band: 130, aspect: 70, wob: 40, shed0: 0.14, shed1: 0.54, salt: S_GSNOW,
          });
          rc.copy(coldSnow).lerp(snow, 0.68 + faceLight * 0.29);
          rc.lerp(shadeSnow, (1 - faceLight) * 0.22);
          c.lerp(rc, cover);
          // the geological root at the very feet stays, so no summit floats
          rc.copy(c); c.copy(alpineFoot).lerp(rc, smooth01((y - 4) / 30));
        } else {
          // ---- LEGACY colour path (MOUNT_STRATA_V1 = false) ----------------
          c.copy(coldSnow).lerp(snow, 0.68 + faceLight * 0.29);
          const cliff = smooth01((slope - 0.04) / 0.18);
          c.lerp(shadeSnow, cliff * (1 - faceLight) * 0.16);
          const highSnowLoad = smooth01((y - 18) / 150);
          const rockMix = Math.min(0.84,
            cliff * (0.13 + smooth01((bedrock - 0.50) / 0.20) * 0.79) *
            (1 - highSnowLoad * 0.12));
          if (rockMix > 0) {
            rc.copy(granite).lerp(graniteDark,
              smooth01((slope - 0.28) / 0.38) * (0.62 + (1 - faceLight) * 0.38));
            rc.multiplyScalar(0.94 + grain * 0.08);
            c.lerp(rc, rockMix);
          }
          rc.copy(c); c.copy(alpineFoot).lerp(rc, smooth01((y - 4) / 30));
        }
        const shade = 0.80 + faceLight * 0.18;
        colors[i * 3] = c.r * shade;
        colors[i * 3 + 1] = c.g * shade;
        colors[i * 3 + 2] = c.b * shade;
      }
      pa.needsUpdate = true;
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      // Keep only the actual mountain skin. PlaneGeometry stores a rectangular
      // grid, but zero-height cells are not part of the range and previously
      // rendered as a kilometre-wide white tile. The continent remains beneath
      // these indexed slopes, so every removed cell becomes ordinary earth.
      if (geo.index) {
        const src = geo.index.array, kept = [];
        for (let i = 0; i < src.length; i += 3) {
          const a = src[i], b = src[i + 1], d = src[i + 2];
          if (Math.max(pa.getY(a), pa.getY(b), pa.getY(d)) < 0.8) continue;
          kept.push(a, b, d);
        }
        geo.setIndex(kept);
      }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const rangeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, flatShading: false, fog: true,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
      });
      // Retain the distant landmark through normal city fog, but let it gain
      // atmospheric depth instead of remaining a full-white cardboard cutout.
      if (CBZ.terrainFogScale) CBZ.terrainFogScale(rangeMat, 0.12);
      // unlit — darken with the day in step with the lit ground (see
      // terrainDayTint: the luminance seam at the massif's foot was the tell)
      if (CBZ.terrainDayTint) CBZ.terrainDayTint(rangeMat);
      const mesh = new THREE.Mesh(geo, rangeMat);
      mesh.position.set(gcx, 0, gcz);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = "greater-mercy-rounded-alpine-range";
      mesh.userData.terrain = true;
      mesh.userData.worldSurface = true;
      mesh.userData.realGround = true;
      mesh.userData.sparseTerrain = true;
      mesh.userData.distantLandmark = true;
      mesh.userData.mountainFamilies = GREAT_MAJOR.length;
      mesh.userData.gaussianLobes = GREAT_LOBES.length;
      root.add(mesh);
      if (CBZ.registerCityGroundHeight) {
        CBZ.registerCityGroundHeight(greaterMercyHeightAt, {
          name: "Greater Mercy Range terrain", biome: "snow",
        });
      }
      // Do not colour the Greater Range's 3.2 x 2.3 km allocation rectangle.
      // Grow one organic alpine/tundra catchment around each real mountain
      // family instead; overlapping foothills merge, empty corners remain
      // ordinary country, and the visual/gameplay snow biome becomes much
      // larger without ever reading as a white square.
      if (CBZ.registerBiomeBlend) {
        CBZ.registerBiomeBlend({
          owner: "snow", name: "Greater Mercy alpine catchments",
          sources: GREAT_MAJOR.map(function (m) {
            const scaled = Math.pow(m.s, 0.62);
            return { x: m.x + DX, z: m.z + DZ, rx: 350 + 180 * scaled, rz: 310 + 165 * scaled };
          }),
          inner: 0xe8eef0, outer: 0xaebfba,
          roundness: 2.75, featherNorm: 0.30, seed: 0x6a4e91,
        });
      }
    })();

    // ---- THE RANGE: tall snow-capped PEAKS ringing the valley edges ------
    // Each peak = a rock cone + a snow-cap cone on top; base gets a collider
    // square so the player walks AROUND them. They sit on the rim, leaving a
    // traversable valley/plateau in the middle.
    (function peaks() {
      if (CFGS.SNOW_TERRAIN_V2 !== false) return;
      // ----------------------------------------------------------------
      //  REAL low-poly snow-mountain RANGE (replaces the flat cones).
      //  Each ridge = a displaced grid strip (cols along the ridge x rows
      //  deep) emitted as NON-INDEXED triangles so flat-shaded facets read
      //  crisp. Heights come from a seeded RIDGED-fbm noise → connected
      //  craggy ridgelines. Per-vertex COLOR by altitude+slope: rock base,
      //  ragged snowline, dark cliff faces, lit/shaded snow facets. A
      //  valleyGuard term forces the valley-facing edge to y=0 so the flat
      //  walkable floor is never lifted. All ridges merge to 2 meshes.
      //
      //  CONSOLIDATED (was its own hand-rolled copy of this math with a
      //  silently-drifted 0.42 snowline vs world/terrain.js's 0.48): both now
      //  call the ONE shared window.noise.buildRidgedRange helper in
      //  src/vendor/noise.js, so the noise + altitude/slope shading are
      //  byte-identical between the two ranges. Only the LAYOUT (rect edges,
      //  valley-side footGuard threshold, peak amplitudes) stays local — that
      //  is genuinely this biome's own geometry, not duplicated math.
      // ----------------------------------------------------------------
      const BGU = THREE.BufferGeometryUtils;
      const buildRidge = window.noise && window.noise.buildRidgedRange;
      if (!buildRidge) return;     // headless / noise.js missing: skip the range, biome still stands
      const NZ = window.noise;
      const SOLID = CFGS.SNOW_SOLID_RANGE !== false &&
        !!(NZ.rangeRidgedFbm && NZ.rangeVnoise && NZ.rangeShadeVert);

      // ----------------------------------------------------------------
      //  CLOSED MASSIF PAD (the SOLID path): same noise/shading family as
      //  buildRidgedRange, but three broad 2-D peak lobes and their saddles
      //  are multiplied by a sin border falloff (zero on all four edges), so
      //  this reads as a mountain group rather than one long triangular wall.
      //  The pad still closes on flat ground from every angle — no hanging
      //  back edge, no hollow shell. Faces are emitted with a
      //  consistent up-winding so the default FrontSide material works
      //  (half the fragment cost of the old DoubleSide sheets).
      //  Same call/return shape as buildRidgedRange: {geo, spine}.
      // ----------------------------------------------------------------
      function buildPad(T, p0, p1, depthDir, cfg) {
        const cols = cfg.cols, rows = cfg.rows + 2;   // +2 depth rows: the closed back wants resolution
        const peakAmp = cfg.peakAmp, depthLen = cfg.depthLen;
        const seedOff = cfg.seedOff, ns = cfg.noiseScale;
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        function sampleHeight(u, v, bx, bz) {
          if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
          // Smoothstep the closed border. The old sub-linear power climbed
          // almost vertically at the footprint edge, which made the whole
          // massif read as one giant triangular mound from the airfield.
          const edge = Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
          const border = edge * edge * (3 - 2 * edge);
          function lobe(cu, cv, su, sv, amp) {
            const du = (u - cu) / su, dv = (v - cv) / sv;
            return amp * Math.exp(-0.5 * (du * du + dv * dv));
          }
          // Five asymmetric peaks create a recognisable range silhouette. Max
          // (rather than sum) preserves real saddles between the summits; one
          // low broad lobe underneath joins them into walkable foothills.
          const base = lobe(0.51, 0.53, 0.50, 0.46, 0.11);
          const peaks = Math.max(
            lobe(0.15, 0.56, 0.13, 0.23, 0.65),
            lobe(0.35, 0.44, 0.15, 0.22, 0.82),
            lobe(0.56, 0.57, 0.15, 0.23, 1.00),
            lobe(0.76, 0.45, 0.14, 0.21, 0.78),
            lobe(0.89, 0.62, 0.10, 0.17, 0.52)
          );
          const crag = 0.74 + 0.26 * NZ.rangeRidgedFbm(
            (bx + seedOff) * ns, (bz - seedOff) * ns);
          const shoulder = 0.04 + base + peaks;
          return peakAmp * border * shoulder * crag;
        }
        const gx = [], gz = [], gy = [];
        for (let r = 0; r <= rows; r++) {
          gx[r] = []; gz[r] = []; gy[r] = [];
          for (let c = 0; c <= cols; c++) {
            const u = c / cols, v = r / rows;
            const bx = p0.x + dx * u + depthDir.x * (v * depthLen);
            const bz = p0.z + dz * u + depthDir.z * (v * depthLen);
            gx[r][c] = bx; gz[r][c] = bz;
            gy[r][c] = sampleHeight(u, v, bx, bz);
          }
        }
        const spine = [];
        for (let c = 0; c <= cols; c++) {
          let mh = 0, mr = 1;
          for (let r = 1; r <= rows; r++) if (gy[r][c] > mh) { mh = gy[r][c]; mr = r; }
          spine.push({ x: gx[mr][c], z: gz[mr][c], h: mh });
        }
        const tris = cols * rows * 2;
        const posA = new Float32Array(tris * 9), colA = new Float32Array(tris * 9);
        let pi = 0, ci = 0;
        const up = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
        // A fixed high southern light is baked into the vertex colours. This
        // keeps the one-draw Basic material stable at every time of day while
        // still giving each low-poly face a readable light/dark direction.
        const lightDir = new T.Vector3(0.38, 0.82, 0.42).normalize();
        const A = new T.Vector3(), B = new T.Vector3(), Cc = new T.Vector3(), Dd = new T.Vector3();
        const _cu = new T.Color();
        const palette = cfg.palette;
        function emitTri(a, b, c2) {
          e1.subVectors(b, a); e2.subVectors(c2, a);
          up.crossVectors(e1, e2);
          if (up.y < 0) { const t = b; b = c2; c2 = t; up.multiplyScalar(-1); } // consistent up-winding
          up.normalize();
          const upDot = up.y;
          const faceLight = Math.max(0.72, Math.min(1.03, 0.79 + 0.27 * up.dot(lightDir)));
          const verts = [a, b, c2];
          for (let k = 0; k < 3; k++) {
            const vv = verts[k];
            posA[pi++] = vv.x; posA[pi++] = vv.y; posA[pi++] = vv.z;
            const wob = NZ.rangeVnoise(vv.x * 0.02 + seedOff, vv.z * 0.02 - seedOff);
            // This local range is lower than the distant world giants. Feed a
            // taller shading reference so snow stays on the actual crowns;
            // using raw peakAmp painted almost every gentle slope pale blue,
            // visually merging the entire mountain into the snowfield.
            // Colour snowline only: the collision/rideable heightfield is
            // unchanged. A lower visual reference keeps roughly the upper
            // two-thirds snow-loaded instead of painting the whole foreground
            // range as a dark prop beside the white continuous terrain.
            NZ.rangeShadeVert(palette, vv.y, peakAmp * 0.72, upDot, wob, 0, _cu);
            _cu.multiplyScalar(faceLight);
            colA[ci++] = _cu.r; colA[ci++] = _cu.g; colA[ci++] = _cu.b;
          }
        }
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          A.set(gx[r][c], gy[r][c], gz[r][c]);
          B.set(gx[r][c + 1], gy[r][c + 1], gz[r][c + 1]);
          Cc.set(gx[r + 1][c], gy[r + 1][c], gz[r + 1][c]);
          Dd.set(gx[r + 1][c + 1], gy[r + 1][c + 1], gz[r + 1][c + 1]);
          emitTri(A, Cc, B); emitTri(B, Cc, Dd);
        }
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(posA, 3));
        g.setAttribute("color", new T.BufferAttribute(colA, 3));
        g.computeVertexNormals();
        const len2 = dx * dx + dz * dz || 1;
        const dir2 = depthDir.x * depthDir.x + depthDir.z * depthDir.z || 1;
        function heightAt(x, z) {
          const rx = x - p0.x, rz = z - p0.z;
          const u = (rx * dx + rz * dz) / len2;
          if (u < 0 || u > 1) return 0;
          const bx = p0.x + dx * u, bz = p0.z + dz * u;
          const v = ((x - bx) * depthDir.x + (z - bz) * depthDir.z) / (depthLen * dir2);
          return sampleHeight(u, v, bx + depthDir.x * v * depthLen, bz + depthDir.z * v * depthLen);
        }
        return { geo: g, spine, heightAt };
      }
      const build = SOLID ? buildPad : buildRidge;

      // -- palette: rock / ragged snow / cliff -----------------------------
      // Snow dominates the reachable massif; light granite remains visible in
      // erosion cuts to preserve its authored form without reading as a dark
      // polygon prop beside the continuous white terrain.
      const rangePalette = {
        rock: new THREE.Color(0x5d5952), rockDark: new THREE.Color(0x262b2e),
        snow: new THREE.Color(0xf9fafb), snowShade: new THREE.Color(0xd4dfe4),
      };

      // -- REAL MASSIF LAYOUT ------------------------------------------------
      // One broad mountain occupies the northern half of Mount Mercy itself.
      // Its full footprint lies inside the registered landmass and its southern
      // edge returns to y=0 before the lake/resort valley. No edge walls, no
      // distant sheets, no fake horizon geometry.
      const RESV = !!(CBZ.CONFIG && CBZ.CONFIG.MAP_RESERVE_V1);
      const fgEdges = [
        // Leave the low cabin on a usable shoulder while the ski
        // run occupies the broad centre of the massif.
        { p0: { x: MINX + 180, z: MINZ + 25 }, p1: { x: MAXX - 180, z: MINZ + 25 }, dir: { x: 0, z: 1 }, name: "Mount Mercy", depthLen: 315 },
      ];
      const fgGeoms = [], spines = [], groundFns = [];
      for (let ei = 0; ei < fgEdges.length; ei++) {
        const e = fgEdges[ei];
        const cfg = {
          cols: 72, rows: 24, depthLen: e.depthLen,
          peakAmp: 156 + rng() * 18,             // grounded multi-summit range, not a giant wall
          seedOff: 1000 + ei * 137 + rng() * 50,
          noiseScale: 0.012,
          footGuard: 0.28,                       // valleyGuard: y->0 by row ~28% (flat floor)
          palette: rangePalette,
        };
        const built = build(THREE, e.p0, e.p1, e.dir, cfg);
        fgGeoms.push(built.geo);
        spines.push({ edge: e, spine: built.spine, peakAmp: cfg.peakAmp });
        if (built.heightAt) groundFns.push(built.heightAt);
      }

      mountainHeightAt = function (x, z) {
        let h = 0;
        for (let i = 0; i < groundFns.length; i++) h = Math.max(h, groundFns[i](x, z));
        return h;
      };
      if (CBZ.registerCityGroundHeight) {
        CBZ.registerCityGroundHeight(mountainHeightAt, { name: "Mount Mercy", biome: "snow" });
      }
      const massifBounds = {
        minX: fgEdges[0].p0.x, maxX: fgEdges[0].p1.x,
        minZ: fgEdges[0].p0.z, maxZ: fgEdges[0].p0.z + fgEdges[0].depthLen,
      };
      if (layout && layout.reserve) layout.reserve("snow:real-massif", massifBounds, { pad: 2 });

      // MAP_RESERVE_V1: record the massif's TRUE footprint so the post-build
      // audit sees the mountain range, not just the flat feather skirt. Reserve
      // each ridge as its OWN rect (base segment extruded by its depth) rather
      // than one union box — a single AABB would falsely claim the empty SE
      // corner where the S ridge's x-span crosses the E ridge's z-span. All
      // share owner "snow", so they only ever flag against a DIFFERENT landmass.
      if (RESV && CBZ.worldLayout && CBZ.worldLayout.mapReserve) {
        const edgeRect = (e) => {
          const ax = e.p0.x, az = e.p0.z, bx = e.p1.x, bz = e.p1.z;
          const ex = e.dir.x * e.depthLen, ez = e.dir.z * e.depthLen;
          return {
            minX: Math.min(ax, bx, ax + ex, bx + ex), maxX: Math.max(ax, bx, ax + ex, bx + ex),
            minZ: Math.min(az, bz, az + ez, bz + ez), maxZ: Math.max(az, bz, az + ez, bz + ez),
          };
        };
        const all = fgEdges;
        for (let mi = 0; mi < all.length; mi++) {
          CBZ.worldLayout.mapReserve("massif:snow:" + mi, edgeRect(all[mi]), { owner: "snow", kind: "massif" });
        }
      }

      // -- MERGE: the one real ground mass -> one draw call -----------------
      // Vertex colour is the authored geology palette; Lambert supplies matte
      // directional form. MeshBasic made the snow self-lit and plasticky/glossy
      // beside the rest of the terrain because it ignored every scene light.
      // Vertex colours bake both geology bands and per-face slope shading.
      // Use them directly: the city's stacked Lambert lights flattened the
      // whole broad slope into one dark fog-coloured sheet at dusk. The baked
      // palette is held below white so the final sRGB pass cannot clip it.
      // This remains opaque/depth-writing. The reachable local massif opts out
      // of city-block fog: even a scaled fog pass was turning its full surface
      // into the horizon colour and recreating the see-through-sheet read.
      const rangeMat = SOLID
        ? (CBZ.terrainFogScale || function (m) { return m; })(new THREE.MeshLambertMaterial({
            // Vertex colours carry the complete granite/snow palette and the
            // directional face light. A white base avoids muddying it brown.
            color: 0xffffff, vertexColors: true, flatShading: true, fog: false,
            // The pad is generated as independently wound non-indexed facets.
            // Render both faces so no camera quadrant can lose half the mass;
            // it is still fully opaque and depth-writing below.
            side: THREE.DoubleSide,
            transparent: false, opacity: 1, depthTest: true, depthWrite: true,
          }))
        : new THREE.MeshLambertMaterial({
            color: 0xffffff, vertexColors: true, flatShading: true,
            side: THREE.DoubleSide, fog: true,
          });
      function mergeAddRange(geoms, cast) {
        if (!geoms.length) return null;
        let mesh;
        if (BGU && BGU.mergeBufferGeometries) {
          mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), rangeMat);
        } else {
          // manual Float32 concat fallback (position + color)
          let np = 0, nc = 0;
          for (const g of geoms) { np += g.attributes.position.array.length; nc += g.attributes.color.array.length; }
          const P = new Float32Array(np), Cc = new Float32Array(nc);
          let po = 0, co = 0;
          for (const g of geoms) {
            P.set(g.attributes.position.array, po); po += g.attributes.position.array.length;
            Cc.set(g.attributes.color.array, co); co += g.attributes.color.array.length;
          }
          const merged = new THREE.BufferGeometry();
          merged.setAttribute("position", new THREE.BufferAttribute(P, 3));
          merged.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
          merged.computeVertexNormals();
          mesh = new THREE.Mesh(merged, rangeMat);
        }
        mesh.castShadow = !!cast; mesh.receiveShadow = true;
        mesh.name = "mount-mercy-ground";
        // This one mesh spans the whole reachable massif. Treat it like every
        // other world surface so far-culling cannot hide the mountain while
        // leaving its ski-run/lift dressing floating in the distance.
        mesh.userData.terrain = true;
        mesh.userData.worldSurface = true;
        mesh.userData.realGround = true;
        mesh.userData.distantLandmark = true;
        // verts are baked in WORLD space, so a computed bounding sphere is
        // correct for auditing/raycasting. This is one draw and a permanent
        // city landmark, so skip object-sphere frustum toggles; the projection
        // plane remains the sole distance authority and cannot flicker around
        // oblique camera edges.
        if (mesh.geometry && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh);
        // Projection-only request: fog and city far-culling keep their normal
        // budgets. This merely lets the explicitly registered one-draw landmark
        // survive the airport/city distance instead of hard-clipping at 1400m.
        CBZ.cityDistantLandmarkFar = Math.max(CBZ.cityDistantLandmarkFar || 0, 2200);
        return mesh;
      }
      mergeAddRange(fgGeoms, true);
    })();

    // Frozen-lake colour/crack bands are baked into the single snow terrain.

    // ---- instanced SNOWY PINES (one draw call: trunk + canopy each) ------
    // TREES_V2 (config.js): the old pine was PHYSICALLY IMPOSSIBLE at the
    // margins — trunk geo centred and placed so its base sat at EXACTLY the
    // centre terrain sample (on alpine slopes up to ~46° the downhill edge
    // hovered in the air), and the canopy cone's base touched the trunk top
    // with ZERO overlap. V2: (a) the trunk is SEATED — its base drops below
    // the LOWEST sample under its footprint; (b) a 3-tier fir canopy (one
    // merged geo — still one IM) whose base sinks 0.5·sc INTO the trunk top;
    // (c) the snow cap rides the top tier and still crowns the tip; (d) a
    // per-tree hash01 vertical stretch (NO new rng draws) so the stand stops
    // reading as 130 clones. Every planted pine registers with
    // world/treeaudit.js. Draw calls unchanged: 3 InstancedMeshes.
    (function pines() {
      const COUNT = 130;
      const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
      if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("snow");
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5);
      const canopyG = (function () {
        if (!TREES2) return new THREE.ConeGeometry(1.5, 4.2, 6);
        // 3 stacked cones, base at y=0, total height 4.2 — each tier's base
        // sinks into the tier below (support-connected by construction).
        const merge = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
        const layers = [
          { r: 1.55, h: 2.0, y: 0 },
          { r: 1.18, h: 1.7, y: 1.5 },
          { r: 0.80, h: 1.45, y: 2.75 },
        ];
        if (merge) {
          const parts = [];
          for (const L of layers) {
            const c = new THREE.ConeGeometry(L.r, L.h, 6);
            c.translate(0, L.y + L.h / 2, 0);
            parts.push(c);
          }
          const g = merge(parts, false);
          if (g) return g;
        }
        const f = new THREE.ConeGeometry(1.5, 4.2, 6); f.translate(0, 2.1, 0); return f;
      })();
      // snow cap: V2 authors it base-at-y=0 so it can hug the TOP TIER of the
      // stacked canopy (overlapping it — chain-connected) and crown the tip.
      const capG = TREES2 ? new THREE.ConeGeometry(0.88, 1.6, 6)
        : new THREE.ConeGeometry(0.75, 1.9, 6);      // legacy: snow capping the upper canopy (conformal)
      if (TREES2) capG.translate(0, 0.8, 0);
      const trunkIM = new THREE.InstancedMesh(trunkG, mTrunk, COUNT);
      const canopyIM = new THREE.InstancedMesh(canopyG, mPine, COUNT);
      const capIM = new THREE.InstancedMesh(capG, mSnow, COUNT);
      trunkIM.castShadow = canopyIM.castShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pts = CBZ.cityScatterInRegion(region, COUNT, rng, 60);
      let n = 0;
      const terrainN = new THREE.Vector3();
      const tbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkG) : null;
      const cbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(canopyG) : null;
      const kbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(capG) : null;
      for (let i = 0; i < COUNT; i++) {
        const p = pts[i];
        // keep pines off the lake + the causeway mouth
        if (Math.hypot(p.x - (180 + DX), p.z - (-1380 + DZ)) < 100) continue;
        if (Math.abs(p.x - (470 + DX)) < 26 && p.z > MAXZ - 120) continue;
        if (inTown(p.x, p.z)) continue;          // T8 — no pines in the resort village
        if (CFGS.SNOW_TERRAIN_V2 !== false && snowTerrainNormalAt(p.x, p.z, terrainN).y < 0.69) continue;
        if (!claimNature(p.x, p.z, 2.2)) continue;
        const sc = 0.8 + rng() * 1.3;
        const gy = mountainHeightAt(p.x, p.z);
        const ry = rng() * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        if (TREES2) {
          // per-tree vertical stretch (hash01 — zero extra rng draws)
          const vst = 0.85 + (CBZ.hash01 ? CBZ.hash01(p.x, p.z, 9101) : 0.5) * 0.4;
          const trunkTop = gy + 1.6 * sc;
          const gu = CBZ.treeGroundUnder(mountainHeightAt, p.x, p.z, Math.max(0.32 * sc, 0.6));
          const seatRef = Math.min(gy, gu.min);
          const seatY = seatRef - 0.3;                 // SEATED below the downhill surface
          const span = trunkTop - seatY;
          // trunk (centred unit-1.6 geo): scale y so it spans [seatY, trunkTop]
          s.set(sc, span / 1.6, sc); v.set(p.x, (seatY + trunkTop) / 2, p.z);
          m4.compose(v, q, s); trunkIM.setMatrixAt(n, m4);
          const parts = [];
          if (tbb) CBZ.treeAabbPush(parts, m4, tbb.min.x, tbb.min.y, tbb.min.z, tbb.max.x, tbb.max.y, tbb.max.z);
          // canopy (base-at-0 geo): base sinks 0.5·sc INTO the trunk top
          const canopyBase = trunkTop - 0.5 * sc;
          s.set(sc, sc * vst, sc); v.set(p.x, canopyBase, p.z);
          m4.compose(v, q, s); canopyIM.setMatrixAt(n, m4);
          if (cbb) CBZ.treeAabbPush(parts, m4, cbb.min.x, cbb.min.y, cbb.min.z, cbb.max.x, cbb.max.y, cbb.max.z);
          // snow cap rides the top tier (local base 2.75): overlaps it and
          // pokes ~0.1 past the tip — a crown of snow, chain-connected.
          v.set(p.x, canopyBase + 2.7 * sc * vst, p.z);
          m4.compose(v, q, s); capIM.setMatrixAt(n, m4);
          if (kbb) CBZ.treeAabbPush(parts, m4, kbb.min.x, kbb.min.y, kbb.min.z, kbb.max.x, kbb.max.y, kbb.max.z);
          if (tbb && cbb && kbb) CBZ.treeRegisterTree("snow", seatRef, parts);
          n++;
          continue;
        }
        // trunk
        s.set(sc, sc, sc); v.set(p.x, gy + 0.8 * sc, p.z);
        m4.compose(v, q, s); trunkIM.setMatrixAt(n, m4);
        // canopy
        v.set(p.x, gy + (1.6 + 2.1) * sc, p.z); m4.compose(v, q, s); canopyIM.setMatrixAt(n, m4);
        // snow cap — hugs the top ~44% of the canopy, flush with its slope (same q so facets align)
        v.set(p.x, gy + 4.9 * sc, p.z); m4.compose(v, q, s); capIM.setMatrixAt(n, m4);
        n++;
      }
      trunkIM.count = canopyIM.count = capIM.count = n;
      trunkIM.instanceMatrix.needsUpdate = canopyIM.instanceMatrix.needsUpdate = capIM.instanceMatrix.needsUpdate = true;
      // r128 frustum-culls an InstancedMesh by its GEOMETRY's bounding sphere
      // (a ~2u cone at the origin — nowhere near the instances), so these
      // culled in and out at the wrong times. Hand the geometries a sphere
      // that actually covers the snow region → correct culling, and the whole
      // stand (plus its shadow-pass cost) drops when you look away.
      const bs = new THREE.Sphere(
        new THREE.Vector3((MINX + MAXX) / 2, 6, (MINZ + MAXZ) / 2),
        Math.hypot(MAXX - MINX, MAXZ - MINZ) / 2 + 14);
      trunkG.boundingSphere = bs.clone(); canopyG.boundingSphere = bs.clone(); capG.boundingSphere = bs.clone();
      root.add(trunkIM); root.add(canopyIM); root.add(capIM);
    })();

    // ---- instanced ROCKY OUTCROPS + SNOWDRIFTS ---------------------------
    (function rocksAndDrifts() {
      const RC = 40;
      const rockG = new THREE.DodecahedronGeometry(1.1, 0);
      const rockIM = new THREE.InstancedMesh(rockG, mRock, RC);
      rockIM.castShadow = true; rockIM.receiveShadow = true;
      const driftG = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      const driftIM = new THREE.InstancedMesh(driftG, mSnowShade, RC);
      driftIM.receiveShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pr = CBZ.cityScatterInRegion(region, RC, rng, 70);
      const pd = CBZ.cityScatterInRegion(region, RC, rng, 50);
      let rn = 0, dn = 0;
      for (let i = 0; i < RC; i++) {
        const a = pr[i], sc = 0.7 + rng() * 1.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        // T8 — skip rocks/drifts that fall in the resort village (keep the rng
        // draws above so determinism + the drift below are unchanged).
        if (!inTown(a.x, a.z) && claimNature(a.x, a.z, Math.max(0.9, sc * 0.9))) {
          s.set(sc, sc * (0.7 + rng() * 0.5), sc); v.set(a.x, mountainHeightAt(a.x, a.z) + sc * 0.35, a.z);
          m4.compose(v, q, s); rockIM.setMatrixAt(rn++, m4);
        } else { rng(); }                        // consume the height-jitter draw
        const b = pd[i], dc = 1.4 + rng() * 3.2;
        s.set(dc, dc * (0.32 + rng() * 0.2), dc * (0.7 + rng() * 0.6));
        if (!inTown(b.x, b.z) && openNature(b.x, b.z, dc * 0.8)) {
          v.set(b.x, mountainHeightAt(b.x, b.z) + 0.02, b.z); m4.compose(v, q, s); driftIM.setMatrixAt(dn++, m4);
        }
      }
      rockIM.count = rn; driftIM.count = dn;
      rockIM.instanceMatrix.needsUpdate = driftIM.instanceMatrix.needsUpdate = true;
      root.add(rockIM); root.add(driftIM);
    })();

    // ---- SKI LODGE (enterable; fireplace + warm interior) ----------------
    (function lodge() {
      const lx = 360 + DX, lz = -1250 + DZ, w = 22, d = 16, storeys = 2;
      let b = null;
      if (CBZ.cityMakeBuilding) {
        b = CBZ.cityMakeBuilding(root, lx, lz, w, d, storeys, COL.timber, 0, { stairs: true });
        if (b && CBZ.cityFurnishApartment) {
          const fh = b.FH || 4;
          for (let k = 0; k < storeys; k++) CBZ.cityFurnishApartment(b, k * fh, ((lx | 0) + (lz | 0) + k) >> 1);
        }
      } else {
        b = box(lx, 4, lz, w, 8, d, mTimber, true);
      }
      // snowy A-frame roof slab on top (visual)
      box(lx, storeys * 4 + 1.4, lz, w + 2, 2.6, d + 2, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      // a warm fireplace glow box flush to the front wall (WHY: "cozy" = light + warmth)
      const fire = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 0.6),
        new THREE.MeshLambertMaterial({ color: COL.timberDk, emissive: COL.ember, emissiveIntensity: 0.85 }));
      fire.position.set(lx - w / 2 + 1.5, 1.4, lz - d / 2 + 0.4);
      root.add(fire);
      const fl = new THREE.PointLight(COL.ember, 0.9, 22, 2);
      fl.position.set(lx - w / 2 + 2.2, 2, lz - d / 2 + 1.4);
      root.add(fl);
      // smoking chimney
      box(lx + w / 2 - 2, storeys * 4 + 2.6, lz, 1.6, 4, 1.6, mTimberDk, false);
      // register a lot so it reads as a real building on the map, if supported
      if (b && city.lots) {
        city.lots.push({ cx: lx, cz: lz, w, d, kind: "lodge", district: "snow",
          building: Object.assign({}, b, { name: "Alpine Ski Lodge",
            door: { x: lx, z: lz - d / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      const grp = new THREE.Group(); grp.position.set(lx, storeys * 4 + 4, lz); root.add(grp);
      tag(grp, "ALPINE LODGE", 0);
    })();

    // ---- mountain CABIN ---------------------------------------------------
    // One low hunter's cabin remains tucked into a broad shoulder. The former
    // frozen outpost and its 12m radio mast were an isolated vertical building
    // carved directly into the hero mountain; remove both the structure and
    // its artificial flat shelf so this face is uninterrupted geology again.
    (function mountainCabin() {
      // ---- a small log cabin tucked near the trees — enterable, one room ----
      const cx = 600 + DX, cz = -1600 + DZ, cw = 9, cd = 7;
      let cb = null;
      if (CBZ.cityMakeBuilding) {
        try {
          cb = CBZ.cityMakeBuilding(root, cx, cz, cw, cd, 1, COL.timber, 0, { retail: true, glassKind: "clear", facade: "retail" });
          if (cb && CBZ.cityFurnishApartment) CBZ.cityFurnishApartment(cb, 0, (cx | 0) + (cz | 0));
        } catch (e) { cb = null; }   // never let a rejected opt sink the biome
      }
      if (!cb) box(cx, 2, cz, cw, 4, cd, mTimber, true);   // headless/no-buildings.js fallback: old sealed shell
      box(cx, 4.6, cz, cw + 1.4, 1.6, cd + 1.4, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      box(cx + 3, 5.4, cz - 2, 1, 2, 1, mTimberDk, false);  // chimney
      const cabL = new THREE.PointLight(0xffd9a0, 0.4, 14, 2);
      cabL.position.set(cx, 2.4, cz - 3.2); root.add(cabL);
      const g1 = new THREE.Group(); g1.position.set(cx, 6.6, cz); root.add(g1);
      tag(g1, "HUNTER'S CABIN", 0);
      if (cb && city.lots) {
        city.lots.push({ cx, cz, w: cw, d: cd, kind: "cabin", district: "snow",
          building: Object.assign({}, cb, { name: "Hunter's Cabin",
            door: { x: cx, z: cz - cd / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      // ---- REST/WARM-UP interaction: a small zone at the fireplace corner ----
      // a hunter ducking out of the cold gets a small HP top-up (mirrors the
      // hospital's healFull idiom in shops.js, just free + tiny + on a cooldown
      // so it reads as "resting by a fire", not a full-heal battery).
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const warmSpot = { x: cx - cw / 2 + 1.5, z: cz - cd / 2 + 1.2, kind: "cabin-hearth" };
        let nextWarmT = 0;
        CBZ.interactions.registerZone({
          id: "snow-cabin-hearth", kind: "cabin-hearth", radius: 3.2,
          find: function (px, pz) {
            const dx = warmSpot.x - px, dz = warmSpot.z - pz;
            return (dx * dx + dz * dz) < 3.2 * 3.2 ? warmSpot : null;
          },
          options: [{
            id: "cabin-warmup", slot: "e",
            label: function () { return (CBZ.now || 0) < nextWarmT ? "Warming up (still cozy)" : "Warm up by the fire"; },
            canShow: function () { return (CBZ.now || 0) >= nextWarmT; },
            onSelect: function () {
              nextWarmT = (CBZ.now || 0) + 120000;      // ~2 min cooldown — a rest, not a battery
              const P = CBZ.player;
              if (P && P.hp != null && P.maxHp) P.hp = Math.min(P.maxHp, P.hp + Math.round(P.maxHp * 0.08));
              if (CBZ.sfx) CBZ.sfx("door");
              CBZ.city.note("You warm up by the hearth — the cold eases off.", 2.2);
            },
          }],
        });
      }

    })();

    // ---- CHAIRLIFT line up a slope (towers + cable + moving chairs) ------
    // WHY: it carries skiers up to the ski run; chairs glide on the cable.
    const lift = { chairIM: null, baseX: 300 + DX, baseZ: -1275 + DZ, topX: 470 + DX, topZ: -1655 + DZ, towerTopY: 16, chairY: 10, n: 8, t: 0 };
    (function chairlift() {
      const dx = lift.topX - lift.baseX, dz = lift.topZ - lift.baseZ;
      const span = Math.hypot(dx, dz);
      const ux = dx / span, uz = dz / span;
      const cableY0 = mountainHeightAt(lift.baseX, lift.baseZ) + 12.6;
      const cableY1 = mountainHeightAt(lift.topX, lift.topZ) + 18.6;
      lift.cableY0 = cableY0; lift.cableY1 = cableY1;
      // Towers start on the same sampled mountain surface used by player
      // physics and reach the cable above it.
      const towers = 5;
      for (let i = 0; i <= towers; i++) {
        const t = i / towers;
        const x = lift.baseX + dx * t, z = lift.baseZ + dz * t;
        const groundY = mountainHeightAt(x, z);
        const cableY = cableY0 + (cableY1 - cableY0) * t;
        const h = Math.max(7, cableY - groundY);
        box(x, groundY + h / 2, z, 0.8, h, 0.8, mSteel, true);
        box(x, cableY, z, 4, 0.4, 0.4, mSteel, false);
      }
      lift.span = span; lift.ux = ux; lift.uz = uz;
      // CABLE: a thin tube from base-top to top-top (two strands = up/down)
      const cableMat = new THREE.MeshLambertMaterial({ color: COL.cable });
      for (const off of [-1.4, 1.4]) {
        const path = new THREE.LineCurve3(
          new THREE.Vector3(lift.baseX + uz * off, cableY0, lift.baseZ - ux * off),
          new THREE.Vector3(lift.topX + uz * off, cableY1, lift.topZ - ux * off));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 1, 0.08, 4, false), cableMat);
        root.add(tube);
      }
      // instanced CHAIRS (one draw call) — positions animated in onUpdate
      const chairG = new THREE.BoxGeometry(1.4, 0.9, 0.8);
      lift.chairIM = new THREE.InstancedMesh(chairG, cmat(COL.chair), lift.n);
      lift.chairIM.castShadow = true;
      root.add(lift.chairIM);
      // place once so it's correct even if onUpdate is throttled
      placeChairs(0);
    })();

    function placeChairs(t) {
      if (!lift.chairIM) return;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(lift.ux, lift.uz));
      for (let i = 0; i < lift.n; i++) {
        // loop fraction 0..1 along the up strand (down strand offset by half)
        let f = ((i / lift.n) + t) % 1;
        const off = (i % 2 === 0) ? 1.4 : -1.4;        // alternate strands
        const x = lift.baseX + (lift.topX - lift.baseX) * f + lift.uz * off;
        const y = lift.cableY0 + (lift.cableY1 - lift.cableY0) * f - 1.2;
        const z = lift.baseZ + (lift.topZ - lift.baseZ) * f - lift.ux * off;
        v.set(x, y, z); m4.compose(v, q, s); lift.chairIM.setMatrixAt(i, m4);
      }
      lift.chairIM.instanceMatrix.needsUpdate = true;
    }

    // ---- SKI RUN with slalom gates (red/blue poles down the slope) -------
    (function skiRun() {
      const sx = 470 + DX, sz0 = -1680 + DZ, sz1 = -1295 + DZ;     // summit to resort valley
      // A segmented groomed strip follows the exact real-ground oracle. It is
      // world-space geometry, so there is no flat plane cutting through the hill.
      const segZ = 48, halfW = 13;
      const runGeo = new THREE.PlaneGeometry(halfW * 2, sz1 - sz0, 2, segZ);
      runGeo.rotateX(-Math.PI / 2);
      const pa = runGeo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const wz = (sz0 + sz1) / 2 + pa.getZ(i);
        const wx = snowRunXAt(wz) + pa.getX(i);
        pa.setXYZ(i, wx, mountainHeightAt(wx, wz) + 0.14, wz);
      }
      pa.needsUpdate = true; runGeo.computeVertexNormals(); runGeo.computeBoundingSphere();
      const runMat = new THREE.MeshLambertMaterial({
        color: 0xeaf2f7,
        // Coplanar snow flickered into disconnected white scraps at airfield
        // distance. Bias this authored groomed strip toward the camera in depth
        // without lifting its walkable geometry off the real mountain oracle.
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const run = new THREE.Mesh(runGeo, runMat);
      run.userData.mountMercySkiRun = true;
      run.receiveShadow = true;
      root.add(run);
      // slalom gate poles (instanced — alternating sides)
      const gates = 9;
      const poleG = new THREE.CylinderGeometry(0.14, 0.14, 2.4, 5);
      const poleIM = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: COL.flag }), gates);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < gates; i++) {
        const t = (i + 0.5) / gates;
        const z = sz0 + (sz1 - sz0) * t;
        const x = snowRunXAt(z) + (i % 2 === 0 ? -7 : 7);
        v.set(x, mountainHeightAt(x, z) + 1.2, z); m4.compose(v, q, s); poleIM.setMatrixAt(i, m4);
      }
      poleIM.instanceMatrix.needsUpdate = true;
      root.add(poleIM);
    })();

    // ============================================================
    //  PINECREST — the alpine resort VILLAGE, grown from the reusable generator
    //  on the flat slope-base SE of the lodge (T8). Now that the keystone (T1)
    //  wired the arena, the lodge/outfitter/clinic/gear-pawn become REAL buyable,
    //  walk-in, staffed businesses for the mountain visitors regionlife streams
    //  (skiers/hikers). FALLBACK: if towngen / the recipe is absent this no-ops
    //  and the slopes above stand alone (the inTown skips were HAS_TOWN-gated →
    //  zero regression).
    // ============================================================
    if (HAS_TOWN) {
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, Object.assign({}, CBZ.CITY_TEMPLATES.pinecrest, {
        cx: TOWN_CX, cz: TOWN_CZ, region: TOWN, rng: rng,
        name: "Pinecrest", district: "snow", integratedSkyline: true,
      }));
      // WORK-ANCHORS at the lodge + outfitter so the resort staffs up (same
      // schedule/goal brain the mainland uses). Feature-detected.
      if (town && CBZ.registerWorkAnchor) {
        const findLot = function (kw) {
          return (town.lots || []).find(function (l) {
            return l.building && l.building.shop && l.building.name &&
              l.building.name.toUpperCase().indexOf(kw) >= 0;
          });
        };
        const lodge = findLot("LODGE") || (town.lots || []).find(function (l) { return l.building && l.building.shop; });
        const outfitter = findLot("OUTFITTER") || findLot("OUTFIT") || findLot("GEAR");
        for (const a of [lodge, outfitter]) {
          if (!a || !a.building || !a.building.vendorSpot) continue;
          try {
            CBZ.registerWorkAnchor({
              biome: "snow", kind: "shop", role: "shopkeeper",
              x: a.cx, z: a.cz, cap: 1,
              spots: [{ x: a.building.vendorSpot.x, z: a.building.vendorSpot.z }],
              home: { x: a.cx, z: a.cz },
            });
          } catch (e) {}
        }
      }
    }

    // ============================================================
    //  CAUSEWAY: winding snowy road deck south toward the speedway,
    //  with instanced guardrail posts. North end = the snow shore (MAXZ,
    //  rides the dial); south end = CAUSEWAY_MAXZ, which is the speedway
    //  hand-off OR the Commerce Annex's north shore, whichever comes first —
    //  see causewayCut at the top of this file. The deck stretches to cover
    //  however far the island moves and stops where a city begins.
    // ============================================================
    (function causeway() {
      // CW_CX / CW_OUTER_HW are module constants precisely so the clearance
      // test above and the geometry here can never disagree about where this
      // road is. The 463..477 rect is the FALLBACK deck's own narrower body.
      const rMinX = 463 + DX, rMaxX = 477 + DX, rMinZ = MAXZ, rMaxZ = CAUSEWAY_MAXZ;
      const cxMid = CW_CX;
      if (CBZ.buildHighway) {
        // REAL wide plowed concrete highway over the water toward the speedway.
        // heightAt: grade-follow world/terrain.js relief (it's exactly 0 over
        // this rect's flat playable footprint, so this is a free, safe hook —
        // it only matters if the deck ever extends nearer the backdrop rim).
        CBZ.buildHighway(root, {
          path: [{ x: cxMid, z: rMinZ }, { x: cxMid, z: rMaxZ }],
          width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "concrete",
          guardrail: false, elevated: false, rng: rng,
          heightAt: CBZ.terrainHeight,
        });
        // snow berms flanking the wider deck (visual edge + read). The EAST
        // berm is split around z=-950: the Ironjaw causeway (arena_fights.js)
        // T-junctions into this deck there, and an unbroken berm would stand
        // 0.2 m proud across the junction mouth.
        for (const ex of [cxMid - 13.2, cxMid + 13.2]) {
          const runs = (ex > cxMid) ? [[rMinZ, -966], [-934, rMaxZ]] : [[rMinZ, rMaxZ]];
          for (const seg of runs) {
            const z0 = seg[0], z1 = seg[1];
            if (z1 - z0 <= 0) continue;
            const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, z1 - z0), mSnowShade);
            berm.position.set(ex, 0.3, (z0 + z1) / 2);
            berm.receiveShadow = true; root.add(berm);
          }
        }
        return;
      }
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      // dark plowed road deck (a touch above the snow plane)
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(rMaxX - rMinX, rMaxZ - rMinZ),
        new THREE.MeshLambertMaterial({ color: 0x3b3f45 }));
      deck.rotation.x = -Math.PI / 2;
      deck.position.set(cxMid, 0.06, (rMinZ + rMaxZ) / 2);
      deck.receiveShadow = true;
      root.add(deck);
      // snow berms either side (visual edge + read)
      for (const ex of [rMinX - 1.2, rMaxX + 1.2]) {
        const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, rMaxZ - rMinZ), mSnowShade);
        berm.position.set(ex, 0.3, (rMinZ + rMaxZ) / 2);
        berm.receiveShadow = true; root.add(berm);
      }
      // GUARDRAIL posts (instanced, both sides) — short, non-blocking visuals
      const POSTS = 2 * 24;
      const postG = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 5);
      const postIM = new THREE.InstancedMesh(postG, mSteel, POSTS);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const z = rMinZ + (rMaxZ - rMinZ) * t;
        for (const ex of [rMinX - 0.5, rMaxX + 0.5]) {
          v.set(ex, 0.5, z); m4.compose(v, q, s); postIM.setMatrixAt(k++, m4);
        }
      }
      postIM.count = k; postIM.instanceMatrix.needsUpdate = true;
      root.add(postIM);
    })();

    // ---- LIFE: the resort's own people (low live count per spec) ---------
    //
    //  THE MOUNTAIN REGISTERED A "ski instructor" WORK ANCHOR AND THEN CAST
    //  ALL FIVE OF ITS BODIES AS "hiker". A slope with a chairlift, a groomed
    //  run and a lodge, worked by nobody — the anchor below has been advertising
    //  a job since the day it shipped and no body in this world has ever held
    //  it. The spot list is unchanged and so is its ORDER; only the `job` each
    //  spot deals has changed, so no draw on `lr` moves and the snow biome is
    //  byte-identical for a given seed.
    //
    //  Each of these is a real trade in aigoals.js's CITY_JOBS: "ski instructor"
    //  and "skier" were already there (anchor "slope"), and "ski patrol" and
    //  "lift operator" are registered against the same anchor by
    //  city/citystaff.js. So they commute, work a shift and get paid — they are
    //  not four new labels.
    (function life() {
      if (!CBZ.cityMakePed || !CBZ.cityPeds) return;
      const spots = [
        // lift base: the operator who actually runs the chairlift, and the
        // instructor whose class meets at the bottom of it.
        { x: 360 + DX, z: -1232 + DZ, job: "ski instructor" },               // outside the lodge
        { x: 250 + DX, z: -1190 + DZ, job: "lift operator" },                // the chairlift base
        { x: 470 + DX, z: -1320 + DZ, job: "ski patrol" },                   // bottom of the run
        { x: 590 + DX, z: -1585 + DZ, job: "skier" },                        // up by the cabin
        { x: 190 + DX, z: -1430 + DZ, job: "hiker" },                        // by the lake — the one
                                                                             // genuinely off-piste body
      ];
      const lr = mulberry(0xA17 ^ (CX | 0));
      const populationEntries = [];
      for (const sp of spots) {
        try {
          const opts = {
            job: sp.job, archetype: "resident", behavior: "wander",
            wealth: 0.4 + lr() * 0.3, armed: false,
          };
          if (CBZ.npcLife && CBZ.npcLife.definePopulation) {
            populationEntries.push({ profile: "cityResident", placement: { x: sp.x, z: sp.z, rng: lr }, overrides: opts });
            continue;
          }
          const ped = CBZ.npcLife
            ? CBZ.npcLife.spawnCity("cityResident", { x: sp.x, z: sp.z, parent: root, rng: lr }, opts)
            : CBZ.cityMakePed(sp.x, sp.z, lr, opts);
          if (ped && !CBZ.npcLife) {
            root.add(ped.group);
            if (CBZ.cityPeds.indexOf(ped) < 0) CBZ.cityPeds.push(ped);
          }
        } catch (e) { /* one bad ped can't sink the biome */ }
      }
      if (populationEntries.length && CBZ.npcLife && CBZ.npcLife.definePopulation) {
        CBZ.npcLife.definePopulation("snow-authored", { root: root, entries: populationEntries });
      }
      // Census only: these five man themselves through npcLife.definePopulation,
      // so citystaff.js must not be told the slope is five people short of
      // itself. Nothing here posts a body.
      if (CBZ.cityStaffVenue) {
        const JOBS = { "ski instructor": 1, "lift operator": 1, "ski patrol": 1, skier: 1, hiker: 1 };
        CBZ.cityStaffVenue("snow", {
          stations: spots.length, note: "lodge, lift base, ski run",
          census: function () {
            const peds = CBZ.cityPeds || [];
            let n = 0;
            for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p && !p.dead && JOBS[p.job]) n++; }
            return Math.min(spots.length, n);
          },
        });
      }
      // NO FISHING STATION HERE, deliberately. The obvious place for one is the
      // lake at (180, -1380) — but it is a FROZEN lake, drawn as the terrain
      // skin itself (see the flatCircleFactor above and the ice colour bands),
      // not as water. Registering a spot on it would put an angler on solid ice
      // pulling live mackerel out of ground, which is the class of lie this
      // wave exists to remove. Ice fishing needs a hole in the ice; when
      // somebody draws one, this is where the station goes.
    })();

    // ============================================================
    //  SNOWFALL: ONE THREE.Points cloud (a few hundred recycled flakes),
    //  VISIBLE only while the player stands in the snow biome — so it is
    //  free everywhere else (no per-frame work when hidden).
    // ============================================================
    (function snowfall() {
      if (CFGS.SNOWFALL_POINTS !== true) return;
      const N = 420, SPAN = 120, TOP = 70;
      const pos = new Float32Array(N * 3);
      const vel = new Float32Array(N);       // fall speed per flake
      const sway = new Float32Array(N);      // sway phase
      // seed deterministically (local rng — no Math.random)
      const fr = mulberry(0xF1A4E5);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (fr() - 0.5) * SPAN;
        pos[i * 3 + 1] = fr() * TOP;
        pos[i * 3 + 2] = (fr() - 0.5) * SPAN;
        vel[i] = 6 + fr() * 8;
        sway[i] = fr() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pmat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.55, sizeAttenuation: true,
        transparent: true, opacity: 0.9, depthWrite: false,
      });
      const points = new THREE.Points(geo, pmat);
      points.frustumCulled = false;
      points.visible = false;
      // parented to scene root; we recentre it on the player each frame
      root.add(points);

      CBZ.onUpdate(37.7, function (dt) {
        const P = CBZ.player;
        if (!P || !P.pos) { if (points.visible) points.visible = false; return; }
        const inSnow = CBZ.cityBiomeAt && CBZ.cityBiomeAt(P.pos.x, P.pos.z) === "snow";
        if (!inSnow) { if (points.visible) points.visible = false; return; }
        points.visible = true;
        // keep the flake box centred on the player so a small cloud feels global
        const cx = P.pos.x, cz = P.pos.z, cy = P.pos.y || 0;
        const arr = geo.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const j = i * 3;
          let ly = arr[j + 1] - vel[i] * dt;           // fall (local y, recycled)
          if (ly < 0) ly += TOP;                       // recycle to the top
          arr[j + 1] = ly;
          sway[i] += dt * 1.4;
          arr[j] += Math.sin(sway[i]) * dt * 1.1;      // drift
          // wrap horizontally within the span around the player
          let lx = arr[j], lz = arr[j + 2];
          if (lx > SPAN / 2) lx -= SPAN; else if (lx < -SPAN / 2) lx += SPAN;
          if (lz > SPAN / 2) lz -= SPAN; else if (lz < -SPAN / 2) lz += SPAN;
          arr[j] = lx; arr[j + 2] = lz;
        }
        geo.attributes.position.needsUpdate = true;
        points.position.set(cx, cy, cz);
      });
    })();

    // ---- CHAIRLIFT animation (slow glide; cheap; only writes a matrix) ---
    CBZ.onUpdate(37.8, function (dt) {
      lift.t = (lift.t + dt * 0.012) % 1;     // very slow loop
      placeChairs(lift.t);
    });

    // ============================================================
    //  WORK-ANCHOR — the ski instructor's day: the lift base, the slope, the
    //  lodge. The aigoals brain routes ski instructors / skiers here on the
    //  schedule. WHY: the slope is WORKED — instructors run the run, skiers
    //  ride the lift and ski down. The lodge is home/base. Reuses the lift
    //  base / ski-run / lodge coords already built (no new geometry).
    //   ski run: top (470,-1720) .. bottom (470,-1300); lift base (240,-1180);
    //   lodge (360,-1250).
    // ============================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "snow", kind: "slope", role: "ski instructor",
        x: 240 + DX, z: -1180 + DZ, cap: 4,
        home: { x: 360 + DX, z: -1250 + DZ },              // the ski lodge
        spots: [
          { x: 240 + DX, z: -1180 + DZ },                   // the chairlift base
          { x: 470 + DX, z: -1320 + DZ },                   // bottom of the ski run
          { x: 470 + DX, z: -1700 + DZ },                   // top of the ski run
          { x: 360 + DX, z: -1232 + DZ },                   // back by the lodge
        ],
      });
    }

    // ============================================================
    //  REGISTER the regions (the archipelago contract).
    // ============================================================
    CBZ.registerCityRegion(city, {
      name: "Mount Mercy", subtitle: "Alpine Range", biome: "snow", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8,
    });
    CBZ.registerCityRegion(city, {
      name: "Greater Mercy Range", subtitle: "Ten Summit Alpine System", biome: "snow", kind: "rect",
      minX: GREAT_MINX, maxX: GREAT_MAXX, minZ: GREAT_MINZ, maxZ: GREAT_MAXZ, pad: 8,
      // This is a navigation/ground-height envelope, not a rectangular floor.
      // Let the continent render between its sparse connected summits.
      underlay: true,
    });
    // The 24 m highway deck, off the ONE lane definition (CW_CX/CW_HW) rather
    // than a fourth copy of "458..482, centre 470". North end is the live snow
    // shore; south end is causewayCut's answer, so this record can never claim
    // ground the deck no longer covers — which is what let the old span sit on
    // top of the Commerce Annex with the region registry none the wiser.
    CBZ.registerCityRegion(city, {
      name: "Mercy Causeway", subtitle: "Alpine Range", kind: "rect",
      minX: CW_CX - CW_HW, maxX: CW_CX + CW_HW, minZ: MAXZ, maxZ: CAUSEWAY_MAXZ, pad: 1,
    });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: CW_CX, z: (MAXZ + CAUSEWAY_MAXZ) / 2, vertical: true, len: CAUSEWAY_MAXZ - MAXZ, district: "highway", w: CW_HW * 2, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }
  }, 30);
})();
