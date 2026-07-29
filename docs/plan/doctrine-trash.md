# doctrine-trash.md — the census of code that does not answer "why"

**Measured 2026-07-29.** Every claim below carries `file:line`. Where a number
disagrees with CLAUDE.md's RATCHET BASELINES table, the number here is the one
that was counted; CLAUDE.md's own lesson applies — *"An audit nobody has
executed is not a measurement."*

Owner's ask, verbatim: *"there's so much code that doesn't answer our why. Find
all the trash code and read it all and analyze and make a plan to take the good
ideas, fully build the great cool ones, and delete the shit ones, and combine."*

Owner's statement of what the game IS, which is the ruler everything below is
measured against: *"get enough people recruited, or get enough money, or enough
guns, or somehow get key cards and access and everything, to get to the nuke —
and then use it, or become president, or hold the nation hostage, or join an
org, or sell the nuke."*

---

## 0. THE HEADLINE

**The apex prize of the entire game stood behind an unlocked door.** The one
nuclear stash in the world (`city/bunkers.js:775`, `vaultTokens.push`) sat in a
vault chamber whose door was pushed to `doorTokens` (`bunkers.js:682`) with the
*same ungated `[E]` verb as a supply cupboard* (`bunkers.js:307-315`). No key,
no rank, no crew, no cost. Any player who walked into Fort Brandt on hour one
took it. Everything the owner describes — recruiting people, raising money,
buying guns, stealing keycards — was **optional**, because the thing all of it
was supposed to be *for* was free.

That is not a missing feature. It is the absence of the gradient CLAUDE.md's
LAW 1 is entirely about, and it is fixed in this wave (§B2 below).

---

## 1. DEAD CODE — measured

### 1.1 THE DEAD SIM CLUSTER — 1,402 LOC, zero gameplay readers

| file | lines | live external callers | verdict |
|---|---|---|---|
| `src/sim/hyperinflation.js` | 1045 | **NONE outside `src/sim/`.** Only `sim/inflation.js:455,457` → `counterfeitPressure()` | **DEAD-API** |
| `src/sim/currency.js` | 357 | **NONE outside `src/sim/`.** Only `forex.js` (7 sites) + `hyperinflation.js` (10) | **DEAD-API** |

- `counterfeit(id)` / `counterfeitOffer(id)` — `hyperinflation.js:804,810` — a
  complete, tuned cash-injection mechanic with **zero call sites in the entire
  repo**. No UI, no prompt, no `cityMenuOpen` hook, no keydown, no wrap.
  Verified: `grep -rn "counterfeit(" src/ | grep -v hyperinflation` → **0**.
  Consequence: `inflation.js:455`'s `counterfeitPressure()` is *structurally*
  always zero.
- The whole read API — `stageOf`, `summary`, `endingsOf`, `sorosOf`,
  `isDollarized` — has no reader. There is no panel, no phone tab, no HUD line.
  The module is **write-only**: it self-drives off `onNewDay` (`:902`) and
  pushes effects out through `cityFeed`/`approvalShock`/`forex.shock`, so the
  player experiences consequences he can never see the cause of.
- `currency.js`'s multi-currency wallet (`g.cityWallet` / `g.cityBankWallet`)
  is written and persisted and **never spent**: no file outside `src/sim/`
  touches either field.

