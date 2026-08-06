# RECON — SORTIE: five bombers, five runners, then you swap

**Status: RESEARCH + PLAN ONLY. Nothing in this document is built.**
Owner prompt (2026-08-06): *"look at the B-2 bomber in the code and research
Roblox games and think about if a 5v5 planes versus people trying to escape,
and then they switch teams, could be an insane Roblox game."*

The answer this recon reaches: **yes, and the reason is not the planes.** The
swap is the product. Everything else in the concept already exists in this
repo, most of it shipped and flagged, and the parts that do not exist are
smaller than they look. What does *not* exist — and what will actually decide
whether this is a game or a tech demo — is a scoring ladder and an honest
answer to "what happens when a 2000 lb bomb meets a running man."

---

## PART 1 — WHAT THE REPO ALREADY HAS

### 1.1 The B-2 is not a prop. It is a shipped weapons platform.

`src/city/strategic.js` (1000+ lines of it) is the bomber, and it is far past
model-in-a-scene:

| verb | where | note |
|---|---|---|
| board & fly | `strategic.js` → `cityRegisterMilitaryVehicle` → `playeraircraft.js` `spawnFlyableFromProp` | belly hatch opens on the real `_doorArcOpen` arc |
| tap **[B]** | `strategic.js:60` | release one |
| hold **[B]** | `STRAT_BOMB_RUN` | walk a **carpet** — stagger = release interval × ground speed |
| **[X]** | payload cycle | Mk-84 · JDAM · GBU buster · nuclear |
| hold **[C]** | `STRAT_BOMB_CINEMATIC` | **bomb camera**, published as a moving shot target |
| **[V]** | `cockpit.js:201` | a real bomber flight deck — four monochrome-green MFDs, deliberately dark, `BOMBER_RE` picks the costume off `displayName` |

Two facts from that file matter enormously for this design:

1. **Ballistics are solved, not integrated.** `y(t) = y₀ + v_y·t − ½gt²`,
   landing time is the positive root. *"A round's impact POINT, TIME and SPEED
   are all known the instant it leaves the bay."* Rounds inherit the aircraft's
   own velocity, so they lead. — This is the single most valuable line in the
   codebase for this mode. It means we can tell a runner, **truthfully and
   frame-accurately, exactly where and when the bomb is going to land**, the
   instant it leaves the bay. Counterplay does not need to be invented. It
   needs to be *displayed*.
2. **Detonation is one call:** `CBZ.detonate(x,y,z,"bomb"|"jdam"|"buster"|"nuke")`
   into `systems/impactbus.js`, which owns the fan-out (FX, shake, blast wave,
   `city/structural.js` load-path failure and pancake collapse). New ordnance
   is a table row via `CBZ.impact.define()`.

### 1.2 `b2code.html` — the bomber fantasy, already prototyped once

3,446 lines at repo root, titled **"SPIRIT — Leonida Theater"**, and it is not
a scratch file. It is a self-contained procedural theater with:

- a real B-2A lofted flying wing (`buildB2()`, line 2371)
- **voxel destruction** with support-collapse (`findUnsupported`), rubble
  mounds, debris pools
- a **casualty model with actual physics** — Kingery-style overpressure tables
  (`ZT`/`PT`, line 1848), indoor/outdoor population split, fragmentation
  dominance outdoors, `nukeRadii()` with cube-root scaling
- a **BDA panel** (`{killed, wounded, structures, tonnage}`) and a stores
  rack — i.e. the pilot's HUD, designed and styled
- theater scale: city bounds ±8500 × −5400..7400, a 2400 m runway at
  (−5600, 4300)

This is the *pilot half's* screen, already authored. It is also the honest
scale reference: **a bomber needs ~10 km of theater.** Hold that thought.

### 1.3 The counterplay already shipped — and this is the surprise

`src/systems/lockon.js`. When the player holds a missile-class weapon —
**including the RPG on foot** — every live craft on screen grows a target
square. Three-state colour grammar, no words: green candidate → yellow
acquiring → red **LOCKED**. Exactly one lock, nearest-to-crosshair with
hysteresis, and **line-of-sight gated** through `CBZ.losBlockers`.

Red lock + fire = homing, and the file says the RPG's turn rate is
*"deliberately sluggish."*

