# Holes in the ground from first principles

Written after the sinkhole pass (`src/world/groundshaft.js`, `npm run test:sinkhole`),
because "make a real hole" keeps getting estimated as one job when it is three, with
wildly different costs. Every number here was measured in the running game, not
reasoned about.

## The one-sentence problem

**The ground in this engine has no way to express absence.** Everything else follows.

## What "the ground" actually is

Measured, per mode:

| | survival island | Gang City |
|---|---|---|
| main surface | `CircleGeometry(R, 64)` — 64 triangles | `PlaneGeometry(spanX+58, spanZ+58)` with **no segment args**: 388 × 388 m as **2 triangles** |
| other surfaces at grade | beach disc, seabed ring, ocean plane at y=-0.8, roads, pads | lane paint, kerbs, lot slabs, pads, sea |
| measured surfaces over ONE 11 m mouth | 8–26 | **124–172** |
| height source | `groundHeightAt` (analytic) | `CBZ.floorAt` |
| shadows | `receiveShadow` only | `receiveShadow` only |

Two facts from that table do most of the work below.

**The city floor is two triangles.** "Retopologise the ground to cut a hole" means
first subdividing a 388 m quad, then cutting ~150 *other* independently authored
meshes that happen to overlap the same spot, none of which share topology with it.
Cost scales with authored surface count, not with hole count.

**The ground never casts shadows.** The single biggest correctness argument for real
geometry — "a masked hole still casts a solid shadow" — does not apply here. We get to
skip the expensive fix without paying its usual price.

## The three jobs people call one job

- **Job A — the ground must stop being DRAWN** over the void. Visual.
- **Job B — the ground must stop being STOOD ON**, at more than one height per (x,z). Physics.
- **Job C — the ground must be a VOLUME** you can arbitrarily subtract from. Representation.

A sinkhole = A + single-valued B. A basement or tunnel = A + **multi-valued** B.
Free-form digging = C, which is a different game. Conflating them is the whole reason
this sounds enormous.

## Job B is the deep one, and the engine is closer than it looks

`src/systems/physics.js:1038`:

```js
function groundAt(x, z, fromY) {
  let best = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
  ...  if (top <= reach && top > best) best = top;   // reach = fromY + STEP_UP (0.45)
```

Read that carefully. Platforms are **selected by the querier's own y** — that is already
"many surfaces at one (x,z), pick the right one", and it is how every building storey
works. Colliders are **already y-banded** (`y0`/`y1`, `physics.js:227`), so the *walls*
of an underground room are already expressible; bunkers already y-gate a *ceiling*
collider.

The only missing primitive is a walkable surface **below** the terrain field, because
platforms can only ever raise `best`.

`src/city/bunkers.js:19` records the prior ruling:

> player support is max(terrain, platforms), so nothing can ever WALK below the terrain
> field. […] A literal y<terrain dig would fight groundAt, floorAt, swim, nav and every
> spawn clamp at once — rejected on engineering grounds, recorded here.

**`groundshaft.js` is the counter-example, and it is worth being precise about why.** It
*does* put you 46 m below grade, and it needed exactly one seam: wrapping `CBZ.floorAt`
so the base itself is lower. It does not fight `max()`; it changes what `max()` starts
from. That works because a pit is still **single-valued** — one floor per (x,z).

So the real boundary is not "underground: yes/no". It is:

| shape | single-valued height? | works today |
|---|---|---|
| pit, crater, sinkhole, quarry, open trench | yes | **yes** |
| basement, tunnel, cave, overhang, bridge underside | no | no |
| free-form digging | no, and dynamic | no |

## Job A: four ways, and one of them is proven

**A1 — per-material shader discard (what ships today).** The discard is fine. The
**discovery** is the flaw: a downward raycast plus a footprint box sweep to find which
materials to patch. All three shipped sinkhole bugs were discovery bugs — the city's
Sprites made the cameraless raycast throw and killed the sweep; the sweep only ever ran
at the first plug's half radius; the slots were filled in creation order. Discovery is
also a fixed cost per hole and a permanent source of "a surface we didn't find".

**A2 — one global `ShaderChunk` patch. Prototyped and confirmed working.**
`src/core/renderer.js:153 installFog` already rewrites `THREE.ShaderChunk.fog_*`
globally for height fog, so the technique is established in this codebase. Applied to
holes it deletes discovery outright.

Two findings from the prototype, both load-bearing:

1. **Order matters, and failure is silent.** `renderer.js:372` does
   `THREE.ShaderChunk.fog_fragment = body.join("\n")` — a wholesale replace. Patching
   the chunk *before* `core/renderer.js` runs is discarded without error; the first
   prototype produced no hole at all for exactly this reason. The patch must install
   **after** `CBZ.renderer` exists. A second owner of these chunks must cooperate with
   `installFog`, not race it.

