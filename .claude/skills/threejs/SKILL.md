---
name: threejs
description: >
  Authoritative, current Three.js API reference (r185, the latest release as of
  July 2026) for THIS repo. Read BEFORE writing, editing, or reasoning about any
  Three.js code — anything touching THREE.*, WebGLRenderer, geometry, materials,
  shaders, lights, textures, color/encoding, GLTFLoader/DRACOLoader, WebGPU, or
  TSL. Your training data is older than r185 and this game is pinned to the
  ANCIENT r128, so "what you remember" is wrong in two different directions.
  Corrects stale API knowledge and prevents writing r185-only (or r128-only) code
  into the wrong context. Trigger words: three.js, THREE, WebGLRenderer, r128,
  BufferGeometry, MeshStandardMaterial, outputEncoding, colorSpace, sRGB,
  GLTFLoader, InstancedMesh, WebGPURenderer, TSL, migrate/upgrade three.
---

# Three.js — current API (r185) vs. this repo's r128

**Two versions are in play. Do not confuse them.**

| | Version | How it loads | Where |
|---|---|---|---|
| **What this game runs** | **r128** (Dec 2020) | UMD global script → `window.THREE`; loaders via `examples/js/*` that attach to `THREE.*` | `index.html:250-252` |
| **Current Three.js** | **r185** (~Jul 2026, npm `0.185.1`) | ES modules + import map; addons via `three/addons/*`; **no UMD build exists anymore** | threejs.org |

r128 is **57 revisions / ~5 years behind** current. Your training data sits somewhere in between, so verify against this skill instead of memory.

## The rule

- **Editing/adding code in this game → write r128 API.** The codebase is global-`THREE`, `examples/js` loaders, pre-color-management, pre-physically-correct-lights. See "r128 reality" below.
- **Advising on current Three.js, a new project, or an upgrade → write r185 API.** See `MIGRATION.md` for every rename and `API-INDEX.md` to confirm a symbol actually exists in r185.
- **Before claiming any symbol exists**, check `API-INDEX.md` (the full authoritative r185 surface). If it's not there, it was renamed or removed — find the new name in `MIGRATION.md`.

## r128 reality (what breaks if you write "modern" three here)

These r128 defaults/patterns are **correct for this repo** and would be wrong in r185 — and vice versa. This is where agents get burned.

- **Loading is UMD globals, NOT ES modules.** `window.THREE` is global; `new THREE.GLTFLoader()` works because `examples/js/loaders/GLTFLoader.js` attaches to `THREE`. **Do NOT** introduce `import * as THREE from 'three'`, `three/addons/…`, or an import map — r128's whole delivery model is script tags. Porting one file to ESM breaks the global other files depend on. (The UMD `build/three.min.js` this repo `<script>`-loads was **removed entirely in r161**; there is no drop-in newer UMD to bump to.)
- **Color management is OFF.** `THREE.ColorManagement.enabled` became `true` by default only in **r152**. In r128 colors are authored in the legacy (linear-ish, no auto-sRGB) workflow. Use `renderer.outputEncoding` / `texture.encoding` (**not** `outputColorSpace` / `texture.colorSpace` — those don't exist until r152).
- **Lights are NOT physically correct by default.** Physically-correct lighting became the only mode in **r155** (`useLegacyLights` gone). In r128, light `intensity`/`decay` follow the old model — don't "fix" intensities to r155+ expectations.
- **`RGBFormat` still exists** (removed r137). `BufferGeometry.merge()`-era utilities differ. `Geometry` is already gone (removed r125, before r128), so that part matches modern.
- **Encoding constants:** r128 uses `THREE.sRGBEncoding` / `THREE.LinearEncoding` (renamed to `SRGBColorSpace` / `LinearSRGBColorSpace` in r152).

## r185 quick cheat-sheet (current API)

Install / import (there is **no** global-script build — import maps only):

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
}}
</script>
<script type="module">
  import * as THREE from 'three';
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
  // WebGPU + node materials:  import { WebGPURenderer } from 'three/webgpu';
  // TSL shading functions:    import { uniform, texture, mix } from 'three/tsl';
</script>
```

Highest-frequency renames since r128 (full list in `MIGRATION.md`):

| r128 (old) | r185 (current) | since |
|---|---|---|
| `renderer.outputEncoding` | `renderer.outputColorSpace` | r152 |
| `texture.encoding` | `texture.colorSpace` | r152 |
| `THREE.sRGBEncoding` | `THREE.SRGBColorSpace` | r152 |
| `THREE.LinearEncoding` | `THREE.LinearSRGBColorSpace` | r152 |
| `renderer.useLegacyLights` / `physicallyCorrectLights` | **removed** (physically correct always on) | r155 |
| `THREE.RGBFormat` | `THREE.RGBAFormat` | r137 |
| `BufferGeometryUtils.mergeBufferGeometries()` | `mergeGeometries()` (verify in API-INDEX) | later |
| `examples/js/*` (global attach) | `three/addons/*` (ESM only) | r147/r160 |
| UMD `build/three.min.js` | **removed** — import map only | r161 |
| tone mapping "just works" in post | needs `OutputPass` | r155 |

New capability tiers that **did not exist** in r128 and must be imported from split entry points in r185: `WebGPURenderer` (`three/webgpu`), the whole **TSL** node-shading language (`three/tsl`), `BatchedMesh`, `RenderPipeline`/node post-processing. Never assume these into r128 code.

## Files in this skill

- **`MIGRATION.md`** — the complete r125→r185 breaking-change ledger (every rename/removal, per revision). Consult when upgrading or when a symbol you remember is gone.
- **`API-INDEX.md`** — the full authoritative r185 symbol surface (Core, Addons, TSL, Global constants). Use it to answer "does X exist / what's it called now" without guessing.

## Provenance

Built 2026-07-04 from: the official Three.js Migration Guide wiki (r125→r185), the threejs.org Installation docs, npm `three@0.185.1`, and the r185 docs index. If a claim here conflicts with threejs.org/docs, the live docs win — this is a snapshot.