Read that again in the context of this mode: **a man on the ground already has
a MANPADS, it already requires him to stand still in the open and hold aim,
and the missile is already beatable by a pilot who breaks hard.** The entire
asymmetric spine — the moment the prey becomes dangerous and pays for it with
exposure — is shipped, tuned, flagged (`WEAPON_LOCKON`) and has a mobile API.

The one gate: the target pool is fed by *city-scoped* enumerators
(`cityMilitaryVehicles`, the plural `cityXxxEnumTargets(cb)` twins). Opening
that pool to a non-city roster is the specific, small piece of work.

### 1.4 The mode seam is a solved problem, twice over

`CBZ.registerMode(id, def)` — `src/config.js:38`. That is the whole API.

And `src/modes/gungame.js` is the worked example of *exactly* the mode this
concept needs: **it builds no world.** It borrows the prison and the disaster
island whole (`MAPS` table: `{label, small, ensure(), root(), floorAt(), point()}`),
spawns 9 bots into `CBZ.npcs`/`CBZ.bots`, wraps `CBZ.aiKill` to intercept only
records stamped `_ggBot`, and drives `systems/fpsmode.js` untouched. Adding a
map is five hooks. Adding a mode is a row.

`src/modes/survival.js` supplies the other half of the pattern: a uniform
`actor` model where the player is just another entry, `surv.hurt` /
`hurtRadius(x,z,r,dmg)` with real knockback, and a wave scheduler that
announces → happens → declares over.

### 1.5 The capability bus means a new mode is a table row

`src/systems/modecaps.js`. A new mode declares what shared engine verbs it
gets:

```js
sortie: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
```

That one line buys vaulting over cover, NPCs stepping curbs, the full
explosive payload, blast damage reaching this mode's own roster, and
**permanent walk-through holes in walls**. Ratchet
`CBZ.modeCapsAudit().unrouted` is pinned at 0 and would catch us declaring
`blast` without wiring a damage funnel.

### 1.6 Destruction that remembers — an unearned gift

`city/fracture.js` + `city/buildings.js` `carveHole`: 24-hole ledger,
coordinate-stable persistence, **no decay**. `systems/breach.js` prices
everything in pounds of C4 (5 lb = one man through). `chewWall` opens a murder
hole in 25 rifle rounds.

For a round-based mode this is a **free difficulty ramp**. Cover does not need
a scripted degradation system. Bomb the map for four minutes and the map
*is* degraded, permanently, and the ledger proves it. Late-half runners are
naked because of physics, not because of a timer.

### 1.7 Multiplayer — real, but honestly assessed

| have | file | fit for 5v5 |
|---|---|---|
| Node relay, room-owning | `server/server.js` | `maxPlayers: 16` — **10 fits** |
| FiveM-style, client-authoritative over own avatar | `net/net.js` | fine |
| remote avatars are **real hitscan PvP targets**, damage routed over the wire | `net/netactors.js` | ✅ this is the hard part and it's done |
| backpressure gate that sheds stale snapshots | `net/net.js` | good under load |
| host-elected world sim + 10 Hz scoped snapshots | `net/networld.js` | **city-scoped** |
| car ownership transfer (`carReq`/`carGrant`/`carRel`) | `net/networld.js` | the *pattern* an aircraft needs |

**Gaps, stated plainly:** there is no `team` concept anywhere in `src/`. There
is no server-side round/phase authority — the elected host's browser is the
referee, which is fine for co-op and wrong for a competitive scored match.
Aircraft are not in the snapshot vocabulary (cars are).

---

## PART 2 — WHAT ROBLOX SAYS

### 2.1 The failure mode this concept is one step away from

Asymmetric multiplayer has a corpse in the road and its name is **Evolve**.
The 4v1 shape produces a role nobody queues for: *"one out of five players is
destined to feel ganged up on and left out."* The data point that should end
any 5v5-asymmetric argument early — among VHS streamers, with **1 in 40**
queuing for the monster role, *90% would rather wait nearly an hour* than
play it. A skilled monster has nobody to appreciate the moment; a bad one has
nobody to learn from.

### 2.2 The fix, and it is exactly what the owner proposed

