/* ============================================================
   core/gfx.js — THE RENDER-REALISM LAYER. Loads LAST of the render
   stack (after core/quality.js and after core/batch.js, both of which
   it hooks) and owns five things nothing else could own alone:

   1. THE LIGHT-WRITER ARBITER. core/daynight.js (@2), modes/survival.js
      (@93) and city/mode.js (@94) each used to write sun/hemi intensity
      and colour with their own private literals, last-one-wins. This
      file runs at @94.5 — after ALL of them — and re-applies the ONE
      shared rig (CBZ.lightRig.daylight) in city mode, aims the ground
      bounce fill from whatever sun position finally survived, and pins
      the shadow frustum to the quality tier.

   2. TONE-MAP-AWARE EXPOSURE. A filmic curve without a matching
      exposure is just a dimmer. Exposure rides the day clock as a
      gentle eye adaptation.

   3. WORLD PBR PROMOTION — and the draw-call trap it has to dodge.
      core/batch.js merges the entire static city shell into a handful
      of meshes that share a handful of white vertex-colour
      MeshLambertMaterials. We promote the BATCHER'S OWN OUTPUT
      materials to MeshStandardMaterial *after* the merge has happened:
      the merge set, the vertex buffers and the draw call count are
      bit-for-bit unchanged, the number of materials touched is single
      digits, and every merged surface gains energy-conserving shading.

   4. THE MATERIAL MODEL (the part that used to make the city look like
      cardboard on High/Best — see "THE CARDBOARD BUG" below).

   5. ENVIRONMENT REACH. CBZ.ENV (world/carfx.js's PMREM) is attached to
      every promoted material and every cmat twin, and its intensity is
      driven from the day clock here.

   ------------------------------------------------------------------
   THE CARDBOARD BUG (High/Best only; Fast/Balanced never promote).
   Measured 2026-09-04 with tools/cityhost.mjs, same camera, tiers 0/2/4:
   on Best every building lost its shadow-side contrast — both faces of a
   white block went near-white, dark window insets turned warm grey-brown,
   and the base of every wall carried a smudged dark band. Four causes, all
   in the promotion path, all fixed here:

     a) DOUBLE AMBIENT. MeshStandardMaterial's envMap feeds BOTH indirect
        specular AND indirect diffuse. The PMREM gradient was attached at
        intensity 0.5 on top of the hemisphere light that already IS the
        sky ambient, so every promoted surface received ~40% extra flat
        fill light, tinted by the gradient's grey-brown horizon band. That
        is exactly a matte cardboard box under a softbox. The env's
        diffuse share is now scaled down in-shader (cbzEnvDiffuse) so the
        environment does what it is for — reflections — and the hemisphere
        stays the one sky-ambient owner. Exposure at tiers 3/4 was also
        bumped +2/+4% "for punch"; that compounded the wash. Gone.

     b) ENV NEVER FOLLOWED THE CLOCK. The gradient is a daytime sky and it
        was applied at full strength at midnight. envMapIntensity now rides
        CBZ.dayness every frame (finalizer below).

     c) ONE SUBSTANCE. Every promoted fragment had roughness 0.88 — paint,
        plaster, bitumen, dark trim, all one dull matte. Real materials
        differ mostly in how light LEAVES them. Roughness is now derived
        per fragment from the albedo the batcher baked into vertex colour:
        saturated colours read as paint and get a broad sheen, pale
        neutrals as render/cladding, near-blacks as dark glossy trim,
        horizontals stay gritty. Plus a slow world-space tone breakup so no
        wall is a perfectly uniform sheet.

     d) GRAIN INSTEAD OF DETAIL. One "concrete" micro normal map was
        projected onto EVERY surface at one scale and 0.55 strength —
        the same 2 cm pores on a roof, a kerb, a painted sign and a wall
        50 m away. Uniform fine grain is what paper looks like. The
        micro-normal now differs by orientation (floors bumpier than
        walls), fades out with view distance so it never becomes shimmer,
        and the surface interest at mid range comes from grime at the
        base of walls and the tone breakup instead.

   Also fixed: r128 keys the shader program cache on
   material.customProgramCacheKey(), which defaults to
   onBeforeCompile.toString() — re-installing an identical-looking hook
   with different flags therefore never recompiled, so a tier/flag change
   silently kept the old program. Every promoted material now carries an
   explicit cache key built from the live feature set.

   Everything here is behind a CBZ.CONFIG flag and gated by the quality
   tier table in core/quality.js (CBZ.gfxTier). Tier 0 receives NONE of
   it and stays exactly as cheap as it has always been.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // GFX_WORLD_PBR — promote the batcher's merged output materials to
  // MeshStandardMaterial. Flip false (or ?cfg_GFX_WORLD_PBR=0) and the
  // merged world stays exactly the Lambert it is on lower tiers.
  if (CBZ.CONFIG.GFX_WORLD_PBR == null) CBZ.CONFIG.GFX_WORLD_PBR = true;
  // GFX_WORLD_DETAIL — world-projected micro normal + tone breakup on
  // promoted materials (two texture fetches per fragment on merged geometry).
  if (CBZ.CONFIG.GFX_WORLD_DETAIL == null) CBZ.CONFIG.GFX_WORLD_DETAIL = true;
  // GFX_CONTACT_AO — indirect-only ambient occlusion approximation.
  if (CBZ.CONFIG.GFX_CONTACT_AO == null) CBZ.CONFIG.GFX_CONTACT_AO = true;
  // GFX_ENV_WORLD — environment reflections on promoted + twin materials.
  // NOTE: r128 falls back to scene.environment for ANY Standard material
  // without its own envMap, so "off" is enforced through envMapIntensity=0,
  // never by nulling envMap.
  if (CBZ.CONFIG.GFX_ENV_WORLD == null) CBZ.CONFIG.GFX_ENV_WORLD = true;
  // GFX_AUTO_EXPOSURE — day/night eye adaptation on toneMappingExposure.
  if (CBZ.CONFIG.GFX_AUTO_EXPOSURE == null) CBZ.CONFIG.GFX_AUTO_EXPOSURE = true;
  // GFX_TIGHT_SHADOWS — let the quality tier own the city shadow frustum.
  if (CBZ.CONFIG.GFX_TIGHT_SHADOWS == null) CBZ.CONFIG.GFX_TIGHT_SHADOWS = true;
  // GFX_MATERIAL_MODEL — albedo-derived roughness + grime + tone breakup.
  // Off = one flat roughness everywhere (the cardboard look, for A/B).
  if (CBZ.CONFIG.GFX_MATERIAL_MODEL == null) CBZ.CONFIG.GFX_MATERIAL_MODEL = true;

  // ---- tunables (all live: a change + CBZ.setQualityLevel() re-applies) ----
  // Micro-normal: tiles per world metre, strength on walls / floors, and the
  // view distance (m) at which each has fully faded to flat.
  if (CBZ.CONFIG.GFX_DETAIL_SCALE == null) CBZ.CONFIG.GFX_DETAIL_SCALE = 0.42;
  if (CBZ.CONFIG.GFX_WALL_BUMP == null) CBZ.CONFIG.GFX_WALL_BUMP = 0.16;
  if (CBZ.CONFIG.GFX_FLOOR_BUMP == null) CBZ.CONFIG.GFX_FLOOR_BUMP = 0.42;
  if (CBZ.CONFIG.GFX_WALL_BUMP_FADE == null) CBZ.CONFIG.GFX_WALL_BUMP_FADE = 26;
  if (CBZ.CONFIG.GFX_FLOOR_BUMP_FADE == null) CBZ.CONFIG.GFX_FLOOR_BUMP_FADE = 70;
  // Tone breakup: one tile per this many metres, and its albedo amplitude.
  if (CBZ.CONFIG.GFX_MACRO_METRES == null) CBZ.CONFIG.GFX_MACRO_METRES = 9;
  if (CBZ.CONFIG.GFX_MACRO_AMOUNT == null) CBZ.CONFIG.GFX_MACRO_AMOUNT = 0.07;
  // Grime: max albedo darkening at the foot of a wall, and its height (m).
  if (CBZ.CONFIG.GFX_GRIME == null) CBZ.CONFIG.GFX_GRIME = 0.16;
  if (CBZ.CONFIG.GFX_GRIME_HEIGHT == null) CBZ.CONFIG.GFX_GRIME_HEIGHT = 1.5;
  // Share of the environment map's DIFFUSE term that survives (1 = stock
  // three.js double-ambient). Specular reflections are never scaled by this.
  if (CBZ.CONFIG.GFX_ENV_DIFFUSE == null) CBZ.CONFIG.GFX_ENV_DIFFUSE = 0.22;
  // Base envMapIntensity for the merged world and for cmat twins, at noon.
  if (CBZ.CONFIG.GFX_ENV_WORLD_INTENSITY == null) CBZ.CONFIG.GFX_ENV_WORLD_INTENSITY = 0.60;
  if (CBZ.CONFIG.GFX_ENV_TWIN_INTENSITY == null) CBZ.CONFIG.GFX_ENV_TWIN_INTENSITY = 0.45;

  function tier() { return CBZ.gfxTier || {}; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* =================================================================
     A. MATERIAL TWIN SYNC (world/materials.js's cmat PBR path)
     ================================================================= */

  // CBZ.cmat() hands out a Lambert and a Standard body for every cache key,
  // each pointing at the other through `_cbzTwin`. Walking the scene and
  // flipping mesh.material between them is what lets us (a) present the
  // batcher with the exact Lambert world it has always merged, and (b) drop
  // the whole world back to Lambert instantly when the tier falls.
  function wantTwins() {
    return !!(CBZ.CONFIG.GFX_PBR_MATERIALS && tier().pbr && CBZ.gfxPbrArmed);
  }

  function swapMaterial(o, wantPbr) {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) {
      for (let i = 0; i < m.length; i++) {
        const e = m[i];
        if (e && e._cbzTwin && !!e._cbzPbr !== wantPbr) m[i] = e._cbzTwin;
      }
      return;
    }
    if (m._cbzTwin && !!m._cbzPbr !== wantPbr) o.material = m._cbzTwin;
  }

  function swapTree(root, wantPbr) {
    if (!root || !root.traverse) return 0;
    let n = 0;
    root.traverse(function (o) { if (o.material) { swapMaterial(o, wantPbr); n++; } });
    return n;
  }

  CBZ.gfxSyncMaterials = function (force) {
    const want = force != null ? !!force : wantTwins();
    swapTree(CBZ.scene, want);
    if (CBZ.prisonRoot) swapTree(CBZ.prisonRoot, want);
    return want;
  };

  /* =================================================================
     B. THE MATERIAL MODEL — one onBeforeCompile, two flavours
     ================================================================= */

  // The surface library hands back the SAME texture instances for the same
  // (name, repeat) — so this is one upload shared by every promoted material.
  //   normal → micro bumps (sampled with our own world-projected UVs)
  //   map    → the low-frequency "stain" field, reused as tone breakup noise
  let detailMaps = null;
  function getDetailMaps() {
    if (detailMaps !== null) return detailMaps;
    if (!CBZ.CONFIG.GFX_WORLD_DETAIL || !tier().normals || !CBZ.surfaceMaps) { detailMaps = false; return false; }
    const maps = CBZ.surfaceMaps("concrete", { repeat: 1 });
    detailMaps = (maps && maps.normalMap && maps.map) ? { normal: maps.normalMap, macro: maps.map } : false;
    return detailMaps;
  }

  // Feature signature: what the shader will contain. Doubles as the program
  // cache key so a change here (tier, flag) is a real recompile.
  function shaderFeatures(world) {
    const maps = world ? getDetailMaps() : false;
    return {
      world: !!world,
      detail: !!maps,
      ao: !!(world && CBZ.CONFIG.GFX_CONTACT_AO),
      model: !!CBZ.CONFIG.GFX_MATERIAL_MODEL,
      maps: maps || null,
    };
  }
  function featureKey(F) {
    return "cbzgfx|w" + (F.world ? 1 : 0) + "d" + (F.detail ? 1 : 0) + "a" + (F.ao ? 1 : 0) + "m" + (F.model ? 1 : 0);
  }

  /* installShader(mat, world)
       world=true  — a batcher output (merged, world-baked, vertex-coloured):
                     gets the projected micro-normal, tone breakup, grime and
                     contact AO on top of the material model.
       world=false — a cmat twin (an un-merged shared prop material): gets the
                     material model + env-diffuse budget only.                */
  function installShader(mat, world) {
    const F = shaderFeatures(world);
    const key = featureKey(F);
    mat._cbzGfxKey = key;
    mat.customProgramCacheKey = function () { return key; };

    mat.onBeforeCompile = function (sh) {
      const vSrc = sh.vertexShader, fSrc = sh.fragmentShader;
      // EVERY anchor is verified before anything is emitted: a fragment that
      // reads a varying its vertex partner never wrote is the one failure
      // mode here that is not visibly obvious. Any miss → ship the plain
      // promoted material rather than a subtly wrong one.
      const need = ["#include <common>", "#include <color_fragment>", "#include <roughnessmap_fragment>",
        "#include <normal_fragment_maps>", "#include <lights_fragment_maps>", "#include <aomap_fragment>"];
      for (let i = 0; i < need.length; i++) if (fSrc.indexOf(need[i]) < 0) return;
      if (F.world && (vSrc.indexOf("#include <common>") < 0 || vSrc.indexOf("#include <project_vertex>") < 0)) return;

      const U = sh.uniforms;
      U.cbzEnvDiffuse = { value: clamp01(+CBZ.CONFIG.GFX_ENV_DIFFUSE) };
      if (F.world) {
        U.cbzDetail = { value: F.maps ? F.maps.normal : null };
        U.cbzMacro = { value: F.maps ? F.maps.macro : null };
        U.cbzDetailScale = { value: +CBZ.CONFIG.GFX_DETAIL_SCALE || 0.42 };
        U.cbzMacroScale = { value: 1 / Math.max(1, +CBZ.CONFIG.GFX_MACRO_METRES || 9) };
        U.cbzMacroAmt = { value: +CBZ.CONFIG.GFX_MACRO_AMOUNT || 0 };
        U.cbzBump = { value: new THREE.Vector2(+CBZ.CONFIG.GFX_WALL_BUMP || 0, +CBZ.CONFIG.GFX_FLOOR_BUMP || 0) };
        U.cbzBumpFade = { value: new THREE.Vector2(+CBZ.CONFIG.GFX_WALL_BUMP_FADE || 26, +CBZ.CONFIG.GFX_FLOOR_BUMP_FADE || 70) };
        U.cbzGrime = { value: new THREE.Vector2(+CBZ.CONFIG.GFX_GRIME || 0, +CBZ.CONFIG.GFX_GRIME_HEIGHT || 1.5) };
        U.cbzAo = { value: new THREE.Vector2(0.34, 2.4) };   // strength, height (m)
      }

      // ---- vertex: publish world position + world normal (world only) ----
      // Merged meshes are plain, un-instanced, un-skinned children of the city
      // root, so modelMatrix is the whole story here.
      if (F.world) {
        sh.vertexShader = vSrc
          .replace("#include <common>", "#include <common>\nvarying vec3 cbzWPos;\nvarying vec3 cbzWNrm;")
          .replace("#include <project_vertex>",
            "#include <project_vertex>\n" +
            "  cbzWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
            "  cbzWNrm = normalize( mat3( modelMatrix ) * normal );");
      }

      // ---- fragment ----------------------------------------------------
      let fs = fSrc.replace("#include <common>",
        "#include <common>\n" +
        "uniform float cbzEnvDiffuse;\n" +
        (F.world ?
          "varying vec3 cbzWPos;\nvarying vec3 cbzWNrm;\n" +
          "uniform sampler2D cbzDetail;\nuniform sampler2D cbzMacro;\n" +
          "uniform float cbzDetailScale;\nuniform float cbzMacroScale;\nuniform float cbzMacroAmt;\n" +
          "uniform vec2 cbzBump;\nuniform vec2 cbzBumpFade;\nuniform vec2 cbzGrime;\nuniform vec2 cbzAo;\n"
          : ""));

      // 1) after the vertex colour lands in diffuseColor: orientation, the
      //    tone-breakup field, and grime. Declared at main() scope so the
      //    later hooks can read them.
      let colorHook = "#include <color_fragment>\n" +
        "  float cbzMac = 0.0;\n" +
        "  bool cbzUp = false;\n";
      if (F.world) {
        colorHook +=
          "  vec3 cbzA = abs( cbzWNrm );\n" +
          "  cbzUp = ( cbzA.y >= cbzA.x && cbzA.y >= cbzA.z );\n" +
          "  bool cbzSideX = ( !cbzUp && cbzA.x >= cbzA.z );\n" +
          // DOMINANT-AXIS world projection: this city is axis-aligned boxes,
          // so one fetch buys what a triplanar blend would.
          "  vec2 cbzUV = cbzUp ? cbzWPos.xz : ( cbzSideX ? cbzWPos.zy : cbzWPos.xy );\n" +
          "  float cbzDist = length( vViewPosition );\n";
        if (F.detail) {
          // concrete's colour field: 0.40..0.62, mean ~0.51 → ±~0.6 signed
          colorHook +=
            "  cbzMac = clamp( ( texture2D( cbzMacro, cbzUV * cbzMacroScale ).g - 0.51 ) * 6.0, -1.0, 1.0 );\n";
        }
        if (F.model) {
          colorHook +=
            "  diffuseColor.rgb *= 1.0 + cbzMac * cbzMacroAmt;\n" +
            // Grime: walls only, strongest at the pavement line, broken up by
            // the same field so it is a tide mark, not a gradient. Slightly
            // warm-dark, the way city dirt is.
            "  if ( !cbzUp ) {\n" +
            "    float cbzG = ( 1.0 - smoothstep( 0.0, cbzGrime.y, cbzWPos.y ) ) * ( 0.65 + 0.35 * cbzMac ) * cbzGrime.x;\n" +
            "    diffuseColor.rgb *= 1.0 - cbzG * vec3( 0.86, 1.0, 1.08 );\n" +
            "  }\n";
        }
      }
      fs = fs.replace("#include <color_fragment>", colorHook);

      // 2) roughness from what the surface IS (its albedo), not one constant.
      if (F.model) {
        fs = fs.replace("#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n" +
          "  {\n" +
          "    float cbzMx = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );\n" +
          "    float cbzMn = min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );\n" +
          "    float cbzSat = ( cbzMx - cbzMn ) / max( cbzMx, 0.02 );\n" +
          "    float cbzLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );\n" +
          "    float cbzR = 0.88;\n" +                                                   // masonry, concrete, bitumen
          "    cbzR = mix( cbzR, 0.58, smoothstep( 0.10, 0.45, cbzSat ) );\n" +           // paint, signage, awnings
          "    cbzR = mix( cbzR, 0.74, smoothstep( 0.55, 0.85, cbzLum ) * ( 1.0 - smoothstep( 0.05, 0.25, cbzSat ) ) );\n" + // pale render / cladding
          "    cbzR = mix( cbzR, 0.66, 1.0 - smoothstep( 0.03, 0.12, cbzLum ) );\n" +   // near-black trim / dark glass
          "    if ( cbzUp ) cbzR = max( cbzR, 0.82 );\n" +                              // pavements + roofs stay gritty
          "    roughnessFactor = clamp( cbzR + cbzMac * 0.06, 0.35, 1.0 );\n" +
          "  }");
      }

      // 3) micro-normal: orientation-aware strength, faded by view distance.
      if (F.world && F.detail) {
        fs = fs.replace("#include <normal_fragment_maps>",
          "#include <normal_fragment_maps>\n" +
          "  {\n" +
          "    float cbzFadeD = cbzUp ? cbzBumpFade.y : cbzBumpFade.x;\n" +
          "    float cbzStr = ( cbzUp ? cbzBump.y : cbzBump.x ) * ( 1.0 - smoothstep( cbzFadeD * 0.45, cbzFadeD, cbzDist ) );\n" +
          // ONE fetch, outside every branch, so the implicit derivative used
          // for mip selection is never taken inside divergent control flow.
          "    vec3 cbzN = texture2D( cbzDetail, cbzUV * cbzDetailScale ).xyz * 2.0 - 1.0;\n" +
          "    vec3 cbzOff = cbzUp ? vec3( cbzN.x, 0.0, cbzN.y )\n" +
          "                : ( cbzSideX ? vec3( 0.0, cbzN.y, cbzN.x ) : vec3( cbzN.x, cbzN.y, 0.0 ) );\n" +
          "    vec3 cbzPert = normalize( cbzWNrm + cbzOff * cbzStr );\n" +
          // perturb in WORLD space, rotate the delta into view space so it
          // composes with three's own view-space shading normal
          "    normal = normalize( normal + mat3( viewMatrix ) * ( cbzPert - cbzWNrm ) );\n" +
          "  }");
      }

      // 4) THE ENERGY BUDGET. The hemisphere light is the sky ambient; the
      //    environment map is for reflections. Scale its diffuse share.
      fs = fs.replace("#include <lights_fragment_maps>",
        "#include <lights_fragment_maps>\n" +
        "  #if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )\n" +
        "    iblIrradiance *= cbzEnvDiffuse;\n" +
        "  #endif");

      // 5) contact AO — indirect terms only (that is what occlusion is).
      //    Walls darken toward the pavement line; undersides darken; a
      //    horizontal surface has no "wall above it" to know about, so it
      //    is never height-darkened (the old code dimmed every plaza).
      if (F.ao) {
        fs = fs.replace("#include <aomap_fragment>",
          "#include <aomap_fragment>\n" +
          "  {\n" +
          "    float cbzGround = cbzUp ? 1.0 : mix( 1.0 - cbzAo.x, 1.0, saturate( cbzWPos.y / cbzAo.y ) );\n" +
          "    float cbzFace = mix( 1.0 - cbzAo.x * 0.55, 1.0, saturate( cbzWNrm.y * 0.5 + 0.75 ) );\n" +
          "    float cbzAoK = cbzGround * cbzFace;\n" +
          "    reflectedLight.indirectDiffuse *= cbzAoK;\n" +
          "    reflectedLight.indirectSpecular *= cbzAoK;\n" +
          "  }");
      }

      sh.fragmentShader = fs;
    };
    return mat;
  }

  // Public: dress any MeshStandardMaterial in the material model + env
  // budget (no world projection). world/materials.js calls this for cmat
  // twins; anything else with a Standard material may too.
  CBZ.gfxDressPbr = function (mat) {
    if (!mat || !mat.isMeshStandardMaterial) return mat;
    installShader(mat, false);
    mat._cbzDressed = true;
    mat.needsUpdate = true;
    registerPbr(mat);
    return mat;
  };

  /* =================================================================
     C. MERGED-WORLD PBR PROMOTION  (the draw-call-safe half)
     ================================================================= */

  // srcLambert -> promoted Standard. One entry per batcher output class, so
  // the ENTIRE merged city typically costs 2-6 promoted materials.
  const promoted = new Map();
  const promotedMeshes = [];

  function promoteMat(src) {
    let out = promoted.get(src);
    if (out) return out;
    out = new THREE.MeshStandardMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      vertexColors: !!src.vertexColors,
      side: src.side,
      fog: src.fog,
      transparent: !!src.transparent,
      opacity: src.opacity != null ? src.opacity : 1,
      // Baseline for a rough dielectric; the shader re-derives roughness per
      // fragment from the albedo when GFX_MATERIAL_MODEL is on.
      roughness: 0.88,
      metalness: 0.0,
      envMap: envTex(),
      envMapIntensity: 0,          // driven every frame by the finalizer
    });
    out._shared = true;
    out._cbzPbr = true;
    out._cbzPromoted = true;
    installShader(out, true);
    promoted.set(src, out);
    registerPbr(out);
    return out;
  }

  function worldPbrOn() {
    return !!(CBZ.CONFIG.GFX_WORLD_PBR && tier().pbr);
  }

  // Promote (or demote) every merged mesh under `root`. batch.js names its
  // output "batch-wall" / "batch-inert" — that name IS the contract here.
  function promoteMerged(root, on) {
    if (!root || !root.traverse) return 0;
    let n = 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      if (o.name !== "batch-wall" && o.name !== "batch-inert") return;
      if (on) {
        if (o.material._cbzPromoted) return;
        const known = !!(o.userData && o.userData._cbzMergeSrc);
        const src = known ? o.userData._cbzMergeSrc : o.material;
        o.userData._cbzMergeSrc = src;
        o.material = promoteMat(src);
        if (!known) promotedMeshes.push(o);
        n++;
      } else if (o.material._cbzPromoted && o.userData._cbzMergeSrc) {
        o.material = o.userData._cbzMergeSrc;
        n++;
      }
    });
    return n;
  }

  function refreshPromotion() {
    const on = worldPbrOn();
    for (let i = 0; i < promotedMeshes.length; i++) {
      const o = promotedMeshes[i];
      const src = o.userData && o.userData._cbzMergeSrc;
      if (!src) continue;
      if (on && !o.material._cbzPromoted) o.material = promoteMat(src);
      else if (!on && o.material._cbzPromoted) o.material = src;
    }
    if (on) {
      if (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) promoteMerged(CBZ.city.arena.root, true);
      if (CBZ.prisonRoot) promoteMerged(CBZ.prisonRoot, true);
      promoteMerged(CBZ.scene, true);
    }
  }

  /* ---- the batch protocol wrap ----------------------------------------
     Present the batcher with a pure-Lambert world (so mergeableKeyV2's
     "Standard/Phong keep their look" rejection can never fire on a material
     that used to merge), then promote the merge OUTPUT and restore the
     Standard twins on the meshes that survived un-merged. */
  const _origBatchUnder = CBZ.batchStaticUnder;
  if (typeof _origBatchUnder === "function") {
    CBZ.batchStaticUnder = function (root) {
      swapTree(root, false);
      let r = null;
      try { r = _origBatchUnder.apply(this, arguments); }
      finally {
        promoteMerged(root, worldPbrOn());
        swapTree(root, wantTwins());
      }
      return r;
    };
  }

  function afterLoadBatch() {
    CBZ.gfxPbrArmed = true;            // cmat may hand out Standard twins now
    promoteMerged(CBZ.scene, worldPbrOn());
    if (CBZ.prisonRoot) promoteMerged(CBZ.prisonRoot, worldPbrOn());
    CBZ.gfxSyncMaterials();
    envBackfill();
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
  }

  /* =================================================================
     D. ENVIRONMENT REACH + BUDGET
     ================================================================= */

  const pbrClients = [];

  // WHICH environment: world/carfx.js bakes CBZ.ENV (a PMREM of a gradient)
  // as soon as a renderer exists; city/official_assets.js MAY later publish a
  // real HDR as scene.environment, which is strictly better and wins.
  function envTex() {
    if (CBZ.scene && CBZ.scene.environment) return CBZ.scene.environment;
    return CBZ.ENV || null;
  }
  function envOn() { return !!(CBZ.CONFIG.GFX_ENV_WORLD && tier().env); }

  function registerPbr(mat) {
    if (!mat || pbrClients.indexOf(mat) >= 0) return mat;
    pbrClients.push(mat);
    const e = envTex();
    if (e && "envMap" in mat && !mat.envMap) { mat.envMap = e; mat.needsUpdate = true; }
    return mat;
  }
  CBZ.gfxRegisterPbr = registerPbr;

  let lastEnv = undefined;
  function envBackfill() {
    if (CBZ.scene && CBZ.scene.environment == null && CBZ.ENV) CBZ.scene.environment = CBZ.ENV;
    const want = envTex();
    if (want === lastEnv) return !!want;
    lastEnv = want;
    const lists = [pbrClients, CBZ.pbrTwins || []];
    for (let L = 0; L < lists.length; L++) {
      const arr = lists[L];
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        if (!m || !("envMap" in m)) continue;
        if (m.envMap !== want) { m.envMap = want; m.needsUpdate = true; }
      }
    }
    return !!want;
  }
  CBZ.onAlways(1.3, function () { envBackfill(); });

  // The env is a daytime sky. Its reflections must follow the clock, and the
  // tier/flag gate is enforced HERE (intensity), because r128 would fall back
  // to scene.environment the moment envMap were nulled.
  function envDaylight() {
    const day = clamp01(CBZ.dayness != null ? CBZ.dayness : 1);
    return 0.10 + 0.90 * day;
  }
  function applyEnvIntensity() {
    const on = envOn();
    const k = on ? envDaylight() : 0;
    const iw = k * (+CBZ.CONFIG.GFX_ENV_WORLD_INTENSITY || 0);
    const it = k * (+CBZ.CONFIG.GFX_ENV_TWIN_INTENSITY || 0);
    for (const m of promoted.values()) m.envMapIntensity = iw;
    const tw = CBZ.pbrTwins || [];
    for (let i = 0; i < tw.length; i++) {
      const m = tw[i];
      // pbrMat() callers (glass, chrome) own their own intensity; only the
      // cmat twins (flagged by materials.js) ride the budget.
      if (m && m._cbzTwin) m.envMapIntensity = it;
    }
  }

  /* =================================================================
     E. TIER APPLICATION
     ================================================================= */

  function applyTier() {
    const t = tier();
    if (CBZ.setExposure) CBZ.setExposure(t.exposure != null ? t.exposure : 1);
    detailMaps = null;                   // re-evaluate against the new tier
    for (const m of promoted.values()) { installShader(m, true); m.needsUpdate = true; }
    const tw = CBZ.pbrTwins || [];
    for (let i = 0; i < tw.length; i++) {
      const m = tw[i];
      if (m && m._cbzDressed) { installShader(m, false); m.needsUpdate = true; }
    }
    refreshPromotion();
    CBZ.gfxSyncMaterials();
    lastEnv = undefined;
    envBackfill();
    applyEnvIntensity();
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
  }
  if (CBZ.onQualityChange) CBZ.onQualityChange(applyTier);

  /* =================================================================
     F. THE @94.5 FINALIZER — last word on the light rig
     ================================================================= */

  let expo = 1;
  const _focus = { x: 0, y: 4, z: 0 };

  CBZ.onAlways(94.5, function (dt) {
    const rig = CBZ.lightRig;
    const g = CBZ.game;
    const t = tier();

    // ---- city mode: one canonical writer, re-applied after every mode
    //      override so its night grade cannot be clobbered.
    if (rig && rig.cityFrame && g && g.mode === "city") {
      const P = CBZ.player && CBZ.player.pos;
      rig.cityFrame(P || _focus);
    }

    // ---- tone-map compensation: the keyframes in core/lights.js are
    //      authored for the filmic curve; with it OFF the same numbers blow out.
    const gain = (CBZ.toneMappingOn ? (t.lightGain != null ? t.lightGain : 1) : 0.88);
    if (gain !== 1 && CBZ.sun) {
      CBZ.sun.intensity *= gain;
      if (CBZ.hemi) CBZ.hemi.intensity *= gain;
      if (CBZ.bounce) CBZ.bounce.intensity *= gain;
    }

    // ---- bounce fill: aim from the FINAL sun state, at the player.
    if (rig && rig.aimBounce) {
      const P = CBZ.player && CBZ.player.pos;
      if (P) { _focus.x = P.x; _focus.z = P.z; }
      rig.aimBounce(_focus.x, 6, _focus.z);
    }

    // ---- shadow frustum: the quality tier owns the half-size.
    if (CBZ.CONFIG.GFX_TIGHT_SHADOWS && rig && rig.setShadowFrustum && g && g.mode === "city" && t.shadowHalf) {
      rig.setShadowFrustum(t.shadowHalf, t.shadowHalf * 2.6 + 40);
    }

    // ---- environment reflections follow the sun.
    applyEnvIntensity();

    // ---- eye adaptation. Slow, bounded, and purely presentational.
    if (CBZ.setExposure && CBZ.CONFIG.GFX_AUTO_EXPOSURE) {
      const day = clamp01(CBZ.dayness != null ? CBZ.dayness : 1);
      // Gang City holds exposure near the noon calibration and lets authored
      // lamps/neon reveal the street after dark, rather than a global lift.
      const cityDark = g && g.mode === "city" && CBZ.CONFIG.CITY_STREET_REALISM_V1 !== false;
      const signedSun = Number(CBZ.sunHeight);
      const deepNight = Number.isFinite(signedSun) ? Math.max(0, Math.min(1, -signedSun)) : (1 - day);
      const eye = cityDark ? (0.94 - 0.26 * deepNight) : (1.18 - 0.24 * day);
      const want = (t.exposure != null ? t.exposure : 1) * eye;
      const rate = dt ? Math.min(1, dt * 0.9) : 1;
      expo += (want - expo) * rate;
      CBZ.setExposure(expo);
    } else if (CBZ.setExposure) {
      CBZ.setExposure(t.exposure != null ? t.exposure : 1);
    }
  });

  /* =================================================================
     G. debug surface (numbers only — no HUD, per HUD doctrine)
     ================================================================= */
  CBZ.gfxStats = function () {
    let envI = 0;
    for (const m of promoted.values()) { envI = m.envMapIntensity; break; }
    return {
      toneMapping: !!CBZ.toneMappingOn,
      exposure: CBZ.renderer ? CBZ.renderer.toneMappingExposure : 0,
      tier: CBZ.qualityLevel,
      pbrArmed: !!CBZ.gfxPbrArmed,
      promotedMaterials: promoted.size,
      promotedMeshes: promotedMeshes.length,
      pbrTwins: (CBZ.pbrTwins || []).length,
      envReady: !!CBZ.ENV,
      envIntensity: envI,
      shaderKey: promoted.size ? promoted.values().next().value._cbzGfxKey : "",
      shadowHalf: CBZ.lightRig ? CBZ.lightRig.shadowHalf() : 0,
      shadowTexel: CBZ.shadowFrustumInfo ? CBZ.shadowFrustumInfo().texel : 0,
    };
  };

  /* ---- post-load arming (see section C) --------------------------------
     core/batch.js registers its own window-load handler at parse time and we
     parse after it, so registering here puts us second in the queue: the
     merge has finished by the time afterLoadBatch runs. */
  if (typeof document !== "undefined" && document.readyState === "complete") afterLoadBatch();
  else addEventListener("load", afterLoadBatch, { once: true });
})();
