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

The plan is organized so each part ships value independently, but they compound: the architecture conventions (Part II) make everything else cheap; the city components (Part III) and player building (Part IV) share one piece/socket/parcel substrate; politics (Part V) and economy (Part VI) form one political-economy loop; the roadmap (Part VII) sequences it.

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

*(This part is being finalized from the dedicated 27-agent design workflow — placeholder pending its Round-3 output: core piece/socket building system; free placement & stacking that fixes the Sims problem; destruction & raiding; ownership & locks; resources & crafting; persistence & multiplayer sync; and the enabling engine refactor for thousands of runtime pieces.)*

---

# Part V — The political simulation

Everything here promotes the **dormant stub that already exists** — `worldstate.js:70` persists `politics: {support, corruption, scandal, emergencyPowers, official: "Mayor Rosa Vale"}`, two wired Civic activities move those dials (activities.js:46-47, resolved :190-195), an `"assassination"` ledger event exists (worldstate.js:265-271), and Senator/Judge VIPs already walk with police escorts (vips.js:79-94).

## V.0 The persistent-population principle

A rule that governs every mechanic in Parts V and VI: **every person in the world is a stored individual with a coordinate at all times, and simulation events transition people — they never delete-and-respawn them.** The codebase already half-commits to this ("finite factions": a permanently wipeable ~40-officer police force, police.js:65-90; non-respawning gang rosters; the 600-entry NPC ledger with permanent death via `dropSid`; ledger entries already carry home/work anchors + last position and fast-forward their earnings offline, schedule.js:211-306). The plan completes it: the ledger becomes the **population registry** (backed by SQLite, Part VIII) covering everyone — cops, soldiers, officials, billionaires, shopkeepers, citizens — each with identity, wallet, employer, home, relationships, and faction history.

**Everyone is at a coordinate, always.** Each person's position is a deterministic function of their schedule and the sim clock: home overnight → commute → workplace → lunch spot → bar → home. When the player approaches any point, the engine asks the registry "who is here *right now*?" and streams those specific people in at their actual positions — spawning is pure presentation, never random invention. This is what makes the world feel smart: the bartender you robbed last night is home asleep at 4am (and you can go to his house); the mayor really is at city hall at 10:00 and in the motorcade at 17:00; you can tail a billionaire from his penthouse to his HQ; a witness who saw you actually travels to the police station before the report lands (the snitch-run mechanic, gangs.js:983, already works this way — generalize it). Unloaded people advance along their routes mathematically (the `fastForward` pattern, schedule.js:248, upgraded from "accrue wages" to "advance position along schedule path"), so the answer is always consistent whether you watched them or not.

Regime changes, war, unemployment, and bankruptcies *re-assign* people (cop → former cop with his gun; conscripted worker → soldier → veteran; laid-off clerk → gang recruit pool), and every transition is visible and consequential.

## V.1 Political geography

