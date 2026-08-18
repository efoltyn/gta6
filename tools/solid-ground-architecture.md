# The solid ground: architecture for an underground world

Decision record. Companion to `ground-holes-first-principles.md`, which is the
investigation; this is what we concluded and the order to build it. Line numbers
were verified against the tree at the time of writing.

**The objective is not a feature list.** It is one coherent physical world in which the
ground is a real material with an inside, so that Natural Disaster sinkholes, Gang City
craters and bunkers, prison escape tunnels and mining stop being four special cases and
become consequences of one system.

## The decision

**The ground is a solid. Its state is `base field − carvings`. A query returns the solid
spans at (x,z).** One registry, `CBZ.carvings`, owned by one new file,
`src/systems/solidground.js`.

The default column is one implicit span `[−∞, base(x,z)]` — zero bytes, zero time.
Everything wanted is a *subtraction volume* from that solid.

```js
{
  id, kind: "cyl" | "box" | "tube",
  cyl:  { x, z, r, y0, y1 },                    // metres, world space, y-up
  box:  { cx, cz, hw, hd, yaw, y0, y1 },        // matches orientedCollider's grammar
  tube: { pts: [{x,y,z}…], r },                 // swept polyline — tunnels, culverts
  floor: null | { kind: "flat"|"cone"|"stair", … },   // groundshaft's shaftFloor, generalised
  open,          // does it reach the surface? false = LID INTACT: nothing drawn, nothing masked
  lidCE,         // concrete-equivalent metres of lid, for the penetration model
  dry,           // suppress swim inside (a flag, never a fluid sim)
  mode, seed, breached, grp, cols
}
```

| use case | record | open |
|---|---|---|
| sinkhole | `cyl`, stair floor | yes |
| B-2 crater | `cyl`, cone floor, shallow | yes |
| bunker | `box` under grade + small `cyl` entrance shaft | box: **no** |
| bunker-buster breach | raise the box lid at the impact disc | becomes yes |
| prison tunnel / culvert | `tube` | ends yes, middle no |
| mining | many small carvings, consolidated per chunk into a column grid | yes |

**The lid is never stored.** It is what subtraction leaves above a closed carving. That is
the whole trick: the thing we were missing is not a new object, it is the *remainder*.

### Rejected

- **`CBZ.voids` as a mirror of `CBZ.platforms`** — this was the previous proposal in the
  first-principles doc and it is wrong. A void registry that lowers the floor, running
  beside `CBZ.groundShafts` which replaces the floor, is two registries answering one
  question with two shapes and two query paths. A crater, a shaft and a bunker room must
  be the *same record type* or the parallel-system sin has already happened.
- **Chunked voxels** — buys free-form 3D caves nothing here needs, at the price of the
  renderer, the authored city and the flat contract.
- **A global layered heightfield** — >99.99% of columns are the implicit default forever.
  The sparse registry *is* the layered heightfield, evaluated lazily.

## The physics seam

### `CBZ.floorAt(x, z, fromY)` — one signature change, stated as law

> **Returns the highest solid top at (x,z) that is ≤ `fromY + STEP_UP` (0.45).
> `fromY` omitted = +∞, "seen from the sky".**

Measured: 197 call sites, **zero** passing a third argument. The default makes every
existing caller *correct*, not merely unbroken:

- **Vehicles / aircraft** (2-arg): topmost solid. Over an intact lid that is the street —
  a car drives over the bunker. Over an open shaft the topmost solid *is* the shaft floor
  — the car falls in. Today's behaviour preserved by construction, with no special case.
- **Actors**: already route through `groundAt(x, z, fromY)`, so a guard inside a bunker
  gets the room floor for free.
- **Spawn clamps / nav / drops** (2-arg): the surface. Nothing ever lands underground by
  accident; going below requires explicitly passing `fromY`.

### Ownership inversion — the part that deletes a bug class

`CBZ.floorAt` currently has **five assignment sites** and no owner:
`city/mode.js:301`, `city/mode.js:536`, `modes/survival.js:421`, `modes/gungame.js:226`,
`world/groundshaft.js:1124` — plus a *second* subtraction path at `modes/survival.js:259`
which reads `CBZ.survHoles` inside survival's own base. The `_city` / `_shaft` marker
dance exists to stop that chain recursing on a mode reset.

