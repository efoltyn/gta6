# TESTING-LOOPS.md — the A/B benchmark of verification loops

**Verdict:** `tools/math-gate.mjs` is the single central gate. Nothing else is a
real automated pass/fail gate (see below). The only open questions were its
*configuration* and *when a second, slower loop is still mandatory*. This file
answers both from measurement, not theory — every fault below was planted one at
a time in a worktree copy, run, and reverted (`git checkout` between trials;
never committed).

## TL;DR — the gate commands

```
# PER-MERGE (default, every merge) — ~131s, catches every fault CLASS math-gate can:
node tools/math-gate.mjs
#   == 1 seed (90210) · 400 sim-ticks · determinism re-run ON.
#   The default --ticks was lowered 600 -> 400 (see "Optimal --ticks").

# PRE-DEPLOY / before a big merge — ~193s, adds a 2nd seed's emergent coverage:
node tools/math-gate.mjs --seeds 90210,1337 --ticks 600
#   THEN, only if render-path code changed (shaders/materials/camera/rig/vehicle):
node tools/smoke-play.mjs        # ~206s, the ONLY loop that forces a real render + screenshot
```

`node --check <file>` on every touched file first — free, always.

## Ranked loops (measured, this tree, WORLD_ENLARGE_V2)

| Rank | Loop / config | Wall | Is it a gate? | Role |
|---|---|---|---|---|
| 1 | **math-gate `1 seed · 400t · det`** (bare default) | **131s** | YES (exit 1 on FAIL) | **per-merge central gate** |
| 2 | math-gate `2 seed · 600t · det` | 193s | YES | pre-deploy (adds seed-1337) |
| 3 | math-gate `1 seed · 0t · nodet` (floor) | 49s | YES (build-time only) | quick structural probe |
| 4 | smoke-play (rendered) | 206s | WEAK — exit code = console-errors + never-settled ONLY | render-path specialist |
| 5 | terrain-map-audit | 250s | NO — always exit 0 | human-read terrain diagnostic |

Per-build cost breakdown (why the levers are what they are): one headless
**world build ≈ 40-50s** (the fixed floor, unavoidable). Each extra build — a 2nd
seed, OR the determinism re-run — adds another ~50-65s. The **sim burst** (ticks)
is ~12s at 400 / ~17s at 600 per build. So **# of builds dominates**; ticks are a
secondary lever; the render frame-window (smoke-play) is pure overhead that buys
almost nothing here (see F3).

## The fault matrix (planted, one at a time)

