# LOAD NOTES — why the city takes minutes and the jail takes a second

**Question that started this (owner, 2026-08-04):** *"Figure out why the prison
escape game loads fucking amazing, I can literally play it on my phone. And why
the gang city game is so heavy and takes so long to load even on a computer."*

Everything below is MEASURED, not estimated. The instrument is new and lives on
the shelf: **`node tools/load-profile.mjs`** (`--builders` for the per-builder
table, `--profile` for a V8 CPU profile of the build, `--cpu 4` to model a
phone, `--cfg NAME=0` to A/B a build flag). Rerun it before trusting any number
here — that is the whole point of promoting it into `tools/`.

Rig for every number: this box, headless Chromium, SwiftShader, localhost
devserver (**no gzip** — the live site DOES gzip, which matters, see below).
CPU-side JS is honest. Anything GPU-side (the FRAME phase, `getProgramParameter`
in the profile) is inflated well past a real GPU — compare runs, don't quote one
line in isolation.

---

## The two games, side by side

| | **CELL BLOCK Z** (`cell-block-z.original.html.bak`) | **THE CITY** (`index.html`) |
|---|---|---|
| Files to boot | 1 HTML + 1 three.js | 1 HTML + **467 `<script src>`** |
| JS shipped | 41 KB html + 589 KB three | **21.1 MB** (7.2 MB gzipped) |
| Requests to first screen | **4** | **486** |
| Bytes to first screen | 604 KB | 23.2 MB raw |
| Time to playable | **1.07 s** | 3.5 s to title, **+21–31 s frozen**, then first frame |
| Same at `--cpu 4` (≈ a phone) | **5.6 s** | **16.8 s just to reach the title screen** |
| Scene objects | a few hundred | **~142,000 Object3D / 123,000 colliders** |
| JS heap after build | 3.5 MB | **442 MB** |

Cell Block Z is fast for one reason and it is not cleverness: it is 41 KB, it
makes four requests, and it builds one yard. There is nothing there to be slow.
Everything below is about the other column.

---

## What actually costs the time — ranked, with evidence

### 1. `CBZ.startRun()` is ONE synchronous 21–31 s main-thread task

Five runs: 30.6, 28.7, 25.9, 24.1, 20.9 s. `CBZ.cityWorldGeo`
(`src/city/worldmap.js:625`) runs **39 landmass builders** in a single
unyielding `for` loop — 18.2 s of it — and `buildCity` (`src/city/world.js`)
owns the rest. No `await`, no chunking, no progress. The tab is genuinely
frozen for all of it, and it used to freeze on a blank page, which is exactly
what a mobile browser kills. **This is the headline, and it is not the
download.**

Slowest builders (instrumented run — treat as a RANKING, the wrapper costs a
little time itself):

| ms | order | file |
|---|---|---|
| 4,560 | 30 | `city/biome_snow.js` |
| 3,323 | 97 | `city/continent.js` |
| 2,756 | 34 | `city/minicities.js` — also **+148k objects by itself** |
| 1,452 | 88 | `core/packages.js` (venue claim + mount) |
| 1,226 | 31 | `city/biome_desert.js` / `biome_farmland.js` |
| 1,049 | 35 | `city/countries.js` (+38k objects) |
| 665+434 | 98 | `city/wildlife.js`, `city/roadrules.js` (+21k objects) |
| 408 | 42 | `city/govcomplex.js` (+15k objects) |

CPU profile of the build, self time by file:

| share | what |
|---|---|
| 32.7% | `(native)` — of which **18.1% is `getProgramParameter`** (shader compile/link, ~107 programs) |
| 24.7% | `vendor/three.r128.min.js` |
| 8.7% | `core/batch.js` — `mergeGeometriesV2` (3.25 s) |
| 6.0% | `core/seed.js` — `squirrel`/`hashN`/`hash01` (2.5 s of procedural noise) |
| 4.4% | garbage collector |
| 4.0% / 3.9% | `world/mountain_detail.js` / `city/continent.js` |
| 3.6% | `systems/reality.js` — `visit` (the arena support broadphase, 1.4 s) |

### 2. A 64.8 MB GLB was fetched on every PLAY — FIXED

`assets/official/ifc/rac_advanced_sample_project.glb`, pulled by
`city/official_assets.js` from the `addLandmass(buildIfcCampus, 34.6)` builder,
for one decorative civic annex at (-100, 470) that most sessions never walk to.

