# CLAUDE ISSUE CONVERGENCE ROADMAP

*Decision and sequencing document. Written 2026-07-30 against `HEAD`
`5e76cee` plus the current uncommitted worktree. This document changes no game
code and does not declare any implementation complete.*

## 0. The decision

`CLAUDE.md` is currently four documents occupying one 2,386-line file:

1. owner constitution and permanent design constraints;
2. a catalogue of canonical engine owners and adoption laws;
3. historical session reports, including fixes that may since have drifted;
4. an issue register whose 94 numbered symptoms have mixed provenance and
   mixed current status.

It must not be executed from top to bottom as a backlog. The numbered addendum
is mostly a symptom inventory. Its 94 items collapse into fourteen workstreams,
and those workstreams depend on a much smaller set of shared foundations:

- truthful gates and current evidence;
- people, organizations, places, and posts with semantic identity;
- bidirectional navigation and continuous body contact;
- physical objects with one visual/collision/damage lifecycle;
- registered vehicles with derived capabilities, seats, and moving parts;
- one spatial truth for maps, ocean surface, and seabed;
- structured ordnance causes and one phase-owning nuclear event.

The immediate decision is therefore:

- pause feature-scale expansion from `GAMEPLAN.md`;
- restore a trustworthy green baseline;
- preserve the already-shipped loyalty-and-weapons spine instead of building a
  second one;
- converge each cluster through an existing canonical owner;
- resume world expansion only after the foundations it would multiply are
  measured and shared.

This is not a recommendation for a giant rewrite. Every future implementation
batch must obey the existing Block Law: one-line adoption, degrade-safe
fallback, at least three real consumers in the same change, a named owner, and
an executed ratchet.

## 1. What is authoritative today

### 1.1 Provenance

- Items **28–107** were written from a read-only inspection of clean snapshot
  `5e76cee`.
- Items **108–121** were written from a later inspection of the then-current
  `nukefx.js` and `crashfx.js` worktree.
- The text says a prior issue list ended at 27, but items **1–27 are not present
  in the current `CLAUDE.md` or recoverable from the searched repository
  history**. “Extending issues 17–27” is therefore not usable provenance.
- The current worktree contains later changes to buildings, touch driving, and
  nuclear FX. Those changes post-date parts of the diagnosis and must be
  reviewed as candidate fixes, not ignored and not presumed complete.

Until Phase 0 closes this gap, issue numbers are references, not an execution
order or proof of current failure.

### 1.2 Protected truths

These are design laws or working foundations, not backlog items:

- The Why Constitution: visible access and categorical power gradients beat
  floating objectives.
- The loyalty-and-weapons atom already has an implementation in
  `city/loyalty.js`. The current gate reports four source registries, zero
  mirrors, six rungs, seven verbs, zero verbless rungs, and four registered
  locks. Extend this owner; do not create another loyalty ledger.
- On-foot first person is sacred. Vehicle seat views must not rework its feel.
- No crafting. Acquisition is buy, steal, loot, access, cargo, or physical
  world interaction.
- Deterministic world generation and one-line feature reverts remain binding.
- GitHub Pages serves the root source path. A successful `dist/` build alone
  does not prove the deployed game.

### 1.3 Current gate baseline

The canonical command was run against the current worktree:

```text
node tools/math-gate.mjs --seeds 90210
```

The title-screen `playBtn` path built the complete world and completed 400
simulation ticks. The run reached 318 lots, 180 shops, 202 roads, 647 named
peds, and no new console-error failure. It failed on seven explicit checks:

| Current failure | Classification | Immediate rule |
|---|---|---|
| 16 road props inside a place/keep-out; ratchet is 15 | real drift over an already non-zero debt | restore to at most 15, then ratchet toward zero |
| ground oracle versus mesh max error 0.34 m; limit 0.30 m | real geometry/query disagreement | fix the disagreement; do not raise the limit |
| 5 venue stations with nobody working them | real staffing failure | reach zero with semantically correct workers |
| 3 fishing spots not on water | real placement/query failure | reach zero through the water oracle |
| 8 objects with a non-material `.material` | real FX warmup/type failure | reach zero; do not silently skip them |
| golden road count expects 178, world has 202 | stale calibration candidate | verify the road growth was intended, then recalibrate deliberately |
| golden biome set omits `annex` | stale calibration candidate | verify `annex` is intentional, then recalibrate deliberately |

