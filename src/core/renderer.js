/* ============================================================
   core/renderer.js — WebGL renderer, mounted into #game.

   THIS FILE ALSO OWNS THE ONE PLACE GLOBAL SHADER SURGERY HAPPENS.
   There is no EffectComposer in this project and there is not going to
   be one (CDN is blocked, nothing is vendored, and a render-target chain
   is exactly the draw-call regression this engine's budget forbids). So
   the two "post-processing" effects the world needs most are folded into
   the shader chunks every material already compiles, at zero extra draw
   calls and zero extra render targets:

     1. FILMIC TONE MAP + COLOUR GRADE (CBZ.CONFIG.RENDER_TONEMAP_V1)
        The renderer shipped at THREE.NoToneMapping — every bright surface
        (sun disc, neon, headlights, sunlit white plaster) hard-clipped to
        flat white instead of rolling off. We install ACES via r128's
        CustomToneMapping hook, which lets us append a real lift/gamma/gain
        + saturation grade INSIDE the same function: contrast around linear
        mid-grey, saturation restored (ACES desaturates), cool shadows and
        warm highlights. One extra ~12-ALU block per fragment, no passes.

     2. HEIGHT FOG / AERIAL PERSPECTIVE (CBZ.CONFIG.RENDER_HEIGHT_FOG_V1)
        THREE.Fog is a uniform slab: the top of a tower is as hazy as the
        gutter it stands in, and from an aircraft the whole world drowns in
        an even wash (which is why city/mode.js has to yank fog.far out to
        4200 the moment you leave the ground). We patch the fog chunks so
        density falls off with the MEAN world height of the camera and the
        fragment — peaks and rooftops emerge from the haze, the ground stays
        atmospheric, and altitude naturally clears the air.

     3. FOG IS NOW GRADED WITH EVERYTHING ELSE. In stock r128 the fog mix
        happens AFTER <tonemapping_fragment> and <encodings_fragment>, so
        the fog colour was the ONE thing on screen bypassing the output
        transform. With a tone map installed that would have visibly broken
        the load-bearing sky/fog seam law (core/sky.js forces the dome's
        horizon texel to equal scene.fog.color; the dome texel goes through
        tonemap+encode, so the fog it must match has to as well). The
        patched fog chunk runs fogColor through the identical
        toneMapping()/linearToOutputTexel() pair before mixing — the seam is
        now mathematically exact instead of approximately right.

   All three are r128-native (outputEncoding/sRGBEncoding, CustomToneMapping;
   NOT colorSpace, NOT OutputPass) and each is a one-line revert.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // ---- feature flags ------------------------------------------------------
  // RENDER_TONEMAP_V1 (owner: "make the world like 100x realer feeling").
  // On → ACES filmic tone mapping + the in-shader film grade below. Flip false
  // (or ?cfg_RENDER_TONEMAP_V1=0) to return to the exact prior NoToneMapping
  // look. Light intensities in core/lights.js + core/daynight.js are tuned
  // against this being ON; core/gfx.js re-scales them when it is OFF.
  if (CBZ.CONFIG.RENDER_TONEMAP_V1 == null) CBZ.CONFIG.RENDER_TONEMAP_V1 = true;
  // RENDER_GRADE_V1 — the lift/gamma/gain + saturation half of the tone map.
  // false → plain ACES with no grade (still tone mapped).
  if (CBZ.CONFIG.RENDER_GRADE_V1 == null) CBZ.CONFIG.RENDER_GRADE_V1 = true;
  // RENDER_HEIGHT_FOG_V1 — aerial perspective (fog thins with altitude).
  if (CBZ.CONFIG.RENDER_HEIGHT_FOG_V1 == null) CBZ.CONFIG.RENDER_HEIGHT_FOG_V1 = true;
  // RENDER_FOG_GRADE_V1 — run fogColor through the output transform so the
  // sky-dome horizon seam stays exact under tone mapping. Only meaningful
  // while RENDER_TONEMAP_V1 is on.
  if (CBZ.CONFIG.RENDER_FOG_GRADE_V1 == null) CBZ.CONFIG.RENDER_FOG_GRADE_V1 = true;
  // Base exposure. ACES in three.js pre-divides by 0.6, so 1.0 already reads
  // close to the untonemapped midtones; >1 is the "punchier, not dimmer" knob.
  // core/gfx.js multiplies this by a live day/night term every frame.
  if (CBZ.CONFIG.RENDER_EXPOSURE == null) CBZ.CONFIG.RENDER_EXPOSURE = 1.16;
  // Aerial perspective shape: haze scale height (m) and the floor it decays to.
  if (CBZ.CONFIG.RENDER_FOG_HEIGHT == null) CBZ.CONFIG.RENDER_FOG_HEIGHT = 110;
  if (CBZ.CONFIG.RENDER_FOG_FLOOR == null) CBZ.CONFIG.RENDER_FOG_FLOOR = 0.30;
  // AERIAL_FOG_MELT — THE HORIZON MUST MELT, NOT END. Owner, from the B-2 at
  // 1750 m: "the horizon looks awful on the water, there must be fake horizon,
  // i hate fake shit." There is no fake horizon in the scene; what he is
  // seeing is the opposite failure — the REAL world stopping dead because
  // nothing ever finishes fogging it. Derivation and measurements in
  // installFog() below. `?cfg_AERIAL_FOG_MELT=0` reverts.
  if (CBZ.CONFIG.AERIAL_FOG_MELT == null) CBZ.CONFIG.AERIAL_FOG_MELT = true;

  function glslF(v, d) { return (+v).toFixed(d == null ? 4 : d); }

  /* ---------------- 1. tone mapping + film grade -----------------------
     r128 ships an empty `vec3 CustomToneMapping( vec3 color ) { return color; }`
     stub at the end of the tonemapping_pars_fragment chunk precisely so an
     application can define its own curve. We replace the stub, then select
     THREE.CustomToneMapping. If the stub ever moves (a THREE upgrade), the
     replace is detected as a no-op and we fall back to stock ACES rather
     than shipping a broken shader. */
  let toneMode = null;
  (function installToneMap() {
    if (!CBZ.CONFIG.RENDER_TONEMAP_V1) return;
    if (!THREE.ACESFilmicToneMapping) return;
    toneMode = THREE.ACESFilmicToneMapping;
    if (!CBZ.CONFIG.RENDER_GRADE_V1 || !THREE.CustomToneMapping || !THREE.ShaderChunk) return;

    const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
    if (typeof chunk !== "string") return;
    const STUB = /vec3\s+CustomToneMapping\s*\(\s*vec3\s+color\s*\)\s*\{[^}]*\}/;
    if (!STUB.test(chunk)) return;   // unknown THREE build — keep stock ACES

    // GRADE CONSTANTS. Deliberately gentle: this multiplies EVERY pixel in
    // the game, so it is a look, not an effect.
    //   CONTRAST  power curve pivoted on linear mid-grey (0.18)
    //   SAT       ACES desaturates; put it back and a touch more
    //   GAIN/LIFT cool shadows, warm highlights — the standard film split
    const PIVOT = 0.18, CONTRAST = 1.075, SAT = 1.14;
    const GAIN = [1.025, 1.005, 0.982];
    const LIFT = [0.0015, 0.0032, 0.0072];

    const custom = [
      "vec3 CustomToneMapping( vec3 color ) {",
      // --- ACES, verbatim from three's own implementation (r128) ---
      "  const mat3 CBZ_ACESIn = mat3(",
      "    0.59719, 0.07600, 0.02840,",
      "    0.35458, 0.90834, 0.13383,",
      "    0.04823, 0.01566, 0.83777 );",
      "  const mat3 CBZ_ACESOut = mat3(",
      "     1.60475, -0.10208, -0.00327,",
      "    -0.53108,  1.10813, -0.07276,",
      "    -0.07367, -0.00605,  1.07602 );",
      "  color *= toneMappingExposure / 0.6;",
      "  color = CBZ_ACESIn * color;",
      "  color = RRTAndODTFit( color );",
      "  color = CBZ_ACESOut * color;",
      "  color = saturate( color );",
      // --- the grade ---
      "  color = pow( max( color / " + glslF(PIVOT) + ", vec3( 0.0 ) ), vec3( " + glslF(CONTRAST) + " ) ) * " + glslF(PIVOT) + ";",
      "  float cbzLum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );",
      "  color = mix( vec3( cbzLum ), color, " + glslF(SAT) + " );",
      "  color = color * vec3( " + GAIN.map(function (v) { return glslF(v); }).join(", ") + " )",
      "        + vec3( " + LIFT.map(function (v) { return glslF(v); }).join(", ") + " );",
      "  return saturate( color );",
      "}",
    ].join("\n");

    THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(STUB, custom);
    toneMode = THREE.CustomToneMapping;
  })();

  /* ---------------- 2 + 3. fog: aerial perspective + graded colour ------
     fog_vertex already runs in every fogged shader AFTER project_vertex has
     built `mvPosition` (which includes skinning AND instancing), so we can
     recover the fragment's world-space height from it without a second
     matrix: viewMatrix's upper 3x3 is orthonormal, so
       worldPos = cameraPosition + transpose(R) * viewPos
     and the y component of that is a single dot product. That keeps the patch
     correct for InstancedMesh (the distant-building skyline proxies, the rain,
     the crowd) where a naive `modelMatrix * position` would be wrong.
     `cameraPosition` itself is NOT read from the uniform of that name — r128
     leaves it at zero on Lambert/Basic programs — it is derived from
     viewMatrix. See CAM_Y in installFog(); that one line is what makes the
     height fog and the melt reach terrain at all. */
  (function installFog() {
    if (!THREE.ShaderChunk) return;
    const wantHeight = !!CBZ.CONFIG.RENDER_HEIGHT_FOG_V1;
    const wantGrade = !!(CBZ.CONFIG.RENDER_FOG_GRADE_V1 && toneMode);
    if (!wantHeight && !wantGrade) return;

    const parsV = THREE.ShaderChunk.fog_pars_vertex;
    const vtx = THREE.ShaderChunk.fog_vertex;
    const parsF = THREE.ShaderChunk.fog_pars_fragment;
    const frg = THREE.ShaderChunk.fog_fragment;
    if (typeof parsV !== "string" || typeof vtx !== "string" ||
        typeof parsF !== "string" || typeof frg !== "string") return;
    if (frg.indexOf("fogColor") < 0) return;   // unknown THREE build — don't touch it

    /* CAM_Y — THE CAMERA'S WORLD HEIGHT, WITHOUT `cameraPosition`.
       r128 DECLARES `uniform vec3 cameraPosition` in both the vertex and the
       fragment prefix of EVERY program, but WebGLRenderer.setProgram only
       ever UPLOADS it for
         isShaderMaterial | isMeshPhongMaterial | isMeshToonMaterial |
         isMeshStandardMaterial | envMap
       (three.r128.min.js, the `y.map.cameraPosition` guard). MeshLambertMaterial
       and MeshBasicMaterial are NOT in that list, so in their programs
       `cameraPosition` is silently (0,0,0) — it compiles, it links, it reads
       zero. Everything below that used it was therefore a NO-OP on exactly the
       materials this feature exists for:
         • cbzAir = 1 - exp(-cameraPosition.y/2H) evaluated to 0, so
           AERIAL_FOG_MELT's `mix(factor, 1.0, cbzAir * cbzMelt)` changed
           nothing at all;
         • cbzHazeY went negative (it became the fragment's height RELATIVE to
           the eye), so max(...,0) pinned cbzHaze at 1.0 and the aerial
           perspective never thinned either.
       MEASURED, not asserted: from the B-2 at 1,760 m the 16 terrainBackdropTile
       meshes (Lambert + vertexColors + terrainFogScale 0.12) drew a bit-constant
       (181,217,228) band across the whole frame and 45 rows, ending in the hard
       edge the owner calls the fake horizon. Hiding those 16 meshes revealed
       (230,232,232) behind them — the sky dome's exact fog colour. The band was
       also provably fog-CAPABLE and merely never reached: swapping scene.fog for
       `new THREE.Fog(0xff0000, 10, 200)` painted it pure red, while
       `new THREE.Fog(0xff0000, 672, 4200)` (the live airborne range) left it
       bit-identical. A prior probe that read the melt as WORKING had sampled a
       MeshStandardMaterial (`batch-inert`), which is one of the types that does
       get the uniform — which is precisely how this hid.
       THE FIX IS A DERIVATION, NOT A NEW UNIFORM. `viewMatrix` IS uploaded for
       Lambert and Basic (same function, the adjacent guard), and it is the
       inverse of the camera's world matrix: for an orthonormal rotation R and
       camera position c, viewMatrix = [ Rᵀ | -Rᵀc ], so
         c = -R · viewMatrix[3].xyz   and   c.y = -dot( R ᵀ column 1, t )
       and column 1 of mat3(viewMatrix) IS Rᵀ's column 1, i.e. viewMatrix[1].xyz.
       One dot product, exact, no uniform added, no varying added, and correct
       for every material type including the ones that DO upload cameraPosition. */
    const CAM_Y = "( -dot( viewMatrix[1].xyz, viewMatrix[3].xyz ) )";

    if (wantHeight) {
      // APPEND, never rewrite: world.js's ocean and terrain_overhaul.js both
      // post-process `fogDepth` right after including fog_vertex, and
      // src/vendor/WaterReflect.js includes these chunks too. Appending a new
      // varying leaves every one of those intact.
      // cbzFogRaw is the TRUE view depth, captured at the tail of the chunk —
      // i.e. BEFORE any builder's post-multiply. world/terrain_overhaul.js's
      // `terrainFogScale` and world.js's ocean both rewrite `fogDepth` AFTER
      // including this chunk, so `fogDepth` downstream is a LOOK, not a
      // distance. AERIAL_FOG_MELT needs the real one (see installFog below).
      THREE.ShaderChunk.fog_pars_vertex = parsV +
        "\n#ifdef USE_FOG\n  varying float cbzFogY;\n  varying float cbzFogRaw;\n#endif\n";
      THREE.ShaderChunk.fog_vertex = vtx +
        "\n#ifdef USE_FOG\n" +
        "  cbzFogY = " + CAM_Y + " + dot( mvPosition.xyz, viewMatrix[1].xyz );\n" +
        "  cbzFogRaw = fogDepth;\n" +
        "#endif\n";
      THREE.ShaderChunk.fog_pars_fragment = parsF +
        "\n#ifdef USE_FOG\n  varying float cbzFogY;\n  varying float cbzFogRaw;\n#endif\n";
    }

    const H = Math.max(1, +CBZ.CONFIG.RENDER_FOG_HEIGHT || 110);
    const FLOOR = Math.max(0, Math.min(0.95, +CBZ.CONFIG.RENDER_FOG_FLOOR));

    const body = ["#ifdef USE_FOG",
      "  #ifdef FOG_EXP2",
      "    float cbzFogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );",
      "  #else",
      "    float cbzFogFactor = smoothstep( fogNear, fogFar, fogDepth );",
      "  #endif"];

    if (wantHeight) {
      body.push(
        // Mean of eye height and fragment height ~ the average haze density
        // along the ray. Looking down from an aircraft this clears the air
        // (you can see the city); standing in the street it does nothing.
        "  float cbzHazeY = 0.5 * ( cbzFogY + " + CAM_Y + " );",
        "  float cbzHaze = " + glslF(FLOOR) + " + " + glslF(1 - FLOOR) +
          " * exp( - max( cbzHazeY, 0.0 ) / " + glslF(H, 2) + " );"
      );

      /* ---- AERIAL_FOG_MELT: the world must reach fog.color before it ends --
         Owner, from the B-2 at 1750 m: "the horizon looks awful on the water,
         there must be fake horizon, i hate fake shit." There is no fake
         horizon. The world simply STOPS, at full saturation, against a sky
         that is pure fog colour. TWO independent faults put it there, and the
         second is much the larger — it was found by probe, not by reading:

         (1) THE CEILING. `cbzHaze` MULTIPLIES the fog factor, so it is not a
             density, it is a ceiling. At 1750 m a sea-level fragment has
             cbzHazeY = 875 m ~ 8 scale heights, exp(-875/110) ~ 3.5e-4, so
             cbzHaze collapses to the FLOOR: 0.30. Everything distant is
             capped at 30% fog however far away it is. Raising the FLOOR
             cannot fix this — a floor is still a ceiling — and raising it
             globally would drown the aerial view of the city, which is the
             entire point of the height fog.

         (2) THE TERRAIN NEVER ENTERS THE FOG SLAB AT ALL. world/
             terrain_overhaul.js's `CBZ.terrainFogScale(mat, scale)` appends
             `fogDepth *= uFogScale` after this chunk, and every large ground
             surface in the game is wrapped in it: the continent plate at
             0.08 (city/continent.js), the snow massif and its ground at 0.12
             (city/biome_snow.js), the worldSurface sweep and world.js's own
             ground at 0.10. At 0.08 a plate 4200 m away reports a fogDepth of
             336 m — BELOW fogNear (672) — so smoothstep(fogNear, fogFar, .)
             returns exactly 0. To reach full fog that plate would have to be
             fogFar/0.08 = 52,500 m away; the far plane is 7,000 m. Terrain
             fog was therefore UNREACHABLE BY CONSTRUCTION, at every distance
             a camera can see, and the ground ran at full colour straight into
             the sky. A probe confirmed it directly: swapping scene.fog for a
             pure RED Fog left those pixels bit-identical.
             The scale is not a bug to delete — its comment explains it stops
             the massif reading as a see-through sheet — but it is a NEAR-FIELD
             look, and it must not be able to veto the far-field seam law.

         THE RULE. Aerial perspective is a NEAR/MID-field look: it exists so
         you can see the ground you are flying over. The seam law is a FAR-
         field law: a pixel at the end of the fog slab must equal fog.color
         exactly, because that is what core/sky.js paints below the dome's
         horizon. Those two only conflict over the last stretch of the slab,
         so that is the only place we intervene, by exactly the amount the
         camera's altitude removed:

         cbzAir  — for a sea-level fragment (cbzFogY = 0) the mean height is
                   cameraPosition.y / 2, so the fog DEFICIT that the camera's
                   own altitude imposes is, normalised out of the (1 - FLOOR)
                   that altitude is allowed to take:
                       (1 - cbzHaze) / (1 - FLOOR) = 1 - exp(-yCam / 2H)
                   We hand back precisely that. It is not a tuned ramp; it is
                   the inverse of the term that caused the bug. At a standing
                   eye height of 1.7 m it evaluates to 0.0077, so the whole
                   correction is bounded by 0.0077 * (1 - FLOOR) = 0.0054 of a
                   fog mix — under 1.4/255 of a colour step even against a
                   full-contrast background. GROUND-LEVEL PLAY IS A NO-OP BY
                   CONSTRUCTION, not by a distance test that could drift.

         cbzMelt — runs on cbzFogRaw, the TRUE view depth captured at the tail
                   of fog_vertex before any builder's post-multiply. That is
                   what makes this immune to fault (2): whatever a surface has
                   done to its own fogDepth for near-field taste, its distance
                   from the eye is still its distance from the eye, and the
                   melt is driven by that. It completes exactly where the base
                   fog saturates (fogFar), so any pixel at or beyond fogFar is
                   forced onto fog.color and the seam is closed by the slab's
                   own geometry — and because the melt LIFTS THE FACTOR rather
                   than scaling the haze, a surface whose base smoothstep is
                   pinned at zero still gets there. city/mode.js
                   guarantees camera.far >= fogFar + 900, so saturation always
                   happens STRICTLY INSIDE the frustum: the far plane can no
                   longer cut anything that is not already sky-coloured. It
                   starts at the slab midpoint because the melt has to read as
                   haze rather than as a painted band, and a band is an ANGULAR
                   measurement: airborne fogNear/fogFar are 672/4200, so at the
                   1750 m spawn the ramp spans atan(1750/2436) = 35.7° down to
                   atan(1750/4200) = 22.6° — 13.1° of depression, about a fifth
                   of the vertical FOV. (The old fuse's effective span was ~3°,
                   which is precisely what reads as a stripe.)

         MEASURED IN-ENGINE, not asserted. A CDP probe staged the real B-2
         spawn (tools/visual-presets/b2-spawn.mjs) and swapped scene.fog for a
         PURE RED Fog — note that r128 only re-uploads fog uniforms when the
         fog OBJECT IDENTITY changes (setProgram compares
         materialProperties.fog !== fog), so mutating fog.color in place
         proves nothing and will fool you. On a surface that DOES ride the
         slab, at 3504 m slant, the ceiling fix alone predicts 44% fog where
         the old ceiling gave 24%; the probe read ~47%.

         Cost: one extra varying and three ALU-only lines per fragment, no
         texture fetch, no uniform added, no new program variant — this edits
         the shared ShaderChunk once at load, so nothing keys a cache on it. */
      body.push("  cbzFogFactor *= cbzHaze;");

      if (CBZ.CONFIG.AERIAL_FOG_MELT) {
        body.push(
          "  #ifdef FOG_EXP2",
          // exp2 fog has no far plane; 1 - exp(-(d*sigma)^2) = 0.999 at
          // d*sigma = 2.63, so that is this slab's saturation depth.
          "    float cbzSatD = 2.63 / max( fogDensity, 1e-6 );",
          "    float cbzMelt = smoothstep( 0.5 * cbzSatD, cbzSatD, cbzFogRaw );",
          "  #else",
          "    float cbzMelt = smoothstep( mix( fogNear, fogFar, 0.5 ), fogFar, cbzFogRaw );",
          "  #endif",
          "  float cbzAir = 1.0 - exp( - max( " + CAM_Y + ", 0.0 ) / " + glslF(2 * H, 2) + " );",
          // Lift the FACTOR, not the haze: a builder that scaled its own
          // fogDepth has already forced the base smoothstep to zero, so
          // multiplying it by anything is still zero.
          "  cbzFogFactor = mix( cbzFogFactor, 1.0, cbzAir * cbzMelt );"
        );
      }
    }

    body.push("  vec3 cbzFogCol = fogColor;");
    if (wantGrade) {
      // Put the fog through the SAME output transform the rest of the frame
      // already went through (tone map then encode) so a fully-fogged pixel
      // lands on exactly the colour core/sky.js paints into the dome horizon.
      body.push(
        "  #ifdef TONE_MAPPING",
        "    cbzFogCol = toneMapping( cbzFogCol );",
        "  #endif",
        "  cbzFogCol = linearToOutputTexel( vec4( cbzFogCol, 1.0 ) ).rgb;"
      );
    }
    body.push(
      "  gl_FragColor.rgb = mix( gl_FragColor.rgb, cbzFogCol, saturate( cbzFogFactor ) );",
      "#endif"
    );
    THREE.ShaderChunk.fog_fragment = body.join("\n");
  })();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,                 // MSAA — crisp edges on the blocky geometry
    powerPreference: "high-performance",
    stencil: false,                  // we never use the stencil buffer
  });
  renderer.setSize(innerWidth, innerHeight);
  // GFX_SHADER_DIAGNOSTICS — r128 queries LINK_STATUS + getProgramInfoLog for
  // EVERY compiled program when debug.checkShaderErrors is on (its default),
  // and each query forces a full CPU↔GPU pipeline sync while Metal finishes
  // the compile. Measured 2026-08-03 (M1 Pro, seed 90210): ~19s of a 47s
  // Play→city boot and ~7s of an 8s play window, because this game compiles
  // 200+ programs at boot (fxwarm prewarm) and bursts more mid-play. Off by
  // default; a broken shader now fails SILENT (mesh renders wrong/black), so
  // when debugging shaders boot with ?cfg_GFX_SHADER_DIAGNOSTICS=1.
  if (CBZ.CONFIG.GFX_SHADER_DIAGNOSTICS == null) CBZ.CONFIG.GFX_SHADER_DIAGNOSTICS = false;
  renderer.debug.checkShaderErrors = !!CBZ.CONFIG.GFX_SHADER_DIAGNOSTICS;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // softer shadow edges; res driven by core/quality.js
  // The sun creeps across the sky over a 150s day/night cycle, so the shadow
  // map barely changes frame-to-frame. Re-rendering the entire scene from the
  // light's POV every frame is wasted work — instead we drive updates manually
  // (see the throttle below), which reclaims a full shadow pass on most frames.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  if (toneMode) {
    renderer.toneMapping = toneMode;
    renderer.toneMappingExposure = +CBZ.CONFIG.RENDER_EXPOSURE || 1;
  }

  // Exposure control surface. core/gfx.js drives `mul` from the day/night
  // clock (a gentle eye-adaptation curve); anything else that needs a
  // momentary exposure push (a blast, a flashbang) can use the same call
  // without having to know the base value.
  CBZ.renderExposureBase = +CBZ.CONFIG.RENDER_EXPOSURE || 1;
  CBZ.toneMappingOn = !!toneMode;
  CBZ.setExposure = function (mul) {
    if (!toneMode) return 1;
    const e = CBZ.renderExposureBase * (mul == null ? 1 : +mul || 1);
    renderer.toneMappingExposure = e;
    return e;
  };

  document.getElementById("game").appendChild(renderer.domElement);

  CBZ.renderer = renderer;
  CBZ.canvas = renderer.domElement;

  // One scheduler owns shadow refreshes. Previously this file requested a
  // shadow pass every 2-3 frames while daynight.js independently requested one
  // whenever the player crossed a ~7cm shadow texel; together those paths often
  // restored a full shadow-scene render every frame. Wall-clock scheduling is
  // stable at any display refresh rate: 18Hz while moving, 10Hz while still.
  let shadowDirty = true;
  let shadowForce = true;
  let lastShadowMs = -Infinity;
  const shadowStats = CBZ.shadowUpdateStats = { requests: 0, forced: 0, commits: 0, movingCommits: 0 };
  CBZ.requestShadowUpdate = function (force) {
    shadowStats.requests++;
    shadowDirty = true;
    if (force) { shadowForce = true; shadowStats.forced++; }
  };
  CBZ.onAlways(1, function () {
    // A background tab can still receive very sparse animation callbacks on
    // some browsers. Do not spend one of those callbacks rebuilding a shadow
    // map; the elapsed interval guarantees an immediate refresh on return.
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return;
    if (!renderer.shadowMap.enabled || !CBZ.sun || !CBZ.sun.castShadow) return;
    const p = CBZ.player;
    const moving = !!(p && ((p.speed || 0) > 0.08 || Math.abs(p.vy || 0) > 0.08 || p.driving));
    const interval = 1000 / (moving ? 18 : 10);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Periodic refresh carries the slowly moving sun even when no producer is
    // dirty. Dirty producers still respect the same cap; force is reserved for
    // teleports, mode/tier changes and rebuilt geometry.
    if (!shadowForce && now - lastShadowMs < interval) return;
    if (shadowForce || shadowDirty || now - lastShadowMs >= interval) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
      shadowForce = false;
      lastShadowMs = now;
      shadowStats.commits++;
      if (moving) shadowStats.movingCommits++;
    }
  });

  addEventListener("resize", () => {
    CBZ.camera.aspect = innerWidth / innerHeight;
    CBZ.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
})();
