# CLAUDE.md

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
3. **Targeted in-page probes** — for behavior, write a throwaway CDP script
   (copy the boot boilerplate from `tools/math-gate.mjs`): boot headless
   Chromium, wait for `CBZ.bootComplete`, `Runtime.evaluate` straight into
   the live game, assert on real state (`CBZ.city.arena.lots`,
   `CBZ.cityCrowdAgent(i)`, `CBZ.colliders.length`…), and use
   `CBZ.stepSim(1/60)` bursts to advance time instantly instead of waiting.
   Minutes to write, seconds to run, tests the REAL game — never a mock.

VISUAL TOOLS — owner-request only, NEVER in the default loop (the owner
judges appearance by playing; do not spend loop time on screenshots):
`tools/studio.mjs` (asset turntables), `tools/street-shot.mjs` (street
scene), `tools/city-atlas.mjs` (top-down world), `tools/demolition-check.mjs`
(destroy→rebuild arc; its FLOATING-GEOMETRY AABB-chain invariant is still a
good pattern to copy for structure builders), `tools/smoke-play.mjs` (full
RENDERED boot + screenshot — the only gate that exercises the real render
path; run it once before a big deploy or when render-path code changed,
otherwise skip). `tools/terrain-map-audit.mjs` is the deep-dive superset of
the math gate's terrain sweep for terrain-focused work.

Escalate depth with risk: a color tweak needs (1); logic needs (1)+(2);
behavior/systems work needs all three. Never commit on (1) alone.

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

## Engine systems — REUSE these, never re-invent

One conversation-long push turned several one-offs into shared grammar.
Before building anything adjacent, wire into the existing system:

- **Death/kill bus** — `src/city/killfeed.js`. EVERY death funnels through it
  (it wraps `cityKillPed`/`cityCrowdKill`/player death; lazy-retry hooks).
  New death sources call `CBZ.cityLogDeath(name, cause, {by})` or
  `CBZ.cityKillFeed(by, name, cause)`. It owns the ONLY sanctioned HUD
  popup (the Fortnite corner feed) — never toast a death yourself.
- **Boarding-door grammar** — `src/city/aircraft_doors.js` (phased
  walk→open→step→handover→close arcs; theft revert via onFail) and the
  airliner cabin/cockpit door easing in `island_airport.js`. Anything with
  a door the player passes through (vehicles, future rides) uses these
  beats; `src/city/elevators.js` is the gold standard.
- **Lock-on / scope** — `src/systems/lockon.js`. Missile-class weapons get
  targets via `CBZ.lockonFireTarget()` / `CBZ.lockonMissileSeek()`;
  scoping via `fpsScope/fpsCanScope/fpsScopeToggle`. ALL camera FOV
  writers must yield to `CBZ.fpsScopeFov()` (precedence: fitted optic >
  lockon scope) — a scope-blind FOV writer re-creates the "fake scope" bug.
- **Touch layer** — `src/systems/touch.js` + `touch_vehicle.js`. Fixed
  stick (rim = sprint, press = crouch), slide-holds (aim/scope→fire),
  verb pills (words for interactions, icons for combat), stale-touch
  sweepers. New on-screen controls join THIS layer; never add a parallel
  touch handler. Interaction popups on touch are tappable pills, and
  single-verb rides are SILENT (press/tap to take — see
  `interactions.js` SILENT_RIDE; the airliner BOARD/HIJACK card is the
  one sanctioned exception).
- **HUD doctrine** — the only popup is the killfeed. Rich info lives in
  logic/phone/leaderboards, not floating cards; aiming shows a floating
  `Lv.N Title` overhead pill (`aim_dossier.js`), full data stays
  available via `CBZ.cityActorDossier()`. Never render keyboard key
  glyphs on touch (`CBZ.touchActionPrompt` re-skins prompts).
- **Numeric world audits** — `tools/terrain-map-audit.mjs` (biome/relief
  grid, mountains-outside-snow, city-on-mountain, region overlaps) and
  `tools/world-audit.mjs` (object overlaps/lint). Terrain/layout changes
  verify with THESE (no-visual closed loop), then the smoke gate.
