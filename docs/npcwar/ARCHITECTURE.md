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
| `src/battle/core/lod.js` | `CBZ.battleLod`: tier rules, budgets, the squad scheduler (§9) | performance / scale |
| `src/battle/core/tiersim.js` | `CBZ.battleTierSim`: the MID and FAR sims (§9) | performance / scale (brains: AI hooks) |
| `src/battle/core/flow.js` | `CBZ.battleFlow`: the one flow-field solver | physics / scale |
| `src/battle/core/simworker.js`, `simlink.js` | the sim worker and the page's end of it (§9) | performance / scale |
| `src/battle/mass.js`, `massdraw.js` | tiered battles: rows, ghosts, promotion, the crowd draw (§9) | performance / scale |
| `src/battle/settingspanel.js` | `SETTINGS`: the settings panel and AUTO quality (§9) | performance / scale |
| `src/battle/core/tactics.js` | `CBZ.battleTactics`: THE SQUAD BRAIN — fire teams, formations, tasks, posts, threat/focus, squad morale, per-tier cost ledger (§9b) | AI |

### The units
| file | what | owner |
|---|---|---|
| `src/units/unitkit.js` | `CBZ.unitKit`: THE registry (species + vehicles), lazy loader, labels | core |
| `src/units/manifest.js` | every unit id: name, plural, real collective noun, `needs` | core (add a row for a new unit) |
| `src/units/species/<id>.js` | **one per species**: stats, body, gait, fight | that species' agent |
| `src/units/vehicles/<id>.js` | **one per vehicle**: stats, armour, crew, weapons, body, drive | that vehicle's agent |
| `src/units/kit/loft.js` | `CBZ.loftKit`: lofted, vertex-coloured, skinned shells | animal agents (coordinate) |
| `src/units/kit/quadrig.js` | `CBZ.quadRig`: quadruped skeleton, bind points, 2-bone IK, leg posing | animal agents (coordinate) |
| `src/units/kit/gait.js` | `CBZ.quadGait`: planted-foot gait solver, footfall tables (a table may carry its own cadence curve `fOf(v, K)`) | animal agents (coordinate) |
| `src/units/kit/felid.js` | `CBZ.felidKit.hooks(spec)`: one cat engine (lofted body + pattern shader, rotary gallop with a flexing spine, stalk/sprint/leap brain, trip/throat/pin/nape/grapple fight, ragdoll markers, takeover moves). The cheetah and snow leopard files are pure data on it; any cat can be | cheetah / snow leopard agent (coordinate) |
| `src/units/kit/vehicle.js` | vehicle drive / turret / armour / crew helpers | vehicle agents (coordinate) |
| `src/units/kit/hull.js` | `CBZ.hullKit`: wheeled-vehicle bodies (Humvee, M35): geometry buckets, nation/ground camouflage + flag decals, tyres, the M2, crew figures, particle FX, and `WheeledRig` (Ackermann steer, per-wheel suspension, sprung body, turret + scan, recoil, dust, exhaust, damage, wreck) implementing `mark / fire / damage / muzzleWorld / aimTurret`, plus `hullKit.animate` for a def's `animate`. Load it through the manifest row's `needs` | vehicle agents (coordinate) |
| `src/units/kit/moves.js` | `CBZ.unitMoves`: what a possessed animal does on ATTACK (the `moves` hook) | player control (species files override) |

