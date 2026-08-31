# DESERT WARLORD — the module contract

Read `core.js` first. It is the only file allowed to define what a soldier is,
what a warband is, or whose turn it is to own the screen. Everything here is a
face of that state.

## The loop, in one line

ride the island → meet somebody → fight / hire / demand surrender → count the
dead, take their guns, take their men → spend it at an outpost → ride.

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
| `match.js` | the RULES OF THE MATCH: lobby, spawn, clock, diplomacy, victory |

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

**band** `{id,faction,name,colour,x,z,men[],gold,goal,mood,cooldown,wealth}` —
only ever built by `W.makeBand({size,faction,x,z})`. `men` is a REAL roster of
real soldiers, generated up front, because the battle puts those exact men on
the sand and the surrender screen hands you those exact men.

## Useful core calls

```
W.rnd() W.range(a,b) W.irange(a,b) W.pick(a) W.chance(p) W.hash01(x,y,salt)
W.clamp(v,a,b) W.lerp(a,b,t)
W.TIERS W.tier(id) W.tierIndex(id) W.ARMOUR W.armour(id)
W.gunList() W.gun(id) W.gunLabel(id) W.gunPrice(id) W.gunSell(id) W.gunRarity(id)
W.makeSoldier() W.makeBand() W.addSoldier(s) W.removeSoldier(id) W.armySize()
W.soldierPower(s) W.power(list) W.yourPower() W.bandPower(b) W.bandSize(b)
W.odds(mine,theirs) W.surrenderChance(band, myPower)
W.stash(wid,n) W.unstash(wid,n) W.stashArmour() W.unstashArmour()
W.equip(soldier,wid) W.equipArmour(soldier,id)
W.payroll() W.pay(n) W.earn(n) W.dawn()
W.promoteSurvivors(list)
W.log(text,kind) W.toast(text,kind) W.on(ev,fn) W.emit(ev,a)
W.save() W.load() W.newGame({seed,mode})
```

## Owned events

`toast log gold army baggage dawn phase newgame loaded mainmenu`
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
