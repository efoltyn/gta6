/* ============================================================
   core/groundmask.js — THE GROUND STOPS BEING DRAWN OVER A HOLE, EVERYWHERE,
   WITHOUT EVER LOOKING FOR IT.

   A hole in this world is not cut, it is DISCARDED: the island is a
   64-triangle disc, the city floor is a TWO-TRIANGLE plate 388 m across, and
   neither can be re-topologised. So the ground is told to throw away every
   fragment inside a mouth. That much world/groundshaft.js already did.

   WHAT THIS FILE CHANGES IS *DISCOVERY*, WHICH IS WHERE EVERY BUG CAME FROM.
   The old mask had to FIND the surfaces to patch — a downward raycast plus a
   box sweep over the footprint, per site, then a shader-string injection into
   each material it found. All three sinkhole faults that shipped were faults of
   that search, not of the discard:
     · the raycast threw on the city's Sprites (r128's Sprite.raycast reads a
       null raycaster.camera) and, sharing one try{} with the sweep, silently
       took the sweep down with it — every city shaft was a lip ring on intact
       tarmac, 92 ground surfaces over the mouth and zero of them masked;
     · a site was swept ONCE, at the first plug's half radius, so the ring of
       road meshes between r/2 and r kept drawing as a partial lid;
     · the slots were filled in creation order, so the NEWEST hole — the one
       that just opened under the player — was the one that got none.

   You cannot fail to find something you never look for. The discard now lives
   in THREE.ShaderChunk's fog chunks, which every fogged material in the game
   includes, so it is in every ground shader by construction: the plate, the
   roads, the lane paint, the kerbs, the lot slabs, the beach, the seabed and
   the disaster ocean (a custom ShaderMaterial that #includes the same chunks).
   No raycast, no sweep, no per-material patching, no site bookkeeping.

   THE THREE THINGS THAT MAKE IT WORK, EACH OF WHICH FAILS SILENTLY IF WRONG
   ------------------------------------------------------------------------
   1. ORDER. core/renderer.js's installFog does
      `THREE.ShaderChunk.fog_fragment = body.join("\n")` — a WHOLESALE REPLACE.
      A patch installed before it is discarded with no error whatsoever (this
      cost an afternoon to find). We therefore load AFTER core/renderer.js and
      assert CBZ.renderer exists; and we APPEND to the chunks rather than
      rewriting them, so we do to installFog what we ask of anyone after us.

   2. THE UNIFORM MUST BE AN ARRAY. r128 gives each built-in material its own
      uniforms via UniformsUtils.clone(), which calls .clone() on a Vector4 —
      so a shared Vector4 is COPIED per material and a write to it never lands
      anywhere — but .slice() on an Array, whose ELEMENTS stay shared. So the
      slots are an array of Vector4 written into every THREE.ShaderLib[*]
      .uniforms entry, and one write updates every material in the game.
      (UniformsLib is the wrong hook: ShaderLib merged it at module init, long
      before any of our code runs.)

   3. WORLD POSITION FROM `position`, NOT `transformed`. The obvious patch —
      `modelMatrix * vec4(transformed, 1.0)` in fog_vertex — compiles in every
      built-in shader and FAILS in the disaster water, a custom ShaderMaterial
      that #includes the fog chunks but never declares `transformed`. `position`
      and `modelMatrix` are universal. The cost is that `position` predates
      instancing and skinning, so both are excluded by #define — which is not a
      workaround, it is correct: an InstancedMesh pool shares one modelMatrix
      (mask one and the whole pool would vanish) and neither instanced deco nor
      a skinned body is ever the ground.

   THE BAND IS THE FILTER THE SEARCH USED TO BE. A slot is (x, z, r, gy) and a
   fragment is discarded only within a thin vertical band about that hole's own
   surface height — deep enough to take the sea and the seabed lapping the rim,
   shallow enough that a tower at the lip keeps its ground floor and a mountain
   keeps its flank. The old code got that filter by only ever patching materials
   it had identified as ground; this gets it in two compares, and cannot be
   wrong about a surface it never had to identify.

   Anything that must NOT be cut while inside the band — a shaft's own wall,
   lip and stair, which live exactly there — opts out with
   CBZ.groundMaskExempt(material), a #define, not a search.

   Flags:
     GROUND_MASK        master; false = nothing is ever discarded
     GROUND_MASK_SLOTS  holes the ground can be open for at once (GLSL array
                        length, so fixed at compile time; nearest the eye win)
   Ratchet: CBZ.groundMaskAudit(), and tools/sinkhole-check.mjs's lid count.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GROUND_MASK == null) CBZ.CONFIG.GROUND_MASK = true;
  if (CBZ.CONFIG.GROUND_MASK_SLOTS == null) CBZ.CONFIG.GROUND_MASK_SLOTS = 16;

  const SLOTS = Math.max(1, Math.min(32, CBZ.CONFIG.GROUND_MASK_SLOTS | 0));
  /* The band, in metres about each hole's own surface height.
     UP: everything that paves a street sits a little over grade, and the
     highest of it is the FOOTWAY: city/streetkit.js lays the carriageway at
     0.05 and the footway / kerb top at 0.18, and the island's sidewalks
     stand 0.15 over a 0.04 road. The band used to stop at 0.12, so a hole
     cut at road grade that reached the kerb kept a footway slab drawing
     across its mouth (the old lip collar happened to hide it). 0.35 takes
     every paving layer and the kerb face and still leaves a building's
     foundation alone (no hole is allowed under one: groundShaftCanOpen).
     DOWN: the island's ocean plane is at y=-0.8 and its seabed shelf at -1.35,
     and BOTH were showing through the rim as a blue crescent before the mask
     reached them. 6 m takes those and any authored pad below grade, while the
     shaft liner below it is exempt by #define anyway. */
  const BAND_UP = 0.35, BAND_DOWN = 6.0;

  /* THE CUT EDGE IS NOT A CIRCLE. A hole's mouth is torn, and the edge the
     ground stops at has to be the SAME polyline as the top of the shaft's
     torn face, or there is a seam: a sliver of void where the face is inside
     the cut, a sliver of ground floating over the void where it is outside.
     The old answer was to lay a collar ring over the seam and paint it the
     colour of one raycast at the centre. The answer now is that there is no
     seam: each hole may hand over a PROFILE, PROFILE_N radii (multiples of
     its r) at the bearings i * 2pi / PROFILE_N, and the shader cuts along the
     CHORDS between them, exactly the straight edges the shaft draws between
     the same vertices. A hole with no profile is the regular PROFILE_N-gon
     inscribed in its circle (a sinkhole's sagging crust, any other owner).

     The profiles ride in ONE small data texture (PROFILE_N x SLOTS, two bytes
     per radius, nearest-filtered), written only when a slot's profile
     changes. A texture uniform has two traps in r128, each silent:
       - UniformsUtils.clone() CLONES a Texture per material, so it is handed
         over inside a one-element ARRAY (sampler2D uCbzProf[1]): .slice()
         keeps the element shared, the trick the slot array already uses.
       - a ShaderMaterial that #includes the fog chunks but was never attached
         would leave the sampler on unit 0, and a samplerCube of its own on
         unit 0 is a draw error. So the sampler only exists where CBZ_PROF is
         defined: prepended to every THREE.ShaderLib fragment shader below,
         and set by groundMaskAttach on the custom materials that ask. */
  const PROFILE_N = 64;
  const PROF_LO = 0.5, PROF_HI = 1.5;
  function quantize(m) {
    const v = Math.round((Math.min(PROF_HI, Math.max(PROF_LO, m)) - PROF_LO) * 65535);
    return v / 65535 + PROF_LO;
  }
  const profData = new Uint8Array(PROFILE_N * SLOTS * 4);
  const profTex = new THREE.DataTexture(profData, PROFILE_N, SLOTS, THREE.RGBAFormat, THREE.UnsignedByteType);
  profTex.magFilter = THREE.NearestFilter; profTex.minFilter = THREE.NearestFilter;
  profTex.generateMipmaps = false; profTex.flipY = false;
  profTex.wrapS = profTex.wrapT = THREE.ClampToEdgeWrapping;
  const rowSrc = new Array(SLOTS).fill(undefined);
  function writeRow(i, prof) {
    if (rowSrc[i] === prof) return false;
    rowSrc[i] = prof;
    for (let k = 0; k < PROFILE_N; k++) {
      const m = prof ? prof[k] : 1;
      const v = Math.round((Math.min(PROF_HI, Math.max(PROF_LO, m)) - PROF_LO) * 65535);
      const o = (i * PROFILE_N + k) * 4;
      profData[o] = v >> 8; profData[o + 1] = v & 255; profData[o + 2] = 0; profData[o + 3] = 255;
    }
    return true;
  }
  for (let i = 0; i < SLOTS; i++) writeRow(i, null);
  profTex.needsUpdate = true;
  const uProf = { value: [profTex] };

  const slots = [];
  for (let i = 0; i < SLOTS; i++) slots.push(new THREE.Vector4(0, 0, 0, 0));
  const uHoles = { value: slots };

  const state = { installed: false, why: "", libs: 0, filled: 0 };

  const GLSL_PARS_V = "varying vec3 vCbzGW;\n";
  const GLSL_VERT =
    "\n#if defined( USE_INSTANCING ) || defined( USE_SKINNING )\n" +
    "  vCbzGW = vec3( 0.0, 1.0e9, 0.0 );\n" +      // never ground: park it outside every band
    "#else\n" +
    "  vCbzGW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n" +
    "#endif\n";
  const NF = PROFILE_N.toFixed(1), SF = SLOTS.toFixed(1);
  const DA = (Math.PI * 2) / PROFILE_N;
  const GLSL_PARS_F =
    "uniform vec4 uCbzHoles[" + SLOTS + "];\nvarying vec3 vCbzGW;\n" +
    "#ifdef CBZ_PROF\n" +
    "uniform sampler2D uCbzProf[ 1 ];\n" +
    "float cbzProfAt( float i, float row ) {\n" +
    "  vec4 t = texture2D( uCbzProf[ 0 ], vec2( ( i + 0.5 ) / " + NF + ", row ) );\n" +
    "  return dot( t.rg, vec2( 65280.0, 255.0 ) ) / 65535.0 + " + PROF_LO.toFixed(1) + ";\n" +
    "}\n" +
    "#endif\n";
  /* length(a - b), NEVER distance(a, b) (2026-09-27). This is spliced into
     fog_fragment, i.e. into EVERY material's fragment shader, including the
     vendor mirror sea (world/waterfx.js) whose main() declares
     `float distance = length(worldToEye);`. ESSL 1.00 then refuses the call
     ("'distance' : function name expected") and three draws the mirror with
     a dead program: at quality tier >= 2 the city ocean rendered NOTHING.
     water_spec.js's INLAND_FN note records the same trap.
     THE CHORD: between bearings a0 and a1 = a0 + DA with radii r0 and r1, the
     straight edge meets the ray at bearing t at
       r(t) = r0 r1 sin(DA) / (r0 sin(t - a0) + r1 sin(a1 - t)),
     which is r0 at a0, r1 at a1 and a straight line between: the same edge a
     triangle strip through those two vertices draws. Tested multiplied out
     (no divide), and only inside 1.5 r: everything else costs two compares. */
  const GLSL_FRAG =
    "\n#ifndef CBZ_NOMASK\n" +
    "  for ( int cbzI = 0; cbzI < " + SLOTS + "; cbzI++ ) {\n" +
    "    vec4 cbzH = uCbzHoles[ cbzI ];\n" +
    "    if ( cbzH.z <= 0.0 ) break;\n" +
    "    if ( vCbzGW.y < cbzH.w + " + BAND_UP.toFixed(2) + " && vCbzGW.y > cbzH.w - " + BAND_DOWN.toFixed(2) + " ) {\n" +
    "      vec2 cbzD = vCbzGW.xz - cbzH.xy;\n" +
    "      float cbzL = length( cbzD );\n" +
    "      if ( cbzL < cbzH.z * " + PROF_LO.toFixed(2) + " ) discard;\n" +
    "#ifdef CBZ_PROF\n" +
    "      if ( cbzL < cbzH.z * " + PROF_HI.toFixed(2) + " ) {\n" +
    "        float cbzT = atan( cbzD.y, cbzD.x );\n" +
    "        if ( cbzT < 0.0 ) cbzT += 6.28318530718;\n" +
    "        float cbzI0 = min( floor( cbzT * " + (PROFILE_N / (Math.PI * 2)).toFixed(8) + " ), " + (PROFILE_N - 1).toFixed(1) + " );\n" +
    "        float cbzRow = ( float( cbzI ) + 0.5 ) / " + SF + ";\n" +
    "        float cbzR0 = cbzProfAt( cbzI0, cbzRow );\n" +
    "        float cbzR1 = cbzProfAt( mod( cbzI0 + 1.0, " + NF + " ), cbzRow );\n" +
    "        float cbzA0 = cbzI0 * " + DA.toFixed(8) + ";\n" +
    "        float cbzDen = cbzR0 * sin( cbzT - cbzA0 ) + cbzR1 * sin( cbzA0 + " + DA.toFixed(8) + " - cbzT );\n" +
    "        if ( cbzL * max( cbzDen, 1e-5 ) < cbzH.z * cbzR0 * cbzR1 * " + Math.sin(DA).toFixed(8) + " ) discard;\n" +
    "      }\n" +
    "#else\n" +
    "      if ( cbzL < cbzH.z ) discard;\n" +
    "#endif\n" +
    "    }\n" +
    "  }\n" +
    "#endif\n";

  function install() {
    if (state.installed) return true;
    if (CBZ.CONFIG.GROUND_MASK === false) { state.why = "GROUND_MASK off"; return false; }
    if (!THREE.ShaderChunk || !THREE.ShaderLib) { state.why = "no ShaderChunk/ShaderLib"; return false; }
    /* THE ORDERING ASSERTION. core/renderer.js REPLACES fog_fragment wholesale;
       running before it means being erased in silence. CBZ.renderer is that
       file's own output, so its presence is proof we are downstream of it. */
    if (!CBZ.renderer) {
      state.why = "loaded before core/renderer.js, its installFog would erase this patch silently";
      if (window.console) console.error("[groundmask] " + state.why);
      return false;
    }
    const parsV = THREE.ShaderChunk.fog_pars_vertex, vtx = THREE.ShaderChunk.fog_vertex;
    const parsF = THREE.ShaderChunk.fog_pars_fragment, frg = THREE.ShaderChunk.fog_fragment;
    if (typeof parsV !== "string" || typeof vtx !== "string" ||
        typeof parsF !== "string" || typeof frg !== "string") {
      state.why = "fog chunks missing, unknown THREE build, left alone";
      return false;
    }
    if (frg.indexOf("uCbzHoles") >= 0) { state.installed = true; return true; }   // idempotent

    // APPEND, never rewrite — the courtesy installFog did not get from us.
    THREE.ShaderChunk.fog_pars_vertex = GLSL_PARS_V + parsV;
    THREE.ShaderChunk.fog_vertex = GLSL_VERT + vtx;
    THREE.ShaderChunk.fog_pars_fragment = GLSL_PARS_F + parsF;
    THREE.ShaderChunk.fog_fragment = GLSL_FRAG + frg;

    for (const k in THREE.ShaderLib) {
      const sh = THREE.ShaderLib[k];
      if (!sh || !sh.uniforms) continue;
      sh.uniforms.uCbzHoles = uHoles;
      // the profile sampler exists only where it is bound (see PROFILE_N)
      if (typeof sh.fragmentShader === "string" && sh.fragmentShader.indexOf("CBZ_PROF") < 0) {
        sh.fragmentShader = "#define CBZ_PROF 1\n" + sh.fragmentShader;
        sh.uniforms.uCbzProf = uProf;
      }
      state.libs++;
    }
    state.installed = true;
    return true;
  }
  install();

  /* A custom ShaderMaterial gets the CODE from the chunks it #includes but owns
     its own uniforms, so it must be handed the DATA. One line at its creation,
     rather than this file going looking for it. */
  CBZ.groundMaskAttach = function (mat) {
    if (!mat || !mat.uniforms) return false;
    mat.uniforms.uCbzHoles = uHoles;
    mat.uniforms.uCbzProf = uProf;
    mat.defines = mat.defines || {};
    if (!mat.defines.CBZ_PROF) { mat.defines.CBZ_PROF = 1; mat.needsUpdate = true; }
    return true;
  };

  /* Opt a material OUT — for geometry that lives inside the band on purpose:
     a shaft's wall, its torn lip, its stair. A #define, so it is exact, it is
     in the program cache key, and it can never be "missed". */
  CBZ.groundMaskExempt = function (mat) {
    if (!mat) return false;
    mat.defines = mat.defines || {};
    if (mat.defines.CBZ_NOMASK) return true;
    mat.defines.CBZ_NOMASK = 1;
    mat.needsUpdate = true;
    return true;
  };

  // ---- the eye: slots follow it, so the hole you can fall into is drawn ----
  function eyeX() { return CBZ.camera ? CBZ.camera.position.x : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.x : 0); }
  function eyeZ() { return CBZ.camera ? CBZ.camera.position.z : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.z : 0); }
  /* Distance to the EYE is the visual answer and the camera renders, so the
     camera leads — but camera and player come apart (a death cam, a cinematic,
     a chase cam left behind a car) and it is the PLAYER who falls, through a
     floor query that has no slot limit. Score on the nearer of the two, and pin
     a hole the player is standing IN: "you are inside a hole that is not being
     drawn" is the one state this cap must never be able to produce. */
  function score(h, ex, ez, px, pz) {
    const de = (h.x - ex) * (h.x - ex) + (h.z - ez) * (h.z - ez);
    if (px == null) return de;
    const dp = (h.x - px) * (h.x - px) + (h.z - pz) * (h.z - pz);
    if (dp < h.r * h.r) return -1e9 + dp;
    return de < dp ? de : dp;
  }

  const rank = [];
  /* Hand it every open hole; it fills the slots nearest-first and returns the
     ones that won, so the caller can stop drawing the ones that did not.
     Entries: { x, z, r, y, src, prof? } — r is the discard radius, y is that
     hole's surface height, prof (optional) the PROFILE_N radii in multiples
     of r, each already passed through CBZ.groundMaskProfile.quantize so the
     caller's geometry and the shader cut along the identical polyline. */
  CBZ.groundMaskApply = function (entries) {
    const out = [];
    if (!state.installed) { state.filled = 0; return out; }
    const n = entries ? entries.length : 0;
    rank.length = 0;
    for (let i = 0; i < n; i++) if (entries[i]) rank.push(entries[i]);
    if (rank.length > SLOTS) {
      const ex = eyeX(), ez = eyeZ();
      const pp = CBZ.player && CBZ.player.pos;
      const px = pp ? pp.x : null, pz = pp ? pp.z : null;
      rank.sort(function (a, b) { return score(a, ex, ez, px, pz) - score(b, ex, ez, px, pz); });
      rank.length = SLOTS;
    }
    let dirty = false;
    for (let i = 0; i < SLOTS; i++) {
      const h = rank[i];
      if (h) {
        slots[i].set(h.x, h.z, h.r, h.y); out.push(h.src !== undefined ? h.src : h);
        if (writeRow(i, h.prof || null)) dirty = true;
      } else slots[i].set(0, 0, 0, 0);
    }
    if (dirty) profTex.needsUpdate = true;
    state.filled = out.length;
    return out;
  };

  /* MORE THAN ONE OWNER OF HOLES. The mask began as the shaft file's private
     arrangement, which was fine while shafts were the only thing that removed
     ground. Craters, breaches, tunnel mouths and dig sites all remove it too,
     and a second caller fighting over the same slot array is how a rendering
     system quietly starts lying. So anyone with holes REGISTERS A PROVIDER, and
     this file is the single place that ranks them and deals the slots. */
  const providers = [];
  let won = [];
  CBZ.groundMaskProvide = function (fn) { if (typeof fn === "function" && providers.indexOf(fn) < 0) providers.push(fn); };
  CBZ.groundMaskSlotted = function () { return won; };
  const gather = [];
  CBZ.groundMaskSync = function () {
    gather.length = 0;
    for (let i = 0; i < providers.length; i++) {
      let e = null;
      try { e = providers[i](); } catch (err) { e = null; }
      if (!e) continue;
      for (let k = 0; k < e.length; k++) if (e[k]) gather.push(e[k]);
    }
    won = CBZ.groundMaskApply(gather);
    return won;
  };
  if (CBZ.onUpdate) CBZ.onUpdate(28.55, function () { if (providers.length) CBZ.groundMaskSync(); });

  CBZ.groundMaskSlots = SLOTS;
  /* the profile contract: PROFILE_N bearings from +x toward +z, radii as
     multiples of the entry's r inside [lo, hi], quantised to what the
     texture stores */
  CBZ.groundMaskProfile = { N: PROFILE_N, lo: PROF_LO, hi: PROF_HI, quantize: quantize };
  // the eye the slots are ranked from — published so the audit measures the
  // SAME point the ranking used, rather than keeping a second copy of it
  CBZ.groundMaskEye = function () { return { x: eyeX(), z: eyeZ() }; };
  CBZ.groundMaskAudit = function () {
    return {
      installed: state.installed,
      why: state.why || null,
      slots: SLOTS,
      filled: state.filled,
      shaderLibsPatched: state.libs,
      bandUp: BAND_UP, bandDown: BAND_DOWN, profileN: PROFILE_N,
      // the whole point: this must stay 0 forever
      sweptMeshes: 0, raycasts: 0,
    };
  };
})();
