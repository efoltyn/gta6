# The phone bridge — staff corruption priced honestly

`PRISON_PHONE_BRIDGE` · captured 2026-08-25 · `tools/visual-presets/prison-phone-bridge.mjs`

Shots and report: `artifacts/prison-econ-wave/phone/` (`report.html`,
`before-after.pdf`, `shots/{before,after}/`, `metadata.json`).

```
node tools/visual-compare.mjs --preset prison-phone-bridge \
  --before local --before-params "cfg_PRISON_PHONE_BRIDGE=0" \
  --out artifacts/prison-econ-wave/phone --no-open --keep-going
```

Both sides serve from this checkout. The only difference in every pair is the
flag; the world seed (`?seed=90210`) and `Math.random` are pinned inside the
stage, and `CBZ.econ.reseed()` is called after the override so economy.js's own
die (which reseeds itself from `Math.random` at load) matches on both sides.

---

## What the pairs show

| beat | side | quoted | taken | phone access | line |
|---|---|---|---|---|---|
| `payoff-no-phone` | BEFORE | 13 | **13** | no | *"Your name comes off the sheet…"* |
| `payoff-no-phone` | AFTER | 13 | **0** | no | *"What am I doing with cigarettes? You can't reach the street, we got nothing to talk about."* |
| `phone-rental` | BEFORE | 27 | 27 | — | *"Powder, 27. You're rattling when you walk."* · **service in pool: 0** |
| `phone-rental` | AFTER | 15 | 15 | — | *"Ten minutes, and it stays where I can see it."* · **service in pool: 1**, `phoneTimeT` 89.9 |
| `racket-cut-phone` | BEFORE | 25 | 25 | rented | *"You're under my wing for a while…"* |
| `racket-cut-phone` | AFTER | 23 | 23 | rented | *"**Money landed on my sister's app.** You're under my wing for a while…"* |

1. **The refusal teaches.** Before the flag, a bent officer sold a man with
   nothing but tobacco a clean sheet for 13 smokes. After it, the same press on
   the same officer with the same 80 cigarettes in hand spends **zero** and gets
   the explanation, once. Second time he asks, the officer gives the short
   version (`VOICE.guardNoPhone`).
2. **Phone Time is reachable through the real door.** The stage never forces the
   offer — it draws `CBZ.econ.pickOffer(pool)` up to 400 times and asks whether
   a service ever comes out. Flag off: **never** (the branch short-circuits
   before `rng()` is even called, so the stock stream is bit-identical). Flag
   on: yes, and buying it puts **nothing in the bag** — `phoneTimeT` goes to
   89.9 and the inventory is untouched.
3. **The rented window is spent by the call.** In `racket-cut-phone` the window
   is granted, the racket cut is bought, and the post-press audit reads
   `phoneTimeT = 0`. One deep transaction, one shift.
4. **`quoteGap = 0` on all six captures.** The price on the card is the price
   that leaves the pocket — see defect 2 below.

---

## Staging notes (for the next person driving this preset)

- **Bent officers are `CBZ.guards[3]` and `[5]`** (`entities/guards.js:107`).
  The stage takes the first live one rather than a fixed index.
- **A count outranks money.** `economy.js`'s `payoff()`/`bribe()` refuse
  mid-count unless the officer is `bought()`. The schedule block is not ours to
  set, so the stage writes `officer.loyalty = 100`, which is the shipped way
  past that gate and changes nothing else in these transactions. (The runs
  happened to land in `yard` anyway — `audit.block` records it.)
- **Place him, THEN arm him.** `startPayoffApproach` is a man walking at you;
  `considerPayoffApproach` and `updateRacketPressure` both gate on distance.
  Arming before the player is moved gives an offer that dies on the way over.
  Order: `standAt()` → `step(0.5)` → arm → `target._verbs = null` → `step(0.25)`
  → press.
- **`a._verbs` is the freshness test.** `interact.js`'s `render()` stamps the
  verb list on whichever actor is focused, and `CBZ.doInteract(idx)` acts on
  *its* internal `current`, not on anything you pass. Nulling `_verbs` and
  requiring it to reappear is how the stage knows the card is about the right
  man. There is a till-level fallback (`CBZ.resolveGuardApproach` /
  `CBZ.econ.trade` direct) that records `pressFallback: 1` rather than
  pretending the button worked; it did not fire in either run.
