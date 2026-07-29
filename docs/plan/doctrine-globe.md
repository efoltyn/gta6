# DOCTRINE: THE GLOBE — is this world round, and where do the biomes come from?

Decision document. **No game code here.** Every repo number was read out of the tree on
2026-07-28 and is cited `file:line`; every outside claim is cited to its source. Where I could
not verify something I say so. This document does three things: it splits the owner's sentence
into the three separable asks it actually contains, it kills one of the four options with
arithmetic rather than taste, and it supplies the biome-generation rule set that `pillar-rim.md`
asserts the *consequences* of but never supplies the *causes* for.

OWNER, verbatim: *"make the world huge and make it an actual GLOBE that is CIRCULAR, not a flat
world — and making the biomes actually SCIENTIFICALLY placed and making sense."*

---

## 0. THE VERDICT

1. **Three asks, one shape.** HUGE = scale (`pillar-rim.md` owns it). SCIENTIFIC BIOMES = a
   generation rule (cheapest, highest value, ships first). GLOBE/CIRCULAR = topology, which
   splits again into *curved horizon* / *no edge* / *circumnavigable* / *a ball you can see* —
   four things, four prices, only one of them expensive.
2. **A true sphere is refused on arithmetic, not taste.** A sphere with the rim world's surface
   area (297.9 km²) has radius **4,869 m** and a horizon at eye height of **129 m**. A globe small
   enough to be *our* world makes the world feel **tiny** — the opposite of the owner's first word.
3. **And a sphere big enough to keep the horizon is indistinguishable from our plate.** At Earth
   radius, across 17,896 m, the sag is **6.28 m** and the gravity tilt **0.161°**. The trap is
   exact: **R for a 10-min lap at car speed ≈ 2.9 km; R for a 3 km horizon ≈ 2,250 km.** Three
   orders apart. Outer Wilds took the small horn (R ≈ **308 m**, **35 m** horizon, and made it the
   aesthetic); Elite Dangerous took the real one (lapping a *moon* is a multi-hour feat). **We
   need both, so we need the plane.**
4. **And our city is a LATTICE — the specific reason a sphere is worse for us.** No cube-sphere
   mapping is equal-area, equal-angle *and* seamless (Theorema Egregium); the naive one distorts
   ~**1.73×** centre-to-corner. **Dyson Sphere Program shipped a snap-grid on spherical planets
   and its players report "layouts that work in one place may not work in another."** Our world
   *is* that layout — a 50 u road lattice, `nearestIntersection`, `roadJunctions` defined as an
   axis-aligned overlap. **On a sphere the grid does not close.**
5. **THE WORLD IS ALREADY ROUND WHERE IT MATTERS.** The ocean is a **camera-centred radial disc
   built in the vertex shader** (`world/water_spec.js:24-31`) — no edge, follows you, already
   displaces vertices per frame. That is at once the cheapest place to put a curvature droop
   **and** the reason a wrap seam in open water costs **zero rendering**.
6. **Wrap is affordable in ONE axis, THROUGH OCEAN.** `WORLD_SEA_SPAN` 25,000 u against a
   13,896 u plate = **≥ 5,550 u of water each side against a 1,400 m draw distance**. Seam at
   mid-ocean: nothing drawn twice, no field made periodic, no landmark straddling. **A torus is
   refused — it deletes latitude, and Civilization already paid that bill in public: to make
   toroidal maps work, "the polar ice caps are taken out."**
