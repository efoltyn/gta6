# CLAUDE.md

Browser GTA-style game. Three.js r128 (vendored), plain script tags in
`index.html`, one global `CBZ`, ~264k LOC. No build step — GitHub Pages serves
the repo root of `main`, so **pushing to main IS the deploy** and anything in
`src/`/`assets/` ships.

**Read `docs/claude/` before working — all of it is binding:**

- `doctrine.md` — WHY constitution, hard rules (determinism, flags), Block Law + ratchets
- `verification.md` — math gate, probes, builders-vs-orchestrator, headless facts
- `engine-systems.md` — shared systems: REUSE, never re-invent
- `sessions.md` — dated wave reports and measured ratchets
- `gpt-handoffs.md` — GPT diagnostics, open issues 28–121
- `sound.md` — what may make a noise, how loud, and why (the dB scheme + ratchets)
- `project.md` — deploy details, doc map

Also `GAMEPLAN.md`, `docs/plan/`, `PROCGEN.md`.

## A BASE ANSWERS FOR ITSELF — `src/city/fortresponse.js`

**"The soldiers there are dumb. Dumb. Dumb. … I'd see them run towards fire
like a real NPC"** (owner, 2026-08-09). Three faults, all the same fault:
nothing on Fort Brandt was ever *told* anything.

**NOTHING RAN TOWARD GUNFIRE.** `cityAlarm` sets `alarmed`/`fear` — a
jumpiness-and-report gate. `cityPostAlert` widens a sentry's senses 35%.
Neither MOVES anybody. The one primitive that does the right thing —
`rallyGang` (peds.js): 25 m, six bodies, rage + target — was filtered on
`o.gang !== ped.gang`, and **a soldier has an `organization`, not a gang**. So
shooting one man in a formation of thirty-two rallied nobody, and sizeup's
`backupLevels` (also gang-keyed) read him as a man standing ALONE — which
could make him fold. Both now ask for the same SIDE (`CITY_ORG_RALLY`); `gang`
still wins where it exists, so every street set is byte-identical.

**THE 5★ ORDER WAS IMPOSSIBLE TO OBEY, AND IS DELETED.** island_military.js
handed eight riflemen `rage = playerActor` at a target **1.3 km** away, steered
only by `combat_iq.posture` — local tactical positioning that explicitly nulls
`ped.path`. There is no route across the sea. **Measured** (seed 90210, 5★
pinned): after 20 s, nine men ordered, nearest still **1086 m** away, **0** on
the causeway, 3 grinding the east wire, one had moved **1.1 m**; after 80 s the
gunship had flown out, orbited and come home and both fighters were on final —
and not one rifleman had left the island. An order nobody can obey reads as
stupidity because it is. Trouble ON the reservation is now converged on and
fought (through `cityShapeSquad` + `combat_iq`, leashed to the wire); a manhunt
a kilometre away puts the base on **stand-to** and lets the air response
prosecute it.

**ONE BUS, NO CALL SITES EDITED.** `CBZ.fortAlert(x, z, {level, by})` is rung
from `cityAlarm` and `cityCrime` by the same WRAP precedent wildlife.js and
social.js already use on those exact two names. `CBZ.militaryPersonnel()` is
the merged roster — the island's 44 **plus** garrison posts **plus** any
`organization === "military"` body; `cityMilitaryPersonnel` was the only list
aircrew selection had ever read, so a gate sentry could never fly.

Flags `FORT_RESPONSE` · `FORT_ALERT` · `FORT_STANDTO` · `CITY_ORG_RALLY`.
**`FORT_CONVOY` is declared and OFF**: getting infantry off the island needs a
road convoy, the causeway is already a real road record in `arena.roads`, and
police.js:2560-2640 already ships the whole arc (vehicle at its home station →
`ai:true` lane AI → `destX/destZ` retargeted → brake at 28 m → dismount) — it
is cop-shaped, and generalising it is a change to police.js. Declaring the gap
beats shipping a half-driven truck. Ratchet `CBZ.fortAudit().impossibleOrders`
pinned at 0.

