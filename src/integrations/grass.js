/* ============================================================
   src/integrations/grass.js — O2 adapter: the first vendored three.js
   OSS component wired into the live game through the O1 shim.

   ****** THIS FILE IS THE TEMPLATE FOR THE NEXT INTEGRATION ******
   Read it top to bottom once; every future src/integrations/*.js adapter
   follows the exact same 4 moves:
     1. registerModule(name, init) — bootstrap.js's O1 contract. init()
        gets called once, after the legacy boot reaches "title", isolated
        by try/catch (see bootstrap.js:154-167) so a broken adapter can
        never crash the legacy game or another adapter.
     2. init(scene) receives adoptScene()'s live snapshot — scene/camera/
        renderer/THREE are the ACTUAL running-game objects, not copies.
     3. Build the vendored renderer's output as real THREE objects and
        scene.scene.add(...) it directly.
     4. Anything that needs to run every frame joins the SAME frame loop
        via scene.onUpdate/scene.onAlways with a PRIO-named band (see
        core/prio.js) and a one-line comment saying why that band.

   VENDORED FROM: src/vendor/three-grass-demo (James Smyth,
   three-grass-demo, MIT). Full provenance/commit/license/exact-file-list/
   what's-used-vs-not: src/vendor/three-grass-demo/VENDORED.txt — read that
   file for the complete story; this header only summarizes.

   WHAT'S UNTOUCHED vs PORTED (short version — VENDORED.txt has the long
   version): the two GLSL shaders (grass.vert.glsl / grass.frag.glsl) are
   imported BELOW byte-for-byte via Vite's native `?raw` suffix (no plugin,
   no vendored bytes changed) — that's the actual "grass renderer". The
   geometry-BUILDING algorithm (upstream's generateField/generateBlade,
   src/vendor/three-grass-demo/src/index.js:78-167) isn't exported by
   upstream as a reusable function, so it's PORTED here with exactly 4
   documented changes (parameterized, seeded LCG instead of Math.random,
   dropped a dead computeVertexNormals/computeFaceNormals call the shader
   never reads, and called once per anchor instead of once globally) —
   see VENDORED.txt point 3 for the itemized diff. Vertex layout, index
   winding, and the black/gray/white vertex-color sway-weight scheme the
   shader keys off of are IDENTICAL to upstream.

   MODULE WORLD ONLY (see bootstrap.js's own header): this file is real
   ESM, pulled into Vite's module graph only via src/integrations/index.js
   <- src/bootstrap.js. A dumb static file server (`python3 -m
   http.server`) never loads bootstrap.js, so it never loads this file
   either — no grass, no errors, byte-identical legacy behaviour. That is
   the INTENDED direction of travel for the whole O wave, not a gap to
   close here (O3+ is what eventually gets the module world running
   everywhere).

   WHERE THE GRASS GOES: src/city/buildings.js's makePark() (~line 5516)
   already builds a landscaped park lot (fountain, hedge ring, gravel
   paths, 4 corner trees) for any city lot the worldgen RNG rolls
   `lot.kind === "park"` (parkFrac, buildings.js:4701) — CBZ.city.arena.lots
   is the live list (world.js exposes `lots` on the arena object, mode.js
   stores it at CBZ.city.arena — see pickSpawnRoof, mode.js:226, for the
   precedent of reading city.arena.lots this same way). Which lots actually
   ROLL "park" is seeded-RNG-determined at city-build time, not a fixed
   coordinate, so this adapter finds them LIVE at init (closest park lots to
   the plaza spawn point, CBZ.city.arena.spawn, world.js:532) rather than
   hardcoding a guessed coordinate — the whole point of adoptScene()'s
   "call it again, see live state" contract. Patches are centered on the
   SAME corner-of-the-lawn spot buildings.js already plants a tree at
   (cx + qx*w*0.28, cz + qz*d*0.28) — safely inside the hedge ring, clear
   of the fountain/gravel cross, and conforms to CBZ.terrainHeight(x, z)
   (flat 0 everywhere in the playable city per world/terrain.js, but this
   adapter never assumes that — it asks, per the contract).
============================================================ */
import { registerModule } from "../bootstrap.js";
import vertGLSL from "../vendor/three-grass-demo/src/shaders/glsl/grass.vert.glsl?raw";
import fragGLSL from "../vendor/three-grass-demo/src/shaders/glsl/grass.frag.glsl?raw";

