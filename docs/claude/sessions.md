# Session and wave reports (dated evidence, newest last)

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02).
> These are dated session narratives and measured ratchets — historical evidence, not timeless law.

## THE 2026-07-27 EVENING WAVE — seven territories, one merge

Seven opus builders in parallel, disjoint file territories, orchestrator merged
and patched the seams. Every ratchet below says NOT YET PINNED because the wave
shipped without a gate run (owner's call: "no testing just building") — whoever
runs each audit first writes the number in; do not pin a guess.

- **THE WORLD IS V4-SCALE AND BIOME EDGES ARE REAL CURVES** — `SPREAD_V4` in
  `world/layout.js` (×1.60 of V3 with seven axes PINNED, each pin justified
  inline: `snow.dx` protects the Mercy lane, `speedway.dx` moves the desert east
  instead of the live build zone) + **`CBZ.worldFoot(id)` / `worldFootScale(id)`,
  the footprint registry that killed the copy-rect disease** — terrain_overhaul's
  `snowSector` and biome_farmland's `DESERT_MINZ` now ASK the owning biome
  instead of re-typing its rect (old literal kept as degrade fallback; flag-off
  is byte-identical, verified per biome). FLAT 7820×4810 → **9570×6109**; `W_ROOF`
  13500 → 15500 (union 13896 — the roof still catches runaways); `PLATE_SEG` now
  DERIVES from a 38 m cell target (320 on a V3 world byte-identical, 368 on V4 —
  cells got FINER, not coarser); sea span derives from FLAT (`CBZ.WORLD_SEA_SPAN`
  25000). **Organic edges** (`BIOME_ORGANIC_EDGES`, worldmap.js): OUTSIDE a rect
  the already-existing blend warp claims land to its own reach — that is where
  the de-squaring lives; INSIDE a rect an edge may hand a point to a neighbouring
  biome that genuinely dominates but NEVER to nothing — a hole in an authored
  painted floor is the one path to a false `mtnOutSnow`. fullmap's `coastPath`
  bisects the real 0.42 contour now instead of drawing a cosmetic wobble. Desert:
  the little gray rocks are GONE (`DESERT_ROCK_SCATTER` default false — the dead
  loop still draws its rng so no other scatter re-deals) and dunes run an
  ENVELOPE (`DESERT_DUNES_V3`): 4-16u across most of the erg, 2-3 isolated
  45-55u draa per basin on 850-1410 m fields with 10° drivable flanks, corridor
  gates keep towns and the highway flat. TWO STALE-LITERAL BUGS found by
  measuring: the Saltlands causeway had dangled 280u short of its own biome
  since stage 3, and the Coyle causeway stopped 112u short of the desert highway
  — both ends now DERIVE (`CBZ.DESERT_HWY_Z`). The highwaynet eight were
  re-derived for V4 (before→after arithmetic in highwaynet.js). Ratchet:
  `CBZ.worldScaleAudit()`.
- **A VENUE HAS A SITE, AND THE SITE IS A KIT** — `CBZ.venueSite`
  (speedway_structures.js): fence · gatehouse · monument · lampRow · bays ·
  census; a whole fence of any length is 2 draw calls. Three consumers including
  a real migration (the paddock's private fenceRun is DELETED). Ironjaw: the
  "island" was never an island — the coastline is 222u away — and the Mercy
  Causeway's east kerb ends at exactly `CW_X0`; the two decks had been
  butt-jointed with no road record for the venue's whole life. It now has a real
  road + T-junction (kerb returns, stop bars and wires arrive free via the
  roadrules/utility passes), gatehouse + arch, 828 m perimeter, 16-bay car park,
  kiosks, service yard, its first-ever keep-outs, and 6 staffed posts through
  `cityStaffVenue` (ticket sellers finally stand AT the booths that always
  existed). Speedway: **the public car park had been empty its whole life** —
  `cityMakeCar` ran inside the landmass builder before `city.arena` existed and
  every call threw into a swallowing catch; the fill is deferred now, and
  `venueSite.bays` feeds BOTH the paint and the cars so they can never disagree
  again. Flags `ARENA_SITE` / `SPEEDWAY_SITE`. Ratchet: `CBZ.venueSiteAudit()`.
- **EVERY JOB ANSWERS TO A VERB** — `city/roleverbs.js`: `ROLE_VERBS` +
  `OBJECT_VERBS`, two data tables consumed by TWO registrations total — a new
  trade or prop is a ROW (the interact.js `VERB`-table shape, deliberately).
  `CBZ.cityPedJob/cityPedJobClass` (level.js) is the promoted job accessor;
  shops.js consumes it with its private pair as fallback. Every effect runs a
  sanctioned primitive (spend/addCash/hp/hunger/econ/engineHp/respect/mission)
  — **a verb that writes a field nothing reads is a stat fiction and BANNED.**
  The game finally has a street heal (medics; paramedics discount emergencies
  under 35 hp), day labor on 17 worker trades (once per worker per day, off the
  trade's own declared shift), produce/catch purchases that register real items
  the way wildlife pelts do, courier delivery missions bound to lots the city
  built (the world supplies the destination or there is no offer), and a dealer
  you can Score from — priced ×1.15 street so flipping LOSES by construction.
  Class floors make `withoutVerb` STRUCTURALLY 0 across all ~60 jobs. Objects:
  hydrant crack (fires the existing geyser), meter jimmy (the same position
  hash as ramming, so the two payouts agree), bus-stop routes (names real
  regions), cart rummage (the existing bounded search + it is theft and files
  as such). `objectVerbAudit`'s remainder is REPORTED, deliberately not pinned
  0 — lamp/tree/planter/sign have no honest verb and a fake one is worse.
  Flags `ROLE_VERBS` / `OBJECT_VERBS`. Ratchets: `CBZ.roleVerbAudit()` /
  `CBZ.objectVerbAudit()`.
- **AN ANIMAL DIES LIKE A BODY, NOT A POSE** — `systems/quadruped_ragdoll.js`
  + **`CBZ.wildlifeDeathPhysics` (wildlife.js), the ONE death entry**: verlet
  quadruped ragdoll when the solver takes the body, the shared rigid tumble
  (`CBZ.wildlifeDeathTumble`) when it won't, NEVER a pose snap — "head pointed
  at the sky" was `rotation.z` (the model-local PITCH axis) snapped to ~1.3 rad
  in dogs.js and the beast pit; both are dead, with the snap kept only as the
  flag-off degrade. Rig discovery is GEOMETRIC (legs = taller-than-wide
  ground-touchers, head = far-forward-and-up, spine rides what is left) — NO
  SPECIES TABLE; the named refusals (swim/segs/aquatic/snake) are rig facts.
  Four bugs only math found (pure-node harness against the vendored r128):
  a planar 4-point torso can never rest on edge; the roll couple was about the
  BULLET's axis so flank shots somersaulted deer back onto their feet; the
  menace gauge starved NPC hunts (correct for the player, now player-scoped —
  existing callers byte-identical); an alarm re-raised twice a second pinned
  herds in permanent flight. Food chain (`WILDLIFE_FOODCHAIN`): prey is
  ARITHMETIC — medium match, mass ≤1.35×, danger below the hunter's, which is
  why a wolf takes an elk and never a grizzly with no name typed; kill → feed
  20-40 s → satiation 3-5 min; man-eaters need scale ≥0.85, danger ≥0.6, night
  weighting, a lone victim, global cap 2; killfeed is proximity-gated at 70u so
  a distant wolf-vs-deer never spams the corner. Cars hit animals
  (`WILDLIFE_CAR_IMPACT`): one loop in `runOver`, lethal = `pedLethal·√mass`,
  damage ∝ v², camera-gated to 240u. predator.js's `killVictim` animal branch
  now routes the REAL wildlife death — the frozen-corpse bug (undefined `skinT`
  → NaN countdown → immortal corpse) is fixed. Ratchet:
  `CBZ.wildlifeDeathAudit()` — `legacyPoseDeaths` and `frozenCorpses` are
  structurally 0.
- **VEHICLES WEAR THE ONE GLASS** — carfx.js's `glass` role delegates to
  `CBZ.glass()` (`VEHICLE_GLASS_V2`). Every canopy and windscreen in the game —
  airliner, fighters, bombers, helicopters, GA, cars, boats — was ONE shared
  MeshStandard+envMap material (near-black under a Lambert world, the exact
  failure buildings.js documents in its own reflectMats comment) cached under
  the bare string "glass", so per-aircraft tints NEVER reached a pane
  (island_military's vmat didn't even forward its color arg — fixed). Now:
  Lambert + lift, DoubleSide (a camera sits BEHIND a canopy), pool keyed per
  tint, and the callers' long-dead `{emissive, ei}` args live as a per-channel
  FLOOR so night cockpits are neither voids nor lamps. **THE FROST WINDOW IS
  LAW**: crashdeform finds glass by color arithmetic (`b−r>0.045, b<0.4,
  r<0.25`) — a tint outside the window is refused and swapped, and the worst
  live margin is a measured number (`glassAudit().frostMargin`); the airliner's
  old tint cleared by half an 8-bit step and was nudged along with its three
  siblings. Interiors already existed behind almost every pane (pilots, crew,
  car drivers, a yacht saloon) — the material was the only thing defeating
  them; the one true hollow shell (utility heli) got furniture fitted by corner
  arithmetic against the canopy taper. Ratchet: `CBZ.glassAudit()`.
- **SEATS OF POWER HAVE ROOMS BEHIND THE DOOR** — govcomplex §5c
  (`GOV_INTERIORS`): all nine complexes get designed floors that ADOPT
  occupy.js's own ledger (`_occupyProgrammed`/`_occupyAnchors`) so power.js's
  existing cast lands in these rooms — no second cast path, no peds authored
  here. **`world/roombuild.js` is AWAKE**: zero callers → three (furnishHome,
  furnishApartmentFloor, gov `room:*` floors), and waking it took SIX latent
  fixes — the headline: `roomFurnish` never forwarded the host origin, so every
  propuse anchor from a non-origin building would have been filed AT THE WORLD
  ORIGIN. Also: beds headboard-into-the-room, a lounge that produced nothing
  when the door was centred, a world-vs-host keepout compare, uncapped
  deskfarm/storage grids (the Agency's slab asked for ~5,000 boxes on one
  floor), and furniture.js's `propPurposeReset` wrap that never armed — the
  furnishAudit ledger had NEVER reset between builds. Empty floors keep their
  ratio but get five deterministic reads (`INTERIOR_EMPTY_VARIETY` — bare,
  renovation, move-out, after-hours, dark storey); interior strips ramp with
  `nightAmount` through one shared driver, zero new draw calls
  (`INTERIOR_LIGHT_DAY`). Ratchets: `CBZ.interiorAudit()` (`govBare`
  structurally 0) / `CBZ.roomPlanAudit()`.
- **ORDNANCE OBEYS ONE LAW** — `CBZ.ordnanceDropVel` / `CBZ.ordnanceSeek`
  (aircraft.js). OWNER: "bombs should drop straight down and missiles should
  have the same homing as the rpg." A free-fall store keeps 8% of horizontal —
  a DIVE is inherited whole (it points the store down) while a climb is scaled,
  so a zoom release can't toss a bomb upward; guided kits keep 22% because
  `solveGuided` budgets its whole cross-range FROM release velocity. Measured:
  300 m AGL at 105 m/s, downrange 676 m → 54 m, impact 48.9° → 5.2° off
  vertical; carpet stagger untouched (it comes from the aircraft's travel, not
  the bomb's). Missiles: every military launcher (jet, heli, tank main gun,
  JDAM, the modshop channel) acquires via lockon.js's ONE path, read LIVE per
  call so childsafe's wraps hold; playeraircraft's `fired` flag now honors the
  launcher's return (a saturated pool used to eat the shot silently).
  `strategic.js`'s makeB2 is a real lofted flying wing (span:length 2.10 →
  2.495 against the owner's b2code.html reference — planform, sweep and
  thickness laws lifted, 3 draw calls) with a two-seat deck whose windscreen is
  the removed hull piece RE-EMITTED IN GLASS — an aperture that cannot gap; the
  island heavy bomber (a B-52-class airframe, deliberately NOT reshaped into a
  second flying wing) got the deck treatment too (`MIL_BOMBER_DECK`). Three
  latent bugs fixed by reading: bay doors opened UP into the wing, the crew
  hatch swung opposite its own comment, and door geometry called `.translate()`
  on boxGeom's CACHED SHARED geometry — corrupting every other consumer of that
  box size. Flags `BOMBS_DROP_STRAIGHT` / `MIL_MISSILE_HOMING`. Ratchet:
  `CBZ.ordnanceAudit()`.

## THE 2026-07-27 NIGHT WAVE — arrest, explosions, the B-2's face

- **AN ARREST IS A SCENE, AND THE PRISON IS THE JAIL** — `ARREST_ARC` (wanted.js)
  + `PRISON_PIPE` (capture.js). The live arrest path was a same-frame teleport
  into games/jail.js's 3-cell compound that never set `g.busted` (mission
  interrupts had NEVER fired on a real arrest — fixed structurally). Now: hands
  up → REAL zip-tie cuffs + wrists-behind-back IK on the PLAYER (restrain.js's
  rig-agnostic pose, one proxy object = the whole adoption) → perp-walk to a
  marked cruiser (roadPick unseen) → driven ride with a sealed interior cut
  (cinePlay; the cab-ride fade is the named anti-pattern) → booking desk where
  the forfeit is charged ONCE and weapons go to an EVIDENCE LOCKER → the full
  prison mode serves the ONE sentence formula (`CBZ.cityJailSentence`); release
  returns property at the precinct door, escape forfeits the locker and keeps
  the manhunt. RUN from the challenge and the cop TACKLES via predatorSeize's
  new `nonLethal` resolve ("killed"→"taken" before killVictim is in reach; all
  eight existing callers byte-identical) — predatorAudit 0 legacy / **9**
  adopted. The compound is precinct HOLDING now (pry-out is a race against a
  37-49s transport clock). Every recapture inside adds +45s; a 4-beat day
  cycle (yard→chow→rec→lockdown) reuses the rooms. Ratchet: `CBZ.arrestAudit()`
  — **legacyTeleports pinned 0** (an arrest that reaches a cell by moving
  coordinates instead of walking there counts against it).
- **EVERY WARHEAD SPEAKS THE BUS, AND CARS ARE IN THE BLAST** —
  `ORDNANCE_BUS_ALL` (impactbus.js) + `CAR_COOKOFF_V2` (vehicles.js). Six
  hand-rolled detonations (RPG+40mm, grenade, tank, missile pool=airstrike,
  player fallback, explodeCar) migrated onto `CBZ.detonate` rows — the dead
  rows had drifted DOWNWARD, so the live caller won every disagreement, and
  `struct:6` is arithmetic (demolition's LEGACY_TO_LEDGER), not taste. Sound
  finally scales (`CBZ.blastVolume` = √power floored at 1) and heavy rows fire
  cityBlastWall/shatter off the same collider scan the breach already ran.
  CARS: an RPG into a car now connects (fpsmode direct-hit + deform); the 8TH
  WRAPPER (`_carBlastWrapped`/`opts._carSeen`, all markers copied) bills every
  blast's cars once (`_carBlastId` dedupes vs the wave pass); gunfire kills
  burn 2.4-4.6s before the boom, blast kills fuse at 0.4-1.6s JITTERED (that
  jitter is what makes a car park roll instead of chord), direct heavy hits
  flash 0.2-0.4s; `explodeCar` leaves a SOLID charred husk (crashdeform's
  `cityCarBurnOut` — bent, crazed, hood gone, smoulders, shunts traffic, reaped
  by the existing loop); drivers bail + cityScare when the fuse allows.
  Termination is proven: one bill per car per blast, burnt cars leave the
  ignitable set, CAR_CAP 24 / FUSE_CAP 14 / HUSK_MAX 10. **`carcook.fire=0.24`
  sits ONE HUNDREDTH under structural.js's FIRE_IGNITE_MIN — cars never ignite
  buildings; that is a one-character dial the owner flips, not a default.**
  Ratchet: `CBZ.blastAudit()` — **handRolled pinned 0**. Known: bailout.js's
  crash row was "aircraft-impact" (never existed → firecracker) with
  `frontal:true` coerced to 1m — fixed to real class rows.
- **B-2 POLISH (owner's photos)** — palette matched (light blue-grey top,
  near-black belly, fairings one step above skin), engine FIRE under player
  throttle only (`STRAT_B2_PLUME`, sprites parked for fxwarm), and [X] with
  empty racks now SAYS why (JDAM rack spent · buster/DEVICE from the vault)
  instead of silently re-picking Mk-84. Missiles get RPG PARITY: with no held
  lock, `ordnanceSeek` grabs `lockonFireTarget()` at trigger time. Bombs stay
  ballistic (buster/nuke never home; JDAM steers to a point, doesn't chase).

## THE 2026-07-27 LATE-NIGHT BATCH (owner screenshot session)

- **Ring-print pattern class DELETED at the generator** (clothes.js patternRow ban
  comment; sundress wears gingham now). **One speedometer**: carcluster owns it,
  hud.js stands down via CBZ.carClusterSpeedOwned() (the two writers shared a DOM
  id and disagreed on the unit). **INTERACT_REACH_V2**: reach 3.8→5.2, zone cone
  floor 0.5 — cards show up. **AIM_CHILD_NO_ASSIST**: aim magnetism/soft-lock/hot
  reticle all refuse protected actors (childSafeAudit OPEN 7→6); ballistics
  unchanged.
- **AN ALLEY IS A ROUTE, NOT A SHELF** — CBZ.alleyGapAt/alleyOk (props.js), widths
  solved from the player capsule (RUN 2.4 · SLOT 3.2 · OPEN 8.0), one shared
  budget map across all six scatter passes via DK.free. Window AC units CUT (260,
  no windows behind them), roof lattice → one plant deck, barriers/cones/boards
  cut, PROPS_KNOCK_PLAYER tips bins at a sprint via the existing car-knock arc.
  Flag PROPS_PURGE_V1, flag-off byte-identical (rng draws preserved). Ratchet:
  CBZ.propPurgeAudit() — alleysBlocked structural 0, acBoxes pin 0.
- **INTERIORS STAY INSIDE THEIR SHELL** — root cause: dressers disagreed about
  where the wall IS (roomKit measures inner face, furnishInterior the OUTER —
  Meridian Trust's bank partition ended 0.20 m onto the pavement). Structural
  fix: CBZ.interiorBounded wraps the ONE lbox seam — outside refused, straddle
  trimmed to the wall face; interiorAudit().spill pinned 0 with spillUnbounded
  printed beside. **INTERIOR_COHERENCE_V1**: CBZ.interiorMix data rows +
  ABOVE_TRADE (banks get workspace floors, shops get flats — never living rooms
  over a vault); new `residential` program (corridor + party walls + per-flat
  kitchen + roomPlan bedrooms, cap rides the tower) and `breakroom` (the ONE
  sanctioned office kitchen, on a cadence). CBZ.roomExecute extracted (plan once,
  draw many). **INTERIOR_LIFE_V1**: door guards + sleeping residents via
  citystaff rows (INTERIOR_LIFE_MAX_POSTS 150), CBZ.interiorRobbery — one
  citywide walk-in robbery through ped.guard/cityScare/panic/kill-bus, no
  mission system (the terrorist-shootup seam is contracts.js + mission.start,
  proposed not built). Night sweep beds idle upper-storey peds via propSeatNpc.
- **GA TRAFFIC**: AIR_TRAFFIC_CLEARANCE default FALSE (climb mode kept, one line
  back); **AIR_TRAFFIC_COLLIDE default TRUE** — original bands, and a hull inside
  a building fires the SAME downTraffic crash a bullet does (wall-face blast,
  byPlayer false, unattributed killfeed). Armed-shortlist detection: per-frame
  cost only for craft whose ring crosses something tall. Fixed fallTraffic
  detonating wrecks on rooftops ABOVE themselves. airTrafficAudit().clipping
  pin 0 (armed/candidates printed beside).
- **THE BLACK MOUNTAIN IS GONE** — terrain_overhaul's offshore range was the only
  LIT-material range (why it went near-black under every sun); TERRAIN_DARK_RANGE
  default false gates its one relief sector — tiles survive (they are the
  seabed), unlit ranges untouched, backdropAudit gains rangeRemoved and still
  sweeps (reliefCells 0 IS the proof).

- **HOW WELL A PERSON FIGHTS** — `CBZ.combatIQ` in `systems/combat_iq.js`. OWNER:
  "make npcs better at fighting… some of them shoot first… a group of them all
  with guns its just chaos… maybe you make it so much better it has to do LESS
  damage lol." Four arithmetic faults, not taste: **an armed ped never fired
  past 9.4 m** (peds.js's flat `want = 9` while npcAttack allowed 26 — every
  rifleman walked into pistol range), **nobody took turns** (N gunmen = N× DPS,
  all in the open), **the cover code was dead** (squadai.js scanned
  `cols[0..64]` — the first 64 entries of the GLOBAL collider array;
  `CBZ.queryCollidersNear` existed and no combat code called it), and **a gun
  was a damage number** (NPC_GUN had ONE row). `CBZ.combatIQ.posture(a,tgt,dt)`
  is the one call an armed brain makes. **The table is a DPS LADDER** — every
  cell is HP/s at 10 m and per-hit damage is DERIVED from it, so raising a
  tier's hit rate automatically lowers its damage; `DPS_CAP = 26` is enforced
  on the RESULT (nothing may out-damage the SWAT officer that already ships).
  Measured TTK: civ+pistol 7.9→25.0 s · thug+AK 7.9→7.7 s (unchanged) · beat
  cop 10.5→10.5 s (unchanged) · soldier+AK 7.9→4.5 s · SWAT 3.8→4.0 s; four AK
  gangers on one target 2.0→3.8 s. Adding a trade or a gun is a ROW. Flags
  `NPC_COMBAT_IQ` (master) · `_TIERS` · `_COVER` · `_SQUAD` · `_SHOOTFIRST` ·
  `_MELEE`. Ratchet: **`CBZ.combatIQAudit().legacy` pinned at 0**, adopted 7.


## THE 2026-07-28 SESSION — fixes that were laws, not patches

Owner played and reported; each of these turned out to be arithmetic, and each fix is
a law so the class cannot return. Short list, with the number that proves it:
- **GHOST CITIES** — not displacement: `interiorlight.js`'s shared glow-panel pool was
  parented to the first-registering *translated building group* while its records hold
  WORLD coords, so every panel in the city shifted by that building's offset (280-540 m
  toward the mountains, ~15-20 slab lattices + one 52-storey column — the 1400-instance
  cap exhausts inside the mainland, which is exactly what the owner saw). Now every pool
  resolves a true identity host, declares `userData.worldSpacePool`, and
  **`CBZ.poolParentAudit().atTranslatedParent` is pinned 0 in the gate** (0 is the LAW
  here, not a measured baseline). Second half: `farcull`'s ×3 slack term exempted every
  populated pool from culling forever, and four builders (govcomplex, military, terminal,
  forest cabins) never registered in the lot list the distance proxy reads — hence walls
  culling while windows stayed. Hysteresis now derives from viewer SPEED (a 20 u band
  against a 1 s amortised retest is nothing at 150 m/s), and detail fittings yield above
  320 m AGL (a 2 m fire escape is 6 px there).
- **A WALL MEETS A ROAD AND YIELDS** — `CBZ.roadGapRun/roadGapDefer/roadGapAt`
  (roadrules.js). The mainland seawall's ONLY openings were four hand-typed literals,
  each added after somebody hit an invisible knee-wall at one causeway. The derived gap
  (`max(travelled way, deck/2) + 1.5`) REPRODUCES those authored gates; 6 producers
  migrated (the Mercy berm's magic z-range literal is deleted), an order-98.6 sweep
  catches non-adopters, buildings are structurally untouchable and 3-6 m prison/gov walls
  are MEASURED not punched. Ratchet `roadBlockAudit().crossingsRemaining` 0.
- **THE WORLD STOPS BEING WALK-THROUGH** — the answer to "find things you can run
  through" was VEGETATION: thousands of trees, boulders and field fences drawn and never
  collided. 26 classes fixed across 19 files (plus a 26 m bridge-tower leg standing in a
  travel lane, Capitol bollards you could drive between, and a town welcome sign that was
  the inverse fault — an invisible 11 m wall). `CBZ.solidityAudit()`.
- **AN ALLEY IS A ROUTE** (`CBZ.alleyGapAt/alleyOk`), widths solved from the player
  capsule, one shared budget across all six scatter passes; window AC units cut (260 of
  them, hung on walls with no windows behind them — a SECOND producer was found later in
  buildings.js, and the boxes the owner then saw were the ghost glow panels).
- **A LYING BODY'S FEET ARE NOT ITS MIDDLE** — the sleep pose put the rig's ORIGIN
  (its feet) at the mattress centre, so the crown ended 0.82 m past the headboard in
  mid-air. Player and NPC now share ONE `propLiePlace` derived from the rig's measured
  height; loungers fixed by the same call.
- **ARMOUR SITS PROUD, PRONE RIFLES REFUSE THE DIRT** — `cityArmorFit` clamps every
  armour piece ≥0.01 off the outermost garment (the sweep caught that the previous
  jacket fix would have put the WHOLE VEST on the jacket plane); the prone gun solves one
  grazing-angle inequality that covers every stance/slope/barrel length, and `PRONE_SINK`
  now derives from the pitched chest box (it was tuned to the hip line, so the chest was
  0.11 m under the floor).
- **THE WALL STOPS WEARING THE EXPLOSION** — `FX_WALL_WOUNDS` default false kills the
  60-90 s wall-anchored smoke emitter and the 8 cm-proud scorch quad (both had been
  diagnosed and deleted ONCE before, then reintroduced one function over); detonation FX
  and GROUND scorch stay. Burning buildings emit at a real standoff with a flame root.
- **LOCK-ON STOPS SEEING THROUGH WALLS** — squares defaulted to VISIBLE on churning slot
  bindings faster than the one-per-frame LOS test could answer, AND the arena's invisible
  LOS proxy was still sized for the 2-tier bowl (16 m against a 25 m wall — 59% of the
  facade transparent to cops, cameras and locks). Per-actor cached LOS + the proxy walking
  the real arcs.
- **THE DRIVE-BY IS A REAL CAR** — it was never in `CBZ.cityCars` (so every bullet and
  explosion in the game was blind to it BY CONSTRUCTION), sat at a literal y=0, and the
  man leaning out the window did not exist. Now a factory car on real suspension with a
  real crew: kill the shooter and the gun stops; kill the driver and it coasts to a halt
  as a stealable gang car with bodies in it. Census cleared every other event vehicle;
  `heists.js`'s bespoke box truck is the one remaining offender (duplicates armored.js).
- **THE DEAD KEEP THEIR WEIGHT** — `city/morgue.js`. Heli crews dropped weapons AT
  150 m (their seat's world position); cop corpses were deleted after EIGHT SECONDS; ten
  `.dead = true` sites dropped nothing; `_armorKit` was never convertible to loot, so
  guards were unstrippable BY CONSTRUCTION. One drop routine at the kill choke point that
  DEFERS until the body rests, corpse persistence (costs nothing new — a corpse already
  held its list slot forever), and a real EMS arc: van drives up, medic works the body,
  **shoulder-carries it** (`ragdollPin`'s second consumer) to the tailgate; staging waits
  out hot scenes.
- **HOW WELL A PERSON FIGHTS** — see the `combatIQ` entry above; the headline is that
  **no armed NPC has ever fired past 9.4 m** and the cover code scanned the first 64
  entries of the global collider array (dead its whole life).
- **THE NUKE IS 16 KILOTONS AND KNOWS IT** — the yield is INVERTED from the bus row's
  own fireball radius (`W=(126/50)³`), so spectacle, ring damage and death toll can never
  drift. Cap 5.1 km wide / 10 km top (tropopause = a ceiling, not W^(1/3)), rendered as a
  sky-locked quad at true ANGULAR size because the honest cloud is 10× the frustum;
  cap:stem 8:1 → 3:1 (it was a chimney under a hat, and the gate meant to catch that was
  ONE-SIDED); Hiroshima's measured fatality curve replaces a cliff (everyone inside 675 m
  died, nobody outside), rolled on a POSITION HASH so clients agree; buildings collapse at
  5 psi (1.1 km), gutted at 2 psi (2 km), glass at 3.3 km; instant player death is now the
  fireball ONLY. Ground detonation is a real 90 s countdown — derived from this game's own
  sprint speed vs the blast reach, because the old 45 s was less than the time needed to
  run clear, i.e. never an escape.
- Also: County Jail is a real building on its own claimed land (the whole move cost
  `wanted.js` ZERO changes — the anchor seam absorbed it); the airport's fence stood
  INSIDE its own kerb road for 1,190 m and the arrival's first leg (268 m) never existed;
  the speedway's sponsor boards were flipped on BOTH axes and its lot was boxed in by a
  fence nobody measured; E ejected you from planes because every E press ran the ride
  router first; Space never cleared the map waypoint because it was never bound.

## THE 2026-08-01 SESSION — a text box is as wide as its words

OWNER (iPad screenshots, verbatim): "never ever in my game again have a wasted
text box" · "see the fucking redundancy". Standing law for every HUD surface,
current and future — a box may be exactly as wide as its words, and a verb is
said ONCE:

- **THE STRETCHED COPY CELL** — both docked (≥700×550) interaction rails drew
  the copy cell as a stretched 1fr grid track with its gradient painted edge to
  edge, so "Slip 10 to look away" dragged ~170px of empty tint across the
  world. The law is `justify-self: end` (css/interact_touch.css §7 +
  css/mobile.css's docked block): the bar shrink-wraps its words, the vacated
  track is clear glass, and in the city card it is also pointer-transparent
  (the prison rail's button-only tap contract, ported) so a finger aiming the
  camera falls through instead of hitting an invisible verb zone.
- **THE VERB SAID TWICE** — the airliner card printed "BOARD" in a bar beside a
  button reading "BOARD". Both docked renderers (city/interactions.js,
  systems/interact.js incl. its flag-off fallback) drop the copy cell whenever
  it would only repeat the button's own word; `r.bad` rows keep their warning
  tint via `.ibad` on the button itself. THREE layers were stacked on that
  card: bar text + button text + a full-row `.tyes/.tno` gradient slab that
  outweighed the docked transparency reset by one class of specificity —
  same-weight overrides declared later end the slab.
- **THE DISTANCE SAID TWICE** — `#cJob` (top-centre pill) and `#waypointGuide`
  (bottom-centre arrow + distance) both read "1237m" for the SAME destination,
  because mission.start pins the waypoint on the job target. The job line now
  stands down while the guide covers its destination (<40u), exactly the
  speedometer→cluster stand-down rule ("exactly ONE number on screen"), and
  returns when the waypoint is cleared or moved. An EMPTY #cJob also no longer
  renders as a bare pill — a box with no text does not render.
- **THE BOXED NARRATOR** — `TOUCH_HINT_SUBTITLE` (hud.js): on touch, #hint
  ("TASED — you hit the floor!") drops its .panel box and speaks the
  world-subtitle grammar one step above the .pi-subtitle band, instead of a
  boxed cell wedged half under the iPad rail. Desktop keeps the panel.

NOT YET VISUALLY CONFIRMED on a real iPad — the owner judges by playing; the
docked layouts cannot render headless. If a shrunken bar or deduped row looks
wrong in his next screenshot, the geometry above is where it lives.

## THE GATE WAS NOT RUNNING SEVEN OF ITS OWN RATCHETS (measured 2026-07-29)

Run `node tools/math-gate.mjs --seeds 90210` against a CLEAN `HEAD` worktree and
you got `predator - | checkpoints - | beach -`, `venues - | fishing - | ranks -`,
`street - | stunts -`, `power -` and `fxwarm -`. Not "zero". **Blank.** Two
statements in the PASS block string-concatenated an `Object.create(null)` MAP —
`venueStaffAudit().venues` and `rankAudit().orgs` — which raises "Cannot convert
object to primitive value", and **the throw aborted the whole ratchet block from
that point down.** Every audit below the first one asserted NOTHING. The same
line also read `vs.staffed`, a field that has never existed (it is `manned`), and
`rankAudit`'s `emptyRanks`/`verblessRungs` are ARRAYS, not counts, so `empty=` was
printing the array. Both are fixed and the offenders are now NAMED in the output,
because "which rung has no holder" is the entire value of that number.

This is CLAUDE.md's own law turned on the gate itself: **an audit nobody has
executed is not a measurement.** The `propUseAudit` lesson had a sibling nobody
had noticed. THE MEASURED TRUTH on clean `HEAD`, first time these ever ran:

| ratchet | claimed here | **MEASURED** |
|---|---|---|
| `venueStaffAudit().unstaffed` | **pinned 0** | **5** — the pin has been failing silently |
| `fishAudit().refused` | **pinned 0** | **3** — three spots stand on dry land |
| `rankAudit()` | NOT YET PINNED | **7 orgs / 34 rungs / held 18 / verbed 30 / empty 1 / verbless 4** |
| ↳ `emptyRanks` | — | `gang:prospect` |
| ↳ `verblessRungs` | — | `campaign:{volunteer,organizer,operative,boss}` |
| `powerAudit().legacyGuardSites` | baseline 9 | **8** |
| `predatorAudit()` | 0 / 9 | **0 / 9** confirmed |
| `checkpointAudit()` | — | **4/4 manned** |
| `streetAudit()` | NOT YET PINNED | **1575 poles · disc 0 · thru 0 · noCol 0 · junc 259/260 · paintThru 0** |
| `groundMatchAudit().maxErr` | — | **0.34 m, over the gate's own 0.30 limit** |
| `fxwarm` bad materials | — | **8** |
| `roadClearanceAudit().propsInside` | pinned 15 | **16** |
| GOLDEN roads (seed 90210) | 178 | **202**, and the biome set gained `annex` |

**The last four rows are live, pre-existing FAILURES on `main`** — i.e. the
deployed site. They are not this or any recent wave's doing (verified by running
the fixed gate against a clean `HEAD` worktree and diffing). They are the cost of
the "no testing just building" waves: the gate was red and nobody looked. **Do
not re-pin a ratchet upward to make it green.** The two GOLDEN rows are stale
CALIBRATION and should be recalibrated deliberately (`--calibrate`); the other
two are real drift and want a fix.
## THE 2026-07-28 WILDERNESS WAVE — eight builders, one merge

Seven Opus + one Fable builder in parallel, disjoint file territories,
orchestrator merged the seams (index.html tags, worldstate ledger lines,
cross-territory one-liners) and syntax-gated per landing. Shipped without a
gate run (owner's call, again: "no testing just building") — so EVERY ratchet
below is NOT YET PINNED: whoever runs each audit first writes the number in
(do not repeat the `propUseAudit` mistake of pinning a guess).

- **THE ONE TREE GRAMMAR** — `CBZ.treeCrownGeo/treeTrunkGeo` (§2 of
  `world/treeaudit.js`). OWNER: the icosahedron-crown thin-trunk tree "sucks";
  the two-cone tree "looks nice" but "needs more roots... and needs to replace
  the other trees in the game." biome_forest's beloved two-cone was SOLVED
  back into ratios (taper 0.70 / hRatio 0.887 / bite 0.274 — `{tiers:2}`
  reproduces it, `{tiers:3}` the wildnature/snow conifer), and every planter
  (wildnature, biome_forest, biome_snow, continent backcountry, expansion
  islands, props street planters, resources harvest nodes) now draws it, with
  a rooted bole — butt swell + 3-5 root spurs dipping below y=0 — MERGED into
  the trunk geo: zero extra draw calls, and the connection law's seat check
  gets EASIER, never harder. Species variety is tier count/taper/palette now,
  never an icosahedron. Wilderness geometric boulders (2100 icosahedra) are
  dead-drawn off (`WILD_ROCK_SCATTER` false — colour draws preserved so grass
  never re-tints; the DESERT_ROCK_SCATTER precedent); backcountry box-boulders
  and forest dodecahedron rocks became sub-STEP_UP fractured stones via
  `CBZ.makeRock`, colliders removed with them. Flags `TREES_ONE_GRAMMAR` ·
  `TREES_ROOTS` · `WILD_SMALL_ROCKS`. Ratchet: `CBZ.treeGrammarAudit()`.
  THROWABLE ROCKS — deliberately skipped, seam recorded: `combat.js:1294`
  hard-routes EVERY `tag:"throwable"` through `throwGrenade` → `detonate()`,
  so an honest Rock needs a noBoom lob variant + a blunt-impact path first.
- **EVERY KEYBOARD VERB HAS A THUMB** — `CBZ.touchAudit()` (`systems/touch.js`
  / `touch_vehicle.js` / `camera.js`). The B-2 shipped four seams *labelled*
  "the touch layer wires these to pills" with ZERO callers — the bay could not
  open on an iPad and no counter said so. Tanks matched neither touch context
  (`P.driving` set, `P._vehicle` not) — you could board one and never get out.
  New `armor` + `mount` contexts, aux rail, heli lateral-cyclic / wing-rudder
  hold pairs. Third person: pinch-zoom was a NO-OP city-wide (the CAM_TP_V2
  boom never read `zoomTarget`) — touch-only `tpTrim` scales boom+height
  together and stands down during ADS; flick-accel drag (identity while
  scoped), release glide, recenter pills. `militaryvehicles.js` was the LAST
  `camRecenterSuspended` holdout. Ratchet: `touchAudit().uncovered` may only
  go DOWN; `noHook` names dropped seams so a lost diff can't launder as
  covered. Flags `TOUCH_AIRCRAFT_V2` · `TOUCH_TP_CAMERA_V2` and seven more.
- **KINSHIP HAS BODIES** — `city/kinship.js` + spatial pairing in `social.js`.
  OWNER: "family and friends... coded mathematically and not in reality and
  not artistically." The sharpest find: social.js married ped `i` to ped
  `i+1` BY ARRAY SLOT — half the city's couples were strangers hundreds of
  metres apart; pairing/cliques are now nearest-within-55/42 m with the rng
  sequence preserved in draw order AND count. kinship.js steers bodies the
  crowd already runs (companions.js pattern): bonded walkers (leader routes,
  slowest sets pace, adult+child hand-in-hand), greetings between people who
  know each other (`kinshipKnows` = the ONE relation answer — familytree >
  household > social kin > friends > cliqueId, its FIRST reader > same-trade
  hash), grief (kin within 30 m RUN to the body, kneel, then cityScare takes
  them — the hold releases BEFORE scare because scare refuses controlled
  actors), and family.js homecomings (kids orbit, spouse holds conversation
  distance, dinners through `propSeatNpc` — which no family had ever called).
  Yield is absolute: `claimed()` re-tests ~25 conditions every tick. Flags
  `KINSHIP_LIFE/_WALK/_GREET/_GRIEF`. Ratchet: `CBZ.kinshipAudit()` —
  `strandedSpeed` and `strayHolds` are hard zeros.
- **DIALOGUE IS TWO CHOICES** — `city/dialogue.js`. OWNER: "dialogue with two
  choices... there's a third and a fourth choice which are unsaid — punch,
  and walk away. The two-choice thing already exists perfectly with hijacking
  or boarding a plane." Every talkable ped: their LINE + exactly two answers
  in the BOARD/HIJACK card grammar; punch = combat claims them instantly
  (remembered); walking away = they shrug at your back. THE POOL-REUSE RULE:
  wherever the card's gated pool already holds a real option (medic patch-up,
  dealer Score, street tribute), choice A fires THAT option's own onSelect —
  handshakes get re-skinned, economies never re-authored. Missions come from
  people: crew/garrison peds pitch the exact `cityOrders` contract; accepting
  makes a CONTACT who may text/call later (hard caps; strangers never ring;
  persisted via worldstate's add-only `w.cityContacts`). interactions.js
  gains `registerVerbCard`/`hasOption`/`rows.note` — the dualRideRows
  contract opened as a registry. Opener prio map: 72 street-offer / 74 power
  intercept / 80 dialogue / 85+ restrained. `kinshipBefriend` was deliberately
  NOT stubbed — kinship's graph never reads player pairs, and a hook with no
  consumer is a stat fiction; the fallback (`friendOfPlayer` + relShift
  warmth) is the honest integration. Cop-challenge adoption is SKETCHED in
  dialogue.js (ARREST_ARC territory) — one registration when its wave comes.
  Flags `DIALOGUE_TWO_CHOICE/_GIVER_ROUTE/_CONTACTS`. Ratchet:
  `CBZ.dialogueAudit()` — `legacyTalkPaths` (5) may only go DOWN.
- **THE HUNT PAYS IN MEALS** — `wildlife.js` meat rows are `tag:"food"` with
  `heal` SOLVED, not typed: `26·(meatValue/12)^0.5·scale^0.45` clamped 10-55,
  so a future species is edible for free (boar = Pork 27 × yield). The root
  bug was ONE WORD: meat registered `tag:"valuable"`, locking it out of
  cityEat, the hotbar's USABLE_TAGS and the pocket card at once. Eating is a
  1.1-2 s chew with PROGRESSIVE fill so hud's existing shank row IS the
  progress bar — no new HUD (`FOOD_EAT_V2`, `city/hunger.js`). shops.js's
  food branch was a SECOND HUNGER WRITER that swallowed the whole order in
  one frame (buy 3 burgers, carry 0) — now buys stock, eats one at the
  counter through the one path. Grocers sell groceries (exactly 9 food rows —
  the menu slices at 9; a 10th would be a priced row nobody could buy).
  Medkit/Body Armor/Ammo Box were INERT once carried (effects only fired at
  the counter) — `cityUseItem` gives them their verb. Hotbar item tail capped
  at 6 so six meats never push the rifle off the keys. Ratchets:
  `CBZ.foodAudit()` · `CBZ.itemVerbAudit()` (`inert` 0, `sellOnly` only
  DOWN; Lockpick/Crowbar/Burner Phone named there as stat-fiction
  candidates, not silently deleted).
- **EVERY ITEM IS A PHOTOGRAPH OF ITS ASSET** — `city/itemassets.js` +
  `city/itemicons.js`. OWNER: "guns are a tiny actual gun in the icon but all
  other things are retarded... we have so many assets that can be shrunk, and
  if it isn't an asset that can be shrunk why is it a thing that can be an
  icon — make the asset then." A gun icon was NEVER a drawing:
  `weapon_thumbnails.js` photographs `buildActorWeapon` offscreen; everything
  else wore a 12×12 sprite (and gun chips were 42×28 beside square 30×30 —
  two systems even when both are good). `CBZ.itemAsset(name)`: 51 builders —
  guns REUSE buildActorWeapon, chest/briefcase/backpack/melee MOVED out of
  inventory.js byte-identically, 47 authored (rolled tied hides with species
  tint, bone-in cuts, fish/fillet, produce, jewelry, clothing...) — real
  metres, base y=0, long axis along Z (the diagonal is what keeps a rifle
  readable in a square). itemicons.js bakes them under weapon_thumbnails'
  EXACT light rig (copied value for value — that rig is what the owner
  already approved), ortho-framed off projected AABB corners at 1/1.10 fill.
  `makePhysicalDrop` uses the same registry — every non-gun drop in the game
  was a rucksack; a dropped hide is a hide now. Sprites remain ONLY as the
  no-GL/flag-off degrade. Kind classification (`itemKind`) and tint
  (`itemTone`) each live in ONE place; a species added tomorrow is drawn for
  free. Flags `ITEM_ICONS_V2` · `ITEM_ICONS_RENDERED`. Ratchets:
  `CBZ.itemIconAudit()` (`generic` and `assetless` structurally 0;
  `spriteFallback` REPORTED, correct-nonzero where GL is absent) ·
  `CBZ.itemAssetAudit()`.
- **A TAMED ANIMAL IS A COMPANION** — `CBZ.petFollow` in `wildlife_tame.js`.
  OWNER: "they should stick with you... sit in front of you and look at you
  and follow you. I think I already built that logic [for dogs]." He had —
  TWICE, in parallel: this file and dogs.js each ran a private heel. ONE
  brain now (locomotion seam per the predatorHunt pattern; `stayKey` names
  the field each world already writes, so nothing mirrors state). Stand
  still ~2 s → the companion ARCS to your front (tangent-refused no-go ring —
  it can never clip through you), folds into a sit SOLVED from the rig (pitch
  is the inequality `θ ≤ atan(legH·0.85/(span·0.95))`; front feet planted,
  hind pressed 0.4-5.4 cm INTO the ground across dog/boar/horse/elephant/
  rabbit — no species table), and WATCHES you — head pitch is the real
  arctangent (a terrier looks steeply up, a giraffe down), and a seated
  companion turns to watch what you AIM at. Heel is continuous pace matching
  (measured 0 state flips vs the old band-stop's every-few-frames stutter);
  catch-up past 70 m only through `npcTransitionSafe`. dogs.js ADOPTS via a
  `dogMove` seam (its aggro/bite/death untouched). companions.js carried the
  wave's best bug: `disposition()` tested `id === "dog"` but dogs register
  `stray_dog` — the row NEVER matched, every tamed dog was skittish, and
  companions.js drove it AWAY from the exact fight dogs.js drove it INTO.
  The death seam: `wildlifeDeathPhysics` hands a seated pet's bones back via
  `petRelease` BEFORE the ragdoll solver reads the body. Flag
  `PET_AFFECTION`. Ratchet: `CBZ.companionAudit()` — `legacyFollowPaths` 0,
  `adopted` (2) may only go UP.

- **A WOUND IS A LICENCE, AND A CHARGER WHEELS** — `wildlife.js` +
  `systems/predator.js`. OWNER: "wild boars and predators SHOULD be attacking
  ... animals aren't very good at attacking right now." Three measured
  arithmetic faults, not taste: (1) **the follow-through** — `h.struck` fired
  from inside the strike callback and left `rush` that same frame, so
  `creatureFight` never ran again for that actor: `_atkAnim` pinned mid-swing
  forever and EVERY SUBSEQUENT CHARGE DEALT ZERO DAMAGE (boar: 42,255
  stranded swing-frames over 30 harness trials → 0); (2) **six species could
  never catch a sprinting player** (physics.js's speed comment is stale by
  two tunes — READ CONSTANTS, NOT COMMENTS; a moose closed at 0.54 u/s
  against a 4.5 s rush timeout) — the `closeK` ARCH column floors commit
  speed off `predatorQuarrySpeed()`, capped at 1.35× the species' own, and
  `lunge` declares 0 so the shark is byte-identical; (3) **the wheel** —
  every rush exit went to `disengage`, one hit then 12-18 s of nothing; a
  connect now spends a PASS (a miss never buys one), each pass falls ×0.82
  because a turn inside your own length cannot rebuild charging speed, and
  the menace gauge exempts mid-bout wheels while staying player-scoped.
  Defence is a LICENCE on the shared brain, never a parallel aggro flag:
  a wound buys `_defendT` seconds of the identical predatorHunt grammar —
  `cityWildlifeHit` is the ONE grant point (every damage class already
  funnels there); rout below 0.32 hp is an honest bolt; a mother with a calf
  inside 26 u has no threshold and no patience; cornered prey gets one
  nerve-hashed kick — `landWalk` had always returned "did I move" and
  NOBODY HAD EVER READ IT: that boolean is the no-escape-bearing test.
  `predatorEats` splits diet from danger (a bison was stalking whitetail,
  killing and FEEDING at the carcass — horns are not a diet). Hoofed species
  (bighorn/caribou/zebra/giraffe/white stag) all fell through to style
  `'bite'` — a hoof animated as a mouth; gore/ram now leave `bodyBite` tusk
  crescents and the gore anim hooks SIDEWAYS on alternating passes.
  `wildlife_shark.js` PAYS THE predatorKit DEBT this file named (the `meg`
  branch is DELETED — "circles twice as long, holds twice as long" IS the
  kit's power laws; worst divergence the two documented deliberate ones).
  Tamed exemption holds at three levels; bones never written (petFollow owns
  them). Flags `WILDLIFE_FIGHT_BACK` · `WILDLIFE_ATTACK_V2` ·
  `PREDATOR_CLOSE_SPEED` · `PREDATOR_WHEEL` · `PREDATOR_FOLLOW_THROUGH` ·
  `SHARK_KIT`. Ratchets: `predatorAudit` 0 legacy / **11** adopted;
  `CBZ.wildlifeDefenseAudit()` — `legacyAggroPaths` structurally 0.


## THE 2026-08-02 SESSION — sharks get real faces, and the gate tells the truth

- **A SHARK IS A CONTINUOUS HYDRODYNAMIC WEDGE, NOT A BOX WITH A PYRAMID
  GLUED ON** — `wildlife/aquatic.js`. OWNER (with two reference photos):
  "sharks just dont look great, their faces are way too coney, in reality
  sharks are not coney." Codex authored the shared arc-mouth grammar
  (contract v2, arched-underside U-jaw) and the unused hull helpers, then
  hit its spend cap; this session wired all four true sharks (great white,
  hammerhead, bull, megalodon) onto `addSharkHull` — an elliptical-ring
  loft whose LAST RING KEEPS SUBSTANTIAL WIDTH (the broad flattened blunt
  rostrum that was the whole point of the reference), with the
  countershaded belly in the same connected mesh (material groups, no
  second slab). `addSharkFaceDetails` adds the small dark eye, nostrils,
  and five gill slits per side; `gillZStep` follows the hull taper so the
  slits sit proud instead of drowning in the mesh (round-3 pixel finding).
  The mouth tucked UP under the rostrum overhang and the mandible slimmed
  to a seat (round-2 pixel finding: a thick mandible reads as bolted-on
  dentures). Dorsals/tails flattened from 4-side pyramids to blades.
  The hinge/bite/travel contract is unchanged — `swimJaw`, damage sockets,
  and the clench-after-contact attack all consume it as before.
  Verified: `npm run test:shark-mouth` (contract v2 accepted, connected
  components, hinge drift 0, closed rest, tooth-ring contact, reset) and
  `npm run test:aquatic-mount` (live mounted bite + megalodon ship bite →
  sinking handoff) both green; four visual-compare rounds against deployed
  main in `artifacts/visual-comparisons/shark-faces-2026-08-02-*` (final
  10-pair PDF in `-final`).

- **THE GATE NOW STATES THE LAW IT ENFORCES** — `tools/math-gate.mjs`.
  Clean-HEAD attribution run (stash, gate, pop) proved every failure but
  one predated this session's tree. (1) The aircraft radial-bound failure
  INVERTED the design: pillar-rim law is "no invisible wall anywhere"
  (docs/plan/pillar-rim.md:455), and playeraircraft.js deliberately ships
  unbounded flight with the audit kept as a diagnostics surface — the gate
  line now reads "open-by-design" and does not fail. (2) GOLDEN baselines
  re-pinned via the sanctioned `--calibrate` path: the stored goldens
  predated the annex region and the road growth that already ship on
  deployed main. (3) Five long-red checks are DEBT-PINNED at the values
  measured on clean HEAD 2026-08-02 (road props 16 · ground oracle 0.35 m
  — the audit PRINTS 0.34 but toFixed(2) rounds down, the raw value sits
  just above it · venue stations 5 · fishing spots 3 · non-material
  .material 8), each
  labeled in its own failure string with the work-it-DOWN direction. A pin
  at measured reality catches the NEXT regression; a permanently red gate
  catches nothing. Nobody may raise these numbers; lowering one is a wave
  deliverable.
## THE 2026-08-02 SESSION — you wear what you skin

- **THE PELT IS WORN, AND THE HOOD IS THE ANIMAL'S OWN HEAD** —
  `src/city/pelts.js` (`CBZ.peltWear/peltUnwear/peltWorn/peltWearItem/
  peltOnSkin/peltMountOn`). OWNER (with the Eastern-Wind-Studio bear-hood
  photo): "When I kill and skin an animal I should get to wear it like this
  automatically." Kill → skin → the fresh pelt goes straight ON you: the
  species' head as a hood above the face (muzzle over the brow, pitched up
  0.42 rad like the photo), cheek fur flaps, a fur mantle over both shoulders
  and a cord + pewter clasp across the chest. **The hood is a photograph of
  the asset, never a drawing** (the itemicons law applied to clothing): the
  species' own `build(ctx)` model is rebuilt with a per-species seeded rng
  (deterministic — the same buck always wears the same rack; biased low so
  `r() < 0.5` trophy gates INCLUDE the antlers a hood exists to show) and its
  head cluster harvested with `buildGaitRig`'s own shipped discovery (legs =
  taller-than-wide ground-touchers, head = far-forward-and-up) — cloned
  meshes share the cached cmat materials, so a brown-bear hood is
  brown-bear-coloured BY CONSTRUCTION and a species added tomorrow is
  wearable with **no edit and no species table**. Sizing is three clamps, no
  per-species taste: width targets the discovered head box (0.5–0.95), then
  length ≤ 1.15 (a croc stays wearable) and height ≤ 1.45 (a full rack is a
  crown, not a mast). The mantle's fur is the model's dominant (largest-
  volume) coat colour and every dimension rides `CBZ.cityArmorFit`'s
  MEASUREMENT so it sits proud of whatever outfit/vest the rig wears — the
  armour-sits-proud law one layer further out. **WORN, NOT CONSUMED**
  (economy.js's own outfit grammar): wearing needs the hide in your pocket,
  the hide still sells at a fence (the pocket verb hint keeps the price
  visible), and the guard tick strips the mantle the moment the hide leaves
  the pocket — one body, one hide, one worn pelt, no duplication fiction.
  Hood rides `ch.neck` (turns with the head), mantle rides `ch.body`; FP is
  safe because first person hides the whole player group. Three consumers in
  the same change: `skin()` auto-wear (flag `PELT_WEAR_AUTO`), the pocket
  Wear/Take-off toggle (itemicons routes hide rows to `peltWearItem` BEFORE
  the clothing wardrobe), and worldstate rehydrate (pawnshop's one-shot
  stamp/hydrate wrap → the pelt survives reload/respawn; the recolor wrap
  re-fits it on outfit swaps, armor.js pattern). Fish fall out via the same
  fur-is-food name test wildlife.js ships; snakes harvest no head cluster
  and wear mantle-only (legitimately hoodless, reported). Flags `PELT_WEAR`
  (master) · `PELT_WEAR_AUTO`. Ratchet: **`CBZ.peltAudit()`** → `{wearable,
  hoodless, hoodlessIds, worn, mounted}` — NOT YET RUN, shipped without a
  gate pass (owner: "no testing just build"); whoever runs it first writes
  the numbers in (do not pin a guess).


## THE 2026-08-02 NUKE SESSION — the before/after tool got eyes, the nuke got real

Owner directives, verbatim: "use the before after tool on Nukes... Nukes are
like a storyboard of different states... there's also an issue where it kinda
breaks the game, a huge domino effect of explosions... show me the Nuke
improving, not only the visual improvement but also the loading improvement" ·
"It should follow Hiroshima and Nagasaki... I want decent nuclear realism" ·
"it looks too much like rocks... when an RPG blows up it actually looks real
as fuck, but your shit looks geometric." Everything below shipped to main
(8cb9bd5, 545df7f, e5c3f35, 2473fec) and passed the gate after merge
(MATHGATE: ok, 318/180/202, det ok).

- **THE NUKE IS VISIBLE, PERSISTENT AND SMOKE, NOT ROCKS** — four flags in
  nukefx.js, each a one-line revert: `NUKE_FX_BIG_FORMATION` (the 34s cloud
  was 3x smaller than the Trinity/Nagasaki frame record — capY R*5.2 -> R*20,
  capW R*3.6 -> R*11, handoff-youth contract still holds because the curves
  start near zero); `NUKE_FX_FOGPROOF` (scene fog reached ~100% inside 5km and
  ERASED the biggest spectacle in the game from exactly the distances a
  fleeing player watches it — lobes now fog:false); `NUKE_FX_AFTERMATH` (the
  cloud no longer endSequence-hides at t=34s mid-formation: it matures toward
  the researched nukeDims — 5.1km cap, centre 8km — over ~170s, stands as a
  landmark, thins from t=200s, gone at 420s); `NUKE_FX_SOFT_LOBES` (the
  rocks fix: onBeforeCompile on the shared Lambert lobe material injects a
  view-space fresnel rim-dissolve + two octaves of ~450m/1.5km world-space
  value noise — the RPG looks real because NOTHING in it has a polygon
  silhouette, and now neither does the cloud). Stem laws that fell out:
  stations are STRATIFIED (raw-random s.f clustered — half the column empty
  at low tier), lobes span ~2.7 stations (geometric overlap alone pinches:
  probed live at t=90, 327m spacing / 480m spans still read as beads because
  rim fade meets faint-on-faint), per-role rim floors (cap 0.22 / surge 0.45 /
  stem 0.60) via explicit customProgramCacheKey (r128 keys programs on
  onBeforeCompile SOURCE, identical across closures — two floors would have
  silently shared one shader), and the camFar*0.82 stem clamp applies only to
  the legacy impostor tier (in coherent mode it left a VOID under the mature
  cap — the column must reach its own head).
- **THE WAVE IS TIME-BUDGETED** — `NUKE_DRAIN_BUDGET_MS` (impactbus.js,
  default 5): the nuclear drains' per-frame item caps (32 peds / 96 crowd /
  24 cars) bound EFFECT rate but not COST — one crowd kill is gore + ragdoll
  + drops, and the first frame whose shock front reached dense downtown
  applied a full budget of every category at once: measured 392ms in ONE tick
  (tools/probe-nuke-perf.mjs, seed 90210, M-series). The drains now share a
  5ms/frame deadline with rotating category order; nothing is discarded,
  cursors resume next frame. Measured after: worst blast-window tick 99ms.
  Structural+thermal drains restored to the doctrine's EIGHT-hits-per-frame
  law (drift had 16; the thermal drain also marks the ledger so it lives
  under the same law). Known and left: peds.js panic sim sustains
  ~760-830ms/s from s6+ (the city dying — it is the honest cost, and it is
  the next perf target if the owner feels it), and interact.js's scanner
  spikes s1-3 choking on mass corpse loot.
- **BOTH NUKE CONTRACTS WERE RED ON CLEAN HEAD** — stale since the analytic
  field rebuild; the first regex died so their runtime halves NEVER RAN
  (the gate-was-not-running lesson again). Repaired to current truth:
  test-nukefx-phases.mjs (lobe field owns post-flash, new flags pinned,
  storyboard table runs the real two-stage model to t=210), and
  test-nuke-freeze-node.mjs (2psi structural pin DERIVED: the stress world
  holds ~1925 lots inside 2016m and the ledger measures 1923 — the old >4000
  pin described the removed 1psi behaviour; zero polling sweeps asserted —
  the analytic field snapshots rosters once). Both green.
- **THE STORYBOARD LOOP IS THE DELIVERABLE THE OWNER ASKED FOR** —
  tools/visual-presets/nuke-sequence.mjs: ten time-beats of one real
  detonation at the city centroid through the full game path, deterministic
  on both sides (freeze rAF after boot — core/loop.js self-schedules, so the
  stub kills it — then CBZ.stepSim is the only clock; nukefx is pure-dt with
  a seeded LCG). Staging laws: recenter CBZ.skyDome.parent to the tripod
  (the sky rig follows the camera at y=0, dome r=850 — tripods stay under
  ~650m), whitelist #nukeFlash in the HUD hide, teleport + per-tick heal the
  player (WASTED ends the storyboard), setQualityLevel(3) so shots match
  real play, dt=1/20 past t=40 for the minutes-long beats.
  tools/visual-compare.mjs upgrades: async stages + per-preset
  stageTimeoutMs, preset urlParams (pinned seed), --only before|after (half
  cost look iterations), and a Measurements page (stage results carry
  metrics; report shows before/after deltas). tools/probe-nuke-perf.mjs
  attributes per-second sim cost to updater order numbers (u:34=peds,
  u:34.4=impactbus wave, u:8.55=fracture; NEVER pipe its JSON through tail —
  the baseline is in the head). CAVEAT for the next reader: the report's
  metrics rider is machine-noisy when both worlds run in one long Chrome
  session — the isolated probe is the perf evidence; the report is the
  visual evidence.
- The look loop that worked, for the record: edit -> --only after --subjects
  <beat> (one boot, ~3 min) -> Read the PNG and JUDGE -> iterate. Five
  rounds: rocks -> ghost (proved the shader hook worked; a missing \n before
  #ifdef had killed all four lobe materials into invisibility, leaving only
  the white additive glow) -> mottled -> beads diagnosed by live instance
  probe -> connected. The screenshot caught what every green contract
  missed, which is the owner's whole point about giving the blind man eyes.

## THE 2026-08-02 INTERIORS WAVE — five territories: furniture, poses, screens, loot, preset

Five opus builders in parallel (recon first: four sonnet scouts with file:line
evidence), orchestrator briefed with prescribed seam names so the wave composed
without cross-talk (`ch.lying`, `seatRef.kind`, `propBedNpc`, `F.coffee`,
`F.armchair`, `ctx.canvasTexLive` were all named in the briefs before anyone
built). Ratchet numbers measured at the gate run below; adoption counters left
as evidence, not pins, per the propUseAudit lesson.

- **WHY INTERIORS FELT POINTLESS (the owner's question, answered with code).**
  Furnishing was never the missing variable — interior_programs.js had had
  repeated dressing passes (its own headers quote older versions of the same
  complaint). The cause: the interior programs were a pure geometry generator
  with ZERO entries in the interaction registry; "Sleep til morning" in a
  non-owned bed was a documented no-op; ONE ambient robbery per city, shops
  only; clerks were `char.typing` statues; and the doctrine's own gun-room
  grammar was violated by "nothing in this engine has a lockable door yet"
  (occupy.js's admission). The wave shipped the loot/witness layer
  (`INTERIOR_LOOT_V1`), the sleep payoff (`INTERIOR_SLEEP_STAKES`), and the
  posture/sleep poses; LOCKABLE DOORS and OCCUPY-BEYOND-HQS remain the two
  named next capabilities (seams documented in the 2026-08-02 interiors-wave
  builder reports; keycard.js still has no consuming door).
- **The gov-building "glitchy screen" was a coplanar z-fight**: the tally
  board plane sat at exactly the frame's front face z in games/government.js —
  the only screen in the repo that skipped the SCREEN_GAP convention. Fixed
  structurally (real-depth box, map+emissiveMap one mesh, 0.055 m air), pinned
  in the gate via `CBZ.govBoardAudit()` (gap >= 0.02 when built).

## THE 2026-08-03 SESSION — the campaign ships, crafting dies, weather is repaired

Owner directive: "the hitman campaign probably sucks and does too much when
really the game is already built for it — make it good and put it on main;
weather prob sucks; crafting can be deleted; local instancing prob cool but
prob slop as is." Findings and what shipped:

- **THE CONTRACT IS A STORY CARD, NOT A TAKEOVER** — the campaign director
  (`city/campaign.js`, 2k lines) was already well-built: it casts existing
  peds, reuses family.js kidnaps, the vehicles.js npcDriver contract,
  outfits.js disguises, `cityForceArrestSetup`/`cityBust`, seedStream
  determinism, and five endless-contract archetypes. The actual "does too
  much" sin was ACTIVATION: flag-on rewrote the whole title screen to "THE
  CONTRACT", suppressed all ten sandbox origins via a `cityOriginApply`
  early-return, and its `winGame` wrap would hijack standalone Prison Escape
  wins. It is now RUN-SCOPED: `contract` is a real row in the origins
  registry (empty grants/scene — the director owns the beats), the campaign's
  `cityOriginApply` wrap CALLS THROUGH first so the character vault and
  `w.origin`/`originPlayed` stamping work untouched, activation is
  `g.cityOrigin === "contract"` (city) / `g._campaignEscape` (escape mode,
  stamped only by the campaign's own `goToPrison`, cleared at title), and the
  old title hijack moved behind `CAMPAIGN_CANONICAL_TITLE` (default false,
  embed-only). `CITY_HITMAN_CAMPAIGN` default flipped to TRUE as a master
  enable. Eleventh title card added (`.origin-btn-contract`, dark/gold).
  Contract: `node tools/test-campaign-contract.mjs` — inert-by-default,
  card registered, prologue stages on pick, ledger stamps for resume, rooftop
  arrest hands off to a campaign-owned prison chapter, standalone escape
  reads inactive.
- **CRAFTING IS DELETED, NOT DARK** — `systems/craft.js` removed per the
  standing owner mandate ("kill crafting"). Its ONE live organ — the
  mode-aware item store that buildmode placement costs and baseclaim upkeep
  read even with crafting off — moved to `CBZ.econ.itemStore`
  (systems/economy.js); deleting without the move would have made building
  silently free and base upkeep permanently unpayable. `CRAFTING_ENABLED` is
  gone (nothing left to gate). Wood/Stone/Scrap/Hatchet/Pickaxe all stay —
  they are harvest/build/loot items independent of crafting.
- **WEATHER WAS TWO ARITHMETIC BUGS, NOT SLOP** — the driven layer
  (`WEATHER_DRIVE`) already powers four disasters; only the ambient storm is
  dark. The two faults that got it flagged off are fixed: drops seeded on a
  FULL DISC put them centimetres from the eye (sizeAttenuation → giant blob
  glued to screen centre — the owner's "white dots stuck to the HUD"); now an
  ANNULUS (inner edge 2.6) with a 4 u look-direction lead. And `testIndoors`
  hard-excluded escape mode, so it rained in the jail; escape now reads
  indoors, period (the cellblock registers no platforms, so geometry cannot
  answer there). Also: weather drew ~3,200 values off `CBZ.econ.rng` — a
  SHARED stream, the exact order-fragility the determinism law bans — now
  `CBZ.seedStream("weather")`; and the tick early-outs when nothing is
  driving. `DYNAMIC_WEATHER` stays FALSE until the owner auditions the look
  (`?cfg_DYNAMIC_WEATHER=1`).
- **LOCAL INSTANCING: keep dark, promote-ready** — measured −30% draw calls
  across two seeds, demolition-safe by exact test, complementary to batch.js
  (disjoint target sets, mirrored exclusion policies). The ONE gap before
  promoting: farcull hides far buildings behind box proxies but the instanced
  trim pools are frustum-culled only — no distance term — so far trim renders
  over its own proxy. Nobody has eyeballed it. Not slop; left untouched.

## 2026-08-03 — outfits, jewellery, and the stores that sell them (fable orchestrating 3 opus builders + 3 sonnet scouts)

Owner: suits "just off", collar "blue and geometric, not painted — clearly a
bug", improve jewellery/watches and how everything looks ON the player
(including the front, which third person never shows), then the stores.

- **THE COLLAR BUG WAS TWO COLOR SOURCES** — the shoulder-yoke box tinted
  from static `CAT.suit.colors` (navy 0x1c2030) while the jacket texture
  painted from `SUIT_STYLES[style].body`; nothing synced them, so every one
  of the 22 suits wore a navy slab (measured collarD 195 tan / 207 powder /
  335 all-white). Police could not drift — painter and yoke read the same
  value — which is exactly why "police looks great, suits are ass". Fix is
  DERIVED: `CBZ.cityPaintedBodyHex` reads the modal pixel off the painted
  atlas itself, the yoke wears its own painted 64x16 atlas
  (`CLOTH_YOKE_PAINT`), and `cityOutfitYokeAudit().worst` is the ratchet —
  0 after, over every catalog fit and all 22 styles.
- **JEWELLERY V2** (`BLING_V2`) — real watch anatomy (band/case/bezel/dial;
  AP octagon, Patek, RM tonneau for loot pieces), linked chains, ring
  band+stone; repetition merges into cached geometries so a strand stays one
  draw call. Three holes closed: Earrings rendered NOTHING on the player
  while peds wore them as a RING (one classifier now, blingLook-first);
  the diamond grill was authored 0.035 INSIDE the skull; tiara had no look.
  `cityBlingAudit().holes` is the ratchet: 1 → 0. charpanel deleted its
  fourth drifted copy of the tables and mounts from bling's exports.
- **STORES** (`STORE_DRESS_V2`) — real display forms (was a 4-box bust),
  four hanging runs sized by length (garments stopped intersecting), street
  window, fitting alcove out of the clerk's counter spot, section/price
  cards; jewellery cases got velvet risers, mounts that stay when a piece is
  stolen, spot bars, Phong metals. No theft mechanic touched.
- **NEW EYES**: `visual-presets/outfit-gallery.mjs` (live player from FRONT/
  back/collar/chest/wrist/head, collarD + bling counts as metrics) and
  `store-dress.mjs` (both store floors + dress-audit metrics). Staging
  lessons IN the preset comments: a sub-meter game camera during stepSim
  flips first-person and hides the rig (park it at 6 m before settling);
  wearing the cop uniform mid-storyboard gets the player killed when the
  disguise blows (uniforms LAST); teleport once, grounded, holstered.
- **MATHGATE: ok** on the merged tree (318/180/202, det ok, errors
  baseline-only). Shipped 84bdabf..7ca371d.

## THE 2026-08-03 NPC BODY-LANGUAGE WAVE — tells, legible gestures, the npc-gestures storyboard

Owner directive: NPCs "have tons of logic built like dogs in real life — they
just need a way to express their statistics and reactions and needs and wants
physically," mapped and improved with the before/after tool; gang city only,
all three games reconned for later unification; "don't freak out and do too
much — add and make it smarter and realer, not fake."

- **THE "ONE HAND UP" MYSTERY, SOLVED**: it was FOUR different one-arm gestures
  that all read identically from a distance — the 911 phone dial
  (reportState="phone", nothing in the hand, read as a salute), kinWave between
  acquaintances (thrown over a still-turning shoulder), posePoint (the grudge
  witness's "that's the one"), and the cop shoulder-mic. Meaning existed;
  legibility didn't.
- **CITY_GESTURE_LEGIBILITY** (peds.js/kinship.js): a real phone prop
  (shared geo/mat singletons tagged _shared, parented to ch.sockets.rightHand,
  frame-stamp lifecycle so every exit path hides it without knowing it exists)
  for the dial and the film gawk; the snitch half-turns AWAY (+-0.8-1.14 rad
  off roleHash, stable per body) with a breath-clocked glance back; posePoint
  holds facing on the player with a straight arm; the greet wave turns at 0.6
  during the wave window so the face lands before the hand is up
  (waveAimDeg 32 -> 3 in the report).
- **CITY_NPC_TELLS** (city/tells.js, new): internal state made legible as
  posture through the ONE seam — three new rows in CBZ.charPoses (tellWary
  graded by ch._tellK, tellPockets, tellSwagger; arms-only, because body/neck
  channels are overwritten post-pose by animChar) plus a driver at
  onUpdate(36.6) mapping fear -> wary, grudge+proximity+LOS -> foldarms stare,
  bond -> kinWave at the player, wealth/cash -> pockets, aggr -> swagger.
  Stable personality via the roleHash idiom (no Math.random in the file);
  free()/receipt discipline yields to kin beats, seats, attached bodies,
  combat, witnesses; strayPoses pinned at 0 in the gate (a leaked receipt is
  a person no other system can pose again). Counts stay evidence until
  measured across seeds.
- **NEW EYES**: visual-presets/npc-gestures.mjs (+ visual:npc-gestures,
  --keep-going) — 9 subjects staged off the REAL state fields (witnessSev/
  reportState, posePoint, surrender, fear band, grudge, cash=0, aggr), each
  emitting poseApplied/driverApplied so the metrics page shows before 0 ->
  after 1 on phone-prop, wary, stare, pockets, swagger. Every new name is
  guarded so the deployed before side photographs an honest statue.
- **UNIFICATION MAP (recon only, no jail/survival edits)**: all three games
  share makeCharacter/animChar and the poses.js registry; jail guards drive
  speed-only with zero poses (foldarms sits unused despite its own comment
  naming guards), survival bots express urgency as speed only, jail duplicates
  a crude rotation.z topple in npc.js+guards.js instead of the shared
  deathPose, and grapple.js's CBZ.body explicitly excludes jail. Named seams
  for the later wave: poses.js rows + setCharPose calls from guards.js/
  survivorbot.js, deathPose adoption in jail, lockdown.js's hold() not
  matching cellblock.js's bunk sit.
- **MATHGATE: ok** on the merged tree (318/180/202, 400 ticks, det ok, errors
  baseline-only) BEFORE the tells pin; driver liveness probed separately —
  90 sim-seconds of unstaged city: firedTotal 7 (all pockets, 22 broke peds
  citywide), strayPoses 0. Swagger fired 0 in that window and that is a
  GEOGRAPHY fact, not a code fault: aggr is rolled off district means, the
  scan is camera-local (46 u), and a hot ped near spawn is usually armed or
  walking — both correctly refused by free(). The storyboard's driverApplied
  was 0 on all four tells beats for the same class of reason (staged peds
  hash-gated or cadence-missed; the preset's sanctioned fallback took the
  picture). Watch fired.swagger in real play before believing it dead.

## THE 2026-08-03 WALK-IN HOLD WAVE — a room inside a vehicle (resumed after a builder died mid-fix)

OWNER, verbatim: *"a cargo plane where you can open and close the back and even
a tank can drive into the back — but like elevators it must actually have a
back of plane that exists, so other players can be inside the plane like a
room. this opens the door to rocketship logic."*

- **THE BLOCK**: `src/city/vehicle_hold.js` — `CBZ.vehicleHold(rec, spec)`, one
  call, nothing in it says "aircraft". Owns the ROOM (declaration, ramp arc,
  latch) and no surface maths of its own: the floor, the hull walls and the
  walkable ramp slope are ONE `movingPlatform` rig, the bodies go in through
  `npcLife.attach`, the door beats are `aircraft_doors.js`'s (which grew a
  fifth door kind, `"ramp"`, whose door is also a floor). Full adoption
  contract for the semi/van wave in `docs/claude/engine-systems.md`; a fleet
  joins with one `CBZ.vehicleHoldWatch(fn)` line (the `heliFleet` pattern —
  `militaryvehicles.js` is the first, and it registers nothing per vehicle).
- **THE TICK BUG THE DEAD BUILDER WAS MID-FIX ON, FINISHED.** Its note was
  "the load re-assert is running a frame ahead of the flight sim". Half had
  landed (freight re-asserts at **12.7**, after cars 11 / armour 11.6 / flight
  12). The live half was in `platforms_moving.js`: that file latches every
  rig's pose at **9.5** because everything it was ever written for moves before
  it (yachts 9.45, water hulls 9.4, marina 9.3) — and a HOST VEHICLE does not.
  Measured at 95 m/s: **1.58 m of deck slid out from under a standing rider
  every frame.** Fixed where the ordering lives, not with a correction term: a
  new `late: true` rig option moves that rig's pose latch and rider carry to a
  second pass at **12.8**. Absent the flag both passes are byte-identical to
  the single one before it. Three beats now: **9.4** door · **12.7** freight ·
  **12.8** floor + rider.
- **A SOLID BOX BEHIND A CARGO DOOR IS A PLUGGED CARGO DOOR.** The airframe's
  aft upsweep was one solid tapered box whose front face stood across the whole
  3 m aperture — the first plate photographed the "open back" as a grey wall
  two metres away. It is now the same silhouette as a crown + two flanks around
  an open tunnel (the fuselage's own four-slabs-around-a-room grammar), the
  flanks HINGED at the aperture and rotated inboard because a taperBox tapers
  about its own centre. The stowed ramp lives in that tunnel, which is why the
  ramp shortened 4.2 → 3.7 m (slope 18.3° → **20.9°**, still half a tank's
  gradeability): at 4.2 m the stowed toe came out through the crown.
- **THE COCKPIT EYE**: the lifter had neither a pilot silhouette nor a tagged
  canopy, so `cockpit.js` fell to its bounding-box guess and put the design eye
  **~10 m above** a 13 m-tall T-tail — a fresh `cockpitSightAudit().eyeGuessed`,
  which may only go DOWN. Fixed the way that audit's own header says: two real
  crew seats modelled and published on `userData.cabin.seats`, and the window
  band opened 0.70 → 1.40 m so the eye that falls out of them is behind glass.
- **MEASURED, in-game, seed 90210** (`CBZ.holdAudit()` on the live world):
  holds 1 · rigBacked 1 · **orphaned 0** · ramp arcs real (3.0 s) · ramp slope
  sampled through `CBZ.mpGroundAt` = **20.9°** · deck 1.35 m · tank driven up
  by the ordinary ground sim and chained: **vehiclesLatched 1** · duffels
  dropped in the bay (they fall to the apron, because `inventory.js` rests a
  bag with `CBZ.floorAt` = terrain, and the hold's sweep lifts them back onto
  the steel): **cargoLatched 2** · **actorsAboard 3** · airborne at **888 m**
  with all of it still strapped, `carriedFrames` 1186 and **orphaned still 0**.
  Ratchet gated in `tools/math-gate.mjs`: `orphaned` PINNED AT 0 and
  `holds - rigBacked` PINNED AT 0 (a declared hold with no rig is a room you
  fall through); the rest print beside them so a "fix" that stops declaring
  holds cannot pass.
- **NEW EYES**: `tools/visual-presets/cargo-holds.mjs` — 7 plates from ONE live
  world per side (ramp shut · ramp down · standing inside · tank driven aboard
  · duffels chained · crew aboard · airborne with the lot). The deployed side
  has no cargo airframe at all, so it photographs the same patch of apron
  framed off the heavy bomber both builds share and says so. Two art-direction
  faults it caught that no probe would have: the plugged aperture above, and
  the fact that **the first-person viewmodel is parented to the camera** — a
  hand-posed camera puts the player's own forearm and a `depthTest:false`
  muzzle sprite across the corner of every interior plate.
- **FLAGS**: `VEHICLE_HOLD_V1` (all of it — every hold goes inert and the
  aeroplanes fly with an empty back) · `VEHICLE_HOLD_AUTOLATCH` (the sweep
  only). Both defaulted in-file.
