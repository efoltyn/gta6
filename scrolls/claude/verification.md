# Verification — the closed loop, who gates, headless facts

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02). Binding.

## HOW TO VERIFY WORK — the closed loop (read this first)

There is NO test framework here and we don't want one. Verification is
MATH over live game state — never rendered frames. OWNER DOCTRINE: tests
are numbers ("Sims testing"); how things LOOK is the owner's job, judged
by playing. Headless rendering runs ~60x slow (SwiftShader), so any gate
that waits on frames burns minutes to prove nothing — the fast loop reads
state directly and steps the sim by hand. Use after EVERY change:

1. **Syntax** — `node --check <file>` on every touched file. Free.
2. **Math gate** — `node tools/math-gate.mjs [--seeds 90210,1337]` — THE
   universal pass/fail. One headless boot; per seed: builds the world,
   asserts generator invariants (lot/shop/road counts, shop-door
   reachability, region bounds), terrain/biome doctrine (city-on-mountain,
   mountains-outside-snow, PEER-landmass region overlaps — nested venues
   and causeway links are legitimately excluded), then drives the sim
   DIRECTLY — `CBZ.stepSim(dt)` ticks the whole updater chain with no
   rendering, so hundreds of full-speed sim ticks (peds spawn, systems run,
   update-path crashes surface) cost seconds. Re-runs the first seed and
   asserts byte-identical counts + biome histogram (determinism law).
   Must print `MATHGATE: ok`. ~1-2 min for two seeds + determinism.
   EDITING math-gate.mjs: the whole per-seed pass is ONE JS template literal
   (`PASS`) sent via Runtime.evaluate — a BACKTICK anywhere in an added
   comment terminates it early and the SyntaxError points at an innocent word
   (this repo's comment style uses backticks constantly). Same family: a
   ratio like `s*/s` inside a `/* */` block comment closes the comment.
   Always `node --check tools/math-gate.mjs` after touching it.
3. **Targeted in-page probes** — for behavior, write a throwaway CDP script
   (copy the boot boilerplate from `tools/math-gate.mjs`): boot headless
   Chromium, wait for `CBZ.bootComplete`, `Runtime.evaluate` straight into
   the live game, assert on real state (`CBZ.city.arena.lots`,
   `CBZ.cityCrowdAgent(i)`, `CBZ.colliders.length`…), and use
   `CBZ.stepSim(1/60)` bursts to advance time instantly instead of waiting.
   Minutes to write, seconds to run, tests the REAL game — never a mock.

TOOLS ARE YOUR EYES AND HANDS — USE THEM, AND MAKE THEM FASTER (owner,
2026-08-02). An earlier version of this section said visual tools were
"owner-request only, NEVER in the default loop." That was a misreading the
owner has corrected: the rule was never "don't look" — it was BUILD MORE THAN
TEST. Headless Claude is a blind man; the premade tools are his eyes and
hands, and the standing directive is to use them freely AND dogfood them —
every session should leave the instrument shelf faster, sharper or wider than
it found it, so that looking costs seconds instead of a from-scratch harness
every time. The real rules:

- **Reach for a PREMADE tool before writing a throwaway harness.** The shelf:
  `tools/probe.mjs --serve` (ONE live world answers many queries),
  `tools/visual-compare.mjs` + `tools/visual-presets/` (matched before/after
  screenshot sets, deployed site vs local, contact sheet + PDF — add a preset
  instead of a bespoke shot script), `tools/studio.mjs` (asset turntables),
  `tools/street-shot.mjs` (street scene), `tools/ped-lineup.mjs` (the PEOPLE —
  live rigs pulled out of `cityPeds`/`cityCops` and stood in a row on
  deterministic marks; `--filter plain|painted|cop|vendor` picks who, `--cfg
  NAME=0` A/Bs a render flag, and it PROJECTS every staged body through the
  live camera so it reports `outOfFrame` instead of handing you a confident
  photograph of an empty pavement), `tools/city-atlas.mjs` (top-down world), `tools/demolition-check.mjs` (destroy→rebuild arc; its
  FLOATING-GEOMETRY AABB-chain invariant is a good pattern to copy),
  `tools/nuke-sortie-check.mjs` (the ORDERED nuclear sortie end to end —
  order accepted, the parked B-2 claimed with a real pilot, release at the
  SOLVED throw, the canopy proven by arithmetic against the ballistic fall
  from the same height, detonation, bomber clear; and it carries the trap
  that cost two runs to find — a wrapper on a `CBZ.*` handle never sees a
  same-file caller, so detect a detonation by its consequences),
  `tools/smoke-play.mjs` (full RENDERED boot — the only gate on the real
  render path; run before a big deploy or when render code changed),
  `tools/terrain-map-audit.mjs` (deep terrain sweep), `tools/aimlib.js`
  (honest camera aiming from probes),
  `tools/solid-census.mjs` (**IS WHAT WE DREW WHAT WE MADE SOLID?** — the two
  ledgers nothing else cross-checks. It reads every near-vertical triangle in
  the scene as a BARRIER RUN and every `CBZ.colliders` record as a SOLID, then
  reports six numbers: GHOST m of drawn barrier with no collider under it,
  PIERCE crossings where one structure's wall runs through another's interior,
  ROADBLOCK m2 / ROADCUT m of carriageway obstructed, DOUBLE m2 of two
  colliders on one patch of ground, PHANTOM m2 of wall-thin solid with nothing
  drawn in it. `--group <re>` censuses a named venue (footprint read from the
  scene, never typed); `--sweep` walks the NAME LIST rather than the ground,
  because gang city is 17.6 x 15.7 km and a 240 m raster of it is 4,700
  probes of mostly sea. Note the direction: `ghost-collider-check.mjs` finds a
  collider with no geometry, this finds GEOMETRY WITH NO COLLIDER, which no
  screenshot can show you — a fence you walk through is drawn correctly. It
  found the speedway paddock fence at 17.3% solid, 286 m drawn with holes to
  43.8 m, because `CBZ.venueSite.fence` registers nothing unless it is handed
  a ledger and that one call site wasn't. Gates: `--max-ghost/--max-pierce/
  --max-roadblock/--max-roadcut`),
  `tools/breach-check.mjs` (ENOUGH IS ENOUGH — does explosive ACCUMULATE?
  Measures, live: the charge table is the doctrinal 2/5/7/10 rows; ONE 5 lb
  contact brick opens a wall; N standoff rockets do the same and REPORTS N
  rather than asserting a magic number; a wall too thick for any single hit
  opens once the ledger crosses the heavy rows; a vault opens at the pounds it
  declared; and `noBreach` holds at 100 lb. `--escape` runs it in the prison,
  `--off` asserts the BREACH_TABLE_V1 revert. Two traps it already caught and
  that will catch you too: pick a wall by its DECLARED y0/y1 band and detonate
  at that band's mid-height — a fixed 1.4 m silently tests only ground floors
  and the first run "failed" on a wall 14 m up; and the revert path reverts to
  BEFORE breach.js, not to "nothing carves", because the city's own
  blast->structuralBlast chain predates all of this),
  `tools/mode-engine-check.mjs` (ONE ENGINE, EVERY MODE — boots into escape and
  asks by CONSEQUENCE whether Gang City's engine actually reaches the other
  modes: does the shared vault probe accept the prison's own mess furniture,
  does the PLAYER's real `start()` path fire on it, does a HUNTING guard vault
  off guards.js's own mover, and does an RPG blast actually kill men standing in
  its lethal core. `--revert` re-runs the whole thing with `MODE_CAPS_V1=0` and
  asserts the OPPOSITE — the degrade-safe claim proved, not asserted. Copy that
  two-sided shape: a probe that passes before and after proves nothing),
  `tools/prison-polish-check.mjs` (the PRISON, mode "escape" + gungame: the
  armory's slot-per-weapon and take-it-off-the-wall contract, LOS through an
  OPENED door — the losgrid mover trap — the tight-space first-person rule with
  its hysteresis and its player-outranks-it clause, and the "a zero is not news"
  HUD panels; ~2 min, 22 assertions),
  `tools/touch-keycap-check.mjs` (**NO KEYBOARD ⇒ NO KEY LEGEND**: boots the
  prison twice over the same page — once as a mouse, once as a REAL emulated
  iPad via `Emulation.setTouchEmulationEnabled` + `setDeviceMetricsOverride`
  and a reload, so `touch.js`'s own coarse-pointer line fires `enable()` and
  the `@media (pointer: coarse)` rules actually apply — then regex-scans the
  rendered text of every VISIBLE node in the map, the waypoint arrow, the
  rankings panel and the title briefing. Asserts zero key caps on touch, the
  legends still present on a mouse, and that each stripped sentence left a real
  ≥44 px verb behind. ~3 min, 20 assertions. Copy its two-pass shape whenever a
  fix is "different on touch": one pass proves nothing).
- **A probe written twice becomes a tool.** If a task needs a bespoke CDP
  script a second time, promote it into the shelf (or a visual-compare
  preset) rather than retyping it. Tool speed is a feature: a shaved boot
  path or a reused live world compounds across every future session.
- **The cost discipline stays.** Numbers beat frames where a number answers
  the question; don't re-prove what a ratchet already pins. And the final
  call on how things LOOK is still the owner's, judged by playing. But a
  screenshot that answers a real question is work, not waste.

## WHO VERIFIES — builders build, the orchestrator gates

OWNER DOCTRINE (2026-07-27): "their job is to build and have great physics and
realisticness, but not to test. Testing is done by me, the orchestrator, quickly
before merging to main. They just need to focus on research if needed, and
building. **They are artists not scientists.** It will make them not only more
efficient but also make them write more new artistic and meaningful code and
make the world look better — and worry less about testing and more about READING
CURRENT CODE and writing better or new code."

So the loop above is not everyone's job. It splits:

**A BUILDER (subagent) does:** research, read the surrounding code until it
understands the seam it is touching, and build. `node --check` on every file —
that is not a test, it costs nothing, and a syntax error blocks the whole wave.
Then report PRECISELY what it would have verified: the audit calls, the expected
values, and every invariant it thinks its change could plausibly break. It must
still EXPORT its audits so somebody else can call them.

**A BUILDER DOES NOT:** boot a browser. No math gate, no CDP probe, no
screenshot tool. Each of those costs 15-90 s of setup to answer a 3 ms question,
and a parallel wave of them once left 93 orphaned Chrome profiles, 6.6 GB of
disk and ten live headless instances that stopped the owner's real browser from
opening. `tools/probe.mjs --serve` exists so ONE live world answers many
queries; even that is the orchestrator's tool.

**THE ORCHESTRATOR does:** one gate run on the MERGED state, immediately before
push. Not per-agent, not per-file — once, on what actually ships.

WHY THIS IS NOT A LOWERING OF STANDARDS. The number of gate runs is not the
quality signal; what the gate CATCHES is, and it catches the same things whether
it ran once or twenty times. What twenty runs cost is the thing that actually
produces quality here — time spent reading the file you are about to change.
Every genuinely good fix in this repo came from reading, not from running: the
airliner console sitting 0.09 m ABOVE the pilot's eye, the blood soak comparing
a RADIUS against a part's WIDTH, `findRoad` matching a junction to a road it was
never on, the pelvis wearing prison orange because no code path had ever painted
that slot. None of those were found by a test. They were found by reading, and
then a number was written to PIN them.

THE ONE CONDITION that makes this safe, and it is on the orchestrator: the gate
must actually run before merge. Freed from testing, a builder can produce
confident code that does not execute — this repo has already seen a wave leave
`world.js` throwing mid-edit. Builders trade verification for reading time; the
orchestrator owes them the verification back.

HOW A WAVE RUNS (the shape that has shipped cleanly): cheap recon scouts map
each territory FIRST with file:line evidence; the orchestrator writes dense
briefs embedding the recon + owner doctrine + explicit territory fences
("do not touch X, another agent owns it" — fenced briefs are what make
builders reliable); builders build in parallel in the shared tree; the
orchestrator itself applies the cross-territory seam patches at merge (the
one-liners no single builder could own), gates ONCE, commits by territory.
The recurring Edit-race files are `index.html` and `src/config.js` — declare
new flag defaults in the OWNING file via the null-check pattern instead of
config.js. Before pushing, `git fetch` and check `git log`: another live
session (local or the cloud fleet) may have landed commits mid-wave; expect
surgical foreign commits and merge, don't panic.

Escalate depth with risk: a color tweak needs (1); logic needs (1)+(2);
behavior/systems work needs all three. Never commit on (1) alone.

## Headless environment facts (save yourself the debugging)

- Chromium is at `/opt/pw-browsers/chromium`; flags used by every tool:
  `--headless=new --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader --no-sandbox`. Serve via
  `PORT=<n> python3 tools/devserver.py` (CDN is blocked; three.js is
  vendored locally — keep it that way).
- **macOS (the owner's machine): `/opt/pw-browsers/chromium` does NOT exist.**
  Every gate/probe falls back to
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (override:
  `CBZ_CHROME=<path>`; math-gate gained the fallback 2026-07-21). A new tool
  that spawns Chrome must copy this resolution or it ENOENTs on this machine.
- `?cfg_<FLAG>=0/1` URL params override any `CBZ.CONFIG` flag BEFORE boot —
  the only way to A/B a build-time flag headless (a same-page reset reuses
  the already-built world, so flipping after boot proves nothing).
- Probes sending synthetic keys: create ONE KeyboardEvent per press and
  dispatch it ONCE — dispatching the same event object twice throws silently
  and the key never registers.
- Probes that need free play: the campaign boots into the MOTEL opening
  (2026-08-04 merge — phase `motel_name`, then the rooftop handoff); jump
  straight to free play with
  `CBZ.game.cityCampaign.phase = "endless_contracts"`.
- **Baseline console noise**: exactly one `ProgressEvent` error is
  pre-existing and acceptable; rare seed-dependent `computeBoundingSphere`
  NaN too. ANY other error is yours.
- **Sim time crawls headless** (~60x slower: SwiftShader fps + clamped dt).
  NEVER wait wall-clock for game-time events — jump state directly
  (`CBZ.dayCount(n)`, `CBZ.dayPhase(x)`) or burst `CBZ.stepSim(1/60)` in a
  loop (core/loop.js): each call ticks the full updater chain with no
  rendering, so 600 ticks ≈ 10 sim-seconds run at CPU speed.
- **Camera aiming from probes**: NEVER hand-roll teleport+yaw math — a
  sign-convention mistake once had a probe photographing the WRONG BUILDING
  for two rounds while every numeric check passed. Inject `tools/aimlib.js`
  (plain in-page JS) and use `__aim.atLot(lot)` / `__aim.at(...)`: it aims
  the player camera, waits real frames, PROJECTS the target through the
  live camera (NDC must be in-frustum and central), self-calibrates across
  yaw/pitch candidates, and reports collider occlusion. `ok:false` means
  your screenshot would be a lie — fail the gate, don't shoot. (See
  demolition-check.mjs for the wiring; evl needs `awaitPromise: true`.)
- Lots live at `CBZ.city.arena.lots` (the `arena` level, not `CBZ.city`).

