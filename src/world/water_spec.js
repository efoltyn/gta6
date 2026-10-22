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

  /* WATER_ENTRY_PHYSICS — LOCAL FREE-SURFACE RESPONSE.

     A crown and a ring drawn over an otherwise untouched sine-wave sea read as
     exactly what they are: an effect played on top of the water.  A real entry
     first accelerates an added mass of water, opens a short-lived cavity, and
     sends a pressure wave away from that cavity.  This flag lets the shared
     entry bus feed a small bounded impulse field into THE SAME height query the
     renderer, wildlife and boats already use.  There is still one sea, not a
     splash mesh pretending to be a second one.

     `?cfg_WATER_ENTRY_PHYSICS=0` is the exact A/B seam used by the shark-entry
     visual preset.  With it off all slots stay zero, so the generated shader
     contributes exactly 0 and the CPU query is the pre-pass sine field. */
  if (CFG.WATER_ENTRY_PHYSICS == null) CFG.WATER_ENTRY_PHYSICS = true;
  function entryPhysicsOn() {
    return CFG.WATER_ENTRY_PHYSICS !== false && CFG.WATER_V2 !== false;
  }
  CBZ.waterEntryPhysicsOn = entryPhysicsOn;

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
  //  1. THE WAVE SPECTRUM — the single source of truth (WATER V3, 2026-10-11)
  // ============================================================
  // The sea used to be five plain sines with hand-typed speeds (the 105 m row
  // ran 1.4x faster than water of that wavelength can, the 52/33 m "chop" rows
  // twice as fast) and one fixed direction no weather could touch. It is now a
  // GERSTNER sum in two physical groups:
  //
  //   SWELL (rows 0-2)  long-period water from distant storms. Directions and
  //                     wavelengths are the historical three (105/138/404 m),
  //                     so the coast keeps its familiar roll; speeds are now the
  //                     deep-water dispersion relation, omega = sqrt(g k).
  //   WIND SEA (3-14)   six compass bearings x two wavelengths (8-35 m). The
  //                     LIVE weather wind (CBZ.weatherWind) weights the bearings
  //                     with a cos^n spreading lobe that narrows as it blows
  //                     harder, and scales the group with wind speed. Rows are
  //                     NEVER rotated (rotating k swims every far crest); the
  //                     wind turns the sea by re-weighting fixed bearings, which
  //                     is also what a real sea does: the new sea builds as the
  //                     old one dies.
  //
  // Each row: y += a sin(theta), xz += Q a d cos(theta), theta = k (d.p) - w t +
  // phi. The horizontal term is the Gerstner crest-sharpening; Q is the live
  // choppiness (wind), capped every frame so sum(Q k a) can never fold the
  // surface through itself.
  //
  // LOD ON THE SUM. A row is only displaced where the mesh can carry it: each
  // WIND row fades over [lod.y, lod.z] * wavelength of camera distance, with
  // lod derived from the radial disc's ring growth for the live quality tier
  // (about 3.5 vertices per wavelength). The CPU query applies the identical
  // fade, so a hull 300 m away rides the swell it is drawn on, not chop it
  // cannot see. Past that the ripple normal field carries the detail.
  //
  // AMPLITUDE BUDGET — READ BEFORE RETUNING. Two neighbours were authored
  // against the crest/trough envelope of this table:
  //   • city/biome_forest.js sinks the Redhollow lake bed to -1.10 at its
  //     shore ring, so the deepest trough must stay ABOVE -1.10.
  //   • city/beach.js's swash apron starts at y=+0.048, so the highest crest
  //     must stay BELOW +0.03.
  // With SEA_Y = -0.48 that is an envelope of +-0.51. The budget is the SUM of
  // amplitudes (Gerstner never changes a crest's height, only its shape):
  //   swell 0.300 + wind 0.120 = 0.420 at the shore, exactly the old total.
  //   Wind bearing weights are normalised to sum to 1 and the wind-speed scale
  //   is <= 1, so the wind group can never exceed 0.120 at a shore. Every gain
  //   above 1 is gated behind cbzDeepFactor() (zero within 220 m of ANY coast).
  //   • shore / lake: 0.420 * weather(<=1.06) = 0.445  (crest -0.035, trough -0.925)
  //   • open ocean calm: 0.300*3.20 + 0.120*1.00 = 1.08 m; full storm ~2.1 m.
  const G_ACC = 9.81;
  const WIND_BEARINGS = 6;
  // [dirX, dirZ, k, omega, amp, group(0 swell / 1 wind), phase, lambda]
  const WAVES = [];
  (function buildSpectrum() {
    const swell = [[0.052, 0.030, 0.1225], [-0.020, 0.041, 0.1056], [0.011, 0.011, 0.0719]];
    for (let i = 0; i < swell.length; i++) {
      const kx = swell[i][0], kz = swell[i][1], k = Math.hypot(kx, kz);
      WAVES.push([kx / k, kz / k, k, Math.sqrt(G_ACC * k), swell[i][2], 0, 0.7 + i * 2.1, 2 * Math.PI / k]);
    }
    const LONG = [31, 26, 35, 28, 33, 24], SHORT = [11.5, 9.0, 13.0, 10.2, 8.4, 12.2];
    for (let j = 0; j < WIND_BEARINGS; j++) {
      const a = (17 + 60 * j) * Math.PI / 180;
      const dx = Math.cos(a), dz = Math.sin(a);
      const pairs = [[LONG[j], 0.075], [SHORT[j], 0.045]];
      for (let q = 0; q < 2; q++) {
        const lam = pairs[q][0], k = 2 * Math.PI / lam;
        WAVES.push([dx, dz, k, Math.sqrt(G_ACC * k), pairs[q][1], 1, (j * 2 + q) * 2.3999632, lam]);
      }
    }
  })();
  const N_WAVES = WAVES.length;                      // 15
  const N_SWELL = 3;
  const WIND_ROW_SLOTS = 4;                          // vec4 x4 = 16 row weights
  let SWELL_AMP = 0;
  for (let i = 0; i < N_SWELL; i++) SWELL_AMP += WAVES[i][4];
  const CHOP_AMP = 0.075 + 0.045;                    // one bearing's worth (weights sum to 1)
  const TOTAL_AMP = SWELL_AMP + CHOP_AMP;

  CBZ.WATER_WAVES = WAVES;
  CBZ.WATER_SWELL_AMP = TOTAL_AMP;           // 0.42 — peak displacement AT THE SHORE
  CBZ.WATER_SWELL_ROWS_AMP = SWELL_AMP;      // 0.300 — the long-period rows
  CBZ.WATER_CHOP_ROWS_AMP = CHOP_AMP;        // 0.120 — the wind sea
  // Shading-normal gain per group. The swell's true slope (k a ~ 0.02) is too
  // gentle to read in a lit frame at all, so its normal keeps an exaggeration;
  // the wind sea's slopes are real slopes and need almost none.
  const NORMAL_GAIN_SWELL = 6.0, NORMAL_GAIN_WIND = 1.5;
  CBZ.WATER_NORMAL_EXAGGERATION = NORMAL_GAIN_SWELL;

  // ---- THE WIND, ONE STATE FOR CPU AND GPU ---------------------------------
  // Read off systems/weather.js's one wind vector, eased (the bearing on a
  // ~25 s time constant, the speed on ~8 s) so a weather phase change turns
  // the sea over tens of seconds instead of snapping it. `rowW` is the
  // per-row amplitude scale the vertex program multiplies by (uWaveRow) and
  // the CPU query multiplies by: the same numbers, so they agree exactly.
  const WIND = { x: 0.882, z: 0.471, speed: 5.0, w01: 0.45, q: 0.6, stamp: -1, t: -1 };
  const rowW = new Float32Array(WIND_ROW_SLOTS * 4);
  const rowWVecs = [];
  for (let i = 0; i < WIND_ROW_SLOTS; i++) rowWVecs.push(new THREE.Vector4(1, 1, 1, 1));
  // x = Gerstner Q, y/z = wind-row LOD near/far in wavelengths, w = unused
  const waveCtl = new THREE.Vector4(0.6, 0.95, 1.9, 0);
  // the shading wind: the ripple octaves and streak lanes ride this, on a much
  // slower bearing (60 s) because rotating a texture frame swims far water
  const windDirShade = new THREE.Vector2(0.882, 0.471);
  function windTarget(out) {
    let x = 0.882, z = 0.471, sp = 5.0;
    if (typeof CBZ.weatherWind === "function") {
      try {
        const w = CBZ.weatherWind();
        if (w && Number.isFinite(w.x) && Number.isFinite(w.z) && (w.x * w.x + w.z * w.z) > 1e-6) {
          x = w.x; z = w.z; sp = Number.isFinite(+w.speed) ? +w.speed : sp;
          // a dead calm still has a breath of air on it — a sea with no wind
          // at all is a mirror, which is the one thing open water never is
          sp = Math.max(1.2, sp);
        }
      } catch (e) {}
    } else if (CBZ.world && CBZ.world.wind && Number.isFinite(CBZ.world.wind.x)) {
      x = CBZ.world.wind.x; z = CBZ.world.wind.z; sp = +CBZ.world.wind.speed || sp;
    }
    const m = Math.hypot(x, z) || 1;
    out.x = x / m; out.z = z / m; out.speed = sp;
    return out;
  }
  const _wt = { x: 1, z: 0, speed: 0 };
  function lodForTier() {
    // ring growth of the radial disc at this tier (see waterBuildSurfaceGeometry)
    const p = CBZ.waterTierParams ? CBZ.waterTierParams() : { rings: 80 };
    const NR = Math.max(8, Math.round(p.rings * Math.log(15000 / 1.6) / Math.log(4500 / 1.6)));
    const g = Math.pow(15000 / 1.6, 1 / Math.max(1, NR - 1));
    return 1 / (3.5 * Math.max(0.02, g - 1));
  }
  function windTick() {
    const tNow = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    // one evaluation per frame: the sim clock's stamp, or (a page with no
    // sim clock) the wall clock quantised to a 120 Hz tick
    const stamp = CBZ.now || Math.floor(tNow * 120);
    if (stamp === WIND.stamp) return WIND;
    const dt = WIND.t < 0 ? 1e3 : Math.min(2, Math.max(0, tNow - WIND.t));
    WIND.t = tNow; WIND.stamp = stamp;
    windTarget(_wt);
    const kd = 1 - Math.exp(-dt / 25), ks = 1 - Math.exp(-dt / 8), kv = 1 - Math.exp(-dt / 60);
    let nx = WIND.x + (_wt.x - WIND.x) * kd, nz = WIND.z + (_wt.z - WIND.z) * kd;
    const nm = Math.hypot(nx, nz);
    if (nm < 1e-3) { nx = _wt.x; nz = _wt.z; } else { nx /= nm; nz /= nm; }
    WIND.x = nx; WIND.z = nz;
    let sx = windDirShade.x + (nx - windDirShade.x) * kv, sz = windDirShade.y + (nz - windDirShade.y) * kv;
    const sm = Math.hypot(sx, sz);
    if (sm < 1e-3) { sx = nx; sz = nz; } else { sx /= sm; sz /= sm; }
    windDirShade.set(sx, sz);
    WIND.speed += (_wt.speed - WIND.speed) * ks;
    WIND.w01 = Math.max(0, Math.min(1, WIND.speed / 11));
    // bearing weights: cos^n spreading, narrower in a stronger wind
    const n = 2 + 6 * WIND.w01;
    let sum = 0;
    const wb = _wb;
    for (let j = 0; j < WIND_BEARINGS; j++) {
      const r = WAVES[N_SWELL + j * 2];
      const c = Math.max(0, r[0] * WIND.x + r[1] * WIND.z);
      wb[j] = Math.pow(c, n); sum += wb[j];
    }
    const scale = 0.35 + 0.65 * WIND.w01;            // <= 1: the shore budget
    for (let i = 0; i < rowW.length; i++) rowW[i] = i < N_SWELL ? 1 : 0;
    for (let j = 0; j < WIND_BEARINGS; j++) {
      const w = sum > 1e-6 ? wb[j] / sum * scale : 0;
      rowW[N_SWELL + j * 2] = w; rowW[N_SWELL + j * 2 + 1] = w;
    }
    for (let i = 0; i < WIND_ROW_SLOTS; i++) rowWVecs[i].set(rowW[i * 4], rowW[i * 4 + 1], rowW[i * 4 + 2], rowW[i * 4 + 3]);
    // Choppiness, then capped so sum(Q k a) < 0.9 at the WORST amplitude the
    // vertex program can produce (deep gains, full weather) — no loops, ever.
    let steep = 0;
    const gs = DEEP_GAIN * (1 + DEEP_STORM) * 1.06, gc = CHOP_BASE_GAIN * (1 + CHOP_STORM) * (1 + WIND_CHOP) * 1.06;
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      steep += r[2] * r[4] * rowW[i] * (r[5] ? gc : gs);
    }
    let q = 0.35 + 0.6 * WIND.w01;
    if (steep * q > 0.9) q = 0.9 / steep;
    WIND.q = q;
    const far = lodForTier();
    waveCtl.set(q, far * 0.5, far, 0);
    return WIND;
  }
  const _wb = new Float64Array(WIND_BEARINGS);
  CBZ.waterWind = function () { return windTick(); };

  // ---- DEEP-WATER SWELL ---------------------------------------------------
  // Multipliers applied ONLY where cbzDeepFactor() says the nearest land is
  // provably far away. The LONG rows carry the deep swell; the SHORT chop rows
  // deliberately do NOT grow in calm weather, because that is what deep water
  // is — a long, slow, glassy swell, with the short stuff being wind-driven
  // and therefore a property of the storm, not of the depth. It also keeps the
  // surface's vertical RATE down (a taller wave at the same frequency is a
  // faster wave, and everything that samples CBZ.citySeaHeightAt one tick
  // behind the render — wildlife, buoyancy — pays for that in tracking error).
  //   calm open ocean:  0.300*3.20 + 0.120*1.00 = 1.08m
  //   full storm, full wind: (0.300*4.48 + 0.120*2.80*1.9) * 1.06 = ~2.1m
  // The WIND gain (WIND_CHOP) is deep-gated like the rest: a gale raises the
  // open sea, never the shore envelope.
  const DEEP_GAIN = 3.20;                    // long swell rows, calm weather
  const CHOP_BASE_GAIN = 1.00;               // chop rows are WIND, not depth
  const DEEP_STORM = 0.40;                   // + this fraction per unit of rain
  const CHOP_STORM = 1.80;                   // storms buy STEEPNESS, not height
  const WIND_CHOP = 0.90;                    // + this fraction at full wind (deep only)
  CBZ.WATER_DEEP_AMP = SWELL_AMP * DEEP_GAIN + CHOP_AMP * CHOP_BASE_GAIN;  // 1.08

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
  // shore lamps a sea can reflect (uSeaLamps; a cheap point-light glint each)
  const SEA_LAMPS = 6;
  CBZ.WATER_SEA_LAMPS = SEA_LAMPS;

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
      // Math.hypot is a builtin call (its double arguments are boxed on every
      // call: this was a top allocation site of the road drive), and most
      // bodies are far away: reject outside the outer ring on the square.
      const dx = x - b.cx, dz = z - b.cz, c = b.r * 1.15, dd = dx * dx + dz * dz;
      if (dd >= c * c) continue;
      const d = Math.sqrt(dd);
      const a = b.r * 0.55;
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
    return CHOP_BASE_GAIN * (1 + weatherWet() * CHOP_STORM) * (1 + windTick().w01 * WIND_CHOP);
  }
  CBZ.waterDeepGain = deepGain;
  CBZ.waterChopGain = chopGain;

  // Combined amplitude scale at a world point. Shader and CPU agree.
  // waterAmpAt scales the LONG SWELL rows, waterChopAmpAt the SHORT CHOP rows;
  // they are the same number everywhere except in deep water during a storm.
  function baseAmpAt(x, z) {
    // inlandAt() is already 0 when the lake treatment is off, so this is the
    // identical expression the vertex program evaluates in every flag state.
    return fadeAt(x, z) * weatherAmp() * (1 + (INLAND_CALM - 1) * inlandAt(x, z)) *
      (1 + (RIVER_CALM - 1) * riverAt(x, z));
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

  /* ---- LOCAL ENTRY IMPULSES ----------------------------------------------

     Six events are enough: a splash lives for at most a few seconds and the
     pool always replaces the weakest/oldest live one when a busier scene asks
     for a seventh.  Each slot is two vec4s shared BY REFERENCE with every sea
     material:

       impulse: x, z, start-time, amplitude (m)
       shape:   initial radius, radial speed, lifetime, serial

     The closed-form sample is deliberately a CAVITY plus ONE travelling crest,
     not an undamped sine dropped into the ocean.  The cavity collapses quickly;
     the crest runs out and fades.  CPU and GPU evaluate the same equations, so
     the shark cannot cross a dent the eye cannot see and a boat cannot float on
     a ring that exists only in the shader. */
  const MAX_SURFACE_IMPULSES = 6;
  const surfaceImpulses = [], surfaceImpulseShapes = [];
  for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
    surfaceImpulses.push(new THREE.Vector4(0, 0, -1e6, 0));
    surfaceImpulseShapes.push(new THREE.Vector4(1, 1, 1, 0));
  }
  let surfaceImpulseSerial = 0;
  let lastSurfaceImpulse = null;
  const _surfaceImpulseSample = { h: 0, x: 0, z: 0 };

  function sampleSurfaceImpulses(x, z, t, out) {
    out = out || _surfaceImpulseSample;
    out.h = 0; out.x = 0; out.z = 0;
    if (!entryPhysicsOn()) return out;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      const q = surfaceImpulses[i], sh = surfaceImpulseShapes[i];
      const age = t - q.z, life = sh.z;
      if (!(q.w > 0) || age < 0 || age >= life) continue;
      const dx = x - q.x, dz = z - q.y;
      const r2 = dx * dx + dz * dz, r = Math.sqrt(r2);
      const rad = Math.max(0.12, sh.x * (1 + age * 0.18));
      const invRad2 = 1 / (rad * rad);
      const coreE = Math.exp(-2.6 * r2 * invRad2);
      const core = -q.w * coreE * Math.exp(-age * 2.35);
      const dCore = core * (-5.2 * r * invRad2);

      const front = sh.x * 0.62 + sh.y * age;
      const sigma = Math.max(0.16, sh.x * 0.34 + sh.y * age * 0.055);
      const u = (r - front) / sigma;
      const crest = q.w * 0.34 * Math.exp(-1.8 * u * u) * Math.exp(-age / life);
      const dCrest = crest * (-3.6 * u / sigma);
      const h = core + crest, dHdr = dCore + dCrest;
      out.h += h;
      if (r > 1e-5) {
        const k = dHdr / r;
        out.x += dx * k; out.z += dz * k;
      }
    }
    return out;
  }

  CBZ.waterSurfaceImpulse = function (x, z, spec) {
    if (!entryPhysicsOn()) return false;
    x = +x; z = +z; spec = spec || {};
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const t = CBZ.waterClock();
    const amp = Math.max(0.015, Math.min(1.35, +spec.amplitude || 0.12));
    const radius = Math.max(0.18, Math.min(9, +spec.radius || 0.8));
    const speed = Math.max(0.6, Math.min(16, +spec.speed || 4));
    const life = Math.max(0.45, Math.min(5.5, +spec.life || 2.2));
    let slot = -1, weakest = 1e9;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      const q = surfaceImpulses[i], sh = surfaceImpulseShapes[i];
      const age = t - q.z;
      if (!(q.w > 0) || age >= sh.z) { slot = i; break; }
      const score = q.w * Math.max(0, 1 - age / Math.max(0.01, sh.z));
      if (score < weakest) { weakest = score; slot = i; }
    }
    const serial = ++surfaceImpulseSerial;
    surfaceImpulses[slot].set(x, z, t, amp);
    surfaceImpulseShapes[slot].set(radius, speed, life, serial);
    lastSurfaceImpulse = { x: x, z: z, amplitude: amp, radius: radius,
      speed: speed, life: life, serial: serial };
    return true;
  };
  CBZ.waterSurfaceImpulseClear = function () {
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      surfaceImpulses[i].set(0, 0, -1e6, 0);
      surfaceImpulseShapes[i].set(1, 1, 1, 0);
    }
    lastSurfaceImpulse = null;
  };
  CBZ.waterSurfaceImpulseAudit = function () {
    const t = CBZ.waterClock();
    let active = 0;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      if (surfaceImpulses[i].w > 0 && t - surfaceImpulses[i].z >= 0 &&
          t - surfaceImpulses[i].z < surfaceImpulseShapes[i].z) active++;
    }
    return { active: active, capacity: MAX_SURFACE_IMPULSES,
      last: lastSurfaceImpulse ? Object.assign({}, lastSurfaceImpulse) : null };
  };

  // ---- the spectrum, evaluated on the CPU ----------------------------------
  // Mirrors cbzWaveSum() in the vertex program term for term: same rows, same
  // per-row wind weights (rowW), same Q, same per-row distance LOD.
  function camDist(x, z) {
    const cam = CBZ.camera;
    if (!cam) return 0;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function rowFade(r, dist) {
    if (!r[5]) return 1;
    const n = waveCtl.y * r[7], f = waveCtl.z * r[7];
    if (dist <= n) return 1;
    if (dist >= f) return 0;
    const u = (dist - n) / (f - n);
    return 1 - u * u * (3 - 2 * u);
  }
  // Evaluates the sum at PARAMETRIC point (px,pz). Fills out.h (height),
  // out.dx/out.dz (Gerstner horizontal displacement) and, with deriv, the
  // displaced surface's true slope (out.sx/out.sz) and its fold (1 - J).
  const _ev = { h: 0, dx: 0, dz: 0, sx: 0, sz: 0, fold: 0 };
  function evalSum(px, pz, t, ampS, ampW, dist, deriv, out) {
    windTick();
    const Q = waveCtl.x;
    let h = 0, dx = 0, dz = 0, hx = 0, hz = 0, sxx = 0, szz = 0, sxz = 0;
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      const a = r[4] * rowW[i] * (r[5] ? ampW * rowFade(r, dist) : ampS);
      if (!(a > 1e-7)) continue;
      const th = r[2] * (r[0] * px + r[1] * pz) - r[3] * t + r[6];
      const s = Math.sin(th), c = Math.cos(th);
      h += a * s;
      dx += Q * a * r[0] * c; dz += Q * a * r[1] * c;
      if (deriv) {
        const ka = r[2] * a;
        hx += ka * r[0] * c; hz += ka * r[1] * c;
        sxx += Q * ka * r[0] * r[0] * s; szz += Q * ka * r[1] * r[1] * s; sxz += Q * ka * r[0] * r[1] * s;
      }
    }
    out.h = h; out.dx = dx; out.dz = dz;
    if (deriv) {
      // tangents of the displaced sheet: Tx = (1-sxx, hx, -sxz), Tz = (-sxz, hz, 1-szz)
      const ny = (1 - sxx) * (1 - szz) - sxz * sxz;
      const nx = -hz * sxz - (1 - szz) * hx;
      const nz = -sxz * hx - hz * (1 - sxx);
      const iy = 1 / Math.max(0.05, ny);
      out.sx = -nx * iy; out.sz = -nz * iy;
      out.fold = Math.max(0, 1 - ny);
    }
    return out;
  }
  function ampPair(x, z, ampScale, chopScale, out) {
    const ampGiven = Number.isFinite(ampScale);
    out.a = ampGiven ? ampScale : CBZ.waterAmpAt(x, z);
    out.c = Number.isFinite(chopScale) ? chopScale : (ampGiven ? ampScale : CBZ.waterChopAmpAt(x, z));
    return out;
  }
  const _amp = { a: 1, c: 1 };

  // Instantaneous surface Y at WORLD (x,z). `t` defaults to the shared clock;
  // `ampScale` defaults to the same distance+inland+depth scale the shader
  // uses, so a boat's hull sits exactly where the rendered crest is.
  // `chopScale` (optional) scales the wind sea separately. BACK-COMPAT: pass
  // ampScale alone and it scales EVERY row.
  //
  // A Gerstner surface is parametric: the vertex that ends up over (x,z)
  // started at p with p + D(p) = (x,z). One fixed-point step p = X - D(X)
  // inverts it to well under a centimetre (sum Q k a < 0.9 by construction).
  CBZ.waterWaveHeight = function (x, z, t, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const A = ampPair(x, z, ampScale, chopScale, _amp);
    const dist = camDist(x, z);
    evalSum(x, z, t, A.a, A.c, dist, false, _ev);
    evalSum(x - _ev.dx, z - _ev.dz, t, A.a, A.c, dist, false, _ev);
    const imp = sampleSurfaceImpulses(x, z, t, _surfaceImpulseSample);
    return seaY() + _ev.h + imp.h;
  };

  // Surface slope (dY/dx, dY/dz) of the DISPLACED sheet — the true geometric
  // slope, which is what a hull pitches on. Allocation-free with `out`.
  // out.fold (0 flat .. ~1 folding) is the Gerstner Jacobian's compression:
  // where the sea is about to break.
  CBZ.waterWaveSlope = function (x, z, t, out, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const A = ampPair(x, z, ampScale, chopScale, _amp);
    const dist = camDist(x, z);
    out = out || {};
    evalSum(x, z, t, A.a, A.c, dist, false, _ev);
    evalSum(x - _ev.dx, z - _ev.dz, t, A.a, A.c, dist, true, _ev);
    const imp = sampleSurfaceImpulses(x, z, t, _surfaceImpulseSample);
    out.x = _ev.sx + imp.x;
    out.z = _ev.sz + imp.z;
    out.fold = _ev.fold;
    return out;
  };

  // The orbital velocity of the water at the surface (m/s, horizontal), for
  // anything that floats: a cork in a Gerstner wave rides a circle of radius a
  // at omega, so its velocity is a*omega*d*sin(theta) along the row. Bodies
  // that integrate this (water_float.js) surge forward on a crest and back in
  // the trough, and the small net forward drift is Stokes drift for free.
  CBZ.waterOrbitalAt = function (x, z, t, out) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    out = out || {};
    const A = ampPair(x, z, undefined, undefined, _amp);
    const dist = camDist(x, z);
    windTick();
    let vx = 0, vz = 0;
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      const a = r[4] * rowW[i] * (r[5] ? A.c * rowFade(r, dist) : A.a);
      if (!(a > 1e-7)) continue;
      const th = r[2] * (r[0] * x + r[1] * z) - r[3] * t + r[6];
      const v = a * r[3] * Math.sin(th);
      vx += v * r[0]; vz += v * r[1];
    }
    out.x = vx; out.z = vz;
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

  // The one GLSL wave function. Declared by waterVertexDecl() (and by anyone
  // who calls waterWaveGLSL, via CBZ.waterWaveDecl()). Rows are unrolled with
  // their constants inlined; only the live wind weights and Q are uniforms.
  //   p     parametric world xz        t     the shared clock
  //   aS    swell amplitude scale      aW    wind-sea amplitude scale
  //   dist  camera distance (per-row LOD)
  //   disp  (dx, height, dz)           nrm   shading normal (gain applied)
  //   fold  1 - Jacobian (0 flat .. ~1 about to break)
  function waveFnGLSL() {
    const L = [];
    L.push("uniform vec4 uWaveRow[" + WIND_ROW_SLOTS + "];");
    L.push("uniform vec4 uWaveCtl;");
    L.push("void cbzWaveSum(vec2 p, float t, float aS, float aW, float dist, out vec3 disp, out vec3 nrm, out float fold) {");
    L.push("  float Q = uWaveCtl.x;");
    L.push("  float th; float s; float c; float a; float ka;");
    L.push("  vec3 d = vec3(0.0);");
    L.push("  float hx = 0.0; float hz = 0.0; float sxx = 0.0; float szz = 0.0; float sxz = 0.0;");
    L.push("  float ex = 0.0; float ez = 0.0;");
    const comp = ["x", "y", "z", "w"];
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      const wsel = "uWaveRow[" + (i >> 2) + "]." + comp[i & 3];
      const scale = r[5]
        ? "aW * (1.0 - smoothstep(uWaveCtl.y * " + gnum(r[7]) + ", uWaveCtl.z * " + gnum(r[7]) + ", dist))"
        : "aS";
      const gain = r[5] ? NORMAL_GAIN_WIND : NORMAL_GAIN_SWELL;
      L.push("  a = " + gnum(r[4]) + " * " + wsel + " * " + scale + ";");
      L.push("  th = dot(p, vec2(" + gnum(r[0] * r[2]) + ", " + gnum(r[1] * r[2]) + ")) - t * " + gnum(r[3]) + " + " + gnum(r[6]) + ";");
      L.push("  s = sin(th); c = cos(th); ka = " + gnum(r[2]) + " * a;");
      L.push("  d += vec3(Q * a * " + gnum(r[0]) + " * c, a * s, Q * a * " + gnum(r[1]) + " * c);");
      L.push("  hx += ka * " + gnum(r[0]) + " * c; hz += ka * " + gnum(r[1]) + " * c;");
      L.push("  sxx += Q * ka * " + gnum(r[0] * r[0]) + " * s; szz += Q * ka * " + gnum(r[1] * r[1]) + " * s; sxz += Q * ka * " + gnum(r[0] * r[1]) + " * s;");
      L.push("  ex += ka * " + gnum(r[0] * gain) + " * c; ez += ka * " + gnum(r[1] * gain) + " * c;");
    }
    L.push("  disp = d;");
    L.push("  float J = (1.0 - sxx) * (1.0 - szz) - sxz * sxz;");
    L.push("  fold = clamp(1.0 - J, 0.0, 2.0);");
    L.push("  nrm = normalize(vec3(-ex, max(0.25, 1.0 - (sxx + szz)), -ez));");
    L.push("}");
    return L.join("\n");
  }
  CBZ.waterWaveDecl = waveFnGLSL;

  // LEGACY FORM, kept for callers that only want a height + slope (the flood
  // banks in world/tsunami_flow.js): emits statements DECLARING hName/dxName/
  // dzName from cbzWaveSum. The caller's program must include
  // CBZ.waterWaveDecl() (and so own uWaveRow/uWaveCtl, which
  // waterCommonUniforms provides). The horizontal Gerstner shift is ignored
  // here — a height field is what these callers ask for.
  CBZ.waterWaveGLSL = function (pExpr, tExpr, ampExpr, hName, dxName, dzName, chopExpr) {
    const L = [];
    L.push("float " + hName + " = 0.0;");
    L.push("float " + dxName + " = 0.0;");
    L.push("float " + dzName + " = 0.0;");
    L.push("{");
    L.push("  vec3 wvD; vec3 wvN; float wvF;");
    L.push("  vec2 wvP = " + pExpr + ";");
    L.push("  cbzWaveSum(wvP, " + tExpr + ", " + ampExpr + ", " + (chopExpr || ampExpr) +
      ", length(wvP - cameraPosition.xz), wvD, wvN, wvF);");
    L.push("  " + hName + " = wvD.y;");
    L.push("  " + dxName + " = -wvN.x / max(0.25, wvN.y);");
    L.push("  " + dzName + " = -wvN.z / max(0.25, wvN.y);");
    L.push("}");
    return L.join("\n");
  };

  // ============================================================
  //  3b. WHAT THE WATER TOUCHES — contact foam, river flow, the sky
  // ============================================================
  // Three inputs every water material reads by reference, gathered ONCE a
  // frame (sceneTick, stamp-guarded) no matter how many seas are drawn.
  //
  // CONTACT FOAM. A real sea is white where it meets anything: the wash
  // round a hull, the ring at a piling, the lather on a rock, the stir round
  // a swimmer. There is no depth pass in this forward r128 renderer, so the
  // contact is not read off a depth buffer — it is DECLARED: the six nearest
  // floating or standing things to the camera, each a capsule (centre, half
  // axis, radius, strength), from the registries that already know where
  // they are (marine hulls, the sea craft, the shark sim's pier and rocks,
  // every occupant of the water). CBZ.waterFoamSource(fn) adds a provider;
  // fn(push) calls push(x, z, hx, hz, radius, strength).
  //
  // RIVER FLOW. The city's rivers are carved out of the one sea (city/
  // river.js draws no water; the sea shows through), so the sea has to know
  // which way a river runs. The four channel segments nearest the camera are
  // uploaded; inside a channel the swell dies, the ripples are advected
  // downstream (two-phase flow map) and foam streaks run with the current.
  // The CPU twin (CBZ.waterFlowAt) reads the same four segments, so the
  // swell a swimmer feels dies exactly where the drawn one does.
  const water2 = new THREE.Vector4(1, 1, 0, 0);
  const FOAM_N = 6;
  const foamA = [], foamB = [];
  for (let i = 0; i < FOAM_N; i++) foamA.push(new THREE.Vector4(0, 0, 0, 0));
  for (let i = 0; i < FOAM_N / 2; i++) foamB.push(new THREE.Vector4(0, 0, 0, 0));
  const FLOW_N = 4;
  const flowA = [], flowB = [];
  for (let i = 0; i < FLOW_N; i++) flowA.push(new THREE.Vector4(0, 0, 1, 0));
  for (let i = 0; i < FLOW_N / 2; i++) flowB.push(new THREE.Vector4(0, 0, 0, 0));
  const RIVER_SPEED = 0.95;          // m/s, mid-channel surface current
  const RIVER_CALM = 0.15;           // the sea's swell inside a channel

  const foamProviders = [];
  CBZ.waterFoamSource = function (fn) {
    if (typeof fn === "function" && foamProviders.indexOf(fn) < 0) foamProviders.push(fn);
    return fn;
  };
  const cand = [];
  let candN = 0, candCx = 0, candCz = 0;
  function pushFoam(x, z, hx, hz, r, s) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(s > 0.01)) return;
    const dx = x - candCx, dz = z - candCz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 260 * 260) return;
    let c = cand[candN];
    if (!c) c = cand[candN] = { x: 0, z: 0, hx: 0, hz: 0, r: 0, s: 0, d2: 0 };
    c.x = x; c.z = z; c.hx = +hx || 0; c.hz = +hz || 0; c.r = Math.max(0.15, +r || 0.5); c.s = s; c.d2 = d2;
    candN++;
  }
  function hullFoam(rec, moving) {
    if (!rec || rec.dead || !rec.pos || rec._far) return;
    const sp = rec._hullSpec || null;
    const loa = sp && sp.loa > 0 ? sp.loa : 6.2, beam = sp && sp.beam > 0 ? sp.beam : 2.1;
    const h = +rec.heading || 0;
    const v = Math.abs(+rec.v || 0);
    pushFoam(rec.pos.x, rec.pos.z, Math.sin(h) * loa * 0.40, Math.cos(h) * loa * 0.40, beam * 0.5,
      0.30 + Math.min(0.65, v * 0.06) * (moving ? 1 : 0.5));
  }
  const _occ = [];
  let occTick = 0;
  function gatherFoam() {
    candN = 0;
    const cam = CBZ.camera;
    if (!cam) return;
    candCx = cam.position.x; candCz = cam.position.z;
    const cars = CBZ.cityCars;
    if (cars && cars.length) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || c.dead || !c.pos) continue;
        const marine = c._hullSpec || (c._playerCarFeel && c._playerCarFeel.marine) || (c.model && c.model.body === "boat");
        if (marine) hullFoam(c, true);
      }
    }
    if (CBZ.seaCraft && typeof CBZ.seaCraft.list === "function") {
      const L = CBZ.seaCraft.list() || [];
      for (let i = 0; i < L.length; i++) if (L[i] && !L[i]._sinking) hullFoam(L[i], true);
    }
    const S = CBZ.sharkSeaScene;
    if (S && S.built && S.group && S.group.visible && S.obstacles) {
      for (let i = 0; i < S.obstacles.length; i++) {
        const o = S.obstacles[i];
        if (o) pushFoam(o.x, o.z, 0, 0, o.r || 0.3, 0.55);
      }
    }
    if (typeof CBZ.waterOccupants === "function") {
      // the census is a walk over every ped and car: refresh it at ~20 Hz
      // and reuse it between (a swimmer moves centimetres a frame)
      let L = _occ;
      if ((++occTick % 3) === 1) { try { L = CBZ.waterOccupants(_occ); } catch (e) { L = null; } }
      if (L) for (let i = 0; i < L.length; i++) {
        const o = L[i];
        if (!o || o.kind === "boat") continue;
        if (!(o.submergence > 0.02) || o.submergence > 0.98) continue;   // must cut the surface
        const big = o.kind === "car";
        pushFoam(o.x, o.z, 0, 0, big ? 1.3 : 0.4, (o.moving ? 0.42 : 0.22) * (big ? 1.2 : 1));
      }
    }
    for (let i = 0; i < foamProviders.length; i++) {
      try { foamProviders[i](pushFoam); } catch (e) {}
    }
    // the FOAM_N nearest (by distance to the capsule surface)
    for (let k = 0; k < FOAM_N; k++) {
      let best = -1, bd = 1e30;
      for (let i = 0; i < candN; i++) {
        const c = cand[i];
        if (c.d2 < 0) continue;
        const reach = Math.sqrt(c.hx * c.hx + c.hz * c.hz) + c.r;
        const d = Math.sqrt(c.d2) - reach;
        if (d < bd) { bd = d; best = i; }
      }
      const A = foamA[k], B = foamB[k >> 1];
      if (best < 0) {
        A.set(0, 0, 0, 0);
        if (k & 1) { B.z = 0; B.w = 0; } else { B.x = 0; B.y = 0; }
        continue;
      }
      const c = cand[best];
      c.d2 = -1;
      // fade out before the slot can be lost to a nearer source, so a swap
      // never pops on screen
      const dd = Math.max(0, bd);
      const fade = 1 - Math.min(1, Math.max(0, (dd - 140) / 80));
      A.set(c.x, c.z, c.hx, c.hz);
      if (k & 1) { B.z = c.r; B.w = c.s * fade; } else { B.x = c.r; B.y = c.s * fade; }
    }
    water2.z = candN > 0 ? 1 : 0;
  }

  // ---- rivers ---------------------------------------------------------------
  let flowSegs = null, flowSrc = null;
  function riverSegments() {
    const list = typeof CBZ.cityRivers === "function" ? CBZ.cityRivers() : null;
    if (!list || !list.length) { flowSegs = null; flowSrc = null; return null; }
    if (flowSrc === list.length && flowSegs) return flowSegs;
    const segs = [];
    for (let r = 0; r < list.length; r++) {
      const rv = list[r];
      const p = rv && rv.pts, h = rv && rv.half;
      if (!p || p.length < 2) continue;
      for (let i = 0; i + 1 < p.length; i++) {
        const hw = Array.isArray(h) ? (h[i] + h[i + 1]) * 0.5 : (+h || 40);
        segs.push({ x0: p[i].x, z0: p[i].z, x1: p[i + 1].x, z1: p[i + 1].z, hw: hw, d: 0 });
      }
    }
    flowSegs = segs; flowSrc = list.length;
    return segs;
  }
  function gatherFlow() {
    const cam = CBZ.camera;
    const segs = CFG.WATER_RIVER_FLOW === false ? null : riverSegments();
    if (!cam || !segs || !segs.length) {
      for (let i = 0; i < FLOW_N; i++) flowA[i].set(0, 0, 1, 0);
      for (let i = 0; i < FLOW_N / 2; i++) flowB[i].set(0, 0, 0, 0);
      water2.w = 0;
      return;
    }
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz || 1;
      let t = ((cx - s.x0) * vx + (cz - s.z0) * vz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      s.d = Math.hypot(cx - s.x0 - vx * t, cz - s.z0 - vz * t) - s.hw;
    }
    let live = 0;
    const used = _usedSeg;
    used.length = 0;
    for (let k = 0; k < FLOW_N; k++) {
      let best = -1, bd = 1e30;
      for (let i = 0; i < segs.length; i++) {
        if (used.indexOf(i) >= 0) continue;
        if (segs[i].d < bd) { bd = segs[i].d; best = i; }
      }
      const B = flowB[k >> 1];
      if (best < 0 || bd > 1500) {
        flowA[k].set(0, 0, 1, 0);
        if (k & 1) { B.z = 0; B.w = 0; } else { B.x = 0; B.y = 0; }
        continue;
      }
      used.push(best);
      const s = segs[best];
      flowA[k].set(s.x0, s.z0, s.x1, s.z1);
      if (k & 1) { B.z = s.hw; B.w = RIVER_SPEED; } else { B.x = s.hw; B.y = RIVER_SPEED; }
      live++;
    }
    water2.w = live > 0 ? 1 : 0;
  }
  const _usedSeg = [];

  // CPU twin of cbzFlowAt(): (vx, vz) the surface current, f 0..1 how far
  // inside a channel. Same four segments the GPU has.
  CBZ.waterFlowAt = function (x, z, out) {
    out = out || {};
    out.x = 0; out.z = 0; out.f = 0;
    if (!(water2.w > 0.5)) return out;
    for (let k = 0; k < FLOW_N; k++) {
      const A = flowA[k], B = flowB[k >> 1];
      const hw = (k & 1) ? B.z : B.x, sp = (k & 1) ? B.w : B.y;
      if (!(hw > 0)) continue;
      const abx = A.z - A.x, abz = A.w - A.y, L2 = Math.max(abx * abx + abz * abz, 1);
      let t = ((x - A.x) * abx + (z - A.y) * abz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - A.x - abx * t, z - A.y - abz * t);
      const e0 = hw * 0.70, e1 = hw * 1.02;
      let u = (d - e0) / (e1 - e0); u = u < 0 ? 0 : u > 1 ? 1 : u;
      const f = 1 - u * u * (3 - 2 * u);
      if (f > out.f) {
        const q = d / hw, il = 1 / Math.sqrt(L2), v = sp * (1 - 0.55 * q * q);
        out.x = abx * il * v; out.z = abz * il * v; out.f = f;
      }
    }
    return out;
  };
  const _flowQ = { x: 0, z: 0, f: 0 };
  function riverAt(x, z) { return CBZ.waterFlowAt(x, z, _flowQ).f; }

  // GLSL twin, generated so the slot packing is constant-indexed.
  function flowGLSL() {
    const L = ["uniform vec4 uFlowA[" + FLOW_N + "];", "uniform vec4 uFlowB[" + (FLOW_N / 2) + "];",
      "vec3 cbzFlowAt(vec2 p) {", "  vec3 best = vec3(0.0);"];
    for (let k = 0; k < FLOW_N; k++) {
      const hs = "uFlowB[" + (k >> 1) + "]." + ((k & 1) ? "zw" : "xy");
      L.push("  { vec4 a = uFlowA[" + k + "]; vec2 hs = " + hs + ";");
      L.push("    if (hs.x > 0.0) {");
      L.push("      vec2 ab = a.zw - a.xy; float L2 = max(dot(ab, ab), 1.0);");
      L.push("      float tt = clamp(dot(p - a.xy, ab) / L2, 0.0, 1.0);");
      L.push("      float d = length(p - a.xy - ab * tt);");
      L.push("      float f = 1.0 - smoothstep(hs.x * 0.70, hs.x * 1.02, d);");
      L.push("      if (f > best.z) { float q = d / hs.x; best = vec3(ab * inversesqrt(L2) * hs.y * (1.0 - 0.55 * q * q), f); }");
      L.push("    } }");
    }
    L.push("  return best;", "}");
    return L.join("\n");
  }
  function foamGLSL() {
    const L = ["uniform vec4 uFoamA[" + FOAM_N + "];", "uniform vec4 uFoamB[" + (FOAM_N / 2) + "];",
      // n: 0..1 breakup noise (the caller's), returns 0..1 foam
      "float cbzContactFoam(vec2 p, float n) {", "  float f = 0.0;"];
    for (let k = 0; k < FOAM_N; k++) {
      const rs = "uFoamB[" + (k >> 1) + "]." + ((k & 1) ? "zw" : "xy");
      L.push("  { vec4 a = uFoamA[" + k + "]; vec2 rs = " + rs + ";");
      L.push("    if (rs.y > 0.0) {");
      L.push("      vec2 q = p - a.xy; float L2 = max(dot(a.zw, a.zw), 0.0001);");
      L.push("      float tt = clamp(dot(q, a.zw) / L2, -1.0, 1.0);");
      L.push("      float d = max(0.0, length(q - a.zw * tt) - rs.x);");
      L.push("      float w = 0.35 + rs.x * 0.45;");
      L.push("      f = max(f, rs.y * exp(-d / (w * (0.45 + n * 1.1))));");
      L.push("    } }");
    }
    L.push("  return clamp(f, 0.0, 1.0);", "}");
    return L.join("\n");
  }

  // ---- the sky the water sees ----------------------------------------------
  const skyRef = { tex: null, tint: new THREE.Color(1, 1, 1), top: null, bottom: null };
  function gatherSky() {
    skyRef.tex = null; skyRef.top = null; skyRef.bottom = null;
    const dome = CBZ.skyDome || (CBZ.micro && CBZ.micro.skyDome) || null;
    const m = dome && dome.material;
    if (!m) return;
    if (m.map && m.map.image) {
      skyRef.tex = m.map;
      skyRef.tint.copy(m.color || skyRef.tint.setRGB(1, 1, 1));
    } else if (m.uniforms && m.uniforms.topColor && m.uniforms.bottomColor) {
      // microboot's gradient dome: the analytic pair IS the sky
      skyRef.top = m.uniforms.topColor.value;
      skyRef.bottom = m.uniforms.bottomColor.value;
    }
  }

  let sceneStamp = -1;
  function sceneTick() {
    const stamp = CBZ.now || Math.floor((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.12);
    if (stamp === sceneStamp) return;
    sceneStamp = stamp;
    gatherFoam();
    gatherFlow();
    gatherSky();
    water2.x = CFG.WATER_CAUSTICS === false ? 0 : 1;
  }
  CBZ.waterSceneTick = sceneTick;

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
    /* THE TSUNAMI'S EDGE on the shared sea (2026-09-27): (cx, cz, dx, dz) of
       the live front and (frontS, aheadDrop, surge). Ahead of frontS the sea
       sits aheadDrop metres lower and its shoreline cut is taken from the
       surge that has actually arrived there, so a city street stays dry until
       the wall reaches it. aheadDrop 0 (the default) is a no-op everywhere. */
    u.uSeaFront = { value: new THREE.Vector4(0, 0, 1, 0) };
    u.uSeaFrontS = { value: new THREE.Vector3(-1e9, 0, 0) };
    u.uSeaLee = { value: new THREE.Vector4(0, 0, 0, 1) };
    u.uSeaLee2 = { value: new THREE.Vector4(20, 0, 0, 0) };
    u.uInlandBodies = { value: inlandVecs };
    // BY REFERENCE, like uInlandBodies: waterSyncLandBoxes() mutates the
    // Vector4s in place, so a world built after the material still reaches the
    // GPU without anything re-fetching the uniform block.
    u.uLandBoxes = { value: landVecs };
    // Local entries use the same Vector4 arrays in every material.  The impact
    // bus mutates the vectors in place, so no renderer-specific registration or
    // per-frame copy can let the mirror and shader seas drift apart.
    u.uWaterImpulses = { value: surfaceImpulses };
    u.uWaterImpulseShapes = { value: surfaceImpulseShapes };
    u.uDeepGain = { value: 1.0 };
    u.uChopGain = { value: 1.0 };
    // x = run-up range (m), y = leading-edge brightness gain, z = enabled
    u.uSwash = { value: new THREE.Vector4(SWASH_RANGE, 1.0, swashOn() ? 1 : 0, 0) };
    u.uLineFoam = { value: 1 };
    u.uMoonDir = { value: new THREE.Vector3(0.34, -0.84, -0.42).normalize() };
    u.uMoonColor = { value: new THREE.Color(0xa8c0e2) };
    u.uMoon = { value: 0 };
    // SHORE LIGHTS ON THE WATER (world/archipelago.js fills them after dark):
    // up to SEA_LAMPS lamp heads, xyz + gain, and their colour + count (w)
    u.uSeaLamps = { value: [] };
    for (let i = 0; i < SEA_LAMPS; i++) u.uSeaLamps.value.push(new THREE.Vector4(0, -1e4, 0, 0));
    u.uSeaLampC = { value: new THREE.Vector4(1.0, 0.72, 0.42, 0) };
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
    // BY REFERENCE: windTick() eases it toward the live weather wind (60 s
    // bearing constant, see WIND above), so every material turns together.
    u.uWindDir = { value: windDirShade };
    // ---- WATER V3 (2026-10-11) -------------------------------------------
    // The wave spectrum's live state (wind weights per row, Gerstner Q, LOD).
    u.uWaveRow = { value: rowWVecs };
    u.uWaveCtl = { value: waveCtl };
    // The sky the water reflects: the dome's own painted texture when there
    // is one (core/sky.js), sampled by the reflected ray, times the dome's
    // tint. xyz = tint, w = 1 when uSkyTex is live. Falls back to the
    // analytic uSkyLow/uSkyHigh pair, which is the dome at the horizon.
    u.uSkyTex = { value: null };
    u.uSkyTint = { value: new THREE.Vector4(1, 1, 1, 0) };
    // Caustics: the shared tile, and (x = gain on shallow floors seen from
    // above, y = crest subsurface gain, z = contact-foam on, w = river flow on)
    u.uCaustic = { value: CBZ.waterCausticTexture() };
    u.uWater2 = { value: water2 };
    // Contact foam (hulls, pilings, rocks, swimmers): capsules, by reference.
    u.uFoamA = { value: foamA };
    u.uFoamB = { value: foamB };
    // River flow: up to four channel segments near the camera, by reference.
    u.uFlowA = { value: flowA };
    u.uFlowB = { value: flowB };
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
    windTick();
    sceneTick();
    if (u.uSeaTime) u.uSeaTime.value = CBZ.waterClock();
    if (u.uSeaY && !u.fixedSeaY) u.uSeaY.value = seaY();
    // Surge -> how far inland the rendered waterline creeps. The ramp is
    // normalised, so this is a shape constant, not a distance: SHORE_CUT_PER_M
    // was chosen so a 1m surge moves the edge a plausible dozen-odd metres up
    // a shallow beach, and it saturates well before the ramp does so a huge
    // surge can never blank the whole land mask and flood the mountains.
    if (u.uShoreCut) {
      const sg = _surge > 0 ? _surge : 0;
      u.uShoreCut.value = 0.5 + Math.min(0.42, sg * SHORE_CUT_PER_M);
    }
    if (u.uSeaFront) {
      const e = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
      const lee = e && e.lee && e.lee.on ? e.lee : null;
      if (e && (e.aheadDrop > 0.001 || lee)) {
        u.uSeaFront.value.set(+e.cx || 0, +e.cz || 0, +e.dx || 0, +e.dz || 0);
        u.uSeaFrontS.value.set(Number.isFinite(e.frontS) ? +e.frontS : -1e9, Math.max(0, +e.aheadDrop || 0), _surge);
      } else u.uSeaFrontS.value.y = 0;
      if (u.uSeaLee) {
        if (lee) {
          u.uSeaLee.value.set(+lee.b || 0, +lee.a || 0, +lee.lc || 0, Math.max(1, +lee.lw || 1));
          u.uSeaLee2.value.set(Math.max(1, +lee.d0 || 20), +lee.sMid || 0, +lee.sMax || 0, 1);
        } else u.uSeaLee2.value.w = 0;
      }
    }

    // Direction TO the sun (light travels sun -> target, so it is target->sun),
    // plus its live dawn/dusk tint, straight from core/daynight.js.
    const sunT = CBZ.sunTarget || (CBZ.sun && CBZ.sun.target) || null;
    if (u.uSunDir && CBZ.sun && sunT) {
      _sunDir.copy(CBZ.sun.position).sub(sunT.position);
      if (_sunDir.lengthSq() > 1e-6) u.uSunDir.value.copy(_sunDir.normalize());
    }
    if (u.uSkyTint) {
      const tx = CFG.WATER_SKY_REFLECT === false ? null : skyRef.tex;
      if (tx) {
        // the equirect lookup runs both atan2 branches (see cbzSkyRadiance),
        // so the dome texture must wrap in u. Harmless for the dome itself:
        // its own u seam then filters across the join instead of clamping.
        if (tx.wrapS !== THREE.RepeatWrapping) { tx.wrapS = THREE.RepeatWrapping; tx.needsUpdate = true; }
        u.uSkyTex.value = tx;
        u.uSkyTint.value.set(skyRef.tint.r, skyRef.tint.g, skyRef.tint.b, 1);
      } else {
        u.uSkyTint.value.w = 0;
      }
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
    causticDrive(u);
    if (u.uClarity) {
      // Clarity is a live read, not a boot-time one, so ?cfg_SEA_TRANSLUCENT=0
      // and a runtime toggle land on the same frame. Rain silts the water:
      // heavy chop closes the window rather than opening a murky hole.
      u.uClarity.value.x = translucentOn() && !u.noClarity ? CLARITY * (1 - wet * 0.55) : 0.0;
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

  /* CPU twin: sampleSurfaceImpulses().  Returns (height, dH/dx, dH/dz), so the
     local cavity changes both silhouette and analytic normal.  A constant-size
     loop is WebGL1-safe; inactive slots carry amplitude zero and are multiplied
     away without dynamic array indexing or a vertex texture fetch. */
  const IMPULSE_FN = [
    "vec3 cbzEntryImpulse(vec2 p, float nowT) {",
    "  vec3 outV = vec3(0.0);",
    "  for (int i = 0; i < " + MAX_SURFACE_IMPULSES + "; i++) {",
    "    vec4 q = uWaterImpulses[i];",
    "    vec4 sh = uWaterImpulseShapes[i];",
    "    float age = nowT - q.z;",
    "    float live = step(0.0, age) * (1.0 - step(sh.z, age)) * step(0.0001, q.w);",
    "    float aT = clamp(age, 0.0, max(0.01, sh.z));",
    "    vec2 dp = p - q.xy;",
    "    float r2 = dot(dp, dp);",
    "    float r = sqrt(max(0.0, r2));",
    "    float rad = max(0.12, sh.x * (1.0 + aT * 0.18));",
    "    float invRad2 = 1.0 / (rad * rad);",
    "    float core = -q.w * exp(-2.6 * r2 * invRad2) * exp(-aT * 2.35);",
    "    float dCore = core * (-5.2 * r * invRad2);",
    "    float front = sh.x * 0.62 + sh.y * aT;",
    "    float sigma = max(0.16, sh.x * 0.34 + sh.y * aT * 0.055);",
    "    float u = (r - front) / sigma;",
    "    float crest = q.w * 0.34 * exp(-1.8 * u * u) * exp(-aT / max(0.01, sh.z));",
    "    float dCrest = crest * (-3.6 * u / sigma);",
    "    float dHdr = (dCore + dCrest) * live;",
    "    outV.x += (core + crest) * live;",
    "    if (r > 0.00001) {",
    "      outV.y += dp.x * dHdr / r;",
    "      outV.z += dp.y * dHdr / r;",
    "    }",
    "  }",
    "  return outV;",
    "}",
  ].join("\n");

  // Vertex stage needs no samplers (a sampler declared in the vertex program
  // can cost a vertex texture unit, and WebGL1 is allowed to expose zero) —
  // which is exactly why the depth term above is a uniform circle set rather
  // than a fetch from the baked shore field the FRAGMENT stage uses.
  /* THE SEA'S LEVEL UNDER A TRAVELLING WAVE (2026-10-20). Owner: "the
     tsunami seems to come from all sides of the island and meet in the
     middle". It did: the sea behind the straight front was ONE level, so the
     moment the line had passed the island's flanks and its far shore, every
     coast was under the same head of water and the run-up poured in from all
     of them. A real tsunami arriving from one bearing hits the FACING coast
     first and hardest, runs along the flanks at a glancing angle (less), and
     the lee only gets a small, late wrap-around (refraction/diffraction).
     So the drop below the published mean has two terms:
       ahead  the water the front has not reached yet (aheadDrop, as before);
       lee    the island's shadow: a smooth exposure field off the island's
              own extent along and across the travel (cbzLeeShadow), times a
              lee drop for the water behind the front (Lb) and ahead of it
              (La, signed: negative RAISES the lee, which is how the drawdown
              reaches the facing shelf first and the lee later and less).
     CPU twin: frontFormulaDrop() below. Same constants, same shape.
       uSeaFront  (cx, cz, dx, dz)     uSeaFrontS (frontS, aheadDrop, surge)
       uSeaLee    (Lb, La, lc, Lw)     uSeaLee2   (D0, sMid, sMax, on)       */
  const LEE_EXP = 1.3, LEE_SPREAD = 0.35;
  // the shadow alone, on explicit parameters (world/tsunami_scene.js's
  // seabed skin declares its own uniforms and calls this)
  const LEE_GLSL = CBZ.waterLeeGLSL = [
    "float cbzLeeShadowP(vec2 xz, vec4 F, vec4 L, vec4 L2) {",
    "  vec2 r = xz - F.xy;",
    "  float s = dot(r, F.zw);",
    "  float rl = dot(r, vec2(-F.w, F.z)) - L.z, rs = s - L2.y;",
    "  float e = pow(clamp(0.5 - 0.5 * rs / max(length(vec2(rl, rs)), 1.0), 0.0, 1.0), " + gnum(LEE_EXP) + ");",
    "  float D = L2.x + " + gnum(LEE_SPREAD) + " * max(0.0, s - L2.z);",
    "  return (1.0 - e) * (1.0 - smoothstep(L.w, L.w + D, abs(rl)));",
    "}",
  ].join("\n");
  // CPU side of the same uniforms: (front vec4, lee vec4, lee2 vec4) from the event
  CBZ.waterLeeUniformsFill = function (F, L, L2) {
    const e = waterEvent, lee = e && e.lee && e.lee.on ? e.lee : null;
    if (!lee) { L2.w = 0; return false; }
    F.set(+e.cx || 0, +e.cz || 0, +e.dx || 0, +e.dz || 0);
    L.set(+lee.b || 0, +lee.a || 0, +lee.lc || 0, Math.max(1, +lee.lw || 1));
    L2.set(Math.max(1, +lee.d0 || 20), +lee.sMid || 0, +lee.sMax || 0, 1);
    return true;
  };
  const FRONT_DROP_GLSL = [
    "uniform vec4 uSeaFront;",
    "uniform vec3 uSeaFrontS;",
    "uniform vec4 uSeaLee;",
    "uniform vec4 uSeaLee2;",
    LEE_GLSL,
    "float cbzLeeShadow(vec2 xz) { return cbzLeeShadowP(xz, uSeaFront, uSeaLee, uSeaLee2); }",
    "float cbzFrontDrop(vec2 xz) {",
    "  if (uSeaFrontS.y < 0.001 && uSeaLee2.w < 0.5) return 0.0;",
    "  float fk = clamp((dot(xz - uSeaFront.xy, uSeaFront.zw) - uSeaFrontS.x + 1.0) / 8.0, 0.0, 1.0);",
    "  fk = fk * fk * (3.0 - 2.0 * fk);",
    "  float d = max(uSeaFrontS.y, 0.0) * fk;",
    "  if (uSeaLee2.w > 0.5) d += cbzLeeShadow(xz) * mix(uSeaLee.x, uSeaLee.y, fk);",
    "  return d;",
    "}",
  ].join("\n");
  CBZ.waterVertexDecl = function () {
    return [
      "uniform float uSeaTime;",
      "uniform float uSeaY;",
      FRONT_DROP_GLSL,
      "uniform float uWaveAmp;",
      "uniform float uDeepGain;",
      "uniform float uChopGain;",
      "uniform vec4 uInlandBodies[" + MAX_INLAND + "];",
      "uniform vec4 uLandBoxes[" + MAX_LAND + "];",
      "uniform vec4 uWaterImpulses[" + MAX_SURFACE_IMPULSES + "];",
      "uniform vec4 uWaterImpulseShapes[" + MAX_SURFACE_IMPULSES + "];",
      // Cosine of the surface tilt (== wNormal.y). Written by waterVertexBody()
      // and read by cbzWhitecap() in the fragment stage, so foam can sit on the
      // TIP of a crest without changing any shared function's signature.
      "varying float vCbzSteep;",
      // 1 - Jacobian of the Gerstner sum: the crests that are about to break
      "varying float vCbzFold;",
      INLAND_FN,
      DEEP_FN,
      IMPULSE_FN,
      waveFnGLSL(),
      flowGLSL(),
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
      "  float calm = mix(1.0, " + gnum(INLAND_CALM) + ", cbzInlandFactor(p)) * mix(1.0, " + gnum(RIVER_CALM) + ", cbzFlowAt(p).z);",
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
      FRONT_DROP_GLSL,
      // the shoreline cut where the surge has actually arrived (see uSeaFront)
      "float cbzShoreCutAt(vec2 xz) {",
      "  if (uSeaFrontS.y < 0.001 && uSeaLee2.w < 0.5) return uShoreCut;",
      "  return 0.5 + min(0.42, max(0.0, uSeaFrontS.z - cbzFrontDrop(xz)) * " + gnum(SHORE_CUT_PER_M) + ");",
      "}",
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
      "uniform float uLineFoam;",
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
      /* ================= THE ONE SEA SHADE (WATER V3) ====================
         Every water surface in the game — the city ocean, its rivers and
         lakes, the survival / shark-sim sea, NPC War's seas, the pools — ends
         in this one function. It used to be three hand-diverged main()s (the
         city shader sea, the planar-mirror graft on the vendor Water shader,
         and the disaster sea) plus two private Phong sheets in NPC War, each
         missing what the others had. What it adds over all of them:
           • the reflected sky is the DOME'S OWN PAINTED SKY (clouds and all),
             sampled along the reflected ray, pre-filtered by roughness — the
             thing the half-rate planar mirror existed to provide, without a
             second render of anything;
           • a turquoise subsurface glow through thin backlit crests;
           • caustics dancing on shallow sand seen through the surface;
           • foam that comes from the WAVES: the Gerstner fold (Jacobian) at
             breaking crests, the depth-driven surf line, and contact foam
             against every hull, piling, rock and swimmer (cbzContactFoam);
           • river channels that flow (advected ripples + streaks);
           • from BELOW, a real Snell's window: refract() decides, so total
             internal reflection is exact, softened by the surface roughness.
         Returns rgb, and the foam fraction in .a (the caller turns it into
         cbzSeaAlpha). tirCol is the colour of the water column a swimmer sees
         mirrored outside the window (the live underwater fog colour). */
      "uniform sampler2D uSkyTex;",
      "uniform vec4 uSkyTint;",
      "uniform sampler2D uCaustic;",
      "uniform vec4 uWater2;",
      "varying float vCbzFold;",
      flowGLSL(),
      foamGLSL(),
      // The dome is an equirect sphere (three's SphereGeometry UVs): u from
      // atan2(z, -x), v from acos(y), horizon at v = 0.5. The atan2 branch cut
      // would print a mip seam down one bearing, so a quad that straddles it
      // switches to the other branch (the texture wraps; same texel).
      "vec3 cbzSkyRadiance(vec3 R, float rough) {",
      "  vec3 a = cbzSkyTone(R, rough * 0.12);",
      "  if (uSkyTint.w > 0.5) {",
      "    vec3 d = normalize(vec3(R.x, max(R.y, 0.02), R.z));",
      "    float u = atan(d.z, -d.x) * 0.15915494 + 0.5;",
      "    float u2 = fract(u + 0.5) - 0.5;",
      "    if (fwidth(u) > 0.25) u = u2;",
      "    vec2 uv = vec2(u, 1.0 - acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);",
      "    vec3 tx = texture2D(uSkyTex, uv, rough * 4.0).rgb * uSkyTint.rgb;",
      "    a = mix(tx, a, clamp(rough * 0.55, 0.0, 1.0));",
      "  }",
      "  return a;",
      "}",
      // two drifting, rotated taps of the shared caustic tile, min'd: the
      // classic non-repeating light web on a sandy floor
      "float cbzCausticAt(vec2 p, float t) {",
      "  vec2 a = p * 0.21 + vec2(t * 0.031, t * 0.017);",
      "  vec2 b = vec2(p.y, -p.x) * 0.17 + vec2(-t * 0.023, t * 0.029);",
      "  float c = min(texture2D(uCaustic, a).r, texture2D(uCaustic, b).r);",
      "  return c * c * 1.6;",
      "}",
      // two-phase flow map: the ripple tile dragged downstream on two
      // staggered clocks, cross-faded so neither ever visibly resets
      "vec4 cbzFlowDetail(vec2 p, vec2 v, float dist) {",
      "  float T = 5.0;",
      "  float ph0 = fract(uSeaTime / T);",
      "  float ph1 = fract(uSeaTime / T + 0.5);",
      "  float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);",
      "  vec2 o0 = v * (ph0 * T); vec2 o1 = v * (ph1 * T);",
      "  vec3 n0 = texture2D(uSeaNormal, (p - o0) * 0.085).rgb * 2.0 - 1.0;",
      "  vec3 n1 = texture2D(uSeaNormal, (p - o1) * 0.085 + 0.37).rgb * 2.0 - 1.0;",
      "  vec3 n = n0 * w0 + n1 * (1.0 - w0);",
      "  float fd = 1.0 - smoothstep(60.0, 420.0, dist);",
      "  vec3 nrm = normalize(vec3(n.r * 0.60 * fd, 1.0, n.g * 0.60 * fd));",
      "  vec2 dv = v / max(0.001, length(v)); vec2 dq = vec2(-dv.y, dv.x);",
      "  float s0 = texture2D(uSeaNormal, vec2(dot(p - o0, dv) * 0.011, dot(p, dq) * 0.12)).r;",
      "  float s1 = texture2D(uSeaNormal, vec2(dot(p - o1, dv) * 0.011, dot(p, dq) * 0.12) + 0.5).r;",
      "  float st = smoothstep(0.60, 0.80, s0 * w0 + s1 * (1.0 - w0)) * 0.30 * fd;",
      "  return vec4(nrm, st);",
      "}",
      // --- SHORE LIGHTS ON THE WATER ---------------------------------------
      // The street lamps along a waterfront, mirrored by the same rough
      // surface that makes the moon path: a Blinn lobe per lamp off the live
      // ripple normal, so each one lays a broken vertical streak toward you.
      // Inert (one compare) unless a caller fills uSeaLampC.w.
      "uniform vec4 uSeaLamps[" + SEA_LAMPS + "];",
      "uniform vec4 uSeaLampC;",
      "vec3 cbzLampGlints(vec3 N, vec3 V, vec3 P, float fres) {",
      "  float acc = 0.0;",
      "  for (int i = 0; i < " + SEA_LAMPS + "; i++) {",
      "    if (float(i) >= uSeaLampC.w) break;",
      "    vec4 Lp = uSeaLamps[i];",
      "    vec3 Ld = Lp.xyz - P;",
      "    float dl = length(Ld);",
      "    vec3 H = normalize(Ld / max(dl, 0.01) + V);",
      "    float nh = max(dot(N, H), 0.0);",
      "    float s = pow(nh, 36.0) * 0.30 + pow(nh, 320.0) * 2.2;",
      "    acc += s * Lp.w / (1.0 + dl * 0.012);",
      "  }",
      "  return uSeaLampC.rgb * (acc * (0.25 + fres * 1.6));",
      "}",
      "vec4 cbzShadeSea(vec3 P, vec3 Ng, float hN, float fold, float dist, float fade,",
      "                 vec4 field, float inland, float under, vec3 deepCol, vec3 tirCol) {",
      "  vec2 p = P.xz;",
      "  vec3 flow = vec3(0.0);",
      "  if (uWater2.w > 0.5) flow = cbzFlowAt(p);",
      "  inland = max(inland, flow.z * 0.8);",
      "  float calm = cbzShoreCalm(field);",
      "  float lane = cbzLane(p);",
      "  float detail = mix(0.60, 0.16, smoothstep(90.0, 1500.0, dist)) * mix(1.0, 0.42, inland) * (1.0 + uChop * 0.5);",
      "  vec3 N = cbzSeaNormal(Ng, p, dist, detail, calm, lane);",
      "  float streak = 0.0;",
      "  if (flow.z > 0.01) {",
      "    vec4 fl = cbzFlowDetail(p, flow.xy, dist);",
      "    N = normalize(mix(N, fl.xyz, flow.z));",
      "    streak = fl.w * flow.z;",
      "  }",
      "  vec3 V = normalize(cameraPosition - P);",
      "  N = mix(N, -N, under);",
      "  vec3 L = normalize(uSunDir);",
      "  float ndl = max(dot(N, L), 0.0);",
      "  float ndv = dot(N, V);",
      "  float rgh = cbzRough(dist, ndv);",
      "  float fres = cbzFresnel(ndv, dist);",
      "  float sunUp = smoothstep(-0.05, 0.25, L.y);",
      "  vec3 body = cbzDepthColor(deepCol, field, inland);",
      "  vec3 base = body * vec3(0.95, 1.06, 1.03) + vec3(0.003, 0.012, 0.018);",
      "  base *= 0.63 + ndl * 0.37;",
      // light through a thin crest: looking toward the sun, the tip of a wave
      // glows the colour of shallow water
      "  float crest = smoothstep(0.05, 0.85, hN) + clamp(fold, 0.0, 1.0) * 0.6;",
      "  float back = pow(clamp(dot(V, -normalize(L + N * 0.45)), 0.0, 1.0), 3.0);",
      "  base += uShallowColor * (back * crest * 0.11 * uWater2.y * sunUp * (1.0 - inland * 0.6));",
      // light on a shallow floor, seen through the surface
      "  float shallow = pow(clamp(field.g, 0.0, 1.0), 1.6) * (1.0 - inland * 0.6);",
      "  if (uWater2.x > 0.5 && shallow > 0.01 && under < 0.5 && dist < 160.0) {",
      "    base += uSunColor * (cbzCausticAt(p, uSeaTime) * shallow * 0.13 * sunUp * (1.0 - smoothstep(35.0, 160.0, dist)));",
      "  }",
      "  vec3 R = reflect(-V, N);",
      "  vec3 sky = cbzSkyRadiance(R, rgh) * " + gnum(REFL_GAIN) + " * mix(0.80, 1.22, lane);",
      "  sky = mix(sky, uSunColor * 0.34 + sky * 0.70, 0.22);",
      "  vec3 outColor = mix(base, sky, fres * 0.90 * mix(1.0, 0.55, inland));",
      "  outColor += cbzSunGlitter(N, V, L, fres, fade) * mix(1.0, 0.30, inland);",
      "  outColor += cbzSheen(N, V, L, lane, dist, fres) * mix(1.0, 0.35, inland);",
      "  if (uSeaLampC.w > 0.5 && under < 0.5) outColor += cbzLampGlints(N, V, P, fres) * mix(1.0, 0.5, inland);",
      // ---- foam: what the waves make, what the shore makes, what things make
      "  float n = texture2D(uSeaNormal, p * 0.13 + vec2(uSeaTime * 0.011, -uSeaTime * 0.007)).g;",
      "  float surf = cbzSurf(p, field, hN, fade);",
      "  float cap = cbzWhitecap(p, hN, fade, inland);",
      "  float brk = smoothstep(0.10, 0.45, fold) * (0.45 + n * 1.0) * fade * (1.0 - inland);",
      "  float contact = (uWater2.z > 0.5 && dist < 240.0) ? cbzContactFoam(p, n) : 0.0;",
      // uLineFoam: 1 everywhere but a disaster soup, whose white water is
      // drawn as clumps by its own tail (the crest lines read as a net of
      // thin white lines over a brown sea)
      "  float foam = clamp((surf * 0.66 + cap * 0.60 + brk * 0.55 + streak) * uLineFoam + contact * 0.80, 0.0, 0.94) * (1.0 - under * 0.72);",
      // foam is lace, not paint: thin where it is thin
      "  float lace = smoothstep(0.30, 0.80, n + foam * 0.55);",
      "  vec3 foamCol = uFoamColor * (0.80 + 0.20 * ndl);",
      // ---- from below: Snell's window, decided by refract() itself
      "  if (under > 0.5) {",
      "    float cw = clamp(dot(N, V), 0.0, 1.0);",
      "    float k = 1.0 - 1.7769 * (1.0 - cw * cw);",
      "    float win = smoothstep(-0.06, 0.32, k);",
      "    vec3 rt = refract(-V, N, 1.333);",
      "    vec3 ru = normalize(rt + vec3(0.0, 0.002, 0.0));",
      "    vec3 skyW = cbzSkyTone(ru, 0.1) * 1.05 + uSunColor * (pow(max(dot(ru, L), 0.0), 48.0) * 0.6 * sunUp);",
      "    outColor = mix(tirCol, mix(outColor, skyW, 0.86), win);",
      "  }",
      "  outColor = mix(outColor, foamCol, foam * mix(0.62, 1.0, lace));",
      "  return vec4(outColor, foam);",
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
  // Outer radius clears the flight fog: from altitude city/mode.js closes the
  // world at up to 11 km of view DEPTH, and the fog is a DEPTH (planar), so
  // at a frame corner ~55 degrees off the axis that depth is ~19 km of
  // radius. 32 km keeps the rim past it at any lens the game uses, so the
  // fog finishes the sea (onto the sky's horizon colour) before the rim or
  // the far plane can show; nothing paints the far sea to the fog by hand.
  // (It was 15 km behind a "horizon fuse" that forced the sea to fog colour
  // by 6.4 km while the land fogged out at 11: the coast across the water
  // stood in a pale band above the sea's end, a fake horizon.) The rings
  // grow geometrically, so the reach costs rings only out there: RING_REF
  // keeps every ring inside 4.5 km exactly where it was.
  const OUTER_R = 32000, RING_REF_R = 4500;

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
    const NR = Math.max(8, (opts.rings | 0) ||
      Math.round(p.rings * (opts.outerRadius > 0 ? 1 : Math.log(OUTER_R / INNER_R) / Math.log(RING_REF_R / INNER_R))));
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
  // opts.arena: amplitudes come from uDisasterAmp/uDisasterChop (the island's
  // explicit sea state) instead of the city's coast/lake/depth field, and the
  // city's tsunami-front drop is left to the caller (the island has its own).
  CBZ.waterVertexBody = function (wp0Expr, opts) {
    const arena = !!(opts && opts.arena);
    const L = [];
    L.push("vec4 wBase = " + wp0Expr + ";");
    // opts.worldXZ: the geometry is already laid out in world XZ (a fixed
    // grid, not the camera-centred disc), so it is not re-centred
    L.push(opts && opts.worldXZ ? "vec2 wXZ = wBase.xz;" : "vec2 wXZ = vec2(cameraPosition.x + wBase.x, cameraPosition.z + wBase.z);");
    L.push("float wDist = length(wXZ - cameraPosition.xz);");
    L.push(arena ? "float wInland = 0.0;" : "float wInland = cbzInlandFactor(wXZ);");
    L.push("float wFade = mix(1.0, " + gnum(FADE_FLOOR) + ", smoothstep(" + gnum(FADE_NEAR) + ", " + gnum(FADE_FAR) + ", wDist));");
    L.push(arena
      ? "vec3 wAmp3 = vec3(uDisasterAmp, uDisasterChop, max(0.0001, max(uDisasterAmp, uDisasterChop)));"
      : "vec3 wAmp3 = cbzWaveAmp3(wXZ, wDist);");
    L.push("vec3 wDisp; vec3 wGN; float wFold;");
    L.push("cbzWaveSum(wXZ, uSeaTime, wAmp3.x, wAmp3.y, wDist, wDisp, wGN, wFold);");
    L.push("float wHeight = wDisp.y;");
    L.push("vec3 wEntryImp = cbzEntryImpulse(wXZ, uSeaTime);");
    L.push("wHeight += wEntryImp.x;");
    // Normalised crest height (+-1 at the theoretical peak) so every threshold
    // downstream — whitecaps, surf gain, spray — is expressed in one unit and
    // keeps working if the amplitude table is retuned. wAmp3.z divides the
    // DEEP gain back out (and only that), so the open ocean's 2.7x-taller
    // crests still report +-1 while the distance fade and the lake calm keep
    // shrinking the reported crest exactly as they always did.
    L.push("float wHeightN = wHeight * " + gnum(1 / TOTAL_AMP) + " / max(0.0001, wAmp3.z);");
    // Gerstner: the vertex MOVES horizontally toward each crest, which is
    // what sharpens crests and flattens troughs. The entry impulse's slope is
    // added to the shading normal at the swell's own exaggeration.
    L.push("vec3 wWorld = vec3(wXZ.x + wDisp.x, wBase.y + wHeight" + (arena ? "" : " - cbzFrontDrop(wXZ)") + ", wXZ.y + wDisp.z);");
    L.push("vec3 wNormal = normalize(wGN - vec3(wEntryImp.y, 0.0, wEntryImp.z) * " + gnum(NORMAL_GAIN_SWELL) + " * wGN.y);");
    // The fragment stage's whitecap tip test rides on this (see cbzWhitecap).
    L.push("vCbzSteep = wNormal.y;");
    L.push("vCbzFold = wFold;");
    return L.join("\n");
  };

  // ============================================================
  //  8b. THE ONE SEA MATERIAL
  // ============================================================
  // Every sea, lake, river and flood sheet in the game is built here, in one
  // of three geometry modes that share every line of shading:
  //
  //   "city"      the camera-centred radial disc; amplitude from the coast /
  //               lake / depth field (cbzWaveAmp3); the baked city shore field
  //               discards dry land.
  //   "arena"     the same disc, amplitude from the island's explicit sea state
  //               (uDisasterAmp/uDisasterChop); the island's own baked field.
  //               opts.vertexTail / opts.fragTail let the disaster sea add its
  //               dry disc, its tsunami front and its sediment load.
  //   "external"  geometry the CALLER displaces (or a flat sheet): position and
  //               normal are used as given. What NPC War's seas are, and any
  //               page that owns its own swell function.
  //
  // opts: { kind, name, fieldTex, fieldBounds, uniforms, vertexDecl, vertexTail,
  //         fragDecl, fragTail, fogScale, horizonFuse (page seas only), transparent }
  // (no horizon fuse: the sea wears the scene's one air like the land does,
  // core/renderer.js's fog chunk, and the air itself ends on the sky colour)
  // Returns the ShaderMaterial; its live uniform block is mat.userData.waterUniforms.
  CBZ.waterSeaMaterial = function (opts) {
    opts = opts || {};
    const kind = opts.kind === "arena" || opts.kind === "external" ? opts.kind : "city";
    const U = opts.uniforms || CBZ.waterCommonUniforms();
    if (opts.fieldTex) {
      U.uSeaLandMask.value = opts.fieldTex;
      if (opts.fieldBounds) U.uSeaLandBounds.value.copy(opts.fieldBounds);
      U.uSeaHasLandMask.value = 1;
    }
    if (!U.uSeaOpacity) U.uSeaOpacity = { value: 1 };
    if (kind === "external" && !U.uClip) U.uClip = { value: new THREE.Vector4(0, 0, -1, 0) };
    const VARY = [
      "varying vec3 vSeaWorld;",
      "varying vec3 vSeaNormal;",
      "varying vec4 vSeaMisc;",          // x crest height (+-1), y distance, z far fade, w inland
    ].join("\n");
    const body = kind === "external" ? [
      "  vec4 wB = modelMatrix * vec4(position, 1.0);",
      "  vec3 wWorld = wB.xyz;",
      "  vec3 wNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);",
      "  float wDist = length(wWorld.xz - cameraPosition.xz);",
      "  float wFade = mix(1.0, " + gnum(FADE_FLOOR) + ", smoothstep(" + gnum(FADE_NEAR) + ", " + gnum(FADE_FAR) + ", wDist));",
      "  float wHeightN = clamp((wWorld.y - uSeaY) / 0.8, -1.0, 1.0);",
      "  float wInland = 0.0;",
      "  vCbzSteep = wNormal.y;",
      "  vCbzFold = 0.0;",
    ].join("\n") : CBZ.waterVertexBody("modelMatrix * vec4(position, 1.0)", { arena: kind === "arena", worldXZ: !!opts.worldXZ });
    const fogScale = Number.isFinite(opts.fogScale) ? opts.fogScale : (kind === "city" ? 0.66 : 1.0);
    const vs = [
      CBZ.waterVertexDecl(),
      kind === "arena" ? "uniform float uDisasterAmp;\nuniform float uDisasterChop;" : "",
      opts.vertexDecl || "",
      VARY,
      "#include <fog_pars_vertex>",
      "void main() {",
      body,
      opts.vertexTail || "",
      "  vSeaWorld = wWorld;",
      "  vSeaNormal = wNormal;",
      "  vSeaMisc = vec4(wHeightN, wDist, wFade, wInland);",
      "  vec4 mvPosition = viewMatrix * vec4(wWorld, 1.0);",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      // Ocean atmosphere accumulates more slowly than city-block fog.
      fogScale !== 1 ? "  #ifdef USE_FOG\n    fogDepth *= " + gnum(fogScale) + ";\n  #endif" : "",
      "}",
    ].join("\n");
    const cut = kind === "city"
      ? "  if (uSeaHasLandMask > 0.5 && field.r > cbzShoreCutAt(vSeaWorld.xz)) discard;"
      : kind === "arena"
        ? "  if (uSeaHasLandMask > 0.5 && field.r > uShoreCut" + (opts.cutGuard ? " && " + opts.cutGuard : "") + ") discard;"
        : "  if (uClip.z > 0.0 && abs(vSeaWorld.x - uClip.x) < uClip.z && abs(vSeaWorld.z - uClip.y) < uClip.z) discard;";
    const fs = [
      CBZ.waterFragmentDecl(),
      "uniform float uSeaOpacity;",
      kind === "external" ? "uniform vec4 uClip;" : "",
      opts.fragDecl || "",
      VARY,
      "#include <fog_pars_fragment>",
      "void main() {",
      "  vec4 field = cbzWaterField(vSeaWorld.xz);",
      opts.fragHead || "",
      cut,
      "  float inland = max(vSeaMisc.w, field.a);",
      "  float under = gl_FrontFacing ? 0.0 : 1.0;",
      // outside Snell's window a swimmer sees the water column mirrored: the
      // live medium (water_underwater.js writes the fog off the depth ramp)
      "  #ifdef USE_FOG",
      "    vec3 cbzTir = fogColor * 0.55;",
      "  #else",
      "    vec3 cbzTir = uSeaColor * 0.34;",
      "  #endif",
      "  vec4 sh = cbzShadeSea(vSeaWorld, vSeaNormal, vSeaMisc.x, vCbzFold, vSeaMisc.y, vSeaMisc.z, field, inland, under, uSeaColor, cbzTir);",
      "  vec3 outColor = sh.rgb;",
      "  float foam = sh.a;",
      "  float solid = foam;",
      "  vec3 V = normalize(cameraPosition - vSeaWorld);",
      // a tail's own coverage (a flood's shallow margin): 1 = the sea's alpha
      "  float outAlpha = 1.0;",
      opts.fragTail || "",
      // (an adopted page sea, water_pages.js, still asks for the old fuse:
      // NPC War's plates were sized against it)
      opts.horizonFuse === true ?
        "  #ifdef USE_FOG\n  outColor = mix(outColor, fogColor, smoothstep(3600.0, 6400.0, vSeaMisc.y));\n  #endif" : "",
      "  gl_FragColor = vec4(outColor, uSeaOpacity * cbzSeaAlpha(V, vSeaMisc.y, under, solid) * outAlpha);",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    const clear = translucentOn() || opts.transparent === true || U.uSeaOpacity.value < 0.999;
    const mat = new THREE.ShaderMaterial({
      name: opts.name || "CBZ Water",
      uniforms: U,
      vertexShader: vs,
      fragmentShader: fs,
      fog: true,
      transparent: clear,
      // depthWrite STAYS ON while blending: the sea owns its depth; it just
      // draws after the opaque bodies it has to show through.
      depthWrite: opts.depthWrite == null ? true : !!opts.depthWrite,
      depthTest: true,
      side: THREE.DoubleSide,           // you can swim UNDER every sea
      extensions: { derivatives: true },
    });
    mat.userData.waterUniforms = U;
    mat.userData.waterKind = kind;
    mat.userData.waterMode = "water-v3-" + kind;
    // a shaft dug through the ground must see through the sea as well
    if (CBZ.groundMaskAttach) { try { CBZ.groundMaskAttach(mat); } catch (e) {} }
    seaMaterials.push(mat);
    return mat;
  };
  // every sea material built, so one tick can drive the ones nobody else does
  const seaMaterials = [];
  CBZ.waterSeaMaterials = function () { return seaMaterials; };

  // ============================================================
  //  8c. A BAKED SHORE FIELD FOR ANY HEIGHTFIELD WORLD
  // ============================================================
  // The city bakes its shore field from its coastline oracle (city/world.js).
  // Any other world with a ground function gets the same four channels here,
  // so its sea has surf lines, a depth-graded colour, caustic shallows and a
  // land cut. Channels, by DEPTH (the honest quantity) rather than distance:
  //   R  0.5 - depth/8 m: > 0.5 is dry land (the cut moves with sea level:
  //      uShoreCut = 0.5 + (surge + margin)/8, see waterFieldCut)
  //   G  surf proximity: 1 at the waterline, 0 by 2.4 m of water — breakers
  //      live where the depth is about their own height
  //   B  openness: depth / 30 m
  //   A  0 (no lake flag)
  // Baked INCREMENTALLY (rows per call to step()), so a 512^2 field never
  // lands on one frame. Until it completes the texture reads "deep" (open
  // water), which is exactly the sea that was there before.
  const FIELD_RANGE = 8.0;
  CBZ.waterFieldCut = function (surge, margin) {
    return 0.5 + ((+surge || 0) + (margin == null ? 0.6 : +margin)) / FIELD_RANGE;
  };
  CBZ.waterBakeField = function (o) {
    o = o || {};
    const N = Math.max(64, Math.min(1024, o.size | 0 || 512));
    const cx = +o.cx || 0, cz = +o.cz || 0, half = Math.max(50, +o.half || 800);
    const groundAt = o.groundAt, seaY = Number.isFinite(+o.seaY) ? +o.seaY : 0;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 255; data[i * 4 + 3] = 0; }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const bounds = new THREE.Vector4(cx - half, cz - half, cx + half, cz + half);
    let row = 0;
    const h = {
      tex: tex, bounds: bounds, done: typeof groundAt !== "function", baked: true,
      // bake for at most `ms` milliseconds (whole rows); true when complete.
      // Time-sliced rather than row-counted: a ground function's cost is the
      // world's business, and the frame budget is ours.
      step: function (ms) {
        if (h.done) return true;
        const now = function () { return typeof performance !== "undefined" ? performance.now() : Date.now(); };
        const until = now() + Math.max(0.5, +ms || 2);
        for (; row < N; row++) {
          if (now() > until) break;
          // texel centres: DataTexture row 0 is v = 0 (flipY is false)
          const z = cz - half + (row + 0.5) / N * half * 2;
          for (let c = 0; c < N; c++) {
            const x = cx - half + (c + 0.5) / N * half * 2;
            let g = +groundAt(x, z);
            if (!Number.isFinite(g)) g = seaY - 60;
            const depth = seaY - g;
            const r = Math.max(0, Math.min(1, 0.5 - depth / FIELD_RANGE));
            const gg = depth <= 0 ? 1 : Math.max(0, 1 - depth / 2.4);
            const b = Math.max(0, Math.min(1, depth / 30));
            const q = (row * N + c) * 4;
            data[q] = Math.round(r * 255); data[q + 1] = Math.round(gg * 255);
            data[q + 2] = Math.round(b * 255); data[q + 3] = 0;
          }
        }
        if (row >= N) { h.done = true; tex.needsUpdate = true; }
        return h.done;
      },
    };
    return h;
  };

  // ============================================================
  //  9. MODE-SCOPED DISASTER WATER
  // ============================================================
  // The survival / shark-sim sea: the ONE sea material in "arena" mode on the
  // same camera-centred radial disc as the city (it used to be a 2 km square
  // grid snapped under the camera at 8-22 m per vertex, too coarse to carry a
  // single wind wave). The disc is built with the city's ring growth for the
  // live tier, so the wave sum's LOD is the same on both.
  CBZ.waterBuildDisasterGeometry = function (span, segments) {
    const outer = Math.max(400, (+span || 2048) * 0.78);
    const p = CBZ.waterTierParams();
    const NRc = Math.max(8, Math.round(p.rings * Math.log(OUTER_R / INNER_R) / Math.log(RING_REF_R / INNER_R)));
    const g = Math.pow(OUTER_R / INNER_R, 1 / Math.max(1, NRc - 1));
    const rings = Math.max(16, Math.round(Math.log(outer / INNER_R) / Math.log(g)) + 1);
    const geo = CBZ.waterBuildSurfaceGeometry({ tier: CBZ.qualityLevel, rings: rings, outerRadius: outer });
    // the radial disc is re-centred on the camera in the vertex program, so
    // the mesh itself must sit at x = z = 0 (disaster_arena.js reads radial)
    geo.userData.waterDisasterGrid = { span: +span || 2048, segments: segments | 0 || rings, radial: true, outer: outer };
    return geo;
  };

  CBZ.waterDisasterSurfaceY = function (x, z, meanY, amp, chop, t) {
    const base = CBZ.waterSeaY();
    let wave = CBZ.waterWaveHeight(x, z, t, amp, chop) - base;
    /* A FLOOD A METRE DEEP CARRIES NO METRE-HIGH SWELL. Inside the run-up
       field the swell is scaled by the depth under it (full from 2.5 m), the
       same factor the disaster sea's vertex stage applies. */
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    if (F) {
      const r = F.sample(x, z, _runSY);
      if (r.in > 0) { const k = Math.min(1, Math.max(0, r.depth / 2.5)); wave *= 1 - r.in + r.in * k; }
    }
    return meanY + wave;
  };
  const _runSY = {};

  /* ============================================================
     WHAT FLOODWATER LEAVES (2026-10-19). One look for the residue of every
     flood in the game: the flash flood's silt (systems/flashflood.js) and
     the tsunami's (world/tsunami_scene.js), and the waterline on the walls
     they stood against.

     OWNER: "it dries up way too fast and just leaves a weird colour on the
     ground. Wildfires leave a very real colour." The old films were one flat
     tint each (a 0.38-alpha brown box on the walls, an opaque brown sheet or
     a 64-cell grey veil on the ground) with a clock that dried them in 22 s.
     What the Ahr valley 2021, Derbyshire 2019 and the Tohoku "black tsunami"
     deposits look like instead:
       - a brown-grey MUD AND SILT FILM, thickest where the water was deep,
         slow and stood longest (the lows, the slack behind things), thin and
         patchy on the rises, so the ground shows through it;
       - dark, glossy and near-black-brown while wet; it dries from the thin
         edges and the high spots inward to a PALE grey-tan crust, the thick
         pans last, and those shrink into plates (mud cracks);
       - the drift the water carried, stranded in a ragged WRACK LINE at the
         high-water mark (twigs, grass, litter, the odd pale scrap);
       - on every wall a crisp dark tide line at the peak with a scum band
         under it and a mottled film below, darker while wet.
     Like the burn scar it is texture on the ground, never a colour pasted on
     it: per-cell inputs, world-space noise at three scales so the grid never
     shows, ragged edges. Seven value-noise taps a fragment: phone money.

     cbzFloodResidue(p, thick, dry, edge, comb, out gloss) -> (albedo, cover)
       p     world xz
       thick 0..1 how much settled here
       dry   0..1 the drying clock (0 just emerged, 1 long dry)
       edge  0..1 inside the high-water band, where the wrack is stranded
       comb  the direction the last of the water ran (zero: none)
     cbzWaterline(b, along, y, wet) -> (albedo, cover)
       b metres below the high-water line, along a coordinate along the wall
     ============================================================ */
  CBZ.floodResidueDrySecs = 150;
  CBZ.floodResidueGLSL = function () {
    return [
      "float cbzRsH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
      "float cbzRsN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(cbzRsH(i), cbzRsH(i + vec2(1.0, 0.0)), f.x), mix(cbzRsH(i + vec2(0.0, 1.0)), cbzRsH(i + vec2(1.0, 1.0)), f.x), f.y); }",
      "vec4 cbzFloodResidue(vec2 p, float thick, float dry, float edge, vec2 comb, out float gloss) {",
      "  float n1 = cbzRsN(p * 0.13);",            // ~8 m: where it settled thicker
      "  float n2 = cbzRsN(p * 0.61 + 5.3);",      // ~1.6 m mottling
      "  float n3 = cbzRsN(p * 2.7 - 3.1);",       // ~0.4 m grain
      // combed out along the last of the flow
      "  float cl = length(comb);",
      "  vec2 cd = cl > 0.01 ? comb / cl : vec2(1.0, 0.0);",
      /* NOT A COMB (2026-10-20): this was noise stretched 13:1 along the
         drain direction, looked up at (dot(p, perp), dot(p, dir)) with p the
         world position: long ruled smears across the whole aftermath, and on
         the flash flood (whose drain direction changes cell to cell) arcs
         swung about the world origin. What the last of the water leaves is
         irregular: lobes and tongues pushed a metre or two down the drain,
         an isotropic field displaced along it (bounded, so it never smears). */
      "  float stri = cl > 0.01 ? cbzRsN(p * 0.45 + cd * (n1 * 2.2 - 1.1) + 7.7) : 0.5;",
      // the mottling only where something settled (it used to lay a faint
      // film on every wetted cell, deposit or not)
      "  float th = clamp(thick * (0.62 + 0.76 * n1) + ((n2 - 0.5) * 0.26 + (stri - 0.5) * 0.2) * smoothstep(0.0, 0.12, thick), 0.0, 1.0);",
      // the drying front: thin film and the rises first, the thick lows last
      "  float dk = clamp(dry * 1.75 - th * 0.8 - (n2 - 0.5) * 0.34 - (n3 - 0.5) * 0.12, 0.0, 1.0);",
      "  float d = smoothstep(0.22, 0.52, dk);",
      "  vec3 wetC = mix(vec3(0.030, 0.026, 0.020), vec3(0.050, 0.043, 0.033), n2);",
      "  vec3 dryC = mix(vec3(0.19, 0.172, 0.142), vec3(0.285, 0.262, 0.224), n2 * 0.6 + n3 * 0.4);",
      // thin film dries to a dusty grey, the thick pans stay browner
      "  dryC *= mix(vec3(1.03, 1.03, 1.05), vec3(0.90, 0.84, 0.74), th);",
      "  vec3 col = mix(wetC, dryC, d);",
      // half-dry: a damp darker rim just behind the drying front
      "  col *= 1.0 - 0.22 * smoothstep(0.10, 0.22, dk) * (1.0 - smoothstep(0.22, 0.42, dk));",
      // thick dried mud shrinks into plates
      "  float cr = 1.0 - abs(cbzRsN(p * 1.15 + n2 * 0.7) * 2.0 - 1.0);",
      "  float crack = smoothstep(0.90, 0.97, cr) * smoothstep(0.45, 0.8, th) * smoothstep(0.62, 0.95, dk);",
      "  col *= 1.0 - 0.6 * crack;",
      // coverage: thick buries the ground, thin lets it through; wet soil darkens more
      "  float a = smoothstep(0.03, 0.5, th) * (0.5 + 0.48 * smoothstep(0.25, 0.75, th));",
      "  a = max(a, (1.0 - d) * smoothstep(0.0, 0.2, thick) * 0.6);",
      // water still standing in the deepest pockets
      "  float pud = smoothstep(0.74, 0.82, th + n3 * 0.06) * (1.0 - smoothstep(0.12, 0.5, dry * 1.3));",
      "  col = mix(col, vec3(0.028, 0.024, 0.019), pud);",
      "  a = max(a, pud);",
      // the wrack: what the water carried, dropped where it stopped
      "  float clump = smoothstep(0.55, 0.78, cbzRsN(p * 1.9 + 11.0) * 0.6 + n3 * 0.4);",
      "  float bits = smoothstep(0.80, 0.93, cbzRsN(p * 6.3 + 2.0));",
      // a sheet that carried nothing strands little
      "  edge *= 0.3 + 0.7 * smoothstep(0.0, 0.1, thick);",
      "  float wr = edge * clump;",
      "  col = mix(col, mix(vec3(0.026, 0.021, 0.014), vec3(0.07, 0.056, 0.038), n3), wr);",
      "  col = mix(col, vec3(0.30, 0.29, 0.26), edge * bits * (1.0 - wr) * 0.6);",
      "  a = max(a, max(wr * 0.95, edge * bits * 0.55));",
      "  gloss = (1.0 - d) * (0.35 + 0.65 * pud);",
      "  return vec4(col, clamp(a, 0.0, 1.0));",
      "}",
      "vec4 cbzWaterline(float b, float along, float y, float wet) {",
      "  b += (cbzRsN(vec2(along * 0.9, 3.0)) - 0.5) * 0.10;",
      "  if (b < 0.0) return vec4(0.0);",
      "  float drip = smoothstep(0.35, 0.8, cbzRsN(vec2(along * 2.3, y * 0.13)));",
      "  float mott = cbzRsN(vec2(along * 0.7, y * 0.6));",
      "  vec3 mud = mix(vec3(0.20, 0.18, 0.145), vec3(0.075, 0.065, 0.050), wet);",
      // the film is heaviest low down, where the water stood longest
      "  float a = mix(0.30, 0.62, smoothstep(0.1, 1.6, b)) * (0.78 + 0.30 * drip + 0.12 * mott);",
      "  a *= smoothstep(0.02, 0.10, b);",
      "  float line = 1.0 - smoothstep(0.035, 0.085, b);",
      "  float scum = smoothstep(0.08, 0.11, b) * (1.0 - smoothstep(0.22, 0.34, b)) * smoothstep(0.35, 0.6, cbzRsN(vec2(along * 4.0, y * 5.0)));",
      "  vec3 col = mud * (0.85 + 0.3 * mott);",
      "  col = mix(col, vec3(0.025, 0.022, 0.018), line);",
      "  col = mix(col, vec3(0.34, 0.33, 0.30), scum * 0.9);",
      "  return vec4(col, clamp(max(a, max(line * 0.92, scum * 0.8)), 0.0, 1.0));",
      "}",
    ].join("\n");
  };

  /* THE RUN-UP FIELD, READ ON THE GPU. One RGBA8 texel per cell, nearest-
     sampled and blended by hand (float textures cannot be linearly filtered
     on every phone; four fetches always can): RG = the drawn surface (16
     bit), B = sqrt(depth / 25), A = speed / 16. Returns (surface, depth,
     speed, inside weight) and the surface slope through `grad`. The CPU
     twin is world/tsunami_runup.js sample(). */
  const RUN_ENC = CBZ.waterRunupEnc = { lo: -16, span: 64, depth: 25, speed: 16, dryLift: 0.6 };
  const RUN_GLSL = [
    "uniform sampler2D uRunTex;",
    "uniform vec4 uRunB;",
    "uniform float uRunOn;",
    "vec4 cbzRunTexel(vec2 c) { return texture2D(uRunTex, (c + 0.5) / uRunB.w); }",
    "vec4 cbzRun(vec2 xz, out vec2 grad) {",
    "  grad = vec2(0.0);",
    "  vec2 g = (xz - uRunB.xy) / uRunB.z * uRunB.w - 0.5;",
    "  float e = min(min(g.x + 0.5, g.y + 0.5), min(uRunB.w - 0.5 - g.x, uRunB.w - 0.5 - g.y));",
    "  float w = clamp(e / 1.5, 0.0, 1.0);",
    "  if (w <= 0.0) return vec4(0.0);",
    "  vec2 i0 = clamp(floor(g), vec2(0.0), vec2(uRunB.w - 2.0));",
    "  vec2 f = clamp(g - i0, 0.0, 1.0);",
    "  vec4 a = cbzRunTexel(i0), b = cbzRunTexel(i0 + vec2(1.0, 0.0));",
    "  vec4 c = cbzRunTexel(i0 + vec2(0.0, 1.0)), d = cbzRunTexel(i0 + vec2(1.0, 1.0));",
    "  vec4 ee = (floor(vec4(a.r, b.r, c.r, d.r) * 255.0 + 0.5) * 256.0 + floor(vec4(a.g, b.g, c.g, d.g) * 255.0 + 0.5)) * " + gnum(RUN_ENC.span / 65535) + " + " + gnum(RUN_ENC.lo) + ";",
    "  vec4 dd = vec4(a.b, b.b, c.b, d.b); dd = dd * dd * " + gnum(RUN_ENC.depth) + ";",
    "  vec4 sp = vec4(a.a, b.a, c.a, d.a) * " + gnum(RUN_ENC.speed) + ";",
    "  vec4 wq = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);",
    "  float cell = uRunB.z / uRunB.w;",
    // the surface slope as a vector (+x, +z): the water runs down it
    "  grad = vec2(mix(ee.y - ee.x, ee.w - ee.z, f.y), mix(ee.z - ee.x, ee.w - ee.y, f.x)) / cell;",
    "  return vec4(dot(ee, wq), dot(dd, wq), dot(sp, wq), w);",
    "}",
  ].join("\n");

  CBZ.makeDisasterWaterMaterial = function (opts) {
    opts = opts || {};
    const U = CBZ.waterCommonUniforms();
    U.uDisasterAmp = { value: Number.isFinite(opts.amp) ? +opts.amp : 1.0 };
    U.uDisasterChop = { value: Number.isFinite(opts.chop) ? +opts.chop : 1.0 };
    U.uSeaOpacity = { value: Number.isFinite(opts.opacity) ? +opts.opacity : 1.0 };
    U.uDisasterOpacity = U.uSeaOpacity;                 // the old name, same object
    U.uDisasterFoam = { value: Number.isFinite(opts.foam) ? +opts.foam : 0.45 };
    // The body tint IS the sea colour (one uniform, two names): the veil, the
    // Snell mirror and the depth ramp all read uSeaColor.
    U.uSeaColor.value.set(opts.color == null ? 0x155878 : opts.color);
    U.uDisasterTint = U.uSeaColor;
    if (opts.shallowColor != null) U.uShallowColor.value.set(opts.shallowColor);
    U.uDisasterShallow = U.uShallowColor;
    /* ---- THE SEDIMENT IS A PLACE, NOT A PHASE (2026-10-20) --------------
       Water that has crossed land is a suspension: sand, silt, sewage,
       ground-up timber. It used to be one uniform (uDwSediment) laid over the
       whole sea on the wave's side of a ruled line, so from the air the ocean
       went brown-black to the horizon against a turquoise lee. Now the brown
       is where the scour put it: the run-up's water on the land (rLand
       below) and the silt field (world/tsunami_silt.js), seeded from that
       water, carried out to sea by the backwash, spread and settled. The
       open sea stays the sea. uSiltB = (x0, z0, size, on). */
    U.uSiltTex = { value: null };
    U.uSiltB = { value: new THREE.Vector4(0, 0, 1, 0) };
    U.uDwFrontC = { value: new THREE.Vector2(0, 0) };     // event origin, world XZ
    U.uDwFrontDir = { value: new THREE.Vector2(1, 0) };   // unit travel direction
    U.uDwFrontS = { value: -1e9 };                        // signed front position along dir
    U.uDwFrontRun = { value: 110 };                       // m the churn decays over, behind
    // metres the sheet is pulled DOWN ahead of the front (0 = off); CPU twin
    // CBZ.waterFrontDropAt
    U.uDwAhead = { value: 0 };
    // FLOOD WATER, NOT INK. The Tohoku aerials read a light grey-brown (the
    // heavy load) going green-grey where it thins, with sky on it; the old
    // 0x15120e x 0.62 landed near black through ACES. LINEAR: these land at
    // about sRGB (128,116,96) and (112,116,100) lit from above.
    U.uDwMud = { value: new THREE.Color(opts.mudColor == null ? 0x1c1812 : opts.mudColor) };
    // the flood is a river with no banks: everything on it moves one way
    U.uDwFlow = { value: new THREE.Vector2(1, 0) };
    U.uDwFlowSpd = { value: 0 };
    U.uDwStand = { value: 0 };
    // 0..1: how hard the flood's surface heaves (the boil, see vTail)
    U.uDwChurn = { value: 0 };
    // THE DRY DISC: (cx, cz, r, sink) — the sheet is pulled `sink` m down
    // inside r so a swell crest never stripes the plain. w = 0 is a no-op.
    U.uDwDryDisc = { value: new THREE.Vector4(0, 0, 0, 0) };
    U.uDwSilt = { value: new THREE.Color(opts.siltColor == null ? 0x181a14 : opts.siltColor) };
    // dirty off-white: tan-grey once it carries the silt (0x8e8271 lands
    // near white through ACES + sRGB, which is the clean cap the owner saw)
    U.uDwFoam = { value: new THREE.Color(opts.dirtyFoamColor == null ? 0x574c3c : opts.dirtyFoamColor) };
    /* THE RUN-UP FIELD (world/tsunami_runup.js): while one is attached, the
       sheet over its domain IS the field's surface (one RGBA8 texel a cell,
       see RUN_GLSL), its swell scaled by the depth under it, its dry cells
       discarded, and its froth where the water is fast and steep. */
    U.uRunTex = { value: null };
    U.uRunB = { value: new THREE.Vector4(0, 0, 1, 2) };   // x0, z0, size (m), cells per side
    U.uRunOn = { value: 0 };
    U.uRunRest = { value: -0.8 };                        // the rest sea: bed above it is land
    // 1 while the run-up overlay (below) is drawing the field's LAND: the
    // sea sheet then leaves the land to it, so the two never z-fight
    U.uRunOverlay = { value: 0 };

    const vDecl = [
      RUN_GLSL,
      "varying vec4 vRun;",
      "uniform vec4 uDwDryDisc;",
      "uniform vec2 uDwFrontC;",
      "uniform vec2 uDwFrontDir;",
      "uniform float uDwFrontS;",
      "uniform float uDwAhead;",
      "uniform float uDwChurn;",
      "uniform vec2 uDwFlow;",
      "float dwVH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
      "float dwVN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(dwVH(i), dwVH(i + vec2(1.0, 0.0)), f.x), mix(dwVH(i + vec2(0.0, 1.0)), dwVH(i + vec2(1.0, 1.0)), f.x), f.y); }",
    ].join("\n");
    const vTail = [
      "  float dwDisc = 1.0 - smoothstep(uDwDryDisc.z - 8.0, uDwDryDisc.z, length(wWorld.xz - uDwDryDisc.xy));",
      "  wWorld.y -= uDwDryDisc.w * dwDisc;",
      // ahead of a tsunami front the sheet stays at its pre-wave level, and
      // under the island there it is calm water again, so the dry disc's 3 m
      // sink comes back with it (swell crests never stripe the plain)
      "  float dwAk = uDwAhead > 0.001 ? smoothstep(-1.0, 7.0, dot(wWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS) : 0.0;",
      // the sea's own level under the travelling wave (ahead of the front AND
      // the island's lee: FRONT_DROP_GLSL, the one function every sea shares)
      "  wWorld.y -= cbzFrontDrop(wWorld.xz) + dwAk * 3.0 * dwDisc * step(uDwDryDisc.w, 0.01);",
      // the run-up field owns its domain: its surface, plus the swell scaled
      // by the depth under it (a flood a metre deep carries no metre swell)
      "  vec2 rG = vec2(0.0);",
      "  vec4 rS = uRunOn > 0.5 ? cbzRun(wXZ, rG) : vec4(0.0);",
      "  if (rS.w > 0.0) {",
      "    float rk = clamp(rS.y / 2.5, 0.0, 1.0);",
      "    wWorld.y = mix(wWorld.y, rS.x + wHeight * rk, rS.w);",
      "    wWorld.xz = mix(wWorld.xz, wXZ + wDisp.xz * rk, rS.w);",
      "  }",
      "  vRun = vec4(rS.y, rS.z, length(rG), rS.w);",
      /* THE BOIL: the water behind a bore is not a sheet, it heaves. Mounds
         a few metres across rising and collapsing, carried with the flow:
         most violent in the first tens of metres behind the front and in the
         fast, deep water on the land, a slow heave in the rest of the flood. */
      /* ...AND ON THE LAND IT IS A TORRENT (2026-10-20). Fast shallow water
         over a town stands up in waves that hold their place (a diamond of
         crossing trains, pulsing, pinned by the bed) and boils that ride the
         current. Driven by the run-up field's own speed and depth (Froude-
         ish: a metre and a half at 5 m/s heaves ~0.35 m), not by the event's
         phase: the backwash running off after the card has ended still
         heaves, and a slack pond is flat. */
      "  float onLand = rS.w * step(0.03, rS.y);",
      "  float aL = onLand * clamp(rS.y / 0.8, 0.0, 1.0) * min(0.7, 0.055 * rS.z * sqrt(max(rS.y, 0.05)) + 0.02 * rS.z);",
      "  float fdV = dot(wWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS;",
      "  float zone = (1.0 - smoothstep(-2.0, 3.0, fdV)) * (0.30 + 0.70 * exp(min(0.0, fdV) / 22.0));",
      "  float aS = uDwChurn * zone * 1.25 * (1.0 - onLand);",
      "  if (aL + aS > 0.002) {",
      "    vec2 lp = wWorld.xz - uDwFrontC;",
      "    vec2 fx = uDwFlow, fy = vec2(-uDwFlow.y, uDwFlow.x);",
      "    vec2 o1 = fx * 0.574 + fy * 0.819, o2 = fx * 0.574 - fy * 0.819;",
      "    float sw = sin(dot(lp, fx) * 0.62 + 0.8 * sin(uSeaTime * 0.7)) * (0.7 + 0.3 * sin(uSeaTime * 1.3 + dot(lp, fy) * 0.05))",
      "             + 0.6 * sin(dot(lp, o1) * 0.86 + uSeaTime * 0.4) * sin(dot(lp, o2) * 0.86 - uSeaTime * 0.5);",
      "    vec2 bp = wWorld.xz - uDwFlow * uSeaTime * 1.6;",
      "    float bn = dwVN(bp * 0.21 + vec2(uSeaTime * 0.13, -uSeaTime * 0.09)) * 0.6 + dwVN(bp * 0.53 + uSeaTime * vec2(-0.31, 0.27)) * 0.4;",
      "    wWorld.y += aL * (0.45 * sw + 0.9 * (bn - 0.45)) + aS * ((bn - 0.42) + 0.35 * sw);",
      "  }",
    ].join("\n");
    const fDecl = [
      RUN_GLSL,
      "varying vec4 vRun;",
      "uniform float uRunRest;",
      "uniform sampler2D uSiltTex;",
      "uniform vec4 uSiltB;",
      // the silt field's load at a world point, its outer cell fading to clean sea
      "float cbzSilt(vec2 xz) {",
      "  if (uSiltB.w < 0.5) return 0.0;",
      "  vec2 uv = (xz - uSiltB.xy) / uSiltB.z;",
      "  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));",
      "  if (e <= 0.0) return 0.0;",
      "  return texture2D(uSiltTex, uv).r * clamp(e * 40.0, 0.0, 1.0);",
      "}",
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
      // a real value-noise field for the soup (the ripple tile's channels are
      // far too uniform to break foam up — see the 2026-09 note in git)
      // sin-free (a sin() hash of a world coordinate hundreds of metres out
      // loses its bits on a phone GPU and the noise collapses into stripes)
      "float dwHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
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
      /* THE FROTH AND THE CHOP (2026-10-20). The sheet's white water was
         dwFoamClumps: thresholded noise with a 0.08-wide edge in the full
         fresh-foam colour, so from every height it was white blotches lying
         flat on the water (cow print), and on the steps of the sheet the
         same pattern stood up as a curtain. The breaking white water is not
         the sheet's job any more: it is lit VOLUME on the bore's fronts
         (world/tsunami_whitewater.js). What the surface behind a bore
         actually carries is a torn, dirty FROTH, the colour of the mud it is
         riding with a little air in it, soft-edged, never paper; and what
         makes it read as moving water is its RELIEF: standing waves and
         boils, which a vertex grid metres apart cannot carry, so they are a
         normal here (dwChopGrad), finer than any grid, fading with the
         pixel's footprint so nothing ever resolves as lines. */
      "float dwFrothPat(vec2 q, float px) {",
      "  float w = dwNoise(q * 0.11 + 3.0);",
      "  vec2 r = q + vec2(w, -w) * 3.0;",
      "  float big = dwNoise(r * 0.17);",
      "  float mid = mix(0.5, dwNoise(r * 0.55 + 7.1), 1.0 - smoothstep(0.5, 1.4, px));",
      "  float fine = mix(0.5, dwNoise(r * 1.7 - 2.3), 1.0 - smoothstep(0.15, 0.45, px));",
      "  return big * 0.5 + mid * 0.32 + fine * 0.18;",
      "}",
      // carried by the flow: a two-phase lookup, so the offset stays bounded
      "float dwFroth(vec2 P, vec2 fl, float spd, float px) {",
      "  float fT = 2.6;",
      "  float p0 = fract(uSeaTime / fT), p1 = fract(uSeaTime / fT + 0.5);",
      "  float a = dwFrothPat(P - fl * spd * p0 * fT, px);",
      "  float b = dwFrothPat(P - fl * spd * p1 * fT + 11.3, px);",
      "  return mix(a, b, abs(1.0 - 2.0 * p0));",
      "}",
      // the slope of the chop at p (metres from the event origin): a diamond of
      // standing trains pinned in place, a short cross train, and advected boils
      "vec2 dwChopGrad(vec2 p, vec2 fl, float px) {",
      "  vec2 ax = vec2(-fl.y, fl.x);",
      "  vec2 o1 = fl * 0.574 + ax * 0.819, o2 = fl * 0.574 - ax * 0.819;",
      "  float t = uSeaTime;",
      "  vec2 g = fl * (0.20 * cos(dot(p, fl) * 1.05 + 0.6 * sin(t * 0.9)) * (0.75 + 0.25 * sin(t * 1.7)));",
      "  g += o1 * (0.16 * cos(dot(p, o1) * 1.5 - t * 1.1));",
      "  g += o2 * (0.16 * cos(dot(p, o2) * 1.5 + t * 1.3));",
      "  vec2 o3 = normalize(fl * 0.3 + ax);",
      "  g += o3 * (0.12 * (1.0 - smoothstep(0.3, 0.8, px)) * cos(dot(p, o3) * 2.7 + t * 2.3));",
      "  vec2 q = p * 0.33 - fl * t * 0.5;",
      "  float b0 = dwNoise(q), bx = dwNoise(q + vec2(0.35, 0.0)), bz = dwNoise(q + vec2(0.0, 0.35));",
      "  g += vec2(bx - b0, bz - b0) * 0.85;",
      "  return g * (1.0 - smoothstep(1.0, 3.0, px));",
      "}",
    ].join("\n");
    /* THE TURBID WATER, from the Tohoku helicopter footage: the inundation is
       grey-brown, OPAQUE and still glossy; mottled with silt plumes drifting
       with the current; and its white is STRUCTURE — torn froth along the
       flow, a sparse scum network where the water has stood. Gated on the
       PLACED load (the run-up's land water, the silt field), so the open sea
       and every clean sea run not one instruction of it. */
    const fTail = [
      // run-up water on the land is flood water whatever the sea is doing:
      // it stays mud through the backwash, after the event has cleared
      "  float rLand = dwRun.w * smoothstep(uRunRest - 1.2, uRunRest + 0.3, dwRun.x - dwRun.y) * step(0.03, dwRun.y);",
      // the silt plume: the field is ~14 m cells, so its edge is torn by the
      // same slow noise that mottles the mud, drifting with the water
      "  float dwSilt = cbzSilt(vSeaWorld.xz);",
      "  if (dwSilt > 0.004) {",
      "    float sn = dwFbm(vSeaWorld.xz * 0.035 + uDwFlow * uSeaTime * 0.012);",
      "    dwSilt = clamp(dwSilt * (0.45 + 1.1 * sn) - 0.04, 0.0, 1.0);",
      "  }",
      "  float dwSed = max(dwSilt, 0.92 * rLand);",
      // derivatives outside every branch (undefined in non-uniform flow)
      "  vec3 dwP3x = dFdx(vSeaWorld), dwP3y = dFdy(vSeaWorld);",
      "  if (dwSed > 0.002) {",
      /* THE FACET: the sheet's own normal (vSeaNormal) is the swell's, taken
         before the event moved the surface, so on the flood's steps it still
         points straight up. The screen derivatives give the real surface:
         the step is lit as the slope it is (the bore's own wall stands in
         front of it, world/tsunami_whitewater.js, and carries the white). */
      "    vec3 dwNg = cross(dwP3x, dwP3y);",
      "    dwNg = dot(dwNg, dwNg) > 1e-10 ? normalize(dwNg) : vec3(0.0, 1.0, 0.0);",
      "    if (dwNg.y < 0.0) dwNg = -dwNg;",
      "    float dwStep = smoothstep(0.30, 0.62, 1.0 - dwNg.y);",
      "    vec3 tN = normalize(mix(normalize(vSeaNormal), dwNg, dwStep));",
      "    float fdS = dot(vSeaWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS;",
      "    float behind = clamp(-fdS / max(1.0, uDwFrontRun), 0.0, 1.0);",
      // ON THE LAND the field says what is flood: water standing on ground
      // above the rest sea, wherever it got to, whatever the front line says.
      // It churns where it is fast AND steep (the race round a corner, the
      // backwash pouring off a kerb), its slack is still.
      "    float rFront = smoothstep(0.12, 0.7, dwRunG) * smoothstep(0.6, 3.2, dwRun.z);",
      "    rFront = max(rFront, (1.0 - smoothstep(0.08, 0.7, dwRun.y)) * smoothstep(0.8, 2.6, dwRun.z));",
      "    behind = mix(behind, 0.35 * (1.0 - rFront), rLand);",
      "    float turb = dwSed;",
      "    if (turb > 0.002) {",
      "      float bd = mix(max(0.0, -fdS), mix(60.0, 0.5, rFront), rLand);",
      "      float land = step(0.5, rLand);",
      // ON THE LAND the water runs down its own surface, not along the
      // event's one bearing: round the blocks, out of the side streets, back
      // to the sea in the backwash
      "      vec2 fl = uDwFlow;",
      "      float dGl = length(dwRunGv);",
      "      if (land > 0.5 && dGl > 0.004) {",
      "        vec2 dG = -dwRunGv / dGl;",
      "        vec2 fm2 = mix(uDwFlow, dG, smoothstep(0.004, 0.03, dGl));",
      "        fl = length(fm2) > 0.01 ? normalize(fm2) : dG;",
      "      }",
      // the big silt plumes drift with the event (at 150 m a shear never shows)
      "      vec2 eAx = vec2(-uDwFlow.y, uDwFlow.x);",
      "      vec2 adv = vSeaWorld.xz - uDwFlow * (uDwFlowSpd * uSeaTime);",
      "      float sAl = dot(adv, uDwFlow);",
      "      float sAc = dot(adv, eAx);",
      "      float stand = mix(max(uDwStand, smoothstep(0.30, 1.0, behind)), 1.0 - smoothstep(0.4, 3.0, dwRun.z), rLand);",
      // the pixel's footprint on the SURFACE, its long side (a grazing view
      // filters by how far one pixel reaches, not by how narrow it is)
      "      float fpx = max(length(dwP3x), length(dwP3y));",
      /* THE CHOP: standing waves and boils as relief. On the land it is the
         field's own Froude-ish heave (fast and deep heaves, a slack pond is
         a mirror); on the sea it is the churn behind the front and the heave
         of the wave train, calming where the water has stood. */
      "      float chopA = land > 0.5",
      "        ? clamp(0.10 * dwRun.z * sqrt(max(dwRun.y, 0.05)) + 0.05 * dwRun.z, 0.0, 1.0) * clamp(dwRun.y / 0.5, 0.0, 1.0)",
      "        : clamp(turb, 0.0, 1.0) * (0.35 + 0.65 * (1.0 - stand));",
      "      vec2 cg = dwChopGrad(vSeaWorld.xz - uDwFrontC, uDwFlow, fpx) * chopA * (1.0 - dwStep);",
      "      tN = normalize(tN - vec3(cg.x, 0.0, cg.y));",
      "      if (under > 0.5) tN = -tN;",
      "      vec3 tL = normalize(uSunDir);",
      "      vec3 tH = normalize(tL + V);",
      "      float tndl = max(dot(tN, tL), 0.0);",
      "      float skyT = smoothstep(-0.12, 0.72, reflect(-V, tN).y);",
      "      #ifdef USE_FOG",
      "        vec3 dwSkyC = mix(fogColor * 1.12, fogColor * 0.60, skyT);",
      "      #else",
      "        vec3 dwSkyC = mix(uSkyLow, uSkyHigh, skyT);",
      "      #endif",
      "      float plume = clamp(dwFbm(vec2(sAl, sAc) * 0.0068) * 0.72 +",
      "                          dwNoise(vec2(sAl * 0.0021, sAc * 0.0029) + 11.0) * 0.46, 0.0, 1.0);",
      "      float sed = turb * mix(1.0, 0.92, behind);",
      // heavy load toward the brown, the thinning plume toward the green-grey
      "      vec3 mudBody = mix(uDwMud, uDwSilt, clamp(smoothstep(0.18, 0.92, plume) * 0.7 + (1.0 - sed) * 0.6, 0.0, 1.0));",
      "      mudBody *= 0.55 + tndl * 0.45;",
      "      float mf = 0.02 + 0.98 * pow(1.0 - clamp(dot(tN, V), 0.0, 1.0), 5.0);",
      /* NOT A MIRROR. The old 62% sky at grazing made the inundation a
         silver sheet: a churned suspension scatters what the surface would
         reflect, so the sky it shows is weak and goes with the churn. The
         chop's slopes catch it in broken flecks, which is what reads as
         water moving rather than a brown plane. */
      "      float churn = clamp(land * max(rFront, smoothstep(1.5, 5.5, dwRun.z) * 0.6) + (1.0 - land) * (1.0 - stand) * 0.4, 0.0, 1.0);",
      // it is still water: some sky at every angle, more at grazing
      "      vec3 turbCol = mix(mudBody, dwSkyC * 0.85, clamp(0.07 + mf * (0.70 - 0.3 * churn), 0.0, 0.5));",
      "      turbCol += uSunColor * pow(max(dot(tN, tH), 0.0), mix(110.0, 40.0, churn)) * (0.30 + 1.2 * mf) * (1.0 - 0.5 * churn);",
      "      outColor = mix(outColor, turbCol, clamp(sed * 1.2, 0.0, 0.985));",
      /* THE FROTH. Where the water is breaking (the race behind a bore, the
         run round a building, the first tens of metres behind the sea front)
         it carries more of it, thinning to a sparse scum where it has stood.
         Soft-edged rafts and holes, mud-coloured with air in it, lit by the
         chop: at most three quarters cover, never a flat white patch. */
      "      float dens = 0.0, spd = 0.0, fresh = 0.0;",
      "      if (land > 0.5) {",
      "        spd = min(dwRun.z, 6.0);",
      "        float lip = (1.0 - smoothstep(0.06, 0.45, dwRun.y)) * smoothstep(0.8, 2.6, dwRun.z);",
      "        dens = max(churn, lip) * 0.85 + (1.0 - churn) * 0.12;",
      "        fresh = max(rFront, lip);",
      "      } else {",
      "        spd = uDwFlowSpd;",
      "        float boilZ = exp(-bd / 14.0);",
      // a thin plume far out carries no raft of scum, only the thick water does
      "        dens = (boilZ * 0.75 + 0.40 * exp(-bd / 50.0) * (1.0 - stand) + 0.10 + 0.12 * stand) * smoothstep(0.35, 0.85, turb);",
      "        fresh = boilZ;",
      "      }",
      "      dens = clamp(dens, 0.0, 1.0) * clamp(turb * 1.15, 0.0, 1.0) * (1.0 - dwStep);",
      "      float fr = dwFroth(vSeaWorld.xz, fl, spd, fpx);",
      "      float thr = 1.0 - dens * 0.62;",
      "      float cov = smoothstep(thr - 0.20, thr + 0.24, fr) * (0.30 + 0.45 * dens);",
      "      float fSun = clamp(dot(tN, tL) * 0.55 + 0.45, 0.0, 1.0);",
      "      vec3 fAlb = mix(mudBody * 1.6, uDwFoam * (0.62 + 0.30 * fresh), smoothstep(0.0, 0.6, cov));",
      "      vec3 fLit = fAlb * (0.45 + 0.55 * fSun) + dwSkyC * 0.06 * fSun;",
      "      outColor = mix(outColor, fLit, cov);",
      "      if (land > 0.5) {",
      // a suspension is opaque: half a metre of Tohoku mud hid a car;
      // only the last few centimetres at the margin let the wet ground through
      "        solid = clamp(max(cov, min(1.0, sed * 1.9)), 0.0, 1.0);",
      "        outAlpha = mix(0.6, 1.0, smoothstep(0.03, 0.16, dwRun.y));",
      "      } else {",
      "        solid = clamp(max(foam, max(cov, min(1.0, sed * 1.9))), 0.0, 1.0);",
      "      }",
      "    }",
      "  }",
    ].join("\n");
    /* THE LAND IS THE OVERLAY'S, THE SEA IS THE SHEET'S. The camera disc's
       vertices are 8-25 m apart a hundred metres out (more on a phone tier),
       and a run-up a metre or two deep over ground that climbs inland,
       interpolated between vertices that far apart, lies UNDER the ground
       for most of each triangle: the tsunami's peak drew a wrecked town with
       no water in it. So the field's land (bed above the rest sea, less half
       a metre of beach) is drawn by a grid at the field's own 2.5 m cells
       (runOverlaySync below, same uniforms, same shading), and the sheet
       keeps the sea. One partition test, evaluated per pixel on the same
       texture by both, so they meet along one contour at the coast. */
    const RUN_LAND = "(dwRun.x - dwRun.y > uRunRest - 0.5)";
    const fHead = [
      "  vec4 dwRun = vec4(0.0); vec2 dwRunGv = vec2(0.0);",
      "  if (uRunOn > 0.5 && vRun.w > 0.01) {",
      "    dwRun = cbzRun(vSeaWorld.xz, dwRunGv);",
      // a dry cell of the field is dry land: no sea is drawn on it
      "    if (dwRun.w > 0.5 && dwRun.y < 0.03) discard;",
      "    if (uRunOverlay > 0.5 && dwRun.w > 0.5 && " + RUN_LAND + ") discard;",
      "  }",
      "  float dwRunG = length(dwRunGv);",
    ].join("\n");
    const fHeadOverlay = [
      "  vec2 dwRunGv = vec2(0.0);",
      "  vec4 dwRun = cbzRun(vSeaWorld.xz, dwRunGv);",
      "  float dwRunG = length(dwRunGv);",
      "  if (uRunOn < 0.5 || dwRun.w < 0.5 || dwRun.y < 0.03 || !" + RUN_LAND + ") discard;",
    ].join("\n");
    const fDeclAll = fDecl + "\nuniform float uRunOverlay;";
    const build = function (overlay) {
      return CBZ.waterSeaMaterial({
        kind: "arena", uniforms: U, name: overlay ? "CBZ Run-up Water" : (opts.name || "CBZ Disaster Water"),
        vertexDecl: vDecl, vertexTail: vTail, fragDecl: fDeclAll, fragTail: fTail,
        fragHead: overlay ? fHeadOverlay : fHead, cutGuard: "dwRun.w < 0.5", worldXZ: overlay,
        transparent: opts.transparent === true,
        depthWrite: opts.depthWrite == null ? (U.uSeaOpacity.value >= 0.999) : !!opts.depthWrite,
      });
    };
    const mat = build(false);
    mat.opacity = U.uSeaOpacity.value;
    mat.userData.waterMode = "shared-disaster-fresnel";
    mat.userData.buildRunOverlayMaterial = function () { return build(true); };
    return mat;
  };

  /* THE RUN-UP OVERLAY: one grid vertex per field cell centre, laid in world
     XZ, displaced and shaded by the sea's own program (worldXZ), so the flood
     on the land is drawn at the resolution it is solved at. Built lazily the
     first time a field is attached, rebuilt only when the field's domain
     changes, hidden whenever no field is attached. */
  function runOverlaySync(target, mat, u, F) {
    let ov = mat.userData.runOverlay;
    if (!F || !(u.uRunOn.value > 0.5)) {
      if (ov) ov.visible = false;
      u.uRunOverlay.value = 0;
      return;
    }
    const parent = target && target.isObject3D ? target.parent : null;
    if (!ov) {
      if (!parent || !mat.userData.buildRunOverlayMaterial) { u.uRunOverlay.value = 0; return; }
      ov = new THREE.Mesh(new THREE.BufferGeometry(), mat.userData.buildRunOverlayMaterial());
      ov.name = "tsunami-runup-overlay";
      ov.frustumCulled = false;
      ov.renderOrder = target.renderOrder;
      ov.userData.waterSurface = true;
      ov.userData.noCoat = true;
      ov.userData.terrain = true;        // batch.js / farcull.js keep their hands off
      ov.userData.key = "";
      mat.userData.runOverlay = ov;
    }
    if (parent && ov.parent !== parent) parent.add(ov);
    const key = F.x0 + "|" + F.z0 + "|" + F.size + "|" + F.n;
    if (ov.userData.key !== key) {
      const n = F.n | 0, cell = F.size / n;
      const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3;
        pos[k] = F.x0 + (i + 0.5) * cell; pos[k + 2] = F.z0 + (j + 0.5) * cell;
        nor[k + 1] = 1;
      }
      const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)((n - 1) * (n - 1) * 6);
      let o = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      ov.geometry.dispose();
      ov.geometry = g;
      ov.userData.key = key;
    }
    // the sheet's blend state, whatever the event has done to it
    const om = ov.material;
    if (om.transparent !== mat.transparent) { om.transparent = mat.transparent; om.needsUpdate = true; }
    om.depthWrite = mat.depthWrite; om.opacity = mat.opacity;
    // the grid IS world XZ (the arena root sits at the origin, as the disc assumes)
    ov.position.set(0, 0, 0);
    ov.visible = true;
    u.uRunOverlay.value = 1;
  }

  // Hand an arena sea its baked field (CBZ.waterBakeField handle).
  CBZ.waterSetField = function (target, field) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u || !field || !field.tex) return false;
    u.uSeaLandMask.value = field.tex;
    u.uSeaLandBounds.value.copy(field.bounds);
    u.uSeaHasLandMask.value = 1;
    /* A FIELD BAKED HERE IS THE SEA'S OWN: the one it replaces goes (each
       Isles island the sea moves to bakes a new 512x512 shore field; the old
       ones stayed on the GPU with their 1 MB arrays, 2 a round trip) */
    const old = mat.userData.waterField;
    if (old && old !== field && old.baked && old.tex && old.tex !== field.tex) { old.done = true; old.tex.dispose(); }
    mat.userData.waterField = field;
    return true;
  };

  const _siltB = {};
  CBZ.waterDriveDisasterSurface = function (target, state) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u) return false;
    CBZ.waterDriveCommonUniforms(u);
    // The island's field is in DEPTH units, so its land cut follows the live
    // surge in metres (the city's ramp cut written above does not apply).
    u.uShoreCut.value = CBZ.waterFieldCut(_surge, 0.6);
    // finish baking the field a slice per frame, off the load path
    const fld = mat.userData && mat.userData.waterField;
    if (fld && !fld.done) fld.step(2.5);
    state = state || {};
    if (u.uRunOn) {
      const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
      const tx = F ? F.texture() : null;
      if (tx) {
        u.uRunTex.value = tx;
        u.uRunB.value.set(F.x0, F.z0, F.size, F.n);
        u.uRunRest.value = F.restY;
        u.uRunOn.value = 1;
      } else u.uRunOn.value = 0;
      if (u.uRunOverlay) runOverlaySync(target, mat, u, tx ? F : null);
    }
    if (Number.isFinite(state.amp)) u.uDisasterAmp.value = +state.amp;
    if (Number.isFinite(state.chop)) u.uDisasterChop.value = +state.chop;
    if (Number.isFinite(state.foam)) u.uDisasterFoam.value = +state.foam;
    if (Number.isFinite(state.opacity)) {
      u.uDisasterOpacity.value = +state.opacity;
      mat.opacity = +state.opacity;
      if (+state.opacity < 0.999 && !mat.transparent) { mat.transparent = true; mat.needsUpdate = true; }
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
    // the crest lines are the director's to thin; the brown water covers
    // them per pixel by its own load (the disaster tail mixes over them)
    if (u.uLineFoam) u.uLineFoam.value = Number.isFinite(state.lineFoam) ? Math.max(0, +state.lineFoam) : 1;
    // the silt field: where the water is brown (world/tsunami_silt.js)
    if (u.uSiltB) {
      const SL = CBZ.tsuSilt;
      const stx = SL && SL.live ? SL.texture() : null;
      if (stx) {
        const b = SL.bounds(_siltB);
        u.uSiltTex.value = stx;
        u.uSiltB.value.set(b.x0, b.z0, b.size, 1);
      } else u.uSiltB.value.w = 0;
    }
    // ---- the turbid-front block. Absent from `state` = untouched, so an
    //      existing caller keeps its clean water without knowing this exists.
    if (u.uDwFrontC) {
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
      if (u.uDwChurn) u.uDwChurn.value = Number.isFinite(state.churn) ? Math.max(0, Math.min(1.5, +state.churn)) : 0;
      if (u.uDwAhead) u.uDwAhead.value = Number.isFinite(state.aheadDrop) ? Math.max(0, +state.aheadDrop) : 0;
      if (Number.isFinite(state.frontRun)) u.uDwFrontRun.value = Math.max(1, +state.frontRun);
      if (state.mud != null) u.uDwMud.value.set(state.mud);
    }
    return true;
  };

  /* ============================================================
     THE BORE FACE: ONE BREAKING BORE, SHARED BY BOTH TSUNAMIS.

     2026-09-27 REWRITE. The last version was a clean, glassy, pale mint
     Hokusai curl with a neat white cap and a backlit turquoise lip: a toy
     wave, and at landfall a tan striped curtain. Tohoku and Aceh footage
     shows neither. A tsunami bore is:

       a STEEP DARK WALL (green-grey offshore, brown/grey-black once it has
         scoured the shelf) whose front is
       a ROLLING WHITEWATER AVALANCHE: lumpy cauliflower boils of dirty foam
         tumbling forward over the crest and pouring down the wall in tongues,
       flecked with DEBRIS (planks, wreckage) carried inside the churn,
       with SPRAY AND MIST blown BACK off the crest by the wind, and
       a CHURNING SKIRT of foam where the foot meets the water ahead of it.
       Far out and small, all of that averages to a WHITE LINE on the horizon.

     So the geometry is not a curl any more. The path runs back tail -> crest
     -> a near-vertical front -> a low boiling skirt, and `curl` throws the
     upper front forward into an overhang that is itself a mass of boils.

     EVERYTHING MOVES ON THE GPU. The old face rewrote ~1550 vertices, ran
     computeVertexNormals and six CPU-animated foam layers every frame (seven
     draw calls). Now the per-frame CPU cost is a handful of uniform writes:
       draw 1  the wall (+ skirt), vertex shader displaces it (swell, throw,
               crest lobes, cellular boils) and takes its own normal by
               finite differences; fragment paints foam, holes, tongues,
               debris and the far white line.
       draw 2  crest spray + mist: GPU-animated point sprites.

     CBZ.tsuFaceBuild({width, height, rnd}) -> handle   (caller adds handle.group)
     CBZ.tsuFaceUpdate(handle, {t, dt, height, turbid, curl, foam, x, y, z,
                                dirX, dirZ, seaY?, fade?})
       seaY (optional, world y of the water surface) seats the skirt and the
       wake on the water; without it the live waterEvent level is used.
     CBZ.tsuFaceDispose(handle)

     THE LINEAR-HEX TRAP: every colour constant below is LINEAR and goes
     through ACES + sRGB, so it lands much lighter than it reads here.
     ============================================================ */
  // [forward z (m at H=34), height 0..1] back tail -> crest -> front -> skirt
  const TSU_PATH = [
    [-26.0, 0.00], [-16.0, 0.10], [-9.0, 0.30], [-4.5, 0.58], [-1.6, 0.84], [0.6, 0.97],
    [2.4, 1.00],                                                   // crest
    [3.9, 0.95], [4.7, 0.83], [5.0, 0.66], [4.8, 0.48], [4.6, 0.32], [4.9, 0.19], // the wall
    [6.2, 0.11], [8.4, 0.06], [10.6, 0.025], [13.0, 0.0],        // the skirt
  ];
  const TSU_CREST_K = 6, TSU_TOE_K = 12;
  /* THIS FACE IS THE WAVE AT SEA ONLY (2026-10-20). Once it breaks, the
     bore on the land is world/tsunami_whitewater.js: geometry laid on the
     run-up field's own fronts, and white water as lit volume. The face's
     32-column bending (tsuBoreBands) that tried to drag one straight wave
     along a ragged front is gone; at the crash the caller fades it out
     (`fade`) while the crash burst and the bore take over. */
  const TSU_COLS = 224;
  const TSU_ROWS = 50;

  function cmr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  /* Rows along the path, spaced by WEIGHTED arc length: the front and the
     crest carry the boils and get ~3x the row density of the back tail and
     the skirt. Returns [{k, z, yf, arc}] with z/arc in metres at H=34. */
  function tsuRowsLayout(rows) {
    const K = TSU_PATH, n = K.length, SUB = 24, S = [];
    for (let i = 0; i < n - 1; i++) {
      const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(n - 1, i + 2)];
      for (let s = 0; s < SUB; s++) {
        const u = s / SUB;
        S.push([i + u, cmr(a[0], b[0], c[0], d[0], u), cmr(a[1], b[1], c[1], d[1], u)]);
      }
    }
    S.push([n - 1, K[n - 1][0], K[n - 1][1]]);
    const arc = [0], wa = [0];
    for (let i = 1; i < S.length; i++) {
      const L = Math.hypot(S[i][1] - S[i - 1][1], (S[i][2] - S[i - 1][2]) * 34);
      const k = S[i][0];
      const w = k < TSU_CREST_K - 2 ? 0.55 : (k > TSU_TOE_K + 0.5 ? 1.5 : 1.6);
      arc.push(arc[i - 1] + L); wa.push(wa[i - 1] + L * w);
    }
    const out = [], tot = wa[wa.length - 1];
    let j = 1;
    for (let r = 0; r < rows; r++) {
      const target = tot * r / (rows - 1);
      while (j < wa.length - 1 && wa[j] < target) j++;
      const f = Math.max(0, Math.min(1, (target - wa[j - 1]) / Math.max(1e-6, wa[j] - wa[j - 1])));
      const L = (A, B) => A + (B - A) * f;
      out.push({ k: L(S[j - 1][0], S[j][0]), z: L(S[j - 1][1], S[j][1]), yf: L(S[j - 1][2], S[j][2]), arc: L(arc[j - 1], arc[j]) });
    }
    return out;
  }
  const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* ---- shared GLSL: hashes, value fbm, a boiling cellular field ---------- */
  const TSU_GLSL_NOISE = [
    "float h21( vec2 p ) {",
    "  vec3 q = fract( vec3( p.xyx ) * 0.1031 );",
    "  q += dot( q, q.yzx + 33.33 );",
    "  return fract( ( q.x + q.y ) * q.z );",
    "}",
    "vec2 h22( vec2 p ) {",
    "  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );",
    "  q += dot( q, q.yzx + 33.33 );",
    "  return fract( ( q.xx + q.yz ) * q.zy );",
    "}",
    "vec4 h42( vec2 p ) {",
    "  vec4 q = fract( vec4( p.xyxy ) * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );",
    "  q += dot( q, q.wzxy + 33.33 );",
    "  return fract( ( q.xxyz + q.yzzw ) * q.zywx );",
    "}",
    "float vn( vec2 p ) {",
    "  vec2 i = floor( p ), f = fract( p );",
    "  f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ),",
    "              mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );",
    "}",
    /* THE BOIL. Worley with every feature point orbiting on its own clock,
       SMOOTH-MINNED (log-sum-exp over the 3x3 cells) so the caps are
       rounded billows with soft creases between them. Plain F1 shades as
       flat Voronoi plates: styrofoam, not whitewater. .x = billow height
       0..1, .yz = the height's slope direction (weighted offset to the
       nearby centres), so the fragment gets its bump normal for free. */
    "vec3 cellB( vec2 q, float T ) {",
    "  vec2 i = floor( q ), f = fract( q );",
    "  float S = 0.0; vec2 G = vec2( 0.0 );",
    "  for ( int yy = -1; yy <= 1; yy++ ) {",
    "    for ( int xx = -1; xx <= 1; xx++ ) {",
    "      vec2 g = vec2( float( xx ), float( yy ) );",
    "      vec2 o = h22( i + g );",
    "      o = 0.5 + 0.38 * sin( T * ( 0.7 + o.yx * 1.1 ) + o * 6.2831 );",
    "      vec2 r = g + o - f;",
    "      float w = exp( -7.0 * dot( r, r ) );",
    "      S += w; G += w * r;",
    "    }",
    "  }",
    "  float d = -log( max( S, 1e-6 ) ) / 7.0;",
    "  return vec3( clamp( 1.0 - d * 1.9, 0.0, 1.0 ), G / max( S, 1e-6 ) );",
    "}",
  ].join("\n");

  function tsuLightUniforms() {
    return {
      uSunDir: { value: new THREE.Vector3(0.42, 0.79, -0.09) },
      uSunCol: { value: new THREE.Color(1.0, 0.96, 0.88) },
      uSkyCol: { value: new THREE.Color(0.62, 0.72, 0.86) },
      uGndCol: { value: new THREE.Color(0.22, 0.24, 0.18) },
    };
  }

  /* ============================================================
     THE WALL MATERIAL.
     Vertex: the rest pose (baked per vertex at build) is scaled to the live
     height, swayed, thrown forward by `curl`, lobed along the crest, seated
     on the sea at the skirt, and then BOILED: the cellular field, scrolling
     over the crest and down the front at the roll speed, pushes the surface
     out along its normal wherever the whitewater is. Normal = cross of two
     finite-difference neighbours run through the same function.
     Fragment: body (dark, never glassy) + foam (lit boils with dark creases)
     + holes punched in the foam + tongues pouring down the wall + debris
     flecks + the far white line.
     ============================================================ */
  function tsuWallMaterial(light) {
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uTime: { value: 0 }, uTurbid: { value: 0 }, uCurl: { value: 0.5 }, uCurlN: { value: 0.4 },
      uH: { value: 34 }, uHs: { value: 1 }, uFoam: { value: 0.7 },
      uSkirt: { value: 1 }, uSeaLocal: { value: 0.5 },
      uLumpS: { value: 4 }, uLumpA: { value: 1.5 }, uRollV: { value: 3 },
      uLobe: { value: new THREE.Vector4() }, uLobeFrom: { value: 0.79 },
      uLP: { value: new THREE.Vector3() }, uHalfW: { value: 160 },
      uFade: { value: 1 },
      uBodySea: { value: new THREE.Color(0.045, 0.085, 0.074) },
      uBodyMud: { value: new THREE.Color(0.072, 0.058, 0.040) },
      uGlowSea: { value: new THREE.Color(0.045, 0.15, 0.13) },   // green-blue thin water
      uGlowMud: { value: new THREE.Color(0.12, 0.11, 0.07) },
      // wet foam, faintly sea-tinted: aerated water, not snow (0.84-0.90
      // landed as a paper-white cap through ACES)
      uFoamClean: { value: new THREE.Color(0.64, 0.69, 0.68) },
      // dirty off-white-tan: 0.66 landed paper white through ACES + sRGB, the
      // "smooth white crest" the owner called fake once the bore is on land
      uFoamMud: { value: new THREE.Color(0.40, 0.355, 0.29) },
    });
    // the light uniforms are SHARED objects across the face's materials
    uni.uSunDir = light.uSunDir; uni.uSunCol = light.uSunCol;
    uni.uSkyCol = light.uSkyCol; uni.uGndCol = light.uGndCol;

    const VERT = [
      "attribute vec4 aFace;",   // x (m), arc (m at build H), height fraction, side 0 back..1 front
      "attribute vec4 aFaceD;",  // d(yf)/d(arc), d(side)/d(arc), skirt 0..1, skirt distance 0..1
      "attribute vec3 aTx;",     // rest tangent per metre along the front
      "attribute vec3 aTs;",     // rest tangent per metre of arc
      "uniform float uTime, uTurbid, uCurl, uH, uHs, uSkirt, uSeaLocal, uLumpS, uLumpA, uRollV, uLobeFrom, uHalfW;",
      "uniform vec4 uLobe;",
      "uniform vec3 uLP;",
      "varying vec4 vFace;",
      "varying vec4 vAux;",      // skirt, skirt distance, roll mask, boil height
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "#include <fog_pars_vertex>",
      TSU_GLSL_NOISE,
      // where the whitewater is: the roller on the upper front (deeper with
      // sediment), a little over the back of the crest, the foot, the skirt
      "float rollMask( float u, float side, float sk, float sdn ) {",
      "  float lo = mix( 0.88, 0.80, uTurbid );",
      "  float r = smoothstep( lo, lo + 0.22, u ) * mix( 0.30, 1.0, side ) * ( 1.0 - sk );",
      "  r = max( r, side * ( 1.0 - sk ) * ( 1.0 - smoothstep( 0.12, 0.30, u ) ) * 0.65 );",
      "  r = max( r, sk * ( 1.0 - smoothstep( 0.0, 0.8, sdn ) ) * ( 0.55 + 0.45 * uTurbid ) );",
      "  return r;",
      "}",
      "vec3 shape( vec3 p, float x, float arcL, float u, float side, float sk, float sdn ) {",
      "  float T = uTime;",
      "  float ch = 1.0 + uTurbid * 1.35;",
      "  float A0 = T * 1.55 + x * 0.052 + arcL * 0.05;",
      "  float A1 = -T * 2.10 + x * 0.091 - arcL * 0.03;",
      "  p.x += sin( A1 ) * 0.34 * u * ch;",
      "  p.y += ( sin( A0 ) * ( 0.16 + 0.72 * u ) + sin( A1 ) * 0.22 * u ) * ch;",
      "  p.z += sin( A0 * 0.77 ) * ( 0.08 + 0.78 * u ) * ch;",
      // the throw: the upper front runs ahead of its own foot
      "  float cw = u * u * mix( 0.45, 1.0, side ) * ( 1.0 - sk );",
      "  p.z += uCurl * 8.0 * uHs * cw;",
      // the crest is never one height: lobes, and chunks thrown up out of it
      "  float lr = max( 0.0, ( u - uLobeFrom ) / ( 1.0 - uLobeFrom ) );",
      "  float lw = lr * lr * ( 1.0 - sk );",
      "  float lobe = sin( x * 0.041 + T * 0.85 + uLP.x ) * 0.56 + sin( x * 0.108 - T * 1.37 + uLP.y ) * 0.30",
      "             + sin( x * 0.283 + T * 2.31 + uLP.z ) * 0.19 + sin( x * 0.71 - T * 3.4 + uLP.x * 2.1 ) * 0.11;",
      "  float s1 = max( 0.0, sin( x * 0.34 + T * 2.9 + uLP.y * 1.7 ) );",
      "  float s2 = max( 0.0, sin( x * 0.155 - T * 1.9 + uLP.z * 2.3 ) );",
      "  float fg = s1 * s1 * s1 * 0.72 + s2 * s2 * 0.5;",
      "  p.y += lw * ( lobe * uLobe.x + fg * uLobe.z );",
      "  p.z += lw * ( lobe * uLobe.y + fg * uLobe.w );",
      // the skirt is SEATED ON THE SEA, a low mound running out ahead
      "  float mound = uSeaLocal + 0.28 + ( 0.05 + 0.07 * uTurbid ) * uH * pow( 1.0 - sdn, 1.6 );",
      "  p.y = mix( p.y, mound, sk );",
      "  p.z += sk * sdn * ( uSkirt - 1.0 ) * 8.1 * ( uH / 34.0 );",
      "  return p;",
      "}",
      "float boil( float x, float arcL, float roll ) {",
      "  if ( roll < 0.01 ) return 0.0;",
      // A LITTLE LONGER DOWN THE FALL LINE, NOT COMBED (2026-10-20): at 2.4:1
      // the billows were ridges, and edge-on from the beach a field of
      // ridges is a field of lines. 1.25:1 keeps them pouring, and round.
      "  vec2 q = vec2( x / uLumpS, ( arcL - uTime * uRollV ) / ( uLumpS * 1.25 ) );",
      "  float a = cellB( q, uTime ).x;",
      "  float b = cellB( q * 2.13 + vec2( 5.2 + uTime * 0.25, 1.7 ), uTime * 1.3 ).x;",
      "  return a * 0.68 + b * 0.32;",
      "}",
      "void main() {",
      "  vec3 sc = vec3( 1.0, uHs, uHs );",
      "  float x = aFace.x, u = aFace.z, side = aFace.w, sk = aFaceD.z, sdn = aFaceD.w;",
      "  float arcL = aFace.y * uHs;",
      "  const float EX = 0.7, ES = 0.6;",
      "  vec3 p0 = shape( position * sc, x, arcL, u, side, sk, sdn );",
      "  vec3 px = shape( ( position + aTx * EX ) * sc, x + EX, arcL, u, side, sk, sdn );",
      "  float u2 = u + aFaceD.x * ES, sd2 = clamp( side + aFaceD.y * ES, 0.0, 1.0 );",
      "  vec3 ps = shape( ( position + aTs * ES ) * sc, x, arcL + ES * uHs, u2, sd2, sk, sdn );",
      "  vec3 n0 = normalize( cross( ps - p0, px - p0 ) );",   // outward
      "  float roll = rollMask( clamp( u, 0.0, 1.0 ), side, sk, sdn );",
      "  float amp = uLumpA * roll;",
      "  float b0 = boil( x, arcL, roll );",
      "  float bx = boil( x + EX, arcL, roll );",
      "  float bs = boil( x, arcL + ES * uHs, rollMask( clamp( u2, 0.0, 1.0 ), sd2, sk, sdn ) );",
      "  vec3 q0 = p0 + n0 * b0 * amp;",
      "  vec3 qx = px + n0 * bx * amp;",
      "  vec3 qs = ps + n0 * bs * amp;",
      "  vec3 nL = normalize( cross( qs - q0, qx - q0 ) );",
      "  vFace = vec4( x, arcL, u, side );",
      "  vAux = vec4( sk, sdn, roll, b0 );",
      "  vec4 wp = modelMatrix * vec4( q0, 1.0 );",
      "  vWPos = wp.xyz;",
      "  vNrm = normalize( mat3( modelMatrix ) * nL );",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const FRAG = [
      "uniform float uTime, uTurbid, uCurlN, uH, uHs, uFoam, uLumpS, uRollV, uHalfW, uFade;",
      "uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol;",
      "uniform vec3 uBodySea, uBodyMud, uGlowSea, uGlowMud, uFoamClean, uFoamMud;",
      "varying vec4 vFace;",
      "varying vec4 vAux;",
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "#include <fog_pars_fragment>",
      TSU_GLSL_NOISE,
      // the top octaves fade with distance: a metre octave on a nine-pixel wave crawls
      "float fbm( vec2 p, float fine ) {",
      "  float s = 0.0, w = 0.0, a = 0.5;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.03;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.07;",
      "  s += a * fine * vn( p ); w += a * fine;",
      "  return s / max( w, 0.0001 );",
      "}",
      "void main() {",
      "  vec3 toCam = cameraPosition - vWPos;",
      "  float dist = length( toCam );",
      "  vec3 V = toCam / max( dist, 0.001 );",
      "  float fine = 1.0 - smoothstep( 140.0, 560.0, dist );",
      /* THE FOOTPRINT, in the face's own metres (x along the front, arc up
         the profile): every octave smaller than ~2 pixels eases to its mean.
         Seen edge-on (the beach looking along a 300 m front) one pixel spans
         tens of metres of x, and metre cells resolved there as hairlines. */
      "  float fpw = max( length( vec2( dFdx( vFace.x ), dFdx( vFace.y ) ) ), length( vec2( dFdy( vFace.x ), dFdy( vFace.y ) ) ) );",
      "  fine = min( fine, 1.0 - smoothstep( 0.35, 1.1, fpw ) );",
      "  float x = vFace.x, arc = vFace.y, up = clamp( vFace.z, 0.0, 1.0 ), side = vFace.w;",
      "  float sk = vAux.x, sdn = vAux.y, roll = vAux.z, boilV = vAux.w;",
      "  float T = uTime, tb = uTurbid;",
      "  float fall = arc - T * uRollV;",
      "  float nA = fbm( vec2( x * 0.045, fall * 0.06 ), fine );",
      "  float nB = fbm( vec2( x * 0.30, fall * 0.34 ), fine );",
      // churn cells, round (a touch long down the fall line), filtered by footprint
      "  float kA = 1.0 - smoothstep( 0.22, 0.55, fpw / ( uLumpS * 0.55 ) );",
      "  float kB = 1.0 - smoothstep( 0.22, 0.55, fpw / ( uLumpS * 0.22 ) );",
      "  vec3 cA = kA > 0.01 ? cellB( vec2( x, fall * 0.8 ) / ( uLumpS * 0.55 ), T * 1.2 ) : vec3( 0.6, 0.0, 0.0 );",
      "  cA = mix( vec3( 0.6, 0.0, 0.0 ), cA, kA );",
      "  vec3 cB = ( fine > 0.03 && kB > 0.01 ) ? cellB( vec2( x, fall * 0.8 ) / ( uLumpS * 0.22 ) + 7.7, T * 1.7 ) : vec3( 0.6, 0.0, 0.0 );",
      "  cB = mix( vec3( 0.6, 0.0, 0.0 ), cB, kB * fine );",
      /* TORN CHURN (2026-10-20). This was FLOW STREAKS: noise at 15:1 and
         16:1 (x * 0.85 against fall * 0.055), "fine lines running with the
         water" by design, and the owner's "fake streaks / brush scratches"
         on every shot of the face. Whitewater pouring down a wall is torn
         into clots and holes, not ribbons: the same two scales now, round,
         domain-warped by the big churn, and filtered by footprint. */
      "  float stk = fbm( vec2( x, fall ) * 0.32 + vec2( nA, nB ) * 1.6, fine );",
      "  float stk2 = mix( 0.5, vn( vec2( x, fall ) * 0.95 - nB * 2.0 + 3.1 ), fine );",
      "  float streak = smoothstep( 0.30, 0.72, stk * 0.65 + stk2 * 0.35 );",
      // ---- foam coverage (2026-09-27 WATER PASS)
      /* The last pass read as a grey mountain range with snow on it: a matte
         body streaked with vertical gullies (tongues, runs, lace, streaked
         normals) under a uniform fluffy white cap. Tohoku footage says the
         opposite: the FACE is dark, clean and GLOSSY, the white water is a
         ragged churn at the LIP and an explosion at the FOOT where the water
         hits land, and the only light band on the face is the thinning water
         just under the lip. So: no face streaks at all, a narrow torn lip,
         a violent base. */
      "  float jag = fbm( vec2( x * 0.05 - T * 0.02, 3.7 ), 0.4 );",
      "  float jag2 = fbm( vec2( x * 0.19 + T * 0.05, 8.1 ), fine );",
      "  float edge = mix( 0.92, 0.86, tb ) - ( jag - 0.5 ) * 0.10 - ( jag2 - 0.5 ) * 0.06 - 0.03 * uCurlN;",
      "  float rollF = smoothstep( edge - 0.015, edge + 0.04, up ) * smoothstep( 0.2, 0.7, side ) * ( 1.0 - sk );",
      "  float backF = ( 1.0 - side ) * smoothstep( 0.86, 0.98, up + ( nB - 0.5 ) * 0.2 );",
      // the foot: whitewater climbing the lower wall where it hits the land
      "  float footTop = 0.10 + 0.12 * tb + ( jag2 - 0.5 ) * 0.10 + ( jag - 0.5 ) * 0.08;",
      "  float footF = side * ( 1.0 - sk ) * ( 1.0 - smoothstep( footTop - 0.03, footTop + 0.04, up ) );",
      "  float skirtF = sk * smoothstep( 0.30 - 0.14 * tb, 0.58, nB * 0.6 + cA.x * 0.4 ) * ( 1.0 - smoothstep( 0.35, 1.0, sdn ) );",
      "  float foam = max( max( rollF, backF ), max( footF, skirtF ) );",
      /* HOLES: churn is torn, never a blanket. Dark water shows through
         between the boils, most at the ragged margins of each band. */
      "  float hole = 1.0 - smoothstep( 0.20 + 0.08 * tb, 0.42 + 0.08 * tb, cA.x * 0.55 + nB * 0.45 );",
      "  foam *= 1.0 - hole * mix( 0.85, 0.45, rollF );",
      // ...and combed into flow streaks everywhere but the very top of the churn
      "  float core = smoothstep( edge + 0.02, edge + 0.10, up ) * ( 1.0 - sk );",
      /* THE WHITE LINE. Far out (or while the face is still low) the churn is
         sub-pixel and what the eye sees is a bright white line on the sea.
         (DECLARED HERE, before its first use. From 2026-09-28 to 2026-10-20
         the line below read `far` two lines before this declaration: an
         undeclared identifier is a GLSL compile error, so the whole bore
         face failed to link and was never drawn. The tsunami was its spray
         sprites and the flat wake shreds with no wave under them, which is
         the "white part at the top" the owner kept seeing.) */
      "  float far = max( smoothstep( 280.0, 900.0, dist ), 1.0 - smoothstep( 3.5, 9.0, uH ) );",
      "  foam *= mix( mix( 0.22 + 0.78 * streak, 1.0, core * 0.55 ), 1.0, far );",
      "  foam = clamp( foam * ( 0.85 + 0.30 * uFoam ), 0.0, 1.0 );",
      "  foam = mix( foam, max( foam, smoothstep( 0.40, 0.75, up + 0.25 * side ) * ( 1.0 - sk ) ), far );",
      // ---- normal
      "  vec3 nrm = normalize( vNrm );",
      "  if ( dot( nrm, V ) < 0.0 ) nrm = -nrm;",
      "  vec3 Tt = cross( vec3( 0.0, 1.0, 0.0 ), nrm );",
      "  float tl = length( Tt );",
      "  Tt = tl > 0.08 ? Tt / tl : vec3( 1.0, 0.0, 0.0 );",
      "  vec3 Bt = cross( nrm, Tt );",
      /* RIPPLES ON THE FACE: wide, low, slightly slanted swells climbing the
         wall (a bore's face is being fed from below), the slope taken by
         finite differences so every crest of every ripple catches the sky. */
      "  vec2 rq = vec2( x * 0.24 + arc * 0.03, arc * 0.36 + T * uRollV * 0.40 );",
      "  float r0 = fbm( rq, fine ), rx = fbm( rq + vec2( 0.35, 0.0 ), fine ), ry = fbm( rq + vec2( 0.0, 0.35 ), fine );",
      "  vec2 rq2 = vec2( x * 0.80 - arc * 0.08, arc * 1.15 + T * uRollV * 1.0 ) + 17.0;",
      "  float s0 = vn( rq2 ), sx = vn( rq2 + vec2( 0.3, 0.0 ) ), sy = vn( rq2 + vec2( 0.0, 0.3 ) );",
      "  vec2 gW = ( vec2( rx - r0, ry - r0 ) * 3.2 + vec2( sx - s0, sy - s0 ) * 1.6 * fine ) * mix( 1.0, 0.35, smoothstep( 0.4, 0.9, 1.0 - dot( nrm, V ) ) );",
      "  vec2 gA = cA.yz * 3.0, gB = cB.yz * 3.0;",
      "  vec2 g = ( gA * 0.55 + gB * 0.35 * fine ) * foam + gW * ( 1.0 - foam );",
      "  vec3 N = normalize( nrm - ( Tt * g.x + Bt * g.y ) * 0.45 * ( 1.0 - far * 0.7 ) );",
      "  float ndl = max( dot( N, uSunDir ), 0.0 );",
      "  float ndlW = clamp( ( dot( N, uSunDir ) + 0.45 ) / 1.45, 0.0, 1.0 );",
      "  vec3 hemiL = mix( uGndCol, uSkyCol, 0.5 + 0.5 * N.y );",
      // ---- the body: dark, deep, GLOSSY
      "  vec3 body = mix( uBodySea, uBodyMud, pow( tb, 1.2 ) );",
      // darker at the heavy base, a little lighter up the face, never uniform along it
      "  body *= ( 0.78 + 0.44 * nA ) * mix( 0.55, 1.05, smoothstep( 0.0, 0.8, up ) );",
      "  vec3 bodyLit = body * ( hemiL * 0.6 + uSunCol * ndl * 0.45 );",
      "  vec3 Rv = reflect( -V, N );",
      "  float fres = pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 5.0 );",
      // storm sky in the face: horizon glare low, the heavy overcast above
      "  vec3 skyR = mix( uGndCol * 0.6, mix( uSkyCol * 1.35, uSkyCol * 0.95, smoothstep( 0.25, 0.9, Rv.y ) ), smoothstep( -0.15, 0.12, Rv.y ) );",
      "  float refl = 0.05 + 0.75 * fres;",
      "  bodyLit = mix( bodyLit, skyR, refl * ( 1.0 - 0.6 * tb ) );",
      // SHEEN: every ripple crest that tilts up at the bright sky flashes
      "  float sheen = pow( smoothstep( 0.22, 0.70, Rv.y ), 3.0 ) * smoothstep( 0.0, 0.5, dot( N, V ) );",
      "  bodyLit += uSkyCol * sheen * ( 0.30 + 0.5 * fres ) * ( 1.0 - 0.7 * tb ) * ( 1.0 - far );",
      "  vec3 Hv = normalize( uSunDir + V );",
      "  float ndh = max( dot( N, Hv ), 0.0 );",
      "  bodyLit += uSunCol * ( pow( ndh, 120.0 ) * 1.4 + pow( ndh, 16.0 ) * 0.10 ) * ( 1.0 - tb * 0.5 );",
      /* THE THIN BAND UNDER THE LIP. The water thins as it climbs into the
         crest and the light comes THROUGH it: a lighter green-brown band
         right under the churn, brightest with the sun behind the wave. */
      "  float band = side * ( 1.0 - sk ) * smoothstep( edge - 0.34, edge - 0.03, up ) * ( 1.0 - smoothstep( edge - 0.01, edge + 0.05, up ) );",
      "  float back = pow( max( dot( -V, uSunDir ), 0.0 ), 3.0 );",
      "  vec3 glow = mix( uGlowSea, uGlowMud, tb ) * ( hemiL * 1.3 + uSunCol * ( 0.35 + 1.4 * back ) );",
      "  bodyLit += glow * band * band * ( 0.75 + 0.5 * r0 ) * 1.1;",
      /* THE CURL IS THIN WATER, LIT THROUGH (2026-09-28). Under the thrown
         lip the surface faces DOWN and the water there is a sheet a metre
         thick: the light comes through it green-blue, not off it grey. The
         old shading lit that underside with the ground bounce only, so the
         overhang was a dark ledge under a white cap: a snowy crag. */
      "  float underC = side * ( 1.0 - sk ) * smoothstep( 0.55, 0.85, up ) * ( 1.0 - smoothstep( -0.55, 0.05, N.y ) );",
      "  float thinL = max( underC, band * 0.6 );",
      "  vec3 trans = mix( vec3( 0.035, 0.20, 0.17 ), vec3( 0.10, 0.12, 0.07 ), tb * 0.75 );",
      "  bodyLit += trans * thinL * ( uSkyCol * 0.9 + uSunCol * ( 0.25 + 1.8 * back ) ) * ( 0.8 + 0.4 * r0 );",
      // ---- the foam: lit boils with dark creases, dirty with sediment
      "  vec3 fc = mix( uFoamClean, uFoamMud, smoothstep( 0.0, 0.7, tb ) );",
      // far out the churn averages to the white line, unless it is mud
      "  fc = mix( fc, uFoamClean, far * 0.6 * ( 1.0 - tb * 0.7 ) );",
      "  float ao = mix( 0.80, 1.0, smoothstep( 0.0, 0.75, cA.x ) ) * mix( 0.78, 1.0, smoothstep( 0.2, 0.9, cB.x ) ) * mix( 1.0, mix( 0.82, 1.0, boilV ), roll );",
      "  ao = mix( ao, 1.0, far * 0.75 );",
      /* WET FOAM, NOT SNOW (2026-09-28). Aerated water is mostly water: its
         creases show the green body through instead of going dark grey (a
         dark crease under a white cap is exactly how rock reads), it is a
         touch less white than paper, it keeps a sky sheen at grazing angles,
         and every wet bubble surface catches a sun glint. */
      "  float fAlb = mix( 0.80, 0.92, streak ) * ( 0.88 + 0.16 * nA );",
      "  vec3 foamLit = fc * fAlb * ( hemiL * 0.95 + uSunCol * ( 0.30 + 0.62 * ndlW ) );",
      "  vec3 crease = ( bodyLit * 1.3 + trans * ( uSkyCol * 0.8 + uSunCol * ( 0.2 + back ) ) );",
      "  foamLit = mix( crease, foamLit, clamp( ao * 1.25 - 0.25, 0.0, 1.0 ) );",
      "  foamLit = mix( foamLit, skyR, 0.18 * fres );",
      "  foamLit += uSunCol * ( pow( ndh, 60.0 ) * 0.55 + pow( ndh, 12.0 ) * 0.06 ) * ( 1.0 - far ) * ( 1.0 - 0.4 * tb );",
      // thin foam is aerated water lit through, not paper on top of it
      "  vec3 thinLit = mix( bodyLit * 1.6 + glow * 0.8, foamLit, smoothstep( 0.35, 0.9, foam ) );",
      "  vec3 col = mix( bodyLit, mix( thinLit, foamLit, far ), foam );",
      // ---- alpha: the back tail melts into the sea, the skirt is patches, the ends dissolve
      "  float a = mix( smoothstep( 0.0, 0.14, up ), 1.0, side );",
      "  a *= mix( 1.0, clamp( skirtF * 1.3 + 0.18 * ( 1.0 - smoothstep( 0.0, 0.9, sdn ) ), 0.0, 1.0 ), sk );",
      "  a *= 1.0 - smoothstep( 0.88, 1.0, abs( x ) / uHalfW );",
      // the crash hand-off: the wave comes down and the bore takes over
      "  a *= uFade;",
      "  if ( a < 0.02 ) discard;",
      "  gl_FragColor = vec4( col, a );",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Face",
      uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: true,
      extensions: { derivatives: true },
    });
    mat.userData.uni = uni;
    return mat;
  }

  /* ============================================================
     THE CREST SPRAY: one Points draw, fully GPU-animated.
     Three populations in one buffer:
       DROPLETS (kind 0): small, dense, launched up off the lip and dragged
         back and down by the wind.
       MIST (kind 1): soft puffs that rise and stream far back behind the
         crest; the plume you see torn off every big breaker.
       VEIL (kind 2): huge, faint, slow puffs hugging the crest and the top
         of the front. They are what dissolves the lip's silhouette into the
         sky: without them the crest is a hard cut-out edge, which is the
         single strongest "this is a mesh" tell.
     The wind blows toward local -z (against the travel), which is what
     tears plumes back off a real bore. Every sprite is a round, lumpy,
     alpha-falloff puff computed in the fragment shader: never a card, never
     a triangle, and it fades out before it reaches the lens.
     ============================================================ */
  function tsuSprayBuild(W, H, hJitAt, zJitAt, rnd0, light) {
    /* ONE draw off the caller's stream, then a private one: the sprite count
       is a look knob, and tuning it must never reroll the caller's seeded
       gameplay stream (the survival director's bearing, timing, crowd). */
    let st = (Math.floor(rnd0() * 4294967296) >>> 0) || 1;
    const rnd = function () {
      st = (st + 0x6D2B79F5) >>> 0;
      let t = st;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const N = Math.max(600, Math.min(1800, Math.round(W * 3.0)));
    const zs = H / 34;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), kind = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = ((i + rnd()) / N - 0.5) * W * 0.96;
      pos[i * 3] = x;
      pos[i * 3 + 1] = hJitAt(x) * H;
      pos[i * 3 + 2] = 2.6 * zs + zJitAt(x);
      seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
      const k = rnd();
      kind[i] = k < 0.26 ? 0 : (k < 0.50 ? 1 : (k < 0.62 ? 2 : 3));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uTime: { value: 0 }, uHs: { value: 1 }, uH: { value: H }, uCurl: { value: 0.5 },
      uTurbid: { value: 0 }, uSpray: { value: 1 }, uWind: { value: 6 }, uScale: { value: 450 },
      uSeaLocal: { value: 0.5 }, uHalfW: { value: W * 0.5 }, uFade: { value: 1 },
      uClean: { value: new THREE.Color(0.72, 0.75, 0.76) },
      uMud: { value: new THREE.Color(0.42, 0.385, 0.32) },
    });
    uni.uSunCol = light.uSunCol; uni.uSkyCol = light.uSkyCol;
    const VERT = [
      "attribute vec4 aSeed;",
      "attribute float aKind;",
      "uniform float uTime, uHs, uH, uCurl, uTurbid, uSpray, uWind, uScale, uSeaLocal, uHalfW, uFade;",
      "uniform vec3 uClean, uMud, uSunCol, uSkyCol;",
      "varying vec4 vCol;",
      "varying vec3 vPuff;",   // seed, lumpiness, kind
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vec4 s = aSeed;",
      "  float kd = aKind;",
      "  float L = kd > 2.5 ? 2.2 + 1.8 * s.y : ( kd > 1.5 ? 5.0 + 4.0 * s.y : ( kd > 0.5 ? 3.4 + 2.6 * s.y : 1.3 + 1.2 * s.y ) );",
      "  float cyc = uTime / L + s.x;",
      "  float life = fract( cyc );",
      "  float gen = floor( cyc );",
      "  float tt = life * L;",
      "  float sh = sqrt( max( 0.15, uHs ) );",
      "  vec3 p = position * vec3( 1.0, uHs, uHs );",
      "  p.x += ( fract( sin( gen * 12.9898 + s.z * 78.233 ) * 43758.5453 ) - 0.5 ) * 4.0;",
      "  p.z += uCurl * 8.0 * uHs * 0.8;",
      "  float size, a;",
      "  float ground = 1.0;",
      "  if ( kd > 2.5 ) {",
      /* THE FOOT BURST: where the wall's base slams into the land it
         explodes UP, a boiling white column thrown forward onto the street.
         Born on the water at the toe, launched to 15-55% of the wall. */
      "    float hmax = uH * ( 0.15 + 0.40 * s.w * s.w );",
      "    float g = 7.0;",
      "    float vy = sqrt( 2.0 * g * hmax );",
      "    p.y = uSeaLocal + 0.5 + max( 0.0, vy * tt - 0.5 * g * tt * tt );",
      "    p.z = position.z * uHs + ( 2.8 + 1.5 * s.z ) * uH / 34.0 + ( 1.5 + 3.5 * s.z ) * tt;",
      "    p.x += ( s.y - 0.5 ) * 3.0 * tt;",
      "    size = ( 4.0 + 9.0 * s.z ) * ( 0.4 + 0.6 * uHs ) * ( 0.5 + 1.3 * life );",
      "    a = 0.62 * smoothstep( 0.0, 0.1, life ) * pow( 1.0 - life, 1.1 );",
      "    ground = 0.0;",
      "  } else if ( kd > 1.5 ) {",
      /* the veil: a churning cloud ON the roller, not behind it. s.w is how
         far down the front a puff is born (0 = the lip, 1 = 12% down the
         wall); the deep ones sit out in front of the face and tumble down
         with the roll, the high ones lift off the lip and blow back. */
      "    float dn = s.w;",
      "    p.y += -uH * 0.12 * dn + ( 0.25 + 1.0 * ( 1.0 - dn ) ) * sh * tt - dn * 1.3 * sh * tt;",
      "    p.z += ( 1.4 + 2.6 * dn + 2.0 * s.z ) * uH / 34.0 - uWind * 0.30 * ( 1.0 - dn ) * tt;",
      "    p.x += ( s.y - 0.5 ) * 1.2 * tt;",
      "    size = ( 6.0 + 10.0 * s.z ) * ( 0.35 + 0.65 * uHs ) * ( 0.75 + 0.7 * life );",
      "    a = 0.30 * ( 1.0 - 0.5 * dn ) * sin( 3.14159 * life );",
      "  } else if ( kd > 0.5 ) {",
      "    p.y += uH * 0.03 + ( 1.0 + 2.6 * s.w ) * sh * tt + 0.08 * tt * tt;",
      "    p.z -= uWind * ( 0.9 * tt + 0.10 * tt * tt );",
      "    p.x += ( s.z - 0.5 ) * 1.6 * tt;",
      "    size = ( 7.0 + 10.0 * s.z ) * ( 0.4 + 0.6 * uHs ) * ( 1.0 + 1.4 * life );",
      "    a = 0.40 * sin( 3.14159 * life );",
      "  } else {",
      "    float vy = ( 2.5 + 7.0 * s.w ) * sh;",
      "    p.y += vy * tt - 3.4 * tt * tt;",
      "    p.z += ( 0.8 + 2.2 * s.z ) * tt - uWind * 0.6 * tt * tt;",
      "    p.x += ( s.z - 0.5 ) * 2.0 * tt;",
      "    size = ( 0.6 + 1.3 * s.y ) * ( 0.6 + 0.4 * uHs ) * ( 1.0 + 1.5 * life );",
      "    a = 0.50 * smoothstep( 0.0, 0.08, life ) * pow( 1.0 - life, 1.3 );",
      "  }",
      // no crest to tear where the wave has tapered into the sea
      "  a *= uSpray * mix( 1.0, smoothstep( 0.25, 0.6, position.y / max( 0.001, uH / uHs ) ), ground );",
      /* SPRAY IS AIR AND WATER, NOT A DUST CLOUD (2026-10-20). Seen from
         the sea behind the bore, 400-odd mist puffs at 0.66 alpha in the full
         mud colour laid a tan band over the whole island: the "brown haze"
         that hid the wave. Torn-off spray of a filthy wave is still pale
         (the droplets scatter white); it takes only part of the mud, and the
         mist is thinner. */
      "  vec3 c = mix( uClean, uMud, smoothstep( 0.0, 0.7, uTurbid ) * mix( 0.45, 0.85, step( 2.5, kd ) ) ) * ( 0.9 + 0.1 * s.y );",
      // spray is lit from everywhere at once (it scatters): never darker than overcast
      "  vec3 lit = max( uSkyCol * 0.95 + uSunCol * 0.55, vec3( 0.42 ) );",
      "  vCol = vec4( c * lit, a * uFade );",
      "  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );",
      "  float dz = -mvPosition.z;",
      // a puff that reaches the lens fades instead of filling the frame
      "  vCol.a *= smoothstep( 1.5, 9.0, dz );",
      "  vPuff = vec3( s.z * 17.0 + gen * 3.1, s.w, kd );",
      "  gl_Position = projectionMatrix * mvPosition;",
      // a droplet smaller than a couple of pixels is a white dot, not spray:
      // it fades out instead of being clamped up to a one-pixel speck
      "  float psz = size * projectionMatrix[1][1] * uScale / max( 0.5, dz );",
      "  vCol.a *= smoothstep( 1.2, 3.5, psz );",
      "  gl_PointSize = vCol.a > 0.003 ? clamp( psz, 1.0, 420.0 ) : 0.0;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");
    const FRAG = [
      "varying vec4 vCol;",
      "varying vec3 vPuff;",
      "#include <fog_pars_fragment>",
      TSU_GLSL_NOISE,
      "void main() {",
      "  vec2 c = gl_PointCoord * 2.0 - 1.0;",
      "  float d = dot( c, c );",
      "  if ( d > 1.0 ) discard;",
      "  float a = vCol.a * ( 1.0 - d ) * ( 1.0 - d );",
      // the big puffs are lumpy, not discs: a cheap two-octave billow inside the falloff
      "  if ( vPuff.z > 0.5 ) {",
      "    vec2 q = gl_PointCoord * 2.6 + vec2( vPuff.x, vPuff.x * 0.7 );",
      "    float n = vn( q ) * 0.65 + vn( q * 2.3 + 4.1 ) * 0.35;",
      "    a *= smoothstep( 0.15, 0.85, n + 0.35 * ( 1.0 - d ) );",
      "  }",
      "  gl_FragColor = vec4( vCol.rgb, a );",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Spray", uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    return { points: pts, geo: geo, mat: mat, count: N };
  }

  /* THE WAKE SHREDS ARE GONE (2026-10-20). Sixty flat tapered strips, one
     flat colour each, sliding back over the sea behind the front: from any
     height they read as exactly what they were, white lines painted on the
     water. The churn behind a bore is the sea's own surface (its froth, chop
     and boiling displacement: dwFroth / dwChopGrad / uDwChurn), and the
     breaking white water is volume on the bore's fronts
     (world/tsunami_whitewater.js). */
  CBZ.tsuFaceBuild = function (opts) {
    opts = opts || {};
    const H = Number.isFinite(opts.height) ? +opts.height : 34;
    const W = Number.isFinite(opts.width) ? +opts.width : 320;
    const zs = H / 34;
    const rnd = typeof opts.rnd === "function" ? opts.rnd : Math.random;
    const grp = new THREE.Group();
    const ROWS = TSU_ROWS, COLS = TSU_COLS;
    const geoms = [], mats = [];
    const light = tsuLightUniforms();

    /* The crest is not a ruler: per-column height and forward-lead jitter,
       drawn on ~10 m knots and smoothstepped between (per-column draws at
       this pitch would be corduroy), plus beating sines for runs of taller
       and lower crest, plus an end taper so the wave dies into the sea
       sideways instead of stopping on a vertical edge. */
    const zJit = [], hJit = [];
    const phA = rnd() * 6.283, phB = rnd() * 6.283, phC = rnd() * 6.283, phD = rnd() * 6.283;
    const KSTEP = Math.max(3, Math.round(10 / (W / COLS))), KN = Math.ceil(COLS / KSTEP) + 2;
    const knH = [], knZ = [];
    for (let k = 0; k < KN; k++) { knH.push(0.96 + rnd() * 0.08); knZ.push((rnd() - 0.5) * 2.0); }
    const knot = function (arr, c) {
      const f = c / KSTEP, i = Math.min(KN - 2, Math.floor(f)), a = f - i;
      return arr[i] + (arr[i + 1] - arr[i]) * a * a * (3 - 2 * a);
    };
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.14);
      const taper = 0.08 + 0.92 * edge * edge * (3 - 2 * edge);
      const lf = 1 + 0.035 * Math.sin(u * 9.7 + phA) + 0.02 * Math.sin(u * 23 + phB) + 0.01 * Math.sin(u * 57 + phD);
      zJit.push(knot(knZ, c) + Math.sin(u * 6.9 + phC) * 1.8 + Math.sin(u * 31 + phD) * 0.6);
      hJit.push(knot(knH, c) * lf * taper);
    }
    let hMean = 0; for (let c = 0; c <= COLS; c++) hMean += hJit[c];
    hMean /= COLS + 1;
    let hVar = 0; for (let c = 0; c <= COLS; c++) { const d = hJit[c] - hMean; hVar += d * d; }
    const crestVar = Math.sqrt(hVar / (COLS + 1)) / Math.max(0.001, hMean);
    const endTaper = Math.min(hJit[0], hJit[COLS]) / Math.max(0.001, hMean);
    const colAt = (x) => Math.max(0, Math.min(COLS, Math.round((x / W + 0.5) * COLS)));

    // ---- the rest pose, baked once
    const lay = tsuRowsLayout(ROWS);
    let arcToe = 0, arcEnd = lay[ROWS - 1].arc;
    for (let r = 1; r < ROWS; r++) if (lay[r - 1].k <= TSU_TOE_K && lay[r].k >= TSU_TOE_K) {
      const f = (TSU_TOE_K - lay[r - 1].k) / Math.max(1e-6, lay[r].k - lay[r - 1].k);
      arcToe = lay[r - 1].arc + (lay[r].arc - lay[r - 1].arc) * f;
    }
    const rowSide = [], rowSk = [], rowSd = [];
    for (let r = 0; r < ROWS; r++) {
      const k = lay[r].k;
      rowSide.push(smooth01(TSU_CREST_K - 0.8, TSU_CREST_K + 0.8, k));
      rowSk.push(smooth01(TSU_TOE_K - 0.3, TSU_TOE_K + 1.0, k));
      rowSd.push(Math.max(0, Math.min(1, (lay[r].arc - arcToe) / Math.max(1e-6, arcEnd - arcToe))));
    }
    const n = ROWS * (COLS + 1);
    const pos = new Float32Array(n * 3);
    const face = new Float32Array(n * 4), faceD = new Float32Array(n * 4);
    const tx = new Float32Array(n * 3), ts = new Float32Array(n * 3);
    for (let r = 0; r < ROWS; r++) {
      const L = lay[r], yf = L.yf, side = rowSide[r];
      for (let c = 0; c <= COLS; c++) {
        const vi = r * (COLS + 1) + c, x = (c / COLS - 0.5) * W;
        pos[vi * 3] = x;
        pos[vi * 3 + 1] = yf * H * hJit[c];
        pos[vi * 3 + 2] = L.z * zs + zJit[c] * Math.max(Math.max(0, yf), side);
        face[vi * 4] = x; face[vi * 4 + 1] = L.arc * zs; face[vi * 4 + 2] = yf; face[vi * 4 + 3] = side;
      }
    }
    // tangents and d/darc of the row parameters, by central differences
    for (let r = 0; r < ROWS; r++) {
      const r0 = Math.max(0, r - 1), r1 = Math.min(ROWS - 1, r + 1);
      const da = Math.max(1e-4, (lay[r1].arc - lay[r0].arc) * zs);
      const dyf = (lay[r1].yf - lay[r0].yf) / da, dsd = (rowSide[r1] - rowSide[r0]) / da;
      for (let c = 0; c <= COLS; c++) {
        const vi = r * (COLS + 1) + c;
        const a0 = r0 * (COLS + 1) + c, a1 = r1 * (COLS + 1) + c;
        for (let k = 0; k < 3; k++) ts[vi * 3 + k] = (pos[a1 * 3 + k] - pos[a0 * 3 + k]) / da;
        const c0 = Math.max(0, c - 1), c1 = Math.min(COLS, c + 1);
        const b0 = r * (COLS + 1) + c0, b1 = r * (COLS + 1) + c1;
        const dx = Math.max(1e-4, pos[b1 * 3] - pos[b0 * 3]);
        for (let k = 0; k < 3; k++) tx[vi * 3 + k] = (pos[b1 * 3 + k] - pos[b0 * 3 + k]) / dx;
        faceD[vi * 4] = dyf; faceD[vi * 4 + 1] = dsd; faceD[vi * 4 + 2] = rowSk[r]; faceD[vi * 4 + 3] = rowSd[r];
      }
    }
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
      const a0 = r * (COLS + 1) + c, b0 = a0 + 1, a1 = a0 + COLS + 1, b1 = a1 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aFace", new THREE.BufferAttribute(face, 4));
    geo.setAttribute("aFaceD", new THREE.BufferAttribute(faceD, 4));
    geo.setAttribute("aTx", new THREE.BufferAttribute(tx, 3));
    geo.setAttribute("aTs", new THREE.BufferAttribute(ts, 3));
    geo.setIndex(idx);
    geoms.push(geo);
    const wallMat = tsuWallMaterial(light);
    const wu = wallMat.uniforms;
    wu.uH.value = H;
    wu.uHalfW.value = W * 0.5;
    wu.uLumpS.value = Math.max(1.6, Math.min(3.2, H * 0.16));
    wu.uLP.value.set(rnd() * 6.283, rnd() * 6.283, rnd() * 6.283);
    mats.push(wallMat);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.renderOrder = 3;
    wall.frustumCulled = false;     // the vertex shader throws it well past its rest bounds
    grp.add(wall);

    const spray = tsuSprayBuild(W, H, (x) => hJit[colAt(x)], (x) => zJit[colAt(x)], rnd, light);
    spray.mat.uniforms.uFade = wu.uFade;         // ONE fade for wall and spray
    geoms.push(spray.geo); mats.push(spray.mat); grp.add(spray.points);

    return {
      group: grp, wall: wall, basePos: new Float32Array(pos),
      cols: COLS, rows: ROWS, baseH: H, width: W,
      // evidence: relative std-dev of crest height along the front (0 = a
      // ruler), and the end columns' height as a fraction of the mean
      crestVar: crestVar, endTaper: endTaper,
      spray: spray, light: light,
      drawCalls: 2, sprayCount: spray.count,
      foams: [spray.points], streaks: [],
      geoms: geoms, mats: mats,
    };
  };

  /* Per-frame: uniform writes only. The wall, the spray and the wake all
     animate on the GPU from the same clock and the same live height, so
     nothing can tear away from the lip it belongs to. */
  CBZ.tsuFaceUpdate = function (h, s) {
    if (!h || !h.wall) return false;
    s = s || {};
    const t = Number.isFinite(s.t) ? +s.t : 0;
    const H = Math.max(0.3, Number.isFinite(s.height) ? +s.height : h.baseH);
    const hs = H / Math.max(0.001, h.baseH);
    const turbid = Math.max(0, Math.min(1, Number.isFinite(s.turbid) ? +s.turbid : 0));
    const curl = Math.max(0, Math.min(1.6, Number.isFinite(s.curl) ? +s.curl : 0.5));
    const foamGain = Number.isFinite(s.foam) ? +s.foam : 0.7;

    if (Number.isFinite(s.x) && Number.isFinite(s.z)) h.group.position.set(s.x, +s.y || 0, s.z);
    if (Number.isFinite(s.dirX) && Number.isFinite(s.dirZ)) h.group.rotation.y = Math.atan2(s.dirX, s.dirZ);
    // where the sea is, in the face's own frame (the skirt and wake sit on it)
    let seaY = Number.isFinite(s.seaY) ? +s.seaY : NaN;
    if (!Number.isFinite(seaY)) {
      const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
      if (ev && Number.isFinite(ev.level)) seaY = ev.level;
    }
    const seaLocal = Number.isFinite(seaY) ? Math.max(-1, Math.min(H * 0.3, seaY - h.group.position.y)) : 0.5;

    const u = h.wall.material.uniforms;
    // s.fade 0..1: the crash hand-off (wall and spray together)
    u.uFade.value = Number.isFinite(s.fade) ? Math.max(0, Math.min(1, +s.fade)) : 1;
    u.uTime.value = t;
    u.uTurbid.value = turbid;
    u.uCurl.value = curl;
    u.uCurlN.value = Math.min(1, curl / 1.2);
    u.uH.value = H;
    u.uHs.value = hs;
    u.uFoam.value = foamGain;
    u.uSeaLocal.value = seaLocal;
    u.uSkirt.value = 0.75 + 0.45 * turbid;
    u.uLumpA.value = Math.max(0.25, Math.min(1.3, H * 0.032)) * (0.75 + 0.45 * turbid);
    u.uRollV.value = (2.4 + 2.6 * turbid + 1.2 * curl) * Math.sqrt(Math.max(0.2, hs));
    /* THE LIP TEARS HARDEST WHEN IT IS BROKEN: curl is smallest exactly then
       (the callers fold the overhang at the crash), so sediment drives the
       crest raggedness too. */
    u.uLobe.value.set(
      H * 0.013 * (0.35 + 0.80 * curl + 0.95 * turbid),
      (2.4 * curl + 3.2 * turbid) * hs,
      H * 0.013 * (0.25 + 1.05 * turbid + 0.35 * curl),
      (0.6 + 1.8 * turbid) * hs);
    u.uLobeFrom.value = 0.79 - 0.13 * turbid;

    // the scene's ACTUAL light, shared by all three materials
    const L = h.light, sun = CBZ.sun, hemi = CBZ.hemi;
    if (sun) {
      const sm = sun.matrixWorld.elements;
      const tg = sun.target && sun.target.matrixWorld ? sun.target.matrixWorld.elements : null;
      const dx = sm[12] - (tg ? tg[12] : 0), dy = sm[13] - (tg ? tg[13] : 0), dz = sm[14] - (tg ? tg[14] : 0);
      const len = Math.hypot(dx, dy, dz) || 1;
      L.uSunDir.value.set(dx / len, dy / len, dz / len);
      const si = sun.intensity;
      L.uSunCol.value.setRGB(sun.color.r * si, sun.color.g * si, sun.color.b * si);
    }
    if (hemi) {
      const hi = hemi.intensity;
      L.uSkyCol.value.setRGB(hemi.color.r * hi, hemi.color.g * hi, hemi.color.b * hi);
      L.uGndCol.value.setRGB(hemi.groundColor.r * hi, hemi.groundColor.g * hi, hemi.groundColor.b * hi);
    }

    if (h.spray) {
      const su = h.spray.mat.uniforms;
      su.uTime.value = t; su.uHs.value = hs; su.uH.value = H;
      su.uCurl.value = curl; su.uTurbid.value = turbid;
      // a wave standing up hard, or one breaking through a town, tears the most
      const burst = Number.isFinite(s.spray) ? Math.max(0, +s.spray) : 1;
      su.uSpray.value = Math.min(2.0, (0.45 + 0.55 * curl + 0.55 * turbid) * (0.6 + 0.5 * foamGain) * burst);
      su.uWind.value = 4.5 + 3.5 * Math.sqrt(Math.max(0.2, hs));
      su.uSeaLocal.value = seaLocal;
      const r = CBZ.renderer;
      const ph = r && r.domElement ? r.domElement.height : 900;
      su.uScale.value = ph * 0.5;
    }
    return true;
  };

  CBZ.tsuFaceDispose = function (h) {
    if (!h) return false;
    if (h.group && h.group.parent) h.group.parent.remove(h.group);
    for (let i = 0; i < (h.geoms || []).length; i++) h.geoms[i].dispose();
    for (let i = 0; i < (h.mats || []).length; i++) if (h.mats[i].dispose) h.mats[i].dispose();
    h.group = null; h.wall = null; h.spray = null; h.geoms = []; h.mats = [];
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
  /* THE CPU TWIN OF uDwAhead: metres the water at (x,z) sits BELOW the
     published mean because the tsunami front has not reached it yet. Every
     survival water query subtracts this, so the swimmer, the drowning test,
     the debris and the bots all agree with the sheet that is drawn. */
  // the island's shadow at (x, z) for a published lee record (cbzLeeShadow)
  function leeShadow(e, L, x, z) {
    const dx = +e.dx || 0, dz = +e.dz || 0, rx = x - (+e.cx || 0), rz = z - (+e.cz || 0);
    const s = rx * dx + rz * dz;
    const rl = (-rx * dz + rz * dx) - (+L.lc || 0), rs = s - (+L.sMid || 0);
    let c = 0.5 - 0.5 * rs / Math.max(Math.hypot(rl, rs), 1);
    c = c < 0 ? 0 : c > 1 ? 1 : c;
    const ex = Math.pow(c, LEE_EXP);
    const lw = Math.max(1, +L.lw || 1), D = Math.max(1, +L.d0 || 20) + LEE_SPREAD * Math.max(0, s - (+L.sMax || 0));
    let t = (Math.abs(rl) - lw) / D; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return (1 - ex) * (1 - t * t * (3 - 2 * t));
  }
  CBZ.waterLeeShadow = function (x, z) {
    const e = waterEvent;
    return e && e.lee && e.lee.on ? leeShadow(e, e.lee, x, z) : 0;
  };
  function frontFormulaDrop(x, z) {
    const e = waterEvent;
    const L = e && e.lee && e.lee.on ? e.lee : null;
    if (!e || (!(e.aheadDrop > 0.001) && !L)) return 0;
    const fd = (x - (+e.cx || 0)) * (+e.dx || 0) + (z - (+e.cz || 0)) * (+e.dz || 0) - (Number.isFinite(e.frontS) ? +e.frontS : -1e9);
    let k = (fd + 1) / 8; k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    let d = Math.max(0, +e.aheadDrop || 0) * k;
    if (L) d += leeShadow(e, L, x, z) * ((+L.b || 0) + ((+L.a || 0) - (+L.b || 0)) * k);
    return d;
  }
  /* THE STRAIGHT FRONT, alone: what the SEA does (the drawn-back water ahead
     of the bore, the raised water behind it). The run-up field forces its
     open-sea cells to exactly this, so the sheet is continuous across the
     field's edge. */
  CBZ.waterFrontFormulaDrop = frontFormulaDrop;
  /* ...AND ON THE LAND, THE RUN-UP FIELD (world/tsunami_runup.js). While a
     field is attached its surface IS the water inside its domain: the drop
     is whatever puts the published mean onto the field's surface (a dry cell
     sits 0.6 m under its own bed, so every depth query reads it as dry).
     Its edge fades to the formula over a cell and a half. */
  const _runS = {};
  function runupField() { return CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null; }
  function runupMean() {
    return CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : seaY();
  }
  CBZ.waterFrontDropAt = function (x, z) {
    const base = frontFormulaDrop(x, z);
    const F = runupField();
    if (!F) return base;
    const r = F.sample(x, z, _runS);
    if (!(r.in > 0)) return base;
    const d = runupMean() - r.eta;
    return r.in >= 1 ? d : base + (d - base) * r.in;
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
    const drop = CBZ.waterFrontDropAt(x, z);
    out.wet = wet; out.frontDistance = fd; out.mean = mean - drop;
    out.height = CBZ.waterDisasterSurfaceY(x, z, mean - drop, amp, chop, t);
    let flow = wet && Number.isFinite(e.flow) ? e.flow : 0;
    /* THE RIVER BEHIND A BORE IS FASTEST RIGHT BEHIND IT. A tsunami front
       drags the water in its first few tens of metres at close to its own
       speed; further back the flood slows to a deep, heavy current. So the
       published flow is the flood's, and the last 45 m behind a live front
       run up to 2.2x it: caught near the wall you are going where it goes. */
    if (phase === "sweep" && e.kind === "tsunami" && fd < 0) flow *= 1 + 1.2 * Math.max(0, 1 + fd / 45);
    out.currentX = dx * flow; out.currentZ = dz * flow;
    /* ON THE LAND THE CURRENT IS THE FIELD'S: down the street it is running
       down, round the building it is splitting on, back to sea on the
       backwash — never one heading for the whole island. */
    const F = runupField();
    if (F) {
      const r = F.sample(x, z, _runS);
      if (r.in > 0) {
        // on the forced open sea the current stays the director's
        const k = r.in * (1 - r.forced);
        out.wet = r.in >= 1 ? r.depth > 0.05 : (r.depth > 0.05 || out.wet);
        out.currentX = out.currentX * (1 - k) + r.u * k;
        out.currentZ = out.currentZ * (1 - k) + r.v * k;
        out.runup = true; out.depth = r.depth; out.speed = r.speed;
        flow = Math.hypot(out.currentX, out.currentZ) * (r.u * dx + r.v * dz < 0 ? -1 : 1);
      }
    }
    out.foam = phase === "sweep" ? Math.max(0, 1 - Math.abs(fd) / Math.max(1, +e.frontWidth || 18)) : 0;
    /* THE SEDIMENT LOAD AND THE UNDERTOW, on the same descriptor, because they
       are the same water. `sediment` is the bore's own load (the wall's
       colour, the white water's dirt) and the honest "is this a debris soup"
       test for anything entrained in it; the SEA's colour is the silt field's
       (world/tsunami_silt.js), placed where the scour was. `undertow` is the flow being NEGATIVE — the drain dragging seaward —
       which is the half of a tsunami that actually drowns people, and it is a
       sign, not a second field. */
    out.sediment = out.wet && Number.isFinite(e.sediment) ? e.sediment : 0;
    out.undertow = flow < 0 ? -flow : 0;
    return out;
  };

  /* ============================================================
     10. CAUSTICS ON THE FLOOR, POOLS, AND THE SEAS NOBODY ELSE DRIVES
     ============================================================ */

  /* ---- SEABED CAUSTICS ---------------------------------------------------
     The web of focused sunlight on a shallow sandy bottom. Applied to the
     FLOOR's own material (a patched clone, chained onto any hook it already
     has, exactly like the veil above), so it is right from above — seen
     through the translucent sea — and from below, with no extra geometry.
     Only fragments below the live sea level get it, it dims and blurs with
     the depth of water the light has crossed (gone by ~20 m), and it follows
     the sun. Uses the same tile, scale and drift as the shallow-water glints
     in cbzShadeSea, so the two line up. */
  const CAU_U = {
    uCauSeaY: { value: -0.48 },
    uCauTime: { value: 0 },
    uCauSun: { value: new THREE.Vector4(1, 1, 1, 0) },   // rgb sun * gain, w = on
    uCauTex: { value: null },
  };
  CBZ.waterCausticUniforms = CAU_U;
  const _cauCache = new WeakMap();
  function cauBefore(shader) {
    if (shader.vertexShader.indexOf("#include <project_vertex>") < 0) return;
    if (shader.vertexShader.indexOf("#include <common>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <tonemapping_fragment>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <common>") < 0) return;
    if (!CAU_U.uCauTex.value) CAU_U.uCauTex.value = CBZ.waterCausticTexture();
    shader.uniforms.uCauSeaY = CAU_U.uCauSeaY;
    shader.uniforms.uCauTime = CAU_U.uCauTime;
    shader.uniforms.uCauSun = CAU_U.uCauSun;
    shader.uniforms.uCauTex = CAU_U.uCauTex;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCbzCauW;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n" +
        "vec4 cbzCauP = vec4( transformed, 1.0 );\n" +
        "#ifdef USE_INSTANCING\n  cbzCauP = instanceMatrix * cbzCauP;\n#endif\n" +
        "vCbzCauW = ( modelMatrix * cbzCauP ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vCbzCauW;\nuniform float uCauSeaY;\nuniform float uCauTime;\nuniform vec4 uCauSun;\nuniform sampler2D uCauTex;")
      .replace("#include <tonemapping_fragment>",
        "if ( uCauSun.w > 0.0 && vCbzCauW.y < uCauSeaY ) {\n" +
        "  float cbzCd = uCauSeaY - vCbzCauW.y;\n" +
        "  vec2 cbzCp = vCbzCauW.xz;\n" +
        "  vec2 cbzCa = cbzCp * 0.21 + vec2( uCauTime * 0.031, uCauTime * 0.017 );\n" +
        "  vec2 cbzCb = vec2( cbzCp.y, -cbzCp.x ) * 0.17 + vec2( -uCauTime * 0.023, uCauTime * 0.029 );\n" +
        "  float cbzCc = min( texture2D( uCauTex, cbzCa ).r, texture2D( uCauTex, cbzCb ).r );\n" +
        // light that has crossed cd metres of water no longer focuses: the
        // web dims, and right at the waterline there is no lens yet
        "  float cbzCk = exp( -cbzCd * 0.15 ) * smoothstep( 0.05, 0.7, cbzCd );\n" +
        "  gl_FragColor.rgb += gl_FragColor.rgb * uCauSun.rgb * ( cbzCc * cbzCc * 1.6 * cbzCk * uCauSun.w );\n" +
        "}\n#include <tonemapping_fragment>");
  }
  CBZ.waterCausticMaterial = function (mat) {
    if (!mat || CFG.WATER_CAUSTICS === false) return mat;
    if (mat.userData && mat.userData.cbzCaustic) return mat;
    const hit = _cauCache.get(mat);
    if (hit) return hit;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return mat;
    let clone;
    try { clone = mat.clone(); } catch (e) { return mat; }
    const prev = mat.onBeforeCompile;
    const prevSrc = (prev && prev !== THREE.Material.prototype.onBeforeCompile) ? String(prev) : "";
    clone.onBeforeCompile = prev ? function (sh) { prev.call(this, sh); cauBefore(sh); } : cauBefore;
    clone.customProgramCacheKey = function () { return "cbzCaustic|" + prevSrc; };
    clone.userData = Object.assign({}, clone.userData, { cbzCaustic: true });
    clone.needsUpdate = true;
    _cauCache.set(mat, clone);
    _cauCache.set(clone, clone);
    return clone;
  };
  CBZ.waterCausticsApply = function (obj) {
    if (!obj || CFG.WATER_CAUSTICS === false) return false;
    let n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const y = CBZ.waterCausticMaterial(o.material);
      if (y !== o.material) { o.material = y; n++; }
    });
    return n > 0;
  };
  // driven from waterDriveCommonUniforms (one sea is always driven)
  function causticDrive(u) {
    CAU_U.uCauTime.value = u && u.uSeaTime ? u.uSeaTime.value : CBZ.waterClock();
    let y = u && u.uCauSeaY ? u.uCauSeaY.value : seaY();
    if (CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.survSeaMeanY) {
      const iy = CBZ.survSeaMeanY();
      if (Number.isFinite(iy)) y = iy;
    }
    CAU_U.uCauSeaY.value = y;
    const s = u && u.uSunColor ? u.uSunColor.value : null;
    const L = u && u.uSunDir ? u.uSunDir.value : null;
    const up = L ? Math.max(0, Math.min(1, (L.y + 0.05) / 0.35)) : 1;
    const day = Math.max(0, Math.min(1, CBZ.dayness == null ? 1 : +CBZ.dayness));
    const g = 0.85 * up * (0.25 + 0.75 * day);
    if (s) CAU_U.uCauSun.value.set(s.r * g, s.g * g, s.b * g, CFG.WATER_CAUSTICS === false ? 0 : 1);
  }

  /* ---- POOL WATER ---------------------------------------------------------
     Swimming pools, spas and fountain basins were opaque turquoise Lambert
     slabs. Real pool water is a still, clear surface: the sky and the sun on
     top (the same reflected dome every sea uses), a faint wind ripple, and
     THROUGH it the bright tiled floor with the sunlight caustic web dancing
     across it — that web is what makes a pool read as a pool from any
     distance. The floor is drawn here (the water slab is opaque, the basin is
     under it), at uPoolDepth below the surface, so no extra mesh is needed.
     One shared material; world XZ drives the pattern, so it survives
     batch.js merging. */
  let poolMat = null;
  CBZ.waterPoolMaterial = function () {
    if (poolMat) return poolMat;
    const U = CBZ.waterCommonUniforms();
    U.uPoolDepth = { value: 1.6 };
    U.uPoolTile = { value: new THREE.Color(0x8fd8e6) };
    U.uPoolLine = { value: new THREE.Color(0x2c6f8a) };
    const vs = [
      "varying vec3 vPW;",
      "varying vec3 vPN;",
      // the shared fragment library declares these two; write them so every
      // varying it names is fed
      "varying float vCbzSteep;",
      "varying float vCbzFold;",
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vCbzSteep = 1.0; vCbzFold = 0.0;",
      "  vec4 lp = vec4(position, 1.0);",
      "  vec4 ln = vec4(normal, 0.0);",
      "  #ifdef USE_INSTANCING",
      "    lp = instanceMatrix * lp; ln = instanceMatrix * ln;",
      "  #endif",
      "  vec4 wp = modelMatrix * lp;",
      "  vPW = wp.xyz;",
      "  vPN = normalize((modelMatrix * ln).xyz);",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");
    const fs = [
      CBZ.waterFragmentDecl(),
      "uniform float uPoolDepth;",
      "uniform vec3 uPoolTile;",
      "uniform vec3 uPoolLine;",
      "varying vec3 vPW;",
      "varying vec3 vPN;",
      "#include <fog_pars_fragment>",
      "void main() {",
      "  vec3 V = normalize(cameraPosition - vPW);",
      "  float dist = length(cameraPosition - vPW);",
      // sides of the slab are the basin's waterline band, not water: keep
      // them the deep body colour so the edge reads as the tank wall
      "  if (vPN.y < 0.5) {",
      "    gl_FragColor = vec4(uPoolLine * 0.55, 1.0);",
      "  } else {",
      "    vec2 p = vPW.xz;",
      "    vec3 a = texture2D(uSeaNormal, p * 0.31 + vec2(uSeaTime * 0.021, -uSeaTime * 0.016)).rgb * 2.0 - 1.0;",
      "    vec3 b = texture2D(uSeaNormal, vec2(p.y, -p.x) * 0.47 + vec2(-uSeaTime * 0.018, uSeaTime * 0.024)).rgb * 2.0 - 1.0;",
      "    float fine = 1.0 - smoothstep(8.0, 60.0, dist);",
      "    vec3 N = normalize(vec3((a.r + b.r) * 0.10 * fine, 1.0, (a.g + b.g) * 0.10 * fine));",
      "    vec3 L = normalize(uSunDir);",
      "    float ndv = clamp(dot(N, V), 0.0, 1.0);",
      "    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);",
      // refraction: the floor point seen through the surface, shifted along
      // the refracted ray by the depth (Snell, eta = 1/1.333)
      "    vec3 rt = refract(-V, N, 0.75);",
      "    vec2 fp = p + rt.xz / max(0.2, -rt.y) * uPoolDepth;",
      "    vec2 tg = abs(fract(fp / 0.25) - 0.5);",
      "    float grout = smoothstep(0.47, 0.5, max(tg.x, tg.y));",
      "    vec3 floorC = mix(uPoolTile, uPoolLine, grout * 0.35);",
      "    float sunUp = smoothstep(-0.05, 0.25, L.y);",
      "    float cau = cbzCausticAt(fp * 1.6, uSeaTime * 1.3);",
      "    vec3 lit = floorC * (0.30 + 0.70 * sunUp * max(L.y, 0.0)) + uSunColor * floorC * cau * 0.55 * sunUp;",
      // the water column tints it: red goes first
      "    vec3 body = lit * exp(-uPoolDepth * vec3(0.45, 0.09, 0.06)) * 1.05;",
      "    vec3 sky = cbzSkyRadiance(reflect(-V, N), 0.0) * " + gnum(REFL_GAIN) + ";",
      "    vec3 c = mix(body, sky, fres);",
      "    vec3 H = normalize(L + V);",
      "    c += uSunColor * pow(max(dot(N, H), 0.0), 260.0) * 2.2 * sunUp;",
      "    gl_FragColor = vec4(c, 1.0);",
      "  }",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    poolMat = new THREE.ShaderMaterial({
      name: "CBZ Pool Water", uniforms: U, vertexShader: vs, fragmentShader: fs,
      fog: true, extensions: { derivatives: true },
    });
    poolMat.userData.waterUniforms = U;
    poolMat.userData.selfDrive = true;
    poolMat.userData.waterMode = "water-v3-pool";
    poolMat._shared = true;
    selfDriven.push(poolMat);
    return poolMat;
  };

  /* ---- THE SEAS NOBODY ELSE DRIVES ---------------------------------------
     The city sea is driven by city/world.js's day/night tick and the island
     sea by disaster_arena.js. Anything else built from this family (pools,
     a page's adopted sea) is driven here, once a frame, even while paused —
     a frozen pool next to a moving sea is the first thing an eye notices. */
  const selfDriven = [];
  CBZ.waterSelfDrive = function (mat) {
    if (mat && mat.userData && mat.userData.waterUniforms && selfDriven.indexOf(mat) < 0) selfDriven.push(mat);
    return mat;
  };
  function driveSelf() {
    for (let i = 0; i < selfDriven.length; i++) {
      const m = selfDriven[i];
      if (m && m.userData && m.userData.waterUniforms) CBZ.waterDriveCommonUniforms(m.userData.waterUniforms);
    }
  }
  if (CBZ.onAlways) CBZ.onAlways(93.6, driveSelf);
  else if (CBZ.onUpdate) CBZ.onUpdate(93.6, driveSelf);
  else {
    // a page that registers its loop after this file (microboot pages):
    // retry the hook on the next few animation frames
    let tries = 0;
    const hook = function () {
      if (CBZ.onAlways) { CBZ.onAlways(93.6, driveSelf); return; }
      if (CBZ.onUpdate) { CBZ.onUpdate(93.6, driveSelf); return; }
      if (++tries < 600 && typeof requestAnimationFrame === "function") requestAnimationFrame(hook);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(hook);
  }

  CBZ.waterSpecReady = true;
})();
