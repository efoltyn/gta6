---
name: threejs
description: >
  Three.js reference for THIS repo, which runs r187 as one classic script
  (window.THREE, built by tools/three/build.mjs into src/vendor/three.r187.js)
  with colour management off and the r128 light model kept on purpose. Read
  before writing or editing Three.js code: THREE.*, WebGLRenderer, geometry,
  materials, shaders, lights, textures, colour space, loaders, WebGPU, TSL.
  Lists what was renamed or removed since r128, because older code and older
  training data still use those names. Trigger words: three.js, THREE,
  WebGLRenderer, r128, r187, BufferGeometry, MeshStandardMaterial,
  outputEncoding, colorSpace, sRGB, GLTFLoader, InstancedMesh, WebGPURenderer,
  TSL, migrate/upgrade three.
---

# Three.js in this repo: r187, as one classic script

The game loads `src/vendor/three.r187.js` from a plain `<script>` tag. It is
built by `tools/three/build.mjs` from `tools/three/entry.js`, and the header
comment of `entry.js` is the authority on what is in it. `docs/plan/three-r187.md`
is the plan behind it. The r128 build and its separate loader scripts are gone.

## What that means when you write code here

- **`THREE` is a global.** The game is classic scripts that read `window.THREE`
  at parse time. Do not add `import * as THREE from 'three'`, `three/addons/...`
  or an import map to game code: the other files depend on the global.
- **Write current names.** `renderer.outputColorSpace`, `texture.colorSpace`,
  `THREE.SRGBColorSpace`. The r128 names in the table below no longer exist.
- **Loaders and utilities are on `THREE`** under the names the game already
  uses (`THREE.GLTFLoader`, `THREE.DRACOLoader`, `THREE.BufferGeometryUtils`,
  ...), and also under `THREE.Addons`. Anything not imported in `entry.js` is
  not in the bundle; add it there and rebuild.
- **WebGPU and TSL are present:** `THREE.WebGPURenderer`, `THREE.TSL.*`,
  `THREE.WebGPU.*`. `THREE.PMREMGenerator` is the WebGL one.
- **Colour management is OFF on purpose** (`ColorManagement.enabled = false`),
  to keep r128's look: a hex colour goes to the shader as typed and is treated
  as linear, so `new THREE.Color(0xc89a62).r` is 0.784. Do not "fix" colours
  for a colour-managed pipeline.
- **Lights use the r128 model on the WebGL renderer** (`THREE.LEGACY_LIGHTS`):
  intensities and falloff are tuned for it, so do not rescale them to
  physical units. The WebGPU renderer's node lights are physical.

Before claiming a symbol exists, check `API-INDEX.md`; if it is missing, it
was renamed or removed, and `MIGRATION.md` has the new name. Both were written
against r185, two revisions behind what the repo runs, so `entry.js` and the
vendored file win where they disagree.

## Names that changed since r128

Full list in `MIGRATION.md`:

| r128 (old) | current | since |
|---|---|---|
| `renderer.outputEncoding` | `renderer.outputColorSpace` | r152 |
| `texture.encoding` | `texture.colorSpace` | r152 |
| `THREE.sRGBEncoding` | `THREE.SRGBColorSpace` | r152 |
| `THREE.LinearEncoding` | `THREE.LinearSRGBColorSpace` | r152 |
| `renderer.useLegacyLights` / `physicallyCorrectLights` | **removed** upstream; this repo's build patches the legacy model back in for WebGL | r155 |
| `THREE.RGBFormat` | `THREE.RGBAFormat` | r137 |
| `BufferGeometryUtils.mergeBufferGeometries()` | `mergeGeometries()` (verify in API-INDEX) | later |
| `examples/js/*` (global attach) | `three/addons/*` upstream; here, bundled onto `THREE` by `entry.js` | r147/r160 |
| UMD `build/three.min.js` | **removed** upstream; here, the repo builds its own classic script | r161 |
| tone mapping "just works" in post | needs `OutputPass` | r155 |

## Files in this skill

- **`MIGRATION.md`** — the complete r125→r185 breaking-change ledger (every rename/removal, per revision). Consult when upgrading or when a symbol you remember is gone.
- **`API-INDEX.md`** — the r185 symbol surface (Core, Addons, TSL, Global constants). Use it to answer "does X exist / what's it called now" without guessing.

## Provenance

Reference files built 2026-07-04 from: the official Three.js Migration Guide wiki (r125→r185), the threejs.org Installation docs, npm `three@0.185.1`, and the r185 docs index. If a claim here conflicts with threejs.org/docs, the live docs win — this is a snapshot. The repo sections above were rewritten 2026-11-12 against `index.html` and `tools/three/entry.js`.
