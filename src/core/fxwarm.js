/* ============================================================
   core/fxwarm.js — SHADER PROGRAMS: queue them early, use them late.

   Two jobs, one walker.

   1. PLAY-START PREWARM (the first-rocket freeze). three.js r128 compiles a
      material's GLSL program the FIRST time an object using it is drawn, and
      every combat-FX pool (muzzle flashes, tracers, rocket smoke, explosion
      bursts, fireball sprites) sits parked visible=false until the first
      shot — so their programs used to compile mid-fight, a multi-hundred-ms
      freeze on iPad. Once per mode entry, on the first playing frame, every
      material in the ACTIVE world (hidden pools included) is compiled.

   2. BUILD-TIME QUEUE (CBZ.shaderQueue). The vendored three.r128.min.js is
      patched (see its header, THREE.CBZ_LAZY_PROGRAMS) so initMaterial no
      longer asks the driver about a program the instant it links it. With
      renderer.debug.checkShaderErrors=false, compile() now issues
      compileShader/linkProgram and RETURNS; Chrome's GPU process compiles
      while the main thread keeps building the city. The city calls this
      after every landmass builder and after the batch pass, so by the first
      frame most of Gang City's ~290 programs are already linked and the
      first draw only reads them back. Same shaders, same pixels: only WHEN
      the compile happens moved (UE's PSO precaching, in 30 lines).
      Measured 2026-09-28 (tools/speed.mjs, real GPU): first frame + settle
      were 5.8 s of the city's 22 s load, 2.8 s of it getProgramParameter.

   WHAT GETS WALKED. Not `renderer.compile(scene, camera)` any more:
     • it walked the whole scene, so a CITY start compiled the hidden
       prison's and island's programs too (68 + dozens) and, with the queue
       above, would have put them AHEAD of the city's in the GPU's line;
     • it keyed nothing, so every call re-derived a program key for all
       ~160k meshes.
   The walker skips the roots of worlds the current mode is not showing,
   visits each (material, object kind) pair once per material version, and
   hands compile() a stand-in scene that carries the real fog, environment
   and lights but "contains" only the new representatives.

   ANTIFRAGILE, KEPT. `renderer.compile` looks every material up in a
   WeakMap; a mesh whose `.material` is a raw colour integer throws and used
   to abort the walk for everything after it. The walker never hands such a
   mesh to three; it counts it and says so once.

   r128 NOTE: `compileAsync` / KHR_parallel_shader_compile do not exist here
   (r158+). Without the vendor patch this file still works: compile() just
   blocks, exactly as it always did, and the build-time queue stays off
   (blocking there would only move the wait, not hide it).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const LAZY = !!THREE.CBZ_LAZY_PROGRAMS;

  let warmed = "";                 // mode we last compiled for ("" = never)
  CBZ.onAlways(1.2, function () {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return;
    const key = g.mode || "?";
    if (key === warmed) return;
    warmed = key;                  // one attempt per mode entry, success or not
    /* A PAGE THAT IS NOT DRAWING HAS NOTHING TO PRE-COMPILE (?cfg_RENDER_FRAMES=0,
       tools only): every program would be dead work, minutes of it on a
       software rasterizer. */
    if (CBZ.CONFIG && CBZ.CONFIG.RENDER_FRAMES === false) return;
    const r = CBZ.renderer, sc = CBZ.scene, cam = CBZ.camera;
    if (!r || typeof r.compile !== "function" || !sc || !cam) return;
    lastReport = queue(sc, { depth: true });
  });

  // ---- the walker ---------------------------------------------------------
  // material -> { v: material.version, l: light signature, f: bitmask of
  // object kinds queued }. A program key carries the light COUNTS, so a
  // material queued under a different light set is queued again.
  const seen = new WeakMap();
  let lightSig = "";
  function kindBits(o) {
    return (o.isInstancedMesh ? 1 : 0) | (o.isSkinnedMesh ? 2 : 0) | (o.isPoints ? 4 : 0) |
      (o.isLine ? 8 : 0) | (o.isSprite ? 16 : 0) |
      (o.geometry && o.geometry.morphAttributes && o.geometry.morphAttributes.position ? 32 : 0) |
      (o.isInstancedMesh && o.instanceColor ? 64 : 0);   // instancingColor is its own program
  }
  /* ONE REPRESENTATIVE PER PROGRAM, NOT PER MATERIAL. The city has ~17k
     materials (a colour each) behind a few hundred programs, and compile()
     builds the renderer's per-material state (uniforms, properties) for every
     one it is handed, drawn or not: the hidden LOS originals the batch pass
     keeps were most of them, ~27 MB of heap and a good share of the build's
     compile time. A material whose program-shaping signature was already
     compiled under this light set is skipped; the renderer makes its own
     small state the first time it is really drawn (the program exists). The
     signature is the fields that pick an r128 program (type, maps and their
     encodings, vertex colours, fog, side, blending, alpha test, flat shading,
     defines, a custom cache key / onBeforeCompile). */
  const sigSeen = new Set();
  let sigLight = null;
  function texSig(t) { return t ? "T" + (t.encoding | 0) + (t.isCubeTexture ? "c" : "") + (t.mapping | 0) : "-"; }
  function progSig(m, bits) {
    let k = m.type + "|" + bits + "|" + (m.vertexColors ? 1 : 0) + (m.fog ? 1 : 0) + (m.flatShading ? 1 : 0) + (m.transparent ? 1 : 0) +
      (m.alphaTest > 0 ? 1 : 0) + (m.dithering ? 1 : 0) + (m.premultipliedAlpha ? 1 : 0) + (m.toneMapped === false ? 0 : 1) +
      (m.skinning ? 1 : 0) + (m.morphTargets ? 1 : 0) + (m.morphNormals ? 1 : 0) + (m.wireframe ? 1 : 0) + "|" + m.side + "|" + m.blending + "|" + (m.precision || "") +
      "|" + texSig(m.map) + texSig(m.alphaMap) + texSig(m.emissiveMap) + texSig(m.normalMap) + texSig(m.bumpMap) + texSig(m.envMap) +
      texSig(m.lightMap) + texSig(m.aoMap) + texSig(m.specularMap) + texSig(m.displacementMap) + texSig(m.roughnessMap) + texSig(m.metalnessMap) +
      texSig(m.clearcoatMap) + texSig(m.clearcoatNormalMap) + texSig(m.clearcoatRoughnessMap) + texSig(m.transmissionMap) + texSig(m.gradientMap) +
      "|" + (m.normalMapType | 0) + (m.combine | 0) + (m.depthPacking | 0) + (m.sizeAttenuation ? 1 : 0) + (m.clearcoat > 0 ? 1 : 0) + (m.transmission > 0 ? 1 : 0) + (m.sheen ? 1 : 0);
    if (m.defines) { try { k += "|D" + JSON.stringify(m.defines); } catch (e) { k += "|D?"; } }
    if (m.isShaderMaterial || m.isRawShaderMaterial) k += "|S" + m.uuid;                  // custom shaders: always their own
    if (m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) { try { k += "|K" + m.customProgramCacheKey(); } catch (e) { k += "|K" + m.uuid; } }
    if (m.onBeforeCompile && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) k += "|B" + String(m.onBeforeCompile).length + ":" + String(m.onBeforeCompile).slice(0, 64);
    return k;
  }
  function freshProgram(m, bits) {
    if (sigLight !== lightSig) { sigSeen.clear(); sigLight = lightSig; }
    const k = progSig(m, bits);
    if (sigSeen.has(k)) return false;
    sigSeen.add(k);
    return true;
  }
  function fresh(m, bits) {
    const s = seen.get(m);
    if (!s || s.v !== m.version || s.l !== lightSig) { seen.set(m, { v: m.version, l: lightSig, f: bits }); return true; }
    if ((s.f & bits) === bits) return false;
    s.f |= bits;
    return true;
  }

  // The worlds this mode is NOT showing: never compile them for it.
  function hiddenRoots() {
    const out = new Set();
    const add = function (root) { if (root && root.visible === false) out.add(root); };
    add(CBZ.prisonRoot);
    add(CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root);
    add(CBZ.city && CBZ.city.arena && CBZ.city.arena.root);
    return out;
  }

  // A stand-in scene: the real fog/environment/lights, but compile() only
  // "finds" the representatives we give it. isScene keeps three from
  // swapping in its empty default scene (which has no fog → wrong program).
  const STAND_IN = {
    isScene: true, fog: null, environment: null, background: null, overrideMaterial: null,
    _lights: null, _objs: null,
    traverseVisible: function (cb) { const l = this._lights; for (let i = 0; i < l.length; i++) cb(l[i]); },
    traverse: function (cb) { const o = this._objs; for (let i = 0; i < o.length; i++) cb(o[i]); },
  };

  let lastReport = null;

  /* SHADOW-DEPTH PROGRAMS. compile() never builds them: WebGLShadowMap picks
     its own depth material per caster (MeshDepthMaterial, RGBA packing, one
     per morph/skin/instancing combo, side mirrored to the shadow side; or the
     caster's customDepthMaterial) and compiles it inside the first shadow
     render, i.e. in the first frame. Programs are cached by KEY, not by
     material object, so compiling an identical stand-in here, against a
     linear render target like the shadow map's, leaves the shadow pass a
     cache hit. The side mirror is r128's (Front→Back, Back→Front, Double). */
  const SHADOW_SIDE = [1, 0, 2];
  const depthMats = new Map();              // "m|s|side" -> stand-in MeshDepthMaterial
  const depthSeen = new Set();              // variant keys already queued
  let depthRT = null;
  function depthVariant(o, m) {
    const side = m.shadowSide != null ? m.shadowSide : SHADOW_SIDE[m.side || 0];
    const inst = o.isInstancedMesh ? 1 : 0;
    const custom = o.customDepthMaterial;
    if (custom) {
      const key = custom.uuid + "|" + side + "|" + inst;
      if (depthSeen.has(key)) return null;
      depthSeen.add(key);
      custom.side = side;                     // the shadow pass writes the same before every draw
      return custom;
    }
    const g = o.geometry;
    const morph = !!(m.morphTargets && g && g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length);
    const skin = !!(o.isSkinnedMesh && m.skinning);
    const key = (morph ? 1 : 0) + "|" + (skin ? 1 : 0) + "|" + side + "|" + inst;
    if (depthSeen.has(key)) return null;
    depthSeen.add(key);
    const mk = (morph ? 1 : 0) + "|" + (skin ? 1 : 0) + "|" + side;
    let d = depthMats.get(mk);
    if (!d) {
      d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, morphTargets: morph, skinning: skin });
      d.side = side;
      depthMats.set(mk, d);
    }
    return d;
  }
  // `lights` are the frame's pinned lights: the shadow pass draws with the
  // frame's light state, so its program keys carry the same counts and
  // shadowMapEnabled (true only when some light casts).
  let cachedLights = null;
  function subtreeHasLight(roots) {
    const list = Array.isArray(roots) ? roots : [roots];
    let hit = false;
    for (let i = 0; i < list.length && !hit; i++) {
      if (!list[i]) continue;
      list[i].traverse(function (o) { if (!hit && o.isLight && !o.isPointLight && !o.isSpotLight) hit = true; });
    }
    return hit;
  }
  function queueDepth(r, cam, casters, lights) {
    if (!casters.length) return;
    if (!depthRT) {
      depthRT = new THREE.WebGLRenderTarget(1, 1);
      depthRT.texture.name = "fxwarm-depth-standin";
    }
    const prev = r.getRenderTarget();
    const objs = [];
    for (let i = 0; i < casters.length; i++) {
      const o = casters[i][0], d = casters[i][1];
      const px = Object.create(o);           // same geometry and object flags, depth material
      px.material = d;
      objs.push(px);
    }
    STAND_IN.fog = null; STAND_IN.environment = null; STAND_IN._lights = lights; STAND_IN._objs = objs;
    try { r.setRenderTarget(depthRT); r.compile(STAND_IN, cam); }
    catch (e) { try { console.warn("[fxwarm] depth compile threw:", e && e.message); } catch (e2) {} }
    finally { r.setRenderTarget(prev); STAND_IN._lights = null; STAND_IN._objs = null; }
  }

  // Walk `roots` (an Object3D or an array of them; default the whole scene),
  // pick one object per not-yet-queued (material, kind), and compile those.
  // opts.skip(o) → true prunes o's subtree for this call (it will be picked
  // up by a later call once it is ready).
  function queue(roots, opts) {
    const r = CBZ.renderer, sc = CBZ.scene, cam = CBZ.camera;
    const rep = { objects: 0, programsBefore: 0, programs: 0, badMaterials: 0, threw: false };
    if (!r || typeof r.compile !== "function" || !sc || !cam) return rep;
    const skip = opts && opts.skip;
    const hidden = hiddenRoots();
    // THE LIGHT SET. A program key carries light COUNTS only, and lightpin
    // makes the point/spot counts a constant; so the per-builder calls reuse
    // the last full gather (a traverseVisible of a 160k-node scene per builder
    // was ~0.5 s of the build) unless the caller asks for a full pass or the
    // new subtree brings a light of another kind.
    let lights = cachedLights;
    if (!lights || (opts && (opts.full || opts.depth || opts.target)) || !opts || subtreeHasLight(roots)) {
      if (CBZ.lightPinApply) { try { CBZ.lightPinApply(); } catch (e) {} }   // the frame's light counts, now
      lights = [];
      sc.traverseVisible(function (o) { if (o.isLight && o.layers.test(cam.layers)) lights.push(o); });
      cachedLights = lights;
    }
    const n = { D: 0, P: 0, S: 0, H: 0, A: 0, R: 0, s: 0 };
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      if (L.isDirectionalLight) n.D++; else if (L.isPointLight) n.P++; else if (L.isSpotLight) n.S++;
      else if (L.isHemisphereLight) n.H++; else if (L.isRectAreaLight) n.R++; else n.A++;
      if (L.castShadow) n.s++;
    }
    lightSig = n.D + "|" + n.P + "|" + n.S + "|" + n.H + "|" + n.R + "|" + n.s + "|" + (r.shadowMap.enabled ? 1 : 0) + "|" + (sc.fog ? (sc.fog.isFogExp2 ? 2 : 1) : 0) +
      (opts && opts.target ? "|t" + (opts.target.texture ? opts.target.texture.encoding : 0) : "");
    const reps = [];
    const casters = (opts && opts.depth && r.shadowMap && r.shadowMap.enabled) ? [] : null;
    let bad = 0;
    function visit(o) {
      if (hidden.has(o)) return;
      if (skip && skip(o)) return;
      const m = o.material;
      if (casters && o.castShadow && o.visible !== false && (o.isMesh || o.isPoints || o.isLine) && m && m.isMaterial) {
        const d = depthVariant(o, m);
        if (d) casters.push([o, d]);
      }
      if (m) {
        const bits = kindBits(o);
        if (Array.isArray(m)) {
          let ok = true, want = false;
          for (let i = 0; i < m.length; i++) { if (!m[i] || !m[i].isMaterial) { ok = false; break; } }
          if (!ok) bad++;
          else for (let i = 0; i < m.length; i++) if (fresh(m[i], bits)) want = true;
          if (want) reps.push(o);
        } else if (!m.isMaterial) bad++;
        else if (fresh(m, bits) && freshProgram(m, bits)) reps.push(o);
      }
      const k = o.children;
      for (let i = 0; i < k.length; i++) visit(k[i]);
    }
    const list = Array.isArray(roots) ? roots : [roots || sc];
    for (let i = 0; i < list.length; i++) if (list[i]) visit(list[i]);
    rep.objects = reps.length;
    rep.badMaterials = bad;
    rep.programsBefore = (r.info && r.info.programs && r.info.programs.length) || 0;
    if (reps.length) {
      STAND_IN.fog = sc.fog; STAND_IN.environment = sc.environment; STAND_IN.background = sc.background;
      STAND_IN._lights = lights; STAND_IN._objs = reps;
      // opts.target: compile for a render target (a render-to-texture pass keys
      // its programs on the target's encoding, e.g. the cctv feed)
      const tgt = opts && opts.target, prevT = tgt ? r.getRenderTarget() : null;
      try { if (tgt) r.setRenderTarget(tgt); r.compile(STAND_IN, cam); }
      catch (e) { rep.threw = true; try { console.warn("[fxwarm] compile threw:", e && e.message); } catch (e2) {} }
      finally { if (tgt) r.setRenderTarget(prevT); }
      STAND_IN._lights = null; STAND_IN._objs = null;
    }
    if (casters && casters.length) { rep.depth = casters.length; queueDepth(r, cam, casters, lights); }
    // push the queued compile/link commands to the GPU process NOW; left in
    // the command buffer they would wait for this long task to end.
    if (reps.length || (casters && casters.length)) { try { const gl = r.getContext(); if (gl && gl.flush) gl.flush(); } catch (e) {} }
    rep.programs = (r.info && r.info.programs && r.info.programs.length) || 0;
    if (bad) {
      try { console.warn("[fxwarm] " + bad + " object(s) carry a non-Material `.material` (a raw colour?) · skipped"); } catch (e) {}
    }
    return rep;
  }

  // BUILD-TIME QUEUE. Only when the compile does not block (vendor patch) and
  // frames are actually drawn. `root` is walked from child index `from`
  // (cursor per root) so a builder's new children are visited once; call
  // with {full:true} to rewalk everything (after the batch pass).
  // opts: full (rewalk the whole root), depth (also the shadow pass's depth
  // programs), target (compile for that render target: a render-to-texture
  // pass keys programs on its encoding), skip(o) (prune for this call).
  // Anything that is about to draw a new root (a spawned rig, a streamed
  // chunk, a feed camera) can call it a frame early and never hitch.
  const cursors = new WeakMap();
  CBZ.shaderQueue = function (root, opts) {
    if (!LAZY) return null;
    if (CBZ.CONFIG && CBZ.CONFIG.RENDER_FRAMES === false) return null;
    if (!root) return null;
    let objs = root;
    if (!(opts && opts.full)) {
      const from = cursors.get(root) || 0;
      objs = root.children.slice(from);
      cursors.set(root, root.children.length);
      if (!objs.length) return null;
    }
    return queue(objs, opts);
  };
  CBZ.shaderQueueStats = function () { return lastReport; };

  /* THE CAR-ENTRY SET. Getting into a car compiled ~14 programs in its first
     frames (measured: the car bodies' own materials, drawn close for the
     first time, and the water spray/wake shaders): a hitch at the worst
     moment on a phone. Once the city has settled, in idle time, the built
     car templates and the (empty) water FX are queued through the same
     non-blocking compile as everything else. */
  let drivingWarmed = false;
  CBZ.warmDrivingSet = function () {
    if (drivingWarmed || !CBZ.scene || !CBZ.renderer) return null;
    drivingWarmed = true;
    const objs = [];
    try { if (CBZ.cityCarTemplates) CBZ.cityCarTemplates().forEach(function (t) { if (t) objs.push(t); }); } catch (e) {}
    try { if (CBZ.waterFxWarmObjects) CBZ.waterFxWarmObjects().forEach(function (o) { objs.push(o); }); } catch (e) {}
    try { if (CBZ.fitoutWarmObjects) CBZ.fitoutWarmObjects().forEach(function (o) { objs.push(o); }); } catch (e) {}
    try { if (CBZ.carInstancesWarmObjects) CBZ.carInstancesWarmObjects().forEach(function (o) { objs.push(o); }); } catch (e) {}
    if (!objs.length) return null;
    const rep = queue(objs, { full: true });
    CBZ.drivingWarmReport = { at: Math.round(performance.now()), objs: objs.length, rep: rep };
    return rep;
  };
  (function armDrivingWarm() {
    let t = 0;
    const tick = function () {
      const g = CBZ.game;
      if (drivingWarmed) return;
      if (g && g.state === "playing" && g.mode === "city") {
        if ((t += 1) >= 6) {                            // ~3 s into play: the boot's first frames are done
          const go = function () { try { CBZ.warmDrivingSet(); } catch (e) {} };
          if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 2000 }); else go();
          return;
        }
      } else t = 0;
      setTimeout(tick, 500);
    };
    setTimeout(tick, 500);
  })();

  /* ?cfg_PROGRAM_LOG=1 — every new GL program with the light counts in its
     key and who asked for it. The tool for "why did this material compile
     twice": read CBZ.programLog after a boot. Off by default, zero cost. */
  if (CBZ.CONFIG && CBZ.CONFIG.PROGRAM_LOG && CBZ.renderer && CBZ.renderer.info && CBZ.renderer.info.programs) {
    const arr = CBZ.renderer.info.programs, push = arr.push;
    const log = CBZ.programLog = [];
    arr.push = function (p) {
      try {
        const k = String(p && p.cacheKey || "").split(",");
        const st = String(new Error().stack || "").split("\n").slice(2, 9)
          .map(function (l) { const m = l.match(/(src\/[^:?)]+\.js)(?:\?[^:)]*)?:(\d+)/); return m ? m[1].replace("src/", "") + ":" + m[2] : ""; })
          .filter(Boolean).filter(function (s) { return s.indexOf("vendor/") < 0; }).slice(0, 3).join(" < ");
        log.push({ t: Math.round(performance.now()), type: k[0], dir: +k[51], point: +k[52], spot: +k[53], inst: k[5], enc: k[4], by: st, state: CBZ.game && CBZ.game.state });
      } catch (e) {}
      return push.apply(this, arguments);
    };
  }

  /* THE RATCHET. A material that was actually compiled has a non-empty
     `programs` set on its property record — so "how much of the scene never
     got warmed" stops being a guess. `unwarmed` and `badMaterials` both
     belong at 0 for the active world. `programs` is the count of unique
     SHADER PERMUTATIONS (keyed on a ~50-field tuple including light counts). */
  CBZ.fxWarmAudit = function () {
    const r = CBZ.renderer, sc = CBZ.scene;
    const out = { materials: 0, unwarmed: 0, badMaterials: 0, programs: 0, warmedMode: warmed };
    if (!r || !sc) return out;
    out.programs = (r.info && r.info.programs && r.info.programs.length) || 0;
    if (lastReport) out.badMaterials = lastReport.badMaterials;
    const hidden = hiddenRoots();
    const mats = new Set();
    (function visit(o) {
      if (hidden.has(o)) return;
      const m = o.material;
      if (m) {
        const list = Array.isArray(m) ? m : [m];
        for (let i = 0; i < list.length; i++) {
          if (!list[i]) continue;
          if (!list[i].isMaterial) { out.badMaterials++; continue; }
          mats.add(list[i]);
        }
      }
      for (let i = 0; i < o.children.length; i++) visit(o.children[i]);
    })(sc);
    mats.forEach(function (m) {
      out.materials++;
      let p = null;
      try { p = r.properties && r.properties.get(m); } catch (e) { p = null; }
      if (!p || !p.programs || !p.programs.size) out.unwarmed++;
    });
    return out;
  };
})();
