# RECON — THE THREE ORPHAN GAMES AND GANG CITY

*Analysis + execution plan. NOTHING IN HERE IS BUILT YET. Read
`docs/claude/doctrine.md` (Block Law) and `docs/claude/engine-systems.md`
before executing any stage.*

**Owner's direction, verbatim (2026-08-06):**
> "In jail game, when you interact with a… there's this thing where NPCs will
> kinda spin you around. There's different fights in jail mode / in Gang City.
> There's different ways to punch, different reactions. Look at those two and
> understand them and understand how you could maybe wire in the jail game to
> use the interaction of Gang City more… And this is for all — really the jail
> game, [natural] disaster game, and gun game are disconnected from Gang City.
> And there's a lot of duplicitous code, code that was written for jail game,
> let's say, for punching. And the Gang City game has five times as much code
> for that same thing. And that's a common thread."

The "five times as much code" is not an exaggeration. It is measured in §3.
But the headline finding is **not** that there are two punch systems. It is
that there are **seven**, that the best-authored one can never touch a person,
and that all seven are separated by **one field name**.

---

## 0. METHOD + WHAT WAS READ

Read in full or in the relevant part: `systems/combat.js`, `city/combat.js`,
`systems/combat_iq.js`, `systems/grapple.js`, `systems/reactions.js`,
`systems/predator.js` (seize), `systems/capture.js`, `systems/intimidate.js`,
`systems/humancontact.js`, `systems/interact.js`, `systems/detection.js`,
`entities/ai.js`, `entities/npc.js`, `entities/guards.js`, `entities/poses.js`,
`entities/character.js` (fight layer), `city/interactions.js`, `city/restrain.js`,
`city/peds.js` (ped factory, kill/KO), `city/arena_fights.js`, `city/mode.js`,
`city/take.js`, `games/jail.js`, `games/boxing.js`, `modes/gungame.js`,
`modes/survival.js`, `systems/state.js`, plus `docs/claude/doctrine.md`,
`engine-systems.md`, and the `sessions.md` "UNIFICATION MAP" entry.

Every claim below carries a `file:line`. Where I first guessed wrong and the
code corrected me, the correction is in the text (see §1.6) — because the wrong
guess is the one a future wave would repeat.

---

## 1. THE TWO FIGHT SYSTEMS, UNDERSTOOD

### 1.1 The JAIL fight stack (mode `"escape"`, and — see §1.5 — mode `"gungame"`)

| file | what it owns | LOC |
|---|---|---|
| `systems/combat.js` | the WHOLE player melee | **303** (entire file) |
| `entities/ai.js` `exchangeBlows` / `down` | NPC-vs-NPC brawls | ~30 |
| `entities/ai.js` `huntPlayer` block (3512-3566) | NPC-vs-PLAYER assault | ~55 |
| `systems/capture.js` `tryCapture` | the guard subdue ladder | ~45 |
| `systems/intimidate.js` | gunpoint hands-up / draw / stand-off | 306 |
| `entities/npc.js` 192-202, `guards.js` | the death topple | ~12 |
| `entities/ai.js` `knockback` (5262) | **the entire jail impact model** | **6** |

**`systems/combat.js` in one paragraph.** `CBZ.punch(actor)` throws a swing,
schedules `pendingPunch`, and `landPunch` resolves it 0.15–0.19 s later on the
animation's drive frame. Combo counts up while you chain inside 980 ms; every
third hit is `heavy`; `kind` cycles `jab → cross → hook`. `maxHpOf` is a
two-branch literal — `140` for `kind === "guard"|"warden"`, `100` for everyone
else (`combat.js:20`). A block is a **flat 16 % dice roll**
(`CBZ.econ.rng() < 0.16`, `combat.js:226`) with no read, no tell and no
counter. A drop is an execute on `heavy || combo >= 3 || rng() < 0.35`.
Stamina is a private `0..1` float that nothing else in the game can see.
Target scan is `CBZ.guards` then `CBZ.npcs` (`combat.js:142-143`).

**What is genuinely good in the jail stack and must survive any merge:**
- `landPunch` resolving on the animation's **drive frame**, not on the click.
  `city/combat.js` resolves instantly. The jail's timing is the better feel and
  it is the thing to keep.
- `ai.js:3512-3566` (the `huntPlayer` block) is the **most modern combat code in
  the escape mode** and is the template for everything below: it squares up
  (`char.fightStance`), throws a real punch on the shared rig
  (`char.punchArm/punchKind/punchT`), lands damage through the mode's one entry
  (`CBZ.hurtPlayer`), and on the third blow **hands off to
  `CBZ.predatorSeize(style:"drag")`**. Its own comment states the doctrine:
  *"Nothing here is new machinery; four existing systems are being called by a
  file that used to write a string instead."* That paragraph is the spec for
  this whole plan.

