/* ============================================================
   src/world/water_spec.js — THE ONE WATER SPEC (WATER V2).

   Everything about "what shape is the sea, and what does it look like" is
   declared HERE, exactly once, and consumed by every water surface:

     • city/world.js   — the shader sea (no reflection, all tiers)
     • world/waterfx.js — the planar-mirror sea (tier >= 2), which now gets
                          the SAME displaced swells, land mask, depth ramp
                          and surf that the shader sea has
     • city/waterfield.js — the CPU query (CBZ.citySeaHeightAt) used by the
                          swimmer, wildlife, the dive game and buoyancy

   WHY THIS FILE EXISTS — the swell math used to live twice: once as GLSL in
   world.js's vertex program and once as a hand-typed JS port in
   waterfield.js, with a comment begging future editors to keep them
   "byte-for-byte in sync". They now CANNOT diverge: the coefficients are the
   JS table SWELLS below, the GLSL is GENERATED from that table by
   CBZ.waterWaveGLSL(), and the CPU query is CBZ.waterWaveHeight(). One edit
   here moves the render, the swimmer and the boats together.

   GEOMETRY — the sea is no longer a uniform 16km grid (144x144 quads = 111m
   per quad, so a 105m swell was AT the Nyquist limit and every wave aliased
   into mush). It is a RADIAL disc whose ring spacing grows geometrically with
   distance: ~0.15m at your feet, ~9m at 100m out, ~100m at a kilometre. Same
   vertex budget, waves you can actually see from a boat. The disc is centred
   on the camera IN THE VERTEX SHADER (gl_Position is built from
   `cameraPosition.xz + position.xz`), so the mesh transform never moves —
   matrixAutoUpdate stays false, Box3.setFromObject stays stable, and the
   planar mirror's plane math is untouched. It also stays correct inside the
   mirror pass, because reflecting a camera through a horizontal plane does
   not change its XZ.

   DEPTH — the sea used to roll with ONE amplitude, 0.42m, across all 16km:
   a pond. It could not be raised because two neighbours are authored against
   the crest/trough envelope at the SHORE (see the amplitude-budget block in
   section 1). The fix is the physical one: amplitude scales with DEPTH. Open
   ocean now carries a real 1.13m swell (up to ~1.9m in a squall) that calms as
   it shoals, and every coast and every inland lake keeps exactly the old 0.42m
   — which is both what real water does and, by construction, a proof that the
   two neighbour constraints are untouched. Open ocean is 1.02m calm / 1.62m in
   a full squall; the shore stays at 0.42m / 0.45m.
   The vertex stage cannot sample the baked shore field (it declares no
   samplers on purpose — see waterVertexDecl), so "how far offshore am I" is
   reduced at build time to at most 8 LAND BOXES fitted to the real coastline,
   published as a uniform array, and turned into a distance by the exact
   axis-aligned box SDF — one closed-form expression that the CPU mirror
   (CBZ.waterDeepFactorAt) runs verbatim. The data is an approximation of the
   coast; the FUNCTION is identical on both sides, which is the only thing the
   CPU/GPU agreement requires. Every approximation errs toward MORE land, so
   the error can only ever make the swell smaller near a shore, never bigger.

   SHORE — cbzSwash() is THE run-up function: a sum of slow sines that offsets
   the effective shore distance before it is thresholded, so the foam edge
   physically walks up the beach and drains back, brighter on the advancing
   front. city/beach.js darkens its sand from the SAME function
   (CBZ.waterSwashAt), so the wet line and the white line are one thing.

   DETERMINISM — everything here is closed-form trigonometry over fixed
   constants. No Math.random, no rng stream, no hash — including the land-box
   derivation (a fixed grid, a fixed-order flood fill, a stable sort) and both
   procedural textures. The wave CLOCK is wall-clock (runtime-only FX,
   explicitly allowed).

   PUBLIC SURFACE ADDED BY THE DEPTH/SHORE PASS (all additive):
     CBZ.waterChopAmpAt(x,z)       chop-row amplitude scale (CPU)
     CBZ.waterDeepFactorAt(x,z)    0 near any coast .. 1 in open ocean
     CBZ.waterSwashAt(x,z,t)       metres of shore run-up, signed about mean
     CBZ.waterSwashVelAt(x,z,t)    its rate of change (+ = advancing)
     CBZ.waterSyncLandBoxes(city)  idempotent; called from waterSyncInlandBodies
     CBZ.waterCausticTexture()     tileable procedural caustics (for world/
                                   water_underwater.js and anything else)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  if (!THREE) return;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS (all default ON — this is a "make it better" push; each one is
  //      still a one-line revert, and `?cfg_NAME=0` flips it before boot). ----

  // WATER_V2: the master switch for this whole upgrade. OFF → water_spec still
  // publishes the wave table (so waterfield/world.js keep working) but every
  // new surface treatment, the radial mesh, buoyancy, wakes and the underwater
  // state stand down and the sea renders the way it did before.
  // MASTER MEANS MASTER: every sub-feature below is ALSO gated on this, on
  // BOTH sides of the CPU/GPU pair — the deep swell (via waterSyncLandBoxes
  // deriving no boxes), the lake treatment (the uInlandBodies .w flag) and the
  // swash (swashOn()). A sub-feature that honoured only its own flag left the
  // shader and the CPU mirror disagreeing whenever the master was flipped.
  if (CFG.WATER_V2 == null) CFG.WATER_V2 = true;

  // WATER_RADIAL_MESH: camera-centred radial tessellation instead of the flat
  // 144x144 grid. OFF → the old uniform PlaneGeometry (flat far ocean, no
  // near-field wave detail). This is the single biggest look change; it is
  // isolated behind its own flag so it can be dropped without losing the
  // shading work.
  if (CFG.WATER_RADIAL_MESH == null) CFG.WATER_RADIAL_MESH = true;

  // WATER_SHORE_FX: depth-graded colour (turquoise shallows -> deep blue),
  // the advancing surf band, whitecaps on crests and the soft land edge.
  // OFF → flat single-tone water with the old static foam ring.
  if (CFG.WATER_SHORE_FX == null) CFG.WATER_SHORE_FX = true;

  // WATER_LAKE_TINT: registered inland water bodies (worldmap.js's
  // registerCityWaterBody) render calmer, greener and far less specular than
  // the open ocean, and their swells are damped. OFF → a lake looks exactly
  // like the sea, which is what made Redhollow read as "ocean in a forest".
  if (CFG.WATER_LAKE_TINT == null) CFG.WATER_LAKE_TINT = true;

  // WATER_UNDERWATER: submerged camera state (tint, dense blue-green fog,
  // surface seen from below). OFF → no visual change when you go under.
  if (CFG.WATER_UNDERWATER == null) CFG.WATER_UNDERWATER = true;

  // WATER_BUOYANCY: boats ride and tilt on the REAL wave field instead of the
  // hardcoded flat WATER_Y in city/vehicles.js. This is applied as a
  // post-pass on the vehicle's group transform (vehicles.js is never edited);
  // OFF → boats sit at the flat height exactly as before.
  if (CFG.WATER_BUOYANCY == null) CFG.WATER_BUOYANCY = true;

  // WATER_WAKE_FX: pooled splash / wake / rain-ripple particles on the
  // surface. OFF → no particles at all (the engine had none before).
  if (CFG.WATER_WAKE_FX == null) CFG.WATER_WAKE_FX = true;

  // WATER_DEEP_SWELL: swell amplitude scales with how far offshore the water
  // is. Deep water gets a real 1.1m ocean swell; every coast and every inland
  // lake keeps EXACTLY today's 0.42m pond roll. OFF → one uniform amplitude
  // everywhere, byte-identical to the old sea (`?cfg_WATER_DEEP_SWELL=0`).
  if (CFG.WATER_DEEP_SWELL == null) CFG.WATER_DEEP_SWELL = true;

  // WATER_SWASH: the shore foam edge runs UP the beach and drains back
  // (a sum of slow sines offsetting the effective shore distance), and
  // city/beach.js darkens the sand from the SAME function so the wet line and
  // the white line are one thing. OFF → the previous static-mean surf band and
  // a statically-coloured wet-sand ramp (`?cfg_WATER_SWASH=0`).
  if (CFG.WATER_SWASH == null) CFG.WATER_SWASH = true;

  // WATER_NIGHT_MOON: a dimmer, cooler, tighter specular lobe from the real
  // rendered moon direction (core/sky.js places the disc at sunAngle + PI), so
  // a night sea has a moon path instead of going matte the instant the sun
  // sets. OFF → sun glitter only, exactly as before (`?cfg_WATER_NIGHT_MOON=0`).
  if (CFG.WATER_NIGHT_MOON == null) CFG.WATER_NIGHT_MOON = true;

  // WATER_FAR_CALM: kill the two things that make a distant sea TWINKLE, in
  // the two places they are actually generated.
  //   1. The SHORT CHOP rows (52m / 33m wavelength) fade out of the VERTEX
  //      displacement far faster than the long swell does. Past ~900m their
  //      wavelength is a couple of pixels, so they are pure aliasing — and
  //      because the shading normal here is the ANALYTIC DERIVATIVE of the
  //      displaced rows, fading the displacement collapses the normal toward
  //      the geometric up-vector at exactly the same rate. That is GPU Gems 1
  //      ch.1's "the normal collapses to the surface normal in the distance"
  //      done in the one place that fixes the SILHOUETTE too, instead of only
  //      softening the shading and leaving the horizon still crawling.
  //   2. The TIGHT specular lobes (sun pow 220, moon pow 420) collapse with
  //      distance far harder than the wide glitter lobe. A sub-pixel mirror
  //      highlight is the single worst aliaser on a sea; the broad glitter
  //      path is what actually reads as "ocean" and it is left alone.
  // Both are monotonically REDUCING and camera-relative, so the amplitude
  // budget at the top of section 1 is untouched by construction, and both are
  // mirrored term-for-term on the CPU (CBZ.waterChopAmpAt) so a hull can never
  // disagree with the crest it is rendered on. OFF -> exactly the old sea.
  // One-line revert: ?cfg_WATER_FAR_CALM=0
  if (CFG.WATER_FAR_CALM == null) CFG.WATER_FAR_CALM = true;

  // ============================================================
  //  1. THE SWELL TABLE — the single source of truth
  // ============================================================
  // [ kx, kz, omega, amplitude, isChop ] : y += amp * sin(kx*x + kz*z + omega*t)
  // The first three rows are the historical swells (unchanged coefficients,
  // so the sea keeps its familiar long-period roll); rows 4-5 add the shorter
  // chop that the old 111m tessellation could never have resolved anyway.
  // Wavelengths: 105m / 138m / 404m / 52m / 33m.
  //   swell rows (isChop 0): 0.355m    chop rows (isChop 1): 0.065m
  //   BASE TOTAL: 0.420m — unchanged.
  // The two groups carry SEPARATE amplitude scales (see cbzWaveAmp3 /
  // CBZ.waterAmpAt + CBZ.waterChopAmpAt) so a storm can add steepness without
  // adding crest height, which is what actually reads as rough water.
  //
  // AMPLITUDE BUDGET — READ BEFORE RETUNING. Two neighbours were authored
  // against the crest/trough envelope of this table:
  //   • city/biome_forest.js sinks the Redhollow lake bed to -1.10 at its
  //     shore ring, so the deepest trough must stay ABOVE -1.10.
  //   • city/beach.js's swash apron starts at y=+0.048 (this file's owner
  //     lowered nothing; the old two-triangle ramp started at +0.03), so the
  //     highest crest must stay BELOW +0.03.
  // With SEA_Y = -0.48 that is an envelope of ±0.51 at worst, and the old
  // "do not exceed ~0.46 total" rule is what kept it.
  //
  // THE RULE THAT REPLACES IT (WATER_DEEP_SWELL): the base table is unchanged,
  // and ANY multiplier greater than 1 is gated behind cbzDeepFactor(), which
  // is ZERO everywhere within DEEP_MARGIN (220m) of ANY coast — the land boxes
  // are fitted to the live shoreline oracle at build time and every step of
  // that fit rounds toward MORE land, so a point can only be called "deep" if
  // the nearest land is at least 220m away. Both neighbour constraints are
  // therefore untouched BY CONSTRUCTION, not by arithmetic luck:
  //   • shore / lake water: total 0.420 * weather(≤1.06) = 0.445
  //       crest -0.035 (< +0.03 ✓)   trough -0.925 (> -1.10 ✓)
  //     — and the lake is damped a further 0.26x by WATER_INLAND_CALM.
  //   • open ocean (≥220m offshore, deep factor 1): 0.355*2.70 + 0.065*1.00
  //       = 1.024m calm, up to ~1.62m in a full storm. Nothing is authored
  //       against a height envelope out there; the seabed is 400m+ down.
  // If you add a NEW amplitude multiplier, it must be deep-gated too, or you
  // must re-derive the two numbers above by hand.
  const SWELLS = [
    [0.052000, 0.030000, 1.10, 0.145, 0],
    [-0.020000, 0.041000, 0.70, 0.125, 0],
    [0.011000, 0.011000, -0.40, 0.085, 0],
    [0.093000, -0.077000, 1.90, 0.042, 1],
    [-0.145000, 0.121000, 2.60, 0.023, 1],
  ];
  let TOTAL_AMP = 0, SWELL_AMP = 0, CHOP_AMP = 0;
  for (let i = 0; i < SWELLS.length; i++) {
    TOTAL_AMP += SWELLS[i][3];
    if (SWELLS[i][4]) CHOP_AMP += SWELLS[i][3]; else SWELL_AMP += SWELLS[i][3];
  }

  CBZ.WATER_SWELLS = SWELLS;
  CBZ.WATER_SWELL_AMP = TOTAL_AMP;           // 0.42 — peak displacement AT THE SHORE
  CBZ.WATER_SWELL_ROWS_AMP = SWELL_AMP;      // 0.355 — the long-period rows
  CBZ.WATER_CHOP_ROWS_AMP = CHOP_AMP;        // 0.065 — the short chop rows
  CBZ.WATER_NORMAL_EXAGGERATION = 15.0;      // slope -> shading normal gain

  // ---- DEEP-WATER SWELL ---------------------------------------------------
  // Multipliers applied ONLY where cbzDeepFactor() says the nearest land is
  // provably far away. The LONG rows carry the deep swell; the SHORT chop rows
  // deliberately do NOT grow in calm weather, because that is what deep water
  // is — a long, slow, glassy swell, with the short stuff being wind-driven
  // and therefore a property of the storm, not of the depth. It also keeps the
  // surface's vertical RATE down (a taller wave at the same frequency is a
  // faster wave, and everything that samples CBZ.citySeaHeightAt one tick
  // behind the render — wildlife, buoyancy — pays for that in tracking error).
  //   calm open ocean:  0.355*2.70 + 0.065*1.00 = 1.024m
  //   full storm:      (0.355*3.78 + 0.065*2.80) * 1.06 = 1.615m
  const DEEP_GAIN = 2.70;                    // long swell rows, calm weather
  const CHOP_BASE_GAIN = 1.00;               // chop rows are WIND, not depth
  const DEEP_STORM = 0.40;                   // + this fraction per unit of rain
  const CHOP_STORM = 1.80;                   // storms buy STEEPNESS, not height
  CBZ.WATER_DEEP_AMP = SWELL_AMP * DEEP_GAIN + CHOP_AMP * CHOP_BASE_GAIN;  // 1.024

  // "How far offshore am I" reduced to something a VERTEX program can evaluate
  // with no texture fetch: the world's land is covered by at most 8 axis-
  // aligned boxes (derived from the real coastline at build time — see
  // waterSyncLandBoxes), and the depth term is the exact box SDF distance to
  // the nearest of them. That is a continuous field over the WHOLE ocean —
  // swell builds monotonically as you leave the coast, which is both the
  // physical read and something a handful of circles could never cover.
  const MAX_LAND = 8;                        // fixed GLSL ES 1.0 loop bound
  const DEEP_MARGIN = 220;                   // m from land before ANY extra swell
  const DEEP_RAMP = 780;                     // m over which it reaches full deep
  CBZ.WATER_MAX_LAND = MAX_LAND;
  CBZ.WATER_DEEP_MARGIN = DEEP_MARGIN;
  CBZ.WATER_DEEP_RAMP = DEEP_RAMP;

  // Metres the foam edge travels up and down the beach (peak-to-mean).
  const SWASH_RANGE = 6.0;
  CBZ.WATER_SWASH_RANGE = SWASH_RANGE;

  // Distance over which the swell amplitude decays toward the horizon. Far
  // water still has tone variation but stops shimmering into aliased noise,
  // and it costs nothing (a single smoothstep in the vertex program).
  const FADE_NEAR = 700.0, FADE_FAR = 2600.0, FADE_FLOOR = 0.22;
  CBZ.WATER_FADE = { near: FADE_NEAR, far: FADE_FAR, floor: FADE_FLOOR };

  // ...and the much SHORTER distance over which the 52m / 33m chop rows are
  // allowed to survive (WATER_FAR_CALM). By 900m one chop wavelength is a
  // couple of pixels wide; keeping it there buys nothing but shimmer, and
  // because the normal is the analytic derivative of these rows, dropping the
  // displacement drops the twinkle in the silhouette AND in the shading.
  const CHOP_NEAR = 120.0, CHOP_FAR = 900.0, CHOP_FLOOR = 0.10;
  CBZ.WATER_CHOP_FADE = { near: CHOP_NEAR, far: CHOP_FAR, floor: CHOP_FLOOR };

  // Inland water bodies are calmer than the open sea by this factor.
  const INLAND_CALM = 0.26;
  CBZ.WATER_INLAND_CALM = INLAND_CALM;

  // Up to this many registered inland bodies get their own look. The world has
  // exactly one today (Redhollow Lake); four is a cheap, fixed-size uniform
  // array that a GLSL ES 1.0 loop can iterate with a constant bound.
  const MAX_INLAND = 4;
  CBZ.WATER_MAX_INLAND = MAX_INLAND;

  // ---- shared clock -------------------------------------------------------
  // Wrapped so sin() arguments stay small. Every consumer (both shaders and
  // the CPU query) reads THIS, so the rendered crest and the queried height
  // are the same crest.
  CBZ.waterClock = function () {
    const ms = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    return (ms * 0.001) % 3600;
  };

  // ---- distance / inland amplitude scale (CPU mirror of the vertex code) ---
  function fadeAt(x, z) {
    const cam = CBZ.camera;
    if (!cam) return 1;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= FADE_NEAR) return 1;
    if (d >= FADE_FAR) return FADE_FLOOR;
    const t = (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
    const s = t * t * (3 - 2 * t);                 // smoothstep
    return 1 + (FADE_FLOOR - 1) * s;
  }

  // Registered inland bodies, cached as plain numbers for the CPU path and as
  // Vector4s for the shader. Rebuilt whenever a city publishes water bodies.
  let inlandRecs = [];
  const inlandVecs = [];
  for (let i = 0; i < MAX_INLAND; i++) inlandVecs.push(new THREE.Vector4(1e6, 1e6, 1.0, 0.0));

  // WATER_LAKE_TINT (and the WATER_V2 master) have to be honoured in the
  // UNIFORM, not only in the CPU mirror: inlandAt() below returns 0 when the
  // flag is off, but the shader reads uInlandBodies unconditionally, so a
  // CPU-side "no lake damping" and a GPU-side "lake damped to 0.26x" is a
  // straight CPU/GPU amplitude divergence — a hull floating 0.3m off the
  // rendered crest on Redhollow. Zeroing the active flag (.w) turns the whole
  // lake treatment off on BOTH sides at once, colour included.
  function lakeOn() { return CFG.WATER_LAKE_TINT !== false && CFG.WATER_V2 !== false; }

  CBZ.waterSyncInlandBodies = function (city) {
    inlandRecs.length = 0;
    const list = (city && city.waterBodies) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.waterBodies) || [];
    for (let i = 0; i < list.length && inlandRecs.length < MAX_INLAND; i++) {
      const b = list[i];
      if (!b) continue;
      let cx, cz, r;
      if (b.kind === "circle") { cx = +b.cx; cz = +b.cz; r = +b.r; }
      else if (b.minX != null) { cx = (+b.minX + +b.maxX) / 2; cz = (+b.minZ + +b.maxZ) / 2; r = Math.max(+b.maxX - +b.minX, +b.maxZ - +b.minZ) / 2; }
      else continue;
      if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(r > 0)) continue;
      inlandRecs.push({ cx: cx, cz: cz, r: r });
    }
    const lw = lakeOn() ? 1.0 : 0.0;
    for (let i = 0; i < MAX_INLAND; i++) {
      const rec = inlandRecs[i];
      if (rec) inlandVecs[i].set(rec.cx, rec.cz, rec.r, lw);
      else inlandVecs[i].set(1e6, 1e6, 1.0, 0.0);
    }
    // ADDITIVE (signature and return value unchanged): the same `city` also
    // carries the coastline oracle the deep-swell land boxes are derived from,
    // and every existing caller of this function already runs at a point where
    // that oracle exists. Deriving here means no consumer file had to learn a
    // new call — see CBZ.waterSyncLandBoxes, which is idempotent.
    try { if (CBZ.waterSyncLandBoxes) CBZ.waterSyncLandBoxes(city); }
    catch (e) { console.error("[water land boxes]", e); }
    return inlandVecs;
  };
  CBZ.waterInlandVectors = function () { return inlandVecs; };

  // 1 deep inside a registered lake, 0 on open sea. Matches cbzInlandFactor()
  // in the shader term-for-term.
  function inlandAt(x, z) {
    if (!lakeOn()) return 0;
    let f = 0;
    for (let i = 0; i < inlandRecs.length; i++) {
      const b = inlandRecs[i];
      const d = Math.hypot(x - b.cx, z - b.cz);
      const a = b.r * 0.55, c = b.r * 1.15;
      let s = (d - a) / Math.max(1e-4, c - a);
      s = s < 0 ? 0 : (s > 1 ? 1 : s);
      s = s * s * (3 - 2 * s);
      const v = 1 - s;
      if (v > f) f = v;
    }
    return f;
  }
  CBZ.waterInlandFactorAt = inlandAt;

  // ---- LAND BOXES: "how far offshore am I", cheaply, on BOTH sides --------
  // The GPU cannot call the shoreline oracle (it lives in a 640² DataTexture
  // the VERTEX stage deliberately does not sample — a vertex texture unit is
  // optional in WebGL1, which is why waterVertexDecl declares none). So the
  // land is reduced at BUILD TIME to at most 8 axis-aligned boxes, published
  // as a uniform array, and the depth term is the exact box SDF distance to
  // the nearest of them. The DATA is an approximation of the coast; the
  // FUNCTION is identical on both sides, which is the only thing the CPU/GPU
  // agreement actually requires.
  //
  // Every approximation here errs toward MORE land: a component's bounding box
  // covers at least the component, and a cell counts as land if land is within
  // three quarters of a cell of its centre. Over-covering land can only make
  // the swell SMALLER than it could be — it can never let a big swell reach a
  // shore that the amplitude budget is written against.
  let landBoxes = [];
  const landVecs = [];
  const LAND_OFF = 1.0e7;        // an inactive slot: unreachably far away
  for (let i = 0; i < MAX_LAND; i++) landVecs.push(new THREE.Vector4(LAND_OFF, LAND_OFF, LAND_OFF, LAND_OFF));
  let landTerrain = null;        // cache key: the mapTerrain object we derived from

  function writeLandVecs() {
    for (let i = 0; i < MAX_LAND; i++) {
      const b = landBoxes[i];
      if (b) landVecs[i].set(b.minX, b.minZ, b.maxX, b.maxZ);
      else landVecs[i].set(LAND_OFF, LAND_OFF, LAND_OFF, LAND_OFF);
    }
  }

  // Derive the land boxes from the world's own coastline: sample a coarse land
  // occupancy grid, label its connected components (a deterministic flood
  // fill over a fixed scan order), and take the bounding box of the biggest
  // MAX_LAND of them. Deterministic — fixed grid, fixed scan order, stable
  // sort; no rng, no hash, no Math.random.
  //
  // Called from waterSyncInlandBodies(), which BOTH city/world.js's buildSea
  // and city/waterfield.js's order-900 landmass already call, so no consumer
  // file had to learn a new call. Idempotent: it caches on the mapTerrain
  // object and re-derives only for a genuinely new world.
  CBZ.waterSyncLandBoxes = function (city) {
    const A = city || (CBZ.city && CBZ.city.arena) || null;
    const mt = A && A.mapTerrain;
    const shoreAt = mt && typeof mt.shoreAt === "function" ? mt.shoreAt : null;
    if (shoreAt && landTerrain === mt && landBoxes.length) return landVecs;
    landBoxes = [];
    if (CFG.WATER_V2 === false || CFG.WATER_DEEP_SWELL === false || !shoreAt) {
      writeLandVecs();
      CBZ.WATER_LAND_BOXES = landBoxes;
      return landVecs;
    }

    // Search the published ocean footprint; fall back to a widened map plate.
    let x0, x1, z0, z1;
    const B = CBZ.SEA_WORLD_BOUNDS;
    if (B && Number.isFinite(B.minX) && Number.isFinite(B.maxX)) {
      x0 = B.minX; x1 = B.maxX; z0 = B.minZ; z1 = B.maxZ;
    } else if (mt.bounds && Number.isFinite(mt.bounds.minX)) {
      const b = mt.bounds, ex = (b.maxX - b.minX) * 0.4, ez = (b.maxZ - b.minZ) * 0.4;
      x0 = b.minX - ex; x1 = b.maxX + ex; z0 = b.minZ - ez; z1 = b.maxZ + ez;
    } else { writeLandVecs(); CBZ.WATER_LAND_BOXES = landBoxes; return landVecs; }

    const G = 128;
    const cw = (x1 - x0) / G, ch = (z1 - z0) / G;
    const cell = Math.max(cw, ch);
    const land = new Uint8Array(G * G);
    let anyLand = false;
    for (let iz = 0; iz < G; iz++) {
      const wz = z0 + ch * (iz + 0.5);
      for (let ix = 0; ix < G; ix++) {
        const wx = x0 + cw * (ix + 0.5);
        const s = +shoreAt(wx, wz);
        // NaN-safe and conservative: unknown, or land within 3/4 of a cell.
        if (!(s < -cell * 0.75)) { land[iz * G + ix] = 1; anyLand = true; }
      }
    }
    if (!anyLand) { writeLandVecs(); CBZ.WATER_LAND_BOXES = landBoxes; return landVecs; }
    landTerrain = mt;

    // 4-connected flood fill, scanned in a fixed order (an explicit stack, so
    // a continent-sized component cannot blow the JS call stack).
    const seen = new Uint8Array(G * G);
    const stack = new Int32Array(G * G);
    const comps = [];
    for (let start = 0; start < G * G; start++) {
      if (!land[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let n = 0, mnx = G, mxx = -1, mnz = G, mxz = -1;
      while (sp > 0) {
        const q = stack[--sp];
        const qx = q % G, qz = (q / G) | 0;
        n++;
        if (qx < mnx) mnx = qx; if (qx > mxx) mxx = qx;
        if (qz < mnz) mnz = qz; if (qz > mxz) mxz = qz;
        if (qx > 0 && land[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[sp++] = q - 1; }
        if (qx < G - 1 && land[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[sp++] = q + 1; }
        if (qz > 0 && land[q - G] && !seen[q - G]) { seen[q - G] = 1; stack[sp++] = q - G; }
        if (qz < G - 1 && land[q + G] && !seen[q + G]) { seen[q + G] = 1; stack[sp++] = q + G; }
      }
      comps.push({ n: n, i: comps.length, mnx: mnx, mxx: mxx, mnz: mnz, mxz: mxz });
    }
    // biggest first; the index tie-break keeps the order identical across runs
    comps.sort(function (a, b) { return b.n - a.n || a.i - b.i; });
    for (let k = 0; k < comps.length && landBoxes.length < MAX_LAND; k++) {
      const c = comps[k];
      landBoxes.push({
        minX: x0 + cw * c.mnx, maxX: x0 + cw * (c.mxx + 1),
        minZ: z0 + ch * c.mnz, maxZ: z0 + ch * (c.mxz + 1),
        cells: c.n,
      });
    }
    // A component that did not win a slot is small AND rare; erring toward
    // land means absorbing any leftovers rather than pretending the water
    // above them is open ocean.
    //
    // WHICH box absorbs it matters enormously. Merging every leftover into
    // landBoxes[0] (the mainland) meant ONE far-offshore rock stretched the
    // continent's box across the entire 16km plate — every point in the world
    // then sits INSIDE a land box, cbzDeepFactor() is 0 everywhere, and the
    // whole depth-scaled swell silently becomes a no-op. So absorb into the
    // box whose AREA grows LEAST. Deterministic: fixed component order, and
    // the strict-less test keeps the lowest index on a tie.
    for (let k = MAX_LAND; k < comps.length; k++) {
      const c = comps[k];
      const cx0 = x0 + cw * c.mnx, cx1 = x0 + cw * (c.mxx + 1);
      const cz0 = z0 + ch * c.mnz, cz1 = z0 + ch * (c.mxz + 1);
      let best = -1, bestCost = Infinity;
      for (let j = 0; j < landBoxes.length; j++) {
        const b = landBoxes[j];
        const nx0 = Math.min(b.minX, cx0), nx1 = Math.max(b.maxX, cx1);
        const nz0 = Math.min(b.minZ, cz0), nz1 = Math.max(b.maxZ, cz1);
        const cost = (nx1 - nx0) * (nz1 - nz0) - (b.maxX - b.minX) * (b.maxZ - b.minZ);
        if (cost < bestCost - 1e-9) { bestCost = cost; best = j; }
      }
      if (best < 0) break;
      const b = landBoxes[best];
      b.minX = Math.min(b.minX, cx0); b.maxX = Math.max(b.maxX, cx1);
      b.minZ = Math.min(b.minZ, cz0); b.maxZ = Math.max(b.maxZ, cz1);
    }
    writeLandVecs();
    CBZ.WATER_LAND_BOXES = landBoxes;
    return landVecs;
  };
  CBZ.waterLandBoxVectors = function () { return landVecs; };
  CBZ.WATER_LAND_BOXES = landBoxes;

  // 0 anywhere a coast is within DEEP_MARGIN, ramping to 1 in open ocean.
  // Matches cbzDeepFactor() in the shader term for term (same box SDF, same
  // smoothstep). Returns 0 outright when no land was derived, which is the
  // fail-safe that keeps a stripped/failed build at the old flat amplitude —
  // deepGain()/chopGain() return 1 in the same case, so the two agree.
  function boxDist(x, z, b) {
    const qx = Math.abs(x - (b.minX + b.maxX) * 0.5) - (b.maxX - b.minX) * 0.5;
    const qz = Math.abs(z - (b.minZ + b.maxZ) * 0.5) - (b.maxZ - b.minZ) * 0.5;
    const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0);
  }
  function deepAt(x, z) {
    if (CFG.WATER_DEEP_SWELL === false || !landBoxes.length) return 0;
    let d = 1e30;
    for (let i = 0; i < landBoxes.length; i++) {
      const v = boxDist(x, z, landBoxes[i]);
      if (v < d) d = v;
    }
    let s = (d - DEEP_MARGIN) / DEEP_RAMP;
    s = s < 0 ? 0 : (s > 1 ? 1 : s);
    return s * s * (3 - 2 * s);
  }
  CBZ.waterDeepFactorAt = deepAt;

  // Weather amplitude boost — ONE definition, read by both the CPU query below
  // and the uWaveAmp uniform the vertex program multiplies by, so a boat in a
  // squall heaves by exactly as much as the rendered swell does. systems/
  // weather.js is opt-in (DYNAMIC_WEATHER) and reports 0 when disabled.
  //
  // This used to be 1 + wet*0.35, which quietly pushed a full-storm SHORE
  // crest to 0.567 — past the +0.03 beach ramp the amplitude-budget block
  // above is written against. It is now a token 6%: the storm's real energy
  // goes into the DEEP-gated gains below (height offshore) and into chop /
  // whitecaps / detail normals (steepness everywhere), neither of which can
  // touch the shore envelope.
  function weatherWet() {
    const w = CBZ.weather;
    return w ? Math.max(0, Math.min(1, +w.intensity || 0)) : 0;
  }
  function weatherAmp() { return 1 + weatherWet() * 0.06; }
  CBZ.waterWeatherAmp = weatherAmp;

  // The two deep-water gains. ONE definition; the uniforms are driven from
  // these and CBZ.waterAmpAt evaluates the identical expression, so a hull
  // and its rendered crest cannot disagree.
  // `!landBoxes.length` is the FAIL-SAFE: with no derived coastline the depth
  // field would read "open ocean" everywhere, so both gains collapse to 1 and
  // the sea is byte-identical to the old flat-amplitude one. deepAt() returns
  // 0 in the same case, so the CPU and the GPU agree either way.
  function deepGain() {
    if (CFG.WATER_DEEP_SWELL === false || !landBoxes.length) return 1;
    return DEEP_GAIN * (1 + weatherWet() * DEEP_STORM);
  }
  function chopGain() {
    if (CFG.WATER_DEEP_SWELL === false || !landBoxes.length) return 1;
    return CHOP_BASE_GAIN * (1 + weatherWet() * CHOP_STORM);
  }
  CBZ.waterDeepGain = deepGain;
  CBZ.waterChopGain = chopGain;

  // Combined amplitude scale at a world point. Shader and CPU agree.
  // waterAmpAt scales the LONG SWELL rows, waterChopAmpAt the SHORT CHOP rows;
  // they are the same number everywhere except in deep water during a storm.
  function baseAmpAt(x, z) {
    // inlandAt() is already 0 when the lake treatment is off, so this is the
    // identical expression the vertex program evaluates in every flag state.
    return fadeAt(x, z) * weatherAmp() * (1 + (INLAND_CALM - 1) * inlandAt(x, z));
  }
  CBZ.waterAmpAt = function (x, z) {
    return baseAmpAt(x, z) * (1 + (deepGain() - 1) * deepAt(x, z));
  };
  // WATER_FAR_CALM's CPU mirror. Identical smoothstep, identical constants,
  // identical camera-relative distance as the `cfade` term in cbzWaveAmp3 —
  // this pair must move together or a hull 900m from the camera floats off
  // the crest it is drawn on. Reduces only; can never raise an amplitude.
  function farCalmOn() { return CFG.WATER_FAR_CALM !== false && CFG.WATER_V2 !== false; }
  CBZ.waterFarCalmOn = farCalmOn;
  function chopFadeAt(x, z) {
    if (!farCalmOn()) return 1;
    const cam = CBZ.camera;
    if (!cam) return 1;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= CHOP_NEAR) return 1;
    if (d >= CHOP_FAR) return CHOP_FLOOR;
    const t = (d - CHOP_NEAR) / (CHOP_FAR - CHOP_NEAR);
    const s = t * t * (3 - 2 * t);                 // smoothstep
    return 1 + (CHOP_FLOOR - 1) * s;
  }
  CBZ.waterChopFadeAt = chopFadeAt;

  CBZ.waterChopAmpAt = function (x, z) {
    return baseAmpAt(x, z) * chopFadeAt(x, z) * (1 + (chopGain() - 1) * deepAt(x, z));
  };

  // ---- SWASH: the ONE run-up function the sea and the sand both read -------
  // Returns metres of shoreward run-up, signed about the mean waterline (so
  // ±SWASH_RANGE), plus its rate of change (positive = the front is advancing;
  // the leading edge of a run-up is whiter than the drain-back, and that
  // asymmetry is most of what sells surf). The phase varies slowly along the
  // coast so a whole coastline never pulses in lockstep.
  // GLSL twin: cbzSwash() in waterFragmentDecl(). city/beach.js drives its
  // wet-sand vertex colours from THIS function — one swash, two surfaces.
  const SWASH_PH = [0.00310, 0.00470];
  // WATER_V2 is the MASTER off-switch for every sibling water file, so it has
  // to stand this down too — city/beach.js's apron reads CBZ.waterSwashAt and
  // would otherwise keep walking a wet line up the sand while the shader's own
  // uSwash.z had been forced to 0, i.e. exactly the two-authors-disagree split
  // the shared function exists to prevent.
  function swashOn() { return CFG.WATER_SWASH !== false && CFG.WATER_V2 !== false; }
  function swashPair(x, z, t, out) {
    out = out || {};
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    if (!swashOn()) { out.s = 0; out.v = 0; return out; }
    const ph = x * SWASH_PH[0] + z * SWASH_PH[1];
    const a0 = t * 0.35 + ph * 1.7;
    const a1 = t * 0.61 + ph * 2.9 + 1.70;
    const a2 = t * 1.10 + ph * 4.3 + 3.40;
    out.s = (0.60 * Math.sin(a0) + 0.30 * Math.sin(a1) + 0.10 * Math.sin(a2)) * SWASH_RANGE;
    out.v = (0.60 * 0.35 * Math.cos(a0) + 0.30 * 0.61 * Math.cos(a1) + 0.10 * 1.10 * Math.cos(a2)) * SWASH_RANGE;
    return out;
  }
  const _swash = { s: 0, v: 0 };
  CBZ.waterSwashAt = function (x, z, t) { return swashPair(x, z, t, _swash).s; };
  CBZ.waterSwashVelAt = function (x, z, t) { return swashPair(x, z, t, _swash).v; };
  CBZ.waterSwashPair = swashPair;

  // ============================================================
  //  2. WAVE EVALUATION — CPU
  // ============================================================
  const SEA_Y_FALLBACK = -0.48;

  // ---- SEA LEVEL, AND THE ONE WAY TO MOVE IT ------------------------------
  // CBZ.SEA_Y is the world's mean sea level and is written once at build. A
  // SURGE is a temporary offset on top of it: a storm tide, a tsunami's
  // drawdown and its flood, a dam letting go.
  //
  // It lives HERE, in the one function the shader uniform and the CPU height
  // query both read, and nowhere else. That placement is the whole feature —
  // raise the surge and the rendered surface, every buoyancy solve, every
  // hull attitude probe, the swimmer's waterline, the beach's wet-sand apron
  // and the submergence test all move together, because not one of them
  // knows the sea can move and not one of them has to. A tsunami built as
  // its own rising mesh would have had to teach all of them, which is why
  // every previous flood in this engine was confined to one arena.
  //
  // Metres, signed. Negative is the sea pulling OUT, which is a real thing a
  // tsunami does before it arrives and the most useful warning there is.
  const SHORE_CUT_PER_M = 0.055;   // ramp units of shoreline retreat per metre of surge
  let _surge = 0;
  function seaY() { return (CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK) + _surge; }
  CBZ.waterSeaY = seaY;
  CBZ.waterSurge = function () { return _surge; };
  CBZ.waterSurgeSet = function (m) {
    _surge = Number.isFinite(+m) ? +m : 0;
    return _surge;
  };

  // Instantaneous surface Y at (x,z). `t` defaults to the shared clock;
  // `ampScale` defaults to the same distance+inland+depth scale the shader
  // uses, so a boat's hull sits exactly where the rendered crest is.
  // `chopScale` (ADDITIVE, optional) scales the short chop rows separately.
  // BACK-COMPAT: pass ampScale alone and it scales EVERY row, exactly as the
  // single-scale version did — callers that already override the amplitude
  // keep their old meaning.
  CBZ.waterWaveHeight = function (x, z, t, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const ampGiven = Number.isFinite(ampScale);
    const amp = ampGiven ? ampScale : CBZ.waterAmpAt(x, z);
    const chp = Number.isFinite(chopScale) ? chopScale : (ampGiven ? ampScale : CBZ.waterChopAmpAt(x, z));
    const y0 = seaY();
    let hs = 0, hc = 0;
    for (let i = 0; i < SWELLS.length; i++) {
      const s = SWELLS[i];
      const v = Math.sin(x * s[0] + z * s[1] + t * s[2]) * s[3];
      if (s[4]) hc += v; else hs += v;
    }
    return y0 + hs * amp + hc * chp;
  };

  // Surface slope (dY/dx, dY/dz) — the same analytic derivative the vertex
  // program uses for its normal. Allocation-free with a reusable `out`.
  CBZ.waterWaveSlope = function (x, z, t, out, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const ampGiven = Number.isFinite(ampScale);
    const amp = ampGiven ? ampScale : CBZ.waterAmpAt(x, z);
    const chp = Number.isFinite(chopScale) ? chopScale : (ampGiven ? ampScale : CBZ.waterChopAmpAt(x, z));
    out = out || {};
    let dxs = 0, dzs = 0, dxc = 0, dzc = 0;
    for (let i = 0; i < SWELLS.length; i++) {
      const s = SWELLS[i];
      const c = Math.cos(x * s[0] + z * s[1] + t * s[2]) * s[3];
      if (s[4]) { dxc += c * s[0]; dzc += c * s[1]; }
      else { dxs += c * s[0]; dzs += c * s[1]; }
    }
    out.x = dxs * amp + dxc * chp;
    out.z = dzs * amp + dzc * chp;
    return out;
  };

  // ============================================================
  //  3. WAVE EVALUATION — GLSL, GENERATED FROM THE SAME TABLE
  // ============================================================
  function gnum(v) {
    let s = (+v).toPrecision(9);
    if (s.indexOf(".") < 0 && s.indexOf("e") < 0 && s.indexOf("E") < 0) s += ".0";
    return s;
  }

  // Emits statements DECLARING hName/dxName/dzName and filling them from the
  // swell table. `pExpr` is a vec2 (world xz), `tExpr` a float (seconds),
  // `ampExpr` a float amplitude scale for the LONG SWELL rows.
  // `chopExpr` (ADDITIVE, optional 7th argument) is the scale for the SHORT
  // CHOP rows; omit it and every row uses `ampExpr`, which is byte-for-byte
  // the GLSL this function emitted before the chop split existed.
  // Mirrors CBZ.waterWaveHeight/Slope exactly — same table, same grouping.
  CBZ.waterWaveGLSL = function (pExpr, tExpr, ampExpr, hName, dxName, dzName, chopExpr) {
    const L = [];
    L.push("float " + hName + " = 0.0;");
    L.push("float " + dxName + " = 0.0;");
    L.push("float " + dzName + " = 0.0;");
    L.push("{");
    L.push("  vec2 wvP = " + pExpr + ";");
    L.push("  float wvT = " + tExpr + ";");
    L.push("  float wvA = " + ampExpr + ";");
    L.push("  float wvB = " + (chopExpr || ampExpr) + ";");
    L.push("  float wvPh; float wvC;");
    L.push("  float wvHs = 0.0; float wvXs = 0.0; float wvZs = 0.0;");
    L.push("  float wvHc = 0.0; float wvXc = 0.0; float wvZc = 0.0;");
    for (let i = 0; i < SWELLS.length; i++) {
      const s = SWELLS[i];
      const H = s[4] ? "wvHc" : "wvHs", X = s[4] ? "wvXc" : "wvXs", Z = s[4] ? "wvZc" : "wvZs";
      L.push("  wvPh = wvP.x * " + gnum(s[0]) + " + wvP.y * " + gnum(s[1]) + " + wvT * " + gnum(s[2]) + ";");
      L.push("  wvC = cos(wvPh);");
      L.push("  " + H + " += sin(wvPh) * " + gnum(s[3]) + ";");
      L.push("  " + X + " += wvC * " + gnum(s[3] * s[0]) + ";");
      L.push("  " + Z + " += wvC * " + gnum(s[3] * s[1]) + ";");
    }
    L.push("  " + hName + " = wvHs * wvA + wvHc * wvB;");
    L.push("  " + dxName + " = wvXs * wvA + wvXc * wvB;");
    L.push("  " + dzName + " = wvZs * wvA + wvZc * wvB;");
    L.push("}");
    return L.join("\n");
  };

  // ============================================================
  //  4. SHARED UNIFORMS
  // ============================================================
  // NOTE — DO NOT run these through THREE.UniformsUtils.merge(). r128's
  // cloneUniforms() rebuilds every uniform object AND clones Textures, which
  // silently severs any reference the game code holds. That is exactly how the
  // old ocean ended up FROZEN: world.js kept a `seaTimeU` object and wrote the
  // wave clock into it every frame, but the material had been handed a clone,
  // so uSeaTime stayed 0.0 forever and the "animated" sea never moved a
  // millimetre. Merge only the fog block (nothing holds a reference into it)
  // and attach every live uniform by reference afterwards.
  CBZ.waterCommonUniforms = function () {
    const u = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    u.uSeaTime = { value: 0 };
    u.uSeaColor = { value: new THREE.Color(0x0d3b58) };
    u.uSeaNormal = { value: CBZ.waterRippleTexture() };
    u.uSeaLandMask = { value: null };
    u.uSeaLandBounds = { value: new THREE.Vector4(0, 0, 1, 1) };
    u.uSeaHasLandMask = { value: 0 };
    // THE SHORELINE CUT. The baked shore field's R channel is a ramp from 0
    // (open water) to 1 (dry land) and the sea discards wherever it exceeds
    // this threshold. Holding it at 0.5 puts the rendered edge exactly on the
    // real coast, which is what it has always done. RAISING it walks the
    // waterline inland — which is what a storm tide or a tsunami is, and it
    // costs one uniform instead of a second flood mesh. Driven from
    // CBZ.waterSurge() below; a zero surge leaves it at 0.5 exactly.
    u.uShoreCut = { value: 0.5 };
    u.uInlandBodies = { value: inlandVecs };
    // BY REFERENCE, like uInlandBodies: waterSyncLandBoxes() mutates the
    // Vector4s in place, so a world built after the material still reaches the
    // GPU without anything re-fetching the uniform block.
    u.uLandBoxes = { value: landVecs };
    u.uDeepGain = { value: 1.0 };
    u.uChopGain = { value: 1.0 };
    // x = run-up range (m), y = leading-edge brightness gain, z = enabled
    u.uSwash = { value: new THREE.Vector4(SWASH_RANGE, 1.0, swashOn() ? 1 : 0, 0) };
    u.uMoonDir = { value: new THREE.Vector3(0.34, -0.84, -0.42).normalize() };
    u.uMoonColor = { value: new THREE.Color(0xa8c0e2) };
    u.uMoon = { value: 0 };
    u.uSunDir = { value: new THREE.Vector3(-0.34, 0.84, 0.42).normalize() };
    u.uSunColor = { value: new THREE.Color(0xfff4e0) };
    // SHALLOW WATER SEEN FROM ABOVE. 0x24a89a was a saturated bottle-green
    // teal — the colour of deep-ish water lit from within, not the colour of
    // half a metre of water over pale sand. The owner's shallow reference
    // (a diver on white sand, ~5 m) reads 0x7EC7D6 near the lens because most
    // of what comes back up is the SAND, not the water; from above the surface
    // that same bay is a pale aqua. Lighter and less saturated, so the near
    // shore lightens toward the bottom instead of turning greener than the
    // deep. The deep half of the ramp is untouched.
    u.uShallowColor = { value: new THREE.Color(0x62c8c0) };
    u.uInlandColor = { value: new THREE.Color(0x2f5c46) };
    u.uFoamColor = { value: new THREE.Color(0xe2f1f3) };
    u.uSeaY = { value: CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK };
    u.uWaveAmp = { value: 1.0 };
    u.uChop = { value: 0.0 };
    u.uCapThresh = { value: 0.62 };
    u.uSurf = { value: new THREE.Vector4(22.0, 0.28, 2.05, 1.0) }; // width, freq, speed, gain
    u.uGlitter = { value: 1.0 };
    u.uShoreFx = { value: CFG.WATER_SHORE_FX === false ? 0 : 1 };
    return u;
  };

  // Per-frame driver shared by BOTH sea materials so they can never drift out
  // of phase with each other or with the CPU query.
  const _sunDir = new THREE.Vector3();
  const _moonDir = new THREE.Vector3(0.34, -0.84, -0.42).normalize();
  const FOAM_DAY = new THREE.Color(0xe2f1f3), FOAM_NIGHT = new THREE.Color(0xbed4e8);
  CBZ.waterDriveCommonUniforms = function (u) {
    if (!u) return;
    if (u.uSeaTime) u.uSeaTime.value = CBZ.waterClock();
    if (u.uSeaY) u.uSeaY.value = seaY();
    // Surge -> how far inland the rendered waterline creeps. The ramp is
    // normalised, so this is a shape constant, not a distance: SHORE_CUT_PER_M
    // was chosen so a 1m surge moves the edge a plausible dozen-odd metres up
    // a shallow beach, and it saturates well before the ramp does so a huge
    // surge can never blank the whole land mask and flood the mountains.
    if (u.uShoreCut) {
      const sg = _surge > 0 ? _surge : 0;
      u.uShoreCut.value = 0.5 + Math.min(0.42, sg * SHORE_CUT_PER_M);
    }

    // Direction TO the sun (light travels sun -> target, so it is target->sun),
    // plus its live dawn/dusk tint, straight from core/daynight.js.
    if (u.uSunDir && CBZ.sun && CBZ.sunTarget) {
      _sunDir.copy(CBZ.sun.position).sub(CBZ.sunTarget.position);
      if (_sunDir.lengthSq() > 1e-6) u.uSunDir.value.copy(_sunDir.normalize());
    }
    if (u.uSunColor && CBZ.sunTint) u.uSunColor.value.copy(CBZ.sunTint);

    // MOONLIGHT — core/sky.js parks the moon sprite at
    // normalize(cos(a+PI)*80, sin(a+PI)*95, -10) with `a = CBZ.sunAngle`, so
    // this is the ACTUAL rendered disc's direction, not an invented anti-sun.
    // (If daynight.js ever stops publishing sunAngle we fall back to the
    // literal anti-sun, which is the same vector for a circular sky.)
    const nightAmt = Math.max(0, Math.min(1, +CBZ.nightAmount || 0));
    if (u.uMoonDir) {
      const a = CBZ.sunAngle;
      if (Number.isFinite(a)) _moonDir.set(Math.cos(a + Math.PI) * 80, Math.sin(a + Math.PI) * 95, -10).normalize();
      else if (u.uSunDir) _moonDir.copy(u.uSunDir.value).negate();
      u.uMoonDir.value.copy(_moonDir);
    }
    if (u.uMoon) u.uMoon.value = CFG.WATER_NIGHT_MOON === false ? 0 : nightAmt;

    // Weather drives chop: heavier rain lowers the whitecap threshold, greys
    // the body colour out and buys STEEPNESS (chop rows + detail normals)
    // rather than crest height — see the amplitude-budget block at the top.
    // weather.js is opt-in (DYNAMIC_WEATHER) and reports 0 when disabled, so
    // every line here is a no-op then.
    const wet = weatherWet();
    if (u.uChop) u.uChop.value = wet;
    if (u.uWaveAmp) u.uWaveAmp.value = weatherAmp();
    if (u.uDeepGain) u.uDeepGain.value = deepGain();
    if (u.uChopGain) u.uChopGain.value = chopGain();
    if (u.uCapThresh) u.uCapThresh.value = 0.62 - wet * 0.34;
    if (u.uGlitter) u.uGlitter.value = 1 - wet * 0.55;
    if (u.uShoreFx) u.uShoreFx.value = CFG.WATER_SHORE_FX === false ? 0 : 1;
    if (u.uSwash) {
      u.uSwash.value.x = SWASH_RANGE;
      u.uSwash.value.z = swashOn() ? 1 : 0;
    }
    // Foam is mixed in as a flat albedo (never lit), which is exactly why it
    // stays the brightest thing on a night sea. Cool it toward moonlight
    // instead of dimming it, so it reads as spray and not as a daylight leak.
    if (u.uFoamColor) u.uFoamColor.value.copy(FOAM_DAY).lerp(FOAM_NIGHT, nightAmt * 0.85);
  };

  // ============================================================
  //  5. SHARED GLSL — declarations + helper functions
  // ============================================================
  const INLAND_FN = [
    "float cbzInlandFactor(vec2 p) {",
    "  float f = 0.0;",
    "  for (int i = 0; i < " + MAX_INLAND + "; i++) {",
    "    vec4 b = uInlandBodies[i];",
    "    float d = distance(p, b.xy);",
    "    float s = smoothstep(b.z * 0.55, b.z * 1.15, d);",
    "    f = max(f, b.w * (1.0 - s));",
    "  }",
    "  return f;",
    "}",
  ].join("\n");

  // The depth field: 0 anywhere within DEEP_MARGIN of land, ramping to 1 out
  // in the open ocean. Identical, term for term, to deepAt() on the CPU (the
  // same exact box SDF, the same smoothstep). This is the ONLY reason a 1.1m
  // swell is safe — it cannot switch on within 220m of ANY coast, so
  // beach.js's swash apron and biome_forest.js's lake bed never see it.
  // An unused slot is a degenerate box 10,000km away, so it never wins the
  // min(); a world with NO derived land is handled by uDeepGain/uChopGain
  // collapsing to 1 instead (see deepGain() — the fail-safe lives there,
  // because "no land" must mean "no deep swell", not "deep swell everywhere").
  const DEEP_FN = [
    "float cbzBoxDist(vec2 p, vec4 b) {",
    "  vec2 q = abs(p - (b.xy + b.zw) * 0.5) - (b.zw - b.xy) * 0.5;",
    "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
    "}",
    "float cbzDeepFactor(vec2 p) {",
    "  float d = 1.0e9;",
    "  for (int i = 0; i < " + MAX_LAND + "; i++) {",
    "    d = min(d, cbzBoxDist(p, uLandBoxes[i]));",
    "  }",
    "  return smoothstep(" + gnum(DEEP_MARGIN) + ", " + gnum(DEEP_MARGIN + DEEP_RAMP) + ", d);",
    "}",
  ].join("\n");

  // Vertex stage needs no samplers (a sampler declared in the vertex program
  // can cost a vertex texture unit, and WebGL1 is allowed to expose zero) —
  // which is exactly why the depth term above is a uniform circle set rather
  // than a fetch from the baked shore field the FRAGMENT stage uses.
  CBZ.waterVertexDecl = function () {
    return [
      "uniform float uSeaTime;",
      "uniform float uSeaY;",
      "uniform float uWaveAmp;",
      "uniform float uDeepGain;",
      "uniform float uChopGain;",
      "uniform vec4 uInlandBodies[" + MAX_INLAND + "];",
      "uniform vec4 uLandBoxes[" + MAX_LAND + "];",
      // Cosine of the surface tilt (== wNormal.y). Written by waterVertexBody()
      // and read by cbzWhitecap() in the fragment stage, so foam can sit on the
      // TIP of a crest without changing any shared function's signature.
      "varying float vCbzSteep;",
      INLAND_FN,
      DEEP_FN,
      // Distance + inland + DEPTH amplitude scale.
      //   .x = scale for the long swell rows   (mirrors CBZ.waterAmpAt)
      //   .y = scale for the short chop rows   (mirrors CBZ.waterChopAmpAt)
      //   .z = the deep gain alone, used to renormalise the crest height so
      //        every downstream threshold stays expressed in +-1 units even
      //        though the open ocean is now ~2.7x taller than the shore.
      "vec3 cbzWaveAmp3(vec2 p, float dist) {",
      "  float fade = mix(1.0, " + gnum(FADE_FLOOR) + ", smoothstep(" + gnum(FADE_NEAR) + ", " + gnum(FADE_FAR) + ", dist));",
      // WATER_FAR_CALM: the SHORT chop rows die off much sooner than the long
      // swell. CPU twin: chopFadeAt(). At dist <= CHOP_NEAR this is exactly
      // 1.0, so the near field is byte-identical to the old sea.
      "  float cfade = " + (farCalmOn()
        ? "mix(1.0, " + gnum(CHOP_FLOOR) + ", smoothstep(" + gnum(CHOP_NEAR) + ", " + gnum(CHOP_FAR) + ", dist))"
        : "1.0") + ";",
      "  float calm = mix(1.0, " + gnum(INLAND_CALM) + ", cbzInlandFactor(p));",
      "  float deep = cbzDeepFactor(p);",
      "  float base = fade * calm * uWaveAmp;",
      "  float gs = mix(1.0, uDeepGain, deep);",
      "  float gc = mix(1.0, uChopGain, deep);",
      // `norm` deliberately divides out only the DEEP gain (see wHeightN), so
      // neither fade belongs in it — the distance fades are meant to shrink
      // the REPORTED crest exactly as they always did.
      "  float norm = (" + gnum(SWELL_AMP) + " * gs + " + gnum(CHOP_AMP) + " * gc) * " + gnum(1 / TOTAL_AMP) + ";",
      "  return vec3(base * gs, base * cfade * gc, norm);",
      "}",
      // Kept for compatibility with anything that only wants the swell scale.
      "float cbzWaveAmp(vec2 p, float dist) { return cbzWaveAmp3(p, dist).x; }",
    ].join("\n");
  };

  CBZ.waterFragmentDecl = function () {
    return [
      "uniform float uSeaTime;",
      "uniform vec3 uSeaColor;",
      "uniform sampler2D uSeaNormal;",
      "uniform sampler2D uSeaLandMask;",
      "uniform vec4 uSeaLandBounds;",
      "uniform float uSeaHasLandMask;",
      "uniform float uShoreCut;",
      "uniform vec4 uInlandBodies[" + MAX_INLAND + "];",
      "uniform vec3 uSunDir;",
      "uniform vec3 uSunColor;",
      "uniform vec3 uMoonDir;",
      "uniform vec3 uMoonColor;",
      "uniform float uMoon;",
      "uniform vec3 uShallowColor;",
      "uniform vec3 uInlandColor;",
      "uniform vec3 uFoamColor;",
      "uniform float uSeaY;",
      "uniform float uWaveAmp;",
      "uniform float uChop;",
      "uniform float uCapThresh;",
      "uniform vec4 uSurf;",
      "uniform vec4 uSwash;",
      "uniform float uGlitter;",
      "uniform float uShoreFx;",
      // Written by waterVertexBody(); == the surface normal's Y, i.e. the
      // cosine of the tilt. Both sea materials inject that body, so this
      // varying is always driven.
      "varying float vCbzSteep;",
      INLAND_FN,
      // --- the baked shore field -----------------------------------------
      // R: smooth land ramp (>0.5 = dry land, discard). Because R is a RAMP
      //    rather than a stencil, bilinear filtering makes the discard follow
      //    a sub-texel iso-line instead of a texel staircase — that staircase
      //    was the visible "hard shoreline seam".
      // G: waterline proximity (1 at the shore, 0 at ~22m out) — drives surf.
      // B: normalised distance into deep water — drives the depth colour ramp.
      // A: inland-water flag baked from the registered water bodies.
      "vec4 cbzWaterField(vec2 p) {",
      "  vec4 f = vec4(0.0, 0.0, 1.0, 0.0);",
      "  if (uSeaHasLandMask > 0.5) {",
      "    vec2 uv = (p - uSeaLandBounds.xy) / max(vec2(1.0), uSeaLandBounds.zw - uSeaLandBounds.xy);",
      "    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) f = texture2D(uSeaLandMask, uv);",
      "  }",
      "  return f;",
      "}",
      // --- depth-graded body colour ---------------------------------------
      "vec3 cbzDepthColor(vec3 deep, vec4 field, float inland) {",
      "  if (uShoreFx < 0.5) return deep;",
      "  float shallow = pow(clamp(field.g, 0.0, 1.0), 2.1);",
      "  float open = clamp(field.b, 0.0, 1.0);",
      "  vec3 c = mix(deep * 0.80, deep, open);",
      "  c = mix(c, uShallowColor, shallow * 0.86);",   // ref 3: the shallows carry the bed's brightness
      "  c = mix(c, uInlandColor, inland * 0.72);",
      // A storm sea is GREY, not blue: overcast kills the sky tint it scatters
      // and airborne spray whitens it. Inert while uChop is 0 (the default,
      // since CBZ.CONFIG.DYNAMIC_WEATHER is off).
      "  float lum = dot(c, vec3(0.299, 0.587, 0.114));",
      "  c = mix(c, vec3(lum) * 0.94, clamp(uChop, 0.0, 1.0) * 0.42);",
      "  return c;",
      "}",
      // --- the ONE swash function (CPU twin: CBZ.waterSwashAt) --------------
      // Returns (run-up in metres about the mean waterline, its rate of
      // change). A sum of three slow sines whose phase drifts slowly ALONG the
      // coast, so the whole coastline never surges in lockstep. city/beach.js
      // wets its sand from the identical expression.
      "vec2 cbzSwash(vec2 p, float t) {",
      "  if (uSwash.z < 0.5) return vec2(0.0);",
      "  float ph = dot(p, vec2(" + gnum(SWASH_PH[0]) + ", " + gnum(SWASH_PH[1]) + "));",
      "  float a0 = t * 0.35 + ph * 1.7;",
      "  float a1 = t * 0.61 + ph * 2.9 + 1.70;",
      "  float a2 = t * 1.10 + ph * 4.3 + 3.40;",
      "  float s = 0.60 * sin(a0) + 0.30 * sin(a1) + 0.10 * sin(a2);",
      "  float v = 0.21 * cos(a0) + 0.183 * cos(a1) + 0.11 * cos(a2);",
      "  return vec2(s, v) * uSwash.x;",
      "}",
      // --- surf: bands that TRAVEL shorewards, not a static painted ring ---
      // field.g is a static distance bake, but the phase below is a function
      // of that distance MINUS time, so the white water advances up the beach
      // and dies at the waterline. A noise lookup from the ripple map breaks
      // the band so it never reads as a clean contour line.
      "float cbzSurf(vec2 p, vec4 field, float swellH, float distFade) {",
      "  if (uShoreFx < 0.5) return pow(clamp(field.g, 0.0, 1.0), 7.5) * 0.38;",
      "  float prox = clamp(field.g, 0.0, 1.0);",
      "  if (prox <= 0.001) return 0.0;",
      "  float dToShore = (1.0 - prox) * uSurf.x;",
      "  float n = texture2D(uSeaNormal, p * 0.019 + vec2(uSeaTime * -0.006, uSeaTime * 0.004)).r;",
      "  float band = sin(dToShore * uSurf.y - uSeaTime * uSurf.z + n * 2.4);",
      "  float breaker = smoothstep(0.42, 0.96, band) * pow(prox, 2.4);",
      "  breaker *= 0.45 + n * 1.1;",
      "  float rise = 0.6 + clamp(swellH, 0.0, 1.0) * 0.9;",
      "  if (uSwash.z < 0.5) {",
      "    return clamp((breaker * rise * uSurf.w + pow(prox, 6.0) * 0.9), 0.0, 1.0) * distFade;",
      "  }",
      // SWASH — offset the effective shore distance by the shared run-up and
      // threshold THAT, so the foam edge walks up the sand and drains back
      // instead of a fixed band brightening in place. The +uSwash.x bias puts
      // the mean edge one full range out from the baked coast, so the whole
      // excursion stays inside the water (the land side is discarded anyway).
      "  vec2 sw = cbzSwash(p, uSeaTime);",
      "  float dEff = dToShore - (uSwash.x + sw.x);",
      // (every smoothstep below is written edge0 < edge1 and inverted by hand:
      //  GLSL ES 1.0 leaves a reversed-edge smoothstep formally undefined.)
      "  float bw = uSurf.x * 0.14;",
      "  float edge = 1.0 - smoothstep(0.0, bw, abs(dEff));",
      // the shoreward face of the band is the wave FRONT; brighten it while
      // the front is actually advancing (sw.y > 0) and let it dull on the drain
      "  float side = 1.0 - smoothstep(-bw * 0.5, bw * 0.5, dEff);",
      "  float adv = clamp(sw.y * 0.9, -1.0, 1.0);",
      "  edge *= 1.0 + uSwash.y * side * max(0.0, adv) * 0.95;",
      // thin sheet left behind the front, thinning as the water drains back
      "  float wash = pow(prox, 6.0) * (0.35 + 0.65 * (1.0 - smoothstep(-bw * 3.0, bw, dEff)));",
      "  return clamp(breaker * rise * uSurf.w * 0.72 + edge * 0.85 + wash * 0.55, 0.0, 1.0) * distFade;",
      "}",
      // --- whitecaps on open-sea crests -----------------------------------
      // Crest HEIGHT alone smears foam down the whole flank of a swell. Real
      // whitecaps live on the tipping apex, and the apex of a wave is its
      // FLATTEST part — so a high power of the surface tilt cosine isolates it
      // for ~2 instructions. Then gate by shoaling: field.b is normalised
      // distance into deep water, so foam piles up as the bottom comes up,
      // which fakes "breaking" for free.
      "float cbzWhitecap(vec2 p, float swellH, float distFade, float inland) {",
      "  if (uShoreFx < 0.5) return 0.0;",
      "  float n = texture2D(uSeaNormal, p * 0.041 + vec2(uSeaTime * 0.010, uSeaTime * -0.013)).g;",
      "  float h = swellH + (n - 0.5) * 0.34;",
      "  float cap = smoothstep(uCapThresh, uCapThresh + 0.22, h);",
      "  float steep = 0.18 + 0.82 * pow(clamp(vCbzSteep, 0.0, 1.0), 24.0);",
      "  vec4 fw = cbzWaterField(p);",
      "  float shoal = 1.0 - smoothstep(0.0, 0.30, clamp(fw.b, 0.0, 1.0));",
      "  float breaking = mix(1.0, 2.30, shoal * (1.0 - inland));",
      "  return cap * steep * breaking * distFade * (1.0 - inland * 0.85) * (0.28 + uChop * 0.9);",
      "}",
      // --- fresnel-weighted sun glitter -----------------------------------
      // A wide, rough lobe (the glitter path a real sea makes) plus a tight
      // mirror highlight, both gated by the same Fresnel term so the sun only
      // burns where the surface is actually turned away from you.
      "vec3 cbzSunGlitter(vec3 N, vec3 V, vec3 L, float fres, float distFade) {",
      "  vec3 H = normalize(L + V);",
      "  float wide = pow(max(dot(N, H), 0.0), 24.0);",
      "  float tight = pow(max(dot(reflect(-L, N), V), 0.0), 220.0);",
      "  float up = smoothstep(-0.08, 0.22, L.y);",           // no glitter after sunset
      // WATER_FAR_CALM: the TIGHT mirror lobe is the worst aliaser on a sea —
      // at range it is a sub-pixel highlight flickering on and off between
      // frames. Collapse it quadratically with distance while the WIDE
      // glitter path (which is what actually reads as "ocean") keeps its old
      // falloff. `sharp` is exactly 1.0 in the near field, so nothing within
      // FADE_NEAR changes at all.
      "  float sharp = " + (farCalmOn() ? "distFade * distFade" : "1.0") + ";",
      "  vec3 c = uSunColor * ((wide * 0.55 + tight * 2.6 * sharp) * (0.25 + fres * 1.5) * uGlitter * up * (0.35 + distFade * 0.65));",
      // MOON PATH — the sun lobe fades out below the horizon and used to leave
      // a dead matte sea all night. This is the same construction from the
      // REAL moon direction (uMoonDir, driven from core/sky.js's own placement
      // maths): dimmer, cooler, and TIGHTER, because a moon subtends the same
      // angle as the sun but carries a millionth of the energy — you get a
      // narrow silver road, not a broad glitter field. uMoon is the night
      // fraction, so the two lobes cross-fade through dusk.
      "  if (uMoon > 0.001) {",
      "    vec3 ML = normalize(uMoonDir);",
      "    vec3 MH = normalize(ML + V);",
      "    float mw = pow(max(dot(N, MH), 0.0), 60.0);",
      "    float mt = pow(max(dot(reflect(-ML, N), V), 0.0), 420.0);",
      "    float mup = smoothstep(-0.04, 0.20, ML.y);",
      // pow 420 is even tighter than the sun's, so it aliases even harder.
      "    c += uMoonColor * ((mw * 0.30 + mt * 1.45 * sharp) * (0.20 + fres * 1.2) * uGlitter * mup * uMoon * (0.35 + distFade * 0.65));",
      "  }",
      "  return c;",
      "}",
    ].join("\n");
  };

  // ============================================================
  //  6. THE RIPPLE NORMAL MAP (one shared, seamlessly tiling texture)
  // ============================================================
  // Metre-scale detail lives here, not in geometry: a periodic multi-direction
  // height field whose analytic gradient becomes a tangent-space normal.
  // Integer frequency vectors keep every edge seamless under RepeatWrapping.
  // Deterministic (fixed constants, no rng) — only shader UV scrolling moves it.
  let rippleTex = null;
  CBZ.waterRippleTexture = function () {
    if (rippleTex) return rippleTex;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const waves = [
      [2, 1, 0.34, 0.2], [3, -2, 0.23, 1.1], [5, 4, 0.14, 2.4],
      [7, -3, 0.09, 0.7], [11, 5, 0.055, 1.8], [13, -8, 0.035, 2.9],
    ];
    for (let y = 0; y < N; y++) {
      const v = y / N * Math.PI * 2;
      for (let x = 0; x < N; x++) {
        const u = x / N * Math.PI * 2;
        let dx = 0, dz = 0;
        for (let k = 0; k < waves.length; k++) {
          const w = waves[k], c = Math.cos(w[0] * u + w[1] * v + w[3]) * w[2];
          dx += w[0] * c; dz += w[1] * c;
        }
        const nx = -dx * 0.12, nz = -dz * 0.12, inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        const q = (y * N + x) * 4;
        data[q] = Math.round((nx * inv * 0.5 + 0.5) * 255);
        data[q + 1] = Math.round((nz * inv * 0.5 + 0.5) * 255);
        data[q + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        data[q + 3] = 255;
      }
    }
    rippleTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
    rippleTex.magFilter = THREE.LinearFilter;
    rippleTex.minFilter = THREE.LinearMipmapLinearFilter;
    rippleTex.generateMipmaps = true;
    rippleTex.name = "cbz-water-ripples";
    rippleTex.needsUpdate = true;
    return rippleTex;
  };

  // ---- THE CAUSTIC MAP (a second shared, seamlessly tiling texture) -------
  // Published for whatever wants to project dancing light onto a seabed, a
  // hull, a swimmer or an underwater fog volume — sample it twice at different
  // scales/scroll rates and multiply, which is what turns a static pattern into
  // moving water light. Greyscale in RGB (A = 255), so it is usable as a map,
  // an alphaMap or an emissive mask without conversion.
  //
  // Built the same way concreteTex does in world/materials.js: lazily, once,
  // from FIXED arithmetic sequences. Two orthogonal sums of integer-frequency
  // sines form an interference field; the bright filaments are where that field
  // nulls, which is exactly how real caustics form (light folding onto a
  // curve). Integer frequencies over a 2*PI domain keep every edge seamless
  // under RepeatWrapping. No Math.random, no rng stream, no hash.
  let causticTex = null;
  CBZ.waterCausticTexture = function () {
    if (causticTex) return causticTex;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const A = [[3, 1, 0.40], [-2, 3, 0.90], [5, -4, 1.70], [1, 6, 2.50]];
    const B = [[-7, 2, 0.30], [4, 7, 1.20], [2, -5, 2.10], [6, 3, 0.60]];
    const NORM = 1 / A.length;
    for (let y = 0; y < N; y++) {
      const v = y / N * Math.PI * 2;
      for (let x = 0; x < N; x++) {
        const u = x / N * Math.PI * 2;
        let sa = 0, sb = 0;
        for (let k = 0; k < A.length; k++) sa += Math.sin(A[k][0] * u + A[k][1] * v + A[k][2]);
        for (let k = 0; k < B.length; k++) sb += Math.sin(B[k][0] * u + B[k][1] * v + B[k][2]);
        const d = Math.sqrt(sa * sa + sb * sb) * NORM;      // 0 at a null, ~1.4 at a peak
        let c = Math.pow(Math.max(0, 1 - d), 5);            // bright filaments where the field nulls
        c = Math.min(1, c * 1.45 + 0.045);                  // floor so it never goes pure black
        const q = (y * N + x) * 4;
        const b8 = Math.round(c * 255);
        data[q] = b8; data[q + 1] = b8; data[q + 2] = b8; data[q + 3] = 255;
      }
    }
    causticTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
    causticTex.magFilter = THREE.LinearFilter;
    causticTex.minFilter = THREE.LinearMipmapLinearFilter;
    causticTex.generateMipmaps = true;
    causticTex.name = "cbz-water-caustics";
    causticTex.needsUpdate = true;
    return causticTex;
  };

  // ============================================================
  //  7. THE SURFACE GEOMETRY
  // ============================================================
  // Per-tier radial resolution. Every entry costs FEWER vertices than the old
  // uniform 144x144 grid (21025) while putting a hundred times more of them
  // where the player actually is. core/quality.js tiers: 0 fastest .. 4 best.
  const TIERS = [
    { rings: 56, sectors: 72 },
    { rings: 68, sectors: 96 },
    { rings: 80, sectors: 128 },
    { rings: 96, sectors: 160 },
    { rings: 112, sectors: 192 },
  ];
  const INNER_R = 1.6;
  // Outer radius comfortably clears both the city frustum (far = 1000) and the
  // widened flight frustum (~2.8km), so the disc's rim is never on screen.
  const OUTER_R = 4500;

  CBZ.waterTierParams = function (tier) {
    if (!Number.isFinite(tier)) tier = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    tier = Math.max(0, Math.min(TIERS.length - 1, tier | 0));
    return TIERS[tier];
  };

  // A camera-centred radial disc in the XZ plane at y = 0.
  //   - one centre vertex closes the hole directly under the camera
  //   - ring radii grow geometrically: dense at your feet, coarse at the rim
  //   - uv.x carries normalised radius, uv.y the angle (free for shaders)
  // Winding is counter-clockwise seen from +Y, so the front face is up.
  CBZ.waterBuildSurfaceGeometry = function (opts) {
    opts = opts || {};
    const p = CBZ.waterTierParams(opts.tier);
    const NR = Math.max(8, (opts.rings | 0) || p.rings);
    const NA = Math.max(8, (opts.sectors | 0) || p.sectors);
    const r0 = opts.innerRadius > 0 ? +opts.innerRadius : INNER_R;
    const r1 = opts.outerRadius > 0 ? +opts.outerRadius : OUTER_R;

    const count = 1 + NR * NA;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    // centre
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    nrm[0] = 0; nrm[1] = 1; nrm[2] = 0;
    uvs[0] = 0; uvs[1] = 0;

    const growth = Math.pow(r1 / r0, 1 / Math.max(1, NR - 1));
    const radii = new Float64Array(NR);
    let r = r0;
    for (let i = 0; i < NR; i++) { radii[i] = r; r *= growth; }

    for (let i = 0; i < NR; i++) {
      const rr = radii[i];
      const ru = i / (NR - 1);
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        const k = 1 + i * NA + j;
        pos[k * 3] = Math.cos(a) * rr;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = Math.sin(a) * rr;
        nrm[k * 3] = 0; nrm[k * 3 + 1] = 1; nrm[k * 3 + 2] = 0;
        uvs[k * 2] = ru;
        uvs[k * 2 + 1] = j / NA;
      }
    }

    const triCount = NA + (NR - 1) * NA * 2;
    const idx = count > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    let w = 0;
    // centre fan (B/C swapped relative to the ring quads so the normal is +Y)
    for (let j = 0; j < NA; j++) {
      const j1 = (j + 1) % NA;
      idx[w++] = 0; idx[w++] = 1 + j1; idx[w++] = 1 + j;
    }
    for (let i = 0; i < NR - 1; i++) {
      const base = 1 + i * NA, next = 1 + (i + 1) * NA;
      for (let j = 0; j < NA; j++) {
        const j1 = (j + 1) % NA;
        idx[w++] = base + j; idx[w++] = base + j1; idx[w++] = next + j1;
        idx[w++] = base + j; idx[w++] = next + j1; idx[w++] = next + j;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    stampBounds(geo, r1);
    geo.userData.waterRadial = { rings: NR, sectors: NA, inner: r0, outer: r1 };
    return geo;
  };

  // The mesh transform never moves (the camera offset is applied in the vertex
  // program), so the bounds are authored once, by hand:
  //   • XZ covers the disc AND the published SEA_WORLD_BOUNDS footprint, so
  //     Box3.setFromObject — which city/playeraircraft.js uses to size the
  //     flyable airspace — can never come back SMALLER than the old 16km plane.
  //   • Y is flat, describing the UNDISPLACED surface exactly as the old plane
  //     did, so the world-surface audits keep classifying the sea the same way.
  function stampBounds(geo, r1) {
    const B = CBZ.SEA_WORLD_BOUNDS;
    let x0 = -r1, x1 = r1, z0 = -r1, z1 = r1;
    if (B && Number.isFinite(B.minX)) {
      // SEA_WORLD_BOUNDS is world-space; the mesh sits at (0, SEA_Y, 0).
      x0 = Math.min(x0, B.minX); x1 = Math.max(x1, B.maxX);
      z0 = Math.min(z0, B.minZ); z1 = Math.max(z1, B.maxZ);
    }
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0),
      Math.max(r1, Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) * 1.45);
  }

  // The legacy uniform grid, kept so WATER_RADIAL_MESH=0 is a true revert.
  // Verts are LOCAL (centred on origin) in both paths, so the shader is shared.
  CBZ.waterBuildLegacyGeometry = function (span, seg) {
    span = span > 0 ? +span : 16000;
    seg = seg > 0 ? (seg | 0) : 144;
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2);
    stampBounds(geo, span / 2);
    geo.userData.waterRadial = null;
    return geo;
  };

  // One call so both sea meshes pick the same geometry for the same flags.
  CBZ.waterBuildSeaGeometry = function (tier) {
    if (CFG.WATER_RADIAL_MESH === false || CFG.WATER_V2 === false) {
      return CBZ.waterBuildLegacyGeometry(16000, 144);
    }
    return CBZ.waterBuildSurfaceGeometry({ tier: tier });
  };

  // ============================================================
  //  8. THE SHARED VERTEX BODY
  // ============================================================
  // `wp0Expr` must be a vec4 world-space position of the UNDISPLACED vertex
  // (i.e. modelMatrix * vec4(position,1.0)); the disc is re-centred on the
  // camera here. Declares: vec3 wWorld, vec3 wNormal, float wHeight,
  // float wHeightN (height normalised to +-1), float wDist, float wFade,
  // float wInland.
  CBZ.waterVertexBody = function (wp0Expr) {
    const L = [];
    L.push("vec4 wBase = " + wp0Expr + ";");
    L.push("vec2 wXZ = vec2(cameraPosition.x + wBase.x, cameraPosition.z + wBase.z);");
    L.push("float wDist = length(wXZ - cameraPosition.xz);");
    L.push("float wInland = cbzInlandFactor(wXZ);");
    L.push("float wFade = mix(1.0, " + gnum(FADE_FLOOR) + ", smoothstep(" + gnum(FADE_NEAR) + ", " + gnum(FADE_FAR) + ", wDist));");
    L.push("vec3 wAmp3 = cbzWaveAmp3(wXZ, wDist);");
    L.push(CBZ.waterWaveGLSL("wXZ", "uSeaTime", "wAmp3.x", "wHeight", "wDhx", "wDhz", "wAmp3.y"));
    // Normalised crest height (+-1 at the theoretical peak) so every threshold
    // downstream — whitecaps, surf gain, spray — is expressed in one unit and
    // keeps working if the amplitude table is retuned. wAmp3.z divides the
    // DEEP gain back out (and only that), so the open ocean's 2.7x-taller
    // crests still report +-1 while the distance fade and the lake calm keep
    // shrinking the reported crest exactly as they always did.
    L.push("float wHeightN = wHeight * " + gnum(1 / TOTAL_AMP) + " / max(0.0001, wAmp3.z);");
    L.push("vec3 wWorld = vec3(wXZ.x, wBase.y + wHeight, wXZ.y);");
    L.push("vec3 wNormal = normalize(vec3(-wDhx * " + gnum(CBZ.WATER_NORMAL_EXAGGERATION) + ", 1.0, -wDhz * " + gnum(CBZ.WATER_NORMAL_EXAGGERATION) + "));");
    // The fragment stage's whitecap tip test rides on this (see cbzWhitecap).
    L.push("vCbzSteep = wNormal.y;");
    return L.join("\n");
  };

  // ============================================================
  //  9. MODE-SCOPED DISASTER WATER
  // ============================================================
  // Survival used to own an unsegmented Lambert ocean and a second flat flood
  // sheet. This is the reusable bridge: it keeps the canonical SWELLS table,
  // clock, analytic slope, ripple texture and daylight uniforms, but omits the
  // city coastline mask (the circular Survival island has its own event field).
  // Macro displacement and the CPU sample below are the SAME five rows. Fine
  // detail changes the shading normal only, never the gameplay waterline.

  CBZ.waterBuildDisasterGeometry = function (span, segments) {
    const tier = Math.max(0, Math.min(4, (CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel) | 0));
    const byTier = [64, 88, 120, 144, 168];
    const seg = Math.max(16, (segments | 0) || byTier[tier]);
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.userData.waterDisasterGrid = { span: span, segments: seg };
    return geo;
  };

  CBZ.waterDisasterSurfaceY = function (x, z, meanY, amp, chop, t) {
    const base = CBZ.waterSeaY();
    return meanY + (CBZ.waterWaveHeight(x, z, t, amp, chop) - base);
  };

  CBZ.makeDisasterWaterMaterial = function (opts) {
    opts = opts || {};
    const U = CBZ.waterCommonUniforms();
    U.uDisasterAmp = { value: Number.isFinite(opts.amp) ? +opts.amp : 1.0 };
    U.uDisasterChop = { value: Number.isFinite(opts.chop) ? +opts.chop : 1.0 };
    U.uDisasterOpacity = { value: Number.isFinite(opts.opacity) ? +opts.opacity : 1.0 };
    U.uDisasterFoam = { value: Number.isFinite(opts.foam) ? +opts.foam : 0.45 };
    U.uDisasterNormalGain = { value: Number.isFinite(opts.normalGain) ? +opts.normalGain : 9.0 };
    U.uDisasterTint = { value: new THREE.Color(opts.color == null ? 0x155878 : opts.color) };
    U.uDisasterShallow = { value: new THREE.Color(opts.shallowColor == null ? 0x3198a9 : opts.shallowColor) };
    /* ---- SEDIMENT LOAD (the Miyako term) --------------------------------
       A tsunami that has crossed a beach is not water any more, it is a
       suspension: sand, silt, sewage, ground-up timber and everything the
       front has already demolished, and it reads GRAY-BLACK, not blue. That
       is one number (uDwSediment) plus the front geometry, because the load
       is not uniform — it is heaviest AT the leading edge, where the bore is
       still scouring, and thins the further inland the same water has spread.
       Zero by default, so every existing consumer renders exactly as before. */
    U.uDwSediment = { value: 0 };
    U.uDwFrontC = { value: new THREE.Vector2(0, 0) };     // event origin, world XZ
    U.uDwFrontDir = { value: new THREE.Vector2(1, 0) };   // unit travel direction
    U.uDwFrontS = { value: -1e9 };                        // signed front position along dir
    U.uDwFrontRun = { value: 110 };                       // m the churn decays over, behind
    U.uDwMud = { value: new THREE.Color(opts.mudColor == null ? 0x171208 : opts.mudColor) };

    const vs = [
      "uniform float uSeaTime;",
      "uniform float uDisasterAmp;",
      "uniform float uDisasterChop;",
      "uniform float uDisasterNormalGain;",
      "varying vec3 vDwWorld;",
      "varying vec3 vDwNormal;",
      "varying float vDwHeight;",
      "varying float vDwDist;",
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vec4 dwBase = modelMatrix * vec4(position, 1.0);",
      CBZ.waterWaveGLSL("dwBase.xz", "uSeaTime", "uDisasterAmp", "dwH", "dwDx", "dwDz", "uDisasterChop"),
      "  vec3 dwWorld = vec3(dwBase.x, dwBase.y + dwH, dwBase.z);",
      "  vec3 dwNormal = normalize(vec3(-dwDx * uDisasterNormalGain, 1.0, -dwDz * uDisasterNormalGain));",
      "  vDwWorld = dwWorld;",
      "  vDwNormal = dwNormal;",
      "  vDwHeight = dwH / max(0.0001, " + gnum(TOTAL_AMP) + " * max(uDisasterAmp, uDisasterChop));",
      "  vDwDist = distance(cameraPosition.xz, dwWorld.xz);",
      "  vec4 mvPosition = viewMatrix * vec4(dwWorld, 1.0);",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const fs = [
      "uniform float uSeaTime;",
      "uniform sampler2D uSeaNormal;",
      "uniform vec3 uSunDir;",
      "uniform vec3 uSunColor;",
      "uniform vec3 uFoamColor;",
      "uniform vec3 uDisasterTint;",
      "uniform vec3 uDisasterShallow;",
      "uniform float uDisasterOpacity;",
      "uniform float uDisasterFoam;",
      "uniform float uDwSediment;",
      "uniform vec2 uDwFrontC;",
      "uniform vec2 uDwFrontDir;",
      "uniform float uDwFrontS;",
      "uniform float uDwFrontRun;",
      "uniform vec3 uDwMud;",
      "varying vec3 vDwWorld;",
      "varying vec3 vDwNormal;",
      "varying float vDwHeight;",
      "varying float vDwDist;",
      "#include <fog_pars_fragment>",
      "void main() {",
      // Two octave normal flow: the useful part of the reference's FBM, but
      // sampled from the one shared tile and distance-damped to avoid sparkle.
      "  vec2 q0 = vDwWorld.xz * 0.042 + vec2(uSeaTime * 0.030, -uSeaTime * 0.021);",
      "  vec2 q1 = vec2(vDwWorld.z, -vDwWorld.x) * 0.079 + vec2(-uSeaTime * 0.022, uSeaTime * 0.027);",
      "  vec3 a = texture2D(uSeaNormal, q0).rgb * 2.0 - 1.0;",
      "  vec3 b = texture2D(uSeaNormal, q1).rgb * 2.0 - 1.0;",
      "  float detail = mix(0.46, 0.12, smoothstep(45.0, 520.0, vDwDist));",
      "  vec3 micro = normalize(vec3((a.r + b.r) * 0.33, 1.0, (a.g + b.g) * 0.33));",
      "  vec3 N = normalize(vDwNormal + micro * detail - vec3(0.0, detail, 0.0));",
      "  if (!gl_FrontFacing) N = -N;",
      "  vec3 V = normalize(cameraPosition - vDwWorld);",
      "  vec3 L = normalize(uSunDir);",
      "  float ndl = max(dot(N, L), 0.0);",
      "  float fres = 0.025 + 0.975 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.8);",
      // Crest translucency/subsurface tint: bright turquoise only on the thin
      // sun-facing crest, not a global neon water colour.
      "  float crest = smoothstep(0.18, 0.88, vDwHeight);",
      "  float back = pow(max(dot(-L, N), 0.0), 2.0) * crest;",
      "  vec3 body = mix(uDisasterTint * 0.62, uDisasterShallow, crest * 0.42);",
      "  body *= 0.58 + ndl * 0.42;",
      "  body += uDisasterShallow * back * 0.18;",
      // Coherent analytic sky gradient in the reflected direction. High-tier
      // city water still mirrors the real scene; this cheap arena surface gets
      // a stable horizon rather than a flat Lambert card.
      "  vec3 R = reflect(-V, N);",
      "  float skyT = smoothstep(-0.12, 0.72, R.y);",
      "  vec3 sky = mix(vec3(0.48, 0.65, 0.72), vec3(0.16, 0.36, 0.58), skyT);",
      "  vec3 outColor = mix(body, sky, fres * 0.72);",
      "  vec3 H = normalize(L + V);",
      "  float glitter = pow(max(dot(N, H), 0.0), 34.0) * (0.18 + fres * 1.35);",
      "  outColor += uSunColor * glitter * 0.72;",
      // Restrained crest foam. Detail noise breaks it into patches; height and
      // analytic tilt keep it at the tipping apex instead of painting flanks.
      "  float n = (a.b + b.b) * 0.5;",
      // ---- THE TURBID FRONT. Everything below is multiplied by uDwSediment,
      //      which is 0 for every non-tsunami consumer, so this whole block
      //      compiles to "no change" on the calm sea and the flash flood.
      "  float fdS = dot(vDwWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS;",
      "  float behind = clamp(-fdS / max(1.0, uDwFrontRun), 0.0, 1.0);",
      // Dirty everywhere the bore has already been, filthiest at the edge. The
      // floor is HIGH on purpose: an inundation does not clear behind the
      // front, it stands there brown for hours, and the first pass's 0.52
      // floor let the flooded town go back to reading as a clean lagoon.
      "  float sed = uDwSediment * mix(1.0, 0.88, smoothstep(0.0, 1.0, behind)) * (1.0 - smoothstep(-1.0, 7.0, fdS));",
      "  sed *= 0.72 + 0.46 * n;",
      "  vec3 mud = uDwMud * (0.55 + ndl * 0.55);",
      "  outColor = mix(outColor, mud, clamp(sed, 0.0, 0.94));",
      // BOILING FOAM ON THE LEADING EDGE: a narrow band riding the front,
      // broken up by the detail noise so it churns instead of ruling a line.
      "  float boil = uDwSediment * exp(-abs(fdS) / 13.0) * (0.35 + 0.85 * n);",
      "  outColor = mix(outColor, uFoamColor * 0.93, clamp(boil, 0.0, 0.90));",
      // WHITEWATER STREAKS TRAILING BEHIND: the tile sampled stretched 6x along
      // the travel axis and scrolled with it, so the wake reads as long torn
      // ribbons pointing back at the sea rather than as generic surface noise.
      "  vec2 axisXZ = vec2(-uDwFrontDir.y, uDwFrontDir.x);",
      "  vec2 sq = vec2(dot(vDwWorld.xz - uDwFrontC, uDwFrontDir) * 0.019 - uSeaTime * 0.16,",
      "                 dot(vDwWorld.xz, axisXZ) * 0.115);",
      "  float streak = texture2D(uSeaNormal, sq).b;",
      "  streak = smoothstep(0.58, 0.95, streak) * uDwSediment * (1.0 - behind) * (1.0 - smoothstep(-2.0, 4.0, fdS));",
      "  outColor = mix(outColor, uFoamColor, clamp(streak * 0.62, 0.0, 0.62));",
      "  float tip = pow(clamp(vDwNormal.y, 0.0, 1.0), 18.0);",
      "  float foam = smoothstep(0.48, 0.90, vDwHeight + (n - 0.5) * 0.38) * tip * uDisasterFoam;",
      "  outColor = mix(outColor, uFoamColor, clamp(foam, 0.0, 0.88));",
      "  gl_FragColor = vec4(outColor, uDisasterOpacity);",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const transparent = opts.transparent === true || U.uDisasterOpacity.value < 0.999;
    const mat = new THREE.ShaderMaterial({
      name: opts.name || "CBZ Disaster Water",
      uniforms: U, vertexShader: vs, fragmentShader: fs,
      fog: true, transparent: transparent,
      opacity: U.uDisasterOpacity.value,
      depthWrite: opts.depthWrite == null ? !transparent : !!opts.depthWrite,
      depthTest: true, side: THREE.DoubleSide,
    });
    mat.userData.waterMode = "shared-disaster-fresnel";
    mat.userData.waterUniforms = U;
    return mat;
  };

  CBZ.waterDriveDisasterSurface = function (target, state) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u) return false;
    CBZ.waterDriveCommonUniforms(u);
    state = state || {};
    if (Number.isFinite(state.amp)) u.uDisasterAmp.value = +state.amp;
    if (Number.isFinite(state.chop)) u.uDisasterChop.value = +state.chop;
    if (Number.isFinite(state.foam)) u.uDisasterFoam.value = +state.foam;
    if (Number.isFinite(state.opacity)) {
      u.uDisasterOpacity.value = +state.opacity;
      mat.opacity = +state.opacity;
    }
    // ---- the turbid-front block. Absent from `state` = untouched, so an
    //      existing caller keeps its clean water without knowing this exists.
    if (u.uDwSediment) {
      if (Number.isFinite(state.sediment)) u.uDwSediment.value = Math.max(0, Math.min(1, +state.sediment));
      if (state.frontC) u.uDwFrontC.value.set(+state.frontC[0] || 0, +state.frontC[1] || 0);
      if (state.frontDir) {
        const dx = +state.frontDir[0] || 0, dz = +state.frontDir[1] || 0;
        const l = Math.hypot(dx, dz) || 1;
        u.uDwFrontDir.value.set(dx / l, dz / l);
      }
      if (Number.isFinite(state.frontS)) u.uDwFrontS.value = +state.frontS;
      if (Number.isFinite(state.frontRun)) u.uDwFrontRun.value = Math.max(1, +state.frontRun);
      if (state.mud != null) u.uDwMud.value.set(state.mud);
    }
    return true;
  };

  /* ============================================================
     THE BORE FACE — ONE CURLING WAVE, SHARED BY BOTH TSUNAMIS.

     A breaking bore is the one water shape a height field genuinely cannot
     express: it OVERHANGS, and you can see up into the barrel from under it.
     So it stays a mesh. It carries no wetness truth, no collision and no
     surge — the caller puts it on the front that water_spec's own event
     descriptor already publishes, and this file only knows how to SHAPE it.

     It lives here, and not in either tsunami, because there are two tsunamis
     (systems/disasters.js on the survival island, city/tsunami.js in the real
     world) and the owner's note is that they must look identical. One builder,
     two consumers, and the second one costs three lines.

     TWO FACES, ONE GEOMETRY, one parameter between them:
       turbid 0  OPEN SEA — a towering blue-green curl with a spray-torn lip,
                 tallest just before it feels the bottom.
       turbid 1  LANDFALL — Miyako: a gray-black churning soup boiling over the
                 seawall, foam shredding off the leading edge, no blue left.

     CBZ.tsuFaceBuild({width, height, seed}) -> handle   (caller adds handle.group)
     CBZ.tsuFaceUpdate(handle, {t, height, turbid, curl, foam, x, y, z, dirX, dirZ})
     CBZ.tsuFaceDispose(handle)
     ============================================================ */
  // [forward z (m at H=34), height 0..1] — foot → face → apex → curl → lip
  const TSU_PROFILE = [
    [-8.0, 0.00], [-3.6, 0.30], [-1.4, 0.58], [0.4, 0.80], [2.2, 0.965],
    [3.4, 1.00], [4.6, 0.945], [5.2, 0.80], [4.6, 0.62],
  ];
  // per row: open-sea colour, then landfall (sediment) colour. The landfall
  // ramp is deliberately almost monochrome — a tsunami that has already eaten
  // a town has no hue left in it, only value.
  /* THE LANDFALL COLUMN IS DELIBERATELY VERY DARK AND WARM, and both of those
     are corrections made by looking at the render rather than at the numbers:
     the scene is lit by a blue-gray hemisphere and the output is sRGB-encoded,
     so a value that reads "dark neutral" in this table comes out of the
     renderer as a bright TEAL. Half the value and a warm bias is what actually
     lands on Miyako's gray-black mud once the light and the encoding have had
     their say. (The emissive and specular are faded out with turbidity for the
     same reason — a blue emissive term is why the first pass had a teal wave
     that the palette insisted was black.) */
  const TSU_ROWCOL = [
    [[0.03, 0.12, 0.20], [0.030, 0.026, 0.020]],
    [[0.05, 0.18, 0.30], [0.048, 0.041, 0.031]],
    [[0.08, 0.28, 0.42], [0.078, 0.067, 0.050]],
    [[0.12, 0.40, 0.55], [0.115, 0.099, 0.075]],
    [[0.22, 0.55, 0.68], [0.170, 0.150, 0.118]],
    [[0.42, 0.72, 0.82], [0.250, 0.230, 0.195]],
    [[0.60, 0.83, 0.90], [0.360, 0.340, 0.305]],
    [[0.72, 0.90, 0.95], [0.500, 0.485, 0.455]],
    [[0.55, 0.80, 0.88], [0.340, 0.328, 0.305]],
  ];
  const TSU_COLS = 30;

  CBZ.tsuFaceBuild = function (opts) {
    opts = opts || {};
    const H = Number.isFinite(opts.height) ? +opts.height : 34;
    const W = Number.isFinite(opts.width) ? +opts.width : 320;
    const zs = H / 34;
    const rnd = typeof opts.rnd === "function" ? opts.rnd : Math.random;
    const grp = new THREE.Group();
    const ROWS = TSU_PROFILE.length, COLS = TSU_COLS;
    const geoms = [], mats = [];

    // per-column jitter so the front churns instead of reading as a ruler
    const zJit = [], hJit = [];
    for (let c = 0; c <= COLS; c++) { zJit.push((rnd() - 0.5) * 4.5); hJit.push(0.9 + rnd() * 0.2); }
    const n = ROWS * (COLS + 1);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const colClean = new Float32Array(n * 3);
    const colMud = new Float32Array(n * 3);
    let vi = 0;
    for (let r = 0; r < ROWS; r++) {
      const rc = TSU_ROWCOL[r], up = r / (ROWS - 1);
      for (let c = 0; c <= COLS; c++) {
        pos[vi] = (c / COLS - 0.5) * W;
        pos[vi + 1] = TSU_PROFILE[r][1] * H * hJit[c];
        pos[vi + 2] = TSU_PROFILE[r][0] * zs + zJit[c] * up;
        // a little per-column value noise so neither palette reads as a decal
        const v = hJit[c];                       // 0.9 .. 1.1 about unity
        colClean[vi] = rc[0][0] * v; colClean[vi + 1] = rc[0][1] * v; colClean[vi + 2] = rc[0][2] * v;
        colMud[vi] = rc[1][0] * v; colMud[vi + 1] = rc[1][1] * v; colMud[vi + 2] = rc[1][2] * v;
        col[vi] = colClean[vi]; col[vi + 1] = colClean[vi + 1]; col[vi + 2] = colClean[vi + 2];
        vi += 3;
      }
    }
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
      const a0 = r * (COLS + 1) + c, b0 = a0 + 1, a1 = a0 + COLS + 1, b1 = a1 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geoms.push(geo);
    const wallMat = new THREE.MeshPhongMaterial({
      vertexColors: true, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: false,
      shininess: 72, specular: 0x9fd9eb, emissive: 0x061b25, emissiveIntensity: 0.18,
    });
    mats.push(wallMat);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.renderOrder = 3;
    grp.add(wall);

    /* Broken ribbons, not billboard rectangles. Each patch is an independent
       sloped quad with deterministic gaps, so from below or above the crest
       reads as churning white water rather than a white roof card. */
    function foamRibbon(kind, color, opacity, blend) {
      const fp = [], fi = [];
      // The crest gets THREE TIMES the patch count of the first pass. At 48
      // across a 320 m front each shred was seven metres wide, which from any
      // camera close enough to matter read as a row of paper kites floating
      // clear of the wave. Spray tears small.
      const cnt = kind === "crest" ? 144 : (kind === "boil" ? 62 : 48);
      for (let c = 0; c < cnt; c++) {
        if ((c * 7 + (kind === "crest" ? 3 : 1)) % 11 < 2) continue;
        const x0 = (c / cnt - 0.5) * W, x1 = ((c + 1.12) / cnt - 0.5) * W;
        /* TWO OCTAVES, and the low one has to dominate. A single sin() at 2.31
           rad per patch flips every neighbour to the opposite extreme, so at
           144 patches the "torn" crest came out as a perfect origami sawtooth
           — regular is the one thing spray never is. A slow swell carrying a
           small chop reads as water tearing. */
        const kph = kind === "crest" ? 0.7 : 2.1;
        const w0 = Math.sin(c * 0.53 + kph) * 0.74 + Math.sin(c * 2.31 + kph * 3.1) * 0.26;
        const w1 = Math.sin((c + 1) * 0.53 + kph) * 0.74 + Math.sin((c + 1) * 2.31 + kph * 3.1) * 0.26;
        let y0, y1, z0, z1, depth;
        if (kind === "crest") {
          // A SPRAY-TORN LIP, not a white roof. The old patches lay nearly
          // flat across the top of the wave, so from any elevated camera the
          // crest read as a row of paper plates. These hang DOWN the front of
          // the lip (drop > depth) and wander far more in height, so the
          // silhouette is ragged from above and from below.
          y0 = H * 0.975 + w0 * 1.25; y1 = H * 0.975 + w1 * 1.25;
          z0 = 3.9 * zs + w0 * 0.8; z1 = 3.9 * zs + w1 * 0.8;
          depth = 1.5 + ((c * 13) % 7) * 0.34;
        } else if (kind === "boil") {
          // THE BOILING LEADING EDGE. Low, wide, way out in FRONT of the foot,
          // heaving up and down in big irregular blobs — the shredded white
          // water a bore pushes ahead of itself as it scours the ground.
          y0 = 0.55 + Math.abs(w0) * 2.2 * (H / 34); y1 = 0.55 + Math.abs(w1) * 2.2 * (H / 34);
          z0 = (6.4 + Math.abs(w0) * 3.4) * zs; z1 = (6.4 + Math.abs(w1) * 3.4) * zs;
          depth = 5.5 + ((c * 17) % 9) * 0.75;
        } else {
          y0 = 1.15 + w0 * 0.18; y1 = 1.15 + w1 * 0.18;
          z0 = 4.8 * zs + w0 * 0.45; z1 = 4.8 * zs + w1 * 0.45;
          depth = 4.0 + ((c * 13) % 7) * 0.32;
        }
        const drop = kind === "crest" ? depth * 0.85 : (kind === "boil" ? 0.35 : 0.05);
        const q = fp.length / 3;
        fp.push(x0, y0, z0, x1, y1, z1, x0, y0 - drop, z0 + depth, x1, y1 - drop, z1 + depth);
        fi.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
      fg.setIndex(fi); fg.computeVertexNormals();
      const fm = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: opacity, side: THREE.DoubleSide,
        depthWrite: false, blending: blend === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      geoms.push(fg); mats.push(fm);
      const mesh = new THREE.Mesh(fg, fm); mesh.renderOrder = 5; return mesh;
    }
    const crest = foamRibbon("crest", 0xffffff, 0.82);
    const foot = foamRibbon("foot", 0xeaf8ff, 0.66);
    // Not additive: dirty foam over a dark sky must still read as WHITE MATTER,
    // and additive white over a bright horizon just blows out to nothing.
    const boil = foamRibbon("boil", 0xf1f4f2, 0.0, false);
    grp.add(crest, foot, boil);

    // FACE STREAKS: the vertical tears of aerated water down the wave's face.
    const streaks = [];
    for (let i = 0; i < 11; i++) {
      const sg = new THREE.PlaneGeometry(0.55 + rnd() * 0.95, H * (0.26 + rnd() * 0.4));
      const sm = new THREE.MeshBasicMaterial({
        color: 0xdff1fb, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      geoms.push(sg); mats.push(sm);
      const s = new THREE.Mesh(sg, sm);
      s.position.set((rnd() - 0.5) * W * 0.9, H * 0.45, 1.6 * zs);
      s.renderOrder = 4; grp.add(s); streaks.push(s);
    }

    /* THE WAKE: flat torn ribbons of whitewater lying on the surface BEHIND
       the front and streaming back toward the sea. This is what tells you at a
       glance which way the water is going — on the survival island the shader
       draws it too, but the city ocean is a different material entirely and
       this is what carries the same read into the real world. */
    const wake = [];
    for (let i = 0; i < 14; i++) {
      const len = 26 + rnd() * 74, wid = 1.1 + rnd() * 3.2;
      const wg = new THREE.PlaneGeometry(wid, len);
      wg.rotateX(-Math.PI / 2);
      const wm = new THREE.MeshBasicMaterial({
        color: 0xe8eee9, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
      });
      geoms.push(wg); mats.push(wm);
      const m = new THREE.Mesh(wg, wm);
      m.position.set((rnd() - 0.5) * W * 0.94, 0.35, -(10 + rnd() * 70));
      m.renderOrder = 4; grp.add(m);
      wake.push({ m, ph: rnd() * 6.28, len: len, base: m.position.z, rate: 9 + rnd() * 22 });
    }

    return {
      group: grp, wall: wall, basePos: new Float32Array(pos),
      cols: COLS, rows: ROWS, baseH: H, width: W,
      colClean: colClean, colMud: colMud, mudMix: -1,
      foams: [crest, foot], boil: boil, streaks: streaks, wake: wake,
      geoms: geoms, mats: mats,
    };
  };

  /* Per-frame. Moves the face's 279 vertices in overlapping directional
     phases and rebuilds the analytic normals; scales the whole profile with
     the wave's live height; advances the overhang with `curl`; and cross-fades
     the two palettes with `turbid`. The physical front is untouched — only the
     visible water churns, so collision can never drift from presentation. */
  CBZ.tsuFaceUpdate = function (h, s) {
    if (!h || !h.wall) return false;
    s = s || {};
    const t = Number.isFinite(s.t) ? +s.t : 0;
    const H = Number.isFinite(s.height) ? +s.height : h.baseH;
    const hs = H / Math.max(0.001, h.baseH);
    const turbid = Math.max(0, Math.min(1, Number.isFinite(s.turbid) ? +s.turbid : 0));
    const curl = Math.max(0, Math.min(1.6, Number.isFinite(s.curl) ? +s.curl : 0.5));
    const foamGain = Number.isFinite(s.foam) ? +s.foam : 0.7;

    const a = h.wall.geometry.attributes.position, p = a.array, base = h.basePos;
    const cols = h.cols, rows = h.rows;
    // churn amplitude grows with the sediment load — clean open-sea swell is
    // smooth, a debris soup is not
    const chAmp = 1 + turbid * 1.35;
    for (let r = 0; r < rows; r++) {
      const up = r / Math.max(1, rows - 1);
      for (let c = 0; c <= cols; c++) {
        const q = (r * (cols + 1) + c) * 3, x = base[q];
        const ph0 = t * 1.55 + x * 0.052 + r * 0.61;
        const ph1 = t * -2.10 + x * 0.091 - r * 0.37;
        p[q] = x + Math.sin(ph1) * up * 0.34 * chAmp;
        p[q + 1] = base[q + 1] * hs + (Math.sin(ph0) * (0.16 + up * 0.72) + Math.sin(ph1) * up * 0.22) * chAmp;
        // OVERHANG: the lip throws further forward the harder the wave curls,
        // and it curls hardest just before it feels the bottom.
        p[q + 2] = base[q + 2] * hs + Math.sin(ph0 * 0.77) * (0.08 + up * 0.78) * chAmp
          + up * up * curl * 6.2 * hs;
      }
    }
    a.needsUpdate = true;
    h.wall.geometry.computeVertexNormals();
    h.wall.geometry.attributes.normal.needsUpdate = true;

    // palette cross-fade, only when it has actually moved (a full rewrite of
    // 279 colours every frame for nothing is the kind of cost that adds up)
    if (Math.abs(turbid - h.mudMix) > 0.012) {
      h.mudMix = turbid;
      const ca = h.wall.geometry.attributes.color, cp = ca.array;
      for (let i = 0; i < cp.length; i++) cp[i] = h.colClean[i] + (h.colMud[i] - h.colClean[i]) * turbid;
      ca.needsUpdate = true;
      // and the water goes from translucent green glass to opaque mud: the
      // glassy terms (specular sheen, the blue subsurface emissive) are what
      // MAKE it read as water, so a debris soup has to lose all of them
      const m = h.wall.material;
      m.opacity = 0.90 + turbid * 0.09;
      m.shininess = 72 - turbid * 62;
      m.specular.setRGB(0.62 - turbid * 0.56, 0.85 - turbid * 0.78, 0.92 - turbid * 0.85);
      m.emissiveIntensity = 0.18 * (1 - turbid);
    }

    const fl = h.foams;
    for (let i = 0; i < fl.length; i++) {
      fl[i].scale.set(1, hs, hs);
      fl[i].material.opacity = (0.42 + 0.34 * Math.abs(Math.sin(t * 3.1 + i * 1.7))) * (0.6 + foamGain * 0.7);
    }
    if (h.boil) {
      // the boil only exists once the bore is scouring something — in deep
      // water there is nothing under it to tear up
      h.boil.scale.set(1, hs, hs);
      h.boil.position.y = Math.sin(t * 2.3) * 0.5 * hs;
      h.boil.material.opacity = Math.min(0.95, turbid * (0.62 + 0.33 * Math.abs(Math.sin(t * 4.3))));
      h.boil.visible = turbid > 0.03;
    }
    const sk = h.streaks;
    for (let i = 0; i < sk.length; i++) {
      sk[i].material.opacity = (0.13 + 0.2 * Math.abs(Math.sin(t * 2.0 + i))) * (1 - turbid * 0.35);
      sk[i].position.y = H * (0.42 + 0.05 * Math.sin(t * 1.6 + i * 2));
      sk[i].scale.y = hs;
    }
    const wk = h.wake;
    for (let i = 0; i < wk.length; i++) {
      const w = wk[i];
      // ribbons stream back toward the sea and recycle at the front
      w.base -= w.rate * (Number.isFinite(s.dt) ? +s.dt : 1 / 60);
      if (w.base < -190) w.base = -(6 + Math.random() * 20);
      w.m.position.z = w.base;
      w.m.position.y = 0.28 + Math.sin(t * 2.4 + w.ph) * 0.16;
      w.m.material.opacity = turbid * (0.16 + 0.26 * Math.abs(Math.sin(t * 1.3 + w.ph)));
      w.m.visible = turbid > 0.05;
    }
    if (Number.isFinite(s.x) && Number.isFinite(s.z)) h.group.position.set(s.x, +s.y || 0, s.z);
    if (Number.isFinite(s.dirX) && Number.isFinite(s.dirZ)) h.group.rotation.y = Math.atan2(s.dirX, s.dirZ);
    return true;
  };

  CBZ.tsuFaceDispose = function (h) {
    if (!h) return false;
    if (h.group && h.group.parent) h.group.parent.remove(h.group);
    for (let i = 0; i < h.geoms.length; i++) h.geoms[i].dispose();
    for (let i = 0; i < h.mats.length; i++) if (h.mats[i].dispose) h.mats[i].dispose();
    h.group = null; h.wall = null; h.geoms = []; h.mats = [];
    return true;
  };

  // One arena-scoped physical descriptor. Directors publish phase/front/level;
  // swimmers, debris and tests sample it. A curling bore may still have a
  // presentation mesh because it is not a single-valued height field, but it
  // owns no second collision or wetness truth.
  let waterEvent = null;
  CBZ.waterEventSet = function (spec) {
    if (!spec) { waterEvent = null; return null; }
    if (!waterEvent || (spec.owner && waterEvent.owner !== spec.owner)) waterEvent = {};
    for (const k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) waterEvent[k] = spec[k];
    return waterEvent;
  };
  CBZ.waterEventGet = function () { return waterEvent; };
  CBZ.waterEventClear = function (owner) {
    if (!waterEvent || (owner && waterEvent.owner !== owner)) return false;
    waterEvent = null; return true;
  };
  CBZ.waterEventSample = function (x, z, t, out) {
    out = out || {};
    const e = waterEvent;
    if (!e) { out.active = false; out.wet = false; return out; }
    const dx = Number.isFinite(e.dx) ? e.dx : 0, dz = Number.isFinite(e.dz) ? e.dz : 0;
    const s = (x - (+e.cx || 0)) * dx + (z - (+e.cz || 0)) * dz;
    const fd = s - (Number.isFinite(e.frontS) ? e.frontS : 1e9);
    const phase = e.phase || "";
    const wet = phase === "flooded" || phase === "drain" || (phase === "sweep" && fd <= (Number.isFinite(e.frontWet) ? e.frontWet : -2));
    const mean = Number.isFinite(e.level) ? e.level : 0;
    const amp = Number.isFinite(e.waveAmp) ? e.waveAmp : 1;
    const chop = Number.isFinite(e.chopAmp) ? e.chopAmp : amp;
    out.active = true; out.owner = e.owner || ""; out.kind = e.kind || ""; out.phase = phase;
    out.wet = wet; out.frontDistance = fd; out.mean = mean;
    out.height = CBZ.waterDisasterSurfaceY(x, z, mean, amp, chop, t);
    const flow = wet && Number.isFinite(e.flow) ? e.flow : 0;
    out.currentX = dx * flow; out.currentZ = dz * flow;
    out.foam = phase === "sweep" ? Math.max(0, 1 - Math.abs(fd) / Math.max(1, +e.frontWidth || 18)) : 0;
    /* THE SEDIMENT LOAD AND THE UNDERTOW, on the same descriptor, because they
       are the same water. `sediment` is what makes the front gray-black and is
       also the honest "is this a debris soup" test for anything entrained in
       it. `undertow` is the flow being NEGATIVE — the drain dragging seaward —
       which is the half of a tsunami that actually drowns people, and it is a
       sign, not a second field. */
    out.sediment = wet && Number.isFinite(e.sediment) ? e.sediment : 0;
    out.undertow = flow < 0 ? -flow : 0;
    return out;
  };

  CBZ.waterSpecReady = true;
})();
