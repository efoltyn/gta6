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

- **`OFFICIAL_IFC_LAZY` (default ON)** — `city/official_assets.js`. The campus
  PAD, plaza link, road record and region are still built synchronously (they
  are cheap, deterministic, and lot/region counts depend on them); only the
  MODEL FILL waits until the player is within `OFFICIAL_IFC_RADIUS` (900) of it.
  Nothing seeded moves, so **the world is byte-identical either way** — the math
  gate agrees. Measured: PLAY drops from 3 `assets/official` requests to 2, and
  the boot path has no asset over 4 MB left on it.
  Revert: `?cfg_OFFICIAL_IFC_LAZY=0`. Tools that need the campus regardless of
  where the player stands call `CBZ.loadOfficialIfcNow()` (already wired into
  `tools/visual-world-qa.mjs`).

- **`CITY_BOOT_SCREEN` (default ON)** — `systems/state.js`. **This makes nothing
  faster.** It paints an honest card, waits two frames so the card has actually
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
**pushing to main IS the deploy** (`docs/claude/project.md`).

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
