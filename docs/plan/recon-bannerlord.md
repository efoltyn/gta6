# RECON: BANNERLORD DISTANCE (scout report, 2026-08-16)

*The owner's question, verbatim where it matters: the NPC war minigame is "a
really really cool thing in theory… imagine a game like gang city map where you
build an army and in those battles the ones that die die and are out of your
army… what it should be is a single massive world with cities that you can
conquer… think how close we really are to a bannerlord type game." This is the
read-off-the-code answer. Nothing was built; every claim below carries a
receipt.*

## 10-line summary

1. **The distance is one integration layer, not a game.** Roughly 60–70% of a
   Bannerlord loop already exists in this repo — but split across two halves
   that have never met: `games/battle.html` is the battle simulator with no
   stakes, and the city is the campaign simulator whose wars resolve as
   arithmetic. Neither knows the other exists.
2. **Armies with permanent death already exist** — as a design law, not a plan.
   Finite non-respawning city population (peds.js:263-290), finite gang
   rosters + recruit pools that permanently wipe (gangs.js:573-590), a
   permanent-death identity registry (identity.js), an offline A-Life ledger
   whose dead never walk back in (schedule.js:427 `dropSid`).
3. **The player can already build and command a fighting force**: recruit for
   $100/respect (careers.js:1057), hire tiered guards with daily wages
   (protection.js:133), found or seize a gang (playergang.js:157/:304), issue
   six battlefield orders (playergang.js:928), escalate hired security into a
   real faction with the whole war machine (militia.js).
4. **Conquest already exists twice**: turf.js is a full zone-takeover meta with
   alliances, defection and a WIN CHECK ("own every zone", turf.js:291); and
   polwar.js wars whole polities — treasuries, counted soldiers, fronts,
   conscription — over the polity tree (5 countries, 17 registered towns).
5. **The single massive world already exists**: one continuous walkable
   continent, 12.77 × 8.82 km FLAT rect (world/layout.js:579-582), 17.7 km
   ground plate (continent.js:455-464), 24 km of named highway records
   (highwaynet.js), a world-map UI that auto-fits it all (fullmap.js).
6. **The battle sim is real and reusable**: shared combat brain
   (combat_iq.js), venues that are the actual map's own builders raised at
   authored coordinates (battle.html:321-331 + studio.raise), no army-size
   cap, deterministic/URL-reproducible, headless CI harness
   (tools/battle-check.mjs), machine-readable results (`__battle.audit()`).
7. **The one true gap is the bridge**: polwar ticks fronts by
   `FRONT_MAX_SHIFT * (cpA − cpB)` (polwar.js:420-427) while battle.html
   spawns ephemeral men from menu counts and ends in `location.reload()`
   (battle.html:3108). Battles have no consequences; wars have no battles.
8. **Second gap, contained**: rosters persist as *counts per rank*
   (gangs.js:2924 `packRoster`), so a named veteran does not survive a
   save/load — even though his death is already permanent in-session. The
   right storage shapes already exist (identity.js; server/db.js:118 `people`
   table with `sid`/`alive`/JSON).
9. **Third gap, the only genuinely expensive one**: nothing marches. citynav
   snapshots the 330 m mainland grid only (citynav.js:76-80), long-range
   orders are actively dropped past 300 m (fortresponse.js), FORT_CONVOY is
   declared and OFF, INFINITE-WORLD.md chunk streaming is 0% implemented.
   Avoidable: Bannerlord's own campaign layer is abstract too.
10. **The venues are not the problem.** 8 of 9 battle venues are real places —
    the critique that lands is that they're *meaningless*, not fake. The fix
    is not better venues; it is `venue = f(where the war is)`, which the
    raise/town machinery already supports.

---

## 1. THE FIVE PILLARS, AUDITED

### 1a. Tactical battle (Bannerlord's field battle) — ~80% built

`games/battle.html` (3,630 lines of orchestration over engine systems):

- **Combat is the city's own brain** — combat_iq.js fire tokens, real
  collider cover, suppression, DPS-ladder competence, melee state machine;
  actorweapons/gunfx/deathPose/weaponPhysics. The page draws nothing violent
  itself (battle.html:8-30).
- **Any size, any composition**: men (5 training tiers × 13 weapons + fists)
  or any of 53 bestiary species; air support up to a nuke. "NO CAP" is a
  design point; FIND MY MAX measures the machine instead of guessing.
- **Emergent drama already beloved**: chase-and-retreat from three per-man
  rules + the HUNT pursuit ending (BATTLE-GRAND-PLAN.md §1). Squads share
  contacts (battle.html:2246-2276), goals project onto walkable nav.
