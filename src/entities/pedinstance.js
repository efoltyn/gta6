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
   chest are two cache entries, and most entries end up shared by a handful
   of rigs. Pooling per-entry can only ever produce a long tail.
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
     • a WHOLE BODY, never part of one: if any poolable part of a rig cannot
       get a pool slot (table or capacity full), the entire rig draws itself
       that frame (placeRig — the owner's "hands but no shirt or pants" was a
       body split between the two mechanisms). There is no share threshold any
       more: a pool of one costs the one draw call the real mesh would have,
       and a threshold is what split rare-outfit bodies in the first place.
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

  // Live-combo cap; past it a body that needs a new pool draws itself WHOLE
  // (see placeRig). 700 posted peds in every wardrobe want ~440 live pools
  // (tools/human-audit.mjs) — each is one draw call, against ~22 per real rig.
  const MAX_POOLS = 1024;
  const START_CAP = 16;     // initial instance capacity (doubles on demand); most combos hold a few bodies
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

  /* ---- TEXTURE PAGES: ONE POOL PER SHAPE, NOT PER SHAPE x OUTFIT ----------
     THE MEASUREMENT (tools/human-audit.mjs, 2026-09-28, the 864-body crowd,
     right after the outfit remake ca969395): 1,748 distinct pool keys wanted
     against the 1,024-pool table, so every body whose last combo came late
     drew itself whole — fallbackMeshes 5,823 -> 10,729, instancesLive
     19,891 -> 14,723. The same crowd with the map left OUT of the key is 345
     keys. The texture was the whole multiplier: city/clothes.js paints ONE
     128x256 atlas per outfit key (the remake added ~30 more of them), every
     garment part's UVs index the SAME layout whatever the outfit (clothGeom /
     limbPainter never read the outfit), and the key was geometry x map — so
     each body shape was a pool per outfit it wore.

     So a pool no longer holds a texture, it holds a PAGE: a big texture the
     small textures are copied into, slot by slot, and each instance carries
     its slot as a per-instance UV offset+scale (attribute `pinUv`, applied to
     vUv right after uv_vertex). The pixels are the same pixels (1:1 copy,
     smoothing off), each slot is ringed with a gutter of its own edge texels
     (8 px where the texture mips, 1 px where it does not) so bilinear and the
     first mip levels never reach a neighbour, and the page carries the
     source's filter/mip/encoding settings (a class per setting set, so a
     no-mip yoke never shares a page with a mipped jacket). Nothing about the
     SOURCE changes: its material and texture are untouched, a body that draws
     itself (the fallback, the player, every non-city game) samples its own
     128x256 canvas exactly as before. Shadows are unaffected: r128's depth
     pass ignores `map` unless an alphaMap is set.

     Only the plain case is paged — a canvas map, ClampToEdge, flipY, identity
     UV transform, no second map sharing vUv. Anything else keeps the old
     exact-map key (still correct, just narrower). Page memory: pages are 2048
     wide and double in height as they fill (a full 2048x2048 page holds 98
     outfit atlases; the 864-body audit crowd needs 5 pages, ~pageMB in
     pedInstanceAudit()). The per-outfit textures of pooled bodies never
     upload at all (their meshes sit on the hide layer), so GPU memory is
     roughly a wash.

     PAGES ARE PIXELS IN A TYPED ARRAY, NEVER A CANVAS (owner, 2026-09-29, on
     the iPad: "the Secret Service now have no torso and no arms and no legs.
     It's basically like the outfit is nil"). The first cut kept every page
     as a 2048-wide <canvas> (the audit crowd: 14 of them, 173 MB) and sent
     each new slot up as texSubImage2D FROM A CANVAS with UNPACK_FLIP_Y. Both
     halves are exactly the ground iOS WebKit fails on without a word: its
     canvas budget is capped, and a canvas made or grown past the cap is a
     context that draws nothing and reads back all-transparent; and a sub-
     image upload from a canvas is the one path that never ran headless. An
     outfit first worn late in a session (the President's detail's black
     suit arrives when you take office, long after the street's outfits went
     up at boot) went to its slot through that path, so its slot on the GPU
     held alpha 0, the garment material's alphaTest 0.5 threw away every
     fragment of it, and the only parts left were the ones no page carries:
     the flat skin head and hands. A torso, arms and legs that do not exist.

     So a page is now a THREE.DataTexture over a Uint8Array (GL row order,
     flipY off; slot math unchanged: image row y is texture v = 1 - y / PH).
     A slot is filled from the source's own pixels (getImageData on its 2D
     context; clothes.js atlases are willReadFrequently, so that read is
     free) with the edge-texel gutter built in the array, written into the
     page array (so a full upload, a grow and a WebGL context restore all
     carry it), and sent up as texSubImage2D FROM THAT ARRAY — the one
     upload path WebGL defines the same on every browser. A source whose
     pixels cannot be read, or read back with no opaque texel at all (a dead
     canvas), is NOT paged: it keeps its own exact-map pool, which draws
     exactly what the source would draw by itself. Paging can therefore never
     make a garment vanish that the unpaged renderer would have shown. */
  const PAGE_MAX = 2048, PAGES_PER_CLASS = 6;
  const pageClasses = new Map();    // settings key -> class { w, h, g, sw, sh, PW, PH0, cols, pages }
  const slotOf = new Map();         // source texture uuid -> slot
  let pageSeq = 0, pageCopies = 0, pageFullUploads = 0, pageRefused = 0;
  const _pagePos = new THREE.Vector2();
  let _pageSrc = null;              // the texSubImage2D source: { isDataTexture, image: { data, width, height } }

  const VUV_MAPS = ["alphaMap", "emissiveMap", "bumpMap", "normalMap", "specularMap", "displacementMap",
    "roughnessMap", "metalnessMap", "lightMap", "aoMap", "gradientMap", "clearcoatMap", "clearcoatNormalMap",
    "clearcoatRoughnessMap", "transmissionMap", "sheenColorMap"];
  const PAGED_TYPES = { MeshLambertMaterial: 1, MeshPhongMaterial: 1, MeshStandardMaterial: 1, MeshPhysicalMaterial: 1, MeshBasicMaterial: 1, MeshToonMaterial: 1 };
  function pageable(m) {
    const t = m.map;
    if (!t || !t.isTexture || t.isDataTexture || t.isCompressedTexture || t.isVideoTexture || t.isCubeTexture) return false;
    if (!PAGED_TYPES[m.type]) return false;
    for (let i = 0; i < VUV_MAPS.length; i++) if (m[VUV_MAPS[i]]) return false;
    const im = t.image;
    if (!im || typeof im.getContext !== "function" || !(im.width > 0) || !(im.height > 0) || im.width > 512 || im.height > 512) return false;
    if (t.wrapS !== THREE.ClampToEdgeWrapping || t.wrapT !== THREE.ClampToEdgeWrapping || t.flipY !== true) return false;
    if (t.offset.x !== 0 || t.offset.y !== 0 || t.repeat.x !== 1 || t.repeat.y !== 1 || t.rotation !== 0 || t.matrixAutoUpdate === false) return false;
    // the array holds straight 8-bit RGBA, which is what a canvas uploads as
    // under these settings and nothing else
    if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType || t.premultiplyAlpha) return false;
    return true;
  }
  function pageClass(t) {
    const im = t.image, w = im.width, h = im.height;
    const mips = t.generateMipmaps !== false && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter;
    const key = w + "x" + h + "|" + t.minFilter + "|" + t.magFilter + "|" + (mips ? 1 : 0) + "|" + t.anisotropy + "|" + t.encoding;
    let C = pageClasses.get(key);
    if (C !== undefined) return C;
    const g = mips ? 8 : 1, sw = w + 2 * g, sh = h + 2 * g;
    /* A page is PAGE_MAX wide and starts one slot-row tall (power of two,
       so WebGL1 still mips it); it DOUBLES IN HEIGHT as its class fills
       (growPage), so a class with a dozen textures (faces, eyes) costs a
       strip, not a 16 MB square, and a class with a hundred (the outfit
       atlases) still ends up on one page — one pool per shape. */
    const PW = PAGE_MAX;
    let PH0 = 64;
    while (PH0 < sh && PH0 < PAGE_MAX) PH0 *= 2;
    C = null;
    if (Math.floor(PW / sw) >= 4 && Math.floor(PAGE_MAX / sh) >= 2) {
      C = { key: key, w: w, h: h, g: g, sw: sw, sh: sh, PW: PW, PH0: PH0, cols: Math.floor(PW / sw),
        pages: [], proto: t, block: new Uint8Array(sw * sh * 4) };
    }
    pageClasses.set(key, C);
    return C;
  }

  function pageImage(C, PH, data) { return { data: data || new Uint8Array(C.PW * PH * 4), width: C.PW, height: PH }; }
  function newPage(C) {
    const s = C.proto, img = pageImage(C, C.PH0);
    const t = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.flipY = false; t.premultiplyAlpha = false; t.unpackAlignment = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = s.minFilter; t.magFilter = s.magFilter; t.generateMipmaps = s.generateMipmaps;
    t.anisotropy = s.anisotropy; t.encoding = s.encoding;
    t.name = "pedinst-page";
    t._shared = true;
    t.needsUpdate = true;
    const P = { id: ++pageSeq, cls: C, data: img.data, tex: t, PH: C.PH0, next: 0, cap: C.cols * Math.floor(C.PH0 / C.sh), slots: [] };
    /* ONE COPY OF A FULL PAGE: once a page is at its full height (it can no
       longer grow, so nothing will ever need its pixels back in JS) and on
       the GPU, its CPU array goes; every later slot is written straight into
       the texture (copyTextureToTexture). 16 MB per full page, measured 18 MB
       live on the phone. A lost context reloads (CBZ.freedStaticArrays). */
    t.onUpdate = function () {
      if (P.PH < PAGE_MAX || !P.data || CBZ.CONFIG && CBZ.CONFIG.TEX_FREE === false) return;
      P.data = null; t.image.data = null; P.gpuOnly = true;
      CBZ.freedStaticArrays = true;
    };
    C.pages.push(P);
    return P;
  }

  // image row y (from the top) is texture v = 1 - y / PH
  function slotUv(s) {
    const P = s.page, C = P.cls;
    return [(s.x + C.g) / C.PW, 1 - (s.y + C.g + C.h) / P.PH, C.w / C.PW, C.h / P.PH];
  }

  /* Double a full page's height. Rows are stored bottom-up (GL order), so the
     old page is the TOP of the new one: every slot keeps its image position,
     only the normalised v of each slot moves, so every live instance on the
     page gets its pinUv rewritten here (a rare event: a handful per session). */
  function growPage(P) {
    const C = P.cls;
    if (P.PH >= PAGE_MAX) return false;
    // a page that has already grown to 512 rows is a busy class: it goes
    // straight to its full height (every doubling on the way was a copy of
    // the page left as garbage: 24 MB of it at boot, measured), and at full
    // height it drops its CPU copy once uploaded (newPage's onUpdate)
    const PH = P.PH >= 512 ? PAGE_MAX : P.PH * 2, img = pageImage(C, PH);
    img.data.set(P.data, (PH - P.PH) * C.PW * 4);
    P.data = img.data; P.PH = PH;
    P.cap = C.cols * Math.floor(PH / C.sh);
    P.tex.image = img;
    P.tex.needsUpdate = true;
    pageFullUploads++;
    for (let i = 0; i < P.slots.length; i++) P.slots[i].uv = slotUv(P.slots[i]);
    pools.forEach(function (p) {
      if (p.page !== P || !p.uv) return;
      for (let i = 0; i < p.recs.length; i++) {
        const rec = p.recs[i];
        if (rec.slot >= 0 && rec.ps) p.uv.array.set(rec.ps.uv, rec.slot * 4);
      }
      p.uDirty = true;
    });
    return true;
  }

  /* The source's own pixels, straight RGBA rows top-down, or null when they
     cannot be read (no 2D context, a tainted canvas) or hold no opaque texel
     at all — a canvas the browser never gave a backing store reads back all
     zero, and paging that would be paging a hole. */
  function sourcePixels(t, C) {
    const im = t && t.image;
    if (!im || im.width !== C.w || im.height !== C.h) return null;
    let d = null;
    try {
      const ctx = im.getContext("2d");
      d = ctx && ctx.getImageData ? ctx.getImageData(0, 0, C.w, C.h).data : null;
      // a self-painting canvas (core/texfree.js) is not needed once copied here
      if (d && t._cbzRelease) t._cbzRelease();
    } catch (e) { d = null; }
    if (!d || d.length !== C.w * C.h * 4) return null;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return d;
    return null;
  }

  // copy the source into its slot (1:1 body + edge-texel gutter) in the page
  // array, then to the GPU. `px` = sourcePixels(). Returns false if unreadable.
  function paintSlot(s, px) {
    const P = s.page, C = P.cls;
    px = px || sourcePixels(s.tex, C);
    if (!px) return false;
    const w = C.w, h = C.h, g = C.g, sw = C.sw, sh = C.sh, B = C.block;
    // block row j (GL order, bottom-up) is slot image row sh-1-j; the gutter
    // repeats the nearest edge texel (clamped), corners included
    for (let j = 0; j < sh; j++) {
      const sy = Math.min(h - 1, Math.max(0, sh - 1 - j - g));
      const srow = sy * w * 4, brow = j * sw * 4;
      for (let bx = 0; bx < sw; bx++) {
        const si = srow + Math.min(w - 1, Math.max(0, bx - g)) * 4, bi = brow + bx * 4;
        B[bi] = px[si]; B[bi + 1] = px[si + 1]; B[bi + 2] = px[si + 2]; B[bi + 3] = px[si + 3];
      }
    }
    const y0 = P.PH - s.y - sh;                 // the slot's first GL row
    const D = P.data, PW4 = C.PW * 4;
    if (D) for (let j = 0; j < sh; j++) D.set(B.subarray(j * sw * 4, (j + 1) * sw * 4), (y0 + j) * PW4 + s.x * 4);
    s.ver = s.tex.version;
    // incremental upload once the page lives on the GPU (the array already
    // holds the slot for any later full upload); otherwise the whole page
    // goes up with its next (or first) upload
    const R = CBZ.renderer, T = P.tex;
    if (R && R.copyTextureToTexture && R.properties) {
      const pr = R.properties.get(T);
      if (pr && pr.__webglInit && pr.__version === T.version) {
        if (!_pageSrc) _pageSrc = { isDataTexture: true, image: { data: null, width: 0, height: 0 } };
        _pageSrc.image.data = B; _pageSrc.image.width = sw; _pageSrc.image.height = sh;
        try {
          R.copyTextureToTexture(_pagePos.set(s.x, y0), _pageSrc, T);
          pageCopies++;
          return true;
        } catch (e) { /* fall through to the whole-page upload */ }
      }
    }
    // a GPU-only page cannot be uploaded whole again (its array is gone)
    if (P.gpuOnly) return false;
    T.needsUpdate = true;
    pageFullUploads++;
    return true;
  }

  function freeSlotOf(t) {
    const s = slotOf.get(t.uuid);
    if (s && s.tex === t) { slotOf.delete(t.uuid); s.tex = null; }
  }
  function onSourceDispose(ev) { freeSlotOf(ev.target); }

  /* The slot holding this texture, allocating (or re-copying) as needed; null
     when the texture is not pageable, its pixels cannot be read, or every page
     of its class is full of slots still worn by somebody. */
  function takeCell(C) {
    for (let i = 0; i < C.pages.length; i++) {
      const P = C.pages[i];
      if (P.next >= P.cap) continue;
      const k = P.next++;
      const s = { page: P, x: (k % C.cols) * C.sw, y: ((k / C.cols) | 0) * C.sh, tex: null, ver: -1, refs: 0, last: 0, uv: null };
      P.slots.push(s);
      return s;
    }
    return null;
  }
  // a slot nobody wears: an orphan (its source was disposed) first, then —
  // only when every page is full — the one worn least recently
  function reuseSlot(C, orphansOnly) {
    let best = null;
    for (let i = 0; i < C.pages.length; i++) {
      const sl = C.pages[i].slots;
      for (let j = 0; j < sl.length; j++) {
        const c = sl[j];
        if (c.refs > 0 || (orphansOnly && c.tex)) continue;
        if (!best || (!c.tex && best.tex) || ((!c.tex) === (!best.tex) && c.last < best.last)) best = c;
      }
    }
    if (best && best.tex) freeSlotOf(best.tex);
    return best;
  }
  function slotFor(t) {
    let s = slotOf.get(t.uuid);
    if (s && s.tex === t) {
      const im = t.image, C = s.page.cls;
      if (!im || im.width !== C.w || im.height !== C.h) freeSlotOf(t);   // resized: re-slot below
      else { if (s.ver !== t.version) paintSlot(s); return s; }
    }
    const C = pageClass(t);
    if (!C) return null;
    const px = sourcePixels(t, C);
    if (!px) { pageRefused++; return null; }      // unreadable or blank: its own exact-map pool draws it as-is
    s = takeCell(C) || reuseSlot(C, true);
    // grow before opening a new page: every page is a pool per shape
    for (let i = 0; !s && i < C.pages.length; i++) if (growPage(C.pages[i])) s = takeCell(C);
    if (!s && C.pages.length < PAGES_PER_CLASS && newPage(C)) s = takeCell(C);
    if (!s) s = reuseSlot(C, false);
    if (!s) return null;
    s.tex = t;
    s.uv = slotUv(s);
    slotOf.set(t.uuid, s);
    if (!t._cbzPageHooked) { t._cbzPageHooked = true; t.addEventListener("dispose", onSourceDispose); }
    paintSlot(s, px);
    return s;
  }

  // vUv lands in the slot: after uv_vertex (which already applied the page's
  // identity uvTransform), scale+offset by this instance's pinUv
  function pagePatch(shader) {
    shader.vertexShader = "attribute vec4 pinUv;\n" + shader.vertexShader.replace(
      "#include <uv_vertex>",
      "#include <uv_vertex>\n#ifdef USE_UV\n\tvUv = vUv * pinUv.zw + pinUv.xy;\n#endif");
  }
  // the wrapper a paged pool draws: the (shared) base geometry's own buffers,
  // plus this pool's own per-instance slot attribute
  function pagedGeo(base) {
    const g = new THREE.BufferGeometry();
    for (const name in base.attributes) g.setAttribute(name, base.attributes[name]);
    if (base.index) g.setIndex(base.index);
    g.name = (base.name || "pedinst") + "~paged";
    g._shared = true;
    return g;
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
    // an attachment that asks to draw itself (entities/jewelry_kit.js: a chain
    // draped per body shape would take a pool per shape and push whole bodies
    // out of instancing when the table fills)
    if (o.userData && o.userData.pedInstSkip) return false;
    const g = o.geometry, m = o.material;
    if (!g || !m || Array.isArray(m)) return false;
    if (m.visible === false || m.transparent === true) return false;
    if (g.morphAttributes && g.morphAttributes.position) return false;
    // A geometry carrying its OWN vertex colours poolS only when its material
    // already draws them (vertexColors:true): r128's color_vertex multiplies
    // the attribute by instanceColor, and the pool's instance colour is the
    // material colour — so a white-material vertex-coloured mesh (the police
    // duty kit, entities/dutykit.js: one merged belt/holster/radio/badge per
    // officer) draws byte-identical, and every officer of one body shape and
    // kit shares a single draw. A colour attribute on a material that IGNORES
    // it would be applied by the pool and not by the source: leave it real.
    if (g.attributes && g.attributes.color && m.vertexColors !== true) return false;
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
    // A LOFTED LIMB (entities/character.js LIMBS) is the same trick with a
    // different unit shape: its geometry is a canonical loft baked through one
    // affine L, and it says so. The canonical is drawn, L rides the instance.
    if (g._cbzUnit && g._cbzUnit.L && g._cbzUnit.geo) return g._cbzUnit.L;
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
  function keyOf(o, L, ps) {
    const g = o.geometry, m = o.material;
    return (L ? (g._cbzUnit ? "U" + g._cbzUnit.geo.uuid : "B") : "G" + g.uuid) + "|" + m.type +
      "|" + (ps ? "P" + ps.page.id : m.map ? m.map.uuid : "-") +
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

  function makePool(o, key, L, ps) {
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
    // A box pool draws the SHARED unit cube; every other pool draws the
    // exact geometry its members carry. Both go through tintGeo so the
    // instance tint has a white attribute to multiply (see above).
    let geo = tintGeo(L ? (o.geometry._cbzUnit ? o.geometry._cbzUnit.geo : unitBox()) : o.geometry);
    if (ps) {
      // a PAGED pool (TEXTURE PAGES above): the page is the map, each
      // instance's slot rides pinUv, and the geometry is this pool's own
      // wrapper so the per-instance attribute is not shared with other pools
      mat.map = ps.page.tex;
      mat.onBeforeCompile = pagePatch;
      mat.customProgramCacheKey = function () { return "pedinst-page"; };
      geo = pagedGeo(geo);
    }
    const p = {
      key: key, geo: geo, mat: mat, paged: !!ps, page: ps ? ps.page : null, uv: null, uDirty: false,
      box: !!L && !o.geometry._cbzUnit, unit: !!(L && o.geometry._cbzUnit),
      cast: !!o.castShadow, recv: !!o.receiveShadow, order: o.renderOrder | 0,
      mesh: null, cap: 0, next: 0, free: [],
      recs: [], mDirty: false, cDirty: false, live: 0,
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
    if (p.paged) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      if (p.uv) a.array.set(p.uv.array);
      p.geo.setAttribute("pinUv", a);
      p.uv = a; p.uDirty = true;
    }
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
    if (!p || !p.mesh || rec.slot >= p.mesh.count) return false;
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
    const ps = pageable(o.material) ? slotFor(o.material.map) : null;
    const key = keyOf(o, L, ps);
    let p = pools.get(key);
    if (!p) {
      p = makePool(o, key, L, ps);
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
      ps: ps,                                                  // texture page slot (paged pools only)
    };
    if (ps) { ps.refs++; ps.last = stamp; }
    o._pinst = rec;
    p.recs.push(rec);
    rig.recs.push(rec);
    acquire(rec);
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
    if (p.paged && rec.ps) { p.uv.array.set(rec.ps.uv, slot * 4); p.uDirty = true; }
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
    if (rec.ps) { rec.ps.refs--; rec.ps.last = stamp; }
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
  const _parts = [];                // this rig's visible meshes, filled by walk()
  function walk(rig, g) {
    const st = _stack;
    st.length = 0;
    _parts.length = 0;
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
      if (o.isMesh) _parts.push(o);
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) st.push(ch[i]);
    }
    placeRig(rig);
  }

  /* ---- A BODY IS DRAWN WHOLE, BY ONE MECHANISM, OR NOT BY THIS FILE ------
     Owner (2026-09-27): "some female characters (female security) have an
     INVISIBLE BODY: hands but no shirt or pants."

     This pass used to decide PART BY PART. A part whose combo had a live pool
     went to the hide layer and was drawn by the pool; a part whose combo did
     not (below MIN_SHARE, or the pool table already full) stayed a real mesh.
     So a person could be — and in a live city MOST people were — drawn by two
     unrelated mechanisms at once: head, hands and shoes (a handful of combos
     every body in the city shares, pooled on the first frames of the session)
     by InstancedMeshes under the scene root, and the garments (one combo per
     outfit atlas x body shape, hundreds of them) by the rig's own meshes.
     Measured headless (tools/human-audit.mjs's live stage, 700 posted peds,
     2026-09-27): the 160-pool table was full within the first frame, every
     head / hand / shoe was pooled and ~40-50% of all torso, sleeve and
     trouser meshes were real. A body split like that is one render-time
     disagreement away from exactly the owner's picture — anything that stops
     the rig's own subtree drawing after this pass ran (a group hidden later in
     the frame, a culled or stale mesh) leaves the pooled hands, head and
     shoes standing in the street with nothing between them. It skewed to
     women because a woman is a second set of box shapes: every painted outfit
     on her is a combo of its own, so more of her garments than a man's landed
     past the full table (the audit's 540-body crowd before this change: all
     270 women split, 239 of 270 men).

     So the rule is now per BODY: every poolable part of the rig is carried by
     a live pool slot this frame, or the rig draws itself — all of it, the
     pre-instancing renderer, which cannot split. Parts that are not poolable
     at all (a transparent prop, a multi-material gun) are attachments that
     always drew themselves and still do. */
  function claim(rig, o) {
    let rec = o._pinst;
    if (rec && rec.dead) { o._pinst = null; rec = null; }
    if (!poolable(o)) { if (rec) release(rec); return null; }
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
      } else if (rec.ps && rec.ps.ver !== rec.map.version) {
        // the source canvas was repainted: re-copy its slot (or re-bind if
        // the slot no longer belongs to it)
        if (rec.ps.tex === rec.map) paintSlot(rec.ps);
        else { release(rec); rec = null; }
      }
    }
    if (!rec) {
      if (o._pinstSkip > stamp) return false;
      rec = bind(rig, o);
      if (!rec) return false;
    }
    rec.stamp = stamp;
    return rec;
  }
  function placeRig(rig) {
    let whole = true, stamped = 0;
    for (let i = 0; i < _parts.length; i++) {
      const rec = claim(rig, _parts[i]);
      _parts[i] = rec;                                    // the mesh is rec.mesh from here on
      if (rec === false) whole = false;                   // poolable, but no pool would take it
      else if (rec) { if (rec.rig === rig) stamped++; if (rec.slot < 0) whole = false; }
    }
    // every record this rig holds was reached this frame: sweepRig has
    // nothing to park or reap, so it can skip the second pass over them
    if (stamped === rig.recs.length) rig.clean = stamp;
    if (!whole) {
      // The whole body draws itself this frame: nothing on the hide layer,
      // no instance left holding a pose. It re-checks every frame, so the
      // moment its last combo gets a live pool the body moves over in one go.
      for (let i = 0; i < _parts.length; i++) {
        const rec = _parts[i];
        if (!rec) continue;
        park(rec); show(rec);
      }
      fallbackMeshes += _parts.length;
      rig.selfDrawn = true;
      return;
    }
    rig.selfDrawn = false;
    for (let i = 0; i < _parts.length; i++) {
      const rec = _parts[i];
      if (!rec) { fallbackMeshes++; continue; }           // an attachment that was never poolable
      const o = rec.mesh, p = rec.pool, m = o.material;
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
  }

  /* An ancestor Group going invisible (mode switch, arena teardown, a
     building interior hiding its occupants) must park the bodies inside it
     — the rig's own group.visible is only half the story. Four or five
     links, once per rig, once per frame. */
  function underRoot(o, root) {
    for (let n = o; n; n = n.parent) if (n === root) return true;
    return false;
  }
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
      /* A BODY RIDING SOMETHING NEVER HOLDS A POSE. The held pose is a WORLD
         pose, and a rig attached to a car/boat/plane (npclife.js) is carried
         by a parent that moves every frame — so on the two skipped frames of
         three a traffic driver was drawn where the car WAS, 0.3-0.9 m behind
         the moving cabin (owner: "you see them outside the car, slightly
         behind it"). Worse, the distance test below reads g.position, which
         for an attached rig is the seat offset in the car's frame (~0.5 m),
         i.e. the player's distance from the world ORIGIN — so every seated
         body in the city was being staggered, near or far. Attached rigs walk
         every frame; there are only ever a handful in view. */
      if (_stagger && !r.parked && !a._npcAttached && (stamp + g.id) % SYNC_K !== 0) {
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
    if (r.clean === stamp) return;       // the walk reached every record (placeRig counted them)
    // A PARKED body draws nothing, and every one of its records was parked
    // when it was (parkRig): the only work left here is the reap (STALE, or a
    // part taken off), and a reap that lands a few frames later on a body
    // nobody is drawing is invisible. Once per 8 frames, phased by id so the
    // culled crowd is not all swept on one frame.
    if (r.parked && ((stamp + r.group.id) & 7) !== 0) return;
    const recs = r.recs;
    for (let i = recs.length - 1; i >= 0; i--) {
      const rec = recs[i];
      if (rec.stamp === stamp) continue;
      // a part taken OFF the body (clothes.js clears a composite tie, a shell
      // is swapped) can never be walked again: hand it back now, or the body
      // counts as half-pooled while it draws itself
      if (stamp - rec.stamp > STALE || !rec.mesh.parent) release(rec);
      else park(rec);
    }
  }
  function uploadOrRetire(p, key) {
    if (!p.recs.length) { killPool(p); pools.delete(key); return; }
    uploadPool(p);
  }
  function uploadPool(p) {
    if (!p.mesh) return;
    if (p.mesh.count !== p.next) p.mesh.count = p.next;   // never draw beyond high water
    // Upload only the slots in use: a pool's capacity is a power of two past
    // its high water, and with one pool per live combo (hundreds of them, many
    // holding a single body) whole-capacity uploads were mostly empty slots.
    // Every slot ever written is < p.next, so [0, next) is the whole truth.
    if (p.mDirty) {
      const a = p.mesh.instanceMatrix;
      a.updateRange.offset = 0; a.updateRange.count = p.next * 16;
      a.needsUpdate = true; p.mDirty = false;
    }
    if (p.uDirty && p.uv) {
      const u = p.uv;
      u.updateRange.offset = 0; u.updateRange.count = p.next * 4;
      u.needsUpdate = true; p.uDirty = false;
    }
    if (p.cDirty && p.mesh.instanceColor) {
      const c = p.mesh.instanceColor;
      c.updateRange.offset = 0; c.updateRange.count = p.next * 3;
      c.needsUpdate = true; p.cDirty = false;
    }
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
    // One upload per dirty buffer per frame — never per instance. A pool
    // nobody belongs to any more is RETIRED here: the table is a cap on the
    // combos alive now, not on every combo the session has ever seen (it used
    // to fill with the dead keys of every re-dress and never empty, which is
    // what left every body spawned later half-pooled).
    pools.forEach(uploadOrRetire);
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
    let active = 0, capacity = 0, live = 0, boxPools = 0, unitPools = 0, blackPools = 0, pagedPools = 0;
    let pages = 0, pageSlots = 0, pageTexels = 0;
    pageClasses.forEach(function (C) { if (!C) return; pages += C.pages.length; for (const P of C.pages) { pageSlots += P.next; pageTexels += C.PW * P.PH; } });
    pools.forEach(function (p) {
      capacity += p.cap;
      if (p.paged && p.mesh && p.next > 0) pagedPools++;
      // THE BLACK-BODY GUARD: vertexColors with no `color` attribute paints
      // the whole pool black (see tintGeo). Must stay 0, forever.
      if (p.mat && p.mat.vertexColors && p.geo && p.geo.attributes && !p.geo.attributes.color) blackPools++;
      if (p.mesh && p.next > 0) {
        active++; live += p.live;
        if (p.box) boxPools++;          // drawing the shared unit cube
        if (p.unit) unitPools++;        // drawing a shared canonical limb loft
      }
    });
    return {
      on: CBZ.CONFIG.PED_INSTANCED !== false,
      layer: HIDE_LAYER,
      pools: active,
      boxPools: boxPools,               // active pools drawing the shared unit cube
      unitPools: unitPools,             // active pools drawing a canonical limb loft (character.js LIMBS)
      pagedPools: pagedPools,           // active pools sampling a texture PAGE (one pool per shape, not per outfit)
      pages: pages, pageSlots: pageSlots, // page textures and the source textures copied into them
      pageMB: Math.round(pageTexels * 4 / 1e5) / 10, // level-0 RGBA bytes of every page (mips add a third)
      pageCopies: pageCopies, pageFullUploads: pageFullUploads,
      pageRefused: pageRefused,         // sources left unpaged: unreadable, or read back with no opaque texel (a dead canvas)
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
      maxPools: MAX_POOLS,
      // RATCHET: tracked rigs being drawn part-pooled, part-real. placeRig
      // makes this 0 by construction; it is counted so nobody can quietly
      // bring the per-part decision back. Pin at 0.
      splitRigs: countSplit(),
      // bodies drawing themselves whole because a pool could not take them
      // (table or capacity full). Evidence, not an invariant — expect 0.
      selfDrawnRigs: countSelfDrawn(),
    };
  };
  function countSplit() {
    let n = 0;
    rigs.forEach(function (r) {
      if (r.parked) return;                       // not being drawn by anyone
      let pooled = 0, real = 0;
      for (let i = 0; i < r.recs.length; i++) {
        const rec = r.recs[i];
        if (rec.dead) continue;
        // only parts that DRAW count: a parked record (a part taken off the
        // body, hidden by its owner, or waiting out STALE) draws nothing by
        // either mechanism, so it cannot split a body
        // …and a part taken off WITH its holder (a hat group removed from the
        // head: the mesh still has a parent, the group has none) is not on
        // this body at all, so it draws nothing either
        if (rec.parked && (rec.hidden || !chainVisible(rec.mesh) || !rec.mesh.parent || !underRoot(rec.mesh, r.group))) continue;
        if (rec.hidden) pooled++; else real++;
      }
      if (pooled && real) n++;
    });
    return n;
  }
  function countSelfDrawn() { let n = 0; rigs.forEach(function (r) { if (r.selfDrawn && !r.parked) n++; }); return n; }
})();
