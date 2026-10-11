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

There are three runs, all on the same harness (6-16 seeds a row, sides swapped per seed):

- **before**: origin/main at ec11d502 (gorilla, elephant, rhino, cheetah, lion and scale merged),
  plus only the seed plumbing, which changes no behaviour.
- **fixed**: the same tree with this branch's fixes.
- **final**: this branch after merging origin/main at 551b0324. That adds the tiger, the bears,
  physics ("bodies have mass", the `impact` cause), armour, Humvee and mountain goat. This is the
  state of the branch.

| matchup | band (A wins) | before | fixed | final | owner of what is left |
|---|---|---|---|---|---|
| 1 lion v 1 Bengal tiger | 30-60% | 88% FAR | 100% FAR | 19% OUT | tiger (F1) |
| 1 brown bear v 1 tiger | 50-90% | 75% IN | 81% IN | 19% FAR | bears + tiger (F1, F2) |
| 1 brown bear v 1 lion | 55-92% | 0% FAR | 8% FAR | 17% FAR | bears (F2) |
| 1 gorilla v 1 lion | 0-30% | 25% IN (8 draws) | 50% OUT | 50% OUT | gorilla (F3) |
| 1 gorilla v 1 tiger | 0-25% | 92% FAR | 100% FAR | 42% OUT | gorilla (F3) |
| 10 gray wolves v 1 brown bear | 25-80% | 19% OUT (13 draws) | 0% FAR | 75% IN | |
| 1 elephant v 1 lion | 85-100% | 60% FAR (4 draws) | 100% IN | 100% IN | |
| 1 elephant v 6 lions | 50-100% | 0% FAR (9 draws) | 90% IN | 100% IN | |
| 1 white rhino v 1 lion | 80-100% | 100% IN | 100% IN | 100% IN | |
| 1 gray wolf v 1 dog | 60-98% | 0% FAR (10 draws) | 40% OUT | 100% OUT (above) | |
| 1 tiger v 1 unarmed man | 95-100% | 100% IN | 100% IN | 100% IN | |
| 1 tiger v 10 unarmed men | 80-100% | 25% FAR | 33% FAR | 100% IN | |
| 1 tiger v 30 unarmed men | 35-95% | 0% FAR | 0% FAR | 67% IN | |
| 1 tiger v 100 unarmed men | 5-60% | 0% OUT | 0% OUT | 50% IN | |
| 1 gorilla v 10 unarmed men | 55-100% | 92% IN | 100% IN | 100% IN | |
| 50 unarmed men v 1 gorilla | 60-100% | 0% FAR | 0% FAR | 0% FAR | gorilla / ape_combat (F4) |
| 100 unarmed men v 1 gorilla | 85-100% | 0% FAR | 13% FAR | 13% FAR | gorilla / ape_combat (F4) |
| 1 brown bear v 10 unarmed men | 80-100% | 40% FAR | 50% FAR | 100% IN | |
| 1 tiger v 10 riflemen, 150 m | 0-10% | 0% IN | 0% IN | 0% IN | |
| 1 tiger v 3 riflemen, 12 m | 15-70% | 0% OUT | 0% OUT | 0% OUT | tiger + weapons (F6) |
| 1 tiger v 1 rifleman, 10 m | 40-90% | 0% FAR | 0% FAR | 0% FAR | tiger + weapons (F6) |
| 1 brown bear v 5 riflemen, 150 m | 0-15% | 0% IN | 0% IN | 0% IN | |
| 1 elephant v 10 AK-47s | 0-40% | 0% IN | 0% IN | 0% IN | elephant + weapons (F7) |
| 6 lions v 10 riflemen | 0-30% | 0% IN | 0% IN | 0% IN | |
| 1 gorilla v 5 riflemen | 0-5% | 0% IN | 0% IN | 0% IN | |
| 1 M1 Abrams v 200 riflemen | 90-100% | 100% IN, 12 men shot by their own a battle | 100% IN, 0 | 100% IN, 0 | |
| 1 M1 Abrams v 50 men, 1 in 4 RPG | 30-95% | 75% IN | 13% OUT | 63% IN | M1 (F8) |
| 1 Bradley v 30 riflemen | 80-100% | 100% IN | 100% IN | 100% IN | |
| 1 Bradley v 30 RPGs | 0-60% | 50% IN, 11 self-kills a battle | 0% IN, 0 | 0% IN, 0 | |
| 1 Stryker v 30 riflemen | 70-100% | 100% IN | 100% IN | 100% IN | |
| 1 v 1 unarmed, same training | 30-70% | 44% IN | 44% IN | 44% IN | |
| 10 v 10 unarmed, same training | 25-75% | 50% IN | 50% IN | 67% IN | |
| soldier v civilian, bare hands | 75-100% | 100% IN | 100% IN | 100% IN | |
| 10 soldiers v 15 civilians, bare hands | 55-100% | 100% IN | 100% IN | 100% IN | |
| 30 v 30 riflemen | 25-75% | 58% IN | 50% IN | 50% IN | |
| 20 elite v 20 thugs, AK-47 | 75-100% | 58% OUT | 75% IN | 75% IN | |

