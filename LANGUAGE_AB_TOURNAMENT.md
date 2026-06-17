# Gang City language, renderer, and multiplayer A/B tournament

## Decision

Do not rewrite the game because a language is theoretically faster. Make the
current JavaScript game the defending champion and force every alternative to
beat it on the same city, on the same 2019 Intel MacBook Air.

Representative calm browser runs found `2,797` to `5,033` draw calls and
`227` to `344 ms` of render CPU time per frame. The variation itself means the
benchmark trace and camera must be frozen before judging contenders. In one
run, hiding dynamic city actors still left `4,085` calls and hiding the city
root left only `35`. A root census found `13,958` meshes, including about
`6,055` collider refs and `5,025` line-of-sight refs intentionally spared by
the conservative batcher. Static-city render submission is therefore the
largest known problem. Rust or C++ cannot repair thousands of unbatched
Three.js objects from inside a simulation kernel.

Run four independent contests:

1. **JS architecture:** prove how far the current engine can go with batching,
   spatial queries, workers, and typed arrays.
2. **Renderer:** test a current Three.js/WebGPU path and one engine spike
   without changing game logic.
3. **Simulation language:** test JS, Worker JS, AssemblyScript/Wasm,
   Rust/Wasm, and C++/Emscripten on isolated hot kernels.
4. **Native client and multiplayer:** test whether escaping the browser or
   changing network topology produces the large end-to-end win.

No contestant may reduce visible detail, simulated population, physics
behavior, or AI decisions to improve its score.

## Assumptions already challenged

| Assumption | Evidence-backed verdict |
| --- | --- |
| "The Intel Mac is the whole problem" | False. It makes the cost hurt more, but thousands of draw calls and long main-thread simulation steps are game architecture costs. |
| "A faster language fixes the city" | False for the dominant measured render-submission cost. It may win isolated numeric kernels. |
| "Wasm is native speed" | False as a blanket claim. A USENIX SPEC study measured Wasm about `1.45x` to `1.55x` slower than native on average in the tested browsers. |
| "Wasm always beats JavaScript" | False as a blanket claim. The same study found an average Wasm win over JS, but the result was workload-dependent. Test this game's real kernels. |
| "WebGPU fixes draw calls" | False. It can reduce API overhead and unlock modern GPU work, but the scene still needs batching, instancing, and sensible submissions. |
| "TypeScript makes the game faster" | False. TypeScript emits JavaScript; its possible win is safer large-scale refactoring. |
| "A native engine guarantees success" | False. Native removes browser constraints, but a poorly batched native scene can still be slow. |
| "P2P proximity voice scales to a large RP server" | False. Full mesh grows roughly with player pairs; an SFU with selective subscriptions is the serious-server lane. |

## One test contract

Build one versioned benchmark pack before implementing contenders:

- `city-v1.snapshot.json`: player, NPC, car, collider, faction, and world state
  after city startup.
- `city-v1.inputs.json`: a deterministic 120-second trace covering walking,
  driving, a dense intersection, combat, wanted level 5, and a crowd event.
- `city-v1.expected.json`: seeded AI decisions, contacts, damage, deaths,
  routes, and final-state hashes.
- Screenshot checkpoints at `0`, `30`, `60`, `90`, and `120` seconds.
- Network traces for `8`, `16`, `32`, and `64` synthetic players.

The simulation-kernel boundary must use flat numeric buffers. Do not pass
Three.js objects across a JS/Wasm or main-thread/Worker boundary. The same
input buffer and output schema must run unchanged in every kernel contender.

Record results as JSON, commit the raw result, and keep every contender behind
a runtime flag. A rejected experiment must be removable without touching game
behavior.

## Scorecard

Measure after three warm runs and report the median plus worst run:

| Category | Required measurements |
| --- | --- |
| Feel | frame-time p50/p95/p99, 1% low FPS, input-to-visible-motion latency |
| Renderer | render CPU, GPU time where available, draw calls, triangles |
| Simulation | p50/p95 kernel time, boundary-copy time, main-thread time |
| Startup | navigation-to-control, city construction time, Wasm download/compile |
| Correctness | final-state hash, checkpoint divergence, crashes, NaNs |
| Quality | screenshot diffs, visible population, active smart-NPC count |
| Memory | JS heap, Wasm memory, process working set |
| Multiplayer | server tick p95, bytes/player/sec, voice peers, packet loss response |
| Engineering | changed LOC, build/tooling burden, debugging quality |

