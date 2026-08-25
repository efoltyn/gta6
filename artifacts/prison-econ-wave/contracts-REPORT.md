# The contract layer — the yard's own debts become your errands

**Flag:** `CBZ.CONFIG.PRISON_CONTRACTS` (declared `src/entities/ai.js:115`, defaults `true`).
`?cfg_PRISON_CONTRACTS=0` gives the exact pre-wave prison — no tabs are minted, no
claim ever ripens, the two new approach kinds are never started, and the card falls
back to the befriend/squash/join/trade head slot it had before.

**Files touched (only these three, plus one new preset):**
`src/entities/ai.js` · `src/systems/interact.js` · `src/systems/quests.js` ·
`tools/visual-presets/prison-contracts.mjs` (new)

---

## What shipped

### 1. NPC↔NPC tabs — a pairwise ledger the yard keeps on itself

The prison already remembered who had swung at who (`_beef`). It remembered nothing
about who owed who. Every debt in the game ran between the PLAYER and a gang — a
number with no face and no reason — so the block's economy had no interior.

`n._tabs = [{ who, amt, why, t }]` on the **creditor**: `who` owes `n` `amt` cigs for
`why`, and `t` is how long it has sat. Mirrors the beef helpers one for one.

| thing | where |
|---|---|
| `tabList / tabWith / addTab / clearTab / payTab` | `ai.js:3364-3404` |
| `fadeTabs` (ages `t`, decays `amt`) | `ai.js:3406` |
| `mintTab(n, p)` — booked at the socialize exchange | `ai.js:3425`, called `ai.js:5343` |
| `fadeTabs` in the per-NPC think | `ai.js:4755` |

Minting hangs off the **same socialize exchange that already books gossip and
arguments**, so debts are made in front of the player, at chow and yard/work blocks,
by greed-weighted pairs — not on a background timer. `TAB_MIN/TAB_MAX = 2/12`,
`TAB_FADE = 0.0022` cigs/s (a tenth of `BEEF_FADE` — a punch is forgotten in minutes,
a debt is not), `TAB_RIPE = 95 s`, `TAB_DEAD = 900 s`.

`why` is drawn from a pool of things you can point at — "store day", "the domino
game", "two soups", "a phone card" — and it is load-bearing: the creditor says it out
loud.

**Measured in a live capture run:** after ~30 s of unattended sim the yard held **8
tabs across 8 holders, average 7.2 cigs** (`CBZ.prisonContract.audit()`). The ledger
fills itself.

### 2. Contracts — three kinds, offered through the existing machinery

Two new approach kinds, both in `OFFER_STANDS` (`ai.js:1080` — `contract: 180`,
`debtorDodge: 120`) so they persist when the player walks away and re-open in words
that show the man remembers asking.

- **collect** — bring back the amount
- **repo** — lift a NAMED item off the debtor
- **roughUp** — put him down

The kind is read off the two men, not rolled blind (`pickContractKind`, `ai.js:3492`):
a repo only exists if the item is **actually in his live loadout**; a rough-up wants a
creditor with nerve and a grievance; everyone else wants their cigarettes.

The pitch (`contractPitch`, `ai.js:3546`) names the man, the amount/item, the why, the
place and the cut, in clipped sentences:

> *"Dice is into me for 9 since store day. He posts up at the Blues' corner. Bring it, keep 4."*

The **place is derived truthfully** (`placeFor`, `ai.js:3455`) from the debtor's own
wander box — `n._dayRegion || n.region` (the `_dayRegion` fallback matters: a count
temporarily shrinks `region` to a 2.2 m muster box) — through the prison's own
`nearestLandmark` list, then given the verb the current schedule block makes true
("He eats at the far tables" at mess, "He's locked on his tier" at night).

Offered from two surfaces:
- **approach** — `considerPlayerApproach` (`ai.js:2358`), ranked above the block-rumour
  reads because a debt with a name and a date beats a half-heard rumour;
- **Talk** — `quests.js:192`, ahead of the generated favour, because a real claim is a
  truer answer to "what do you need" than an invented one.

### 3. Physical execution — no new buttons on the debtor

**Cornering** (`considerCornered`, `ai.js:3740`; `startDodge`, `ai.js:3721`) fires when
the player gets inside 3.2 m of the contract's debtor. It sits **above** the 4.5 m
floor every other approach obeys — that floor exists so people don't spawn
conversations in your face; this is the opposite, you walked up to him.

He counters with what is **actually in his pocket** (economy.js's loadout, not a
number invented here) and a day for the rest:

> *"This about the 9? I got 6 on me. Thursday for the rest."*

