# THE STUDIO

What a one-shot HTML page can ask Gang City for.

Two tags. The second one is your game.

```html
<script src="../src/core/studio.js"></script>
<script>
CBZ.studio.need("people", "desert", "air").then(function () {
  // your game. CBZ.scene, CBZ.camera, CBZ.micro and the frame loop are up.
});
</script>
```

## Packs

### `three`
three.js r128, the renderer everything here is written against.

### `seed`
deterministic streams; the determinism law forbids Math.random.
Pulls: `three`
Gives you: `CBZ.hash01`

### `boot`
scene, renderer, camera, clock, frame loop, input, touch, colliders with sliding movement, and procedural sound. The door: it stands all of this up under the SAME CBZ names the full engine uses, so engine files loaded afterwards find what they expect.
Pulls: `three`, `seed`
Gives you: `CBZ.micro`

### `look`
shared materials, box/geometry helpers, concrete and checker textures, glass, ground depth kinds, and the vehicle paint/glass environment. Load this before anything that draws.
Pulls: `boot`
Gives you: `CBZ.cmat`, `CBZ.boxGeom`, `CBZ.vehicleMat`

### `green`
instanced trees, bushes and grass that cost one draw call a layer.
Pulls: `look`
Gives you: `CBZ.vegetationKit`

### `people`
the 1.82 m voxel body the whole game runs on, its gait, its poses and its death. This is the rig the city, the prison and gun game all wear. Use CBZ.studio.cast(role) rather than building a person out of boxes.
Pulls: `look`
Gives you: `CBZ.makeCharacter`, `CBZ.animChar`, `CBZ.charPoses`

### `caps`
the capability bus. A page calls CBZ.registerMode(id, {caps, actors, hurt}) and from that line the shared verbs reach it: vault, ledge step, blast damage, wall breach. WITHOUT THIS PACK every shared verb in the engine declines and a page's people cannot be hurt by anything the engine fires.
Pulls: `boot`
Gives you: `CBZ.modeHas`, `CBZ.worldActors`, `CBZ.hurtWorldActor`, `CBZ.blastWorldActors`

### `day`
a DAY made of named blocks. CBZ.dayPlan.define(id, [{id,from}...]) answers what block it is, how long until the next and fires a callback when it turns over — wrapping midnight, silent on the arm, and reading the world's own sun when one is loaded.
Gives you: `CBZ.dayPlan`, `CBZ.dayPlanAudit`

### `light`
light as a FACT. CBZ.fixtures.rig(id, spec) registers fixtures with a per-kind schedule and drives their materials for free, answers level(x,z) region-aware (a lamp does not shine through a wall) and scale(sensor,x,z) — what a sensor's range is worth in this much dark. Pair it with `day` for lights-out.
Gives you: `CBZ.fixtures`, `CBZ.fixtureAudit`

### `rest`
bodies USING furniture: claim a place, walk there, take the pose, get up, step clear. CBZ.rest also carries the three load-order repairs that make furniture anchors exist at all — deferred registration, a late re-flush, and a loud count of anchors refused for sharing a coordinate key.
Pulls: `people`
Gives you: `CBZ.rest`, `CBZ.restAudit`, `CBZ.restWatch`, `CBZ.propRegisterSeat`, `CBZ.propSit`, `CBZ.propSleep`

### `rooms`
FURNITURE, and the grammar of a room. CBZ.furnish is the one vocabulary — chair, stool, bench, sofa, bed, desk, table, counter, shelf, locker, lamp — where one call DRAWS the piece at real metric proportions, REGISTERS its sit/sleep anchor and hands back the meshes; CBZ.roomShell stamps a floor and four open-top walls with a doorway, and CBZ.roomFurnish lays out a named program (office, breakroom, bedroom, lounge, mess) and then FLOODS the floor from the door to drop anything nobody could walk to.
Pulls: `look`, `rest`
Gives you: `CBZ.furnish`, `CBZ.roomShell`, `CBZ.roomFurnish`

### `push`
furniture that MOVES when you walk into it. CBZ.pushables.add({parts, mass, leash, stand}) makes a drawn prop a mass on a floor: contact slides it, its collider and its standable top go with it, and the broadphase is dirtied — so the stool you shoved under the vent is really there to climb.
Pulls: `boot`
Gives you: `CBZ.pushables`, `CBZ.pushProp`, `CBZ.pushPropAudit`

