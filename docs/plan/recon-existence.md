# RECON: EXISTENCE/SPAWN ARCHITECTURE (verbatim scout report, 2026-07-27)

## 10-line summary

The "never watch it spawn" half of the owner's law is already real and centralized: `CBZ.npcTransitionSafe` (config.js:914) is one padded-screen/min-max-distance test reused by peds, crowd, citystaff, vehicles, police, interiors, and jail crowd to gate every spawn/promote/demote/flip. Wildlife sidesteps the problem entirely — it spawns its whole deterministic population once and never pools, so nothing is ever "not there yet." The "can't disappear once seen" half barely exists: crowd bodies recycle through a 48-slot pool keyed by distance/population-suppression, not by whether the player looked; the only continuity is `worth()`-gated (schedule.js) or curated-roster identity (`cityIdentities`), never sight-gated. There is no `_witnessed`/`seenByPlayer` flag anywhere in the codebase — `aim_dossier.js`'s crosshair read and `npcTransitionSafe` are both read-only. Vehicles are a fully anonymous, teleport-recycled pool except player-owned garage cars. citystaff's "SHOT stays vacant forever" is the closest working analogue of the law, but it protects a job *slot*, not a specific individual, and isn't save-persisted. Wildlife's own "kill the legendary and it's extinct forever" promise is *not* save-durable either — no serialize/apply hook exists for wildlife anywhere, so a reload resurrects it. Determinism (`hash01`/`seedStream`) gives unspawned/unmutated things "free" persistence (recomputed identically), but anything that accumulates runtime state (a wallet, a grudge, a death, a name learned) needs an explicit bank, and today only interaction/worth/curated-roster triggers that bank — not sight. The cheapest fix is a one-flag write at the handful of places that already compute "is this visible/on-screen right now" (peds.js `vis`, aim_dossier's `aimedActor`), feeding the ledger/identity machinery that already exists and already round-trips through save.

## 0. Correction
`STANDARD_ACTORS_ONLY` lives in **`src/city/crowd.js:61`**, not `peds.js`. `peds.js` owns the 95m render LOD (`VIS_D2`), `_spawnHidden`, and `roleHash`; `crowd.js` owns the promotion pool.