**Left 4 Dead Versus.** *"Each team gets to play both sides, which makes the
game fair. However, this does not make the game balanced."*

That sentence is the whole design brief:

- **The swap solves the queue.** Nobody picks a role, so no role can be
  unpopular. Evolve's grave is stepped around, not fallen into.
- **The swap does not solve balance**, and pretending it does is how L4D
  Versus shipped a scoring system built on the assumption survivors *wouldn't*
  reach the saferoom — while in practice they reached it, or got 80–90%
  anyway. The score compressed to noise.
- **Therefore the scoring ladder is the real work.** Not the planes.

### 2.3 Round shape — copy the proven envelope

- **Flee the Facility**: 4 survivors vs 1 Beast, hack 3–5 computers, two
  exits. **Rounds 5–8 minutes**, 30-second lobby between, map vote plates.
- **Piggy**: 8–15 min chapters with natural puzzle pauses.
- Design pillar cited across the asym-horror analyses: **meaningful
  asymmetry** — *"the killer feels powerful and survivors feel vulnerable
  without making either side feel helpless."*

### 2.4 Jailbreak is the proof that this audience wants exactly this

6 billion visits, top-20 for eight years. Cops vs criminals, **role switchable
mid-session** (the swap, informally). And critically: **the helicopter is
free, and criminals can hijack it.** The aerial fantasy is not the reward at
the top of a grind — it is handed to a new player early, and it is a large
part of why the game retains.

### 2.5 Aviation on Roblox: deep, competent, and niche

**Hostile Skies** — advanced flight physics, ~49 M visits since 2018.
**Combined Arms** — hyper-realistic military aviation, full cockpits, carrier
ops, early access. **Plane Crazy** — 400 M+ visits (but that's a *building*
game).

The pattern: aviation games on Roblox are *technically excellent and
demographically capped*. The diagnosis in the retention literature is
unambiguous — *"if onboarding is too long, confusing or boring, players churn
before they experience the core fun."* Flight is a twenty-minute skill.

### 2.6 The retention arithmetic that constrains everything

- **~30 seconds** to convince a new player to stay. Doing something fun
  within **10 seconds**.
- First reward inside **60 seconds**.
- Core loop **under five minutes**.
- **Most players who leave, leave within 2 minutes.**
- **Over 80% of lifetime revenue comes from players who survive week one.**
- Every second of non-gameplay in the first five minutes ≈ **2–3% of the
  cohort**.

---

## PART 3 — THE SYNTHESIS

> **Aviation games die at onboarding. Asymmetric games die at the queue. A
> forced team swap kills both, with one mechanic, because the ground half IS
> the flight tutorial.**

You spend your first four minutes as a runner. You are not reading a manual —
you are being bombed. You learn, from underneath and at gunpoint, what a bomb
run looks like as it commits, what the bay opening sounds like, how long the
fall takes, where the pilot has to be to hit you. Then you swap, and every one
of those four minutes converts directly into competence in the cockpit.

That is a flight tutorial disguised as the most exciting four minutes on the
platform, and it costs zero tutorial UI — which is the exact budget the
retention numbers allow.

**Second-order consequence:** because you played the other side, you cannot
believe the other side is easy. The single most toxic dynamic in asymmetric
games — each side certain the other is overpowered — is structurally disarmed.

---

## PART 4 — THE DESIGN

### 4.1 Shape

- **10 players. 5v5. Two halves.** Half A: RED flies, BLUE runs. Half B: swap.
- **Half length 4:00.** Match ≈ 9:00 with the swap beat and a 30 s lobby —
  inside Flee the Facility's proven 5–8 min envelope, inside the sub-5-minute
  loop rule *per half*.
- **You always run first.** Never fly first. Flying first is the churn event.
- **T+0 you are already sprinting and a bomb is already whistling.** The
  10-second rule is not decorated with a countdown.

### 4.2 The scoring ladder — the actual design work

L4D's lesson is that a binary win/loss under asymmetry compresses to noise.
So the runners' half produces a **continuous score**, and the halves are
compared:

```
HALF SCORE = Σ per runner ( route_progress[0..1] × 1000 )
           + ( survivors_extracted × 500 )
           + ( seconds_of_the_clock_survived_by_the_last_runner × 2 )
```

