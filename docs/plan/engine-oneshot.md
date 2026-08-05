# ENGINE: THE ONE-SHOT — make a short game cheap, and make it the same every time

Design doc. No game code here. Every number was read out of the repo 2026-08-05
and is cited `file:line` or by the command that produced it; where I could not
verify something I say so.

Owner, verbatim: *"take this massive 250 thousand line of code thing and make it
an engine that makes creating that HTML one-shot as easy as possible and as
consistent as possible. And you have made a bunch of assets to start with."*
And earlier, the theory: *"If you make a book, 450 chapters, it's gonna be hard
for the chapters to stick together. But if you make a language 450 chapters,
and you make each book short, then the books will have very clear plots."*

---

## 0. THE VERDICT

1. **The engine exists as capability and does not exist as an interface.**
   `2,695` distinct `CBZ.*` names are assigned at top level across `src/`
   (`grep -rhoE 'CBZ\.[a-zA-Z_][a-zA-Z0-9_]*\s*=[^=]' src --include="*.js" | sort -u | wc -l`).
   `docs/claude/engine-systems.md` documents **65** shared systems in 1,291
   lines of prose. A capability you must read a 1,291-line doctrine to find is
   an oral tradition, not an engine.
2. **The counter-example is in the repo and it works.** `ctx`
   (`core/packages.js:308`) has **21** members and took 10 adopters in two days
   where `interfaces.js` (326 lines) took zero. `doctrine.md:123` already names
   the law — *a block must REPLACE code the caller writes anyway*. The
   one-shot engine is that law applied at the level of a whole game instead of
   a whole prop.
3. **`ctx` is the right SHAPE aimed at the wrong ALTITUDE.** It supplies
   prop-dressing (`box`/`cyl`/`solid`/`light`) — which authors barely needed:
   dressing calls are **0–5%** of every package's lines, and raw `THREE.` use
   is 3–18 refs per file. It withholds the two things that make a game a game
   (§2, §3). That is why nine well-written packages read as furniture.
4. **A one-shot costs 967 lines and 4 requests. Today it costs 400,329 lines
   and 486.** `cell-block-z.original.html.bak` is 967 lines, one file, a
   complete game, 1.07 s to playable, 5.6 s on a modelled phone. `index.html`
   is 467 `<script src>` tags, 23.2 MB, 3.5 s to title + a **21–31 s
   synchronous freeze**, 16.8 s to title at `--cpu 4` (all measured,
   `LOAD-NOTES.md`). `games/dev.html:41` re-reads index.html and replays *all
   467 tags* to mount one package — that is the inheritance made literal.
5. **Nothing is separable today.** Files with zero references to
   `CBZ.city*` / `g.mode` / `CBZ.prison` / `CBZ.surv`:

   | dir | clean files | clean LOC / total |
   |---|---|---|
   | core | 10/21 | 2,667 / 7,244 |
   | entities | 4/17 | 639 / 14,630 |
   | systems | 16/82 | 5,662 / 57,431 |
   | world | 15/48 | 7,585 / 31,543 |
   | sim | 0/13 | 0 / 8,548 |
   | net | 0/7 | 0 / 3,153 |

   **~26k of 400k LOC is city-free.** There are **698** `mode === "…"` branches
   across **183** files, 563 of them `"city"`. The chapters are holding hands.
6. **Three services turn a chapter into a book, and all three already exist as
   hardcode.** BOOT (§1) is `dev.html`'s script replay. SESSION (§2) is
   `systems/state.js`'s four-mode `setMode`/`resetGame`. WORLD (§3) is
   `modes/gungame.js:98-130`'s five map hooks. **None needs inventing — each
   needs promoting from a hardcode to a registry.**
7. **`modes/gungame.js` is the existence proof.** 934 lines, **builds no
   world**, borrows two through `ensure/root/floorAt/point/label`, ships a
   title card, a ladder, a verdict screen and a reset. That is a short book in
   a shared language, and it is the only one anybody has written.
8. **Consistency is a separate demand from ease and needs its own mechanism.**
   Ease is the facade (§1–3). Consistency is ONE working template plus ONE gate
   with a **budget ratchet** (§5). Without the ratchet, one-shot #4 re-grows
   467 tags and we are back here.
