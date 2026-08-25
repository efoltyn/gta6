/* ============================================================
   src/world/waterfx.js — the REFLECTIVE ocean (THREE.WaterReflect).

   Ports the Slayvin flat-mirror Water addon (src/vendor/WaterReflect.js) onto
   the game's ONE ocean surface — CBZ.citySea. A planar-reflection render target
   mirrors the live scene each (half) frame; the water shader distorts that
   reflection with a scrolling procedural normal map and adds a Fresnel-weighted
   mix of sky reflection + sun specular.

   WHAT WAS WRONG (and is fixed here)
   ----------------------------------
   The two water surfaces used to ALTERNATE, and each one was missing exactly
   what the other had. The reflective mesh was a SINGLE QUAD — `new
   THREE.PlaneGeometry(spanX, spanZ)` with no segment arguments — and the
   vendor's vertex program applies zero vertical displacement, so every "wave"
   was a fragment-shader UV wobble on a geometrically dead-flat sheet. It also
   carried no land mask, no foam, no whitecaps and no depth colour. Since
   WATER_REFLECT defaults ON and the title screen's default preset is
   medium = tier 2 (which clears REFLECT_MIN_TIER), **the water most players
   actually saw was the flat one with none of the shoreline work**.

   Now the reflector is built on the SAME camera-centred radial disc as the
   shader sea (world/water_spec.js) and its shaders are patched, in-place and
   before first compile, to add:
     • the shared vertex swell displacement + analytic surface normal
     • the baked land-mask discard (water stops at the real coast)
     • the depth-graded colour ramp (turquoise shallows -> deep blue)
     • the advancing surf band and crest whitecaps
     • fresnel-weighted sun glitter and inland-lake calm/tint
     • an underside look, so a submerged camera sees a real ceiling
   Reflection and real geometry now COMBINE instead of trading off. The vendor
   file itself is never edited — every change is a string patch applied to the
   material this file constructs, and if any anchor ever fails to match, the
   patch is abandoned wholesale and the untouched vendor shader is used.

   FLAG: CBZ.CONFIG.WATER_REFLECT (default ON; declared in src/config.js). When
   OFF, this file never creates a reflector and never touches CBZ.citySea, so
   city/world.js's shader sea renders alone — one-line revert. The flag is also
   honoured live (flip it at runtime and the water swaps on the next frame).

   PERF:
     - 256x256 reflection target (512 at High/Best) — the whole scene
       re-renders into it.
     - HALF-RATE mirror: onBeforeRender is wrapped to run the (expensive)
       mirror pass only every other frame and reuse the cached target on the
       skipped frame — imperceptible on moving water, ~halves the extra cost.
     - QUALITY GATED: below the Balanced tier (core/quality.js) the reflector
       is hidden and the shader sea returns; a live tier change flips between
       them, and re-tessellates / re-sizes the mirror.

   The reflector inherits the city root's visibility, so it only renders in
   city mode. The addon hides itself during the mirror pass (no recursion), and
   the HUD is DOM (never in the THREE scene), so neither leaks into reflections.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  if (!THREE || !THREE.WaterReflect) return;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_REFLECT == null) CFG.WATER_REFLECT = true; // defensive default;
  // src/config.js owns the authoritative declaration.

  // Below this quality tier the planar reflection (an extra full scene render)
  // is dropped and the shader sea renders instead. core/quality.js tiers: 0
  // emergency, 1 fast, 2 balanced, 3 high, 4 best.
  const REFLECT_MIN_TIER = 2;

  let reflect = null;   // the THREE.WaterReflect mesh
  let reflectU = null;  // its LIVE uniform block (by reference)
  let flatSea = null;   // the original city/world.js animated shader sea
  let builtKey = "";    // tier-derived build signature (geometry + RT size)
  let qualityHooked = false;
  const _sunDir = new THREE.Vector3(0.34, 0.84, 0.42).normalize();

  function tier() { return CBZ.qualityLevel != null ? CBZ.qualityLevel : 2; }
  function qualityOk() {
    const q = CBZ.qualityLevel;
    return q == null || q >= REFLECT_MIN_TIER;
  }
  function mirrorSize() { return tier() >= 3 ? 512 : 256; }
  function buildKey() {
    const p = CBZ.waterTierParams ? CBZ.waterTierParams(tier()) : { rings: 0, sectors: 0 };
    return p.rings + "x" + p.sectors + "@" + mirrorSize();
  }

  // Positive signal that `m` is world.js's shader sea (and NOT our own
  // reflector — which now carries the very same uSeaTime uniform, so the old
  // uniform-name test would have matched itself and rebuilt forever).
  function isFlatSea(m) {
    return !!(m && !m.isWater && m.material && m.material.uniforms && m.material.uniforms.uSeaTime);
  }

  function teardown() {
    if (!reflect) return;
    if (reflect.parent) reflect.parent.remove(reflect);
    try { if (reflect.renderTarget) reflect.renderTarget.dispose(); } catch (e) {}
    try { if (reflect.material) reflect.material.dispose(); } catch (e) {}
    try { if (reflect.geometry) reflect.geometry.dispose(); } catch (e) {}
    reflect = null;
    reflectU = null;
    builtKey = "";
  }

  // ---- shader patching ----------------------------------------------------
  // Every anchor below is a verbatim line of src/vendor/WaterReflect.js. If any
  // one of them ever stops matching (a vendor re-port, an upstream refresh),
  // `ok` goes false and the caller keeps the original shader rather than
  // shipping half-rewritten GLSL.
  function Patcher(src) {
    this.src = src;
    this.ok = true;
  }
  Patcher.prototype.at = function (find, repl, label) {
    if (this.src.indexOf(find) < 0) {
      this.ok = false;
      console.warn("[waterfx] shader anchor missing, keeping vendor shader:", label);
      return this;
    }
    this.src = this.src.split(find).join(repl);
    return this;
  };

  function patchVertex(src) {
    const p = new Patcher(src);
    p.at(
      "varying vec4 mirrorCoord;",
      [
        "varying vec4 mirrorCoord;",
        CBZ.waterVertexDecl(),
        "varying vec3 vSwellN;",
        "varying float vSwellH;",
        "varying float vDist;",
        "varying float vFade;",
        "varying float vInland;",
      ].join("\n"),
      "vertex declarations");

    p.at(
      "mirrorCoord = modelMatrix * vec4( position, 1.0 );",
      [
        // The disc is authored in the mesh's local XY plane and the mesh is
        // rotated -90 about X, so modelMatrix already lands it flat at SEA_Y;
        // waterVertexBody() then re-centres it on the camera and displaces it
        // by the shared swell field.
        CBZ.waterVertexBody("modelMatrix * vec4( position, 1.0 )"),
        "vSwellN = wNormal;",
        "vSwellH = wHeightN;",
        "vDist = wDist;",
        "vFade = wFade;",
        "vInland = wInland;",
        "mirrorCoord = vec4( wWorld, 1.0 );",
      ].join("\n"),
      "vertex world position");

    p.at(
      "vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );",
      "vec4 mvPosition = viewMatrix * vec4( wWorld, 1.0 );",
      "vertex clip position");

    return p;
  }

  function patchFragment(src) {
    const p = new Patcher(src);
    p.at(
      "varying vec4 worldPosition;",
      [
        "varying vec4 worldPosition;",
        CBZ.waterFragmentDecl(),
        "varying vec3 vSwellN;",
        "varying float vSwellH;",
        "varying float vDist;",
        "varying float vFade;",
        "varying float vInland;",
      ].join("\n"),
      "fragment declarations");

    // Top of main(): sample the baked shore field and reject fragments that
    // sit over dry land. The single-quad reflector never had this, so it
    // relied entirely on the terrain depth-testing it away — the exact
    // quantisation failure the shader sea's own land mask exists to avoid.
    p.at(
      "#include <logdepthbuf_fragment>",
      [
        "#include <logdepthbuf_fragment>",
        "vec4 cbzField = cbzWaterField( worldPosition.xz );",
        "if ( uSeaHasLandMask > 0.5 && cbzField.r > uShoreCut ) discard;",   // uShoreCut: 0.5 = the real coast; a surge raises it and the sea comes ashore
        "float cbzInland = max( vInland, cbzField.a );",
        // WATER_FAR_CALM: the metre-scale ripple normal is pure aliasing once
        // its texels are far smaller than a pixel, so lerp the shading normal
        // toward the geometric one much harder and much sooner (GPU Gems 1
        // ch.1). The VERTEX side of the same idea lives in water_spec.js's
        // cbzWaveAmp3 (`cfade`), which is what stops the SILHOUETTE crawling
        // too — a normal-only fade leaves the horizon twinkling.
        "float cbzDetail = " + (CBZ.waterFarCalmOn && CBZ.waterFarCalmOn()
          ? "mix( 0.62, 0.15, smoothstep( 70.0, 1100.0, vDist ) )"
          : "mix( 0.60, 0.16, smoothstep( 90.0, 1500.0, vDist ) )") +
          " * mix( 1.0, 0.42, cbzInland ) * ( 1.0 + uChop * 0.5 );",
        // WATER_SURFACE_LOOK — the streak lanes and the shore calm band. Both
        // collapse to their inert values (0.5 / 0.0) with the flag off.
        "float cbzLaneAmt = cbzLane( worldPosition.xz );",
        "float cbzCalm = cbzShoreCalm( cbzField );",
      ].join("\n"),
      "fragment shore field");

    // Blend the ripple normal ONTO the real geometric swell normal instead of
    // replacing the surface with pure noise.
    p.at(
      "vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );",
      [
        // The vendor's own single-octave getNoise() is the legacy ripple; the
        // shared cbzSeaNormal replaces it with the wind-stretched three-octave
        // field (and reproduces the OLD pair exactly when the flag is off), so
        // the mirror and the shader sea are the same surface to the pixel.
        "vec3 surfaceNormal = cbzSeaNormal( vSwellN, worldPosition.xz, vDist, cbzDetail, cbzCalm, cbzLaneAmt );",
        "if ( uLook.x < 0.001 ) {",
        "  vec3 cbzFine = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );",
        "  surfaceNormal = normalize( vSwellN + cbzFine * cbzDetail - vec3( 0.0, cbzDetail, 0.0 ) );",
        "}",
        "surfaceNormal = mix( surfaceNormal, -surfaceNormal, gl_FrontFacing ? 0.0 : 1.0 );",
      ].join("\n"),
      "fragment surface normal");

    // WATER_SURFACE_LOOK — the two lines that decide whether an ocean has a
    // colour at all beyond fifty metres.
    //
    //   • REFLECTANCE. The vendor's rf0 + (1-rf0)*pow(1-theta,5) is a MIRROR's
    //     Fresnel, and past a few tens of metres every water pixel is at a
    //     grazing angle, so it returned ~0.9 and the sea became a sheet of
    //     reflected sky. cbzFresnel relaxes toward a ROUGH surface's response
    //     exactly as fast as the ripple normal is faded out for anti-aliasing,
    //     which is the same trade a real microfacet LOD makes. Identical to the
    //     vendor expression at distance 0 (and everywhere, flag off).
    //   • THE SAMPLE. The mirror pass renders the SKY RIG ONLY, so a distant
    //     texel is a razor-sharp cloud edge painted on water that is no longer
    //     being told it is rough — the marbled white smears in the reference
    //     comparison. cbzReflectGrade pre-filters it toward the analytic sky in
    //     the same reflected direction, and lets the streak lanes decide which
    //     bands catch the most of it.
    p.at(
      "float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );",
      [
        "float reflectance = mix( rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 ),",
        "                         cbzFresnel( theta, vDist ), step( 0.001, uLook.x ) );",
        "reflectionSample = cbzReflectGrade( reflectionSample, reflect( -eyeDirection, surfaceNormal ), vDist, theta, cbzLaneAmt );",
      ].join("\n"),
      "fragment reflectance");

    // WATER IS NOT A DIFFUSE SURFACE. The vendor adds `sunColor * diffuseLight
    // * 0.3` — a flat white Lambert wash worth ~0.135 of linear radiance on a
    // sunlit sea, which is MORE than the whole body colour contributes and is
    // most of why this ocean read as pale grey-green plastic whatever the tint
    // was set to. What actually comes back out of water toward the sun is
    // sub-surface scatter, and it is the colour of the WATER, not of the sun.
    // Keep a tenth of it, tinted by the body. Flag off -> the vendor term.
    p.at(
      "vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), reflectionSample + specularLight, reflectance );",
      [
        "vec3 cbzWash = mix( sunColor * diffuseLight * 0.3,",
        "                    sunColor * diffuseLight * 0.075 * ( 0.30 + cbzBody * 2.6 ),",
        "                    step( 0.001, uLook.x ) );",
        "vec3 albedo = mix( ( cbzWash + scatter ) * getShadowMask(), reflectionSample + specularLight, reflectance );",
      ].join("\n"),
      "fragment albedo wash");

    // Depth-graded body colour: turquoise shallows, deep blue offshore, a
    // green calm over registered inland lakes.
    p.at(
      "vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;",
      [
        "vec3 cbzBody = cbzDepthColor( waterColor, cbzField, cbzInland );",
        "vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * cbzBody;",
        // A rough sea is not a dark mirror: the body colour has to survive the
        // reflection, so lift the scatter term as roughness rises. Without
        // this the graded reflection alone still washes the teal out.
        "scatter = mix( scatter, cbzBody * ( 0.55 + 0.45 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) ), cbzRough( vDist, theta ) * 0.85 );",
      ].join("\n"),
      "fragment depth colour");

    // Final composite: sun glitter, advancing surf, whitecaps, underside.
    p.at(
      "gl_FragColor = vec4( outgoingLight, alpha );",
      [
        "vec3 cbzOut = outgoingLight;",
        "cbzOut += cbzSunGlitter( surfaceNormal, eyeDirection, normalize( uSunDir ), reflectance, vFade ) * mix( 1.0, 0.30, cbzInland );",
        "cbzOut += cbzSheen( surfaceNormal, eyeDirection, normalize( uSunDir ), cbzLaneAmt, vDist, reflectance ) * mix( 1.0, 0.35, cbzInland );",
        "float cbzSurfAmt = cbzSurf( worldPosition.xz, cbzField, vSwellH, vFade );",
        "float cbzCapAmt = cbzWhitecap( worldPosition.xz, vSwellH, vFade, cbzInland );",
        "float cbzUnder = gl_FrontFacing ? 0.0 : 1.0;",
        "float cbzFoam = clamp( cbzSurfAmt * 0.66 + cbzCapAmt * 0.60, 0.0, 0.92 ) * ( 1.0 - cbzUnder * 0.72 );",
        // From below, the mirror texture is meaningless — fall back to a
        // silvery body/foam ceiling that goes reflective at grazing angles.
        "vec3 cbzUnderCol = mix( cbzBody * 0.72, cbzBody * 1.30 + uFoamColor * 0.22, clamp( reflectance * 1.45, 0.0, 1.0 ) );",
        "cbzOut = mix( cbzOut, cbzUnderCol, cbzUnder );",
        "cbzOut = mix( cbzOut, uFoamColor, cbzFoam );",
        // SEA_TRANSLUCENT (world/water_spec.js). The MIRROR sea is the one
        // actually on screen at quality tier >= 2, so it needs the identical
        // alpha the shader sea got or "you can see into the water" would be
        // true only on low quality. eyeDirection is the vendor's own
        // normalize(eye - worldPosition), i.e. exactly the V cbzSeaAlpha
        // wants. uClarity.x is 0 with the flag off and this is a no-op.
        "gl_FragColor = vec4( cbzOut, alpha * cbzSeaAlpha( eyeDirection, vDist, cbzUnder, cbzFoam ) );",
      ].join("\n"),
      "fragment composite");

    return p;
  }

  function build(flat) {
    const parent = flat.parent;
    if (!parent) return;
    teardown(); // clear any stale reflector (e.g. a rebuilt city root)

    const y = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    const key = buildKey();

    // Same radial disc the shader sea uses, converted from the XZ plane into
    // the mesh's LOCAL XY plane. The mesh's own -90 degree X rotation puts it
    // back flat — and that rotation is load-bearing: WaterReflect derives its
    // mirror plane from the mesh's world matrix (local +Z must become world
    // +Y), so the plane stays exactly y = SEA_Y with an upward normal.
    // world/water_spec.js hands back an XZ-plane surface; the fallback below
    // is authored the same way so the single rotateX() next is always correct.
    let geo;
    if (CBZ.waterBuildSeaGeometry) {
      geo = CBZ.waterBuildSeaGeometry(tier());
    } else {
      geo = new THREE.PlaneGeometry(16000, 16000);
      geo.rotateX(-Math.PI / 2);
    }
    geo.rotateX(Math.PI / 2);
    // rotateX() recomputes the bounds from the raw vertices, which would hand
    // city/playeraircraft.js an airspace box smaller than the published sea
    // footprint. Re-stamp it by hand: after the mesh's own -90deg X rotation,
    // world x = local x and world z = -local y, so this maps back to exactly
    // SEA_WORLD_BOUNDS (or the disc, whichever is larger).
    (function () {
      const rd = geo.userData && geo.userData.waterRadial;
      const r1 = rd ? rd.outer : 8000;
      const B = CBZ.SEA_WORLD_BOUNDS;
      let x0 = -r1, x1 = r1, z0 = -r1, z1 = r1;
      if (B && Number.isFinite(B.minX)) {
        x0 = Math.min(x0, B.minX); x1 = Math.max(x1, B.maxX);
        z0 = Math.min(z0, B.minZ); z1 = Math.max(z1, B.maxZ);
      }
      geo.boundingBox = new THREE.Box3(
        new THREE.Vector3(x0, -z1, 0), new THREE.Vector3(x1, -z0, 0));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0),
        Math.max(r1, Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) * 1.45);
    })();

    const water = new THREE.WaterReflect(geo, {
      textureWidth: mirrorSize(),
      textureHeight: mirrorSize(),
      alpha: 1.0,
      // ONE table (world/water_spec.js): world.js's day sea, re-tinted per frame
      waterColor: (CBZ.WATER_TONES && CBZ.WATER_TONES.day != null) ? CBZ.WATER_TONES.day : 0x0d3b58,
      sunColor: 0xfff4e0,
      sunDirection: _sunDir.clone(),
      // Livelier than before: the surface now has real geometric relief for
      // the distortion to ride on, so a flat-water-only value read too calm.
      distortionScale: 5.5,
      size: 6.0,                 // ripple frequency of the tiling normal map
      side: THREE.DoubleSide,    // you can be UNDER the sea now
      fog: !!(CBZ.scene && CBZ.scene.fog) // melt the horizon into the day/night fog
    });
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, y, 0);   // XZ comes from the vertex program
    water.name = "world-sea-reflect";
    water.frustumCulled = false;              // the horizon is everywhere
    water.receiveShadow = false;
    water.castShadow = false;
    // batch (core/batch.js) + farcull exempt via non-empty userData; also the
    // flags the world-surface audits key on so it reads as the one ocean.
    water.userData.terrain = true;
    water.userData.waterSurface = true;
    water.userData.surfaceOwner = "world-water";
    water.userData.unifiedSurface = true;
    water.userData.waterMode = "reflect-mirror";

    // ---- graft the shared water shading onto the vendor mirror shader ----
    const mat = water.material;
    if (CFG.WATER_V2 !== false && CBZ.waterVertexDecl && CBZ.waterCommonUniforms) {
      const U = CBZ.waterCommonUniforms();
      U.uSeaLandMask.value = CBZ.citySeaFieldTexture || null;
      if (CBZ.citySeaFieldBounds) U.uSeaLandBounds.value.copy(CBZ.citySeaFieldBounds);
      U.uSeaHasLandMask.value = CBZ.citySeaFieldTexture ? 1 : 0;
      U.uSeaY.value = y;
      const pv = patchVertex(mat.vertexShader);
      const pf = patchFragment(mat.fragmentShader);
      if (pv.ok && pf.ok) {
        mat.vertexShader = pv.src;
        mat.fragmentShader = pf.src;
        for (const k in U) if (mat.uniforms[k] === undefined) mat.uniforms[k] = U[k];
        mat.userData.waterMode = "reflect-mirror+swell-shore";
        /* SEA_TRANSLUCENT. The mirror now writes an alpha < 1 near the camera,
           so it has to be allowed to blend — but it KEEPS depthWrite, exactly
           as the shader sea does (city/world.js has the note): a 16 km sheet
           that stopped owning its depth would stop occluding everything under
           it. All that changes is which pass it draws in, and renderOrder -1
           pins it first inside that pass so it can never be sorted on top of
           the spray and foam riding on it. */
        if (CBZ.seaTranslucentOn && CBZ.seaTranslucentOn()) {
          mat.transparent = true;
          mat.depthWrite = true;
          water.renderOrder = -1;
        }
        mat.needsUpdate = true;
      }
    }
    reflectU = mat.uniforms;

    // HALF-RATE mirror: skip the whole-scene mirror render every other frame
    // and reuse the cached target. Wrapping (not editing the addon) keeps the
    // vendor port faithful.
    //
    // SKY-ONLY MIRROR (2026-08-03 slow-boot wave): the full-scene mirror
    // measured as the single largest cost in the whole game — it re-rendered
    // the entire world (~7k draw calls PLUS a full 150k-object projectObject
    // walk) into the target every other frame AND forced a Linear-encoding
    // twin of every lit shader program (62 of 196 boot programs). r128
    // compiles programs with a synchronous CPU↔GPU stall, so the twins alone
    // were ~20s of a ~35s city boot; the A/B (?cfg_WATER_REFLECT=0) went
    // 2.3→11 fps and 30s→15s title→city. The mirror pass now renders a
    // MINI-SCENE holding just the sky rig (reparented in for the pass, back
    // out after): the ocean keeps sky, clouds, sun and Fresnel shine — only
    // unlit sky materials ever compile a Linear twin, and the mirror's scene
    // walk is ~dozens of objects instead of 150k. The mirrored skyline is
    // the only loss, and it read as ripple noise in a 256px target anyway.
    // ?cfg_WATER_REFLECT_SCENE=1 restores the full mirror.
    if (CFG.WATER_REFLECT_SCENE == null) CFG.WATER_REFLECT_SCENE = false;
    const mirror = water.onBeforeRender;
    const miniSky = new THREE.Scene();
    miniSky.name = "mirror-sky-scene";
    let parity = 0;
    water.onBeforeRender = function (renderer, scene, camera) {
      parity ^= 1;
      if (parity === 0) return;               // reuse last mirror frame
      let rig = !CFG.WATER_REFLECT_SCENE && CBZ.skyDome && (CBZ.skyDome.parent || CBZ.skyDome);
      if (rig && rig.isScene) rig = CBZ.skyDome;   // dome parented straight to the scene
      if (rig && rig !== miniSky) {
        const home = rig.parent || null;
        miniSky.fog = scene.fog || null;      // keep the horizon melt exact
        miniSky.add(rig);
        try { mirror.call(this, renderer, miniSky, camera); }
        finally { if (home) home.add(rig); else miniSky.remove(rig); }
      } else mirror.call(this, renderer, scene, camera);
    };

    parent.add(water);
    reflect = water;
    flatSea = flat;
    builtKey = key;
    applyMode();
  }

  // Show exactly ONE ocean: the reflector when enabled + quality allows, else
  // the shader sea. CBZ.citySea always points at whichever is visible
  // (the world-surface audits read it), so the map still sees a single water
  // surface. Player aircraft no longer derive a hidden boundary from this mesh.
  function applyMode() {
    if (!reflect || !flatSea) return;
    const on = CFG.WATER_REFLECT !== false && qualityOk();
    reflect.visible = on;
    flatSea.visible = !on;
    CBZ.citySea = on ? reflect : flatSea;
  }

  // Lazily wrap the sea once world.js has built it (buildCity runs during the
  // first city entry and caches, so this fires once), then drive the runtime
  // FX uniforms every frame.
  //
  // onALWAYS, not onUpdate: the wave clock, the sun vector and the mirror must
  // keep running while the game is paused, exactly like world.js's own sea
  // tick at order 93 — a paused ocean that snaps forward on unpause is the
  // most obvious "this is a video game" tell there is. Slotted at 93.5: after
  // world.js publishes the day/night sea colour we copy, before core/sky.js
  // (99) reads the fog.
  CBZ.onAlways(93.5, function (dt) {
    // core/quality.js parses AFTER this file, so the tier listener cannot be
    // registered at load time. Hook it the first time we run instead.
    if (!qualityHooked && CBZ.onQualityChange) {
      qualityHooked = true;
      CBZ.onQualityChange(function () { applyMode(); });
    }

    const sea = CBZ.citySea;
    // Build only when enabled; if the flag is off we never create a reflector,
    // so the shader sea renders untouched (one-line revert). Rebuild if a prior
    // reflector was orphaned by a city-root rebuild.
    if (CFG.WATER_REFLECT !== false && isFlatSea(sea) && (!reflect || !reflect.parent)) {
      build(sea);
    }
    if (!reflect) return;

    applyMode(); // honours the flag + live quality tier every frame
    if (!reflect.visible) return;

    // A tier change that alters the disc tessellation or the mirror resolution
    // rebuilds the reflector outright (it owns a render target, so this is the
    // honest way to resize it). Cheap and rare — only on a real tier move.
    if (builtKey !== buildKey() && flatSea) { build(flatSea); return; }

    const U = reflectU;
    if (!U) return;

    // Shared driver: wave clock, sun direction + tint, weather chop. The SAME
    // function drives world.js's sea, so the two surfaces can never disagree
    // about where a crest is (which matters the instant one swaps for the
    // other on a quality change).
    if (CBZ.waterDriveCommonUniforms) CBZ.waterDriveCommonUniforms(U);

    if (U.time) U.time.value = U.uSeaTime ? U.uSeaTime.value : (U.time.value + (dt || 0));

    // Sun direction TO the sun + its blended tint, from core/daynight.js, so
    // dawn/dusk sunlight rides on the water. The light travels sun -> target;
    // the direction to the sun is target -> sun.
    if (CBZ.sun && CBZ.sunTarget && U.sunDirection) {
      _sunDir.copy(CBZ.sun.position).sub(CBZ.sunTarget.position);
      if (_sunDir.lengthSq() > 1e-6) { _sunDir.normalize(); U.sunDirection.value.copy(_sunDir); }
    }
    if (CBZ.sunTint && U.sunColor) U.sunColor.value.copy(CBZ.sunTint);

    // Deep-water scatter tint follows world.js's own per-frame day/night sea
    // colour (it keeps updating flatSea's material colour even while hidden),
    // so the reflector shifts tone with the cycle for free.
    if (flatSea.material && flatSea.material.color) {
      if (U.waterColor) U.waterColor.value.copy(flatSea.material.color);
      if (U.uSeaColor) U.uSeaColor.value.copy(flatSea.material.color);
    }

    // The land mask is baked by world.js's buildSea, which may finish after our
    // first frame. Adopt it as soon as it exists.
    if (U.uSeaHasLandMask && U.uSeaHasLandMask.value < 0.5 && CBZ.citySeaFieldTexture) {
      U.uSeaLandMask.value = CBZ.citySeaFieldTexture;
      if (CBZ.citySeaFieldBounds) U.uSeaLandBounds.value.copy(CBZ.citySeaFieldBounds);
      U.uSeaHasLandMask.value = 1;
    }
  });

  // A live quality-tier change (settings panel / adaptive governor) flips
  // between the reflector and the shader sea.
  if (CBZ.onQualityChange) { qualityHooked = true; CBZ.onQualityChange(function () { applyMode(); }); }
})();