### 1.2 The GANG CITY fight stack (mode `"city"`)

| file | what it owns | LOC |
|---|---|---|
| `city/combat.js` §melee (lines 46-518) | player melee: posture, guard, parry, finisher | **~470** |
| `systems/combat_iq.js` `IQ.melee` (779-880) | the NPC melee **brain** | ~100 |
| `city/restrain.js` | clinch → grapple → cuff → escort → seat → turn in | 777 |
| `city/arena_fights.js` `strike`/`tickRing` | the ring/cage bout sim | ~150 |
| `games/boxing.js` `RULES`/`PUNCH`/`stepFight` | the boxing sim | ~280 |
| `systems/grapple.js` `CBZ.body` | knockback / knockdown / fling / limb ragdoll | ~400 |
| `city/ragdoll.js` | the verlet corpse solver | 831 |

**`city/combat.js` in one paragraph.** LMB is a 3-hit chain
(`jab → cross → hook`), the 3rd is a knockdown finisher; RMB is a heavy;
**held** RMB is a guard, and a *freshly raised* guard is a 0.30 s **parry**
window that negates the blow and auto-ripostes. Underneath sits **POSTURE**
(Sekiro): every blow batters a foe's guard, `postureMax` is **derived** from
what they are (`maxHp`, `kind`, `armed`, `gang` rank, `aggr` — `combat.js:84-93`,
no magic table), and capping it is a **GUARD BREAK** that freezes their offense
and opens a one-shot deathblow. The player has posture too. `weaponFeel()`
derives `{post, kb, bleed, reach}` from the equipped item rather than a swing
constant. `land()` routes damage through the real city paths
(`cityHurtCop` / `cityKillPed` / `cityKOPed` / `cityWildlifeHit` /
`net.localMeleeHit`) and fires the world's reaction bus on the way out:
`reactPunch`, `cityGangProvoke`, `cityCrime`, `cityPostEvent` (crowd panic),
`citySizeUpHit`.

**`combat_iq.melee`** is the piece the jail is most obviously missing. It is a
beat machine — `close → circle → guard → windup → swing → recover → backstep` —
and it writes the **exact fields the rig and `city/combat.js` already read**
(`a._windup`, `a.char.windup`, `a._blockT`). Its own header says why it exists:
*"peds.js's melee was one line: cooldown, sound, damage… two brawlers stood
inside each other and traded invisible hits."* **That is a verbatim description
of `ai.js`'s `exchangeBlows` today** (`ai.js:3438-3452`: two `hp -=` lines, one
`sfx("punch")`, no wind-up, no spacing, no animation at all). The city already
solved the jail's bug and the jail was never told.

### 1.3 What is ALREADY shared — do NOT rebuild any of this

This is the good news, and it is most of the substrate:

- **`entities/character.js` `animChar` is the ONE fight rig, for all four
  modes.** Every system above writes the same flags: `punchT`/`punchKind`/
  `punchArm` (2466-2550), `kickT`, `fightStance` (2551), `blockT` (2623),
  `dodgeT` (2648), `staggerT` (2665), `koT`/`koPose` (2720), `surrender`/
  `handsUp` (2685), `cuffed`, `lying`. **A merged melee system needs zero new
  animation code.**
- **`entities/poses.js`** — the shared held-pose registry, explicitly built so
  "BOTH the city ped brain AND game packages drive the same poses".
- **`systems/reactions.js` `CBZ.reactPunch`** — the head snap. Its own comment
  (`reactions.js:121`) reads **"punch reactions, CBZ.reactPunch — jail AND
  city"**. This is the one place the two systems already meet, and it proves
  the merge is possible: three call sites, `systems/combat.js:220`,
  `city/combat.js:336`, `city/peds.js:3039/3056`.
- **`systems/predator.js`** — `predatorSeize` / `predatorHunt` / `predatorPack`,
  and **its private `actorPos(a)` at line 421 already handles both actor
  shapes.** See §2.1.
- **`systems/wounds.js`** (`bodyWound`/`bodyBite`), **`systems/gore.js`**,
  **`systems/fpsmode.js`** (the ONE gun system), **`systems/humancontact.js`**
  (explicitly "all three games use the same physical contract").
- **`systems/economy.js` `lootActor`** — and note the direction: `city/take.js`
  (504-522) **reuses the JAIL's looter** rather than writing a second one. The
  precedent for cross-mode reuse already exists and it runs city → jail.

