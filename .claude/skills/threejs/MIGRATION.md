# Three.js migration ledger — r125 → r185

Source: official Three.js Migration Guide wiki + release notes, snapshotted 2026-07-04. Current release is **r185** (npm `0.185.1`). This repo is on **r128**, so everything at r129+ is a *forward* change you'd apply when upgrading; everything ≤r128 is already true in this repo.

When a symbol you expect is missing, search this file for the old name to find the new one. For exact current method signatures, confirm against `API-INDEX.md` or threejs.org/docs.

## Color management & rendering (the big one)

**r152** — color space overhaul:
- `WebGLRenderer.outputEncoding` → `WebGLRenderer.outputColorSpace` (default `SRGBColorSpace`)
- `Texture.encoding` → `Texture.colorSpace` (default `NoColorSpace`)
- `THREE.sRGBEncoding` → `THREE.SRGBColorSpace`
- `THREE.LinearEncoding` → `THREE.LinearSRGBColorSpace`
- `ColorManagement.enabled` now defaults to `true`

**r155** — tone mapping + lighting defaults:
- Inline `renderer.toneMapping` only applies when rendering to screen; post-processing needs `OutputPass` for tone mapping (its constructor takes no params)
- `WebGLRenderer.useLegacyLights` deprecated, defaults to `false` (physically-correct lighting becomes the norm; `physicallyCorrectLights` retired)

**r163** — WebGL 1 removed entirely; stencil context defaults to `false`; `TextGeometry` `height` param renamed `depth`.

**r176** — `ColorManagement.fromWorkingColorSpace()` → `workingToColorSpace()`, `.toWorkingColorSpace()` → `colorSpaceToWorking()`.

## Geometry & buffers

- **r125** — `Geometry` class removed from core → `examples/jsm/deprecated/Geometry.js`; generators produce `BufferGeometry`; raycasting/line-distances/exporters drop `Geometry` support. *(already true in r128)*
- **r137** — `RGBFormat` → `RGBAFormat`; `RGBIntegerFormat` → `RGBAIntegerFormat`; `UnsignedShort565Type` → `UnsignedShort5551Type`. *(r128 still HAS RGBFormat)*
- **r144** — `BufferGeometry.merge()` removed → `BufferGeometryUtils.mergeBufferGeometries()`; various `BufferAttribute.copy*Array()` helpers removed; `MeshLambertMaterial` becomes per-fragment.
- **r150** — `BufferGeometryUtils` now imported as `import * as BufferGeometryUtils from '...'`.
- **r151** — UV attributes renamed `uv2→uv1`, `uv3→uv2`, `uv4→uv3`; `SkinnedMesh.boneTransform()` → `applyBoneTransform()`; `MapControls` moved to its own module; `Triangle.getUV()` → `getInterpolation()`.
- **r185** — `BufferGeometryUtils.toTrianglesDrawMode()` now modifies in place.

## Materials, shaders, blending

- **r146 / r177** — `MultiplyBlending` and `SubtractiveBlending` require `Material.premultipliedAlpha = true`.
- **r147** — `PointLight`/`SpotLight` `decay` default becomes `2` (physically correct); `BufferAttribute.onUploadCallback` runs on every GPU transfer.
- **r157** — `bumpScale` becomes UV-scale-invariant (world space); existing bump values need adjustment.
- **r172** — `MeshGouraudMaterial`, `InstancedPointsNodeMaterial` removed; TSL `varying()` → `toVarying()`, `vertexStage()` → `toVertexStage()`.
- **r170** — `Material.type` becomes a static read-only property; mipmaps auto-generate when `generateMipmaps = true`.

## Loaders & exporters

- **r147** — `examples/js/*` (global-attach) deprecated in favor of `examples/jsm/*` (ES modules). This repo's `examples/js/loaders/*` pattern lives on borrowed time.
- **r164** — `LWOLoader` left→right-handed conversion (assets reorient); `USDZLoader.parseAsync()` added.
- **r179** — `RGBELoader` → `HDRLoader`; `RGBMLoader` removed; `USDZLoader` deprecated → `USDLoader`.
- **r183** — `VTKLoader` deprecated; `KTX2Loader.detectSupportAsync()` → `detectSupport()`; `FBXLoader` auto-converts +Z-up → +Y-up (r184 too).
- **r174** — `AnimationClip.parseAnimation()` deprecated; `ParametricGeometries` → `ParametricFunctions`.
- **r175** — `CapsuleGeometry.length` → `height`; `LottieLoader` deprecated.

## Build & delivery

- **r161** — **`build/three.js` and `build/three.min.js` removed.** ES modules only. *(This is why this repo's r128 `<script src=".../three.min.js">` has no modern equivalent to bump to — a real upgrade means moving to an import map.)*

## WebGPU & TSL (entirely new since r128)

- **r167** — some TSL chaining removed (`outputPass.fxaa()` → `fxaa(outputPass)`); `viewportTopLeft` → `viewportUV`; `viewportBottomLeft` → `viewportUV.flipY()`; `uniforms()` → `uniformArray()`; `DragControls.activate()/deactivate()` → `connect()/disconnect()`.
- **r171** — import split solidified: `three/webgpu` (WebGPURenderer, NodeMaterial) and `three/tsl` (TSL functions). TSL blend renames: `burn()`→`blendBurn()`, `dodge()`→`blendDodge()`, `screen()`→`blendScreen()`, `overlay()`→`blendOverlay()`.
- **r173** — `TextureNode.uv()` → `sample()`; `rangeFog()`/`densityFog()` deprecated.
- **r179** — `TRAAPassNode` → `TRAANode`.
- **r180** — `PostProcessing` → `RenderPipeline`; `DepthOfFieldNode` new API; `resolution` (Vector2) → `resolutionScale` (scalar); `USE_REVERSEDEPTHBUF` → `USE_REVERSED_DEPTH_BUFFER`; `USE_LOGDEPTHBUF` → `USE_LOGARITHMIC_DEPTH_BUFFER`.
- **r183** — `renderAsync()`/`computeAsync()`/`waitForGPU()` deprecated; WebGPU init is automatic in `setAnimationLoop()` or manual `await renderer.init()`.

## Render targets

- **r162** — `WebGLMultipleRenderTargets` removed → use `count` on render-target classes; hand-tracking not requested by default; `InteractiveGroup` uses `listenToXRControllerEvents()` / `listenToPointerEvents()`.
- **r164** — `copyTextureToTexture(src, dst, srcRegion, dstPosition, level)` / `copyFramebufferToTexture(texture, position, level)` signatures changed.
- **r165** — `BatchedMesh` requires `addInstance` after `addGeometry` to render.

## Misc deprecations by revision

| Rev | Change |
|---|---|
| r178 | `Timer` moved into core (no separate import) |
| r179 | `Clock` deprecated → use `Timer` |
| r181 | `PCFSoftShadowMap` deprecated; `colorBufferType` → `outputBufferType`; PBR indirect-specular + energy-conservation changes (rough materials brighter) |
| r182 | `Sky`/`SkyMesh` legacy gamma correction removed; `RoomEnvironment` position updated |
| r184 | Background/environment map rotation aligned to object rotation; FBX +Z→+Y auto-convert |
| r185 | `GTAONode.distanceExponent`/`distanceFallOff` deprecated; `LightProbeGrid` → `LightProbeGridWebGL`; `LightProbeGridHelper` → `LightProbeGridHelperWebGL` |

## Already-ancient (pre-r128, listed for completeness)

`MultiMaterial` → array (r85); `Face4` → two `Face3` (r60); `examples/js` → `examples/jsm` migration began well before but globals lingered.
