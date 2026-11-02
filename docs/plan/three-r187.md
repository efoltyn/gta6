# three.js r128 -> r187: the campaign, phase A done, what is left

Goal (owner): the whole game on the r187 standard, ending on **WebGPURenderer
+ MeshletDrawingPipeline** for the static world (64-triangle clusters, GPU
compute culling incl. occlusion, cluster LODs), then measure and report.

Phase A (this branch) is the foundation: r187 vendored, the game running on
r187's **WebGLRenderer** looking the same, every page booting clean, the
WebGPU switch in place. Later phases: port the custom shaders to TSL node
materials, wire the meshlet pipeline, flip the default.

## Status (phase A, 2026-11-02)

- **Done:** r187 vendored as one classic script; every loader switched; the
  r128 build and its loader copies deleted; every r128 API the game used
  migrated; every page boots on r187 **WebGLRenderer** with **zero page
  errors and zero shader compile errors** (boot-check, shader diagnostics on,
  table below); the look matches r128 (measured, below); `?gpu=webgpu` opt-in
  creates a WebGPURenderer (WebGL2 backend when there is no navigator.gpu).
- **Not done (later phases):** the 160 custom shaders do not run under
  WebGPURenderer (TSL port, inventory below); the r128 light model, the fog /
  tone-map chunk surgery and the engine's WebGL-internals code have no WebGPU
  version yet; meshlets not wired.

## How to build, check, look

```sh
node tools/three/build.mjs                 # src/vendor/three.r187.js from three@0.187.0 (+ patches); --check = is it fresh
node tools/three/boot-check.mjs            # every page: boots? page errors? shader compile errors? sRGB sampler audit
node tools/three/boot-check.mjs city --shots <dir> [--root <other tree>] [--gpu webgpu] [--no-diag] [--json f]
node tools/three/hook-inventory.mjs        # every onBeforeCompile / ShaderMaterial, what it edits (the table below)
node tools/three/bump-v.mjs <key> --since <ref>   # re-key ?v= on every page for every changed script
# tools/three/look-probe.html[?three=<other build>&tone=aces]: material x light rig read back as numbers
#   (window.__look); run it on two builds to prove a lighting change is parity
node tools/speed.mjs --against <r128 sha>          # paired load/frame/GPU A/B + pixel look guard (real GPU)
```

Boot-check screenshots are taken 6 s after "ready" with the game's own
camera still easing in, so framing differs run to run (measured: same
camera to the centimetre at 8 s on both builds); compare looks with the
speed tool's fixed spots or the look probe, not the boot shots.

`boot-check` forces `?cfg_GFX_SHADER_DIAGNOSTICS=1`, so a broken program is a
console error naming its material, with the failing GLSL lines (`--json`
keeps the full text). ONE headless Chrome per run.

## What `src/vendor/three.r187.js` is

One classic IIFE (esbuild, ~1.7 MB minified; r128 + its loaders were ~0.75 MB)
that sets `window.THREE` (and `module.exports` under node: the ~90 vm checks
in tools/ load it exactly as they loaded r128):

| on THREE | from |
|---|---|
| everything in `three` (WebGLRenderer, ShaderChunk/Lib, UniformsLib/Utils, classic materials) | build/three.module.js |
| everything in `three/webgpu` (WebGPURenderer, *NodeMaterial, StorageBufferAttribute, drawing pipelines...) | build/three.webgpu.js |
| `THREE.TSL.*` (every TSL function), `THREE.WebGPU.*` (the webgpu namespace as published) | build/three.tsl.js |
| `GLTFLoader DRACOLoader RGBELoader HDRLoader ThreeMFLoader`, `BufferGeometryUtils` (+ r128 names `mergeBufferGeometries`/`mergeBufferAttributes`), `SkeletonUtils` | examples/jsm |
| `MeshletDrawingPipeline MeshletBatch MeshletGeometryUtils` (+ meshopt clusterizer/simplifier wasm) | examples/jsm (for phase C) |
| `THREE.createRenderer(params)`, `THREE.gpuMode()` | tools/three/entry.js (the renderer switch) |

The four builds share three.core.js, so every class exists once. The only
name the WebGL and WebGPU builds define differently is `PMREMGenerator`:
`THREE.PMREMGenerator` is the WebGL one, `THREE.WebGPU.PMREMGenerator` the node one.

### Source patches (tools/three/build.mjs `PATCHES`; each must match or the build stops)

| patch | why |
|---|---|
| lean Object3D (lazy uuid/up/modelViewMatrix/normalMatrix/animations, shared rotation<->quaternion callbacks) | port of the r128 vendor patch 26b79386: ~10^5 Object3Ds on a phone |
| lazy BufferGeometry uuid (getter in entry.js) | same patch |
| raycast skips released uv/uv1/normal arrays | core/batch.js keeps merged geometry GPU-only |
| `globalThis.__cbzGLAttr` = renderer's WebGLAttributes | core/batch.js, city/collapse.js read GL buffers back (WebGL2) |
| projectObject skips `_cbzNoDraw` / `_cbzFar` geometry | batch/citystream packed geometry; car cabin far cut (city/playercars.js) |
| InstancedMesh starts `frustumCulled = false` | r128 default; r187 culls by a sphere computed once (stale for moving pools); core/instcull.js culls the pools it can bound |
| WebGLLights x PI, Point/SpotLight decay default 1 | the r128 light model, JS half (below) |
| no transmissive render list / transmission pass; transmission_fragment = r128 alpha law (entry.js) | r187 refracts: one car pane in view re-drew every opaque object into a transmission target (survival: 2220 draws vs r128's 1143) |
| `Material.forceSinglePass = true` default | r154+ draws transparent DoubleSide twice |
| scene.environment lights MeshStandard/Physical only, at the material's envMapIntensity | r187 also lit Lambert/Phong with it (pale, blown-out whites) and replaced envMapIntensity with scene.environmentIntensity |
| Box3.setFromObject boxes the geometry; InstancedMesh/SkinnedMesh raycasts use geometry bounds | r187 unions every instance / posed vertex once on the CPU and never refreshes it |
| DRACOLoader default URLs made lazily | `new URL(import.meta.url)` at load breaks the node vm checks |

r128's other vendor patch (CBZ_LAZY_PROGRAMS: resolve a program's uniforms on
first use so `renderer.compile` does not wait on the GPU) is native in r187
(`getUniformList`, plus KHR_parallel_shader_compile / `compileAsync`).

