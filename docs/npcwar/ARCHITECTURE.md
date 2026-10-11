# NPC War: the architecture (wave A)

NPC War is the battle sim at `games/battle.html`. It is not Desert Warlord. The goal is an
ultra-realistic battle sim where about 50 agents work at once, each in its own files: every
animal, every vehicle, men, melee, player control, armour, weapons, AI, terrain, water,
physics and performance.

This file is the contract. If you are an agent working on NPC War, read it first. Edit only
the files your role owns (see "Who owns what"), and keep `node tools/npcwar-check.mjs` passing.

---

## 1. The shape

```
games/battle.html            a thin page: the war room markup + the script list (nothing else)
src/battle/battle.css        the page's styles
src/battle/npcwar.js         the kernel: CBZ.npcwar.onBoot / runBoot (loaded first)
src/battle/core/             THE BATTLE CORE: page-independent, no DOM, no page globals
src/units/                   THE UNITS: one registry, one file per species / per vehicle, shared kits
src/battle/*.js              NPC War, the host: menu, HUD, cameras, arenas, and today's sim
```

**Two hosts, one core.** NPC War is one host of the battle core. Gang City will be another
(the president declares war and watches his tanks, men and planes take another city on the real
streets). That second host is a future task and is not wired. Everything under
`src/battle/core/` and `src/units/` is already written so it can run there: none of it touches
the DOM or battle.html's globals, and it reaches the world only through the host interface (§8).

**The shared scope (src/battle/\*.js).** The old page was one 8,400-line closure. It is now
split along its seams into files that share ONE classic-script scope: a top-level `function`,
`let` or `const` in one battle file is visible in every other one. Nothing was renamed. The
files are loaded in the order `games/battle.html` lists them.

- Functions and plain literal tables sit at the top of their file and are live as soon as the
  file runs.
- Anything that needs THREE, the studio's packs or the war room's DOM is wrapped in
  `CBZ.npcwar.onBoot(function () { ... })`. `main.js` loads the packs and the armoury and then
  runs every onBoot function once, in file order. This is exactly the order the old inline
  `.then()` body ran in.
- A name declared twice breaks everybody. A second `let x` kills the page, and a second
  `function x` silently replaces the first. `tools/npcwar-check.mjs` catches both.
- **New shared state belongs to a namespace, not a new global.** Use your own `CBZ.<thing>` or a
  property on an existing object. The shared scope is the old closure, kept so that nothing
  changed behaviour. Don't grow it.

The split was verified behaviour-identical: `tools/npcwar-headless.mjs` printed output
byte-for-byte identical to main's before and after (35/35).

---

## 2. File map: who owns what

The **Owner** column says which agent role edits the file. "core" means the architecture owner:
change it only in coordination.

### The page and the kernel
| file | what | owner |
|---|---|---|
| `games/battle.html` | markup + script list. Add a `<script>` only for a new battle file | core |
| `src/battle/npcwar.js` | `CBZ.npcwar.onBoot/runBoot` | core |
| `src/battle/main.js` | the kick: packs, then the armoury, then `runBoot()` | core |
| `src/battle/load.js` | `NEED` packs, the `ARMOURY` list, `withUnits()` (lazy unit files) | core / performance |
| `src/battle/settings.js` | `SET` (URL + saved setup), the front spec, revert switches, URL params (§6) | core |
| `src/battle/state.js` | the live battle state: `men`, `MAP`, `HOST`, `STORE`, clocks, ledgers | core |

### The battle core (page-independent)
| file | what | owner |
|---|---|---|
| `src/battle/core/roster.js` | `CBZ.battleRoster`: the roster grammar (§6) | core |
| `src/battle/core/sides.js` | `CBZ.battleSides`: a side's identity (name, nation, flag, colour) | core |
| `src/battle/core/series.js` | `CBZ.battleSeries`: best of 1/3/5/7 | core |
| `src/battle/core/host.js` | `CBZ.battleHost`: the host interface (§8) | core |
| `src/battle/core/store.js` | `CBZ.battleStore`: the unit store, typed arrays, one row per unit (§9) | performance / scale |
| `src/battle/core/lod.js` | `CBZ.battleLod`: tier rules and budgets (§9) | performance / scale |