**Correction worth keeping straight:** 64.8 MB is the FILE. GitHub Pages serves
it `content-encoding: gzip` (verified against the live site), so the wire cost
is **8.3 MB** — then 64.8 MB of decompression, GLTF parse and GPU upload. 8.3 MB
is still ~50× the entire Cell Block Z payload, on the critical path, for
scenery.

### 3. 467 render-blocking script tags, zero `defer`, zero `async`

21.1 MB of JS parsed, compiled and executed before the title screen exists:
**2.8 s of V8 ScriptDuration here, 14.3 s at `--cpu 4`**. Over cellular, 7.2 MB
gzipped across 467 requests is the other half of the phone story.

### 4. It builds the entire planet at spawn

Every biome, country, mini-city, island, airport and speedway is constructed
before you can move, regardless of where you are. Cell Block Z builds one yard.

### 5. ~142,000 scene objects / 442 MB heap

Also why frames are heavy — consistent with `PERF-NOTES.md` finding 99.6% of
draw calls are the static procedural world. 442 MB of JS heap is an OOM risk on
a phone before anything else gets a chance to be slow.

---

## What shipped in this pass (2026-08-04)

Both are `CBZ.CONFIG` flags with a one-line URL revert, per doctrine. Gated:
`MATHGATE: ok` (329/182/206, determinism ok, errors baseline-only) and
`tools/smoke-play.mjs` invariants ok.

- **`OFFICIAL_IFC_LAZY`** — **GONE (2026-08-15).** The owner deleted the
  Goldspire Civic Campus outright: the builder, the pad/link/road/region, the
  proximity streamer, both flags, `tools/bake-official-ifc.mjs`, the `web-ifc`
  dependency and all 103 MB of `assets/official/ifc/`. Finding #2 below is now
  fixed by subtraction rather than by lazy-loading — PLAY issues **2**
  `assets/official` requests and no IFC bytes exist to fetch. The original
  entry is kept below for the record.

  ~~**`OFFICIAL_IFC_LAZY` (default ON)** — `city/official_assets.js`. The campus
  PAD, plaza link, road record and region are still built synchronously (they
  are cheap, deterministic, and lot/region counts depend on them); only the
  MODEL FILL waits until the player is within `OFFICIAL_IFC_RADIUS` (900) of it.
  Nothing seeded moves, so **the world is byte-identical either way** — the math
  gate agrees. Measured: PLAY drops from 3 `assets/official` requests to 2, and
  the boot path has no asset over 4 MB left on it.
  Revert: `?cfg_OFFICIAL_IFC_LAZY=0`. Tools that need the campus regardless of
  where the player stands call `CBZ.loadOfficialIfcNow()` (already wired into
  `tools/visual-world-qa.mjs`).~~

- **`CITY_BOOT_SCREEN` (default ON)** — `systems/state.js`. **This makes nothing
  faster.** (Superseded 2026-08-18: the card is now a real percentage meter —
  see "The loading meter" at the bottom of this file. The flag still turns the
  whole thing off.) It paints an honest card, waits two frames so the card has actually
  been painted, and only THEN hands the thread to the build — so the 21–31 s
  freeze happens behind a screen that says what is happening instead of behind a
  blank page. The spinner animates `transform`/`opacity` only, so Chrome keeps
  it moving on the compositor while the main thread is blocked: the page is
  frozen but never looks dead. `CBZ.startRun` itself is UNTOUCHED and still
  fully synchronous — every tool in `tools/` calls it and asserts immediately
  after it returns. Only the human-facing buttons route through
  `CBZ.startRunPresented`. Revert: `?cfg_CITY_BOOT_SCREEN=0`.

---

## What is still owed, in the order worth doing it

1. **Slice the build.** The real fix for the freeze. `cityWorldGeo`'s loop over
   39 sorted builders is already the right shape to yield between — but it is
   called synchronously from deep inside `buildCity` (`world.js:1052`), which
   does more work after it, and `settlements.js` wraps it as a keystone. Making
   it async is a boot-path refactor, not a patch, and it needs the owner's eyes;
   that is why this pass shipped the honest loading card instead of faking it.
   Once sliced, the card gets a real progress bar for free (39 known steps).
2. **Build only near spawn.** Register the far biomes as build-on-approach.
   `INFINITE-WORLD.md` already has the chunked-world plan (M0–M8); this is the
   load-time argument for it.
3. **Attack the object count.** `minicities.js` alone adds ~148k Object3D.
   `LOCAL_INSTANCING` is written, verified at −30% draw calls, and still
   defaults OFF pending the owner's visual parity call (`PERF-NOTES.md`).