### The sim and the page (NPC War's host layer today)
| file | what | owner |
|---|---|---|
| `src/battle/menu.js` | the war room: matchups (`MATCHUPS`), grounds, sides, best-of, the call | menu / UX |
| `src/battle/teams.js` | the two slots, `SIDES`, `refreshSides()`, nation marks, flags | core |
| `src/battle/arms.js` | the guns on the menu, the mixed issue, punch per training | weapons |
| `src/battle/men.js` | `makeMan`, uniforms; `kitUp` dresses each man through `CBZ.combatKit` (§9a) | humans / armour |
| `src/battle/beasts.js` | `makeBeast`, `animateBeast`, `beastFight`: the animal unit, routed through `CBZ.unitKit` | core (species agents edit their species file instead) |
| `src/battle/vehicles.js` | `makeVehicle`, the vehicle sim, crew mount/dismount | vehicles / armour |
| `src/battle/damage.js` | `hurtMan`: the one damage funnel (asks `CBZ.armour.resolve`, §9a), reachability | armour / weapons |
| `src/battle/death.js` | a beast dies, a man dies, the sinking dead | physics / humans |
| `src/battle/physics.js` | the grid, body separation (split by mass), pinned pairs, momentum (`bodyKg`, `contactImpulse`, `addKnock`, `stepKnock`), bodies in the air (`flingBody`, `stepTossed`), the blast (`blastBodies`), hull strikes (`hullForStrike`), the flow field (`NAV`), COM (§9c) | physics |
| `src/battle/fire.js` | the trigger (aimed / suppressive fire, pairs, bursts, reloads, stoppages, grenades, the gun's stance), flown rounds, penetration, ricochets, wounds, bleeding, rockets, backblast | weapons |
| `src/weapons/ballistics.js` | `CBZ.ballistics`: cartridges, guns, materials, flight / drop / zero / penetration maths, body zones, species anatomy (node-loadable, shared with Gang City) | weapons |
| `src/battle/air.js` | air support: bombers, the nuke run, airstrikes | weapons / vehicles (air) |
| `src/battle/ai/think.js` | one unit's decision (target, slot, cover) | AI |
| `src/battle/ai/morale.js` | morale, stance, hull-down | AI |
| `src/battle/ai/orders.js` | hold / advance, the centre of mass, the hunt | AI |
| `src/battle/ai/squad.js` | the squad brain's page half: the adapter, the tick, `squadThink`, stances + the cover cycle, `soldierRig` (entities/soldier.js), the wounded, surrender, grenades, vaults, danger close, `tacticsVehicle` (§9b) | AI |
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
| `src/battle/arenas/erg.js` | the open dunes / snow / fields / wood: the height forms (barchan + transverse dunes off one wind, snow drifts, rolling ground), the crest table, the parcels, the skin and its per-surface shader (ripples, sastrugi, litter + dapple, crops) | terrain |
| `src/battle/arenas/cover.js` | `CBZ.battleCover`: every cover point (props, walls, crests, crater lips), hit points, destruction; `MAP.coverNear/coverFrom` | terrain |
| `src/battle/arenas/dress.js` | `CBZ.battleDress`: the real objects (sandbags, hesco, jersey, burnt cars, boulders, logs, dry walls, bales, rubble, containers), instanced, and where they go (open ground, the downtown's streets) | terrain |
| `src/battle/arenas/ground.js` | `CBZ.battleGround`: earthworks + craters in groundAt, prints and tracks, scorch, blast spray, blowing sand, the baked dead (remains) | terrain |
| `src/battle/arenas/woods.js` | `CBZ.battleWoods`: THE WOOD (canopy, understory, bracken, deadfall, canopy map) and the snow's spruce groves | terrain |
| `src/battle/arenas/fields.js` | `CBZ.battleFields`: farmland (hedgerows on banks, dry walls, wheat, maize, bales, pasture) | terrain |
| `src/battle/arenas/sea.js` | open water: swell, reef, fleet, depth | water |
| `src/battle/arenas/yard.js` | the kill box | terrain |

| `src/battle/melee.js` | men with bare hands: `stepFists` (combat_iq's IQ.melee, damage x `IQ.lastBlow(m).dmgMul`), `knockedDown` (a man on the floor is not steered) | melee |

Melee is shared with every game. The fighter brain is `systems/melee.js` (`CBZ.melee`, in the
`verbs` pack, which is in `NEED`). combat_iq's `IQ.melee` hands NPC fist fights to it, and the
possessed man goes through `CBZ.melee.drive` (`youMelee` in `player.js`). Everything is
feature-detected, so the page works before that layer lands on main.

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
  moves(unit, tgt, ctx) -> move | id | null   // what it does when a PLAYER presses attack (below)
});
```

**Possessed animals: the `moves` hook** (`src/units/kit/moves.js`, `CBZ.unitMoves`). A player can
take over any unit (tap it). A possessed animal has MOVE and ATTACK; ATTACK asks the species
file's `moves(unit, tgt, ctx)` which move to throw, and falls back to the shared picker
`CBZ.unitMoves.pick` (by family: cats pounce from a sprint, swipe close, throat-bite the
downed; canids/bears leap and maul; sharks lunge; rhinos/bison ram then gore; elephants
trunk-grab and throw what they can lift; hoofed animals kick and trample; the gorilla uses
`ape_combat`'s own repertoire). `ctx = { dist, reach, sprint, speed, chase, downed, crowd, n,
water, heavy }`. A move is `{ id, style, pow, dur, rng, leap, cd, grab }`; `style` is
creature_combat's grammar, or return an id from `CBZ.unitMoves.MOVES`. The driver latches the
move on the body (`_atkAnim = 0`, `_apeStyle`, `_atkDur`, `_atkPow`) and then calls your
`fight` (or `CBZ.creatureFight`) every step, with `opts.youMove` set: a fight built on
creatureFight plays it with no extra work.

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
  kind: "vehicle", domain: "ground" | "air", drive: "tracked" | "wheeled" | "rotor" | "jet",
  stats:   { hp, mass, speed, turn, armour: { front, side, rear, top },  // armour in mm RHA
             grip,                     // wheeled, opt-in, in g: the driver slows for corners, lock limited at speed
             dismountAt,               // keep it above 1.15 x standoff, or the carrier parks with its men aboard
             alt, standoff, nap, popAlt, climb, popWindow, popShots,     // aircraft: see "Flight"
             ingress },                // aircraft: spawn this far back (m) so a bomber's first pass is a real run
  crew:    [{ seat: "driver" | "gunner" | "commander" | "loader" | "pilot", pos: [x, y, z] }],
  passengers, passengerPos: [[x, y, z], ...],                          // optional: each bench seat in hull space
  weapons: [{ id, seat, kind: "cannon" | "autocannon" | "mg" | "rockets" | "missile" | "sam" | "bombs",
              rof, dmg, range, minRange, ammo, burst, pause, salvo, reload, vs, needs, indirect,
              mount: "turret" | "slew" | "fixed" | "free", arc, yawMax, tol,       // facing, below
              guided, basket, alt, dive, pullOut,                                // air weapons
              stick }],                // unguided bombs: the stick's ground length (m), rippled across the mark
  build(ctx) -> { group, rig, footW, footL, height },
  animate(veh, dt, ctx),                                // optional: the unit's own look
  tactics: { role, engage, priorities, hullDown, faceThreat, reverseOut, screen, ... },  // for the AI
});
```

#### The vehicle contract: the hooks the battle calls

`src/battle/vehicles.js` is the only caller. Every hook is optional; a missing one means the
shared default. A unit file never needs to know the runtime's internals.

**`build(ctx)`** is called once per hull. `ctx` = `{ THREE, mat, rng, seed, id, side, team,
nation, flagId, flag, color, ground, sideInfo }`. `side` is the slot (`"red"`/`"blue"`). `nation` is
the `city/flags.js` id the side fights for (null for a side with no army). `flag` is that
nation's design (paint it with `CBZ.flags.paint(g2d, ctx.flag, w, h)`; at THE FRONT it is the
front spec's own flag). `color` is the side's mark colour. Markings, roundels and fin flags
come from here. Return `{ group, rig }`, where `group` has its feet at y = 0 and nose on +Z.
`ground` is what the hull is painted for: the open maps' skin (`sand`, `snow`, `grass`) or the
map id (`city`, `island`, `field`, `arena`, `water`...).

**`rig.mark(nation, ground, side)`** is called by the battle right after `build`, when the rig
has it. It sets the paint scheme for the ground and puts the nation's flag on. The battle calls
it, so a unit does not also paint from `ctx` in `build`.

**`def.tactics`** is exposed on the hull as `veh.tactics`, for the AI layer (`src/battle/ai/*`)
to read: role, engagement ranges, target priorities, hull-down, keep the front toward the
threat, reverse out under fire, infantry screen. The runtime itself does not act on it yet.

**`animate(veh, dt, ctx)`** is called by the battle **every sim step, on the battle clock**,
for every vehicle kind, alive or wrecked. It stops when the battle is paused and follows the
speed dial. Distance LOD applies: a far hull is animated every 2nd or 4th step with the summed
`dt`. `veh.rig` is what `build` returned. `ctx` is one object per hull, reused:

| field | what |
|---|---|
| `t`, `dt` | sim time, this call's dt |
| `dead`, `wreck`, `burning` | damage state (`dead` = knocked out: wind rotors down, kill lights) |
| `air`, `agl`, `speed`, `vy`, `yawRate`, `gamma` | motion: height over the ground, forward m/s, climb m/s, rad/s, flight-path angle |
| `steer`, `throttle`, `turret` | the drive's controls and `{ yaw, elev }` of the turret |
| `target`, `phase` | the mark, and an aircraft's flight phase (`transit mask pop drop` / `in out`) |
| `firing` | the shot fired since the last animate (the `shot` below), else null |
| `side`, `nation`, `groundAt` | who it fights for; `groundAt(x, z)` |
| `shared(dt)` | run the shared default from inside your own |

With no `animate`, the shared default runs: `rig.update(dt, v, w, steer)`, and for aircraft
`CBZ.milAirDrive` (control surfaces, props, gear).

**The shot.** Every round, launch and bomb is described by one object per weapon, reused:
`shot = { wid, wi, n, w, kind, mount, target }` (`wid` = the weapon's id, `wi` its index in
`weapons`, `n` the round number on that weapon since spawn). Every rig hook below receives it.
Do not read `w.needs` as a "which weapon" signal (the old getter hack): use `shot.wid`.

| rig hook | when |
|---|---|
| `muzzleWorld(out, shot) -> Vector3` | where this round leaves (the gun, the next tube or rail; for a bomb, its bay clip or wing rack) |
| `fire(shot, from)` | every round of every weapon. A rig with `fire` owns its effects (recoil, flash, the store leaving its rail): the runtime draws none |
| `fired(scale, shot)` / `spend(i, shot)` | **legacy** (`city/mil_armor.js` rigs), only when there is no `fire`: `fired` for cannon (1) and autocannon (0.3) rounds, `spend` for a launch with `i` = the rig's own `loaded - 1` when it keeps one, else `shot.n` |
| `reload(shot)` | a salvo's reload has finished: put the rounds back |
| `store(shot) -> Object3D` | a released bomb's falling mesh (in the scene, at `muzzleWorld`); the runtime flies it and hands it to `CBZ.munitions.release` on impact, so take it from `CBZ.munitions.acquire` |
| `canFire(shot) -> bool` | false holds this weapon this step (a TOW only with the launcher up and the hull still) |
| `damage(vs, res)` | every hit that lands (`vs` = the damage state, `res` = `vehicleDrive.resolve`'s result: `zone pen dmg mobility firepower burning wreck`): show the drooped gun, the thrown track, the fire |
| `aimError(shot) -> rad` | how far a `slew` mount still is from the line; the runtime holds fire until it is under `w.tol` (0.06) |
| `aimTurret(yaw, elev, dt)`, `aimLauncher(yaw, elev, dt)`, `settle()`, `update(dt, v, w, steer)` | as before |

A model can also carry `userData.chinGun = { yaw, pitch }` (the names of two empty nodes). The
runtime lays them on the mark with `CBZ.milAirAim` and the rig follows them at its own rates.

**Facing is per weapon.** `mount` says what has to be on the line before a weapon fires:

| mount | fires when | default for |
|---|---|---|
| `turret` | the vehicle's turret has slewed onto the mark (`tol`, 0.05 rad) | `turret: true` |
| `slew` | the mark is within `yawMax` (default 1.9 rad) of the nose and `rig.aimError` is under `tol` | `chin: true` / `slew: true` |
| `fixed` | the NOSE is within `arc` of the mark (missile/sam 0.35, rockets 0.05, guns 0.06); a jet's gun and rockets also check the dive angle | an aircraft's non-MG weapons |
| `free` | always (pintle, door gun, indirect launcher, bombs) | everything else |

When a `fixed` or `slew` weapon is out of arc, the aircraft turns its nose onto the mark.

**Weapons need their seat crewed.** A weapon fires only when its `seat` has a man in it (or the
implicit crew of a hull nobody was assigned to). A weapon with no seat needs any crew, and a
`remote` airframe is always crewed. There is one exception: a crewman whose own seat works no
weapon (the driver) can climb over to the MAIN gun's seat (weapon 0's) once the hull has
stopped. He never works the loader's or the commander's machine gun. You, at the controls, are
the crew.

**Crew casualties by seat.** A penetration comes in through the face it hit, on the line from
whoever fired it, and its spall carries on through the hull. Each man in a seat (crew or
passenger, at the seat's `pos` in hull space) is killed with
`p = min(0.9, beh / 600) x exp(-distance from the line / 1.1 m)`. When nobody is left alive in
the hull, the vehicle is out of the fight (abandoned). The bail-out after a knockout is
unchanged.
The player's weapon pick (`vehYouSeatWeapon`) uses the same fit rules (`vehWeaponFits`) and
puts weapons that cannot bear on the mark second.

**Flight.** Aircraft fly a doctrine (`stepRotor`, `stepJet` in `src/battle/vehicles.js`):

- **Helicopters** (`drive: "rotor"`) fight from battle positions. The stand-off is the
  weapon for the mark's `range x 0.75`, capped by `stats.standoff`. The position is on its
  own side of the mark, where ground or buildings hide it at `nap` m (default 10) but a climb to
  no more than `popAlt` (default max(alt, 60)) clears the line. Closer rings are tried when
  nothing sees the mark. The phases are `transit` (nap of the earth, terrain-following), `mask`
  (hover hidden until a weapon is ready), `pop` (climb at `climb` m/s, default 8, nose on the
  mark, fire for `popWindow` s, default 7; this is cut short after `popShots` rounds, when hit,
  or when blind), and `drop` (back down, then sidestep to a new position). With no mask (flat
  ground) it still shoots and scoots. A transport (`dismountAt`) flies low to a landing short
  of the enemy and sets down. A rotor transport never unloads in flight: it picks the landing
  zone (0.8 x `dismountAt` short of the mark, fixed once it is within 150 m), flares into it and
  either lands and unloads (phase `insert`), or, with `stats.fastRope` (m), hovers at that height
  and puts the men down two ropes, one man per rope every `ropeEvery` s after `ropeDelay` plus
  `fastRope / ropeSpeed` (the rig can draw the same schedule off `ctx.phase === "insert"`). A hit
  that penetrates an airborne transport does not throw its passengers out. With
  `stats.broadside` (rad) a door-gun aircraft turns that far off the mark at its battle position
  so a side gun bears (alternating sides with the sidestep).
- **Vehicles and `moves`.** A vehicle file may define `moves(veh, tgt, ctx) -> weapon id`: the
  weapon a PLAYER's attack works on this mark (`vehYouSeatWeapon` asks it first; the UH-60 names
  the door gun on the mark's side).
- **Jets** fly attack runs at real heights. Level bombing is flown at the weapon's `alt` (else
  `stats.alt`) and released where the fall lands on the mark. A `guided` bomb is released
  inside a basket of `basket` (0.15) x its fall distance and homes all the way down (`homing`
  on the rocket, `fire.js`). Missiles are fired at cruise inside 0.85 x range with the nose on,
  and the jet breaks off inside its own stand-off. Gun and rocket runs are DIVES down a line of
  `dive` rad (0.3) from `alt` (default min(cruise, 1500)), firing inside range and pulling out
  at `pullOut` m (250). The jet then flies a racetrack out past the mark, wide enough for its
  turn circle, and comes in again. It never flies below 60 m. The heights today: F-35 4.6 km
  (gun dive from 1.5 km), MQ-9 4.5 km, B-52 9 km, B-2 12 km, A400M drop 380 m.

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
`src/units/kit/vehicle.js` (`CBZ.vehicleDrive`: tracked/wheeled drive, ground-follow
suspension, rate-limited turret laying, ballistics, armour zones, penetration, damage states,
the crew seat book; pure maths, node-loadable). The battle side (crew, AI, firing, damage
states, wrecks, player driving) is `src/battle/vehicles.js`.

The 17 vehicles today, each on the game's existing builder (there is no new art in wave A; the
vehicle agents redraw):