## THE CREW RUNS TO THE AIRCRAFT — `AIR_CREW_BOARD` in `city/aircraft.js`

**"They don't run and get in the fighter when you have five stars."** They
never did. `claimMilitary` set `inCar = true; group.visible = false` on the
same frame it claimed the airframe, then seated the body — a man on the parade
ground ceased to exist and reappeared behind the canopy. `phase:"spool"` is
ENGINE spool; there was never a boarding beat.

A `board` phase now precedes `spool`. The crewman stays an **ordinary ped** —
we write `target`/`state`/`pause` and set `_boardRun`, which is boarding.js's
OWN flag (a ×1.9 multiplier on the shared mover), so context steering, the
vault probe, depenetration and animChar's run layer all still run. Rotors do
not turn until somebody is in the left seat. **Shoot the pilot crossing the
apron and no aircraft launches** — the airframe is released and the next
request retries on its own cooldown, the same honest refusal strategic.js
already prints for "No aircrew left on the base".

**THREE THINGS THE MEASUREMENT FORCED, none of them guessable from the desk:**

- **Claim the NEAREST machine, not the first free record.** The fort parks four
  helicopters 30 m apart and five fighters 34 m apart; "first free" routinely
  sat at the far end with every other airframe's collider in between. Measured:
  a weapons officer stopped dead, **speed 0**, 26 m short, wedged against the
  neighbouring helicopter. peds.js steers around obstacles; it does not path
  around a wall of them.
- **Approach from the side he is already on.** A fixed port-beam mark points
  *along* the flight line — through the next aircraft. The bearing from the man
  to the machine is by construction the open side. Offset comes from the
  record's own `footW`/`footL`, so a 3 m mark never again lands under a wing.
- **The aircraft leaves on the PILOT, not the last man.** Waiting for a whole
  gunship crew made it only as fast as its slowest gunner. Anybody still on the
  apron is dropped from the crew and goes back to being a soldier; `crewLost()`
  already prices the empty seat.

**`BOARD_VIEW` (420 m) is the repo's no-spawn-in-view discipline applied to a
BEAT.** Fort Brandt is 1.3 km from the city and peds.js time-slices a body that
far out, so a crewman whose `speed` reads 3.5 m/s actually covers ~2 — holding a
fighter on the line for 90 s of a manhunt nobody can see is pure downside. Inside
the radius they run and you watch; outside it the seat is taken at once, counted
as `unwatched` (census), never as `teleportedInView` (the ratchet).

Ratchet `CBZ.airCrewAudit().teleportedInView` pinned at 0 (a session counter, so
"never scramble anybody" cannot satisfy it — `walked` has to climb).
`instantSites` pinned at **1** and named, not hidden: strategic.js's nuclear
sortie repositions the B-2 to its run-in point in the same call that seats the
pilot, so a boarding beat there is a change to that sortie's geometry — the next
wave that opens that file owes it.

**AND HE GIVES UP THE CHASE.** garrison.js gives a sentry that rule; an ordinary
ped never had it, because `rage` is sticky until the target dies. Survivable
until something rallied a soldier — now `CITY_ORG_RALLY` does, and the ratchet
caught the consequence immediately: one rifleman in state `fight` holding a
player **3816 m** away. `fortresponse.js` sweeps the military roster at 1 Hz and
drops any target past 300 m, well beyond the longest weapon in the game (240 m).

## THE STUDIO — `src/core/studio.js`, one script tag

**GANG CITY IS THE BACK END; THE HTML IS ADDITION** (owner, 2026-08-07). A
one-shot page should spend its lines on what is new, never on redrawing a body,
an aeroplane, a camera, a HUD or an explosion this repo already ships.