`solidground.js` owns `CBZ.floorAt` permanently. Modes call
`CBZ.registerGroundBase(fn)`. Everything else registers carvings. All five assignment
sites and the survHoles subtraction are **deleted, not wrapped**.

```js
CBZ.floorAt = function (x, z, fromY) {
  const b = base(x, z);
  if (!carvCount) return b;                 // zero-carving fast path: byte-identical to today
  return evalSpans(x, z, fromY == null ? Infinity : fromY, b);
};
```

### `physics.js`

`physics.js` calls its **local** `groundAt` binding, not `CBZ.groundAt`, so none of this
can be patched from outside. These are in-file edits, deliberately.

1. **One token**, `physics.js:1575`: `CBZ.floorAt(x, z, fromY)`. The law becomes: *support
   is the highest walkable top — ground-span tops and platform tops alike — within
   STEP_UP of `fromY`. Platforms raise, carvings lower, one selection rule.* Step-up,
   ramps, landing math and the air integrator all inherit correctness. Falling through a
   breached lid onto the bunker floor then needs **zero** further code.
2. **Ceiling clamp — a real gap, verified.** `physics.js:185`'s y-band test
   (`if (c.y0 != null && (headY <= c.y0 || feetY >= c.y1)) continue;`) sits in the
   *horizontal* collide loop and resolves x/z only. **Nothing in the engine clamps
   ascent.** Without this, jumping inside a bunker puts your head through the street. Add
   `CBZ.ceilAt(x, z, y)` — bottom of the nearest solid span above y, `Infinity` when none
   — and clamp in the jump and air branches. Guarded by `carvCount`, so it is a no-op
   compare today.
3. **Swim gate.** A dry void below sea level must not engage the swimmer: gate on
   `CBZ.carvingAt(x, z, y) && carving.dry`.
4. **The bounded 2-arg cleanup list** (~10 files): call sites that act *at an actor's
   altitude* but query 2-arg — `city/peds.js:2983` dropWeapon would drop a bunker guard's
   rifle onto the street above him. Each is a one-token `, y`. Do them in the milestone
   that first puts an NPC underground, not before.

## Rendering

**The global-ShaderChunk mask is the permanent answer for authored surfaces, not a
stepping stone.** The two forces that would push toward real geometry are both absent:
the ground never casts shadows, and carving walls are vertical by construction. Real
geometry appears in exactly one place — dig-grid chunks, where the ground *is* generated
mesh and a hole is a re-meshed column.

| state | drawn |
|---|---|
| lid intact | **nothing new.** The street draws as today; the room's liner (walls, floor, and a real **ceiling slab**) draws inside, lit as an interior — "a lit room, never a grey crater" |
| open mouth | one mask slot + the mouth liner: groundshaft's wall/lip/strata generalised from "shaft" to "any open carving" |
| breach | raise the lid span at the impact disc → `open: true`, allocate a slot, reuse groundshaft's collapse FX |

New `src/core/groundmask.js`. It must install **after** `CBZ.renderer` exists and must
**append** to the fog chunks — `core/renderer.js:372` replaces `fog_fragment` wholesale,
and a patch installed before it is discarded *silently*. Assert at install that
`installFog`'s marker is present so a future reorder fails loudly. Uniform: an
**array**-valued `uCbzHoles` written into all 17 `THREE.ShaderLib[*].uniforms`
(`UniformsUtils.clone` does `.slice()` on arrays, keeping elements shared; a bare Vector4
is `.clone()`d per material and never updates).

Known gap: slots are `(x, z, r, topY)` — **cylinders only**. A breach disc and a shaft are
cylinders, so the shipped cases are covered; a rectangular open trench or a tube's open
mouth would need a second slot shape. Record it rather than pretend otherwise.

## Subsumption — what dies, not what runs alongside