### The units
| file | what | owner |
|---|---|---|
| `src/units/unitkit.js` | `CBZ.unitKit`: THE registry (species + vehicles), lazy loader, labels | core |
| `src/units/manifest.js` | every unit id: name, plural, real collective noun, `needs` | core (add a row for a new unit) |
| `src/units/species/<id>.js` | **one per species**: stats, body, gait, fight | that species' agent |
| `src/units/vehicles/<id>.js` | **one per vehicle**: stats, armour, crew, weapons, body, drive | that vehicle's agent |
| `src/units/kit/loft.js` | `CBZ.loftKit`: lofted, vertex-coloured, skinned shells | animal agents (coordinate) |
| `src/units/kit/quadrig.js` | `CBZ.quadRig`: quadruped skeleton, bind points, 2-bone IK, leg posing | animal agents (coordinate) |
| `src/units/kit/gait.js` | `CBZ.quadGait`: planted-foot gait solver, footfall tables | animal agents (coordinate) |
| `src/units/kit/vehicle.js` | vehicle drive / turret / armour / crew helpers | vehicle agents (coordinate) |

### The sim and the page (NPC War's host layer today)
| file | what | owner |
|---|---|---|
| `src/battle/menu.js` | the war room: matchups (`MATCHUPS`), grounds, sides, best-of, the call | menu / UX |
| `src/battle/teams.js` | the two slots, `SIDES`, `refreshSides()`, nation marks, flags | core |
| `src/battle/arms.js` | the guns on the menu, the mixed issue, punch per training | weapons |
| `src/battle/men.js` | `makeMan`, uniforms, helmets | humans |
| `src/battle/beasts.js` | `makeBeast`, `animateBeast`, `beastFight`: the animal unit, routed through `CBZ.unitKit` | core (species agents edit their species file instead) |
| `src/battle/vehicles.js` | `makeVehicle`, the vehicle sim, crew mount/dismount | vehicles / armour |
| `src/battle/damage.js` | `hurtMan`: the one damage funnel, reachability | armour / weapons |
| `src/battle/death.js` | a beast dies, a man dies, the sinking dead | physics / humans |
| `src/battle/physics.js` | the grid, body separation, pinned pairs, the flow field (`NAV`), COM | physics |
| `src/battle/fire.js` | rounds, fire discipline, rockets | weapons |
| `src/battle/air.js` | air support: bombers, the nuke run, airstrikes | weapons / vehicles (air) |
| `src/battle/ai/think.js` | one unit's decision (target, slot, cover) | AI |
| `src/battle/ai/morale.js` | morale, stance, hull-down | AI |
| `src/battle/ai/orders.js` | hold / advance, the centre of mass, the hunt | AI |
| `src/battle/step.js` | one unit's body for one tick: locomotion, the strike bubble, the punch exchange | AI / melee / physics |
| `src/battle/player.js` | YOU: taking over a man (and a crew seat) | player control |
| `src/battle/camera/camera.js` | the director, follow, the point man | camera |
| `src/battle/camera/study.js` | the study desk (one body, locked) | camera |
| `src/battle/camera/killcam.js` | the kill cam | camera |
| `src/battle/hud.js` | the lens card, camera modes, pointer input, render resolution | HUD |
| `src/battle/clock.js` | speed dial, controls | HUD |
| `src/battle/scoring.js` | the end card, the call, the series, `warURL` | menu / UX |
| `src/battle/begin.js` | raise the field, spawn the armies, `?cam` / `?freeze` | core |
| `src/battle/spawn.js` | `drainSpawns`: unit id -> `makeMan` / `makeBeast` / `makeVehicle` | core |
| `src/battle/loop.js` | `frame()`: the core loop, sub-steps, render pass | performance / core |
| `src/battle/front.js` | THE FRONT: the city's battles (city/frontline.js), the post home | core |
| `src/battle/bench.js` | `?bench=1`: how many this machine can show | performance |
| `src/battle/probe.js` | `window.__battle`: the tools' seam, restage | tools |
| `src/battle/core.js` | `CBZ.now`, `CBZ.floorAt` shims | core |
| `src/battle/arenas/maps.js` | `MAPS`: every ground the page offers | terrain |
| `src/battle/arenas/field.js` | `buildMap(id)`: raise a ground, return the MAP record (spawn, ground, sight) | terrain |
| `src/battle/arenas/erg.js` | the open dunes / snow / fields | terrain |
| `src/battle/arenas/sea.js` | open water: swell, reef, fleet, depth | water |
| `src/battle/arenas/yard.js` | the kill box | terrain |

Melee for men is the punch exchange in `step.js` (around the `m.fists` branch) together with
`CBZ.combatIQ.melee`. A melee agent should lift it into its own `src/battle/melee.js` as its
first move, then own that file.