### Non-negotiable correctness gates

- Exact population and active-AI budgets.
- No missing visual category or lower render distance.
- Physics contacts, damage, and AI outcome hashes remain within documented
  deterministic tolerances.
- No new frame-time spikes above `100 ms`.
- No new browser errors, NaNs, invisible nearby actors, or car overlaps.

### Promotion gates

- **Architecture fix:** promote at `>=15%` end-to-end frame-time improvement.
- **Wasm kernel:** promote only if it is `>=30%` faster than optimized JS and
  Worker JS on the same kernel, boundary overhead is `<10%` of kernel time,
  and end-to-end frame time improves `>=10%`.
- **Renderer/engine:** promote only if it halves render CPU or draw calls and
  improves frame p95 `>=30%` with screenshot parity.
- **Native client:** consider a dual-client/native direction only if the slice
  is `>=2x` browser FPS on this Mac at identical load and preserves the shared
  simulation/network contract.
- **Full rewrite:** prohibited until at least two independent production-sized
  subsystems win their contests and an end-to-end prototype wins by `>=2x`.

## Contest 0: defending champion

Create the reproducible baseline first.

```bash
node tools/harness.js
CBZ_PROFILE=1 CBZ_PROFILE_ONLY=1 CBZ_PROFILE_FRAMES=1200 node tools/harness.js
CBZ_CDP_TIMEOUT_MS=120000 node tools/run-city-browser-profile.mjs calm 300
CBZ_CDP_TIMEOUT_MS=120000 node tools/run-city-browser-profile.mjs wanted5 300
```

Initial targets for the current browser client on this Mac:

- Draw calls: first below `1,000`, then below `500`.
- Calm frame p95: first below `50 ms`, then below `33.3 ms`.
- Main-thread simulation p95: below `16.7 ms`.
- No nearby NPC visibly loading after the player reaches it.

If the current JS architecture reaches a stable `30+ FPS` with frame p95 below
`33.3 ms`, do not rewrite the client. Continue improving the architecture.

## Contest 1: current JS architecture

This lane determines how much of the problem is language-independent.

1. Batch/instance repeated static building and prop meshes by
   geometry/material/visibility cell.
2. Split visible wall geometry from collider/LOS identity: preserve exact
   physics and ray-query objects, but A/B merged render proxies so those
   references do not force thousands of visible draw submissions.
3. Instance repeated character parts while preserving per-character animation
   and appearance data.
4. Stream city cells ahead of movement and keep nearby cells warm; remove
   player-visible construction bursts.
5. Replace remaining whole-world scans with spatial queries.
6. Move compact, numeric background simulation to Workers; keep rendering and
   interactive hero actors on the main thread.
7. Upgrade Three.js separately from all other changes and measure it.

This is the most important lane because every future language and engine still
needs batching, spatial partitioning, streaming, and resolution tiers.

## Contest 2: renderer

Use the exact existing simulation output to feed each renderer:

| Contender | Question |
| --- | --- |
| Current Three.js r128 WebGL | Defending baseline |
| Current Three.js release, WebGL | Does six years of renderer work help without migration? |
| Three.js `WebGPURenderer` | Does WebGPU reduce submission/CPU cost after batching? |
| PlayCanvas or Babylon.js slice | Can an engine renderer handle the same dense block materially better? |

Port one representative block containing buildings, interiors, 40 rich NPCs,
traffic, shadows, and effects. Do not port the whole game. WebGPU loses if it
does not beat a properly batched WebGL baseline; changing APIs alone does not
reduce draw calls.

## Contest 3: simulation languages

Start with one expensive, deterministic production kernel: ped neighbor
selection plus steering, or vehicle collision broadphase plus contact
resolution. Use at least `10x` the current entity count in the microbenchmark
so timing noise does not choose the winner.

| Contender | Assumption being tested |
| --- | --- |
| Optimized JS typed arrays | Modern JS may already be fast enough |
| JS in a Worker | Main-thread relief may matter more than raw throughput |
| AssemblyScript/Wasm | TS-like syntax may provide a low-friction Wasm path |
| Rust/Wasm | Strong data/layout tooling may justify a new kernel language |
| C++/Emscripten/Wasm | Mature Wasm toolchain may win maximum throughput |

Do not test TypeScript as a performance contender: it emits JavaScript. Adopt
it only if its type safety and refactoring value justify a separate migration.

