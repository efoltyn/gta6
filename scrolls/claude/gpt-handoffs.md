# GPT (Codex) → Claude handoffs and diagnostic issues 28–121

> Extracted from the old giant CLAUDE.md (split 2026-08-02). The old file
> carried byte-identical duplicate copies of the 07-29 addendum, convergence,
> iPad, and audio handoffs, plus a superseded shorter bomb-soot handoff;
> exactly one copy of each is kept here (the extended bomb-soot version).
> Diagnoses are dated — verify against current code before treating as open.

## FROM GPT TO CLAUDE — 2026-07-28 dogfood: world facts below, game rules above

- **A SKY IMPOSTOR MAY MOVE IN DEPTH; ITS WORLD EVENT MAY NOT MOVE ON THE
  GROUND.** The nuclear dome and mushroom share one detonation X/Z. A far-plane
  impostor must project its ground-zero and top anchors independently; scaling
  a quad about its centre from a moving camera makes its apparent base slide
  across the city, especially during the held-C aircraft shot.

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
- **THE NUKE MAY DESTROY A CITY; IT MAY NOT EXECUTE ONE IN A FRAME** —
  the white dome and coherent mushroom were not the freeze. The gameplay
  handoff behind them was: a 17.2 s wave on a universal 20 Hz cadence caused
  ~344 whole-world evaluations; a newly reached band executed every structural
  hit immediately; the condemnation queue re-sorted itself every frame; the
  fire/yield tickers scanned every damaged lot forever; and one surviving cop
  kept the entire cop roster scanning for the full 24 s aftermath. The owners
  now state the law: the nuclear wave queries at 5 Hz without changing its
  190 m/s propagation, crowd owns a one-pass annulus, structural admission
  feeds a maximum-eight-hits-per-frame queue, admitted cars drain at 24/frame,
  active sets own fires/yields, and the cop roster is snapshotted and
  cursor-drained once. Prove it without a
  renderer using `node tools/test-nuke-freeze-node.mjs`: its 5,000-lot stress
  world must finish the wave, drain to zero, use zero legacy crowd discs and
  never exceed eight structural hits in one simulated frame.


### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 Prison Escape geometry, combat, and body-parity handoff

> **AUTHORSHIP AND STATUS:** This subsection is GPT/Codex's closing handoff
> after the owner asked why standalone Prison Escape has overlapping props,
> open/see-through interiors, attackers who charge and freeze the player rather
> than visibly fight, and bodies that feel less physical than Gang Life. Three
> focused audits covered geometry, combat, and body parity, followed by source,
> history, seeded live-CDP, and existing-test cross-checks.
>
> This conversation was **diagnosis and planning only**. It changed no gameplay
> file. Do not read any item below as fixed. The only authored artifact from
> this conversation is this handoff, published from current upstream
> `0f5ee94` on branch **`agent/prison-parity-handoff`**. The original checkout
> remained a large mixed dirty tree on local `main` (two commits ahead and
> twenty behind `origin/main` at the closing check); it was not bulk-staged,
> reset, switched, rebased, or merged. The temporary runtime probe was stopped.

#### Executive conclusion

This is not one transparency bug, one bad prop, or a lower-quality inmate mesh.
Standalone Prison Escape still owns legacy parallel implementations for rooms,
placement, melee, damage, KO/death, and body integration. Gang Life later gained
constraint-checked interiors, a real combat-IQ beat structure, directional
reactions, body ownership, grounding, and nearby articulated ragdolls. Those
systems are loaded globally in several cases, but standalone prison actors and
world producers were never enrolled in them—and some shared-looking systems
explicitly return when `mode === "escape"`.

The durable design decision is:

- keep standalone Prison Escape as its own escape/social game;
- keep Gang Life's County Jail package as city arrest/booking/transport context;
- share actor schema, damage, body physics, melee competence, placement,
  collision scope, and physical room rules underneath both;
- do not replace prison inmates with city pedestrians or create a second
  prison-only placement/combat/body stack.

The dependency order is:

```text
executable reproduction
  -> actor and mode ownership contracts
  -> physically enclosed room hosts
  -> one spatial reservation owner
  -> one damage and body lifecycle
  -> coordinated visible melee
  -> cross-mode parity ratchets
```

#### Source-path naming trap

There are two jail entry contexts:

1. Root `index.html`'s title-screen **Prison Escape** selects
   `data-mode="escape"` and runs `src/world/*`, `src/entities/npc.js`,
   `src/entities/guards.js`, `src/entities/ai.js`, and shared systems.
2. `src/games/jail.js` is **COUNTY JAIL, as a Gang Life game package**. It uses
   city peds/brain/collision/death while the player is in city custody, then can
   transport into the escape world with sentence/bail context.

The County Jail code explicitly uses real city peds and `cityKillPed`; the
standalone escape path deliberately retains its original population and loop.
Do not try to gain parity by deleting the city-mode gate or making County Jail
own a second prison map. Improvements that should exist in both entries belong
in the shared prison/world/system capability consumed by both.

#### Finding 1 — the “transparent roof” is absent geometry

The renderer was exonerated:

- all inspected prison structural collider materials were visible and opaque;
- transparent batching is rejected;
- prison colliders are not merged into transparent batches;
- far culling is city-only;
- camera occlusion pulls the camera inward rather than fading roofs;
- static freezing changes transforms, not opacity;
- PBR promotion preserves opacity and sidedness;
- only deliberate windows, puddles, FX, signs, and vision volumes are
  transparent.

The source explicitly authors open-top dioramas:

- `src/world/roombuild.js::roomShell()` promises a floor plus four **open-top**
  walls and creates no ceiling slab.
- Cafeteria, lounge, gunroom, workshop, chapel, infirmary, and laundry all call
  that helper.
- `src/world/cellblock.js` labels its own outer walls “open top.”
- `src/world/escape_routes.js` calls sparse cross-beams and pipes a ceiling
  structure, but they do not make a continuous roof.
- the south-block guard hut is the sole room-shell consumer that manually adds
  a real roof.

Live vertical rays found open sky/floor-first results at workshop, chapel,
infirmary, laundry, cafeteria, and lounge centers. The guard hut alone hit a
real roof at roughly `y=3.6`; the cellblock hit only occasional thin trusses.
This must be fixed with physical roof geometry, not alpha, double-sided
materials, roof fading, fog, or camera trickery.

#### Finding 2 — prison placement has multiple blind ledgers

Relevant prison modules consume neither `CBZ.placement` nor `CBZ.roomPlan`.
They combine:

- unchecked fixed coordinates in room/prop files;
- private `ZONES`, `OBSTACLES`, and `placed[]` arrays in
  `src/world/clutter.js`;
- direct `spawnPiece()` calls;
- pickups with fixed vertical coordinates.

Those producers cannot see one another. Concrete deterministic defects:

1. `clutter.js`'s cone row starts at `(-22,32)` and adds cones at 1.6 m
   intervals. `src/world/props.js` anchors the outdoor gym at `(-22,32)`.
   Runtime bounds put the first cone through the weight bench and the third
   through the dumbbell rack. The clutter obstacle list simply omits the gym.
2. The picnic table centered at `(18,30)` intersects the lounge's north and
   west walls. It is non-solid, so a collider-only audit cannot see the defect.
3. The buddy trash-bag branch deliberately skips `nearPlaced`; seed `90210`
   produced two visibly intersecting bags.
4. `src/entities/coins.js::addPack()` always spawns at `y=1`. Packs were found
   embedded in the workshop bench and prison bus; several other room packs
   float over or cut through their intended support.

Intentional compound geometry was separated from defects: wall corners,
stacked crates, table benches under tabletops, and the authored barrel cluster
are valid. The future audit must compare top-level owners/support relationships,
not blindly reject every overlapping child mesh.

Gang Life already has the missing foundations:

- `src/city/placement.js` is the spatial-hash occupancy/anti-overlap owner;
- `roomPlan` rejects out-of-host, door-keepout, host-conflict, and inter-piece
  intersections;
- city interior clamping/audits record and reject spills.

The prison must adopt those owners. Do not make `prisonPlacement`.

#### Finding 3 — piece migration also broke mode ownership

Prison crate/prop calls to `CBZ.spawnPiece()` omit `parent`:

- `src/world/crates.js` at the crate spawn;
- `src/world/props.js` at picnic table, weight bench, and barrel spawns.

`src/systems/pieces.js` therefore falls back to `chunk.root`, and chunk roots
are attached directly to the global scene. `src/systems/state.js` toggles
`prisonRoot`, not those global chunks.

Live inspection found all ten migrated prison pieces—five crates, picnic
table, weight bench, and three barrels—outside `prisonRoot`. After switching to
city, all ten still had a visible scene chain and retained their colliders.
This does not duplicate them during one Escape load, but it defeats mode
isolation and lets prison geometry/physics leak into other modes.

The shared collider resolver has a one-off `_city` exclusion but no symmetric
general ownership contract. Root visibility also cannot by itself disable flat
collider/platform/LOS arrays. Mode ownership must be explicit on every record.

#### Finding 4 — inmate retaliation is authored as charge plus invisible stun

`src/entities/ai.js`'s prison hunt path:

- targets the player's exact center;
- returns `baseSpeed * 1.5`;
- inside about 1.9 m, every second sets `player.stun = 0.5`;
- adds four heat and plays a cue;
- never damages player HP;
- never authors punch, guard, windup, swing, recovery, body-hit, or directional
  reaction state.

`provokeGang()` can turn every living same-gang inmate into a hunter.
`src/entities/npc.js` continues homing until roughly 0.4 m. Shared human contact
then resolves overlap by moving the player about 88% and the NPC only 12%,
while capping player speed at 1.5. On the next physics frame, non-zero stun
zeros WASD completely.

The actual loop is:

```text
inmate targets player center
  -> runs into body
  -> proximity timer writes stun and heat
  -> contact shoves/slows player
  -> physics zeros input
  -> inmate continues targeting the unreachable center
```

In a controlled eight-hunter probe with guard escalation suppressed, the player
was stunned for `240/360` frames—**66.7%** of six seconds. With normal heat and
guards active, frozen time reached `281/360` frames—**78.1%**—and maximum stun
rose to about 1.85 seconds as the separate guard capture path joined.

Every proximity pulse adds four detection heat. Five simultaneous arrivals can
cross the guard-hunt threshold near 18 immediately. Guards then use their own
`1.7x` charge and capture chain: taser stun, tackle stun, then cuffs/escort.
Higher heat can trigger reinforcements and lockdown. The player experiences one
continuous freeze, but it is compounded from two different legacy systems.

Prison NPC-versus-NPC combat is equally numeric. `exchangeBlows()` directly
subtracts HP from both actors on a timer, while fight steering continues at
roughly `1.45x` speed even at contact. There is no visible exchange whose swing
frame owns damage.

#### Finding 5 — player punches have a separate hard freeze/regression

`src/systems/combat.js::landPunch()` subtracts target HP, then calls
`bodyWound()` using `actor.pos.x/y/z`. City actors expose `.pos`; prison inmate
and guard constructors expose only `group.position`.

Live escape census:

- `102/102` inmates had `group.position`;
- `12/12` guards had `group.position`;
- `0/102` inmates and `0/12` guards had `.pos`;
- `bodyWound`, `CBZ.body`, `reactPunch`, `cityRagdoll`, and `deathPose` were all
  loaded, proving this is not a missing-script failure.

The wound dereference throws **after HP subtraction** but **before**
`pendingPunch = null`. The main loop catches updater exceptions, so rendering
continues while the same pending hit retries and future input says “Finish the
swing.”

An isolated reproduction:

- first punch returned “Swing...”;
- target HP fell from `100` to `67` because the pending hit applied repeatedly;
- the second punch was rejected with “Finish the swing.”

Git blame places the regression at commit `889a8b90`, which added the wound call
using the city actor schema without adapting prison actors. A fix must normalize
the actor contract **and** make hit consumption atomic; a fallback position
alone would leave future side-effect exceptions able to repeat damage.

#### Finding 6 — the rig is shared; the physical lifecycle is not

Live comparison showed prison and city adult male actors use the same
articulated `makeCharacter` foundation:

- adult profile;
- elbow and knee joints;
- `humanScale: 0.7`;
- approximately 1.82 m metric.

The lower-quality read begins after construction:

- `src/systems/grapple.js`'s shared body integration immediately returns in
  Escape mode.
- Its update roster steps survival bots and city peds/cops, not inmates or
  guards.
- Its late articulated body write also skips Escape.
- Prison receives only a small `_phys.kx/kz` fallback slide from reactions.

Controlled knockdown evidence:

| State | `_phys.down` | root X | Read |
|---|---:|---:|---|
| Immediately after `body.hit` | 1.3000 | 0 | request recorded |
| After normal Escape tick | 1.3000 | 0 | solver never stepped |
| After manual `body.step` | 1.2833 | -0.263 | real fall began |

