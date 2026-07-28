# GAMEPLAN.md — the engine master plan

Sits beside `PROCGEN.md` (how generation works) and `INFINITE-WORLD.md` (the far arc).
`CLAUDE.md` is the law; this is the BUILD ORDER the next months of waves run against.
Every number below is cited to the file it was read out of on 2026-07-27. Where two
source documents disagreed, the disagreement is named and one side is ruled the winner.
**No baseline in this document has been measured. Every ratchet ships REPORTING, not
failing, until somebody runs it and writes the number in** (the `propUseAudit` law:
an audit sat for weeks instructing the next person to pin `blocked` at 0; the first run
that ever executed it read **487**).

---

## 1. THE VISION IN ONE PARAGRAPH

OWNER, verbatim: *"all these features connect... plan how they all fit together and all
benefit my idea of making this a game engine where each great new addition benefits the
next idea — basically building lego blocks so building in the future is easier and so
this world can scale and start to feel more connected."* The world is already large and
already dense; what it is not is **compounding**. Every capability in this plan exists to
make the NEXT one cheaper: the witness block decides what has to exist, which is the only
reason a 10x world is affordable; the scale block decides what a settlement IS, which is
what lets an airfield stamp a town beside it instead of authoring one; the airfield turns
seventeen towns into seventeen destinations, which is what gives an airliner somewhere to
go and a fence somewhere to be climbed; the fauna ladder proves the same virtual-existence
ladder outside of people, on 3,400 animals, in one draw call. The through-line is
arithmetic, not ambition: **a thing that is not seen costs nothing, a thing that is seen
costs a bounded budget, and every "more" in this document is bought by making the bounded
set bounded rather than by making the renderer faster.** The four pillars are not four
features. They are one law applied to people, ground, sky and sea.

---

## 2. THE BLOCK GRAPH

**The pattern that works, cited from this week.** Four blocks shipped 2026-07-27 and every one is the
shape below: `CBZ.venueSite` (*a whole fence of any length is 2 draw calls*, three consumers, one real
deletion) · the ordnance bus (**six hand-rolled detonations migrated in one change**,
`blastAudit().handRolled` pinned 0) · `roombuild.js`'s awakening (zero callers → three, and waking it
exposed six latent bugs including anchors filed AT THE WORLD ORIGIN) · the alley law (`alleyGapAt`/
`alleyOk`, widths solved from the player capsule, one shared budget map across all six scatter passes).
**None added a subsystem.** Each REPLACED code the caller was writing anyway, shipped with its consumers
migrated, and left a counter behind. Everything below is held to that.

```
                       CBZ.worldSpan() / cityGridAudit().lots
        SCALE  ─────────────────────────────────────────────►  WITNESS
      (grid · detail budget · terrain ceilings · snow)      (tier 0/1/2 existence)
          ▲   ▲                                                  │   │
          │   └──── caps become DENSITIES, not totals ────────────┘   │
          │        (rigs-inside-the-horizon is the flat budget)       │
          │                                                          │
   cityGridStamp(city, place)                             witnessHorizon(kind)
   stamps the town beside a field                    witnessed() pins · Bank() before
          │                                          you anonymise · identities escalate
          │                                                    │            │
       AVIATION ◄──── landside anchor rect + keep-out ─────────┘            │
   (airfieldKit → airfield → airportRegister → airRoute)                    │
          │                                                                 ▼
          │  12 venueSite fences at h 2.4, zero geometry change          FAUNA
          ▼                                                    (school = 1 draw · far
        MANTLE ◄──── the fences were always the right height ──── proxy = 1 draw · legendary
   (jump → grab → vault: the perimeter becomes a decision)      = tier 2 on mint)
```

| block | one-line contract | what it BUYS the others |
|---|---|---|
| `CBZ.witness / witnessed / witnessHold / witnessBank / witnessHorizon` | the ONE answer to "has the player really seen this individual, and may you take it away" | scale gets population caps that can become densities · fauna gets its promotion trigger and its legendary permadeath · aviation gets airframes that keep livery and damage |
| `CBZ.cityGridStamp(city, place)` | ONE settlement generator — grid, ring zoning, parcelling, height policy, parks, parking, low-rise | aviation stamps a town beside a new field without authoring a second generator · witness gets a live parcel count instead of a literal |
| `CBZ.cityDetailBudget()` / `drawBudgetAudit()` | the full-detail building set is a **COUNT, not a radius** | every future wave that adds geometry: a tower past K costs ZERO new draw calls |
| `CBZ.hasSnowCover(x,z)` | the ONE answer to "is there snow on the ground here" | grip, weather, wildlife, tracks, snowboarding, tint AND the math gate's mountain invariant, off one field |
| `CBZ.worldSpan()` | the live world extent | nothing types a world-size literal again — scale waves move it and every density follows |
| `CBZ.roadCorridorMid(city, axis, opts)` | the derived midpoint of the widest free lane between registered places | ends the highwaynet re-measure treadmill; serves every future cross-country route and access road |
| `CBZ.airfieldKit(settlement)` → `CBZ.airfield(city, spec)` | a complete airfield DERIVED from a settlement's own published record | a new city never authors a field · every field publishes a keep-out, a region, an access road and a 2.4 m fence |
| `CBZ.airportRegister` / `CBZ.airRoute(craft, dt)` | the airport registry and the ONE route/flight-plan driver | the police jet, the 4 GA craft and every future airliner stop each owning a flight model |
| fauna tier ladder (`faunaAudit`) | a school is ONE draw call; all far fauna on Earth is ONE more | 10x animals at a fraction of today's draw cost; the first non-human proof of the witness ladder |
| `CBZ.mantleTry(actor, dt)` | jump → grab the top → jump again: the ONE traversal verb over a ~2.4 m obstacle | every `venueSite.fence` in the world (and the 12 new ones) becomes a decision instead of a wall |
| *(debt, not yet a block)* `CBZ.instancedProxy(records, opts)` | one InstancedMesh far-proxy carrying unbounded records | owed the moment a THIRD consumer needs `farcull.js:43-113`'s trick — see §6 wave 6 |

**Existing blocks these ride and must never re-author**: `npcTransitionSafe` (the spawn
guard, 9 consumers) · `cityIdentities` (round-trips both save paths already) ·
`cityStaffVenue` (a body only inside 170 m) · `venueSite` · `roadClearance`/`roadPick`/
`roadClamp` · `core/mission.js` · `contracts.js` · `predatorPack` · `killfeed` ·
`aircraft_doors.js`'s arc · `farcull.js` · `batch.js`'s TILE buckets.

---

## 3. PILLAR SUMMARIES

### 3.1 THE WITNESS BLOCK — what has to exist

OWNER: *"everything can spawn at horizon so user never sees it spawn but nothing not seen
needs to really exist physically but once seen it can't just disappear — it stays in
existence, especially if they see a rare animal or high level person."*

Two laws pulling opposite ways. **Law A is solved centrally already** — `CBZ.npcTransitionSafe`
(config.js:914-952), one padded-screen + distance-band test consumed by nine files. **Law B
does not exist**: the grep for `_witnessed` / `seenByPlayer` / `_everSeen` returned ZERO
hits. Every continuity path today is gated on `worth()` (schedule.js:188-205) or a curated
roster (`cityIdentities`), and **being looked at is on neither list.**

New file `src/city/witness.js` (~220 lines). **No Map, no Set, no registry keyed on the
actor** — that is the parallel-bookkeeping trap that killed `proptypes.js`. State is 3
numbers ON the actor; the ledger page is the only durable copy. Adoption is one line at
places that already computed visibility: `if (vis && CBZ.witness) CBZ.witness(p, dt);`
(peds.js:5152).

- **The dwell rule.** Tag at `WITNESS_DWELL = 0.45 s` (a saccade is 20-200 ms, a fixation
  200-350 ms — 0.45 s is comfortably past a glance), decaying at 0.5/s while not drawn.
- **The legibility rule, and it is the one that matters.** Dwell accrues at
  `clamp01((VIS_D − d)/(VIS_D − TAG_D))` — full rate inside 26 m (peds.js:71), zero at 95 m
  (peds.js:78). **A body 90 m away drawn eight pixels tall was not seen as an individual.**
  Without it, one boulevard tags 400 people.
- **The three-tier ladder.** Tier 0 VIRTUAL = pure `hash01` function of (x,z,seed), free and
  total. Tier 1 LEDGERED = a ~280 B page via `cityPedStash`/`cityPedDeal` (schedule.js:255-401,
  LRU 900). Tier 2 IDENTITY = `cityIdentities.register/markDead` (identity.js:54-85), already
  save-durable both paths. **Tier 0 is the whole reason 10x is affordable: 10x of nothing is
  nothing.**
- **Tier 2 promotion is DERIVED — adding a rare thing must never mean adding a row**:
  `a.legendary` · `cityTrueLevel(a) >= 40` (the TRUE level, never the claim) · `nameKnown` ·
  `bounty` · `factions.tier >= 2` · `_powerTier > 0`.
- **The demotion law**: `crowd.js park()` (:1297), `citystaff.js dropPost()` (:303),
  `traffic.js recycleOne()` (:312) — two lines each, `witnessHold` refuses tier 2 outright,
  `witnessBank` banks tier 1 first. `orphaned` is pinned 0 and **measured after a
  `stepSim` burst** so a body recycled during PLAY fails too.
- **The budget honesty.** ~6 tags/10 s in a dense street ≈ **2,100/hour against an LRU of
  900 — the witnessed set overflows the ledger in 26 minutes.** So "witnessed = immortal" is
  refused out loud: tier 2 is permanent (cap `WITNESS_IDENTITY_MAX = 250`, ~100 KB against a
  15 MB save); tier 1 expires at `WITNESS_DAYS = 3` (a game day is 150 real seconds → ~7.5
  real minutes). **A face you glanced at three days ago may be forgotten. A face you met
  yesterday may not.**
- **The horizon half** introduces **no new constant** — `witnessHorizon(kind)` reads the class's own draw
  radius live: ped 45/70/85/95/110 m (quality.js:65-73), vehicle 230/300/390/500/700, aircraft `fog.far`
  380/560/760/1000/1400. A thing placed past its own horizon **cannot be watched to spawn by
  construction**, which is strictly stronger than a padded screen box that auto-ALLOWS everything past
  150 m (config.js:925). Nothing is deleted: the two COMPOSE.