Properties that matter:

- **A wiped team still scores.** Getting four runners 80% of the way is a real
  number, and it loses honourably to a team that got three of them out.
- **The pilots' score is the runners' score, inverted** — pilots are never
  scored on kills. See 4.4 for why this is not a stylistic choice.
- **A tie goes to a sudden-death third half** with one runner each.

### 4.3 Verbs — and every one of them is already shipped

**Runner** — sprint · vault cover (`traverse` cap, `physics.js`
`characterTraversal`) · breach a wall with C4 priced in real pounds
(`systems/breach.js`) · `chewWall` a murder hole with 25 rifle rounds ·
the authored escape gradient from `world/escape_routes.js` (culvert, drainage,
ceiling hatches, maintenance crawls, keycard) · **and the RPG red-lock**, the
one and only way to hurt a plane.

**Pilot** — tap [B] · hold [B] carpet · [X] payload · hold [C] bomb camera ·
lock-on squares · the bay · the flight deck on [V] for anyone who wants it.

**Nothing on either list needs to be invented.** They need to be *reachable
outside the city*, which is what `modecaps.js` exists for.

### 4.4 The one design decision that decides everything

**A 2000 lb bomb versus a running man is a broken duel in both directions.**
Land it and the runner never had a chance and quits. Miss and the pilot flew a
90-second run for nothing and quits. There is no tuning value that fixes this,
because the failure is in the *unit of interaction*, not the numbers.

> **Bombs kill terrain. Exposure kills runners.**

Price a hit as **denial, not damage**. The bomb removes the cover, closes the
route, opens the roof, drops the catwalk — and the runner dies *seconds later,
to a rifle or to the next bomb, because he is now in the open*. The pilot's
skill expression is reading where five people must go and taking it away from
them. The runner's is rerouting under a ceiling that is being deleted.

Three reasons this is the right call and not a hedge:

1. **The engine already does it and nothing else.** `carveHole`, the fracture
   ledger with no decay, `structural.js` load-path failure and pancake
   collapse. We would be scoring the system we actually have.
2. **It makes the ledger the scoreboard.** Denial is measurable —
   route_progress falls because a route closed.
3. **It gives the pilot a reason to be precise** that survives their bombs
   being non-lethal, and gives the runner a reason to fear a *near* miss,
   which is where the drama in every bombing scene in cinema actually lives.

Direct hits still kill. They should just never be the plan.

### 4.5 The commit window is the game

Because ballistics are solved, the pilot knows impact point/time at release —
and so can the runner. The bomb bay is loud, the bomb is visible, the fall is
long. **The pilot must commit ~8–10 s before impact and cannot correct.** The
runner hears the commit and moves.

That asymmetry — *infinite sight and slow reacquire* vs *concealment and fast
reposition* — is "meaningful asymmetry" in one sentence, and it falls straight
out of the physics already in `strategic.js`.

### 4.6 Ordnance economy

**16 Mk-84 per half, per plane. A carpet walk spends six.** Scarcity is what
makes the runner's dodge cost the pilot something. Unlimited bombs turn the
map into weather, and weather is not an opponent.

### 4.7 The concern I owe you: five planes is probably too many

Five bombers over one theater is a mid-air collision problem, a visual
legibility problem (whose bomb was that?), and a *pacing* problem — five
pilots each wanting a run means someone is always circling. The honest
recommendation is **2 pilots + 3 ground/support roles on the air team**
(spotter with the bomb camera, an AA-suppression gunner, a JTAC calling
lock-ons), or **hard altitude bands** so five aircraft can share the sky.

**The plan below builds 5v5 as asked** — it is the right thing to prototype
because the swap is the thesis and the swap needs even teams. But the very
first thing the Phase 1 probe should measure is whether five simultaneous
bomb runs read as anything but noise, and the roster split is the cheapest
lever if it doesn't.

### 4.8 Map

Not the prison yard — the compound is tens of metres across, and 4.7's
collision problem becomes a joke at that scale. Not the full city — `CBZ.city`
builds lazily and the load cost is wrong for a 30-second lobby.

