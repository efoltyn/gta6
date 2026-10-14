# The lab: a tiny real world, booted in well under a second

A KIT is a small scenario built from INGREDIENTS (a person, a chair, a car, a
building, a gun, the player), running the game's real systems: the shipped
rig on CBZ.moves with a CBZ.brain, furniture.js chairs on pushables.js,
physics.js under the player, actorweapons.js guns, cityMakeBuilding shells.
The page loads only the scripts the kit needs, not index.html's 729.

## The one-line commands

```sh
node tools/lab/run.mjs --kit person-chair                  # boot + run + the kit's verdict (numbers, no pictures)
node tools/lab/run.mjs --kit standoff --params 'role=cop&dist=4' -v      # + the event timeline
node tools/lab/run.mjs --kit car-chair --frames 0,1,2 --cam 3q,side      # + frames on disk (an at:x,y,z:lx,ly,lz cam keeps its commas)
node tools/lab/run.mjs --all --keep                         # every kit; --keep reuses one Chrome (~0.1-0.7 s a kit)
node tools/shot/req.mjs --preset lab --setup 'kit=person-chair' --wait   # a contact sheet across the run + the probe, via the shot pool
node tools/testbus/submit.mjs --probe "tools/probes/lab.mjs --kit standoff --params role=gang"   # numbers on the bus
node tools/lab/eval.mjs --kit standoff --at 1.5 --js 'return W.get("target").state()'           # poke at a live kit
node tools/lab/deps.mjs --kit building                      # which scripts a kit loads, and why each one
node tools/lab/check.mjs                                    # node-only ratchet: manifest fresh, lists in step, kits resolve
```

By hand in a browser: `lab.html?kit=person-chair&live=1&cam=3q` (any static server at the repo root).

## Kits