**Contract lines other pillars cite, verbatim:**
> **FAUNA / 10x.** "10x fauna spawns VIRTUAL (tier 0, `CBZ.hash01`-derived — zero objects, zero memory, byte-identical per seed), materialises as a real actor only when the horizon ring `CBZ.witnessHorizon('animal')` crosses it, and any individual the player actually looked at (`CBZ.witnessed(a)`) is lifted out of the field into the ledger and never re-rolled. A legendary is tier 2 the moment it is minted and its death is permanent through `cityIdentities` — which is a promise wildlife.js:895 has been making and not keeping."
> **AVIATION.** "An aircraft's horizon is `fog.far` (380-1400 m), not the ped's 95 m — so airframes may be created at range with no visibility guard beyond `witnessHorizon('aircraft')`. A witnessed airframe (you watched it land, you shot at it, you rode it) is tier 1 and keeps its livery, registration and damage; its `AIR_HELI_CREW` / `citystaff` bodies bank with it rather than evaporating."
> **SCALE / 10x WORLD.** "Population caps stop being TOTALS and become DENSITIES, because tier 0 costs nothing: `CBZ.CITY.crowd`, wildlife `DENSITY` and traffic's `computeTarget` all scale with area while the MATERIALISED set stays bounded by the same 48 / 40 / 40 rig budgets that exist today. **The number that must not grow is rigs-inside-the-horizon, and a 10x map does not change it.**"
> **ANY SPAWNER.** "`CBZ.npcTransitionSafe` stays the guard and is never removed. `CBZ.witnessHorizon(kind)` is the PREFERENCE that runs first — place past the class's own draw radius so the placement is safe from ANY camera angle, then let transitionSafe veto the residue. A spawner that adopts both cannot be watched to spawn."
> **ANY DEMOTER** (recycle / park / despawn / reap / suppress). "Call `CBZ.witnessHold(a, site)` first; true means you may not take this body. Otherwise call `CBZ.witnessBank(a)` before you anonymise it. `witnessAudit().orphaned` is pinned at 0 and it names your site."
> **ANY RARITY AUTHOR.** "You never register an identity yourself. Stamp the rarity the world already reads — `a.legendary`, a `cityTrueLevel` ≥ 40, a declared faction rung, a `bounty`, a `powerKit` tier > 0 — and the witness block promotes to tier 2 on first sight. **Adding a rare thing must never mean adding a row.**"

### 3.2 THE SCALE PLAN — what a city and a world ARE

OWNER: *"make cities 10x bigger with 10x more tall buildings and buildings that are even
taller, but parking lots and parks and 1-2 story buildings are important too"* · *"10x
bigger map, just scale the terrain, especially the sand area should be huge"* · *"the
mountains should have white snow area all around them"*.

- **The mainland "city" is 330 m across.** `6*52 + 18 = 330` (world.js:54-66, config.js:246-248).
  36 blocks, **one building per block**, storeys clamped `min(12, …)` (buildings.js:6226) with
  exactly one hardcoded 52-storey exception (buildings.js:5842-5843). **That is not a city
  needing 10x — it is a city needing a generator.** `makeBuilding` has no storey ceiling; the
  12 is policy. The cheapest tall-building win in this repo is deleting a `Math.min`.
- **The good generator exists and the mainland bypasses it** (PROCGEN.md §3 says so):
  `towngen.js` has recursive subdivision (:355-373), ring zoning (:345-352), per-template
  skylines, landmark caps (:506-516). `CBZ.cityGridStamp` makes towngen's grammar the
  implementation and the mainland one of its consumers. Three consumers migrated in the same
  change: `world.js`'s grid, `towngen.js`'s own path, `expansion.js`'s annex (whose separate
  `annex.lots` list `farcull.js:66-74` had to be specially taught about).
- **Height is a TABLE, not a clamp** — ring 0: 34-52 · ring 1-2: 20-34 · 3-4: 8-20 · 5-7: 3-8 ·
  8+: **1-2 with `max(0.18, d*0.72^ring)` build probability**. The low-rise is protected by
  CONSTRUCTION: `parkFrac 0.08` / `abandonedFrac 0.36` stay FRACTIONS and grow with the city,
  and a new **`parkingFrac`** makes surface parking a first-class parcel kind rather than the
  absence of a building. `cityGridAudit().lowRiseFrac` and `.parkFrac` are **FLOORS — they may
  only go UP or hold**, which is what stops a future "make it taller" wave from deleting the
  two-storey city. **A CLUSTER, NEVER A NEEDLE** (towngen.js:510 already requires ≥8 related
  towers before a landmark; the mainland inherits it).
- **Wave-1 sizing, no ceiling touched.** `blocks 6 → 11` ⇒ 590 u (×1.79 linear, ×3.2 area),
  half-extent 165→295, **Δ = 130 u**. Every landmass in `SPREAD_V5` walks out by the same 130
  along its bearing so **no strait narrows**; union 9496→9756 ⇒ `W = 14,156` against
  `W_ROOF 15,500` — **1,344 u spare.** Parcels ≈160-230 vs 36 today (4.5-6.4x); that is an
  estimate from the table, so print `cityGridAudit().byRing` and tune BEFORE recalibrating GOLDEN.
- **THE RENDERER, NOT THE GENERATOR, IS THE CEILING.** Measured 2026-07-10 (pre-V4): calm-t4
  **2,668 draw calls**, static city ≈71%, verdict *"safe headroom is mostly exhausted"*. A naive
  interior-LOD attempt once regressed draw calls **4.3x (2,752 → 14,539)** by fighting the
  batcher. So: **THE FULL-DETAIL BUILDING COUNT IS A BUDGET, NOT A RADIUS.** Re-key
  `farcull.js:43-113`'s swap from `distance < R` to `rank < K`; K joins the tier table beside
  `cull`, seeded at today's MEASURED detail set so wave 1 ships at wave 0's cost. **A tower past
  K is one instance in an existing InstancedMesh = zero new draw calls.** `GLASS_SECT = 320`
  becomes derived from the detail radius. **NEVER LOD a sub-mesh** — swaps are whole top-level
  groups only; that is exactly what the 4.3x regression violated.
- **`drawBudgetAudit({x,z,tier})` is a static predictor, not `renderer.info`** (the math gate
  never renders): walk `city.root` applying farcull/batch's own visibility rules, count
  InstancedMesh as 1. **`predictedCalls` is a CEILING ratchet — a new kind here.** Every other
  ratchet counts duplication and may only go DOWN; this one counts COST and may only go down or
  hold. Say so in the CLAUDE.md entry or someone will "fix" it by raising the pin. Confirm once
  per wave with `tools/smoke-play.mjs` printing `renderer.info.render.calls` beside it; fail on
  >15% disagreement.
- **The ceilings, each raised BY DERIVATION.** `W_ROOF` (continent.js:449-450) today **`return`s
  past 15,500 — it silently deletes the continent**; it must clamp `PAD` down, `console.error`
  and continue (vertex count is `(SEG+1)²` regardless of W, so a wide plate costs resolution,
  never memory — there is nothing to protect by deleting the world). `PLATE_SEG` cap 448 →
  **tile the plate**, which also fixes a live defect: the continent is ONE draw with ONE bounding
  sphere and is therefore **never frustum-culled**. Desert `GSEG` 264 → tile the bake 3×3 (its
  own comment says the cap is a vertex budget: 5 field evals/vertex). `CONTINENT_COUNTRY_MARGIN`
  2400 → `clamp(1200, 0.46 × halfExtent, 6000)` — **2200/4748 = 0.463, today's value already IS
  that fraction.** `TERRAIN_RING_AMP 4.5 → 4.5 × k` (radii already scale by k; amplitude must, or
  the backdrop shrinks as the world grows) — and the existing gate-safety proof survives untouched
  because the multiply runs through `mtnHiGate`. **`HILL_AMP` DOES NOT SCALE**: it lives under
  `RIM_CEIL = 23`, strictly under the 25 u doctrine line, which makes a mountains-outside-snow
  cell impossible BY CONSTRUCTION. Hills do not scale; the backdrop does.
- **The huge desert is the cheapest 10x on the map** — near-zero buildings, near-zero colliders, one
  bake, one wildlife share. Foot scale 1.60 → ~2.6-3.0, bake tiled so cells hold near 5 m (dune crests
  read as RAMPS past ~12 m cells). **Emptiness is the feature.**
- **The highwaynet literals — end the treadmill.** Seven raw free-country lane constants
  (highwaynet.js:154-178) that every DOCK's `worldOff` derivation left behind; hand re-measured **twice**,
  the file's own comment predicts the third, and `clearanceSweep` only `console.warn`s — which is how
  Route 1 silently ran through Fort Brandt and the Saltlands for months. `routeTable()` runs INSIDE the
  order-91 `addLandmass` callback, **after every landmass has registered its region, with `city` in scope
  one line away** — the data was always there; nobody had asked for it. `roadCorridorMid` is a 1-D
  interval sweep returning the midpoint of the widest gap, which is literally what the current comment
  says it was aiming for by hand. **`clearanceSweep` stops warning and starts FAILING.**
- **Snow: the owner's model is already written and only PAINTS.** `snowCover(y, slope, nx, nz, x, z)`
  (terrain.js:337-351) does altitude bands, angle-of-repose shedding (0.42/0.74 ≈ 25°→45°), sun-aspect
  melt and hash patchiness — and its only consumer is the backdrop's vertex colours. Promote it to
  **`CBZ.hasSnowCover(x,z)`**. **The snowline is already a fraction and nobody noticed**: `380/900 =
  0.422`, `720/900 = 0.800` against `peakAmp 900` — derive from the local crest and today's world returns
  byte-identical numbers. Three consumers in the same change: the colour ramp, `biome_snow`/`snowboard`'s
  `cityBiomeAt === "snow"` ("am I inside the rectangle" → "is there snow under me"), and
  **`vehicles.js:2218`'s grip — the road is slippery where the snow actually lies**, which is the proof
  the field is real to the game rather than paint.
- **REDEFINING THE GATE WITHOUT WEAKENING IT.** New primary invariant `mtnUncovered` = cells with
  `h > MTN` where `hasSnowCover < 0.15`, **pinned 0 — stricter than today's ≤60**; `mtnOutSnow` keeps
  being computed and PRINTED beside it forever so a "fix" that merely moves the rectangle cannot hide
  anything. Why it is not a weakening: **the old gate could pass a mountain inside the snow rect that is
  drawn bare — it never looked at the ground.** Land this BEFORE `RIM_CEIL` moves a millimetre.

