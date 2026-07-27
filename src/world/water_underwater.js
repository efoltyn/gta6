/* ============================================================
   src/world/water_underwater.js — BEING IN THE WATER, not on it.

   The engine had NO underwater state at all: camera.js has never known the
   player is swimming, and nothing anywhere changed when your eyes went below
   the surface. Combined with a sea you could only ever see from above, a
   swimming character read as someone standing inside a blue plane.

   This module is a read-only observer of the camera. Every frame it asks the
   ONE water oracle (CBZ.citySeaHeightAt / CBZ.cityWaterAt — the same functions
   the swimmer and the boats use, so the transition happens at the crest you
   can actually see) whether the eye is below the surface, and if so it dresses
   the whole experience. There is no post-processing stack in this engine (a
   forward WebGL1 r128 renderer, no depth pass), so every effect below is
   chosen to be affordable WITHOUT one:

   1. BEER-LAMBERT EXTINCTION, through THREE.Fog. Water does not "get darker",
      it eats the spectrum from the red end first — that colour shift is what
      the eye reads as depth. The fog colour is now
      `surfaceLight * exp(-EXT * depth * density)` with
      EXT = (0.45, 0.09, 0.045) per metre, so red is gone by ~3m, green
      survives to ~15m and blue carries the last of the light. `density` is the
      murk knob: an inland lake (CBZ.waterInlandFactorAt) is greener and 2x
      murkier than the open sea, and shallow water over a bright bed
      (CBZ.cityWaterDepthAt) stays clearer than the deep.
      WHY LINEAR THREE.Fog AND NOT THREE.FogExp2: exponential falloff would be
      the better curve, but the save/restore machinery below is expressed in
      near/far — core/quality.js's tier change and city/mode.js's per-frame
      `scene.fog.near/far` write are BOTH adopted through those two fields
      while we are submerged, and that adoption is what makes surfacing restore
      the CURRENT view distance instead of a stale one. Swapping to FogExp2
      would silently break both. We get the exponential *colour* (which is the
      part you see) and keep the linear *range* (which is the part the rest of
      the engine talks to us in).

   2. CAUSTICS on the underside of the surface. The industry-standard cheap
      fake: one tileable caustic texture sampled TWICE at different scale,
      rotation and drift speed and multiplied, which turns a periodic pattern
      into a non-repeating one. It is applied as a single additive
      camera-following plane 6cm under the waterline — i.e. the dancing light
      you actually see on the ceiling of the water when you look up, which
      complements the Snell's-window underside branch world/waterfx.js already
      renders. TRADE-OFF, stated plainly: real caustics also land on the
      SEABED, and we do not draw one — the deep sea has no floor geometry to
      receive them, so seabed caustics are deferred rather than faked badly.

   3. GOD RAYS as billboarded shafts. True volumetrics are far out of budget.
      Seven additive soft-edged quads hang from the surface at world positions
      and torus-wrap around the swimmer, so they have real PARALLAX (the CSS
      ray gradient this file used to fake never could). They fade with depth,
      with daylight, and vanish entirely below ~22m.

   4. THE WATERLINE. A true per-pixel half-in-half-out split needs a depth
      pass. The affordable version: project a point on the live surface a few
      metres ahead through the live camera, read its NDC y, and place the tint
      and a thin bright meniscus band at exactly that screen row. Straddling
      the surface therefore gives you a clear top half, a bright band, and the
      murk below — and when you are fully under, the line projects off-screen
      and the tint covers everything with no special case.

   5. AUDIO. systems/audio.js has no global lowpass bus and we may not edit it
      — but it already builds a far-field muffle bus (820Hz lowpass + slap
      delay) for any sfx call whose `opts.dist` exceeds 60. So we WRAP CBZ.sfx
      and, while the head is under, hand every diegetic sound a distance past
      that trip point plus a volume trim. That is a genuine lowpass over the
      whole mix with zero new audio infrastructure — reusing a shared
      capability instead of adding a parallel one.

   6. THE CAMERA. Registered at order 50.5, i.e. AFTER systems/camera.js's one
      and only writer (onAlways(50)), so we always see its final result and can
      never be clobbered mid-frame. Water refracts, which magnifies: the lens
      pinches a few degrees under, and a slow sway drifts the eye. The FOV
      write YIELDS to the scope precedence rule (fpsScopeFov > cityScopeFov >
      everything) — a scope-blind FOV writer is exactly what re-creates the
      known "fake scope" bug.

   7. BREATH. city/swim.js owns the air model and publishes it through
      CBZ.citySwimState(). All the HUD does here is an inline-styled edge
      vignette that reddens and pulses faster as the tank empties — no
      floating card, no toast, per the HUD doctrine (the killfeed owns the one
      sanctioned popup). A proper slim breath meter belongs next to the
      stamina sliver in city/hud.js, which this file does not own.

   WHY A DOM OVERLAY AND NOT A SCREEN QUAD: a mesh parented to the camera would
   also be rendered into the planar-mirror target and every CCTV feed. A fixed
   div over the canvas costs nothing, cannot leak into another render pass, and
   composites in exactly the right place. The in-WORLD meshes above sit on
   render layer 2 for the same reason — the mirror and CCTV cameras keep the
   default layer mask, so they never see the caustics or the shafts.

   FOG RESTORATION: the original THREE.Fog object is swapped back out on
   surfacing, so core/quality.js's per-tier fog range and core/daynight.js's
   per-frame fog colour keep owning the above-water look. If a quality change
   lands WHILE submerged, quality.js writes the new range onto our stand-in
   fog; we notice the foreign write (it never matches what we last wrote) and
   adopt it, so surfacing restores the CURRENT tier's range, not a stale one.

   FLAGS (declared here, all default ON, each a one-line revert):
     WATER_UNDERWATER — the whole submerged state (declared in water_spec.js).
     WATER_CAUSTICS   — the caustic ceiling plane.
     WATER_GODRAYS    — the in-world shafts (OFF falls back to the old CSS rays).
     WATER_MUFFLE     — the CBZ.sfx muffle wrap.
     WATER_CAM_UW     — the underwater lens pinch + sway.
     WATER_BREATH_HUD — the low-air vignette.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_UNDERWATER == null) CFG.WATER_UNDERWATER = true;
  // WATER_CAUSTICS — the additive caustic ceiling under the surface.
  // Flip false (or ?cfg_WATER_CAUSTICS=0) and no caustic mesh is ever built.
  if (CFG.WATER_CAUSTICS == null) CFG.WATER_CAUSTICS = true;
  // WATER_GODRAYS — in-world light shafts with real parallax.
  // OFF (?cfg_WATER_GODRAYS=0) → the previous CSS drifting-ray gradient.
  if (CFG.WATER_GODRAYS == null) CFG.WATER_GODRAYS = true;
  // WATER_MUFFLE — route every diegetic sfx through audio.js's existing
  // far-field 820Hz lowpass bus while the head is under.
  // OFF (?cfg_WATER_MUFFLE=0) → sound is dry and unchanged underwater.
  if (CFG.WATER_MUFFLE == null) CFG.WATER_MUFFLE = true;
  // WATER_CAM_UW — refraction lens pinch + slow eye sway while submerged.
  // OFF (?cfg_WATER_CAM_UW=0) → camera.js's result is left completely alone.
  if (CFG.WATER_CAM_UW == null) CFG.WATER_CAM_UW = true;
  // WATER_BREATH_HUD — the low-air edge vignette (reads city/swim.js's meter).
  // OFF (?cfg_WATER_BREATH_HUD=0) → no visual air warning at all.
  if (CFG.WATER_BREATH_HUD == null) CFG.WATER_BREATH_HUD = true;

  function off() {
    return CFG.WATER_UNDERWATER === false || CFG.WATER_V2 === false;
  }

  // Depth (metres below the surface) at which the world is essentially black.
  const BLACKOUT = 26;
  // Fog range at the surface and at BLACKOUT. Linear THREE.Fog, so this is
  // literally "how far can you see".
  const FOG_FAR_NEAR_SURFACE = 46, FOG_FAR_DEEP = 9;
  // Beer-Lambert extinction per metre, R/G/B. Red dies first — this ratio is
  // what makes 4m of water look like water instead of blue tinted glass.
  const EXT_R = 0.45, EXT_G = 0.09, EXT_B = 0.045;
  // The light entering the surface, before any water eats it. Multiplied by
  // the live day factor so a night dive really is black.
  const SURFACE_LIGHT = { r: 0.62, g: 0.86, b: 0.95 };
  const LAKE_LIGHT = { r: 0.50, g: 0.80, b: 0.62 };   // greener, for inland bodies
  const MURK_LAKE = 2.15;      // an inland body is this much murkier than open sea

  const _fogC = new THREE.Color();
  const _eye = new THREE.Vector3();
  const _probe = new THREE.Vector3();

  let overlay = null, rays = null, meniscus = null, breathEl = null;
  let myFog = null, savedFog = null;
  let lastNear = -1, lastFar = -1;      // what WE last wrote (foreign-write probe)
  let savedNear = 0, savedFar = 0;
  let submerged = false, shown = 0;
  let muffle = 0;                        // 0..1 eased muffle amount
  let lastBg = "", lastLine = -99;
  let breathPulse = 0;

  // ============================================================
  //  DOM
  // ============================================================
  function ensureDom() {
    if (overlay || typeof document === "undefined" || !document.body) return;
    overlay = document.createElement("div");
    overlay.id = "cbzUnderwater";
    // z-index 12 sits over the canvas but under the HUD chrome (14+), so the
    // map, ammo and killfeed stay legible while you are under.
    overlay.style.cssText = [
      "position:fixed", "inset:0", "pointer-events:none", "z-index:12",
      "opacity:0", "display:none", "transition:opacity .22s linear",
      "will-change:opacity", "mix-blend-mode:normal",
    ].join(";");

    // The CSS ray gradient is now only the FALLBACK for WATER_GODRAYS=0 — the
    // real shafts below have parallax, which a screen-space gradient cannot.
    if (CFG.WATER_GODRAYS === false) {
      rays = document.createElement("div");
      rays.style.cssText = [
        "position:absolute", "inset:-20% -30%", "pointer-events:none",
        "opacity:.30", "transform-origin:50% 0%",
        "background:repeating-linear-gradient(101deg, rgba(190,240,250,0.00) 0px, rgba(190,240,250,0.10) 26px, rgba(190,240,250,0.00) 74px, rgba(190,240,250,0.00) 150px)",
        "animation:cbzUwDrift 17s linear infinite",
        "filter:blur(3px)",
      ].join(";");
      overlay.appendChild(rays);
    }

    // The waterline meniscus: a thin bright band placed at the projected
    // screen row of the real surface. Only visible while the eye straddles it.
    meniscus = document.createElement("div");
    meniscus.style.cssText = [
      "position:absolute", "left:-2%", "right:-2%", "height:26px",
      "pointer-events:none", "opacity:0", "transform:translateY(-50%)",
      "background:linear-gradient(to bottom, rgba(210,245,255,0.00) 0%, rgba(215,248,255,0.42) 42%, rgba(160,225,240,0.30) 58%, rgba(60,140,170,0.00) 100%)",
      "filter:blur(2px)",
    ].join(";");
    overlay.appendChild(meniscus);

    // The keyframes live here rather than in a stylesheet so this file stays a
    // single self-contained drop-in (nothing else owns css/ for water).
    if (!document.getElementById("cbzUnderwaterCss")) {
      const st = document.createElement("style");
      st.id = "cbzUnderwaterCss";
      st.textContent =
        "@keyframes cbzUwDrift{0%{transform:translate3d(-4%,0,0) rotate(-1.2deg);}" +
        "50%{transform:translate3d(4%,0,0) rotate(1.2deg);}" +
        "100%{transform:translate3d(-4%,0,0) rotate(-1.2deg);}}";
      document.head.appendChild(st);
    }
    document.body.appendChild(overlay);

    // Low-air warning. Its OWN element (the city/death.js #hitfx pattern:
    // fixed, inset 0, pointer-events none, driven purely by inline styles) and
    // deliberately NOT a card or a toast — the HUD doctrine reserves popups
    // for the killfeed.
    breathEl = document.createElement("div");
    breathEl.id = "cbzBreathWarn";
    breathEl.style.cssText = [
      "position:fixed", "inset:0", "pointer-events:none", "z-index:13",
      "opacity:0", "will-change:opacity",
    ].join(";");
    document.body.appendChild(breathEl);
  }

  // ============================================================
  //  TEXTURES (deterministic — fixed arithmetic, never Math.random)
  // ============================================================
  let causticTex = null;
  function causticTexture() {
    // Prefer the shared one if a neighbour published it; never hard-depend.
    if (CBZ.waterCausticTexture) {
      try {
        const t = CBZ.waterCausticTexture();
        if (t) return t;
      } catch (e) {}
    }
    if (causticTex) return causticTex;
    // A tileable caustic field: the classic "distance to the nearest cell
    // centre of a warped periodic lattice", which produces the bright
    // interlocking web sunlight makes on a pool floor. Integer frequencies
    // keep every edge seamless under RepeatWrapping.
    const N = 128;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      const v = (y / N) * Math.PI * 2;
      for (let x = 0; x < N; x++) {
        const u = (x / N) * Math.PI * 2;
        // three warped standing waves; the abs() ridges are the caustic lines
        const a = Math.sin(u + Math.sin(v * 2.0) * 0.9);
        const b = Math.sin(v + Math.sin(u * 3.0) * 0.7);
        const c = Math.sin((u + v) * 1.5 + Math.sin(u - v) * 0.8);
        let n = 1 - Math.min(1, (Math.abs(a) + Math.abs(b) + Math.abs(c)) * 0.42);
        n = n * n * n;                       // sharpen into thin bright veins
        const q = (y * N + x) * 4;
        const p = Math.round(Math.max(0, Math.min(1, n)) * 255);
        data[q] = p; data[q + 1] = p; data[q + 2] = p; data[q + 3] = 255;
      }
    }
    causticTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
    causticTex.magFilter = THREE.LinearFilter;
    causticTex.minFilter = THREE.LinearMipmapLinearFilter;
    causticTex.generateMipmaps = true;
    causticTex.name = "cbz-uw-caustic";
    causticTex.needsUpdate = true;
    return causticTex;
  }

  let shaftTex = null;
  function shaftTexture() {
    if (shaftTex) return shaftTex;
    // A soft-edged vertical shaft: bright at the top (the surface), gone at
    // the bottom, feathered on both sides so the quad has no visible border.
    const W = 32, H = 128;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g2 = c.getContext("2d");
    const img = g2.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);
      const vert = Math.pow(1 - t, 1.6);            // fade downward
      for (let x = 0; x < W; x++) {
        const s = (x + 0.5) / W;
        const horiz = Math.pow(Math.sin(s * Math.PI), 2.2);   // feathered sides
        const p = Math.round(Math.max(0, Math.min(1, vert * horiz)) * 255);
        const q = (y * W + x) * 4;
        img.data[q] = 255; img.data[q + 1] = 255; img.data[q + 2] = 255; img.data[q + 3] = p;
      }
    }
    g2.putImageData(img, 0, 0);
    shaftTex = new THREE.CanvasTexture(c);
    shaftTex.wrapS = shaftTex.wrapT = THREE.ClampToEdgeWrapping;
    shaftTex.name = "cbz-uw-shaft";
    shaftTex.needsUpdate = true;
    return shaftTex;
  }

  // ============================================================
  //  IN-WORLD FX (built lazily on the first dive)
  // ============================================================
  // simulation.js owns render layer 1 (its exclusive overview mask). Layer 2
  // is ours: the planar mirror and every CCTV camera keep the default mask, so
  // none of this can leak into another render pass.
  const FX_LAYER = 2;
  const SHAFTS = 7;
  const SHAFT_R = 34;        // torus-wrap radius around the swimmer
  const SHAFT_H = 22;

  let fxRoot = null, ceiling = null, ceilU = null, shafts = null, shaftMat = null;

  function buildFx() {
    if (fxRoot || typeof document === "undefined") return;
    fxRoot = new THREE.Group();
    fxRoot.name = "cbz-underwater-fx";
    fxRoot.userData.dynamic = true;      // batch.js + farcull.js must never touch it
    fxRoot.userData.uwFx = true;
    fxRoot.visible = false;
    fxRoot.matrixAutoUpdate = true;

    if (CFG.WATER_CAUSTICS !== false) {
      // The caustic ceiling: one additive plane 6cm under the waterline,
      // following the camera. Two texture lookups at different scale, drift
      // and rotation, MULTIPLIED — the standard trick that turns a tiling
      // pattern into something that never visibly repeats.
      const geo = new THREE.PlaneGeometry(190, 190, 1, 1);
      geo.rotateX(-Math.PI / 2);
      ceilU = {
        uTex: { value: causticTexture() },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(0xbdf0ff) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: ceilU,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        vertexShader: [
          "varying vec2 vUv;",
          "void main() {",
          "  vUv = uv;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "}",
        ].join("\n"),
        fragmentShader: [
          "uniform sampler2D uTex;",
          "uniform float uTime;",
          "uniform float uStrength;",
          "uniform vec3 uColor;",
          "varying vec2 vUv;",
          "void main() {",
          "  if (uStrength <= 0.001) discard;",
          "  vec2 p = vUv * 30.0;",
          "  float a = texture2D(uTex, p + vec2(uTime * 0.021, uTime * 0.014)).r;",
          // second lookup: different scale, opposite drift, rotated 37 degrees
          "  mat2 rot = mat2(0.7986, -0.6018, 0.6018, 0.7986);",
          "  vec2 q = rot * (vUv * 21.0) + vec2(uTime * -0.013, uTime * 0.019);",
          "  float b = texture2D(uTex, q).r;",
          "  float c = pow(a * b, 0.85);",
          // radial falloff so the plane's rim is never a visible edge
          "  float r = length(vUv - 0.5) * 2.0;",
          "  float edge = 1.0 - smoothstep(0.35, 0.98, r);",
          "  float v = c * edge * uStrength;",
          // The plane is 190m across but `edge` has already killed everything
          // past ~35% of the half-width, so most of that area blends pure
          // zero. Discard it: on a tier-0 machine looking up is otherwise a
          // full-screen additive pass with two texture fetches per pixel.
          "  if (v < 0.004) discard;",
          "  gl_FragColor = vec4(uColor * v, v);",
          "}",
        ].join("\n"),
      });
      mat.name = "cbz-uw-ceiling";      // NEVER "water"/"ocean"/"sea": the
      // terrain-water gate asserts exactly one water-surface mesh and matches
      // on material name.
      ceiling = new THREE.Mesh(geo, mat);
      ceiling.name = "cbz-uw-ceiling";
      ceiling.frustumCulled = false;
      ceiling.renderOrder = 6;
      ceiling.userData.uwFx = true;     // non-empty userData = batch/farcull exempt
      // 190x190 with zero height puts this squarely in tools/test-terrain-
      // water-browser.mjs's audited surface set (area > 2800 && h < 0.75) any
      // time the probe happens to run while submerged. `underlay` is the
      // exemption that audit already honours for surfaces that deliberately
      // sit under another one — which is literally what this is.
      ceiling.userData.underlay = true;
      ceiling.layers.set(FX_LAYER);
      fxRoot.add(ceiling);
    }

    if (CFG.WATER_GODRAYS !== false) {
      shaftMat = new THREE.MeshBasicMaterial({
        map: shaftTexture(),
        color: 0xcdf2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      shaftMat.name = "cbz-uw-shaft";
      shafts = [];
      const geo = new THREE.PlaneGeometry(3.2, SHAFT_H, 1, 1);
      for (let i = 0; i < SHAFTS; i++) {
        const m = new THREE.Mesh(geo, shaftMat);
        m.name = "cbz-uw-shaft" + i;
        m.frustumCulled = false;
        m.renderOrder = 7;
        m.userData.uwFx = true;
        m.layers.set(FX_LAYER);
        // Golden-angle spiral: an even, deterministic spread with no rng.
        // ox/oz is the seed offset from the swimmer; wx/wz is the WORLD spot
        // the shaft then holds on to (that is what gives it parallax).
        const a = i * 2.39996, rr = 5 + (i / SHAFTS) * (SHAFT_R - 8);
        m.userData.ox = Math.cos(a) * rr;
        m.userData.oz = Math.sin(a) * rr;
        m.userData.wx = m.userData.ox;
        m.userData.wz = m.userData.oz;
        m.scale.x = 0.7 + (i % 3) * 0.35;
        shafts.push(m);
        fxRoot.add(m);
      }
    }

    if (CBZ.scene) CBZ.scene.add(fxRoot);
  }

  // World positions with a torus wrap around the swimmer: the shafts stay put
  // while you move (real parallax) and silently recycle once they fall behind.
  function driveFx(camX, camZ, surfY, depth, day, tint) {
    if (!fxRoot) return;
    const t = CBZ.waterClock ? CBZ.waterClock() : (performance.now() * 0.001);
    if (ceiling && ceilU) {
      ceiling.position.set(camX, surfY - 0.06, camZ);
      ceilU.uTime.value = t;
      // Caustics come from sunlight refracting THROUGH the surface, so they
      // die with depth and with the day. Strongest in the first few metres.
      const dfade = Math.max(0, 1 - depth / 16);
      ceilU.uStrength.value = 0.85 * dfade * dfade * day;
      ceilU.uColor.value.setRGB(
        Math.min(1, 0.55 + tint.r * 0.9),
        Math.min(1, 0.80 + tint.g * 0.5),
        Math.min(1, 0.92 + tint.b * 0.3));
    }
    if (shafts && shaftMat) {
      const gfade = Math.max(0, 1 - depth / 22);
      shaftMat.opacity = 0.30 * gfade * gfade * day;
      const vis = shaftMat.opacity > 0.004;
      for (let i = 0; i < shafts.length; i++) {
        const m = shafts[i];
        let dx = m.userData.wx - camX, dz = m.userData.wz - camZ;
        // First dive (or a teleport across the map): re-seed rather than
        // wrapping a few dozen metres per frame for the next ten seconds.
        if (Math.abs(dx) > SHAFT_R * 3 || Math.abs(dz) > SHAFT_R * 3) {
          m.userData.wx = camX + m.userData.ox; m.userData.wz = camZ + m.userData.oz;
          dx = m.userData.ox; dz = m.userData.oz;
        }
        // torus wrap: keep every shaft inside SHAFT_R of the swimmer
        if (dx > SHAFT_R) { m.userData.wx -= SHAFT_R * 2; dx -= SHAFT_R * 2; }
        else if (dx < -SHAFT_R) { m.userData.wx += SHAFT_R * 2; dx += SHAFT_R * 2; }
        if (dz > SHAFT_R) { m.userData.wz -= SHAFT_R * 2; dz -= SHAFT_R * 2; }
        else if (dz < -SHAFT_R) { m.userData.wz += SHAFT_R * 2; dz += SHAFT_R * 2; }
        const d = Math.hypot(dx, dz);
        m.visible = vis && d > 3.5;
        if (!m.visible) continue;
        m.position.set(m.userData.wx, surfY - SHAFT_H * 0.5 + 0.4, m.userData.wz);
        // yaw to face the eye (billboard about Y only — a shaft leans, it
        // never rolls) plus a slow lean so the column is not a dead vertical.
        m.rotation.y = Math.atan2(-dx, -dz);
        m.rotation.z = Math.sin(t * 0.11 + i) * 0.06;
      }
    }
  }

  function hideFx() {
    if (fxRoot) fxRoot.visible = false;
  }

  // ============================================================
  //  FOG
  // ============================================================
  function enterFog(scene) {
    if (myFog || !scene || !scene.fog) return;
    savedFog = scene.fog;
    savedNear = savedFog.near; savedFar = savedFog.far;
    myFog = new THREE.Fog(savedFog.color.getHex(), 0.6, FOG_FAR_NEAR_SURFACE);
    lastNear = myFog.near; lastFar = myFog.far;
    scene.fog = myFog;
  }

  function exitFog(scene) {
    if (!myFog || !scene) return;
    if (scene.fog === myFog) scene.fog = savedFog;
    savedFog.near = savedNear;
    savedFog.far = savedFar;
    myFog = null; savedFog = null;
    lastNear = lastFar = -1;
  }

  // How deep is the camera below the live water surface? <= 0 means above it.
  function eyeDepth() {
    const cam = CBZ.camera;
    if (!cam) return -1;
    cam.getWorldPosition(_eye);
    if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(_eye.x, _eye.z)) return -1;
    const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(_eye.x, _eye.z)
      : (CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48));
    return surf - _eye.y;
  }

  // Beer-Lambert: what is left of the surface light after `d` metres of water
  // at this murk. Writes into `out` (r,g,b in 0..1) — allocation-free.
  const _tint = { r: 0, g: 0, b: 0 };
  function extinction(d, density, inland, day, out) {
    const base = inland > 0.5 ? LAKE_LIGHT : SURFACE_LIGHT;
    const k = d * density;
    out.r = base.r * Math.exp(-EXT_R * k) * day;
    out.g = base.g * Math.exp(-EXT_G * k) * day;
    out.b = base.b * Math.exp(-EXT_B * k) * day;
    if (inland > 0) {   // an inland body pulls green even before the extinction
      out.g += (LAKE_LIGHT.g - out.g) * inland * 0.25;
      out.b -= out.b * inland * 0.18;
    }
    return out;
  }

  function rgb(t, a) {
    return "rgba(" + Math.round(Math.max(0, Math.min(1, t.r)) * 255) + "," +
      Math.round(Math.max(0, Math.min(1, t.g)) * 255) + "," +
      Math.round(Math.max(0, Math.min(1, t.b)) * 255) + "," + a + ")";
  }

  // The screen row (0..100 %) of the real waterline, by PROJECTING a point on
  // the live surface a few metres ahead through the live camera. Returns <0
  // when the line is above the viewport (i.e. you are fully under).
  function waterlineRow(surfY) {
    const cam = CBZ.camera;
    if (!cam) return -1;
    // 5m ahead along the camera's own forward vector, snapped to the surface.
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    const fl = Math.hypot(fx, fz) || 1;
    _probe.set(_eye.x + (fx / fl) * 5, surfY, _eye.z + (fz / fl) * 5);
    _probe.project(cam);
    if (!Number.isFinite(_probe.y)) return -1;
    return (1 - _probe.y) * 50;      // NDC +1 (top) -> 0%, -1 (bottom) -> 100%
  }

  // ============================================================
  //  MAIN PASS
  // ============================================================
  // Order 99.6: after core/daynight.js (2) has set the fog colour, after
  // systems/weather.js (90/91) has tinted it, after city/world.js's sea tick
  // (93), city/mode.js's per-frame fog range write (94) and core/sky.js (99)
  // have read it — so nothing overwrites us in the same frame. onAlways,
  // because the water keeps existing while paused.
  CBZ.onAlways(99.6, function (dt) {
    wrapSfx();                        // lazy-retry until audio.js has published
    const scene = CBZ.scene;
    if (!scene) return;
    const g = CBZ.game;
    const gone = off() || !g || g.mode !== "city";

    const depth = gone ? -1 : eyeDepth();
    // A little hysteresis so a crest rolling past the eye cannot strobe the
    // whole treatment on and off frame by frame.
    const want = submerged ? depth > 0.0 : depth > 0.06;

    if (want && !submerged) {
      submerged = true;
      ensureDom();
      buildFx();
      enterFog(scene);
      if (fxRoot) fxRoot.visible = true;
      if (CBZ.waterSplashAt) CBZ.waterSplashAt(_eye.x, _eye.y, _eye.z, 1.0);
    } else if (!want && submerged) {
      submerged = false;
      exitFog(scene);
      hideFx();
    }

    // Fade the tint in/out rather than snapping; ~0.22s each way.
    const target = submerged ? 1 : 0;
    const step = Math.min(1, (dt || 0.016) * 5.5);
    shown += (target - shown) * step;
    if (shown < 0.002) shown = 0;
    // The audio muffle rides its own slightly slower ramp (~0.28s), so the
    // world does not go dull the instant a wave laps your ear.
    muffle += (target - muffle) * Math.min(1, (dt || 0.016) * 3.6);
    if (muffle < 0.004) muffle = 0;

    breathVignette(dt);
    // Nothing below costs anything unless the treatment is on screen. `_eye`
    // is only current when eyeDepth() ran this frame, so never read it here
    // on a frame we skipped.
    if (!submerged && shown <= 0.002) {
      if (overlay && overlay.style.display !== "none") overlay.style.display = "none";
      return;
    }

    const d01 = Math.max(0, Math.min(1, depth / BLACKOUT));
    const day = CBZ.dayness != null ? (0.16 + 0.84 * CBZ.dayness) : 1;
    const inland = CBZ.waterInlandFactorAt ? CBZ.waterInlandFactorAt(_eye.x, _eye.z) : 0;
    // MURK: a lake is siltier than the open sea, and shallow coastal water
    // (where the bed is close) carries more suspended sand than the deep.
    const bed = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(_eye.x, _eye.z) : 24;
    const shallowMurk = 1 + Math.max(0, 1 - bed / 12) * 0.55;
    const density = shallowMurk * (1 + (MURK_LAKE - 1) * inland);
    extinction(Math.max(0, depth), density, inland, day, _tint);

    if (overlay) {
      const vis = submerged || shown > 0.002;
      if (overlay.style.display !== (vis ? "block" : "none")) overlay.style.display = vis ? "block" : "none";
      if (vis) {
        overlay.style.opacity = String((0.55 + d01 * 0.42) * shown);
        if (rays) rays.style.opacity = String(Math.max(0, 0.34 - d01 * 0.34) * shown);
        paintOverlay(depth, d01);
      }
    }

    if (!submerged || !myFog) return;

    if (fxRoot) {
      fxRoot.visible = true;
      const surf = _eye.y + depth;
      driveFx(_eye.x, _eye.z, surf, Math.max(0, depth), day, _tint);
    }

    // Adopt a foreign write (core/quality.js changing tier mid-dive, or
    // city/mode.js's per-frame range write at order 94) so surfacing restores
    // the CURRENT range instead of the pre-dive one.
    if (lastNear >= 0 && (myFog.near !== lastNear || myFog.far !== lastFar)) {
      savedNear = myFog.near; savedFar = myFog.far;
    }

    // Quality tiers scale the whole world's view distance; scale ours with it
    // so a Fastest-tier machine is not paying for 46 metres of fogged water.
    const q = CBZ.qScale ? CBZ.qScale(0.62, 1.0) : 1;
    _fogC.setRGB(_tint.r, _tint.g, _tint.b);
    myFog.color.copy(_fogC);
    myFog.near = 0.4;
    myFog.far = (FOG_FAR_NEAR_SURFACE + (FOG_FAR_DEEP - FOG_FAR_NEAR_SURFACE) * d01) * q / density;
    lastNear = myFog.near; lastFar = myFog.far;
  });

  // The tint gradient is rebuilt from the live extinction colour, and CLIPPED
  // at the projected waterline so straddling the surface reads as half in,
  // half out. Both writes are change-gated: a CSS background string is not
  // something to hand the style engine 60 times a second for no reason.
  const _c1 = { r: 0, g: 0, b: 0 }, _c2 = { r: 0, g: 0, b: 0 }, _c3 = { r: 0, g: 0, b: 0 };
  function paintOverlay(depth, d01) {
    const surfY = _eye.y + depth;
    // The projected waterline is only trustworthy while the eye is genuinely
    // AT the surface. Deeper (or looking straight down, where the probe falls
    // behind the camera and the projection flips) the line is off-screen by
    // definition, so the tint simply covers everything.
    let row = 0;
    if (depth > 0 && depth < 1.2) {
      const r = waterlineRow(surfY);
      if (r > 0 && r < 100 && _probe.z < 1) row = r;
    }
    _c1.r = _tint.r * 1.5 + 0.18; _c1.g = _tint.g * 1.25 + 0.16; _c1.b = _tint.b * 1.2 + 0.16;
    _c2.r = _tint.r * 0.7; _c2.g = _tint.g * 0.75; _c2.b = _tint.b * 0.85;
    _c3.r = _tint.r * 0.22; _c3.g = _tint.g * 0.26; _c3.b = _tint.b * 0.42;
    const bright = rgb(_c1, 0.30);
    const mid = rgb(_c2, 0.44);
    const deep = rgb(_c3, 0.82);
    const top = row.toFixed(1);
    const bg = "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) " + top + "%, " +
      bright + " " + top + "%, " + mid + " " + (100 - (100 - +top) * 0.45).toFixed(1) + "%, " + deep + " 100%)";
    if (bg !== lastBg) { lastBg = bg; overlay.style.background = bg; }
    if (meniscus) {
      // Only while the eye is genuinely AT the surface — a straddle, not a dive.
      const near = Math.max(0, 1 - Math.abs(depth) / 0.30);
      const op = near * shown;
      if (Math.abs(row - lastLine) > 0.4) { lastLine = row; meniscus.style.top = top + "%"; }
      meniscus.style.opacity = String(op * 0.9);
    }
  }

  // ---- low-air warning -----------------------------------------------------
  // Reads city/swim.js's meter through the published seam. No card, no toast:
  // an edge vignette that reddens and pulses faster as the tank empties.
  function breathVignette(dt) {
    if (CFG.WATER_BREATH_HUD === false || !CBZ.citySwimState) {
      if (breathEl) breathEl.style.opacity = "0";
      return;
    }
    const st = CBZ.citySwimState();
    const b = st && Number.isFinite(st.breath) ? st.breath : 1;
    const under = !!(st && (st.headUnder || submerged));
    if (!under || b > 0.30) {
      if (breathEl && breathEl.style.opacity !== "0") breathEl.style.opacity = "0";
      breathPulse = 0;
      return;
    }
    // The head can go under without the (third-person) camera following it, so
    // build the DOM on demand rather than only on the first submerged frame.
    if (!breathEl) ensureDom();
    if (!breathEl) return;
    const urgency = Math.max(0, Math.min(1, (0.30 - b) / 0.30));   // 0..1
    breathPulse += (dt || 0.016) * (2.2 + urgency * 4.4);          // 0.35Hz -> 1Hz
    const pulse = 0.5 + 0.5 * Math.sin(breathPulse * Math.PI * 2);
    // red bleeds in as it empties; at zero it is a hard, fast red throb
    const r = Math.round(120 + 135 * urgency);
    const gg = Math.round(190 - 170 * urgency);
    const bb = Math.round(220 - 170 * urgency);
    breathEl.style.background =
      "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 38%, rgba(" +
      r + "," + gg + "," + bb + ",0.42) 82%, rgba(" + r + "," + Math.round(gg * 0.5) + "," + Math.round(bb * 0.5) + ",0.66) 100%)";
    breathEl.style.opacity = String((0.22 + 0.62 * urgency) * (0.45 + 0.55 * pulse));
  }

  // ============================================================
  //  CAMERA — order 50.5, strictly AFTER systems/camera.js (50)
  // ============================================================
  // camera.js writes the final position and FOV inside ONE function at
  // onAlways(50) and there is no later writer, so hooking just past it means
  // we always see its finished result and can never be clobbered mid-frame.
  let camFov = 0, sway = 0;
  CBZ.onAlways(50.5, function (dt) {
    const cam = CBZ.camera;
    if (!cam) return;
    // Our in-world FX live on layer 2. simulation.js's overview takes the
    // camera's mask exclusively (layers.set(1)); only re-enable ours while the
    // camera is in its normal mask, so we never break that.
    if (fxRoot && (cam.layers.mask & 1)) cam.layers.enable(FX_LAYER);

    if (CFG.WATER_CAM_UW === false || off()) { camFov = 0; return; }
    const k = shown;                       // the same 0.22s ease as the tint
    if (k <= 0.002) { camFov = 0; return; }

    // A scoped optic OWNS the lens. Precedence (identical to camera.js's own
    // tail and fpsmode.js's FP block): a fitted gunsmith optic > the lockon
    // scope > everything else. Writing FOV without this check is precisely
    // what re-creates the "fake scope" bug, so we simply stand down.
    const scoped = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || (CBZ.cityScopeFov && CBZ.cityScopeFov());
    if (!scoped) {
      // Seed from camera.js's live lens the first frame under, or the ease
      // would run up from 0 and briefly show a telescope.
      if (camFov <= 1) camFov = cam.fov;
      // Water's refractive index magnifies ~1.33x, which reads as a narrower
      // lens. A few degrees is plenty; more feels like a zoom.
      const want = cam.fov - 5.5 * k;
      camFov += (want - camFov) * Math.min(1, (dt || 0.016) * 6);
      if (camFov > 1 && Math.abs(cam.fov - camFov) > 0.01) {
        cam.fov = camFov;
        cam.updateProjectionMatrix();
      }
    } else camFov = cam.fov;

    // A slow neutral-buoyancy drift. Sub-centimetre-to-centimetre offsets, so
    // it can never push the eye through the collision solve camera.js just did.
    sway += (dt || 0.016);
    cam.position.x += Math.sin(sway * 0.53) * 0.035 * k;
    cam.position.y += Math.sin(sway * 0.79 + 1.1) * 0.045 * k;
    cam.position.z += Math.cos(sway * 0.61 + 2.3) * 0.035 * k;
  });

  // ============================================================
  //  AUDIO MUFFLE — reuse audio.js's existing far-field bus
  // ============================================================
  // systems/audio.js:738 routes any sfx whose opts.dist exceeds FAR_DIST (60)
  // through ensureFarBus(): an 820Hz lowpass + slap delay. That IS a muffle
  // bus; it just happens to be addressed by distance. So while the head is
  // under we hand every diegetic call a distance past the trip point and trim
  // the volume — a genuine lowpass over the whole mix, zero new audio code,
  // zero edits to a file we do not own.
  const FAR_TRIP = 61;
  let sfxWrapped = false;
  function wrapSfx() {
    if (sfxWrapped) return;
    const base = CBZ.sfx;
    if (typeof base !== "function") return;    // audio.js not parsed yet — retry
    if (base._uwMuffleWrapped) { sfxWrapped = true; return; }   // idempotent
    const w = function (name, opts) {
      const m = muffle;
      if (m > 0.35 && CFG.WATER_MUFFLE !== false && CFG.WATER_UNDERWATER !== false) {
        // never mutate the caller's options object — several call sites reuse one
        const o = {};
        if (opts) for (const key in opts) o[key] = opts[key];
        o.dist = Math.max(+o.dist || 0, FAR_TRIP);
        o.volume = (o.volume == null ? 1 : o.volume) * (1 - 0.30 * m);
        return base.call(this, name, o);
      }
      return base.call(this, name, opts);
    };
    // Carry every existing wrapper marker forward, exactly as the explosion
    // wrapper chain rule requires, so a later wrap can still detect its own.
    for (const key in base) { try { w[key] = base[key]; } catch (e) {} }
    w._uwMuffleWrapped = true;
    CBZ.sfx = w;
    sfxWrapped = true;
  }
  wrapSfx();

  // Read-only probes for anything that wants to branch on submersion (audio
  // muffling, oxygen UI, a future post pass). Never a setter.
  CBZ.cityCameraSubmerged = function () { return submerged; };
  CBZ.cityCameraDepth = function () { const d = eyeDepth(); return d > 0 ? d : 0; };
  // How muffled the mix currently is (0..1) — published so a future audio
  // system can read the same ramp instead of re-deriving it.
  CBZ.cityWaterMuffle = function () { return muffle; };
})();
