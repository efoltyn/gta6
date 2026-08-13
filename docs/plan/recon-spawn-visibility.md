# RECON: WHY YOU CAN SEE THEM ARRIVE (2026-08-13)

> Desk recon. Every code fact below was read off `origin/main` at `3821b29`. Every
> NUMBER derived from those facts is arithmetic, not measurement — §7 says what to
> run before trusting a word of it. Companion to `recon-existence.md` (2026-07-27),
> which mapped the spawn architecture; this one asks whether its THRESHOLDS are the
> right kind of number.

## 10-line summary

The "never watch it spawn" law is real, centralized and good: `CBZ.npcTransitionSafe`
(`config.js:1039`) rejects a padded screen region plus every transition inside 16 m.
It has two structural gaps and one adoption gap. **The adoption gap is the owner's
prison bug**: 17 files call the gate, 15 of them are `src/city/*`, and the prison's own
population (`entities/npc.js`) and `systems/reinforcements.js` never ask — so in escape
mode bodies are created outright, in view, because the shared verb is a city convention
rather than an engine law. **The first structural gap is that beyond `maxDistance` (150 m)
the gate returns `true` with no projection at all** (`config.js:1050`) — staging dead
ahead down an open street is explicitly allowed. Its justification is that `peds.js`
does not render past `VIS_D2 = 95 m`. Which relocates the pop-in rather than removing
it: **the thing the player actually watches appear is not a spawn, it is the boolean
`p.group.visible` flipping at 95 m** (`peds.js:6220`), where a man is ~17 pixels tall.
**The second structural gap is that every threshold is in metres when the quantity that
decides visibility is angular** — pixels subtended, a function of live FOV and framebuffer
height, neither of which any of these constants can see. The permanent world never has
this problem because it never transitions absent→present; it transitions coarse→fine,
behind fog and proxies. Bodies have no coarse rung.

## 1. Where this came from

Owner, 2026-08-13, rejecting a proposal to realize distant gang crews only near the
player:

> *"your idea about only actually spawning players near the player is broken by the b2
> bomber and car speed and its also broken in prison escape game currently, you can see
> players spawn, when really they should spawn so you cant see them spawn they should
> spawn at visible horizon like how everything permanent spawns"*

He is right, and the correction is sharper than the complaint: **a radius and a horizon
are different objects.** A radius is centred on the player and therefore sweeps at the
player's speed. A horizon is a property of what the camera can resolve and does not move
when the player accelerates. Every failure below is a radius wearing a horizon's job.

The proposal that provoked it came out of reading Tencent's WorldClaw paper
(arXiv 2608.05248), whose one genuinely portable idea is *"a globally coherent world need
not be generated everywhere at once."* That idea is sound for terrain and wrong for
bodies for exactly the reason the owner names, and §6 states the corrected form.

## 2. The gate, as it actually is

`CBZ.npcTransitionSafe(x, z, opts)` — `src/config.js:1039-1077`.

| term | value | behaviour |
|---|---|---|
| `NPC_SPAWN_HIDE === false` | flag | returns `true`, gate off |
| `d < minDistance` | default **16 m** (peds pass 18) | **blocked**, even directly behind the player |
| `d > maxDistance` | default **150 m** | **allowed, with no projection computed** |
| padded NDC | x ±1.28, y ±1.38, z −1.05..1.05 | blocked if inside |
| pre-camera fallback | `forwardDot < −0.12` | wider-than-FOV rear cone |

Counters ride on `CBZ.npcSpawnGuardStats {checked, blocked, allowed}`.

Two things to say for it before the criticism: the padded region is genuinely
conservative (28% / 38% beyond the screen edge, which is real head-turn budget), and the
1.05 m body-centre probe with its comment about *"the prison's pitched third-person
camera"* shows someone already thought about escape mode. The gate is not naive. Its
constants are just the wrong TYPE of quantity.

## 3. The >150 m early-out, and where the pop-in actually lives

`config.js:1050` returns `true` for anything past `maxDistance`, and the header comment
gives the reason: *"Farther than maxDistance the actor is outside the full-rig LOD
contract, so it is safe to stage without spending a projection."*