Prison KO/death owners instead damp the entire character root toward
`rotation.z = PI/2`, independent of impact direction or force. Prison AI adds
one-frame positional knockback/gore but does not hand ownership to body physics,
generic articulated KO/death poses, or city ragdoll. Inmate/guard controllers
also never consult `CBZ.body.busy()`, so enabling the solver without first
yielding locomotion would create two transform owners.

Dead/KO prison actors are excluded from standing collision entirely. The rigid
foot-pivot side roll can therefore intersect floors, walls, furniture, and
other corpses. City peds instead yield locomotion while the body solver owns
them, route KO/death through force-aware handoff, ground bodies against
surfaces/walls, and use a nearby articulated 13-point ragdoll when appropriate.

The correct improvement is shared body ownership and lifecycle, not a new
inmate mesh.

#### Finding 7 — Gang Life's melee upgrade never adopted prison

`src/systems/combat_iq.js::melee()` already implements:

```text
close -> circle -> guard -> windup -> swing -> recover -> backstep
```

City peds land damage only when that state machine returns `swing`, and city
movement honors its spacing goal. City damage then applies wounds, reactions,
body impulse, KO/death ownership, and attribution.

The July 28 combat upgrade modified city combat/peds/gangs/police/squad AI and
added the shared-looking competence system, but did not migrate prison
retaliation or `exchangeBlows()`. `combatIQ.melee()` also rejects an actor
without `.pos`, so current prison actors cannot adopt it directly.

The combat-IQ audit lists city legacy sites and can report `legacy:0` while both
prison fight paths survive. The richer directional reaction branch is similarly
city-gated, and its introducing commit explicitly promised jail/survival would
remain untouched. This is the core parity-ratchet failure: shared code exists,
but the required consumer list excludes the mode the owner is comparing.

#### Existing tests are insufficient or bless the defect

- `tools/test-jail-contact.mjs` passes and explicitly ratifies ordinary contact
  blocking plus the 1.5 player speed cap. It does not distinguish casual
  contact from hostile melee positioning.
- `tools/test-jail-sprint.mjs` currently fails later because its fixture omits
  `CBZ.CONFIG`; that is a fixture error, not evidence for this combat defect.
- No current gate measures prison actor schema, punch completion, updater
  errors, hostile spacing, windup/swing ownership, stun duty cycle, heat
  escalation, body stepping, room closure, cross-producer overlap, pickup
  support, or mode-root ownership.

Relevant combat/AI/body/room files were clean when audited; current dirty-tree
changes were unrelated. Treat this as historical architectural drift, not as
damage from the owner's present local edits.

#### Required implementation program — exact order

##### Phase 0 — executable parity reproduction

Create `tools/test-prison-parity-browser.mjs` on deterministic seed `90210`.
It must measure:

- `.pos === group.position` for every combat-capable actor;
- one swing -> at most one HP mutation;
- pending punch clears and a second punch can start;
- zero `[updater]` exceptions;
- roof rays at every declared interior;
- owner-level spatial intersections with intentional compound/support tags;
- pickup support and geometry clearance;
- prison object/collider/platform/LOS inactivity after Escape -> City;
- knockdown timer progression, body movement, and locomotion yielding;
- eight-attacker commit count, spacing, real hits, stun frames, heat changes,
  and player-movable frames.

Repair the missing `CBZ.CONFIG` sprint fixture. Split jail-contact assertions
into ordinary social contact versus hostile combat contact. Develop each
contract red against the original defect, but land phases green; do not add a
permanently failing broad gate.

##### Phase 1 — actor correctness and world isolation

1. In `src/entities/npc.js` and `src/entities/guards.js`, standardize the
   fight-capable actor contract: `pos: char.group.position`, `char`, `group`,
   stable identity, `hp/maxHp`, `dead`, `ko`, and `kind`.
2. In `src/systems/combat.js`, resolve/validate target position before HP
   mutation, consume the pending strike before side effects or guarantee cleanup
   in `finally`, and attach a stable hit ID so a swing is idempotent.
3. Give colliders, platforms, pieces, and LOS blockers a general
   `mode: "escape"|"city"|"survival"|null` scope. Replace the one-way `_city`
   exception with a shared active-mode predicate while retaining compatibility
   during migration.
4. Stamp prison `addBox` output as Escape-owned. Pass
   `parent: CBZ.prisonRoot` plus `mode:"escape"` at every prison
   `spawnPiece()` call.

Phase-1 exit:

- two sequential prison punches complete;
- every completed swing changes HP at most once;
- no updater exception;
- switching to city yields zero visible prison pieces and zero Escape-scoped
  collider/platform/LOS query results.

Do not tune damage or animation in this phase. Stabilize the facts later phases
need to measure.

##### Phase 2 — physically enclosed room hosts

Upgrade `roomShell()` from “floor plus four open-top walls” to a building host:

- roof defaults on for its current interior consumers;
- an intentionally open structure must request `roof:false`;
- add an opaque continuous slab with a readable underside;
- stamp shadow, LOS, and height-banded camera/player collision correctly;
- return `{id,bounds,doorKeepout,height,roofOpenings}` rather than only center
  coordinates.

Add a real cellblock slab, split only around functional ceiling hatches.
Keep the beams/pipes below it. Remove the guard hut's duplicate manual roof.
Add cheap ceiling fixtures/emissive panels so the new shadows do not make rooms
unreadable. Let the existing camera sweep compress the boom beneath the roof;
do not fade the roof away.

Phase-2 exit:

- every intended room-center upward ray hits an opaque roof;
- declared hatches are the only openings;
- third-person camera never renders above a slab while aiming at a player below;
- outside views show a real roof;
- interiors remain readable in first and third person.

##### Phase 3 — one spatial truth for rooms, props, clutter, pieces, pickups

Load `src/city/placement.js` early enough for prison world construction. The
runtime API is already `CBZ.placement`; file location is not a reason to invent
a second service.

Extend it with:

- atomic `claim(rect, metadata)`;
- stable owner/source IDs;
- `release(ownerId)` for lifecycle cleanup;
- mode/room scope;
- explicit compound/support/stackable relationships;
- conflict diagnostics naming both owners and sources.

Adoption rules:

1. `roomShell()` registers its host footprint and doorway keepout globally.
   Clutter sees the room as blocked.
2. Authored furniture remains distinctive but is represented as validated
   room-plan entries inside that host. It may ignore its own host reservation,
   never the walls, door, or peer furniture.
3. Fixed props claim their complete top-level footprint before building,
   including non-solid picnic-table benches and the whole gym/rack compound.
4. Pieces reserve on spawn and release on despawn.
5. Move `clutter.js` after fixed rooms/props. Delete its private
   `ZONES`/`OBSTACLES`/`placed[]` ownership and use deterministic
   `CBZ.placement` candidates.
6. A buddy bag must claim a second valid candidate. A cone row shifts or drops
   a cone when blocked; it never clips through an owner.
7. Replace `addPack(x,z,value)` and fixed `y=1` with an intent record:
   ground loot searches a nearby unoccupied ground point; furniture loot uses a
   registered tabletop/bench socket. Missing support is an audit failure, not an
   embedded pickup.

Phase-3 exit across several deterministic seeds:

- zero unintended top-level intersections;
- zero room spills;
- zero unsupported/embedded pickups;
- zero clutter inside room hosts or door keepouts;
- intentional compounds/stacks remain valid;
- placement cost remains load-time, not a new frame loop.

##### Phase 4 — one damage event and one body owner

The generic body solver currently lives inside survival-named `grapple.js`.
Move, do not rewrite, generic `CBZ.body` integration into
`src/systems/bodyphysics.js`; leave survival grab/throw verbs in `grapple.js`.
First prove city/survival behavior unchanged, then enroll prison.

Use an explicit registry:

```text
CBZ.body.register(actor)
CBZ.body.unregister(actor)
CBZ.body.busy(actor)
```

Step only active bodies so 114 idle inmates/guards do not become a full-roster
per-frame cost. NPC/guard locomotion and animation must yield while
`body.busy(actor)` is true. Standing actors remain in ordinary human contact;
owned/down/dead bodies use the shared ground/wall/corpse path. Remove the fixed
whole-root side rotation as the primary prison KO/death representation.

`src/systems/childsafe.js` already describes a canonical
`CBZ.damage(target, amount, opts)` bus, but `src/systems/damage.js` does not
exist. Make that intended front door real rather than adding a melee-only
helper. Minimum hit schema:

```js
CBZ.damage(target, amount, {
  hitId,
  attacker,
  cause,
  kind,
  point,
  impulse,
  nonlethal
});
```

The transaction must:

1. validate target, hit ID, and world point;
2. mutate HP once and return actual applied damage;
3. apply one wound and directional reaction;
4. transfer physical ownership when appropriate;
5. route KO/death through the target's registered lifecycle;
6. publish one structured event for witnesses, crime, UI, and attribution.

Use dynamic registered hooks/events, not load-order wrappers that capture a
function before it exists. Migrate prison player melee and city melee as the
first two real consumers; migrate the remaining direct damage census
incrementally.

Phase-4 exit:

- prison `_phys.down` decreases under normal update;
- root/limbs react in the impact direction;
- actor locomotion is zero while body-owned;
- floor/wall clearance and settling work;
- one hit yields one HP delta, wound, reaction, impulse, and attribution;
- no fixed foot-pivot corpse roll is the primary result.

##### Phase 5 — coordinated, visible melee instead of contact timers

After actor, damage, and body ownership are stable, replace prison
`huntPlayer`/`exchangeBlows` with `CBZ.combatIQ.melee()`.

Extend the existing combat pack with melee coordination:

- stable bearing slots around the target;
- normally one committed striker, at most two in a large brawl;
- token leases released on recovery, death, range, or target change;
- non-token fighters circle, guard, feint, threaten, contain exits, or hold;
- distant gang members become alerted/take positions instead of all targeting
  the player's exact center.

The only damaging sequence is:

```text
close to band
  -> take bearing
  -> guard/circle
  -> visible windup
  -> committed swing
  -> one CBZ.damage event
  -> recover/backstep
```

Remove ordinary inmate proximity writes to `player.stun` and repeating `+4`
heat. Proximity alone changes neither HP, stun, nor heat. A landed strike may
apply short physical hit reaction through the damage/body event. Player crime
heat comes from the player's witnessed assault, not from enemies standing near
the player.

NPC-versus-NPC fighting uses the same state/damage path; delete simultaneous
timer HP subtraction. Guards retain nonlethal capture semantics, but taser and
tackle need readable ready/commit/recover phases rather than an instant contact
write. Hostile contact should normally be prevented by the engagement band;
its safety-net separation must not preserve the present 88%-player shove as the
primary fight mechanic.

Phase-5 exit for an eight-attacker, ten-second probe:

- no more than two committed attackers;
- every HP change has a prior visible windup;
- proximity without a swing changes neither HP nor stun;
- no center pile/interpenetrating attack stack;
- player is movable at least 85% of frames not occupied by a landed hit or
  explicit capture;
- NPC-versus-NPC combat uses the same damage/body owner;
- detection does not grow merely because hostile inmates are close.

Tune damage only after this cadence is real. A slower, readable fighter may need
a different per-hit number; do not preserve the old time-to-KO by reintroducing
invisible cadence.

##### Phase 6 — make parity an executable requirement

Extend audits so city can no longer improve while prison silently remains a
legacy exception:

- `combatIQAudit()` must list prison retaliation and NPC exchanges as required
  consumers;
- actor-schema audit covers every combat-capable population;
- body audit reports registered, active, busy, unsupported, and legacy-rotated
  actors;
- placement audit reports room spills, cross-owner intersections, unsupported
  pickups, and inactive-mode leakage;
- roof audit samples every declared interior host;
- damage audit rejects new direct melee HP mutation;
- source contracts remove stale “open top,” “jail untouched,” and “all
  consumers adopted” claims once code changes.

Final validation:

1. focused source contracts and `node --check` for changed files;
2. repaired sprint fixture and split jail-contact tests;
3. seeded prison-parity browser contract;
4. Escape -> City -> Escape ownership test;
5. `git diff --check`;
6. `npm run build`;
7. live first-/third-person room QA;
8. live group fighting beside walls, furniture, doorways, and corpses;
9. profile the active-body set and placement build cost rather than assuming
   shared code is free.

#### Overall definition of done

Geometry:

- every intended indoor region has a continuous opaque roof;
- no unintended owner-level prop overlap across tested seeds;
- every pickup has an explicit valid support;
- no Escape-scoped physical record participates in another mode.

Combat:

- zero updater exceptions;
- exactly one damage transaction per swing;
- one or two readable committed attackers rather than a gang center-pile;
- proximity is not an attack;
- visible windup precedes every melee HP loss;
- guards visibly commit capture actions.

Bodies:

- the same rig receives the same body ownership rules in prison and city;
- knockdown progresses, suspends locomotion, grounds, collides, settles, and
  gets up or dies through one lifecycle;
- direction/force, not a fixed root roll, determines the physical read.

Architecture:

- one actor position contract;
- one mode-scope predicate;
- one placement ledger;
- one damage event;
- one shared body owner;
- one combat-IQ beat grammar with both city and prison consumers;
- focused executable gates prevent each private legacy path from returning.

