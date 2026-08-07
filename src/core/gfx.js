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
      the shadow frustum to the quality tier. So the old writers are
      CORRECTED rather than fought, and city/mode.js needs no edit to
      benefit (though a one-liner makes it tidy — see lights.js).

   2. TONE-MAP-AWARE EXPOSURE. A filmic curve without a matching
      exposure is just a dimmer. Exposure now rides the day clock as a
      gentle eye adaptation: opened up at night so the city reads as
      lit-by-neon rather than black, stopped down at noon so highlights
      have somewhere to roll off into.

   3. WORLD PBR PROMOTION — and the draw-call trap it has to dodge.
      core/batch.js merges the entire static city shell into a handful
      of meshes that share a handful of white vertex-colour
      MeshLambertMaterials. Lambert cannot do roughness, cannot do
      metalness, cannot take a normal map and, in r128, cannot see an
      environment map at all — which is why the world reads as
      construction paper. We promote the BATCHER'S OWN OUTPUT materials
      to MeshStandardMaterial *after* the merge has happened. That is
      the whole trick: the merge set, the vertex buffers and the draw
      call count are bit-for-bit unchanged, and the number of materials
      we touch is single digits, but every merged surface in the world
      gains energy-conserving shading plus real environment light.

   4. IN-MATERIAL DETAIL + CONTACT AO. The promoted materials carry an
      onBeforeCompile that adds (a) a world-space projected micro normal
      map — merged geometry's UVs are per-box and useless for tiling, so
      the detail is projected from WORLD position onto the dominant axis,
      which is exact for an axis-aligned box city and costs one texture
      fetch — and (b) an ambient-occlusion approximation that darkens
      only the INDIRECT terms near the ground and on down-facing
      surfaces. That contact darkening at the base of every wall is the
      single strongest "this object is really standing there" cue
      available without a real AO pass.

   5. ENVIRONMENT REACH. CBZ.ENV (world/carfx.js's PMREM) was scoped to
      vehicles. Everything Standard in the world now gets it, and any
      other module can opt a material in with CBZ.gfxRegisterPbr(mat).

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
  // MeshStandardMaterial (+ env light). Flip false (or ?cfg_GFX_WORLD_PBR=0)
  // and the merged world stays exactly the Lambert it is today.
  if (CBZ.CONFIG.GFX_WORLD_PBR == null) CBZ.CONFIG.GFX_WORLD_PBR = true;
  // GFX_WORLD_DETAIL — world-space projected micro normal map on promoted
  // materials. Costs one texture fetch per fragment on merged geometry.
  if (CBZ.CONFIG.GFX_WORLD_DETAIL == null) CBZ.CONFIG.GFX_WORLD_DETAIL = true;
  // GFX_CONTACT_AO — indirect-only ambient occlusion approximation (ground
  // contact + down-facing crevice darkening) on promoted materials.
  if (CBZ.CONFIG.GFX_CONTACT_AO == null) CBZ.CONFIG.GFX_CONTACT_AO = true;
  // GFX_ENV_WORLD — extend CBZ.ENV past vehicles to every Standard material.
  if (CBZ.CONFIG.GFX_ENV_WORLD == null) CBZ.CONFIG.GFX_ENV_WORLD = true;
  // GFX_AUTO_EXPOSURE — day/night eye adaptation on toneMappingExposure.
  if (CBZ.CONFIG.GFX_AUTO_EXPOSURE == null) CBZ.CONFIG.GFX_AUTO_EXPOSURE = true;
  // GFX_TIGHT_SHADOWS — let the quality tier own the city shadow frustum
  // half-size (see the GFX table in core/quality.js). Off = whatever the
  // mode override set (city/mode.js's hard-coded 190).
  if (CBZ.CONFIG.GFX_TIGHT_SHADOWS == null) CBZ.CONFIG.GFX_TIGHT_SHADOWS = true;
  // Detail-normal projection scale, in tiles per world metre, and strength.
  if (CBZ.CONFIG.GFX_DETAIL_SCALE == null) CBZ.CONFIG.GFX_DETAIL_SCALE = 0.42;
  if (CBZ.CONFIG.GFX_DETAIL_STRENGTH == null) CBZ.CONFIG.GFX_DETAIL_STRENGTH = 0.55;

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

  // Public: re-sync the whole scene's shared materials to the live tier.
  CBZ.gfxSyncMaterials = function (force) {
    const want = force != null ? !!force : wantTwins();
    swapTree(CBZ.scene, want);
    if (CBZ.prisonRoot) swapTree(CBZ.prisonRoot, want);
    return want;
  };

  /* =================================================================
     B. MERGED-WORLD PBR PROMOTION  (the draw-call-safe half)
     ================================================================= */

  // srcLambert -> promoted Standard. One entry per batcher output class, so
  // the ENTIRE merged city typically costs 2-4 promoted materials.
  const promoted = new Map();
  // Every merged mesh we touched, so a tier drop can put it straight back.
  const promotedMeshes = [];

  let detailTex = null;
  function getDetailTex() {
    if (detailTex !== null) return detailTex;
    if (!CBZ.CONFIG.GFX_WORLD_DETAIL || !tier().normals || !CBZ.surfaceMaps) { detailTex = false; return false; }
    // repeat:1 — we sample this texture with our OWN world-projected UVs, so
    // three's uv-transform (texture.repeat/offset) never applies to it.
    const maps = CBZ.surfaceMaps("concrete", { repeat: 1 });
    detailTex = (maps && maps.normalMap) || false;
    return detailTex;
  }

  function installShader(mat) {
    const tex = getDetailTex();
    const wantDetail = !!tex;
    const wantAO = !!(CBZ.CONFIG.GFX_CONTACT_AO);
    if (!wantDetail && !wantAO) return mat;

    mat.onBeforeCompile = function (sh) {
      sh.uniforms.cbzDetail = { value: tex || null };
      sh.uniforms.cbzDetailScale = { value: +CBZ.CONFIG.GFX_DETAIL_SCALE || 0.42 };
      sh.uniforms.cbzDetailStrength = { value: +CBZ.CONFIG.GFX_DETAIL_STRENGTH || 0.55 };
      sh.uniforms.cbzAoHeight = { value: 2.6 };
      sh.uniforms.cbzAoStrength = { value: 0.34 };

      // ---- vertex: publish world position + world normal ------------------
      // Merged meshes are plain, un-instanced, un-skinned children of the city
      // root, so modelMatrix is the whole story here (unlike the global fog
      // patch in core/renderer.js, which must survive instancing and therefore
      // reconstructs world space from mvPosition instead).
      // EVERY anchor is verified before anything downstream is emitted: a
      // fragment shader that READS a varying its vertex partner never WROTE
      // is the one failure mode here that is not visibly obvious, so if any
      // chunk name ever moves we bail out and ship the plain promoted material
      // instead of a subtly wrong one.
      const vSrc = sh.vertexShader, fSrc = sh.fragmentShader;
      if (vSrc.indexOf("#include <common>") < 0 ||
          vSrc.indexOf("#include <project_vertex>") < 0 ||
          fSrc.indexOf("#include <common>") < 0) return;

      sh.vertexShader = vSrc
        .replace("#include <common>",
          "#include <common>\nvarying vec3 cbzWPos;\nvarying vec3 cbzWNrm;")
        .replace("#include <project_vertex>",
          "#include <project_vertex>\n" +
          "  cbzWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
          // `normal` (the raw attribute) rather than `objectNormal`: both are
          // in scope here, but the attribute is declared by three's own vertex
          // prefix on every non-raw shader, so this survives any future
          // re-ordering of the normal chunks.
          "  cbzWNrm = normalize( mat3( modelMatrix ) * normal );");

      sh.fragmentShader = fSrc.replace("#include <common>",
        "#include <common>\n" +
        "varying vec3 cbzWPos;\nvarying vec3 cbzWNrm;\n" +
        "uniform sampler2D cbzDetail;\nuniform float cbzDetailScale;\n" +
        "uniform float cbzDetailStrength;\nuniform float cbzAoHeight;\nuniform float cbzAoStrength;");

      if (wantDetail && sh.fragmentShader.indexOf("#include <normal_fragment_maps>") >= 0) {
        // DOMINANT-AXIS world projection. A full triplanar blend would cost
        // three fetches; this city is built out of axis-aligned boxes, so the
        // dominant axis is not an approximation for ~99% of its surface area
        // and one fetch buys the same result.
        sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_maps>",
          "#include <normal_fragment_maps>\n" +
          "  {\n" +
          "    vec3 cbzA = abs( cbzWNrm );\n" +
          "    bool cbzUp = ( cbzA.y >= cbzA.x && cbzA.y >= cbzA.z );\n" +
          "    bool cbzSideX = ( !cbzUp && cbzA.x >= cbzA.z );\n" +
          // ONE fetch, and it sits outside every branch so the implicit
          // derivative used for mip selection is never taken inside divergent
          // control flow. Only the UV choice is a ternary.
          "    vec2 cbzUV = cbzUp ? cbzWPos.xz : ( cbzSideX ? cbzWPos.zy : cbzWPos.xy );\n" +
          "    vec3 cbzN = texture2D( cbzDetail, cbzUV * cbzDetailScale ).xyz * 2.0 - 1.0;\n" +
          // map the tangent-space wobble back onto the two world axes the
          // chosen projection used (the third axis is the face normal itself)
          "    vec3 cbzOff = cbzUp ? vec3( cbzN.x, 0.0, cbzN.y )\n" +
          "                : ( cbzSideX ? vec3( 0.0, cbzN.y, cbzN.x ) : vec3( cbzN.x, cbzN.y, 0.0 ) );\n" +
          "    vec3 cbzPert = normalize( cbzWNrm + cbzOff * cbzDetailStrength );\n" +
          // perturb in WORLD space, then rotate the delta into view space so
          // it composes correctly with three's own view-space shading normal
          "    normal = normalize( normal + mat3( viewMatrix ) * ( cbzPert - cbzWNrm ) );\n" +
          "  }");
      }

      if (wantAO && sh.fragmentShader.indexOf("#include <aomap_fragment>") >= 0) {
        // Occlude ONLY the indirect terms — that is what ambient occlusion
        // physically is. Darkening diffuse outright would have dimmed sunlit
        // pavement too and produced exactly the muddy world we are avoiding.
        sh.fragmentShader = sh.fragmentShader.replace("#include <aomap_fragment>",
          "#include <aomap_fragment>\n" +
          "  {\n" +
          "    float cbzGround = mix( 1.0 - cbzAoStrength, 1.0, saturate( cbzWPos.y / cbzAoHeight ) );\n" +
          "    float cbzFace = mix( 1.0 - cbzAoStrength * 0.55, 1.0, saturate( cbzWNrm.y * 0.5 + 0.75 ) );\n" +
          "    float cbzAo = cbzGround * cbzFace;\n" +
          "    reflectedLight.indirectDiffuse *= cbzAo;\n" +
          "    reflectedLight.indirectSpecular *= cbzAo;\n" +
          "  }");
      }
    };
    return mat;
  }

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
      // DEPTH STATE IS PART OF THE MATERIAL, AND A PROMOTION THAT DROPS IT
      // IS THE SAME BUG core/batch.js's V2 merge already shipped once: a
      // polygonOffset decal re-materialled without its offset stops being a
      // decal and starts z-fighting the surface it was painted on
      // (city/world.js's `userData.roadPaint` guard exists for exactly that).
      // These four fields are carried, not re-derived.
      polygonOffset: !!src.polygonOffset,
      polygonOffsetFactor: src.polygonOffsetFactor != null ? src.polygonOffsetFactor : 0,
      polygonOffsetUnits: src.polygonOffsetUnits != null ? src.polygonOffsetUnits : 0,
      depthWrite: src.depthWrite !== false,
      // A city is overwhelmingly rough dielectric. The point of the promotion
      // is the environment term and the specular falloff, not gloss.
      roughness: 0.88,
      metalness: 0.03,
      envMap: envOn() ? envTex() : null,
      envMapIntensity: 0.50,
    });
    out._shared = true;
    out._cbzPbr = true;
    out._cbzPromoted = true;
    installShader(out);
    promoted.set(src, out);
    registerPbr(out);
    return out;
  }

  function worldPbrOn() {
    return !!(CBZ.CONFIG.GFX_WORLD_PBR && tier().pbr);
  }

  // Promote (or demote) every merged mesh under `root`. batch.js names its
  // output "batch-wall" / "batch-inert" — that name IS the contract here, and
  // it is checked rather than assumed so a non-merged mesh can never be caught.
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
        if (!known) promotedMeshes.push(o);   // never double-register on re-promote
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
    // meshes we already know about
    for (let i = 0; i < promotedMeshes.length; i++) {
      const o = promotedMeshes[i];
      const src = o.userData && o.userData._cbzMergeSrc;
      if (!src) continue;
      if (on && !o.material._cbzPromoted) o.material = promoteMat(src);
      else if (!on && o.material._cbzPromoted) o.material = src;
    }
    // and any root that has been batched since
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
     Standard twins on the meshes that survived un-merged. Net effect on the
     merge set and on the draw-call count: exactly zero. */
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

  // batch.js's own window-load pass holds a direct reference to its internal
  // runOnce, so it cannot be wrapped — we simply register AFTER it (listeners
  // fire in registration order) and do the promotion/arming pass there.
  function afterLoadBatch() {
    CBZ.gfxPbrArmed = true;            // cmat may hand out Standard twins now
    promoteMerged(CBZ.scene, worldPbrOn());
    if (CBZ.prisonRoot) promoteMerged(CBZ.prisonRoot, worldPbrOn());
    CBZ.gfxSyncMaterials();
    envBackfill();
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
  }
  // (registered at the very bottom of this file — afterLoadBatch reaches state
  //  declared further down, and the "already complete" branch would otherwise
  //  run it before those declarations were initialised.)

  /* =================================================================
     C. ENVIRONMENT REACH
     ================================================================= */

  const pbrClients = [];

  // WHICH environment. There are two producers and they must not fight:
  //   * world/carfx.js bakes CBZ.ENV (a PMREM of a 4-stop canvas gradient) as
  //     soon as a renderer exists — always available, deterministic, no assets.
  //   * city/official_assets.js MAY later load a real HDR and publish it as
  //     scene.environment. That is strictly better lighting, so if it turns
  //     up we adopt it and never overwrite it.
  function envTex() {
    if (CBZ.scene && CBZ.scene.environment) return CBZ.scene.environment;
    return CBZ.ENV || null;
  }
  function envOn() { return !!(CBZ.CONFIG.GFX_ENV_WORLD && tier().env); }

  function registerPbr(mat) {
    if (!mat || pbrClients.indexOf(mat) >= 0) return mat;
    pbrClients.push(mat);
    const e = envOn() ? envTex() : null;
    if (e && "envMap" in mat && !mat.envMap) { mat.envMap = e; mat.needsUpdate = true; }
    return mat;
  }
  // Public: any module with a MeshStandardMaterial can opt into the shared
  // environment + tier management with one call.
  CBZ.gfxRegisterPbr = registerPbr;

  let lastEnv = undefined;
  function envBackfill() {
    const on = envOn();
    // Only ever claim scene.environment when nobody else has: carfx already
    // writes it when it is null, and the HDR loader's write is authoritative.
    if (on && CBZ.scene && CBZ.scene.environment == null && CBZ.ENV) CBZ.scene.environment = CBZ.ENV;
    // Tier gating cannot be done by clearing scene.environment (that would
    // stomp the HDR loader), so the tier gate lives entirely in the per-
    // material envMap + envMapIntensity we control.
    const want = on ? envTex() : null;
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
  // CBZ.ENV is built lazily by world/carfx.js once a renderer exists, and the
  // optional HDR arrives later still — so this stays registered and simply
  // early-outs on an identity compare once the texture stops changing.
  CBZ.onAlways(1.3, function () { envBackfill(); });

  /* =================================================================
     D. TIER APPLICATION
     ================================================================= */

  function applyTier() {
    const t = tier();
    if (CBZ.setExposure) CBZ.setExposure(t.exposure != null ? t.exposure : 1);
    detailTex = null;                    // re-evaluate against the new tier
    for (const m of promoted.values()) { installShader(m); m.needsUpdate = true; }
    refreshPromotion();
    CBZ.gfxSyncMaterials();
    lastEnv = undefined;                 // force the env gate to re-evaluate
    envBackfill();
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
  }
  if (CBZ.onQualityChange) CBZ.onQualityChange(applyTier);

  /* =================================================================
     E. THE @94.5 FINALIZER — last word on the light rig
     ================================================================= */

  let expo = 1;
  const _focus = { x: 0, y: 4, z: 0 };

  CBZ.onAlways(94.5, function (dt) {
    const rig = CBZ.lightRig;
    const g = CBZ.game;
    const t = tier();

    // ---- city mode: re-apply the shared rig ON TOP of city/mode.js's @94
    //      override. mode.js still owns the sun's POSITION (it aims the light
    //      at the player across a two-island map) and the fog range; the rig
    //      owns intensity, colour, the hemisphere tint and the bounce fill,
    //      which mode.js's hard-coded 0.16/1.05/0.38/0.95 literals would
    //      otherwise pin to the pre-tone-map values. Restricted to city mode
    //      so weather.js's lightning bump (@90) still survives everywhere
    //      else — in city mode mode.js already clobbered it before we ran.
    if (rig && rig.daylight && g && g.mode === "city") {
      rig.daylight(CBZ.dayness != null ? CBZ.dayness : 1, CBZ.duskness || 0,
        CBZ.sunTint || (CBZ.sunTint = new THREE.Color()));
    }

    // ---- tone-map compensation. The keyframes in core/lights.js are authored
    //      for the filmic curve; if the tone map is switched OFF the same
    //      numbers blow out, so scale back down.
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

    // ---- shadow frustum: the quality tier owns the half-size now. Applied
    //      every frame but idempotent (setShadowFrustum early-outs when
    //      nothing changed), which is also what re-tightens the box after
    //      city/mode.js's one-shot widen to 190 on its first city frame.
    if (CBZ.CONFIG.GFX_TIGHT_SHADOWS && rig && rig.setShadowFrustum && g && g.mode === "city" && t.shadowHalf) {
      rig.setShadowFrustum(t.shadowHalf, t.shadowHalf * 2.6 + 40);
    }

    // ---- eye adaptation. Slow, bounded, and purely presentational.
    if (CBZ.setExposure && CBZ.CONFIG.GFX_AUTO_EXPOSURE) {
      const day = clamp01(CBZ.dayness != null ? CBZ.dayness : 1);
      // open up ~18% after dark, stop down ~6% at high noon
      const want = (t.exposure != null ? t.exposure : 1) * (1.18 - 0.24 * day);
      const rate = dt ? Math.min(1, dt * 0.9) : 1;
      expo += (want - expo) * rate;
      CBZ.setExposure(expo);
    } else if (CBZ.setExposure) {
      CBZ.setExposure(t.exposure != null ? t.exposure : 1);
    }
  });

  /* =================================================================
     F. debug surface (numbers only — no HUD, per HUD doctrine)
     ================================================================= */
  CBZ.gfxStats = function () {
    return {
      toneMapping: !!CBZ.toneMappingOn,
      exposure: CBZ.renderer ? CBZ.renderer.toneMappingExposure : 0,
      tier: CBZ.qualityLevel,
      pbrArmed: !!CBZ.gfxPbrArmed,
      promotedMaterials: promoted.size,
      promotedMeshes: promotedMeshes.length,
      pbrTwins: (CBZ.pbrTwins || []).length,
      envReady: !!CBZ.ENV,
      shadowHalf: CBZ.lightRig ? CBZ.lightRig.shadowHalf() : 0,
      shadowTexel: CBZ.shadowFrustumInfo ? CBZ.shadowFrustumInfo().texel : 0,
    };
  };

  /* ---- post-load arming (see section B) --------------------------------
     core/batch.js registers its own window-load handler at parse time and we
     parse after it, so registering here puts us second in the queue: the
     merge has finished by the time afterLoadBatch runs. */
  if (typeof document !== "undefined" && document.readyState === "complete") afterLoadBatch();
  else addEventListener("load", afterLoadBatch, { once: true });
})();
