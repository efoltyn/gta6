# DESERT WARLORD — the module contract

Read `core.js` first. It is the only file allowed to define what a soldier is,
what a warband is, or whose turn it is to own the screen. Everything here is a
face of that state.

## The loop, in one line

ride the island → take ground → the ground raises men → meet somebody → fight /
hire / demand → decide what to do with the men who surrendered → spend it at an
outpost → ride.

## The two rules the whole game hangs off

The owner's brief has never changed: *"ultra simple mechanics, made for
multiplayer — openfront.io met Bannerlord"*, and as of 2026-09-04 *"think about
openfront.io mixed with agar.io … the big thing is battle logic improving"*.
Two rules fall out of that and everything else bends around them.

**VICTORY IS LAND.** The run is won when you hold **80% of the island's
provinces** — `T.winTarget()`, which is `ceil(regions * 0.8)` and is therefore
32 of 40 today and follows `TARGET_REGIONS` for free. It is on the strip and on
the map from the first frame ("7 OF 40 · YOURS AT 32"). Losing is unchanged:
you fall with nobody left to carry you, your own men kill you, or you run out
of everything (events.js, THE END).

*What this replaced, and why it is written down:* events.js's **THE FOUR** —
four named warlords picked once at boot, broken when their men fell under 15%
of a `size0` baseline. match.js could not raise a single column (see its
`COLUMN_CEILING` tombstone), so every warlord had zero men, so every one of them
was already "broken", and **the first aftermath of the first skirmish printed
THE ISLAND IS YOURS on day one**. Nobody rebuild it.

**GROWTH IS LAND.** Every dawn, every province raises a levy into its garrison
toward `supportOf(r)` — the men that ground feeds — filling over `SETTLE_DAWNS`
(6), the same six dawns `defenceOf` takes to stop treating a capture as
brittle. Yours are real `W.makeSoldier` levies with `W.cheapestGun()`;
everybody else's is a strength (`gp`). A garrison is **not on your payroll** —
the ground feeds it — and the moment you march a man out of it he starts
costing core's wage. The player marches them with **RAISE THE LEVY**; a rival's
columns are topped up from his own garrisons (match.js `topUpColumns`), never
conjured.

## Taking ground — three doors

1. **Beat the force that holds it.** `T.onBattleWon` — win a battle standing on
   a province against a band belonging to its owner (or on unclaimed ground).