#### Explicit non-solutions and holds

Do not:

- “fix” overlaps by moving only the currently visible cones/table;
- add another manual prison obstacle list;
- make roofs transparent, double-sided, or camera-faded instead of building
  them;
- improve the inmate mesh before fixing the lifecycle driving the shared rig;
- paste city ragdoll calls into prison without actor registration and
  locomotion ownership;
- add punch animations on top of the existing proximity stun timer;
- preserve heat pulses merely to keep the old difficulty;
- call a city-only local damage helper from prison and declare parity;
- replace standalone Prison Escape with city pedestrians;
- merge or stage the owner's mixed dirty worktree to recover this handoff;
- close any issue from source appearance alone without the named runtime gate.

Final message from GPT to Claude: the owner is reporting one loss of physical
trust expressed through several surfaces. The room has no roof because the
shell contract permits absence. Props overlap because producers do not reserve
space with one another. Fighters bulldoze and freeze because proximity owns
combat instead of a swing. Bodies look fake because Escape is denied the body
owner despite sharing the rig. Fix the contracts in dependency order, migrate
real consumers, and make the comparison itself executable.


### MESSAGE FROM GPT TO CLAUDE — 2026-07-29 diagnostic issue addendum

> **AUTHORSHIP AND STATUS:** Everything in this subsection — the staffing
> policy, the diagnosis and every numbered item 28–121 — is a message **from GPT
> (Codex) to Claude**. Items 28–107 came from GPT's read-only investigation of
> snapshot `5e76cee`; items 108–121 came from GPT's read-only inspection of the
> current `nukefx.js`/`crashfx.js` working tree on 2026-07-30. It is not
> Claude's prior conclusion, not owner-authored project law, and not a claim
> that any item has been fixed. Claude should retain these as open problems
> until runtime evidence closes them.

GPT to Claude: these are structural ownership problems, not isolated bad NPC
spawns. The prior issue list ended at 27; append the following through 121.

**POLICE VERSUS SECURITY — THE CLASSIFICATION CLAUDE SHOULD PRESERVE**

| Location | Correct staffing |
|---|---|
| Streets, police stations, County Jail | Police, sheriff's deputies, corrections officers |
| Capitol, executive residence, federal bureau | Agency-specific protective police/agents |
| Military bases and Defence Headquarters | Soldiers and military police |
| Airports | Airport police, customs/border officers and civilian screeners; private guards only for private cargo/airline property |
| Ports | Port police/customs at public controls; private guards at private yards |
| Banks, jewelry/gun shops, casinos, corporate towers, arenas and private estates | Private security or bouncers; police respond when called |

The game already declares this distinction correctly at the top of
`city/security.js`: private guards protect high-value businesses while police
remain the city-wide response. Other systems fail to preserve it.

28. **There is no authoritative venue-to-security classifier.** Builders
    independently choose `security`, `cop`, `agent` or `soldier`, so visual
    uniform, arrest authority, faction and combat behaviour drift apart.
29. **The County Jail is directly miscast.** Its `govcomplex.js` definition
    calls for a sheriff and real deputies, then its work row literally requests
    `{ kind:"security", role:"security guard" }`.
30. **The shared occupancy grammar cannot express police, deputies or
    corrections officers.** `occupy.js` offers private security, soldiers and
    Secret Service agents; its generic government preset fills ministries with
    Secret Service agents.
31. **City Hall uses that generic agent preset.** Its lobby receives two
    Secret Service-style agents rather than an appropriate municipal
    law/civic-security assignment.
32. **Restricted government compounds default to generic security guards.**
    Bureau Headquarters and Defence Headquarters are not cleanly differentiated
    into federal agents versus soldiers/military police.
33. **Every lawful principal's protective detail collapses into the ordinary
    city cop spawner.** A mayor, sheriff, governor, president or federal
    director can consequently receive the same municipal police type.
34. **Ambient guards are generated as civilian residents across entire
    districts.** Cape Harbor's supposed customs staff, Foundry “foremen,”
    financial-district guards and several national-capital guards are detached
    from actual protected posts (`regionlife.js`).
35. **Airports and ports lack a complete authority taxonomy.** There is no
    deliberate split between police, customs, screening staff, harbour
    operations and private-property guards.
36. **Existing staffing audits measure adoption and headcount, not
    correctness.** `occupyAudit()` and `powerAudit()` can report “guarded”
    while the body belongs to the wrong organization.
37. **Yachts exist physically but never enter the map's POI registry.**
    `yachts.js` defines three superyachts and thirteen working boats.
38. **The map only extends 90 metres beyond surveyed land.** The yacht
    roadstead searches at least four kilometres offshore, putting vessels
    outside the chart projection (`fullmap.js` versus `yachts.js`).
39. **There is no yacht, boat, marina or anchorage map symbol.** The POI funnel
    only understands recognized land lots and shops.
40. **At deep zoom, yachts degrade into anonymous white car dots.** At normal
    world-map zoom, vehicle dots are not drawn at all.
41. **Yacht and map audits are disconnected.** `yachtAudit()` can prove
    vessels are afloat while `mapAudit()` cannot detect that none are charted.
42. **The visible ocean is only a camera-centred 4.5 km-radius disc.** The
    airborne camera now sees at least 7 km; `water_spec.js` still documents the
    old approximately 2.8 km flight view.
43. **The horizon fade completes beyond the geometry.** `world.js` fuses from
    3.6–6.4 km, but the mesh ends at 4.5 km — only about 24% fused into the sky
    when the triangles stop.
44. **The ocean's bounding box falsely claims 16 km coverage.** Its vertices
    still stop at 4.5 km, but `water_spec.js::stampBounds` manually enlarges the
    bounds, so `test-terrain-water-browser.mjs` can pass without measuring the
    real rim.
45. **Shader and reflective ocean modes do not share the same explicit horizon
    fuse.** Quality changes can therefore alter how visible the seam is.
46. **The ocean has no geometric horizon solution.** It is a finite flat disc
    with fog — no curvature, horizon skirt or distant continuation.
47. **The codebase has several incompatible “ocean bottoms.”** The rendered
    `terrain_overhaul.js` shelf ranges roughly from -1.8 to -26 m, gameplay
    bathymetry ranges from 1.1–62 m, and `water_spec.js` documentation claims
    open water is 400+ m deep.
48. **The rendered shelf is decorative and fixed in world space while the
    ocean follows the camera.** Offshore portions of the moving sea disc can
    therefore extend beyond the visual floor. Physics cannot query the rendered
    shelf.
49. **Swimming clamps the player to an invisible numerical bed while ordinary
    physics still sees a phantom flat floor at `y=0`.** `water_underwater.js`
    explicitly assumes there is no seabed and never projects its caustics onto
    the shelf that does exist.

**LIVE ANIMAL CONTACT — DEATH PHYSICS IS NOT BODY PHYSICS**

50. **Dogs explicitly declare that they have “no physics or colliders.”**
    `dogs.js` uses one light direct-transform update loop; registering a dog in
    `CBZ.cityWildlife` only makes it shootable and routes damage back to the dog
    owner.
51. **The wildlife registry is being mistaken for a physical-actor registry.**
    Dogs enter it as `external:true`, so `wildlife.js` deliberately does not
    drive them, and neither registry membership nor a hit handler grants body
    contact.
52. **Dog locomotion bypasses the shared wall resolver.** `dogMove()` writes the
    group's X/Z position and floor-snaps Y without calling `CBZ.collide()` or
    `CBZ.collideSlide()`. A live dog can consequently cross the player and
    static architecture even though its corpse later has excellent quadruped
    physics.
53. **Ordinary land wildlife has the same omission.** `landWalk()` directly
    integrates the animal transform and clamps it to home and terrain; it does
    not ask the collider grid. This is an animal-wide live-locomotion problem,
    not a dog model problem.
54. **The satisfying human bump and knock-over behaviour is a private crowd
    pass, not a shared actor capability.** `crowd.js::bumpPass()` considers the
    player, named peds and instanced crowd agents, promotes victims to real rigs
    and calls `CBZ.body.knockdown`; it never considers `cityWildlife`.
55. **Wildlife “separation” is steering, not collision.** Herd spacing changes
    desired headings before direct integration. It cannot resolve a player
    overlap, decide which body yields by mass/speed, or turn a hard impact into
    a knockdown.
56. **Animal physics exists only at dramatic events.** Attacks can apply body
    impulses, cars can hit animals, and death can promote them to ragdolls, but
    there is no continuous live-body contact in between. That fragmentation is
    why the spectacular cases work while walking through a dog does not.
57. **No actor-body audit can expose this exclusion.** The code measures
    wildlife motion, deaths and car impacts, but nothing enumerates player,
    human, dog and wildlife movers and proves that each participates in static
    collision, mutual contact, mass yielding and knockdown.

**INTERIOR COLLISION AND RPG RESPONSE — EXTENDING ISSUES 17–27**

58. **The shared explosion's receiver list excludes ordinary room geometry.**
    `crashfx.js::applyBlastDamage()` visits people, the player and explicitly
    registered structural pieces; generated partitions, desks, chairs, shelves
    and loose decorative props are not blast receivers, so they cannot fly or
    break when an RPG detonates beside them.
59. **Building damage resolves to an exterior building ledger, not the object
    that was hit inside the room.** The fracture path can carve a facade,
    shatter registered building panes and lower a building's health, but it
    does not identify a particular interior wall or furnishing.
60. **Generic concrete chunks disguise the missing object transition.**
    `cityDamageBuilding()` can emit rubble cubes, yet the original interior
    mesh remains static and unowned. Debris that was never the desk, wall or
    shelf is an effect, not destruction physics.
61. **Even furniture that opts into solidity receives only a static collider.**
    `CBZ.furnish` defaults building-host furniture to non-solid unless the
    caller explicitly passes `solid:true`, and the solid path still supplies no
    mass, break threshold, impulse response or destroyed state.
62. **The missing foundation is one physical-prop contract.** A meaningful
    room object needs one record joining visual mesh, collision/LOS footprint,
    mass, break threshold, blast impulse, debris or hidden-state transition,
    restoration and persistence. Today those concerns belong to unrelated
    ledgers or do not exist.
63. **The current audits can be green while every room fails.** `blastAudit()`
    measures which payload uses the explosion bus, and `solidityAudit()` is a
    hand-maintained census dominated by exterior prop classes. Neither measures
    blast-receiver coverage or generated interior collider coverage.

**MISSING HEAVY ROAD VEHICLES**

64. **The main vehicle catalogue contains no bus, fuel tanker or refuse
    truck.** It offers ordinary cars, vans, pickups and SUVs; none of the three
    requested heavy classes can spawn as traffic, be stolen or enter the common
    damage/cook-off lifecycle.
65. **The game's “bus” is split between a static prop and an abstraction.**
    `southblock.js` draws one parked transport bus from boxes behind one AABB,
    while `activities.js` sells bus travel as fare/event logic. Neither is a
    `cityCars` vehicle, route actor or drivable passenger space.
66. **A fuel truck exists only as an airport-minigame prop.** The separate
    `games/airport.js` scene knows the noun, but Gang City has no tanker, no
    volatile cargo record and no energy-based cargo blast to connect it to the
    otherwise strong vehicle cook-off and ordnance systems.
67. **Sanitation has people and trash but no service vehicle or route.**
    Garbage-related jobs and world props exist without a garbage truck that can
    drive a shift, collect a stop, carry workers or become a stealable object.
68. **Ambulances and fire engines prove the correct adoption seam.** They are
    authored geometry, then passed through `CBZ.cityRegisterVehicle()` to
    become ordinary solid, damageable, enterable city vehicles. New heavy
    classes should use that seam rather than inventing another controller.
69. **There is no reusable heavy-chassis grammar.** Wheelbase, multiple axles,
    cab, box/tank/body module, passenger or cargo sockets, service route and
    cargo hazard are still bespoke concepts. Without that block, each requested
    truck becomes another large one-off file.

**FIRST-PERSON VEHICLES AND COCKPIT OWNERSHIP**

70. **Cars are structurally forbidden from first person.** `city/view.js`
    rejects `[V]` while `player.driving`, and `camera.js` forces all road
    driving through the chase camera. This is not a missing dashboard texture;
    the view state cannot be entered.
71. **Boats inherit the same prohibition.** Marine craft use the same
    `driving/_vehicle` state as cars, so the camera never offers a first-person
    helm even when the boat model contains a visible wheel or console.
72. **Aircraft have one substantial cockpit-overlay system and a second set of
    cockpits embedded in airframes.** `cockpit_shapes.js` builds the active
    first-person costume while player-aircraft, strategic bomber, military and
    airport builders separately add tubs, seats, pilots, panels, MFDs and
    consoles behind their exterior glass. The two views double-author the same
    cabin without one shared seat/socket description.
