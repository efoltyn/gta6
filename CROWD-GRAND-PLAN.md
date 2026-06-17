# CELL BLOCK Z — THE GRAND CROWD PLAN

**Status:** Committed design doc, v1.0. Lead-architect synthesis of 5 research dossiers, 6 adversarial critiques, and a full codebase audit. Ground-truth-verified against the working tree on 2026-06-15.

**One-line scope:** Turn the city crowd from "uniform camera-locked instanced wallpaper + ~100 hero brains" into a *real 1000+* — souls that animate together via a cheap shared signal, gain local contact physics **only where dense and threatened**, carry name/identity on every body, with smarter cops/shooters/night-homeless — **at lower GPU cost**, flag-gated, MP-safe, single main thread, Three.js r128, no build.

> **Read this first — the three honesty corrections that reshape the plan.** They are load-bearing; the rest of the document assumes them.
>
> 1. **"More bodies, LOWER cost" is TWO claims, and only one is true.** *Lower GPU / draw-calls* is real and is delivered by the RENDER work (Phase 1). *Lower CPU* is **false** — the crowd-brain layers (flow signal, density, contact) are net-NEW main-thread CPU. They are justified by **capability**, paid for by a **hard per-frame token budget**, not by a saving that does not exist on a single thread. Every place this document would have said "costs less," it now says "costs less on the GPU; the new CPU is budgeted, not free."
> 2. **The census size is DECOUPLED from the simulated/rendered body count.** Raising the soul ledger to thousands is **ledger-only** (position = `f(soul, clock)`, ~0 per-frame). A fixed, small **N_SIM** set (≤256 near-ring) ever runs sim/steer/contact in a frame, regardless of how many souls exist. The existing crowd passes that iterate `0..count` must be re-pointed at a compacted **active-near index list**, or "CAP→2000" silently multiplies today's per-frame cost ~2.6× for nothing.
> 3. **The dt bug is time-DROPPING, not a spiral.** `loop.js:69` does `dt = Math.min(dt, 0.05)` then discards the surplus — at ~5 fps the world runs at **25 % wall-clock** (deterministic slow-motion), it does not spiral. The Gaffer accumulator is still the destination, but it must be **scoped to the crowd subsystem**, never bolted onto the whole un-accumulated legacy loop (that would introduce a *real* spiral the code does not have today).

---

## 1. EXECUTIVE SUMMARY

We are building a layered crowd that **looks like one organism at rest and shatters into individuals under threat**. At peace, hundreds of instanced bodies stroll on a cheap shared signal and thousands of *souls* exist only as data placed at home/job anchors. When the player does something violent in a packed place, a small local **flee signal** is stamped, the few hundred bodies near the camera scatter directionally, and inside the genuinely-dense cells a hard-capped number of them **bump, trip, and trample** into a flat carpet of downed, **named** bodies with a few real verlet ragdolls writhing on top near the lens. Cops and shooters are smarter because they are few and can afford real brains that *read* the density and *write* the flee signal. The whole thing renders for **fewer draw calls than today** because we merge hero rigs and batch the static city — which is where 96 % of the GPU actually goes.

**The one-paragraph why:** The owner's felt complaints — "the background crowd ignores gunfire," "density is uniform everywhere," "it wades in slow-motion under load," "cops/shooters are dumb," "it costs too much on the GPU" — are five *different* problems that the audit shows are ~60 % already solved in-tree (instanced mass, verlet ragdolls, the schedule census, context-steering, wall batching). The missing 40 % is concentrated in two places: **the render layer** (merge the 16-mesh hero rigs, batch the static city — the actual GPU win) and **a cheap flee-reaction hook into the instanced mass plus a tightly-capped contact-physics exception**. Everything else is finishing work on systems that exist. This plan is excessively thorough because the owner ships flag-gated, MP-safe, **not-play-tested** changes into a moving substrate — so the discipline (budgets, baselines, contract harnesses, ownership rules) matters as much as the features.

---

## 2. THE ARCHITECTURE, LAYER BY LAYER

Concrete numbers throughout. All thresholds are **starting points to be measured on the weak Mac in Phase 0**, not gospel.

### L-TIME — the crowd clock (prerequisite, gates everything)

**Verified current state:** `loop.js:69` clamps world `dt` to 0.05 s then drops surplus wall-clock. `feelDt` (loop.js:34-61, `FEEL_MAX_CITY=0.12`) already decouples *player/camera/projectile* feel but does **nothing** for the NPC sim, which still advances at 25 % real-time under load. Census fast-forward keys off wall-clock `Date.now()`, not `dt` — correct and immune to the clamp.

**Design:**
- A **fixed-step accumulator for the crowd/contact subsystem only** (NOT the whole game). Accumulate `realDt`; run L0/L1/L2 in fixed `SIM_DT = 1/30 s` steps; **cap at `MAX_CATCHUP = 3` steps/frame**, then discard the remainder. This bounds an L2 spike to ≤3 contact solves/frame.
- Keep the legacy world `dt = min(dt, 0.05)` clamp for all existing non-fixed-step systems (removing it *is* a real spiral risk for code that was never written for an accumulator).
- Census/schedule fast-forward stays on wall-clock. Preserve it.
- **Honest limitation (from the CPU-budget critique):** `MAX_CATCHUP` drops *time*, not *work*. If the marquee frame blows the per-frame CPU budget, the cap converts the overload back into the 25 % slow-mo the project considers its top bug — **now triggered deterministically by the feature's own showcase**. The fix is therefore NOT the accumulator alone; it is the **token budget (§2 L1/L2)** that bounds work so the cap rarely fires. The accumulator is the floor; the token budget is the ceiling.
- Flag: `CBZ.crowdFixedStep` (default OFF until proven).

### L0 — shared movement signal (REVISED HARD: cut the ambient field; wire the existing panic bus to the mass)