### 1.4 "NPCs will kinda spin you around" — identified

That is **`CBZ.predatorSeize`'s `possessCamera(h)`** (`predator.js:1508`). While
a hold is live the camera is taken off the player and orbited around the grab
(`h.camPh` phase, `h.thrash`), which reads exactly as being spun. The jail has
**two** live seize call sites:

- `systems/capture.js:433` — a guard's third subdue beat, `style:"pin"`,
  `nonLethal:true`. Break the one telegraphed `[SPACE]` window and you are loose;
  lose it and the escort starts.
- `entities/ai.js:3528` — an inmate who has hit you twice takes you off your
  feet, `style:"drag"`, `nonLethal:true`.

**This is not the thing to fix. It is the thing to copy.** `predatorSeize` is
already the shared grammar (10 consumers across the repo — sharks, cops, bums,
the serial killer, piracy, ocean, jail ×2), it is already mode-agnostic, and
the jail already adopted it correctly. Gang City's melee, by contrast, has
**no** grab at all — `city/restrain.js`'s clinch is a separate machine with its
own state enum. §3 item D7 covers that.

### 1.5 THE FIVE STRUCTURAL FORKS (the actual root cause)

Everything in §3 is a symptom of these five. Fix these and most of the
duplication becomes deletable rather than portable.

**F1 — THE ACTOR SHAPE. This is the whole blocker, and it is one line.**

| | Gang City ped | Jail actor |
|---|---|---|
| position | `ped.pos` | `n.group.position` |
| name | `ped.name` | `n.data.name` |
| declared at | `city/peds.js:1197` | `entities/npc.js:26`, `guards.js:61` |

And here is the punchline — `city/peds.js:1197`:

```js
char: ch, group: ch.group, pos: ch.group.position, name: nm, gender,
```

**A city ped's `.pos` IS its `.group.position` — the same `Vector3` object, not
a copy.** The city convention and the jail convention are already the identical
memory. The only difference is that the city ped has a second name for it and
the jail actor does not.

Consequences, all verified:
- `combat_iq.melee` hard-refuses a jail actor: `if (!a || !a.pos || !tgt ||
  !tgt.pos …) return null` (`combat_iq.js:798`). The whole NPC melee brain is
  unreachable from the jail **for want of an alias.**
- `predator.js` worked around it privately (`actorPos`, line 421).
- `modes/gungame.js:267` worked around it by **writing both**:
  `name: name, data: { name: name },   // fpsmode/killstreaks/combat read a.data.name`
  — an in-repo admission of the fork, papered over rather than fixed.