`index.html` carries 471 tags, so every mode pays for every other mode and the
cheapest thing to add has always been another dressed room. A `games/` page pays
only for what it names, and until now it could not NAME anything: bomb
survivor's seventeen tags were found by failure, and the one it needed most
(`systems/modecaps.js`) was missing, so its `registerMode` call was a no-op.

```html
<script src="../src/core/studio.js"></script>
<script>CBZ.studio.need("people","desert","air").then(function(){ /* your game */ });</script>
```

**18 packs.** `three` · `seed` · `boot` · `look` · `green` · `people` · `caps` ·
`military` · `desert` · `airbase` · `air` · `ordnance` · `nukefx` · `fx` ·
`damage` · `sound` · `radar` · `match`. The manifest owns dependencies, the load
ORDER measured to work, and what each publishes. `src/` is derived from
studio.js's own URL. Files a page lists by hand are never re-injected.

**The verbs, all routes to what exists.** `join()` declare and become a mode ·
`world(name)` · `cast(role)` the shipped 1.82 m rig · `crowd(n, role)` ·
`model(name)` / `fly(kind)` shipped geometry, asking `airbase.js` first because
its factories fall back and seat wheels · `boom(pos)` fireball + damage +
collapse + attenuated sound · `bombsight()` the impact mark off the SHARED
integrator · `chase()` a smoothed, ground-clamped camera · `controls(kind)` one
surface for keyboard, mouse and touch · `hud()`.

**THE HUD RULES LIVE IN `hud()` NOW**, so the next one-shot cannot get them
wrong: health is always top left and is one meter; no emoji in HUD space; and a
touchscreen is NEVER shown a keyboard key, because `controls()`/`hud()` decide
that once from pointer coarseness rather than in every page by whoever forgot.

**THERE IS EXACTLY ONE `registerMode`.** A second definition of that name
replaced `config.js`'s, `city/mode.js`'s descriptor stopped landing in
`CBZ.modes`, and the city built with no arena. The math gate caught it.

**`CBZ.colliders` and `CBZ.shake` are published by microboot**, both under the
names the engine already reads. Colliders were private, so every
building-damage verb saw an empty world. `CBZ.shake` lives in city-coupled
`systems/camera.js` while `crashfx.js` calls it on every blast, so slice-page
explosions were silent and still.

**`tools/api-lint.mjs`** answers "does this page call things that exist" without
running anything: it collects every `CBZ.<name>` and `CBZ.<ns>.<member>` a page
mentions and asks whether the engine ever assigns it. `CBZ.radarScope` for
`CBZ.radar` is not a syntax error, so `node --check` is blind to it, and that
exact one shipped. Proven to bite by injecting three typos.

Flags `STUDIO_V1`. Ratchet `CBZ.studio.audit().missing` pinned at 0 by
`tools/studio-check.mjs`; `--print` regenerates **`docs/ONE-SHOT.md`**, the ~150
line system prompt a new mini-game is written against. Regenerate it whenever a
pack or verb changes. Dogfood: `games/bomb-survivor.html` — ONE page now (the
A/B bet is settled: one tag, and the game stands on the real map via
`citycore`/`militaryisland`/`airport` packs, `studio.raise()`, `studio.town()`).

## THE MODE ENUM IS NOT A CAPABILITY CONTRACT — `CBZ.modeHas()`

**GANG CITY IS THE ENGINE AND THE ASSET FARM** (owner, 2026-08-06). Prison
(`escape`), Gun Game and Natural Disaster (`survival`) are SCENARIOS wearing it,
per the Rome Test. A shared engine verb must therefore never ask *which
scenario is running* — it asks for the capability:

```js
CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city"   // adopt like this
```

`src/systems/modecaps.js` owns the table (`traverse` · `stepLedge` · `blast` ·
`blastActors` · `breach`), the mode's live actor roster (`CBZ.worldActors`), the
damage switchboard (`CBZ.hurtWorldActor` → `aiKill` / `gungame.hurt` /
`surv.hurt` / `cityKillPed`) and the shared blast coupling
(`CBZ.blastWorldActors`). Flag `MODE_CAPS_V1=false` restores the old city-only
answer at every site at once.