**Contract lines other pillars cite, verbatim:**
> 1. **`CBZ.cityGridStamp(city, place)`** — ONE settlement generator: grid, ring zoning, recursive parcelling, height policy, parks, parking, low-rise. Mainland, minicities and any airport-anchored town all call it. Degrade-safe; the caller's old inline loop is the fallback. **Never author a second one.**
> 2. **`CBZ.cityDetailBudget()`** — the K nearest buildings held at full detail. **Anything that adds geometry to a lot registers through it or rides the instanced proxy.** A tower past K costs zero draw calls; a system that ignores this costs the frame.
> 3. **`CBZ.hasSnowCover(x, z) → 0..1`** — the ONE answer to "is there snow on the ground here", for grip, weather, wildlife, tracks, snowboarding, tint and the gate. Never re-derive it from a region name again.
> 4. **`CBZ.worldSpan()`** — the live world extent. Any density, cap, radius or placement that needs to know how big the world got reads this instead of typing a literal.
> 5. **`CBZ.roadCorridorMid(city, axis, opts)`** — the derived midpoint of the widest free lane between registered places. Kills the highwaynet re-measure treadmill and serves every future cross-country route, access road and link. The data was always in scope; nobody had asked for it.
> **AND WHAT SCALE NEEDS BACK:** *a population cap is a DENSITY, not a TOTAL.* `crowd: 700` (config.js:259), `CROWD_RIG_CAP: 1600` (config.js:196) and quality.js's per-tier `crowd: 180..1000` are fixed totals. **A ×3.2-area city with the same totals is a ghost town.** Key on local density near the camera — `traffic.js`'s `computeTarget()` already does this correctly; copy it.

### 3.3 THE AIRLINE NETWORK — an airport outside every city

OWNER: *"there should be an airport outside every city so then there can be airliners flying
between the cities and airports can actually gain some value and airliners can make the sky more
interesting."*

- **The fault.** `island_airport.js:1313` is ONE `addLandmass` closure; every coordinate is a
  literal off two module consts (`A_MINX = -900+_WOFF.dx …`, :1292-1299). `CBZ.worldOff("airport")`
  MOVES the one airport; it does not make a second. The world has **17 registered settlements**
  (`CBZ.settlements`, towngen.js:908) and exactly **2** places with a runway. **Fifteen towns
  cannot be flown to or from.**
- **The proven counter-pattern is one file over**: `minicities.js:60-67`'s `PLACEMENTS` +
  `buildMiniCity(city, place)` (:154-247), each entry independently try/caught (:262-267) so one
  bad stamp cannot sink the world.
- **`CBZ.airfieldKit(settlement)` is what makes this a block and not a table** — the
  `predatorKit`/`powerKit` lesson: *ship the thing that WRITES the bundle, or the block sits at one
  consumer forever.* **Nothing about a field is authored per site.** Tier = `capital || (shops+homes)
  >= 60`; runway `380 × (tier+1)` m long, `18 + 6×tier` wide; centre at `D = max(hx,hz) + 160` on the
  side facing AWAY from map centre (so the field lands between town and wilds, never between town and
  downtown); heading is a **pure argmin over 4 bearings × 4 offsets** of (region overlaps, road
  crossings, relief variance at 9 `countryReliefAt` samples) — **no RNG**.
- **Built entirely from parts that exist**: ONE canvas-baked ground plane carrying grass + runway +
  taxiway + apron + all paint (island_airport.js:1395-1478's unified-texture trick, which exists
  precisely to kill z-fighting between separate slabs) = **1 draw for the whole field surface**;
  `venueSite.fence`/`gatehouse`/`lampRow`/`bays`; `cityMakeBuilding` for the FBO shell;
  **`cityStaffVenue` — the adoption `island_airport.js` skipped** (it hand-rolls `populate()`/
  `airportRole()` at :2696-2784 with literal x/z desks), so **12 fields cost the bodies of ONE
  field** because you can only stand at one.
- **Draw budget**: tier 0 strip ≈ **5 draws**, tier 1 regional ≈ **34**. Twelve fields = 292 IF all
  were on screen at once, which they cannot be (cull 230..700, every field ≥160 m outside a settlement).
  Steady state is one field: **34 against 2,668 = 1.3%**.
- **The keep-out stops at the kerb — by construction.** CLAUDE.md's own KNOWN-AND-NOT-FIXED entry:
  Halloran's airside rect runs 22 m outside its own perimeter road, which is why
  `roadClearanceAudit().zoneCrossings` is pinned at 1. The kit computes `keepout.maxX = apronMaxX −
  roadOffset − halfRoadW`, so **every new field lands at 0 and the pin never rises.**
- **Halloran stays bespoke and wave A1 does not open its file.** It owns the walk-in cabin, the
  boarding arc, `airside.js`'s 5-vehicle service loop and the pushback machine. Regional fields get a
  fuel truck and a ramp agent — **or 12 fields become 60 service vehicles.**
  `airfieldAudit().bespoke` pinned **1**, down-only, exactly like `cityOriginAudit().bespoke` at 3.
- **The network.** `CBZ.cityAirports` + `airportRegister(rec)` with runway centreline endpoints and
  true heading. **Approach fixes are DERIVED, never authored** — `rec.approach(end)` solves threshold
  −2,200 m at 3° → 115 m AGL from the runway record itself, so a runway that moves takes its approach
  with it. That is the `roadJunctions` law and the `lampMast` lesson (*two constants describing one
  object were authored independently — that WAS the bug*). Back-compat: `city.airportAudit` is read by
  `airside.js:435` and `games/airport.js:676,865` and must keep pointing at Halloran; the list is ADDITIVE.
- **`CBZ.airRoute(craft, dt)` is a generalization, not new work**: `aircraft.js:1898-2003`'s police-jet
  phase machine is complete and correct and every constant in it is measured off `j.home`, ONE
  hardcoded base. **Replace `j.home` with `craft.from`/`craft.to` registry records.** Cruise stacked at
  `ALT = 900 + 120*legIndex` so co-altitude conflict is impossible by construction; turn radius
  **authors the bank and SOLVES the radius** (`tan(bank) = v²/gR`) — authoring both is exactly how
  three helicopter flight models drifted into geometry no aircraft could fly.
- **Three consumers migrated in the same change**: the police jet (home → registry lookup), **the 4
  ambient GA craft — the migration that answers the owner's actual ask, same airframes, same draw cost,
  flying BETWEEN fields instead of orbiting one point forever**, and the new airliners. A fourth free:
  `games/airport.js`'s `DESTS` — three abstract open-water beacons its own header calls "uncontrolled
  outstations" *because there was no second landable airport in the world* — become real fields; the
  beacons stay as the degrade for a world with < 2 airports.
- **THE RIDE IS REAL BECAUSE THE RIDE IS 28 SECONDS.** The widest authored pair is Mbeya City to
  Veridia City ≈ **4.3 km**; at 180 m/s that is **24-33 s gate to gate**, and a typical mainland →
  Goldspire leg is **10-15 s**. So there is no need for a cut at all: BOARD through the existing
  `aircraft_doors.js` arc → sit in a real seat → **really taxi, rotate, cruise and land** while you look
  out of the window at the world you drove through → disembark at a real field in a real town. The
  cab-ride fade is the named anti-pattern; **the only sealed cut is the optional `SLEEP THE LEG` verb**,
  run through `cinematics.js` inside the sealed cabin (the arrest-ride grammar). STEAL already works end
  to end and becomes a network. `AIR_ARRIVAL_CRIME` — an unannounced landing at a manned field is one
  `wanted.js` crime with a real caller from day one (a crime with no caller is the "Reckless Driving"
  stat fiction this repo already found and killed). CARGO is **ONE `contracts.js` row** bound to two REAL
  fields and a REAL parked airframe, `available()` false if the world cannot supply them, paid through
  `mission.start({goal:"deliver"})` — no HUD, no waypoint, no payout code.
- **Sky presence is lights, not contrails** — contrails form above ~8 km and these aircraft cruise at
  900-1,400 m, so a contrail would be a lie the owner would spot. Red beacon at 0.75 Hz, wingtip
  red/green, white double-flash strobes at 1 Hz: three emissive quads, the correct physical answer AND
  the cheap one.

**Contract lines other pillars cite, verbatim:**
> **→ SCALE.** *Any pillar that stamps a settlement calls `CBZ.airfieldKit(settlement)` and passes the result to `CBZ.airfield(city, spec)`.* Tier, runway, placement, staffing and access road all derive from the settlement's own published record — **a new city never authors a field.** This is also why the airfield table must be keyed on settlement id, not on coordinates. **What aviation owes back:** each field publishes its landside anchor rect and keep-out as data on the placement record, so `cityGridStamp` can site a grid against it without overlapping and without guessing.
> **→ MANTLE.** Every airfield perimeter is `venueSite.fence` at **`h: 2.4`** — the SAME height as the airport's (island_airport.js:2569) and the military base's (island_military.js:900-912), which is what the mantle was sized against. Twelve new fences become twelve new places to climb in, with **zero geometry changes**, the day the mantle ships. **Do not change the fence height.**
> **→ ROADS.** Every field's access road is a `roadClearance` DESTINATION-RULE exemption; the keep-out stops at the kerb, so `roadClearanceAudit().zoneCrossings` stays at its pinned 1 (Halloran's) and never rises.

### 3.4 10x FAUNA — especially the sea

OWNER: *"way more animals especially sea animals."*

- **The fault is draw calls, and it is arithmetic.** Every animal is a hand-built `THREE.Group` of
  individual boxes added straight to the scene root (wildlife.js:212-269), nothing merged, nothing
  instanced, `castShadow = true` on every mesh (:227). Counted from source: **mackerel 15 meshes,
  dolphin ~18, humpback ~14, great white ~24, megalodon ~26.** **A single visible school of 15
  mackerel is 225 draw calls — 8.4% of the entire measured calm-t4 frame budget, for fifteen fish.**
  That is why the answer is not "raise DENSITY".
- **Today's whole ocean is 171 creatures**: DENSITY 850 × `BIOME_SHARE.water .20` = 170 target ⇒
  ≈78 mackerel, 78 dolphins, 7 great whites, 7 humpbacks, 1 megalodon. Five species. For the entire sea.
- **The tier ladder.** TIER 3 FAR PROXY: ONE InstancedMesh for the entire world's fauna, per-instance
  scale from the actor's own `Box3` taken once at spawn — **this is `farcull.js:43-113` verbatim**, which
  already carries unbounded far buildings in one draw. **1 draw call at any population**; 3,400 animals =
  218 KB. TIER 2 THE SCHOOL IS THE RENDER UNIT (the headline): the herd is ALREADY a data structure
  (`joinHerd`/`updateHerds`, :733-757, live centroid + mean heading + panic), so promote it to the render
  unit — one InstancedMesh per schooling species, offsets a deterministic `hash01` phase around the
  centroid, **per-fish AI does not exist because a fish in a school does not have any. A 60-fish school =
  1 draw call.** TIER 1 MID: generalize `wildlife_shark.js`'s fin+wake+shadow proxy (later wave). TIER 0
  NEAR: today's full rig, byte-identical, bounded by `WILDLIFE_RIG_CAP = 48` (matching crowd.js's proven
  48) and promoted through crowd.js's own pool **including `npcTransitionSafe`**. `castShadow` is set on
  tier-0 rigs ONLY — one line, and the shadow pass stops scaling with population.
