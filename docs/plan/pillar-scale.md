# PILLAR: SCALE — the honest path to a world that FEELS 10x

Design doc. No game code here. Every number was read out of the repo 2026-07-27 and is cited `file:line`; where I could not verify something I say so and tell the builder to measure before writing the literal.

Owner, verbatim: *"make cities 10x bigger with 10x more tall buildings and buildings that are even taller, but parking lots and parks and 1-2 story buildings are important too"* · *"10x bigger map, just scale the terrain, especially the sand area should be huge"* · *"the mountains should have white snow area all around them"*.

---

## 0. THE VERDICT

1. **The mainland "city" is 330 m across.** `N*BLK + ROAD = 6*52 + 18 = 330` (`city/world.js:54-66`, `config.js:246-248`). 36 blocks, **one building per block**, storeys clamped `min(12, …)` (`buildings.js:6226`) with exactly one hardcoded 52-storey exception (`makeMegaTower`, `buildings.js:5842-5843`). That is not a city needing 10x — it is a city needing a **generator**.
2. `makeBuilding` has **no storey ceiling**. The 12 is policy. The cheapest tall-building win in this repo is deleting a `Math.min`.
3. The good generator exists and the mainland bypasses it — PROCGEN.md §3 says so in its own diagnosis. `towngen.js` has recursive subdivision (`:355-373`), ring zoning (`:345-352`), per-template skylines (`citytemplates.js:61,95,129,161`), landmark caps (`:506-516`). **The unification is the whole city plan.**
4. **10x-linear is arithmetically dead.** Union 9496 u × 3.16 + 2 × margin → W ≈ 43,900 vs `W_ROOF = 15500` (`continent.js:449-450`) — and past the roof the continent build does `return`, i.e. **silently deletes the continent**. Plate cells 38 m → 98 m; desert cells 5.3 m → 33 m.
5. **10x-AREA (×3.16 linear) is survivable but is WAVE 2+**, and only with plate tiling, a clamp-instead-of-return roof, a derived margin and a k-scaled backdrop amplitude.
6. **The near wave needs no ceiling raise at all.** Mainland 6→11 blocks (330→590 u) costs 130 u of half-extent; walking every other landmass out by the same 130 keeps every strait. Union 9496→9756 ⇒ W = 14,156 with **1,344 u of roof headroom left**.
7. **The renderer, not the generator, is the ceiling.** Measured 2026-07-10: calm-t4 **2,668 draw calls**, static city ≈71% of them, verdict "safe headroom is mostly exhausted" — and that predates `WORLD_SCALE_V4`. A naive interior-LOD attempt once regressed draw calls **4.3x (2,752→14,539)** by fighting the batcher.
8. **The fix is one rule: THE FULL-DETAIL BUILDING COUNT IS A BUDGET, NOT A RADIUS.** `core/farcull.js:43-113` already carries unbounded far buildings in **one** InstancedMesh draw. Re-key its swap from `distance < R` to `rank < K` and a 10x skyline costs **zero** new draw calls. Under today's radius rule, 10x buildings inside a 500 u cull disc ≈ 10.5x detail set = the abort.
9. **`terrainRingRadii` (`terrain.js:130-146`) is the derivation template the terrain wave copies**: radii derive from FLAT via `k = near/1900`, and at `k ≤ 1` the authored numbers return byte-identically. The *amplitudes* do not follow k — that is the bug, and `TERRAIN_RING_AMP` (`terrain_overhaul.js:170`) is the dial that should have been `4.5 * k`.
10. **The snow model the owner asked for is already written and only paints.** `snowCover(y, slope, nx, nz, x, z)` (`terrain.js:337-351`) does altitude bands, angle-of-repose shedding, sun-aspect melt, hash patchiness. Promoting it to `CBZ.hasSnowCover(x,z)` is the whole ask.
11. **The snowline is already a fraction and nobody noticed.** `SNOW_WARM=380 / SNOW_COLD=720` (`terrain.js:332-333`) against the near ring's `peakAmp: 900` (`terrain.js:549`) is exactly **0.42 C / 0.80 C**. Derive it and the band follows any crest at any world scale, returning today's numbers exactly at today's crest.
12. **INFINITE-WORLD M0-M8 is 0% implemented and is not the answer to this ask.** Do not start it. Chunk-WINDOW the three linear scans on a named trigger (§6.5) — M5's *problem* without M0-M8's rewrite.

**Strategy blend.** C (LOD) is not a fallback, it is the enabling condition — it ships first, in wave 1, before one extra tower exists, or wave 1 is the 4.3x regression again. A (dials) carries every visible win: wave 1 grows the city inside today's ceilings, wave 2 raises the ceilings *by derivation*, wave 4 stamps more city sites. B starts on a **measurement**, never a schedule.