Do not test a toy loop. Each contender must include data transfer, memory
growth, startup compilation, error handling, and integration into one real
city build. Wasm loses if crossing the boundary erases its kernel win.

## Contest 4: native proof

Build one small native city slice, not a rewrite. Rust with Bevy and Godot
native are reasonable contenders because they test two different bets:
code-first ECS/data layout versus an editor-driven engine.

The slice must import the same benchmark snapshot, run the same AI/physics
contract, display the same representative block, and connect to the same
server protocol. A native build is valuable only if escaping browser limits
creates a dramatic end-to-end gain that justifies distribution and porting
cost.

Godot or Unity web export belongs in the renderer contest, not the native
contest. A web export still runs under browser/WebAssembly constraints.

## Contest 5: multiplayer and proximity voice

Language is not the first scaling decision for multiplayer. Authority,
interest management, tick budgets, and voice topology dominate.

The current browser-host model and full-mesh WebRTC voice are appropriate for
small friend groups. Full mesh grows roughly with the square of player count,
so it is not the target architecture for a large RP server.

Test these server/network contenders using recorded movement and combat:

| Players | World model | Voice model |
| --- | --- | --- |
| 8 and 16 | Current elected browser host | Current WebRTC mesh |
| 16 and 32 | Authoritative Node room with interest management | Selective SFU subscriptions |
| 32 and 64 | Authoritative partitioned room | SFU plus proximity selection |

Server promotion gates:

- Fixed simulation tick meets its deadline at p95.
- No client can authoritatively invent damage, money, inventory, or position.
- Per-player state bandwidth stays approximately bounded as room population
  grows outside the interest radius.
- Voice subscriptions are based on proximity and role/radio rules, not every
  possible peer.

Only compare Node, Rust, Go, or another server language after the same
authoritative and interest-managed design exists. Otherwise the test measures
different architectures, not languages.

## Run order and kill rules

1. Freeze the benchmark contract and capture the defending baseline.
2. Run the JS batching/streaming lane until draw calls are below `1,000`.
3. Run the renderer slice against that batched baseline.
4. Run the five-way simulation-kernel contest.
5. Integrate only winning kernels into one experimental browser build.
6. Run the native slice only after the shared simulation contract is stable.
7. Run multiplayer load tests before increasing the advertised server cap.

Kill a contender immediately when it misses correctness, wins only a toy
microbenchmark, requires reduced quality, or cannot produce a meaningful
end-to-end improvement. Keep the raw result so the same idea is not repeatedly
re-litigated without new evidence.

## Likely outcome, stated before testing

- The largest first win will probably come from reducing render submissions
  and smoothing city streaming, not changing language.
- Workers should improve feel when numeric background work leaves the main
  thread, even if total CPU work is unchanged.
- Wasm is likely to win selected dense numeric kernels, but unlikely to justify
  moving Three.js-facing gameplay code.
- A native client may be dramatically faster, but it must win by enough to
  justify a second client and a harder distribution story.
- A serious RP server will need authoritative simulation, interest management,
  and SFU-style voice before it needs a different server language.

## Primary references

- WebAssembly concepts and execution model:
  https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Concepts
- Figma's production Wasm migration:
  https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/
- USENIX study comparing Wasm, native, and JavaScript:
  https://www.usenix.org/conference/atc19/presentation/jangda
- Emscripten optimization:
  https://emscripten.org/docs/optimizing/Optimizing-Code.html
- Emscripten pthreads and deployment requirements:
  https://emscripten.org/docs/porting/pthreads.html
- Rust/Wasm time profiling:
  https://rustwasm.github.io/book/reference/time-profiling.html
- AssemblyScript scope and tradeoffs:
  https://www.assemblyscript.org/introduction.html
- Three.js `InstancedMesh`:
  https://threejs.org/docs/api/en/objects/InstancedMesh.html
- Three.js `WebGPURenderer`:
  https://threejs.org/manual/en/webgpurenderer.html
- Web Workers:
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- `SharedArrayBuffer` security requirements:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- Godot web export limitations:
  https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- Unity web technical limitations:
  https://docs.unity3d.com/Manual/webgl-technical-overview.html
- LiveKit SFU architecture:
  https://docs.livekit.io/reference/internals/livekit-sfu/
- LiveKit selective subscription:
  https://docs.livekit.io/home/client/tracks/subscribe/
- Colyseus authoritative state synchronization:
  https://docs.colyseus.io/state
- FiveM OneSync:
  https://docs.fivem.net/docs/scripting-reference/onesync/