- **Roles / ranks / allegiance** — `src/city/factions.js` (`CBZ.factions`). The
  ONE place an organisation is declared. `CBZ.factions.declare({id, name,
  ranks:["Recruit","Private",…], wage, heat, hostileTo, admission, bind})` and
  you have a joinable, rankable, paying outfit — no rank array, no membership
  field, no promotion function, no payroll code of your own. `ranks` accepts
  bare strings OR gangs.js's `RANKS` table verbatim. If the org's membership is
  ALREADY stored somewhere, pass `bind:{get,setRank,addCredit,addStanding}` and
  factions.js reads/writes THAT record — it never mirrors state (the parallel-
  bookkeeping trap that killed proptypes.js). The ONE membership query is
  `CBZ.factions.orgIn(id)` / `.isMember(id)` / `.tier(id)` / `.reactionTo(a,b)`
  — never re-derive `g.playerGang` again (16 files did; that is the ratchet).
  **Every rung must unlock a VERB, not just a bigger number** — a rank that
  only raises a payout is a vanity XP bar (see `contracts.js` UNLOCKS).
  Ratchet: `CBZ.factionAudit()`, baseline 27, currently **19**.
- **Missions / objectives / contracts** — `src/core/mission.js` (`CBZ.mission`).
  ONE tracked, paid objective primitive: `CBZ.mission.start({id, title, goal,
  at|actor|vehicle|object, reward, onComplete})` where `goal` is
  `reach|kill|steal|deliver|destroy|survive|timer|custom`, or pass `stages:[…]`
  for a multi-leg job. One call buys completion detection, the `g.cityJob` HUD
  distance line, the map waypoint, the world beacon, the phone mission card and
  the wallet payout — **build none of those again**. `CBZ.mission.onInterrupt(fn)`
  is the ONE death/arrest/mode-exit sweeper (it is what cures modal soft-locks;
  never grow a local one). Packages get a never-null handle via `ctx.mission()`.
  Ratchet: `CBZ.missionAudit()`. Job GIVERS live in `src/city/contracts.js` —
  and its rule is binding: **the generator picks the verb, the WORLD supplies
  the specifics.** Never spawn a target for a contract; bind to the ped, lot,
  vehicle or officeholder the simulation was already running, and do not offer
  the contract at all if the world cannot supply one.
- **Camera polish flags** — `CAM_*` in `src/systems/camera.js` (occlusion
  follow, FP↔TP blend, vehicle free-look/look-back via
  `camFreeLook`/`camLookBack`/`camRecenterSuspended`, air bank, shoulder
  swap). Vehicle-recenter writers must respect `camRecenterSuspended()`.
