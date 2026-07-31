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
   EDITING math-gate.mjs: the whole per-seed pass is ONE JS template literal
   (`PASS`) sent via Runtime.evaluate — a BACKTICK anywhere in an added
   comment terminates it early and the SyntaxError points at an innocent word
   (this repo's comment style uses backticks constantly). Same family: a
   ratio like `s*/s` inside a `/* */` block comment closes the comment.
   Always `node --check tools/math-gate.mjs` after touching it.
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

## WHO VERIFIES — builders build, the orchestrator gates

OWNER DOCTRINE (2026-07-27): "their job is to build and have great physics and
realisticness, but not to test. Testing is done by me, the orchestrator, quickly
before merging to main. They just need to focus on research if needed, and
building. **They are artists not scientists.** It will make them not only more
efficient but also make them write more new artistic and meaningful code and
make the world look better — and worry less about testing and more about READING
CURRENT CODE and writing better or new code."

So the loop above is not everyone's job. It splits:

**A BUILDER (subagent) does:** research, read the surrounding code until it
understands the seam it is touching, and build. `node --check` on every file —
that is not a test, it costs nothing, and a syntax error blocks the whole wave.
Then report PRECISELY what it would have verified: the audit calls, the expected
values, and every invariant it thinks its change could plausibly break. It must
still EXPORT its audits so somebody else can call them.

**A BUILDER DOES NOT:** boot a browser. No math gate, no CDP probe, no
screenshot tool. Each of those costs 15-90 s of setup to answer a 3 ms question,
and a parallel wave of them once left 93 orphaned Chrome profiles, 6.6 GB of
disk and ten live headless instances that stopped the owner's real browser from
opening. `tools/probe.mjs --serve` exists so ONE live world answers many
queries; even that is the orchestrator's tool.

**THE ORCHESTRATOR does:** one gate run on the MERGED state, immediately before
push. Not per-agent, not per-file — once, on what actually ships.

WHY THIS IS NOT A LOWERING OF STANDARDS. The number of gate runs is not the
quality signal; what the gate CATCHES is, and it catches the same things whether
it ran once or twenty times. What twenty runs cost is the thing that actually
produces quality here — time spent reading the file you are about to change.
Every genuinely good fix in this repo came from reading, not from running: the
airliner console sitting 0.09 m ABOVE the pilot's eye, the blood soak comparing
a RADIUS against a part's WIDTH, `findRoad` matching a junction to a road it was
never on, the pelvis wearing prison orange because no code path had ever painted
that slot. None of those were found by a test. They were found by reading, and
then a number was written to PIN them.

THE ONE CONDITION that makes this safe, and it is on the orchestrator: the gate
must actually run before merge. Freed from testing, a builder can produce
confident code that does not execute — this repo has already seen a wave leave
`world.js` throwing mid-edit. Builders trade verification for reading time; the
orchestrator owes them the verification back.

HOW A WAVE RUNS (the shape that has shipped cleanly): cheap recon scouts map
each territory FIRST with file:line evidence; the orchestrator writes dense
briefs embedding the recon + owner doctrine + explicit territory fences
("do not touch X, another agent owns it" — fenced briefs are what make
builders reliable); builders build in parallel in the shared tree; the
orchestrator itself applies the cross-territory seam patches at merge (the
one-liners no single builder could own), gates ONCE, commits by territory.
The recurring Edit-race files are `index.html` and `src/config.js` — declare
new flag defaults in the OWNING file via the null-check pattern instead of
config.js. Before pushing, `git fetch` and check `git log`: another live
session (local or the cloud fleet) may have landed commits mid-wave; expect
surgical foreign commits and merge, don't panic.

Escalate depth with risk: a color tweak needs (1); logic needs (1)+(2);
behavior/systems work needs all three. Never commit on (1) alone.

## Headless environment facts (save yourself the debugging)

- Chromium is at `/opt/pw-browsers/chromium`; flags used by every tool:
  `--headless=new --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader --no-sandbox`. Serve via
  `PORT=<n> python3 tools/devserver.py` (CDN is blocked; three.js is
  vendored locally — keep it that way).
- **macOS (the owner's machine): `/opt/pw-browsers/chromium` does NOT exist.**
  Every gate/probe falls back to
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (override:
  `CBZ_CHROME=<path>`; math-gate gained the fallback 2026-07-21). A new tool
  that spawns Chrome must copy this resolution or it ENOENTs on this machine.
- `?cfg_<FLAG>=0/1` URL params override any `CBZ.CONFIG` flag BEFORE boot —
  the only way to A/B a build-time flag headless (a same-page reset reuses
  the already-built world, so flipping after boot proves nothing).
- Probes sending synthetic keys: create ONE KeyboardEvent per press and
  dispatch it ONCE — dispatching the same event object twice throws silently
  and the key never registers.
- Probes that need free play: the campaign boots into a rooftop prologue;
  jump straight to free play with
  `CBZ.game.cityCampaign.phase = "endless_contracts"`.
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
- **The map is laid out on purpose** — `CBZ.CONFIG.WORLD_LAYOUT_V2` +
  `SPREAD_V3` in `src/world/layout.js`, the rim-relief law in
  `city/continent.js`, and `CBZ.worldLayoutAudit()`. OWNER: "the cities and
  mountains are good but they are much too close together. The mountains should
  be on all snowy area and should be on the edges of the map with just small
  cities. The map should be much more intentionally laid out." Measured before:
  the tightest strait in the shipped world was **69 u** (Goldspire↔Cape Harbor)
  and the country hills stood the same height 200 m from downtown as 5 km out
  (**167 inner-half hill cells**). After: playable area **+26%**, mean
  nearest-neighbour gap **617→828**, inner-half hill cells **167→3**, relief
  mean **3.5→1.0** — with `mountainCellsOutsideSnow` and `cityOnMountain` both
  held. The METHOD matters: the existing snow-sector relief law was NOT
  re-engineered (that would have weakened a working gate) — the RECT it keys
  off was grown, so the whole backdrop ring walks outward and nothing else is
  told. `city/continent.js`'s backcountry hills now run through a box-metric
  rim gate with a **hard 23 u ceiling strictly under the 25 u doctrine line**,
  so backcountry can no longer produce a mountains-outside-snow cell BY
  CONSTRUCTION rather than by luck. `skylineForPlace` bends only the
  silhouette, never the footprint, so a rim town is short without losing lots
  or jobs. **`city/highwaynet.js`'s seven free-country lane constants are raw
  literals, not dial-derived** — every DOCK follows `CBZ.worldOff` but those
  seven did not, so a world move silently routed the loop through Fort Brandt
  and the Saltlands while `clearanceSweep` only `console.warn`ed. Re-measured
  now; if you move a landmass again, re-check them.
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
  Ratchet: `CBZ.factionAudit()`, baseline 27, currently **17**.
- **A RANK IS A VERB, OR IT IS NOTHING** — `CBZ.rankCan(actor, org, verb)` /
  `CBZ.rankHolder(org, verb)` / `CBZ.rankKnows(org, verb)` in `city/factions.js`.
  OWNER (2026-07-27): "different levels in orgs etc etc — roles can be greatly
  expanded." The law above ("every rung must unlock a VERB") shipped with **no
  answer function**: `contracts.js` enforced it for the PLAYER via `minRank`, and
  nothing could answer it for an NPC — which is why `police.js` ran a whole force
  off ONE boolean (`swat`) in 3300 lines and `level.js`'s eight military rungs
  were, in its own census's words, "pure display". Two questions are now
  askable, and the second is the one that gives an org a SHAPE: **a roadblock is
  an ORDER, and an order needs somebody alive to give it.** Adoption is
  `grants:["roadblock"]` on the rung that opens it plus `rankField:"copRank"`
  once for the org — **`rankField` is what keeps this a migration and not
  parallel bookkeeping: an NPC's rank stays in the field the world was already
  writing** (`copRank` · `milRank` · `rank`), and factions.js never stores one.
  **The degrade-safe guard is `rankKnows`, never a bare null check on
  `rankCan`** — rankCan answers FALSE for an undeclared org, so `if
  (!rankCan(…)) return` would SLAM every gate shut the moment `FACTION_V1` was
  flipped off. What each rung actually opens, all enforced, none aspirational:
  police — Corporal `moveon`/`partner` (the move-along and the two-officer beat)
  · Sergeant `roadblock` · Lieutenant `swat` · Captain `air` (Air-1) · Chief
  `standdown`; army — Sergeant `enlist` (a private cannot swear you in) ·
  General `crackdown`; gang — Enforcer `vouch`/`succeed`; secco — Senior Guard
  `carry` (a REAL issued sidearm), Shift Manager `cover` (one star no longer
  costs the job). **`vouch` is cross-org and lives in ONE place**: level.js's
  cover reveal used to read "any cop sees through any police cover", making a
  rookie as dangerous to a stolen uniform as the watch commander.
  **THE BRASS ARE PEOPLE YOU CAN FIND, AND THAT IS THE WHOLE MECHANIC.** A rank
  drawn as a 3% roll on a street body is a stat fiction — you could play for
  hours with nobody who could authorise SWAT. So `police.js` posts a COMMAND
  WATCH (Lieutenant · Captain · Chief) at the precinct on its own `_post`
  standing-officer brain (`relaxed:true`), and a killed commander leaves the
  chair EMPTY for 60-150 s. Kill the Chief and the department's arrest-first
  posture **lapses** — it was a config flag with no author; it is a standing
  order somebody holds. Same law on the army side: peds.js assigns military rank
  by **ROSTER SLOT** (a unit is a pyramid, and a pyramid is a roster) instead of
  the old 0.3%-per-body roll that left most seeds with no General at all, and
  level.js derives the Defence HQ officeholder's rung from the power tier
  govcomplex.js already declared him at — so the Chief of the General Staff IS
  the General. **Three ladders were deleted, not added**: level.js's `MIL_NAME`/
  `MIL_LVL` (8 rungs that existed nowhere else) and its private
  `{police, army}` audit tables now DERIVE from the declared ladder, and
  `hud.js`'s `MEMB_LADDER`/`MEMB_NEED` — the fourth copy of the gang order,
  which **disagreed with gangs.js** (Runner cost 2 bodies/$220 on the bar and
  1/$180 in the promotion that actually fires, so the sliver lied about its own
  condition). **Captain, Major and Colonel were CUT from the army ladder**: no
  verb in this game separates them, and every candidate lived in a file that
  wave did not own. Cut a rung rather than ship a number. Flags `POLICE_RANKS` ·
  `POLICE_COMMAND`. Ratchet: **`CBZ.rankAudit()`** → `{orgs, rungs, held,
  verbed, emptyRanks, verblessRungs}`; **`emptyRanks` and `verblessRungs` may
  only ever go DOWN**, with `held`/`verbed` printed beside them so an org that
  "fixes" the count by declaring fewer rungs cannot pass. NOT YET PINNED —
  measure and write the number in (do not repeat the `propUseAudit` mistake).
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
- **WHO A PERSON IS** — `CBZ.cityRole(a)` / `CBZ.cityTitle(a)` / `CBZ.cityJobTitle(job)`
  in `src/city/level.js`. OWNER DOCTRINE (2026-07-27, verbatim): "civilian isn't a
  role but tourist can be… homeless person should just be title bum. hustler is a
  title." A ROLE is something a person **does** (a job), **belongs to** (an org +
  a rank), or **is** in a way the sim acts on (bum · tourist · kid · addict).
  "Civilian", "in between jobs", "the kid" and "looking for work" are the ABSENCE
  of one. The rule that follows is the whole point: **a person with no role is a
  CASTING BUG, not a person to apologise for with a filler string** — so
  `cityTitle` calls `CBZ.cityDealRole(ped)` (peds.js) and the caster deals them a
  trade that already has a workplace, a shift and a wage in `aigoals.js`'s
  `CITY_JOBS`. level.js's 0.33 s retag sweep IS the repair pass, so the count
  self-heals during play. `job` is FREE-FORM PROSE in this codebase — always
  normalise through `CBZ.cityJobTitle`, never `titleCase(a.job)`; that is what
  stopped the pill reading "Lv.2 Panhandling", "Lv.3 Between Jobs", "Lv.4
  Cinematic" and "Lv.61 Owns Half The Skyline". Flavour prose belongs in the
  dossier's "Known for" row, never over a head. Ratchet: `CBZ.roleAudit()` →
  `{peds, roled, roleless, shrugs, kinds, titles, orgs, emptyRanks}`. **`roleless`
  and `shrugs` may only go DOWN; `emptyRanks` names declared rungs with no holder,
  which is the stat-fiction ban applied to ladders.** It no longer carries any
  rank table of its own — the `{police: COP_NAME, army: MIL_NAME}` loop that used
  to live in it is DELETED, and the declared ladders cover both, so this and
  `CBZ.rankAudit()` can never disagree about what a rung is. THE BASELINE IS NOT
  YET MEASURED — the gate reports it and does not fail; whoever runs it first
  writes the number in (do not repeat the `propUseAudit` mistake of pinning a
  guess).
- **A DISPLAYED ROLE IS A CLAIM, NOT A FACT** — `CBZ.cityTrueRole(a)` /
  `CBZ.cityTitle(a, viewer)` / `CBZ.citySeesThrough(a, viewer)` /
  `CBZ.citySetCover(a, {role, lvl, org, seeTier})` / `CBZ.cityBurnCover(a, secs)`,
  all in `level.js`. OWNER (2026-07-27): "nobody would have role agent, they would
  have whatever role the agent puts... they would have role agent if you joined
  their agency! … there can be fake level and role but actually agents." An
  intelligence officer whose pill reads *Agent* is not an intelligence officer.
  So every actor has a TRUE role (what the **simulation** acts on — never lies)
  and a PRESENTED role (what an observer is **entitled** to see). **Anything
  making a DECISION reads `cityTrueRole`/`cityTrueLevel`; anything DISPLAYING one
  reads `cityTitle`/`cityLevel`.** `viewer` defaults to the player, so all ~40
  one-argument call sites are unchanged, and an actor with no cover costs one null
  check. **THE LEVEL LIES WITH THE TITLE** — a Lv.72 operative presenting as a
  Lv.9 clerk must READ 9 or the number gives away what the title hid. The reveal
  rule lives in exactly ONE function and is a rank test through `factions.tier` —
  never re-derive membership. Graded: `citySeeLevel()` returns 2 (full truth) /
  1 ("one of ours", brass-only detail withheld) / 0 (you see the claim). **Every
  leak is a bug of the same class**: the tag COLOUR and the dossier's Affiliation
  row both had to be gated too, because an allegiance colour is an allegiance
  readout. Ratchet: `roleAudit().unseeable` is **pinned at 0** — a cover with no
  org to see through it *and* no way to burn it is a secret that can never be
  discovered, i.e. a stat fiction. Flag `CITY_COVER_ROLES`.
- **THE UNIFORM IS A CLAIM ABOUT YOU** — `CBZ.cityDisguise()` /
  `CBZ.cityDisguiseTrust(org)` / `CBZ.cityDisguiseBlow(by, why)` in `outfits.js`.
  OWNER: "we already have logic for stealing others clothes, that's a huge thing
  now once there are roles that are actually being done." It IS a migration, not a
  new system: `outfits.js` already had a complete disguise mechanic (trust, a 60 s
  blown-cover timer, a heat multiplier) **hard-wired to exactly two roles** — cop
  and gang — because those were the only two roles the game had. `copTrust`/
  `blowCover` are DELETED and their exports point at the org-agnostic pair, so
  there is one trust rule and one burn timer. What makes a uniform mean anything
  is one stamp in `finishSwap`: **the corpse swap now carries the dead person's
  TRUE role** (`_claimRole`/`_claimOrg`/`_claimArms`), so you take *the flight
  attendant's uniform*, not a blue shirt. **`cityDisguiseTrust(org)` IS THE
  ONE-LINE ADOPTION** — police.js passes `"police"`, power.js passes the
  principal's org, a gate passes its own. **A disguise that always works is a
  cheat code**, so there are four breakers and each is a decision, not a dice
  roll: (a) *seen taking it* — any living witness within 22 m of the 2.4 s strip
  burns it on arrival, which is what makes WHERE you kill somebody matter;
  (b) wanted ≥ 2★ — a manhunt outranks a costume; (c) **the wrong weapon** —
  a flight attendant with an AK is not a flight attendant (roles whose claim
  is armed are exempt); (d) somebody senior in the org you are impersonating,
  within 12 m, knows they do not know you. AUTHORITY covers (police/army) buy
  the benefit of the doubt on minor crime; **ACCESS covers buy you THROUGH doors,
  never ABOVE the law** — they are a partial mask (×0.55 heat, `wanted.js`),
  deliberately weaker than `g.cityMasked`. Flag `CITY_DISGUISE`.
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
  legacy / 1 adopted, currently **0 / 10**.

  **HUMANS HUNT TOO** (2026-07-27). OWNER: "homeless people (they attack you at
  night like jump scares, like how sharks can gruesomely attack the player — not
  all but some of the homeless)." `peds.js` was running a LEGACY predator path —
  a distance band, a bark, `p.rage = player` — whose fatal flaw was that the bark
  RELIABLY PREDICTED the lunge. Both human hunters now tick the shared FSM
  (`peds:hobo-jumpscare`): about **one vagrant in six** (the volatile band ∩ a
  deterministic 0.55 hash — 2-3 people in a whole city, chosen against the menace
  gauge, because a predator you meet three times a block is a tax), and **exactly
  one SERIAL KILLER per city**, who is PROMOTED out of the ordinary cast by
  position hash and keeps the job he already had, so his pill reads "Accountant"
  until he commits. The five-in-six harmless bums keep the startle bark — that is
  what keeps the dangerous ones camouflaged. **The seize style is the identity**:
  `predatorKit` picks `worry` from a human's mass and both override it — the bum
  to `drag` (hauled off the street) and the killer to `pin` (the stillness is the
  scare) — so each is identifiable by FEEL in the dark. The counterplay is a VERB,
  not a stat: a **drawn gun refuses the commit** (`canReach` false — he still
  stalks, he cannot take you) and your own `cityLevel` shrinks his senses, so
  walking home broke and unarmed at 3 a.m. is a different city than walking home
  as a shot-caller. The killer additionally needs you ALONE (no cops in 45 u, ≤1
  witness in 28 u). Provocation is watched off the hunter's own `hp` rather than
  adding a 33rd damage contract. Flags: `CITY_HOBO_SCARE` (all of it) ·
  `CITY_BUM_PREDATOR` (just the hunt).

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
- **THE GROUND YOU SEE IS THE GROUND YOU DRIVE ON** — `CBZ.countryReliefAt(x,z)`
  (`city/continent.js`) + `CBZ.cityCarGroundY` / the private `seatCar` in
  `city/vehicles.js`. OWNER, verbatim: "THE GREEN TERRAIN WAS MADE TO NOT BE FLAT
  BUT THERE'S NO PHYSICS, SO IT'S LIKE GREEN WATER — DRIVING IN IT… IT'S LIKE
  DRIVING ON WATER." Two separate faults, both arithmetic:
  (a) **the oracle was not the mesh.** `countryHeightAt` is an ANALYTIC field
  whose finest octave is ~17 m; the plate that RENDERS it is a ~40 m triangle
  grid, so they are two different surfaces — measured **0.41 m mean / 9.77 m max**
  apart. The registered provider now samples the plate's OWN vertices across the
  plate's OWN triangles (r128 `PlaneGeometry` emits `(a,b,d)` then `(b,c,d)`, so
  the split is `tx+tz<=1` — get that wrong and you are matching a bilinear
  approximation, ~1 m off on a ridge). Measured after: **0.0002 m mean / 0.29 m
  max**. It is also 45x CHEAPER (the whole `CBZ.floorAt` stack went **6.03 µs →
  0.14 µs**), which is the only reason (b) is affordable at all.
  (b) **every car sat at a literal `y = 0`** — seven `position.set(x, 0, z)` sites
  plus parked cars, which never enter the drive loop at all and are the car in
  the owner's screenshot. `seatCar(car, dt, extraY, near)` REPLACES the line each
  site already wrote and buys ride height + terrain pitch + terrain roll. Probe
  budget is the whole perf story: a NEAR car takes 4 (one per wheel), a FAR car 1,
  a PARKED car 0 after its first tick. `_airY`, `sinkY` and `WATER_Y` are OFFSETS
  FROM the ground, never replacements for it. Flags `TERRAIN_PHYSICS_MATCH` ·
  `VEHICLE_TERRAIN`. Ratchet: **`CBZ.groundMatchAudit()` → `maxErr`** (metres of
  disagreement between the drawn plate and the physics floor) — pin it once run.
