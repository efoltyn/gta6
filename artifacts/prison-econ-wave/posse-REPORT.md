# THE POSSE — respect gates the army, cigs feed it

Wave slice: `src/systems/prisonfriends.js` only (plus this report and the captures under
`artifacts/prison-econ-wave/posse/`). Nothing else in the tree was touched.

Flag: **`CBZ.CONFIG.PRISON_POSSE`**, declared in the file, default `true`.
`?cfg_PRISON_POSSE=0` is the pre-wave prison exactly — no ceiling, no meals, no shelter,
no flank read, and every one of the exposed functions still answers safely (0 / false /
`Infinity`). It sits under `PRISON_FRIENDS`: no friends, no posse to run.

---

## WHAT SHIPPED

All line numbers are `src/systems/prisonfriends.js` at the time of writing.

### 1. The cap is your name (`:178`–`:232`)

| fn | what it answers |
|---|---|
| `renown()` `:178` | one public number: the best of (a) any gang's standing in `CBZ.game.gangStanding` and (b) the highest respect any living man **who is not already your crew** holds for you. Your own men vouching for you is not a name. |
| `tierFor(r)` `:189` / `capNow()` `:193` | 1 → 2 → 3 → 5, on economy.js's OWN standing thresholds (28 "known", 62 "solid", 100 "friend"), so the ladder is legible in the words the interaction cards already print. |
| `syncCrew()` `:201` / `full()` `:202` | the crew count and the ceiling, taken once per slow tick (and immediately on accept / break-up), because `offered()` runs on every card render. |
| `crewNames()` `:206` | the men, in his mouth: up to three names, then "and two more". |
| `heldBack(a)` `:220` | he did the deed and you have no room. **Never true for the "owes you" reason** — the favour-ladder walk-out in quests.js is an ending, not a slot in a line, and capping it would have quietly gated the alternate victory behind crew size. |

`offered()` `:264` now returns false for a held-back man, so **no BEFRIEND button appears**;
`accept()` `:352` refuses a race with his own words (`"You've got Ash. Come back one short."`).
Instead he pitches, once, in the band:

> **You already run with Blue Ace, Ash and Bishop. I'm not standing fourth in nobody's line.**

The ordinal is his actual position and the names are the actual men. When a slot opens
(a death, a quit, a break-up) the tick clears `pfHeldSaid`, zeroes his pitch clock, and
his normal offer is back on the table — the offer is withheld, never thrown away (`:606`).

### 2. Nobody eats free (`:435`–`:503`)

