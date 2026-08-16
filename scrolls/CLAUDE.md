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

## THE PRISON IS 6 HECTARES NOW — `src/world/prisonwings.js`

**"The prison game should be bigger … think of scale of human vs prison size and
really make it bigger, adding rooms — don't worry too much about design of
rooms, worry about SCALE and interactable things that matter. The armoury is a
great example of something that matters hugely: you need a key to get in and
then you get guns, it's awesome"** (owner, 2026-08-11).

**A MAN IS 1.82 m AND THE COMPOUND WAS 1.79 ha.** Measured before a wall moved:
admin 40x20, wing 32x36, north yard 60x60, south block 88x76 — 92 m across,
195 m deep, **fifty body-lengths** of yard, when a real medium-security
perimeter runs 300-400 m a side. No amount of room dressing fixes that; it is
arithmetic.

**NOT ONE AUTHORED COORDINATE MOVED.** world/layout.js's stage-5 desert states
the discipline (a 10x basin worked because it grew off a HELD corner), and it is
the only reason this is one new file instead of a rewrite of five. The cell wing,
admin wing, both yards, every room, `CBZ.SPAWN`, every escape route, every vent
crawl, every patrol waypoint and every propuse anchor are byte-identical. The
compound grew *around* them: a new outer wire at x +-124, z -116..128, and what
used to be the yard's boundary wall is now an **internal division fence** — which
is what a real prison has, and the only reason a gate through one is worth a key.
The freedom gate does not move either; the new south wall is the same line
carried out to the corners.

    inside the wire   92 x 195  ->  248 x 244      1.79 ha -> 6.05 ha

**IT INVENTS NO ITEM. The three keys the game already has each got more to
open**, which is the opposite of diluting the spine:

| key | what it now opens |
|---|---|
| **Keycard** (the one you already hunt) | the FOUR sally gates + segregation — the card used to open one door, it now opens the map |
| **Lockpick** | tool crib 3.2 s · knife cage 4.4 s · property cage 5.6 s |
| **Gun-Room Key** (off the warden) | **CENTRAL CONTROL** — the console throws the yard door and every gate in the house at once, and brings every screw with it |

Six rooms, each a shell + roof + the thing it is actually for: **industries**
(tool crib: Hacksaw, Lockpick, Pickaxe), **powerhouse** (deliberately unlocked —
an empty-handed room is a legitimate outcome), **segregation** (16 singles, the
Contraband Map), **kitchen** (knife cage + a walk-in cooler that is a hiding
place, not a prize), **visitation** (property cage), **control**. Every cage is
BARS on a transparent pane — gun-room rule (a), you must see the prize — and
every lock also states a price in pounds of C4 (`systems/breach.js`).

**AND HE IS NOT ALWAYS AT HIS DESK.** `world/adminwing.js`: the warden now SITS
(`CBZ.propSit` on the throne `CBZ.furnish.bossDesk` already registered — measured,
he finds `kind:"throne"` and lands on it). The first cut then nailed him there
for three of eight schedule blocks and the owner said so immediately — *"should
not always be in the office, of course sometimes you should see the warden, but
it's too common now."* `work` is now the only block that CAN be his desk, `mess`
and `supper` put him on the tier and at the checkpoint where you can see him, and
even that block rolls against the DAY (`CBZ.hash01`, deterministic, no
`Math.random`). **Desk time 29% of the day -> ~8%.** He stands up the instant
anything happens (hunt/alert/approach/investigate) and sits back down after.