- **BUILT GROUND IS FLAT, AND THE TERRAIN IS WHAT GIVES WAY** —
  `TERRAIN_FLATTEN_UNDER_BUILT` in `city/continent.js`. OWNER: "IT OVERLAPS
  PARKING LOTS." The relief gate under an authored floor was a BOOLEAN with an
  **8 m** margin while the plate cell is **40 m**, so the triangle STRADDLING the
  kerb kept full relief at its outer vertex and its inner half climbed straight
  through the asphalt — that is the green banding, and raising the lot cannot
  cure it. The gate is now a DISTANCE (0 inside and for one whole grid cell
  beyond — so BOTH vertices of every straddling triangle read zero — then
  smoothly back over 110 m), which is the grammar `CBZ.highwayNetReliefGate`
  already used under a road corridor. **Never raise a built surface to clear the
  terrain; flatten the terrain under it.** The gate can only ever LOWER h, so
  `mountainCellsOutsideSnow` / `cityOnMountain` get MORE true, never less.
  Ratchet: **`CBZ.groundMatchAudit()` → `ungated`** (built surfaces with country
  relief still standing above their own slab).
- **YOU SINK UNLESS YOU SWIM** — `SWIM_SINK` in `city/swim.js`. OWNER: "WHEN IN
  WATER, YOU SHOULD SINK UNLESS PRESSING SPACE TO GO TO SURFACE, LIKE HOW GTA
  WORKS." Everything needed was already in the file and is reused untouched — the
  damped vertical oscillator, the bathymetry floor, the 28 s breath meter, the
  drown routed through `cityHurtPlayer(.., "drowned", ..)` which `killfeed.js`'s
  `cityKillPlayer` wrap turns into the corner feed. **The flag changes exactly one
  thing: the sign of the resting buoyancy.** The number is DERIVED, not picked —
  terminal sink is `G_WATER*(1-buoy)/VDRAG`, so a target of 0.85 m/s (between a
  passive body's few tenths and a freediver's ~1.2 in free fall) solves to
  `SINK_BUOY = 0.7544`; the 0.38 s solve time constant means the head does not go
  under for ~0.85 s, so sinking is a state you can answer. Holding Space restores
  POSITIVE buoyancy rather than merely accelerating you up, so you HOLD at the
  surface instead of porpoising. Ratchet/exports: **`CBZ.swimAudit()` →
  `{sinkRate, ascendRate, breathSec, drowned}`**; `drowned` counts real deaths
  through the ONE pipeline and is what proves the drown is not a stat fiction.
- **SCENERY MUST BE OUT OF REACH** — `TERRAIN_BACKDROP_CLEAR` /
  `CBZ.backdropAudit()` in `world/terrain_overhaul.js`, fed by
  `CBZ.CONTINENT_PLATE` (published by `continent.js`). OWNER: "there's also a very
  tall darker mountain than the rest of the mountains and it can be flown straight
  through." It is this file's offshore skyline range — DARKER because it is the
  only range drawn with a lit `MeshLambertMaterial` (Mount Mercy and the Greater
  Mercy Range are unlit `MeshBasicMaterial`), and collision-free ON PURPOSE
  ("decorative mountains are not geography"). **That contract is only honest while
  you cannot reach it**, and the world re-lay broke it: the clearance was
  ASSUMED (`PAD + 120 = 2320`) while the walkable plate actually reaches **4410 m**
  past `TERRAIN_FLAT` on its north side, because the plate pads around the REGION
  union and the Greater Mercy Range region reaches further out than FLAT does. A
  **1441 m** range therefore stood on 2.1 km of driveable backcountry with
  `CBZ.floorAt` reading 0 under it. The fix measures instead of assuming — and
  every downstream number (the relief ring band, the side weights, the tile SPAN)
  already rode that one value, so nothing else had to be told. **Do not answer a
  reachable backdrop by making it collidable** — that puts a heavy analytic field
  inside `CBZ.floorAt`, which is now called per car per frame. Ratchet:
  `backdropAudit().onPlate`, pinned at **0**.
- **A MOUNTAIN HAS A HIERARCHY** — `TERRAIN_PEAKS_V2` / `CBZ.peakShapeAudit()` in
  `city/biome_snow.js`. OWNER: "all the mountains have these curved yet sharp
  multi-peaks that don't look like realistic mountain shape." All three words were
  separate arithmetic faults in the Greater Mercy field, and the lesson generalises
  to any lobe-sum range: **(1)** a radial rib term `cos(angle*k + radius*7.0)`
  evaluated out to 4 sigma completes ~4.5 CYCLES between summit and base, so every
  ridgeline oscillated on its way down — a real ridge DESCENDS MONOTONICALLY, so
  the rib is now purely azimuthal with its depth decaying outward; **(2)** the
  summit ladder was compressed (`pow(s,0.62)`) while shoulders were allowed
  0.555x their parent, so the biggest summit's shoulders (213) out-topped SIX OF
  THE TEN SUMMITS — the share is now capped at 0.168, which is strictly under
  `1/5.754`, the exact point at which the tallest shoulder equals the shortest
  summit (hierarchy as an INEQUALITY, not as taste); **(3)** no apron — one
  `base*(1-base)` term is zero at the crest and zero in the far field and peaks
  at mid-slope, so a massif gets the long shallow foot a real one has **without
  one centimetre added to any summit** (which is what keeps the 25 u mountain
  threshold where it was). The amplitude is renormalised (92 → 67) so the steeper
  ladder does not also GROW the range: a shape change that raises the massif is a
  different change and would move the gate's mountain-cell sets. No octave and no
  noise call was added — the field costs exactly what it did.
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
- **Roads know WHO MAY USE THEM** — `CBZ.roadPick(opts)` / `CBZ.roadPlace(car,
  spot)` / `CBZ.roadOpen(r, cls)` / `CBZ.roadPointOpen(x,z,cls)` /
  `CBZ.roadCross(A,vertical,x,z)`, same file. **`roadPick` IS THE ONLY
  SANCTIONED WAY TO PUT A VEHICLE ON A ROAD.** FOUR sites used to re-type the
  same eight-line road/lane/x/z/heading draw against the flat `city.roads`
  list, and because that list is flat, none of them knew the airport airside,
  the military perimeter or a bunker shell existed — every PED path had
  honoured `arena.noSpawn` since the owner complained about people on the
  runway; cars had never been told. Adoption is one call and buys: keep-out
  refusal, water refusal, **an actual view-cone test** (the old code asked only
  "is it 62 m from the camera", which says nothing about where the camera is
  LOOKING), and district-weighted density so a farm track stops carrying Main
  Street's traffic. Pass your SEEDED stream as `opts.rng` in any build path.
  `opts.cls` is the vehicle-class filter — `"ambient"` (default, refused by
  every keep-out), `"service"` (the apron IS where a baggage tug belongs),
  `"emergency"`; a builder may also set `r.access`/`r.noTraffic` on its own
  segment. **`roadCross` is `vehicles.js`'s old `findRoad` with the missing
  containment test**: it took the nearest perpendicular segment within 9 m of a
  junction and never checked the junction was ON it, so a downtown
  intersection at x≈0 matched the AIRPORT CAUSEWAY record hundreds of metres
  south — the car adopted a road it was nowhere near, U-turned at the "end",
  and drove the length of the airfield across runway 09/27. That, not any
  spawn, was the owner's "cars inside the airport near the runway". Ratchet:
  `CBZ.roadTrafficAudit()` — `trespassing` and `onWater` are pinned at **0**
  (hard invariants, measured after the sim burst so a car that DRIVES in fails
  too), `adopted` may only go UP from **4**.
