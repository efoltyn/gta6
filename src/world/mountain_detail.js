/* ============================================================
   world/mountain_detail.js — THE GEOLOGY KIT (one shared erosion /
   strata / snow-cover language for every real surface in the world).

   WHY THIS FILE EXISTS
   --------------------
   The world had FOUR independently-invented terrain characters:
     • biome_snow.js  — hand-placed Gaussian lobes soft-maxed together with a
                        light ridged-fbm "crag" multiplier. Geologically
                        arbitrary: no drainage, no bedding, no talus.
     • continent.js   — a genuinely good Quilez-style erosion (derivative-
                        damped fbm + domain warp + per-octave rotation) that
                        was only ever used on knee-high backcountry hills.
     • terrain_overhaul.js — the reference V3 pipeline (erosion/rivers/biome
                        altitude) on the DECORATIVE offshore backdrop.
     • biome_desert.js — dunes/mesas (left alone; a deliberately different
                        aesthetic).
   The good erosion was on the terrain nobody looks at, and the terrain the
   player actually climbs was Gaussian blobs. This file lifts every technique
   into ONE allocation-free, deterministic kit that all three of the first
   three call, so the mountains, the backdrop range and the backcountry all
   speak the same geological language.

   WHAT IT PROVIDES
   ----------------
   Fields (all pure functions of (x,z) — position-hash noise only, never
   Math.random, never a shared rng() stream, so every result is byte-identical
   per seed across clients):
     CBZ.mtnNoise(x,z,cell,salt)      value noise, smoothstep-interpolated
     CBZ.mtnErode(x,z,opts,out)       derivative-damped fbm ("Quilez erosion")
                                      + domain warp + per-octave domain
                                      rotation. Detail COLLAPSES where the
                                      running gradient is already steep, so
                                      slopes flatten and ridgelines sharpen.
                                      Also returns the gradient magnitude, which
                                      is the cheapest honest "how steep is the
                                      bedrock here" signal we have.
     CBZ.mtnRidgeMF(x,z,opts)         ridged MULTIFRACTAL (each octave weighted
                                      by the previous) — sharp connected crests.
     CBZ.mtnDrainage(x,z,opts,out)    a real drainage network: warped |fbm|
                                      zero-crossings form branching, connected
                                      channels; the profile is a true V with a
                                      flat gravel bed, a floodplain terrace
                                      shelf and a cut-bank crest.
     CBZ.mtnTerrace(h,x,z,opts)       STRATA GEOMETRY. Quantises height into
                                      warped, non-parallel beds with a soft
                                      riser — real benches and cliff bands
                                      instead of a smooth Gaussian skin.
     CBZ.mtnCirque(x,z,peaks,opts)    headwall/cirque bowls on the shaded side
                                      of summits.
     CBZ.mtnTalus(x,z,opts,out)       scree/talus apron field (accumulation
                                      slope below cliff bands).
     CBZ.mtnConcavity(hAt,x,z,e)      signed curvature off any height sampler:
                                      +1 = couloir/hollow, -1 = ridge/spine.
                                      Slope cannot tell those apart, which is
                                      why snow used to paint contour bands.
     CBZ.mtnStrikeOf(peaks)           the STRIKE of a range read off its own
                                      summits (principal axis). Feed it to
                                      mtnErode/mtnRidgeMF as {strike, aniso}
                                      and isotropic humps become a RANGE:
                                      long parallel crests with spurs.

   Shading (so colour and geometry agree instead of a sine ripple):
     CBZ.mtnStrataTint(out, x, z, y, slope, faceLight, opts)
     CBZ.mtnSnowCover(x, z, y, slope, faceLight, opts)

   Meshing:
     CBZ.mtnAdaptiveAxis(n, lo, hi, weightFn)  density-warped axis samples
     CBZ.mtnGridGeometry(xs, zs)               indexed grid from those axes
     CBZ.mtnGridCache(opts)                    lazily-filled bilinear grid
                                               memo (mesh and physics MUST
                                               share the memo, never fork)

   Deployment:
     a landmass builder (order 98.4) that finally puts rockscliffs.js's
     fractured-boulder system on the REAL walkable mountains — cliff-band
     rubble, talus fans at the foot of cliffs, erratic boulder fields and
     rockfall debris trails.

   TWO SAFETY LAWS (they keep tools/math-gate.mjs green forever)
   ------------------------------------------------------------
   The gate asserts city-on-mountain == 0 and mountains-outside-snow <= 60,
   both defined as "sample cells where max(terrainHeight, snowTerrainHeightAt)
   exceeds 25 world units". So:
     LAW 1 — every MULTIPLICATIVE shaping factor this kit returns is clamped
             to <= 1. Erosion can only ever remove material.
     LAW 2 — every ADDITIVE term is multiplied by CBZ.mtnHiGate(h), which is
             exactly 0 below 45u and only reaches 1 above 70u. An additive
             term therefore cannot lift a sample that was under 25u past 25u.
   Together these make the set of cells above the gate's mountain threshold a
   SUBSET of what it was before this file existed — the invariants cannot get
   worse, only better. Callers must honour both laws.

   Load order: right after world/terrain_overhaul.js (it uses
   CBZ.terrainFogScale and must exist before city/biome_snow.js). It self-
   creates the CBZ namespace exactly like terrain.js/rockscliffs.js, because
   these world/ scripts parse BEFORE config.js and core/seed.js — every
   hash/seed lookup here is therefore LAZY (resolved at build time).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  if (!window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS (own-file defaults; config.js is not edited by this feature) --
  // MOUNT_EROSION_V4 — real erosion on the REAL walkable mountains: derivative-
  // damped fbm, domain-warped sinuous ridgelines, ridged multifractal crests,
  // V-shaped drainage networks, strata terracing, cirque headwalls, talus
  // aprons. Off → biome_snow's previous Gaussian-lobe + crag field, byte for
  // byte. Revert: CBZ.CONFIG.MOUNT_EROSION_V4 = false (or ?cfg_MOUNT_EROSION_V4=0).
  if (CFG.MOUNT_EROSION_V4 == null) CFG.MOUNT_EROSION_V4 = true;
  // MOUNT_STRATA_V1 — altitude-banded rock colour with WARPED, non-parallel
  // beds, slope-driven rock↔soil blending and aspect shading, replacing the
  // single sine-wave colour ripple. Off → the previous flat granite lerp.
  if (CFG.MOUNT_STRATA_V1 == null) CFG.MOUNT_STRATA_V1 = true;
  // MOUNT_SNOW_ASPECT_V1 — snow accumulates on shallow slopes and shaded
  // faces, thins on steep sunlit faces, and feathers with noise instead of a
  // hard altitude cut. Off → the previous pure-altitude snow load.
  if (CFG.MOUNT_SNOW_ASPECT_V1 == null) CFG.MOUNT_SNOW_ASPECT_V1 = true;
  // MOUNT_ROCKS_V1 — deploy rockscliffs.js's fractured boulders on the real
  // mountains (cliff bands, talus fans, boulder fields, rockfall debris).
  // Off → no scatter (the decorative backdrop keeps its own, unchanged).
  if (CFG.MOUNT_ROCKS_V1 == null) CFG.MOUNT_ROCKS_V1 = true;
  // MOUNT_SNOW_GULLIES — snow follows the CONCAVITIES. Couloirs and hollows
  // hold white far below the line the open slope keeps, convex spines and
  // aretes stay bare rock right through a summit field, and marginal cover
  // breaks into patches instead of ramping smoothly. Off → the previous
  // altitude/slope/aspect coverage, byte for byte (every new term is keyed
  // off an option that defaults to zero, so a caller that passes none is
  // unchanged either way).
  if (CFG.MOUNT_SNOW_GULLIES == null) CFG.MOUNT_SNOW_GULLIES = true;
  // MOUNT_VEG_SLOPE_HOLD — below the treeline, vegetation holds STEEP ground:
  // a coastal range rises green straight out of the sea and only gives way to
  // bare rock with altitude and on the ridgelines. Off → the rock-exposure
  // window sits where it did (slope0/slope1 unshifted).
  if (CFG.MOUNT_VEG_SLOPE_HOLD == null) CFG.MOUNT_VEG_SLOPE_HOLD = true;
  // MOUNT_MESH_DENSITY — global multiplier on the real mountains' mesh
  // resolution. 1 = the previous ~3.2 u/vertex. 1.45 ≈ 2.2 u/vertex, which is
  // what cliff/terrace detail needs to actually resolve. Lower it to claw back
  // vertices on a weak machine; the terrain SHAPE is unaffected.
  if (CFG.MOUNT_MESH_DENSITY == null) CFG.MOUNT_MESH_DENSITY = 1.45;
  // MOUNT_ADAPTIVE_GRID — spend the vertex budget where the geometry is:
  // a CDF over the mountain's own height profile concentrates grid lines on
  // summits/cliffs and thins them over the flat valley, at ZERO extra
  // triangles. Off → a uniform grid at the same total count.
  if (CFG.MOUNT_ADAPTIVE_GRID == null) CFG.MOUNT_ADAPTIVE_GRID = true;
  // MOUNT_HEIGHT_CACHE — memoise the expensive erosion MODULATION field on a
  // coarse grid and bilinearly interpolate it. The mesh vertex loop and the
  // physics floor oracle call the SAME memo, so they cannot disagree.
  if (CFG.MOUNT_HEIGHT_CACHE == null) CFG.MOUNT_HEIGHT_CACHE = true;
  // MOUNT_RIDGE_STRIKE — a range has a GRAIN. See §1's STRIKE note: the ridged
  // and eroded fields may be squashed ACROSS an axis so crests run parallel to
  // the orogen instead of wandering isotropically. Off → both fields ignore
  // `strike`/`aniso` and are byte-identical to before.
  if (CFG.MOUNT_RIDGE_STRIKE == null) CFG.MOUNT_RIDGE_STRIKE = true;
  // MOUNT_SNOW_LANDFORM — the snow shed test reads the LANDFORM slope a caller
  // passes in (`slopeHold`), not the metre-scale crag slope. Off → the shed
  // term keeps using the fine slope, as it always did.
  if (CFG.MOUNT_SNOW_LANDFORM == null) CFG.MOUNT_SNOW_LANDFORM = true;
  // MOUNT_SNOW_LEDGES — snow loads the TREAD of every bedding bench this kit
  // already cuts (see mtnTerrace). Keyed on an option defaulting to zero, so a
  // caller that passes none is unchanged either way.
  if (CFG.MOUNT_SNOW_LEDGES == null) CFG.MOUNT_SNOW_LEDGES = true;

  // ======================================================================
  //  0. PRIMITIVES
  // ======================================================================
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function sm(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  CBZ.mtnSmooth01 = sm;

  // Position hash. Prefers core/seed.js's world-seeded hash01 (so every seed
  // grows a DIFFERENT mountain), with a self-contained fallback for the window
  // before seed.js has parsed — nothing samples the fields that early, the
  // fallback only exists so a stray probe can never throw.
  function h01(x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    let h = ((Math.round(x * 10) * 374761393) ^ (Math.round(z * 10) * 668265263) ^ (salt * 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  CBZ.mtnHash01 = h01;

  // Value noise: 4 corner hashes, smoothstep-interpolated. `cell` is the
  // feature wavelength in WORLD UNITS, so every call site reads as a physical
  // scale ("240u bedding", "900u drainage basin") instead of a magic frequency.
  function n2(x, z, cell, salt) {
    const gx = x / cell, gz = z / cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = sm(gx - ix), fz = sm(gz - iz);
    const a = h01(ix * cell, iz * cell, salt);
    const b = h01((ix + 1) * cell, iz * cell, salt);
    const c = h01(ix * cell, (iz + 1) * cell, salt);
    const d = h01((ix + 1) * cell, (iz + 1) * cell, salt);
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }
  CBZ.mtnNoise = n2;

  // LAW 2's gate: additive terrain terms may only act where the ground is
  // already far above the math-gate's 25u mountain threshold.
  function hiGate(h) { return sm((h - 45) / 25); }
  CBZ.mtnHiGate = hiGate;

  /* ---- STRIKE — THE GRAIN OF A RANGE ----------------------------------
     Every noise field in this kit was ISOTROPIC: rotated per octave so it
     never locked to the world grid, but with no preferred direction at all.
     Real mountains have one. A range is built by a force acting along a
     LINE, and the ridges and the valleys between them run PARALLEL to that
     line — the strike of the orogen. Isotropic ridged noise gives you a
     field of unrelated humps; the same noise squashed across a strike gives
     you a RANGE: long connected crests, parallel valleys, spurs coming off
     the crest at an angle.

     The transform is one rotation into the strike frame plus a scale ACROSS
     it: multiplying the across-strike coordinate by aniso > 1 shortens the
     feature wavelength in that direction only, so a blob becomes a ridge.
     It is applied ONCE, before the octave loop, so the per-octave rotation
     that follows progressively decorrelates the FINE detail — which is what
     you want: the grain is a landform fact, and metre-scale crags on a
     cliff face have no strike.

     Both mtnErode and mtnRidgeMF take it, because the grain belongs to the
     bedrock and not to one function. `aniso` 1 (the default) is the exact
     old behaviour, which is what makes adopting it free. */
  function applyStrike(o, px, pz, out) {
    const aniso = o.aniso == null ? 1 : o.aniso;
    if (CFG.MOUNT_RIDGE_STRIKE === false || !(aniso > 0) || aniso === 1) {
      out[0] = px; out[1] = pz; return out;
    }
    const a = o.strike == null ? 0 : o.strike;
    const cs = Math.cos(a), sn = Math.sin(a);
    out[0] = px * cs + pz * sn;              // along strike — left alone
    out[1] = (pz * cs - px * sn) * aniso;    // across strike — compressed
    return out;
  }
  const _st = [0, 0];

  /* The strike of a range READ OFF ITS OWN SUMMITS, so nobody has to type a
     bearing and nobody's typed bearing can go stale when a peak moves. The
     principal axis of the summit scatter (the 2x2 covariance's major
     eigenvector, in closed form) IS the crest line by definition. Falls back
     to 0 for a degenerate set — one peak, or peaks on a perfect circle,
     have no axis and must not invent one. */
  CBZ.mtnStrikeOf = function (peaks) {
    if (!peaks || peaks.length < 2) return 0;
    let mx = 0, mz = 0;
    for (let i = 0; i < peaks.length; i++) { mx += peaks[i].x; mz += peaks[i].z; }
    mx /= peaks.length; mz /= peaks.length;
    let sxx = 0, sxz = 0, szz = 0;
    for (let i = 0; i < peaks.length; i++) {
      const dx = peaks[i].x - mx, dz = peaks[i].z - mz;
      sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
    }
    if (!(sxx + szz > 1e-6)) return 0;
    return 0.5 * Math.atan2(2 * sxz, sxx - szz);
  };

  // ======================================================================
  //  1. EROSION — derivative-damped fbm ("Quilez"), domain warp, rotation
  // ======================================================================
  // Each octave is divided down by the RUNNING GRADIENT accumulated from the
  // octaves before it. Where the surface is already steep, new detail is
  // suppressed; where it is flat, detail survives. That single feedback term
  // is what turns fbm mush into weathered ridge-and-valley structure: crests
  // stay sharp because their gradient is dominated by ONE octave, while
  // slopes wash smooth because every finer octave is damped away.
  // The domain is warped once up front (ridgelines meander instead of running
  // along the noise grid) and rotated ~37° per octave (no grid lock).
  const _er = { v: 0, slope: 0, gx: 0, gz: 0 };
  CBZ.mtnErode = function (x, z, o, out) {
    out = out || _er;
    o = o || {};
    const oct = o.oct == null ? 5 : o.oct;
    const lac = o.lac == null ? 2.03 : o.lac;
    const gain = o.gain == null ? 0.5 : o.gain;
    const damp = o.damp == null ? 1.15 : o.damp;
    const salt = (o.salt | 0);
    let cell = o.cell == null ? 300 : o.cell;
    const warp = o.warp == null ? 0 : o.warp;
    let px = x, pz = z;
    if (warp) {
      const wc = o.warpCell == null ? cell * 3 : o.warpCell;
      px += (n2(x + 131.7, z + 719.3, wc, salt + 811) - 0.5) * warp;
      pz += (n2(x + 523.1, z + 137.9, wc, salt + 823) - 0.5) * warp;
    }
    applyStrike(o, px, pz, _st); px = _st[0]; pz = _st[1];
    let sum = 0, norm = 0, amp = 1, dX = 0, dZ = 0;
    for (let i = 0; i < oct; i++) {
      const step = cell * 0.3;
      const n = n2(px, pz, cell, salt + i * 17);
      const nx = n2(px + step, pz, cell, salt + i * 17);
      const nz = n2(px, pz + step, cell, salt + i * 17);
      dX += (nx - n) / 0.3;
      dZ += (nz - n) / 0.3;
      sum += amp * (n - 0.5) / (1 + damp * (dX * dX + dZ * dZ));
      norm += amp;
      const rx = 0.80 * px - 0.60 * pz;      // ~37° domain rotation per octave
      pz = 0.60 * px + 0.80 * pz; px = rx;
      cell /= lac; amp *= gain;
    }
    out.v = norm > 0 ? sum / norm : 0;                       // ~[-0.5, 0.5]
    out.gx = dX; out.gz = dZ;
    out.slope = clamp01(Math.sqrt(dX * dX + dZ * dZ) * (o.slopeScale == null ? 0.85 : o.slopeScale));
    return out;
  };

  // ---- RIDGED MULTIFRACTAL — sharp, connected crests -------------------
  // Fold to a ridge (1-|2n-1|), sharpen, and weight each octave by the one
  // before it, so detail only accumulates ON existing ridges. That is the
  // difference between "noisy everywhere" and "a crest line with spurs".
  CBZ.mtnRidgeMF = function (x, z, o) {
    o = o || {};
    const oct = o.oct == null ? 5 : o.oct;
    const lac = o.lac == null ? 2.07 : o.lac;
    const gain = o.gain == null ? 0.52 : o.gain;
    const sharp = o.sharp == null ? 1.8 : o.sharp;
    const salt = (o.salt | 0);
    let cell = o.cell == null ? 300 : o.cell;
    let px = x, pz = z;
    if (o.warp) {
      const wc = o.warpCell == null ? cell * 2.6 : o.warpCell;
      px += (n2(x - 311.3, z + 97.1, wc, salt + 907) - 0.5) * o.warp;
      pz += (n2(x + 71.9, z - 449.7, wc, salt + 911) - 0.5) * o.warp;
    }
    applyStrike(o, px, pz, _st); px = _st[0]; pz = _st[1];
    let sum = 0, norm = 0, amp = 1, prev = 1;
    for (let i = 0; i < oct; i++) {
      let n = n2(px, pz, cell, salt + i * 23);
      n = 1 - Math.abs(2 * n - 1);
      n = Math.pow(n, sharp);
      sum += n * amp * prev;
      norm += amp;
      prev = 0.35 + 0.65 * n;                  // multifractal octave weighting
      const rx = 0.86 * px - 0.51 * pz;
      pz = 0.51 * px + 0.86 * pz; px = rx;
      cell /= lac; amp *= gain;
    }
    return norm > 0 ? clamp01(sum / norm) : 0;               // 0..1 (1 = crest)
  };

  // ---- DRAINAGE — a real branching valley network ----------------------
  // Channels live on the ZERO CROSSING of a warped multi-octave signed fbm.
  // Zero crossings of a continuous field are, by construction, continuous
  // curves that branch and merge — i.e. a drainage network, not a scatter of
  // dents. The cross-section is then shaped by hand into the four parts a real
  // valley has: a flat gravel bed, V-walls, a floodplain terrace shelf, and a
  // cut-bank crest where the channel undercuts the hillside.
  //   out.carve   0..1  overall depth weight (1 = channel centre)
  //   out.bed     0..1  the flat gravel bed / bar in the middle of the channel
  //   out.terrace 0..1  the floodplain shelf partway up the wall
  //   out.bank    0..1  the cut-bank crest just outside the channel
  const _dr = { carve: 0, bed: 0, terrace: 0, bank: 0, t: 1 };
  CBZ.mtnDrainage = function (x, z, o, out) {
    out = out || _dr;
    o = o || {};
    const salt = (o.salt | 0);
    const cell = o.cell == null ? 900 : o.cell;
    const oct = o.oct == null ? 4 : o.oct;
    const warp = o.warp == null ? 220 : o.warp;
    let px = x, pz = z;
    if (warp) {
      px += (n2(x + 37.3, z - 91.7, cell * 1.7, salt + 401) - 0.5) * warp;
      pz += (n2(x - 73.1, z + 59.9, cell * 1.7, salt + 409) - 0.5) * warp;
    }
    let v = 0, norm = 0, amp = 1, c = cell;
    for (let i = 0; i < oct; i++) {
      v += amp * (n2(px, pz, c, salt + i * 29) - 0.5);
      norm += amp;
      const rx = 0.78 * px - 0.63 * pz;
      pz = 0.63 * px + 0.78 * pz; px = rx;
      c /= 2.05; amp *= 0.42;
    }
    v = norm > 0 ? Math.abs(v / norm) * 2 : 1;               // 0 = channel line
    const width = o.width == null ? 0.30 : o.width;
    const t = clamp01(v / Math.max(1e-4, width));            // 0 centre → 1 rim
    out.t = t;
    // V profile: LINEAR in distance is a true vee; the flat bed is carved out
    // of its bottom so the channel has a floor to put gravel bars on.
    out.carve = 1 - t;
    out.bed = clamp01(1 - t / 0.20);
    out.terrace = clamp01(1 - Math.abs(t - 0.56) / 0.20);
    out.bank = clamp01(1 - Math.abs(t - 0.90) / 0.13);
    return out;
  };

  // ---- STRATA TERRACING — real bedding planes, benches and risers ------
  // Sedimentary/foliated rock weathers into steps: a resistant bed forms a
  // bench, the soft bed under it retreats into a riser. Quantising height into
  // beds reproduces exactly that. Two details make it read as geology instead
  // of a wedding cake:
  //   • the quantisation is done on (h + warp(x,z)), so beds are TILTED and
  //     non-parallel — they follow the same warped field the colour bands use;
  //   • the in-bed profile is pow(frac, k>1), which is <= frac for all frac in
  //     [0,1]. That is LAW 1 in algebraic form: mtnTerrace(h) <= h, ALWAYS.
  // THE bedding field. mtnTerrace (geometry) and mtnStrataTint (colour) BOTH
  // call this, so a caller that passes the same {dip, dipCell, dipCell2, salt}
  // to both is guaranteed to land its colour bands exactly on its geometric
  // risers. Two hand-copied warps would silently drift; this cannot.
  function beddingDip(x, z, o) {
    const salt = (o.salt | 0);
    const dipAmp = o.dip == null ? 26 : o.dip;
    return (n2(x, z, o.dipCell == null ? 620 : o.dipCell, salt + 51) - 0.5) * dipAmp +
           (n2(x, z, o.dipCell2 == null ? 170 : o.dipCell2, salt + 57) - 0.5) * dipAmp * 0.42;
  }
  CBZ.mtnBeddingDip = beddingDip;
  const _bedO = { salt: 0, dip: undefined, dipCell: undefined, dipCell2: undefined };

  CBZ.mtnTerrace = function (h, x, z, o) {
    o = o || {};
    const amount = o.amount == null ? 0 : o.amount;
    if (amount <= 0 || !(h > 0)) return h;
    const step = o.step == null ? 17 : o.step;
    const salt = (o.salt | 0);
    const dip = beddingDip(x, z, o);
    const hb = h + dip;
    if (hb <= 0) return h;
    const bi = Math.floor(hb / step);
    const fr = hb / step - bi;
    // resistant/soft alternation: some beds hold a wider bench than others
    const hard = 0.55 + 0.9 * h01(bi * 13.77, 4.2, salt + 61);
    const shaped = Math.pow(fr, 1 + hard);                  // <= fr for hard>0
    const terraced = (bi + shaped) * step - dip;
    const outH = mix(h, terraced, clamp01(amount));
    return outH < h ? outH : h;                              // LAW 1, belt+braces
  };

  // ---- CIRQUE / HEADWALL ------------------------------------------------
  // Glaciers excavate an armchair-shaped bowl into the SHADED flank of a
  // summit and leave a near-vertical headwall at its back. Returns a factor
  // <= 1 (LAW 1) that scoops the shaded side of each supplied peak.
  CBZ.mtnCirque = function (x, z, peaks, o) {
    o = o || {};
    if (!peaks || !peaks.length) return 1;
    const depth = o.depth == null ? 0.18 : o.depth;
    const shade = o.shadeDir == null ? -2.2 : o.shadeDir;   // radians: NE-ish
    let f = 1;
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      const dx = x - p.x, dz = z - p.z;
      const r = Math.sqrt(dx * dx + dz * dz);
      const r0 = p.r0 == null ? 30 : p.r0, r1 = p.r1 == null ? 150 : p.r1;
      if (r > r1 || r < 1e-3) continue;
      // annulus: nothing right at the tip, deepest a third of the way out
      const ring = sm((r - r0) / Math.max(1, (r1 - r0) * 0.34)) *
                   (1 - sm((r - r0 - (r1 - r0) * 0.34) / Math.max(1, (r1 - r0) * 0.66)));
      if (ring <= 0) continue;
      const bearing = Math.atan2(dz, dx);
      let face = Math.cos(bearing - shade);
      if (face <= 0) continue;
      face = face * face;                                    // tighten the bowl
      f *= 1 - depth * ring * face * (p.w == null ? 1 : p.w);
    }
    return f < 0.35 ? 0.35 : (f > 1 ? 1 : f);
  };

  // ---- TALUS / SCREE APRON ---------------------------------------------
  // Below every cliff band, rockfall piles into a fan that rests at the angle
  // of repose (~34°). Geometrically that means: a locally SMOOTHER, slightly
  // RAISED wedge whose surface is much simpler than the cliff above it.
  //   out.smooth 0..1 — how strongly to pull the surface toward its macro form
  //   out.fill   0..1 — how much debris has piled up here (an ADDITIVE term,
  //                     so callers must multiply it by CBZ.mtnHiGate(h))
  const _tl = { smooth: 0, fill: 0 };
  CBZ.mtnTalus = function (x, z, o, out) {
    out = out || _tl;
    o = o || {};
    const salt = (o.salt | 0);
    const alt = clamp01(o.alt == null ? 0.5 : o.alt);        // 0 foot → 1 summit
    const steep = clamp01(o.steep == null ? 0 : o.steep);    // bedrock steepness
    // Aprons live in a band: under the cliffs, above the valley floor.
    const band = sm(alt / 0.18) * (1 - sm((alt - 0.34) / 0.36));
    // Fans are lobate, not a uniform skirt.
    const lobe = n2(x, z, o.cell == null ? 130 : o.cell, salt + 71) * 0.72 +
                 n2(x, z, (o.cell == null ? 130 : o.cell) * 0.31, salt + 73) * 0.28;
    const fan = clamp01((lobe - 0.34) / 0.42);
    // Debris only exists where there is a cliff above to shed it.
    out.fill = band * fan * steep;
    out.smooth = clamp01(band * (0.35 + 0.65 * fan));
    return out;
  };

  // ---- CONCAVITY — the one signal that says "gully" or "spine" ---------
  // A discrete Laplacian over the caller's OWN height sampler. Positive means
  // the ground curves away below the tangent plane (a hollow, a couloir, a
  // valley head); negative means it curves above it (a ridge crest, an arete,
  // a rock rib). Slope cannot answer this — a gully wall and a spine flank are
  // the same steepness — which is exactly why every snow model in this repo
  // painted contour bands instead of the streaks a real range shows.
  //
  // The result is squashed by k/(1+|k|), so it is bounded to (-1, 1) for ANY
  // terrain amplitude and a caller never has to know the field's scale. `e`
  // should be >= the sampler's memo cell (mtnGridCache bilinear creases alias
  // into curvature far more strongly than into slope) and is really a CHOICE
  // OF FEATURE SIZE: a 6 m stencil finds boulder-scale dents, a 40 m stencil
  // finds the couloirs. Costs four height samples; on a memoised field that is
  // four array reads.
  CBZ.mtnConcavity = function (heightAt, x, z, e, scale) {
    if (typeof heightAt !== "function") return 0;
    e = e || 6;
    const h = heightAt(x, z);
    const lap = (heightAt(x + e, z) + heightAt(x - e, z) +
                 heightAt(x, z + e) + heightAt(x, z - e)) * 0.25 - h;
    const k = lap / (e * (scale == null ? 0.10 : scale));
    return k / (1 + (k < 0 ? -k : k));
  };

  // ======================================================================
  //  2. SHADING — strata colour + physically-flavoured snow cover
  // ======================================================================
  const _rockA = new THREE.Color();
  const _rockB = new THREE.Color();
  // Warped, NON-PARALLEL altitude bands with a per-bed hue, a darkened bedding
  // plane at each contact, slope-driven rock↔soil blending and aspect shading.
  // `out` is the base (snow/soil) colour; this returns the ROCK colour to lerp
  // toward, and writes the recommended blend weight into opts.mixOut.
  //   opts: { rock, rockDark, soil, salt, step, dip, slope0, slope1,
  //           soilTint, aspect, mixOut }
  CBZ.mtnStrataTint = function (out, x, z, y, slope, faceLight, o) {
    o = o || {};
    const salt = (o.salt | 0);
    const step = o.step == null ? 17 : o.step;
    const dip = beddingDip(x, z, o);          // SAME field mtnTerrace cut with
    const hb = (y + dip) / step;
    const bi = Math.floor(hb);
    const fr = hb - bi;
    // per-bed identity: iron-stained, pale, or dark — a real cliff is banded in
    // HUE, not only in value, which is what the old single sine term missed.
    const bedH = h01(bi * 13.77, 4.2, salt + 61);
    const bedV = h01(bi * 13.77, 91.5, salt + 67);
    _rockA.copy(o.rock || _rockA.setHex(0x6a655c));
    _rockB.copy(o.rockDark || _rockB.setHex(0x353a3d));
    // hue drift per bed: warm (iron) ↔ cool (fresh) — bounded so no bed reads
    // as a painted stripe.
    _rockA.r *= 0.90 + bedH * 0.24;
    _rockA.g *= 0.93 + bedH * 0.12;
    _rockA.b *= 1.02 - bedH * 0.16;
    // 0.18 + 0.44·bedV gave neighbouring beds a 2:1 value swing — from a
    // kilometre away that is a striped ziggurat, not geology
    out.copy(_rockA).lerp(_rockB, 0.26 + bedV * 0.24);
    // bedding plane: the contact between two beds is a recessed, shadowed line
    const contact = Math.max(sm((fr - 0.88) / 0.12), sm((0.08 - fr) / 0.08));
    out.multiplyScalar(1 - 0.12 * contact);
    // aspect: sunlit faces bleach and warm, shaded faces cool and darken
    const asp = o.aspect == null ? 1 : o.aspect;
    const lit = clamp01(faceLight);
    out.r *= (0.82 + 0.30 * lit * asp);
    out.g *= (0.83 + 0.27 * lit * asp);
    out.b *= (0.86 + 0.20 * lit * asp);
    // how much rock shows at all: shallow ground grows soil, steep ground is
    // scoured bare. THIS is the slope→material coupling the old code lacked.
    // VEGETATION HOLDS THE LOW GROUND. Rock exposure is not a pure function of
    // steepness: below the treeline a 40° slope is still forest — the coastal
    // ranges in the reference photographs rise DENSE GREEN straight out of the
    // sea and the green climbs surprisingly high before anything grey shows.
    // `vegHold` (0..1, caller-supplied, typically 1 well under the treeline
    // falling to 0 above it) slides the whole exposure window uphill in SLOPE
    // by `vegSlope`. It touches neither the rock colour nor the geometry, and
    // it defaults to 0, so every existing call site is byte-identical.
    const hold = (CFG.MOUNT_VEG_SLOPE_HOLD === false || o.vegHold == null)
      ? 0 : clamp01(o.vegHold);
    const vshift = hold * (o.vegSlope == null ? 0.30 : o.vegSlope);
    const s0 = (o.slope0 == null ? 0.10 : o.slope0) + vshift;
    const s1 = (o.slope1 == null ? 0.34 : o.slope1) + vshift;
    const bare = sm((slope - s0) / Math.max(1e-3, s1 - s0));
    if (o.mixOut) o.mixOut.v = bare;
    return bare;
  };

  // Snow COVERAGE (not just colour): altitude sets the line, slope sheds it,
  // aspect moves the line up on sunlit faces and down on shaded ones, and two
  // octaves of noise feather the edge so it is never a contour line.
  CBZ.mtnSnowCover = function (x, z, y, slope, faceLight, o) {
    o = o || {};
    const salt = (o.salt | 0);
    const line = o.line == null ? 60 : o.line;
    const band = o.band == null ? 70 : o.band;
    if (CFG.MOUNT_SNOW_ASPECT_V1 === false) return sm((y - line) / Math.max(1, band));
    // sun aspect: faceLight ~1 = full sun. A sunlit slope keeps its snowline
    // markedly higher than a shaded one — the single most recognisable alpine
    // cue and the one the old pure-altitude threshold threw away even though
    // faceLight was already sitting right there.
    const aspectShift = (clamp01(faceLight) - 0.5) * (o.aspect == null ? 46 : o.aspect);
    const wob = o.wob == null ? 26 : o.wob;
    const feather = (n2(x, z, 210, salt + 131) - 0.5) * wob +
                    (n2(x, z, 47, salt + 137) - 0.5) * wob * 0.45;
    /* ---- CONCAVITY: SNOW LIVES IN THE GULLIES -------------------------
       A snowfield is not a contour band, and that single wrong assumption is
       what made every range in this game wear a flat white cap. In the
       reference photographs the white is STREAKS: it runs down the couloirs
       and hollows hundreds of metres below the line the open slope holds
       (wind loads the lee, avalanche debris runs the channel and shades
       itself), while the convex spines BETWEEN those channels stay dark rock
       right through the middle of a summit field. Both halves come off one
       signed number the caller already has cheap access to — see
       CBZ.mtnConcavity, or a drainage `carve` term for free.
         concave  +1 = deep hollow / couloir, -1 = ridge crest / arete
         gully    metres the snowline DROPS in a full hollow
         spine    0..1 how hard a full convexity strips cover back off  */
    const GUL = CFG.MOUNT_SNOW_GULLIES !== false;
    let conc = (GUL && o.concave != null) ? +o.concave : 0;
    if (!(conc === conc)) conc = 0;                 // NaN-strict: terrain gate
    if (conc > 1) conc = 1; else if (conc < -1) conc = -1;
    const gully = GUL ? (o.gully == null ? 0 : o.gully) : 0;
    let cover = sm((y - (line + aspectShift + feather - gully * conc)) / Math.max(1, band));
    /* THE SHED TEST IS A LANDFORM QUESTION, NOT A CRAG QUESTION.
       `slope` here is read off the RENDERED normal, which on these massifs
       carries the 9-27u chipped rock-face relief the mesh resolves. That
       micro-relief is steep almost everywhere on a mountain face, so the
       shed term was stripping cover off ground whose LANDFORM is a 25°
       bench — the field only ever closed over the few genuinely smooth
       shoulders, and the result was a summit wearing dirty grey paint
       instead of snow. Snow rests on the shape of the mountain; a boulder
       the size of a car does not shed a snowfield, it gets buried by one.
       `slopeHold` is the same slope measured over a LANDFORM support (the
       caller already samples its own height memo at that stencil for
       mtnConcavity, so it is four array reads). Absent → the fine slope, as
       before. The fine slope still drives rock exposure in mtnStrataTint,
       where it is exactly the right signal. */
    const sh0 = o.shed0 == null ? 0.16 : o.shed0;
    const sh1 = o.shed1 == null ? 0.52 : o.shed1;
    let shedS = slope;
    if (CFG.MOUNT_SNOW_LANDFORM !== false && o.slopeHold != null) {
      const sHold = +o.slopeHold;
      if (sHold === sHold) shedS = sHold;              // NaN-strict: terrain gate
    }
    const hold = 1 - sm((shedS - sh0) / Math.max(1e-3, sh1 - sh0));
    cover *= 0.10 + 0.90 * hold;
    // wind-loading: lee gullies pack deep even on a steep face
    const load = n2(x, z, 90, salt + 141);
    cover = clamp01(cover * (0.86 + 0.28 * load));
    // ROCK RIBS THROUGH THE FIELD. The shed term above cannot do this: it is
    // symmetric in slope, so it strips a gully wall exactly as hard as the
    // spine beside it and the field closes back over both. Keying on
    // CONVEXITY specifically is what leaves the dark serrated ribs the
    // reference shows dividing a summit snowfield into fingers.
    if (GUL && o.spine) {
      const rib = sm((-conc - 0.10) / 0.55);
      cover *= 1 - clamp01(o.spine) * rib * (0.42 + 0.58 * sm((slope - 0.16) / 0.42));
    }
    /* PATCHINESS. Coverage is a FRACTION, and a fraction near 0.5 does not
       mean half-deep snow everywhere — it means a MOSAIC of drifts and bare
       ground. Rendering it as a smooth ramp is what produced the airbrushed
       sage-grey that made every snowfield in this game read as dirty paint:
       half white lerped over half rock is neither, and it is the single
       loudest difference between our massifs and the reference photographs.

       MEASURED, and it is why the obvious fix is not enough: merely OFFSETTING
       cover by a noise leaves the large fraction of the surface where that
       noise is itself mid-valued sitting right back at half cover. Value noise
       is centre-heavy, so an offset moves the mosaic without ever creating one.
       So this does two separate things — the noise moves WHERE the patch edge
       falls, and a gain through that point decides HOW SHARP it is:
         thr  the 50% point, walked around by the noise
         k    the slope through it; patch=1 is nearly a step
       Both endpoints are preserved exactly (cover 0 and 1 map to 0 and 1), so
       a deep field stays deep and bare rock stays bare — only the contested
       ground resolves into blobs and streaks instead of a wash. */
    if (GUL && o.patch) {
      const pa = clamp01(o.patch);
      const pc = o.patchCell == null ? 120 : o.patchCell;
      // two octaves: the coarse one sizes the drift, the fine one keeps its
      // EDGE ragged — a single octave gives round blobs, which is a different
      // kind of wrong from a smooth ramp but just as recognisable.
      const pn = (n2(x, z, pc, salt + 151) - 0.5) * 0.74 +
                 (n2(x, z, pc * 0.34, salt + 157) - 0.5) * 0.26;
      const thr = 0.5 + pn * (0.55 + 0.35 * pa);
      const k = 1 / Math.max(0.12, 1 - 0.82 * pa);
      cover = clamp01((cover - thr) * k + 0.5);
    }
    /* LEDGE ACCUMULATION. mtnTerrace cuts this ground into bedding benches;
       a bench has a flat TREAD and a steep RISER, and in every photograph of
       a banded cliff the white is a stack of horizontal lines on the treads
       with bare rock between them. Nothing here knew that: the cover field
       and the bench geometry were computed from the same bedding number and
       never introduced.

       They are introduced now. `fr` is the height's fraction through its own
       bed, in the SAME warped, non-parallel field mtnTerrace cut and
       mtnStrataTint painted — so a caller passing one set of {step, dip,
       dipCell, dipCell2, salt} to all three gets snow on the ledge it can
       stand on, under the colour band that belongs to it. mtnTerrace removes
       most material at mid-`fr` and least near 0, so the tread is LOW fr.
       Written as a fill of the REMAINING headroom (1 - cover), so bare rock
       can gain a ledge line but a deep field cannot exceed 1. */
    if (CFG.MOUNT_SNOW_LEDGES !== false && o.ledge) {
      const step = o.step == null ? 17 : o.step;
      // beddingDip keys its warps off `salt`, and THIS function's salt is the
      // snow-feather stream — a caller must be able to name the BEDDING salt
      // its mtnTerrace/mtnStrataTint calls used without moving its own snow
      // noise. Reused scratch: this runs per terrain vertex.
      _bedO.salt = o.bedSalt == null ? salt : o.bedSalt;
      _bedO.dip = o.dip; _bedO.dipCell = o.dipCell; _bedO.dipCell2 = o.dipCell2;
      const hb = (y + beddingDip(x, z, _bedO)) / step;
      const fr = hb - Math.floor(hb);
      const tread = 1 - sm((fr - 0.05) / 0.32);
      // a tread that is itself a cliff is not a ledge; and there is no snow
      // to drift onto one far below the line the open slope holds.
      const flat = 1 - sm((slope - 0.34) / 0.34);
      const alt = sm((y - (o.line == null ? 60 : o.line) * 0.55) / Math.max(1, band));
      cover = clamp01(cover + clamp01(o.ledge) * tread * flat * alt * (1 - cover));
    }
    return cover;
  };

  // ======================================================================
  //  3. MESHING — adaptive axes, indexed grids, and the shared memo
  // ======================================================================
  // Spend vertices where the geometry is. Builds n+1 sample coordinates in
  // [lo,hi] whose SPACING is inversely proportional to weightFn(t): a CDF of
  // the weight is inverted, so a column that carries twice the "interest"
  // carries twice the grid lines. The result is monotonic by construction (a
  // CDF is), so the grid can never fold or crack.
  CBZ.mtnAdaptiveAxis = function (n, lo, hi, weightFn, opts) {
    opts = opts || {};
    const out = new Float64Array(n + 1);
    const M = opts.profile || 128;
    const floorW = opts.floor == null ? 0.34 : opts.floor;   // never starve a
    const span = hi - lo;                                    // region entirely
    if (!(span > 0) || n < 1 || typeof weightFn !== "function" || CFG.MOUNT_ADAPTIVE_GRID === false) {
      for (let k = 0; k <= n; k++) out[k] = lo + span * (k / n);
      return out;
    }
    const w = new Float64Array(M);
    let wmax = 1e-9;
    for (let i = 0; i < M; i++) {
      let v = +weightFn(lo + span * ((i + 0.5) / M));
      if (!Number.isFinite(v) || v < 0) v = 0;
      w[i] = v; if (v > wmax) wmax = v;
    }
    // normalise, then lift by a floor so a flat region keeps usable resolution
    for (let i = 0; i < M; i++) w[i] = floorW + (1 - floorW) * (w[i] / wmax);
    // light box smoothing so the density gradient itself is not a visible seam
    const ws = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const a = w[Math.max(0, i - 1)], b = w[i], c = w[Math.min(M - 1, i + 1)];
      ws[i] = (a + 2 * b + c) * 0.25;
    }
    const cdf = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) cdf[i + 1] = cdf[i] + ws[i];
    const total = cdf[M];
    if (!(total > 0)) {
      for (let k = 0; k <= n; k++) out[k] = lo + span * (k / n);
      return out;
    }
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const target = (k / n) * total;
      while (j < M && cdf[j + 1] < target) j++;
      const c0 = cdf[Math.min(j, M)], c1 = cdf[Math.min(j + 1, M)];
      const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
      out[k] = lo + span * Math.min(1, (j + f) / M);
    }
    out[0] = lo; out[n] = hi;
    return out;
  };

  // An indexed grid from two axis tables. Y is left at 0 for the caller to
  // displace. Winding is up-facing (verified against the +X/+Z ground plane).
  CBZ.mtnGridGeometry = function (xs, zs) {
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    let p = 0;
    for (let j = 0; j < nz; j++) {
      const zz = zs[j];
      for (let i = 0; i < nx; i++) { pos[p++] = xs[i]; pos[p++] = 0; pos[p++] = zz; }
    }
    const quads = (nx - 1) * (nz - 1);
    const Idx = (nx * nz > 65534) ? Uint32Array : Uint16Array;
    const idx = new Idx(quads * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.userData.cols = nx; geo.userData.rows = nz;
    return geo;
  };

  // THE SHARED MEMO. A lazily-filled coarse grid with bilinear interpolation.
  // Both the mesh vertex loop and the registered ground-height provider call
  // the SAME returned closure — there is exactly one surface, so mesh and
  // collision cannot drift apart. The grid is a pure function of position, so
  // fill ORDER cannot affect any result (determinism law).
  CBZ.mtnGridCache = function (o) {
    const fn = o.fn;
    if (typeof fn !== "function") return function () { return 0; };
    if (CFG.MOUNT_HEIGHT_CACHE === false) return fn;
    const cell = Math.max(0.25, +o.cell || 4);
    const minX = Math.floor(o.minX / cell) * cell - cell;
    const minZ = Math.floor(o.minZ / cell) * cell - cell;
    const nx = Math.ceil((o.maxX - minX) / cell) + 3;
    const nz = Math.ceil((o.maxZ - minZ) / cell) + 3;
    const MAXCELLS = o.maxCells || 1200000;
    if (!(nx > 1 && nz > 1) || nx * nz > MAXCELLS) return fn;   // too big — stay analytic
    const grid = new Float32Array(nx * nz).fill(NaN);
    function at(ix, iz) {
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) {
        // outside the allocated window — evaluate directly, still NaN-strict
        // (tools/math-gate.mjs hard-fails on a single non-finite terrain sample)
        const d = +fn(minX + ix * cell, minZ + iz * cell);
        return Number.isFinite(d) ? d : 0;
      }
      const k = iz * nx + ix;
      let v = grid[k];
      if (v !== v) {                                    // NaN sentinel = unfilled
        v = +fn(minX + ix * cell, minZ + iz * cell);
        if (!Number.isFinite(v)) v = 0;
        grid[k] = v;
      }
      return v;
    }
    return function (x, z) {
      const gx = (x - minX) / cell, gz = (z - minZ) / cell;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = gx - ix, fz = gz - iz;
      const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
      const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
      return ab + (cd - ab) * fz;
    };
  };

  // Slope (0 = flat, →1 vertical-ish) from any height sampler. `e` should be
  // >= the memo cell size so a cached field's bilinear creases cannot alias
  // into the slope signal.
  CBZ.mtnSlopeAt = function (heightAt, x, z, e) {
    e = e || 3;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const g = Math.sqrt(dx * dx + dz * dz) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + g * g);                     // == 1 - normal.y
  };

  // ======================================================================
  //  4. DEPLOYMENT — rockscliffs.js finally lands on the REAL mountains
  // ======================================================================
  // rockscliffs.js's SCRAPE boulders were the one asset built specifically to
  // sell fractured mountainside, and until now they only ever appeared on the
  // unreachable decorative backdrop. This builder puts four distinct rock
  // populations on the terrain the player actually climbs:
  //   • CLIFF-BAND RUBBLE — angular slabs wedged onto steep faces
  //   • TALUS FANS        — dense small debris at the foot of those cliffs
  //   • ERRATIC FIELDS    — big isolated boulders on shallow benches
  //   • ROCKFALL DEBRIS   — small stones trailing downhill out of gullies
  // Draw-call discipline: 4 scatterRocks calls, 1-2 InstancedMesh each — at
  // most SEVEN new draws for the whole rock program, and every one of them is
  // hidden below quality tier 2 via CBZ.onQualityChange.
  function deployMountainRocks(city) {
    if (CFG.MOUNT_ROCKS_V1 === false) return;
    if (!city || !city.root || !CBZ.scatterRocks) return;
    const root = city.root;
    const layout = CBZ.worldLayout;
    const meshes = [];

    function openGround(x, z, r) {
      if (!layout || typeof layout.canPlaceNature !== "function") return true;
      try { return layout.canPlaceNature(x, z, r, { pad: 0.2 }); } catch (e) { return true; }
    }

    // A rejection-sampling picker shared by every population. `want` describes
    // the geology the population belongs to; the picker walks a deterministic
    // stream and returns the first candidate whose local height/slope match.
    function makePicker(cfg) {
      const hAt = cfg.heightAt;
      return function (rng) {
        for (let tries = 0; tries < 22; tries++) {
          const x = cfg.minX + rng() * (cfg.maxX - cfg.minX);
          const z = cfg.minZ + rng() * (cfg.maxZ - cfg.minZ);
          const h = hAt(x, z);
          if (!(h > cfg.hMin) || h > cfg.hMax) continue;
          const s = CBZ.mtnSlopeAt(hAt, x, z, cfg.eps || 4);
          if (s < cfg.slopeMin || s > cfg.slopeMax) continue;
          if (cfg.gully != null) {
            // gully/apron affinity: reuse the drainage field so debris collects
            // in the same channels the terrain itself carves.
            const d = CBZ.mtnDrainage(x, z, { salt: cfg.salt, cell: 620, width: 0.34, warp: 160 });
            if (cfg.gully > 0 ? d.carve < cfg.gully : d.carve > -cfg.gully) continue;
          }
          if (!openGround(x, z, cfg.clearR || 2)) continue;
          return { x: x, z: z };
        }
        return null;
      };
    }

    function population(name, cfg) {
      const scat = CBZ.scatterRocks(root, {
        count: cfg.count,
        pick: makePicker(cfg),
        heightAt: cfg.heightAt,
        normalAt: cfg.normalAt,
        repeatAngleDeg: cfg.repeatAngleDeg == null ? 90 : cfg.repeatAngleDeg,
        minSize: cfg.minSize, maxSize: cfg.maxSize,
        baseRadius: 1, detail: cfg.detail == null ? 1 : cfg.detail,
        variants: cfg.variants == null ? 3 : cfg.variants,
        colorHex: cfg.colorHex,
        seed: cfg.seed,
        maxAttempts: cfg.count * 6,
        // rockscliffs extensions (all default-off, so the backdrop scatter is
        // byte-identical): sit rocks INTO the slope and squash talus plates.
        alignToSlope: cfg.alignToSlope,
        flatten: cfg.flatten,
        bury: cfg.bury,
        hashVary: true,
        rockTune: cfg.rockTune,
        tag: name,
      });
      if (scat && scat.meshes) for (let i = 0; i < scat.meshes.length; i++) meshes.push(scat.meshes[i]);
      return scat;
    }

    // ---- Mount Mercy (the hero, walked at close range) ------------------
    const mH = CBZ.snowTerrainHeightAt, mN = CBZ.snowTerrainNormalAt;
    if (typeof mH === "function") {
      const b = CBZ.mtnMercyBounds || { minX: -70, maxX: 770, minZ: -1780, maxZ: -1120 };
      // cliff bands + the talus directly under them, in ONE population with a
      // wide size range (fewer draw calls than splitting them).
      population("mercy-cliff", {
        heightAt: mH, normalAt: mN, seed: 0x5c11f,
        minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
        hMin: 26, hMax: 260, slopeMin: 0.22, slopeMax: 0.95,
        count: 210, minSize: 1.1, maxSize: 4.6, variants: 2,
        colorHex: 0x5d5952, alignToSlope: 0.85, bury: 0.34, salt: 0x5c1,
        rockTune: { scrapes: 12, hops: 1, depthMin: 0.06, depthMax: 0.40, squashY: 0.78 },
      });
      population("mercy-talus", {
        heightAt: mH, normalAt: mN, seed: 0x7a105,
        minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
        hMin: 12, hMax: 130, slopeMin: 0.06, slopeMax: 0.34,
        count: 300, minSize: 0.5, maxSize: 1.9, variants: 2,
        colorHex: 0x6a655c, alignToSlope: 0.6, flatten: 0.55, bury: 0.42,
        gully: 0.28, salt: 0x7a1,
        rockTune: { scrapes: 14, hops: 1, depthMin: 0.08, depthMax: 0.44, squashY: 0.55 },
      });
      population("mercy-erratics", {
        heightAt: mH, normalAt: mN, seed: 0x3b207,
        minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
        hMin: 4, hMax: 90, slopeMin: 0.0, slopeMax: 0.18,
        count: 70, minSize: 2.2, maxSize: 6.4, variants: 1,
        colorHex: 0x625d55, alignToSlope: 0.35, bury: 0.24, clearR: 4, salt: 0x3b2,
      });
    }

    // ---- Greater Mercy Range (seen at distance — bigger, sparser) -------
    const gH = CBZ.greaterSnowTerrainHeightAt, gN = CBZ.greaterSnowTerrainNormalAt;
    if (typeof gH === "function") {
      const gb = CBZ.mtnGreatBounds || { minX: -1450, maxX: 1750, minZ: -4100, maxZ: -1780 };
      population("great-talus", {
        heightAt: gH, normalAt: gN, seed: 0x9e551,
        minX: gb.minX, maxX: gb.maxX, minZ: gb.minZ, maxZ: gb.maxZ,
        hMin: 30, hMax: 420, slopeMin: 0.10, slopeMax: 0.62,
        count: 260, minSize: 3.5, maxSize: 13, variants: 2, eps: 8,
        colorHex: 0x5f5b54, alignToSlope: 0.7, bury: 0.30, clearR: 6, salt: 0x9e5,
      });
    }

    CBZ.mtnRockMeshes = meshes;
    if (CBZ.onQualityChange) {
      CBZ.onQualityChange(function () {
        const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
        const show = q >= 2;
        for (let i = 0; i < meshes.length; i++) meshes[i].visible = show;
      });
    }
  }

  // Register as a landmass builder. worldmap.js (which defines addLandmass)
  // parses AFTER this file, so pre-seed the registry array exactly the way
  // terrain_overhaul.js does. Order 98.4: after biome_snow publishes its
  // oracles (order 30) and after the continent plate (97) / backdrop (98),
  // before wildnature (99) — nothing here changes any registered region, any
  // ground-height provider or any lot, so it is invisible to every math-gate
  // invariant by construction.
  CBZ._landmassBuilders = CBZ._landmassBuilders || [];
  CBZ._landmassBuilders.push({
    fn: function (city) { try { deployMountainRocks(city); } catch (e) { /* never sink the world build for dressing */ } },
    order: 98.4,
  });
})();