- **Predator grammar** — `src/systems/predator.js`. ONE shared answer to "a thing
  hunts you and takes you", so the next predator (or human grappler) authors only
  its numbers and its model. Three layers, each independently useful:
  `CBZ.predatorHunt(hunter, target, dt, opts)` is the stalking FSM
  (cruise→scent→circle→bump→vanish→rush→seize→disengage) with a `move(...)`
  locomotion seam, so it is medium-agnostic — a shark and a big cat run the same
  brain. It carries the **menace gauge**: after every commit the hunter is FORCED
  to disengage and may not re-commit for 4-10s. That is the anti-habituation rule
  (Alien: Isolation's), and it is why the encounter stays frightening on the tenth
  meeting. Most circling deliberately ends in NOTHING (45% vanish / 30% bump /
  25% rush) — a cue that reliably predicts an attack stops being frightening.
  `CBZ.predatorSeize(attacker, victim, opts)` owns the grab: wind→strike→hold→
  resolve, with ONE telegraphed timed press to break free (never a mash meter).
  `CBZ.predatorDread(source, level, {dist})` is the tension bus — the Jaws law,
  approach-motif tempo IS the distance readout — plus `CBZ.predatorDrop(secs)`,
  the near-silence before a strike. Set `hunter.state = "stalk"/"charge"` and
  `markers.js`'s existing `cityTargetsPlayer()` lights every threat surface free;
  never add a parallel threat marker. Ratchet: `CBZ.predatorAudit()`, baseline 5
  legacy / 1 adopted, currently **0 / 8**.

  **`CBZ.predatorKit(actor, overrides)` IS HOW YOU ADOPT IT.** Never hand-write an
  opts bundle again. It derives the WHOLE thing — radii, speeds, circle time,
  reach, damage, ambush, and the entire `seize` sub-object — from the species'
  own `scale`/`spd`/`bite`, through ONE archetype table keyed on the style string
  `creature_combat.js` already returns. **No species name appears in it, and
  adding a species must never mean adding a row.** The table's power laws are not
  invented: they were solved against the great white's and megalodon's
  hand-authored numbers and reproduce both to under 2% on 9 of the 11 shared
  fields (`bumpDmg` is a deliberate 11% divergence and `rushSpeed` 2.4% on the
  megalodon) — so the shark's authored feel is now the curve every land predator
  runs on. Pass `overrides` for your `move`/`onHit`/`canReach` and any one number
  you genuinely disagree with; `move` is deliberately never set, because
  locomotion is the seam. **`predatorKit` deletes your NUMBERS, not your seam** —
  a migration still writes its own locomotion, ownership handback and degrade
  path (~60-170 lines), it just stops authoring ~20 radii/speeds/holds. Do not
  read "two lines" as the total cost. `wildlife_shark.js` is the one consumer
  that has NOT adopted it and still hand-writes its bundle, which is why
  `ARCH.lunge` and the shark can drift — migrating it is the next debt owed.
  Companions: `CBZ.predatorIs(actor)` is the ONE answer to
  "does this hunt the player" (never re-derive a danger threshold),
  `CBZ.predatorStill(hunter)` says an ambusher is holding motionless and your
  wander step must not move it, and `CBZ.predatorProvoke(hunter, target)` is what
  a gunshot calls so a shot bear cannot shrug you off.

  **`CBZ.predatorPack(hunter, target, dt)` → `commit`/`flank`/`hold`** is why a
  wolf pack is not four wolves. At most one hunter near a target holds the commit
  token; the rest are steered to their own bearing slot so they SURROUND you. Call
  it before `predatorHunt` and pass `opts.canReach = () => false` on flank/hold —
  the FSM already honours that, so coordination costs the state machine nothing.
  It subsumes `wildlife.js`'s old `HUNTER_CAP`; do not invent a third cap.

  **The seize styles are a vocabulary, not a switch**: `shake` · `roll` (a real
  ~1.6 Hz death roll about the body's long axis — it needs the scoped `YXZ` Euler
  swap, because r128's default `XYZ` makes `rotation.z` model PITCH and
  `rotation.x` a WORLD tilt) · `drag` · `pin` (the big cat — the body goes STILL,
  and the stillness is the scare) · `maul` (the bear — an asymmetric REAR→SLAM
  saw; the rhythm is the horror) · `worry` (the wolf/dog — driving backward,
  7-9 Hz, re-biting) · `constrict` (no thrash at all, damage in rising steps).
  `predatorKit` picks yours from MASS, so a 1.15-scale threshold separates rearing
  from shaking with no name test. Mashing break-free outside its window is not
  free — panic feeds the thing holding you (`PREDATOR_PANIC`).
- **Predator bodies** — `CBZ.predatorPose(a, style, p, k, dt)` in
  `systems/predator_anim.js`, the LAND sibling of the swim rig (`predatorMaw`,
  `predatorRear`, `predatorSwat`, `predatorWorry`, `predatorCoil` underneath it).
  Land animals had no jaw and no spine bend at all — only leg swing — so when a
  bear grabbed you nothing on the bear moved. Discovery is geometric from the
  existing `a.gait`/`a.swim`/`a.segs` (front legs = columns with `x > 0`; the maw
  is the lower-forward half of the head cluster, the same test `buildSwimRig`
  already uses on a shark), so all 45 species animate from one change and any new
  one is free. **There is no species table — do not add one.** It COMPOSES on top
  of `gaitAnimate`, which writes absolute leg positions every frame, so it must
  run after it and track its own offsets. Flag `PREDATOR_ANIM`.
- **Bite wounds** — `CBZ.bodyBite(actor, point, {jaw, sev, sever})` in
  `systems/wounds.js`. A mouth leaves two opposing crescents of torn punctures,
  not the single bullet disc every biting creature in this game used to stamp.
  Callers pass only their JAW RADIUS in metres, so a terrier (0.16) and a
  megalodon (1.2) run identical code — never special-case a species.
  `CBZ.bodyWound(..., {melee:"bite"})` routes here, so adoption is one word.
- **Gore knows its medium** — `systems/gore.js` auto-detects air vs water
  (`CBZ.goreMedium`, `CBZ.waterSubmergence`). Underwater, the ballistic
  spray/pool/wall-splat layers are skipped for `CBZ.goreBloom` (a billowing
  plume) + `CBZ.goreSlick` (a drifting surface slick). Blood underwater is NOT
  red — red is absorbed first, so the pooled material ladder ramps bright →
  brown → **green-black** with depth. No caller changed a line; every existing
  death in water got this for free. `CBZ.goreChumList()` publishes live blood
  sources so AI can smell them. Flag `GORE_WATER`.
- **Held bodies** — `CBZ.ragdollPin(target, {point, at, until})` in
  `city/ragdoll.js` pins one verlet mass point to a moving transform so the rest
  of the skeleton whips off it (a body thrashed in jaws). Plus buoyancy: a corpse
  in water rises and floats instead of sinking through the seabed.
- **Swimming bodies** — `CBZ.buildSwimRig/animateSwim/swimJaw` in `wildlife.js`.
  The gait rig used to bail on `sp.aquatic`, so every fish, dolphin, whale and
  shark was a rigid mesh sliding through the sea. Discovery is geometric (tail =
  children behind the origin; tip proportions pick lateral vs. vertical
  undulation), so all five aquatic species animate from one change and any new
  one is free. There is no species table — do not add one.
- **SEA LEVEL MOVES** — `CBZ.waterSurgeSet(m)` / `CBZ.waterSurge()` /
  `CBZ.waterSeaY()` in `world/water_spec.js`. A signed offset on mean sea level,
  and it is the ONLY way water rises in this game. It lives inside the one
  function the ocean's `uSeaY` uniform and the CPU `waterWaveHeight` query both
  read, so raising it moves the rendered surface, every buoyancy solve, every
  hull attitude probe, the swimmer's waterline, the beach's wet-sand apron and
  the submergence test TOGETHER — none of those files knows the sea can move and
  none of them should be told. Two companions keep look and gameplay honest:
  `uShoreCut` (water_spec) walks the shader's shoreline discard inland, and
  `waterfield.js`'s `floodReach()` walks the WATER MASK inland by the same
  amount (22:1 run-up), so `CBZ.cityWaterAt` turns true for flooded streets —
  that is what makes a flood real to swimming, drowning, boats, sharks, gore
  medium and the underwater view. `CBZ.cityFloodDepthAt(x,z)` answers "am I in
  the flood" as distinct from "am I in the sea". **Never build a rising flood
  mesh.** That is precisely why `systems/disasters.js`'s tsunami stayed locked
  in the survival arena for its whole life: a separate mesh has to be taught to
  every water consumer individually. `city/tsunami.js` is the whole main-world
  event and it authors no water, no flood damage model and no panic AI.
- **Beach/outdoor furniture** — `CBZ.furnish.lounger` / `.deckchair`
  (`city/furniture.js`). A lounger registers a propuse BED, so lying on one runs
  the same walk→perch→swing arc as getting into a bed; a deck chair registers a
  SEAT and runs the office-chair arc. The lounger is deliberately FLAT (the
  raised backrest a real one has is what a lying body clips through). `opts.tone`
  now also takes a literal `{cloth, frame, …}` object, for a caller placing many
  copies of one piece in different colours. `done()` returns `beds` alongside
  `seats` so a caller can put somebody on what it just drew without a coordinate
  search — which is how `city/beach.js`'s sunbathers work: `cityPostNpc` +
  `propSit`/`propSleep`, no beach body and no beach brain.
- **Posted officers** — `c._post = {x, z, fx, fz, relaxed}` in `city/police.js`
  is the standing-officer brain (walks back to the slot, holds it, LOS check,
  aim, arrest-first). It was private to the pursuit roadblock; `city/checkpoints.js`
  is its second consumer. `post.relaxed` (new) means holstered until you actually
  have stars — a roadblock is staged against a live pursuit and is always gunned
  up, a standing checkpoint is not. `CBZ.cityMarkCruiser(car)` and
  `CBZ.cityCruiserModel()` are exported so nothing ever again has to choose
  between copying twenty lines of light-bar/door-panel geometry and parking an
  unmarked sedan it calls police.
- **Roads know their limits** — `CBZ.roadSegmentAt(x,z,pad)` /
  `CBZ.roadSpeedLimit(x,z)` in `city/roadrules.js`, off `city.roads` — the
  record EVERY road builder in the game already pushes and nobody had ever
  queried. `carcluster.js`'s district-of-the-nearest-LOT stopgap is now dead by
  load order alone (`CBZ.clusterAudit().limitIsFallback` reads false). It also
  killed a stat fiction: wanted.js's `"speed"`/Reckless Driving crime had zero
  callers for its whole life.

  HONEST STATUS (2026-07-26, after the predators wave): `bodyBite` and the gore
  medium have real adoption (3 consumers / every existing gore caller).
  `predatorHunt`/`predatorSeize` went from ONE consumer to **eight** — every
  migration named in the previous status is done: `games/ocean.js`'s separate
  shark FSM, `dogs.js`'s aggro brain, `wildlife.js`'s land-predator charge and
  herd charge, and both snake paths, plus `wildlife_shark.js` finally declaring
  the adoption it always had. `CBZ.predatorAudit()` reads `{legacy: 0, adopted: 8}`
  and **may only ever go DOWN** — if you add a site id you migrate it in the same
  change. `ragdollPin` still has ONE consumer (the seize) and remains at-risk;
  that is the next migration owed, not a solved problem.

  HONEST STATUS ON THE WATER/ROADS WAVE (2026-07-26): `waterSurge` has real
  adoption — 8 files migrated off raw `CBZ.SEA_Y` onto `CBZ.waterSeaY()` in the
  same change, plus the shader cut and the water mask, and `city/tsunami.js`
  proves it by authoring no water. It is NOT finished: **`systems/disasters.js`
  still owns a separate arena tsunami with its own rising flood pool and has
  not been migrated.** That is now a duplication, it is the next migration
  owed, and it is the reason this entry says "never build a rising flood mesh"
  rather than claiming there is only one. `_post` went from one consumer to
  two; `furnish.lounger`/`.deckchair` and `roadSegmentAt` each have ONE
  consumer today (the beach, the cluster) and are therefore at-risk by this
  file's own rule — the next beach, promenade, pool deck or road system that
  needs them must ADOPT rather than re-author.

  The lesson worth keeping: what made these blocks finally get adopted was not the
  FSM, it was `predatorKit`. Three separate consumers had refused to adopt a
  system whose entry cost was hand-authoring 25-37 lines of tuning. Derive the
  caller's numbers for it and adoption costs two lines. **If your shared block
  needs a config bundle, ship the thing that WRITES the bundle, or the block will
  sit at one consumer forever.**

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

## THE BLOCK LAW — how capability work must ship

OWNER DOCTRINE (2026-07-26): "every feature I came up with was built as an
add-on with all new code when really it just needed to reuse other shit and
draw some new shit and animate it." The repo is fat because features pile up
instead of compounding. Every change must IMPROVE a shared capability, not add
a parallel one. A new experience should author only what is genuinely new — an
asset, an animation, a payout rule — and get NPCs, interiors, prompts, money,
missions and damage for free.

This has been attempted once and it failed. July 1-2 built `core/prio.js`,
`systems/proptypes.js`, `core/interfaces.js`, `bootstrap.js`. Today:
interfaces.js has ZERO adopters, proptypes.js has ONE (bypassed the same day it
shipped, by the same author, for a competing system). Meanwhile `ctx`
(`core/packages.js`) got 10 adopters in two days and `interactions.js` has 18.
The difference is not quality. It is this:

> **A block must REPLACE code the caller writes anyway. A block that adds
> parallel bookkeeping dies within 24 hours.**

Therefore, any new shared capability MUST satisfy all five:

1. **One-line adoption, zero ceremony.** No schema to declare, no type to
   register, no call signature to change. If adopting costs more than the line
   it replaces, it will not be adopted. Copy the shape of `interactions.js`
   (`I.register("ped:civ", {id, slot, label, onSelect})`) or `ctx.*`.
2. **Degrade-safe fallback.** `CBZ.X ? CBZ.X.thing : <old inline value>` —
   adopting must never be able to break the caller. This is the ONLY reason
   prio.js survived at all where its siblings did not.
3. **Ship with ≥3 real consumers migrated in the SAME change.** A block with
   zero consumers is prose. Migrating the consumers is what proves the API and
   is 80% of the work — budget for it.
4. **Named in CLAUDE.md.** In-file "RULE FOR NEW CODE" comments demonstrably
   did nothing. If it is not law here, it does not exist.
5. **A ratchet counter in the math gate.** Export `CBZ.<name>Audit()` from the
   real game file (NOT a tool) returning the count of remaining legacy call
   sites, and pin it in `tools/math-gate.mjs`'s PASS block at its current
   value. The number may only ever go DOWN. `CBZ.treeAudit()` (commit d582a82,
   pinned at zero) is the working template — copy it exactly.

CURRENT RATCHET BASELINES (2026-07-26 RE-CENSUS; each is a duplication count
that may only DECREASE). The previous numbers here were guesses and every one
of them was too low — some by 8x. These were counted file-by-file. Do not
trust a number in this list without recounting; do not lower one without
showing the work:

| what | old claim | TRUE |
|---|---|---|
| raw `.hp -=` / health-field writes bypassing a bus | 19-20 | **52** |
| independent AI update loops | 18-25 (2 share) | **32** |
| buy/purchase transactions | 6 | **52** (77 incl. bribes/gambling) |
| ownership containers | 9 | **15** |
| NPC-in-building spawners | 9 | **18** (`occupyAudit()` sees only 9) |
| rank/tier ladders | 6 | **20** (gang ladder retyped 8x / 6 files) |
| reputation scalars | 9 | **34** |
| objective UIs | 5 | **6** live + 1 dead stub |
| buoyancy impls | 6 | **10** |
| mission systems | 7 | **12** (5 on `core/mission.js`, 7 private) |
| raw material constructions bypassing `CBZ.cmat`/`mat` | — | **566** |
| phone UIs | — | **2** (`phone.js` 984 + `campaign_ui.js` 1138) |
| furniture anchors NOTHING can walk to (`propUseAudit().blocked`) | 0 (claimed) | **487** of ~6000 |
| seat anchors with no declared cushion (`.noGeom`) | — | **4955** of 5993 |

The last two are the newest entry and the sharpest lesson in this table: both
numbers come from an audit that had existed for weeks with a header confidently
instructing the next person to "pin `blocked` at 0". The first build that ever
RAN it read 487. **An audit nobody has executed is not a measurement.** Run
yours before you write its baseline into this file.

Two counters moved the RIGHT way and are worth copying: the gang ladder is no
longer typed 3x inside one file (`playergang.js:651` is now a single
documented fallback), and `core/mission.js` genuinely took 5 adopters.

ALSO BANNED: **stat fictions** — a flag that claims something exists with no
world presence. Live examples, all verified this census:
- `g.cityPhoneTier` — `shops.js:464,704-712` sells four phone upgrades
  promising "better deals & street intel"; the value is read by NOTHING except
  the four lines that sell, cap and display it.
- `CBZ.forex.convert()` (`sim/forex.js`) — zero callers. The player can read
  four exchange rates on the phone and can never act on them.
- `"communism"` / `"fascism"` govTypes — 9 gates across `regimes.js`,
  `polwar.js:519`, `civilwar.js:600`, `militia.js:329,336,343`,
  `sim/centralbank.js:242` branch on them (police multipliers, tax rates,
  price controls). NO producer anywhere assigns either value. Full effect
  code behind a door that cannot open.
- `/me` `/do` `/ooc` chat modes — `net/netui.js:136-138` styles all three and
  the placeholder advertises them, but `net/net.js:71` never parses a slash
  command or sets `m.kind`. Permanently unreachable.
- `sim/hyperinflation.js` — 1045 lines (largest sim file). Its entire public
  API has zero callers outside `src/sim/` except save/load serialization.
  `counterfeit()` is a complete, tested cash-injection mechanic no button
  reaches.
(The old "$4M Superyacht" citation was stale — `wealth.js:344-354` already
deleted it with a NO-FICTION NOTE. That is the pattern to copy.)

## More docs

- `tools/probe-wave.mjs` — the worked example of step (3), a targeted in-page
  probe. Asks the LIVE world four questions syntax cannot: did the beach
  furniture register real anchors, does `roadSpeedLimit` post more than one
  distinct limit across the whole map, are the checkpoints manned, and — the
  one that matters — does a sea surge turn a point that was DRY LAND into
  water. Copy its shape; that last assertion is the pattern (prove the flood is
  real to the game's own queries, not just to the shader).
- `tools/STUDIO.md` — studio.mjs subjects/modes/flags in full.
- `PROCGEN.md` — the method behind generation (seed tree, fields, roadmap).
- `INFINITE-WORLD.md` — chunked-world migration plan (M0–M8).