- **ROADS CONNECT PLACES, THEY DO NOT OVERLAP THEM** — `CBZ.roadClearance(x0,z0,
  x1,z1,opts)` / `CBZ.roadClamp(seg, opts)` / `CBZ.roadPropClear(x,z,road)` /
  `CBZ.roadPropRoadOk(r)` in `city/roadrules.js`. OWNER: "roads rn and all the
  props that surround roads overlap with places like the airport. roads should
  connect places but never overlap with them. that's so simple." `city.regions`
  has been the registry of PLACES since worldmap.js shipped and ~20 files push to
  `city.roads`; **not one had ever tested its segment against that registry.** The
  nearest thing was `highwaynet.js`'s `clearanceSweep`, which detected real
  crossings and only `console.warn`ed — CLAUDE.md's own failure mode, and it had
  been true and ignored for months. It now ENFORCES through the shared law.
  The law has four exemptions and **every one is derived from data the world
  already carries, so adoption is one line and no builder declares anything**:
  an UNDERLAY region (continent.js's wilds bands), a CONNECTOR by name
  (causeway/bridge/link/ramp/approach/spur/corridor — those ARE roads), **THE
  DESTINATION RULE** (the segment's far endpoint is inside it: a road is allowed
  to reach where it is going, which is the whole difference between the airport
  causeway and a highway cutting a town's corner), and ownership
  (`owner`/`_govOwner`/`district` vs the region's `owner`/`_govOwner`/`biome` —
  govcomplex and towngen already stamp both sides). Anything else may enter only
  the **24 m DOCK BAND**, which is derived, not tasted: one full deck width of
  the widest road here, the deepest a road can sit inside a place and still make
  a continuous T-junction with a perimeter road. Measured over the shipped world
  NO segment lands between 24 m and 48 m — the distribution is bimodal.
  An order-98 pass clamps any record that still violates it, so **the law does
  not depend on a builder cooperating**; the record is what traffic, `roadPick`,
  `roadSegmentAt`, `roadCross`, the map and every prop walker read.
  **Keep-outs (`arena.noSpawn`) are audited and warned, never clamped** — a prop
  refused costs nothing, but clamping a road out of a keep-out can strand the
  facility it serves, and that is a bug in the FACILITY'S OWN FOOTPRINT.
  Props: `props.js`'s lamp walk, `detail_kit.js`'s `streetRoads`/`eachKerb`/`free`
  (which buys `utility_lines`, `street_furniture` and `world_grime` for free).
  Ratchet: `CBZ.roadClearanceAudit()` — `violations` pinned at **0**,
  `propsInside` at **15** (it was 120-130; the residue is the airport terminal's
  own barrier hardware and the gov gate bollards, which a "small collider at a
  kerb" heuristic cannot tell from road scatter). `dockedInside` and
  `zoneCrossings` are printed BESIDE them so neither can quietly absorb a real
  violation. Flags `ROAD_CLEARANCE` / `_ENFORCE` / `_PROPS` / `_DOCK`.
  **KNOWN AND NOT FIXED** (`island_airport.js`, outside that wave's territory):
  the airside keep-out is `{minX:A_MINX, maxX:A_MAXX, …}` while the landside
  perimeter road runs at `A_MAXX - 22`, i.e. 22 m INSIDE it for its whole length
  — the file's own comment claims the opposite. `zoneCrossings` is pinned at
  **1** for exactly that road and drops to 0 the day the rect stops at the kerb.
- **A JUNCTION IS DERIVED, NEVER AUTHORED** — `CBZ.roadJunctions(world)` /
  `CBZ.roadCornerRadius(a, b, footway)` / `CBZ.roadJunctionAt(x,z)` in
  `city/roadrules.js`, drawn by `city/props.js` under `JUNCTION_DETAIL`. OWNER:
  "roads meet at intersections right now feeling very unintentional." The
  mainland grid kept a private `city.intersections` array keyed on its own
  `xLines`/`zLines` indices, so **every crossing outside the 7x7 grid — every
  town street, causeway, minicity link and govcomplex spur — was invisible to
  the whole game.** A junction is not a thing to author: it is what you get when
  a vertical and a horizontal record in `city.roads` overlap, and both facts
  were already there. **The kerb-return radius is solved, not tasted**:
  AASHTO's design-vehicle ladder read off the road's own `lanesPerDir`
  (7.5 m car / +3.6 m a lane), MINUS the parking-and-clear zone the road
  already declares (`w/2 - lanes*laneW` — NACTO's effective-radius rule),
  CAPPED by the footway `city.lots` actually leaves (the arc bites
  `R*(1-cos45)` diagonally into the corner, so a 2 m footway pins the mainland
  at 4.78 m and a town at the 3 m floor). No number is typed per place.
  What props.js draws from it: corner asphalt + kerb return, a resurfacing
  patch **only where a builder's paint really does run through the box**,
  and stop bars/crosswalks **only on legs that have none** — it scans the
  existing `userData.roadPaint` meshes and lets the world say what it is
  missing, rather than double-drawing over `world.js`'s zebras. A T-junction's
  two far corners get no return (a corner needs two legs), and the straight
  kerbs a return replaces are SHORTENED to the tangent point rather than left
  standing in the new carriageway (`JUNCTION_CURB_TRIM`, separately revertible
  because it is the one part keyed to another file's geometry). Budget: **3
  draw calls for every junction in the world.** Ratchet: `CBZ.streetAudit()`.
- **A LUMINAIRE IS A POLE, AN ARM AND A HEAD ON THE ARM'S TIP** —
  `CBZ.lampMast({poleH, reach, rise, poleR})` in `city/props.js`. OWNER:
  "lightposts all suck, don't connect." props.js rotated its mast arm about
  **Z**, which lays a Y-axis cylinder along the fixture's local X — across the
  pole — while the head was offset along local +Z, so the luminaire floated
  1.45 m from the end of an arm pointing somewhere else. towngen.js had no arm
  at all: a bare 4.6 m cylinder with a cube on top, over the PAVEMENT, with no
  collider. The character was not the bug; **two constants describing one
  object were authored independently**. `lampMast` returns the arm's length,
  tilt and centre AND the head/bulb/glow positions from one solve, in a frame
  where local +Z is the carriageway — so yawing by `atan2(faceX, faceZ)` puts
  the head over the ROAD by construction. Three consumers migrated in the same
  change: props.js's street lamps, towngen.js's town lamps (now on real town
  roads, with colliders, joined to the existing `_nightLamps` dusk driver) and
  `world/utility_lines.js`'s cobra mast arms.
- **A WIRE ENDS ON THE HARDWARE IT HANGS FROM** — `ATTACH` +
  `worldAt(pole, …)` in `world/utility_lines.js`, flag `STREET_WIRES_V2`. Same
  disease as the lamp and it is the owner's screenshot: the crossarm was drawn
  from the prototype's numbers and the conductor endpoints were **re-typed** as
  world-axis offsets that knew nothing about the pole's per-instance yaw jitter
  or its lean — 0.022 rad at 8.7 m is 0.19 m against an 0.11 m insulator, so
  the wire hung in the air beside the pin. Every hard point is now declared ONCE
  in the pole's local frame and BOTH the prototype geometry and the wire ends
  are built from it, through the pole's own instance matrix. Consequences that
  fell out: three pins now carry three conductors (it drew three and strung
  two), the comms bundle hangs on its BRACKET instead of through the timber,
  sag goes as the SQUARE of the span with a real ground-clearance clamp,
  **a span whose straight line crosses a building is deleted rather than
  drawn**, and a guy leaves the pole's real surface and lands on a drawn anchor
  rod with a high-vis guard — instead of running off to nothing.
  Ratchet: `CBZ.streetAudit()` → **`wiresDisconnected` and
  `paintThroughJunction` pinned at 0**, with `junctionPaintRaw`, `wireSpans`,
  `poles`, `junctions` and `drawCalls` printed beside them so a "fix" that just
  stops drawing cannot pass. NOT YET MEASURED — whoever runs it first writes
  the numbers in (do not repeat the `propUseAudit` mistake of pinning a guess).
- **Traffic follows one equation, not a stack of thresholds** —
  `CBZ.cityTrafficIDM(v, v0, s, dv, car)` in `city/vehicles.js`, the
  Intelligent Driver Model (Treiber/Hennecke/Helbing). Ambient speed used to be
  a pile of independent caps — "if the gap is under X target the leader's speed
  × 0.85", "if red, target distance × 1.25" — and threshold rules do NOTHING
  until they trip and then act at full strength, which is why our traffic
  coasted, braked in unison and concertina'd. IDM's braking term is
  **continuous** (always slightly on, growing as the square of how far inside
  your desired gap you are), so queues compress and release smoothly and
  stop-and-go waves damp instead of amplifying. It is also **collision-free by
  construction**. **EVERY HAZARD IS A LEADER**: a red light is a stationary car
  on the stop line, a pedestrian in the lane is a stationary car where they
  stand — one equation applied three times, `Math.min` across them, replacing
  three unrelated heuristics. Integration is **ballistic** (`v' = v + a·dt`,
  then advance by the AVERAGE of old and new speed) — not a nicety: naive Euler
  under-integrates every braking step and the jitter worsens as frame rate
  drops. Personality (`driver.aggr`, `reckless`) bends `T` and `a`, so a maniac
  runs a 0.5 s headway and a cautious driver 1.8 s. Flag `TRAFFIC_IDM`. There
  is also a **junction deadlock valve** — a car stopped inside an intersection
  for 6 s is granted right of way and forced to move; it is the one traffic
  failure class no shipped game has published a fix for, and it can only ever
  unstick.
- **An airfield has its own traffic** — `src/city/airside.js`. The other half of
  the runway fix: roadrules.js CLOSES the airfield to ambient city traffic, and
  this gives it the traffic it should have had instead — pushback tugs, baggage
  trains, catering lifts, fuel bowsers and a follow-me car on real service loops,
  plus the landside kerb, which IS ordinary traffic and should be busy. Every
  vehicle registers through `CBZ.cityRegisterVehicle`, so they are enterable,
  drivable and damageable like anything else — **never scenery** (owner law: no
  dumb props; stealing a baggage tug on a live apron works). AIRCRAFT OUTRANK
  GROUND VEHICLES: a service vehicle holds short if anything is moving on its
  next waypoint, and that one behaviour is most of what makes an airport read as
  an airport. Ratchet: `CBZ.airsideAudit().onRunway`, pinned at **0**.
- **WHAT A HELICOPTER IS** — `CBZ.heliSpec(role)` / `heliOrbitRadius(v,bank)` /
  `heliOrbitBank(v,R)` / `heliBeamRadius(agl)` in `src/city/aircraft.js`. OWNER:
  "helicopters should have more than one officer in them and they should move
  around at correct speed and height." There were THREE unrelated flight models
  and none of them was a helicopter: the gunship at **26 m / 85 ft** on a **22 m
  orbit**, Air-1 at 38 m AGL on an orbit radius of `18 − 1.5·stars` (13.5 m at
  3★ — a **9-second lap**, i.e. a hover over your head), and airtraffic.js's
  fleet, which was the only honest set. **THE ORBIT RADIUS IS NOT A CONSTANT**:
  a coordinated turn holds `tan(bank) = v²/(gR)`, so authoring a radius AND a
  speed AND a bank separately is exactly how all three drifted into geometry no
  aircraft could fly. `heliOrbitBank` is airtraffic.js's own formula promoted to
  the shared one, and every orbit is now flown at a 20° bank. Air support has
  TWO postures, which is also what a real ship does: **SEARCH** (150 m AGL,
  190 m orbit, 26 m/s) and **ENGAGED** (85 m, 112 m, 20 m/s) — it descends when
  `canEngage`/`chopperEngage` says it has a shot, which is the gate the guns
  already used, so the descent is not a second threat model. **Where realism is
  traded for playability, it is traded HERE and named**: the game's longest gun
  is the sniper at 240 m and the RPG (the sanctioned anti-air answer, and what
  the two-blast rotorcraft rule is written for) reaches 200 m, so a textbook
  1000 ft orbit would be unshootable. `gunRange` is therefore a **fairness
  invariant, not a gun stat** — the gunship's 220 m keeps its engaged slant
  (187 m) inside the player's RPG. Flags: `AIR_HELI_REALISM` (all of it, one
  line back to the old numbers) · `POLICE_HELI_ALTITUDE` still PINS Air-1's AGL
  if set. Ratchet: **`CBZ.heliAudit()`** → `{helis, crewed, uncrewed, meanAGL,
  meanSpeed, orbitR, belowRoofline}`; **`uncrewed` and `belowRoofline` may only
  go DOWN**. NOT YET PINNED — the gate reports it and does not fail; whoever
  runs it first writes the number (do not repeat the `propUseAudit` mistake).
  Every fleet owner pushes ONE census function into `CBZ.heliFleet`, so a new
  rotorcraft costs no edit to the audit.
- **AN AIRCRAFT IS CREWED BY PEOPLE** — `police.js` `CHOP_SEATS` /
  `aircraft.js` `GUNSHIP_SEATS`. Air-1 carried ONE officer whose rig was
  `visible=false` at the home pad; the gunship carried one soldier plus two
  decorative torso boxes only the studio photographer ever saw. Both now carry a
  real crew — **Pilot · Tactical Flight Officer · Door Gunner** (police, the
  gunner only at 4★) and **Pilot · Weapons Systems Officer · Door Gunner**
  (military) — and **no bespoke occupant system was written**: the seats are
  npclife ANCHORS and the bodies go in through `CBZ.npcLife.attach`, the same
  call the airliner cabin uses, so `syncAttached` holds them, the V2 chair pose
  solves feet-on-the-deck from the declared cushion, `CHAR_SEATED_HITTABLE`
  makes them shootable through the glass, and `aim_dossier`'s `Lv.N` pill reads
  the truthful `job` string with no HUD edit. **Every seat has a CONSEQUENCE**:
  kill the pilot and the airframe enters the fall arc, kill the TFO/WSO and the
  searchlight stops tracking, kill the gunner and the gun stops — that is the
  whole reason they are bodies and not silhouettes. A model authored at a scale
  (the island gunship is 1.45) gets ONE inverse-scaled `crew` node so anchors
  stay in real metres. **A dead crewman is never replaced in flight** and the
  teardown detaches every body before the airframe's disposer runs — a rig still
  parented to a wreck would have its geometry freed. Flags: `AIR_HELI_CREW` ·
  `POLICE_HELI_CREW`.
- **A BODY LEAVES A SEAT ONLY BY DETACHING** — `CBZ.cityUnseat(actor, opts)` in
  `city/island_airport.js`. `syncAttached` re-asserts an attached body's seat
  transform every frame, so a seated body cannot be nudged, shoved or teleported
  out of a chair; the three-step dance (drop `_seatHold`, detach at world pose,
  clear the seat's back-pointer) was written inline inside `citySpillCabin` and
  is exactly what a HIJACK needs — minus the kill. Consumers: `citySpillCabin`,
  `cityVacateFlightDeck`, and the two helicopter crew teardowns.
  **`CBZ.cityVacateFlightDeck(rec)` is the un-killed twin of `citySpillCabin`**
  and it fixes a defect that was live for the airliner's whole life: taking the
  controls never displaced the crew, so the captain sat in his chair for the
  entire stolen flight. It is called from ONE place, `spawnFlyableFromProp` —
  every route to the controls passes through there (door arc, flag-off instant
  path, `cityAirborneStart`), so no future path can quietly skip it. A hijacked
  pilot is thrown out ALIVE and panicked: **that is not a death and must never
  reach the killfeed.** Companion: `CBZ.cityCabinAboard(rec)` /
  `cityCabinFlightDeck(rec)` — the ONE answer to "is the player already inside
  this aircraft", which `aircraft_doors.js` consults so a hijack fired from the
  flight deck runs a short deck beat instead of marching the player back OUT
  through the fuselage and replaying the airstairs (owner's bug, verbatim: "the
  door and steps open as if I'm hijacking from outside the plane — but i already
  boarded"). Flag: `AIRCRAFT_DOOR_SKIP_WHEN_ABOARD`.
- **Seats of power stand on their own land** — `src/city/govcomplex.js`. OWNER:
  "add gov buildings but NOT inside cities, because when you do that it overlaps
  — like the pentagon and white house... those type of massive buildings that
  have their own land plot." Nine complexes (Capitol · Executive Mansion ·
  Governor's Residence · Bureau HQ · Defence HQ · City Hall · and the PRIVATE
  estates: a mob compound, a cartel finca, a tech-money cliff house) each claim
  a rectangle of EMPTY land, tested against every existing region and lot before
  it is taken, register their own region + keep-out, and push a real access road
  so you can drive there. They staff themselves through `power.js` — this file
  authors no guards — and bind to the officeholders `officialdom.js` already
  models (`polity.list(kind)`, stamped as `p._sid`, which is the field
  `officialdom.seatOf` matches on) rather than inventing duplicate people, so
  PETITION / GREASE / ENDORSE / LEAN ON light up at these doors for free and an
  election moves who is inside. **The next standalone-complex-on-its-own-land
  feature adds a `COMPLEXES` row — never a second placer.** Ratchet:
  `CBZ.govComplexAudit()`, `overlaps` and `roadless` pinned at **0**;
  `urbanAdjacent` is the ONE declared exception (City Hall, which `edgeOfCity`
  lets touch the grid because a real city hall does) and is reported separately
  so it can never quietly absorb an accidental collision.
- **A seated body holds its seat** — `syncAttached` in `src/entities/npclife.js`.
  `attach()` wrote the anchor transform ONCE and the per-frame tick re-asserted
  `speed`/`state`/`char.sitting` but never the TRANSFORM. An attached actor is
  still a full member of `CBZ.cityPeds`, and **41 files iterate that list and
  write `group.rotation.y` with no `_npcAttached` guard** (peds.js is the only
  one that guards) — world-space bearings landing on a group parented to a
  moving aircraft, so the body settled at `worldBearing - planeHeading`, aimed
  at a lot across the map. That is the owner's "plane passengers sit sideways",
  and it was never about planes. The re-assert lives in the SHARED file, so cars,
  taxis and every future moving seat are fixed by the same three writes. Skipped
  during a live propuse arc; `actor._seatHold = false` opts out.
- **A venue declares its JOBS, not its bodies** — `CBZ.cityStaffVenue(id,
  {stations, census})` / `CBZ.cityStaffPost(spec)` in `city/citystaff.js`.
  OWNER: "roles can be greatly expanded" — and the census that followed found
  the buildings without the people: `airside.js` was 1,471 lines of pushback
  tugs, baggage trains and fuel bowsers with **every one driverless**, the
  marina had no captain and its work anchor matched no job in `CITY_JOBS`, the
  boatyard's "Talk to the broker" pointed at nobody, the beach had a lifeguard
  chair you can stand on with nobody in it, and every casino but the flagship
  was felt tables and an empty cashier cage. A venue with buildings and no
  people is a stage set.
  The block is DATA AT BUILD TIME, BODY ON DEMAND: a station is declared once,
  and a rig is minted only inside `near` (170 m) and given back past `far`
  (320 m). **That 170 is arithmetic, not taste** — peds.js hides rigs past 95 m
  and `npcTransitionSafe` auto-allows past 150 m, so a body minted at 170 m is
  invisible AND unwatchable by construction: nobody ever sees a worker appear.
  Seams: `adopt` (bind to a body the world already runs — the boatyard casts
  nobody, it adopts the marina's broker), `attach` (caller does its own
  `npcLife.attach`), `at` (a station that MOVES — an airside tug), `release`.
  Killed staff are not replaced; swept staff are. Cap 40, flag `VENUE_STAFF`.
  It also registers 27 venue trades into `CBZ.cityJobs` on the first tick, so a
  deckhand or croupier has a shift, a wage and a workplace instead of being
  label #121 the job table never heard of. Ratchet: `CBZ.venueStaffAudit()`,
  `unstaffed` pinned at **0**.
- **Fishing** — `city/fishing.js`. `CBZ.fishSpotRegister` SELF-VALIDATES against
  `CBZ.cityWaterAt`: a spot that lies about standing on water is refused and
  counted (`fishAudit().refused`, pinned at 0). It owns **no fish table** —
  catches come from `CBZ.WILDLIFE_SPECIES` and pay in the same "Fresh Fish" /
  "Fish Fillet" items `wildlife.js`'s `skin()` already grants, so a species
  added to `aquatic.js` is catchable with no edit here. Before this, the world
  had a "Fisherman" title nobody wore and a mackerel was harvested by SHOOTING
  it through the hunting pipeline.
- **Rank unlocks a VERB** — `CBZ.rankCan(actor, org, verb)` / `rankHolder` /
  `rankKnows` / `rankAudit` in `city/factions.js`. CLAUDE.md's law was already
  "every rung must unlock a verb, not just a bigger number"; police wrote ZERO
  ranks while `level.js` held the names, and the military ladder was 8 rungs of
  pure display whose top rung was **statistically unreachable** (rolled 0.3%
  PER BODY, so a seed could simply never contain a General — rank is a ROSTER
  SLOT now). Adoption is `grants:["roadblock"]` on a rung plus `rankField:
  "copRank"` once per org, and **`rankField` is what keeps it a migration**: the
  rank stays in the field the world already writes and factions.js stores
  nothing. THE TRAP TO KNOW: `rankCan` returns FALSE for an undeclared org, so a
  naive `if (!rankCan(...)) return` slams every gate shut when the flag is off —
  that is why `rankKnows` exists and why every gate uses it. The headline verb
  is the Chief's `standdown`: arrest-first was a config flag with no author, and
  is now a standing order somebody HOLDS — kill the Chief and the department
  stops trying to take you in for 60-150 s. Deletions matter more than additions
  here: `MIL_NAME`, `roleAudit`'s duplicate table and `hud.js`'s `MEMB_LADDER`
  are gone — that last one was the FOURTH copy of the gang order and it
  DISAGREED with `gangs.js`, so the progress bar filled at a different rate than
  the promotion that actually fired. Ratchet: `factionAudit` 19 -> **17**.
- **Power / protection** — `src/city/power.js`. ONE declaration,
  `CBZ.powerPrincipal(actor, {tier, org, role, seat, family})`, turns any actor
  the world already runs into a PRINCIPAL: a ring of guards, the `Lv.N Role`
  pill, a reaction rule, a floor ladder and a death response. **`CBZ.powerKit(tier)`
  IS HOW YOU ADOPT IT** — it writes the whole bundle (detail size, weapons off
  protection.js's GEAR, armour, standoff, challenge/warn/shove/draw radii,
  escalation rate, stars-on-death, floors owned, family size) from ONE number,
  through power laws solved against vips.js's five authored CAST rows. **No role
  name appears in the table, and adding a Mayor/Don/CEO must never mean adding a
  row.** `CBZ.powerReactionTo(actor)` → `welcome|watch|challenge|hostile` is the
  ONE answer to "how does this person's security treat me", computed from the
  GAP (your rank in HIS org via `factions.tier`, allegiance via
  `factions.reactionTo`, the level gap, armed, wanted, how far up his building
  you are) — never a hardcoded list. **A tier-0 nobody is not a principal**, so
  the ordinary interaction card is byte-identical; walk up to a cartel head and
  his detail answers instead. That difference IS the owner's ask. The intercept
  is three `I.register` calls on the existing `ped:civ` layer, so the detail's
  verb REPLACES the principal's by slot exclusivity and no new popup exists. The
  floor ladder is `cityOccupyBuilding` with occupy.js's OWN preset re-stamped by
  tier — power.js authors no interior, no stairs, no alarm. It is the THIRD
  consumer of police.js's `_post` (and finding that third consumer exposed a
  live bug: a citywide roadblock standing down used to march EVERY posted
  officer in the world to its cruiser — `RB.cops.indexOf(c) >= 0` now gates it).
  Ratchet: `CBZ.powerAudit().legacyGuardSites`, baseline **9**.
- **Stories are a composition, not a script** — `city/origins.js`. The three
  hand-written openings were ~120 lines of bespoke scene code EACH, so a fourth
  cost a fourth 120 lines and a random one was impossible. Underneath they only
  differ along SIX AXES — **who / where / purse / arms / heat / verb** — so the
  axes are now the data and a story is a frozen roll of them (`PRESETS`).
  `CBZ.cityOriginRoll()` rolls a fresh one with three coherence rules (an
  address the person would actually have, hunted people are armed, the
  objective must be answerable from the purse). Nine stories ship; a tenth is a
  ROW. Same binding rule as `contracts.js` and it is binding: **the generator
  picks the verb, the WORLD supplies the specifics** — a `where` FINDS a lot
  the city built, a `heat` flips `huntPlayer` on peds the sim was already
  running (which lights every threat surface free via `cityTargetsPlayer`), a
  `verb` runs through `core/mission.js` and builds no HUD of its own.
  `CBZ.cityAirborneStart(rec, {alt,speed,heading})` in `playeraircraft.js` is
  the PILOT opening — spawnFlyableFromProp plus the four state writes that turn
  a parked airframe into a cruising one, kept in the file that owns the
  heading/velocity convention. The plane picker reads the LIVE registry
  (`CBZ.cityOriginPlanes()` off `cityMilitaryVehicles`), so **every future
  airframe appears with no edit** — and it is DEFERRED, because that registry
  is populated by an `onUpdate(55.1)` pass that has not run when a mode reset
  applies the origin. Ratchet: `CBZ.cityOriginAudit()`, `bespoke` pinned at
  **3** and may only go DOWN — the seventh story must not add a fourth.

- **A VENUE IS A BUILDING WITH ONE NUMBER** — `CBZ.CONFIG.ARENA_TIERS` +
  `CBZ.arenaAudit()` in `city/arena_venue.js` / `city/arena_fights.js`. OWNER
  (2026-07-27): "STADIUM HAS TWO LEVELS OF ROWS SO IT FEELS SUPER SUPER SHORT —
  IT SHOULD HAVE 20 OF THE CURRENT LEVELS IT HAS 2 OF, AND BE MUCH TALLER." The
  bowl's row count, rake, tread, cross-aisle spacing, vomitory height, rail
  placement, roof/gantry height and seat-colour banding ALL derive from
  `ARENA_TIERS` — set it to 2 and the old silhouette comes back. **The rake is
  not tuned, it is solved**: stadium design's C-VALUE sightline equation
  `C = D(R+N)/(D+T) − R` gives the tread as a CEILING (`T_max = D(N−C)/(R+C)`),
  and the bowl runs an ergonomic tread ramp capped by it, so no row can ever be
  built that cannot see the floor (`arenaAudit().minCValue`, code floor 0.06,
  target 0.12). The riser is pinned at 0.42 **because physics.js's `STEP_UP` is
  0.45** — a real bowl steepens by growing the riser and this one cannot, so the
  tread carries the steepening instead. That constraint is also why **seats are
  not colliders**: a solid seat bank each side of a 0.86 m tread leaves a 0.26 m
  strip against a 0.55-radius player capsule, so the rows stay climbable and what
  gets colliders is the STRUCTURE (bowl front, every cross-aisle rail, top rail,
  back wall — all of which were `put()` decoration with no `solid()` at all).
  Ratchets: `misposed` and `shrugRoles` pinned at **0**.
- **A CROWD IS A DIAL, NOT A CONSTANT** — `venue.crowdFill(f, snap)`. OWNER: "IT
  SHOULD BE FULL WHEN ACTIVE AND NEARLY EMPTY WHEN NOT... IT'S LIKE 10 PERCENT
  FULL." Occupancy used to be decided ONCE at world build by a position hash, so
  the bowl was frozen at one fill forever — never a crowd, never abandoned. The
  instanced proxy is now built for EVERY seat, ORDERED by a deterministic
  KEENNESS rank (best seats first, how a real house fills), and occupancy is
  `mesh.count = fill × total` — an integer write, no matrices rebuilt, **three
  draw calls at any fill**. The split IS the performance answer: distant
  spectators are instanced and near ones are ~28 real rigs (a full rig is ~16
  draw calls and is the only thing that actually costs GPU here).
- **AN ACTIVITY IS NOT AN IDENTITY** — `CBZ.citySetAttending(a, what, venue)` /
  `cityAttending` / `cityAttendingLine` in `city/level.js`. OWNER: "'FIGHT FAN'
  AS ROLE OF NPCS — THAT'S NOT AN NPC ROLE." Same bug class as npclife's
  "passenger": the person in that seat is a cashier who came to a fight tonight.
  `job` is the field that renders the pill, so the activity word comes OFF it —
  "fight fan"/"race fan"/"spectator"/"fan" are now `NO_ROLE`, and `ARCH_TITLE`'s
  `fan` row is deleted — the caster deals a real trade, and what they are DOING
  goes on the separate attending field. Adoption is one call that REPLACES the
  `overrides:{job:"fight fan"}` the venue was writing anyway. Consumers:
  arena spectators, arena staff, speedway spectators/concourse. Ratchet:
  `roleAudit().activityTitles`, pinned at **0**.
- **FREEZE OR BOLT IS ONE DECISION** — `CBZ.cityScare(actor, threat, opts)` →
  `"bolt"|"freeze"|"hold"` in `city/peds.js`. OWNER: "right now NPCs can't stand
  up and run away. Yes, with a gun pointed some should [put] hands up, but some
  should stand up and run away." Not a coin flip: `sizeup.js`'s `citySizeUp`
  already answers "does this person dare", DISTANCE decides freeze-vs-run
  (nobody outruns a gun at four metres), and **panic is contagious** —
  `CBZ.cityPanicRaise`/`cityPanicAt` is a decaying spatial field that every bolt
  feeds and every next decision reads, which is what makes a stand empty as a
  WAVE instead of as N independent dice. The choice is drawn from the person's
  own stable `roleHash`, so the same person is always the one who runs; a runner
  is a character trait, not a die re-rolled every three seconds. **It is also
  the one place a body gets OUT of a seat** — `syncAttached` re-asserts an
  attached body's transform every frame, so detaching via `CBZ.cityUnseat` is
  the only exit and nothing here re-implements it. Consumers migrated in the
  same change: `sizeup.js`'s `citySizeUpFold` (which WAS this branch, copied),
  `peds.js`'s `gunpointSweep` (every held body anywhere — cars, cabins, gate
  lounges, desks), and the arena crowd.
- **NEVER LET THE PLAYER SEE A SPAWN** — `CBZ.npcTransitionSafe` (config.js) is
  the shared contract and it is a padded-screen PROJECTION, strictly stronger
  than a yaw cone. OWNER: "NPCs spawn right in front of the player... It should
  be like buildings" — the world is already there and you merely arrive at it.
  Every TELEPORT path in `city/crowd.js` was already guarded; **PROMOTION was
  not**, and in the shipping `STANDARD_ACTORS_ONLY` mode promotion is the moment
  a body becomes visible at all, so the "fill every free slot in one cheap pass"
  loop could hand a rig to a row three metres in front of the camera. Refused
  rows retry next tick — an empty patch of pavement for a fraction of a second
  is the correct trade. `npclife`'s `attach()` deliberately forces an anchored
  rig VISIBLE (right for a plane, wrong for a seat six metres away), so venues
  re-arm peds.js's own `_spawnHidden` latch in their `configure`. Ratchets:
  `CBZ.cityCrowdSpawnAudit().spawnsInView` and `arenaAudit().spawnsInView`, both
  pinned at **0**. Flag `CROWD_PROMOTE_HIDE`.

- **THE MAP SPEAKS IN ICONS** — `CBZ.mapIcon` in `src/systems/fullmap.js`.
  OWNER (2026-07-27, verbatim): "AND THE MAP SHOWS WAY WAY TOO MUCH TEXT. IT
  SHOULD SHOW ICONS, AND TEXT WHEN AN ICON IS HOVERED OVER." The map printed a
  NAME over every point of interest at the zoom `M` drops you at, so the
  geography drowned under shop names. **A place's KIND is now a pictogram and
  its NAME is one hover (or one tap) away.** `CBZ.mapIcon` is the ONE
  kind→symbol table: `{c colour, r RANK, n human name, g glyph}`, and RANK does
  three jobs so no second table is ever needed — it is the zoom tier
  (`>= mapIcon.LANDMARK` draws at every city zoom, below it only zoomed in), the
  declutter arbitration (in a collision the higher rank survives) and the label
  priority. `POI_KINDS` is now DERIVED from it, so a colour can never disagree
  with its icon. **Adding a trade is a ROW.** Adoption is one line and
  degrade-safe (`CBZ.mapIcon ? MI.draw(...) : <old diamond>`, which is exactly
  what `city/hud.js`'s radar does). Consumers migrated in the same change: the
  full-map POI layer, settlements, gang HQs + district crests, climb marks,
  leased ad boards, the mission marker, the prison map's hatches/gate, the
  LEGEND (it renders the real pictogram via `mapIcon.dataURL`, cached) and the
  corner radar. Glyph craft rules are in a comment above the table and are
  binding: silhouette over detail, one idea per glyph, **never colour alone**
  (that rule is why `town` is a multi-roof cluster and not the house `home`
  already owns), consistent optical weight, optically centred on a 20×20 box.
  **Every permanent word on the chart goes through ONE function, `mapLabel`** —
  it measures, boxes, collision-tests and COUNTS. A label that skips it is
  invisible to the ratchet, which is the whole reason there is only one.
  What deliberately KEEPS permanent text, and why: region/settlement/city names
  (geography — a place name you must hover to discover is a quiz, not a map),
  your own waypoint and the active objective (you already chose them), and
  `SEALED` on the bridge (a live obstruction, not a place). Everything else —
  every shop, crew turf tag, `LAST SEEN`, `HATCH` — went silent.
  Ratchet: **`CBZ.mapAudit()`** → `{icons, labels, overlaps, hoverable, merged,
  skipped, furniture, plateLabels, kinds, mode, zoom}`. **`labels` and
  `overlaps` may only ever go DOWN**; `icons`/`hoverable` are printed beside
  them so a "fix" that just draws nothing cannot pass. Flag `MAP_ICONS_V2`
  (default true) is a one-line revert to the all-text map, and the legacy path
  is kept routed through `mapLabel` so the before-state stays measurable.
  NOT YET PINNED — measure and write the number in (do not repeat the
  `propUseAudit` mistake of pinning a guess).

  HONEST STATUS (2026-07-26, after the predators wave): `bodyBite` and the gore
  medium have real adoption (3 consumers / every existing gore caller).
  `predatorHunt`/`predatorSeize` went from ONE consumer to **eight** — every
  migration named in the previous status is done: `games/ocean.js`'s separate
  shark FSM, `dogs.js`'s aggro brain, `wildlife.js`'s land-predator charge and
  herd charge, and both snake paths, plus `wildlife_shark.js` finally declaring
  the adoption it always had. `CBZ.predatorAudit()` reads `{legacy: 0, adopted: 8}`
  and **may only ever go DOWN** — if you add a site id you migrate it in the same
  change. `ragdollPin` went from one consumer to TWO (the seize fling, and a
  held animal corpse now rides the quad solver's pin instead of a rigid
  position write) — still thin, no longer alone.

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

## THE 2026-07-27 EVENING WAVE — seven territories, one merge

Seven opus builders in parallel, disjoint file territories, orchestrator merged
and patched the seams. Every ratchet below says NOT YET PINNED because the wave
shipped without a gate run (owner's call: "no testing just building") — whoever
runs each audit first writes the number in; do not pin a guess.

- **THE WORLD IS V4-SCALE AND BIOME EDGES ARE REAL CURVES** — `SPREAD_V4` in
  `world/layout.js` (×1.60 of V3 with seven axes PINNED, each pin justified
  inline: `snow.dx` protects the Mercy lane, `speedway.dx` moves the desert east
  instead of the live build zone) + **`CBZ.worldFoot(id)` / `worldFootScale(id)`,
  the footprint registry that killed the copy-rect disease** — terrain_overhaul's
  `snowSector` and biome_farmland's `DESERT_MINZ` now ASK the owning biome
  instead of re-typing its rect (old literal kept as degrade fallback; flag-off
  is byte-identical, verified per biome). FLAT 7820×4810 → **9570×6109**; `W_ROOF`
  13500 → 15500 (union 13896 — the roof still catches runaways); `PLATE_SEG` now
  DERIVES from a 38 m cell target (320 on a V3 world byte-identical, 368 on V4 —
  cells got FINER, not coarser); sea span derives from FLAT (`CBZ.WORLD_SEA_SPAN`
  25000). **Organic edges** (`BIOME_ORGANIC_EDGES`, worldmap.js): OUTSIDE a rect
  the already-existing blend warp claims land to its own reach — that is where
  the de-squaring lives; INSIDE a rect an edge may hand a point to a neighbouring
  biome that genuinely dominates but NEVER to nothing — a hole in an authored
  painted floor is the one path to a false `mtnOutSnow`. fullmap's `coastPath`
  bisects the real 0.42 contour now instead of drawing a cosmetic wobble. Desert:
  the little gray rocks are GONE (`DESERT_ROCK_SCATTER` default false — the dead
  loop still draws its rng so no other scatter re-deals) and dunes run an
  ENVELOPE (`DESERT_DUNES_V3`): 4-16u across most of the erg, 2-3 isolated
  45-55u draa per basin on 850-1410 m fields with 10° drivable flanks, corridor
  gates keep towns and the highway flat. TWO STALE-LITERAL BUGS found by
  measuring: the Saltlands causeway had dangled 280u short of its own biome
  since stage 3, and the Coyle causeway stopped 112u short of the desert highway
  — both ends now DERIVE (`CBZ.DESERT_HWY_Z`). The highwaynet eight were
  re-derived for V4 (before→after arithmetic in highwaynet.js). Ratchet:
  `CBZ.worldScaleAudit()`.
- **A VENUE HAS A SITE, AND THE SITE IS A KIT** — `CBZ.venueSite`
  (speedway_structures.js): fence · gatehouse · monument · lampRow · bays ·
  census; a whole fence of any length is 2 draw calls. Three consumers including
  a real migration (the paddock's private fenceRun is DELETED). Ironjaw: the
  "island" was never an island — the coastline is 222u away — and the Mercy
  Causeway's east kerb ends at exactly `CW_X0`; the two decks had been
  butt-jointed with no road record for the venue's whole life. It now has a real
  road + T-junction (kerb returns, stop bars and wires arrive free via the
  roadrules/utility passes), gatehouse + arch, 828 m perimeter, 16-bay car park,
  kiosks, service yard, its first-ever keep-outs, and 6 staffed posts through
  `cityStaffVenue` (ticket sellers finally stand AT the booths that always
  existed). Speedway: **the public car park had been empty its whole life** —
  `cityMakeCar` ran inside the landmass builder before `city.arena` existed and
  every call threw into a swallowing catch; the fill is deferred now, and
  `venueSite.bays` feeds BOTH the paint and the cars so they can never disagree
  again. Flags `ARENA_SITE` / `SPEEDWAY_SITE`. Ratchet: `CBZ.venueSiteAudit()`.
- **EVERY JOB ANSWERS TO A VERB** — `city/roleverbs.js`: `ROLE_VERBS` +
  `OBJECT_VERBS`, two data tables consumed by TWO registrations total — a new
  trade or prop is a ROW (the interact.js `VERB`-table shape, deliberately).
  `CBZ.cityPedJob/cityPedJobClass` (level.js) is the promoted job accessor;
  shops.js consumes it with its private pair as fallback. Every effect runs a
  sanctioned primitive (spend/addCash/hp/hunger/econ/engineHp/respect/mission)
  — **a verb that writes a field nothing reads is a stat fiction and BANNED.**
  The game finally has a street heal (medics; paramedics discount emergencies
  under 35 hp), day labor on 17 worker trades (once per worker per day, off the
  trade's own declared shift), produce/catch purchases that register real items
  the way wildlife pelts do, courier delivery missions bound to lots the city
  built (the world supplies the destination or there is no offer), and a dealer
  you can Score from — priced ×1.15 street so flipping LOSES by construction.
  Class floors make `withoutVerb` STRUCTURALLY 0 across all ~60 jobs. Objects:
  hydrant crack (fires the existing geyser), meter jimmy (the same position
  hash as ramming, so the two payouts agree), bus-stop routes (names real
  regions), cart rummage (the existing bounded search + it is theft and files
  as such). `objectVerbAudit`'s remainder is REPORTED, deliberately not pinned
  0 — lamp/tree/planter/sign have no honest verb and a fake one is worse.
  Flags `ROLE_VERBS` / `OBJECT_VERBS`. Ratchets: `CBZ.roleVerbAudit()` /
  `CBZ.objectVerbAudit()`.
- **AN ANIMAL DIES LIKE A BODY, NOT A POSE** — `systems/quadruped_ragdoll.js`
  + **`CBZ.wildlifeDeathPhysics` (wildlife.js), the ONE death entry**: verlet
  quadruped ragdoll when the solver takes the body, the shared rigid tumble
  (`CBZ.wildlifeDeathTumble`) when it won't, NEVER a pose snap — "head pointed
  at the sky" was `rotation.z` (the model-local PITCH axis) snapped to ~1.3 rad
  in dogs.js and the beast pit; both are dead, with the snap kept only as the
  flag-off degrade. Rig discovery is GEOMETRIC (legs = taller-than-wide
  ground-touchers, head = far-forward-and-up, spine rides what is left) — NO
  SPECIES TABLE; the named refusals (swim/segs/aquatic/snake) are rig facts.
  Four bugs only math found (pure-node harness against the vendored r128):
  a planar 4-point torso can never rest on edge; the roll couple was about the
  BULLET's axis so flank shots somersaulted deer back onto their feet; the
  menace gauge starved NPC hunts (correct for the player, now player-scoped —
  existing callers byte-identical); an alarm re-raised twice a second pinned
  herds in permanent flight. Food chain (`WILDLIFE_FOODCHAIN`): prey is
  ARITHMETIC — medium match, mass ≤1.35×, danger below the hunter's, which is
  why a wolf takes an elk and never a grizzly with no name typed; kill → feed
  20-40 s → satiation 3-5 min; man-eaters need scale ≥0.85, danger ≥0.6, night
  weighting, a lone victim, global cap 2; killfeed is proximity-gated at 70u so
  a distant wolf-vs-deer never spams the corner. Cars hit animals
  (`WILDLIFE_CAR_IMPACT`): one loop in `runOver`, lethal = `pedLethal·√mass`,
  damage ∝ v², camera-gated to 240u. predator.js's `killVictim` animal branch
  now routes the REAL wildlife death — the frozen-corpse bug (undefined `skinT`
  → NaN countdown → immortal corpse) is fixed. Ratchet:
  `CBZ.wildlifeDeathAudit()` — `legacyPoseDeaths` and `frozenCorpses` are
  structurally 0.
- **VEHICLES WEAR THE ONE GLASS** — carfx.js's `glass` role delegates to
  `CBZ.glass()` (`VEHICLE_GLASS_V2`). Every canopy and windscreen in the game —
  airliner, fighters, bombers, helicopters, GA, cars, boats — was ONE shared
  MeshStandard+envMap material (near-black under a Lambert world, the exact
  failure buildings.js documents in its own reflectMats comment) cached under
  the bare string "glass", so per-aircraft tints NEVER reached a pane
  (island_military's vmat didn't even forward its color arg — fixed). Now:
  Lambert + lift, DoubleSide (a camera sits BEHIND a canopy), pool keyed per
  tint, and the callers' long-dead `{emissive, ei}` args live as a per-channel
  FLOOR so night cockpits are neither voids nor lamps. **THE FROST WINDOW IS
  LAW**: crashdeform finds glass by color arithmetic (`b−r>0.045, b<0.4,
  r<0.25`) — a tint outside the window is refused and swapped, and the worst
  live margin is a measured number (`glassAudit().frostMargin`); the airliner's
  old tint cleared by half an 8-bit step and was nudged along with its three
  siblings. Interiors already existed behind almost every pane (pilots, crew,
  car drivers, a yacht saloon) — the material was the only thing defeating
  them; the one true hollow shell (utility heli) got furniture fitted by corner
  arithmetic against the canopy taper. Ratchet: `CBZ.glassAudit()`.
- **SEATS OF POWER HAVE ROOMS BEHIND THE DOOR** — govcomplex §5c
  (`GOV_INTERIORS`): all nine complexes get designed floors that ADOPT
  occupy.js's own ledger (`_occupyProgrammed`/`_occupyAnchors`) so power.js's
  existing cast lands in these rooms — no second cast path, no peds authored
  here. **`world/roombuild.js` is AWAKE**: zero callers → three (furnishHome,
  furnishApartmentFloor, gov `room:*` floors), and waking it took SIX latent
  fixes — the headline: `roomFurnish` never forwarded the host origin, so every
  propuse anchor from a non-origin building would have been filed AT THE WORLD
  ORIGIN. Also: beds headboard-into-the-room, a lounge that produced nothing
  when the door was centred, a world-vs-host keepout compare, uncapped
  deskfarm/storage grids (the Agency's slab asked for ~5,000 boxes on one
  floor), and furniture.js's `propPurposeReset` wrap that never armed — the
  furnishAudit ledger had NEVER reset between builds. Empty floors keep their
  ratio but get five deterministic reads (`INTERIOR_EMPTY_VARIETY` — bare,
  renovation, move-out, after-hours, dark storey); interior strips ramp with
  `nightAmount` through one shared driver, zero new draw calls
  (`INTERIOR_LIGHT_DAY`). Ratchets: `CBZ.interiorAudit()` (`govBare`
  structurally 0) / `CBZ.roomPlanAudit()`.
- **ORDNANCE OBEYS ONE LAW** — `CBZ.ordnanceDropVel` / `CBZ.ordnanceSeek`
  (aircraft.js). OWNER: "bombs should drop straight down and missiles should
  have the same homing as the rpg." A free-fall store keeps 8% of horizontal —
  a DIVE is inherited whole (it points the store down) while a climb is scaled,
  so a zoom release can't toss a bomb upward; guided kits keep 22% because
  `solveGuided` budgets its whole cross-range FROM release velocity. Measured:
  300 m AGL at 105 m/s, downrange 676 m → 54 m, impact 48.9° → 5.2° off
  vertical; carpet stagger untouched (it comes from the aircraft's travel, not
  the bomb's). Missiles: every military launcher (jet, heli, tank main gun,
  JDAM, the modshop channel) acquires via lockon.js's ONE path, read LIVE per
  call so childsafe's wraps hold; playeraircraft's `fired` flag now honors the
  launcher's return (a saturated pool used to eat the shot silently).
  `strategic.js`'s makeB2 is a real lofted flying wing (span:length 2.10 →
  2.495 against the owner's b2code.html reference — planform, sweep and
  thickness laws lifted, 3 draw calls) with a two-seat deck whose windscreen is
  the removed hull piece RE-EMITTED IN GLASS — an aperture that cannot gap; the
  island heavy bomber (a B-52-class airframe, deliberately NOT reshaped into a
  second flying wing) got the deck treatment too (`MIL_BOMBER_DECK`). Three
  latent bugs fixed by reading: bay doors opened UP into the wing, the crew
  hatch swung opposite its own comment, and door geometry called `.translate()`
  on boxGeom's CACHED SHARED geometry — corrupting every other consumer of that
  box size. Flags `BOMBS_DROP_STRAIGHT` / `MIL_MISSILE_HOMING`. Ratchet:
  `CBZ.ordnanceAudit()`.

## THE 2026-07-27 NIGHT WAVE — arrest, explosions, the B-2's face

- **AN ARREST IS A SCENE, AND THE PRISON IS THE JAIL** — `ARREST_ARC` (wanted.js)
  + `PRISON_PIPE` (capture.js). The live arrest path was a same-frame teleport
  into games/jail.js's 3-cell compound that never set `g.busted` (mission
  interrupts had NEVER fired on a real arrest — fixed structurally). Now: hands
  up → REAL zip-tie cuffs + wrists-behind-back IK on the PLAYER (restrain.js's
  rig-agnostic pose, one proxy object = the whole adoption) → perp-walk to a
  marked cruiser (roadPick unseen) → driven ride with a sealed interior cut
  (cinePlay; the cab-ride fade is the named anti-pattern) → booking desk where
  the forfeit is charged ONCE and weapons go to an EVIDENCE LOCKER → the full
  prison mode serves the ONE sentence formula (`CBZ.cityJailSentence`); release
  returns property at the precinct door, escape forfeits the locker and keeps
  the manhunt. RUN from the challenge and the cop TACKLES via predatorSeize's
  new `nonLethal` resolve ("killed"→"taken" before killVictim is in reach; all
  eight existing callers byte-identical) — predatorAudit 0 legacy / **9**
  adopted. The compound is precinct HOLDING now (pry-out is a race against a
  37-49s transport clock). Every recapture inside adds +45s; a 4-beat day
  cycle (yard→chow→rec→lockdown) reuses the rooms. Ratchet: `CBZ.arrestAudit()`
  — **legacyTeleports pinned 0** (an arrest that reaches a cell by moving
  coordinates instead of walking there counts against it).
- **EVERY WARHEAD SPEAKS THE BUS, AND CARS ARE IN THE BLAST** —
  `ORDNANCE_BUS_ALL` (impactbus.js) + `CAR_COOKOFF_V2` (vehicles.js). Six
  hand-rolled detonations (RPG+40mm, grenade, tank, missile pool=airstrike,
  player fallback, explodeCar) migrated onto `CBZ.detonate` rows — the dead
  rows had drifted DOWNWARD, so the live caller won every disagreement, and
  `struct:6` is arithmetic (demolition's LEGACY_TO_LEDGER), not taste. Sound
  finally scales (`CBZ.blastVolume` = √power floored at 1) and heavy rows fire
  cityBlastWall/shatter off the same collider scan the breach already ran.
  CARS: an RPG into a car now connects (fpsmode direct-hit + deform); the 8TH
  WRAPPER (`_carBlastWrapped`/`opts._carSeen`, all markers copied) bills every
  blast's cars once (`_carBlastId` dedupes vs the wave pass); gunfire kills
  burn 2.4-4.6s before the boom, blast kills fuse at 0.4-1.6s JITTERED (that
  jitter is what makes a car park roll instead of chord), direct heavy hits
  flash 0.2-0.4s; `explodeCar` leaves a SOLID charred husk (crashdeform's
  `cityCarBurnOut` — bent, crazed, hood gone, smoulders, shunts traffic, reaped
  by the existing loop); drivers bail + cityScare when the fuse allows.
  Termination is proven: one bill per car per blast, burnt cars leave the
  ignitable set, CAR_CAP 24 / FUSE_CAP 14 / HUSK_MAX 10. **`carcook.fire=0.24`
  sits ONE HUNDREDTH under structural.js's FIRE_IGNITE_MIN — cars never ignite
  buildings; that is a one-character dial the owner flips, not a default.**
  Ratchet: `CBZ.blastAudit()` — **handRolled pinned 0**. Known: bailout.js's
  crash row was "aircraft-impact" (never existed → firecracker) with
  `frontal:true` coerced to 1m — fixed to real class rows.
- **B-2 POLISH (owner's photos)** — palette matched (light blue-grey top,
  near-black belly, fairings one step above skin), engine FIRE under player
  throttle only (`STRAT_B2_PLUME`, sprites parked for fxwarm), and [X] with
  empty racks now SAYS why (JDAM rack spent · buster/DEVICE from the vault)
  instead of silently re-picking Mk-84. Missiles get RPG PARITY: with no held
  lock, `ordnanceSeek` grabs `lockonFireTarget()` at trigger time. Bombs stay
  ballistic (buster/nuke never home; JDAM steers to a point, doesn't chase).

## THE 2026-07-27 LATE-NIGHT BATCH (owner screenshot session)

- **Ring-print pattern class DELETED at the generator** (clothes.js patternRow ban
  comment; sundress wears gingham now). **One speedometer**: carcluster owns it,
  hud.js stands down via CBZ.carClusterSpeedOwned() (the two writers shared a DOM
  id and disagreed on the unit). **INTERACT_REACH_V2**: reach 3.8→5.2, zone cone
  floor 0.5 — cards show up. **AIM_CHILD_NO_ASSIST**: aim magnetism/soft-lock/hot
  reticle all refuse protected actors (childSafeAudit OPEN 7→6); ballistics
  unchanged.
- **AN ALLEY IS A ROUTE, NOT A SHELF** — CBZ.alleyGapAt/alleyOk (props.js), widths
  solved from the player capsule (RUN 2.4 · SLOT 3.2 · OPEN 8.0), one shared
  budget map across all six scatter passes via DK.free. Window AC units CUT (260,
  no windows behind them), roof lattice → one plant deck, barriers/cones/boards
  cut, PROPS_KNOCK_PLAYER tips bins at a sprint via the existing car-knock arc.
  Flag PROPS_PURGE_V1, flag-off byte-identical (rng draws preserved). Ratchet:
  CBZ.propPurgeAudit() — alleysBlocked structural 0, acBoxes pin 0.
- **INTERIORS STAY INSIDE THEIR SHELL** — root cause: dressers disagreed about
  where the wall IS (roomKit measures inner face, furnishInterior the OUTER —
  Meridian Trust's bank partition ended 0.20 m onto the pavement). Structural
  fix: CBZ.interiorBounded wraps the ONE lbox seam — outside refused, straddle
  trimmed to the wall face; interiorAudit().spill pinned 0 with spillUnbounded
  printed beside. **INTERIOR_COHERENCE_V1**: CBZ.interiorMix data rows +
  ABOVE_TRADE (banks get workspace floors, shops get flats — never living rooms
  over a vault); new `residential` program (corridor + party walls + per-flat
  kitchen + roomPlan bedrooms, cap rides the tower) and `breakroom` (the ONE
  sanctioned office kitchen, on a cadence). CBZ.roomExecute extracted (plan once,
  draw many). **INTERIOR_LIFE_V1**: door guards + sleeping residents via
  citystaff rows (INTERIOR_LIFE_MAX_POSTS 150), CBZ.interiorRobbery — one
  citywide walk-in robbery through ped.guard/cityScare/panic/kill-bus, no
  mission system (the terrorist-shootup seam is contracts.js + mission.start,
  proposed not built). Night sweep beds idle upper-storey peds via propSeatNpc.
- **GA TRAFFIC**: AIR_TRAFFIC_CLEARANCE default FALSE (climb mode kept, one line
  back); **AIR_TRAFFIC_COLLIDE default TRUE** — original bands, and a hull inside
  a building fires the SAME downTraffic crash a bullet does (wall-face blast,
  byPlayer false, unattributed killfeed). Armed-shortlist detection: per-frame
  cost only for craft whose ring crosses something tall. Fixed fallTraffic
  detonating wrecks on rooftops ABOVE themselves. airTrafficAudit().clipping
  pin 0 (armed/candidates printed beside).
- **THE BLACK MOUNTAIN IS GONE** — terrain_overhaul's offshore range was the only
  LIT-material range (why it went near-black under every sun); TERRAIN_DARK_RANGE
  default false gates its one relief sector — tiles survive (they are the
  seabed), unlit ranges untouched, backdropAudit gains rangeRemoved and still
  sweeps (reliefCells 0 IS the proof).

- **HOW WELL A PERSON FIGHTS** — `CBZ.combatIQ` in `systems/combat_iq.js`. OWNER:
  "make npcs better at fighting… some of them shoot first… a group of them all
  with guns its just chaos… maybe you make it so much better it has to do LESS
  damage lol." Four arithmetic faults, not taste: **an armed ped never fired
  past 9.4 m** (peds.js's flat `want = 9` while npcAttack allowed 26 — every
  rifleman walked into pistol range), **nobody took turns** (N gunmen = N× DPS,
  all in the open), **the cover code was dead** (squadai.js scanned
  `cols[0..64]` — the first 64 entries of the GLOBAL collider array;
  `CBZ.queryCollidersNear` existed and no combat code called it), and **a gun
  was a damage number** (NPC_GUN had ONE row). `CBZ.combatIQ.posture(a,tgt,dt)`
  is the one call an armed brain makes. **The table is a DPS LADDER** — every
  cell is HP/s at 10 m and per-hit damage is DERIVED from it, so raising a
  tier's hit rate automatically lowers its damage; `DPS_CAP = 26` is enforced
  on the RESULT (nothing may out-damage the SWAT officer that already ships).
  Measured TTK: civ+pistol 7.9→25.0 s · thug+AK 7.9→7.7 s (unchanged) · beat
  cop 10.5→10.5 s (unchanged) · soldier+AK 7.9→4.5 s · SWAT 3.8→4.0 s; four AK
  gangers on one target 2.0→3.8 s. Adding a trade or a gun is a ROW. Flags
  `NPC_COMBAT_IQ` (master) · `_TIERS` · `_COVER` · `_SQUAD` · `_SHOOTFIRST` ·
  `_MELEE`. Ratchet: **`CBZ.combatIQAudit().legacy` pinned at 0**, adopted 7.

## FROM GPT TO CLAUDE — 2026-07-28 dogfood: world facts below, game rules above

The owner's “cinematic vs realistic vs fun/gamey” pull is not three competing
modes. It is the three-part authoring contract:

1. **WORLD MODEL owns truth** — a course, person, car, gun, door, surface,
   collider, inventory object. If a thing exists physically, every game asks
   the same owner for it.
2. **GAME PACKAGE owns the WHY** — stakes, eligibility, progression, surrender,
   victory and loss. It composes world things; it never redraws a person, writes
   a second vehicle brain or copies a venue.
3. **PRESENTATION owns emphasis** — camera, sound, HUD and spectacle make the
   important beat legible. Presentation may reveal truth; it may not replace it.

That is how one beat can be all three: a real car follows the real course
(realistic), three laps and a purse create a game (gamey), and the gantry/result
beat makes the finish land (cinematic). New work should add a world capability
or a package using capabilities, never another vertical stack.

- **A RACE AUTHORS A COURSE, NOT A SECOND TRACK** — `CBZ.raceKit` in
  `city/racedrivers.js` now owns `registerCourse/course/pathCourse` plus course-
  derived driver spawning and scoring. `island_speedway.js` publishes the ONE
  Diamond course (`line`, measured length, track half-width, grid slots,
  nearest parameter and surface). Three consumers adopted it in the same
  change: the legal Speedway weekend, APEX Night and the street race. APEX's
  private copy of the entire tri-oval/grid solve is deleted. Raw fields remain
  the one-switch degrade path. Ratchet: `CBZ.raceToolAudit()` —
  **legacy pinned 0, adoption pinned at 3**.
- **THE RACER IS A STORY MADE OF DURABLE RESULTS** — the title screen's tenth
  origin lands at the course-derived paddock and starts a five-beat career:
  report → finish a legal race → APEX podium → APEX win → APEX title.
  `cityRacerCareer` owns no championship save; it reads the legal/APEX records
  written by canonical `cityEvent("race-finish"/"race-title")` events. A new
  race integrates by emitting the event, not by editing the career. Ratchet:
  `CBZ.racerCareerAudit()` — 5 stages, 2 persistent sources, private state 0.
- **WAR BAND IS THE PACKAGE BOUNDARY PROOF** — `games/warband.js` is one small
  game file: muster real city peds → fight with shared weapons/combat/squad
  posture → a physically outnumbered remnant surrenders → recruit that same
  surviving actor or ransom them → take three banners. It authors no character
  mesh, animation, damage, gun, corpse cleanup, wallet, save system or mission
  UI. A Roman version should be outfits/carried assets/rules over the same
  actors, not another engine. `PKG_WARBAND` is the revert; math-gate pins the
  package rule surface at company 8 / banners 3.
- **PACKAGE PANELS NOW MATCH HOW AUTHORS USED THEM** — `ctx.hud.panel` accepts
  both `(html, handlers)` and `(headerHtml, bodyHtml, handlers)`, and passes the
  clicked `[data-act]` element to the handler. This fixes repeated row controls
  (`data-i`, `data-s`) for APEX, airport and every existing package instead of
  teaching each game another workaround.

**MERGE CASE — this is the code GPT stands behind.** Ship the shared course,
Racer career, War Band package and package-panel correction as one dogfood proof:
the course replaces copied track arithmetic for three consumers; Racer reads
durable results instead of owning a parallel championship; War Band composes the
real character, combat, wallet and mission systems instead of redrawing them; and
the panel correction is backward-compatible with both call forms already present
in packages. The half-built tree runtime was deliberately deleted before this
merge. `treesMODELCODE.js` is an unwired local reference, not a runtime dependency
and not part of this case. The ratchets are the claim: race adoption 3 with legacy
0, Racer 5 stages over 2 durable sources with private state 0, and War Band company
8 / banners 3. If those numbers do not hold, do not merge around them—fix the
shared boundary.

- **A GUN IS GEOMETRY WITH MASS, HELD OR DROPPED** —
  `CBZ.weaponPhysics` lives with the canonical gun models in
  `systems/actorweapons.js`. Its held solve samples the whole hand-to-muzzle
  segment against `groundAt`; its released solve carries velocity and spin,
  substeps walls and support, bounces, then sets the model's measured lowest
  vertex on the highest support under its footprint. Third-person hands,
  inventory/death pickups and the FPS death release are consumers, not private
  approximations. `CBZ.weaponPhysicsAudit()` requires all three, a zero-
  penetration ramp solve and zero active underground bodies.
- **SPOKEN WORDS ARE SUBTITLES, NOT PANELS** — `.world-subtitle` in `hud.css`
  is the one observed-world dialogue grammar used by both `citySay` and
  `campaignUI.say`: lower-centre, heavy white type, black outline, no box.
  Speaker identity remains accessible but visually yields to the spoken line.
  A campaign choice deliberately restores the speaker and dark choice panel,
  because a decision is interactive UI rather than passing speech.

### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 closing handoff: bomb soot, Prison Escape, and GitHub

> **AUTHORSHIP AND STATUS:** This subsection is GPT/Codex's closing handoff to
> Claude after the owner said this chat window was about to close. It records
> one implemented change, one source/deployment diagnosis, the facts that
> changed after that diagnosis, and the exact remaining validation. It is not
> owner-authored project law. Do not promote a diagnosis below into a current
> fact without checking the named snapshot and live deployment.

#### What this chat actually changed and published

The only gameplay code authored in this conversation is the removal of the
flat, generated black soot marks left by explosions. It is published for review
on branch **`agent/scorch-prison-handoff`**. The code commit is **`d210c68`
(`Remove printed building scorch marks`)**, based on current upstream
`066aba8`.

The branch deliberately contains only:

- `src/city/buildings.js`
- `tools/test-building-scorch-contract.mjs`
- this closing `CLAUDE.md` handoff in a later documentation commit

The original checkout had a very large, mixed dirty tree. On 2026-07-31 its
local `main` was `7dfd419`, while `origin/main` was `066aba8`; Git described it
as two commits ahead and nineteen behind because equivalent nuke work had been
rewritten upstream. Do **not** bulk-stage, reset, switch, rebase, or merge that
checkout just to recover this GPT work. A separate clean worktree was used for
the branch so unrelated sound, touch, building, reality, documentation, archive,
and test changes remain untouched.

#### Printed bomb marks — source, final decision, and invariant

The hated shapes in the screenshot were not a shadow, smoke simulation, or
physical fracture. `src/city/buildings.js` generated one radial
`CanvasTexture`, put it on flat `PlaneGeometry`, and reused it through
`SCORCH_CAP`/`scorchPool`. Several producers stamped that same dark cutout:

- `CBZ.cityScorch()` put it on the ground and projected copies onto nearby wall
  colliders;
- `CBZ.cityDamageBuilding()` stamped it on the selected facade and surrounded
  it with fake bullet-pit decals;
- the escalating wall-wound path added another copy through
  `placeWoundScorch()`;
- breach and structural-blast paths called the same effect again.

The first narrow pass removed only facade projection. The owner's wording and
image made the real rule clearer: **remove this whole family of printed
explosion marks**, including the ground disc. The final patch therefore:

1. deletes `SCORCH_CAP`, `scorchPool`, `_scorchMat`, `scorchMat()`, its generated
   canvas texture, reset bookkeeping, and every building/breach/structural call;
2. retains `CBZ.cityScorch = function () { return null; };` as a compatibility
   seam so the many old callers cannot crash while wrappers load;
3. preserves concrete chunks, shattered glass, pooled crack decals, accumulated
   wall damage, and real carved walk-through openings;
4. preserves ordinary bullet holes as a separate gun-impact grammar; it removes
   only the fake bullet-pit ring that an explosion stamped around its soot mark.

`tools/test-building-scorch-contract.mjs` is the regression ratchet. It proves
that `cityScorch` stays a no-op, the material/pool names stay absent, building
damage cannot call the effect, wall wounds retain `placeCrack()`, and no printed
mark is recreated. The focused contract, both Node syntax checks,
`git diff --check`, and the Vite production build passed again on 2026-07-31
against `origin/main` `066aba8`.

**Not yet proved in a real browser:** detonate a bomb/RPG beside several
facades and on open ground and film the result. There must be no black radial
cutout on either surface, while chunks, broken panes, cracks, and eventual wall
openings must still read. Do not call this visually closed until that runtime
shot passes.

#### Why `main` appeared to update Gang City but not direct Prison Escape

The 2026-07-30 complaint was not a failed GitHub Pages deployment. At the
investigated snapshot, local and remote `main` were both `5e76cee`; Pages was
healthy, publishing `main` from repository root, and the live `jail.js`,
`state.js`, and `capture.js` hashes matched the commit byte-for-byte. Seventy-four
modified paths and seven untracked paths were local-only. The local
`.github/workflows/pages.yml` was untracked and therefore could not control
GitHub.

The mismatch was an ownership/entry-path boundary:

| Entry | Mode and owner | What it means |
|---|---|---|
| Title-screen **Gang Life** | `data-mode="city"`; `src/games/jail.js` may engage | The city can arrest, book, hold, and transport the player through the County Jail package |
| Title-screen **Prison Escape** | `data-mode="escape"`; `src/world/*`, `src/entities/*`, and shared `src/systems/*` | A fresh standalone escape run; no city arrest sentence is injected |
| Gang City arrest transported to prison | city booking first, then `setMode("escape")` with `_jailSentenceIn`/`_jailBailIn` | The same escape world receives city custody context and runs the sentence clock |

`src/games/jail.js` says exactly what it is: **THE COUNTY JAIL, as a game
package**. `jailEngages()` requires `g.mode === "city"`;
`CBZ.cityBookIn()` rejects `g.mode !== "city"`; the package title is
`COUNTY JAIL`. `src/systems/state.js` and `src/systems/capture.js` explicitly
say that a run not started by arrest is the “pure escape game it always was.”

Therefore commits `2b066c2` and `e2b5f13` implemented this pipeline:

`Gang City arrest -> County Jail booking -> transport -> Prison Escape`

They did not replace the standalone prison world. Pushing them to `main`
updated Gang City because `src/games/jail.js` executes there; clicking Prison
Escape directly bypassed that city-only package by design.

The standalone prison's real content owners include:

- `src/world/ground.js`, `layout.js`, `southblock.js`, `towers.js`,
  `cellblock.js`, `cafeteria.js`, `yard.js`, `razorwire.js`, `door.js`,
  `escape_routes.js`, and `gunroom.js`;
- `src/entities/guards.js`, `npc.js`, and the player/entity layer;
- `src/systems/capture.js`, `interact.js`, `interactions.js`, `quests.js`,
  `reinforcements.js`, inventory/drop/run-stat systems, and their shared UI.

If one improvement must appear in both ways of reaching prison, put it in a
shared prison/world/system owner and have both entries consume it. Keep
city-specific arrest, booking desk, transport, bail, and custody presentation
inside the County Jail package. Do not “fix” this by deleting the mode gate or
making city jail own a second copy of the prison geometry.

#### Important update after the original diagnosis

The snapshot above is historical. By 2026-07-31, `origin/main` had advanced to
`066aba8` and now contains a dedicated standalone Prison Escape overhaul. The
commits from `5d91315` through `e965cf5` changed the correct owners, including
`cellblock.js`, `cafeteria.js`, `gunroom.js`, `ground.js`, `southblock.js`,
keycards, captures, lockdown, prison drops, inventory, run stats, interactions,
HUD, and touch controls. Across the relevant escape files, `5e76cee..066aba8`
contains roughly 7,159 insertions in 34 files.

GitHub Pages successfully deployed `066aba8` in run `30609059297`. On the
closing check, live `src/world/cellblock.js` and live `src/games/jail.js`
matched `origin/main` byte-for-byte. Pages is still the legacy source deployment
from `main` and `/`; it is not using the untracked local Actions workflow.

So the durable ownership explanation remains true, but the old symptom may no
longer reproduce: direct Prison Escape now has substantial work in its actual
owners. Reproduce on `066aba8` or newer before changing anything. The County
Jail package still remains city-only, which is correct; the two entries should
share prison capabilities while differing in booking/sentence context.

#### The deployment triage that prevented the wrong fix

When “it is committed but not online” is reported, keep deployment and
execution-path questions separate:

1. Record `git status -sb`, `HEAD`, `origin/main`, and the exact files in the
   suspect commit. Uncommitted files cannot be served by Pages.
2. Query the Pages source/status and the latest deployment's `head_sha`.
3. Hash the live suspect file and `git show <deployed-sha>:<file>`.
4. If hashes match, deployment is finished; trace title selection, `setMode`,
   package registration, feature flags, and mode gates.
5. If hashes differ, only then investigate deployment/cache/workflow behavior.

The local `.github/workflows/pages.yml` remains a separate latent footgun, not
the cause of this incident. If it is ever committed and Pages is switched from
legacy source publishing to its Vite artifact, note that `vite.config.js` copies
only `css`, `assets`, and `src`; standalone `games/*.html` pages would be
omitted. Direct Prison Escape is not one of those HTML files—it is the
`data-mode="escape"` route in root `index.html`—so that omission did not explain
this report.

#### What Claude should verify next

1. Review/merge `agent/scorch-prison-handoff` without importing the original
   mixed worktree.
2. Run `node tools/test-building-scorch-contract.mjs`, syntax checks,
   `git diff --check`, and the build, then perform the missing browser bomb shot.
3. Test both prison entries on one deployed SHA:
   - direct title-screen Prison Escape must show the current cellblock, rooms,
     pickups, lockdown, inventory, HUD, and touch work;
   - a Gang City arrest must still play physical arrest/booking, then transport
     into that same prison revision with a sentence;
   - the only intended divergence after transport is custody/sentence context,
     not a second prison map or stale content fork.
4. If the two entries need a new shared seam, add one canonical prison
   capability owner and an executable two-entry regression. Do not solve it
   with comments in `CLAUDE.md`, duplicated geometry, raw mode exceptions, or a
   deployment rewrite.

No prison gameplay file was changed by GPT in this conversation. That part was
diagnosis only. The published gameplay change is precisely the generated-soot
removal and its regression gate.

## THE WHY CONSTITUTION (owner, 2026-07-28) — read this before designing anything

The owner's own words, and they outrank every system doctrine below. **A game is a
why-machine.** Everything here exists to answer "why am I doing this", and a thing
that cannot answer it is noise however polished.

**LAW 1 — THE WHY IS DISCOVERED, NOT ASSIGNED.** The keycard story is the whole
theory. In the jail minigame the owner ran for the keycard hundreds of times with
nothing new to test — and NOT for the designed whys (escape, cigarettes). He ran
because the keycard opened a door to a bigger room, and that room had another door,
and behind it was THE GUN ROOM. Verbatim: *"the jail is dumb but I ran to get the
keycard relentlessly… that's what makes it a game."* So: **build gradients of
visible access and power, not objectives.** A player chases the strongest gradient
he can SEE. Doors beat markers. It does not matter if the thing you are doing is
dumb if it answers why.

**THE GUN-ROOM GRAMMAR — why that room worked, and the pattern to repeat:**
(a) **it was LOCKED** — a key is a promise, and a locked door with something visible
behind it out-motivates any quest marker; (b) **it was the best-made room in the
game** and the owner noticed ("better interior than anything in my GTA game") —
**craft is a signal; polish spread evenly creates no gradient, so nothing pulls.
Spend polish ASYMMETRICALLY on the rooms that matter**; (c) **the reward changed his
CATEGORY, not his number** — "the only character with a gun in the jail." Categorical
asymmetry is the reward that works. The bunker vault (blast door inside a blast door,
THE DEVICE on a cradle, one per world) is this game's one existing instance of the
grammar. It should be the SPINE, not a one-off: **a ladder of gun rooms**, each
loyalty rung unlocking a crafted, locked PLACE holding the tools of the next rung.
Corollary the owner named: glowing floor pickups make it "Subway Surfers" — physical,
crafted, locked things make the gradient.

**LAW 2 — THE WHY IS PEOPLE. The atom is LOYALTY + WEAPONS.** Money → people →
power. A gang, a prison gang, election supporters, a CIA cell, a corporation's
security, an army unit: *"anytime you have a ton of people loyal to you with weapons
could be a gang"* — Haiti is the owner's cited proof. Every endgame is that atom
spent: buy the city and build the tallest tower and fill it with your people; run for
mayor→governor→president; coup with the military or an agency; rob the armory to arm
a crew; take a hostage whose family is rich; dominate as racer or fighter, convert
fame into office into dictatorship. **We have already built the organs without naming
the creature** (factions/ranks-as-verbs, power details, elections + officeholders,
prison gangs, the armory, standing/wages/succession). What is missing is ONE spine:
the ledger that counts who is loyal to YOU and how armed they are, plus the threshold
verbs it unlocks. That block outranks the rest of the roadmap; a 10x city matters
because it is more to OWN.

**LAW 3 — THE ROME TEST (this is a game ENGINE).** Owner: *"I don't want to make
Roman-age Bannerlord, but I could easier than from scratch using my current code…
future Claudes don't need to draw and animate an NPC — that alone is worth my code —
they just draw the outfit and add animations and interactions."* So judge every block:
**does it survive a total setting change, or is it welded to modern-day gangs?** The
walking/fighting/sitting/ranked/covered/dying NPC is the asset. Scenarios are costumes.

**THE ITEM EXISTENCE TEST (falls out of the three laws).** *"Everything in inventory
is a physical asset."* An item must (1) have a physical asset, and (2) sit on a chain
you can walk to a why. Minecraft's inventory IS its game; ours must shrink until the
WORLD is the inventory. Guns and clothes are worn. Trade goods are CARGO in trunks,
not pocket abstractions — which answers the animal: the carcass is the item you carry
and sell, so the skin-popup and 13 abstract meat names both die. The pocket keeps
only what a person pockets: cash, phone, keys/keycards, medkit, grenades, bricks.
**An item that cannot produce an icon from its own asset fails the existence test —
refusing to draw an icon IS the reversible soft-cut.** Full analysis and the family
verdicts: `docs/plan/doctrine-items.md`.

**STANDING OWNER MANDATES (2026-07-12, older than the laws above, still
binding):** FIRST PERSON IS SACRED — "first person is amazing as is"; polish
third-person freely, never rework first-person feel. NO CRAFTING — "kill
crafting"; acquisition is buy/steal/loot in the world, never a recipe UI.
PERMADEATH is the design — brutal deaths (headshot/explosion/fall/execution)
are GAME OVER + save wipe (`CITY_PERMADEATH`, `city/death.js`; scripted kills
pass `imp.fatal`), survivable hits hospital-respawn.

**WHERE THE THINKING LIVES.** `GAMEPLAN.md` is the master plan (witness · scale ·
airline network · fauna · mantle · flag purge · §10 rim world · Step 0.5 icon purge).
`docs/plan/` holds every recon and pillar document behind it, including
`doctrine-items.md` (item purpose vs Minecraft/Rust/Bannerlord; the ~80%-built
arbitrage engine pointed at the wrong scope) and `doctrine-globe.md` (**true sphere
REFUSED on arithmetic** — a sphere with our area gives a 129 m horizon, one big
enough to keep a horizon gives 6 m of sag; staged answer is biome science → visual
globe → rim → maybe a one-axis ocean wrap; plus the 9-step Köppen/orography rule
table that VALIDATES eight of our shipped biome placements).

## THE 2026-07-28 SESSION — fixes that were laws, not patches

Owner played and reported; each of these turned out to be arithmetic, and each fix is
a law so the class cannot return. Short list, with the number that proves it:
- **GHOST CITIES** — not displacement: `interiorlight.js`'s shared glow-panel pool was
  parented to the first-registering *translated building group* while its records hold
  WORLD coords, so every panel in the city shifted by that building's offset (280-540 m
  toward the mountains, ~15-20 slab lattices + one 52-storey column — the 1400-instance
  cap exhausts inside the mainland, which is exactly what the owner saw). Now every pool
  resolves a true identity host, declares `userData.worldSpacePool`, and
  **`CBZ.poolParentAudit().atTranslatedParent` is pinned 0 in the gate** (0 is the LAW
  here, not a measured baseline). Second half: `farcull`'s ×3 slack term exempted every
  populated pool from culling forever, and four builders (govcomplex, military, terminal,
  forest cabins) never registered in the lot list the distance proxy reads — hence walls
  culling while windows stayed. Hysteresis now derives from viewer SPEED (a 20 u band
  against a 1 s amortised retest is nothing at 150 m/s), and detail fittings yield above
  320 m AGL (a 2 m fire escape is 6 px there).
- **A WALL MEETS A ROAD AND YIELDS** — `CBZ.roadGapRun/roadGapDefer/roadGapAt`
  (roadrules.js). The mainland seawall's ONLY openings were four hand-typed literals,
  each added after somebody hit an invisible knee-wall at one causeway. The derived gap
  (`max(travelled way, deck/2) + 1.5`) REPRODUCES those authored gates; 6 producers
  migrated (the Mercy berm's magic z-range literal is deleted), an order-98.6 sweep
  catches non-adopters, buildings are structurally untouchable and 3-6 m prison/gov walls
  are MEASURED not punched. Ratchet `roadBlockAudit().crossingsRemaining` 0.
- **THE WORLD STOPS BEING WALK-THROUGH** — the answer to "find things you can run
  through" was VEGETATION: thousands of trees, boulders and field fences drawn and never
  collided. 26 classes fixed across 19 files (plus a 26 m bridge-tower leg standing in a
  travel lane, Capitol bollards you could drive between, and a town welcome sign that was
  the inverse fault — an invisible 11 m wall). `CBZ.solidityAudit()`.
- **AN ALLEY IS A ROUTE** (`CBZ.alleyGapAt/alleyOk`), widths solved from the player
  capsule, one shared budget across all six scatter passes; window AC units cut (260 of
  them, hung on walls with no windows behind them — a SECOND producer was found later in
  buildings.js, and the boxes the owner then saw were the ghost glow panels).
- **A LYING BODY'S FEET ARE NOT ITS MIDDLE** — the sleep pose put the rig's ORIGIN
  (its feet) at the mattress centre, so the crown ended 0.82 m past the headboard in
  mid-air. Player and NPC now share ONE `propLiePlace` derived from the rig's measured
  height; loungers fixed by the same call.
- **ARMOUR SITS PROUD, PRONE RIFLES REFUSE THE DIRT** — `cityArmorFit` clamps every
  armour piece ≥0.01 off the outermost garment (the sweep caught that the previous
  jacket fix would have put the WHOLE VEST on the jacket plane); the prone gun solves one
  grazing-angle inequality that covers every stance/slope/barrel length, and `PRONE_SINK`
  now derives from the pitched chest box (it was tuned to the hip line, so the chest was
  0.11 m under the floor).
- **THE WALL STOPS WEARING THE EXPLOSION** — `FX_WALL_WOUNDS` default false kills the
  60-90 s wall-anchored smoke emitter and the 8 cm-proud scorch quad (both had been
  diagnosed and deleted ONCE before, then reintroduced one function over); detonation FX
  and GROUND scorch stay. Burning buildings emit at a real standoff with a flame root.
- **LOCK-ON STOPS SEEING THROUGH WALLS** — squares defaulted to VISIBLE on churning slot
  bindings faster than the one-per-frame LOS test could answer, AND the arena's invisible
  LOS proxy was still sized for the 2-tier bowl (16 m against a 25 m wall — 59% of the
  facade transparent to cops, cameras and locks). Per-actor cached LOS + the proxy walking
  the real arcs.
- **THE DRIVE-BY IS A REAL CAR** — it was never in `CBZ.cityCars` (so every bullet and
  explosion in the game was blind to it BY CONSTRUCTION), sat at a literal y=0, and the
  man leaning out the window did not exist. Now a factory car on real suspension with a
  real crew: kill the shooter and the gun stops; kill the driver and it coasts to a halt
  as a stealable gang car with bodies in it. Census cleared every other event vehicle;
  `heists.js`'s bespoke box truck is the one remaining offender (duplicates armored.js).
- **THE DEAD KEEP THEIR WEIGHT** — `city/morgue.js`. Heli crews dropped weapons AT
  150 m (their seat's world position); cop corpses were deleted after EIGHT SECONDS; ten
  `.dead = true` sites dropped nothing; `_armorKit` was never convertible to loot, so
  guards were unstrippable BY CONSTRUCTION. One drop routine at the kill choke point that
  DEFERS until the body rests, corpse persistence (costs nothing new — a corpse already
  held its list slot forever), and a real EMS arc: van drives up, medic works the body,
  **shoulder-carries it** (`ragdollPin`'s second consumer) to the tailgate; staging waits
  out hot scenes.
- **HOW WELL A PERSON FIGHTS** — see the `combatIQ` entry above; the headline is that
  **no armed NPC has ever fired past 9.4 m** and the cover code scanned the first 64
  entries of the global collider array (dead its whole life).
- **THE NUKE IS 16 KILOTONS AND KNOWS IT** — the yield is INVERTED from the bus row's
  own fireball radius (`W=(126/50)³`), so spectacle, ring damage and death toll can never
  drift. Cap 5.1 km wide / 10 km top (tropopause = a ceiling, not W^(1/3)), rendered as a
  sky-locked quad at true ANGULAR size because the honest cloud is 10× the frustum;
  cap:stem 8:1 → 3:1 (it was a chimney under a hat, and the gate meant to catch that was
  ONE-SIDED); Hiroshima's measured fatality curve replaces a cliff (everyone inside 675 m
  died, nobody outside), rolled on a POSITION HASH so clients agree; buildings collapse at
  5 psi (1.1 km), gutted at 2 psi (2 km), glass at 3.3 km; instant player death is now the
  fireball ONLY. Ground detonation is a real 90 s countdown — derived from this game's own
  sprint speed vs the blast reach, because the old 45 s was less than the time needed to
  run clear, i.e. never an escape.
- Also: County Jail is a real building on its own claimed land (the whole move cost
  `wanted.js` ZERO changes — the anchor seam absorbed it); the airport's fence stood
  INSIDE its own kerb road for 1,190 m and the arrival's first leg (268 m) never existed;
  the speedway's sponsor boards were flipped on BOTH axes and its lot was boxed in by a
  fence nobody measured; E ejected you from planes because every E press ran the ride
  router first; Space never cleared the map waypoint because it was never bound.

## THE GATE WAS NOT RUNNING SEVEN OF ITS OWN RATCHETS (measured 2026-07-29)

Run `node tools/math-gate.mjs --seeds 90210` against a CLEAN `HEAD` worktree and
you got `predator - | checkpoints - | beach -`, `venues - | fishing - | ranks -`,
`street - | stunts -`, `power -` and `fxwarm -`. Not "zero". **Blank.** Two
statements in the PASS block string-concatenated an `Object.create(null)` MAP —
`venueStaffAudit().venues` and `rankAudit().orgs` — which raises "Cannot convert
object to primitive value", and **the throw aborted the whole ratchet block from
that point down.** Every audit below the first one asserted NOTHING. The same
line also read `vs.staffed`, a field that has never existed (it is `manned`), and
`rankAudit`'s `emptyRanks`/`verblessRungs` are ARRAYS, not counts, so `empty=` was
printing the array. Both are fixed and the offenders are now NAMED in the output,
because "which rung has no holder" is the entire value of that number.

This is CLAUDE.md's own law turned on the gate itself: **an audit nobody has
executed is not a measurement.** The `propUseAudit` lesson had a sibling nobody
had noticed. THE MEASURED TRUTH on clean `HEAD`, first time these ever ran:

| ratchet | claimed here | **MEASURED** |
|---|---|---|
| `venueStaffAudit().unstaffed` | **pinned 0** | **5** — the pin has been failing silently |
| `fishAudit().refused` | **pinned 0** | **3** — three spots stand on dry land |
| `rankAudit()` | NOT YET PINNED | **7 orgs / 34 rungs / held 18 / verbed 30 / empty 1 / verbless 4** |
| ↳ `emptyRanks` | — | `gang:prospect` |
| ↳ `verblessRungs` | — | `campaign:{volunteer,organizer,operative,boss}` |
| `powerAudit().legacyGuardSites` | baseline 9 | **8** |
| `predatorAudit()` | 0 / 9 | **0 / 9** confirmed |
| `checkpointAudit()` | — | **4/4 manned** |
| `streetAudit()` | NOT YET PINNED | **1575 poles · disc 0 · thru 0 · noCol 0 · junc 259/260 · paintThru 0** |
| `groundMatchAudit().maxErr` | — | **0.34 m, over the gate's own 0.30 limit** |
| `fxwarm` bad materials | — | **8** |
| `roadClearanceAudit().propsInside` | pinned 15 | **16** |
| GOLDEN roads (seed 90210) | 178 | **202**, and the biome set gained `annex` |

**The last four rows are live, pre-existing FAILURES on `main`** — i.e. the
deployed site. They are not this or any recent wave's doing (verified by running
the fixed gate against a clean `HEAD` worktree and diffing). They are the cost of
the "no testing just building" waves: the gate was red and nobody looked. **Do
not re-pin a ratchet upward to make it green.** The two GOLDEN rows are stale
CALIBRATION and should be recalibrated deliberately (`--calibrate`); the other
two are real drift and want a fix.

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
| venue seats whose anchor declared no cushion (the arena bowl) | — | **0** (was every one) |
| rank/tier ladders (RE-COUNTED 2026-07-27, file-by-file) | 20 → ~28 | **~24** |
| ↳ copies of the GANG rank order alone | 8 | **7** (playergang · careers · leaderboard · level ×2 · gangs ×2 — `hud.js`'s copy is DELETED) |
| ↳ copies of the POLITICAL title ladder | — | **8 files** (officials · officialdom · contracts · civic · statecraft · candidacy · elections · games/government) |
| jobs the world casts that `aigoals.js` `CITY_JOBS` has never heard of | — | **~120** (no workplace, no shift, no wage) |

The rank-ladder row still dwarfs the old 20, and the political sub-row is why:
the political title ladder ("President"/"Governor"/"Mayor"/"Chief") is
hand-copied across EIGHT files, and `officialdom.js`'s own comment admits the
duplication while predicting it "is not going to be four" — it is eight. **That
one is the next migration owed.**

CORRECTED 2026-07-27 (this paragraph used to name three live faults; all three
are now fixed, and leaving the old text would be exactly the stale-claim
problem this file keeps catching itself in):
- `careers.js`'s `secco` was "three rungs of `wageMul` and nothing else". Senior
  Guard now issues a REAL sidearm through `CBZ.cityGiveWeapon`; Shift Manager
  survives one star instead of being fired on the spot. The multipliers stay —
  being the *only* difference was the fault, not existing.
- `level.js`'s `MIL_NAME` was "8 rungs that unlock nothing at all", with a top
  rung unreachable in practice (0.3% per body off the SEEDED stream). It is no
  longer a ladder at all: `militia.js` declares the ONE army ladder, three of
  those eight rungs (Captain · Major · Colonel) are DELETED for having no verb,
  and rank is assigned by roster slot so a General exists the moment a garrison
  does.
- "There is **no police rank ladder at all**: `police.js` has one boolean,
  `swat`." There is one now, it has six rungs, and five of them gate an order
  the force already knew how to give. See "A RANK IS A VERB, OR IT IS NOTHING".

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