Detection = a FAIL / non-zero exit pointing at the right neighborhood.
`math-gate` column = the recommended `1 seed · 400t · det` config (a superset of
each fault's minimal catching config, so it catches everything math-gate can).

| # | Planted fault (site) | math-gate | smoke-play | terrain-audit | Catch mechanism / note |
|---|---|---|---|---|---|
| **F1** | PEER region overlap — desert **north** into farmland (`biome_desert.js:54` CZ 150→-150) | **CATCH** (build-time, 33s) | miss (invariants print-only, exit 0) | shows (12→13, human) | `REGION OVERLAPS: 1 [The Saltlands x Coyle Valley ~109200u2]` |
| **F2** | Broken updater, **immediate** throw (`peds.js:4216` onUpdate 34) | **CATCH** (38s) | **CATCH** (exit 2) | miss (no error listener) | `console.error("[updater]", …)` — loop.js wraps every updater in try/catch |
| **F3** | Broken updater, **delayed** (throws when `elapsed>5s`) — *inherited* | **CATCH** at ticks≥~320 (400 yes; 100/0 **MISS**) | **MISS** (renders only ~1 frame — never reaches 5 sim-s) | miss | needs the stepSim burst to cross the 5-sim-second (tick 300) boundary |
| **F4** | Missing landmass — farmland `addLandmass` disabled (`biome_farmland.js:111`) | **MISS** (332→318 lots, shops still ≥12) | miss | biome absent from histogram (human) | no biome-presence assertion |
| **F5** | Orphan shop doors — door offset 1.6→60u (`towngen.js:584`) | **CATCH** (36s) | miss — *computes & PRINTS* `FAIL: N shop doors` but **exits 0** | miss | `31 shop doors far from any road` |
| **F6** | Determinism break — `Math.random()` lot-split jitter (`towngen.js:365`) | **CATCH** (det re-run, 94s) | miss (no det) | miss (no det) | `DETERMINISM: 332/189/162 vs 339/194/162` |
| **F7** | NaN leak — `terrainHeight` returns NaN over a far-field patch (`terrain.js:189`) | **MISS** (step 50 AND 20) | miss | **miss** (reliefMean stays 51.75) | every sweep reads `terrainHeight()`**`||0`** → `NaN||0===0`. Totally masked. |
| **F8** | Silent world shrink — town block loop halved (`towngen.js:377`) | **MISS** (332→**196** lots, 185→**119** shops, still "ok") | miss (prints 196 lots, exits 0) | AABBs shrink (human) | only floors are `lots>0`, `shops≥12`; det identical (both builds shrink) |

**math-gate catches: F1, F2, F3, F5, F6.  Misses: F4, F7, F8.**

### The three misses share ONE root cause — no golden baseline
F4 (whole biome gone), F7 (NaN hole), F8 (40% of the world silently gone) all
pass because the gate asserts **invariants** (structure valid, doors reachable,
regions don't interpenetrate, world is deterministic) but never compares against
a **known-good baseline**. Nothing violates an absolute rule, so nothing fails.
**No `--ticks` / `--seeds` / `--step` / `--nodet` value closes this** — it is a
missing-assertion class, not a tuning problem. smoke-play and terrain-audit miss
them too (smoke's structural checks are print-only; terrain-audit always exits 0).

Recommended follow-up (a *logic* change, deliberately NOT made here — this task
patches DEFAULTS only): add to math-gate's PASS, per seed, three cheap asserts —
(1) **golden counts** with a tolerance band (e.g. seed 90210 lots∈[320,345],
shops∈[178,195]; seed 1337 lots∈[325,350], shops∈[186,205]) to catch F4/F8;
(2) an explicit **`Number.isFinite(rawTh)`** probe over the sweep (do NOT use
`||0`) to catch F7; (3) a **biome-presence set** (desert/farmland/snow/forest/…
must all appear in the histogram) to catch F4 by name. These three would take the
gate from 5/8 to 8/8 at zero extra build cost.

## Key measured findings that drove the config

- **Ticks only matter for the DELAYED-crash class (F3).** An *immediate*
  every-tick throw (F2) is caught even at `--ticks 0` — the page's natural rAF
  loop fires ~1 frame before the state is read (`at loop loop.js:95`, 1 error).
  But that 1 frame is ~0.02 sim-seconds; a crash gated on accumulated game-time
  needs the **stepSim burst**. Inherited F3 data: saturation boundary = **tick
  300 exactly** (5 s × 60/s); throws from tick ~294; `--ticks 100`=1.67 sim-s
  MISS, `--ticks 400`=6.67 sim-s CATCH. **Optimal `--ticks = 400`**: clears the
  known boundary with 33% headroom, trims ~10s/run vs 600. Use `--ticks 600`
  (10 sim-s) pre-deploy for extra headroom on the unknown tail of that class.
- **The determinism re-run is the one thing that needs a 2nd build on a single
  seed** (F6, count/histogram divergence). It is non-negotiable for a
  multiplayer-deterministic game, so det stays ON in the default (+~55s, worth it).
  Caveat: det compares **counts + biome histogram only** — a sub-threshold
  *positional* `Math.random` that changes no count would slip through. The
  canonical lot-jitter fault DOES change counts, so it is caught.
- **A 2nd seed is a full extra build (~62s) and caught no additional fault CLASS
  here** — all planted faults are seed-independent (structural). Its real value is
  *seed-specific emergent* overlaps/crashes (the procedural world genuinely
  produces these). That is a pre-deploy concern, not a per-merge tax. Hence the
  tiering: 1 seed per-merge, 2 seeds pre-deploy.
- **"Move a biome and you planted an overlap" is FALSE.** The canonical
  "desert 120u **west**" shift catches **nothing** — correctly: the speedway
  region is `underlay:true` and its causeways are name-matched links, both
  legitimately excluded, and farmland is Z-separated (they already share X). A
  real peer overlap needs two non-underlay, non-link, different-biome regions to
  actually interpenetrate (desert **north** into farmland does it: F1). The
  overlap check's scoping is correct, not blind.

## When rendered smoke-play is still MANDATORY (honest blind spots)

math-gate boots a real WebGL context (SwiftShader) and runs ~1-2 natural render
frames, so a **gross** shader-compile / program-link failure that throws on first
draw *would* surface as a console error in math-gate too. What math-gate can
**never** see, and smoke-play's forced full-frame **screenshot + readback** can:

- **Silent render corruption** — an all-black / NaN-camera / wrong-projection
  frame that throws no error. math-gate reads state numbers, never pixels.
- **Draw-path / material bugs** that only manifest during sustained rendering
  (batch-merge visual breakage, texture/encoding, LOD pop) rather than at build.
- **WebGL-only warnings/state** that don't reach `console.error`.

So: run `smoke-play.mjs` once **before a big deploy, or whenever render-path code
changed** (shaders, materials, camera, batching, rig/vehicle refactors). Do NOT
put it in the per-merge loop — it is 206s, it is a *weak* automated gate (its exit
code reflects only console errors + a never-settled world; all its lot/shop/door
invariants are **print-only**), and — proven here — it renders only ~1 frame, so
it is strictly WORSE than the stepSim burst at the delayed-crash class (F3 MISS).
Its job is the eyeball frame, not the math.

`terrain-map-audit.mjs` is a **diagnostic, not a gate** (always exit 0). Use it
only for terrain-focused work, and read its numbers by hand: on a clean tree it
already reports 12 region overlaps (nested venues + causeways its looser logic
doesn't exclude) and 40+/25 "mtn-outside-snow / city-on-mtn" cells from its deep
±3200 backdrop sweep — all baseline noise to be ignored, not regressions.

## Clean baselines (unmodified tree, for regression reference)

```
seed 90210 : 332 lots / 185 shops / 162 roads   (task-stated ~329/182/162)
seed 1337  : 346 lots / 196 shops / 162 roads   (task-stated ~337/194/162)
math-gate 1s·400t·det : MATHGATE: ok, 131s   (RECOMMENDED per-merge)
math-gate 2s·600t·det : MATHGATE: ok, 193s   (pre-deploy)
smoke-play             : exit 0, 206s, "invariants: ok (332/185/162)", 1 render frame
terrain-audit seed 90210: exit 0, 250s, 12 overlaps, relief max 1232u / mean 51.75u
```

A loop that FAILS on this clean tree is disqualified. All recommended configs
pass clean. False positives are poison; none were observed.

## Bottom line
- **Central gate, every merge:** `node tools/math-gate.mjs` (now 1 seed · 400
  ticks · det). ~131s. Catches overlaps, orphan doors, immediate & delayed
  updater crashes, and non-determinism.
- **Pre-deploy:** `node tools/math-gate.mjs --seeds 90210,1337 --ticks 600`
  (+seed-1337 emergent coverage) then `node tools/smoke-play.mjs` if render-path
  code changed.
- **Known blind spots (all loops):** whole-biome removal, terrainHeight NaN, and
  silent world-shrink — none are catchable by configuration; they need the three
  golden-baseline asserts noted above.