**What "10x" honestly means.** Three quantities get the same name: **10x buildings** (subdivision + block count; draw calls flat under a detail budget, colliders/build-ms linear) — AFFORDABLE, and it is the owner's headline. **10x area** (`SPREAD_V5` + `worldFoot`; costs terrain *resolution*, while `floorAt` stays 0.14 µs and scale-invariant) — AFFORDABLE at ×3.16 linear with plate tiling. **10x linear** — REFUSED. The sentence for the owner: *"10x the city, 10x the map's AREA. A map 10x across is 100x the world — 98-metre terrain steps and a two-minute drive between anything. You'd feel emptier, not bigger."* Building count is what "bigger" reads as at eye level; area is what it reads as from a plane. Buy both, in that order.

---

## 1. THE CITY — UNIFY THE MAINLAND ONTO towngen's GRAMMAR

### 1.1 The diagnosis, verified
`world.js:54-66` builds `N+1` grid lines, one lot per cell, and carves districts by a **3×3 quadrant test** (`districtQ`, `world.js:471-475` — it literally divides the grid into thirds). Height is `districtStoreys` (`buildings.js:6214-6226`): an `rng()` roll per district kind, `+coreBonus` (which already blends `city.landValue`, `world.js:740`), then `Math.min(12, …)`. `towngen.js` meanwhile subdivides recursively, zones by concentric ring, and reads a `skyline{minStoreys, maxStoreys, landmarkStoreys, towerFrac, megaChance}` recipe capped at `min(48, …)`. **The flagship city is the least capable generator in the codebase.**

### 1.2 The block: `CBZ.cityGridStamp(city, place)`
```
CBZ.cityGridStamp(city, { cx, cz, blocks, step, template, skyline, districts, rng })
  -> { lots, blocks, xLines, zLines }
```
Per Block Law. It **replaces code the caller writes anyway**: the grid-line loop, the per-block lot push, the district lookup, the storey roll. `world.js` keeps its ground/sidewalk/paint pass verbatim and stops owning the *parcelling*. Adoption is degrade-safe in the `prio.js` survival shape: `const G = CBZ.cityGridStamp ? CBZ.cityGridStamp(city, {…}) : <today's inline loop>;`

**Three consumers migrated in the same change** (80% of the work — budget for it): (1) `world.js`'s mainland grid; (2) `towngen.js`'s own `ringOf/zoneForRing/subdivide` path, which becomes the *implementation* rather than a sibling; (3) `city/expansion.js`'s commerce annex, whose ~20 hand-placed lots live on a separate `annex.lots` list that `farcull.js:66-74` had to be specially taught about. Output is the same `A.lots` record shape every downstream system already reads (farcull proxies, roadrules clearance, citystaff, gangs, Zillow), so nothing else changes.

### 1.3 The height policy — a TABLE, not a clamp
Delete `Math.min(12, …)`. Ring is `max(|i-ci|, |j-cj|)` — `towngen.js:345-347`'s own function, promoted and shared.

| ring band | parcels/block | build prob | storeys | reads as |
|---|---|---|---|---|
| 0 | 1 | 1.00 | **34-52** + flagship | the needle cluster |
| 1-2 | 1 | 0.95 | **20-34** | downtown core |
| 3-4 | 1-2 | 0.85 | 8-20 | midtown |
| 5-7 | 2-3 | 0.60 | 3-8 | mid-rise fabric |
| 8+ | 3-6 | `max(0.18, d*0.72^ring)` | **1-2** | the owner's low-rise |

**The low-rise clause is protected by CONSTRUCTION, not taste.** `parkFrac 0.08` / `abandonedFrac 0.36` stay *fractions*, so parks and vacant lots grow with the city automatically. Add **`parkingFrac`** on the same footing so surface parking is a first-class parcel kind, not the absence of a building. Ratchet the *shape*: `cityGridAudit().lowRiseFrac` and `.parkFrac` have **floors** (may only go UP or hold) — that is what stops a future "make it taller" wave from quietly deleting the two-storey city.

**A CLUSTER, NEVER A NEEDLE.** `towngen.js:510` already encodes this (`wantsTall` requires ≥8 related towers before any landmark). The mainland inherits it. One 52-storey tower alone in a low-rise field is the *current* mainland, and it is exactly what does not read as a city.

### 1.4 Wave-1 sizing arithmetic (do this before writing any number)
`blocks: 6 → 11` ⇒ span `11*52 + 18 = 590 u` (×1.79 linear, ×3.2 area); half-extent `165 → 295`, **Δ = 130 u**. Parcel estimate under §1.3: ring0-2 ≈ 25×1×0.97 ≈ 24 · ring3-4 ≈ 32×1.5×0.85 ≈ 41 · ring5 ≈ 64×2.5×0.60 ≈ 96 ⇒ **≈160-230 mainland lots vs 36 today (4.5-6.4x)**, downtown 3-4x taller. *That is an estimate from the table, not a promise* — print `cityGridAudit().byRing`, tune `blocks` and per-ring parcel depth until the count lands in band, THEN recalibrate GOLDEN.