9. **The shared character already exists and is named `city`.** Owner: *"all
   the games can share one character — level and role, and money."* All three
   are built: `city/worldstate.js` is a ~40-field ledger, `city/origins.js` is
   already a three-protagonist **character vault** with a GTA5-style swap, and
   **level is DERIVED, never stored** (`level.js:176-206`) from inputs the
   ledger already holds. The modes cannot reach any of it — escape mode runs on
   **cigarettes** because the wallet is behind a `city` prefix. This is a rename
   and a promotion, not a build. §7.
10. **Do not start by refactoring the city.** Every phase in §6 is additive and
   flag-reverted; the city keeps booting byte-identically until the very last
   one. `docs/claude/project.md`'s rule stands — pushing to main IS the deploy,
   and no build step is coming.

---

## 1. BOOT — a manifest, not 467 tags

**Today.** `index.html` hardcodes 467 render-blocking `<script src>` in
dependency order, no `defer`, no `async`; 21.1 MB of JS parsed before the title
screen exists (2.8 s of V8 ScriptDuration, **14.3 s at `--cpu 4`**). Any new
game inherits all of it, because the only documented dev path
(`games/dev.html`) fetches `../index.html` and replays the list verbatim.

**The change.** The same tags, emitted at runtime from a declared manifest. A
one-shot names the capabilities it wants; a loader resolves them to a script
list in dependency order and injects it. `dev.html:26-35`'s `injectSequential`
already proves the mechanism — it is 12 lines and it works today.

This is **not bundling.** No build step, no toolchain; the tags are still tags
and the deploy is still a push. What changes is who writes the list.

Candidate bundles, drawn along the seams §0.5 measured:

| bundle | what it buys | rough source |
|---|---|---|
| `kernel` | renderer, scene, loop, seed, config, quality, batch | `core/` minus packages/mission/profile/farcull |
| `player` | character rig, camera, physics, input, touch | `entities/character.js`, `systems/camera·physics·touch` |
| `combat` | 15 weapons + optics, fpsmode, impactbus, gore, wounds, ragdoll | `weapons/`, `systems/fpsmode·impactbus·gore·wounds` |
| `people` | ped brain, poses, outfits, roles/ranks, interactions, killfeed | `entities/ai·poses`, `city/peds·level·factions·killfeed` |
| `hud` | feed, panels, prompts, map icons | `systems/hud`, `city/killfeed`, `systems/fullmap` |
| `water` · `weather` · `wild` · `vehicles` | as documented in engine-systems.md | `world/water_*`, `systems/weather`, `city/wildlife`, `city/vehicles` |
| `city` | the 262k-LOC world, as ONE optional bundle among others | `city/` |

The point of the table is the last row. **The city stops being the substrate
and becomes a dependency you may decline** — which is the entire architectural
claim, expressed as a manifest line.

**What it is worth.** A one-shot that declines `city` never enters
`cityWorldGeo`'s 39-builder unyielding loop (`city/worldmap.js:625`, 18.2 s of
the 21–31 s freeze) and never allocates the 442 MB heap. That is a bigger win
than slicing the build, and it is owed to nobody: `LOAD-NOTES.md`'s own
still-owed list item 1 calls slicing "a boot-path refactor, not a patch." A
manifest sidesteps the question for every game that isn't the city.

**Known hazard, already documented:** the inline block at `index.html:354` must
run before `config.js`. Phase 3 (§6) must preserve that ordering exactly.

---

## 2. SESSION — the thing modes have and packages don't

**Today.** A **mode** gets `{build, reset}` (`config.js:38`) plus — hardcoded
for exactly four ids in `systems/state.js` — a title-screen card you
deliberately choose (`index.html:108-111`), a world build, a full reset sweep,
and win/lose screens (`state.js:30-32`, `screens.survwin`/`survlose`). Title →
world → play → verdict → retry. That is a plot.

