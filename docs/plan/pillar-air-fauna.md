# PILLAR: THE NETWORK + FAUNA — design plan (2026-07-27)

OWNER, verbatim: *"there should be an airport outside every city so then there can be
airliners flying between the cities and airports can actually gain some value and airliners
can make the sky more interesting"* + *"way more animals especially sea animals."*

Both asks are the same shape and it is the LEGO shape: the world already contains every part
needed and each part is welded into exactly one closure. An airport exists — as a 2,936-line
hardcoded landmass. A school of fish exists — as 15 independent `THREE.Group`s. Nothing here
is a new subsystem; every section below is an EXTRACTION plus one genuinely new thing.

Sources: `recon-air-wild.md` (all §A/§B claims), `recon-existence.md` §9 (witness block),
`recon-scale.md` §8-9 (perf ground truth), verified in code where cited.

---

# 1. AIRPORT AS A STAMP

## 1.1 The fault, precisely

`src/city/island_airport.js:1313` is `CBZ.addLandmass(function(city){…}, 21)` — one closure.
Every coordinate is a literal off two module consts (`island_airport.js:1292-1299`):
`A_MINX = -900+_WOFF.dx … A_MAXZ = 40+_WOFF.dz`. `CBZ.worldOff("airport")` MOVES the one
airport; it does not make a second. Meanwhile the world has **17 registered settlements**
(`CBZ.settlements`, pushed by `towngen.js:908`) and exactly **2** places with a runway
(Halloran + the military strip, `island_military.js:1212-1232`). Fifteen towns cannot be
flown to or from.

The proven counter-pattern is one file over: `minicities.js:60-67` `PLACEMENTS` +
`buildMiniCity(city, place)` (`:154-247`), each entry independently try/caught (`:262-267`)
so one bad stamp cannot sink the world.

## 1.2 The block: `CBZ.airfield(city, spec)` + `CBZ.airfieldKit(settlement)`

New file `src/city/airfield.js`. Two entry points, and the SECOND is the one that makes this a
block rather than a table — the `predatorKit`/`powerKit` lesson from CLAUDE.md: *"If your
shared block needs a config bundle, ship the thing that WRITES the bundle, or the block will
sit at one consumer forever."*

```
CBZ.airfieldKit(settlement)  ->  a complete spec, DERIVED from the settlement's own record
CBZ.airfield(city, spec)     ->  builds it, registers it, returns the registry record
```

**Nothing about a field is authored per site.** `airfieldKit` reads the settlement record
`towngen.js` already publishes — `{name, cx, cz, rect, tier, counts:{shops,homes}}` — and solves:

| derived | rule | why not authored |
|---|---|---|
| `tier` | `capital \|\| (shops+homes) >= 60` → 1 (regional), else 0 (strip). Tier 2 reserved. | a town's size is already a number; a second one would drift |
| runway length | `380 * (tier+1)` m — 380 grass strip / 760 regional (Halloran's 1,090 stays bespoke) | length follows the aircraft the tier serves |
| runway width | `18 + 6*tier` m | ditto |
| field centre | `D = max(hx,hz) + 160` from the town centre, on the side facing AWAY from map centre (box metric, `minicities.js:88-98`'s `rimFraction` frame); next candidate side if that one is water | "outside every city" as arithmetic, and it puts the field between town and wilds, never between town and downtown |
| runway heading | argmin over 4 candidate bearings × 4 offsets of (region overlaps, `city.roads` crossings, relief variance at 9 `CBZ.countryReliefAt` samples). Pure argmin, **no RNG**. | the one thing that can go wrong is the runway lying across a road or a hill |
| gates / tie-downs | `tier ? 2 : 3 tie-downs` | |
| staffing | tier 0: 1 post. tier 1: 4 posts (ramp agent, fueller, desk, tower) | |
| perimeter | `venueSite.fence` closed path 40 m outside the apron, `h: 2.4` | matches the two existing fences exactly — see §4 |

## 1.3 What each piece is built FROM (nothing new is authored)

- **Ground** — ONE canvas-baked plane carrying grass + runway + taxiway + apron + all paint,
  copying `island_airport.js:1395-1478`'s unified-texture trick. That trick exists explicitly to
  kill z-fighting between separate slabs; re-deriving it as N slabs would re-introduce the bug it
  was written to fix. **1 draw call for the entire field surface.**
- **Perimeter + gatehouse + approach lamps + parking bays** — `CBZ.venueSite`
  (`speedway_structures.js:1386`), already used by `island_speedway.js` and `arena_fights.js`.
  Budget is published in its own header: fence = **2 draws at any length**, lamp row **4**,
  monument **3**, gatehouse **~16**, and `bays()` derives painted stalls and parked-car slots
  from ONE solve so they can never disagree. `island_airport.js` hand-rolls its fence
  (`:2569-2570`); the kit does not.
- **Terminal / FBO shell** — `CBZ.cityMakeBuilding` (the same call Halloran's terminal uses,
  `island_airport.js:1526`), which batches through the tile batcher. ~4-6 draws.
- **Tower** — tier 1 only: shaft + glass cab + beacon, 3 draws.
- **Staff** — `CBZ.cityStaffVenue(id,{stations})` + `CBZ.cityStaffPost({venue,x,z,face,job})`
  (`citystaff.js:338/349`). This is the adoption `island_airport.js` skipped: it hand-rolls
  `populate()`/`airportRole()` (`:2696-2784`) with literal x/z desks. The kit declares posts as
  DATA; a body is minted only inside 170 m and released past 320 m, so **12 fields cost the
  bodies of ONE field** — you can only stand at one. `VENUE_STAFF_MAX` (40) is the citywide roof
  and already exists.
- **Aircraft** — `CBZ.cityRegisterVehicle` on 1-2 parked light aircraft per field, tier 1 only.
  Stealable, enterable, damageable like every other vehicle (owner law: no dumb props).
- **Regions / keep-outs / roads** — `registerCityRegion` (`worldmap.js:318`),
  `registerNoSpawnZone` (`:502`), `registerWorkAnchor` (`:587`), `city.roads.push`. All four are
  already coordinate-parametric and N-safe.

## 1.4 What stays bespoke, and why

**Halloran Field stays exactly as it is.** Wave A1 does not open `island_airport.js` at all.
Halloran owns four things no regional field should have and that would triple the kit's size:
the walk-in airliner cabin + boarding arc, `airside.js`'s 5-vehicle service loop, the jet-bridge
choreography, and the scripted pushback state machine. Regional fields get a **fuel truck and a
ramp agent** and nothing else — `airside.js` remains international-tier-only, or 12 fields
become 60 service vehicles.

`CBZ.airfieldAudit().bespoke` is pinned at **1** and may only go DOWN — the exact ratchet shape
`CBZ.cityOriginAudit().bespoke` uses (pinned at 3). If a later wave promotes the cabin, the
number drops; nothing may ever raise it.

## 1.5 Determinism, regions, keep-outs — the discipline

- The `AIRFIELDS` table is authored data walked in ONE `CBZ.addLandmass(fn, 35)` (after
  minicities at 34), **each row independently try/caught** exactly as `minicities.js:262-267`.
  No `Math.random` anywhere: per-field dressing uses `CBZ.hash01(x, z, salt)`; the heading solve
  is a deterministic argmin.
- Each field registers ONE rect region + ONE airside keep-out.
- **The keep-out stops at the kerb.** CLAUDE.md's own KNOWN-AND-NOT-FIXED entry: Halloran's
  airside rect is `{minX:A_MINX, maxX:A_MAXX}` while its landside perimeter road runs at
  `A_MAXX - 22` — 22 m INSIDE the keep-out for its whole length, which is why
  `roadClearanceAudit().zoneCrossings` is pinned at 1. The kit computes
  `keepout.maxX = apronMaxX - roadOffset - halfRoadW`, so **every new field lands at 0 by
  construction** and the pin never rises.
- The access road obeys `roadClearance`/`roadClamp` for free via the **DESTINATION RULE** (a
  segment whose far endpoint is inside the region is exempt) — a road is allowed to reach where
  it is going. Traffic reaches it through `CBZ.roadPick` (`roadrules.js:539`), never a
  hand-placed car.
- Terrain: the field is a BUILT surface, so `TERRAIN_FLATTEN_UNDER_BUILT` lowers the country
  relief under it automatically. **Never raise a runway to clear terrain.** The gate can only
  lower `h`, so `mountainCellsOutsideSnow` / `cityOnMountain` get MORE true, never less.

## 1.6 Draw budget (the whole reason this is affordable)

| tier | ground | fence | lamps | gatehouse | terminal | tower | bays/lighting | **total** |
|---|---|---|---|---|---|---|---|---|
| 0 strip | 1 | 2 | — | — | — | — | 2 (windsock, tie-downs IM) | **≈ 5** |
| 1 regional | 1 | 2 | 4 | 16 | 5 | 3 | 3 (edge-light IM, bays, sign) | **≈ 34** |
| 2 Halloran | unchanged (bespoke) | | | | | | | |

12 new fields (8 regional + 4 strips) = 8×34 + 4×5 = **292 draws — if every one were on screen
at once.** They cannot be: `farcull.js`'s tier radii are 230..700 (`quality.js:65-73`) and every
field is ≥ 160 m outside a settlement that is itself hundreds of metres from the next. Real
steady-state cost is **one field, ≈34 draws**, against the measured calm-t4 total of 2,668
(`recon-scale.md` §8). That is **1.3%**.

## 1.7 Ratchet

`CBZ.airfieldAudit()` → `{fields, byTier, roadless, overlaps, keepoutCrossings, unstaffed,
bespoke}`. Shape copied verbatim from `CBZ.govComplexAudit()` (`overlaps`/`roadless` pinned 0,
the one legitimate exception reported separately). `roadless`, `overlaps`, `keepoutCrossings`
pinned **0**; `bespoke` pinned **1**, down-only. **NOT YET MEASURED — the first run writes the
numbers.** Do not repeat the `propUseAudit` mistake of pinning a guess.

---

# 2. THE AIRLINE NETWORK

## 2.1 The registry (new, ~90 lines, `src/city/airnet.js`)

```
CBZ.cityAirports = []                 // reset per world build
CBZ.airportRegister(rec)              // called by airfield.js AND by island_airport.js
rec = { id, name, settlement, tier, x, z,
        bounds:{minX,maxX,minZ,maxZ},
        runway:{ x0,z0, x1,z1, w, hdg },      // centreline endpoints + true heading
        elev,                                  // CBZ.floorAt at the threshold
        gates:[{x,z,heading}], services:{fuel,tower,customs} }
```

**The approach fixes are DERIVED, never authored.** `rec.approach(end)` solves threshold −2,200 m
along `hdg` at a 3° glideslope → 115 m AGL, from the runway record itself. This is the
`roadJunctions` law ("a junction is derived, never authored") and the `lampMast` lesson ("two
constants describing one object were authored independently" — that WAS the bug). One solve, and
a runway that moves takes its approach with it.

Census registry pattern is `CBZ.heliFleet`'s (`aircraft.js:2082`, four pushers, audit never
learns a name): each field pushes one record; the audit iterates the list.

**Back-compat, do not skip:** `city.airportAudit` (`island_airport.js:2861`) is read by
`airside.js:435` and `games/airport.js:676,865`. It must keep pointing at Halloran. The list is
ADDITIVE.

## 2.2 What is genuinely missing (per dossier §A6) and what it is built from

| missing | built from |
|---|---|
| multi-airport registry | new, §2.1 |
| route legs / flight plan | **`CBZ.airRoute(craft, dt)`** — generalization of `aircraft.js:1898-2003`'s police-jet phase machine (`spool→taxi→lineup→takeoff→inbound→…→return→landing→taxiHome`). That machine is complete and correct; every constant in it is measured off `j.home`, ONE hardcoded base. The generalization is: **replace `j.home` with `craft.from` / `craft.to` registry records.** ~200 lines, most of it moved not written. |
| approach / landing grading | already exists — `games/airport.js` has PAPI lamps, glideslope, `simLanding` touchdown grading (`:107-130`, `:526-601`). Promote `papiAt`/`simLanding` to `airnet.js`; the charter game keeps calling them. |
| aircraft physics | `aircraftphysics.js` / `CBZ.aeroPhysics` — untouched; the police jet already composes route-machine + aero layer (`aircraft.js:1996-2003`). Copy that composition. |
| the airframes | `island_airport.js:2132-2424`'s `buildAirliner()`/`buildPrivateJet()` (~12 draws/plane, part-kit merged) + `airtraffic.js`'s GA/heli builders. **Zero new models required for v1.** |
| a manifest that means something | §2.4 |

Phases: `park → pushback → taxiOut → lineup → takeoff → climb → cruise → descend → approach →
flare → rollout → taxiIn → turnaround`. Cruise is a great-circle straight line at
`ALT = 900 + 120*legIndex` (stacked like `airtraffic.js`'s `ALT_BANDS`, so co-altitude conflicts
are impossible by construction). Turn radius uses `CBZ.heliOrbitBank`'s sibling law — a
coordinated turn holds `tan(bank) = v²/(gR)`; **author the bank, solve the radius**, never both
(CLAUDE.md's helicopter entry: authoring radius AND speed AND bank separately is exactly how
three flight models drifted into geometry no aircraft could fly).

**Block Law #3 — three consumers migrated in the SAME change:**
1. `aircraft.js`'s police jet — its home becomes a registry lookup; `airNetAudit().hardcodedHomes`
   drops to 0.
2. `airtraffic.js`'s 4 GA craft — **the migration that answers the owner's actual ask.** They
   fly the same airframes at the same draw cost, but on legs BETWEEN registered fields instead of
   orbiting one point forever. A sky is interesting when aircraft are going somewhere.
3. The new AI airliners.

Plus a fourth for free: `games/airport.js`'s `DESTS` (`:147-158`) — three abstract open-water
beacons whose own header calls them "uncontrolled outstations" because there was no second
landable airport in the world. They become real fields. The sea beacons stay as the degrade for
a world with < 2 airports.

## 2.3 The schedule

`SCHED` is derived, not authored: for each ordered field pair, a leg is offered if
`dist(A,B) > 900 m` and `min(tierA,tierB) >= 1`. Departure times hash off
`CBZ.hash01(A.x, B.z, "sched")` so every client sees the same timetable. **At most 3 airliners
airborne at once** (`AIR_NET_MAX_FLIGHTS`), spawned/despawned through `npcTransitionSafe`'s law
— a flight that "starts" out of sight starts at cruise; one that starts near you starts at the
gate and you watch it push back. Nobody ever watches an airliner appear.

Legs are SHORT, and this is the single most important number in the whole pillar. The widest
authored pair is Mbeya City (-2200, -1200) to Veridia City (2000, -400) — `countries.js:188-303`,
before each one's `worldOff` dial — i.e. `hypot(4200, 800) ≈ 4.3 km`, call it 4-6 km after the
layout dials. At a 180 m/s cruise that is **24-33 s gate to gate**. A typical leg (mainland →
Goldspire, ~1.8 km) is **10-15 s**. It decides §2.4 completely.

## 2.4 THE PLAYER VALUE LOOP — the ride is REAL, because the ride is 28 seconds

CLAUDE.md law, applied: the cab-ride anti-pattern is BANNED; a handoff happens inside a sealed
vehicle (`wanted.js:788-810`'s arrest arc — *"the mode/place handoff happens INSIDE the sealed
car — the elevator law — never as a visible teleport"*), never as a fade.

Because a leg is under a minute, **there is no need for a cut at all.** The strongest available
answer is also the cheapest:

1. **BOARD** — `aircraft_doors.js`'s existing walk→open→step→handover→close arc, unchanged. You
   walk the real cabin (`island_airport.js:585-1151`) and sit in a real seat via
   `CBZ.propSit`. `npclife.attach` + `syncAttached` holds you (the seated-body law).
2. **FLY** — the airliner really taxis, really rotates, really cruises, really lands. You are a
   passenger looking out a window at the world you drove through. Nothing is faked and no new
   camera mode is needed.
3. **DISEMBARK** — the same arc at the far gate, at a REAL airfield, in a REAL town.
4. **The SKIP is the sealed cut, and only the skip.** A `SLEEP THE LEG` verb on the seat runs
   `cinematics.js`'s director inside the sealed cabin (the arrest-ride grammar) and hands you
   back at the far gate. Never a black screen, never a teleport.
5. **CHARTER** — `games/airport.js` already is this loop; it gains real destinations and real
   landings to be graded on.
6. **STEAL** — already works end to end (`spawnFlyableFromProp` + `cityVacateFlightDeck`,
   `playeraircraft.js:1036-1050`, which throws the crew out ALIVE and must never reach the
   killfeed). At N airports it becomes a network: steal at A, land at B.
   **`AIR_ARRIVAL_CRIME`** — an unannounced landing at a manned field is one `wanted.js` crime,
   raised by `airRoute`'s rollout phase. It is a real caller from day one; a crime with no
   caller is the "Reckless Driving" stat fiction this repo already found and killed.
7. **CARGO** — ONE `contracts.js` template row, `air_freight`. It obeys that file's binding law
   verbatim (*"the generator picks the verb, the WORLD supplies the specifics"*): it binds to two
   REAL registered fields and a REAL parked airframe, and `available()` returns **false** if the
   world has fewer than two airports or no parked aircraft. Payout and tracking are
   `CBZ.mission.start({goal:"deliver", at: dest.apron, reward})` — no HUD, no waypoint, no
   payout code written here. Gate it behind a rank verb (`ferry`) so it also satisfies "a rank is
   a verb, or it is nothing".

## 2.5 Sky presence

- **Not contrails.** Contrails form above ~8 km; this game's aircraft cruise at 900-1,400 m, so a
  contrail would be a lie the owner would spot. What actually makes a sky read alive at these
  altitudes is **lights**: red anti-collision beacon at 0.75 Hz, wingtip red/green, white
  double-flash strobes at 1 Hz. Three emissive quads per airframe, additive-blended, visible from
  the ground at night. This is the correct physical answer AND the cheap one.
- **The silhouette at altitude** — an airliner at 1,200 m is ~12 draws and is culled by
  `airtraffic.js`'s existing `VIS_RING` (520) pattern; extend to 1,800 for the cruise layer.
- **Arrival/departure noise** at a field you are standing at: `CBZ.sfx` rumble keyed on slant
  range, the same call the police jet already makes (`aircraft.js:1895`).

## 2.6 Ratchet

`CBZ.airNetAudit()` → `{airports, routes, inFlight, legsFlown, arrivals, orphanFields,
hardcodedHomes, bespokeFlightModels}`. `orphanFields` (a registered field no route ever serves)
and `hardcodedHomes` (an AI aircraft whose base is a literal, not a registry lookup) pinned at
**0**. `bespokeFlightModels` starts at 3 and must reach 0 as the three migrations land.
**`legsFlown` counts REAL completed legs** — the anti-stat-fiction counter, the same job
`swimAudit().drowned` and `arrestAudit`'s TALLY do. **NOT YET MEASURED.**

---

# 3. 10x FAUNA, ESPECIALLY SEA

## 3.1 The fault is draw calls, and it is arithmetic

Every animal is a hand-built `THREE.Group` of individual boxes added straight to the scene root
(`wildlife.js:212-269`), nothing merged, nothing instanced, `castShadow = true` on every mesh
(`:227`). Counted from source: **mackerel 15 meshes, dolphin ~18, humpback ~14, great white ~24,
megalodon ~26.**

Today's sea population (`DENSITY=850`, `BIOME_SHARE.water=.20`, weights common 12 / rare 1):
target 170; mackerel 78, dolphin 78, great white 7, humpback 7, megalodon 1 = **171 creatures,
5 species, for the entire ocean.**

**A single visible school of 15 mackerel is 225 draw calls** — 8.4% of the whole measured
calm-t4 frame budget of 2,668, for fifteen fish. That is why the answer is not "raise DENSITY".

## 3.2 The tier ladder

Four tiers. Only tier N is new code; the rest is existing machinery pointed at a new promoter.

**TIER 3 — FAR PROXY (new).** ONE `InstancedMesh` for the entire world's fauna. Geometry: a unit
box, per-instance scale from the actor's OWN measured `Box3.setFromObject(grp)` taken once at
spawn, per-instance colour from `sp.color`. **This is `farcull.js:43-113` verbatim** — its
`real-building-distance-lod` proxy already carries an unbounded number of far buildings in one
draw from live records, with `userData.dynamic = true` so the batcher leaves it alone and
`frustumCulled = false` because r128 prototype bounds do not span instances. Copy it; do not
invent it. **Cost: 1 draw call at any population.** Memory: 16 floats/instance → 3,400 animals =
218 KB. (`venueSite.fence`'s own comment warns against blanket-allocating 4096 instances; size
the pool off the real population, same rule.)

**TIER 2 — THE SCHOOL IS THE RENDER UNIT (new, and the headline).** The herd is ALREADY a data
structure: `joinHerd`/`updateHerds` (`wildlife.js:733-757`) maintain a live centroid, mean
heading and panic level. Promote it to the render unit — one `InstancedMesh` per schooling
species carrying that species' geometry **merged once** (BGU, exactly what the gate-lounge
benches and parking bays already do), with the members as instances. Individual offsets are a
deterministic phase off `CBZ.hash01(memberIndex, 0, "school")` around the centroid; per-fish AI
does not exist because a fish in a school does not have any. **A 60-fish school = 1 draw call.**

**TIER 1 — MID.** `wildlife_shark.js`'s fin + wake + shadow proxy (524 lines, "the fin is the
point") is a proven cheap stand-in for a detailed body. Generalizing it — the "fin" is
geometrically the topmost cluster above the swim axis, the same discovery rule `buildSwimRig`
already uses — gives every large aquatic a surface read at range. **Wave B4, not B1** — it is a
real animation lift and B1 is affordable without it.

**TIER 0 — NEAR: today's full rig, byte-identical.** Bounded by a new `WILDLIFE_RIG_CAP` (48,
matching `crowd.js`'s CAP of 48 promoted agents, which is the proven number for this game). The
nearest N animals hold rigs; the promoter is `crowd.js`'s promotion pool with the animal list
substituted, INCLUDING `npcTransitionSafe` so a rig is never handed out in view
(`cityCrowdSpawnAudit().spawnsInView` is pinned at 0 for exactly this reason).
**`castShadow` is set on tier-0 rigs only** — never on an instance. One line, and it stops the
shadow pass scaling with population.

**The win the ladder buys is not speed, it is BOUNDEDNESS.** Today's cost is whatever happens to
be near you, unbounded. After: `48 rigs × ~15 = 720 draws` absolute worst case, `+1` for all far
fauna on Earth, `+1 per visible school`. Typical view: 6 rigs + 2 schools + the proxy =
**≈92 draws for a scene containing 3,400 animals.**

## 3.3 Brains LOD

The freeze law already exists and is good (`wildlife.js:2674-2712`: far + calm land animals
`continue` after one `turnT -= dt`, with three deliberate exemptions — a feeding animal, a hungry
predator inside `HUNT_SIM_R`, and any hot state). Two additions:

- **An 8-phase stride for the frozen set.** The file already half-does this (`a._lodF` halves the
  rate past 90 u, `:2701-2708`); extend to `_lodPhase = i & 7`. Tick arithmetic: today 850
  unconditional iterations/frame. After, at 3,400 animals: `3400/8 + ~50 near ≈ 475` effective
  iterations — **cheaper than today**, at 4x the population.
- **Aquatic apex predators stop being blanket-exempt.** Today sharks/megalodon run
  `CBZ.sharkBrain` even while hidden (`:2591-2603`) because the fin-horror design needs a shark
  to close distance unseen. At 168 sea predators that is 168 unfrozen brains. Narrow the
  exemption to `CBZ.predatorIs(a) && dist2(player) < HUNT_SIM_R2` — `predatorIs` is already
  CLAUDE.md's ONE answer to "does this hunt the player"; never re-derive a danger threshold.
  Everything else freezes normally.
- `breed()` (`:889-964`, every 26 s, O(n)) is fine at 3,400 and needs no change.

## 3.4 The aquatic spawn band bug — measured, not assumed

`wildlife.js:77-79`: `AQUATIC_R0 = 560`, `AQUATIC_R1 = 1500`, `FIELD_CX = 0`, `FIELD_CZ = -700`.
That annulus reaches `x ∈ [-1500, 1500]`, `z ∈ [-2200, 800]` — **centred on the pre-enlargement
mainland.** Against the shipped world:

- Veridia City (2000, -400) → 2,000 u from field centre → **outside the band entirely.**
- Mbeya City (-2200, -1200) → 2,256 u → **outside.**
- Keshtown (1900, -1600) → 2,090 u → **outside.**

Three of four nations' coastlines have **zero chance of a primary aquatic draw.**
`waterfield.js:262-289` does carry a `SEA_WORLD_BOUNDS` fallback — and its own comment admits
*"the continent expansion can consume an old radial ocean band entirely"* — but the fallback only
fires after 96 failed tries, and the tries almost never fail because near-mainland water is
always valid. So the fallback is dead code in practice and the far coasts are empty.

**Fix, in the repo's own idiom: derive the sample domain instead of authoring it.** Sample
uniformly over `CBZ.SEA_WORLD_BOUNDS` (`world.js:159` — the real footprint of the ONE sea mesh)
inset by clearance, keeping `isNavigableWater` as the accept test. That is literally the existing
fallback code promoted to primary; the annulus survives only as the degrade when
`SEA_WORLD_BOUNDS` is absent. This is the same "measure instead of assume" move that fixed the
reachable backdrop range (`TERRAIN_BACKDROP_CLEAR`).

**Then weight it by the shelf.** A uniform sample over a 25,000-unit sea puts almost nothing
where a player ever swims. `waterfield.js`'s `shoreAt(x,z)` already answers depth: bias 70% of
sea life into the `0 … -60 m` shelf band that rings EVERY landmass
(`WILDLIFE_SHELF_WEIGHT = 0.7`). Realistic and player-visible in one number.

**Determinism warning, do not skip:** this changes the RNG draw pattern on the shared seeded
stream, so world builds move per seed. That is permitted (the law is byte-identical *per seed
across clients*, not across versions) but it WILL move the math gate's biome histogram and
golden counts. Wave B2 lands with a deliberate `--calibrate` and its own flag
(`WILDLIFE_SEA_SPREAD`) so the old world is one line away.

## 3.5 Density: the new numbers, with the arithmetic

Owner asked for more animals and **especially** sea animals — so do not scale uniformly.

`DENSITY 850 → 3400` and `BIOME_SHARE {forest .25→.20, farmland .16→.11, desert .23→.16,
snow .16→.11, water .20→.42}` (sums to 1.00).

| biome | before | after | × |
|---|---|---|---|
| water | 170 | **1,428** | **8.4** |
| forest | 213 | 680 | 3.2 |
| desert | 196 | 544 | 2.8 |
| farmland | 136 | 374 | 2.8 |
| snow | 136 | 374 | 2.8 |

Combined with schools raised to `herd:[30,60]` (affordable only because a school is now 1 draw),
the *visible* sea read per encounter goes from ~15 fish to ~45 — so the effective sea multiple
is **≈10x on population and ≈25x on what you actually see**, at a fraction of today's draw cost.

## 3.6 New sea species — DATA ROWS ONLY

Repo law: no species tables in behavior code; `predatorKit` derives everything from
`scale`/`spd`/`bite` through ONE archetype table keyed on `creature_combat.js`'s style string,
and **adding a species must never mean adding a row to it.** Every entry below is a
`CBZ.defineSpecies({...})` call in `src/city/wildlife/aquatic.js` and nothing else.

| species | rarity | key fields | what it costs in behavior code |
|---|---|---|---|
| **Orca** (pod) | uncommon | `herd:[3,6] packs:3 danger:.7 bite:45 hp:420 scale:1.9` | **ZERO.** `wildlife.js:1949` already calls `CBZ.predatorPack` — this is the first aquatic pack predator and `predatorPack` was built for exactly this. The pod surrounds you because at most one holds the commit token. |
| **Hammerhead** | rare | `danger:.5 bite:26 hp:120 scale:1.05` | zero — a second fin so the great white is not the only one |
| **Manta ray** | uncommon | `danger:0 scale:1.4 herd:[1,3]` | ONE geometric branch (below) |
| **Sea turtle** | uncommon | `danger:0 spd:.9 scale:.55` | same branch |
| **Reef fish** | common | `herd:[30,60] packs:6 scale:.28` | zero — colour and the shelf band's populated read |
| **Jellyfish** | common | `herd:[8,16] danger:.1 spd:.3` | zero |

The ONE new animation: `buildSwimRig` discovers a tail as *children behind the origin*
(`wildlife.js`). A ray and a turtle propel with LATERAL flapping, not tail undulation. Add a
**geometric** discovery — children whose |z| offset exceeds their |x| offset by ≥2x are WINGS —
and a `swimFlap` beat beside the existing undulation. Discovery, not a species list; every future
flapper is free. Same law as `predatorPose`'s "front legs = columns with x > 0".

**No calf species.** Breeding already exists (`:889-964`) and a calf is what breeding PRODUCES.
Add ONE schema field — `juvenile: {scale: 0.42, follow: true}` — applied by `breed()`; the calf
joins its parent's herd through `joinHerd`, which already holds it near the centroid. One field,
and **every species in the game gets young**, including the humpback the owner would notice.

## 3.7 Witness escalation (the budget partner — `recon-existence.md` §9)

The tier ladder IS the virtual-existence ladder for fauna, and it plugs into the witness block at
three points, all cheap:

1. **A far-tier instance is the "virtual" state.** It costs 1/N of one draw and needs no ledger:
   determinism regenerates it byte-identically (`hash01` is position-derived).
2. **`_witnessed` promotes and PINS.** An animal the player has actually looked at (the one flag
   write at `peds.js`'s `vis` compute + `aim_dossier`'s `aimedActor()` sweep) is refused
   demotion to the instanced tier while in view. This is the fauna consumer of
   `witnessAudit().recycledWitnessed`.
3. **Legendaries go into `cityIdentities` at spawn** — TWO call sites, and it closes the single
   biggest continuity gap in the recon (§B5): wildlife has NO serialize hook anywhere, so
   "hunt the megalodon to extinction, forever" currently un-happens on reload. `cityIdentities`
   already round-trips through `worldstate.js:220,286` and `netpersist.js:139,266`.
   `spawnAll()` skips ids marked dead. **Do this in wave B1** — it is inside wildlife.js's
   territory and it is the cheapest high-value item in the entire pillar.

## 3.8 Ratchet

`CBZ.faunaAudit()` → `{animals, rigs, rigCap, instanced, schools, drawEstimate, shadowCasters,
seaAnimals, farCoastAnimals, legendariesRegistered}`.
- `rigs <= rigCap` — a hard invariant.
- `shadowCasters` may only go DOWN (it is today's unbounded number).
- `farCoastAnimals` (sea animals > 1,600 u from `FIELD_C`) may only go **UP** from its measured
  baseline — the anti-regression on the band fix, and it is currently near zero by construction.
- `drawEstimate` printed beside `animals` so a "fix" that just draws fewer animals cannot pass.
**NOT YET MEASURED — the first run writes every number.**

---

# 4. CONTRACT LINES THE OTHER PILLARS CITE

- **→ SCALE pillar.** An airfield is what turns a new settlement into a DESTINATION instead of
  more suburb. The contract is one line: *any pillar that stamps a settlement calls
  `CBZ.airfieldKit(settlement)` and passes the result to `CBZ.airfield(city, spec)`.* Tier,
  runway, placement, staffing and access road all derive from the settlement's own published
  record — **a new city never authors a field.** This is also why the airfield table must be
  keyed on settlement id, not on coordinates.
- **→ EXISTENCE/WITNESS pillar.** §3.7. The far-instanced tier is the fauna implementation of the
  virtual ladder; `_witnessed` is the promotion trigger; `cityIdentities` is the escalation for
  rare individuals. The witness pillar owns the flag write and the audit; this pillar owns the
  three fauna call sites and the legendary registration.
- **→ MANTLE pillar** (dossier §MANTLE). Every airfield perimeter is `venueSite.fence` at
  `h: 2.4` — the SAME height as the airport's (`island_airport.js:2569`) and the military base's
  (`island_military.js:900-912`), which is what the mantle was sized against. Twelve new fences
  become twelve new places to climb into, with **zero geometry changes**, the day the mantle
  ships. Do not change the fence height.
- **→ ROADS.** Every field's access road is a `roadClearance` DESTINATION-RULE exemption; the
  keep-out stops at the kerb (§1.5), so `roadClearanceAudit().zoneCrossings` stays at its pinned
  1 (Halloran's) and never rises.

---

# 5. WAVES, TERRITORIES, FLAGS

**File territories are disjoint between the A and B tracks — they can run fully in parallel.**
The only shared files are `src/config.js` and `index.html`, both append-only.

| wave | territory (files it may open) | depends on |
|---|---|---|
| **A1 airfield kit** | NEW `src/city/airfield.js`; `config.js` (flags); `index.html` (1 tag) | — |
| **A2 registry + routes** | NEW `src/city/airnet.js`; `city/aircraft.js`; `city/airtraffic.js`; `games/airport.js` | A1 merged (needs ≥2 fields) — but writable in parallel against §2.1's record contract |
| **A3 passenger + cargo** | `city/contracts.js` (one row); `city/aircraft_doors.js`; `city/island_airport.js` | A2 |
| **A4 (optional) promote** | `city/island_airport.js` — move the ground-canvas baker + cabin into the kit, drop `bespoke` 1→0 | A3 |
| **B1 fauna tiers** | `city/wildlife.js` ONLY; `config.js` | — |
| **B2 sea spread** | `city/waterfield.js`; `city/wildlife.js` constants; `tools/math-gate.mjs` (`--calibrate`) | B1 |
| **B3 new species** | `city/wildlife/aquatic.js` (rows) + ONE flap branch in `city/wildlife.js` | B1, B2 |
| **B4 (optional) mid tier** | `city/wildlife_shark.js` → generalized fin/wake proxy | B3 |

**Sequencing rule:** B1 before B2 before B3 is not optional — raising DENSITY before the tier
ladder lands would put ~1,400 uninstanced sea creatures into a renderer whose own team's verdict
(`recon-scale.md` §8) is *"safe draw-call headroom is mostly exhausted."*

## Flags (all `CBZ.CONFIG.<AREA>_<BEHAVIOR>`, `if (== null) = default`, one-line revert each)

| flag | default | reverts to |
|---|---|---|
| `AIRFIELD_KIT` | true | only Halloran + the military strip; byte-identical world |
| `AIRFIELD_STAFF` | true | fields exist, nobody works there |
| `AIR_NET` | true | no registry, no routes |
| `AIR_NET_SCHEDULE` | true | registry exists, nobody flies |
| `AIR_NET_MAX_FLIGHTS` | 3 | numeric dial |
| `AIR_NET_MIGRATE_GA` | true | `airtraffic.js`'s 4 craft go back to orbits (separately revertible — it changes shipped behaviour) |
| `AIR_ARRIVAL_CRIME` | true | landing anywhere is free |
| `WILDLIFE_TIERS` | true | today's uninstanced, uncapped rendering |
| `WILDLIFE_RIG_CAP` | 48 | numeric dial |
| `WILDLIFE_DENSITY` | 3400 | **a NUMBER, so the owner can dial the whole ask himself** |
| `WILDLIFE_SEA_SPREAD` | true | the old (0,-700) 560..1500 annulus, byte-identical |
| `WILDLIFE_SHELF_WEIGHT` | 0.7 | 0 = uniform over the sea |

## Ratchets to pin in `tools/math-gate.mjs`'s PASS block

`CBZ.airfieldAudit()` · `CBZ.airNetAudit()` · `CBZ.faunaAudit()`, defined in the real game files
(never a tool), each returning live-read counts. **Every baseline in this document is UNMEASURED.**
Run them once on the merged state and write the numbers in. The `propUseAudit` lesson is the
sharpest in CLAUDE.md: an audit had sat for weeks with a header confidently instructing the next
person to pin `blocked` at 0; the first build that ever RAN it read **487**. An audit nobody has
executed is not a measurement.

## What each wave owes on delivery (builder doctrine)

`node --check` on every touched file — that is not a test, it costs nothing, and a syntax error
blocks the whole wave. Then a precise report: the audit calls, the expected values, and every
invariant the change could plausibly break. Named suspects for this pillar:
`worldLayoutAudit` (12 new regions), `roadClearanceAudit().violations`/`zoneCrossings`,
`roadTrafficAudit().trespassing`, `venueStaffAudit().unstaffed`, `groundMatchAudit().ungated`
(runways are built surfaces), the math gate's biome histogram + determinism re-run (B2 moves it
deliberately), and the golden lot/shop/road bands.