- **Determinism law**: seeded streams, URL-serialized settings — same URL,
  same war. Headless sweep gate: tools/battle-check.mjs.
- **Result surface already machine-readable**: `window.__battle.audit()`
  returns per-team alive counts, stats, per-gun ledgers (battle.html:3471+);
  every man carries his own kills/shots/hits/reloads (makeMan,
  battle.html:962). The survivor list is sitting in `men[]` — one exported
  field away from being a battle *outcome*.

Missing: the command layer (generals/orders — designed in
BATTLE-GRAND-PLAN §2, ON ICE by owner instruction); the roster composer
(§5, planned: contingent lists replacing per-team uniform settings); the
player as a combatant (this is a battle you WATCH); and any consequence —
AGAIN is `location.reload()`.

### 1b. Build an army — ~70% built (in the city, not the battle page)

- Recruit: careers.js:1057 (`cityRecruit`, $100 or respect ≥5); hire:
  protection.js:133 (pistol $250/w$10 · SMG $550/w$18 · rifle $1,100/w$30,
  cap 8); loyalty investment: loyalty.js (give guns/cash, protect).
- Lead: playergang.js — found with ≥3 crew (:157) or decapitate a rival and
  claim its survivors (:304). Orders wheel (:928): FOLLOW / ATTACK / HOLD /
  DISPERSE / RAID / FORTIFY, each writing fields the universal ped brain
  already honors. squadai.js shapes any ≤12-man array into a firing arc with
  focus fire — stateless, roster-agnostic, ideal for a party abstraction.
- Troop identity: named members with ethnicity-matched name pools, 7-tier
  rank ladder with merit requirements and pay cuts (gangs.js:129), per-member
  lifecycle sheets `{bodies, contrib, served, loyalty, earned, joined}`
  (gangs.js:220). Defection is pay-driven in both directions (turf.js:689).
- Wages/economy: turf pays $42/lot/30 s (gangs.js:82), treasuries fund wars,
  the player's cut lands in the bank. Money → troops is closed today.

Missing: a *traveling party* (troops are turf-anchored; FOLLOW approximates
it but is streaming-budget-bound, not party-stat-bound), and per-member
persistence (§2 below).

### 1c. The ones that die, die — ~90% built

This repo's rarest asset: permadeath is already doctrine.

- City population is a finite headcount that only falls
  (peds.js:263-290, `cityPopulationDie`).
- Gang strength ceiling + finite `recruitPool`; pool at 0 = the crew can
  never grow again; clear the street too and it is permanently WIPED
  (gangs.js:573-590). Trickle-back is one body per interval, gated on peace,
  turf, and the player not actively massacring them (gangs.js:3210-3237).
- Ledgered individuals never respawn (`dropSid`, schedule.js:427); named
  identities carry `status:"dead", killedBy, history` forever (identity.js),
  in both save tiers.
- polwar matériel is counted, never abstract: soldiers/planes/missiles are
  inventory rows, losses gone until produced (polwar.js:185-191).

The one hole: battle.html men are conjured from menu counts and evaporate.
Persistent-army battles need `makeMan(team, i)` (battle.html:935) to read a
roster record instead of team-uniform SET fields, and `endWar`
(battle.html:3072) to emit the survivor list it already possesses.

### 1d. A single massive world with cities to conquer — world ~85%, conquer ~50%

The world (see docs/plan/recon-scale.md and the layout dial):

- ONE continuous walkable continent — continent.js fills the sea between
  every registered landmass with real backcountry; clampToCity treats the
  union as one surface and exempts the player entirely (world.js:715-751).
- FLAT rect 12,770 × 8,819 m; measured plate 17,728 × 15,782 m; 108 km
  published ocean (world/layout.js:160-165, :579-582; continent.js:455-464).
- **17 registered settlements** (towngen.js:950 → `CBZ.settlements`):
  mainland downtown + annex, 4 mini-cities (Goldspire, Cape Harbor, Neon
  Reef, Foundry Flats — minicities.js:69-79), biome towns (Harvest Market,
  Pinecrest, Dry Gulch), and **five countries** (countries.js:175-307):
  Veridia (2 states), Kesh (monarchy, capital + 2 villages), Solara
  (city-state), Mbeya (capital + 3 villages), + the home republic — each
  with wealthLevel, govType, currency, and real built landmasses.
- 12 government complexes, Fort Brandt with counted hardware (5 tanks,
  jets, a B-2), 24 km of highway as data (7 named routes, highwaynet.js),
  a world-map UI that unions every region and labels every settlement
  (fullmap.js:75-116, :585-645).