// ---- tiny seeded LCG (repo convention: seeded, never Math.random, for any
// world-touching generation — see src/city/minicities.js:56-61, same formula,
// same reasoning: deterministic + independent of any global rng stream). This
// is purely decorative geometry (never saved/serialized), but the convention
// costs nothing to follow and makes a screenshot/perf run reproducible run to
// run. ------------------------------------------------------------------
function makeLcg(seed) {
  let s = seed >>> 0 || 1;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ---- ported geometry builder (VENDORED.txt point 3 has the full diff list
// against src/vendor/three-grass-demo/src/index.js:78-167) --------------
function buildBlade(THREE, rng, center, vArrOffset, uv, bladeWidth, bladeHeight, bladeHeightVariation) {
  const MID_WIDTH = bladeWidth * 0.5;
  const TIP_OFFSET = 0.1;
  const height = bladeHeight + rng() * bladeHeightVariation;

  const yaw = rng() * Math.PI * 2;
  const yawUnitVec = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const tipBend = rng() * Math.PI * 2;
  const tipBendUnitVec = new THREE.Vector3(Math.sin(tipBend), 0, -Math.cos(tipBend));

  // bottom-left, bottom-right, top-left, top-right, top-center — identical
  // 5-vertex blade shape to upstream (index.js:130-139).
  const bl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((bladeWidth / 2) * 1));
  const br = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((bladeWidth / 2) * -1));
  const tl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * 1));
  const tr = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * -1));
  const tc = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(tipBendUnitVec).multiplyScalar(TIP_OFFSET));

  tl.y += height / 2;
  tr.y += height / 2;
  tc.y += height;

  // vertex-color sway weight: black (0) = rooted base, gray (0.5) = mid-blade,
  // white (1) = tip — grass.vert.glsl:17-21 branches on `color.x` to decide
  // how far a vertex swings with the wind. UNCHANGED from upstream.
  const black = [0, 0, 0], gray = [0.5, 0.5, 0.5], white = [1.0, 1.0, 1.0];

  const verts = [
    { pos: bl.toArray(), uv, color: black },
    { pos: br.toArray(), uv, color: black },
    { pos: tr.toArray(), uv, color: gray },
    { pos: tl.toArray(), uv, color: gray },
    { pos: tc.toArray(), uv, color: white },
  ];
  const indices = [
    vArrOffset, vArrOffset + 1, vArrOffset + 2,
    vArrOffset + 2, vArrOffset + 4, vArrOffset + 3,
    vArrOffset + 3, vArrOffset, vArrOffset + 2,
  ];
  return { verts, indices };
}