Hierarchy **country → state → city** mapped onto real geography: State of **Liberty** (mainland Libertyville — the name already exists as Zillow's civic owner, zillow.js:71 — + annex + airport), **Costa del Este** (Goldspire, Cape Harbor, desert, farmland, speedway), **Westmark** (Neon Reef, Foundry, forest, snow). The military island (Fort Brandt: ~12 soldiers, 5 tanks, 4 helis, 6 jets, sealed causeway — island_military.js) is **federal territory**, which is what makes coups a national mechanic. New module `src/city/polity.js`: jurisdiction records `{id, kind, name, parent, rect, govType, treasury, taxRate, approval, mood, office:{holder,deputy,termDay,electionDay}, warWith, warRemain, warIntensity}` — war fields deliberately named like gang records (gangs.js:260-263) so the war director generalizes. Cities **self-register** (`CBZ.polity.registerCity`) — called by minicities today, by the Part-III generator tomorrow; states auto-split past 4 cities. Infinite cities scale for free.

## V.2 Offices, elections, assassination

- **Officeholders are real ledger NPCs** (new cast key `"official"` in schedule.js's castKey/actOf): city-hall hours, a 17:00-19:00 public-appearance window (podium + crowd), motorcades with bodyguard escorts (the squad-shield behavior already exists, config.js:447-454). Assassination is free — they're ordinary peds, so `cityKillPed` routes it: max heat, panic (`cityPostEvent`), `cityEvent("assassination")`, and the **succession state machine**: deputy sworn (if stability ≥ 0.3) → else snap election in 2 game-days → else **power vacuum**: the strongest gang's boss becomes de-facto ruler and `govType → anarchism` until restored. NPC death is already permanent (ledger `dropSid`, schedule.js:342-345), so a dead mayor stays dead.
- **The clock:** daynight is a continuous 150s cycle with no day counter — polity.js adds `worldDay` (persisted). Mayor elections every 7 days (~17 real minutes), governor 14, president 28, staggered.
- **Voter blocs computed from real data, per district:** population share from ledger home anchors; wealth axis from Zillow district values; worker axis from the ledger job census; **gang intimidation** — districts inside hostile turf get `turnout ×0.6` and shift 20% of votes to the gang's pick (the player's pick, if it's the player's gang). Candidate score = `40 + 0.5·approval(incumbent) + 12·charisma + platform·bloc·15 + momentum + fraud`.
- **Player levers:** rally attendance/disruption, donations, attack ads, ballot-office heists (`fraud +10`, discovery risk `scandal +25`), intimidation canvassing, and **running for office** as endgame (filing fee + `reputation.political ≥ 40`; then you set taxes, direct police posture, embezzle — judged by the same approval equation; recall below 20%).

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

**Press freedom is the legibility mechanic:** under fascism/dictatorship the poll app lies (gap grows +1/day up to +30); *true* numbers come from talking to NPCs you have relationships with — that's how you time a revolution.

**Transition graph** (evaluated daily): democracy → emergency rule (approval<35 + crisis + military faction support; `emergencyPowers` +12/day, at 100 → dictatorship) → assassination → vacuum rolls (loyalist 45% / junta 30% / restoration 25%). **Coup** (country level): military faction < −20 and president approval < 25 → Fort Brandt convoy assaults city hall — a scripted battle the player can join **either side of**. **Revolution**: approval < 15 for 3 days + movement strength > 60 → riots (panic waves), militia spawns, regime flips. Movements grow from misery and **player funding**; sabotaging the economy (arson already feeds `w.economy.confidence` via worldstate events) is a coup lever.

## V.5 War

Generalize the working gang-war machine (declare/upkeep/decay: gangs.js:635-656, 1729-1733; treasury-funded raids; bodies-on-the-lot capture) to polities in `polwar.js`, with days for seconds and jurisdiction treasuries for gang treasuries. Causes: ideology clashes, border incidents, traceable assassinations, player false-flags. **Fronts** at the causeway chokepoints (soldier squads from the military kit, resolved by the existing capture rule; occupation flips a city's `parent`). **War economy:** +2%/day prices, rationing (stock caps → black-market boom), `propMkt.momentum` −0.004/day (buy the dip after peace), **conscription** — 15% of worker NPCs leave the streets via the finite-headcount system (population visibly thins). Player roles: mercenary contracts per front, arms smuggling through checkpoints, resistance sabotage under occupation, or ending wars from office. Civil war = a stalled revolution splitting the country record in two.

## V.6 New modules & persistence

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

## VI.6 Modules & phasing

`src/sim/econstate.js`, `market.js` (with the safe shim `CBZ.market.price(good)` → falls back to 1.0 so every migrated call site is safe on day one), `npcecon.js`, `econnews.js`, `policy.js` (the write-API politics calls). Persistence: `blob.econ` beside `blob.propMkt`. Phasing: (1) dynamic **food** prices + visible tags → (2) all 7 categories + shim everywhere + tickers → (3) NPC circulation & real vacancies → (4) business supply chains (companies.js stops being decoration) → (5) crime/war coupling → (6) unified black market → (7) political economy (election → prohibition → black-market boom → crime wave → next election runs on safety) → (8) multi-jurisdiction arbitrage as the trade endgame.

---

# Part VII — Unified roadmap

**Phase 0 (foundations, ~1-2 weeks):** Vite + bootstrap shim (II.2); `PRIO` bands + prop-type registry + contracts index (II.1); first OSS integration (grass) as the adapter proof.

**Phase 1 (two proofs, parallel):**
- *City track:* CityKit milestones 1-3 (III.4) — one componentized shop type, `registerRole`, one data table.
- *Sim track:* Economy milestone 1-2 (VI.6) + Politics M1 (Mayor of Libertyville).

**Phase 2 (the substrate):** CityKit 4-7 (seeded mainland, city registry, `generateCity(seed)`); player building core (Part IV) on the shared parcel/socket substrate; economy 3-4 (circulation + supply chains).

**Phase 3 (depth):** Politics M2-M4 (electorates, states, regimes); economy 5-6 (crime/war coupling, black market); building destruction/raiding + persistence.

**Phase 4 (the payoff loops):** Coups/revolutions/war (M5-M6); political economy (VI.6 #7); player candidacy; infinite cities live; three.js palette re-tune if desired.

Sequencing rationale: Phase 0's conventions make every later feature a "1 new file + 1 registration" change instead of a 6-file splice; the city/building substrate must precede raiding and war fronts; the economy shim must precede political price levers; and every phase ships something a player feels that session.
