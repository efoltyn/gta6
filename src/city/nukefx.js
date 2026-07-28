/* ============================================================
   city/nukefx.js — THE NUKE + BIG-BLAST SPECTACLE.

   This file DRAWS. It owns no damage, no ledger, no lethality: every one of
   those already exists and is already tuned (crashfx.js's pooled blast +
   applyBlastDamage, systems/impactbus.js's propagating wave, city/
   structural.js's collapse ledger). It plugs into the ordnance bus by NAME:

       CBZ.impact.fx("nuke", composer)      // src/systems/impactbus.js
       CBZ.detonate(x, y, z, "nuke")        // ...and the row starts working

   The bus owns all scale/damage numbers; this file consumes them and leaves
   crashfx's proven near-field composer intact.

   ------------------------------------------------------------------
   WHAT THE SEQUENCE IS (Glasstone/Dolan beat table, compressed for pacing —
   the timings are the spec's, the techniques are Fallout 4 / Frostbite's).
   Absolute seconds are for the stock nuke row; every one of them is reported
   by CBZ.nukeFxAudit() so the sequence is a set of NUMBERS, not a screenshot:

     0.00       WHITEOUT      full-screen white DOM div (#nukeFlash). The
                              cheapest, highest-impact beat in the game: one
                              composited layer, no fill cost in GL at all.
                              Never dropped, at any quality tier.
     0.00-0.55  FIRST MAXIMUM the isothermal ball. BLUE-WHITE, not orange, and
                              deliberately drawn OVERBRIGHT (colour > 1.0, see
                              flashRadiance) so core/renderer.js's tone mapper
                              rolls it off to a hard white core — "brighter
                              than the sun" without a bloom pass.
     0.18-0.30  THE MINIMUM   the DOUBLE FLASH, and the single most recognisable
                              thing a nuclear device does — bhangmeters count
                              warheads by it. The expanding shock front goes
                              OPAQUE and swallows its own fireball, so the light
                              DIPS almost to nothing, then the second thermal
                              pulse burns back through it: brighter, and far
                              longer. ONE curve (PULSE) drives all three layers
                              that must agree about it — the DOM div, the
                              fireball's own radiance, and the sky tint — so the
                              dip can never be present in one and absent in
                              another. The real dip is ~1 ms small / tens of ms
                              large; 120 ms here is a deliberate compression,
                              because a 15 ms dip is one frame and reads as a
                              dropped frame rather than as a nuclear weapon.
     0.06-0.62  SHOCK VEIL    the opaque front that CAUSES the minimum, drawn:
                              a near-white shell expanding at wave speed,
                              rendered ABOVE the fireball (renderOrder 9 vs 8)
                              so it genuinely hides it, then thinning as the
                              second pulse burns through.
     0.62-1.90  CONDENSATION  the same shell, continued: the Wilson cloud, the
                              transient near-white SHELL (never a ball — that is
                              what uCore 0.06 + uRimPow 2.6 buys) thrown by the
                              rarefaction behind the front, then evaporating.
     0.10-3.90  IGNITION      a 126 m low-poly luminous core wrapped in
                              instanced hot billows. The radius is the published
                              50*W^(1/3) maximum-fireball relation at the game's
                              roughly 15 kt scale, cooling blue-white
                              -> white -> yellow -> orange -> deep red along the
                              shared RAMP as it rises and mixes.
     0.50-6.30  PRESSURE      NO drawn ring. The invisible gameplay wave still
                              rolls outward, while an irregular filled dust
                              surge, scattered world fires and a brief 3D
                              condensation shell reveal its passage. A pressure
                              front is compressed air, not neon painted on the
                              terrain.
     1.37-6.85  GLASS LADDER  four cityShatter passes at 0.42 / 0.85 / 1.35 /
                              2.10 x the blast reach (260 / 527 / 837 / 1302 m),
                              each timed to r/speed so the panes go out AS THE
                              FRONT PASSES rather than on a clock of their own.
                              Glass is the ~1 psi zone: the widest of the three
                              and the biggest single injury source a city
                              detonation produces, so it must outrange both the
                              flattening and the burning. It used to outrange
                              neither.
     1.00-14.0  RISE + STEM   the fireball climbs and cools; the stem billboard
                              (cylindrically billboarded, so it stays vertical
                              when you crane your neck at it) is drawn UP off
                              the deck into it. The rise is FAST THEN
                              DECELERATING and then flat (riseAt) — an
                              exponential approach to a stabilisation altitude,
                              not the constant climb films draw. ONE curve,
                              read by the fireball, the cap, the stem and the
                              roll, so they cannot disagree about how high the
                              cloud is.
     0.70-25.0  MUSHROOM      four pooled InstancedMeshes form a genuinely 3D
                              hot core, thin rising stem, broad lobed cap and
                              filled ground cloud. Procedural billboards add
                              roiling surface detail but no longer have to carry
                              the silhouette alone.
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

   PROPORTIONS — the thing films get wrong and the thing this file got wrong.
   The stock nuke row draws a 126 m maximum-radius fireball, a compressed game
   stabilisation altitude of ~907 m over the burst, a cap that blooms to ~488 m
   across and a stem ~35 m across (~60 m by full rise). That is a cloud
   TOP:CAP WIDTH of 2.19:1 and a CAP:STEM
   of 9.8:1. Both were wrong before — 1.75:1 and 6.5:1, a squat cloud on a fat
   stalk, which is exactly the silhouette films draw and real film does not.
   Both are reported by CBZ.nukeFxAudit().proportions so they cannot drift back
   without somebody having to change a number they can see.

   WHAT THIS FILE DOES NOT OWN: gameplay blast, thermal and glass zones remain
   the bus's and ledger's. This file renders consequences—cloud, dust, world
   fires and broken windows—without outlining any zone on the ground.

   MUSHROOM CLOUDS, CHEAPLY: four InstancedMeshes form the 3D silhouette and
   3-5 procedural billboards add noisy surface detail. Every texture is baked
   at load; nothing is fetched (CDN is blocked and must stay that way).

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
     • Everything rides CBZ.qScale. At tier 0 the sequence keeps whiteout plus
       a reduced instanced mushroom; it never degrades into a ground ring.
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
  // the sequence. false => the volumetric cloud and whiteout still run.
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

  /* ---- the phenomenology flags. Each is ONE beat and ONE revert. ----------
     Every one of these is degrade-safe by construction: turning it off returns
     the layer to the curve it had before, it never removes the layer. */
  // THE DOUBLE FLASH, IN THE WORLD. false => the DOM div still dips (that has
  // always been there) but the FIREBALL and the sky ride a flat envelope, i.e.
  // the pre-existing behaviour where the signature existed only on the overlay.
  if (CBZ.CONFIG.NUKE_FX_PULSE == null) CBZ.CONFIG.NUKE_FX_PULSE = true;
  // THE SHOCK VEIL — the opaque front that swallows the fireball, drawn above
  // it. false => the condensation shell keeps its old 0.28s start and its old
  // "sits behind the fireball" render order.
  if (CBZ.CONFIG.NUKE_FX_VEIL == null) CBZ.CONFIG.NUKE_FX_VEIL = true;
  // THE RISE CURVE — fast, then decelerating, then stable. false => the old
  // smoothstep (slow-start, constant-ish middle), which is what films draw.
  if (CBZ.CONFIG.NUKE_FX_RISE == null) CBZ.CONFIG.NUKE_FX_RISE = true;
  // THE CLOUD ROLL, earlier and decaying. It drives the billboard shear and
  // the 3D cap-lobe circulation; there is deliberately no visible torus mesh.
  if (CBZ.CONFIG.NUKE_FX_ROLL == null) CBZ.CONFIG.NUKE_FX_ROLL = true;
  // THE GLASS LADDER — cityShatter passes walking outward WITH the front, out
  // past the blast reach. false => the old three fixed-clock passes that all
  // landed INSIDE the flattened zone.
  if (CBZ.CONFIG.NUKE_FX_GLASS == null) CBZ.CONFIG.NUKE_FX_GLASS = true;

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
  /* THE COLOUR THE RAMP DELIBERATELY DOES NOT HAVE.

     RAMP starts at a warm white because it is shared with the CLOUD billboards,
     and a blue cloud is nonsense. But a fireball does not start at warm white
     either: for the first fraction of a second it is an isothermal ball at tens
     of thousands of kelvin and it reads BLUE-white — far bluer, and far
     brighter, than the sun. That colour belongs to exactly one layer for
     exactly one beat, so it lives here as a single Color the shell lerps
     toward and away from, rather than as a second stop nobody else wants. */
  const BLUE_WHITE = new THREE.Color(0xd6e8ff);
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

  /* ============================================================
     THE MESH POOL — built ONCE at load, parked invisible, reused by every
     detonation for the life of the session. Nothing here is ever disposed
     (they are session-lifetime shared resources, exactly like crashfx's
     chunkGeo/chunkMat), and every object carries userData so core/batch.js
     can never swallow it into a merged buffer.
     ============================================================ */
  const POOL = {
    shell: null, dome: null, bills: [],
    capVol: null, stemVol: null, surgeVol: null, hotVol: null,
  };
  const MAX_BILLS = 5;
  const VOL_MAX = { cap: 28, stem: 16, surge: 24, hot: 16 };
  const VOL_SEED = { cap: [], stem: [], surge: [], hot: [] };

  // One deterministic layout, reused by every detonation. The instances move
  // and swell, but never allocate. A 3D lobe cloud remains a mushroom from the
  // B-2's steep camera angle; a camera-facing cap quad becomes a flat disc.
  function seedVolumes() {
    if (VOL_SEED.cap.length) return;
    for (let i = 0; i < VOL_MAX.cap; i++) {
      const a = i ? (i * 2.399963 + rng() * 0.24) : 0; // golden-angle, no spokes
      VOL_SEED.cap.push({
        a: a, r: i ? Math.sqrt(rng()) * 0.86 : 0,
        y: i ? (rng() - 0.42) * 0.48 : 0.08,
        s: i ? 0.16 + rng() * 0.12 : 0.34,
        spin: (rng() - 0.5) * 0.28,
      });
    }
    for (let i = 0; i < VOL_MAX.stem; i++) {
      VOL_SEED.stem.push({
        f: (i + 0.45) / VOL_MAX.stem,
        a: i * 2.399963 + rng() * 0.35,
        r: 0.08 + rng() * 0.28,
        s: 0.78 + rng() * 0.42,
      });
    }
    for (let i = 0; i < VOL_MAX.surge; i++) {
      VOL_SEED.surge.push({
        a: i * 2.399963 + rng() * 0.42,
        r: Math.sqrt((i + 0.6) / VOL_MAX.surge) * (0.82 + rng() * 0.18),
        s: 0.70 + rng() * 0.55,
      });
    }
    for (let i = 0; i < VOL_MAX.hot; i++) {
      const a = i * 2.399963 + rng() * 0.3;
      VOL_SEED.hot.push({
        a: a, r: 0.18 + Math.sqrt(rng()) * 0.72,
        y: (rng() - 0.35) * 0.9,
        s: 0.14 + rng() * 0.12,
      });
    }
  }

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
    const billowGeo = new THREE.IcosahedronGeometry(1, 1);   // 80 tris x instances
    billowGeo._shared = true;
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    quadGeo._shared = true;

    /* RENDER ORDER. The filled ground cloud is first, then the opaque-ish
       volumetric stem/cap, then surface-detail billboards, then the hot volume
       and fireball core, and finally the condensation shell.

       THE VEIL IS ABOVE THE FIREBALL ON PURPOSE (9 vs 8), and that one number
       is what makes the double flash real in the WORLD rather than only on the
       DOM overlay. The fireball is ADDITIVE: nothing can ever hide it by being
       "in front" in depth, because additive has no behind. The only way the
       shock front can swallow its own fireball — which is the entire physical
       cause of the minimum — is to be painted after it. It used to be painted
       before it (7), so the "condensation dome" could only ever ADD light to
       the thing it is supposed to be extinguishing. */
    const shellMat = makeShellMat(true);
    POOL.shell = park(new THREE.Mesh(sphereGeo, shellMat), 8);

    const domeMat = makeShellMat(false);
    domeMat.uniforms.uRimColor.value.set(0xffffff);
    domeMat.uniforms.uCoreColor.value.set(0xdfe8f2);
    domeMat.uniforms.uRimPow.value = 2.6;
    domeMat.uniforms.uCore.value = 0.06;
    POOL.dome = park(new THREE.Mesh(sphereGeo, domeMat), 9);

    seedVolumes();
    function volumeMat(color, emissive, opacity) {
      const m = new THREE.MeshLambertMaterial({
        color: color, emissive: emissive, emissiveIntensity: 1,
        transparent: true, opacity: opacity, depthWrite: true,
        fog: true, flatShading: true,
      });
      m._shared = true;
      return m;
    }
    function volumeMesh(name, count, material, order) {
      const mesh = new THREE.InstancedMesh(billowGeo, material, count);
      mesh.name = "nuke-" + name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      return park(mesh, order);
    }
    POOL.surgeVol = volumeMesh("ground-cloud", VOL_MAX.surge,
      volumeMat(0x746154, 0x1b0d07, 0.88), 4);
    POOL.stemVol = volumeMesh("stem", VOL_MAX.stem,
      volumeMat(0x4b3a31, 0x24110a, 0.94), 5.1);
    POOL.capVol = volumeMesh("cap", VOL_MAX.cap,
      volumeMat(0x5b4030, 0x301208, 0.96), 5.2);
    const hotMat = new THREE.MeshBasicMaterial({
      color: 0xff8a20, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: true,
      blending: THREE.AdditiveBlending,
    });
    hotMat._shared = true;
    POOL.hotVol = volumeMesh("hot-billows", VOL_MAX.hot, hotMat, 7);

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
  /* THE THERMAL PULSE. ONE table, THREE consumers.

     This curve is not just the DOM div's keyframes: it is the radiance of the
     event, and the div, the fireball's own brightness and the sky tint all read
     it through keyAt()/flashRadiance(). That is deliberate and it is the
     correction that mattered most in this file. Before, the dip lived ONLY on
     the overlay — the 3D fireball ramped up monotonically underneath it — so
     the most recognisable signature a nuclear weapon has was a property of a
     white rectangle rather than of the explosion. If the div dips and the world
     does not, the eye reads a UI glitch.

     Shape, against Glasstone & Dolan fig. 2.39: a first maximum reached in
     under a millisecond, a minimum as the shock front becomes opaque and
     swallows the fireball, then a second maximum that is broader and carries
     ~99% of the thermal energy. Normalised 0..1 of the total fade, so one table
     serves any duration.

     THE COMPRESSION IS DELIBERATE AND IT IS THE ONLY LIBERTY TAKEN. The real
     minimum is ~1 ms for a small device and tens of ms for a large one. At
     2.9 s of fade the honest normalised position of a 30 ms dip is 0.010, which
     is a single frame at 60 Hz and reads as a dropped frame, not as a weapon.
     The dip is held at 0.062..0.105 (about 180-305 ms absolute) so it is
     ~7 frames of genuinely dark before the second pulse — long enough to SEE
     the shock front standing in front of the fireball, which is the whole
     point. Everything else keeps the spec's proportions: the second maximum is
     brighter than the first is at the same age, and its tail is ~4x longer than
     the first pulse's. */
  const FLASH_DOUBLE = [
    [0.000, 1.00],   // FIRST MAXIMUM: instantaneous, total
    [0.028, 0.78],   // the isothermal ball is already being overtaken
    [0.062, 0.09],   // THE MINIMUM — the shock front has gone opaque
    [0.105, 0.12],   // ...and it HOLDS. Films never draw this and it is the beat.
    [0.185, 1.00],   // SECOND MAXIMUM: slower to build, brighter, far longer
    [0.400, 0.82],
    [0.680, 0.40],
    [1.000, 0.00],
  ];
  const FLASH_SINGLE = [[0.0, 1.0], [0.22, 0.45], [1.0, 0.0]];

  // Sample any of the tables above at normalised age u. Shared by stepFlash
  // (the div) and flashRadiance (the world).
  function keyAt(keys, u) {
    u = clamp(u, 0, 1);
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i];
        return a[1] + (b[1] - a[1]) * ((u - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return 0;
  }

  /* flashRadiance(t, P) — the pulse as a MULTIPLIER for a world layer.

     Returns exactly 1.0 once the pulse window is over, so any layer can
     multiply it in without also handing this function control of that layer's
     own fade. (A naive `layer *= pulse` would delete the fireball at t=white,
     because the pulse table ends at zero.) The pulse's authority decays
     linearly across the first 72% of the fade; past that the layer's own
     envelope owns it completely. */
  function flashRadiance(t, P) {
    if (!CBZ.CONFIG.NUKE_FX_PULSE || !P.dbl) return 1;
    const w = P.white * 0.72;
    if (t >= w || w <= 0) return 1;
    return 1 - (1 - t / w) * (1 - keyAt(FLASH_DOUBLE, t / P.white)) * 0.90;
  }

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
    const v = keyAt(f.keys, u);
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
     and 18 m wide, while the actual damage zone rolled hundreds of metres out.
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

  /* PROPORTIONS ARE THE TELL. Everything below is a ratio against the fireball
     radius R, so the whole cloud stays in proportion at any yield, and the
     ratios are the ones test film actually shows rather than the ones films
     draw. Two of them were badly wrong and are the reason the cloud read as a
     bonfire's smoke column:

       CLOUD TOP : CAP WIDTH   was 1.75 : 1   now 2.19 : 1  (riseK 4.60 -> 7.20)
       CAP       : STEM WIDTH  was 6.50 : 1   now 9.82 : 1  (stemK 0.40 -> 0.28)

     A real mushroom is a THIN stalk under a WIDE cap, with a total height far
     greater than the cap is across — a 20 kt cloud stabilises around 12 km with
     a cap 5-6 km across. A squat cloud on a fat stalk is the single most common
     way a game gets this wrong, and this file was doing both. CBZ.nukeFxAudit()
     reports both ratios so they cannot drift back.

     `thermK` is the ONE new number: the ratio of the ignition radius to the
     blast radius. It is not picked — thermal radiant exposure at a given range
     scales as Y^0.41 and a given overpressure radius as Y^0.33, so the ratio of
     the two goes as Y^0.08, which at the yield the bus's nuke row is priced for
     lands at ~1.25. A chemical bomb's thermal pulse does not outrange its own
     blast at all, so the MOAB's is 0 and it has no outer thermal zone. */
  const STYLE = {
    nuke: {
      // OSTI/LLNL's peak visual-fireball estimate is Rmax = 50*W^(1/3) m.
      // The row's 126 m effective radius is already the right answer for the
      // game's ~15 kt event; halving it here was the tiny-fireball bug.
      rFrac: 1.00,
      riseK: 7.20,     // compressed stabilisation altitude (126m ball -> ~907m)
      capK: 2.75, stemK: 0.28, surgeK: 3.4,
      thermK: 1.25,    // ignition radius / blast radius (Y^0.08 — see above)
      riseT: 13, dur: 34, white: 2.9, whitePeak: 1, dbl: true,
      bills: 5, dome: true, volume: true, ash: true,
      secondary: 6, shatter: 4, thermal: 9,
      shake: 9, frontLife: 7.5, glow: 0.85,
    },
    moab: {
      // A MOAB throws a tall, dirty smoke column — genuinely taller relative to
      // its head than this file used to draw (riseK 2.60 -> 4.00) — but it is
      // NOT a mushroom, and it is deliberately left squatter and stubbier than
      // the nuke. The audit knows that and asserts it against chemical
      // thresholds rather than nuclear ones.
      // Its row radius is the pressure/damage near field, not a literal ball of
      // flame. Keep the visible chemical fireball to ~42 m at the 120 m row.
      rFrac: 0.35, riseK: 4.00, capK: 1.85, stemK: 0.30, surgeK: 2.6,
      thermK: 0,
      riseT: 5.6, dur: 13, white: 0.8, whitePeak: 0.82, dbl: false,
      bills: 3, dome: false, volume: true, ash: false,
      secondary: 3, shatter: 1, thermal: 0,
      shake: 4.5, frontLife: 3.4, glow: 0.7,
    },
  };

  /* THE GLASS LADDER, as multiples of the BLAST reach (wave.maxR).

     One table, read by beginSequence (which schedules the cityShatter passes)
     and by CBZ.nukeFxAudit (which publishes the resulting radii). By
     overpressure: ~5 psi collapses most buildings and IS maxR; ~2 psi takes
     roofs and walls; ~1 psi shatters windows several times further out again.
     For a real 100 kt airburst those land at roughly 1x / 1.5x / 2.6x maxR, and
     the last rung here is deliberately the widest thing this file touches —
     every pane in the district goes, which is the correct read and also a
     BOUNDED one, because buildings.js's cityShatter caps itself at 50 panes per
     call whatever radius you hand it. A bigger radius costs nothing extra; it
     just stops the breakage being concentrated on the block you were standing on. */
  const GLASS_K = [0.42, 0.85, 1.35, 2.10];

  /* ============================================================
     THE RISE — ONE curve, four readers.

     This used to be `ease((t - 0.9) / riseT)` copy-pasted into the fireball,
     billboards and cap roll: three places that all had to agree about how
     high the cloud was and had no structural reason to. It is now one function,
     and fixing the SHAPE was a one-line change instead of three.

     Smoothstep was the wrong shape twice over. It starts slow (a fireball is
     buoyant from the instant it forms — it does not ease in), and it holds a
     near-constant velocity through the middle (the thing films get wrong). A
     real cloud rises FAST and then DECELERATES hard as it entrains cold air and
     loses buoyancy, then stabilises flat at the tropopause and stops. That is
     an exponential approach, not an S-curve:

         rise(u) = (1 - e^(-K u)) / (1 - e^-K)

     with K = 3.4, which puts ~50% of the height in the first 20% of the window
     and leaves the last 10% of the height taking a third of it. The first 10%
     of the window cross-fades in from a smoothstep purely so there is no
     velocity discontinuity at the start of the beat. Monotonic throughout, 0 at
     u=0 and exactly 1 at u=1, so nothing downstream needs clamping. */
  const RISE_K = 3.4;
  const RISE_E = Math.exp(-RISE_K);
  function riseAt(t, L) {
    const u = clamp((t - 0.9) / L.style.riseT, 0, 1);
    if (!CBZ.CONFIG.NUKE_FX_RISE) return ease(u);        // revert: the old S-curve
    const d = (1 - Math.exp(-RISE_K * u)) / (1 - RISE_E);
    const w = clamp(u / 0.10, 0, 1);
    return d * w + ease(u) * (1 - w);
  }
  // Absolute world Y of the cap centre for a given rise. Never a multiply on an
  // absolute Y — L.by already carries the terrain height under ground zero.
  function capYAt(rise, L) { return L.by + L.R * 0.6 + (L.riseH - L.R * 0.6) * rise; }
  /* Lateral bloom. The cap keeps widening AFTER the rise stops — that is the
     anvil spreading out along the stable layer, and a cloud that freezes solid
     the instant it reaches altitude is the other half of the "constant rise"
     tell. The second term is that slow post-stabilisation spread. */
  function bloomAt(t, L) {
    const P = L.style;
    const spread = clamp((t - P.riseT) / Math.max(1, P.dur - P.riseT), 0, 1);
    return 0.35 + 0.9 * ease((t - 1.2) / (P.riseT * 0.85)) + 0.16 * spread;
  }

  // Billboard ROLES in priority order. At tier 0 only the first survives, and
  // the cap alone still reads as "a mushroom went up over there".
  const ROLES = ["cap", "stem", "surge", "cap2", "collar"];

  /* ============================================================
     THE SEQUENCE — one live object, one state machine, ONE updater.
     No setTimeouts: every scheduled beat is a row in `pending`, popped by t.
     ============================================================ */
  let live = null;

  function beginSequence(x, y, z, styleName, row, opts) {
    if (!POOL.shell || !POOL.capVol) return null;   // pool never built (no THREE/scene)
    const P = STYLE[styleName] || STYLE.nuke;
    const q = q01();
    const gy = floorAt(x, z);
    // EFFECTIVE near-field radius (see fireR above): 126 m for the nuke row,
    // ~120 m for the MOAB pressure footprint — NOT the row's bare field.
    const radius = fireR(row, opts);
    const R = Math.max(5, radius * P.rFrac);
    const wave = row.wave || null;
    // Match systems/impactbus.js's queueWave EXACTLY — same quality clamp AND
    // the same fxScale so rendered consequences reach the gameplay footprint.
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const maxR = (wave && wave.maxR ? wave.maxR : radius * 4) *
                 (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1) * sc;
    const spd = wave && wave.speed ? wave.speed : 150;
    /* BURST HEIGHT. The bus hands the composer the real detonation `y`, and a
       B-2 releasing over a district is the whole reason this file exists — an
       airburst is not a ground burst with the same picture. So the FIREBALL,
       the condensation dome and the cap seat at the burst height while the
       base surge and the walking dust stay on the DECK, which
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
      // THE IGNITION RADIUS. Y^0.41 vs Y^0.33 (see STYLE.thermK) — the burn zone
      // is genuinely wider than the flattened zone, and this is the number that
      // says so. Zero for anything chemical. It is never drawn as an outline.
      burnR: P.thermK > 0 ? maxR * P.thermK : 0,
      riseH: R * P.riseK, capW: R * P.capK, stemW: R * P.stemK, surgeW: R * P.surgeK,
      t: 0, r: Math.max(1, row.radius || radius * 0.1), dur: P.dur, q: q,
      // The front still drives damage, dust and condensation, but it is never
      // painted as geometry on the terrain.
      frontLife: Math.min(P.frontLife, maxR / Math.max(1, spd) + 1.6),
      bills: bills, dustAcc: 0, pending: [], ash: null, ashT: 0,
      boomAt: dist > 60 ? Math.min(9, dist / 343) : -1,
      frontAt: dist > 45 && dist < maxR ? dist / Math.max(1, spd) : -1,
      frontHit: false, fogK: 0,
      mode: (CBZ.game && CBZ.game.mode) || null,
      quiet: !!opts.quiet, noDamage: !!opts.noDamage, byPlayer: !!opts.byPlayer,
    };

    // ---- shells -----------------------------------------------------------
    // Tier 2+ gets the smooth luminous core and condensation veil. Every tier
    // gets a reduced 3D lobe cloud, so the fallback remains a mushroom instead
    // of becoming the old flat ring.
    const wantShell = CBZ.CONFIG.NUKE_FX_SHELL && q > 0.28;
    live.shell = wantShell ? POOL.shell : null;
    live.dome = wantShell && P.dome && q > 0.45 ? POOL.dome : null;
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
    // ---- VOLUMETRIC FIREBALL + MUSHROOM ------------------------------------
    // Four InstancedMeshes, four draw calls at every quality. Counts fall with
    // quality, not physical size; the silhouette never shrinks into a toy.
    live.volume = !!P.volume;
    if (live.volume) {
      const nuke = styleName === "nuke";
      const count = function (lo, hi) {
        return Math.max(lo, Math.min(hi, Math.round(CBZ.qScale ? CBZ.qScale(lo, hi) : hi)));
      };
      live.volN = {
        cap: count(nuke ? 12 : 8, nuke ? VOL_MAX.cap : 18),
        stem: count(nuke ? 8 : 5, nuke ? VOL_MAX.stem : 10),
        surge: count(nuke ? 10 : 7, nuke ? VOL_MAX.surge : 15),
        hot: count(nuke ? 8 : 6, nuke ? VOL_MAX.hot : 11),
      };
      POOL.capVol.count = live.volN.cap;
      POOL.stemVol.count = live.volN.stem;
      POOL.surgeVol.count = live.volN.surge;
      POOL.hotVol.count = live.volN.hot;
      const vv = [POOL.surgeVol, POOL.stemVol, POOL.capVol, POOL.hotVol];
      for (let i = 0; i < vv.length; i++) {
        vv[i].position.set(x, gy, z);
        vv[i].visible = true;
      }
      POOL.capVol.material.opacity = 0;
      POOL.stemVol.material.opacity = 0;
      POOL.surgeVol.material.opacity = 0;
      POOL.hotVol.material.opacity = 0;
    }

    /* ---- SCHEDULED BEATS. All of them route into systems that are already
       pooled and capped: crashfx's cityExplosion (FX-only satellites — the
       bus's wave owns the damage out there) and buildings.js's cityShatter.
       Counts ride the quality tier; at tier 0 the lists are simply empty. --- */
    const nSat = Math.round((CBZ.qScale ? CBZ.qScale(0, P.secondary) : P.secondary));
    for (let i = 0; i < nSat; i++) {
      // Reuse the RPG's excellent puff explosion INSIDE the nuclear fireball.
      // The former even-radius placement drew a necklace of little blasts.
      const a = i * 2.399963 + rng() * 0.55;
      const rr = R * (0.16 + Math.sqrt((i + 0.35) / Math.max(1, nSat)) * 0.68);
      live.pending.push({
        t: 0.22 + i * 0.09,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 2.4, radius: 13, sat: true,
      });
    }
    const nSat2 = Math.round(nSat * 0.7);
    for (let i = 0; i < nSat2; i++) {
      const a = i * 2.399963 + 0.7 + rng() * 0.45;
      const rr = R * (0.55 + Math.sqrt(rng()) * 0.85);
      live.pending.push({
        t: 0.95 + i * 0.12,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 1.9, radius: 11, sat: true,
      });
    }
    /* THERMAL IGNITION IS AN AREA, NOT A CIRCLE. The actual thermal sweep in
       impactbus lights eligible structures between the pressure reach and the
       wider thermal reach. These few pooled flame/smoke receipts are scattered
       by AREA through that footprint, never at one radius. The world therefore
       shows irregular fires wherever combustible things exist rather than a
       mathematically perfect orange ring painted on empty terrain. */
    const nTherm = Math.round(CBZ.qScale ? CBZ.qScale(0, P.thermal) : P.thermal);
    for (let i = 0; i < nTherm; i++) {
      const a = i * 2.399963 + 1.9 + rng() * 0.7;
      const inner = Math.min(maxR * 0.70, Math.max(R * 1.25, 1));
      const outer = Math.max(inner, live.burnR > 0 ? live.burnR : maxR);
      const rr = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
      live.pending.push({
        t: 0.9 + i * 0.14,
        x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
        power: 1.1, radius: 16, sat: true, smoke: true,
      });
    }
    /* GLASS IS THE WIDEST OF THE THREE EFFECT ZONES.

       By overpressure: ~5 psi collapses most buildings (the classic destruction
       radius, and what `maxR` is), ~2 psi takes roofs and walls, and ~1 psi
       shatters windows across an area several times larger than any of it —
       flying glass is the single biggest injury source a city detonation
       produces. This ladder used to run 0.9 / 1.65 / 2.4 x the FIREBALL radius,
       i.e. 113 / 208 / 302 m against the old blast reach: every pane it broke
       was inside a zone where the buildings were already coming down. It now
       runs GLASS_K = 0.42 / 0.85 / 1.35 / 2.10 x the BLAST reach, so the last
       two passes land well beyond the demolition footprint.

       And each pass is timed to r/speed — the radius divided by the front's own
       speed — so the panes go out AS THE FRONT REACHES THEM rather than on a
       clock of their own. The outermost pass is past `maxR`, which the damage
       wave never reaches: that is not a mistake, it is the honest picture. The
       wave stops at its gameplay reach; a 1 psi front does not stop there, it
       just stops knocking buildings down.

       The tier walk DECIMATES the ladder evenly rather than truncating it, the
       same rule cityBombWalk uses on a bomb stick and for the same reason: a
       budget cut must cost you resolution, never REACH. Tier 0 keeps exactly one
       pass and the even walk lands it on the 1.35x rung — out past the blast
       rim, where the one pass a phone can afford does the most work — rather
       than on the innermost one a truncation would have left it with.
       Glass is the cheapest "the whole district felt that" cue there is,
       cityShatter skips already-broken panes and caps itself at 50 per call, so
       it must never floor to zero. */
    const nShatter = Math.max(1, Math.round((CBZ.qScale ? CBZ.qScale(1, P.shatter) : P.shatter)));
    if (CBZ.CONFIG.NUKE_FX_GLASS) {
      const step = GLASS_K.length / nShatter;
      for (let i = 0; i < nShatter; i++) {
        const k = GLASS_K[Math.min(GLASS_K.length - 1, Math.max(0, Math.round((i + 0.5) * step - 0.5)))];
        const rr = maxR * k;
        live.pending.push({ t: Math.max(0.3, rr / Math.max(1, spd)), shatter: rr });
      }
    } else {
      for (let i = 0; i < nShatter; i++) {
        live.pending.push({ t: 0.3 + i * 0.55, shatter: radius * (0.9 + i * 0.75) });
      }
    }
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
      /* IGNITION leaves something behind. crashfx's cityCrashSmoke is the
         pooled plume every wreck in the game already uses (six puffs a call,
         off the shared puff pool, self-recycling). Only the irregular thermal
         receipts carry `smoke`; the near-in satellites
         are inside the flattened zone, where the structural ledger's own fires
         are already the thing that is burning. */
      if (p.smoke && CBZ.cityCrashSmoke) {
        try { CBZ.cityCrashSmoke(p.x, floorAt(p.x, p.z) + 1.2, p.z, { count: 4, scale: 2.0 }); } catch (e) {}
      }
      return;
    }
    if (p.shatter != null && CBZ.cityShatter && live) {
      try { CBZ.cityShatter(live.x, live.z, p.shatter); } catch (e) {}
      return;
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
     Every detail plane stays vertical in world space and yaws only. Copying the
     camera's pitch was the aircraft-view bug: from above, the cap tipped flat
     and exposed itself as a disc precisely when the mushroom mattered most. */
  function faceCameraYaw(mesh) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return;
    mesh.rotation.set(0, Math.atan2(cam.position.x - mesh.position.x,
                                    cam.position.z - mesh.position.z), 0);
  }

  /* ---- TRUE 3D MUSHROOM VOLUME -------------------------------------------
     The old silhouette depended on one cap quad and a horizontal torus. From
     the B-2's steep view those become a disc and a ring. These four instanced
     lobe fields have real depth from every camera angle while remaining four
     draw calls total. The cap's instances circulate slowly around the stem;
     no geometry is a ring and no fragment is painted on the terrain. */
  const _volDummy = new THREE.Object3D();
  const VOL_HOT = new THREE.Color(0xff7a18);
  const VOL_ASH = new THREE.Color(0x332f2c);
  const VOL_STEM_HOT = new THREE.Color(0x5e3b2b);
  const VOL_STEM_ASH = new THREE.Color(0x292725);
  const VOL_DUST_HOT = new THREE.Color(0x806456);
  const VOL_DUST_ASH = new THREE.Color(0x5a5651);
  const VOL_EMBER = new THREE.Color(0x7a2a0b);
  const VOL_EMBER_OFF = new THREE.Color(0x080604);

  function putVolume(mesh, i, x, y, z, sx, sy, sz, ry) {
    _volDummy.position.set(x, y, z);
    _volDummy.rotation.set(0, ry || 0, 0);
    _volDummy.scale.set(Math.max(0.01, sx), Math.max(0.01, sy), Math.max(0.01, sz));
    _volDummy.updateMatrix();
    mesh.setMatrixAt(i, _volDummy.matrix);
  }

  function cloudColor(mat, hot, ash, u, ember) {
    mat.color.copy(hot).lerp(ash, clamp(u, 0, 1));
    if (mat.emissive) {
      mat.emissive.copy(ember || VOL_EMBER).lerp(VOL_EMBER_OFF, clamp(u * 1.25, 0, 1));
    }
  }

  function stepVolumes(t, L) {
    if (!L.volume || !L.volN) return;
    const rise = riseAt(t, L);
    const capY = capYAt(rise, L) - L.y;
    const bloom = bloomAt(t, L);
    const cloudCool = clamp((t - 0.7) / 11, 0, 1);
    const endFade = Math.max(0, 1 - ease((t - (L.dur - 8)) / 8));
    const roll = CBZ.CONFIG.NUKE_FX_ROLL
      ? t * (0.11 + 0.22 * Math.exp(-Math.max(0, t - 1) / 8))
      : t * 0.08;

    // CAP — a broad, deep mass of overlapping lobes. The slight vertical
    // circulation is the mushroom's overturn, without exposing a donut mesh.
    const cap = POOL.capVol;
    const capIn = ease((t - 0.55) / 1.15);
    const capRadius = L.capW * bloom * 0.5;
    for (let i = 0; i < L.volN.cap; i++) {
      const s = VOL_SEED.cap[i];
      const a = s.a + roll * (0.35 + s.r * 0.45) + s.spin * t;
      const rr = capRadius * s.r;
      const lobe = capRadius * s.s * (0.45 + 0.55 * capIn);
      const overturn = Math.sin(a * 1.7 + t * 0.55) * capRadius * 0.035;
      putVolume(cap, i,
        Math.cos(a) * rr,
        capY + capRadius * s.y + overturn,
        Math.sin(a) * rr,
        lobe * (1.08 + s.r * 0.22), lobe * (0.72 + (1 - s.r) * 0.18), lobe,
        a * 0.35);
    }
    cap.material.opacity = 0.96 * capIn * endFade;
    cloudColor(cap.material, VOL_HOT, VOL_ASH, cloudCool);
    cap.visible = cap.material.opacity > 0.004;
    cap.instanceMatrix.needsUpdate = true;

    // STEM — overlapping vertical billows leave no chair-leg-thin cylinder and
    // no gap under the cap. A mild spiral makes sucked-up debris visibly rise.
    const stem = POOL.stemVol;
    const stemIn = ease((t - 0.65) / 1.3);
    const h = Math.max(L.R * 0.55, capY);
    const stemR = L.stemW * (0.72 + rise * 0.88);
    const stemY = Math.max(L.R * 0.10, h / Math.max(5, L.volN.stem * 0.72));
    for (let i = 0; i < L.volN.stem; i++) {
      const s = VOL_SEED.stem[i];
      const a = s.a + roll * (0.28 + s.f * 0.35);
      const neck = 0.72 + Math.abs(s.f - 0.55) * 0.55;
      putVolume(stem, i,
        Math.cos(a) * stemR * s.r,
        Math.max(stemY * 0.45, h * s.f),
        Math.sin(a) * stemR * s.r,
        stemR * s.s * neck, stemY * s.s, stemR * s.s * neck,
        a);
    }
    stem.material.opacity = 0.91 * stemIn * endFade;
    cloudColor(stem.material, VOL_STEM_HOT, VOL_STEM_ASH, cloudCool);
    stem.visible = stem.material.opacity > 0.004;
    stem.instanceMatrix.needsUpdate = true;

    // BASE SURGE — a FILLED, irregular dust cloud. It occupies area; it never
    // traces the pressure radius as a line.
    const surge = POOL.surgeVol;
    const surgeIn = ease((t - 0.75) / 2.0);
    const surgeFade = Math.max(0, 1 - ease((t - Math.min(15, L.dur - 5)) / 7));
    const surgeMax = Math.min(L.maxR * 0.72, L.R * 3.6);
    const surgeR = surgeMax * (0.12 + 0.88 * ease((t - 0.55) / 6.2));
    for (let i = 0; i < L.volN.surge; i++) {
      const s = VOL_SEED.surge[i];
      const a = s.a + Math.sin(t * 0.16 + i) * 0.08;
      const rr = surgeR * s.r;
      const lobe = Math.max(L.R * 0.075, surgeMax * (0.055 + s.s * 0.028));
      putVolume(surge, i,
        Math.cos(a) * rr,
        lobe * (0.24 + 0.10 * Math.sin(i * 1.7)),
        Math.sin(a) * rr,
        lobe * 1.25, lobe * 0.38, lobe,
        a);
    }
    surge.material.opacity = 0.82 * surgeIn * surgeFade;
    cloudColor(surge.material, VOL_DUST_HOT, VOL_DUST_ASH, cloudCool * 0.85);
    surge.visible = surge.material.opacity > 0.004;
    surge.instanceMatrix.needsUpdate = true;

    // HOT BILLOWS — the RPG puff language the owner likes, enlarged around the
    // smooth core so the nuclear fireball roils instead of reading as one orb.
    const hot = POOL.hotVol;
    const hotIn = ease(t / 0.16);
    const hotFade = Math.max(0, 1 - ease((t - 2.8) / 3.2));
    const grow = 1 - Math.exp(-t * 5.5);
    const fireR0 = L.R * grow * (1 + rise * 0.30);
    const fireY = (L.by - L.y) + L.R * 0.55 +
      (L.riseH * 0.92 - L.R * 0.55) * rise;
    for (let i = 0; i < L.volN.hot; i++) {
      const s = VOL_SEED.hot[i];
      const a = s.a + t * 0.18;
      const rr = fireR0 * s.r * 0.68;
      const lobe = Math.max(0.01, fireR0 * s.s);
      putVolume(hot, i,
        Math.cos(a) * rr,
        fireY + s.y * fireR0 * 0.42,
        Math.sin(a) * rr,
        lobe * 1.08, lobe * 0.88, lobe,
        a);
    }
    const pulse = flashRadiance(t, L.style);
    hot.material.color.setHex(t < 0.45 ? 0xfff4cf : t < 1.8 ? 0xffa02e : 0xd94312);
    hot.material.opacity = 0.82 * hotIn * hotFade * (0.18 + 0.82 * pulse);
    hot.visible = hot.material.opacity > 0.004;
    hot.instanceMatrix.needsUpdate = true;
  }

  function stepBill(b, t, L) {
    const m = b.mesh, u = m.material.uniforms;
    // riseAt/capYAt/bloomAt — the SHARED curves. These three numbers used to be
    // recomputed with a copy-pasted smoothstep in three separate places (here,
    // the fireball and cap roll), so "how high is the cloud" had three
    // answers that only happened to agree.
    const rise = riseAt(t, L);
    const capY = capYAt(rise, L);
    const bloom = bloomAt(t, L);
    const fadeIn = ease((t - b.t0) / 0.7);
    const fadeOut = 1 - ease((t - (L.dur - 9)) / 9);
    let op = fadeIn * Math.max(0, fadeOut);
    if (t < b.t0) { m.visible = false; return; }

    // two INDEPENDENTLY scrolling noise lookups (the Fallout-4 trick) — driven
    // off sequence time, not per-frame increments, so the roil runs at the
    // same speed whatever the framerate is.
    // THE CAP'S SCROLL IS NOT RANDOM. Its two lookups shear vertically in
    // OPPOSITE directions, which on a vertical detail quad reads as material
    // climbing the middle and falling down the edges — the same overturn the
    // instanced lobes draw in 3D. The two layers agreeing stops the cap
    // looking like a still image with noise crawling on it; every other role
    // keeps its per-detonation random drift.
    const shear = (CBZ.CONFIG.NUKE_FX_ROLL && b.role === "cap") ? 0.055 : 0;
    u.uScroll.value.set(b.seed + b.sx * t, b.seed - (b.sy + shear) * t);
    u.uScroll2.value.set(b.seed * 0.7 - b.sx * 0.42 * t, b.seed * 1.3 + (b.sy + shear * 1.6) * 0.37 * t);

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
    // Once a 3D volume owns the silhouette, these planes are surface texture,
    // not the cloud itself. Keeping them subordinate prevents a steep aircraft
    // camera from revealing one enormous paper oval.
    if (L.volume) op *= 0.46;
    u.uOpacity.value = Math.max(0, op);
    m.visible = u.uOpacity.value > 0.004;
    if (m.visible) faceCameraYaw(m);
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
    // THE SKY DIPS TOO. flashRadiance is the same curve the div and the fireball
    // run on, so the horizon goes dark with the minimum and floods back with the
    // second pulse instead of holding a flat white through the one beat the
    // event is famous for. Past the pulse window it returns exactly 1 and the
    // three-stage colour walk below is untouched.
    const rad0 = flashRadiance(t, P);
    if (CBZ.CONFIG.NUKE_FX_SKY && scene.fog && scene.fog.color) {
      // white-out -> the fireball's own orange bounce -> ash overcast -> gone
      let k, hex;
      if (t < 0.55)      { hex = 0xfff4e2; k = (0.92 * (1 - t / 0.55) + 0.30) * (0.34 + 0.66 * rad0); }
      else if (t < 3.5)  { hex = 0xff9440; k = 0.62 * (1 - (t - 0.55) / 2.95) + 0.22; }
      else               { hex = 0x8d8478; k = 0.55 * Math.max(0, 1 - (t - 3.5) / (L.dur - 3.5)); }
      _fogTint.setHex(hex);
      L.fogK = k;
      scene.fog.color.lerp(_fogTint, clamp(k, 0, 0.95));
    }

    // ---- the invisible shock front (drives condensation + irregular dust) --
    const r = frontRadius(dt);
    // dust walking the front — pooled crashfx puffs, never a pool of ours
    if (t < L.frontLife && r < L.maxR) {
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
    const rise = riseAt(t, L);                              // ONE curve, four readers
    if (L.shell) {
      const grow = 1 - Math.exp(-t * 5.5);                 // fast punch, then stall
      const rad = L.R * (grow * (1 + rise * 0.35));
      const y = L.by + L.R * 0.55 + (L.riseH * 0.92 - L.R * 0.55) * rise;
      L.shell.position.set(L.x, y, L.z);
      L.shell.scale.setScalar(Math.max(0.01, rad));
      const u = L.shell.material.uniforms;
      const age = clamp(t / 7, 0, 1);
      rampColor(u.uRimColor.value, age * 0.55);
      rampColor(u.uCoreColor.value, Math.max(0, age * 0.9 - 0.04));
      /* COLOUR EVOLUTION, and the two things the shared RAMP alone cannot say.

         (1) BLUE-WHITE FIRST. The RAMP starts at a warm white because it is
             shared with the cloud billboards, but the isothermal ball is tens of
             thousands of kelvin for the first fraction of a second and reads
             blue-white. One lerp toward BLUE_WHITE, gone by ~0.35 s, after which
             the RAMP owns the whole cooling arc (white -> yellow -> orange ->
             deep red) exactly as before.

         (2) BRIGHTER THAN THE SUN, literally. core/renderer.js runs
             CustomToneMapping over every non-raw ShaderMaterial, so a colour
             ABOVE 1.0 is not clipped — it rolls off. Pushing the core to ~3.4x
             white is therefore how this file draws "far brighter than the sun"
             with no bloom pass, no second material and no extra fill: the tone
             mapper flattens the middle of the ball to hard white and leaves the
             rim graded, which is exactly what a fireball looks like on film.
             The gain rides flashRadiance, so it COLLAPSES at the minimum and
             floods back on the second pulse. That — not the DOM div — is what
             makes the double flash a property of the explosion. */
      const blue = 1 - ease(t / 0.35);
      if (blue > 0.001) {
        u.uRimColor.value.lerp(BLUE_WHITE, blue * 0.8);
        u.uCoreColor.value.lerp(BLUE_WHITE, blue);
      }
      const gain = 1 + 2.4 * rad0 * (1 - ease((t - 0.1) / 1.7));
      u.uCoreColor.value.multiplyScalar(gain);
      u.uRimColor.value.multiplyScalar(1 + (gain - 1) * 0.45);
      /* SEQUENCED, NOT STACKED: the fireball shell is the single most expensive
         layer here (a DoubleSide additive sphere that can fill most of the
         screen from close range), so it is retired at 3.9s — the exact moment
         the toroidal roll below fades in, rather than five seconds after it.
         That one number is the difference between 8 concurrent layers and 7,
         and it is why the roll could be pulled half a second earlier for free.
         The `rad0` factor is the shock front swallowing the ball: the alpha
         goes with the radiance, so at the minimum the ball is not merely hidden
         by the veil, it has actually stopped emitting. */
      u.uOpacity.value = Math.max(0, Math.min(1, t / 0.12) * (1 - ease((t - 2.15) / 1.75)) *
                                     (0.14 + 0.86 * rad0));
      if (u.uOpacity.value <= 0.004 && t > 3.5) { L.shell.visible = false; L.shell = null; }
    }

    /* ---- SHOCK VEIL -> WILSON CLOUD. ONE shell, TWO readings, and the second
       is what the first becomes.

         0.06-0.30  the front goes OPAQUE and swallows the fireball. This is the
                    physical CAUSE of the minimum, and until now the file drew
                    the effect (a dip on a white div) without ever drawing the
                    cause. It is rendered at renderOrder 9, ABOVE the additive
                    fireball, because that is the only way one transparent layer
                    can hide an additive one — see the note in buildPool.
         0.30-0.62  it thins as the second thermal pulse burns back through it.
         0.62-1.90  what is left is the WILSON CONDENSATION CLOUD: the rarefaction
                    behind the front drops the pressure, water condenses, and a
                    transient near-white SHELL stands in the air and then
                    evaporates. It is a shell and never a ball — uCore 0.06 with
                    uRimPow 2.6 is exactly that, and it was already right.

       Both readings are the same expanding sphere at the same wave speed, so
       this costs one retiming and no new layer. NUKE_FX_VEIL false returns the
       old behaviour: start at 0.28, one flat 0.34 alpha, no opaque phase. */
    if (L.dome) {
      const veil = CBZ.CONFIG.NUKE_FX_VEIL && P.dbl;
      const t0 = veil ? 0.06 : 0.28;
      if (t >= t0) {
        const dr = Math.min(r, L.R * (veil ? 1.35 : 1) + (t - t0) * L.spd * 0.85);
        L.dome.visible = true;
        L.dome.position.set(L.x, L.by + dr * 0.16, L.z);
        L.dome.scale.set(dr, dr * 0.72, dr);
        let op;
        if (!veil) {
          op = 0.34 * (1 - ease((t - 0.5) / 1.1));
        } else {
          // ramp to near-opaque across the first pulse's decay, then hand over
          // to the condensation reading on the same curve the fireball uses, so
          // the veil is thickest at exactly the frame the fireball is dimmest.
          const opaque = ease(t / 0.20) * (1 - rad0);
          const wilson = 0.30 * (1 - ease((t - 0.62) / 1.25));
          op = Math.max(0.88 * opaque, wilson);
        }
        L.dome.material.uniforms.uOpacity.value = Math.max(0, op);
        if (t > 1.9) { L.dome.visible = false; L.dome = null; }
      }
    }

    // The 3D volumes carry the actual mushroom silhouette from every angle.
    stepVolumes(t, L);

    // ---- procedural surface detail over the 3D cap/stem/surge -------------
    for (let i = 0; i < L.bills.length; i++) {
      const b = L.bills[i];
      // Stagger secondary texture lobes until the condensation veil has thinned.
      if (b.t0 == null) {
        b.t0 = b.role === "stem" ? 0.8
             : b.role === "cap" ? 0.9
             : b.role === "surge" ? 1.4
             : b.role === "cap2" ? 1.9
             : 2.2;                          // collar
      }
      stepBill(b, t, L);
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
    const mm = [
      POOL.shell, POOL.dome,
      POOL.capVol, POOL.stemVol, POOL.surgeVol, POOL.hotVol,
    ];
    for (let i = 0; i < mm.length; i++) {
      const m = mm[i];
      if (!m) continue;
      m.visible = false;
      if (m.isInstancedMesh) m.count = 0;
      if (m.material && m.material.uniforms && m.material.uniforms.uOpacity) m.material.uniforms.uOpacity.value = 0;
      if (m.material && m.material.opacity != null) m.material.opacity = 0;
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
     to 900 m — there is no gap between them, which is why the second
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
    // for the nuke, 4.6 / 26 for the MOAB) so a probe that fires this with no bus
    // loaded gets the same 126 m fireball the real row produces. `radius` here
    // is the row field, NOT the effective reach — fireR() does that multiply.
    row = Object.assign(
      { id: kind, power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
        wave: kind === "moab" ? { speed: 140, maxR: 320 } : { speed: 190, maxR: 900 } },
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
        frontLife: +live.frontLife.toFixed(2), fogK: +live.fogK.toFixed(3),
        burnR: +(live.burnR || 0).toFixed(1),
        rise: +riseAt(live.t, live).toFixed(3),
        capY: +capYAt(riseAt(live.t, live), live).toFixed(1),
        radiance: +flashRadiance(live.t, live.style).toFixed(3),
        bills: live.bills.length,
        pending: live.pending.length, ash: !!live.ash,
        shell: !!live.shell, dome: !!live.dome,
        volume: !!live.volume, volumeCounts: live.volN || null,
        groundRings: 0,
      } : null,
      flash: flash ? { t: +flash.t.toFixed(2), dur: flash.dur, peak: flash.peak, keys: flash.keys.length } : null,
      walks: walks.map(function (w) { return { kind: w.kind, i: w.i, n: w.pts.length }; }),
      pool: { bills: POOL.bills.length, built: !!POOL.shell },
      q: +q01().toFixed(2),
      flags: {
        v1: !!CBZ.CONFIG.NUKE_FX_V1, shell: !!CBZ.CONFIG.NUKE_FX_SHELL,
        ash: !!CBZ.CONFIG.NUKE_FX_ASH, moab: !!CBZ.CONFIG.NUKE_FX_MOAB,
        sky: !!CBZ.CONFIG.NUKE_FX_SKY, walk: !!CBZ.CONFIG.BOMB_WALK_V1,
        pulse: !!CBZ.CONFIG.NUKE_FX_PULSE, veil: !!CBZ.CONFIG.NUKE_FX_VEIL,
        rise: !!CBZ.CONFIG.NUKE_FX_RISE, roll: !!CBZ.CONFIG.NUKE_FX_ROLL,
        glass: !!CBZ.CONFIG.NUKE_FX_GLASS,
      },
    };
  };

  /* CBZ.nukeFxSize(kind, opts) — what the spectacle WOULD be, without firing it.
     The numeric twin of CBZ.impact.priceOf(), and the assertion surface for the
     bug this file shipped with. `nearField` is the row's radius*power (126 m
     nuke, 119.6 m MOAB pressure footprint); `fireball` is the actually drawn
     luminous radius (the same 126 m for the nuke, ~42 m for the chemical
     MOAB). `reach` is the bus's wave maxR after the same quality clamp. */
  CBZ.nukeFxSize = function (kind, opts) {
    opts = opts || {};
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    row = row || { power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
                   wave: kind === "moab" ? { speed: 140, maxR: 320 } : { speed: 190, maxR: 900 } };
    const eff = fireR(row, opts);
    const R = Math.max(5, eff * P.rFrac);
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const reach = (row.wave ? row.wave.maxR : eff * 4) * (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1) * sc;
    return {
      kind: kind, nearField: +eff.toFixed(1), fireball: +R.toFixed(1), R: +R.toFixed(1),
      capW: +(R * P.capK).toFixed(1), capY: +(R * P.riseK).toFixed(1),
      reach: +reach.toFixed(1),
      burnR: +(P.thermK > 0 ? reach * P.thermK : 0).toFixed(1),
      bills: Math.max(1, Math.min(P.bills, Math.round(CBZ.qScale ? CBZ.qScale(1, P.bills) : P.bills))),
      shell: !!(CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28),
      volumeDraws: P.volume ? 4 : 0,
      groundRings: 0,
      addLayers: (CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28 ? 1 : 0) + (P.volume ? 4 : 0),
    };
  };

  /* ============================================================
     CBZ.nukeFxAudit(kind, opts) — THE SEQUENCE AS NUMBERS.

     CLAUDE.md's closed loop is math over live game state, never a rendered
     frame, and "does the nuke look right" is exactly the kind of question that
     rots into a screenshot argument. So every claim this file's header makes is
     published here as a number a probe can assert on, WITHOUT firing anything:
     beat timings, three gameplay-zone radii, zero drawn ground rings, the real
     fireball radius and the two mushroom proportions that were wrong.

     THE ASSERTIONS THAT MATTER (all of them are booleans in `ok`, so a probe is
     one `Object.values(...).every(Boolean)`):

       zonesOrdered   flatten < burn < glass. The three effect zones a
                      city detonation creates must come out in that order and
                      never collapse together. This is the one that caught the
                      old glass ladder, which ran ENTIRELY inside the flattened
                      zone.
       noGroundRings  no RingGeometry or other outlined terrain layer survives.
       thermalOutranges  burn > flatten strictly. Y^0.41 vs Y^0.33 — if this
                      ever reads false the divergence has been tuned away and
                      the event has stopped being nuclear.
       dipPresent     the pulse curve genuinely goes below 0.2 between its two
                      maxima. A "double flash" whose minimum is 0.6 is not one.
       secondBrighter the second maximum is >= the first. This is the direction
                      the eye reads and the direction the spec describes.
       tallEnough     cloud top is at least 1.8x the cap width.
       thinStem       the cap is at least 6x the stem's width.

     `beats` is the header's beat table, machine-readable, in seconds. If you
     change a timing in the code, change it here — they are one screen apart on
     purpose. ============================================================ */
  CBZ.nukeFxAudit = function (kind, opts) {
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    const S = CBZ.nukeFxSize(kind, opts);
    const spd = (kind === "moab" ? 140 : 190);

    /* THE PULSE, resolved to absolute seconds on this style's fade.
       The minimum is the FIRST LOCAL minimum — the run of decreasing keys from
       the first maximum — never the global one, because the table legitimately
       ends at zero and a global search would happily report the end of the fade
       as the double flash's dip. */
    let dipI = 0;
    while (dipI + 1 < FLASH_DOUBLE.length && FLASH_DOUBLE[dipI + 1][1] <= FLASH_DOUBLE[dipI][1]) dipI++;
    const dipT = FLASH_DOUBLE[dipI][0], dipV = FLASH_DOUBLE[dipI][1];
    let pk2T = dipT, pk2V = dipV;
    for (let i = dipI + 1; i < FLASH_DOUBLE.length; i++) {
      if (FLASH_DOUBLE[i][1] > pk2V) { pk2V = FLASH_DOUBLE[i][1]; pk2T = FLASH_DOUBLE[i][0]; }
    }

    // the mushroom, at full rise and full bloom (bloomAt's ceiling)
    const bloomMax = 0.35 + 0.9 + 0.16;
    const capWide = S.capW * bloomMax;
    const cloudTop = S.capY + capWide * 0.66 * 0.5;
    const stemWide = S.R * P.stemK * 1.7;              // widened by the rise term

    const glassK = GLASS_K;
    const zones = {
      // ~5 psi: the classic destruction radius. The bus's wave maxR IS this
      // number; it is intentionally not drawn as a circle.
      flatten: S.reach,
      // ~thermal ignition. Strictly outside `flatten` or the event is not nuclear.
      burn: S.burnR,
      // ~1 psi: windows across a huge area, the biggest single injury source
      // and by construction the widest of the three.
      glass: +(S.reach * glassK[glassK.length - 1]).toFixed(1),
      fireball: S.fireball,
    };

    const beats = {
      whiteout: 0,
      firstMax: 0,
      // -1 for a style that does not flash twice (the MOAB): a chemical bomb
      // has no second thermal maximum, and reporting one would be a fiction.
      minimum: P.dbl ? +(dipT * P.white).toFixed(3) : -1,
      secondMax: P.dbl ? +(pk2T * P.white).toFixed(3) : -1,
      veilIn: P.dbl && CBZ.CONFIG.NUKE_FX_VEIL ? 0.06 : 0.28,
      veilOut: 1.9,
      volumeIn: 0.55,
      stemIn: 0.65, capIn: 0.55, surgeIn: 0.75, cap2In: 1.9, collarIn: 2.2,
      thermalIgnitionIn: 0.9,
      shellOut: 3.9,
      riseStart: 0.9, riseEnd: +(0.9 + P.riseT).toFixed(2),
      glassAt: glassK.map(function (k) { return +Math.max(0.3, S.reach * k / spd).toFixed(2); }),
      ashIn: P.ash ? 8 : -1,
      end: P.dur,
    };

    const proportions = {
      cloudTop: +cloudTop.toFixed(1),
      capWidth: +capWide.toFixed(1),
      stemWidth: +stemWide.toFixed(1),
      topOverCap: +(cloudTop / capWide).toFixed(2),
      capOverStem: +(capWide / stemWide).toFixed(2),
      burnOverFlatten: +(zones.burn / Math.max(1, zones.flatten)).toFixed(3),
    };

    return {
      // `rings` aliases numeric zones for older probes; it never means drawn
      // geometry. `layers.groundRings` is the visual contract.
      kind: kind, zones: zones, rings: zones, beats: beats, proportions: proportions,
      pulse: { min: dipV, secondMax: pk2V, keys: FLASH_DOUBLE.length },
      layers: {
        bills: S.bills, shell: S.shell,
        dome: !!(S.shell && P.dome && q01() > 0.45),
        volumeDraws: S.volumeDraws,
        groundRings: 0,
      },
      ok: {
        zonesOrdered: P.thermK === 0
          ? zones.flatten < zones.glass
          : (zones.flatten < zones.burn && zones.burn < zones.glass),
        // Old key retained for probe compatibility; it asserts zones.
        ringsOrdered: P.thermK === 0
          ? zones.flatten < zones.glass
          : (zones.flatten < zones.burn && zones.burn < zones.glass),
        noGroundRings: S.groundRings === 0,
        fullNuclearFireball: kind !== "nuke" ||
          (S.fireball === S.nearField && S.R === S.fireball),
        volumetricCloud: !P.volume || S.volumeDraws === 4,
        thermalOutranges: P.thermK === 0 || zones.burn > zones.flatten,
        dipPresent: !P.dbl || dipV < 0.2,
        secondBrighter: !P.dbl || pk2V >= FLASH_DOUBLE[0][1],
        /* THE TWO PROPORTION GATES, on style-appropriate thresholds. A chemical
           bomb's column is legitimately squatter and stubbier than a mushroom —
           holding the MOAB to the nuke's 2.19:1 and 9.8:1 would be asserting a
           fiction, and quietly exempting it would be worse. So the nuclear
           style is gated at 1.8 / 6.0 (it reads 2.19 / 8.15) and the chemical
           style at 1.5 / 4.5 (it reads 1.86 / 5.12). Neither has slack enough
           to absorb a careless riseK/capK/stemK edit unnoticed, which is the
           entire job of a gate. */
        tallEnough: proportions.topOverCap >= (P.thermK > 0 ? 1.8 : 1.5),
        thinStem: proportions.capOverStem >= (P.thermK > 0 ? 6 : 4.5),
        // the rise must DECELERATE: half the height inside the first quarter of
        // the window is the shape, and a smoothstep cannot produce it.
        riseDecelerates: !CBZ.CONFIG.NUKE_FX_RISE ||
          riseAt(0.9 + P.riseT * 0.25, { style: P }) > 0.5,
      },
    };
  };

  // ---- BUILD AT LOAD (the crashfx prewarm doctrine) ------------------------
  // Three canvas bakes, four shader programs and nine meshes, all minted here
  // rather than in the frame a warhead lands — core/fxwarm.js then compiles
  // the programs during the play-start transition, so the first nuke of a
  // session hits fully warm caches. The eager rng() draws happen in a FIXED
  // order at init, so every client advances the stream identically.
  try { buildPool(); } catch (e) { /* no THREE / no scene: the composers degrade to the near field */ }
  wire();
})();