Menu is `["accept", "threaten", "refuse"]`, dropping to two when his pockets are
empty. Accept drains his real `load.cigs`. Threaten wins → the rest of his pocket, he
flees, grudge booked; threaten loses → `huntPlayer` + `provokeGang`.

**Repo** is a targeted lift (`contractLift`, `ai.js:3759`) on the same accessors
`steal()` uses (`rollLoadout`'s live items array, `stealOdds`, `addItem`,
`announceLoot`), so a repo and a pickpocket are the same hand in the same pocket at
the same odds. **It reuses the STEAL verb that is already on every card** — `econ.steal`
is wrapped so that when a repo is live on that man, the named object is what comes out.

**RoughUp** completes on any knockdown from any system — `CBZ.killstreakOnDown` wrapped
with the `prisonfriends.js` `wrapDown` pattern.

Three wraps, all armed lazily from the tick because killstreaks/economy/intimidate all
load after ai.js (`ensureContractWraps`, `ai.js:3825`):
`CBZ.killstreakOnDown` · `CBZ.econ.steal` · `CBZ.prisonRobTarget`.

A collection banks only what came **off that man** — pickpocket, gunpoint rob, or the
partial he handed over. Cigarettes you already had can never satisfy it, which is the
whole point of the layer.

### 4. Proof + payout

`settleContract` (`ai.js:3882`). The head slot becomes **SETTLE** with a chip counting
what you actually pulled (`9 of 9`), the note line says `settle up: 9 of 9 off Dice`,
and pressing it is him counting it in front of you. A short collection is not a
failure — he takes what came back, says so, and the remainder stays on his ledger.

