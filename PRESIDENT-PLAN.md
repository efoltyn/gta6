# PRESIDENT-PLAN.md — why President mode is weak, and the fix

Measured on the real title-card President run (seed 260811, the
`president-compound` visual preset, headless Chromium), then read through
`city/presidency.js`, `city/govcomplex.js`, `city/buildings_civic.js`,
`city/facade_kit.js` and the systems they call.

## 1. What is actually wrong

### 1a. The Executive Mansion was wearing two facades — FIXED in this commit

`FACADE_KIT_CITY` (on by default) hands every building that arrives without
an explicit `dress` a random grammar out of the 31 in `city/facades/`, picked
by position hash. `govcomplex.js`'s `civic()` never passed a `dress`, so every
seat of power in the world rolled one. For seed 260811 the Executive Mansion
rolled **manor** (Tudor half-timber, slate gables, brick chimneys) and the
West Wing rolled **pagoda**. Both landed ON TOP of the grammar the building
was actually asked for — `buildings_civic.js`'s doric order, entablature,
motto plaque, seal and copper dome — so the dome pokes up through a Tudor
roof and eleven doric columns stand in front of oak framing. That is the
"floating shit".

Second, independent defect: `bldCivicOrder` under `externalPerron` stands its
columns and its two flagpoles on a 0.30 m plinth across the full 56 m front,
but the host's perron (`perron(root, cx, cz-17, 30, 9, …)`) was 30 m wide.
The outer six columns and both poles floated 30 cm over lawn.

Fix (this commit):
- `facade_kit.js` — `dress: false` is now an explicit opt-out that `resolve()`
  honours; `facadePick()` carries it through so `structural.js` (collapse
  material) answers the same thing the renderer did.
- `buildings.js` — passes `false` through instead of `|| null`-ing it away,
  and stamps `dress` on the returned building record (it never was; collapse
  was city-picking a grammar for every building).
- `govcomplex.js` — `civic()` and `block()` default `dress: false`. A caller
  that asks for its own dress (the Freeport shed) still wins.
- `govcomplex.js` — the Mansion's stylobate is 56 m wide, the width of the
  order it carries; the lone off-axis flagpole (which would now stand on the
  bottom step) is gone, the order's own pair on the deck is the flag.

Before/after: `artifacts/president-facade/`.

### 1b. The mode is a status screen in a locked room, 4.7 km from its own plot

| fact | number | where |
|---|---|---|
| Mansion site (seed 260811) | (2040, −4454) | `CBZ.govComplexes` |
| Saltlands / Dry Gulch centre | ≈ (1120, 150) | `biome_desert.js` MINX..MAXZ |
| distance seat → plot | ≈ 4.7 km | |
| attack staged on real bodies only within | 150 m of the Dry Gulch market | `ATTACK_NEAR` |
| otherwise resolves as | a headline, 60 s later | `tickAttack` |
| in-city day | 150 s | `core/daynight.js` |
| first possible attack | day 2–4 (5–10 real min), 60 % roll | `tickCellDay` |
| country term | 28 days = 70 real min | `elections.js` KIND_TERM_DAYS |
| impeachment needs | scandal ≥ 85, or approval < 15 AND scandal ≥ 50 | `tickFallsDay` |
| missions after swearing in | 1 ("Enter the Situation Room"), then none | `presidencyBegin` |
| buttons usable on day 1 | 3 of 9 (Address, Emergency, Wall) | `BUTTONS` gates |
| president HUD outside the room | none | `hud.js` has no approval/treasury/threat |

Read together:

- **Nothing comes to you.** The enemy lives 4.7 km away and only becomes
  bodies if you are already standing in their market. From the Mansion the
  whole terror plot is text in the feed.
- **Nothing is on your body.** Approval, treasury, emergency, threat, the
  wall's progress — every number the mode is about is painted on one canvas
  in one room. Leave the room and you are an unarmed pedestrian on a lawn.
- **No clock, no loss, no win.** The term is 70 minutes; impeachment is
  effectively unreachable; the coup belongs to civilwar.js's own schedule.
  There is nothing to be good at.
- **Half the powers are missing.** statecraft already ships fund-police,
  tax up/down, curfew, amnesty, deploy guard / surge / martial. None are in
  the room. The doctrine and crown buttons are dead until emergency ≥ 50,
  which the player has no reason to push toward.
- **The house is a grey box.** The State Entrance Hall is an unlit plate
  with three benches and a rug. The compound is a huge empty lawn.
- **Two of everything.** `PRESIDENT_COMPOUND_V2` and `PRESIDENCY_ROOMS_V2`
  each keep a legacy branch alive (old fountain, lobby/bosssuite interiors,
  the east-door 11×8 closet). Nobody will ever flip them back.

## 1c. What shipped (this branch)

Every item of §2 is built. One headless gate covers all of it:
`npm run test:president` (tools/president-check.mjs) boots the real title-card
President run, advances days through polity's own wrap hook and asks each
organ the one question a player asks of it. Pictures: `npm run
visual:president-loop` (tools/visual-presets/president-loop.mjs) and
`artifacts/president-facade/`.