**The layout must absorb Δ, not eat it.** Grow the rect and let the ring walk outward (CLAUDE.md's own method, and why the V3 re-lay worked): every landmass in `SPREAD_V5` moves out by the same 130 u along its bearing, so **no strait narrows**. Union 9496→9756 ⇒ `W = 9756 + 2*2200 = 14,156` vs `W_ROOF 15500`. **Fits with 1,344 u spare — no ceiling is touched in wave 1.**

### 1.5 THE DRAW-CALL BUDGET — the hard constraint
Ground truth (measured 2026-07-10, pre-V4): calm-t4 **2,668** draw calls after LOS-grid + matrix-freeze + BatchV2 (tris 2.01M→1.23M); static city ≈**71%**; 19.5k unique materials pre-merge.

**THE LAW FOR EVERY WAVE: the detail set is a COUNT, not a radius.**
- `farcull.js`'s `updateProxy(A, P, R)` swaps on `enter = R - 20`, `R` = the tier's `cull` (230..700, `quality.js:65-73`). Change to: sort proxy records by distance (the loop already computes it), hold the nearest **K** as full shells, proxy the rest. `K` joins the tier table beside `cull`, seeded at **today's measured detail set** so wave 1 ships at wave 0's cost.
- **A tower past K costs one instance in an existing InstancedMesh = ZERO new draw calls.** That is the entire reason 10x towers is affordable.
- `GLASS_SECT = 320` (`buildings.js:193`) becomes **derived from the detail radius**: hold the number of glass sectors *inside the detail set* constant, so a 10x city does not linearly multiply glass pools. (At tier 4, `cull 500`, 320 is already about right — write the arithmetic in the comment so the next scale wave need not re-measure.)
- `batch.js`'s `TILE = 112` (`:104`) already tiles with per-tile bounding spheres and scales by construction. **Do not touch it.**
- **NEVER LOD a sub-mesh.** `farcull.js:16-30`'s safety rules exist because the batcher owns merged buffers. Swaps operate on whole top-level groups only — that is what the 4.3x regression violated.

**How it is MEASURED.** The math gate never renders, so the ratchet is a **static predictor**, not `renderer.info`:
- **`CBZ.drawBudgetAudit({x, z, tier})`** — walks `city.root` applying the same visibility rules farcull/batch use, counts InstancedMesh as 1, returns `{detailSet, proxied, predictedCalls, glassSectors, batchTiles}`. Headless, milliseconds, pins in the gate.
- **`predictedCalls` is a CEILING ratchet — a new kind here.** Every other ratchet in this repo may only go DOWN because it counts duplication; this one may only go down *or hold* because it counts cost. Say so in the CLAUDE.md entry or someone will "fix" it by raising the pin.
- **Confirmation once per wave, not per change:** `tools/smoke-play.mjs` is the only gate on the real render path. Have it print `CBZ.renderer.info.render.calls` beside the predictor and fail if they disagree by >15%. `core/profile.js:71` already reads that field — reuse it.
- **NOT YET MEASURED.** Whoever runs it first writes the number in. Do not repeat the `propUseAudit` mistake (it sat for weeks instructing people to pin `blocked` at 0; the first real run read **487**).

### 1.6 The costs that DO scale linearly
- **Colliders scale with total STOREYS, not buildings** — per-storey loops at `buildings.js:3296, 3350, 3457, 3524, 6809, 6903, 7371` (floor tops, stairs, belts, unit tables). ≈216 storey-units today; wave-1 city ≈1,400-2,000. The 8 u bucket grid (`physics.js:30`) keeps *queries* O(1), so this is **build-time and memory**, not frame cost. Print `buildMs` and `colliders` per wave; if build time crosses the §6.5 trigger, interior collider construction becomes budgeted (nearest-N enterable) rather than universal.
- **Crowd caps are fixed TOTALS, not densities** — `crowd: 700` (`config.js:259`), `CROWD_RIG_CAP: 1600` (`config.js:196`), `quality.js`'s per-tier `crowd: 180..1000`. **10x area with fixed totals = ghost town.** Not my territory — see §5.1.
- **Nav/road scans are global** — `citynav`, `findRoad`, `nearestIntersection` (`world.js:582`). Fine at 36 lots; a §6.5 trigger at 10x.

---

## 2. THE TERRAIN — WHICH CEILINGS RISE, AND BY WHAT DERIVATION

### 2.1 The derivation discipline (binding on §2)
**Grow the RECT and let everything keyed off it walk outward; never re-engineer a working law.** `terrainRingRadii` (`terrain.js:130-146`) is the template — radii derive from FLAT, ratios preserved through `k`, and `k ≤ 1` returns the authored constants **byte-identically** so flag-off is provable. Every constant below becomes `authored × f(measured)` with `f = 1` at today's world, and **carries its arithmetic in the comment** showing the two edges it was solved between. `highwaynet.js:164-178` is the good comment even though its numbers are literals — keep comments of that shape, delete the literals (§2.4).

### 2.2 The ceiling table

| ceiling | now | wave | change | derivation |
|---|---|---|---|---|
| `W_ROOF` `continent.js:449-450` | 15500 then **`return`** | **1** | **never `return` — clamp `PAD` down, `console.error`, continue**; raise to 40000 | Its own comment says it is "a sanity roof, NOT a design constraint". Vertex count is `(SEG+1)²` *regardless of W*, so a wide plate costs resolution, never memory — there is nothing to protect by deleting the continent. Making the failure **loud and non-fatal** is worth more than any number, permanently. |
| `PLATE_SEG` cap 448 `continent.js:734` | 368, 38 m cells | **2** | **tile the plate** `T×T` sub-plates, each ≤448 seg, each with its own bounding sphere | Cell is already the constant and segments follow — keep that. At ×3.16, holding 38 m needs 1155 seg (1.3M verts) in one draw. Tiling holds the cell AND fixes a live defect: today the continent is ONE draw with one bounding sphere and is therefore **never frustum-culled**; 4×4 tiles ⇒ typically 4-6 submitted. `BUILT_FLAT` derives from `W/PLATE_SEG` and is unchanged per-tile. Flag `TERRAIN_PLATE_TILES`. |
| desert `GSEG` cap 264 `biome_desert.js:560-561` | 5.3 × 5.7 m cells | **2** | tile the bake 3×3 at the existing cap | Its comment states the cap is a **vertex budget** — 5 field evals per vertex. Tiling keeps 5 m dunes over 9 cullable draws. **Print bake ms**: 5 × 70k × 9 = 3.1M evals is the number to watch. |
| `CONTINENT_COUNTRY_MARGIN` clamp 2400 `continent.js:431` | 2200 | **2** | `margin = clamp(1200, 0.46 × halfExtent, 6000)` | `2200 / 4748 = 0.463` — **today's value already IS a fraction of today's half-extent**, so the fraction reproduces stage 4 exactly and scales after. |
| `TERRAIN_RING_AMP` 4.5 `terrain_overhaul.js:170` | literal | **2** | `4.5 × k`, `k` from `terrainRingRadii` | Apparent height ∝ height/distance; radii already scale by `k` so amplitude must too, or the backdrop shrinks as the world grows. **The existing gate-safety proof survives untouched**: the multiply runs through `CBZ.mtnHiGate` (`terrain_overhaul.js:889-894`), which leaves samples ≤45 u alone and keeps anything already >25 u above it — so `mountainsOutsideSnow` / `cityOnMountain` counts are provably unchanged **at any k**. |
| `HILL_AMP` 46 `terrain.js:212` / 60 `terrain_overhaul.js:384` | walkable backcountry | — | **DO NOT SCALE** | They live under `RIM_CEIL = 23` (`continent.js:702`), strictly under the 25 u doctrine line, which makes a mountains-outside-snow cell impossible *by construction*. Scaling them breaks the gate arithmetically. **Hills do not scale; the backdrop does.** |
| `RIM_CEIL` 23 `continent.js:702` | hard | **3** | selective lift gated on snow cover (§3.4) | Only after `hasSnowCover` exists. |
| `backdropAudit().onPlate` | pinned **0** | all | preserve | Grow the plate and the offshore range can become reachable. Re-measure the plate's real reach; do not assume — the last fix found 4410 m where 2320 was assumed. |

### 2.3 The huge desert, specifically
The owner named it. Its foot scale is already the largest (`worldFoot` desert 1.60, `layout.js`). (1) Scale the foot to **~2.6-3.0** — the largest single-biome bump in wave 2. (2) **Tile the bake** so cells hold near 5 m: a desert is a *silhouette* biome and dune crests read as ramps past ~12 m cells, which is what a naive scale produces (33 m at 10x-linear). (3) **Emptiness is the feature.** A huge desert with three things in it is correct — and it is the cheapest 10x on the map: near-zero buildings, near-zero colliders, one ground bake, one wildlife share. **Spend the area budget here first; it buys the most "bigger" per draw call of anything in the world.** (4) `DESERT_DUNES_V3` shipped hours ago — scale its footprint, let it re-derive, do not fight it. (5) If it later outgrows a tiled bake, the answer is a **player-centred high-res clipmap patch** (1 m dunes underfoot at constant cost). Name it; do not build it yet.

### 2.4 THE HIGHWAYNET LITERALS — end the treadmill permanently
**The fault.** `highwaynet.js:154-178` holds **seven raw free-country lane constants** (`timberX -560`, `corridorZ -1600`, `westX -2380`, `southZ 1650`, `eastX 3700`, `foothillZ -3400`, `dunesX 1300`) plus an eighth (R5's dog-leg) and R7's crossing z. Every DOCK in that file derives from `CBZ.worldOff` and followed its landmass; **these did not.** They have been hand re-measured **twice** and the file's own comment predicts the third. `clearanceSweep` (`:330-390`) detects the breakage and, on its non-`roadClearance` path, only `console.warn`s — which is how Route 1 silently ran through Fort Brandt, the Saltlands and Coyle Valley for months.

**The permanent fix, and why it is cheap.** `routeTable()` is called *inside* the order-91 `addLandmass` callback (`highwaynet.js:398-402`) — **after every landmass (≤35) has registered its region**, with `city` in scope one line away; `clearanceSweep` already reads `city.regions` at `:331`. **The data needed to derive all seven has always been in scope at the moment they were typed.** Nobody had asked for it — exactly as nobody had queried `city.roads` before `roadSegmentAt`.

**The block:** `CBZ.roadCorridorMid(city, axis, {from, to, span, cls}) -> {v, gapLo, gapHi, clear}` — "the coordinate of the widest free lane on `axis` between the footprints bounding this corridor". Implementation is a 1-D interval sweep: project every non-`underlay`, non-link region AABB onto the axis over the `span` window, merge, return the **midpoint of the widest gap** and its clearance. That midpoint rule is what the current comment says it was aiming for by hand (*"a lane is chosen as the MIDPOINT of the corridor … so the next world move has the largest possible margin"*) — it just was never computed. `routeTable()` then reads it instead of `timberX`, and **the network follows any future world move for free**, which is what the file header (`:19`) already claims it does.

Degrade-safe: `CBZ.roadCorridorMid ? mid.v : <today's literal>` — literals stay as the documented fallback, the `playergang.js:651` pattern CLAUDE.md praises. Second and third consumers in the same change: `minicities.js`'s auto-derived causeway/road link and `govcomplex.js`'s access-road placer, both of which currently hunt for free land with their own logic. **`clearanceSweep` stops warning and starts FAILING** — a warn-only law is not a law, and this one was true and ignored for months. Ratchet: **`CBZ.highwayDeriveAudit()` → `{lanes, derived, literal, minClearance}`; `literal` pinned at 7, may only go DOWN to 0; `minClearance` a hard floor at 40 m** (the file's own stated contract), measured after the build.

### 2.5 What is already scale-safe — do not touch
`floorAt` (0.14 µs, analytic, scale-invariant) · `TERRAIN_FLATTEN_UNDER_BUILT`'s band, which derives from `PLATE_SEG` and self-widens (`continent.js:736`) · `parkFrac`/`abandonedFrac` · `batch.js` TILE buckets · `roadJunctions`. Say so in the wave brief: half of scaling well is a list of things you did not touch.

---

## 3. SNOW AROUND THE MOUNTAINS

### 3.1 What exists and what it is wired to
`terrain.js:337-351` returns 0..1 from altitude `smooth(SNOW_WARM 380, SNOW_COLD 720, y)` × angle-of-repose shedding `1 - smooth(0.42, 0.74, slope)` (~25°→45°) × sun-aspect melt against `SUN_AZ (-0.38, 0.92)` × deterministic hash patchiness (`hash01(x,z,0x5107)` — correctly never `Math.random`; it is a build path). **This is precisely the owner's model.** Its only consumer is `bandColor` — the decorative backdrop's vertex colours.

The *real* snow rule is **containment**: one snow rect gates `snowSector` (`terrain_overhaul.js:447-455`), `RIM_CEIL = 23` makes non-snow mountains impossible by construction, and `cityBiomeAt` (`worldmap.js:466-490`) is region membership plus an organic blend. The gate asks: for every cell with `h > 25`, is `biomeAt === "snow"`? (`math-gate.mjs:170,177`, `MTN_OUT_SNOW_MAX = 60`). **So today "snow" means "inside the snow rectangle", and the owner is asking for "snow wherever a mountain is".** Different sentences — and the second is already implemented in a function that only paints.

### 3.2 The promotion
**`CBZ.hasSnowCover(x, z) -> 0..1`** — the ONE answer to "is there snow on the ground here". Sample the live height oracle and its normal (central difference, the same 4-tap the desert bake uses) and call the existing `snowCover` **unchanged — do not rewrite the model**. Export from `world/terrain.js` (the real game file, not a tool). Flag `SNOW_COVER_FIELD`.

**Make the snowline a fraction, not a literal.** `380/900 = 0.422` and `720/900 = 0.800` against `peakAmp: 900` (`terrain.js:549`) — the current pair **already is** "a third to a half of the way up with a long ragged transition", which is what its own comment claims (`terrain.js:329-331`). Derive `SNOW_WARM = 0.42 C`, `SNOW_COLD = 0.80 C` from the local crest `C`; today's world returns byte-identical numbers. The retired 46/96 pair does *not* satisfy the fractions — evidence the fraction rule is the law and the old pair was the bug it was written to fix. **Without this, wave 2's k-scaled `TERRAIN_RING_AMP` re-creates the exact bleaching the model exists to prevent: every peak white again, just bigger.**

### 3.3 Adoption (≥3 consumers, same change)
(1) `terrain_overhaul.js`'s colour ramp reads the shared field instead of its own snowline (`:900-903`). (2) `city/biome_snow.js:2255` and `city/snowboard.js:42-43` both ask `cityBiomeAt(...) === "snow"` — i.e. "am I inside the rectangle" — and should ask "is there snow under me": a north-facing 600 u shoulder outside the rect is snow, a sunny valley floor inside it is not. (3) `vehicles.js:2218`'s `biomeSurface` (grip) — the strongest proof the field is *real to the game* rather than paint: **the road is slippery where the snow actually lies.**

### 3.4 REDEFINING THE GATE INVARIANT WITHOUT WEAKENING IT
**The intent behind `MTN_OUT_SNOW_MAX` was never "mountains live in a rectangle" — it was "you never see a bare mountain".** So:
- **New primary invariant: `mtnUncovered`** = cells with `h > MTN` where `hasSnowCover(x,z) < 0.15`. **Pinned at 0 — a hard zero, stricter than today's ≤60.**
- **`mtnOutSnow` keeps being computed and PRINTED beside it**, and stops being the failing condition. It will legitimately rise as mountains are allowed outside the rectangle, and it must stay visible so a "fix" that merely moves the rectangle cannot hide anything. `CBZ.snowCoverAudit()` → `{mtnCells, covered, uncovered, mtnOutSnow, snowlineFrac}`.
- **Why this is not a weakening** (put this in the commit message): the old gate could pass a mountain inside the snow rect that is drawn bare — it never looked at the ground. The new one cannot. Every cell the old gate accepted for the right reason (a white peak) the new one also accepts; every cell it accepted for the wrong reason (in-rect and bare) the new one rejects. The accepted set **shrinks on the failure axis and grows only where the owner explicitly asked.**
- **Sequencing rule: land `hasSnowCover` + the redefined gate BEFORE `RIM_CEIL` moves a millimetre.** A selective ceiling lift under the old containment invariant is exactly how you get a green mountain.

### 3.5 RIM_CEIL — the selective lift (wave 3, flagged, measured)
Owner: *"the mountains should be on all snowy area and should be on the edges of the map with just small cities"* — a licence for the rim swell to become a real range **provided it carries snow**. Order of operations at `continent.js:700-712`, and it must be exactly this: (1) compute the **uncapped** rim height `h*`; (2) evaluate `snowCover(h*, slope, aspect, x, z)`; (3) `h_final = (cover ≥ thr) ? h* : min(h*, RIM_CEIL)`. Well-defined because the clamp only lowers and `snowCover` is monotone in `y`: an uncapped peak keeps its cover, a capped hill lands at 23 u — far below `SNOW_WARM` — and is correctly bare. **The scales do not currently meet** (23 u vs a 380 u snowline), so this is not a tweak: it means the rim relief genuinely becomes 400-900 u mountains on the map edges. Flag `TERRAIN_RIM_RANGE`; measure against `cityOnMountain` (must stay 0 — rim towns sit in the *gaps*, and `skylineForPlace` already bends silhouette without touching footprint) and `backdropAudit().onPlate`.

---

## 4. HOW THE OTHER BLOCKS FEED ME — AND WHAT I OWE THEM

### 4.1 The witness / virtual-existence block is my budget partner
Their recon is the other half of this pillar: **a 10x world with 10x live entities does not run; a 10x world with virtual population does.** `npcTransitionSafe` (`config.js:914-952`) is already the one shared unseen contract with 9 consumers; `schedule.js`'s ledger (`:255-401`) already banks a person and re-deals them; `cityIdentities` already round-trips through save. The population answer is *their* block and I must not write a second one.

**WHAT I NEED FROM THEM — cite this line:**
> **A POPULATION CAP IS A DENSITY, NOT A TOTAL.** `crowd: 700` (`config.js:259`), `CROWD_RIG_CAP: 1600` (`config.js:196`), `quality.js`'s per-tier `crowd: 180..1000` and `traffic.js`'s `computeTarget()` are fixed totals. A ×3.2-area city with the same totals is a **ghost town** — the same crowd spread over three times the pavement. They must key on **local density near the camera** (traffic's `computeTarget` already does this correctly — copy it), never on world size, so the rig budget stays flat while the world grows.

**WHAT I OWE THEM — cite this:**
> **`CBZ.worldSpan()`** (live world extent) and **`CBZ.cityGridAudit().lots`** (live parcel count). Any density that needs to know how big the world got reads these; nothing re-derives a world size from a literal again. Scale waves move them and every consumer follows for free.

### 4.2 The aviation pillar anchors my new city sites
`island_airport.js` is one hardcoded closure; `minicities.js:60-67`'s `PLACEMENTS` table is the proven "N of a templated venue from a data table" pattern. When they turn the airport into `buildAirport(city, place)`, **each airport becomes a city seed** — an airport outside a city is the most legible reason for a settlement to exist, and it arrives with a keep-out, a causeway, a road record and a region already.

**WHAT I OWE THEM — cite this:**
> **`CBZ.cityGridStamp(city, place)` stamps a full settlement** — grid, ring zoning, height policy, parks, parking, low-rise — from one placement record. An airport that wants a town beside it publishes an anchor rect and calls it. **Do not author a second town generator.**

**WHAT I NEED FROM THEM:** publish each airport's **landside anchor rect and keep-out** as data on the placement record, so `cityGridStamp` can site a grid against it without overlapping (`roadClearanceAudit().violations` stays 0) and without guessing.

### 4.3 The flag census feeds my revert story
549 flags, 19 default-off, and **no default-false flag builds meshes or colliders while off**. That is what makes the flag-per-wave plan honest: every wave below is a genuine one-line revert, and the idiom is already clean.

---

## 5. WAVE SEQUENCING

Disjoint file territories — one owner per file per wave. Builders build and read; the orchestrator runs the gate once on merged state.

### WAVE 1 — "THE CITY GROWS, THE RENDERER DOESN'T" *(playable next build)*
**Territory:** `core/farcull.js`, `core/quality.js` (K column only), `city/world.js`, `city/buildings.js` (`districtStoreys`, `GLASS_SECT`), `city/towngen.js`, `city/expansion.js`, `config.js`, `world/layout.js` (`SPREAD_V5`, +130 u radial only).
**Flags:** `LOD_DETAIL_BUDGET` · `CITY_GRID_UNIFIED` · `CITY_HEIGHT_POLICY` · `WORLD_SCALE_V5`.
**Order inside the wave is not negotiable:** the LOD budget lands and is measured **before** one extra tower exists.
**Ratchets:** `CBZ.drawBudgetAudit()` (`predictedCalls`, ceiling — measure and pin) · `CBZ.cityGridAudit()` (`bespokeGrids` 1→0; `lowRiseFrac`/`parkFrac` floors).
**RECALIBRATE deliberately (`--calibrate`):** GOLDEN `lots` 325/335, `shops` 178/192 (`math-gate.mjs:50-54`) — these *must* move; that is the point of the wave. `roads` may move if the grid adds lines.
**PRESERVE:** `cityOnMountain` 0 · `mtnOutSnow` ≤ 60 · region overlaps 0 · shop-door reachability (0 orphans) · determinism (byte-identical re-run + biome histogram) · `roadClearanceAudit().violations` 0 / `propsInside` 15 / `zoneCrossings` 1 · `roadTrafficAudit().trespassing`/`onWater` 0 · `govComplexAudit().overlaps`/`roadless` 0 · `backdropAudit().onPlate` 0 · `arenaAudit()` and `cityCrowdSpawnAudit().spawnsInView` 0.
**Watch:** `worldLayoutAudit()` minimum strait must not shrink (the +130 radial walk is what protects it) · build ms · collider count.

### WAVE 2 — "THE MAP GROWS"
**Territory:** `city/continent.js`, `world/terrain.js`, `world/terrain_overhaul.js`, `city/biome_desert.js`, `world/layout.js` (`worldFoot` scales + full `SPREAD_V5`), `city/highwaynet.js`, `city/roadrules.js` (+`roadCorridorMid`).
**Flags:** `TERRAIN_PLATE_TILES` · `DESERT_BAKE_TILES` · `TERRAIN_MARGIN_FRAC` · `TERRAIN_RING_AMP_K` · `HIGHWAY_LANES_DERIVED` · `WORLD_SCALE_V5` turned up.
**Ratchets:** `CBZ.terrainCeilingAudit()` → `{plateCells, desertCells, wRoofHeadroom, marginFrac, ringK, ampK, clampedCeilings}` — `clampedCeilings` (ceilings that BOUND rather than derive) may only go DOWN; `wRoofHeadroom` must be > 0 (hard) · `CBZ.highwayDeriveAudit().literal` 7→0, `minClearance` ≥ 40.
**RECALIBRATE:** biome histogram (cell counts change with area — expected). `MTN_OUT_SNOW_MAX` *may* need re-measuring against the k-scaled backdrop, but **only if `mtnHiGate` fails to hold it** — the gate-safety proof says it should not, so movement here is **a red flag to investigate, not a number to bump.**
**PRESERVE:** all of wave 1's list, plus `groundMatchAudit()` `maxErr` / `ungated` — plate tiling changes how the physics floor samples the drawn plate, so this is **the invariant most at risk** and must be measured per-tile · `backdropAudit().onPlate` 0 (**most likely to break**; re-measure the plate's true reach, never assume).

### WAVE 3 — "SNOW WHEREVER A MOUNTAIN IS"
**Territory:** `world/terrain.js` (`hasSnowCover` + fraction snowline), `world/terrain_overhaul.js` (ramp adoption), `city/continent.js` (`RIM_CEIL` selective lift), `city/biome_snow.js` + `city/snowboard.js` + `city/vehicles.js` (the three consumers), `tools/math-gate.mjs` (invariant swap).
**Flags:** `SNOW_COVER_FIELD` · `SNOW_LINE_FRAC` · `TERRAIN_RIM_RANGE`.
**Ratchets:** `CBZ.snowCoverAudit()` — `uncovered` pinned **0**, with `mtnOutSnow` printed beside it forever.
**RECALIBRATE:** the mountains-outside-snow invariant is **redefined** per §3.4 — `mtnUncovered` becomes the failing condition, `mtnOutSnow` becomes a printed census. Land the redefinition **before** `RIM_CEIL` moves.
**PRESERVE:** `cityOnMountain` **0** (the invariant rim ranges threaten) · determinism (`snowCover` uses `hash01` — keep it) · `backdropAudit().onPlate` 0.

### WAVE 4 — "MORE THAN ONE CITY"
**Territory:** `city/minicities.js`, `city/citytemplates.js`, the aviation pillar's placement records, `world/layout.js`. Uses `cityGridStamp` with per-site `blocks`/`skyline`. **This is where "10x cities" plural actually lands** — one 590 u mainland plus several real settlements reads bigger than one 1043 u mainland.
**RECALIBRATE:** GOLDEN again · `BIOMES_ALL` (`math-gate.mjs:48`) grows per new settlement.
**PRESERVE:** the full wave-1 list, especially region overlaps 0 and `roadClearanceAudit()`.

### WAVE 5 — B, AND ONLY ON A TRIGGER
**Do not start M0-M8.** Start the *windowing* half when a **measured** trigger fires, named in the wave brief: world build > **8 s** · colliders > **40k** · the three global linear scans together > **0.5 ms/frame** · heap growth that closes the tab on a mid-range machine. Then take **M5's problem without M0-M8's rewrite**: bucket roads/lots/intersections into the 8 u grid that already exists (`physics.js:30`) and window the scans. Days, not the 13-20 person-weeks the milestone set sums to. Full chunked-infinite is a rewrite the owner has not asked for; "constant cost regardless of size" is the only part we want, and windowing delivers it.

### What I am deliberately NOT doing
Not raising `W_ROOF` to a bigger literal (loud + non-fatal beats any number) · not scaling `HILL_AMP`/`RIM_CEIL` in wave 2 (they hold a gate that works; hills wait for snow) · not re-engineering `snowCover`, `mtnHiGate`, `terrainRingRadii`, `TERRAIN_FLATTEN_UNDER_BUILT` or `batch.js` · not adding a second town generator, population system or LOD path (three blocks here died of exactly that) · **not pinning a single unmeasured ratchet** — `drawBudgetAudit`, `cityGridAudit`, `terrainCeilingAudit`, `snowCoverAudit` and `highwayDeriveAudit` all ship **reporting, not failing**, and whoever runs each first writes its number into CLAUDE.md.

---

## 6. THE FIVE CONTRACT LINES OTHER PILLARS MAY CITE

1. **`CBZ.cityGridStamp(city, place)`** — ONE settlement generator: grid, ring zoning, recursive parcelling, height policy, parks, parking, low-rise. Mainland, minicities and any airport-anchored town all call it. Degrade-safe; the caller's old inline loop is the fallback. **Never author a second one.**
2. **`CBZ.cityDetailBudget()`** — the K nearest buildings held at full detail. **Anything that adds geometry to a lot registers through it or rides the instanced proxy.** A tower past K costs zero draw calls; a system that ignores this costs the frame.
3. **`CBZ.hasSnowCover(x, z) → 0..1`** — the ONE answer to "is there snow on the ground here", for grip, weather, wildlife, tracks, snowboarding, tint and the gate. Never re-derive it from a region name again.
4. **`CBZ.worldSpan()`** — the live world extent. Any density, cap, radius or placement that needs to know how big the world got reads this instead of typing a literal.
5. **`CBZ.roadCorridorMid(city, axis, opts)`** — the derived midpoint of the widest free lane between registered places. Kills the highwaynet re-measure treadmill and serves every future cross-country route, access road and link. The data was always in scope; nobody had asked for it.
