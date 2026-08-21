# Visual comparison presets

`tools/visual-compare.mjs` turns two browser builds into a matched screenshot
set, HTML contact sheet, and print-ready PDF. It starts a local server for the
`after` side when `--after` is omitted and opens the PDF on macOS by default.

```sh
npm run visual:wildlife
npm run visual:mounted-riders
npm run visual:compare -- \
  --preset wildlife-attachments \
  --before https://efoltyn.github.io/gta6/ \
  --subjects lion,bison
```

Useful flags are `--after URL`, `--out DIR`, `--limit N`, `--no-open`, and
`--width N --height N`. For fast look iteration, `--only after` writes the
screenshots **and** their stage data to `metadata.json`. A later matched run can
use `--reuse-before DIR` to copy an earlier run's deployed pixels and camera
metadata instead of reopening the baseline build. The reuse directory and new
output directory must differ. Run `npm run visual:compare -- --help` for the
complete short reference.

## Flag A/B — the honest before for a behavior change

`--before local` serves **both** sides from this checkout and applies per-side
query params as the only difference — usually one `cfg_*` flag flipped off so
the before side runs the pre-wave code path byte for byte. The deployed build
differs by every commit since deploy; a flag flip differs by exactly the change
under test. A preset can make this its default shape with
`defaultBefore: "local"` plus `beforeParams: { cfg_MY_FLAG: 0 }` (and
`beforeLabel`/`afterLabel` so no banner lies about a deployed side); the CLI
composes with `--before-params "cfg_X=0&k=v"` / `--after-params` for one-off
experiments. `npm run visual:npc-tactics` is the working example: the NPC
firing-position wave photographed against its own one-line revert.

## Pacing changes — never wait a number of seconds

If the thing under comparison is **how long something takes**, a wait written
in seconds silently breaks the comparison. `tsunami-stages` had three beats
that waited "6 s into the drawdown", "5 s into the flood", "2.2 s into the
drain"; when the event was retimed, the same six seconds walked out of the
drawdown into the wave and the inundation shot landed in the drain — two sides
photographing different moments, captioned as if they were the same one.

Wait on a **physical condition** instead, and where the beat lives inside a
phase, on a **fraction of that phase** read back off live state: the phase
name, where a front is, how far a level has fallen. Then both sides reach the
identical picture and the clock becomes the answer rather than the question.
Publish that clock as a metric (`eventT` in both tsunami presets) and the
Measurements page reads directly as "the same beat, N seconds sooner".
`tsunami-stages` and `city-tsunami-stages` are the worked examples.

## Film strips — motion photographed as stills

A still cannot show "he stopped to shoot"; a row of frames can. A subject may
declare `strip: { frames: N, stepSec: s }` — after its staged frame is shot,
the runner calls the page's `__cbzVisualCompare.advance(stepSec)` hook between
`N-1` further captures, so both sides photograph the **identical simulated
seconds**. The report grows a film-strip page per such subject: the before and
after rows side by side over time. If the page exposes
`__cbzVisualCompare.metrics()`, the numbers it returns after the strip are
merged into that subject's metrics — sampled over exactly the photographed
frames, so the pictures and the measurements describe the same moment.

## Device frames

A layout regression is a shape, not a pixel: the same screen can be right at
393pt and wrong at 852pt. `--devices` captures every subject once per device
frame instead of once per run, and `--orientations portrait,landscape` rotates
the ones that rotate (`laptop` and `desktop` do not, so they are captured once).

```sh
npm run visual:compare -- --preset intro-screen \
  --before https://efoltyn.github.io/gta6/ \
  --devices iphone-16,ipad-mini,laptop --orientations portrait,landscape
```

`--frames iphone-16:landscape,ipad-mini:portrait,laptop` names an explicit
mixed set, and a preset can ship its own default as `frameList: [...]` so a UI
comparison is reproducible months later without CLI archaeology. Run `--help`
for the device ids.

A frame is a viewport **with its device identity** — pixel ratio, mobile flag,
touch emulation, user agent, screen orientation — applied *before* navigation,
because `body.touch`, the quality tier and the control layout are all decided
once at boot. Each frame therefore costs one page load per side. The report
gains a per-subject overview page showing every frame at once, and each frame
still gets its own full-size before/after page. Known limit: Chrome cannot
emulate safe-area insets, so notch and home-bar overlap stay invisible here and
still need a simulator.

