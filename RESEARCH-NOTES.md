# RESEARCH NOTES — state of the art vs. our round-3 optimization

11 parallel research agents swept the field for techniques that SURPASS what we shipped
(shadow toggle, ped-AI move-throttle, per-cell instancing = −30% draw calls). Every
technique below was checked against our constraints: vanilla Three.js **r128**, **no build
step** (single `<script>` tags, global `CBZ`), **GitHub Pages** hosting (can't set custom
headers), **deterministic** procgen (MP-safe, no `Math.random` in build paths).

**Reality check:** our best is ~3,826 draw calls (instancing on). Shipped low-end web games
target **100–200 draw calls** (PlayCanvas, "10 years of learnings"); one three.js demo hit
**6,500 → ~200 (>30×)**. So there is ~15–30× of headroom left, most of it reachable WITHOUT
upgrading the engine.

## TIER 1 — big wins, r128-native, fit our architecture (DO THESE)
1. **Occlusion culling via occluder boxes (GTA's own trick).** Three.js still draws buildings
   in-frustum but hidden behind other buildings — the gap we flagged and never filled. GTA
   used author-placed occluder boxes (Vice City: 344 zones). We can DERIVE them from our lot/
   block data and cull other lots' AABBs in plain JS before render. CPU-only, deterministic,
   fits MP hash rules. GPU Hi-Z occlusion measured 5ms→1.5ms; box-PVS is cheaper.
   Sources: gtamods.com/wiki/OCCL · interplayoflight.wordpress.com (GPU occlusion) ·
   blog.selfshadow.com/publications/practical-visibility · Three's own occlusion is WebGPU-only
   (PR #15450 rejected for WebGLRenderer; discourse "occlusion-culling" threads confirm roll-your-own).
2. **Material dedup + texture atlasing (kill the 39,000 materials).** Our 39k materials is a GPU
   state-change problem AND ~20% of CPU (Three's per-material program-cache-key hashing, GH #22530).
   Fix: appearance-keyed material cache + vertex-color baking + atlasing (or WebGL2 sampler2DArray).
   A real viz went 1,100→17 draw calls from atlasing alone (60→1500 fps end-to-end).
   Sources: medium @dhiashakiry 60-to-1500-fps · discourse texture-atlasing threads · GH #22530.
3. **HLOD baking + octahedral impostors for distant blocks.** Bake each distant city block into
   one merged mesh (near=full, far=one mesh/block); render the farthest skyline as impostor
   billboards (1 quad/cluster). Extends our batch.js; UE HLOD + 3D-Tiles pattern.
   A three.js forest hit 6,500→~200 draws, 45M→150K tris. Sources: discourse "forest of octahedral
   impostors" 85735 · shaderbits.com/blog/octahedral-impostors · UE HLOD docs.

## TIER 2 — high value, r128-feasible, more effort
4. **Camera-first priority streaming** (your "observable-first" as an algorithm): rank loads by
   screen-space-error + distance-to-view-center, load what the camera faces first, CANCEL loads
   for chunks about to leave frame. Cesium 3D Tiles: 2–10× faster perceived load, 27–53% fewer
   tiles. Use a hand-rolled per-rAF time budget, NOT requestIdleCallback. Sources: cesium.com/blog
   faster-3d-tiles · Cesium selection-algorithm docs.
5. **Cascaded shadow maps + baked static shadows.** `three-csm` drops into r128; tight per-cascade
   frusta beat our single 2048 map. World is deterministic → bake static building shadows at gen-time,
   cast live only for dynamic actors. Sources: github StrandedKitty/three-csm · therealmjp shadow-maps.
6. **Spatial grid + typed-array (SoA/ECS) ped AI** — attacks the #1 CPU cost (16ms ped update).
   Uniform grid makes O(n²) neighbor scans ~O(n) (grid boids: 1M agents @30fps); SoA/ECS ~14× faster
   than object-per-ped (bitECS: 9.6ms vs 132ms @15k). Uniform grid > quadtree for even density.
   Sources: github NateTheGreatt/bitECS · dmurph.com ecs-vs-oop · gafferongames fix-your-timestep.
7. **three-mesh-bvh** (standalone add-on, works on r128) — BVH raycast/frustum/spatial queries;
   speeds farcull + LOS. Sources: github gkjohnson/three-mesh-bvh.

## TIER 3 — situational / heavier
8. **Weak-GPU / mobile hardening** (your 2019 Intel Mac + phones): matcaps instead of lights+shadows
   (Bruno Simon), `mediump` fragment precision (~2× mobile), NEVER readPixels/getError mid-frame
   (tile flush stall), per-tier frame-rate cap (beats thermal throttling), adaptive pixelRatio w/
   hysteresis (27→57 fps), MSAA nearly free on tilers, avoid discard/alpha-test on mobile.
   Sources: ARM Mali best practices · Imagination TBDR · MDN WebGL best practices · Bruno Simon case study.
9. **Hand-rolled GPU instance culling (WebGL2 transform feedback)** — sub-cell per-instance culling
   above our per-cell pools; real shader work, r128-feasible. A vanilla instanced crowd hit 100k @240fps
   <2ms GPU. Sources: github CodyJasonBennett/gpu-culling · tsherif webgl2 examples · discourse 89928.
10. **KTX2/Basis + Draco/meshopt** — loaders ship in r128; VRAM 4–8×, KTX2 cut GPU texture mem 81–90%,
    meshopt 29MB→2.5MB. Less central (we're procedural not asset-heavy); Safari/iOS flaky, TEST first.
    Sources: KTX2Loader/DRACOLoader docs · meshoptimizer.org · GH #19717 (Safari basis bug).

## TIER 4 — the true ceiling, but breaks our constraints (FUTURE)
11. **WebGPU + GPU-driven indirect rendering** — compute shader culls every object + writes draw
    commands GPU-side → ~1 indirect call per material, bottleneck gone. BUT WebGPU-only (no WebGL
    culling fallback), transparency unsupported, and upgrading off r128 is ESM-only past r161 →
    breaks the whole no-build/global-CBZ/script-tag architecture (a rewrite, not a bump). As of r176
    WebGL still BEAT WebGPU ~4× for many plain meshes — win is conditional on heavy batching.
    Verdict from the upgrade-assessment agent: DON'T upgrade whole-repo; backport effects to r128 by
    hand (aggressive batch, instancing, three-mesh-bvh). Sources: three.js r159 release (BatchedMesh
    needs r159+) · WebGPURenderer/TSL (r171+) · migration guide r152 color / r155 lights / r161 ESM-only.

## What we already nailed (don't redo)
- Per-cell instancing = the correct r128 baseline (InstancedMesh2's per-instance culling needs r159+).
- Matrix-freeze, static batching, LOS grid, farcull — all genuine best-practice per the research.
- Blob shadows for background peds = the standard hero/non-hero shadow split.
- Draw-call count as the metric = confirmed the right currency.

## Recommended build order (each r128-native, flag-gated, A/B-provable)
1) Occluder-box occlusion culling → 2) Material dedup + atlasing → 3) HLOD block baking + skyline
impostors → 4) Ped-AI grid + typed-array state → 5) Camera-first priority streaming + CSM/baked
shadows. Reassess WebGPU only after these are exhausted.
