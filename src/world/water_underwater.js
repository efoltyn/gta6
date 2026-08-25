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

   1. THE WATER COLUMN'S COLOUR, through THREE.Fog. (REBUILT 2026-08-03 — see
      "THE COLOUR OF WATER" below.) The old model was pure Beer-Lambert
      extinction of one fixed surface light by the EYE's depth, and it had two
      faults the owner's reference photographs make obvious. First, it knew
      nothing about the water COLUMN: a metre under the surface over white sand
      and a metre under the surface over a 60 m abyss came out the same colour,
      when in life they are turquoise and near-black respectively. Second, its
      murk term made SHALLOW water the murkiest ("shallow coastal water carries
      more suspended sand"), so the one place you are supposed to see furthest
      was the one place the fog closed in. Both are inverted now: the colour is
      a ramp over the LOCAL SEABED DEPTH blended with the eye's own depth, and
      visibility runs long in the shallows and short in the deep. Beer-Lambert
      survives as a gentle spectral trim on top, because "red dies first" is
      still what makes 4 m of water look like water.
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
      renders. (The old note here said seabed caustics were deferred "because
      the deep sea has no floor geometry to receive them". There is a floor
      now — see THE FLOOR LAW — but the caustic ceiling still only paints the
      surface: light that has travelled 20 m of water no longer dances.)

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
     WATER_UW_SKY_SEAM — repaint core/sky.js's dome with the SUBMERGED fog
                       colour, so a hole in the geometry falls back to water
                       instead of sky. See the seam-law note by exitFog().
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
  // WATER_UW_SKY_SEAM — repaint core/sky.js's dome with the SUBMERGED fog
  // colour, so the background behind a hole in the geometry is water and not
  // sky. See "THE SEAM LAW IS ALSO A SUBMERGED LAW" below.
  // OFF (?cfg_WATER_UW_SKY_SEAM=0) → the exact prior look, white line and all.
  if (CFG.WATER_UW_SKY_SEAM == null) CFG.WATER_UW_SKY_SEAM = true;

  function off() {
    return CFG.WATER_UNDERWATER === false || CFG.WATER_V2 === false;
  }

  /* ============================================================
     THE COLOUR OF WATER — anchors read off the owner's reference photographs.

     ref 3 — SHALLOW (a diver kneeling on white sand, maybe 5 m down). The
       bottom is a bright near-white shell floor, the water above it is a LIGHT
       cyan-turquoise, brightest toward the surface, and the visibility is long:
       thirty metres away the sand is still readable, just hazed toward blue.
       Sampled: near water 0x7EC7D6, mid distance 0x4E8FAE, the top of frame
       0x86B3C6, the sand itself 0xD9D4C2.
     ref 4 — MID-DEPTH (a freediver and a shark, no bottom in frame). One
       continuous gradient: a pale glow where the surface is, saturating down
       through 0x3F8BAD into 0x1A5580 and 0x123F5E at the bottom of frame. No
       floor, but the column itself is depth-graded, and that grading is the
       only depth cue in the picture.
     ref 5 — DEEP (open blue water). Rich, dark, desaturating navy — 0x0A2A5E
       in the body, 0x04143A in the corners — under a BRIGHT rippling ceiling
       around 0x2F79C4 with near-white highlights where the sun comes through.
       Everything loses contrast with distance rather than getting foggier.

     So the ramp below is the picture set, in order. `k` — how deep is this
     water — is driven mostly by the LOCAL SEABED DEPTH (which is what makes a
     shallow bay light and an offshore trench dark at the same eye depth) and
     partly by the eye's own depth under the surface.
  ============================================================ */
  const RAMP = [
    // SHALLOW STOPS RE-READ off ref 3 (2026-08-03, second pass). The first
    // pass sampled the photo's NEAR water, which is pale because the sand
    // behind it dominates — so the medium came out a desaturated grey-cyan and
    // composed with the bed into exactly the washed sheet the owner rejected.
    // What the medium must actually be is the colour the sand HAZES INTO: ref
    // 3's far bottom (~30 m out) reads 0x93B5A8 and its mid water 0x2E6A94,
    // both clearly GREEN-leaning teal, not blue-grey. So both shallow stops
    // move to G >= B turquoise and gain ~40% saturation. Stops 2-5 (mid and
    // deep, sampled from k >= 0.4) are untouched — the deep is approved.
    { r: 0.435, g: 0.808, b: 0.788 },   // 0x6FCEC9 — ref 3, shallow over sand
    { r: 0.180, g: 0.576, b: 0.659 },   // 0x2E93A8 — ref 3, hazing out
    { r: 0.247, g: 0.545, b: 0.678 },   // 0x3F8BAD — ref 4, upper column
    { r: 0.102, g: 0.333, b: 0.502 },   // 0x1A5580 — ref 4, body
    { r: 0.039, g: 0.165, b: 0.369 },   // 0x0A2A5E — ref 5, deep body
    { r: 0.016, g: 0.078, b: 0.227 },   // 0x04143A — ref 5, the dark corners
  ];
  // The bright ceiling toward the sun, seen from below (ref 5's surface).
  // DELIBERATELY A SATURATED BLUE, not the pale cyan-white of the ripple
  // highlights: those highlights are a few percent of ref 5's ceiling, and
  // mixing a near-white into a navy medium turns the whole frame slate grey —
  // measured, on the first pass of this file, as a #29456e wash where the
  // reference is #2F79C4 over #0A2A5E.
  const SURFACE_GLOW = { r: 0.306, g: 0.604, b: 0.878 };   // 0x4E9AE0
  // An inland lake is a different liquid: green, and genuinely murkier.
  const LAKE_LIGHT = { r: 0.306, g: 0.561, b: 0.416 };     // 0x4E8F6A
  const MURK_LAKE = 2.15;      // an inland body is this much murkier than open sea

  // Depth (metres below the surface) at which the eye's own descent has taken
  // the colour as far as it goes. BLACKOUT normalises the EYE for the glow and
  // ray fades; DIVE_DARK is the shorter scale the COLOUR ramp uses — see the
  // note on medium() for why they are two numbers and not one.
  const BLACKOUT = 26;
  const DIVE_DARK = 16;
  // Where the SEABED-depth half of `k` runs from and to. 2 m of water is a
  // sandbar; 18 m is already open blue.
  //
  // BASIN_DARK WAS 40, and that is not what the reference photographs say.
  // The shark refs are shot over 15-25 m of water and that water is ALREADY a
  // saturated blue, while smoothstep(2, 40) called 17 m "a third of the way to
  // open ocean" and handed it a Bahamas turquoise. Measured on the island at
  // 3.4 m over a 17.5 m column, the old window produced a #327ea5 medium that
  // renders (through ACES and the sRGB encode, which lift a linear fog colour
  // a very long way) as a (148,205,215) pale sheet — the exact frame the owner
  // rejected.
  //
  // NEITHER APPROVED ANCHOR MOVES. Both worlds' deep frames are shot over a
  // 62 m column and the city's own shallow preset is 95 m offshore over its
  // 62 m cap, so every frame this ramp was tuned on sits at basin = 1 under
  // both windows. What changes is genuinely near-shore water — under 18 m —
  // which gets bluer sooner, which is what the photographs show.
  const BASIN_LIGHT = 2, BASIN_DARK = 18;
  // How far you can see, by `k`. Linear THREE.Fog, so this is literally "how
  // far can you see" — long over sand (ref 3), short in the deep (ref 5).
  const FOG_FAR_SHALLOW = 40, FOG_FAR_MID = 24, FOG_FAR_DEEP = 16;
  // Beer-Lambert extinction per metre of EYE depth, R/G/B. Much gentler than
  // the old (0.45, 0.09, 0.045) because the ramp above already carries the
  // hue; this is only the trim that keeps red dying first.
  // (EXT_R eased 0.075 -> 0.062 on the shallow pass: at 4 m the old value had
  // already taken a quarter of the red out of the medium, and a medium with a
  // 2.7:1 green-to-red ratio turns warm sand grey no matter how warm it is.
  // At the deep eye depths this moves the red channel by under 1/255.)
  const EXT_R = 0.062, EXT_G = 0.028, EXT_B = 0.013;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0 || 1));
    return t * t * (3 - 2 * t);
  }

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
  let kDepth = 0;      // 0..1 "how deep is this water" — the one grading number
  let glow = 0;        // 0..1 how much of the bright surface ceiling is in view

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

  // The backdrop shell (see THE EMPTY PIXEL, below). Radius only has to clear
  // the longest fog range this file ever writes (FOG_FAR_SHALLOW * the 1.9x
  // look-up bonus = 76 m) by a wide margin at the frustum corners, and stay
  // well inside every camera's far plane.
  const BACKDROP_R = 260;

  let fxRoot = null, ceiling = null, ceilU = null, shafts = null, shaftMat = null;
  let backdrop = null;

  function buildFx() {
    if (fxRoot || typeof document === "undefined") return;
    fxRoot = new THREE.Group();
    fxRoot.name = "cbz-underwater-fx";
    fxRoot.userData.dynamic = true;      // batch.js + farcull.js must never touch it
    fxRoot.userData.uwFx = true;
    fxRoot.visible = false;
    fxRoot.matrixAutoUpdate = true;

    /* ============================================================
       THE EMPTY PIXEL WAS THE ONE THING NOT GRADED (2026-08-25)

       Owner, from his phone: "the dark blue band, it looks dumb". Across the
       middle of every underwater frame sat a hard-edged, NEAR-BLACK horizontal
       stripe with his graded blue above it and lighter blue below. MEASURED
       off his screenshot: the water either side of it is (39,71,87) and the
       stripe is (10,19,24) — the same hue at a quarter of the value.

       That ratio is the whole diagnosis. Both are the SAME linear fog colour;
       one has been through the output transform and the other has not.

         * A fogged fragment gets core/renderer.js's patched fog_fragment
           (renderer.js:356-366), which deliberately runs fogColor through
           toneMapping() and linearToOutputTexel() before mixing, so the sky/
           fog seam law stays exact under ACES.
         * scene.background = a THREE.Color goes to gl.clearColor RAW. r128's
           WebGLBackground does not tone map it and outputEncoding does not
           touch it. So the takeover below was clearing the buffer to the
           LINEAR value while every fogged pixel around it showed the graded
           one. Reconstructed for the deep medium: raw (10,19,24) against a
           graded (42,76,90). That is the band, to within 3/255.

       And the band is a BAND because of where the empty pixels are: looking
       level, the sea surface sheet covers the frame above the horizon and the
       bed covers it below, and neither reaches the horizon row itself. The
       stripe is exactly the wedge where nothing is drawn.

       THE FIX IS NOT TO RE-DERIVE THE GRADE ON THE CPU. Duplicating ACES plus
       core/renderer.js's film grade in JS would be a second copy of a look
       that is allowed to change. Instead the empty pixel stops being empty:
       one black shell around the eye, `fog: true`, sitting 260 m out — far
       past any fog range this file writes, so its fog factor saturates at 1
       and the fragment IS cbzFogCol, produced by the identical shader code
       that produced the water beside it. Exact by construction, and it stays
       exact if anyone re-tunes the grade.

       Black + saturated fog also means the shell contributes nothing of its
       own: `mix(black, cbzFogCol, 1.0)`. depthTest off and renderOrder -9000
       make it a background rather than an occluder, and layer 2 keeps it out
       of the planar mirror and every CCTV feed like the rest of this file's
       meshes. Cost: one untextured fullscreen fill, only while submerged —
       the same fill the buffer clear was already doing. */
    if (CFG.WATER_UW_SKY_SEAM !== false) {
      const bgMat = new THREE.MeshBasicMaterial({
        color: 0x000000, fog: true, side: THREE.BackSide,
        depthWrite: false, depthTest: false,
      });
      bgMat.name = "cbz-uw-backdrop";   // never water/ocean/sea — gate matches names
      backdrop = new THREE.Mesh(new THREE.SphereGeometry(BACKDROP_R, 16, 12), bgMat);
      backdrop.name = "cbz-uw-backdrop";
      backdrop.frustumCulled = false;
      backdrop.renderOrder = -9000;     // after the dome (-10000), before everything real
      backdrop.userData.uwFx = true;
      backdrop.userData.underlay = true;
      backdrop.layers.set(FX_LAYER);
      backdrop.visible = false;
      fxRoot.add(backdrop);
    }

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
          // THE CEILING IS A DISC, NOT A SHEET. The plane follows the camera,
          // so `r` is horizontal distance from the swimmer: 0.35..0.98 meant
          // full strength out to 33 m and something out to 93 m, i.e. an
          // ADDITIVE, FOG-FREE layer over the entire upper half of every
          // underwater frame. Measured at 3.4 m under the shark island, that
          // lifted a #327fa5 medium to a (100,182,201) wash — the pale sheet
          // the whole brief is about, and it was coming from the one effect
          // nothing could fog. Tightened to a bright patch overhead falling
          // off by ~28 m, which is both what a diver sees (the light that
          // dances on the ceiling is the light near you) and inside the
          // medium's own view distance, so the far water is the water again.
          "  float r = length(vUv - 0.5) * 2.0;",
          "  float edge = 1.0 - smoothstep(0.055, 0.30, r);",
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
    if (backdrop) {
      // Same 0.9 m gate as the sky takeover: straddling the waterline the top
      // of the frame is genuinely air, and painting it water is the bug the
      // meniscus exists to avoid.
      backdrop.visible = depth >= 0.9;
      if (backdrop.visible) backdrop.position.copy(_eye);
    }
    if (ceiling && ceilU) {
      ceiling.position.set(camX, surfY - 0.06, camZ);
      ceilU.uTime.value = t;
      // Caustics come from sunlight refracting THROUGH the surface, so they
      // die with depth and with the day. Strongest in the first few metres.
      // 16 m was too short a reach, and for the wrong reason: what depth does
      // to a caustic pattern is BLUR it, not delete it — and the one view that
      // wants the ceiling most is looking UP from the deep, where ref 5's whole
      // subject is a bright rippling surface over a dark column. At 12 m the
      // old constant left 5% of it, i.e. nothing.
      const dfade = Math.max(0, 1 - depth / 26);
      // 0.85 OF A NEAR-WHITE was too much light to hang over the whole upper
      // hemisphere. This plane is 190 m across and ADDITIVE, so its average
      // contribution — not its peak — is what the eye reads, and measured at
      // 2.6 m under it was lifting a #3383a8 medium to (90,155,178): a pale
      // grey-teal wash exactly like the one the owner rejected. Halved, and
      // the colour pulled off white toward the medium's own blue, so what is
      // left is a rippling pattern rather than a sheet of daylight.
      // TRIED AND REVERTED (2026-08-25): 0.60, to lift the ceiling above the
      // horizon in the owner's chase framing. It bought 5 luminance points at
      // the top of that frame and lifted the two DEEP frames by 6 and 11 FLAT,
      // top to bottom — this plane is additive and fog:false, so what it adds
      // is a sheet, not a shape, which is the exact pale wash the note above
      // is about. The angle-shaped half of that experiment (the Snell window
      // in water_spec.js) kept the gain and cost nothing; this half did not.
      ceilU.uStrength.value = 0.45 * dfade * dfade * day;
      ceilU.uColor.value.setRGB(
        Math.min(1, 0.32 + tint.r * 1.0),
        Math.min(1, 0.54 + tint.g * 0.7),
        Math.min(1, 0.76 + tint.b * 0.45));
    }
    if (shafts && shaftMat) {
      const gfade = Math.max(0, 1 - depth / 30);
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
    // Belt and braces: the group flag already stops it drawing, but leaving
    // the backdrop's own flag true makes every probe that asks "is the water
    // background up?" answer yes on a dry beach.
    if (backdrop) backdrop.visible = false;
  }

  /* ============================================================
     THE FLOOR LAW — "there should ALWAYS be a bottom of water, even the
     deepest part of the ocean" (owner, 2026-08-03).

     MEASURED BEFORE (tools/probe.mjs, seed 90210, rays straight down through
     the live scene from the coast at x=7159, z=-300):

         200 m offshore   swimmable to 16 m   drawn floor  -1.86
        1000 m offshore   swimmable to 62 m   drawn floor  -1.86
        4000 m offshore   swimmable to 62 m   drawn floor -26.06
        6000 m offshore   swimmable to 62 m   NO FLOOR — zero ray hits
        8000 m offshore   swimmable to 62 m   NO FLOOR — zero ray hits

     Two separate failures. The near/mid sea's only floor was the terrain
     backdrop shelf sitting 1.4 m under the surface while the swimmer could
     descend sixty; that one belongs to the surface that draws it and is fixed
     there (world/terrain_overhaul.js, TERRAIN_SEABED_BATHY — the shelf now
     follows the same bathymetry the swimmer is clamped to). The OPEN OCEAN
     had no geometry at all: those tiles only span the live world plus a couple
     of kilometres, and the sea is sixteen kilometres across.

     This is that missing ground — one abyssal plain under the whole published
     sea footprint, sitting just below the shelf's own clamp so the two never
     fight for a pixel, with a long deterministic swell in it so it is a sea
     floor and not a card. It is NOT decoration and it holds no props: it is
     the bottom of the water, dark because it is 63 m down, and the thing that
     makes a dive in open water end on ground instead of in nothing.

     Cost: one Lambert draw call, ~4.2k triangles, built once inside the world
     build. Deterministic (analytic sums, no rng draw), so the seeded stream is
     untouched. WATER_SEABED=0 reverts to the void.
  ============================================================ */
  if (CFG.WATER_SEABED == null) CFG.WATER_SEABED = true;
  const ABYSS_DROP = 63.2;     // metres below mean sea — under SHELF_MIN (62.5)
  const ABYSS_RINGS = 44, ABYSS_SECT = 96;
  let abyss = null;

  function buildSeabed(city) {
    // Deliberately NOT gated on WATER_UNDERWATER: the bottom of the sea is
    // world geometry, not a camera effect, and turning off the submerged view
    // must not delete the ground a diver lands on.
    if (CFG.WATER_SEABED === false) return;
    const root = city && city.root;
    if (!root) return;
    // A rebuilt city root orphans the old plain (waterfx.js's `!reflect.parent`
    // test, same reason): keeping the stale reference would ship a world with
    // no bottom and no error to say so.
    if (abyss && abyss.parent === root) return;
    if (abyss) {
      if (abyss.parent) abyss.parent.remove(abyss);
      try { abyss.geometry.dispose(); abyss.material.dispose(); } catch (e) {}
      abyss = null;
    }
    const B = CBZ.SEA_WORLD_BOUNDS;
    const seaY = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    const cx = B && Number.isFinite(B.minX) ? (B.minX + B.maxX) / 2 : 310;
    const cz = B && Number.isFinite(B.minZ) ? (B.minZ + B.maxZ) / 2 : -750;
    // Reach the published sea's corners: half-span * sqrt(2), plus slack.
    const half = B && Number.isFinite(B.minX) ? Math.max(B.maxX - B.minX, B.maxZ - B.minZ) / 2 : 8000;
    const R = half * 1.5;

    const verts = (ABYSS_RINGS + 1) * (ABYSS_SECT + 1);
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const idx = [];
    // Sediment albedo. Dark, and slightly warmer in the shallower undulations
    // so the relief reads at all once a diver's light-adapted eye reaches it.
    const sedHi = { r: 0.086, g: 0.114, b: 0.145 };   // 0x161D25
    const sedLo = { r: 0.027, g: 0.043, b: 0.078 };   // 0x070B14
    let v = 0;
    for (let i = 0; i <= ABYSS_RINGS; i++) {
      // squared ring distribution: fine near the middle of the sea where a
      // swimmer can actually get to it, coarse out at the horizon.
      const rr = R * Math.pow(i / ABYSS_RINGS, 1.7);
      for (let j = 0; j <= ABYSS_SECT; j++) {
        const a = (j / ABYSS_SECT) * Math.PI * 2;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        // Long deterministic swell, DOWNWARD only — the plain may never rise
        // above the shelf clamp or it would punch through the shelf tiles.
        const dip = (Math.sin(x * 0.00062 + z * 0.00041) * 0.5 + 0.5) * 0.6 +
                    (Math.sin(x * -0.00027 + z * 0.00089 + 1.7) * 0.5 + 0.5) * 0.4;
        const y = seaY - ABYSS_DROP - dip * 9;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const t = 1 - dip;                     // 1 on the rises, 0 in the holes
        col[v * 3] = sedLo.r + (sedHi.r - sedLo.r) * t;
        col[v * 3 + 1] = sedLo.g + (sedHi.g - sedLo.g) * t;
        col[v * 3 + 2] = sedLo.b + (sedHi.b - sedLo.b) * t;
        v++;
      }
    }
    const stride = ABYSS_SECT + 1;
    for (let i = 0; i < ABYSS_RINGS; i++) {
      for (let j = 0; j < ABYSS_SECT; j++) {
        const a = i * stride + j, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, c, b, b, c, d);           // upward-facing winding
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, fog: true,
      side: THREE.FrontSide, depthWrite: true,
    });
    // NEVER "water"/"ocean"/"sea" in the material name: the terrain-water gate
    // asserts exactly one water SURFACE and matches on that name.
    mat.name = "cbz-uw-bed";
    abyss = new THREE.Mesh(geo, mat);
    abyss.name = "cbz-uw-bed";
    abyss.receiveShadow = false;
    abyss.castShadow = false;
    abyss.frustumCulled = true;
    abyss.matrixAutoUpdate = false;
    abyss.updateMatrix();
    // terrain: batch.js + farcull.js exempt. underlay: the world-surface audit
    // already honours it for a big flat surface that deliberately sits UNDER
    // another one, which is exactly what the bottom of the sea is.
    abyss.userData.terrain = true;
    abyss.userData.underlay = true;
    abyss.userData.seaFloor = true;
    root.add(abyss);
  }
  // Registered the way world/terrain_overhaul.js registers its own tiles:
  // straight onto the array, because city/worldmap.js (which publishes
  // CBZ.addLandmass) may not have parsed yet. Order 98.5 = after the terrain
  // shelf (98), before wildnature (99).
  CBZ._landmassBuilders = CBZ._landmassBuilders || [];
  CBZ._landmassBuilders.push({ fn: buildSeabed, order: 98.5 });
  // A rebuilt city root orphans the old plain; forget it so the next build
  // makes a fresh one instead of silently shipping a world with no bottom.
  CBZ.waterSeabedForget = function () { abyss = null; };
  CBZ.waterSeabedMesh = function () { return abyss; };

  // ============================================================
  //  FOG
  // ============================================================
  function enterFog(scene) {
    if (myFog || !scene || !scene.fog) return;
    savedFog = scene.fog;
    savedNear = savedFog.near; savedFar = savedFog.far;
    myFog = new THREE.Fog(savedFog.color.getHex(), 0.6, FOG_FAR_SHALLOW);
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
    driveLight(0, 0);              // give the world its daylight back at once
    releaseSky(scene);
    // Stop re-asserting a water colour onto a Fog we no longer own. sky.js
    // repaints itself from here: daynight writes the day colour to the
    // restored Fog and its moved-test sees the jump.
    fogCReady = false;
  }

  /* ============================================================
     HALF THE FRAME WAS STILL SKY (2026-08-25)

     The seam note below fixed the colour core/sky.js paints BELOW its horizon
     row. It could not fix the half above it, because that half is a sky
     gradient by construction: core/sky.js:653 fills SKY_H/2 downward with
     scene.fog.color and everything above stays daylight blue. Above water that
     is exactly right — the dome IS the sky. Eleven metres under it means that
     any pixel with no geometry in it, looking level or up, is painted a bright
     daylight blue on top of a dark navy medium. Measured on the shark island
     at 1.6 m: a #2a8ba5 fog, and a frame reading about (128,180,186).

     There is no repaint to win here — the dome is a BACKGROUND (fog:false,
     depthTest:false, renderOrder -10000) and its job is to be what an empty
     pixel falls back to. So while the eye is properly under, the empty pixel
     falls back to the WATER instead: the dome is hidden and scene.background
     is taken over by the live medium colour, which is what r128's
     WebGLBackground clears the buffer to. Both are restored on surfacing.

     THE 0.9 m THRESHOLD IS NOT A FUDGE. Straddling the waterline, the top of
     the frame is genuinely above the surface and genuinely sky — that is the
     whole point of the meniscus band and the clipped tint gradient. So the
     takeover waits until the eye is a clear metre under, where there is no
     above-water half left to protect. */
  let savedBg, bgHave = false, domeWas = -1;
  const _bgC = new THREE.Color();
  function holdSky(scene) {
    if (bgHave || !scene) return;
    savedBg = scene.background;
    scene.background = _bgC;
    bgHave = true;
    const dome = CBZ.skyDome;
    if (dome) { domeWas = dome.visible ? 1 : 0; dome.visible = false; }
  }
  function releaseSky(scene) {
    if (!bgHave) return;
    if (scene && scene.background === _bgC) scene.background = savedBg;
    savedBg = undefined; bgHave = false;
    const dome = CBZ.skyDome;
    if (dome && domeWas >= 0) dome.visible = !!domeWas;
    domeWas = -1;
  }

  /* ============================================================
     THE SUN DOES NOT GO UNDERWATER WITH YOU (2026-08-25)

     Nothing in this engine has ever read CBZ.cityCameraSubmerged, which meant
     the LIGHTS never changed when your eyes went under. modes/survival.js
     (onAlways 93) writes sun 1.08 / hemi 0.98 every single frame, and
     core/gfx.js re-applies the tone-map gain on top at 94.5 — so a seabed nine
     metres down was being lit exactly as hard as the beach, and a pale sand
     albedo under that much light CLIPS. That is most of what made the owner's
     underwater frames read as a shark floating on a sheet of paper: the fog
     was already grading, and the floor underneath it was still at full noon.

     Sunlight does not survive water. Ten metres of clear sea takes roughly
     two thirds of it, and by twenty-five there is barely a tenth left; what
     remains is what makes a deep shark a SILHOUETTE rather than a lit object.
     So: one exponential, applied to the sun, the hemisphere and the bounce
     fill, eased on the same 0.22 s ramp as the tint.

     WHY THIS CANNOT COMPOUND. Every mode rewrites these intensities from
     scratch before we run (survival.js @93, city/mode.js @94, core/gfx.js
     @94.5), so we are always scaling a FRESH number. The `lit*` fields are the
     same foreign-write probe the fog uses above: if what we find is not what
     we last wrote, someone else authored it and that is the new base. If
     nobody rewrote it (a mode with no light writer), we still hold the base we
     adopted and the multiply stays idempotent. Surfacing writes the base back.
     ============================================================ */
  /* THE DIVER DIMMED THE WRONG HALF (2026-08-25). The first cut of this took
     the KEY down hardest (floor 0.13, e-fold 4.6 m) and let the scattered
     ambient outlive it (floor 0.22, e-fold 7.4 m). At twelve metres that left
     sun 0.19 against ambient 0.37 — nearly two parts flat fill to one part
     directional — and a Lambert body under two parts fill has no form at all.
     That is the second half of the owner's "the shark is BLUE": even once the
     veil bug above stopped painting it flat, the light had nothing left to
     model it with.

     It is also backwards. Direct sunlight takes the SHORT path — straight
     down, roughly depth/cos — while skylight arrives over every longer slant
     there is, so what actually survives a dive is the directional half. Every
     one of the owner's reference photographs shows it: a shark at depth is
     top-lit, bright along the back with the underside in shadow, against a
     medium that has gone dark. So the key now outlives the ambient, not the
     other way round.

     THE TOTAL MUST GO DOWN, NOT UP — this may not lighten the deep he
     approved, and the first pass of this rebalance did: floors of 0.30/0.10
     over a 6 m key e-fold doubled the sun at twelve metres (0.19 -> 0.43) and
     the captured frame went from a saturated blue to a grey-blue, because a
     harder key on the sea's own underside and on the shelf puts luminance back
     into the two surfaces that fill most of a deep frame. The reference
     photographs are the check: their RED channel sits between 0 and 13 at
     every depth, and lifting the key is the fastest way to break that.
     So the key is nudged and the fill is halved:
       at  3.4 m  key 0.545 -> 0.586,  fill 0.638 -> 0.500  (total  -8%)
       at  6.0 m  key 0.395 -> 0.413,  fill 0.541 -> 0.316  (total -22%)
       at 12.0 m  key 0.194 -> 0.236,  fill 0.372 -> 0.161  (total -30%)
     Darker at every depth than what shipped, and the key:fill ratio at twelve
     metres goes from 0.52:1 to 1.47:1 — which is the part that decides whether
     a body has a lit side. */
  const LIGHT_FLOOR = 0.16;     // fraction of the KEY light left in the deep
  const AMB_FLOOR = 0.10;       // ...and of the scattered ambient
  const LIGHT_SCALE = 5.0;      // e-folding depth of the KEY, metres
  const AMB_SCALE = 4.2;        // the fill dies FASTER than the key (short path)
  let litSun = -1, litHemi = -1, litBounce = -1;
  let baseSun = 0, baseHemi = 0, baseBounce = 0;
  function driveLight(depth, amount) {
    const sun = CBZ.sun, hemi = CBZ.hemi, bounce = CBZ.bounce;
    if (!sun) return;
    if (sun.intensity !== litSun) baseSun = sun.intensity;
    if (hemi && hemi.intensity !== litHemi) baseHemi = hemi.intensity;
    if (bounce && bounce.intensity !== litBounce) baseBounce = bounce.intensity;
    if (!(amount > 0.002)) {
      if (litSun >= 0) {
        sun.intensity = baseSun;
        if (hemi) hemi.intensity = baseHemi;
        if (bounce) bounce.intensity = baseBounce;
        litSun = litHemi = litBounce = -1;
      }
      return;
    }
    const d = Math.max(0, depth);
    const lit = LIGHT_FLOOR + (1 - LIGHT_FLOOR) * Math.exp(-d / LIGHT_SCALE);
    // The scattered half arrives over every longer slant there is, so it is
    // the one the water eats first. Its floor is what keeps a shadow side
    // dark-blue rather than black.
    const litA = AMB_FLOOR + (1 - AMB_FLOOR) * Math.exp(-d / AMB_SCALE);
    const f = 1 - amount * (1 - lit);
    sun.intensity = baseSun * f; litSun = sun.intensity;
    if (hemi) { hemi.intensity = baseHemi * (1 - amount * (1 - litA)); litHemi = hemi.intensity; }
    if (bounce) { bounce.intensity = baseBounce * f; litBounce = bounce.intensity; }
  }

  /* ---- THE SEAM LAW IS ALSO A SUBMERGED LAW -------------------------------
     core/sky.js paints the dome so that everything below its horizon row IS
     scene.fog.color exactly (paintSky's final fillRect) — that is the law that
     makes the sky/fog join invisible above water. The dome is the BACKGROUND:
     fog:false, depthTest:false, depthWrite:false, renderOrder -10000, drawn
     first and expected to be overwritten by every real surface. So the law is
     not decoration; it is what a pixel with NOTHING in it falls back to.

     Underwater that fallback was still the sky. Two facts collide:

       1. sky.js reads the fog at ORDER 99. This module installs myFog at
          ORDER 99.6 — deliberately last, so nothing overwrites the range we
          just wrote. The sky therefore reads the fog we are about to replace,
          and its repaint gate (a colour-moved test against what it last
          painted) never re-fires on a value it never saw move.
       2. fog:false means the water column cannot reach the dome at all, and
          depthTest:false means a hole in the geometry is a BRIGHT seam rather
          than a dark one.

     MEASURED (eye 11.6 m under, fp-deep-horizon, seed 90210): the sky canvas
     below its horizon row sat at (187,201,207) — #bac8ce, the ABOVE-water fog
     colour — while scene.fog was #041e50 at far 17.3 m. Looking up toward the
     shore, where the ocean shader and terrain_overhaul's shelf cutout BOTH
     discard over dry land, that left a 9-row hole through which the dome drew
     (239,240,239) across a water column reading (6,112,190): the owner's
     "fake horizon" line, tracing the coastline. One CBZ.skySync() moved the
     canvas to (5,31,81) and those rows to (6,113,190) — the water, to within
     4/255.

     WHAT THE SKY READS IS NOT WHAT WE WROTE, AND THAT IS THE WHOLE BUG. The
     first cut of this fix forced a repaint from the main pass (CBZ.skySync at
     order 99.6). It did not hold, for a reason worth writing down:
     core/daynight.js runs at ORDER 2 and its last act is
     `scene.fog.color.copy(fogC)` (daynight.js:161) — the DAY colour, copied
     onto whatever Fog object is installed, which while you are under is OURS.
     So the real per-frame order is:

        order  2   daynight   myFog.color := the above-water day colour
        order 99   sky.js     reads THAT, repaints the dome above-water
        order 99.6 us         myFog.color := the water colour (too late)

     The fog the WORLD renders with is correct, because we get the last word
     before the frame is drawn. The fog the SKY was painted from is wrong every
     single frame, because it reads in the gap between daynight's write and
     ours. A forced repaint at 99.6 only papers over that, and it must be
     throttled or it refills a 1024x512 canvas at 60Hz — so it loses the race
     roughly five frames in six. MEASURED, and it is why this is the second
     cut: one tick put the canvas at (5,31,81), and twenty ticks later it was
     back at (186,200,207) with the line intact.

     SO DO NOT FIGHT THE SKY — GIVE IT THE RIGHT VALUE TO READ. One tiny pass
     at order 98.9 re-asserts the colour we computed last frame, immediately
     BEFORE sky.js looks at it. sky.js then paints the water colour through its
     OWN moved-test and its OWN 100 ms throttle; we force nothing, so there is
     no repaint storm to guard against and no second throttle to tune. It is
     one Color.copy per frame while submerged and nothing at all otherwise.

     Surfacing needs no help: exitFog puts the real Fog back, daynight writes
     the day colour to it, and sky.js's own moved-test sees a large jump and
     repaints on its next tick. */
  let fogCReady = false;
  CBZ.onAlways(98.9, function () {
    if (CFG.WATER_UW_SKY_SEAM === false || !myFog || !fogCReady) return;
    myFog.color.copy(_fogC);
  });

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

  // Sample the reference ramp at 0..1. Allocation-free.
  function rampAt(k, out) {
    const t = clamp01(k) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t));
    const f = t - i, a = RAMP[i], b = RAMP[i + 1];
    out.r = a.r + (b.r - a.r) * f;
    out.g = a.g + (b.g - a.g) * f;
    out.b = a.b + (b.b - a.b) * f;
    return out;
  }

  /* THE MEDIUM. `k` is the one number the whole look hangs off, and it was
     WEIGHTED THE WRONG WAY ROUND (2026-08-25).

     It used to be `0.66 * basin + 0.34 * dive` over a 26 m eye scale, i.e. the
     colour was almost entirely a function of how deep the SEABED is and barely
     a function of how deep YOU are. The reasoning was sound for the two city
     reference photographs it was tuned on (both taken a few metres down, one
     over sand and one over the abyss). It is wrong the moment anyone actually
     descends: the owner's shark refs are the same water at two eye depths —
     bright sunlit blue near the surface, dark desaturated blue-green twelve
     metres down — and the old weights moved `k` by 0.16 across that whole dive.
     Diving did essentially nothing to the picture.

     THE REBALANCE, and why it is not just "swap the numbers". What the eye
     reads horizontally underwater is two separate things:
       * how much sunlight has survived the water ABOVE you — that is `dive`,
         and it is the term that must dominate, because it is the only one that
         changes when you swim down;
       * whether there is a bright bottom close enough to bounce light back —
         that is `1 - basin`, and it is what keeps a sandbar turquoise no matter
         what. Its influence has to FADE as you leave it behind, which is what
         the negative cross term does.

           k = 0.40 * basin + 0.72 * dive - 0.14 * basin * dive

     Solved so the approved CITY deep frame is arithmetically unchanged: at the
     open-ocean anchor (62 m bed, 11 m eye) this is 0.799 against the old 0.800.
     The city's shallows come out LIGHTER (a 30 m bed at 4 m eye: 0.49 against
     0.62 — which is the direction ref 3 wanted anyway), and a dive over the
     island's shelf finally goes dark: 12 m down over 25 m of water is 0.75,
     where the old weights gave 0.35.

     Then: the day factor (a night dive really is black), the inland-lake green
     shift, and a gentle Beer-Lambert trim on the eye depth alone. Writes into
     `out` (r,g,b in 0..1) — allocation-free. */
  const _tint = { r: 0, g: 0, b: 0 };
  function medium(eyeDepth, bedDepth, murk, inland, day, out) {
    const basin = smoothstep(BASIN_LIGHT, BASIN_DARK, bedDepth);
    const dive = clamp01(eyeDepth / DIVE_DARK);
    const k = clamp01(basin * 0.40 + dive * 0.72 - basin * dive * 0.14);
    rampAt(k, out);
    // spectral trim — red first, over the metres the eye itself has descended
    const e = Math.max(0, eyeDepth) * murk;
    out.r *= Math.exp(-EXT_R * e) * day;
    out.g *= Math.exp(-EXT_G * e) * day;
    out.b *= Math.exp(-EXT_B * e) * day;
    if (inland > 0) {   // a lake is green water, not blue water
      out.r += (LAKE_LIGHT.r * day - out.r) * inland * 0.55;
      out.g += (LAKE_LIGHT.g * day - out.g) * inland * 0.55;
      out.b += (LAKE_LIGHT.b * day - out.b) * inland * 0.55;
    }
    return k;
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
    // "Is there water in this world", not "is this the city". The survival
    // island is water too — its sea is the same surge-driven surface — and this
    // whole treatment was dark there purely because the ONE oracle below
    // (cityWaterAt / citySeaHeightAt, via eyeDepth) only answered for the city.
    // world/water_survival.js makes it answer for both; this is the gate that
    // was keeping the answer from being asked.
    const gone = off() || !g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city");

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

    // THE GROUND MUST TAKE THE WATER'S COLOUR. world/terrain_overhaul.js dials
    // fog down to 12% on the backdrop/shelf tiles so distant ranges recede
    // properly in air; underwater that left the seabed shaded as if it were a
    // metre away and it read as a flat pale sheet nine metres down. Ease the
    // scale to 1 on the same ~0.22 s ramp as the tint, so the bottom fogs into
    // the medium exactly like everything else and surfacing restores every
    // consumer's authored dial.
    if (CBZ.terrainFogScaleSubmerged) CBZ.terrainFogScaleSubmerged(shown);

    // THE LIGHT GOES DOWN WITH THE EYE. Order 99.6 is after every mode's own
    // light writer (survival.js @93, city/mode.js @94, core/gfx.js @94.5), so
    // this always scales a fresh authored value — see driveLight's note.
    driveLight(depth, shown);

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
    // THE WATER COLUMN UNDER THE EYE. This is the number the whole look is
    // graded by, and it is the same one city/swim.js clamps the swimmer
    // against and world/terrain_overhaul.js draws the bed from — so the
    // colour, the floor and the collision are one story. (The old code asked
    // cityWaterDepthAt directly and then made the shallows MURKIER, which is
    // backwards: shallow water over sand is the clearest water there is.)
    const bedDepth = CBZ.citySeaBedDepthAt ? CBZ.citySeaBedDepthAt(_eye.x, _eye.z)
      : (CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(_eye.x, _eye.z) : 24);
    // MURK is now ONLY the lake term. The open sea is clean water; how far you
    // can see in it is the fog RANGE below, not a density fudge.
    const density = 1 + (MURK_LAKE - 1) * inland;
    kDepth = medium(Math.max(0, depth), bedDepth, density, inland, day, _tint);
    // SURFACE-FROM-BELOW (ref 5): looking up toward the sun, the ceiling is
    // bright and rippling; looking down or out, it is not. One dot product,
    // faded out by the eye's own depth and by the day.
    const el = clamp01(camElevation());
    glow = Math.pow(el, 1.35) * (1 - d01 * 0.85) * day * (1 - inland * 0.6);

    if (overlay) {
      const vis = submerged || shown > 0.002;
      if (overlay.style.display !== (vis ? "block" : "none")) overlay.style.display = vis ? "block" : "none";
      if (vis) {
        // Shallow turquoise is a LIGHT veil; deep navy is a heavy one.
        // HOW HEAVY THE VEIL IS. 0.60 + 0.36k put a 64%-opaque sheet over a
        // sandbar, which is what turned a cream bottom into a grey one — in
        // ref 3 the near sand is very nearly its own colour and only the
        // DISTANCE goes turquoise, and distance is the fog's job, not the
        // overlay's. Through the deep k (~0.8) this still evaluates to the
        // shipped 0.888; at k = 0.1 it is 0.43 instead of 0.64.
        overlay.style.opacity = String(Math.min(0.96, 0.36 + kDepth * 0.66) * shown);
        if (rays) rays.style.opacity = String(Math.max(0, 0.34 - d01 * 0.34) * shown);
        paintOverlay(depth, kDepth);
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
    // so a Fastest-tier machine is not paying for 40 metres of fogged water.
    const q = CBZ.qScale ? CBZ.qScale(0.62, 1.0) : 1;
    // The FOG colour is the medium, warmed toward the surface glow by how far
    // up you are looking. THREE.Fog carries one colour, so this is where the
    // "bright ceiling" reaches the geometry — the DOM gradient in paintOverlay
    // carries the part with a vertical shape. No post pass, no second render.
    // Kept low ON PURPOSE. Fog colour is applied to EVERY distant fragment, so
    // a large glow blend does not read as "a bright ceiling up there" — it
    // reads as haze over the entire frame. The ceiling's shape belongs to the
    // DOM gradient below; this is only the light it spills onto geometry.
    const gm = glow * 0.30;
    _fogC.setRGB(
      _tint.r + (SURFACE_GLOW.r * day - _tint.r) * gm,
      _tint.g + (SURFACE_GLOW.g * day - _tint.g) * gm,
      _tint.b + (SURFACE_GLOW.b * day - _tint.b) * gm);
    myFog.color.copy(_fogC);
    fogCReady = true;              // _fogC is now a real colour for the 98.9 pass
    // ...and an empty pixel falls back to the water rather than to daylight.
    if (CFG.WATER_UW_SKY_SEAM === false || depth < 0.9) releaseSky(scene);
    else { _bgC.copy(_fogC); holdSky(scene); }
    // Visibility by `k`, not by eye depth: a metre under the surface in a 60 m
    // trench is already dark blue with the far wall gone, and ten metres down
    // over a sandbar still reads the bottom (ref 3).
    const farK = kDepth < 0.5
      ? FOG_FAR_SHALLOW + (FOG_FAR_MID - FOG_FAR_SHALLOW) * (kDepth * 2)
      : FOG_FAR_MID + (FOG_FAR_DEEP - FOG_FAR_MID) * ((kDepth - 0.5) * 2);
    // LOOKING UP SEES FURTHER, and it is not a cheat: there is less water
    // between the eye and the surface than between the eye and the horizon, so
    // the same medium is measurably clearer straight up. Without this the deep
    // dive is correct and boring — the surface sits past the fog limit and
    // ref 5's whole subject, the bright rippling ceiling, is never drawn.
    myFog.far = farK * (1 + glow * 0.9) * q / density;
    /* THE FIRST FEW METRES OF WATER ARE GLASS (2026-08-25). `near` was a flat
       0.4 m, which means smoothstep started eating a body the moment it left
       the lens: at the phone's own tier (far ~17 m) the ridden shark four to
       eight metres ahead was already 12-45% dissolved into the medium, and
       that is the rest of the owner's "the shark is BLUE". None of the
       reference photographs behave that way — clear water is glass at close
       range and only the DISTANCE hazes; the great white at six metres in the
       master reference is at full contrast against a dark column.

       So `near` becomes a fraction of the range instead of a constant. It is
       tied to `far` and not fixed in metres because "how far can you see"
       already varies 40 m to 16 m across this file's own ramp, and a constant
       near that reads as clear in the shallows would be most of the deep's
       entire visible range. At 0.22:
         shallow (far 40)  clear to  8.8 m, closed by 40 m
         mid     (far 24)  clear to  5.3 m, closed by 24 m
         deep    (far 16)  clear to  3.5 m, closed by 16 m
       FAR IS UNTOUCHED, so nothing about the far field moves: everything at
       25 m and beyond still closes into exactly the dark blue he approved.
       This only reshapes the curve between the lens and the haze.

       0.15 AND NOT 0.22, on the second pass: 0.22 also unfogged the SHELF at
       twelve metres, and a bed that reads lighter than the water above it is
       the exact "light blue under" the owner rejected. 0.15 keeps the first
       few metres glass (a body at 6 m is 7% fogged where it used to be 19%)
       and hands the mid-field back to the medium. */
    myFog.near = myFog.far * 0.15;
    lastNear = myFog.near; lastFar = myFog.far;
  });

  // How far UP the camera is looking: +1 straight at the surface, 0 level,
  // -1 straight at the bed. The camera's world matrix third column is its
  // +Z (backward) axis, so forward.y is -e[9].
  function camElevation() {
    const cam = CBZ.camera;
    if (!cam) return 0;
    return -cam.matrixWorld.elements[9];
  }

  // The screen row (0..100 %) of the eye-level HORIZON. Seen from under a flat
  // surface this is exactly where the water ceiling stops and the open column
  // begins, so it is the anchor the brightness gradient hangs on. Projecting a
  // far point at the eye's OWN height gets it right for any pitch and roll
  // without a single trigonometric assumption about the lens.
  function horizonRow() {
    const cam = CBZ.camera;
    if (!cam) return 50;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-4) return camElevation() > 0 ? 100 : -100;   // straight up/down
    _probe.set(_eye.x + (fx / fl) * 900, _eye.y, _eye.z + (fz / fl) * 900);
    _probe.project(cam);
    if (!Number.isFinite(_probe.y)) return 50;
    return (1 - _probe.y) * 50;
  }

  // The tint gradient is rebuilt from the live extinction colour, and CLIPPED
  // at the projected waterline so straddling the surface reads as half in,
  // half out. Both writes are change-gated: a CSS background string is not
  // something to hand the style engine 60 times a second for no reason.
  const _c1 = { r: 0, g: 0, b: 0 }, _c2 = { r: 0, g: 0, b: 0 }, _c3 = { r: 0, g: 0, b: 0 };
  function paintOverlay(depth, k) {
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
    // THE VERTICAL SHAPE (refs 4 and 5). Every one of the photographs is a
    // gradient, not a flat wash: bright where the surface is, saturating
    // downward into the dark. The eye-level horizon is where that turn
    // happens, so the gradient is anchored on the projected horizon row and
    // the top stop is lifted toward the surface glow by how far up you look.
    // Clamped into the visible band so a straight-down view still shows the
    // ordinary bright-to-deep fall rather than a single flat colour.
    let hz = horizonRow();
    if (!(hz > row + 6)) hz = row + 6;
    if (hz > 96) hz = 96;
    // top: the ceiling. Lifted toward SURFACE_GLOW by `glow`, and always a
    // little brighter than the medium so the column has a direction.
    // The baseline lift is deliberately SMALL — a level gaze in ref 5 is
    // nearly as dark at the top of frame as at the bottom, and the old
    // 1.45x+0.18 constant was what kept the deep reading as a bright postcard
    // blue no matter where you looked. Almost all of the brightening is now
    // `gl`, i.e. actually pointing at the surface.
    // THE LIFT IS NOW SCALED BY DEPTH, and that is the shallow wash fixed at
    // its source. A FLAT +0.04/+0.05/+0.07 is nothing on ref 5's near-black
    // navy but it is a bleach on ref 3's light turquoise: at k = 0.1 the tint
    // is already (0.44, 0.81, 0.79), so 1.16x plus the offset clipped the top
    // stop to white and every frame that looked up read pale grey. Both terms
    // are keyed to k, and the coefficients are chosen so that at the deep k
    // (~0.8) they evaluate to the shipped 1.16/1.14/1.12 and 0.040/0.050/0.070
    // EXACTLY — the approved deep frame is arithmetically unchanged.
    const gl = glow, lift = 1.05 + 0.14 * k;
    _c1.r = _tint.r * lift + 0.0500 * k + (SURFACE_GLOW.r - _tint.r) * gl * 0.70;
    _c1.g = _tint.g * lift + 0.0625 * k + (SURFACE_GLOW.g - _tint.g) * gl * 0.70;
    _c1.b = _tint.b * lift + 0.0875 * k + (SURFACE_GLOW.b - _tint.b) * gl * 0.70;
    // mid: the medium itself, at the horizon.
    _c2.r = _tint.r * 0.86; _c2.g = _tint.g * 0.90; _c2.b = _tint.b * 0.96;
    // BOTTOM — the column looking DOWN. 0.24/0.28/0.46 is ref 5's dark
    // corners, and it is right for the deep; over a sandbar it is a lie. In
    // ref 3 the downward view is the BRIGHTEST part of the picture (all that
    // sand throwing light back), so a fixed 76% darkening painted the shallow
    // bed grey-blue no matter how warm its albedo was — and shot 01 looks down.
    // `dkf` reaches 1 by mid depth, so the deep corners are byte-identical and
    // the shallows keep the medium's own turquoise instead of a navy veil.
    const dkf = smoothstep(0.15, 0.55, k);
    _c3.r = _tint.r * (0.78 - 0.54 * dkf);
    _c3.g = _tint.g * (0.80 - 0.52 * dkf);
    _c3.b = _tint.b * (0.92 - 0.46 * dkf);
    /* THE VEIL IS LIGHT OVER SAND AND HEAVY IN THE DEEP, on every stop — and
       since 2026-08-25 it also LEANS. Owner, on the master reference: "color
       bands should be gradient darker as it gets deeper — not light blue, dark
       blue, and light blue under." Once the band above stopped painting a
       stripe through the middle, the remaining fault was that this gradient
       was too flat to read as a gradient at all: at the deep k its top stop
       sat at 0.37 and its bottom at 0.80.

       ONLY THE BOTTOM MOVES, and the first cut of this got that wrong. Taking
       the TOP stop down as well (to unveil a near body up there) lightened
       every frame by a lot more than it looked like it would, and it lightened
       it in the one direction the reference photographs will not tolerate: the
       rendered water under this overlay is a pale cyan, because the fog colour
       is a dark navy in LINEAR space and the ACES pass plus the sRGB encode
       lift it a very long way. The overlay is authored in sRGB bytes straight
       off the linear tint, so it is the ONLY layer in the stack whose colour
       is already reference-shaped (red near zero) — thinning it is thinning
       the thing that makes the frame look like the photograph. The near-body
       problem it was aimed at was never this layer's fault anyway; it was the
       veil bug in water_spec.js, and a properly shaded shark carries its own
       contrast straight through a 0.27 veil.
       So the top stop is exactly what shipped and only the bottom leans:
       deep-k spread 0.37->0.80 becomes 0.37->0.88. */
    const bright = rgb(_c1, (0.26 + k * 0.14 + gl * 0.14).toFixed(3));
    const mid = rgb(_c2, (0.36 + k * 0.24).toFixed(3));
    // ...and its WEIGHT. 0.54 at k = 0.1 is a heavy navy sheet laid over a
    // sunlit sandbar; ref 3's downward view is barely veiled at all near the
    // lens and only the DISTANCE goes teal, which is the fog's job. Solved to
    // hit the shipped 0.796 at the deep k (~0.8) exactly.
    const deep = rgb(_c3, (0.36 + k * 0.65).toFixed(3));
    const top = row.toFixed(1);
    const mid1 = (row + (hz - row) * 0.55).toFixed(1);
    const bg = "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) " + top + "%, " +
      bright + " " + top + "%, " + bright + " " + mid1 + "%, " +
      mid + " " + hz.toFixed(1) + "%, " + deep + " 100%)";
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
