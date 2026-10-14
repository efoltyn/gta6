# Gang City streaming: the jail's budget, applied to the city

Owner, 2026-09-29: "The point is that jail opens on my phone and runs on my phone
and Gang City doesn't." And: "the jail game is more real than any other game by 1000x",
"it should be in sizes that are the same as fast as the jail game."

## The runtime streamer (2026-10-14)

Measured with tools/speed.mjs on the owner's M1 Pro under a shared box (load 30-90): paired
A/B against 0da9d239 (3 interleaved pairs per device), plus one warm-world drive per side
(`--ask drive`, 60 s at 40 m/s from the downtown spawn, `--route "-15,-725;-2110,-260;-1520,-1180"`)
and `--ask horizon` (new: how far real content reaches against the fog, what is drawn past reach).

| | desktop before | desktop after | phone before | phone after |
|---|---|---|---|---|
| load, nav to playable (paired) | 27.2 s | 19.9 s (-28%) | 26.3 s | 18.3 s (-30%) |
| worst streamer frame on the drive | 545 ms | 246 ms | 535 ms | 215 ms |
| worst single piece of streamer work | 517 ms (metro_structs) | ~230 ms (one Neon Reef town lot) | 505 ms | ~210 ms |
| streamer ms/frame on the drive, mean / p99 | 2.28 / 27.1 | 2.26 / 24.3 | 2.22 / 16.3 | 1.96 / 14.6 |
| pop-ins on the drive (streamed / other) | 1 / 3 | 0 / 3 | 0 / 1 | 0 / 1 |
| LOD handoffs inside the fog on the drive | 73 | 79 | 176 | 27 |
| meshes drawn past the fog's reach (spawn / downtown / aerial) | 283 / 232 / 26 | 104 / 123 / 0 | 286 / 55 / 0 | 141 / 55 / 0 |
| tris at spawn / downtown (paired) | | -11% / -15% | | |
| memory (paired: boot heap, GPU, phone live) | | same | | same |

What changed:
- **Planned at 10 Hz, worked every frame** (core/citystream.js). The tick did all of it in one
  frame of six (every unpark, 6-16 ms of builds, every park and free). The plan only decides
  now; each frame does a share at the old throughput (60 / 160 ms a second). In view is still
  done at once.
- **A streamed landmass job swept the whole city root** for fog-scaled surfaces (72k
  objects): metro_structs, one mesh, was 505-530 ms on every drive. Now the sweep covers what
  the job added (2-10 ms).
- **Jobs in steps**: `CBZ.sliceAt(rect, [fn, fn, ...])` builds one part per share, holds the
  parts (and their LOS blockers: unrendered, their matrices were identity, so rays hit their
  walls round the world origin) out of the scene until the last, then settles them as one.
  Apartment cells (200 ms) and airfield dressing (100 ms) use it.
- **facade_openings**: this wave and fast-streamed-boot (main) both rewrote the coplanar
  resolver the same way; the merge keeps main's file (its scan and hidden-face test are the
  fastest). `tools/facade-equiv.mjs` + `tools/preload/focapture.js` replay every real call
  of a boot and a streamed tour (207 resolve calls, 221,605 boxes; 141 scans) through the
  pre-2026-10-14 code and each rewrite: 0 differences; resolve 14.2 s -> 3.1 s, scan
  6.5 s -> 0.4 s. That is the -28% load above.
- **farcull**: a freshly built or re-attached stream group is judged before its first frame
  (content built ahead past the fog was uploaded, hidden, read back and re-uploaded); groups
  show at R and hide past R + band (they came back 30 m inside the fog at speed); the
  fog-reach pool cull runs on the desktop too (plain-fog pools only; phones keep their rule).
- **viewscope**: a subtree past `reach` is hidden for the frame, movers included (parked
  airliners with crews, herds were drawn as fog colour). Exact: pixel-identical in-page A/B.
- **fitout** floors index their colliders in place (4 of 5 full broadphase rebuilds on a
  phone drive).
- A job is wanted by its rect grown by its measured spill (60 m on the desktop until it has
  been built once: the stream group that popped at 750 m).

The horizon, plainly: on the ground the real (near-form) content already reaches the fog's end
(`detail` = fog + 36 m, the keep circle 30 m past it), and nothing near-form can be seen past
the fog. What this wave bought is the far tier's cost (nothing past `reach` is drawn, tris
-11/-15%) and frames without the streamer's 0.5 s stalls; the distance itself is the quality
tier's fog (desktop 760 m at tier 2, phone 380 m), which the governor raises when frames allow.
The paired frame medians stayed within the box's noise (load 30-90). Not settled: on every
phone A/B the full run drew ~30% more calls from the aerial spot (GPU +25%), and the shot shows
downtown towers on the horizon that the base run lacks; a warm world placed at that spot draws
the same (5,361 vs 5,384 calls), so it depends on what the run did before the shot, not on the
spot. The phone A/B's drive memory read +7% (an unsure interval, -0.4..+8.7% runs); the boot
and steady memory read "same".