That reasoning is load-bearing on a constant in another file. `peds.js:226` sets
`VIS_D2 = 95 * 95`, and `peds.js:6220`/`6231` are the whole visibility policy:

```js
p.group.visible = !p._spawnHidden && ax * ax + az * az < VIS_D2;
```

A hard boolean. No proxy, no fade, no LOD rung. So the sequence for a body staged at
160 m straight down a boulevard is: allowed by the gate → invisible because 160 > 95 →
**materializes at 95 m**, full rig, mid-stride. The gate did its job to spec and the
player still watched someone arrive. `refreshPedLOD` (`peds.js:228`) is called from
exactly one place, `core/quality.js:266` — adaptive quality. **Nothing raises the ped
draw distance for any other reason.**

This is the single most useful sentence in this document: **the pop-in is not at the
spawn, it is at 95 m, and it is a boolean.**

There is a consequence worth chasing separately. The longest weapon in the game reaches
240 m (`scrolls/CLAUDE.md`, fortresponse wave) and bodies stop rendering at 95 m, with no
scope path into `refreshPedLOD`. Either a marksman cannot see the man he is rated to
hit, or something else raises visibility that this recon did not find. Both are bugs and
they are different bugs. **Unresolved — §7.**

## 4. The adoption gap: the prison never asks

`grep -rln npcTransitionSafe src/` on `3821b29` — 17 files:

```
city/airside · city/arena_fights · city/citystaff · city/crowd · city/gangs
city/interior_programs · city/morgue · city/peds · city/piracy · city/police
city/regionlife · city/seacrew · city/vehicles · city/wildlife_tame
config.js · entities/crowd.js · modes/gungame.js
```

Fifteen are `src/city/*`. On the escape side only `entities/crowd.js` calls it.
`entities/npc.js` — which mints the prison's entire named cast and its crowd through
`makeNpc` (`:17`, `:303`, `:504`, `:544`) — never does. `systems/reinforcements.js` has
no visibility gating of any kind (`grep -nE "npcTransitionSafe|visible|inView|offscreen"`
returns nothing).

This is the repo's own named bug class, from `scrolls/CLAUDE.md`:

> *`mode === "city"` is legitimate when it guards a CITY RECORD … and is a BUG when it
> guards a shared verb.*

Same family as the RPG that produced a camera shake and nothing else outside the city,
and `cityBlastWall` sitting inside a mode gate while its own header said it had none.
Here nobody wrote a gate — the shared verb simply grew fifteen city adopters and stopped.
**The prison bug is not a tuning problem. It is a call that was never made.**

Note the two failures need different fixes. In a 248 × 244 m compound whose typical
sightlines are 30–80 m, `VIS_D2 = 95` rarely fires, so the prison is almost purely the
adoption gap; the city is almost purely the 95 m flip.

## 5. Metres cannot answer this question; pixels can

Whether a body can be *seen to change* is angular. Three.js `PerspectiveCamera.fov` is
vertical, `camera.js:460` sets 62°, so at framebuffer height `H`:

```
f_px      = (H / 2) / tan(fov / 2)
height_px = 1.82 * f_px / d
```

At 1080p / 62°, `f_px ≈ 899` and a man subtends `1636 / d` pixels:

| distance | what it is | pixels tall (1080p) |
|---|---|---|
| 18 m | peds' `minDistance` | **91** |
| 95 m | `VIS_D2` — the visibility flip | **17** |
| 150 m | gate `maxDistance`, past which staging is unchecked | **11** |
| 240 m | longest weapon reach | 7 |
| 420 m | `aircraft.js:566` `BOARD_VIEW` | **3.9** |
| 818 m | — | 2 |
| 1635 m | — | 1 |

Three readings fall out.

**`BOARD_VIEW = 420` is short by 2–4×.** Last wave cited it approvingly as the repo's
no-spawn-in-view discipline applied to a beat. Four pixels is a dot you can watch appear,
particularly against sky. `airCrewAudit().teleportedInView` is pinned at 0 and the
counter is honest — the *line it measures against* is wrong.

**A 4K display halves every safe distance.** `f_px` doubles, so 1 px moves to 3.3 km. Any
metre constant is implicitly a resolution constant, and none of them know it.

