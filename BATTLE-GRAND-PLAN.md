# BATTLE GRAND PLAN — chain of command, beasts, water, and every asset Gang City owns

> **STATUS (2026-08-13, owner redirect):** Phase BEASTS shipped FIRST and is
> live — bestiary/beasts studio packs, the wildlife_rig extraction, the
> gorilla and the dog, beast armies + matchup presets in battle.html, unarmed
> men, and the wall-aware goal projection (the honest slice of "smarter").
> The command hierarchy / generals / intel / banners are ON ICE by owner
> instruction until those roles exist in Gang City proper — no command
> theater, no HUD popups standing in for intelligence. Water/boats/vehicles
> phases remain as planned below, unstarted.

*(games/battle.html — analysis 2026-08-13, written before the build wave so the
build wave has a map. The owner's ask, verbatim where it matters: "make the
npcs significantly smarter and actually have a chain of command and actually go
in groups and flank and sneak", "bringing in the animals from gang city and
allowing water as a battle area and boats and every vehicle", "I can decide any
thing to give to each army and its used naturally", "100 lions vs 1000 dogs or
100 bears or orcas vs sharks or unarmed men vs bears… with our actual assets
animated in a real simulation not math". And the standing constraint: "RN THEY
KINDA BRILLIANTLY CHASE AND RETREAT WHICH IS THE COOLEST THING" — do not lose
it.)*

---

## 1. WHAT IS TRUE TODAY

### The page is already standing on the right foundation

- **The men are shared engine, not page code.** studio.cast rigs, combat_iq.js
  fire discipline (fire tokens, real collider cover, suppression, bearing
  slots, per-training reaction/settle, the DPS ladder), actorweapons/gunfx,
  deathPose, weaponPhysics. The page owns only orchestration.
- **The grounds are real Gang City venues**, raised and *measured*
  (heightfield), not stage flats. Nine maps already ship, four of them coastal
  with a sea plate.
- **Navigation macro layer exists**: a multi-source Dijkstra flow field per
  team ("path distance to the nearest enemy", 4 m cells, solved ~1.4 s) plus
  senior-man column marching. Squads-of-10 exist as spawn groups.
- **The determinism law and the quality ratchet are live**: seeded streams,
  `window.__battle.quality()/audit()`, `tools/battle-check.mjs`, and one-line
  revert switches (`?sep=old`, `?fire=old`, `?warm=0`).

### Where the beloved chase-and-retreat actually comes from

Three interlocking per-man rules, none of them a "retreat feature" — this is
the emergent gold and every layer below must *modulate* it, never replace it:

1. combat_iq posture(): below a man's `nerve` fraction he stops trading and
   breaks for cover, or `fallback`s 9 m when there is none.
2. stepMan speed table: `fallback` runs 5.2 while pursuers close at 6.4–8.0 —
   wounded men are visibly run down.
3. `HUNT`: at 8:1 alive-ratio the big side ignores fire bands and sprints
   (8.0) — the mob-runs-down-the-holdouts ending that *ends* battles.

The new command layer will generalize this (organized withdrawals, routs,
rallies, pursuit orders) — same physics, more structure, more drama.

### Why they still run into walls — three root causes, read off the code

1. **The flow field only steers UNENGAGED men.** think() consults navStep only
   in the no-target march branch and the `losBadT > 2.6` push branch. The
   moment a man is engaged, his goal comes from combat_iq posture(): bearing
   slots and distance bands computed as *straight-line geometry around the
   mark with zero knowledge of walls*. In a city a bearing slot routinely
   lands on the far side of a building; the man presses into masonry,
   wall-slides, detours 90° for 1.5 s, presses again. The fix is structural,
   not more detour: **every tactical goal must be projected onto reachable
   space** before it is steered at.
2. **pickTarget's last resort is "nobody visible: take the nearest and go to
   him"** — a facade assault by construction until the 7 s dead-end timer
   gives up.