### A GAMES/ PAGE JOINS THE ENGINE IN ONE CALL — capabilities on `CBZ.modes`

**A ONE-SHOT HTML GAME MUST NEVER HAVE TO EDIT ENGINE SOURCE TO BE REACHED**
(owner, 2026-08-07: "make it so next time there's a one shot of a new HTML
game, they can easily use Gang City like an engine"). The capability table
above answered from engine source, so a new page landed in no row, `modeHas`
said false at every gate, and the whole shared layer politely did nothing.
`games/bomb-survivor.html` is the measured case: two hundred towers, and a
blast could not reach a man, a vault, or a wall.

The registry was **already there** — `config.js:37` owns `CBZ.modes` and
`CBZ.registerMode(id, def)`, `state.js` delegates to it, and `city/mode.js`,
`modes/survival.js` and `modes/gungame.js` already call it. Capabilities are
now FIELDS ON THAT DESCRIPTOR, so declaring is one call the mode already makes:

```js
CBZ.registerMode("slice", { id: "slice", label: "Bomb Survivor",
  caps: { traverse:1, stepLedge:1, blast:1, blastActors:1, breach:1 },
  actors: (out) => { for (const m of myMen) if (!m.dead) out.push(m); },
  hurt: (a, dmg, imp) => { a.hp -= dmg; if (a.hp <= 0) myKill(a, imp); return true; },
  hurtPlayer: (dmg, x, z, cause) => myHurtPlayer(dmg, cause),
  route: "slice roster + myKill" });
```

A descriptor with no `caps` behaves exactly as before, which is why the three
shipped modes needed no edit. `caps` is an open string set: a future block
grants a capability by documenting a name, never by editing `modecaps.js`.
Flag `MODE_CAPS_DECL_V1=false`. Tool: `tools/mode-registry-check.mjs`.

**THERE IS EXACTLY ONE `registerMode`.** A second definition of that name
replaced config.js's, `city/mode.js`'s descriptor stopped landing in
`CBZ.modes`, and the city built with no arena and an empty biome set. The math
gate caught it. `modecaps.js` now creates the pair only when config.js is
absent (the slice-page case), yielding otherwise.

**`CBZ.colliders` IS THE WORLD, AND MICROBOOT NOW PUBLISHES IT.**
`core/microboot.js` kept its boxes at `micro.colliders` and nowhere else, so
every shared verb that reads `CBZ.colliders` — the vault probe, `carveHole`,
`cityWallRuin`, `cityAirstrikeCollapse`, camera occlusion — looked at a world
with two hundred towers in it and found `undefined`. The element shape was
already identical field for field. Same array, published under the name the
engine reads, yielding if anything defined it first.

**WALLS BREAK EVERYWHERE; THE PERIMETER DOESN'T.** `city/buildings.js`
`carveHole` opens real walk-through holes with sill/header/flank remnants and a
lit room behind; `city/fracture.js` owns the ledger (24 holes, plywood
eviction, coordinate-stable persistence, net broadcast) and `chewWall` (25
rifle rounds in a 1.2 m cell = a murder hole). None of it reads a city record.
A wall opts OUT with **`noBreach` on its collider** — that one flag on
`world/yard.js`'s `wall()` helper is the entire policy keeping the prison an
escape game rather than a jailbreak sandbox. A collider with no `y0`/`y1`
derives its band from `c.ref`'s bounds, so pre-contract walls are carvable
without editing the world files.

**The rule this file exists to enforce:** `mode === "city"` is legitimate when
it guards a CITY RECORD (`cityCars`, `city.arena`, the wanted ladder, the
world-state ledger, the fracture/structural chain) and is a BUG when it guards a
shared verb. Two shipped examples of the bug, both fixed 2026-08-06: an RPG
outside the city produced a camera shake and nothing else, and nobody outside
the city could vault a chair — while the prison's own mess tables already
registered exactly the `y0/y1` + `ref` colliders the vault probe wants.

**`CBZ.cityExplosion` is a WRAPPER CHAIN, not a function.** Six files hang city
couplings on it and they stay installed for the session. Detonate through
`CBZ.cityBlastCore` outside the city — same fireball, damage, sound and shake,
none of the city bookkeeping. Wrap `cityExplosion`; never wrap `cityBlastCore`.

Ratchet: `CBZ.modeCapsAudit().unrouted` — modes declared blast-capable whose
people a blast cannot reach. **Pinned at 0** in `tools/math-gate.mjs`.

## THE PRISON HOLDS WHO IT CAN SLEEP — `CBZ.prisonBeds()`

**"There's too many fucking people"** (owner, 2026-08-09) — the second time,
`MASS_CROWD` having already been cut 900 → 140 for the first. The headcount was
**five constants in four files** (`MASS_CROWD` · `JAIL_CROWD` · npc.js's 30-name
`ROSTER` · one resident per cell · 12 guard posts) and not one could see that
the wing has **thirteen cells**. Measured: ~207 bodies against **26 bunks** —
about 800% of the only housing in the world. Not overcrowded, impossible.

A prison is the one place where this ratio is litigated, so the number is not
taste: *Brown v. Plata* (563 U.S. 493, 2011) found California at ~185% of design
capacity and capped it at **137.5%**. `world/cellblock.js` publishes
`CBZ.prisonBeds()` — cells × bunks × occupancy — and both ANONYMOUS tiers are
now the REMAINDER of a subtraction against it (`entities/ambientstate.js`,
`entities/npc.js`), exact because of load order (cellblock 456 → guards 528 →
npc.js 535 → ambientstate 559). The NAMED cast is never trimmed: those men are
the game, and where they overshoot the answer is a bigger wing. An explicit
`CBZ.MASS_CROWD`/`JAIL_CROWD` still wins — overruling is a decision, not a drift.

    bodies in a 60° cone     69 → 20        ambient tier   140 → 0
    live inmates            124 → 50        occupancy     ~800% → 192%

**THE LEVER IS CELLS, NOT A CONSTANT.** Ratchet: `tools/prison-polish-check.mjs`
— capacity published, headcount derived not typed, no anonymous body added to a
prison that cannot sleep the men in it, occupancy ≤ 200%.

## A SOUND HAS A PLACE AND A DECIBEL — `docs/claude/sound.md`

**"He hears punches from any distance at the same volume"** (owner, 2026-08-09).
Measured, mode escape, player standing still: `punch` at **90 requests/minute,
100% of them global** — `exchangeBlows` voiced every NPC-vs-NPC blow with a bare
`CBZ.sfx()`, so a fight anywhere in an 84×110 m yard landed at full volume in
your skull. Three surfaces now, and the choice is mechanical:

| you are voicing | use |
|---|---|
| something **you** did | `CBZ.sfx(name)` — global, you are where the listener is |
| something that happened **to you** | `CBZ.sfxAt(name, x, z)` — the shared (gun) curve |
| something **someone else** did | `CBZ.worldSfx(name, x, z)` — near-field rolloff, one voice per cue, nearest wins |

`worldSfx` does NOT reuse the shared curve: that is the gun curve, still 84% at
42 m, right for a rifle and absurd for a fist. Foley gets its own inverse-square
rolloff (half at 8 m) and below 6% is not requested at all.

**EVERY BANK GAIN IS A REAL DECIBEL.** Measured, the bank had **a dropped coin
at −6.7 dBFS and a punch at −17.7** — eleven decibels the wrong way, against
thirty the other way in the real world — and 26 of 33 cues sat above the master
compressor's −12 dBFS threshold, where 5:1 flattened a gunshot and a coin to
within a couple of dB. Gains are now derived from measured real-world SPL (3M
Noise Navigator) through `target dBFS = −0.2 + (dB SPL − 170) × 0.2`. Cues above
the threshold: **26 → 3**. Three documented exceptions, each a decision.

**A REPEATING SOUND IS USUALLY A REPEATING WORLD.** The census samples what the
world is DOING beside what it plays, because the punch spam was the audible half
of 7.3 of 124 inmates fighting at every instant, forever — violence needed no
cause (`findFoe` = any rival within 8 m). Fixed at the root in `entities/ai.js`
(BEEF): a fight needs a REASON booked by things that already happen, and an
OPENING (`CBZ.guardWatching`). Not a cap — a cap is the same arbitrary violence
with a quota on it.

Tools: `tools/sound-census.mjs [--gate]` · `tools/sound-loudness.mjs [--gate]`.
Headless Chromium has no AAC decoder, so both ratchets are pinned on numbers
stamped before the decoder (engine counters, `.ogg` twins).

## AN AIRPORT IS A RECORD — `CBZ.registerAirport` / `CBZ.buildAirfield`

**OWNER (2026-08-09): "package the airport so you can just duplicate and put it
somewhere else easily without rewriting that code … put another airport in
another city … have planes actually go up to the runway, take off, land at the
other airport … make it so you can buy a ticket and get on the plane."**

`city/island_airport.js` is 3,977 lines and every one is authored in WORLD
coordinates (`RWY_X0 = -850 + ADX`). A second airport meant copying it. But
nothing about an airport needs world coordinates: a runway is a LENGTH and a
WIDTH, a stand is "185 m along the field, 76 m off the centreline, nose out".
What differs between two fields is ONE ORIGIN AND ONE BEARING.

**`src/systems/airports.js` owns the frame and only the frame.** Origin = the
runway MIDPOINT; local +X runs down the runway; local +Z is the apron side
(taxiway 50, stands 76, apron 90, terminal 114, kerb 128). `ap.toWorld(lx,lz)`
uses the SAME heading convention the shipped aircraft do — forward is
`(cos h, 0, -sin h)` — so **a local heading becomes a world heading by adding
the field bearing**, with no second mapping to get wrong. `end.sign` is the
sign of that threshold's own local x (the first draft made it the departure
DIRECTION, which lines an aeroplane up at the wrong threshold facing off the
end). Halloran registers ITSELF from the same variables its runway was drawn
from, so the worldOff dial moves the record and the tarmac together.