Important green evidence from the same run:

- traffic: 70 ambient cars, zero trespass, zero water spawns, zero off-segment;
- predator adoption: 0 legacy / 10 adopted;
- checkpoints: 4/4 manned;
- street furniture: zero disconnected, through-building, or colliderless poles;
- pools: 150 root world-space pools, zero translated/displaced/local offenders;
- arena: zero floating geometry, 264/264 fight-support primitives connected;
- ground-front glass: 2,124/2,124 columns grounded, zero missing colliders;
- elevators: 18, with zero shaft/slab/building-contract failures;
- furniture anchors: `blocked=0`, while `noGeom=332` remains;
- power sites: 8 legacy guard sites remain;
- ranks: 12 empty ranks and 5 verbless rungs are current evidence, not the older
  numbers in the prose.

The gate aborted before a determinism rerun because the first pass was red.
Phase 0 is not complete until the full deterministic run is green on at least
seeds 90210 and 1337.

### 1.4 Later worktree changes that alter issue status

These changes already exist in the user's worktree and are not changes made by
this roadmap:

- The suspected `balconyWindow` side-box producer has been removed, and
  `cityFacadeStats()` now reports structural `sideBoxes: 0`. This makes issues
  84–86 a **candidate close**, pending a live street-view proof.
- Touch driving now distinguishes `boat` from `drive`, adds explicit road-car
  controls and an audit, but still classifies through a hard-coded mode enum.
  Road cars and boats still do not receive the aircraft `VIEW` control. Issues
  76–77 are **partial**, not closed.
- The cockpit prose says “at most 26 meshes,” but the actual enforced
  `MAX_MESHES` constant remains **40**. Issue 73 is open and also exposes a
  prose-versus-ratchet mismatch.
- `origin/main` commits `97838b9` and `066aba8` supersede the earlier nuclear
  worktree snapshot. The current focused contract reports one coherent
  post-flash draw, zero solid-lobe fields, zero detail planes, and zero generic
  nuclear puff events. This is meaningful progress on 109–115 and 117–120,
  but it is static/arithmetic evidence rather than near/far/aerial/underside
  visual and performance proof.
- Nuclear wave deaths now carry “nuclear blast” rather than generic explosion
  prose. Issues 105–107 are **partial**, not closed: identity is still
  normalized from phrases and the owner-facing display is not the requested
  canonical **NUKE**.

### 1.5 Clean-branch revalidation on 2026-07-31

The documentation branch based on `origin/main` at `066aba8` reran:

```text
node tools/math-gate.mjs --seeds 90210
```

It built the full title-screen world (318 lots, 180 shops, 202 roads, 648 named
peds), completed 400 ticks, and reproduced the same seven failures listed in
1.3 exactly. Because seed 90210 was red, the gate correctly stopped before the
determinism comparison and seed 1337. This confirms that the five product
failures and two calibration candidates were still current at handoff; it does
not authorize raising any ratchet.

## 2. The normalized issue register

Status vocabulary:

- **Open** — the current source directly confirms the defect.
- **Partial** — current work addresses part of the contract but leaves the
  shared owner or proof incomplete.
- **Candidate close** — the producer appears removed or the contract appears
  satisfied, but the required runtime evidence has not been recorded.
- **Design constraint** — preserve the behavior while solving adjacent issues.
- **Deferred** — valid, but unsafe to mix into the prerequisite phase.