A **package** gets `{id, title, venue, build, update, api}`. There is no
`start`, no `end`, no `win`, no `lose`, no `retry`, no session, no eject. It is
a room that exists forever with a panel in it. `games/police.js` runs a
20-minute shift clock and four endings and never gets a moment where the game
announces it has begun.

Three consequences, all measured, all zero:

- **`ctx.mission` has zero adopters.** All nine packages
  (`grep -rn 'ctx\.mission' src/games/*.js` → no matches). The one facade that
  grants a HUD line, map waypoint, world beacon, phone card and payout —
  advertised at `core/packages.js:36-38` — is used by nobody. By
  `doctrine.md:137`'s own standard, it is prose.
- **Zero packages have any map presence.** `packages.js` registers none
  generically and no package registers its own. Nine games you can only find by
  walking into them.
- **`escape` is not even a registered mode.** Only `city`, `survival`,
  `gungame` call `CBZ.registerMode` (`city/mode.js:504`, `modes/survival.js:390`,
  `modes/gungame.js:887`). The prison's ~90-line reset is inlined in
  `state.js:75-165` — and it is still the best-loved of the four, which says
  the framing matters more than the contract.

**The change.** Promote `state.js`'s four-mode hardcode to `CBZ.session`: one
registry owning `{title card · choose · build · reset · play · verdict(win|lose)
· retry · exit}`. `core/mission.js`'s `onInterrupt` (`engine-systems.md:188`) is
already the one death/arrest/mode-exit sweeper and becomes the eject path — do
not grow a second one.

Because four things already run this lifecycle by hand, Phase 1 satisfies
`doctrine.md:135` ("ship with ≥3 real consumers migrated in the SAME change")
**before a single new game exists**. That is the cheapest proof of an API this
repo will ever get.

---

## 3. WORLD — gungame's five hooks, promoted

`modes/gungame.js:98-130` declares each borrowable map as:

```
{ label, small, ensure(), root(), floorAt(x,z), point() }
```

`ensure()` builds-or-adopts, `root()` is the visibility handle `state.js` toggles,
`floorAt` is the ground oracle, `point()` is a spawn. Five hooks, and they are
the reason gungame is 934 lines instead of 40,000. Its island entry is also the
one honest example of world *sharing* in the repo: it routes through
`CBZ.modes.survival.build()` so `surv.built` stays the single truth and two modes
can never build two islands (`gungame.js:112-118`).

**The change.** `CBZ.worlds.register(id, {…})` with those five hooks, shipping
a starter set — `flat` · `jail` · `island` · `interior(kind)` · `city`. A
one-shot declares `world: "jail"` and never builds a planet. gungame becomes
the first consumer with no behavior change.

This is also what makes the dual entrance possible: the *same* game file can
declare `world: "flat"` for its standalone HTML and `venue: {lotKind:"casino"}`
for its in-city mount. One file, two doors — you meet PRECINCT 13 from the
title screen *or* by walking into a precinct, and it is not written twice.

---

## 4. THE STARTER ASSETS — what a one-shot reaches for on day one

The owner's *"you have made a bunch of assets to start with"* is literal, and
this is the inventory. `docs/claude/engine-systems.md` is the authority for all
65; the grouping below is a reader's index, not a new list.

**People.** One ped with a real brain (`entities/ai.js`, 5,345 lines), a
wardrobe, poses (`entities/poses.js`), gunpoint hands-up, and ONE death funnel
(`cityKillPed` → `city/killfeed.js`, the only sanctioned HUD popup). On top of
it: roles and job titles (`cityRole`/`cityTitle`), declared orgs with ranks that
must unlock a **verb** (`city/factions.js`, `rankCan`/`rankHolder`), cover
identities that can be seen through and burned (`citySetCover`/`cityBurnCover`),
and uniforms as claims with four breakers (`cityDisguise`). Casting is
`ctx.npc(spec)` — never hand-roll a rig.

**Threat.** One predator FSM
(`predatorHunt`: cruise→scent→circle→bump→vanish→rush→seize→disengage) with an
anti-habituation menace gauge, `predatorPack` for surround behaviour,
`predatorKit` deriving ~20 radii/speeds from a species' own scale, seven seize
styles, and `predatorPose` animating **all 45 species** with no species table.
Humans hunt on the same brain.

