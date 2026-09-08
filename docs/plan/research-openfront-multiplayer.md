# OpenFront.io — game loop, social layer, and deterministic-lockstep netcode

Research note. Everything below is either read out of the game's own source at `openfrontio/OpenFrontIO@0ab7dec` (HEAD, 2026-09-08), measured off OpenFront's own public match API, or cited to a URL. File paths are repo-relative. Where the community wiki disagrees with the source, the source wins and I say so.

- Repo: <https://github.com/openfrontio/OpenFrontIO> — TypeScript, AGPL-3.0, 2,629 stars, 1,344 forks, ~250 contributors, 148 open issues (GitHub API, 2026-09-08).
- Game: <https://openfront.io/> · Press kit: `resources/press/index.html` (hosted at <https://openfront.io/press>) · Discord: <https://discord.gg/openfront> · Dev Discord: <https://discord.gg/K9zernJB5z> (CONTRIBUTING.md)
- Wiki: <https://openfront.miraheze.org/> (142 pages, community-run, lags the code)
- Public match API: <https://api.openfront.io/public/games> (docs: `docs/API.md`)

**Scale, per the official press kit (2026-08-22):** "200,000–250,000 players daily", 190,000 Steam wishlists, "100+ players per match", 35+ languages. Steam Early Access 17 Sep 2026, $4.99. Built by three people plus volunteers. The press kit's own framing is the thesis of this whole document:

> "There is no base building and no unit micromanagement — the depth is diplomatic.
> What people remember from a match is almost never a battle. It's who betrayed whom,
> and when." — `resources/press/index.html`

**Measured reality (my own pull, `api.openfront.io/public/games`, 2026-09-06 12:00–14:00Z, 834 public matches, 813 with ≥2 humans):**

| Metric | Value |
|---|---|
| Median match length | **15.8 min** (p25 10.0, p75 22.4, p90 32.4, p99 47.1, max 82.7) |
| FFA median / Team median | 17.7 min / 12.9 min |
| Ranked 1v1 / 2v2 median | 6.6 min / 5.4 min |
| Median humans per match | **25** (p75 52, p90 79, max 124) |
| Lobby fill time | median **17.8 s** (p10 7.7 s, p90 74.7 s) |
| Public matches started | **~406/hour** with ≥2 humans (417/hr incl. empties) |
| Human joins | **~13,700/hour** |
| Mode split | 67% FFA, 33% Team |

---

## 1. The game loop, exactly

### 1.1 Time

`Config.msPerTick() = 100` (`src/core/configuration/Config.ts:329`) and `ServerEnv.turnIntervalMs() = 100` (`src/server/ServerEnv.ts:110`). **One tick = one turn = 100 ms. 10 ticks/second, always.** Verified against production: a real 1,248-second match archived `num_turns: 12462` = 9.99 turns/s.

### 1.2 Spawn phase

`Config.numSpawnPhaseTurns()` (Config.ts:783):

- **Public/private multiplayer, normal spawn: 300 turns = 30 seconds.**
- Random-spawn modifier: 150 turns = 15 s.
- Singleplayer: 100 turns — but `SpawnExecution` calls `mg.endSpawnPhase()` the instant the human picks, so singleplayer starts immediately on click.

During the phase you click any land tile and the client emits a `spawn` intent. Every re-click emits another one and *replaces* your position: `SpawnExecution.tick()` runs `player.tiles().forEach(t => player.relinquish(t))` before conquering the new spot. In the 39-player match I pulled, 40 players produced **115 spawn intents** — people shop around. The spawn blob is `getSpawnTiles()` = a BFS out to Euclidean radius 4 (`src/core/execution/Util.ts:145`), a disc of ~50 tiles. `minDistanceBetweenPlayers() = 30` (Manhattan) is enforced only for *random* placement, and is relaxed after 750 of 1,000 tries.

Everyone spawns simultaneously when the timer expires (`SpawnTimerExecution`). AI nations "visibly hop to different locations during the spawn phase" (`NationExecution.tick`), which is why the map looks alive while you're deciding.

**Spawn (PVP) immunity**, `Config.spawnImmunityDuration()`, default `5 * 10` = 50 ticks = **5 seconds** after the phase ends. Only *human* attackers respect it (`PlayerImpl.canAttackPlayer`, PlayerImpl.ts:1890) — bots and nations will hit you anyway. `MapPlaylist.getSpawnImmunityDuration()` raises it for high-gold specials: 25M-gold games get 150 s, 5M-gold games get `SAM_CONSTRUCTION_TICKS + 15 s` = 45 s ("enough to build a SAM"). Ranked 1v1 gets 30 s, ranked 2v2 60 s.

### 1.3 Troops (population)

Two resources: troops and gold. Troops both attack and defend — there is no separate army.

**Max troops** (`Config.maxTroops`, Config.ts:917):

```
maxTroops = 2 * (numTilesOwned^0.6 * 1000 + 50_000)
          + sum(levels of finished Cities) * 250_000
```

So one tile ≈ 100k troops; 10,000 tiles ≈ 417k; 100,000 tiles ≈ 1.10M. It is *strongly sublinear* in territory — deliberately, so a huge player's army does not scale with the map. Cities are the only linear lever: `cityTroopIncrease() = 250_000` per city level. Bots get `maxTroops / 3`. Nations scale ×0.5 / ×0.75 / ×1.0 / ×1.25 by Easy/Medium/Hard/Impossible.

> **Do not trust the wikis for numbers** — the older one still says 25,000 here. See the drift table in §8.

**Troop growth per tick** (`Config.troopIncreaseRate`, Config.ts:958):

```
toAdd = (10 + troops^0.73 / 4) * (1 - troops / maxTroops)
troops = min(troops + toAdd, maxTroops)
```