| Workstream | Issues | Root problem | Current status | Canonical seam |
|---|---:|---|---|---|
| T0 — truth and evidence | addendum provenance, gate, stale census | prose, source, and gates describe different dates | Open | `CLAUDE.md`, `GAMEPLAN.md`, live audits, `tools/math-gate.mjs` |
| P1 — institutional authority | 28–36 | a staffed body has no authoritative organization/jurisdiction/post meaning | Open | `security.js`, `factions.js`, `occupy.js`, `citystaff.js`, `power.js` |
| M1 — maritime charting | 37–41 | map bounds and POIs assume land lots | Open | `fullmap.js`, `yachts.js`, marina/berth records |
| W1 — ocean spatial truth | 42–49 | surface, horizon, bounds, rendered floor, depth query, swim bed, and caustics disagree | Open | `water_spec.js`, `waterfield.js`, city/world water, terrain shelf, underwater |
| B1 — live actor bodies | 50–57 | wildlife membership and death physics are mistaken for continuous body contact | Open | existing collider grid, crowd broadphase, `body`, dogs/wildlife locomotion |
| B2 — physical room objects | 58–63 | visual, collider, LOS, mass, break, impulse, hidden state, reset, and persistence are separate | Open | `furnish`, colliders, `crashfx`, `structural`, batch hide/show |
| V1 — heavy road vehicles | 64–69 | no reusable registered heavy-chassis/body/cargo/service grammar | Open | `cityRegisterVehicle`, normal vehicle damage and driver owners |
| V2 — seats, views, verbs, boarding | 70–80 | vehicle type is inferred by parallel state machines instead of derived capabilities | Open / Partial / Deferred | vehicle record, interactions, cockpit view, touch, aircraft/tank adapters |
| V3 — moving glass | 81–83 | one glass material lacks a local-transform-aware moving-pane lifecycle | Open | shared glass recipe and pane behavior with a moving transform adapter |
| F1 — facade side boxes | 84–86 | audits counted named AC paths, not symptom-shaped geometry | Candidate close | building facade grammar plus live visual/census proof |
| V4 — drive-by locomotion | 87–94 | canonical car/ped identity sits on a private beeline driver | Open | `roadPick`, road graph/traffic driver, vehicle collision feedback |
| P2 — indoor mobility and posts | 95–104 | outdoor goals and permanent pinned posts have no bidirectional doorway/post lifecycle | Open | `cityNav`, ped goal owner, `staffPost`, `cityScare` |
| O1 — structured death cause | 105–107 | ordnance identity is reduced to a reason string before the kill feed | Partial | `impactbus`, damage/kill bus, `killfeed` renderer |
| O2 — one nuclear event | 108–121 | flash, cloud formation, generic explosions, smoke sources, LOD, and audit do not share one phase contract | Partial | `nukefx` as sole visual owner; `impactbus` and real burning receivers as inputs |

## 3. The overlaps that determine sequencing

### 3.1 People, place, and post are one chain

Issues 28–36 and 95–104 are not separate “guard” and “casino” features.

| Shared question | Current failure | Required owner answer |
|---|---|---|
| Who does this body work for? | `security`, `cop`, `agent`, and `soldier` are selected independently | derive organization and authority from the protected site/principal |
| What may this body do? | uniform, faction, arrest power, weapons, and response behavior drift | one resolved role consumed by appearance, combat, arrest, and audit |
| Where should this body be? | whole-city goals fight hard-rooted posts | venue/post lifecycle with a real doorway route |
| What happens under danger? | `staffPost` erases fear paths and skips depenetration | calm hold → release → exit/flee → all-clear return/re-staff |

The authority work must therefore migrate County Jail, City Hall, and at least
one airport/port/private venue in the same change. The post work must prove both
ambient patrons and pinned staff. A headcount-only audit is insufficient.

### 3.2 Continuous physical presence is one foundation with narrow adapters

Issues 50–63, 81–83, and 92 all need a shared spatial truth, but not a global
physics rewrite.

- A live actor proposes motion, resolves static collision, resolves nearby body
  contact, and then commits its transform.
- A physical prop joins visual state, collider/LOS state, damage receiver,
  break/impulse behavior, reset, and persistence.
- A moving pane joins local geometry to that receiver contract through a live
  transform.
- A vehicle chassis needs an oriented footprint and collision feedback rather
  than a width circle plus a forward probe.

These should reuse the existing collider grid, crowd spatial buckets, body
impulses, furniture builder, structural ledger, and vehicle records. They must
not become a second scene graph, entity registry, or general-purpose physics
engine.

### 3.3 The vehicle cluster has one prerequisite spine

Issues 64–94 describe one incomplete registered-vehicle contract:

```text
registered vehicle
  → derived capabilities and seat sockets
  → one enter/seat/exit ownership handoff
  → seat view and capability-driven touch/interaction verbs
  → moving panes and cargo/passenger sockets
  → common driver/route ownership
  → heavy bus/tanker/refuse consumers
```

Consequences:

- Do not build a bus, tanker, or garbage truck before the capability and heavy
  chassis seams exist.
- Do not give the drive-by a second better private driver. Move it onto the
  common road/driver owner.
- Do not add car, boat, and aircraft first-person cameras separately. Derive a
  seat view from existing sockets/geometry.
- Do not turn the touch enum into a larger enum. Render controls from derived
  verbs/capabilities.
- Remote-player verbs are a separate network-authority problem. They may reuse
  the interaction surface, but they must not be smuggled into local vehicle
  boarding work.

### 3.4 Maritime charting and ocean physics overlap, but need not ship together

Issues 37–41 can be made honest before the full ocean rewrite:

- chart bounds can include actual vessel, berth, anchorage, and navigable
  extents;
- yachts can enter the existing POI funnel with maritime kinds;
- map and yacht audits can cross-check one another.

Issues 42–49 are a deeper spatial contract. They should follow with one
`depthAt`/`seabedAt` truth consumed by render, physics, swimming, caustics, and
tests, plus a horizon/coverage rule shared by shader and reflective modes.

### 3.5 Nuclear attribution and nuclear visuals must be split

Issues 105–107 are a small data-integrity fix and should not wait for a visual
rewrite. Carry a structured cause/weapon kind through damage and death, then
render the exact owner-facing label `NUKE`.

Issues 108–121 are a visual/performance event. They depend on measured FX
budgets and, for secondary smoke, real burning receivers. A regex change or
another smoke layer solves neither cluster.

## 4. Phased attack plan

Every phase below is a sequence of future implementation batches. “Ship” means
the batch has passed its own focused probe, the canonical gate, and a live
browser path proportionate to the claim.

### Phase 0 — restore truth before adding capability

#### 0A. Freeze and classify the current worktree

- Preserve all existing user changes.
- Separate the current facade, touch-driving, nuclear-FX, building/glass,
  elevator/arena, and unrelated sound changes into reviewable conceptual
  bundles before any new implementation is stacked on them.
- Record which issue each bundle claims to affect and which evidence it has.
- Treat the current nuclear phase test as a focused arithmetic contract, not a
  visual sign-off.

#### 0B. Make the canonical gate genuinely green

Fix, in this order:

1. the five true product failures: venue staffing, dry fishing spots,
   ground/oracle mismatch, invalid FX materials, and the road-prop drift;
2. verify that 202 roads and the `annex` biome are intentional world changes;
3. only then update the two stale golden expectations;
4. run the full deterministic pass for seeds 90210 and 1337.

The tolerated road-prop debt of 15 is not the destination. First restore the
existing ratchet, then create small follow-up migrations that only lower it.

#### 0C. Reconcile the documents with current evidence

- Locate items 1–27 from an external source or explicitly mark them unavailable
  and renumber the current register.
- Replace stale measured claims with dated evidence. In particular, the current
  gate reports `blocked=0`, `noGeom=332`, 9 organizations/45 rungs, and 8 legacy
  power sites; older census rows must not remain presented as current.
- Mark session narratives as historical evidence, not standing open work.
- Mark the loyalty ledger as an implemented protected owner.
- Rebase `GAMEPLAN.md` so its “unmeasured” and older golden baselines do not
  override the live gate.

#### 0D. Close or reopen candidate fixes with runtime evidence

- Facades: run the current street-view path at the reported buildings, identify
  any remaining projecting boxes by mesh/producer, and record `sideBoxes=0`.
- Touch: run the existing real-browser car/boat/aircraft contract without
  interpreting a hard-coded enum as a capability solution.
- Nuclear FX: capture the flash-to-cloud handoff at near, far, aerial, and
  underside viewpoints; record live draw/puff/allocation peaks.

#### Phase 0 exit gate

- canonical math gate green on 90210 and 1337, including determinism;
- no new console errors;
- all asserted audits print real values rather than blanks;
- current issue register has provenance and status;
- candidate closes have runtime evidence;
- no real failure was hidden by raising a ratchet or broadening a tolerance.