2. **The shared uniform survives cloning if the value is an ARRAY.** r128 builds each
   built-in material's uniforms with `UniformsUtils.clone()`, which does
   `property.clone()` for a `Vector4` (so a lone Vector4 is copied per material and a
   shared write never lands) but `property.slice()` for an Array — a shallow copy whose
   **elements stay shared**. So `uHoles: { value: [Vector4, Vector4, …] }` written into
   `THREE.ShaderLib[*].uniforms` reaches every material and stays live. 17 ShaderLib
   entries, one assignment each.

   (`UniformsLib.fog` is the wrong hook — `ShaderLib` merged it at module init, before
   any of our code runs.)

Result, measured: two independent holes, moved at runtime, cutting island grass, beach
and roads, with the towers and the mountain left standing — **zero raycasts, zero box
sweeps, zero `maskedSites`, zero `onBeforeCompile`.** The y-bound in the shader
(`vHW.y < H.w`) does the "flat surfaces only" filtering that discovery was doing, for
free and without ever being wrong about it.

Honest costs: still a fixed array length (but now one array in one place, not a shader
string baked per material); the test runs in every fogged fragment in the game (an
`if (H.z <= 0.0) break;` makes it ~one compare when no holes exist); and the 24
`fog: false` materials in the tree are not covered by the fog chunk.

**A3 — stencil.** `renderer.js:378` says `stencil: false, // we never use the stencil
buffer`, a deliberate choice, and `renderer.js:5` says "There is no EffectComposer in
this project and there is not going to be". Unlimited arbitrary-shaped holes with no
per-material anything, at the cost of a stencil attachment on every frame and a pass
ordering discipline this renderer has explicitly refused. Deferred, not dismissed.

**A4 — real geometry cut (CSG / retopology).** The only option that survives arbitrary
overhangs and grazing angles. Requires subdividing the 2-triangle city plate and running
per-mesh CSG over ~150 authored surfaces per mouth. Because the ground casts no shadows,
it buys almost nothing A2 does not already deliver. **This is the "bigger job" people
mean, and it is the wrong one to do.**

## The thickness move — what Minecraft actually solved

The framing above ("holes are hard") quietly assumes the ground is a **surface**.
Minecraft's answer was to make it a **solid**: the thing you stand on is the top of a
deep block of material, the real bottom is far below, and a hole is not something you
*construct* — it is material you *remove*, revealing sides and a floor that were always
there. That reframing moves most of the wanted features out of the expensive bucket.

**What thickness buys, concretely:**

- **Walls come free.** Lower a region and re-mesh; the vertical faces fall out of the
  surface extraction. `groundshaft.js`'s `buildWall`, `buildLip`, the strata ladder and
  the whole shader mask exist only because an infinitely thin plane has no inside to
  reveal. A solid has one.
- **No slot cap and no discovery**, because nothing is being masked at all.
- **Digging works** — the same operation at a smaller radius, driven by a tool.
- **Strata for free**, as vertex colour by depth, instead of a hand-authored ladder.
- **`floorAt` gets cheaper and more honest** — an array lookup instead of an analytic
  max-of-cones, and by construction the surface you can actually see.

**The machinery is already in the tree, aimed one ring too far out.** `world/terrain.js`
builds a real tiled heightfield — `PlaneGeometry(TSPAN, TSPAN, TSEG, TSEG)` at
`TERRAIN_TILE_SEG = 88`, 4×4 tiles, ~248k tris — but deliberately only for "the FAR
BACKDROP RING … you look out AT but never walk on", and `CBZ.terrainHeight` returns
**EXACTLY 0** across every walkable footprint, by contract, so that "physics is
unchanged, nothing can fall off a hill". The renderer for a dig-able world already
exists and is pointed at scenery.

`systems/chunks.js` is likewise already a 16 m spatial grid, chosen as exactly 2× the
physics collider cell so chunk edges land on collider edges — a ready-made dirty-tile
unit for re-meshing.

**The migration is unusually safe**, which is the strongest argument for it: a
heightfield initialised to 0 everywhere is *byte-identical* to the flat plane for every
consumer. Swap the representation without changing a single value, keep terrain.js's
flat contract intact, and only then start lowering cells.

### Two things the thickness move does not solve

**1. A heightfield gives slopes, not sheer walls.** Minecraft's faces are vertical
because it is voxels. A plain heightfield grid interpolates between neighbours, so a
lowered region reads as a *dent*, not a *cut* — and the reference photograph is a sheer
shaft. The fix is standard and cheap but must be designed in from the start: emit
explicit side quads at height discontinuities (duplicate the edge vertices) instead of
letting the grid interpolate. That one decision is the difference between a dented world
and a cut one.

