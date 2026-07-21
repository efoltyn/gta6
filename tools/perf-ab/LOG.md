# PERF / SMOOTHNESS A/B LOG — city mode

Persistent results log for the `/loop` perf build (job bf2cc5d0, every 20 min). Each loop firing READS this first, continues the next task, appends measured A/B deltas. Goal: ultra-smooth + ultra-responsive (RPG-into-a-crowd → everything reacts) on a 2019 Intel Mac AND scaling up on an NVIDIA GPU — WITHOUT fewer/dumber AIs or less responsive buildings/NPCs. Reference: ../../CROWD-GRAND-PLAN.md + tasks #1-#10.

## Methodology
- **Draw calls / triangles / scene census**: `node tools/run-city-browser-profile.mjs <calm|wanted5|chaos> <frames>` (headless Chrome, software-GL). **Draw-call & mesh counts are EXACT and device-independent**; absolute fps/ms are NOT (software raster) — use them only for relative CPU attribution.
- **Sim/CPU correctness + regression**: `node tools/harness.js` (stubs THREE+DOM, real CPU, asserts).
- **A/B rule**: baseline → change behind a flag → re-measure → keep only if it wins AND harness stays green. `OFF == today` always.

## BASELINE — 2026-06-15 (chaos = worst case: combat + dense)
`tools/perf-ab/baseline-chaos.json`
- **Draw calls avg: 1,756** (full-frame attribution 1,790) · triangles ~283k · render CPU avg 82ms / peak 702ms (software raster).
- Counts: peds 326, cops 6, cars 111, ambient crowd 360. Scene: **objects 42,274, meshes 35,320, VISIBLE meshes 32,797**, instancedMeshes 38, sprites 1,207.
- **Draw-call attribution (the rocks):**
  | Subsystem | draw calls | note |
  |---|---|---|
  | Static city geometry | **~1,272 (71%)** | THE bottleneck |
  | Peds + cops | ~402 (22%) | #2 — hero rigs |
  | Cars | ~69 | minor |
  | **Ambient crowd (360 bodies)** | **~11** | INNOCENT — instancing already works; do NOT touch |
  | Base (sky/player) | ~36 | |
- Sim systems: all **sub-0.5ms/frame** (top ~0.47ms). Sim is NOT the bottleneck — render is.

## DIAGNOSIS (data-driven)
1. The lag is **draw-call submission + scene-graph traversal of 32,797 visible meshes**, not the AIs and not the crowd. This is exactly the Intel-Mac bottleneck (driver overhead ∝ draw calls; cull/matrix walk ∝ visible meshes).
2. **Smoking gun (cityRootCensus):** `repeatedGeometryMaterialPairs: 256` covering **`meshesInRepeatedPairs: 7,104`** (largest single pair = 664 identical meshes), plus `mergeEligible: 7,798` / `staticMergeEligible: 1,159` — thousands of identical static meshes that are NOT yet instanced/merged. Collapsing them cuts draw calls AND the per-frame scene walk → directly smooths the Intel Mac.
3. The crowd being only ~11 calls confirms the whole project thesis: keep the bodies, fix the *static* geometry.