Still open: a town lot is one building job of 150-230 ms (makeBuilding: flushDeco and the
facade grammar; needs the builder split into steps); 3 non-stream pops at the drive start
(`Group#6`, radius 1 m, 18-72 m); the drive's heap sawtooth is three.js render allocations,
metro facade kit cells and wildlife, not the streamer.

## Phone fit (branch phone-fit, 2026-09-29)

Measured on the phone profile (tools/speed.mjs --device phone, 390x844@3, iOS UA), streamed
city (`?stream=1`) at the downtown spawn, live = after a forced GC:

| | before | after (last measured) |
|---|---|---|
| streamed boot, phone live (heap + GPU) | 1909 MB | 974 MB |
| streamed boot, load (first visit / return visit) | 17.4-18.8 s / - | 11.8-12.8 s / 10.7 s (build 5.5 s, terrain baked) |
| 60 s drive at 40 m/s, phone peak | 2108 MB | 1528 MB |
| drive pop-ins (objects appearing in view inside the fog) | 116-133 | 48, then the farcull fix |
| jail (unchanged) | 324 MB live, 4.5 s | same |

What changed, biggest first:
- **The prune judged local coordinates.** `slicePrune` and the manifest tracer called
  `updateMatrixWorld`, which `core/matrixskip.js` skips for the hidden city root, so every
  building was judged at its local bounds near the origin: downtown was parked as "725 m
  away" and re-attached. Both use `updateWorldMatrix(true, true)` now (-590 MB).
- **Landmass builders are per town** (minicities, countries), town parcels are data at once and
  shells when seen (child jobs), far generic mainland apartment blocks likewise, far metros
  are planned but not dressed, far parked cars are records until seen.
- **Jobs are freed, not just parked**: `runCaptured` records every list a job grows (CBZ and
  arena arrays, `CBZ.streamBus` module lists, placement via `CBZ.streamBusHook`) and
  `freeJob` takes it all back 700 m past the keep circle; world data (regions, roads, water)
  stays and is swapped on a re-run. Nested jobs (a town's parcels) go with their parent.
  `tools/stream-jobs-check.js` (plain node) checks build / free / re-run / nested.
- **The prison is not built in a city-first page** (`core/prisonlazy.js`, eager otherwise).
- **Leaks**: highway accumulators (113 MB), pruned LOS blockers, placement keys and refs.
- **One copy of static data**: terrain keeps only positions in JS after upload; building trim
  keeps its box list and writes vertices on first read, and the batch pass merges it straight
  from the boxes (no per-building arrays; `tools/trimbox-merge-check.js`); big canvas textures
  give their canvas back once on the GPU (`core/texfree.js`); a lean Object3D in the vendored
  three (matrices, up, uuid on first use: -53 MB of V8 in the city).
- **Terrain is baked once per version** into IndexedDB (`core/bakecache.js`): the continent
  plate (loop and finished passes), the backdrop, Mount Mercy, the Greater Range, the desert
  erg, the snow forest belts. `?bake=verify` recomputes and compares byte for byte;
  `?bake=0` turns it off.
- **Driving**: farcull evicts far merged meshes from the GPU; the keep circle is
  `0.3 r + view + speed lead`; the streamer ticks at 10 Hz and builds anything in sight at
  once, with a larger budget while something will come into sight.
- **No pop-ins**: parked and moving cars past their old 150 m cull are drawn by carinstances'
  pools out to the fog; farcull holds groups with no LOD stand-in to the fog's end.
- **Context loss**: the watchdog runs on a timer and reloads at the player's position if the
  context does not come back (or comes back with CPU copies released).
- Tools: speed.mjs `--heap-sites`, `--preload tools/preload/abtrack.js`, LIVE-after-GC
  memory, `--profile-dir`, `--ask prof`, `--ask drive [--allocs]`; `?debugInstanced=1` /
  `CBZ.drawCheckOn()` (core/drawcheck.js).

Still open: streaming is still behind `?stream=1`; the city core's shops, offices and
hideouts are built at boot; a building's LOD box stands in from 230 m on the phone (a swap
inside the fog); the drive's heap sawtooth (build garbage) sets the peak.

## Phone boot peak (2026-10-14, the "reloads at 100%" bug)

speed.mjs's PHONE TOTAL now adds the live 2D canvases (an iPhone kills the tab on the
sum of heap, GPU and canvases). One paired run, `--device phone --load --against 73c5e027`:

| MB | main | after |
|---|---|---|
| true phone peak (heap + GPU + canvases) | 1440 | 1366 |
| live after a GC | 1176 | 1092 |
| 2D canvases | 150 | 83 (68 live) |
| JS heap peak (V8 + ArrayBuffers) | 995 | 980 |
| GPU (drawing buffer 47 of it) | 298 | 305 |