**Guns.** 15 weapons (`weapons/weapon-data.js`) + optics + appearances, one FPS
system (`systems/fpsmode.js`), one impact bus, gore that knows air from water,
bite wounds, ragdoll pinning. gungame arms player and bot from **one row** of a
ladder table.

**World.** Sea level that moves as one signed offset every consumer already
reads (`waterSurgeSet`), swim/sink/breath/drown, boats that cannot be driven
onto land, weather that leaves ground water and snow on the terrain, the
disaster roster (`systems/disasters.js`, 3,943 lines: quake · tsunami · tornado
· lightning · wildfire · volcano · blizzard · meteor · sinkhole · nuke), biomes,
forest look, terrain whose drawn surface matches its physics floor to 0.0002 m.

**Places and things.** `cityMakeBuilding` and the `civic()` path, the furniture
kit with propuse seats/beds, interiors that are searchable, roads that know
their limits and who may use them, luminaires, map icons, venues declared as a
building with one number.

**Systems a game gets free.** Money (`ctx.wallet` → real city cash),
interactions (`interactions.js`, 18 adopters), missions
(`core/mission.js` — one call buys detection, HUD line, waypoint, beacon, phone
card, payout), determinism (`hash01`/`seedStream`), touch controls, save.

**Media.** 353 audio files (178 m4a / 149 ogg / 25 mp3), car models, sky,
textures — 19 MB of audio alone.

**Six finished short books already written.** `games/casino.html` ·
`ocean.html` · `police.html` · `airport.html` · `racing.html` · `boxing.html`,
790–2,171 lines each, complete arcs, self-contained. `GAMES-FIRST.md:88-90`
demoted them to "design references" and `index.html` links to none of them.
They are the regression corpus for §5 and, several of them, the fastest path to
one-shot #2.

---

## 5. CONSISTENCY — a template that runs and a gate with a budget