| id | name | builder | crew | weapons | armour F/S/R/T (mm) |
|---|---|---|---|---|---|
| m1_abrams | M1A2 Abrams | milArmor.tank | commander, gunner, loader, driver | 120 mm, coax, .50 | 800/120/50/40 |
| bradley_ifv | M2A3 Bradley (6 dismounts) | milArmor.ifv | driver, gunner, commander | 25 mm, TOW, coax | 60/30/20/15 |
| stryker_apc | Stryker (9) | milArmor.apc | driver, commander | .50 RWS | 20/14/12/8 |
| hmmwv | Humvee (2) | milArmor.luv | driver, gunner | .50 | 10/10/8/5 |
| maxxpro_mrap | Navistar MaxxPro MRAP (6) | its own file on units/kit/hull.js (V-hull capsule, O-GPK, rear door) | driver, gunner, commander | .50 ring | 30/26/26/12, belly 260 (blast) |
| jltv | Oshkosh L-ATV JLTV (1) | its own file on units/kit/hull.js (TAK-4i travel, CROWS) | driver, gunner, commander | .50 CROWS | 22/16/14/9, belly 200 |
| m35_truck | M35 (16) | milArmor.truck | driver, commander | none | 2/0/0/0 |
| m270_mlrs | label "M142 HIMARS" (the model is the wheeled pod) | milArmor.mlrs | 3 | 6 rockets | 8/2/2/2 |
| patriot_launcher | Patriot | milArmor.patriot | 2 | SAM (air only) | 6/2/2/2 |
| technical | MG technical | stand-in in its file (warlord's builder needs CBZ.warlord) | driver, gunner | MG | 1/0/0/0 |
| ah64_apache | AH-64 | milAir attackHeli | pilot, gunner | 30 mm, Hellfire, Hydra | 20/15/10/8 |
| uh60_black_hawk | UH-60M (11, fast rope) | its own file (redrawn) | pilot, copilot, gunner, crew chief | 2 x M240H door guns | 3/2/2/2 (unarmoured, hp 820) |
| f35 | F-35A | milAir fighter | pilot | 2 GBUs/pass, 25 mm | 2 |
| mq9_reaper | MQ-9 | milAir drone | remote | Hellfire | 0 |
| b52 | B-52H (redrawn: skinned flexing wing) | its own file | pilot, copilot, radar nav, nav, EWO | 27 x Mk-82 stick (bay), 12 x GBU-31 JDAM (HSABs) | 3/2/2/2 (unarmoured, hp 1800) |
| b2_spirit | B-2A Spirit | its own file (redrawn: real planform, hinged surfaces, two bays with rotary launchers) | pilot, commander | 8 GBU-31 BLU-109 (armour), 8 GBU-31 Mk 84 | 3/2/2/2 (unarmoured) |
| a400m | A400M (airdrops 116) | milAir cargo | 3 | none | 0 |

**The belly.** A charge under a hull (`imp.cause` `"ied"` / `"mine"`, threat class `ied`, 160 mm
of blast loading) lands on the zone `"belly"`, and so does any ground blast inside the footprint
of a hull that rates its floor (`stats.armour.belly`: a V-hull). A hull without a belly figure
takes it on its roof's armour. The MaxxPro and the JLTV live through it; a Humvee does not.

**Crew rules.** A side's men fill seats in roster order: drivers and pilots first, then gunners,
copilots, commanders, loaders, then passenger benches. Seated men are off the field (hidden, not
targets). A vehicle nobody on its side was assigned to gets its full crew implicitly. A one-man
crew stops to shoot, and a cannon with no loader fires 1.6x slower. Passengers dismount at the
vehicle's dismount range, or when the hull is penetrated or immobilised, and transports airdrop.
A knocked-out vehicle's crew bails out as wounded men: 85% survive, 30% if it blew up. Rifles,
teeth and fists do nothing to thick plate.

**Player.** Tap/click a vehicle (or the rifle button G on a side with one). W/S throttle, A/D
steer (or the touch stick), the look lays the turret and is pulled onto the auto-target, attack
(LMB / J / the touch button) fires the right gun for the mark (main gun at armour, MG at men; X
picks a seat by hand). The round waits until the turret is on. The chase cam rides the turret
while you gun. G hands it back. In aircraft you work the guns while the AI flies. Your gun
line is the weapon's mount: the turret, the look (slew within its arc, free), or the nose.

**Take over / camera (player.js, camera/*.js, hud.js).** Any unit, either side: tap it.
MOVE + ATTACK only (men: CBZ.melee grammar with fists, auto-aimed fire with a gun, rifle butt up
close; animals: the `moves` hook above; vehicles: drive + seat weapon). Death while possessed: a
slow beat on the body, then you hop to the nearest ally. Camera modes: `auto` (the director:
interest score over fights, deaths, charges, big guns, explosions; shots `hero` `charge`
`establish` `general`; slow-motion on knockouts, kills on the lens, explosions; `?slowmo=0/1`,
off by default under `probe=1`), `follow`, `study/under/surface`, `kill`, `you` (chase cam),
`youdead`, `free` (drag orbit, right-drag / two fingers pan, wheel / pinch zoom). The lens never
enters walls, ground, dunes or bodies (camApply). Probe seams: `__battle.take(sel)`,
`youDrive({ax,az,run,atk,yaw})`, `youState()`, `director()`. Shot service: `--cams lens` shoots
the game's own camera.

**Known gaps.** The HIMARS' indirect fire needs tuning, and there is no per-track split on the
rig. Aircraft fly the doctrine above, not `studio.fly`. The `drive` / `aim` / `fight` unit
hooks are not called yet: a unit drives on the shared tracked / wheeled / air model. In node,
strategic.js and the A400M build fall back to stand-ins (browser untested).

### Seeing your work: the shot service

Never launch Chrome yourself. Ask the warm capture pool (`tools/shot/`), which shoots your
working tree as it is, uncommitted edits included:

```
node tools/shot/req.mjs --preset turntable --setup 'species=bengal_tiger' --wait
node tools/shot/req.mjs --preset gait --setup 'species=dog' --wait            (also walk|trot|run|attack|death|glance)
node tools/shot/req.mjs --preset matchup --setup 'a=m1_abrams&b=men&n=1v30' --wait
node tools/shot/req.mjs --preset matchup --setup 'a=ah64_apache&b=men&n=1v30&arena=dunes&cam=ah64_apache' --wait
node tools/shot/req.mjs --preset turntable --setup 'species=lion' --ba --wait  (origin/main vs you, one sheet)
```

It prints a sheet path: Read it. `--setup` takes the matchup URL names (`a b n=AvB aw at arena`)
as well as the stage keys (`species unit vs vn pose speed heading stage grid ruler cam`). Any other
key goes on the page URL. `cam` is the battle page's lens name (`a`, `b`, `a:3`, or a unit id).
In a full battle every frame frames THAT body (re-found per frame, so the sheet follows it), not
the whole field. `wide` takes in its mark when that is close, `hot` is a close 3/4, and `lens`
shoots the game's own camera, which `cam` also points at the body (`__battle.camFollow`). On the
battle page itself, `?cam=<unit id>` rides the unit closely (the study desk: a hull is followed
off its rear quarter) and finds the next of its kind if it falls. A change that touches only `src/units/species|vehicles|kit/*.js` (or
the bestiary's `src/city/wildlife/*.js`) is hot-swapped into a warm page, so a glance takes 1-2 s.
The stage loads the unit's file and its `needs` through `CBZ.unitKit.need()` first. A glance is
not a test: look, fix, look.

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

Optional (feature-detect them): `coverNear(x, z, r, out, opts)` returns cover points
`{ x, z, y, nx, nz, h, low, kind, rec }` (the cover is on the -n side; `opts.threat {x,z}`
keeps only points that hide you from it), and `coverFrom(x, z, tx, tz, r)` returns the one a
man would run to. Kinds: `crest drift fold crater wall tree hedge sandbags hesco jersey hulk
boulder log drywall bale rubble container`. Props have hit points; a blast that beats one
takes its collider and its points away (rubble keeps a low set).

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

The goal is 100k men against 100k men without losing quality, logic or looks. It is built
(branch npcwar-scale). A battle no bigger than the FULL cap is all FULL and never enters any of
this: it is exactly the page it was.

**The files**

| file | what |
|---|---|
| `core/store.js` | `CBZ.battleStore`: one row per unit, typed columns; `S.col()` adds a tier's columns; SharedArrayBuffer-backed when the page is cross-origin isolated |
| `core/lod.js` | `CBZ.battleLod`: tier rules, caps per device, budgets, and `schedule()` (per squad, nearest first, hysteresis + `DEMOTE_S` hold) |
| `core/tiersim.js` | `CBZ.battleTierSim`: the MID and FAR sims (page-free; runs in the page, in node, in the worker) |
| `core/flow.js` | `CBZ.battleFlow`: the one Dial flow-field solver (physics.js `navSolve` and the tier sim both call it) |
| `core/simworker.js` / `core/simlink.js` | the Web Worker and the page's end of it |
| `src/battle/mass.js` | the host half: spawns rows, keeps FULL rows current, runs the tiers, ghosts, promotion/demotion, blasts on rows |
| `src/battle/massdraw.js` | every non-FULL man through `entities/crowdgpu.js` (near / far / dead layers) |
| `src/battle/settingspanel.js` | `SETTINGS`: the panel, device defaults, AUTO quality |

**The tiers.** Decided per squad (ten men), so a squad never straddles two brains.
- **FULL**: a real `makeMan` / `makeBeast` object and the page's own brain. Rigs are built inside
  a per-frame budget (`MASS.promoteMs`), hidden, and the whole squad flips on one frame.
- **MID** (`tiersim` thinkMid): the page's rules on rows: combat_iq's fire gate (reaction beat, aim
  settle, burst rhythm, derived damage, hit chance, the running-target and suppression penalties;
  every profile comes from `CBZ.combatIQ.profile()`), the fire token (2 or 3 guns on a mark),
  bearing slots, the band, the lane rule, the LOS check at every trigger pull, hull-down on the
  dunes, stance, the hold, the hunt, the pursuit, morale (brain.js's constants and per-man formula;
  the ARMY is stepped once by the host over every row), rout, cornered, rally, flight. Walked on a
  0.1 s slice; a think on the page's own cadence.
- **FAR** (`tiersim` thinkSquad / updFarMan): the squad's senior man looks for the war (one search
  per squad per second); until it has contact the squad is a march column visited at the march
  tick (1 s; the renderer carries each man along his velocity). With contact every man takes his
  own mark, token, line (on a slower clock), rhythm, magazine, nerve and wounds, on a 0.25 s slice.
- Shots from both tiers are resolved in a batch at the end of the step. Target search walks a
  dense per-side grid (only the enemy's rows); separation, the lane and the anti-clump use a
  hashed 2.4 m body grid of the rows that are doing something.
- **Seams.** A FULL brain's `pickTarget` also gets rows (`MASS.cands`) as **ghosts**: plain objects
  with the fields the fire path reads, synced every frame; `hurtMan` on a ghost lands on the row.
  The tier sim's rounds on a FULL row come back as events and go through `hurtMan`. Kills, the
  morale shock, the near-miss rattle, tracers and the director's `shotsRing` all follow.
- **Hooks for the AI agent**: `MASS.T.brain.mid` / `.far` replace a tier's think
  (`fn(T, row, now, dt)`), `BUDGET` (core/lod.js) sets each tier's tick and milliseconds.

**The proof** (`node tools/npcwar-fidelity.mjs [seeds] [case]`): the same engagement fought by
the FULL page and with every squad forced MID, FAR, and MIXED (a FULL ring round the lens, MID
round that, FAR beyond), over N seeds: the winner share within binomial noise, the loser's losses
within 15 points, the time to decision within 25%. `tools/npcwar-worker-check.mjs` runs the
worker on a real thread in both modes. `tools/npcwar-scale-bench.mjs` measures 1k/10k/100k a side.

**The worker.** MID + FAR + the grids + the hit batch run in `core/simworker.js` whenever the
page can host a Worker (not under `?probe`/`?auto` tools unless `?worker=1`). Cross-origin
isolated: the store is shared. GitHub Pages cannot send COOP/COEP, so the shipped path is
**transfer**: the worker owns its copy, the page sends the FULL rows each step, the worker sends a
packed snapshot of every row (ping-ponged transferables, 15 Hz) and the full state of rows the
page is about to promote. A worker that dies hands the tiers back to the page.

**The drawing.** Every non-FULL man is the real `CBZ.human` through crowdgpu: his skin and hair are
studio.cast's heritage roll for his role and variant, his uniform men.js's `uniformFor`, and the
rig's own kit is baked in (`CBZ.crowdGPU.gear()`: men.js's helmet dome, actorweapons' rifle, shown
per instance by `gearCode`). Clips by speed (rifleIdle / rifleWalk / rifleRun / crouchRun / down);
the gait phase is handed to the rig's phase at promotion and back at demotion. Impostors only
past the quality preset's `d2`. Known gaps: one baked rifle (the side's first issue) for the
crowd, the helmet sits on uncompressed hair, beasts and vehicles have no instanced body yet
(beast rows are simulated by the MID/FAR melee brain and drawn only once promoted; vehicles and
their crews are always FULL).

**Settings** (`SETTINGS`, saved as `cbz-npcwar-settings`): army cap, full bodies, near and mid
range, mid brains, quality (crowd LOD bands/caps, far re-cut, pixel ceiling), shadows
(off/near/all), draw distance, auto quality (gives back draw distance, the far re-cut, impostor
range, MID brains, MID range, and the full rigs last). The render scale never drops below one
pixel per CSS pixel. URL keys win for tools: `?tier=full|mid|far ?fullcap ?midcap ?fullr ?midr
?worker=0|1`.

---

## 9a. Kit and armour (shared with Gang City)

A soldier's kit is part of the one human body, not of this page:

| file | what |
|---|---|
| `src/entities/combatkit.js` | `CBZ.combatKit`: plate carrier (front/back plate bags on the body's own chest/back, cummerbund round `CBZ.bodySection`, straps over the trapezius crest, MOLLE), role pouches, radio, hydration, IFAK, tourniquet, sling; helmet (`entities/headwear.js` `ballistic` = ACH/ECH, `b6b47` = 6B47, `pasgt`), eye pro (`entities/eyewear.js` `eyepro`), gloves, knee pads, combat boots, ID tape; the nation's camouflage as a triplanar uniform material |
| `src/warlord/camo.js` | `CBZ.camo`: the camouflage library (OCP, MultiCam, woodland M81, EMR, digital desert, flecktarn, three-colour desert, ...) |
| `src/systems/armour.js` | `CBZ.armour`: zones, pieces, rounds, `resolve(hit)` |

**Who wears what.** `CBZ.combatKit.roleFor({ tier, wid, i, nation })`: `civ` = civilian (no kit),
`thug` (or an irregular faction) = militia (chest rig, no plates, no helmet), `swat` = police
tactical, else by gun and squad slot: `lmg` = machine gunner (100-round box pouches), `sniper` =
marksman (single 7.62 pouches, rangefinder), every 30th man an officer (admin pouch, manpack radio
with whip, handset), every squad's tenth a medic (aid bag, IFAK, armband), the rest riflemen
(three mag pouches, radio, hydration). `pro` wears second-line plates (`grade: "second"`).

**Nations** (`CBZ.combatKit.NATIONS`, by `city/flags.js` id; one look per nation, always):
republic = OCP + ACH + coyote kit + ESAPI/ESBI; kesh = digital desert + 6B47 + tan + 6B45 Gr.6;
veridia = flecktarn + ACH + olive + ESAPI; solara = EMR + 6B47 + ranger green + Gr.6; mbeya =
woodland M81 + PASGT + olive drab + Level III steel. Both arms carry ID tape in the side's mark.

**The armour rules** (`CBZ.armour.resolve(hit) -> res`, documented in full in the file header):
- A hit lands in a zone: skull, face, neck, thorax, abdomen, side, armpit, pelvis, upper arm,
  forearm, thigh, shin (area-weighted, or the caller's `zone` / `region` / `headshot`).
- A zone is covered by a piece or not: plates cover 86% of the thorax and the top of the abdomen,
  soft armour the rest of the torso, side plates or the soft cummerbund the flanks, the helmet 92%
  of the skull. The face, neck, armpits, pelvis and limbs are bare: that is where wounds happen.
- Threat v rating on one NIJ-like scale (9 mm 1.0, IIIA 2.2, 5.56 3.4, 7.62x51 3.7, Level III
  plate 3.75, ESAPI 4.8, .50 BMG 6.5): a logistic P(pen). Stopped = blunt trauma (10-20% of the
  damage), a stagger (`CBZ.soldier.hit`) and a winded man (`res.winded` s: half speed). Beaten = the
  round goes on with 72-90% of its damage and leaves a `CBZ.soldier.wound`.
- Helmets turn ~23% of rifle rounds (a deflection: stopped, hard stagger).
- Plates crack: every stop costs integrity in proportion to the energy, and a cracked ceramic
  plate's rating falls, so a burst into one plate gets through.
- Blasts are cut by the share of the body the kit covers; blows, bites and crushes keep their
  own numbers, a plate or helmet only takes some off.
- Unarmoured, the zone multipliers average exactly 1 for the body and 2.2 for the head, so balance
  moves only where there is armour.

**The hooks for weapons.** Two doors, one rule book (`systems/armour.js`):
- **A flown round** (§9b, `fire.js` armsHit): `CBZ.battleArmour.layer(unit, zone, { cart, v, v0, dx, dz })
  -> {mat, mm} | null`, asked for the ballistics zone the round enters (`head`, `torso`, `gut`; a
  limb returns null). It rolls which piece covers the point, decides plate v cartridge with the
  rules above (the round's steel penetration at its speed against the piece's cracked rating as mm
  of steel, `CBZ.armour.rateMM`; aramid is cut by anything over ~600 m/s; a helmet's deflection),
  cracks the piece, and answers in ballistics' language: a stop is a layer thicker than the round
  can cross (ballistics then deals the blunt trauma), a defeat is a layer it crosses losing speed.
  The stagger and winded seconds are left on `unit.armour.last`, and `hurtMan` (which sees
  `imp.bullet` and does not resolve again) winds the man.
- **Anything else** through `hurtMan(m, dmg, imp)`: `CBZ.armour.resolve` runs when `imp.kind` is
  given or inferred (bomb = blast, beast = bite, hull = blast, fist = blow) and returns `res`. A
  caller with no ballistics passes `{ kind: "bullet", round: "556" | { threat, energy }, wid, zone? }`.
- **Gang City's hitscan** (`systems/fpsmode.js` cityGunHit) asks `CBZ.armour.resolve` with
  `raw: true` (its own head and limb multipliers already applied) for a soldier wearing kit; a stop
  is a spark and no lethal headshot.

**Gang City.** `city/outfits.js`'s `soldier` fit is `kit: "rifleman", nation: "republic"`;
recolorRig wears it (and strips it for any other fit). `entities/crowdgpu.js` bakes a third body,
the kitted soldier: `look({ soldier: true, shirt, pants, shoes })` (`CBZ.combatKit.crowdLook(spec)`
gives the colours), and `dressRig` puts the kit on the promoted rig.

`node tools/combatkit-check.mjs`: the fit on 8 bodies x 6 loadouts (nothing inside the torso, the
plates rest on the body, knee pads on the shins, the arms clear the carrier through idle, walk,
run and the rifle carries) and the armour rules.
## 9b. Weapons: the round is flown, not rolled

Every round any gun on this page fires (a man's rifle, YOUR rifle, a vehicle's machine gun) goes
through `fireShot(m, tgt, {mode})` in `src/battle/fire.js` on the numbers in
`src/weapons/ballistics.js`. There is no hit chance anywhere.

- **The aim.** The shooter picks a point (the chest of a man, the heart behind an animal's
  shoulder, the middle of a hull), leads a mover by its measured velocity times the round's
  time of flight (training sets how well), and holds over for range past his zero (training
  sets how well he guesses the range; a sniper dials).
- **The dispersion.** One angular error in mil from the gun (MOA), the man's hold in his stance
  (standing / kneeling / prone / bipod / a vehicle mount), his training, his feet, how long he
  has held on this mark, being shot at (`m.supp`) and the recoil the last shots left on the
  muzzle (it recovers on the training's time constant).
- **The flight.** `v = v0 e^(-kt)`: the round arrives a real time of flight later and drops.
  It is traced against the colliders (with their material, thickness along the line, `hollow`
  or `fill`) and the ground at launch, and against the BODIES when it arrives. A wall or a body
  it can go through costs it velocity; one it cannot stops it; a grazing hit on something hard
  can skip it off (a ricochet keeps flying and can still hit somebody).
- **The wound.** A hit is a path through a body's zones (`MAN` standing / kneeling / prone,
  `QUAD`, `FISH`, in the measured box of the animal: `bodyL bodyW bodyH bodyX0 bodyY0` from
  beasts.js). What it reached (brain, spine, heart and lungs, gut, a limb) and the energy it
  left decide the damage now and the bleeding after. Big animals are deep: a 5.56 does not
  reach an elephant's heart through its side; a .50 does.
- **Species numbers** (optional, in a species file's `stats`): `mass` (kg), `hide` (mm),
  `skull` (mm of bone in front of the brain), `ribs` (mm over the heart), `plan`
  (`"quad"` | `"fish"`). Missing ones come from `CBZ.ballistics.SPECIES`, then from size.
- **Collider materials** (arena owners): `addBoxCollider(..., { mat, hollow, fill })`.
  `mat` is one of `wood sand dirt snow cinder brick concrete steel rha`; `hollow` = wall
  thickness of a box with air in it (a container, a hull); `fill` = the solid share (a crate).
  Untagged colliders are concrete.
- **Armour hook** (the armour agent): `CBZ.battleArmour.layer(unit, zone) -> {mat, mm}` is
  asked for the zone a round enters; a plate it cannot defeat stops it (blunt trauma only).
- **For the AI** (read, do not duplicate): `CBZ.battleArms.band(m)` = `{eff, area, max, cls}`;
  `CBZ.battleArms.liveGrenades()` = `[{x, z, t}]`; `m.supp` rises with every round that cracks
  past inside its cartridge's suppression radius; `CBZ.battleArms.audit()` has the ledger,
  including `why` (why a man whose gun was ready did not fire: slot, unseen, ducked, ...),
  `shotsAt` / `hitsAt` by range band, organs hit, penetrations, ricochets, grenades.
- **The gun's stance**: `weaponStance()` (asked by stepMan) puts an LMG or a sniper prone past
  25 m and a rifleman on a knee past 60 m, when he has stopped to fight a mark he can see; the
  AI's own stances (cover, the fold, a pinned man's crouch) win wherever it has one.

`node tools/ballistics-check.mjs` prints the weapon table and holds the physics to published
figures (time of flight, drop, zero, penetration of sand / cinder block / steel, the elephant's
skull and heart, the lion's lungs, hit odds by stance).

---

## 9b. The squad brain (the AI's half of the tiers)

Armed men fight as **squads** (the page's `squads[team][sq]`, ten men): a leader, two fire
teams, and one task at a time decided on the squad's own clock. The brain is
`src/battle/core/tactics.js` (`CBZ.battleTactics`, page-free: it reads unit fields and asks the
world through an adapter `A` — Gang City hands it the city's); `src/battle/ai/squad.js` is NPC
War's adapter and what each man does with the answer.

- **Tasks** (`S.task`): `march` (column far off, wedge near, 4.5-6 m spacing), `bound` (one team
  moves to the next cover while the other watches; swap), `fight` (a base of fire from posts),
  `flank` (alpha fixes, bravo swings 70° round on the side with more cover), `assault`,
  `pinned` (two in five of its men flat under fire: nobody moves until it slackens), `fallback` (to cover/a crest behind,
  then `hold`), `hold` (the page's ORDER: each man on his own formed-up spot, snapped to cover),
  `drill` (an animal: a firing line across its approach, reloads staggered), `screen` (riding a
  friendly tank's rear quarters; the tank waits for its infantry: `tacticsVehicle`).
- **Posts** (`m.post`): cover first (a collider between him and the threat, the hide point past
  it; a tall wall gets a peek point at its edge), then the terrain's reverse slope (`hullDown`,
  budgeted), then open ground. The line's centre is pulled toward the nearest cover before it is
  laid. The **platoon**: a side's squads take sectors of one front, side by side (a second line
  40 m back past 320 m of front).
- **The man** (`squadThink`): the squad's focus if he can see it (≤60% of the guns; a man with a
  closer or comparable mark keeps his), never rifle ball at armour, combat_iq's aim clocks, the
  lowest stance with the shot, the cover cycle (down / up over or out round it / down to reload,
  blind fire when the fire is too heavy), reflexes before orders (a grenade at his feet, an
  animal charging him, panic only from real cues).
- **Casualties are not only the dead**: a bad hit can put a man DOWN (`m.downed`: bleeding,
  crawling, out of the fight; a mate drags him to cover, which stops the bleeding); a broken man
  who is cornered may surrender (`m.surrendered`, counted with the fled); a beaten brawler yields
  (systems/melee.js `quit`). `city/frontline.js`'s resolver models both (`WOUNDED_P`,
  `SURRENDER_P`) and stays calibrated (`npcwar-headless.mjs 6`).
- **Tiers**: every unit gets `m.aiTier` (0 FULL / 1 MID / 2 FAR) from `m.lod` when the scale
  scheduler sets it, else the lens distance through `CBZ.battleLod.tierOf`. A MID man thinks on
  `BUDGET.think.mid`, a FAR man on `.far`, with fewer sight lines per target search; the squad
  ticks at `K.SQUAD_TICK[tier]` with fold searches `FOLDS[tier]` (FAR: none — its posts are the
  line and open ground). `CBZ.battleTactics.COST` holds measured ms per tier (`full/mid/far` per
  think, `sqFull/sqMid/sqFar` per squad tick); `__battle.tactics()` reads them with the tasks
  fired and the counts above.
- **Revert**: `?tac=old` turns the whole layer off (the old march column, combat_iq posture, the
  old stance rules) in the same build — the before of every measurement.
- **Measured**: `node tools/npcwar-ai-metrics.mjs` (seeded, node only): walking into fire in the
  open, standing still being shot, bunching, oscillation, shots at nothing, rounds through a
  mate, friendly hits, stuck, idle, a firing line going silent on an animal. `--old` is the
  same cases with `?tac=old`.

---

## 9c. Physics: bodies have mass

`src/battle/physics.js` is the one place that knows what a body weighs and what happens when it
is hit. `node tools/npcwar-physics-check.mjs` holds it (fists v hide, 100 men v a bull, a
charge, a tank in a crowd, a blast, a throw).

- **Mass.** `bodyKg(m)`: a hull's `stats.mass`; a species file's own individual (`m._mass`, the
  number `systems/bodymass.js` reads too); else the anatomy row (`CBZ.ballistics.anatomyOf`)
  x the individual's size cubed. A man is 80 kg.
- **Contact.** Separation splits every overlap by mass (each body gives way in proportion to
  the other's mass). Equal masses split exactly as before, bit for bit. A heavy body MOVING
  into a light one (masses 3x apart) is a collision: `J = (1 + 0.2) v m1 m2 / (m1 + m2)`, each
  takes `J / own mass`. Speeds are what a body did under its own legs this sub-step
  (`physPre` / `physMid`), never the separation's corrections.
- **Knocks.** `addKnock(b, dvx, dvz, by, {hurt, vy})`: a living body slides on that velocity
  against friction (0.8 g standing, 0.6 g down); a man past 2.5 m/s goes down (verbs
  knockdown, else `m.ko`); past 5.5 m/s (or lifted) a body under 450 kg flies. A wall at
  speed is a second impact.
- **Flight.** `flingBody(b, vx, vy, vz, {by, carry, lift, dmg})` and `stepTossed`: ballistic
  at 9.81, swept through the walls, bowls whoever it arrives at by momentum, and the landing
  speed is the injury. The elephant's possessed trunk throw is an energy (2.7 kJ): a man
  leaves at ~8 m/s, a lion at ~5.
- **Injury from a velocity change.** `impactDmg(b, dv) = maxHp x 0.0085 x (dv - 3)²`: nothing
  under 3 m/s, half a man at 11 m/s (a 6 m fall), all of him at 14. A share of the body's own
  hp, because hp already carries a body's size.
- **Death impulse.** `deathDv(m, imp)` (the killing blow's `imp.J / kg`, or the slide or
  flight it died in) sets the ragdoll's kick, and `imp.dvx/dvz` its direction. A damage source
  that moved the body passes `J` (kg m/s) and `dvx, dvz` on the `imp`.
- **Blasts.** NPC War owns its detonation (`blast` on the mode, `damage.js`): damage
  `420 x power x (0.55 / Z)²` with `Z = d / R`, tapering to 0 at R; delta-v
  `9 x power x (0.55 / Z)^1.5 x (80 / kg)^(1/3)`. A man at the core dies and flies; a bull
  elephant at the core takes ~440 and rocks at 2 m/s. Corpses go first through
  `CBZ.ragdollBlast`; loose debris is kicked (`CBZ.debris.impulse`) and the crater throws
  grit (`CBZ.debris.chips`). Hulls keep the old ring (inside 0.55 R the armour answers).
- **Hulls.** `vehCrush` (vehicles.js): the face of a moving hull is a collision by momentum
  (the hull loses `J / M` of its speed: a Humvee into a bull stops, a tank into a man does
  not notice); a body the hull outweighs 12:1 that is down goes UNDER it (pushVehicle stands
  down) and the running gear goes over. A man it kills is handed to `city/carstrike.js`
  (`CBZ.ragdollStrike`, the hull's real profile drives his ragdoll), and `CBZ.cityCars` lists
  the moving hulls so a corpse in a tank's path is driven over. `hullForStrike(u)` gives a
  hull the names carstrike reads (`v` is the drive's own speed).
- **Fists.** `systems/bodymass.js` (shared with the city): a hide is a THRESHOLD the blow's
  force has to clear (`hide / 30` of a full punch), not a divisor with a floor. A man on a bull
  elephant is 0.009 (it was floored at 0.28); on a gorilla 0.41; on a man 1.0. Teeth, claws
  and tusks put the blow on a point (`meleeAbsorb(target, attacker)`).
- **Water.** On OPEN WATER a body that dies goes to `world/water_float.js`: a man floats awash
  and goes under in ~40 s, sharks sink, whales, orcas and dolphins float on their side, other
  fish float belly up, land animals float and slowly waterlog.

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
node tools/combatkit-check.mjs     soldier kit fit (every body, every loadout, every carry) + armour rules.
node tools/npcwar-fidelity.mjs     the tiers fight the page's war (see 9)
node tools/npcwar-worker-check.mjs the sim worker, both modes
node tools/npcwar-scale-bench.mjs  1k / 10k / 100k a side, ms per tier
node tools/front-sim.mjs           the city's front resolver (frontline.js) it is calibrated to.
node tools/npcwar-ai-metrics.mjs   the soldiers' dumb-behaviour numbers (§9b); --old = ?tac=old.
node tools/ballistics-check.mjs    the weapon table, and flight / penetration / wounds vs published figures.
node tools/npcwar-arena.mjs        BALANCE: a matchup over N seeds in parallel workers (real bestiary,
                                   creature_combat, ape_combat, bodymass): win %, time, casualties, who
                                   dealt what (shots by gun, bites by move, fists, blasts), wound zones,
                                   morale. Bands in data/npcwar/expectations.json; findings in
                                   docs/npcwar/BALANCE.md.  --only tiger   --a lion --b men --n 1v10 --gap 12
node tools/npcwar-balance-check.mjs the fast subset; FAILS when a win rate's whole 95% interval is
                                   outside its real-world band. Testbus node check.
node tools/npcwar-physics-check.mjs mass, momentum, knocks, flight, blasts, hulls, fists v hide (9c).
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