- **The win is not speed, it is BOUNDEDNESS.** Today's cost is whatever happens to be near you,
  unbounded. After: 48 rigs × ~15 = 720 draws absolute worst case, +1 for all far fauna on Earth, +1 per
  visible school. **Typical view: ≈92 draws for a scene containing 3,400 animals.**
- **Brains LOD.** An 8-phase stride for the frozen set (the file already half-does it via `a._lodF`):
  today 850 unconditional iterations/frame; after, at 3,400 animals, `3400/8 + ~50 near ≈ 475` — **cheaper
  than today at 4x the population.** And aquatic apex predators stop being blanket-exempt: today
  sharks/megalodon run `sharkBrain` even while hidden, which at 168 sea predators is 168 unfrozen brains;
  narrow to `predatorIs(a) && dist2 < HUNT_SIM_R2` — **`predatorIs` is already the ONE answer to "does
  this hunt the player"; never re-derive a danger threshold.**
- **THE AQUATIC BAND BUG, MEASURED.** `AQUATIC_R0 = 560, AQUATIC_R1 = 1500` around a static
  `FIELD_CX/CZ = (0, −700)` — centred on the PRE-enlargement mainland. Veridia City is 2,000 u from that
  centre, Mbeya 2,256, Keshtown 2,090: **three of four nations' coastlines have zero chance of a primary
  aquatic draw.** `waterfield.js` carries a `SEA_WORLD_BOUNDS` fallback whose own comment admits *"the
  continent expansion can consume an old radial ocean band entirely"* — but it only fires after 96 failed
  tries and the tries almost never fail, so **the fallback is dead code in practice.** Fix in the repo's
  own idiom: promote the fallback to primary (sample `SEA_WORLD_BOUNDS`, keep `isNavigableWater` as the
  accept test) — the same measure-instead-of-assume move that fixed the reachable backdrop range. **Then
  weight it by the shelf**: `shoreAt(x,z)` already answers depth, so bias 70% of sea life into the
  `0…−60 m` band that rings EVERY landmass. Realistic and player-visible in one number.
- **Density: `DENSITY 850 → 3400`, `BIOME_SHARE {forest .25→.20, farmland .16→.11, desert .23→.16,
  snow .16→.11, water .20→.42}`** (sums to 1.00) ⇒ water 170 → **1,428 (8.4x)**, forest 213→680,
  desert 196→544, farmland 136→374, snow 136→374. With schools at `herd:[30,60]` — affordable only
  because a school is now one draw — the visible sea read per encounter goes ~15 → ~45 fish, so the
  effective sea multiple is **≈10x population, ≈25x on what you actually see.**
- **New species are DATA ROWS ONLY** — orca pod (uncommon; **zero behavior code**, because
  `wildlife.js:1949` already calls `CBZ.predatorPack` and this is the first aquatic pack predator it was
  built for), hammerhead, manta ray, sea turtle, reef fish, jellyfish. The ONE new animation is
  GEOMETRIC discovery, not a species list: children whose |z| offset exceeds |x| by ≥2x are WINGS →
  `swimFlap`, exactly as `predatorPose` discovers front legs as "columns with x > 0". **No calf species**
  — one schema field `juvenile:{scale:0.42, follow:true}` applied by the existing `breed()`, and **every
  species in the game gets young**, including the humpback the owner would notice.

---

## 4. TWO PILLARS WRITTEN HERE

### 4.1 THE MANTLE BLOCK — the perimeter becomes a decision

OWNER's ask, restated as mechanics: **jump → grab the top → jump again**, over a ~2.4 m obstacle.

