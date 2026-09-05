/* ============================================================
   world/alpine_skin.js — THE MOUNTAIN SURFACE, SHADED PER PIXEL.

   WHAT WAS WRONG. Both massifs (city/biome_snow.js: Mount Mercy and the
   Greater Mercy Range) were ONE MeshBasicMaterial each: unlit, with a sun
   direction typed into the vertex loop (-0.35, 0.82, 0.45) that never agreed
   with the sun actually in the sky, every colour decided per VERTEX and
   smeared across ~3-12 m triangles by Gouraud interpolation, no shadow, no
   specular, no detail at any scale below the grid. That is why the range
   photographed as an airbrushed beige-and-white sandcastle: the geology
   under it is real (erosion, drainage, cirques, bedding benches) and the
   skin could not show any of it.

   WHAT THIS IS. A MeshStandardMaterial with an onBeforeCompile that turns the
   vertex data into a MATERIAL DESCRIPTION instead of a final colour:

     color  (vec3)  base albedo, UNLIT — soil / rock strata / snow blend
     aMat   (vec4)  x snow coverage 0..1     (city/biome_snow.js's own
                    y bare-rock weight 0..1   mtnSnowCover / mtnStrataTint
                    z vegetation weight 0..1  fields, nothing new invented)
                    w hollow occlusion 0..1   (concavity, for gully shade)

   and the fragment shader, in world space, at every pixel:

     • resolves the snow edge — coverage plus two octaves of noise through a
       steep gain, so contested ground becomes drifts and streaks with a
       ragged edge instead of a 50% grey wash, and snow is SHED off the
       pixel-scale rock ribs the detail normal below cuts;
     • perturbs the normal with a procedural height field — ridged crack
       relief on rock (11 m / 3 m / 1 m), soft wind ripples on snow — with
       an epsilon that grows with distance so it never shimmers;
     • textures rock with bedding contact lines (world y), grain and cracks,
       vegetation with a canopy mottle (dark hollows, lit meadow, 2 m
       speckle) so a green flank reads as forest rather than paint;
     • sets roughness per material (snow glossier than rock) and darkens
       only the indirect light in the hollows (occlusion, not paint).

   Lighting is then the game's real rig — core/lights.js sun, sky/ground
   hemisphere, bounce, the PCF shadow cascade — so the massif turns with the
   day like everything standing on it, and terrainDayTint (a crutch for
   unlit materials) is no longer needed here. Fog scale + aerial perspective
   from world/terrain_overhaul.js chain on unchanged.

   Every detail term fades with view distance; at 4 km the range is lit
   geometry plus aerial perspective, which is what a range at 4 km is.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !THREE.MeshStandardMaterial) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // Detail strength dial for probes (1 = authored). 0 keeps the lit Standard
  // material but strips every procedural term — a clean "is it the lighting
  // or the texture" A/B without a rebuild.
  if (CFG.ALPINE_SKIN_DETAIL == null) CFG.ALPINE_SKIN_DETAIL = 1;

  const _detailU = { value: 1 };
  function tick() {
    const v = +CFG.ALPINE_SKIN_DETAIL;
    _detailU.value = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
  }
  let hooked = false;

  const GLSL_NOISE = [
    "float alpHash( vec2 p ) {",
    "  p = fract( p * vec2( 443.897, 441.423 ) );",
    "  p += dot( p, p.yx + 19.19 );",
    "  return fract( ( p.x + p.y ) * p.x );",
    "}",
    "float alpVn( vec2 p ) {",
    "  vec2 i = floor( p ), f = fract( p );",
    "  f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( alpHash( i ), alpHash( i + vec2( 1.0, 0.0 ) ), f.x ),",
    "              mix( alpHash( i + vec2( 0.0, 1.0 ) ), alpHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );",
    "}",
    "float alpRidge( vec2 p ) { return 1.0 - abs( 2.0 * alpVn( p ) - 1.0 ); }",
    "float alpFbm( vec2 p ) {",
    "  float s = 0.0, a = 0.5;",
    "  for ( int i = 0; i < 4; i ++ ) { s += a * alpVn( p ); p = p * 2.03 + vec2( 17.1, 9.7 ); a *= 0.5; }",
    "  return s * 1.0667;",
    "}",
    // Relief height (metres-ish, unit amplitude) that the detail normal is
    // the gradient of. Rock: ridged crack relief at three scales; snow: two
    // soft octaves of wind ripple. `snowW` chooses, `fine` fades the small
    // scales with distance so the far range does not fizz.
    "float alpRelief( vec2 xz, float snowW, float vegW, float fine, float mid ) {",
    "  float rock = alpRidge( xz * 0.09 ) * 0.55 * mid",
    "             + alpRidge( xz * 0.31 ) * 0.30 * fine",
    "             + alpVn( xz * 1.10 ) * 0.15 * fine;",
    // wind-worked snow: drifts (6 m), sastrugi streaks along one wind axis
    // (long in x, short in z), and a 0.4 m surface grain up close
    "  float snow = alpVn( xz * 0.16 ) * 0.50 * mid",
    "             + alpVn( xz * vec2( 0.22, 0.95 ) ) * 0.30 * fine",
    "             + alpVn( xz * 2.6 ) * 0.20 * fine * fine;",
    // a closed conifer canopy is a field of 4-8 m crowns: bumps, not a tint
    "  float veg = alpVn( xz * 0.17 ) * 0.55 * mid + alpVn( xz * 0.45 ) * 0.45 * fine;",
    "  rock = mix( rock, veg * 0.9, vegW );",
    "  return mix( rock, snow * 0.55, snowW );",
    "}",
  ].join("\n");

  /**
   * CBZ.alpineSkin(opts) -> MeshStandardMaterial
   *   opts.step       bedding step in metres (the mtnTerrace/mtnStrataTint
   *                   step the vertex loop used) — the per-pixel contact
   *                   lines land on the same beds.
   *   opts.scale      feature scale multiplier (1 Mount Mercy, ~2 the range)
   *   opts.snow       snow albedo (THREE.Color or hex)
   *   opts.fineFar / midFar   distances (m) at which the fine / mid relief
   *                   has fully faded.
   */
  CBZ.alpineSkin = function (opts) {
    opts = opts || {};
    const step = opts.step == null ? 16 : +opts.step;
    const scale = opts.scale == null ? 1 : +opts.scale;
    const snow = new THREE.Color(opts.snow == null ? 0xe4e9ee : opts.snow);
    const fineFar = opts.fineFar == null ? 700 : +opts.fineFar;
    const midFar = opts.midFar == null ? 3600 : +opts.midFar;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: false,
      fog: true,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.35,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
    });
    mat.userData = mat.userData || {};
    mat.userData.alpineSkin = true;

    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uAlpDetail = _detailU;
      sh.uniforms.uAlpStep = { value: step };
      sh.uniforms.uAlpScale = { value: scale };
      sh.uniforms.uAlpSnow = { value: snow };
      sh.uniforms.uAlpFar = { value: new THREE.Vector2(fineFar, midFar) };

      const vSrc = sh.vertexShader, fSrc = sh.fragmentShader;
      if (vSrc.indexOf("#include <common>") < 0 || vSrc.indexOf("#include <project_vertex>") < 0 ||
          fSrc.indexOf("#include <color_fragment>") < 0 ||
          fSrc.indexOf("#include <normal_fragment_maps>") < 0 ||
          fSrc.indexOf("#include <roughnessmap_fragment>") < 0) return;

      sh.vertexShader = vSrc
        .replace("#include <common>",
          "#include <common>\nattribute vec4 aMat;\nvarying vec4 vAlpMat;\n" +
          "varying vec3 vAlpWPos;\nvarying vec3 vAlpWNrm;")
        .replace("#include <project_vertex>",
          "#include <project_vertex>\n" +
          "  vAlpMat = aMat;\n" +
          "  vAlpWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
          "  vAlpWNrm = normalize( mat3( modelMatrix ) * normal );");

      let fs = fSrc.replace("#include <common>",
        "#include <common>\n" +
        "varying vec4 vAlpMat;\nvarying vec3 vAlpWPos;\nvarying vec3 vAlpWNrm;\n" +
        "uniform float uAlpDetail;\nuniform float uAlpStep;\nuniform float uAlpScale;\n" +
        "uniform vec3 uAlpSnow;\nuniform vec2 uAlpFar;\n" + GLSL_NOISE + "\n" +
        // shared per-fragment scratch, filled in the albedo pass, read by the
        // normal and roughness passes further down the same main()
        "float alpSnowMask = 0.0; float alpFine = 1.0; float alpMid = 1.0; vec2 alpG = vec2( 0.0 );");

      // ---- 1. albedo: resolve the snow edge, texture rock and forest ------
      fs = fs.replace("#include <color_fragment>",
        "#include <color_fragment>\n" +
        "{\n" +
        "  float alpD = length( vViewPosition );\n" +
        "  alpFine = ( 1.0 - smoothstep( uAlpFar.x * 0.25, uAlpFar.x, alpD ) ) * min( uAlpDetail, 1.0 );\n" +
        "  alpMid = ( 1.0 - smoothstep( uAlpFar.y * 0.20, uAlpFar.y, alpD ) ) * min( uAlpDetail, 1.0 );\n" +
        "  vec2 xz = vAlpWPos.xz / uAlpScale;\n" +
        "  float cov = clamp( vAlpMat.x, 0.0, 1.0 );\n" +
        "  float rockW = clamp( vAlpMat.y, 0.0, 1.0 );\n" +
        "  float vegW = clamp( vAlpMat.z, 0.0, 1.0 ) * ( 1.0 - rockW );\n" +
        // relief gradient (the epsilon widens with distance: a 0.35 m stencil
        // on a 4 km pixel is pure noise, a 3 m one is the shape)
        "  float snowGuess = smoothstep( 0.35, 0.65, cov );\n" +
        "  float e = max( 0.35, alpD * 0.0016 ) / uAlpScale;\n" +
        "  float h0 = alpRelief( xz, snowGuess, vegW, alpFine, alpMid );\n" +
        "  float hx = alpRelief( xz + vec2( e, 0.0 ), snowGuess, vegW, alpFine, alpMid );\n" +
        "  float hz = alpRelief( xz + vec2( 0.0, e ), snowGuess, vegW, alpFine, alpMid );\n" +
        "  alpG = vec2( hx - h0, hz - h0 ) / e;\n" +
        // snow edge: coverage walked by drift-scale + edge-scale noise, the
        // offset vanishing at 0 and 1 so a deep field stays deep and bare
        // rock stays bare; then a steep gain so the mosaic has EDGES.
        "  float drift = alpFbm( xz * 0.055 ) - 0.5;\n" +
        "  float frayed = alpVn( xz * 0.42 ) - 0.5;\n" +
        "  float cov2 = cov + ( drift * 0.62 + frayed * 0.22 ) * mix( 0.6, 1.0, alpMid );\n" +
        "  float snowM = smoothstep( 0.40, 0.60, cov2 );\n" +
        // ribs: where the relief is steep at pixel scale the snow slides off,
        // unless the field is deep enough to bury the rib
        "  float rib = smoothstep( 0.35, 1.15, length( alpG ) * ( 0.55 + 0.45 * rockW ) );\n" +
        "  snowM *= 1.0 - 0.85 * rib * ( 1.0 - cov * cov ) * uAlpDetail;\n" +
        "  alpSnowMask = snowM;\n" +
        // rock: bedding contacts on world height, grain, cracks
        "  float bed = fract( ( vAlpWPos.y + ( alpVn( xz * 0.012 ) - 0.5 ) * uAlpStep * 3.0 + ( alpVn( xz * 0.06 ) - 0.5 ) * uAlpStep * 0.8 ) / uAlpStep );\n" +
        "  float bedMask = smoothstep( 0.30, 0.70, alpVn( xz * 0.025 + 7.0 ) );\n" +
        "  float contact = max( smoothstep( 0.86, 0.98, bed ), 1.0 - smoothstep( 0.02, 0.10, bed ) );\n" +
        "  float grain = mix( 0.5, alpVn( xz * 0.35 ), alpMid ) * 0.6 + mix( 0.5, alpVn( xz * 1.5 ), alpFine ) * 0.4;\n" +
        "  float crack = pow( alpRidge( xz * 0.20 ), 6.0 ) * 0.7 + pow( alpRidge( xz * 0.75 ), 8.0 ) * 0.3;\n" +
        "  float rockMod = ( 0.74 + 0.52 * grain ) * ( 1.0 - 0.20 * contact * bedMask * alpMid ) * ( 1.0 - 0.42 * crack * alpFine );\n" +
        "  rockMod = mix( 1.0, rockMod, uAlpDetail );\n" +
        // forest: closed dark canopy in the hollows, lit meadow on the open
        // ground, a 2 m crown speckle up close
        "  float mottle = alpFbm( xz * 0.030 );\n" +
        "  float clump = mix( 0.5, alpVn( xz * 0.13 ) * 0.6 + alpVn( xz * 0.28 ) * 0.4, alpMid );\n" +
        "  float crowns = alpVn( xz * 0.55 ) * 0.5 + alpVn( xz * 1.3 ) * 0.5;\n" +
        "  float vegMod = ( 0.34 + 0.95 * mottle ) * ( 0.55 + 0.90 * clump ) * ( 0.78 + 0.44 * crowns * alpFine + 0.22 * ( 1.0 - alpFine ) );\n" +
        "  vegMod = mix( 1.0, vegMod, uAlpDetail );\n" +
        "  vec3 vegTint = mix( vec3( 1.0 ), vec3( 0.80, 0.98, 0.72 ), vegW * uAlpDetail );\n" +
        "  vec3 base = diffuseColor.rgb * mix( 1.0, rockMod, rockW ) * mix( 1.0, vegMod, vegW ) * vegTint;\n" +
        // snow: near-neutral, a wind ripple tone and a faint cool tint in
        // the ripple troughs
        "  float ripple = alpVn( xz * 0.50 ) * 0.6 + alpVn( xz * 0.14 ) * 0.4;\n" +
        "  vec3 snowCol = uAlpSnow * ( 0.94 + 0.08 * ripple ) * mix( vec3( 1.0 ), vec3( 0.97, 0.985, 1.0 ), 1.0 - ripple );\n" +
        "  diffuseColor.rgb = mix( base, snowCol, snowM );\n" +
        "}");

      // ---- 2. roughness: snow is glossier than broken rock ---------------
      fs = fs.replace("#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n" +
        "roughnessFactor = mix( 0.93, 0.66, alpSnowMask );");

      // ---- 3. normal: the relief gradient, in world space -----------------
      fs = fs.replace("#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\n" +
        "{\n" +
        "  float amp = mix( 1.35, 0.75, alpSnowMask ) * uAlpDetail;\n" +
        "  vec3 nP = normalize( vAlpWNrm + vec3( - alpG.x, 0.0, - alpG.y ) * amp );\n" +
        "  normal = normalize( normal + mat3( viewMatrix ) * ( nP - vAlpWNrm ) );\n" +
        "}");

      // ---- 4. hollows take less sky ---------------------------------------
      if (fs.indexOf("#include <aomap_fragment>") >= 0) {
        fs = fs.replace("#include <aomap_fragment>",
          "#include <aomap_fragment>\n" +
          "{\n" +
          "  float alpAo = 1.0 - 0.38 * clamp( vAlpMat.w, 0.0, 1.0 );\n" +
          "  reflectedLight.indirectDiffuse *= alpAo;\n" +
          "  reflectedLight.indirectSpecular *= alpAo;\n" +
          "}");
      }
      sh.fragmentShader = fs;
    };

    if (CBZ.gfxRegisterPbr) CBZ.gfxRegisterPbr(mat);
    if (!hooked && CBZ.onAlways) { hooked = true; CBZ.onAlways(91.7, tick); }
    return mat;
  };
})();