### `military`
the shipped military models: fighter jet, bomber, cargo plane, helicopter, tank, truck, and the B-2. Real geometry, not boxes.
Pulls: `look`
Gives you: `CBZ.milModels`, `CBZ.strategicModels`

### `desert`
a desert basin with one city in it: 200 towers on a grid, a park, shelters, dunes, an inland sea, salt flats and a mountain rim. Analytic terrain, so heightAt(x,z) is a pure function.
Pulls: `look`, `green`
Gives you: `CBZ.desertCity`

### `airbase`
a portable military installation: runway, hangars, tower, revetments, and parked aircraft that sit on their wheels because seat() measures the bounding box instead of guessing a gear drop.
Pulls: `look`, `military`
Gives you: `CBZ.airbase`

### `batch`
the two one-time passes that make a real city fabric cheap: static geometry merged into a handful of draw calls, and per-frame matrix recomputation switched off for everything that will never move. CBZ.studio.settle() runs both in order.
Pulls: `boot`
Gives you: `CBZ.batchStaticUnder`, `CBZ.freezeStaticUnder`

### `citycore`
THE REAL CITY FABRIC: cityMakeBuilding, the one mint every shell in Gang City comes from — enterable glass towers with pooled instanced panes, stairs, doors, furnished floors — plus buildTown, the street generator that lays a grid of marked roads, sidewalks, crosswalks, non-overlapping lots, shops with signs and a skyline cluster. Ask for a downtown with CBZ.studio.town(); nothing in it is a stage flat.
Pulls: `look`, `seed`
Gives you: `CBZ.cityMakeBuilding`, `CBZ.buildTown`

### `militaryisland`
the REAL military island from the Gang City map, raised at its authored place (centre -620,-700): fenced perimeter, airstrip with parked fighters and the heavy bomber, cargo apron, helipads, motor pool. Load it, then CBZ.studio.raise('militaryisland') builds it. Same files as `military`, named separately so a page that only wants the MODELS never raises an island by accident.
Pulls: `military`

### `airport`
the REAL civil airport island from the Gang City map (Halloran Field, x -900..290, z -280..40): terminal, gates, tower, aprons and parked airliners. Load it, then CBZ.studio.raise('airport').
Pulls: `look`, `military`, `seed`, `citycore`
Gives you: `CBZ.cityCivilAircraftRayTest`

### `air`
flight for a bomber, a fighter or a transport. Coefficients are DERIVED from cruise speed and max thrust, not tuned by feel, and the autopilot commands bank ANGLE so an aeroplane cannot roll itself into the ground.
Pulls: `boot`
Gives you: `CBZ.airframe`

### `ordnance`
iron bombs, heavy bombs, cluster, rockets and a nuke, with one shared ballistic integrator so the aiming pipper and the bomb cannot disagree, overhead cover, and blast that walks a snapshot so a kill mid-sweep cannot skip the next body.
Pulls: `boot`, `look`
Gives you: `CBZ.ordnance`

### `nukefx`
the researched mushroom: stem, cap, surge, collar, whiteout, and a yield-to-radius model rather than a big orange ball.
Pulls: `look`
Gives you: `CBZ.cityNukeFX`, `CBZ.nukeLethalAt`

### `fx`
the pooled particle, puff, chunk and scorch systems everything violent draws out of. Cheap because it is pooled, so a salvo cannot flood the frame.
Pulls: `look`
Gives you: `CBZ.fx`

### `damage`
what ordnance LOOKS like when it lands on anything: fireball, wall ruin, rebar, ejecta cone, dust, and cityAirstrikeCollapse, the verb that brings a section of a building down. None of it reads a city record any more.
Pulls: `fx`
Gives you: `CBZ.cityBlastCore`, `CBZ.cityAirstrikeCollapse`, `CBZ.cityWallRuin`

### `sound`
the shared audio bus: positional effects, ducking, and the procedural bank, so a page does not ship its own oscillators.
Pulls: `boot`
Gives you: `CBZ.sfx`

### `radar`
a PPI scope: heading-up, sweeping, paint-and-decay, altitude on its own channel, threats drawn hot.
Pulls: `boot`
Gives you: `CBZ.radar`