**What exists, and what does not.** The player is not a capsule: it is a horizontal **circle**
resolved against AABBs by shortest push-out (physics.js:124-157), with height entering only through an
optional `c.y0/c.y1` band. `STEP_UP = 0.45 m` (physics.js:18, lowered from 0.9 because 0.9 "over-climbed…
nearly a whole flight in one frame"). `STEP_UP_NPC = 0.9 m` exists (`npcStepLedge`, physics.js:210-237)
and is **NPC-only, city-mode-only, an instant Y snap, and gated by a dot product against the move vector**
— architecturally the closest thing in the repo to "detect a low grabbable ledge ahead". Jump is a single
fixed impulse: `jumpVel 6.5` against `gravity 22` (config.js:171-172) ⇒ **ballistic apex 0.96 m**. **There
is no double-jump, no wall-jump, no ledge raycast, no hang state, and no climb/vault/parkour system
anywhere in the repo.** Both perimeter fences the owner would want to cross are **2.4 m solid colliders**
(island_airport.js:2569-2570, island_military.js:900-912) — today they are simply walls.

**THE BAND IS THE WHOLE DESIGN, AND IT IS ARITHMETIC.** A mantle owns exactly the gap between what the
auto-step already handles and what a human could plausibly reach:

```
  feetY + STEP_UP (0.45)   <   top   <=   feetY_ground + MANTLE_REACH
  MANTLE_REACH = apex (0.96, DERIVED from jumpVel²/2·gravity) + HAND_UP (MEASURE off the rig)
```

Below 0.45 the auto-step owns it and the mantle must refuse (two systems answering one question is the
disease this plan exists to cure). Above `MANTLE_REACH` **nothing** answers it, and that refusal is
honest — it is what makes a wall still a wall. Declare the ceiling at **2.6 m** (the two real fences at
2.4 plus margin) and **if `apex + HAND_UP` measures short of 2.45, raise `MANTLE_REACH` as a named assist —
never raise `jumpVel`.** Raising the jump changes every fall, landing, `FALL_SAFE` (11.0 m/s) and
step-down relationship in the game to buy one local verb; that is a global change for a local want.

**The three states, each built from a proven pattern:**
1. **DETECT.** Only while airborne, only once `vy <= 0` (**you reach when you stop rising** — that single
   condition is what makes it read as a jump-grab rather than a magic pull), only when moving toward the
   obstacle (copy `npcStepLedge`'s dot-product gate verbatim). Probe the **existing collider bucket grid**
   (`COL_CELL = 8`, physics.js:30) — O(1), no new spatial structure. Accept a collider whose top lands in
   the band, whose face is within `GRAB_D` along the move vector, **and which passes the standing test**:
   `groundAt()`/`CBZ.platforms` (physics.js:239-350) must report a standable surface just past the edge.
   No stand, no grab — that is what stops a mantle onto the top of a lamp post.
2. **HANG.** `actor._mantle = {c, top, from, to, t}`. Gravity off, `vy = 0`, horizontal velocity zeroed,
   input overridden, **pose written ABSOLUTELY** — `grapple.js:235-259`'s discipline, which exists
   precisely so `animChar` cannot fight a scripted physical action frame-to-frame. The arc's lifecycle
   (`begin`/`guide`/`endArc`) is `aircraft_doors.js:192-318`'s contract, unchanged: cancellable, dying
   cleanly on death, mode change or the target becoming invalid.
3. **VAULT.** The exit is the second press — **jump again to pull up**, back/release to drop, timeout to
   drop (`MANTLE_HANG_SECS`). On completion the actor is handed to the SAME `groundAt()`/`CBZ.platforms`
   standing mechanism it would have used on any roof. **No new standing system — only a new way to arrive
   at one.**

**Three consumers in the same change (Block Law #3), because `CBZ.mantleTry(actor, dt)` is written for
actors, not for the player.** (a) the player controller at the jump site (physics.js:806); (b) a
**pursuing officer** — a fence the player can cross and the police cannot is an exploit, and this repo's
doctrine is that counterplay is a VERB; (c) a **bolting ped** — `cityScare`'s "bolt" branch hitting a
fence should go over it, which is also the cheapest possible proof the FSM is not player-special.
`MANTLE_NPC` is **separately revertible** because it changes shipped pursuit behaviour.

**Flags:** `MANTLE_V1` (master; off → `mantleTry` returns false and every caller degrades to today
exactly) · `MANTLE_REACH` 2.6 · `MANTLE_HANG_SECS` · `MANTLE_NPC`.
**Ratchet — `CBZ.mantleAudit()`** → `{mantles, byActor, climbable, refusedNoStand, refusedTooHigh, stuck,
legacySnaps}`. **`stuck` pinned 0** — an actor left in the hang state with no owner or no exit, measured
after a `stepSim` burst so a body stranded during PLAY fails too. `climbable` (world colliders whose top
lands in the band — the two fences today, fourteen after the airfield wave) is printed BESIDE it so a
"fix" that stops detecting cannot pass. **UNMEASURED.**
**Territory (one wave):** NEW `src/systems/mantle.js` · `src/systems/physics.js` (the probe + band) ·
`src/city/peds.js` (the bolt consumer) · `src/city/police.js` (the pursuit consumer) · `config.js` ·
`index.html`. **Zero geometry changes anywhere** — the fences are already the right height and shape.

### 4.2 THE FLAG PURGE — one small wave, and its law is determinism

549 unique `CBZ.CONFIG` flags across ~80 files; only 19 default OFF. **The reassuring finding first:
no default-false flag builds meshes or colliders while off** — every one sampled early-returns before
geometry, so the "dead flags are costing us" fear does not materialise, and the flag idiom is clean.
This wave is therefore about DELETING CONFUSION, not reclaiming frames — and it is small on purpose.

**THE LAW THAT GOVERNS THE WHOLE WAVE: delete the BRANCH, keep the DRAW.** Removing a dead loop that
draws from a shared seeded `rng()` stream re-deals every downstream draw and changes the world for every
seed — CLAUDE.md's hard rule. `DESERT_ROCK_SCATTER` is the worked example already in the tree: its dead
loop **still draws its rng ON PURPOSE**. The wave's entire verification story is therefore the math
gate's determinism re-run plus the biome histogram plus the GOLDEN bands, all **unchanged**. If any of
them move, a draw was removed.

1. **DEAD — hard-delete both blocks.** `GORE_HIT_FEEDBACK_V2` has **duplicate contradictory
   declarations** (config.js:1111 false "RETIRED/INERT" wins over :1158 true) and **zero consumers
   outside config.js**. `FX_EXPLOSION_RINGS` (crashfx.js:214, checked `=== true`) has **no ON path
   anywhere** — wire it or delete it; delete it.
2. **THE SIX OWNER-VETOED BRANCHES — remove the branch, keep the behaviour.** `CRAFTING_ENABLED`
   (owner's call: crafting is dead — remove the gate and `systems/craft.js`'s panel; **`itemStore`
   STAYS, buildmode reads it**) · `FACADE_AC_UNITS` · `CITY_REFLECTIVE_GLASS` · `LOCKON_SQUARE_SPIN` ·
   `DESERT_ROCK_SCATTER` (**branch out, rng draw in**) · `CAM_SPRINT_FOV`.
3. **WATER_REFLECT — the one genuine per-frame `.visible` flicker in the codebase, and it is a
   hysteresis bug, not a purge target.** `waterfx.js:379` runs `onAlways(93.5)` and `:396` calls
   `applyMode()` **every frame**; `:361-363` computes `on = CFG.WATER_REFLECT !== false && qualityOk()`
   where `qualityOk` includes the LIVE adaptive quality tier, then sets `reflect.visible = on;
   flatSea.visible = !on`. **If FPS hovers at the Balanced boundary, two sea meshes flip visibility
   every frame.** Fix at the governor: latch the tier decision with a dead band and a minimum dwell,
   and let `onQualityChange` (already hooked at :384 and :443) be the only thing that calls
   `applyMode`. The per-frame call becomes a cheap guard, not a decision.
4. **THE THREE SURFACE-OR-DECIDE ITEMS — these are product calls, not engineering ones, and the wave's
   job is to put them in front of the owner with the cost written down.**
   - **`CITY_HITMAN_CAMPAIGN`** (config.js:667, redeclared campaign.js:40) — **a complete 2,048-line
     authored narrative campaign**: helicopter-arrest cold open, prison chapter with warden dialogue,
     spy-insertion branch, endless contract-loop end-state. Clean early-returns, zero waste while off.
     **This is the hidden-content headline of the whole census.** The decision is default new-game
     experience vs. menu choice — and it interacts with `origins.js`'s nine rolled openings, so whichever
     way it goes, ONE of them owns the first thirty seconds.
   - **`BLD_EXTRAS`** (config.js:820) — a master cascade forcing false: `BLD_MASONRY_V1`/`_TEXTURE`,
     `DETAIL_BUILDING_DRESS`, `BLD_ROOF_CLUTTER_V1`, `BLD_WEATHERING_V1`, `DETAIL_GROUND_GRIME`. A
     complete shelved art direction (brick/masonry facades + weathering) with civic buildings already
     exempted and live. **Do not flip this on in the same wave as the scale pillar's detail budget** —
     it is exactly the kind of per-building geometry that must be measured against
     `drawBudgetAudit().predictedCalls` first.
   - **`DYNAMIC_WEATHER`** (config.js:662, weather.js:34) — a full rain/storm/lightning/wet-grip system,
     off because of a HUD/jail-leak bug **described in its own comment**. Fix the leak, then default on.
     It compounds immediately: wet grip is the second consumer of the scale pillar's `hasSnowCover`
     grammar, and rain is what makes a 10x desert feel like weather rather than texture.

**Explicitly NOT purged, and why**: the WATER_V2 / MOUNT_* / TERRAIN_* / GFX_* / RENDER_* quality
families (they protect weak hardware), `STRAT_NUKE/_BUNKERS/_B2` (blast-radius content), `PRIO_WARN` /
`BUILD_FREE` (dev toggles), and **every flag from the three 2026-07-27 waves** — they are hours old and
are the kill switches for code that has not yet been played.
**Ratchet — `CBZ.flagAudit()`** → `{flags, defaultOff, dead, unreferenced}`, where `dead` counts flags
declared in config.js with no consumer outside config.js. **Down-only. UNMEASURED.**

---

## 5. THE IMMEDIATE-FIX LEDGER

Live bugs the planning uncovered. Each is wave-able now; each has an owner so it is not fixed twice.
(The ghost-city, bed and soot fixes already in flight tonight are deliberately excluded.)

| # | bug | evidence | owner |
|---|---|---|---|
| 1 | **Traffic spawns 2-6× INSIDE its own draw distance.** `recycleOne` places a car at `minDist 50, maxDist 120, camMin 62` (traffic.js:332-336) against a vehicle cull radius of **230-500 m**. A car materialises well within its own draw distance and relies purely on the camera not looking at that instant. **Turn your head and it is there.** That is the owner's "pops at 150 m", and it is arithmetic, not a rendering bug. | traffic.js:332-336 vs quality.js:65-73 | **WITNESS W2** — and only there. A bare constant change without the in-transit accounting (`computeTarget` counts cars inside `NEAR2 = 80 m`; a car placed at 350 m takes 25-40 s to arrive, so the near-count stays low and upkeep recycles again and again) is a runaway that **empties the far world to feed a bubble that never fills.** |
| 2 | **The aquatic spawn annulus excludes three nations' coasts.** `AQUATIC_R0/R1 = 560/1500` around a static `(0, −700)` — Veridia 2,000 u away, Mbeya 2,256, Keshtown 2,090. The `SEA_WORLD_BOUNDS` fallback exists but fires only after 96 failed tries, and the tries almost never fail. **Dead code in practice; the far coasts are empty water.** | wildlife.js:77-79; waterfield.js:262-289 | **FAUNA B2** (ships with a deliberate `--calibrate`: this moves the shared rng draw pattern) |
| 3 | **Legendary permadeath resurrects on reload.** wildlife.js:885 mints one legendary per species, :895 promises *"a species hunted to ZERO is EXTINCT — forever"*, :1247 fires the "★ LEGENDARY … DOWN" note — and **there is no wildlife serialize hook anywhere in the repo.** The game's loudest permanence promise is false. Two call sites, ~6 lines, and persistence is then FREE because `cityIdentities` already round-trips both save paths. | wildlife.js:878-886, 895, 923, 1247; identity.js:54-85 | **WITNESS W1** (it is tier 2's first non-curated consumer and the proof the tier is real) |
| 4 | **SP/MP ledger asymmetry.** `netpersist.js:138,265` persists `CBZ.cityNpcLedger`; `worldstate.js:220,286` persists identities and **NOT** the ledger. **Every worth-civilian — dealers, vendors, marks carrying cash, anyone holding a grudge — is lost on a singleplayer reload and survives in multiplayer.** Two lines mirroring the identity lines already sitting beside them; 900 × ~280 B ≈ 250 KB against a 15 MB cap. **Without this the entire witness block is a multiplayer-only feature.** | worldstate.js:220,286 vs netpersist.js:138,265; schedule.js:169-172,181 | **WITNESS W1** (not optional, not deferred) |
| 5 | **WATER_REFLECT boundary flicker.** `applyMode()` runs every frame and flips two sea meshes' `.visible` off a live adaptive quality tier; at the Balanced FPS boundary they flip per frame. | waterfx.js:361-363, 379, 396 | **WAVE 0 / FLAG PURGE** (§4.2 item 3) |

**Also uncovered, already owned by a pillar wave — listed so nobody re-discovers them:**
`clearanceSweep` detects real highway/place crossings and only `console.warn`s, which is how Route 1
silently ran through Fort Brandt and the Saltlands for months (→ scale W2, where it starts FAILING) ·
Halloran's airside keep-out runs 22 m inside its own perimeter road, the reason
`roadClearanceAudit().zoneCrossings` is pinned at 1 (→ new fields land at 0 by construction in airfield
A1; Halloran itself waits for the optional promote wave) · the continent is ONE draw with ONE bounding
sphere and is therefore **never frustum-culled** (→ fixed as a side effect of plate tiling in scale W2).

---

## 6. THE WAVE SEQUENCE

**Rules that bind every wave.** One owner per FILE per wave — file territories are disjoint and
`config.js`/`index.html` are append-only (the flag purge is the one exception and that is why it goes
first and alone). Builders build and read; **the orchestrator runs the gate ONCE on the merged state
immediately before push.** Every wave names its flags, its ratchets, what it deliberately RECALIBRATES,
and what it must PRESERVE.

**THE STANDING SET** — the pinned invariants every wave preserves unless it explicitly says otherwise,
cited once here instead of twenty times below: determinism (byte-identical re-run + biome histogram) ·
`cityOnMountain` 0 · `mtnOutSnow` ≤ 60 · region overlaps 0 · shop-door reachability 0 orphans ·
`roadClearanceAudit()` violations 0 / propsInside 15 / zoneCrossings 1 · `roadTrafficAudit()`
trespassing 0 / onWater 0 · `govComplexAudit()` overlaps 0 / roadless 0 · `backdropAudit().onPlate` 0 ·
`cityCrowdSpawnAudit().spawnsInView` 0 · `arenaAudit()` misposed 0 / shrugRoles 0 ·
`airsideAudit().onRunway` 0 · `venueStaffAudit().unstaffed` 0 · `fishAudit().refused` 0 ·
`predatorAudit()` legacy 0 · `blastAudit().handRolled` 0 · `arrestAudit().legacyTeleports` 0 ·
`propPurgeAudit()` alleysBlocked 0 / acBoxes 0 · `interiorAudit()` spill 0 / govBare 0 ·
`airTrafficAudit().clipping` 0 · `wildlifeDeathAudit()` legacyPoseDeaths 0 / frozenCorpses 0 ·
`roleAudit().unseeable` 0 / activityTitles 0 · `groundMatchAudit()` maxErr / ungated.

### WAVE 0 — GROUND CLEARING *(solo, one territory, cheapest wave in the plan)*
The flag purge (§4.2) + the WATER_REFLECT hysteresis fix. **It runs alone because it DELETES from
`config.js` while every other wave APPENDS to it.**
**Flags:** none added; six removed, two deleted.
**RECALIBRATE:** nothing. **PRESERVE:** the standing set — and specifically determinism, the biome
histogram and the GOLDEN bands, which are the proof that a branch was removed and a draw was not.
**Bonus duty, and it is the cheapest one available:** this wave's gate run is the moment to discharge the
existing UNMEASURED backlog — `rankAudit()`, `roleAudit()`, `heliAudit()`, `mapAudit()`, `streetAudit()`'s
`wiresDisconnected`/`paintThroughJunction`, `groundMatchAudit()` — all of which CLAUDE.md already declares
and none of which has ever been run. **Write the numbers into CLAUDE.md in the same commit.**

### WAVE 1 — THE LAW, THE BUDGET, THE STAMP *(three parallel territories)*
**1A · WITNESS W1 — the law and the proof.** NEW `city/witness.js` · `city/wildlife.js` (2 sites) ·
`city/worldstate.js` (2 lines) · `city/schedule.js` (worth clause + trim clause + `e.w`) ·
`city/peds.js` (1 line at :5152) · `city/crowd.js` (park + assign-clear) · `city/citystaff.js`
(dropPost) · `city/aim_dossier.js` (1 line at the sweep).
Ships: **fixes 3 and 4 first** (they prove each tier is real before anything depends on it), the API,
tiers 1+2, the three demotion guards. **FIVE consumers migrated, over the required three.**
Flags: `WITNESS_V1` · `WITNESS_DWELL` 0.45 · `WITNESS_DAYS` 3 · `WITNESS_HOLD_MAX` 8 ·
`WITNESS_IDENTITY_MAX` 250 · `WILDLIFE_PERMADEATH`.
Ratchets: `witnessAudit()` — `orphaned` 0, `ledgerDurableSP` 1, `legendaryResurrected` 0 pinned;
`tagged`/`tier1`/`tier2`/`banked` printed beside so a "fix" that stops tagging cannot pass.
**Mandatory addition to the pillar spec:** `witnessHorizon(kind)` must answer `'animal'` from
`wildlife.js:76`'s `ANIMAL_VIS [90,130,190,270,360]`, read live off the quality tier exactly as `'ped'`
reads `CBZ.pedLOD` — otherwise the fauna contract cites a kind that does not exist (§7 reconciliation 5).
RECALIBRATE: nothing. PRESERVE: the standing set.
**1B · SCALE W1 — the city grows, the renderer does not.** `core/farcull.js` · `core/quality.js` (K
column only) · `city/world.js` · `city/buildings.js` (`districtStoreys`, `GLASS_SECT`) ·
`city/towngen.js` · `city/expansion.js` · `world/layout.js` (`SPREAD_V5`, +130 u radial only).
**Order inside the wave is not negotiable: the detail budget lands and is MEASURED before one extra
tower exists**, or this is the 4.3x regression again.
Flags: `LOD_DETAIL_BUDGET` · `CITY_GRID_UNIFIED` · `CITY_HEIGHT_POLICY` · `WORLD_SCALE_V5`.
Ratchets: `drawBudgetAudit().predictedCalls` (**CEILING** — down-or-hold) · `cityGridAudit()`
(`bespokeGrids` 1→0; `lowRiseFrac`/`parkFrac` **FLOORS**).
**RECALIBRATE deliberately:** GOLDEN `lots` 325/335 and `shops` 178/192 (math-gate.mjs:50-54) **must**
move — that is the point of the wave; `roads` may move if the grid adds lines.
PRESERVE: the standing set. **Watch:** `worldLayoutAudit()`'s minimum strait must not shrink (the +130
radial walk is what protects it) · build ms · collider count (they scale with total STOREYS, not
buildings: ≈216 storey-units today, ≈1,400-2,000 after).
**1C · AIRFIELD A1 — the stamp.** NEW `city/airfield.js` · `config.js` · `index.html` (1 tag).
**Does not open `island_airport.js` at all.**
Flags: `AIRFIELD_KIT` (off → only Halloran + the military strip, byte-identical world) · `AIRFIELD_STAFF`.
Ratchets: `airfieldAudit()` — `roadless`/`overlaps`/`keepoutCrossings` 0, `bespoke` 1 down-only.
RECALIBRATE: `BIOMES_ALL` and `worldLayoutAudit` gain up to 12 regions. PRESERVE: the standing set,
especially `roadClearanceAudit().zoneCrossings` (**stays 1 — Halloran's, and never rises**),
`roadTrafficAudit().trespassing` 0 and `groundMatchAudit().ungated` (a runway is a built surface, so
`TERRAIN_FLATTEN_UNDER_BUILT` lowers the relief under it — **never raise a runway to clear terrain**).

### WAVE 2 — HORIZON, TIERS, ROUTES *(three parallel territories)*
**2A · WITNESS W2 — vehicles and the horizon.** `city/traffic.js` · `city/vehicles.js` ·
`city/airside.js` · `city/roadrules.js`. Ships the deterministic plate (one `hash01` at
`cityRegisterVehicle` — **tier 0 identity, zero storage**), the car ledger + recycle refusal,
`witnessHorizon`, the far-band spawn preference **with in-transit accounting**, and ledger fix #1.
Flags: `WITNESS_HORIZON_SPAWN` (separately revertible — it is the only part that moves where things
appear and therefore the only part that can hurt density) · `WITNESS_VEHICLES`.
Ratchet: `horizonFallbacks` — **this counter is the measurement of whether the world is big enough for
the law, and it is the number the scale pillar reads.**
**2B · FAUNA B1 — the tier ladder.** `city/wildlife.js` ONLY · `config.js`. **Serialised behind witness
W1 on wildlife.js** (§7 reconciliation 4). Flags: `WILDLIFE_TIERS` · `WILDLIFE_RIG_CAP` 48.
Ratchet: `faunaAudit()` — `rigs <= rigCap` hard; `shadowCasters` down-only; `drawEstimate` printed
beside `animals`. RECALIBRATE: nothing (population unchanged in B1 — **that is the point**).
**2C · AIRNET A2 — registry and routes.** NEW `city/airnet.js` · `city/aircraft.js` ·
`city/airtraffic.js` · `games/airport.js`. Writable in parallel with A1 against §3.3's record contract;
merges after it. Flags: `AIR_NET` · `AIR_NET_SCHEDULE` · `AIR_NET_MAX_FLIGHTS` 3 · `AIR_NET_MIGRATE_GA`
(separately revertible — it changes shipped behaviour).
Ratchet: `airNetAudit()` — `orphanFields`/`hardcodedHomes` 0, `bespokeFlightModels` 3→0, **`legsFlown`
counts REAL completed legs** (the anti-stat-fiction counter, the same job `swimAudit().drowned` does).

### WAVE 3 — THE MAP GROWS, THE SEA SPREADS, THE RIDE IS REAL
**3A · SCALE W2.** `city/continent.js` · `world/terrain.js` · `world/terrain_overhaul.js` ·
`city/biome_desert.js` · `world/layout.js` (`worldFoot` + full `SPREAD_V5`) · `city/highwaynet.js` ·
`city/roadrules.js` (+`roadCorridorMid`). Flags: `TERRAIN_PLATE_TILES` · `DESERT_BAKE_TILES` ·
`TERRAIN_MARGIN_FRAC` · `TERRAIN_RING_AMP_K` · `HIGHWAY_LANES_DERIVED` · `WORLD_SCALE_V5` turned up.
Ratchets: `terrainCeilingAudit()` (`clampedCeilings` down-only, `wRoofHeadroom` > 0 **hard**) ·
`highwayDeriveAudit()` (`literal` 7→0, `minClearance` ≥ 40 m).
**RECALIBRATE:** the biome histogram (cell counts change with area — expected). `MTN_OUT_SNOW_MAX` may
need re-measuring **only if `mtnHiGate` fails to hold it — the gate-safety proof says it should not, so
movement here is a red flag to investigate, not a number to bump.**
**PRESERVE — the two most at risk:** `groundMatchAudit()` `maxErr`/`ungated` (plate tiling changes how
the physics floor samples the drawn plate; **measure per tile**) and `backdropAudit().onPlate` 0
(**re-measure the plate's true reach; never assume** — the last fix found 4,410 m where 2,320 was assumed).
**3B · FAUNA B2 — the sea spread.** `city/waterfield.js` · `city/wildlife.js` constants ·
`tools/math-gate.mjs`. Flags: `WILDLIFE_SEA_SPREAD` · `WILDLIFE_SHELF_WEIGHT` 0.7 · `WILDLIFE_DENSITY`
3400 (**a NUMBER, so the owner can dial the whole ask himself**).
**RECALIBRATE deliberately:** this changes the draw pattern on the shared seeded stream, so world builds
move per seed — permitted (the law is byte-identical *per seed across clients*, not across versions) but
it **will** move the biome histogram and the golden counts. Ratchet: `farCoastAnimals` may only go **UP**
from its measured baseline (near zero today by construction) — the anti-regression on the band fix.
**3C · AIRNET A3 — passenger and cargo.** `city/contracts.js` (one row) · `city/aircraft_doors.js` ·
`city/island_airport.js`. Flags: `AIR_ARRIVAL_CRIME`. Gate the freight contract behind a rank verb
(`ferry`) so it also satisfies *a rank is a verb, or it is nothing*.

### WAVE 4 — THE VERB, THE SNOW, THE SPECIES
**4A · MANTLE** (§4.1). NEW `systems/mantle.js` · `systems/physics.js` · `city/peds.js` ·
`city/police.js`. Flags `MANTLE_V1` / `_REACH` / `_HANG_SECS` / `_NPC`. Ratchet `mantleAudit().stuck` 0
with `climbable` printed. PRESERVE: the standing set + **no collider geometry changes anywhere.**
**4B · SCALE W3 — snow wherever a mountain is.** `world/terrain.js` (`hasSnowCover` + fraction
snowline) · `world/terrain_overhaul.js` · `city/continent.js` (`RIM_CEIL` selective lift) ·
`city/biome_snow.js` · `city/snowboard.js` · `city/vehicles.js` · `tools/math-gate.mjs`.
Flags `SNOW_COVER_FIELD` · `SNOW_LINE_FRAC` · `TERRAIN_RIM_RANGE`.
**RECALIBRATE:** the mountain invariant is REDEFINED — `mtnUncovered` (pinned 0) becomes the failing
condition, `mtnOutSnow` becomes a printed census. **Land the redefinition BEFORE `RIM_CEIL` moves a
millimetre**; a selective ceiling lift under the old containment invariant is exactly how you get a
green mountain. PRESERVE: `cityOnMountain` **0** (the invariant rim ranges threaten) · determinism
(`snowCover` uses `hash01` — keep it).
**4C · FAUNA B3 — the species rows.** `city/wildlife/aquatic.js` (rows) + ONE geometric flap branch in
`city/wildlife.js`. No new behavior code; the orca pod is `predatorPack`'s first aquatic consumer.

### WAVE 5 — MORE THAN ONE CITY *(two parallel territories)*
**5A · SCALE W4.** `city/minicities.js` · `city/citytemplates.js` · `world/layout.js`, using
`cityGridStamp` with per-site `blocks`/`skyline` and **calling `airfieldKit(settlement)` for each new
site**. This is where "10x cities" plural actually lands: **one 590 u mainland plus several real
settlements reads bigger than one 1,043 u mainland.** RECALIBRATE: GOLDEN again · `BIOMES_ALL` grows.
**5B · WITNESS W3 — tier 0 at scale.** `city/wildlife.js` · `city/crowd.js` · NEW `city/virtualpop.js`.
The hash-derived virtual population: fauna and outlying-region peds exist as a FIELD QUERY
(`CBZ.virtualAt(x,z,kind)`) rather than objects, materialised only when the horizon ring crosses them,
with witnessed individuals lifted out of the field so they can never be re-rolled. **This is what
actually buys 10x, and it is late on purpose: it needs W1's ratchet to prove it is not quietly losing
people.** It replaces the SEEDING, not the ecology — `CAPS`, breeding and extinction keep running on
the materialised set plus a virtual census.

### WAVE 6 — PROMOTIONS AND EXTRACTIONS *(optional, each independently shippable)*
`A4` promote Halloran's ground-canvas baker and cabin into the airfield kit (`bespoke` 1→0) ·
`B4` generalize `wildlife_shark.js`'s fin/wake/shadow into the mid tier · **the `CBZ.instancedProxy`
extraction** — by this point `farcull.js`'s one-InstancedMesh trick has two independent copies (buildings
and fauna); **the block law says the third consumer is the trigger to extract, and it is owed here** ·
`wildlife_shark.js`'s `predatorKit` migration, the debt CLAUDE.md already names.

### THE FAR ARC — INFINITE-WORLD M0-M8
**0% implemented** (grep returns zero hits for `generateChunk`/`isRoadLine`/`roadClassAt`/
`addColliders`/`removeColliders`); only the prereq (`hash01`/`seedStream`) shipped, and the doc's own
file:line inventory has drifted. The milestone set sums to **~13-20 person-weeks** and M5 (ped/traffic/
nav chunk-localization) is self-flagged as the riskiest. **Do not start it, and do not schedule it.**
Enter it only when the dial-based waves above exhaust — and "exhaust" is a MEASUREMENT, named here so
nobody argues about it later: world build > **8 s** · colliders > **40k** · the three global linear
scans (`citynav`, `findRoad`, `nearestIntersection`) together > **0.5 ms/frame** · heap growth that
closes the tab on a mid-range machine. **When one fires, take M5's PROBLEM without M0-M8's rewrite**:
bucket roads/lots/intersections into the 8 u grid that already exists (physics.js:30) and window the
scans. Days, not person-months. "Constant cost regardless of size" is the only part of the chunked
plan this game wants, and windowing delivers it.

---

## 7. RECONCILIATIONS — where the source documents disagreed

1. **"10x" means three different quantities and only two are affordable.** The scale pillar's §0.4
   labels a ×3.16-linear computation "10x-linear"; the arithmetic (union 9,496 × 3.16 + 2 × derived
   margin ⇒ **W ≈ 43,900**) matches recon-scale §5's *"10x AREA (linear ×3.16): still exceeds W_ROOF
   ×2.8"* exactly (43,900 / 15,500 = 2.83). **The label is the slip; the arithmetic is right.** RULING,
   and this is the sentence for the owner: **10x BUILDINGS is the headline and it is affordable under a
   detail budget. 10x AREA (×3.16 linear) is affordable at wave 3 with the roof clamped instead of
   returning and the plate tiled. 10x LINEAR (= 100x area) is REFUSED** — 98-metre terrain steps and a
   two-minute drive between anything; you would feel emptier, not bigger.
2. **Fauna DENSITY: 3,400, not 4,250-8,500.** recon-air-wild §B4.4 proposed 4,250-8,500 before the
   draw-call ladder existed; the pillar's 3,400 was solved **after** it, against a measured 2,668-call
   budget. **The pillar wins**, and `WILDLIFE_DENSITY` ships as a numeric dial so the owner can raise it
   himself once a frame has been measured at 3,400.
3. **Mackerel mesh count: 15, not ~11.** recon estimated ~11 meshes (165 draws for a 15-fish school);
   the pillar **counted 15 from source** (225 draws). **The counted number wins.**
4. **Who registers legendaries in `cityIdentities`.** Witness §4 FIX 1 (wave 1) and fauna §3.7.3 ("do
   this in wave B1") both claim it. **RULING: witness W1 owns it**, because it ships the plumbing and the
   `legendaryResurrected` ratchet that proves it. **Consequence, and it is a real scheduling constraint:
   wildlife.js is serialised across the two waves — fauna B1 cannot be a wave-1 parallel territory and is
   scheduled at wave 2B.**
5. **`witnessHorizon` has no `'animal'` kind.** The pillar declares ped/vehicle/aircraft; the fauna
   contract cites `witnessHorizon('animal')`. **RULING: witness W1 adds it**, reading `wildlife.js:76`'s
   `ANIMAL_VIS [90,130,190,270,360]` live off the quality tier — the same way `'ped'` reads `CBZ.pedLOD`.
   A contract that cites a kind the function does not answer is a stat fiction in a design doc.
6. **Two copies of `farcull.js`'s instanced-proxy trick.** Scale W1 re-keys the real one from radius to
   rank; fauna B1 copies the pattern into `wildlife.js` (different geometry source, disjoint file).
   **RULING: the copy is permitted and the extraction is DEBT, declared in §6 wave 6.** The block law's
   own rule is that ≥3 consumers proves an API — two copies is not yet a block, and extracting on the
   strength of two is how `interfaces.js` ended up with zero adopters.
7. **Traffic's horizon fix appears in two places** (the fix ledger and witness W2). **RULING: W2 owns
   it, and a standalone constant change is FORBIDDEN** — without the in-transit accounting it thins
   traffic, which is the one visible regression this whole plan can produce.

---

## 8. THE RATCHET LEDGER

Every audit this plan declares. **All are UNMEASURED until first run.** Each must be exported from a
REAL GAME FILE (never a tool) and pinned in `tools/math-gate.mjs`'s PASS block by whoever runs it first.

| audit | file | pinned | printed beside (so a "fix" that stops counting cannot pass) | status |
|---|---|---|---|---|
| `witnessAudit()` | `city/witness.js` | `orphaned` 0 · `ledgerDurableSP` 1 · `legendaryResurrected` 0 | tagged · tier1 · tier2 · banked · evictedFresh · identityRefused · horizonFallbacks · holdSlots | **UNMEASURED** |
| `drawBudgetAudit()` | `core/farcull.js` | `predictedCalls` — **CEILING, down-or-hold** (the only ratchet of this kind) | detailSet · proxied · glassSectors · batchTiles | **UNMEASURED** |
| `cityGridAudit()` | `city/world.js` | `bespokeGrids` 1→0 · `lowRiseFrac` **FLOOR** · `parkFrac` **FLOOR** | lots · byRing · parkingFrac | **UNMEASURED** |
| `terrainCeilingAudit()` | `city/continent.js` | `clampedCeilings` down-only · `wRoofHeadroom` > 0 (hard) | plateCells · desertCells · marginFrac · ringK · ampK | **UNMEASURED** |
| `highwayDeriveAudit()` | `city/highwaynet.js` | `literal` 7→0 · `minClearance` ≥ 40 m | lanes · derived | **UNMEASURED** |
| `snowCoverAudit()` | `world/terrain.js` | `uncovered` 0 (replaces `mtnOutSnow` ≤ 60 as the failing condition) | mtnCells · covered · **mtnOutSnow, forever** · snowlineFrac | **UNMEASURED** |
| `airfieldAudit()` | `city/airfield.js` | `roadless` 0 · `overlaps` 0 · `keepoutCrossings` 0 · `bespoke` 1 down-only | fields · byTier · unstaffed | **UNMEASURED** |
| `airNetAudit()` | `city/airnet.js` | `orphanFields` 0 · `hardcodedHomes` 0 · `bespokeFlightModels` 3→0 | airports · routes · inFlight · **legsFlown** · arrivals | **UNMEASURED** |
| `faunaAudit()` | `city/wildlife.js` | `rigs <= rigCap` (hard) · `shadowCasters` down-only · `farCoastAnimals` **UP-only** | animals · instanced · schools · drawEstimate · seaAnimals · legendariesRegistered | **UNMEASURED** |
| `mantleAudit()` | `systems/mantle.js` | `stuck` 0 | mantles · byActor · **climbable** · refusedNoStand · refusedTooHigh · legacySnaps | **UNMEASURED** |
| `flagAudit()` | `src/config.js` | `dead` down-only | flags · defaultOff · unreferenced | **UNMEASURED** |

**Already declared in CLAUDE.md and still never run** — discharge these in wave 0's gate run and write
the numbers in: `rankAudit()` (`emptyRanks`, `verblessRungs`) · `roleAudit()` (`roleless`, `shrugs`) ·
`heliAudit()` (`uncrewed`, `belowRoofline`) · `mapAudit()` (`labels`, `overlaps`) · `streetAudit()`
(`wiresDisconnected`, `paintThroughJunction`) · `groundMatchAudit()` (`maxErr`, `ungated`).

---

## 9. HOW TO USE THIS DOC

Each wave's orchestrator brief is short because this document is the long version: cite the pillar
section (§3.1-§3.4, §4.1-§4.2), paste the **contract lines** the wave must honour verbatim into the
builder's brief, name the wave's territory / flags / ratchets / RECALIBRATE / PRESERVE lists from §6, and
let the builder read the code. Builders build and read; **the orchestrator runs the gate once on the
merged state, and that one run is the whole safety contract that makes "artists not scientists" safe.**
After each wave, come back and update this file the way CLAUDE.md updates itself — **an honest status
line, in the pillar's own section, naming what actually shipped, what the first gate run MEASURED (every
ratchet in §8 says UNMEASURED and every one of them is a promise to write a number), and what is still
owed.** A pillar section that still claims a plan after its wave has landed is the stale-claim problem
this repo keeps catching itself in; the fix is the same every time, and it is one paragraph of honesty.

---

## 10. PILLAR UPDATE: THE RIM WORLD (2026-07-28)

**Full plan: `plan/pillar-rim.md`.** It EXTENDS §3.2 (the scale plan) and §6's wave sequence rather
than replacing them; §5 of that document reconciles the two line by line and names six changes.
Wave planners working on terrain, layout, biomes or the airfield network read it BEFORE §3.2.

OWNER, verbatim: *"the entire RIM of the map — instead of the center — should be the mountains and
snow, instead of right near the city. the entire rim of map: one corner a MASSIVE version of our
desert biome, one corner a massive mountain range and ice like we have, and one corner ice too, and
BIG FOREST. make the terrain feel massive. this goes with the big airport gameplan we made for
making many more airports."*

- **THE RIM ALREADY EXISTS AND IT IS BLANK.** `CONTINENT_COUNTRY_MARGIN = 2200` (`continent.js:61`)
  pads the plate past the region union, so measured off the file's own stage-4 derivation
  (`continent.js:444-448`) the world is **97.4 km² of already-built, already-drawn backcountry
  against 78.3 km² of settled world — 55% of the map is ALREADY rim.** One corner of that belt is
  **2.3× the entire Saltlands.** It is flat because `RIM_CEIL = 23` (`continent.js:702`) caps every
  metre of it, deliberately, *"strictly under the 25 u doctrine line"* so a mountains-outside-snow
  cell is impossible by construction. **The rim world is a GATE problem before it is a terrain
  problem.**
- **NOTHING MOVES, AND THAT IS THE ARGUMENT FOR THIS DESIGN.** `SPREAD_V5` is a **no-op on every
  existing landmass**: every strait, causeway, pinned axis (`layout.js:311-357`), the seven
  free-country lane literals and GOLDEN's lots/shops/roads all stay. A world re-lay is the most
  expensive thing in this repo's history; **a 70%-frontier map does not need one.** The four
  existing biomes are not shrunk — they are **re-cast as the middle ground**, the *medium
  triangles* that make the rim read enormous (BOTW's CEDEC 2017 rule: contrast is load-bearing).
- **THE SIZE, WITH ITS CEILING ARITHMETIC.** `RIM_BELT` 2,200 → **4,200** ⇒ plate **17,896 ×
  16,645 = 297.9 km²** (was 175.7), rim ring **219.6 km² = 73.7%** of the world, each corner
  17.6 km² = **8.3× today's Saltlands**. **HARD BLOCKER: 17,896 > `W_ROOF` 15,500 and past the roof
  the build `return`s — it silently deletes the continent.** §3.2's clamp-instead-of-return lands
  first or nothing else may. `PLATE_SEG` needs 471 against a 448 cap ⇒ **plate tiling required**
  (2×2 ⇒ 236 seg/tile, 225 k verts, four draws — a **net win**, because today the continent is one
  draw with one bounding sphere and is therefore never frustum-culled). `PLATE_G`, `plateClear()`,
  `terrainRingRadii`, `WORLD_SEA_SPAN` and `TERRAIN_FLATTEN_UNDER_BUILT`'s band **all derive and
  need no edit at all**; `TERRAIN_RING_AMP` needs **×1.27** (k 3.92 → 4.97) or the backdrop shrinks
  as the world grows.
- **ONE WIND EXPLAINS ALL FOUR CORNERS.** West-northwesterlies off the western ocean → drench the
  west (BIG FOREST, the windward flank) → lift over the northern wall (glaciated crest + ice cap) →
  pool as cold *dry* air northeast (the ICE SHIELD — the Gobi-Altai case, where aridity not cold
  gates the ice) → descend hot and dry into the southeast lee (the MASSIVE ERG). The settled
  interior is the partial shadow: prairie, the Great Plains gradient. **No corner is arbitrary;
  they are one rain shadow read clockwise.** Six sectors: the Mercy Wall (36 km²) · the Kesh Shield
  (44) · the Sandur (11.5) · the Great Sand Sea (39.8) · the Redhollow Reach (52.3) · the South
  Belt (26). Each swallows a nation town that is currently marooned in blank country and gives it
  an identity — Kesh becomes Askole, the last village before the glacier — **for zero lines.**
- **FOUR SEAMS, FOUR SANCTIONED ANSWERS, EACH FROM A SHIPPED GAME OR A REAL LANDFORM.**
  forest↔range = **gradient by treeline fraction** (`RIM_TREELINE_FRAC = 0.30 C`, the sibling of
  §3.2's fractional snowline; today's ramp is ~3× too low at 0.167) · range↔ice = **gradient by the
  Vatnajökull grammar** (cap over highland, outlet lobes, nunataks) · ice↔desert = **THE SANDUR**,
  the one authored hybrid — Skeiðarársandur is 1,300 km² of flat braided grey-black sand and is
  *geomorphologically a desert made by a glacier*; it costs **~30 lines because a sandur is flat** ·
  desert↔forest = **THEY NEVER TOUCH** (a pure climate gradient needs a 300-500 km belt; Just Cause
  4's answer is to route both through the hub, and our hub is the settled interior).
  **A CONTINUOUS MOUNTAIN RING IS REFUSED**: Skyrim rings its whole province and players read it as
  a bowl — *"fenced in"*, *"abrupt, jagged walls"*. Relief on one side only.
- **THE GATE INVARIANT NEEDS A THIRD FORM.** §3.2's `mtnUncovered` (high + no snow, pinned 0) would
  **fail a legitimate bare desert massif**. Replace with **`mtnUnclaimed`** — a cell above MTN
  inside no declared sector whose regime permits relief, and carrying no snow — **pinned 0**, with
  `mtnUncovered` and `mtnOutSnow` printed beside it forever. The original intent was never
  "mountains live in a rectangle"; it was **"you never see a bare green mountain."**
  **HARD REQUIREMENT, and it is the likeliest way the wave breaks:** the gate takes
  `max(terrainHeight, snowTerrainHeightAt)` and `snowTerrainHeightAt` is a *separate* oracle that
  does not run through `TERRAIN_FLATTEN_UNDER_BUILT` — so every rim regime field must pass through
  that gate or the first seed with a nation town near a crest fails `cityOnMountain 0`.
- **LIVE DEFECT FOUND: the rim metric is not keyed to where people live.** `rimT`
  (`continent.js:705-708`) normalises against the PLATE, whose centre is dragged **~1,700 u north**
  by the Greater Mercy backdrop envelope — so `RIM_IN 0.42` puts the rim's inner edge at z = +278
  while Goldspire sits at 1,370 and Cape Harbor at 995. **Both southern mini-cities are already
  inside the rim band**, invisible only because it is capped at 23 u. `RIM_METRIC_SETTLED` re-keys
  it to the settled union and must land before any sector carries amplitude.
- **TRAVEL BUDGET — it lands inside the only published tolerance band.** Fondly-remembered
  crossings cluster at **8-20 min** (GTA V 8 min best-route / 17:52 scenic on 75.84 km²; RDR2 16 min
  at gallop; FUEL's 14,400 km² Guinness record was panned as *"long and boring road trips"*). Rim
  plate: **7.5 min** across at 40 m/s, **10.2 min** diagonal, **16.3 min** at a realistic 25 —
  **~3.9× GTA V's area at ~1.3× its crossing time**, with the settled interior unchanged at 4.0 min.
  **The longest airliner leg is ~3-4 min gate to gate — half of GTA V's cross-map DRIVE.** Do NOT
  slow the cars (Rockstar compresses the MAP, not vehicle speed); slow the *frontier* — unpaved
  track, bending loop, real terrain pitch — and let the plane be the fast way. Menu warps erase
  scale; a stolen jet compresses it while keeping it visible, which is why GTA V shipped with no
  fast travel at all.
- **THE NUMBER THIS PILLAR LIVES OR DIES ON.** Elden Ring's Mountaintops and Consecrated Snowfield
  are its literal rim and its weakest content: the escalation in vista **was not matched by
  escalation in density**. Counter-measure is a ratchet, not a promise —
  **`rimAudit().poiGapMax ≤ 4,200 u`** along the frontier loop (Witcher 3's on-record 40-second
  rule → 1,400 u ideal; the 120 s design consensus → 4,200 u ceiling; the 67,562 u loop therefore
  needs **16 POIs minimum, 48 at the ideal**). All sixteen are reachable from generators that
  already exist or are already planned — `cityGridStamp`, `airfieldKit`, the four nation towns,
  `venueSite`, `fishSpotRegister`, a legendary's range, a `contracts.js` giver. **It is
  scheduling, not new work.**
- **THE EDGE FICTION COSTS NOTHING.** Sea on south/east/west with GTA V's exact answer already
  shipped here (`wildlife_shark.js` on `predatorHunt`/`predatorSeize`, plus `SWIM_SINK`'s 28 s
  breath meter); the Mercy Wall stops you because `snowCover`'s shed law makes it bare rock past
  ~45° and the ridge simply gets steeper; the camera-centred ocean disc gives Just Cause 3's soft
  infinite fade for free. **No invisible wall anywhere.** Cold as a diegetic cost is named as a
  candidate and is explicitly NOT a dependency.
- **WAVES.** R1 the law (six sectors declared at today's 23 u — **the world must come out
  byte-identical**, that is the proof) · R2 the belt and the gate · R3 the amplitude (the wave the
  owner sees) · R4 **the fill**, which is §3.2's wave 4 promoted out of optional. Flags
  `WORLD_RIM_V1` · `RIM_BELT` · `RIM_METRIC_SETTLED` · `RIM_SECTORS` · `RIM_RANGE_AMP` ·
  `RIM_TREELINE_FRAC` · `RIM_SANDUR` · `RIM_ERG_MEGADUNE` · `RIM_TAIGA_TREES`.
- **THE ONE REAL FRAME COST, NOT SOFTENED:** the taiga sector at `biome_forest.js:367`'s
  `STEP = 11 × √FSC` is **~4× today's tree count**, on a renderer measured at 2,668 calls with
  *"safe headroom mostly exhausted"*. It has its own flag so it can be turned off alone, and it
  must land under `drawBudgetAudit().predictedCalls` or ride the fauna pillar's instanced proxy.

**Contract line other pillars cite, verbatim:**
> **`CBZ.rimSector(id, {bearing, arc, regime, biome, tone})`** — a sector declares **which way it
> faces and what kind of place it is**; the rect, reach, seam band, ceiling, amplitude, treeline and
> cover ramp all derive from the live plate and the settled union. **No sector types a coordinate,
> and a fifth corner is a ROW.** It registers its region with **`underlay: true`**, and that one
> word buys two pinned invariants at once — `roadrules.js:902` skips underlay regions (so
> `roadClearanceAudit().violations` stays 0 and the frontier loop is not clamped out of the sectors
> it exists to cross) and the math gate's overlap sweep filters `!r.underlay` (so region overlaps
> stay 0 with six new adjacent rects). Three consumers migrated in the same change, and all three
> are **deletions of a special case**: `continent.js`'s uniform `RIM_CEIL` band, `terrain_overhaul.js`'s
> hardcoded `snowSector` window, and `biome_desert.js`'s outward feather.

**The sentence for the owner:** *the map already has 97 km² of empty rim you have never had a reason
to drive to; this makes it 220, gives each corner a climate that explains the one next to it, and
puts the far edge four minutes away by air instead of sixteen by road.*
