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
pack or verb changes. Dogfood: `games/bomb-survivor.html`
(A, 17 tags) beside `games/bomb-survivor-b.html` (B, 1 tag).

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
