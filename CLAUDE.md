# CLAUDE.md

Browser GTA-style game. Three.js r128 (vendored at `src/vendor/`), plain
script tags in `index.html`, one global `CBZ` namespace, no build step, no
package.json. ~120k LOC across `src/`.

## HOW TO VERIFY WORK — the closed loop (read this first)

There is NO test framework here and we don't want one. Verification is a
closed loop of fast, cheap gates that render the actual game and look at it.
Reasoning about visuals without rendering them is how bugs ship — every gate
below runs in seconds to ~1 minute. Use them after EVERY change, in roughly
this order:

1. **Syntax** — `node --check <file>` on every touched file. Free.
2. **Smoke gate** — `node tools/smoke-play.mjs 10` boots the game headless,
   presses PLAY, simulates input, checks generator invariants (lot/shop/road
   counts, shop-door reachability, region bounds) and collects every console
   error. Must print `invariants: ok`. This is the universal pass/fail.
3. **Look at what you built** — screenshots are the point, not a nicety:
   - `node tools/studio.mjs <subject>` — multi-angle turntable shots of any
     asset (`rig`, `rig:walk`, `car:NAME`, `cars`, `expr:JS`), animation
     filmstrips, `--video` WebM. THE tool for characters/vehicles/props.
   - `node tools/street-shot.mjs [out.png]` — street-level scene shot at the
     densest pedestrian cluster. For anything visible from the sidewalk.
   - `node tools/city-atlas.mjs <seed>` — whole-world top-down render per
     seed. For procgen/layout changes; farm several seeds for regressions.
   - `node tools/demolition-check.mjs` — full destroy→rubble→cleared→
     scaffold→rebuilt arc with phase screenshots + restore assertions, plus
     a FLOATING-GEOMETRY invariant: every prop box must be support-connected
     to the ground (AABB chain). Copy that pattern for any new structure
     builder — screenshots judge aesthetics, connectivity checks judge
     physics, and thin members can LOOK floating at distance even when
     connected (make members chunky: ≥0.3u, this is a voxel-look game).
   Shots land in `tools/shots/` (gitignored). READ the images — the loop has
   repeatedly caught defects that numeric checks missed (inside-out geometry,
   zombie-arm poses, floating trim), and numeric checks caught what images
   missed. Use both.
4. **Targeted in-page probes** — for behavior, write a throwaway CDP script
   (copy the boot boilerplate from `tools/demolition-check.mjs` or
   `smoke-play.mjs`): boot headless Chromium, `Runtime.evaluate` straight
   into the live game, assert on real state (`CBZ.city.arena.lots`,
   `CBZ.cityCrowdAgent(i)`, `CBZ.colliders.length`, `renderer.info`…).
   Minutes to write, seconds to run, tests the REAL game — never a mock.

Escalate depth with risk: a color tweak needs (1)+(3); a generator or
physics change needs all four. Never commit on (1) alone.

## Headless environment facts (save yourself the debugging)

- Chromium is at `/opt/pw-browsers/chromium`; flags used by every tool:
  `--headless=new --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader --no-sandbox`. Serve via
  `PORT=<n> python3 tools/devserver.py` (CDN is blocked; three.js is
  vendored locally — keep it that way).
- **Baseline console noise**: exactly one `ProgressEvent` error is
  pre-existing and acceptable; rare seed-dependent `computeBoundingSphere`
  NaN too. ANY other error is yours.
- **Sim time crawls headless** (~60x slower: SwiftShader fps + clamped dt).
  Don't wait wall-clock for game-time events — jump state directly
  (`CBZ.dayCount(n)`, `CBZ.dayPhase(x)`) or sleep generously.
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

## Hard rules that keep the game correct

- **Determinism**: world builds must be byte-identical per seed across
  clients (multiplayer). In any build/generation path use `CBZ.hash01(x, z,
  salt)` / `CBZ.hashN(...)` (position-hash) or `CBZ.seedStream(name)` —
  NEVER `Math.random`, and NEVER add/remove draws on a shared `rng()`
  stream (order-fragile). Runtime-only FX may use `Math.random`.
- `?seed=N` in the URL selects the world; tools accept a seed where relevant.
- Batching: `core/batch.js` merges static geometry once at load. Meshes with
  colliders/LOS refs or non-empty `userData` are spared. Per-building
  removal goes through `CBZ.batchHideGroup/batchShowGroup` — never dispose
  merged buffers.
- Explosion wrappers (`cityExplosion` et al.) are wrapped by several modules:
  copy EVERY `*Wrapped` marker forward when wrapping, and make handlers
  idempotent per blast (see demolition.js's `opts._demoSeen`).
- New feature flags: `CBZ.CONFIG.<AREA>_<BEHAVIOR>` in `src/config.js`,
  `if (CBZ.CONFIG.X == null) CBZ.CONFIG.X = default;` — every risky feature
  must be a one-line revert.
- New scripts load via a `<script>` tag in `index.html` — order matters
  (`config.js` → `seed.js` → world → systems).

## More docs

- `tools/STUDIO.md` — studio.mjs subjects/modes/flags in full.
- `PROCGEN.md` — the method behind generation (seed tree, fields, roadmap).
- `INFINITE-WORLD.md` — chunked-world migration plan (M0–M8).