**2. Digging DOWN is single-valued; a cave is not.** A pit, quarry, trench or crater
keeps one height per (x,z), so `floorAt` keeps its shape and the 280 call sites are safe.
A basement, tunnel or overhang puts a lid *above* a void and needs the multi-valued step
no matter how thick the ground is. Thickness converts the pit family — most of what is
actually wanted — into the cheap bucket. It does not abolish Job B; it stops Job B
blocking the common case.

When multi-valued is wanted, the cheap version is a **layered heightfield**: per cell, a
short list of solid spans, and `floorAt` picks the span containing your feet. Two facts
make that unusually tractable here — `groundAt(x, z, fromY)` **already** takes `fromY`
and already uses it to choose among stacked surfaces (that is how building storeys
work), and `CBZ.floorAt` is universally 2-arg (197 call sites, zero passing a third), so
an optional `fromY` defaulting to "the topmost span" is byte-identical for every
existing caller.

### Where it stays hard: the authored surface layer

Minecraft has no authored surface layer — its roads *are* blocks, so lowering the ground
lowers the road. Gang City's streets are separate meshes at fixed heights: lane paint at
`gy+0.057`, kerbs, lot slabs, pads. Lower the heightfield under a road and the road hangs
in the air. That is the same ~150-surfaces-per-mouth problem, and thickness does not
touch it.

So the honest split: **the thickness move is excellent exactly where the ground is bare**
— the survival island, the biomes, wilderness, a dedicated quarry — and still hard under
the authored city, unless the street layer is eventually baked into the terrain surface
(vertex colour / texture) instead of being separate meshes.

The two approaches are complementary, not competing: a dig-able heightfield where the
ground is bare, and the global shader mask (A2) under the authored city.

## The bunker case: it is not the hole, it is the LID

The driving fantasy is concrete: a B-2 sortie drops on Gang City and leaves a **crater**;
a bunker buster does **real damage underground**; the player can **build** underground
bunkers; and a mission target in a bunker can be reached **either** on foot through
layers of security **or** by putting a penetrator through the roof from 40,000 ft.

Almost all of that logic already exists.

| piece | where | state |
|---|---|---|
| B-2, bombing runs, ballistics | `city/aircraft.js`, `city/playeraircraft.js` | ships |
| penetration model (`penCE` vs roof CE) | `city/strategic.js`, `CBZ.strategicBunkerRoof` | ships |
| bunkers, interiors, blast doors, shelter guarantee | `city/bunkers.js` | ships |
| breach state machine (held / crack / breach) | `CBZ.strategicBunkerBreach` | ships |
| security layers, keycards, gov complexes | `city/security.js`, `city/govcomplex.js` | ships |
| missions, contract kills | `core/mission.js`, `city/hitman.js` | ships |
| placement / build mode / 16 m chunks | `systems/buildmode.js`, `pieces.js`, `chunks.js` | ships |
| **persistent carved hole in a flat surface that reveals the interior** | `buildings.js::carveHole` | **ships — for WALLS** |
| persistent shaft with floor, fall damage, burial | `world/groundshaft.js` | ships |

So the instinct — "so much of this logic exists but the hole is the issue" — is right. But
the missing primitive is worth naming exactly, because naming it shrinks the job:

> **A pit is a hole with nothing over it. A bunker is a hole with a LID on it. A bunker
> buster is the thing that turns a lid into a hole.**

A pit is single-valued and already works — `groundshaft.js` puts you 46 m down and proves
it. A lid is street *above* and room *below*, both solid, at the same (x,z). That is the
multi-valued case, and it is the **only** thing missing from the list above.

This is also why `bunkers.js` builds mounds. Its header records the workaround honestly:
the interior "sits AT GRADE and the earth sits OVER it — a massive tiered berm". That is
exactly what you do when you have no lid. It works for an isolated hillside shelter and
it cannot work for the mission fantasy, because a bad guy under a Gang City block needs
the *street* over his head, not a visible hill in the middle of downtown.

### The rendering problem mostly evaporates

An intact lid means **there is nothing to draw**. The street looks like a street; the room
below is enclosed and unseen. No mask, no discard, no slots, no retopology — the hardest
rendering problem in this document simply does not arise while the lid is intact.

It only arises *after* a breach — and a breach is a crater, which is single-valued, which
is the case that already works. `carveHole` is the precedent for the punch itself: it
already opens a persistent hole in a flat surface that "reads as a real LIT ROOM, never a
dark gray crater", by finding the surface whose y-band contains the hit and rebuilding it
around the gap. That is the same operation the lid needs.

