# Everyone is real: what it costs

Every person the game builds now wears a real (Blender) body while they are in
the world: inmates, guards, the warden, the player, pedestrians, cops, survivor
bots, fighters, medics. Before, the 18 nearest people within 28 m were real (8 on
a touch device), drawn only from three lists, and no prison guard was ever real.

How it stays cheap (`src/entities/people.js`, LOD):

- each real person is frustum-culled as one object (one bounding sphere for all
  their meshes); before, every real body drew every frame, on screen or not;
- far or off-screen people are posed less often (every frame to 25 m in view,
  every 2nd to 60 m, every 3rd past that, every 8th out of view);
- bodies are built nearest first, about 8 ms a frame (one at least).

## The jail game (escape mode)

Headless Chrome, the LOD run to rest the way a running game would, same boot, same
camera. Memory is retained JS heap after forced garbage collection.

| | as shipped | everyone real |
|---|---|---|
| rigs in the prison | 156 (117 inmates + warden, 39 guards) | same |
| real people | 12 (inmates only) | 106 (90 inmates, 15 guards, the player) |
| draw calls per frame | 923 | 611 |
| triangles drawn per frame | 1.71M | 1.53M |
| scene update (CPU, per frame) | 9.0 ms | 10.5 ms |
| heap, people off -> all real | | 233 -> 347 MB (+114 MB, ~1.2 MB a person) |
| filling the prison (one-time CPU) | 1.0 s | 2.5-4.2 s, nearest first |

The rigs not yet real are drawn by nobody (in cells, not yet revealed); each
gets a body the moment it is drawn.

## Gang City (same street camera)

| | caps on (18) | everyone real |
|---|---|---|
| real people | 18 | 94 |
| draw calls | 5,171 | 4,210 |
| triangles drawn | 11.19M | 9.90M |
| scene update | 12.5 ms | 16.2 ms |

## Survival island (`disaster.html`, the App Store build)

99 bots plus the player, all real: heap 498 -> 587 MB (+89 MB, ~0.9 MB a person).
One-time fill 2.2 s of CPU.

## Per person

About 45k triangles (34k-62k), 8-10 meshes, 53 bones, about 15 ms of CPU to build on
a quiet machine, about 0.07 ms a frame to pose up close (less far off), about 1 MB
of retained memory. The first real person on screen compiles 12 shader programs
once (82 -> 94 in the jail); nobody after that adds one.

## What was not measured

GPU frame time: the headless browser renders in software (SwiftShader), so
draw calls and triangles are reported instead. Nothing here was measured on an
iPad.
