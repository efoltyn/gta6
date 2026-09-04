/* ============================================================
   core/envsky.js — THE ENVIRONMENT MAP IS THE SKY YOU CAN SEE.

   WHAT WAS WRONG. Every reflective surface in the game (car paint, glass,
   wet asphalt, and on High/Best the whole promoted city) reflected one of
   two STATIC pictures: world/carfx.js's 4-stop grey-blue gradient, or —
   when assets/official/sky/blouberg_sunrise_2_1k.hdr loaded — a real
   photograph of a SUNRISE, applied at noon and at midnight alike. That
   is why dark windows read warm grey-brown in the middle of the day on
   Best (the horizon band of a sunrise), and why a car at 2 a.m. carried
   dawn on its roof. core/sky.js paints the actual sky into an equirect
   canvas every time the palette moves; nothing ever handed that canvas to
   the materials.

   WHAT THIS DOES. Whenever the sky dome repaints (and no more than every
   few seconds), prefilter that canvas with r128's PMREMGenerator and copy
   the result into ONE persistent render target. Its texture IS CBZ.ENV
   and scene.environment for the rest of the session, so:
     * dusk turns every reflection orange on the sun's side and cools the
       far side, night reflections go dark, a storm deck darkens them —
       all for free, because the sky already knows;
     * NO material is ever re-bound: identity never changes, so there is
       no envMap swap, no program lookup, no needsUpdate on 7k materials.
       Only the FIRST publish (static → live) swaps references, once.

   MECHANICS
     * The dome is a BackSide sphere whose u runs the opposite way to
       three's equirectUv(), so the source is blitted MIRRORED.
     * Below the horizon the dome is pure fog colour (that is the sky/fog
       seam law in core/sky.js); as a reflection of "the ground" that is
       far too bright, so the lower half is darkened toward ground.
     * r128 PMREMGenerator allocates fresh render targets per bake; we
       copy out and dispose them the same frame. renderer.shadowMap is
       disabled around the bake so the internal renders cannot consume the
       main scene's pending shadow refresh.
     * Tier-gated to tiers whose GFX row has env:true (core/quality.js);
       below that the static gradient stays and nothing here runs.

   ?cfg_GFX_SKY_ENV=0 reverts to the static environment(s) exactly.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GFX_SKY_ENV == null) CBZ.CONFIG.GFX_SKY_ENV = true;
  // Minimum seconds between bakes. The sky repaints at most 10 Hz and only
  // when its palette moves; a 150 s day cycle at this cadence is ~40 bakes,
  // each a few ms, and a steady noon costs nothing at all.
  if (CBZ.CONFIG.GFX_SKY_ENV_INTERVAL == null) CBZ.CONFIG.GFX_SKY_ENV_INTERVAL = 2.5;

  const SW = 512, SH = 256;
  const state = {
    supported: false, active: false, bakes: 0, lastBakeAt: -1e9, lastSkyVersion: -1,
    lastMs: 0, error: "",
  };
  CBZ.skyEnvStats = function () {
    return {
      flag: !!CBZ.CONFIG.GFX_SKY_ENV, supported: state.supported, active: state.active,
      bakes: state.bakes, lastBakeMs: +state.lastMs.toFixed(2), error: state.error,
      envIsSky: !!(out && CBZ.ENV === out.texture && CBZ.scene && CBZ.scene.environment === out.texture),
    };
  };

  let src = null, srcCtx = null, srcTex = null, pmrem = null, out = null;
  let copyScene = null, copyCam = null, copyMat = null;

  function skyTexture() {
    const d = CBZ.skyDome;
    const t = d && d.material && d.material.map;
    return (t && t.image && t.image.width) ? t : null;
  }

  function ensure() {
    if (srcTex) return true;
    if (!CBZ.renderer || !THREE.PMREMGenerator || !skyTexture()) return false;
    src = document.createElement("canvas");
    src.width = SW; src.height = SH;
    srcCtx = src.getContext("2d");
    srcTex = new THREE.CanvasTexture(src);
    // Linear on purpose: the dome samples the same bytes untagged, and the
    // reflection of the sky must be the colour of the sky.
    srcTex.generateMipmaps = false;
    srcTex.minFilter = THREE.LinearFilter;
    srcTex.magFilter = THREE.LinearFilter;
    pmrem = new THREE.PMREMGenerator(CBZ.renderer);
    if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
    copyScene = new THREE.Scene();
    copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    copyMat = new THREE.MeshBasicMaterial({ map: null, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    quad.frustumCulled = false;
    copyScene.add(quad);
    state.supported = true;
    return true;
  }

  function blitSky(skyTex) {
    const img = skyTex.image;
    srcCtx.save();
    srcCtx.setTransform(-1, 0, 0, 1, SW, 0);          // mirror u (see MECHANICS)
    srcCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, SW, SH);
    srcCtx.restore();
    // the ground half: fog colour → toward dark ground, strongest straight down
    const g = srcCtx.createLinearGradient(0, SH * 0.5, 0, SH);
    g.addColorStop(0, "rgba(22,24,30,0)");
    g.addColorStop(0.35, "rgba(22,24,30,0.42)");
    g.addColorStop(1, "rgba(22,24,30,0.62)");
    srcCtx.fillStyle = g;
    srcCtx.fillRect(0, SH * 0.5, SW, SH * 0.5);
    srcTex.needsUpdate = true;
  }

  // Swap every reference to the previous (static) environment for the live
  // one. Runs ONCE, on the first publish; afterwards identity is stable.
  function adoptEverywhere(prevA, prevB) {
    const tex = out.texture;
    function fix(m) {
      if (!m || !("envMap" in m)) return;
      if (m.envMap === prevA || m.envMap === prevB) m.envMap = tex;
    }
    function walk(root) {
      if (!root || !root.traverse) return;
      root.traverse(function (o) {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) fix(m[i]); } else fix(m);
      });
    }
    walk(CBZ.scene);
    if (CBZ.prisonRoot && CBZ.prisonRoot.parent !== CBZ.scene) walk(CBZ.prisonRoot);
    const lists = [CBZ.pbrTwins];
    for (let L = 0; L < lists.length; L++) {
      const arr = lists[L];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) fix(arr[i]);
    }
  }

  function bake() {
    const skyTex = skyTexture();
    if (!skyTex) return false;
    const renderer = CBZ.renderer;
    const t0 = performance.now();
    const prevRT = renderer.getRenderTarget();
    const shadowsOn = renderer.shadowMap.enabled;
    const autoClear = renderer.autoClear;
    let rt = null;
    try {
      blitSky(skyTex);
      renderer.shadowMap.enabled = false;
      rt = pmrem.fromEquirectangular(srcTex);
      if (!out) {
        out = new THREE.WebGLRenderTarget(rt.width, rt.height, {
          magFilter: rt.texture.magFilter, minFilter: rt.texture.minFilter,
          generateMipmaps: false, type: rt.texture.type, format: rt.texture.format,
          encoding: rt.texture.encoding, depthBuffer: false, stencilBuffer: false,
        });
        out.texture.mapping = rt.texture.mapping;
        out.texture.name = "SkyEnv.cubeUv";
      }
      copyMat.map = rt.texture;
      renderer.autoClear = true;
      renderer.setRenderTarget(out);
      renderer.render(copyScene, copyCam);
      copyMat.map = null;
    } catch (e) {
      state.error = String(e && e.message || e).slice(0, 160);
      return false;
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.shadowMap.enabled = shadowsOn;
      renderer.autoClear = autoClear;
      if (rt) rt.dispose();
    }
    if (!state.active) {
      const prevEnv = CBZ.ENV, prevScene = CBZ.scene ? CBZ.scene.environment : null;
      CBZ.ENV = out.texture;
      if (CBZ.scene) CBZ.scene.environment = out.texture;
      adoptEverywhere(prevEnv, prevScene);
      state.active = true;
      CBZ.skyEnvActive = true;
    }
    state.bakes++;
    state.lastMs = performance.now() - t0;
    return true;
  }

  // Tiers whose GFX row has env:false (Fastest/Fast) still own vehicles and
  // wet roads that reflect CBZ.ENV, so they are never frozen on a stale sky —
  // they just re-bake five times less often.
  function interval() {
    const t = CBZ.gfxTier;
    const base = +CBZ.CONFIG.GFX_SKY_ENV_INTERVAL || 2.5;
    return (t && t.env === false) ? base * 5 : base;
  }

  // After core/sky.js's skyFrame (@99) has painted; a one-frame lag before
  // the next render is invisible. Never during a held loop — tools that
  // call CBZ.skySync() by hand get the bake on their next live tick.
  CBZ.onAlways(99.4, function () {
    if (!CBZ.CONFIG.GFX_SKY_ENV) return;
    if (!ensure()) return;
    const skyTex = skyTexture();
    if (!skyTex || skyTex.version === state.lastSkyVersion) return;
    const now = performance.now();
    if (state.active && now - state.lastBakeAt < interval() * 1000) return;
    if (bake()) { state.lastSkyVersion = skyTex.version; state.lastBakeAt = now; }
  });

  // Tools: force a bake against the sky as it stands right now.
  CBZ.skyEnvBake = function () {
    if (!CBZ.CONFIG.GFX_SKY_ENV || !ensure()) return false;
    const skyTex = skyTexture();
    const ok = bake();
    if (ok && skyTex) { state.lastSkyVersion = skyTex.version; state.lastBakeAt = performance.now(); }
    return ok;
  };
})();
