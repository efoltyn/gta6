# NPC War: balance, measured

NPC War is a fast sim, so it can check its own animals. `tools/npcwar-arena.mjs` runs a matchup
over N seeds of the page's own sim in node (the real bestiary bodies, gait rig, traits,
creature_combat, ape_combat, bodymass, combat_iq and ballistics; no Chrome). It reports win %,
time, casualties, who dealt what and how, wound zones and morale. Each matchup is held to a
real-world band in `data/npcwar/expectations.json`. `tools/npcwar-balance-check.mjs` is the fast
subset for the testbus.

```
node tools/npcwar-arena.mjs                      the whole table (36 matchups, ~400 battles, ~15-40 min under load)
node tools/npcwar-arena.mjs --only tiger         some of it
node tools/npcwar-arena.mjs --a lion --b men --n 1v10 --bw fists --bt civ --gap 12 --seeds 16
node tools/npcwar-balance-check.mjs              ~100 s; FAILS on a new FAR, lists the known ones
NPCWAR_ROOT=<extracted tree> node tools/npcwar-arena.mjs    the same table on another tree (a before)
```

How to read it: **IN** means the win rate is inside the band. **OUT** means the point estimate is
outside the band but the 95% interval still touches it, so re-run with more seeds before acting.
**FAR** means the whole 95% interval is outside the band, so the sim is confidently wrong. Side A
takes the first slot on even seeds and the second on odd ones, because the dunes have a better
side. Without that, 30 identical riflemen won 83% from slot A. Each run writes
`~/harness/out/gta6/npcwar-arena/<stamp>.txt` and `.json`.

## The matrix, 2026-10-11

**Before** is origin/main at ec11d502 (gorilla, elephant, rhino, cheetah, lion and scale merged),
plus only the seed plumbing, which changes no behaviour. **After** is branch `npcwar-balance`.
Results use 6-16 seeds per row.

| matchup | band (A wins) | before | after | owner of what is left |
|---|---|---|---|---|
| 1 lion v 1 Bengal tiger | 30-60% | 88% FAR | 100% FAR | tiger (F1) |
| 1 brown bear v 1 tiger | 50-90% | 75% IN | 81% IN | |
| 1 brown bear v 1 lion | 55-92% | 0% FAR (4 draws) | 8% FAR | bears (F2) |
| 1 gorilla v 1 lion | 0-30% | 25% IN (8 draws) | 50% OUT | gorilla (F3) |
| 1 gorilla v 1 tiger | 0-25% | 92% FAR | 100% FAR | tiger (F1), gorilla (F3) |
| 10 gray wolves v 1 brown bear | 25-80% | 19% OUT (13 draws) | 0% FAR | canids (F5) |
| 1 elephant v 1 lion | 85-100% | 60% FAR (4 draws) | **100% IN** | |
| 1 elephant v 6 lions | 50-100% | 0% FAR (9 draws) | **90% IN** | |
| 1 white rhino v 1 lion | 80-100% | 100% IN | 100% IN | |
| 1 gray wolf v 1 dog | 60-98% | 0% FAR (10 draws) | 40% OUT (0 draws) | canids (F5) |
| 1 tiger v 1 unarmed man | 95-100% | 100% IN | 100% IN | |
| 1 tiger v 10 unarmed men | 80-100% | 25% FAR | 33% FAR | tiger (F1) |
| 1 tiger v 30 unarmed men | 35-95% | 0% FAR | 0% FAR | tiger (F1) |
| 1 tiger v 100 unarmed men | 5-60% | 0% OUT | 0% OUT | |
| 1 gorilla v 10 unarmed men | 55-100% | 92% IN | 100% IN | |
| 50 unarmed men v 1 gorilla | 60-100% | 0% FAR | 0% FAR | gorilla / ape_combat (F4) |
| 100 unarmed men v 1 gorilla | 85-100% | 0% FAR | 13% FAR | gorilla / ape_combat (F4) |
| 1 brown bear v 10 unarmed men | 80-100% | 40% FAR | 50% FAR | bears (F2) |
| 1 tiger v 10 riflemen, 150 m | 0-10% | 0% IN | 0% IN | |
| 1 tiger v 3 riflemen, 12 m | 15-70% | 0% OUT | 0% OUT | tiger (F6), weapons (F6) |
| 1 tiger v 1 rifleman, 10 m | 40-90% | 0% FAR | 0% FAR | tiger (F6), weapons (F6) |
| 1 brown bear v 5 riflemen, 150 m | 0-15% | 0% IN | 0% IN | |
| 1 elephant v 10 AK-47s | 0-40% | 0% IN | 0% IN | elephant (F7, the rounds it takes) |
| 6 lions v 10 riflemen | 0-30% | 0% IN | 0% IN | |
| 1 gorilla v 5 riflemen | 0-5% | 0% IN | 0% IN | |
| 1 M1 Abrams v 200 riflemen | 90-100% | 100% IN | 100% IN (fratricide 12/battle -> 0) | |
| 1 M1 Abrams v 50 men, 1 in 4 RPG | 30-95% | 75% IN | 13% OUT | M1 (F8) |
| 1 Bradley v 30 riflemen | 80-100% | 100% IN | 100% IN | |
| 1 Bradley v 30 RPGs | 0-60% | 50% IN (11 self-kills/battle) | 0% IN (0 self-kills) | |
| 1 Stryker v 30 riflemen | 70-100% | 100% IN | 100% IN | |
| 1 v 1 unarmed, same training | 30-70% | 44% IN | 44% IN | |
| 10 v 10 unarmed, same training | 25-75% | 50% IN | 50% IN | |
| soldier v civilian, bare hands | 75-100% | 100% IN | 100% IN | |
| 10 soldiers v 15 civilians, bare hands | 55-100% | 100% IN | 100% IN | |
| 30 v 30 riflemen | 25-75% | 58% IN | 50% IN | |
| 20 elite v 20 thugs, AK-47 | 75-100% | 58% OUT | 75% IN | |

