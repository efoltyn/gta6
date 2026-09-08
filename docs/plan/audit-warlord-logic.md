# DESERT WARLORD — an audit of the exact game logic

**What this is.** A read-only description of what the game *is*, written so a designer
can see why the owner says it feels surface level. Everything here is a claim with a
`file:line` receipt. No code was changed.

**Scope.** `games/warlord.html`, `src/warlord/{core,campaign,match,territory,army,events,outpost,loadout}.js`
and `CONTRACT.md`, read in full. `battle.js`, `gunplay.js`, `mounts.js`, `warnet.js` are
another agent's territory and appear here only where the campaign calls into them.

**Item 9 (measured first-10-minutes) was SKIPPED.** `uptime` at the start of this audit
was `load averages: 13.60 12.47 9.88` and at the end `9.87 11.75 9.90` — above the load
gate of 8 for the whole session. Launching two headless Chromes plus a dev server on a
machine at load 10-13 would have produced timings that measure the machine, not the game.
Everything below is derived statically. **Section 10 substitutes a derived minute-by-minute
timeline** with the arithmetic shown, which is checkable without a browser.

---

## 1. THE LOOP

### 1.1 From START to the end screen

**Boot → menu.** The title card is three buttons: `RIDE OUT`, `CONTINUE` (if a save
exists), `MULTIPLAYER` (warlord.html:1222-1226). There is **no role picker, no difficulty,
no character creation, no seed picker in the UI** — `RIDE OUT` calls `W.newGame()`
(warlord.html:1227-1231).

**Day 1, 07:00, alone.** `newGame` sets `day:1, hour:7, gold:40, fame:0`, an empty army,
`you.wid = "sidearm"`, `hp 140` (core.js:1146-1176). The log line is literally
`"you ride out alone with a pistol and $40."` (core.js:1175). `C.enter()` puts you on a
`coastPoint` on a random bearing (campaign.js:652-658).

**The island is populated once.** `bandTarget()` = land km² × (1/0.55) clamped 60..260
(campaign.js:459-466); `smallTarget()` = that × `W.SMALL_PER_BIG` (1.4)
(campaign.js:575-582, core.js:843). The file's own measured figure for the shipped island:
**184 big + 258 small = 442 parties, ~14 500 men** (campaign.js:456-458). Six to nine
outposts go at oases, coastal landings and two interior night markets
(campaign.js:268-336). Territory cuts the island into **40 regions** (territory.js:350)
and gives each of core's five factions **one** home (territory.js:766-812) — day one,
34 of 40 provinces are unowned. `match.js` raises **14 named rival warlords** onto 14 of
those (match.js:206-210, 361-400) and fills their columns (match.js:427, 450-459).

**Then you ride.** That is the whole minute-to-minute verb loop, and it is very short:

| what you do | with what | receipt |
|---|---|---|
| tap the ground | a puff of sand marks it, the man rides there at 15.5 m/s | campaign.js:159, 1888-1955 |
| hold WASD / drag a stick | steer him directly, camera-relative | campaign.js:2144-2162 |
| tap a party | ride at it; it tracks as it walks | campaign.js:1856-1869, 1899-1927 |
| drag / Q / E / wheel / pinch | swing and pull the camera 16 m → 520 m | campaign.js:1612-1613, 1819-1838, 2138-2140 |
| press M or the MAP button | the strategic map | campaign.js:1615-1618, 1628-1637 |
| `,` `.` `0` or the slider | game speed 0.25× … 64× | warlord.html:1019-1025, core.js:1019 |

Everything else in the game happens **because you drove into something**: a party inside
26 m opens the encounter rail (`CONTACT = 26`, campaign.js:176, 3630-3638); an outpost
inside 46 m opens the trading rail (`OUTPOST_R = 46`, campaign.js:177, 3639-3652);
riding 1100-2600 m fires a road card (events.js:4014-4022).