4. **Shader precompile / material variety.** 18% of the build is program
   compile across ~107 programs, against `PERF-NOTES.md`'s 39k materials.
5. **`defer` the 467 tags.** Cheap on paper, but the inline block at
   `index.html:354` must run before `config.js`, so it needs care and it only
   buys an earlier paint — measure with `load-profile.mjs` before spending risk
   on it.

Not worth doing: bundling. The no-build-step rule is load-bearing —
**pushing to main IS the deploy** (`scrolls/claude/project.md`).

---

## Re-measured 2026-08-09 (branch `claude/gang-city-performance-2q7b4m`) — the diagnosis stands

The owner asked the question again, so the instrument was re-run on today's
tree (same rig: headless Chromium, SwiftShader, localhost devserver, no gzip).
Nothing above needs rewriting; the numbers moved only the way the repo moved:

| | 2026-08-04 | 2026-08-09 |
|---|---|---|
| script tags / JS shipped | 467 / 21.1 MB | **470 / 22.4 MB** |
| requests / bytes to title | 486 / 23.2 MB | 490 / 25.0 MB |
| V8 ScriptDuration at boot | 2.8 s | 3.17 s |
| `startRun` freeze | 20.9–30.6 s (5 runs) | **31.7 s** (1 run, top of the old range) |
| scene objects / colliders | ~142,000 / 123,000 | 142,927 / 122,963 |
| JS heap after build | 442 MB | 402 MB |

The builder table is the same story, same order: `biome_snow` 4.5 s,
`continent` 4.1 s (+0.8 s since the teardown — the one line that grew),
`minicities` 2.7 s, `packages` venue claim 1.5 s, then the desert/farmland and
countries rows. 39 builders, one unyielding loop, `worldmap.js:625`.

The studio contrast, measured with the same tool on the same rig:
`games/bomb-survivor-b.html` — the whole engine à la carte — is **23 requests,
1.9 MB on the wire, 1.83 s of script**; naming ALL 18 packs would ship 22
files / 1.9 MB. The mini-games are fast because they pay only for what they
name and build one arena; the city pays for 470 files and then builds the
entire planet before the first step. The owed list above is unchanged and
**#1 (slice the build) is still the headline** — the freeze is 5× the cost of
everything else combined.

---

## The loading meter (2026-08-18) — the freeze finally has a number on it

Owner, from a phone, looking at the boot card: *"Make this into a progress
meter that shows percentage and remove all the fucking gray text. I don't know
what the fuck that's for. And make it a very accurate progress meter."*

Both done. The card is now a **LINE**: one big percentage and one rule that
fills left to right under BUILDING THE WORLD. The spinner is gone and so is
the apology paragraph. The interesting half is the percentage, because the
build is still ONE synchronous 20-30 s task — the thread doing the building
cannot draw the meter that reports it. **Nothing here made the build faster.**

`src/systems/bootprogress.js` (new). Two mechanisms:

- **Who draws it.** The meter is an `OffscreenCanvas` transferred to a
  **Worker**. The worker is its own thread: it redraws at 30fps while the main
  thread is inside `biome_snow.js`, and `postMessage()` from a blocked main
  thread still reaches it immediately (the worker's event loop is not the one
  that is stuck) — so checkpoints reported mid-freeze move the number on
  screen in real time. No SharedArrayBuffer, so no COOP/COEP headers: this
  works on Pages exactly as the repo is served. A CSS-animated highlight
  slides along the rule as liveness insurance (compositor-only, so it survives
  the freeze even if a browser ever refuses to push worker canvas frames), and
  browsers without OffscreenCanvas fall back to the same meter in DOM.
- **Where the number comes from.** NOT "steps done / steps total" — the steps
  differ by 20x and that bar would be a liar. Every step is weighted by **how
  long it actually took last time on this machine** (localStorage, EMA), seeded
  on the first ever run by the table above. Checkpoints snap the bar to the
  truth; between them the worker eases across the segment on that step's
  expected duration, hitting 85% of it exactly when the step was predicted to
  end and then crawling asymptotically. It never overshoots and never goes
  backwards.

Checkpoints are `CBZ.bootStep(key)` calls, ~50 of them: `city/world.js`
(core/buildings/expansion/props/beach/finish), `city/worldmap.js` — **one per
landmass builder**, keyed by the file that registered it (`document.currentScript`
at registration time) — and `city/mode.js` (batch/pop/traffic/run), plus the
post-build shader-compile frames, which the card now HOLDS for instead of
handing over a frozen game after two frames.