73. **The current 40-mesh cockpit budget encourages the interior slop the owner
    wants removed.** The owner's target is a simple readable shell: genuinely
    transparent panes, a few derived geometric surfaces, painted instruments
    and the crew's outfit. More boxes are not more cockpit.
74. **Road-car cabins are exterior set dressing, not a usable cockpit.**
    `vehicles.js` adds seat backs, a rear bench, a dash slab and wheel so
    see-through windows are not empty, but those parts do not define an eye
    position, sightline, controls or first-person clipping envelope.
75. **The shared capability should be a vehicle seat view, not separate car,
    boat and aircraft cameras.** It must derive eye position, forward axis,
    near-plane/sightline, window bounds and minimal cabin recipe from a seat
    socket so every registered vehicle can adopt the same view contract.

**IPAD/TOUCH CONTROLS, BOARDING AND PLAYER INTERACTIONS**

76. **The touch layer exists but is classified by a hard-coded vehicle enum.**
    `touch_vehicle.js` knows `drive`, `heli`, `wing`, `chute` and `swim`;
    boats collapse into `drive`, and a new bus or tanker gains no specialized
    controls by describing what it can actually do.
77. **Important vehicle verbs have no iPad surface.** The B-2's bomb
    tap/hold, payload cycle and bomb camera are keyboard-only; tanks use a
    separate lifecycle; road/boat layouts lack a view button; and door,
    secondary-fire, horn and utility actions are not represented by a common
    capability matrix. Touch `FIRE` only calls the aircraft missile action.
78. **Boarding looks unified at the key prompt but remains three state
    machines underneath.** `cityTryNearestRide()` routes aircraft, ordinary
    road/marine `_vehicle` objects and armour/tanks into different enter/exit
    ownership. New vehicles can be stealable through `cityRegisterVehicle()`,
    but controls, cameras and lifecycle still drift after entry.
79. **The interaction UI intentionally hides most single-action ride cards.**
    That keeps streets uncluttered, but it also means a player cannot discover
    doors, seats, cargo, passenger capacity, payloads or alternate vehicle verbs
    from a consistent interaction surface.
80. **Remote players are not interaction candidates at all.** Net actors exist,
    display names, occupy vehicles and participate in combat, while
    `interactions.js` has a multiplayer-shaped context but no source over
    `CBZ.netRemoteList`. Trade, invite/recruit, inspect, revive, restrain,
    surrender and other player-to-player choices therefore have no UI or
    authoritative network verb path.

**SEE-THROUGH AND BREAKABLE VEHICLE GLASS**

81. **One glass material is not one glass system.** Vehicle panes now use the
    same transparent material recipe as buildings, which fixes appearance, but
    they do not enter the building pane registry that owns bullet holes,
    shattering, openings, shards and reset.
82. **The building glass registry cannot simply be reused unchanged.**
    `cityGlass` stores static world-coordinate pane records; a window parented
    to a moving car, bus, boat or aircraft needs local coordinates or a live
    transform callback before ray hits and blast bounds can remain correct.
83. **`glassAudit()` measures tint and crash-frost compatibility, not breakable
    adoption.** Vehicle crash deformation swaps glass to a crazed/frosted
    material but does not remove the pane or create a traversable opening.
    Every visible pane can therefore look shared while none behaves like
    building glass.

**THE AC-LOOKING BOXES STILL OUTSIDE WINDOWS**

84. **Under the checked-in defaults, the old facade AC producers are genuinely
    disabled.** Both punched-window and residential-tower units require
    `FACADE_AC_UNITS === true`, whose default is false; the older
    `building_dress.js` boxes were also removed by the prop-purge pass. A current
    screenshot of repeated boxes is therefore not explained by those emitters
    unless runtime config or stale cached code re-enables them.
85. **The strongest live code match is the `balconyWindow` facade terminal.**
    On residential buildings it is selected for up to 24% of upper-floor bays
    and emits a shallow grey `TRIM` slab 0.55 m outside the glass plus a narrow
    rail. From street distance or an oblique angle, that little projecting
    rectangle can read exactly like an AC condenser. This is the likely owner,
    not a runtime-proven identification; label the visible mesh before cutting
    it.
86. **The AC audits are blind to AC-looking non-AC geometry.**
    `cityFacadeStats().ac` and `propPurgeAudit().acBoxes` count the retired AC
    paths, not `balconyWindow` terminals, balcony slabs, sill/header reveals or
    misplaced glow panels. They can correctly report zero while many facades
    still exhibit the owner's symptom.

**THE DRIVE-BY IS A REAL RECORD WITH A SCRIPTED GHOST DRIVER**

87. **The existing “THE DRIVE-BY IS A REAL CAR” doctrine overclaims what was
    completed.** `gangs.js` now creates a genuine `cityCars` record and genuine
    `cityPeds` occupants, so damage, theft, suspension and seated-hit plumbing
    can see them. Its locomotion is still a private scripted controller. Real
    identity is not real driving physics or navigation.
88. **`roadPointOpen()` does not answer whether a point is on a road.** It only
    rejects keep-outs and water. `spawnRealDriveby()` treats that result as a
    legal “road edge,” so a car may be staged on grass, a lot, behind a building
    or on any other dry non-reserved point.
89. **The drive-by explicitly opts out of ordinary traffic routing.** It sets
    `car.road = null`; the ordinary road brain consequently skips it.
    `car.ai = true` preserves some vehicle/occupant lifecycle behaviour but
    does not give the driver a lane, route, intersection choice or road graph.
90. **The private driver continuously beelines toward a raw target point.**
    `dbSteer()` aims directly at the player or lot centre and integrates X/Z.
    It never asks for a road segment or a route around a building. A wall
    between car and target therefore remains the commanded direction forever.
91. **Collision correction is discarded as information.** `dbAdvance()` calls
    `cityCollideVehicle(car)` after integrating but ignores its returned
    displacement. It does not brake, reverse, choose a persistent side or
    replan. On the next frame `dbSteer()` turns back into the same obstruction,
    producing grinding, corner slipping and the visual impression that the
    event car drives through buildings.
92. **The shared vehicle-wall resolver is not the oriented chassis solver its
    comments call it.** `vehicles.js::collideVehicle()` resolves a width-derived
    circle plus one forward circle probe. Its anti-tunnel segment is capped at
    eight samples. That is useful depenetration, but it does not prove that a
    long rotated body cannot cut a corner or pass a thin wall between samples.
93. **The source says the occupants are real; the owner's observed result says
    that claim still needs runtime proof.** The normal path uses `gangPost()`,
    stores crew in `cityPeds`, attaches them through `npcLife`, and makes a dead
    shooter stop firing. A legacy mesh with numeric “crew flavour” still exists
    when `DRIVEBY_REAL` is false or a required factory is absent. Do not resolve
    the disagreement by trusting comments: identify the live drive-by record and
    prove that each visible occupant is a hittable ped in the canonical ledger.
94. **No drive-by audit measures the properties the player is reporting.**
    Keep-out/trespass counts cannot prove road placement, route ownership,
    obstacle replanning, collision response, or that every rendered occupant
    maps one-to-one to a living ped. The current doctrine can therefore report a
    “real car” while its movement still reads as a ghost event.

**CASINO SQUIRM AND INDOOR NPC MOBILITY**

95. **“Casino people” are two structurally different actor classes with two
    different failures.** The Golden Ace creates three `post:"ambient"` patrons
    with the ordinary resident brain, while its dealers, cashier, guard, pit
    boss and shark are `post:"pinned"`. Generic city casinos likewise declare
    hard posts through `cityStaffPost()`. One group is told to wander out of
    the room; the other is forbidden to move even when movement is necessary.
96. **An ambient casino patron inherits an outdoor, whole-city routine
    generator.** `pickRoutineGoal()` can choose a shop door, an arbitrary lot or
    `randomSidewalkPoint()`, then makes at most a coarse two-hop intersection
    path. It neither confines the goal to the venue nor proves it reachable
    from the current room, so a patron standing inside can be ordered toward a
    target straight through a casino wall.
97. **The shared route helper handles only one direction of a doorway.**
    `cityNav.routeTo()` detects a goal inside a building and threads an
    outside actor through that building's door. It does not detect an actor
    starting inside whose goal is outside. That asymmetric contract cannot
    carry the casino's ambient patrons from the gaming floor to the street.
98. **The reported rapid right-left flip matches a weakness in local context
    steering.** The active-ped kernel chooses among eight direction slots,
    admits only directions within `0.001` of the current minimum danger, and
    blends just 30% of the previous direction. In a tight, roughly symmetric
    aisle, tiny changes in wall or neighbour distance can alternate which side
    is the minimum while the impossible through-wall goal keeps pulling
    forward. This is a code-supported diagnosis, not yet a runtime trace; log
    chosen slot, danger map and heading reversals on one filmed patron to close
    it.
99. **The stuck detector changes the instruction without solving indoor
    reachability.** After 0.45 seconds of failed progress, a calm ped discards
    its path and draws another global routine goal; a fighter or fleeing ped
    draws a random left/right six-metre sidestep. Neither recovery asks which
    door connects the room to the destination or commits to one side until an
    obstacle is cleared. It can therefore restart the same failure indefinitely.
100. **Steering memory survives goal changes.** `_prevSteerX/Z` are initialized
     once and thereafter only overwritten by context steering; routine
     repicks, path shifts and stuck recovery do not clear or rebase them. The
     first frames of a new instruction can consequently be blended toward the
     direction chosen for the discarded instruction.
101. **Pinned casino staff are structurally unable to flee through the normal
     brain.** `think()` returns to `staffThink()` before ordinary threat logic;
     `staffThink()` clears `rage`, `finalGoal` and `path`, forces `idle`, and
     restores the post target. A package staff member can surrender at gunpoint,
     but cannot autonomously run from gunfire, an RPG, a fire or an attacker
     while `staffPost` remains set.
102. **Pinned staff also skip physical depenetration.** `move()` returns from
     the `staffPost` branch before `CBZ.collide()` and before the three-pass
     corner resolver. This contradicts the nearby comment that posted staff
     “still collide.” A poorly placed post or an object moved into the station
     can leave the body embedded with no locomotion pass capable of freeing it.
103. **Calling the shared fear decision does not reliably release a posted
     worker.** `cityScare()` may set a fleeing path, but it does not clear
     `staffPost`; the next staff think erases that path and the movement branch
     remains rooted. The few systems that can release staff do so with private
     `staffPost = null` writes, so casino evacuation is not an owned capability.
104. **There is no indoor-mobility audit or post lifecycle.** The missing
     contract is: hold an authored station while calm; on qualifying danger,
     release the station, choose the building's real exit, navigate with a
     committed obstacle side, remain mobile while threatened, then return or
     re-staff after an all-clear. Measure unreachable indoor goals, heading
     reversals without progress, time stuck, doorway use and pinned actors that
     fail to evacuate. A headcount audit cannot see the casino squirm.

**NUKE DEATH ATTRIBUTION LOSES THE WEAPON**

105. **A nuke kill is labelled correctly only in the innermost path.**
     `strategic.js` directly kills an unsheltered player inside the fireball
     with reason `"caught in a nuclear blast"`. `killfeed.js` recognizes
     `nuclear|nuke|atomic` before generic blast wording, so that path becomes
     `nuclear blast` rather than `explosion`.
106. **The expanding nuke wave throws away the identity it still has.**
     `impactbus.js::sweepRing()` branches on `w.kind === "nuke"` but sends the
     player reason `"caught in the blast wave"` and sends named-ped deaths as
     `"the blast wave"`. Neither string contains `nuke`, `nuclear` or `atomic`;
     `killfeed.js` consequently normalizes both to generic `explosion`. The
     WASTED subtitle likewise uses the raw generic wave phrase. Distance from
     ground zero, rather than weapon identity, currently decides what the same
     nuke is called.
107. **Death attribution needs the ordnance identity as data, not prose
     inference.** The nuke row, queued wave and detonation options already know
     `kind:"nuke"`, `byPlayer` and `by`, but `cityHurtPlayer()` receives only a
     reason string and `attacker:null` from the wave. Carry a canonical
     cause/weapon kind through the kill bus and render this exact owner-facing
     label as **NUKE** for player, named-ped and crowd deaths. Do not repair this
     by adding another regex for `"blast wave"`; that phrase is shared by
     non-nuclear ordnance.

**THE NUKE FLASH IS A GOOD BEAT; THE CLOUD HANDOFF IS NOT**

108. **Do not “fix the smoke” by deleting the white flash dome.** The dome is a
     separate, coherent first beat: one 450-triangle hemisphere, normal-blended
     rather than additive so it silhouettes the skyline, seated on the ground,
     and retired after roughly 1.5 seconds. The blocky smoke begins in the
     handoff behind it, not in this mesh.
109. **Three unrelated smoke grammars own the same seconds.** `nukefx.js` draws
     kilometre-scale instanced icosahedron lobes, five procedural detail planes
     and one far mushroom impostor; it simultaneously calls `crashfx.js` for
     ordinary RPG-style explosions, wreck smoke and dust sprites. They have
     different shapes, opacity laws, scales and lifetimes, so the image cannot
     read as one evolving physical cloud.