| item | where | what |
|---|---|---|
| 1 threat at the gate | presidency.js §4 | attacks alternate market/gate; a gate attack rolls a real car up the drive, casts gunmen at the leaf, the detail answers |
| 2 HUD | president_hud.js | approval · treasury · emergency · day/term · threat (armed target, red pulse) · wall/bureau/impeachment chips · deposed banner; flag PRESIDENT_HUD |
| 3 Chief of Staff | president_agenda.js | 2–3 tasks a day through core/mission.js: podium address (E = presidency.press("address"), press corps), the General's briefing, a ride to the Bureau or the wall crossing, the drill when a threat is armed; ignored tasks cost approval |
| 4 motorcade | motorcade.js | state car in the court, verb card on the chauffeur (Capitol / Bureau / Saltlands / Home), a helicopter on the pad the head of state boards without stealing it |
| 5 a term you can lose | officials.js + presidency.js §6b | the player's country term is 7 days (PRESIDENT_TERM_DAYS); the presidency rides elections.js's real cycle: campaign call with the live poll, RE-ELECTED (one more bomber) or DEFEATED (a private citizen at your own gate) |
| 6 scandal | presidency.js §6 | scandal drifts toward statecraft's tyranny plus attacks minus addresses; impeachment at scandal ≥ 70 or approval < 25 with scandal ≥ 45 |
| 7 the falls on the building | president_regime.js | banners, searchlights, sandbags, leader plate (dictatorship/fascism); red cloth, star, podium (communism); purple and gold, sentry posts (monarchy); MARTIAL LAW (junta); the detail's gear tier follows; the press leaves the hall |
| 8 all the powers | presidency.js §3 | 17 pads on two table ranks and a standing console, every statecraft decree and deployment as a thin wrapper; the board draws the country |
| 9 a real interior | interior_programs.js | the light panels were poured inside the slab; chandeliers, sconces, coffers, panelling, seal, portraits, standards, a fireplace wall, a briefing wall, a press corps; state symbols 13 → 26 |
| 10 legacy deleted | govcomplex.js, presidency.js | PRESIDENT_COMPOUND_V2 and PRESIDENCY_ROOMS_V2 and every branch they guarded |

Found and fixed on the way:

- **The Saltlands never existed to the mode.** Regions are registered on the
  arena, and presidency.js and construction.js read `CBZ.city.regions`, which
  is empty on a booted world. The wall order refused, safehouses were empty
  and the Dry Gulch target never fired. Both now read whichever ledger is
  filled.
- **Every NPC stood in the ground.** peds.js pinned `pos.y = 0` each frame;
  the Mansion's paving is at 0.10, the hall slab at 0.14, the stylobate at
  0.30. NPCs now settle on physics.js's `groundAt`, the player's own law
  (PED_FEET_V1). The gate checks 24 bodies on the compound, none sunk.
- **The Executive Mansion wore two facades** (§1a).

## 2. The plan (as written before the build)

Principle: **bring the plot to the player, and put the president's numbers
on the player.** Every order should produce a scene within 60 s and within
200 m of where you stand.

### Phase 1 — the Mansion is the stage (highest value per line)

1. **The threat comes to the gate.** The cell's attack target alternates
   between Dry Gulch and the Mansion gate / your motorcade / a rally you
   call. Attackers arrive in a real car (`cityMakeCar` + aigoals' rampage
   brain), so the 150 m gate is always satisfied when it is your house.
   The Saltlands keeps its role as safehouse and frontier (the wall still
   throttles supply), it just stops being the only place anything happens.
2. **President HUD.** While `seat()` is truthy: approval · treasury ·
   emergency · day N of term · threat, pinned in city mode. `paintBoard()`'s
   six lines are already the data; this is a DOM strip fed by the same
   function, not a second model.
3. **The Chief of Staff is a director.** Each day, two or three concrete
   tasks through `mission.js` with real markers: address the nation from the
   perron podium (walk there, press E — the same order as the room button),
   meet the General in the West Wing, ride to the Bureau, inspect the wall.
   Each is a reach mission that ends in a scene and pays approval. This is
   the WHY loop the mode has never had.
4. **The motorcade.** The chauffeur and a real car already stand in the
   motor court. E on the chauffeur → a fade, a placed car and you in the back
   seat at Dry Gulch / the Bureau / the Capitol / the wall (activities.js's
   transit already does the placement, minus the fade and the car); the
   helipad gets a real `aircraft.js` helicopter. Kills the 4.7 km problem
   without moving the map.

### Phase 2 — stakes and a clock

5. **A term you can lose.** The `president` origin runs a 7-day term
   (≈ 17 min) with the countdown on the HUD, resolved by elections.js's real
   ballot from real approval. Lose → private citizen at your own gate
   (power.js already re-reads `office.holder`; the detail turns on you).
   Win → a new term and a stronger cell.
6. **Impeachment is reachable.** statecraft's `tyranny()` drifts scandal:
   pardons, crackdowns, curfews and emergency each leave a mark, so the
   tempting buttons carry the risk they should.
7. **The falls are visible on the building.** Emergency 100 → dictatorship:
   the flags change, the detail's `org` flips to the junta, the press leaves
   the hall. The crown changes it again. The player should see what they
   became from the motor court.

### Phase 3 — the room and the house

8. **All the powers in one room.** Add the shipped statecraft decrees and
   deployments as pads; the board draws the safehouse on a real map.
9. **A real interior.** Light, ceilings, portraits, a press corps in the
   hall. Same room-program owner (`interior_programs.js`), better rooms.
10. **Delete the legacy branches.** One fountain, one interior set, one
    Situation Room. Flags that only ever point one way are dead weight.

### Not in the plan

- Moving the Saltlands next to the Mansion. The distance is fine once the
  plot travels; the wall needs a frontier that is far away.
- A second president model. `officials.js` / `polity.js` own the seat and
  that is why elections, assassination and succession already work here.