- **The subtitle survives a frozen rAF.** `tickSay(dt)` runs off
  `CBZ.onAlways(96)`, so the line only ages when the stage calls `stepSim`.
  Budget is 2.8 s; the stage spends 0.07 s after the press. Do not `step()`
  freely between the press and the return.
- **Freeze rAF *after* hiding the boot card** (`CBZ.bootMeter.hide()`), or every
  shot is a photograph of "BUILDING THE WORLD".
- The dealer card in `02-phone-rental` shows **the next** offer, not the one
  bought — `trade()` restocks the stall on the way out. The bought item is in
  the spoken line and in `metadata.json`.

## Tool friction (`tools/visual-compare.mjs`)

1. **`width`/`height` on a preset are silently ignored.** The reader is
   `args.width || preset.viewport?.width || 960` (`visual-compare.mjs:204`) —
   the key is `viewport`, and `--help` only says "defaults: preset or 960x600"
   without naming it. A preset that sets `width: 1100` gets 960 and no warning;
   the only tell is the `Frames: custom 960x600@1x` line scrolling past. Either
   accept both spellings or warn on the unread key.
2. **The post-stage compositor barrier is a no-op for deterministic presets.**
   The settle does `requestAnimationFrame(() => requestAnimationFrame(finish))`
   — but every preset that freezes the sim has already replaced
   `window.requestAnimationFrame` with a stub, which is exactly the class of
   preset that needs the barrier. It works only because of the parallel
   `setTimeout(finish, 180)`. The rAF half should be captured at module load,
   or the tool should notice the stub and lean on the timeout.
3. **`metadata.json`'s capture rows are not the shape the subject list is.**
   `captures[i].id` is a bare string while `subjects[i]` are objects; a first
   pass reading `captures[i].subject.id` throws. Undocumented.
4. **A metric cannot be N/A for one beat.** `quoteGap` is meaningless on the
   refusal capture (nothing was sold), so it has to be forced to `0`, which
   reads on the Measurements page as a pass rather than as "not applicable".
   A `null` that renders as `—` would be honest.
5. **`--before local` + `--before-params` compose correctly on top of the
   preset's own `defaultBefore`/`beforeParams`** — passing both, as the wave
   asked, is harmless and produced identical URLs. No friction; recorded because
   it is the thing most likely to be doubted.
6. The flag-A/B mechanism (`defaultBefore` + `beforeParams` + the label
   overrides so no banner lies about a "DEPLOYED" side) is documented only in
   `tools/visual-presets/README.md`, not in `--help`. It is the most useful mode
   the tool has and the least discoverable.

## Seams left for other territories

- **`src/entities/ai.js` still owns nine `racketDebt` writers** with two more
  ceilings (50 and 60) — the inmate side of the same tab. `grep -n 'racketDebt
  = Math' src/entities/ai.js` lists them; each is a one-line swap to
  `CBZ.econ.addRacketDebt(delta)` (published, clamps at `RACKET_DEBT_CEIL = 60`,
  handles the `Math.max(0, …)` floor itself).
- **`src/systems/interact.js:632` `guardPayoffWorthIt()` can never be true in
  the prison.** It reads `g.heat`, then `g.detect`, then `a.racketDebt`, then
  `g.wanted`. `g.heat`/`g.wanted` are CITY fields (`src/city/wanted.js`),
  `g.detect` exists nowhere in the repo, and the racket tab is `g.racketDebt`
  on the game — not on the actor. Escape-mode heat is `g.detection`. Net
  effect: the bare **PAYOFF verb is never offered on a bent officer** (line 556
  falls through to `bribe` every time), so the whole clean-sheet transaction is
  reachable only through an approach card. One line fixes it.
- **`src/systems/interact.js:741`** carries a fallback payoff price that still
  has the deleted `+14` warden premium. It only fires if `CBZ.econ.payoffCost`
  is missing, so it is dead today — but it is the last copy of the number this
  wave just removed and should go with it.

## Machine discipline

`uptime` before each run: 4.3 and 3.4 one-minute load, zero
`chrome-headless`/`Chrome for Testing` processes already up. Two runs, three
subjects each, one 960x600 viewport, ~90 s per run. Nothing else was launched
and no other session's browser was touched.
