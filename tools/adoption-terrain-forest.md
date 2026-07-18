# Adoption: terrain + vegetation techniques from the reference generators

Reference: `scratchpad/reference/upstream-generators.js` (modern three r18x / WebGPU /
TSL — study for MATH + PLACEMENT, not shading). Target files I own here:
`src/city/continent.js` (the live walkable backcountry: relief + dressing),
with cross-refs to `src/city/biome_{snow,desert,forest}.js`, `src/world/terrain.js`.

## What we already have (surveyed)

TWO terrain tiers exist:
- **Walkable ground** = `CBZ.cityGroundHeightAt(x,z)` — MAX over providers registered by
  `CBZ.registerCityGroundHeight`. Providers today: `continent.js countryHeightAt`
  (backcountry), `biome_snow.js mountainHeightAt`/`greaterMercyHeightAt` (Gaussian-lobe
  peaks + ribs), `biome_desert.js desertHeightAt` (dune/mesa max + graded benches).
  `city.arena.groundHeightAt` → this. Each biome's RENDER MESH samples its OWN height fn
  per vertex, so mesh == sampler by construction (the key invariant).
- **Backdrop** = `world/terrain.js CBZ.terrainHeight` (ridged-fbm horizon ring) + its forest
  `world/wildnature.js`. BOTH DISABLED by default (`CBZ.PROC_TERRAIN=false`,
  `CBZ.WILD_NATURE=false`, config.js:576/579) — owner: "decorative mountains are not
  geography". So the backdrop is NOT a live target.

`continent.js countryHeightAt` is the sweet spot: it is (a) the walkable sampler, (b) the
ground-plate mesh's per-vertex height, and (c) the tree/rock dressing Y — one function, so
any change stays self-consistent for free. Its noise core is a plain 4-octave value-fbm
(`countryFbm`) + a one-octave ridge term → smooth, undifferentiated hills.

Forest today: `continent.js` dressing is the crudest + largest scatter — a 46u hash grid,
biome-cover density bias, ONE flat-green `ConeGeometry` canopy + box trunk, NO per-instance
color, NO altitude/slope/clearing ecology. (`biome_forest.js` is already good — multi-species,
`instanceColor`, icosahedron crowns; `wildnature.js` sophisticated but OFF.) So the backcountry
dressing is where reference forest technique buys the most.

Determinism law: every build random must be `CBZ.hash01(x,z,salt)` / `CBZ.seedStream(name)` —
never `Math.random`, never an extra draw on a shared sequential stream (order-fragile). The
reference's `mulberry32 createRandom(seed)` is a sequential stream → we substitute position-hash
(`noise2`, itself `hash01`-based) so results are order-independent and byte-identical per seed.

## Adoptions, ranked by payoff-per-risk

### 1. Derivative-damped fractal ("Quilez erosion") — PORTED-NOW
Ref `eroded()`: accumulate a running gradient across octaves, divide each octave by
`1 + erosion*(dX²+dZ²)` → detail collapses on already-steep ground, concentrating relief into
weathered ridgelines and flattening valley floors. Ported analytically into `countryHeightAt`
(flag `CONTINENT_RELIEF_EROSION`, default ON): gradient via finite-diff of `noise2` (C0 value
noise; piecewise-linear derivative is fine for damping), same output range as `countryFbm` so
the existing height-composition + coastFade + frontier/authored-surface gating are untouched
(no new cliffs at graded borders). Pure fn, allocation-free, deterministic. Highest payoff,
lowest risk: swaps the noise core of a fn that already drives mesh AND sampler together.

### 2. Domain warp — PORTED-NOW
Ref warps the sample point by a low-freq fbm before sampling → ridges meander instead of
running axis-aligned. Ported as a modest `noise2`-based positional offset (~120u) ahead of the
eroded sum, inside the same flagged path. Analytic, deterministic, free.