110. **The timeline combines dimensions from different ages of a nuclear cloud.**
     `nukeDims()` uses a stabilised 20 kt cap (about 5.1 km wide, 4.0 km thick
     and 10 km tall), the stem ratio is explicitly taken from a “tens of
     seconds” tower photograph, and the base-surge note cites a one-minute
     measurement. All are compressed into a 34-second sequence whose cap begins
     appearing at 0.55 seconds. The numbers may each have a source, but they do
     not describe the same moment.
111. **The far tier skips the mushroom's formation.** Its single baked texture
     already contains the final dust base, twisted stem, collar, crown and
     mature cap. `stepImpostor()` starts that complete silhouette at
     `0.30 * 10 km` even when rise is zero, then merely scales it. By the white
     dome's 1.47-second exit it is about 3.46 km tall and almost fully faded in;
     by 1.7 seconds it is about 3.87 km tall and fully owns the cap. The player
     sees a mature mushroom switched on after the flash, not a buoyant fireball
     becoming one.
112. **The far mushroom is literally a magnified card of circles.**
     `makeMushroomTexture()` bakes every base, stem, skirt and cap lobe as a
     radial-gradient canvas circle into one 256x512 texture. One fogless plane
     at 86% of the camera far distance is then made to face the camera from
     every view. Scrolling noise changes surface grain, but not the macro
     silhouette, depth, underside or phase. From a B-2 or from underneath, the
     code itself admits that the card shows the wrong side.
113. **The near cloud's “volume” is hard low-poly geometry.** Every cold cap,
     crown, collar, stem and ground-surge lobe is the same
     `IcosahedronGeometry(1,1)` — only 80 triangles — with
     `flatShading:true`. At full nuclear scale a central cap lobe can be roughly
     0.7–1.0 km in radius, so individual facets are city-block sized. Lambert
     lighting makes those facets more visible; it does not make them smoke.
114. **Those lobes render as overlapping opaque rocks, not participating
     density.** The cold materials use opacity 0.88–0.97 with
     `depthWrite:true`, and all instances in a field share one material and one
     draw. Their intersections therefore hard-occlude in draw/depth order;
     there is no per-instance transparency sort, internal extinction, soft
     depth, or volume noise. A few billboard textures laid over them cannot
     hide the solid polygon silhouette from every camera angle.
115. **Lower quality makes the geometric failure louder.** Physical dimensions
     never shrink, while cap/stem/surge/crown counts fall from 28/16/34/26 to
     12/8/10/10. The surviving low-poly lobes must span the same kilometres, so
     the cloud becomes fewer, larger, more isolated solids. This is a valid
     performance rule for many effects, but the wrong LOD rule for smoke.
116. **Every detonation reuses the same cloud body.** `VOL_SEED` is generated
     once and reused forever, and the far mushroom texture is baked once from
     the same module-level deterministic stream. Lobes move and circulate, but
     the macro crown, stem, skirt and cap distribution recur in the same places
     at the same age. A second nuke is the first nuke's sculpture replayed.
117. **The handoff is flooded with nineteen ordinary explosions at full
     quality.** Six power-2.4 satellites fire from 0.22–0.67 seconds, four
     power-1.9 satellites fire from 0.95–1.31 seconds, and nine power-1.1
     “thermal receipts” fire from 0.9–2.02 seconds. `cityExplosion()` asks for
     97, 85 and 50 individual puff sprites respectively at those powers; the
     thermal receipts add 36 wreck-smoke sprites. That is about **1,408 puff
     spawns** exactly while the dome is yielding to the mushroom. Reusing the
     RPG look here does not enlarge one nuclear event; it superimposes nineteen
     conventional events.
118. **The walking shock-front dust adds roughly another five hundred smoke
     sprites.** For up to 7.5 seconds, full quality calls as many as three
     `cityDustKick()` bursts every 0.3 seconds; each call creates about seven
     smoke sprites at the nuke's requested power. Across the scheduled
     explosions and this walker, the first nuke can request roughly **1,900
     sprite puffs**. `crashfx.js` prewarms only 64 and has no puff cap:
     `getPuff()` allocates a new `Sprite` and material whenever the pool is
     empty. “Pooled and capped” is true of the point-burst ring, not of this
     sprite cloud.
119. **Thermal smoke is not attached to anything that is actually burning.**
     The comments promise visible receipts “wherever combustible things exist,”
     but the receipt positions are area samples with no structure, vehicle,
     vegetation or fuel query. Each sample unconditionally launches a complete
     ground explosion and four crash-smoke puffs. Smoke can therefore bloom
     from empty pavement or water as a decorative token instead of being an
     aftermath of world damage.
120. **The existing nuke audit cannot see any of these visual failures.**
     `nukeFxAudit()` asserts radii, ratios, layer presence and headline timing;
     `nukeFxDebug()` prints counts and the current tier. Neither measures
     phase-appropriate silhouette, angular lobe/facet size, peak live puffs,
     allocation beyond the prewarm pool, duplicate smoke owners, smoke without
     a burning source, or whether the impostor depicts the same age as the 3D
     cloud it replaces.
121. **The eventual contract is one evolving event, not more smoke layers.**
     Preserve the flash and white dome. After them, one nuke-FX owner must carry
     a phase-specific chain — rising fireball, entraining stem, forming cap,
     cooling cloud, then aftermath — without calling the full generic
     `cityExplosion()` visual recipe inside itself. Smoke away from ground zero
     must come from actual burning world objects. Prove the handoff by recording
     the active owner, phase, apparent cloud bounds, largest lobe/facet, live
     sprite peak and unsourced-smoke count at each beat.

GPT's conclusion to Claude: the owner's observations are correct. Guards lack
institutional meaning, yachts are built but effectively uncharted, and the
ocean surface, horizon, rendered floor and gameplay depth are four systems
pretending to be one. Animal contact is event-only rather than body-wide;
interiors are drawn without a physical-prop receiver contract; heavy vehicles,
seat views, touch capabilities, boarding state and breakable glass stop being
shared immediately below their surface APIs; and the facade audit does not
measure the AC-looking geometry the owner still sees. The drive-by has canonical
identity but private beeline locomotion, while indoor actors alternate between a
whole-city outdoor brain and a hard post that danger cannot release. The nuke
bus also knows its weapon identity but reduces some deaths to generic explosion
prose at the final handoff; its otherwise strong flash then hands the image to a
premature mature-cloud card, hard low-poly lobes and nearly two thousand generic
puff requests. Do not close this message by improving only a visible symptom.
Each eventual change must restore one authoritative owner and add a cross-system
measurement capable of proving the classification, contact, navigation,
attribution, phase or geometry is actually shared.

#### FINAL GPT-TO-CLAUDE CONVERGENCE HANDOFF — 2026-07-31

This is GPT's final integration judgment before the conversation closes. It is
not issue 122, not another feature pitch, and not permission to execute items
28–121 from top to bottom. The durable decision record is
`docs/plan/claude-issue-convergence.md`; read that file before selecting work.
It contains the provenance audit, current gate evidence, fourteen normalized
workstreams, dependency overlaps, six phases, explicit holds, and a coverage
row for every available issue number. It was first published as documentation
only in commit `03d7e91` on branch `agent/claude-issue-convergence`.

##### GPT's actual read of the project

This is a powerful game engine with integration debt, not a weak game that
needs 121 more features. A surprising amount is already real: registered
vehicles, staffed interiors, wildlife, damage buses, door routing, factions,
posts, maps, water queries, glass recipes, nuclear phases, and broad live
audits. The recurring defect is that a feature adopts the shared surface while
keeping one decisive behavior private.

That pattern is **superficial sharing**:

- the drive-by is now a real registered car, but its driver still owns a
  private beeline;
- a dog is registered wildlife and has dramatic hit/death physics, but live
  locomotion never joins continuous body contact;
- glass shares a material recipe, but a moving pane lacks one transform-aware
  break lifecycle;
- a venue is staffed, but the body can belong to the wrong institution and a
  pinned post can suppress fear, routing, and depenetration;
- an interior is furnished and may be solid, but the struck desk or wall is
  not one damageable physical object;
- the nuke bus knows `kind:"nuke"`, but downstream death presentation still
  relies on phrases;
- the ocean is visible, queryable, swimmable, and chart-adjacent, but those
  truths do not describe the same surface, horizon, floor, or bounds.

These are **trust seams**. The player notices them as “that guard is wrong,”
“I walked through the dog,” “the dealer just wiggles,” “the RPG did not hit
the desk,” “the car drove through the world,” or “the nuke became smoke
effects.” Fixing those visible betrayals is worth more than adding another
district, vehicle noun, or UI surface.

The answer is not a universal ECS, physics rewrite, or new framework layer.
Most canonical owners already exist. Extend the narrow owner that is closest
to the truth, make adoption replace code a caller already writes, migrate real
consumers immediately, and measure the private paths that remain. An
abstraction with no migrated consumer is not architecture; it is another
parallel ledger.

The owner's broader quality bar remains binding:

- grounded, diegetic, and physically readable beats floating UI and fake
  reaction;
- shared capability work must make that capability better everywhere;
- NPCs should mostly be combinations of behavior, outfit, organization, post,
  and interaction—not bespoke species of controller;
- casual interaction choices stay binary unless there is a real third verb;
- on touch, visible controls must express available verbs, every modal needs a
  tappable close, and UI touches must not leak into look/joystick gestures;
- on-foot first-person feel is protected;
- “more meshes,” “more smoke,” and “more systems” are not quality metrics.

##### What is current and what is historical

Do not treat every confident sentence in this file as current evidence.
`CLAUDE.md` mixes constitution, owner contracts, dated session reports, and an
issue register. Those have different expiration rules.

- Items 28–107 were diagnosed at clean snapshot `5e76cee`.
- Items 108–121 were diagnosed against the then-current nuclear-FX worktree.
- The referenced items 1–27 were not found in this file or the searched git
  history. Do not reconstruct them from imagination.
- The detailed roadmap was written against `5e76cee` plus the later worktree.
  Its statuses are a dated baseline, not automatic truth after a new commit.
- `origin/main` at this handoff is `066aba8`. Commits `97838b9` and `066aba8`
  contain the nuclear formation/puff/attribution and coherent-cloud work.
  Preserve those changes as candidate solutions; do not restart the nuke from
  the older diagnosis.
- The current nuclear phase contract reports one coherent post-flash draw,
  zero solid-lobe fields, zero detail planes, and zero generic nuclear puff
  events. That is strong static/arithmetic evidence, not near/far/aerial/
  underside visual sign-off.
- Nuclear wave paths now pass “nuclear blast” rather than generic explosion
  prose. This is progress on 105–107, but the owner asked for the canonical
  display **NUKE**, and identity is still normalized from text. Treat the
  cluster as partial until structured ordnance identity survives the complete
  death bus and the rendered label is proven for player, named-ped, and crowd
  deaths.
- The facade side-box producer appears removed and the structural census can
  report zero. That is a candidate close only until the reported street view
  is filmed and any remaining symptom is traced to its actual mesh producer.
- Touch driving now distinguishes boats and road cars better, but a hard-coded
  mode enum is not the final capability contract and road/boat view verbs
  remain incomplete.
- The cockpit prose target and the enforced mesh cap disagree (`26` versus
  `40`). Source plus executed ratchet wins over prose until deliberately
  reconciled.
- The loyalty-and-weapons spine already exists in `city/loyalty.js` and has
  live adoption. Protect and extend it; do not schedule a second ledger.

The canonical gate was rerun on 2026-07-31 in the isolated documentation branch
based on `origin/main` at `066aba8`. It built the complete title-screen world
(318 lots, 180 shops, 202 roads, 648 named peds), completed 400 ticks, and
failed the same seven checks recorded by the roadmap. Five are product
failures: venue staffing, dry fishing spots, ground-query disagreement,
invalid FX materials, and one road prop beyond an already non-zero debt. Two
are likely stale calibration: 202 roads versus 178 and the
intentional-looking `annex` biome absent from the golden set. The red first
seed correctly prevented determinism and seed 1337 from running. Reproduce
again before changing code, fix the five real failures, verify the two world
changes, and only then recalibrate. Never make a real failure green by raising
its tolerance.

##### Collapse the issue list into owners, not tickets

The numbered symptoms collapse into this dependency spine:

| Foundation | Available issues | Authoritative question |
|---|---:|---|
| Truth and evidence | provenance, gate, stale census | What is failing now, under which exact source and seed? |
| People, place, authority, post | 28–36, 95–104 | Who works here, for whom, with what authority, and how do they leave/return through a real door? |
| Continuous physical presence | 50–63, 81–83, 92 | Which live body or object owns motion, contact, damage, break state, reset, and persistence? |
| Registered vehicle spine | 64–94 | Which capabilities, seats, views, panes, cargo, driver, and route derive from the vehicle record? |
| Maritime spatial truth | 37–49 | Do chart, rendered surface, horizon, water query, seabed, swimming, and caustics describe one place? |
| Structured ordnance event | 105–121 | Does weapon identity and one phase owner survive from detonation through death and aftermath? |
| Long-tail duplication | existing censuses | Which private implementation can be retired while a current capability batch is already touching it? |

