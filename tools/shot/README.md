# shot: pictures for builders, from one warm browser pool

A builder redrawing an animal needs to see it, often, while it works. Booting a
Chrome per look costs 15-40 s and, with 20 agents doing it at once, freezes the
Mac. The shot service keeps 2-4 headless Chromes warm with frozen game pages,
takes everybody's requests off one queue, and answers a glance in about a second.

## Builders: the one command

```sh
node tools/shot/req.mjs --preset turntable --setup 'species=lion' --wait
# -> prints the contact sheet path; Read it.
```

That shoots your working tree **as it is now**: uncommitted edits and new files
included. Nothing to commit first; your branch and index are not touched. It is
merged onto origin/main so the picture shows your change on today's game.

```sh
node tools/shot/req.mjs --ba --preset turntable --setup 'species=lion' --wait   # origin/main vs you, one sheet
node tools/shot/req.mjs --preset gait    --setup 'species=gray_wolf' --wait     # walk/trot/run, 8 frames per cycle
node tools/shot/req.mjs --preset attack  --setup 'species=bengal_tiger' --wait  # the strike, phase 0..0.87
node tools/shot/req.mjs --preset death   --setup 'species=bison' --wait         # the kill and the ragdoll settling
node tools/shot/req.mjs --preset matchup --setup 'species=gorilla&vs=men&vn=12' --wait
node tools/shot/req.mjs --preset glance  --setup 'species=orca&map=water' --wait  # cheapest: one 3/4 frame
```

Without `--wait` it returns in ~0.1 s with an id: keep working and look later with
`node tools/shot/get.mjs <id>` (instant) or `get.mjs --last`.

A wrong species id comes back in ~0.1 s with the full list of ids.

## Presets (NPC War)

| preset | frames |
|---|---|
| `glance` | one 3/4 frame (the cheapest look) |
| `turntable` | front, side, back, 3/4, top, head close-up, feet close-up |
| `gait` | walk, trot, run x 8 frames across one gait cycle, side view |
| `walk` / `trot` / `run` | one of those rows |
| `attack` | 8 phases of the species' strike (CBZ.creatureStyleFor), side + 3/4 |
| `death` | the kill, then 0.2 .. 4 s of the corpse solver, side + top |
| `matchup` | a fight on the real arena, 0 .. 24 s, wide + hottest-fight cams |

Any preset field can be overridden: `--cams`, `--times`, `--setup`.

## --setup

URL params, `k=v&k=v`:

- `species=<id>` (or `unit=men`), `n=3` (a line abreast), `heading=30` (degrees)
- `pose=idle|walk|trot|run|attack|death|fight` (a list: `pose=walk,run`)
- `speed=5` (m/s, overrides the species' own walk/trot/run), `style=maul` (attack style)
- `vs=<id|men>&vn=20`: a matchup (red = species, blue = vs)
- `stage=studio|map`: studio (grey cyclorama, 1 m grid, 2 m red/white ruler in 0.5 m
  bands, contact shadow, key/fill/rim lights; nothing else in frame) is the default
  for portraits; the real arena is the default for fights. `grid=0`, `ruler=0`.
- `rw/bw/rt/bt`: weapons and training, as on the battle page
- **any other key goes on the page URL** (`map=water`, `blood=0`, and whatever the
  NPC War architecture adds next). A different page URL is a different warm page.

Or a JS snippet (anything that is not a clean `k=v` list), run after spawning, with
`S` = the subject actors, `B` = `window.__battle`, `CBZ`, `THREE`, `spec`:

```sh
node tools/shot/req.mjs --setup 'species=lion' --js 'S[0].group.scale.multiplyScalar(2)' --wait
```

A request with JS gets its page closed afterwards; nobody else sees your mutation.

## Cameras and times

`--cams front,side,back,left,3q,3qb,top,head,feet,wide,hot,orbit:<yawDeg>:<pitchDeg>[:distMul]`
(orbit yaw 0 = the nose, 90 = the right flank). Cameras frame the subject's
measured bounds, so a rabbit and an elephant both fill the frame.

`--times`: sim seconds (death, fight, gait); attack takes a strike phase 0..1;
`cycle:N` = N frames evenly across one gait cycle.

`--size 640x400` is the default, `--big` = 1280x800, `--jpg` for small files.

## Gang City and the other worlds

`--world city|president|escape|survival` (aliases `prison`, `disaster`) boot through the
testbus world table and are driven by `page/world.js`:

```sh
node tools/shot/req.mjs --world city --preset orbit --setup 'at=120,-40' --wait 900
node tools/shot/req.mjs --world president --preset timeline --setup 'cfg_SOME_FLAG=1'
```

- presets: `glance` (chase), `orbit` (chase, 3 orbits, top, first person), `timeline` (0/2/5/10 s)
- setup: `at=x,z` (look point, default the player), `heading=deg`, `dist=m`; every other
  key is a page param (`cfg_FLAG=1`, `seed=7`, `mode=...`), or JS with `S` = `CBZ.player`
- cams: `chase`, `fp`, `top`, `orbit:<yaw>:<pitch>[:dist]`, `at:<x,y,z>:<lx,ly,lz>`
- A CBZ world is heavy: a cold boot is 3-5 min on a loaded Mac (it includes one
  shader-compile render), and a request that steps time (`--times` > 0) uses the page
  up, so the next request reboots it. Still pictures at t=0 reuse the warm world.

## How it is fast

- **No checkouts.** Pages are served straight from `.git` (`gitserve.mjs`: `git
  ls-tree` + one `git cat-file --batch`, blob cache shared by every commit), so 50
  branches cost no worktrees.
- **One boot serves many branches.** A request whose commit changes nothing the page
  loaded reuses a warm page (`warm`). One whose loaded changes are all hot-safe (the
  bestiary's `src/city/wildlife/*.js` species files, which only call
  `CBZ.defineSpecies`, or any file marked `testbus:hot-safe`) is swapped into the
  warm page (`hot`): the page pulls `/@<sha>/<file>`, restages, shoots, and swaps the
  base file back. Only a branch that changes the engine itself gets a page of its
  own (`boot`), which then stays warm for that branch's next request.
- **Frozen worlds.** rAF is off; time moves only through `__battle.advance` or the
  puppet walk, so a frame is a stated moment and an idle warm page costs nothing.
- **Fan-out.** Up to `SHOT_CHROMES` (3, max 4) Chromes, one job each at a time,
  each holding up to `SHOT_PAGES` (3) warm pages.
- **Small frames**, contact sheets composed by canvas in the same Chrome (frames in
  and the sheet out over http, never through a CDP message).

What is shot comes from the game's own calls: bodies from `__battle.restage` (the
species' `build()`), gait from `CBZ.wildlifeRig.animateGait` / `CBZ.animateSwim` /
`CBZ.animChar` (the body is walked along a line at a stated speed), strikes from
`CBZ.predatorPose`, deaths from the page's own damage route and `__battle.advance`.

## Load safety

- No Chrome launch or world boot while load > `SHOT_MAX_LOAD_PER_CORE` (4) x cores
  (held up to 5 min); a second/third Chrome only while load < 3 x cores.
- Fairness: agents are served round robin (whoever was served longest ago first),
  at most `SHOT_PER_AGENT` (2) requests each in flight. `--agent` names you (default:
  your branch).
- Deadlines everywhere: every page call `SHOT_EVAL_MS` (45 s), a request
  `SHOT_JOB_MS` (180 s), a boot `SHOT_BOOT_MS` (150 s). A request that overruns has
  its page closed, so a wedged page cannot hang the service.
- One service per machine (`daemon.lock`); `req.mjs` starts it; it exits after
  `SHOT_IDLE_MIN` (20) idle minutes. The testbus batcher borrows a Chrome from this
  pool when the service is up, so there is one browser pool on the machine.

## Files

- `req.mjs` submit, `get.mjs` read (`--status` for the pool), `daemon.mjs` the service
- `gitserve.mjs` commits over http from the object store
- `page/npcwar.js` the in-page stage/camera/studio (`window.__shot`) for NPC War, `page/world.js` the same for the CBZ worlds, `page/sheet.js` contact sheets
- `lib.mjs` dirs, knobs, presets. State: `~/harness/out/gta6/testbus/shot/`
  (`queue/`, `results/`, `daemon.log`, `status.json`); images `~/harness/out/gta6/shots/<id>/`.

## Measured (2026-10-11, M-series, 8 cores, load 18-24 from other agents)

10 simultaneous turntable requests (7 frames each) from 10 branches, each changing a
different bestiary file:

| | old way: 10 `ba` runs (npcwar-look, 2 subjects), sequential | shot service, cold (no Chrome up) | shot service, warm |
|---|---|---|---|
| wall time | 91 s (8-10 s each) | 27.3 s | 3.8 s |
| per request | 8-10 s, blocking | 23.9-26.9 s (3 parallel boots, then hot swaps of 0.5-1.1 s) | 0.6-3.5 s (work 0.5-1.1 s) |
| frames | 40 (2 x 2 sides x 10) | 70 | 70 |
| Chromes | 10 launched one after another (20 page boots) | 3 | 3 (already up) |
| peak load | 37.3 | 24.1 (from 18.2) | 24.4 (from 23.9) |

A before/after (`--ba`) of an uncommitted species edit on a warm page: 1.4 s. A wrong
species id: answered in ~0.1 s. Gang City cold: ~4.5 min boot + ~3 min first frame
under load 30+; warm stills after that.

## Limits

- The CBZ worlds are slow to boot (minutes) and have no studio stage; NPC War is the
  fast path the service was built for.
- Hot swap re-registers species; the battle caches per-species tuning (`BEAST_TUNE`:
  chase speed off `spd`) on first spawn, so a changed `spd` shows in a gait preset
  only after a reboot (the puppet walk itself reads the new `spd`).
- Each beast wears the battle's thin team collar (it is part of the game's body).
- Aquatic species need `map=water` to be in water; on the dry arena they lie on the floor.
- Gait frames for men use `CBZ.animChar` at the stated speed; attack poses are beasts only.