// bladeCount/patchRadius/bladeWidth/bladeHeight/bladeHeightVariation replace
// upstream's hardcoded BLADE_COUNT/PLANE_SIZE/BLADE_WIDTH/... module
// constants (index.js:8-12) — diff (a) from VENDORED.txt.
function buildGrassGeometry(THREE, rng, opts) {
  const { bladeCount, patchRadius, bladeWidth, bladeHeight, bladeHeightVariation } = opts;
  const positions = [], uvs = [], indices = [], colors = [];
  const VERTEX_COUNT = 5;

  for (let i = 0; i < bladeCount; i++) {
    // uniform-disc sample (identical math to upstream's generateField,
    // index.js:90-95 — sqrt(rng()) so blades don't bunch at the center)
    const r = patchRadius * Math.sqrt(rng());
    const theta = rng() * 2 * Math.PI;
    const x = r * Math.cos(theta), z = r * Math.sin(theta);
    const center = new THREE.Vector3(x, 0, z);
    const uv = [(x / patchRadius + 1) / 2, (z / patchRadius + 1) / 2];

    const blade = buildBlade(THREE, rng, center, i * VERTEX_COUNT, uv, bladeWidth, bladeHeight, bladeHeightVariation);
    for (const v of blade.verts) { positions.push(...v.pos); uvs.push(...v.uv); colors.push(...v.color); }
    for (const idx of blade.indices) indices.push(idx);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geom.setIndex(indices);
  // NOTE (diff c, VENDORED.txt): upstream also calls computeVertexNormals()
  // + computeFaceNormals() here (index.js:113-114). grass.vert.glsl never
  // reads a normal attribute, so that work is pure waste — dropped. (Modern
  // BufferGeometry also has no computeFaceNormals at all; that call was
  // legacy-Geometry-only cruft in upstream's own copy-paste.)
  return geom;
}

// ---- adapter-authored placeholder textures (NOT vendored — see
// VENDORED.txt "TEXTURES" for why upstream's two JPEGs aren't shipped here).
// Small procedural canvases feeding the exact same two texture-uniform slots
// the untouched fragment shader already samples (grass.frag.glsl:11,13). ---
function grassProceduralTexture(THREE, rng) {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const ctx = c.getContext("2d");
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const g = 90 + Math.floor(rng() * 70); // mottled mid-to-bright green
    ctx.fillStyle = `rgb(${20 + Math.floor(rng() * 20)},${g},${20 + Math.floor(rng() * 20)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
function cloudProceduralTexture(THREE, rng) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#dce8f2"; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 40; i++) {
    const r = 4 + rng() * 10;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.3})`;
    ctx.arc(rng() * 64, rng() * 64, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // matches upstream (index.js:36)
  tex.needsUpdate = true;
  return tex;
}

// ---- tuning: draw-call-bound engine (~1000 NPCs, see terrain.js's own
// "2 draw calls" budgeting note) — kept far below upstream's showcase
// 100,000-blade/PLANE_SIZE-30 demo. Two small patches, one draw call each. --
const MAX_PATCHES = 2;
const BLADES_PER_PATCH = 3500;   // 5 verts/blade, indexed -> ~17.5k verts, ~1 draw call
const PATCH_RADIUS = 3.0;
const BLADE_WIDTH = 0.1, BLADE_HEIGHT = 0.8, BLADE_HEIGHT_VARIATION = 0.6;
const SEED = 20260702; // fixed -> reproducible screenshots/perf runs

// Quality gate (core/quality.js's CBZ.qualityLevel, 0..4 — see that file's
// header for the tier table). Tier 0 is the "emergency" tier (rig shadows
// off, closest-only rigs) — a config that's already shedding cost hard, so
// grass skips entirely there. Any other tier (or qualityLevel absent, e.g.
// quality.js not loaded) builds normally; visibility still re-checks this
// every tick (see the onAlways below) so a mid-session drop to tier 0 hides
// it too, and a recovery re-shows it, with zero rebuild.
const MIN_QUALITY_LEVEL = 1;

function findParkAnchors(CBZ) {
  const arena = CBZ.city && CBZ.city.arena;
  const lots = arena && arena.lots;
  if (!lots || !lots.length) return [];
  const spawn = arena.spawn || { x: 0, z: 0 };
  const parks = lots.filter((l) => l.kind === "park");
  parks.sort((a, b) => {
    const da = (a.cx - spawn.x) ** 2 + (a.cz - spawn.z) ** 2;
    const db = (b.cx - spawn.x) ** 2 + (b.cz - spawn.z) ** 2;
    return da - db;
  });
  // one anchor per park lot, in the NE lawn quadrant — same spot
  // buildings.js's makePark() already plants a tree (buildings.js:5566-5569),
  // so the grass simply grows in around it.
  return parks.slice(0, MAX_PATCHES).map((lot) => ({
    x: lot.cx + 1 * (lot.w || 20) * 0.28,
    z: lot.cz + -1 * (lot.d || 20) * 0.28,
  }));
}

function buildPatches(scene, anchors) {
  const { THREE, CBZ } = scene;
  const rng = makeLcg(SEED);
  const grassMat = new THREE.ShaderMaterial({
    uniforms: {
      textures: { value: [grassProceduralTexture(THREE, rng), cloudProceduralTexture(THREE, rng)] },
      iTime: { value: 0 },
    },
    vertexShader: vertGLSL,
    fragmentShader: fragGLSL,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const patches = [];
  for (const anchor of anchors) {
    const geom = buildGrassGeometry(THREE, rng, {
      bladeCount: BLADES_PER_PATCH, patchRadius: PATCH_RADIUS,
      bladeWidth: BLADE_WIDTH, bladeHeight: BLADE_HEIGHT, bladeHeightVariation: BLADE_HEIGHT_VARIATION,
    });
    const mesh = new THREE.Mesh(geom, grassMat);
    const y = scene.terrainHeight(anchor.x, anchor.z);
    mesh.position.set(anchor.x, y != null ? y : 0, anchor.z);
    mesh.name = "cbz-grass-patch";
    mesh.userData.cbzGrass = true;
    mesh.castShadow = false; mesh.receiveShadow = false; // thin alpha-less quads; not worth a shadow pass
    scene.scene.add(mesh);
    patches.push(mesh);
  }
  return { patches, grassMat };
}

function initGrass(scene) {
  const { CBZ } = scene;
  CBZ.grass = { patches: [], setEnabled() {} }; // placeholder until the self-defer below resolves

  let manualEnabled = true;
  let built = false;
  let patches = null, grassMat = null, elapsedMs = 0;

  function applyVisibility() {
    const q = CBZ.qualityLevel;
    const gated = q != null && q < MIN_QUALITY_LEVEL;
    const visible = manualEnabled && !gated;
    for (const m of patches) m.visible = visible;
  }

  // SELF-DEFER (bootstrap.js's own header names this exact pattern: "an
  // adapter that self-defers ... until CBZ.scene && CBZ.terrainHeight exist
  // ... can call adoptScene() again on a later tick and see live state").
  // registerModule() fires once the LEGACY BOOT reaches "title" — but
  // "title" is only the menu screen; city/mode.js's build() (which actually
  // populates CBZ.city.arena.lots, including which lots rolled `kind ===
  // "park"`) doesn't run until the player clicks PLAY (systems/state.js's
  // startRun -> resetGame -> mode.reset -> build(), state.js:252-257). So
  // this single onAlways tick does double duty: retry the anchor lookup
  // every frame until the city is actually built, then flip permanently
  // into the steady-state wind tick below. Once `built` flips true the
  // anchor-retry branch never runs again (one extra property read/frame
  // in the meantime is free).
  //
  // PRIO.PRESENTATION (core/prio.js:129-133, anchored at systems/markers.js:187
  // onAlways(60, ...)) — this is a visual-only sway/build effect with no
  // gameplay coupling, same band markers.js's own presentation tick uses.
  // onAlways (not onUpdate) so both the self-defer poll and the wind sway
  // keep running even at the title screen / while paused, matching how the
  // rest of the live world keeps rendering there (core/loop.js:100-102 runs
  // `always` every frame regardless of g.state).
  scene.onAlways(scene.CBZ.PRIO ? scene.CBZ.PRIO.PRESENTATION : 60, function (dt) {
    if (!built) {
      const anchors = findParkAnchors(CBZ);
      if (!anchors.length) return; // not built yet (or genuinely no park this run) — retry next frame

      const q = CBZ.qualityLevel;
      if (q != null && q < MIN_QUALITY_LEVEL) {
        // Quality gate: skip building entirely at the lowest tier (see
        // MIN_QUALITY_LEVEL's comment above). Still marks `built` so this
        // doesn't retry forever burning cycles; a later quality recovery
        // won't retroactively grow grass this session (deliberate — this
        // is the "skip on low quality" half of the gate; the "auto-hide a
        // built patch on a later drop" half is applyVisibility() below,
        // exercised whenever qualityLevel is >= MIN_QUALITY_LEVEL at build
        // time but drops afterward).
        built = true;
        console.log(`[grass] quality gate: qualityLevel=${q} < ${MIN_QUALITY_LEVEL} when the city finished building — skipping grass this session`);
        return;
      }

      const built_ = buildPatches(scene, anchors);
      patches = built_.patches; grassMat = built_.grassMat;
      built = true;
      applyVisibility();
      CBZ.grass = {
        patches,
        setEnabled(on) { manualEnabled = !!on; applyVisibility(); },
      };
      console.log(`[grass] planted ${patches.length} patch(es), ${BLADES_PER_PATCH} blades each, at`, anchors);
      return; // don't also tick iTime this same frame; next frame starts steady-state
    }
    if (!patches) return; // built=true but nothing was planted (gated or no park lots)

    elapsedMs += dt * 1000; // upstream's shader expects milliseconds (grass.vert.glsl:18,20,24-25)
    grassMat.uniforms.iTime.value = elapsedMs;
    applyVisibility(); // cheap; re-checks the quality gate every tick (see MIN_QUALITY_LEVEL)
  });
}

registerModule("grass", initGrass);