2. **Stand on the unclaimed.** One campaign hour in an unowned province with a
   column of at least ten men (core's own `BAND_CLASSES` floor for a BAND) and
   it is yours. Leaving resets it. A chip counts it down. Rivals do the same
   with two dawns instead of one hour (match.js `takeEmptyGround`).
3. **STORM it.** A province somebody holds with no column standing on it: the
   rail offers STORM, and it is a real `W.battle.start` against the garrison —
   `T.garrisonRoster(r)` turns `defenceOf`'s own two terms into men, so a
   strength-only garrison becomes levies and you fight what the map card
   priced. Win and it is yours; lose and what is left holds it.

## The scale rule (agar.io)

Above `W.surrenderSure()` — `SURRENDER.floor + cap/slope`, 3.05×, the ratio at
which core's own surrender ramp has stopped moving — a meeting has no decision
in it and **no card comes up**:

- you are 3.05× a **hostile** party → it surrenders on sight, prisoners,
  aftermath.
- a party is 3.05× you **and it was hunting you** → your column scatters. You
  lose `W.SHED_CAP * (1 - odds)` of the roster, levies first, and you keep the
  warlord. Walk up to it yourself and you still get the rail.

Never against a `peer` band: a human is not absorbed by a function call.

## Boot

`games/warlord.html` loads studio packs, then the armoury, then every
`src/warlord/*.js`, then calls `CBZ.warlord.bootModules(ctx)`.

Every module file ends with:

```js
CBZ.warlord.module("campaign", {
  needs: ["desert"],          // booted before me
  boot: function (ctx) { ... } // called ONCE, at page start. Build nothing heavy here.
});
```

`ctx` is `{THREE, CBZ, W, scene, micro, coarse, Q, el, stage, hud, screen,
closeScreen, paintHud, menu}`.

- `ctx.screen(html)` — take over the full-screen `#stage`, returns the node.
- `ctx.closeScreen()` — give it back. The router already closes it on entering
  `campaign` and `battle`.
- `ctx.Q` — URLSearchParams. Every behaviour change gets a `?flag=old` revert
  switch, repo doctrine.

## Phases — exactly one module owns the screen

`W.setPhase(name, data)` fires `phase:leave:<from>`, `phase`, `phase:<to>`.

`boot menu campaign encounter battle aftermath outpost armoury over`

| phase | owner | means |
|---|---|---|
| `campaign` | campaign.js | you are riding the island |
| `encounter` | army.js | the fight/hire/demand card is up |
| `battle` | battle.js | real 3D war, campaign hidden |
| `aftermath` | army.js | dead counted, loot taken, prisoners decided |
| ~~`outpost`~~ | — | **retired.** See below. |
| `armoury` | loadout.js | assigning kit |

`events.js` and `territory.js` take the screen without owning a phase — an
event card and the strategic map are both things that happen *over* the
campaign. They use `ctx.screen`/`ctx.closeScreen` and hand it straight back.

**And so does trading.** `outpost.js` used to own an `outpost` phase, and the
cost of that claim was the whole world: taking it fires `phase:leave:campaign`,
campaign.js answers with `showAll(false)`, and the island, your column, every
band, the outpost's own huts and the campaign HUD are all switched off. The
owner met that as *"barren desert and man with a crate popup with no man
there"* — the panel was talking about a trading post over a hidden world. A
phase is a claim that one module owns the SCREEN; a docked verb rail does not
own the screen, so it does not take one. `W.setPhase("outpost")` is called by
nobody now (campaign.js still sets it one line before `W.outpost.open`, which
hands it straight back) and the name survives only in core.js's enum for old
save files. THE SAME IS TRUE OF `encounter`, which army.js still claims for a
rail — it hides the band the card is about.

## The modules

| file | owns |
|---|---|
| `core.js` | the state, the men, the money, phases. No THREE in it. |
| `props.js` | the object library: outposts, banners, wrecks, cover, camp |
| `camo.js` | procedural camo pattern textures, cached and shared |
| `outfits.js` | every faction's own painted uniform, visible by tier |
| `wardrobe.js` | the player's own fit — army dress, the black suit, generals |
| `sand.js` | where a foot actually rests, and the prints it leaves |
| `desert.js` | the island — analytic `heightAt`, biomes, chunked terrain |
| `mounts.js` | horses/camels/technicals: campaign speed and cavalry |
| `territory.js` | regions, ownership, the strategic map |
| `campaign.js` | riding the island; roaming bands; encounter detection |
| `army.js` | the encounter card, the roster, the aftermath |
| `battle.js` | the real 3D war on `combat_iq` |
| `outpost.js` | depots (finite gun crates) and camps (finite men) |
| `loadout.js` | who carries what |
| `events.js` | road events, loyalty/mutiny, weather, the endgame |
| `feel.js` | sound, impact, and the mixer that makes 300 rifles a war |
| `warnet.js` | multiplayer TRANSPORT: sockets, host election, snapshot/apply |
| `match.js` | the rival warlords: who they are, their columns, the alliances, the leaderboard |

## The law of the shared clock

The owner's brief is *"ultra simple mechanics, made for multiplayer — it's
almost like openfront.io met Bannerlord once it's multiplayer."* One rule
falls out of that and everything else in the design bends around it:

**THE CAMPAIGN CLOCK NEVER PAUSES.** Not for a battle, not for an open menu,
not for a disconnected player. Seven warlords ride the same island and the
world does not stop for any of them.

The consequence lands on the battle, and it is why `battle.js` owes two
entry points with ONE model behind them:

- `W.battle.start(...)` — the 3D fight, on a hard time budget
- `W.battle.resolve(...)` — the same rosters, the same morale model, the same
  result shape, resolved in one call with nothing rendered

`start({band, solo:true, duel:true})` is the one-on-one: none of your men are
fielded (they are the reserve and come home untouched) and neither side routs.
Every battle ends with `battle:end` (the report) on the bus before the aftermath
takes the screen — events.js's duel waits on it.

Orders are `charge hold flank fallback follow move`. FOLLOW forms the line on
the warlord and keeps it there; MOVE is a point on the field (`W.battle.moveTo`,
or a tap in the command seat) the line goes to and holds. Neither is a second
AI: out of contact the section marches to the point, in contact think() hands
back to combat_iq exactly as HOLD does.

Two presentations of one battle model, never two models that can disagree.
`resolve` is what runs when a player skips the fight, drops mid-battle, when
AI fights AI, and whenever a live match cannot wait.

Everything derivable is derived from the seed. The wire carries ownership and
intent; it never carries the map.

A module MUST tear down its own scene objects on `phase:leave:<its phase>`.
Two modules rendering at once is the failure mode this exists to stop.

## State (`W.state`)

```
seed mode phase day hour gold fame
you    {name,x,z,yaw,wid,armour,hp,maxHp,kills}
army   [soldier]                 // YOUR men. You are NOT in it — armySize() adds you.
baggage    {wid: count}          // unassigned guns in your cart
armourBag  {armourId: count}
prisoners  [soldier]
bands      [band]                // every other party on the island
outposts   [outpost]
peers      {id: {...}}           // multiplayer
log stats flags
```

**soldier** `{id,name,tier,wid,armour,hp,maxHp,kills,battles,wounded}` — only ever
built by `W.makeSoldier(tierId, wid, opts)`.

**band** `{id,faction,name,colour,x,z,men[],gold,goal,mood,cooldown,wealth,kind,hostile}` —
only ever built by `W.makeBand({size,faction,x,z})`. `men` is a REAL roster of
real soldiers, generated up front, because the battle puts those exact men on
the sand and the surrender screen hands you those exact men.

`kind` is null for a party off the power law and a `W.SMALL_PARTIES` archetype
id (`looters`, `caravan`, `patrol`, …) for one of the small ones; `hostile` is
null unless that archetype overrode the faction's appetite for a fight. Read it
through **`W.bandHostile(b)`**, never off the faction row — a SALT CARAVAN and a
RAIDING CREW can share a faction and want opposite things from you.

**`held`** — set on a band by whoever is standing in front of it (army.js while
its encounter rail is up; events.js while a card's party is cast on the road or
walking in). campaign.js reads it and only reads it: a held party does not
think, walk, tick its cooldown, get picked for the off-screen war, or get
cleared by the unstick belt. Whoever sets it clears it. `cast` (a card id),
`joining`, `transient` (riding off the map) and `await` (waiting on a battle's
outcome) are events.js's own marks on top of that; `W.events.clearStage()`
strikes all of them.

## The prisoner screen — THEY decide, then YOU decide

Every captured man rolls WILLING or UNWILLING **once**, when the screen goes up
(`willChance`: his tier, the fights he has survived past the promotion he
already has, the power ratio the battle was fought at, your fame, and fear).
The card says it in one line and offers **at most three verbs, in this order**:

| verb | what happens | what it costs |
|---|---|---|
| TAKE THE WILLING | they join; the rest walk | nothing — and the walkers buy fame, which is what makes the next band fold |
| PRESS EVERY MAN | all of them march | the unwilling carry events.js's pressed provenance: a per-dawn desertion chance and a permanent drag on the loyalty ceiling |
| SHOOT THE UNWILLING | the willing ride, the rest are shot in one volley | `stats.executed`, and events.js's `settle()` pays the ceiling drop now |

There is **no price on any of them** and no ransom, no release, and no "reject
conscription". Loot (guns and armour into baggage) is automatic and stated as
chips on the same card. `stats.recruited` is men who chose you, `conscripted` is
men who did not — the end screen's PRESSED tile reads the second one.

**FEAR, NOT DREAD.** army.js wraps `W.surrenderChance` and every execution now
multiplies it **up** (1 + n×0.09): parties fold to a warlord who shoots men. The
cost is his own column's opinion of him (events.js's `bondOf` already poisons
every bond per execution). It used to point the other way, which made executing
men three costs and no benefit.

