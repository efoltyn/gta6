# Gang City buildings from first principles

This is a current-source map, not a replacement generator proposal. The
canonical owner remains `src/city/buildings.js::makeBuilding` /
`CBZ.cityMakeBuilding`; towns, templates, annexes, interiors, elevators,
damage, demolition, and save/reset behavior already meet at that funnel.
Creating an era-specific second builder would split those guarantees.

## What a building is in this engine

A building is not its visible shell. It is one owned record containing:

- a site and footprint (`ox`, `oz`, `w`, `d`);
- a vertical section (`FH`, `storeys`, `h`, slabs and exact floor tops);
- four authored faces, openings, glass, doors, and signs;
- an enterable interior, furnishing clearances, stairs, and elevator chase;
- colliders, walkable platforms, LOS blockers, windows, and doors;
- a teardown identity used by fracture, structural collapse, demolition,
  reset, networking, and rebuilding.

The record is the important architecture. It prevents the familiar failure
where a facade looks changed but an old collider, door, window pool entry, or
elevator stop survives in a different system.

The generator should therefore be read as this pipeline:

1. **Grade and foundation** — establish a floor above terrain/lot dressing.
2. **Section** — choose floor-to-floor height, storey count, slabs, and roof.
3. **Face grammar** — divide each face into bays and vertical zones.
4. **Openings** — build the surviving sill/header/jamb geometry around actual
   voids; glaze the void or hang a real door in it.
5. **Program** — furnish the volume while preserving entrance, stair, and lift
   clearances.
6. **Circulation** — publish stair and elevator contracts from the same section.
7. **Dress and identity** — material, trim, signs, weathering, roofline.
8. **Register** — publish every physical/query record under the same owner.

## Why the floor-to-ground frontage works

The loved retail facade is successful because it is not a dark window decal:

- two corner posts make the ends physically legible;
- one continuous head beam carries the facade;
- a real door casing seals the door opening while the leaf can swing;
- each glass bay is subdivided on an approximately 1.5 m module;
- every pane is clear, pooled, collider-backed, and independently breakable;
- the furnished room and its floor are really behind the glass;
- the pane bottom and floor are mathematically coincident.

For retail, `HDR = FH - 1.0`, `glassHeight = HDR`, and
`glassCenterY = HDR / 2`, so:

```
paneBottom = glassCenterY - glassHeight / 2 = 0
paneTop    = glassCenterY + glassHeight / 2 = HDR
```

The showroom and flagship garage previously used panes of `0.86*FH` and
`0.84*FH` centered at `FH/2`. Their lower edges were therefore `0.07*FH`
(0.224 m) and `0.08*FH` (0.256 m) above the floor, and their head beams covered
only the central vehicle opening. They now use the same floor-to-head-beam
equation as retail and a continuous header across the frontage.

`CBZ.cityGlassRealityAudit()` records this promise. It considers only panes
stamped as `storefront`, `showroom`, or `garage-front`, groups vertically
stacked panes into mullion columns, and checks the bottom of each whole column
against y=0. (Upper rows in a multi-pane wall should not individually touch
grade.) It also reports any pane missing its breakable collider. Seed 90210
builds 2,322 frontage panes in 2,124 columns: all 2,124 columns meet grade and
all 2,322 panes retain their collider.

The transferable lesson is that “beautiful glass” is mostly relationship:
glass-to-floor, glass-to-header, mullion-to-module, sign-to-wall, and visible
room-to-opening. More reflectivity or more panes cannot repair a broken
relationship.

## Elevators: style the kit, preserve the contract

`makeBuilding` publishes:

- `floorTops`: exact arrivals from ground through roof;
- `floorSlabs`: the physical slabs that may be opened;
- `shaftRects`: building-local reserved vertical chases;
- `clearFloorPoint`: the furnishing exclusion shared by entrance, stairs, and
  later elevator placement.

`src/city/elevators.js` consumes that section. It selects a lobby column,
reserves the chase, calls `CBZ.cityCarveShaft`, owns cab and landing doors, and
adds a functional roof headhouse. The headhouse is not facade clutter.

An era/style pass can change cab finish, grille/door type, lobby surround,
indicator, and headhouse silhouette. It should not retype stops, place a
decorative shaft beside the real one, or let furnishing guess where the chase
is.

`CBZ.cityElevatorAudit()` proves that ownership boundary after world build. It
checks ordered ground-to-roof stops, every intermediate slab carve, shaft
reservation, building-registry parity, vertically aligned end rooms, two door
leaves per end, and exact cab-floor heights. Seed 90210 builds 18 lifts with
zero failures in those categories.

## Generalizing to any era or style

“Style” should be data applied to shared construction verbs, not a named
building function. A useful style record has independent axes:

```
{
  massing,          // base/shaft/crown, setbacks, symmetry, corner treatment
  structuralRead,  // pier-and-spandrel, bearing wall, exposed frame, curtain wall
  bay,              // pitch, grouping, vertical alignment
  opening,          // sill/head proportions, arch/flat head, recess depth
  material,         // wall, trim, glass, metal, weathering
  roofline,         // parapet, cornice, gable, mansard, mechanical crown
  frontage,         // shop bay, arcade, stoop, loading bay, blank service face
  signage,          // painted fascia, projecting blade, neon, civic inscription
  program,          // room/furnishing/staff station grammar
  circulation       // stairs/lift presentation, never their core geometry contract
}
```

Examples of the same skeleton speaking different eras:

| Era / family | Massing and structure | Opening grammar | Roof / street read |
|---|---|---|---|
| Georgian / early mercantile | narrow symmetrical bearing-wall block | vertically aligned tall punched windows, strong sill/head | cornice, central door, painted fascia |
| Victorian industrial | deep brick bay rhythm, expressed piers | arched grouped windows with recessed reveals | sawtooth/monitor or heavy parapet, loading doors |
| Art Deco | stepped base-shaft-crown, vertical pilasters | narrow repeated bays, metal spandrels | setbacks, fins, geometric crown and inscription |
| Mid-century commercial | low horizontal frame | broad storefront modules and ribbon glazing | thin slab edge, canopy, restrained sign band |
| Contemporary tower | podium plus setback shaft, curtain wall | large clear modules with real mullion/reveal depth | mechanical crown, terrace/parapet, integrated sign |
| Improvised / post-damage | retained structural bay with infill changes | boarded, mismatched, or carved openings | patched roofline, attached—not floating—repair work |

The face emitter is currently four axis-aligned faces because collision and
platform ownership are AABB-based. A future `FaceFrame {u,v,n}` abstraction is
the correct prerequisite for genuine chamfers, diagonals, curved approximations,
and arbitrary footprints. It should still feed the same opening, glass, door,
registry, elevator, and demolition verbs.

## Destruction: three scales, three owners

Current destruction already separates domains:

1. **Pane scale** (`buildings.js`) — crack, shatter, hide pooled instance, remove
   the pane collider.
2. **Wall/facade scale** (`fracture.js`) — accumulate wounds, carve a persistent
   walkable opening, rebuild surviving flanks, throw rubble/ejecta.
3. **Building scale** (`structural.js` then `demolition.js`) — per-floor
   integrity and load-path verdict, yield countdown, dust-hidden proxy collapse,
   unregister the real shell, then rubble/clear/scaffold/rebuild.

This explains the “glass breaks but the frame still holds” observation. The
impact bus deliberately shatters glass and wounds a facade independently of
the building-scale verdict. A stock airstrike contributes
`struct*power = 6*3 = 18` damage. In a live seed-90210 probe, a four-storey
28-by-28 block had capacity 70.15: one airstrike reached only 25.7%, stage
`SCARRED`, with an intact load path. A near-field nuke contributed 495 damage,
reached 705.6%, and entered `COLLAPSING` immediately. The test reset the
structural and demolition ledgers before advancing the collapse.

Nuclear glass also intentionally outranges wholesale collapse: the nuke FX
walks a glass ladder through named overpressure contours, while the structural
wave uses a squared falloff. A distant frame standing after its glazing fails
is therefore a valid outer-zone result. What still needs a coupled audit is
whether the *actual per-building* collapse/yield radii produced by capacity and
load-path tuning agree with the named 5 psi/2 psi contours; comparing only the
declared radii to one another cannot prove that.

The remaining visual question is the **critical-but-standing** interval. The
ledger knows a floor is failing, but the real shell remains until the
pre-shudder dust swap. If the desired read is “the glazing and infill are gone,
but a believable frame temporarily remains,” that should be one shared
`CRITICAL`-stage dressing driven by the structural record—not a bomb-specific
window delete and not a permanent invulnerable frame. Its invariants should be:

- glass fails before opaque structure;
- infill loss exposes the real room/floor, never a black backing plane;
- every visible beam/column has a load path;
- a surviving frame exists only while floor integrity supports it;
- the collapse swap removes visual shell, colliders, platforms, LOS, doors,
  and pooled glass together.

## Reality tests as the world-model basis

The first shared primitive is `src/systems/reality.js`:

- AABBs are nodes.
- Physical contacts are graph edges.
- Ground and authored walk surfaces are anchors.
- Any connected component without an anchor is floating.
- A 3D spatial hash produces nearby candidate pairs; there is no global O(n²)
  scan.

It also exposes a positive-volume overlap audit. Structural joints often
overlap deliberately, so overlap consumers must provide domain exclusions;
face contact is support, not penetration.

Current adopters:

- Ironjaw arena: 48,190 static box primitives, crowd excluded; the first run
  found 202 floating pieces in 34 components. Repairs to scoreboard/gantry,
  seat frames, chair legs, top guard, aisle-sign bases, light bars, and banner
  mounts reduce that to zero.
- Demolition phase gate: uses the shared support graph instead of a private
  all-pairs propagation loop.
- Frontage glass: a narrower semantic invariant checks floor contact and
  physical collider ownership.

The next useful invariants are:

| Invariant | Mathematical question | Best owner |
|---|---|---|
| Support | Does every static component reach ground/a support surface? | `reality.js` |
| Penetration | Do unrelated positive-volume solids overlap? | shared broad phase + domain filter |
| Clearance | Can a body-sized swept volume reach door, stair, lift, and station? | building/circulation audit |
| Enclosure | Do opaque face intervals plus doors/glass cover the intended boundary without gaps? | face/opening emitter |
| Registry parity | Does every visible solid have the intended collider/LOS/platform record, and vice versa? | building record audit |
| Teardown parity | After collapse, did every record owned by the building leave every global registry? | structural/demolition gate |
| Determinism | Does one seed produce identical grammar choices and counts? | `math-gate.mjs` |

These tests are a useful world model because they measure relationships the
player reads as reality. They do not attempt to simulate global structural
physics every frame; they prove authored static state and let the existing
gameplay owners decide when that state changes.
