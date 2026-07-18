# Adoption: buildings & city blocks (reference → this engine)

Reference: `scratchpad/reference/upstream-generators.js` (modern three r18x /
WebGPU / TSL). Sections mined: **CityGenerator** (block/lot grid, chamfered
corner lots, curb slabs, per-lot palette hash), **SkyscraperGenerator**
(tripartite massing, FaceFrame, roofline grammar, window modules, brick
snapping, randomStyle, bakeGroups), **§8 morphtargets over merged geometry**.

Ours (surveyed): `src/city/buildings.js` (`makeBuilding` @2095 — the single
funnel; `CBZ.cityMakeBuilding`), `towngen.js`/`citytemplates.js`/`minicities.js`
(all build through `cityMakeBuilding`), `core/batch.js` (merge path),
`interiorlight.js` (`cityInteriorGlow`), `core/seed.js` (`hash01`), PROCGEN.md.
Key facts that shape what ports: colliders/platforms are **AABB rects** (#3/#4),
`batch.js` already **bakes merged geometry into preallocated typed arrays**
(`mergeGeometriesV2` + `computeBoundingSphere`), the recent "every pane is clear
glass" pass deliberately **removed facade AC boxes / grey blank panels**, and
roofloot/helipad **use the roof centre**.

## Ranked

| # | Technique (reference) | Ours today | Verdict | Why |
|---|---|---|---|---|
| 1 | **Tripartite massing** base/shaft/crown + **setback** | single extruded box, uniform top-to-bottom | **PORTED-NOW (A)** | biggest skyline win; additive deco, no footprint change |
| 2 | **Roofline grammar**: string courses, two-step cornice, parapet, finials | flat parapet + 1 coping lip + hairline corner reveal | **PORTED-NOW (A)** | cheap deco boxes; kills the "flat-top box" read |
| 3 | **Corner 45° chamfer aimed at intersection** | none (AABB boxes) | **PORTED-NOW (A, adapted)** | true footprint chamfer NOT-APPLICABLE (AABB can't collide 45°, door-reach risk); done as **chamfered CROWN corners** (deco) for the setback-tower silhouette |
| 4 | **Window modules w/ reveal depth** | panes flush at outer wall face, no reveal | **PORTED-NOW (B)** | recess pane + reveal liners → real shadow line; universal, per-window |
| 5 | **Per-window lit-room variation** (warm/cool bulb spread) | ~15% lit, one fixed warmth per building | **PORTED-NOW (B)** | `interiorlight.keyFor` already buckets warm≥0.5 → free 2-temp spread |
| 6 | **bakeGroups()** typed-array baking (rigid normals, AABB→sphere, bake=draw order) | `core/batch.js mergeGeometriesV2` does exactly this at load | **ALREADY-OWNED** | do NOT duplicate; buildings emit boxes, batch bakes them |
| 7 | **Per-lot palette hashing** | `districtWallColor` via `hash01(ox,oz,salt)` | **ALREADY-DONE** | position-hash HSL jitter per district kit |
| 8 | **randomStyle()** seed layer (defaults<style<caller) | `DISTRICT_KITS` + `vhash`/`hash01` between defaults & `opts` | **ALREADY-DONE** | equivalent precedence already in place |
| 9 | **Interior mapping** (raycast rooms behind glass) | `cityInteriorGlow` instanced panels + real furnished `roomKit` rooms | **ALREADY-DONE (better)** | we render actual geometry rooms, not a shader fake |
| 10 | **FaceFrame** per-edge (u,v,n) basis, instances on any face incl. diagonals | per-face loop over 4 axis-aligned faces | **PORTABLE-LATER** | payoff is diagonal faces; only needed if real chamfered footprints land |
| 11 | **§8 morphtargets over merged geometry** (animate baked states) | demolition/construction swap geometry + `batchHide/ShowGroup` | **PORTABLE-LATER** | fits intact→rubble & scaffold→built phases, day/night sign states |
| 12 | **Brickwork / interior-map TSL shaders** | flat Lambert + vertex-AO + canvas signs | **PORTABLE-LATER (approx)** | r128 has no TSL; approximate via canvas facade tex / vertex-color weathering / per-window emissive (5 already covers the lit part) |
| 13 | **AC units on hashed window subset** | `acUnit` terminal exists but weight 0 in every kit | **NOT-APPLICABLE** | owner removed facade AC deliberately (@buildings.js:2026); re-enabling contradicts the clear-glass pass |
| 14 | **BRICK-module dimension snapping** | metric 1.5 m bay pitch, no brick module | **NOT-APPLICABLE** | snapping exists to align a procedural brick *shader* we don't have |
| 15 | **Block/lot grid + curb slabs** | `towngen` recursive OBB subdivision + ring zoning; roads/curbs own sidewalks | **NOT-APPLICABLE** | ours is richer; sidewalks/roads are other files' turf (out of scope) |

## PORTED-NOW — implemented

**A. Tripartite massing + roofline grammar** — `CBZ.CONFIG.BUILDING_MASSING_V2`
(default ON), in `makeBuilding` just before `flushDeco()`. All **deco** (`dbox`,
merged, cast-shadow) or **above the roof** — zero new ground-level colliders, so
door reachability / interiors / stairs / elevator shaft / roofloot are untouched.
Deterministic per lot via `CBZ.hash01(ox,oz,salt)` (never `rng()`):
- **Base**: two-step belt cornice capping the ground/podium base (storeys ≥ 3).
- **Shaft**: projecting **string courses** every N floors (N hashed 3–5), storeys ≥ 4.
- **Main cornice**: the flat coping becomes a **two-step projecting cornice**.
- **Finials/pinnacles**: chunky corner blocks at the parapet (≥0.3u members).
- **Crown**: storeys ≥ 6 get an **inset setback crown** volume on the roof
  (footprint inset ~26%, height hashed) with its own two-step cornice, parapet,
  a central **spire**, and **45° chamfered corners** (the adapted "corner
  chamfer aimed at the intersection"). Deco-only — leaves the roof walkable so
  roofloot/helipad/snipers keep working. Height added above `rTop` only.

**B. Window reveal depth + per-window warm/cool** — `CBZ.CONFIG.WINDOW_REVEALS_V2`
(default ON), in `glazeOpening` (the upper-floor curtain-wall/window path every
tower shares). Recesses each clear pane ~0.09u behind the outer face (the full-WT
sill/header/jamb boxes already there become the reveal returns), adds a slim
bright **reveal-edge liner** so the shadow line reads, and gives the interior-glow
call a **per-window hashed warmth** (cool-dominant offices get a warm-lamp
minority, residential the reverse). Pane stays clear + breakable; its collider
shifts ≤0.1u inside the same wall — physics/LOS unchanged. Glass kind, tint, grid
subdivision and shatter all preserved.

## PORTABLE-LATER (noted, not built)
- **FaceFrame (u,v,n) basis** — refactor the 4-face loop into an edge-basis emitter;
  unlocks real chamfered/angled footprints and one authored module per face.
- **Morphtargets over merged geometry (§8)** — one merged mesh per phase with
  matched vertex counts; tween `morphTargetInfluences` for demolition (intact→
  rubble), construction (scaffold→built), day/night sign states — animates the
  batched world without unmerging.
- **Canvas facade textures / vertex-color weathering** — r128 stand-ins for the
  TSL brickwork + soot/streak shaders (grafCache already shows the canvas idiom).
- **Reveal depth on ground-floor `gridGlass`** (storefront/garage) — same trick,
  deferred to keep B off the door-casing area.

## NOT-APPLICABLE (with reason)
- **Facade AC units** — owner removed them in the clear-glass pass (design, not omission).
- **BRICK-module snapping** — aligns a brick shader we don't run; voxel flat-Lambert.
- **TSL node materials / WebGPU / interior-map raycast shader** — r128 is UMD
  WebGL; we already have real furnished rooms + instanced lit panels.
- **bakeGroups()** — `core/batch.js` already bakes to typed arrays at load;
  duplicating it in the builder would double-merge and fight the ledger.
- **Ammo physics / block-grid / curbs** — out of scope (other files / better already).