**A card about people is a meeting with people.** events.js's road cards that
open with a man or a party in front of you (`deserters`, `caravan`, `rival`,
`column`, `runner`, `oldman`, `buyer`, `toll`, `duel`, `defector`, `summons`)
declare `cast()` and are CAST before they fire: the party is built by core,
pushed onto `S.bands` ahead of the player and held, and the card comes up as a
verb rail (ctx.verbs, the same strip the encounter uses) when the player
reaches it — a rider walks in instead. Every choice acts on that party through
five verbs: `absorb` (they fall in), `letGo` (they stay on the island), `rideOff`
(they leave, and leave the map out of sight), `attack` (a battle with them, now),
`arriveMen` (men promised from elsewhere come over a rise). Never a sixth.

**The island's party pool lives in ONE place**: `W.rollIslandBand({small,x,z})`.
campaign.js's spawner calls it and so does `tools/warlord-check.mjs`, which is
the point — the power law used to be typed inside campaign.js while core
published a different distribution nobody called, so the headless economy check
was measuring an island the game never spawned.

## Useful core calls

```
W.rnd() W.range(a,b) W.irange(a,b) W.pick(a) W.chance(p) W.hash01(x,y,salt)
W.clamp(v,a,b) W.lerp(a,b,t)
W.TIERS W.tier(id) W.tierIndex(id) W.ARMOUR W.armour(id)
W.gunList() W.gun(id) W.gunLabel(id) W.gunPrice(id) W.gunSell(id) W.gunRarity(id)
W.makeSoldier() W.makeBand() W.addSoldier(s) W.removeSoldier(id) W.armySize()
W.rollIslandBand({small,x,z}) W.makeSmallBand() W.rollBigSize() W.bandHostile(b)
W.SMALL_PARTIES W.SMALL_PER_BIG W.BAND_CLASSES W.rollBandSize()
W.soldierPower(s) W.power(list) W.yourPower() W.bandPower(b) W.bandSize(b)
W.odds(mine,theirs) W.surrenderChance(band, myPower)
W.SURRENDER {floor,slope,cap} W.surrenderSure() W.SHED_CAP W.cheapestGun()
W.stash(wid,n) W.unstash(wid,n) W.stashArmour() W.unstashArmour()
W.equip(soldier,wid) W.equipArmour(soldier,id)
W.payroll() W.pay(n) W.earn(n) W.dawn()
W.promoteSurvivors(list)
W.log(text,kind) W.toast(text,kind) W.on(ev,fn) W.emit(ev,a)
W.save() W.load() W.newGame({seed,mode})
```

## Owned events

`toast log gold army baggage dawn phase newgame loaded mainmenu battle:end`
plus `territory:claim` (every ownership change, any cause) and `warlords:out`
(a rival holds nothing and rides nothing — the ONLY definition of broken)
plus each module's own — declare new ones in a comment at the top of your file.

## The house style (CLAUDE.md is law here)

- This repo's existing code is NOT a bible. If something is wrong, fix it.
- Every non-obvious decision gets a comment saying WHY, in the voice of the
  surrounding repo: what the first draft got wrong, what was measured.
- No stat fiction. Derive numbers from something real; never type a magic
  scalar and call it balance.
- Never fork an engine file. If `combat_iq` needs a service the city provides,
  route the NAME to microboot's equivalent (the page already does this for
  `queryCollidersNear`, `floorAt`, `collide`).
- three.js here is **r128**, not r185. `outputEncoding`/`sRGBEncoding`,
  `Geometry` is gone but `BufferGeometry` helpers like `BoxGeometry` exist.
  No `setFromPoints` on old paths, no `color.setColorSpace`.
