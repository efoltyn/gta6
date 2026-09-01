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
   procedural textures. The wave CLOCK is the SIM clock (CBZ.now), not the
   wall clock: swimmers ride this surface, so the crest height is hashed
   state and the phase has to be pinnable. See CBZ.waterClock below.

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

  // WATER_SURFACE_LOOK: the SURFACE LOOK pass, built against the owner's
  // coastal-Alaska reference photos (2026-08-03). Five things, all of them
  // shading-only — not one line of it touches a height, a slope or the CPU
  // wave query, so buoyancy, the swimmer, the hulls and the amplitude budget
  // at the top of section 1 are untouched BY CONSTRUCTION:
  //   1. WIND RIPPLE — three octaves of the shared tile sampled in a rotated,
  //      wind-stretched frame at incommensurate scales, each octave's gradient
  //      rotated back into world space. Dense small wavelets, no visible tile.
  //   2. STREAK LANES — one very low-frequency, hard-stretched lookup that
  //      modulates how rough each lane of water is. That is what makes a real
  //      sea read as bands of calmer and rougher water instead of one uniform
  //      fizz, and it is what breaks a single glare blob into sheen lanes.
  //   3. DISTANCE = ROUGHNESS. Fading the ripple normal with distance (which
  //      WATER_FAR_CALM must do, or the horizon aliases) silently turns the far
  //      sea into a MIRROR, so every far pixel reflected the brightest part of
  //      the sky and the ocean went white. The fade now hands its energy to a
  //      roughness term instead: the reflection is pre-filtered toward the
  //      higher, deeper sky and the Fresnel curve relaxes from a mirror's to a
  //      rough surface's. That single pair is what puts colour back in the
  //      distance.
  //   4. SHORE CALM BAND — the glassy strip hugging a shoreline before the
  //      ripple field starts (reference: the water under the mountains).
  //   5. SKY TONE — one shared horizon/upper-sky pair driven from the LIVE
  //      scene fog colour (core/sky.js pins the dome's horizon band to exactly
  //      that, so the sea and the sky agree by construction), attenuated by one
  //      reflectance gain: the dome is painted to look right AS SKY, and handing
  //      the sea an unattenuated copy of it pushed every water pixel into the
  //      ACES shoulder, where the grade desaturates — which is why a teal
  //      ocean kept coming back grey whatever the body tint was set to.
  //   6. CALM MEANS CALM — the whitecap threshold and gain are retuned so a
  //      windless sea carries ripple and no spray, and the body colour table
  //      (CBZ.WATER_TONES) moves off navy onto the reference's teal.
  // OFF -> the previous ripple pair, the old Fresnel and no lanes, i.e. the
  // sea exactly as it shipped (`?cfg_WATER_SURFACE_LOOK=0`).
  if (CFG.WATER_SURFACE_LOOK == null) CFG.WATER_SURFACE_LOOK = true;

  /* ---- SEA_TRANSLUCENT — THE SEA YOU CAN SEE INTO -----------------------
     OWNER (2026-08-25): "the shadow left by the orca is dumb and fake, like a
     fake horizon — rather than water being slightly opaque and the shadow
     being real then."

     He is right, and the files that draw those shadows say so themselves:
     wildlife_shark.js's own header admits "the sea is OPAQUE ... so from above
     the water the body is never actually visible" and calls the silhouette a
     stand-in for that fact. The silhouette is a painted proxy for a missing
     rendering feature. This is the feature.

     TWO HALVES, and only both together make it work:

       1. THE SURFACE BLENDS. Both sea materials now write a real alpha instead
          of 1.0, and the alpha is the physics: you can see INTO water you are
          looking down at, and you cannot see into water you are looking ACROSS
          (cbzSeaAlpha below). Straight down ~0.58 opacity; twenty degrees off
          the horizontal is already 0.9; the horizon is 1.0. So this cannot
          "open a hole" in the far ocean and cannot fight the horizon fuse.

       2. THE BODY DIMS. A constant blend alone would show a shark at 30 m
          exactly as brightly as a shark at 1 m, which is the sticker problem
          again wearing a different hat. CBZ.waterVeilApply() patches a
          submerged animal's OWN materials so every fragment fades toward the
          water colour by the length of the water column between it and the eye
          (Beer-Lambert, one exp()). That is why depth still swallows: at a
          grazing angle the column is long and the animal is gone, which is
          also exactly when the surface has gone opaque. The two halves agree
          because they are the same geometry.

     PERF: the alpha ramp is bounded to CLARITY_FAR metres, so the transparent
     region is a puddle around the camera and the other 15.8 km of the disc
     blends at alpha 1.0 (the same pixel cost it always had, one extra blend
     op). depthWrite STAYS ON, so the sea still owns its depth the way it did
     and nothing downstream loses an occluder.

     OFF (?cfg_SEA_TRANSLUCENT=0) -> gl_FragColor.a is 1.0 on both sea
     materials, the materials go back to transparent:false, no material is ever
     veiled, and wildlife_shark.js / wildlife_orca.js draw their painted
     silhouettes again. A true one-flag revert to the sticker. */
  if (CFG.SEA_TRANSLUCENT == null) CFG.SEA_TRANSLUCENT = true;
  function translucentOn() { return CFG.SEA_TRANSLUCENT !== false && CFG.WATER_V2 !== false; }
  CBZ.seaTranslucentOn = translucentOn;

  // How clear, and how far the clarity reaches.
  const CLARITY = 0.46;      // max transparency looking STRAIGHT DOWN (1-alpha)
  const CLARITY_POW = 5.0;   // Schlick exponent — the REAL Fresnel curve (see cbzSeaAlpha)
  const CLARITY_NEAR = 55;   // m — full clarity inside this
  const CLARITY_FAR = 240;   // m — fully opaque beyond this
  const VEIL_K = 0.115;      // Beer-Lambert extinction, per metre of water (~8.7 m e-fold)

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

  // ---- THE SEA'S BODY COLOUR, ONE TABLE -----------------------------------
  // city/world.js drives uSeaColor from these across the day/night cycle and
  // world/waterfx.js copies that value into the mirror, so this is the single
  // place the ocean's tone is authored. Owner's coastal reference: a deep,
  // SATURATED TEAL — green and blue within a few percent — never the old navy
  // (whose blue ran half again ahead of its green) and never a grey-blue
  // plastic. Consumers read it with a literal fallback, so a build without this
  // table renders exactly as before.
  CBZ.WATER_TONES = surfaceLookOn()
    ? { day: 0x041b1c, night: 0x020a0c, dusk: 0x1e2130 }
    : { day: 0x0d3b58, night: 0x04131d, dusk: 0x34364d };

  // ---- shared clock -------------------------------------------------------
  // Wrapped so sin() arguments stay small. Every consumer (both shaders and
  // the CPU query) reads THIS, so the rendered crest and the queried height
  // are the same crest.
  //
  // IT IS THE SIM CLOCK NOW, NOT THE WALL CLOCK. This was performance.now(),
  // which was fair while the sea was pure FX — nothing the game recorded had a
  // wave in it. That stopped being true the moment swimmers started riding the
  // surface: an animal's pos.y IS citySeaHeightAt, and that is exactly what
  // tools/determinism-check.mjs hashes. The tool pins CBZ.now and drives the
  // world with CBZ.stepSim; it cannot pin performance.now(), so a wall-clock
  // swell meant two identical runs sampled the wave at two different phases
  // and every swimmer's Y "diverged" for no reason that exists in the world.
  //
  // CBZ.now is the clock the whole engine already runs on (core/loop.js): the
  // rAF timestamp under the variable step, whole 1/60 ticks under the fixed
  // step, a synthetic advance under stepSim. Under the variable step it IS
  // performance.now() to within one frame, so city / sharksim / escape roll
  // exactly as before; under the fixed step the sea now moves on the same
  // ticks the swimmers do. Bonus: every call within one frame returns ONE
  // value, so the shader uniform (waterDriveCommonUniforms) and the CPU query
  // can no longer sample two different instants of the same frame.
  //
  // THE FALLBACK IS THE TITLE SCREEN. The fixed step only advances CBZ.now
  // while g.state === "playing", so on a survival title card the sim clock
  // stands still and a sea driven by it would be a photograph. While no match
  // exists — state "title", or a clock nothing has written yet — wall time
  // drives the swell exactly as it always did. "paused" / "won" / "lost" stay
  // on the sim clock deliberately: the rest of the world is frozen there too
  // (under the fixed step), so following it is both consistent and free of the
  // phase jump that switching sources would cost.
  CBZ.waterClock = function () {
    const g = CBZ.game;
    const sim = CBZ.now;
    if (g && g.state !== "title" && Number.isFinite(sim) && sim > 0)
      return (sim * 0.001) % 3600;
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
    // The initial tone only matters for a frame or two (city/world.js's
    // day/night tick owns it from then on), but it must be the SAME table, or
    // a mode that never runs that tick renders the old navy for its whole life.
    u.uSeaColor = { value: new THREE.Color(CBZ.WATER_TONES.day) };
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
    u.uCapThresh = { value: surfaceLookOn() ? 0.86 : 0.62 };
    u.uSurf = { value: new THREE.Vector4(22.0, 0.28, 2.05, 1.0) }; // width, freq, speed, gain
    u.uGlitter = { value: 1.0 };
    u.uShoreFx = { value: CFG.WATER_SHORE_FX === false ? 0 : 1 };
    // ---- WATER_SURFACE_LOOK ------------------------------------------------
    // The reflected sky, as TWO radiances rather than a tint on the water's own
    // colour (which is what made the old `sky` term a brighter navy instead of
    // an actual sky). uSkyLow is the horizon band and is driven from
    // scene.fog.color every frame — core/sky.js's seam law repaints the dome's
    // horizon stop to exactly that colour, and city/world.js's horizon fuse
    // already converges the sea on it, so all three agree by construction.
    // uSkyHigh is the deeper, cooler sky a ROUGH surface reflects.
    u.uSkyLow = { value: new THREE.Color(0xb6c4c8) };
    u.uSkyHigh = { value: new THREE.Color(0x42699a) };
    // Unit wind direction in world XZ. Fixed (deterministic, and a coastline's
    // prevailing wind does not spin); the streak lanes and every ripple octave
    // are built in this frame.
    u.uWindDir = { value: new THREE.Vector2(0.882, 0.471) };
    // x = ripple/sheen gain, y = lane contrast, z = shore calm strength,
    // w = distance-roughness master. All four go to 0 with the flag, which is
    // what makes the revert exact on BOTH sea materials at once.
    u.uLook = { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) };
    // SEA_TRANSLUCENT. x = how transparent the sea gets looking straight down
    // (0 = the old opaque sheet), y = the view-angle exponent, z/w = the
    // distance window the clarity is allowed to live in. Shared by both sea
    // materials so they cannot disagree about how clear the water is.
    u.uClarity = { value: new THREE.Vector4(
      translucentOn() ? CLARITY : 0.0, CLARITY_POW, CLARITY_NEAR, CLARITY_FAR) };
    return u;
  };

  // Per-frame driver shared by BOTH sea materials so they can never drift out
  // of phase with each other or with the CPU query.
  const _sunDir = new THREE.Vector3();
  const _moonDir = new THREE.Vector3(0.34, -0.84, -0.42).normalize();
  const FOAM_DAY = new THREE.Color(0xe2f1f3), FOAM_NIGHT = new THREE.Color(0xbed4e8);
  // The upper-sky radiance a rough sea reflects, day and night. Blended with
  // the live fog colour (see waterDriveCommonUniforms) so dusk arrives for
  // free instead of needing a third keyframe.
  const SKY_HIGH_DAY = new THREE.Color(0.028, 0.078, 0.150);
  const SKY_HIGH_NIGHT = new THREE.Color(0.004, 0.009, 0.022);
  const _skyHigh = new THREE.Color();
  // See cbzReflectGrade: how much of the painted sky the water is allowed to
  // return. Shared by both sea materials so they cannot disagree.
  const REFL_GAIN = 0.58;
  function surfaceLookOn() { return CFG.WATER_SURFACE_LOOK !== false && CFG.WATER_V2 !== false; }
  CBZ.waterSurfaceLookOn = surfaceLookOn;
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
    if (u.uCapThresh) u.uCapThresh.value = (surfaceLookOn() ? 0.86 : 0.62) - wet * (surfaceLookOn() ? 0.46 : 0.34);
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

    // ---- the reflected sky (WATER_SURFACE_LOOK) ----------------------------
    // The horizon radiance IS the fog colour: core/renderer.js puts fogColor
    // through the same tone-map + encode the rest of the frame rides, and
    // core/sky.js paints the dome's horizon stop to match it, so taking it
    // verbatim is the one choice that cannot produce a seam. The upper sky is
    // the same radiance pulled down and toward a deep blue — that is what a
    // rough water surface actually reflects, and it is why the far sea has a
    // colour at all instead of mirroring the brightest band in the sky.
    const lookOn = surfaceLookOn();
    if (u.uSkyLow) {
      const fog = CBZ.scene && CBZ.scene.fog && CBZ.scene.fog.color;
      if (fog) u.uSkyLow.value.copy(fog);
    }
    if (u.uSkyHigh) {
      _skyHigh.copy(SKY_HIGH_NIGHT).lerp(SKY_HIGH_DAY, Math.max(0, Math.min(1, +CBZ.dayness || 0)));
      u.uSkyHigh.value.copy(u.uSkyLow ? u.uSkyLow.value : SKY_HIGH_DAY).lerp(_skyHigh, 0.86);
    }
    veilDrive(u);
    if (u.uClarity) {
      // Clarity is a live read, not a boot-time one, so ?cfg_SEA_TRANSLUCENT=0
      // and a runtime toggle land on the same frame. Rain silts the water:
      // heavy chop closes the window rather than opening a murky hole.
      u.uClarity.value.x = translucentOn() ? CLARITY * (1 - wet * 0.55) : 0.0;
      u.uClarity.value.y = CLARITY_POW;
      u.uClarity.value.z = CLARITY_NEAR;
      u.uClarity.value.w = CLARITY_FAR;
    }
    if (u.uLook) {
      const v = u.uLook.value;
      // A storm is rougher water, not calmer: chop widens the lanes and pushes
      // the roughness term without touching a single amplitude.
      v.x = lookOn ? 1.0 : 0.0;
      v.y = lookOn ? 1.0 + wet * 0.45 : 0.0;
      v.z = lookOn ? 1.0 : 0.0;
      v.w = lookOn ? 1.0 + wet * 0.25 : 0.0;
    }
  };

  // ============================================================
  //  5. SHARED GLSL — declarations + helper functions
  // ============================================================
  const INLAND_FN = [
    "float cbzInlandFactor(vec2 p) {",
    "  float f = 0.0;",
    "  for (int i = 0; i < " + MAX_INLAND + "; i++) {",
    "    vec4 b = uInlandBodies[i];",
    /* length(), NOT distance(), AND THAT IS NOT A STYLE CHOICE.

       This function is grafted into the vendor mirror shader by
       world/waterfx.js, and that shader's own main() contains the line

           float distance = length(worldToEye);

       ESSL 1.00 forbids a declaration that shadows a built-in the translation
       unit actually USES, so the moment anything in this shared GLSL called
       distance(), the WHOLE MIRROR FRAGMENT SHADER stopped compiling:

           ERROR: 0:1059: 'distance' : function name expected

       three logs that to the console and then draws the mesh with a dead
       program — silently. The result was that at quality tier >= 2, where
       waterfx.js swaps CBZ.citySea for the reflector, THE OCEAN RENDERED
       NOTHING AT ALL. What everyone (including several visual-compare
       presets) has been photographing as "the sea" is world/
       terrain_overhaul.js's teal visual seabed showing through the hole. It
       has no swell, no glitter and no foam, which is exactly why it never
       looked quite right.

       length(p - b.xy) is the same number and references no built-in name, so
       the vendor's local is legal again. Do not put distance() back. */
    "    float d = length(p - b.xy);",
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

  /* SEA_TRANSLUCENT, half one: the surface's own alpha.

     WHY VIEW ANGLE AND NOT A CONSTANT. A flat opacity would be the sticker
     problem inverted — the far ocean would go glassy, the horizon fuse would
     have nothing solid to converge on, and every sea in the game would read
     like cellophane. Real water is a Fresnel switch, and the alpha here is
     literally its transmittance: at the vertical 98% of the light gets in, at
     forty-five degrees still ~99%, and only inside the last few degrees of
     grazing does the surface snap to the mirror everyone pictures. Computed
     over the FLAT surface normal, deliberately not the rippled shading normal,
     because an alpha that sparkled with the wave normals would boil.

     The distance window is the perf half of the same idea and costs nothing
     visually: past CLARITY_FAR you are looking across the water anyway, so
     forcing alpha to 1 there removes a blend from 99% of a 16 km disc and
     removes any chance of the transparent sea revealing the void beyond the
     seabed ring. Foam is opaque because foam is air, not water. */
  CBZ.waterClarityGLSL = function () {
    return [
      "uniform vec4 uClarity;",
      "float cbzSeaAlpha(vec3 V, float dist, float under, float foam) {",
      "  if (uClarity.x <= 0.0) return 1.0;",
      // TRANSMITTANCE, not a taste curve: Schlick over the FLAT surface normal
      // (deliberately not the rippled shading normal — an alpha that sparkled
      // with the wave normals would boil). Water's F0 is 0.02, so at forty-five
      // degrees ~99% of the light still gets in and only inside the last few
      // degrees of grazing does the surface become the mirror everyone pictures.
      // The first cut of this used pow(V.y, 1.15), which said a boat deck at
      // seventeen degrees could see almost nothing in — three times more opaque
      // than real water, and it made the whole feature invisible in the exact
      // frame the owner asked about.
      "  float c = clamp(V.y, 0.0, 1.0);",
      "  float clarity = 1.0 - (0.02 + 0.98 * pow(1.0 - c, uClarity.y));",
      "  clarity *= 1.0 - smoothstep(uClarity.z, uClarity.w, dist);",
      "  clarity *= 1.0 - clamp(foam, 0.0, 1.0);",
      "  clarity *= 1.0 - clamp(under, 0.0, 1.0);",
      "  return clamp(1.0 - uClarity.x * clarity, 0.0, 1.0);",
      "}",
    ].join("\n");
  };

  /* SEA_TRANSLUCENT, half two: THE VEIL — what the water does to a body seen
     through it.

     A blended surface alone is not enough and never was. Blend the sea at a
     flat 0.7 and a shark thirty metres down is exactly as legible as one a
     metre down, which is the painted-sticker failure with extra steps. What
     actually hides a submerged animal is the WATER COLUMN between it and your
     eye: two metres of it and you can count the pectorals, fifteen and there
     is nothing there.

     So this patches the animal's own materials with one Beer-Lambert term over
     the length of that column. The column is not the animal's depth — it is
     the part of the eye->fragment segment that lies below the surface, which
     for a camera at height a looking at a fragment at depth -b is
     |CP| * b / (a + b). Straight down that is the depth; from a deck at a low
     angle it is many times the depth, so the same animal at the same depth
     fades as you flatten your view — which is the real behaviour, and it is
     the same geometric fact cbzSeaAlpha uses to close the surface at the same
     moment. The two halves are one model seen from two sides.

     THE CAMERA UNDER THE SURFACE IS NOT THIS FILE'S PROBLEM: world/
     water_underwater.js already owns the water column's fog when you are in
     it, so the veil returns 1.0 there rather than attenuating twice.

     Applied before <tonemapping_fragment>, i.e. in the same linear space the
     sea's own body colour is mixed in, so a fully-veiled animal converges on
     exactly the water around it instead of leaving a differently-graded ghost.

     COST: one exp, one length, one mix, on submerged animal fragments only.
     The patched material is a CLONE cached per source material, so N sharks
     sharing a hide material still compile one program (r128 keys the program
     on onBeforeCompile.toString(), which is one constant string here). */
  const VEIL_U = {
    uVeilSeaY: { value: 0 },
    uVeilK: { value: VEIL_K },
    uVeilColor: { value: new THREE.Color(0x11384f) },
  };
  CBZ.waterVeilUniforms = VEIL_U;
  const _veilCache = new WeakMap();
  const _veilTint = new THREE.Color();

  function veilBefore(shader) {
    /* EVERY ANCHOR IS CHECKED BEFORE ANYTHING IS EMITTED. A fragment shader
       that READS a varying its vertex partner never WROTE is the one failure
       here that is not visibly obvious — it does not fail to compile, it just
       renders garbage on one material. If any chunk name ever moves, ship the
       plain material instead of a subtly wrong one. (core/gfx.js's patch makes
       the same promise for the same reason.) */
    if (shader.vertexShader.indexOf("#include <project_vertex>") < 0) return;
    if (shader.vertexShader.indexOf("#include <common>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <tonemapping_fragment>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <common>") < 0) return;
    shader.uniforms.uVeilSeaY = VEIL_U.uVeilSeaY;
    shader.uniforms.uVeilK = VEIL_U.uVeilK;
    shader.uniforms.uVeilColor = VEIL_U.uVeilColor;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCbzVeilW;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n" +
        "vec4 cbzVeilP = vec4( transformed, 1.0 );\n" +
        "#ifdef USE_INSTANCING\n  cbzVeilP = instanceMatrix * cbzVeilP;\n#endif\n" +
        "vCbzVeilW = ( modelMatrix * cbzVeilP ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vCbzVeilW;\nuniform float uVeilSeaY;\nuniform float uVeilK;\nuniform vec3 uVeilColor;")
      /* THE EYE IS NOT `cameraPosition` ON A LAMBERT MATERIAL (2026-08-25).

         Every animal this veil is applied to is a MeshLambertMaterial, and
         r128's setProgram only UPLOADS the `cameraPosition` uniform for
           isShaderMaterial | isMeshPhongMaterial | isMeshToonMaterial |
           isMeshStandardMaterial | envMap
         (three.r128.min.js, the `y.map.cameraPosition` guard — the same fact
         core/renderer.js's fog patch is built around). It is DECLARED in every
         fragment prefix, so this compiled, linked and read (0,0,0).

         What that did, every frame, to every shark and orca in the game:
           cbzAC = 0 - seaY  ->  +0.8, i.e. "the camera is always above water";
           cbzL  = |worldPos - origin| * ...  ->  hundreds of metres, because
                  the island is hundreds of metres from the world origin;
           exp(-cbzL * 0.115)  ->  0.
         So gl_FragColor.rgb WAS uVeilColor, exactly, on every fragment: a flat
         single-colour water-blue cutout with no shading and no belly. That is
         the owner's "the shark is BLUE underwater" — it was never the fog and
         never the lights, it was this line reading a uniform that was never
         sent. It also fired while the camera was UNDER the water, where the
         veil is supposed to stand down entirely.

         viewMatrix IS uploaded for every material type, and it is the inverse
         of the camera's world matrix: for orthonormal R and camera c,
         viewMatrix = [ Rt | -Rt c ], so c = -(Rt)t * viewMatrix[3].xyz, and
         component i of that is -dot( viewMatrix[i].xyz, viewMatrix[3].xyz ).
         Written out per-component because WebGL1 GLSL ES 1.00 has no
         transpose(). Three dot products, no uniform added, exact. */
      .replace("#include <tonemapping_fragment>",
        "vec3 cbzVeilEye = -vec3( dot( viewMatrix[0].xyz, viewMatrix[3].xyz ),\n" +
        "                         dot( viewMatrix[1].xyz, viewMatrix[3].xyz ),\n" +
        "                         dot( viewMatrix[2].xyz, viewMatrix[3].xyz ) );\n" +
        "float cbzAC = cbzVeilEye.y - uVeilSeaY;\n" +
        "float cbzBP = vCbzVeilW.y - uVeilSeaY;\n" +
        "if ( uVeilK > 0.0 && cbzAC > 0.0 && cbzBP < 0.0 ) {\n" +
        "  float cbzL = length( vCbzVeilW - cbzVeilEye ) * ( -cbzBP ) / max( 0.05, cbzAC - cbzBP );\n" +
        "  gl_FragColor.rgb = mix( uVeilColor, gl_FragColor.rgb, exp( -cbzL * uVeilK ) );\n" +
        "}\n#include <tonemapping_fragment>");
  }

  // The patched twin of one material. Cached, so a whole pod shares it.
  CBZ.waterVeilMaterial = function (mat) {
    if (!mat || !translucentOn()) return mat;
    if (mat.userData && mat.userData.cbzVeiled) return mat;
    const hit = _veilCache.get(mat);
    if (hit) return hit;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return mat;   // no chunks to patch
    let clone;
    try { clone = mat.clone(); } catch (e) { return mat; }
    /* CHAIN, NEVER CLOBBER. systems/weather.js (wetness, snow, flood) and
       core/gfx.js (detail normals, contact AO) both install onBeforeCompile
       hooks on ordinary materials — and Material.copy() does NOT carry an own
       onBeforeCompile onto a clone, so cloning silently drops them. Capture
       the SOURCE's hook and call it first, and give the clone a cache key that
       names the hook we chained onto: r128 keys the program cache on
       onBeforeCompile.toString(), our source is one constant string, and
       without this a wet-coated hide would reuse a dry one's program. */
    const prev = mat.onBeforeCompile;
    const prevSrc = (prev && prev !== THREE.Material.prototype.onBeforeCompile) ? String(prev) : "";
    clone.onBeforeCompile = prev
      ? function (sh) { prev.call(this, sh); veilBefore(sh); }
      : veilBefore;
    clone.customProgramCacheKey = function () { return "cbzVeil|" + prevSrc; };
    clone.userData = Object.assign({}, clone.userData, { cbzVeiled: true });
    clone.needsUpdate = true;
    _veilCache.set(mat, clone);
    _veilCache.set(clone, clone);
    return clone;
  };

  // Swap every material under an object for its veiled twin. Idempotent, and a
  // no-op with the flag off, so callers can run it unconditionally on spawn.
  CBZ.waterVeilApply = function (obj) {
    if (!obj || !translucentOn()) return false;
    let n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) {
        let changed = false;
        const out = m.map(function (x) { const y = CBZ.waterVeilMaterial(x); if (y !== x) changed = true; return y; });
        if (changed) { o.material = out; n++; }
      } else {
        const y = CBZ.waterVeilMaterial(m);
        if (y !== m) { o.material = y; n++; }
      }
    });
    return n > 0;
  };

  // Sea level and water tint the veil fades toward, refreshed once a frame off
  // whichever water world is live. Called from waterDriveCommonUniforms.
  function veilDrive(u) {
    VEIL_U.uVeilK.value = translucentOn() ? VEIL_K : 0;
    let y = seaY();
    if (CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.survSeaMeanY) {
      const iy = CBZ.survSeaMeanY();
      if (Number.isFinite(iy)) y = iy;
    }
    VEIL_U.uVeilSeaY.value = y;
    // The colour a fully-swallowed body converges on IS the water's own body
    // colour at its dimmest lit value (see the `base *= 0.63 + ndl * 0.37`
    // line in city/world.js), so the animal dissolves into the sea rather than
    // into a second, differently-tinted blue.
    const src = (u && u.uDisasterTint) ? u.uDisasterTint.value
      : (u && u.uSeaColor) ? u.uSeaColor.value : null;
    if (src) VEIL_U.uVeilColor.value.copy(_veilTint.copy(src).multiplyScalar(0.66));
  }

  CBZ.waterFragmentDecl = function () {
    return [
      CBZ.waterClarityGLSL(),
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
      "uniform vec3 uSkyLow;",
      "uniform vec3 uSkyHigh;",
      "uniform vec2 uWindDir;",
      "uniform vec4 uLook;",
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
      // WATER_SURFACE_LOOK also RETUNES this, because the old numbers put a
      // permanent milky spray over a dead-calm sea: the crest threshold rises
      // (uCapThresh 0.62 -> 0.86, driven in waterDriveCommonUniforms) and the
      // calm-weather gain drops to a fifth, while the WEATHER term is scaled
      // back up so a squall breaks harder than it used to. Reference: flat
      // northern water carries wind ripple and no whitecaps at all until it
      // blows.
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
      "  return cap * steep * breaking * distFade * (1.0 - inland * 0.85) * mix(0.28, 0.055, step(0.001, uLook.x)) * (1.0 + uChop * 3.1);",
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

      /* ================= WATER_SURFACE_LOOK ==============================
         Everything below is SHADING ONLY. It reads world XZ, the shared
         clock, the baked field and the view vectors; it writes no height and
         no slope, so the amplitude budget, the CPU wave query, buoyancy, the
         swimmer and every hull are untouched by construction. Both sea
         materials call these, so the shader sea and the planar mirror cannot
         drift apart.                                                       */

      // --- STREAK LANES ----------------------------------------------------
      // One very low-frequency lookup, stretched ~9x along the wind, giving
      // long bands of "this lane of water is rougher than that one". A real
      // sea is never uniformly textured — it is lanes — and the same mask is
      // what turns a single specular blob into the reference's sheen streaks.
      "float cbzLane(vec2 p) {",
      "  if (uLook.y < 0.001) return 0.5;",
      "  vec2 d = normalize(uWindDir); vec2 q = vec2(-d.y, d.x);",
      "  vec2 uv = vec2(dot(p, d) * 0.00085, dot(p, q) * 0.00760) + vec2(uSeaTime * 0.00090, uSeaTime * 0.00035);",
      "  float s = texture2D(uSeaNormal, uv).r;",
      "  return clamp(0.5 + (s - 0.5) * (1.9 * uLook.y), 0.0, 1.0);",
      "}",

      // --- MULTI-OCTAVE WIND RIPPLE ----------------------------------------
      // Three samples of the ONE shared tile, each in its own rotated frame,
      // each stretched along the wind so the crests run ACROSS it, at scales
      // with no common factor so the three tilings never line up into a grid.
      // Each octave's gradient is rotated back into world space before it is
      // summed (the stretch is therefore a real anisotropy, not a smear), and
      // the two fine octaves fade out by distance ON THEIR OWN so the near
      // field keeps sub-metre wavelets while the far field cannot alias.
      "vec3 cbzRippleN(vec2 p, float dist) {",
      "  vec2 d0 = normalize(uWindDir); vec2 q0 = vec2(-d0.y, d0.x);",
      "  vec2 g = vec2(0.0);",
      "  vec2 uv; vec3 n; vec2 d; vec2 q;",
      // DOMAIN WARP. One 256-texel tile sampled on a lattice IS a lattice, and
      // from a helicopter the ~23 m octave read as a visible grid of cells
      // marching to the horizon. Displacing the lookup by a very low-frequency
      // read of the same tile destroys the lattice for one texture fetch: the
      // pattern still repeats, but never on a straight line and never in step
      // with itself. (This is why there is still only ONE ripple texture.)
      "  vec3 wp = texture2D(uSeaNormal, p * 0.00135 + vec2(uSeaTime * 0.00042, uSeaTime * -0.00026)).rgb;",
      "  vec2 warp = (wp.rg - 0.5) * 0.55;",
      // octave 1 — ~23 m across the wind, 2.4x long. The one that survives to
      // the horizon.
      "  d = d0; q = q0;",
      "  uv = vec2(dot(p, d) * 0.0182, dot(p, q) * 0.0437) + warp + vec2(uSeaTime * 0.0165, uSeaTime * -0.0060);",
      "  n = texture2D(uSeaNormal, uv).rgb * 2.0 - 1.0;",
      "  g += (d * n.r * 0.0182 + q * n.g * 0.0437) * 1.00;",
      // octave 2 — ~9 m, rotated 37 degrees off the wind
      "  d = normalize(d0 * 0.7986 + q0 * 0.6018); q = vec2(-d.y, d.x);",
      "  uv = vec2(dot(p, d) * 0.0397, dot(p, q) * 0.1110) + warp * 1.7 + vec2(uSeaTime * 0.0410, uSeaTime * 0.0128);",
      "  n = texture2D(uSeaNormal, uv).rgb * 2.0 - 1.0;",
      "  g += (d * n.r * 0.0397 + q * n.g * 0.1110) * (0.72 * (1.0 - smoothstep(90.0, 620.0, dist)));",
      // octave 3 — ~3.6 m, rotated the other way; the wavelet field you see
      // from a boat deck, gone before it can twinkle
      "  d = normalize(d0 * 0.4384 - q0 * 0.8988); q = vec2(-d.y, d.x);",
      "  uv = vec2(dot(p, d) * 0.0863, dot(p, q) * 0.2760) + warp * 3.1 + vec2(uSeaTime * 0.0980, uSeaTime * -0.0355);",
      "  n = texture2D(uSeaNormal, uv).rgb * 2.0 - 1.0;",
      "  g += (d * n.r * 0.0863 + q * n.g * 0.2760) * (0.46 * (1.0 - smoothstep(18.0, 150.0, dist)));",
      "  return normalize(vec3(g.x * 8.6, 1.0, g.y * 8.6));",
      "}",

      // --- THE SHORE CALM BAND ---------------------------------------------
      // Under a headland the water goes glassy for a few tens of metres before
      // the ripple field starts. field.b is normalised distance into deep
      // water (1.0 == 420 m), so this is a ~10-70 m strip that follows the real
      // coastline for free, plus the last couple of metres of wash.
      "float cbzShoreCalm(vec4 field) {",
      "  if (uShoreFx < 0.5 || uLook.z < 0.001) return 0.0;",
      "  float band = 1.0 - smoothstep(0.022, 0.165, clamp(field.b, 0.0, 1.0));",
      "  float wash = smoothstep(0.60, 0.99, clamp(field.g, 0.0, 1.0));",
      "  return clamp(max(band * 0.88, wash * 0.55) * uLook.z, 0.0, 1.0);",
      "}",

      // --- DISTANCE IS ROUGHNESS -------------------------------------------
      // The ripple normal MUST fade with distance or the horizon crawls, but a
      // faded normal is a MIRROR, and a mirror at a grazing angle returns the
      // brightest band of the sky — which is exactly how this ocean turned
      // into a white sheet. Hand the fade's energy to a roughness term
      // instead: it pre-filters the reflection (below) and relaxes the Fresnel
      // curve, which is what a microfacet surface does and what puts the sea's
      // own colour back into the distance.
      //
      // It is a FOOTPRINT, not a distance. A 0.4 m wavelet 20 m from a
      // standing camera is already two pixels tall, because a grazing view
      // compresses the surface by 1/cos: the metres of water behind one pixel
      // go as dist / (N.V). Keying the term to raw distance would leave the
      // whole near field of an eye-height shot — where this ocean actually
      // looked worst — behaving like a polished mirror.
      "float cbzRough(float dist, float ndv) {",
      "  float foot = dist / max(clamp(ndv, 0.0, 1.0), 0.02);",
      "  return clamp(smoothstep(22.0, 420.0, foot) * uLook.w, 0.0, 1.0);",
      "}",

      // Sharp (mirror) Fresnel near, relaxed (rough) Fresnel far. Identical to
      // the old expression at footprint 0, so the near field is unchanged.
      // The rough curve is deliberately far flatter than Schlick: a wind-ripple
      // field has ~15-25 degrees of slope variance, so at a grazing view a
      // third of its facets are turned back toward you and the directional
      // reflectance never approaches the mirror's 1.0. That single number is
      // the difference between an ocean and a sheet of white plastic.
      "float cbzFresnel(float ndv, float dist) {",
      "  float c = clamp(ndv, 0.0, 1.0);",
      "  float sharp = 0.028 + 0.972 * pow(1.0 - c, 4.6);",
      "  float rough = 0.030 + 0.260 * pow(1.0 - c, 1.6);",
      "  return mix(sharp, rough, cbzRough(dist, c));",
      "}",

      // The sky as radiance, not as a tint on the water: horizon band (== the
      // live fog colour) below, deep cool sky above. `bias` lifts the sampled
      // elevation for a rough surface, whose lobe reaches higher into the sky
      // than its mirror direction says.
      "vec3 cbzSkyTone(vec3 R, float bias) {",
      "  return mix(uSkyLow, uSkyHigh, smoothstep(-0.06, 0.62, R.y + bias));",
      "}",

      // Pre-filter a REFLECTION SAMPLE (the planar mirror's texel) toward that
      // analytic sky by distance-roughness, then let the lanes decide which
      // bands of water catch more of it. Near the camera this returns the
      // mirror verbatim.
      "vec3 cbzReflectGrade(vec3 refl, vec3 R, float dist, float ndv, float lane) {",
      "  float rgh = cbzRough(dist, ndv);",
      "  vec3 c = mix(refl, cbzSkyTone(R, rgh * 0.12), rgh * 0.92);",
      // WATER IS DARKER THAN THE SKY IT REFLECTS. The dome is a painted canvas
      // authored to look right as SKY, and the frame is tone-mapped once for
      // both — so handing the sea an unattenuated copy of it pushed every water
      // pixel into the ACES shoulder, where the curve desaturates hard. That is
      // the whole reason a teal ocean kept coming back grey however the body
      // tint was set. One reflectance gain fixes the level and the saturation
      // together; it is inert with the flag off (cbzReflectGrade is only
      // reached from the WATER_SURFACE_LOOK path).
      "  return c * mix(1.0, mix(0.80, 1.22, lane) * " + gnum(REFL_GAIN) + ", step(0.001, uLook.x));",
      "}",

      // --- BROAD SHEEN ------------------------------------------------------
      // cbzSunGlitter's lobes are pow 24 / pow 220 — a glitter path and a
      // mirror dot. The reference's dominant light response is neither: it is
      // a WIDE silvery sheen spread over whole lanes of ripple, brightening
      // toward the light. One extra broad lobe, lane-modulated, distance-
      // damped so it cannot become the old white sheet.
      "vec3 cbzSheen(vec3 N, vec3 V, vec3 L, float lane, float dist, float fres) {",
      "  if (uLook.x < 0.001) return vec3(0.0);",
      "  vec3 H = normalize(L + V);",
      "  float broad = pow(max(dot(N, H), 0.0), 7.0);",
      "  float up = smoothstep(-0.06, 0.24, L.y);",
      "  float lanes = mix(0.42, 1.58, lane);",
      "  float ndv = clamp(dot(N, V), 0.0, 1.0);",
      "  return uSunColor * (broad * 0.24 * lanes * up * (0.24 + fres * 0.70) * uGlitter * mix(1.0, 0.28, cbzRough(dist, ndv)));",
      "}",

      // --- THE ONE SURFACE NORMAL -------------------------------------------
      // geoN is the analytic swell normal from the vertex stage; this adds the
      // ripple field to it, damped inside the shore calm band. Both sea
      // materials call THIS, so there is exactly one answer to "which way is
      // this bit of water facing".
      "vec3 cbzSeaNormal(vec3 geoN, vec2 p, float dist, float detail, float calm, float lane) {",
      "  vec3 fine;",
      "  if (uLook.x > 0.001) {",
      "    fine = cbzRippleN(p, dist);",
      "    detail *= mix(0.45, 1.45, lane) * (1.0 - calm * 0.82);",
      "  } else {",
      // exact legacy path: the two scrolling samples this replaced
      "    vec2 f0 = p * 0.036 + vec2(uSeaTime * 0.027, -uSeaTime * 0.018);",
      "    vec2 f1 = vec2(p.y, -p.x) * 0.061 + vec2(-uSeaTime * 0.019, uSeaTime * 0.023);",
      "    vec3 a = texture2D(uSeaNormal, f0).rgb * 2.0 - 1.0;",
      "    vec3 b = texture2D(uSeaNormal, f1).rgb * 2.0 - 1.0;",
      "    fine = normalize(vec3((a.r + b.r) * 0.34, 1.0, (a.g + b.g) * 0.34));",
      "  }",
      "  return normalize(geoN + fine * detail - vec3(0.0, detail, 0.0));",
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
    // Metres per vertex, per tier. This used to be a fixed segment count
    // (64..168) tuned against the original 1400 m sheet; quoting it as PITCH
    // keeps the swell sampling density identical when a caller asks for a
    // bigger sheet, instead of silently aliasing the wave table.
    const pitchByTier = [21.9, 15.9, 11.7, 9.7, 8.3];
    const seg = Math.max(16, (segments | 0) || Math.round(span / pitchByTier[tier]));
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
    /* ---- THE FLOW, AND WHY THE SHEET NEEDED TO KNOW ABOUT IT -------------
       A flood is not a rough sea; it is a RIVER with no banks, and the one
       thing that says so on screen is that everything on it — every ripple,
       every foam streak, every plume of silt — is travelling the same way at
       the same speed. Without a flow vector the surface could only be
       isotropic noise, which is what made the old streak term a wash: it was
       "some white", not "white being dragged somewhere".

       uDwFlow is a unit direction in world XZ and uDwFlowSpd its speed in m/s
       (both published by the tsunami: inland while it sweeps and stands,
       SEAWARD on the drain, which is what makes the undertow visible from a
       helicopter). uDwStand is 0 for a live bore and 1 for water that has
       been standing — the two ends of the foam's life, streaks torn off a
       moving front at one end and a slow scum network at the other. */
    U.uDwFlow = { value: new THREE.Vector2(1, 0) };
    U.uDwFlowSpd = { value: 0 };
    U.uDwStand = { value: 0 };
    /* The lighter end of the sediment ramp — silt held near the surface, which
       is what makes a real inundation MOTTLED instead of one flat brown. And
       the foam colour the soup is allowed to make: whitewater churned out of
       a suspension is tan, never paper-white, and painting it white is most of
       what made the flooded town read as snow. */
    U.uDwSilt = { value: new THREE.Color(opts.siltColor == null ? 0x1f1810 : opts.siltColor) };
    U.uDwFoam = { value: new THREE.Color(opts.dirtyFoamColor == null ? 0x8e8271 : opts.dirtyFoamColor) };

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
      CBZ.waterClarityGLSL(),
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
      "uniform vec3 uDwSilt;",
      "uniform vec3 uDwFoam;",
      "uniform vec2 uDwFlow;",
      "uniform float uDwFlowSpd;",
      "uniform float uDwStand;",
      "varying vec3 vDwWorld;",
      "varying vec3 vDwNormal;",
      "varying float vDwHeight;",
      "varying float vDwDist;",
      "#include <fog_pars_fragment>",
      /* ---- ACTUAL NOISE, AND WHY THE OLD SURFACE WAS A WHITE SHEET --------
         Every broken-up term in this shader used to be broken up by
         `n = (a.b + b.b) * 0.5` — the BLUE channel of the shared ripple tile.
         That tile is a NORMAL MAP: blue is 1/sqrt(nx*nx+1+nz*nz), and the
         ripples in it are shallow, so blue never leaves [0.92, 1.0] and `n`
         is a CONSTANT 0.93 to within four per cent. Everything "broken by
         noise" was therefore not broken at all. The streak term —
         smoothstep(0.58, 0.95, tile.b), i.e. smoothstep of a number that is
         always ~0.96 — evaluated to 1.0 across the entire 130 m behind the
         front and mixed 62% pure white over it. That is the flat snow-white
         plain in the landfall shot, and no amount of retuning a threshold was
         going to fix a signal with no variance in it.

         So the turbid block gets a real value-noise field. Two octaves, four
         hashes each, evaluated only where uDwSediment > 0 — which is nowhere
         at all for the calm sea, the flash flood and every other consumer. */
      "float dwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      "float dwNoise(vec2 p) {",
      "  vec2 i = floor(p), f = fract(p);",
      "  vec2 u = f * f * (3.0 - 2.0 * f);",
      "  float a0 = dwHash(i), b0 = dwHash(i + vec2(1.0, 0.0));",
      "  float c0 = dwHash(i + vec2(0.0, 1.0)), d0 = dwHash(i + vec2(1.0, 1.0));",
      "  return mix(mix(a0, b0, u.x), mix(c0, d0, u.x), u.y);",
      "}",
      "float dwFbm(vec2 p) {",
      "  vec2 r = vec2(p.x * 0.862 + p.y * 0.507, p.y * 0.862 - p.x * 0.507);",
      "  return dwNoise(p) * 0.62 + dwNoise(r * 2.31 + 17.7) * 0.38;",
      "}",
      "void main() {",
      // Two octave normal flow: the useful part of the reference's FBM, but
      // sampled from the one shared tile and distance-damped to avoid sparkle.
      /* AND IT FLOWS. The detail coordinates are dragged along the flow
         vector, so the small-scale texture of a flood visibly MOVES the way
         the flood does — inland under the bore, seaward on the drain. Scaled
         by uDwSediment, so a clean sea samples the identical coordinate it
         always did. */
      "  vec2 dwP = vDwWorld.xz - uDwFlow * (uDwFlowSpd * uSeaTime * uDwSediment);",
      /* AND THE TILE HAS TO STOP BEING A TILE. uSeaNormal is six integer-
         frequency sines on a 256px wrap: on open blue water nobody sees it,
         but a glossy mud sheet reflects the sky off exactly that relief and
         the 24 m lattice prints a visible CHECKERBOARD across the flooded
         town. One domain warp — two noise samples nudging the lookup by up to
         12 m — turns the lattice into an irregular field for the cost of eight
         hashes, and it is inside a uniform branch, so the calm sea, the flash
         flood and every other consumer pay nothing and sample the identical
         coordinate they always did. */
      "  if (uDwSediment > 0.002) {",
      "    dwP += (vec2(dwNoise(dwP * 0.019), dwNoise(dwP * 0.019 + 53.0)) - 0.5) * 11.0;",
      "  }",
      "  vec2 q0 = dwP * 0.042 + vec2(uSeaTime * 0.030, -uSeaTime * 0.021);",
      "  vec2 q1 = vec2(dwP.y, -dwP.x) * 0.079 + vec2(-uSeaTime * 0.022, uSeaTime * 0.027);",
      "  vec3 a = texture2D(uSeaNormal, q0).rgb * 2.0 - 1.0;",
      "  vec3 b = texture2D(uSeaNormal, q1).rgb * 2.0 - 1.0;",
      // Dirty water is ROUGHER than clean water — it is boiling. Turbidity
      // deepens the micro-relief, which is what breaks the sky sheen into
      // moving facets and gives the sun something to glint off.
      "  float detail = mix(0.46, 0.12, smoothstep(45.0, 520.0, vDwDist)) * (1.0 - 0.34 * uDwSediment);",
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
      /* THE SKY A FLOOD REFLECTS IS THE SKY OVER THE FLOOD. The analytic
         gradient above is a fair-weather blue and a disaster day is not one;
         a mud sheet that mirrors clear blue looks like painted ground with a
         blue wash on it. fogColor is the exact value modes/survival.js is
         painting the dome with this frame, so taking the turbid sheen from it
         makes the water agree with the sky by construction — including every
         later change to the tsunami's env block. */
      "  #ifdef USE_FOG",
      "    vec3 dwSkyC = mix(fogColor * 1.12, fogColor * 0.60, skyT);",
      "  #else",
      "    vec3 dwSkyC = sky;",
      "  #endif",
      "  vec3 outColor = mix(body, sky, fres * 0.72);",
      "  vec3 H = normalize(L + V);",
      "  float glitter = pow(max(dot(N, H), 0.0), 34.0) * (0.18 + fres * 1.35);",
      "  outColor += uSunColor * glitter * 0.72;",
      // Restrained crest foam. Detail noise breaks it into patches; height and
      // analytic tilt keep it at the tipping apex instead of painting flanks.
      "  float n = (a.b + b.b) * 0.5;",
      /* ---- THE TURBID FRONT -----------------------------------------------
         Everything inside the branch below is gated on uDwSediment, which is 0
         for every non-tsunami consumer, so the calm sea and the flash flood
         run not one instruction of it.

         What it has to be, from the Tohoku helicopter footage: the inundation
         is DARK gray-brown, OPAQUE and GLOSSY. It reflects the overcast as a
         bright sheen at grazing angles and carries hard sun glints; it is
         mottled with plumes of silt that drift with the current; and the white
         on it is not a wash but STRUCTURE — a boiling roll a few metres deep
         riding the leading edge, torn streaks lying along the flow behind it,
         and, where the water has stood a while, a sparse network of scum lines
         and rafts covering a tenth of the surface. The previous version had
         one of those five (a dark body) and painted the other four as a flat
         62% white over 130 m, which is why the flooded town read as snow.

         Three things make the difference and all three are one idea — the
         flood is a river: a real noise field (dwFbm) so the foam has
         variance, a flow VECTOR so that variance is anisotropic and moving,
         and a fresnel so the body is a liquid rather than a colour. */
      "  float fdS = dot(vDwWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS;",
      "  float behind = clamp(-fdS / max(1.0, uDwFrontRun), 0.0, 1.0);",
      "  float dwWet = 1.0 - smoothstep(-1.0, 7.0, fdS);",
      "  float turb = uDwSediment * dwWet;",
      "  float sed = 0.0, boil = 0.0, whitew = 0.0;",
      "  if (turb > 0.002) {",
      "    float bd = max(0.0, -fdS);",                      // metres behind the front
      "    vec2 fl = uDwFlow;",
      "    vec2 ax = vec2(-fl.y, fl.x);",
      "    vec2 adv = vDwWorld.xz - fl * (uDwFlowSpd * uSeaTime);",
      "    float sAl = dot(adv, fl);",                       // along the flow, advected
      "    float sAc = dot(adv, ax);",                       // across it
      // Water that has stood is old water: 1 in the flooded/drain phases, and
      // reached anyway far enough behind a live front.
      "    float stand = max(uDwStand, smoothstep(0.30, 1.0, behind));",
      // THE BODY. Silt plumes are two low-frequency fields drifting with the
      // current, so the sheet is mottled and the mottling MOVES.
      "    float plume = clamp(dwFbm(vec2(sAl, sAc) * 0.0068) * 0.72 +",
      "                        dwNoise(vec2(sAl * 0.0021, sAc * 0.0029) + 11.0) * 0.46, 0.0, 1.0);",
      "    sed = turb * mix(1.0, 0.92, behind);",
      "    vec3 mudBody = mix(uDwMud * 0.62, uDwSilt, smoothstep(0.18, 0.92, plume));",
      "    mudBody *= 0.52 + ndl * 0.44;",
      // ...AND IT IS GLOSSY. Schlick against the live sky, plus a tight sun
      // lobe. This is the whole difference between a flood and painted ground:
      // matte olive was never a wrong colour, it was a missing reflection.
      "    vec3 Nf = normalize(mix(vDwNormal, N, 0.20));",
      "    float mf = 0.02 + 0.98 * pow(1.0 - clamp(dot(Nf, V), 0.0, 1.0), 5.0);",
      "    vec3 turbCol = mix(mudBody, dwSkyC, clamp(mf * 0.80, 0.0, 0.62));",
      "    turbCol += uSunColor * pow(max(dot(N, H), 0.0), 110.0) * (0.45 + 2.4 * mf);",
      "    outColor = mix(outColor, turbCol, clamp(sed * 1.28, 0.0, 0.985));",
      // Whitewater churned out of a suspension is TAN. The dirtier the load,
      // the further from paper-white the foam is allowed to get.
      "    vec3 dfoam = mix(uFoamColor, uDwFoam, uDwSediment * 0.88);",
      // 1. THE ROLL AT THE EDGE. A few metres deep, e-folded behind the front
      //    and torn into tongues by noise running along the front line, so the
      //    leading edge is ragged and churning instead of a ruled band.
      "    float tongue = dwFbm(vec2(sAc * 0.052 + 4.0, uSeaTime * 0.28));",
      "    boil = clamp(turb * exp(-bd / (2.0 + 5.4 * tongue)) * (0.50 + 0.80 * tongue), 0.0, 0.92);",
      // 2. STREAKS BEHIND IT. 13:1 anisotropy along the flow and scrolling
      //    with it, decaying over ~48 m so they read as whitewater being LEFT
      //    BEHIND by a front rather than as a field of white.
      "    float streak = smoothstep(0.60, 0.95, dwFbm(vec2(sAl * 0.023, sAc * 0.30)));",
      "    streak *= exp(-bd / 48.0) * (1.0 - stand * 0.70);",
      // 3. STANDING FLOOD. A ridged noise gives thin scum LINES; a coarse
      //    threshold gives the occasional raft. Together a few per cent of the
      //    surface, which is what a real inundation carries.
      "    float sc = dwFbm(vec2(sAl * 0.026 + 21.0, sAc * 0.205));",
      "    float lines = smoothstep(0.92, 1.0, 1.0 - abs(sc * 2.0 - 1.0)) * smoothstep(0.26, 0.72, plume);",
      "    float raft = smoothstep(0.72, 0.95, dwFbm(vec2(sAl * 0.048, sAc * 0.086) + 31.0));",
      "    whitew = clamp((streak * 0.38 + (lines * 0.32 + raft * 0.24) * stand) * turb, 0.0, 0.52);",
      "    outColor = mix(outColor, dfoam, whitew);",
      "    outColor = mix(outColor, mix(dfoam, uFoamColor, 0.30), boil);",
      "  }",
      "  float tip = pow(clamp(vDwNormal.y, 0.0, 1.0), 18.0);",
      // The clean sea's crest foam stands down inside the soup — the front's
      // own foam system owns that water, and running both painted it twice.
      "  float foam = smoothstep(0.48, 0.90, vDwHeight + (n - 0.5) * 0.38) * tip * uDisasterFoam * (1.0 - turb * 0.96);",
      "  outColor = mix(outColor, uFoamColor, clamp(foam, 0.0, 0.88));",
      // SEA_TRANSLUCENT. The island's sea is the one you actually swim a shark
      // under, so it gets the same view-angle clarity the city ocean does. Any
      // opacity a disaster has already dialled in (a receding tsunami fades
      // this plane out) still wins: the two multiply.
      "  float dwUnder = gl_FrontFacing ? 0.0 : 1.0;",
      /* ---- SNELL'S WINDOW (2026-08-25) ---------------------------------
         Seen from BELOW, this shader was handing every angle the same thing
         it hands the sky: `sky = mix(vec3(0.48,0.65,0.72), ...)`, an unlit
         pale grey-blue that owes nothing to the water it is the roof of. So
         the ceiling of the sea was a flat #7aa6b8 sheet from one metre down
         to twenty, and it is most of what made the owner's underwater frames
         read as washed out — measured at 3.4 m under the shark island, a
         #327ea5 medium under a (152,203,215) ceiling.

         What actually happens is Snell's window: water/air total-internal-
         reflects past a critical angle of 48.6 degrees, so a diver sees the
         whole sky squeezed into a bright disc directly overhead and a MIRROR
         of the dark water everywhere outside it. cos(48.6 deg) = 0.661, so
         the window is the smoothstep across it; outside, the surface takes
         the sea's own body tint. That is the "lighter showing surface" the
         brief asks for AND the dark ceiling at grazing angles the reference
         photographs have, from one physical fact rather than two dials.
         Above water nothing changes: dwUnder is 0 and the mix never runs. */
      /* ...AND INSIDE THE WINDOW THERE HAS TO BE A SKY (2026-08-25).

         The note above says the flat pale ceiling came from `sky`. Measured,
         it did not: from BELOW, N is flipped downward and V points down at the
         eye, so dot(N,V) is LARGE, and `fres` — which is
         0.025 + 0.975 * pow(1 - dot(N,V), 4.8) — collapses to about 0.028.
         `mix(body, sky, fres * 0.72)` therefore takes TWO PER CENT of the sky.
         What the ceiling actually was, at every angle, is `body` with ndl = 0:
         uDisasterTint * 0.62 * 0.58, a dark blue-green. Which is why the
         window branch could not brighten anything and why, once the black band
         stopped hiding it, the frame came out DARKEST at the top and brightest
         at the horizon — the exact inversion of the owner's master reference,
         where a shimmering ceiling sits over a column that only gets darker.

         Fresnel is the wrong law to be reading here anyway. It describes what
         a surface REFLECTS; a diver looking up is seeing what it TRANSMITS,
         and inside the critical cone the whole sky hemisphere is refracted
         into that cone at near-total transmittance. So inside the window the
         ceiling is the sky (keeping 28% of the surface's own body and its sun
         glitter, so it still ripples and still catches the sun); outside it,
         total internal reflection shows the water column below you, which is
         the live medium at its dim end — fogColor, the value
         world/water_underwater.js is already writing per frame off the depth
         ramp, rather than a fixed tint that stays shallow-blue twenty metres
         down. 0.55 and a wide, soft window edge because a real surface is
         ROUGH: every wave facet tilts the cone, which smears the boundary over
         tens of degrees instead of ruling a ring at 48.6.

         No seam to engineer at the horizon: fogColor is linear here and so is
         outColor, so the fog mix carries this fragment to exactly the byte the
         open water beside it lands on. Above water dwUnder is 0 and not one
         line of this runs. */
      "  if (dwUnder > 0.5) {",
      "    float dwWin = smoothstep(0.36, 0.80, clamp(dot(N, V), 0.0, 1.0));",
      "    #ifdef USE_FOG",
      "      vec3 dwMirror = fogColor * 0.55;",
      "    #else",
      "      vec3 dwMirror = uDisasterTint * 0.34;",
      "    #endif",
      // 0.86 and not 0.72: measured, 0.72 left the ceiling at luminance 132
      // against a horizon at 148, i.e. still the wrong way round by a nose.
      // The remaining 14% is the surface's own body colour and its sun
      // glitter, which is what stops the window being a plain card.
      "    outColor = mix(dwMirror, mix(outColor, sky, 0.86), dwWin);",
      "  }",
      /* A SUSPENSION IS OPAQUE, AND THAT WAS THE LAST BIG TELL. dwSolid is
         what closes cbzSeaAlpha, and feeding it the raw sediment left the
         flood 5-11% clear — enough, over a bright plaza or a road, to see the
         LANE MARKINGS through two metres of tsunami. Magnified, the "checker-
         board" on the flooded town was the town's own pavement grid showing
         through, and the olive cast on the standing water was grass. Half a
         metre of Tohoku mud hid a car; the term saturates well before the load
         does. uDisasterOpacity still multiplies afterwards, so a receding
         tsunami fades exactly as it always has. */
      "  float dwSolid = clamp(max(max(foam, boil), max(whitew, min(1.0, sed * 1.9))), 0.0, 1.0);",
      "  gl_FragColor = vec4(outColor, uDisasterOpacity * cbzSeaAlpha(V, vDwDist, dwUnder, dwSolid));",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const transparent = opts.transparent === true || U.uDisasterOpacity.value < 0.999 ||
      translucentOn();
    /* DEPTH STAYS OURS. A transparent material normally drops depthWrite, and
       for a sprite that is right — but this is a 1.4 km sheet that half the
       world sits behind, and a sea that stopped writing depth would stop
       occluding every particle, decal and foam layer under it. The sea keeps
       writing depth and simply blends on the way in; the only thing that
       changes is that it is now drawn in the transparent pass, AFTER the
       opaque animals it has to show through. Callers that ask for a specific
       depthWrite (the receding tsunami) still get exactly what they asked. */
    const mat = new THREE.ShaderMaterial({
      name: opts.name || "CBZ Disaster Water",
      uniforms: U, vertexShader: vs, fragmentShader: fs,
      fog: true, transparent: transparent,
      opacity: U.uDisasterOpacity.value,
      // ...but only for a sea at FULL body opacity. A caller that deliberately
      // fades this sheet out (the receding tsunami) still gets the old
      // depthWrite:false, because a half-faded sheet that writes depth punches
      // a hole in everything behind it.
      depthWrite: opts.depthWrite == null
        ? ((translucentOn() && U.uDisasterOpacity.value >= 0.999) ? true : !transparent)
        : !!opts.depthWrite,
      depthTest: true, side: THREE.DoubleSide,
    });
    mat.userData.waterMode = "shared-disaster-fresnel";
    mat.userData.waterUniforms = U;
    /* THE SEA GOES WITH THE GROUND OVER A HOLE. This shader #includes the fog
       chunks, so core/groundmask.js's discard is already compiled into it — but
       a ShaderMaterial owns its own uniforms and three will not hand it the
       shared slot array, so the CODE arrives without the DATA and the test
       reads zeros. One line gives it the data. It matters: the ocean plane sits
       at y=-0.8 across the whole island, so a 46 m shaft looked up at blue
       water and down into it saw the sea. */
    if (CBZ.groundMaskAttach) CBZ.groundMaskAttach(mat);
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
      /* SEA_TRANSLUCENT made this number mean something. Before it, the sea was
         built transparent:false and a runtime opacity was simply ignored by the
         renderer; now the sheet really does fade — so the moment it stops being
         a full-bodied sea it must also stop writing depth, or a half-faded
         tsunami punches a hole in everything behind it. */
      if (translucentOn() && mat.userData && mat.userData.waterUniforms === u) {
        const solid = +state.opacity >= 0.999;
        if (mat.depthWrite !== solid) mat.depthWrite = solid;
      }
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
        // A caller that has a front but no opinion about the flow is flowing
        // the way the front is going, which is true of every bore.
        if (!state.flowDir && u.uDwFlow) u.uDwFlow.value.set(dx / l, dz / l);
      }
      if (state.flowDir && u.uDwFlow) {
        const fx = +state.flowDir[0] || 0, fz = +state.flowDir[1] || 0;
        const fl = Math.hypot(fx, fz) || 1;
        u.uDwFlow.value.set(fx / fl, fz / fl);
      }
      /* CAPPED, and not for physics. The undertow really does run past 9 m/s,
         but the detail tile is a ~24 m pattern: advecting it that fast smears
         it into a grey blur, so the SEEN speed saturates where the eye stops
         reading translation and starts reading motion blur. The direction is
         never capped, which is the half that carries the undertow. */
      if (Number.isFinite(state.flowSpeed) && u.uDwFlowSpd) {
        u.uDwFlowSpd.value = Math.max(0, Math.min(4.5, +state.flowSpeed));
      }
      if (Number.isFinite(state.stand) && u.uDwStand) {
        u.uDwStand.value = Math.max(0, Math.min(1, +state.stand));
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
  /* 2026-09-01: THE MUD COLUMN'S BOTTOM HALF IS LIFTED ~50%. The old values
     were tuned against a MeshPhongMaterial carrying a blue emissive term and
     a broad specular lobe, both of which were doing a lot of unacknowledged
     lifting; the face material has neither (it earns its brightness from the
     sun and the sky instead), and with them gone the foot of the landfall
     wall rendered as pure BLACK — a hole in the frame, not a wave. The clean
     column is untouched: it was never the one being propped up. */
  const TSU_ROWCOL = [
    [[0.03, 0.12, 0.20], [0.052, 0.045, 0.034]],
    [[0.05, 0.18, 0.30], [0.076, 0.065, 0.049]],
    [[0.08, 0.28, 0.42], [0.115, 0.099, 0.074]],
    [[0.12, 0.40, 0.55], [0.163, 0.140, 0.106]],
    [[0.22, 0.55, 0.68], [0.226, 0.199, 0.157]],
    [[0.42, 0.72, 0.82], [0.310, 0.285, 0.242]],
    [[0.60, 0.83, 0.90], [0.410, 0.387, 0.347]],
    [[0.72, 0.90, 0.95], [0.530, 0.514, 0.482]],
    [[0.55, 0.80, 0.88], [0.375, 0.362, 0.337]],
  ];
  /* THE GRID IS NOW DENSE ENOUGH TO BE A SURFACE. 9 knots x 30 columns is a
     low-poly SLOPE: you can count the facets in every screenshot, and the
     silhouette of the curl is a polyline. The knots above are still the
     authored shape — they are just resampled through a Catmull-Rom spline
     onto 16 rows, and the columns tripled, so the curl reads as a curve and
     the crest has somewhere to put its lobes. 16 x 97 = 1552 vertices, and
     the per-frame loop below does its trig per COLUMN (angle-addition), not
     per vertex, so the denser mesh costs less arithmetic than the old one. */
  const TSU_COLS = 96;
  const TSU_ROWS = 16;

  function cmr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  // f 0..1 up the face -> [forward z, height fraction], splined through the knots
  function tsuProfileAt(f) {
    const K = TSU_PROFILE, n = K.length;
    const sPos = Math.max(0, Math.min(n - 1.0001, f * (n - 1)));
    const i = Math.floor(sPos), u = sPos - i;
    const a = K[Math.max(0, i - 1)], b = K[i], c = K[Math.min(n - 1, i + 1)], d = K[Math.min(n - 1, i + 2)];
    return [cmr(a[0], b[0], c[0], d[0], u), cmr(a[1], b[1], c[1], d[1], u)];
  }
  // the two palettes, sampled at the same fraction (linear — a colour ramp
  // does not want the spline's overshoot, which reads as a bright band)
  function tsuRowColAt(f, out) {
    const K = TSU_ROWCOL, n = K.length;
    const sPos = Math.max(0, Math.min(n - 1.0001, f * (n - 1)));
    const i = Math.floor(sPos), u = sPos - i, j = Math.min(n - 1, i + 1);
    for (let k = 0; k < 3; k++) {
      out[k] = K[i][0][k] + (K[j][0][k] - K[i][0][k]) * u;
      out[3 + k] = K[i][1][k] + (K[j][1][k] - K[i][1][k]) * u;
    }
    return out;
  }

  /* ============================================================
     THE WHITECAP — WHAT A BREAKING CREST IS ACTUALLY MADE OF.

     The first pass drew the crest as a row of sloped quads and tripled the
     patch count when it read badly. The render says what the count could not:
     144 cards of the same width, at the same height, at the same z, tilted
     the same way and pulsing in unison is not spray — it is a strip of torn
     tape laid along the top of the wave, and adding cards to it only makes
     the tape finer. REGULARITY is the tell, and no amount of it is fixed by
     more of it.

     A whitecap is also not a LINE. It is three different materials, and they
     want three different treatments:

       SHREDS   dense white water on and just over the lip. This is MATTER:
                normal-blended, because additive white over a bright horizon
                blows out to nothing. It is also NEVER shaded — see the crest
                block below for why a shaded shred is a card.
       SHOULDER the older foam already lying on top of the wave BEHIND the
                lip. This is what makes the crest a BAND with depth you can
                look across, instead of an edge you can only look at.
       TORN     the bits actually breaking off, and the mist above them. Both
                additive, so a dark vertex is an ABSENT one and a shred can
                dissolve at its tail instead of fading to dirt.

     Every shred carries its own yaw, roll, taper, reach, drop and brightness,
     so no two present the same silhouette from any camera; density is clumped
     by a low-frequency wobble, because spray comes off a crest in bursts with
     holes between them, never at a constant rate per metre.

     And the band RIDES THE CURL. tsuFaceUpdate throws the wall's lip forward
     by up*up*curl*6.2, so foam pinned to a fixed z tears away from the very
     lip it is supposed to be breaking off — which is exactly what the old
     shots show at full curl. Every foam layer takes the same offset, every
     frame, from the same number.
     ============================================================ */
  const SHRED_T = [0, 0.55, 1];              // top edge · thrown middle · tail

  function foamLayerNew(nv) { return { p: [], c: [], i: [], a: [], nv: nv }; }

  /* One shred: a bent, tapered strip, NOT a card. Top edge sits on the lip,
     the middle is thrown forward, the tail narrows and falls down the face.
     `yaw` swings it out of the front's plane and `roll` lifts one end, which
     between them are what stop a hundred of these reading as one ribbon. */
  function pushShred(F, s) {
    const q = F.p.length / 3;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    for (let r = 0; r < 3; r++) {
      const t = SHRED_T[r];
      // The tail runs OUT, ideally to a point: a shred that ends on a flat
      // edge is a trapezoid, and a trapezoid is cut paper. A scrap of torn
      // water ends in a tear.
      const wide = s.wid * (1 - t * s.taper);
      const fwd = s.reach * t * t;                       // throws, accelerating
      const down = s.drop * t * (0.5 + 0.5 * t);         // and falls away
      const b = s.bright * (1 - t * s.fade);
      for (let e = 0; e < 2; e++) {
        const u = e ? 1 : -1;
        F.p.push(
          s.x + u * wide * cy - fwd * sy * 0.3,
          s.y - down + u * wide * s.roll,
          s.z + u * wide * sy * 0.5 + fwd
        );
        F.c.push(b, b, b);
      }
    }
    F.i.push(q, q + 2, q + 1, q + 1, q + 2, q + 3,
      q + 2, q + 4, q + 3, q + 3, q + 4, q + 5);
    F.a.push(s.ph, s.ampX, s.ampY, s.ampZ, s.rate);
  }

  /* One puff of airborne mist: a fan, bright at the centre and ZERO at every
     rim vertex. Additive, so the rim is literally invisible and the puff has
     no edge to catch the eye — the one shape a quad cannot make, and the
     reason spray used to end on a straight line against the sky. */
  const BLOB_RIM = 8;                 // fewer points and the puff reads as a polygon
  function pushBlob(F, s) {
    const q = F.p.length / 3;
    F.p.push(s.x, s.y, s.z); F.c.push(s.bright, s.bright, s.bright);
    for (let k = 0; k < BLOB_RIM; k++) {
      const a = (k / BLOB_RIM) * 6.2832 + s.spin;
      const rx = Math.cos(a) * s.r * (0.7 + 0.3 * ((k * 5) % 3)), ry = Math.sin(a) * s.r * 0.82;
      F.p.push(s.x + rx, s.y + ry, s.z + rx * s.lean);
      F.c.push(0, 0, 0);
    }
    for (let k = 0; k < BLOB_RIM; k++) F.i.push(q, q + 1 + k, q + 1 + ((k + 1) % BLOB_RIM));
    F.a.push(s.ph, s.ampX, s.ampY, s.ampZ, s.rate);
  }

  function foamLayerBuild(F, opts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(F.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(F.c, 3));
    g.setIndex(F.i);
    // No computeVertexNormals: every foam material here is MeshBasicMaterial,
    // which never reads a normal. The old ribbons paid for them anyway.
    const m = new THREE.MeshBasicMaterial({
      color: opts.color, vertexColors: true, transparent: true, opacity: opts.opacity,
      side: THREE.DoubleSide, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = opts.order || 5;
    mesh.frustumCulled = false;     // vertices move and the group flies with the front
    return { mesh: mesh, geo: g, mat: m, base: new Float32Array(F.p), anim: new Float32Array(F.a), nv: F.nv };
  }

  /* Per-frame, per-layer. Each shred moves RIGIDLY on its own phase — three
     sines per shred, not per vertex — so a 240-shred crest costs ~700 sines
     and a flat run of adds, and the churn is per-patch rather than the whole
     band breathing in unison the way one shared opacity pulse made it. */
  function foamLayerAnim(L, t, zOff, dt) {
    if (!L || !L.mesh) return;
    const at = L.mesh.geometry.attributes.position, p = at.array, b = L.base, an = L.anim;
    const stride = L.nv * 3;
    // A STREAMING layer (the wake) also travels: each ribbon slides seaward on
    // its own rate and respawns at the front, so the whitewater behind the
    // bore reads as water being LEFT BEHIND rather than a pattern painted on.
    const flow = L.flow, off = L.off, span = L.span || 200;
    let vi = 0, si = 0;
    for (let s = 0; s < an.length; s += 5) {
      const ph = t * an[s + 4] + an[s];
      const dx = Math.sin(ph * 0.91) * an[s + 1];
      const dy = Math.sin(ph) * an[s + 2];
      let dz = Math.cos(ph * 1.17) * an[s + 3] + zOff;
      if (flow) {
        let o = off[si] - flow[si] * (dt || 0);
        if (o < -span) o = ((si * 37) % 23) - 4;    // respawn at the front
        off[si] = o; dz += o;
      }
      si++;
      for (let k = 0; k < stride; k += 3) {
        p[vi + k] = b[vi + k] + dx;
        p[vi + k + 1] = b[vi + k + 1] + dy;
        p[vi + k + 2] = b[vi + k + 2] + dz;
      }
      vi += stride;
    }
    at.needsUpdate = true;
  }

  /* ============================================================
     THE FACE MATERIAL — WHERE THE WATER ACTUALLY HAPPENS.

     The wall used to be a vertex-coloured MeshPhongMaterial, and no amount of
     geometry was ever going to fix what that is: a matte, faceted HILL with a
     white cap painted on it. A breaking bore has no smooth surface anywhere on
     it. Its face is SHEETS — aerated water pouring down a dark body in
     vertical streaks, the streaks tearing into a boiling white cap at the lip
     and a scour of whitewater at the foot, all of it visibly moving DOWNWARD
     while the whole front drifts sideways.

     None of that is geometry. It is a fragment program, and it needs four
     things a Phong material cannot give:

       TEXTURE   a hash fbm sampled in FACE SPACE (metres along the front,
                 fraction up the face) with the v axis SCROLLING and the noise
                 stretched several times further along v than along u. Stretch
                 is the whole trick: isotropic noise on a wave face is a rash,
                 anisotropic noise is water running down it.
       FRESNEL   water is a mirror at grazing angles. Without it the face is
                 a painted wall no matter what colour it is painted.
       BACKLIGHT the open-sea look. A breaker's lip is THIN, and the sun
                 coming through it from behind is the turquoise every photo of
                 a plunging wave is actually about. This is the one term that
                 separates "blue slope" from "wave".
       MUD       and all three of the above must switch OFF with turbid. A
                 debris soup has no gloss, no transmission and no hue — the
                 landfall wall is opaque, matte and warm-dark, with tan foam.

     THE LINEAR-HEX TRAP applies to every constant below: these are LINEAR
     values that go through ACESFilmic + sRGB on the way out, so they land
     much lighter and cooler than they read here. Judge them from a
     screenshot, never from the number. (Same warning the TSU_ROWCOL table
     carries, and for the same reason.)
     ============================================================ */
  function tsuWallMaterial() {
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    uni.uTime = { value: 0 };
    uni.uTurbid = { value: 0 };
    uni.uCurl = { value: 0.5 };
    uni.uH = { value: 34 };
    uni.uFoam = { value: 0.7 };
    uni.uOpacity = { value: 0.92 };
    uni.uSunDir = { value: new THREE.Vector3(0.42, 0.79, -0.09) };
    uni.uSunCol = { value: new THREE.Color(1.0, 0.96, 0.88) };
    uni.uSkyCol = { value: new THREE.Color(0.62, 0.72, 0.86) };
    uni.uGndCol = { value: new THREE.Color(0.22, 0.24, 0.18) };

    const VERT = [
      "attribute vec2 aFace;",
      "varying vec2 vFace;",
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "varying vec3 vBody;",
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vFace = aFace;",
      "  vBody = color;",
      "  vec4 wp = modelMatrix * vec4( position, 1.0 );",
      "  vWPos = wp.xyz;",
      "  vNrm = normalize( mat3( modelMatrix ) * normal );",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const FRAG = [
      "uniform float uTime;",
      "uniform float uTurbid;",
      "uniform float uCurl;",
      "uniform float uH;",
      "uniform float uFoam;",
      "uniform float uOpacity;",
      "uniform vec3 uSunDir;",
      "uniform vec3 uSunCol;",
      "uniform vec3 uSkyCol;",
      "uniform vec3 uGndCol;",
      "varying vec2 vFace;",
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "varying vec3 vBody;",
      "#include <fog_pars_fragment>",
      // no textures exist in this game's water kit, so the noise is hashed.
      "float h21( vec2 p ) {",
      "  vec3 q = fract( vec3( p.xyx ) * 0.1031 );",
      "  q += dot( q, q.yzx + 33.33 );",
      "  return fract( ( q.x + q.y ) * q.z );",
      "}",
      "float vn( vec2 p ) {",
      "  vec2 i = floor( p ), f = fract( p );",
      "  f = f * f * ( 3.0 - 2.0 * f );",
      "  float a = h21( i );",
      "  float b = h21( i + vec2( 1.0, 0.0 ) );",
      "  float c = h21( i + vec2( 0.0, 1.0 ) );",
      "  float d = h21( i + vec2( 1.0, 1.0 ) );",
      "  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );",
      "}",
      /* Four octaves, and the top two are faded out by `fine` with camera
         distance — a metre-scale octave sampled across a wave that is nine
         pixels tall is pure aliasing, and it crawls. */
      "float fbm( vec2 p, float fine ) {",
      "  float s = 0.0, w = 0.0, a = 0.5;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.03;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.07;",
      "  s += a * fine * vn( p ); w += a * fine; a *= 0.52; p *= 2.11;",
      "  s += a * fine * vn( p ); w += a * fine;",
      "  return s / max( w, 0.0001 );",
      "}",
      "void main() {",
      "  vec3 toCam = cameraPosition - vWPos;",
      "  float dist = length( toCam );",
      "  vec3 V = toCam / max( dist, 0.001 );",
      "  float fine = 1.0 - smoothstep( 150.0, 560.0, dist );",
      "  float v = clamp( vFace.y, 0.0, 1.0 );",
      "  float u = vFace.x;",
      /* THE FACE POURS. v is a FRACTION of the face, so a constant metres-per-
         second has to be divided by the live height or a 6 m bore's texture
         runs six times faster than a 36 m one's. */
      "  float fall = uTime * ( 2.6 / max( 6.0, uH ) );",
      /* ANISOTROPY IS THE WHOLE READ, and it has to be measured in METRES,
         not in the two axes' raw numbers: u is metres along the front and v is
         a FRACTION of a face that might be 6 m tall or 36. At uH = 14 a
         v-scale of 1.15 is an 12 m feature and a u-scale of 0.68 is a 1.5 m
         one — eight to one, which is a sheet running down the face. The first
         cut had 3.3 m by 5 m, which is 1.5 : 1, which is marbling. */
      /* AND THEY MUST MEANDER. Sampling straight down v gives streaks that
         are exactly parallel and exactly vertical — a picket fence painted on
         the wave, which is what the second pass actually rendered. One slow
         domain warp in u (itself drifting) makes them converge, braid and
         lean, and costs one more fbm at the coarsest setting. */
      "  float warp = fbm( vec2( u * 0.14, ( v + fall * 0.35 ) * 1.7 ), fine * 0.4 ) - 0.5;",
      "  vec2 qf = vec2( u * 0.68 + warp * 3.4 + uTime * 0.018, ( v + fall ) * 1.85 );",
      "  vec2 qc = vec2( u * 0.115 - uTime * 0.008, ( v + fall * 0.45 ) * 0.60 );",
      "  vec2 qd = vec2( u * 2.10 + uTime * 0.05, ( v + fall * 1.7 ) * 3.3 );",
      "  float n = fbm( qf, fine );",
      "  float nc = fbm( qc, fine * 0.6 );",
      "  float nd = fine > 0.02 ? fbm( qd, fine ) : 0.5;",
      /* THE CAP IS NOT THE FACE. Up at the lip the surface is nearly
         HORIZONTAL, so the face-space stretch that makes sheets on the front
         makes corduroy on the top. The cap gets its own near-isotropic field,
         scrolling forward with the break. */
      "  float nf = fbm( vec2( u * 0.40 + uTime * 0.03, ( v + fall * 0.8 ) * 7.5 ), fine );",
      // (a) aerated water running down the face: strongest in the upper half
      /* THE SCOURED BORE IS THE CHAOTIC ONE. Every threshold below opens up
         with the sediment instead of closing: a bore that has torn up a
         shelf and a town is 40-60% churning whitewater over a dark body, not
         a clean dark face with a white line drawn on top of it. Miyako is the
         most turbulent frame of the whole event, and the first cut had it as
         the calmest one. */
      "  float upper = smoothstep( 0.05, mix( 0.52, 0.24, uTurbid ), v );",
      /* TWO SCALES, because a wave face has two: metre-wide TEARS of aerated
         water, and the broad SHEETS several metres across that they run
         inside. One scale alone is a comb. */
      "  float sLo = mix( 0.50, 0.38, uTurbid ), sHi = mix( 0.92, 0.72, uTurbid );",
      "  float streak = smoothstep( sLo, sHi, n * 0.74 + nc * 0.38 + ( nd - 0.5 ) * 0.36 * fine );",
      "  float sheet = smoothstep( mix( 0.52, 0.42, uTurbid ), mix( 0.88, 0.72, uTurbid ), nc * 0.72 + n * 0.28 );",
      "  float aer = max( streak, sheet * mix( 0.72, 0.95, uTurbid ) ) * upper * ( 0.45 + 0.55 * nc );",
      // (b) the cap. Its lower edge is EATEN by the noise; solid at the lip.
      /* THE LOWER EDGE OF THE CAP IS THE WHOLE SILHOUETTE. Sampled at a
         CONSTANT v it is a pure function of distance along the front, which
         is a torn line with tongues of white water reaching metres down the
         face — and metres is the right amount: a 4% wobble on a boundary is
         a straight line with a texture on it. */
      "  float capJag = fbm( vec2( u * 0.42 - uTime * 0.025, 3.7 ), fine * 0.5 );",
      "  capJag = capJag * 0.66 + ( nf * 0.5 + nc * 0.5 ) * 0.34;",
      "  float capEdge = 0.925 - ( 0.19 + 0.46 * uTurbid ) * capJag - 0.035 * uCurl;",
      "  float cap = smoothstep( capEdge, capEdge + 0.085, v );",
      /* A CAP THAT IS SOLID IS A PAINTED LID. Below the very lip the white
         water is a MESH of tongues with body colour showing through it, so
         the band is eaten by the fine field everywhere except the top 5%. */
      "  cap *= mix( 1.0, smoothstep( 0.26, 0.70, nf * 0.62 + nc * 0.38 ), 1.0 - smoothstep( 0.88, 0.97, v ) );",
      "  cap = max( cap, smoothstep( 0.955, 0.998, v ) );",
      // (c) the boil at the foot — nothing to scour in deep water
      /* THE DARK WATER HAS TO COME BACK THROUGH. Raising the coverage on its
         own turns the soup into a tan CLIFF — coverage without gaps is the
         white-curtain failure wearing mud. So the same fields that spread the
         foam also carve channels out of it: where they run low the whitewater
         is punched away entirely and the dark body underneath is what you
         see. Contrast is the mechanism; the average value is not. */
      "  float gap = 1.0 - smoothstep( 0.24, 0.58, n * 0.62 + nc * 0.38 );",
      "  float footN = smoothstep( 0.30, 0.74, nc * 0.55 + n * 0.55 );",
      "  float boil = ( 1.0 - smoothstep( 0.015, 0.14 + 0.40 * uTurbid, v ) ) * ( 0.42 + 0.58 * uTurbid ) * ( 0.3 + 0.7 * footN );",
      /* THE STREAKS ARE LINES ON A BODY, NOT A WASH OVER IT. Letting the
         aeration term reach full foam coverage milked the whole upper face to
         a flat pale curtain and buried the colour the open-sea beat exists to
         show. It contributes at most half. */
      "  float foam = clamp( max( cap, max( aer * mix( 0.52, 0.84, uTurbid ), boil ) ) * ( 0.62 + 0.46 * uFoam ), 0.0, 1.0 );",
      // (d) a bump normal off the same field, so the lit surface ripples
      "  float gx = ( fbm( qf + vec2( 0.30, 0.0 ), fine ) - n ) + ( nd - fbm( qd + vec2( 0.30, 0.0 ), fine ) ) * 0.55 * fine;",
      "  float gy = ( fbm( qf + vec2( 0.0, 0.55 ), fine ) - n ) + ( nd - fbm( qd + vec2( 0.0, 0.55 ), fine ) ) * 0.35 * fine;",
      "  vec3 nrm = normalize( vNrm );",
      "  if ( dot( nrm, V ) < 0.0 ) nrm = -nrm;",
      "  vec3 T = cross( vec3( 0.0, 1.0, 0.0 ), nrm );",
      "  float tl = length( T );",
      "  T = tl > 0.08 ? T / tl : vec3( 1.0, 0.0, 0.0 );",
      "  vec3 B = cross( nrm, T );",
      "  float bump = ( 0.5 + 0.5 * fine ) * ( 0.85 + 0.6 * uTurbid );",
      "  vec3 N = normalize( nrm + ( T * gx * 3.4 + B * gy * 1.7 ) * bump );",
      // ---- lighting. Legacy (non-physical) Lambert, to match everything else
      "  float ndl = max( dot( N, uSunDir ), 0.0 );",
      "  vec3 hemiL = mix( uGndCol, uSkyCol, 0.5 + 0.5 * N.y );",
      /* the body is not one colour either: the coarse field darkens the
         troughs and lifts the sheets, which is most of what makes a dark
         turbid wall read as MOVING rather than as a slab of paint. */
      /* AND THE GAPS GET DARKER AS THE FOAM SPREADS. A bore reads as a bore
         because dark water shows THROUGH the whitewater in streaks; raising
         the coverage without deepening the gaps is how iteration 3 got a
         white curtain. Contrast is the mechanism, average brightness is not. */
      "  vec3 body = vBody * ( 0.60 + 0.86 * nc + 0.24 * ( n - 0.5 ) )",
      "           * ( 1.0 - uTurbid * 0.62 * gap );",
      "  vec3 lit = body * ( hemiL + uSunCol * ndl );",
      /* FOAM IS MATTER, NOT A HIGHLIGHT. It takes its own diffuse, it never
         takes the gloss, and once the water is a soup it is TAN — clean white
         lace on gray-black mud is two unrelated objects in one frame. */
      "  float mud = uTurbid * uTurbid;",
      "  vec3 foamCol = mix( vec3( 0.86, 0.93, 0.98 ), vec3( 0.50, 0.435, 0.335 ), mud );",
      "  foamCol *= 0.60 + 0.56 * ( nf * 0.52 + nc * 0.30 + nd * 0.18 );",
      "  vec3 foamLit = foamCol * ( hemiL * 0.9 + uSunCol * ( 0.34 + 0.66 * ndl ) );",
      "  foam *= 1.0 - 0.66 * gap * uTurbid;",
      "  vec3 col = mix( lit, foamLit, foam );",
      // ---- the glassy terms. All of them die with the sediment.
      "  float glass = 1.0 - smoothstep( 0.22, 0.98, uTurbid );",
      "  float clear = 1.0 - foam * 0.72;",
      "  vec3 Hv = normalize( uSunDir + V );",
      "  float ndh = max( dot( N, Hv ), 0.0 );",
      /* TWO LOBES. The sharp one is the glint off a facet that happens to be
         aimed at the sun; the broad one is the sheen every wet surface has,
         and it is the term whose absence turned the mud wall into a black
         slab when the Phong material went away. The broad one survives the
         sediment (wet mud is still wet); the glint does not. */
      "  float spec = pow( ndh, 130.0 ) * ( 0.35 + 2.20 * glass );",
      "  spec += pow( ndh, 9.0 ) * ( 0.17 + 0.20 * glass );",
      "  col += uSunCol * spec * clear;",
      "  float fres = pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 5.0 );",
      "  col += uSkyCol * ( 0.02 + 1.15 * fres ) * ( 0.40 + 0.60 * glass ) * clear;",
      /* THE BACKLIT LIP. When the sun is on the far side of the face the thin
         water under the overhang transmits, and what comes through is not
         "brighter blue" — it is a saturated turquoise that the body colour
         never contains. `thin` is high only near the lip, which is where the
         sheet actually is thin. */
      /* THE SUN IN THIS WORLD IS NEARLY OVERHEAD (lights.js puts it at
         48,90,-10), so a literal "camera opposite the sun" test never fires
         and the first cut's backlight was dead code. What actually happens on
         a plunging lip is that the sheet OVERHANGS: its outer face is turned
         toward the viewer, which means its other side is turned toward the
         sky, and the light goes straight through it. So the test is the
         sheet's BACK, not the camera's back — and it fires exactly where the
         water is thin, which is the whole point. */
      "  float thru = max( dot( -N, uSunDir ), 0.0 );",
      "  thru = max( thru, pow( max( dot( V, -uSunDir ), 0.0 ), 3.0 ) * 0.8 );",
      /* and the general case: the top of a standing wave is a SHEET a metre
         or two thick with the sky behind it, so it transmits whatever is up
         there whichever way its local normal happens to be pointing. */
      "  thru = max( thru, smoothstep( 0.52, 0.95, v ) * max( uSunDir.y, 0.0 ) * 0.62 );",
      "  float thin = smoothstep( 0.18, 0.90, v ) * ( 0.40 + 0.60 * uCurl );",
      "  vec3 sss = vec3( 0.13, 0.78, 0.58 );",
      "  col += sss * uSunCol * thru * thin * glass * 3.4 * clear;",
      "  col += sss * uSkyCol * thin * glass * 0.75 * clear;",
      /* AND THE FOOT DISSOLVES INTO THE SEA IT IS RUNNING ON. A wall whose
         bottom row is fully opaque draws a hard straight line where it meets
         the water — the single strongest "this is a curtain hung in front of
         the ocean" tell in the magnified frames. The last metre of the face
         fades out and takes a wash of white with it. */
      "  float footFade = smoothstep( 0.0, 0.055, v );",
      "  float alpha = clamp( uOpacity + foam * 0.55 + uTurbid * 0.07, 0.0, 1.0 ) * footFade;",
      "  gl_FragColor = vec4( col, alpha );",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Face",
      uniforms: uni,
      vertexShader: VERT,
      fragmentShader: FRAG,
      vertexColors: true,          // declares + binds the `color` attribute
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.userData.uni = uni;
    return mat;
  }

  CBZ.tsuFaceBuild = function (opts) {
    opts = opts || {};
    const H = Number.isFinite(opts.height) ? +opts.height : 34;
    const W = Number.isFinite(opts.width) ? +opts.width : 320;
    const zs = H / 34;
    const rnd = typeof opts.rnd === "function" ? opts.rnd : Math.random;
    const grp = new THREE.Group();
    const ROWS = TSU_ROWS, COLS = TSU_COLS;
    const geoms = [], mats = [];

    /* Per-column jitter so the front churns instead of reading as a ruler —
       and (2026-08-29, "the wave just looks a little fake") three structural
       fixes folded into the same two arrays so every foam layer that welds to
       them (lipH/lipZ below) inherits them for free:

       1. THE END-CAP IS GONE. The wall used to carry its full crest height at
          column 0 and column COLS, so from any angle along the shore you could
          see a flat vertical EDGE where the wave simply stopped sideways — the
          single biggest "it's a mesh" tell. The crest now tapers into the sea
          over the outer ~14% of the width (smoothstep, floored at 8% so the
          last column is dying whitewater, not a degenerate sliver).
       2. THE CREST IS NOT ONE HEIGHT. White noise (±10%) never breaks a
          ruler; two low-frequency sines beating against each other do — runs
          of crest stand taller and lower by ±25%, the way a real front breaks
          up on the bathymetry under it.
       3. THE FRONT IS NOT ONE LINE. A low-frequency bow in the lip's forward
          throw makes sections of the crest LEAD and LAG by metres, so the
          wave stops arriving everywhere at the same instant. It rides zJit,
          which the wall applies toward the crest and the foam welds read
          directly — the foot stays on the waterline the level owns.

       At 96 columns the white-noise term is finer than the eye reads as
       "height variation" and becomes RAGGEDNESS instead, which is what it
       should have been all along, so a third beat frequency carries the
       metre-scale run-to-run difference the old 30-column noise used to. */
    /* 4. AND THE WHITE NOISE IS INTERPOLATED, NOT DEALT PER COLUMN. At 30
          columns an independent draw per column was 10 m raggedness. At 96 it
          is 3.3 m — one draw per mesh strip — and computeVertexNormals turns
          that into a different shading normal on every strip: the magnified
          open-sea frame came back as CORDUROY, a fan of vertical bars at
          exactly the column pitch, which no amount of fragment work can hide
          because it is in the geometry's normals. The draws are therefore
          taken every third column and smoothstepped between, which restores
          the old ~10 m scale on a mesh three times finer. */
    const zJit = [], hJit = [];
    const phA = rnd() * 6.283, phB = rnd() * 6.283, phC = rnd() * 6.283, phD = rnd() * 6.283;
    const KSTEP = 3, KN = Math.ceil(COLS / KSTEP) + 2;
    const knH = [], knZ = [];
    for (let k = 0; k < KN; k++) { knH.push(0.92 + rnd() * 0.16); knZ.push((rnd() - 0.5) * 3.4); }
    const knot = function (arr, c) {
      const f = c / KSTEP, i = Math.min(KN - 2, Math.floor(f)), a = f - i;
      const w = a * a * (3 - 2 * a);
      return arr[i] + (arr[i + 1] - arr[i]) * w;
    };
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.14);
      const taper = 0.08 + 0.92 * edge * edge * (3 - 2 * edge);
      const lf = 1 + 0.15 * Math.sin(u * 9.7 + phA) + 0.11 * Math.sin(u * 23 + phB)
        + 0.06 * Math.sin(u * 57 + phD);
      zJit.push(knot(knZ, c) + Math.sin(u * 6.9 + phC) * 3.4 + Math.sin(u * 31 + phD) * 0.9);
      hJit.push(knot(knH, c) * lf * taper);
    }
    // evidence for the storyboard: how un-ruler the crest actually is
    let hMean = 0; for (let c = 0; c <= COLS; c++) hMean += hJit[c];
    hMean /= COLS + 1;
    let hVar = 0; for (let c = 0; c <= COLS; c++) { const d = hJit[c] - hMean; hVar += d * d; }
    const crestVar = Math.sqrt(hVar / (COLS + 1)) / Math.max(0.001, hMean);
    const endTaper = Math.min(hJit[0], hJit[COLS]) / Math.max(0.001, hMean);
    const n = ROWS * (COLS + 1);
    const pos = new Float32Array(n * 3);
    const face = new Float32Array(n * 2);      // u = metres along the front, v = 0..1 up
    const col = new Float32Array(n * 3);
    const colClean = new Float32Array(n * 3);
    const colMud = new Float32Array(n * 3);
    const rc = [0, 0, 0, 0, 0, 0];
    let vi = 0, fi = 0;
    for (let r = 0; r < ROWS; r++) {
      const up = r / (ROWS - 1);
      const pr = tsuProfileAt(up);
      tsuRowColAt(up, rc);
      for (let c = 0; c <= COLS; c++) {
        const x = (c / COLS - 0.5) * W;
        pos[vi] = x;
        pos[vi + 1] = pr[1] * H * hJit[c];
        pos[vi + 2] = pr[0] * zs + zJit[c] * up;
        face[fi] = x; face[fi + 1] = up;
        // a little per-column value noise so neither palette reads as a decal
        const v = hJit[c];                       // ~0.9 .. 1.1 about unity
        colClean[vi] = rc[0] * v; colClean[vi + 1] = rc[1] * v; colClean[vi + 2] = rc[2] * v;
        colMud[vi] = rc[3] * v; colMud[vi + 1] = rc[4] * v; colMud[vi + 2] = rc[5] * v;
        col[vi] = colClean[vi]; col[vi + 1] = colClean[vi + 1]; col[vi + 2] = colClean[vi + 2];
        vi += 3; fi += 2;
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
    geo.setAttribute("aFace", new THREE.BufferAttribute(face, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geoms.push(geo);
    const wallMat = tsuWallMaterial();
    wallMat.uniforms.uH.value = H;
    mats.push(wallMat);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.renderOrder = 3;
    grp.add(wall);

    /* ---- THE CREST: A MASS, A TORN EDGE, AND MIST -----------------------
       Three populations, and the split between the first two is a BLEND MODE,
       not a tuning number. r128 has no per-vertex alpha (that arrives in
       r132), so a vertex colour is the only per-vertex control there is, and
       what it does depends entirely on how the material blends:

         MASS (normal-blended)  the dense white water. Vertex colour = shade,
              so a dark vertex is dark MATTER — and the thing BEHIND a piece
              of crest foam is nearly always brighter foam or lit water, so
              any vertex much under ~0.75 comes out as a gray card lying on
              the whitecap. That is the paper-plate read arriving by the back
              door, and it is why nothing in this layer is allowed to shade
              itself: the mass varies by overlap and coverage, never by tone.
         TORN (additive)        the bits actually breaking off the lip. Here a
              dark vertex is an ABSENT one, so a shred can dissolve at its
              tail instead of fading to dirt. This is the only way to get a
              silhouette that ends in nothing rather than in an edge.
         MIST (additive blobs)  what is already airborne.

       The SHOULDER shreds in the mass — flat, further back, on top of the
       wave — are what give the band a depth you can look ACROSS from an
       elevated camera, instead of a tape edge you can only look at.

       Count scales with the front now. The old fixed 144 meant a 320 m island
       bore and a 520 m city bore got the same number of shreds, so the city's
       were 60% wider — the same tuning could not be right in both worlds. */
    const crestF = foamLayerNew(6);
    const tornF = foamLayerNew(6);
    const sprayF = foamLayerNew(1 + BLOB_RIM);
    /* FOAM SITS ON THE LIP THIS FILE ACTUALLY BUILT. The wall's top row is
       jittered per column (hJit lifts it, zJit throws it forward), so a crest
       laid along a constant y and z leaves shreds hanging in mid-air over the
       low columns — the stray white flecks floating clear of the water in the
       before shots. Reading the SAME two arrays welds the band to the wave and
       hands it the wave's own raggedness for free. */
    const lipH = (x) => hJit[Math.max(0, Math.min(COLS, Math.round((x / W + 0.5) * COLS)))];
    const lipZ = (x) => zJit[Math.max(0, Math.min(COLS, Math.round((x / W + 0.5) * COLS)))];
    const shredCnt = Math.max(110, Math.min(330, Math.round(W / 1.15)));
    for (let c = 0; c < shredCnt; c++) {
      const x = (c / shredCnt - 0.5) * W + (rnd() - 0.5) * (W / shredCnt) * 1.7;
      /* CLUMPED, NOT DEALT. Two slow wobbles beating against each other give
         runs of dense spray and runs of bare crest, which is how a breaking
         wave actually tears. A per-shred coin flip alone gives even grit. */
      const dens = 0.62 + 0.24 * Math.sin(x * 0.052 + 1.7) + 0.18 * Math.sin(x * 0.017 - 0.6);
      if (rnd() > dens) continue;
      // where the crest has tapered into the sea there is no lip to shred:
      // foam riding a crest that is not there was the old floating-fleck tell
      if (lipH(x) < 0.3) continue;
      const back = rnd() < 0.3;
      if (back) {
        /* 2026-09-01: WIDER, BLUNTER, DIMMER. These lie behind the lip and
           their whole job is to give the band a thickness you can look across
           from an elevated camera. Magnified, the sharp taper turned each one
           into a white ARROW sitting on the shader's cap — a pointed shape is
           a shape, and a shape on foam is a card. Blunt them (taper 0.25-0.5)
           and — the correction to the correction — keep them BRIGHTER than
           the cap, never dimmer: a normal-blended vertex under the white it
           is lying on is a gray card, which is exactly what the dimmed pass
           rendered. The layer's OPACITY is what makes them subtle. */
        pushShred(crestF, {
          x: x, y: H * (0.862 + rnd() * 0.098) * lipH(x), z: (0.9 + rnd() * 2.6) * zs + lipZ(x) * 0.86,
          wid: 1.4 + rnd() * 2.8, taper: 0.25 + rnd() * 0.25,
          reach: (0.3 + rnd() * 1.4) * zs, drop: (0.4 + rnd() * 1.3) * zs,
          yaw: (rnd() - 0.5) * 2.1, roll: (rnd() - 0.5) * 0.42,
          bright: 0.90 + rnd() * 0.10, fade: 0.05 + rnd() * 0.12,
          ph: rnd() * 6.283, ampX: 0.14 + rnd() * 0.26, ampY: 0.2 + rnd() * 0.4,
          ampZ: 0.16 + rnd() * 0.34, rate: 1.5 + rnd() * 1.5,
        });
      } else {
        /* THE WALL ALREADY HAS A WHITE CAP. Its top two colour rows are very
           nearly white, so a slab of white foam laid across the lip adds no
           whiteness at all — it only adds its own straight edges, which is
           the entire reason a metre-scale shred up here reads as a card. The
           mass shreds are therefore SMALL and their job is the OUTLINE: they
           break the boundary between cap and sky, and they thicken the band
           where two or three of them overlap. Anything bigger is repainting
           a white wall white and charging a silhouette for it.

           2026-09-01: DELETED. The face material now paints the cap itself,
           with a lower edge torn into tongues by noise at every scale, and a
           white shred laid on top of a white cap contributes exactly one
           thing: its own straight edges. Magnified, the open-sea frame showed
           them for what they always were — a row of white ARROWS pinned along
           the crest. The shoulder shreds (the `back` branch above, which lie
           BEHIND the lip and give the band depth) and the torn fringe below
           stay; the slab on the lip does not. */
        /* THE TORN EDGE IS FIZZ, NOT FLAGS. One metre-wide shred per lip is
           big enough to be seen as an OBJECT — a row of little white pennants
           standing above the crest, which is the paper-plate failure wearing a
           different hat. Three tearings a third the size, hugging the lip,
           give a fringe that dissolves the silhouette instead of decorating
           it, and at any distance where one of them is a single pixel the
           whole fringe is still doing its job. */
        for (let k = 0; k < 2; k++) {
          if (rnd() > 0.82) continue;
          pushShred(tornF, {
            x: x + (rnd() - 0.5) * 2.6,
            y: H * (0.995 + Math.pow(rnd(), 1.6) * 0.075) * lipH(x),
            z: (2.9 + rnd() * 2.4) * zs + lipZ(x),
            wid: 0.22 + rnd() * 0.62, taper: 0.88 + rnd() * 0.12,
            reach: (0.5 + rnd() * 1.9) * zs, drop: (0.7 + rnd() * 2.4) * zs,
            yaw: (rnd() - 0.5) * 2.4, roll: (rnd() - 0.5) * 1.2,
            bright: 0.26 + rnd() * 0.34, fade: 0.85 + rnd() * 0.15,
            ph: rnd() * 6.283, ampX: 0.3 + rnd() * 0.6, ampY: 0.5 + rnd() * 0.9,
            ampZ: 0.35 + rnd() * 0.7, rate: 2.4 + rnd() * 2.6,
          });
        }
      }
      /* MIST, AND IT HAS TO STAY SMALL. The first cut let a blob reach five
         metres and threw one off two shreds in three: a hundred five-metre
         additive puffs is not spray, it is fog, and it bleached the blue-green
         body the open-sea beat exists to show. Small, sparse, and fading fast
         with height is what reads as torn water in air. */
      if (!back && rnd() < 0.45) {
        const up = Math.pow(rnd(), 1.7);                 // most of it stays low
        pushBlob(sprayF, {
          x: x + (rnd() - 0.5) * 3.4, y: H * (0.985 + up * 0.34) * lipH(x),
          z: (2.4 + rnd() * 4.0 - up * 2.6) * zs + lipZ(x) * 0.9,
          r: (0.42 + rnd() * 0.8 + up * 0.9) * zs, lean: (rnd() - 0.5) * 0.6, spin: rnd() * 6.283,
          bright: (0.3 + rnd() * 0.34) * (1 - up * 0.62),
          ph: rnd() * 6.283, ampX: 0.5 + rnd() * 1.5, ampY: 0.5 + rnd() * 1.7,
          ampZ: 0.4 + rnd() * 1.3, rate: 0.8 + rnd() * 1.3,
        });
      }
    }

    // ---- THE FOOT: the wash where the face meets the water it is running on
    const footF = foamLayerNew(6);
    const footCnt = Math.max(60, Math.min(190, Math.round(W / 2.9)));
    for (let c = 0; c < footCnt; c++) {
      const x = (c / footCnt - 0.5) * W + (rnd() - 0.5) * (W / footCnt) * 1.5;
      pushShred(footF, {
        x: x, y: 0.9 + rnd() * 0.7, z: (4.2 + rnd() * 1.5) * zs,
        wid: 1.0 + rnd() * 2.2, taper: 0.55 + rnd() * 0.4,
        reach: (0.9 + rnd() * 2.2) * zs, drop: 0.1 + rnd() * 0.35,
        yaw: (rnd() - 0.5) * 1.1, roll: (rnd() - 0.5) * 0.12,
        bright: 0.72 + rnd() * 0.28, fade: 0.14 + rnd() * 0.22,
        ph: rnd() * 6.283, ampX: 0.2 + rnd() * 0.4, ampY: 0.12 + rnd() * 0.22,
        ampZ: 0.3 + rnd() * 0.7, rate: 1.6 + rnd() * 1.6,
      });
    }

    /* ---- THE BOILING LEADING EDGE (turbid only) -------------------------
       Low, wide and way out in FRONT of the foot — the shredded white water a
       bore pushes ahead of itself as it scours the ground. Nothing to tear up
       in deep water, so it is faded out entirely at turbid 0. */
    const boilF = foamLayerNew(6);
    const boilCnt = Math.max(26, Math.min(90, Math.round(W / 6.4)));
    for (let c = 0; c < boilCnt; c++) {
      const x = (c / boilCnt - 0.5) * W + (rnd() - 0.5) * (W / boilCnt) * 1.8;
      pushShred(boilF, {
        x: x, y: (0.4 + rnd() * 2.4) * (H / 34), z: (5.6 + rnd() * 4.4) * zs,
        wid: 2.6 + rnd() * 5.0, taper: 0.22 + rnd() * 0.30,
        reach: (2.0 + rnd() * 5.5) * zs, drop: 0.2 + rnd() * 0.5,
        yaw: (rnd() - 0.5) * 1.5, roll: (rnd() - 0.5) * 0.2,
        bright: 0.7 + rnd() * 0.3, fade: 0.12 + rnd() * 0.24,
        ph: rnd() * 6.283, ampX: 0.3 + rnd() * 0.7, ampY: 0.3 + rnd() * 0.8,
        ampZ: 0.5 + rnd() * 1.1, rate: 2.4 + rnd() * 2.4,
      });
    }

    /* THE FACE STREAKS ARE GONE, AND THAT IS THE POINT. Fourteen additive
       tear-strips were a geometry answer to a SHADING problem: aerated water
       running down a wave face is a continuous field, not fourteen objects,
       and at any distance the objects read as sticks lying on the wall. The
       face material now paints the streaks per fragment, scrolling, at every
       scale, for one texture fetch of nothing. `streaks` stays on the handle
       as an empty array because the legacy (flag-off) wave path reads it. */
    const crestL = foamLayerBuild(crestF, { color: 0xffffff, opacity: 0.8, order: 5 });
    const tornL = foamLayerBuild(tornF, { color: 0xf4fbff, opacity: 0.5, order: 6, additive: true });
    const sprayL = foamLayerBuild(sprayF, { color: 0xeaf6ff, opacity: 0.4, order: 6, additive: true });
    const footL = foamLayerBuild(footF, { color: 0xeaf8ff, opacity: 0.62, order: 5 });
    // Not additive: dirty foam over a dark sky must still read as WHITE MATTER,
    // and additive white over a bright horizon just blows out to nothing.
    const boilL = foamLayerBuild(boilF, { color: 0xf1f4f2, opacity: 0.0, order: 5 });
    const layers = [crestL, tornL, sprayL, footL, boilL];
    for (let i = 0; i < layers.length; i++) {
      geoms.push(layers[i].geo); mats.push(layers[i].mat); grp.add(layers[i].mesh);
    }
    const crest = crestL.mesh, foot = footL.mesh, boil = boilL.mesh;
    const streaks = [];

    /* ---- THE WAKE -------------------------------------------------------
       Torn whitewater lying on the surface BEHIND the front and streaming
       back toward the sea. This is what tells you at a glance which way the
       water is going — on the survival island the shader draws it too, but
       the city ocean is a different material entirely and this is what
       carries the same read into the real world.

       It was fourteen PlaneGeometry rectangles, which is the crest's old
       failure lying down: from any side view they are fourteen straight white
       BARS on the water, and being flat is not a defence — a rectangle reads
       as a rectangle from every angle it is visible from. Same shreds as
       everything else, laid flat (no drop, so the strip runs out along the
       surface), tapered to a point, in ONE draw call instead of fourteen. */
    const wakeF = foamLayerNew(6);
    const wakeRate = [];
    const wakeCnt = Math.max(16, Math.min(60, Math.round(W / 11)));
    for (let i = 0; i < wakeCnt; i++) {
      pushShred(wakeF, {
        x: (rnd() - 0.5) * W * 0.94, y: 0.28 + rnd() * 0.22, z: -(6 + rnd() * 90),
        wid: 0.7 + rnd() * 2.4, taper: 0.6 + rnd() * 0.4,
        reach: 22 + rnd() * 70, drop: 0,                 // drop 0 → it lies flat
        yaw: (rnd() - 0.5) * 0.5, roll: 0,
        bright: 0.66 + rnd() * 0.34, fade: 0.45 + rnd() * 0.4,
        ph: rnd() * 6.283, ampX: 0.1 + rnd() * 0.3, ampY: 0.1 + rnd() * 0.18,
        ampZ: 0.2 + rnd() * 0.5, rate: 1.1 + rnd() * 1.2,
      });
      wakeRate.push(9 + rnd() * 22);
    }
    const wakeL = foamLayerBuild(wakeF, { color: 0xe8eee9, opacity: 0.3, order: 4 });
    wakeL.flow = new Float32Array(wakeRate);
    wakeL.off = new Float32Array(wakeRate.length);
    wakeL.span = 200;
    geoms.push(wakeL.geo); mats.push(wakeL.mat); grp.add(wakeL.mesh);

    return {
      group: grp, wall: wall, basePos: new Float32Array(pos),
      cols: COLS, rows: ROWS, baseH: H, width: W,
      // evidence: relative std-dev of crest height along the front (0 = a
      // ruler), and the end columns' height as a fraction of the mean (1 =
      // the old flat end-cap, ~0.08 = the crest dies into the sea)
      crestVar: crestVar, endTaper: endTaper,
      colClean: colClean, colMud: colMud, mudMix: -1,
      // per-column trig scratch for the update loop's angle-addition, and the
      // three phases the crest lobes ride (see tsuFaceUpdate)
      trig: new Float32Array((COLS + 1) * 8),
      lobPh: [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283],
      crestL: crestL, tornL: tornL, sprayL: sprayL, footL: footL, boilL: boilL,
      tearL: null, wakeL: wakeL,
      foams: [crest, foot], boil: boil, streaks: streaks, wake: [],
      geoms: geoms, mats: mats,
    };
  };

  /* Per-frame. Moves the face's 1552 vertices in overlapping directional
     phases and rebuilds the analytic normals; scales the whole profile with
     the wave's live height; advances the overhang and the crest lobes with
     `curl`; cross-fades the two body palettes with `turbid`; and hands the
     face material the live sun and hemisphere the rest of the world is lit
     by. The physical front is untouched — only the visible water churns, so
     collision can never drift from presentation. */
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

    /* THE TRIG IS PER COLUMN, NOT PER VERTEX. Every phase in this loop is
       (something in x) + (something in r), so sin(A+B) = sinA·cosB + cosA·sinB
       turns 1552 sines into 97 of them and a flat run of multiplies. That is
       what pays for tripling the grid: the dense mesh is CHEAPER to animate
       than the nine-row one was.

       Columns 0..cols also carry the CREST LOBES — two slow beats and one
       fast one, drifting in time, applied only to the top of the face. A sine
       wobble along the lip is a wobble; three incommensurate ones with a
       forward throw are tumbling fingers, which is what a breaking crest has
       instead of an edge. */
    const tr = h.trig, LP = h.lobPh;
    for (let c = 0; c <= cols; c++) {
      const x = base[(c * 3)];
      const A0 = t * 1.55 + x * 0.052;
      const A1 = t * -2.10 + x * 0.091;
      const A2 = A0 * 0.77;
      const k = c * 8;
      tr[k] = Math.sin(A0); tr[k + 1] = Math.cos(A0);
      tr[k + 2] = Math.sin(A1); tr[k + 3] = Math.cos(A1);
      tr[k + 4] = Math.sin(A2); tr[k + 5] = Math.cos(A2);
      /* FINGERS, NOT A WOBBLE. Four beats give a crest that undulates; a
         breaking lip is undulation PLUS isolated masses thrown up and out of
         it. The cubed half-sine is that: it is zero across most of the front
         and a sharp positive spike where a chunk is tumbling, and its weight
         rides the sediment because the frame that needs it most is landfall —
         the beat where `curl` has already collapsed to nearly nothing. */
      const lobe = Math.sin(x * 0.041 + t * 0.85 + LP[0]) * 0.56
        + Math.sin(x * 0.108 - t * 1.37 + LP[1]) * 0.30
        + Math.sin(x * 0.283 + t * 2.31 + LP[2]) * 0.19
        + Math.sin(x * 0.71 - t * 3.4 + LP[0] * 2.1) * 0.11;
      const spike = Math.max(0, Math.sin(x * 0.34 + t * 2.9 + LP[1] * 1.7));
      const spike2 = Math.max(0, Math.sin(x * 0.155 - t * 1.9 + LP[2] * 2.3));
      tr[k + 6] = lobe;
      tr[k + 7] = spike * spike * spike * 0.72 + spike2 * spike2 * 0.5;
    }
    /* THE LIP TEARS HARDEST WHEN IT IS BROKEN, and `curl` is at its smallest
       exactly then (disasters.js folds the overhang away at the crash), so a
       lobe amplitude driven by curl alone switched the raggedness off for the
       one frame the owner points at. Sediment drives it too. */
    const lobeY = H * 0.055 * (0.35 + 0.80 * curl + 0.95 * turbid);
    const lobeZ = (2.4 * curl + 3.2 * turbid) * hs;
    const fingY = H * 0.10 * (0.25 + 1.05 * turbid + 0.35 * curl);
    const fingZ = (1.2 + 3.4 * turbid) * hs;
    const lobeFrom = 0.79 - 0.13 * turbid;
    for (let r = 0; r < rows; r++) {
      const up = r / Math.max(1, rows - 1);
      const B0 = r * 0.61, B1 = -r * 0.37, B2 = B0 * 0.77;
      const sB0 = Math.sin(B0), cB0 = Math.cos(B0);
      const sB1 = Math.sin(B1), cB1 = Math.cos(B1);
      const sB2 = Math.sin(B2), cB2 = Math.cos(B2);
      const ax = up * 0.34 * chAmp;
      const ay0 = (0.16 + up * 0.72) * chAmp, ay1 = up * 0.22 * chAmp;
      const az = (0.08 + up * 0.78) * chAmp;
      const curlZ = up * up * curl * 6.2 * hs;
      // the lobes live on the top of the face and nowhere else — and the
      // band deepens with the sediment along with everything else up there
      const lwr = up > lobeFrom ? (up - lobeFrom) / (1 - lobeFrom) : 0;
      const lw = lwr * lwr;
      let q = (r * (cols + 1)) * 3, k = 0;
      for (let c = 0; c <= cols; c++, q += 3, k += 8) {
        const s0 = tr[k] * cB0 + tr[k + 1] * sB0;
        const s1 = tr[k + 2] * cB1 + tr[k + 3] * sB1;
        const s2 = tr[k + 4] * cB2 + tr[k + 5] * sB2;
        const lb = tr[k + 6] * lw, fg = tr[k + 7] * lw;
        p[q] = base[q] + s1 * ax;
        p[q + 1] = base[q + 1] * hs + s0 * ay0 + s1 * ay1 + lb * lobeY + fg * fingY;
        // OVERHANG: the lip throws further forward the harder the wave curls,
        // and it curls hardest just before it feels the bottom. The tumbling
        // chunks are thrown forward whether it is curling or collapsing.
        p[q + 2] = base[q + 2] * hs + s2 * az + curlZ + lb * lobeZ + fg * fingZ;
      }
    }
    a.needsUpdate = true;
    h.wall.geometry.computeVertexNormals();
    h.wall.geometry.attributes.normal.needsUpdate = true;

    /* ---- THE FACE MATERIAL'S LIVE STATE --------------------------------
       The shader owns the surface now, so what used to be four MeshPhong
       property pokes is four uniforms — and the light it shades with is the
       scene's ACTUAL light, read off core/lights.js's rig every frame rather
       than guessed at build time. A wave lit by a fixed noon sun inside a
       world running a day cycle is the tell that it is a decal. */
    const u = h.wall.material.uniforms;
    u.uTime.value = t;
    u.uTurbid.value = turbid;
    u.uCurl.value = Math.min(1, curl / 1.2);
    u.uH.value = H;
    u.uFoam.value = foamGain;
    u.uOpacity.value = 0.86 + turbid * 0.13;
    const sun = CBZ.sun, hemi = CBZ.hemi;
    if (sun) {
      const sm = sun.matrixWorld.elements;
      const tg = sun.target && sun.target.matrixWorld ? sun.target.matrixWorld.elements : null;
      let dx = sm[12] - (tg ? tg[12] : 0), dy = sm[13] - (tg ? tg[13] : 0), dz = sm[14] - (tg ? tg[14] : 0);
      const L = Math.hypot(dx, dy, dz) || 1;
      u.uSunDir.value.set(dx / L, dy / L, dz / L);
      const si = sun.intensity;
      u.uSunCol.value.setRGB(sun.color.r * si, sun.color.g * si, sun.color.b * si);
    }
    if (hemi) {
      const hi = hemi.intensity;
      u.uSkyCol.value.setRGB(hemi.color.r * hi, hemi.color.g * hi, hemi.color.b * hi);
      u.uGndCol.value.setRGB(hemi.groundColor.r * hi, hemi.groundColor.g * hi, hemi.groundColor.b * hi);
    }

    // palette cross-fade, only when it has actually moved (a full rewrite of
    // every body colour every frame for nothing is a cost that adds up)
    if (Math.abs(turbid - h.mudMix) > 0.012) {
      h.mudMix = turbid;
      const ca = h.wall.geometry.attributes.color, cp = ca.array;
      /* THE MUD ARRIVES LATE. A linear cross-fade puts the standing wave at
         the peak beat 60% of the way to Miyako's gray-brown, which is why
         that frame kept reading as a pale gray-green CLIFF: it had already
         spent most of its colour before it broke. ^1.45 keeps the green in
         the water until the bore is actually scouring a town. */
      const mudF = Math.pow(turbid, 1.45);
      for (let i = 0; i < cp.length; i++) cp[i] = h.colClean[i] + (h.colMud[i] - h.colClean[i]) * mudF;
      ca.needsUpdate = true;
    }

    /* ---- THE WHITECAP ----------------------------------------------------
       Every foam layer churns per SHRED (foamLayerAnim) rather than by one
       shared opacity pulse: a band that brightens and dims in unison is the
       same regularity tell as a band of identical cards, only in time instead
       of in space. The material-level pulse that is left is deliberately
       small — the geometry is doing the work now.

       THE CURL OFFSET IS THE FIX THAT MATTERS. The wall's lip row is thrown
       forward by curl*6.2 above; foam sitting at a fixed z simply came off
       the wave as it curled. Every layer is handed the SAME number, scaled by
       how far up the face it lives, so the crest stays welded to the lip, the
       tears stay on the face, and the foot stays at the foot. */
    if (h.crestL) {
      const dt = Number.isFinite(s.dt) ? +s.dt : 1 / 60;
      const lipZ = curl * 6.2;
      foamLayerAnim(h.crestL, t, lipZ, dt);
      foamLayerAnim(h.tornL, t, lipZ, dt);
      foamLayerAnim(h.sprayL, t, lipZ * 0.9, dt);
      foamLayerAnim(h.footL, t, 0, dt);
      if (turbid > 0.14) foamLayerAnim(h.boilL, t, 0, dt);
      if (turbid > 0.05) foamLayerAnim(h.wakeL, t, 0, dt);

      /* FOAM IS NOT WHITE WHEN THE WATER IS MUD. A bore that has already
         eaten a town throws tan-gray spray, not the clean blue-white of an
         open-sea whitecap — the before shots have pure white lace riding on
         top of Miyako's gray-black soup, and that one mismatch is what makes
         the landfall frame read as two unrelated objects. */
      const gain = 0.62 + foamGain * 0.42;
      const pulse = 1 + 0.06 * Math.sin(t * 2.7);
      /* THE DIRT RAMPS WITH THE SQUARE OF THE SEDIMENT, and that is a fix for
         a real artefact, not a taste call. A linear ramp made the foam 34%
         gray at turbid 0.26 — water still counted as open sea — and a shred
         a shade darker than the blown-out crest it is lying on does not read
         as foam at all: it reads as a CARD ON the foam. Clean water gets
         white foam, and the mud arrives when there is actually mud. */
      const mud = turbid * turbid;
      const cm = h.crestL.mat;
      cm.color.setRGB(1 - mud * 0.34, 1 - mud * 0.4, 1 - mud * 0.47);
      cm.opacity = Math.min(0.95, (0.40 + mud * 0.16) * gain * pulse);
      const tm = h.tornL.mat;
      tm.color.setRGB(0.96 - mud * 0.34, 0.98 - mud * 0.42, 1 - mud * 0.52);
      tm.opacity = Math.min(0.62, (0.22 + curl * 0.12) * gain * pulse);
      h.tornL.mesh.scale.set(1, hs, hs);
      const sm = h.sprayL.mat;
      sm.color.setRGB(0.92 - mud * 0.3, 0.96 - mud * 0.4, 1 - mud * 0.53);
      // mist is thrown by the CURL: a wave standing up hard tears far more of
      // itself into the air than one already collapsed across a town
      sm.opacity = Math.min(0.5, (0.13 + curl * 0.17) * gain * (1 + 0.12 * Math.sin(t * 3.3)));
      const fm = h.footL.mat;
      fm.color.setRGB(0.92 - mud * 0.3, 0.97 - mud * 0.38, 1 - mud * 0.45);
      fm.opacity = Math.min(0.85, (0.38 + turbid * 0.2) * gain);
      h.crestL.mesh.scale.set(1, hs, hs);
      h.sprayL.mesh.scale.set(1, hs, hs);
      h.footL.mesh.scale.set(1, hs, hs);
      if (h.wakeL) {
        // whitewater the bore has already left behind it, and it carries the
        // same sediment the front does — clean water leaves no wake to see
        h.wakeL.mat.color.setRGB(0.91 - mud * 0.3, 0.93 - mud * 0.34, 0.91 - mud * 0.36);
        h.wakeL.mat.opacity = turbid * (0.18 + 0.14 * Math.abs(Math.sin(t * 1.3)));
        h.wakeL.mesh.visible = turbid > 0.05;
      }
      if (h.boilL) {
        // the boil only exists once the bore is scouring something — in deep
        // water there is nothing under it to tear up
        h.boilL.mesh.scale.set(1, hs, hs);
        h.boilL.mesh.position.y = Math.sin(t * 2.3) * 0.5 * hs;
        const scour = Math.max(0, turbid - 0.12) / 0.88;
        h.boilL.mat.opacity = Math.min(0.95, scour * (0.62 + 0.33 * Math.abs(Math.sin(t * 4.3))));
        h.boilL.mesh.visible = scour > 0.02;
      }
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