**The contradiction, resolved.** Five dossiers say "continuum crowds is the L0 backbone." Two adversarial lenses (#12 "when flow fields are WRONG," #9 single-thread ceiling) **and the over-engineering lens** converge: a city-wide per-frame Eikonal field is the wrong tool here. The map is small (342 m), population moderate (~800 active), and every crowd agent already has a *distinct* goal — the canonical worst case for one shared field ("line of ants"). Benchmarks show flow fields *losing* to per-agent steering at our scale (200 units: 6 ms field vs 5.1 ms A*). Treuille's own numbers: 2-5 fps for 1-2k agents on a 120×120 grid in native C — a per-frame full solve is impossible single-thread JS.

**The decisive audit finding:** the **schedule census (L3) already IS** the "one cheap thing drives thousands" mechanism (`actOf(kind,hour)` + home/job anchors → O(1) far-position, zero per-frame solve). A second global navigation grid is *redundant work.*

**The decisive over-engineering finding:** the codebase **already ships door-aware, contagious, bravery-varied, MP-wired panic** — it is just not wired to the instanced mass. Verified: `CBZ.cityPanic(x,z,power,offender,blast)` (peds.js:1004) does proximity-scan → flee state → `fleeFrom` (routes to real doors/exits via cityNav, so it won't bolt through walls) → fear/alarmed decay → cower + scream; `CBZ.cityAlarm` adds witness memory; `cityevents.js` is a complete 2nd-gen event ring (`CBZ.cityPostEvent`, 24-slot alloc-free) with 4 m neighbor **contagion** and aggr-derived **gawk-vs-flee**, bucketed through the same `CBZ.makeGrid` we already have. These are **already called by** gunfire (combat.js:895), explosions (explosives.js:246), corpses/robberies/heists (aigoals.js:1387, shops.js:631, heists.js:460). `cityevents.js`'s own header names the one gap: *"the instanced ambient crowd (crowd.js) has no public flee hook."* Confirmed: `crowd.js` reads `alarmed/fear/panic` **zero** times.

**Therefore L0 = two narrow things, and we BUILD almost nothing:**

- **L0a — Ambient: KEEP per-agent waypoint steering.** `crowd.js` stroll for the mass, `citynav` context-steer for heroes. Cheaper than a field at our count and already multi-goal. Bias spawn/relocation by existing district weights (`nightCum`, `weightedSidewalkPoint`). **No ambient flow field is built.** Deliberate cut; the plan's most defensible CPU saving.

- **L0b — Flee: wire the existing panic bus into the instanced mass (NOT a BFS flee-field).** This replaces the draft's ~400-LOC Int16 Dijkstra flee-field with a ~40-60 LOC hook (the over-engineering lens' single most-damaging, fully-justified cut):
  - Add two `Float32Array(CAP)` to the crowd SoA: `panicT[i]` and a unit away-heading `fleeHX[i]/fleeHZ[i]`.
  - In `CBZ.cityPostEvent` delivery (or a thin subscriber), when an event lands, bucket the instanced mass via the **already-built** `_bumpGrid` (`makeGrid(2.0)`) and for agents inside radius set `panicT[i]` and `fleeHX/Z = normalize(px-ex, pz-ez)` — clamped to a couple hundred agents/event (all that's near-camera anyway).
  - In the existing per-agent crowd step, while `panicT[i]>0`: steer toward `fleeHX/Z` at sprint speed and decay `panicT`, reusing the `heading/spd` fields that already drive the stroll.
  - The existing `_bumpGrid` separation + bump-knockdown chain (which already does sprinter-ploughs-a-line cascades, `stagT` skids, capped promote-to-ragdoll, and `corpseT/collapsedQ` prone instances) then produces trip/trample **for free** once the fleeing mass packs up.
  - **Flag:** `CBZ.crowdMassFlee` (default OFF).
  - **MP:** replicate **nothing new** — panic is reconstructed on each client from the event that *already crosses the wire* (or is purely local Class-A decoration). The event pipeline (`netRagEmit`/`frx`/`cityPostEvent`) is ready.
  - **Why door-aware beats a raw gradient (kept from the cut analysis):** `fleeFrom` already routes hero peds to real exits; a raw flee-field gradient would send the mass through walls. The unit away-heading is the cheap mass version; collision push-back + the existing `fleeFrom` for promoted bodies keeps it honest.

> **Open-Question #1 is therefore DELETED, not answered.** "Does the ambient-field cut survive?" is moot — there is no ambient field to cut a second time, and the felt result (mass scatters from gunfire, directionally, with contagion and gawkers) ships on existing rails. The *real* question for the owner (Open-Question O1 below) is whether they want anything fancier than extending the existing panic to the mass.

### L1 — local avoidance (KEEP context-steering; extend only inside hotspots)

**Verified current state:** `CBZ.cityNav.contextSteer` (citynav.js, 8-slot danger/interest, alloc-free, sub-slot interp) drives ~100 hero peds via a per-frame `_pedGrid` (peds.js:56-65). The 760 instanced mass gets only collision push-back (`CBZ.collide`).

**Design:**
- This is **already the right L1.** Every dossier ranks context-steering above ORCA for an FPS city (deadlock-resistant, no UNC license, natively fuses a signal as "interest"). **Do NOT adopt RVO/ORCA broadly.** Reserve ORCA-class only for the *few* smart agents if ever needed (pure-JS port exists; cap ≤60 near-camera, maxNeighbors=8).
- Fuse L0b into L1 as an **interest hump** (flee direction = strong interest), not a vector add — solves the "global goal vs local dodge cancel to zero" failure.
- Optionally extend a *cheap* density-dodge to instanced bodies **inside flee hotspots only** (if cell density > threshold, bias steer perpendicular). Not citywide.
- **N_SIM discipline:** L1 neighbor work runs on the **active-near set only** (≤256), via the compacted index list, never `0..count`.
- Flag: existing path stays default; `CBZ.crowdMassAvoid` gates the hotspot extension.

### L2 — density → contact physics (the headline; the biggest risk; hard-capped)

**Verified current state:** verlet ragdoll (ragdoll.js): `MAX_ACTIVE=14`, `POOL=36`, `ITER=3`, 2 substeps (`KICK_DT=1/120`), LRU early-freeze, sleep `SLEEP_V=0.22`/`SLEEP_T=0.6`, `MAX_LIFE` cap. **Kill-triggered only** — no density sensing, no contact→brain, no trample. `crowd.js` already has `_bumpGrid=makeGrid(2.0)`, `corpseT`/`collapsedQ` prone-instance lay-flat, `stagT` skids, and a `dyt` dying-beat.

**Design — gated, capped, hotspot-only, positional-not-penalty:**

- **Density grid (additive, NOT a rewrite — integration-discipline cut):** the draft proposed converting `_bumpGrid` into a dense counting-sort. **Cut to additive.** `_bumpGrid` is load-bearing for collision/thin/promotion and the file is currently dirty; replacing it in-place in a churned file is exactly where a parallel wave's merge silently reverts the change. **Build the density counting-sort as a NEW `CBZ.makeGrid`-style structure read by L2 only; leave `_bumpGrid` untouched.** Accept the marginal double-count cost until `crowd.js` has a settled baseline. The new structure uses Müller's 3-array counting sort (`cellStart` prefix-sum + `cellEntries` + `cellCount`) so **per-cell density is a free byproduct of the count pass.** Cell = 2 m (cellArea = 4 m²).
- **Thresholds** (crowd-safety literature → agents/cell at 2 m): AMBIENT < 2 ppl/m² (≤8/cell) = no contact; DENSE ≥ 3.5 ppl/m² (~14/cell) = gentle positional repulsion; DANGER ≥ 5 ppl/m² (~20/cell) = enable TRIP rolls; CRUSH 6-7 ppl/m² = cascading trample. Hysteresis: enter at 5, exit at 4, so cells don't strobe.
- **Hard gate:** contact activates in a cell **only when** density ≥ DENSE **AND** a flee signal is live in that cell. Calm packed sidewalks never trip.
- **Force model — POSITIONAL (PBD/Verlet), NOT raw Helbing penalty forces.** Adversarial lenses #2 and #7 are emphatic and Köster 2013 proves it: Helbing's stiff contact terms (k=1.2e5, κ=2.4e5) need dt≈1 ms and *explode* at 16 ms with any overlap; the model is non-Hamiltonian with a discontinuous RHS and oscillates even at tiny dt. The ragdoll solver is **already PBD-style Verlet (Jakobsen)** — reuse it. Implement contact as positional move-apart constraints + a capped social-force *nudge*: clamp |force|, floor penetration ≤ 0.15 m, cap velocity ≤ 1.3·v0, run on the L-TIME fixed clock. The literal "1600 N/m" injury number becomes a *tuned positional trigger*, not a real force.
- **Over-pressure → trip → ragdoll LOD ladder:**
  - **Tier A (full verlet):** nearest ≤14 (existing pool). sqrt-eliminate the stick solver (Jakobsen Taylor form: `delta *= rest²/(dot+rest²) − 0.5`, precompute `rest²`) to remove ~1.5k sqrt/frame and buy headroom.
  - **Tier B (cheap topple):** 2-stick, ITER=1, ~10× cheaper, ≤16. Used 22-45 m or on overflow past the Tier-A cap.
  - **Tier C (prone instance):** **already exists** — `corpseT`/`collapsedQ` lay a body flat in the instanced mesh (~11 draw calls total, zero new geometry). Everyone else.
- **TOKEN BUDGET (the CPU-budget critique's re-charter — mandatory):** the three independent "gates" the draft relied on (distance-stride, hotspot-only, AI slice) are **100 % correlated under mass-flee** — a near, packed, fleeing crowd maximizes all three denominators at once (stride drops to 1 because the crowd packs into the near ring; "hotspot-only" becomes "everywhere visible" because the whole near-field is one contiguous hotspot). Replace them with **ONE token-bucket scheduler** (the `PROMO_CAP_FRAME=4` pattern already proves this works): a fixed per-frame budget of *think tokens* + *contact tokens* + *promotion tokens*. Under mass-flee the bucket drains and **overflow agents fall back to the cheapest tier** — instanced flee-gradient slide (zero neighbor work) + `stagT` skid + Tier-C prone. **Graceful degradation of FIDELITY, never of frame time.** Concrete caps: ≤~32 *contacting* bodies, ≤14 Tier-A verlet, ≤2 new trips per 100 ms (so the eye can follow each).
- **Trample cascade — WITHOUT corpse-phasing (the jank critique's confirmed bug).** Verified: every collide/grid pass in `crowd.js` guards `corpseT[i] > 0` / `corpseT[i] <= 0` (lines 886, 991, 1092, 1145) — downed bodies are **skipped** in the hot path, so living agents already phase through fresh corpses today. Naively removing that guard puts corpses into broadphase (cost + a re-trip feedback jitter). **Resolution:** keep the `corpseT<=0` exclusion for broadphase *movement cost*, and add downed bodies to a **separate cheap obstacle test only inside live flee-hotspot cells**, as a **single repulsion disc of radius ≥ 0.6 m** (a sprinting hero step is larger than 0.4 m, so a 0.4 m disc lets fast fleers straddle/clip it — the single most "this game is broken" tell). Resolve as a positional shove that reuses the existing `stagT` skid render, so a near-miss reads as "stumbled over a body," not "walked through it." The disc clears when `corpseT` fades.
- **Contact → brain:** a tripped agent must flag its *AI* downed (today only the render rig topples; the brain keeps walking). One boolean back-channel.
- Flags: `CBZ.crowdContact` (master), `CBZ.crowdTrample` (cascade).

> **Honest deliverable (jank + CPU critiques):** a true *stacked* mound is impossible with cheap LOD (Tier-C is flat). We ship **a dense flat carpet of downed bodies + a few real verlet bodies writhing on top near camera.** Do not promise a physical heap.

### L3 — identity / census (mostly DONE; finish persistence; CAP raise GATED)

**Verified current state (schedule.js):** 600-LRU ledger, anchors **exist** (`hx/hz/jx/jz`, lines 228-238), `actOf(k,h,salt,job)`, `fastForward` keyed to wall-clock, `cityPedDeal` binds soul→body within `DEAL_R2=45²`, vendor sids, serialize at line 441 (`if (list[i].alive)` — **drops the dead**), apply at line 450 (`e.alive = true` — **resurrects them**). `liveBy` is a live map, **never serialized**.

**Design — close the real gaps:**
- **Persistent death (RED test first):** carry `{dead:true, deadT, deadKind}` on the entry, **keep it in serialize**, and on apply skip re-dealing a soul `dead` within a city-day window. Today `dropSid` *deletes* the dead from the book — change to *flag* not delete, so "stays dead at this spot" is queryable. (`becomeHost` calls `spawnCityPeds` immediately at net.js:143 while `worldBlob` applies later at `settleT>0.4` — see §6 host-migration race.)
- **On-load fast-forward of ALL souls:** today fast-forward runs lazily per-soul at deal-in (16/2 s sweep). For a living city on reload, walk the whole book once on load (bounded ≤48 sim-hours, already capped) so positions = schedule anchor at load-clock.
- **CAP 600 → ~2000 — GATED behind the serialize-budget test (integration cut).** The draft put CAP→2000 in Phase 2; **defer it until AFTER a loud serialize-budget test exists** and the L3 ownership rule is enforced. Shipping 2000 verbose souls (~389 B each ≈ 1.9 MB) silently **exceeds the 1.4 MB relay cap** and `sendWorld()` early-returns with **no error surfaced** — the single most likely silent breakage (it disables host persistence). Keep CAP at 600 for the initial persistence work; prove death-flags + on-load fast-forward at the safe count first; then trim entries to ~155 B (short keys, quantize anchors to 1 dp, drop names for un-named souls/regenerate from seed, relationships as an id-referenced edge list) and raise CAP, behind its own flag, with the budget test as a hard CI gate.
- **Vertical occupancy (fixes UNIFORM density — the owner's core complaint):** per-floor job/home anchors; `actOf` "home"/"work" pins a fraction of souls **indoors** (counted, earning, NOT on the sidewalk). Streets thin at work hours without losing population. **Souls indoors are scheduled-teleport** (snap to floor anchor when off-camera), NOT field-routed up stairwells — avoids a buildings.js interior-nav rewrite.

### L4 — smart agents + distribution

**Verified current state:** cops hunt (police.js `findIssueNear`, `npcTarget`), aggression spectrum drives shooters (peds.js aggr tiers), night-vagrants coded, utility-AI scores ~1/30 peds/frame (aigoals.js:1244 `ceil(n/30)`). **No density-reading, no signal-writing, no vertical model.**

**Design (de-scoped to the one genuinely-new thing — over-engineering cut):**
- Cops/shooters **READ the density grid + the event ring** to cordon at chokepoints, flank, and predict flight. They're FEW so they afford real A* over a coarse road graph (distinct goals = where A* beats fields). **Drop "cops read the −gradient of the flee field"** (there is no flee field) — read the cheap density grid + `cityPostEvent` directly.
- Threats **WRITE** the flee signal (a gunshot already stamps `cityPostEvent` → now also stamps the mass `panicT` via L0b). Highest-impact/lowest-cost feature: 1000 bodies react to a shooting for nearly free.
- **Telegraph cop intent** (shout, point, spotlight) so flanking reads as skill, not teleport-cheating (anti-uncanny). Reaction latency 150-400 ms so panic isn't "they flee before you fire."
- **Anti-uncanny rule:** "smarter" = *readable, counterable* tactics, NOT omniscient prediction.

### RENDER — the actual "lower GPU cost" win (HIGH PRIORITY; framing demoted; one sub-feature CUT)

**Verified current state:** instanced mass = 10 part `InstancedMesh` + 1 shadow = **11 draw calls** for 760 (correct the brief's "~7"), `castShadow=false`, `frustumCulled=false`. Hero rigs ~16 meshes × ~100 = ~1600 calls; `character.js` animates them via ~43 per-frame DOF writes (sine-gait + damp + limp + cringe + weapon hold + torso bob/sway/lean); `gore.js` severs limbs at runtime via `part.visible=false` + stump swap (line 495). Static city ~5000 calls (96 % of GPU). `CBZ.wallBatch` (batch.js) already merges static walls with a **by-hand `mergeGeometries` splice** (line 112; the vendored util is `mergeBufferGeometries`).

The browser/r128 critique is correct that the draft inverted its own risk ordering. **Re-scoped:**

- **PROMOTE the static-city `wallBatch` extension + the `carGrid` fix to be the LEAD GPU phase.** These are the only crowd/render changes that are proven-pattern, no-build, MP-neutral, and mobile-safe; `batch.js` already refuses character groups by design, and extending it over more of the ~5000 static draws attacks the *actual* 96 % bottleneck while touching no character/material/shadow code. This is the safe down-payment; the hero/impostor work moves *after*, with its real (smaller) measured number.
- **Hero-rig merge — RE-SPEC to the static, non-severable, single-material subset only (DE-SCOPED from "16→2").** The critique is right: you cannot collapse to 1-2 draws without (a) re-deriving all ~43 DOF as GLSL, (b) breaking `gore.js` amputation (a merged buffer has no per-part `.visible`), and (c) collapsing the per-outfit painted-cloth materials (`clothes.js`, shipped Waves 23-24). **Keep `ll/rl/la/ra` (arms/legs) as separate animated + severable Object3Ds; only merge the static, same-material subset (head/neck/hair/cap/collar/torso) IF they share a material after `clothes.js` paints — they often do not.** Honest figure: **16 → ~10-12, roughly −400 to −600 draw calls across ~100 heroes, NOT −1400.** Use the existing by-hand `batch.js` splice (`CBZ.heroRigMerge`), done once at spawn. **Stop citing "merge 16→2."**
- **In-shader stride — CUT ENTIRELY (`CBZ.crowdShaderStride`).** The critique is decisive: `onBeforeCompile` appears in **zero** of 89k LOC, r128 has no stable chunk-name contract, it must be mirrored into the **separate** shadow `InstancedMesh` (`shadowQ`) material or shadows desync (the draft's own risk #11), and it *widens* the gait mismatch at the promotion seam (jank critique) for a CPU saving the budget shows is not the bottleneck (render is). **The mass already costs only ~11 draw calls.** Get the matrix-write win the codebase already knows how to do: **amortize `instanceMatrix` writes (rolling 1/3 per frame), compose translation/rotation directly into the Float32Array (no per-instance `Matrix4` alloc), skip parked/`collapsedQ` instances.** Zero shader risk.
- **Impostor far-LOD — RE-SPEC as camera-pitch-gated, or CUT (jank + r128 critiques).** `MAX_PITCH=0.72 rad (~41°)` is verified (camera.js:23), and the shipped chopper-pickup / airstrike-jet give near-top-down views — a single flat yaw-atlas quad **pancakes from above**, and the impostor *adds* a pop boundary (instead of removing one) on a roof-down-capable camera. **Decision:** use the existing `quality.js` `ped.vis` distance ladder (55→110 u) as the primary far-cull; enable billboard impostors **only when `cam.pitch` is below a near-horizon threshold**; above it (downward/aerial view) fall back to the existing distance-cull or a **crossed-quad (2 planes)**, never a single flat quad. If that ordering can't be made cheap, **cut the impostor tier** — it is net-new, roof-fragile, and not required for "more bodies, lower GPU" (the rig-merge + static-batch are the real wins and carry no continuity cost). Flag: `CBZ.crowdImpostor` (default OFF).
- **InstancedMesh discipline:** `frustumCulled=false` means every instance hits the vertex shader, so fill-rate (not draw calls) is the phone ceiling for 1000+; per-instance cull (pack-to-front + clamp `.count`) on mobile tiers; lean on `quality.js` to drop the instanced CAP + hero count on weak devices. **Mobile defaults must NOT enable the rig-merge/impostor paths on tiers 0-1** — the static-batch + matrix-amortize wins are the only crowd-render changes weak phones get.

> **The public promise, stated honestly:** "more bodies, LOWER GPU" is **CONDITIONAL on a Phase-0 measurement on the real weak Mac**, because the render savings are roughly **half** what the draft claimed once live articulation, runtime severing, painted materials, and the 41° camera are honored. The static-batch extension is where most of the win actually is.

### CONTINUITY — the LOD-seam contract (the jank critique's prerequisite; new section)

The jank lens is right that the felt bottleneck is **seams, not physics**, and the plan as drafted *multiplied* them. Verified: the mass gait (`crowd.js drawParts`, swing-only, no knee, phase `spd*2.4`) and the hero gait (`character.js`, knee-bend + foot-lift + sway + lean, phase `2.3+speed*0.92`) are two phase-independent systems; promotion (`assign`, crowd.js) snaps a body mass→hero at PROMO_IN2=22 m / PROMO_AHEAD2=40 m — **in clear view** — and on that frame **resets the gait phase (`phase[i]=Math.random()`, line 387)** and can re-roll identity/outfit (`cityRecastForHour`/`cityPedDeal`). So today every NPC you walk toward already "blinks" its walk cycle (and sometimes its clothes) at 22-40 m. These are **made a hard acceptance gate BEFORE L2/impostor ship**:

1. **Phase handoff:** promotion seeds the hero rig's `ch.phase` from the mass `phase[i]` (and seeds mass phase from the rig on demote) instead of `Math.random()`. ~5-line change in `assign`/`park`; kills the gait-restart hitch for free. Unify the cadence constant (mass `2.4` vs hero `2.3+speed*0.92`) so the seam reads as one gait.
2. **Identity freeze across the seam:** do **NOT** re-roll archetype or run `cityPedDeal` re-skin on a body the player is actively looking at within ~45 m; pre-commit each ambient agent's identity (it already carries skin/shirt/hair indices) so promotion only ADDS brain, never changes appearance. Re-rolling is allowed only for agents promoted off-screen / behind the camera. (This is also the historical "the swap was a lie" / "grey tycoon" bug class — the existing `_sidFresh`/`_wasParked` idempotence guards must survive.)
3. **Push the pop out of sight:** if the impostor tier ships, order must be **impostor(far) → hero-rig(near)** with the mass tier filling only the band the camera can't scrutinize — NOT impostor→mass→hero with two visible pops.
4. **Acceptance bars (Phase-1/Phase-4):** "no gait/outfit restart within 45 m of camera" and "no agent visibly phases through a downed body within 30 m of camera." Phase continuity is checkable in the headless harness; phasing needs one play-test pass.

### PERSISTENCE / MP — see §6 (consolidated).

---

## 3. WHAT EXISTS vs WHAT'S NET-NEW

Reuse ratio **~60 %**. Net-new concentrated in L2 (contact) and RENDER (merge). Effort: S ≤150 LOC, M ≤500, L ≤1000.

| Layer | Exists (verified) | Net-new | Effort |
|---|---|---|---|
| **L-TIME** | `feelDt` decouple (loop.js:34-61); wall-clock fast-forward | Crowd-only fixed-step accumulator + `MAX_CATCHUP=3` | S |
| **L0a ambient** | crowd.js waypoint stroll, district weights, night redraw | **Nothing — deliberate keep** | 0 |
| **L0b flee** | `cityPanic`/`cityAlarm`/`cityPostEvent` (door-aware, contagion, gawk, MP-wired); `_bumpGrid` | `panicT`/`fleeHX/Z` SoA + the missing crowd.js flee hook (~40-60 LOC) | S |
| **L1 avoid** | `contextSteer` 8-slot alloc-free; `_pedGrid` | Hotspot-only mass density-dodge; flee-as-interest fuse; N_SIM active-near list | S |
| **L2 contact** | Verlet pool (14/36), `_bumpGrid=makeGrid(2.0)`, `corpseT`/`collapsedQ` prone, `stagT` skid, `dyt` buckle, re-kick wake | **Additive** density counting-sort grid; PBD positional contact; trip trigger; Tier-B topple; ≥0.6 m trample-disc; contact→brain flag; sqrt-elim; **token budget** | L |
| **L3 census** | 600-LRU ledger, `hx/hz/jx/jz` anchors, `actOf`, `fastForward` (wall-clock), `cityPedDeal`, vendor sids, serialize/apply | Persistent-death flag in serialize; on-load full fast-forward; **CAP→2000 gated behind budget test**; ~155 B trim; vertical/per-floor anchors | M |
| **L4 smart** | cop hunt, aggr shooters, vagrants, utility-AI 1/30 | Density-read + event-ring-read for cops; telegraph + reaction latency; vertical job routing | M |
| **CONTINUITY** | (none — seams are live today) | Phase handoff, identity-freeze-near-camera, LOD ordering, acceptance bars | S |
| **RENDER** | `wallBatch` by-hand splice, instanced mass (11 draws), `VIS_D2`/`SHADOW_D2` LOD, `quality.js` 5 tiers | **Static-city batch extension (lead)**; hero-rig merge 16→~10-12; amortized matrix writes; pitch-gated impostor (or cut). **In-shader stride CUT** | M |
| **MP/persist** | host-auth, scoped 10Hz snapshots, `worldBlob`, `netRagEmit`, `cityPostEvent` | **Delta+priority snapshotter (prerequisite)**; Class-B per-guest cap ≤64; event-lane priority; death deltas; seed persist; carGrid string-key fix | M |

---

## 4. PHASED, FLAG-GATED BUILD ROADMAP

Each phase: independently shippable, OFF-by-default, clean "OFF == today." Ordered so a later regression can't break an earlier phase and so the cheapest/highest-value/lowest-risk work lands first. The owner ships flag-gated + MP-safe + **not-play-tested** — so the discipline phases (-1, 0) are load-bearing.

### PHASE −1 — FREEZE-AND-BASELINE + contract harness (integration critique's prerequisite; NEW)

The "OFF == today" guarantee is **structurally false** until the substrate stops moving: 6 of 8 target files are dirty (`crowd.js peds.js ragdoll.js vehicles.js batch.js loop.js`), `citynav.js` is untracked, and the prior commit was a never-play-tested 51-file consolidation.

- **Commit and tag the current dirty tree** (the 6 `M` + the untracked city files) as a named baseline.
- **Write a "crowd identity & persistence contract" harness** (extends `tools/harness.js`, Node-stubbed — these are pure-state asserts, NOT render):
  - (i) every promoted body's `_sid` matches the soul `cityPedDeal` dealt it, and survives a kill→recast→re-deal cycle **without identity bleed**;
  - (ii) `cityNpcLedger.serialize()` length stays under a budget (set ~900 KB) with a **HARD test failure** (not the silent 1.4 MB relay drop) so the CAP→2000 bump is caught the instant it overflows;
  - (iii) a dead soul **stays dead** across serialize→apply (the L3 death-flag fix, written as a RED test first).
- Converts three silent-corruption modes into loud CI failures — the only substitute for play-testing the owner accepts.
- **Position-ownership rule, written down (not an open question):** *far souls (off-camera) are owned by the schedule/census; near souls (inside `NEAR_R≈90`) are owned by the reseed/promotion machinery; the handoff is `park()/cityPedStash`, which already banks identity.* L3/L4 vertical occupancy may **only** move souls in the census-owned far region (teleport-to-floor-anchor when off-camera). This forbids the census from writing positions inside the camera ring, keeping the documented "82 %-near-camera" reseed regression dead.
- **Single shared ordering gate:** introduce one `CBZ.cityWorldSettled` boolean that every new cross-subsystem applier (death-flag apply, seed adoption on host-migration, flee replication) checks — fix the ordering contract **once**, not per-feature.
- **Serialize the build against parallel waves:** land render and contact edits on `crowd.js`/`ragdoll.js` as **exclusive, rebased-on-baseline** edits; re-run parse-verify + the contract harness after **each**, so a later wave's merge can't silently revert a flag default or a sequencing guard.

### PHASE 0 — measurement + free foundations (no behavior change)

- Headless harness extension: spawn the **WORST case** (N near + all-flee + max density) and assert total crowd ms ≤ a fixed ceiling on the weak Mac with the token bucket draining — **not** grid invariants on a calm crowd (the CPU critique: "a budget only measured calm is not measured").
- Instrument `renderer.info.render.calls` per subsystem; establish the ms sub-budget table (§5). Profile on the weak Mac first.
- **Fix `carGrid` string-key** (vehicles.js:1768 `gx + "," + gz` + fresh `[i]` arrays → route through `CBZ.makeGrid`; the dedicated `_carGrid` at :2018 already does). Free win, MP-neutral, validates the pattern.
- Flag: none (or `?profile=1`).

### PHASE 1 — RENDER (the GPU win; lead with the SAFE half)

- **(1a, lead) Extend `wallBatch` over more of the ~5000 static draws.** Proven pattern, no-build, MP-neutral, mobile-safe, touches no character code. This is where most of the win is.
- **(1b) Hero-rig merge static-subset** (`CBZ.heroRigMerge`, 16→~10-12, preserves limb articulation + severing + painted materials).
- **(1c) Amortized `instanceMatrix` writes** (rolling 1/3, no per-instance `Matrix4`, skip parked).
- **(1d, optional) Pitch-gated impostor** (`CBZ.crowdImpostor`) — or cut.
- **In-shader stride: NOT BUILT (cut).**
- **Acceptance:** draw calls down **measurably on the real weak Mac** (publish the number — the public claim is conditional on it), frame time down, zero behavior change. Continuity bars (no gait/outfit restart within 45 m) hold. This phase *pays for* later CPU work on the GPU axis only.

### PHASE 2 — L-TIME + L3 persistence (cheap, unblocks the rest; CAP raise SPLIT OUT)

- Crowd fixed-step accumulator (`CBZ.crowdFixedStep`).
- Persistent death + on-load fast-forward + seed persist — **proven at CAP 600 first**, against the Phase −1 RED tests.
- Vertical occupancy anchors (fixes uniform density; high perceived value, no physics).
- **CAP→2000 is a SEPARATE, later sub-phase** behind its own flag, landing **after** the serialize-budget test and the ~155 B trim and (for MP) **after the delta snapshotter** (Phase 6). Do not ship 2000 souls on the current `vals()` full-dump under any flag.
- **Acceptance:** dead souls stay dead across reload (contract test green); streets visibly thin at work hours; population unchanged; saves load with migration/back-compat.

### PHASE 3 — L0b mass-flee + L4 read (the "1000 react to a gunshot" moment)

- Wire `cityPostEvent` → crowd `panicT`/`fleeHX/Z` (`CBZ.crowdMassFlee`), the missing flee hook the codebase flagged.
- Cops read density grid + event ring; threats already write the event; telegraph + reaction latency.
- MP: **nothing new on the wire** — panic reconstructed from the existing event.
- **Acceptance:** a gunshot scatters the visible mass believably and directionally (door-aware, with contagion + gawkers), cops cordon chokepoints, no per-frame net spike.

### PHASE 4 — L2 contact physics (the headline; highest risk; LAST)

- **Additive** density counting-sort grid (free density; `_bumpGrid` untouched).
- PBD positional contact + trip trigger, hotspot+flee-gated, behind the **token budget**.
- Ragdoll LOD ladder (A existing / B topple / C prone) + ≥0.6 m trample-disc + contact→brain. sqrt-elim.
- Replicate as events; host-only sim.
- **Acceptance:** in a packed fleeing plaza, bodies bump/trip/trample legibly with a hard cap (≤32 contacting, ≤14 verlet, ≤2 trips/100 ms); **never** on calm crowds; **frame time locked by the token budget** (worst-case-first proof from Phase 0); **no corpse-phasing within 30 m**; named victims tagged; guest sees a correlated (not identical) cascade. **One play-test pass for the continuity/phasing bars** (the one place the no-play-test rule must bend).

### PHASE 5 — L1 mass-avoidance polish (optional)

- Extend context-steer/density-dodge to instanced mass **inside hotspots only**.
- ORCA-class only if context-steer proves insufficient, ≤60 near-camera, own flag.

### PHASE 6 — MP delta+priority snapshotter (PREREQUISITE for any CAP>600 / Class-B widening; see §6)

Listed last numerically but is a **hard gate** in front of the CAP→2000 sub-phase and any widening of networked NPCs. The failure only manifests with 2+ players in one crowd — which the no-play-test rule will never catch — so it must be a blocking prerequisite, not afterthought polish.

---

## 5. PERFORMANCE BUDGET & REALISM

**Hard frame budget: 16.6 ms (60 fps desktop Mac target). Phone: 1/3-1/5 the agent counts, separate flags, fill-rate-bound.**

Per-layer ms sub-budget (desktop, to be validated worst-case-first in Phase 0):

| Layer | Budget | Scaling | Notes |
|---|---|---|---|
| L0b flee hook | < 0.3 ms | O(agents-in-event-radius), clamped ≤~200 | reuses `_bumpGrid`; zero steady-state |
| Density grid (additive) | < 1 ms | O(active-near agents) | counting-sort; density free |
| L1 context-steer | < 3 ms | O(N_SIM × k≤8) | **N_SIM ≤256 active-near, never `0..count`** |
| L2 contact + trip | < 4 ms | O(contacting × k) × ≤3 substeps, **token-capped** | PBD not penalty; LOD ragdoll; ≤32 contacting |
| Render / everything else | ~6 ms | draw-call + fill bound | the real bottleneck |

**The single-thread JS ceiling (honest, dossier #9).** V8 runs well-written typed-array kernels ~1.5-2.1× slower than C (but ~8× for object-graph code — one accidental holey-array/megamorphic transition silently drops you into the 8× regime, permanently). Translating native crowd numbers: **~1,500-3,000 agents doing *real* neighbor avoidance + contact at 60 fps desktop, 300-800 phone — only if SoA + zero-alloc.** We stay **far under** this because L1 runs on ≤256 and L2 on ≤32 contacting; the other 700+ are flee-gradient-slide decoration. **The "1000+" is bodies-near-camera as a VIEW over the census, not 1000 simultaneously physical.**

**The "lower CPU" promise is CUT.** Measured against the substrate: today's crowd already runs ~5 full `O(count=760)` passes/frame (`sim()`, the uncapped mover-gather scan, the separation slice, two matrix-write passes, plus `_bumpGrid` rebuild). Raising CAP toward 2000 **multiplies every one of those ~2.6×** *unless* they iterate the **active-near compacted list** instead of `0..count`. Adding a density grid + flee hook + PBD solver on top is **net-MORE main-thread CPU**, not less. The CPU layers are justified by **capability, paid for by the token budget** — there is no CPU saving on the single thread, and the document no longer claims one. (The GPU/draw-call saving is separately real, Phase 1.)

**The marquee frame is the worst frame on BOTH axes at once.** A near, packed, fleeing crowd maximizes the stride/hotspot/slice denominators simultaneously AND is the worst MP frame (most named in-scope mutating bodies in the smallest bubble). This is the **design point**, not the worst case: the token budget renders it at locked frame time with a bounded number of "real" tripping bodies near camera and a cheap flowing carpet behind — which is exactly what the realism note concedes is all that's deliverable anyway.

**Memory.** Additive density/event grids ~tens of KB. Census 600 verbose ≈ 228 KB; 2000 trimmed (~155 B) ≈ 310 KB (fits the 1.4 MB relay cap *for the synced subset only*); 5000+ needs IndexedDB (deferred). Ragdoll pool <1 KB/slot.

**Realism honesty (dossier #14, jank critique).**
- Ragdolls read as *comedy* unless damped + juiced. **Every trip/trample fires `doHitstop` + camera kick + dust + audio**, run on `feelDt` so it lands even under load. Run the panic *camera* on `feelDt` too, so the beat reads even when the world sim is slow.
- No stacked mound — flat carpet + a few verlet on top.
- ≤3-5 *salient* events on screen; tag downed bodies with Lv/NAME so a trample has a victim ("Lv37 Marcus the vendor"), converting noise into a tellable anecdote.
- **Gate panic behind player-attributable cause** — ambient crowd NEVER spontaneously tramples; only a threat the player can see they caused. Add reaction latency (150-400 ms) so panic isn't the mocked "they flee before you fire."

**Alignment with `MEMORY.md`:** the measured note ("~5000 static draw calls = 96 %, `quality.js` can't structurally reduce them") is *the* reason Phase 1's lead is the static-batch extension. Consistent.

---

## 6. MULTIPLAYER & PERSISTENCE

**Verified current state:** host-authoritative (`hostSim()`/`noSim()` gates everywhere). **The world snapshot is a FULL, non-delta dump every 10 Hz** — `net.send({t:"world", pd: vals(_rowsPed), cp: vals(_rowsCop), cr: vals(_rowsCar)})` (networld.js:193), where `vals()` (line 98) flattens **every** in-scope row with **zero dirty-tracking and zero rate-limiting**, bounded only by interest scope (180/210 u) and today's tiny population (`CITY.peds=100`, cops=0 until wanted). 200 ms interp, `worldBlob {v, gangs, fracture, npc, day, propMkt}` autosaved 120 s, **relay hard-drops past ~1.5 MB** (`sendWorld` guards near 1.4 MB), `netRagEmit`/`frx` event replication. Transport = **one ordered reliable TCP WebSocket per peer** through a dumb-broadcast relay; `wsmini` kills the socket at a 3 MB backlog / 1536 KB single frame.

### 6.1 The MP bandwidth budget is FICTION until the snapshotter is real (FATAL critique — re-classified to blocking prerequisite)

The draft's §5 "priority accumulator, ~6-8 KB/tick" **assumed a snapshotter that does not exist**. On the current `vals()` full-dump, cost scales with *total in-scope entities*, and L3+L4 raise that bar three multiplicative ways at once (CAP 600→2000; "1000+ bodies near camera as a VIEW"; "Class B = ALL cops/shooters/named within 180 u"). A packed-plaza flee funnels hundreds of named, in-scope, **every-frame-mutating** (hp/flags/pos) bodies into one 180 u bubble: at ~50 B/row, 400 rows = ~20 KB/guest/tick × 10 Hz = **200 KB/s per guest** of pure NPC state, serialized **independently per guest** (`scopedSnapshots` loops `net.players`). On one reliable-ordered TCP stream this is **catastrophic, not slow**: when the fat frame can't drain, **head-of-line blocking stalls everything behind it** — WebRTC signaling, `hit`/`carGrant`/death events, chat — and `wsmini` kills the socket at the backlog cap. **The failure mode of "more bodies" is the guest who walks into the crowd getting DISCONNECTED, with the death/trample events queued behind the bloated snapshot never arriving — desync becomes permanent.**

**The fix, made a hard gate (Phase 6, in front of CAP>600 and any Class-B widening):**

1. **Delta + priority snapshotter (PREREQUISITE):** per guest, keep the last-sent row; send only rows whose quantized pos/heading/flags/hp **changed**; apply a hard per-tick byte budget (~6 KB) via a Gaffer priority accumulator (priority = recency-since-sent × proximity × salience; **carry unsent priority, never reset starved rows** — anti-starvation). This caps bytes **regardless of how many souls exist** — 2000 souls cost the same wire as 100 if only 80 changed visibly.
2. **HARD-CAP Class B per guest — CUT "ALL cops/shooters/named within 180 u."** That unbounded set is the load-bearing flaw. Replace with **≤64 networked NPCs in scope: the nearest + any cop targeting them + the few NAMED salient ones.** Everyone else in the bubble is **Class A decoration** (seed+tick, never networked) **even when on-camera** — accept that two players see different individual filler extras. (This *answers* the draft's Open-Question 7: the line is **64, named-or-targeting only**.)
3. **Event-lane priority (invert today's implicit ordering):** stampede results (deaths, trample markers, `carGrant`) go on a **separate logical lane** with their own small budget and explicit priority **OVER** the state dump. On the one shared TCP stream that means: when the byte budget is tight, **DROP state rows (puppets dead-reckon) but ALWAYS flush events first.**
4. **Backpressure, not socket-death:** the host watches its own send backlog (`bufferedAmount`) and **sheds state** (raise quantization, shrink budget, widen interval) **before** the relay's 3 MB kill triggers. A dropped guest is far worse than a coarse one.
5. **Per-guest serialization cost:** with deltas, **diff once into a shared row set** and let each guest's priority queue pick from it — host CPU stays `O(entities + guests × budget)`, not `O(entities × guests)`.

### 6.2 Three replication classes ("more bodies" = ~0 extra bytes)

- **Class A — ambient instanced mass:** NEVER networked. Each client spawns it from a shared 32-bit seed + the synced **server tick** (sent in each snapshot); it is decoration; a 1-bit desync of a background extra is invisible. **700→1000+ adds zero wire bytes.**
- **Class B — nearest + cops-targeting + named, ≤64/guest:** host-authoritative 10 Hz snapshots through the delta+priority snapshotter.
- **Class C — mid-ring:** fold into A or send heading/pos at 2-4 Hz.
- **Trample = events**, not state: host owns the cascade, replicates ragdoll-launch (`netRagEmit`) + downed-obstacle markers. Guests render replicated falls; **never stream per-bone state, never run L2 on guests** (chaotic, desyncs in seconds).

### 6.3 Determinism is ARCHITECTURAL, not numeric (HARD WALL)

Cross-engine `sin/cos/sqrt/atan2` differ at the last bit between a Mac host (Safari/JSC = cmath) and a phone guest (V8 = fdlibm). So **any shared deterministic sim is unsafe across host and guest.** Determinism is allowed **ONLY** for invisible Class-A decoration (seed + server tick) — and even that must advance on the **server tick**, never the local variable frame `dt` (the dt-clamp would desync each client's decoration differently). All "must-agree" state (deaths, who-trampled-whom) stays **host-authoritative and result-replicated**. The flee reaction crosses the wire as the **existing event** (~tens of bytes), re-applied locally; we do **not** ship a deterministic flee-field for peers to re-integrate (there is no flee-field).

### 6.4 Persistence deltas, seed, and the host-migration race

- Extend `worldBlob` (versioned envelope, no wire change) with `{deaths (ledger `dead` flags), seed, crowdTargets}`. Death = the ledger flag surviving serialize (§2 L3). Persist a **seed** so two hosts fast-forward identically (cross-engine float drift forbids re-deriving — the seed pins the RNG stream, not the float math).
- **Host-migration race (audit, confirmed):** `becomeHost` calls `spawnCityPeds` **immediately** (net.js:143) but `worldBlob` applies at `settleT>0.4` — a death not yet applied **respawns alive**, and `spawnCityPeds` regenerating all NPCs would resurrect the dead. **Fix via the single `CBZ.cityWorldSettled` gate:** sequence `applyWorld` **before** `spawnCityPeds`, or re-apply death flags post-spawn. Same gate covers seed adoption on migration (new host adopts old seed+tick for continuity — assumed yes; see Open-Question O8).
- **Relay cap (1.4 MB):** the 600→2000 census at trimmed ~155 B fits the *synced subset*; do NOT serialize Class-A decoration (reconstructed from seed). Only sync near + recently-touched souls to guests.
- **The `carGrid` string-key fix** (vehicles.js:1768) is MP-neutral and lands in Phase 0.

---

## 7. HARD PARTS & MITIGATIONS

Each grounded in the research and the verified code.

1. **dt model is time-dropping, not spiraling.** *Mitigation:* crowd-only fixed-step accumulator with `MAX_CATCHUP=3`; keep legacy world clamp; census stays wall-clock. Don't apply Gaffer to the whole loop (risks a *real* spiral the legacy code doesn't have). **And** bound *work* with the token budget so the cap rarely fires (else slow-mo returns on the marquee frame).

2. **L2 social-force explodes in JS (Köster 2013: non-Hamiltonian, dt≈1 ms, oscillates even at tiny dt).** *Mitigation:* **use the existing PBD/Verlet solver with positional constraints**, not Helbing penalty forces; clamp force/penetration (≤0.15 m)/velocity (≤1.3·v0); fixed substep; "1600 N/m" → tuned positional trigger.

3. **L2 cost cliff + the marquee-is-worst-frame trap (CPU critique).** ORCA <60 fps @2k; Matter crashes @10k; Narain: contact solve dominates, 10k=34 ms. The packed-flee showcase maximizes stride/hotspot/slice denominators *together*. *Mitigation:* the **token budget** (≤32 contacting, ≤14 verlet, ≤2 trips/100 ms) + overflow → cheapest tier; **N_SIM ≤256 decoupled from CAP**; trample via static obstacle-disc, not per-body sim. Prove **worst-case-first** in Phase 0 to a fixed ms ceiling on the weak Mac.

4. **Flow-field "line of ants" + wrong-tool-for-multi-goal.** *Mitigation:* **don't build the ambient field at all** (L3 census already does the job); flee is the existing event bus wired to the mass, transient and local.

5. **Cross-engine float non-determinism breaks MP crowd sim.** *Mitigation:* host-authoritative results + decoration-only determinism on the **server tick** + event-replicated flee (§6.3).

6. **InstancedMesh can be slower on phones; `frustumCulled=false` shades all instances; no per-instance cull in r128.** *Mitigation:* pitch-gated impostor (or cut) bounds fill rate; amortize matrix writes; per-instance pack-to-front + clamp `.count` on mobile tier; `quality.js` drops CAP + hero count on weak devices; tiers 0-1 get only the static-batch + matrix-amortize wins.

7. **Ragdoll reads as slapstick / panic reads as buggy.** *Mitigation:* juice on `feelDt`; player-attributable triggers only; reaction latency; ≤3-5 salient events; named victims; cop intent telegraphed.

8. **The LOD seams the plan would multiply (jank critique).** *Mitigation:* the **CONTINUITY contract** (§2) as a hard gate — phase handoff (seed `ch.phase` from `phase[i]`, not `Math.random()`), identity-freeze within 45 m, impostor ordering, and the "no restart within 45 m / no phasing within 30 m" acceptance bars.

9. **Corpse-phasing during trample (jank critique, confirmed in code).** Every collide pass guards `corpseT<=0`. *Mitigation:* keep that guard for movement cost; add downed bodies as a **separate ≥0.6 m repulsion disc only inside live hotspot cells**, resolved as a `stagT` skid shove — never as broadphase obstacles (cost + re-trip jitter), never a 0.4 m disc (sprint step straddles it).

10. **Hero-rig merge fights articulation + severing + painted cloth (r128 critique, confirmed in code).** *Mitigation:* merge only the static, same-material subset (16→~10-12); arms/legs stay separate animated + severable; `clothes.js` materials preserved; use the existing by-hand `batch.js` splice; publish the honest −400/−600 figure, not −1400.

11. **In-shader stride is foreign to a shader-free codebase and double-shadow-material brittle (r128 critique).** *Mitigation:* **CUT.** Get the matrix-amortize win the codebase already does; the mass is already ~11 draws.

12. **Impostor pancakes from the 41° roof/aerial camera (r128 + jank critiques, confirmed `MAX_PITCH=0.72`).** *Mitigation:* pitch-gated billboards + crossed-quad fallback above the horizon, or cut the tier entirely.

13. **MP bandwidth fiction on a full-dump TCP wire (FATAL critique).** *Mitigation:* the delta+priority snapshotter as a **blocking prerequisite** (Phase 6), Class-B cap ≤64, event-lane priority, `bufferedAmount` backpressure (§6.1).

14. **Silent breakage on a moving substrate (integration critique).** *Mitigation:* Phase −1 freeze-baseline + contract harness (RED tests for identity bleed / serialize budget / stay-dead), the `CBZ.cityWorldSettled` ordering gate, additive density grid (no `_bumpGrid` rewrite), CAP→2000 deferred behind the budget test, serialized-against-parallel-waves rollout.

15. **Census byte-budget vs 1.4 MB relay cap.** *Mitigation:* trim to ~155 B (short keys, 1 dp anchors, drop names for un-named/regenerate from seed, relationships as an id-referenced edge list); cap 2000 in localStorage; defer IndexedDB for 5000+; sync only near + recently-touched to guests.

16. **Vertical occupancy needs interior pathing.** *Mitigation:* souls indoors are *scheduled-teleport* (snap to floor anchor off-camera), NOT field-routed up stairwells. Avoids a `buildings.js` interior-nav rewrite.

---

## 8. ADVERSARIAL REVIEW RESOLUTION

Each critique, its lens and severity, and exactly how the final plan answers it or what got cut.

### C1 — Performance realism / single-thread CPU budget (MAJOR; SURVIVES with re-charter + one cut)
- **Objection:** "more bodies, LOWER CPU" closes only in the calm case; the marquee packed-flee maximizes the stride/hotspot/slice denominators **simultaneously** (all three are 100 % correlated, not independent); today's 5 `O(count)` passes + CAP→2.6× + 3 new passes = net-MORE CPU; `MAX_CATCHUP` drops time → re-introduces 25 % slow-mo on the showcase.
- **Resolution — CHANGED + CUT:** (a) **Cut the unqualified "lower CPU" promise** — §1 correction #1, §5. (b) **Decouple census from per-frame work** — N_SIM ≤256 active-near via a compacted index list; the 5 `O(count)` passes re-pointed off `0..count`; CAP→2000 is ledger-only and gated. (c) **Replace the 3 gates with ONE token-bucket scheduler** (§2 L2) — overflow degrades fidelity, never frame time. (d) **Phase 0 proves the budget worst-case-first** on the weak Mac. (e) **De-scope the PBD solver to ≤32 contacting** + flee-gradient-slide for the rest. **Kept:** L0b, L3 census + vertical occupancy, render merge. **Verdict honored:** architecture survives; the costs-less framing is cut.

### C2 — Browser / Three.js r128 / no-build / Mac+phone (MAJOR; SURVIVES, headline demoted, one cut)
- **Objection:** Phase 1 "ship first, pays for everything" is the *least* shippable: hero-merge fights ~43-DOF animation + `gore.js` `part.visible=false` severing + `clothes.js` per-slot materials (→ 16→~10, not 16→2); `onBeforeCompile` is foreign + double-shadow-material brittle; flat impostor pancakes under `MAX_PITCH≈41°` + aerial features; `mergeGeometries` API name.
- **Resolution — CUT + DE-SCOPED + RE-SPEC'd + RE-ORDERED:** (a) **Cut in-shader stride** (§2 RENDER, §7-11). (b) **De-scope hero merge** to static-subset 16→~10-12, articulation + severing + materials preserved (§2 RENDER, §7-10). (c) **Re-spec impostor** as pitch-gated + crossed-quad fallback, or cut (§7-12). (d) **Promote static `wallBatch` extension + carGrid fix to the lead GPU phase** (§4 Phase 1a, Phase 0). (e) **API note:** the codebase uses its *own* by-hand `mergeGeometries` (batch.js:112), not `THREE.BufferGeometryUtils.mergeGeometries` (the vendored util is `mergeBufferGeometries`) — reuse the existing splice; no throw. (f) **Public claim made conditional** on a Phase-0 weak-Mac measurement; ~half the drafted figure. (g) **Mobile tiers 0-1 get only static-batch + matrix-amortize.**

### C3 — Multiplayer determinism & bandwidth (FATAL; SURVIVES only as blocking prerequisite + one cut)
- **Objection:** the bandwidth budget is computed against a priority accumulator that doesn't exist; the wire is a **full `vals()` dump every tick** on **one reliable TCP stream**; a packed flee → ~200 KB/s/guest → HoL blocking → socket kill at 3 MB → the guest drops and queued death/trample events never arrive (permanent desync). "Class B = ALL within 180 u" is uncapped exactly where a cap is needed.
- **Resolution — RE-CLASSIFIED to blocking prerequisite + CUT:** (a) **Delta+priority snapshotter is a hard Phase-6 gate** in front of CAP>600 and any Class-B widening (§6.1). (b) **Cut "ALL cops/shooters/named within 180 u"** → **≤64/guest, nearest + targeting + named**; everyone else Class A on-camera (§6.2; answers draft Open-Q7). (c) **Event-lane priority** inverts ordering (events flush first, state rows drop). (d) **`bufferedAmount` backpressure** before the relay kill. (e) **CAP→2000 lands after the snapshotter** (§4 Phase 2/6). **Kept correct:** three-class instinct, events-not-state for trample, flee-as-event, the cross-engine sin/cos determinism wall. **Verdict honored:** architecture right; budget was fiction; gated behind "snapshotter shipped + Class-B capped + event-lane priority."

### C4 — Integration with the 89k-LOC engine (MAJOR; SURVIVES with Phase −1 + two cuts)
- **Objection:** "OFF == today" is structurally false — 6/8 files dirty, `citynav.js` untracked, prior commit a never-play-tested 51-file consolidation; new ordering deps (death-flag apply vs spawn, seed adoption on migration, census-vs-reseed ownership, 2000-soul serialize vs 1.4 MB cap) fail **silently**; the harness can't catch visual identity desync (render-stubbed).
- **Resolution — NEW PHASE + CUT + DE-SCOPE:** (a) **Phase −1 freeze-baseline + contract harness** (RED tests: identity bleed, serialize budget ~900 KB hard-fail, stay-dead) — §4. (b) **Position-ownership rule written down** (far=census, near=reseed, handoff=`park`/`cityPedStash`) — §4. (c) **Single `CBZ.cityWorldSettled` ordering gate** for all new appliers — §4, §6.4. (d) **Serialize the build against parallel waves** (exclusive rebased edits + re-run harness after each). (e) **CUT: CAP 600→2000 in Phase 2** → deferred behind the budget test. (f) **DE-SCOPE: the `_bumpGrid` counting-sort rewrite → ADDITIVE second grid** (§2 L2, §7-14) — leave `_bumpGrid` untouched so a parallel merge can't silently revert it.

### C5 — Over-engineering / simpler-path (MAJOR; SURVIVES, de-scoped on the AI axis)
- **Objection:** L0b's BFS flee-field + most of L4's "field read/write" **rebuild a primitive that already ships** — `cityPanic` (door-aware, via `fleeFrom`) + `cityevents.js` (24-slot ring, 4 m contagion, gawk-vs-flee) — already called by gunfire/explosions/heists/MP-wired. The **only** missing piece is the crowd.js flee hook the file's own header names. The owner will feel "background crowd ignores gunfire," not "BFS vs proximity-falloff."
- **Resolution — ADOPTED; the single most-damaging cut:** (a) **CUT the ~400-LOC BFS flee-field + Int16 tiles + Dijkstra + stamp-replication + its dedicated accumulator justification.** (b) **REPLACE with the ~40-60 LOC `panicT`/`fleeHX/Z` hook** wired into `cityPostEvent`, reusing `_bumpGrid` + the existing knockdown/`stagT`/`corpseT` cascade — §2 L0b. (c) **Hold the ambient-field cut** (already cut). (d) **De-scope L4 to "cops read density + event ring"** (the one genuinely-new thing); drop "read the −gradient of the flee field." (e) **DELETE Open-Question #1** (moot) and reframe to Open-Question O1. **Net: removes ~500-600 LOC and one MP replication class while LOSING NONE of the felt result.** The crowd-only fixed-step accumulator survives only as the L2 contact clock (its flee-field justification is gone); L2 self-caps via the token budget.

### C6 — Crowd quality / jank / fun (MAJOR; SURVIVES, continuity made prerequisite, two re-scopes)
- **Objection:** the felt bottleneck is **LOD/representation seams, not physics**, and the plan *multiplied* them: in-shader stride widens the gait mismatch at the 22-40 m promotion seam; the impostor adds a *second* pop boundary on a roof-down camera; the trample requires removing the `corpseT<=0` guard from the hottest path → agents phasing through corpses (the worst "broken" tell), and `MAX_CATCHUP=3` makes trips resolve in visible steps (teleport-snap topples).
- **Resolution — NEW CONTRACT + RE-SCOPE:** (a) **CONTINUITY contract as a hard gate** (§2 CONTINUITY): phase handoff (seed `ch.phase` from `phase[i]`, kill the `Math.random()` restart), identity-freeze within 45 m, LOD ordering, acceptance bars. (b) **CUT in-shader stride** (also a C2 cut). (c) **CUT/pitch-gate impostor** (also a C2 cut). (d) **Trample contact, not phasing:** keep the `corpseT<=0` guard for movement; ≥0.6 m disc only in hotspot cells; `stagT` skid shove (§2 L2, §7-9). (e) **Named-victim juice + player-attributable gate** retained. (f) **Token budget keeps trips smooth** (bounded count, not reduced rate, so no teleport-snap). (g) **One play-test pass** for the continuity/phasing bars (the one place the no-play-test rule bends) — §4 Phase 4.

**Cross-cutting cuts (gold-plating the critics rightly called out):**
- BFS flee-field + Int16 Dijkstra tiles + stamp-replication (C5). **CUT.**
- In-shader mass stride / `onBeforeCompile` (C2, C6). **CUT.**
- Unqualified "lower CPU" promise (C1). **CUT.**
- "16→2" hero-merge claim (C2). **DE-SCOPED to 16→~10-12.**
- Flat single-quad impostor as unconditional far-LOD (C2, C6). **RE-SPEC'd to pitch-gated, or cut.**
- `_bumpGrid` counting-sort *rewrite* (C4). **DE-SCOPED to additive.**
- "Class B = ALL within 180 u" (C3). **CUT to ≤64/guest.**
- CAP→2000 as an early Phase-2 default (C3, C4). **DEFERRED behind the serialize-budget test + delta snapshotter.**

---

## 9. THE CHEAPEST CONVINCING FIRST PROTOTYPE

**One hotspot, defined precisely: gunshot → scatter → pile-up → trample.** This is the smallest build that demonstrates the headline and exercises every risky seam, while remaining flag-gated and revertible.

**Pre-reqs (must land first):** Phase −1 baseline + contract harness; Phase 0 `carGrid` fix + worst-case profiler; the CONTINUITY phase handoff (so the scatter doesn't blink). No MP required for the prototype (single-player; MP gated behind Phase 6).

**Scene setup:** one designed high-density chokepoint near a player spawn (a plaza or market mouth — leverages the vertical-occupancy / district weights to make it *genuinely* denser than a side street, so the density gate has something to fire on). ~120-180 instanced bodies funnelled into ~3-4 contiguous 2 m cells.

**The beat, step by step:**
1. **Trigger (player-attributable):** the player fires. `combat.js:895` already calls `cityPostEvent`. **New:** the L0b subscriber stamps `panicT`/`fleeHX/Z` on the ~150 mass agents in radius (clamped), via `_bumpGrid`. Reaction latency 150-400 ms before full sprint.
2. **Scatter:** agents with `panicT>0` steer to `fleeHX/Z` at sprint; contagion (`cityevents.js` 4 m) ripples; brave/high-aggr agents **gawk** instead (already coded). Door-aware for any promoted bodies (`fleeFrom`).
3. **Pile-up:** the additive density counting-sort flags the chokepoint cells ≥ DENSE while a flee signal is live → positional repulsion + (≥ DANGER) trip rolls. Token budget admits ≤32 contacting, ≤14 Tier-A verlet, ≤2 trips/100 ms.
4. **Trample:** downed bodies → Tier-C prone instances (`corpseT`/`collapsedQ`) + a ≥0.6 m repulsion disc *inside the hotspot cells only*; living agents skid (`stagT`) around them → cascade. Contact→brain flags the tripped AI downed.
5. **Juice + identity:** each trip fires `doHitstop` + camera kick (on `feelDt`) + dust + scream; downed bodies tagged with Lv/NAME ("Lv37 Marcus").

**Acceptance (all on the weak Mac):**
- Frame time **locked** through the beat (token budget; Phase-0 worst-case ceiling met).
- Scatter reads directional + door-aware, **no gait/outfit blink within 45 m** (continuity bars).
- **No agent phases through a downed body within 30 m** (≥0.6 m disc + skid).
- A legible flat carpet of ≤~30 downed bodies + a few verlet on top; ≤3-5 salient events; at least one **named** victim.
- Reverting `CBZ.crowdMassFlee` + `CBZ.crowdContact` = byte-identical to today.
- **One play-test pass** confirms the phasing/blink bars (the no-play-test rule bends here only).

**Why this is the cheapest convincing thing:** it reuses the entire existing panic bus, knockdown cascade, prone-instance path, and ragdoll pool; the only net-new code is the ~50-LOC flee hook, the additive density grid, the PBD positional contact, the token budget, and the ≥0.6 m disc — and it proves the budget, the determinism boundary (single-player, host-authoritative), and the seam continuity all at once.

---

## 10. OPEN QUESTIONS / DECISIONS FOR THE OWNER

1. **(O1, replaces the deleted draft Q1) Confirm the flee scope.** The mass not fleeing gunfire is the **only** missing piece; everything else (door-routed panic, contagion ripple, gawkers, witness memory, MP wiring) already ships on the hero peds. Do you want it extended to the instanced mass and **nothing fancier** — or do you specifically want *visible directional commute lanes* (rush-hour rivers), which would require a coarse low-Hz baked direction hint (NOT a per-frame Eikonal field)? Default assumption: just the hook, no lanes.
2. **Fixed-step crowd clock vs whole-game clock.** Scoped the accumulator to the crowd/contact subsystem to avoid touching legacy systems. Acceptable, or do you want the whole world on fixed-step (much larger blast radius, MP-risky)?
3. **PBD vs literal 1600 N/m fidelity.** Going positional sacrifices force-accurate injury thresholds. Acceptable, or do you want "real" pressure numbers (which means dt≈1 ms and a much smaller agent cap)?
4. **CAP 600→2000: localStorage now, IndexedDB for 5000+?** The relay cap (1.4 MB) hard-limits *networked* souls regardless. Is "thousands persistent but only ~hundreds (≤64/guest) networked" the right framing?
5. **Phone target floor.** What's the minimum device? It sets the L2 token caps, instanced CAP, and whether the impostor tier is built at all. "Text-a-friend-a-link" implies an *arbitrary* phone — argues for conservative defaults and possibly cutting the impostor.
6. **Trample's flat-carpet honesty.** A true stacked mound needs N full ragdolls colliding (cost cliff) or a pre-baked heap mesh (art + repetition + loses identity/lootability). Confirm the flat-carpet + few-verlet-on-top trade is acceptable.
7. **Impostor: build or cut?** Given the 41° roof/aerial camera that pancakes flat billboards and the phone target, is the pitch-gated impostor worth the integration risk, or do we ship "fewer-but-real bodies at range" (existing distance-cull) and skip it?
8. **(O8) Host-election continuity.** On migration, does the new host adopt the old seed+tick (continuity) or reroll (jump)? Continuity needs seed in `worldBlob`; assumed yes.
9. **The one play-test pass.** Gait-restart, outfit-pop, and corpse-phasing parse-clean and pass headless asserts but are instantly obvious on screen. The continuity/phasing bars demand **one play-test** before Phase-1/Phase-4 flags default on — against your standing no-play-test rule. Accept the single exception?
10. **Empirical draw-call floor.** Phase 0 must measure the post-merge/post-batch draw-call count **on the real weak Mac** before the "more bodies, lower GPU" claim is stated publicly. The claim is **conditional** on that number (~half the draft's estimate once articulation/severing/materials/camera are honored). Confirm we hold the public claim until Phase 0 lands.

---

## 11. SOURCES APPENDIX

Key citations grouped by topic (title + url). Numbers cited in the body trace to these.

### Flow fields / continuum crowds / navigation (why L0 ambient is cut)
- Treuille, Cooper, Popović — *Continuum Crowds* (SIGGRAPH 2006). https://grail.cs.washington.edu/projects/crowd-flows/continuum-crowds.pdf — density-speed field, one-field-per-group, 2-5 fps for 1-2k on 120×120 (native C); same-cell agents intersect → needs a contact complement.
- Emerson — *Crowd Pathfinding and Steering Using Flow Field Tiles* (Game AI Pro, SupCom2). https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf — tiles + HPA*, cost stamps, LOS pass, time-sliced rebuild.
- jdxdev — *RTS Pathfinding 1: Flowfields* (post-mortem). https://www.jdxdev.com/blog/2020/05/03/flowfields/ — "line of ants" collapse; abandoned fields for A*; 50×50 ≈0.3 ms.
- crowd_pathfinder (UE5 benchmarks). https://github.com/yoreei/crowd_pathfinder — 200 units: 6 ms flowfield vs 5.1 ms A*; single-goal, not multi-destination.

### Social-force / panic / trample (L2 contact)
- Helbing, Farkas, Vicsek — *Simulating dynamical features of escape panic* (Nature 2000). https://www.nature.com/articles/35035023 — A=2000 N, B=0.08 m, k=1.2e5, κ=2.4e5, τ=0.5 s; >1600 N/m → fallen-as-obstacle; faster-is-slower.
- Köster, Treml, Gödel — *Avoiding numerical pitfalls in social force models* (Phys. Rev. E 2013). https://journals.aps.org/pre/abstract/10.1103/PhysRevE.87.063305 — non-Hamiltonian, discontinuous RHS, oscillates even at tiny dt → use positional/clamped, not penalty.
- Moussaïd, Helbing, Theraulaz — *How simple rules determine pedestrian behavior and crowd disasters* (PNAS 2011). https://pmc.ncbi.nlm.nih.gov/articles/PMC3084058/ — vision heuristic; crowd-pressure = density × velocity variance; turbulence onset.
- ScienceInsights — *What is a crowd crush*. https://scienceinsights.org/what-is-a-crowd-crush-and-why-is-it-so-deadly/ — 5 ppl/m² turning point, 6-7 ppl/m² crush/fluid → the DENSE/DANGER/CRUSH bands.
- Jakobsen — *Advanced Character Physics* (Hitman/IO). https://www.cs.cmu.edu/afs/cs/academic/class/15462-s13/www/lec_slides/Jakobsen.pdf — Verlet point/stick, 3-4 iters, sqrt-free stick, sleep-on-rest = the existing ragdoll, validated; the Taylor form for sqrt-elim.

### Shipped huge-crowd architectures (LOD, promotion, census)
- Fauerby — *Crowds in Hitman: Absolution* (GDC 2012). https://media.gdcvault.com/gdc2012/slides/Programming%20Track/Fauerby_Kasper_CrowdsInHitman.pdf — 1200/500 on-screen @30 fps, 5 ms CPU, panic flow channels, possession/promotion, 36 B SoA core.
- Cournoyer — *Massive Crowd on AC Unity: AI Recycling* (GDC 2015). https://archive.org/stream/GDC2015Cournoyer/GDC2015-Cournoyer_djvu.txt — 10k NPCs, 40 real AI + 120 hi-res, LoRes ~25 µs (~100:1), deterministic pregenerated paths for co-op, color/hat re-apply on swap.
- *How Watch Dogs: Legion's Census works* (Game Developer). https://www.gamedeveloper.com/design/how-watch-dogs-legion-s-play-as-anyone-simulation-works — tiered census, deferred generation, metro fast-travel nodes, permanent memory; persistence as a DB illusion not mass physics.
- Sunshine-Hill — *LOD Trader* (Game AI Pro). http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter14_Phenomenal_AI_Level-of-Detail_Control_with_the_LOD_Trader.pdf — criticality (observability/attention/memory/return-time) over distance.
- Coconut Lizard — *UE Animation Budget Allocator*. https://www.coconutlizard.co.uk/blog/animation-budget-allocator/ — 1.0 ms cap by significance; the frame-budget governor = the token budget.

### Rendering / instancing / impostors (the GPU win)
- discourse.threejs.org — *One Draw Call, Massive Crowd*. https://discourse.threejs.org/t/one-draw-call-massive-crowd-performance-engineering-in-three-js/89928 — 100k animated in 1 draw, sub-2 ms GPU, ~0.1 ms CPU; validates GPU-render-not-sim and matrix-amortize.
- GPU Gems 3 Ch.2 — *Animated Crowd Rendering*. https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch02.html — bone-matrix LOD numbers (context for why box rigs skip skinning).
- VR Me Up devlog #10 — *Three.js InstancedMesh performance*. https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html — instanced can be SLOWER on weak GPUs; per-instance pack-to-front + clamp `.count` nearly doubled fps.
- utsubo — *100 Three.js Performance Tips*. https://www.utsubo.com/blog/threejs-best-practices-100-tips — draw-call budget <100 mobile / >500 strugglers; the metric is calls, not tris.
- three.js InstancedMesh frustum-culling thread. https://discourse.threejs.org/t/how-to-do-frustum-culling-with-instancedmesh/22633 — no per-instance cull in r128 → reorder + clamp `.count`.

### Spatial structures / density grid (L2 trigger)
- Müller — *Ten Minute Physics #11: Spatial Hashing*. https://matthias-research.github.io/pages/tenMinutePhysics/11-hashing.html — dense 3-array counting sort, density free as a byproduct; spacing = 2r.
- 0 FPS — *Collision detection part 3: Benchmarks*. https://0fps.net/2015/01/23/collision-detection-part-3-benchmarks/ — grid beats quadtree for moving agents; quadtree wins only 70-90 % static.

### LOD AI / off-screen abstract sim (L3/L4)
- GTAForums — *Increasing ped densities* (RAGE streaming radii). https://gtaforums.com/topic/905800-increasing-ped-densities/ — asymmetric in/out-of-frustum spawn/despawn radii.

### Single-thread JS ceiling / determinism / parallelism escape hatches
- Charlton et al. — *Fast Simulation of Crowd Collision Avoidance* (CGI 2019). https://eprints.whiterose.ac.uk/id/eprint/150111/1/_John_Charlton____ORCA_GPU_Paper.pdf — multi-core ORCA <60 fps at ~2k agents.
- *Matter.js vs Rapier benchmark* (dev.to). https://dev.to/jerzakm/this-little-known-javascript-physics-library-blew-my-mind-57oo — JS Matter 38 fps@4.5k, crashes@10k; WASM Rapier ~3× (the JS→WASM gap).
- Fiedler — *Fix Your Timestep!* https://gafferongames.com/post/fix_your_timestep/ — the accumulator + max-substep cap; render interpolation. Scoped, not whole-loop.
- macwright — *Math keeps changing* (cross-engine float). https://macwright.com/2020/02/14/math-keeps-changing — JSC cmath vs V8/SpiderMonkey fdlibm; sin/cos/sqrt/atan2 differ at the last bit; +−×÷ reproducible → the MP determinism wall.
- V8 — *Elements kinds*. https://v8.dev/blog/elements-kinds — packed vs holey one-way transitions; the ~2× vs ~8× regime.
- web.dev — *Cross-origin isolation (COOP+COEP)*. https://web.dev/articles/coop-coep — why SharedArrayBuffer breaks a "texted link" (COEP blocks cross-origin assets); prefer transferable ArrayBuffers if ever parallelizing.

### Multiplayer replication / interest management / bandwidth (§6)
- Gaffer — *State Synchronization*. https://gafferongames.com/post/state_synchronization/ — priority accumulator (carry unsent, never reset starved); the delta-snapshotter design.
- Gaffer — *Snapshot Compression*. https://gafferongames.com/post/snapshot_compression/ — 50-bit position quantization (bounds the upside; our JSON/TCP wire can't reach it — wins come from fewer rows + shorter JSON).
- FiveM — *OneSync* docs. https://docs.fivem.net/docs/scripting-reference/onesync/ — 424-unit focus zone (our 180/210 u is a denser variant), client-side entity creation only in scope.
- DEV/aceld — *MMO AOI nine-grid algorithm*. https://dev.to/aceld/11-mmo-online-game-aoi-algorithm-l7d — grid + nine-grid turns per-guest scope scan from O(entities) to O(local cells).
- BlogGeek.me — *WebRTC P2P mesh scalability*. https://bloggeek.me/webrtc-p2p-mesh/ — mesh uplink is quadratic; keep the star relay, budget the host uplink.

### Crowd quality / jank / fun (the felt-quality bars)
- *The AI of Hitman (2016)* (Game Developer). https://www.gamedeveloper.com/design/the-ai-of-hitman-2016- — graduated behavior zones, cumulative mood, exit pathing = legible directional panic.
- *Systemic AI of Far Cry* (Game Developer). https://www.gamedeveloper.com/programming/the-definition-of-artificial-insanity-the-systemic-ai-of-far-cry — anecdote factory + hard caps (12 NPCs/500 m) + damage director; FC2 as the unconstrained-emergence cautionary tale.
- Wayline — *Uncanny Valley of Game AI*. https://www.wayline.io/blog/uncanny-valley-game-ai — near-human-but-wrong reads creepier/unfair than honest-dumb; telegraph + variation.
- Pichlmair & Johansen — *Designing Game Feel: A Survey*. https://arxiv.org/pdf/2011.09201 — juice/anticipation/follow-through makes an emergent impact read authored.

### GPU-compute crowd (decided AGAINST for now)
- three.js Issue #22779 — *WebGL2 async readback*. https://github.com/mrdoob/three.js/issues/22779 — synchronous readback "tens of ms/call on PC, more on mobile" → GPU-sim can't feed CPU game logic; the readback trap.
- 80.lv — *6,000 agents on one game thread (VAT+HISM)*. https://80.lv/articles/6-000-agents-on-one-game-thread-novel-high-performance-framework-for-gpu-driven-crowd-systems — the GPU-render-on, sim-on-CPU sweet spot we steal; CPU still owns positions.

---

*End of plan. The architecture is sound and ~60 % in-tree. Build order: discipline (Phase −1/0) → the GPU win's safe half (static-batch + carGrid) → cheap persistence + vertical density → the mass-flee hook → capped contact physics → the MP snapshotter before any scale-up. The honest through-line: lower GPU is real and conditional on measurement; lower CPU is not a thing on this thread — the new capability is bought with a token budget, a delta snapshotter, and a hard cap on what is ever simulated, networked, or physical at once.*