7. **The biome science is the real prize and it needs no fudging.** Our 16.6 km N–S is **0.15° of
   real latitude**, so "latitude" here is a declared ~161:1 compression. But the two drivers that
   dominate a 20-km landscape *in reality* — **lapse rate** and **rain shadow** — operate at
   exactly our scale (NZ's Southern Alps: 20× drier 50 km downwind). **Orography does the real
   work, uncompressed and citable; latitude is the declared background trend.**
8. **`pillar-rim.md` has the right consequences and one missing cause — and it is computable.**
   Its wind is WNW and its only wall runs east–west across the north, which that wind travels
   *past*. **Köppen's own aridity formula says the Saltlands needs a 4.8× rain shadow to be a
   desert, and a true erg needs 26–32× — which on Earth only comes from TWO stacked ranges (the
   Atacama mechanism).** So: **the range must grow an L**, a north–south spur down the interior's
   western flank. Sierra / Cascades / Andes, no exceptions. One `bearing`/`arc` argument; no
   landmass moves.
9. **Today's layout is already right in eight places out of ten, unplanned.** At **39°N → 63°N**:
   Redhollow on the **west coast at 50.8°N = the Olympic Peninsula**; farmland **east at 50.4°N**
   where the same westerly blows offshore = humid-continental Corn Belt; Saltlands **east at
   46.9°N = the Columbia Basin / Gobi**; the Mercy Wall at **59.7°N with 189 m of alpine zone
   above its own treeline**. Two disagreements: the **interior snow core** (900 u at 53°N is below
   treeline — one climate step, three named fixes, and the only thing the owner can currently
   *see* that would change), and the **northeast ice**, where the pillar's own citation argues
   against its own conclusion. **The second is an upgrade: two ice corners become WET ICE
   (glaciated cap, windward) and DRY ICE (polar desert, lee) — visually unlike each other, the
   difference caused by the wind, and the dry one cheaper to build.**
10. **RECOMMENDATION — option 4, staged: science → visual globe → the rim → maybe the wrap. Never
    the sphere.** Everything in stages A and B is days-to-a-wave and independently revertible; the
    only expensive part of the topology ask is the part the player notices least.

---

## 1. THE ASK, SPLIT — because these have four different prices

| what the owner said | what it means technically | who already owns it | price |
|---|---|---|---|
| "make the world **huge**" | plate area, travel time, POI density | `pillar-rim.md` (175.7 → 297.9 km²) | already planned, ~4 waves |
| "an actual **GLOBE**" (a) you can see it curve | horizon droop in the vertex path | nobody | **days** (§4) |
| "an actual **GLOBE**" (b) there is no edge | wrap, or a diegetic refusal | `pillar-rim.md §3.5` answers this *without* wrap | **already answered** |
| "that is **CIRCULAR**" (c) you can go round it | topology: wrap or sphere | nobody | **2–4 weeks** (§3) / rewrite (§2) |
| "an actual **GLOBE**" (d) you can look at the ball | a globe UI + a space cinematic | nobody | **days**, and it is a texture |
| "biomes **SCIENTIFICALLY** placed" | a derivation replacing authored rects | nobody; `pillar-rim.md` authors rects | **1 wave + 1 wave of adoption** (§6) |

**The load-bearing observation:** a globe is not a shape, it is a **set of consequences** —
latitude, a horizon that hides things, a heading that is always "east", and no wall. We can
deliver every one of those consequences on the plate we already have. The shape itself, at any
radius that keeps this a GTA game, is geometrically undetectable.

---

## 2. OPTION 1 — TRUE SPHERE. Refused, with numbers.

### 2.1 The geometry decides before the engineering does

`d_horizon = sqrt(2·R·h)` · `drop(d) = d²/(2R)`

| sphere radius | surface area | horizon @ eye 1.7 m | horizon @ 1,000 m alt | circumference |
|---|---|---|---|---|
| **4,869 m** *(= exactly our rim world's area)* | 298 km² | **129 m** | 3,121 m | 30.6 km |
| 10 km | 1,257 km² | 184 m | 4,472 m | 62.8 km |
| 50 km | 31,416 km² | 412 m | 10.0 km | 314 km |
| 100 km | 125,664 km² | 583 m | 14.1 km | 628 km |
| 1,000 km | 12.6 M km² | 1,844 m | 44.7 km | 6,283 km |
| **6,371 km** *(Earth)* | 510 M km² | 4,654 m | 112.9 km | 40,030 km |

Read the first row again. **A sphere with our world's content on it has a 129-metre horizon.**
A three-block sightline down a boulevard would end in the sky. At 1 km altitude — a normal
approach altitude for the airliner — you would see the *entire planet*. That is Outer Wilds, and
Outer Wilds is a **deliberately tiny** solar system where seeing the whole world at once is the
point of the game. It is the wrong instrument for "make the world huge."

Now the other end. To keep our current tier-4 draw distance (1,400 m) *inside* the horizon at eye
height you need `R ≥ 1400²/(2·1.7) = 576 km` — a sphere of **4.2 million km², fourteen thousand
times our content area**, i.e. 99.993% empty. And at any such radius:

| our map span on an Earth-radius sphere | sag (half-span) | gravity tilt end-to-end |
|---|---|---|
| today's plate, 13,896 m | 3.79 m | 0.125° |
| rim plate, 17,896 m | **6.28 m** | **0.161°** |
| sea span, 32,000 m | 20.09 m | 0.288° |

**Six metres of sag and a sixth of a degree of gravity tilt.** That is what a true Earth-radius
sphere would buy, and §4's droop shader delivers the same six metres — or sixty, or six hundred,
whatever the owner likes — for a `+=` in a vertex shader with **zero** change to physics.

### 2.1b THE CONTRADICTION THAT NO GAME HAS ESCAPED

Put the two halves of the sphere problem side by side. Circumference `C = 2πR`, horizon
`d = √(2Rh)`:

| you want… | required radius |
|---|---|
| a **10-minute** lap at car speed (30 m/s) | **R ≈ 2.9 km** |
| a **1-hour** lap at car speed | R ≈ 17.2 km |
| a **3-hour** lap by plane (200 m/s) | R ≈ 344 km |
| a **3 km** horizon at 2 m eye height | **R ≈ 2,250 km** *(smaller than Mercury)* |
| a **10 km** horizon | R ≈ 25,000 km *(between Neptune and Uranus)* |
| a **30 km** horizon | R ≈ 225,000 km *(≈3× Jupiter)* |

**A radius that gives a satisfying lap is three orders of magnitude smaller than a radius that
gives a normal horizon.** Every shipped sphere game sits on one horn or the other and admits it:
**Outer Wilds' Brittle Hollow has a measured radius of ~308 m** — circumference 1,935 m, horizon
at eye height ~**35 m** — and the game makes that dramatic close horizon its entire aesthetic
rather than hiding it (source: physics reverse-engineering at thephysicsmill.com, back-solving
in-game measurements; the same analysis finds the game's own gravity is ~100,000× real and *not*
internally self-consistent, which the author correctly shrugs off as "this is a video game").
**Elite Dangerous took the other horn** — real 1:1 planetary radii — and its own community treats
circumnavigating even a small *moon* by ground vehicle as a multi-hour endurance achievement with
a dedicated forum club for it. **No Man's Sky split the difference at R ≈ 13–65 km** (community
measurement), which is why walking a planet takes "hours to days."

**We cannot pick either horn.** We are a GTA game: we need a kilometre-scale horizon *and* a
world you can cross in minutes. That combination is only available on a plane.

### 2.1c AND OUR CITY IS A GRID — the specific reason a sphere is worse for *us*

`Theorema Egregium`: a sphere has non-zero Gaussian curvature, a flat face has zero, so **no
cube-sphere mapping can be simultaneously equal-area, equal-angle and seamless.** The naive
"normalize the cube vertex" mapping is commonly quoted at ~**√3 ≈ 1.73×** texel-density
distortion between a face centre and its corner. The quadrilateralized spherical cube — the
standard fix — is not even a games invention: Chan & O'Neill proposed it in **1975** for the US
Naval Environmental Prediction Research Facility and NASA's COBE used it to pixelise the sky
([QSC](https://en.wikipedia.org/wiki/Quadrilateralized_spherical_cube)).

**That distortion lands directly on the one thing this game is made of.** Our world is a
**lattice**: `CBZ.CITY` is a 6×6 block grid on a 50 u step, `nearestIntersection` derives grid
coordinates from world coordinates, `roadJunctions` is *defined* as the overlap of an axis-aligned
vertical record with an axis-aligned horizontal one, and `roadCornerRadius` solves kerb returns
from lane counts on straight legs. **On a sphere the grid does not close** — and this is not
theory. **Dyson Sphere Program shipped a building-snap grid on spherical planets in 2021 and its
players report exactly this**: *"grid spacing changes over distance, and layouts that work in one
place may not work in another."* A blueprint that fits at the equator does not fit near a pole.
**Our entire city generator is that blueprint.**

*(Seed of Andromeda's open-source "inflated cube" — six independent voxel grids per face — is the
same lesson in public: "creates distortions near the corners." Astroneer dodged it by making
planets small enough to hold in one voxel grid all the way to the core, which is the Outer Wilds
trick paid for in memory instead of precision.)*

### 2.2 What it would cost this codebase anyway — COUNTED, 2026-07-28

Even granting the geometry, the migration is not a refactor. On a sphere, "up" is
`normalize(pos)`, which invalidates every one of these. All counts are `rg` sweeps over `src/`
excluding `src/vendor/` (**434 files, 321,191 lines**), and are "at least" numbers on a dense
one-liner codebase:

| flat-world assumption | counted | representative sites |
|---|---|---|
| `.position.y` reads/writes | **541 occurrences, 122+ files** | `world/door.js:31`, `core/mission.js:209` |
| `rotation.y =` / `+=` — the scalar heading | **541 occurrences, 139 files** | `entities/character.js:1026-1027,1097-1098` |
| `Math.atan2(` world-space bearing math | **416 occurrences, 127 files** | `entities/guards.js:666,860,884,916,933` |
| **independent gravity integrators** (`vy -=`) | **34 sites, 24 files** | `physics.js`, `gore.js`, `ragdoll.js`, `wildlife.js`, `water_float.js` … |
| **distinct hardcoded gravity magnitudes** | **11** — 22 · 18 · 17 (typed 3×) · 20 · 19.2 · 20.5 · 13 · 9.81 · 24 · 14 · 9.2 | `config.js:172`, `gore.js:75`, `strategic.js:1057`, `water_impact.js:145` |
| flat Euclidean XZ distance | **≈870 sites** (835 × 2-arg `Math.hypot`, 23 × `sqrt(dx²+dz²)`, 9 × `distanceTo`) | `net/networld.js:267,611`, `entities/crowd.js:502,588` |
| `hash01(x, z, salt)` generation keys | **149 occurrences, 55 files** | `city/crowd.js:221,226`, `city/childhood.js:719-720` |
| axis-aligned spatial grids | **9 owners** — `batch.js` TILE 112 (`:439`), `physics.js` COL_CELL 8 (`:30`) + PLAT_CELL (`:299`), `chunks.js` 16, `detail_kit.js`, `entities/crowd.js` 2.2, `vehicles.js` carGrid, `peds.js` pedGrid, `crowd-worker.js`, `props.js` jgrid | |
| `new THREE.Vector3(0,1,0)` up vectors | 32 | `world/water_buoyancy.js:87`, `world/rockscliffs.js:273` |
| `lookAt(` | 28, 13 files | `systems/camera.js:319,390,450,478,506` |

- **The ground oracle is not one function, it is forty-four.** `CBZ.floorAt` has **194 refs
  across 65 files** (canonical def `modes/survival.js:194`, published `:347`; re-published by
  `city/mode.js:301,531`), and **nine files re-declare a local pass-through `floorAt`**
  (`tornado.js:200`, `grapple.js:60`, `gore.js:124`, `aircraftimpact.js:124`, `nukefx.js:199`,
  `snowboard.js:30`, `crashfx.js:46`, `playerair.js:87`, `bailout.js:83`). Beyond it there are
  **~22 distinct canonical elevation oracles** (`terrainHeight` — *defined twice*, in
  `terrain.js:251` and `terrain_overhaul.js:1049* — `groundAt`, `cityGroundHeightAt`,
  `citySeaHeightAt`, `waterWaveHeight`, `snowTerrainHeightAt`, `desertDuneHeightAt`,
  `greaterSnowTerrainHeightAt`, `mpGroundAt`, `highwayNetReliefGate`, …) plus **~22 more local
  wrapper closures** (5 × `groundY`, 8 × `floorY`). **~44 named "what is the ground here"
  functions, every one of them signed `(x, z) → y`.** That signature *is* the flat world.
- **The collider model.** `systems/physics.js` is circle-vs-**axis-aligned-box** (`:124-155`,
  fields `minX/maxX/minZ/maxZ`) with an 8 m grid broadphase keyed on `Math.floor(x/COL_CELL)`
  (`:30, :80-81`). An axis-aligned box in world space is *meaningless* on a sphere; every
  collider would need an orientation and the broadphase a spherical index (cube-sphere face +
  quadtree). That is a from-scratch physics broadphase.
- **Twenty-four independent gravity integrators with eleven different constants** is the
  single most damning number here. On a plane, "gravity" is `vy -= g*dt` and a wrong constant is
  a feel bug. On a sphere every one of those 34 sites needs a *direction*, and one missed site is
  an object that falls sideways off the planet. There is no shared bus to migrate — CLAUDE.md's
  own ledger already lists "independent AI update loops: 32" and "raw `.hp -=` writes: 52" in the
  same spirit. `water_impact.js:145`'s comment even admits its `GRAV = 9.2` "must match
  water_wake.js's droplet gravity" — an acknowledged duplication that a sphere would multiply.
- **Determinism.** `CBZ.hash01(x, z, salt)` (`core/seed.js:85`) rounds `x*10, z*10` and mixes;
  **149 sites in 55 files**. Generation on a sphere keys on a surface parameterisation, not
  (x,z) — so **every hash in the world changes**, GOLDEN recalibrates, and the multiplayer
  byte-identity law is re-proved from scratch.
- **Batching.** `core/batch.js` buckets static geometry by
  `"T" + floor(elements[12]/112) + "," + floor(elements[14]/112)` (`:439`) — an explicit,
  unbounded, axis-aligned world XZ tile grid. The continent is one `PlaneGeometry` at
  `(SEG+1)²` (`continent.js:731-734`).
- **Roads.** `city.roads` records are axis-aligned rectangles; `roadrules.js`'s entire law
  (`roadSegmentAt`, `roadCross`, `roadJunctions`, `roadClearance`) is 2-D interval geometry.
- **The sea.** `CBZ.waterSeaY()` (`water_spec.js:670`) is a scalar Y read by buoyancy,
  submergence, hull attitude, the wet-sand apron and the gore medium. On a sphere it is a radius.
- **There is no floating-origin system to build on.** `floatingOrigin` / `rebase` / `originShift`
  return **zero hits in `src/`**. The one camera-relative mechanism in the whole engine is the
  ocean's vertex shader.
- **Multiplayer is 100% absolute world coordinates with no delta encoding anywhere.**
  `net/net.js:178` ships `p:[round(x*20)/20, …]`; `net/networld.js:76,91` ship X,Z + `rotation.y`;
  `net/netpersist.js:102` and `net/sqlitedb.js:295,298` persist and key on absolute x/z.

**Honest estimate: this is a rewrite of the world layer, not a migration of it.** I will not put
a week number on it, because any number I wrote would be a guess and the point stands without
one: it touches ~44 ground oracles, 34 gravity integrators across 24 files, 541 heading writes
across 139 files, 149 determinism keys, 9 spatial grids, the collider model, the road law and
the whole net protocol **simultaneously**, and there is no flag that reverts half of it.
**REFUSED.** If the owner wants a tiny planet you can walk around in twenty minutes, that is a
different game and it should be built as one (see §8 Q1).

**One consolation prize worth stealing from option 1:** `core/sky.js:115-116` already builds the
sky as `SphereGeometry(850, 32, 20)`. **The world already has a sphere in it** — it is just
inside-out. Turning that dome into a *visible planet from altitude* (§4.3) is a texture and a
camera transition, not a physics change.

---

## 3. OPTION 2 — WRAPPED WORLD. Viable, in one axis, through ocean.

### 3.0 What shipped games did, and the one that proves my axis choice

**Civilization is the best-documented wrapped world and it defaults to a CYLINDER** — east–west
wrap, no north–south wrap, impassable poles. Toroidal (both-axis) wrap *is* a shipped option in
Civ IV onward, and the cost is documented by the developers' own community in one sentence:
**"the polar ice caps are taken out to allow the toroidal to work"** (civfanatics thread 280304).
**A shipped game had to delete its ice caps to close the second axis.** That is exactly §6's
argument stated by somebody else: **you cannot wrap north–south and keep latitude.** Players in
the same thread confirm it changes the game, not just the map — *"someone could come from any
direction… one empire bordered me on both the north and south."*

**Wrap is a world-model decision made early, not a toggle added late.** Starbound wraps X by
default; Terraria — a near-identical genre peer — does not, and wrap exists there only as a mod.
Factorio explicitly never wrapped and its request thread never shipped. Nothing found in the
research shows a game adding a wrap to a shipped bounded world. **If we want this, we decide it
before the rim ships, not after.** *(That is an argument for deciding NOW even if we build it
LAST — §5's stage D is a scheduling choice, not a deferral of the decision.)*

**The distance metric has a name and a formula**, borrowed from molecular dynamics' periodic
boundary conditions rather than from games — the **minimum image convention**:
`delta = ((dx + L/2) mod L) − L/2` per wrapping axis, equivalently the min over the 9 (2-D)
wrapped copies. Worth using the standard name in the code so the next person recognises it.

### 3.1 What makes it cheap here, and it is one property

The seam must run where **nothing is drawn, nothing is authored, and nothing straddles it.**
This repo already has such a place and it is 3.5 km wide:

```
WORLD_SEA_SPAN 25,000 u   (world/layout.js:492-500, derived)   plate 13,896 u
open water each side = (25,000 − 13,896) / 2 = 5,552 u
max draw distance    = fog 1,400 m at tier 4  (core/quality.js:73)
```

At the rim plan's numbers (`SEA_SPAN` 32,000, plate 17,896) the water band is **7,052 u each
side** — and the two coasts are 14 km apart across the seam against a 1.4 km horizon. **Put the
wrap at mid-ocean and the far coast is ten draw-distances away.** Nothing is rendered twice, no
3×3 tiling, no seam strip, no second continent in the frustum. The most expensive part of every
published wrapped world — *rendering across the seam* — costs zero here **by construction**, and
the reason is `pillar-rim.md`'s own design: it puts the emptiest possible content at the edge.

And the second-most expensive part is already solved: the ocean is a **camera-centred radial disc
in the vertex shader** (`water_spec.js:24-31`) that "never moves". There is no water edge to
cross. The player flies west over open sea, the west coast recedes into fog, sixty seconds of
water, and the east coast appears ahead. The teleport happens in the middle of that, with nothing
within 5 km of the player.

**And no field has to be made periodic.** This is the finding that decides the design. A wrapped
heightfield normally forces every analytic octave onto a frequency that divides the wrap period —
a brutal constraint on `countryHeightAt`, the ridged lobes, the dune term and `hash01` alike. If
the seam is in open ocean, **sea level is sea level on both sides** and continuity is free.

### 3.2 What it still costs — named honestly

1. **A wrapped distance metric, at a bounded set of sites.** `dx = a.x − b.x` becomes
   `dx = wrapDX(a.x − b.x)`. There are hundreds of such sites in `src/` — but **only the ones
   whose two operands can be on opposite sides of open ocean matter**, and that set is small and
   enumerable: the player, driveable/flyable vehicles, boats, aircraft, the camera, wildlife
   (sharks), map/compass bearings, mission waypoints, and MP interest management. Peds, traffic,
   cops, shops, roads, buildings and every generator live on the plate and can never straddle the
   seam. **That is the whole reason this is weeks and not months** — and it is only true while
   the seam stays in water. Write it down as a law: *a wrap seam that touches land is a different,
   much more expensive project.*
2. **Multiplayer.** `net/networld.js:138-145` gates interest on `d2 = dx*dx + dz*dz` against
   `SCOPE_ENTER2`/`SCOPE_LEAVE2`; `net/netactors.js:121,166-177` buffers absolute positions
   (`m.p[0..2]`) and **interpolates between them**. A peer crossing the seam produces a 32 km
   lerp — a visible slingshot — unless the buffer is told about the shift. Fix is a sequence
   number or an explicit `wrapEpoch` on the position message. Bounded, but it is real work in the
   one subsystem where a bug is hardest to see.
3. **Anything anchored to the player across the teleport**: a pursuing helicopter, a tethered
   boat, a mission beacon, the killfeed's `by` reference. The clean answer is a
   `CBZ.worldWrapShift(dx)` bus that fires once and lets ~10 subscribers translate. The dirty
   answer (shift everything within R of the player) is worse and will leak.
4. **The map and the compass become cylindrical.** `systems/fullmap.js` draws in world
   coordinates; a wrapped X means the map has no left or right edge. Either draw it three times
   horizontally and clip, or let it scroll infinitely. `systems/compass.js:30` bearing math is
   fine; *waypoint* bearing is not (it must pick the short way round).
5. **Determinism.** If any hash-driven content is ever sampled at an unwrapped X (the ocean's own
   scatter, fishing spots, sea wildlife), `hash01` must wrap first. **One line inside
   `core/seed.js:85`** makes the entire world periodic — elegant, and it changes every hash value
   in the game, so it is a GOLDEN recalibration and must be flagged.

### 3.3 What it buys — and the honest counter-argument

It buys: no wall on two sides forever, a heading that is always valid, and the literal word
*circumnavigate*. **It also buys a measurement, and that is the risk.**

| wrap period | car 40 m/s | jet 240 m/s | boat 15 m/s |
|---|---|---|---|
| rim plate long axis, 17,896 u | 7.5 min | **1.2 min** | 19.9 min |
| `SEA_SPAN` 32,000 u | 13.3 min | **2.2 min** | 35.6 min |
| 3 × sea span, 96,000 u | 40.0 min | **6.7 min** | 1 h 47 |
| 100,000 u "ocean world" | 41.7 min | 6.9 min | 1 h 51 |

**A world you can lap in 2.2 minutes is a world whose size you have measured.** Today the map
feels unbounded partly because you cannot get to the end of it; closing the loop hands the player
a number. If wrap ships, the period should be **≥ 3× the sea span** so a jet lap costs ~7 minutes
— inside the same 8–20 min fond-crossing band `pillar-rim.md §6.2` established for ground
crossings — and the extra 60 km must be **ocean**, which is the cheapest content this engine has
(camera-relative water, existing sharks, existing swim/drown, existing fishing, existing boats).

**Float32 is not a constraint here, and this is checkable against two shipped games.** For a
coordinate in `[2ⁿ, 2ⁿ⁺¹)` the float32 ULP is `2ⁿ⁻²³`: **1 mm at 10 km · 8 mm at 100 km · 6.25 cm
at 1,000 km · 1.0 m at 2²³ = 8,388,608 m.** That last number is not theory — **Factorio's shipped
map limit is exactly ±2²³ tiles**, and Minecraft's Far Lands terrain corruption sat at
12,550,821–12,550,824 blocks, both landing on the same wall. Three.js additionally composes
`modelViewMatrix` on the CPU in float64 and uploads the *product*, so object transforms are
already effectively camera-relative; the only float32 exposure is vertex data inside one large
geometry, and our largest is the continent plate at ±9 km (1 mm). **A 100 km ocean world is safe
on today's precision with no floating-origin system.** Past ~250 km the standard fixes exist and
are WebGL1/r128-compatible: **RTC** (per-tile origin in the model matrix — three lines) and
**RTE** (split each coordinate into float32 high+low, subtract the camera's own split in the
vertex shader — Cesium's technique, which is how a real WGS84 ellipsoid runs in a browser at all,
because *WebGL has no float64 in the shader*). KSP's **Krakensbane** is the same idea at runtime
(re-centre the universe on the vessel; tuned constants `MaxV = 5 m/s`, `altThreshold = 200 m`),
and the "Kraken" the community names its physics blow-ups after **is** this bug class. **We do
not need any of it, and knowing exactly where we would is worth more than building it.**

### 3.4 Why NOT a torus (wrap both axes)

Wrapping Z as well is the same code and it is the wrong design, for a reason that belongs to §6
rather than to rendering: **a torus has no poles and therefore no latitude.** Every climate rule
in §6 keys on a north-south axis with a cold end and a hot end. On a torus, north of the ice cap
is the desert. There is also no rain-shadow story that closes: air that descends dry in the lee
returns to the windward coast still dry, because it never crossed an ocean to re-moisten.
Wrapping X only — a **cylinder** — is Civilization's topology and it is the correct one: latitude
runs N–S, prevailing wind runs E–W and *circles the world, which is what prevailing winds actually
do*, and the ocean crossing is the moisture recharge that closes the loop physically.

---

## 4. OPTION 3 — THE VISUAL GLOBE. Cheapest, and it is the one that is *seen*.

Three independent pieces, each shippable alone.

### 4.1 Horizon droop — a vertex-shader displacement, zero physics change

`y_view −= (x_view² + z_view²) / (2·R_visual)` applied in **view space** (so it is symmetric
about the camera and needs no world origin), injected via `onBeforeCompile`. **14 non-vendor
files touch a custom shader** and would be injection candidates — `city/world.js`,
`city/props.js`, `city/interiormap.js`, `city/nukefx.js`, `core/gfx.js`, `core/renderer.js`,
`integrations/grass.js`, `systems/dustfx.js`, `systems/skidmarks.js`, `world/terrain_overhaul.js`,
`world/water_spec.js`, `world/water_underwater.js`, `world/water_wake.js`, `world/waterfx.js` —
and **four of them already displace vertex positions** (the ocean swell GLSL that
`water_spec.js:736` generates and injects into `city/world.js` and `waterfx.js`; grass wind-sway
in `integrations/grass.js`). The pattern is not new here; it is already the water's.

Drop in metres at distance `d` for a chosen visual radius:

| `R_visual` | 250 m | 500 m | 1,000 m | 1,400 m *(fog wall)* | 3,000 m | 9,000 m *(backdrop)* |
|---|---|---|---|---|---|---|
| 5 km | 6.3 | 25.0 | 100.0 | 196.0 | 900 | 8,100 |
| 20 km | 1.6 | 6.3 | 25.0 | 49.0 | 225 | 2,025 |
| **50 km** | 0.6 | 2.5 | 10.0 | 19.6 | 90 | 810 |
| **200 km** | 0.2 | 0.6 | 2.5 | 4.9 | 22.5 | 202.5 |
| 6,371 km *(real)* | 0.0 | 0.0 | 0.1 | 0.2 | 0.7 | 6.4 |

**The shipped precedent is Animal Crossing: New Horizons, and its own name for the trick tells you
what it is.** Nintendo call it **"Rolling Log"** and it descends from a **Nintendo DS**-era hack
for showing sky on the second screen — it was never a planet simulation. The reproduced
implementation (github.com/skylarbeaty/curved-world; notslot.com/tutorials/2020/04/world-bending-effect)
is: take distance from **camera-space Z only** (depth, not true 3-D distance), raise it to an
exponent, add the result into world-space Y, convert back to object space. **Every shipped version
of this uses an artist-tuned "Amount" slider with no physical radius behind it** — which is the
honest way to ship ours too.

**And it pays for itself on our actual bottleneck.** The same implementation notes that cranking
curvature *"hides behind the horizon some of the extra terrain you would be able to see"* — the
droop is **an animated, distance-based LOD mask**. On a renderer measured at 2,668 draw calls with
*"safe headroom mostly exhausted"*, a look feature that also removes distant geometry from the
frame is the rare thing that is free twice. It composes with `farcull.js`'s rank-based detail
budget rather than fighting it.

Two things fall out and both must be said plainly:

- **Real curvature is invisible here.** At Earth's radius the drop at our fog wall is 20 cm. And
  the inverse is worse: at a 2 m eye height, a **3 km** horizon needs `R ≈ 2,250 km` (smaller than
  Mercury), a **10 km** horizon needs 25,000 km (bigger than Neptune), a **30 km** horizon needs
  225,000 km (~3× Jupiter). **No plausible game draw distance can ever be curvature-limited by a
  real planet.** Whatever the owner sees will be a **stylisation**, and it should be exposed as a
  dial (`CBZ.CONFIG.WORLD_CURVE_R`), not sold as physics.
- **One radius cannot serve both the ground and the backdrop.** At R = 50 km a 1,250 u backdrop
  peak 9 km away sinks 810 m — the skyline would be eaten. The backdrop ranges are already a
  **separate unlit `MeshBasicMaterial` layer** (`world/terrain_overhaul.js`; CLAUDE.md's
  `TERRAIN_BACKDROP_CLEAR` entry names the split), so give them their own, weaker radius. Two
  constants, one law: *near ground curves; sky-backdrop curves less; the sky does not curve.*

**First consumer, and it is nearly free:** `water_spec.js` already displaces the ocean's vertices
per-frame camera-relative (`:24-31`, `cbzWaveAmp3`'s `cfade` term at `:592-593`). The sea horizon
is the single most legible curvature cue in any game that ships one. Adding the droop term to the
water shader is the demo, and it is a handful of lines.

**What it breaks, in order of likelihood:** shadow maps (the shadow is cast in world space and
will not follow drooped geometry — mitigate by keeping `shadowHalf ≤ 150` m, `core/quality.js:55`,
where drop is < 0.25 m at any sane R) · frustum culling (drooped geometry leaves the culler's
world-space bounds — pad the bounding spheres, which is one number in `farcull.js`) · anything
projecting a world point to screen (`tools/aimlib.js`'s NDC test, HUD markers, `aim_dossier`'s
overhead pill) — **these must apply the same droop or they will float off their target**, and
CLAUDE.md's aimlib warning is exactly the failure mode · decals and `roadPaint` quads (they are
part of the ground and drooped with it, so fine) · **the math gate does not render and is
therefore blind to all of it** — droop is verified by the owner playing, per house doctrine.

### 4.2 The world map becomes a globe

`systems/fullmap.js` already owns `CBZ.mapIcon`, a rank-tiered icon system with a `dataURL`
cache. A globe view is a second projection of the same data: render the map plate to a canvas
texture, wrap it on a sphere, spin it. **This is the single most literal answer to "an actual
GLOBE" and it costs a projection function.** Every icon, label, region and waypoint already
exists in world coordinates and `mapLabel` already measures and collision-tests them.

### 4.3 The space view

Climb past a threshold (the airliner already reaches altitude; `city/playeraircraft.js` owns the
flight model) and the camera transitions to a rendered ball with the map texture on it, the
continent centred. It is a cinematic, not a place. It is also the *only* honest way to see a
planet in a world of this size — even a true Earth-radius sphere would show you nothing from
400 km up but one 18 km smudge.

---

## 5. THE RECOMMENDATION — option 4, staged

**STAGE A — THE SCIENCE (do this first; it needs no topology decision at all).**
`CBZ.climateAt(x, z) → {tempC, precipMm, biome, wetness, snowFrac}` (§6). It replaces authored
rects with a derivation, it makes the rim plan's four corners *causal* instead of asserted, and
it lands entirely inside terrain/biome territory. **It is also the only stage that improves the
world we ship today** — everything else improves a world we have not built yet.

**STAGE B — THE VISUAL GLOBE.** Droop (water first, then ground, backdrop on its own radius) +
the globe map + the space view. Days each, all flagged, all independently revertible, and it is
the stage the owner *sees*. `WORLD_CURVE_R` is a dial he can turn himself.

**STAGE C — `pillar-rim.md` R1–R4 as written, amended by §7.** The world gets huge. This is
already planned and already sequenced; **nothing in this document changes its waves, its flags,
its belt arithmetic or its ratchets** — only four arguments to declarations it was already going
to write: the wind becomes WSW, the range becomes an L, the two ice corners become wet ice and
dry ice, and the South Belt's regime is computed instead of typed. **A must land before C's R3
(the amplitude wave), because R3 is where a sector first carries relief and therefore the first
moment a rain shadow can exist.**

**STAGE D — THE OCEAN WRAP, and only if the owner still wants it after B and C.** Single-axis
(X), seam at mid-ocean, period ≥ 3× sea span, `worldWrapShift` bus, MP wrap epoch, cylindrical
map. Flag `WORLD_WRAP_X`. **Do not schedule it before C** — the wrap's cheapness depends
entirely on the rim being empty and the ocean being wide, and both are C's output.

**NEVER — the true sphere.** §2. If the owner wants it after reading the 129 m horizon number,
that is a new game and it should be scoped as one.

Why this order and not "globe first": the globe is the *word* the owner used, but the *feeling*
he described — a world that is huge and whose places make sense — is delivered by A and C. B is
three days of work that makes the world look like a planet. D is the only expensive part of the
topology ask, and it is the part the player will notice least.

---

## 6. THE BIOME SCIENCE — the rule set that GENERATES our map instead of authoring it

### 6.0 The honest scale problem, stated before any rule

Our map spans **16,645 u north–south**, which is **0.15° of real latitude**. A snow-to-desert
gradient needs 20–30° = 2,200–3,300 km. **Anything calling itself "latitude" here is compressed
by two orders of magnitude and must say so.** The literature gives two ways to handle that
([Köppen](https://en.wikipedia.org/wiki/K%C3%B6ppen_climate_classification) /
[Whittaker](https://en.wikipedia.org/wiki/Biome) worldbuilding practice): **COMPRESS** (call the
map a whole planet and squeeze the bands together — this is the failure mode behind the
long-standing complaint that pre-1.18 Minecraft put desert directly against snowy taiga with no
causal transition) or **LOCATE** (declare the map is one *region* at a stated latitude on a
larger implied planet and derive everything from that one latitude plus local terrain, wind and
coast).

**We do neither purely, and the reason is arithmetic.** At 16 km the drivers that genuinely
operate at our scale are **elevation lapse rate** and **rain shadow** — the Southern Alps drop
from 6,300–8,900 mm/yr windward to under 760 mm/yr **50 km** away, and the Olympic Peninsula
runs ~2,200 mm windward to 250–380 mm at Sequim over **80 km**
([Rain shadow](https://en.wikipedia.org/wiki/Rain_shadow)). Those are *our* distances. Latitude
is not. So:

> **THE DOCTRINE: orography does the real work and is uncompressed, citable and honest.
> Latitude is a declared compression that supplies the background trend and the guard rail.**
> Every rule below says which of the two it is.

The compression we choose: **39°N at the south edge to 63°N at the north edge — 24° over
16,645 u, i.e. 1° per 694 u of driving, a 161:1 compression.** That is far milder than the
"whole planet on one map" alternative, and it is chosen for one reason: **it is the narrowest
band that contains every biome the world already has, each at the latitude Earth puts it.**

### 6.1 WHERE WE ARE ON OUR PLANET — the fiction, made numeric

North is `−Z` on this map (`city/worldmap.js:141`). Let `φ(z) = 63 − (z + 10,700) × 0.0014419`
over the rim plate (`z ∈ [−10,700, 5,945]`). Then, **evaluated against the world as it stands
today**:

| place | z | φ | MAT °C | P_lat mm | treeline m | real-world twin |
|---|---|---|---|---|---|---|
| Mercy Wall crest (rim N) | −8,400 | **59.7°N** | 1.7 | 706 | 1,211 | coastal Norway / Iceland |
| Kesh Shield (rim NE) | −6,800 | 57.4°N | 3.0 | 752 | 1,391 | — *(see 6.6)* |
| snow core / Mount Mercy | −3,850 | 53.1°N | 5.7 | 838 | 1,722 | Canadian Rockies |
| Redhollow forest (**W coast**) | −2,250 | 50.8°N | 7.2 | 884 | 1,902 | **Vancouver Island / Olympic Peninsula** |
| farmland (**E**) | −1,930 | 50.4°N | 7.5 | 893 | 1,938 | Canadian prairie / Palouse |
| downtown / mainland | 0 | 47.6°N | 9.3 | 827 | 2,155 | Portland · Montreal · Milan |
| Saltlands desert (**E**) | +450 | 46.9°N | 9.7 | 808 | 2,210 | **Columbia Basin / Gobi** |
| Goldspire · Cape Harbor | +1,300 | 45.7°N | 10.5 | 771 | 2,369 | Bordeaux · Minneapolis |
| South Belt (rim S) | +4,000 | 41.8°N | 13.1 | 654 | 2,875 | Great Basin |
| plate south edge | +5,945 | 39.0°N | 15.0 | 570 | 3,240 | Nevada · Anatolia |

**Prevailing wind: WESTERLIES, from the WSW, blowing toward the ENE.** That is not a taste call —
between 30° and 60° the westerlies are the prevailing band on Earth
([Prevailing winds](https://en.wikipedia.org/wiki/Prevailing_winds)), and our entire map sits at
39–63°. `pillar-rim.md`'s "one wind" was right; the science just says it is **WSW, not WNW**, and
that it is *the only wind the map is allowed to have.* Research consensus on what players
actually reward is unambiguous here: **one globally consistent wind direction, so every ridge's
dry side faces the same way**, is worth more perceived realism than formula precision — *"a
player who notices all shadows fall the same way subconsciously credits the world with weather."*

### 6.2 THE RULE TABLE — 9 steps, each O(1) or ≤5 samples

Every step names its driver as **[REAL]** (operates correctly at our scale) or **[COMPRESSED]**
(a declared fiction). Constants marked **TUNE** must be measured against the shipped world and
printed, never pinned blind.

| # | rule | formula | kind | source |
|---|---|---|---|---|
| 1 | **latitude** | `φ = 63 − (z + 10,700)·0.0014419` | **[COMPRESSED 161:1]** | declared |
| 2 | **base temperature** | `T_lat = T_eq − (T_eq − T_pole)·sin²φ`, **TUNE** `T_eq = 30`, `T_pole = −8` | [COMPRESSED] | sin²-form of the North-1975 Legendre-P₂ energy-balance model; exact at both endpoints, monotonic |
| 3 | **latitude precipitation** (Hadley / Ferrel / Polar) | piecewise-linear on \|φ\|: `{0°:2000, 15°:1200, 30°:300, 50°:900, 60°:700, 90°:150}` mm | [COMPRESSED] | rising ITCZ at 0°, subsiding subtropical high at 30° (Sahara/Arabian/Kalahari/Sonoran/Australian all sit on it), polar front rising at 60° ([Atmospheric circulation](https://en.wikipedia.org/wiki/Atmospheric_circulation)) |
| 4 | **wind vector** | westerlies for 30–60°: `W = normalize(+0.71, +0.71)` in (east, north) — **from** WSW **toward** ENE. Coriolis: NH deflects right | [REAL] | [Prevailing winds](https://en.wikipedia.org/wiki/Prevailing_winds) |
| 5 | **RAIN SHADOW** — *the load-bearing rule* | march ≤5 samples upwind to ~4,000 u; `barrier = max(0, max(h_upwind) − h)`; `P ×= exp(−k_shadow·barrier)`, **TUNE** `k_shadow` so a 1,400 u ridge cuts ~85–90% | **[REAL — uncompressed]** | forced ascent → moist-adiabatic cooling → windward rain → lee descent warming at the *dry* rate. Olympic **8–9× over 80 km**; NZ Southern Alps **up to 20× over 50 km**; Atacama = **two stacked ranges** ([Rain shadow](https://en.wikipedia.org/wiki/Rain_shadow), [Atacama](https://en.wikipedia.org/wiki/Atacama_Desert)) |
| 5b | **windward bonus** | `P ×= 1 + k_oro·max(0, dh_toward_sample)` | **[REAL]** | same mechanism, other side |
| 6 | **continentality** | `P ×= exp(−d_ocean / L)`, **TUNE** `L` | [REAL-ish] | no defensible universal mm/km constant exists — exponential moisture retention is what falls out of the march itself |
| 7 | **cold-current coastal desert** | if `d_ocean` small **and** the coast is an equatorward-current coast in the 15–30° band → force low P and set `fog = true` | [REAL] | Atacama **~15 mm/yr** (Humboldt), Namib **<5–85 mm/yr, >180 fog-days** (Benguela). **Our band is 39–63°, so this rule DOES NOT FIRE on our map** — it is written down so a future southern extension gets it right, and so nobody invents a different mechanism later |
| 8 | **lapse rate on temperature** | `T = T_lat − 6.5 °C/km · h` — the **environmental** rate, *not* the adiabatic | **[REAL]** | [Lapse rate](https://en.wikipedia.org/wiki/Lapse_rate). **Do not conflate:** 9.8 (dry adiabatic) and ~5 (moist) are *parcel* rates and belong in step 5; 6.5 is the *standing field* the player feels on a slope. This is the single most common implementation error |
| 9 | **biome lookup + alpine override** | Whittaker (T, P) table → biome; then **override** if `h > treeline(φ)` | mixed | see 6.3–6.4 |

### 6.3 THE BIOME TABLE — Whittaker, with the Köppen aridity test bolted on

Whittaker (mean annual temperature × mean annual precipitation) is the right instrument for a
game: two numbers in, one biome out, no simulated seasons needed. **These boundaries are
textbook-grade approximations, not a digitisation of the original figure — the researcher could
not retrieve exact vertex coordinates and said so; treat them as tuneable, not sacred.**

| biome | MAT °C | MAP mm/yr | our sector |
|---|---|---|---|
| ice cap / nival | < −2 *(or `h` > snowline)* | any | Mercy Wall crest, Kesh dome |
| tundra / alpine | < −5 | < 250–500 | above treeline everywhere |
| boreal / taiga | −5 … 5 | 300–1,500 | Redhollow Reach north, Mercy flanks |
| temperate rainforest | 5 … 15 | **1,500–3,000+** | **Redhollow (W coast, windward)** |
| temperate seasonal forest | 5 … 20 | 750–1,500 | interior slopes |
| temperate grassland / prairie | −5 … 20 | 250–750 | **the settled interior** |
| cold desert / steppe (BSk/BWk) | 0 … 18 | < aridity threshold | **Saltlands, South Belt, the erg** |
| hot desert (BWh) | > 18 | < aridity threshold | *not reachable on our latitude band* |

**The aridity test is Köppen's and it is a real formula, so use it rather than a picked number.**
`Pthresh = 20·MAT + 280` if ≥70% of rain falls in the warm half-year, `20·MAT + 140` if evenly
distributed, `20·MAT + 0` if winter-dominant. Then **BW (desert) if MAP < 0.5·Pthresh**, **BS
(steppe) if 0.5·Pthresh ≤ MAP < Pthresh**. We have no seasons, so use the even form.

**This is what makes the desert a consequence rather than a rectangle**, and the arithmetic is
the best single result in this document:

| our desert | latitude P | Pthresh (even) | BW needs | **required shadow** | is that real? |
|---|---|---|---|---|---|
| Saltlands (46.9°N, MAT 9.7) | 808 mm | 335 | < **167 mm** | **4.8×** | **yes, comfortably** — Olympic is 8–9× |
| South Belt (41.8°N, MAT 13.1) | 654 mm | 402 | < **201 mm** | **3.3×** | yes |
| erg core (a true sand sea, < 25 mm) | 654–808 mm | — | < 25 mm | **26–32×** | **only with TWO stacked barriers — the Atacama mechanism** |

> **THE SCIENCE FORCES THE RANGE SHAPE.** A 4.8× shadow needs a barrier across the wind. A 26×
> shadow needs *two*. `pillar-rim.md`'s Mercy Wall is an east–west wall in the north; a WSW wind
> travels **past** it, not over it. So the desert has no cause, and neither does the "partial
> shadow prairie" the pillar asserts for the settled interior. **§7.1's L-shaped range is not a
> taste amendment — it is the only way the map's existing desert is allowed to exist.**

### 6.4 THE ALTITUDE LADDER — treeline and snowline, both latitude-dependent

**Treeline**, anchored on real measurements ([Tree line](https://en.wikipedia.org/wiki/Tree_line)):
flat at **3,500–4,000 m between 30°N and 20°S**, then **−130 m per degree from 30° to 50°**, then
**−75 m per degree from 50° to 70°**. Real anchors: Costa Rica 9.5°N → 3,400 m · Swiss Alps 47°N
→ **2,200 m** · Canadian Rockies 51°N → 2,400 m · S. Norway 61°N → 1,100 m · Abisko 68°N → 650 m ·
Finnmarksvidda 69°N → 500 m. **Anchor our curve on the Alps (47°N = 2,200 m)** and run −78 m/°
above it; that reproduces Norway to within 8%. Why the treeline is *there*: the **10 °C
warmest-month isotherm** — which is **also Köppen's own ET/tundra boundary**, so the two systems
agree on this one line for free. (Modern synthesis: growing-season mean at treeline is
~**6.4 ± 0.7 °C** worldwide.)

**Snowline**, and this is the detail worth shipping because it is counter-intuitive and true:
equator ~**4,500 m**, rising to as high as **5,700 m in the Himalaya at 20–25°**, falling to
~**3,000 m in the Alps** and to **sea level at the poles** ([Snow line](https://en.wikipedia.org/wiki/Snow_line)).
**The snowline is HIGHEST in the subtropics, not at the equator** — because the subtropical high
(the same Hadley subsidence that makes the deserts) starves it of snowfall and its clear dry air
sublimates what falls. **Aridity, not temperature, sets the snowline in the subtropics.** That is
the third time the 30° subsidence belt does work in this rule set, which is the evidence it is
worth computing.

**How this meets `pillar-scale.md §3.2`'s `hasSnowCover`, without breaking it.** That promotion
makes the snowline a **fraction of the local crest** (`SNOW_WARM = 0.42 C`, `SNOW_COLD = 0.80 C`
— today's 380/720 against `peakAmp 900`, byte-identical). That fraction is a *local-relief* rule:
"snow lies near the top of a massif." The climate answer is an *absolute* rule: "no permanent
snow below X metres at this latitude." **They are both right and the composition is a MAX, not a
MIN:**

> `snowlineY(x,z) = max( climateSnowline(φ, P) , SNOW_WARM_FRAC × localCrest )`
> — the latitude sets the floor below which snow is impossible; the local fraction keeps snow off
> the ankles of a massif that is tall enough to have any. **At today's world the fraction is
> almost always the binding term, so `hasSnowCover` stays byte-identical and the flag reverts
> cleanly.**

### 6.5 WHAT THE FIELD SAYS ABOUT THE WORLD WE ALREADY SHIP

Run over today's map, the rules agree with **eight of ten** placements — and the two
disagreements are both informative rather than fatal.

**AGREES (and these are not coincidences we engineered — the world was laid out before any of
this existed):**
- **Redhollow forest, west coast, 50.8°N** = Vancouver Island / the Olympic Peninsula, the
  canonical windward temperate rainforest. Under westerlies a west coast at 45–60° gets onshore
  maritime air continuously (Köppen **Cfb**, oceanic, narrow annual range).
- **Farmland, east, 50.4°N** = at the same latitude the *east* coast has that wind blowing
  **offshore**, so it never gets maritime moderation and sits in air conditioned by the whole
  interior upwind — Köppen **Dfb**, humid continental, cold winters, wide range. **This is why
  Western Europe at 50°N reads nothing like Eastern Canada at 50°N**, it is a pure function of
  *(which side of the continent) × (wind direction)*, and our farm belt is on exactly the right
  side ([Oceanic climate](https://en.wikipedia.org/wiki/Oceanic_climate)).
- **Saltlands, east, 46.9°N** = the Columbia Basin (46–47°N, 150–200 mm/yr, sagebrush, dunes) or
  the Gobi (42–45°N) — a **cold-winter rain-shadow desert with sand seas, mesas and salt flats.**
  The name is already right: the Bonneville Salt Flats are the Great Basin's own.
- **Mercy Wall, 59.7°N, 1,400 u crest against a 1,211 m treeline** — **189 m of genuine alpine
  zone above the trees**, maritime, glaciated. `pillar-rim.md` picked Vatnajökull as its grammar
  for this seam *before* anyone computed the latitude, and the latitude agrees.
- **The erg's 600 u rock massifs, 41.8°N** — treeline is 2,875 m there, so those massifs are
  **bare because they are ARID, not because they are cold.** That is precisely the case
  `pillar-rim.md §4` said the current gate cannot express, and the field supplies the reason the
  gate's third form (`mtnUnclaimed`) needs.

**DISAGREES (1) — the interior snow core.** Mount Mercy is **900 u at 53.1°N against a 1,722 m
treeline**, and it sits in the *lee* of Redhollow under westerlies. Under real rules that is a
forested subalpine massif with seasonal snow, not a permanent icecap. **Three honest ways to
close it, and the owner picks:** (a) grow it — `pillar-rim.md §1.3` *already* demotes it
("Mount Mercy stops being the mountain and becomes the foothill in front of the mountain") and
`RIM_RANGE_AMP` is the dial; (b) declare it maritime-wet and drop its equilibrium line — real and
citable (Mt. Rainier at 46.9°N glaciates from ~1,100 m purely on snowfall volume, while the
Rockies at 51°N do not until ~2,400 m); (c) **pin it** (Q3). **This is the only place the field
contradicts something the owner can currently see, and it is one climate step, not a rewrite.**

**DISAGREES (2) — the Kesh Shield, and this one is a genuine improvement.**
`pillar-rim.md §0.7` puts an ice sheet in the **northeast, the dry lee**, and justifies it with
"the Gobi-Altai case, where glaciers *shrank* during the ice age because aridity, not cold, gates
ice." **That citation argues the opposite of the conclusion**: it explains why a dry lee has
*less* ice. An ice sheet needs accumulation, and accumulation lives on the windward side.

> **AMENDMENT: the two ice corners become two DIFFERENT ices, and the difference is caused by
> the wind.** (i) **WET ICE** on the north/northwest — a glaciated alpine cap on the Mercy Wall
> with outlet lobes and nunataks (Vatnajökull, unchanged from the pillar's own grammar). (ii)
> **DRY ICE** on the northeast — a **polar desert**: wind-scoured frozen gravel, sastrugi, blue
> exposed glacial ice in hollows, bare rock ridges, almost no snow depth. The McMurdo Dry Valleys
> / Antarctic blue-ice look.
>
> **This is better than what was planned in three ways at once:** the owner still gets his two
> ice corners; they look *completely different from each other* instead of like two versions of
> the same sheet; and the difference is *legible as an explanation* — you can see the wind in it.
> It is also **cheaper**, because a polar desert is flat scoured ground with sparse relief, which
> is the same cost class as the sandur.

### 6.6 THE FIVE RULES THAT BUY 90% OF IT — build these, in this order

The research is blunt that players notice **adjacency logic, not formula precision**. Exact
Köppen letter-code fidelity, precise aridity constants and gyre handedness are essentially
invisible; these five are not:

1. **Windward/lee asymmetry across every ridge** — the most-cited "that's real" feature in every
   source. It is also our step 5 and the one that makes the desert exist.
2. **One globally consistent wind direction**, so every dry side faces the same way. *Internal
   consistency reads as "designed" more than absolute correctness does.*
3. **A visible altitude ladder** — forest → krummholz → bare rock → snow, at a believable
   elevation. Players climb mountains constantly, so this gets audited by the audience.
4. **Coast-to-interior gradient** — wetter and milder near water, drier and more extreme inland.
   Immediately visible on any map with a sea, and ours is surrounded by one.
5. **A consistent temperature trend with latitude**, even a weak one — mostly valuable as the
   **guard rail** that prevents the ice-next-to-desert adjacency complaint.

### 6.7 THE BLOCK, AND HOW IT ADOPTS

> **`CBZ.climateAt(x, z) → {phi, tempC, precipMm, wetness, biome, treelineY, snowlineY, fog}`**
> — the ONE answer to "what kind of place is this". Exported from a real game file
> (`world/climate.js`), degrade-safe at every call site (`CBZ.climateAt ? c.biome : <today's
> region test>`).

**It must ship with its consumers migrated or it becomes `interfaces.js`.** The good news is that
the migration surface is unusually small, because two shared blocks already funnel it:

- **`CBZ.cityBiomeAt(x, z)` has only FIVE call sites in the entire repo** (`city/worldmap.js:466`
  is the definition). Re-implement it over `climateAt` and every existing consumer is migrated by
  load order.
- **`CBZ.registerBiomeBlend`** (`worldmap.js:111`) already turns a spec into plate cover colour
  (`continent.js:1825`), map fill, weather, traction and a wildlife share. **A climate field that
  emits blend specs inherits all of those with no new code.**
- **`CBZ.hasSnowCover(x,z)`** (`pillar-scale.md §3.2`) is the third consumer and §6.4 gives it its
  absolute floor.
- Wildlife keys on `region.biome` strings (`wildlife.js:146-150`), so a field that emits the same
  vocabulary changes nothing there.

**Determinism:** every term above is a pure function of `(x, z, h)` plus constants — no
`Math.random`, no RNG stream, no order dependence. It is **more** deterministic than what it
replaces. But it will move biome boundaries, so **GOLDEN and the biome histogram recalibrate
deliberately** and the flag (`CLIMATE_FIELD`) reverts to the region test byte-identically.

**Ratchet: `CBZ.climateAudit()` → `{authoredBiomeRects, derivedCells, shadowRatioMax,
aridCells, treelineViolations, snowlineViolations, meanPhiErr, disagreements}`.**
`authoredBiomeRects` starts at its measured value and **may only go DOWN** — that is the whole
point of the block. `disagreements` counts cells where the field and the shipped region record
name different biomes, is printed beside it, and is the number that tells the owner how much the
world would visibly change before he approves anything. **NOT YET MEASURED. It ships REPORTING,
not failing.**

---

## 7. WHAT HAPPENS TO `pillar-rim.md` — ABSORBED AND AMENDED, NOT SUPERSEDED

**It survives.** Everything structural in that document is untouched by this one: the belt
arithmetic (`RIM_BELT` 2,200 → 4,200, plate 17,896 × 16,645, 297.9 km²), the `W_ROOF`
clamp-instead-of-return blocker, plate tiling, `RIM_METRIC_SETTLED`, the `mtnUnclaimed` third
gate form, the `rimSector` block, the four-seam transition grammar (§2 of that doc — the
treeline fraction, the Vatnajökull gradient, the sandur, the "they never touch" refusal), the
travel-time budget, the `poiGapMax ≤ 4,200 u` anti-emptiness ratchet, the edge fiction, and the
R1–R4 wave sequence. **No wave changes. No landmass moves. `SPREAD_V5` stays a no-op.**

What changes is **where the sectors get their authority from.** Today `rimSector` takes
`{bearing, arc, regime, biome, tone}` and the four corners are justified by a paragraph. After
§6 they are justified by a function, and the paragraph becomes a *derivation*.

### 7.1 AMENDMENT 1 — the wind is WSW, and the range must become an L

`pillar-rim.md §0.7` reads: *"west-northwesterlies off the western ocean → drench the west (BIG
FOREST) → lift over the northern wall (glaciated crest + ice cap) → pool as cold dry air
northeast → descend hot and dry into the southeast lee (the MASSIVE ERG)."*

**Two corrections, and the second is structural.** (a) At 39–63° the prevailing band is the
**westerlies, from the WSW** — that is not a preference, it is the band our whole map sits in.
(b) **The middle step does not happen.** The Mercy Wall as specified runs [−6,800, 3,200] ×
[−10,200, −6,600] — an **east–west** wall across the north. A westerly bound for the eastern
Saltlands or the southeast corner travels *south of it*, never lifts, never dries, and arrives as
wet ocean air. The document's own conclusion — "the settled interior sits in the partial shadow…
prairie" — has no cause either, for the same reason. **A rain shadow requires the barrier to be
ACROSS the wind, and nothing in the proposed layout is across a westerly on its way east.**

**And §6.3 says exactly how much barrier is needed**, which turns this from an argument into a
requirement: the Saltlands needs a **4.8×** shadow to satisfy Köppen's BW test at its own MAT,
and a true erg core needs **26–32×**. Olympic gives 8–9× over 80 km with one range; NZ's Southern
Alps give up to 20× over 50 km; **26× has only ever been produced on Earth by two stacked
barriers (Atacama: the Coastal Range blocking the Pacific and the Andes blocking the Amazon).**

> **RULING: the range is an L, and the erg sits behind BOTH arms.** The Mercy Wall keeps its
> east–west northern arm *and* grows a **north–south western spur** down the interior's western
> flank, between the Redhollow Reach (windward, wet) and the settled interior (lee, prairie). The
> spur alone buys the Saltlands its 4.8×; the spur **plus** the northern arm is the Atacama stack
> that lets the southeast corner be a real sand sea instead of a sandy steppe.

**Cost: one argument.** `rimSector` already derives its rect from a `bearing` and an `arc`; an L
is two declarations of the same `range` regime, or one with a wider arc. **No landmass moves, no
coordinate is typed, and `pillar-rim.md §3.2`'s "a fifth corner is a ROW" law covers it exactly.**
It also *improves* two of that document's own numbers: its target crest-to-plain ratio (1:6 …
1:25, measured off Owens Valley / Front Range / Gangetic Plain) is available on the spur's east
face at a much shorter throw than on the northern arm, and the Skyrim-bowl risk does not apply
because relief still exists on **two adjacent** sides, not all four.

### 7.2 AMENDMENT 2 — TWO ICES, AND THE WIND IS WHY THEY LOOK DIFFERENT

This is the amendment that gives the owner more than he asked for. `pillar-rim.md §0.7` puts the
second ice sheet in the **northeast — the dry lee** — and justifies it with *"the Gobi-Altai case,
where glaciers shrank during the ice age because aridity, not cold, gates ice."* **That citation
argues against its own conclusion.** Ice needs accumulation; accumulation lives on the windward
side. A 400 u dome at 57°N in a dry lee has no way to build.

> **RULING: the owner keeps both ice corners and they stop being the same thing.**
> **(i) WET ICE, north/northwest** — a glaciated alpine cap on the Mercy Wall with outlet lobes
> and nunataks. Vatnajökull, exactly the grammar `pillar-rim.md §2.2` already wrote.
> **(ii) DRY ICE, northeast** — a **polar desert**: wind-scoured frozen gravel, sastrugi, blue
> exposed glacial ice in the hollows, bare rock ridges, almost no snow depth. The McMurdo Dry
> Valleys / Antarctic blue-ice look.
>
> Three wins at once: the two ices look *nothing like each other* instead of like two versions of
> one sheet; the difference is **legible as an explanation** — you can see the wind in it; and the
> dry one is **cheaper**, because scoured flat ground is the same cost class as the sandur, not
> the same cost class as a range.

### 7.3 AMENDMENT 3 — the South Belt's regime is computed, not authored

`pillar-rim.md §1.4` assigns the South Belt a low-relief `steppe`. Under §6 that band sits at
**41.8–39.0°N**, the map's hottest and (once the L-range's shadow reaches it) driest ground.

> **RULING: run `climateAt` over it and take what comes out.** It will read semi-desert grading
> to erg in the southeast, which is what the pillar wanted from it and is now *derived*. It stays
> low-relief. **The `steppe` label survives only if the field agrees with it.**

Note one rule that deliberately **does not fire on our map**: the cold-current coastal desert
(Atacama/Namib, §6.2 step 7) needs latitudes 15–30°, and our south edge stops at 39°. It is
written into the rule set anyway so that a future southern extension inherits it and nobody
invents a competing mechanism later.

### 7.4 AMENDMENT 4 — the sandur moves to where a sandur belongs

`pillar-rim.md §2.3` makes Skeiðarársandur the ice↔desert seam on the east edge. Under §6 ice and
desert are no longer adjacent (ice is the high-latitude north, desert the low-latitude south), so
that seam does not exist. **The sandur survives and gets better**: a sandur is *what lies in front
of a glacier snout*, full stop. It becomes the **wet ice cap's own outwash apron** — a flat
braided grey-black plain between the ice front and the sea, ~2,000 u deep, exactly the
20–30 km Skeiðarársandur proportion at our 1:170 scale. Same thirty lines, same landform, now
placed by the geology instead of by the seam it was invented to solve.

### 7.5 WHAT THIS DOES *NOT* TOUCH

`RIM_BELT` · the plate arithmetic · `W_ROOF` · plate tiling · `RIM_METRIC_SETTLED` ·
`mtnUnclaimed` · the `rimSector` block itself · the four-seam transition grammar · the travel
budget · `poiGapMax` · the edge fiction · R1–R4 and their flags. **Four amendments, all of them
arguments to declarations the pillar already planned to write.**

### 7.6 WHAT `pillar-rim.md` GIVES *BACK* TO THIS DOCUMENT

Three things, and they are the reason this document recommends its sequence:

1. **The rim is what makes the wrap affordable.** A seam in open ocean is only cheap because the
   land nearest the world edge is wilderness. If the rim were city, the wrap would need a
   rendered seam and the price would be a different order of magnitude.
2. **`rimSector`'s `underlay: true` is exactly the registration a climate-derived biome needs** —
   `roadrules.js:902` skips underlay regions and the math gate's overlap sweep filters
   `!r.underlay` (`math-gate.mjs:183`), so a climate field that paints large adjacent areas does
   not break `regionOverlaps` or clamp the frontier loop.
3. **`registerBiomeBlend`** (`city/worldmap.js:111`) already turns a spec into cover colour on the
   plate (`continent.js:1825`), a `cityBiomeAt` answer, map fill, weather, traction and a wildlife
   share. **A climate field that emits blend specs gets all six for free**, and `cityBiomeAt` has
   only **5 call sites** in the whole repo — the migration surface is tiny.

---

## 8. THE FIVE QUESTIONS FOR THE OWNER

These are the decisions I cannot make for him, ordered by how much they change the plan.

**Q1 — When you say GLOBE, which of these do you want to be true?**
 (a) *I can see the ground curve away.* → §4.1, days, a dial you turn yourself.
 (b) *I can fly east forever and come back.* → §3, weeks, and it hands you a stopwatch on the
     world's size (2.2 min by jet at today's ocean; ~7 min if we add ocean).
 (c) *I can fly up and see a ball.* → §4.3, days, and it is a texture.
 (d) *It is really a sphere and gravity points at the middle.* → §2, and the honest answer is
     **129 metres**: that is how far you would see on a planet the size of our world. Outer Wilds
     built its whole aesthetic on a **308 m** planet with a **35 m** horizon; Elite Dangerous used
     real radii and its players lap a *moon* in hours. It is a different game, and I would build
     it as one rather than convert this one.
 **They are not the same ask and only (d) is expensive.** My guess is you want (a) + (c) and
 would enjoy (b); I need to hear it.

**Q2 — Do you want to be able to MEASURE the world?** Every closed world can be lapped, and the
lap time is the number the player remembers. Today the map feels endless partly because you never
reach the end. Do you want *"I flew around the world in seven minutes"* as a memory (wrap, and we
add ~60 km of ocean to make the number good), or *"I have never found the edge"* (no wrap, and
the sea + the mountain wall refuse you, which `pillar-rim.md §3.5` already delivers for zero
lines)? **Note the deadline hidden in this one: nothing in the research shows a game adding a
wrap to a shipped bounded world** — Starbound wraps and Terraria does not, and that was decided
in each engine's first months. **Deciding this is not the same as building it, and the decision
should happen before the rim ships even if the build happens after.**

**Q3 — When two rules disagree about a biome, which wins: the science, or the map you already
like?** §6.5 runs the field over today's world: it **agrees in eight places** (the west-coast
rainforest, the east-side farm belt, the Columbia-Basin desert, the Mercy Wall's alpine zone, the
bare-because-arid erg massifs) and **disagrees in two**. The interesting disagreement is the
**interior snow core** — Mount Mercy is 900 u at 53°N, below its own treeline, so under real
rules it is a forested subalpine massif rather than a permanent icecap. **That is the one place
the field would change something you can currently see.** Three fixes: grow it (`RIM_RANGE_AMP`,
which `pillar-rim.md` already wanted), declare it maritime-wet and drop its snowline (real —
Mt. Rainier glaciates 1,300 m lower than the Rockies at the same latitude purely on snowfall
volume), or pin it. **My recommendation: the field wins by default, and anything you love gets a
`pin` the field routes around** — the same relationship `TERRAIN_FLATTEN_UNDER_BUILT` already has
with authored ground. But tell me now whether the white mountain in the middle of the map is
load-bearing to you, because everything downstream keys off that answer.

**Q4 — How much curvature do you actually want to SEE?** Real curvature is invisible at our draw
distance (20 cm of drop at the fog wall). Anything you can see is stylised. The dial:
`R = 200 km` is a subtle "the road falls away"; `R = 50 km` is a clear cartoon-planet droop;
`R = 20 km` is Animal Crossing. **I will ship it as one number in `config.js` and a screenshot at
each setting; you pick.** Note that the stronger it is, the more it eats the distant mountain
skyline, which is why the backdrop gets its own weaker radius.

**Q5 — Is HUGE allowed to mean OCEAN?** The cheapest 10× in this engine is water: the sea is
already a camera-centred infinite disc, and the sharks, drowning, boats, fishing and buoyancy all
ship. Sixty kilometres of ocean with a scatter of procedural islands costs almost no draw calls
and makes the airliner network and the wrap both worth having. But `pillar-rim.md`'s own
anti-emptiness ratchet says a 96,000 u loop wants ~23 points of interest, and *"beautiful empty
sea"* is exactly what FUEL was panned for. **Do you want an ocean world with islands, or a
continent world with a wall of water round it?**

**And the scale numbers to hold that answer against**, because "huge" needs a yardstick and the
public ones disagree wildly: **GTA V ≈ 75–80 km²** (no official Rockstar figure exists; community
estimates run 54–127 km²) · **Just Cause 3 = 1,000 km², developer-stated** · **FUEL = 14,400 km²,
the actual Guinness record holder — and panned for "incredibly long and boring road trips"** ·
**Microsoft Flight Simulator = the whole Earth, via 2+ PB of streamed Azure imagery.** The most
useful precedent for us is **The Crew**, which does not publish an area at all: Ubisoft describe
it as *"about 2,000 times smaller than the real United States"* and *"45 minutes coast to
coast."* **A compression ratio and a drive time say what an area number cannot** — and it is what
the rim plan already reasoned in (7.5 min across, 10.2 diagonal, 3–4 min by air). If we ship an
ocean world, that is how we should describe it too.

---

## 9. THE HONEST COST LINES

### 9.1 The ladder, one line each

| option | one-time cost | **standing tax** | what it actually buys |
|---|---|---|---|
| **(3) curvature droop** | lowest — one shader chain, 14 candidate files, 4 already displace vertices | **audit every horizon-adjacent system forever** — shadows, decals, water, and every world→screen projection — for bend-sync | a *look*, plus a free distance-based LOD mask on a draw-call-bound renderer |
| **(3) globe map + space view** | days — a projection of data that already exists | ~none | the literal word "globe", visibly |
| **science `climateAt`** | ~200 lines + its consumers | ~none — it is *more* deterministic than the rects it replaces | biomes that explain each other; the rim's four corners become causal |
| **(2) ocean wrap, X only** | weeks — `wrapDX`, MP wrap epoch, cylindrical map, `worldWrapShift` bus | **every new distance- or position-based system must remember the wrap, forever** | no edge on two sides; real circumnavigation; a measured world |
| **(1) true sphere, small R** | moderate *if* the world stays tiny | none — precisely because it is tiny | a real globe with real curvature, and a world that is objectively small |
| **(1) true sphere, real R** | **highest** — cube-sphere chunking, six seam-stitched faces for heightmaps/navmesh/scatter/roads, floating-origin from day one | ongoing seam + precision maintenance (DSP still has visible grid seams in 2021) | the thing the owner literally described — at the price of rewriting every (x,z)-keyed system in this repo |

### 9.2 Cheap and I am confident

- **The droop shader.** One `onBeforeCompile` injection; **14 non-vendor files touch a custom
  shader and 4 already displace vertex positions**, so the pattern is the water's, not a new one.
  Add a second, weaker radius for the backdrop layer. Days.
- **The globe map + space view.** A projection of data that already exists in world coordinates,
  through an icon system (`CBZ.mapIcon`) that already caches `dataURL`s — plus the sky dome that
  is **already a `SphereGeometry`** (`core/sky.js:115-116`). Days.
- **`climateAt` itself.** Nine analytic terms, ~200 lines, no new mesh, no new draw call, no RNG.
  It is arithmetic over fields the world already computes.

### 9.3 Genuinely expensive, named without softening

1. **Migrating the biome *authors* to the field.** `climateAt` is 200 lines; making
   `biome_desert.js` / `biome_forest.js` / `biome_snow.js` / `biome_farmland.js` **consume** it
   rather than their own rects is the real work, and it is the same shape as every migration in
   CLAUDE.md's ledger: the block is small, the three consumers are 80% of the effort. Budget for
   the consumers or this becomes another `interfaces.js`.
1b. **The two calibration constants nobody can guess.** `k_shadow` (step 5) and `k_lat` (step 1)
   are the whole design. Too little shadow and the desert stops being a desert; too much and the
   interior dies. Too large a `k_lat` and we are back to COMPRESS with ice beside sand; too small
   and every band collapses into whatever the orography alone produces. **Both must be swept
   against `climateAudit().disagreements` on the shipped world before a single biome file is
   changed**, and the sweep is a tool run, not a builder's guess.
2. **The determinism re-proof.** Any change to what `hash01` is called with — biome boundaries
   moving, a wrapped X — makes the world non-byte-identical. GOLDEN recalibrates, the seed-farm
   determinism assertion re-runs, and multiplayer byte-identity has to be re-shown. That is not
   hard, it is just non-negotiable and it must be scheduled, not discovered.
3. **The wrap's multiplayer epoch.** `net/netactors.js:121,166-177` interpolates absolute
   positions and `net/networld.js:138` gates interest on squared planar distance. A seam crossing
   without a wrap epoch is a 32 km lerp and it will look like a teleport bug for weeks before
   anyone diagnoses it. If wrap ships, **this is the piece that must be built first, not last.**
4. **Screen-projection consumers of a drooped world.** `tools/aimlib.js`'s NDC test, HUD markers,
   `aim_dossier`'s overhead pill, `markers.js`'s threat surfaces. Each must apply the same droop
   or float off its target — and CLAUDE.md already records what happens when projection math is
   assumed rather than verified (a probe photographed the wrong building for two rounds while
   every numeric check passed). **The droop function must be exported and shared, never re-typed.**
5. **The gate is blind to all of §4.** The math gate never renders; house doctrine says looks are
   judged by playing. So curvature ships with *no automated proof* and its regression detector is
   the owner's eyes. That is acceptable under this repo's doctrine — but say it out loud in the
   wave brief so nobody claims the gate covered it.

**What this document refuses:**
- A true sphere (§2 — the horizon arithmetic, not taste).
- A toroidal (both-axis) wrap — it deletes latitude, which deletes §6.
- A wrap seam that touches land — the cost class changes entirely.
- A curvature that is sold as physics rather than as a dial.
- Authoring one more biome rectangle by hand once `climateAt` exists.
- Pinning a single ratchet in this document that nobody has run. **Every number below §6's table
  ships REPORTING, not failing**, until the first gate run writes it in — the `propUseAudit` law
  (an audit that instructed the next person to pin `blocked` at 0 read **487** the first time it
  was ever executed).

**The sentence for the owner:** *a globe small enough to be our world has a 129-metre horizon, so
the shape is the one part of "make it a globe" we should not buy — but the curve you can see, the
map you can spin, the edge that stops existing, and biomes that are where they are because of wind
and altitude instead of because somebody typed a rectangle: all four are affordable, and three of
them are days.*