**A scope defeats distance outright.** At 10× (≈6° vFOV) `f_px ≈ 10300` and two pixels is
9.4 km — further than the world. The honest rule while scoped is not "further away", it
is *nothing appears in frustum at any range*.

## 6. Speed, altitude, and why the bomber is the easy case

Under a **radius**, closing speed is a direct tax: the leading edge sweeps frontage
proportional to `v`, so a B-2 at ~300 m/s pays a creation spike forever. Under an
**angular** rule, altitude is the cheapest camera in the game — from 3 km everything is
sub-pixel and the correct amount of work is zero. Same sortie, opposite bill. That
inversion is the tell that the metric is wrong, not the idea.

**The car at street level is the genuinely hard case, not the bomber.** A boulevard gives
a kilometre of level sightline, the far end is a bright gap against sky, bodies sit at eye
height, and you close ~50 m/s. Two consequences: the test must be predictive
(`d − v·t`, not `d`), and the real hazard is *alignment* — a point on a straight road
segment parallel to your heading must never be used at any range. The geometry is already
in the engine (`arena.roads`, `segNearAim` in `gangs.js:1383`).

**And in the prison there is no distance answer at all.** Longest sightline ≈ 350 m ⇒ 4.7 px;
most are 30–80 m ⇒ 20–55 px. The compound is smaller than the hiding distance, so the only
mechanism left is occlusion — and "is this point in the camera's shadow" is a raycast the
engine already runs for the vault probe, camera occlusion and `m.sees`, against
`CBZ.colliders`. **The wall is the horizon.**

## 7. What to measure before believing any of this

An audit nobody has executed is not a measurement, and §3–§6 are all desk arithmetic.

1. **Pixel height at first paint.** Log `1.82 * f_px / d` for every ped on the frame its
   `group.visible` goes false→true, as a distribution, in (a) a car run down the longest
   straight street, (b) the prison yard, (c) a B-2 pass. The claim is a fat spike at ~17 px
   from the `VIS_D2` flip. If the real number is 9, this document is wrong about which
   constant matters and the honest thing is to find that out.
2. **Prison spawn-in-view census.** `npcSpawnGuardStats.checked` should be ~0 in escape
   mode. Then count how many `makeNpc` calls land inside the padded frustum. That number
   is the prison bug, sized.
3. **The 240 m / 95 m contradiction.** Aim a scoped rifle at a man at 150 m. Either he is
   not drawn or something raises `VIS_D2`. Resolve which before touching either constant.
4. **`BOARD_VIEW` at 4 px.** Watch one scramble from 420 m. This one is probably visible
   to the naked eye and needs no instrumentation.

## 8. The shape a fix would have to take (NOT a proposal to build)

Stated so the next wave does not re-derive it, and deliberately not costed.

**Existence unconditional, fidelity conditional.** The permanent world never goes
absent→present; it goes coarse→fine behind fog and farcull proxies. Bodies have no coarse
rung — `visible` is the whole ladder. Everything above is downstream of that one missing
rung.

**Where existence must be conditional, derive the threshold, do not type it.** One
expression off live `camera.fov` and `renderer.domElement.height` subsumes the scope, the
4K monitor, the altitude case and the boulevard. Metre constants in six files cannot.

**Every genuine appearance needs a permanent source.** A door, a gate, a stairwell, a bus,
a traffic car. This is already the pattern that made the aircrew wave good — shoot the
pilot crossing the apron and nothing launches — and drivebys already claim a real traffic
car rather than conjuring one (`gangs.js:1396 dbClaimTrafficCar`). Generalized: if you
cannot name the door, you do not get the body. In a prison the door is intake, and a
closed population (which `prisonBeds()` and the finite-roster doctrine already want) makes
post-boot spawning the bug rather than the mechanism.

## 9. What this document does not claim

- It does not claim the gate is bad. It is centralized, conservative and widely adopted;
  the criticism is of the type of its constants and of who forgot to call it.
- It does not claim any of the numbers in §5 were observed. They are arithmetic off
  `fov = 62` and a 1.82 m body, and §7 exists because that is not the same thing.
- It does not resolve the 240 m / 95 m contradiction. It only shows that one of the two
  must be wrong.
- It proposes no code and pins no ratchet. `recon-*` documents in this directory are
  scout reports; the wave that acts on this one owns its own before/after.
