# MASTER PLAN — Player-Built Worlds, Infinite Cities, Deep Politics & a Living Economy

*Produced by a multi-round, ~40-agent exploration and design effort across the full codebase (all file:line references verified against current source). This is the umbrella plan for transforming the game from a fragile, hand-built, single-city sandbox into a player-buildable, infinitely-generable, politically and economically deep simulation — while making the codebase able to absorb great open-source three.js work directly.*

---

## Executive summary

Five findings drive everything below:

1. **The god object is the tax on every feature.** 982 distinct properties are assigned onto `window.CBZ` across 239 files; `CBZ.city` is read from 101 files, `CBZ.player` from 114, `CBZ.game` from 159. Load order of 241 sequential `<script>` tags *is* the module graph. Update ordering is bare magic numbers that have already collapsed into decimal-priority workarounds (`38.4`…`38.9`). Adding one interactable object type today touches 5–6 files including monolithic shared functions. **Fix: a small set of additive conventions (registries, priority bands, accessors) — not a rewrite.**
2. **The componentized city generator already exists — the main city just doesn't use it.** `towngen.js` + `citytemplates.js` + `minicities.js` already generate 4 distinct, seeded mini-cities from JSON-like prefab data through the same generic building constructor the mainland uses. The mainland (`world.js`/`buildings.js`) is an older, memoized singleton (`CBZ.buildCity()`, world.js:47) with one hardcoded config block (config.js:213-217). **Fix: port the mainland onto the town generator, key cities by id, and infinite cities fall out.**
3. **Runtime-mutable geometry is closer than it looks.** Collision is a flat AABB array with a grid broadphase that already supports `markCollidersDirty()` and rebuild-on-change (physics.js:40-66). Walkable floors are a queryable `platforms` array. Persistence already has an opt-in `serialize()/apply()` world-blob pattern (netpersist.js) that even persists wall damage. **Player building plugs into existing seams; the hard work is batching/instancing and the piece/socket system, not plumbing.**
4. **OSS integration is blocked by exactly two things:** three.js r128-as-global (2021, pre-ESM; loaded from CDN at index.html:245) and the no-modules IIFE architecture. The codebase itself is unusually clean for an upgrade (zero uses of removed `THREE.Geometry`; almost all Lambert/Basic materials). **Fix: Vite + a compat shim (`window.THREE`, `window.CBZ`) so all 241 legacy files run unmodified while new code is real ESM that can `npm install` any GitHub repo, wrapped by a standard adapter convention.**
5. **Politics and deep economy are generalizations of systems that already work.** The 13-gang faction system is a functioning war/diplomacy/treasury sim. Every persistent NPC already has a wallet, job, wage accrual, home/work anchors, and a 5-axis relationship record that ripples through a social graph with gossip propagation. There's a per-district drug market with real supply/demand and a macro property index. There's even a dormant politics stub in the save file (`worldstate.js:70`: support/corruption/scandal/emergencyPowers + `official: "Mayor Rosa Vale"`). **Fix: promote these into jurisdictions, offices, elections, regimes, war, and a unified per-jurisdiction market that every feature reads and writes.**

The plan is organized so each part ships value independently, but they compound: the architecture conventions (Part II) make everything else cheap; the city components (Part III) and player building (Part IV) share one piece/socket/parcel substrate; politics (Part V) and economy (Part VI, incl. the stock market/casino) form one political-economy loop; the SQLite + math backbone (Part VII) carries all of it; the roadmap (Part VIII) sequences it.

---

# Part I — Why adding features is hard today (evidence)

## I.1 The quantified god object

- **982 distinct `CBZ.<name>` assignment targets** across `src/` (1,120 file×property pairs → 138 properties written from more than one file, e.g. `CBZ.nightAmount` from both `adboard.js` and `aigoals.js`; `CBZ.cityMenuOpen` from five files).
- Hot shared state: `CBZ.game` read in **159 files** (522 occurrences), `CBZ.player` in **114 files** (645), `CBZ.city` in **101 files** (1,019). `src/entities/ai.js` alone reads `CBZ.player` ~100× and `CBZ.game` ~101×.
- No namespace owner: `window.CBZ = window.CBZ || {}` is repeated defensively in 19 files; assembly order is defined only by index.html's 241 `<script>` tags (189 of them carrying hand-bumped `?v=` cache busters).
- Biggest files: `city/buildings.js` 5,587 lines, `entities/ai.js` 5,018, `city/peds.js` 3,766, `city/vehicles.js` 2,626, `city/aigoals.js` 2,423 — all coupled to the same globals.

## I.2 The coupling patterns (each with receipts)

1. **Implicit init-order dependencies.** Explicit "keep this order" comments (index.html:256-259, 403); top-of-file bail-outs like `southblock.js:12` (`if (!CBZ.addBox || !CBZ.roomShell || !CBZ.scene) return;`) that silently no-op when order breaks.
2. **Contracts that live in comments.** 196 hits for "contract" — e.g. physics.js:117-119 ("Per the cross-agent contract… do NOT change its math/signature"), loop.js:39-51 (the `feelDt` consumer contract). Zero machine-checkable.
3. **Mode branching everywhere.** 380 occurrences of `mode === "city"/"escape"/"survival"` string checks scattered through 100+ files.
4. **Monkey-patching as the extension mechanism.** 26 wrap sites (`const orig = CBZ.x; CBZ.x = function…`); `city/combat.js` alone wraps five functions owned by other files. It works (guarded with `_kfWrapped`-style flags) but nobody can see who wrapped what.
5. **Magic-number update ordering.** 237 registered frame callbacks (174 `onUpdate`, 63 `onAlways`); only ~50 distinct order values, so ties silently resolve by script load order. The clearest artifact: 22 separate registrations at order 38, forcing later features into decimals — `38.4`, `38.5`, `38.6`, `38.7`, `38.8`, `38.9` across realestate.js, armor.js, empire.js, activities.js, gigs.js, island_military.js.
6. **Every object type hand-rolls its lifecycle.** Tracing the humble coin pickup: array declared in config.js:22, mesh+spawn in entities/coins.js (positions hardcoded at :38-39), behavior spliced as an `if` block into the monolithic `updateInteractions()` (systems/interactions.js:32-52, shared with keycards/doors/breakers/cameras/vents), HUD in economy.js:74 + hud.js, plus index.html. **Adding a "placeable campfire" today = edit 5–6 files, three of them shared.**

## I.3 What's already good (build on, don't replace)

- The **try/catch-isolated, order-sorted update loop** (loop.js:91-102) — one crashing system can't kill the frame.
- The **city interaction registry** (`city/interactions.js:2-38`, "THE INTERACTION REGISTRY" — `registerFor`/`registerZone`) — the team already invented the right pattern; it just wasn't applied to props/pickups.
- The **collision broadphase** with `markCollidersDirty()` + auto-rebuild (physics.js:40-66) and the `platforms` walkable-surface array (physics.js:230-247) — both accept runtime changes today.
- The **landmass/region plugin registry** (`worldmap.js`: `addLandmass(fn, order)`, `registerCityRegion`, `registerWorkAnchor`) — a real component-registration pattern in production.
- The **persistence opt-in pattern** (netpersist.js:130-134): any system exposing `serialize()/apply()` rides the world blob (gangs, NPC ledger, wall damage via `cityFracture`, property market).

---

# Part II — The enabling architecture

## II.1 The paved-road conventions (additive; no big-bang)

**A. Entity/prop registry** — generalize `city/interactions.js`'s registry to all world objects:
```js
CBZ.registerPropType({
  id: "campfire",
  build(pos) { … return { mesh, colliders } },
  onUpdate(dt, inst) { … },
  onInteract(ctx, inst) { … },
  save() { … }, load(data) { … },
});
```
One generic loop iterates instances; no new object type may splice an `if` block into a shared function again. This registry is the substrate for **deployables** (Part IV) and **data-driven city prefabs** (Part III). Migration: port coins/crates first as proof; old and new coexist.

**B. Named priority bands** — `CBZ.PRIO = { PHYSICS: 10, AI: 30, GAMEPLAY: 40, ECON: 45, PRESENTATION: 60, HUD: 80, PERSIST: 90 }` (constants over the existing numbers, which stay valid). A one-time `console.warn` on exact-collision registrations. New code must use bands; the `38.x` pileup ends.

**C. A contracts index** — one `src/core/interfaces.js` doc-block enumerating the ~15 load-bearing cross-file contracts (feelDt, `CBZ.collide` signature, `colliders`/`platforms` shapes, `serialize/apply`, region records, day-phase API) with file:line pointers. Documentation, not a type system; review-gated.

**D. Domain accessors over raw pokes** — thin read facades (`CBZ.Player.pos()`, `CBZ.City.arena()`, `CBZ.Econ.price(good)`) introduced additively. New code uses them; old code untouched.

**E. Folder moves only opportunistically** — never as a standalone diff.

## II.2 OSS composability: Vite + compat shim + adapter convention

**Today:** three.js **r128** UMD from CDN (index.html:245) + `examples/js` loaders from unpkg (246-247); no package.json, no bundler; all 239 source files read `THREE`/`CBZ` as globals; `src/vendor/` holds just BufferGeometryUtils.js and noise.js.