### Phase 1 — people, authority, and indoor post lifecycle

This is the first capability phase because the Why Constitution says the game
is people and power. It extends the loyalty/faction spine already present.

#### 1A. Derive institutional authority from existing site truth

Add the smallest semantic resolver to the existing security/faction/site seam.
It should answer, from fields the site already owns:

- protected organization and principal;
- jurisdiction and public/private/military classification;
- role family and post;
- uniform/equipment source;
- arrest/response authority.

It must not become a second venue registry. Adoption replaces the inline
`kind:"security"`/`agent`/`soldier` choice a builder already makes.

Same-batch consumers:

1. County Jail → sheriff/deputy/corrections semantics;
2. City Hall or another municipal site → appropriate civic/law staffing;
3. one federal/military site;
4. one airport/port split;
5. one private venue proving private security remains private.

The audit must fail on a semantically wrong body even when the headcount is
non-zero.

#### 1B. Make navigation bidirectional through real doors

Extend `cityNav.routeTo` or its canonical route primitive so it handles:

- outside → inside;
- inside → outside;
- inside one room/site → inside another;
- a committed doorway leg that cannot oscillate between symmetric choices.

Goal changes, stuck recovery, and route changes must reset or deliberately
rebase steering memory.

#### 1C. Give posts a threat lifecycle

A shared staff post must mean:

```text
calm: hold/serve at authored post
danger: release post and retain identity
escape: use real door route, collide, and remain mobile
all-clear: return to the post or allow the staffing owner to re-fill it
```

Prove this on:

- a Golden Ace ambient patron;
- a Golden Ace pinned dealer/cashier/guard;
- a generic casino or another staffed interior.

#### Phase 1 exit gate

- issues 28–36 and 95–104 have semantic/runtime probes;
- zero semantically miscast government posts in the selected site census;
- zero pinned actors that skip depenetration;
- indoor goals use a doorway in both directions;
- reversal-without-progress and time-stuck are measured;
- the five currently unstaffed venue stations are either correctly staffed or
  deliberately removed, never filled with a generic wrong guard.

### Phase 2 — continuous physical presence

#### 2A. Shared live-body motion/contact

Define a narrow motion contract:

```text
desired motion
  → static collider solve
  → nearby live-body contacts from a spatial bucket
  → mass/yield/knockdown response
  → committed transform
```

Species and actor brains keep choosing desired motion. The shared contract owns
only physical resolution.

Same-batch consumers:

- dogs;
- ordinary land wildlife;
- one human/crowd path proving the same contact vocabulary.

The audit must enumerate player, named human, crowd rig, dog, and wildlife body
classes and report static collision, mutual contact, mass yielding, and
knockdown participation. Performance must remain bounded by a spatial grid, not
all-pairs scans.

#### 2B. Physical-prop lifecycle

Extend the existing furnishing/structural/batch seams so a meaningful room
object has one joined record for:

- visual object;
- collider and LOS footprint;
- mass and break threshold;
- blast/impact receiver;
- impulse, debris, hidden/broken state;
- restoration and persistence.

Prove at least three structurally different consumers in the same batch:

- a partition or interior wall;
- a desk/table;
- a shelf/cabinet.

Generic rubble may accompany the transition, but it may not substitute for
changing the actual struck object.

#### 2C. Oriented vehicle-world collision

Replace the current width-derived circle plus forward-probe claim with a
measured oriented chassis footprint and swept collision appropriate to long
rotated bodies. Return meaningful collision feedback to drivers.

Prove:

- corner contact against a building;
- a thin obstacle between frame endpoints;
- a long/heavy body;
- no regression to marine/open-water handling.

#### Phase 2 exit gate

- issues 50–63 and the collision foundation of 92 are covered;
- no new all-pairs actor loop;
- room-object receiver coverage and collider coverage are measured;
- actual objects transition on blast;
- current frame/simulation budgets are no worse without an explicit accepted
  budget change.

### Phase 3 — registered vehicle convergence

#### 3A. Derive capabilities and seat sockets from the existing record

Do not add a parallel vehicle type registry. Derive capabilities from fields,
geometry, and sockets vehicles already expose:

- drive/helm/fly;
- seat roles and eye/forward/up transforms;
- enter/exit/door ownership;
- primary/secondary/payload/horn/utility verbs;
- passenger/cargo sockets;
- panes and damageable modules.

Adopt in car, boat, and aircraft in the same batch.

The cockpit budget must enforce what its prose claims. Either enforce 26 or
change the stated contract with measured justification; 40 hidden behind
“≤26” is not acceptable.

#### 3B. Unify seat view, boarding, and touch rendering

- A vehicle seat view derives from the selected seat socket; it is not three
  new camera systems.
- Existing aircraft cockpit feel is a consumer and regression baseline.
- Road cars and boats gain view only through the shared seat contract.
- Touch renders available capability verbs, not `drive/boat/heli/wing` branches.
- The intentionally silent single-action ride card remains a design constraint.
  Multi-verb doors, seats, payloads, cargo, and passenger choices surface
  consistently when there is actually a decision.
- Enter/seat/exit transitions converge behind adapters while current car,
  aircraft, and armor state owners remain functional during migration.

#### 3C. Move drive-bys onto common road/driver ownership

- Place the event car through a real road/lane query, not `roadPointOpen`.
- Give it a road segment, route, and driver plan.
- Feed collision displacement into brake/reverse/side-choice/replan behavior.
- Remove the private raw-target beeline once the common driver can perform the
  event.
- Prove each visible occupant maps one-to-one to a live canonical ped.

The audit must measure road membership, route ownership, obstacle response,
replans, canonical occupant mapping, and legacy fallback use.

#### 3D. Add moving-pane behavior

Adapt the shared pane lifecycle to local coordinates or a live transform.
Prove moving breakable panes on at least:

- a road car;
- a boat or bus;
- an aircraft.

Material sharing alone does not count. Bullet ray, blast bounds, break/opening,
shards, reset, and movement after damage must remain coherent.

#### 3E. Build heavy vehicles only after the spine exists

Create a reusable heavy chassis/body-module grammar through
`cityRegisterVehicle`, then ship all three real consumers together:

- passenger bus;
- fuel tanker with real cargo hazard;
- refuse truck with service stops/workers.

They must receive normal theft, damage, cook-off, seat, camera, touch,
collision, and route behavior through adoption rather than bespoke controllers.

#### 3F. Defer remote-player verbs to a network-authority batch

Issue 80 is valid, but local UI is the easy half. Trade, invite, revive,
restrain, surrender, and inspect require server-authoritative validation,
permissions, rejection, and replication. Reuse the interaction surface only
after that protocol is designed and tested. Do not block local vehicle
convergence on it.

#### Phase 3 exit gate

- issues 64–83 and 87–94 are covered, with issue 80 explicitly tracked in its
  network batch;
- car/boat/aircraft are three real capability consumers;
- no touch type branch is required to expose a newly adopted verb;
- drive-by cars are on road-owned routes;
- moving panes remain hittable after their parent moves;
- bus/tanker/refuse are ordinary registered vehicles, not event props.

### Phase 4 — maritime spatial truth

#### 4A. Chart what already exists

- Derive map bounds from land plus declared navigable/vessel/berth extents.
- Add maritime POI kinds to the existing POI funnel.
- Give yachts, working boats, marinas, and anchorages distinct readable symbols.
- Cross-link `yachtAudit` and `mapAudit`: every chart-required vessel must project
  inside bounds and resolve to a maritime map entity.

This is a small honest batch and may be fast-tracked after Phase 0 because it
does not require the ocean renderer rewrite.

#### 4B. Establish one surface/horizon coverage contract

- Derive required water coverage from camera/fog/view geometry.
- Make actual vertices, bounding volumes, tests, shader mode, and reflective
  mode agree.
- Use a quality-aware distant continuation, skirt, curvature, or other
  geometric horizon solution; fog must not be the only geometry.
- Test the real rim, not an inflated bounding box.

#### 4C. Establish one bathymetry/seabed contract

Provide one queryable `depthAt`/`seabedAt` truth consumed by:

- rendered shelf/floor;
- ordinary physics;
- swimming and dive limits;
- underwater caustics/fog presentation;
- marine gameplay and tests.

The camera-following sea surface and world-space seabed must cover the same
playable offshore domain.