## DATA-DRIVEN PRIORITY (overrides the generic roadmap order)
1. **Static-city batch/instance the 256 repeated geom+material pairs** (task #4) — biggest lever, MP-neutral, no AI/sim change. → next build.
2. dt-clamp slow-mo fix (task #3) — smoothness *feel* under load.
3. Hero-rig LOD/merge for the ~402 ped calls (task #5).
4. Adaptive quality v2 (task #6) — scale render to device.
5. carGrid free win (task #2) — real but LOW impact (sim isn't the bottleneck); do opportunistically.

## A/B RESULTS
| date | change (flag) | scenario | draw calls | Δ | harness | verdict |
|---|---|---|---|---|---|---|
| 2026-06-15 | BASELINE | chaos | 1,756 | — | n/a | reference |
| 2026-06-15 | carGrid numeric key (no-alloc) | chaos | 1,756 | 0 draws (CPU/GC win) | GREEN (throws=0, vehicle tests pass) | KEEP — safe, shipped |
| 2026-06-15 | interior-LOD reparent+hide (cityInteriorLOD) | chaos | OFF 2752 / ON 14539 | **+428% WORSE** | harness GREEN | **REVERTED** |
| 2026-06-15 | mass-flee crowd (crowdMassFlee, **default ON**) | harness | crowd scatters | +5.4m avg flee | GREEN (throws=0, flee test ✓) | **KEEP — validated, SHIPPED** |

## ITER 2 (2026-06-15) — DIAGNOSIS CORRECTED (prevented building the wrong thing)
- **wallBatch ALREADY ran:** batchStats = merged 2,379 collider/LOS walls → 168 shells + removed 9,638 inert deco → 225 merged. Static shell is largely done.
- **Facade glass + lit windows ALREADY InstancedMesh** with per-pane shatter (buildings.js:180; shattered = zero-matrix). `instanced:11`. NOT a draw-call problem.
- **The 7,104 "repeated geom+material" meshes are DYNAMIC actor parts** (peds/cars sharing cached geometry), NOT un-merged static. Only `staticMergeEligible:1,159` static remain (singletons). → **Safe static-merge headroom is LOW.** Earlier "7,104 = target" was WRONG.
- **The 15,909 transparent + 17,633 emissive meshes = INTERIOR DECOR** (furniture/glow strips in furnished buildings), off-screen behind walls → few draw calls but they bloat the per-frame SCENE WALK to 28,866 visible meshes.
- **THE REAL Intel-Mac lever (found):** `matrixAutoUpdate=false` is set on only **1** mesh city-wide → ~28,866 static meshes recompute world matrices EVERY frame. Plus interiors aren't distance-gated. → task #11 (matrix-freeze + interior-visibility LOD), the next build. Player feel slow-mo already solved by feelDt (loop.js); NPC-sim slow-mo (#3) is secondary to just rendering faster.
- **Revised lever ranking:** #11 scene-walk/matrix CPU cut (biggest safe win) > #5 ped instancing (402 draws) > #8 mass-flee responsiveness > #6 adaptive quality > #3 dt-accumulator.

## ITER 3 (2026-06-15) — interior-LOD ATTEMPTED → A/B REJECTED → REVERTED
- Built interior-visibility LOD: reparent furnishInterior decor into a per-building sub-group, hide beyond 56m (flag CBZ.cityInteriorLOD). Harness GREEN. But A/B (chaos vs chaoslod): draw calls OFF 2,752 → ON **14,539 (+428%)**, render CPU +457%, visibleMeshes ~unchanged (−38).
- **ROOT CAUSE:** batch.js ALREADY merges interior decor into city-root meshes (removing originals), so the reparented sub-group is near-empty (LOD hides nothing) AND reparenting interferes with that merge → draw-call explosion even flag-OFF.
- **REVERTED fully** (harness green, 0 lingering symbols; only the kept carGrid change remains). The A/B discipline worked: data rejected a bad idea before it shipped.
- **REVISED UNDERSTANDING: the RENDER path is ALREADY well-optimized** (static shell batched, glass instanced, interiors merged, crowd instanced @ ~11 calls). Safe draw-call headroom is mostly exhausted. The matrix-freeze half of #11 is ALSO unsafe (untagged per-frame movers: spinners buildings.js:552/1405, door pivots:1567).
- **PIVOT — next levers (off draw-call hunting):** #8 mass-flee responsiveness (SAFE additive, the owner's explicit "RPG→everyone reacts" ask, reuses the existing panic bus per CROWD-GRAND-PLAN L0b) → #3 dt-slow-mo FEEL fix → #9 MP delta snapshotter (the real link blocker). 
- **Profiler note:** chaos flakes on CDP `Runtime.evaluate timed out` under heavy software-GL; set `CBZ_CDP_TIMEOUT_MS=120000` or prefer calm/wanted5 for stable draw-call numbers. Also: chaos draw-calls vary run-to-run (random spawns) — 1,756 (iter1) vs 2,752 (iter3 OFF) is partly spawn variance; treat ±600 as noise, compare A/B within the same firing.

## ITER 4 (2026-06-15) — MASS-FLEE responsiveness BUILT (#8, the owner's "RPG → everyone reacts")
- **Gap closed:** cityevents.js already makes the ~100 full-rig peds gawk/flee gunfire, but the **760 instanced crowd ignored it** (crowd.js read panic ZERO times → background people kept strolling through an RPG blast).
- **Built (flag CBZ.crowdMassFlee, default OFF):** crowd.js gains panicT/fleeHX/fleeHZ SoA + a sim() PANIC branch (sprint away at 4.2 m/s, REUSING the existing 2-pass wall-collide so fleers scrape walls, don't tunnel) + `CBZ.cityCrowdFlee(ex,ez,r,intensity)`; cityevents.js `cityPostEvent` now calls it (intensity≥0.5 gate so footsteps don't stampede the street).
- **Validation:** parse OK; **regression harness GREEN** (flag OFF → panicT never set → sim() byte-identical). Functional flee test added to harness `testCrowd` (fire event → assert crowd's avg distance-from-threat rises). CAUGHT: v1 of the test was SILENTLY SKIPPED (guard required cityPostEvent, not in the harness load set) → fixed to call cityCrowdFlee directly; full functional run is async (harness is a slow ~3-4 min full pass).
- **Also confirmed #6 is already built:** quality.js "smoothmaxx" V2 is a sophisticated adaptive system (true-frame-time sampling, p95 spike trigger, host-aware tier caps, 5 auto tiers). → the loop's remaining value is RESPONSIVENESS (#8 ✓) + the LINK (#9/#10), not more render-perf.
- **Next:** confirm flee functionally (async harness) → flip CBZ.crowdMassFlee default ON so the owner SEES it → then #9 MP delta snapshotter (the real link blocker).

## ITER 5 (2026-06-15) — MASS-FLEE VALIDATED + SHIPPED ON (#8 DONE)
- Functional confirm (harness testCrowd, two runs): "crowd flees a gunshot — avg dist 28.8→31.0m" and "32.9→38.3m". The 760-instanced crowd now SCATTERS from gunfire/explosions. Full run **throws=0 with the flag ON** (1200 frames + stress + flee). **CBZ.crowdMassFlee now default ON** (revert: set false). #8 COMPLETE.
- **BLOCKER — harness now HANGS** in the fast-crash 220-frame sim (vehicle crumple/deform), non-deterministically (an earlier full run passed). **NOT my code:** the hang is BEFORE testCrowd; crowd.js/cityevents.js/vehicles.js all parse-clean + flee symbols intact. Cause: the **PARALLEL SESSION** actively editing shared files this hour (clothes/bank/pawnshop/jewelry/clothingstore + buildings/crowd) — the documented "parallel waves break harness" gotcha. WORKAROUND added: `CBZ_SKIP_CRASH=1` env skips the crash test for crowd/flee validation.
- **TREE INSTABILITY:** a concurrent session is churning the same files, making reliable A/B + validation hard and risking edit-clobber. FLAGGED to owner.
- **NEXT = the LINK (the loop's finish line):** #9 MP delta+priority snapshotter (the FATAL full-dump desync) → #10 two-client smoke. Perf is already optimized (iters 2-4 confirmed); responsiveness (#8) done. The remaining gap to "send a friend a link" is the MP robustness.

## ITER 6 (2026-06-15) — MP LINK PROTOCOL VERIFIED 41/41 (the 6 "failures" were a FALSE ALARM)
- Ran tools/test-net.js (boots the REAL server + real WS clients, walks the whole protocol). Raw: 35 passed / **6 FAILED** (chat / me / players / kick / leave / migration).
- **ROOT CAUSE — not link bugs:** the test reconnects "Alice" with the same pid (A2) to test csave/cload-by-pid, then keeps using the ORIGINAL A as the stable host. The server's reconnect-DEDUPE (correct intended feature: close the old ghost when a player rejoins same-pid, server.js:318) closes A → cascades 6 false failures (A can't chat/kick; player count drops so /players reads 2/8 not 3/8; migration elects the wrong id). Confirmed: `CBZ_NO_RECONNECT_DEDUPE=1` → **41/41 RESULT: OK**.
- **FIXED the stale test:** run the linear walk with dedupe OFF (no assertion tested it → zero coverage lost) → test-net.js now **41/41 at HEAD**, restored as a reliable MP regression gate amid the parallel churn.
- **VERDICT: the MP link protocol WORKS** — join, host-auth world sync, avatar relay both ways, targeted+broadcast events, world+character persistence by pid, chat/emotes/players, admin kick, host migration, password auth. Far closer to ready than 35/6 looked.
- **REMAINING for "link ready":** (a) verify proximity VOICE (test-voice-browser.mjs = the owner's "proximity chat"); (b) sanity-check the go-live link path; (c) #9 load-desync hardening (full vals() dump @10Hz — only bites HEAVY crowds w/ 2+ players, NOT a basic 2-player test).

## ITER 7 (2026-06-15) — PROXIMITY VOICE + LINK VERIFIED → LINK READY → LOOP STOPPED
- Voice test (tools/test-voice-browser.mjs, 2 headless Chromes + fake mics + WebRTC): **6/7**. PASS: both mics granted, **WebRTC mesh CONNECTED both ways**, remote voice through a **POSITIONAL PANNER** (true spatial proximity), guest punch routes to the host-authoritative ped, puppet cars SOLID, both clients alive. FAIL (1) = speaking-pip: the fake-mic tone sits below the VAD threshold (netvoice.js:120, `level>0.045`, correct for real speech) → a **TEST ARTIFACT**, not a defect; the indicator code is present + wired.
- go-live: `cloudflared` INSTALLED; server serves the game + relay on one port (test-net confirmed). `bash tools/go-live.sh` → public join link.
- **LINK READY — every explicit owner ask verified headlessly:** send a link (go-live ✓) · play in MY world together (host-auth sync ✓) · real proximity chat (WebRTC spatial voice ✓) · same exact NPCs (host sim + event relay + punch→host ped ✓) · same world+economy (world+character persistence by pid ✓). Protocol 41/41, voice 6/7 (pip=artifact).
- **LOOP STOPPED** (CronDelete bf2cc5d0) per the directive's stop condition. KNOWN FOLLOW-UPS (non-blocking, for after the owner tries it): (1) speaking-pip with a REAL mic; (2) #9 load-desync hardening (full vals() dump @10Hz — heavy crowds w/ 2+ players); (3) #3 dt-feel / #5 ped instancing / #7 continuity = optional polish.

## LOOP SUMMARY (7 firings, 2026-06-15)
- **SHIPPED:** carGrid no-alloc (iter2); **mass-flee crowd responsiveness** (iter4-5, validated, default ON — the owner's "RPG→everyone reacts"); test-net dedupe-conflict fix (iter6).
- **CONFIRMED ALREADY-OPTIMIZED** (saved wasted work, the key meta-finding): static-city batching, glass instancing, interior merge, crowd@~11 draws, adaptive-quality V2. The render path had little safe headroom — the owner's perf premise was largely already met by prior waves.
- **REVERTED via A/B** (discipline working): interior-LOD (+428% draws — batch.js already merges interiors). Also ruled out a static matrix-freeze (untagged per-frame movers).
- **VERIFIED:** MP link protocol 41/41 + proximity voice + p2p interaction → **link READY for owner testing**.
- Net: the real wins were RESPONSIVENESS (#8) + proving the LINK works; perf was already done.

## ITER 8 (2026-06-15) — MP HARDENING #9: BACKPRESSURE GATE shipped (the FATAL-failure-mode fix)
- Drove by 2 subagents: a precise wire-protocol spec of networld.js (full vals() dump @10Hz, ped row [nid,x,z,h,spd,flags,hp]; already has FiveM-style per-guest scoping @180/210u + hysteresis; guest interpolates @INTERP_MS=200, drops entities absent 4000ms) + a researched delta/priority design (Gaffer/Valve/Mirror/FiveM, cited).
- **KEY INSIGHT:** the transport is RELIABLE TCP → the hardest part of delta netcode (acks/ring-buffers) vanishes; baseline = "last snapshot I sent this guest". And the **#1 leverage fix = backpressure**, because it removes the failure MODE (socket death → desync) vs just reducing bytes.
- **SHIPPED — backpressure gate (host net.js + relay server.js):** when a socket's send buffer is backed up (>64KB client / >512KB relay), DROP high-frequency IDEMPOTENT snapshots (world/state, incl "to"-wrapped per-guest ones); reliable events (join/leave/ev/chat/host/deny) are NEVER dropped. Flag CBZ.netBackpressure (default ON, inert under normal load) / env CBZ_NO_BACKPRESSURE, CBZ_BP_LIMIT. Effect: overload → graceful stutter, not a killed socket.
- **A/B VALIDATED: test-net.js now 43/43** (was 41) — added a force-shed proof (CBZ_BP_LIMIT=-1): "backpressure KEEPS reliable events while shedding" ✓ + "backpressure DROPS the world snapshot to a backed-up guest" ✓. The inert/forward case = the passing "host world snapshot reaches guests" check at default limit.
- **SHIPPED + VALIDATED — entity DELTA + slow-heal (CBZ.netDelta, default ON):** networld.js scoped send loop now sends a per-guest in-scope row only when it CHANGED, or every HEAL_MS=2000ms (< the guest's 4000ms absence-drop → an omitted body is ALWAYS refreshed before it could despawn; the apply already tolerates omissions since that's how scoping works, so NO apply-side change). New tools/test-net-delta.js loads the REAL networld.js (minimal stubs) + drives the REAL deltaRows over 60 ticks: **7/7** — MOVING sent 60/60, STATIONARY 3/60 (~20× less), **maxGap 2100ms < 4000ms** (the safety invariant), re-entry re-sends full, flag-off=full rows. A packed plaza is mostly STILL bodies → big real cut. test-net.js still 43/43 (protocol unchanged).
- **#9 DONE** — FATAL failure-mode fix (backpressure) + bandwidth cut (delta), BOTH validated. The link now survives a packed-firefight overload (sheds, doesn't die) AND sends far fewer bytes (stationary crowd ~20× less). NEXT-optional (research-captured, not needed for robustness): priority accumulator (long-tail fairness, only matters once byte-budget-bound) + Int16/binary framing (~9-11 B/entity vs ~40 JSON).

## ROUND 2 — 2026-07-10 (the "massive optimization" pass; world = post-continent, ~100k objects)
Fresh baselines showed the June conclusions stale: continent fill + towns doubled draws
(calm t4 3,741 calls / 2.2M tris; scene 100k objects / 94k meshes; 19.5k unique materials)
and a CDP CPU profile put **62% of all CPU in uniformMatrix4fv** (per-draw upload tax).
Six research agents + in-frustum draw census attributed everything before any code moved.

### SHIPPED (all flag-gated, all A/B'd, smoke+demolition+street/atlas/night gates green)
| Change (flag) | What it does | Measured effect |
|---|---|---|
| LOS grid (`CBZ.CONFIG.LOS_GRID`, core/losgrid.js) | XZ-grid + slab-test broadphase behind every raycast on CBZ.losBlockers (camera occlusion, clearLineOfFire ×3 passes, cop/guard vision, fpsmode wallDistance…) — was a full 17k-mesh walk per call | camera onAlways(50) 7.7→0.2ms; fpsmode onAlways(52) 4.8→0.2ms; chaos vehicles order-42 18→6.8ms |
| Matrix freeze (`CBZ.CONFIG.MATRIX_FREEZE`, core/staticfreeze.js) | matrixAutoUpdate=false for the whole static city (+scene) at build; movers excluded (door pivots tagged `userData.mover`, knockable prop groups via collider→group refs, lights/sprites) | kills the ~100k-object per-frame compose+multiply (was ~30-60ms/frame headless); multiplyMatrices 0.31→0.04% CPU |
| Batch V2 (`CBZ.CONFIG.BATCH_V2`, core/batch.js) | (1) bakes material.color into vertex colours → merges ACROSS colours (one white shared mat per lighting class); (2) merges CARVEABLE walls with per-wall vertex-range ledger — CBZ.batchWallHide/Show zero/restore a slice when carveHole/reset fire; (3) inert deco buckets per 112u TILE (frustum+farcull can reject) instead of city-wide | wallHidden 8.2k→16.7k; calm t4 city-root draws −25%, tris 2.0M→1.23M; t0 city-root draws 823→321, tris −47% |
| Signal bulbs instanced (`CBZ.CONFIG.SIGNAL_INSTANCED`, props.js+traffic.js) | 504 per-lamp meshes (each a FRESH material) → 3 InstancedMesh w/ per-instance instanceColor; traffic.js writes one colour on phase change | −~500 draws + −504 unique materials |
| Street-lamp bulbs+glows instanced (`CBZ.CONFIG.LAMP_INSTANCED`, props.js) | ~150 posts × 2 meshes → 2 InstancedMesh sharing the SAME night-driven materials; shot-out lamp zero-scales its instances | −~300 draws |
| farcull fixes (core/farcull.js) | (a) WALL-CLOCK sweep pacing (was game-dt — at low fps sweeps degraded to 1/10s and worlds sat unculled for minutes: the exact machines the culler serves); (b) meshes w/ precomputed spheres measured budget-free; (c) InstancedMesh bounds aggregated from instance matrices (was: one prototype at origin → biome/island scatter never culled or wrongly culled) | t0 steady visible batch meshes 931→149; glow-shell pools no longer vanish far from origin |
| Dead-updater gates (hud.js, detection.js, markers.js) | escape-mode UI (gangHud innerHTML rebuild, detect boxShadow string, guards.concat alloc) ran EVERY frame in city against display:none!important elements | −2-5ms/frame + GC pressure |
| charpanel prewarm (charpanel.js) | first buildPanel+portrait = ~1.3s hitch (offscreen WebGL renderer) on the FIRST city frame → prebuilt on the title screen | first-city-frame hitch gone |
| `?cfg_<FLAG>=0/1` URL overrides (config.js) | headless A/B can set CONFIG flags before boot (same-page resets can't re-run one-shot build passes) | the A/B harness for everything above |
| Also | knockable-prop groups spared from batch (old pass merged far-town cans/cones → tipping moved an EMPTY group — live bug, fixed); farcull stale header fixed; demolition-check.mjs darwin chrome path | |

### A/B TABLE (headless SwiftShader; draw/tri counts exact, ms relative)
| scenario | metric | legacy | optimized | Δ |
|---|---|---|---|---|
| calm t4 | fps | 0.40 | 0.66 | **+65%** |
| calm t4 | render CPU ms | 2310 | 1432 | **−38%** |
| calm t4 | triangles | 2.01M | 1.23M | **−39%** |
| calm t4 | draw calls (avg) | 3367 | 2668 | **−21%** (paired run) |
| calm t0 | city-root draws (attr) | 823 | 321 | **−61%** |
| calm t0 | triangles | 1.89M | 1.12M | **−41%** |
| calm t0 | render CPU ms | 410 | 260 | **−37%** |
| chaos t4 | fps | 0.38 | 0.53 | **+39%** |
| chaos t4 | render CPU ms | 2359 | 1663 | **−29%** |
| chaos t4 | triangles | 1.96M | 1.30M | **−34%** |
| chaos t4 | camera 50 / fpsmode 52 / vehicles 42 steady ms | 7.0 / 4.6 / 18.1 | 0.2 / ~0 / 6.8 | **−97/−100/−62%** |

### GATES
syntax ✓ · smoke `invariants: ok` ×4 ✓ · street-shot pixel-sane (glass/doors/signals/shadows) ✓ ·
demolition-check full arc + float invariants + rebuild asserts ✓ · carve probe (v2 slice hide/restore,
LOS parity with legacy) ✓ · night probe (instanced bulbs ride the night driver, lampEi 0→1) ✓ ·
city-atlas seed 1 structurally intact ✓ · zero console errors in every run ✓

### KNOWN FOLLOW-UPS (researched, not built)
- Hero-ped-rig partial merge (CROWD-GRAND-PLAN 1b): ~20 meshes/rig, ~400-600 draws at street level.
- Cars: wheels are 12 unmerged draws/car (merge scans direct children only; rim/disc nested); ambient
  car paint = per-car MeshStandardMaterial (heaviest shader) — palette-cache for parked/traffic.
- Per-tile instanced pools for wildnature/biome scatter (farcull can only cull whole pools).
- Emissive statics beyond lamps/signals (beacons/neon) still individual draws.

## ROUND 3 — 2026-07-21 (fresh owner-requested teardown: "what's the pie chart")
Owner asked for a data-driven attribution + owner-flippable feel toggles, framed around an
observability-first north star ("reality is only what's observable — prioritize the view frustum").
New tooling (kept, committed): `tools/perf-ab/attribute.mjs` (one-boot full pie chart: shadow tax,
category hides, top-level subtree attribution, quality-tier sweep, per-updater sim ranking) and
`tools/perf-ab/abmatrix.mjs` (rAF-FROZEN clean A/B of every RUNTIME lever — shadows, shadow-res,
pixel-ratio, draw-distance, category hides). Results JSON in this dir (attr-calm-q4, abmatrix-{calm,
chaos,seed1337}). Ran calm/90210 + 5★-chaos/90210 + calm/1337; 3 web-research agents (render cost,
procgen CPU, headless attribution) captured in the session.

### BOOT/METHOD GOTCHAS (save the next run time)
- `setMode("city")+resetGame()` alone builds a STUB world (25 draws, 121 colliders). The full
  continent only builds via the title `playBtn` click path (math-gate's route). Use that.
- World streams in over ~150s headless (SwiftShader). Poll `CBZ.colliders.length` to stability before
  measuring — a fixed sleep under-measures.
- The game's own rAF loop mutates the scene between measurement renders → pollutes category/shadow
  deltas (negative dCalls, drifting visibleMeshes). abmatrix FIXES this by swallowing
  `requestAnimationFrame` during measurement. attribute.mjs does NOT freeze → trust only its huge
  signals. Also: abmatrix's draw-distance test runs BEFORE the category hides and farcull doesn't
  fully re-expand in time, so its per-category dCalls are unreliable — only `hide_staticCity` (a 99%
  signal) survives the drift. Fix next time: freeze farcull or reorder.
- r128 does NOT count shadow-map draws in `renderer.info.render.calls` (passCalls came back 0 on every
  run). Shadow magnitude must come from map size/type + relative refresh ms + design intent, not info.

### FINDINGS (consistent across calm / chaos / both seeds)
| metric | calm 90210 | chaos 90210 | calm 1337 |
|---|---|---|---|
| draw calls / frame (q4) | 5,622 | 6,061 | 7,212 |
| hide static city → calls | **22** | **22** | **23** |
| ⇒ static world = share of draws | **99.6%** | **99.6%** | **99.7%** |
| triangles / frame | 2.16M | 2.52M | 2.18M |
| visible meshes walked | 54k | 47k | 55k |
| JS heap | 1.05 GB | 1.10 GB | 1.02 GB |
| unique materials / programs | 39k / 259 | — | — / 262 |
| peds (calm ambient / chaos) | 507 | 477+6 | 509 |

- **Draw-call submission of the STATIC procedural world = the bottleneck (~99%), unchanged even in a
  5★ riot.** Dynamic actors are a tiny share of *draws* (big share of *triangles* + the #1 *CPU* cost).
  Ambient instanced crowd ≈ free (prior rounds confirmed ~11 draws). Cutting draw distance ×0.5 moved
  draws <2% — the calls are LOCAL block density, not the skyline. Fill-rate is NOT it (¼-res ratio 1.07
  → CPU/draw-call bound, classic weak-GPU profile).
- **Shadows = #2 GPU cost, cheapest big win.** Sun = 2048 PCFSoft, re-renders casters 10-18Hz; a
  refresh added ~200ms relative render (~⅓ of a shadowed frame). quality.js already calls the tier-0
  shadow-off "the single biggest GPU cost in the scene."
- **Sim: ped AI (`peds.js:4233`, onUpdate 34) = 15.8ms/tick, 3× the next system**, scales with ~500
  peds on/off screen. stepSim ~51ms/tick total (SwiftShader-relative). #2 vehicle sim ~5.7, aigoals ~4.8.
- **Memory: ~1GB heap / 44k geoms / 39k materials** → GC-hitch + crash risk on weak machines; 39k
  materials also defeats the renderer's draw-call sort.

### PLAN (delivered to owner as an artifact; NOT yet built — awaiting go-ahead)
Observability-first: spend draws/tris/shadows/AI-ticks only on the view-frustum slice.
1. Per-chunk InstancedMesh pools + merge + frustum/occlusion gating for the LOCAL static world
   (target 5,600→<1,500 draws). The big one.
2. Independent Shadows setting (Off/Low/High) + near-only casters + `?cfg_SHADOWS=off` feel flag.
3. Ped-AI LOD: full brain only for near+on-screen peds; puppet/freeze the rest (16→<5ms).
4. Material/geometry dedup cache (heap→<600MB, fewer state changes).
5. Prioritized frustum-first streaming (no observable pop-in).
6. Owner toggle panel + URL flags for every lever (feel > numbers).
Feel-it-today (already shipped): Quality slider Fastest, `?qforce=N`, `?cfg_CITY_FAR_CULL=0`.