**VERDICT: COMBINE, then DELETE the remainder.** The economics are genuinely
good and they FAIL THE ROME TEST in the most instructive way — a Roman package
wants inflation, debasement and counterfeiting; it does not want `forex.js`'s
airport FX kiosk. The salvage is `counterfeit()` (real money from a real crime,
which *is* a loyalty-ledger input) wired to a physical press somewhere. The rest
— dollarization endings, Soros runs, redenomination — is 1,400 lines of
consequence with no cause the player can touch, and should go.
**Not executed this wave** (out of one agent's honest reach); this is the
single largest deletion still owed.

### 1.2 `core/interfaces.js` — 316 lines, ZERO references anywhere — **DONE**

`CBZ.INTERFACES` (`interfaces.js:295`) is a list of 16 strings read by nothing
in `src/`, `index.html`, `tools/` or `docs/`. The file implements nothing and
executes nothing. CLAUDE.md names it as the canonical failed block ("shipped
July 1-2, zero adopters").
**ACTION TAKEN: unhooked from `index.html:342`; file kept in place** because
eight comments across the repo cite it by name and line (`building.js:46,604`,
`sim/currency.js:113,284`, `pieces.js:11,16,120`, `physics.js:328`) and moving
it would make all eight stale to save nothing. It is now a reference document
that is deliberately not a script.

### 1.3 `g.cityPhoneTier` — a paid upgrade that does nothing — **DELETED**

Four sites, all in `shops.js` (`:464` sell row, `:719` price, `:722` cap,
`:724` write). Read by **nothing else in 264k lines**. It sold four tiers at
$250/$600/$950/$1300 promising *"better deals & street intel"*.
**ACTION TAKEN: flag and its storefront row both deleted.** Killing a stat
fiction while leaving the shop row that advertises it just hides the lie.

### 1.4 `/me` `/do` `/ooc` — three styled render paths, permanently unreachable — **BUILT**

`netui.js:153-156` renders three roleplay modes off `m.kind`, three CSS classes
exist, and the input placeholder (`netui.js:128`) advertises five commands.
`net.js:71`'s `net.chat` sent `{t:"chat", text}` **flat** and no slash parse
existed anywhere in the repo. Verified: `grep -rn "kind" src/net/net.js` → 0
chat hits.
**ACTION TAKEN: BUILT rather than deleted** — the rendering half was already
written and good, so the fix was the missing 20-line parse, placed in `net.js`
(not `netui.js`) because `net.chat` is the one call every client entry point
routes through. `/players` and `/help` are answered locally off state `net.js`
already holds.

### 1.5 `"communism"` / `"fascism"` govTypes — **BUILT (given a producer)**

**NINE effect paths across six files** branch on these two values:
`regimes.js:277,296,530,679` · `polwar.js:184,195,519` · `civilwar.js:600` ·
`militia.js:338,345,362` · `sim/centralbank.js:221,242` · `market.js:94,111` ·
`stocks.js:326` · `migration.js:299,300,306` · `wanted.js:195`.

**No producer anywhere assigns either value.** Every `govType` write in the
repo, enumerated: `"democracy"` (`polity.js:165`), `"monarchy"`
(`countries.js:209`, `crown.js:573,619`), `"dictatorship"` (`regimes.js:635`),
`"emergencyRule"` (`crown.js:422`), `"anarchism"` (`civilwar.js:858`),
`"insurgency"`/`"juntaRebel"` (`civilwar.js:447`), `"dissolved"`
(`civilwar.js:745`). Complete, tuned effect code behind a door that could not
open.
**ACTION TAKEN: BUILT, not deleted.** The owner's LAW 2 names "become
president" and "hold the nation hostage" as endings, so what was missing was
never the effects — it was *somebody with the standing to order them*.
`CBZ.regimeDeclareDoctrine` (`regimes.js`) is the producer, gated on the
loyalty ledger's apex rung, reachable at the clerk's window
(`games/government.js`) when you hold a seat.

### 1.6 `systems/proptypes.js` — 2 of 4 exports dead

`registerPropType` and `spawnProp` have exactly one adopter each
(`entities/coins.js:24,93`). `removeProp` (`:150`) and `propInstances` (`:151`)
have **zero callers anywhere**. **VERDICT: leave; delete the two dead exports.**
Not executed — the file is 152 lines and the win is small.

### 1.7 Individually dead exports on live files

Zero callers anywhere: `CBZ.migrationReset` (`migration.js:899`) ·
`CBZ.crownReset` (`crown.js:717`) · `CBZ.polwarReset` (`polwar.js:745`) ·
`CBZ.civilwarReset` (`civilwar.js:976`) · `CBZ.regimesReset`
(`regimes.js:719`) · `CBZ.govReset` (`statecraft.js:1146`) · `CBZ.govAudit`
(`statecraft.js:1145`) · `CBZ.approvalReset` (`approval.js:555`).

**THIS IS A BUG, NOT DEAD CODE — and it is the most valuable finding in §1.**
`city/mode.js:575-702` is the fresh-run teardown and it calls ~20 resets.
`CBZ.relationsReset` is in that list (`mode.js:579`). **The other seven were
written to the same template and never wired.** So a new life inherits the
previous run's regime, its wars, its civil wars, its crown, its border policy,
its approval rating and its statecraft. Seven one-liners in a file this wave
does not own — filed as a seam patch.

### 1.8 `src/bootstrap.js` (211 lines)

Not in `index.html` at all; one importer (`integrations/grass.js:66`). Live
**only** on the Vite path, dead on the static-server path that is the actual
deploy. **VERDICT: leave, it is the build harness.** Listed so nobody
"discovers" it again.

### 1.9 CORRECTIONS to CLAUDE.md's dead-code claims

- **`sim/forex.js` `convert()` — CLAUDE.md says "zero callers". CONFIRMED
  ZERO** (`grep` for `forex.convert` outside the file → 0). But CLAUDE.md's
  framing ("the player can read four exchange rates and never act on them") is
  now **wrong for the file as a whole**: `forex.js:903-935` builds a real
  in-world FX kiosk with an `[E]` handler. `list()` and `reset()` have live
  callers (`phone.js:775`, `peds.js:1706`). The file is LIVE; the one function
  `convert()` is dead. Fix the claim, not the file.
- **`src/core/bootstrap.js` does not exist** — it is `src/bootstrap.js`.
- `sim/bonds.js` (932 lines) exists and was not in any list: its entire
  external surface is four sites in `phone.js:788,789,915,917`. Single-UI
  consumer, but genuinely reachable. **LIVE.**

---

## 2. DUPLICATION — recounted

### 2.1 THE POLITICAL TITLE LADDER — CLAUDE.md's "next migration owed"

**CLAUDE.md's file list is right; its characterisation is wrong.** It says
"hand-copied across EIGHT files". Measured: all 8 do carry a `kind → title`
block, but `officials.js:173-183` **already exports** the derivation as
`CBZ.officials.titleFor` (`officials.js:807`) and **four of the seven already
call it**, keeping theirs as a fallback. The real defect is narrower and worse:
**three files never called the owner at all, and four fallbacks DISAGREED with
it.**

| file:line | delegated? | monarchy branch | default |
|---|---|---|---|
| `officials.js:173-183` | **OWNER** | `Queen`/`King` by holder gender | `"Official"` |
| `officialdom.js:119-132` | yes | fallback `"Monarch"` ✗ | `"Official"` |
| `contracts.js:264-273` | **NO** | `King`/`Queen` from a *passed-in* ident | `"Official"` |
| `civic.js:199-210` | yes | agrees | `"Official"` |
| `statecraft.js:228-239` | **NO** | agrees | `"Official"` |
| `candidacy.js:221-228` | yes | fallback `"Monarch"` ✗ | `"Official"` |
| `elections.js:242-248` | **NO** | **none — returns `"President"`** ✗✗ | `"Official"` |
| `games/government.js:219-228` | yes | fallback `"Monarch"` ✗ | `"Councilmember"` ✗ |

Plus a **ninth partial copy**: the King/Queen rule again at `crown.js:412,433`.

**The disagreements, worst first:**
- **`elections.js:242` has no monarchy branch at all** and will announce a King
  as *"President"*. Its own comment asserts "monarchy never reaches here" —
  true only because of three separate `govType` guards (`:750`, `:875`, `:915`)
  that four call sites (`:576`, `:688`, `:896`, `:921`) do not share. *An
  invariant asserted in a comment is not enforced.*
- **`"Monarch"` is a title `officials.js` has never produced** (it returns
  Queen/King) — invented independently by three files.
- **`"Councilmember"`** as the null default in `games/government.js`, the only
  file in 264k lines using that word; every other copy says `"Official"`.
- **Two live salary tables for the same seat**: `civic.js:604` pays a mayor
  $900/day, `statecraft.js:157` pays $420.
- **Four different iteration orders** treated as seniority: ascending
  (`officialdom.js:87`, `candidacy.js:287`), federal/country swapped
  (`elections.js:255`, `militia.js:164`), descending (`government.js:233`).
- `elections.js:240`'s `KIND_TERM_DAYS` is a **verbatim duplicate** of
  `officials.js:171`.

**ACTION TAKEN (this wave):** `officials.js` now exports `termDaysFor` and
`jobFor` beside `titleFor`; `elections.js` and `statecraft.js` delegate;
`elections.js`'s fallback gained the monarchy branch it should always have had
and delegates `termDaysFor`; the three `"Monarch"` fallbacks and the
`"Councilmember"` default are corrected to agree with the owner.
**NOT DONE (outside territory):** `contracts.js:264` and `crown.js:412,433` —
filed as seam patches.

**CORRECTED CLAUDE.md wording:** *one exported owner
(`CBZ.officials.titleFor`), two files that still bypass it (`contracts.js`,
plus the partial copy in `crown.js`), and four defensive fallbacks that
disagreed on the monarchy and default branches — now three, one, and zero.*

### 2.2 "IS THIS PERSON YOURS" — FIVE registries, now READ by one ledger

This is the duplication that mattered most, because it is the spine the owner
just described and nothing had ever asked all five at once:

| registry | file:line |
|---|---|
| `g.playerGang.members[]` | `playergang.js:109,138-139`, exported `:112` |
| `ped.recruited` / `kind:"crew"` / `g.cityCrew` | `careers.js:1066-1084` |
| `g.cityPartner` | `social.js:617` |
| `ped._loyalty` / `_loyal` | `loyalty.js:240-245` |
| `ped.faction = "player-company"` | `warband.js:71` — **DELETED** |

`CBZ.cityPower()` (`loyalty.js`) reads all four survivors, dedupes by identity,
and **writes none of them** — `loyaltyAudit().mirrors` is structurally 0.

### 2.3 THE HANDS-UP WRITE — one grammar, four hand-typed copies

`peds.js:4708-4736` owns `markGunpoint` (exported `CBZ.cityMarkGunpoint`) and
it deliberately **refuses an armed ped** (`peds.js:4712`: *"armed peds draw +
aim back, never surrender"*) — correct for a mugging, wrong for a battle. So
every caller that needed an armed surrender re-typed the field set:
`gangops.js:410-415` (shakedown) · `protection.js:506` (bribed guard) ·
`scenedirector.js:415` · `warband.js:186-196`.
**ACTION TAKEN:** `CBZ.citySurrender` (`loyalty.js`) is the one write;
`gangops.js` and `protection.js` migrated with byte-identical inline fallbacks;
`warband.js` deleted. `scenedirector.js` is outside territory — seam patch.

### 2.4 Rows NOT recounted this wave — state honestly

CLAUDE.md's table also claims 52 buy/purchase transactions, 34 reputation
scalars, 32 AI update loops, 15 ownership containers, 10 buoyancy impls, 12
mission systems, 487 blocked propuse anchors. **I did not recount these** and
will not repeat them as if I had. One partial measurement: raw `.hp -=` /
health-field writes bypassing a bus now grep at **58** (CLAUDE.md says 52) —
the count went UP, and it is the row most worth a real audit next.

---

## 3. THE WHY TEST — one line per system, BUILD / COMBINE / DELETE

*Does it answer "why am I doing this", and does it survive the ROME TEST
(a total setting change)?*

| system | why? | Rome? | verdict |
|---|---|---|---|
| `city/loyalty.js` | **yes — it IS the why** | yes (people + guns are universal) | **BUILD FULLY** ← done this wave |
| `city/bunkers.js` vault | yes — the apex prize | yes (a locked room with the thing in it) | **BUILD** ← locked this wave |
| `city/factions.js` ranks-as-verbs | yes | yes | **BUILD ON** — the ledger's access strand reads it |
| `world/gunroom.js` | **yes — the owner's own archetype** | yes | **COMBINE** ← migrated to the shared lock |
| `games/warband.js` | **no as a package, yes as two rules** | the rules yes, the camp no | **DELETE + PROMOTE** ← done |
| `city/regimes.js` | yes (endings) | yes | **BUILD** ← given its producer |
| `sim/hyperinflation.js` | **no — no cause the player can touch** | partially | **DELETE most, salvage `counterfeit()`** |
| `sim/currency.js` | **no — a wallet nothing spends** | no | **DELETE** |
| `core/interfaces.js` | no — it is prose | n/a | **UNLOAD** ← done |
| `shops.js` phone tier | **no — pure fiction** | no | **DELETE** ← done |
| `net/netui.js` roleplay modes | yes (they are the social layer) | yes | **BUILD** ← done |
| `city/officials.js` + the 8 title copies | yes | yes | **COMBINE** ← 5 of 8 done |
| `sim/forex.js` | thin — a kiosk with one dead verb | no | **KEEP, delete `convert()`** |
| `sim/bonds.js` (932) | one phone tab | no | **at risk** — one consumer, by CLAUDE.md's own rule |
| `city/gangs.js` (3074) / `playergang.js` (1406) | yes — people | yes | **KEEP, feed the ledger** |

---

## 4. WHAT THIS WAVE BUILT

**B1 — the loyalty ledger** (`city/loyalty.js`, +~430 lines).
`CBZ.cityPower()` answers, at any instant, how many people are loyal to you,
how armed they are, what money you command and what access you hold — by
READING the four registries in §2.2, never mirroring one. Power is a SUM of
four independent strands, each capped at 1.5, because the owner's sentence is
an **OR**: enough people, *or* enough money, *or* enough guns, *or* enough
access. Reaching the apex needs about three of the four.

Six rungs, and **every rung is a verb that changes your CATEGORY**:

| rung | at | verb | what it actually does |
|---|---|---|---|
| alone | 0.00 | — | — |
| crew | 0.35 | `muster` | point every loyal armed body at one target |
| cell | 0.90 | `press` | outnumbered enemies **surrender** instead of dying |
| outfit | 1.80 | `ransom` · `siege` | a beaten enemy becomes a resource; strike consoles open |
| syndicate | 3.00 | `armory` | heavy ordnance opens |
| apex | 4.20 | `vault` · `doctrine` | **the nuclear vault opens**; a state you hold can be remade |

**B2 — the lock, and the gradient made visible.** `CBZ.cityLock(spec)` is one
line to adopt, replaces the condition the caller already wrote, and is
degrade-safe. Four routes through any door: the caller's own key (always wins),
an org rank or a uniform they believe, an item you carry, or simply enough
power to take it. **When it refuses, it names the cheapest route** — so the door
is the quest giver, which is LAW 1 exactly. Four consumers migrated in the same
change: the nuclear vault, the ordnance crate, the strike console
(`bunkers.js`) and **the prison armory** (`world/gunroom.js`) — the owner's own
keycard story, which is the archetype the law was written from.

**B3 — deletions and merges**: `warband.js` deleted and its two good rules
promoted; the phone tier deleted with its storefront; `/me /do /ooc` built;
`communism`/`fascism` given a producer; `interfaces.js` unloaded; the title
ladder consolidated 5 of 8 ways.

---

## 5. STILL OWED (honest list)

1. **`sim/hyperinflation.js` + `sim/currency.js`** — 1,402 LOC. Salvage
   `counterfeit()` onto a physical press; delete the rest.
2. **The seven unwired `*Reset` calls in `mode.js`** — a real bug: a new life
   inherits the last run's politics.
3. **`contracts.js:264` and `crown.js:412,433`** — the last two title copies.
4. **`scenedirector.js:415`** — the last hand-typed surrender.
5. **A ladder of gun rooms below the vault.** This wave built the LAW and
   locked the four doors that existed. It did not author new crafted rooms.
   CLAUDE.md: *"it should be the SPINE, not a one-off"* — the spine now has a
   lock grammar and one room at the top. The rooms between are the next wave.
6. **`propUseAudit().blocked = 487`** and the other un-recounted rows.