Conquest, existing machinery:

- **turf.js — mainland-scale, COMPLETE**: 9 named zones over the lot grid,
  ownership stamped on world objects, capture by wipe/buy-out/out-recruit,
  drifting alliances, a kill feed, and a WIN CHECK: own every zone
  (turf.js:291). Its own header calls this "the POINT of Gang City."
- **polwar.js — nation-scale, ABSTRACT**: declare/upkeep/decay generalized
  from gangs.js, jurisdiction treasuries, fronts whose `position` 0..1
  collapse ends the war, conscription floors, procurement, desperate
  measures. civilwar.js fractures a country into two warring polity records;
  partition *permanently changes the map*. occupy.js already ships
  "fight your way up the boss tower" — a siege interior in waiting.

Missing: fronts currently resolve at a straight midpoint between capitals
(polwar.js:46-60 names this as the shipped FALLBACK — no causeway exists
between any two countries); occupation doesn't yet flip a city's `parent`
on the ground; and nothing physically marches (§3).

### 1e. The bridge (Bannerlord's actual trick) — 0% built, and the whole point

Bannerlord is two games glued by one transaction: abstract parties on a map
→ **battle scene loaded for that location** → casualties written back.
Attend it and it's real; don't and it's math.

This repo has both games and no glue:

- polwar.js:628-637 — the war tick: `sLoss = SOLDIER_RATE × intensity`,
  `tickFront` drifts position by combat-power ratio. Pure math, six
  soldiers/day.
- battle.html — the spectacular simulator whose outcome is a stats table
  and a reload.

The glue is small because both sides already speak the right language:
counted men on one side, per-man ledgers on the other, and a venue system
that already raises real places by name.

---

## 2. THE VENUES ARE NOT DUMB — THEY ARE ORPHANED

The owner's complaint ("the venues are dumb af") reads differently off the
code. 8 of 9 venues are the real world's own builders raised at authored
coordinates through studio.raise + a measured heightfield (battle.html
:287-331; studio.js:909-1110): the actual military island, the actual
airport, the actual seat of state, the actual Cape Harbor — and `city` is
the same towngen fabric every settlement in the world is grown from
(battle.html:840-866). KILL BOX is deliberately the control map.

What makes them feel dumb is that they are *reasons-free*: you fight AT
Cape Harbor for no reason, over nothing, with armies that belong to nobody.
The fix is not venue art; it is venue *selection*:

    venue = f(the campaign location under attack)

- Mainland zone battle → `studio.town({seed: zoneId, at: …})` — per-zone
  deterministic street battlefields, today.
- Mini-city / gov / base / harbor battle → their packs already exist in the
  manifest (studio.js:346-431). One row each was the whole cost.
- Country settlement battle → the same buildTown recipes countries.js
  already uses (countries.js:396-404), seed-matched; a manifest row + seed
  plumbing per settlement tier.
- Field battle between settlements → `studio.world("desert")` pattern +
  `studio.setWorld({groundAt})` (studio.js:878) with the continent's own
  0.35 µs ground oracle — the declared seam nobody has connected.

This is also the perf-correct shape: the live continent builds in one
21–31 s task at 442 MB heap with draw-call headroom "mostly exhausted"
(LOAD-NOTES.md:42,:101; recon-scale.md §8). A 500-man battle inside the
live city would fight the city for its own budget. The separate raised
scene — which battle.html already is — sidesteps it, exactly like
Bannerlord's own scene loads.

---

## 3. THE THREE GAPS, SIZED

### GAP A — battle I/O (small; days-scale waves)

1. **Roster in**: BATTLE-GRAND-PLAN §5's composer (contingents
   `[{archetype, count, options}]`, URL-serialized) is the prerequisite and
   is already designed. Extend the row one field: an optional list of
   per-man records `{name, training, weapon, hp}` so makeMan (battle.html:935)
   consumes identities instead of a uniform archetype. Every field it needs
   already exists on the man object.
2. **Result out**: endWar (battle.html:3072) emits
   `{winner, perMan: [{id, name, alive, kills, hits}], duration, seed}` —
   the data is in `men[]` and the stats/GUNS ledgers now; expose it through
   `__battle.audit()` (precedent) + localStorage/postMessage for a host page.
   The determinism law makes every battle result replayable by URL.

### GAP B — named rosters that survive (small-medium)