3. **Squads dissolve on first contact.** Column-follow exists only while
   `!m.tgt`; contact = N independent duels. There is no base-of-fire element,
   no bounding, no unit flank, no rally — so nothing above one man's radius
   ever looks *intended*.

### What Gang City already ships that this page is not using

- **The bestiary: 53 species** in `city/wildlife_species.js` +
  `city/wildlife/*.js` (lion, white lion, tiger, cheetah, snow leopard, gray/
  arctic wolf, coyote, black/brown/polar bear, bison, elephant, rhino, giraffe,
  zebra, moose, elk, boar, horse, cow… and the sea: great white, hammerhead,
  bull shark, orca, humpback, dolphin, marlin, manta, **megalodon**). Every
  build() needs only `{THREE, mat, rng}` + `CBZ.boxGeom` — i.e. the `look`
  pack. Stats already authored per species: `hp, spd, danger, bite, herd,
  scale, aquatic` — **the sim should derive unit stats from the bestiary, not
  invent them.** (This is the dogfood: the battle becomes a test harness for
  Gang City's own data.)
- **Animal animation exists and is discovery-based**: `buildGaitRig`/
  `gaitAnimate` (wildlife.js) find legs/head geometrically — the 54th species
  animates for free; `creature_combat.js` (`CBZ.creatureFight`) is the shared
  medium-agnostic strike driver (lunge/pounce/maul/gore/stomp, flinch, restY,
  an `opts.move` locomotion seam); `predator_anim.js` adds maw/rear/swat;
  `wildlife_shark.js` contributes the fin + shadow proxies.
- **Boats**: `world/water_hulls.js` (marine hull registry + fleet models),
  `water_helm.js` (real hull physics), `water_buoyancy.js`, waterfield. Player
  grade; an NPC helm is a thin AI-inputs wrapper away.
- **Vehicles**: milModels/strategicModels/airbase — tank, truck, heli, fighter,
  cargo, B-2 (bombers already fly in this page); civilian fleet in
  playercars.js.
- **Combat services**: `IQ.melee` (the punch exchange — unarmed men are
  already a supported fighter class!), ordnance, boom/collapse.

**The one true integration gap**: none of the animal/boat/creature files are
in a studio pack, and the gait rig lives inside the engine-bound 3,700-line
wildlife.js. That is the seam to cut — a couple of pack rows and one BLOCK-LAW
extraction, not a rewrite.

---

## 2. THE DESIGN — A CHAIN OF COMMAND THAT YOU CAN WATCH

Hierarchy: **Army (one general) → platoons (~3–4 squads) → squads (8–12 men)
→ men.** Squads are formalized at spawn (leader = highest-training/lowest
index), persist through contact, and are THE unit of maneuver. Animals map
onto the same shape (a pride, a pack, a herd = a squad with species
parameters), so the command layer is written once.

### 2.1 Orders (a tiny data grammar, not a planner)

`{kind, at/axis, until}` with kinds: `advance, assault, holdLine, overwatch,
flankLeft, flankRight, infiltrate, fallback, rally, screen, pursue, embark,
dismount`. Squads execute orders; men keep combat_iq. That's the whole
vocabulary — everything below is who writes these and how they're executed.

### 2.2 The general (2–4 s tick, per army)

- **Fights on intel, not omniscience** (see 2.5): plans against *known*
  contacts only. Flanking and sneaking are only meaningful if the enemy can
  genuinely not know where you are.
- Reads a coarse influence map (downsampled from the existing NAV grid +
  shotsRing): friendly mass, known enemy mass, fire density.
- Picks a plan by force ratio and ground, from a small deck:
  **pin + envelop** (default: base-of-fire platoons fix the enemy front,
  maneuver platoons take a threat-avoiding route around a flank),
  **line advance**, **defend** (anchor squads on real cover/chokepoints),
  **infiltrate** (elite squads sneak to ambush positions before H-hour),
  **mass assault**, **fighting withdrawal** (losing badly: rear-guard
  overwatch while the rest bound backwards to a rally point — the beloved
  retreat, now organized), **pursuit** (absorbs today's HUNT ratio rule and
  its battle-ending guarantee).
- Succession: general dies → army-wide morale shock + senior lieutenant
  promotes after a beat. Decapitation becomes a real, watchable strategy.

### 2.3 The squad brain (1–2 s tick, per squad — this is the workhorse)

- **Formations**: column (march), wedge (approach), line (assault/overwatch).
  Slot goals = leader position × formation matrix, **projected onto walkable
  NAV cells** (kills wall-running cause #1 for followers).
- **Fire & maneuver**: squad splits into two fireteams. On contact team A
  goes overwatch — combat_iq's fire tokens and `_iqCovering` recycle-shortening
  already implement genuine covering fire — while team B bounds 15–25 m
  cover-to-cover (IQ.cover supplies the cover points), then swap. This single
  behavior is what makes them read as soldiers.
- **Flank routes**: leader runs A* on the existing 4 m NAV grid with cost =
  distance + w·threat (threat rasterized from known contacts + recent fire,
  decayed). Re-planned on a 3–5 s tick, followers ride formation slots. Routes
  naturally hug back streets and dead ground — real-looking flanks with no
  scripting. (10–40 leaders × a 22k-cell grid on a slow tick is cheap.)
- **Leader succession**: sergeant dies → brief leaderless disorder (morale
  hit, scatter beat) → next man promotes, column reforms. Readable drama.
- **Engaged-goal projection**: posture()'s bearing/band goals get one added
  test — unreachable or wall-embedded goals resolve through navStep toward
  the goal instead of straight at it (kills wall-running cause #1 for
  fighters; pickTarget's blind "go to him" routes the same way, killing #2).

### 2.4 Morale (squad-level, generalizing per-man nerve)

Starts from training tier; drops on casualties (leader deaths ×2, rapid
losses ×2), heavy suppression, being flanked; recovers in cover, near the
leader, when winning. Break → **rout** (drop order, flee on the away-field —
existing speed rules make the pursuit cinematic) → **rally** after a cooldown
at the rally point → re-enter as a shaken unit. 1000 dogs vs 100 lions is
interesting *because* of this layer: waves that break, re-mass, and come back.

### 2.5 Intel & stealth (small bespoke model; jail detection.js is
player-shaped and not reusable)

- Per team: a **known-contacts map** {pos, t, confidence}, written when any
  friendly has LOS within a detect radius, decayed over ~10–20 s into ghost
  markers ("last seen").
- Detect radius is modified by the target's state: sprinting ≫ walking ≫
  **sneaking** (crouched, ~2.2 m/s). Firing = instant reveal + long memory.
- `infiltrate` order = crouch (the rig's `char.crouch` already renders it) +
  slow + high threat-weight pathing + hold fire until detected, fired on, or
  inside ambush range. Ambush = the whole squad opens up on one beat.
- pickTarget consults own-LOS candidates first (as today), then team known
  contacts — omniscience removed behind a `?intel=old` revert switch.

### 2.6 Legibility — intelligence you can't read looks random

This is a battle you WATCH, so command must be visible:
- Officers visibly distinct (cap/armband tint via existing cast options; the
  general gets a pennant).
- Banners on the big beats (the channel already exists): "RED COMMITS THE
  RESERVE", "BLUE LEFT FLANK BREAKS", "GENERAL DOWN — 2ND TAKES COMMAND".
- Director camera learns command moments: cut to a flanking squad as it turns
  the corner, the rout as it breaks, the general when he falls.
- Optional command overlay (key T): objective arrows and squad-status pips
  drawn with the existing trail/line helpers. Off by default.

---

## 3. THE BEASTS OF GANG CITY

### 3.1 Integration (the small seam, cut the repo's way)

- **New studio pack `bestiary`** — files: `city/wildlife_species.js` +
  `city/wildlife/*.js` (10 files). needs: `look`. publishes:
  `WILDLIFE_SPECIES`, `defineSpecies`. Zero new art; 53 species arrive.
- **New pack `beasts`** — files: `city/creature_combat.js`,
  `systems/predator_anim.js`. needs: `boot, look`. publishes:
  `creatureFight`. (Shim `CBZ.floorAt` → `MAP.groundAt` on the page, exactly
  like the `queryCollidersNear` shim battle.html already does.)
- **BLOCK-LAW extraction**: `buildGaitRig` / `gaitAnimate` (+ swim rig +
  `faceAnimalHeading`) move from wildlife.js into a shared
  `city/wildlife_rig.js`; wildlife.js keeps calling them verbatim. Consumers:
  wildlife.js, battle.html, arena_fights' beast pit ≥ 3. This is the only
  engine surgery in the whole plan.
- **Add the gorilla** (one ~30-line build(): silverback, knuckle stance) —
  smallest possible art job, unlocks the viral matchup by name: **100 MEN VS
  1 GORILLA**, with our actual assets, animated, not math.

### 3.2 Animals as units

A species row IS a unit archetype: hp from `sp.hp`, speed from `sp.spd`
(battle-scaled), melee damage from `sp.bite`, charge/aggression from
`sp.danger`, cohesion from `herd`, size from `scale`. The squad layer runs
them with species presets:

- **Pack hunters** (wolves, dogs, lions, hyena-tier): bearing-slot
  encirclement (the same slot math combat_iq uses for men — predator.js's own
  header blesses the mirroring), probing rushes, break-and-re-mass morale.
  Lions get `infiltrate` as stalking: crouch-walk in, burst charge at ~25 m.
- **Shock beasts** (bears, rhino, elephant, gorilla, moose): near-unbreakable
  morale, charge → creatureFight maul/gore/stomp; men's squad morale takes
  bonus damage from being mauled (terror is the mechanic that makes 100 v 1
  interesting).
- **Herds** (bison, zebra, caribou): line stampede charges, brittle morale,
  wheeling flight — gorgeous at 500+.
- **Snakes** stay ambient-tier (skip as army units, or novelty only).
- Melee resolution: `creatureFight(attacker, target, dt, {move, onHit})`
  animates the strike and lands damage through the existing hurtMan funnel;
  flinches/topples on the receiving side. Men fight back with rifles — or
  with `IQ.melee` fists: **unarmed men vs bears is already a supported
  fighter class**, zero new combat code.

---

## 4. WATER, BOATS, VEHICLES — EVERY ASSET AN ARMY CAN BE GIVEN

### 4.1 Water as a battle space

- Per-map `waterAt(x,z)` (sea-plate y vs measured ground): wade to chest
  depth, then swim (slow, pistols only) — men can cross water, badly, which
  is exactly the tactical texture beach assaults need.
- **New venue "THE STRAIT"**: open water + a shore strip on each side (and a
  pure-blue variant for all-aquatic battles). Aquatic species constrained to
  water, land species to land, amphibians (polar bear) cross.
- Aquatic units: swim rig + fin/shadow proxies; orca pods and shark packs run
  the same pack-hunter squad brain with a 3D-ish depth cheat (surface for the
  strike — the fin line closing on a swimming man is the shot that sells it).
  **ORCAS VS SHARKS** and **MEGALODON VS THE FLEET** become menu rows.

### 4.2 Boats

- NPC helm: a thin arcade driver over the marineHulls fleet (target point,
  turn rate, throttle, wake FX) — full water_helm physics is player-grade and
  not needed for war boats; keep the door open to it.
- Boats are squad carriers with `embark/dismount`: landing-craft assaults on
  island/harbor/marina maps; deck gunners fire under combat_iq with a
  stability accuracy penalty. Aquatic predators can bump/breach hulls.

### 4.3 Land vehicles & air

- **Truck/APC**: carries a squad, drives the flow field with a turn-radius
  constraint, dismounts at the drop point (order grammar already has it).
- **Tank**: slow turret, cannon = ordnance shell through studio.boom (already
  collapses real buildings), MG for infantry; infantry screens it; bazooka
  men (already in the armoury) are the counter.
- **Heli gunship**: simple hover driver (airframe is fixed-wing; heli gets a
  position/bank hover loop) + door gunners.
- **Fighter strafing runs**: the proven bomber racetrack logic with guns.
- Bombers/nukes already work — they become roster rows like everything else.

---

## 5. THE COMPOSER — "I CAN DECIDE ANYTHING TO GIVE TO EACH ARMY"

Replace per-team {count, weapon, training} with a **roster builder**: each
side = a list of contingents `[{archetype, count, options}]` where archetype ∈
infantry (training × weapon, incl. UNARMED) ∪ bestiary species ∪ vehicles
(tank/truck/heli/boat) ∪ air support. URL-serialized (determinism law —
shareable battle links reproduce exactly). NO CAP stays; FIND MY MAX learns
to census mixed rosters.

Preset rows for the memes (one tap each): `100 MEN VS 1 GORILLA` ·
`100 LIONS VS 1000 DOGS` · `UNARMED MEN VS 10 BEARS` · `ORCAS VS SHARKS` ·
`BEACH LANDING` (boats + defenders) · `ARMORED COLUMN` · `WOLVES VS THE
GARRISON`.

---

## 6. LAWS, PERF, RATCHETS (how this ships without rotting)

- **Perf shape**: command ticks are per-squad/per-army (tens, not thousands);
  A* on 22k cells per leader on slow ticks; detection LOS on a budgeted,
  staggered tick; creatureFight only for engaged animals; gait writes LOD-
  skipped like animChar already is. Nothing new runs per-man-per-frame.
- **Never fork combat_iq** — it stays the per-man brain; the squad layer only
  writes orders/targets above it. Any needed hooks (sneak accuracy, species
  bearing radii) are additive parameters.
- **Revert switches** per layer, matching house style: `?cmd=old` (whole
  command layer), `?intel=old` (omniscient targeting), `?beasts=0`,
  `?water=0`.
- **Ratchet extensions**: QUAL gains `wallSeconds` (cumulative stuckT — the
  wall-running metric held at ~0), `ordersLive`, `routsRallied`,
  `sneakDetectedEarly`; audit() reports command/intel state;
  battle-check.mjs learns mixed-roster runs (`?preset=lions-dogs` etc.).
- **Determinism**: all command decisions roll on seeded streams; same URL,
  same war.

---

## 7. EXECUTION ORDER (each phase independently shippable)

1. **COMMAND** — squads persist through contact; ranks + succession; fire &
   maneuver; threat-weighted flank A*; goal projection onto nav (kills
   wall-running); morale/rout/rally; intel + sneak; legibility (officers,
   banners, director beats). *The "significantly smarter" core.*
2. **BEASTS** — bestiary/beasts packs; gait-rig extraction; species → unit
   mapping; pack/shock/herd presets; gorilla; unarmed men; meme presets.
3. **WATER & BOATS** — waterAt + swimming; THE STRAIT; NPC helm; landing
   craft; aquatic predator packs.
4. **VEHICLES & AIR** — APC dismounts, tanks, heli hover driver, strafing
   runs; combined-arms plans in the general's deck (armor spearhead +
   infantry screen + air on the breakthrough).

Phase 1 is the prerequisite for everything reading as intelligent; 2 is the
biggest spectacle-per-line; 3 and 4 are additive and independent.

---

## 8. DECISIONS TAKEN (so the build wave doesn't re-litigate)

- Squad layer is authored in battle.html (page-owned orchestration) with the
  explicit intent to extract to `systems/warcommand.js` the day a second
  consumer (gang wars, militia) wants it — same rule marina/gunfx followed.
- Keep flow fields + add leader A*; no navmesh. The 4 m grid is proven here.
- Detection is bespoke and tiny; jail heat/wanted is not the same problem.
- creatureFight is the one melee resolver for animals; IQ.melee for humans;
  no third fist.
- HUNT survives as the pursuit order's trigger — the battle-ending guarantee
  is sacred.
- Chase-and-retreat per-man rules are untouched; command layer only feeds
  them better inputs.