**RPGs AND EXPLOSIONS: TWO HALVES WERE NEVER CITY-SHAPED.** The 2026-08-06 split
moved the fireball and the damage onto the capability; MEASURED in escape mode a
rocket already killed the men in the yard and carved the wall it hit. What stayed
behind in `if (cityWorld)` was the part you SEE at the wall — and one of them
says so in its own header (`city/crashfx.js:1789`: *"NO MODE GATE. fpsmode.js
calls this on every rocket that finds a wall, in every mode"*), then sat inside
the gate. `cityBlastWall` (facade avalanche, concrete dust, parapet) and
`cityBreach` (the walkable widening) now ask `modeHas("breach")`; neither reads a
city record. City mode is byte-identical.

**THE PERIMETER STILL HOLDS.** Every outer segment declares `noBreach`; measured,
a 1.9-power blast on the chapel/industries/kitchen walls carves (band [0,6..7.5])
and the same blast on the outer wire returns *"no eligible wall"*. `breach-check`
reports `perimeterHeldAt100lb: true`.

Flags `PRISON_WINGS_V1` · `PRISON_WARDEN_SEATED`. Ratchet
`CBZ.prisonWingsAudit()` — `unreachable` (a locked thing with no route) and
`orphanGates` (a gap cut in a wall with no gate in it, i.e. a hole in the prison)
both pinned at 0. Gates green: `math-gate`, `prison-polish-check` 38/38,
`breach-check`.

## WHO YOU ARE TO THEM — `src/city/read.js`, the street's one social read

**"They don't just talk to me based on my role, also based on theirs — it's a
simple table"**, and **"roles and levels matter for what they say to me: if I'm
a hitman they offer me jobs"** (owner, 2026-08-11). Also his standing complaint
about the dialogue area: **"you don't get popups in real life."**

The city already kept a five-axis `relPlayer`, a cover-aware 1..100 `cityLevel`,
a `{title, kind}` role and a ±12 gap test — and read every one of them as a RAW
NUMBER at the call site, so the lines that came out were flat arrays picked with
`rng()`. A Lv.3 bum and a Lv.74 shot-caller greeted a Kingpin with the same
sentence off the same die. The prison had solved this (`systems/economy.js:263`
`socialRead()` → words, and its law at :145: *"surfaced as a LINE or a PRICE,
never as a meter"*); the street never got the port.

**FOUR AXES, ONE TABLE.** `TABLE[topic][theirRole][yourRole]`, and inside a cell
the LEVEL GAP — because that is where level actually changes the sentence: a
Lv.60 lieutenant and a Lv.8 corner kid are both `gang`. A cell is a flat array
(same at every weight class) or a gap-keyed object; gap lookup walks outward to
the nearest defined band. Resolution is most-specific-first, and STANDING beats
the table — a friend is a friend before he is a dealer.

    CBZ.cityReadGap(them)        -2..+2   (±1 at 12 levels, ±2 at 28)
    CBZ.citySocialRead(ped)      standing · mood · gap · level · title · kind
    CBZ.cityPlayerRole()         civilian | hitman | boss | crew | cop | security
    CBZ.cityLine(ped, topic)     contact | trade | greet  -> a string, or null
    CBZ.cityContactReact(p,k,s)  the bump, with a voice

**IT AUTHORS NO STAT.** Every number it reads is written by somebody else, and
it never forces a pose: contact moves the scalars through `cityRelShift` and
stops, because `city/tells.js` already maps fear → guarded hands and grudge →
folded arms on its own tick. Line choice is hashed off the person's own spawn
cell folded with the gap and the standing, so **the same man says the same thing
until the relationship changes** — never `Math.random`.

**`citySay` NOW REPORTS DELIVERY** (`social.js:431`). Every early return was a
silent drop, and read.js was counting contact lines the range gate had already
thrown away. It returns `true` only when a line reached the element; the old
return was `undefined`, so every existing caller is unaffected.

Flag `CITY_READ_V1`. Audit `CBZ.cityReadAudit()` — `mute` (asks it could not
answer) may only go DOWN, `lines`/`contacts` only UP. Gate
`tools/dialogue-read-check.mjs`, and it runs **two-sided**: `--revert` asserts
the flat fallback comes back and no contact speaks with the flag off.
Consumers migrated with it: `humancontact.js` (the bump had never made a sound),
`peds.js` (trade pitch + greeting), `interactions_rich.js` (insult now scales on
the shared band — it was the only verb reading the gap, in one place).

**THE LIMP LOST ITS CAPTION** (`death.js:197`, deleted). The limp was already
four carriers deep — `_moveScale`, the sprint lock, the stiff dragging leg, and
a body dip synced to the walk phase. A line of text announcing your own gait is
the "pure duplicate" case `guards.js:346` already deleted once.

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

## THE WAR IS FOUGHT IN GANG CITY NOW — `games/battle.html`

**"Put it in gang city with all of gang city's buildings, not the current fake
scene … really massively improve this minigame, and the logic of them — right
now the NPCs can overlap and it's just not perfect"** (owner, 2026-08-11).

**IT WAS FIGHTING IN A DESERT MADE OF BOXES.** Its `city` map was 200
procedural towers on a grid — the exact stage flat bomb-survivor deleted a wave
earlier, in a repo whose studio can RAISE the real map. Five grounds now, four
of them places in Gang City at their own coordinates: **city** (`studio.town()`
at the mainland's (0,-700) — eight blocks, marked streets, crosswalks, shops
with signs, enterable instanced-glass towers), **island**
(`raise("militaryisland")`, -620,-700), **field** (`raise("airport")`, Halloran),
**dunes** (the basin, kept — an open firing line is a different game), **arena**
(the kill box, kept as the CONTROL: no world, so a fault there is the men).

**THE REAL FABRIC COST 17 041 DRAW CALLS AND THAT IS NOT THE TOWN'S FAULT.**
It is the mainland's own number before `city/mode.js` runs `batchStaticUnder` +
`freezeStaticUnder`, and a slice page never runs city/mode.js. Neither file
reads a city record; they were behind a door only the full engine had a key to.
New pack **`batch`** and one verb, `CBZ.studio.settle(root)` — merge, then
freeze, in that order, after the ground and **before** the actors.
**17 041 → 817**, measured, with the batched and unbatched frames visually
identical. bomb-survivor.html adopted it in the same wave.

**A MAN IS NOT A PATHFINDER AND IN A CITY THAT IS NOT SURVIVABLE.** Measured on
the first real-downtown build: **25 of 40 men in slot `push`**, `cool` at −28 s,
both armies 135 m apart with eight blocks between them, **5 shots in 30 s**. The
wall-slide detour is right for a crate and hopeless against a block. The ground
now carries a **multi-source flow field** (4 m cells, Dial's bucket queue,
re-solved 1.4 s per side): seed Dijkstra from EVERY living enemy and the field
is *path distance to the nearest enemy*, so each man walks toward whoever is
genuinely closest THROUGH the streets. Seeding from a centre of mass instead
funnels an army into one corner — that was the first draft, and the corner was
in the measurement. Only the SENIOR man in a squad navigates; the column trails
him, so a squad rounds a block as a squad. **push 25 → 1, engaged 0 → 20+.**

**THE OVERLAP WAS A CELL SIZE.** Separation ran on the TARGET-SEARCH grid, and
the two jobs want opposite cells. On 14 m cells it was wrong three ways at once:
it never compared **across a boundary** (two men 0.2 m apart either side of an
invisible line interpenetrated forever), it capped the inner loop at five
neighbours (`i + 6`, and *which* five depended on spawn order), and it fired at
1.0 m, which for a 0.52 m body is contact. Bodies now have their own **2.4 m
grid**, rebuilt every sub-step, swept cell + four FORWARD neighbours so every
pair is visited exactly once, clearance 0.9 m, and a **deep** overlap
(< shoulder width) is corrected in full THAT step rather than sprung apart over
several. A shove marks both men for a collider re-resolve, because a body
squeezed into a crate is invisible to every ray, therefore immortal, therefore
a battle that cannot end.

**ONE ROUND IN FIVE WAS A GHOST BULLET.** Measured: **167 of 776 rounds** fired
down a lane one of the shooter's own men was standing in — and because a
friendly round passes through a friendly body, the result was not fratricide,
it was rounds going through your own people. Worse to watch than a friendly-fire
kill and impossible to read. The trigger now asks two questions with FRESH
answers (`m.sees` is up to half a second old, which is how rounds got fired into
a wall that closed in between): is the line clear, and is one of mine in it. If
a mate is in it the man **steps off the line** — away from the mate's side,
because moving perpendicular grows the mate's offset by (1 − along/d) of the
step — and keeps his mark. **throughMate 167 → 0, blindFire → 0.**

Also: targets are picked LOS-first (the nearest man is not the man you can
shoot); nobody spawns inside a building (golden-angle spiral to the nearest free
point, and in a town they form up **in the outermost streets** off `town.roads`);
the spectator camera shortens its arm instead of parking inside the Exchange
Bank; `ch.crouch` — the rig's own flag, never once set — now makes combat_iq's
cover choice visible; and each map gets its own sky, because one desert haze
over a glass downtown washed the streets to paper.

Ratchet **`tools/battle-check.mjs`** — `overlapPeak` · `embedded` · `blindFire` ·
`throughMate` · `stuck` all pinned at **0** across five maps, and it runs
**two-sided**: `--revert` (`?sep=old&fire=old`) asserts the faults COME BACK
(3 overlapping pairs, 214 ghost rounds), because a fix nobody can turn off has
not been measured. Page probe `window.__battle.quality()`.

### AND THEN SOMEBODY WATCHED IT — 2026-08-12, "NPC war sucks"

Every counter above read zero and the game was still bad, which is the whole
lesson: **the faults that make a battle you WATCH unwatchable do not show up as
wrong pixels, they show up as boredom**, and none of them were being counted.
Measurement found three, and a fourth in the gate itself, which had been
reporting a coverage it did not have.

**THE FIRST FORTY SECONDS WERE TWO CROWDS WALKING.** `streetSpawner` sorted the
town's avenues by distance from centre DESCENDING and took the outermost three,
so on an eight-block downtown 472 m across the two armies started at opposite
EDGES and the `gap` the map table declares was a number the city wrote down and
then ignored. Measured, 26 v 26: **nearest enemy 304 m at t=0**, first round at
**t=10.9 s**, at t=13 s **forty-five of the fifty-two still in slot `march`**
with four rounds fired between them, and the armies not inside 100 m of each
other until **t=41 s**. Closure through a grid of blocks runs about 5 m/s
combined, not the 12 m/s two marching columns suggest.
The lanes are now chosen by nearness to the declared start line and the city's
gap came down 300 → **170**. The raised venues get it from the other end: the
same wave that added `gov`/`harbor`/`marina`/`speedway` also made a venue size
its own no-man's land off its measured span (`gapOverride`), which is the
better mechanism and had the same fault baked into its clamp — a **320 m**
ceiling is the walking battle again, generically. The ceiling is **190** now,
where the fixed maps actually measure.

    city, first round fired    10.9 s -> 2.2 s
    city, rounds by t~65 s     550    -> 967
    city, result               never  -> 58.3 s
    overlapPeak, city          3      -> 0
    nine maps, all resolve, every counter 0

**THE MOP-UP NEEDED EIGHT TO ONE, SO IT NEVER CAME.** `hunt` — wider look,
straight march, run at 8 m/s, `fireMax` x1.6 — is the rule that ENDS a battle,
and it was gated on a ratio so extreme that by the time it could fire there was
nothing left to hunt. Measured: at t=83 s it stood **17 v 4**, a rout at 4.25:1,
flag still false, twenty-one men holding a mark none of them could see, and the
shot counter unchanged at 715 for three straight samples. **3:1 now** — where an
army stops manoeuvring and starts sweeping.

**A WALL DOES NOT TAKE ITS HALF OF THE SHOVE.** The overlap pin was NOT
holding: `overlapPeak` read 0 on island, field, dunes and the kill box and
**3 on `city`**, the one map made of walls. Two answers landed on this in the
same week and they are complementary, not duplicates. `separateSolve` (the
beast-armies wave) sweeps again until nothing moves, which fixes the CROWD half
— a body belongs to several pairs at once, so the shove that clears it of B
walks it back into C. No number of sweeps fixes a WALL, because the wall does
not move: separation puts a man into the facade, the next step's
`resolveCircle` puts him straight back out into the man he was just cleared
from, and the two of them oscillate in a doorway forever. `pinnedPass` runs
last, over what convergence could not fix and only that: it SHOVES AND ASKS THE
WORLD WHAT IT KEPT, hands what a wall refused to the man who has somewhere to
go, parts them along the wall if neither does, and separates them regardless if
the geometry genuinely cannot seat two bodies — because a frame drawn with two
bodies inside each other is the fault being counted, and `resT = 0` gives the
world the last word on the next step. It reads the PAIR's clearance, so it
holds a lion against a hangar exactly as it holds a man against a facade.
**overlapPeak 3 → 0 on every map.**

**AND THE GATE WAS TESTING THE CITY TWICE.** `battle-check.mjs`'s default sweep
was `city,streets,dunes,arena`. There has never been a `streets`; battle.html
ends its map table with `if (!MAPS[SET.map]) SET.map = "city"`, so the pin
covered four runs of three maps and **never once loaded `island` or `field`** —
the two grounds that raise a real piece of Gang City. Two waves found this
independently in the same week; the list is now every map the page offers
(nine), and an unknown name is a FAILURE rather than a silent second helping of
downtown, so the next typo announces itself instead of shrinking the sweep.

Two new pins, both things a person feels rather than sees: **`firstShotT`** (how
long the war spends walking before it starts — measured across all nine maps:
harbor 0.6 · field 0.6 · marina 0.6 · kill box 0.9 · gov 1.2 · city 2.2 ·
dunes 3.2 · island 7.2 · speedway 7.3, pinned at **9** rather than 8 because the
last two are the ones that vary — island has been seen at 7.1 and at 8.4 on the
same build, the sim advancing in frame-sized steps — and a gate that flakes is a
gate people learn to re-run) and **`ended`**
against a SIM-time budget, not a wall-clock one, because headless swiftshader
manages ~0.6x real on the city map and a wall deadline would fail the biggest
map for being the biggest map. A sweep that runs out of wall clock before the
sim budget reports `inconclusive` and does not fail.

## THE CAPTAIN PICKS HIS BOAT — `CBZ.cityOriginBoats()`

**"Captain like pilot should let me select any boat in start menu"** (owner,
2026-08-12). The Pilot has had a CHOOSE YOUR AIRCRAFT strip since the day that
story shipped, read off the live registry so a new airframe appears with no
edit. The Captain got a constant: `const FLAG_KEY = "trawler"`.

**THE LIST WAS ALREADY THERE AND IT IS BETTER THAN THE PILOT'S.** The aircraft
picker has to ship `FALLBACK_PLANES` because militaryvehicles.js only registers
once a world exists and the pick happens before that. `world/water_hulls.js`
registers at PARSE time — its four authored hulls plus every row `city/yachts.js`
queues ahead of it — so at the title screen `CBZ.cityOriginBoats()` answers with
the **real fleet, names and lengths and all**, and there is no fallback list to
drift. Eleven hulls today, from the 4.5 m Calanque tender to the 156 m Vosswerft
Aurora, sorted by length, and a twelfth is pickable the moment it registers.

**ONE STRIP, TWO STORIES.** `systems/state.js` grew a `renderSub()` — the
buttons, the active class, the binding and the "nothing chosen yet" rule — and
both the aircraft and the boat lists are now calls to it. A shared renderer is
exactly the kind of change that fixes one story by breaking the other, so
`tools/boat-origin-check.mjs` reads the **Pilot's** strip in the same pass.

**WHAT IT COST WAS EVERY FITTING IN `city/captain.js`, AND THAT IS THE POINT.**
The file typed the trawler's own measurements as literals — the fish hold's
floor at deck 2.43 between bulwarks at x ±2.64, the chart table at
(0.95, 2.59, 2.35), three crew stations, the rail a deckhand casts from, the
bench a fare sits on, the square a crate lands on, the patch of deck you are set
down on when you hand over the wheel. Put a man on the 4.5 m tender with those
numbers and his crew stand in the air two metres above the sea and his chart
table floats astern of the boat. So `solveFit(key)` derives all of them from the
four dimensions every registered hull already carries (`deriveSpec`: loa, beam,
deckY, sternOffset). **The trawler's authored numbers are the reference** — each
ratio reproduces her to the centimetre, which is the check that the proportions
are real and not invented.

Two things are capped rather than scaled, because proportion is the wrong model
past a certain size: a hold the length of a 156 m yacht is not a hold, it is a
deck, and a chart table 20 m forward is in a different room from the wheel. Both
cap into the aft working space, which on that hull is what the tender garage
actually is. **The crew scales too** — three hands on a RIB is a clown car, so
the ROSTER is sliced by length and the mate is first, because he is the man who
can take the wheel and let you walk your deck.

**AND THE HOLD IS ALSO THE DECK.** `vehicle_hold`'s floor rect is a real
collider, so fitting one to the open boats is what makes a skiff — which
declares no walkable deck of its own — a boat a man can cross. Below a floor two
men could stand on there is no room, and an open boat with no cargo room is an
honest open boat.

**A BOAT CARRIED BY ANOTHER BOAT IS NOT A BOAT YOU CAN SAIL**, and offering
eleven hulls is what made that reachable. `findFlagship` adopts a hull the world
already floats rather than spawning one — right, and how a 156 m superyacht gets
sailed at all, since no marina berth could ever take her. But measured, **both**
afloat Calanque tenders are children of a superyacht's davits (yachts.js's
"Launch the tender"): adopting one would write `car.pos` in WORLD coordinates
onto a group whose transform is its PARENT's, and the captain's first command
would be issued from inside somebody else's tender garage. Anything not parented
straight to the scene is somebody's cargo, and is skipped.

**PICK BEATS OWNED BEATS DEFAULT**, and the order is the whole rule: a boat you
actually clicked wins; else the flagship you already own (a returning skipper
who never touched the picker keeps the hull he has — that record round-trips
through `g.cityGarage` where the session-side pick does not); else the working
trawler the card has always described. The other way round means either "I chose
the tender and got the trawler" or "I owned a sloop and the game took it".

Ratchet `CBZ.captainFitAudit().offHull` — a station placed outside its own hull
— pinned at **0**, and it is checked for **every hull in the registry, not the
one being sailed**, at the title screen with no world built. That fault is
silent: nothing throws when a crew station lands four metres off the transom,
you just find a deckhand treading water. Tool
**`tools/boat-origin-check.mjs`** (`--sail` starts real runs on the smallest
hull, the default and the 156 m flagship — the last of which can never be
delivered to a marina berth and has to be adopted at her outer roadstead).

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

**27 packs.** `three` · `seed` · `boot` · `look` · `green` · `people` · `caps` ·
`day` · `light` · `rest` · `rooms` · `push` · `military` · `desert` · `airbase` ·
`batch` · `citycore` · `militaryisland` · `airport` · `air` · `ordnance` ·
`nukefx` · `fx` · `damage` · `sound` · `radar` · `match`. The manifest owns
dependencies, the load ORDER measured to work, and what each publishes. `src/`
is derived from studio.js's own URL. Files a page lists by hand are never
re-injected.

**`airport` NEEDS `citycore` AND DID NOT SAY SO.** The terminal is a real shell
— island_airport.js calls `cityMakeBuilding` to raise it — so a page that named
`airport` alone got `[studio.raise] airport TypeError: CBZ.cityMakeBuilding is
not a function` and an airfield with no terminal on it. bomb-survivor never saw
it because it happens to name citycore for its own downtown, which is exactly
how an under-declared dependency hides. Found by battle.html's `field` map.

**The verbs, all routes to what exists.** `join()` declare and become a mode ·
`world(name)` · `town()` a real downtown · `raise(pack)` a real piece of the map
at its authored coordinates · **`settle(root)` the world is finished: merge the
static geometry and stop recomputing its matrices** · `cast(role)` the shipped
1.82 m rig · `crowd(n, role)` · `model(name)` / `fly(kind)` shipped geometry,
asking `airbase.js` first because its factories fall back and seat wheels ·
`boom(pos)` fireball + damage + collapse + attenuated sound · `bombsight()` the
impact mark off the SHARED integrator · `chase()` a smoothed, ground-clamped
camera · `controls(kind)` one surface for keyboard, mouse and touch · `hud()`.

**A CONTRACTUALLY SERIAL LOAD WAS ALSO A SERIALLY DOWNLOADED ONE.** `need()`
executes files one at a time and must — several throw if loaded early, and the
addLandmass stamp depends on exactly one script being in flight — but awaiting
each file also fetched them one at a time, so a page naming ten packs paid ten
round trips before its first line ran. `warm(files)` / `prefetch(...packs)` emit
`<link rel=preload as=script>`, which fills the cache without executing a line:
downloads go wide, execution stays exactly as ordered as it was. **Measured 4.0 s
→ 3.1 s to READY on a 40 ms link — 911 ms, almost exactly the 23 round trips
removed.** `onProgress(cb)` reports each file so a page can draw a real bar.
battle.html also warms a map on hover, so START is a build and not a download.

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
