# PILLAR: NPC WAR IS A BATTLE SANDBOX (games/battle.html)

> Owner direction, 2026-09-04, verbatim where it matters: "npc war is the best
> thing in this codebase, its the purest thing." "the settings rn are dumb af."
> "eventually its a battle sandbox, you can just put a f35 on a side like a gun
> and one of the npcs will fly the f35 or a truck and the npcs will get in it,
> or a tank." "npc war can be a small game with no game, its just you make up
> battles and watch, like who would win x." "would 1 marine beat 1000 roman
> legion." "a megalodon vs 10 orcas." "its really a click getter and thing
> anyone wants to see once." "open water and open dunes are great, all the
> fake settings are dumb, but they could be brilliant eventually. i dont want
> to go full open dunes open water only but the simplicity is better, we will
> consider."
>
> STATUS: direction only. Nothing deleted, nothing built. The owner said "we
> will consider", so this page records the decision space and what is true
> today, so the wave that acts on it starts from facts.

## 1. The thesis, in one line

NPC War is not a game. It is a question machine: two rosters, one ground, START,
watch. Everything on the setup card that is not "who", "how many", "holding
what" and "where" is friction. The ground is a stage for the question, never
the subject.

## 2. What is true today (read off the code, 2026-09-04)

### The ten grounds

`MAPS` in games/battle.html:405. Three kinds of row, though the file presents
them as one list:

| kind | rows | what it is |
|---|---|---|
| honest terrain | `dunes`, `water` | a height function and nothing else. No packs (water) or one biome pack (dunes). The fight IS the picture. The owner's two keepers. |
| the control | `arena` (KILL BOX) | flat yard, crates, four walls, `packs: []`. Exists so "anything wrong here is the men, not the map". A tool, not a setting. |
| raised venues | `city`, `island`, `field`, `gov`, `harbor`, `marina`, `speedway` | `studio.raise()` of a real Gang City place. The page's header argues these are "not stage flats" because the geometry is real. That argument is about honesty of construction. The owner's complaint is about honesty of PREMISE: nobody asks "who would win, 100 lions or 1000 dogs, at the speedway". |

Only six of the ten have a tuned spawn gap (battle.html:1343). `gov`, `harbor`,
`marina`, `speedway` fall to the 150 default or to whatever their spawner
measures. Every water matchup already hard-pins `map: "water"` (battle.html:756)
because "8 orcas v 1 megalodon on the kill box is not a matchup, it is a bug".
That comment is the whole setting argument in miniature: the ground should be
implied by the question, not picked from a grid of ten.

### The roster

- Men: 5 trainings (`TRAININGS`), 13 guns + MIXED + EVERYTHING + FISTS
  (`GUN_ORDER`). The gun is a per-side dropdown. This is the seam the owner's
  "put an F-35 on a side like a gun" idea plugs into: `redW`/`blueW` already
  mean "what this side is holding".
- Animals: the whole bestiary, READ from `CBZ.WILDLIFE_SPECIES`, land and
  aquatic groups. Mixed sides (`"men|dolphin"`) work.
- Presets: 5 size buttons, 14 matchup buttons, FIND MY MAX.

### The fork nobody turned off

src/warlord/battle.js header: "THE DONOR IS games/battle.html AND THE REUSE IS
THE POINT ... that machine with two things added and one thing removed." It is
a copy, not a call. Since the fork, the warlord copy got optics per weapon,
real rounds, stances, morale, and dune hull-down cover (commit 89c2acb), and
battle.html got none of it:

| grep | games/battle.html | src/warlord/battle.js |
|---|---|---|
| optic | 0 | 2 |
| hull-down | 0 | 7 |
| morale | 0 | 68 |

So "the purest thing in the codebase" is now the OLDER of two battle engines,
and the one venue the owner likes most (the dune, hull-down, optics) is the
one the warlord copy has and NPC War does not. The setting question and the
fork question are the same question. Whatever ground survives, the fight on it
should be one engine with two front doors (spectator, commander), not two
engines that share a grandfather.

### Vehicles: what exists, what does not