The tally goes from **20 IN, 4 OUT, 12 FAR** before to **21 IN, 5 OUT, 10 FAR** after. Several
win rates hardly moved, but how the battles end changed a great deal. Before: a quarter of the
riflemen's dead against an Abrams were shot by their own side, RPG sections blew themselves up,
and a third of the animal fights never ended. All ten FAR rows left are inside unit files whose
agents are still running. They are marked `known` in expectations.json, so the check passes on
them and fails on anything new.

## What I fixed (shared files)

1. **A rifle no longer fires at a tank** (`src/battle/fire.js`, `armsCanHurtHull`). Two hundred
   riflemen put about 260 rounds a battle into an Abrams that no 7.62x39 can dent. The rear ranks,
   shooting through the front ones at a hull among them, killed **12-15 of their own men a battle**,
   a quarter to a third of all their dead. A man now fires at a hull only if his round, at that
   range, defeats its thinnest face (side or rear). The vehicles' own machine guns already followed
   this rule. After the fix, rifle hits on the Abrams went from 264 to 0 and fratricide from 12.3
   to 0.
2. **The firing-lane rule covers the whole line** (`mateInLane`). It used to look only at the first
   12 m and a 0.62 m-wide lane. Half the blue-on-blue hits were on mates 16-45 m out, men who had
   run ahead toward the mark. The rule now walks the line to the mark (up to 90 m) in grid-cell
   steps, in a cone that widens about 12 mil.
3. **RPGs** (`armsLauncher`, `tubeClear`, `rocketBlast`). Thirty men with RPG-7s against a
   Bradley killed **11 of their own a battle** and the Bradley about 0.5. A section on a dune top
   fired down at a hull 55 m below and every round hit the sand 6 m in front of the tube. The
   warhead used weapon-data's 13 m city radius, a 7.2 m kill disc. Now:
   - the lane rule applies to launchers;
   - a danger-close rule holds fire when a friend is inside the warhead's kill radius of the mark;
   - the tube line must clear the ground (if it does not, the man walks to the lip);
   - the blast radius comes from the ballistics table (`ROCKET.pg7v.blast` 9 m, M433 6 m).
   Self-kills dropped from 10.9 to 0 a battle, and the Bradley now dies to 30 RPGs, as it should.
