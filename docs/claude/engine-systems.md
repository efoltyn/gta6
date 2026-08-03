# Engine systems — REUSE these, never re-invent

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02). Binding.

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