**`src/city/airport_kit.js` builds a field from that spec** — surfaces,
markings, edge lights, stands, terminal, tower, fence, kerb, keep-out, access
causeway — and **authors no aeroplane**: `island_airport.js` now publishes its
own airframe factories as **`CBZ.airportKit`** (`airliner` / `jet` /
`boardable`), so a kit field's parked fleet is the same hull with the same
cabin, the same seats, the same doors, the same damage model and the same
pilots. `city/airport_capeharbor.js` is the proof: **one spec and one call**,
runway 20/02 deliberately OFF-AXIS so the frame is actually exercised.

**`src/systems/airline.js` flies it.** A shuttle CLAIMS a parked airliner off a
stand and runs the real arc: doors → taxi via a connector → backtrack → line up
→ rotate → climb → cruise → descend on the far field's extended centreline →
touch down in the touchdown zone → brake → taxi in → park → turn round → fly
back. **The pilots were already in the aeroplane** (two `reservedForNpc`
cockpit seats npclife casts into). Altitude is a closed-form trapezoid of
distance — `min(cruise, flown·tan9°, toTouchdown·tan5.5°)` — so it cannot
oscillate and lands at exactly zero; the fields are 2.2 km apart, so the
profile is scale-honest, not A320-honest. **Hijack the aeroplane and the
flight is cancelled**, because a plane you stole is not one the airline
operates. `CBZ.cabinCarry` is the one call that tells island_airport.js the
room moved — standing you translate, seated your propuse anchor re-solves.