The owner's long-term ask ("an NPC will fly the F-35 / get in the truck / tank")
needs a BRAIN that drives a machine at an enemy. Census of donors:

| machine | asset exists | player can drive | an NPC can drive it AT an enemy |
|---|---|---|---|
| tank, armored truck | yes (city/militaryvehicles.js, island motor pool) | yes, turret tracks mouse, fires real shells | NO. Player-only drive sim. |
| jet, heli | yes (playeraircraft.js, militaryvehicles.js) | yes | NO for the jet. The police heli (city/aircraft.js) hunts the PLAYER only; airtraffic.js orbits bands and shoots nothing. |
| technical (pickup + LMG) | yes (warlord/mounts.js, 4 seats) | n/a | PARTLY. It is a mount in the warlord campaign; the gun is a real `buildActorWeapon("lmg")`. Closest donor for "NPCs get in a truck". |
| horse, camel | yes (warlord/mounts.js, mounted-riders preset) | n/a | yes, cavalry charge lands on a line. The one working "NPC in a vehicle" combat model. |
| boats | yes (battle.html seaFleet, men come off them) | n/a | NO. Scenery the men spawn off. No crew, no helm. |
| cars | yes | yes | traffic.js drives a road graph. Useless on dunes/water: no roads. |

Conclusion: there is no NPC vehicle brain in the repo. Mounts are the model to
generalise (a body with a rider, a speed, a reach, a weapon), not the car or
aircraft controllers, which are keyboard-shaped.

## 3. The decision space (owner: "we will consider")

**A. Keep ten grounds, reorder.** Cheapest. Dunes and water first, kill box
last, venues in the middle. Nothing gets simpler.

**B. Two grounds on the card, venues behind a fold.** Recommended. The setup
card shows OPEN DUNES and OPEN WATER. A "somewhere real" disclosure opens the
seven venues. Matchups keep pinning their own map. Nothing is deleted, the
venues stop costing attention, and if a venue later becomes "brilliant" (the
airport as a runway assault, the marina as a boat fight once boats have crews)
it is promoted by moving one row, not by rebuilding.

**C. Two grounds only.** What the owner said he does NOT want yet. Delete
seven rows and their spawners. Real simplification, real loss of the
airport-with-jets picture that the F-35 idea wants later.

**D. Ground implied by the question.** Aquatic roster on either side means
water. Otherwise dunes. Venues only via matchup buttons. This is where B ends
up once vehicles exist (an F-35 side implies a strip to take off from, which is
the one honest reason the island venue exists).

Recommendation: B now, D as the target. Either way, first merge the warlord
battle improvements back so the spectator page is the best copy again.

## 4. The wave that acts on this, when it comes

1. One battle engine. Lift optics, real rounds, stances, hull-down, and morale
   (behind a spectator-off default; the owner wants armies that fight to the
   last man on the spectator page) out of src/warlord/battle.js into shared
   engine files both pages call. The warlord page keeps YOU and morale-on.
2. The card: option B above. Dunes and water on the card, venues folded.
3. Vehicles as a weapon row. Extend `redW`/`blueW` with machines. Donor is
   warlord/mounts.js (rider + machine + reach + weapon), not militaryvehicles.js.
   Order: technical (sits on the existing mount seam), tank (a technical with
   a turret and armour that ignores rifles, see armored.js's 94% wrap), heli
   (a mount with altitude), jet last (needs a strip, which is the first honest
   reason the island venue exists).
4. Big numbers. "1 marine vs 1000 legion" is a spawn-count and a melee-roster
   question. Melee already exists (IQ.melee, PUNCH table, FISTS row). A sword
   and a shield are two `buildActorWeapon` entries and a reach number. The
   1000 side is a FIND MY MAX question, measured, not promised.
5. Share the result. "A click getter, a thing anyone wants to see once" means
   the URL IS the matchup (`?r=orca:10&b=megalodon:1&map=water`) so a fight
   can be sent. Half of that already exists (`?seed`, `?go` on warlord).

## 5. What this page does NOT authorise

No deletion of venues. No new engine. The owner said "we will consider".