- `city/social.js`'s `citySay` reads `ped.pos.x` and **threw on every prison
  actor**, which is why the prison was silent for a whole wave and why
  `CBZ.prisonSay` had to be written (`engine-systems.md`, "The prison's ONE
  mouth"). **`prisonSay` exists because of F1.**

**F2 — MODE-GATED INTEGRATORS.** `systems/grapple.js` owns the body layer
(`CBZ.body`) and its two integration passes both begin:

```js
CBZ.onUpdate(24, function (dt) { if (CBZ.game.mode === "escape") return; …
CBZ.onUpdate(90, function ()   { if (CBZ.game.mode === "escape") return; …
```

`grapple.js:719`, `grapple.js:765`. So in the jail, `CBZ.body.hit()` — which
`systems/combat.js:219` and `:264` both call — writes `p.kx/kz/down/air/shock/rag`
and then **knockdown, fling, the euphoria limb ragdoll, the landing bounce, the
get-up arc and `CBZ.deathPose` are all dropped on the floor.** (The linear
slide alone survives: `reactions.js:357-361` integrates `kx/kz` for the
non-city passes.) The jail's real impact model is therefore
`ai.js:5262`'s `knockback()` — **six lines that teleport `group.position` by a
fixed distance.** No velocity, no decay, no collision, no fall.

**And the same code behaves differently under a different string.** Gun Game on
the JAIL map runs mode `"gungame"` in `prisonRoot`, with bots pushed into
`CBZ.bots` *and* `CBZ.npcs` (`gungame.js:292-293`). The mode string is not
`"escape"`, so **order 24 runs and the bots get the full body layer** — same
world, same punch code, same rigs, opposite physics, decided by a string
compare.

**F3 — TWO INTERACTION SYSTEMS.** `systems/interact.js` (952 LOC) is a
hardcoded `[I] Romance [J] Insult [K] Befriend [L] Steal` card whose own header
records that a fifth verb was **silently dropped by `cap4` because there were
only four keys to reach it with**. `city/interactions.js` (864 LOC) is the
registry the doctrine calls *"the keystone"* — layers, slot exclusivity,
prio, `canShow`, tap-vs-hold, gunpoint mode, facing-weighted targeting with
hysteresis — with 18 adopters. It gates hard on mode at four points
(`interactions.js:433, 598, 773, 811, 824`). The jail cannot reach it.

**F4 — TWO HEAT SYSTEMS.** `systems/detection.js` (`CBZ.addHeat`,
`CBZ.reportCrime`) vs `city/wanted.js` (`CBZ.cityAddStars`, `CBZ.cityCrime`).
Two crime vocabularies, two decay models, two HUDs.

**F5 — TWO MOUTHS.** `CBZ.prisonSay` (`systems/interact.js:602`) vs
`CBZ.citySay` (`city/social.js:473`) — a fork caused entirely by F1.

### 1.6 A correction worth recording

My first read concluded the jail's `CBZ.body.hit` was **fully** dead. It is
not: `reactions.js:344-361` integrates `kx/kz` for the non-city passes, with a
comment explaining that the city deliberately leaves it to grapple to avoid
double-applying. So the jail gets the **slide** and loses **knockdown, fling,
limb ragdoll, get-up and deathPose**. The distinction matters because Stage 1
below must hand that integration over to grapple rather than run both.

---

## 2. THE PLAN — WIRING THE JAIL ONTO GANG CITY'S FIGHT

Five stages. Each is independently shippable, independently revertible, and
satisfies all five clauses of the Block Law. **Stage 0 is the whole unlock and
it is 4 lines; do not start anywhere else.**

Two rules that govern every stage:

> **RULE A — MIGRATE, NEVER MIRROR.** No stage may introduce a second field
> holding the same fact. F1 is fixed by *aliasing* the existing memory, not by
> copying it (the `rankField` lesson from `factions.js`; the parallel-bookkeeping
> trap that killed `proptypes.js`).
>
> **RULE B — GATE ON THE QUESTION, NOT THE MODE.** Every `g.mode === "escape"` /
> `!== "city"` in a *shared* system is a bug of the same class as the water
> wave's `cityGated` ratchet. Replace with a capability test
> (`CBZ.meleeActorsFor()`, `CBZ.bodyModeOn()`) exactly as
> `CBZ.waterModeOn()` did for the survival island.

### STAGE 0 — THE ADAPTER (the unlock)

**Change.** Give jail actors the alias the city ped already has.

```js
// entities/npc.js (in makeNpc, beside `char: ch, group: ch.group,`)
pos: ch.group.position,        // SAME Vector3 — city/peds.js:1197's exact idiom
name: opts.data && opts.data.name,
```
…and the identical two lines in `entities/guards.js`'s guard record.

Then promote `predator.js`'s private pair to the shared answer, degrade-safe:

```js
CBZ.actorPos  = function (a) { … };   // predator.js:421, moved not rewritten
CBZ.actorName = function (a) { … };   // predator.js:427
```
…and repoint `predator.js` at its own promoted copy in the same change.

- **Flag** `ACTOR_SHAPE_V1` (default true). Off → the two lines are not written;
  every jail system reads `group.position` as it always did. Byte-identical.
- **Why it is safe.** `.pos` and `.group.position` are the same object, so
  a reader and a writer cannot disagree. No sync pass, no staleness, no second
  source of truth. This is the `rankField` shape.
- **≥3 consumers migrated in the same change** (Block Law clause 3):
  `combat_iq.melee` (jail actors now pass its guard), `humancontact.js`
  (`posOf` collapses to one branch), `gungame.js:267` (**delete** the
  `data: { name }` shim — the fork admission goes away).
- **Ratchet.** `CBZ.actorShapeAudit()` → `{actors, posed, named, shimmed}`.
  `shimmed` (records carrying a duplicated field to satisfy a reader) pinned at
  its measured value, may only go DOWN. **Measure it; do not pin a guess** —
  the `propUseAudit` lesson.
- **Effort.** ~1 hour including the audit. **Risk: very low.**
- **Verification.** `tools/math-gate.mjs`; `tools/prison-polish-check.mjs`
  (34/34); a probe asserting `n.pos === n.group.position` for every
  `CBZ.npcs`/`CBZ.guards` record and that `combat_iq.melee(guard, player, dt)`
  returns non-null in escape mode.

### STAGE 1 — ONE BODY LAYER

**Change.** Replace grapple's two `mode === "escape"` early-returns with a
capability test, and hand `reactions.js`'s non-city `kx/kz` integration over so
it is never double-applied.

```js
// systems/grapple.js — replaces the string compare at :719 and :765
CBZ.bodyModeOn = () => CBZ.CONFIG.SHARED_BODY_ALL_MODES !== false || CBZ.game.mode !== "escape";
```
…and in `reactions.js:357`, widen the existing `!isCity` guard to
`!isCity && !CBZ.bodyModeOn()` — mirroring the comment already sitting there
(`"CITY: grapple.js (order 24) ALREADY integrates kx/kz … doing it AGAIN here
double-applies the slide"`). The comment is already correct; only its scope
changes.

**What the jail gets for that one line, with no new code:** real velocity
knockback with decay and collision; `knockdown` (the directional fall + lie +
get-up beat); `fling` (ballistic tumble on both axes); the euphoria-lite limb
ragdoll; the landing bounce; the `SURV_THROW_INTACT` brace pose; and
**`CBZ.deathPose`** (`grapple.js:387/403`), which **deletes** the crude
`rotation.z → π/2` topple duplicated in `npc.js:192-202` and `guards.js` —
the seam `sessions.md`'s UNIFICATION MAP already named.

Then **delete `CBZ.knockback`** (`ai.js:5262-5268`) and repoint its 3 call sites
(`combat.js:239`, `ai.js:3436`, `ai.js:5293`'s export) at
`CBZ.body.knockdown` / `CBZ.body.hit`.

- **Flag** `SHARED_BODY_ALL_MODES` (default true). One line back to teleport-shove.
- **Ratchet.** `CBZ.bodyAudit()` → `{modes, stepped, legacyShoves}`.
  `legacyShoves` (position-write impact sites) pinned, may only go DOWN. Target 0.
- **Risk: medium.** The prison floor is a flat slab at `y = 0` with collider
  walls; grapple's `floorAt`/`collide` path must be probed there. Prison actors
  ragdolling into a cell's `y0/y1` door collider is the specific case to test.
- **Effort.** ~half a day including the probe.

### STAGE 2 — ONE MELEE RESOLVER

This is the stage the owner is actually asking for. **Extract, do not rewrite.**

**Change.** Lift `city/combat.js`'s `land()` — posture, guard-break, block,
counter, weapon feel, hit-stop/shake/slow-mo, damage routing — into a shared
entry that replaces the line each caller already writes:

```js
CBZ.meleeStrike(attacker, target, {
  tier: "light"|"heavy"|"finisher", kind: "jab"|"cross"|"hook"|"upper",
  dmg, feel, lethalIntent
}) -> { connected, blocked, broke, downed, killed }
```

Plus the two seams that make it mode-agnostic:

- **`CBZ.meleeHurt(target, dmg, imp, cause)`** — the damage router, chosen by
  **what the target IS**, never by `g.mode`: `t.kind === "cop"` →
  `cityHurtCop`; `t.animal` → `cityWildlifeHit`; `t.netKind` →
  `net.localMeleeHit`; a jail actor → `aiKill`/`down`; a survival bot →
  `surv.hurt`; a city ped → `cityKillPed`/`cityKOPed`. All six branches already
  exist — five of them already inside `land()`.
- **`CBZ.meleeMaxHp(a)`** — replaces `systems/combat.js:20`'s two-branch literal
  and `city/combat.js`'s `a.maxHp || 100`. Derive from role/rank the way
  `postureMax` already does; **no species/kind table**.

**Consumers migrated in the SAME change (Block Law clause 3 — this is 80 % of
the work, budget for it):**

1. `city/combat.js` — becomes the caller of what it used to contain.
2. `systems/combat.js` — shrinks from **303 LOC to ~90**: it keeps the two
   things that are genuinely its own and genuinely better — the **left-click
   binding** and the **drive-frame resolve** (`pendingPunch`) — and loses the
   16 % dice block, the second combo counter, the second stamina float, the
   second execute path and `maxHpOf`. **The drive-frame resolve should then be
   promoted INTO `city/combat.js`**, because the city currently resolves
   instantly and the jail's timing is the better feel. *The jail wins that
   argument; say so in the wave report.*
3. `city/arena_fights.js` `strike()` (1655) — the pure-dice resolver
   (`<0.18` slip, `<0.48` block) becomes a `meleeStrike` call, so ring bouts
   gain posture, `reactPunch`, wounds and the body layer for free.
4. `entities/ai.js` `exchangeBlows` (3438) — two `hp -=` lines become one
   `meleeStrike` call, so **jail brawls animate for the first time**.

- **Flag** `MELEE_ONE_RESOLVER` (default true).
- **Degrade** `CBZ.meleeStrike ? CBZ.meleeStrike(...) : <old inline>` at every
  one of the four sites.
- **Ratchet.** `CBZ.meleeAudit()` → `{resolvers, adopted, legacy, blindDice}`.
  `resolvers` baseline **7**, `blindDice` (block/slip decided by an
  un-telegraphed roll) baseline **3** (`systems/combat.js:226`,
  `arena_fights.js:1662-1668` ×2). Both may only go DOWN.
- **Risk: medium-high** — this is where feel regressions live. Mitigate by
  keeping tier constants per-caller at first (the resolver takes `dmg` and
  `feel`, it does not invent them), so wave 1 changes *plumbing only* and the
  numbers move in a separate, measured pass.
- **Effort.** 1.5–2 days.

### STAGE 3 — ONE NPC MELEE BRAIN

**Change.** `entities/ai.js`'s fight path calls `CBZ.combatIQ.melee(n, foe, dt)`
and acts on its returned beat, exactly as `city/peds.js` does. `IQ.melee` needs
`a.pos`, `a.target` (a `Vector3`) and `tgt.pos` — jail actors have `n.target`
already (`npc.js:32`) and get `.pos` from Stage 0, so **this stage is a call
site, not a port.** `combat_iq.js` loads at `index.html:529`, *before*
`systems/combat.js` at 543 — it is already available to the jail today.

Its only mode gate is the housekeeping sweep at `combat_iq.js:897`; widen that
one line and nothing else in the file needs touching.

**What the jail gets:** wind-up telegraphs (`_windup` / `char.windup`), guard as
a **decision** instead of a dice roll, circling at the edge of reach instead of
two bodies overlapping, backstep on being struck, and the role×weapon
competence table so a guard fights like a guard.

- **Flag** `NPC_IQ_MELEE` — **already exists** (`combat_iq.js:797`). No new flag.
- **Ratchet.** `combatIQAudit()` gains `{meleeBouts, modesServed}`.
- **Risk: low.** **Effort:** ~half a day.

### STAGE 4 — THE INTERACTION REGISTRY (separate wave, do NOT bundle)

This is the largest and least urgent piece, and it is the one most likely to
break a working game if rushed. **Recommendation: option (b).**

- **(a) Full port** — delete `systems/interact.js`, register every prison verb
  into `city/interactions.js`, un-gate its four `mode !== "city"` returns.
  *Correct end state, but it moves the prison's touch card, its dialogue
  routing, its `prisonSay` subtitle ladder and its trade/bribe panels all at
  once. Too much surface for one wave.*
- **(b) Registry underneath, card on top** — move the prison's **verbs** into
  `city/interactions.js` as an option layer (`"jail:inmate"`, `"jail:guard"`),
  and keep `systems/interact.js` as a **renderer** that draws whatever the
  registry resolves. One system decides *what you can do*; two systems still
  draw it, for now.
  - **This immediately fixes the `cap4` bug** — the registry's slot exclusivity
    means a fifth verb can never be silently dropped again.
  - It puts prison verbs on the same tap/hold, prio, `canShow` and gunpoint
    machinery the city has, so `restrain.js`'s cuff/escort/turn-in verbs and
    `power.js`'s principal intercept become reachable in the jail.
  - The renderer merge becomes a later, purely cosmetic wave.
- **Ratchet.** `CBZ.interactAudit()` → `{registries, verbs, registered, hardcoded}`.
  `hardcoded` (verbs living in a keydown switch rather than an option record)
  pinned, may only go DOWN.
- **Effort.** 3–4 days for (b). **Risk: high** if bundled with Stages 0-3.

### STAGE 5 — ONE MOUTH, ONE HEAT (later, optional)

- **F5 dissolves for free the moment Stage 0 lands** — `citySay` threw on prison
  actors *only* because it read `ped.pos.x`. Once `.pos` exists, `prisonSay`
  can become a thin wrapper that adds its RANGE/RANK/SILENCE rules on top of
  `citySay` instead of duplicating the delivery. **Do not delete `prisonSay`** —
  its rank arbitration is the good part and `engine-systems.md` names it as the
  prison's ONE mouth. Keep the name, share the plumbing.
- **F4 (heat)** is a genuinely separate design question — a prison heat meter
  and a 5-star manhunt are not obviously the same thing. Recommend leaving both
  and instead making `CBZ.reportCrime` and `CBZ.cityCrime` share one **crime
  vocabulary**, so a "melee assault" means the same event in both. Defer.

---

## 3. THE DUPLICATION INVENTORY

The list the owner asked for, ranked by (cost of the duplication × cheapness of
the fix). Every row is a candidate ratchet.

### D1 — SEVEN MELEE RESOLVERS ★ the headline

| # | file | model | knows about |
|---|---|---|---|
| 1 | `systems/combat.js` | combo, 16 % dice block | jail actors only |
| 2 | `city/combat.js` `land()` | posture, parry, guard-break, feel | city peds/cops/wildlife/net |
| 3 | `systems/combat_iq.js` `melee` | beat FSM (the brain, not the resolver) | anything with `.pos` |
| 4 | `city/arena_fights.js` `strike` | pure dice (`<0.18` slip, `<0.48` block) | two ring fighters |
| 5 | `games/boxing.js` `PUNCH`/`stepFight` | **windup/active/recover per punch, slip, counter window, hitstun, per-punch stamina** | *nobody* |
| 6 | `systems/grapple.js` `punch`/`push` | flat force, `surv.hurt(18)` | survival bots |
| 7 | `entities/ai.js` `exchangeBlows` | two `hp -=` lines, no animation | jail actors |

**The irony to act on: #5 is the best-authored punch model in the repo and it
cannot hit a person.** `games/boxing.js`'s `PUNCH` table gives every punch a
real wind-up, active window, recovery, reach and stamina cost — precisely what
`combat_iq.melee` had to invent from scratch and what `city/combat.js` fakes
with a fixed `COMBO_WINDOW`. It runs headless, in a ring, against one opponent,
and nothing outside `games/boxing.js` can call it. **When Stage 2 needs a punch
table, take it from here rather than authoring an eighth.**

### D2 — TWO IMPACT MODELS
`CBZ.body` (velocity, decay, knockdown, fling, limb ragdoll, get-up,
deathPose — `grapple.js`) vs `CBZ.knockback` (6 lines, a position teleport —
`ai.js:5262`). Fixed by **Stage 1**. Note `city/ragdoll.js` (831 LOC, verlet) is
a *third* body solver, but it is a corpse solver with a different job — leave it.

### D3 — TWO INTERACTION SYSTEMS
952 + 864 LOC. F3. **Stage 4.**

### D4 — TWO DEATH POSES
`CBZ.deathPose` (`character.js:2773`, 4 consumers) vs the `rotation.z → π/2`
lerp duplicated in `npc.js:192-202` and `guards.js`. Named in `sessions.md`'s
UNIFICATION MAP; **falls out of Stage 1 for free.**

### D5 — TWO SPEECH SURFACES
`prisonSay` vs `citySay`. F5, caused by F1. **Stage 5.**

### D6 — TWO HEAT/CRIME SYSTEMS
`detection.js` vs `wanted.js`. F4. Deferred.

### D7 — TWO GRAB SYSTEMS, AND THE JAIL HAS THE BETTER ONE
`predatorSeize` (shared, 10 consumers, one telegraphed break-free press, the
anti-habituation menace gauge, 7 seize styles) vs `city/restrain.js`'s clinch
(`grapple` state in the restraint enum, `WEAR_T` struggle timer, 777 LOC).
**Gang City's melee has no grab at all**, while the jail has two seize call
sites. **The migration owed runs city ← jail here**, not the other way:
`restrain.js`'s clinch should become `predatorSeize(style:"pin", nonLethal)`
with the cuff as its `onEnd`. Worth a separate wave.

### D8 — THE PLAYER-ACTOR ADAPTER, WRITTEN THREE TIMES
`city/mode.js:21`, `modes/survival.js:25`, `humancontact.js:31` — three nearly
identical `{isPlayer, get pos, get group, get hp, get dead}` shims, and the jail
has none (which is why `ai.js:3556-3563` carries a comment explaining it cannot
call `CBZ.knockback` on the player and hand-writes the shove instead). **One
`CBZ.playerActorFor(mode)` retires all three and gives the jail its first.**
Cheap; bundle with Stage 0.

### D9 — TWO NPC-KILL BUSES
`CBZ.aiKill` (jail) vs `CBZ.cityKillPed` (city, wrapped by **13** files:
killfeed, regimes, cityevents, strategic, schedule, social, inheritance,
approval, campaign, morgue, crown, officials, …). `killfeed.js` already bridges
the *feed*; the **kill** is still two functions. Stage 2's `meleeHurt` is the
seam that makes a single `CBZ.actorKill(target, imp, cause)` possible later.

### D10 — TWO STAMINA MODELS
`systems/combat.js:89` (a private `0..1` float) vs `P.stamina` (`0..100`,
`city/combat.js:133`) vs `games/boxing.js`'s per-punch `st` cost. Collapses into
Stage 2.

### D11 — `maxHp` DECIDED FOUR WAYS
`combat.js:20` (140/100 literal), `city/combat.js` (`a.maxHp || 100`),
`postureMax`'s derivation, `arena_fights.js` (`hp:100` literal ×2).
`CBZ.meleeMaxHp` in Stage 2.

### D12 — GUN GAME'S FISTS RUNG RUNS THE JAIL'S MELEE, BY ACCIDENT
`fpsmode.js:2318-2325`:
```js
if (CBZ.game.mode === "city") return;   // city/combat.js owns unarmed melee in the city
…
if (CBZ.punch) { const r = CBZ.punch(hit && hit.actor); …
```
`CBZ.punch` is `systems/combat.js:285` — the **jail** resolver. So Gun Game's
final, categorical rung (bare fists — "the humiliation rung… losing your lead to
a punch is the drama") is adjudicated by the 16 %-dice-block jail code, against
bots that carry a `data: { name }` shim so the jail code will not throw on them.
Worse, the **KO path bypasses the `_ggBot` wrap**: `gungame.js` intercepts
`CBZ.aiKill` (`gungame.js:332`), and `execute()` goes through `aiKill` — but
`downConsequences()` (`combat.js:106-115`) does **not**, so it runs
`CBZ.game.kos++`, writes `koLog`, and calls `CBZ.econ.lootActor` **on an arena
bot**, which the mode's own header says must never happen. Stage 2 fixes the
resolver; the wrap leak should be fixed in the same change.

### D13 — TWO WATER/TERRAIN QUERY HABITS (already solved — copy the pattern)
`CBZ.waterModeOn()` is the finished template for RULE B: four consumers gated on
`g.mode === "city"` were dark on the survival island, and the fix was a
capability oracle plus a ratchet (`waterSharedAudit().cityGated`, pinned at 0).
**Every stage above should ship the same shape of ratchet.**

---

## 4. SEQUENCING, EFFORT, AND WHAT NOT TO DO

**Recommended waves.** Do not bundle; each wave must pass the gates alone.

| wave | contents | effort | risk |
|---|---|---|---|
| 1 | **Stage 0** + **D8** | ~half a day | very low |
| 2 | **Stage 1** (+ D4 falls out) | ~1 day | medium |
| 3 | **Stage 2** (+ D10, D11, D12) | 1.5–2 days | medium-high |
| 4 | **Stage 3** | ~half a day | low |
| 5 | **Stage 4 (option b)** | 3–4 days | high |
| later | D7 (city ← jail grab), Stage 5, D6, D9 | — | — |

**Verification, every wave** (per `docs/claude/verification.md`):
`tools/math-gate.mjs` green with determinism ok · `tools/prison-polish-check.mjs`
34/34 · a headless probe that boots city → `setMode("escape")` → runs the new
path live and prints the new audit · flag-OFF re-run proving byte-identical
legacy behaviour. **A visual preset for wave 3** (the jail cellblock, a live
brawl) — feel regressions do not show up in a counter.

**What NOT to do — five traps, all of which this repo has already fallen into
once:**

1. **Do not write a `MeleeSystem` abstraction/interface.** `core/interfaces.js`
   has zero adopters. `ctx` got ten in two days. A block must *replace the line
   the caller already writes.* `meleeStrike` replaces `land()`; it does not wrap
   it in a class.
2. **Do not mirror a field.** Stage 0 aliases the same `Vector3`. The moment a
   `syncActorPos()` pass exists, the whole plan has become `proptypes.js`.
3. **Do not delete the jail's good parts.** The drive-frame resolve, the
   `huntPlayer` seize hand-off and `prisonSay`'s rank arbitration are all
   *better* than the city equivalent. This is a two-way merge; the wave report
   must say which direction each piece moved and why.
4. **Do not pin a ratchet you have not run.** `propUseAudit`'s header confidently
   told the next person to pin `blocked` at 0; the first build that ever ran it
   read **487**.
5. **Do not touch feel and plumbing in the same commit.** Stage 2 moves damage
   *routing*; the numbers move in a separate, measured pass, or nobody will be
   able to tell a regression from a rebalance.

**The one-sentence summary for the owner:** the jail's punch and Gang City's
punch are separated by a single missing field name, one string comparison in a
physics loop, and an interaction card that predates the registry — and fixing
those three in that order gives the jail Gang City's posture, guard-break,
parry, wind-up telegraphs, ragdolls and knockdowns **without porting a single
line of combat logic into it.**
