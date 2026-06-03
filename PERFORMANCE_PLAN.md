# Cell Block Z mass-population architecture

The engine now treats population, simulation resolution, and render resolution
as separate budgets. "Infinite NPCs" is not literal: memory and initialization
remain finite. The useful target is bounded per-frame work as population grows.

## Implemented

### Hero NPCs
- Named and procedural rich NPCs keep the full social/combat brain.
- Rich AI neighbor queries use `systems/npcgrid.js`.
- Rich bodies use distance render LOD: distant logic continues numerically
  while full mesh groups disappear unless gameplay-important.

### Ambient population
- `entities/ambientstate.js` stores ambient rows as typed-array struct-of-arrays.
- `MASS_CROWD` is total ambient population. `CROWD_RIG_CAP` defaults to `1600`;
  adaptive quality promotes at most `220..1000` close rigs regardless of total.
- Hidden movement is a route segment: start position/time, destination/time,
  speed, and portal transition. It advances analytically when queried.
- Close rigs use fixed `20 Hz` steering ticks and interpolated render poses.
- Shared flow vectors can drive evacuation, patrol pressure, riots, or armies.
- Nearby crowds use local grid separation. Dense doorway ORCA/PBD remains a
  targeted future refinement, not a global per-agent cost.

### Rendering
- Close ambient bodies are seven `InstancedMesh` parts: seven crowd draw calls.
- Medium aerial view is one `THREE.Points` upload capped by
  `SIM_OVERVIEW_BUDGET` (default `12000`).
- High aerial view is one density-field `THREE.Points` draw. Density cells are
  maintained lazily, so upload cost is proportional to cell count, not people.
- `P` toggles the old matrix-box aerial renderer for A/B diagnostics only.

### Worker society
- `workers/crowd-worker.js` keeps compact social memory, relationships, mood,
  permanent fact bits, and a seeded priority queue.
- Events include rumors, deals, fights, injuries, schedule changes, and faction
  actions. Large skips jump between meaningful events instead of frame-stepping.
- Zone hunger, unrest, and faction pressure use continuous-time relaxation.
- `SharedArrayBuffer` double-buffered position snapshots activate only when
  `crossOriginIsolated` is available. A transferable `ArrayBuffer` fallback
  keeps ordinary local hosting functional.

### Strategic layer
- `B` enters bird's-eye view. `+/-` selects `1x`, `4x`, `16x`, or `64x`.
- Medium altitude shows individuals; high altitude shows density cells.
- Flow guides and zone overlays communicate population movement, unrest,
  faction pressure, injuries, conflicts, and queued events.

## Measured smoke tests

Headless Chrome measurements are directional because the legacy prison world
still contributes hundreds of draws and CI-style frame pacing is noisy.

| Load | Result |
| --- | --- |
| `900` ambient | Close rigs bounded; medium GPU points; high density cells; worker consequences advance at `64x`. |
| `20,000` ambient | Close: `220` rigs, crowd simulation about `0.6 ms`, rig upload about `0.3 ms`. High view: `93` cells, one crowd draw call, density upload rounded to `0 ms`. |
| `100,000` ambient | Initializes and runs without runtime errors. High view: zero close rigs, `93` cells, one crowd draw call, density upload about `0.1 ms`. Startup took about `30s`, so this is a stress proof, not a polished default. |

## Next engineering boundary

1. Lazily construct ambient chunks so `100,000+` startup is not eager.
2. Serve COOP/COEP headers in production and verify the `SharedArrayBuffer`
   path under cross-origin isolation.
3. Partition chunks across a worker pool with exclusive write ownership and
   neighbor snapshot reads. The current implementation uses one worker.
4. Add targeted doorway/battle ORCA or position-based dynamics only where
   local density requires it.
5. Expand distant armies into density/velocity fields, refining individuals
   only near the player or camera.
6. Add optional WebGPU compute after CPU chunk simulation is stable. Keep the
   CPU path because WebGPU is not universally available.
7. Reduce the legacy static prison draw count; the ambient tier is no longer
   the dominant high-altitude cost.

## Primary references

- Three.js `InstancedMesh`: https://threejs.org/docs/#api/en/objects/InstancedMesh
- Three.js `Points`: https://threejs.org/docs/pages/Points.html
- Three.js `BufferGeometry`: https://threejs.org/docs/pages/BufferGeometry.html
- Fixed timestep and interpolation: https://www.gafferongames.com/post/fix_your_timestep/
- ORCA local collision avoidance: https://gamma.cs.unc.edu/ORCA/
- Hierarchical pathfinding: https://webdocs.cs.ualberta.ca/~mmueller/ps/hpastar.pdf
- Shared memory requirements: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- Web workers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- WebGPU API and compute pipelines: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
