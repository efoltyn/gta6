/* ============================================================
   entities/pedinstance.js — SHADOW-RIG INSTANCING for full-rig people.

   THE MEASUREMENT (2026-08-03, M1 Pro, seed 90210, in-game perfReport,
   calm scenario). core/profile.js renderAttribution:
       full                = 5354 draw calls
       withoutPedsAndCops  =  329 draw calls
   i.e. 560 live full rigs (CBZ.cityPeds + CBZ.cityCops) were spending
   ~5,025 of the frame's 5,354 draw calls — 94% of everything the renderer
   was asked to do, for ~228 rigs that actually passed peds.js's 95 m
   VIS_D2 draw gate. render.avgCpuMs was 76 ms of a 121 ms frame. Each rig
   built by entities/character.js makeCharacter is ~22 SEPARATE meshes
   (pelvis, chest, waist, collar, 2 arms x upper/lower/hand, 2 legs x
   upper/lower/shoe, head, 4 face boxes, hair/cap, badge, stripes...), and
   every one of them is its own draw call because it is its own Object3D.

   WHY THIS WORKS HERE AND NOWHERE ELSE. materials.js hands out CACHED,
   SHARED geometry (boxGeom keyed on "w,h,d") and CACHED, SHARED materials
   (cmat keyed on colour|emissive|ei). Every adult male civilian therefore
   builds his chest out of the SAME BoxGeometry instance as every other
   adult male civilian. That is the precondition for instancing and it is
   already true — this file adds no geometry, no material and no state, it
   only stops asking the renderer to draw the same buffer 560 times.

   THE HOUSE PATTERN IS city/crowd.js. That file proved InstancedMesh with
   per-instance tint in this codebase (760 ambient bodies for ~11 draw
   calls) and its two hard-won lessons are copied verbatim below:
     (1) PRE-SEED EVERY SLOT WHITE. r128's setColorAt lazily allocates a
         ZERO-filled Float32Array, so any instance drawn before its first
         setColorAt renders BLACK (crowd.js hit the mirror-image bug and
         called it "white-pop"). Every new pool is filled with 1.0 the
         instant it is built.
     (2) PARK, DON'T DELETE. A slot whose body died / despawned / walked
         out of the LOD band gets a zero-scale matrix (crowd.js's collapsed
         shattered-pane trick), never a pool rebuild.

   HOW THE HIDE WORKS — AND WHY IT IS `layers`, NOT `visible`.
   The source meshes must stop rendering but must otherwise stay EXACTLY as
   they are, because `visible` on a rig part is LOAD-BEARING GAMEPLAY STATE
   in this repo, not a render hint:
     • systems/gore.js:1041  `if (part.visible === false && !opts.adopt) return false;`
       — pre-hiding a limb would silently disable dismemberment.
     • city/peds.js:2611     `if (limb && limb.visible !== false)` — same for
       the explosion limb-loss roll.
     • city/clothes.js:2343  `mesh.visible = true` on dressed garment parts.
   So `visible` is left completely untouched. Instead each pooled mesh is
   moved to a private LAYER (30) that no camera in this game enables. In
   r128 the layer test and the visibility test are NOT the same thing —
   verified against the vendored build (WebGLRenderer projectObject):
       function At(t,e,n,i){ if(!1===t.visible) return;              // visible: SKIPS CHILDREN
         if(t.layers.test(e.layers)) ...push to render list...       // layers: object only
         const r=t.children; for(...) At(r[t],e,n,i) }               // children ALWAYS recurse
   That difference is the whole design: a pooled head stops drawing while
   an earring, a hat or a bullet-hole decal parented to it keeps drawing
   normally. WebGLShadowMap.renderObject has the identical shape, so a
   pooled part leaves the shadow pass too.

   THE ONE THING LAYERS COSTS US is r128's Raycaster, which ignores
   `visible` but DOES test layers. A full census of every Raycaster in
   src/ found exactly ONE that can reach a ped rig mesh:
   systems/touch.js:859 `tapRay.intersectObjects(objects, true)` (iPad
   tap-to-target). It is paid for with a single line there —
   `tapRay.layers.enable(CBZ.PED_INST_LAYER)` — and nothing else changes.
   EVERY other human hit test in this game is analytic: fpsmode.js
   findActorHit (:1743) is ray-vs-sphere against `a.group.position` plus
   the fixed HEAD_Y 1.50 / TORSO_Y 1.00 / LEG_Y 0.46 offsets, melee is a
   forward cone over `a.pos`, and LOS raycasts only ever hit
   CBZ.losBlockers (static world). No hit test reads a rig mesh's
   geometry, bounds or matrixWorld — bodyRegionAt (:2120) uses the ROOT
   group's worldToLocal, and the one getWorldPosition on `char.head`
   (:1791, aircraft-cabin occupants) works fine on a hidden object.

   MATRICES ARE COMPOSED HERE, NOT READ FROM THE RENDERER. This pass runs
   at onAlways(96) — after every gameplay/animation system has posed the
   rigs and before core/loop.js:107 calls renderer.render. At that instant
   the scene graph's matrixWorlds are still LAST frame's (updateMatrixWorld
   runs inside render), so this file walks each rig itself: updateMatrix on
   every node, then matrixWorld = parent.matrixWorld * matrix, parents
   before children (explicit DFS stack). It deliberately does NOT trust the
   hidden mesh's own matrixWorld — a sibling change that skips
   updateMatrixWorld for non-rendering subtrees must not be able to freeze
   the instanced crowd. The composed matrix is written BACK into
   mesh.matrixWorld so anything that reads it (gore.js's severed-limb
   decompose, getWorldPosition) sees this frame's pose, not last frame's.

   ---- REDESIGN, 2026-08-03 (same day, after the first merged measurement).
   The first cut of this file pooled on GEOMETRY IDENTITY and captured ~3% of
   the target: pedInstanceAudit() came back {pools:17, instancesLive:78,
   drawCallsSaved:61, fallbackMeshes:2331} against ~5,025 ped/cop draw calls.
   TWO separate bugs, both fixed here:

   (1) THE BOX-GROUPS BUG — the bigger one. r128's BoxGeometry calls
   addGroup() SIX TIMES (one per face, for optional per-face materials), so
   `geometry.groups.length === 6` on every single body box. The old
   poolable() refused any geometry with more than one group, which silently
   rejected EVERY box part in the game — the 101 meshes it did pool were the
   merged hair shells and other non-box leftovers. Groups only ever matter
   when `material` is an ARRAY, which poolable() already rejects one line
   earlier, so the check was pure cost. Gone.

   (2) GEOMETRY IDENTITY IS THE WRONG POOL KEY FOR A BOX. materials.js
   boxGeom caches on the exact string "w,h,d", and this rig varies every
   dimension by body profile (charProfile: build "m"/"f", the GROWTH age
   table, statureMul) — so an adult male's chest and a 40-year-old woman's
   chest are two cache entries, and most entries end up shared by fewer than
   MIN_SHARE rigs. Pooling per-entry can only ever produce a long tail.
   A box does not need its own geometry: ONE unit BoxGeometry(1,1,1) maps
   exactly onto any axis-aligned box under an affine local matrix
       L = translate(bbox.centre) * scale(bbox.size)
   and the instance matrix becomes worldMatrix * L. UVs are per-face 0..1 on
   both, so a texture lands identically; normals are axis-aligned and r128's
   defaultnormal_vertex already de-scales instanceMatrix
   (transformedNormal /= vec3(dot(m[0],m[0]), ...)), so non-uniform instance
   scale is handled. L is taken from the BOUNDING BOX and never from
   `geometry.parameters`, because character.js's hair builder and clothes.js
   both `.translate()` box geometries for pivots — parameters would give the
   size but lose the offset. L is computed ONCE PER GEOMETRY (cached on the
   geometry as `_cbzPinL`, so ~40 distinct body dims cost ~40 Matrix4s, not
   one per part) and only after the geometry PROVES it is a true unit-mappable
   box: 1x1x1 segments, 24 verts, every vertex component exactly on a bbox
   face, and every UV exactly 0 or 1. That last test is what excludes
   clothes.js's clothGeom (city/clothes.js:2078 rewrites a BoxGeometry's UVs
   into an atlas sub-rect — remapping it onto the unit cube would paint the
   wrong garment row) and character.js's sculpted hair side panels. Anything
   that fails falls back to the old exact-geometry pooling path, which is
   still correct, just narrower.

   KNOWN COST, STATED HONESTLY. Because the source meshes keep
   `visible === true` (they must — see the layers argument above),
   core/matrixskip.js cannot prune them, so their world matrices are
   composed TWICE per frame: once here, once by the renderer's own
   updateMatrixWorld. That is roughly two Matrix4 multiplies per pooled
   part — a fraction of a millisecond against ~5,000 draw calls removed,
   and the trade is deliberate. The clean follow-up, if it ever matters, is
   for matrixskip.js to learn the pooled-and-already-composed mark rather
   than for this file to start lying about `visible`.

   WHAT STAYS A REAL MESH (the fallback path, counted by the audit):
     • any part whose (geometry, material-class, shadow-flags) combo is
       used by fewer than MIN_SHARE=4 rigs — rare gear, one-off props, a
       uniquely-painted garment. Instancing a pool of two is a loss.
     • transparent / multi-material / invisible-material parts (sorting).
     • held weapons and hand/weapon sockets — they hang off socket GROUPS,
       are per-weapon unique, and are not part of the 22-mesh body.
     • the PLAYER. CBZ.player's rig is not in cityPeds/cityCops and is
       never touched: first person is sacred (owner mandate) and one rig is
       not a draw-call problem.

   EMISSIVE. The brief for this file assumed reactions.js still flashed a
   hit actor's head emissive (which cannot vary per instance). It does not
   any more — reactions.js:268 is explicit: "a hit writes NO head color and
   NO emissive, ever (owner doctrine)". So no whitening hack is needed. The
   general answer is cheaper AND more faithful: emissive+intensity are part
   of the POOL KEY, so if any future system does light a part up, that part
   simply re-keys into its own (correctly emissive) pool for the duration
   and re-keys back. Intensity is quantised to 0.1 so a smooth ramp cannot
   spray pools, and MAX_POOLS caps the blast radius by falling back to real
   meshes.

   DETERMINISM: render-only. No RNG of any kind, no writes to any
   simulation field — the only things this file mutates are
   mesh.layers.mask, mesh.matrixWorld/matrix (recomputed from state it did
   not author) and its own InstancedMesh buffers.

   REVERT: CBZ.CONFIG.PED_INSTANCED = false, or ?cfg_PED_INSTANCED=0.
   The flag is honoured LIVE — flipping it at runtime restores every
   source mesh's layer mask on the next frame and empties the pools, so
   the owner can A/B it without a reload.

   PROBE: CBZ.pedInstanceAudit() → {pools, instancesLive, drawCallsSaved,
   rigsTracked, fallbackMeshes, ...}.

   MEASURING IT: core/profile.js renderAttribution samples
   `withoutPedsAndCops` by hiding each p.group. The pooled draws live
   OUTSIDE those groups (one root, "city-ped-instances", parented to the
   scene), so with this system ON that sample under-reports what people
   cost. Read `full` against a ?cfg_PED_INSTANCED=0 run, or read
   drawCallsSaved from the audit.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  // One-line revert (config.js's cfg_ URL sniffer already ran, so a
  // ?cfg_PED_INSTANCED=0 value is present here and wins over this default).
  if (CBZ.CONFIG.PED_INSTANCED == null) CBZ.CONFIG.PED_INSTANCED = true;

  /* The private hide layer. 30, not 31: (1 << 31) is NEGATIVE in JS and
     Layers.test does a bitwise AND on a signed int. Layers already in use
     elsewhere and deliberately avoided: 1 (systems/simulation.js's strategy
     map camera), 2 (world/water_underwater.js FX_LAYER). Published so
     systems/touch.js can let its tap raycaster reach hidden rig meshes. */
  const HIDE_LAYER = 30;
  const HIDE_MASK = 1 << HIDE_LAYER;
  CBZ.PED_INST_LAYER = HIDE_LAYER;

  const MIN_SHARE = 4;      // a combo must be shared by >= 4 rigs to be worth a pool
  const MAX_POOLS = 160;    // blast-radius cap; past it, parts stay real meshes
  const START_CAP = 64;     // initial instance capacity (doubles on demand)
  // Per-pool ceiling. With the unit-box remap a single pool legitimately
  // holds one skin-coloured box for every head/arm/hand/face box on ~600
  // rigs, so the old 8192 was inside the working set, not outside it.
  const MAX_CAP = 65536;

  const WHITE = new THREE.Color(1, 1, 1);
  const _col = new THREE.Color();
  const _park = new THREE.Matrix4().makeScale(0, 0, 0);   // degenerate → zero pixels
  const _inst = new THREE.Matrix4();                      // scratch: world * L

  // The ONE geometry every axis-aligned body box is drawn from.
  let _unit = null;
  function unitBox() {
    if (!_unit && THREE.BoxGeometry) { _unit = new THREE.BoxGeometry(1, 1, 1); _unit._shared = true; }
    return _unit;
  }

  /* ---- THE WHITE COLOUR ATTRIBUTE — WITHOUT IT EVERY BODY IS BLACK -------
     This file's first cut set `vertexColors = true` on the pool material (it
     has to: r128's color_fragment applies vColor only under USE_COLOR, so
     instanceColor is uploaded and IGNORED without it) and then trusted
     Material.defaultAttributeValues to stand in for the missing `color`
     attribute. It does not exist on a MeshLambertMaterial — in the vendored
     r128 build that field is assigned in the ShaderMaterial constructor and
     NOWHERE else, so WebGLBindingStates' fallback branch
         else if ( void 0 !== defaultAttributeValues ) { ...vertexAttrib3fv... }
     never runs and `color` keeps the WebGL generic default (0,0,0,1). Then
         color_vertex : vColor = vec3(1.0);  #ifdef USE_COLOR vColor *= color;
         color_fragment: diffuseColor.rgb *= vColor;
     multiplies every pooled ped part by ZERO. Every instanced NPC in the city
     rendered as a black silhouette; only the parts instancing REFUSED (the
     fallback meshes) kept their colour.

     The house answer is city/crowd.js's `tintUnit` — that file hit this exact
     bug, named it "the black faces", and fixed it by baking a white `color`
     attribute into the geometry it instances. Same fix here, with one
     difference: a pool may draw a SHARED game geometry (the "G" bucket), and
     mutating a CBZ.boxGeom cache entry would hand a stray `color` attribute
     to every static prop built from that box — enough to make a mid-play
     BufferGeometryUtils merge (occupy.js) fail on mismatched attribute sets.
     So the white attribute goes on a companion geometry that REFERENCES the
     source's own attribute objects (same GPU buffers, no vertex data copied)
     and is cached on the source, one per geometry ever. */
  function tintGeo(g) {
    if (!g || !g.attributes || !g.attributes.position) return g;
    if (g.attributes.color) return g;                    // already tintable
    if (g._cbzTintGeo) return g._cbzTintGeo;
    let t;
    try {
      t = new THREE.BufferGeometry();
      for (const name in g.attributes) t.setAttribute(name, g.attributes[name]);
      if (g.index) t.setIndex(g.index);
      const white = new Float32Array(g.attributes.position.count * 3);
      white.fill(1);
      t.setAttribute("color", new THREE.BufferAttribute(white, 3));
      t.name = (g.name || "pedinst") + "~tint";
      t._shared = true;            // the rig teardown sweeps must never dispose it
    } catch (e) { t = g; }         // degrade-safe: worst case is today's behaviour
    g._cbzTintGeo = t;
    return t;
  }

  let poolRoot = null;
  const pools = new Map();          // key -> pool
  const rigs = new Map();           // rig root Group -> rig record
  let stamp = 0;                    // frame counter used as a liveness mark
  let hiddenMeshes = 0;             // source meshes currently on the hide layer
  let fallbackMeshes = 0;           // meshes we looked at but left real
  let armed = false;                // true once anything has been hidden

  // ---- pooling policy ---------------------------------------------------

  /* A part is poolable only if it is an ordinary opaque single-material
     mesh. Everything rejected here keeps drawing exactly as it does today
     (that is the point of a fallback: the worst case is the status quo). */
  function poolable(o) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
    const g = o.geometry, m = o.material;
    if (!g || !m || Array.isArray(m)) return false;
    if (m.visible === false || m.transparent === true) return false;
    if (g.morphAttributes && g.morphAttributes.position) return false;
    // A geometry carrying its OWN vertex colours would be multiplied a second
    // time by the pool material's vertexColors:true. Rare, and not worth a
    // special case — leave it real.
    if (g.attributes && g.attributes.color) return false;
    /* NOTE for the next reader: `g.groups.length > 1` is NOT a rejection.
       r128 BoxGeometry emits SIX groups (one per face) and every body box in
       this game is one, so testing it here rejected the entire population —
       that was the first cut's headline bug. Groups are only consulted by the
       renderer when `material` is an array, which is rejected two lines up. */
    return true;
  }

  /* Is this geometry a TRUE axis-aligned box that the shared unit cube can
     stand in for, and if so what is the local matrix that reshapes the cube
     into it? Returns a cached Matrix4, or null for "pool this one on its own
     geometry". Cached on the GEOMETRY (not the mesh): boxGeom hands the same
     instance to every rig with the same dimensions, so ~40 distinct body
     sizes cost ~40 Matrix4s instead of one per part.

     The proof is deliberately paranoid, because a false positive silently
     paints the wrong thing on a person:
       • declared BoxGeometry with 1x1x1 segments and 24 verts;
       • EVERY vertex component sits exactly on a bounding-box face (this is
         what rejects character.js's tapered hair side panels, which are built
         as BoxGeometry and then have their positions rewritten);
       • EVERY uv component is exactly 0 or 1 (this is what rejects
         city/clothes.js clothGeom, a BoxGeometry whose UVs are remapped into
         a garment-atlas sub-rect at clothes.js:2078);
       • non-degenerate on all three axes.
     The bounding box — never `geometry.parameters` — supplies both the size
     AND the centre, so a geometry that was `.translate()`d for a pivot maps
     correctly. */
  const EPS = 1e-6;
  function boxLocal(g) {
    if (g._cbzPinL !== undefined) return g._cbzPinL;
    let L = null;
    const par = g.parameters, at = g.attributes;
    const pos = at && at.position, uv = at && at.uv;
    if (g.type === "BoxGeometry" && par && unitBox() &&
        par.widthSegments === 1 && par.heightSegments === 1 && par.depthSegments === 1 &&
        pos && pos.count === 24 && uv && uv.count === 24) {
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
      if (sx > EPS && sy > EPS && sz > EPS) {
        let ok = true;
        for (let i = 0; i < 24; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if ((Math.abs(x - bb.min.x) > EPS && Math.abs(x - bb.max.x) > EPS) ||
              (Math.abs(y - bb.min.y) > EPS && Math.abs(y - bb.max.y) > EPS) ||
              (Math.abs(z - bb.min.z) > EPS && Math.abs(z - bb.max.z) > EPS)) { ok = false; break; }
          const u = uv.getX(i), v = uv.getY(i);
          if ((Math.abs(u) > EPS && Math.abs(u - 1) > EPS) ||
              (Math.abs(v) > EPS && Math.abs(v - 1) > EPS)) { ok = false; break; }
        }
        if (ok) {
          L = new THREE.Matrix4().makeScale(sx, sy, sz);
          L.setPosition((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
        }
      }
    }
    g._cbzPinL = L;
    return L;
  }

  /* The pool identity. Colour is DELIBERATELY absent — it rides as
     per-instance instanceColor, which is the whole reason one pool can
     serve a street of differently-dressed people. Everything else that
     changes how the surface rasterises has to be in here or two unlike
     parts would render as one. Computed only on (re)bind, never per frame.

     For a unit-mappable box the geometry drops out of the key entirely (the
     "B" bucket): shape is carried by the instance matrix, so a toddler's arm
     and a soldier's chest share one pool if they share a material class.
     Everything else keeps the exact-geometry bucket ("G" + uuid). */
  function keyOf(o, L) {
    const g = o.geometry, m = o.material;
    return (L ? "B" : "G" + g.uuid) + "|" + m.type +
      "|" + (m.map ? m.map.uuid : "-") +
      "|" + (m.emissive ? m.emissive.getHex() : 0) +
      "|" + Math.round((m.emissiveIntensity != null ? m.emissiveIntensity : 1) * 10) +
      "|" + (m.roughness != null ? m.roughness : -1) +
      "|" + (m.metalness != null ? m.metalness : -1) +
      "|" + (m.alphaTest || 0) + "|" + (m.side | 0) + "|" + (m.opacity != null ? m.opacity : 1) +
      "|" + (m.flatShading ? 1 : 0) + "|" + (m.fog === false ? 0 : 1) +
      "|" + (m.depthWrite === false ? 0 : 1) +
      "|" + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) +
      "|" + (o.renderOrder | 0);
  }

  // ---- pools ------------------------------------------------------------

  function root() {
    if (poolRoot || !CBZ.scene) return poolRoot;
    poolRoot = new THREE.Group();
    poolRoot.name = "city-ped-instances";
    // Identity, frozen: instance matrices are then WORLD matrices verbatim
    // (modelMatrix = instancedMesh.matrixWorld * instanceMatrix).
    poolRoot.matrixAutoUpdate = false;
    CBZ.scene.add(poolRoot);
    return poolRoot;
  }

  function makePool(o, key, L) {
    if (pools.size >= MAX_POOLS) return null;
    const src = o.material;
    /* The pool material is a CLONE with colour forced white and
       vertexColors on. Two reasons, both r128-specific:
       - the shared cmat/mat cache entries must never be mutated (batch.js
         and gfx.js both key behaviour off `_shared`), and
       - in r128 the fragment multiply by vColor is gated on USE_COLOR,
         which comes from material.vertexColors. Without it instanceColor
         is uploaded and ignored.
       vertexColors alone is HALF the contract: USE_COLOR also makes the
       vertex shader multiply by the `color` attribute, so the pool geometry
       must carry a white one or every instance renders black. That is what
       tintGeo() above supplies, and it is the same fix city/crowd.js's
       tintUnit carries for the same reason. */
    const mat = src.clone();
    if (mat.color) mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    mat._shared = false;              // ours alone; never handed to the caches
    const p = {
      // A box pool draws the SHARED unit cube; every other pool draws the
      // exact geometry its members carry. Both go through tintGeo so the
      // instance tint has a white attribute to multiply (see above).
      key: key, geo: tintGeo(L ? unitBox() : o.geometry), mat: mat, box: !!L,
      cast: !!o.castShadow, recv: !!o.receiveShadow, order: o.renderOrder | 0,
      mesh: null, cap: 0, next: 0, free: [],
      recs: [], active: false, mDirty: false, cDirty: false, live: 0,
    };
    pools.set(key, p);
    return p;
  }

  /* Grow by doubling. r128 InstancedMesh capacity is fixed at construction,
     so growth means a new mesh + a straight typed-array copy of both
     buffers. Slot indices are preserved, so no record has to be touched. */
  function ensureCap(p, need) {
    if (p.mesh && need < p.cap) return true;
    let cap = p.cap || START_CAP;
    while (cap <= need) cap *= 2;
    if (cap > MAX_CAP) return false;
    // Claim the parent BEFORE disposing anything: a half-grown pool with its
    // old mesh already destroyed would draw nothing at all.
    const r = root(); if (!r) return false;
    const im = new THREE.InstancedMesh(p.geo, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = p.cast; im.receiveShadow = p.recv;
    im.renderOrder = p.order;
    im.frustumCulled = false;         // the pool spans the whole street
    im.matrixAutoUpdate = false;      // root is identity; nothing to compose
    im.name = "pedinst:" + p.key.slice(0, 8);
    // Allocate instanceColor NOW (setColorAt sizes it off this.count) and
    // seed it WHITE — see the crowd.js black/white-pop note in the header.
    im.setColorAt(0, WHITE);
    im.instanceColor.array.fill(1);
    if (im.instanceColor.setUsage) im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Every slot starts PARKED, so a slot that is allocated but not written
    // this frame can never flash an identity-matrix body at the origin.
    for (let i = 0; i < cap; i++) im.setMatrixAt(i, _park);
    if (p.mesh) {
      im.instanceMatrix.array.set(p.mesh.instanceMatrix.array);
      if (p.mesh.instanceColor) im.instanceColor.array.set(p.mesh.instanceColor.array);
      if (poolRoot) poolRoot.remove(p.mesh);
      p.mesh.dispose();               // buffers only — geometry/material are shared
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    r.add(im);
    p.mesh = im; p.cap = cap;
    return true;
  }

  // ---- hiding -----------------------------------------------------------

  function hide(rec) {
    if (rec.hidden) return;
    rec.savedMask = rec.mesh.layers.mask;
    rec.mesh.layers.mask = HIDE_MASK;
    rec.hidden = true; hiddenMeshes++; armed = true;
  }
  function show(rec) {
    if (!rec.hidden) return;
    // Only restore if nobody else has since rewritten the mask — a foreign
    // write is authoritative over ours.
    if (rec.mesh.layers.mask === HIDE_MASK) rec.mesh.layers.mask = rec.savedMask || 1;
    rec.hidden = false; hiddenMeshes--;
  }

  /* Object3D.copy() carries layers.mask across, so a CLONE of a hidden rig
     part is born invisible. systems/gore.js:1093 clones a severed limb for
     the flying gib — it calls this so the gib renders. Public + guarded so
     any future cloner can do the same in one line. */
  CBZ.pedInstanceReveal = function (obj) {
    if (!obj || !obj.traverse) return obj;
    obj.traverse(function (o) { if (o.layers && o.layers.mask === HIDE_MASK) o.layers.mask = 1; });
    return obj;
  };

  /* ---- ANSWERING FOR OURSELVES ----------------------------------------
     CBZ.pedInstanceDraws(mesh) -> true | false | null

     WHY THIS HAD TO BE EXPORTED. This file introduced a way for a body part
     to stop drawing that NOTHING else in the engine can observe. Every other
     "is this part missing" test in the repo — and city/clothes.js's
     clothMeshRenders() is THE one, shared by cityClothesBare(), the
     CITY_OUTFIT_GUARANTEE repair sweep and outfitIntegrityAudit() — reads
     `visible`, `parent`, geometry and material. A pooled part passes all four
     while rendering nothing, because what stopped it was `layers`. Measured on
     seed 90210: 334 garment meshes on the hide layer, clothMeshRenders() calls
     334 of them healthy, and the audit prints bare 0. So the guarantee that
     exists precisely to stop a body rendering with a hole in it is structurally
     blind to the newest thing that can put one there, and would stay blind
     however many times somebody ran it (CLAUDE.md: "an audit nobody has
     executed is not a measurement" — this is its sibling, an audit that cannot
     measure).

     THE ANSWER IS DELIBERATELY THREE-VALUED:
       null  — not ours. The mesh is not on our layer, so the caller's own
               test is the whole truth (and is byte-identical to today).
       true  — ours AND being carried: either a live instance holds this
               frame's pose, or we PARKED THE WHOLE RIG on purpose because
               nobody is drawing that body. A deliberate park is not a hole;
               reporting it as one would have the repair sweep rebuild bodies
               that are off-screen, every sweep, forever.
       false — ours, the rig is being drawn, and this part has no live
               instance behind it. That is a hole in a person, and it is the
               only state this function exists to name.

     CBZ.pedInstanceRelease(mesh) hands a part BACK: it drops our record,
     frees the slot and restores the layer mask, so the mesh draws itself
     again. A repair must use this rather than pedInstanceReveal — clearing
     the mask alone would leave `rec.hidden` true, and part()'s
     `if (!rec.hidden) hide(rec)` would then never re-hide it, so the body
     would draw twice for the rest of its life. */
  CBZ.pedInstanceDraws = function (mesh) {
    if (!mesh || !mesh.layers || mesh.layers.mask !== HIDE_MASK) return null;
    const rec = mesh._pinst;
    if (!rec || rec.dead) return false;             // hidden by us, nothing owns it
    if (rec.rig && rec.rig.parked) return true;     // whole body parked on purpose
    if (rec.parked || rec.slot < 0) return false;
    const p = rec.pool;
    if (!p || !p.active || !p.mesh || rec.slot >= p.mesh.count) return false;
    return true;
  };
  CBZ.pedInstanceRelease = function (mesh) {
    const rec = mesh && mesh._pinst;
    if (rec && !rec.dead) release(rec);
    else if (mesh && mesh.layers && mesh.layers.mask === HIDE_MASK) mesh.layers.mask = 1;
    return mesh;
  };

  // ---- slot binding -----------------------------------------------------

  function bind(rig, o) {
    const L = boxLocal(o.geometry);
    const key = keyOf(o, L);
    let p = pools.get(key);
    if (!p) {
      p = makePool(o, key, L);
      // Pool table full. Don't rebuild this mesh's key string every frame
      // for the rest of its life — try again in a few seconds, in case a
      // pool frees up (a whole archetype despawning, a wardrobe change).
      if (!p) { o._pinstSkip = stamp + 180; return null; }
    }
    const m = o.material;
    const rec = {
      mesh: o, pool: p, rig: rig, slot: -1, hidden: false, savedMask: 1,
      parked: true, dead: false, stamp: stamp,
      geo: o.geometry, mat: m, map: m.map || null, L: L,
      cr: -1, cg: -1, cb: -1,                                  // last uploaded tint
      er: m.emissive ? m.emissive.r : 0, eg: m.emissive ? m.emissive.g : 0,
      eb: m.emissive ? m.emissive.b : 0,
      ei: m.emissiveIntensity != null ? m.emissiveIntensity : 1,
      pi: p.recs.length, ri: rig.recs.length,
    };
    o._pinst = rec;
    p.recs.push(rec);
    rig.recs.push(rec);
    /* MIN_SHARE gate: a pool only switches on once enough rigs share the
       combo to be worth one draw call plus the per-frame matrix upload.
       Once ON it stays on (hysteresis — a pool flickering across the
       threshold would strobe bodies), and every later member joins live. */
    if (!p.active) {
      if (p.recs.length >= MIN_SHARE) {
        p.active = true;
        for (let i = 0; i < p.recs.length; i++) acquire(p.recs[i]);
      }
    } else acquire(rec);
    return rec;
  }

  function acquire(rec) {
    const p = rec.pool;
    if (rec.slot >= 0) return true;
    const reused = p.free.length > 0;
    const slot = reused ? p.free.pop() : p.next;
    // Past MAX_CAP the pool refuses to grow: the mesh simply keeps drawing
    // itself, which is the pre-instancing behaviour and therefore safe.
    if (!ensureCap(p, slot)) { if (reused) p.free.push(slot); return false; }
    if (!reused) p.next++;
    rec.slot = slot;
    rec.cr = rec.cg = rec.cb = -1;    // force a colour upload on first write
    // NOT hidden here. A slot still holds its parked matrix until part()
    // writes this frame's pose into it, and a body that is hidden one frame
    // before its instance exists is a one-frame hole in a person. hide() is
    // called from part(), immediately after the matrix lands.
    return true;
  }

  function park(rec) {
    if (rec.parked) return;
    rec.parked = true;
    const p = rec.pool;
    if (rec.slot >= 0 && p.mesh) { p.mesh.setMatrixAt(rec.slot, _park); p.mDirty = true; }
  }

  // Swap-pop out of BOTH indexes (its pool and its rig) so neither list can
  // grow without bound as parts re-key across a long session.
  function release(rec) {
    if (rec.dead) return;
    const p = rec.pool, r = rec.rig;
    park(rec);
    show(rec);
    if (rec.slot >= 0) { p.free.push(rec.slot); rec.slot = -1; }
    let last = p.recs.pop();
    if (last && last !== rec) { last.pi = rec.pi; p.recs[rec.pi] = last; }
    last = r.recs.pop();
    if (last && last !== rec) { last.ri = rec.ri; r.recs[rec.ri] = last; }
    if (rec.mesh._pinst === rec) rec.mesh._pinst = null;
    rec.dead = true;
  }

  // ---- the per-frame pass -----------------------------------------------

  const _stack = [];

  /* Walk one rig, composing world matrices ourselves, parents before
     children (pop-order DFS guarantees it). An invisible subtree is skipped
     whole: that is how gore.js's severed limb and peds.js's blown-off limb
     stop drawing — their `visible` flag is untouched by this file, so the
     instanced copy disappears for exactly the same reason the real mesh
     used to. */
  function walk(rig, g) {
    const st = _stack;
    st.length = 0;
    const c0 = g.children;
    for (let i = 0; i < c0.length; i++) st.push(c0[i]);
    while (st.length) {
      const o = st.pop();
      if (o.visible === false) continue;
      if (o.matrixAutoUpdate) o.updateMatrix();
      // Compose from the PARENT'S freshly-written matrixWorld, never from
      // this node's own (which may be a frame stale, or never written at
      // all if something skips updateMatrixWorld for non-rendering trees).
      o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      o.matrixWorldNeedsUpdate = false;
      if (o.isMesh) part(rig, o);
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) st.push(ch[i]);
    }
  }

  function part(rig, o) {
    let rec = o._pinst;
    if (rec && rec.dead) { o._pinst = null; rec = null; }
    if (!poolable(o)) { if (rec) release(rec); fallbackMeshes++; return; }
    const m = o.material;
    if (rec) {
      // Cheap identity/emissive drift check — a garment swap (clothes.js),
      // a gfx.js Lambert->Standard tier swap, or a future emissive flash all
      // land here and simply re-key into the right pool. All comparisons are
      // reference or raw-float: no getHex(), no string, no allocation.
      const em = m.emissive;
      if (rec.geo !== o.geometry || rec.mat !== m || rec.map !== (m.map || null) ||
          rec.ei !== (m.emissiveIntensity != null ? m.emissiveIntensity : 1) ||
          (em && (em.r !== rec.er || em.g !== rec.eg || em.b !== rec.eb))) {
        release(rec); rec = null;
      }
    }
    if (!rec) {
      if (o._pinstSkip > stamp) { fallbackMeshes++; return; }
      rec = bind(rig, o);
      if (!rec) { fallbackMeshes++; return; }
    }
    rec.stamp = stamp;
    const p = rec.pool;
    // Below MIN_SHARE (or out of capacity) the part keeps drawing itself —
    // the fallback IS the old behaviour, so a refusal can never look wrong.
    if (!p.active || rec.slot < 0) { fallbackMeshes++; return; }
    /* The instance matrix is world * L — L reshapes the shared unit cube
       into THIS part's box. o.matrixWorld itself is left as the TRUE part
       transform (walk() wrote it a moment ago), because gore.js decomposes
       it for the flying limb and getWorldPosition callers read it; folding L
       into it would hand them a body-sized object at a corner offset. */
    p.mesh.setMatrixAt(rec.slot, rec.L ? _inst.multiplyMatrices(o.matrixWorld, rec.L) : o.matrixWorld);
    p.mDirty = true;
    rec.parked = false;
    p.live++;
    if (!rec.hidden) hide(rec);       // the instance now carries this pose
    const c = m.color;
    if (c && (c.r !== rec.cr || c.g !== rec.cg || c.b !== rec.cb)) {
      rec.cr = c.r; rec.cg = c.g; rec.cb = c.b;
      _col.setRGB(c.r, c.g, c.b);
      p.mesh.setColorAt(rec.slot, _col);
      p.cDirty = true;
    }
  }

  /* An ancestor Group going invisible (mode switch, arena teardown, a
     building interior hiding its occupants) must park the bodies inside it
     — the rig's own group.visible is only half the story. Four or five
     links, once per rig, once per frame. */
  function chainVisible(o) {
    let n = o;
    while (n) { if (n.visible === false) return false; n = n.parent; }
    return true;
  }

  function rigOf(g) {
    let r = rigs.get(g);
    if (!r) { r = { group: g, recs: [], stamp: stamp, parked: false }; rigs.set(g, r); }
    return r;
  }

  function parkRig(r) {
    if (r.parked) return;
    r.parked = true;
    for (let i = 0; i < r.recs.length; i++) park(r.recs[i]);
  }

  // release() swap-pops out of r.recs, so draining from the tail terminates.
  function emptyRig(r) {
    while (r.recs.length) {
      const rec = r.recs[r.recs.length - 1];
      if (rec.dead) { r.recs.pop(); continue; }
      release(rec);
    }
  }
  function dropRig(r) { emptyRig(r); rigs.delete(r.group); }

  let _lastParent = null;
  /* FAR-RIG SYNC STAGGER — the full rig walk (updateMatrix + matrixWorld
     compose + setMatrixAt per part) is this file's whole per-frame cost, and
     it was being paid for every body in the 95m band every frame. A ped 40m+
     away re-posing at 20Hz instead of 60Hz is not a visible difference, so
     far rigs only walk on their phase frame (group.id spreads the phases so
     the load is flat, not spiky). Everything that must stay same-frame DOES:
     the culled/parent/visibility park gates above run every frame, a rig
     leaving the list still drops the same frame via the sweep, and a skipped
     rig's instances simply keep last frame's pose — sweepRig leaves them
     alone instead of mis-reading the skip as "part went missing" and parking
     the body. ?cfg_PED_SYNC_STAGGER=0 reverts to every-frame walks. */
  const FAR_SYNC_D2 = 40 * 40, SYNC_K = 3;
  let _px = 0, _pz = 0, _stagger = false, _own = 0;
  function scan(list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a) continue;
      const g = a.group;
      if (!g || !g.isObject3D) continue;
      const r = rigOf(g);
      r.stamp = stamp;
      if (a.culled || !g.parent || !chainVisible(g)) { parkRig(r); continue; }
      if (_stagger && !r.parked && (stamp + g.id) % SYNC_K !== 0) {
        const dx = g.position.x - _px, dz = g.position.z - _pz;
        if (dx * dx + dz * dz > FAR_SYNC_D2) {
          r.skipStamp = stamp;
          // held pose is still OURS — keep the render walk off this subtree
          if (_own) g._cbzMatrixOwnedFrame = _own;
          continue;
        }
      }
      // Ancestors first. Rigs overwhelmingly share ONE parent (the arena
      // root), so cache it and pay the walk-to-scene once per frame.
      const pg = g.parent;
      if (pg !== _lastParent) { pg.updateWorldMatrix(true, false); _lastParent = pg; }
      if (g.matrixAutoUpdate) g.updateMatrix();
      g.matrixWorld.multiplyMatrices(pg.matrixWorld, g.matrix);
      g.matrixWorldNeedsUpdate = false;
      r.parked = false;
      walk(r, g);
      /* MATRIX AUTHORITY: walk() just composed a fresh, correct world matrix
         for every visible node of this rig — the render pass recomputing the
         same ~50 nodes again is pure duplicate work. Stamp the rig root so
         core/matrixskip.js skips the whole subtree this frame (the stamp is
         re-earned every tick; see the handoff note there). Off with
         ?cfg_PED_MATRIX_OWN=0 independently of instancing itself. */
      if (_own) g._cbzMatrixOwnedFrame = _own;
    }
  }

  /* Full teardown — the live revert. Restores every layer mask, empties
     every pool and forgets every rig, so ?cfg_PED_INSTANCED=0 (or flipping
     the flag in the console) gives back the byte-identical old renderer. */
  function killPool(p) {
    if (p.mesh) { if (poolRoot) poolRoot.remove(p.mesh); p.mesh.dispose(); p.mesh = null; }
  }
  function teardown() {
    rigs.forEach(emptyRig);
    rigs.clear();
    pools.forEach(killPool);
    pools.clear();
    hiddenMeshes = 0; fallbackMeshes = 0; armed = false;
    _lastParent = null;
  }

  // Hoisted so the per-frame Map.forEach passes allocate no closures.
  const _gone = [];
  function resetLive(p) { p.live = 0; }
  /* Park what the walk did not reach, and REAP what it has not reached for a
     while. The reap is what stops two slow leaks that a park alone cannot:
     a mesh DETACHED from the rig (clothes.js reparents garment meshes,
     gore.js strips sockets) would otherwise sit hidden and slot-holding
     forever — and if it were ever re-attached elsewhere it would come back
     invisible; and a rig that walked out of peds.js's 95 m band would hold
     pool capacity that near bodies need. Releasing restores the source
     mesh's layer mask and frees its slot; coming back into view simply
     re-binds. Iterating backwards is safe with release()'s swap-pop, since
     the element swapped in comes from the tail we have already passed. */
  const STALE = 240;
  function sweepRig(r) {
    if (r.stamp !== stamp) { _gone.push(r); return; }
    if (r.skipStamp === stamp) return;   // far rig on an off-phase frame: instances hold last pose
    const recs = r.recs;
    for (let i = recs.length - 1; i >= 0; i--) {
      const rec = recs[i];
      if (rec.stamp === stamp) continue;
      if (stamp - rec.stamp > STALE) release(rec);
      else park(rec);
    }
  }
  function uploadPool(p) {
    if (!p.mesh) return;
    if (p.mesh.count !== p.next) p.mesh.count = p.next;   // never draw beyond high water
    if (p.mDirty) { p.mesh.instanceMatrix.needsUpdate = true; p.mDirty = false; }
    if (p.cDirty && p.mesh.instanceColor) { p.mesh.instanceColor.needsUpdate = true; p.cDirty = false; }
  }

  function tick() {
    if (CBZ.CONFIG.PED_INSTANCED === false) { if (armed || pools.size) teardown(); return; }
    if (!THREE.InstancedMesh || !CBZ.scene) return;      // headless → no-op
    stamp++;
    _lastParent = null;
    fallbackMeshes = 0;
    const P = CBZ.player;
    _stagger = !!(P && P.pos) && CBZ.CONFIG.PED_SYNC_STAGGER !== false;
    if (_stagger) { _px = P.pos.x; _pz = P.pos.z; }
    // the loop bumps CBZ._matrixOwnStamp once per frame; a stamp equal to it
    // is only ever good for THIS frame, so nothing here needs a teardown path
    _own = CBZ.CONFIG.PED_MATRIX_OWN !== false ? (CBZ._matrixOwnStamp || 0) : 0;
    pools.forEach(resetLive);
    scan(CBZ.cityPeds);
    scan(CBZ.cityCops);
    // Park anything the walk did not reach this frame (a severed limb, a
    // subtree someone hid, a rig that stopped drawing) and retire the rigs
    // that left the lists — a despawn/cull must vanish on the SAME frame,
    // never linger as a frozen body (crowd.js's collapse contract).
    _gone.length = 0;
    rigs.forEach(sweepRig);
    for (let i = 0; i < _gone.length; i++) dropRig(_gone[i]);
    // One upload per dirty buffer per frame — never per instance.
    pools.forEach(uploadPool);
  }

  // LATE, just before core/loop.js:107 renders: every pose/animation/
  // reaction system has already written this frame (HUD sits at 94,
  // gfx material sync at 94.5, cockpit frustum at 94.6/95, sky at 99 —
  // none of them move a ped rig). Registered on the ALWAYS chain so the
  // bodies keep their pose while the game is paused.
  if (CBZ.onAlways) CBZ.onAlways(96, tick);

  /* ---- RATCHET ---------------------------------------------------------
     drawCallsSaved is the honest number: the instances actually drawn this
     frame minus the pools drawn to carry them. Pin it against the measured
     5,025 ped/cop draw calls.

     `fallbackMeshes` is the ratchet that matters. It counts parts instancing
     REFUSED this frame, and it is how this system decays silently: the first
     merged measurement read fallbackMeshes 2331 / drawCallsSaved 61 because
     one over-cautious `groups.length > 1` test was rejecting every box in
     the game. If it climbs again, something stopped being poolable — a
     per-ped material, a transparent garment, a geometry that stopped being a
     provable box. `boxPools` should stay a small number (material classes,
     not body sizes); if it starts tracking the population, the unit-box
     remap has stopped matching and every part is falling into its own
     exact-geometry pool again. */
  CBZ.pedInstanceAudit = function () {
    let active = 0, capacity = 0, live = 0, boxPools = 0, blackPools = 0;
    pools.forEach(function (p) {
      capacity += p.cap;
      // THE BLACK-BODY GUARD: vertexColors with no `color` attribute paints
      // the whole pool black (see tintGeo). Must stay 0, forever.
      if (p.mat && p.mat.vertexColors && p.geo && p.geo.attributes && !p.geo.attributes.color) blackPools++;
      if (p.active && p.mesh && p.next > 0) {
        active++; live += p.live;
        if (p.box) boxPools++;          // drawing the shared unit cube
      }
    });
    return {
      on: CBZ.CONFIG.PED_INSTANCED !== false,
      layer: HIDE_LAYER,
      pools: active,
      boxPools: boxPools,               // active pools drawing the shared unit cube
      blackPools: blackPools,           // RATCHET: pools that would render black. Pin at 0.
      poolsTotal: pools.size,
      instancesLive: live,
      // Every source mesh currently parked on the hide layer, INCLUDING the
      // ones whose rig is outside peds.js's 95 m draw band (those were not
      // costing a draw call before either, which is why the honest
      // frame-accurate saving below is measured off the LIVE instances).
      hiddenMeshes: hiddenMeshes,
      drawCallsSaved: Math.max(0, live - active),
      rigsTracked: rigs.size,
      fallbackMeshes: fallbackMeshes,
      capacity: capacity,
      minShare: MIN_SHARE,
      maxPools: MAX_POOLS,
    };
  };
})();