- **Prototype on the disaster island.** `survival.js`'s
  `CBZ.buildDisasterArena()` publishes `{root, center, radius, floorAt,
  randomPoint}` — precisely `gungame.js`'s five `MAPS` hooks. It costs one
  table row, and the precedent for borrowing it already shipped.
- **The right long-term answer is the `b2code.html` theater.** It is already
  procedural, already voxel-destructible, already 10 km, already has the
  runway and the BDA panel. Folding it in is a real project — but it is the
  only asset in the repo authored at bomber scale.

---

## PART 5 — BUILD PLAN

Every phase obeys the Block Law (`docs/claude/doctrine.md`): one-line
adoption, degrade-safe, ≥3 real consumers, named in CLAUDE.md, ratchet
counter.

### Phase 0 — probe only, zero gameplay

Answer before writing a mode:

1. Does `CBZ.detonate(...,"bomb")` produce a full payload with
   `g.mode !== "city"`? **Suspected landmine:** CLAUDE.md is explicit that
   `CBZ.cityExplosion` is a *wrapper chain* with six city couplings installed
   for the session, and that outside the city you must detonate through
   `CBZ.cityBlastCore`. Trace whether `impactbus` → `crashfx` lands on the
   wrapper or the core.
2. Does `lockon.js` acquire a craft that is not in `cityMilitaryVehicles`?
3. Does `playeraircraft.js` `spawnFlyableFromProp` fly with no city built?
4. Frame cost of 5 aircraft + 10 rigs + the voxel debris pools, on a phone.

Ship as `tools/sortie-probe.mjs`, headless, in the `tools/math-gate.mjs`
tradition.

### Phase 1 — `SORTIE_V1`: the loop, all bots, no planes

`src/modes/sortie.js`, registered through `CBZ.registerMode`, modelled
line-for-line on `gungame.js`. Island map borrowed via the `MAPS` five hooks.
Ten actors on `survival.js`'s uniform actor model. Halves, the swap beat, the
score ladder from 4.2, the end card. **The "planes" in this phase are called
strikes** — `CBZ.strategicCallStrike`, which `strategic.js` already exposes
for exactly this ("with no B-2 in the air the SAME seam flies a CALLED sortie
off-map"). One human, nine bots.

*This phase alone answers whether the game is fun*, and it does not require a
single line of flight code.

### Phase 2 — the cockpit

`modecaps.js` gains its row. B-2 spawns on the island apron. Bomb path routed
per Phase 0's finding. Ordnance economy. The pilot's HUD lifted from
`b2code.html`'s stores/BDA panels — **rescored from casualties to denial**
(4.4), which is a relabel of a panel that already exists.

### Phase 3 — counterplay

Open `lockon.js`'s target pool to a mode-supplied roster (the plural
`cityXxxEnumTargets(cb)` twin idiom, one more feeder). Runner RPG. Tune the
exposure cost of holding a lock.

### Phase 4 — the swap made legible

Half-time card comparing the two ladders. Spectator for downed runners
(watching the bomb camera while dead is *content*). Down-and-revive rather
than dead, borrowing Flee the Facility's freeze-pod pacing.

### Phase 5 — net

The last phase, not the first. Needs: a `team` concept, server-side phase
authority (the host's browser must stop being the referee for a scored
match), and aircraft in the snapshot vocabulary via the existing
`carReq`/`carGrant`/`carRel` ownership-transfer pattern.

### Ratchet

`CBZ.sortieAudit().unscored` — runner routes with no progress metric attached,
i.e. ways to advance the game that the scoreboard cannot see. **Pin at 0.**
An unscored route is how L4D Versus's scoring compressed to noise, and it is
the specific failure this mode has to be defended against.

---

## PART 6 — RISK REGISTER