## 1. Peds/crowd
- **Shared unseen contract**: `CBZ.npcTransitionSafe(x, z, opts)` (`src/config.js:914-952`): padded screen region (NDC x:±1.28, y:±1.38, z:-1.05..1.05) + minDistance/maxDistance band (defaults 16/150m), forward-cone fallback pre-camera. Consumed by peds.js, crowd.js, police.js, interior_programs.js, regionlife.js, citystaff.js, arena_fights.js, vehicles.js, entities/crowd.js.
- **Spawning (peds.js)**: `spawnHidden = !opts.allowVisibleSpawn && g.state==="playing" && CBZ.CONFIG.NPC_SPAWN_HIDE!==false && !CBZ.npcTransitionSafe(x,z,{minDistance:18,maxDistance:150})` (`peds.js:773-775`). Hidden peds still simulate/walk (`peds.js:5067-5073`); flip visible the moment the padded screen test clears.
- **95m LOD**: `VIS_D2 = 95*95` (`peds.js:78`, tunable via `CBZ.refreshPedLOD`/`CBZ.pedLOD`), SHADOW_D2 42², ANIM_D2 58², FAR_D2 110². Render-only cutoff at `peds.js:5152`; ped never leaves `CBZ.cityPeds`; AI tick stride 4/10/20 (`peds.js:5161-5164`).
- **Promotion (crowd.js, STANDARD_ACTORS_ONLY)**: CAP=48 flat agents (`crowd.js:62`); PROMO pool of real rigs built once (`crowd.js:342,1259-1268`), only reassigned. `promoteSafe()/promoteOk()` gate via npcTransitionSafe (min 14/max 140) (`crowd.js:1393-1402`); `CBZ.cityCrowdSpawnAudit().spawnsInView` pinned 0 (`crowd.js:1403-1408`). Once promoted: "stay real at any range and while driving/dead; only an actual population suppression, death, teardown, or observation gate releases one" (`crowd.js:1467-1469`).
- **Demotion/recycling**: `park(e)` (`crowd.js:1297-1304`) teleports to PARK=(-4000,-4000), first calls `CBZ.cityPedStash(e.ped)`. Triggers: death (`crowd.js:1473-1479`); population suppression when far (FAR2=60², ≤10/tick) (`crowd.js:2258-2283`) — identity-blind, no looked-at check; teardown.
- **Ledger (schedule.js)**: `CBZ.cityPedStash`/`CBZ.cityPedDeal` (`schedule.js:255-401`) — STALKER-style A-Life: banks wallet/job/wealth/aggression/gender/hair/household/relPlayer into `led[sid]`, anchored at home/work. `cityPedDeal` grafts nearest DUE entry within DEAL_R2=45² onto a fresh body with offline fast-forward (`schedule.js:306-341`). Soft, position-keyed reincarnation; LRU cap 900 (`schedule.js:181,206-218`), never evicts live sid.
- **worth(ped)** (`schedule.js:188-205`): vendor, gang, nameKnown, bounty, protected household, dealer castKey, worker with relPlayer.seen && (|grudge|>8 || respect>12 || fear>14), worker with stable _jobLot, or cash>140. **Being looked at is not on the list.**
- **Permanent registry (identity.js)**: `CBZ.cityIdentities` — save-durable permadeath registry: `register(kind,name,extra)→{id,status,successorId,killedBy,killedAt,history[]}`, `markDead()`, `setSuccessor()`, `serialize()/apply()` round-trips via `worldstate.js:220,286` AND `netpersist.js:139,266`. Consumers: vips.js:310, gangs.js:607-629, racing.js:269-559, companies.js:140-323. These bodies are permanent members of CBZ.cityPeds (minted via occupy.js:186 cityPostNpc). Opt-in per system, never automatic.
- **Dossier**: aim_dossier.js is pure read (`aimedActor()` 12.5Hz at `aim_dossier.js:203-241`); writes nothing. `nameKnown` set only by interaction verbs (social.js:606,681,960-961, civilwar.js:378, govcomplex.js:1914-1934, migration.js:662) or curated pre-mint (crown/elections/regimes).

## 2. Wildlife (wildlife.js)
"NO POPULATION BUDGET — every species spawns its NATURAL population" (`wildlife.js:28-38,71-75`). `spawnAll()` (`:868-887`) once at build, seeded rng (makeRng(0x5EED10), `:86-96`); DENSITY=850, BIOME_SHARE, RARITY_WEIGHT {common:12,uncommon:4,rare:1}, PRED_MAX=0.20 (`:812-866`). Permanent objects; only removal is removeCarcass (`:1326-1332`). Far/calm animals FREEZE (`:2674-2712`) with feeding/hunt exemptions. Breeding logistic, per-species CAPS; "a species hunted to ZERO is EXTINCT — forever" (`:895`). **Legendaries** (`:878-886,896-897,923,1627,2973`): one per species, respawn:false, never bred, unique pelt. NOT save-durable (no wildlife serialize hook anywhere).

## 3. Vehicles/traffic
traffic.js pool (`:11-13,260-268`): `computeTarget()` (`:285-297`) near-camera density from roads × quality × hourDensityMul (`:270-284`); `recycleOne()` (`:300-354`) teleports farthest healthy idle non-owned car to `CBZ.roadPick({unseen:true})` (`:332-336`). Same object, anonymous pool. Far-region seeder every ~2.5s. Emergency vehicles: explicit spawn/despawn lifecycle, capped (vehicles.js:635-850). Player-owned garage cars excluded (`traffic.js:304,317`) and serialized ({name,color,mods}) in worldstate + netpersist.

