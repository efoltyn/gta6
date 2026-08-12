# Session and wave reports (dated evidence, newest last)

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02).
> These are dated session narratives and measured ratchets — historical evidence, not timeless law.

## 2026-08-05 — THE ISLAND HAD NO WATER (and so it had no swimmer)

Owner: *"When there's a tsunami, the swimming in the disaster survival game is
horrible because it's not the same swimming that was hard bought and built in
Gang City."* Then, decisively: *"You can walk on top of the water."*

The wiring was not the problem and had not been for a wave — `SURV_SHARED_SWIM`
un-gated `city/swim.js` for survival, and `systems/disasters.js` deleted its
private buoyancy/stamina-as-air solve and pinned `privateSwim: 0`. **The
precondition was the problem, and it had never once been true.**
`world/disaster_arena.js`'s `groundHeightAt` returned `h` — 0 everywhere outside
four hill cones, out to infinity — and `modes/survival.js` wires `CBZ.floorAt`
straight to it. Mean sea is −0.8. **Measured before the fix** (survival, seed
90210, 300 m offshore, 300 ticks):

    playerPos [300, 0, 600]   grounded true   seaY -0.762  feetAboveSea +0.762
    _swim false   charSwimming false   submergence 0   breath 1.0
    ground = 0 at 400 m, 1000 m, 5000 m

The player stood 0.76 m **above** the sea, grounded, as far as the map goes.
`survWaterAt` was false, so `waterAt()` was false, so the swimmer was never
entered: `swimAudit()` reported the whole Gang City model loaded and idle
(`sinkRate 0.85, breathSec 28, sinkOn true, swimming false`). The only water on
the island was the ~30 s the tsunami surge stood over the town ground — which is
exactly the window the owner was describing as horrible.

**After** (same probe, same spot): `_swim true · charSwimming true ·
citySwimming true · submergence 1`, feet 32.9 m under the surface.

- **THE ISLAND GETS A BOTTOM** — `SURV_SEABED` (`disaster_arena.js`). Six lines,
  and the model is the city's, not a new one: `city/swim.js`'s `cityBedDepthAt`
  synthesises the coastal shelf analytically (signed shore distance × slope,
  capped). The city needs `waterfield.js` for that distance because a continent's
  coast is an arbitrary curve; this island's coast is a CIRCLE, so it is one
  `Math.hypot`. Slope 0.34 (~1:3), deliberately gentler than the city's 1.10 —
  that number exists because the city's shore field also describes vertical
  harbour seawalls, a constraint this all-beach island does not have; honouring
  it would give a 1.2 m wade band, i.e. a cliff with sand painted on it.
  The drawn shelf is DISPLACED TO THE SAME FIELD (`RingGeometry`, 96×28, every
  vertex through `seabedAt`) so the bottom you see is the bottom you stop at.
- **ONE WATER ORACLE, BOTH WORLDS** — `world/water_survival.js`, new,
  `SURV_SHARED_WATER_FX`. The four water-presentation modules carried private
  `g.mode === "city"` gates not because their effects were city-specific but
  because `CBZ.cityWaterAt` / `citySeaHeightAt` only ANSWERED for the city. One
  wrap, four one-line gate swaps to `CBZ.waterModeOn()`, and the island gets the
  underwater colour grade, caustics, god rays, audio muffle, swim wash, splash
  rings and floating bodies it never had. **`systems/camera.js` was fixed with
  zero edits**: its `waterCamFloor` (CAM_WATER_FLOOR) reads the oracle and is not
  mode-gated, so on the island the third-person boom kept its "absolute 0.6
  pavement" floor and stayed in the air while the swimmer went under — the exact
  bug its own note describes having fixed for the city.
- **THE BED QUESTION IS FLAT, THE SURFACE QUESTION IS WAVY** —
  `CBZ.survFloodDepthMeanAt`. The island read its depth off the live crest, so
  during a tsunami (waveAmp 1.38 / chop 1.72 flooding, 1.55 / 2.15 sweeping) the
  depth at a fixed point swung by metres at wave frequency, and swim.js's
  hysteresis (in at 1.35 m, out at 1.05 m) turned that into several
  enterWater/exitWater round-trips a second — each one a splash, an sfx, a shake
  and a velocity reset. The town crosses that band twice per event. The city
  never had this because its shelf is built from a STATIC shore distance.
  `systems/weather.js` wraps the new twin alongside its sibling so a flash flood
  still reaches the swimmer.
- Ratchet: **`CBZ.waterSharedAudit().cityGated` pinned at 0** in the math gate,
  plus hard fails if the oracle shim never installs (its publishers span three
  script tags, so a reorder that silently skipped it is the real failure mode).

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

## THE 2026-08-03 RDR2 CAMERA + WEAPON-HOLDS WAVE (fable orchestrating 2 opus builders, each running its own before/after loop)

- **THE CAMERA WAS CANCELLING ITSELF**: the TP look target moved with
  `+sin(pitch)·LEAD` while the boom orbits `+sin(pitch)·DIST` — near-equal, so
  the net view gain was **~0.028** and asking for 45.8° up delivered **+27.29°
  DOWN** (measured on the deployed build via the preset's geometry metrics).
  The in-file comment claiming "pitches ~1:1" sat exactly on the inversion
  boundary. Fix (`CAM_RDR2_ORBIT`, default ON): pure orbit — pitch clamps the
  ARM against the floor, not `dy`; per-tier `frameTilt` solved from each
  tier's own resting constants so every tier frames byte-identical at rest.
  Up-range now 78° (`VIEW_UP_MAX 1.36`); plates: sky 0% → **100%**, character
  below-axis 4.7/5.1/6.0° across the whole sweep (was 4.7/−65/−88).
- **ROOM-AWARE BOOM** (`CAM_ROOM_BOOM`, default ON, city-on-foot only):
  5 swept-AABB probes at 12 Hz sense enclosure; boom damps 4.35 m ↔ 1.5 m
  over-shoulder (τ 0.30 s), pivot drops to the shoulder indoors. Doorway plate
  caught mid-blend at 2.99 m / enclosure 0.40 — eases, never snaps.
  `CBZ.camAudit()` exported for the gate.
- **ONE ENVELOPE, FIVE WRITERS**: `CBZ.camPitchRange()` (legacy `[-1.0,0.9]`
  while `fps.active`) adopted at gamepad.js, three fpsmode clamp sites, and
  touch.js:741 (aim magnetism — missed by the census comment, now listed).
  `grep` proves zero hand-typed copies of the envelope remain in `src/`.
- **PRONE GUNS WERE 0.45 m UNDERGROUND**: prone shoulder pitches `-1.32/-1.40`
  hang both arms straight down through the deck, and holsterprops' direction-
  only solve could then only point the barrel at the sky (measured 80°).
  Fix: pose (`CHAR_PRONE_GUN_POSE`) + `gunGroundRest` (`CHAR_GUN_GROUND_REST`)
  — a POSITION solve on the socket, run before `beginCharacterHipFrame`,
  keyed by `userData.weaponId` not `visible`, target `prevLift + need` (raw
  `need` is a feedback loop converging on half). Ground sampled under the GUN,
  so a 34% slope plates level. Sunk 79.9/85.8/69.9/53.7 cm → **0** across
  LMG/sniper/carbine/slope. `CBZ.charGunRestAudit().residual` is the gate
  number (0.009 m measured — pose-transition frames only).
- **BIPOD IS A CLASS, PRONE IS DEPLOYED** (`WEAPON_BIPOD_PRONE`): `bipodActive`
  keys on `w.bipod` (lmg/sniper/bazooka carry `hold:{heavy,support}` in
  weapon-data now), prone counts as deployed — support 0.45 → 0.34, cone
  ×0.32, and the only case `gunGroundRest` may settle DOWN. Heavy carry
  (`CHAR_HEAVY_CARRY`): support hand cradles the receiver, weight low.
- **NEW EYES**: `tools/visual-presets/camera-rdr2.mjs` (6 subjects incl. a
  bit-exact return-from-sky hysteresis check) and `weapon-holds.mjs`
  (7 subjects incl. the 34% grade). Builders ran their own loops per the
  2026-08-03 division; orchestrator ran ONE math gate on the merged state —
  green (90210:318/180/204, det ok, errors baseline-only) — on a machine at
  load 100+ under a parallel session's fleet (detached nohup + log polling;
  harness-background gate runs get killed).