## The global decisions (and what the WebGPU phase must carry)

1. **ColorManagement.enabled = false.** r128 had no colour management: an
   authored hex went to the shader as-is and was treated as linear; sRGB
   textures were decoded, output encoded to sRGB. Disabled colour management
   in r187 is exactly that, so every colour in the game is bit-identical
   (hundreds of comments in the code say "a hex here is LINEAR" and tune for
   it). `texture.colorSpace` / `renderer.outputColorSpace` work either way.
   Changing this later means converting every authored colour: not worth it.
2. **The r128 light model (`THREE.LEGACY_LIGHTS`).** r155 made physically
   correct lights the only mode; every light in the game is tuned on the
   legacy one. WebGL keeps it exactly: light colours scaled by PI (what r128's
   `irradiance *= PI` and r155's `useLegacyLights` did; ambient, hemisphere,
   directional, point, spot; not rect-area or probes), r128's distance
   falloff `pow(saturate(1 - d/distance), decay)` (and 1 when distance = 0),
   point/spot `decay` default 1. **The node lights under WebGPURenderer are
   physical**: a WebGPU frame is ~PI x darker and point/spot falloff is
   inverse-square until phase B ports this (a custom LightsNode /
   `PointLightNode` attenuation, or scaling every light once at creation).
3. **r128's `vUv` for built-in-material hooks.** r128 gave a material with a
   map one varying `vUv`, already through the map's uvTransform; r151 split it
   per map. `uv_pars_vertex/fragment` now alias `vUv` to the varying r128
   would have used (vMapUv, else vSpecularMapUv, vNormalMapUv, ...) unless the
   material defines USE_UV. TSL ports don't need it.
4. **Frustum culling of pools and skinned bodies = r128's** (core/instcull.js):
   geometry sphere x matrixWorld. r187 computes `object.boundingSphere` once
   (every instance / every skinned vertex on the CPU) and never refreshes it.

## THE r187 SAMPLER TRAP (custom shaders)

An sRGB-tagged texture (`colorSpace = SRGBColorSpace`) is uploaded as
SRGB8_ALPHA8, so **every** shader reads it decoded. r128 decoded only inside
the built-in map chunks; a custom `sampler2D` got the raw bytes. So:

- a hook/ShaderMaterial that decoded a sampled sRGB texture by hand
  (pow 2.2, the polynomial, `sRGBTransferEOTF`) now decodes twice (too dark);
- one that used the raw bytes as if linear now reads truly linear values
  (darker than it was tuned).

`boot-check` lists every sRGB texture bound to a custom sampler in the live
scene that is not on its reviewed list (`S x1 ... (REVIEW): <material>
.<uniform>`). Fixed in phase A: ground skin (uGndG/D/S/R), volcano grass
(uVolGrass), combat camo (uCamo), tree bake (uMap). Still to look at: any
that appear in modes the boot check did not reach (the inventory's `sampler`
/ `srgb` flags), e.g. gore/wildfire/tornado/volcano FX ShaderMaterials that
only exist mid-event.

## Silent r128 -> r187 breakages (no error, found by looking / measuring)

These are the class the boot check cannot see; each is fixed, listed so the
later phases know the pattern:

| symptom | cause | fix |
|---|---|---|
| NPC War soldiers and the city's far crowds gone | `capabilities.vertexTextures/floatVertexTextures` removed in r187; entities/crowdgpu.js gated itself off | `maxVertexTextures > 0` |
| crowd / car emissive / tree impostor shader errors | `vColor` is a vec4 in every r187 vertex shader | `.rgb` / `vec4(...)` |
| pale sand, blown-out road paint, bright Lambert/Phong | r187 lights Lambert/Phong with `scene.environment` and swaps envMapIntensity for scene.environmentIntensity | build patch (PBR only, material intensity) |
| 2x draw calls with a car in view | transmission = refraction pass re-drawing every opaque object | r128 alpha-law transmission |
| CCTV feed: +103 programs, no tone curve | r187 render targets render untone-mapped in linear space | `THREE.screenTarget` |
| ground road-field texture undefined | `LuminanceFormat` removed | RedFormat |
| grass blade backs dark | Lambert per-fragment flips back normals | un-flip in the hook |
| doubled decode on ground/camo/volcano/tree bake | the sampler trap above | drop the manual decode |
| PCFSoftShadowMap warning, PCF now | removed in r181 | PCFShadowMap (r187's PCF is a 5-tap Vogel soft filter) |
| CPU arrays dropped mid-merge (risk) | onUploadCallback on every transfer since r147 | first upload only |
| pre-existing on r128 too: `[park batch pruned] ... bakeMergeV2` (33 packed `_cbzNoDraw` meshes merged without being expanded, core/citystream.js streamCompactParked) | NOT a migration bug, same 33 on r128 | open: expand (CBZ.geoExpandAll) or skip packed meshes before batchStaticUnder |

## Results (measured 2026-11-02, this Mac)

### Boot status, r187 WebGLRenderer (boot-check, shader diagnostics on)

| page / mode | boots | page errors | shader errors | notes |
|---|---|---|---|---|
| index.html city (Gang City) | yes, 256 s headless | 0 | 0 | 202 programs |
| index.html escape (jail) | yes, 117 s | 0 | 0 | |
| index.html archipelago (the Isles) | yes, 58 s | 0 | 0 | |
| index.html survival | yes, 83 s | 0 | 0 | |
| index.html sharksim | yes, 77 s | 0 | 0 | |
| index.html gungame | yes, 81 s | 0 | 0 | |
| disaster.html | yes, 54 s | 0 | 0 | regenerated by tools/build-disaster-page.mjs |
| games/battle.html (NPC War) | yes, 22 s | 0 | 0 | soldiers drawn (crowdgpu fix) |
| games/bomb-survivor.html | yes, 20 s | 0 | 0 | |
| games/warlord.html | yes, 7 s | 0 | 0 | |
| games/president.html | yes | 0 | 0 | no three.js on this page |
| games/race.html | yes, 9 s | 0 | 0 | |
| games/ocean.html | yes, 6 s | 0 | 0 | keeps r128's linear output (never set one) |
| lab.html | yes, 1 s | 0 | 0 | |

(Headless SwiftShader: boot seconds are software-GL seconds, compare only
between rows of the same run. r128 on the same harness: city 393 s, escape
175 s, isles 60 s, survival 104 s, battle 29 s, bomb 44 s, warlord 13 s.)

### Look, r128 vs r187 WebGL

- **tools/three/look-probe.html** (a lit sphere per material x light rig,
  read back): Lambert, Phong and Basic are **identical to the digit** under
  ambient, hemisphere, sun, point, spot and sky IBL; MeshStandard within
  3-5/255 (metal 7-10/255 under IBL): r187's multi-scatter / DFG BRDF, kept
  (it is the "better" side: energy-conserving rough dielectrics).
- **speed.mjs look guard** (block SSIM at the game's HD settings, same
  seed/spot): spawn and downtown "same look" (inside base re-run noise);
  aerial 5.3 % of the stable picture changed: tree canopies a touch brighter
  and the lake rim lighter. Most likely cause: r187 filters sRGB mipmaps in
  linear space (SRGB8_ALPHA8), r128 averaged the encoded bytes then decoded
  (which darkens minified foliage); the far canopy samples small mips. Not
  verified further; flag for the owner.
- Contact sheet: before (r128) | after (r187 WebGL) | ?gpu=webgpu per page,
  ~/harness/out/gta6/three-r187/three-r187-before-after.pdf.

### Speed, r128 -> r187 WebGL (tools/speed.mjs --against 7ea2462e, real GPU M1 Pro, 3 interleaved pairs, warm shaders)

| metric | r128 | r187 | verdict |
|---|---|---|---|
| city load, nav -> playable | 22.9 s | 24.1 s | within noise (box load avg 13-17) |
| load CPU main / GPU process | 19.3 s / 6.5 s | 20.8 s / 6.5 s | within noise |
| programs compiled (load + spots) | 197 | 214 | +8.6 % (was 316 before the screen-target and transmission fixes) |
| frame, spawn / downtown / aerial / drive | 107 / 70 / 102 / 111 ms | 117 / 72 / 115 / 112 ms | within noise (headless, loaded box) |
| GPU ms, aerial / drive | 62 / 96 | 52 / 66 | -21 % / -32 % (drive shadow pass -29 %, decided) |
| bundle | three.r128 + 6 loader files ~0.75 MB | three.r187.js 1.70 MB | +0.95 MB: WebGPU + TSL + meshlets ride along |

### Under `?gpu=webgpu` (WebGPURenderer; headless Chrome has no WebGPU adapter, so the WebGL2 backend)

Every index.html mode, disaster, battle and race **boot**; the errors left
are the expected ones: `NodeBuilder: Material "ShaderMaterial" is not
compatible` (one per ShaderMaterial on screen: 51 in the city, 9-25 per
mode) and those materials draw nothing. Built-in materials render through
the node library, but their onBeforeCompile hooks are ignored (the ground,
facades, trees, people's skin wrap, fog/height fog, film grade all fall back
to stock), and lights are physical (about PI x darker). Guarded so far: the
fog uniform pushes, the shadow gate, fxwarm's stand-in compile, lightpin's
compile hook, CustomToneMapping (-> ACES), render() before init().

| page | under ?gpu=webgpu (WebGL2 backend, headless) |
|---|---|
| city / escape / isles / survival / sharksim / gungame / disaster | boot; errors = ShaderMaterials not compatible (51 / 13 / 17 / 25 / 18 / 9 / 11) |
| battle, race | boot; 9 / 2 ShaderMaterials |
| bomb, warlord | render (WebGPU Info has no render.frame: boot-check's ready predicate fixed to info.frame after the run); 8 / 5 ShaderMaterials |
| president, ocean, lab | clean |

Phase B order that unblocks the most: (1) the light model + fog + film grade
as nodes (every frame's look), (2) the ground/terrain/facade/tree hooks (the
static world, and the meshlet candidates), (3) water + sky ShaderMaterials,
(4) FX ShaderMaterials (gore, fire, smoke, tornado, nuke: mostly transparent,
meshlets skip them anyway), (5) people (skinned: never meshlets; wait for the
people rework to land). Real WebGPU (not the WebGL2 backend) needs a
headed/GPU Chrome: tools/speed.mjs runs the real GPU headless and is the
place to add a `--gpu webgpu` lane.

(Correction, 2026-11-02: headless Chrome DOES get the real GPU's WebGPU
adapter on this Mac: `--headless=new --enable-unsafe-webgpu --use-angle=metal
--ignore-gpu-blocklist`, no SwiftShader flags, reports `apple / metal-3`.
`tools/lib/cdp.mjs` launch({ gpu: "real" }) and `boot-check --real-gpu` do it.)

## THE FIRE ENGINES (WebGPU): one particle engine, clustered lights, TSL volumes

Fire, smoke, ash, dust, sparks and flying/rolling rock under the WebGPU
renderer. Two shared engines (other systems build on them: the destruction /
explosions work must use `CBZ.gpuParticles` for fireballs, debris and dust,
not stand up a second particle system) and the FX that use them. Everything
is gated: under the classic WebGLRenderer `CBZ.gpuParticles.on` and
`CBZ.clusterLights.on` are false and every caller keeps today's builder, so
the WebGL look is unchanged (boot-check clean, same rnd() draws: the hazard
stream never depends on the renderer).

### `src/systems/gpufx.js` — `CBZ.gpuParticles`, THE particle engine

TSL compute on storage buffers, one compute pass and ONE instanced draw per
look however many particles are alive. Live only on the real WebGPU backend
(the WebGL2 fallback of the WebGPU renderer has no atomics or vertex-stage
storage): check `GP.on`.

```js
const GP = CBZ.gpuParticles;
if (GP.on) {
  GP.ensureGround(groundAt, cx, cz, size);   // bake the height field (sliced, once per field)
  GP.emit("smoke", { x, y, z, n: 4, r: 1.5, vy: 3, vr: 1, life: 6, size: 2, grow: 9,
                     temp: 0.5, tone: 0.6 });        // tone 0 steam .. 0.5 ash .. 1 soot
  GP.emit("fire",  { x, y, z, n: 2, r: 0.8, vy: 2, life: 0.8, size: 1.6, temp: 1 });
  GP.emit("spark", { x, y, z, n: 8, vr: 9, vy: 12, life: 2.5, size: 0.2, temp: 1, buoy: 0 });
  GP.emit("dust",  { x, y, z, n: 20, r: 2, vr: 4, life: 4, size: 1.5, grow: 6, tone: 0.4 });
  GP.emit("ash",   { x, y, z, n: 1, vy: -0.6, life: 10, size: 0.12 });
  GP.rock({ x, y, z, vx, vy, vz, size: 0.8, temp: 0.9, life: 40, spin: 6, shed: 1 });
}
GP.setWind(x, y, z) / GP.setWind(null)   // pin / follow CBZ.weatherWind
GP.clear([look])   GP.stats()             // { pools: {look: {max, emitted, gpuRing}}, computeMs, ground }
```

EMIT fields (all optional): `x y z` where, `n` count (max 2048 a pool a
frame), `r` spawn-sphere radius (`rUp` squashes it vertically), `vx vy vz`
velocity + `vr` random spread, `life lifeR` seconds, `size grow` start/end
size in metres (gases grow as they entrain air), `temp` 0..1 heat (buoyancy,
the blackbody glow, the fire colour), `tone`, and per-particle overrides of
the look's `buoy drag turb`.

| look | what | physics | draw |
|---|---|---|---|
| smoke | billowing lit puffs | buoyancy x temp, cools 0.22/s; wind drag (vertical a third); curl noise | MeshLambertNode billboards: scene sun/sky + every clustered light, lobe normals from the puff atlas, hot underside glows, soft particles |
| dust | heavy grit (impacts, surges, density currents) | as smoke, heavier; RUNS DOWNHILL near the ground (slope gravity) | as smoke, warmer tone |
| fire | incandescent gas | strong buoyancy, fast cooling, curl licking | additive flame tongues on a blackbody ramp, tileable scrolling noise |
| spark | embers, spatter, clots | ballistic, bounce 0.35 on the height field | additive streaks stretched along velocity |
| ash | lit flakes | slow fall, flutter, settle | small lit quads |
| rock | real 3D blocks | rigid bodies: gravity, bounce (restitution off the slope normal), ROLLING (w -> n x v / r), tumbling quaternion | InstancedMesh, storage instance matrices written by compute, MeshStandardNode, cracks glow by temperature, cast shadows |

Rocks SHED grit into the smoke pool GPU -> GPU (an atomic ring reserved at
the top of the target pool, an accumulator per rock: one puff per half its
own size of path, so a trail is a streak, never beads). Pools are sized off
`CBZ.qScale` (phone .. desktop). The height field is ONE 256 x 256 storage
buffer baked off a `groundAt` (an eruption and the wildfire share the
island's: `ensureGround` bakes once). The clock is the game's dt (an
`onAlways` at 96.5), so a frozen-rAF `CBZ.stepSim` storyboard advances it
tick for tick; paused = frozen.

Adding an effect: emit into an existing look (most explosions are
fire + smoke + dust + spark + rock with different numbers); add a LOOK only
for a genuinely new draw. Do not create a second particle system.

### `src/core/clusterlights.js` — `CBZ.clusterLights`, Forward+ lights

Installs `THREE.ClusteredLighting` (examples/jsm/lighting/ClusteredLighting.js,
512 lights, 32 px tiles x 24 depth slices x 64 a cluster) as
`renderer.lighting` under the WebGPU renderer (either backend). Point and
spot lights are binned by a compute pass into a data texture; LightsNode's
cache key hashes only the non-clustered lights (sun, sky, shadow casters),
so adding, moving or removing a fire light NEVER recompiles a program.
`core/lightpin.js` stands down when `CBZ.clusterLights.on` (it restores the
masks it set once and stops pinning): every lamp, fire and lava pool reaches
the shader, phones included.

```js
const L = CBZ.clusterLights.add({ x, y, z, color: 0xff7a2a, intensity: 1.6, distance: 14, flicker: 0.8 });
L.set(x, y, z).power(v).reach(d).color(hex);  L.remove();
```

`intensity` is in the GAME's light units (the r128 legacy model);
`CL.toNode()` converts once for the node renderer's physical falloff (matched
at a third of the reach). When the core light-model port lands it should set
`THREE.LEGACY_LIGHTS_NODE = true` and the game units pass straight through.
Clustered lights use the same `directPointLight` / `getDistanceAttenuation`
as stock point lights, so a legacy-attenuation patch there covers both.

### The TSL volumes (the smoke the owner likes, kept)

- `src/world/plume_node.js` (`CBZ.plumeNode.make`): the volcano's plume
  volume march (column, umbrella, fall streaks, base surge, density current,
  cock's-tail jets, fumarole wisps, dust bursts) ported line for line from
  volcanofx.js's GLSL. Same uniforms object shape, so volcanofx.js drives
  either; `plumeMaterial()` picks it under WebGPU. Before this the plume box
  rendered as a BLACK BOX under WebGPU (an incompatible ShaderMaterial draws
  black, not nothing), which is most of why the earlier ?gpu=webgpu frames
  were dark.
- `src/systems/smokeplume.js`: the wildfire's convection columns, same
  treatment (`nodeMaterial()` beside the GLSL).
- `src/systems/wildfire.js` burn tiles (char, ash, singe, ember bed): TSL.
- WGSL rules learned: every texture read inside a march is explicit-LOD
  (`.sample(uv).level(0)`; implicit derivatives are illegal in non-uniform
  control flow); a texture that is swapped later is read through
  `textureNode.sample()` so the reads follow `.value`; the march stops at the
  scene depth (`viewportDepthTexture` -> metres along the ray) with
  depthTest off instead of writing frag depth; uniforms referenced inside
  `Fn().setLayout()` functions shared between kernels went missing from the
  second kernel's bind group (inline node builders instead).

### What uses them (WebGPU only; WebGL keeps today's builders)

- VOLCANO (world/volcanofx.js, world/eruption.js, systems/disasters.js):
  the phreatic blast's cock's-tail jets, the owner's "little dark gray clouds
  that look like 2D rocks rolling down the side of the mountain", are real
  tumbling rocks + heavy dark dust shed along each jet's flight that falls
  back and runs down the cone; the base surge is pale dust rolling off the
  rim; bombs trail continuous smoke, burst dust on landing and hand their
  rock to the engine (it bounces and rolls on down, the crater and the hazard
  stay the CPU body's); the four hottest bombs in the air carry lights; the
  fountain is spark clots + a light; the warning's rockfall and the
  incandescent spatter roll down the lane; the density current throws hot
  tumbling rocks and billowing grit from its head and lights the ground under
  its nose. The column/umbrella are the TSL plume.
- WILDFIRE (systems/wildfire.js): every flame tongue (crowns, the grass
  front, window bays, roofs, cars) is emitted as fire particles (budgeted to
  the pool), flame tips shed lit smoke, the surface smoke and column puffs
  are particles, embers sparks, ash flakes; the glow sprites are replaced by
  up to 96 clustered lights keyed on the burning thing (trees, grass blocks,
  houses, cars), so the fire lights the ground, the trunks, the walls and its
  own smoke. Columns: TSL smokeplume. Char ground: TSL burn tiles.
- QUAKE gas fires (systems/quake.js): tongues + smoke into the engine, a light.

### Tools

```sh
node tools/fire/lab.mjs --scene all|volcano|fire|lights [--night] --cam "x,y,z,ax,ay,az,fov;..."   # the engines alone, 1 s boot
node tools/fire/shot.mjs --gpu webgpu|webgl --beats slope-warn,flank-film,night-flank,wildfire-night --out <dir>
node tools/fire/probe.mjs --force volcano --secs 7 --expr-file f.js          # an answer from the staged island
node tools/three/boot-check.mjs disaster --gpu webgpu --real-gpu
```

## Engine code that talks to WebGL directly (WebGPU phase)

These read WebGL internals or WebGLRenderer-only API and need a WebGPU
answer (or a guard) before `?gpu=webgpu` can become the default:

| file | uses |
|---|---|
| src/core/renderer.js | ShaderChunk fog + tone map surgery, `info.programs` uniform pushes (setFogAniso / setFarAir: no-ops under WebGPU now), shadowMap.render gate (skipped under WebGPU), checkShaderErrors |
| src/core/groundmask.js, src/core/gfx.js, src/world/carfx.js, src/world/groundshaft.js, src/entities/people.js | edit THREE.ShaderChunk / ShaderLib (WebGPU ignores ShaderChunk) |
| src/core/fxwarm.js | `renderer.compile`, `info.programs`, `initTexture`, `properties.get().__webglInit` (WebGPU: `compileAsync`) |
| src/core/batch.js, src/city/collapse.js | `__cbzGLAttr` + `getContext()` GPU read-back of merged geometry (falls back to CPU arrays when not WebGL2) |
| src/entities/pedinstance.js | ped page atlas: `copyTextureToTexture`, `__webglTexture`, raw `gl.blitFramebuffer` / `copyTexSubImage2D` |
| src/core/texfree.js, src/world/fuel_station.js | `properties.get(tex).__webglInit` (was it uploaded?) |
| src/core/quality.js, src/core/drawcheck.js, src/core/profile.js, src/core/viewscope.js, src/core/daynight.js, src/core/lights.js, ~10 city files | `shadowMap.autoUpdate/needsUpdate` (WebGPU's shadow map has no manual refresh) |
| ~25 files | `capabilities.getMaxAnisotropy()` (WebGPU: `renderer.getMaxAnisotropy()`), `capabilities.isWebGL2` |
| src/city/cctv.js, src/systems/sights.js | `THREE.screenTarget` (rt.cbzScreen: a WebGL build patch) + `screenTargetMap`; the node renderer needs its own answer (render the feed through the same output node) |
| src/city/newsstudio.js, src/city/cockpit_view.js | render targets left on r187 semantics (no tone map, linear): they compile their own program variants when used; candidates for screenTarget |
| 67 ShaderMaterials + 93 onBeforeCompile hooks | WebGPU renders neither (inventory below) |

## Phase C (meshlets) prerequisites

`MeshletDrawingPipeline` needs WebGPURenderer + node materials, and skips
skinned meshes, transparent materials, morph targets and materials with
custom vertex/fragment/output nodes. For the static world that means: the
merged/batched city geometry (core/batch.js) must be built from stock
MeshStandardNodeMaterial / MeshLambertNodeMaterial looks (the facade, ground
and terrain hooks ported to TSL as *material features* that the pipeline
accepts, not custom vertex/output nodes), and the CPU-side packing
(`_cbzNoDraw`, GPU-only arrays, slice hides by zeroing ranges) replaced by the
pipeline's own visibility. Everything moving (people, cars, FX, water) stays
on the standard path.

## Inventory: every custom shader

Generated by `node tools/three/hook-inventory.mjs` (rerun it; line numbers
drift). Flags: `vUv` (uses the r128 alias), `srgb` (hand sRGB transfer),
`sampler` (own texture: check the sampler trap), `vtx` (moves vertices),
`lights` (edits lighting), `fog`. Status: every row compiles on r187 WebGL in
the pages the boot check reaches (zero shader errors); none runs under
WebGPURenderer (all need a TSL port). Rows marked in "phase A" were edited.

160 custom shaders: 93 onBeforeCompile hooks, 67 ShaderMaterials, in 85 files.

| file:line | kind | patches | chunks edited / included | flags | phase A |
|---|---|---|---|---|---|
| src/battle/arenas/dress.js:103 | hook | Lambert | project_vertex color_fragment |  |  |
| src/battle/arenas/erg.js:474 | hook | Phong | project_vertex normal_fragment_maps aomap_fragment tonemapping_fragment | sampler lights |  |
| src/battle/arenas/erg.js:574 | hook |  | project_vertex color_fragment |  |  |
| src/battle/arenas/fields.js:101 | hook | Lambert | begin_vertex | vtx |  |
| src/battle/arenas/ground.js:169 | hook |  | project_vertex |  | API renames |
| src/battle/arenas/ground.js:196 | hook | Lambert | project_vertex color_fragment |  | API renames |
| src/battle/arenas/ground.js:384 | SM |  |  | vUv sampler vtx | API renames |
| src/battle/arenas/ground.js:541 | SM |  |  | vtx | API renames |
| src/battle/arenas/ground.js:642 | SM |  |  | vtx | API renames |
| src/battle/arenas/sea.js:237 | hook |  | begin_vertex color_fragment | vtx |  |
| src/battle/arenas/yard.js:278 | hook |  | project_vertex color_fragment |  | API renames |
| src/city/airport_kit.js:446 | hook | Lambert | map_fragment project_vertex common |  | shader fixed in file |
| src/city/beach.js:1565 | hook | Standard | project_vertex color_fragment roughnessmap_fragment normal_fragment_maps common |  | API renames |
| src/city/beach.js:1660 | hook | Lambert | project_vertex color_fragment common |  | API renames |
| src/city/carinstances.js:216 | hook |  |  |  | shader fixed in file |
| src/city/carinstances.js:217 | hook |  |  |  | shader fixed in file |
| src/city/cityground.js:881 | hook | Standard | project_vertex color_fragment roughnessmap_fragment normal_fragment_maps common |  | API renames |
| src/city/cityground.js:909 | hook | Standard | project_vertex color_fragment common |  | API renames |
| src/city/crashdeform.js:444 | hook | Lambert |  |  |  |
| src/city/facade_openings.js:557 | hook | Lambert | common uv_vertex | vUv | API renames |
| src/city/fitout.js:511 | hook | Lambert |  |  | API renames |
| src/city/fitout.js:546 | hook | Lambert |  |  | API renames |
| src/city/fitout.js:559 | hook | Lambert |  |  | API renames |
| src/city/flags.js:1060 | hook | Phong |  |  | API renames |
| src/city/highways.js:112 | hook | Lambert | common project_vertex color_fragment |  | API renames |
| src/city/highways.js:220 | hook |  | common project_vertex color_fragment |  | API renames |
| src/city/metro_fabric.js:680 | hook | Lambert | common project_vertex |  |  |
| src/city/metro_ground.js:2795 | hook | Lambert | common project_vertex color_fragment emissivemap_fragment |  | shader fixed in file |
| src/city/nukefx.js:610 | SM |  |  |  | API renames |
| src/city/playercars.js:283 | hook | Lambert |  |  | shader fixed in file |
| src/city/storegoods.js:156 | hook |  | emissivemap_fragment |  | API renames |
| src/city/street_hardware.js:662 | SM |  |  | vUv vtx | API renames |
| src/city/vehicles.js:909 | hook |  |  |  |  |
| src/core/gfx.js:160 | hook |  | common project_vertex normal_fragment_maps aomap_fragment | sampler lights |  |
| src/core/lodlights.js:195 | SM |  |  |  | API renames |
| src/core/microboot.js:207 | SM |  |  | vtx | API renames |
| src/core/sight.js:155 | hook |  |  |  |  |
| src/core/sight.js:277 | hook |  | project_vertex clipping_planes_fragment | sampler vtx |  |
| src/entities/combatkit.js:795 | hook | Lambert | common begin_vertex | sampler vtx | shader fixed in file |
| src/entities/crowdgpu.js:488 | hook | Lambert | common color_vertex beginnormal_vertex begin_vertex | vtx | shader fixed in file |
| src/entities/crowdgpu.js:512 | hook | Lambert | common beginnormal_vertex begin_vertex color_fragment | sampler vtx | shader fixed in file |
| src/entities/crowdgpu.js:578 | SM |  |  | vtx | shader fixed in file |
| src/entities/jewelry_kit.js:170 | hook | Standard |  |  | API renames |
| src/entities/jewelry_kit.js:184 | hook | Standard |  |  | API renames |
| src/entities/jewelry_kit.js:1234 | hook |  |  |  | API renames |
| src/entities/pedinstance.js:1045 | hook |  |  |  | API renames |
| src/entities/people.js:702 | hook | Standard | lights_physical_pars_fragment common map_fragment | vUv sampler lights | shader fixed in file |
| src/entities/people.js:750 | hook | Standard | common uv_vertex map_fragment | vUv sampler | shader fixed in file |
| src/entities/people.js:791 | hook | Standard | common map_fragment |  | shader fixed in file |
| src/entities/people.js:817 | hook | Standard | common map_fragment |  | shader fixed in file |
| src/entities/people.js:835 | hook | Standard | common map_fragment |  | shader fixed in file |
| src/entities/people.js:853 | hook | Standard | alphatest_fragment |  | shader fixed in file |
| src/entities/searchlight.js:102 | hook | Basic |  |  |  |
| src/entities/watch.js:640 | hook |  |  |  |  |
| src/race/race_car.js:749 | hook | Standard | begin_vertex | vtx | API renames |
| src/race/race_car.js:1353 | SM |  |  |  | API renames |
| src/race/race_game.js:64 | SM |  |  | vtx | API renames |
| src/race/race_track.js:745 | hook | Basic | begin_vertex alphamap_fragment | vtx | API renames |
| src/systems/debris.js:2517 | SM |  |  | vtx | API renames |
| src/systems/dustfx.js:77 | SM |  |  | vtx |  |
| src/systems/flashflood.js:1455 | hook | Lambert | common begin_vertex color_fragment envmap_fragment fog_pars_vertex fog_vertex fog_pars_fragment | vtx fog | API renames |
| src/systems/flashflood.js:1627 | SM |  |  |  | API renames |
| src/systems/flashflood.js:2023 | hook | Lambert | common begin_vertex color_fragment | vtx | API renames |
| src/systems/gore.js:604 | SM |  |  |  | shader fixed in file |
| src/systems/gore.js:1007 | SM |  | fog_pars_vertex fog_pars_fragment colorspace_fragment fog_fragment | vUv sampler vtx fog | shader fixed in file |
| src/systems/gore.js:1545 | SM |  |  | vtx | shader fixed in file |
| src/systems/gore.js:3116 | SM |  |  |  | shader fixed in file |
| src/systems/gunfx.js:989 | hook | Lambert | uv_vertex | vUv |  |
| src/systems/hurricane.js:1210 | hook |  | project_vertex fog_fragment | fog |  |
| src/systems/sights.js:528 | SM |  |  |  | API renames |
| src/systems/sights.js:540 | SM |  |  |  | API renames |
| src/systems/sights.js:551 | SM |  |  |  | API renames |
| src/systems/skidmarks.js:83 | SM |  |  | vtx |  |
| src/systems/smokeplume.js:193 | SM |  |  |  | API renames |
| src/systems/smoketrail.js:130 | SM |  |  |  | API renames |
| src/systems/tornado.js:454 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment tonemapping_fragment colorspace_fragment fog_fragment | vUv sampler vtx fog | API renames |
| src/systems/tornado.js:545 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment tonemapping_fragment colorspace_fragment fog_fragment | vUv sampler vtx fog | API renames |
| src/systems/volfx.js:615 | SM |  |  |  | API renames |
| src/systems/volfx.js:1055 | SM |  |  | vtx | API renames |
| src/systems/volfx.js:1228 | SM |  | tonemapping_fragment colorspace_fragment | vtx | API renames |
| src/systems/weather.js:854 | hook |  | fog_vertex tonemapping_fragment fog_fragment | fog |  |
| src/systems/wildfire.js:350 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment fog_fragment | vtx fog | shader fixed in file |
| src/systems/wildfire.js:409 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment fog_fragment | vtx fog | shader fixed in file |
| src/systems/wildfire.js:482 | SM |  |  | vtx | shader fixed in file |
| src/systems/wildfire.js:511 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment | vtx fog | shader fixed in file |
| src/systems/wildfire.js:547 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment fog_fragment | vtx fog | shader fixed in file |
| src/systems/wildfire.js:587 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment fog_fragment | vUv sampler vtx fog | shader fixed in file |
| src/units/kit/felid.js:296 | hook | Lambert | begin_vertex color_fragment | vtx |  |
| src/units/kit/hull.js:738 | SM |  |  |  | API renames |
| src/units/vehicles/b52.js:896 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment fog_fragment | vtx fog | API renames |
| src/units/vehicles/bradley_ifv.js:645 | SM |  |  |  | API renames |
| src/units/vehicles/m1_abrams.js:801 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment colorspace_fragment fog_fragment | vtx fog | API renames |
| src/units/vehicles/stryker_apc.js:759 | SM |  |  |  | API renames |
| src/warlord/desert.js:758 | hook | Phong | common project_vertex color_fragment normal_fragment_maps |  |  |
| src/warlord/desert.js:1135 | SM |  |  | vtx |  |
| src/warlord/props.js:488 | hook |  | common project_vertex color_fragment |  | API renames |
| src/warlord/sand.js:665 | SM |  |  | vUv sampler vtx |  |
| src/warlord/sand.js:976 | SM |  |  | vtx |  |
| src/warlord/war/view.js:573 | SM |  |  |  |  |
| src/warlord/war/view.js:591 | SM |  |  |  |  |
| src/warlord/war/view.js:1074 | hook | Lambert | begin_vertex | vtx |  |
| src/warlord/war/view.js:1269 | SM |  |  |  |  |
| src/weapons/munitions.js:601 | SM |  |  |  |  |
| src/world/alpine_skin.js:146 | hook | Standard | common project_vertex color_fragment normal_fragment_maps roughnessmap_fragment |  |  |
| src/world/basekit.js:533 | hook |  | project_vertex color_fragment |  | API renames |
| src/world/building_dress.js:84 | hook | Standard | project_vertex map_fragment roughnessmap_fragment common | vUv |  |
| src/world/carfx.js:160 | hook |  |  |  | API renames |
| src/world/disaster_arena.js:602 | hook | Lambert |  |  | shader fixed in file |
| src/world/disaster_arena.js:638 | hook | Standard |  |  | shader fixed in file |
| src/world/disaster_arena.js:2596 | hook | Standard | project_vertex color_fragment normal_fragment_maps common aomap_fragment | sampler lights | shader fixed in file |
| src/world/disaster_arena.js:2708 | hook | Standard |  |  | shader fixed in file |
| src/world/disaster_arena.js:3790 | hook | Lambert |  |  | shader fixed in file |
| src/world/grassfield.js:432 | hook | Lambert | begin_vertex beginnormal_vertex common normal_fragment_begin color_fragment | vtx | shader fixed in file |
| src/world/groundshaft.js:195 | hook |  |  |  | API renames |
| src/world/island_night.js:114 | hook |  | project_vertex |  |  |
| src/world/island_night.js:323 | SM |  |  |  |  |
| src/world/island_night.js:332 | SM |  |  |  |  |
| src/world/materials.js:1041 | hook |  | common project_vertex color_fragment roughnessmap_fragment |  | API renames |
| src/world/materials.js:1098 | hook |  | common project_vertex color_fragment |  | API renames |
| src/world/prisonlook.js:230 | hook |  | common project_vertex aomap_fragment color_fragment defaultnormal_vertex |  |  |
| src/world/prisonlook.js:249 | hook |  |  |  |  |
| src/world/terrain_overhaul.js:652 | hook |  | fog_vertex | fog | shader fixed in file |
| src/world/terrain_overhaul.js:692 | hook |  | worldpos_vertex clipping_planes_fragment | sampler | shader fixed in file |
| src/world/terrain_overhaul.js:752 | hook |  | tonemapping_fragment fog_fragment | fog | shader fixed in file |
| src/world/terrain_overhaul.js:845 | hook |  | project_vertex fog_fragment | fog | shader fixed in file |
| src/world/terrain_overhaul.js:943 | hook |  | tonemapping_fragment fog_vertex | fog | shader fixed in file |
| src/world/textures_surface.js:891 | hook | Lambert | project_vertex color_fragment common emissivemap_fragment | sampler | shader fixed in file |
| src/world/treefoot.js:121 | hook |  | project_vertex map_fragment common |  |  |
| src/world/treelod.js:117 | hook |  |  |  | shader fixed in file |
| src/world/treelod.js:120 | hook |  |  | vUv srgb sampler vtx | shader fixed in file |
| src/world/treelod.js:213 | SM |  |  |  | shader fixed in file |
| src/world/treelod.js:465 | hook | Phong | begin_vertex map_fragment color_fragment normal_fragment_begin | vtx | shader fixed in file |
| src/world/tsunami_flow.js:161 | SM |  |  |  |  |
| src/world/tsunami_scene.js:177 | hook | Lambert | common begin_vertex color_fragment envmap_fragment | vtx |  |
| src/world/tsunami_scene.js:392 | hook | Lambert | common begin_vertex | vtx |  |
| src/world/tsunami_scene.js:655 | hook | Lambert | common begin_vertex color_fragment envmap_fragment | sampler vtx |  |
| src/world/tsunami_scene.js:877 | hook | Lambert | common begin_vertex color_fragment | vtx |  |
| src/world/tsunami_whitewater.js:508 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment tonemapping_fragment colorspace_fragment fog_fragment | vtx fog | API renames |
| src/world/tsunami_whitewater.js:660 | SM |  |  |  | API renames |
| src/world/volcanofx.js:666 | hook | Phong | common map_fragment color_fragment specularmap_fragment |  | API renames |
| src/world/volcanofx.js:1559 | SM |  |  |  | API renames |
| src/world/volcanofx.js:2350 | SM |  |  |  | API renames |
| src/world/water_hulls.js:1093 | hook |  | begin_vertex color_fragment | vtx |  |
| src/world/water_pages.js:7 | hook |  |  |  |  |
| src/world/water_spec.js:2220 | hook |  |  | sampler | shader fixed in file |
| src/world/water_spec.js:3212 | SM |  |  |  | shader fixed in file |
| src/world/water_spec.js:4510 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment | vtx fog | shader fixed in file |
| src/world/water_spec.js:4681 | SM |  |  |  | shader fixed in file |
| src/world/water_spec.js:5101 | hook |  | fog_pars_vertex fog_vertex fog_pars_fragment tonemapping_fragment colorspace_fragment fog_fragment | vtx fog | shader fixed in file |
| src/world/water_spec.js:5223 | SM |  |  |  | shader fixed in file |
| src/world/water_underwater.js:705 | SM |  |  | vtx fog | API renames |
| src/world/water_underwater.js:918 | SM |  |  | vUv sampler vtx | API renames |
| src/world/water_underwater.js:1038 | SM |  |  | vtx | API renames |
| src/world/water_wake.js:322 | SM |  | tonemapping_fragment colorspace_fragment | vtx | API renames |
| src/world/water_wake.js:548 | SM |  | tonemapping_fragment colorspace_fragment | sampler vtx | API renames |
| src/world/water_wake.js:826 | SM |  | fog_pars_vertex fog_vertex fog_pars_fragment tonemapping_fragment colorspace_fragment fog_fragment | sampler vtx fog | API renames |
| src/world/water_wake.js:1337 | SM |  | tonemapping_fragment colorspace_fragment | sampler vtx | API renames |
| games/bomb-survivor-scene.js:337 | hook | Standard | common project_vertex normal_fragment_maps fog_pars_vertex shadowmap_pars_vertex beginnormal_vertex defaultnormal_vertex +11 | sampler vtx lights fog | shader fixed in file |
| games/bomb-survivor-scene.js:510 | SM |  |  |  | shader fixed in file |
| games/bomb-survivor-scene.js:985 | SM |  |  |  | shader fixed in file |