#### 4D. Migrate adjacent water duplication

Once the owner is proven, migrate the separate arena/disaster tsunami and
selected buoyancy implementations opportunistically. Do not combine all ten
buoyancy implementations into an unbounded cleanup wave.

#### Phase 4 exit gate

- issues 37–49 are covered;
- every required yacht is charted inside actual projection bounds;
- no test can pass from a fake enlarged ocean bounding box;
- render, physics, swim, and caustics agree on sampled seabed/depth;
- shader and reflective quality paths share the same horizon contract.

### Phase 5 — ordnance identity and the nuclear event

#### 5A. Fast-track structured cause data

Carry at least weapon/ordnance kind, credited actor, and player-credit flag
through the existing impact/damage/kill path. Reason prose becomes presentation,
not identity.

Prove the exact label **NUKE** for:

- direct-fireball player death;
- expanding-wave player death;
- named-ped wave death;
- crowd death/summary.

Also prove a non-nuclear blast wave does not become `NUKE`. This batch is small
and independent enough to ship immediately after Phase 0.

#### 5B. Review the existing phased-cloud patch as a candidate, not a restart

Keep the white flash and dome. Retain the useful current work if visual and
performance evidence supports it:

- young cloud at dome handoff;
- early/forming/mature phase masks;
- ordinary nuclear puff storm default off;
- no unsourced decorative thermal explosions;
- smoother, non-depth-writing cold lobes;
- phase/puff fields in the audit.

Do not declare it done from the static phase test.

#### 5C. Close the remaining visual and performance gaps

- Replace or justify the planar far card from aerial, side, and underside views.
- Give each detonation a deterministic event seed instead of replaying one
  module-level cloud sculpture.
- Measure whether full cold-lobe counts at low quality preserve appearance
  without creating an unacceptable fixed GPU cost.
- Measure largest apparent lobe/facet, live sprite peak, new allocation beyond
  warm pools, active smoke owner, and phase-consistent bounds.
- Source secondary smoke from actual burning structures, vehicles, vegetation,
  or fuel receivers. Empty pavement and water must produce none.
- Keep the nuke visual owner from invoking the full generic explosion recipe
  inside itself.

#### Phase 5 exit gate

- issues 105–121 are covered;
- the dome remains;
- one owner reports the event phase and apparent bounds;
- no generic nuclear puff storm;
- no unsourced aftermath smoke;
- repeat detonations are not identical sculptures;
- near/far/aerial/underside captures show the same-age cloud;
- performance is measured at each quality tier.

### Phase 6 — resume expansion and reduce long-tail duplication

Only after Phases 0–5 have stable owners should `GAMEPLAN.md` resume:

1. rebase witness/persistence work onto the actor identity/body contracts;
2. expand scale only after staffing, navigation, map, and ocean bounds scale;
3. expand airline/fauna content through the registered vehicle and live-body
   owners;
4. retain the existing item-existence, no-crafting, and physical-cargo
   doctrine.

The large duplication census is not one phase. It is a ratchet queue:

- raw health writes;
- private AI loops;
- purchases/ownership;
- NPC-in-building spawners;
- rank and political ladder copies;
- reputation scalars;
- objective/phone UI copies;
- buoyancy and mission systems;
- jobs absent from `CITY_JOBS`;
- raw material construction.

Each capability phase should lower the relevant counter while migrating real
consumers. A repo-wide abstraction project with no consumers is explicitly
out of scope.

Stat fictions should be handled in small connect-or-cut decisions:

- phone tier with no reader;
- forex with no caller;
- unreachable communist/fascist producers;
- styled slash-chat modes with no parser;
- hyperinflation APIs with no player path.

They do not outrank the shared foundations above.

## 5. Explicit hold list

Do not do any of the following while executing this roadmap:

- Do not continue world-scale/content waves from the old `GAMEPLAN.md` baseline
  while the canonical gate is red.
- Do not repin real failures upward.
- Do not build generic guards to make staffing counts green.
- Do not create a second loyalty, faction, site, vehicle, glass, or physics
  registry.
