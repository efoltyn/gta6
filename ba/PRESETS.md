# The preset contract

A **preset** is the reusable half of a comparison: it names the subjects worth
photographing and describes how to stage each one, so that `ba` can produce the
same shot from two different builds of your app and put them side by side.

```sh
ba                          # list every preset this project has
ba checkout-flow            # run one
ba checkout-flow --before https://your-app.example.com/
ba checkout-flow --json     # report path + measurements on stdout, for a harness
```

The core owns everything that makes a comparison *trustworthy*: browser
lifecycle, fresh state per side, matched viewports, device identity, the
baseline→after handoff, compositor barriers, file naming, screenshots, the HTML
contact sheet, the PDF, and the measurements table. A preset only describes
**what to look at and how to stand there.** Run `ba --help` for the complete
flag reference; this document is about the module you write.

---

## The module

A preset is an ES module in your project's preset directory (`presets:` in
`ba.config.mjs`) whose default export contains:

```js
export default {
  id: "checkout-flow",
  title: "Checkout — the three screens that lose people",
  description: "One seeded cart, photographed at each step of the flow…",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.APP && APP.ready",
  subjects,
  stage,
};
```

- **`id`** — matches the filename; how you name it on the command line.
- **`title`**, **`description`** — the report's cover page. The description is
  where you say what the reader is supposed to be judging.
- **`viewport`** — optional `{width, height}`; the CLI can override.
- **`readyExpression`** — a **side-effect-free** browser expression that proves
  the page's own APIs exist. The engine polls it before staging anything. Keep
  it cheap and keep it honest: it runs against the *old* build too, so it must
  not name something only the new build has.
- **`subjects`** — stable objects with at least `id`. Everything else on a
  subject is yours: labels, focus text, camera hints, wait conditions. The
  engine passes each one back to `stage` untouched.
- **`stage(input)`** — the staging function.

### `stage(input)`

`stage` is **serialized to source and evaluated inside the page** — both pages,
one function. It therefore cannot close over anything in your module: no
imports, no module-scope constants, no helpers defined outside it. Everything it
needs must be in its own body, on the page, or in `input`.

That constraint is the feature. One function that runs identically on both sides
is why the two screenshots are comparable rather than merely similar.

`input` carries:

| field | what it is |
| --- | --- |
| `subject` | the subject object you declared, verbatim |
| `side` | `"before"` or `"after"` |
| `sourceUrl` | the final URL after redirects — put it in the caption |
| `width`, `height` | the viewport being captured |
| `frame` | `{id, device, label, orientation, width, height, dsf, mobile}` |
| `beforeLabel`, `afterLabel` | the banner text, CLI-overridable |
| `referenceStage` | on the after side: the before side's returned stage object |

Return an object with **`ok: true`** and whatever the report should know:
camera data, measured state, `metrics`. Return **`ok: false`** with a reason
when the subject is not there.

**That second half is the whole discipline.** A stage that cannot find its
subject must fail rather than photograph the space where the subject should
have been. A shot that cannot find its subject is a lie, and the preset should
say so instead of shipping a picture of an empty page:

```js
if (!APP.cart.items.length) return { ok: false, err: "empty cart — nothing to photograph" };
```

`--keep-going` turns a failed subject into an error page in the report instead
of a dead run, so honest failure costs you one page, not the storyboard.

### `referenceStage` — matched staging

On the `after` pass, `input.referenceStage` is the complete result returned by
the matching `before` stage. When exact framing matters, return the camera (or
scroll offset, or layout box) from the baseline and **reuse it from
`referenceStage`** instead of recomputing it.

This exists because an "after" once framed a different shot than its "before"
and the pair was captioned as if they were the same one. Recomputing a camera
from live state gives you two cameras; copying one gives you a comparison.

If a repair deliberately moves the subject to a new coordinate frame, export
`transformReferenceStage({subject, stage, viewport, frame, referenceResult})`.
The engine applies it once, only while handing baseline metadata to the after
side — including when the baseline came from `--reuse-before`. Keep the
transform explicit there rather than silently moving a reference camera inside
`stage`: the copied before metadata must keep describing the pixels that were
actually captured.

---

## Flag A/B — the honest before for a behavior change

`--before local` serves **both** sides from your working tree and applies
per-side query params as the only difference — usually one feature flag flipped
off, so the before side runs the pre-change code path byte for byte.

A deployed baseline differs from your working tree by every commit since the
deploy. A flag flip differs by **exactly the change under test**. When you are
comparing behavior rather than looking at drift, this is the only baseline that
means anything.

