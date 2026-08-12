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