4. **An animal that gets away has got away** (`src/battle/ai/think.js`, `beastEscaped`). A
   beaten animal faster than its pursuer ran off the map forever. Out of 10 battles, 1 wolf v 1 dog
   went 10 draws, with the dog 1,400 m out and still running. A lion that quit led an elephant in
   circles, and elephant v 6 lions went 9 draws. Any animal put to flight now leaves the field as
   fled, by the men's own rule (FLEE_GAPS start gaps, or 45 s of running). This covers the
   think.js beaten branch and a species file's own nerve, such as the lion's quit. Elephant v lion
   went from 60% to 100% and elephant v 6 lions from 0% to 90%.
5. **Body mass for fists and bites** (`src/systems/bodymass.js`). The mass used for `meleeScale`
   and `meleeAbsorb` came from `125 x scale^3`. That made an African elephant and a white rhino
   125 kg each, and a 45 kg wolf, a 50 kg cheetah and a 30 kg dog 107-125 kg. The game already
   states these weights twice: the unit file's `stats.mass` and `CBZ.ballistics.SPECIES`. Both are
   now consulted before the cube. One truth per number.
6. **The individual's size draw in battle is half the world's spread** (`src/battle/beasts.js`).
   The bestiary's 0.62-1.86 length draw (0.24-6.4x mass) suits a population. It does not suit an
   army of adults. One gorilla drew 0.66 and fought as a 24 kg, 86 hp animal. The battle now keeps
   the direction and half the distance from the norm, which is about ±15% length, like real
   adults.
7. **The battle has a seed** (`settings.js` `BATTLE_SEED`, `state.js`, `beasts.js`). `?seed=N`
   names the battle. Without it the series round (sa + sb) is the seed, so round 1 is unchanged
   and rematches differ. Before this, every round of a best-of-5 between two AI armies was the
   same battle, and "1 lion v 1 tiger" was always the same two individuals.

Ship hygiene: keys `bal1011` on settings, state, beasts, fire, ai/think and studio.js (bodymass
rides the studio key). `node tools/npcwar-check.mjs` passes 327/327. `npcwar-headless` scenarios
1, 8 and 9 pass.

## Findings for the unit agents (their files; I did not edit them)

The common cause behind F1-F4 is that **hp and strike damage do not follow body mass across
species**. Men have 90-160 hp (by training). A 220 kg tiger has 150 and a 300 kg bear 200, but a
170 kg gorilla has 260 and a 190 kg lion 215 with a 60 bite. Here is a rule that reproduces the
species already tuned by mass (lion, elephant, rhino):

- `hp ≈ 140 x (mass / 80)^0.75` (an elite man is 140 at 80 kg)
- strike `dmg` on a man ≈ `60 x (mass / 190)^0.67` (the lion's 60 at 190 kg as the reference;
  bite force goes with muscle cross-section)

| species | mass | hp now -> suggested | dmg now -> suggested | chase now -> suggested |
|---|---|---|---|---|
| Bengal tiger | 220 | **150 -> 290** | **35 -> 65** | **8.1 -> 15** (burst; the lion file has 14) |
| brown bear | 300 | **200 -> 340** | **30 -> 60** | 4.8 -> 11 (a grizzly charges at 15 m/s) |
| polar bear | 450 | 240 -> 380 | 32 -> 70 | |
| black bear | 120 | 170 -> 190 | 24 -> 45 | |
| gorilla | 170 | **260 -> 220** | 40 -> 50 (keep), see F4 | |
| gray wolf | 45 | 55 -> 90 | 19 -> 22 | |
| lion (reference) | 190 | 215 (ok) | 60 (ok) | 14 (ok) |

- **F1. Tiger** (`src/units/species/bengal_tiger.js`, tiger agent). Every tiger row is FAR
  because the numbers are still the old bestiary derivation (hp 150, dmg 35.1, chase 8.1). The
  lion wins 100% of 1v1s (lion 9.9 strikes and 162 dmg dealt per fight, the tiger 7.8 and 119). A
  gorilla wins 100%. Thirty civilians punch a tiger to death in 9 s: 64 punches at about 2.4 hp
  each kill a 167 hp animal. With the suggested numbers, the tiger takes about 120 punches, and a
  crowd breaks long before that.