Bots ×0.5. Nations ×0.9/0.95/1.0/1.05 by difficulty. The wiki derives that growth peaks at **42% of max** and slows after (<https://openfront.miraheze.org/wiki/Troops>). This is the single most important tempo rule in the game: sitting at 95% pop is nearly free income forgone, so the economy *pushes you to attack*.

**Starting troops** (`Config.startManpower`): human 25,000; bot 10,000; nation 12,500 / 18,750 / 25,000 / 31,250 by difficulty (Hard = "Like humans").

### 1.4 Gold

`Config.goldAdditionRate()` is a flat **100 gold/tick (1,000/s) for humans, 50 for bots** — it does *not* scale with territory. Passive gold is intentionally bad; the issue tracker says so out loud: "populations are simply not good for money making" (<https://github.com/openfrontio/OpenFrontIO/issues/2567>). Real gold comes from trade.

- **Trade ships / ports.** `Config.tradeShipGold(dist)` = `75_000 / (1 + e^(-0.03*(dist-300))) + 50*dist` — a sigmoid that "heavily punishes trades under range debuff", with `tradeShipShortRangeDebuff() = 300` tiles. **Both** the source port owner and the destination port owner are paid the full amount (`TradeShipExecution` lines 201–204). Ports auto-dispatch ships every 10 ticks with probability `1/tradeShipSpawnRate(...)`, which decays as the global trade-ship count approaches 400 and has a pity timer on rejections. Ports weight destinations by level, proximity band, and **alliance** — an allied port gets an extra ticket. A warship that catches a trade ship takes the whole payout as piracy gold.
- **Trains / factories.** `Config.trainGold(rel, citiesVisited)`: **35,000** per building when the train visits an *ally's* building, 25,000 for team/other, only **10,000** for your own; minus 5,000 per city past the first 10, floor 5,000. Trains pay you for having friendly neighbours, which is why issue #2567 argues they reward out-of-match teaming.
- **Conquest.** `Config.conquerGoldAmount`: killing a bot or nation gives you **all** its gold; killing a human gives you **half**.

### 1.5 Attacking — how a tile is actually taken

An attack is one `AttackExecution` (`src/core/execution/AttackExecution.ts`). You send a fraction of your troops (the attack-ratio slider; `Config.attackAmount` defaults to `troops/5` for humans, `troops/20` for bots) and they are **deducted immediately** at `init()`. Attacks against the same target merge; opposing attacks between the same pair **cancel out numerically** before either resolves.

Per tick, the execution gets a budget of exactly `1.0` and spends it tile by tile out of a priority heap of the target's border tiles (`FlatBinaryHeap`, priority mixes terrain difficulty, how many of your tiles already touch it, a `random.nextInt(0,7)` jitter, and the tick number so old candidates surface first):

```ts
const borderSize = attack.borderSize() + random.nextInt(0, 5);
let tickBudget = 1;
while (tickBudget > 0) { ... tickBudget -= tickFraction; troopCount -= attackerTroopLoss; }
```

`Config.attackLogic()` (Config.ts:793) is the whole combat model, and it is pure:

Terrain base (`terrainAttackBase`): Plains `mag 80 / tileCost 16.5`, Highland `100 / 20`, Mountain `120 / 25`. A defender's **Defense Post** in range (`defensePostRange() = 30`) multiplies `mag ×5` and `tileCost ×3` — five times the casualties and a third the speed. Fallout multiplies both by `5 - falloutRatio*2`, i.e. **2.5×–5×**.

**Against terra nullius** (unowned land) there is no defender:

```
attackerTroopLoss = mag / 5           (bots: mag / 10)
defenderTroopLoss = 0
tickFraction      = clamp(2000 * tileCost / attackTroops, 5, 100) / (borderSize * 2)
```

So neutral land costs ~16 troops/tile on plains and gets *faster the bigger your stack* (the `2000*tileCost/attackTroops` term), floored at 5 and capped at 100. Expansion into terra nullius is cheap, fast, and risk-free. It is the entire early game.

**Against a player**:

```
troopRatio        = defender.troops / attackTroops
defenderTroopLoss = defender.troops / defender.numTiles          // avg density
attackerTroopLoss = mag * traitorLossMod * clamp(troopRatio, 0.6, 2)
                        * (0.463 * largeAtkBonus * largeDefBonus + 0.0039 * defenderTroopLoss)
speedCost         = clamp(troopRatio, 1, 7.5) * clamp(troopRatio/20, 1, 50) / 7.77
tickFraction      = speedCost * tileCost * largeAtkBonus * largeDefBonus * traitorCostMod / borderSize
```

Read that carefully, because it explains almost every strategic fact about the game:

- **Failing to out-mass the defender is punished twice.** `clamp(troopRatio, 0.6, 2)` caps the benefit of overwhelming force at 2:1 (the in-game help says exactly this: "The effect doesn't go beyond ratios of 2:1"), but `speedCost` rises linearly up to 7.5× and then a *second* ramp kicks in past 20:1 (`clamp(ratio/20, 1, 50)`), saturating at 375×. Attacking someone 20× your size doesn't just cost troops — it grinds to a halt. That is "how attacking a stronger player fails": you do not lose, you *stop*, and the troops you spent are gone.
- **Density is the real defense.** `0.0039 * (defender.troops / defender.numTiles)` — packed land is expensive, sprawling land is cheap. A big empty player is soft.
- **Wide fronts are fast.** `tickFraction` divides by `borderSize`. Attacking along a long shared border takes many tiles per tick; a one-tile chokepoint is a bottleneck.
- **Late-game anti-turtling.** `largeTerritoryBonus` is a logistic in `log(tiles)`, midpoint **300,000 tiles**, steepness 2.5, with attacker depth 0.7 and defender depth 0.3. A huge attacker's tiles cost as little as **0.3×**; a huge defender's **0.7×**. The comment is explicit: *"Big territories are cheaper and faster to attack from and into, so late games stay dynamic. The attacker's bonus is the stronger one."*
- **Humans and nations get a bot discount:** `BOT_DEFENDER_LOSS_MULT = 0.7` (30% fewer casualties attacking bots). The wiki says 0.8 — stale.
- **Elimination:** once a defender drops below **100 tiles**, `handleDeadDefender()` fires `conquerPlayer` and the remnant is absorbed by whoever borders it (up to 100 flood passes). You do not have to chase the last pixel.
- **Retreat** costs `malusForRetreat = 25`% of the attacking stack.

### 1.6 Annexation — taking land without fighting for it

The most-taught early-game trick, and it lives nowhere near `AttackExecution`. `PlayerExecution.removeClusters()` runs about every 20 ticks and flood-fills each player's territory into connected clusters. If a cluster is **fully enclosed by exactly one other player** — every tile has an owned neighbour, none touches ocean shore or the map edge, and the enclosing player's border box is `inscribed` in the cluster's box — the cluster is **handed over wholesale, instantly, for zero troops** (`surroundedBySamePlayer` → `removeCluster`). Your *largest* cluster is only taken this way if the encircler is non-friendly; any smaller detached cluster is removed whenever it is surrounded at all.

So the optimal move against a neighbour is often not to grind their border down but to **run a thin line around them and close the loop**. It also means detached pockets are liabilities, and that a coastline or a map edge is a permanent immunity to encirclement — which is a large part of why island spawns and "hide on an island and trademaxx" are such durable strategies (§5).

### 1.7 Boats (naval landing)

`TransportShipExecution`. Cost 0 gold, `boatMaxNumber() = 3` in flight, `boatAttackAmount = floor(troops / 5)`. Troops leave when the boat departs and land as an attack at the target shore. This is the only way onto an island or behind a front, and it's free — the constraint is the cap of 3 and the fact that **warships** hunt transports (`warshipTargettingRange() = 130`, `Shell` damage 250 vs transport). A warship that kills 10 transports gains a veterancy level (max 3, +20% health and +20% shell damage each).

### 1.8 The shop

`Config.unitInfo()` (Config.ts:462). `n` = how many of that type you already have built.

| Unit | Cost | Build time | Notes |
|---|---|---|---|
| City | `min(1M, 2^n × 125_000)` | 2 s | +250,000 max troops per level; upgradable |
| Port | `min(1M, 2^n × 125_000)` | 5 s | shares the counter with Factory; upgradable |
| Factory | `min(1M, 2^n × 125_000)` | 2 s | shares the counter with Port; spawns trains |
| Defense Post | `min(250k, (n+1) × 50_000)` | 5 s | ×5 defense, ×3 slowdown, range 30 |
| Missile Silo | 1,000,000 flat | 10 s | 9 s cooldown; upgradable |
| SAM Launcher | `min(3M, (n+1) × 1_500_000)` | **30 s** | range 70 → asymptote 150 by level; 9 s cooldown |
| Warship | `min(1M, (n+1) × 250_000)` | — | 1000 HP, patrols, pirates trade ships |
| Atom Bomb | 750,000 | — | blast inner 12 / outer 30 tiles |
| Hydrogen Bomb | 5,000,000 | — | blast inner **80** / outer **100** |
| MIRV | `25M + 15M × (MIRVs already launched this game)` | — | **350 warheads**, each inner 12 / outer 18 |
| Transport, Trade Ship, Train, Shell, SAM Missile | free | — | spawned by systems, not bought |

The 2^n curve on City/Port/Factory means the first is 125k and the fifth is already capped at 1M — economy buildings front-load hard. The MIRV's *global* escalator (every MIRV any player launches raises the price for everyone) is the game's anti-nuke-spam valve.

Nuke flight speeds: atom/hydrogen 10, MIRV 15, MIRV warhead 22 tiles/tick. `nukeAllianceBreakThreshold() = 100` — a nuke whose blast would take 100+ tiles from an ally breaks the alliance and marks you traitor; accepting an alliance **cancels in-flight nukes** between the two parties (`AllianceRequestExecution.cancelNukesBetweenAlliedPlayers`).

---

## 2. Alliances, betrayal, and the social layer

This is the layer OpenFront added to the genre, and it is the reason the game is about people rather than about tiles.

### 2.1 Requests

Right-click a player → handshake. `AllianceRequestExecution`: `allianceRequestDuration() = 200` ticks (**20 s** to answer, then auto-reject) and `allianceRequestCooldown() = 300` ticks (**30 s** before you may ask that person again). If they already have a pending request out to *you*, yours auto-accepts theirs. Accepting sets mutual relation +100, clears any temporary embargo between you, and cancels in-flight nukes aimed at each other. Attacking someone **auto-rejects** their pending alliance request and slaps a temporary embargo on them (`AttackExecution.init`).

### 2.2 Duration and renewal

`Config.allianceDuration()` = **300 s (5 minutes)** by default; a private host can set 1–15 minutes, and **0 disables alliances entirely** (`disableAlliances`). Alliances *expire on a timer* — `PlayerExecution.tick` checks `alliance.expiresAt() <= ticks` every tick. Renewal requires **both** sides to press it (`AllianceImpl.bothAgreedToExtend()`), and the prompt appears `allianceExtensionPromptOffset() = 300` ticks (30 s) before expiry. So every five minutes every friendship in the game comes up for an explicit, mutual, visible re-vote. That is a metronome for drama.

### 2.3 What an alliance actually buys

From the in-game help (`resources/lang/en.json`, `help_modal.*`) and the code:

- You cannot attack each other; ground attacks and transport ships won't target them (`AttackExecution.init` aborts if `isFriendly`, and an alliance formed *after* an attack launches forces a retreat).
- Your warships stop capturing their trade ships; trade is *prioritised* between allies (an extra weighting ticket in `PortExecution.tradingPorts`).
- Trains visiting an ally's buildings pay 35,000 vs 25,000 (Config.trainGold).
- **Donations**: `donate_troops` and `donate_gold`, default one-third of your stock (`defaultDonationAmount = troops/3`), `donateCooldown() = 100` ticks (10 s), friendly-only. Note the gating: public **FFA sets `donateGold: false, donateTroops: false`**; public **Team games set both true** (`MapPlaylist.rollConfig`). Donation is a team mechanic.
- **Target marks** (`info_target`: "Place a target mark on the player, marking it for all allies, used to coordinate attacks"), duration 10 s, cooldown 15 s.

### 2.4 Visibility — and the FFA fog of diplomacy

The wiki is explicit: **"In Free for All you can betray and ally freely. Other players can not see who you are allied with in this mode."** (<https://openfront.miraheze.org/wiki/Ally>). In Team mode you are permanently allied with your colour and *cannot* betray. Public FFA also sets `disableClanTags: true` (`MapPlaylist.rollConfig`) — a deliberate move to stop clanmates recognising each other, tied to issues #2994 and #2065.

So FFA is a hidden-alliance game and Team is an open one. The entire betrayal economy lives in FFA.

### 2.5 The TRAITOR mechanic

`GameImpl.breakAlliance()` (GameImpl.ts:823):

```ts
if (!other.isTraitor() && !other.isDisconnected()) breaker.markTraitor();
```

`Config`: `traitorDuration() = 300` ticks = **30 seconds**; `traitorDefenseDebuff() = 0.5`; `traitorSpeedDebuff() = 0.8`.

In `attackLogic`, when the *defender* is a traitor: `attackerTroopLoss *= 0.5` and `tickFraction *= 0.8`. Concretely: **for 30 seconds, everyone on the map takes half the casualties attacking you and moves 20% faster through your land.** Not just the person you betrayed — everyone. The in-game help spells out the full penalty:

> "Betray your ally, ending the alliance, halting trade, and weakening your defense. Trading
> between you is paused for 5 minutes (or until you become allies again) and others may stop
> trading too. And unless the other player was a traitor themselves, you'll be marked a
> traitor for 30 seconds. During this time an icon will be above your name and you will have
> a 50% defense debuff. Tribes are less likely to ally with you and players will think twice
> before doing so." — `help_modal.ally_betray`

Other consequences: a broken-shield icon over your name; a permanent, public `betrayals` counter on your info panel (`PlayerImpl._betrayalCount`); `updateRelation(-100)` with the victim and **`-40` with every neighbour who isn't on the victim's team** (`BreakAllianceExecution.tick`) — so the AI nations around you all sour at once; and bots specifically hunt traitors (`AiAttackBehavior.getNeighborTraitorToAttack`). Crucially, **an ally may break with a traitor without becoming one** — betrayal is contagious in one direction only, so a traitor's whole alliance web can unravel for free.

### 2.6 Embargoes

`addEmbargo(other, isTemporary)`. Attacking anyone auto-embargoes them *temporarily* for `temporaryEmbargoDuration() = 300 s`; players can also embargo manually (permanent until both un-embargo), and `embargo_all` toggles it against everybody with a 10 s cooldown. `canTrade()` is simply "neither side has an embargo". Since trade is the main gold source, an embargo is an economic sanction with teeth, and the quick-chat menu has dedicated lines for organising one: *"Stop trading with [P1]!"*, *"Please stop trading with all!"*.

### 2.7 Talking without a chat box

There is **no free-text chat**. The entire diplomatic vocabulary is:

- **60 emoji** in a 12×5 table (`src/core/Util.ts:420`) — including 🤝 🆘 🕊️ 🏳️ ⏳ 💀 ☢️ 🎯 ❤️ 💔 🖕. Duration 5 s, cooldown 5 s.
- **Quick Chat**: 6 categories, 58 canned phrases with a `[P1]` player slot, 3 s cooldown (`resources/QuickChat.json` + `resources/lang/en.json`). The vocabulary *is* the design document for the intended social game: `alliance?`, `Please don't attack me!`, `I trusted you...`, `You can trust me. Promise!`, `[P1] betrayed their ally!`, `[P1] is snowballing too fast!`, `The #1 player will win soon unless we team up!`, `Let's make peace. This is a stalemate, we will both lose.`, `Stop trading with [P1]!`, `[P1] has enough gold to launch a MIRV!`, `You're ruining both of our games.`
- **Target marks** shared with allies.

A player quote from the press kit makes the point better than analysis can:

> "I've navigated geopolitics and diplomacy with other players without using a single word —
> relying purely on emojis." — Weyland Yutani Corporation

**Why the social layer is the fun.** Mechanically, an alliance is a *strictly dominant* short-term move (safe flank, better trade, better trains, donations) that carries a *guaranteed* future cost: only one player wins, the alliance expires in 5 minutes, and whoever defects first gets a free 30-second window against a target who is by then adjacent, trusted, and undefended on that side. The game does not moralise about this; it prices it (50% defense, 30 s, a public counter, −40 relations with the neighbourhood) and then lets you decide. That is a prisoner's dilemma with a visible timer, played against strangers, 25 at a time. The mechanics are a delivery vehicle for the conversation.

---

## 3. Match structure

### 3.1 Modes

`GameMode` is only `FFA` or `Team` (`src/core/game/Game.ts:137`). Team configurations (`TeamCountConfig`) are: a number **2–7** (that many colour teams), or `Duos` / `Trios` / `Quads` (fixed small squads, many teams), or `HumansVsNations` (all humans vs all AI nations). Public rotation weights (`MapPlaylist.TEAM_WEIGHTS`): 2/3/4/5/6/7 teams at weight 10 each, Duos 5, Trios 7.5, Quads 7.5, **HumansVsNations 20** (the single most likely team mode). Measured over my 2-hour sample the realised split was 2-team 71, HvN 41, 3-team 33, 7-team 24, 5-team 23, 4-team 23, 6-team 17, Trios 15, Duos 10, Quads 10.

Ranked: `RankedType.OneVOne` and `TwoVTwo`, with their own matchmaker (`src/client/Matchmaking.ts`, `MapPlaylist.get1v1Config/get2v2Config`). 1v1 is `maxPlayers: 2`, a 15-minute timer (10 on compact maps), nations disabled, still **400 bots** on the map. 2v2 is `maxPlayers: 4`, donations on. A ranked 2v2 where not all four players actually spawned is **voided** with no winner (`WinCheckExecution.checkRanked2v2Cancelled`). In my sample, 112 of 813 matches were ranked 1v1 and 20 were 2v2 — ~16% of public play.

### 3.2 Player counts and maps

**119 maps** (`src/core/game/Maps.gen.ts`), generated by a Go tool from `map-generator/assets/maps/*/info.json`. Real geography (Europe, Asia, Africa, World, Britannia, Bering Sea…) plus jokes and oddities (Mars, Luna, MilkyWay, Las Vegas Strip, Labyrinth, Dyslexdria).

Lobby capacity is derived from the map, not fixed (`MapPlaylist.calculateMapPlayerCounts`): **50 players per 1,000,000 land tiles**, rounded to the nearest 5, then three tiers (100% / 75% / 50%) rolled at 30/30/40%. Team mode multiplies by 1.5. Compact maps cut to 25%. Hard ceiling `MAX_PLAYER_COUNT = 125` "for performance". Measured max in my sample: 124 humans in one match.

### 3.3 Bots and nations — how lobbies feel full instantly

Two kinds of AI, and they are not the same thing:

- **Bots ("Tribes")**, `PlayerType.Bot`. `bots: 400` in every normal public game (100 on compact maps) — `MapPlaylist.rollConfig`, and `GameManager.createGame` defaults to 400 too. They spawn at random legal tiles with ≥30 Manhattan separation, get 10,000 troops, ⅓ max troops, ½ growth, attack with `troops/20` every `random.nextInt(40,80)` ticks, accept **every** alliance request, never build, never boat, and delete any structure they capture (`TribeExecution`). The wiki: *"Bots are used as filler in the game, stopping players from progressing too quickly by taking a lot of unclaimed land really fast."* Since v33 they are branded **"Tribes"** with map-themed names — and the names are a monetised slot: `TribeSpawner.spawnTribes(numTribes, purchasedNames)` assigns player-purchased tribe names to randomly shuffled bot slots, carefully guarded so that "games without purchased names consume the PRNG exactly as before — old replays must not shift." That is monetisation reaching *inside the deterministic simulation*, and the code comment shows exactly how much care that costs.
- **Nations**, `PlayerType.Nation`. Named after real countries, spawned at real coordinates from the map manifest (World: 72 nations, Europe: 52, Bering Sea: 24). They ally, build cities/ports/silos/SAMs, launch nukes and MIRVs, send warships and transports, send emojis, and hold grudges (`Relation`, `NationExecution` + `nation/*Behavior.ts`, ~4,000 lines). Disabled in most team modes; hardened to `Difficulty.Hard` in HumansVsNations.

So a 40-human public FFA on Bering Sea is really **40 humans + 24 nations + 400 bots ≈ 464 simulated players**. This matters enormously for both feel (the map is never empty, the board is legible chaos from tick one) and for netcode (see §4.7 — the AI costs zero bytes).

### 3.4 Public lobbies and the countdown

`MasterLobbyService` keeps **three scheduled lobby types running in parallel — `ffa`, `team`, `special`** — each with a queue of `QUEUED_LOBBIES_PER_TYPE = 6` lobbies. The front lobby of each queue is given `startsAt = now + ServerEnv.gameCreationRate()`, which is **2 minutes in production** (5 seconds in dev). When it starts, the next one in the queue inherits the countdown. Every 4th scheduled lobby is `trusted`-only (`TRUSTED_PUBLIC_EVERY = 4`) so verified-account players always have something and the whole board is never locked.

The "special" queue rolls 1–3 modifiers from a weighted ticket pool (`SPECIAL_MODIFIER_POOL`, weights "roughly informed by the community 'favorite modifier' poll"): random spawn ×4, compact ×4, gold multiplier ×6, 5M starting gold ×4, water nukes ×4, Doomsday Clock ×4, 25M gold ×3, crowded ×2, 1M gold ×2, hard nations / alliances off / nukes off / SAMs off / peace time ×1 each. Mutually exclusive pairs are enforced.

A lobby also starts early the moment it hits `maxPlayers`. Measured median fill: **17.8 s**. You click Play, you are in a game with dozens of people inside 20 seconds, and you never waited for a human to press ready.

Private lobbies: `POST /api/create_game` returns an 8-character game ID (`GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/`); the host gets the full config panel plus optional "host cheats" (infinite gold/troops, gold multiplier, starting gold) — and those cheats are *refused* if the host lists the lobby publicly (`IntentAuthorization.authorizeIntent`). A host can also list a private lobby in the public browser, capped cluster-wide by `MAX_HOSTED_LOBBIES`; a listed lobby loses the ability to kick or pause, because "a listed lobby recruits strangers from the public browser; letting the host kick them is a griefing vector."

Singleplayer runs the identical simulation against a `LocalServer` in the browser (`src/client/LocalServer.ts`) that manufactures turns on the same 100 ms clock — and, unique to singleplayer/private, exposes pause and speed controls.

### 3.5 Win condition

`WinCheckExecution`, evaluated every 10 ticks. You win by holding `PERCENT_TILES_OWNED_TO_WIN = 80`% of **non-fallout** land (nuked tiles leave the denominator, which is why nuking the map is a real, if crude, path to the bar). Teams use the same threshold on the sum of member tiles.

Three anti-stalemate valves, in order of subtlety:

1. **Overtime** — enabled by default for every public FFA since v0.33.13 (2026-09-03). After `startMinutes = 30`, the required share falls **2 percentage points per minute with no floor**, so at minute 60 the bar is 20% and the game *must* end.
2. **Doomsday Clock** — an opt-in battle-royale mode (v33's headline feature). A rising bar (0% for the first 10 minutes — "a COMBAT-ONLY window"), then waves to 2/4/7/11/17/25/35% (teams: 3/6/10/15/21/28/35%). Anyone under the bar gets a 30 s warning, then troops drain toward a **5% floor rather than zero**, then territory "rots" and is gone `rotDeathSeconds = 150` s after the skull appeared. The tuning comment is a nice artefact of a real competitive scene: *"Ceiling and steps come from 85 tournament games: the runner-up's share at game end has never exceeded 21.6%."*
3. **Hard limits** — `maxTimerValue` (host/ranked timer) forces a winner; otherwise `HARD_TIME_LIMIT_SECONDS = 170 * 60` (2h50m) inside the sim, and `maxGameDuration = 3 hours` on the server.

These exist because of community pressure — see <https://github.com/openfrontio/OpenFrontIO/issues/2341> "Prevent endless stalemates in long-running games".

### 3.6 Ranked, leaderboards, community

Account leaderboards and per-player stats are served by a closed-source Cloudflare Worker API (`docs/Architecture.md`: "api — A closed source Cloudflare Worker that handles auth, stats, game data storage, cosmetics, and monetization"), with a documented public read API (`docs/API.md`: `/public/games`, `/public/game/:id`, `/public/player/:id`). There is a competitive circuit, **OpenFront Masters** — the 2025 World Cup ran a **$1,500 prize pool over 30 qualified duo teams** (50/30/15/0 points per match, first to 100 then a decider game; one team disqualified for fair-play violations), and the Steam page advertises "monthly cash-prized tournaments" — run by the company's COO, with its own admin-bot tournament tooling in-repo (`src/server/AdminBotRoutes.ts`, `liveStatsEnabled`, name anonymisation with caster reveals). Clans exist (`ClanApiSchemas.ts`) and are grouped onto the same team in team modes, and hidden in FFA.

---

## 4. Netcode — deterministic lockstep over relayed intents

This is the part worth stealing.

### 4.1 The claim, from the horse's mouth

> "**core** — Deterministic simulation. It is pure TypeScript/JavaScript code with no
> external dependencies. It must be fully deterministic. … **The game simulation logic does
> not run on the server.** Instead, each client runs their own instance of core, which is why
> it must be deterministic. … Core and client run in different threads — the core runs in a
> worker thread." — `docs/Architecture.md`

I verified the strong version of this: `grep -rn "GameRunner|executeNextTick" src/server/` returns **nothing**. The server has no simulation, no game state, no idea who is winning.

### 4.2 The loop

1. Player acts → client builds an **Intent** and sends it over the WebSocket (`src/client/Transport.ts`).
2. Server appends it to `this.intents` (`GameServer.addIntent`) — no validation of game legality, only schema + rate limit + role.
3. Every 100 ms, `GameServer.endTurn()` (GameServer.ts:1283) closes the bucket:

```ts
const pastTurn: Turn = { turnNumber: this.turns.length, intents: this.intents };
this.turns.push(pastTurn); this.intents = [];
...
this.clients.active().forEach(c => c.ws.send(msg));
```

4. Every client hands the turn to its Web Worker (`Worker.worker.ts`, `case "turn"`), which calls `GameRunner.executeNextTick()`.
5. `Executor.createExecs(turn)` turns each intent into an **Execution**; executions are the only thing allowed to mutate state (`GameImpl.executeNextTick`).
6. The tick's `GameUpdates` go back to the main thread and get rendered.

`GameRunner.executeNextTick` is strictly one turn = one tick: it will not run a tick it has no turn for. **The turn stream is the clock.** If the network stalls, the world stops for everyone; if a client stalls, it catches up by replaying, four ticks per drain (`MAX_TICKS_BEFORE_YIELD = 4`, deliberately "a yield threshold, not a backlog cap").

### 4.3 The 25 intents

`IntentSchema` (`src/core/Schemas.ts:740`) is a discriminated union of exactly 25 members: `attack, cancel_attack, spawn, mark_disconnected, boat, cancel_boat, allianceRequest, allianceReject, breakAlliance, targetPlayer, emoji, donate_gold, donate_troops, build_unit, upgrade_structure, embargo, embargo_all, move_warship, quick_chat, allianceExtension, delete_unit, kick_player, toggle_pause, update_game_config, toggle_game_start_timer`.

That is the complete API surface of the game. The server stamps `clientID` onto each (`StampedIntentSchema = zb.stamped(...)`) — a client cannot forge whose intent it is.

### 4.4 The wire format

Every WebSocket frame is `zbin`, a bespoke positional binary encoding of the Zod schemas (`zbin/README.md`, `src/core/ZbinWire.ts`). Ints are LEB128 varints, literals cost **zero** bytes, booleans are packed into a header bitfield, and player IDs are dictionary-compressed to one byte via `zb.mapped("clientId")` seeded from the roster both sides received in the start message. There is deliberately **no version byte** — "OpenFront ships the client and server together, so this is a deliberate trade."

The repo pins the budget in tests (`tests/zbin/protocol.test.ts`, "byte budgets"):

- **an empty turn fits in 7 bytes**
- **a stamped attack intent costs ≤13 bytes inside a turn**
- a realistic turn "beats JSON by at least 5x"

Release v0.33.11 (2026-08-24): *"Use custom binary format to reduce websocket data transfer by 85%"*.

### 4.5 What that costs, measured on real matches

I pulled three archived production games and combined the recorded turn/intent counts with those byte budgets:

| Match | Humans | Length | Turns | Intents | Whole-match wire | Per client | Server egress |
|---|---|---|---|---|---|---|---|
| `zpn8YupS` (FFA, Bering Sea) | 39/40 | 20.8 min | 12,462 | 3,841 | ~134 KB | **110 B/s** | 4.3 KB/s |
| `CJEBqoNc` (FFA) | 122/125 | 24.7 min | 14,799 | 13,366 | ~271 KB | **187 B/s** | 22.8 KB/s |
| `merj8vCy` (FFA) | 122/125 | 36.2 min | 21,653 | 13,646 | ~321 KB | **152 B/s** | 18.5 KB/s |

**A full 125-player, 36-minute battle is ~320 kilobytes of traffic per client and about 150 kbit/s of egress for the entire match.** The traffic is astonishingly sparse: even in a 125-player war the average is **0.63–0.90 intents per turn**, and only **36–43% of turns carry any intent at all** (23.5% in the 39-player game). Every other turn is a 7-byte heartbeat. Busiest single turn observed: 172 intents ≈ 2.2 KB. 100 humans generate roughly one action per 100 ms between them, because a match is a few dozen big decisions each, not a stream of inputs.

That is the answer to "how does it scale to 100 players for basically zero server cost": the server's per-game work is `O(intents)` to append and `O(clients)` to fan out a *single pre-encoded buffer*, ten times a second, and it never touches game logic. `GameManager.tick` runs once a second; a game worker is picked by `simpleHash(gameID) % numWorkers` so games shard across processes with no shared state.

### 4.6 Determinism, hashes, and desync detection

Three defences:

1. **Seeded PRNG.** `PseudoRandom` is sfc32 with splitmix32 seeding and a 12-step warmup — *"All operations are 32-bit integer ops, so sequences are identical across platforms."* The game seed is `simpleHash(gameStart.gameID)` (`GameRunner.createGameRunner`). Sub-systems derive their own streams deterministically: `simpleHash(playerInfo.id) + simpleHash(gameID)` for spawns, `simpleHash(gameID) + 2` for tribes ("to avoid tribe IDs colliding with nation/human IDs from the same PRNG sequence"), `new PseudoRandom(mg.ticks())` for per-tick rolls. `AttackExecution` even hard-codes `new PseudoRandom(123)`.
2. **Deterministic transcendentals.** `src/core/DetMath.ts` reimplements `exp`, `log`, `pow`, `pow2`, `atan2` using only `+ - * /` and bit views, because *"The JS spec only requires Math.exp/log/pow/atan2 to be 'implementation approximated', and engines differ in the last bit. … a one-bit difference that lands on a truncation boundary (troops, gold, the nuke edge) is a desync."* Config.ts imports these, not `Math`. Comments elsewhere insist on integer-only tunables for the same reason ("Integer-only to keep src/core deterministic (no float constants)"), and the win check is cross-multiplied so the threshold comparison is exact integer math.
3. **Hash votes.** Every 10 ticks `GameImpl` emits a `Hash` update: `hash = 1 + Σ players`, where `PlayerImpl.hash() = simpleHash(id) * (troops + numTilesOwned) + Σ units (tile + simpleHash(type) * id)`. The client ships it up as a `hash` message (`Transport.onSendHashEvent`). Server-side, `DesyncDetector` (`src/server/DesyncDetector.ts`) compares them **every 10 turns, for the turn 10 back** ("clients have had that long to report it"). Majority hash wins; disagreers are told **once** and then permanently ignored for the rest of the game — their winner vote and live-stats vote no longer count. If a strict majority disagrees with the plurality, *everyone* is marked desynced. The agreed hash is written back into the stored turn, and desynced clients' turns are noted so replays don't inherit a poisoned hash.

Note the shape of this: the server **arbitrates by vote, it does not adjudicate**. It cannot tell who is right, only who is outvoted.

### 4.7 Where the AI runs

Bots and nations are **executions inside the deterministic core**, added at `GameRunner.init()` before tick 0 from the config (`bots: 400`, the map's nation list). They issue no intents and cross no wire. Every client independently computes the same 400 bot attacks and the same 72 nation nukes from the same seed. In the 125-player archive, the only intent types present are player actions plus `mark_disconnected` — **zero bot traffic**.

This is the trick that makes a lobby feel like a war: **the AI population is free**. Adding 400 more bots costs the server exactly nothing and the network exactly nothing; it costs each client some CPU.

### 4.8 Map representation

`GameMapImpl` (`src/core/game/GameMap.ts`) holds two flat typed arrays over `TileRef = number` (a raw index; `x = ref % width`, `y = ref / width`, with a row-start table to avoid a multiply — the comment explains that per-tile x/y lookup tables would cost "~32 MB on the largest maps" and miss cache):

- `terrain: Uint8Array` — immutable land/water/shoreline/magnitude byte.
- `state: Uint16Array` — mutable: **bits 0–11 ownerID** (so ≤4,096 players+bots+nations), bit 13 fallout, bit 14 defense bonus.

`tileStateBuffer()` hands the live `Uint16Array` straight to the WebGL renderer as an R16UI texture — zero copy. Per tick the sim drains changes as a packed `Uint32Array` of `(tileRef, state|terrain<<16)` pairs and **transfers** the buffer to the main thread (`sendGameUpdateBatch` passes `transfers`), so worker→UI is zero-copy as well. Player stats and attack updates go over as `Float64Array` quads. Maps also ship in three resolutions (`map`, `map4x`, `map16x`) and a `Compact` half-size variant.

### 4.9 Joining late, reconnecting, replays, spectating — all the same mechanism

Because the entire game is a list of intents, **there is only one code path**:

- **Reconnect.** Client sends `{type:"rejoin", lastTurn}`; the server replies with `turns: this.turns.slice(lastTurn)` (`GameServer.sendStartGameMsg`). The client feeds them to the worker, which fast-forwards 4 ticks at a time. `lastTurn: 0` replays the whole game from scratch — which is exactly why rejoins are rate-limited to **5 per minute**.
- **Spectate.** `{type:"spectate"}` puts a client on the same turn stream with intents, winner votes, hash votes and reports blocked (`SPECTATOR_BLOCKED_MESSAGES` in `SocketIngress.ts`). Since v0.33.7: "Join any game to watch without playing."
- **Replay.** The archived record is `{...analytics, turns: Turn[]}` (`GameRecordSchema`). `createPartialGameRecord` **drops empty turns** and stores `num_turns`; `decompressGameRecord` reinflates them. `LocalServer` then feeds the recorded turns out on the same 100 ms clock with a speed multiplier (0.5×/1×/2×/max, with a 60-turn backlog allowed at max). A replay is bit-identical *provided you run the same commit* — the README says so: *"To replay a production game, make sure you're on the same commit that the game you want to replay was executed on, you can find the `gitCommit` value via `https://api.openfront.io/game/[gameId]`."*
- **Archive.** `Archive.archive()` POSTs the record to the closed API; my 125-player, 36-minute match is **1.42 MB of JSON** including every intent of every player. That is the whole match, forever, for the price of a photograph.

### 4.10 Anti-cheat posture (and its limits)

The server validates almost nothing about game legality — it cannot, having no state. What it does have:

- **Schema + shape.** zbin decode then `ClientMessageSchema.safeParse`; a frame that fails decode gets you kicked (`KICK_REASON_INVALID_MESSAGE`).
- **Rate limits** (`ClientMsgRateLimiter.ts`): 10 intents/s, 150 intents/min, 2,000 bytes max per intent (bigger = kick, "we assume the client is malicious"), 5 MB total per client, 5 rejoins/min.
- **Role gates** (`IntentAuthorization.ts`): only the lobby creator/admin may kick, pause, or change config; `mark_disconnected` is server-internal only; the admin bot cannot touch public games.
- **Everything else is enforced deterministically inside the executions**, so an illegal intent is a *no-op on every client identically*. The comments in `SpawnExecution` are the clearest statement of the doctrine: a malformed spawn ref is rejected "before relinquishing any territory, so a malformed intent is a clean no-op on every client", and the spawn-phase check is done at `init()` time rather than tick time so that "a rejected intent is a deterministic no-op rather than a desync."
- **Voting for facts the server can't see.** `WinnerVote` and `LiveStatsVote` (`src/server/Consensus.ts`) settle "who won" and "what does the board look like" by **IP-weighted majority** among non-spectating, non-desynced clients: *"The simulation runs on the clients, so the outcomes the server has to report — who won, and what the board looks like right now — exist only as claims from clients."*
- Plus `MultiTabDetector.ts`, a player `report` message feeding moderation, username censoring, and a `trusted` account gate on every 4th public lobby.

The honest summary: lockstep gives you *consistency* for free and *authority* not at all. A modified client can still read the whole map state (every client has it) and automate its own play; it just cannot produce a state the others disagree with without being outvoted and flagged.

---

## 5. Why it works with strangers — and what people complain about

Community sourcing note: reddit.com is blocked to this environment's fetchers; the r/Openfront quotes below were pulled via the subreddit's Atom feeds and are thread-level, so some threads are cited by title only. The richest discussion sources turned out to be a Quarter to Three forum thread and the Hacker News front-page thread, both of which have people arguing at length rather than posting clips.

### 5.1 The case for

**Zero commitment at the door.** Browser tab, no download, no account, no install, no ready check. The press kit leads with it: *"It runs in a browser tab. No download, no account, no waiting."* Median lobby fill in production is **17.8 seconds**, and the countdown runs whether or not anyone joins — because 400 bots and up to 72 nations are already there, a lobby is never "waiting for players". You are never the person keeping nine strangers waiting.

**The whole match is legible at a glance.** One screen, one map, coloured blobs, a leaderboard of percentages. No fog of war, no camera you can be caught looking away from, no build order. The state of the entire war is a picture. That is what lets 100 strangers coordinate with 60 emoji and 58 canned phrases: everyone can see what everyone means. The devs' own Steam copy is the pitch: *"Borders shift every second. Alliances form and collapse in minutes. A player who looked irrelevant ten minutes ago might have spent that time quietly building the largest army on the map. Watch everyone. Trust no one."* (<https://store.steampowered.com/app/3560670/OpenFront/>)

**It becomes a social game, and players notice the exact moment it happens.** ivape on Hacker News: *"once you make it past the early game, it quickly shifts into a sophisticated social game where you have to LARP geopolitical diplomacy since most countries/armies are too big (entire sovereign nations) by the end game."* (<https://news.ycombinator.com/item?id=44528943>)

**Commitment is expressed by an irreversible act, not a message.** The attack slider deducts troops *immediately*. Boats leave with the men aboard. Nukes cannot be recalled. An alliance request is a public offer with a 20-second fuse. Because every social move has an immediately-visible mechanical cost, strangers read each other's intent without language.

**The spawn phase is a social moment, not a loading screen.** For 30 seconds the map is a shared board everyone is drawing on at once, watching neighbours materialise 30 tiles away, re-picking, while AI nations flicker around the map. You make your first irreversible decision about *whom you will have to deal with* before the game starts. (This is also OpenFront's worst onboarding failure — see §5.2.)

**Betrayal drama is authored into the numbers,** and it is what people actually talk about. The top-of-all-time threads on r/Openfront are almost entirely relationship stories rather than plays: *"My ally nuked himself when I was getting invaded just so I could continue to live"* (<https://www.reddit.com/r/Openfront/comments/1u07n14/>), *"Openfront.io mfers after betraying their smaller ally mid-game (they will get obliterated with nukes and both will lose)"* (<https://www.reddit.com/r/Openfront/comments/1qswi2d/>), *"any idea why this guy broke alliance and full send me"* (<https://www.reddit.com/r/Openfront/comments/1w9e39z/>). On Quarter to Three, Therlun narrates the whole arc of a betrayal he committed — *"I do save up for a hydrogen bomb and a couple of tactical atom bombs. Soon after in an overwhelming first strike and quick total invasion I take my former ally out. He should have valued our great teamwork before more…"* — and Pod narrates being on the receiving end and being unable to do anything about it: *"I could see him amassing money and knew he was going to stab me, but there was nothing I could do at that point… Eventually he had enough for 2 MIRVs, so I sent him a emoji just reminding him of that and letting him know I know it's up."* (<https://forum.quartertothree.com/t/openfront-io-liquid-war-meets-diplomacy/163985>) The press kit's own solicited quotes say the same thing from the opposite emotional angle:

> "Two of us on an island, strangers, about the same strength. We allied to survive. At the end we were bombarded by missiles. I still remember him — we trusted each other and never doubted each other." — bitfl1p

> "I've navigated geopolitics and diplomacy with other players without using a single word — relying purely on emojis." — Weyland Yutani Corporation

**Grudges are, by community consensus, most of the game.** u/Hazzman: *"Petty grudges are like 70% of this game."* u/Imaginary_Resist_410: *"I underestimate even my own pettiness. And yes, it was absolutely, wholly, necessary to spend all of my money on nuking the small nation next to me whom I have gruged against since the first minute of the round because that player stole the AI nation-kill bonus that was rightfully mine."* u/Doktorwh10 tells the whole arc: *"I hid away and survived on a random island far away. Maxed out trade ports and stayed hidden… until I stocked up 13 mil and nuked the hell out of blues economy. Nuke camped their ports too… I had no shot of recovering, but I avenged my team and completely turned the tide for blue and made them lose. 10/10 would do again."* (<https://www.reddit.com/r/Openfront/comments/1nnqz1m/>) They persist across matches, too — Pod: *"I did play with the name 'I will get revenge' a few times, and even full-sent a player in the first few minutes simply to get revenge for a previous game."* Therlun: *"dealing with grudges and unreasonable reactions is very much part of the game and can be fun as well."*

**Losing is cheap and fast, and the community has made a whole identity out of surviving badly.** Median match 15.8 min, p25 10 — and losing is the normal outcome: self-reported FFA win rates on r/Openfront run **2.1%, 13.5%, 20%** (<https://www.reddit.com/r/Openfront/comments/1wajbzd/>), which for a 25-to-125-player free-for-all is roughly par. sparsely on HN: *"There's a lot of luck involved too, sometimes you'll just get dogpiled by two neighbours and there's not much you can do, but at least it's fast."* Because `handleDeadDefender` only absorbs you below 100 tiles, a tiny remnant can persist indefinitely — the community calls this a **"mito"** (mitochondrion) and treats it as a legitimate win condition of its own: *"grudge goblin is the honorable way to go IMO. Make 'em WORK to get you out of the game"*; *"or better yet, they forget about you and your new host has generously let you accumulate a 30 missile stack and 50 million gold without eating you… Oh how satisfying it is when you watch your 10 hydros drop, followed by a question mark emoji, followed by a middle finger emoji, finally followed by a rat emoji."* (<https://www.reddit.com/r/Openfront/comments/1waaktv/>)

**Comeback and king-slaying are the emotional peak, not winning.** Therlun: *"Right behind winning the second best feeling is being 3rd, and wiping out the first place player because he thought he could just eat you up."* And on the endgame the anti-stalemate systems were built around: *"The mirv super weapon is devastating… But it provided a couple of very interesting MAD standoffs, where three or four players have mirvs and whoever destroys one of the other players just gets destroyed in return."* / *"the most fun games were the ones where everyone gets mirved and you fight in a nuclear wasteland."* Mechanically this is `largeTerritoryBonus` (big territories are cheaper to attack into), half the victim's gold on a kill, free boats to anywhere on the coast, and a quick-chat menu that ships the coalition script pre-written: *"The #1 player will win soon unless we team up!"*

**Minimal UI, no micro.** No base building, no unit selection except warships, no economy tabs. The whole verb list is 25 intents (§4.3) and most of a match is one of them. On HN: *"Love this game, fast paced multiplayer that's super strategic"*; *"Super addictive"*; *"Very addictive. Beware."*; *"Another rabbit hole."*

### 5.2 The criticisms

**Snowballing, dogpiling, and the fact that you never want a fair fight.** This is the deepest structural complaint and it is inherent to the genre. Therlun: *"It doesn't 'remove' the main issue of the genre, in that you never, ever want to fight people that are as strong as you. You only ever want to demolish much weaker players, or occasionally team up to beat the leading player."* The combat math in §1.5 is exactly why: the benefit of overwhelming force caps at 2:1 while the *time* penalty for being outnumbered is unbounded, so attacking a peer is always worse value than attacking a weakling. Player counts make it worse at the bottom — crubier on HN: *"a crucial piece of advice for the developer would be to reduce number of players. When games have 80 players, statistics means a given player has 70% chances of getting obliterated in the first few minutes. So you end up doing a lot of frustrating loses"*; notsylver: *"with 150 players you almost always get horded by neighbours."* The v23 combat overhaul was aimed at this (*"Supposedly larger players are now easier to attack, smaller attacks are generally less penalized, which hopefully helps with the problem of too many runaway victories"*) and Therlun's first reaction was that it overcorrected: *"Anyone getting attacking triggers an instant dogpile and you just die."* The clearest evidence that this is unsolved is the top OpenFront YouTuber's own tutorial, where the mid-game advice is literally to not play: *"DO NOT ESCALATE CONFLICT … You better hope people don't hate you … Try to let other people MIRV each other to death … Generally don't push for the 80% land win unless there are no other active players that can afford MIRVs."* (<https://www.youtube.com/watch?v=EdcdsayA_ac>) A dominant "trademaxx and wait" strategy is openly shared on HN: *"prioritize moneymaking and win by cleaning up a nuclear wasteland… Continue to trademaxx and wait for the big countries to nuke each other into oblivion."*

**The endgame is a game of chicken, and it may be the deepest flaw.** Because betrayal is always available, no coalition against the leader can credibly commit, so whoever spends themselves attacking the *crown* (the community's word for the leader, who wears a crown icon) gets eaten by the people they were helping. u/Aggravating_Main_556 states it exactly: *"With overtime, it becomes a game of chicken between the non-crowns. I've had two games where crown won without a fight because nobody wanted to bite the bullet. And I get it, why commit when you know your neighbors will feast on you?"* and *"Picking off someone weakened by another fight happens all game, but in the endgame, it's too punishing to whoever tries to break the stalemate. That's the worst part of the game for me."* Confirmed from the other side: *"one guy did go for the crown but became largely mutually assured destruction and the lad that didn't commit won."* The optimal line is explicitly third-party predation — *"Check during midgame if any area seems intense. Never go there unless one party seems to get the upper hand. You're guaranteed to circle back to them for easy pickings"* — and the correct collective response is economic, not military: *"What people REALLY need to do more is stop trading with whoever's in first place while they try to eat their neighbors."* The thread's proposed fix, an *unbreakable* short-term alliance, is rejected by the community on the grounds that it would break the game's actual appeal — u/EclecticKant: *"the backstabbing aspect of alliances is very fun, and trying to predict who will attack what player and when is an important skill… an unbreakable alliance would make it extremely easy [to kill the crown]"*. Overtime is the shipped compromise and is well liked — *"the best addition to the core game since I started playing in May"* — but it is a *deadline*, not a solution to the commitment problem. (<https://www.reddit.com/r/Openfront/comments/1w92msa/>)

**Teaming and collusion in FFA.** Issue #2066 (21 comments): *"Teaming in Free-For-All (FFA) matches undermines the core principle of OpenFront.io's solo competition. Currently, there's no system to detect or discourage informal teaming — players can coordinate externally or simply choose not to attack each other."* Pod, on QT3: *"One problem I've seen is people using out of game comms to collude, e.g. clans. They're pretty blatent about it as they even have their clan tags in their name!"* — which is precisely why public FFA now ships `disableClanTags: true` and hides the alliance graph. It is contested: Therlun replies *"I have had a couple of cases of collusion, but I'd say it's pretty rare."*, and the official account snarks at the accusation on Reddit: *"You must be new here. You're supposed to blame it on teaming, not skill."* (<https://www.reddit.com/r/Openfront/comments/1nx66ia/>). Issue #3900 is the honest version: *"New users don't know that [teaming in] ffa is not allowed."* — <https://github.com/openfrontio/OpenFrontIO/issues/2066>, <https://github.com/openfrontio/OpenFrontIO/issues/3900>

**Onboarding — "I didn't know I had to place my spawn."** The most-repeated first-contact complaint anywhere, and it is the *dark side* of the spawn phase being a live social moment: nothing tells you it is happening. HN, in one thread: *"You must plant your nation during the generation fase, otherwise you wont exist in the game!!! (took me 10 minutes to figure out)"* / *"Thank you; I thought I was the only one that did not get that"* / *"I had to lookup a tutorial on YouTube to figure out what I was doing wrong"* / *"Haha - what is going on? How do I play this?"*. Pod: *"the first game I played I didn't even place my starting city so I was just a spectator!"* The rules are undocumented in general — horatiobanz: *"So many people have no idea you can betray people who have the betrayal tag with no penalty. Almost no one knows you can betray someone who has left the game with no penalty. The game does a very bad job of letting everyone know the rules."* (Both of those are real: `GameImpl.breakAlliance` skips `markTraitor()` when the other party is already a traitor or is disconnected.)

**Nuke and SAM balance — the loudest single balance argument.** ALaughAndAHalf on Steam: *"Hydrogen Bombs desperately need to be balanced. At 5 million per launch they're expensive, but they're far too strong… the radius is so large you can kill SAM sites up to level 4, which is a 10.5 million investment for the defender, netting you 5 million in value. But on top of that they also do massive damage to populations… It needs to be one or the other, not both."* — with the counter-argument that nerfing it *"would make endgame infinite"* (<https://steamcommunity.com/app/3560670/discussions/0/582803950825119373/>). A named exploit, "silo-walking", turns the SAM's 9-second cooldown against it: *"Players build silo and detonate a hydro bomb nearby the turret close in range, even if 20, the turrets take too long to react to the hydro bomb and get blown."* Same thread raises the trade-scaling complaint that Config partly confirms — `tradeShipGold` scales with *distance*, not port count: *"when you have 500 ports, but the other player only has 1, he get same amount of money as you do, what's the point in building ports than?"* In-repo mitigations are the MIRV escalator, SAMs, cooldowns, and per-lobby `isNukesDisabled` / `isSAMsDisabled`; issue #5265 is still open.

**The AI complaint runs the *opposite* way to what you'd expect.** Bots are deliberately trivial (never build, never boat, accept every alliance, attack with 5% of troops — the wiki calls them *"cannon-fodder"* and *"filler"*), and nobody complains about that, because they are pacing furniture. The complaints are that **Nations are too strong**: zetazetadelts, Steam, thread "Players vs Nations is Terrible Now" — *"Since the last update, I haven't seen a single game where the humans have won. In fact, the human team usually get steam rolled quickly… There is no ability for human players to coordinate like the computer."*, seconded by *"I've only ever seen one Human vs Nation victory over dozens of rounds"*, and contradicted by *"basically PvE without any real challenge"* (<https://steamcommunity.com/app/3560670/discussions/0/841753627754392889/>). Worth weighing against the fact that HumansVsNations is the **highest-weighted team mode in the public rotation** (weight 20 of 90) and is forced to `Difficulty.Hard`. Also on the difficulty cliff: *"From easy to medium it goes way harder. Should be more progressive. PvP needs elo assap, skill gap with experienced players is too big to be fun in pvp."*

**Lag, "catching up", and mobile.** The client-side cost of simulating ~500 agents at 10 Hz lands on the player, and lockstep means a slow client visibly *replays* rather than degrading gracefully (§4.2). Live r/Openfront threads: *"The game is always 'catching up'"* (<https://www.reddit.com/r/Openfront/comments/1w98f4k/>) and *"What causes this slowness?"* (<https://www.reddit.com/r/Openfront/comments/1w8x245/>) — titles only, the comment bodies rate-limited. psc007 on HN: *"Openfront does not work nicely on mobile and low end devices currently."* A Steam thread titled *"Borderline unplayable on mobile"* lists screen-zoom breakage, a cursor that *"'desyncs' causing it to 'click' about 500 pixels or so below"*, and crashes. Note that HEAD's most recent commit is *"small-fix: various disconnect / desync issues (#5288)"* — this is live territory.

**Desync = you're out.** Architecturally, a client whose hash disagrees is told once and then has its winner and live-stats votes ignored for the rest of the game (§4.6). Lockstep's failure mode is that one bad client silently stops counting.

**Trains/factories reward out-of-match friendships.** Issue #2567: a train visiting a *neighbour's* building pays 35k/25k versus 10k for your own and pays **both** parties, so the highest-EV economy is "build a factory next to someone you already trust" — with none of the piracy risk that keeps trade ships honest. <https://github.com/openfrontio/OpenFrontIO/issues/2567>

**Stalemates.** Issue #2341: *"games can extend indefinitely without a clear winner. Players may reach a state of mutual defense or inactivity where no meaningful progress is made."* Answered with Overtime (default-on for public FFA since 2026-09-03) and the Doomsday Clock. The quick-chat vocabulary concedes both this and snowballing by naming them: `snowballing`, `stalemate`, `number1_warning`, `getting_big`.

**No free chat, and a contested name filter.** The 58-phrase menu is unabusable and needs no moderation across 35 languages, but it is a hard ceiling on negotiation (issues #3189, #3921 are the standing requests). Meanwhile usernames *are* free text, and the filter satisfies nobody: HN, *"Seeing offensive usernames, you will want to filter those"*; r/Openfront, *"People are complaining about the name filter. Yet you still see these kinds of things..."* (<https://www.reddit.com/r/Openfront/comments/1vh05z8/>).

**Monetization backlash (fresh, Sept 2026).** The newest and angriest thread of complaint, and directly relevant to anyone copying the model. In-match ads: *"Why is there an ad right in the middle of gameplay covering the main menu during matches? You can't adjust or see troop counts, see attacks, or select items to build except with hotkeys… Every time an ad changes, it kicks you out of full screen."* (<https://steamcommunity.com/app/3560670/discussions/0/583930834798688405/>); note that release notes v0.33.10/.12/.13/.14 are almost entirely ad-layout fixes. Consent flow: *"I would have given it a try if you didn't implement that deceptive GDPR notice with 30 switches you have to manually unselect."* Paywalled hosting: *"Public lobbies are where I find my favourite types of games but often they aren't being run or theres none at all… Creating a lobby I have to pay $5/month… kind of seems like the game is shooting itself in the foot"* — with a good counter-argument that unlimited hosting would fragment the player pool, and a paying host reporting *"I probably host around 30 games a week… From 30 to 80+ people."* (<https://www.reddit.com/r/Openfront/comments/1w9lix0/>). The creator's own answer on HN: *"I'm the creator of OpenFront. I created an LLC mostly for tax purposes, but I maintain 100% ownership. No publishing company involved. Playwire is ad company I'm partnering with. I recently quit my job to work on this full time, so need to figure out some form of monetization."*

**Release cadence.** Pod: *"They've bungled every single release so far! … none of it was really play tested, at least not at the scale of the normal game with 150 in each match."* A lockstep game cannot A/B test balance — everyone in a match must run identical code — so every balance change ships to all 200k players at once.

---

## 6. Versus territorial.io

The lineage, corrected by someone who was there. OpenFront's README says *"This is a fork/rewrite of WarFront.io"*, and psc007 on HN fills in the crucial detail: *"It is heavily inspired by territorial.io. One of the contributing devs made an open source version: warfront.io, which openfront is forked from and then heavily developed. **Warfront did not have any multiplayer** so Evan, the creator of openfront, made it multiplayer and together with contributors made lots of new features."* (<https://news.ycombinator.com/item?id=44528943>, emphasis mine.) So the deterministic-lockstep layer in §4 is not inherited from anywhere — it is the founding contribution, built onto a single-player clone of a closed-source game. Territorial.io (closed source) supplies the grammar: pick a spawn, expand into neutral land with a percentage-of-population slider, push borders, hold the map.

r/Openfront's own sidebar states the delta verbatim: *"Originally launched as a clone of Territorial.io, OpenFront breaks the mold set by its predecessor with an added economy system, trade routes, improved naval combat, buildings, and nuclear warfare."*

What OpenFront added, all verifiable in the source:

| Addition | Where | What it changes |
|---|---|---|
| **Multiplayer at all** | `src/server/*`, `src/core/GameRunner.ts` | WarFront had none. Everything else is downstream of this. |
| **Alliances with expiry + a traitor debuff** | `AllianceImpl`, `Config.traitor*` | Turns a race into a negotiation. The single biggest gameplay divergence. |
| **Teams (2–7, Duos/Trios/Quads, Humans vs Nations)** | `TeamAssignment.ts`, `MapPlaylist` | A second game where betrayal is impossible and coordination is the skill; a third of public matches. |
| **Ports, trade ships, embargoes** | `PortExecution`, `TradeShipExecution` | A resource loop that is *interpersonal*: income depends on who will trade with you, and can be sanctioned or pirated. |
| **Nukes: atom / hydrogen / MIRV, plus SAMs and silos** | `NukeExecution`, `MIRVExecution`, `SAMLauncherExecution` | The endgame threat everyone can see coming; four dedicated MIRV phrases in the quick-chat menu. |
| **Transport boats and warships** | `TransportShipExecution`, `WarshipExecution` | Coastlines matter; no front is safe; naval interdiction of the economy. |
| **Defense posts, cities, factories, trains, railroads** | `Config.unitInfo`, `RailNetworkImpl` | Territory gains texture rather than just area. |
| **119 real-geography maps + a Go map generator** | `map-generator/`, `Maps.gen.ts` | Player-made maps; the press kit notes "Players build the maps." |
| **Nations as a distinct, competent AI tier** | `execution/nation/*` (~4,000 lines) | An opponent between "bot filler" and "human". |
| **Open source, AGPL, ~250 contributors, replays, a public API** | whole repo, `docs/API.md` | Community feature velocity, and the ability to research it like this. |
| **Anti-stalemate systems (Overtime, Doomsday Clock)** | `WinCheckExecution`, `DoomsdayClock.ts` | Tuned against 85 recorded tournament games. |

**Which additions players say made it better.** Therlun's verdict is the cleanest: *"This is actually really good, and much more user friendly (also prettier, and more interesting with the border expansion) than territorial.io, the game this started as a clone of. The dev is very active and constantly improves stuff."* On the buildings/abilities layer specifically he was initially unconvinced and came round: *"I wasn't sure how I liked the addition of buildings and special abilities, but I've mostly come around. They are strong and useful."* Pod went and played the whole genre — *"even gave territorial.io a go, and also found a bunch more clones (e.g. warfront.io, generals.io). Despite being new and janktacular, OpenFront is my favourite of the bunch so far."* petercooper on HN frames the trade-off honestly: *"territorial.io is worth playing as an alternative if you only have 5 minutes to spare though but the strategy is quite simple."* Nukes remain the most divisive addition: simultaneously the most-cited spectacle (the MAD standoffs above) and the loudest balance complaint (§5.2), with public-lobby modifiers existing purely to turn them off.

**Engagement gap as a hard proxy.** Similarweb, Aug 2026: openfront.io averages **18:56 per visit, 9.87 pages, 16.97% bounce, global rank #4,725**; territorial.io averages **04:37, 2.65 pages, 59.86% bounce, rank #59,533** (<https://www.similarweb.com/website/territorial.io/vs/openfront.io/>). Roughly 4× the session length and a third the bounce rate. Community scale matches: the official Discord is **56,110 members / ~11,000 online** (2026-09-08); the Steam page claims "over 1 million monthly active players on the web version".


## 7. The 10 design decisions that make OpenFront multiplayer work with strangers, ranked

Each is tagged **[LOCKSTEP]** if it depends on the deterministic-lockstep architecture, **[DESIGN]** if it is pure design and would port to any netcode, or **[BOTH]** where the architecture is what makes the design affordable.

**1. Alliances expire on a 5-minute timer and require a mutual re-vote to renew. [DESIGN]** This is the engine of the whole social game. A permanent alliance is a non-decision; an alliance that dies unless both of you actively re-commit forces a fresh, explicit judgment about a stranger every five minutes, at exactly the moment when your relative positions have changed. Every other social mechanic hangs off this clock. Nothing about it needs lockstep.

**2. Betrayal is priced, not forbidden — and the price is public and global. [DESIGN]** For 30 seconds *everyone on the map* takes half the casualties attacking you and pushes through your land 20% faster; plus a broken-shield icon, a permanent betrayal counter, −100 relations with the victim and −40 with every neighbour, and bots that specifically hunt traitors. The designers did not try to prevent defection; they made it a costly, legible, survivable move. Critically, breaking with a traitor is free — so one betrayal can cascade a whole web apart. This converts the prisoner's dilemma from a bug into the content. **Its limit is real and unsolved:** because defection is always available, no anti-leader coalition can credibly commit, so the endgame degenerates into a game of chicken (§5.2). Overtime papers over it with a deadline rather than fixing it — and the community rejects the obvious fix (unbreakable alliances) because it would remove the thing they came for.

**3. 400 bots and up to 72 AI nations fill every lobby, for free. [BOTH]** Design-wise this solves the cold-start problem that kills most multiplayer games: the map is full and dangerous from tick one, matches never wait for humans, and the "expand into neutral land" phase has real opposition. Architecturally it is only *free* because of lockstep — the AI is a set of deterministic executions that every client computes from the same seed, so 400 bots cost zero bytes and zero server CPU. In a server-authoritative design, 472 AI agents at 10 Hz would be the dominant server cost. This is the clearest case in the game where the netcode choice unlocked a design choice.

**4. The server relays intents and never simulates. [LOCKSTEP]** `grep -rn "executeNextTick" src/server/` returns nothing. The server's per-game job is "append to a list; every 100 ms, encode once and fan out". That is why one box runs hundreds of concurrent 100-player matches — my measurement says a full 125-player match is ~150 kbit/s of egress and no meaningful CPU. Zero marginal cost per match is what allows three lobbies counting down at all times, 400+ public games an hour, and free play with no monetisation pressure on match length.

**5. A 30-second simultaneous spawn phase where placement is the first social act. [DESIGN]** Not a loading screen: a live shared board where you watch neighbours appear, re-pick, and commit. It front-loads the "who am I stuck next to" question, makes the first 30 seconds social rather than mechanical, and gives everyone a shared origin story for the match. Random spawn is a *modifier*, not the default — choosing is the point.

**6. Public lobbies start on a wall-clock countdown, not on readiness. [BOTH]** Three parallel queues (ffa / team / special), six lobbies deep each, front lobby always counting down from 2 minutes, early start on full. Nobody waits for a human. Measured median fill 17.8 s. Design-wise this is the drop-in property; it is *possible* because bots make a half-empty lobby still a good game (#3), which is lockstep's gift.

**7. All communication is a fixed vocabulary: 60 emoji, 58 canned phrases, target marks. [DESIGN]** Removes the entire moderation surface across 35 languages, makes the game legible to strangers who share no language, and — crucially — *shapes* the diplomacy by shipping the scripts: "Alliance?", "I trusted you...", "[P1] is snowballing too fast!", "The #1 player will win soon unless we team up!". A constrained vocabulary is a design document players read by using it. ("I've navigated geopolitics and diplomacy with other players without using a single word.")

**8. Attacking is one irreversible, immediately-costed act with a legible failure mode. [DESIGN]** Troops leave your pool the instant you commit. Overwhelming force is capped at 2:1 benefit, but being outnumbered inflates the *time* cost superlinearly (7.5× then a second ramp past 20:1) — so a hopeless attack doesn't lose dramatically, it stalls visibly, and both parties can read the outcome from the map. Retreat costs 25%. This makes bluffing, over-commitment and third-party opportunism all readable to spectators and to strangers with no shared language. The counterweight is **annexation** (§1.6): the one way to take land for free is to encircle it, which rewards patient geometry over force and gives the weaker player something to do that isn't a doomed attack.

**9. Big territories are cheaper to attack into, and the win bar sinks over time. [DESIGN]** `largeTerritoryBonus` gives an attacker up to a 0.3× tile cost against huge holdings, and Overtime drops the 80% win requirement by 2 points/minute after 30 minutes with no floor. Together these guarantee that the leader gets harder to be and that the game ends. The Doomsday Clock's tuning comment ("Ceiling and steps come from 85 tournament games") shows this is measured, not vibes. Snowball is the natural failure mode of every territory game; this one attacks it in the combat math rather than with a catch-up power-up.

**10. Because the match *is* its intent list, replays, reconnects, spectating and archives are one mechanism. [LOCKSTEP]** `turns.slice(lastTurn)` is simultaneously the reconnect protocol, the late-join protocol, the spectator feed and the replay file. A whole 125-player, 36-minute war archives as ~1.4 MB of intents. You cannot fall out of a match permanently, anyone can watch any game, and the competitive scene gets free VOD. In a state-replication engine each of those four is a separate subsystem with its own bugs; here they are the same twenty lines.

**Split:** #1, #2, #5, #7, #8, #9 are pure design and would work over any transport. #4 and #10 exist only because of deterministic lockstep. #3 and #6 are the interesting ones — the architecture is what makes the design economically possible, which is the real lesson: choosing lockstep didn't just make the game cheap to run, it made "fill every lobby with 400 opponents" a decision they could afford to make.

---

## 8. Appendix: where the community wikis have drifted from the source

Worth recording because anyone researching this game will hit the wikis first, and they are wrong in ways that would change design conclusions. Left column is what the community documentation says; right is `Config.ts` / execution code at `0ab7dec`.

| Quantity | Wiki / guide sites say | Source at HEAD says |
|---|---|---|
| City troop bonus | 25,000 per city | **250,000 per city level** (`cityTroopIncrease()`) — 10× |
| Trade-ship gold | `10,000 + 150 × dist^1.1` | **`75,000 / (1 + e^(−0.03·(dist−300))) + 50·dist`** — a sigmoid with a 300-tile short-range penalty, a completely different shape |
| Train gold to an ally | 50,000 | **35,000** (25,000 team/other, 10,000 self, −5,000 per city past 9, floor 5,000) |
| Bot handicaps | max pop ½, growth ×0.7 | **max pop ⅓, growth ×0.5** |
| Human-vs-bot damage | `mag *= 0.8` | **`BOT_DEFENDER_LOSS_MULT = 0.7`** |
| Nation starting troops | 2,500 / 5,000 / 20,000 / 50,000 | **12,500 / 18,750 / 25,000 / 31,250** by Easy/Medium/Hard/Impossible |
| Difficulty names | Relaxed / Balanced / Intense / Impossible | `enum Difficulty { Easy, Medium, Hard, Impossible }` |
| MIRV warhead spread | centres ≥25 tiles apart | **`minimumSpread = 55`**, `warheadCount = 350` |
| Team-mode win threshold | 95% of territory (guide sites) | **80%, the same `PERCENT_TILES_OWNED_TO_WIN` as FFA.** `teamLandShareWinThresholdTenths() = 7` is unrelated — it decides which *disconnected* teammates get credited on the winner list (`GameImpl.makeWinner`), not what wins |
| Traitor speed debuff | "you lose 20% attack speed" | `traitorSpeedDebuff() = 0.8` multiplies `tickFraction` **for attacks against the traitor** — everyone else moves through your land 20% *faster*; it is a second defensive penalty, not an offensive one |
| Population model | troops vs "workers", workers reproduce ~30% faster | **No such split exists in the current source.** A player has one `troops` number; gold is a flat 100/tick unrelated to population. Either removed or never in this codebase |
| Map count | 117 (v33) | **119** in `Maps.gen.ts` |

The pattern is that the wikis were accurate for v23–v26 and the economy has been rebalanced hard since — mostly *upward* (cities 10×, trade reshaped around long-range routes). Any design conclusion drawn from the wiki's economy numbers will be about a game that no longer exists.

---

## Caveats on this document, and what I could not verify

- Everything sourced to a file path is from commit `0ab7dec` (2026-09-08) and can drift.
- Match statistics are from a single 2-hour window (2026-09-06 12:00–14:00Z, 813 matches) via `api.openfront.io/public/games`; treat them as representative of that day, not as a census.
- Wire-size figures are *computed* from archived turn/intent counts × the repo's own byte budgets (`tests/zbin/protocol.test.ts`: empty turn ≤7 B, stamped attack intent ≤13 B), not captured off a live socket. They should be right to within a factor well under 2, and the independently reported "85% reduction vs JSON" in v0.33.11 corroborates the order of magnitude.
- Two community wikis exist at different versions: **openfront.miraheze.org** (~v23–v26, the one most search results point at) and **openfront.wiki** (an Astro rebuild current to v0.33.0, which also mirrors Liquipedia tournament data). Neither is authoritative for balance — see §8. Two further guide sites (openfront.fyi, openfrontgame.wiki) are unattributed, read as machine-assembled, and contain at least one figure both wikis contradict; I have not sourced any number to them alone.
- OpenFront's Steam page is **pre-release** (Early Access 2026-09-17), so there are **no Steam user reviews**; the Steam quotes here are from its discussion forum.
- reddit.com is blocked to this environment's fetchers (403 / tool-level block). r/Openfront quotes in §5–§6 were retrieved via the subreddit's Atom feeds, which rate-limited: some threads are cited by title only, and comment bodies for the two "catching up" performance threads could not be read. **r/territorialio was not reached at all** — treat "what territorial.io players think of OpenFront" as unverified. The heavyweight discussion sources here are the Quarter to Three thread (<https://forum.quartertothree.com/t/openfront-io-liquid-war-meets-diplomacy/163985>), the Hacker News thread (<https://news.ycombinator.com/item?id=44528943>), Steam discussions, and the project's own issue tracker.
- Steam and Similarweb figures are third-party or marketing claims, not measurements I made; the press-kit numbers are the company's own.
- `openfront.io` itself and `wiki.openfront.io` return 403 to automated fetchers; the landing and press content quoted here was read out of the repo (`index.html`, `resources/press/index.html`), which is the source those pages are built from.