`chowClock()` `:435` edge-detects the schedule block rather than reading a wall-clock hour
(see TOOL FRICTION #4 — the hours are not what the source prints). **Both** chow blocks
count: `mess` and `supper`. A "chow" is a chow.

- `serveChow()` `:449` — once per sitting, per man: if you have a cig and he is within 30 m
  of you, 1 cig via `CBZ.econ.addCigs(-1)`, his missed tally is squared, and the first tray
  each day gets *"Appreciate the tray."*
- `closeChow()` `:465` — when the block ends, everybody who did not eat takes a miss.
- `starve(a)` `:478` — three in a row and he goes: `pfFriend`, `pfSaved` and `pfTrades` all
  reset (so he must be re-earned, not re-clicked), he comes off your shoulder, and he says
  the count:

> **Three chows and nothing. I eat with the Blues now.**

The table he names is his own gang's if he has one, otherwise the one you don't run with.

### 3. Shelter + presence (`:507`–`:534`, exposed `:680`)

```js
CBZ.posseShelterCut(taken)  // 0.25 per living crew within 8 m, capped at 0.75
CBZ.posseFlanked()          // ≥2 living crew within 8 m
CBZ.posseSize()             // live count
CBZ.posseCap()              // the ceiling; Infinity when the flag is off (check isFinite)
```

`posseShelterCut` takes the number the caller was about to take. Pass it and, a couple of
seconds later (once the capture fade and the strike toast are off the screen), the nearest
man says what he palmed: *"They didn't check my sock. 6 of yours are still in it."* It
retries for 30 s until somebody is close enough to be heard. Called with nothing it is a
plain read of the fraction, so a second caller costs nothing.

`CBZ.prisonFriendAudit()` now also reports `cap`, `renown`, `standing`, `flanked`,
`shelter`, `chow: {block, sitting, day}` and per-man `held` / `missed`.

### 4. Untouched laws

Grudge ≥ 6 still ends it, byte-identical (the only addition on that path is a `syncCrew()`
so the slot he vacated is open on the next card render). `offered()` is still recomputed,
never latched. With `PRISON_POSSE=0` every new code path is skipped, not merely disabled.

---

## SEAMS TO WIRE (orchestrator — I did not touch these files)

Both files are being edited by other agents in this wave, so the anchors are quoted by
CONTENT; the line numbers were true when I read them and `ai.js` had already moved ~40
lines under me during the session.

### A. `src/systems/capture.js` — the shakedown (currently line 307)

```js
    const taken = transferring ? 0 : Math.floor((g.cigs || 0) / 2);
    if (taken > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-taken);
```
becomes
```js
    let taken = transferring ? 0 : Math.floor((g.cigs || 0) / 2);
    // WHAT YOUR CREW CAN HOLD (systems/prisonfriends.js). Men standing on you
    // when the wing takes you palm a share of it; one of them tells you after.
    const cut = CBZ.posseShelterCut ? CBZ.posseShelterCut(taken) : 0;
    if (cut > 0) taken = Math.max(0, taken - Math.round(taken * cut));
    if (taken > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-taken);
```
`const` → `let` is the only other change. `taken` is used further down in the hint strings
(`the screws take ${taken} cigs`) and stays true. **Call it once** — it arms the spoken
line each time it is called with a positive `taken`.

### B. `src/entities/ai.js` — the flank read (in `startApproach`, currently line 1532)

`startApproach(n, kind, cost, extra)` is the one chokepoint every shakedown goes through
(considerPlayerApproach has a dozen `startApproach(n, "stickUp"/"tax", …)` sites; guarding
them individually is a dozen chances to miss one). At the very top of the function:

```js
  function startApproach(n, kind, cost, extra) {
    // TWO MEN AT YOUR SHOULDER IS AN ARGUMENT (systems/prisonfriends.js).
    // Nobody opens a tax or a stick-up on a player with crew on him; he waits
    // for you to be alone.
    if ((kind === "tax" || kind === "stickUp") && CBZ.posseFlanked && CBZ.posseFlanked()) {
      n.approachCD = 6 + rng() * 6;
      return;
    }
```
`rng` and `n.approachCD` are both already in scope there, and every caller does
`startApproach(...); return;`, so an early return simply means no approach begins.
If a softer version is wanted, make it a probability rather than a gate — but the odds
are inside considerPlayerApproach in a dozen places and the gate is one line.

### C. HUD (optional, nobody has claimed it)

`CBZ.posseSize()` / `CBZ.posseCap()` are ready for a chip. `posseCap()` returns `Infinity`
when the flag is off — a chip must hide itself on `!isFinite(cap)` rather than print it.

---

## PROOF — the storyboard

`tools/visual-compare.mjs`, one checkout serving both sides, differing only by
`cfg_PRISON_POSSE=0`. The preset lives with the captures (it is a new file and
`tools/visual-presets/` is not my territory — **move it there if you want it kept**):

```
artifacts/prison-econ-wave/posse/prison-posse.mjs      the preset
artifacts/prison-econ-wave/posse/report.html           the report
artifacts/prison-econ-wave/posse/before-after.pdf      the same, printed
artifacts/prison-econ-wave/posse/shots/{before,after}/ 8 plates
artifacts/prison-econ-wave/posse/metadata.json         every reading below

node tools/visual-compare.mjs \
  --preset artifacts/prison-econ-wave/posse/prison-posse.mjs \
  --before local --before-params "cfg_PRISON_POSSE=0" \
  --out artifacts/prison-econ-wave/posse --no-open
```

| plate | BEFORE (flag off) | AFTER |
|---|---|---|
| `01 the-army-you-earned` | crew **3**, no ceiling, silence | crew **1 of 1**, two refused, *"You already run with Ash. I'm not standing second in nobody's line."* |
| `02 flanked` | crew 3, `flanked 0`, `shelter 0%` | crew 3 of 3 (name worth 70, "solid"), `flanked 1`, `shelter 75%` |
| `03 not-standing-fourth` | his card carries **BEFRIEND** + *"You didn't have to step in back there."* | **no button**, and *"You already run with Blue Ace, Ash and Bishop. I'm not standing fourth in nobody's line."* |
| `04 three-chows` | crew 3 still glued to your shoulder after three sittings with 0 cigs | crew **0**, 6 trays missed, *"Three chows and nothing. I eat with the Blues now."* |

Staged through the real seams: the offers are taken with `CBZ.prisonFriendAccept()`, the
trays go out because `CBZ.dayPhase` walks the real `prisonschedule` blocks, and the four
men are the run's own roster (alphabetical, named, de-duplicated). Only positions and your
public standing are pinned.

---

## TOOL FRICTION — `tools/visual-compare.mjs` dogfooded

The tool itself held up: `--before local --before-params` is exactly the right shape for a
behaviour flag, `--only after` + `--subjects` + `--no-pdf` made a 90-second iteration loop,
and `--keep-going` was never needed because nothing crashed. Everything below is friction
in the *staging contract*, not the runner — but every one of them cost a full run, and
they are all invisible until you look at the picture.

1. **A hidden body is still a body.** `group.visible = false` on the extras (the idiom in
   `tools/visual-presets/prison-shank.mjs`) left an invisible thief free to open a real
   stick-up: he took the interaction card ("thief wants 8 cigs to leave your pockets
   alone"), took the subtitle band, and lifted 6 cigs out of the pocket the plate was
   counting. Presets that photograph HUD/dialogue need a real `banish()` — clear their
   approach, park `approachCD`, and push them out of range every frame.

2. **The rig facing note in the shared memory is wrong for these rigs.** "Character rigs
   face local -Z" is carried in the session notes and is baked into at least one preset in
   `tools/visual-presets/`. Photographed: a player rig at `rotation.y = 0` shot from +Z
   shows his **face**, so forward at θ=0 is **+Z** and facing a target is plain
   `atan2(dx, dz)`. Trusting the note produced a plate of four men talking to the backs of
   each other's heads.

3. **Bodies pinned closer than ~1.6 m are a loaded spring.** `entities/ai.js` separates
   overlapping actors by **0.8 units per frame with no damping** (~48 m/s). Pin three men
   at a 1.2 m shoulder mark, release the pin for two thirds of a second, and two of them
   are photographed 49 m and 62 m away. Worth a look on its own terms: that is the force a
   player standing in a crowd is subject to.

4. **`prisonschedule`'s printed hours are not the hours.** The block table is handed out by
   reference and `systems/prisontiers.js` rewrites `from` in place per regime. The live
   table in a default run reads `wake@5 yard@6.5 mess@12 work@13 supper@17.5 count@19.5
   secure@22 night@23` — not the 11.5/17.0 in the source. A preset must ask
   `CBZ.prisonSchedule.blocks` for the hour and land inside the block; hard-coding the
   printed numbers put the sun in Morning Yard while the caption claimed Chow.

5. **`dayplan` caches the live block.** `live()` returns a `cur` that only moves in
   `poll(dt)`, and a subscriber (like mine) samples it on its own 0.4 s slice. Jumping the
   sun through six blocks at 0.67 s of simulated time each reported **one** sitting out of
   three. 1.5 s per jump was enough.

6. **Two clocks own one subtitle.** `interact.js` counts a line's seconds in SIMULATED time
   while `systems/subtitlebus.js` holds the claim on the surface in WALL time — and a
   frozen-rAF storyboard drives those at wildly different rates. Symptoms: a line from the
   previous subject still printed over the next plate, and a line that `CBZ.prisonSayAudit()`
   swore had been spoken with nothing on screen. The cure is per-beat hygiene: blank
   `.pi-subtitle-line`, `CBZ.subtitles.release("pinteractSay")`, then **wait for the line to
   appear** instead of stepping a fixed number of frames past it.

7. **Read the DOM *after* the settle, not before.** The band fades in over 0.14 s of wall
   time. Three runs reported "no line" in the metrics over a plate with the line printed
   across it — the picture was right and the row under it was wrong, which is worse than
   either. The runner's own 180 ms two-frame barrier happens *after* `stage()` returns, so a
   preset that measures the DOM must do its own `await wait(~400)` first.

8. **A HUD chip is not a variable.** Writing `CBZ.game.cigs = 20` directly leaves the corner
   chip painting whatever it last saw: a plate captioned "20 cigs" over a HUD reading 0.
   `CBZ.econ.addCigs(0)` is economy.js's own repaint.

9. **The live sim edits your staging while you stage it.** Over four runs the gang/debt
   simulation walked a debt onto one of the crew and ended the friendship mid-storyboard
   (*"We're done. Don't come near me."* on the plate about missed meals), and moved the
   pinned gang standing enough to change the computed ceiling from 3 to 5 mid-beat, so the
   line the plate exists to photograph did not get said. Anything a plate's argument rests
   on has to be re-asserted every frame, not once at the top.

10. **Small ones.** `metrics` go through `JSON.stringify`, so `Infinity` arrives as `null` —
    the "no ceiling" row is reported as `-1` instead. Ambient prison chatter will caption a
    long beat with whatever the yard happened to say (*"Been waiting on somebody to get to
    Blue Ace."*); there is no way to mute ambient speech for one plate, so the band has to
    be cleared immediately before the beat you are photographing.

---

## OPEN EDGES

- **Nobody consumes `posseFlanked` / `posseShelterCut` yet.** Until seams A and B are wired
  those two plates are a capability, not a behaviour — which is exactly why the `flanked`
  pair's two pictures are identical and only the rows differ. Say so in any write-up.
- **The chow bill needs the schedule.** With `PRISON_SCHEDULE_V1` off there are no blocks,
  so there is no upkeep and a crew is free again. That is the honest degradation, but it
  means the ceiling is doing all the work in a scheduleless run.
- **A man fed at 30 m is fed.** `FEED_RANGE` is a generous "you were at chow together"; it
  does not check that either of you is actually in the mess hall. If somebody teaches the
  prison a real "in the mess hall" predicate, that is the better test.
- **Renown reads the whole yard every 0.4 s.** `renown()` walks all actors inside
  `syncCrew()`; it is one pass on the same slow tick that already walks them twice. If the
  roster ever gets much bigger, fold it into the existing sweep.
- **Two men can carry the same name.** The wing's name pool repeats ("Ash" and "Ash"), so
  `crewNames()` can name the same man twice. That is entities/npc.js's roster, not this
  file, but it is visible in dialogue now in a way it was not before.