- gangs.js:2924 `packRoster` collapses members to `{rank: count}` and
  :3038 `adjustRoster` respawns fresh bodies. Upgrade the blob to per-member
  rows `{name, rank, gstat, weapon}` riding the existing `led.gangwar`
  save (the rider pattern is house idiom — worldstate.js:321). The MP
  worldBlob currently *excludes* the player's crew entirely
  (netpersist.js:124) — same fix, same shape. identity.js and the server
  `people` table (server/db.js:118: sid, alive, position, JSON) are already
  the right storage for the named tier.

### GAP C — wars fought as battles (medium; this is the game)

Wire the three existing war systems to OFFER a battle when the player is
present, and write the result back:

- **Gang/turf war** (the owner's literal pitch): a raid or zone flip with
  the player present → launch the battle from the two crews' actual named
  rosters at `studio.town(seed=zone)`; dead members leave `gang.members`
  and drain nothing (they were real bodies); outcome drives captureLot /
  flipZoneLots instead of the ambient resolution. turf.js's win check is
  already the campaign victory. **This alone is "build an army, the dead
  stay dead, conquer the map."**
- **polwar front**: attended front battle spawns from `mil.soldiers`-scaled
  contingents at the front's venue; casualties debit `mil` via
  applyCasualties (polwar.js:409); the win applies a large one-time
  front.position shove. Unattended fronts keep the math — which is exactly
  Bannerlord's autoresolve.
- **civilwar / coup set-pieces**: the Fort Brandt convoy assault the
  MASTER-PLAN promises ("a scripted battle the player can join either side
  of") becomes a battle.html scene instead of a script.

Player-as-combatant: medium. The city already runs the player + crew vs
gang squads through the same combat_iq; the battle page runs cameras only.
Either (a) port the city player controller into the battle page, or
(b) first ship attended battles at city scale (10–40 men, in-world, already
works today via raid orders) and keep the 500-man page as the spectator/
autoresolve theater. (b) costs nothing and is honest.

### GAP D — armies that visibly march (large; optional; defer)

The honest hard part, and the one Bannerlord itself dodges with map pips:
citynav is mainland-only (citynav.js:76-80), orders past 300 m are dropped
by design (fortresponse.js measured why), FORT_CONVOY is OFF with its seam
named (police.js:2560-2640 owns the working convoy arc, cop-shaped),
INFINITE-WORLD.md streaming is 0% at ~13–20 person-weeks.

The cheap 90%: parties as *abstract* movers along highwaynet's 24 km of
route polylines via the schedule.js fastForward idiom ("advance position
along path mathematically"), drawn as pips on fullmap — which already draws
every settlement, road and region. Convoys become set dressing near the
player later, through the police.js seam. Do not chunk-stream the world to
ship this game.

---

## 4. WHAT THIS REPO HAS THAT BANNERLORD DOESN'T

Worth saying, because the question was "how close" and in places the answer
is "past it":

- **53-species beast armies** already fight in the battle page (bestiary/
  beasts packs); companions.js gives tamed war-beasts dispositions; ORCAS
  VS SHARKS is a planned menu row (BATTLE-GRAND-PLAN §4).
- **Dynasties**: familytree.js, births.js, marriage.js, inheritance.js,
  crown.js (crown-as-bloodline with legitimacy, pretenders, self-coronation)
  — Bannerlord's clan layer with more teeth.
- **Regime politics**: elections, approval, regimes.js transition graph,
  statecraft.js office powers, migration, a misery-driven civil war with
  permanent partition.
- **Captives**: restrain.js + captives.js already track "who do I have and
  who did they take" — post-battle prisoners are a UI away.
- **A real MP substrate**: Terraria-style world files, world-host election,
  a Node/SQLite server with people/bases/polity tables (server/db.js).

## 5. EXECUTION ORDER, IF THE OWNER SAYS GO

1. **A — battle I/O** (composer + result blob). Independently useful; makes
   every future consumer possible; zero risk to the beloved sim.
2. **B — named rosters persist** (packRoster v2 + player-crew blob).
3. **C1 — attended TURF battles** with write-back and captureLot on the
   line. The owner's pitch is complete here, at gang scale, on the map that
   already has the win condition.
4. **C2 — attended polwar fronts + settlement venues** (venue = f(front)).
   Conquest flips `parent`; occupation posture via garrison.js.
5. **D — map-layer armies** (pips on fullmap, fastForward marches), then
   convoy dressing, then — only if the game demands it — real marching.

The command layer (BATTLE-GRAND-PLAN §2, on ice) slots in anywhere and
makes every battle better; it is orthogonal to all five steps.

*Filed by the review wave on claude/npc-war-game-review; no game code was
touched.*