---

## 3. The unit registry

One registry for every kind of unit: `CBZ.unitKit` (`src/units/unitkit.js`). It is not one
registry per kind. `CBZ.speciesKit` and `CBZ.vehicleKit` are thin views over it: `register`
presets the kind, and `get` / `ids` filter by kind.

```js
CBZ.unitKit.register(id, def)      // one unit file = one call
CBZ.unitKit.get(id)                // the registered def, or null
CBZ.unitKit.has(id) / ids(kind?)   // kind: "species" | "vehicle"
CBZ.unitKit.kindOf(id)             // "men" | "species" | "vehicle" | null
CBZ.unitKit.meta(id)               // the manifest row
CBZ.unitKit.label(id, n)           // "40 gorillas", "1 Bengal tiger", "3 M1 Abrams"
CBZ.unitKit.groupNoun(id, n)       // "troop", "pride", "company"... or null
CBZ.unitKit.build(id, ctx)         // the unit file's build, else the bestiary's
CBZ.unitKit.stat(id, key, dflt)    // the unit file's number, else the bestiary row's
CBZ.unitKit.need(ids) -> Promise   // load the files a roster needs (plus each row's `needs`)
CBZ.unitKit.fileOf(id)             // "units/species/<id>.js" | "units/vehicles/<id>.js"
```

**Species definition** (every hook is optional; a missing one means "the shared default"):

```js
CBZ.unitKit.register("bengal_tiger", {
  kind: "species",
  stats: { hp, spd, danger, bite, scale,            // what it IS (written back onto the bestiary row)
           chase, march, dmg, rate, brave, prey },  // how NPC War fights it
  build(ctx)            -> THREE.Group   // feet at y=0, nose +X, metres. ctx = { THREE, mat, rng, id, seed }
  animate(unit, dt)     // the per-frame pose: replaces the shared gait or swim rig
  fight(unit, tgt, dt, opts) -> result   // the close fight: replaces CBZ.creatureFight(unit, tgt, dt, opts)
});
```

- **The fallbacks today.** The body is the bestiary's `build()` (`src/city/wildlife/*.js`).
  Legs walk on `CBZ.wildlifeRig.buildGait/animateGait`, swimmers on
  `CBZ.buildSwimRig/animateSwim`. The close fight is `CBZ.creatureFight` (pounce, maul, gore,
  ram, stomp, lunge), with the gorilla's extra move set in `systems/ape_combat.js`.
- **One truth per number.** When a species file registers, its `hp spd danger bite scale` are
  written onto the bestiary row (`CBZ.WILDLIFE_SPECIES[id]`). The battle, `creature_combat` and
  the wildlife rig all read the same numbers.
- **Where the numbers came from.** The 50 species files were generated from the bestiary rows
  plus battle.html's old derived `beastTuning()`. The values are baked exactly, so behaviour did
  not move. `beasts.js` still holds the formula as the fallback for a species with no file.
- **`opts` in `fight`** carries the battle's seams. `opts.move(a, dx, dz, step)` walks on this
  host's walls and ground and stops at the mouth. `opts.onHit(dmg)` lands in the damage funnel.
  `opts.reach`, `opts.rate`, `opts.dmg` and `opts.speed` are this individual's numbers after
  size and hunger.
- **The worked example is `src/units/species/dog.js`.** It is the one species with no bestiary
  row. The war room's "100 LIONS v 1000 DOGS" used to put a hundred lions on an empty field. The
  dog file builds `city/dogmodel.js`'s skinned 24-bone body, drives `dogModel.animate` from the
  battle's own motion and defines its species row. Its `needs` load the kit and dogmodel first.

**Vehicle definition** (`kind: "vehicle"`). See §4 and the header of each vehicle file:

```js
CBZ.unitKit.register("m1_abrams", {
  kind: "vehicle", domain: "ground" | "air",
  stats:   { hp, mass, speed, turn, armour: { front, side, rear, top } },   // armour in mm RHA
  crew:    [{ seat: "driver" | "gunner" | "commander" | "loader", pos: [x, y, z] }],
  passengers, weapons: [{ id, seat, kind: "cannon" | "mg" | "rockets" | "missile", rof, dmg, range, ammo }],
  build(ctx) -> { group, turret, gun, ... },
  drive(unit, dt, ctrl), aim(unit, dt, tx, ty, tz), fight(unit, tgt, dt, opts)
});
```

### Lazy loading and cache keys