- **DEBT LEFT NAMED**: crouch low-ready still poses the gun ~0.39 m under
  before the solve rescues it (carryPose isn't stance-aware; the pose is
  another session's screenshot-tuned work). holsterprops' `MUZZLE_CLEAR` is a
  bare 0.05 with no belly-depth term; `playerProneSteady` still keys on
  `w.key === "lmg"`; death.js/weather.js/camera.js now hold THREE copies of
  the "under a roof" probe — promotion candidate with real consumers.

## THE 2026-08-03 PERF WAVE — measured bottlenecks, no visual cost (fable orchestrating 4 opus builders + 2 sonnet recons)

**Mandate:** "make it run faster without making it less HD, no spawn-closer cheats; find the bottlenecks." Everything below is flag-gated, visual-neutral, and engine-wide (city/escape/arena share the loop).

**Measured (paired 300-tick perfab probes, seed 90210, calm then nuke-stress in one boot):**
- Calm sim: **79.5 → 25.3 ms/tick (−68%)**. The dominant edge was NOT in any prior ledger: `clothes.js buildSet` painted its outfit atlas on an accelerated canvas, then `modalHex` pixel-read it — every `getImageData` = full GPU pipeline flush, **62.7 ms/tick (63% of frame)** during crowd-promotion prewarm bursts (CDP caller-attributed profile). Fix: `getContext("2d", {willReadFrequently:true})` at the buildSet atlas only. u:23.7's scary 51 ms/tick was this, not crowd sim.
- `PED_SCAN_GRID` (peds.js+interact.js): peds.js rebuilt a whole-crowd spatial grid every frame and almost nothing used it. Corpse-loot scan (u:38, was O(peds×corpses)/frame) → event-kept `lootableCorpses` list; gunpoint sweep/clear, groupReact, gang-fear, attackerOf, nearestActor → grid/candidate lists; `cityPanic`/`cityTagWitnesses` stay linear ON PURPOSE (seeded-rng visit order + 289-bucket radii). Audit: `CBZ.pedScanAudit()` — linear ped-visits fell 3.29M → 0.32M per 600 ticks (−90%).
- `WAVE_DRAIN_BUDGET_MS=5` (impactbus): ordinary-explosion ring waves now share the nuke path's ms-budget with lossless resume (deferral ≡ slow frame arithmetically; who-dies is position-hashed). Win is worst-tick, not average — averages stay flat by design. WAVE_MAX=2 bounds the old blowup.
- `OCCUPY_BATCH` (occupy.js): mid-play furnished interiors (gang HQ/power takeovers) merge per-building-per-floor under `b.group` (demolition/farcull semantics inherit), own ledger, batch.js groupRanges untouched, colliders/emissive strips spared via refSet. Live audit after one 10-min sim: **8 buildings, 2,523 draw calls reclaimed**. `CBZ.occupyBatchAudit().reclaimed` is the ratchet number — pin it (up-only) when math-gate.mjs is free (another wave holds it).
- `CCTV_FEED_SCOPED` (cctv.js): feeds rendered the ENTIRE scene into 256×144 (the waterfx-mirror disease). Now far-plane = per-tier cityCullRadius + conservative union-sphere subtree hiding (try/finally restore; can't change a monitor pixel — every skipped mesh was individually frustum-rejected anyway). Layers masks proven useless in r128 (projectObject recurses children outside the layers test). Feeds are pixels only — no detection code reads them (verified repo-wide).
- lightpin.js: the every-300-frames full 150k-object `scene.traverse` (light re-registration) is gone — one hook on `Object3D.prototype.add` (the single funnel; vendored-source proof incl. clone()/attach()) catches every light path the ctor Proxy misses.
- hud.js `#cCross` querySelector+display write and turf/homeLine clears latched; compass transform write guarded. All followed the file's own signature-guard pattern.
- `LOCAL_INSTANCING` **default ON** (config.js:555 — the localinst.js null-check is dead code when config.js declares first; both now true). Evidence: ROUND 3b −30% draw calls (two seeds) + fresh pixel-parity pass (artifacts/visual-comparisons/localinst-parity2) where the ONLY deltas (truss lightening, gun barrel) reproduced in an OFF-vs-OFF control (localinst-control) = boot noise (day-clock/weapon staging), not the flag.

**Gate:** MATHGATE ok on the merged state (90210:318/180/204 | det ok | errors baseline-only) with the OTHER session's boarding/vehicle wave co-resident in the tree. peds.js/interact.js left uncommitted (interleaved with that wave) — no cross-file deps, ships with whoever commits next.

**Deep-review honesty:** u:38 under 457 corpses is ~5 ms/tick EITHER WAY — the remaining cost is the loot-ITEM scan, not the corpse scan; named follow-up. childsafe.js `isProtectedActor` costs ~2 ms/tick and is deliberately untouched (safety layer; not worth risk). CCTV feed still pays r128's unconditional full-scene updateMatrixWorld inside render() — `scene.autoUpdate=false` around the feed is a researched-but-unshipped follow-up (one-frame-stale-matrix flash risk wants its own flag). Probe tools: attribute.mjs + probe.mjs now honor CBZ_CHROME/darwin and CBZ_URL_EXTRA (the only way to A/B one-shot build passes).

## THE 2026-08-03 SCENERY WAVE — mountains, water, trees vs the owner's Alaska photos (fable orchestrating 3 opus builders)

**Mandate:** owner posted four coastal-Alaska reference photos — "use the before/after tool and make mountains and water and trees each look better, each should get a subagent." Each builder ran its own visual-compare loop against deployed main (== origin HEAD at launch); orchestrator staged territories, checked the seams and ran one final gate on the committed tree.

- **MOUNTAINS** (`world/mountain_detail.js`, `world/terrain_overhaul.js`, `city/biome_snow.js`): snow now knows terrain SHAPE — new `CBZ.mtnConcavity` feeds `mtnSnowCover` (gully/couloir fill, rock spines through summit fields, two-octave patch noise that moves the 50% point AND steepens the gain); `mtnStrataTint` grows `vegHold` so green holds steep ground below the treeline. New `CBZ.terrainAerial` = kilometre-scale desaturate-lift toward live-fog-colour × dayness (the depth-layering term fog can't provide), gated above `minY` so the seabed is untouched. Mercy snowline 46→96 m on a 560 m range; three-stop base (forest→meadow→MINERAL above treeline). Measured `snowGullyContrast` 0 → 0.317 while `snowCoverMean` FELL 0.570 → 0.469 (the gain is structure, not more white). Flags `MOUNT_SNOW_GULLIES` · `MOUNT_VEG_SLOPE_HOLD` · `TERRAIN_AERIAL_V1`. Preset `mountain-look.mjs` (5 subjects, framings found from the game's own height oracles).
- **WATER** (`world/water_spec.js`, `city/world.js`, `world/waterfx.js`): the plastic-white-sheet diagnosis and the shared-function cure are ledgered in engine-systems.md ("THE SEA'S SURFACE LOOK IS ONE SET OF FUNCTIONS"). tealIndex −8..−16 → −1..0 across four seascape framings, luminance 175→92, saturation ~3×, eye-height rippleContrast ×5; marine-life waterlines within 0.11 m (f25678b column law intact), shallow-sand read (2a87e5a) intact. Flag `WATER_SURFACE_LOOK`. Preset: `marine-surface.mjs` + 4 seascape subjects with framebuffer metrics.
- **TREES** (`world/forestlook.js` NEW — Block Law #4 entry in engine-systems.md, `world/vegetation.js`, `city/continent.js`, `city/biome_forest.js`): one green ramp / species mask / canopy-closure law for every wood. Backcountry 10,083 → 46,249 stems (+57,694 trunkless roof crowns, +3,198 krummholz) built as 1.6 km chunks with a throttled distance test (r128 IM culling is all-or-nothing per geometry sphere; ~70% of instances never reach a vertex shader). Canopy cover in the five preset frames: 2.4→16.2%, 4.7→29.4%, 0.9→13.7%, 59.3→63.3%, 5.0→36.3% for +60–110 draw calls at ground level. Ratchets in math-gate: `forestLookAudit().legacy` pinned 0, backcountry ≥ 20k stems. Flags `FOREST_LOOK` · `FOREST_SPECIES_MIX` · `FOREST_CANOPY_CARPET` · `FOREST_ALPINE_GRADIENT`. Preset `forest-look.mjs`.

**Gate:** each builder green independently; orchestrator's final gate ran on the exact committed tree (temp worktree, boarding wave co-resident but excluded from the commit).

**DEBT LEFT NAMED (cross-territory, next wave's menu):** `biome_snow.js` still hand-scatters 130 pines and has no treeline gradient — the subalpine wood into alpine meadow is one `closure`/`storey` call away and is the reference's best shot. Forest floor under closed canopy is still the terrain plate's pale sage (wants a dark duff tone — terrain material). Snow-biome `registerBiomeBlend` catchments still near-white around now-green mountain feet. Seabed albedo in the 0–20 m band + `city/world.js` 22 m shore-channel saturation cap the above-water turquoise band. Clouds hugging ridgelines = sky/weather territory. `TERRAIN_DARK_RANGE` stays off (owner order): green-out-of-the-sea is GEOGRAPHY (nearest open water to Mercy summit 2.7 km), not shading.

## THE 2026-08-03 JAIL ONE-BAR WAVE — three inventory surfaces become one (solo)

**Mandate (owner):** "in jail game there is tons of different inventory shown on HUD… unite all these inventory into one, and clean the hud up." The three surfaces: the 9-slot item hotbar (systems/inventory.js — where a warden-loot "Gun" proxy shows exactly one gun), fpsmode's floating #weaponStrip chip row bottom-right (every gun), and the #keycard chip top-right.

- **Flag `JAIL_HUD_UNIFIED`** (default true, declared in systems/inventory.js — the owning file). The move is a **DOCK, not a fourth renderer**: fpsmode keeps drawing #weaponStrip through `CBZ.weaponSlotsHTML` (`weaponStripAudit().renderers` stays pinned at 1); the bag reparents the element as its leftmost cells each always-tick, and css/inventory.css (off `body.jail-hud-unified` + the `#hotbar #weaponStrip` docked position) sheds the floating-panel skin and re-cuts chips to the bag's 50px islot cell. Survival never docks (mode-survival hides the hotbar, the strip must keep floating); city hides both (its own #cSlots bar).
- **One keymap**: digits 1..N equip the docked guns (they carry the printed numbers — dispatched via new `CBZ.fpsSelectWeaponId(id)`, fpsmode.js, which owns the weaponInventory-order ↔ availableIndices-order mapping); remaining digits select item slots. Chip click/tap equips too. **One cursor**: while a gun chip is held, the item cells drop their orange `.sel` (two orange boxes read as two selections); the armed-bit rides the existing held-weapon repaint signature because `heldWeaponId()`'s empty-bag fallback answers "sidearm" on both sides of a first-sidearm pickup.
- **The keycard is a bag item**: interactions.js pickup grants a real `"Keycard"` item (ICON row existed since the icon wave); the chip is css-hidden but its `.have` class still toggles, so flag-off is byte-identical. `game.hasKey` stays the door/AI truth — the item is display, never a second key check.
- **Measured** (isolated probe world, city boot → `setMode("escape")` → live run): `CBZ.jailHudAudit()` = `{docked:true, stripCells:2==guns:2, keycardChipHidden:true, keycardItem:true==hasKey:true}`; select-by-id flipped held smg→shotgun with exactly 1 held cell; keycard label present in a bar cell; flag-off LIVE re-floated the strip (`position:absolute`) and re-showed the chip. Visual: jail-scene preset `hud-idle` + `hud-arsenal` after-shots (artifacts/visual-comparisons/jail-scene-2026-08-04T02-47-24-275Z) — three docked gun chips + nine item cells as one bar, top-right reduced to timer+cigs. MATHGATE ok (90210:318/180/204 | det ok | errors baseline-only, boarding wave co-resident).
- **Ratchet:** `CBZ.jailHudAudit()` — in a unified escape run `docked` must be true, `stripCells` must equal `guns` whenever armed, and `keycardItem === hasKey` from pickup on. Renderer count still pinned at 1 via `weaponStripAudit()`.
- **Known edges (pre-existing, named not fixed):** live city→escape `setMode` switching leaves a broken searchlight rig spamming `searchlight.js:79` intensity errors — title-path escape boots are clean; out of this wave's territory. `#ammo` still floats alone at right:22px/bottom:210px — candidate to dock beside the bar in a future pass.
## THE 2026-08-04 SESSION — the modes wave: six territories in one parallel push

Owner directive, compressed: massively deepen the racer; the two hitman
things are confusing — make them ONE and better; a PRESIDENT mode (sand-city
terror orgs, a buildable wall, falls to king/dictator/prisoner) built off the
core engine while dogfooding it; a BOAT CAPTAIN mode; a GUN GAME mode with a
map choice (jail / natural disaster / others); and the watch dial belongs on
TOP of the left wrist. All considering the WHY (keycard→gun-room grammar),
building more than testing. Six fenced builders ran concurrently in one tree;
the orchestrator stubbed the index.html seams first, gated ONCE on the merged
state (MATHGATE ok, seeds + determinism; CONTRACT ok after updating the
tool's stage B for the merged opening), probed every new audit before pinning
it, and committed by territory.

- **WATCH (bling.js)**: every `at:"wrist"` part now rolls s·90° about the
  forearm's long axis at the ONE mount seam — `(x,y,z) → (s·z, y, −s·x)`,
  `ry += s·π/2`, s read off the rig's shoulder x (+1 left / −1 right). Dial
  lands dorsal, 12 o'clock proximal for free, bracelets invariant, both
  factories + all three mount sites share `placePart` so they cannot drift.
- **ONE HITMAN (`city/hitman.js` NEW · campaign.js · activities.js ·
  origins.js)**: surviving id `contract`, card reads "The Hitman";
  `ORIGIN_ALIASES` + vault migration keep old saves; the campaign opens in
  the motel room (PHASE.MOTEL, one world-bound name, quiet/loud priced, the
  old rooftop is now THE HANDOFF that is the trap) and the AXES `quiet`
  suppressor bug (dead `pistol` key) is fixed. activities' parallel street
  pipe is DELETED — two thin doors call `CBZ.hitmanStart()`; marks are bound,
  never spawned, on a 3-tier ladder (street role-holder → power.js principal
  → the officeholder via contracts' own `_official` binder). The motel annex
  is the hitman's gun room: wall-of-marks live board, locked gear case with
  the next tier's tool visible and priced in rep. Flags HITMAN_ONE_CARD /
  _PIPE / _BOARD. `CBZ.hitmanAudit()` GATE-PINNED: cards=1,
  legacyStreetHitmanSites=0, tiers>=3. test-campaign-contract.mjs stage B now
  drives motel→kill→handoff→arrest; stages A/C unchanged.
- **RACE LADDER (`city/racecareer.js` NEW · racing.js · island_speedway.js ·
  racedrivers.js)**: Diamond Racing League via factions.declare — five rungs,
  every rung a verb (race/paddock/pitbay+crew/pinkslip/champgarage),
  promotion DERIVED from the worldstate race ledger (no parallel career
  store). Three doors that refuse you by name: paddock gate + steward,
  BAY 12's RESERVED roller door, and the glass-fronted CHAMPION'S GARAGE
  holding the one-per-world Aurum GT-1 (visible from the racing line day
  one; minted as a real owned car only at APEX). Pink slips transfer the
  rival's ACTUAL liveried car both ways; street races run on real roads
  (roadPick + cityNav routes, checkpoints sampled from the driven route,
  $200 antes through the one wallet, cops file at exactly 1★); the pit crew
  are killable staffed bodies you ORDER (service / three modshop tune
  stages / league livery); trophies are physical cups minted from the
  ledger; the reigning champion walks as a power.js principal. Flags
  RACE_LADDER/_PINKSLIP/_CREW/_TROPHIES/RACE_STREET. `CBZ.raceAudit()`
  GATE-PINNED: verblessRungs=0, placesBuilt>=3.
- **THE PRESIDENT (`city/presidency.js` NEW · statecraft/regimes/crown/
  candidacy/militia/construction/civic/officialdom/games-government seams)**:
  origin `president` swears in through candidacy's new `swearIn()` — the
  exact bookkeeping elections.js performs on a won ballot, so the seat stays
  ordinary (salary, incumbent defense, succession, assassination board) and
  winnable by election. The SITUATION ROOM is a collider-doored room only
  the head of state opens: 9 button pads, each an existing system with state
  read back — ADDRESS / EMERGENCY (regimes' ladder) / CRACKDOWN (militia's
  new rankKnows-guarded `orderCrackdown`) / THE WALL / BUREAU raids /
  PARDON / ONE STATE + THE MARKET (`regimeDeclareDoctrine` — the fascism/
  communism stat-fiction gates now have a reachable PRODUCER) / THE CROWN
  (pad exists only under dictatorship → crown.js's new gated `selfCrown`).
  Sons of the Dune: one factions org homed in the Saltlands (9 ledger
  identities, occupy.js safehouses, attacks staged through aigoals' rampage
  + panic + killfeed; kill or arrest every Bomber/Emir and attacks STOP);
  terror feeds emergencyPowers. `CBZ.stateWall` (construction.js): 12 m
  collider segments rise over days out of rec.treasury, road gaps become
  manned border posts (third `_post` consumer), coverage() starves the
  cell's nightly resupply, three wrapped blasts breach it, crews repair.
  Falls: regimes ladder → DICTATOR; selfCrown → KING; impeachment/coup →
  marshals → the real jail transport → PRISONER. Political title ladder
  migrated 8 files → 3 (officials.js owns; contracts.js + elections.js
  named as the remaining debt). Flags PRESIDENCY_V1/_SITROOM/_TERROR/
  _RAIDS/_FALLS, STATE_WALL_V1. `CBZ.presidencyAudit()` GATE-PINNED:
  buttonsMoveless=0, ladderCopies<=3, buttons>=9 when built. KNOWN SOFT
  EDGE: the terror roster mints on the first sim day, not at boot (audit
  reads terrorMembers=0 until then); govcomplex's mansion seat-actor
  re-stamping `_sid` to a player holder predates this wave.
- **THE CAPTAIN (`city/captain.js` NEW · piracy.js seams)**: origin spawns
  you at the helm of a real afloat trawler (yachts fleet adopted, boatyard
  delivery fallback) through the ONE vehicle-enter path — marine helm owns
  every driven frame, ownership is a boatyard-shaped garage record. Crew
  are citystaff bodies on seacrew's own shipco ladder; orders are
  interactions ON the crew: CAST LINES (real fishing items), TAKE THE HELM
  (mate holds course via piracy's marineAutopilot while you walk your own
  moving deck), ARM UP (the loyalty+weapons atom afloat). Voyages through
  mission stages, world-supplied: charters (a real sim passenger boards,
  sits, disembarks), cargo (physical crates into a `vehicleHold` walk-in
  cargo deck that latches and rides the hull), fishing, salvage bound only
  to already-derelict hulls. Piracy both ways: `pirateProvoke` pulls raids
  onto a loaded manifest through piracy's own scheduler (menace law
  intact); your own black-flag raids pay only in what you take. Gun-room
  instances: the broker's prize hull behind a locked walkable fence, the
  harbourmaster's premium board readable by anyone and openable only by a
  captain; the wheelhouse chart table IS the voyage menu. Flags CAPTAIN_V1
  + _ORIGIN/_ORDERS/_VOYAGES/_HOLD/_PIRATES/_YARD. `CBZ.captainAudit()`
  GATE-PINNED: ordersLive>=3, boatLadderRungs>=4.
- **GUN GAME (`modes/gungame.js` rebuilt · systems/gungamehud.js NEW ·
  state.js plumbing)**: fourth title mode; 9-rung ladder (sidearm → … →
  deagle → BARE FISTS, final rung always one kill), full heal per rung.
  Maps are BORROWED, never authored: the jail (prisonRoot, cast group-
  hidden and restored, spawn pool harvested from where the cast stands)
  and the disaster island through survival's OWN build() so `surv.built`
  stays the one truth; the MAPS seam documents how a future map joins.
  Bots register into CBZ.npcs (fpsmode's own scan makes them shootable
  with zero fpsmode edits) + CBZ.bots (shared body physics); fire drives
  actorweapons + clearLineOfFire + tracer; every death through ONE funnel
  and the killfeed (an `aiKill` wrap intercepts only `_ggBot` victims so
  prison side effects never run). state.js: gungame joins the arena result
  cards, world-root visibility per chosen map, floorAt chain wrapper,
  clean exit restores everything. Flags GUNGAME_V1/_BOTS/_KILLS_PER_RUNG/
  _RESPAWN_SEC/_LADDER. `CBZ.gungameAudit()` GATE-PINNED: maps>=2,
  rungs>=5. Cosmetic residue documented in-file: Tab rankings + M map show
  prison furniture in-mode; killstreak popups run by design.
- **GATE**: MATHGATE ok (90210: 318/180/204, 400 ticks, det ok, errors
  baseline-only) BEFORE the new pins; all five new audits probed live
  (values matched builder predictions exactly) and only then pinned;
  MATHGATE re-run green WITH the pins; CONTRACT ok end-to-end. The
  verification.md "rooftop prologue" note is updated to the motel opening.

## 2026-08-03/04 — Vehicles become PLACES, money becomes an OBJECT (8 opus waves)

Owner briefs, verbatim spine: "fix the appearance of how player driving car in
third person… first person like person driving the car… too many props [in the
cockpit]… really make interior of car exist like how interior of building with
glass exists… cargo plane where you can open and close the back and even a tank
can drive in… banks… real vaults in the back with massive amounts that you can
bomb your way into, that open as rooms just like elevators… in bags that player
can pick up… drive to a warehouse they can buy on a plot like the fake
pentagon… not random chance, real… really making this game smart." Process
directive mid-session: EACH builder runs its OWN before/after visual loop; the
orchestrator only orchestrates + one merged math-gate.

- **CARS (CAR_CABIN_V2 / CAR_DRIVER_VISIBLE / CAR_FP_VIEW)**: dressCabin makes
  every body style a sealed readable room publishing a frame (floorY/cushion/
  seats/wheel/eye); the real dressed player rig drives visibly (occWanted's
  player-exclusion deleted); [V] + touch VIEW pill mount an in-cabin first
  person (cam height 10m→1.19m) inside the ONE camera writer. carCabinAudit:
  bare 0 (was 3), glass renderOrder 1 (buildings' law adopted).
- **COCKPITS (COCKPIT_CLEAN_V2 / AIR_PILOT_VISIBLE)**: props 153→86 total
  (fighter 29→16) by welding what is one machine into one mesh; one-piece
  ellipsoidal canopy; sillDrop puts the sill under the eye (the real "mail
  slot" fault); sight audit unchanged (worst 15.93°). Every airframe shows a
  real dressed pilot through the glass; NPC roster pilots via airSeatActor.
- **BANKS/CASINOS (BANK_VAULT_V1 / CASH_BAGS_V1 / TILL_RESERVE_VAULT /
  CASINO_VAULT_V1)**: cityVaultRoom at EVERY bank lot + casino count rooms;
  the leaf swings, the collider IS the lock; entry is C4 (armored.js blast-
  wrap pattern; 3/4/6 charges by tier) or an insider — closing the stat
  fiction that loyalty's apex rung granted "vault" with no consumer. Reserve
  vault = Σ districtCash × 90-day cycle (derived two ways, 12% agreement).
  Money is bags: one-at-a-time shoulder carry, no sprint, dye stains the bag;
  heists.js bank tier physical (drill bar deleted, crew cut recorded owed).
- **OCCUPANTS (CAR_OCCUPANCY_REAL / DRIVEBY_TRAFFIC / JACK_REACTIONS)**:
  occupancy is a FACT stamped at population — the passenger seen through the
  glass is the one who reacts at jack time (fight/flee/freeze from citySizeUp
  + trait hash; frozen passenger = your hostage); drive-bys claim real
  traffic cars (lanes, lights, IDM) with hunt as posture; eject is heading-
  aware with crime/witness/relShift filed.
- **HOLDS (VEHICLE_HOLD_V1 / CARGO_PLANE_V1 + SEMI_TRUCK_V1 / VAN_HOLD_V1)**:
  CBZ.vehicleHold — a walk-in room in a moving vehicle (platforms rig for the
  player, npclife for bodies, latch for vehicles/cargo); cargo airframe with
  phased rear ramp (tank drives in); semi + van adopt with rear-door arcs;
  bags latch aboard (per-hold counts: groundBags beside world bagsAboard).
- **WAREHOUSE (WAREHOUSE_COMPLEX_V1 / CASH_STORE_V1, cashstore.js)**: own-land
  COMPLEXES row + buyable; deposited bags are VISIBLE shelf stock — the room
  is the bank statement; deposit settles heists' crewOwed; [Z] houses take a
  home-safe count.
- **BOARDING (COMPANION_BOARDING_V1 / FOLLOWER_ORDERS_V1 / CAR_DOOR_ARC,
  boarding.js)**: aircraft_doors grammar generalized — followers walk/run to
  their door, open a real hinged leaf (built per seat, painted from the body's
  own material), step through in vehicle-local space, seat via npcLife.attach;
  [O] "With you" orders (in/out/wait/grab bags/drive to warehouse) for all
  FIVE follower kinds; restrain's trunk-hack is now a visible back seat.
  GATE-PINNED: companionBoardAudit().teleports = 0.
- **GATE**: MATHGATE ok on the merged tree (90210: 318/180/204, det ok,
  errors baseline-only), run twice (pre-deploy state and final merge).
- **DEBT NAMED, NOT FIXED**: companion movers reach only ~20-45% of intended
  speed through clutter (speedWanted 2.61 / actual 1.09 measured) — owed its
  own wave; occupy presets for banks/casinos still open; fpsmode's no-shoot-
  while-driving gate untouched (player drive-bys owed); seatX sign convention
  split between playercars/vehicles (+) and OCC_SLOTS/DB_SEATS (−) documented
  in boarding.js header; two session-limit interruptions mid-wave were
  resumed by audit-then-finish agents (the resume-file pattern in memory).

## THE 2026-08-04 BLACK-BODY FIX — one attribute, the whole city's people

OWNER REPORT: "the NPCs in Gang City just became black." They had. Every
civilian and cop in the city rendered as a flat black silhouette; only the few
parts instancing REFUSED (the fallback meshes) kept their colour, which is why
a ped read as a black body wearing one correctly-painted hair shell.

CAUSE — `entities/pedinstance.js` (shipped 2026-08-03 with the shadow-rig
instancing wave, `PED_INSTANCED` default ON). The pool material is a clone with
`vertexColors = true`, which is genuinely required: r128's `color_fragment`
applies `vColor` only under `USE_COLOR`, so `instanceColor` is uploaded and
ignored without it. But `USE_COLOR` also switches on the vertex-shader half —

    color_vertex : vColor = vec3(1.0);  #ifdef USE_COLOR vColor *= color;
    color_fragment: diffuseColor.rgb *= vColor;

— so the pool geometry must carry a white `color` attribute. The file carried
none, and its comment said `THREE.Material.defaultAttributeValues` would supply
`{color:[1,1,1]}` for the missing one. It does not: in the vendored r128 build
that field is assigned in the **ShaderMaterial constructor and nowhere else**,
so `WebGLBindingStates`' fallback branch (`else if (void 0 !== defaultAttribute
Values)`) never runs for a MeshLambertMaterial and `color` keeps the WebGL
generic default (0,0,0,1). Every pooled ped part was multiplied by ZERO.

THE HOUSE ANSWER ALREADY EXISTED. `entities/crowd.js` hit this exact bug, named
it "the black faces", and fixed it by baking a white colour attribute into its
`tintUnit` geometry — the file pedinstance.js cites as its pattern, on the one
lesson it did not copy.

FIX — `tintGeo(g)`: a companion geometry that REFERENCES the source's own
attribute objects (same GPU buffers, no vertex data copied) plus a white
`color` attribute, cached on the source, one per geometry ever. Deliberately
NOT a mutation of the shared geometry: adding an attribute to a `CBZ.boxGeom`
cache entry would hand a stray `color` to every static prop built from that box
and could fail a mid-play BufferGeometryUtils merge on mismatched attribute
sets.

MEASURED (seed 90210, `probe.mjs --step 300`): before — 51/51 live pools had
`vertexColors` with no colour attribute; after — 62/62 carry one (`colorAttr
Len` == `posLen`), `blackPools: 0`, and 578 of 931 sampled instances carry a
real non-white tint (the skin and garment colours that were being multiplied to
nothing). Instancing itself is untouched: `drawCallsSaved` 2281 → 2330.
Pictures: `npc-gestures` preset, same seed and beat, black silhouette before /
fully painted ped after.

GATE-PINNED: `pedInstanceAudit().blackPools = 0` in `tools/math-gate.mjs`, with
`poolsTotal` printed beside it so a run that instanced nobody cannot pass by
doing no work.

LESSON: the bug was not in the reasoning, it was in a factual claim about the
renderer that nobody checked against the vendored build — and the correction
was 40 lines away in the file the header names as its own pattern. Grep the
sibling before trusting a remembered API.
## 2026-08-04 — the invisible chest, third producer: an audit that could not measure

**Report:** owner, verbatim: "There are guys in the game, NPCs with no outfit
that just have a invisible chest area." Later, unprompted: "IT WAS A CASHIER."
This is the SAME sentence as 2026-07-29 ("weird NPCs that have no outfit, and
it's like invisible where the outfit should be"), which `fa51cd1` closed at one
producer — the static batch/freeze passes eating untagged rig meshes. That fix
is in main and it still holds (verified below). So this is a repeat report
against a fix that works, which is the interesting part.

**WHAT WAS ACTUALLY FOUND — a blind audit, not a new hole.** On 2026-08-03
`entities/pedinstance.js` shipped **default ON**. It stops a body part drawing
by moving it to a private LAYER (30) and drawing it from an InstancedMesh pool
— deliberately NOT by touching `visible`, because `visible` on a rig part is
gameplay state here (gore, dismemberment, clothes). That is a THIRD way to
empty a person, and every guard built for this exact symptom is structurally
blind to it. `clothMeshRenders()` — the one shared definition of "is this cloth
mesh actually drawing", consumed by `cityClothesBare()`, the
`CITY_OUTFIT_GUARANTEE` repair sweep and `outfitIntegrityAudit()` — tested
`visible` / `parent` / geometry / material, all four of which a layer-hidden
mesh passes. **Measured, seed 90210: 334 garment meshes on the hide layer,
`clothMeshRenders()` called 334 of them healthy, `outfitIntegrityAudit().bare`
= 0.** So had instancing dropped a slot, the owner would see the hole, the
self-healing sweep would never fire, and the audit would print `bare: 0`
forever. This is the sibling of the propUseAudit lesson: not an audit nobody
ran, but an audit that COULD NOT MEASURE the newest producer.

**THE FIX (one answer, three consumers migrated in the same change).**
- `entities/pedinstance.js` exports `CBZ.pedInstanceDraws(mesh)` →
  `true` / `false` / `null`. Deliberately three-valued: `null` = not ours
  (caller's own test is the whole truth, byte-identical to before); `true` =
  carried by a live instance **or the whole rig was parked on purpose** (a
  deliberate park is not a hole — reporting it as one would have the sweep
  rebuild off-screen bodies forever); `false` = the rig is being drawn and this
  part has no live instance. Plus `CBZ.pedInstanceRelease(mesh)`, which a
  repair must use instead of the existing `pedInstanceReveal` — clearing the
  mask alone leaves `rec.hidden` true, and `part()`'s `if (!rec.hidden)` would
  then never re-hide it, so the body would draw twice for the rest of its life.
- `city/clothes.js`: `clothMeshRenders()` consults it (degrade-safe one-liner),
  and `cityClothesRepairRig()` releases the mesh before rebuilding it.
- `city/outfits.js`: `outfitIntegrityAudit()` gains `instHeld` (evidence) and
  `instHoles` (the invariant).

**RUN AND PINNED** (the audit's own header asked whoever ran it first to write
the number in; nobody had). Seed 90210, 600 sim ticks from a campaign boot:
`rigs 128, bare 0, deadTex 0, repaired 0, pinned 0, setsRebuilt 0, instHeld 476,
instHoles 0`. `bare` / `deadTex` / `instHoles` pinned at 0 in
`tools/math-gate.mjs`; `rigs` / `instHeld` printed as evidence so a "fix" that
works by dressing nobody — or by switching the instancer off — cannot pass.

**PROVED BY FAULT INJECTION, not by assertion.** Parking one drawn ped's chest
pool slot, changing nothing else about the mesh, moves `bare` 0 → 1 and
`instHoles` 0 → 1 (before this change: 0 → 0), and the body recovers on its own
inside a sweep with `repaired` still 0 — i.e. the producer heals itself first
and the guarantee is the floor under it, which is the cheap ordering.

**WHAT WAS NOT REPRODUCED, stated plainly.** No live NPC with a missing chest
was found in any state reachable from seed 90210: 878 rigs across six pools,
781 character roots scene-wide, a chest-band occupancy sweep, plain-civilian
shirt-colour census, atlas alpha sampling per outfit key, teleport churn across
the map, and a vendor post/recycle walk past 8 shop counters all came back
clean, and a studio turntable of the `vendor` apron look renders correctly. The
2026-07-29 batcher fix is intact (`userData.dynamic` prunes `batchStaticUnder`,
`instanceStaticUnder` and `freezeStaticUnder`; `detached` = 0 on 878 rigs).
One earlier "leak" was a FALSE POSITIVE from a census of mine that tested a
mesh's own `visible` without walking its ancestors — an ancestor-hidden limb is
gore, not a hole. Recorded because it is the exact mistake this file keeps
catching itself in.

**NEW INSTRUMENT: `tools/ped-lineup.mjs`** — photograph the PEOPLE. The shelf
could shoot one body (`studio.mjs rig`) or the player's wardrobe
(`outfit-gallery`), but nothing could answer a question about the POPULATION,
which is what "there are guys walking around with an invisible chest" is. It
boots the real city, pulls live rigs out of `cityPeds`/`cityCops`, stands them
in a row on deterministic marks and shoots them. `--filter plain|painted|cop|
vendor` picks who stands in it (`vendor` first walks the player past counters,
because LAZY_VENDORS only grows a body within 55 m in daylight). `--cfg
PED_INSTANCED=0` is the A/B this exists for. It refuses to lie: every staged
body is PROJECTED through the live camera and the run prints `outOfFrame` and
`bodiesWithUndrawnParts` — the first pass framed an empty pavement while every
coordinate checked out, which is aimlib's lesson arriving a second time.

**GATE**: MATHGATE ok (90210: 318/180/204, det ok, errors baseline-only).
## 2026-08-04 — BOATS CANNOT BE DRIVEN ONTO LAND (BOAT_NO_LAND)

Owner: "boats can go on land right now… make it so boats can't go on land."
They could, and the reason was a seam, not a missing feature. `marineHelm`
integrated position with no waterline test at all, and its own `overWater`
bail handed the frame straight to `vehicles.js`'s road physics the instant the
hull's CENTRE went dry — so a beached speedboat picked up tyre grip, a friction
circle, a five-speed gearbox and a terrain seat and drove into town on its keel.

- **ONE SHORELINE RESOLVER** — `CBZ.marineShoreBlock(car, spec, dt)`
  (`world/water_helm.js`, flag `BOAT_NO_LAND`), shaped like the quay resolver it
  sits beside. Probes BOW, CENTRE AND STERN (a 34 m yacht grounds its bow long
  before its centre), pushes out by `waterField.shoreAt()`'s own signed metres —
  no new distance field — and strips ONLY the landward velocity, so a hull
  running a beach at an angle slides along it and steers off. Pushes SUM, so in
  a channel narrower than the hull the two banks cancel. THREE consumers in the
  same change: the player's helm (§11.5), `piracy.js`'s `marineAutopilot` (whose
  own centre-only step-back it DELETED), and `vehicles.js`'s road path for the
  frames the helm does not own — so the guarantee survives `WATER_HELM=false`
  and hulls with no registered spec.
- **AGROUND** (`vehicles.js`, the exact mirror of `CARS_NO_WATER` beside it): a
  hull that arrives on land another way (spawn, stunt ramp, retreating surge)
  keeps 2.2 m/s and may only make way SEAWARD. Refused, not damped — the first
  attempt used a friction-shaped decay and a held throttle simply found an
  equilibrium at the clamp and kept crawling (measured 12.5 m per 5 s). The
  number to beat is the throttle, not the momentum.
- **MEASURED**, all 11 registered hulls, throttle pinned, aimed square at a
  beach 140 m off, 40 s each, driving `marineHelm` directly:
  worst penetration past the waterline **−1.2 m to −0.14 m (i.e. never)**,
  centre-dry frames **0**, helm-owned frames **2400/2400** (the road-physics
  handover never fires). A/B with `BOAT_NO_LAND=false` on the same run
  reproduces the fault on 10 of 11: penetration **+1.8 m to +33 m**, centre dry
  for up to 1776 of 2400 frames, helm losing up to 74% of its frames.
  (yacht156 is too slow to reach the beach in 40 s — a non-result either way.)
  Aground, through the REAL driven loop: wide-open throttle pointed inland gives
  **0.0 m/s and 1.6 m travelled in 5 s**; astern from the same spot backs 15.2 m
  and REFLOATS — it is a clamp, not a trap.
- **GATE**: `MATHGATE: ok` (90210: 318/180/204, det ok, errors baseline-only).
## THE 2026-08-04 BUTTON-GRAMMAR FIX — "I hate yes buttons"

Owner report on an iPad screenshot of a live gun stop: YES and REFUSE floating
as bare unstyled text over the officer's chest, ~440 px left of their own name
plate ("there's two dialogues on iPad"), neither of them pressable — against
the jail rail, which the owner named as the good one ("we moved those
interaction buttons on iPad all the way to the right, right next to the other
buttons so I can press with my right thumb"). Two separate faults, one root.

- **A BUTTON IS THE VERB, NEVER A DECISION.** Owner's law, verbatim: *"I hate
  yes buttons… yes buttons usually can be switched for the actual thing that is
  next to the button. It'll say, like, mount and then yes. It should just be a
  mount button."* `city/interactions.js` had shipped the proposal in the note
  line (and, on the iPad rail, in the copy bar) with the literal string `"YES"`
  on the thumb target. Now the row carries `verbHead(proposal)` and the docked
  button carries the WHOLE proposal whenever it fits a thumb target
  (`ACTION_MAX` 24 chars) — so the copy bar's say-it-once `dup` test fires and
  most cards collapse to a single MOUNT / TALK / ROB AT GUNPOINT / HOLSTER THE
  WEAPON button. The question line is gone on every surface; only a pinned
  SPOKEN line (`rows.note`) still gets the slot, because that is content rather
  than a restated control. Desktop reads `[E] ZIP WRISTS` with no note.
- **AND THERE IS NEVER A REFUSE BUTTON.** Owner: *"there's never a need for a
  refuse button. Refusing is just walking away."* `police.js`'s gun stop lost
  its REFUSE row. The refusal's teeth did NOT go with it — they moved onto the
  act, in `stopWalkOff` (`CITY_GUNSTOP_WALKOFF_REFUSES`): breaking contact
  (d > 16) with the gun still out ratchets exactly as the row did, and the
  strike count now lives on the OFFICER (`_stopRefused`, seeded back into
  `STOP.susp` by `beginStop`, cleared by complying and by the roadblock pool's
  recycle). The old three-strikes-and-you're-arrested arithmetic is intact,
  spent across contacts instead of inside one, and the note reads the ladder
  out loud: "Open carry — he wants it away" → "Officer is losing patience" →
  "FINAL WARNING · walk off now and he calls it in". Before this, walking off
  was free, which is half of why the row existed at all.
- **THE ROOT: A SECOND RENDERER.** The stand-off hand-rolled legacy `.iopt`
  markup in three places while `mobile.css`'s iPad dock styles `#interact` to
  transparent / `pointer-events:none` and only lights up `.iopt.tverb >
  .itouch-act`. So the legacy rows were invisible AND untappable inside the
  dock, and the name plate flying to the right rail while the text sat at the
  far left is what read as two dialogues. Block Law applied: one renderer,
  `CBZ.cityInteractRowsHTML` (interactions.js), read by both files.
- **A TAP-EATER FOUND ON THE WAY.** police.js's order-40 re-assert rewrote
  `#interactOpts.innerHTML` ten times a second; a finger needs ~100 ms between
  touchstart and click, so it destroyed the button being pressed. Now stamped
  and idempotent (`stopStampRows`, marker on a CHILD so an interact.js clobber
  is still detected). Probed: the button node survives 2 s of re-asserts and a
  synthesized tap stows the gun and ends the stop.
- **GATE**: `MATHGATE: ok` (90210: 318/180/204, det ok, errors baseline-only).
  Probes: renderer output on all three surfaces (no "YES"/"REFUSE" anywhere),
  live stop → one real `<button>HOLSTER THE WEAPON</button>` → tap → stowed;
  three consecutive walk-offs on one officer → called in on the third.
- **NOT TOUCHED (owner's instruction)**: the black-material character in the
  screenshot — someone else owns that.
## 2026-08-04 — THE PHONE GOES IN THE BAG (CAMPAIGN_PHONE_IN_HOTBAR)

OWNER: *"in hitman mode there's a phone in the right corner of the screen.
Click to press. Instead, that should just be like a gun. It should just be in
the inventory."* Doctrine already said so — the item existence test names the
pocket contents outright: "cash, PHONE, keys/keycards, medkit, grenades,
bricks". The handset was the one carried object in the game with its own
bespoke floating button.

- **THE SLOT REPLACES THE BUTTON.** `city/campaign_ui.js` no longer BUILDS
  `.campaign-phone-peek` at all (the CSS stays as the flag-off revert path);
  `systems/fpsmode.js`'s `cityHotbar()` appends a `{kind:"phone"}` entry after
  the guns and usable items, and `cityHotbarSelect()` raises/stows through it.
  One bar contract, so the phone inherited a number key, a click target, an
  `active` highlight and the charpanel mirror without a line of new UI plumbing
  — the Block Law shape: promote the shared renderer, delete the bespoke one.
- **TWO READ-ONLY SEAMS, NOTHING ELSE CROSSES.** `CBZ.campaignPhoneChip()` →
  `{on, available, open, unread, buzz}` and `CBZ.campaignPhoneToggle()`.
  campaign_ui keeps every bit of handset state; fpsmode keeps every bit of bar
  layout. `available` is the same `livePlay()` gate the old button's
  `.available` class used, so the slot appears and vanishes on the same beats.
- **THE BUZZ IS DATA NOW.** `pulsePeek()` stamps `buzzUntil` instead of poking
  a DOM class; the chip renderers poll it and shake their own chip. The stowed
  phone's signal is unchanged in KIND (glyph shake + LED, owner rule) — it just
  rides the slot. Both bar signatures (`hud.js unifiedBarSig`, `inventory.js`'s
  fallback sig) gained the unread/buzz bits or the chip would never repaint.
- **THE CAMPAIGN GETS ITS REAL BAR BACK.** `css/campaign.css` hid `#cSlots`
  under the declutter — which never removed a hotbar from the campaign, it just
  demoted it: `city/inventory.js`'s `#invHotbar` fallback measured `#cSlots`
  invisible and drew the SAME `CBZ.cityHotbar()` at `bottom:14px`. The restore
  (gated on `body.campaign-phone-slot`) puts one bar back in its designed home
  inside `#cWpn`, chips over the live ammo line — the same "instrument, not
  narration" carve-out the wanted stars and the minimap already have.
- **RATCHET**: `CBZ.campaignPhoneAudit()`. MEASURED on seed 90210 with
  `cityOrigin="contract"`: `{on:true, live:true, peekEl:false,
  peekAvailable:false, inHotbar:true, barIndex:1, key:2, barLen:2}` — the
  owner's complaint as numbers, and `peekEl`/`peekAvailable` may never go back
  to true while `on`. Probed live: chip renders itemicons' photographed phone
  (not the word), `active` flips true only while raised, a push sets
  `unread`+`buzz` on the entry, a chip click AND the digit both raise the
  handset, flag-off restores `#cSlots:none` + the fallback bar + no slot.
- **GATE**: MATHGATE ok (90210: 318/180/204, det ok, errors baseline-only).
## 2026-08-04 — THE FORMAL NECK: the collar and the top of the tie (reference images from the owner)

OWNER (with two reference renders of suited blocky characters): "the issue rn
is with the collar and top of tie." Both faults were GEOMETRY, found by
reading `entities/character.js` against `city/clothes.js` and then PROVEN by
the outfit-gallery preset before a line changed:

- **The knot had never been visible, on any suit, ever.** The shoulder-yoke
  slab (centre `neckY-0.04`, H 0.18) overlaps the chest box's top **0.145 m**
  and sits ~1 cm PROUD of it — and every knot/bow in the file was painted on
  the chest's top 0.115 of the torso row, i.e. entirely behind the slab. The
  BEFORE shots show a knotless blade emerging from under a white trapezoid,
  and a tuxedo with NO bow tie at all.
- **The jacket V ran backwards.** The alpha-cut gap pinched at the throat
  (±0.035) and swung open toward the hem; a worn suit is wide open at the
  collar and CONVERGES to the fastened button. Nothing at a collar can read
  through a 7%-wide slit.

`CLOTH_FORMAL_NECK_V2` (default on, `city/clothes.js` owns the flag): the
painter now DECLARES its neckwear in its parts return (`parts.neck =
{tie, w}` / `{bow}`); the yoke micro-atlas (bumped 64x16 → 128x32, still
16 KB, no mips) draws the collar leaves and the KNOT/BOW — the slab IS the
collar zone — with the knot running to the slab's bottom edge; the chest
paints only the BLADE, from row 0, so it runs continuously under the slab on
EVERY body profile and emerges below the seam with no gap (alignment by
construction, not per-profile arithmetic). The shell's V is recut the
reference way (wide at the collar → button stance; DB fastens FLAT with six
buttons on the wrap; sb keeps a relaxed slit below the button), lapels run
alongside the V with a high gorge notch / up-swept peak / bowed shawl, and
the 3-piece finally wears its tie ON the waistcoat instead of a severed
glimpse. Migrated in the same change (Block Law #3): **suit (all 21 styles),
tuxedo, waiter, office, police, pilot** — six painters declare neckwear; chef
kept its kerchief because the throat sample only steps off-centre when
neckwear is declared. Verified: outfit-gallery before/after (the tuxedo's bow
EXISTS now; collarΔ still 0), math gate green. Debt left named: the yoke sits
1 cm deeper than the chest so a top-down closeup shows the tie step back at
the seam (slab construction, not paint); the composite spawn fit layers its
3-D tie over the painted suit's own tie (pre-existing doubling, hidden in
practice); the tan closeup's leaves could still take an under-shade line.
## THE 2026-08-04 STAGE-5 SCALE — a 10x desert in a 10x sea

Owner: *"make the desert 10x bigger and make water around world 10x bigger,
world will become island."* One flag, `CBZ.CONFIG.WORLD_SCALE_V5`
(`world/layout.js`), and both numbers are read as **AREA** — which is the whole
sizing decision and is worth stating plainly, because the linear reading is not
a smaller version of the same idea. 10x linear is 100x area: a 14 x 15 km erg,
wider than the entire stage-4 region union INCLUDING all four nations, with no
offset table that keeps a strait open around it. 10x area is x sqrt(10) = 3.162
per side, and that is what shipped.

- **THE ERG.** `FOOT_SCALE.desert` 1.60 -> **5.06** (= 1.60 x sqrt(10)).
  The Saltlands go 1408 x 1504 m -> **4453 x 4756 m**, i.e. 2.12 km^2 ->
  **21.18 km^2** (`CBZ.worldScaleAudit().desertKm2`). It is now the largest
  single thing in the world — the first time a BIOME rather than a nation sets
  an edge of the FLAT rect.
- **THE SEA.** `SEA_OPEN_WATER` 2.3 -> **5.45**, span 34000 -> **108000**:
  1156 km^2 -> **11664 km^2** of published ocean, 10.09x. WHY THAT IS AN
  ISLAND, arithmetically: land reaches 7.7 km from the sea's centre and water
  reaches 54 km, so the continent is 7% of the sea's width and 1.1% of its
  area. Still free — the drawn ocean is a camera-centred 4.5 km disc, so this
  sizes the BOUNDS record, the geometry's bounding box and therefore the
  flyable airspace (ring 7485 -> **9085**), never a mesh.
- **IT GROWS EAST AND SOUTH, NOT OUTWARD FROM ITS CENTRE**, and that is the
  whole layout design. `desert { dx 2825, dz 1927 }` is chosen to HOLD the
  basin's north-west corner (minX 1719, minZ -301) while its half-extents
  triple, which keeps three shipped contracts free: the Saltlands causeway
  still docks on the same speedway chord, speedway<->desert stays 618 u (the
  speedway is PINNED — live build zone), and Coyle<->Saltlands stays 989 u so
  the farm county does not move at all. Every measured gap is at or above its
  stage-4 value: desert<->farmland 988 -> 989, desert<->forest 2995 -> 2998,
  forest<->snow 984 and farmland<->snow 1331 untouched. ONLY the three eastern
  nations move (dx 2400 -> **5600**) because only they were in the way; mbeya,
  the forest, the alpine north and every mini-city keep their stage-4 offsets.
- **WHAT IT COSTS, AND THE ANSWER TO IT.** Holding the north-west corner walks
  the basin's CENTRE — and with it the Dry Gulch spine — 2.3 km south of the
  causeway that is the desert's only land link. So the deck TURNS: a third path
  point at `CW_X1` runs 2293 m south to T onto the spine (`clearance ...
  docked=2(2368m)`), `buildHighway` registers it as a drivable leg for free,
  and the corridor gate flattens it. A 10x basin whose only entrance dead-ends
  in open dune is not a bigger desert, it is a bigger nothing.
- **THREE STALE-LITERAL BUGS the scale exposed**, all in `biome_desert.js`'s
  corridor gate, all found by reading rather than running:
  (1) the Coyle corridor ended at `MINZ + 600` while biome_farmland runs that
  deck to `max(MINZ + 600, HWY_Z + 30)` — it aims at the SPINE — so 1.7 km of
  real drivable highway would have been buried under 55 m draa (at stage 4 the
  deck overruns by 142 m and the 150 m fade happens to cover it);
  (2) the Saltlands band was gated on `|z - CW_Z|` with no bound in x, i.e. a
  dead-flat strip running the FULL width of the erg — 1.4 km of it hidden
  against the shore falloff, 4.5 km of it not hidden at all;
  (3) every corridor gated on distance to an infinite LINE inside a window,
  which puts a CLIFF at the window edge — full relief one side of an invisible
  line, dead flat the other, with no road within 150 m. All three now use
  point-to-SEGMENT distance (`segDist`, the same grammar
  `CBZ.highwayNetReliefGate` uses); stage <= 4 keeps the old form byte for byte.
- **THE ERG MESH IS TILED, AND THE BAKE GOT CHEAPER.** One 4453 x 4756 m plane
  is a single mesh with a 3.3 km bounding sphere — drawn whole or not at all.
  **6x6 tiles** of 742 x 793 m frustum-cull to the few you can see. The four
  extra height evals per vertex (a 2.4 m central-difference normal) only ever
  shaded the baked vertex COLOUR while the LIT normal came from
  `computeVertexNormals` — so the two never agreed. Each tile now samples a
  one-cell HALO and central-differences the grid it already has, and that
  single normal serves both: colour and lighting agree by construction, and
  because the halo is the NEIGHBOUR tile's real ground the normals stay
  continuous across a seam (per-tile `computeVertexNormals` would have drawn
  10 lighting creases across the erg). Vertices carry ABSOLUTE world coords
  with every tile at the origin, because `centre + half` and
  `centre + width - half` are not the same float and the difference is a crack.
  Net: 70k verts / 139k tris -> **439k verts / 862k tris**, cell 5.3 -> 7.0 m
  (10 vertices across the shortest 72 m ridge, was 13), and the bake costs
  LESS than it did (measured 1.15 us per height eval).
- **DENSITY HELD, NOT INHERITED.** The saguaro/brush/tumbleweed fields are
  fixed candidate counts (90 / 110 / 24) over whatever rect the biome has, so
  their density has fallen with every scale: 109 per km^2 as authored, 42 by
  stage 4, and 4 per km^2 on a 21 km^2 erg — one saguaro every 490 m. `SCAT`
  (= area growth since stage 4, so 10) holds the STAGE-4 density, which keeps
  today's world untouched and the flag a real revert. All instanced: 900
  saguaros are the same draw call as 90.
- **CONSUMERS THAT HAD TO FOLLOW.** `continent.js` `W_ROOF` 15500 -> **19500**
  (measured plate W 17728 x D 15782 — this is the number that silently DELETES
  the continent if it goes stale, and a world with no continent still boots)
  and the `PLATE_SEG` cap 448 -> 480 so the derived 38 m cell does not clip
  (seg 368 -> **472**, cell 37.56 m; clipped at 448 it would creep to 39.6).
  `highwaynet.js`: exactly two free-country lanes were inside the new basin —
  `southZ` 1650 -> **4700**, `eastX` 3700 -> **6800** (midpoint of the corridor
  between the erg's new east shore and the nations that moved to clear it); the
  other five are west or north of a biome that only went the other way.
- **THE MINI-CITY SIZE GRADIENT IS PINNED, ON PURPOSE.** `minicities.js`'s
  rim fraction read `WORLD_ENLARGE_FLAT`, so every world scale silently
  re-tuned a curve that was measured against specific values (Neon Reef 0.44,
  Cape Harbor 0.72, Goldspire 0.84). Stage 5 walks the FLAT centre 1.6 km east
  and would have dropped Goldspire to t 0.29 — handing a shipped city 17
  storeys nobody asked for, because a desert three biomes away got bigger. It
  now reads `CBZ.WORLD_RIM_REF` (the stage-4 FLAT, published by layout.js);
  continent.js's relief RING still rides the live FLAT and walks out with the
  world, which is a different question and the right answer to it.
- **`worldScaleAudit()` gained `scaleV5`, `desertKm2`, `seaKm2`,** and its
  `duneMaxU` sample now rides the footprint (a fixed 96x96 grid is really "a
  sample every 15 m" and walked to 46 m on the 10x erg — wider than the 72 m
  dunes it is trying to find a crest of, so the number would have DROPPED from
  an oracle that returns the identical height for the identical point).
- **GATE**: MATHGATE ok, both seeds, determinism ok, errors baseline-only.
  GOLDEN recalibrated (`--calibrate`, both seeds): 90210 318/180/202 ->
  **329/182/206**, 1337 336/193/202 -> **352/204/205**. `mtnOutSnow 0`,
  `cityOnMtn 0`, `overlaps 0`, `clearance viol=0 clamped=0`, ground error
  0.34 -> 0.31 m max. NOTE the biome-set golden is now PER SEED: 90210 sees
  `frontier` and 1337 does not, because whether the sweep grid lands on one of
  continent.js's four 32 x 24 m Frontier Lookout pads is a coincidence of where
  the plate edge falls. It is a sampling fact, not world content — do not
  "fix" one list to match the other.
- **DEBT NAMED, NOT FIXED**: `bunkers.js` SITE 3, the "desert civil-defense
  shelter", is hard-coded at (1450, 500) in the AUTHORED desert frame and never
  rode the layout dial — it has been sitting on open plate ~270 m WEST of the
  Saltlands since stage 3 and still is. Pre-existing and untouched here (it is
  not a scale bug, it is a missing `CBZ.worldFoot("desert")` call), but it is
  exactly the copy-rect disease `worldFoot` exists to kill and it is owed a
  fix. Also: the 7 authored mesas spread with FSC as designed, which on a
  21 km^2 basin is one landmark per 3 km — the dunes carry the space, but a
  bigger basin arguably wants more buttes.

## 2026-08-04 — the merge wave: seven branches land, and the recenter button goes

**Owner:** "there's a ton of branches rn, go by recent first and merge whatever
is good and doesn't kill new shit, and remove the recenter button on ipad while
you are at it."

**THE BRANCH LANDSCAPE, measured before touching anything.** 30+ refs existed;
only 7 had commits main did not. Everything else — `agent/*-handoff`,
`ipad-interaction-layout`, `animal-skin-auto-equip`, `multi-mode-game-expansion`
— was already ancestral (`git rev-list --count main..<ref>` = 0), i.e. merged
long ago and kept as a label. The two `backup/*` refs are pre-sync snapshots,
not work. So "a ton of branches" was 7 branches and ~25 tombstones, which is
worth knowing before anyone plans another merge session.

**MERGED (all 7, recency-first as asked):** the black-body fix (instanced peds
had `vertexColors` with no white `color` attribute → every NPC a silhouette),
the invisible-chest audit fix (`clothMeshRenders()` was blind to layer-hidden
parts, so the outfit guarantee could not see the newest way to empty a person),
boats-cannot-drive-onto-land (`marineShoreBlock` + AGROUND), the YES/REFUSE
button wave (one renderer, `cityInteractRowsHTML`), the campaign phone into the
hotbar, the formal-neck V2 collars/knots, and WORLD_SCALE_V5 (10x desert in a
10x sea).

**Conflicts were 100% this file** — every branch appends a dated entry, so every
concurrent branch collides here and the resolution is always "keep both", never
"pick one". Not one source conflict in 21 changed files. The two waves that both
rewrote `entities/pedinstance.js` touched disjoint regions and are
complementary, which is what a file-territory split is supposed to buy.

**GATE:** `MATHGATE: ok (90210:329/182/206 | 400 ticks | det ok | errors
baseline-only)`. Every ratchet the merged branches introduced is green in the
same run: `pedInst … black=0`, `outfits … bare=0 deadTex=0 instHoles=0`,
`clearance … docked=2(2368m)`, `airspace ring 9085`. Lots/shops/roads moved
318/180/204 → 329/182/206 because WORLD_SCALE_V5 moved the three eastern
nations; that is the change, not a regression.

**THE RECENTER BUTTON WAS TWO BUTTONS** — the self-summoning `#trecen` icon on
foot (`TOUCH_RECENTER`) and the `RECENTER` pill in the vehicle layer
(`CAM_TOUCH_RECENTER`). Removing either alone leaves the owner still looking at
a recenter button. Both flags now default false, both controls are NOT BUILT
rather than built-and-hidden, and both verb rows carry a `skip` reason so
`touchAudit().uncovered` — a ratchet that may only go down — stays at 0 instead
of absorbing two deleted controls. The vehicle's AUTOMATIC recenter is a
different writer (`camRecenterSuspended`) and is untouched.

**AND IT ALMOST SHIPPED AN IPAD YOU CANNOT SHOOT FROM.** `enable()` wires the
cluster in one straight line and `tapBtn()` had no null guard, so the unbuilt
`#trecen` threw and abandoned the wiring for aim, scope and fire. The lesson is
general and belongs in the law: **a build gate and a wiring gate that disagree
are a ghost control, and any flag that can remove a control can silently unbind
the cluster below it.**

**NEW INSTRUMENT (this is why the bug was catchable at all).** `touch.js` builds
its whole layer from one load-time `matchMedia("(pointer: coarse)")`, and
`enable()` is closed over with no export — so a headless desktop boot has NO
touch layer and every DOM assertion about a touch control was a false negative
dressed as a pass. Chrome's `--touch-events=enabled` does not flip
`pointer:coarse` headless (measured). So `tools/probe.mjs` gained
**`CBZ_PRELOAD=<path|js>`** (runs in every new document before any game script —
`CBZ_URL_EXTRA` can only set CONFIG, this reaches the environment the game
feature-DETECTS) and `tools/preload/ipad.js` fakes exactly the three signals
this tree checks, delegating every other media query to the real
implementation. **Any touch-layout question is now askable headless.**
Verified by A/B: default → button absent, cluster 8/8, console clean; the
documented revert `?cfg_TOUCH_RECENTER=1&cfg_CAM_TOUCH_RECENTER=1` → button
present, cluster 8/8. The B run is what makes A evidence rather than a
photograph of an empty pavement.

## 2026-08-04 — THE TRIGGER BECOMES A STICK (TOUCH_AIM_TOGGLE · TOUCH_FIRE_PAD)

Owner, on the iPad: *"you press the aim button and it lights up, and then you
press it to turn it off… when you press aim, the shooting button should stay
there. Right now the shooting button disappears, you have to do the swipe to
shoot, which is dumb… when you hold the shoot button it should almost look like
the movement keypad, so while I'm shooting I can also change the aim while
still shooting."* Three complaints, ONE cause, and it is a fact about hands:

**A HOLD OWNS THE THUMB IT IS UNDER.** The right thumb is the only one that can
reach the trigger, so an AIM that had to be HELD had already spent it. Every
gesture this file grew afterwards — the slide onto FIRE, the AIM-UP ghost pad,
the aim-finger fine-aim drag — was scaffolding around that one mistake, and each
one taught the player a swipe where a button would do. The fix is not another
gesture. It is to stop spending the thumb:

- **AIM and SCOPE are LATCHES** (`TOUCH_AIM_TOGGLE`, default on). Tap on, tap
  off, amber lamp while on (`.tbtn.tlatch.on` — deliberately NOT the momentary
  3 px press-travel; a latch that looks pressed is lying about where your finger
  is). The latch never remembers its own state as truth: every frame it ADOPTS
  `fpsAimHeld()` / `fpsScoped()`, so a scope that released itself, a gamepad
  trigger, or any other ADS writer moves the lamp instead of contradicting it.
- **The trigger is also a stick** (`TOUCH_FIRE_PAD`, default on). Holding FIRE
  keeps firing wherever the finger roams, and dragging that same finger aims —
  through the shared `applyLookDelta` (accel=false, the fine-aim path), so the
  trigger can never grow a second sensitivity. `#tfire.tpad` draws the movement-
  pad vocabulary the owner asked for: a 124 px dashed ring and a knob tracking
  the thumb from where it LANDED (not from the button centre — same grammar as
  the dynamic movement disc). Walking an automatic across a target is now one
  finger doing one thing.
- **THE FIRE BUTTON REALLY WAS DISAPPEARING, and it was not the layout.**
  `lockon.js`'s optic (`#realScope`, z-45) paints `rgba(2,2,3,.995)` over
  everything outside the tube, and the touch cluster lives at z-22 — so on any
  scope-capable weapon, engaging AIM (which drives `resolveScope`) BLACKED OUT
  the trigger. The buttons were still tappable; they were invisible, which is
  worse, because it taught the player that the swipe was the only way to shoot.
  `#touch.tabovescope` (z-46) lifts the cluster over the mask for exactly as
  long as the optic is up; the rest of the HUD stays masked, which is the point
  of a mask. **A control hidden by another layer's z-index reads to the player
  as a control that does not exist** — and it will be blamed on the layer that
  did nothing wrong.

Legacy grammar is the one-line revert and it is WIRED, not just declared:
`?cfg_TOUCH_AIM_TOGGLE=0` restores the hold + slide-onto-FIRE path (and rebuilds
`#tfireup`, which is not built at all under the latch — an unreachable target is
still a tap target), `?cfg_TOUCH_FIRE_PAD=0` restores the plain trigger.

VERIFIED (`tools/probe.mjs` + `CBZ_PRELOAD=tools/preload/ipad.js`, the headless
iPad session that last wave's recenter fix left on the shelf — this is exactly
the compounding it was built for; three probes, all `fails: []`):
- default grammar: AIM latches on and SURVIVES the lift, FIRE is on the glass
  and holdable while aiming, dragging the held trigger turns the camera without
  releasing it, the latch survives the burst, tap 2 drops it — and the two
  failure modes that matter both hold: a latch does NOT survive its button
  leaving the glass (holster → `taim` hidden → aim released) and does NOT
  survive a blur. `touchAudit()` 40/40, uncovered 0, noHook 0.
- sniper: SCOPE latches, the AIM lamp follows the ADS the optic drives, the
  cluster lifts above the mask, FIRE stays visible AND drag-aims while scoped,
  and dropping either latch lowers the optic and the lift together.
- flags off: `#tfireup` rebuilt, no latch class, no knob, hold aims only while
  held, slide onto FIRE still shoots, no drag-aim leak. Ledger still 40/40.
- CSS geometry (computed, not eyeballed): knob hidden idle → 40 px shown and
  translated while held → hidden after the lift; ring 124 px dashed and inside
  the glass; lamp background 20,30,46 → 255,177,60 with no press-travel.
- `MATHGATE: ok (90210: 329/182/206 | 400 ticks | det ok | errors baseline-only)`.

PROBE CAVEAT worth the ink, because it produced a FALSE FAIL in this very run:
`getComputedStyle(el)` returns a LIVE declaration. Holding one "before" and one
"after" reference and comparing them compares the object to ITSELF — snapshot
the strings you care about at read time, or your A/B is a tautology.

## THE 2026-08-04 FLOATING-CANOPY REMOVAL + PROFILER REPAIR (solo)

**Mandate (owner, with a photograph):** "Find these fake fucking geometric
floating tree things that you added." Then: why does it exist, why does
everything have a kill switch, and is that why the game runs slow.

- **THE ROOF IS GONE.** `canopy-dome` (world/vegetation.js archetype +
  city/continent.js `domeList`/`plantDome`/per-chunk mesh) flew ~57k trunkless
  20-triangle icosahedra at ground + 7..14 m. Its own gate read `c > 0.26`
  while its comment claimed `c > 0.42`, so it spilled out of closed wood onto
  thin ground and shoreline. **It passed 2026-08-03 review because canopy
  cover was measured TOP-DOWN in five preset frames, and from above a fake
  roof is indistinguishable from a forest — the metric structurally could not
  see what it was hiding.** Generalise that, not just the fix: a coverage
  metric taken from one camera angle cannot validate geometry that is only
  wrong from another. `biome_forest.js`'s roof is KEPT and that is the line —
  Redhollow is a flat y=0 plate whose patches sit inside ~2,900 trunks and
  23 m spires; a canopy filler is honest over ground already full of real
  stems, never on relief. Stems from that wave are real and stay: backcountry
  49,241 (90210) / 53,056 (1337) against the ≥20,000 ratchet, `legacy` 0.

- **THE PROFILER COULD NOT NAME ANYTHING.** `config.js frameSource()` walked
  the stack for the first `src/*.js` frame that wasn't config.js — but
  `core/prio.js` wraps `CBZ.onUpdate`/`onAlways` in place, so its wrapper
  frame sat between every caller and the capture. **All 653 registered
  updaters reported `src/core/prio.js:182`.** The one instrument for "what is
  eating the frame" could measure every system's cost and name none of them.
  Fixed with a skip LIST (`FRAME_SOURCE_SKIP`); any future in-place wrapper of
  those registrars belongs in it. Verified: 0/30 unattributed, top entries now
  read `src/city/charpanel.js:1060`, `src/city/arena_fights.js:1416`, …
  Profiling-only path — `frameSource()` still returns "" in normal play.

- **`tools/run-city-browser-profile.mjs` was darwin-hardcoded**, so it could
  not run in headless Linux — exactly where frame-time questions get asked. Now
  honours `CBZ_CHROME` with the same fallback as math-gate.mjs:89 / probe.mjs:110.
  NOTE for the next runner: raise `CBZ_CDP_TIMEOUT_MS` (the 60 s default expires
  during a SwiftShader boot).

**DEBT LEFT NAMED — the real perf lead, MEASURED, unacted-on.** SwiftShader
renders this scene at ~0.09 fps, so every ms/frame figure from a headless
profile is noise and none is quoted here. The scene-graph counts are
device-independent and are the lead: **153,163 objects / 138,823 meshes /
65,420 visible / 14,015 groups / 90 lights**, 122,980 colliders, 23,202 LOS
blockers. r128 recurses the WHOLE graph in `projectObject` every render, so
that traversal is CPU cost paid per frame on any device. `cityRootCensus` says
**114,076 meshes share just 2,865 geometry+material pairs** and **27,496 are
static-merge-eligible but unmerged** (batch.js already merged 757 / removed
203,810). That is the next wave, and it needs a real GPU to A/B — do not
"optimise" it against a software rasteriser.

**Flag-count honesty (owner asked):** 786 distinct `CBZ.CONFIG` flags, 2,410
reads. They are NOT a frame-time cost — they resolve to booleans at build time
(`CARPET`, continent.js) and `core/loop.js` reads none. But 786 is the Block
Law's own indictment quantified: each one marks a place where a new path was
added BESIDE the old one instead of replacing it, and both stay resident.

## THE 2026-08-04 iPAD WAVE — one doubled subtitle, one stairway to a wall, one ordered apocalypse

Three owner complaints off a single iPad screenshot of the present-day city, one
orchestrator + one builder subagent (govcomplex) + one recon scout (strategic).

**"THERE'S TWO VERSIONS OF THE DIALOGUE BARELY OVERLAPPING" — AND THERE WAS
ONLY EVER ONE ELEMENT.** A full-document scan at iPad metrics (1180x820 @2x,
`pointer:coarse`, touch latched) found exactly ONE node carrying the spoken
line: `#citySpeech .citySpeechLine`, effective opacity 1. The second "version"
was the outline. `.world-subtitle-line` drew a flat `1.6px` stroke plus FOUR
hard-offset `±2px` COPIES of the glyph — numbers chosen against desktop's 36px
cap, where 2px is 5.5% of the em and the four copies fuse into one smooth ring.
Touch sizes the same line at 19.27px (mobile.css `clamp(16px,2.35vh,24px)`),
where the SAME 2px is 10.5% of the em: the copies stop fusing, the upper pair
reads as a ghosted second sentence up-left of the first, and they close the
counters of o/a/e so the letters silt up. Reproduced headless and confirmed
character-for-character against the owner's screenshot. **Fix: the recipe is
now `:root { --ink / --ink-stroke / --ink-shadow }` in `css/hud.css`, in em, and
all FOUR hand-copies read it in two lines** (`.world-subtitle-line`,
`.pi-subtitle-line`, `#hint.hint-sub`, `#pinteractWho` — three different stroke
widths before, one now). Ratios are taken from the 36px cap, so desktop is
unchanged (`.045em x 36 = 1.62px`, `.056em x 36 = 2.02px`); at 19.27px the
measured stroke goes 1.6px -> 0.867px and the offsets 2px -> 1.079px. Each
consumer keeps its old literal as the `var()` fallback, so deleting the `:root`
block is a true one-line revert. **em inside a custom property resolves against
the element that USES it** — that is the whole reason one declaration serves
four type sizes with no media query, and it is measured, not assumed.

**AND WHILE READING IT, A REAL SECOND LAYER.** `hud.css` already declares "TWO
SUBTITLE LAYERS NEVER SHARE PIXELS" and ranked exactly two — with a third built
and unenrolled: `#pinteractSay` (`.pi-subtitle`, `--pi-sub-floor`) resolves to
the SAME 120px touch floor as `#citySpeech` (`--subtitle-floor`), so a ped bark
landing during a verb result rendered the two character-on-character. It is a
rung now: campaign (0) -> your own verb's answer (1) -> ambient street speech
(2), off `interact-subtitle-active`, which `interact.js` stamps for the life of
a line exactly as campaign_ui.js stamps its own. `saySilence()` already runs on
every non-playing frame, so the class cannot stick.

**THE STAIRWAY THAT "DOESN'T EVEN HAVE PHYSICS" WAS A FLIGHT TO A BLANK WALL.**
Both halves of the owner's sentence were one fault: `govcomplex.js`'s `steps()`
took `rise` and `n` as hand-typed arguments and nothing checked the total
against the surface at the top. City Hall's climbed `6 x 0.30 = 1.80 m` into the
front wall of a shell whose floor and threshold sit at y=0 (`cityMakeBuilding`
builds every building on the ground); the Capitol's climbed 2.88 m and its top
three treads stood ON its own doorway. And it registered only `plat()` — a
walkable top, never `col()` — which is the correct, documented contract at
0.30 m (`buildings.js:3755`: "NO collider: a monumental stair must never be able
to seal a building's own front door") and a LIE at 1.8-2.9 m, so the whole stone
mass was walk-through. **Fix: `steps(root,x,z,w,depth,TOP,…)` — the caller
states the height the flight ARRIVES AT, the riser count and rise are solved
from it, and the flanks take real per-tread colliders once `top >= STEP_UP`.**
The four monumental entrances become a `perron()`: a 0.30 m stylobate you cross
to the door, with capped cheek walls carrying the colliders — monumental read
kept, threshold one 16 cm lip away, nothing can be sealed out of its own front
door. New ratchet `govComplexAudit().stairsFloating`, **PIN AT 0** (a flight
more than one `STEP_UP` from its declared landing), with `stairs` printed beside
it so a "fix" that stops drawing steps cannot pass.

**"THE GOVERNMENT BUILDING IS KINDA STUPID" — IT HAD NO CLOSED DOOR IN IT.**
Not one, in any of eleven complexes. `keepOut` is a spawn zone; `access` is a
trespass query; `occupy.js` says so in its own header ("it does not lock doors,
because nothing in this engine has a lockable door yet"). A building with
nothing shut in it cannot make a gradient, which is doctrine LAW 1's exact
complaint. **§5d THE STRONGROOM** answers it with the gun-room grammar applied
literally: a steel leaf with a barred vision panel off City Hall's PUBLIC lobby
(so you meet it on your first visit, unsent), the confiscated arms rack and the
city seal lit on the far side of the bars, the key press on the floor
`power.js` already declares `vip` and `occupy.js` already puts men on. The rack
pays a real gun through `cityGiveWeapon`; the SEAL pays the category — every
government floor in the world stops reading you as an intruder, through
occupy.js's own `cityOccupyGrant`, re-asserted per complex as its occupancy
comes up. Declared as a five-field registry row, so a second complex is one
line and no geometry. Flags `GOV_STRONGROOM` / `GOV_STRONGROOM_WRIT`; audit
`strongroomsDeclared` must equal `strongrooms`.

**"ORDER A NUKE ON A PLACE AND A B-2 SHOULD FLY THERE AND DROP IT — THE SAME
WAY IT WORKS WHEN YOU DROP ONE IN PILOT."** The last clause is the whole
specification, and honouring it made the feature ~150 lines instead of a second
weapon system. `strategic.js` already claimed "TWO ROUTES TO A DETONATION …
both end in nukeDetonate", but its only called route (`strategicCallStrike`)
spawns no aircraft at all — it authors impact points and hands them to
`cityBombWalk`. The reason was one gate: everything from "the store has left the
bay" onward lived in the tail of `dropPayload()`, which is welded to
`flyingB2()`, i.e. to the PLAYER being at the controls. **Split out as
`releaseStore(kind, p, rv, opts)`** (exported `CBZ.strategicRelease`) and the
file's own law finally holds for a third route: the ordered sortie calls the
identical function the `[B]` key calls, so it inherits the closed-form solve,
the B61 laydown parachute, the tumble, `bombAt` and
`resolveImpact -> nukeDetonate -> the bus`, with no delivery code of its own.
Attribution now rides on the bomb (`b.by`/`b.byPlayer`, undefined on the
piloted path — byte-identical there).

**THE AEROPLANE IS THE ONE ON THE APRON.** `CBZ.strategicNuclearSortie({x,z})`
CLAIMS the parked B-2 through the same ownership protocol `aircraft.js`'s
fighter scramble uses (`cityClaimMilitaryVehicle` / `cityReleaseMilitaryVehicle`)
and flies `b2rec.group` itself. Three consequences, none of them bookkeeping:
the apron is genuinely empty and the boarding verb genuinely gone while your
strike is up; steal or wreck the bomber and nobody can order a strike; and a
real garrison trooper flies it via `CBZ.airSeatActor`, so shooting him down
costs the base its bomber permanently (the mesh goes with the record — a
`destroyed` release deliberately does not re-park, which for a flying one would
have left a B-2 at 210 m forever). No aircrew on the base, no sortie.
**The release point is SOLVED, not tuned** — playerair.js's called jet drops at
a flat 55 m; this runs the same ballistic solve directly over the aimpoint,
reads how far downrange the weapon actually travels *including the canopy's
horizontal decay integral*, and releases at `aimpoint - throw`. `rv` is computed
once and reused, so the prediction and the event are the same numbers and
`ordnanceAudit()` still counts one release per sortie. Release altitude 210 m is
chosen so `retardFor` ALWAYS takes the retarded laydown (5.5 s ballistic vs
`RET.T_ESCAPE` 12 s) — the real B61 rule, and the reason you get to watch a
parachute come down. Order it at the **nuclear release console**, a new locked
machine in the Fort Brandt command room beside the map table (its own zone, not
a second option on the strike console — `interactions.js` renders ONE verb per
card, so a second option would simply have hidden the iron strike), gated on
`cityLock({verb:"vault"})`: the same apex authority that opens the nuclear vault
six metres away. Every refusal is a fact about the world and is said out loud.

**A PRE-EXISTING BUG THE RECON FOUND ON THE WAY.** `aircraft.js`'s
`parkedMilitary` excluded strategic airframes with `/bomber/i` — which does not
match `"B-2 SPIRIT"`. A 5-star police response could therefore scramble the
strategic bomber as a fighter and fly strafing passes with it, and (the claim
being exclusive) could take the airframe out from under an ordered sortie. Now
tested on the record's own `b2` flag.

**GATE:** `MATHGATE: ok` on 90210 — `329/182/206` lots/shops/roads (golden),
`gov 11/11 placed rejected=25 overlap=0 urban=0 staffed=10`, `mtnOutSnow 0
cityOnMtn 0 overlaps 0`, 400 sim ticks clean, determinism re-run byte-identical,
console baseline-only.

**AND THE SORTIE WAS FLOWN, NOT ARGUED.** A live probe ordered one from the API
and read the whole arc off `CBZ.strategicSortieState()` while bursting
`stepSim(1/60)`:

| t (sim-s) | phase | dist to mark | alt |
|---|---|---|---|
| 0 | ordered — `{ok:true}`, pilot "Tess Wozniak", `bomber:false` (claimed off the pad) | 900 | 210 |
| 2 | inbound | 537 | 210 |
| 4 | inbound | 307 | 210 |
| **5.5** | **RELEASE** -> egress | **43** | 210 |
| 8 | egress | 470 | 210 |
| 12 | egress | 1310 | 210 |
| **16.65** | **DETONATION** — `wanted` 0 -> **5** | 2151 clear | — |

Three numbers in that table are the design working rather than a coincidence.
**43 m** is the solved throw distance, not a tuned constant — the release fired
the frame the predicted impact reached the mark. **11.15 s** of fall from 210 m
is the RETARDED laydown: free fall from that height is `sqrt(2*210/14) = 5.5 s`,
so the canopy streamed exactly as `retardFor` intends. And **2151 m** is where
the bomber was when it went off, which is what the parachute is FOR. The 5th
star is the decisive detonation signal because `cityAddStars(5, "Nuclear
detonation — military response")` is reachable from nowhere else, and
`channelBusy` latched true after. Console errors: **zero**.

METHOD NOTE FOR THE NEXT PROBE, because it cost two runs: the first detector
wrapped `CBZ.strategicNukeDetonate` and never fired. `resolveImpact` calls the
MODULE-LOCAL `nukeDetonate`, so the export is not on the path — a wrapper on a
`CBZ.*` handle only sees calls from OUTSIDE its own file. Detect a detonation by
its consequences (the reserved 5th star, the radiation zone), never by wrapping
a same-file function.

### 2026-08-04, same wave, after the merge decision

**THE HINT'S "ONE STEP ABOVE" WAS A TYPED 166px AND THE LADDER BROKE IT.** The
subtitle ladder above lifts `#citySpeech` by a slot whenever an authored or
interaction line is live — which put ambient speech at 120 + 45.3 = 165.3px,
straight onto `#hint.hint-sub`'s hardcoded 166. That number was only ever an
approximation of `--subtitle-floor + --subtitle-slot`, correct while the layer
under it could not move. It now rides the same ladder, always one rung above
the tallest live speech layer, and its default resolves to the 165.3px it has
always sat at. Same lesson as the flight of steps that arrived nowhere: **a
number that agrees with another number by luck is a bug that has not gone off
yet.** Derive it or it will drift.

**A GEOMETRY STAT FICTION, FOUND AND DELIBERATELY NOT FIXED.** `config.js`'s
`BLD_EXTRAS = false` block carried the line "KEPT: the government/civic
buildings and their monumental entries … explicitly left alone so a future
blanket edit cannot quietly take them" — and a blanket edit had already quietly
taken half of it, in that same block. `BLD_MASONRY_V1 = false` two lines above
is ALSO the gate on `buildings_civic.js`'s civic kit: `bldCivicOrder` (:367 —
podium, columns, entablature, pediment) and `bldCivicCrown` (:568 — dome /
clock tower / lantern) both open `if (!flag("BLD_MASONRY_V1") ||
!flag("BLD_CIVIC_PODIUM")) return;` and are called at `buildings.js:3827-3828`.
So `govcomplex.js` asks for `crown:"dome"` on the Executive Mansion,
`crown:"clock"` on City Hall, `crown:"pediment"` + `order:"ionic"` on the
Capitol — **and every one of them draws a box.** A registry declaring domes the
renderer cannot draw is exactly the banned shape, and it is the most likely
reason the owner's read of a seat of power is "kinda stupid".

It is NOT fixed in this wave, on purpose, and the comment now says so instead
of lying. The fix is to gate the civic kit on `BLD_CIVIC_PODIUM` alone (the
masonry FACADE is the residential brick the owner actually cut; a colonnade is
not) — but that puts columns and domes on every civic anchor in the world, and
it lands on the same facades as govcomplex's new perron, which is two
monumental entries stacked: the "stairway that makes no sense" bug in reverse.
How it LOOKS is the owner's call, judged by playing. **This is the next thing
worth doing to the government buildings, and it is bigger than everything §5d
added.**

**NEW TOOL:** `tools/nuke-sortie-check.mjs`, promoted from the probe this wave
wrote five times. It proves the ordered sortie end to end and the canopy
ARITHMETICALLY — the measured fall must exceed `sqrt(2h/GRAV)` from the release
altitude by 1.4x, which free fall cannot do however the solver drifts. It also
carries the method trap in its header so the next author does not lose two runs
to it.

## THE 2026-08-04 LOAD-COST TEARDOWN — the jail vs the city, measured

Owner: *"Figure out why the prison escape game loads fucking amazing, I can
literally play it on my phone. And why the gang city game is so heavy and takes
so long to load even on a computer."* Full teardown and the ranked plan for
what's still owed: **`LOAD-NOTES.md`**. The short version and the two ratchets:

**NEW INSTRUMENT — `tools/load-profile.mjs`.** Every other gate on the shelf
measures the world once it EXISTS; this one measures what it costs to get there,
which is the number the owner feels on a phone. Four phases: BOOT (requests,
bytes, V8 ScriptDuration at DCL), BUILD (`CBZ.startRun` timed — that number is
how long the tab is FROZEN, `--builders` breaks it down per landmass builder,
`--profile` adds a V8 CPU profile), FRAME, WEIGHT (objects/geometries/heap plus
every request the PLAY press issued, with any asset over 4 MB named). `--cpu 4`
models a phone; `--cfg NAME=0` A/Bs a build flag through `?cfg_`.

**THE MEASUREMENT.** Cell Block Z: 4 requests, 604 KB, playable in **1.07 s**
(5.6 s at `--cpu 4`), 3.5 MB heap. The city: 486 requests, 23.2 MB, **3.5 s to
the title screen but 16.8 s at `--cpu 4`**, then `CBZ.startRun()` is **ONE
synchronous 21–31 s main-thread task** — `cityWorldGeo`'s 39 landmass builders
in a single unyielding loop (18.2 s) plus `buildCity` — ending at ~142k
Object3D, 123k colliders and **442 MB of JS heap**. The freeze, not the
download, is the story. Worst builders: `biome_snow` 4.6 s, `continent` 3.3 s,
`minicities` 2.8 s (+148k objects by itself). Profile: 18% of the build is
`getProgramParameter` (shader link, ~107 programs), 8.7% `batch.js`
`mergeGeometriesV2`, 6% `core/seed.js` noise, 4.4% GC.

**TWO FIXES SHIPPED, BOTH FLAGGED.** `OFFICIAL_IFC_LAZY` (default on): the
64.8 MB baked-BIM GLB was fetched from a landmass builder on EVERY run for one
civic annex most sessions never walk to — it now waits until the player is
within 900 u. The pad, plaza link, road record and region still build
synchronously, so **the world is byte-identical and the math gate agrees**;
PLAY drops to 2 `assets/official` requests and the boot path has no asset over
4 MB left. `CITY_BOOT_SCREEN` (default on): **makes nothing faster** — it paints
a card and waits two frames for it to actually PAINT before handing the thread
to the build, so the freeze sits behind a screen instead of a blank page (the
spinner animates `transform`/`opacity` only, so the compositor keeps it moving
while the main thread is gone). `CBZ.startRun` is untouched and still fully
synchronous — every tool asserts on the world the instant it returns, so only
the human buttons route through `CBZ.startRunPresented`.

**THE CORRECTION WORTH KEEPING.** 64.8 MB is the FILE; GitHub Pages serves it
gzipped (checked against the live site, not assumed) so the wire cost was
8.3 MB. Still ~50x the entire Cell Block Z payload, on the critical path, for
scenery — but quote the right number. Same discipline caught a bug in the new
tool itself: `loadingFinished.encodedDataLength` comes back **0** for large
streamed responses, so the first version silently counted the GLB as zero
bytes. It now takes the larger of `dataReceived` and `loadingFinished` per
request and labels anything still in flight as partial.

**NOT DONE, AND WHY.** Slicing the build is the real fix for the freeze, and
`cityWorldGeo`'s sorted-builder loop is already the right shape to yield
between — but it is called from deep inside `buildCity` (`world.js:1052`) which
does more work after it, and `settlements.js` wraps it as a keystone. That is a
boot-path refactor needing the owner's eyes, not a patch, so this pass shipped
the honest loading card rather than faking progress. `LOAD-NOTES.md` ranks the
rest: build-only-near-spawn, the ~148k-object `minicities` count,
`LOCAL_INSTANCING` (still off pending the owner's parity call), shader
precompile, and `defer` on the 467 tags (measure first — the inline block at
`index.html:354` must still run before `config.js`).

## THE 2026-08-04 PRISON PHONE PASS — the HUD, the cell camera, the armory

Owner, playing Cell Block Z on a phone: *"The prison game is really good. Work
on the prison game."* Then a list, and the through-line of most of it is one
sentence: ***"hud is being completely disrespected with dumb shit wasted
inputting in it — SHOW WITH NPC ACTION DONT TELL."*** New gate:
**`tools/prison-polish-check.mjs`** (22 assertions, escape + gungame; boot
boilerplate from jail-check).

**A ZERO IS NOT NEWS — three panels now exist only while they have a reading.**
- `#gangHud` (`JAIL_GANG_HUD_LIVE`, systems/hud.js) read `RESPECT · REDS 0 ·
  BLUES 0 · CREW NONE` on every frame of a fresh run — four cells saying
  "nothing has happened yet", wrapping the one live cell onto a second line.
  Standings draw as coloured `R 42` only past ±1, crew only when you are in
  one, and nothing live at all = no panel. Every branch above it is untouched;
  it also stopped running `innerHTML` with identical markup every frame.
- `#detectWrap` (`JAIL_WANTED_HUD_LIVE`, systems/detection.js) is 40vw of
  `WANTED · CLEAR` over an empty green bar for the entire quiet half of a
  stealth game. It fades out while `label === "Clear"`, so its return reads as
  an alarm. On a phone the caption goes entirely and the live state takes the
  row (they were rendering ON TOP of each other: "WANTEDSEARCHING: TOWER").
- Gun game (`GUNGAME_HUD_TERSE`): `RUNG 3/9 — COMPACT SMG / NEXT: 12G PUMP /
  LEADER: You` is 51 characters of which 31 never change in any match ever
  played. One row now: `3/9  ▲ 12G PUMP`, and the leader cell exists only while
  somebody is actually ahead. `#objective`'s 22-word rules paragraph and
  `#survBars`' HEALTH/STAMINA labels are off in that mode for the same reason;
  `#ammo` joins city/escape's minimal readout (the docked chip already names
  the gun).
- **TIPS ARE GONE, not defaulted off** (`PRISON_TIPS`, default false). Defaulting
  `helpOn` false had left the SWITCH on screen forever — a rail row, a phone
  pill and an `[H] Tips: OFF` footer, all visible in the owner's screenshot.

**ONE GUN BAR IN GUN GAME.** *"gun game still shows 2 places of gun inventory,
one on the right bottom of screen needs to go."* `JAIL_HUD_UNIFIED`'s dock was
gated to `mode === "escape"`, so gun game got the hotbar AND the floating
`#weaponStrip`. The dock covers gungame now and, since that mode carries no
contraband, the nine empty cells and BAG come off with it.

**THE ARMORY IS THE ARMORY** (`PRISON_ARMORY_FULL_RACK`, `PRISON_RACK_EMPTIES`).
`CBZ.FPS_WEAPONS` declares 13; the room carried 6. The rack's LOWER shelf run
has existed since day one and never held anything — it holds the four missing
sidearms/autos now, so no board, bracket or original position moved; the M249,
the RPG and the 40mm join the sniper behind the cage, because REACH and
EXPLOSIVES are the categorical tier. And *"when I take a gun it turns green
under it, instead of just removing the gun from the wall as it should do"* —
the mesh leaves the wall and the bracket goes dark. `gunroomAudit().rackSlots`
13, `gatedSlots` 4 (may only go UP).

**"INVISIBLE DOOR LEFT BEHIND ARMORY DOOR WHEN OPEN SO YOU CAN'T SHOOT THRU."**
Real, and worse than one door: `core/losgrid.js` BAKES each blocker's world AABB
into its XZ grid and only rebuilds when the `losBlockers` array's identity or
length changes. A door that opens changes neither — so the armory gate, the yard
door and **368 city shop-door leaves** kept blocking line of fire from their
closed positions forever. Movers now go to the `exact` list (live raycast), which
self-heals for any future door. That took the exact list from 4 to 372 meshes and
per-cast cost from 8.3 to 73-93 µs, so the exact list got a broadphase of its
own — a cached world AABB per entry, re-derived only when its matrixWorld
actually changes — landing at **19.3 µs/cast**, i.e. ~0.05 ms/frame.

**A CELL IS FIRST PERSON** (`CAM_TIGHT_FP`) — the owner's own idea: *"third
person mixed with first person for when they are in small rooms or cells etc
where 3rd person gets messed up. maybe that's dumb but we will try it."* It is
not dumb, it is the only answer the geometry allows: a cell is 2.4 m across and
a third-person boom needs its length plus the camera's radius BEHIND the
character, so every such camera either clips the wall or photographs the inside
of a head. Two findings on the way: `CAM_ROOM_BOOM`'s room probes were gated on
`TP`, the CITY on-foot tier — so the mode with the smallest interiors in the game
never ran them at all; and its `minCam` lerp toward `INT_MIN_CAM` was written
against city floors (1.5-3.0) and would have PUSHED the prison's 0.28 floor out
to 0.75 in the very cells it exists to let the lens into. Both fixed. The rule
itself calls `CBZ.setFPS` exactly the way [V] does — FIRST PERSON IS SACRED, so
fpsmode is untouched and unaware, and the switch inherits the existing
`CAM_TOGGLE_BLEND` dolly. Hysteresis 3.6 m in / 5.2 m out (measured: a cell
probes 3.20 span / 1.90 ceiling, the wing's hall 18.0), and **the player
outranks it** — any hand toggle drops the claim until the room opens up.
Prerequisite: `world/cellblock.js`'s cell roof slabs are LOS blockers now. They
are 30 cm of concrete, the wing is open-topped, and they are therefore the ONLY
lid in the prison — with none the probe could only ever answer "outdoors".

**THE PHONE ANCHOR.** *"moving pad is too close to middle needs to be lower and
left."* `left:88px` on a 168px disc is the corner of an iPad and 44% across a
393px phone. Phones get their own anchor (140px disc at 10/44, centre x=80) plus
`#hotbar` in touch.js's `UI_SEL` so a slot tap under the ring reaches the slot.
The bottom-left cluster moved out from under it: the compass above the ring, the
gang chips up to the free wall under the minimap. Also fixed while looking:
the fifth interaction verb was spilling off the LEFT edge (row-reverse overflow
on a row that refuses to shrink) and `Romance` was breaking to `Romanc / e`.

### …and the second pass: the logic behind those panels, connected and off the HUD

Owner, on the same day: *"Don't clear up the logic behind the HUD space wasters.
Improve that logic, connect it all, and make it real logic, but remove it from
the HUD."* Right on both counts, and the audit that came out of it is the
finding of the wave.

**THE PRISON WAS MUTE, AND HAD BEEN SINCE THE LAST SHOW-DON'T-TELL PASS.** That
wave deleted 47 narration popups out of `entities/ai.js` — correctly — and
documented `CBZ.citySay` as the sanctioned replacement: "a thing a person SAYS
goes over that person's head." Counted this time: **47 narrations dropped, ONE
`say()` call, and that one could not work either.** `city/social.js`'s say()
reads `ped.pos.x` for its range gate; a prison actor keeps its position on
`.group.position` and its name on `.data.name`, so every prison citySay threw a
TypeError straight into the caller's own try/catch and returned false. Proved,
not guessed (`CBZ.citySay(CBZ.npcs[0], …)` → *Cannot read properties of
undefined*). So the debt, the dues, the cover, the snitch runs and the crew
reactions all still RAN and the only evidence any of it existed was the corner
chip strip. Delete the strip first and you get a simulation with no output at
all — which is why "remove it from the HUD" had to come with the rest.

**THE BLOCK — `CBZ.prisonSay(actor, line, opts)`** (systems/interact.js). Not a
new UI: this file already owned a working speech surface (`sayResult` →
`.pi-subtitle`, the shared world-subtitle grammar, enrolled in hud.css's
subtitle ladder) — it is what answers every interaction verb today. Published
with the three rules ambient speech needs and verb answers never did: RANGE
(16 u, 24 u mid-approach — a line is overheard, not broadcast), RANK (a verb
answer cannot be stomped by block chatter), SILENCE (the dead, the KO'd and the
cuffed do not talk). `nar()` gained two arguments — *who is doing this* and
*what they say* — so a site migrates in one line and `CBZ.aiNarrationAudit()`
now reports `{spoken, mute}`, where **mute may only go DOWN**. 26 sites carry a
mouth in this change: the collector says `"That's 14 now. It goes up every time
I walk away."`, the man you stiffed says `"I covered for you. That's going on
your tab."`, the crew that backed you says `"Go on, do the work. Nobody's
touching you."`

**THE ONE REAL STAT FICTION, KILLED.** `snitchIntelT`. A bent guard sold you the
name of your snitch for cigs and the entire effect was a 30-second countdown
read by exactly one HUD chip — while `systems/interact.js` already offered
Confront / Pay silence / Threaten on ANY reporter, so you were paying a corrupt
screw for information the HUD gave away free. Both halves fixed each other:
knowing who ratted is now a per-actor FACT (`snitchKnown`, `JAIL_SNITCH_KNOWLEDGE`)
with three honest routes — **SEEN** (you were there when they walked up to a
screw; the rat now says *"He was over by the yard gate. I watched him."* and
overhearing it IS the knowledge), **PAID** (the guard's name-drop, finally worth
cigs), **TOLD** (your own crew hands you the name). The global is deleted
outright; `CBZ.snitchKnowledgeAudit()` reports `{reported, known, gated}`.

**WHERE YOU STAND** — a fourth page on the Ranks board (`systems/dashboard.js`).
A real system the player can never inspect is only half a system, so the ledger
gets a page you OPEN rather than a strip you cannot turn off — and it is the
only place the four families are shown together, which is the "connect it all"
half: your standing with each crew beside what you owe them, what they are still
covering, who is walking at you about it, every rat you have actually made, and
the live job. Nothing on it computes; every cell reads a field some system
already owned.

**AND THE STRIP IS GONE** (`JAIL_GANG_HUD`, default false — the whole build is
skipped, not hidden, which also retires an innerHTML rebuild plus three full
`CBZ.npcs` scans every frame). Not one number was deleted: `gangStanding` still
drives 61 branches in ai.js, debt still sends collectors, cover still decides
who steps in front of you.

Gate: `tools/prison-polish-check.mjs` 33/33, and MATHGATE ok.
## 2026-08-05 — THE NUKE STOPPED BEING ROCKS (solo)

Owner, verbatim: *"Nukes looked almost perfect... The only issue is they look
like rocks. They look a little geometric instead of looking like smoke — when
the RPG blows up, it's like a cloud. Don't change anything about the nuke at
all, don't change its shape or its speed. I just want whatever the RPG is
doing."* Second time this complaint has been filed (the first produced
`NUKE_FX_SOFT_LOBES`, 2026-08-02); this time it was read as a rendering-model
question rather than an edge-softness one.

- **THE DIAGNOSIS WAS A READ, NOT A GUESS.** `city/crashfx.js:418-577` (the
  RPG blast) and `city/nukefx.js`'s lobe field differ in exactly four ways,
  and the cloud had none of the four: RPG puffs are **unlit** (a
  SpriteMaterial takes no lights, so no puff carries a terminator — ours were
  MeshLambert under the sun, and a terminator across a closed convex surface
  is what "geometric" names); **depthWrite is off**, so overlapping puffs
  ACCUMULATE (ours wrote depth, so lobes hard-clipped and a near lobe's soft
  rim faded to SKY rather than to the lobe behind it — a pile of soft-edged
  boulders); the **mask is lumpy**, so a silhouette is ragged (a fresnel fade
  is smooth, and a smoothly faded sphere is still a sphere); and **alpha is
  thickness**, zero at the edge with no floor. Also found: the file header has
  claimed since d186a55 that the fields "reuse the RPG's soft fire/smoke
  masks" — `TEX.blastSmoke` was fetched at load and never bound to anything.
- **`NUKE_FX_SMOKE_LOBES`** (one flag, one revert) draws the SAME lobes as
  puffs: unlit wrap-scatter shading injected at `<tonemapping_fragment>`
  (energy-matched to Lambert at 1/PI, after the first draft at 0.62 washed the
  cap pale exactly when the fireball was boosting the sun); depthWrite off with
  instances flushed back-to-front by `flushVolume` (an InstancedMesh is one
  draw call, so buffer order IS paint order and three can never sort it
  against itself); the RPG's own smoke mask, cloned for RepeatWrapping and
  offset per instance, carving each silhouette; a no-floor alpha that erodes
  to nothing at the rim. Additive layers moved UNDER the cap (hot 7 -> 5.05,
  glow 5.25 -> 5.15) because their "heat between the lumps" read came from the
  cap's depth, and now has to come from its alpha.
- **TWO THINGS ONLY THE SCREENSHOT COULD HAVE TOLD ME**, both first-round
  failures, both fixed: (1) shading a billow by its OWN normal is a per-lobe
  identity — the cap came back as countable balls with the terminator already
  gone. The light gradient is now the CLOUD's (a world-space top-lit ramp every
  lobe samples identically, `uSmokeSpan`), with the lobe normal down to 30%
  weight; adjacent lobes agree at their seam. (2) The last rock was
  GRANULARITY: eighteen circles read as eighteen circles however softly each
  is drawn. The smoke path fills the SAME envelope more finely — cap 18->88,
  stem 10->48, surge 20->76, crown 14->60 (272 cold lobes against 72),
  identical seed laws, identical size distribution, so outline/width/height/
  timing are untouched and the field simply stops being gappy. Fill measured
  FLAT at every step (97/57/58/50 ms at 272 lobes vs 151/67/58/49 ms on the
  old path, SwiftShader, median of 8 renders per beat) — the cloud is not
  what this scene spends its fill on.
  THE OWNER CAUGHT THE REAL ERROR IN THIS: the first pass stopped at a
  cautious ~1.5x, measured the cost as flat, and then failed to SPEND what
  the measurement had just bought. "If it didn't cost you more, why did you
  only do some?" — correct, and worse than the original mistake, because the
  number that settled it was already on the table. Per-lobe alpha falls as
  the count rises (coverage is 1-(1-a)^n, so density holds while every
  individual lobe fades: cap 0.58 -> 0.26), which is exactly the direction
  that stops any one lobe reading as an object. More is not merely bigger
  here; it is the axis that removes the artifact.
  That round also surfaced a defect the first pass shipped: `VOL_SORT_MAX`
  was a typed 24 while the cap already carried 34 lobes, so ten of them fell
  through to an unsorted direct write. It is derived from VOL_MAX now, so
  raising a count can never silently un-sort its tail again.
- **`CBZ.nukeSmokeAudit()` + `tools/nuke-smoke-check.mjs`** — the rock/smoke
  argument as a number, because the owner has now filed BOTH complaints:
  "slightly opaque floating rocks" (the body must not be see-through) and
  "looks like rocks" (a lobe must not have an outline). One per-lobe alpha
  cannot satisfy both; overlap can. The probe reads live instance matrices,
  casts 16 rays through each layer's centroid and reports 1-(1-a)^hits. Peaks
  are now PER LAYER off those measurements — cap 0.58 (6.7-7.6 lobes crossed),
  stem 0.93 (1.1-7.6: a horizontal ray crosses a COLUMN about once, so its
  density can only come from the lobe itself), surge 0.82. A DENSE CENTRE WAS
  NEVER THE ROCK; the terminator, the depth clipping and the unbroken
  silhouette were.
- **THE PROBE'S OWN FIRST METRIC WAS WRONG AND IS WORTH REMEMBERING**: it
  asserted a per-lobe alpha CEILING as a proxy for "the rim still wisps". Per-
  lobe alpha is the density at a lobe's CENTRE; the rim is driven to zero by
  the shader, independent of it. On a single-file layer the ceiling and the
  body floor are arithmetically incompatible, so the pair could only ever be
  satisfied by making the cloud see-through. The no-floor silhouette is pinned
  where it is decidable — in source, by `tools/test-nukefx-phases.mjs`.
- **HARNESS BUG FOUND, DOCUMENTED, NOT MINE**: every AFTER-side frame of
  `tools/visual-presets/nuke-sequence.mjs` carries a dark faceted disc at
  (587,401)-(719,530), pixel-identical in every beat regardless of camera
  distance or simulated time. It survives the A/B it appears to belong to
  (identical with the nuke flags flipped either way, darkpx 11447 both times),
  never appears on the BEFORE side or on a single-navigation `--only after`
  run, and does not reproduce in a standalone probe copying the preset's
  staging exactly. It is triggered by the SECOND `Page.navigate` in the tab.
  Until somebody roots it out, judge looks from two separate `--only after`
  runs; the note is in the preset header so the next reader does not spend an
  hour on it like this session did.

## 2026-08-05 — THE DOOR STOPPED HAVING A PRICE, THE LADDER ROW DIED (solo)

Two owner calls off one iPad screenshot of the prison, both about text nobody
asked the game to say.

**1. THE ARMORY IS A KEY DOOR (`PRISON_ARMORY_KEY_ONLY`, `cityLock power:false`).**
Owner, reading his own screen: *"The armory door needs a Keycard, the police,
$204,167 more, or 10 more guns un…"* → *"this specific text is way too long.
It's dumb that an amount of money can get you into the armory."*

Both halves were one fault. `city/loyalty.js`'s lock sentence is GOOD doctrine —
a locked door that names its price out-motivates a quest marker (LAW 1) — but
only where the price is something that door would actually take. A steel door
with a card reader has no cash price, and quoting one made the ledger a
universal solvent AND produced a four-clause list the HUD then truncated
mid-word. So the door named a route the player could not finish reading.

`cityLock({… power:false})` is new and opt-IN: the door declines route 4 and
prints from its OWN keys/orgs, which is short by construction because a door has
one or two of those and never four. Routes 1-3 are untouched and the check sits
after them, so refusing the ledger can never refuse a key. Every other lock in
the repo keeps the ledger route — a warehouse or a strike console genuinely can
be taken by a big enough crew, which is the whole point of the ladder.

MEASURED, live boot, no card / not a cop / $5M in pocket:

| | line | chars |
|---|---|---|
| was | "The armory door needs a Keycard, the police, $225,000 more, or 11 more guns under your command." | **95** |
| now | "The armory door needs a Keycard." | **32** |

Both gates in the room take it, not just the outer one the owner was standing
at — they are two locks six metres apart and fixing one would have left the
identical cash quote inside. The cage also stops preferring `L.line` over its
own hand-written one: the cage's second route is a HACKSAW, which is not a key,
an org or a power rung, so no generated sentence can ever name it. `have:true`
still returns `route:"key"` — verified.

**2. THE GUN GAME LADDER ROW IS GONE (`GUNGAME_HUD_PANEL=false`).** Owner, on
the row above the hotbar: *"it has this pop up right above the gun that says
what gun you're on. Remove that. You know what gun you're on because you're
holding it in your hand."* Told the ▲ gun is the NEXT rung and not the one in
his hands, the verdict did not move: kill the row.

That is the honest read of the 2026-08-04 terse pass too. That wave cut the row
from fifty-one characters to about fourteen and it STILL read as clutter —
which is the shape of a readout nobody was looking at, not one that was merely
too wordy. **A panel can be trimmed to nothing and still be the wrong idea.**
The gradient survives where it always actually lived: the gun in your hands
changes CATEGORY the instant you climb, killfeed narrates the kill, the timer is
top-right.

The trap here was the tick, not the row. `#survBars` (HP/stamina) is shared
arena furniture that survival draws too and it is written from the same
`onUpdate(49.2)` — returning early would have blanked the health bar in every
gungame match. The panel is gated; the bar writes run unconditionally, and
`tools/prison-polish-check.mjs` now pins BOTH halves ("no ladder row above the
hotbar" + "HP/stamina still write with the row gone", hp=100%). Its old
`terse === true` assertion is retired: the node no longer exists to be terse.

Gates: PRISON-POLISH 34/34, MATHGATE ok (det ok, gungame 9rungs maps=2,
loyalty locks=6). Reverts are one line each and independent.

## 2026-08-05 — THE DIFFICULTY TOAST IS DELETED (solo)

OWNER: *"It says the guards are getting restless. And I get those pop ups when
I'm playing gun game and natural disaster game, not even just when I'm playing
the jail game. And first of all, that pop up should never exist anyway in any
game. It's so stupid, and it means nothing."*

`systems/difficulty.js` fired one of five prison-flavored lines each time its
ramp crossed a fifth. All five are gone, with `checkTier()` and the `tier`
counter that existed only to stop them repeating.

**WHY DELETE RATHER THAN ADD A THIRD MODE TO THE EXCLUSION LIST.** The toast had
already been scoped twice — `mode === "city"` returned early inside `checkTier`,
`mode === "survival"` returned early in the driver — and it still reached the
owner. An allowlist patched once per complaint is not converging on a rule;
there was no mode where the line was right. It is a system announcing its own
internal state in prison voice, and "the guards are getting restless" names
nothing a player can see or act on. **A narrator for a number is not a why.**

MEASURED (throwaway CDP probe, `CBZ.flashHint` wrapped and every line recorded,
600 × 0.5s `stepSim` per mode — RAMP_SECS is 240, so this crosses all five old
boundaries). Run against BOTH sides, because a probe that passes before and
after proves nothing:

| mode | before | after |
|---|---|---|
| escape | **5 toasts** (all five lines) | 0 |
| gungame | **5 toasts** (all five lines) | 0 |
| survival | 0 (driver already excluded it) | 0 |
| city | 0 (`checkTier` already excluded it) | 0 |

`ramp` reaches 1.00 / tier 5-of-5 in every ramped mode after the change — the
+35% viewDist and speed, the slowed cooling and the patrol scans are all
untouched. That difficulty was always meant to be FELT; the caption was the only
thing removed. Note the probe did NOT reproduce the owner's disaster-mode
sighting — survival was already silent pre-change — but with the strings deleted
the question is moot in every mode.

**ON GATE CHOICE (owner, same message: "Are you using gates that have nothing to
do with the work you are doing?").** Fair. The previous wave ran the full math
gate — 4 minutes of city generation, tree counts, arena seats and biome
histograms — to land two string changes it could not possibly have exercised.
`verification.md` says "use after EVERY change", and that instruction is what
produced the waste. **The gate should be the one that can actually fail on the
work.** For this change that is a throwaway toast probe (~90s, and it caught the
old behavior) plus `node --check`. Run the math gate when the change can move
what the math gate measures — world building, sim ticks, determinism — not as a
tax on editing a sentence.

## 2026-08-06 — GANG CITY IS THE ENGINE (the RPG that would not blow up, the chair nobody could jump over)

Owner: *"In prison mode the RPGs don't blow up… but in Gang City the RPGs blow
up beautifully. And in Gang City the players and NPCs interact with walls and
with assets in front of them, like a chair, or something to jump over — they
interact with that better than prison mode. So prison mode, gun game and natural
disaster can all use these elements from Gang City. Gang City becomes like this
engine and this asset farm."*

**BOTH SYMPTOMS WERE ONE LINE, TWICE.** Neither was a missing feature and
neither needed new geometry, new animation or new damage code:

| symptom | the whole cause |
|---|---|
| an RPG in prison/gun game/disaster gives a camera shake and nothing else | `systems/fpsmode.js:2498` — the ENTIRE detonation payload sat inside one `if (CBZ.game.mode === "city")`. Outside it, only `CBZ.shake` + `doHitstop` remained. The prison gun room stocks an **RPG LAUNCHER and a 40 MM LAUNCHER** on the wall (`world/gunroom.js:637-638`), so the owner was taking a live weapon off a rack and firing a dud. |
| nobody outside the city can vault a chair | `systems/physics.js:624` — `probeTraversal` returns `null` on its first line unless mode is city. The prison's own mess tables and stools **already register exactly the `y0/y1` + `ref` colliders the probe reads** (`world/cafeteria.js:320,342`). Nothing was missing but permission. |

**WHAT IT SAYS ABOUT THE CODEBASE.** `mode === "city"` appears **583 times**.
Most are honest — they guard a city RECORD (`cityCars`, `city.arena`, the wanted
ladder, the world-state ledger, the fracture chain) and must stay. A minority
guard a shared ENGINE verb, and those are bugs wearing the same clothes. The
repo had already diagnosed this class once and cured it in one domain: the water
oracle (`waterSharedAudit().cityGated`, pinned 0) — *"not because the effects
were city-specific but because `cityWaterAt` only ANSWERED for the city."* The
GPT handoff put it in one sentence: **"a hard-coded mode enum is not the final
capability contract."** Same disease, two more organs.

**THE BLOCK: `src/systems/modecaps.js`** — `CBZ.modeHas(cap)` replaces the enum
at capability sites; `CBZ.worldActors()` is the mode's live roster;
`CBZ.hurtWorldActor()` routes a hit to the funnel the mode ALREADY owns
(`aiKill` for prison, `gungame.hurt`, `surv.hurt`, `cityKillPed`); and
`CBZ.blastWorldActors()` couples a blast to that roster. It is a switchboard,
never a second ledger — which is the line the GPT handoff drew (*"do not call a
city-only local damage helper from prison and declare parity"*). `MODE_CAPS_V1
= false` makes `modeHas` itself answer `mode === "city"`, reverting every
migrated site at once. Six consumers migrated in the same change (Block Law
rule 3): physics ×3, fpsmode, actorcollide, crashfx, gungame, survivorbot.

**FOUR THINGS FOUND BY READING, NOT BY THE GATE:**
1. **`CBZ.cityExplosion` is a WRAPPER CHAIN, not a function.** Six files
   (buildings' structural ledger, bank vault doors, construction walls,
   wildlife, armored hulls, demolition) hang city couplings on it and they stay
   installed for the whole session once the city is built. Detonating the chain
   from the prison yard would run six city couplings against lists describing a
   different world. Fixed by exporting **`CBZ.cityBlastCore`** — the blast
   itself, before any wrap. Shared modes use the core; the city keeps the chain.
2. **Prison actors have no `.pos`.** They ARE their `THREE.Group`. Even with the
   gate open, `probeTraversal`'s `!actor.pos` guard would have refused every
   guard and inmate. Fixed by reading `a.pos || a.group.position` inside the
   traversal — **NOT** by aliasing `.pos` onto the record: `weather.js:763`,
   `tornado.js:1004` and `combat_iq.js` all use `!a.pos` as their "not a
   positioned actor" test, so the alias would have silently switched the prison
   cast onto city-shaped paths.
3. **`.speed` means different things.** For a city ped it is the live per-frame
   speed; for a prison inmate it is the BASE walking speed, read back as
   `CBZ.aiThink(n, dt) || n.speed`. `stepTraversal` writing to it would have
   permanently re-tuned every inmate to whatever pace it last vaulted at. New
   `speedField:false` opt.
4. **`CBZ.npcStepLedge` has ZERO callers** — written city-only in a past wave,
   never adopted, still labelled SECONDARY in its own header. Migrated so it is
   not born city-only a third time, and NAMED as prose in its comment. The Block
   Law's own failure mode, live in the file.

**THE PRISON CAST GOT THE VAULT FROM ONE HOOK.** `city/peds.js` calls the
traversal from inside its own `move()`, but the prison's movers are five
separate `group.position.x += …` sites across `entities/npc.js` and
`entities/guards.js`. `systems/actorcollide.js` already runs over the whole cast
every frame right after they move, expressly to stop them walking through
things — so the vault is wired there, and guards + inmates got it with **no edit
to a single mover**.

**THE BUG THAT COST A PROBE ROUND, and it is the interesting one.** First wiring
measured heading/speed from pre-clamp to pre-clamp. That reads **~0 for exactly
the actor this exists for** — a body grinding a table face has its whole step
eaten by the clamp, so the probe never fired (`starts` delta 0 across 19 props,
while `probes` climbed to 279). The reference sample has to be taken AFTER the
clamp, which makes the difference the step the mover TRIED to take. Second bug
in the same call: `probeTraversal` wants a UNIT heading and refuses `dl < 0.5`,
so a raw 0.087 m/frame displacement was refused every time.

**MEASURED** (`tools/mode-engine-check.mjs`, new, seed 90210, escape mode, one
boot, no rendered frames — and it runs BOTH sides, because a probe that passes
before and after proves nothing):

| question | `MODE_CAPS_V1=1` | `=0` (revert) |
|---|---|---|
| waist-high prison colliders the SHARED probe accepts | **3 / 19** (`vault rise=0.85 span=1.24`) | 0 / 19 |
| the player's own `start()` on a prison prop | **`mantle over 0.95m`** | none |
| a HUNTING guard, driven by guards.js's OWN mover | **`vault over 0.85m`** | none |
| RPG blast: of 6 prison cast in the lethal core | **4 dead** (5 reached) | 0 |
| fireball draws landing in the scene | **+117 children** | — |
| `modeCapsAudit().unrouted` | **0** | 0 |
| console errors | 0 | 0 |

3-of-19 is not a miss: the other sixteen are benches jammed against walls whose
LANDING is blocked, and `landingClear` correctly refuses them. Routes resolved:
city→`applyBlastDamage`, escape→`aiKill + capture.hurtPlayer`,
gungame→`gungame.hurt`, survival→`surv.hurtRadius`.

**Ratchet added:** `CBZ.modeCapsAudit().unrouted` — modes declared blast-capable
whose PEOPLE a detonation cannot reach. It RESOLVES the real funnel rather than
reading its own table, so a file dropping out of `index.html` or a mode losing
its damage path pushes it up. **Pinned at 0** in `tools/math-gate.mjs`
(`MATHGATE: ok`, determinism ok, city untouched).

**STILL OPEN, named rather than quietly left** (each is a real finding from this
read, deliberately out of scope):
- `systems/actorcollide.js` clamps the prison cast with `CBZ.collide(pos, r)` —
  **no `feetY`/`headY`**, so every height-banded collider acts full-height for
  guards and inmates. City peds pass their span. 45 banded colliders in
  `src/world/`. Changing it opens paths and needs the owner's eyes, not a number.
- The city-world half of a blast — glass, the facade carve, the walkable breach
  — is still `mode === "city"` by design. A prison wall that can be breached is
  where that gate comes down next.
- `CBZ.npcStepLedge` still has zero consumers. Un-gating it did not fix that;
  only a mover calling it will.

## 2026-08-06 (same day, follow-up) — SHOULD A WALL BREAK? THE CITY ALREADY SAID YES

Owner: *"Should a wall be breakable by explosion? Should holes open up in walls
with explosion. Look it up."*

**LOOKED IT UP. The city has a complete, mature breach system** — not a stub.
`city/buildings.js` `carveHole` is the primitive (hide the wall mesh, splice its
AABB out, rebuild left/right flanks + sill + header as real height-gated
colliders with LOS, dress an inset pocket, a darker back wall, a concrete floor
slab, a glowing ceiling light, blast-shoved furniture, rebar hanging from the
header, and 8–13 jittered concrete prisms merged into one fractured rim).
`city/fracture.js` is the policy: `blastAt` sizes the hole by ordnance class
(RPG/airstrike floors to r≈3.4–4.6, grenade r≈2.2), `chewWall` grinds a murder
hole from 25 rifle-class rounds in one 1.2 m cell, 24 live holes with plywood
eviction of the oldest, coordinate-stable persistence, and an `onHole`
broadcast so multiplayer guests land the same hole. Its own header states the
why: *"an RPG that permanently remodels a bank facade is money ON the wall."*

**I WAS WRONG THIS MORNING AND THE MEASUREMENT SAID SO.** The previous entry
closed with "the city-world half of a blast is still city-gated by design — a
breachable prison wall is where that gate comes down next." The gate was never
the blocker. **Measured** (escape, seed 90210, live colliders):

| `carveHole`'s five filters | prison colliders surviving |
|---|---:|
| total (non-city) | 240 |
| has a `ref` mesh | 214 |
| has a `y0`/`y1` band | **45** |
| band ≥ 1.6 m tall | **8** |
| thinner than 0.9 m | **0** |
| opaque | **0** |

A forced carve on the biggest wall in the block, with the mode gate bypassed,
returned **`REFUSED (no eligible wall collider)`**. Deleting the gate alone
would have shipped a no-op. Meanwhile **73 prison colliders ARE wall-shaped by
geometry** (≥1.6 m tall measured off the mesh, ≤0.9 m thin, opaque) and **0 of
those 73 declare a band** — because `CBZ.addBox` (`world/materials.js:196`)
attaches `y0`/`y1` only when the caller asks, and the prison predates that
contract. `carveHole`'s FIRST test is `c.y1 == null`.

**THE FIX IS THE SAME ONE PHYSICS ALREADY SHIPPED.** `physics.js:338`
`colliderVerticalBand` derives a band off `c.ref`'s Box3 for exactly this case —
*"legacy solid props that predate the y0/y1 collider contract but still carry
the actual Mesh they block with."* `carveHole` now does the same, so 73 prison
walls became carvable with no world-file edits and no new geometry. Same shape
as the vault finding, one layer deeper: **the capability was shared; the DATA
did not meet its contract, and the mode gate was hiding that.**

**THE DESIGN CALL, and it is the whole reason this is not just an un-gating.**
The prison IS the escape game. Doctrine LAW 1 argues hard FOR interior
breaching — the gun room worked because it was locked and it changed your
CATEGORY, and the RPG is hanging on that gun room's wall
(`world/gunroom.js:637`), so key → gun room → RPG → blow your way through the
block is the gun-room grammar chained into itself. But applied to the OUTER wall
it collapses the escape into one verb and orphans the authored gradient the
keycard, the maintenance crawls, the ceiling hatches, the drainage and the
culvert (`world/escape_routes.js`) exist to be. So: **interiors open, the
perimeter holds** — one `noBreach` flag stamped in `world/yard.js`'s `wall()`
helper, which every one of the compound's perimeter segments already goes
through. Delete that line and the prison becomes a jailbreak sandbox; that is
deliberately a one-line decision.

TWO SUB-GATES had to move with `blastAt` or the change would have been a
silent no-op: `drainDefer` (a queue drained by a STRICTER test than the one
that filled it eats every carve) and `chewWall`. And `cityBlastCore`'s
anti-double-carve skip had to be scoped to city mode — it exists because
buildings.js's wrap carves AFTER the core returns, but outside the city
fpsmode detonates through the core precisely to avoid that wrap, so the skip
would have meant no prison wall ever opened.

**MEASURED AFTER** (`tools/mode-engine-check.mjs`, now covering breach; both
sides run):

| question | `MODE_CAPS_V1=1` | `=0` (revert) |
|---|---|---|
| eligible (unflagged, carvable) prison walls | **58** | 58 |
| perimeter segments carrying `noBreach` | **10** | 10 |
| flagged wall vs the same wall unflagged | **`flagged=REFUSED / unflagged=CARVED`** | same |
| RPG on an interior wall opens a hole | **yes** (mesh hidden, AABB spliced out, 5 banded remnants) | no |
| a body can walk through the hole | **yes** (`CBZ.collide` no longer pushes it out) | no |
| perimeter after 3 point-blank rockets | **held** | held |
| console errors | 0 | 0 |

The `flagProof` control matters: the real perimeter is **1 m thick** and
`carveHole` already refuses anything over 0.9 m, so a standing outer wall proves
nothing on its own. Flagging an ELIGIBLE wall and watching it refuse — with the
unflagged carve as the control — is what actually proves the policy works.

`MATHGATE: ok` (329/182/206, 400 ticks, determinism ok) — the city path is
byte-identical; `carveHole`'s declared-band hot path returns the collider
itself, so a city wall never touches the new derivation.

**STILL OPEN:** `fractureBurst` and the ledger `drain()` remain city-gated —
the first has no non-city caller, the second replays a CITY save's hole ledger,
so neither is the same bug. Prison holes are therefore **not persisted across a
run** yet; that needs an escape-side ledger, not a gate change.

## 2026-08-06 (third pass) — "THE RPG RESPONSE IS FAKE, YOU CAN'T WALK THROUGH IT"

Owner: *"You can shoot a window in Gang City and walk through it, but if you
shoot a building with an RPG the response is fake — you can't actually walk
through the building after shooting it with an RPG. Look in real life if you
can do that."*

**REAL LIFE FIRST, because it changes what the right answer even is.** A
shaped-charge (HEAT) RPG round does NOT make a doorway. The copper jet is
focused to defeat armour, so the entry hole is roughly 30 cm or less —
practitioners report never seeing an RPG hole big enough to use as personnel
access. The PG-7VR will punch 1.5 m of reinforced concrete and 2 m of
brickwork, but that is PENETRATION, not an opening. The thermobaric TBG-7V is
smaller still at the wall (30–40 mm) because its job is to inject the fuel-air
cloud inside. What actually makes a man-sized hole is a CONTACT DEMOLITION
CHARGE, and the doctrine is precise about it: against non-reinforced concrete,
2 lb of C4 makes a mousehole, **5 lb makes a hole a man can move through**,
7 lb takes two men abreast. The tactic has a name — **mouse-holing** — and it
is in FM 3-06.11, FM 90-10-1 App M and ATP 3-21.8 App H.

So the physically honest design is: **the RPG punches and wrecks; C4 breaches.**
The game already ships C4 (`city/explosives.js`) with no categorical identity —
this is the verb it has been missing, and it is exactly the LAW-1 "categorical
asymmetry" reward. Recorded as the design option; NOT built this pass.

**THE BUG IS REAL AND SEPARATE, and it is worse than the design question**,
because the game already DRAWS a doorway-sized hole and then refuses passage.
Measured on city lot (-130,-778), RPG at r = 3.94 (the value `fracture.js`
deliberately floors so the wound reads as "a blown-open apartment"):

| what the carve did | value |
|---|---|
| opening WIDTH | **0.50 m** |
| opening bottom | **0.55 m** above the floor |
| neighbours left solid inside the drawn hole | **3**, of which `visible === false` on **3** |
| walk from 2.5 m outside to 2.5 m inside | **blocked at 38%** |

Three independent faults, all in `carveHole`:
1. **The hole is sized to ONE BOX, not to the ordnance.** `gapW` is clamped by
   `len * 0.8` and then `u0/u1` are clamped again to the struck box's own
   extent. A city facade is not one wall, it is a run of SHORT segments — the
   one the rocket struck was 0.6 m long. A 7.9 m blast cut a 0.5 m slit. A body
   is 1.1 m across. **The prison never showed this because its walls are single
   5.5 m boxes** — which is why the escape-mode probe passed that morning while
   the city was broken.
2. **The "no ankle lip" clamp measures against the struck box's own `y0`**, and
   a facade is a stack of courses, so the box starts 0.55 m up with a separate
   SILL course beneath. `STEP_UP` is 0.45, so the player could not step over
   the lip left in the doorway.
3. **`carveHole` removed exactly ONE collider** — the box it struck — leaving
   piers, mullions and sill runs standing inside the hole it had just drawn.
   Three of the four blockers were ALREADY `visible === false`: the repo's own
   named anti-pattern, invisible force fields, sitting in the doorway.

Fixed: the span comes from the ordnance (bounded 9 m, and floored at the old
value so no existing carve can get SMALLER); the opening walks DOWN the courses
directly beneath it to the real floor (max 4 courses / 1.4 m, so a breach two
storeys up is unchanged); and the opening is CLEARED — neighbours wholly inside
are lifted out (and hidden if no other live collider shares their mesh),
neighbours that run past are clipped to the surviving side(s). Every edit is
recorded on the rec and undone by `resetBreaches`. After: **gap 7.88 m, bottom
0.00 m.**

TWO BUGS THE WORK ITSELF INTRODUCED, both caught by instruments, both worth
recording because they are the same species:
- The first clip could produce an **inverted AABB** (`w: -0.13`) when the gap
  swallowed one end — a box whose min exceeds its max, sitting exactly in the
  doorway. Now a survivor under 0.12 m means the collider is removed outright.
- Widening the opening to ordnance size let **a neighbour's carve delete the
  prison perimeter**: the blast cannot carve it directly (1 m thick, over the
  0.9 m limit) but the sweep had no `noBreach` check, so it went out through
  the side door. `tools/mode-engine-check.mjs` failed with "PERIMETER
  BREACHED — the escape game is now one verb" on the first run after the
  change. That is the whole reason that assertion exists.

**WHAT IS NOT PROVEN, stated plainly.** A population probe over 12 eligible
ground-floor walls across 6 lots read **3/12 walk-through BEFORE and 3/12
AFTER**. The change did not move that number, and the number is not
trustworthy either: the failures report `depthIn: -2.42`, i.e. blocked 2.4 m
OUTSIDE the target wall — the probe's start points land inside adjacent
recessed facades. It is measuring probe placement, not the game. The one clean
end-to-end case (a 6.9 m mid-facade wall) walks through both before and after.
So: the three faults above are each measured and fixed, the numbers that
describe the hole moved decisively (0.50 → 7.88 m wide, 0.55 → 0.00 m bottom),
and **the end-to-end "can I now walk into any building I rocket" claim is NOT
established.** The likely remaining obstacle is the building's INTERIOR
structure — full-height `y 0..12.8`, 0.18 m piers sitting ~0.95 m behind the
facade, deliberately outside the sweep's plane tolerance because deleting a
building's structure is not this function's job.

New instrument: **`CBZ.cityBreachAudit()`** publishes what the last carve
actually did (hit point, radius, result, struck band, lip before/after, gap U/V,
cleared + clipped counts). Every number in the table above was reconstructed by
a probe walking a body at the hole; this turns the next "the hole doesn't work"
into one call. Note the trap it exposed: window openings carve constantly, so a
blast-class carve must be selected by radius, not by reading "the last one".

`MATHGATE: ok`, determinism ok. `MODE-ENGINE: ok` both sides.

## 2026-08-06 (fourth pass) — THE CHARGE TABLE: real math as the connective tissue

Owner: *"What we discovered is a math, a real math, that should be put into
Gang City and then put throughout my games — which makes a reason for
connecting the engine to the games."* And then the sharper one: *"the parts of
buildings that FAKE blow up — with enough C4 actually blowing up, or enough
rockets actually opening a man-sized hole. Your research proved it."*

**THE INSIGHT, and it is his.** `systems/modecaps.js` connected the engine to
the scenarios by CAPABILITY. This connects them by FACT — a number that is true
in a prison, a bank and a burning island because it is true in the world. So
`src/systems/breach.js` publishes US Army urban-breaching doctrine (FM 3-06.11
ch.8 · FM 90-10-1 app.M · ATP 3-21.8 app.H) and every game prices itself in
**one unit: pounds of C4.** 2 lb mousehole · **5 lb one man** · 7 lb two
abreast · 10 lb wide breach. The tactic has a name, MOUSE-HOLING, and it is
older than the medium — Stalingrad, 1942.

**CONTACT vs STANDOFF is the other half, and it is what makes the RPG honest
without nerfing it.** A shaped charge PENETRATES (PG-7VR: 1.5 m of reinforced
concrete, 2 m of brick) and leaves a ~30 cm hole nobody walks through; what
opens a wall is explosive touching it. So contact couples at 1.0 and standoff
at `STANDOFF_COUPLING = 0.35` — deliberately generous to the rocket, since a
strict 0.2 would want eleven of them. The ratio IS the design: **the rocket is
the loud way, the charge is the right way.**

**"FAKE BLOW UP" WAS LITERALLY TRUE AND THIS IS THE FIX.** A hit either opened
a wall or did nothing *forever* — `carveHole` refuses anything over 0.9 m
thick, so a wall that refused the first rocket refused the hundredth. Now every
detonation BANKS mass into a world cell (`CBZ.breachDeliver`), the cell
remembers with **no decay** (concrete does not heal), and crossing the 7 lb /
10 lb rows raises `carveHole`'s thickness ceiling so piers go too.

**MEASURED** (`tools/breach-check.mjs`, new; seed 90210; runs city, escape and
the flag-off control):

| | city | escape | `BREACH_TABLE_V1=0` |
|---|---|---|---|
| charge table rows | 2/5/7/10 | 2/5/7/10 | — |
| **one 5 lb brick, contact** | **opens** | **opens** | (pre-existing carve) |
| **rockets to open the same wall** | **7** | **7** | never |
| thick wall refuses a single hit | yes | yes | yes |
| **bricks to open that thick wall** | **2** | **2** | never |
| vault opens at its declared price | 1 brick (branch = 5 lb) | — | never |
| `noBreach` perimeter at **100 lb** | held | held | held |
| console errors | 0 | 0 | 0 |

**THE BUG THE MEASUREMENT CAUGHT, and it is the interesting one.** The ledger
originally ZEROED on a successful carve — "the wall is open, the debt is paid".
A facade is LAYERS, so the first 5 lb opened the thin skin, the counter reset,
and the total could never climb to the rows that raise the thickness ceiling: a
thick pier behind a thin panel was unopenable **at sixty pounds**. Keeping the
running total fixed it in one line (each wall still opens only once via
`carveHole`'s own `_breached`), and it is now a comment in the file so nobody
"tidies" it back.

**THE PROBE'S OWN TWO TRAPS**, both worth the shelf note: it first picked a
wall whose declared band is `y 13.7–15.18` and detonated at a hard-coded 1.4 m,
then reported "a thick wall never opened, even at 60 lb" — a test failure
wearing a code failure's clothes. Select by the DECLARED `y0/y1` and detonate at
that band's mid-height. And the revert control asserted too much: `=0` reverts
to BEFORE `breach.js`, not to "nothing ever carves", because the city's own
blast→structuralBlast chain predates all of this.

**WHAT IT CONNECTS TO, which was the owner's actual question.** A game declares
a defeatable thing in ONE line and the charge never learns what a door is:
`CBZ.registerBreachTarget({id, at, reach, lb, defeat})`. Live today: the
prison's locked yard door at 5 lb — *a second answer beside the keycard*, and
the gun-room grammar chained, because the RPG and the C4 are both on the armory
wall — and every bank vault at branch 5 / count 7 / reserve 10. Charges within
2.5 m fire **together and their masses ADD** (det cord: FM 90-10-1 is explicit
that breaching charges are primed for *simultaneous* detonation), which is how
two bricks open a reserve vault and why a door priced in pounds is a decision
rather than a lookup.

**C4 ITSELF** left city-only: capability-gated like everything else, it now
sticks to PEOPLE through `CBZ.worldActors()` (the same switchboard the blast
damage uses), and a tap with nothing in reach THROWS it along your look arc —
a strict superset of the old drop-at-your-feet.

**THE DETONATOR IS A PHONE APP.** First attempt modelled a clacker box into the
off-hand; the owner: *"Detonator not in hand. It should be on your phone. We
already have a phone code, and it's good."* He was right and the viewmodel was
deleted along with the seam it needed — `city/phone.js` already had the modal,
the card grammar, the click delegation and the key, so DEMOLITION is a card
showing pounds out, bricks left, and **what the nearest target costs**, which is
the shared table made visible in your hand. Hold-[B] stays the fast path and is
the only one inside the wire: a man in a prison yard does not have a phone.

Ratchet: `CBZ.breachAudit().unreachable` — targets priced above the heaviest row
in the table, i.e. a door the player can never open however many charges they
stack. **Pinned at 0**; `targets` also pinned ≥1 so a rebuild that silently
stopped registering shows up. `MATHGATE: ok`, `MODE-ENGINE: ok` both sides,
`BREACH-CHECK: ok` city + escape + revert.

## 2026-08-09 — NO KEYBOARD ⇒ NO KEY LEGEND (the prison, on an iPad)

Owner, playing the prison on an iPad: *"three [places] where it says
keystrokes, like m to open map, space to clear way point. It's like what the
fuck you're doing."*

The reaction is the finding. A key cap on a touchscreen is not a cosmetic
mismatch, because **two of these named the ONLY documented way to do the
thing** — so on a tablet the instruction was not merely wrong, it was a dead
end with no second route to discover:

| site | said | why it was a dead end |
|---|---|---|
| `#fullMapClear` (index.html) | `[Space] clear waypoint` | the map had **no** clear affordance at all |
| `.waypoint-mapkey` | `[M] map` | the arrow is `pointer-events:none` — nothing to tap |
| `#fullMapPlaceHint` | `Click or **right-click** to place a waypoint` | no finger produces a right-click |
| `#dashboard .dhint` | `Tab / L — cycle · **Esc — close**` | the panel had no ✕; closing meant cycling `#dashBtn` through every view |
| title `.controls` card | nine `<span class="kbd">` rows | the prison's **only** how-to-play surface |
| `gunroom.js` padlock | `Hold [E] to saw through it.` | the pill above it already said *Saw the padlock*, in words |

The owner counted three; the sweep found six. `#fullMapClose` was the seventh
and was **already** handled (`"✕ Close"`, 2026-08-04) — which is the tell: the
rule existed and was applied one element at a time, by whoever remembered.

**THE RULE HAS ONE HOME PER SURFACE NOW.** `fullmap.js`'s `keycaps()` owns all
four map sites off a single `CBZ.touchMode` read, and — this is the part the
old one-shot fix got wrong — it runs on `open()` **and** on every `updateGuide()`
tick (8 Hz, compare-before-write), because the waypoint arrow renders without
the map ever having been opened and `touch.js` can raise the latch mid-session.
`dashboard.js`'s `hintHtml()` does the same for the rankings header.

**A LEGEND IS NOT DELETED, IT IS REPLACED BY THE VERB IT WAS STANDING IN FOR.**
Stripping the sentence and leaving no way to clear a waypoint would have read as
fixed and been worse. So the footer legend became a real 44 px chip wired to the
same `clearWaypoint()`, and the rankings header got the ✕ its sentence promised.
Space and Esc are untouched on a keyboard — both routes, one handler.

**MEASURED — `tools/touch-keycap-check.mjs`, 20 assertions, two passes over the
SAME page.** Pass one is a mouse; pass two sets `Emulation.setTouchEmulationEnabled`
+ `setDeviceMetricsOverride({mobile:true})` at 1180×820 and **reloads**, so
`touch.js`'s own `matchMedia("(pointer: coarse)")` line fires `enable()` for
real — a stamped `CBZ.touchMode` would not have reached the `@media (pointer:
coarse)` block where the 44 px floor lives. The scan is a **regex over the
rendered text of every visible node**, not a whitelist of the six ids, so a
seventh legend added later fails here instead of on the owner's iPad. Both
directions are asserted: desktop must still read `[M]`, `[Space]`, `right-click`
and all ten key caps, and Space must still clear.

It earned its keep immediately: `.controls .keys` (0,2,0) outranked a bare
`.keys-touch` hide, so **both grids rendered at once on desktop** and the probe
caught it, not a screenshot.

Flag `MAP_TOUCH_LABELS` (one line, reverts every site — which is why the
`[M] map` tail is dropped inline by `keycaps()` rather than by a CSS rule).
`MATHGATE: ok` · `PRISON-POLISH: 34/34` · `API-LINT: ok`.

**NOT DONE, same bug:** the Gang Life, Disaster Survival and Gun Game title
cards still carry key-cap-only Controls grids. The owner asked about the prison;
those three want the same `.keys-touch` twin.

## 2026-08-09 — THE YARD NEVER STOPPED SWINGING (and the mixer had no hierarchy)

Owner: *"The prison game spams annoying sounds. One very annoying sound… make
the sounds much more intentional."* Then, on the first pass: *"He hears punches
from any distance at the same volume. It's the fact that you can hear it. It's
not muting it."* Then: *"Compare the decibel level in real life of a gumdrop
versus a punch."* Then, decisively: *"The spamming of punches is not a sign of
the audio being as much of a problem, but also maybe the NPCs."*

Four statements, four separate bugs, every one of them real. Full write-up and
sources in `docs/claude/sound.md`; this is the evidence.

**Found in 45 headless seconds, not by listening.** `tools/sound-census.mjs`
boots the real page into the escape run, turns on the F8 sound-review feed
(which already recorded cue + asset + original caller) and counts. Mode
`escape`, player standing still in a cell:

    punch   90.5 requests/min   100% global   src/entities/ai.js:3449

`exchangeBlows` voiced every NPC-vs-NPC blow with a bare `CBZ.sfx("punch")` —
no position — so a fight anywhere in an 84x110 m compound landed at full volume
in the player's skull.

**A sound must have a place.** `CBZ.worldSfx(name, x, z)` is the third surface
beside `sfx` (you did it) and `sfxAt` (it happened to you). It does not reuse
the shared distance curve: that is the *gun* curve, still 84% at 42 m, correct
for a rifle report and absurd for a fist. World foley gets its own near-field
rolloff (half at 8 m, a fifth at 16 m) and is not requested at all below 6%.
One cue is one voice across the whole world, and a closer emitter takes the
voice off a farther one.

**A sound must be worth its loudness.** `tools/sound-loudness.mjs` decodes all
61 bank files in a real browser (the `.ogg` twins — headless Chromium has no
AAC decoder) and measures them. The bank said **a dropped coin at -6.7 dBFS and
a punch at -17.7 dBFS: eleven decibels the wrong way**, against a real-world
gap of thirty decibels in the other direction. And **26 of 33 cues sat above the
master compressor's -12 dBFS threshold**, where 5:1 squashed a gunshot and a
coin to within a couple of dB of each other. Gains are now derived from measured
real-world SPL (3M Noise Navigator, 1700+ measurements) through one documented
mapping, anchored at the loud end so perceived volume does not move. Cues above
the threshold: **26 → 3**. Ratchet: `tools/sound-loudness.mjs --gate`, every cue
within 2 dB of its target, three named exceptions.

**A cue must exist.** `CBZ.sfx("door")` was still called from three sites
including the prison intake, months after `door` was split into
`door_open`/`door_close`. An unmapped cue is a warning and silence — the bars
racking shut on you at booking had not played at all.

**And the sound was the symptom.** The census samples what the world is DOING
beside what it is playing, and the world was doing this:

    124 inmates alive     7.3 of them in `fight` at any instant

Three and a half brawls, running continuously, forever. The root: violence
needed no cause. `findFoe` returned any rival within 8 m, `findBrawlTarget`
returned any man within 9 m, and the wander tick rolled on that every 1.5-4.5 s
per inmate — so the condition for a fight was *being in the yard*, and everyone
is always in the yard. **Not fixed with a cap.** A budget would have been the
same arbitrary violence with a quota on it. A fight now needs what a fight
needs: a REASON (beef, booked per pair by things that already happen — he hit
me, he put my crewmate down, he is standing on our turf, the conversation
turned) and an OPENING (`CBZ.guardWatching`, the guards' own vision cone from
`entities/guards.js` asked about a patch of yard instead of about the player;
`guts` decides how much a man cares he is being watched). Starting a fight
SPENDS the beef; losing one BOOKS fresh beef on the winner, so violence comes
back around later instead of restarting every three seconds. The grudge idea is
not new here — the prison already tracked exactly this against the player
(`n.playerGrudge`, 130 sites) and tracked nothing at all between two inmates.

Measured over a 300 s window, same probe, same seed path:

    fighting inmates   7.3 -> 2.3        blows thrown   90/min -> 31/min

The owner's call on the amount: *"somewhere in between"* — keep the causes,
land between the permanent riot and the near-pacifist yard the first cut
produced. So the numbers that were raised to get there are the ones that say
HOW MUCH REASON IS ENOUGH and how long the yard remembers (grudge decay,
how readily talk sours, how fast a rival on your grass grates), never a
probability of violence and never a quota on it. Two of the four came out of
measurement rather than taste: an argument that does not escalate spreads a
thin film of resentment over the whole yard instead of concentrating on one
pair, and a man with his own grudge does not bolt when you finally swing at
him — without that second one, most "fights" were one man chasing one man who
ran, which is how a yard can throw blows and still not look like it has a
fight in it.

## 2026-08-09 — THE AIRPORT WAS A PLACE; IT IS NOW A RECORD (and two of them fly)

Owner, one paragraph, four asks: *"package the airport so you can just
duplicate and put it somewhere else easily without rewriting that code and put
another airport in another city and then have planes actually actually go up to
the runway, take off, land at the other airport … make it so you can buy a
ticket and get on the plane."*

**THE FAULT WAS COORDINATES, NOT SIZE.** `city/island_airport.js` is 3,977
lines and every one of them is authored in world space — `RWY_X0 = -850 + ADX`,
`gateZ = APRON_Z - 14`, a terminal at `tz = 24`. Nothing in it is wrong and
none of it is reusable: "another airport" against that file is a copy plus
several hundred edited numbers. But an airport does not need world coordinates.
A runway is a LENGTH and a WIDTH. A stand is *185 m along the field, 76 m off
the centreline, nose out*. Those numbers are identical at both fields. **What
differs is one origin and one bearing.**

**`systems/airports.js` — the frame, and only the frame.** Origin = runway
midpoint, local +X down the runway, local +Z the apron side (taxiway 50, stands
76, apron 90, terminal 114, kerb 128). `toWorld/toLocal` use the SAME heading
convention the shipped aircraft already use — forward is `(cos h, 0, -sin h)`,
which is `rotation.y` applied to a hull that noses down local +X — so a local
heading becomes a world heading by ADDING the bearing. That identity is the
whole reason the packaging is cheap, and it was read off island_airport.js's
own parked fleet rather than invented.

**Halloran registers itself** from the same variables its tarmac was drawn
from, so the record cannot drift from the runway and the `worldOff` dial moves
both. `island_airport.js` also now publishes **`CBZ.airportKit`** — three
functions (`airliner` / `jet` / `boardable`) that were locked in its closure.
They stay where the part kit, the cabin and the seat maths live; publishing
them costs three lines and buys every future field the whole aeroplane.

**`city/airport_kit.js`** lays a complete field from a spec — surfaces, merged
markings, one instanced light run, one instanced fence, stands, terminal,
canopy, tower, windsock, kerb, keep-out, L-shaped access causeway — and authors
**no aircraft**. **`city/airport_capeharbor.js` is 95 lines**: one spec, one
call. That is the deliverable the owner asked for, stated as a file length.

**THREE THINGS THE SECOND FIELD TAUGHT US, all found by measuring:**

- **The causeways, not the towns, are the constraint.** Cape Harbor's own
  access deck runs 1,000 m up x=610 from z=-130 to z=875. The field's first two
  placements straddled it — a mini-city's road going straight down a runway.
  The field moved twice; the header now records every neighbour AND every deck
  it clears.
- **A bearing needs its half-turn.** The terminal is always on local +Z, so
  pointing the field the "obvious" way put the kerb on the far side and the
  access causeway had to cross its own runway (measured: the link entered the
  airside keep-out for 148 m and crossed the centreline near lx=31 — a
  `zoneCrossings` failure waiting to happen). `yaw = 0.28 + PI` puts the door
  on the town's side.
- **A road record cannot carry a bearing.** `city.roads` has a `vertical`
  boolean, so a 217 m kerb at 16 degrees drifts 60 m off its own canopy. The
  kit emits a kerb road only when the field is within ~6 degrees of an axis and
  **simply does not** when it is not. Approximating it would have painted a
  lane through the terminal.

**`systems/airline.js` — the aeroplanes actually go.** A shuttle CLAIMS a
parked airliner off a stand (it builds none) and runs doors → taxi via a
connector → **backtrack** → line up → rotate → climb → cruise → descend on the
far field's extended centreline → touch down in the touchdown zone → brake →
taxi in → park → turn round → fly home. **The pilots were already in the
aeroplane**: two `reservedForNpc` cockpit seats npclife casts uniformed bodies
into, held facing forward by island_airport.js's own order-55.2 seat hold — in
a hull that now moves. Hijack it (`rec.taken`) and the flight is cancelled the
same frame.

Altitude is a **closed-form trapezoid of distance**, not an integrated climb
rate: `min(cruise, flown*tan9, toTouchdown*tan5.5)`. It cannot oscillate, cannot
overshoot, lands at exactly zero, and a leg too short for cruise flies a
triangle with nothing special-cased. The fields are 2.2 km apart and a real
A320 needs ~30 km to climb and descend, so the profile is **scale-honest, not
absolute-honest** — the shape is preserved, the magnitudes are the world's.

**Two bugs found by reading before the probe ever ran**, both in the same
family — a sign and a latch:
- `end.sign` meant *the departure direction*, which is opposite for the two
  ends. An aeroplane lined up at the wrong threshold facing off the end of the
  runway. It now means the sign of that threshold's own local x, so
  `sign*(H-25)` reads as "just inside this threshold".
- `beyondFaf` was a distance test. Past the final approach fix the distance to
  it GROWS, so the aeroplane turned round to fly over it again. It is a latch.

**A THIRD AND FOURTH, found by flying it:** the approach had the SAME latch
bug twice. Past the final approach fix the distance to it grows, so the
aeroplane turned round to fly over it again; and the touchdown test was also a
distance, so an aeroplane still 12 m up as it crossed the aiming point flew
past and came round — **measured, 250 sim-seconds orbiting Cape Harbor.** Both
are now committed states, not distances: `onFinal` latches, the profile
commands zero altitude 60 m SHORT of the aiming point to absorb the easing lag,
and the wheels are down the moment you are past the mark measured ALONG the
landing direction.

**And two numbers the world's scale had made wrong**, both found by arithmetic
against the runways that actually exist rather than by watching:
- **Take-off acceleration.** A real 2 m/s2 needs 1,089 m and the longest runway
  in the game is 1,090 — so Halloran was a 99.9%-of-the-concrete departure and
  Cape Harbor's 900 m was an airliner driving into the sea. 4.5 m/s2 puts the
  roll at 484 m, 54% of the SHORTEST field. **This is now a ratchet, not a
  memory**: `airlineAudit().shortFields` re-derives take-off and landing runs
  from the fleet's own constants and checks every registered field, so the next
  airport declared with 400 m of runway fails the gate instead of the sea.
- **The taxi capture radius.** 9 m against a 15.5 m turn circle means the corner
  can never be made: the aeroplane orbited the intersection until the turn-cut
  bled off enough speed to fall inside it, and a 780 m taxi took 240
  sim-seconds — an effective 3.2 m/s. 20 m captures cleanly. A watchdog now
  takes any waypoint that has stopped getting closer for 10 s, because a
  shuttle doing laps of a taxiway is worse than one cutting a corner.

**A THIRD, found by asking what a moving room breaks:** "Exit the airliner"
put the player at `floorAt(doorX, doorZ)` — correct for a hull bolted to a
gate, and a teleport 130 m straight down out of a cruise the moment one flies.
The verb now refuses while the hull is up, and the 0.5 s commit window drops
you at the DOOR with `grounded = false` if an aeroplane rotates inside it. Both
asked of the airframe's own height, never of who is moving it, so they hold for
the next mover too.

**And one the probe found:** Halloran's derived designator came out **36/18**
while its own runway PAINT, drawn waves ago, reads **09/27** — the compass was
missing its +90 (this world's north is +Z, so heading 0 is EAST). A HUD that
contradicts the tarmac under the wheels. Fixed, with `designators` available as
an override for a field whose paint says otherwise.

**`city/ticketing.js` is only the verb** — no geometry, no money, no aeroplane,
no boarding arc. [E] at a check-in counter, `CBZ.city.spend` takes the fare,
the flight **holds its doors** for a ticket (and rolls the seat to the next
departure rather than eating it if you miss), and you board through the shipped
"Board the cabin" option and ride the cabin the whole way. `CBZ.cabinCarry` is
the single new call that tells island_airport.js the room moved: standing you
translate, seated your `_propSeat` anchor re-solves so propuse's order-42 hold
does the work instead of fighting it. **No fade to black and no teleport.**

**MEASURED — the delta, same seed 90210, before vs after:**

    lots/shops    329/182 -> 329/182   (the generator is untouched)
    roads         206     -> 208       (the two causeway legs; the rotated
                                        field correctly declines a kerb road)
    region overlaps     0 -> 0
    road violations     0 -> 0    zoneCrossings 0 -> 0    clamped 0 -> 0
    cabin seats   115/880 -> 141/1106  (+226: the new field's fleet)
    trees           53944 -> 53809     (-135, displaced by the pad)
    determinism        ok -> ok

Ratchets, both **pinned at 0** in `tools/math-gate.mjs`:
`CBZ.airportAudit().malformed` (a field that cannot be flown — no runway, a
frame that does not round-trip, a stand off its own field) and
`CBZ.airlineAudit().stranded` (a shuttle that landed with no stand free — the
way a two-node network silently wedges; Halloran carries two REMOTE STANDS for
exactly this, because four gates with four permanently parked aeroplanes is a
field an arriving flight cannot park at).

**WHAT THE PROBE ACTUALLY MEASURED**, first complete leg, seed 90210:

    phases      boarding -> taxiOut -> lineup -> roll -> air -> rollout -> taxiIn
    peak alt    134 m   (the closed form predicts legD x 0.06 = 134. Exactly.)
    touchdown   local (303, -15) — the aiming point is 300. THREE METRES long.
    crewed      2 of 2 shuttles have bodies in their cockpit seats
    moved       2,081 m, halloran -> capeharbor-air
    stranded    0

That run still FAILED, and on the right thing: it crossed the threshold at
93 m/s instead of 58 and used 248 ticks of sea. The speed schedule was a fixed
bleed rate over a fixed range and the leg was too short to finish it — so it is
now a closed form of distance-to-touchdown like the altitude beside it, which
makes crossing at V_APP a property of the arithmetic on any leg length. The
rollout also brakes as hard as the concrete remaining demands, solved from the
runway actually left: a no-op on a normal landing, and not an option the
simulation keeps open otherwise. And the wheels at 15 m off a 30 m centreline
were ON the paint but on the EDGE of it, so a stabilised final now turns at
2.2x the en-route rate — lining up is the one thing an approach is for.

**AND THE GREEN RUN**, after those three fixes:

    phases      taxiOut -> lineup -> roll -> air -> rollout -> taxiIn -> park -> turn
    peak alt    134 m
    touchdown   local (327, -8) — 27 m past the aiming point, 8 m off a 30 m
                centreline (was 15), at 74 m/s
    rollout     0 ticks off the runway
    result      halloran -> capeharbor-air, 2,021 m, PARKED ON STAND CHR-1
    crewed      2 of 2      stranded 0

    AIRLINE: ok (halloran -> capeharbor-air, peak 134m, stand CHR-1)

One number is still honest debt: the wheels touch at 74 m/s rather than the
58 the schedule aims for, because the aeroplane crosses the aiming point before
the last of the bleed has happened. The adaptive brake absorbs it — 0 ticks off
the paving — but a tighter approach would land it on speed.

New tool: **`tools/airline-check.mjs`** — flies a whole leg headless and
asserts the phase order, the peak altitude, that the wheels touched down inside
the DESTINATION runway rectangle *measured in that runway's own local frame*,
that the rollout never left the paving, and that it parked on a stand belonging
to the other airport. It steps at dt 0.25 — the airline's own per-frame clamp,
so nothing is tested at a step the shipping code refuses — because a full-world
`stepSim` costs ~0.4 s of wall clock whatever dt you hand it.

## 2026-08-09 — THE PRISON HELD 207 MEN AND HAD 26 BUNKS

Owner: *"There's too many fucking people. THINK DONT FIX."*

The second half of that sentence is the whole entry. He had said it before —
`MASS_CROWD` was cut **900 → 140** for the first "way too crowded" — and cutting
it again would have been the third guess at a number that was never answerable
to anything. So: what is the headcount actually made of, and what should decide
it?

**MADE OF FIVE CONSTANTS IN FOUR FILES**, none of which can see the building:
`MASS_CROWD` 140 instanced ambient (config.js) · `JAIL_CROWD` 14 extra rigs
(config.js) · a 30-name `ROSTER` (entities/npc.js) · one resident per cell
(world/cellblock.js) · 12 posts (entities/guards.js). Measured live in escape:
**124 in `CBZ.npcs` + 12 guards, with ~140 instanced bodies behind them.**

**AND THE BUILDING SLEEPS 26.** Thirteen cells, each drawn double-bunked
(`bunkRig` beds the top rack — that is what makes it a bunk). The only housing
in the world was running at about **800% of capacity**. Not "overcrowded":
impossible. There was nowhere for a hundred and eighty of them to lie down.

**A PRISON IS THE ONE PLACE WHERE THIS RATIO IS LITIGATED**, so the number did
not have to be taste. Population is stated against DESIGN CAPACITY: *Brown v.
Plata*, 563 U.S. 493 (2011) found California at ~156k against an 85k design —
about 185% — and the three-judge order capped it at **137.5%**, the
constitutional ceiling. 1.85 is therefore the worst figure a real system has
been made to answer for, and this wing sits there deliberately, because an
overcrowded prison is the setting.

So the headcount stopped being typed and became a subtraction. `world/cellblock.js`
publishes `CBZ.prisonBeds()` — cells × bunks, at the documented occupancy — and
both ANONYMOUS tiers take what is left after the men already on the floor:
`entities/ambientstate.js` for the instanced crowd, `entities/npc.js` for the
extra rigs. Load order makes it exact rather than clever (index.html: cellblock
456 → guards 528 → npc.js 535 → ambientstate 559), so the cast is fully dealt
before anything asks. The NAMED cast is deliberately not trimmed — those men are
the game — and where they overshoot, the answer is a bigger wing, not a shorter
cast. An explicit `CBZ.MASS_CROWD` / `CBZ.JAIL_CROWD` (the Settings slider, the
localStorage override) still wins: an owner overruling the derivation is a
decision, not a drift.

    bodies in a 60° cone within 45 m, same frame     69 -> 20
    instanced ambient tier                          140 -> 0
    live inmates                                    124 -> 50
    occupancy of the wing                          ~800% -> 192%

**THE LEVER IS CELLS, NOT A CONSTANT.** Want a packed yard back? Build a housing
unit — the south block has a chow hall and a dayroom and no beds at all — and
the population follows on its own, everywhere, at once. Ratchet:
`tools/prison-polish-check.mjs` (38 checks) asserts the capacity is published,
the headcount is derived and not typed, no anonymous body is added to a prison
that cannot sleep the men already in it, and occupancy stays inside 200% — past
which the world is no longer describing a prison. It prints the live figure
either way: *192% of design capacity — 50 men, 26 bunks, 12 staff.*

The measurement it was taken with had to move, too: the block first ran at the
END of that suite and read 227%, because by then the suite had spawned test
actors and switched into gungame, whose bots live in `CBZ.npcs`. A population
assertion has to be taken before the suite starts editing the world it means to
measure.

## 2026-08-11 — THE WAR WAS FOUGHT IN A DESERT MADE OF BOXES

**"Put it in gang city with all of gang city's buildings … not the current fake
scene … really massively improve this minigame, and the logic of them — right
now the NPCs can overlap and it's just not perfect"** (owner).

`games/battle.html` is a battle you WATCH, which means every fault that matters
is one you can point at on the screen. So each was turned into an integer first
and fixed second, and `tools/battle-check.mjs` holds all of them at zero across
five maps — two-sided, because `--revert` has to bring them back.

### The ground was the wrong ground

Its `city` map was `studio.world("desert")`: 200 procedural towers on a grid,
standing in for a city this repo ships whole. That is the exact stage flat
games/bomb-survivor.html deleted a wave earlier, in a repo whose studio can
RAISE the real map. Five grounds now, four of them real places at their own
coordinates — `studio.town()` downtown at the mainland's (0,-700), the military
island at (-620,-700), Halloran Field, the desert basin (kept: an open firing
line is a different game), and the kill box (kept as the CONTROL — no world, so
a fault there is the men and not the map).

### 17 041 draw calls, and it was never the town's fault

That is the mainland's own number before `city/mode.js` runs `batchStaticUnder`
+ `freezeStaticUnder`. A slice page never runs city/mode.js, so it never ran
them. Neither `core/batch.js` nor `core/staticfreeze.js` reads a city record;
they were simply behind a door only the full engine had a key to. New studio
pack **`batch`**, one verb **`CBZ.studio.settle(root)`** — merge, then freeze,
in that order, after the ground and BEFORE the actors, because anything added
afterwards keeps its own live matrix and that is what keeps the men animated.

    draw calls, one real downtown      17 041 -> 817

A/B captured both ways at three camera ranges: visually identical. bomb-survivor
adopted it in the same wave.

### A man is not a pathfinder, and in a city that is not survivable

First build on the real fabric, measured: **25 of 40 men in slot `push`**, their
`cool` at −28 s, both armies 135 m apart with eight blocks of masonry between
them, **5 shots in 30 seconds**. The wall-slide detour is the right instinct for
a crate and hopeless against a city block — walk into the Exchange Bank, slide
1.5 s along the facade, turn back into it, repeat until the clock runs out.

The ground now carries a **multi-source flow field**: 4 m cells (a 15 m street
is three of them wide, a 490 m town is 22 500), Dial's bucket queue, re-solved
every 1.4 s per side and staggered so two solves never land in one sub-step.
Seed Dijkstra from EVERY living enemy at once and the field is *path distance to
the nearest enemy*, so one solve steers each man toward whoever is genuinely
closest THROUGH the streets. Seeding from a centre of mass instead funnels an
army into a single point — that was the first draft, and the corner-bunching was
in the measurement. Only the SENIOR man of a squad navigates; the column trails
his heading, so a squad rounds a block as a squad instead of coming apart on the
first corner.

    men in `push`, real downtown        25 -> 1
    men with a mark they can SEE         0 -> 20+
    shots in the first 30 s              5 -> 300+

### The overlap was a cell size

Separation ran on the TARGET-SEARCH grid, and the two jobs want opposite cells:
target search wants cells big enough that a 175 m look is a handful of lookups,
separation wants cells at BODY scale. On 14 m cells it could only be wrong in
three ways, and it was all three:

  * it never compared across a cell boundary, so two men 0.2 m apart on opposite
    sides of an invisible line interpenetrated forever;
  * it capped the inner loop at five neighbours (`i + 6`) — and *which* five
    depended on spawn order;
  * it fired at 1.0 m, which for a 0.52 m body is contact, not clearance.

Bodies got their own grid at 2.4 m, rebuilt every sub-step (a stale body grid is
exactly what lets two men swap cells and stop seeing each other), swept as
cell + four FORWARD neighbours so every pair is visited exactly once, clearance
0.9 m. A deep overlap — inside shoulder width — is corrected in FULL that step
rather than sprung apart over several, because relaxation is right for a crowd
easing itself out and wrong for two bodies already inside each other. Every
shove marks both men for a collider re-resolve: a body squeezed into a crate is
invisible to every ray, therefore immortal, therefore a battle that cannot end.

### One round in five was a ghost bullet

Measured: **167 of 776 rounds** fired down a lane one of the shooter's own men
was standing in. Because a friendly round in this game passes through a friendly
body, the result was not fratricide — it was rounds going through your own
people, which is worse to watch than a friendly-fire kill and impossible to
read. The trigger now asks two questions with FRESH answers, once the cooldown
has already expired so it costs about one segment trace per shot:

  * **is the line clear** — `m.sees` is a think-tick answer up to half a second
    old about two men who have both been moving since, and stale LOS is how
    rounds got fired into a wall that closed in between (2 of them in the kill
    box; it is the walls that move the count, not the men);
  * **is one of mine in it** — and if so he does not hold fire and do nothing,
    he **steps off the line**, away from the mate's side, because moving a
    shoulder-width perpendicular grows the mate's offset from the new line by
    (1 − along/d) of the step. He keeps his mark the whole time.

    rounds through a mate      167/776  ->  0
    rounds at an unseen mark         2  ->  0

### The rest of it

Targets are picked LOS-first (the nearest man is not the man you can shoot — on
sand those are the same sentence, and in a city they are not). Nobody spawns
inside a building: a golden-angle spiral to the nearest free point, and in a
town the two sides form up in the outermost streets off `town.roads` and walk
in. The spectator camera shortens its arm instead of parking inside the Exchange
Bank — it SNAPS in and eases out, so a pillar does not make the shot pump.
`ch.crouch`, the rig's own flag, had never once been set by anything, so
combat_iq could send a soldier to real cover and he would stand up straight
behind it. Each map got its own sky, because one desert haze over a glass
downtown washed the streets to paper.

### `airport` needed `citycore` and did not say so

The terminal is a real shell — island_airport.js calls `cityMakeBuilding` to
raise it — so a page naming `airport` alone got `[studio.raise] airport
TypeError: CBZ.cityMakeBuilding is not a function` and an airfield with no
terminal on it. bomb-survivor never saw it because it happens to name citycore
for its own downtown, which is exactly how an under-declared dependency hides.
Found by the new `field` map on the first sweep.

### The load was contractually serial and accidentally slow

`studio.need()` executes one file at a time and must: several throw if loaded
early, and the addLandmass stamp depends on exactly one script being in flight.
But awaiting each file also DOWNLOADED them one at a time, so a page naming ten
packs paid ten round trips before its first line ran. `warm(files)` /
`prefetch(...packs)` emit `<link rel=preload as=script>`, which fills the HTTP
cache without executing anything — downloads go wide, execution order is
untouched. The armoury (fourteen files, none of which registers a landmass)
additionally goes in as one batch of `async=false` tags, the spec's
execute-in-order list. `onProgress(cb)` reports each file so the page draws a
real bar instead of three words, and the menu warms a map on hover so START is
a build and not a download.

    time to READY, 40 ms per request      4.04 s -> 3.13 s   (911 ms)

911 ms against 23 round trips at 40 ms is 920 ms. The mechanism is not inferred.

### The instrument

`tools/battle-check.mjs` boots the page per map, runs the war, and reads
`window.__battle.quality()` — an O(n²) pass on purpose, because the grid is the
thing under test and the check must not share its blind spots. `overlapPeak` ·
`embedded` · `blindFire` · `throughMate` · `stuck` all pinned at 0.
`--revert` (`?sep=old&fire=old`) asserts they come back: 3 overlapping pairs and
214 ghost rounds. A fix nobody can turn off has not been measured.

## 2026-08-12 — THERE WAS ONE SEAT IN A CAR AND IT WAS THE DRIVER'S

Owner: *"When in vehicles in gang city like boat plane car etc on desktop a
button should move me to passenger and same with touch and then if I go to the
door I can eve jump out etc."*

Two sentences, and both of them name the same shape of fault: the vehicle had a
cabin full of chairs and exactly one of them was reachable.

### The other seat existed, for everybody except you

`cityEnterVehicle` sets `P.driving`; vehicles.js's CAR_DRIVER_VISIBLE block
seats the player's real dressed rig at `+ci.seatX` and animates it; boarding.js
walks companions, hostages and cuffed captives to the other three chairs and
seats them where you can see them through the glass. `carCabinInfo` has
published `seatX` — the seat HALF-TRACK, i.e. the distance either side of the
centreline — since the cabin wave. Nothing had to be built to sit in the
passenger seat; a sign had to be flipped.

    seat solve            +ci.seatX  ->  -ci.seatX      (seatSideX)
    hands on the wheel    driveSteer eases to 0, because there is no wheel

The controls are the other half, and they are not gated in four places. The
driving loop reads its keys out of a **frozen empty object**, so `k["w"]`,
`k["s"]`, `k["a"]`, `k["d"]` and `k[" "]` are all false and the car runs the
coast-and-friction branch it already owns for a driver who is touching nothing.
Nobody is driving, so it rolls to a stop. That is not a special case, it is the
arithmetic. `water_helm.js`'s hull loop takes the same empty bag in one line.
The player stays `P.driving` with the same `P._vehicle` throughout, so the
camera, the HUD, the minimap, the fuel burn, the audio, the damage stager and
every exit path keep believing exactly what they already believed.

### Getting out was a parking manoeuvre

`cityExitVehicle` reads, in order, `car.v = 0; car.vx = car.vz = 0` and then
stands you 1.6 m off the driver's flank. **Measured before this wave:** a
Ferrari at 26 m/s, one press of the step-out verb —

    car speed after the exit    0.00 m/s     distance it then travelled   0.0 m
    player damage                    0       player airborne              no

— the car stationary on the same frame, the player standing beside it unhurt.
That is a handbrake with a teleport attached, and it is why the second half of
the ask was impossible. Both halves of a real jump already shipped, in two
places nobody had connected:

  * **the body** — `CBZ.body.fling` (systems/grapple.js) is the shared launch a
    blast, a throw and a disaster all use. It sets `_phys.air`, and from that
    frame systems/physics.js owns the body: it integrates the tumble, lands it,
    and pins `_phys.down` so you lie there before getting up. We choose a
    direction (the car's own velocity, plus outward through the door) and a
    force, and write nothing else.
  * **the car** — vehicles.js's AI loop has had a driverless-motion path since
    the day a cop could shoot a driver at the wheel: `wreckT` bleeds speed,
    slides real lateral momentum against the real surface, collides with
    buildings, crumples on a hard hit and settles as abandoned.

The second one was locked behind `c.ai && c.road`, and **a car you have been
driving has neither** — driving clears the AI flag and promotion clears the
lane. So the whole path was unreachable from the one situation that most wanted
it. `_runaway` opens that same branch to a car whose driver simply left, with a
coast decay of 0.62/s instead of a spin-out's 0.04/s scrub, because nothing hit
it. Measured after: **left at 26 m/s, ran 37.8 m on its own in two and a half
seconds; and with the player merely riding rather than jumping, a car set
rolling at 22 m/s covered 124.7 m and stopped at exactly 0.**

    speed the car kept   0 -> 26 m/s     ground it covered in 2.5 s   0 -> 37.8 m

Below walking pace (2.4 m/s) the same verb is the ordinary step-out, undamaged,
and a passenger steps out onto the kerb rather than through the driver — the
exit offset is mirrored by the same sign the seat is. The door swings open as
you go through it: boarding.js's own leaf, posed through a seam it already
sweeps, so *"a car door is only ever open because somebody is going through it"*
stays structurally true rather than becoming a promise.

### The verb was routed, not wrapped

`cityExitVehicle` is also how a mission, a chop shop, a sold car, a drowned
engine and a death put you on the pavement, and none of those is you deciding
to throw yourself out of a moving door. So the split lives on the INPUT paths —
`cityTryNearestRide` (the [E]/[F] router), the touch EXIT pill and the interact
row all call `CBZ.cityVehicleGetOut()` — and every programmatic caller keeps the
exit it has always had.

### "Have them run it to the warehouse" put you on the kerb

boarding.js's companion errand opened with `cityExitVehicle()`: it threw you out
and drove off with your money. It now slides you into the shotgun seat, which is
what handing somebody the keys has always meant. Its driver loop then becomes
the only integrator on that car — vehicles.js's player loop stands down for the
frame (`cityPaxChauffeured`) rather than moving the car twice — and the
passenger file re-seats the rig, the player position and the camera behind it.

### [G], because it was already dead in this seat

The doctrine is that verbs live in the interaction registry, and the registry
deliberately shows no card while you are in a vehicle (`SILENT_RIDE`) — a ride
is a thing you press E to take, not a menu. So an in-vehicle toggle is a key,
exactly as [C] cycles the body style and [V] swaps to the driver's-seat view.
[G] is the one letter already dead in this seat **by design rather than by
luck**: city/combat.js's grenade throw refuses outright while
`CBZ.player.driving`, which covers cars, boats and aircraft alike. On touch it
is a SEAT pill in the drive/boat sets and a whole context of its own — TAKE THE
WHEEL / JUMP OUT — once you are riding, because a thumb column with GAS, BRAKE,
LEFT and RIGHT on it while nobody is driving is four buttons that lie. The EXIT
pill repaints itself JUMP OUT above walking pace, so the button says which of
the two things it is about to do.

### The aircraft gap is declared, not faked

A plane is not a `P._vehicle`; it is `P._aircraft`, flown by playeraircraft.js,
and its passenger deck is a different already-built thing — `CBZ.vehicleHold`'s
walk-in room and island_airport's cabin seats, which ticketing.js already rides
you across the map in. Leaving the controls in the air is bailout.js's subject
and it answers it well (the graveyard spiral, or *"someone else has the
controls"* when there is a crew). Wiring a ride-in-the-cabin state to a machine
the player is flying is that file's wave, not this one's. `PAX_AIRCRAFT` is
declared and OFF, the button says so out loud, and the audit reports it —
FORT_CONVOY's precedent.

### The instrument

`tools/passenger-check.mjs` boots headless once and drives the real sim with
`CBZ.stepSim`. The ratchet is `ghostThrottle`: frames on which the player was a
passenger, with nobody at the wheel, and the vehicle GAINED speed anyway. A dead
keyboard that is not actually dead is the entire failure mode of doing this with
a sign instead of a mode, so it is measured directly and pinned at **0** — from
the audit's own counter and again from outside, against measured speed.
`orphanRides` is pinned at 0. `--revert` (`?cfg_PASSENGER_SEAT_V1=0`) asserts
the old world comes back: the seat verb refuses, holding W drives the car, and
stepping out at speed parks it on the spot.