A preset makes this its default shape with:

```js
defaultBefore: "local",
beforeParams: { ff_new_checkout: 0 },
beforeLabel: "BEFORE · FLAG OFF (ff_new_checkout=0)",
afterLabel:  "AFTER · FLAG ON",
```

Set the labels. A run whose before side is your own checkout must not be
stamped with a banner that says DEPLOYED — the banner is part of the evidence.
The CLI composes on top with `--before-params "ff_x=0&k=v"` / `--after-params`
for one-off experiments.

The listing (`ba` with no arguments) prints a **baseline column** — `self` for
flag A/B, `pinned` when the preset names its own before, `deployed` otherwise —
because you cannot tell from a preset's name which kind of "before" you are
looking at, and that is the first thing you need to know before trusting the
left-hand column.

---

## Pacing changes — never wait a number of seconds

If the thing under comparison is **how long something takes**, a wait written in
seconds silently breaks the comparison.

The worked failure: a storyboard had three beats that waited "6 s into the
drawdown", "5 s into the flood", "2.2 s into the drain". When the event was
retimed — which was the entire change under test — the same six seconds walked
out of the drawdown into the wave, and the inundation shot landed in the drain.
Two sides photographing different moments, captioned as if they were the same
one. The report looked fine. It was worthless.

Wait on a **physical condition** instead: the phase name, where a front is, how
far a level has fallen, whether the route committed. Where a beat lives *inside*
a phase, wait on a **fraction of that phase** read back off live state, never on
a count of seconds into it.

Then both sides reach the identical picture and **the clock becomes the answer
rather than the question.** Publish that clock as a metric and the Measurements
page reads directly as *"the same beat, N seconds sooner."*

```js
// not this
await sleep(6000);

// this
while (guard-- > 0 && APP.phase() !== "flooded") step(0.1);
while (guard-- > 0 && APP.audit().floodT / APP.audit().floodBudget < 0.55) step(1 / 30);
```

Every poll gets a guard count. A loop that can hang forever on a build where the
condition never arrives will hang forever, and the run dies with no report at
all instead of one honest `ok: false`.

---

## Film strips — motion photographed as stills

A still cannot show "he stopped to shoot"; a row of frames can.

A subject may declare `strip: { frames: N, stepSec: s }`. After its staged frame
is shot, the engine calls the page's `window.__ba.advance(stepSec)` hook between
`N-1` further captures, so both sides photograph the **identical simulated
seconds**. The report grows a film-strip page per such subject: the before and
after rows side by side over time.

If the page exposes `window.__ba.metrics()`, the numbers it returns after the
strip are merged into that subject's metrics — sampled over exactly the
photographed frames, so the pictures and the measurements describe the same
moment.

For an app with no simulation clock, `advance` can step whatever your time is:
an animation timeline, a queued state machine, a fake timer.

---

## Device frames

A layout regression is a shape, not a pixel: the same screen can be right at
393pt and wrong at 852pt.

```sh
ba checkout-flow --before https://your-app.example.com/ \
  --devices iphone-16,ipad-mini,laptop --orientations portrait,landscape
```

`--devices` captures every subject once per device frame instead of once per
run, and `--orientations` rotates the ones that rotate (`laptop` and `desktop`
do not, so they are captured once). `--frames iphone-16:landscape,laptop` names
an explicit mixed set, and a preset can ship its own default as
`frameList: [...]` so a UI comparison is reproducible months later without CLI
archaeology.

A frame is a viewport **with its device identity** — pixel ratio, mobile flag,
touch emulation, user agent, screen orientation — applied *before* navigation,
because a page decides its shape at boot. Each frame therefore costs one page
load per side. The report gains a per-subject overview page showing every frame
at once, and each frame still gets its own full-size before/after page.

Known limit: Chrome cannot emulate safe-area insets, so notch and home-bar
overlap stay invisible here and still need a simulator.

---

## Metrics — the numbers beside the pictures

A stage result may carry `metrics: {key: number}`. Declare what each one means:

```js
metrics: {
  ttiMs:      { label: "Time to interactive", unit: "ms", better: "lower" },
  layoutShift:{ label: "Cumulative layout shift",        better: "lower" },
  itemsShown: { label: "Products above the fold",        better: "higher" },
  faceH:      { label: "Face height", unit: "m" },   // no direction: read per beat
},
```

and the report gains a **Measurements page** — before against after, with the
delta coloured against the direction you declared — which also prints to stdout
when the run finishes, and lands whole in `metadata.json`.