Payout: your cut stays in your pocket (you hand over `brought - cut`), plus
`econ.addRespect(creditor, 8 | 4)`, trust, gang standing, `addBuzz("debt")`, and
`rippleApproach(…, "paid")` so the block clocks it. The debtor books
`playerGrudge` + `grudgeWhy` ("the collection" / "you lifting my Radio" / "the beating
you took for somebody else") and his crew hears via `noteGangIncident`.

### 5. The symmetry

`canWorkOff` (`ai.js:3646`) + `ripeCrewTab` (`ai.js:3613`) + the `"work"` action
(`ai.js:5588`). When the player's gang debt is bigger than his pocket (`WORKOFF_DEBT = 9`)
and the crew holds a ripe claim, the collector's middle button becomes **WORK**:

> *"You can't pay it, so work it. Dice owes us too. Go get ours and yours gets lighter."*

The claim may sit on any **crewmate's** ledger — that is literally the "us" in the line,
and it is also what makes the leg fire often enough to exist (a man holding his own ripe
claim pitches a `contract` instead, which is the first beat). The payout reduces gang
debt instead of paying cigs; `cut` is 0.

Wired into **all five** `debtCollect` sites (`ai.js:2381, 2572, 3081, 4302, 5145`) —
the first pass only covered two and a capture run promptly caught the gap by raising a
demand from the gang-threshold director with no WORK leg on it.

### 6. Findable targets

`isAnonymous / nameHim` (`ai.js:3345-3362`). Half the yard answers to the literal string
"an inmate", and "go collect nine off an inmate" is a riddle. At contract creation an
anonymous debtor is named from a small pool (`Half-Ear Danny`, `Two-Cent`,
`Preacher's Kid`, `Bobo`, `Gator`, `New York`, `Rayray`, …), skipping names already in
use, writing `n.data.name` + `n.data.tag`. Also called before the work-off line, since it
speaks a name aloud. Minimal on purpose.

> **Note for the orchestrator:** `n.tag` does not exist on prison NPCs. `npc.js` accepts
> `tagText`/`tagColor` in `makeNpc(opts)` and then **never copies them onto the actor**
> (`_tag` is a nulled sprite slot). Identity is `n.data.name` and nothing else. I wrote
> `n.data.tag` for anything that later wants it; nothing reads it today.

### 7. Card rules

Three buttons everywhere, by construction. `tools/interact-verbs-check.mjs`: **145
contexts checked, ok**, and every one of the 10 captured frames measured `verbCount 3`.

- head-slot ladder (`interact.js:610`): `settle` → `befriend` → `squash` → `collect` →
  `join` → `trade` → `insult`, ranked by how fleeting the thing is. SETTLE goes above
  even an offered hand: you are standing there holding his money and it stops being true
  the moment you press it.
- approach menus (`interact.js:496-508`): `contract` → `accept/haggle/refuse`;
  `debtorDodge` → `accept/threaten/refuse` (or two when he is broke);
  `debtCollect` + work-off → `pay/work/refuse`.
- `panelNote` carries the contract summary (`interact.js:409`), ranked under live speech
  and over the ledger reads.
- HAGGLE on a contract argues about **your cut**, not a price (`ai.js:6084`) — the generic
  haggle bails on `cost <= 1` and could never reach it.

---

## Captures

`artifacts/prison-econ-wave/contracts/` — `report.html`, `before-after.pdf`,
`shots/before/`, `shots/after/`, `metadata.json`.

```
node tools/visual-compare.mjs --preset prison-contracts \
  --before local --before-params "cfg_PRISON_CONTRACTS=0" \
  --out artifacts/prison-econ-wave/contracts --keep-going
```

Both sides serve **this checkout** and differ only by the flag. 5 subjects × 2 frames
(laptop, ipad-mini landscape) × 2 sides = 20 shots.

| subject | before | after |
|---|---|---|
| `creditor-pitch` | `Trade / Talk / Steal`, silence | `Accept / Haggle / Refuse` + *"Dice is into me for 9 since store day. He posts up at the Blues' corner. Bring it, keep 4."* |
| `debtor-cornered` | generic card, silence | `Accept / Threaten / Refuse` + *"Alright. Here's the 9. Tell him we're done."*, note `Dice: 9 on him, the rest later` |
| `settle-row` | `Trade / Talk / Steal` | `Settle · 9 of 9 / Talk / Steal`, note `settle up: 9 of 9 off Dice` |
| `settle-paid` | — | *"All of it. He say anything?"* (row correctly spent) |
| `workoff` | `Pay 3 / Haggle / Refuse` | `Pay 3 / Work · off the tab / Refuse` + *"Mack says the Reds want 3 cigs — or a collection run."* |

Metrics, before → after, worst case across both frames:

| metric | before | after |
|---|---|---|
| contract row on the card | 0/10 frames | 8/10 (the 2 zeros are `settle-paid`, where the row is correctly spent) |
| words a present man says | 0-46 chars | 27-90 chars |
| debtor named on screen | 2/10 | 6/10 |
| options on screen | 3 | 3 (owner's law held) |

**How each shot was staged** (`stage()` in the preset). One boot per side; `Math.random`
pinned to an LCG and `CBZ.econ.reseed()` called so every roll the preset can touch is
deterministic; `requestAnimationFrame` frozen and the world advanced with `CBZ.stepSim`.
Each subject then: `resetYard()` (null every `_tabs`, clear approaches, reset cigs) →
park Dice 6 m from Mack → `CT.seed(creditor, debtor, {amt: 9, why: "store day"})` (books
the same row `mintTab` books, already aged past `TAB_RIPE`, because no capture can wait
95 s) → `hushOthers()` → `standAt()` → `clearRoom()` → step → measure. The work-off beat
instead seeds the tab on **Red Hook** so Mack has only a crew claim, pins the player broke
and 22 in the Reds' book, and waits 8 m out for him to come over.

With the flag off every one of those staging calls no-ops behind `contractsOn()`, so the
BEFORE side is the untouched prison answering the same five moments.

---

## Tool friction (`tools/visual-compare.mjs`)

Every one of these cost a rerun.

1. **`preset.beforeParams` and `--before-params` take incompatible shapes, and the
   mismatch is silent.** The CLI flag takes `"k=v&k2=v2"` (parsed by `parseParamString`);
   the preset field is read with `Object.entries(...)` and so wants `{ k: v }`. Handing it
   the string form spreads it **character by character** into the query —
   `?0=c&1=f&2=g&3=_&4=P&…&21=0` — 22 junk params, no warning. My first run only worked
   because the CLI flag happened to be passed as well. **Fix:** accept a string in
   `beforeParams`/`afterParams` by routing it through `parseParamString`, or throw when
   the value is not a plain object.

2. **No affordance for "the two sides must frame the same subject."** The tool pairs
   shots by subject id and captions them, but nothing checks the pair actually
   photographed the same thing. Two separate runs of mine came back as clean-looking
   pairs where the BEFORE side had the card open on a different NPC — once because
   `nearest()` prefers an actor with a live approach (which only exists on the AFTER
   side), once because a bystander drifted inside the radius during a settle step. Both
   were only caught by dumping `metadata.json` by hand. **Fix:** let a preset return a
   `subjectKey` (a string) and have the report flag pairs whose keys differ.

3. **Metrics are frozen into `metadata.json` at capture time, so a metric bug costs a
   full recapture.** `--print-only` re-renders the report from stored metrics but cannot
   recompute them. My `contractRow` regex used a trailing `\b` and scored 0 on the tablet
   frames, whose rail concatenates label and chip with no separator (`"SETTLE9 of 9"`,
   `"WORKoff the tab"`). Correct pixels, wrong number, ~7 minutes to fix. **Fix:** store
   the raw stage payload (it already is stored) and let `--print-only` re-run a preset's
   `metrics` reducer over it.

4. **`--subjects` writes a fresh report rather than patching one.** Iterating on a single
   flaky subject means either a throwaway `--out` dir or re-shooting all subjects to
   refresh the real one. `--reuse-before` covers half of this; there is no
   `--reuse-after`/`--patch-subjects`.

5. **Stage timeouts and machine load are indistinguishable in the output.** A subject
   whose staging loop simply never met its condition prints the same as one that
   succeeded — the run is "complete" and the flaw is a picture of something else. A
   preset returning `{ok: true}` with an unmet precondition has no way to say
   "captured, but not the beat I wanted". **Fix:** honour a `warn` field on the stage
   return and surface it on the report card.

6. Minor: `--help` documents `--frames a:landscape,b:portrait` but a fixed frame is just
   `laptop` with no orientation — worth one word in the help text.

### Game-side traps this run exposed (all fixed, but worth knowing)

- **`autoListen` is not a mouth for an offer raised in place.** `interact.js` speaks an
  approach's long pitch only when the *focused actor changes*. Every way a contract is
  actually offered happens while the player is already stood at the man's open card, so
  the pitch would have been silent. `offerContract`/`startDodge` therefore speak for
  themselves and set `greeted` (`ai.js:3673`, `ai.js:3721`).
- **The same gap hides `debtCollect`'s long answer.** A collector who has reached you has
  `greeted` set by `approachPlayer`'s greet block, so `resolveNpcApproach(n,"listen")` —
  where the "you can't pay it, so work it" line lives — is skipped. Fixed by putting the
  offer into his **short opener** too (`approachText`, `ai.js:1453`).
- **`alive()` reads a knocked-out man as not-alive.** Using it to expire tabs would have
  had every brawl in the yard quietly erase the loser's debts. Tabs use `ledgerGone()` —
  dead or escaped only (`ai.js:3399`).
- One live contract at a time needed an escape hatch, or a player who takes a job and
  never does it blocks every future offer forever. `updateContracts` drops it after 600 s
  with a line: *"Forget it. I sent somebody else."* (`ai.js:3944`).

---

## Seams for the orchestrator

1. **`economy.js` wants `steal(actor, { want })`.** `liftBest` takes the most *valuable*
   thing in the pockets, which on a repo hands you his shiv and leaves the radio you were
   sent for; `steal()` takes no options. I implemented the targeted lift in `ai.js` on the
   same accessors and wrapped `econ.steal` to route to it. The clean version is a `want`
   parameter threaded into `liftBest` — noted in the comment at `ai.js:3750`.
2. **Three global wraps** (`killstreakOnDown`, `econ.steal`, `prisonRobTarget`) armed
   lazily from `updateContracts`. `prisonfriends.js` wraps two of the same functions with
   its own `_pfWrapped` marker; mine uses `_contractWrapped` and chains, so order is safe
   either way — but if a third wave adds a fourth wrap, this is the place it will collide.
3. **`intimidate.js`** — the gunpoint rob is credited by snapshotting `CBZ.game.cigs`
   around `prisonRobTarget`, because it returns `undefined`. Having it return
   `{ cigs, items }` would remove the snapshot.
4. **Naming the crowd.** `nameHim` is deliberately minimal (10 names, contract-time only).
   A real naming wave should own `npc.js`'s dead `tagText`/`tagColor` options at the same
   time.
5. **`CBZ.prisonContract.audit()`** is the console line for this layer:
   `{on, tabs, ripe, holders, avgTab, live}`. Nothing pins it in `math-gate` yet; it is a
   play-time counter, so `tools/prison-polish-check.mjs` is the right home if you want a
   ratchet.

## Open edges

- **`repo` and `roughUp` have no capture.** The preset forces `collect` for all five
  beats so the pair is comparable; both other kinds are exercised by code but not
  photographed. A follow-up run with `CT.offer(n, null, "repo")` would cover the named
  lift and the steal-chip.
- **The debtor's reverse-offer does not yet reach the gunpoint path.** `intimidate.js`
  outranks every approach kind (correctly — a drawn gun outranks a conversation), and
  `considerCornered` bails on `intimidMode === "scared"`. Robbing him at gunpoint credits
  the contract, but he never gets to make his excuse first.
- **`workOffAvailable` walks the roster** on each `debtCollect` approach and `canWorkOff`
  memoises for 900 ms. Cheap, but if the crowd grows it wants a per-gang index.
- **Partial collections leave the remainder on the ledger and the contract closed.** That
  is deliberate (the tab is what survives a bad collection) but it means there is no
  "go back and finish it" — the claim just has to ripen again.