### 3. Per-octave domain rotation (~37°) — PORTED-NOW
Ref rotates the domain `[0.8,-0.6;0.6,0.8]` each octave so octaves don't grid-lock into visible
axis alignment. Folded into the erosion loop (technique #1). Free.

### 4. Instanced blob-tree forest w/ baked AO + ecological placement — PORTED-NOW
Ref `ForestGenerator`: squashed-icosphere teardrop canopy, baked dark-base→bright-crown AO
gradient, rejection sampling (altitude band / slope limit / density-mask clearings), squared-bias
scale jitter, per-instance color. Ported into the `continent.js` backcountry dressing (flag
`CONTINENT_FOREST_V2`, default ON):
- Canopy = `IcosahedronGeometry(1,0)` (20 faces, non-indexed, flat-shaded → chunky/voxel), squashed
  to a tapered teardrop with a small baked sin-lump; AO ramp (base 0.55 → crown 1.0) baked into the
  geometry's vertex-`color` attribute. Box trunk kept (≥0.3u members, voxel rule).
- Per-instance green tint via `instanceColor` (r128: `vColor = color(vertex AO) *= instanceColor`,
  confirmed in the vendored chunk) → AO gradient × per-tree hue, still ONE draw call. Trunk gets
  per-instance bark tint too.
- Ecology (all `hash01`/`noise2`, order-independent — adding/removing a rejection shifts nothing):
  slope limit (finite-diff of `countryHeightAt`; steep ridge faces reject → become rock),
  treeline fade (density feathers out above high relief), low-freq clearing mask (meadows break the
  uniform scatter), biome-cover density bias retained. Squared-bias scale (`min + h²·(max-min)`).
Big win: the largest, ugliest scatter in the live world gains depth (AO), variety (per-instance
color), and ecological structure — and it sits on the newly eroded relief so slope/altitude rules
finally mean something.

### 5. sampleSlope (normal.y from finite diff) — ALREADY-HAVE, reused
Ref `sampleSlope` = allocation-free central-diff flatness. We already have
`desertNormalAt`/`snowTerrainNormalAt`/`terrainNormal`; adoption #4 uses the same 2-tap finite-diff
of `countryHeightAt` for its slope gate. No new interface.

### 6. Thermal (talus) erosion passes — PORTABLE-LATER
Ref `thermalErode`: grid relaxation shedding material past the angle of repose (order-independent
via a delta buffer). Needs a BAKED heightfield grid + bilinear resample; but `countryHeightAt` is
an ANALYTIC point-sampler over large, seed-variable bounds (up to ~8k u), and the plate is only
SEG=320 (~20u cells) where talus (`drop = talus·cellSize`) is near-inert. Baking a dedicated fine
grid for both mesh AND sampler is doable but risks a subtle mesh↔sampler desync that build-only
(no-screenshot) verification can't catch — and would break the "one function" invariant that makes
#1 safe. Defer until a chunked/baked terrain contract exists (INFINITE-WORLD.md). Same reasoning
applies to porting #1's erosion into `biome_snow`/`biome_desert` — those already bake grids, so
thermal is a cleaner fit there LATER.

### 7. Bilinear `sampleHeight` from a baked grid — NOT-APPLICABLE (to countryHeightAt)
Our walkable relief is analytic point-sampling, not a baked grid; biome meshes that DO bake already
bilinear-sample implicitly (mesh interpolates between graded vertices). No gap to fill.

### 8. Diamond alternating-diagonal triangulation — PORTABLE-LATER (low payoff)
Ref flips the quad diagonal per cell so the mesh has no one-way grain. Our plates use
`PlaneGeometry` (uniform diagonal). Cosmetic at our facet scale + flat shading; not worth a custom
index build now. Trivial to add to any future baked mesh.

### 9. TreeGenerator branch skeletons — NOT-APPLICABLE
Tapered-tube trunk/branch/twig skeletons (parallel-transport frames, pipe-model radii, golden-angle
spread). Too smooth/round for the voxel look (owner's own hint), and per-tree tube geometry blows
the draw-call/vertex budget vs. the single-InstancedMesh blob canopy that already reads organic.

### 10. TSL materials (banded terrain shading, forest AO shader, road material) — NOT-APPLICABLE
All are `three/tsl` node materials / WebGPU. r128 has no TSL. The equivalents already live here as
per-vertex band coloring (biome_snow/desert/terrain), baked vertex AO (adoption #4), and canvas
textures. The MATH ported; the shading did not.

## Implemented now (both in `src/city/continent.js`, both default-ON, one-line revert each)
- `CONTINENT_RELIEF_EROSION` — adoptions #1/#2/#3 in `countryHeightAt`.
- `CONTINENT_FOREST_V2` — adoption #4 in the backcountry dressing.
