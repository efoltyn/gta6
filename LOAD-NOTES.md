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

---

## 2026-08-23 — hash01 specialization (branch `claude/car-interiors-storm-visuals-riea1j`)

`core/seed.js` `hash01` no longer routes through `hashN`'s arguments-object
fold; the three squirrel rounds are written out. Bit-identical (2M random +
edge inputs, and the math gate's two-build determinism pass agrees), 34%
faster in an isolated 5M-call bench. End-to-end on this rig, ONE run each
way: world build 25.9 s (branch) vs 25.6 s (main) — inside this file's own
documented 20.9–31.7 s run spread, so treat the function-level number as the
claim and the end-to-end delta as unmeasured. The owed list above is
unchanged: #1 (slice the build) is still the headline.

---

## The reload at 99% (2026-09-01) — the tab was too heavy to live, not too slow

Owner: *"takes way too long to load and also often gets to 98 or 99 percent and
then the site reloads automatically"* — and from the phone, *"a problem
repeatedly occurred"*.

**Nothing in the game reloads the page during boot.** Every `location.reload()`
is a button (GAME OVER, START A NEW LIFE, the build toggle). 98–99% on the
meter is the last step, `boot:frames` — the first render, where the whole
world is uploaded to the GPU. The reload is the BROWSER: iOS and Safari kill a
WebContent process that hits the memory ceiling and reload the page; on a
phone that loops into "a problem repeatedly occurred". So the bug was a
weight, and the instrument had to be taught to weigh (`load-profile.mjs`
WEIGHT now prints geometry bytes, unique materials and GL programs;
`--profile` prints self time by FUNCTION, and `--profile-out` keeps the raw
`.cpuprofile`).

**What it weighed** (same tool, same rig, seed 90210, HEAD `63d4ad6` vs this
tree):

| | before | after |
|---|---|---|
| geometry attribute bytes, whole scene | **1,308 MB** (355 visible + 953 far-culled) | **563 MB** (217 + 346) |
| JS heap after build | 508 MB | 456 MB |
| unique geometries / materials / programs | 17,569 / 13,208 / 136 | 17,193 / 13,156 / 137 |
| `startRun` freeze | 14.7 s | 12.2 s |

(A probe's "visible vs hidden" split is farcull's state at that instant — two
probes of one build said 1,165 MB and 358 MB "visible". Quote the TOTAL.)

**Where the 1.3 GB was.** `core/batch.js`'s V2 merge: it de-indexed every
source (`toNonIndexed` — a box became 36 vertices instead of 24, a 16×12
sphere 1,152 instead of 221), stored normals and colours as float32, and
emitted a uv for materials that by its own filter have no map — 44 bytes per
vertex, on a world that turned out to have ~16 million of them once merged.
One 112 m tile (`T-19,-3`, a mini-city: 35,866 meshes) was 1.3 M vertices and
55 MB on its own. The merged copy now keeps the source indices in one
Uint16/Uint32 buffer, stores Int8-normalized normals and Uint8-normalized
colours, has no uv, and bakes the world matrix while copying instead of
cloning every source first (`bakeMergeV2`). 18 bytes per vertex. The slice
ledgers behind `batchWallHide`/`batchHideGroup` still mean vertex offset +
count, so carving and demolition are untouched. `CBZ.batchCensus` names the
fattest buckets and source meshes after every build.

What is NOT the weight, for the record: the ~100k hidden wall originals the
batch pass keeps for LOS and colliders share 3,069 box geometries — 2.5 MB.
Their cost is the Mesh objects. 89,419 of the scene's 135k meshes are ped
cloth-band boxes (`userData.clothDims`), which is where the JS heap lives.

**The build, by function.** Two hot spots were not the world at all:
`reality.js`'s support broadphase `visit` rescanned every later collider for
the "large" boxes on every iteration — an n² loop over 123k boxes, 1.06 s of
self time (now a precomputed list); and three's `Object3D.remove` — indexOf +
splice on a building group's children array, 100k times, 0.46 s (now one
filter per parent after the merge loop). The per-candidate
`updateWorldMatrix(true, false)` became one `updateMatrixWorld(true)` on the
root. Both are gone from the top-25 table.

**Two more things landed on the phone at the same instant.** `initAudio()`
runs on the PLAY press and used to fetch AND decode all ~77 bank files during
the build — decoded PCM is ~384 KB per second, `disaster_siren` alone 76 s =
29 MB — so ~100 MB of audio arrived exactly as the geometry peaked. Every cue
already lazy-loads on a cache miss; the preload is now a warm-up that waits
for the boot meter to let go and runs three files at a time, skips the two
long sirens, and on iOS does nothing at all.

**`defer` on all 569 script tags — tried, measured, NOT shipped.** The theory
was an earlier title paint. `load-profile.mjs` now prints `first contentful
paint`; four interleaved boot-only runs (after/before/after/before, load
average 5-6) gave 3.1 / 4.7 / 4.9 / 3.9 s — pure noise. Classic scripts at the
end of `<body>` already let the title card paint before the first one runs,
so `defer` had nothing to move. The edit is one `sed` if anyone wants to
retry on a quiet machine (the inline pre-config block and the two indented
tags in the entities block are the only gotchas); at this noise floor it is a
risk with no measured reward.

**Still owed for an iPhone** (an iOS WebContent process gets roughly 1–1.4 GB;
this tree is ~560 MB geometry + ~460 MB heap + GPU copies of what is on
screen): the 16 M merged vertices are CONTENT (mini-cities, vegetation) and
only a level-of-detail decision shrinks them; the 89k ped cloth meshes; 13k
unique materials; and #1 on the list above is still #1 — slice the 12–30 s
synchronous build. Int16 tile-relative positions (−95 MB) were built on paper
and rejected: 5 mm quantization on road paint is a z-fight.