### The cost, measured — and it is much smaller than Job B implies

Earlier this doc warned about 280 `CBZ.floorAt` call sites. For *this* feature that fear
is mostly wrong, because of how support queries split:

| consumer | query | needs voids? |
|---|---|---|
| **the player** (`systems/physics.js`) | `groundAt(x, z, fromY)` ×13 | yes — and it **already takes `fromY`** and already selects among stacked surfaces (that is how building storeys work) |
| peds / guards (`city/peds.js`) | `floorAt` ×1 | yes — one call site |
| survival bots (`entities/survivorbot.js`) | `floorAt` ×3 | not for city bunkers |
| vehicles (`city/vehicles.js`) | `floorAt` ×4 | **no — surface-only is CORRECT.** A car drives on the street *over* the bunker |
| aircraft (`city/aircraft.js`) | `floorAt` ×7 | **no — same** |

Almost everything that reads `floorAt` *wants* the surface and is right to get it. The
things that can be underground are the player and a handful of guards.

**The seam is one line.** `physics.js:1575`:

```js
function groundAt(x, z, fromY) {
  let best = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;      // ← pass fromY
```

`CBZ.floorAt` is already wrappable and already wrapped in anger — `groundshaft.js`
installs a wrapper over it today. Give `floorAt` the optional third argument (proven
non-breaking: 197 call sites, none passing a third) and a void wrapper can answer "the
lid" or "the room" from the same registry. One caveat found while checking: physics.js
calls its **local** `groundAt` binding, not `CBZ.groundAt`, so this cannot be monkey-
patched from outside — the edit belongs in `physics.js`.

### The shape to build: `CBZ.voids`, the mirror of `CBZ.platforms`

`CBZ.platforms` is already a sparse, spatially-indexed list of walkable surfaces selected
by the querier's `fromY`, which **raise** the floor. A lid needs the mirror: a sparse list
of volumes that **lower** it inside their vertical band. Same data shape, same indexing,
same selection rule, opposite sign — and sparse, so this is not a world representation
change at all. No voxels, no global heightfield required for the bunker fantasy.

Then the whole feature set falls out of one concept:

- **crater** — lower the surface. Single-valued; works today.
- **bunker** — a void with a lid.
- **bunker buster** — delete the lid span. The crater and the room become one hole, and
  `strategicBunkerBreach` already owns the verdict that decides it.
- **infiltration on foot** — a door at the far end of the void; blast doors and the
  security layers already exist.
- **building a bunker** — placing a void record.

What still has to be taught, and should be scoped honestly: guard pathing inside a void,
camera behaviour under a lid, spawn clamps, and save/load plus networking of void records.
Those are bounded and countable; they are not the 280-call-site rewrite.

## Recommended staging

1. **Move the mask to A2** (global `ShaderChunk` patch). Small, contained, deletes the
   discovery bug class and the slot cap, and stays the right answer under authored
   streets whatever happens to the terrain. `npm run test:sinkhole` guards it.
2. **A thick, dig-able heightfield for bare ground**, initialised to 0 so the swap
   changes no values. Side quads at discontinuities from day one. Re-mesh per
   `systems/chunks.js` tile. This is what makes holes *ordinary* instead of special, and
   it retires most of `groundshaft.js`'s geometry in those regions.
3. **`CBZ.voids` + the `fromY` seam** — the lid. This is the one that unlocks the bunker
   fantasy (crater, buster, build, infiltrate), and it is far cheaper than the general
   multi-valued terrain problem because voids are sparse and almost nothing else wants
   to know about them.
4. **Baking the street layer into the surface** — the real precondition for digging in
   Gang City, and the largest single piece here. Scope separately.

## Recorded rejections

- **Literal `y < terrain` dig for bunker interiors** (`bunkers.js:19`) — still correct
  for a ROOM (multi-valued), superseded for a PIT (single-valued) by `groundshaft.js`.
- **Retopology / CSG for holes** — rejected here. Cost scales with authored surface
  count, and its main prize (correct shadows) is already free because the ground never
  casts.
- **Stencil** — deferred, against `renderer.js`'s explicit `stencil: false`.
- **Patching `ShaderChunk` before `core/renderer.js`** — does not work, fails silently,
  costs an afternoon. Install after `CBZ.renderer` exists.
- **A shared `Vector4` uniform (not an array)** — does not work; `UniformsUtils.clone()`
  copies it per material. Use an array so `slice()` keeps the elements shared.
- **"Minecraft is not the model"** — an earlier draft of this doc said exactly that, and
  it was half wrong. Minecraft is not the model for the *authored surface layer*, which
  it does not have. It is precisely the model for the *ground representation*: make the
  walkable surface the top of a solid and a hole stops being a thing you build.