- **F2. Brown bear** (`src/units/species/brown_bear.js`, bears agent). A bear loses 92% of fights
  with a lion, because the lion's 60 against the bear's 29.7 decides it. Ten civilians beat it half
  the time: the bear lands about 10 mauls (2.7 kills) and takes 88 punches. Raise dmg and hp per
  the table.
- **F3. Gorilla** (`src/units/species/gorilla.js`, gorilla agent). With hp 260 for 170 kg and five
  attack styles (smash, bite, sweep, charge, club), a gorilla beats a tiger 100% and a lion 50%.
  In reality it loses to both (leopards prey on gorillas). Suggest hp about 220 and fewer free
  attacks against a big cat: the ape_combat repertoire should not out-trade a pouncing cat that
  lands a throat bite.
- **F4. 50 / 100 men v a gorilla** (`src/systems/ape_combat.js`, gorilla agent). The men lose
  87-100%. The gorilla kills 19 of 50 (34 of 100), and **"clubbed with a body" does 2,000-3,400 hp
  a battle** (about 43 hp to every man the swung body touches, 11-21 kills). Then the civilians'
  army breaks: 87 of 100 routed. Suggest that a swung body knocks down (about 10-15 hp plus a KO)
  instead of killing. Morale against one animal is a design question for the AI owner (ai/morale):
  the band assumes men who keep coming.
- **F5. Wolves** (`gray_wolf.js` / canids agent). A wolf bite on a 300 kg bear lands about 6 hp
  (meleeAbsorb 0.33 x 18.9), so 10 wolves deal 68 hp a battle and the bear kills 7 of them.
  Real packs harry and retreat, and rarely die. Suggest the pack uses its nerve (quit when hurt,
  which now leaves the field as fled), plus hp about 90. In wolf v dog the wolf wins only 40%:
  wolf hp 55 at 45 kg against the dog's 55 at 30 kg.
- **F6. The ambush** (tiger agent, and the weapons agent for `ballistics.wound`). At 10-12 m a
  trained rifleman kills a charging tiger in 1.1-1.4 s and the tiger lands nothing, mostly with
  head shots (1.5 per kill). Two causes. The tiger charges at 8 m/s; a real one does 15-18 over
  20 m, so 10 m takes about 0.6 s, inside a man's 0.3-0.5 s reaction plus aim. And any lethal
  wound stops an animal at once; a heart-shot animal really carries on for 5-15 s, and only
  brain or spine stops it. Suggest adding an "already dead, still coming" window to the wound
  model for vital-but-not-CNS hits on animals.
- **F7. Elephant v 10 AK-47s** (elephant agent, weapons) is in its band, but it dies to about 9
  hits (2,290 dmg) in 12 s. Poachers fire dozens. Torso and leg hits deal hp straight off a 2,600 hp
  animal. Worth checking whether non-vital zones on a 6 t body should cost that much.
- **F8. Abrams v 50 men with 12 RPGs** (M1 agent). Now that the RPG sections stopped killing
  themselves, the Abrams wins only 13% (band 30-95). It kills 6.5 men by gun and 1.3 by HE in 28 s,
  and 3.3 RPG hits kill it (887 dmg). PG-7V penetrates about 260-300 mm. Side armour of 120 mm is
  right to lose, but the Abrams should keep its front to the threat (`tactics.faceThreat`) and use
  its coax at range. Check whether its rig takes side hits it should take on the front.
- **F9. Node fidelity: fists.** In node the men are stub rigs, so `systems/melee.js` (rig-level
  blows that can miss) never runs, and combat_iq's fallback lands every swing. Results for fists
  against animals therefore favour the men slightly. Man-on-man parity is unaffected (both sides
  get the same treatment).

## Not owned by a unit (for the AI / weapons owners)

- Grenade fratricide: about 1-3 friendly grenade kills per 30 v 30 rifle battle ("not near one of
  your own" is checked against the thrower's mark, not where the grenade lands after a bounce).
- 20 elite v 20 thugs now lands in its band (75%) once the sides are swapped per seed. Training
  still matters less than in reality: elite men kill 11.6 and thugs 5.2.
- Drawn rounds still happen (a round nobody wins is replayed). With BATTLE_SEED = sa + sb, a
  replayed round is the same seed. A drawn-round counter in the URL would fix that.