Visual A/B: `ba --preset city-load-weight` (four framings, bytes/materials/
heap/mean-luminance beside each; the before is a detached HEAD worktree
served on :8811). This wave: 1,310 → 565 MB in all four frames, mean luminance within 0.6 of a level.
`~/harness/out/gta6/city-load-weight-2026-09-02T01-48-54-882Z/report.pdf`.

---

## 2026-09-04 — the build no longer freezes the tab, a reload is free, and PLAY says CONTINUE

Owner: *"there's no real pause and resume, and there's no real load game. once
you reload the browser, you gotta fully reload the huge game, and that reloads
slow."* Three things were true and each is measured below with its own gate.

### 1. The build is sliced (owed item #1, finally)

`CBZ.buildCity` is a generator now (`buildCityGen` in `city/world.js`), and so
is `cityWorldGeo` (`cityWorldGeoGen`, `city/worldmap.js`), the static batch
pass (`batchStaticUnderGen`, `core/batch.js`, one yield per merged bucket) and
the five fattest builders — `minicities.js` yields per town, `countries.js` per
country, `govcomplex.js` per complex, `biome_snow.js` and `continent.js` at
every phase banner. `city/mode.js`'s `prebuildGen` chains them, and
`CBZ.runSliced` (`core/loop.js`) drives that chain with a 24 ms budget and one
`setTimeout(0)` between slices, holding the frame loop (`CBZ.loopHold`) so no
updater sees a half-built world. Only the human-facing PLAY / CITY tile
(`systems/state.js present()`) takes this path. **`CBZ.startRun()` is still one
synchronous call** — every tool drains the same generators in a `for` loop and
gets the identical world (the determinism gate agrees); `?cfg_SLICED_BOOT=0`
puts the buttons back on it too.

The proof is `tools/continue-check.mjs` (`npm run test:continue`): a 50 ms
main-thread timer runs through PLAY and reports its longest gap. Before, that
gap WAS the build. Now it is one builder step — the snow biome's biggest phase
— and the meter, input and the browser's watchdog all get the thread back
between steps. A frozen tab is what a phone kills; there is no frozen tab.

**Nothing here is less work.** Same builders, same order, same rng draws. The
synchronous build measured 24.8 / 25.2 s on this box today against 34.4 s in
the morning's baseline — that spread is the box, not the code (the notes above
have this build at 12.2 s on a quieter day). The honest speed lever is still
*build only near spawn* (#2 above), and it is now tractable: the generator
chain is exactly the seam a streaming world needs.

### 2. A reload costs nothing on the wire (`sw.js`, `core/appcache.js`)

Every `<script>` tag is `defer` now (the title paints before the 28 MB
parses; tools that read the tags were taught the attribute), and a service
worker owns the files: `index.html` is network-first so pushing to main is
still the deploy, everything else is cache-first, and the install pre-fills
the cache from the page that registered it. A changed `index.html` drops the
whole file cache before the new page is answered — one consistent version
set, never a stale `worldmap.js` under a fresh `world.js`. A src-only push is
caught by a background sweep that swaps the changed files in together and
shows "a new version is ready — tap to reload". Not registered on
localhost/127.0.0.1 (the tools), `?nosw=1` unregisters.

`tools/appcache-check.mjs` (`npm run test:appcache`) maps `cbz.test` onto the
dev server and counts, from the worker's own tally, cache hits vs network
misses per navigation: 2nd visit 586 hits / 6 misses, page open → bootComplete
**4.5 s → 2.4 s** on a server that sends `no-store` (the worst case — Pages'
ten-minute max-age already helps inside that window). A deploy is verified to
refetch every script (595 misses, 1 hit) and the visit after it is back on the
cache (594 hits).

### 3. Pause is real; CONTINUE is real

- **Pause** (`CBZ.pauseGame` / `CBZ.resumeGame`, `systems/state.js`): Esc
  (locked or not), the touch HUD's ❚❚ button, gamepad START, or the tab going
  hidden. The day clock (`core/daynight.js`) and the weather
  (`systems/weather.js`) hold; the update chain was already off. Esc on the
  card resumes (Settings is the button, not Esc). Pausing in the city commits
  the ledger. **Save & Quit** commits and returns to the title with the world
  kept built.
- **Continue** (`city/worldstate.js` `w.session`, restored by
  `CBZ.cityWorldRestoreSession` at the end of `city/mode.js reset()`): on top
  of `lastPos` (origins.js had that), the calendar day, time of day, wanted
  level + heat, hunger, health, look direction and camera mode ride the 5 s
  autosave, every pause, and `pagehide`. PLAY reads **CONTINUE · Day N · $cash**
  when a character exists. `continue-check` moves the player 60 m, sets day 3
  at dusk with 2★, commits, RELOADS THE PAGE, presses CONTINUE and asserts the
  moment came back (0.00 m off).

### Deleted (99 files)

`src/vendor/three-r164/` (718 KB, the r164 spike nothing loaded),
`src/compat/three-legacy.js`, `OBJLoader.js` / `MTLLoader.js` (no reader),
`core/interfaces.js` (a contracts index that executed nothing), `archive/`
(3.1 MB of prison-v1 shadow copies), the grass demo and its integration.
`tools/load-profile.mjs --builders` now names each builder by file and times a
generator builder through its resumptions; `--profile` gained `--interval`
(the 500 µs default produced a payload the tool never finished receiving on
this box, twice — by-function numbers are still owed).