Your hands are therefore: **point at a thing, then tap a word.** Eyes are on a column of
men following a breadcrumb trail behind a camera you can zoom out into a map. The only
time your hands do anything else is inside `battle.js` (a real first-person/commander
fight, other agent's territory) and in the outpost/armoury screens.

### 1.2 What a "dawn"/day is, in real seconds

- `HOUR_SECS = 45` — one in-game hour is 45 real seconds (campaign.js:166-173).
- A day is therefore **1080 s = 18 real minutes at 1×**.
- The clock advances on **wall time in every phase, never paused** — battles, menus, a
  backgrounded tab all keep it running (campaign.js:2028-2066, CONTRACT.md:150-158).
- The dawn crossing is at **hour 6** (`Math.floor((clockH - 6) / 24)`, campaign.js:2064).
- The game starts at **hour 7** (core.js:357), i.e. **just past dawn** — so the first
  dawn is 23 in-game hours = **17.25 real minutes** away at 1×.
- Speed is a real clock warp, not a multiplier: 0.25 … 64× (core.js:1019-1114). At 64×,
  a day is ~17 real seconds.

**What ticks at dawn**, in order:

1. `W.dawn()` (core.js:412-452) — `S.day++`, bill `W.payroll()`; if short, men walk from
   the bottom of the roster, capped at `SHED_CAP = 0.4` (core.js:393, 436-448).
2. `restAtDawn` (army.js:2148-2156) — clears every `wounded` flag, refills hp.
3. Outpost restock — one roll per gun line per depot against `W.gunRarity` (outpost.js:374-407).
4. `territory.dawn` (territory.js:1455-1478) — `raiseLevies()`, then your holdings' income,
   then `warDawn()`.
5. `events.js onDawn` (events.js:3770-3879) — reconcile provenance, roll weather, drift
   loyalty toward the bond ceiling at 0.3, +1.4 if paid / **−15 if not**, pressed men roll
   to desert, heat kills the wounded, mutiny/ringleader check, revenge columns arrive,
   `checkBoard()`, `bankruptCheck()`.
6. `match.js dawn` on `territory:dawn` (match.js:933-993) — top up rival columns from their
   garrisons, claim empty ground sat on for two dawns, retire broken warlords, resolve
   standing alliance offers, make at most one new offer to you.

**That is the entire simulation heartbeat, and it runs once every 18 real minutes at
default speed.** Everything a player would call "management" is gated behind it.

### 1.3 Every player verb in the game

Complete list of things a player can press that change state.

**Campaign (the island):**

| verb | where | what state it changes |
|---|---|---|
| tap ground | campaign.js:1930-1954 | `dest` (a ride target) |
| tap a party | campaign.js:1899-1927 | `chase`, `dest`; inside 41 m calls `engage()` |
| WASD / stick | campaign.js:2144-2162 | `S.you.x/z/yaw`; cancels `dest` |
| Q/E/drag/wheel/pinch | campaign.js:1819-1838, 2138-2140 | camera only |
| M / MAP | campaign.js:1615-1637 | opens territory map |
| speed slider, `,` `.` `0` | warlord.html:1004, 1019-1025 | `W.clock` scale (world runs faster) |
| HUD loyalty chip | events.js:3737 | opens the loyalty screen |
| HUD rank chip | events.js:3752-3760 | opens THE ISLAND leaderboard |
| HUD province chips | territory.js:1744, 1765 | opens the map / the ground rail |

**Encounter rail** (army.js:576-607) — up to six verbs:

| verb | effect |
|---|---|
| ATTACK | `W.battle.start({band})` — the real 3D fight (army.js:592-593, 658-667) |
| DEMAND | roll `W.surrenderChance`; win = whole roster becomes prisoners; lose = they hunt you and the fight starts **surprised + defending** (army.js:678-693) |
| HIRE | pay `hirePrice`, whole band joins your army (army.js:739-764). Never offered against `bandit` or `warlord` factions (army.js:160) |
| ROB | only at ≥2.6× power; takes their purse + all guns/armour, halves their wealth, they go hostile (army.js:179-183, 779-797) |
| INSPECT | a read-only roster screen (army.js:631-656) |
| RIDE AWAY | 8 s cooldown, they visibly walk away; a hostility roll may start a chase battle (army.js:841-897) |

**Ground rail** (territory.js:1675-1717), opened by the province chip:

| verb | effect |
|---|---|
| RAISE THE LEVY | moves the whole garrison roster into your army (territory.js:1667-1672, 2662-2684) |
| STORM | builds a one-off garrison band and starts a real battle (territory.js:1607-1633) |
| THE ISLAND | opens the map focused on this province |
| RIDE ON | closes the rail. **No state change at all.** |

**Map card** (territory.js:2587-2649): `RIDE HERE` (sets a ride destination),
`RAISE THE LEVY`, `−10 MEN`, `+10 MEN` (garrison transfer, weakest-first,
territory.js:2662-2684), `STORM`, and the four diplomacy verbs
`OFFER ALLIANCE / ACCEPT / REFUSE / BREAK` (territory.js:2642-2649).

**Outpost rail** (outpost.js ~620-637): `BUY`, `SELL`, `REST` (costs gold and calls
`W.dawn()`), `ARM THE MEN` → loadout, `RIDE ON`; inside the panels, buy a gun line, sell a
cart line, hire a tier, buy armour. **Armoury** (loadout.js): `AUTO-ARM`
(loadout.js:112-147), partial `ARM THE FRONT` / `HAND OUT` passes, per-man pickers.
**Aftermath** (army.js:2059-2140): `TAKE THE WILLING`, `PRESS EVERY MAN`,
`SHOOT THE UNWILLING`, `RIDE ON`. **Road cards**: 2-3 verbs each, section 5.
**Alliance rail** (match.js:1058-1077): `ACCEPT`, `REFUSE`. **End screen**
(events.js:3518-3526): `RIDE OUT AGAIN` (wipes the save), `THE CHRONICLE`.

**Grand total of distinct campaign-layer verbs: about 30, and roughly 22 of them are
"press a word, a number changes".** The three that require you to actually *do* something
with your hands are ATTACK, STORM and the duel — all three hand off to `battle.js`.

---

## 2. THE STATE

### 2.1 The schema, as it actually exists

`W.state` (core.js:353-379), verbatim:

```
seed, mode, phase, day, hour, gold, fame
you       {name, x, z, yaw, wid, armour, hp, maxHp, kills}
army      [soldier]              // you are NOT in it; armySize() adds 1
baggage   {wid: count}           // unassigned guns
armourBag {armourId: count}
prisoners [soldier]
bands     [band]
outposts  [outpost]
peers     {id: {...}}            // multiplayer
log       [{day,text,kind}]
stats     {battles, won, killed, lost, recruited, conscripted, executed}
flags     {}                     // events.js's whole bucket lives in here
```

**soldier** (core.js:163-179): `{id, name, tier, wid, armour, hp, maxHp, kills, battles,
wounded}` — ten fields, `tier` one of four (core.js:110-119).

**band** (core.js:706-743): `{id, faction, name, colour, x, z, men[], gold, goal, mood,
cooldown, wealth, kind, hostile}` plus campaign-added `{y, yaw, scared, think, pause, spd,
acc, held}` (campaign.js:594-604, 3211-3219) and, on a rival's column, `warlordId`
(match.js:550-566).

**region** (territory.js:506-517): `{id, idx, name, kind, x, z, lx, lz, areaKm2, arable,
wells, neighbours[], border{}}`. Ownership lives separately in
`S.territory = {own, gar, gp, taken, press}` (territory.js:754-764).

**warlord** (match.js:329-350): `{id, idx, name, colour, home, alive, betrayals, peer}`
plus `grudge` (match.js:860-867). **Eight fields, and only three — `alive`, `home`,
`grudge` — ever change.**

**events bucket** `S.flags.ev` (events.js:185-217): `loy, base{}, stat, fallen[], fired{},
seen, unrest, warned, wea/weaP/weaDay/wx/wz, camped, fell[], last, peak, broke,
contracts[], owed, over`.

### 2.2 Every numeric resource, what makes it and what eats it

| resource | where | produced by | consumed by |
|---|---|---|---|
| **gold** | `S.gold`, starts 40 | loot cash (core.js:905-927), band purses on surrender (army.js:712), province income at dawn (territory.js:1469), selling guns/armour (outpost.js:381-394), card payouts | wages at dawn (core.js:412-452), buying guns/armour/men, `REST`, hiring a band, bribes and tolls in cards |
| **men** | `S.army[]` | prisoners you keep, HIRE, recruit camps, `RAISE THE LEVY`, card joins | battle deaths, wage-shortfall walkouts, scatter, mutiny, pressed-man desertion, heat, thirst, garrisoning |
| **guns** | `S.baggage{}` | `W.spoils` at 0.62 salvage (core.js:904-916), `takeTheirArms` on surrender/rob (army.js:1587-1595), depot purchases, the cache/bones/runner cards | equipping men (`W.equip`), selling, sandstorm losses, a lost duel |
| **armour** | `S.armourBag{}` | same as guns, at 0.8× the salvage rate | same |
| **fame** | `S.fame`, starts 0 | winning battles, taking prisoners, releasing prisoners, mercy cards | executions (`−3 × (tier+1)` each, army.js:1883), robbery, banditry cards |
| **loyalty** | `S.flags.ev.loy`, starts 72 | being paid at dawn (+1.4), wins, mercy, bonuses, drift toward the bond ceiling | not being paid (**−15**), losses, executions, pressed men, heat, cards |
| **provinces** | `S.territory.own` | `onBattleWon`, standing on unclaimed for 1 hour with ≥10 men, `STORM` | `warDawn` taking them off you (max one a dawn, territory.js:1382-1416) |
| **garrisons** | `S.territory.gar/gp` | dawn levies toward `supportOf(r)` over 6 dawns (territory.js:944-973) | `RAISE THE LEVY`, and **they die with the province** (territory.js:1018-1023) |
| **prisoners** | `S.prisoners[]` | winning a fight, DEMAND, the scale rule | the 3 aftermath verbs, the `buyer` card |
| **unrest** | `ev().unrest` | consecutive dawns under loyalty 20 | recovering above 34, or a mutiny |
| **betrayals** | `M.myBetrayals` | breaking an alliance | never — permanent |

### 2.3 What does NOT exist — the absences, stated explicitly

These are all real absences confirmed by reading the files, not omissions in this report:

- **No food.** The word appears once, in one card's ad copy (events.js:1961).
- **No water as a resource.** Water is a *biome* and a card subject; no stock, no thirst
  meter. The `water` card kills men once and moves on (events.js:2276-2289).
- **No campaign ammunition.** `ammo` appears in core.js only in a comment saying it
  "belongs to the battle and dies with it" (core.js:100-102).
- **No supply lines, no attrition from distance, no march fatigue.** Riding is free.
- **No campaign morale.** `morale` exists only inside `battle.js`. The campaign's stand-in
  is loyalty — a single global 0-100 scalar.
- **No relations except a binary alliance flag.** `M.ally[a|b]` is a day number or nothing
  (match.js:771-775). No opinion, no trade agreement, no non-aggression short of a full
  alliance, no vassalage, no marriage, no tribute except one card.
- **No renown separate from fame**, no titles you hold, no ranks.
- **No buildings, upgrades, tech, research or crafting** — outpost.js:9-10 says so on
  purpose: "the moment an outpost becomes a thing you IMPROVE, the game stops being about
  the army".
- **No families, companions or named lieutenants.** The "ringleader" is recomputed every
  time it is asked (events.js:401-409) — a query result, not a person.
- **No quests, no story, no dialogue tree.** The nearest thing is two contract cards.
- **No settlements** beyond 6-9 shops — no towns, no population, no civilians except four
  decorative `folk` rigs per outpost (campaign.js:1484-1554).
- **No prisoner economy at an outpost.** army.js:2135 says "an outpost can sell them
  later"; grep of `outpost.js` for `prisoners` returns **zero hits**. The only prisoner
  sale in the game is the `buyer` road card.

---

## 3. MEN — is a man a person or a count?

**A man is a record, and it does persist.** `W.makeSoldier` is the only constructor
(core.js:163-179); every man in the game comes through it, and gets a **name** hashed off
his id (core.js:147-158), a **tier** which is his hp/accuracy/wage/hire price/aggression
and `combat_iq` role (core.js:110-119), a real **gun** and **armour** id, and
**hp/maxHp, kills, battles, wounded**.

**What accumulates across battles:**

- `battles` +1 for every survivor including those who ran (army.js:1709-1710, core.js:184-198).
- `kills` +1 per kill, written back onto the roster record by the battle
  (battle.js:2636 — `if (by.s) by.s.kills = (by.s.kills || 0) + 1`).
- `hp` and `wounded` are written back at the end of a fight (battle.js:4273-4274).
- **Promotion**: at `PROMOTE_AT * (tierIndex + 1)` battles — 3 for a levy, 6 for a raider,
  9 for a soldier (core.js:183-198). That is the entire progression system, and core says
  so: "No XP bar: three battles survived is the bar" (core.js:181-182).

**What does NOT persist:** no personal history, no relationships, no traits, no
specialisation, no injuries that stay. `wounded` is cleared **every single dawn**
(army.js:2148-2156) and hp is fully refilled, so a wound is at most an 18-minute debuff.

**Where a man is visible to the player.** Only three places print a name: the aftermath's
dead list, capped at 12 (army.js:1965-1975); the loyalty screen's 12 worst bonds
(events.js:3575-3585); the end screen's memorial (events.js:3464-3471). The loadout roster
shows kills/battles per man (loadout.js:519) but starts **closed** by design
(loadout.js:47-50), because `AUTO-ARM` is "the button 90% of players ever press".

**So: a man is an individual in the data and a count in the experience.** You never
address a man, promote a man, name a man, assign a man a job or notice a man. You press
AUTO-ARM and read a total.

### 3.1 Can he desert? Get wounded vs killed?

- **Wage desertion**: at dawn, if you cannot pay, men walk from the **bottom of the tier
  order**, each credited five days of his own wage, capped at 40% of the roster
  (core.js:436-448).
- **Pressed-man desertion**: each dawn, any man whose provenance bond is
  `BASE_PRESSED` (0.26) rolls `(1 − bondOf) × (1 − loyalty/100) × 0.3` to walk, taking his
  rifle (events.js:3810-3824).
- **Wounded vs killed**: the battle decides. A survivor under 34% hp is `wounded`
  (battle.js:4274), which costs him 38% of his power (core.js:488) until dawn. Death is
  permanent and writes a memorial row (events.js:424-429).
- **Scatter**: meeting a hunting party 3.05× your size sheds `SHED_CAP × (1 − odds)` of
  your roster, levies first (army.js:382-411).
- **Mutiny**: the worst-bond fraction of your army leaves the roster and becomes a real
  band you must fight (events.js:3159-3216).

### 3.2 `resolveOneBandFight` — who dies in an off-screen fight

`campaign.js:3486-3577`. This is the island's entire off-screen history engine:

1. Pick **one random band**; skip if it is `held`, `joining` or `transient`
   (campaign.js:3489-3497).
2. Find the **nearest band that is not on the same side** (owner if territory.js knows one,
   otherwise faction), within **220 m** (campaign.js:3498-3515).
3. If the power gap is > 6×, the weak one flees and remembers being scared; no fight
   (campaign.js:3527-3534).
4. Otherwise `W.odds(pa, pb)` decides the winner with one `W.rnd()`
   (campaign.js:3535-3537).
5. The loser loses `0.55 + margin × 0.45` of its men; the winner loses
   `clamp(0.42 × (1 − margin), 0.03, 0.35)` (campaign.js:3538-3544).
6. **`loser.men.splice(0, lost)`** — the dead are the *first N entries of the array*.
   Not the weakest, not the ones without armour, not the ones caught in the open.
   Array order.
7. The winner takes 60% of the loser's purse; a wiped band is spliced off the map
   (campaign.js:3545-3553).
8. A log line is written only if it happened within 3 km of you or wiped a party of ≥20
   (campaign.js:3569-3576).

**Rate.** `FIGHT_EVERY = 216` seconds per party; the tick fires when
`fightTick > 216 × 2 / bands.length` (campaign.js:3403-3408). At 442 parties that is
**one resolution roughly every second of game time**, so on a 442-party island a given
party fights about every 3.6 in-game minutes. Nothing about any of those fights is ever
shown, and 200 of them a session produce perhaps two log lines each.

### 3.3 Is there any attachment mechanic?

**No.** There is no favourite, no bodyguard, no retinue, no named officer, no "this man
has been with you since day 3" surfaced anywhere. The design *intent* is stated three
times — "a casualty list with names on it is the reason you do not charge"
(core.js:143-146, army.js:14-16, army.js:1953-1961) — and the delivery is a wrapped line
of up to 12 names on a screen you dismiss. `bondOf(s)` (events.js:242-253) is the closest
thing to a relationship and it is a pure function of provenance + battles + your execution
count; the man has no opinion of *you* specifically that you built.

---

## 4. THE ISLAND AI

### 4.1 The band decision function — three moods, one comparison

`campaign.js:3304-3328`. Every band, on a staggered ~1.1-2.0 s timer, and **only within
1100 m of you**:

```js
const edge = theirs / myPower;
if (edge > 1.15 + b.scared * 0.9 && W.rnd() < hostile) b.mood = "hunt";
else if (edge < 0.55 || b.scared > 1)                  b.mood = "flee";
else if (b.mood !== "camp")                            b.mood = "roam";
```

That is the whole AI. `hostile` comes from the archetype or the faction row
(core.js:748-751, 563-569, 788-796). `scared` counts rounds lost to you and is the only
memory a band has (campaign.js:601). **There is no camp/hunt/roam *weighting*** — it is a
threshold ladder on one ratio.

Movement (campaign.js:3330-3376): hunt 8.4 m/s toward you, flee 7.7 away, roam 6.2 toward
`b.goal`. `pickGoal` (campaign.js:608-625) picks an outpost 50% of the time, an oasis 25%,
open sand 25%; on arrival it pauses 6-28 s and a pause over 20 s becomes `camp`. **Bands
never trade, garrison, besiege, coordinate or talk to each other.** They walk to a shop
and stand there. Parties beyond 1.5 km are integrated in 0.6 s chunks (`FAR_STRIDE`,
campaign.js:3260-3261) and **never think at all** — the `dp < 1100` gate means the 440-odd
parties you cannot see have no behaviour except walking to a goal.

### 4.2 How provinces are attacked and lost

`territory.js warDawn()` (territory.js:1349-1442), once a dawn:

- `pressureOn(r)` (territory.js:1275-1322): an attack comes out of the provinces that
  **touch** this one. Each hostile neighbour brings `levies(nb) × 0.5 + garrisonPower(nb)`
  scaled by its own settle curve, weighted by shared border length, plus `nearForce` —
  bands **camped** on the ground (weight 1) or **hunting** across it (0.5). A *roaming*
  party contributes **zero** (territory.js:1179-1208), which was a deliberate fix.
- `defenceOf(r)` (territory.js:1236-1248): garrison power + 90% of the ground's own levies,
  times `0.55 + 0.45 × settledOf(r)`, plus your own power if you are within 1400 m.
- The roll is `W.chance(odds² × 0.9)` — squaring makes a marginal front take a week
  (territory.js:1367-1372).
- **Your ground is resolved first, loses at most one province a morning, and only after
  two consecutive dawns of warning** (`t.press`, territory.js:1359, 1403-1416).
- The AI factions get **three flips a dawn** max (territory.js:1417-1440).
- The abstract war **never hands you a province** (territory.js:1438) — you take ground
  only through the three doors.
- A province that just changed hands is frozen for `CONSOLIDATE = 3` dawns
  (territory.js:1341-1347, 1360).

### 4.3 Garrisons and levies at dawn

`raiseLevies()` (territory.js:944-973): every owned province raises toward `supportOf(r)`
in `cap / SETTLE_DAWNS` (6) steps. Yours become **real `W.makeSoldier` levy records with
`W.cheapestGun()`**; everybody else's is a strength number `gp`. `supportOf(r)`
(territory.js:868-875) is `wells × 100 + arable × areaKm2 × solvedRate + posts × 25` —
one typed constant (`MEN_PER_OASIS = 100`, territory.js:300) and everything else derived.

A garrison is **not on your payroll** — the ground feeds it (territory.js:1444-1454). The
moment you `RAISE THE LEVY` those men enter `S.army` and start costing wages. That is a
genuinely good trade, and it is one button.

### 4.4 Rival warlord columns

`columnsWanted(w)` = `min(5, round(1 + (holdings − 1) × 0.5))` (match.js:491-495). Columns
are real `W.makeBand` parties of 35-190 men in `S.bands`, stamped with `warlordId`, colour
and name (match.js:526-566). Every dawn: `raiseColumn` if short, `topUpColumns` (march the
holdings' garrison strength into the nearest column, capped at 190, match.js:626-654),
`takeEmptyGround` (two dawns sat on unowned ground, match.js:664-678), `retire(w)` if he
has neither ground nor a column (match.js:686-691).

**Note the tombstone**: `COLUMN_CEILING = 150` compared against `S.bands.length` on a
444-party island, so `raiseColumn()` returned null every time and **not one rival warlord
had ever ridden this island** — 14 names, 14 holdings, 0 columns (match.js:221-243). Fixed
now; worth knowing how long a headline feature was structurally dead.

### 4.5 The 80% land victory

`WIN_SHARE = 0.8` → `T.winTarget() = ceil(40 × 0.8) = 32` (territory.js:1503-1511).
Checked at every dawn and after every aftermath via `checkVictory()`
(events.js:3384-3388). The fraction "`7 OF 40 · YOURS AT 32`" is a HUD chip from the
first frame (territory.js:1731-1745).

### 4.6 "Broken" warlords and retire()

There is now exactly one definition: a warlord is out when he **holds nothing and rides
nothing** (match.js:680-691), which fires `warlords:out`. `events.js checkBoard()`
(events.js:3324-3378) notices, logs it, gives you +40 fame and +12 loyalty, and — when
only one rival is left — triggers **THE LAST WAR**: the survivor absorbs 45% more men,
is renamed "X — THE LAST", and hunts you (events.js:3354-3376).

### 4.7 Diplomacy — what exists and what does not

**What exists** (match.js:787-993, territory.js:2542-2585):

- A per-pair state machine: `none → offer → waiting → allied | refused`, `allied → break`.
- A rider takes **one dawn** (`ANSWER_DAYS = 1`); your silence answers his offer after
  **three** (`OFFER_DAYS = 3`).
- The AI's answer is a real decision from three readings of the board — **parity** of
  `strengthOf`, **pressure** on his frontiers, **trust** (your betrayal count) — hashed so
  the same offer on the same day gives the same answer (match.js:892-924). Its own header
  measures 41% of first offers refused.
- What it buys: `pressureOn` skips an ally's frontier (territory.js:1283-1293) and every
  one of his columns' `hostile` drops to 0 (match.js:571-588).
- What breaking it costs: his columns go to `hostile = 1` **permanently**, he gets a
  `grudge` that is never cleared, and after `BETRAYAL_MEMORY = 3` betrayals **nobody**
  takes your hand again (match.js:853-873, 892-894).
- He only offers if his ground touches yours or you are standing on it
  (`touching()`, match.js:1002-1016).

**What does not exist:**

- **You cannot talk to a rival about anything but an alliance.** No tribute demand, no
  threat, no trade, no joint war, no "give me that province", no ceasefire short of a full
  alliance, no message of any kind.
- **You cannot meet him.** His *column* opens the ordinary bandit rail (ATTACK / DEMAND /
  HIRE / ROB / INSPECT / RIDE AWAY) with HIRE disabled for `faction: "warlord"`
  (army.js:160, 168-172). The man himself has no body, no card and no location — `home` is
  a region id and he is never anywhere.
- **A warlord has no personality.** Fourteen of them differ only by `name`, `colour`,
  `idx` and `home` (match.js:329-350). The epithets — "THE JACKAL", "THE BUTCHER" — are
  decoration; nothing reads them, and `wantsAlly` is the same function for all fourteen.
- **No warlord remembers you** except through two bits: `grudge` and a refusal timestamp.
  Not that you destroyed his columns, took his provinces, or shot forty of his men.
- The `summons` card is the one time a rival addresses you, picking randomly from the
  **top three** on the leaderboard (events.js:2866-2873).

---

## 5. EVENTS — the road cards

**Twenty entries in `LIB`** (`grep -c "^  add({"` → 20), of which **18 are weighted** and
2 (`ringleader`, `paid`) are fired directly by other systems (events.js:2934, 2981).
The `mutiny` card is built inline and is not in the library (events.js:3181-3211).

**How one fires.** The internal ticker measures distance ridden and fires every
1100-2600 m, halving the interval if nothing was eligible (events.js:4012-4022,
4047-4053). **Nothing outside events.js calls `E.travel` or `E.maybeFire`** — grep across
`src/` and `games/` returns zero hits — so `E.driven` is always false and the internal
ticker is the only driver. The pick is weighted with a repeat penalty: a card fired in the
last 2 days is skipped, then divided by `age/14` (events.js:3016-3038). A `weight()` of 0
means not now — the gate that stops an army of three being offered a siege
(events.js:1925-1933). **11 of 20 cards put their people on the road first** (`cast()`,
CONTRACT.md:336-344) and come up as a verb rail over the live world (events.js:846-880);
the other 9 are a full-screen panel (events.js:885-919).

### 5.1 The library

| # | id | gate | verbs | consequence | class |
|---|---|---|---|---|---|
| 1 | `deserters` | 3 ≤ army < 220 | TAKE THEM ALL / TAKE THE BEST THREE / RIDE ON | +N levies at bond 0.22, −4 loyalty; or +3 at 0.45, +1 | **b** one-shot |
| 2 | `caravan` | army ≥ 5 | TAKE THE CONTRACT / TAKE THE TRUCKS / WE ARE NOT GUARDS | escort **calls `W.dawn()` N times immediately** then pays a fee; rob pays 1.7× the fee, −6 fame, **`executed += 1`**, −6 loyalty | **a** (rob echoes via the fear multiplier) |
| 3 | `village` | 6 ≤ army < 260 | TAKE THE JOB / TAX THEM / RIDE ON | job spawns a real 6-40 man bandit band 1.4 km out **and queues a contract that pays later**; tax pays cash and −4 fame | **a — a real echo** |
| 4 | `cache` | always (1.0) | TAKE IT AND GO / SIT ON IT AND WAIT / LEAVE IT | guns into the cart **and a hostile "THE OWNERS" band spawns hunting you** | **a — an echo** |
| 5 | `rival` | army ≥ 25 and fame ≥ 12 | LET HIM GO / PUT HIM DOWN / RIDE ON | let go: +N men, −5 loyalty, **queues a revenge column for day+6..14**; kill: +9 fame, `executed += 2`, −8 loyalty, and **the fight starts immediately** | **a — the best echo in the game** |
| 6 | `schism` | army ≥ 14, weight rises below loyalty 62 | LET THEM WALK / BUY HIM BACK / SHOOT HIM | −N men +10 loy; or −$ and +13 loy and +0.2 bond on N men; or −1 man, −16 loyalty, `executed += 1` | **b** |
| 7 | `water` | biome salt/dune/gravel | PAY / TAKE THE SKINS / PUSH ON DRY | −$ and half the wounded heal; or −3 fame −7 loy; or **kills men (30% each, wounded first)** | **b/c** |
| 8 | `storm` | only during a sandstorm | MAKE CAMP / RIDE INTO IT | camp calls `W.dawn()`; ride loses men and guns | **b** |
| 9 | `column` (slavers) | army ≥ 8 | CUT THEM LOOSE / BUY THEM / RIDE ON | +N armed men, +fame, +8 loyalty **and a fight with the guards now**; or pay and no fight; or −3 loyalty | **b** (the fight is immediate) |
| 10 | `runner` | always | BUY THE CRATE / TAKE THE CRATE / RIDE ON | guns at 0.72 list; or free, −5 fame, −4 loyalty | **b** |
| 11 | `oldman` | always | PAY HIM / OFFER A SHARE / LEAVE HIM | +1 veteran at bond 0.82; or free at bond **0.95** and +4 loyalty | **b** |
| 12 | `buyer` | prisoners ≥ 4 | SELL THEM ALL / TURN THEM LOOSE / THEY STAY | gold and `executed += n/3` and −9 loyalty; or +fame and +7 loyalty and a real "FREED MEN" party spawns | **a/b** |
| 13 | `toll` | biome wadi/rock | PAY / GO THROUGH THEM / GO AROUND | −$; or a fight now; or **+8 hours of clock** | **b** |
| 14 | `bones` | always (0.7) | DIG / BURY THEM | +N guns and +2 h; or nothing and +9 hours and +9 loyalty | **b** |
| 15 | `duel` | 10 ≤ army < 140 | WALK OUT / SEND THE LINE / RIDE AWAY | a **real solo battle** — your men are the reserve, nobody routs; win takes their whole line, lose costs a third of the cart, −8 fame, −11 loyalty | **a** (a fight you actually play) |
| 16 | `sick` | ≥3 wounded | BUY MEDICINE / LEAVE THEM / CARRY THEM | heal all; or lose all and −12 loyalty; or **45% of them die** | **b/c** |
| 17 | `defector` | fame ≥ 20 and army ≥ 12 | PAY HIM / TAKE HIM PRISONER / SEND HIM BACK | +N men over a rise; or +1 prisoner, −3 loyalty | **b** |
| 18 | `summons` | endgame on, army ≥ 30, fame ≥ 30 | PAY THE TRIBUTE / SEND HIM BACK ON FOOT | tribute: **every one of that warlord's columns goes `hostile = 0` for 600 s**, −10 loyalty, −8 fame; defy: **all his columns hunt you with a dust trail**, +12 fame, +11 loyalty | **a — a real echo** |
| 19 | `ringleader` | weight 0 — fired by the loyalty system | PAY A BONUS / TAKE HIM OUT / OPEN THE GATE | +26 loyalty for gold; or −1 man and −9 loyalty; or −N men and +22 loyalty | **b** (but it is the mutiny warning, which matters) |
| 20 | `paid` | weight 0 — fired by the aftermath | TAKE THEM / TAKE COIN | the village contract's payoff: +N volunteers at bond 0.78 and +6 fame, or gold | **a — the other half of #3** |

### 5.2 Classification

- **(a) changes lasting state that echoes later: 5 of 20 — `village`, `cache`, `rival`,
  `summons`, `paid` (25%).** Two more (`caravan` rob, `buyer` sell) bump `stats.executed`,
  which permanently multiplies `fearMul()` (army.js:88-91), so a generous count is 7/20.
- **(b) real state change, no echo: 13 of 20 (65%).** They move gold, men, guns and
  loyalty and are then over. The loyalty they move drifts back toward the bond ceiling at
  0.3/dawn (events.js:3780-3781), so most of it is gone inside a fortnight.
- **(c) a coin flip: essentially 0 as a *choice*.** Every verb's consequence is
  deterministic given the press; the only dice are *inside* an outcome (`sick` carry =
  45% per man, `water` push = 30% per man, and the duel's `W.chance(p)` fallback path
  which only runs if `battle.js` is missing, events.js:2720).

**The honest summary: the road-card layer is a well-written priced menu.** Every choice
is a transaction with the price printed on the button — `hint: "-$" + price + " · ..."` —
and 13 of 20 transactions have settled by the time you ride away.

---

## 6. ECONOMY

### 6.1 Is there an income → spend → power loop?

Yes, and it is *thin but real*:

```
loot guns (salvage 0.62) ──► sell at 0.34-0.55 ──► gold
province income at dawn ───────────────────────► gold ──► buy guns / hire men ──► power
provinces ──► levies (free, on the ground) ──► RAISE THE LEVY ──► men (now costing wages)
```

`W.spoils` returns **an inventory, not a number**, on purpose: "A warlord who sells his
loot and a warlord who arms his men with it are playing differently"
(core.js:888-916). That is the single best economic decision in the game and it is real.

`W.payroll()` is the brake — wage 1/2/4/8 per tier per dawn (core.js:110-119, 399-403).
A province's income is `supportOf(r) × levyWage` (territory.js:877); one oasis feeds 100
men (territory.js:300), so the whole island fully held supports ~1400 men or ~350 soldiers
(territory.js:296-299) — about the biggest party core will ever spawn.

### 6.2 Loot

`W.SALVAGE = 0.62` for guns, `0.62 × 0.8` for armour, plus `irange(0,6)` cash per body
(core.js:904-916). On a surrender or a robbery, `takeTheirArms` strips **every** gun above
a sidearm and every piece of armour straight into your stash (army.js:1587-1595).

### 6.3 Outposts — what they produce

Four kinds, each doing exactly one thing (outpost.js:99-130):

| kind | what it holds | numbers |
|---|---|---|
| ARMS DEPOT | a finite crate list, 7 lines | capital $700, buys your surplus at 0.34 |
| RECRUIT CAMP | a finite pool of men by tier | capital $320; a veteran line is often 0 (outpost.js:334-339) |
| WELL | rest — clears `wounded`, costs gold and **calls `W.dawn()`** | outpost.js:418-435 |
| NIGHT MARKET | the top of the price list on demand, at 3× | capital $1400, buys at **0.55** |

**Nothing is typed.** Which guns a depot carries is `hash01(x, z, hashOf(id)) <
gunRarity(id)^2.5` — a property of *where it is*, so "the depot at Bir Kufra always deals
in AKs" (outpost.js:246-267). How many is `capital / gunPrice` (outpost.js:307-310).
Markup rises with distance from the coast (outpost.js:213-221). Restock is per-line per
dawn against the gun's rarity — a launcher is a delivery every ~20 days
(outpost.js:364-396). This is the most complete subsystem in the game and the one the
player touches least: **6-9 shops on a 14 km island**, each a multi-minute ride away.

### 6.4 Loadout — how you get better guns

You mostly **take them off the dead**. Then `AUTO-ARM` (loadout.js:112-147) strips
everybody, sorts men by base power and guns by `gunCombat`, and pairs them — the
rearrangement inequality makes this the *provable* maximum, not a heuristic
(loadout.js:88-110), with armour dealt first because armour multiplies the base the gun
pass sorts on. **And that is the problem with it as a game object:** because it is
provably optimal and one tap, the "you decide which of your army get what weapon"
decision the owner asked for (loadout.js:4-5) does not exist.

---

## 7. THE AFTERMATH — the 3-verb prisoner decision

`army.js:1733-1951`. After any won fight, `theirSurvivors` become `S.prisoners`
(army.js:1714-1718).

**First THEY decide.** Every prisoner rolls `_willing` **once**, when the screen goes up
(army.js:1830-1836). `willChance(s, ratio)` (army.js:1811-1824):

```
base   = events.js BASE_JOINED = 0.58        // "a man who walked up and asked"
p      = base × (1 − tierIndex×0.25 − seasoned×0.25)
       + (clamp(ratio, 0.5, 4) − 1) × 0.09   // the power ratio the fight was won at
       + clamp(fame / 1500, 0, 0.1)          // your reputation, capped at +10pp
p      = clamp(p × fearMul(), 0.04, 0.97)    // fearMul = 1 + executed × 0.09
```

The card then states the fact in one line — "19 WILL MARCH FOR YOU · 12 WILL NOT" — and
offers three verbs (army.js:2059-2074):

| verb | what it does exactly | what it costs |
|---|---|---|
| **TAKE THE WILLING** | `enlist(s, "willing")` for every `_willing` man → `stats.recruited++`, provenance `hired` (bond 0.82). The rest are removed from the wire and **each buys `(tierIndex+1) × 2` fame** (army.js:1888-1909) | nothing. It is the free, small-army, high-loyalty play |
| **PRESS EVERY MAN** | every prisoner enlists; the unwilling get provenance `pressed` (bond **0.26**) and `stats.conscripted++`. Then `W.events.settle()` moves loyalty **immediately** down to the new bond ceiling (army.js:1912-1929, events.js:376-382) | a permanently lower loyalty ceiling, plus a per-dawn desertion roll on every pressed man (events.js:3810-3824) |
| **SHOOT THE UNWILLING** | the willing enlist; the rest go through `killRecord` → `stats.executed++` and `fame −= (tierIndex+1) × 3` each (army.js:1880-1885, 1937-1951). Shown as a rank of men on the sand and one volley (army.js:1372-1427, 1516-1539) | the fear multiplier goes **up** (parties fold to you more readily — army.js:64-91), the loyalty ceiling drops now via `settle("they watched you shoot men who said no")`, and `bondOf`'s dread term poisons every man on the roster forever (events.js:248-252) |

There is **no price on any of them**, no ransom, no release-for-gold, and men you do not
decide about ride with you as prisoners indefinitely (army.js:2133-2140). **This is the
best-designed decision in the game** — three verbs, three modelled currencies (nothing /
loyalty / fear), and PRESS and SHOOT genuinely bill you later. It is also, once the
surrender rate stabilises, the same decision every single time.

---

## 8. TIME PRESSURE AND GOALS

### 8.1 Any clock?

**No deadline of any kind.** The old 20-minute match timer, the scoreboard and the
domination check were deleted with the match layer (match.js:8-48). There is no season, no
winter, no "the legion invades on day 40", no escalating threat schedule. The only
time-shaped pressure is:

- **Wages every dawn** — but income scales with land and land only grows, so this is a
  pressure that *decreases* over a run.
- **Loyalty drifting to a ceiling** you set by your recruitment choices.
- **`warDawn` taking at most one of your provinces a morning**, with a dawn's warning
  (territory.js:1382-1416).
- **The LAST WAR**, which only arms when 13 of 14 rivals are already out
  (events.js:3354-3376).

### 8.2 Objectives besides 80% land?

**None.** There is no secondary objective, no mid-term goal, no chapter, no milestone, no
unlock. The three contract-shaped things — `village`/`paid`, `rival`'s revenge column,
`summons` — are the only multi-step commitments in the game, and two of them are one card
each.

### 8.3 Story?

**None.** There is no plot, no premise beyond "you ride out alone with a pistol and $40",
no antagonist you can name until the last war, no scripted moment, no ending text that
varies except a computed title (events.js:3439-3451).

### 8.4 Ways the run ends

Three deaths and one win (events.js:3390-3435):

1. You go down in a battle **with zero survivors** — no one to carry you off.
2. You lose the mutiny — always death.
3. **Bankrupt**: zero men, gold below a levy's hire price, and a worthless cart, for three
   consecutive dawns (two warnings first).
4. **Win**: hold ≥32 of 40 provinces.

### 8.5 The end screen

`summary()` (events.js:3458-3527) shows: a headline (`THE ISLAND IS YOURS` /
`IT ENDS HERE`), `DAY N · <computed title>`, the one-sentence reason, nine stat tiles
(DAYS, PROVINCES HELD, BIGGEST COLUMN, BATTLES, THEY LOST, YOU LOST, PRESSED, EXECUTED,
FAME), the top-10 final standings, and the full memorial of your dead. Two buttons:
`RIDE OUT AGAIN` (wipes the save) and `THE CHRONICLE` (the log, reverse-chronological by
day).

The title is read off what you did — `THE BUTCHER OF THE PAN` at 14 executions,
`THE PRESS-GANG`, `THE PAYMASTER`, `BREAKER OF WARLORDS`, `A MAN WITH A PISTOL`
(events.js:3439-3451). **This is the one place the game reflects your play style back at
you, and it is one line on a screen you see once.**

---

## 9. THINGS THAT LOOK LIKE FEATURES AND ARE NOT WIRED

- **`E.travel` / `E.maybeFire` have no external caller.** Grep of `src/` and `games/`
  returns zero, so `E.driven` is permanently false and the event cadence is entirely the
  internal ticker (events.js:3949-3961, 4012-4022).
- **`W.setPhase("outpost")` is called by nobody**; the phase survives only in core's enum
  for old saves (CONTRACT.md:114-125).
- **army.js:2135 claims outposts can sell prisoners.** They cannot.
- **`b.kind` is null for every one of the 184 big parties** — only the seven small
  archetypes have names (core.js:788-796), so 40% of what you meet is one of five faction
  labels: SAND BANDITS / OASIS MILITIA / FREE COMPANY / DESERT LEGION / RIVAL WARLORD.
- **`stats.killed`, `stats.won`, `stats.battles` and `S.you.kills` feed nothing but the
  end screen and one title check.** They are not inputs to any system.

---

## 10. A DERIVED FIRST TEN MINUTES (the probe was skipped — see the header)

At default 1× speed, seed anything, player idle after the first ride. All arithmetic
from the numbers cited above.

| t (real) | in-game | what has happened |
|---|---|---|
| 0:00 | day 1, 07:00 | You stand on a beach with a pistol, $40, no men. 442 parties, 9 outposts, 40 provinces (6 owned by factions, 14 by warlords, 20 unclaimed), 14 rival warlords each with 1-5 columns. |
| 0:00-2:00 | 07:00-09:40 | You ride. `checkContacts` runs every frame over 442 bands; the first band within 26 m opens the encounter rail. On day one your power is ~14 (core.js:500-506) so a 2-6 man looter crew is a genuine fight and a 40-man band is not. |
| ~2:00 | ~09:40 | First road card, after 1100-2600 m of riding at 15.5 m/s (events.js:4021). Then roughly every 2 minutes of continuous riding. |
| 2:00-10:00 | 09:40-20:20 | ~4 more road cards. ~1-3 encounters. **~600 off-screen `resolveOneBandFight` rolls** (one per second of game time at 442 parties, campaign.js:3403-3408), of which almost all return early (no non-same-side band within 220 m) and of the rest, only ones within 3 km of you or wiping ≥20 men write a log line. |
| every 9 s | — | The spawner tops the island back up by up to 12 parties toward the two targets (campaign.js:3410-3464). |
| **10:00** | **day 1, 20:20** | **No dawn has occurred.** No wages billed. No levies raised. No `warDawn`. No loyalty drift. No weather roll. No outpost restock. No warlord diplomacy. No rival column top-up. No mutiny check. No victory check. |

**`W.warlords.audit()` at 0, 3, 6 and 10 minutes would be identical** — `holdings`,
`columns`, `allies`, `offersOpen` and `betrayals` all change only inside
`match.js dawn()`, which is on `territory:dawn`, which is on `W.dawn()`, which fires at
in-game hour 6. Likewise `T.audit().byOwner`.

**The only things that differ across those four samples with the player idle are**
`S.bands[i].{x,z,mood}` (parties walking), a handful of `men.length` values changed by
the off-screen resolver, and `S.hour`.

**That is the finding, and it does not need a browser to confirm.** At default speed, the
first dawn is at **17:15 real minutes**, so the entire strategic layer — the levy, the
war, the economy, diplomacy, loyalty, weather, the win check — is invisible for the whole
of a first session unless the player finds the speed slider. The world he *can* see in
those ten minutes is 442 parties walking to shops and away from each other.

---

## 11. VERDICT

### Why it feels surface level

1. **The strategic layer only ticks once every 18 real minutes.** Wages, levies, the war,
   loyalty, weather, diplomacy and the victory check are all gated behind `W.dawn()` at
   in-game hour 6, and the game starts at hour 7 (core.js:357, campaign.js:2064-2065).
   A player's first ten minutes contains *zero* of the systems the game is made of.

2. **Almost every verb in the game is "press a word, a number changes."** Of ~30 player
   verbs, three (ATTACK / STORM / duel) hand off to something you play with your hands.
   The rest are transactions on a rail.

3. **Men are individuals in the data and a count in the experience.** Names, tiers, kills,
   battles and promotions all persist (core.js:163-198, battle.js:2636), and the player
   never sees any of it: the roster screen starts closed and AUTO-ARM is the intended
   button (loadout.js:47-50).

4. **There is no attachment mechanic at all.** No named lieutenant, no companion, no
   retinue, no man who has been with you since day 3. `ringleader()` recomputes who the
   troublemaker is every time it is asked (events.js:401-409) — he is a query result, not
   a person.

5. **`resolveOneBandFight` kills by array index.** `loser.men.splice(0, lost)`
   (campaign.js:3543). The island's entire off-screen history is 442 parties losing their
   first N array entries, and the player never sees or hears about 99% of it.

6. **Nobody on this island remembers you.** A rival warlord's memory of you is two bits:
   `grudge` (you broke an alliance) and `refused` (a timestamp). Not that you destroyed
   his columns, took his provinces, or executed his men (match.js:329-350, 892-924).

7. **You cannot meet, talk to, threaten, or negotiate with a rival warlord.** He has no
   body, no card and no place on the map. His columns open the same bandit rail as a
   looter crew, with HIRE greyed out (army.js:160).

8. **Diplomacy is one bit per pair.** Allied or not. No opinion, no tribute, no vassalage,
   no joint war, no trade — and no way to initiate any conversation except OFFER ALLIANCE
   from a map card (territory.js:2579).

9. **The only resources are gold, men, guns and two abstract scalars.** No food, no water,
   no ammunition, no supply, no fatigue. Riding 14 km costs nothing but time.

10. **Fame is a capped nudge.** Its total mechanical effect is +16pp on the surrender roll
    (`fame/900`, core.js:966), +10pp on a prisoner's willingness (`fame/1500`,
    army.js:1822) and three card weight gates. It saturates at ~fame 150 and then does
    nothing forever.

11. **Loyalty is one global 0-100 number with a drift toward a ceiling.** Every act in the
    game moves the same scalar, and it drifts back at 0.3/dawn (events.js:3780-3781). Most
    card choices are therefore erased inside a fortnight.

12. **13 of 20 road cards have no consequence that echoes** (§5.2). They are priced
    transactions that settle on the button press. Only `village`+`paid`, `cache`, `rival`
    and `summons` create a future.

13. **No verb has a cost that comes due later**, with three exceptions: PRESS EVERY MAN
    (per-dawn desertion), SHOOT THE UNWILLING (permanent fear/dread), and breaking an
    alliance. Everything else is settled at the moment of pressing.

14. **The aftermath decision is the same decision every time.** Three verbs, and once you
    know your loyalty ceiling, the answer stops changing.

15. **AUTO-ARM is provably optimal and one tap** (loadout.js:88-147). The equipment
    decision the design asks for cannot exist while the button exists.

16. **The band AI is one threshold ladder on one ratio, and only within 1100 m of you.**
    (campaign.js:3308-3327). The 400+ parties you cannot see have no behaviour beyond
    walking to a randomly picked oasis or shop.

17. **A band's only memory is `scared`, an integer 0-2** (campaign.js:601, 3322-3323).

18. **There is no clock, no deadline, no escalation and no mid-term objective** — one win
    condition (32 of 40 provinces) and three ways to die. Nothing schedules a threat.

19. **There is no story, no premise beyond the first log line, and no scripted moment**
    except the LAST WAR, which arms only when 13 of 14 rivals are already gone.

20. **The end screen is nine stat tiles and a name.** The one place the run reflects your
    play back at you is a computed title string (events.js:3439-3451).

### What is genuinely deep already — do not rebuild these

- **The prisoner decision** (army.js:1733-1951). Three verbs, three real currencies, a roll
  the prisoners make *before* you choose, and two of the three costs actually arrive later.
- **The territory model.** 40 warped-Voronoi regions derived purely from the seed, an
  economy solved for at generate time against the seed's own arable area
  (territory.js:491-497), `supportOf` = income = levies = defence as **one number wearing
  three hats**, and a pressure model that comes out of *adjacent provinces* rather than a
  realm total (territory.js:1251-1322). It has already survived two documented snowballs.
- **The gun value model** (core.js:217-348). Price from sustained damage × reach ×
  lethality, explosives off real `blastRadius`/`blastPower`, rarity derived from price,
  band armament as a Gaussian on the price list. Zero typed balance scalars.
- **The outpost stock model** (outpost.js:246-401). Finite crates, position-hashed
  character, capital-divided counts, rarity-driven restock, and a night market whose 0.55
  buy price is the only exit for low-grade loot. Nothing typed.
- **AUTO-ARM's proof** (loadout.js:88-147). Optimal for the right reason.
- **The alliance state machine** (match.js:787-993). A rider takes a dawn, refusal is real
  (41% measured), betrayal costs durably, one code path for AI and human alike.
- **The show-don't-tell tableaux** (army.js:974-1665). Surrender, hire, the volley and men
  walking across to your line all happen on the sand with the world still running behind
  them. Several were an array mutation and a toast two commits ago.
- **The clock** (core.js:970-1114). One warped wall clock, monotonic across a scale change,
  never paused, substep-bounded so 64× cannot teleport anybody.
- **The men on screen and the LOD/scale work** (campaign.js:762-1141, 2654-2826,
  508-536, 3221-3259). 48 pooled rigs inside 150 m, an eleven-box impostor cut from the
  same character profile beyond it, hysteresis, 442 parties at a 0.50 ms campaign frame,
  and the real ceiling correctly identified as the 5 MB save rather than the frame.

### The shortest statement of the problem

The game has a **world model** (land → levies → power → land, plus a real economy and a
real off-screen war) and a **moment-to-moment loop** (ride, meet, pick a verb), and the
two barely touch. The world model updates once every 18 real minutes and is expressed as
two HUD chips; the moment-to-moment loop is a sequence of one-press transactions against
strangers who do not know you and will not remember you. Everything the player *does* is
surface because nothing he does is *owed* back to him later, by anybody, at any point.