Unit files are not on the page. `withUnits()` (`load.js`) asks `CBZ.unitKit.need()` for the ids
in both rosters at START. A men-only war loads none of them and begins on the same tick it always
did. A manifest row's `needs` are engine files loaded first (deduplicated by path, and skipped
when the host page already carries them).

Unit files ride **unitkit.js's own `?v=` key**, the same way studio packs ride studio.js's. Bump
`units/unitkit.js?v=` in `games/battle.html` and every unit file re-fetches. There is no per-unit
key, so 50 agents never edit one shared line.

---

## 4. Adding a unit

**A species.**
1. Add a row to `src/units/manifest.js`: `my_id: S("name", "plural", "real collective noun or omit")`.
2. Create `src/units/species/my_id.js` that calls `CBZ.unitKit.register("my_id", {...})`. It must
   load without THREE: build only inside `build()`.
3. If the bestiary has no row for it, define one in your file with `CBZ.defineSpecies` (see
   `dog.js`).
4. It appears in the war room's WHO list (land or water) automatically.
5. `node tools/npcwar-check.mjs` checks that the file parses, loads without THREE, registers
   exactly its id and has its manifest row.

**Redrawing an animal (the animal agents' path).** Build the body as a lofted, skinned shell on
a real skeleton with the shared kit, the way `src/city/dogmodel.js` builds the dog:

- `CBZ.loftKit`: `geo()`, `loft(G, stations, segments, colourFn, opts)`, `ellipsoid(...)`,
  `toGeometry(G, {boundingSphere})`, `sharedSkinMaterial()`. A station's `hk` blends toward the
  extra bone `hkBone` (the dog's hackles).
- `CBZ.quadRig`: `bones(spec)` gives the bone table (neck/tail chain lengths, ears, hackle,
  hump), `makeSkeleton(table, D)`, `skinnedMesh(geo, mat, rig)`, `ik2(...)` (2-bone sagittal IK),
  `poseLegs(rig, G, D, body, opts)`.
- `CBZ.quadGait`: `create(D, table)`, `step(G, dt, v, turn, gx, gz, h, ground, gy)`, `reset`,
  `mix`. Every foot PLANTS and cannot slide in stance. `TABLES` holds DOG (exact),
  plus CAT / HORSE / ELEPHANT / BEAR as starting points to tune.
- `tools/units-kit-check.mjs` proves the kit (no foot slip, the dog reproduced bit for bit).

`src/city/dogmodel.js` is built on this kit, so there is one implementation, not two. Each
animal agent writes `build` and `animate` in its own species file, and reuses the kit instead
of writing its own.

**A vehicle.** Add a manifest row with `V(name, plural, domain, needs)` and create
`src/units/vehicles/my_id.js`. Shared drive, turret and armour maths go in
`src/units/kit/vehicle.js`. The battle side (crew, AI, firing, damage states) is
`src/battle/vehicles.js`.

---

## 5. Sides are identities, not colours

A side is what is ON it, made by `CBZ.battleSides.make()` from the roster:

- **The label is a number and the real name of the thing:** "40 gorillas", "1 Bengal tiger",
  "200 soldiers", "1 man + 1 M1 Abrams". It is never "RED" and never a made-up army name. Men are
  "men", "soldiers" (elite) or "SWAT officers" by training.
- **An army** (men or machines) fights for a **nation**: a name, a flag and a colour from
  `src/city/flags.js`, the game's one flag system, loaded in the armoury. The war room has a FLAG
  row per side. The defaults are Kesh (crimson) on the first side and the Republic (blue) on the
  second. Two sides that say the same thing ("30 soldiers" v "30 soldiers") are named by their
  nations.
- **Collective nouns** live in `src/units/manifest.js` (`group`), and only where a real one
  exists: a troop of gorillas, a pride of lions, a streak of tigers, a pack of wolves, a herd of
  elephants, a crash of rhinos, a sloth of bears, a pod of orcas. Men take a unit word by size
  (squad, platoon, company, battalion, brigade, division). Labels never need a noun. A preset may
  use one where it is correct ("a troop of silverbacks").
- The menu, the call buttons, the end card ("40 GORILLAS WIN", "KINGDOM OF KESH WINS") and the
  chrome colours (`--sc-red/--sc-blue`) all come from `SIDES`.
- `"red"` and `"blue"` survive only as **slot keys**: ledgers, `ORDER`, the front's
  postMessage protocol and the node tools key on them. A player never reads them.

---

## 6. Spawn a matchup by URL

```
games/battle.html?a=bengal_tiger&b=lion&n=1v1&arena=dunes&cam=bengal_tiger&freeze=1
```

| param | meaning |
|---|---|
| `a`, `b` | the roster of side A / side B (aliases of the old `ru` / `bu`) |
| `n` | `1v1`, `100v1`, or one number for both sides (old: `red`, `blue`) |
| `arena` | the ground: `dunes` `water` `snow` `grass` `arena` `city` `island` `field` ... (alias of `map`) |
| `aw at as` / `bw bt bs` | weapon / training / air support per side (old: `rw rt rs`) |
| `af`, `bf` | the nation an army fights for: `republic` `kesh` `veridia` `solara` `mbeya` |
| `bo`, `sa`, `sb` | best of 1/3/5/7, rounds already won by A / B |
| `cam` | the lens once the field is up: `a` / `b` (follow that side), a unit id (study the first one), `a:3` (side A's body #3) |
| `freeze=1` | stop the clock once the field is up (visual checks) |
| `auto=1` | skip the war room (implied by any tool use, as before) |

**Roster grammar** (`CBZ.battleRoster`):
- `men`: one kind, with its count from `n`.
- `men|dolphin`: kinds alternating over `n` bodies (divers and dolphins).
- `m1_abrams*3,men*20`: **counted** entries, in spawn order. The side's size is the sum, whatever
  `n` said.

Ids are `men`, any species id or any vehicle id.

Examples:
```
?a=men&b=gorilla&n=100v1&aw=fists&at=civ&arena=dunes&auto=1
?a=m1_abrams*1,men*1&b=men&n=2v200&arena=dunes&auto=1              (1 man + 1 tank v 200 men)
?a=m1_abrams*3&b=gorilla&n=3v20&arena=dunes&cam=m1_abrams&auto=1
?a=orca&b=megalodon&n=8v1&arena=water&cam=megalodon&freeze=1&auto=1
?a=men&b=men&n=30v30&af=veridia&bf=solara&bo=5&auto=1
```

---

## 7. The match format

`CBZ.battleSeries` covers best of 1, 3, 5 or 7. A round is one battle to its end. A round
nobody wins is replayed, not scored. The series goes to the first side to `ceil(bo/2)`. The war
room has a BEST OF row, and the end card shows the score and, once the series is decided,
"X TAKE(S) THE SERIES". Its button reads NEXT ROUND until then and REMATCH after.

**Rounds reset the field cleanly.** The next round reloads the page with the score in the URL
(`?bo=5&sa=2&sb=1`). This is the only reset that is clean by construction: blood decals, bullet
holes, ragdoll pools, ordnance and every ledger start from nothing. An in-page reset would need
clear APIs on gunfx/gore/ragdoll first. `__battle.restage()` is the closest thing that exists
today, and it leaves the decals.

---

## 8. The host interface (for Gang City)

`CBZ.battleHost` (`src/battle/core/host.js`) defines what the battle core may ask of the world:

```
id, cx, cz, gap, water, terrainTrue, terrainLos, scene
groundAt(x, z)            the surface height (land, or the swell)
bodyY(unit, x, z)         where THIS body sits (a shark: surface minus its depth)
camFloor(x, z)            the lowest a lens may go
spawnAt(side, i, r)       a free start spot for body i of a side
resolveCircle(pos, r, y, h)            push a body out of the walls
segmentBlocked(ax,ay,az, bx,by,bz)     the geometry between two points (sight, fire)
queryColliders(x, z, r, out)           colliders near a point (cover search)
colliderContains(c, x, z, pad)
```

- `fromArena(MAP, CBZ.micro, CBZ.scene)` is NPC War's host: `buildMap()`'s record plus
  microboot's collision world, using the same function objects with no wrapper. `begin.js` sets
  the page's `HOST`.
- `fromCity({id, cx, cz, gap, spawnAt, scene})` is the Gang City seam: the city's own physics
  names (`CBZ.floorAt`, `CBZ.queryCollidersNear`, ...). It is written but not wired.
- `validate(host)` lists missing members.

**Migration rule.** New code asks `HOST.*`. The existing sim still reads `MAP.*` and
`CBZ.micro.*` directly. Those are the same functions, so that is a mechanical rename (`MAP.groundAt(` to
`HOST.groundAt(`, and so on) for whoever lifts a sim file into the core. The page-coupled pieces
the sim still leans on, which are what a lift has to cut, are `SET` / `FRONT` (settings),
`el()` (DOM, menu/HUD only), `TEAMS` (colours), and `cam` (the camera's state, read by the
director hooks in `scoring.js`).

---

## 9. Scale: 100,000 a side

The goal is 100k men against 100k men without losing quality, logic or looks. The design, and
what is live today:

- **Every unit is a row** in `CBZ.battleStore` (`core/store.js`): typed arrays (side, kind,
  tier, life, x y z heading vx vz hp maxHp morale, squad, crowdRow, unit). They grow by
  doubling. Today every unit object gets its row at spawn (`m.row`), and `updateCOM` syncs the
  rows on its 0.6 s tick. Rendering far crowds goes through `entities/crowdstore.js`'s own rows
  (`crowdRow` links them), not a second render store.
- **Three tiers** (`core/lod.js`):
  - **FULL** is a full rig and the full brain: near the lens or the player, the lens subject, the
    player's target, anything in melee with a FULL unit, anything just hit near the lens, and the
    crew of a FULL vehicle.
  - **MID** is a cheaper but faithful individual sim: the same rules on a coarser tick.
  - **FAR** is a squad/formation sim over the store's columns, held to statistical equivalence
    (same winner in at least 90% of seeds, loser casualties within 15 points, time to decision
    within 25%, the same morale break order) by a node check the scale agent writes. It is drawn
    through `entities/crowdgpu.js` (the real CBZ.human, GPU-instanced with baked animation, the
    `gta6-no-fake-crowds` rule), with impostors beyond that. There are never box stand-ins.
- **Promotion and demotion** use distance hysteresis (`HYSTERESIS`) and a `DEMOTE_S` hold. A
  tier change is a change of the `tier` column, not a new object.
- **Budgets**: `BUDGET.think` (seconds between decisions per tier), `BUDGET.frameMs` (the
  time-slice each tier may spend), and `BUDGET.worker`. The FAR squad sim is pure numbers over
  transferable typed arrays, which is the Web Worker boundary.
- **Live today**: `animEvery(d2)` is the render LOD (1/2/4 frames at 70/150 m), the same
  numbers `frame()` always used, now read from the one table. Spatial hashing exists in
  `physics.js` (`rebuildGrid` / `rebuildFine`).
- **Not done yet** (the scale agent's job): the MID and FAR sims, the tier scheduler, the
  crowdgpu path for battle units, the worker, and the equivalence check.

---

## 10. Checks: node only, no browser

```
node tools/npcwar-check.mjs        <1 s. Every page file parses; no top-level name in two battle
                                   files; every unit file registers exactly its id and has its
                                   manifest row; every manifest row has its file.
node tools/npcwar-headless.mjs     the page's own sim in node: war room, hold, the front, the
                                   rifle, snow/fields, calibration, held v met, vehicles, sides +
                                   series + URL.   node tools/npcwar-headless.mjs 3  runs one.
node tools/units-kit-check.mjs     the animal kit: planted feet never slide; the dog bit for bit.
node tools/front-sim.mjs           the city's front resolver (frontline.js) it is calibrated to.
```

`tools/npcwar-headless.mjs` lifts the page's `src/battle` / `src/units` script tags out of
`games/battle.html` and runs each one as its own script in one vm context, as the browser does.
Unit files a roster asks for (and their `needs`) run for real.

Ship hygiene: bump the `?v=` of every page script you touch (unit files ride `unitkit.js`'s key),
then `node tools/build-disaster-page.mjs` must print "wrote disaster.html".

---

## 11. Rules for the fifty

1. **Own your file.** An animal agent edits `src/units/species/<id>.js`. A vehicle agent edits
   `src/units/vehicles/<id>.js`. A kit change (`src/units/kit/*`) is shared: keep it backward
   compatible and say so in your report.
2. **Search before you build.** The kit, the bestiary, `creature_combat`, `ape_combat`, the
   wildlife rig, `combat_iq`, `CBZ.human`, `crowdstore`/`crowdgpu`, `mil_armor`, `mil_air` and
   `flags.js` already exist. Don't stand up a second one.
3. **No made-up names, no red/blue on screen.** Labels come from the manifest. Text never uses
   em dashes or middle dots.
4. **Speed never costs looks.** Perf means instancing, culling, tiers and sleeping, never a
   visibly worse model.
5. **The core stays page-free.** Nothing under `src/battle/core/` or `src/units/` may touch the
   DOM or battle.html globals. That is what lets Gang City host the same war.