| # | risk | severity | mitigation |
|---|---|---|---|
| 1 | Bomb-vs-man is unfun in both directions | **fatal** | §4.4 — bombs kill terrain, exposure kills runners |
| 2 | Five simultaneous runs read as noise | high | §4.7 — 2 pilots + 3 support, or altitude bands. Measure in Phase 1 |
| 3 | `cityExplosion` wrapper chain silently no-ops outside the city | high | Phase 0 probe #1. CLAUDE.md warns about this exact class |
| 4 | Flight onboarding churn | high | Runner half first, always. Chase cam default, cockpit opt-in |
| 5 | Scoring compresses (the L4D failure) | high | Continuous ladder + the `unscored` ratchet |
| 6 | Host-authoritative referee in a scored PvP match | med | Phase 5 gate; bots-only until then |
| 7 | Perf: 5 craft + 10 rigs + voxel debris on mobile | med | Phase 0 probe #4 |
| 8 | Runners hide and stall out the clock | med | The fracture ledger has no decay — cover *permanently* degrades. Free ramp, zero new systems |
| 9 | Determinism | low | Placement = `hash01` only; combat-time FX may use `Math.random` (existing C4/grenade rule) |

---

## THE ONE-PARAGRAPH VERSION

The B-2 in this repo is a finished weapons platform with solved ballistics, a
carpet-bomb walk, a bomb camera and a flight deck; `b2code.html` is the
pilot's screen already designed; `lockon.js` already gives a man on foot a
sluggish, exposure-priced MANPADS; `modecaps.js` and `registerMode` make a new
mode a table row; `gungame.js` is the worked example of a mode that borrows
its map; the fracture ledger gives a free, permanent difficulty ramp; and the
relay already seats 16 with real cross-wire PvP. Roblox's own history says
asymmetry dies at the queue and aviation dies at onboarding — and a forced
team swap is the one mechanic that kills both, because the ground half is the
flight tutorial. The work that is genuinely new is small and it is not the
planes: it is a continuous scoring ladder that survives being compared across
halves, and the decision that **bombs kill terrain while exposure kills
runners.** Get those two right and the rest of this is assembly.

---

## SOURCES

- [Flee the Facility — Roblox Wiki](https://roblox.fandom.com/wiki/A.W._Apps/Flee_the_Facility)
- [Flee the Facility vs Piggy (2026)](https://earnaldo.com/blog/flee-the-facility-vs-piggy)
- [Roblox Asymmetrical Horror Games Tier List 2026](https://www.forsakenhub.com/blog/roblox-asymmetrical-horror-games-tier-list-2026)
- [The awkward asymmetry of Evolve — PC Gamer](https://www.pcgamer.com/the-awkward-asymmetry-of-evolve/)
- [What Evolve's monster taught me about the failings of 4v1 multiplayer — GamesRadar+](https://www.gamesradar.com/what-evolves-monster-taught-me-about-failings-4v1-multiplayer/)
- [How Evolve paved the way for Dead by Daylight — Bloody Disgusting](https://bloody-disgusting.com/editorials/3603104/asymmetrical-multiplayer-flop-evolve-paved-way-dead-daylight-friday-13th/)
- [Versus — Left 4 Dead Wiki](https://left4dead.fandom.com/wiki/Versus)
- [The Never-ending Challenge of Asymmetrical Design — Game Developer](https://www.gamedeveloper.com/design/the-never-ending-challenge-of-asymmetrical-design)
- [Jailbreak — Roblox Wiki](https://roblox.fandom.com/wiki/Badimo/Jailbreak)
- [Jailbreak (Roblox) — Grokipedia](https://grokipedia.com/page/jailbreak-roblox)
- [Roblox Jailbreak tips — PC Gamer](https://www.pcgamer.com/roblox-jailbreak-guide/)
- [Hostile Skies — Roblox](https://www.roblox.com/games/1886551928/Hostile-Skies)
- [Hostile Skies — RoMonitor Stats](https://romonitorstats.com/experience/1886551928/)
- [Combined Arms — Roblox](https://www.roblox.com/games/126821001007479/Combined-Arms)
- [Plane Crazy — Wikipedia](https://en.wikipedia.org/wiki/Plane_Crazy_(video_game))
- [First Week Retention: Optimizing Day-1 Through Day-7 — RoLearn](https://rolearn.dev/guidance/first-week-retention-optimization/)
- [Roblox Retention Rate Benchmarks by Genre (2026) — BLOXG](https://bloxg.com/statistics/roblox-retention-benchmarks)
- [12 Roblox game ideas that actually work for devs — Game-Ace](https://game-ace.com/blog/roblox-game-ideas-that-actually-work/)
- [Retention — Roblox Creator Hub](https://create.roblox.com/docs/production/analytics/retention)