Some clusters share foundations but should still use narrow adapters. Live
actors need contact during motion; physical props need an owned lifecycle;
moving panes need that lifecycle in local transforms; vehicle chassis need an
oriented footprint and collision feedback. This does **not** require one global
physics object type. Likewise, authority and post lifecycle belong in one
people/place chain without creating a second venue registry.

##### Order of work

1. **Restore truth.** Classify the dirty worktree into conceptual bundles;
   reproduce and make the canonical gate green on seeds 90210 and 1337; resolve
   stale claims; and close candidate fixes with runtime evidence.
2. **Fix people/place/post ownership.** Derive institutional staffing from the
   protected site, prove County Jail/City Hall/federal-or-military/private
   consumers, make doorway navigation bidirectional, and give calm posted
   actors a danger → exit → all-clear → return lifecycle.
3. **Add continuous physical presence through narrow owners.** Prove static
   collision and mutual contact for humans, dogs, and ordinary land wildlife;
   then prove that the specific desk, wall, shelf, or pane struck owns its
   visual/collider/damage/break/reset state.
4. **Converge registered vehicles.** Derive capabilities and seat sockets,
   then views/touch/boarding, common road-driver ownership, moving panes, and
   only afterward the bus/tanker/refuse consumers. Remote-player interaction
   remains a separate network-authority batch.
5. **Reassess before large maritime or nuclear work.** Charting existing
   vessels is a cheap honest improvement; full ocean spatial truth is not.
   Preserve the current coherent nuclear patch, fast-track the small structured
   cause/display gap, and require live visual/performance evidence before
   spending a large wave on the cloud.
6. **Resume expansion only after the foundations it would multiply are
   shared.** Use the duplication census as a ratchet queue, not as one
   repository-wide abstraction project.

There are two intentionally cheap fast tracks after the gate is trustworthy:

- carry the nuke's structured kind to the exact `NUKE` presentation and test
  direct fireball plus expanding-wave deaths;
- register existing yachts/berths/anchorages in the map's real POI/bounds
  funnel without pretending that this completes the ocean.

Do not allow those fast tracks to become a nuke rewrite or an ocean rewrite.

##### The player-trust acceptance stories

Use these as the clearest “is the architecture real?” reads. They are end-to-end
stories, not a demand to mix unrelated changes into one commit:

1. County Jail visibly fields deputies/corrections staff with the right
   organization and authority, not generic private security.
2. The player and a live dog cannot occupy the same body; a hard contact yields
   or knocks down according to the shared motion rule.
3. A Golden Ace dealer or guard holds a real post while calm, exits through the
   real door under qualifying danger, remains collidable/mobile, and returns or
   is re-staffed after all-clear.
4. An RPG beside a named room object changes that object's collider, LOS,
   visual, damage, debris/hidden state, reset, and persistence together; loose
   generic rubble is not accepted as proof.
5. The drive-by uses the common road/driver owner, replans, collides through the
   registered chassis contract, and keeps driver/shooter/body/vehicle identity
   correct when an occupant dies.

If these stories work only in their showcase file, the owner is still private.

##### Proof and closure protocol

An issue is not closed because the code looks right, an audit function exists,
or a build succeeds. Closure requires:

1. name the canonical owner and the old private path being removed;
2. migrate at least three real consumers in the same capability change, unless
   the change is deliberately a narrow data-integrity fast track;
3. preserve a degrade-safe one-line fallback or feature revert;
4. execute a focused contract that fails on the original defect;
5. run `node tools/math-gate.mjs --seeds 90210,1337` through determinism;
6. perform live browser QA proportionate to the claim, including the actual
   player path and touch where relevant;
7. record issue status, evidence, closing commit, and any remaining legacy
   count in the issue register.

For visual claims, source inspection and arithmetic are necessary but not
sufficient. Film or capture the camera/viewpoint that exposed the problem. For
behavior claims, count semantic correctness and lifecycle transitions, not just
headcount. For performance, measure live peak draws/allocations/simulation cost
at each quality tier; a census or disabled-by-default flag is not an
optimization.

Keep batches vertical and reviewable. Do not spend a wave designing a beautiful
taxonomy with no visible consumer. The useful loop is:

```text
player-visible betrayal
  → trace the original owner and private bypass
  → extend the narrow shared capability
  → migrate real consumers
  → execute ratchet + focused probe + live path
  → lower or close the measured debt
```

##### Explicit holds

Until their prerequisites are proven, do not:

- expand the old `GAMEPLAN.md` world/content waves;
- build bus, tanker, and refuse truck as three bespoke controllers;
- add another car/boat/aircraft camera or lengthen the touch mode enum;
- give drive-bys another private pathfinder;
- create a second loyalty, faction, site, vehicle, glass, body, or physics
  registry;
- repair nuke attribution with a broader `"blast wave"` regex;
- restore generic nuclear explosions/puffs or add smoke layers for density;
- use generic debris as evidence that a room object was destroyed;
- let remote multiplayer verbs expand a local boarding change;
- repin a failure upward, replace on-foot first-person feel, or begin a global
  ECS/physics/framework rewrite.

The ocean and nuclear spectacle are seductive because they are visually large.
They should not dominate while guards, doors, bodies, props, and road drivers
still break immediate player trust. Finish a foundation, prove it in multiple
places, then reassess the next phase against what the game actually feels like.
The roadmap is a convergence guide, not bureaucracy and not a promise that all
121 symptoms deserve equal effort.

##### Document discipline for whoever continues

Keep four kinds of truth visibly separate:

- constitution/design law;
- current canonical owner and invariant;
- issue status with dated evidence;
- historical session narrative.

Constitutions persist. Owners change deliberately. Issues close only with
evidence. Session reports stay dated. Update statuses when source changes
instead of leaving a newer fix buried beneath an older diagnosis. The missing
1–27 provenance should remain marked missing unless an external record is
actually recovered.

Final message from GPT to Claude: there is no shortage of ambition here. The
highest-leverage work is to make the strong systems already present tell one
truth all the way down. Follow the owner, remove the private bypass, and prove
the result where the player can feel it.

### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 iPad Prison Escape interaction handoff

> **STATUS — SHIPPED AND REVERIFIED, NOT A PROPOSAL.** The gameplay change is
> commit `bbef3c4` (`Fix iPad interactions and aim swipe`), published on
> `origin/agent/ipad-interactions-aim-swipe`, merged by PR #2 as `6af1195`, and
> verified on 2026-07-31 to be an ancestor of current `origin/main` at
> `066aba8`. The focused real-Chrome iPad contract was rerun on that current
> main and returned `failures: []` and `relevantErrors: []`.

**THE OWNER'S IPAD CONTRACT**

1. This layout correction is for iPad/tablet touch, not desktop and not the
   compact phone layout.
2. Every interaction option is a vertical row. The first action starts on
   Reload's top edge and the remaining actions continue downward in one rail.
3. The complete meaning of each option is readable on the left; the actual
   tappable action button is on the right. Do not turn the options back into a
   horizontal strip beside Eye or hide overflow actions.
4. Holding Aim and pulling upward to Fire must require only a short thumb
   movement. The player should not need a long upward swipe that pitches the
   camera before the gun fires, and Scope must move clear of the taught target.
5. One spoken line gets one subtitle. Identical words rendered twice with a
   tiny offset or a second font are a duplicated owner, not an iPad font tweak.

**WHAT THE ROOT-CAUSE TRACE FOUND**

- Prison Escape does not use only the legacy `#interact` panel. The live touch
  path has its own canonical `#pinteract` / `#pverbs` / `#poptions` renderer in
  `src/systems/interact.js` and its own geometry in
  `css/interact_touch.css`. That owner had deliberately placed four primary
  verbs horizontally beside Eye, so changing only the shared city panel could
  never fix the live Prison Escape screen.
- Gang City still uses the shared `#interact` path from
  `src/city/interactions.js` and `css/mobile.css`. The tablet grammar therefore
  had to be adopted by both renderers while retaining their existing dispatch
  contracts.
- `src/city/campaign.js::say()` sent the same authored body through both
  `campaignUI.say()` and `CBZ.citySay()`. On iPad the two subtitle surfaces had
  different touch typography/placement, exposing the verbatim double render as
  offset mixed-font text.
- Aim's upward Fire route inherited the longer `SLIDE_PAD_OUT = 26` travel, and
  the old visual Fire target jumped above Scope, approximately 128 px
  centre-to-centre from Aim. The held finger kept applying look deltas during
  that travel, so the camera climbed before Fire engaged.

**THE SHARED IMPLEMENTATION THAT NOW OWNS IT**

- `CBZ.touchInteractionDocked()` in `src/systems/touch.js` is the single tablet
  capability check: touch must be enabled and the viewport must be at least
  `700x550`. Reuse it; do not add iPad user-agent sniffing or a second cutoff.
- `syncInteractionDock()` measures the live `#pinteract.show` first, otherwise
  `#interact.show:not(.pi-quiet)`. It anchors to visible Reload, then falls back
  through Swap, View and Jump if Reload is unavailable. Reload supplies the
  first-row Y position; the leftmost edge of Reload/Swap/View/Jump/Fire supplies
  the safe right-control boundary so lower rows cannot overlap wider Fire or
  Jump buttons. It publishes `--touch-interact-top/right` only when its geometry
  signature changes.
- Prison Escape's docked `renderTouch()` concatenates `core + rest` and renders
  every entry through `.pi-choice`: full `labelFor()` plus price/status/help on
  the left, compact uppercase verb on the right. Campaign decisions use
  `ACCEPT` and `REFUSE`; Teaching Tips is also an explained row. The existing
  delegated `data-pi -> doAction(index)` click path remains authoritative.
- Gang City's `src/city/interactions.js` emits the equivalent
  `.itouch-copy + .itouch-act` row while retaining `data-i` and the canonical
  interaction dispatcher. The legacy Prison fallback in
  `src/systems/interact.js` adopts the same row shape.
- The tablet-only CSS in `css/interact_touch.css` and `css/mobile.css` uses a
  vertical `440px` rail, `9px` row gaps and action targets at least
  `106x52px`. Explanatory copy stays to the left. The existing compact
  horizontal phone UI remains outside the `min-width:700px` /
  `min-height:550px` query; desktop keeps its keyboard UI.
- Aim now has its own `AIM_UP_TRIGGER = 18` and `AIM_UP_RELEASE = 10`
  hysteresis. Scope retains its older deliberate threshold. `#tfireup` is a
  `40x40px` ghost target only `36px` centre-to-centre from Aim; while Aim is
  held, visible Scope moves upward to leave a `12px` gap. Aim remains held
  across Fire press/release through the existing ref-counted slide-touch path.
- Campaign authored speech now gives `campaignUI.say()` ownership. `citySay()`
  runs only as a degradation fallback when campaign UI is absent. Do not call
  both for the same body.
- `index.html` cache keys were bumped for all changed browser assets:
  `mobile.css?v=ipadcontrols1`, `interact_touch.css?v=pinteract2`,
  `systems/interact.js?v=ipadchoices1`, `systems/touch.js?v=ipadcontrols1`,
  `city/interactions.js?v=ipadchoices1`, and `campaign.js?v=story9`.

**THE EXECUTABLE ACCEPTANCE CONTRACT**

Run:

```sh
node tools/test-ipad-interactions-browser.mjs
```

The harness opens real Chrome with touch emulation at `1180x820`, enters direct
Prison Escape, exercises Aim with synthetic touch events, forces the Warden
campaign choice, switches to Gang City, registers a deterministic interaction,
clicks its live action, and captures
`tools/shots/ipad-interactions-aim.png`.

The 2026-07-31 current-main pass proved:

- six Prison rows (five verbs plus Teaching Tips), all `106x52`, all in bounds;
- first action top `438`, exactly Reload top `438`; rail-to-Reload gap `28px`;
- text bounds ended at x=`950`, action buttons began at x=`962`;
- no Fire at `17px`, Fire at `19px`, stable through `11px`, release at `9px`;
- taught target travel `36px`, target-to-Scope gap `12px`, pitch delta
  `0.114rad` and within the test's `0.13rad` ceiling;
- Warden line appeared in `#campaignDialogue`, `citySayCalls` stayed `0`, and
  no duplicate subtitle was visible;
- the city row read `ASK FOR DIRECTIONS | YES`, aligned with Reload, and the
  click reached its registered canonical action;
- `relevantErrors: []` and `failures: []`.

The original publish also passed `npm run test:pages`, `node --check` on every
changed JavaScript file and the browser test, and `git diff --check`.

**DO NOT REGRESS THESE DETAILS**

- Do not cap iPad to four visible verbs; the removed overflow is still a real
  action and must remain reachable.
- Do not move the choice rail back beside Eye. “Vertical starting next to
  Reload, explanation left, button right” is the explicit correction.