PDF output is rendered by a clean standalone Chrome process after the capture
browser and its simulated worlds are released. `--print-only` uses that same
path to rebuild an existing report PDF without navigating or recapturing; this
keeps large galleries from inheriting WebGL memory or a stalled CDP printer.

A preset is an ES module whose default export contains:

- `id`, `title`, `description`, and optional `viewport`
- `subjects`: stable objects with at least `id`; labels and capture hints may be
  added for the staging function
- `readyExpression`: a side-effect-free browser expression proving the source
  page's APIs are ready
- `stage(input)`: a self-contained function that can be serialized into either
  page, renders one requested subject at a deterministic view, and returns an
  object with `ok: true`

On the `after` pass, `input.referenceStage` is the complete result returned by
the matching `before` stage. Return camera/framing data from the baseline and
reuse it from `referenceStage` when exact camera matching matters.

If a repair deliberately moves the photographed subject to a new coordinate
frame, a preset may export `transformReferenceStage({subject, stage, viewport})`.
The runner applies that transform once, only while handing baseline metadata to
the after side, whether the baseline was captured fresh or supplied through
`--reuse-before`. Keep the transform explicit here instead of silently moving a
reference camera inside `stage`; the copied before metadata must continue to
describe the pixels that were actually captured.

Optional preset fields for live-world and performance comparisons:

- `urlParams`: object merged into both source URLs (e.g. `{seed: 90210}` or
  `cfg_*` flags) so both sides boot the same deterministic world
- `stageTimeoutMs`: per-stage evaluation budget — raise it when the first
  stage boots a full world (default 60000)
- `stage` may be `async`: the runner awaits its promise, so a stage can click
  through the title screen, wait for `CBZ.bootComplete`, burst
  `CBZ.stepSim(1/60)` to advance sim time, then render
- a deterministic stage that freezes animation may install
  `window.__cbzVisualCompare.render`; the runner awaits its result before the
  compositor barrier, so the screenshot cannot retain a stale WebGL camera
  after stage metadata has already advanced
- **Sequenced subjects**: subjects run in declaration order inside one page
  per side, so a preset can treat them as a storyboard — detonate/trigger once
  in the first stage, then each later stage advances the same live event
- `metrics`: stage results may carry `metrics: {key: number}`; declare
  `preset.metrics[key] = {label, unit, better: "lower"|"higher"}` and the
  report gains a Measurements page with before/after values and colored
  deltas (plus everything lands in `metadata.json`). `metricsNote` overrides
  the page's caption.

The core deliberately owns navigation, fresh browser state, matched viewport,
baseline-stage handoff, compositing barriers, file naming, screenshots, report
layout, PDF printing, and opening the result.
New visual domains only need to describe their subjects and staging recipe.

## Reading the answer back (the wrapper)

`node tools/before-after.mjs <preset>` (`npm run ba -- <preset>`) is how these
are actually run. The engine's HTML/PDF report is the output for a person with
a screen; the wrapper exists because the two most frequent callers — a CI job
and an agent — cannot open either one. It prints three things when a run
finishes:

- **the measurements table** — your declared `metrics`, before against after,
  with the delta marked against your `better` direction. `--no-summary` off.
- **a VERDICT line** — how many metrics moved the right way vs the wrong way.
  `--gate` turns that into the exit status (2 on any regression), so a preset
  becomes a check you can run rather than a report you have to read.
- **the pairs** — every subject stitched into ONE labelled side-by-side PNG
  under `<report>/pairs/`, with absolute paths printed. `--no-pairs` off.

That last one is not a convenience, it is the point. **Declare metrics, but
never trust them alone.** A metric can only ever check the thing you already
thought to declare when you wrote the preset. "The pectoral fin is a
rectangle", "the wake reads as a speedboat's", "the roll-over looks like a
rotation glitch" are all fatal and none of them is a number anybody declared.
Open the pair image and look at it — that is what the pairs exist for, and for
an agent it is the difference between checking the work and guessing at it.

So a good preset does both jobs at once: it declares numbers precise enough to
gate on, AND it frames each subject so a single glance at the stitched image
says whether the thing is right. If a subject's picture cannot be judged by
eye, the camera is in the wrong place — fix the staging, don't add a metric to
cover for it.