## 4. citystaff
Posts = data; body minted inside near=170m (past the 150 auto-allow and 95 LOD: "invisible AND un-spawn-watchable by construction", `citystaff.js:254-261`), reaped past far=320 (`dropPost/man`, `:303-319,395-490`). "SHOT stays vacant. SWEPT comes back." (`:475-477`) — protects the SLOT not the individual; posts/lost NOT save-persisted.

## 5. Witness tracking today
- npcTransitionSafe: read-only.
- aim_dossier: read-only.
- nameKnown: interaction/curated only.
- cityIdentities: opt-in curated.
- REVERSE witness (NPC sees player crime): ped.witnessSev, reportState/reportT/reportTarget, ped.snitch (`peds.js:795,823-825`).
- CONFIRMED ABSENT: no `_witnessed`/`seenByPlayer`/`_everSeen` anywhere (grep zero hits). No write-side sight hook exists.

## 6. Persistence
worldstate.js (SP localStorage CBZ_CITY_WORLD_V2 + sqlite mirror, `:118-164`) and netpersist.js (MP host) both persist: player progression, property/garage/gang/campaign, **cityIdentities** (worldstate:220,286; netpersist:139,266). **netpersist ALSO persists CBZ.cityNpcLedger (`netpersist.js:138,265`; no trim server-side `schedule.js:170-176`) but worldstate (SP) does NOT** — SP reload loses every worth-civilian. NOT persisted anywhere: cityPeds live state, cityWildlife (incl. legendary kills), cityCars fleet, citystaff posts/lost.

## 7. Determinism interaction
hash01/hashN (Squirrel3, seed.js:32-56,85-92) = position-derived, order-independent: unspawned/unmutated things are FREE to forget (recomputed byte-identical). The law bites exactly when runtime-only state accumulates (wallet, grudge, death, learned name) — determinism regenerates the ORIGINAL, not the mutated. Today the bank is written only on interaction/worth/curated triggers, never sight.

## 8. Gaps
- A) "Nothing unseen needs to exist": essentially solved once, centrally.
- B1) Crowd bodies recycle with no looked-at check (only worth()).
- B2) worth-continuity is soft position-keyed reincarnation, LRU 900.
- B3) Vehicles fully anonymous except player-owned.
- B4) Wildlife over-satisfies by brute force (doesn't scale to peds/cars; not sight-gated).
- B5) Legendary permadeath NOT save-durable (reload resurrects).
- B6) citystaff lost-posts not save-durable.
- B7) No SEEN write exists anywhere.
- B8) cityIdentities opt-in only; a stared-at civilian never qualifies.
- SP/MP asymmetry: cityNpcLedger persists in MP only.

## 9. Cheapest primitives for a WITNESSED-PERSISTENCE block
1. One flag write at existing read-only choke points: peds.js `vis` compute (`peds.js:5152`) + aim_dossier `aimedActor()` sweep (dwell-gated `_witnessed = true` + timestamp).
2. Feed the existing worth() gate: add `|| ped._witnessed` at `schedule.js:188` — every seen civilian earns ledger continuity.
3. Escalate to cityIdentities past level/wealth/rarity thresholds (the "rare animal or high-level person" clause) exactly as vips/gangs/companies/racing already do.
4. Close the wildlife save gap FIRST (cheapest, highest-leverage): register legendaries in cityIdentities at spawn/first-sight, markDead() on kill, spawnAll() skips dead ids. Two call sites.
5. Guard the three demotion choke points: crowd.js park() (`:1297`), citystaff dropPost() (`:303`), traffic recycleOne() (`:312`) — a `_witnessed` check each (refuse to anonymize; divert to ledger/identity).
6. Block-Law shipping: CLAUDE.md entry + `CBZ.witnessAudit()` (witnessed actors recycled without a ledger write, pinned 0) + migrate peds/wildlife/citystaff in the same change.