| existing | fate |
|---|---|
| `groundshaft.js` mask discovery (raycast + sweep + per-material patch) | **deleted** — replaced by `core/groundmask.js`. Kills the whole discovery bug class. |
| `groundshaft.js` `installCityFloor` + `_shaft` marker | **deleted**; its records become `cyl` carvings, its floor math moves to the evaluator |
| `groundshaft.js` collapse, kill modes, debris, liners, slope law, audit | **kept**, re-pointed: it becomes the cylindrical-collapse *event and liner service* over carvings — gameplay, not representation |
| the five `CBZ.floorAt` assignments + survival's survHoles subtraction | **deleted** → `registerGroundBase` |
| `CBZ.survHoles` / `CBZ.groundShafts` | alias for one milestone as a filtered view, then deleted |
| `bunkers.js` berm trick | **retired for new construction**; header ruling amended in place — the shipped wilderness finds stay as legacy *content*, which is not a parallel *system* |
| `bunkers.js` breach machine, `strategicBunkerShelterAt/Roof/Breach` | **kept as the API**; `ShelterAt` re-derives from carving containment, `Breach`'s verdict additionally opens the lid |
| `buildings.js::carveHole` | **kept separate — recorded decision.** It carves vertical authored walls with remnant/flank/sill logic debugged against a dozen filmed failures; a lid carve is a span deletion in a registry. Forcing them into one function is consistency with the wrong shape. They share the *standard* and the breach ledger, not the mechanism. |
| `escape_routes.js` vent teleports | **retired route by route**; tunnels become `tube` carvings, `CBZ.vents` remains only where the fiction is a duct too small to enter |
| `systems/chunks.js` | absorbed as intended — its 16 m grid (2× COL_CELL, chosen for exactly this) indexes carvings, and `rebuildChunkBatch` finally gets its job |
| `terrain.js` flat contract | **untouched** except inside declared dig regions |

## Order

Each milestone ships alone and is worth shipping alone.

| # | milestone | unlocks | ratchet |
|---|---|---|---|
| M1 | mask goes global; discovery deleted | hardens Natural Disaster | `test:sinkhole` green + `sweptMeshes === 0` |
| M2 | `solidground.js`: ownership inversion, spans, the `fromY` seam | nothing visible — the enabling move | `ground-check.mjs`: golden-grid `floorAt` sample **byte-identical** to pre-M2 with zero carvings |
| M3 | craters from ordnance | **B-2 leaves a real crater** | bomb → floor drops, car falls in, survives save/load |
| M4 | the lid: box carvings, bunker builder, breach opens it | **the entire bunker fantasy** | car on lid reads street; player descends; `penCE < roofCE` leaves street, `≥` drops to room |
| M5 | tubes + crawl | **prison escape tunnels** | walk it end to end, continuous sub-grade `pos.y`, no teleport |
| M6 | dig grid in one bare region, side quads from day one | **mining** | drawn surface vs `floorAt` within ε; vertical faces at every discontinuity |

**M2 is the sharp edge.** It is described as the smallest enabling move, and in behaviour
it is — but it deletes five `floorAt` assignments across three modes plus a wrapper, and
every mode's ground runs through it. The byte-identical golden-grid ratchet is not
optional; it is the only thing that makes M2 safe to do at all.

Not a milestone: **baking the street layer into the surface** — the precondition for
digging anywhere in the authored city, and the only piece whose cost scales with the
~150-surfaces-per-mouth problem. Scope separately.

## Recorded rejections

1. **Voxels / a global volumetric ground.** Every wanted feature is sparse subtraction
   from an implicit solid.
2. **Retopology / CSG of authored surfaces.** Cost scales with authored surface count;
   its prize — correct shadows — is already free because the ground never casts.
3. **Stencil / EffectComposer.** Against `renderer.js:5` and `:378`.
4. **Water flowing into voids.** `dry` is a flag, not a simulation. A flooded tunnel is
   authored water.
5. **A 3D navmesh for underground NPCs.** Guards use the room-local AI bunkers already
   ship; city nav stays a surface concern.
6. **Overhanging / concave cave walls.** Carving walls are vertical prisms and tubes. The
   lid is the only overhang the fantasies need, and it is exactly the one the model gives.
7. **Wrapping `CBZ.floorAt` as an extension technique.** The `_city`/`_shaft` marker dance
   is the recorded failure mode; the registry replaces it.