| kit | what happens | params |
|---|---|---|
| `person-chair` | an NPC walks to a loose chair, sits (CBZ.rest -> propSit -> the moves_posture sequencer), stands, walks off; the player walks into the chair (it slides), backs off, sprints into it (it tips) | `role`, `sit` (s seated) |
| `standoff` | a gunman (NPC or the player) draws and levels a pistol at a person; the target's brain perceives it and picks hands up / kneel / cower / flee / cover / draw back | `role` civilian/gang/cop/guard/inmate, `gunman` npc/player, `dist`, `nerve`, `targetGun`, `lower` |
| `car-chair` | a real car (cityMakeCar + cardyn.js) drives into a loose chair | `speed`, `offset`, `chair`, `model`, `brakeAt` |
| `building` | one facade style on a lot with real footway, kerb and road (streetKit); the probe measures any spill past the lot line | `style`, `lot=WxD`, `storeys`, `door`, `setback`, `retail`, `fit=0` (the pre-43abc8af sizing) |
| `window-break` | a real building (city mode); N of its windows shot (`cityShatterRay`, a round) or punched (two swings); the probe looks through each hole from the street: what stands in it (object, material, colour, depth behind the glass), SLAB (a flat thing < 0.6 m in: the owner's grey slab), room seen, teeth left in the frame, glass pieces | `style`, `floor` (storey), `how` shoot/punch, `n`, `side`, `retail`, `storeys`, `x`/`z` (lot centre, default 40,60) |
| `stair-drop` | the player on an upper floor runs at the balustrade guarding an open stair well and jumps it: the Executive Mansion's grand stair (`CBZ.cityGrandStair`) or the city's service core (`cityStairCore`); the probe prints y every 0.1 s and fails a body left standing on a rail's collider in the air (the 2026-10-14 "standing on air" bug) | `stair` grand/core, `how` jump/walk, `x` (grand: metres from the well's west edge, default 3.5 = beside the flight's balustrade), `run` 0 = walk, `storeys` |
| `touch-fire` | the phone's FIRE button (#tfire) pressed with a real TouchEvent after a first finger arms the touch layer; unarmed it must throw a blow (CBZ.verbs.strike), armed it must fire a round | `mode` city/escape, `arm` fists/gun/holstered, `view` tp/fp |
| `detain` | a man is cuffed and taken in on the real pipeline (city/restrain.js, CBZ.verbs, city/custody.js, city/boarding.js, mode city): the player's collar + Radio in (a cruiser pulls up, back seat, drives off), an officer's arrest, or the precinct desk (walked through a door). The camera is the player's eyes on him the whole way; FAIL if the body ever stops being drawn in view | `flow` player/officer/desk, `eyes` stare/free, `car=0` (no unit: walked off) |
| `leave` | a person in a room with one door (a real leaf on `CBZ.bodyDoors`) and the player watching from the near wall; he says his line and is handed to `CBZ.leave` (systems/leave.js): he walks through the door and round the corner and is removed only when nobody can see him. The probe reports metres walked, when the door opened, through the door at, despawned at, and IN VIEW AT DESPAWN measured by the kit itself (its own frustum + a segment test against its own walls and leaf) | `route` door/away, `look` 0 = the player turns his back at 3 s |
| `dismiss` | a crewman follows the player beside a partner with his pistol out; at `at` s he is let go through `CBZ.brain.dismiss` (or `mode=legacy`, the old hand-written field clears); the probe reports, over 10 s, the name over his head, seconds crouched / cowering / aiming, heading turned (deg, deg/m) and metres to home | `mode` brain/legacy, `at`, `home` "x,z", `line` |
| `football` | the President's military aide carries the nuclear football (city/warroom.js's case on `CBZ.handCarry`): stand, walk, turn, run, stop, then he raises it flat and opens the lid; the probe gives the case's tilt off plumb per gait, its clearance off the thigh and its drawn size | `carry` new/old (old = the pre-fix hand-socket weld), `open` (s) |
| `suit-studio` | suited bodies of several builds in a row (CBZ.human.build + CBZ.human.dress, posed by animChar): the jacket's shoulders, sleeve heads and collar; `--ba` shoots origin/main through this branch's lab | `outfit` (catalog id), `arms` rest/up/aim/walk, `builds` (m-average,f-slim,...), `focus` (one body), `crop=top`, `hide` jacket,caps,chest,collar,arms |
| `car-enter-drive` | the disaster island (the real `buildDisasterArena` + `world/island_vehicles.js`): the player stands at a real island car's door, `Drive` (`CBZ.islandCarDrive`, what [E] / the pill calls), a key-holding autopilot drives it `dist` m down its kerb lane on the real chassis (vehicles.js order 11, opened by `CBZ.VEHICLE_MODES`), brakes, `CBZ.seatExit`; probe: armed, entered, metres, top speed, lane error, wall hits, exit gap, feet on the ground | `dist` (100), `speed` (m/s, 14) |
| `heli-roof` | the island's helipad tower: walk from the street through the lobby to the lift, `Call`, `Up`, out on the roof, up the helipad stair, across the deck, `Board`, then the real flight keys: Space (collective) `climb` s, hands off `hover` s, Ctrl down onto the deck; probe: each leg's time and height, climb, hover wander, landing on the deck and off the H, airframe hp | `climb` (s, 3), `hover` (s, 4) |
| `damage-fairness` | the player stood at 0 / 5 / 15 / 40 / 100 m from each disaster's hazard (lava, pyroclastic flow, crater, EF0/EF2 tornado, lightning, meteor impact + airburst, volcanic bomb, burning tree, gas fire, downed line, a collapsing 20x8 block) plus shelter rows (in a car, indoors, behind a wall, flying), each 3 s, on the OLD law and on `CBZ.disasterHurt` (systems/disasterhurt.js): hp a second (or hp for a one-shot) and who dies. OK when every hazard costs < 1 hp at its far distance, the mistakes (stood in lava, ground zero, inside the collapse) still kill, shelter costs 0, and the i-frames and regen hold | `sample` (s a case) |
| `hurricane` | a coast town (3 real city shells, the game's palms + broadleaf trees, 5 parked cars, 3 moored dinghies, signs, street lamps, a pier) under a `systems/hurricane.js` storm; the observer stands where the eye passes. The probe gives the surge peak, the observer's phase sequence (outer-bands>eyewall>eye>back-eyewall), wind reversal, trees bent/down, palms topped, roofs peeling/stripped + sheets, windows blown, debris launched/flying/down, signs, districts dark, boats loose/beached, cars shoved/floated, and the storm tick's frame cost (ms) | `cat` 1..5, `offset` (track offset, m), `bearing` (deg, 180 = from the sea), `style` |
| `meteor` | systems/meteor.js on a tiny island of its own (rolling terrain, ~800 trees, 18 glazed houses, 27 cars, in the survival arena's record shapes): one body on ground zero, the observer (camera = listener) `obs` m east. The probe: crater size, windows broken by distance band, trees down / stripped / leaning, cars pushed / rolled, houses hit / gutted, the shock's arrival delay against slant/c, the meteor tick's and the sim step's frame cost | `event` airburst/tunguska/impact/shower, `obs` (m, default 150), `alt` |
| `flood-valley` | the flash flood (systems/flashflood.js, the routed shallow-water solve) on a 2% valley: river + floodplain street, four houses with porous ground floors, six parked cars (street, bank, hill), a road underpass, manholes, and a road bridge on an embankment. Warning, event, then the horn and the aftermath. The probe gives front speed (stations down the river + the solver's leading-edge celerity), max depth, cars stalled/floated/swept (the hill car must stay dry), bridge jam/blockage/load/failure, rooms flooded, lids blown, silt area, tide marks and ms per frame | `volume` (m3), `inflow` (river share), `cap` (bridge kN, 0 = default), `warn`, `active` |
| `chair-tip` | one loose chair knocked over through pushables' own tip: the smallest smoke test | |
| `empty` | the bare lab world | |

Every kit takes `seed=` (default 1) and `dt=` (default 1/60). Unknown params pass through to the kit.

## Writing a kit (a few lines)

`src/lab/kits/<name>.js`:

```js
CBZ.lab.kit("chair-push", {
  uses: ["person", "chair"],
  duration: 6,
  setup: function (W, P) {
    W.add("chair", { name: "chair", at: [0, 0] });
    W.add("person", { name: "bob", at: [0, -4], role: P.role || "civilian" });
  },
  script: function (W) { return [[0.5, function () { W.get("bob").walkTo(0, 3); }, "bob walks through the chair"]]; },
  probe: function (W) { const c = W.get("chair").state(); return { ok: c.moved > 0.1, summary: "chair moved " + c.moved + " m" }; },
});
```

Ingredients (`src/lab/ingredients/*.js`) declare the game files/symbols they need and a `make(W, opts)`
returning a handle with `state()` and `watch` (sampled values; every change becomes an event with its time).
Handles: person `walkTo sit stand draw holster aimAt lower say pose response employ follow dismiss dismissLegacy label`; chair `pos moved tipped`;
player `walkTo(x,z,{sprint}) stop hold`; gun `draw holster aimAt lower muzzle`; car `drive brake coast`;
street / building (see their headers). `W.add / W.get / W.at(t, fn) / W.every(fn) / W.event / W.watch`.

`window.__lab`: `step(n) run(s) runTo(t) state() events() probe() capture(cam, w, h, mime) boot`.
Cams: `3q side front back top wide close follow:<name> orbit:<yaw>:<pitch>[:distMul] at:<x,y,z>:<lx,ly,lz>`.

## How it loads only what a kit needs

- `tools/lab/deps.mjs` tokenizes every `src/**/*.js` (comments, strings, template literals, regex) and records
  what each file DEFINES (`CBZ.x =`, `||=`, `Object.assign(CBZ, {..})`, `defineProperty`, namespace members
  through aliases) and READS. A read covered by a feature test of the same symbol in its own function or an
  enclosing one (`if (!CBZ.x) return`, `CBZ.x && ..`, `typeof`, `?.`, `== null`, identity compares) is not an
  edge. Reads at load time (outside every function, or inside an IIFE) are always followed; runtime reads are
  followed to the kit's `depth` (default 1). Order is index.html's.
- The graph is `src/lab/deps.json` (committed; rebuilt incrementally, ~20 ms warm, by run.mjs, req.mjs and
  check.mjs). `src/lab/closure.js` resolves it, the same code in node and in the page, so `?need=gore` or
  `?file=src/x.js` on the URL works without a build. Globs work in `files` (`src/city/facades/*.js`).
- The page loads a PRELUDE (three, the real config.js, seed.js, microboot as the fallback floor, the lab files),
  the traced closure, then core/loop.js last (it sorts the frame registry and owns CBZ.stepSim), then the kit.
- OVERRIDES in deps.mjs is for what static analysis misses. It is empty: the scanner learned the patterns instead.

## What the lab stands in for (stubs)

- `src/lab/labworld.js`: `CBZ.scene / camera / canvas`, a LAZY `CBZ.renderer` (a getter: creating a WebGL
  context under SwiftShader measured 3.8 s on a loaded box, so a numbers-only run never makes one), the floor
  (y = 0, the engine's own default ground), microboot's sky + sun + hemi, `CBZ.cam` (the record physics.js reads
  for W's direction; camera.js is not loaded), and a body-less observer `CBZ.player` when no kit adds the player
  (pushables only works within 8 m of the player). A seeded `Math.random`.
- microboot's collider registry and resolver count as provided (`CBZ.lab.MICRO_PROVIDES`), the same records on the
  same array; physics.js comes only when a kit names it (the player ingredient).
- person.js: the brain EXECUTOR (intent -> target/speed/pose flags), the per-frame mover (CBZ.moves.step,
  CBZ.collide, animChar), and the standoff's threat record. "Is it on me" is the game's gunpoint cone
  (city/peds.js: 11 m, dot > 0.66 on the gunman's facing); the barrel line is measured too (`aim.barrelMiss`).
- car.js: `CBZ.city.arena = {root, roads: []}` (cityMakeCar parents to it) and a cruise controller in place of
  the player's drive loop (no camera/audio/skids).
- street.js: the lot pad is plain grey, not the city's painted ground.

## Measured (2026-10-14, M-series Mac, load average 38-48 from other agents, headless Chrome `--use-angle=swiftshader`)

| kit | scripts (of 729) | boot, fresh Chrome profile | boot, warm Chrome (in page / wall) | sim |
|---|---|---|---|---|
| empty | 10 | 75 ms | 51 / 95 ms | 1 s in 3 ms |
| chair-tip | 15 | 103 ms | 43 / 99 ms | 3 s in 6 ms |
| car-chair | 24 | 576 ms | 359 / 430 ms | 5 s in 18 ms |
| person-chair | 30 | 166 ms | 119 / 198 ms | 22 s in 57 ms |
| standoff | 48 | 149 ms | 155 / 301 ms | 9 s in 51 ms |
| building | 49 | 5.9 s (first, cold HTTP cache) | 446-648 / 581-728 ms (setup ~500 ms is the shell itself) | 0.5 s in 18 ms |

Chrome launch ~0.8 s. A frame costs ~1-3 s the first time (WebGL context + shader compile under SwiftShader),
then tens of ms. The shot-pool request above: 8 frames + probe in 17.4 s including Chrome launch and boot.
