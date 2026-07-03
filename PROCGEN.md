# PROCGEN.md — the method behind the world

Synthesis of a nine-agent research pass (four code-analysis sweeps of every
generator in this repo + five literature sweeps: city layout, buildings,
terrain/biomes, ambient life, procgen architecture). This is the charter for
how generation works here and what gets fixed in what order.

## The diagnosis (what "feels brute force" actually was)

1. **RNG had no architecture.** Ten+ magic seed literals (90210, 0x5dec7,
   990217, …), one order-fragile sequential stream shared by every mainland
   system — the code was full of "preserve RNG order" comments because adding
   one draw anywhere reshuffled everything downstream. 581 raw `Math.random`
   calls besides (runtime FX — acceptable — but unlabeled).
2. **Districts were decorative.** Shop kinds were dealt from a global shuffled
   queue in lot order, ignoring district kind entirely; only height read it.
3. **The good machinery already existed but wasn't used.** `placement.js` has
   a real spatial hash + Bridson Poisson-disk; `towngen.js` has recursive lot
   subdivision + ring zoning. The mainland and half the biomes bypass both
   with hand-rolled retry loops (up to 900 tries for 15 buildings).
4. **Hand-copied coordinates everywhere.** Every biome/island footprint,
   causeway, arterial connector, and terrain's FLAT bound is a hand-typed
   literal "VERIFIED by comment" — nothing asserts them, so edits desync.
5. **Ambient life is a bubble.** Traffic has no destinations (38% coin-flip
   turns); crowds are a biased random walk; the real router exists
   (`citynav.routeTo`) but is only used for fleeing.

## The method (established practice, from the literature pass)

- **One world seed → named streams → position-hash leaves** (Eiserloh
  noise-RNG / Squirrel3; Cogmind's seed-tree). Value AT a place, not the Nth
  value of a sequence. DONE: `src/core/seed.js` (`CBZ.WORLD_SEED`, `?seed=N`,
  `CBZ.seedStream(name)`, `CBZ.hash01(x,z,salt)`); all generators migrated.
- **Field → structure → detail** (Minecraft's pipeline, SimCity land value):
  cheap global fields (land value = distance-to-center + waterfront +
  low-freq noise) sampled by structures, never sideways dependencies.
  STARTED: district-affinity shop zoning in `buildings.js` (banks/jewelry/
  casino → core; chop/guns → industrial/projects; groceries/gyms →
  residential) with the essentials-always-place guarantee intact.
- **See it to steer it**: `tools/city-atlas.mjs` renders the whole world
  top-down at any seed (the studio.mjs of procgen). DONE.

## Roadmap (highest value first, all incremental)

1. Route the five hand-rolled scatter/retry loops through `placement.js`
   (expansion island buildings/trees, props camps, forest bushes/rocks;
   desert/snow scatters get min-spacing via `P.scatter` Bridson).
2. Derive instead of hand-copy: terrain FLAT from `city.regions`; causeway
   rects from the two regions they join; arterial connectors from
   `city.xLines/zLines`. Assert region non-overlap at registration.
3. Land-value field: add waterfront/highway bonus + low-freq noise jitter to
   ring zoning (`towngen.js zoneForRing`) and to mainland height/abandonment.
4. Traffic destinations: give ambient cars a destination intersection routed
   over the grid (reuse `citynav.routeTo`'s Manhattan staircase); road-class
   + time-of-day spawn density table (GTA popcycle pattern).
5. Director tension curve in `scenedirector.js` (L4D adaptive pacing instead
   of flat cooldowns); time-of-day cast weights in `regionlife.js`.
6. Sidewalk lane bias + 2–4-body walking groups in `crowd.js` (the crowd cue
   players consciously read as "people, not extras").
7. Facade split-grammar (floor/bay/terminal) + district material kits in
   `buildings.js` — kills the uniform window grid; Townscaper-style relaxed
   grid as a later, bigger lift.
8. Generator invariants in the smoke gate: per-seed asserts (no region
   overlap, every lot's door reaches a road, essential shops all placed) +
   an atlas seed-farm for visual regression.

Full agent reports live in the session transcript; the shortlists above are
their consensus top picks re-ranked for this codebase's constraints (runtime
browser build, draw-call budget, multiplayer byte-identity per seed).