Ease is §1–3. Consistency is its own mechanism, and this repo has already
watched the prose-only version fail (`doctrine.md:139`: *in-file "RULE FOR NEW
CODE" comments demonstrably did nothing*).

1. **`games/_oneshot.html` must be a WORKING GAME, not a stub.**
   `src/games/_template.js` is a stub and nine authors still needed 800–1,800
   lines to find the shape. Copy-and-delete beats fill-in-the-blanks.
2. **`tools/oneshot-check.mjs` — one gate every one-shot passes**, asserting
   through the game's own `api` the way `tools/casino-check.mjs` already does:
   boots · reaches playable · reaches a verdict from a rigged state ·
   deterministic per seed · console clean against baseline.
3. **The gate carries a BUDGET, and the budget is the ratchet.** Requests to
   playable and ms to playable, pinned per game, may only go DOWN — exactly the
   `doctrine.md:141` ratchet form, with `CBZ.treeAudit()` as the template.
   Without this, one-shot #4 quietly re-grows 467 tags. Cell Block Z's measured
   4 requests / 1.07 s is the north star, not a fantasy: it is a number this
   repo has already hit.
4. **`CBZ.oneshotAudit()`** — games registered, games with a declared world,
   games with a verdict, games with map presence, games still requiring the
   `city` bundle, games declaring `stakes`/`carry`, and **cash-in / cash-out
   per game per playing hour** (§7.3b — a money printer must be a number, not a
   rumour). Measure it before pinning anything (`doctrine.md:200`: *an audit
   nobody has executed is not a measurement*).

---

## 6. STAGING — additive, flag-reverted, city-identical until the end

| phase | what | risk | proof it worked |
|---|---|---|---|
| **0** | `CBZ.oneshotAudit()` + budget gate. No behavior change. | none | numbers exist |
| **1** | **SESSION.** Extract `state.js`'s 4-mode hardcode to `CBZ.session`; re-express city · escape · survival · gungame through it. | medium — `state.js` is the boot path | 4 consumers migrated, all four modes byte-identical |
| **1.5** | **CHARACTER.** Lift `worldstate.js` + `origins.js` out of `city/`; declare `stakes` / `carry` (§7.3). No new fields, no new storage key. | low | escape mode spends real cash instead of cigarettes |
| **2** | **WORLD.** Promote gungame's `MAPS` to `CBZ.worlds`; register `flat`/`jail`/`island`/`city`. gungame is consumer #1, unchanged. | low | gungame plays identically on both maps |
| **3** | **BOOT.** Emit index.html's 467 tags from a manifest. index.html declares everything, so nothing changes. Preserve `index.html:354` ordering. | **highest** | byte-identical tag list, MATHGATE ok |
| **4** | **First one-shot.** Re-ship ONE existing game — police is the candidate: it has both a standalone reference and a package. | low (additive file) | requests · ms-to-playable · LOC, all three against the package |
| **5** | The other eight, plus the dual entrance (§3) so each is reachable from the title screen AND in the city, from one file. | low, repetitive | audit counts climb |

Phases 1–3 ship **zero new games** and that is deliberate: they migrate things
that already work, which is the only kind of API proof `doctrine.md` accepts.
Phase 4 is the first moment the thesis is falsifiable — if PRECINCT 13 as a
one-shot is not dramatically cheaper to boot and no easier to read than
`games/police.js`, the boundary is drawn in the wrong place and §1–3 should be
re-argued before Phase 5 multiplies it by eight.

---

## 7. THE CHARACTER — one person across every game

Owner: *"all the games can share one character. It's a level and role. And
money."*

This is the fourth service, and it is the one that makes a LIBRARY out of a
shelf of unrelated short books: the books share a protagonist, so a race purse
buys the bribe that gets your boy out of PRECINCT 13. The 450-chapter book
never gave you that either — the nine packages already run on city cash and it
reads as nothing, because there is no second place to spend it.

### 7.1 It is already built. It is just called `city`.

- **The ledger** — `city/worldstate.js`, localStorage key `CBZ_CITY_WORLD_V2`.
  A full character sheet, ~40 fields: `cash · bank · debt · respect ·
  inventory · weapons · currentWeapon · meleeWeapon · cityLoans ·
  cityPawnTickets · cityOutfit · cityFenceRep · cityHome · cityRentTier ·
  cityGarage · cityOwnsPenthouse · cityOwnsHeli · cityOwnsHangar · playerGang ·
  cityMembership · campaign · assets · injuries · criminalRecord · jailHistory ·
  reputation · records · races · fights · betting · casino · hitman · transport ·
  politics · identities` + per-faction standing.
- **The vault** — `city/origins.js` is already a THREE-PROTAGONIST character
  system: `CBZ.citySwitchLedger(id)` parks the active ledger and activates
  another (parked copies in `CBZ_CITY_CHARS_V1`), each with its own last
  position and home spawn, each playing its origin scene only the first time
  that character is ever started. The multi-character problem is solved; it
  just has "city" in the name.
- **LEVEL IS DERIVED, NEVER STORED.** `playerLevel()` (`city/level.js:176-206`)
  = net worth + the gun on your hip + kills + crew + gang rank (or +35 if you
  run your own set) + respect + wanted stars + bounty. **Every input is already
  in the ledger.** Share the ledger and the level shares itself. There is no XP
  bar to build, and building one would be exactly the stat fiction
  `doctrine.md:208` bans — `level.js`'s own `MIL_NAME` was deleted for being
  eight rungs that unlocked nothing.
- **ROLE is already three-layered and already portable.** TRUE role (what the
  sim acts on) vs PRESENTED role (what an observer is entitled to see) vs COVER
  (`cityTrueRole` / `cityTitle` / `citySetCover` / `cityBurnCover`), plus org +
  rank through `factions.declare` where every rung must unlock a verb. **A
  one-shot's role — inmate · jailor · diver · shark · fighter · bettor — is an
  org membership, not a mode flag.** That is the machinery `GAMES-FIRST.md:117-120`
  wanted for two-sided games and never wired.

### 7.2 The modes cannot reach any of it, and the proof is cigarettes

`modes/survival.js`, `modes/gungame.js` and `systems/capture.js` contain **zero**
references to `worldstate`, `g.cash`, `CBZ.city.spend` or `cityLevel`. Escape
mode runs its whole economy on `g.cigs` (`systems/state.js:89`) — a private
currency it invented because the wallet is behind a `city` prefix. Of the files
touching `cityWorldCommit`/`cityWorldCollect`, **40 are in `src/city/`**.

So the work is §1's bundle boundary applied to the ledger: **it moves into the
kernel and the city becomes its biggest consumer instead of its owner.**
`ctx.wallet` (already real city money, already the casino's cage) becomes the
one wallet. `CBZ.citySwitchLedger` becomes `CBZ.character.switch`. No new
storage format, no migration of saved games — the key and the shape do not
change.

### 7.3 Three decisions this forces, and they are the owner's

**(a) STAKES — what may a game take from you?** `CITY_PERMADEATH` defaults TRUE
(`city/death.js:301`): a brutal death is GAME OVER **plus a save wipe**. Share
one character across every game and a headshot in the gun game deletes your
city kingpin. That is either the best idea in this design or a catastrophe, and
it cannot be left to fall out of load order. The one-line contract that settles
it: **a game declares what it can take.**

```
stakes: { cash: true, life: false }
```

A boxing match, a race and a casino night are SANCTIONED — they take your money
and never your life. The street, the jail and the gun game are REAL. One field,
honest on the title card ("this one can kill you for good"), and it is the
doctrine's own asymmetric-reward grammar pointed at risk instead of reward.

**(b) ECONOMY — one wallet means one balance sheet.** The moment casino
payouts, jail bribes and race purses draw on one account, every game's numbers
are priced against every other game's. The repo already half-knows this:
`ctx.wallet` is real city cash and the casino's shark fronts chips against a
marker the cage collects first. Cheapest guard, and it needs no design meeting:
the ledger owns cash, a game may move it **only** through `ctx.wallet`, and the
§5 gate reports **cash-in / cash-out per game per playing hour**. A money
printer then shows up as a number instead of as a rumour. Pin it as a ratchet.

**(c) CARRY-IN — what walks through the door with you.** A shared character
arrives armed, rich and famous, which un-games most short games: PRECINCT 13's
bail is pocket change to a kingpin and Cell Block Z is trivial if you spawn
with an AK. The answer already exists and needs no new system — arrest is the
one sanctioned "your stuff is taken" mechanic and `CBZ.cityBust` already
confiscates. So a one-shot declares a carry policy:

```
carry: "all" | "person" | "none"
```

`person` = cash and clothes, not the arsenal — which is exactly what a jail
intake is. And because level is DERIVED, your level then reads honestly lower
inside the jail without anyone writing a single line to lower it. **That is the
system working, not a bug to patch** — and it is the strongest argument that
§7.1's derived-level design was right.

### 7.4 Where it lands in the staging

The character is **Phase 1.5** — after SESSION (§2, which gives a game a
start and an end for the ledger to be committed at) and before WORLD (§3).
It is the smallest phase in this document: no new storage, no new fields, no
new UI. It is `city/worldstate.js` and `city/origins.js` moving up one level
and losing a prefix, plus the three declarations in §7.3.

---

## 8. WHAT THIS CONTRADICTS, ON PURPOSE

`GAMES-FIRST.md:111-115` says: *"What blocks that today is the one-shot shape:
the jail mode and disaster mode are entire simulations you enter once, not games
ON the sim"* — and prescribes folding jail and disaster **into** the city as
role packages.

That is the opposite of this document, and the disagreement should be settled
rather than left for the next reader to trip over. The evidence favours the
one-shot: the three things the owner rates highest are the three that own a
session, and the cheapest game ever shipped here (gungame, 934 lines) got that
way by **borrowing a world it did not build** — not by mounting inside one.

`GAMES-FIRST.md`'s other claim survives intact and is load-bearing here:
*standalone-first fails for shipping — build seven venues that way and you get
seven renderers, seven input systems, seven NPC rigs, seven wallets.* Correct,
and §1's manifest is precisely what prevents it. A one-shot HTML in this design
**forks nothing**: it declares bundles and calls the same `CBZ` every other game
calls. The single file is the *game*, never the engine.
