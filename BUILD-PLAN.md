# BUILD PLAN — executing MASTER-PLAN.md, one commit per step

Each step is one commit; each step unlocks the next. Status: `[ ]` todo · `[x]` done.
All steps follow the repo conventions: IIFE on `window.CBZ`, `node --check` every changed file,
never edit `src/config.js`, seeded LCG (never Math.random) for world state, decimal `onUpdate`
order slotted near related systems with a comment, `serialize()/apply()` for world-blob
persistence, idempotent `_xWrap` wraps for the single-player ledger, self-styled DOM panels,
new script tags added as a wave-comment block before `<!-- 5. quality + loop + boot -->`.
Waves are parse-verified; not play-tested per owner's standing rule.

## Stage W — Women & Families (the least-built part; first priority)

- [x] **W1** `entities/character.js`: add `c.build` ("m"/"f") to `makeCharacter` — narrower shoulders (arm x-offset 0.62→~0.54), tapered torso, hip-flared leg pivots, smaller head ratio, and a real long-hair mesh option (second box hanging from the neck, gated like `cap`). Animation is proportion-agnostic; nothing else changes. *Enables everything in Stage W.*
- [x] **W2** `city/peds.js`: `ped.gender` rolled ~50/50 (archetype-biased), threaded into `makeCharacter({build})` and `cityOutfitFor({sex})` — which activates the dormant dress branch at outfits.js:762. Split `FIRST` into `FIRST_M`/`FIRST_F`. `family.js`/`social.js` wife/mistress/spouse spawns pass `gender:"f"` explicitly. Women exist.
- [x] **W3** Crowds: `city/crowd.js` + `entities/crowd.js` per-instance `fem[]` flag varying the existing `put()` scale args + hair instance drop (long hair) — half the ambient crowd reads female with zero new draw calls.
- [x] **W4** Player gender: option on the character panel; rebuilds `playerChar` with `build`, wardrobe paints correctly.
- [x] **W5** Ledger: `schedule.js` stash/deal carries `sex`; `worth()` gains an `isFamily/_famId` clause so spouses/kids become ledger-worthy persistent people.
- [x] **W6** `city/familytree.js` (new): `family_edges` array `{kind: spouse|parent|child, a: sid, b: sid, since, endedAt, endReason}` — edges survive death. API: `addEdge/spouseOf/kidsOf/heirOf/serialize/apply` (netpersist auto-pickup). Force-mints sids at pairing time via `cityPedStash`.
- [x] **W7** Wire couples into the tree: `social.js` pairing becomes mixed-gender and writes spouse edges; `weaveFamilies` kids get parent edges; unify the `ped.family` type collision (array everywhere; family.js's role string moves to `ped.famRole`).
- [x] **W8** Households: `housing.js` units gain `occupants[]` + per-tier capacity; spouses/kids join the partner's unit; `family.js` families anchor through real housing units; `householdId` (lot key) on ledger entries. Families actually live together.
- [x] **W9** Inheritance: `cityKillPed` hook — heir lookup (living spouse → eldest child), ledger-cash transfer, zillow `ownerId` transfer for NPC owners; `citySocialDeath` stops severing links (stamps `endedAt:"death"` instead); mourning preserved.
- [x] **W10** Generational grudges: persisted grudge records keyed by sid, inherited at fractional weight by spouse/kids, restored on deal-in — kill a boss and his son remembers, sessions later.
- [x] **W11** Births: married couple + shared home + time → a crowd body is *promoted* into a named child (parent edges, small rig, household join) — population stays finite, "the crowd already contained this future person."
- [x] **W12** FAMILY panel: self-styled overlay showing the player's family + known NPCs' trees; dynasty surnames (kids inherit last names — upgrade the single-letter `LAST` to real surname lists per gender-neutral family name).
- [x] **W13** Marriage strain & divorce: per-marriage strain score fed by poverty (household income vs cost of living), neglect (affection decay), danger (wanted/kidnaps), and gossip-carried betrayal; past threshold the spouse files — endMarriage(divorce), moves household, asset split, custody by bond, remarriage; reconciliation window; same model for NPC couples (depressions cause divorce waves).

## Stage F — Foundations (make every later feature a 1-file change)

- [ ] **F1** `core/prio.js` (new): `CBZ.PRIO` named bands + one-time collision warn in dev; new code uses bands.
- [ ] **F2** `core/interfaces.js` (new): the contracts index — feelDt, collide signature, colliders/platforms shapes, serialize/apply, region records, day-phase API, with file:line pointers.
- [ ] **F3** `systems/proptypes.js` (new): `CBZ.registerPropType({id, build, onUpdate, onInteract, save})` + generic loop; migrate coins as proof.
- [ ] **F4** `systems/pieces.js` + `systems/chunks.js` (new, additive, zero call sites): `spawnPiece/despawnPiece/findSupport`, 16m chunk registry, reap queue, per-chunk dirty batching skeleton.
- [ ] **F5** `city/placement.js`: rects gain `minY/maxY` (default full-height so behavior is unchanged); `overlaps()` gains the Y test. The one shared PR four building systems need.
- [ ] **F6** `city/assets.js`: pool free-list (remove/recycle instances) — the most load-bearing gap; spike first, then land.
- [ ] **F7** Migrate `world/props.js` + `world/crates.js` compound props through `spawnPiece` (proof of the piece model; broadphase stats must match).

## Stage B — Player building

- [ ] **B1** Piece catalog (wood tier: foundation/wall/floor/stairs/roof/door) as `assets.define` entries with `sockets[]`; `CBZ.building.place(kind, gridPos, rot)` end to end (no UI).
- [ ] **B2** Build mode: ghost preview + hotbar strip + confirm/rotate/undo — **the walking skeleton**: place, stack, stand on, demolish.
- [ ] **B3** Socket snap + compatibility table (wall-on-foundation-edge feel).
- [ ] **B4** Structural integrity graph + cascade collapse (deferred reap; debris via fx).
- [ ] **B5** HP/damage: material × damage-type table; explosives integration; carve-compatible wall meshes.
- [ ] **B6** Tool cupboard + `BaseRecord` + placement rejection radius + door locks/keycodes + lockable containers.
- [ ] **B7** Resources & crafting: harvest nodes (instanced near-field scatter), tools, `systems/craft.js`, deployable items entering build mode; city scrap drops from destroyed cars/props.
- [ ] **B8** `bsave` persistence channel (fracture-style ledger) + upkeep/decay.

## Stage E — Economy & corporations

- [ ] **E1** `sim/market.js` (new): `CBZ.market.price(good)` shim (falls back to 1.0) + dynamic **food** prices + moving shop price tags with ▲▼.
- [ ] **E2** `sim/econstate.js` (new): per-jurisdiction EconState, hourly tick (order 29.5), all 7 good categories, daily settlement.
- [ ] **E3** Legibility: adboard price/CPI ticker creative + phone Markets app with sparklines.
- [ ] **E4** NPC circulation: ledger rent/spend, cohort wallets (20 rows), robbery debits cohorts, vacancies become real.
- [ ] **E5** `sim/corporations.js` (new): Bunbros with real outlet revenue from cohort spend; read-only ticker line.
- [ ] **E6** `sim/stocks.js` (new): exchange building role + buy/sell UI + price formation off real earnings.
- [ ] **E7** Full 8-company roster + national index + dividends + IPO for player businesses.
- [ ] **E8** Billionaires as persistent shareholder NPCs (MAGNATE VIP wiring, mark-to-market net worth, assassination shocks + succession via family tree from W9).
- [ ] **E9** Casino: minigame house-take books into Royale Casino Corp; NPC whales; vault heist = earnings shock.
- [ ] **E10** Motorsport: car manufacturers as listed corporations owning the CARS catalog models (dealership sales = their revenue); racing teams per manufacturer with persistent driver NPCs on salary; race results move brand demand + stock ("win on Sunday, sell on Monday"); purse pool becomes sponsorship spend; race-fixing/sabotage = market manipulation with SEC heat.

## Stage P — Politics & protection

- [ ] **P1** `city/polity.js` (new): jurisdiction registry (city→state→country over existing geography), `worldDay` counter off dayPhase wrap, serialize/apply.
- [ ] **P2** `city/officials.js` (new): Mayor Rosa Vale as a real scheduled ledger NPC (city hall hours, appearance window, 2 bodyguards), assassination → succession machine, `cityKillPed` wrap.
- [ ] **P3** `city/approval.js` (new): the 5-input approval equation @ 1Hz slices + POLITICS tab with sparkline.
- [ ] **P4** `city/elections.js` (new): 7-day mayoral cycle, 2 candidates, voter blocs from district data, campaign events, results feed.
- [ ] **P5** `city/protection.js` (new): unified `ProtectionDetail` — secret-service details for officials, hireable/armable security for the player, gang crews adopt the same record.
- [ ] **P6** `city/regimes.js` (new): govType state machine + first effects (fascist curfew, communist price controls via market.js, **anarchist collapse transitions cops → former cops who keep their guns**).
- [ ] **P6b** Monarchy: crown-as-bloodline regime — succession via familytree heirOf (spouse regency, eldest child, collateral line), legitimacy stat, royal marriages as alliances, visible line of succession, dictator self-coronation + restoration/pretender triggers.
- [ ] **P7** Militia: protection details past headcount threshold become factions (turf/treasury via gang machinery); regime reactions.
- [ ] **P8** `city/polwar.js` (new): state/country wars generalizing gang wars — fronts at causeways, counted matériel consumption, procurement contracts to corporations.
- [ ] **P9** Migration: policy per country (president legislates, dictator decrees), individual migration evaluation, brain drain/refugee flows, border-escape gigs.

## Stage M — Money

- [ ] **M1** `sim/currency.js` (new): multi-currency wallet map; `g.cash`/`g.cityBank` become LBD compatibility accessors — day one unchanged.
- [ ] **M2** Countries CRE/WMK registered; `sim/forex.js` rates (PPP+carry+confidence+momentum); airport FX counters + exchange desk.
- [ ] **M3** `sim/centralbank.js` (new): governor NPCs, policy rate wired into bank.js RATES, reserve-requirement credit cap.
- [ ] **M4** Inflation: π equation → priceIndex compounding → every price; CPI ticker; approval term −12·max(0, π−5%).
- [ ] **M5** Bonds: deficit → auctions (billionaires/companies/player) → unsold remainder printed.
- [ ] **M6** Hyperinflation stages + doom loop + redenomination/dollarization endings; Soros runs + counterfeiting.

## Stage S — SQLite backbone (server)

- [ ] **S1** `server/db.js` (node:sqlite): blobs stored chunked in SQLite — the 1.4MB socket cap dies.
- [ ] **S2** `people` table replaces the ledger blob (cap removed); chunk-indexed spawn queries.
- [ ] **S3** structures/containers tables; **S4** econ/market/political tables + server-side ticks; **S5** sqlite-wasm single-player parity.

## Stage O — OSS/Vite (workflow change; scheduled after core waves stabilize)

- [ ] **O1** package.json + Vite + `src/bootstrap.js` compat shim (legacy files untouched).
- [ ] **O2** First integration: vendored grass repo + adapter. **O3** three.js upgrade with legacy-visual flags.
