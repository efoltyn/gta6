# Gang City streaming: the jail's budget, applied to the city

Owner, 2026-09-29: "The point is that jail opens on my phone and runs on my phone
and Gang City doesn't." And: "the jail game is more real than any other game by 1000x",
"it should be in sizes that are the same as fast as the jail game."

## What is built (branch city-slice)

- **Tool slices** (`src/core/slice.js`): `?mode=city&slice=<name>|x,z,r`. Everything visible
  from the circle is built for real, and the rest of the continent is data only.
  "Visible" here means inside the keep circle: r plus the fog band (`cityFogFar + 60`), past
  which city geometry is fog-coloured. Landmass builders whose measured footprint misses the
  keep circle are skipped, and their plain registrations are replayed so the plate, coast, map
  and road graph match the full city. Those registrations are regions, roads, water, no-spawn
  zones, biome blends and frontier records. Whatever else was drawn past the circle is pruned
  before the batch pass. Tools: `tools/speed.mjs --slice`, `--slice-spots`,
  `tools/lib/city-slice.mjs` (`withSlice`, `bootSlice`) and `tools/city-slice-trace.mjs`, which
  measures the manifest.
- **Streaming, opt-in for now** (`src/core/citystream.js`; `?stream=1`; see the blockers for why it is not yet the default):
  - The city boots as a slice centred on the spawn, and the slice centre follows the player.
  - Deferred jobs run when their rect comes into range. A job is either a skipped landmass
    builder, whose replayed records are swapped for its real ones, or a `CBZ.sliceAt(rect, fn)`
    unit that a builder deferred.
  - Content that leaves range is parked: it is detached, its GPU buffers are released and its
    colliders and platforms leave the broadphase.
  - A `pure` job is freed and re-run on return.
- **Builder gating**: the heavy builders that always run defer their non-terrain geometry per
  area through `CBZ.sliceAt` (see the commits on city-slice).

## The jail budget (measured, tools/speed.mjs, seed 90210, box at load ~90)

| | jail (escape) |
|---|---|
| load, desktop | 4.9 s (script eval 3.5 s, of which the prison at parse 1.5 s; build 0.44 s; first frame 0.81 s) |
| scene | 11.3k meshes, 5.8k visible, 2.29M visible tris, 64 programs, ~834 draws |
| phone profile (390x844@3, iOS UA) | JS heap 425 peak / 404 steady, GPU 114, total 537 MB (budget 600: OK) |
| density | ~13.6k objects on ~6 ha, about 2,300 objects/ha (today's city: ~140k on ~650 ha plus the metros, about 215/ha) |

A streamed slice may hold what the jail holds. The keep circle can contain about 12k built
meshes, 80 MB of geometry and 3M triangles. `CBZ.streamRadius` grows the playable radius until
the keep circle reaches that budget, using `cellCost` in the manifest: the finished city's own
per-400 m census of draws, tris and geometry KB.

## Measured 2026-09-29 (speed.mjs, one run each, box at load ~100; desktop frame = max(CPU, GPU) median, ms)

| boot | load s | build s | frame spawn / centre / aerial / drive | JS heap MB | GPU MB | phone total (phone profile) |
|---|---|---|---|---|---|---|
| jail (escape) | 3.9 | 0.25 | ~32 steady | 448 | 185 | 437 + 114 = 551 |
| whole city | 24.3 | 13.9 | 105 / 80 / 60 / 95 | 2562 | 485 | 2538 + 271 = 2809 |
| slice gangcity-downtown | 22.7 | 11.9 | 108 / 104 / 232 / 96 | 2010 | 445 | |
| slice harbor | 20.2 | 12.3 | 69 / 64 / 89 / 63 | 1981 | 335 | |
| slice kingsport-downtown | 14.6 | 8.6 | 68 / 36 / 39 / 54 | 1306 | 256 | 1294 + 101 = 1395 |
| slice karvel | 14.6 | 8.5 | 39 / 43 / 31 / 36 | 1337 | 267 | |
| slice estate | 14.9 | 9.1 | 25 / 29 / 34 / 31 | 1382 | 178 | |
| slice redhollow | 14.7 | 9.5 | 38 / 33 / 37 / 26 | 1374 | 146 | |
| streamed (?stream=1, downtown spawn) | 17.4 (phone) | 10.7 | | 2106 peak / 1725 | 233 | 1958 |

Kingsport's facade kit already streams (metro.js: cells build within 250 m of the camera and
drop at 300 m). At the CBD its ring holds about 311 MB of geometry, which is about 4x the
jail's 80 MB geometry budget. As a slice's detail tier it has to fit the budget, through
cheaper kit geometry per cell or occlusion, not a smaller visible radius (HD rule).