**Recommendation: Vite with a strangler-fig compat shim** (over pure import-maps, because real OSS repos need npm dependency resolution — rapier3d's WASM loader, three-stdlib sub-imports, shader-chunk imports):

1. Add `package.json` + Vite; `three` becomes an npm dep.
2. New entry `src/bootstrap.js` (type=module, loads first): `import * as THREE from 'three'; window.THREE = THREE;` plus any addon globals the legacy code touches; then the 241 legacy `<script>` tags load **unchanged** and find `window.THREE`/`window.CBZ` exactly as before.
3. New code lives in real ESM (`src/integrations/**`, `src/sim/**`) inside Vite's module graph — it can `npm install` any GitHub repo. Legacy files are static passthrough; their `?v=` busters become irrelevant as files migrate.

**The adapter convention** — every vendored OSS repo gets `src/integrations/<feature>/{vendor/ (unmodified upstream), adapter.js}`. The adapter is the *only* CBZ-aware file: binds upstream into `CBZ.scene`, the update loop (`CBZ.onAlways`), quality tiers (`CBZ.qualityLevel` from quality.js), day/night uniforms (`CBZ.sunTint`/`sunHeight`/`nightAmount` from daynight.js), terrain queries (`CBZ.terrainHeight`). Mandatory `build()/dispose()` lifecycle + quality scaling. Upstream is never edited, so it stays updatable.

**Worked example (grass):** vendor a grass repo under `src/integrations/grass/vendor/`; `adapter.js` self-defers via a cheap `onAlways(-1, tryBuild)` until `CBZ.scene && CBZ.terrainHeight` exist, instantiates the field with `getHeight: (x,z) => CBZ.terrainHeight(x,z)`, blade count from a per-quality-tier table, and per-frame feeds `time/wind/playerPosition/sunColor` uniforms. Zero upstream modifications; participates in adaptive quality. The same shape then wraps water, clouds, rapier physics, character controllers.

## II.3 The three.js upgrade (staged, medium effort, medium-low risk)

- Codebase is already 100% BufferGeometry (zero `THREE.Geometry` hits) and overwhelmingly `MeshLambertMaterial`/`MeshBasicMaterial` — both fine on modern three. Exactly one custom ShaderMaterial file (`city/interiormap.js`).
- Actual breakage surface: `renderer.outputEncoding = THREE.sRGBEncoding` (renderer.js:22 — one line, renamed to `outputColorSpace`); the vendored `BufferGeometryUtils` (`mergeBufferGeometries` → `mergeGeometries` rename — e.g. terrain.js:443); the two `examples/js` loader tags → ESM imports.
- **The real risk is visual**: ColorManagement default flip (~r150) re-interprets every hex color (the entire tuned palette: `CBZ.COL` config.js:82-101 + hundreds of inline colors), and physically-correct lighting changes every intensity (lights.js:10,14; config.js:202-207). **Mitigation:** upgrade the library but pin legacy behavior (`THREE.ColorManagement.enabled = false`, matched output color space, legacy light scaling), rendering byte-similar; re-tune palettes later and only if wanted. Estimated 3–5 focused days including regression passes across all three modes.

---

# Part III — Componentized infinite cities

## III.1 What "hand-built" actually means here (it's better than feared)

- The mainland is **grid-algorithmic but singleton**: `CBZ.CITY = { center, blocks: 6, block: 34, road: 16 }` (config.js:213-217) → `CBZ.buildCity()` builds an N×N block grid and lots (world.js:46-61, 298-315) — but it's **memoized** (`if (city) return city`, world.js:47), called from exactly one place (mode.js:158), and 88 of 117 city files reach through the `CBZ.city` global. There is only one city because there is one call site and one config block, not because the algorithm can't be parameterized.
- **Buildings are already descriptor-driven**: one generic constructor `makeBuilding(root, ox, oz, w, d, storeys, color, doorSide, opts)` (buildings.js:1867) + a 26-entry `SHOPS` data array (buildings.js:1798-1825); interiors dispatch by trade string through `furnishInterior(b, kind, door)` (buildings.js:3011) — door-relative, not coordinate-hardcoded. Hand-authored exceptions exist (mega-tower buildings.js:4301; the name-keyed Velvet Club interior :3210-3280).
- **Feature systems attach by role scan, not coordinates** — bank.js:855-864, club.js:370-381, clothingstore.js:524-534 all search lots for `shop.kind === "<trade>"`… with the same ~150-line lookup/gate/state-machine block duplicated three times.

## III.2 The headline finding: generation two already ships

`towngen.js` (512 lines) is a **fully generic seeded town generator**: `CBZ.buildTown(root, cfg)` takes `{cx, cz, cols, rows, blockW, blockD, roadW, pattern: grid|mainstreet|organic, zoning, prefabs, density, palette, rng, skyline, region}`, does street networks, recursive jittered lot subdivision, ring-based zoning with density falloff, weighted prefab picking, owner/vendor stamping — and calls the *same* `cityMakeBuilding` the mainland uses. `citytemplates.js` is pure data (6 town recipes with prefab lists). `minicities.js` uses a seeded LCG ("no Math.random in layout — owner rule #5") to place and build **4 distinct working mini-cities** (Goldspire/finance, Cape Harbor/port, Neon Reef/casino, Foundry/factory), registering regions, causeways, and work anchors. `expansion.js` is the older "grew once" bespoke way — generation one. **The mainland is simply the last hand-built thing left.**

## III.3 The CityKit target architecture

- **Component hierarchy:** *Parcel* (`{cx,cz,w,d,ring,zone,doorSide,door:{x,z,nx,nz}}` — already exactly what towngen's `subdivide()` emits) → *Building shell* (the `makeBuilding` opts vocabulary, documented as a stable schema) → *Floors/rooms* (the `furnish*` family, converted from a hardcoded `switch` to a keyed registry so a new trade is a table entry, not a new case) → *Furnishing sets* (extracted, individually registrable) → *Attachable roles* (one shared `CBZ.registerRole("bank", {find, mount, interact, save})` replacing the triplicated bank/club/clothing scan logic).
- **Seeded generator:** `seed → city config → street network → districts → parcels → prefab placement → role assignment → NPC/economy binding` — collapsing world.js's parallel hand-rolled grid into towngen's, and replacing the `CBZ.buildCity()` singleton with a keyed registry (`CBZ.cities[id]`, `CBZ.activeCity()` compat shim for the 88 call sites).
- **One data table for building types:** merge buildings.js's `SHOPS` with citytemplates prefabs so mainland and generated towns draw from a single registry; new business types are data.
- **Shared substrate with player building (Part IV):** a building is `{parcel, shell, interior(kind), role}` whether the generator or a player placed it. The `door:{x,z,nx,nz}` convention *is* a socket definition; parcel reservation and owner stamping already generalize.

## III.4 Migration milestones (each shippable)

1. Extract one shop type (e.g. clothing) into the shared component format; spawn it procedurally in a mini-city; verify the existing role scan picks it up unmodified.
2. Collapse bank/club/clothingstore lookup+gate+state into `CBZ.registerRole` (removes ~300 duplicated lines).
3. Merge `SHOPS` + citytemplates into one data table consumed by both pipelines.
4. Parameterize `CBZ.CITY` + world.js grid as a function of seed, reusing towngen internals.
5. Replace the city singleton with `CBZ.cities[id]` behind an `activeCity()` shim.
6. Re-generate expansion.js's island via the template pipeline (proves "grow a district").
7. Ship `CBZ.generateCity(seed) → cityId` for new landmasses/test cities — infinite cities validated without touching the shipped mainland.
8. Player construction on the same parcel/shell/socket/role primitives (→ Part IV).

---

# Part IV — Player building: Rust bases, Minecraft freedom, Roblox composability

*(Synthesized from a dedicated 27-agent workflow: 13 subsystem explorers → cross-cutting analyses → 7 system designers → an adversarial critic whose reconciliation verdicts are baked in below.)*

## IV.0 What exploration found: the seams exist, the abstractions don't

**Ready to reuse:** runtime collider add/remove is proven in production (`door.js` pushes/splices its collider + `markCollidersDirty()`; `buildings.js carveHole()` at :1034 hides wall meshes, splices colliders, spawns remnant flank/sill/header geometry, and replicates it via `fracture.js`'s coordinate-keyed serialize/apply/applyOne ledger — the single strongest precedent for networked runtime wall mutation). Walkable surfaces are data (`CBZ.platforms` records incl. ramps — a player floor is one pushed record; `groundAt()` handles stacking for free). `CBZ.assets.define/pool` is a data-driven prefab registry with InstancedMesh pooling; `placement.js` has a battle-tested spatial hash with `isFree/reserve`; `interactions.js` registers verbs without keydown listeners; `netPid()` provides stable player identity.

**The gaps:** no grid or snapping anywhere (every world position is a hand-typed float); `addBox()` makes a unique Mesh+Material+Geometry per call (the prison never adopted batching); `placement.js` rects are **XZ-only** (no Y range — the literal Sims problem); `assets.pool()` has **no removal/free-list** (players demolish constantly); colliders have no per-object ownership IDs; no HP/damage model for structures; nothing stacks because nothing can answer "what surface is at this point?"

## IV.1 One canonical record + the chunked engine (the reconciliation)

The critic's top finding: five designs independently invented five names (BuildPiece/Placeable/Piece/Structure) for what must be **one record**. Verdict adopted: **`src/systems/pieces.js` owns the canonical `Piece`**, and everything else extends it with optional field groups:

```
Piece {
  id, ownerId (netPid), baseId, kind, tier,
  gridPos {gx,gy,gz} | pos (authoritative: grid for structural, free for furniture), rot (quarter-turns),
  sockets [{localPos, normal, kind, mate}], supportedBy [], supports [],
  hp, maxHp, weightClass, maxLoad,
  colliderIds [], platformIds [], meshRef | instanceSlot, chunkKey,
  locked, keyId,            // doors/containers
  seq, createdAt            // net/persistence
}
```

`CBZ.spawnPiece(assetKey, opts)` / `CBZ.despawnPiece(id)` are the *only* constructor/destructor: they pair collider+platform registration generically, parent meshes under a 16m-chunk root, and defer splices via the `_reap` queue idiom (vehicles.js) so a raid killing 40 pieces mid-frame can't corrupt iteration. **`src/systems/chunks.js`** does incremental rebatching: per-chunk dirty flags drained by a debounced late-order updater; `sealed` pieces merge via batch.js's existing `mergeGeometries` machinery (1-2 draw calls/chunk) or per-chunk instanced pools; unsealed (under construction / being raided) pieces stay individual meshes — `unsealChunk()` re-expands for carve-level damage, re-seals after combat. **`CBZ.findSupport(x,z,yMin,yMax)`** — one shared support query (the two designs that each proposed their own were collapsed into this) built on the existing `groundAt` platform scan + `queryCollidersNear` — is the root fix for the Sims problem.

**Three spike tests before any Phase 1 code** (critic's riskiest assumptions): (1) retrofit a free-list onto `assets.pool()`'s InstancedMesh — instance 500, remove/re-add 50, check corruption/perf; (2) profile `markCollidersDirty()` full-rebuild cost at realistic collider counts to size the debounce (or justify incremental broadphase); (3) a 2-3 client jitter test of deterministic client-side placement validity near a chunk boundary.

## IV.2 The core building system (Rust-style)

**Pieces:** 7 kinds × 4 tiers as parametric catalog entries, not hand-authored: foundation (3×3m, graph root), wall / doorway / window variants, floor, stairs (registers a ramp platform — the player glides up via existing `groundAt` ramp support), roof, door (door.js clone + lock/owner fields). **Grid:** CELL=3m; `gridPos` integers are authoritative (world transform derived — no float drift; validity = O(1) occupancy-map lookup per base, spatial hash as the fallback vs. world geometry). **Sockets:** local-space typed connection points; placement raycasts, finds the nearest compatible unmated socket within ~0.75m, and snaps — this is what makes it feel like Rust, not freeform drag. **Tiers:** twig (free prototyping — the Minecraft-creative on-ramp) → wood (~250hp) → stone (~900) → metal (~2200); upgrade-in-place preserves the socket graph. **Structural integrity:** `supportedBy/supports` graph, stability = BFS hops from a foundation, per-tier cantilever caps, cascade collapse on removal (bounded recompute, children only). **Build UX:** hotbar piece strip (inventory.js slot pattern), ghost preview tinted green/red with a *reason* ("need foundation", "not enough wood"), Q/E quarter-turn rotation, confirm through the interactions registry; plus the critic's additions — an undo-last-placement verb and an inside-a-room placement fallback for when the camera ray is blocked by the room you're standing in.

## IV.3 Free placement & furniture (interior design becomes intentional)

The furniture layer shares the Piece record but skips the grid: **`findSupport` face classification** (normal.y > 0.7 = floor/tabletop, < −0.7 = ceiling, else wall) means chairs refuse walls, sconces refuse floors, and everything rests at a *computed* height instead of a hand-typed literal. **Sockets as snap-assist, never a requirement:** a table declares a tabletop socket, a shelf declares evenly spaced shelf-line sockets — a lamp near the table snaps *onto* it, centered and upright; free placement remains for everything else (wall-mount-only items like picture frames are the one `requiresSocket` class). **Stacking with physics-lite:** placement.js rects gain minY/maxY (a single shared PR — four designs depended on it), `weightClass/maxLoad` caps prevent infinite crate towers, and destroying a support walks `supportedBy`: children re-settle onto whatever is below or become one-shot falling debris via the existing `fx.dropDebris` — "blow up the table leg and everything on it crashes down" without a physics engine. **Move carries children:** picking up a table moves the lamp on it; cancel restores exactly. This is also the city's furnishing upgrade path: `furnish*` interior sets migrate onto the same spawn/support pipeline (the engine refactor's proof milestone reroutes one apartment unit through it).

## IV.4 Destruction & raiding

Per-piece HP with **material × damage-type multipliers** (melee ~nothing vs stone/metal; bullets chip wood; explosives are the raid currency — C4/rockets via the existing `explosives.js` integration). Carve-level visual damage reuses `carveHole()`'s remnant system on player walls (the critic flagged: wall meshes must be authored carve-compatible, not plain boxes — owned by the piece catalog). Support destruction triggers the IV.2 collapse cascade; destroyed containers spill contents as lootable drops. **Repair/replace** by hitting with resources in hand; **decay/upkeep** (below) is the offline-raid balance lever. The critic's honest gap, now owned explicitly in phasing: the **raid-tool balance table** (damage values, splash radii, tool tiers vs material tiers) is a dedicated design deliverable before the raid phase ships, and **server-side placement validation beyond size/rate/ownership** (anti-cheat for floating/overlapping structures) gets a named owner when multiplayer building opens — the SQLite authority layer (Part VII) is where those checks live.

## IV.5 Ownership & security (tool cupboard model)

All base authority roots in **one placed object — the Tool Cupboard**: placing it creates a `BaseRecord {id, ownerId, center, radius ~30m, authorizedPids:Set(netPid), upkeepPaid, keycodes}` and claims building privilege; foreign placement inside the radius is rejected as one more predicate in the shared validity pipeline (`CBZ.baseAt(x,z)` modeled on turf.js's `cityZoneOwner`). Bases expose `owner:{type:"player", id}` in the exact shape procedural buildings already use (buildings.js:4563), so turf/economy/wallet code works on player bases unmodified. **Doors:** door.js's proven shape + `{locked, keyId, code}`; keypads via `registerZone`; lockpicking reuses the roofloot.js timed-pry idiom, pick time scaling with door tier. **Containers:** contents are the same flat count-map as the inventory (zero new item schema); locked containers force-unlock when an adjacent wall is breached to 0hp — a raid exposes loot for anyone, Rust-style. **Clans:** a roster record; effective auth = union(explicit, clan members) computed at check time (no stale copies). **Griefing limits:** upkeep decay reclaims abandoned bases (~3 days lapse → TC radius lifts), TC radius blocks spite-walls, a `raidableAfter` grace protects brand-new bases. A **land-claim policy layer** (no building on roads/mission zones; where TCs may be placed at all) is a named content deliverable the critic caught as unowned.

## IV.6 Resources & crafting (gather → craft → build → defend)

**Nodes:** a new near-field harvestable scatter (instanced trees/rocks/scrap piles via `assets.pool`, ~2-4 draw calls, parallel to — not touching — wildnature.js's decorative backdrop), each registered in `CBZ.resourceNodes` with hp/yield/respawn timers (the roofloot.js RESPAWN pattern). **The city IS the scrapyard:** destroyed cars and shot-out street furniture roll Scrap/Metal drops through the same loot-roll shape economy.js already uses — raiding a chop-shop car is a resource action with zero new geometry. **Tools:** Hatchet/Pickaxe as craftable items with a per-tool harvest-bonus map, swinging through the *existing* melee path (node hit-test checked before actor hit-test — no new input or animation). **Recipes:** one small `src/systems/craft.js` registry; outputs are either tool items or **deployable items whose `buildPieceKey` names a piece-catalog entry** — the inventory's `useItem()` gains a third branch: deployables enter build mode. Tiering solves its own chicken-and-egg: the workbench is the one station-free recipe; forge unlocks metal; stations are checked by proximity query to placed Pieces. Crafting/materials integrate with the economy (Part VI): building consumes `materials.s`, and big builders move district prices.

## IV.7 Persistence & multiplayer sync

Build data rides a **fourth channel** modeled on fracture.js's proven incremental ledger — never inside the capped worldBlob. **Peer-authoritative events** (`bplace/bmove/bdamage/bdestroy` + host-arbitrated `bclaim` for simultaneous claims): each carries the owner's monotonic `seq` for dedup + last-writer-wins; every client applies optimistically on sight, so a guest's base survives a host crash. Structures need **no snapshot loop** (placement-rate, not per-frame) — the 10Hz networld pipeline is untouched. **Join-in-progress streams by chunk** using the existing scope-enter/leave hysteresis: a player who never visits a base never downloads it. Durable saves: per-plot dirty-flagged `bsave` with explicit size caps and *user-facing* trim feedback (silent loss is worse than no persistence). The ownership events (baseAuth/lock changes) adopt the same seq/LWW vocabulary — the critic caught the two designs using different conflict language. Long-term the whole channel lands in the `player_structures`/`containers` tables of Part VII.

## IV.8 Order of work + the walking skeleton

Critic-endorsed sequence: **(1)** pieces.js + chunks.js skeleton (Phase 0, additive, zero call sites — forces the schema convergence); **(2)** the three spikes; **(3)** migrate props.js + one furnished apartment as proofs (this produces `findSupport` for everyone); **(4)** the shared placement.js Y-range PR; **(5)** crafting phases 1-2 in parallel (no placement dependency); **(6)** core building on the Piece registry; **(7)** build-mode UX + deployable recipes together; **(8)** nav/LOS scaling before base density arrives; **(9)** integrity graph + furniture cascade as one shared system; **(10)** tool cupboard/locks; **(11)** persistence/sync on the frozen schema; **(12)** tiers, raid tables, containers, clans, streaming, upkeep.

**First shippable milestone:** single-player, one piece type — debug-granted wood wall → ghost preview snapped via `findSupport` → place with E → real collision → **stack a second wall on the first and stand on it** (the Sims problem fixed, literally) → demolish and watch collider/platform splice cleanly. It exercises the whole vertical stack with no sockets, tiers, persistence, or multiplayer — and validates the two most load-bearing assumptions first.

---

# Part V — The political simulation

Everything here promotes the **dormant stub that already exists** — `worldstate.js:70` persists `politics: {support, corruption, scandal, emergencyPowers, official: "Mayor Rosa Vale"}`, two wired Civic activities move those dials (activities.js:46-47, resolved :190-195), an `"assassination"` ledger event exists (worldstate.js:265-271), and Senator/Judge VIPs already walk with police escorts (vips.js:79-94).

## V.0 The persistent-population principle

A rule that governs every mechanic in Parts V and VI: **every person in the world is a stored individual with a coordinate at all times, and simulation events transition people — they never delete-and-respawn them.** The codebase already half-commits to this ("finite factions": a permanently wipeable ~40-officer police force, police.js:65-90; non-respawning gang rosters; the 600-entry NPC ledger with permanent death via `dropSid`; ledger entries already carry home/work anchors + last position and fast-forward their earnings offline, schedule.js:211-306). The plan completes it: the ledger becomes the **population registry** (backed by SQLite, Part VII) covering everyone — cops, soldiers, officials, billionaires, shopkeepers, citizens — each with identity, wallet, employer, home, relationships, and faction history.

**Everyone is at a coordinate, always.** Each person's position is a deterministic function of their schedule and the sim clock: home overnight → commute → workplace → lunch spot → bar → home. When the player approaches any point, the engine asks the registry "who is here *right now*?" and streams those specific people in at their actual positions — spawning is pure presentation, never random invention. This is what makes the world feel smart: the bartender you robbed last night is home asleep at 4am (and you can go to his house); the mayor really is at city hall at 10:00 and in the motorcade at 17:00; you can tail a billionaire from his penthouse to his HQ; a witness who saw you actually travels to the police station before the report lands (the snitch-run mechanic, gangs.js:983, already works this way — generalize it). Unloaded people advance along their routes mathematically (the `fastForward` pattern, schedule.js:248, upgraded from "accrue wages" to "advance position along schedule path"), so the answer is always consistent whether you watched them or not.

Regime changes, war, unemployment, and bankruptcies *re-assign* people (cop → former cop with his gun; conscripted worker → soldier → veteran; laid-off clerk → gang recruit pool), and every transition is visible and consequential.

## V.1a A world of countries — at least five, all different

The launch world is **not one republic**: it is **5+ countries of deliberately unequal size, wealth, and character**, each a data record so more can always be added:

- **Different shapes:** one country with 3 states and a metropolis, one with 2 states of mid-size cities, one a single-state island nation, one a poor rural country that is mostly villages, one a city-state. State and city counts are per-country data, never a fixed template.
- **Different wealth:** each country has a `wealthLevel` that seeds everything — cohort class mixes, starting treasuries, building stock, infrastructure. Poor countries have weaker currencies (the forex layer prices it), thinner police forces, more informal economies.
- **Different demographics:** each country/region carries a **population config** — skin-tone distribution, culturally coherent name pools (first + surname sets per region), and dress palettes — so an African-inspired nation's population is predominantly dark-skinned with its own name pools, an East-Asian-inspired one likewise, etc., exactly as the real world varies by geography. Demographics and wealth are **independent config axes** (the fiction can have rich and poor countries of any demographic); makePed reads the spawn region's config for skin/name/dress rolls, and migration (V.6) mixes populations over time — port cities polyglot, remote villages homogeneous.
- **Different architecture:** settlement tiers per region — **metropolis** (tall towers, the existing skyline machinery), **town** (the towngen mid-rise kit), and **village** (a new hut/shack prefab set for towngen: mud-brick, thatch, corrugated-roof shacks, dirt paths, wells — the same parcel/socket substrate, different prefab data). A poor country's capital can still raise a few towers over a sea of shacks; a rich one's countryside still has villages.
- **Relations:** countries (and states, and even rival cities) carry a standing **affinity matrix** (−100..100) seeded by history flavor and moved by events — trade deals, insults, wars, refugee waves, sports rivalries. Affinity feeds everything: tariffs and border friction (nationalism), migration destination choice, alliance/war pressure in the transition graph, even street-level NPC reactions to foreigners under hostile regimes.

## V.1b Hunger — every character eats, like Minecraft

Every person — player and all NPCs — carries a **hunger stat** (0-100). The player's works like Minecraft: eating food items fills it; high hunger blocks sprint and health regen, starvation damages. NPCs eat through their wallets (the cohort/ledger food spending that already exists becomes literal meals), and **hunger drives behavior**: a hungry NPC seeks food first (routine override), a broke *and* hungry NPC **steals** — shoplifting spikes, pickpocketing rises, food riots become possible when a district starves. This closes the deepest loop in the plan: **war/inflation → food prices ↑ → the poor go hungry → crime waves and unrest → approval collapse** — famine as an emergent political force, not a scripted event. Farmland and food logistics matter; blockading a city's food is siege warfare.

## V.1 Political geography

The hierarchy is **country → state → city** (per V.1a, 5+ countries; the FIRST country maps onto the existing geography): State of **Liberty** (mainland Libertyville — the name already exists as Zillow's civic owner, zillow.js:71 — + annex + airport), **Costa del Este** (Goldspire, Cape Harbor, desert, farmland, speedway), **Westmark** (Neon Reef, Foundry, forest, snow). The military island (Fort Brandt: ~12 soldiers, 5 tanks, 4 helis, 6 jets, sealed causeway — island_military.js) is **federal territory**, which is what makes coups a national mechanic. New module `src/city/polity.js`: jurisdiction records `{id, kind, name, parent, rect, govType, treasury, taxRate, approval, mood, office:{holder,deputy,termDay,electionDay}, warWith, warRemain, warIntensity}` — war fields deliberately named like gang records (gangs.js:260-263) so the war director generalizes. Cities **self-register** (`CBZ.polity.registerCity`) — called by minicities today, by the Part-III generator tomorrow; states auto-split past 4 cities. Infinite cities scale for free.

## V.2 Offices, elections, assassination

- **Officeholders are real ledger NPCs** (new cast key `"official"` in schedule.js's castKey/actOf): city-hall hours, a 17:00-19:00 public-appearance window (podium + crowd), motorcades with bodyguard escorts (the squad-shield behavior already exists, config.js:447-454). Assassination is free — they're ordinary peds, so `cityKillPed` routes it: max heat, panic (`cityPostEvent`), `cityEvent("assassination")`, and the **succession state machine**: deputy sworn (if stability ≥ 0.3) → else snap election in 2 game-days → else **power vacuum**: the strongest gang's boss becomes de-facto ruler and `govType → anarchism` until restored. NPC death is already permanent (ledger `dropSid`, schedule.js:342-345), so a dead mayor stays dead.
- **The clock:** daynight is a continuous 150s cycle with no day counter — polity.js adds `worldDay` (persisted). Mayor elections every 7 days (~17 real minutes), governor 14, president 28, staggered.
- **Voter blocs computed from real data, per district:** population share from ledger home anchors; wealth axis from Zillow district values; worker axis from the ledger job census; **gang intimidation** — districts inside hostile turf get `turnout ×0.6` and shift 20% of votes to the gang's pick (the player's pick, if it's the player's gang). Candidate score = `40 + 0.5·approval(incumbent) + 12·charisma + platform·bloc·15 + momentum + fraud`.
- **Player levers:** rally attendance/disruption, donations, attack ads, ballot-office heists (`fraud +10`, discovery risk `scandal +25`), intimidation canvassing, and **running for office** as endgame (filing fee + `reputation.political ≥ 40`; then you set taxes, direct police posture, embezzle — judged by the same approval equation; recall below 20%).

## V.2b One protector system: secret service, hired security, militias, gangs

**Everything that guards anything is the same system.** The codebase already ships four disconnected prototypes: Senator/Judge VIPs walk with police escorts and MAGNATEs with 2-3 suited SMG guards (vips.js:11-14, 79-94); the squad coordinator already "posts a shield on a protectee" (config.js:447-454); gang members already guard bosses with rank/loyalty stat sheets and avenge them (gangs.js); stationed guards already hold posts with drift-back logic (island_military.js gate guards). The plan converges all of them onto one `ProtectionDetail` record:

```
ProtectionDetail { id, principal (person | base | outlet), memberIds [registry people],
  gearTier, formation, postings, fundingSource (treasury | wallet | gang treasury),
  wageRate, loyalty (per member, from the existing 5-axis relationship rows), legalStatus }
```

The four flavors are **parameterizations, not systems**:

- **Secret Service** — the president's detail (governors/mayors get smaller ones scaled by office): elite gear tier through the existing armor system, treasury-funded, motorcade + podium coverage during the V.2 schedule, body-on-the-principal shielding, and it *grows after failed attempts*. Killing a president through a full detail should be an endgame heist, not a lucky shot.
- **Hired security** — anyone with money buys the same machinery: recruit guards from the registry (the careers.js recruiting flow + wealth-tier bodyguard discounts already exist), **arm them yourself** — a guard's loadout is literally the weapon items you hand them, so a player who buys rifles fields rifle guards — and assign them to protect you, your family, your base (Part IV), or your business outlets. Billionaires' details are this exact system, NPC-driven.
- **Militia** — hired security past a headcount threshold becomes a *faction*: it needs wages (a real funding stream), a base to muster at (the tool-cupboard plot), and it inherits the gang machinery — turf capability, the war-shape combat formations, treasury, standing. Regimes react to it: fascist governments deputize friendly militias, democracies restrict private armies (a legal-status heat mechanic), anarchist collapse makes them the only law. Former cops and veterans (V.0/V.6 transitions) recruit cheaper and fight better — your militia is *built out of the simulation's own casualties of history*.
- **Gangs** — already the working implementation; a gang crew guarding its boss IS a ProtectionDetail with `fundingSource: gang treasury`. The convergence means every improvement (formations, postings, loyalty) upgrades gangs, militias, security, and the Secret Service simultaneously.

**Shared consequences, because protectors are registry people (V.0):** every guard has a wallet, a family, relationship axes, and a price. Underpay them and they quit; mistreat them and loyalty rots; and the assassination meta writes itself — **the bribed bodyguard is the classic vector** (buy a member's grudge/greed through the relationship system), or get yourself *hired into the detail* as the ultimate infiltration. Killing a guard is a permanent registry death with family vendettas attached. One module (`src/city/protection.js`), one behavior set, four skins.

## V.3 Approval — legible, real inputs

Per jurisdiction, five normalized inputs: **econ** (property index + confidence + employment), **crime** (heat, Σ gang warIntensity, 7-day murder counter), **services/taxes**, **events** (decaying shocks: disasters −15, assassination −10, war declared −12/won +15), **propaganda** (0-20, bought from treasury).

```
target   = 50 + 28·econ + 26·crime + 18·services + events + propaganda
approval += (target − approval)·dt/τ,  τ = 90s
```
Surfaced via a POLITICS tab in charpanel (approval sparkline reusing the propMkt history-ring pattern), phone poll app, and killfeed headlines ("Mayor Vale slides to 31% after docklands massacre").

## V.4 Ideologies & regime mechanics (concrete effects only)

| Regime | Mechanics |
|---|---|
| **Democracy** | Baseline; elections; true polls |
| **Fascism** | Police ×1.6 aggression, faster heat; night curfew (wanted accrual 23:00-05:00); gang crackdowns; propaganda +12; rigged elections (`fraud +25`); **fake displayed polls** |
| **Communism** | Price controls (sell −40% but shop stock caps → shortages); nationalization (corporate Zillow lots → city); rental income −70%; property market frozen; zero unemployment but confidence decays |
| **Nationalism** | Border tolls/checkpoints at the causeway road points each city registers; +25% import prices; military bonus; polarized approval |
| **Anarchism** | **Police are not despawned — they are *transitioned*.** Every officer is a persistent person: on collapse each becomes a **former cop** (same ped, same identity, keeps gun and armor) who re-resolves by his own traits — some become private security you can hire, some join gangs, some form a vigilante militia that still "polices" their old beat for free or for protection money, some go home to their families. Taxes 0; gang expandW ×1.5, turf payday ×1.3; SEIZE everywhere; services collapse → deliberately unstable. When order is restored, surviving former cops can be re-hired (they remember what you did during the interregnum via the relationship axes) |
| **Dictatorship** | Fascism + no elections; assassination becomes the only ballot |
| **Monarchy** | The crown is a **bloodline, not an office**: succession runs on the family tree (`heirOf` — living spouse/consort regency, then eldest living child, then the collateral line), so dynasties are literal and *the family tree is the political map*. No elections; legitimacy replaces approval math partially (a `legitimacy` stat fed by lineage length, coronation pageantry, war glory, and royal marriages — marrying into another country's royal family is an alliance instrument). Court intrigue is the gameplay: assassinating the king just crowns the heir, so ambitious players must work *down the line of succession* (the game shows it, name by name) or marry in; a childless monarch makes the realm one bullet from a succession crisis (rival claimants = instant civil war factions). Constitutional-monarchy variant keeps elections for a premier under a ceremonial crown; absolute monarchy is dictatorship with inheritance. Regicide of the whole line → the throne falls to whoever takes it — warlord monarchs can *found* dynasties, including the player |

**Press freedom is the legibility mechanic:** under fascism/dictatorship the poll app lies (gap grows +1/day up to +30); *true* numbers come from talking to NPCs you have relationships with — that's how you time a revolution.

**Transition graph** (evaluated daily): democracy → emergency rule (approval<35 + crisis + military faction support; `emergencyPowers` +12/day, at 100 → dictatorship) → assassination → vacuum rolls (loyalist 45% / junta 30% / restoration 25%). **Coup** (country level): military faction < −20 and president approval < 25 → Fort Brandt convoy assaults city hall — a scripted battle the player can join **either side of**. **Revolution**: approval < 15 for 3 days + movement strength > 60 → riots (panic waves), militia spawns, regime flips. Movements grow from misery and **player funding**; sabotaging the economy (arson already feeds `w.economy.confidence` via worldstate events) is a coup lever.

Monarchy enters the graph two ways: **restoration** (a revolution or power vacuum can resolve to a claimant with lineage — a movement rallying behind an heir) and **foundation** (a dictator with high legitimacy, war glory, and a family tree can crown himself — the moment he does, succession stops being a coup lottery and becomes his bloodline, which is exactly why aging dictators do it). Exits: succession crisis → civil war between claimants; constitutional reform (crown kept, elections restored); or republican revolution — after which the family tree survives as *pretenders*, a dormant restoration trigger for generations.

## V.5 War

Generalize the working gang-war machine (declare/upkeep/decay: gangs.js:635-656, 1729-1733; treasury-funded raids; bodies-on-the-lot capture) to polities in `polwar.js`, with days for seconds and jurisdiction treasuries for gang treasuries. Causes: ideology clashes, border incidents, traceable assassinations, player false-flags. **Fronts** at the causeway chokepoints (soldier squads from the military kit, resolved by the existing capture rule; occupation flips a city's `parent`). **War economy:** +2%/day prices, rationing (stock caps → black-market boom), `propMkt.momentum` −0.004/day (buy the dip after peace), **conscription** — 15% of worker NPCs leave the streets via the finite-headcount system (population visibly thins). Player roles: mercenary contracts per front, arms smuggling through checkpoints, resistance sabotage under occupation, or ending wars from office. Civil war = a stalled revolution splitting the country record in two.

## V.6 The war machine: matériel, factories, conscription, family trees & desperate measures

**Matériel is counted, never abstract.** The finite-factions principle (wipeable ~40-cop force, non-respawning gang rosters) scales to nations: each country's arsenal is inventory rows — planes, missiles, tanks, ammunition, fuel stocks — seeded from what already physically exists (Fort Brandt's 5 jets + 1 bomber + 4 helis + 5 tanks + 4 trucks are literally counted, boardable objects today, island_military.js:561-632). War **consumes**: every front battle expends ammo and missiles, every sortie risks a counted airframe, and losses are gone until *produced* — no respawning hardware, just like no respawning people.

**Procurement closes the war→stocks loop with fundamentals, not sentiment.** At war, the treasury places real orders: Ironclad Arms (guns/missiles) and Granite & Sons (fortifications/materials) book government contracts as actual revenue → **defense stocks inflate in wartime through earnings**, upgrading VI.6's `eventTerm` boost into a fundamentals story. Factories need workers and `materials.s` to fill orders — which makes **strategic bombing an economic act**: destroy the enemy's factory outlets and their missile production line starves, visible in their arsenal table and their stock price.

**Conscription is demographic math.** The population registry knows exactly who is a soldier and who isn't. Policy tiers per country: volunteer force (payroll from treasury) → selective draft (pulls a percentage of working-age registry people from their jobs: employment ↓, production ↓, wages ↑ through the market — streets visibly thin via the finite-headcount system) → total mobilization (the economy craters while the front swells; rally-round-the-flag fights war-weariness). Every conscript is a person with a `person_transitions` row: worker → soldier → veteran (or a casualty — permanent, like all deaths). The guns-vs-butter tradeoff is real arithmetic: drafting factory workers cuts the very production the war demands.

**Family trees make consequences generational.** Partner/children/family links already exist in miniature (social.js couples and cliques; family.js spawns boss families with `protectGang` vengeance semantics). The registry generalizes them into a `family_edges` table (spouse/parent/child), which buys, for free: **inheritance** — a dead billionaire's shares pass to heirs, so assassination reshapes corporate ownership and creates dynasties; **political dynasties** — a slain mayor's daughter runs on the family name with inherited name recognition; **generational vendettas** — relationship grudge rows partially inherit down the tree (kill a boss, his son remembers); and **bottom-up war weariness** — every casualty ripples grief through their real family/friend network via the existing gossip propagation, aggregating into the approval equation. War becomes unpopular household by household, not by a dial.

**Natural resources are where the supply chains start.** Each country's endowment maps onto the biomes that already exist: oil in the desert (Meridian Fuel's wells), timber in the forest, ore and coal around Foundry and the snow range, food from the farmland. Extraction sites are company outlets employing registry people; they are the *source* of `fuel/materials/food` supply in their country's EconState, which makes countries **trade-dependent through the forex layer** — resource-poor Westmark imports Liberty oil across an exchange rate. That gives wars real motives (seize the oil biome, embargo a rival's ore) and gives sabotage strategic meaning: blow the wells and watch fuel prices, then everything downstream, move.

**Factories can be bombed — and construction companies rebuild.** Production sites are physical outlets: bomb Ironclad's plant and their missile production line (and stock) collapses; the arsenal tables stop refilling. Every destruction event — war fronts, disasters, raids, bombed factories, your C4 — creates **reconstruction contracts**: the owner or treasury pays Granite & Sons, which consumes `materials.s`, employs registry workers, and rebuilds the building through visible scaffolding states over days. Construction stocks boom *after* wars — the destruction→demand loop closes with a city that heals on screen, and a player who can profit from either half of the cycle.

**Nukes.** The strategic tier is counted like everything else: warheads per country, with delivery airframes that already physically exist (Fort Brandt's bomber). The full nuclear strike is *already implemented as a renderer* — disasters.js's nuke (flash, mushroom cloud, expanding lethal shockwave, lingering radiation) retargets to any city coordinate. Acquiring them is a slow, detectable industrial program (uranium from the desert/snow deposits + an enrichment facility — itself a bombable factory — + months of ticks + espionage leaks). AI countries hold them under deterrence math; actually firing one is the apocalypse rung of the desperate ladder: a district zeroed (thousands of real registry people die — the events table remembers every name), a fallout zone with property values at zero, global intervention, and total legitimacy collapse. Player endgames: sabotage the enrichment plant, steal a warhead (the ultimate heist), or be standing in the wrong city.

**Emigration & immigration are law — and people vote with their feet.** Each country has a migration policy (`open / quota / skilled-only / closed / emigration-banned`): a **president needs the political process** (approval-gated, takes days, opposition can block); a **dictator decrees it instantly, no vote**. Underneath, migration is individual: every registry person periodically evaluates a move — real-wage differential (through priceIndex *and* FX), war, inflation stage, regime type, unemployment, and family ties through `family_edges` (chain migration) — and emigrating is a `person_transitions` row that moves their home/work anchors to another country. Consequences compound: **brain drain** (the skilled and wealthy leave failing states first — billionaires flee with their capital, coupling migration to forex capital flight), refugee waves from war zones spiking destination rents, shrinking tax and conscription bases in the origin, and anti-immigrant politics feeding the nationalism axis in elections. Under `emigration-banned` (the authoritarian move — closing the borders is itself a rung on the desperate ladder), people flee illegally: border-escape attempts at the causeway checkpoints, coyote-run smuggling gigs for the player, and guards ordered to stop escapees — orders that feed the same defection/atrocity backlash math as every other desperate measure.

**Marriage is conditional — your wife can leave you.** Every marriage (the player's included) carries a **strain score** fed by real simulation state: poverty (household income vs the district's cost of living through the priceIndex — going broke strains the marriage; hyperinflation strains *every* marriage in the country), neglect (time since the player last came home, dated, gifted — the existing affection axis decays), danger (wanted stars, a kidnapped family member left un-rescued, gunfights at the house), and betrayal (flirting with someone else *travels through the gossip network* — she hears about it from her friends). Past the threshold she files: `endMarriage(divorce)` on the tree, she moves out (household change, possibly taking the kids — custody by bond scores), takes a cut of liquid assets, becomes an ex-spouse with a grudge row, and can remarry — you might meet her again on someone else's arm. A reconciliation window exists (win her back with presence and gifts) and the whole model runs identically for NPC couples, so a depression visibly produces a divorce wave and war widows/broken homes feed the misery indices. Gold-digger dynamics fall out for free: marry a billionaire, engineer the strain, file first.

**The desperate-measures ladder.** A losing regime escalates through options that each buy short-term capacity at compounding legitimacy cost — the simulation's job is to make collapse feel like history, watching a cornered government destroy itself trying to survive: deficit printing (→ inflation, the monetary layer) → nationalization of listed companies (shares → haircut bonds, capital flight, billionaires front-run it and move wealth abroad) → deposit seizures and forced war bonds → martial law and curfews → total mobilization → and at the bottom, atrocity-tier acts such as child conscription, which the simulation treats strictly as **war crimes, not strategies**: mass defection rolls in the military, families hide their children (registry transitions the game makes visible), foreign-intervention and revolution probabilities spike, approval floors collapse, allied factions abandon the regime — and a deposed dictator's endgame is the tribunal or the mob. The ladder exists so the player can watch (or trigger, or exploit, or die in) the full arc of a failing state.

## V.7 New modules & persistence

`polity.js` (registry/clock/serialize), `officials.js` (NPCs, motorcades, succession; wraps `cityKillPed` in the existing wrap-chain), `approval.js` (@ order 33.0), `elections.js`, `regimes.js`, `polwar.js`, `polui.js`. Persistence: one guarded line in netpersist's worldBlob beside npc/propMkt (`blob.polity = CBZ.cityPolity.serialize()`), plus a `politics2` section in the single-player worldstate ledger. Milestones: **M1 "The Mayor of Libertyville"** (one city, Mayor Rosa Vale as a real schedulable, assassinable NPC + approval + one election) → M2 five cities & electorates → M3 states & presidency → M4 regimes → M5 coups/revolutions → M6 war → M7 player candidacy + infinite-city scaling.

---

# Part VI — The interconnected economy (Sims-deep, nothing is a dead end)

## VI.1 What exists (audit verdict)

**Real simulation to build on:** the per-district drug market with flood-on-sale/scarcity-on-buy/mean-reversion/heat/turf multipliers and hot-tip events (economy.js:557-697) — *the template for everything*; the per-model car resale market (empire.js:61-108); the macro property index (mean-reverting walk 0.90–1.14 with momentum and shocks, economy.js:1056-1093) read by every Zillow listing; the NPC offline ledger with wallets/jobs/wages (`CITY_JOBS` with pay+hours, aigoals.js:264-315; activity rates, schedule.js:133-137); gang treasuries with real flows; rent ticks, elastic sinks, bank loans with compounding interest.

**Fake or dead-ended:** every non-drug price is a flat constant (`ITEMS`, economy.js:18-269); shops have infinite stock (economy.js:271-301, shops.js:253-261); `companies.js` is decoration (seeded cash, zero coupling to prices or the player); `VACANCY_BASE = 0` makes vacancies unreachable (zillow.js:46); robbery loot is money printed on spawn (rollCashFor, economy.js:731-756); robbing a till hurts nobody downstream.

**Write-only state waiting to be consumed (free depth — wire these up first):** `w.politics` {support, corruption, scandal, emergencyPowers} accumulates from activities but nothing reads it (→ Part V reads it); the `w.factions` map (police/military/extremists/public/… all clamped −100..100) is written constantly with zero consumers (→ approval inputs and coup triggers); `w.economy.confidence` is written by war/disaster events and never read, `taxes`/`insurance` never even written (→ EconState inputs); `w.world.panic/damage/fires/emergency` are tracked and decayed but affect nothing — property damage currently has **no** effect on Zillow values or rent (→ district value dips); `w.reputation.*` is write-only except one driver read; Cosa Nostra's `extortsBiz: true` flag (config.js:322) is never consumed anywhere (→ business protection rackets feeding gang treasuries); and the 4 mini-cities currently have **no** simulation hooks at all — ambient set-dressing only (→ they become real economies + electorates in Parts V/VI).

## VI.2 The macro core: `EconState` per jurisdiction

Per city (state/country aggregate up — same shape as Part V's jurisdictions): `{activity, employment, priceIndex, taxRate, treasury, policeBudget, goods: {food, goods, guns, drugs, materials, fuel, luxury: {s, d, p}}, legality}`. Hourly tick (order 29.5, before the 30.x money ticks; one game hour ≈ 6.25s) with legible equations:

```
p ← clamp(0.4, 3.0, p + 0.06·(d/max(1,s) − 1)·p)        // per good
s ← s + production − consumption
d ← d·0.9 + 0.1·baseDemand·pop·activity
priceIndex = Σ w_G·p_G
```
Daily settlement: `activity ← lerp(activity, wagesPaid/expected · employment · safety, 0.15)`; `treasury += taxRate·(wages+revenue) − police − reconstruction`. **Starting values are today's equilibrium** — day one changes nothing observable; only gameplay deltas move prices (migration safety).

## VI.3 The interconnection matrix (the heart of the ask)

Every feature reads and writes the three state pools (goods s/d, wallets, treasuries):

- **Crime/heat** → shoppers stay home (district `d` −), insurance surcharge on property tax, shop-closure rolls; police response scales with `policeBudget`.
- **Gang wars** → `materials.d += 8`, `guns.d += 4` per battle; gangs *buy* guns from the market with treasuries.
- **Player building (Part IV)** → every placed piece consumes `materials.s` and signals demand; player structures shift district property values; raid destruction spikes materials demand through the same channel as disasters.
- **Businesses** → earn × `activity` × category price; **buy inputs** and **pay wages into NPC wallets**; pay taxes. `companies.js` cash finally connects to real lot revenue.
- **Real estate** → propMkt momentum gets `+0.002·(activity−1) − 0.003·districtCrime + politicsBias` instead of pure random walk.
- **Jobs** → `wage = CITY_JOBS[job].pay × priceIndex × activity` (one shim in `wageOf`, schedule.js:138-141).
- **Politics (Part V)** → writes taxRate, policeBudget, legality, price controls (→ shortages → black-market boom), nationalization, rationing.
- **Disasters/destruction** → materials demand + treasury reconstruction spend + district value dips that recover over days.
- **Racing/casino/club** → purses come from a bounded entertainment pool fed by NPC spending (no longer printed); club prices ride `luxury.p`.
- **Drugs/guns** → existing district engine wrapped with city-level s/d and `legalityMul`; busts pop prices.
- **Robbery/fencing** → fence glut pricing (20 stolen watches tank the fence price); robbed vendors' wallets actually deplete.

## VI.4 NPC micro-economy: individuals + cohorts

- **Individuals (≤600 ledger NPCs):** wallets/jobs exist; add rent-due and employer links, and a daily spend split (rent → landlord — *the player, if they own the building*; food → debits `food.s` and credits the shop's business). **The circulation chain:** rob a till → vendor's ledger cash drops → misses rent → your landlord income drops → 3 misses → tenant vacates → `VACANCY_BASE` finally real → district values dip. You can rob a district into a depression.
- **Cohorts (the cheap trick):** everyone else is statistics — 5 districts × 4 income classes = **20 rows** `{pop, employedFrac, wallet, propensities}`, one trivial pass per game hour. Freshly spawned peds draw cash from their cohort's mean (closing the robbery money-printer), and robbery debits the cohort wallet.

## VI.5 Black market & legibility

Every good has a **legal channel** (shop shelf, priced `base × p × legality`) and a **black channel** (fence/trap/gun guy, priced with `riskPremium = 1 + 0.25·policeBudget + 0.06·wanted` and scarcity^0.7). Regimes reshape it: prohibition closes shelves and hands demand to the black channel ×1.6 (dealer golden age, bust risk ×1.5); legalization collapses street margins (dealer career craters). Rationing caps legal stock → queues get longer (reusing citystaff's line renderer) → smuggling gigs auto-become top-paying because gig rewards read `market.price`.

**The player must SEE it:** adboards become **live market tickers** (a new creative painter on the existing `cityAdMatFor` canvas pipeline — "FUEL $3.40 ▲", "SHORTAGE: BUILDING MATERIALS"); shop price tags move day-to-day with ▲▼ glyphs (shops.js already prints computed prices); threshold-crossing headlines through `city.note`; a phone Markets app with sparklines; district prosperity visuals — citystaff queue lengths repointed from company flavor to district `activity`, all-day shutters + FOR LEASE signs on closed shops (which list cheap on Zillow: buy the block during the bust you caused).

## VI.6 Stock market, real corporations, billionaires & the casino

**Real productive companies.** `companies.js`'s decorative holdcos become background landlords; a curated roster of **8 launch corporations** (new `src/sim/corporations.js`) each owns real outlets in real buildings across the mainland + mini-cities and books revenue from **actual simulated sales**: each hour, `outletRevenue = cohortSpend(district, good) × outletShareOfCityDemand`, minus wages (paid into NPC/cohort wallets), rent, inputs, and debt service. The launch roster maps to EconState good categories: **Bunbros** fast food (the owner's example — outlets in every city, sells `food`), **Royale Casino Corp** (operates the Neon Reef casino), **Ironclad Arms** (guns), **Granite & Sons Construction** (`materials` — earnings spike when the city gets destroyed), **Meridian Fuel**, **Zenith Media** (its multiple tracks press freedom — state control crashes it), **Goldspire Trust REIT** (wraps the existing zillow CORPS magnates; NAV reads real listing values), **Apex Dealership Holdings** (luxury). Player businesses can **IPO**: a maxed wealth.js BIZ converts into a listed company seeded from its live `bizRate()`.

**One exchange per country**, physically enterable — the existing GOLDSPIRE TRUST bank prefab (citytemplates.js:98-99) retagged `shopKind:"exchange"`, zero new geometry. Hourly price formation reuses the proven propMkt skeleton (economy.js:1069-1093 momentum/mean-reversion):
```
anchor  = P/E_sector × EPS(trailing real earnings)      // fast-food 18x, casino 14x, guns 10x…
price  ← clamp(price × (1 + revert·(anchor/price − 1) + macroTerm + momentum + eventTerm))
momentum ← momentum·0.62 + noise·vol + herdFlow          // retail cohorts chase trailing momentum
```
`macroTerm` reads jurisdiction `activity`; `eventTerm` takes shocks: war (+defense stocks), nationalization (−1.0, exchange closes under communism with shares converted to haircut "nationalization bonds"), an outlet destroyed (earnings hit — **burn a chain's restaurants and the stock falls**), founder assassinated (−25-55% + volatility + succession event). Player tools: phone STOCKS app + exchange-floor terminal, buy/sell/short, dividends, **real insider trading** (befriend an executive through the relationship system → see next tick's earnings surprise; replaces the fake "Insider Stock Play" op at wealth.js:439) with SEC heat, and exploitable **herding** — pump with well-timed buys, trigger retail momentum-chasing, sell into the herd, risk the investigation. A Dow-divisor **national index per country** runs on the adboard tickers.

**Billionaires are shareholders, not cash piles.** The transient billionaire archetype (peds.js:258-264) becomes a persistent ledger identity: `netWorth = shares × price + properties + cash`, marked to market with the same compositional pattern as the player's own net worth (economy.js:876-877). They ARE the existing MAGNATE VIPs (vips.js:11-14 already gives them suited SMG security) wired to a `companyId`, with executive schedules (HQ office / penthouse — and per V.0, you can tail them there). They **act**: expand outlets (buying lots via zillow), short rivals, fund political candidates by sector interest (Ironclad funds the hawks). Killing or kidnapping one is an economic act — stock shock, succession, maybe a board offer to a player holding enough shares.

**The casino** (one per country, Neon Reef's already-built casino prefabs): the fully worked minigame math already in activities.js:338-341 (blackjack 3:2 stands-17, single-zero roulette 2.70% edge, ~90% RTP slots) is kept — and **the house's side of every settled bet books into Royale Casino Corp's revenue**, alongside simulated whale action from rich ledger NPCs on a "gambling" schedule phase, so the stock moves even when you're not at the tables. High-roller room gated by wealth tier/DRIP; whales can be cheated or robbed; the vault heist targets a fraction of the company's real `cash` and prints a negative earnings surprise the next quarter. Buy shares — or take the company over at >50% and the wealth.js "Royale Casino Floor" business becomes your controlling stake's local franchise.

**Motorsport is corporate.** Car manufacturers become listed corporations too — each one *makes the actual car models* in the `CARS` catalog (economy.js:307-329), so the cars in traffic, on dealership lots, and in the player's garage are their products, and dealership sales book into their revenue. Every race-car driver is a **persistent registry NPC employed by a racing team**, and every team is owned by a car company (or a billionaire patron): team budgets come from the company's marketing spend, drivers earn salaries and fame (relationship/gossip ripples make winners celebrities you can befriend, sponsor, or fix races with), and results move the market — *win on Sunday, sell on Monday*: a championship bumps the manufacturer's brand demand multiplier at dealerships and nudges its stock; a star driver's death (crashes are real; so is assassination) is an event shock. The racing.js purse pool stops being printed money and becomes sponsorship spend from the owning companies. CEOs/owners are the same billionaire-shareholder NPCs — sabotaging a rival team's car before a race is stock manipulation with a steering wheel, and the SEC-heat mechanic applies.

Phasing: (1) Bunbros alone with real revenue + read-only ticker → (2) exchange building + trading for one stock → (3) full roster + index + dividends → (4) billionaire persistence + assassination shocks → (5) casino wired to minigame + whales + heist → (6) insider trading/SEC/manipulation/shorts → (7) political hooks (war booms, nationalization, campaign funding).

## VI.7 Modules & phasing

`src/sim/econstate.js`, `market.js` (with the safe shim `CBZ.market.price(good)` → falls back to 1.0 so every migrated call site is safe on day one), `npcecon.js`, `econnews.js`, `policy.js` (the write-API politics calls). Persistence: `blob.econ` beside `blob.propMkt`. Phasing: (1) dynamic **food** prices + visible tags → (2) all 7 categories + shim everywhere + tickers → (3) NPC circulation & real vacancies → (4) business supply chains (companies.js stops being decoration) → (5) crime/war coupling → (6) unified black market → (7) political economy (election → prohibition → black-market boom → crime wave → next election runs on safety) → (8) multi-jurisdiction arbitrage as the trade endgame.

---

## VI.8 Money: currencies, central banks, inflation & forex

**Three launch countries, three currencies** — split along the geography that already exists: **Republic of Liberty** (mainland Libertyville + annex + airport; Fort Brandt federal) → **Liberty Dollar (LBD)**, Liberty Federal Reserve; **Costa del Este** (Goldspire finance + Cape Harbor port + desert/farmland/speedway) → **Costa Real (CRE)**, Banco Central; **Westmark** (Foundry factory + Neon Reef casino + forest/snow) → **Westmark Krone (WMK)**, Westmark Reserve. A 4th country is a data row, not a system — jurisdiction records and the SQLite tables are already generically keyed. **Denomination rule:** every money-bearing record (player, NPC ledger wallets, cohorts, gang treasuries, company financials, jurisdiction treasuries, EconState prices, casino chips) carries a `currency` field defaulting to its owning jurisdiction's; the player gets a multi-currency wallet map, with `g.cash`/`g.cityBank` becoming compatibility getters over `wallet.LBD` so the 1000+ existing call sites need zero edits and **day one is observably unchanged**.

**The central bank** is a real institution: a building (Liberty Fed by city hall; Costa's inside the Goldspire Trust prefab; Westmark's in Foundry), a **governor NPC** — persistent, schedulable, assassinable like every officeholder, with market consequences on death — and an `independence` stat (0-1) that the regime erodes: democracies nominate and wait; dictators fire-and-replace at will, independence → 0. Levers with real transmission: the **policy rate** feeds directly into bank.js's existing `RATES` table (every mortgage/personal/auto APR moves); **reserve requirements** cap city-wide bank credit (`bankCredit ≤ baseMoney/rr`) through the existing loan-approval path; money supply `M = baseMoney + bankCredit`. **Deficits are financed by bonds first** — auctioned to billionaires, companies, and the player at `policyRate + riskPremium(debt/GDP, confidence)` — and whatever the auction fails to sell **gets printed** (`baseMoney += unfinanced`). Printing is never a button; it's what happens when nobody buys your debt.

**Inflation — one legible equation**, compounding daily into the priceIndex that already multiplies every wage, price, and rent:
```
π ≈ 0.6·(ΔM/M − ΔY/Y) + shortagePressure(goods d/s) + 0.15·atWar + adaptive expectations
```
Expectations amplify demand (velocity), so inflation feeds itself. **The political feedback the owner asked for:** the approval equation gains `−12·max(0, π − 5%)` — a direct anti-incumbent force — and savers visibly flee to hard assets (cohort hoarding feeds property momentum and FX demand). Price tags re-sticker on screen; adboards run a CPI line next to fuel and stocks.

**The hyperinflation doom loop**, staged (stable <5%/yr → elevated → crisis >50%/yr → hyper >50%/**month**): deficit → print → π up → confidence down → FX depreciation → import prices up → wider real deficit → more printing. Stage effects escalate from weekly repricing, to cash-in-advance shops and dollarization onset (NPCs demanding the stable neighbor's currency), to barter and black-market money-changer NPCs. **Endings:** austerity (sustained approval pain), **redenomination** (1,000,000:1 conversion with a ~30% deposit haircut that feeds straight into the riot/revolution mechanics), or full dollarization (central bank goes inert). Sustained hyperinflation is a standalone hard trigger in the regime-transition graph — a failing currency is one of the strongest president-killers in the game, exactly as specified.

**Forex** reuses the proven momentum/mean-reversion skeleton over a PPP anchor: `rate ← rate·(1 + revert·(priceIndexB/priceIndexA ÷ rate − 1) + carry(rate differential) + confidence/political-risk + tradeBalance + momentum)`. Physical desks at the central banks and **airport currency counters**; spread widens with instability. Under fascism/communism there's an **official rate vs the street rate** — black-market changers arbitrage the gap, and cash-smuggling runs across the causeway checkpoints compose with the existing laundering loop. Player gameplay: carry trades borrowed through bank.js, official/street arbitrage, **counterfeiting as the one player-controlled inflation lever** (fake bills literally increment baseMoney), and **Soros runs** — player sell orders feed the herding term, so you can genuinely break a weak currency, at the price of headline heat: *"Speculator Blamed as Westmark Krone Craters."* Billionaires front-run devaluations through the same insider-relationship channel — and per the coordinate model, you can tail one to the airport FX counter and read the trade before the announcement.

**War financing, end to end:** war → deficit spike → bond auctions → unsold → printing → inflation → approval collapse → emergency powers or revolution. You can win the war abroad and lose it at the kitchen table. Modules `src/sim/currency.js / centralbank.js / forex.js`; tables `currencies, central_bank_state, money_supply_history, fx_rates_history, bonds, bond_holdings, player_wallets`; daily monetary tick + hourly FX tick. Eight milestones from "second currency + airport counter" to "full doom loop + Soros run + third country online."

# Part VII — The SQLite + math backbone ("math and SQLite make the game smart")

## VII.1 Why the current persistence cannot carry the plan

The server holds the entire world as **one in-memory JSON object flushed to one file** (server.js:87-131); the hand-rolled WebSocket layer **kills any socket carrying a message over 1.5MB** (wsmini.js:8,54,100) — which is exactly why netpersist self-caps at 1.4MB and why the NPC ledger is LRU-capped at 600 entries (schedule.js:170, raised once already from 200 purely to fit the JSON budget). The math: 10,000 persistent people ≈ 2.8MB alone; +5,000 build pieces ≈ 1MB; +one exchange's price history ≈ 1.4MB → a full world is **5-8MB, 4-6× past the hard kill threshold**. The blob model fails the plan by construction.

## VII.2 The architecture: one schema, two hosts

**Server-side SQLite** (better-sqlite3 or node:sqlite — Node v22 is already running) becomes the authoritative world DB, replacing `server/worlds/<name>.json`; the debounced-flush pattern becomes debounced transaction commits. **Single-player runs the identical schema in-browser** via official sqlite-wasm + OPFS (localStorage fallback where OPFS is missing; one-time importer from the `CBZ_CITY_WORLD_V2` blob). Simulation logic (econ ticks, elections, the schedule fast-forward math) is written as plain JS functions over rows, callable from Node *and* the browser — **one simulation codebase, no SP/MP fork**. Legacy JSON blobs remain as import fallbacks, never deleted.

**Authority shift:** macro systems (population registry, econ ticks, elections, wars, market) move from the elected browser-host to the Node server — they must stay consistent across host swaps, and should tick even with zero players online (today a host disconnect freezes the world). Micro sim (per-frame peds, physics, hitscan) stays in the browser exactly as now.

## VII.3 The schema (core tables)

`people` (the population registry — sid, name, archetype, job, employer→companies, home/work→properties, wallet, faction, alive, x/z + **chunk_x/chunk_z**), `person_transitions` (the "why they are where they are" history — every cop→former-cop flip is a row), `relationships` (the 5-axis records, person↔player and person↔person), `jurisdictions/offices/officeholders/elections/election_results`, `companies/company_financials/shares/holdings/price_history`, `econ_state` (per jurisdiction × tick × good), `cohorts`, `properties`, `player_structures/containers/container_items`, and `events` — **the town's queryable memory** (assassinations, wars, regime changes; today's activity log keeps 24 entries and discards the rest). Chunk-bucket indexes serve the hot spatial queries ("who is near (x,z) *right now*" — the V.0 coordinate model's engine); composite (entity, time) indexes feed every sparkline.

## VII.4 Sync + the math

**Interest management replaces whole-world blobs:** per client, the server streams only people/structures within chunk radius (generalizing the existing point-to-point relay primitive) — no message ever represents the whole world, so the 1.5MB frame limit stops mattering. **Write path:** client intents → server validates against DB state → one transaction → delta broadcast to interested clients (this is also where build-event anti-cheat validation from IV.4 lives). **Tick batching:** each hourly econ tick is one `BEGIN…COMMIT` bulk transaction.

The math: **deterministic seeded ticks** — `(worldSeed, tick)` in, identical rows out (the codebase already bans Math.random in layout; extend the rule to simulation, making the world replayable/auditable from the events table). **Fixed-point integer cents** for all money (the current float accrual in schedule.js:261-264 drifts over a 10k-person multi-week world). **SQL aggregations replace O(n) JS scans**: `AVG(wallet) GROUP BY district` for cohort stats, `SUM(profit) per company per day` for earnings, `SUM(votes) GROUP BY candidate, district` for elections — the queries *are* the simulation's smart parts.

## VII.5 Migration (each step shippable)

(1) Server stores the existing blobs in SQLite rows, chunked — kills the 1.4MB cap with zero schema risk; (2) NPC ledger → `people` table, **LRU cap deleted**; (3) structures + containers tables (player building persists durably); (4) econ/market/political tables + server-side ticks (audit sim files for browser-coupling first); (5) single-player parity via sqlite-wasm + OPFS. Risks named: OPFS browser support (fallback path), porting sim modules to run DOM-free in Node, save-compat via the importers.

# Part VIII — Unified roadmap

**Phase 0 (foundations, ~1-2 weeks):** Vite + bootstrap shim (II.2); `PRIO` bands + prop-type registry + contracts index (II.1); first OSS integration (grass) as the adapter proof; SQLite blob storage on the server (VII.5 step 1 — kills the 1.4MB cap immediately); pieces.js/chunks.js skeleton + the three building spikes (IV.8 steps 1-2).

**Phase 1 (proofs, parallel):**
- *City track:* CityKit milestones 1-3 (III.4) — one componentized shop type, `registerRole`, one data table.
- *Sim track:* Economy milestone 1-2 (VI.7) + Politics M1 (Mayor of Libertyville); `people` table replaces the NPC ledger cap (VII.5 step 2).
- *Building track:* the walking skeleton (IV.8) — place, stack, stand on, demolish one wall type.

**Phase 2 (the substrate):** CityKit 4-7 (seeded mainland, city registry, `generateCity(seed)`); core building system + crafting on the shared parcel/socket substrate; economy 3-4 (circulation + supply chains, natural-resource extraction sites); structures/containers tables (VII.5 step 3); Bunbros + read-only ticker (VI.6 milestone 1); second currency + airport FX counter (VI.8 milestones 1-2).

**Phase 3 (depth):** Politics M2-M4 (electorates, states, regimes, migration law); economy 5-6 (crime/war coupling, black market, reconstruction contracts); building destruction/raiding + ownership/locks + persistence; exchange trading + full corporate roster + billionaires (VI.6 milestones 2-4); central bank levers + inflation live (VI.8 milestones 3-4); server-side authoritative ticks (VII.5 step 4).

**Phase 4 (the payoff loops):** Coups/revolutions/war (M5-M6) with counted matériel, conscription, and war financing end-to-end; hyperinflation doom loop + Soros runs + counterfeiting (VI.8 milestones 5-8); political economy (VI.7 #7); casino + insider trading + market manipulation (VI.6 milestones 5-6); family trees/inheritance; migration flows + border gameplay; the nuclear program tier; player candidacy; infinite cities live; single-player SQLite parity (VII.5 step 5); three.js palette re-tune if desired.

Sequencing rationale: Phase 0's conventions make every later feature a "1 new file + 1 registration" change instead of a 6-file splice; the city/building substrate must precede raiding and war fronts; the economy shim must precede political price levers; and every phase ships something a player feels that session.