What went: canvases painted at the boot for things nobody had looked at yet (the
speedway's surfaces, signs, skyline and car liveries, the agency's 10 MB newspaper,
the speedway ground, the fuel atlas, arena boards, package signs, plot signs) are
painted when first drawn; tattoo scratch canvases are freed when composited; the
road field's 16 MB float raster; metro_ground's 22 MB per-32-m floor index (two
levels now). MSAA was measured at the phone's 780x1688 buffer: off would save 37 MB
but changes 0.5-1.9 % of pixels by more than 8 levels (edges), so it stays.

Still over the ~800 MB target. What is left, largest first: ~160 MB of dead
ArrayBuffers the collector has not taken at the peak (batch merge positions freed
after upload, ped atlas readbacks, stream compaction); V8 300 MB live (structural
`lbox` meshes kept for LOS 22 MB, characters 22 MB, placement 16 MB); scene geometry
CPU arrays ~215 MB, mostly never uploaded (hidden originals for raycasts, packed
interiors, unmerged meshes out of view), only ~16 MB of it normal/colour/uv
duplicates of uploaded buffers.

## Phone boot peak, wave 2 (2026-10-14): what gets built or kept

One paired run, `--device phone --against 987f32e5 --pairs 2` (MB, per-run values
in brackets):

| MB | base 987f32e5 | after |
|---|---|---|
| true phone peak (heap + GPU + canvases) | 1357 [1344, 1357] | 1222 [1221, 1222] |
| JS heap peak | 977 | 846 |
| live after a GC (phone live) | 1086 | 1019 |
| 2D canvases | 88 | 83 |
| GPU | 299 | 297 |
| at the spawn, playing | 1114 | 1043 |

Split (single runs, same box): heap at the end of the load V8 368 + ArrayBuffers 575
before, V8 352 + 480 after; after a GC V8 301 + 414 before, 262 + 393 after.
ArrayBuffers ALLOCATED during the boot (abtrack): 662 MB before, ~520 after.

What changed, by the three questions:
- **Built but never drawn: rooms are recipes** (core/batch.js). The merged rooms
  (furniture behind windows: 105 buckets, 3.1 M vertices) were 41 MB of geometry
  never drawn at the boot, plus 42 MB of float garbage from baking them before
  packing. 84 % of their vertices are trim box lists (6 numbers a box), most of the
  rest shared unit boxes, so a room keeps per source its box list or shared
  geometry, its world matrix and tint (~9 MB for all), and is baked by the same
  bakeMergeV2 the frame it enters the view; unbuilt when left behind or disposed.
  Bit-identical to the direct bake (tools/room-recipe-check.js). An evicted room
  used to be marked dead by its own dispose and never came back; fixed with it.
- **Mesh-heavy to typed data**: city/placement.js is Float64 columns + an Int32
  linked cell list (was 38.6k reservation objects, 34k of them copies of colliders,
  and 200k cell refs under boxed-double cell keys: 20 MB of V8 to ~6;
  tools/placement-check.js checks it against brute force). city/buildings.js:
  `built.lbox` keeps makeBuilding's whole scope alive, so every per-box plane list
  in it (structural boxes, trim modules, veneer, deco: ~200k small arrays) lived
  for the shell's life; they are released after the build and `fixedPlanes` is
  kept only when asked (govcomplex's houseDress). The 79k trim records were held
  in a list read only for a count.
- **Garbage that stacked on the peak**: the road field rasterises straight into
  its bytes (16 MB float raster per build, kept alive by a closure context); a full
  ped atlas page is allocated on the GPU and the old rows copied in (16 MB CPU page
  per full page); a grasp's hand is keyed by its joints, not a random name (126
  identical steering-wheel hands, 11 MB); the metro far maps paint straight into
  their atlas (7 maps, 11 MB, plus the copy); the continent plate's carve keeps a
  typed index; the ground detail maps are packed one at a time.
- tools/speed.mjs: look shots frozen at different dynamic-resolution buffers are
  compared at the smaller one (was a false "LOOK REGRESSION: drawing buffer" and a
  crash in the report).

Look: downtown and aerial same look. The spawn (inside the exec office) was flagged:
1.4 % of its stable blocks changed against a floor of 0 % that the tool itself
calls biased low (2 base shots), at a spot where the two base runs already
disagreed on 30 % of the frame; the heat map is a uniform edge shift plus the
player's idle pose (sim timing), with the same furniture and walls.

What is left (V8 262 + ArrayBuffers 393 live, GPU 297, canvases 66-83), largest
first: the hidden wall originals kept as Meshes for LOS and collider refs (lbox,
23 MB V8 sampled; 24k hidden meshes, 37.5k collider objects with boxed doubles);
395 full character rigs at boot, 358 of them hidden behind ped instancing (~20 MB);
geometry built inside the keep circle but not yet in the frustum (~58 MB CPU, by
design: it uploads as the player turns); hidden-but-resident GPU buffers far
content (farcull's side); the GPU's textures (130 MB: the Halloran airfield
surface 4096x1024 is 21 MB, the full ped atlas page 21 MB).

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
