/* ============================================================
   src/compat/three-legacy.js — O3 legacy-visual compat shim
   (BUILD-PLAN.md Stage O, final step: "three.js upgrade with
   legacy-visual flags").

   CLASSIC SCRIPT. Loaded by index.html immediately after the vendored
   three-r164 bundle (src/vendor/three-r164/three.iife.min.js) and BEFORE
   every legacy game file. Its whole job is to make r164's `window.THREE`
   look and behave, to every file after this one, exactly like the r128
   the game was built against — WITHOUT editing any of those files (the
   O-wave rule: legacy src/ files stay untouched).

   Every patch below is tied to a concrete grep hit against src/ (searched
   for all `THREE.<Identifier>` usage — 81 distinct identifiers found —
   and every `new THREE.WebGLRenderer(...)`/light-construction call site).
   Nothing here is speculative; see src/vendor/three-r164/VENDORED.txt for
   the version-selection reasoning (why r164 and not newer).

   ============================================================
   1. LIGHTING PARITY — renderer.useLegacyLights

   r155 introduced physically-based light-intensity math as the (soon to
   be only) mode; r155-r164 kept a `renderer.useLegacyLights` escape hatch
   that restores the exact pre-r155 formula for EVERY light type (verified
   by reading r164's bundled source: the lighting setup pass applies
   `scaleFactor = useLegacyLights ? Math.PI : 1` uniformly — not just to
   punctual lights). r165 removed the flag outright; matching the old look
   past that point means multiplying every light's `intensity` by ~Math.PI
   at its construction site, which means editing the 5 files that build
   lights (src/core/lights.js, src/core/daynight.js, src/city/charpanel.js,
   src/city/biome_snow.js, src/entities/searchlight.js) — forbidden this
   wave. r164 is the newest version where the ONE flag below buys full
   parity for all of them with zero call-site edits. Set on the private
   backing field (`_useLegacyLights`) rather than through the public
   `.useLegacyLights` accessor: the public setter is functionally
   identical but is `@deprecated` and console.warns on every renderer
   construction, which core/renderer.js does exactly once per boot —
   avoiding that keeps the console clean without changing behavior.

   2. COLOR OUTPUT PARITY — ColorManagement.enabled + outputColorSpace

   r128 never converted INPUT colors between color spaces — hex/CSS colors
   fed straight to materials and lights with no linearization. Since r152,
   three.js does this by default (`THREE.ColorManagement.enabled = true`),
   which would subtly shift every material/light color and every canvas-
   drawn texture in this game (grep: ~50 `new THREE.CanvasTexture(...)`/
   `new THREE.Texture(...)` call sites across src/city, src/world,
   src/systems, src/entities — NONE of them set `.colorSpace`, so they're
   all relying on "whatever comes out is what I drew"). Disabling
   `ColorManagement.enabled` globally reproduces that for all of them
   without touching any call site.

   That's only half the story, and the naive "legacy = no color
   management" assumption is WRONG for the OUTPUT half — verified by
   building a controlled isolated test (a single unlit MeshBasicMaterial
   swatch, color 0x8d8576 = rgb(141,133,118), no lights involved at all)
   against r128 vs r164: r128 rendered that swatch as rgb(196,191,181) —
   visibly BRIGHTER than the raw input. Why: src/core/renderer.js:22 has
   always explicitly set `renderer.outputEncoding = THREE.sRGBEncoding` —
   r128's way of asking for a gamma-encoding pass on the FINAL framebuffer
   output, applied regardless of whether a pixel came from a lit or unlit
   material. That gamma brightening IS part of the tuned legacy look, not
   an accident to strip out. r162 removed both `.outputEncoding` (the
   accessor) and the `THREE.sRGBEncoding` constant outright — the
   assignment in renderer.js becomes an inert own-property set (no crash,
   confirmed empirically), so on r164 it silently does nothing on its own.
   The fix is `renderer.outputColorSpace = THREE.SRGBColorSpace` (NOT
   LinearSRGBColorSpace) at construction time, paired with
   ColorManagement.enabled = false so input colors still aren't pre-
   linearized. With that exact combination the isolated test above is
   BYTE-IDENTICAL between r128 and r164+shim (all 4 sampled pixels —
   floor plane, lit box, unlit swatch, background — matched exactly); see
   the O3 report for the full before/after numbers. The one other place in
   src/ that reads `THREE.sRGBEncoding` (src/city/interiorlight.js:155)
   already guards with `if (THREE.sRGBEncoding != null)`, so `undefined`
   there is a no-op, not a crash.

   3. WHAT NEEDED NO SHIM AT ALL (confirmed via the same grep pass)

   BoxGeometry/CylinderGeometry/PlaneGeometry/... (all BufferGeometry-
   based, never the removed `THREE.Geometry`), MeshLambertMaterial/
   MeshBasicMaterial/MeshStandardMaterial, `vertexColors: true` (boolean
   since long before r128 — never the old THREE.VertexColors enum),
   THREE.PCFSoftShadowMap, PMREMGenerator + EquirectangularReflectionMapping
   (src/world/carfx.js, already feature-detected with `if (!THREE.X)`
   guards), THREE.BufferGeometryUtils (the game vendors its own copy —
   src/vendor/BufferGeometryUtils.js — decoupled from the three version;
   see that file's own tail comment for the one, version-unrelated fix
   made there this wave). None of these changed shape between r128 and
   r164, so there is nothing to alias here.

   GLTFLoader/DRACOLoader (src/city/playercars.js:991-997, the Ferrari
   model) are bundled INTO three-r164/three.iife.min.js itself (see its
   VENDORED.txt) rather than shimmed here — they need to exist as real
   classes, not aliases, and the build entry point is the natural place
   for that.
============================================================ */
(function () {
  "use strict";
  var THREE = window.THREE;
  if (!THREE) {
    console.warn("[three-legacy] window.THREE not found — compat shim skipped (three-r164 script tag missing or failed to load?).");
    return;
  }

  // ---- 2. no color management, r128-style ----
  if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;

  // ---- 1 + 2 at construction time: wrap WebGLRenderer ----
  // A real `extends` subclass (not a monkey-patched prototype method) so
  // `new THREE.WebGLRenderer(opts)` keeps its exact call signature and
  // every instance is still `instanceof` the real renderer class. (three's
  // WebGLRenderer is a native ES class in the r164 bundle — it can only
  // be invoked via `new`/`super()`, not `.call()`/`.apply()`, hence the
  // `class ... extends` form rather than a plain wrapper function.)
  var RealWebGLRenderer = THREE.WebGLRenderer;
  if (typeof RealWebGLRenderer === "function") {
    class LegacyWebGLRenderer extends RealWebGLRenderer {
      constructor() {
        super(...arguments);
        // r155-r164 only: restores pre-r155 light-intensity math for
        // every light type. Set on the backing field to skip the
        // deprecated accessor's console.warn (see header, section 1).
        this._useLegacyLights = true;
        // r128's ACTUAL default (see header, section 2 — verified
        // empirically, not LinearSRGBColorSpace as the naive "no color
        // management" guess would suggest).
        if (THREE.SRGBColorSpace) this.outputColorSpace = THREE.SRGBColorSpace;
      }
    }
    THREE.WebGLRenderer = LegacyWebGLRenderer;
  } else {
    console.warn("[three-legacy] THREE.WebGLRenderer missing — cannot apply legacy lighting/colorspace defaults.");
  }
})();