Rules that were paid for:

- **`better` is a declaration, not a guess.** A metric with no honest direction
  gets none, and is read per subject. Face height is right when it is tall at
  landfall and wrong when it is still tall halfway inland; a green arrow there
  would be a lie with a colour.
- **Declared metrics only.** A stage often returns a whole diagnostic dump;
  only the keys named in `preset.metrics` are printed. Set
  `metricsWhitelist: true` to make that strict. The rest stays in
  `metadata.json` for debugging, out of the report.
- **`metricsNote`** overrides the Measurements page caption. Use it to say what
  a metric means, and especially to say **what a zero means** — a build that
  predates a counter reports 0, which is "not measured", not "none happened".
  Say which rows are new, or the old build gets blamed for the instrument.
- **Measure like-for-like.** Prefer a number both builds already publish over a
  counter only the new side can answer. A metric the before side cannot compute
  is not a comparison, it is an announcement.

---

## Sequenced subjects — the storyboard

Subjects run in **declaration order inside one page per side**, so a preset can
treat them as a storyboard: trigger the event once in the first stage, then have
each later stage advance the same live event to its next beat.

The trap, stated plainly: this makes subject order load-bearing, and a beat that
quietly inherits its predecessor's setup **cannot be run alone**. A storyboard
beat that was run on its own once photographed an idle world with a fallback
camera and cheerfully reported `ok: true` — the one thing a preset must never
do. Either every beat stages its own subject, or the ones that deliberately
inherit say so in a comment and the preset's description warns you.

Cache the one-time boot on `window`, keyed by the preset, and let each stage
find it or build it:

```js
let S = window.__checkoutSeq;
if (!S) { /* boot once: navigate, log in, seed the cart */ S = window.__checkoutSeq = {…}; }
```

---

## Optional preset fields

| field | what it does |
| --- | --- |
| `urlParams` | merged into **both** source URLs — seeds, flags, anything that makes both sides boot the same deterministic world |
| `beforeParams` / `afterParams` | merged into one side only. The flag A/B mechanism |
| `defaultBefore` | `"local"` for flag A/B, or a pinned URL |
| `beforeLabel` / `afterLabel` | banner text; set these whenever the default would lie |
| `stageTimeoutMs` | per-stage budget (default 60000). Raise it when the first stage boots a whole world |
| `frameList` | this preset's default device frames |
| `devices` / `orientations` | defaults for the frame set |
| `metrics`, `metricsNote`, `metricsWhitelist` | see above |
| `pairNote` | the small print under each before/after pair |
| `defaultFocus` | fallback focus text for subjects that declare none |
| `method` | one line on the report cover describing how the shot was staged |
| `page` | per-preset report page overrides |
| `inject` | in-page libraries to evaluate before staging — see below |
| `transformReferenceStage` | deliberate reframe of the baseline handoff |

`stage` may be `async`: the engine awaits it, so a stage can click through a
splash screen, wait for a ready flag, burst a simulation forward, then render.

A deterministic stage that freezes animation should install
`window.__ba.render`. The engine awaits it before the compositor barrier, so the
screenshot cannot retain a stale canvas after stage metadata has already
advanced. (The legacy hook name `__cbzVisualCompare` is still read, forever —
working presets outrank a clean namespace.)

---

## `inject: ["staging"]` — the in-page stdlib

```js
export default {
  id: "checkout-flow",
  inject: ["staging"],
  …
};
```

Declaring this evaluates [`lib/staging-page.js`](./lib/staging-page.js) into
**both** pages, after navigation and before the first stage runs, and defines
`window.__baStaging`. A build without the file is not fatal — `inject` is a
convenience, and the engine says so and continues. It is plain script — no imports, no
build step — and every helper fails soft with a result object rather than
throwing, because a helper that throws takes down a beat and a helper that
silently returns "sure, that worked" ships a lying picture.

These four exist because they were copy-pasted into preset after preset and the
copies drifted, so the newest scar only ever reached the file that got cut.

### `until(test, budgetMs, stepMs)` → `Promise<boolean>`

Poll until `test` is truthy or the budget runs out; returns whether it arrived.
`test` may be async and is allowed to throw — reading state that does not exist
yet is normal early in a boot, not an error.

