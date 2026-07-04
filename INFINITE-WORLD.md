# INFINITE-WORLD.md — chunked world migration plan (condensed)

Design from the fleet's architecture pass (full doc in session transcript).
Prereq already shipped: `core/seed.js` position-hash RNG — any chunk derivable
with zero dependency on neighbors. This plan finishes what seed.js started.

## Key decisions

- **Chunk = 200u = 4×4 blocks** (block step is 50u → boundaries always fall on
  street centerlines; ~12–18s to cross by car → comfy 3-chunk load ring).
- **Pure generator**: `generateChunk(worldSeed, cx, cz) → ChunkData` — typed
  arrays / SoA only (heights, ground kinds, road segs, lot rects, building
  SPECS not meshes, prop transforms, collider AABBs). WASM-portable and
  Worker-transferable by construction.
- **Roads become a predicate, not a list**: `isRoadLine(axis, index)` +
  `roadClassAt(ix, iz)` hash/field-gated on the same 50u lattice —
  `world.js:388` (`nearestIntersection`) already computes grid coords from
  world coords; generalize it unbounded. Nav (staircase + Dijkstra) becomes
  windowed over a 3×3-chunk neighborhood instead of one global graph.
- **Fields drive everything**: `landValue(x,z)`, `districtKind(x,z)`,
  `roadHierarchy(ix,iz)` — continuous across chunk borders (that's WHY they
  are fields), replacing the finite 3×3 `districtQ` carving.
- **Origin continent compat**: chunks inside the authored bounds return the
  hand-built content (always loaded, never regenerated); outside → procedural.
  `worldmap.js` regions already implement the membership test; the fallthrough
  changes from "clamp back inside" to "generateChunk".
- **Terrain**: replace the finite FLAT-ring mountain backdrop with an infinite
  capped-amplitude field; origin-continent chunks force height 0.
- **Colliders**: `physics.js` grid broadphase is already chunk-shaped; needs
  incremental `addColliders(tag)/removeColliders(tag)` instead of full rebuild,
  and `CBZ.colliders` must stop being append-only-forever.
- **Multiplayer**: networld is already host-authoritative with radius relay —
  host streams the union of rings around itself + guests; guests never
  generate. Persistence for procedural chunks = per-chunk DELTA records
  (changes from the deterministic default), keyed (seed, cx, cz, slot) —
  never array indices.
- **Rust/WASM kernel order** (determinism rule: all decisions on ONE side;
  JS never re-derives): 1 terrain heights, 2 field samplers, 3 scatter,
  4 building specs. Mesh assembly, scene graph, batching, AI stay JS.
  Caller-allocated flat buffers, fixed MAX_* caps, no JSON in the hot path;
  differential JS-vs-WASM test must be byte-identical across a seed farm.

## Milestones (each shippable + gated by city-atlas/smoke)

- M0 chunk-shape the existing generator (one big authored chunk) ~3-5d
- M1 collider incremental add/remove ~2-3d
- M2 field samplers replace district tables ~1w
- M3 one ring of procedural chunks past the seawall (not streamed) ~2w
- M4 streaming ring + 1 chunk/frame budget ~1.5w
- M5 ped/traffic/nav chunk-localization (flag: CHUNK_NAV; riskiest) ~2-3w
- M6 Rust/WASM kernel behind CBZ.CONFIG.WASM_CHUNKS + differential test ~2-3w
- M7 MP chunk union + chunk-delta persistence ~1.5-2w
- M8 per-(seed, chunk) invariants in the smoke gate ~1w

Finite-world blast-radius inventory (file:line for every assumption) is in the
session transcript's full design doc; the load-bearing ones: arena AABB
(world.js:64), seawall gates (world.js:339), terrain FLAT (terrain.js:70),
citynav snapshots + linear scans (citynav.js:73/154/192), navigation
cityGraph (navigation.js:172), crowd tables (crowd.js:176/362/388), vehicles
findRoad/pickCarDest (vehicles.js:2551/2612), netpersist lot-index keys
(netpersist.js:52).