**The gate: `node tools/boot-meter-check.mjs`.** It fires PLAY without awaiting
it, reads back the drawing thread's own tape (timestamp + percentage every
200 ms) to prove the number moved inside the window where the page could not
run a single rAF, then rebuilds the world a second time in the same browser and
prints predicted-vs-actual for every step, cold and calibrated. On this rig
(SwiftShader, so the post-build shader phase is wildly inflated — compare runs,
don't quote one):

| | cold (seed table) | calibrated (2nd build) |
|---|---|---|
| median per-step error | **35-43%** | **13-20%** |
| bar monotonic | yes | yes |
| worker samples advancing inside the frozen window | — | 137 of 199 across a 46 s build |

(Two runs, and the spread is the box, not the meter: this machine's own build
time moved 107 s → 149 s between them. One calibrated run on the player's
actual device is what the number is for.)

Two things the instrument found on the way:

- **`city:batch` is 8-10 s.** `batchStaticUnder` + `instanceStaticUnder` +
  `freezeStaticUnder` in `city/mode.js`'s reset is the second-biggest single
  item in the whole load, and it never appeared in the builder table above
  because it runs after `buildCity` returns. Worth its own line when #1 gets
  sliced.
- **Selecting the CITY tile built the whole world with NO card at all.**
  `setMode()` calls `mode.build()`, so the title screen could freeze for half a
  minute on a mode click; the old boot card only ever covered PLAY. Every
  human-facing path into an unbuilt world is metered now (`CBZ.presentModeSwitch`).

Reverts: `?cfg_BOOT_METER=0` (no meter), `?cfg_CITY_BOOT_SCREEN=0` (no card at
all — the buttons call `startRun()` raw, exactly like a tool does).

---

## The App Store build (2026-08-21) — one game, one file, no network

The question this file has always asked is "why is the city slow". The answer
for the DISASTER game turned out to be different in kind: it is not slow, it is
**paying for five games it does not run**. `index.html` is the whole release —
the prison, the city, the campaign, the casino, the aircraft, the elections —
and Natural Disaster Survival was loading all 553 tags and 25 MB of it before it
could draw an island.

So the App Store build takes a different door. Same source, three tools:

| | web (`index.html`) | app (`dist-ios/www`) |
|---|---|---|
| games on the page | six | **one** |
| script tags | 553 | **1** (`bundle.js`) |
| JS shipped | 25.0 MB | **5.5 MB** (minified from 14.8) |
| first world built | the city | **the island** |
| network at runtime | Google Fonts + a CDN Draco decoder | **none at all** |
| total payload | — | 24.9 MB |

- **`tools/build-disaster-page.mjs`** writes `disaster.html` from `index.html`:
  drop the scripts in the manifest, declare the start mode (`src/config.js`
  reads `START_MODE`, so the page opens on the island and never stands up the
  city), retitle, cut the MORE GAMES strip. Generated rather than hand-written
  so the HUD markup and boot order keep one source of truth; `--check` fails
  when it is stale.
- **`tools/disaster-minimize.mjs`** produced the manifest by MEASUREMENT —
  delta debugging by bytes, dropping groups and asking
  `tools/disaster-check.mjs` whether the game still boots, still runs all
  eleven disasters, and still has every named system on `CBZ`. Two things that
  search taught us are worth more than the megabytes: an oracle that clears its
  error log before asserting will happily drop a file that throws at load, and
  an oracle that only drives `CBZ.stepSim` will happily drop `core/renderer.js`,
  because the headless update path never draws. Both are asserted now.
- **`tools/build-ios.mjs`** concatenates the kept scripts in page order into one
  `bundle.js`. Two things concatenation breaks, both handled: files that resolve
  a path from `document.currentScript` (a stand-in is set per block) and the
  failure isolation of a script tag (each block is wrapped, and a block that
  throws is reported through `window.__cbzBundleFailed`, which the oracle
  asserts is empty).

**The web deploy is untouched.** Pushing to main is still the deploy, `index.html`
still has no build step, and every tool in `tools/` still points at it. The app
is a separate artifact that is compiled and signed anyway.

**The island now reports its own progress.** Every `CBZ.bootStep` checkpoint in
the repo was written for the city, so PLAY on the disaster game froze behind a
one-segment bar. `world/disaster_arena.js` has six now (ground, mountains,
towers, streets, trees, rocks) and the meter learns their real cost on the
player's own device.

Re-measure any of it:

    npm run build:ios && npm run check:ios     # build the bundle, then boot it
    node tools/disaster-check.mjs --url disaster.html
    node tools/disaster-minimize.mjs --verify