- Do not broaden the tablet media query onto phones or desktop.
- Do not make the Aim target visually close while leaving a longer hidden
  threshold, or shorten the threshold while leaving Scope on top of the target.
- Do not solve duplicated speech with font, z-index or transform offsets. Trace
  which renderer owns the authored line and keep the other as fallback only.
- If touch-control sizes or order change, re-run the live geometry test:
  Reload is the vertical landmark, but the whole FLOW column is the horizontal
  collision boundary.

**WORKTREE HANDOFF.** The checkout in which this note was requested was
intentionally left dirty (`main` had many unrelated modified/untracked files and
was ahead/behind remote). Never `git add -A`, reset or clean it as part of this
iPad work. The gameplay fix was published from an isolated clean worktree. That
dirty checkout also already contained a separate 526-line GPT diagnostic
addendum (items 28–121) which is not on current remote main and may be stale,
especially after nuke commits `97838b9` and `066aba8`; preserve it, but verify
those diagnoses against current code before treating them as open.

### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 closing handoff: bomb soot, Prison Escape, moving-door marks, and GitHub

> **AUTHORSHIP AND STATUS:** This subsection is GPT/Codex's closing handoff to
> Claude after the owner said this chat window was about to close. It records
> two implemented changes, one source/deployment diagnosis, the facts that
> changed after that diagnosis, and the exact remaining validation. It is not
> owner-authored project law. Do not promote a diagnosis below into a current
> fact without checking the named snapshot and live deployment.

#### What this chat actually changed and published

Two narrow gameplay fixes were authored in this conversation and are published
for review on branch **`agent/scorch-prison-handoff`**, based on upstream
`066aba8`:

- **`d210c68` — `Remove printed building scorch marks`:** removes the generated
  explosion-soot decal family while preserving physical building damage.
- **`02a9e6e` — `Keep bullet marks attached to moving prison doors`:** makes a
  persistent bullet pock struck into the Prison Escape keycard door move with
  that door when it opens, with an actual-shot browser regression.

As of this handoff neither fix is on `main`; both are on the review branch and
draft PR **#4**. The branch was pushed before this closing note was extended so
the gameplay work would survive even if the chat closed during documentation.

The branch deliberately contains only:

- `src/city/buildings.js`
- `src/systems/fpsmode.js`
- `tools/test-building-scorch-contract.mjs`
- `tools/test-shared-weapons-browser.mjs`
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

#### Prison keycard door marks — symptom, root cause, invariant, and proof

**The exact player path:** in direct Prison Escape, the owner shot the first
locked red wall door, left visible bullet marks on it, collected the keycard,
returned, and opened the checkpoint. The red door slid upward, but the marks
stayed suspended across the now-empty doorway as though an invisible door were
still closed.

This was not the generated bomb-soot system above and not a GitHub deployment
problem. It was a transform-ownership bug:

1. `src/world/door.js` creates the checkpoint leaf as a real solid/LOS mesh at
   `(0, 3.5, -8)` and tags it `userData.mover = true`.
2. `src/systems/interactions.js` calls `CBZ.openDoor()` after the keycard
   condition, removes the collider, then animates `door.mesh.position.y` from
   `closedY` to `closedY + 8`.
3. `src/systems/fpsmode.js::wallDistance()` returned the correct raycast hit,
   including the struck door object, but the wall-impact branch discarded that
   object identity when it called `CBZ.bulletHole(...)`.
4. `src/systems/gunfx.js` therefore used its default `parent = scene`, stored
   the pock in world coordinates, and did exactly what it was told: remember the
   firefight at the old doorway position while the door moved away.

The important architectural fact is that the correct shared capability already
existed. `CBZ.bulletHole(pos, normal, { parent })` can refine a hit against the
real target mesh, convert the world point and normal into that parent's local
frame, and mount the decal so it follows a moving surface. Cars already use
that path. The prison wall-shot caller simply failed to pass its moving owner.

The fix is deliberately at the bullet-to-surface routing seam, not in
`openDoor()`:

- `wallWoundParent(hit)` walks from the actual `wallHit.object` toward
  `CBZ.scene` and returns the first ancestor tagged `userData.mover`;
- the ordinary wall-pock call passes that result as `opts.parent`;
- a static wall returns `null` and keeps its existing world-space aftermath;
- the keycard checkpoint and the armory gate both already carry the mover tag,
  so the same rule fixes both without naming either door in gun code.

Do **not** “fix” this later by clearing every bullet hole when a keycard is used
or when `openDoor()` runs. That erases truthful physical evidence, couples a
door state transition to a global decal pool, and misses future moving
blockers. The durable invariant is:

> **Persistent evidence lives in the coordinate space and lifecycle of the
> surface that owns it.** Static architecture may own world-space marks. A
> moving panel owns local-space marks. If the owning surface moves, hides,
> breaks, or is recycled, its persistent evidence must follow that same state.

The helper intentionally recognizes `userData.mover`, not every object called
`dynamic`. Cars retain their dedicated panel-hit path; aircraft/transient
objects have separate scar-suppression rules. Broadening the tag would silently
mount wall decals on unrelated actors and effects.

`tools/test-shared-weapons-browser.mjs` now exercises the real route rather than
only searching source:

1. enter mode `escape`, reset, equip the shared sidearm and enter FPS;
2. close the door, force its world matrix current, and aim an actual shot at it;
3. capture the live `CBZ.bulletHole` result and the parent passed by
   `fpsmode.js`;
4. open the door and move the real leaf through its full eight-metre travel;
5. assert that the mark is parented to `CBZ.door.mesh` and its world Y rises by
   exactly `8`.

The focused Chrome result was:

```text
stamped=true
mountedOnDoor=true
beforeY=3.484869966827412
afterY=11.484869966827413
rise=8
failures=[]
```

The explicit matrix refresh in step 2 belongs to the harness, not gameplay.
This test deliberately replaces `requestAnimationFrame` before navigation to
keep the enormous world from starving CDP; without a render tick, a transform
written by `closeDoor()` is not guaranteed to have reached `matrixWorld` before
the raycast. A first clean-branch run correctly exposed that stale test fixture
as `stamped=false`; after `door.mesh.updateWorldMatrix(true, true)`, the same
actual-shot path produced the passing result above.

The same harness keeps its pre-existing city/jail weapon-state and muzzle
contracts, so this is not a synthetic test of a new helper in isolation: a real
prison shot must still pass through the shared gun resolver. The clean review
branch passed both Node syntax checks, the building-soot source contract,
`git diff --check`, this one Chrome contract, and the Vite production build.
Validation was intentionally kept focused at the owner's request; do not turn
this one transform regression into a full-world test wave.

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
2. Run the two focused contracts
   (`node tools/test-building-scorch-contract.mjs` and, with a local server,
   `node tools/test-shared-weapons-browser.mjs`), syntax/diff checks, and one
   build. Then perform the still-missing browser bomb shot.
3. In direct Prison Escape, shoot the closed red keycard door, open it, and
   visually confirm the doorway is empty while the marks ride upward with the
   physical leaf. Also confirm a static wall's marks remain where it was hit.
4. Test both prison entries on one deployed SHA:
   - direct title-screen Prison Escape must show the current cellblock, rooms,
     pickups, lockdown, inventory, HUD, and touch work;
   - a Gang City arrest must still play physical arrest/booking, then transport
     into that same prison revision with a sentence;
   - the only intended divergence after transport is custody/sentence context,
     not a second prison map or stale content fork.
5. If the two entries need a new shared seam, add one canonical prison
   capability owner and an executable two-entry regression. Do not solve it
   with comments in `CLAUDE.md`, duplicated geometry, raw mode exceptions, or a
   deployment rewrite.

The earlier prison deployment investigation was diagnosis only: GPT did not
replace prison geometry, keycard progression, jail booking, or the entry-mode
boundary. The later door-mark report produced one shared-system gameplay change
in `src/systems/fpsmode.js` plus its browser regression. The other published
gameplay change is precisely the generated-soot removal and its source contract.

### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 causal sound, facade, SWAT, yacht and iPad handoff

This is the authoritative handoff from the owner's sound/visual/iPad review. The
owner is closing the originating conversation, so preserve the decisions below
instead of reopening settled questions. Conversation-scoped work that was not
already on `main` is published on `agent/conversation-audio-handoff`.

#### Shipping map

- `998ef0e` is already on `main`: road cars use gas, brake, left and right touch
  buttons; optional tilt steering is deliberately gentle; boats, planes and
  helicopters retain the joystick; Racer cars take more crash damage before
  exploding.
- `86dbc1b` is already on `main`: touch race results and related shared overlays
  have a visible tappable `CLOSE`, remove the keyboard-only `Esc` instruction on
  touch devices, accept `touchend`, and exclude the control from joystick/look
  gesture capture.
- `4851168` and `7e001ab` are on
  `agent/conversation-audio-handoff`: the sound observer, causal sound-source
  purge, physical door/glass policy, facade-terminal purge, SWAT-shield removal,
  and spatial siren correction described below.
- The giant-yacht visibility problem is diagnosed but intentionally unresolved.
  Do not describe it as shipped.
- `KO` and `rack` remain review candidates. Punch loudness remains a mix problem.
  They were not approved for deletion and must not be reported as deleted.

#### The owner's audio law: sounds must have a physical why

The B-2 flyover exposed the governing failure: the player heard alarms, doors,
clanks and glass while thousands of metres above a city, even though no nearby
physical event justified any of them. The owner called these fake sounds and
explicitly rejected silently swallowing requests in the central sound engine as
a band-aid. A sound request should not exist unless a real world event emitted
it.

Therefore:

- Remove bogus call sites and synthetic ambience at their owners. Do not build a
  denylist in `sfx`, mute broad categories, or turn valid requests silent.
- Every environmental sound needs an emitter position and must attenuate from the
  actual listener. Global UI/state changes are not permission to play world
  foley.
- Player causality matters. A directly operated mechanism may make a sound; an
  unrelated timer, random ambience tick, remote NPC, weather event or UI state
  may not impersonate that mechanism.
- Being inside the same owned building/aircraft is a legitimate local acoustic
  relationship. Merely flying over it is not.
- Preserve the gun distance mix. The owner specifically praised how guns become
  quiet with distance; do not route guns through a new generic curve while
  repairing other sounds.

Settled cue decisions:

- `alarm`: purged from the generic bank and fake source call sites. It was hot,
  global and reused without a believable emitter.
- `clank`: purged from the generic bank and fake source call sites.
- Generic `door`: purged. Keep directional `door_open` / `door_close` only when
  the player operates the mechanism or the door belongs to the building or
  aircraft currently occupied by the player. The B-2 altitude/ownership guard is
  intentional.
- `glass`: remote/random glass is purged. Keep the local sound only for a direct
  player gunshot, melee strike or player-broken jewellery case, with the local
  distance cap. NPCs, explosions, aircraft, weather, UI and background activity
  must not synthesize it.
- Gun sounds and their existing near/distant assets are kept.
- Sirens must fade continuously with listener distance. They may not remain
  full-volume inside a binary radius and suddenly disappear at its edge.
- Race-start and gang-turf state changes no longer play a fake global siren.
  Emergency vehicles, police responders, strategic strikes, nuclear warnings
  and tsunami warnings supply their real world position through `CBZ.sfxAt`.
  Sirens use their own squared falloff and reach silence at long range; the gun
  attenuation branch is unchanged.

The remaining review list is deliberately not a kill list:

- `KO`: listen and decide with the owner.
- `rack`: listen and decide with the owner.
- `punch`: the owner says it is stupidly loud relative to guns. Rebalance it only
  after comparing its layered `punch_real + thud_real` path against the gun mix;
  do not casually delete or globally compress gun audio to make the ratio look
  better.

#### Sound observer contract

The review overlay is diagnostic only. Enable it with
`http://127.0.0.1:8000/?soundDebug=1`; `F8` toggles it. Each row reports:

- the logical cue;
- the actual asset or procedural/layered source that played;
- near/far selection where relevant;
- duplicate count for rapidly repeated cues; and
- the originating source file/caller when available.

It reports sounds that actually schedule playback and deduplicates loops. It
must never change volume, timing, routing or whether the sound plays. The owner
already used this observer successfully. Do not keep adding audit UI or rerun
broad browser/world suites merely to reconfirm that settled workflow.

#### Facade and rooftop decision

The dark boxes repeated on the sides of Threads, Drip and many similar buildings
were not useful architectural detail. Their active owner was the repeated
`balconyWindow` facade terminal, with a second dormant fake-fire-escape platform
path in building dressing. Both repeated side attachments are purged globally;
do not reintroduce them under a new decoration name.

The hollow-looking rooftop attachment is different: it is the functional
elevator/headhouse access volume. Keep it. The instruction was to remove the
repeated side boxes, not blindly strip useful rooftop access geometry.

#### SWAT decision

Remove the handheld SWAT riot shield. The mesh, catalog entry, mount and loadout
assignment were all part of the same bad presentation, and the actors held it
incorrectly. SWAT should retain helmet, vest, full armour behaviour and an SMG;
do not replace the shield with another decorative slab.

