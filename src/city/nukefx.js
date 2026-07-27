/* ============================================================
   city/nukefx.js — THE NUKE + BIG-BLAST SPECTACLE.

   This file DRAWS. It owns no damage, no ledger, no lethality: every one of
   those already exists and is already tuned (crashfx.js's pooled blast +
   applyBlastDamage, systems/impactbus.js's propagating wave, city/
   structural.js's collapse ledger). It plugs into the ordnance bus by NAME:

       CBZ.impact.fx("nuke", composer)      // src/systems/impactbus.js
       CBZ.detonate(x, y, z, "nuke")        // ...and the row starts working

   ZERO edits to the bus, zero edits to crashfx's blast composers.

   ------------------------------------------------------------------
   WHAT THE SEQUENCE IS (Glasstone/Dolan beat table, compressed for pacing —
   the timings are the spec's, the techniques are Fallout 4 / Frostbite's):

     0.00       WHITEOUT      full-screen white DOM div (#nukeFlash). The
                              cheapest, highest-impact beat in the game: one
                              composited layer, no fill cost in GL at all.
                              Never dropped, at any quality tier.
     0.10-0.21  THE MINIMUM   the DOUBLE FLASH. The expanding shock front goes
                              opaque and swallows its own fireball, so the
                              light DIPS before the second, longer, brighter
                              thermal pulse burns back through it. This is the
                              single most recognisable thing a nuclear device
                              does — bhangmeters count warheads by it — and it
                              costs one extra keyframe on that same div.
     0.10-0.50  IGNITION      the fireball: ONE low-poly icosphere with a
                              fresnel-rim ShaderMaterial, additive. 63 m of
                              radius for the stock nuke row.
     0.30-1.50  CONDENSATION  the Wilson cloud / visible shock front: a second
                              icosphere, near-white, broad rim, expanding at
                              the REAL wave speed then gone.
     0.50-4.90  GROUND SHOCK  a flat RingGeometry annulus whose radius is read
                              straight off CBZ.impact.waveState() — the ring
                              you SEE and the ring that KILLS are the same
                              number, by construction. It retires WITH the
                              front, not on a clock of its own.
     0.90-2.00  THERMAL RING  fires OUTSIDE the flattened zone. Thermal goes as
                              Y^0.41 and blast radius as Y^0.33, so at nuke
                              scale the two diverge and the ignition ring
                              genuinely outranges the destruction. Free
                              divergence, and nothing but a nuke does it.
     1.00-4.00  RISE + STEM   the fireball climbs and cools; the stem
                              billboard (cylindrically billboarded, so it stays
                              vertical when you crane your neck at it) grows
                              under a cap ~290 m up.
     2.60-10.0  CAP + ROLL    camera-facing cap billboards + a squashed torus
                              with tube-scrolling noise UVs (the toroidal roll
                              that makes a mushroom read as a mushroom).
     2.00-8.00  BASE SURGE    a low wide billboard rolling outward + pooled
                              dust kicks walking along the shock front.
     8.00+      ASH FALL      CBZ.fx.particleCloud in fall mode around the
                              lens. Reused, not rebuilt.
     THROUGHOUT ATMOSPHERE    scene.fog.color is lerped white -> orange -> ash
                              for the whole arc. core/sky.js paints its horizon
                              band FROM that colour, so the entire sky turns
                              with it for ONE Color.lerp per frame and zero
                              draw calls — the highest ratio of "reads as a
                              nuclear event" to cost in the file. It is also
                              stateless: core/daynight.js rewrites fog.color
                              every frame anyway, so there is nothing to
                              restore and an abort mid-arc is clean.

   MUSHROOM CLOUDS, CHEAPLY (Fallout 4's actual technique): 3-5 CAMERA-FACING
   BILLBOARDS = a grayscale lumpy mask x an independently-scrolling noise x a
   1D lifetime gradient LUT for colour. NOT hundreds of particles. Every
   texture is generated procedurally with a CanvasTexture at load — nothing is
   fetched, ever (CDN is blocked and must stay that way).

   ------------------------------------------------------------------
   COST DISCIPLINE (fill rate is the enemy — a full-screen additive layer is
   about a frame of opaque geometry on SwiftShader / a phone):
     • ONE live sequence at a time, hard. A second detonation while one runs
       degrades to whiteout + shake, it does not queue.
     • Every mesh is built ONCE at load and PARKED invisible (also gives
       core/fxwarm.js something to compile, so the first nuke of a session
       does not pay a shader-link hitch at the worst possible moment).
       Nothing is allocated per detonation except the ash cloud, and that is
       eight seconds after the bang.
     • Big layers are SEQUENCED, not stacked: the whiteout has faded before
       the cap blooms; the fireball shell is retired before the cloud is big.
     • Everything rides CBZ.qScale. At tier 0 the sequence degrades to
       whiteout + ground ring + ONE cloud billboard and still reads.
     • Not one new particle pool. Dust/debris/smoke all route into crashfx's
       already-capped cityDustKick / cityExplosion / cityChunk.

   DETERMINISM: runtime-only FX, but it still runs off a local seeded LCG
   (never Math.random) so replay/multiplayer stay bit-identical, matching
   crashfx.js's rule.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;
  if (CBZ.cityNukeFX) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // MASTER REVERT. false => the "nuke" composer degrades to the pooled heavy
  // blast (exactly what the row did before this file existed) and cityBombWalk
  // still works. One line.
  if (CBZ.CONFIG.NUKE_FX_V1 == null) CBZ.CONFIG.NUKE_FX_V1 = true;
  // The fresnel shock/condensation shells — the two biggest fill-rate items in
  // the sequence. false => the cloud, ring and whiteout still run.
  if (CBZ.CONFIG.NUKE_FX_SHELL == null) CBZ.CONFIG.NUKE_FX_SHELL = true;
  // The late ash-fall particle cloud (borrowed from systems/fx.js).
  if (CBZ.CONFIG.NUKE_FX_ASH == null) CBZ.CONFIG.NUKE_FX_ASH = true;
  // THE ATMOSPHERE DRIVE — the single cheapest "this is nuclear" cue there is.
  // Lerps scene.fog.color along the timeline (white-out -> orange -> ash grey);
  // core/sky.js@99 paints its horizon band from scene.fog.color, so the whole
  // SKY follows for free, and core/daynight.js@2 rewrites the colour every
  // frame, so it self-restores with nothing to leak. false => fog untouched.
  if (CBZ.CONFIG.NUKE_FX_SKY == null) CBZ.CONFIG.NUKE_FX_SKY = true;
  // Re-point the bus's "moab" row at the composer below. false => the row
  // keeps whatever fx the bus table gave it (today: "heavy").
  if (CBZ.CONFIG.NUKE_FX_MOAB == null) CBZ.CONFIG.NUKE_FX_MOAB = true;
  // The carpet-bombing stagger (CBZ.cityBombWalk). false => a walk fires its
  // whole stick on the first tick, which is the pre-existing behaviour of
  // every caller that just looped over points itself.
  if (CBZ.CONFIG.BOMB_WALK_V1 == null) CBZ.CONFIG.BOMB_WALK_V1 = true;

  // ---- deterministic seeded LCG (NEVER Math.random — replay/MP sync) --------
  let _rs = 0x51ed77;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  function q01() { return CBZ.qScale ? Math.max(0, Math.min(1, CBZ.qScale(0, 1))) : 1; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function camPos() { return CBZ.camera && CBZ.camera.position ? CBZ.camera.position : null; }
  function camDist(x, y, z) {
    const c = camPos();
    return c ? Math.hypot(x - c.x, y - c.y, z - c.z) : 0;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }   // smoothstep
  const _fogTint = new THREE.Color();          // scratch — never allocate per frame

  /* ============================================================
     PROCEDURAL TEXTURES — baked once at load, no external assets.
     ============================================================ */
  // A lumpy grayscale billow: alpha carries density, the red channel carries
  // the same density so the shader can brighten the dense core without a
  // second sampler. Overlapping soft blobs + a radial mask kill the quad edge.
  function makeCloudTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 54; i++) {
      // cluster the blobs into a disc so the silhouette is a billow, not a square
      const a = rng() * 6.2832, rr = Math.sqrt(rng()) * 78;
      const px = 128 + Math.cos(a) * rr, py = 128 + Math.sin(a) * rr * 0.86;
      const br = 20 + rng() * 52;
      const g = ctx.createRadialGradient(px, py, 0, px, py, br);
      const v = 150 + ((rng() * 90) | 0);
      g.addColorStop(0, "rgba(" + v + "," + v + "," + v + "," + (0.36 + rng() * 0.4) + ")");
      g.addColorStop(1, "rgba(" + v + "," + v + "," + v + ",0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, br, 0, 6.2832); ctx.fill();
    }
    // radial mask: solid through the middle, gone by the quad edge
    ctx.globalCompositeOperation = "destination-in";
    const m = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    m.addColorStop(0.0, "rgba(0,0,0,1)");
    m.addColorStop(0.62, "rgba(0,0,0,0.92)");
    m.addColorStop(0.88, "rgba(0,0,0,0.28)");
    m.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = m; ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  // Tiling two-octave value noise. This is the "second independently-scrolling
  // noise" the research calls for — one sampler, two lookups, no third texture.
  function makeNoiseTexture() {
    const S = 128, c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d"), img = ctx.createImageData(S, S), d = img.data;
    function grid(n) {
      const g = new Float32Array(n * n);
      for (let i = 0; i < g.length; i++) g[i] = rng();
      return g;
    }
    const gA = grid(8), gB = grid(16);
    function samp(g, n, u, v) {                    // bilinear, wrapped => tileable
      const fx = u * n, fy = v * n;
      const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const a = g[y0 * n + x0], b = g[y0 * n + x1], e = g[y1 * n + x0], f = g[y1 * n + x1];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (a + (b - a) * sx) + ((e + (f - e) * sx) - (a + (b - a) * sx)) * sy;
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        let n = samp(gA, 8, u, v) * 0.65 + samp(gB, 16, u, v) * 0.35;
        n = clamp(n, 0, 1);
        const o = (y * S + x) * 4, b = (n * 255) | 0;
        d[o] = b; d[o + 1] = b; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  // The 1D LIFETIME LUT: white-hot -> yellow -> orange -> ember -> soot -> ash.
  // Sampled by u = normalized age, which is how a single billboard shader
  // covers "fireball" and "old cloud" without a second material.
  const RAMP = [
    [0.00, "#fffdf2"], [0.06, "#ffeda6"], [0.14, "#ffc25a"], [0.26, "#ff8a2e"],
    [0.40, "#d1512a"], [0.55, "#8a5340"], [0.70, "#6b6157"], [0.85, "#575049"],
    [1.00, "#3d3934"],
  ];
  function makeLutTexture() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 1;
    const ctx = c.getContext("2d"), g = ctx.createLinearGradient(0, 0, 64, 0);
    for (const s of RAMP) g.addColorStop(s[0], s[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 1);
    const t = new THREE.CanvasTexture(c);
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  // CPU twin of the LUT, for the shells (uniform colours, no sampler needed).
  // Parsed to Colors ONCE — a per-frame Color.set("#rrggbb") is a regex parse.
  const RAMP_C = RAMP.map(function (s) { return new THREE.Color(s[1]); });
  function rampColor(out, t) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const p = (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0] || 1);
        out.copy(RAMP_C[i - 1]).lerp(RAMP_C[i], p);
        return out;
      }
    }
    return out.copy(RAMP_C[RAMP_C.length - 1]);
  }

  const TEX = { cloud: null, noise: null, lut: null };

  /* ============================================================
     SHADERS — r128 GLSL ES 1.0, ShaderMaterial (NOT RawShaderMaterial, so
     three still prepends position/normal/uv/modelViewMatrix/projectionMatrix
     AND resolves #include, which is the whole trick below).

     WHY WE USE THE ENGINE'S OWN CHUNKS INSTEAD OF HAND-ROLLING FOG:
     core/renderer.js does two things every other material in this game gets
     for free and a hand-rolled shader silently does NOT:
       1. CustomToneMapping + the film grade (ACES + contrast/sat/gain/lift),
          injected as `toneMapping()` into every non-raw ShaderMaterial when
          renderer.toneMapping is set;
       2. renderer.outputEncoding = sRGBEncoding, injected as
          `linearToOutputTexel()`;
       ...plus it PATCHES ShaderChunk.fog_fragment with height fog and a graded
       fog colour so a fogged pixel lands exactly on core/sky.js's horizon stop.
     A shader that writes gl_FragColor raw skips all three, so the cloud would
     be brighter, more saturated and sitting in FRONT of the haze the city sits
     in — a mushroom reaches far past fog.far (360m), so that is the one layer
     in the game where getting it wrong is most visible. Including the chunks
     costs nothing and can never drift from whatever renderer.js does next.

     r128 fog contract (verified against src/vendor/three.r128.min.js):
       • the varying is `fogDepth` (the `vFogDepth` rename is a LATER release),
       • fog_vertex reads a local named exactly `mvPosition`,
       • WebGLRenderer calls refreshFogUniforms() on ANY material with
         `fog: true` and writes straight into material.uniforms — so the
         uniforms object MUST already carry fogColor/fogNear/fogFar/fogDensity
         or it throws. FOG_U() below is that, built by hand rather than with
         UniformsUtils.merge (which deep-CLONES texture values in r128 and
         would mint a duplicate GPU upload of the mask/noise/LUT per material).
     ============================================================ */
  function FOG_U(extra) {
    return Object.assign({
      fogColor: { value: new THREE.Color(0xb6c4c8) },
      fogNear: { value: 95 }, fogFar: { value: 360 },
      fogDensity: { value: 0.00025 },
    }, extra);
  }
  // Tail for a NORMAL-blended layer: tonemap, encode, then mix toward the fog.
  // Exactly the order three's own meshbasic_frag uses.
  const TAIL_FOG = [
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
  ].join("\n");
  // Tail for an ADDITIVE layer. Mixing an additive fragment TOWARD a bright fog
  // colour ADDS haze instead of hiding it (additive has no "behind"), so a
  // distant fireball would get BRIGHTER with range. Fade the ALPHA on the same
  // curve instead — fogNear/fogFar/fogDepth are already in scope from
  // fog_pars_fragment, we just decline to call fog_fragment.
  const TAIL_FOG_ADD = [
    "  #ifdef USE_FOG",
    "    #ifdef FOG_EXP2",
    "      gl_FragColor.a *= 1.0 - 0.85 * clamp(1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth), 0.0, 1.0);",
    "    #else",
    "      gl_FragColor.a *= 1.0 - 0.85 * smoothstep(fogNear, fogFar, fogDepth);",
    "    #endif",
    "  #endif",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
  ].join("\n");

  // ---- fresnel-rim shell (fireball + condensation front) -------------------
  const SHELL_VS = [
    "#include <fog_pars_vertex>",
    "varying vec3 vN; varying vec3 vV;",
    "void main() {",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  vN = normalize(normalMatrix * normal);",
    "  vV = normalize(-mvPosition.xyz);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  function shellFs(additive) {
    return [
      "#include <fog_pars_fragment>",
      "uniform vec3 uRimColor; uniform vec3 uCoreColor;",
      "uniform float uOpacity; uniform float uRimPow; uniform float uCore;",
      "varying vec3 vN; varying vec3 vV;",
      "void main() {",
      "  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));",
      "  f = pow(clamp(f, 0.0, 1.0), uRimPow);",
      "  vec3 c = mix(uCoreColor, uRimColor, f);",
      "  float a = (uCore + (1.0 - uCore) * f) * uOpacity;",
      "  if (a <= 0.003) discard;",
      "  gl_FragColor = vec4(c, a);",
      additive ? TAIL_FOG_ADD : TAIL_FOG,
      "}",
    ].join("\n");
  }
  function makeShellMat(additive) {
    const m = new THREE.ShaderMaterial({
      uniforms: FOG_U({
        uRimColor: { value: new THREE.Color(0xfff3d0) },
        uCoreColor: { value: new THREE.Color(0xffb054) },
        uOpacity: { value: 0 }, uRimPow: { value: 1.7 }, uCore: { value: 0.35 },
      }),
      vertexShader: SHELL_VS, fragmentShader: shellFs(additive),
      transparent: true, depthWrite: false, depthTest: true,
      fog: true,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    m._shared = true;
    return m;
  }

  // ---- ground shock annulus ------------------------------------------------
  // r128 RingGeometry(inner, outer, thetaSegments, phiSegments, thetaStart,
  // thetaLength) lays its vertices in the XY plane, so position.xy IS the
  // radius vector and the mesh is rotated -90deg about X to lie on the deck.
  const RING_VS = [
    "#include <fog_pars_vertex>",
    "varying vec2 vP;",
    "void main() {",
    "  vP = position.xy;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  const RING_FS = [
    "#include <fog_pars_fragment>",
    "uniform vec3 uHot; uniform vec3 uDust; uniform float uOpacity; uniform float uCool;",
    "varying vec2 vP;",
    "void main() {",
    // the annulus is authored inner 0.8 / outer 1.0, so k walks the band 0..1
    "  float k = clamp((length(vP) - 0.8) / 0.2, 0.0, 1.0);",
    "  float a = smoothstep(0.0, 0.32, k) * (1.0 - smoothstep(0.62, 1.0, k));",
    "  a *= uOpacity;",
    "  if (a <= 0.003) discard;",
    "  gl_FragColor = vec4(mix(uHot, uDust, uCool), a);",
    TAIL_FOG_ADD,
    "}",
  ].join("\n");

  // ---- camera-facing cloud billboard --------------------------------------
  const BILL_VS = [
    "#include <fog_pars_vertex>",
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  const BILL_FS = [
    "#include <fog_pars_fragment>",
    "uniform sampler2D uMask; uniform sampler2D uNoise; uniform sampler2D uLut;",
    "uniform vec2 uScroll; uniform vec2 uScroll2;",
    "uniform float uLife; uniform float uOpacity; uniform float uErode; uniform float uGlow;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 m = texture2D(uMask, vUv);",
    "  float n1 = texture2D(uNoise, vUv * 2.1 + uScroll).r;",
    "  float n2 = texture2D(uNoise, vUv * 0.9 + uScroll2).r;",
    "  float d = m.a * (0.42 + 0.78 * n1) * (0.55 + 0.7 * n2);",
    "  float a = smoothstep(uErode, uErode + 0.30, d) * uOpacity;",
    "  if (a <= 0.004) discard;",
    "  vec3 c = texture2D(uLut, vec2(clamp(uLife, 0.02, 0.98), 0.5)).rgb;",
    "  c *= 0.72 + uGlow * m.r * (0.6 + 0.7 * n1);",
    "  gl_FragColor = vec4(c, a);",
    TAIL_FOG,
    "}",
  ].join("\n");

  // ---- toroidal cap roll ---------------------------------------------------
  const TORUS_FS = [
    "#include <fog_pars_fragment>",
    "uniform sampler2D uNoise; uniform sampler2D uLut;",
    "uniform float uRoll; uniform float uLife; uniform float uOpacity;",
    "varying vec2 vUv;",
    "void main() {",
    // r128 TorusGeometry writes uv.x along the TUBULAR direction (around the
    // major circle) and uv.y around the TUBE, so scrolling uv.y is literally
    // the toroidal roll. Verified against the vendored build, not remembered.
    "  float n1 = texture2D(uNoise, vec2(vUv.x * 3.0, vUv.y + uRoll)).r;",
    "  float n2 = texture2D(uNoise, vec2(vUv.x * 1.6 - uRoll * 0.35, vUv.y * 0.7)).r;",
    "  float a = smoothstep(0.34, 0.86, n1 * 0.62 + n2 * 0.62) * uOpacity;",
    "  if (a <= 0.004) discard;",
    "  vec3 c = texture2D(uLut, vec2(clamp(uLife, 0.02, 0.98), 0.5)).rgb * (0.7 + 0.55 * n1);",
    "  gl_FragColor = vec4(c, a);",
    TAIL_FOG,
    "}",
  ].join("\n");

  /* ============================================================
     THE MESH POOL — built ONCE at load, parked invisible, reused by every
     detonation for the life of the session. Nothing here is ever disposed
     (they are session-lifetime shared resources, exactly like crashfx's
     chunkGeo/chunkMat), and every object carries userData so core/batch.js
     can never swallow it into a merged buffer.
     ============================================================ */
  const POOL = { shell: null, dome: null, ring: null, torus: null, bills: [] };
  const MAX_BILLS = 5;

  function park(mesh, order) {
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = true;
    mesh.userData.nukefx = true;          // batch.js spares anything with userData
    scene.add(mesh);
    return mesh;
  }

  function buildPool() {
    TEX.cloud = makeCloudTexture();
    TEX.noise = makeNoiseTexture();
    TEX.lut = makeLutTexture();

    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);   // 320 tris — a rim needs no more
    sphereGeo._shared = true;
    // r128 signature, verified against the vendored build:
    //   RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments, ...)
    //   TorusGeometry(radius, tube, radialSegments, tubularSegments, arc)
    const ringGeo = new THREE.RingGeometry(0.8, 1.0, 72, 1);
    ringGeo._shared = true;
    const torusGeo = new THREE.TorusGeometry(1, 0.34, 8, 36);
    torusGeo._shared = true;
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    quadGeo._shared = true;

    /* RENDER ORDER. All of these are transparent + depthWrite:false, so three
       sorts them by renderOrder first and only then back-to-front. The order
       below is the painting order of the real event:
         4 ground ring (deck) -> 5 cloud billboards -> 6 toroidal roll
         -> 7 condensation dome -> 8 fireball shell (additive, always on top).
       The ring used to sit ABOVE the billboards, which drew a 600 m annulus
       over the base surge that is supposed to be rolling across it. */
    const shellMat = makeShellMat(true);
    POOL.shell = park(new THREE.Mesh(sphereGeo, shellMat), 8);

    const domeMat = makeShellMat(false);
    domeMat.uniforms.uRimColor.value.set(0xffffff);
    domeMat.uniforms.uCoreColor.value.set(0xdfe8f2);
    domeMat.uniforms.uRimPow.value = 2.6;
    domeMat.uniforms.uCore.value = 0.06;
    POOL.dome = park(new THREE.Mesh(sphereGeo, domeMat), 7);

    const ringMat = new THREE.ShaderMaterial({
      uniforms: FOG_U({
        uHot: { value: new THREE.Color(0xffe0a0) },
        uDust: { value: new THREE.Color(0xb0a595) },
        uOpacity: { value: 0 }, uCool: { value: 0 },
      }),
      vertexShader: RING_VS, fragmentShader: RING_FS,
      transparent: true, depthWrite: false, depthTest: true,
      fog: true,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    ringMat._shared = true;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    POOL.ring = park(ring, 4);

    const torusMat = new THREE.ShaderMaterial({
      uniforms: FOG_U({
        uNoise: { value: TEX.noise }, uLut: { value: TEX.lut },
        uRoll: { value: 0 }, uLife: { value: 0.5 }, uOpacity: { value: 0 },
      }),
      vertexShader: BILL_VS, fragmentShader: TORUS_FS,
      transparent: true, depthWrite: false, depthTest: true,
      fog: true,
      side: THREE.DoubleSide, blending: THREE.NormalBlending,
    });
    torusMat._shared = true;
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.rotation.x = Math.PI / 2;
    POOL.torus = park(torus, 6);

    for (let i = 0; i < MAX_BILLS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: FOG_U({
          uMask: { value: TEX.cloud }, uNoise: { value: TEX.noise }, uLut: { value: TEX.lut },
          uScroll: { value: new THREE.Vector2(0, 0) },
          uScroll2: { value: new THREE.Vector2(0, 0) },
          uLife: { value: 0.3 }, uOpacity: { value: 0 }, uErode: { value: 0.18 }, uGlow: { value: 0.5 },
        }),
        vertexShader: BILL_VS, fragmentShader: BILL_FS,
        transparent: true, depthWrite: false, depthTest: true,
        fog: true,
        side: THREE.DoubleSide, blending: THREE.NormalBlending,
      });
      mat._shared = true;
      POOL.bills.push(park(new THREE.Mesh(quadGeo, mat), 5));
    }
  }

  /* ============================================================
     THE WHITEOUT — the single cheapest, biggest beat there is: one composited
     DOM layer, zero GL fill, never dropped at any quality tier. It REUSES
     city/strategic.js's #nukeFlash element rather than adding a second sheet,
     so the two can never stack, and it is exported as CBZ.cityNukeWhiteout so
     strategic.js (and anything else) can drop its private copy.

     THE DOUBLE FLASH. A nuclear detonation does not flash once — it flashes,
     then the expanding shock front goes OPAQUE and swallows its own fireball
     (the "minimum"), then the fireball burns back through it in a second,
     longer, brighter thermal pulse. It is the single most recognisable thing
     about the event, it is the reason bhangmeters can count warheads, and here
     it costs one extra keyframe on a DOM div — no GL fill at all.

     Driven per-frame off the same onAlways ticker rather than a CSS transition
     because a transition can only interpolate between TWO values; a chain of
     nested rAF handoffs to fake more would be four timers we do not control
     and cannot cancel on a run reset. `keys` are normalised 0..1 of the total
     fade so one table serves any duration. */
  const FLASH_DOUBLE = [
    [0.000, 1.00],   // detonation: instantaneous, total
    [0.035, 0.72],   // first pulse decaying
    [0.075, 0.26],   // THE MINIMUM — the shock front hides the fireball
    [0.130, 0.94],   // main thermal pulse: slower to build, longer to burn
    [0.260, 0.70],
    [0.480, 0.34],
    [1.000, 0.00],
  ];
  const FLASH_SINGLE = [[0.0, 1.0], [0.22, 0.45], [1.0, 0.0]];

  let flashEl = null, flash = null;
  function flashDiv() {
    if (typeof document === "undefined" || !document.body) return null;
    if (flashEl && flashEl.parentNode) return flashEl;
    flashEl = document.getElementById("nukeFlash");
    if (!flashEl) {
      flashEl = document.createElement("div");
      flashEl.id = "nukeFlash";
      // z-index 80: over the HUD, under the pause/menu layers (115+).
      flashEl.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:80";
      document.body.appendChild(flashEl);
    }
    // city/strategic.js's degrade-path copy bakes a 2.8s transition into the
    // same element's inline style. We drive opacity per frame, so kill it.
    flashEl.style.transition = "none";
    return flashEl;
  }
  // whiteout(fadeSec, peak, double) — `double` opts into the shock-front dip.
  function whiteout(fadeSec, peak, dbl) {
    const el = flashDiv();
    if (!el) return;
    const dur = Math.max(0.12, fadeSec == null ? 2.8 : +fadeSec || 0.12);
    const pk = peak == null ? 1 : clamp(+peak || 0, 0, 1);
    // A weaker flash never interrupts a stronger one already running.
    if (flash && flash.peak > pk && flash.t < flash.dur * 0.5) return;
    flash = { t: 0, dur: dur, peak: pk, keys: dbl ? FLASH_DOUBLE : FLASH_SINGLE };
    try { el.style.opacity = String(pk); } catch (e) {}
  }
  function stepFlash(dt) {
    const f = flash;
    f.t += dt;
    const el = flashDiv();
    const u = clamp(f.t / f.dur, 0, 1);
    let v = 0;
    for (let i = 1; i < f.keys.length; i++) {
      if (u <= f.keys[i][0]) {
        const a = f.keys[i - 1], b = f.keys[i];
        const p = (u - a[0]) / (b[0] - a[0] || 1);
        v = a[1] + (b[1] - a[1]) * p;
        break;
      }
    }
    if (el) { try { el.style.opacity = v <= 0.002 ? "0" : (v * f.peak).toFixed(3); } catch (e) {} }
    if (u >= 1) flash = null;
  }
  function flashClear() {
    flash = null;
    const el = flashEl;
    if (el) { try { el.style.transition = "none"; el.style.opacity = "0"; } catch (e) {} }
  }
  CBZ.cityNukeWhiteout = whiteout;

  /* ============================================================
     STYLE ROWS — the ONLY difference between a nuke and a MOAB. Everything
     dimensional is derived from the ordnance ROW (radius / wave), so the
     spectacle and the damage model can never drift apart.
     ============================================================ */
  /* THE ONE NUMBER EVERYTHING HANGS OFF — and the bug that made this whole
     file draw a bonfire instead of a nuke.

     systems/impactbus.js states the trap explicitly at its `radius` field:
     "the legacy blast API multiplies radius BY power internally (crashfx.js:
     R = radius*power) ... the effective near-field radius of a row is
     radius*power, NOT radius", and the nuke row's own comment reads
     "radius*power = 126m of instantly-vaporised fireball".

     Every dimension below used to be derived from `row.radius` alone — 14 for
     the nuke — which produced a 7 m fireball under a mushroom cloud 20 m tall
     and 18 m wide, while the ring that actually kills rolled out to 620 m.
     fireR() is the honest number, and it is the ONLY place the conversion
     lives so it cannot drift again. `opts.scale` is already the bus's
     kinetic FX multiplier (cube-root of energy), so multiplying it in here is
     what keeps the spectacle proportional to how hard the thing arrived. */
  function fireR(row, opts) {
    const pw = Math.max(0.1, +row.power || 1);
    const rr = Math.max(1, +row.radius || 14);
    const sc = (opts && opts.scale > 0) ? +opts.scale : 1;
    return Math.max(8, rr * pw * sc);
  }

  const STYLE = {
    nuke: {
      rFrac: 0.50,     // fireball radius as a fraction of the EFFECTIVE radius
      riseK: 4.60,     // cap altitude, in fireball radii (63m ball -> ~290m cap)
      capK: 2.60, stemK: 0.40, surgeK: 3.4,
      riseT: 11, dur: 34, white: 2.9, whitePeak: 1, dbl: true,
      bills: 5, dome: true, torus: true, ash: true,
      secondary: 6, shatter: 3, thermal: 7,
      shake: 9, ringLife: 7.5, glow: 0.85,
    },
    moab: {
      rFrac: 0.55, riseK: 2.60, capK: 1.85, stemK: 0.38, surgeK: 2.6,
      riseT: 5.0, dur: 13, white: 0.8, whitePeak: 0.82, dbl: false,
      bills: 3, dome: false, torus: false, ash: false,
      secondary: 3, shatter: 1, thermal: 0,
      shake: 4.5, ringLife: 3.4, glow: 0.7,
    },
  };

  // Billboard ROLES in priority order. At tier 0 only the first survives, and
  // the cap alone still reads as "a mushroom went up over there".
  const ROLES = ["cap", "stem", "surge", "cap2", "collar"];

  /* ============================================================
     THE SEQUENCE — one live object, one state machine, ONE updater.
     No setTimeouts: every scheduled beat is a row in `pending`, popped by t.
     ============================================================ */
  let live = null;

  function beginSequence(x, y, z, styleName, row, opts) {
    if (!POOL.ring) return null;                    // pool never built (no THREE/scene)
    const P = STYLE[styleName] || STYLE.nuke;
    const q = q01();
    const gy = floorAt(x, z);
    // EFFECTIVE near-field radius (see fireR above): 126 m for the nuke row,
    // 41 m for the MOAB — NOT the row's bare `radius` field.
    const radius = fireR(row, opts);
    const R = Math.max(5, radius * P.rFrac);
    const wave = row.wave || null;
    // Match systems/impactbus.js's queueWave EXACTLY — same quality clamp AND
    // the same fxScale — or the ring you see stops being the ring that kills.
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const maxR = (wave && wave.maxR ? wave.maxR : radius * 4) *
                 (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1) * sc;
    const spd = wave && wave.speed ? wave.speed : 150;
    /* BURST HEIGHT. The bus hands the composer the real detonation `y`, and a
       B-2 releasing over a district is the whole reason this file exists — an
       airburst is not a ground burst with the same picture. So the FIREBALL,
       the condensation dome and the cap seat at the burst height while the
       shock ring, the base surge and the walking dust stay on the DECK, which
       is exactly the geometry: the stem is the dust column being drawn UP off
       the ground into a fireball that was never touching it.
       Clamped to 3 fireball radii so a stray y (a bomb still in the bomb bay,
       a debug teleport) cannot put a mushroom cloud in orbit. */
    const burstY = Math.max(gy, Math.min(gy + R * 3, y == null ? gy : (+y || gy)));
    const dist = camDist(x, burstY + R, z);

    const nBills = Math.max(1, Math.min(P.bills, Math.round(CBZ.qScale ? CBZ.qScale(1, P.bills) : P.bills)));
    const bills = [];
    for (let i = 0; i < nBills; i++) {
      const mesh = POOL.bills[i];
      if (!mesh) break;
      bills.push({
        mesh: mesh, role: ROLES[i], seed: rng(),
        roll: (rng() - 0.5) * 0.7, sx: (rng() - 0.5) * 0.05, sy: 0.02 + rng() * 0.05,
      });
      mesh.visible = false;
      mesh.material.uniforms.uOpacity.value = 0;
      mesh.material.uniforms.uGlow.value = P.glow;
    }

    live = {
      kind: row.id || styleName, style: P, styleName: styleName,
      x: x, y: gy, by: burstY, z: z, R: R, maxR: maxR, spd: spd, eff: radius,
      riseH: R * P.riseK, capW: R * P.capK, stemW: R * P.stemK, surgeW: R * P.surgeK,
      t: 0, r: Math.max(1, row.radius || radius * 0.1), dur: P.dur, q: q,
      // the front stops at maxR; the ring must retire WITH it, not on a fixed
      // clock that leaves a 620 m annulus parked in the street for 4 seconds.
      ringLife: Math.min(P.ringLife, maxR / Math.max(1, spd) + 1.6),
      bills: bills, dustAcc: 0, pending: [], ash: null, ashT: 0,
      boomAt: dist > 60 ? Math.min(9, dist / 343) : -1,
      frontAt: dist > 45 && dist < maxR ? dist / Math.max(1, spd) : -1,
      frontHit: false, fogK: 0,
      mode: (CBZ.game && CBZ.game.mode) || null,
      quiet: !!opts.quiet, noDamage: !!opts.noDamage, byPlayer: !!opts.byPlayer,
    };

    // ---- shells -----------------------------------------------------------
    // tier 2+ gets the fireball shell, tier 3+ the condensation dome, tier 3+
    // the toroidal roll. Tier 0/1 keep whiteout + ring + cloud and read fine.
    const wantShell = CBZ.CONFIG.NUKE_FX_SHELL && q > 0.28;
    live.shell = wantShell ? POOL.shell : null;
    live.dome = wantShell && P.dome && q > 0.6 ? POOL.dome : null;
    if (live.shell) {
      live.shell.position.set(x, burstY + R * 0.55, z);
      live.shell.scale.setScalar(0.01);
      live.shell.material.uniforms.uOpacity.value = 0;
      live.shell.visible = true;
    }
    if (live.dome) {
      live.dome.position.set(x, burstY + R * 0.3, z);
      live.dome.scale.setScalar(0.01);
      live.dome.material.uniforms.uOpacity.value = 0;
      live.dome.visible = false;
    }
    // ---- the ground ring is the ONE layer that survives every tier ---------
    live.ring = POOL.ring;
    live.ring.position.set(x, gy + 0.14, z);
    live.ring.scale.set(0.01, 0.01, 1);
    live.ring.material.uniforms.uOpacity.value = 0;
    live.ring.material.uniforms.uCool.value = 0;
    live.ring.visible = true;
    // ---- the toroidal cap roll (top tier only) ----------------------------
    live.torus = P.torus && q > 0.7 ? POOL.torus : null;
    if (live.torus) {
      live.torus.material.uniforms.uOpacity.value = 0;
      live.torus.material.uniforms.uRoll.value = 0;
      live.torus.visible = false;
    }

    /* ---- SCHEDULED BEATS. All of them route into systems that are already
       pooled and capped: crashfx's cityExplosion (FX-only satellites — the
       bus's wave owns the damage out there), buildings.js's cityShatter and
       cityScorch. Counts ride the quality tier; at tier 0 the lists are
       simply empty. -------------------------------------------------------- */
    const nSat = Math.round((CBZ.qScale ? CBZ.qScale(0, P.secondary) : P.secondary));
    for (let i = 0; i < nSat; i++) {
      const a = (i / nSat) * 6.2832 + rng() * 0.4;
      const rr = radius * (0.85 + rng() * 0.5);
      live.pending.push({
        t: 0.45 + i * 0.11,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 2.4, radius: 13, sat: true,
      });
    }
    const nSat2 = Math.round(nSat * 0.7);
    for (let i = 0; i < nSat2; i++) {
      const a = (i / Math.max(1, nSat2)) * 6.2832 + 0.7;
      const rr = radius * (1.7 + rng() * 0.6);
      live.pending.push({
        t: 1.35 + i * 0.13,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 1.9, radius: 11, sat: true,
      });
    }
    /* THE THERMAL RING — free divergence, and the most distinctive read a big
       warhead has. Thermal radiant exposure scales as Y^0.41 while blast
       radius scales as Y^(1/3) = Y^0.333, so the exponents SEPARATE with yield:
       at nuke scale the ignition ring lands well OUTSIDE the flattened zone.
       Fires burning past the edge of the wreckage is a thing only a nuclear
       weapon does, and it costs us N pooled, noDamage cityExplosion pops on a
       circle. The MOAB's `thermal` is 0, so it never draws one — a chemical
       bomb's thermal pulse does not outrange its own blast. */
    const nTherm = Math.round(CBZ.qScale ? CBZ.qScale(0, P.thermal) : P.thermal);
    for (let i = 0; i < nTherm; i++) {
      const a = (i / Math.max(1, nTherm)) * 6.2832 + 1.9;
      const rr = maxR * (1.02 + rng() * 0.26);
      live.pending.push({
        t: 0.9 + i * 0.16,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 1.1, radius: 16, sat: true,
      });
    }
    // glass goes out across the district as the front passes. Tier 0 keeps ONE
    // pass — glass is the cheapest "the whole block felt that" cue there is and
    // cityShatter skips already-broken panes, so it must not floor to zero.
    const nShatter = Math.max(1, Math.round((CBZ.qScale ? CBZ.qScale(1, P.shatter) : P.shatter)));
    for (let i = 0; i < nShatter; i++) {
      live.pending.push({ t: 0.3 + i * 0.55, shatter: radius * (0.9 + i * 0.75) });
    }
    // ground zero stays black
    live.pending.push({ t: 0.2, scorch: Math.min(70, radius * 0.42) });

    /* ---- t=0 FEEL -----------------------------------------------------------
       DELIBERATELY THIN. nearField() has already run by the time we get here,
       and crashfx's cityAirstrikeExplosion fires sfx("explosion"),
       shake(5.5*min(2.4,power)) = 13.2, doSlowmo(0.5) and doHitstop(0.26) of
       its own. Repeating any of those is not "more" — CBZ.shake is a MAX
       accumulator so a second, smaller shake is literally a no-op, and a second
       "explosion" inside the 0.18s bank cooldown is a no-op too. What is NOT
       already covered is the light, the distance and the long tail, so that is
       all we add. */
    if (!live.quiet) {
      whiteout(P.white, P.whitePeak, P.dbl);
      // Attenuate by distance the way systems/impactbus.js's camAtten does
      // (gentler than the blast's /130 — a nuke is felt a long way out), then
      // only bother CBZ.shake if we actually beat what the blast already asked
      // for; the MAX accumulator makes anything less a wasted call.
      const att = Math.max(0.1, Math.min(1, 1.25 - dist / 420));
      if (CBZ.shake) { try { CBZ.shake(P.shake * att); } catch (e) {} }
      if (CBZ.sfx) {
        // NO `force` on the shared cues: the near-field blast (and, for the
        // nuke, city/strategic.js) fire "explosion"/"rumble"/"collapse" in
        // this same frame, and the audio layer's per-name cooldown is exactly
        // the dedupe. Forcing would play every cue twice, 30 ms apart, which
        // reads as a doubled sample rather than a bigger bang.
        // SOUND LAGS LIGHT: the real boom arrives at distance/343 seconds. The
        // audio layer schedules it for us — no timer of ours involved. Nothing
        // else plays thunder at a detonation, so this one is forced. This beat
        // is the whole reason a far-off nuke reads as ENORMOUS rather than as a
        // small explosion: you watch it for two seconds before you hear it.
        if (live.boomAt > 0.08) {
          try { CBZ.sfx("thunder", { delay: live.boomAt, force: true, volume: 0.9 }); } catch (e) {}
        }
        try { CBZ.sfx("rumble", { delay: Math.max(0.35, live.boomAt), volume: 0.85 }); } catch (e) {}
        if (styleName === "nuke") { try { CBZ.sfx("collapse", { delay: 2.4, volume: 0.8 }); } catch (e) {} }
      }
    }
    return live;
  }

  /* ---- one satellite / world beat --------------------------------------- */
  function firePending(p) {
    if (p.sat && CBZ.cityExplosion) {
      // FX ONLY (noDamage): the bus's propagating wave owns everything past
      // the fireball. Two systems must never both bill the same casualties.
      try {
        CBZ.cityExplosion(p.x, p.z, {
          power: p.power, radius: p.radius, noDamage: true,
          ordnance: live ? live.kind : "nuke", _impact: true,
        });
      } catch (e) {}
      return;
    }
    if (p.shatter != null && CBZ.cityShatter && live) {
      try { CBZ.cityShatter(live.x, live.z, p.shatter); } catch (e) {}
      return;
    }
    if (p.scorch != null && CBZ.cityScorch && live) {
      // ONE stain. The near-field blast already laid its own crater scorch and
      // city/strategic.js lays a ring of its own for a nuke — a third fan of
      // decals here would just churn buildings.js's capped pool for nothing.
      try { CBZ.cityScorch(live.x, live.z, p.scorch); } catch (e) {}
    }
  }

  /* ---- the shock-front radius: the SAME number the damage ring uses ------- */
  function frontRadius(dt) {
    // Read the live wave off the bus when it is there; the visual then IS the
    // gameplay ring, not a lookalike. Fall back to integrating the row's own
    // speed so a direct CBZ.cityNukeFX() call (no bus) still looks right.
    if (CBZ.impact && CBZ.impact.waveState) {
      try {
        const ws = CBZ.impact.waveState();
        for (let i = 0; i < ws.length; i++) {
          if (ws[i].kind === live.kind) { live.r = ws[i].r; return live.r; }
        }
      } catch (e) {}
    }
    live.r = Math.min(live.maxR, live.r + live.spd * dt);
    return live.r;
  }

  /* ---- billboard placement -------------------------------------------------
     TWO billboard modes, and using the wrong one is the classic mushroom-cloud
     tell. A SPHERICAL billboard (copy the camera's whole quaternion) is right
     for the cap: it is a blob, it has no up. It is WRONG for the stem and the
     base surge, because their whole job is to be vertical/horizontal in the
     WORLD — and a mushroom cloud is the one thing in a game the player is
     guaranteed to crane their neck at. The moment the camera pitches up, a
     spherical stem tips over with it and the column visibly detaches from the
     cap it is supposed to be holding up.

     So those two get a CYLINDRICAL billboard: yaw toward the camera about the
     world Y axis only, keeping local +Y pinned to world up. Same cost. */
  function faceCameraSpherical(mesh, roll) {
    const cam = CBZ.camera;
    if (!cam) return;
    mesh.quaternion.copy(cam.quaternion);
    if (roll) mesh.rotateZ(roll);
  }
  function faceCameraYaw(mesh) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return;
    mesh.rotation.set(0, Math.atan2(cam.position.x - mesh.position.x,
                                    cam.position.z - mesh.position.z), 0);
  }

  function stepBill(b, t, L) {
    const P = L.style, m = b.mesh, u = m.material.uniforms;
    const rise = ease((t - 0.9) / P.riseT);
    const capY = L.by + L.R * 0.6 + (L.riseH - L.R * 0.6) * rise;
    const bloom = 0.35 + 0.9 * ease((t - 1.2) / (P.riseT * 0.85));
    const fadeIn = ease((t - b.t0) / 0.7);
    const fadeOut = 1 - ease((t - (L.dur - 9)) / 9);
    let op = fadeIn * Math.max(0, fadeOut);
    if (t < b.t0) { m.visible = false; return; }

    // two INDEPENDENTLY scrolling noise lookups (the Fallout-4 trick) — driven
    // off sequence time, not per-frame increments, so the roil runs at the
    // same speed whatever the framerate is.
    u.uScroll.value.set(b.seed + b.sx * t, b.seed - b.sy * t);
    u.uScroll2.value.set(b.seed * 0.7 - b.sx * 0.42 * t, b.seed * 1.3 + b.sy * 0.37 * t);

    switch (b.role) {
      case "cap":
        m.position.set(L.x, capY, L.z);
        m.scale.set(L.capW * bloom, L.capW * bloom * 0.66, 1);
        u.uLife.value = clamp(t / 9, 0, 1);
        u.uErode.value = 0.14;
        op *= 0.95;
        break;
      case "cap2":
        // OFFSET, never a multiply on an absolute world Y — `capY` already
        // includes the ground height, so `capY * 1.05` drifted the second cap
        // further from the first the higher the terrain under ground zero was.
        m.position.set(L.x + L.capW * 0.16, capY + L.capW * 0.05, L.z - L.capW * 0.1);
        m.scale.set(L.capW * bloom * 0.72, L.capW * bloom * 0.5, 1);
        u.uLife.value = clamp(t / 8 + 0.05, 0, 1);
        u.uErode.value = 0.22;
        op *= 0.7;
        break;
      case "stem": {
        const h = Math.max(2, capY - L.y);
        m.position.set(L.x, L.y + h * 0.5, L.z);
        m.scale.set(L.stemW * (1 + rise * 0.7), h, 1);
        u.uLife.value = clamp(0.30 + t / 26, 0, 1);
        u.uErode.value = 0.30;
        op *= 0.78;
        break;
      }
      case "collar":
        m.position.set(L.x, capY - L.capW * 0.30 * bloom, L.z);
        m.scale.set(L.capW * bloom * 0.62, L.capW * bloom * 0.26, 1);
        u.uLife.value = clamp(0.22 + t / 18, 0, 1);
        u.uErode.value = 0.26;
        op *= 0.62;
        break;
      case "surge": {
        // BASE SURGE: the skirt of pulverised ground that rolls OUT along the
        // deck under the stem. Grows with the front, not with the column.
        const g = ease((t - 1.6) / 6);
        const w = L.surgeW * (0.35 + 1.5 * g);
        const h = w * 0.19;      // LOW and wide (~5:1) — a surge that is a
                                 // third as tall as it is wide is a second
                                 // mushroom, and it clipped through the deck.
        m.position.set(L.x, L.y + h * 0.42, L.z);
        m.scale.set(w, h, 1);
        u.uLife.value = clamp(0.42 + t / 24, 0, 1);
        u.uErode.value = 0.34;
        op *= 0.6 * (1 - ease((t - 9) / 9));
        break;
      }
      default:
        // an unknown role would otherwise be drawn at whatever position and
        // scale the previous detonation left on this pooled mesh.
        m.visible = false;
        u.uOpacity.value = 0;
        return;
    }
    u.uOpacity.value = Math.max(0, op);
    m.visible = u.uOpacity.value > 0.004;
    if (m.visible) {
      if (b.role === "stem" || b.role === "surge") faceCameraYaw(m);
      else faceCameraSpherical(m, b.roll);
    }
  }

  /* ---- the whole timeline, one function --------------------------------- */
  function stepSequence(dt) {
    const L = live, P = L.style;
    L.t += dt;
    const t = L.t;

    // a mode flip mid-sequence (menu, survival, prison) must never strand
    // geometry in the world.
    if (L.mode && CBZ.game && CBZ.game.mode !== L.mode) { endSequence(); return; }

    // ---- scheduled world beats ------------------------------------------
    for (let i = L.pending.length - 1; i >= 0; i--) {
      if (t >= L.pending[i].t) {
        const p = L.pending.splice(i, 1)[0];
        try { firePending(p); } catch (e) {}
      }
    }

    // ---- ATMOSPHERE: the cheapest "this is nuclear" cue in the whole file.
    // One Color.lerp per frame on scene.fog.color paints the ENTIRE horizon,
    // because core/sky.js@99 draws its dome's horizon stop from exactly this
    // colour. No geometry, no fill, no draw call. And core/daynight.js@2
    // re-copies its own fog colour every single frame, so this is stateless:
    // there is nothing to restore, nothing to leak, and an abort mid-arc is
    // clean by construction. (systems/weather.js@90 lerps rain-grey on top
    // afterwards, which is the correct precedence — weather still wins.)
    if (CBZ.CONFIG.NUKE_FX_SKY && scene.fog && scene.fog.color) {
      // white-out -> the fireball's own orange bounce -> ash overcast -> gone
      let k, hex;
      if (t < 0.55)      { hex = 0xfff4e2; k = 0.92 * (1 - t / 0.55) + 0.30; }
      else if (t < 3.5)  { hex = 0xff9440; k = 0.62 * (1 - (t - 0.55) / 2.95) + 0.22; }
      else               { hex = 0x8d8478; k = 0.55 * Math.max(0, 1 - (t - 3.5) / (L.dur - 3.5)); }
      _fogTint.setHex(hex);
      L.fogK = k;
      scene.fog.color.lerp(_fogTint, clamp(k, 0, 0.95));
    }

    // ---- the shock front (drives the ring, the dome and the dust) --------
    const r = frontRadius(dt);
    if (L.ring) {
      const k = clamp(r / L.maxR, 0, 1);
      const life = clamp(t / L.ringLife, 0, 1);
      L.ring.scale.set(r, r, 1);
      L.ring.material.uniforms.uCool.value = k;
      // Fade hard as the front stalls at maxR: a stationary 600 m annulus is a
      // debug gizmo, not a shockwave. `k*k*k` only bites in the last stretch.
      L.ring.material.uniforms.uOpacity.value =
        Math.max(0, (1 - life) * (0.9 - 0.45 * k) * (1 - k * k * k * 0.75));
      if (life >= 1) { L.ring.visible = false; L.ring = null; }
    }
    // dust walking the front — pooled crashfx puffs, never a pool of ours
    if (t < L.ringLife && r < L.maxR) {
      L.dustAcc += dt;
      const nd = Math.round(CBZ.qScale ? CBZ.qScale(0, 3) : 3);
      if (L.dustAcc > 0.3 && nd > 0 && CBZ.cityDustKick) {
        L.dustAcc = 0;
        for (let i = 0; i < nd; i++) {
          const a = rng() * 6.2832;
          const px = L.x + Math.cos(a) * r, pz = L.z + Math.sin(a) * r;
          try { CBZ.cityDustKick(px, floorAt(px, pz) + 0.6, pz, 1.5 + L.q); } catch (e) {}
        }
      }
    }

    // ---- FIREBALL: ignite, stall, rise, cool -----------------------------
    if (L.shell) {
      const grow = 1 - Math.exp(-t * 5.5);                 // fast punch, then stall
      const rise = ease((t - 0.9) / P.riseT);
      const rad = L.R * (grow * (1 + rise * 0.35));
      const y = L.by + L.R * 0.55 + (L.riseH * 0.92 - L.R * 0.55) * rise;
      L.shell.position.set(L.x, y, L.z);
      L.shell.scale.setScalar(Math.max(0.01, rad));
      const u = L.shell.material.uniforms;
      const age = clamp(t / 7, 0, 1);
      rampColor(u.uRimColor.value, age * 0.55);
      rampColor(u.uCoreColor.value, Math.max(0, age * 0.9 - 0.04));
      // SEQUENCED, NOT STACKED: the fireball shell is the single most expensive
      // layer here (a DoubleSide additive sphere that can fill most of the
      // screen from close range), so it is retired at ~4.4s, BEFORE the
      // toroidal roll fades in at 4.4s rather than five seconds after it. That
      // one number is the difference between 8 concurrent layers and 7.
      u.uOpacity.value = Math.max(0, Math.min(1, t / 0.12) * (1 - ease((t - 2.4) / 2.0)));
      if (u.uOpacity.value <= 0.004) { L.shell.visible = false; L.shell = null; }
    }

    // ---- CONDENSATION / visible shock dome (0.3-1.5s) --------------------
    if (L.dome) {
      if (t >= 0.28) {
        const dr = Math.min(r, L.R + (t - 0.28) * L.spd * 0.85);
        L.dome.visible = true;
        L.dome.position.set(L.x, L.by + dr * 0.16, L.z);
        L.dome.scale.set(dr, dr * 0.72, dr);
        L.dome.material.uniforms.uOpacity.value = Math.max(0, 0.34 * (1 - ease((t - 0.5) / 1.1)));
        if (t > 1.7) { L.dome.visible = false; L.dome = null; }
      }
    }

    // ---- CAP + STEM + SURGE billboards -----------------------------------
    for (let i = 0; i < L.bills.length; i++) {
      const b = L.bills[i];
      // STAGGERED ENTRY, and the two secondary lobes deliberately wait until
      // AFTER the condensation dome retires at 1.7s. That is both the right
      // read (the cap's secondary lobes bloom off the main one, they do not
      // appear with it) and what holds the peak concurrent transparent layer
      // count at 7 — cap2 and collar arriving at 0.9 with everything else put
      // the whole sequence's maximum in the 1.4-1.7s window for no gain.
      if (b.t0 == null) {
        b.t0 = b.role === "stem" ? 0.8
             : b.role === "cap" ? 0.9
             : b.role === "surge" ? 1.4
             : b.role === "cap2" ? 1.9
             : 2.2;                          // collar
      }
      stepBill(b, t, L);
    }

    // ---- the TOROIDAL ROLL under the cap ---------------------------------
    // Starts at 4.4s, by which point the fireball shell above is fully retired —
    // the two most expensive layers hand over instead of ever coexisting.
    // That one number is what holds the peak concurrent transparent layer
    // count at 7 instead of 8.
    if (L.torus) {
      if (t >= 4.4) {
        const rise = ease((t - 0.9) / P.riseT);
        const capY = L.by + L.R * 0.6 + (L.riseH - L.R * 0.6) * rise;
        const bloom = 0.4 + 0.95 * ease((t - 1.2) / (P.riseT * 0.85));
        const u = L.torus.material.uniforms;
        L.torus.visible = true;
        L.torus.position.set(L.x, capY - L.capW * 0.06, L.z);
        L.torus.scale.set(L.capW * 0.44 * bloom, L.capW * 0.44 * bloom, L.capW * 0.20 * bloom);
        u.uRoll.value += dt * 0.16;
        u.uLife.value = clamp(t / 11, 0, 1);
        u.uOpacity.value = Math.max(0, 0.7 * ease((t - 4.4) / 1.6) * (1 - ease((t - (L.dur - 10)) / 10)));
        if (u.uOpacity.value <= 0.004 && t > 7) { L.torus.visible = false; L.torus = null; }
      }
    }

    // ---- the front reaching the LENS: the second slap ---------------------
    if (!L.frontHit && L.frontAt > 0 && t >= L.frontAt) {
      L.frontHit = true;
      if (!L.quiet) {
        if (CBZ.shake) { try { CBZ.shake(3.4); } catch (e) {} }
        whiteout(0.5, 0.28, false);
        if (CBZ.sfx) { try { CBZ.sfx("rumble", { force: true, volume: 0.9 }); } catch (e) {} }
      }
    }

    // ---- ASH FALL — the only per-sequence allocation, eight seconds late --
    // NOTE the count is NOT qScaled here: systems/fx.js's particleCloud already
    // multiplies `count` by CBZ.qScale(0.4, 1) internally. Scaling it twice (as
    // this used to) meant tier 2 got 0.7*0.7 = HALF the motes it asked for and
    // tier 0 got literally zero.
    if (P.ash && CBZ.CONFIG.NUKE_FX_ASH && !L.ash && t > 8 && CBZ.fx && CBZ.fx.particleCloud) {
      const n = 260;
      if (L.q > 0.3) {                    // tier 2+ only
        try {
          L.ash = CBZ.fx.particleCloud({
            count: n, radius: 62, top: 46, bottom: -2, mode: "fall",
            vMin: 1.6, vMax: 4.2, drift: 1.1, driftZ: 0.5,
            color: 0x9a9082, size: 0.24, opacity: 0.42,
          });
          L.ash.setActive(0.9);
        } catch (e) { L.ash = null; }
      }
    }
    if (L.ash) {
      const c = camPos();
      const fade = t > L.dur - 8 ? Math.max(0, 1 - (t - (L.dur - 8)) / 8) : 1;
      L.ash.setActive(0.9 * fade);
      try { L.ash.update(dt, c ? c.x : L.x, c ? c.y : L.y + 20, c ? c.z : L.z); } catch (e) {}
    }

    if (t >= L.dur) endSequence();
  }

  function endSequence() {
    const L = live;
    live = null;
    // Meshes are session-lifetime pool members: park them, never dispose.
    // Runs even from a half-built sequence (a throw in beginSequence), which
    // is the only way geometry could ever be stranded visible in the world.
    const mm = [POOL.shell, POOL.dome, POOL.ring, POOL.torus];
    for (let i = 0; i < mm.length; i++) {
      const m = mm[i];
      if (!m) continue;
      m.visible = false;
      if (m.material && m.material.uniforms && m.material.uniforms.uOpacity) m.material.uniforms.uOpacity.value = 0;
    }
    for (let i = 0; i < POOL.bills.length; i++) {
      POOL.bills[i].visible = false;
      POOL.bills[i].material.uniforms.uOpacity.value = 0;
    }
    // The ash cloud is the one thing we built: it is ours to dispose.
    if (L && L.ash) { try { L.ash.dispose(); } catch (e) {} }
  }
  CBZ.cityNukeFxAbort = endSequence;

  /* ============================================================
     THE NEAR FIELD — reused wholesale, never re-implemented.

     crashfx.js's cityAirstrikeExplosion already owns the pooled fireball,
     debris, sparks, scorch, shake, slow-mo AND the ped/cop/crowd/player
     lethality curve the owner tuned. The composer's job is to call it with
     the right numbers and then draw the things it cannot: the sky.

     RADIUS MATH — and the bug that used to live here. crashfx computes
     R = radius * power INTERNALLY. This function used to "correct" for that by
     handing it `radius / power`, cancelling the multiply and producing R =
     row.radius = 14 m for the nuke. systems/impactbus.js's own fxHeavy — the
     composer this file REPLACES — passes `radius: row.radius` with `power:
     row.power` and gets R = 126 m. So registering the nuke spectacle made the
     nuke's near field NINE TIMES SMALLER than not registering it: the fancy
     path was a strict regression on the degrade path.

     We now pass exactly what fxHeavy passes. R = 126 m, lethal core 0.55R =
     69 m, and systems/impactbus.js's wave takes over from row.radius outward
     to 620 m — there is no gap between them, which is why the second
     "gap-closer" blast that used to be here (an undamped 254 m instant-kill
     sphere at t=0) is gone. It was closing a hole that only existed because of
     the radius bug, and it was quietly defeating the entire point of the
     propagating wave: that you SEE it coming.
     ============================================================ */
  function nearField(x, y, z, row, opts) {
    const fn = CBZ.cityAirstrikeExplosion || CBZ.cityExplosion;
    if (!fn) return;
    try {
      fn(x, z, {
        power: Math.max(0.5, (+row.power || 4) * (opts.scale > 0 ? +opts.scale : 1)),
        radius: Math.max(1, +row.radius || 14),
        y: y,
        byPlayer: !!opts.byPlayer, noDamage: !!opts.noDamage,
        ordnance: row.id || "nuke", _impact: true,
      });
    } catch (e) {}
  }

  /* ============================================================
     THE COMPOSERS — what the bus actually calls.
     `fn(x, y, z, row, opts)`; draws only.
     ============================================================ */
  function compose(styleName) {
    return function (x, y, z, row, opts) {
      opts = opts || {};
      row = row || {};
      if (!CBZ.CONFIG.NUKE_FX_V1) {                 // master revert
        nearField(x, y, z, row, opts);
        return;
      }
      nearField(x, y, z, row, opts);
      if (live) {
        // CONCURRENCY CAP = 1. A second warhead during a live sequence gets
        // the cheap path (the near field above already fired) plus a flash —
        // it never queues, never doubles the fill cost.
        if (!opts.quiet) whiteout(STYLE[styleName].white * 0.4, 0.6, false);
        return;
      }
      try { beginSequence(x, y, z, styleName, row, opts); } catch (e) { try { endSequence(); } catch (e2) {} }
    };
  }
  const composeNuke = compose("nuke");
  const composeMoab = compose("moab");

  /* ---- PUBLIC: fire the spectacle without the bus ------------------------ */
  // CBZ.cityNukeFX(x, y, z, opts) — opts {kind:"nuke"|"moab", power, radius,
  // wave, quiet, noDamage, byPlayer, scale}. Used by city/strategic.js's
  // nukeDetonate (which can now drop its private cloud) and by probes.
  CBZ.cityNukeFX = function (x, y, z, opts) {
    opts = opts || {};
    const kind = opts.kind === "moab" ? "moab" : "nuke";
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    // Defaults MIRROR systems/impactbus.js's rows verbatim (power 9 / radius 14
    // for the nuke, 4.6 / 9 for the MOAB) so a probe that fires this with no bus
    // loaded gets the same 126 m fireball the real row produces. `radius` here
    // is the row field, NOT the effective reach — fireR() does that multiply.
    row = Object.assign(
      { id: kind, power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 9 : 14,
        wave: kind === "moab" ? { speed: 140, maxR: 150 } : { speed: 190, maxR: 620 } },
      row || {},
      opts.row || {}
    );
    if (opts.power != null) row.power = opts.power;
    if (opts.radius != null) row.radius = opts.radius;
    if (opts.wave !== undefined) row.wave = opts.wave;
    (kind === "moab" ? composeMoab : composeNuke)(x, y == null ? floorAt(x, z) + 1.2 : y, z, row, opts);
    return live;
  };

  /* ============================================================
     CBZ.cityBombWalk(points, opts) — CARPET BOMBING.

     Research: a bomb walk is a SEQUENCE, not an effect. ONE pooled small-
     explosion prefab fired N times with staggered delays matching release
     interval x ground speed, with dust merging along the line. No mushroom
     stages, no per-bomb bespoke FX.

     points: [{x,z} | {x,y,z}] along the ground track (the B-2's release
             ladder). Decimated, never truncated, so a long stick keeps its
             LENGTH when the budget shrinks.
     opts:   { kind, interval, delay, detonate, by, byPlayer, dirx, dirz,
               scale, onEach }

     TWO MODES, and the DEFAULT IS DRAW-ONLY ON PURPOSE:

       detonate: false (default) — walks the DUST along the line and nothing
         else. This is what city/strategic.js's B-2 bomb run wants: it already
         simulates every falling bomb and detonates it on impact, so a walk
         that also detonated would bill every bomb TWICE (double damage,
         double kills, double wanted level). The dust merge is the one thing
         its run was missing.
       detonate: true — the full prefab walk: one ordnance row fired N times
         on the stagger, each through CBZ.detonate so the structural ledger,
         the kill bus and the crime system all see it exactly once. For any
         caller that has no bomb sim of its own (a scripted mission strike, a
         cutscene, an off-screen bombardment).

     `delay` offsets the whole walk, which is how a caller with a real fall
     time (release altitude -> impact) lines the dust up with its own bombs.
     ============================================================ */
  const walks = [];
  const WALK_MAX = 2, WALK_POINTS = 24;

  CBZ.cityBombWalk = function (points, opts) {
    opts = opts || {};
    if (!points || !points.length) return null;
    const kind = opts.kind || "bomb";
    const interval = clamp(opts.interval == null ? 0.24 : +opts.interval, 0.06, 3);

    // Decimate to the cap. In DRAW-ONLY mode the quality tier thins the dust
    // line too (tier 0 drops ~40% of the puffs); in DETONATE mode it must NOT,
    // because the number of bombs that actually go off is gameplay and has to
    // be identical on every client at every quality setting.
    // NOTE FOR CALLERS: in DETONATE mode decimation past WALK_POINTS drops real
    // ordnance, so a 60-point stick delivers 20 warheads, not 60. That is why
    // city/strategic.js's RUN_MAX is 24 — exactly WALK_POINTS. Read `.points`
    // off the returned handle rather than trusting your own count if you might
    // ever exceed it, or the number you announce to the player will be a lie.
    const willDetonate = opts.detonate === true;
    const budget = willDetonate
      ? WALK_POINTS
      : Math.max(2, Math.round(WALK_POINTS * (CBZ.qScale ? CBZ.qScale(0.55, 1) : 1)));
    const stride = Math.max(1, Math.ceil(points.length / budget));
    const pts = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (!p) continue;
      pts.push({ x: +p.x || 0, y: p.y == null ? null : +p.y, z: +p.z || 0 });
    }
    if (!pts.length) return null;

    const walk = {
      pts: pts, i: 0, t: -Math.max(0, +opts.delay || 0), interval: interval, kind: kind,
      detonate: willDetonate,
      by: opts.by || null, byPlayer: !!opts.byPlayer, scale: opts.scale || 1,
      dirx: opts.dirx || 0, dirz: opts.dirz || 0, onEach: opts.onEach || null,
      prev: null, dead: false,
    };
    if (CBZ.CONFIG.BOMB_WALK_V1 === false) {          // revert: no stagger at all
      for (let i = 0; i < pts.length; i++) dropOne(walk, pts[i]);
      return { cancel: function () {}, points: pts.length };
    }
    while (walks.length >= WALK_MAX) walks.shift();   // oldest walk gives way
    walks.push(walk);
    return {
      points: pts.length,
      cancel: function () { walk.dead = true; },
      done: function () { return walk.dead || walk.i >= walk.pts.length; },
    };
  };
  CBZ.cityBombWalkActive = function () { return walks.length; };

  function dropOne(walk, p) {
    const y = p.y == null ? floorAt(p.x, p.z) + 1.2 : p.y;
    // ---- the ordnance itself (opt-in — see the two-modes note above) ------
    if (walk.detonate) {
      if (CBZ.detonate) {
        try {
          CBZ.detonate(p.x, y, p.z, walk.kind, {
            by: walk.by, byPlayer: walk.byPlayer, scale: walk.scale,
            dirx: walk.dirx, dirz: walk.dirz,
          });
        } catch (e) {}
      } else if (CBZ.cityAirstrikeExplosion) {
        // degrade-safe: the bus is optional, the walk is not
        try { CBZ.cityAirstrikeExplosion(p.x, p.z, { power: 2.4, radius: 13, byPlayer: walk.byPlayer }); } catch (e) {}
      }
    }
    // ---- DUST MERGING along the line: the stick reads as ONE rolling wall
    // of dust rather than N unrelated craters. Pooled crashfx kicks only —
    // no pool of ours, and the count rides the quality tier.
    if (CBZ.cityDustKick) {
      try { CBZ.cityDustKick(p.x, y, p.z, walk.detonate ? 1.4 : 2.0); } catch (e) {}
      const prev = walk.prev;
      if (prev) {
        const nMid = Math.round(CBZ.qScale ? CBZ.qScale(0, 2) : 2);
        for (let i = 1; i <= nMid; i++) {
          const f = i / (nMid + 1);
          const mx = prev.x + (p.x - prev.x) * f, mz = prev.z + (p.z - prev.z) * f;
          try { CBZ.cityDustKick(mx, floorAt(mx, mz) + 0.7, mz, 1.6); } catch (e) {}
        }
      }
    }
    walk.prev = p;
    if (walk.onEach) { try { walk.onEach(p.x, y, p.z); } catch (e) {} }
  }

  function stepWalks(dt) {
    for (let w = walks.length - 1; w >= 0; w--) {
      const walk = walks[w];
      if (walk.dead) { walks.splice(w, 1); continue; }
      walk.t += dt;
      // bounded catch-up: a stalled frame drops at most 3 bombs at once rather
      // than dumping the whole stick in one frame.
      let fired = 0;
      while (walk.i < walk.pts.length && walk.t >= walk.i * walk.interval && fired < 3) {
        dropOne(walk, walk.pts[walk.i]);
        walk.i++; fired++;
      }
      if (walk.i >= walk.pts.length) walks.splice(w, 1);
    }
  }

  /* ============================================================
     LAZY WIRING — register with the bus whenever it shows up, whatever the
     script order ends up being (city/nukefx.js may legitimately load before
     systems/impactbus.js). Idempotent, one boolean test per frame.
     ============================================================ */
  let wired = false;
  function wire() {
    if (wired || !CBZ.impact || !CBZ.impact.fx) return;
    wired = true;
    try {
      CBZ.impact.fx("nuke", composeNuke);
      CBZ.impact.fx("moab", composeMoab);
      // The bus's "moab" row still names the generic "heavy" composer. Point
      // it here — but ONLY if nobody has changed it, so when the bus's own
      // table adopts fx:"moab" this becomes a no-op instead of a fight.
      if (CBZ.CONFIG.NUKE_FX_MOAB && CBZ.impact.row && CBZ.impact.define) {
        const row = CBZ.impact.row("moab");
        if (row && row.fx === "heavy") {
          const spec = Object.assign({}, row);
          spec.fx = "moab";
          CBZ.impact.define("moab", spec);
        }
      }
    } catch (e) {}
  }

  // A fresh run must not inherit a mushroom cloud. crashfx.js's
  // cityBlastFxReset is the existing run-reset chokepoint; wrap it the same
  // lazy, marker-copying way structural.js wraps cityGlassReset.
  let resetWrapped = false;
  function wrapReset() {
    if (resetWrapped) return;
    const orig = CBZ.cityBlastFxReset;
    if (typeof orig !== "function") return;
    resetWrapped = true;
    if (orig._nukeFxWrapped) return;
    const wrapped = function () {
      try { endSequence(); flashClear(); walks.length = 0; } catch (e) {}
      return orig.apply(this, arguments);
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._nukeFxWrapped = true;
    CBZ.cityBlastFxReset = wrapped;
  }

  /* ============================================================
     THE ONE UPDATER. onAlways(9.62) — immediately after crashfx.js's own
     pooled-FX ticker at 9.5 (9.6 is taken by city/vehicles.js), and on the
     ALWAYS chain on purpose: a nuke that kills the player must still finish
     its arc and clean up its geometry while the run is over, instead of
     freezing a 300-metre cloud in the sky and a white sheet over the menu.
     It also has to run AFTER core/daynight.js@2 (which re-copies scene.fog
     .color every frame) and BEFORE core/sky.js@99 (which paints its horizon
     stop FROM scene.fog.color) — that ordering is what makes the atmosphere
     drive above both self-restoring and free.
     Costs three length/null checks when nothing is exploding.
     ============================================================ */
  if (CBZ.onAlways) CBZ.onAlways(9.62, function (dt) {
    wire();
    wrapReset();
    if (!live && !walks.length && !flash) return;
    const d = dt > 0.25 ? 0.25 : dt;     // spike-cap: a stalled frame must not teleport the front
    if (flash) { try { stepFlash(d); } catch (e) { flash = null; } }
    if (live) { try { stepSequence(d); } catch (e) { endSequence(); } }
    if (walks.length) { try { stepWalks(d); } catch (e) { walks.length = 0; } }
  });

  /* ============================================================
     DEV/QA — read the whole spectacle's numbers from a CDP probe with no
     rendering at all (CLAUDE.md's closed loop is math over live state).
     ============================================================ */
  CBZ.nukeFxDebug = function () {
    return {
      wired: wired,
      live: live ? {
        kind: live.kind, t: +live.t.toFixed(2), r: +live.r.toFixed(1),
        maxR: +live.maxR.toFixed(1), eff: +live.eff.toFixed(1),
        gy: +live.y.toFixed(1), burstY: +live.by.toFixed(1),
        R: +live.R.toFixed(1), capW: +live.capW.toFixed(1), riseH: +live.riseH.toFixed(1),
        ringLife: +live.ringLife.toFixed(2), fogK: +live.fogK.toFixed(3),
        bills: live.bills.length,
        pending: live.pending.length, ash: !!live.ash,
        shell: !!live.shell, dome: !!live.dome, ring: !!live.ring, torus: !!live.torus,
      } : null,
      flash: flash ? { t: +flash.t.toFixed(2), dur: flash.dur, peak: flash.peak, keys: flash.keys.length } : null,
      walks: walks.map(function (w) { return { kind: w.kind, i: w.i, n: w.pts.length }; }),
      pool: { bills: POOL.bills.length, built: !!POOL.shell },
      q: +q01().toFixed(2),
      flags: {
        v1: !!CBZ.CONFIG.NUKE_FX_V1, shell: !!CBZ.CONFIG.NUKE_FX_SHELL,
        ash: !!CBZ.CONFIG.NUKE_FX_ASH, moab: !!CBZ.CONFIG.NUKE_FX_MOAB,
        sky: !!CBZ.CONFIG.NUKE_FX_SKY, walk: !!CBZ.CONFIG.BOMB_WALK_V1,
      },
    };
  };

  /* CBZ.nukeFxSize(kind, opts) — what the spectacle WOULD be, without firing it.
     The numeric twin of CBZ.impact.priceOf(), and the assertion surface for the
     bug this file shipped with: `fireball` MUST equal the row's radius*power
     (126 m for the nuke, 41 m for the MOAB), and `reach` MUST equal the bus's
     own wave maxR after the same quality clamp. If those two ever disagree with
     CBZ.impact.priceOf(), the picture and the damage have drifted apart. */
  CBZ.nukeFxSize = function (kind, opts) {
    opts = opts || {};
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    row = row || { power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 9 : 14,
                   wave: kind === "moab" ? { speed: 140, maxR: 150 } : { speed: 190, maxR: 620 } };
    const eff = fireR(row, opts);
    const R = Math.max(5, eff * P.rFrac);
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const reach = (row.wave ? row.wave.maxR : eff * 4) * (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1) * sc;
    return {
      kind: kind, fireball: +eff.toFixed(1), R: +R.toFixed(1),
      capW: +(R * P.capK).toFixed(1), capY: +(R * P.riseK).toFixed(1),
      reach: +reach.toFixed(1),
      bills: Math.max(1, Math.min(P.bills, Math.round(CBZ.qScale ? CBZ.qScale(1, P.bills) : P.bills))),
      shell: !!(CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28),
      addLayers: (CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28 ? 1 : 0) + 1,   // shell + ring
    };
  };

  // ---- BUILD AT LOAD (the crashfx prewarm doctrine) ------------------------
  // Four canvas bakes, four shader programs and nine meshes, all minted here
  // rather than in the frame a warhead lands — core/fxwarm.js then compiles
  // the programs during the play-start transition, so the first nuke of a
  // session hits fully warm caches. The eager rng() draws happen in a FIXED
  // order at init, so every client advances the stream identically.
  try { buildPool(); } catch (e) { /* no THREE / no scene: the composers degrade to the near field */ }
  wire();
})();