The tallies:

| run | IN | OUT | FAR |
|---|---|---|---|
| before | 20 | 4 | 12 |
| fixed | 21 | 5 | 10 |
| final | 26 | 5 | 5 |

The headline win rates moved less than the way battles end:

- the riflemen's dead against an Abrams included 12 men shot by their own side;
- RPG sections killed 11 of their own;
- a third of the animal fights never ended.

The five FAR rows left are inside unit files: bears, gorilla and tiger. They are marked `known`
in expectations.json with the reason, so `npcwar-balance-check` passes on them and fails on
anything new.

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
   125 kg each, and a 45 kg wolf, a 50 kg cheetah and a 30 kg dog 107-125 kg. I fixed it by reading
   the unit file's `stats.mass` and `CBZ.ballistics.SPECIES`. The physics agent landed the same fix
   on main at the same time (`anatomy()` -> `ballistics.anatomyOf`), so the merge keeps main's
   version: one implementation.
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
species**. Men have 90-160 hp (by training). Here is a rule that reproduces the species already
tuned by mass (lion, elephant, rhino):

- `hp ≈ 140 x (mass / 80)^0.75` (an elite man is 140 at 80 kg)
- strike `dmg` on a man ≈ `60 x (mass / 190)^0.67` (the lion's 60 at 190 kg; bite force goes with
  muscle cross-section)

Numbers as fielded in the final run, for the first individual of a 1v1:

| species | individual mass | hp fielded -> rule | dmg -> rule |
|---|---|---|---|
| Bengal tiger (seed 0 is a male) | 347 kg (200 x 1.12^3 x sex) | **442 -> ~330** | 50 -> 60-65 |
| lion | 190-200 | 214-246 (ok) | 60 (ok) |
| brown bear (the first drawn is a sow) | 188 | 177 (ok for a sow) | 74 (ok) |
| gorilla | 170 | **284 -> ~220** | 25-40, see F4 |
| gray wolf | 45 | 66 -> ~90 | ok |

- **F1. Tiger** (`src/units/species/bengal_tiger.js`). Before the tiger landed, every tiger row
  was FAR because the numbers were the old bestiary's (hp 150, dmg 35, chase 8.1). The redraw
  fixed the men rows: 10, 30 and 100 unarmed men are all IN now. It overshoots against other
  animals. The tiger has twice a lion's hp (442 v 214), so the lion wins 19% (band 30-60%) and a
  brown bear 19% (band 50-90%). Suggest hp about 330 for a 347 kg male (the mass rule), or base
  the hp on `stats.mass` 200, not the size-cubed individual mass.
- **F2. Brown bear** (`src/units/species/brown_bear.js`). The first brown bear drawn is a 188 kg
  sow with hp 177, while the tiger's seed 0 is a male. Every 1v1 is therefore sow v male, and a
  grizzly loses to both big cats: 17% against a lion (deals 135 dmg in a fight, the lion 178) and
  19% against a tiger. Suggest seed 0 is a boar (as the tiger does), so a "1 brown bear" matchup
  fields the 300 kg animal the label suggests. Then re-check against the lion.
- **F3. Gorilla** (`src/units/species/gorilla.js`, gorilla agent). The gorilla has hp 260 for
  170 kg (284 fielded) and four attack styles: smash, bite, sweep and charge. It beats a lion 50%
  (band 0-30%) and the new tiger 42% (band 0-25%; it was 100% against the old tiger). In reality it
  loses to both (leopards prey on gorillas). Suggest hp about 220 and fewer free attacks against a
  big cat: the ape_combat repertoire should not out-trade a cat that lands a throat bite.
- **F4. 50 / 100 men v a gorilla** (`src/systems/ape_combat.js`, gorilla agent). The men lose
  87-100%. The gorilla kills 19 of 50 (34 of 100), and **"clubbed with a body" does 2,000-3,400 hp
  a battle** (about 43 hp to every man the swung body touches, 11-21 kills). Then the civilians'
  army breaks: 87 of 100 routed. Suggest that a swung body knocks down (about 10-15 hp plus a KO)
  instead of killing. Morale against one animal is a design question for the AI owner (ai/morale):
  the band assumes men who keep coming.
- **F5. Wolves** (canids agent). This is IN on final: 10 wolves v a bear 75%, after the
  flee fix and the canids' redraw. In the "fixed" run, before that, a wolf bite on a 300 kg bear
  landed about 6 hp and the pack fought to the death (the bear killed 7 of 10). Real packs harry
  and retreat. The wolf v dog row now reads 100% (band 60-98%), which is fine.
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
- **F8. Abrams v 50 men with 12 RPGs** (M1 agent). This is IN (63%) on final. In the
  "fixed" run (before armour/physics), once the RPG sections stopped killing themselves the
  Abrams won only 13%: 3.3 RPG hits on its sides killed it. PG-7V penetrates about 260-300 mm, so
  losing to a side shot is right. The Abrams should still keep its front to the threat
  (`tactics.faceThreat`) and use its coax at range. Watch this row.
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