### `match`
two sides, a clock, halves, a role swap at half time, a kill feed and a score that cannot disagree with the world.
Pulls: `boot`
Gives you: `CBZ.teammatch`

## People, by name

`CBZ.studio.cast(role, {color, variant})` returns the shipped 1.82 m rig,
cast and dressed. Never build a person out of boxes.

Roles: `soldier` · `officer` · `guard` · `security` · `agent` · `muscle` · `thug` · `civilian` · `worker` · `exec` · `medic` · `pilot` · `runner`

## Machines, by name

`CBZ.studio.model(name)` returns shipped geometry, or null when the pack
that owns it is not loaded. `CBZ.studio.fly(kind)` returns the model with a
flight model already attached.

With `military`: `bomber` · `fighter` (alias `jet`) · `cargo` · `heli` · `tank` · `truck` · `b2`

## The rest of the verbs

- `CBZ.studio.join({actors, hurt})`
  declare and BECOME a mode. Until you call this, every shared engine verb declines: no vault, no ledge step, no blast damage, no wall breach. `actors` hands over your roster, `hurt` your kill funnel, so the engine cannot kill somebody your score does not hear about.
- `CBZ.studio.world(name)`
  build a named world. `desert` today.
- `CBZ.studio.town({at, seed, cols, rows, palette})`
  a real downtown: marked streets, sidewalks, crosswalks, shops with signs, and a cluster of enterable glass towers. Returns `.lots`, `.roads`, `.rect` — spawn people on the roads, not on a grid.
- `CBZ.studio.raise(pack)`
  build a real piece of the Gang City map at its authored coordinates. `militaryisland` · `airport`.
- `CBZ.studio.settle(root)`
  the world is finished: merge the static geometry and stop recomputing its matrices. Needs the `batch` pack. Call it ONCE, after the ground and BEFORE the actors — measured at 17 041 draw calls down to 817 on one real downtown. Anything added afterwards stays live.
- `CBZ.studio.prefetch(...packs) / warm(files)`
  fetch without executing. `need()` must run files one at a time (the load order is a contract), which also downloaded them one at a time; preloading first keeps the order and removes the round trips. Measured 911 ms off a 40 ms link. Warm a map from your menu and START stops being a download.
- `CBZ.studio.onProgress(cb)`
  cb({file, done, total, frac}) as each file lands, so a page can draw a real bar instead of three words.
- `CBZ.studio.crowd(n, role, {at})`
  n shipped bodies, placed and parented.
- `CBZ.studio.boom(pos, {radius, power})`
  fireball, blast damage against your roster, building collapse, and attenuated sound. Never grow your own explosion.
- `CBZ.studio.structureAt(x, z, reach)`
  what is standing here: the building record under a point, or null.
- `CBZ.studio.bombsight({kind})`
  the predicted impact, drawn, off the SHARED ballistic integrator.
- `CBZ.studio.chase({groundAt})`
  a smoothed, ground-clamped follow camera.
- `CBZ.studio.controls(kind, {buttons})`
  one surface for keyboard, mouse and touch. `fly` also gets a throttle slider on a phone.
- `CBZ.studio.hud({...})`
  the standard HUD. See the rules below.
- `CBZ.studio.trail({length, color})`
  a contrail, a dust plume, a wake. One draw call.
- `CBZ.studio.engineSound()`
  the noise a machine makes, mapped from throttle and speed.
- `CBZ.studio.alarm(level)`
  one warning voice, cooldown inside it, interval tightening with the level.

## Rules that are not negotiable

**HUD.** Health is always top left, and it is one meter. No emoji anywhere in
HUD space. Never render a keyboard key on a touchscreen: `controls()` and
`hud().prompt()` already decide that from pointer coarseness, so use them and
the question does not arise. Keep the HUD bare. Say danger with
`hud.danger()`, which costs no space.

**Player-facing words.** Fragments, not sentences. No em dashes. Never define a
thing by what it is not.

**Phones are the default target.** Every action must be reachable by thumb.

**Determinism.** Never `Math.random` in a world build. Use `CBZ.seedStream(name)`.

**Never fork.** If you are about to draw a person, a vehicle, a HUD, a camera or
an explosion, stop: ask the studio for it. If it is genuinely missing, the fix
is a new verb in `src/core/studio.js`, not a copy in your page.

