# Mount & Blade II: Bannerlord — system-by-system teardown

Research note, 2026-09-08. Purpose: extract the *exact logic* of Bannerlord's campaign and
battle systems, with real numbers, so we can reason about what makes it feel deep and where
even it fails.

**Contents:** [1 Core loop](#1-the-core-loop) · [2 Party](#2-the-party) ·
[3 Recruitment](#3-recruitment) · [4 Battle](#4-battle) · [5 Sieges](#5-sieges) ·
[6 Kingdom/clan](#6-the-kingdom--clan-layer) · [7 AI lords](#7-ai-lords) ·
[8 Consequence chains](#8-consequence-chains) · [9 Criticisms & mods](#9-criticisms--where-even-bannerlord-is-shallow) ·
[10 Warband contrast](#10-contrast-with-warband--what-people-miss) ·
[11 The 12 mechanics, ranked](#11-the-12-mechanics-that-make-bannerlord-feel-deep-ranked-by-leverage-per-line-of-code)

## Method, and why the numbers here are trustworthy

Wikis and Steam guides for Bannerlord are unreliable — they are mostly written against
early-access builds (1.0–1.5) and quote numbers that have since been retuned. So the numeric
spine of this document is taken from the **decompiled TaleWorlds assemblies**, specifically
`TaleWorlds.CampaignSystem` and `TaleWorlds.MountAndBlade` at game version **v1.3.15**,
mirrored at <https://github.com/BannerlordCode/bannerlord-1.3.15> (parallel mirrors:
<https://github.com/iniznet/Bannerlord.Modules.Source>,
<https://github.com/Sartiye/Bannerlord-Taleworlds-Assembly-Decompiled-Archive>). The official
type-level API reference is at <https://apidoc.bannerlord.com/> and the modding docs at
<https://docs.bannerlordmodding.com/> and <https://docs.bannerlordmodding.lt/modding/parties/>.

Where a number comes from the source I name the class. Nearly every tunable in Bannerlord
lives in a swappable `Default*Model` class under
`TaleWorlds.CampaignSystem/GameComponents/` implementing an interface under
`ComponentInterfaces/` — that architecture is itself the single most copied idea in the mod
scene, because it means a mod can replace *one* formula without touching the rest of the game.

A recurring type is `ExplainedNumber`: a float that carries a list of `(value, label)` lines.
Every derived stat in the game — morale, party size, party speed, town loyalty, wage bill —
is built as an `ExplainedNumber`, which is why the UI can always show you a tooltip that
itemises *why* the number is what it is. **That is a design decision, not a UI decision.** The
player's mental model of the systems is built entirely out of those breakdown tooltips.

---

# 1. The core loop

## 1.1 The two modes

Bannerlord is two games glued at one seam:

* **Campaign map** — a real-time-with-pause 3D world map. You are an icon. Time runs at
  1x/2x/4x (`CampaignTime`, `CampaignTime.HoursInDay = 24`). You click a destination, watch
  party icons converge, and enter settlements.
* **Battle / mission** — a real-time 3D scene with up to ~1000 agents on screen (the
  `Mission` layer in `TaleWorlds.MountAndBlade`), where you are one body with a sword.

The switch is triggered by an **encounter**: two party icons collide on the map, an
`EncounterManager` produces a `MapEvent`, and the player is offered a game menu with the
options *Attack / Send troops / Leave / Try to talk*. If you attack in person, the game loads
a mission and hands you a body. If you pick "send troops", the same `MapEvent` is resolved by
`MapEvent.SimulateBattleRound` — the autoresolve — and you never leave the map.

**This is the whole architecture, and it's the important bit:** the campaign layer runs the
*same battle object* whether or not you personally fight it. A battle is a `MapEvent` with two
`MapEventSide`s; the 3D mission is an optional, higher-fidelity renderer for that object. Kill
counts, loot, prisoners, XP, renown and influence all flow back through the same functions
either way. Autoresolve is even explicitly discounted rather than forbidden — troops earn
**0.9× XP** in a simulated battle vs **1.0×** in a fought one
(`DefaultCombatXpModel.GetXpfMultiplierForMissionType`: `NoXp` 0f, `PracticeFight` 0.0625f,
`Tournament` 0.33f, `SimulationBattle` 0.9f, `Battle` 1f).

## 1.2 Minute to minute

**Time control is a first-class verb.** Space toggles pause; `1` pause, `2` normal, `3`
fast-forward, plus on-screen buttons. Vanilla fast-forward is roughly 4×–9× (the most-installed
speed mods push it to 20× — <https://www.nexusmods.com/mountandblade2bannerlord/mods/11712>).
While paused, *everything* time-based halts: travel, the calendar, wages, food consumption,
sieges, construction (<https://canipause.com/games/mount-blade-ii-bannerlord/>). Fast-forward
auto-halts on a "significant event". So the map loop is literally: fast-forward → an event
interrupts → pause → decide → click → fast-forward.

On the map, in a typical minute: fast-forward, an interrupt (a party spots you, your caravan
reports, a town comes into range), pause, check the enemy's strength estimate, decide
chase/avoid, click, unpause. Enter a village: a **menu** — *Recruit / Buy products / Talk to
the headman / Leave*. Enter a town: *Tavern / Arena / Marketplace / Keep / Walk around*. Only
"walk around" is 3D, and it exists mainly to find workshops, thugs to brawl, and wanderers to
hire (<https://www.pcgamer.com/mount-blade-2-bannerlord-money-make-guide/>). **Almost all
campaign interaction is menu text over a static backdrop.**

In a battle, in a typical minute: deploy (choose formations and where they stand), give one or
two orders (`F1`–`F8` chords), then ride into a melee and personally kill 5–20 men.

**Battle length, from players:** *"The average battle in Bannerlord is like 2–5 minutes, while
Warband was like 10–15 minutes"*; with battle size at 700 and two 1,000+ armies, *"the battle
can easily take 20–30 min"*
(<https://steamcommunity.com/app/261550/discussions/0/2248929785829366856/>). Honest bracket:
**looter skirmish 1–3 min, mid-game field battle 3–8 min, maxed 1000v1000 clash 20–30 min.**
The most-cited cause of the shortness is exactly the morale/rout model in §4.5 — *"half the
battle time I am chasing down cowards."*

**Mode-switch frequency** is undocumented, but falls out of the above: an early-game hour of
looter-farming is **6–15 switches/hour**; a late-game hour inside an army is **2–5**, with long
fast-forward stretches between. The loop is deliberately asymmetric — the map is where the
hours go, the battle is where the payoff is.

## 1.3 Hour to hour, and the grind

The hour-to-hour shape is a treadmill of *raise a bigger stack → cash it in for a bigger
political position → which unlocks a bigger stack*:

1. Beat looters / bandits with 20 men. Loot and prisoner ransom is the first income.
2. Win tournaments in towns for renown and gear.
3. Buy a caravan (**15,000 denars**, or **22,500** for the larger one —
   `DefaultCaravanModel.GetCaravanFormingCost`) or a workshop (cost =
   `WorkshopType.EquipmentCost + Prosperity × 4 + 2000` —
   `DefaultWorkshopModel.GetCostForPlayer`, with `InitialCapital` 10,000 and
   `DailyExpense` 100) for passive income.
4. Accumulate **renown** until clan tier rises — the thresholds are
   `{0, 50, 150, 350, 900, 2350, 6150}` (`DefaultClanTierModel.TierLowerRenownLimits`).
   Tier 1 makes you eligible to be a **mercenary**, tier 2 a **vassal**
   (`MercenaryEligibleTier = 1`, `VassalEligibleTier = 2`).
5. Join a kingdom, fight its wars, win a **fief** in a kingdom vote.
6. Own fiefs → tax income, garrison to pay for, loyalty to keep up.
7. Declare independence or found your own kingdom; conquer Calradia.

**Founding a kingdom** requires the *Dragon Banner* questline plus hard gates: **clan tier 4
(900 renown), 100 troops, an independent clan, one owned settlement**
(`DefaultKingdomCreationModel`; <https://mountandblade.fandom.com/wiki/Create_an_Imperial_Faction>).
The wiki flags a UI lie worth noting as a design lesson: *"the tooltip for Clan Tier 2 says
Eligible to create a Kingdom, but the quest actually requires Tier 4."*

### How long people actually play

* HowLongToBeat: **38.5 h average to "beat", 106 h completionist**
  (<https://x.com/HowLongToBeat/status/1628024489970659332>). Gamepressure is blunter about why
  that's soft: *"There actually is no end of the game… The game can be 'completed' (all cities
  conquered) within 40 hours… you can spend over 100 hours and still not conquer all cities"*
  (<https://www.gamepressure.com/mount-blade-ii-bannerlord/how-long-to-complete-the-game/z0fb71>).
* Actual Steam-reviewer playtime, sampled from the public review API (600 most-recent English
  reviews, Sept 2026): **median 140 h, mean 263 h, p75 303 h, p90 630 h, p95 1,017 h,
  p99 1,703 h.** Share above thresholds: **>100 h 60%, >500 h 14%, >1000 h 5.5%, >2000 h 1%.**
  (115,727 English reviews, 100,420 positive; SteamSpy puts owners at 10–20 M —
  <https://steamspy.com/api.php?request=appdetails&appid=261550>.)

**60% of reviewers pass 100 hours.** That is the number to design against.

The "grind" is precisely the fact that **every one of those steps is the same three verbs**
(walk, recruit, fight) at a larger number. What sustains it is not novelty of verb but:

1. **The numbers are a legible, tooltip-explained system you can learn to exploit**
   (see `ExplainedNumber`, §0).
2. **Permanent, mostly-irreversible state** — dead lords stay dead, lost fiefs stay lost,
   insulted notables stay insulted.
3. **Your body is in the battle**, so every stack of troops is also a personal risk.
4. **There is no ending**, so the player sets the goal. *"Its a sandbox. There is no actual
   ending to the game"*
   (<https://steamcommunity.com/app/261550/discussions/0/2264689848039176948/>).
5. **Restart culture** — six cultures, six different early games, and the map is one continent
   so a new start is genuinely a new position rather than a new map.
6. **Mods.** From the same thread: *"vanilla: 20 hours at maximum / modded: 50 hours and more
   depending on new mods releases. Right now this game is like Skyrim."*

---

# 2. The party

## 2.1 Troop tiers and upgrading

Every regular troop is a `CharacterObject` with a `Tier` (0–6+) and a `Level`. Upgrading is
**XP-gated and gold-gated**, and the XP is per-stack, not per-man.

**XP cost to upgrade** (`DefaultPartyTroopUpgradeModel.GetXpCostForUpgrade`) — the cost of
*entering* each tier, summed over the tiers crossed:

| Target tier | XP |
|---|---|
| ≤1 | 100 |
| 2 | 300 |
| 3 | 550 |
| 4 | 900 |
| 5 | 1300 |
| 6 | 1700 |
| 7 | 2100 |
| 8+ | `1.333 × (level+4)²` |

**Gold cost to upgrade** (`GetGoldCostForUpgrade`) is
`(recruitCost(target) − recruitCost(source)) / 2` for regular troops, `/3` for
mercenaries/gangsters — so upgrading is always cheaper than buying the higher troop outright.

**Recruit cost by level** (`DefaultPartyWageModel.GetTroopRecruitmentCost`), which is also the
base of ransom value:

| Troop level | Base cost (denars) |
|---|---|
| ≤1 | 10 |
| ≤6 | 20 |
| ≤11 | 50 |
| ≤16 | 100 |
| ≤21 | 200 |
| ≤26 | 400 |
| ≤31 | 600 |
| ≤36 | 1000 |
| 37+ | 1500 |

Plus **+150** if the troop has a horse (**+500** if level ≥ 26), and **×3** total for
mercenary/gangster/caravan-guard occupations (`explainedNumber.Add(base × 2)`).

Upgrading also feeds the *player's* skills: `GetSkillXpFromUpgradingTroops` returns
`(troop.Level + 10) × numberOfTroops` Leadership XP.

**Sanity check against the wiki's per-troop data** (v1.3.13/1.3.14 infoboxes, e.g.
<https://mountandblade.fandom.com/wiki/Imperial_Legionary>): observed upgrade golds are
**T1→T2 15, T2→T3 25, T3→T4 50, T4→T5 50–100, T5→T6 100**, exactly matching
`(recruitCost(target) − recruitCost(source)) / 2` on the level bands above. Cavalry upgrades
*also* consume a **War Mount item** from your inventory (`UpgradeRequiresItemFromCategory`).

**So the total gold to walk a peasant to a tier-6 noble is ≈290 denars plus 1–2 war mounts.**
Elite troops are nearly free to *make* and expensive to *keep* (17/day vs 2/day). That is a
deliberate and unusual choice: the constraint on your army is **payroll**, not acquisition.

### 2.1b The six culture trees

Every culture has three or four common lines plus **one noble line**, and the noble line is the
only one that reaches tier 6. Noble recruits come **only from villages**
(<https://mountandblade.fandom.com/wiki/Notables>), which is what makes the map's geography
matter.

| Culture | Common lines (T1→T5) | Noble line (T2→T6) |
|---|---|---|
| Empire | Recruit → Infantryman → Trained Inf. → Veteran Inf. → **Legionary** (or Menavliaton → Elite Menavliaton); Archer → Trained → Veteran → **Palatine Guard** / **Bucellarii** / Crossbowman → Sergeant Crossbowman | Vigla Recruit → Equite → Heavy Horseman → Cataphract → **Elite Cataphract** |
| Vlandia | Recruit → Footman → Infantry → Swordsman → **Sergeant**; Spearman → Billman → **Pikeman/Voulgier**; **Levy Crossbowman** → Crossbowman → Hardened → **Sharpshooter** | Squire → Gallant → Knight → Champion → **Banner Knight** |
| Sturgia | Recruit → Warrior → Soldier → Spearman → **Heavy Spearman / Heavy Axeman**; Line Breaker → **Heroic Line Breaker**; Woodsman → Hunter → Archer → **Veteran Bowman** | Warrior Son → Varyag → Varyag Veteran → Druzhinnik → **Druzhinnik Champion** |
| Battania | Volunteer → Clan Warrior → Trained → Picked → **Oathsworn**; Wood Runner → Skirmisher → Veteran Skirmisher → **Wildling**; Raider → Falxman → **Veteran Falxman** | Highborn Youth → Highborn Warrior → Hero → Fian → **Fian Champion** |
| Khuzait | Nomad → Footman → Spearman → Spear Infantry → **Darkhan**; Hunter → Archer → **Marksman**; Tribal Warrior → Horseman → Lancer → **Heavy Lancer**; Raider → Horse Archer → **Heavy Horse Archer** | Noble's Son → Qanqli → Torguud → Kheshig → **Khan's Guard** |
| Aserai | Recruit → Tribesman → Footman → Infantry → **Veteran Infantry**; Light Archer → Archer → **Master Archer**; Mameluke Soldier → Regular → Cavalry → **Mameluke Heavy Cavalry**; Mameluke Axeman → Guard → **Palace Guard** | Youth → Tribal Horseman → Faris → Veteran Faris → **Vanguard Faris** |

**The two units everyone names.** *Khuzait Khan's Guard* — glaive + recurve bow + barded
warhorse, currently Polearm 200 / Bow 200 / Riding 200 after **patch 1.3.8 cut its bow from 260
to 200**; the wiki's own summary: *"when dismounted and ordered to hold fire, they can rival
Battanian Veteran Falxmen, Sturgian Heroic Line Breakers, and even Imperial Legionaries in
melee. In terms of pure foot archery, the only troops they will lose to are Battanian Fian
Champions"* (<https://mountandblade.fandom.com/wiki/Khuzait_Khan%27s_Guard>).
*Battanian Fian Champion* — Two-Handed 220 / Bow 220 / Athletics 170 after the same nerf and a
1.3.13 partial restore: *"It is not uncommon for a group of Battanian Fian Champions in your
army to kill two, three, or four times their number"*
(<https://mountandblade.fandom.com/wiki/Battanian_Fian_Champion>). Note the nerf history — any
guide quoting "280 Bow" is citing 2020 launch data.

**Bandits upgrade into nobles.** With Leadership's *Veteran's Respect*, captured bandit types
have documented upgrade targets: Sea Raider Chiefs → **Sturgian Druzhinnik**, Forest Bandits →
**Battanian Fian**, Raiders → **Khuzait Kheshig**, Harami → **Aserai Veteran Faris**, Looters →
Imperial Infantryman. Combined with prisoner conformity (§3.4), this is the only way to farm
tier-5/6 nobles far from their home villages.

## 2.2 Wages

Wages are paid **daily** in Bannerlord (they were every 7 days in Warband —
<https://mountandblade.fandom.com/wiki/Wages>). Base wage is a pure function of tier
(`DefaultPartyWageModel.GetCharacterWage`):

| Tier | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|---|
| Denars/day | 1 | 2 | 3 | 5 | 8 | 12 | 17 | 23 |

Mercenary-occupation troops cost **×1.5**. `MaxWagePaymentLimit = 10000`.

**Note the shape of that curve.** It is convex but shallow: a tier-6 elite costs 17× a
tier-0 recruit's 1 denar, but is worth far more than 17 recruits in a fight
(see §4.4 — troop power scales as `(2+tier)(10+tier)`, so tier 6 ≈ 8.6 power vs tier 0 ≈ 4.0,
but survivability and hit-throughput compound). **Elite-stacking is therefore always correct**,
which is one of the game's real balance failures and the reason experienced players run
120 Fian Champions.

## 2.3 Food

`DefaultMobilePartyFoodConsumptionModel`:

* `NumberOfMenOnMapToEatOneFood = 20`.
* Daily consumption = `−(members + prisoners/2) / 20` food units.
* Hard floor: `LimitMax(-0.01f)` — you always eat something.
* Garrisons, caravans, bandits, militia and villagers **do not** consume party food
  (`DoesPartyConsumeFood`).

So a 200-man party with 40 prisoners eats `(200+20)/20 = 11` food/day. Grain, meat, cheese,
butter, fish, olives, grapes, dates, beer, wine etc. are separate item types, and this is what
makes the *variety* rule bite (below).

## 2.4 Party morale — the exact formula

`DefaultPartyMoraleModel.GetEffectivePartyMorale`. Morale is recomputed from scratch every
time it is read; there is no stored morale except a decaying "recent events" pool.

```
morale = 50                                   // BaseMoraleValue
       + RecentEventsMorale                   // decays 10%/day
       + 0.1 × Leadership(effective leader)   // LeadershipMoraleBonus, +0.1 per point
       + (starving ? −30 : 0)                 // GetStarvationMoralePenalty
       + HasUnpaidWages × (−20)               // fraction unpaid × −20
       + perks
       + foodVarietyBonus                     // table below
       + partySizeOverflowPenalty             // −sqrt(members − sizeLimit)
```

`HighMoraleValue = 70`. Speed bonus above 70, speed penalty below 30 (see §2.6).

**Food variety bonus** (`CalculateFoodVarietyMoraleBonus`), keyed on the number of *distinct*
food item types in the inventory — quantity is irrelevant, one wheel of cheese counts the same
as fifty:

| Distinct food types | 0–1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Morale | −2 | −1 | 0 | +1 | +2 | +3 | +5 | +6 | +7 | +8 | +9 | +10 |

The Steward perk *Gourmet* **doubles the positive** part; the Steward perk *Warriors Diet*
zeroes the negative part. If the party is starving, variety is not counted at all.

This one table is a masterpiece of cheap depth: it converts the shopping screen into a
puzzle, gives every food item in the world a second reason to exist, and rewards a behaviour
(buy a little of everything) that also makes you visit more settlements.

**Daily penalties** (applied into `RecentEventsMorale`, then decaying 10%/day):
`GetDailyStarvationMoralePenalty = −5`, `GetDailyNoWageMoralePenalty = −3`.
`GetVictoryMoraleChange = +20`, `GetDefeatMoraleChange = −20`. Victory morale actually awarded
is `0.5 + renownValueOfBattle × contributionShare × 0.5`
(`DefaultBattleRewardModel.CalculateMoraleGainVictory`) — i.e. **scaled by how hard the fight
was and how much of it was yours.**

**Unpaid wages** (`DefaultClanFinanceModel.ApplyMoraleEffect`): if you pay `p` of a wage bill
`w`, then `unpaidFraction = 1 − p/w`, and morale takes `−3 × unpaidFraction` *immediately into
recent events*, plus a further `−3 × (unpaidFraction − previousUnpaidFraction)` if the debt is
getting worse. The standing `HasUnpaidWages` fraction then multiplies **−20** into the morale
formula every day until you pay.

## 2.5 Desertion

`DefaultPartyDesertionModel`:

* `GetMoraleThresholdForTroopDesertion() = 10`. Above morale 10, nobody deserts for morale.
* Per-troop desertion chance:
  `1 − ((level × 0.01) ^ (0.1 × (10 − clamp(morale,·,10)) / 10))`
  — **higher-level troops are stickier**, and the exponent goes to 0 as morale approaches 10
  (chance → 0), and to 0.1 as morale hits 0.
* The count that deserts for morale is
  `numberOfRegularMembers × chanceAtLevel20`.
* Separately, desertion from **unaffordable wages**: if `PaymentLimit < totalWage`, then
  `n = clamp(  (totalWage − paymentLimit) / AverageWage × 0.25 , 1, 20 )` men leave per day —
  **a maximum of 20 desertions per day**.
* Separately, desertion from **over party size**: `max(1, (members − sizeLimit) × 0.25)`.
* Garrisons with unpaid wages lose an extra `min(healthy, 5)`.
* Desertion walks the roster **from the bottom up** (`num2 = count − 1` downward), i.e. the
  cheapest, newest troops leave first. Heroes never desert.

## 2.6 Party speed

`DefaultPartySpeedCalculatingModel`. `BaseSpeed = 4`, `MinimumSpeed = 1`.

```
base = 4 × (200 / (200 + menCount)) ^ 0.4
```

Then multiplicative factors (`AddFactor`, i.e. all summed then applied):

| Factor | Value |
|---|---|
| Cavalry | `+0.3 × mountedMen / totalMen` |
| Mounted footmen (spare horses in inventory) | `+0.15 × mountedFootmen / totalMen` |
| Wet weather | cancels 30% of both cavalry bonuses |
| Cargo within capacity | `−0.02 × weight / capacity` |
| Overburdened (weight > capacity) | `−0.4 × excess / capacity` |
| Over party size | `1/(men/limit) − 1` (halved for the "deserters" clan) |
| Herd (pack + livestock animals beyond headcount) | `max(−0.8, −0.3 × excessHerd / men)` |
| Wounded (only if wounded > men/4) | `max(−0.8, −0.05 × wounded / men)` |
| Prisoners | `1 / ((10+men+prisoners)/(10+men))^0.33 − 1` |
| Over prisoner limit | `1/(prisoners/limit) − 1` |
| Morale > 70 | `+0.05 × (morale−70)/30` |
| Morale < 30 | `−0.1 × (1 − morale/30)` |
| Disorganized (just fled a battle) | `−0.4` |
| Caravan | `+0.1` |

Then terrain/time-of-day factors in `CalculateFinalSpeed`: **forest −0.3**, **fording water
−0.3**, **desert/dune −0.1**, **snow/blizzard −0.1**, **night −0.25**.

This is the deepest single formula in the game for gameplay purposes, because it turns every
inventory decision into a movement decision. Selling the prisoners speeds you up. Buying
spare horses speeds you up. Winning a big fight and taking 60 wounded slows you down exactly
when you most want to run.

## 2.7 Party size limit

`DefaultPartySizeLimitModel.CalculateMobilePartyMemberSizeLimit`:

```
limit = 20                                      // base
      + 20 if you are a kingdom's leader
      + 25 × clanTier   (if you are the clan leader)
        or 15 × clanTier (if you are a family member leading a party)
      + 0.25 × Steward skill of the effective Quartermaster
      + perks (Prestige, Hope, Imposing Stature, Merry Men, Horde Leader,
               Mounted Scouts, Authority, Uplifting Spirit, Talent Magnet, …)
      + 40 if clanTier ≥5 and kingdom runs the "Noble Retinues" policy
      + 60 if you are the ruler and the kingdom runs "Royal Guard"
```

Garrison limit is `200 (+200 if town) + 0.2 × Leadership of the owner` + buildings.
Prisoner limit is `10 + healthyMembers/2` + perks. Settlement prisoner limit is
`60 + 40 × wallLevel`.

Companion limit = `clanTier + 3` (`DefaultClanTierModel.GetCompanionLimitFromTier`, plus the
*We Pledge Our Swords* and *Camaraderie* perks; the wiki's older table reads 3/4/5/7/8/9 for
tiers 1–6 — trust the source).
Party (i.e. lieutenant party) limit = 1 at tiers 0–2, 2 at tiers 3–4, 3 at tiers 5–6.

## 2.8 Healing and the surgeon

`DefaultPartyHealingModel`:

* **Surgery chance = `0.0015 × Medicine skill`.** At Medicine 300 that's **45%** — i.e. 45%
  of men who would have died are merely wounded. This is the single number that converts a
  companion into a strategic asset.
* Base daily healing for regulars: **+5 HP-equivalent/day**, plus
  `HealingRateBonusForRegulars` from Medicine, plus perks (Triage Tent when stationary).
* Starving: instead of healing, you **lose 25% of your regulars per day**
  (`−totalRegulars × 0.25`); a starving garrison loses 10%/day.
* Prisoners heal at exactly **+1/day**.
* Hero survival on a would-be-fatal blow is a separate roll:
  `1 + level×0.02 + armour×0.01 − age×0.01`, then `AddFactor(50)` for heroes — i.e. heroes are
  ~50× less likely to die than a regular. Difficulty settings can pin it to 1.0.

---

# 3. Recruitment

## 3.1 Notables are the recruitment API

You do not "buy troops from a village". You buy them from a **notable** — a named,
persistent NPC with a `Power` stat who lives in a settlement. Occupations that can hold
recruits (`DefaultVolunteerModel.CanHaveRecruits`): **Headman / Rural Notable (village
elders), Gang Leader, Merchant, Artisan, Preacher, Mercenary**.

Each notable has an array `VolunteerTypes[6]` — six slots. Your **relation with that specific
person** decides how many of those six slots you may take from.

**How many notables:** villages hold **2–3** (headman / rural notable), towns hold **4–6**
(artisan, merchant, gang leader), they are randomly named at campaign start, and they **survive
conquest** (<https://mountandblade.fandom.com/wiki/Notables>). So a village at good relation is
worth roughly **~18 volunteers** per sweep. A notable's `Power` gates *tier*: above 200
("Powerful") they can offer noble recruits. Patch 1.5.7 rebalanced starting power so only
**20% start Powerful (200+) and 60% Influential (100–200)** — previously *"nearly all had
200+"*.

`DefaultVolunteerModel.MaximumIndexHeroCanRecruitFromHero`:

```
slots = 1                                  // base
      + playerRecruitSlotBonus(difficulty) // player only
      + gangLeaderPerkBonus
      + relationBonus                      // table below
      + 1 if the notable's settlement is in your faction
      + 1 if the buyer is NOT the player (AI lords get a free slot)
      − (1 or 2) if you are at war with the settlement's faction
      + perk bonuses (ArtisanCommunity, CombatTips, Firebrand, FlexibleEthics,
                      EngineeringGuilds)
      , capped at 6
```

**Relation → extra recruit slots:**

| Relation | ≥100 | ≥80 | ≥60 | ≥40 | ≥20 | ≥10 | ≥5 | ≥0 | <0 |
|---|---|---|---|---|---|---|---|---|---|
| Slots | +7 | +6 | +5 | +4 | +3 | +2 | +1 | 0 | −1 |

**This is the load-bearing consequence chain in the whole game.** Relation with a *named
peasant* is the tap on your army. Everything you do near a village — completing the elder's
quest, raiding it, letting bandits extort it, defending it — moves that number, and the number
moves how many men you can buy there forever after.

## 3.2 Refresh rate

`GetDailyVolunteerProductionProbability(hero, index, settlement)`:

```
p0 = 0.7
     + up to +0.2 if the faction has few fiefs   // (1 − factionScore) × 0.2
p  = 0.75 × clamp(p0 ^ (index+1), 0, 1)
     × (1 + 0.2 if the kingdom runs the "Cantons" policy)
     × CavalryTactics perk bonus if the slot's troop is mounted
```

Where `factionScore` is a saturating count of the faction's towns (weighted 1/2/3 by
prosperity <3000/<6000/≥6000) and villages, normalised against **46**.

So slot 0 refills at ~52%/day, slot 1 at ~37%, slot 2 at ~26%, slot 5 at ~9%. **Deep slots
refill slowly.** The result: a notable is a *renewable but rate-limited resource*, and
sweeping the same three villages on a loop is genuinely how you build an army.

## 3.3 What they offer

`GetBasicVolunteer(sellerHero)` returns `culture.BasicTroop` — or `culture.EliteBasicTroop`
if the notable is a **rural notable in a village bound to a castle**. That is the entire
mechanism by which "castle villages give noble troops" works, and it's one line. Volunteers
are seeded at the basic tier and upgraded over time by the recruitment behaviour;
`MaxVolunteerTier = 4`.

## 3.4 Prisoners → troops (conformity)

`DefaultPrisonerRecruitmentCalculationModel`. A prisoner in your stockade accrues
**conformity** (stored as the roster element's XP):

* `conformityNeeded = (level + 6)² − 10`.
* `conformityChangePerHour = 10 + 0.05 × Leadership` (+ perks).
* Recruiting a prisoner costs morale: **−1 per man**, **−2 per man for bandits**
  (zeroed by the perks *Presence* for same-culture, *Two Faced* for bandits).
* Parties only auto-recruit prisoners if morale > 30, they're under the size cap, and they
  aren't over their wage limit.

A level-11 bandit therefore needs `(17)² − 10 = 279` conformity ≈ 28 hours in your cage at
base rate. This is a real, second recruitment economy: every battle you win is also a
recruitment run, and it works on cultures whose villages hate you.

## 3.5 Bandit hideouts and tavern mercenaries

### Bandit hideouts

The third troop source, indirectly. `DefaultHideoutModel`: a hideout can **only be attacked
between sunset+1 and sunrise**, and once cleared it stays hidden for **10 days**
(`HideoutHiddenDuration`). Clearing one gives 700–1000 Roguery XP (225–400 on failure), and
`+6 security` to every settlement within 100 map units (§6.3). **You attack with exactly eight
troops** — *"the game just grabs the first eight units from the top of your party screen"*
(companions auto-selected first), against 50–60 bandits, in a staged fight where kills persist
between attempts and you can withdraw by standing in the red zone for 10 seconds, ending in a
duel with the boss
(<https://www.gosunoob.com/mount-blade-2-bannerlord/bandits-hideouts-tips/>). Bandit spawn density scales
with `Campaign.PlayerProgress` (`DefaultBanditDensityModel`: e.g. bandit party count caps at
`floor(9 × (2 + playerProgress))`), which is a quiet difficulty ramp tied to how far along you
are.

### Mercenaries in taverns

`DefaultTavernMercenaryTroopsModel.RegularMercenariesSpawnChance = 0.7` — a 70% chance a tavern
has a mercenary stack for sale. They cost **×3 base recruit price** and **×1.5 wages**, but
they arrive at high tier immediately. Tavern also holds **wanderers** (companions) whom you
hire in conversation.

---

# 4. Battle

## 4.1 How a battle starts

Two party icons touch → `MapEvent` created with an `AttackerSide` and a `DefenderSide`, each a
`MapEventSide` holding a list of `MapEventParty`. Reinforcement waves are drawn from the same
rosters. `MapEvent.BattleTypes` = `FieldBattle | Siege | SiegeOutside | SallyOut | Raid |
Hideout | ...`.

Before the fight resolves, either side can *run away*
(`MapEvent.CheckSideRunAway` → `EncounterModel.GetMapEventSideRunAwayChance`). If a side
flees, a **pursuit** phase of `GetPursuitRoundCount() = 4` rounds runs in which only the
pursuer gets attack ticks; then `EndByRunAway()`.

The flee test (`DefaultEncounterModel.GetRunAwayChanceInternal`) is precise and worth copying:
a side may flee **only** if the battle has run ≥8 update rounds, its side morale is **≤20**,
and it has **lost all of the last 4 rounds**. Then the chance is **20% per check, minus 5
percentage points per point of the leader's Valor trait**. Sieges, sally-outs and raids are
exempt, and **the player's side never flees automatically** — the player is always given the
choice. So "the enemy broke and ran" is a four-condition gate, not a random event, and it is
attached to a *named personality trait of the enemy commander*.

## 4.2 The order system

`OrderType` (in `TaleWorlds.MountAndBlade/OrderType.cs`) is the complete verb list:

```
Move, MoveToLineSegment, MoveToLineSegmentWithHorizontalLayout,
Charge, ChargeWithTarget, StandYourGround, FollowMe, FollowEntity, Retreat,
AdvanceTenPaces, FallBackTenPaces, Advance, FallBack,
LookAtEnemy, LookAtDirection,
ArrangementLine, ArrangementCloseOrder, ArrangementLoose, ArrangementCircular,
ArrangementSchiltron, ArrangementVee, ArrangementColumn, ArrangementScatter,
FormCustom, FormDeep, FormWide, FormWider,
CohesionHigh, CohesionMedium, CohesionLow,
HoldFire, FireAtWill, RideFree, Mount, Dismount,
AIControlOn, AIControlOff, Transfer, Use, AttackEntity, PointDefence
```

The UI binds them as two-key chords: **F1** = movement group (F1 move here / F2 charge /
F3 advance / F4 fall back / F5 stand / F6 retreat), **F2** = facing, **F3** = arrangement
(F1 Line, F2 Shield Wall, F3 Loose, F4 Circle, F5 Square, F6 Skein, F7 Column, F8 Scatter),
**F4** = fire/AI toggles, **F5** = mount/dismount, **F6** = AI control on/off. Community
reference: <https://calradiawar.com/handbook/bannerlord-command-tactical-guide>,
<https://www.pcinvasion.com/mount-blade-ii-bannerlord-battle-tactics-armies-formations-tips/>,
<https://www.iskmogul.com/mount-blade-2-bannerlord-battle-formations-guide/>.

Formations are numbered 1–8 (select with number keys) and default to Infantry / Archers /
Cavalry / Horse Archers.

**Arrangement is not cosmetic.** `ArrangementOrder` carries two concrete effects
(`ArrangementOrder.cs`):

| Arrangement | Unit spacing | Run speed restriction |
|---|---|---|
| Line | 2 | 0.8 |
| Loose | 6 | 0.9 |
| Scatter | 2 | 0.9 |
| Skein (Vee) | 2 | 0.9 |
| Shield Wall | 0 | **0.3** |
| Square (schiltron) | 0 | **0.3** |
| Circle | 2 | **0.5** |
| Column | 2 | 1.0 |

Plus `GetUnitLooseness` is false only for Shield Wall (units lock to their slot), and
`GetShieldDirectionOfUnit` makes shield-wall units raise shields **forward**, and circle/square
units raise shields **outward from the centre**. So the tradeoff is legible and physical:
*shield wall gives you a shield facing and near-zero ranged vulnerability, at a third of your
run speed.*

## 4.3 Captains and formation bonuses

Assigning a hero as a formation's captain applies that hero's **Captain-role perks** to every
man in the formation. `DefaultBattleCaptainModel.GetCaptainRatingForTroopUsages` scores a hero
for a troop type as `Σ(requiredSkillValue of matching captain perks) / 1650` — i.e. the game
computes, per hero per troop-type, a 0..1 "how good a captain is this person for these men"
number, and the UI sorts by it.

The commander's own perks also feed the **autoresolve** through
`DefaultMilitaryPowerModel.GetPowerModifierOfHero`, which counts the hero's Captain-role perks
by how deep in the skill tree they are and returns
`0.01×(shallow) + 0.02×(mid) + 0.03×(deep) + 0.06×(epic)` as a flat multiplier on every troop
in the party.

## 4.4 The autoresolve maths

This is worth reading closely because it is short, and it is the actual model of "who wins".

`DefaultMilitaryPowerModel.GetDefaultTroopPower(troop)`:

```
n = troop.IsHero ? (heroLevel/4 + 1) : troop.Tier
power = (2 + n) × (10 + n) × 0.02 × (hero ? 1.5 : mounted ? 1.2 : 1.0)
```

| Tier | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Power (foot) | 0.40 | 0.66 | 0.96 | 1.30 | 1.68 | 2.10 | 2.56 |

Party power = `Σ (healthy count × troopPower)`, then **× 0.7 if party morale < 30**
(`GetPowerOfParty`). Morale is literally worth 30% of your army.

`DefaultCombatSimulationModel.SimulateHit`:

```
damage = (0.5 + 0.5 × rand) × 40 × (attackerPower / defenderPower)^0.7 × advantage
       × (1 + moraleFactor + perkFactors)
moraleFactor = (min(strikerMorale − 50, 0) − max(struckMorale − 50, 0)) × 0.005
```

Note the exponent **0.7**: power ratio is *sublinear*, so a 2× stronger troop does only
`2^0.7 = 1.62×` damage. That's the anti-snowball damper inside the tactical model.

**Number of attack ticks per round** (`GetSimulationTicksForBattleRound`), the thing that
decides how fast a battle burns down:

* Normal, >10 defenders: attacker ticks `= round(min(defenders × 2, attackers^0.6))`,
  defender ticks `= round(min(attackers × 2, defenders^0.6))`.
* ≤10 defenders: `max(round(min(other × 3, own × 0.3)), 1)`.
* **Siege:** defender ticks `= round(1.5 + defenders^0.3) × 2`, attacker ticks
  `= round(0.5 + max(1 + defenders^0.3 × settlementAdvantage × 0.7, ratio)) × 2`.

`GetBattleAdvantage` is `1 + TacticsAdvantage(leader's Tactics skill)` per side, and the
attacker in a siege gets an extra flat `−0.1`.

**Win condition** (`MapEvent.CalculateWinner`): a side loses when its remaining simulation
troops hit zero, **or when its side morale hits 0** — in which case
`GetMapEventSide(loser).Route()` is called, which marks every remaining man as "routed"
rather than casualty (`OnTroopRouted` adds only `troopPower × 0.1` to casualty strength).
Routing is therefore *cheap for the loser's manpower and expensive for their reputation*.

`GetSideMorale()` is the **strength-weighted average of the participating parties' campaign
morale** — with a floor of 30 for besieged defenders and for a lord's-hall last stand.

## 4.5 Rout in the real-time battle

Different system, same idea. Every AI agent carries a `CommonAIComponent` with a morale
0–100 (`_morale = 50f` default):

* `MoraleThresholdForPanicking = 0.01` — an agent panics when morale reaches ~0.
* `RecoveryMorale = InitialMorale × 0.5`; below that, morale regenerates at
  **0.4 per second** (`MoraleRecoveryPerSecond`) *until* it panics once, after which no
  recovery.
* On panic: `MissionAgentPanicHandler` calls `commonAIComponent.Retreat()` and the man runs
  for the map edge.

What *removes* morale (`CustomBattleMoraleModel`):

* **A man is killed**: the affected side loses up to
  `battleImportance × 4 × weaponFactor × casualtiesFactor`; the killing side *gains*
  `battleImportance × 3 × weaponFactor`.
  * `weaponFactor` = **0.75 melee**, **0.5 ranged**, **0.25 AoE** (siege boulder etc., +25%
    again if burning-and-penetrating).
* **A man panics**: nearby friendlies lose `battleImportance × casualtiesFactor × 1.1`;
  enemies gain `battleImportance × 2`. **Panic is contagious**, and this is the mechanism.
* `casualtiesFactor = 1 + 2 × (fraction of that side already removed)` — so morale damage
  *accelerates* as a side loses men. This is the mathematical shape of a collapse.
* Per-agent absorption: `moraleChange / max(1, character.MoraleResistance)` — elite troops
  have higher resistance, which is why 50 Legionaries don't break and 300 recruits do.
* Banners (`BannerComponent` / `DefaultBannerEffects.DecreasedMoraleShock`) reduce incoming
  morale shock for the formation carrying them.

Cavalry charges cause routs not by a special rule but emergently: a cavalry charge into a
loose formation kills several men in a second, each kill applying `×0.75` melee morale shock
multiplied by a `casualtiesFactor` that just jumped.

## 4.6 After the battle

* **Renown**: `renownValue = (enemyStrength × √siegeAdvantage)^0.75 × strengthRatio^0.45 ×
  typeConstant × 0.75`, where `typeConstant` is **0.7 siege assault / 0.6 sally-out, raid, or
  any settlement battle / 0.5 field battle**, and
  `strengthRatio = (enemyStrength × √adv + 10) / (ownStrength × adv + 10)`, capped at 10.
  **You get more renown for winning against odds.**
* **Influence**: same shape with exponent 0.15 on the ratio and a 0.6 constant — influence is
  much less odds-sensitive than renown.
* Each is then split by `contributionShare` per party.
* **Loot**: expected item value per casualty is `7.25 × level²`
  (`GetExpectedLootedItemValueFromCasualty`), ×random 0.85–1.15 for the player. Loot chance
  weights are the parties' `ContributionToBattle`; troop-loot share is capped at **0.75** of
  the pool and prisoner-loot at **0.55**, i.e. some always escapes.
* **Gold**: the defeated leader loses `min(5% of gold, 10000)`
  (`CalculateGoldLossAfterDefeat`); a defeated caravan gives up 10% of trade gold, a bandit
  party 50%.
* **Player relation gain with allied lords who fought with you**:
  `0.75 + (contributionRate × 1.3 × (oddsFactor + renownValue))^0.67` — again, harder fights
  buy more friendship.

---

# 5. Sieges

## 5.1 The camp and the engines

Besieging creates a `BesiegerCamp` and a `SiegeEvent` with two `ISiegeEventSide`s, each with a
`SiegeEnginesContainer` (deployed slots + a reserve). The first thing built is
`DefaultSiegeEngineTypes.Preparations` — the camp itself — and nothing else can be deployed
until `PreparationProgress ≥ 1`.

**Construction rate** (`DefaultSiegeEventModel.GetConstructionProgressPerHour`):

```
manDayPower = sqrt(total healthy men on that side)
progressPerHour = 1 / (engine.ManDayCost / manDayPower × 24)
                × (1 + SiegeEngineProductionBonus from the Engineer's Engineering skill)
                × building / governor / perk factors
```

**The `sqrt`** is the important bit: doubling your army only speeds construction by 1.41×.
Sieges are therefore *time* costs, not manpower costs, and an army of 2000 sits outside a
castle almost as long as an army of 500 — which is the mechanical root of the complaint that
sieges are boring.

Engine types: `Preparations, Ladder, Ram, ImprovedRam, SiegeTower, Ballista, FireBallista,
Onager, FireOnager, Catapult, FireCatapult, Trebuchet, Bricole`
(`TaleWorlds.Core/DefaultSiegeEngineTypes.cs`). Towns can start a siege with pre-built
defensive ballistae/catapults from buildings (`BallistaOnSiegeStart`, `CatapultOnSiegeStart`)
and one extra catapult if the governor has the *Siege Works* perk.

## 5.2 The defender's advantage number

`DefaultCombatSimulationModel.GetSettlementAdvantage(settlement)`:

```
wallTerm  = 4 + (wallLevel − 1)          // ×0.25 if walls are fully breached
numerator = 1 + wallTerm
denominator = 1
  + 0.25 if (ram built OR any siege tower)
  + 0.24 if improved ram, else 0.16 if ram
  + 0.24 if ≥2 towers, else 0.16 if 1 tower
  + 0.08 per non-fire ranged engine
  + 0.12 per fire engine
advantage = numerator / denominator
```

So a level-1-wall castle with no engines built against it defends at **5.0×**. Build a ram and
two towers and four trebuchets and it drops to `5 / (1+0.25+0.16+0.24+0.32) = 2.5×`. Breach
the walls and `wallTerm` is quartered, giving `2.0 / 1.97 ≈ 1.0×`. **Breaching the wall is
worth roughly a 4× swing.** A village defends at a flat 1.25×; open field is 1.0×.

## 5.3 Starvation

Food is the siege clock (`DefaultSettlementFoodModel`):

* `FoodStocksUpperLimit = 300`, `+150` for castles.
* Consumption/day = `prosperity / 40 + garrisonMen / 20`.
* **Not** under siege, production = `+15` (town) or `+10` (castle) from "the lands around the
  settlement", plus `(hearthLevel + 1) × 6` from each bound village.
* **Under siege, all of that production is set to zero** — the villages are cut off in one
  `if`. Only the stock drains.

So a town of prosperity 6000 with a 300-man garrison eats `150 + 15 = 165/day` and dies in
under two days of stock; a castle of prosperity 2000 with 200 men eats `50 + 10 = 60/day`
against 450 stock ≈ 7.5 days. Players report roughly **~30 days for a castle, ~100 days for a
big town** in practice under the older tuning
(<https://steamcommunity.com/app/261550/discussions/0/2264691117429770573/>), which reflects
market stock and prosperity decay feeding back in.

When starving: garrison loses **10% of its regulars per day**
(`DefaultPartyHealingModel`), militia stops, and morale takes a flat **−30**
(`GetStarvationMoralePenalty`), with a `−5` daily hit into the recent-events pool.

## 5.4 Assault, sally-out, aftermath

* **Assault**: a `MapEvent` of type `Siege`. Attacker takes a flat `−0.1` advantage in the
  simulation, and the defender's tick count is inflated by `settlementAdvantage`.
  If the wall is breached the defenders fall back through
  `Settlement.SiegeState.InTheLordsHall`, where their side morale is floored at 30
  (`GetSideMorale`) — the last stand does not rout.
* **Sally out**: a `BattleTypes.SallyOut` map event where the besieged garrison attacks the
  camp. `DefaultSiegeLordsHallFightModel` covers the lord's-hall fight.
* **Aftermath** — the player is asked to *Show Mercy / Loot / Devastate*.
  `DefaultSiegeAftermathModel.GetSiegeAftermathTraitXpChangeForPlayer` returns Mercy trait XP:
  **−50 for devastating a town, −30 for a castle; +20 / +10 for showing mercy.**
* Post-siege militia respawn: `2 × (45 + rand(10))` men (`MilitiaToSpawnAfterSiege`) — i.e.
  90–108. A town you just took immediately grows its own defenders back.

---

# 6. The kingdom / clan layer

## 6.1 Clan tier and renown

`DefaultClanTierModel`: `MinClanTier 0`, `MaxClanTier 6`.
Renown thresholds `{0, 50, 150, 350, 900, 2350, 6150}` — note the growth factor (≈2.5×/tier),
so tier 6 costs 2.6× tier 5 and 17× tier 3.

Each tier gives: `+25 × tier` party size (as clan leader), `+1` companion slot,
another lieutenant party at tiers 3 and 5, and `tier + 1` workshops
(`GetMaxWorkshopCountForClanTier = tier + 1`).

Initial influence for an NPC clan: `150 + rand(renown/15) + rand(rand(rand(400)))`.

## 6.2 Influence — where it comes from and where it goes

**Income** (`DefaultClanPoliticsModel.CalculateInfluenceChange`, per day):

* `+3` if you are the kingdom's ruler.
* Army membership: `(partyStrength + 20) / 200` per day per party of yours serving in
  *someone else's* army (`DailyBeingAtArmyInfluenceAward`).
* Supporter notables: `+0.05 / +0.10 / +0.15` each by notable power rank
  (Regular / Influential ≥100 / Powerful ≥200 — `DefaultNotablePowerModel`).
* Buildings and a dozen kingdom policies (`Bailiffs` +1 per secure town,
  `Council of the Commons` +0.1 per notable, `Serfdom` +0.2 per village,
  `Feudal Inheritance` +0.1 per settlement, `Senate` +0.5 at tier ≥3,
  `Noble Retinues` **−1**, `Trial by Jury` **−1**, …).
* Mercenary clans **lose** influence continuously.
* Player crime rating: `−0.5 × crimeRating` per day.
* Battle influence: `(enemyStrength)^0.75 × strengthRatio^0.15 × 0.6 × contributionShare`,
  only if your faction is a kingdom.
* Capturing a settlement: **+30 town, +10 castle, +10 per village**
  (`GetInfluenceAwardForSettlementCapturer`, and a town also pays out its villages').

**Spending** (`DefaultDiplomacyModel`):

| Action | Influence |
|---|---|
| Support a clan in a decision | 50 |
| Propose peace | 100 |
| Propose a policy / disavow one | 100 |
| Propose war | 200 (×2 under the *War Tax* policy if you're the ruler) |
| Propose annexing a fief | 200 (×2 under *Feudal Inheritance*, ×0.5 under *Precarial Land Tenure* for the ruler) |
| Expel a clan | 200 |
| Change an army's leader | 30 |
| Disband an army | 30 (halved if you're the ruler) |
| Abandon an army | 2 |

**Voting** (`KingdomDecision.GetInfluenceCostOfSupportInternal`): each clan (including you)
can throw weight at an outcome — **Slightly favor 20 / Strongly favor 60 / Fully push 150**
influence (fief votes use 20 / 60 / **100**). AI clans decide how hard to push by comparing
their influence against those thresholds. Their *merit* for an outcome is scored partly on
`relation × 0.8` with the proposer (`CalculateRelationshipEffectWithSponsor`).

Expelling a clan costs the expeller `−20` relation with it
(`GetRelationCostOfExpellingClanFromKingdom`); disbanding an army costs `−4` relation with the
leader party and `−1` with everyone else.

## 6.3 Fiefs: prosperity, loyalty, security

**Prosperity** (`DefaultSettlementProsperityModel`) is band-based, which is a deliberate
stabiliser:

| Town prosperity | Daily change from "housing costs" |
|---|---|
| <250 | +6 |
| <500 | +5 |
| <750 | +4 |
| <1000 | +3 |
| <1250 | +2 |
| <1500 | +1 |
| >15000 | −4 |
| >18000 | −5 |
| >21000 | −6 |

Plus `0.5 × foodShortage` when starving, plus loyalty effects
(`HighLoyaltyProsperityEffect = +0.5` above loyalty 75; `LowLoyaltyProsperityEffect = −1`
below 25).

**Village hearths**: `+4/day` below 300 hearth, `+1.2` below 600, `+0.2` above.
Raided (`VillageStates.Looted`): `−1/day`. Hearth floors at 10, never dies.

**Loyalty** (`DefaultSettlementLoyaltyModel`), summed daily:

| Source | Effect |
|---|---|
| Governor same culture / different culture | +1 / −1 |
| **Owner clan's culture ≠ settlement culture** | **−3** |
| Security ≥50 / <50 | +1 / −2 |
| Notable supporting your clan / supporting an enemy | +0.5 / −0.5 each |
| Starvation past day 14 | −1 more per day |
| Drift toward 50 | pulls toward `LoyaltyDriftMedium = 50` |
| Policies | Citizenship ±0.5, Grazing Rights +0.5, Trial by Jury +0.5, Hunting Rights −0.2, Imperial Towns +1 for the ruling clan, … |

Thresholds: loyalty **≥75** → `+MBMath.Map(loyalty,75,100,0,0.2)` tax bonus and a
prosperity boost and **+1 relation/day with every notable in the settlement**; loyalty **<50**
→ tax corruption, scaling to **−50% tax** at loyalty 25; loyalty **<25** →
`InRebelliousState`, militia gets up to a **+200%** boost
(`MilitiaBoostPercentage = 200`); loyalty **<15** → **rebellion**, the town flips to a rebel
clan starting at clan tier 3 (`RebelClanStartingTier`).

That `−3` for owning a settlement of a different culture is the whole reason a conquering
empire destabilises: it is not a special "overextension" system, it is one constant in a
daily sum.

**Security** (`DefaultSettlementSecurityModel`): drifts to 50; hideout cleared within 100 map
units gives `+6`; ≥75 gives `+5%` tax; <50 gives `−10%` tax and notable relation penalties;
map events within radius 50 hurt it. Trade commission also drops with security
(`GetTownCommissionChangeBasedOnSecurity`, up to `−10%` at security 0).

**Militia** (`DefaultSettlementMilitiaModel`): `+2/day` base for a fortification,
`+prosperity/1000` (town) or `+hearth/400` (village), `−2.5% of current militia/day` retiring.
Half melee, half ranged.

**Taxes** (`DefaultSettlementTaxModel`): town commission rate **0.7**, village **1.0**;
`+5%` under the *Crown Duty* policy.

## 6.4 Money

Clan gold is a daily sum of fief taxes, workshop profit, caravan profit, party trade, minus
wages and garrison wages. Two constants matter for feel:

* `PartyGoldLowerThreshold = 5000` — below this, an AI clan is "poor".
* **AI wage budgets** (`ClanVariablesCampaignBehavior.MakeClanFinancialEvaluation`):
  * leader gold > **90,000** → parties get the full **10,000** wage limit;
  * leader gold > **30,000** → limit = `600 + (gold−30000)/60000 × 600` (i.e. 600–1200),
    ×1.5 for the clan leader's own party;
  * otherwise → limit = `200 + (gold/30000)² × 400`, ×1.5 for the leader.

  And if `PaymentLimit < totalWage`, up to **20 men desert per day**. **This is the AI army-size
  governor.** Every lord's party size in the world is downstream of that clan's bank balance.

### Workshops and caravans in one paragraph each

* Workshop: buy price `equipmentCost + prosperity×4 + 2000` (**13,000–20,000 in practice**);
  `DailyExpense = 100`; `WarehouseCapacity = 6000`; you may own `clanTier + 1`; a town has 4
  workshop slots by default; changing production type costs a flat **2,000**. Selling back to a
  notable nets `(equipmentCost + prosperity/2 + capital)/2`. **Observed profit 200–400/day**
  (~50–75 day payback), and it is entirely a function of whether the town's bound villages
  produce the input — a brewery wants two grain villages
  (<https://mountandblade.fandom.com/wiki/Workshop>,
  <https://www.pcgamesn.com/mount-and-blade-2-bannerlord/workshops-best-locations>). Two
  workshops of the same type in one town cannibalise each other; a war or siege on the town
  **zeroes** them.
* Caravan: **15,000** (or 22,500 large). Party size = the base 20 **+10** (normal) or **+30**
  (elite) for a player caravan; an NPC notable's caravan gets `10 × (1|2|3)` by the notable's
  Power (<100 / <200 / ≥200). Buys at most 300 items of one category per stop.
  Forming a caravan costs the notable **−30 Power** if they had ≥50.

## 6.5 War, peace, and tribute

`DefaultDiplomacyModel.GetWarProgressScore` — the war score, capped **0–750**:

```
kills        = max(0, (theirCasualties − ourCasualties) / max(1, theirTotalMen × 4)) × 500
townSieges   = max(0, (ourTownTakes − theirTownTakes) / max(1, theirTowns + delta)) × 1000
castleSieges = same shape × 500
raids        = max(0, (ourRaids − theirRaids) / max(1, theirVillages)) × 250
```

Taking towns is worth 4× as much war score as raiding, and 2× as much as casualties.
Tribute is negotiated off this score via a barter; `GetWarScale` decays the whole war's
importance if it drags: after 20 days,
`scale = totalCasualties / (20 × days^1.5)`, so a long, bloodless war matters less and less.

War declaration is scored per-clan:
`sameCultureTownScore + benefit × exposure × allianceFactor − risk + relationScore`, and is
hard-blocked (`−10,000,000`) if the declaring faction has `CurrentTotalStrength ≤ 500` or
fewer than 2 war parties. Alliances multiply the score by `1 − 0.4` against an ally and
`1 + 0.3` against an enemy of an ally.

Relations are clamped **−100 … +100** (`MaxRelationLimit / MinRelationLimit`), with a
"neutral band" of `−25 … +50`. Gifting a town buys **+20** relation; a castle **+10**.

**Founding your own kingdom** (`DefaultKingdomCreationModel`) requires: clan tier **≥4**, at
least **1 settlement**, at least **100 troops**, and your clan must be independent. You pick up
to **4 initial policies**. There is no legitimacy check — contrast Warband's Right to Rule
(§10.3).

**Alliances and trade agreements now exist in vanilla** (as of the 1.3 line —
`DefaultAllianceModel`, `DefaultTradeAgreementModel`), which is TaleWorlds absorbing the
single most-installed mod in the game's history (§9). The terms:
`MaxNumberOfAlliances = 2`, `MaxDurationOfAlliance = 84 days`,
`MaxDurationOfWarParticipation = 42 days`, offers expire in **24 hours**;
trade agreements cost **200 influence** to propose and a kingdom may hold **2**. War
declaration score is multiplied by `1 − 0.4` against an ally and `1 + 0.3` against an ally's
enemy (`WarDeclarationScorePenaltyAgainstAllies`, `…BonusAgainstEnemiesOfAllies`).

## 6.6 Executing prisoners

`DefaultExecutionRelationModel` — the game's harshest single lever:

| Effect of the player executing a lord | Value |
|---|---|
| Relation with the victim's **clan** | **−60** |
| Relation with the victim's **friends** | **−30** |
| Relation with everyone in the victim's **faction** | **−10** |
| Relation with honourable nobles anywhere | **−10** |
| Player **Honor trait XP** | **−1000** |

If the victim was themselves dishonourable (`Honor < 0`) the penalties drop to −30 clan / −15
friend / −5 faction. AI heroes executing each other take −40 clan / −10 friend.

## 6.7 Ransom

`DefaultRansomValueCalculationModel.PrisonerRansomValue`:

```
base    = recruitmentCost(prisoner)
heroAdd = (clanTier + 2) × 200 × (clanLeader ? (kingdomLeader ? 6 : 2.5) : 1)
        + sqrt(prisonerGold) × 6
fiefMul = fiefs<8 ? (fiefs+1)/9 : 1 + sqrt(fiefs−8) × 0.1   // 0.5 if clanless
value   = (base + heroAdd) × (hero ? 1 : 0.25) × fiefMul
```

A tier-4 clan leader of a 15-fief kingdom with 20,000 gold is worth
`(1500 + 6×200×2.5 + √20000×6) × 1.27 ≈ 6,900` denars. A tier-6 *king* of the same kingdom:
`(1500 + 8×200×6 + …) × 1.27 ≈ 14,500`. Capturing a king is a payday, letting him go is a
diplomatic instrument, and killing him is a permanent world change — three different verbs on
the same object.

## 6.8 Marriage, children, succession

* `DefaultAgeModel`: infant 3, child 6, teenager 14, **comes of age 18**, middle adulthood 35,
  old age 55, max 128.
* `DefaultPregnancyModel`: pregnancy lasts **36 days** (18 in "Fast" acceleration mode).
  Daily conception chance:
  `(1.2 − (age−18)×0.04) / (childCount+1)² × 0.12 × clanSizeFactor`, only for ages **18–45**.
  So a 20-year-old with no children: `(1.2−0.08)/1 × 0.12 ≈ 13.4%/day`; a 35-year-old with
  three children: `(1.2−0.68)/16 × 0.12 ≈ 0.4%/day`.
* Maternal mortality **1.5%**, stillbirth **1%**, twins **3%**, girl **51%**.
* AI clans throttle themselves: the factor
  `min(1, (2 × (4 + 4×clanTier) − aliveLords) / (4 + 4×clanTier))` stops big clans breeding
  forever.

## 6.8b Tournaments

`DefaultTournamentModel`. A tournament starts in a town with probability
`0.1 × (lordsInTown + suitableHeroesInTown) − 0.2`, gated so each town only rolls on one week
of the season (`townId.hash % 3 == weekOfSeason`), never during a siege, and ends with
probability `max(0, (daysElapsed − 10) × 0.05)`. "Suitable" means age ≥18 and One-Handed or
Two-Handed **>100**.

* **16 participants**, filled in priority order: warrior nobles in town → all other heroes
  including your own companions and unhired wanderers → random troops from the garrison
  (<https://mountandblade.fandom.com/wiki/Tournaments_(Bannerlord)>).
* **Your armour is yours; the weapon changes every round** and is drawn from the host city's
  cultural set.
* **Renown: a flat 3** (`GetRenownReward`), ×`Duelist` perk, +`SelfPromoter`. **Influence: 0.**
  Skill XP: **500** into a random one of One-Handed / Two-Handed / Polearm / Riding / Athletics.
* **Betting: max 150 denars per round (300 with the Roguery perk *Deep Pockets*)**, at odds set
  by your position on a **global, permanent arena leaderboard** — best case ~4:1 in round one
  with no reputation, ~11:10 in most finals, and *"once the player is leading the pack, they can
  ultimately only earn 160 denars per tournament."* Betting is an early-game income source
  designed to **self-destruct**.
* **Prizes** scale with how many lords with One-Handed or Two-Handed ≥100 entered — a
  pre-entry notification tells you the count, so you can *manufacture* better prizes by training
  your own companions and spouse. Prize pool includes tier-6 helms, tier-6 mounts (sellable
  ~17,000 denars), unique named weapons, and **banners with army-wide effects** (−30% shield
  damage taken; +15% melee damage; +30% troop movement speed).
* Two documented exploits worth knowing as *design bugs*: prizes are rolled **when you look at
  them** (save-scum to reroll), and **a companion winning hands the prize to you anyway** — so a
  stable of companions wins you most top prizes even if you lose in round one.

## 6.9 Companions

Wanderers hired in taverns. Cap = `clanTier + 3` (+ perks). They occupy party **roles**:
Scout (Scouting → map speed & spotting), Surgeon (Medicine → the 0.0015×skill survival roll),
Engineer (Engineering → siege construction speed), Quartermaster (Steward → +0.25 party size
per point, food consumption). `SkillHelper.GetEffectivePartyLeaderForSkill` is what routes a
role-holder's skill into the party's model — the role system is a *skill-routing table*, and
that is why a companion feels like a piece of equipment you care about.

**The name suffix is the class.** Every wanderer is "*Name* the *Suffix*", and the suffix
deterministically sets the skill spread: *the Surgeon* (Medicine 169) and *Willowbark*
(Medicine 150) are surgeons; *the Robber* (Roguery 156, Scouting 126) and *the Black*
(Roguery 150, Scouting 143) are scouts; *the Scholar* (Engineering 139, Steward 128) is your
engineer/governor; *the Silent* (Leadership 120, Tactics 90) leads a party; *the Bull* /
*Breakskull* / *the Boar* are fighters
(<https://mountandblade.fandom.com/wiki/Companions_(Bannerlord)>). Starting focus points =
`level + 4`. **Hiring cost is their debts**, typically 1,400–3,000 denars but up to ~8,000 —
and the community exploit reveals what it actually prices: *"It's mainly gear. When you recruit
a companion, strip him naked… and then kick him from the clan. You can again recruit him in the
tavern but the price gonna be 100 denars."*
Companion-led war parties **cost zero influence** to call into your army, unlike vassals — the
mechanical reason to grow companions rather than recruit lords.

## 6.10 Systems TaleWorlds added after launch

Worth naming because they show where the studio itself thought the game was thin:

* **Emissaries** (`DefaultEmissaryModel`): park a companion or family member in a town with no
  party and they become an emissary, worth **+5 relation** for your clan. A one-line answer to
  "my companions have nothing to do".
* **Incidents** (`DefaultIncidentModel`): random camp/travel events with a global cooldown of
  **8–15 days**, **50%** trigger probability, dropping to **14.3%** while besieging or waiting.
  Texture events, gated so they can't spam.
* **Alleys** (`DefaultAlleyModel`) — criminal property in towns that a companion runs, feeding
  notable Power (`+0.1/day per owned alley`) and clan income.
* **Alliances / trade agreements** (§6.5) — see above; vanilla catching up to the Diplomacy
  mod.
* **Naval/ship systems** — `DefaultShipStatModel`, `DefaultFleetManagementModel`,
  `DefaultCampaignShipDamageModel`, `IsCurrentlyAtSea` branches threaded through *every* party
  model in this document. A whole second movement layer bolted onto the same formulas.

---

# 7. AI lords

## 7.1 The behaviour set

`AiBehavior` enum: `Hold, None, GoToSettlement, AssaultSettlement, RaidSettlement,
BesiegeSettlement, EngageParty, JoinParty, GoAroundParty, GoToPoint, FleeToPoint, FleeToGate,
FleeToParty, PatrolAroundPoint, EscortParty, DefendSettlement, DoOperation,
MoveToNearestLandOrPort`.

Every lord party runs `AiPartyThinkBehavior` periodically, which collects scored candidate
behaviours from `AiMilitaryBehavior`, `AiPatrollingBehavior`, `AiVisitSettlementBehavior`,
`AiEngagePartyBehavior`, `AiArmyMemberBehavior`, and picks the top score. Scores are all
*multiplicative products of 0..1-ish factors*, which is why the AI reads as "sensible but
lazy":

```
score = TargetScoreCalculatingModel.GetTargetScoreForFaction(settlement, missionType, party, strength)
      × distanceScore
      × cohesionScore        // army.Cohesion / 40, must exceed 0.25 to act at all
      × partySizeScore       // how full the party is vs its limit
      × foodScore            // 0.1 + 0.9 × (daysOfFood / neededDays), 0 if none
      × newArmyCreatingConstant
      × 1.2 if the behaviour matches the party's Objective, else × 0.8
```

`GetFoodScoreForActionType` returns **0** if the party doesn't have enough food — so a starving
lord literally cannot decide to besiege anything, and goes shopping instead.

The AI's *stickiness* — the reason lords don't flip-flop every hour — is a set of flat
commitment multipliers applied to whatever they're already doing
(`DefaultTargetScoreCalculatingModel`): **travelling to an assignment ×1.33, besieging ×1.67,
raiding ×1.67, assaulting a town ×2.0, defending ×2.0, patrolling ×0.66.** Six constants buy
the entire appearance of AI resolve. And note `cohesionScore = army.Cohesion / 40` with a hard
`> 0.25` gate: **an army below 10 cohesion cannot decide to do anything at all.**

## 7.2 Armies

An `Army` is a leader party plus attached parties.

* Calling a party in costs influence
  (`DefaultArmyManagementCalculationModel.CalculatePartyInfluenceCost`):
  ```
  cost = 0.65 × relationFactor × strengthFactor × randomFactor(0.75–1.25)
       × distanceFactor × sizeFactor × policyFactors × perkFactors × cultureFactors
       × AverageCallToArmyCost(=20)
  relationFactor  = rel<0 ? 1 + √|rel|/10 : 1 − √rel/20
  strengthFactor  = 0.5 + min(1000, partyStrength)/100
  distanceFactor  = 1 + (dist / mapDiagonal)^0.67
  ```
  Same-clan parties are **free**. Hostile lords are up to **2×** as expensive to summon
  (`rel = −100` → `1 + 10/10 = 2`); friendly ones **0.5×**.
* `InfluenceValuePerGold = 40` — the exchange rate when the game needs to price influence.
* Party must be at ≥ **60%** of its size limit (**40%** for the player's army) and have ≥ **15
  days** of food to be callable.
* Members earn `(partyStrength + 20)/200` influence per day for serving.

**Cohesion** starts at 100 and drains
(`CalculateDailyCohesionChange`, player-led armies; AI-led armies take ×0.25 of the negatives):

```
daily = −2                                  // base
        − (number of attached parties)
        − (starvingParties + 1)/2
        − (partiesWithMorale ≤ 25 + 1)/2
        − (partiesWithFewerThan10Men + 1)/2
```

So a player army of 8 parties, all fed and happy, bleeds `−2 − 8 − 0.5 − 0.5 − 0.5 = −11.5`
cohesion/day and dissolves in under 9 days. Add one starving member and it's −12.

* Below cohesion **50**, an AI army leader considers a boost; below **30** (with no active
  battle or siege) the army **disbands**. `CohesionThresholdForDispersion = 10`.
* Boosting to 100 costs the summed influence cost of every member party (×0.25 for AI armies,
  ×0.7 under *Royal Commissions*).
* Adding a party recalculates cohesion as
  `(cohesion × n + 100 × sign) / (n + sign)` — i.e. **a fresh party dilutes cohesion toward
  100**, so bringing in a new lord actually *helps* a tired army.

Army cohesion is the single most elegant anti-doomstack mechanism in the game: it makes
"gather everyone and steamroll" a resource you spend rather than a state you occupy, and it
does it in about twenty lines.

---

# 8. Consequence chains

These are the causal chains that make the world feel like a machine rather than a list of
menus. Each is real, sourced to a named model above.

1. **Raid a village → notable relation drops → recruit slots close → your army caps out.**
   Raiding hits relation with the village's notables and its owner; the owner's clan relation
   feeds `MaximumIndexHeroCanRecruitFromHero`'s `relationBonus` table (§3.1), and falling from
   +20 to −1 relation takes you from 4 slots to 0. Raiding also costs **−30 Mercy trait XP**
   (`TraitLevelingHelper.OnVillageRaided`).

2. **Raid a village → hearth −1/day and `VillageStates.Looted` → hearth drops → the village's
   food production to its bound town falls (`(hearthLevel+1)×6`) → the town's food change goes
   negative → prosperity falls (`0.5 × foodShortage`) → the town's militia (`prosperity/1000`)
   and tax both shrink.** One raid degrades a whole town cluster for weeks.

3. **Own a fief of a foreign culture → −3 loyalty/day → loyalty <50 → tax corruption up to
   −50% → you can't pay garrison wages → garrison deserts (up to 20/day + 5 for unpaid
   garrison) → the fief is undefended → someone takes it.** Add: loyalty <25 → militia +200%
   but `InRebelliousState`; loyalty <15 → the settlement **rebels** into a new tier-3 clan.

4. **Under-pay wages → `HasUnpaidWages` fraction → −20×fraction morale every day AND −3 into
   recent events → morale drops under 30 → party power ×0.7 in every autoresolve AND −10%
   speed → you lose the next fight → −20 morale → morale hits 10 → desertion begins,
   cheapest troops first.** A cash-flow problem becomes a military collapse in about four
   days.

5. **Take a lot of prisoners → prisoner count exceeds the `10 + healthyMembers/2` cap →
   speed penalty `1/(prisoners/limit) − 1` on top of the base prisoner drag → you can't
   outrun the enemy relief army → you get caught with a slow, wounded party.** The reward for
   winning is a handicap until you cash it in.

6. **Win a big battle → many wounded → wounded > 25% of the party → up to −80% speed → and
   your surgeon's Medicine (0.0015×skill) decided how many of them are wounded instead of
   dead.** Hiring a surgeon changes the *shape of the campaign*, not just a stat.

7. **Execute a captured lord → −60 with his clan, −30 with his friends, −10 with his whole
   faction, −10 with every honourable noble, −1000 Honor.** Those relation numbers feed
   (a) recruit slots from any notable those clans influence, (b) `CalculatePartyInfluenceCost`
   to call them into your army later (×2 at −100 relation), (c) their vote merit in every
   kingdom decision (`relation × 0.8`), and (d) their willingness to defect to you. One
   satisfying click permanently narrows your options everywhere.

8. **Execute lords → the clan runs out of alive lords → the clan is destroyed → its fiefs are
   redistributed → the map consolidates faster.** Execution is *the* anti-snowball tool for
   the player and the *pro*-snowball problem for the AI.

9. **Grant a fief to a lord in the kingdom vote → he gains relation with you and you lose it
   with the other candidates → the losers vote against your proposals → your influence buys
   less → you can't call armies or win peace votes.** Fief distribution is the game's real
   political currency, and it is zero-sum.

10. **Support a decision with 150 influence → you win the vote → the kingdom declares war →
    every AI lord's `GetFoodScoreForActionType` and target scoring re-points at the new enemy
    → the map's traffic pattern changes → the villages you were recruiting from are suddenly
    "at war", which costs you 1–2 recruit slots there (`num6 = −(1 + num5)`).** Your own
    diplomacy taxes your own recruitment.

11. **Besiege a town → its food production is switched off entirely → prosperity crashes →
    when you finally take it, you've captured a poor town** whose tax and militia are a
    fraction of what they were, and whose loyalty is now yours-culture-vs-theirs at −3/day.
    The prize degrades while you win it.

12. **Build siege engines slowly (rate ∝ √men) → the siege takes days → your army's cohesion
    drains −2 −(nParties) −(starving+1)/2 … per day → below 30 the army disbands → the siege
    is abandoned.** Sieges are a race between the defender's larder and your army's patience.

13. **Bring 8 lords into an army → cohesion drains ~11/day → you must either fight within a
    week or spend the influence to boost cohesion → so you attack before you're ready.** The
    cohesion clock manufactures the campaign's tempo.

14. **Starve your army → −30 morale + −5/day recent events + you lose 25% of your regulars per
    day + no food-variety bonus at all + army cohesion −(starving+1)/2** — four independent
    systems all read `IsStarving`. Running out of grain is the most punished single mistake in
    the game.

15. **Fight with low morale → power ×0.7 in the simulation, and in the real battle each
    kill's morale shock is multiplied by `1 + 2×(fraction already lost)` → the first 20
    casualties break the next 50 → your side routes → routed men are recorded at 10% casualty
    weight but you lose the field anyway.** Collapse is modelled as an accelerating process,
    not a threshold.

16. **Clear a bandit hideout within 100 map units of a town → +6 security → security ≥75 →
    +5% tax and +1/day relation with that town's notables → more recruit slots there.**
    A dungeon crawl is a recruitment upgrade.

17. **Let a notable's issue (quest) go unsolved → his `Power` decays → below
    `NotableDisappearPowerLimit = 100` he can vanish → you lose his recruit slots and his
    `+0.05…0.15/day` influence contribution to whoever he supported.** NPCs you never talk to
    quietly stop existing.

18. **A notable becomes your clan's supporter (costs `20,000 + 10,000 × existingSupporters`) →
    +0.5 loyalty/day in his settlement AND +0.05–0.15 influence/day to you → higher loyalty →
    +1/day relation with all notables there → more recruit slots.** Money → politics →
    manpower, in three hops.

19. **A clan's leader goes broke (<30,000 gold) → its parties' wage limit collapses to
    `200 + (gold/30000)² × 400` → up to 20 men desert per party per day → the clan's parties
    shrink → they lose battles → they lose more gold.** AI poverty is a self-reinforcing
    spiral, and it is why the weak kingdoms in a late campaign visibly wither.

20. **Win against long odds → renown scales as `strengthRatio^0.45` → clan tier rises →
    +25 party size per tier and another lieutenant party → you can now take *longer* odds.**
    The reward for risk is capacity for more risk.

21. **Carry 12 kinds of food → +10 morale → morale >70 → +5%×(morale−70)/30 speed AND the
    *Forced March* perk activates above 75 → you catch parties you couldn't → more battles →
    more renown.** A shopping habit becomes a tactical advantage.

22. **Take prisoners of a culture whose villages hate you → hold them ~28 hours per level-11
    man (`(level+6)²−10` conformity at `10 + 0.05×Leadership`/hour) → recruit them at −1 or −2
    morale each → you now field an army your enemies' own villages produced.** Defeat is a
    recruitment pipeline.

23. **Refuse to join an army when called → relation with the caller drops → next time he calls
    you, `relationFactor` is worse for *him*, and your vote merit with him drops → he votes
    against your fief claims.** Saying no to one request costs you a castle later.

24. **Devastate a town after a siege → −50 Mercy → your Mercy trait feeds NPC relation
    modifiers and the *Good Natured* / *Tribute* Charm perks key off the *other* party's Mercy
    → cruel lords become easier for you to charm and merciful ones harder.** Your reputation
    sorts the world into people who will and won't deal with you.

25. **Marry into a clan → their leader's relation with you rises → their parties are cheaper
    to call into your army (`1 − √rel/20`) → and their heirs are your heirs when you die
    (`HeirSelectionCalculationModel`), so the campaign continues rather than ending.**
    Marriage is a permanence mechanism disguised as a romance.


---

# 9. Criticisms — where even Bannerlord is shallow

## 9.0 The scoreboard

Steam lifetime: **115,727 English reviews, 100,420 positive / 15,307 negative** (~87%)
(<https://store.steampowered.com/appreviews/261550?json=1>). The **single most-upvoted review of
the game (2,924 helpful votes) is negative**, and it is the community's canonical statement of
the problem:

> *"This is half of a very good game. You might be impressed in the first 10 hours, but after
> that it becomes evident you are playing the skeleton of what could be a generational game."*
> … *"Almost zero role playing elements. Every character behaves identically towards you. Even
> your own wife will try to introduce herself. Kill someone's father/brother/entire clan? They
> will never mention it and will behave towards you just like anyone else."*
> … *"Wipe out 3 enemy armies in a massive, 'war changing battle'? Oops, looks like all of those
> armies are back to full strength in a matter of days."*

The mod download counts say the same thing quantitatively. Nexus live stats
(<https://staticstats.nexusmods.com/live_download_counts/mods/3174.csv>, pulled 2026-09-08,
total / unique):

| Mod | Downloads (total / unique) |
|---|---|
| Harmony (pure dependency — the ceiling on "people who mod this game") | 6,354,352 / 1,832,485 |
| **Improved Garrisons** | 2,204,758 / **767,304** |
| **Diplomacy** | 2,086,269 / **807,508** |
| Realistic Battle Mod | 2,316,415 / 666,958 |
| Xorberax's Legacy | 1,048,125 / 420,126 |
| Bannerlord Tweaks | 1,010,911 / 415,090 |
| **Serve as Soldier** | 856,159 / **383,806** |
| RTS Camera | 849,820 / 303,097 |
| Character Reload | 740,891 / 282,148 |
| Distinguished Service | 520,837 / 237,804 |
| **Banner Kings** | 695,624 / 198,984 |
| Europe Campaign Map | 414,574 / 197,278 |
| Calradia Expanded | 578,335 / 291,715 |
| Party AI Overhaul | 289,738 / 137,401 (two versions) |

**Diplomacy is installed by ~44% of everyone who installs Harmony at all.** Nearly half of all
modders consider vanilla diplomacy the thing that must be fixed. Improved Garrisons is second.
Those are precisely the two systems the game *forces* you to touch most and gives you least
agency over.

## 9.1 Diplomacy

> *"There is no diplomacy to speak of really. The choices you can make that matter are 'make
> war' and 'make peace'. That's about it. M&B is just a giant army/battle simulator. Those are
> the only mechanics that are fully fleshed out."*
> — <https://steamcommunity.com/app/261550/discussions/0/691996377956321407/> (Dec 2025,
> *after* alliances shipped)

Same thread: *"it dosnt matter if you try to make diplomacy. Neither a Trade Agreement or an
Alliance is worth something for the AI. They will break your Alliance after a short periode
even if your Reputation is 100 with their King."*

A player reverse-engineering the war AI nails the endless-war loop
(<https://steamcommunity.com/app/261550/discussions/0/4361242944245446229/>):
*"The main considerations of the AI to wage war are: Does the faction hold territories we held
before? Do we have to pay them tributes? Are they an easy enough target? … At start you are a
juicy target, in the end if you are map-painting you hold stuff other factions held before."*
Note that this matches `GetScoreOfDeclaringWar` in §6.5 exactly — `sameCultureTownScore` is
literally "do they hold towns of our culture".

## 9.2 The late game

The most-cited structural failure: **you cannot kill a kingdom.**

> *"it is simply not possible to truly defeat an enemy kingdom, despite having taken control of
> all cities and castles owned by that kingdom… the lords from said kingdom spend all their
> time raiding villages and are just a horrible nuisance."*
> — <https://steamcommunity.com/app/261550/discussions/0/3774616756094513006/>

A **positive** 1,688-hour review with 1,434 votes says the same: *"I can take all the land from
a faction, defeat their remaining parties repeatedly, even capture and imprison all clan
members and still have to pay vast amounts to obtain peace with them, or else they raid my
villages perpetually."*

Second: **tedium scales with success** — *"Once the player reaches Clan Rank 5 or 6, the game
really stagnates… towns and castles in Bannerlord are the most unsecured prisons in the history
of the universe… My daily combat feed is filled with constant spam of nobles escaping my
prisons"* (<https://steamcommunity.com/app/261550/discussions/0/3452590985292020463/>).
Third: **recruiting a lord costs more than conquering his city** — *"you must then practically
bribe them with practically the entire GDP of a nation and it still might not be enough,
apparently 400k isn't sufficient"*, with the community's own prescription, *"Maybe they could
add RightToRule/RightToExpand back again"*
(<https://steamcommunity.com/app/261550/discussions/0/3108018684252751005/>).

## 9.3 Dialogue and RP

> *"in warband… I could ask a lord if he knows where another lord is and he may or may not
> know. But in Bannerlord after an 8 hour session I feel like I have only been told the same 5
> lines of dialogue… If I wanna know where someone is I just open the ingame version of
> Wikipedia."* — <https://steamcommunity.com/app/261550/discussions/0/3493131640456734574/>

A 1,321-vote negative review: *"talking to a lord is always pointless unless he has a task for
you."*

## 9.4 Quests

There are ~38 `IssueBehavior` classes (§3), and every one of them has an **alternative
solution: send a companion plus N troops for D days**. PC Gamer's review reads that generosity
as emptiness: *"These issues are usually basic things like needing more grain or bandits making
a nuisance of themselves… These quests don't even need you to be involved—you can just get one
of your companions to do it. It's all very hands-off."*
(<https://www.pcgamer.com/mount-and-blade-2-bannerlord-review/>)

## 9.5 Sieges: the five-year-old ladder bug

Threads: *"Why do soldiers only use ONE of THREE ladders on siege towers?"*
(<https://steamcommunity.com/app/261550/discussions/0/2264689848051170622/>),
*"SIEGE TOWERS COMPLETELY BROKEN"*
(<https://steamcommunity.com/app/261550/discussions/0/2264690481982514228/>). The failure shape:
most units mill at the base of the tower, at most ~4 climb at once, and the AI drops the tower's
ramp *as soon as it docks* rather than waiting for a full platform, so defenders kill the 2–3
men who are up and then camp the ladder. TaleWorlds' community team's stated position: *"Most
issues surrounding ladder use involve pathing and goal setting behavior and not necessarily due
to the ladders not providing a navigatable connection point."* Player workaround that exposes
the bug: *"If you run up next to the ladders and then run away, often times the AI will start to
use them."*

## 9.6 Garrisons: "I want to play a warlord, not a food delivery man"

The single best statement of the problem is a 2020 Steam post that is essentially the Improved
Garrisons design document, written two years before the mod
(<https://steamcommunity.com/app/261550/discussions/0/2265817650391593683/>):

> *"it's freaking long and hard to train troops to have a decent garrison… you now have to use
> all your time to navigate and buy all the food you can to sell it to your town… you're gonna
> get a siege at some point, killing all your garrison, and then no foods again. Do it again and
> again for each town you own. **the game need an automatic recruit/train/promote mecanic for
> your towns** … I want to play a warlord, not a food delivery man."*

Reply in the same thread — the other half of the failure: *"I never bother putting any garrison
in my town since it's such a bother and creates all sorts of problems."* Compare the source:
`DefaultSettlementGarrisonModel.GetMaximumDailyAutoRecruitmentCount(town) = 1`. A community
datapoint on what that means: *"in native Bannerlord with a daily change of +1 it would require
just over 7 years to fill up a town garrison of 600 from 0."*

## 9.7 The map as clickfest, and the "empty world"

Recurring wording across threads: *"Go to the other side of the map, do task — go to the other
side of the map, do task"*; a request that the devs *"play yakety sax when you try to chase
units around the map"*; the map is *"bland and boring."*

The sharpest version blames the **army system itself** for making the world feel emptier than
Warband's:

> *"The army mechanic… makes the world feel much less alive than it did with warband. Now you
> just have massive forces moving as one unit… I used to love stalking an enemy army in warband,
> waiting for a lord or two to be pulled off, seeking a battle I might actually win…
> **No manhunters or deserters is a CRIME.**"*

## 9.8 The press verdict

**PC Gamer** (<https://www.pcgamer.com/mount-and-blade-2-bannerlord-review/>) is the fairest
statement of both sides. The praise: *"It's Chivalry, Crusader Kings and Total War in a single
expansive package."* The indictment, item by item:

* Fiefs: *"there isn't actually much management involved in running towns and castles. You hop
  in, pick a construction project and then make sure there aren't any issues."*
* Workshops: *"The management screen simply shows how much money the business has and how much
  it makes. The only way to interact with it is by selling it or changing it to another kind of
  business… these aren't really businesses you get to run."*
* Caravans: *"You get no control over its route, and no opportunities to make any tweaks. You
  don't even get to decide what it's hauling."*
* Companions: *"While these characters have backstories and traits… they are really just tools
  rather than fleshed out RPG pals."*
* Thesis: *"so many of the systems I liked in their first draft haven't really gone anywhere…
  on their own they often end up feeling surprisingly shallow."*
* And the defence, which is worth taking seriously: *"more depth doesn't always equate to a
  better game. The basic characters, hands-off business management and simple political system
  stop you from getting bogged down with just one facet… Treat the game like a war sandbox where
  you dip into trade, management and politics and it starts to make a lot more sense."*

**Tom's Guide** (<https://www.tomsguide.com/opinion/i-hate-to-say-it-but-bannerlord-hasnt-fulfilled-its-potential-not-even-close>)
is harsher and lands one point the source code corroborates: *"Before long, I find myself
fighting battles on autopilot. The AI almost always behaves in the same way… At the start of the
game, you can choose a single battle tactic to use and simply apply it to every single battle.
The AI will never do anything about it."*

The best pro-Bannerlord review in the whole corpus (2,108 votes) is not about systems at all:
**"A lord refused to nominate me for a castle after I successfully captured it so I switched
sides, tracked down his wife, and chopped her head off. 10/10"** — which is exactly consequence
chains #7 and #9 from §8, experienced as a story.

## 9.9 What the mods add — and what that tells us

**Diplomacy** (<https://github.com/DiplomacyTeam/Bannerlord.Diplomacy>, feature docs at
<https://github.com/Katarn2000x/DiplomacyFixes/wiki/Features>):
* **Messengers** — send a message to any character from their encyclopedia page, for influence.
  (Deletes the "chase a lord across the map to say one sentence" chore.)
* **Alliances** (defensive: an ally auto-declares on an aggressor) and
  **Non-Aggression Pacts** (fixed-duration no-war agreements).
* **War Exhaustion** — a score built from war duration, casualties, settlements lost and
  villages raided that eventually *forces* peace. The direct answer to endless wars.
* **Expansionism** — a per-kingdom score that degrades your ability to make agreements as you
  grow. A coalition-pressure valve against the runaway leader.
* **Fief granting** by the ruler, with a relation reward.
* Influence *sinks*: **Corruption** (daily influence cost for holding too many fiefs) and
  **Influence Decay**.
* Its own maintainers' honest post-mortem is the best warning label in the whole research:
  *"once I bent a couple kingdoms to my will (beating them down to where they wanted to pay me
  1.5–2k/day to leave them alone), the game got ridiculously easy"* and *"The 'Usurp Throne'
  mechanic is garbage"* (<https://github.com/DiplomacyTeam/Bannerlord.Diplomacy/blob/main/ISSUES.md>).

**Improved Garrisons** (Steam Workshop: **439,565 subscribers**,
<https://steamcommunity.com/sharedfiles/filedetails/?id=2859265386>): auto-recruit from nearby
villages to a threshold; auto-recruit prisoners; **recruiter parties** that fetch troops of a
named culture or elite-only from outside the region; **training templates** ("train an Empire
army here and Khuzait horse archers there") that are synchronised across saves and that
auto-recruit whatever the template is missing; **guard parties** with their own AI that defend
villages, chase caravans, take prisoners and sell them, buy horses, and refill from the
garrison; a configurable garrison food bonus. In short: **it turns the garrison from a chore
into a policy.**

**Banner Kings** (<https://github.com/R-Vaccari/bannerlord-banner-kings/wiki>) is an attempt to
graft Crusader Kings onto Bannerlord:
* **Feudal titles with a de jure map** — Barony (village) → Viscounty (castle) → County (town) →
  Duchy → Kingdom, each with separate **de jure** and **de facto** holders. Conquest makes you
  de facto but not de jure, and **de jure drift** transfers legal ownership after **15 years**.
  Each title's contract specifies government type, succession, inheritance and gender law.
* **Courts and councils** — Marshal, Steward, Chancellor, Spymaster, Spiritual Guide, paid from
  settlement income. (Warband's minister and marshal, restored.)
* **Population** — four classes (nobles, craftsmen, serfs, slaves) as the root of taxes,
  productivity, loyalty and prosperity.
* **Estates** — villages partition into buyable/grantable estates; *landowners' estates supply
  the manpower that fills their recruit slots*, which makes §3.1's recruit table a property
  system.
* **Demesne laws** — tax rates and population policy with effects on stability/autonomy/loyalty,
  replacing "pick a construction project".
* **Religions** (~one per culture, with doctrines, clergy notables, blessings, holy wars,
  piety), **education** (languages, books), **lifestyles** (permanent perks from skill pairs),
  and **feasts**.

**RTS Camera** (<https://github.com/gediorios/RTSCamera>): F10 for a free camera whose *range is
gated by your Scouting and Tactics skills*; E to lock to a unit, E again to possess it; and
**"Control Ally After Death"** — when you go down you immediately take over a teammate, which
exists purely because vanilla hands your army to the AI the instant you fall. A sibling mod,
*Battle Order Tweaks*, exists for players who want the orders without the camera.

**Serve as Soldier** (383,806 unique): enlist in a lord's army as a common soldier, climb the
faction's own troop tree by **XP weighted by kill difficulty** (looter < banner knight < lord),
take off-duty assignments while the army travels, and **at rank 6 bring your own retinue of
heroes**; the endgame is being offered vassalage. Warband's original *Freelancer* added the bits
the successor mostly dropped: the quartermaster feeds you, and you can **rebel** (taking part of
the army with you) or **desert** (relation hit plus a bounty).

**Bannerlord Tweaks** (415,090 unique) is a de-grind config mod whose *headline features* are a
map of where the tuning hurts: tournament XP, **configurable tournament bet amount and minimum
betting odds**, troop XP multiplier, ignore crafting stamina, workshop count/cost, militia and
food production, and a fix for the vanilla bug where ending a mercenary contract cost relation.

## 9.10 TaleWorlds' own answers — the snowball war, in patch notes

Retrieved via the Steam news API (`api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=261550`).

* **e1.0.4 (3 Apr 2020)** — the first snowball fix was an *economics bug*:
  *"some lords were remaining without troops in their party because of financial problems…
  Lords now manage their finances more effectively and take troops from garrisons if they are at
  risk of going bankrupt. **This was one reason for the snowball effect in the campaign, with
  kingdoms being eliminated too easily.**"* (This is `MakeClanFinancialEvaluation`, §6.4.)
* **e1.0.5 (4 Apr 2020)** — defection loops: *"clans now no longer want to defect to kingdoms
  which captured their settlements earlier… If a party besieges a settlement, the army leader
  will lose relation with the settlement owner."*
* **e1.5.1 (Aug 2020)** — the war/peace AI rewrite: *"**They generally do not want to face more
  than 1-2 enemies at the same time**… Rich kingdoms will not care about paying tribute as much
  as poor ones. If a faction has fewer men in garrisons or lord parties or if lots of settlements
  have food problems they will try to end the war… In rare cases, some factions which have no
  settlements left will make comebacks by conquering a new settlement."*
* **Dev Update #6 (Dec 2020)** — *"AI characters are now able to get married"* and the addition
  of many new AI clan members, plus *"a more even distribution of wealth within each kingdom
  through a **shared treasury**, allowing clans to stick in the fight for much longer"*, plus an
  inflation fix. Also, after the backlash: an option to **disable birth and death entirely**.
* **e1.5.7 (Jan 2021)** — *"There were **too many war & peace declarations and average war
  duration was short**."* And a beautiful example of a tactical constant causing a strategic
  problem: the cavalry map-speed bonus was cut **from +60% to +40%** because *"the effect of this
  bonus caused the Khuzait faction to snowball"* (they field the most cavalry). Also: notable
  power was rebalanced so only 20% start Powerful (200+) and 60% Influential (100–200) — see
  §6.2.
* **v1.3.0 beta / v1.3.4 release (Sep–Nov 2025)** — **alliances and trade agreements enter the
  base game, five years after the mod**, with exactly the terms in §6.5. Alongside: a *"war
  effort system in which successful sieges, raids, and casualties determine which side holds the
  upper hand… should stop losing kingdoms from demanding and winning kingdoms from paying
  tributes"* (that's `GetWarProgressScore`, §6.5), a **White Peace** option, village taxes +30%
  and town/castle taxes **+130%** *"to support the larger AI garrisons"*, town trade commission
  ×5, and a fix for *"clans from a destroyed kingdom being removed from the game prematurely."*
* **v1.4.0 dev update (Apr 2026)** — TaleWorlds grading itself: *"these agreements don't reflect
  enough of what's happening in the world around them… shifting alliances away from a default
  everyone opts into toward something that responds to actual threats."* And: *"Both micro wars
  and prolonged inactive wars called for further action."*
* **v1.5.0 beta (Aug 2026)** — the direct answer to "lords have no personality" and "executions
  don't matter". They state the diagnosis themselves: *"[traits and relations] already influence
  AI in kingdom decisions and military actions… but **it can be difficult to discern their
  role**."* The fixes: **trait effects** (mechanical effects tied to each end of each trait
  axis), and **blood feuds** — *"If you execute a clan member of another clan, they will begin
  doing the same to your clan **until relations recover or blood money is paid**… **AI clans can
  start a blood feud and execute one of your clan members, including you, if you have
  sufficiently negative relations (currently −50)**."* Plus **hard rules** replacing soft score
  nudges for clan-party stances (*"You will now be able to directly allow or prohibit joining
  armies, raiding villages, donating troops"*), **battle sites** you can find and investigate
  after off-screen battles, **advanced starts** (as king / vassal / merchant), and **campaign
  scenarios** (*"What would happen if the Empire remained united?"*).

**Read as a whole, TaleWorlds spent six years discovering that legibility, not simulation depth,
was the missing thing** — and shipped visible trait effects, named blood feuds, hard rules
instead of score nudges, and findable evidence of off-screen events. Every one of those is a
*presentation* fix for a simulation that already existed.

---

# 10. Contrast with Warband — what people miss

Warband (2010) is mechanically cruder and *socially* richer. The things people say they miss
are, almost without exception, **systems that gave named NPCs opinions and let those opinions
cost you something.**

## 10.1 Lord personalities

Warband gave every lord one of **seven personalities**: *Martial, Quarrelsome, Pitiless,
Cunning (Calculating), Sadistic (Debauched), Good-natured, Upstanding*
(<https://mountandblade.fandom.com/wiki/Vassals>). These were not flavour text; they were
inputs to the political simulation with real coefficients:

* In each background "political calculation" cycle, **martial and cunning lords lose 2
  relation** with their liege for every cycle they hold no fief; **quarrelsome, sadistic and
  pitiless lords lose 4**; **good-natured and upstanding lords lose none.**
* Below **−50** relation with their liege, a lord starts looking to **realign** (defect).
* Martial, good-natured and upstanding lords **lose relation globally when any war is declared
  without provocation** — including in kingdoms that aren't yours — and **gain +1** when it is
  justified. Honourable players start at **−3** with quarrelsome lords. Quarrelsome, sadistic
  and pitiless lords *like raiding villages* and wander off to do it while their kingdom's army
  is mustering.
* Only **upstanding** lords don't mind a fief going to someone else — which is the entire "why
  did you refuse me a fief" grievance economy: granting a fief was a political act with named,
  predictable losers (<https://steamcommunity.com/sharedfiles/filedetails/?id=842978764>).
* Distribution: of each faction's 20 lords, the 8 patriarchs get **one of each type**, 4
  bachelors roll randomly, and 8 sons are **50% random / 50% inherited from the father**; the
  random roll is **25% Martial, 12.5% each** of the rest
  (<https://steamcommunity.com/sharedfiles/filedetails/?id=3757963925>).

Bannerlord replaced this with a continuous trait axis (Honor, Mercy, Valor, Generosity,
Calculating). TaleWorlds now concede the problem in their own words: *"it can be difficult to
discern their role"* (v1.5.0 notes, §9.10). **Warband's seven named personalities are less
sophisticated and vastly more beloved, because a player could say "he's Quarrelsome, he'll
resent that fief."**

## 10.2 Feasts

Feasts (<https://mountandblade.fandom.com/wiki/Feasts>) were Warband's one social set-piece:
a town-hall gathering hosted by a fief-holding noble, enterable freely at **200+ renown**,
with an out-of-rotation tournament attached for those without the renown to walk in. Inside
were all the kingdom's lords and ladies in one room, so a feast was: a place to farm relation
with a dozen lords at once, the only reliable way to court a lady, the marriage market, and
the thing that kept **martial lords content during peacetime**. Feasts do not exist in
Bannerlord in any form. There is no room in the game where the political class is
simultaneously present and talkable-to.

## 10.3 Right to Rule and claimants

* **Right to Rule** (<https://mountandblade.fandom.com/wiki/Right_to_rule>) was a 0–99
  legitimacy stat, separate from renown, that gated whether lords would take you seriously as
  a monarch and whether they'd defect to you. You raised it by completing lords' quests,
  buying a claim from a travelling scholar, marrying well. Bannerlord has **no legitimacy
  stat at all** — you found a kingdom at clan tier 4 and that is the whole check.
* **Claimants** (<https://mountandblade.fandom.com/wiki/Claimants>) were pretenders hiding in
  keeps who would let you swear to *them* instead of founding your own kingdom, converting
  your fiefs to a rebel faction and setting relation to 50. This is an entire alternative
  campaign arc — "restore the rightful heir" — that has no Bannerlord equivalent.
  Bannerlord's rebellions produce anonymous rebel clans instead of a person with a story.

## 10.4 The marshal

Warband's kingdoms elected a **marshal** whose declared campaign objective all lords followed,
and lords voted on who it should be. That is a single visible political office, contested by
the same lords whose relation you manage. Bannerlord replaced it with the **army** system,
which is mechanically better (see §7.2 — cohesion is superb) but politically flatter: anyone
who can pay influence can form an army; there is no office to want.

## 10.5 Renown's simpler contract

In Warband, **renown gave +1 party size per 25 renown**, capping battle renown at **50 per
fight**, with 150 needed to join a faction (200 for a female character) and 700 for a female
character to own a fief. That is a *directly legible* contract — one number, one obvious
benefit. Bannerlord's renown → clan tier → party size / party count / companion slots chain is
more interesting but far less immediate.

## 10.6 The Freelancer mod

Freelancer (<https://mountandblade.fandom.com/wiki/Freelancer>) let you **enlist in a lord's
party as a common soldier**: you get the faction's lowest-tier kit, travel with his party
automatically, fight in his battles as a line trooper, get promoted up the faction's own
troop tree with better gear at each rank, get fed by his quartermaster, can take leave, can
desert (with a relation hit to that lord, his faction, and a deserter bounty on you), or can
**rebel and take part of the army with you** (they follow you for a few days to a week).
Losing your rank if you switch factions, and regaining it if you come back, is a nice touch.

Why it matters as a design object: it is the *only* Mount & Blade mode where you experience
the campaign from inside someone else's decision loop. Everything the game already simulates —
lords choosing targets, armies mustering, sieges dragging — becomes content, because you are a
passenger rather than the driver. Its Bannerlord successors (**Serve as Soldier**,
**Distinguished Service**) are among the most-installed mods for exactly this reason. It costs
almost no new simulation; it is a *camera and permission change* over the existing one.

## 10.7 Miscellaneous Warband things people name

* **Companion incompatibility** — Warband's 16 companions had explicit like/dislike pairs and
  personal grievances; two enemies in the same party would grumble and eventually leave.
  Bannerlord's wanderers have no relationships with each other. (Bannerlord 1.3.x does ship a
  `CompanionGrievanceBehavior`, which is a partial and much quieter revival of this.)
* **Tournament betting** as a real money engine with odds.
* **The minister** — a court appointee who handled the paperwork of your kingdom.
* **"The lords who like you follow you when you rebel"** — Warband's defection maths was
  relation-driven and legible enough that players planned rebellions around specific lords.


---

# 11. The 12 mechanics that make Bannerlord feel deep, ranked by leverage per line of code

My own analysis. "Leverage per line" means: how much felt depth does this buy relative to how
much code and content it costs? I've named the psychological job each one does.

### 1. Relation-with-a-named-person gates a concrete resource (recruits)

*≈40 lines: one lookup table and a sum.* `MaximumIndexHeroCanRecruitFromHero` (§3.1) turns a
scalar opinion held by a peasant into "how many soldiers can I buy here", on a step table
(0/+1/+2/+3/+4/+5/+6/+7 at relation 0/5/10/20/40/60/80/100). **Job: attachment.** It is the
cheapest possible way to make the player care about an NPC who has no writing, no arc and one
line of dialogue, because the NPC is now literally the source of the player's army. Every
other consequence chain in §8 that involves villages routes through this table. If I were
copying one thing from this game, it would be this: *pick your scarcest resource, and put a
named person's opinion in front of the tap.*

### 2. Party morale as a single visible number that everything reads and everything writes

*≈150 lines.* One `ExplainedNumber` (§2.4) is written by food variety, starvation, unpaid
wages, recent victories and defeats, leadership skill, party overcrowding and a dozen perks —
and is read by combat power (×0.7 below 30), map speed (±5%/−10%), desertion, prisoner
recruitment eligibility and army cohesion. **Job: coherence.** It is the game's shared bus.
Any new system can plug into it in one line and immediately feel connected to everything else.
Crucially, the *player can see the whole breakdown in a tooltip*, so the bus is legible rather
than mysterious.

### 3. The food-variety table

*12 lines.* `−2` at one food type, `+10` at twelve (§2.4). **Job: converting a chore into a
puzzle.** Shopping is the most boring verb in a strategy game and this single table makes it a
decision with a visible payoff, gives every one of the game's ~15 food items a permanent
reason to exist, and rewards the behaviour (visit lots of markets) that keeps you moving
through the world. It is the highest depth-per-line item in the entire codebase.

### 4. Party speed as a sum of everything you're carrying

*≈120 lines.* Cavalry ratio, spare horses, cargo weight, herd size, wounded, prisoners,
morale, terrain, night (§2.6). **Job: making inventory decisions into tactical decisions.**
Speed is the campaign map's only real currency — everything is a chase — so anything that
touches speed touches every minute of play. The genius move is that *the rewards for winning*
(prisoners, loot weight, wounded men) are all speed penalties, so success immediately creates
a new problem.

### 5. Army cohesion

*≈40 lines.* `−2 − nParties − (starving+1)/2 − (lowMorale+1)/2 − (tiny+1)/2` per day, disband
below 30 (§7.2). **Job: tempo and anti-doomstack.** It converts "gather everyone" from a
permanent state into a resource with a burn rate, which means the AI and the player both have
to *commit* to an objective within about a week of forming an army. Almost every complaint
about 4X endgames — the deathball that wanders forever — is solved by this one formula. Note
that adding a fresh party *raises* cohesion toward 100, so it also creates a real reason to
recruit allies mid-campaign.

### 6. The player's body is in the battle their strategy layer produced

*Enormous engineering, but zero design cost once you have it.* **Job: stakes.** The reason
losing 40 men hurts is that you watched them die from eye level. This is the series' entire
moat and it cannot be faked: every campaign-map decision is underwritten by the fact that you
personally have to go and be in the consequence. It is why 200 troops in Bannerlord feels
heavier than 200,000 in a grand-strategy game.

### 7. Autoresolve is the same object as the real battle, discounted rather than forbidden

*The `MapEvent` / `MapEventSide` split.* Simulated battles give **0.9×** troop XP vs 1.0×
(§1.1). **Job: respecting the player's time without punishing them.** The player is never
forced into a fight they don't want, and never feels they cheated by skipping one. It also
means the whole world can keep fighting battles while you sleep, which is what makes the map
feel alive. Architecturally: *the fidelity layer is optional, the resolution layer is
authoritative.*

### 8. Execution: one irreversible click with a priced, global consequence

*≈60 lines of constants.* −60 clan / −30 friends / −10 faction / −10 all honourable nobles /
−1000 Honor (§6.6). **Job: identity.** This is the one place where the game asks *what kind of
ruler are you* and then makes the whole world remember the answer forever. It works because
the price is (a) large, (b) *itemised* in the confirmation dialog, and (c) permanent — the
clan is gone, the lords are gone, the relations don't decay back. Compare: almost nothing else
in Bannerlord is irreversible, which is exactly why this stands out.

### 9. Renown → clan tier → capacity, on a 2.5×-per-tier curve

*≈30 lines.* Thresholds `{0, 50, 150, 350, 900, 2350, 6150}`, giving +25 party size, +1
companion, and at tiers 3 and 5 another lieutenant party (§6.1). **Job: planning.** A single
number that (a) rises from *everything* you do, (b) has a published next threshold, and (c)
buys the capacity to do bigger versions of what you were already doing. The exponential
spacing means the early tiers arrive fast (a dopamine ramp) and the late ones become a
season-long project.

### 10. Fiefs as three antagonistic dials — prosperity, loyalty, security

*≈400 lines across four models.* **Job: making ownership a verb.** The critical piece is the
flat **−3 loyalty/day for owning a settlement of a foreign culture** (§6.3): it means
conquest is *self-limiting* without any explicit "overextension" system. Combined with the
loyalty <15 rebellion threshold and the militia +200% at <25, a badly-run empire visibly
falls apart from the inside. Cheap, emergent, and it makes the map's cultural borders mean
something.

### 11. Influence as a hard-capped political currency with published prices

*≈80 lines of constants.* Support 50 / peace 100 / policy 100 / war 200 / annex 200 / expel
200, and vote weights at 20/60/150 (§6.2). **Job: making politics a resource game rather than
a dialogue tree.** Because influence accrues slowly (a few points a day) and every political
act has a *posted price*, "should I spend 150 to push this fief vote or save it to call an
army next week" is a real decision made dozens of times per campaign. It is the same trick as
#1 — put a price tag on a social outcome — applied at the kingdom scale.

### 12. Wounded-not-dead, controlled by one companion's skill

*One line: `0.0015 × Medicine`.* **Job: reversibility, and making a companion matter.** The
surgeon is the difference between a battle costing you 40 veterans permanently and costing you
40 veterans for four days. It converts a catastrophic, run-ending loss into a recoverable
setback, which is what lets the player take risks at all — and it attaches that entire
emotional function to *one named person you chose to hire*, which is why players talk about
their surgeon by name. The same trick runs the Scout (speed), Engineer (siege time) and
Quartermaster (party size): `SkillHelper.GetEffectivePartyLeaderForSkill` is a **skill-routing
table**, and it is the highest-value 50 lines in the companion system.

## Honourable mentions that just miss the cut

* **Conformity** — prisoners become troops at `(level+6)²−10` accumulated at
  `10 + 0.05×Leadership`/hour (§3.4). A second recruitment economy for free.
* **Persuasion as a per-argument gamble** — each dialogue option has an explicit
  success/crit-fail chance derived from your skill *and your traits*
  (`DefaultPersuasionModel`, success ×0.05 for an "Extremely Hard" argument up to ×0.9 for an
  "Extremely Easy" one). Talking is a minigame with a failure state.
* **The `ExplainedNumber` type itself.** Every derived stat carries its own itemised
  explanation. This is not a UI feature; it is the reason players believe the systems are fair
  and the reason they can learn to game them. If a number in a systems game cannot show its
  own working, players will treat it as noise.
* **`GetSideMorale()` floored at 30 for a besieged garrison and a lord's-hall last stand.**
  Two lines that make defenders fight to the death, so the climax of a siege is a climax.
* **The alternative solution on every "issue" quest** — every one of the ~38 issue types can
  be resolved either by doing the quest yourself or by **sending a companion plus N troops for
  D days** (`IssueBase.AlternativeSolutionBaseNeededMenCount` /
  `AlternativeSolutionBaseDurationInDaysInternal`). One generic mechanism turns every quest
  into a resource-allocation choice for players who don't want to do the quest.