- Do not build bus, tanker, and refuse truck as three bespoke controllers.
- Do not give the drive-by another private pathfinder.
- Do not turn the touch mode enum into a longer enum.
- Do not add separate car, boat, and aircraft first-person camera systems.
- Do not repair nuclear attribution with a `"blast wave"` regex.
- Do not add another nuclear smoke layer or restore ordinary explosion puffs to
  make the cloud look denser.
- Do not use generic debris as proof that the struck room object was destroyed.
- Do not replace current on-foot first-person feel.
- Do not perform a global physics/ECS/framework rewrite.

## 6. Coverage audit for numbered issues

This table is the final check that no item in the available numbered addendum
fell out during normalization.

| Items | Disposition |
|---:|---|
| 1–27 | provenance gap; recover externally or explicitly mark unavailable in Phase 0 |
| 28–36 | Phase 1A institutional authority and semantic staffing |
| 37–41 | Phase 4A maritime charting; safe fast-track after Phase 0 |
| 42–49 | Phase 4B–4C ocean horizon, bounds, bathymetry, physics, swim, caustics |
| 50–57 | Phase 2A live-body motion/contact |
| 58–63 | Phase 2B physical-prop lifecycle |
| 64–69 | Phase 3E heavy chassis plus bus/tanker/refuse consumers |
| 70–72 | Phase 3A–3B shared seat capability/view; preserve aircraft feel |
| 73 | Open: prose says 26, enforced budget is 40; resolve in Phase 3A |
| 74–75 | Phase 3A–3B road cabin seat socket and shared seat view |
| 76 | Partial: boat mode now separate, hard-coded mode classification remains; Phase 3B |
| 77 | Partial: aircraft view exists, road/boat and capability verb coverage remain; Phase 3B |
| 78 | Phase 3B enter/seat/exit adapters over current lifecycle owners |
| 79 | Design constraint: keep silent single-action rides; surface real multi-verb decisions in Phase 3B |
| 80 | Valid but deferred to Phase 3F network-authority protocol |
| 81–83 | Phase 3D moving-pane adapter, based on Phase 2 physical receiver work |
| 84–86 | Candidate close in current facade patch; Phase 0 live proof or reopen by identified producer |
| 87–91 | Phase 3C common road placement/driver/replan |
| 92 | Phase 2C oriented/swept chassis foundation, then consumed by Phase 3C |
| 93–94 | Phase 3C live occupant mapping and drive-by audit |
| 95–100 | Phase 1B bidirectional indoor routing, steering reset, committed recovery |
| 101–104 | Phase 1C post release/evacuation/return lifecycle and audit |
| 105–107 | Partial: generic wave prose is corrected, but structured kind and exact `NUKE` display remain; Phase 5A fast-track |
| 108 | Protected design constraint: keep white flash/dome |
| 109–111 | Partial current patch; review and finish in Phase 5B |
| 112 | Open planar far-card limitation; Phase 5C |
| 113–114 | Partial smoother/non-depth-writing lobes; visual proof still required in Phase 5B–5C |
| 115 | Partial appearance response with a new fixed-count performance risk; Phase 5C |
| 116 | Open module-level repeated seed/sculpture; Phase 5C |
| 117–118 | Candidate behavior fix: legacy puff storm/walker default off; runtime allocation proof in Phase 5B–5C |
| 119 | Partial: unsourced receipts gated off; actual burning-source aftermath still needs proof in Phase 5C |
| 120 | Partial audit additions; missing visual/allocation/source metrics land in Phase 5C |
| 121 | Target contract and Phase 5 exit definition |

## 7. How `CLAUDE.md` should be organized after truth restoration

Do not delete history before Phase 0 has reconciled it. Afterward, split by
purpose:

1. **`CLAUDE.md`** — owner constitution, current canonical owners, hard
   invariants, Block Law, and exact verification commands.
2. **Issue register** — one row per issue with provenance, status, owner,
   evidence, and closing commit/probe.
3. **Roadmap** — this dependency and phase document.
4. **Session history** — dated narratives about what was found and fixed.
5. **Generated/latest audit record** — dated gate outputs and calibrated
   baselines, so prose does not masquerade as current measurement.

The key organizational rule is simple: constitutions do not expire, owners
change deliberately, issue status needs evidence, and historical reports stay
dated. Mixing those four kinds is what made a large useful document look like
121 independent instructions.