#### Giant-yacht diagnosis

The large yachts physically exist. The visibility failure is placement and
presentation: they sit roughly four kilometres offshore in the roadstead,
outside the useful chart/minimap read and beyond the normal visible-ocean/far
horizon experience. This is why the owner could not see them; it was not proof
that the yacht models were deleted.

The next design pass must choose a grounded remedy—bring a meaningful yacht
route/anchorage into readable range, expose it through a real travel reason, or
extend the ocean/horizon/navigation presentation coherently. Do not add a
floating marker as a substitute and do not claim this branch solves it.

#### iPad interaction rules that came out of this review

- Road cars need explicit gas, brake, left and right controls. A movement
  joystick remains correct for boats and aircraft, but not for road-car driving.
- Tilt steering is optional, low-sensitivity and never the only steering method.
- Racer vehicles should survive ordinary race contact; they were exploding too
  easily before the durability adjustment on `main`.
- Every modal shown on iPad must contain a visible tappable close control.
  Keyboard-only copy such as `Esc closes` is a bug on touch hardware.
- A close control must receive `touchend` and be protected from movement/look
  gesture capture. Merely drawing the button is insufficient.

#### Vehicle cook-off chain distance

A burning car may still ignite or destroy a genuinely adjacent vehicle, but the
old blast-bus coupling reused the visual fireball's legacy `radius * power`
footprint. That let a normal saloon bill cars about 7.5 metres away and let a
larger van reach farther. The review branch gives `carcook` a final five-metre
vehicle-coupling radius. This changes only car-to-car blast billing: the visible
fireball and the explosion's other physical effects retain their existing size.
Do not widen the chain radius merely to make parking-lot cascades easier.

#### Evidence boundary and next actions

The focused sound-source contract and syntax checks passed before the final
siren-distance patch. At the owner's explicit direction, no browser suite, world
gate, build, or redundant audit was rerun afterward. Do not misstate the siren
patch as runtime-tested, but also do not restart a broad testing campaign: inspect
or exercise only the exact new behavior if the owner later asks.

The remaining owner decisions are:

1. audition `KO` and `rack`;
2. choose a new punch-to-gun level after a direct comparison; and
3. choose how the giant yachts enter the readable world.

Do not reopen alarm/clank/global-door/global-glass, SWAT shields, facade side
boxes, car touch controls, or touch-modal close behavior as unresolved design.


### MESSAGE FROM GPT TO CLAUDE — 2026-07-31 buildings, reality model, stadium, and fight-arena handoff

> **AUTHORSHIP AND PUBLISHED STATE:** This is GPT/Codex's closing handoff for
> the building-first-principles and floating-geometry conversation. The
> implementation is published from current upstream `0f5ee94` on branch
> **`agent/world-reality-arena-handoff`**. The code commit is **`bc448d5`**
> (`Add world reality audits and arena support fixes`). Review that branch;
> do not try to recover this work by staging the owner's mixed working tree.

#### Why this conversation mattered

The owner's original request was larger than "fix some props." They wanted the
beautiful Gang City buildings studied from first principles, especially
showrooms whose transparent frontage meets the floor; elevators preserved as
real architecture; demolition understood rather than cosmetically rewritten;
and fast reality tests that let the world model discover floating or
overlapping authored geometry. The stadium and fight arena became the proving
ground for that idea.

The most important correction came from the owner at the end. A numeric support
graph was green while a giant black scoreboard still plainly read as a floating
cube. Therefore:

> **A contact graph proves connectivity. It does not prove believable shape,
> visible load paths, collider fidelity, dynamics, or visual truth.**

Use math to find and prevent broad defect classes, then inspect the rendered
result from the player's view. Neither replaces the other.

#### The building grammar learned here

The good buildings are good because their relationships are coherent:

`floor → pane → mullion → header → room → collider → building registry`

They are not good because one facade enum happens to be called "modern." The
canonical `cityMakeBuilding` path already has the valuable primitives:

- varied massing, storey count, bays, window rhythms, rooflines, materials,
  signs, doors, rooms, colliders, and circulation;
- hollow furnished ground-floor programs behind real openings;
- breakable transparent panes registered to the same building record;
- functional elevators with carved shafts and aligned ground/roof access.

Future Georgian, Art Deco, industrial, mid-century, contemporary, or fantasy
styles should be **data over this canonical grammar**—massing, structural
rhythm, bays, openings, material, roofline, frontage, signage, program, and
circulation—not parallel era-specific building engines.

`tools/building-first-principles.md` is the detailed design note. Its proposed
next abstraction is a face/frame grammar that expresses structural frame,
openings, infill, glass, and attachments while continuing to emit the existing
canonical building/collider records. Do not replace working owners with a
second registry.

#### Changes to ground-front glass

`src/city/buildings.js` now makes showroom and flagship-garage glass obey the
same exact floor-to-head-beam equation as the strongest retail storefront:

- the lowest pane begins at grade;
- the glass wall ends in one continuous physical header rather than open air;
- storefront, showroom, and garage-front panes are tagged by role;
- all tagged panes retain their breakable collider;
- `CBZ.cityGlassRealityAudit()` groups vertically subdivided panes by mullion
  column, so upper cells are not falsely called floating merely because only
  the bottom cell touches the floor.

Runtime evidence during the conversation: **2,124/2,124 frontage columns met
grade and all 2,322 tagged panes had colliders** on seed 90210.

#### Elevator ownership and invariant

Do not remove elevator headhouses as "extra roof boxes." They are functional
roof access owned by `src/city/elevators.js`.

`CBZ.cityElevatorAudit()` now checks that every built lift has:

- ordered ground-to-roof stops agreeing with the building shell height;
- a reserved shaft footprint;
- carved intermediate slabs rather than floors crossing the shaft;
- one aligned vertical ground/roof column;
- sealed two-leaf cab rooms with correct floor heights;
- a matching `b.lift` record on the canonical building.

Runtime evidence during the conversation: **18/18 lifts, zero contract
failures** on seed 90210.

#### Shared reality checker

`src/systems/reality.js` is the canonical geometry-invariant owner added here.
It is loaded by `index.html` and provides:

- `boxFromTransform()` for exact world AABBs of the unit-box transform grammar;
- a uniform spatial-hash broad phase instead of a global all-pairs scan;
- `supportAudit()`: boxes are nodes, contacts are edges, and ground/authored
  walk surfaces are anchors; an unanchored component is floating;
- `overlapAudit()`: reports positive-volume penetrations, with a caller-owned
  ignore rule for deliberate structural joints;
- sampled kinds/components and candidate counts so a failure is diagnosable.

The 4,000-prop scaling/property contract lives in
`tools/test-reality-support.mjs`. During the original study, 4,000 transformed
boxes also matched Three.js AABBs with zero mismatches. `tools/math-gate.mjs`
ratchets the arena, fight census, ground glass, and elevator contracts.
`tools/demolition-check.mjs` now reuses the same support definition and exits
nonzero on an invariant failure.

Do not fork another "floating prop" checker. Extend `CBZ.reality` or add a
consumer-owned ledger that submits geometry to it.

#### Ironjaw stadium/venue defects and repairs

The owner called this the racing stadium; the audited structural owner in this
thread is `src/city/arena_venue.js`, the Ironjaw bowl/venue.

The first full audit exposed **202 unsupported pieces in 34 components**:

- 121 ringside chairs had cushions roughly 0.37–0.45 m above the floor and no
  legs;
- bowl seat pans/backs sat roughly 0.36–0.45 m above their decks without a
  frame;
- the old scoreboard was 15.63 m from its nearest truss because hangers were
  at `z ±22` while its shell ended near `z ±6.3`;
- the main gantry's roof hanger stopped between twin chords, leaving a 0.75 m
  lateral break;
- the upper guardrail was 0.25 m beyond the final deck;
- aisle-sign posts were 0.55 m in front of the cross-aisle;
- vomitory light bars missed cheek walls by 0.11 m;
- hanging banners missed their fascia by 0.09 m.

Repairs add real seat frames and chair legs, bridge/hanger structure, gantry
end frames, sign bases, and corrected mounting offsets. The venue-only graph
then reached **48,190/48,190 supported static primitives**.

#### Fight-arena coverage

The first green venue audit did **not** include the fight surfaces. That was a
coverage bug, not proof that the boxing ring, MMA cage, and beast pit were
physical.

`src/city/arena_fights.js` now owns a separate ledger for the static geometry it
authors and exposes `CBZ.arenaFightSupportAudit()`. The combined
`CBZ.arenaSupportAudit()` preserves the venue/fight split in its result. The
math gate requires the fight census to stay at least **264 primitives** so an
empty ledger cannot pass with a misleading zero.

The measured fight set includes the ring deck/canvas/posts/ropes/stair, MMA
base/mat/posts/fence/gate/rails, and beast-pit sand/walls/rails/lights. Its
result was **264 supported, zero floating, three grounded components**.

This still means only: the submitted fixed geometry has a static load path. It
does **not** mean every prop in the whole site was submitted or that ropes,
gates, loose objects, NPCs, colliders, gravity, hinges, impacts, and destruction
all behave realistically.

#### The scoreboard false positive and final visual repair

The owner correctly rejected the first technical answer: the centre object was
still a massive floating black square. Source confirmed it was literally two
nested full-depth boxes:

- frame: `12.6 × 6.4 × 12.6`;
- screen: `12.2 × 5.5 × 12.2`;
- corrected hangers were only about 0.38 m visible.

That assembly could touch the support graph and still look absurd.

The final `arena_venue.js` design is a real centre-hung scoreboard silhouette:

- four separate `8.6 × 3.6 × 0.14` outward-facing screen panels;
- a hollow 9 m square perimeter cage;
- an open underside, with no hidden black slab;
- top/bottom truss rings and corner posts;
- four visible roughly 3 m suspension rods;
- crossbars and a bridge visibly connected to the roof gantries.

After this redesign the combined live graph measured **48,470/48,470
supported**: 48,206 venue primitives plus 264 fight primitives. More
importantly, a low ringside screenshot showed two readable screen faces, the
open underside, and rods traceable to the overhead truss. Regenerate that proof
with:

`node tools/street-shot.mjs tools/shots/arena-jumbotron-after.png --arena`

The screenshot mode intentionally isolates the real board/truss/lamp meshes
after world build so SwiftShader can finish a focused readback. It is a visual
proof tool, not a replacement for ordinary gameplay QA.

#### Demolition conclusion

"Glass gone, frame standing" is mostly deliberate separation between facade
failure and structural collapse:

- on a tested four-storey 28×28 m block, one stock airstrike applied 18 damage
  against 70.15 structural capacity: 25.7%, `SCARRED`, stable;
- a near-field nuke applied 495: 705.6%, immediately `COLLAPSING`;
- nuclear glass failure intentionally reaches farther than wholesale collapse;
- the condemned shell remains for the 1.15-second warning/dust beat before the
  real shell is atomically replaced.

If an exposed-frame ruin phase is desired, put it in the shared `CRITICAL`
structural state, not inside each bomb implementation. The next useful
research gate is per-building collapse/yield radius compared with the named
nuclear pressure contours.

#### What was validated, and what was not

During implementation in the original checkout:

- cold full-world seed 90210 produced the glass, elevator, venue, and fight
  counts above;
- the support/overlap property and scale tests passed;
- syntax, whitespace, production build, and focused live scoreboard capture
  passed.

For the clean GitHub branch based on current `origin/main`, the final publish
pass was intentionally small at the owner's request: syntax for all changed JS,
`git diff --check`, and `node tools/test-reality-support.mjs` passed. The full
software-rendered world was not rebuilt again just to repeat earlier evidence.

Do not say "all props follow physics." Outstanding proof still includes:

- a player-view sweep of every arena/site prop, not only the scoreboard;
- collider-to-render alignment and collision response;
- dynamic gravity, hinges, rope/gate behavior, impacts, NPC reactions, and
  destruction;
- penetration/clearance/enclosure/registry-parity/teardown-parity invariants
  beyond the support and overlap primitives.

#### Repository handoff

At handoff, the owner's original checkout was local `main` at `7dfd419`,
**ahead 2 and behind 20**, with a very large unrelated dirty worktree. It was
left untouched except for appending this note. The review branch was assembled
in an isolated worktree from `origin/main` `0f5ee94`, so it does not import the
two local nuke commits or unrelated dirty files.

Primary files on `agent/world-reality-arena-handoff`:

- `src/systems/reality.js`
- `src/city/buildings.js`
- `src/city/elevators.js`
- `src/city/arena_venue.js`
- `src/city/arena_fights.js`
- `tools/math-gate.mjs`
- `tools/demolition-check.mjs`
- `tools/test-reality-support.mjs`
- `tools/street-shot.mjs`
- `tools/building-first-principles.md`
- `index.html`

Claude's next move should be to review/merge that branch, preserve the
canonical owners above, and treat the owner's visual objection as authoritative
evidence when a green graph contradicts what is visibly on screen.