## Why the whole city can't stream yet (the exact blockers)

1. **The view band alone is over budget downtown.** The keep circle has to include the fog band
   (760 m at tier 2, 380 m at the phone tier), or the horizon has holes. At the downtown spawn,
   that band holds Halloran Field, the speedway, the arena, the west borough and the county jail,
   and it is already more than the jail budget. A street-canyon slice would have to be cheap in
   the band. That needs occlusion (below) or real HLODs of the downtown blocks, which the metro
   already has and downtown does not.
2. **Builders are one-shot and have side effects.** Many wrap globals (`spawnCityTraffic` is
   wrapped by world.js, expansion, marina and yachts), register updaters, or push into shared
   registries such as lots, shops, doors, elevators, fitout plans, work anchors and the tree
   audit. They can be built late once, but they can't be torn down and rebuilt, so they park.
   Parking frees GPU memory but not the JS heap. Only `pure` sliceAt jobs free JS memory. Each
   builder needs its geometry split into pure per-area jobs, with the data half kept always-on.
3. **The downtown grid is one solved cross-section** (streetkit), plus buildings per lot. Its
   lots, shops and doors are read by missions, police, the economy and saves, so the data must
   stay and only the geometry can defer.
4. **The batch pass runs once per world.** Late content keeps its own draws, the way the metro's
   tiles do. A per-job batch is the fix.
5. **The prison is built at parse in every mode**: 77 MB of geometry and about 1.5 s, resident
   in the city. The lazy-prison branch (`city-load-lazy-prison-wip`) is unverified WIP across
   45 files.
6. **Flight.** Airborne fog is 4200 m, and the slice does not grow for it, so flying shows the
   empty band. Flight needs its own far representation (terrain plus HLOD only).

## How the systems read a streamed world

- **Traffic**: `CBZ.roadPick` only answers with streets in the playable circle, and the count
  is scaled to the slice's share of road.
- **Police and navigation**: they run on the road records, which are complete from boot
  (replayed).
- **The map**: it draws regions, roads and water, which are complete from boot.
- **Missions**: their targets live in data. Geometry streams in when the player approaches.
- **Save and restore**: `lastPos` is restored, and the first streamed tick (end of `reset`)
  builds around wherever the player stands before the first frame.
- **Downtown peds and crowd**: they spawn only when the slice holds downtown. Towns and the
  metro populate around the player as they already do.

## Occlusion, the jail's second trick (plan)

The jail is fast because walls end every sightline. The city version is a per-street-grid PVS:
- For every road cell of a grid city (downtown, the metro CBD, the towns), precompute which
  blocks are visible from street height. Treat each block's buildings as solid boxes at their
  minimum roof height and cast from sample points at eye height. The result is conservative.
- At runtime, when the camera is below the local roofline, hide every block group that is not
  in the PVS of the camera's cell.
- This needs the batch pass to merge per block, not per 200 m tile, so that a block is one
  hideable unit.
- A street canyon then costs about what a jail corridor costs, and the band past the first row
  of buildings drops out of the budget. That is what lets downtown slices fit.

## Jail density per slice (the next wave)

With only the few slices near the player live, each can spend the jail's budget: about
2,300 objects/ha, walk-in interiors (the `fitout*.js` system already builds floor ±1 lazily),
street clutter, jail-grade materials and working doors (`CBZ.corridorKit`). The unit is one
city block per slice detail tier. The demo block is still to do, after the builders are fully
split and occlusion lands.