**`src/city/ticketing.js` is only the verb.** [E] at any check-in counter; the
fare leaves `CBZ.city.spend`; the flight HOLDS ITS DOORS for a ticket; you
board through the shipped "Board the cabin" arc and ride the cabin the whole
way. **No fade to black and no teleport.**

**EVERY APPROACH BUG IN THIS WAVE WAS A DISTANCE THAT SHOULD HAVE BEEN A
LATCH.** Past a waypoint, the distance to it grows again — so "am I past the
final approach fix" and "are the wheels down" both turned the aeroplane round
to have another go (measured: 250 sim-seconds orbiting Cape Harbor). Commit the
state; never re-ask a distance you have already answered. Same family: a taxi
capture radius SMALLER than the turn circle (9 m against 15.5) is a corner that
can never be made.

Flags `AIRPORT_REGISTRY_V1` · `AIRPORT_KIT_V1` · `AIRPORT_CAPEHARBOR` ·
`AIRLINE_V1` · `AIRLINE_TICKETS_V1`. Ratchets in `tools/math-gate.mjs`, all
**pinned at 0**: `CBZ.airportAudit().malformed`, `CBZ.airlineAudit().stranded`
(how a two-node network silently wedges — an aeroplane lands with no stand free
and the departures board just keeps counting down) and
`CBZ.airlineAudit().shortFields` (a runway shorter than the fleet's own
take-off roll, re-derived from the airline's constants — declare the next
airport with 400 m and the gate says so instead of the sea).
Tool: **`tools/airline-check.mjs`** flies a whole leg headless and asserts the
phase order, the peak altitude, that the wheels touched down inside the
DESTINATION runway rectangle in that runway's own local frame, that the rollout
never left the paving, and that it parked on a stand belonging to the other
airport.