This is a **wall-clock** wait and belongs only on wall-clock questions ("has it
booted"). If you are waiting for something the comparison is *about*, see
"Pacing changes" above.

```js
const booted = await __baStaging.until(() => window.APP && APP.ready, 300000);
if (!booted) return { ok: false, err: "never booted" };
```

### `makeOverlay(id)` → `{ ok, id, el, set(field, text, css), remove() }`

The caption kit: five named blocks over the page — `side` (the BEFORE/AFTER
badge), `name`, `focus`, `perf`, `source`. Every block gets its own dark plate,
because a caption has to survive its own picture; a text shadow is not enough
against a whitewater frame or a pale sky, and white-on-white is not a caption.

`set` re-applies the base style each call and appends your `css`, so a later
declaration of the same property wins and a caption cannot inherit the previous
subject's one-off override. Unknown field names are allowed and get no default
styling. Overlays are automatically exempt from `hideHudExcept`.

```js
const ov = __baStaging.makeOverlay("__checkoutOverlay");
const before = input.side === "before";
ov.set("side", before ? input.beforeLabel : input.afterLabel,
       `background:${before ? "#c94c4c" : "#218b60"}`);
ov.set("name", subject.label);
ov.set("focus", subject.focus);
ov.set("perf", `tti ${tti}ms · shift ${cls.toFixed(3)}`);
ov.set("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname);
```

### `hideHudExcept(keepIds)` → `{ ok, hidden, kept, restore() }`

Hides every direct child of `<body>` except anything that is or contains a
`<canvas>`, anything this kit made, and the ids you name. `restore()` puts back
the exact inline visibility each element had, so one beat can be shot with the
chrome up and the next without it.

Name your exceptions. Sometimes a piece of chrome **is** the subject — a
whiteout sheet, a damage vignette, the very HUD element the change is about —
and a blanket sweep photographs its absence.

Limit: it walks body's direct children only. Chrome nested inside the canvas's
own wrapper needs its own id in `keepIds`.

### `auditionStand(opts)` → `{ ok, stand, index, proven, tested, solids, reason }`

For 3D scenes: **the tripod proves its own sightline.**

```js
const pick = __baStaging.auditionStand({
  THREE, scene: APP.scene,
  lookAt: { x: mx, y: my + 1.2, z: mz },
  candidates: rungs,          // BEST FIRST, safest last
  clearance: 6,
  filter: (obj) => !(obj.userData && obj.userData.fogVolume),
});
camera.position.set(pick.stand.x, pick.stand.y, pick.stand.z);
ov.set("focus", `${subject.focus} · cam ${pick.proven ? "proven" : pick.reason}`);
```

Every blind placement rule ever tried was defeated by some seed's geometry: a
fixed sign parked the camera against a mountain, the flip-away rule parked it
inside a tower, and a photograph of an obstruction is a failed beat that reports
`ok: true`. So the stand is chosen the way a photographer chooses one — walk the
ladder, cast a real ray at the subject from each rung, take the first rung that
can actually see it.

- Order `candidates` **best first**, and make the last one the safest — highest
  and furthest back. Over the rooftops beats behind a wall every time.
- If no rung can be proved, the **last** candidate comes back with
  `proven: false` and a reason. Put that in the caption. A shot that could not
  prove its own sightline is still worth having, as long as nobody is told it
  was clean.
- `clearance` (default 6) is the radius around the subject where a hit **is**
  the subject rather than a wall.
- Occluders are collected once: meshes only, invisible subtrees skipped, and
  anything marked `userData.baNotSolid` or `userData.waterSurface` ignored.
  `filter(obj)` is where the rest of your scene's non-walls get named — return
  truthy to keep an object as a wall.
- A `filter` that throws **keeps** the object, and a throw anywhere in the walk
  counts *against* that stand. The honest failure here is refusing a good stand,
  never accepting a blocked one — an earlier version put the throw in a
  try/catch that answered "sure, that stand can see," and shipped a portrait of
  an office block.
- Pass `solids:` a pre-collected array to reuse the occluder set across the
  beats of one storyboard.
- `ok: false` means the audition could not be *held* — no `THREE`, no scene, no
  `lookAt` — not that there is nowhere to stand: you still get the last rung and
  the reason. `stand` is `null` only if you passed no usable candidates, which
  is a bug in the preset, not a fact about the scene.

---

## What the core owns, and what you never write

Navigation, fresh browser state, matched viewports, device identity, the
baseline-stage handoff, compositor barriers, film-strip stepping, metric
collection, file naming, screenshots, report layout, PDF printing, and the
stdout summary.

New visual domains only need to describe their subjects and their staging
recipe. If you find yourself writing any of the list above inside a preset, the
seam is in the wrong place — **move the seam, not the preset.**
