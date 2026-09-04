# Gang City on High/Best looked like cardboard — root cause and fix

Captured 2026-09-04 with `tools/cityhost.mjs` (seed 90210, origin exec, headless
SwiftShader, 1120×690), one fixed street-level camera at the corner of the white
block at (26, −726), and one close-up 6 m from its wall. Same camera for every
image; only the quality tier and the code changed.

| file | what it shows |
|---|---|
| `reference-fast-street.png` | Fast (tier 0), untouched — the look the owner said was fine |
| `before-best-street.png` | Best (tier 4) before the fix — the cardboard |
| `before-best-closeup.png` | Best before, 6 m from the wall |
| `after-best-street.png` | Best after, same camera, same time of day |
| `after-best-closeup.png` | Best after, 6 m from the wall |
| `after-best-dusk.png` | Best after, day clock at 0.475 (sun on the horizon) |
| `after-best-night.png` | Best after, day clock at 0.75 (midnight) |

## Why it only happened on High/Best

Fast and Balanced never promote the merged city to PBR. Tiers 3–4 flip the
`pbr` column in `core/quality.js`, and everything below was in that path
(`core/gfx.js`):

1. **Double ambient.** `MeshStandardMaterial.envMap` contributes indirect
   *diffuse* as well as reflections. The environment map was attached at 0.5 on
   top of the hemisphere light that already is the sky ambient, so every promoted
   surface got ~40% more flat fill. Shadow sides went as bright as lit sides.
2. **The environment was a sunrise photo.** `city/official_assets.js` loaded
   `blouberg_sunrise_2_1k.hdr` into `scene.environment`, applied at noon and at
   midnight. Its warm horizon band is the grey-brown tint on every dark window in
   the "before" images. With no HDR, the fallback was carfx's static grey-purple
   gradient — same problem, different colour.
3. **Exposure +2/+4% on tiers 3/4** compounded the wash.
4. **One roughness (0.88) for every fragment** and **one "concrete" micro-normal
   projected onto every surface at 0.55 strength** — paint, plaster, roofs, kerbs,
   walls 50 m away, all wearing identical 2 cm grain. That is what paper looks
   like.
5. **Contact AO darkened every horizontal surface** below 2.6 m, so plazas and
   pavements carried a permanent smudge.
6. **Flag/tier changes never recompiled.** r128 keys its program cache on
   `customProgramCacheKey()`, which defaults to `onBeforeCompile.toString()`; a
   re-installed hook with different feature flags had the same text and kept the
   old program. Toggling `GFX_WORLD_DETAIL` / `GFX_CONTACT_AO` at runtime did
   nothing, which is why they could not be A/B'd in play.

## What changed

- `core/gfx.js` (rewritten): the environment's diffuse share is scaled in-shader
  (`GFX_ENV_DIFFUSE`, 0.22) so it does reflections and the hemisphere stays the
  one ambient; `envMapIntensity` follows `CBZ.dayness` every frame; roughness is
  derived per fragment from the albedo the batcher baked into vertex colour
  (saturated → paint sheen, pale neutral → render, near-black → dark gloss,
  horizontals stay gritty); a slow world-space tone breakup and a grime tide-mark
  at the base of walls replace uniform grain; the micro-normal is weaker on walls
  than floors and fades with view distance; contact AO no longer touches
  up-facing surfaces; every promoted material carries an explicit cache key.
  cmat twins get the same model through `CBZ.gfxDressPbr`.
- `core/envsky.js` (new): the reflection environment is now a PMREM of the actual
  sky dome canvas, re-baked when the sky repaints (≥2.5 s apart, ~2 ms each) into
  one persistent render target, so `CBZ.ENV` / `scene.environment` never change
  identity after the first publish. Dusk, night and storms reach every reflective
  surface for free.
- `city/official_assets.js`: the sunrise HDR is only the fallback when
  `?cfg_GFX_SKY_ENV=0`.
- `core/quality.js`: tiers 3/4 exposure back to 1.00.
- `world/materials.js`: twins start at intensity 0 and are dressed by gfx; wet-road
  reflections also dim with the sun.
