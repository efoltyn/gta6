# Gang City: the pause that would not resume, and where the frame goes

Measured 2026-09-05 in a headed Chrome on the owner's Mac (real GPU, CDP-driven,
`--disable-backgrounding-occluded-windows` because the display was asleep), Gang
Life at Balanced, 1600x913 buffer. The Mac carried 20-27 headless Chromes from
other sessions the whole time (load 3 -> 13), so absolute numbers are inflated
and only same-window A/Bs and in-page micro-benchmarks are trusted below.

## 1. The pause

Repro (pause.mjs, CDP input): `setState("paused")` -> click Resume -> state stays
`paused`, `pointerlockerror` fires, second click same. Root cause: the Resume
button, the canvas click and the gamepad Start all did only `CBZ.requestLock()`;
the state flipped back to `playing` only inside camera.js's `pointerlockchange`
handler, i.e. only when the browser GRANTED pointer lock. Chrome refuses that in
the common cases (about a second after the Escape that exited the lock, any call
without a fresh user activation, a touch device where requestLock returns
early, a GL context restore) and nothing listened to `pointerlockerror`.
Escape on the pause card opened Settings instead of resuming, and closing
Settings while paused re-locked nothing, so the keyboard had no way back.

Fix (systems/state.js `CBZ.resumeGame`, systems/settings.js, index.html):
state flips first, lock is best effort; Escape on the card resumes (300 ms
double-tap guard); a refused lock shows "Click to capture the mouse" and the
next canvas click or key press retries it. Verified live: Resume -> `playing`
with the lock refused; Escape -> `playing`; hint shown; no state flip from a
stray Escape while playing unlocked.

## 2. Where the frame goes (street level, Balanced)

| slice                         | ms / frame |
|-------------------------------|-----------:|
| whole frame (p50 rAF gap)     | 67 |
| updaters (478 of them)        | 29.5 |
| three.js render CPU           | 14.3 (22 draw calls: it is the walk, not the draws) |
| scene.updateMatrixWorld       | 2.9 |
| always chain                  | 3.0 |

Updater tail: peds brains 6.0, order-38 band (human contact 30 Hz, interact
scanner, vehicles) 3.3, traffic 2.1, water wakes 1.3, body physics 1.1, water
entry sweep 1.1, world save tick 0.9, reactions 0.8.

Scene census: 216,786 nodes, 196,312 meshes, ~30,000 visible at street level;
r128 frustum-tests each visible mesh in the main pass and again in the shadow
pass. 261 of 373 static building groups inside the cull radius were entirely
outside the view frustum, holding 17,600 of those visible nodes.

During a street fight the profile changed shape: `IQ.posture -> firePosTick ->
pickPos -> segBlocked -> queryCollidersNear` was 25-30% of ALL samples
(queryCollidersNear 15% self: gathering thousands of the city's 142k colliders
into an array per candidate lane, ~40 lanes per pick per shooter), and
`cityShotHole` 3.9% self (a loop over all 37,540 window panes per line-of-fire
test to find the handful that are broken).

## 3. What shipped

| change | file | measured |
|---|---|---|
| segment collider query with early-out; combat lane tests use it | systems/physics.js `CBZ.segmentHitsCollider`, systems/combat_iq.js | 800/800 identical answers on sampled lanes, 4.2x faster (4.93 -> 1.17 ms per 800 lanes) |
| broken-pane list for line-of-fire | city/buildings.js | loop over 37,540 -> loop over the broken ones (cityShotHole gone from the profile) |
| whole-building hide before each draw, exact (view frustum + sun shadow frustum) | core/viewscope.js (new), core/cctv.js reuses `CBZ.subtreeSphere` | 0 differing pixels with 422 groups hidden (readRenderTargetPixels compare); 237 still hidden on shadow frames; render CPU -2..-9% on non-shadow frames in a loaded-machine micro-benchmark, pass cost ~0.5 ms |
| traversal probe: skip cars out of reach | systems/physics.js probeTraversal | carCandidate was 2% self during panic; gone |
| over-water memo per entity | world/water_float.js, world/water_impact.js | parked cars / idle peds no longer re-ask the shore field every sweep |
| interaction scanner: centre-distance reject before box math | city/militaryvehicles.js | per-prop Box3 + stamp string only for props that can be in reach |
| culled peds skip the gun-ready pose | systems/actorweapons.js | ~700-actor walk no longer poses rigs that are out of the scene |

Not done, measured and left: peds brains (6 ms, already engineered), the
30 Hz human-contact grid (~2 ms), traffic loop self time (~2 ms at 514 cars),
GC 1.5-4%. The view-scope pass helps most where the sun shadow refreshes less
often than the frame (18 Hz while moving), i.e. on faster machines; on this
loaded Mac at 10-15 fps most frames were shadow frames.

No math-gate run: the Mac was at load 7-13 with other sessions' Chromes and the
gate flakes on load (see memory). Evidence instead: three full boots after the
edits with a console.error collector armed, zero errors across ~15 minutes of
play; the pause paths re-verified after every edit.
