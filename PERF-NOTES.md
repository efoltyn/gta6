# PERF NOTES — round-3 city teardown (branch `claude/game-perf-profiling-1x05fa`)

**Status:** everything below is on THIS BRANCH only. NOT merged. `main` (the live
GitHub Pages game) is untouched — nothing here changes what you play until it lands
on `main`, and even then all three levers default OFF (opt-in per URL). Full A/B
tables + rationale live in `tools/perf-ab/LOG.md` (rounds 3 and 3b).

---

## What's slow (measured 3 ways: calm street, 5★ riot, 2nd seed — all agreed)

- **~99.6% of every frame's draw calls = the static procedural world** (buildings/
  props around you). Hide it → 22 draw calls left. True even in a 5★ riot.
- **Shadows = #2 GPU cost.** Sun = 2048 PCF-Soft, re-rendered 10–18×/sec.
- **Ped AI = #1 CPU cost.** `peds.js:4233`, ~16ms/tick, 3× the next system, ~500 peds
  on- or off-screen.
- **NOT the problem:** resolution/fill-rate (¼-res barely helped) and draw distance
  (halving it moved draws <2%). It's draw-call submission + scene-walk — weak-GPU profile.
- **~1 GB JS heap / 39k materials** — GC-hitch + crash risk on weak machines.

Numbers are exact for draw calls/triangles (device-independent); ms is software-renderer
relative only. Measurement discipline + gotchas documented in `tools/perf-ab/LOG.md`.

---

## The three levers (all shipped on this branch, all default OFF, one-line/URL revert)

Add the query flag to the game URL and reload to feel each — works on GitHub Pages too.

| Flag (URL) | What it does | Result |
|---|---|---|
| `?cfg_CITY_SHADOW_MODE=off` | Sun shadow off, full detail kept. Also `=low` (1024) / `=high` (2048). Live: `CBZ.setShadowMode('off')` | Isolates the #2 GPU cost |
| `?cfg_CITY_PED_AI_LOD=1` | Off-screen peds think/move less at high tiers; on-screen untouched | Trims the #1 CPU cost |
| `?cfg_LOCAL_INSTANCING=1` | Collapses repeated static props into per-cell InstancedMesh pools | **−30% draw calls, verified** |

Already-shipped-on-main levers you can also feel today: **Settings → Quality → Fastest**,
`?qforce=0..4`, `?cfg_CITY_FAR_CULL=0`.

Instancing tuning knobs (optional): `?cfg_LOCAL_INST_TILE=672` (cell size),
`?cfg_LOCAL_INST_MIN=4` (min props per pool). Defaults are the A/B-winning values.

---

## LOCAL_INSTANCING A/B (the big one) — calm q4, seed 90210

| config | draw calls | notes |
|---|---|---|
| OFF (2 runs) | 5,441 / 6,407 | baseline (varies run-to-run) |
| ON 112u cell | 5,358 | wash — props scatter thin per small tile |
| **ON 672u cell** | **3,826 / 3,851** | **−30%, stable; −29% on seed 1337** |

- First version REGRESSED +26% (culling bug) — the A/B caught it, fixed with a manual
  per-pool frustum sweep. Cell size matters: 672u collapses in-view props ~1:many.
- **Demolition-safe (verified):** blew up a building, its 654 instanced trim pieces all
  zero-scaled (0 floating). Full demolition arc (rubble→cleared→scaffold→rebuilt) passes
  with 0 floating geometry. math-gate green. 0 console errors.
- **Default OFF on purpose:** it changes what renders, so visual parity is the owner's
  call. Flip it on live, eyeball it; if identical, set the config default true.

---

## Files added/changed on this branch

- `src/city/localinst.js` — the instancer (new)
- `src/core/quality.js` — CITY_SHADOW_MODE override + `CBZ.setShadowMode()`
- `src/city/peds.js` — CITY_PED_AI_LOD move-stride extension
- `src/city/mode.js` — hook `instanceStaticUnder` after batch, before freeze
- `src/config.js` — the three flag defaults
- `index.html` — loads `localinst.js`
- `tools/perf-ab/` — harnesses (`attribute.mjs`, `abmatrix.mjs`, `census.mjs`,
  `abinst.mjs`, `demo-inst-safety.mjs`) + all result JSON + `LOG.md`
- `tools/demolition-check.mjs` — `CBZ_DEMO_CFG` env hook for flag A/B

## To deploy later (when you decide)

Merge this branch into `main` → GitHub Pages rebuilds → the flags are live (still OFF by
default; feel them via `?cfg_...`). To make instancing always-on for everyone, set
`CBZ.CONFIG.LOCAL_INSTANCING = true` in `src/config.js` before merging.
