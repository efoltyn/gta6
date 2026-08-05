# Project facts — repo, deployment, doc map

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02). Binding.

Browser GTA-style game. Three.js r128 (vendored at `src/vendor/`), plain
script tags in `index.html` (406 of them), one global `CBZ` namespace.
**~264k LOC across `src/`** (+27k vendored) — this line said 120k for months.

THE GAME still has no build step: a dumb static server on `index.html` is the
real thing. But "no package.json" is no longer true — there IS a `package.json`
and a Vite harness (`npm run build`) whose ONLY job is to copy `css/`,
`assets/` and `src/` byte-for-byte into `dist/` plus one module bundle.

**HOW THE LIVE SITE ACTUALLY DEPLOYS** (checked against the GitHub API, not
assumed — an earlier version of this line was wrong): Pages is configured
`build_type: legacy`, source branch `main`, path `/`. It serves **the repo root
of main directly**. There is no Actions workflow in the deploy path and `dist/`
is not involved at all — pushing to main IS the deploy, and the live game at
https://efoltyn.github.io/gta6/ is literally this repo's `index.html`. The Vite
harness is therefore a local/optional convenience today; it only becomes the
deploy path if Pages is switched to the Actions build type.

Consequence, and it is now even more direct than the old wording implied:
**anything you leave in `src/` or `assets/` ships to every player, whether or
not `index.html` loads it.** Build-time-only sources go in `vite.config.js`'s
`SKIP_RAW_COPY` (which only matters for the `dist/` path).


## More docs

- `tools/probe-wave.mjs` — the worked example of step (3), a targeted in-page
  probe. Asks the LIVE world four questions syntax cannot: did the beach
  furniture register real anchors, does `roadSpeedLimit` post more than one
  distinct limit across the whole map, are the checkpoints manned, and — the
  one that matters — does a sea surge turn a point that was DRY LAND into
  water. Copy its shape; that last assertion is the pattern (prove the flood is
  real to the game's own queries, not just to the shader).
- `tools/STUDIO.md` — studio.mjs subjects/modes/flags in full.
- `LOAD-NOTES.md` — what it costs to GET to the world (boot bytes, the one
  synchronous 21–31 s world build, the ranked plan to slice it), measured with
  `tools/load-profile.mjs`. `PERF-NOTES.md` is the sibling for frame cost.
- `PROCGEN.md` — the method behind generation (seed tree, fields, roadmap).
- `INFINITE-WORLD.md` — chunked-world migration plan (M0–M8).
- `docs/plan/engine-oneshot.md` — the ENGINE plan: turn the 400k-LOC repo into
  something that makes a short one-shot game cheap and uniform (BOOT manifest ·
  SESSION registry · WORLD hooks · the starter-asset inventory · the budget
  ratchet). **It deliberately contradicts `GAMES-FIRST.md`'s "Roles, not
  one-shots" section** — read both before acting on either.