## THE CHARGE TABLE — real breaching math, shared by every game

`src/systems/breach.js` publishes US Army urban-breaching doctrine (FM 3-06.11
ch.8 · FM 90-10-1 app.M · ATP 3-21.8 app.H) as engine fact, so the prison door,
the bank vault and every wall price themselves in **one unit: pounds of C4**.

| charge | opening |
|---|---|
| 2 lb | mousehole — not walkable |
| **5 lb** | **one man moves through** (one C4 brick) |
| 7 lb | two abreast |
| 10 lb | wide breach |

**CONTACT vs STANDOFF is the law.** A charge STUCK to something opens it; a
rocket only wrecks it — a shaped charge penetrates (PG-7VR: 1.5 m of reinforced
concrete) while leaving a ~30 cm hole nobody walks through. Standoff banks
`STANDOFF_COUPLING` (0.35) of its mass. **Measured: 1 brick, or 7 rockets, or
2 bricks through a wall too thick for any single hit.**

**NOTHING FAKE-BLOWS-UP ANY MORE.** Every detonation banks mass into a world
cell (`CBZ.breachDeliver`) and the cell REMEMBERS — no decay, concrete does not
heal. A wall that refused the first hit is closer to opening than it was, and
crossing the 7 lb / 10 lb rows raises `carveHole`'s thickness ceiling so piers
go too. Do **not** zero the ledger on a hit: a facade is layers, and the reset
is what made a thick wall unopenable at sixty pounds.

A game declares a defeatable thing in one line and the charge never learns what
it is: `CBZ.registerBreachTarget({id, at, reach, lb, defeat})`. Live: the
prison's yard door (5 lb — a second answer beside the keycard) and every bank
vault (branch 5 / count 7 / reserve 10). Charges within 2.5 m fire together and
their masses ADD (det cord), which is how two bricks open a reserve vault.

The detonator is a **phone app** (`city/phone.js` DEMOLITION card), not a hand
prop — it shows pounds out, bricks left and what the nearest target costs.
Hold-[B] stays the fast path, and is the only one inside the wire: a man in a
prison yard does not have a phone. Flags `BREACH_TABLE_V1` · ratchet
`CBZ.breachAudit().unreachable` pinned at 0. Tool: `tools/breach-check.mjs`.
