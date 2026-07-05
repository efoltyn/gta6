# The visual feedback loop

Two tools close the see-what-you-built loop. Both are zero-dependency Node
scripts driving the pre-installed headless Chromium (SwiftShader WebGL) over
raw CDP; each auto-starts its own dev server on a random port. three.js is
vendored (src/vendor/three.r128.min.js) so everything runs offline.

## tools/studio.mjs — asset photography + animation filmstrips

Boots the real game page, hijacks the renderer into an isolated studio scene,
spawns a subject, shoots it.

    node tools/studio.mjs rig --anim run              # orbit sheet + filmstrip
    node tools/studio.mjs rig --anim punch --frames 12
    node tools/studio.mjs "car:Toyota Prius"          # 12-view orbit sheet
    node tools/studio.mjs cars                        # every ambient car, labeled grid
    node tools/studio.mjs pcars                       # every player-car style
    node tools/studio.mjs rig --anim run --frames 36 --dur 3.3 --video
                                                      # + .webm clip you can watch

Subjects: `rig`, `rig:cop|suit|tank`, `car:<Name>`, `cars`, `pcar:<style>`,
`pcars`, and the escape hatch `expr:<js>` — any expression returning an
Object3D or `{group, rig}` (a rig makes it animatable; set flags on it in the
expr: `r.crouch = true`, `r.aimingPose = true`, `CBZ.deathPose(r, seed)` …).

Anims: idle, walk, run, sprint, punch, heavy, hook, upper, aim, aimwalk,
surrender. Options: `--mode orbit|strip|both`, `--frames`, `--dur`, `--speed`,
`--angles`, `--zoom`, `--night`, `--out`, `--video` (webm via the bundled
ffmpeg — it only speaks mjpeg-in/vp8-out, so no gif/png paths).

Output lands in tools/shots/. The workflow that actually produces quality:
change code → render → LOOK at the png → change again. Every animation in the
two-segment-limb overhaul went through 2-4 filmstrip iterations; the
misfires (superman uppercut, zombie-arm surrender, bear-charge crouch) were
all caught by looking, not by reasoning about angles.

## tools/smoke-play.mjs — the regression gate

Boots the game, presses PLAY, runs the city for N seconds while simulating a
run + a punch, screenshots gameplay, and fails on any console error.

    node tools/smoke-play.mjs 12

Known pre-existing noise (not regressions): a rare seed-dependent
`computeBoundingSphere NaN` warning and one `ProgressEvent` line (a missing
optional asset fetch). Anything else is yours.

## Rig contract cheat-sheet (entities/character.js)

Two-segment limbs: `rig.parts.{ll,rl,la,ra}` are hip/shoulder pivots,
`rig.low.{...}` are the knee/elbow pivots. Knees fold backward only
(rotation.x >= 0), elbows forward only (rotation.x <= 0). `skinSlots.arms/legs`
stay length-2 (upper meshes); lower meshes live in `armsLower/legsLower` —
any flat recolor must paint both. Wrist items (watches, cuffs) mount on the
elbow group, not the shoulder pivot.


## World subjects (photograph things WHERE THEY STAND in the live city)

    node tools/studio.mjs lot:casino            # by lot kind
    node tools/studio.mjs "lot:golden ace"      # by building/shop name substring
    node tools/studio.mjs lot:25,-725           # by coords (nearest lot)
    node tools/studio.mjs at:120,-640,15        # any world point (radius optional)
    node tools/studio.mjs lot:hospital --seed 1337

Boots the game to playing, freezes it, and orbits the real in-world object —
batched shells, glass pools, peds, street context: exactly what a player sees.
Orbit-only (no rig/strip). Slower than asset mode (~4-5 min: SwiftShader pays
for full-city frames) — 6 azimuths + 2 aerials by default (--angles overrides).
The camera SELF-CLEARS: each cell verifies against walls (colliders) and
rooftops (platforms, with headroom) plus a subject-base visibility guard, and
climbs in elevation until the view is clean — orbit cameras in a dense city
otherwise end up inside the neighbours (caught on the first casino sheet).
World sheets write .jpg (a full-city PNG encode OOM-killed the tab).
