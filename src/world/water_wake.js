/* ============================================================
   src/world/water_wake.js — WHAT THINGS IN THE WATER DO TO IT.

   Three layers, one file of sources:
     the FIELD      world/water_wakefield.js: the simulated surface every
                    source disturbs (rings, V wakes, foam). The sea shaders
                    draw it. This file is its biggest customer.
     the SPRAY      airborne droplets (THREE.Points, velocity-aligned): the
                    one thing a billboard is honest about, a flying drop.
     the CROWN      the sheet of water an impact throws up (cone strips whose
                    base rides the swell), CBZ.waterCrown.
   Surface foam is no longer geometry lying on the water: it is foam in the
   field, which the sea shades as part of the surface.

   CBZ.waterWakeFor(obj, dt, opts?) — THE ONE WAKE HOOK
   Anything moving through the surface asks for its wake with one line; the
   helm, the autopilot, the sea-craft ride and this file's own sweeps call it.
   It reads (all optional): pos/position, heading, v, _planing, _trim,
   _steerInput, _throttle, _hullSpec {loa, beam, draft, massT, planeMs,
   engine}, dims. From those numbers alone (no per-boat cases):
     - the hull's displacement pushes water aside in the field (the bow wave,
       the trough and the V fall out of the wave equation),
     - foam on the hull's rim scaled by speed (bow and chine spray),
     - aerated wash astern scaled by throttle and planing (a planing hull a
       narrow bright track, a displacement hull a broad one, a paddled hull
       almost none plus blade rings),
     - airborne chine spray and rooster tail while planing,
     - a track for the CPU twin, so other hulls and swimmers feel the wake.
   It is called once per object per frame (the first call wins), and it does
   not care where the camera or the player is: the field decides what it can
   hold, the twin keeps every track.

   PUBLIC
     CBZ.waterEmit(o)        one airborne droplet; o.ride (surface) becomes a
                             field stamp
     CBZ.waterCrown(o)       the erupting sheet
     CBZ.waterSplashAt(x, y, z, strength)  legacy dial, translated into a
                             mass and speed for CBZ.waterHit (the one door)
     CBZ.waterRippleAt(x, z, size, ttl)    a small ring in the field
     CBZ.waterEmitFree() / waterFoamFree() / waterParticleCount() /
     waterFxAudit() / waterFxWarmObjects()

   Randomness here is presentation only and comes from a file-local
   mulberry32, never Math.random. Gameplay state is never written.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  function fxOn() { return CFG.WATER_V2 !== false; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  let _fxSeed = 0x9E3779B9 >>> 0;
  function fxRand() {
    _fxSeed = (_fxSeed + 0x6D2B79F5) >>> 0;
    let t = _fxSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function surfY(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z)
      : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  }

  // The entry-impulse term of the sea, sampled per vertex by the crown so its
  // foot stands in the crater. impRefresh() runs once per tick.
  let impLive = false, impNow = 0;
  function impRefresh() {
    impLive = false;
    if (!CBZ.waterImpulseHeightAt || !CBZ.waterImpulsesLive) return;
    impNow = CBZ.waterClock ? CBZ.waterClock() : 0;
    impLive = !!CBZ.waterImpulsesLive(impNow);
  }
  function impH(x, z, t) { return CBZ.waterImpulseHeightAt(x, z, t); }

  // ============================================================
  //  A. AIRBORNE WATER — droplets and mist, one pooled THREE.Points
  // ============================================================
  /* Thrown water is MANY SMALL DROPS on ballistic arcs: a few centimetres
     each, fast, stretched along their own motion, lit by the scene (sun on
     the top, sky and sea on the underside), never a glowing white blob. A
     caller asking for one big drop (the vocabularies were written in "beads
     of 0.1-0.3 m") gets that volume as several small drops with a little
     spread, so every splash in the game turned finer without touching its
     author. MIST is the other kind: a few large, very faint, soft puffs that
     hang briefly behind a fast hull or over a big impact.
     gl_PointCoord is Y-DOWN; the fragment flips into Y-up first. */
  const MAX = 4096;
  function budget() { return Math.max(0, (CBZ.qScale ? CBZ.qScale(900, MAX) : 2400) | 0); }
  const DROP_SIZE = 0.035;         // m: the size a requested bead is broken into
  const DROP_SPLIT_MAX = 10;       // most pieces one requested bead becomes
  const DROP_MIN_PX = 1.4;         // pixel floor: far spray is fine grain, not blobs
  const KIND_DROP = 0, KIND_MIST = 1, KIND_PUFF = 2;

  let points = null, geo = null, mat = null;
  let pos = null, aSize = null, aAlpha = null, aVel = null, aKind = null;
  let vel = null, life = null, maxLife = null, grow = null, size0 = null, alpha0 = null, base = null;
  let count = 0;

  function buildPoints() {
    if (points || typeof document === "undefined" || !CBZ.scene) return;
    pos = new Float32Array(MAX * 3);
    aSize = new Float32Array(MAX);
    aAlpha = new Float32Array(MAX);
    aVel = new Float32Array(MAX * 3);
    aKind = new Float32Array(MAX);
    vel = new Float32Array(MAX * 3);
    life = new Float32Array(MAX);
    maxLife = new Float32Array(MAX);
    grow = new Float32Array(MAX);
    size0 = new Float32Array(MAX);
    alpha0 = new Float32Array(MAX);
    base = new Float32Array(MAX);

    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aVel", new THREE.BufferAttribute(aVel, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    mat = new THREE.ShaderMaterial({
      name: "CBZ Water Spray",
      uniforms: {
        uLit: { value: new THREE.Color(0xd8e2e6) },    // sunlit water (set per frame)
        uShade: { value: new THREE.Color(0x52666f) },  // the side away from the sun
        uPix: { value: 600 },
        uAspect: { value: 1.7 },
        uHalfH: { value: 360 },      // half the drawing buffer height, px
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aSize;",
        "attribute float aAlpha;",
        "attribute vec3 aVel;",
        "attribute float aKind;",
        "uniform float uPix;",
        "uniform float uAspect;",
        "uniform float uHalfH;",
        "varying float vAlpha;",
        "varying float vAng;",
        "varying float vStretch;",
        "varying float vKind;",
        "varying float vFar;",
        "void main() {",
        "  vAlpha = aAlpha; vKind = aKind;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  vec4 clip = projectionMatrix * mv;",
        "  gl_Position = clip;",
        // the screen-space direction of travel: a fast drop is drawn as a
        // short streak along it (motion blur of a few centimetres)
        "  vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.015, 1.0));",
        "  vec2 s0 = clip.xy / max(1e-4, abs(clip.w));",
        "  vec2 s1 = c2.xy / max(1e-4, abs(c2.w));",
        "  vec2 d = (s1 - s0) * vec2(uAspect, 1.0);",
        "  float dl = length(d);",
        "  vAng = dl > 1e-5 ? atan(d.y, d.x) : 0.0;",
        "  float px = aSize * uPix / max(0.35, -mv.z);",
        "  vStretch = aKind > 0.5 ? 1.0 : clamp(1.0 + dl * uHalfH / max(1.0, px), 1.0, 3.0);",
        // a drop smaller than the pixel floor still draws at the floor, but
        // fainter, so far spray is a fine haze of grain, not a field of dots
        "  vFar = aKind > 0.5 ? 1.0 : clamp(px / " + DROP_MIN_PX.toFixed(1) + ", 0.25, 1.0);",
        "  gl_PointSize = aKind > 0.5 ? clamp(px, 2.0, 420.0) : clamp(px * vStretch, " + DROP_MIN_PX.toFixed(1) + ", min(40.0, px * 3.0 + 3.0));",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uLit;",
        "uniform vec3 uShade;",
        "varying float vAlpha;",
        "varying float vAng;",
        "varying float vStretch;",
        "varying float vKind;",
        "varying float vFar;",
        "void main() {",
        "  vec2 pc = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);",
        "  if (vKind > 1.5) {",
        // a puff of aerated spray: dense white with a lumpy (cauliflower)
        // edge, lit from the sun's side, shaded underneath
        "    float r = length(pc) * 2.0;",
        "    float an = atan(pc.y, pc.x);",
        "    float lump = 0.82 + 0.10 * sin(an * 5.0 + vAng * 7.0) + 0.06 * sin(an * 11.0 - vAng * 3.0);",
        "    if (r > lump) discard;",
        "    float a = vAlpha * smoothstep(lump, lump * 0.62, r);",
        "    if (a < 0.01) discard;",
        "    float up = clamp(pc.y * 1.6 + 0.55, 0.0, 1.0);",
        "    gl_FragColor = vec4(mix(uShade, uLit, 0.30 + 0.70 * up), a);",
        "  } else if (vKind > 0.5) {",
        // mist: a soft, faint, lit puff
        "    float r = length(pc) * 2.0;",
        "    if (r > 1.0) discard;",
        "    float a = vAlpha * exp(-3.5 * r * r) * (1.0 - r);",
        "    if (a < 0.004) discard;",
        "    gl_FragColor = vec4(mix(uShade, uLit, 0.62), a);",
        "  } else {",
        "    float ca = cos(vAng), sa = sin(vAng);",
        "    float rx = pc.x * ca + pc.y * sa;",
        "    float ry = (-pc.x * sa + pc.y * ca) * vStretch;",
        "    float d = length(vec2(rx, ry)) * 2.0;",
        "    if (d > 1.0) discard;",
        "    float a = vAlpha * vFar * (1.0 - smoothstep(0.55, 1.0, d));",
        "    if (a < 0.01) discard;",
        // a drop is a tiny lens: lit on top, the sky/sea colour under it, a
        // small highlight toward the light
        "    float up = clamp(pc.y * 2.0 + 0.5, 0.0, 1.0);",
        "    vec3 col = uLit * (0.88 + 0.12 * up) + uLit * 0.35 * pow(max(0.0, 1.0 - d), 3.0);",
        "    gl_FragColor = vec4(col, min(1.0, a));",
        "  }",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}",
      ].join("\n"),
    });

    points = new THREE.Points(geo, mat);
    points.name = "world-water-spray";
    points.frustumCulled = false;
    points.renderOrder = 5;
    points.userData.dynamic = true;     // batch + farcull exempt
    points.userData.waterFx = true;
    points.visible = false;
    CBZ.scene.add(points);
  }

  // ---- distance: far spray costs less, it does not vanish -----------------
  // Full rate inside NEAR, thinned to a fifth by FADE, held there out to CUT.
  const FX_NEAR = 90, FX_FADE = 400, FX_CUT = 900, FX_FLOOR = 0.22;
  function visGain(x, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return 1;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > FX_CUT * FX_CUT) return 0;
    if (d2 <= FX_NEAR * FX_NEAR) return 1;
    const d = Math.sqrt(d2);
    return Math.max(FX_FLOOR, 1 - (d - FX_NEAR) / (FX_FADE - FX_NEAR) * (1 - FX_FLOOR));
  }
  function visPass(x, z) {
    const g = visGain(x, z);
    return g >= 1 || (g > 0 && fxRand() < g);
  }

  function put(x, y, z, vx, vy, vz, size, growPerSec, ttl, alpha, kind, sb) {
    const i = count++;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    aVel[i * 3] = vx; aVel[i * 3 + 1] = vy; aVel[i * 3 + 2] = vz;
    size0[i] = size; aSize[i] = size;
    grow[i] = growPerSec;
    life[i] = 0; maxLife[i] = ttl > 0 ? ttl : 0.5;
    alpha0[i] = alpha == null ? 1 : alpha;
    aAlpha[i] = alpha0[i];
    aKind[i] = kind;
    base[i] = sb;
  }

  // AIRBORNE water. A requested bead of `size` metres is broken into up to
  // DROP_SPLIT_MAX drops of ~DROP_SIZE with a little spread in speed and
  // direction (the same volume of water, at the grain real spray has).
  // Ballistic; dies under the live surface.
  function spawnDrop(x, y, z, vx, vy, vz, size, growPerSec, ttl, alpha) {
    if (!pos) return false;
    const cap = budget();
    if (count >= cap) return false;
    if (!visPass(x, z)) return false;
    const n = Math.max(1, Math.min(DROP_SPLIT_MAX, Math.round((size / DROP_SIZE) * (size / DROP_SIZE) * 0.25)));
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const ds = Math.min(size, DROP_SIZE * (0.7 + 0.6 * fxRand()));
    // the surface it will land on, read once (drops travel a few metres, a
    // hundredth of a swell): the per-frame landing test is then free
    const sb = surfY(x, z);
    for (let k = 0; k < n && count < cap; k++) {
      const j = k === 0 ? 0 : 0.10 + 0.12 * fxRand();
      const s = 0.8 + 0.4 * fxRand();
      put(x + (fxRand() - 0.5) * size, y + (fxRand() - 0.5) * size * 0.5, z + (fxRand() - 0.5) * size,
        vx * s + (fxRand() - 0.5) * sp * j, vy * s + (fxRand() - 0.5) * sp * j, vz * s + (fxRand() - 0.5) * sp * j,
        ds * (0.6 + 0.8 * fxRand()), 0, (ttl > 0 ? ttl : 0.5) * (0.8 + 0.4 * fxRand()), alpha == null ? 0.95 : Math.min(1, alpha), KIND_DROP, sb);
    }
    return true;
  }

  // A PUFF of aerated spray: the bulk of a big splash's column and wall. It
  // flies on the same ballistic law as a drop (with the drag a loose mass of
  // spray has), swells as it goes, and falls back into the sea.
  function spawnPuff(x, y, z, vx, vy, vz, size, ttl, alpha) {
    if (!pos || count >= budget()) return false;
    if (!visPass(x, z)) return false;
    put(x, y, z, vx, vy, vz, size, size * 0.35, ttl, alpha, KIND_PUFF, surfY(x, z) - size * 0.3);
    return true;
  }

  // MIST: a large, very faint soft puff that drifts and fades.
  function spawnMist(x, y, z, vx, vy, vz, size, ttl, alpha) {
    if (!pos || count >= budget()) return false;
    if (!visPass(x, z)) return false;
    put(x, y, z, vx, vy, vz, size, size * 0.6, ttl, alpha, KIND_MIST, -1e9);
    return true;
  }

  function killDrop(i) {
    const last = --count;
    if (i !== last) {
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = pos[last * 3 + k];
        vel[i * 3 + k] = vel[last * 3 + k];
        aVel[i * 3 + k] = aVel[last * 3 + k];
      }
      aSize[i] = aSize[last]; aAlpha[i] = aAlpha[last]; aKind[i] = aKind[last];
      life[i] = life[last]; maxLife[i] = maxLife[last]; grow[i] = grow[last];
      size0[i] = size0[last]; alpha0[i] = alpha0[last]; base[i] = base[last];
    }
  }

  // ============================================================
  //  C. THE CROWN SHEET — the wall of water an impact throws up
  // ============================================================
  /* A real entry throws a hollow SHEET of water: thin and clear low down,
     thickening into a rim at the top; the rim breaks into fingers, the
     fingers shed drops, and the whole thing falls back. The sheet is lit by
     the scene (sun on the face toward it, sky and sea in the shade, sea
     colour through the thin parts) and is mostly opaque; it tears open as it
     thins with age. The drops come off the rim as real droplets (the spray
     pool), so sheet and spray are one event. A body off a quay is a metre of
     it, a 25 GJ meteor a wall tens of metres high: the same numbers.
     Each slot is a ring strip whose base rides the live swell. */
  const CROWN_SLOTS = 8;
  const CROWN_SEG = 40;
  const CROWN_RINGS = 7;
  const CROWN_VERTS = CROWN_RINGS * (CROWN_SEG + 1);
  function crownBudget() {
    const n = CBZ.qScale ? CBZ.qScale(3, CROWN_SLOTS) : 6;
    return Math.max(0, Math.min(CROWN_SLOTS, n | 0));
  }

  let crownMesh = null, crownGeo = null, crownMat = null;
  let crownPos = null, crownA = null, crownSeed = null, crownN = null, crownAge = null;
  const crownSlot = [];
  let crownCount = 0;

  function buildCrown() {
    if (crownMesh || typeof document === "undefined" || !CBZ.scene || !CBZ.waterRippleTexture) return;
    const V = CROWN_SLOTS * CROWN_VERTS;
    crownPos = new Float32Array(V * 3);
    crownA = new Float32Array(V);
    crownSeed = new Float32Array(V);
    crownAge = new Float32Array(V);
    crownN = new Float32Array(V * 3);
    const uv = new Float32Array(V * 2);
    const idx = new Uint16Array(CROWN_SLOTS * (CROWN_RINGS - 1) * CROWN_SEG * 6);
    let w = 0;
    for (let s = 0; s < CROWN_SLOTS; s++) {
      const b = s * CROWN_VERTS;
      for (let j = 0; j < CROWN_RINGS; j++) {
        for (let k = 0; k <= CROWN_SEG; k++) {
          const v = (b + j * (CROWN_SEG + 1) + k) * 2;
          uv[v] = j / (CROWN_RINGS - 1);          // 0 base .. 1 rim
          uv[v + 1] = k / CROWN_SEG;              // around
        }
      }
      for (let j = 0; j < CROWN_RINGS - 1; j++) {
        for (let k = 0; k < CROWN_SEG; k++) {
          const a0 = b + j * (CROWN_SEG + 1) + k, a1 = a0 + 1;
          const c0 = a0 + (CROWN_SEG + 1), c1 = c0 + 1;
          idx[w++] = a0; idx[w++] = c0; idx[w++] = a1;
          idx[w++] = a1; idx[w++] = c0; idx[w++] = c1;
        }
      }
      crownSlot.push({ live: false, x: 0, z: 0, r0: 1, gr: 1, h: 2, age: 0, ttl: 1, a0: 1, seed: 0, shed: 0, mist: false, dirty: false });
    }
    crownGeo = new THREE.BufferGeometry();
    crownGeo.setAttribute("position", new THREE.BufferAttribute(crownPos, 3).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    crownGeo.setAttribute("aA", new THREE.BufferAttribute(crownA, 1).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("aSeed", new THREE.BufferAttribute(crownSeed, 1).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("aAge", new THREE.BufferAttribute(crownAge, 1).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("normal", new THREE.BufferAttribute(crownN, 3).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    crownGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    crownMat = new THREE.ShaderMaterial({
      name: "CBZ Water Crown",
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uMap: { value: CBZ.waterRippleTexture() },
        uLit: { value: new THREE.Color(0xd8e2e6) },     // sunlit (set per frame)
        uShade: { value: new THREE.Color(0x52666f) },   // away from the sun
        uSea: { value: new THREE.Color(0x1f5a66) },     // seen through a thin film
        uSun: { value: new THREE.Vector3(-0.34, 0.84, 0.42).normalize() },
      }),
      fog: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aA;",
        "attribute float aSeed;",
        "attribute float aAge;",
        "varying float vA;",
        "varying float vSeed;",
        "varying float vAge;",
        "varying vec2 vUvC;",
        "varying vec3 vN;",
        "varying vec3 vV;",
        "#include <fog_pars_vertex>",
        "void main() {",
        "  vA = aA; vSeed = aSeed; vAge = aAge; vUvC = uv;",
        "  vN = normal;",
        "  vV = cameraPosition - position;",
        "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * mvPosition;",
        "  #include <fog_vertex>",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uLit;",
        "uniform vec3 uShade;",
        "uniform vec3 uSea;",
        "uniform vec3 uSun;",
        "varying float vA;",
        "varying float vSeed;",
        "varying float vAge;",
        "varying vec2 vUvC;",
        "varying vec3 vN;",
        "varying vec3 vV;",
        "#include <fog_pars_fragment>",
        "void main() {",
        "  if (vA < 0.004) discard;",
        "  float u = clamp(vUvC.x, 0.0, 1.0);",          // 0 base .. 1 rim
        "  float ar = vUvC.y;",                          // around
        // the rim's top edge: ragged, with fingers standing out of it
        "  float n1 = texture2D(uMap, vec2(ar * 3.0 + vSeed, 0.31 + vSeed * 0.17)).r;",
        "  float n2 = texture2D(uMap, vec2(ar * 9.0 - vSeed * 0.7, 0.57)).g;",
        "  float n3 = texture2D(uMap, vec2(ar * 21.0 + vSeed * 1.3, 0.83)).b;",
        "  float edge = 0.80 + 0.10 * n1;",
        "  float finger = smoothstep(0.58, 0.72, n2) * smoothstep(0.45, 0.60, n3);",
        "  float top = mix(edge, 1.0, finger);",
        "  if (u > top) discard;",
        // the fingers are narrow: between them only the rim band survives
        "  if (u > edge && finger < 0.5) discard;",
        // TORN FROM THE FIRST FRAME: thrown water is aerated and full of holes
        // everywhere, at two scales, and opens up further as it ages. Where
        // it is there it is white and opaque; where it is thin it is gone
        // (no glassy film over large areas).
        "  float hole = texture2D(uMap, vec2(ar * 5.0 + vSeed * 0.4, u * 1.4 + vSeed)).r * 0.6",
        "             + texture2D(uMap, vec2(ar * 17.0 - vSeed, u * 4.1 + vSeed * 0.3)).g * 0.4;",
        "  float tear = 0.30 + 0.18 * u + vAge * vAge * 0.55;",
        "  if (hole < tear) discard;",
        "  float rim = smoothstep(edge - 0.16, edge - 0.02, u);",
        "  float body = smoothstep(tear, tear + 0.08, hole);",   // a hard, ragged edge to every hole
        "  float a = vA * (0.75 + 0.25 * rim) * body;",
        "  a *= smoothstep(0.0, 0.08, u);",              // the foot merges with the water
        "  if (a < 0.05) discard;",
        "  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);",
        "  float lam = clamp(dot(N, uSun) * 0.5 + 0.5, 0.0, 1.0);",
        "  vec3 lit = mix(uShade, uLit, 0.25 + 0.75 * lam);",
        // aerated white water, lit; a hint of the sea in its shadowed folds
        "  vec3 col = mix(uSea * 0.8 + uShade * 0.6, lit, 0.78 + 0.22 * rim);",
        "  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "  #include <fog_fragment>",
        "}",
      ].join("\n"),
    });
    crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.name = "world-water-crown";
    crownMesh.frustumCulled = false;
    crownMesh.renderOrder = 4;
    crownMesh.userData.dynamic = true;
    crownMesh.userData.waterFx = true;
    crownMesh.visible = false;
    CBZ.scene.add(crownMesh);
  }

  function crownCollapse(s) {
    const b = s * CROWN_VERTS;
    for (let k = 0; k < CROWN_VERTS; k++) {
      const v = b + k;
      crownPos[v * 3] = 0; crownPos[v * 3 + 1] = -9999; crownPos[v * 3 + 2] = 0;
      crownA[v] = 0;
    }
  }

  // PUBLIC: throw a sheet of water up out of the surface at (x,z).
  //   r      base radius of the sheet, metres
  //   grow   radial growth per second
  //   h      peak height of the rim, metres
  //   ttl    seconds; it rises through ~a third of it and falls back
  //   alpha  peak opacity
  CBZ.waterCrown = function (o) {
    if (!o || !fxOn()) return false;
    buildCrown();
    if (!crownPos) return false;
    // a sheet you are standing inside is not drawn (it would fill the lens);
    // its drops still fly
    const cam = CBZ.camera;
    const r0 = Math.max(0.12, +o.r || 0.5);
    const h = Math.max(0.2, +o.h || 1.5);
    if (cam && cam.position) {
      const dx = cam.position.x - (+o.x || 0), dz = cam.position.z - (+o.z || 0);
      const d2 = dx * dx + dz * dz;
      const cut = Math.max(FX_CUT, h * 40);       // a tall column is seen from far
      if (d2 > cut * cut) return false;
      const foot = r0 * 1.62 + 0.6;
      if (d2 < foot * foot &&
          cam.position.y < surfY(+o.x || 0, +o.z || 0) + h) return false;
    }
    const cap = crownBudget();
    let slot = -1;
    for (let s = 0; s < cap; s++) if (!crownSlot[s].live) { slot = s; break; }
    if (slot < 0) {
      // a bigger splash outranks a smaller one that is already fading
      let worst = -1, worstScore = 1e9;
      for (let s = 0; s < cap; s++) {
        const c = crownSlot[s];
        const score = c.h * (1 - c.age / c.ttl);
        if (score < worstScore) { worstScore = score; worst = s; }
      }
      if (worst < 0 || worstScore >= h * 0.6) return false;
      slot = worst;
      crownCount--;
    }
    const sl = crownSlot[slot];
    sl.live = true; sl.dirty = true;
    sl.x = +o.x || 0; sl.z = +o.z || 0;
    sl.r0 = r0;
    sl.gr = Number.isFinite(+o.grow) ? +o.grow : sl.r0 * 0.9;
    sl.h = h;
    sl.age = 0; sl.ttl = (+o.ttl > 0) ? +o.ttl : 0.9;
    sl.a0 = o.alpha == null ? 0.9 : Math.min(1, +o.alpha + 0.2);
    sl.seed = fxRand() * 10;
    sl.shed = 0; sl.mist = false;
    crownCount++;
    return true;
  };

  /* CBZ.waterThrow(o): THE WATER AN IMPACT THROWS UP, from one size.
       o.x, o.z   where;  o.R  the cavity radius (m), the energy law's number
       o.h        rim height (default ~2R + 0.3: 1.5 m for a person off 14 m)
       o.hx, o.hz the horizontal velocity it arrived with (leans it downrange)
       o.column   a narrow tall column instead of a wall (a meteor's centre)
     It is mostly DROPS (streams on ballistic arcs at the speed that height
     needs), a short-lived torn sheet as the core, and for anything from a car
     up, many overlapping puffs of aerated spray riding the same law: rise,
     hang, fall back as rain. Small things are drops and a brief sheet; big
     things are a turbulent white mass with the sheet only faint inside it. */
  const G_THROW = 9.81;
  CBZ.waterThrow = function (o) {
    if (!o || !fxOn()) return false;
    build();
    const x = +o.x || 0, z = +o.z || 0;
    const R = Math.max(0.05, +o.R || 0.5);
    const col = !!o.column;
    const h = Math.max(0.2, +o.h > 0 ? +o.h : (col ? 4 * R + 2 : 2.2 * R));
    const v0 = Math.sqrt(2 * G_THROW * h);
    const tUp = v0 / G_THROW;
    const hx = +o.hx || 0, hz = +o.hz || 0, hs = Math.hypot(hx, hz);
    const lean = hs > 0.5 ? Math.min(0.8, hs / (8 + R * 3)) : 0;
    const bx = hs > 0.5 ? hx / hs : 0, bz = hs > 0.5 ? hz / hs : 0;
    const cx = x + bx * R * lean, cz = z + bz * R * lean;
    const sy = surfY(cx, cz);
    const big = R >= 1;
    const foot = col ? R * 0.35 : R;
    // the sheet: torn from its first frame, gone in about its own flight time
    if (CBZ.waterCrown) {
      CBZ.waterCrown({ x: cx, z: cz, r: Math.max(0.15, foot * 0.45), grow: foot * 0.5 / Math.max(0.3, tUp),
        h: h, ttl: 2 * tUp * 0.9, alpha: big ? 0.3 : 0.85 });
    }
    if (!pos) return true;
    // droplet streams off the cavity's rim
    const free = Math.max(0, budget() - count);
    const nD = Math.min(Math.round(free * 0.3 / 4), Math.round(12 + 40 * Math.min(R, 6)));
    for (let i = 0; i < nD; i++) {
      const a = fxRand() * Math.PI * 2, r = foot * (0.3 + 0.7 * fxRand());
      const tilt = (col ? 0.05 : 0.15) + fxRand() * (col ? 0.25 : 0.55);
      const v = v0 * (0.55 + 0.6 * fxRand());
      const ca = Math.cos(a), sa = Math.sin(a);
      spawnDrop(cx + ca * r, sy + 0.05, cz + sa * r,
        ca * v * Math.sin(tilt) + bx * hs * lean * 0.4, v * Math.cos(tilt), sa * v * Math.sin(tilt) + bz * hs * lean * 0.4,
        0.06 + fxRand() * 0.07, 0, 2 * v / G_THROW + 0.4, 0.95);
    }
    // the white mass of a big splash: overlapping puffs of aerated spray
    if (big) {
      const nP = Math.min(Math.round(free * 0.12), Math.round(10 + 7 * Math.min(R, 22)));
      const sz = Math.min(16, 0.45 * foot + 0.3);
      for (let i = 0; i < nP; i++) {
        const a = fxRand() * Math.PI * 2, r = foot * Math.sqrt(fxRand()) * 0.8;
        const tilt = fxRand() * (col ? 0.18 : 0.45);
        const v = v0 * (0.35 + 0.7 * fxRand());
        const ca = Math.cos(a), sa = Math.sin(a);
        spawnPuff(cx + ca * r, sy + sz * 0.3, cz + sa * r,
          ca * v * Math.sin(tilt), v * Math.cos(tilt), sa * v * Math.sin(tilt),
          sz * (0.6 + 0.8 * fxRand()), 2 * v / G_THROW + 1.2, 0.7 + 0.25 * fxRand());
      }
    }
    return true;
  };

  // The scene's light on thrown water: the sun's direction and tint, the
  // day's level, and the sea colour a thin film shows. One read per frame,
  // shared by the sheet and the drops.
  const _sunV = new THREE.Vector3();
  const _lit = new THREE.Color(), _shade = new THREE.Color(), _sea = new THREE.Color(0x1f5a66);
  function sceneLight() {
    const day = CBZ.dayness == null ? 1 : Math.max(0.10, Math.min(1, +CBZ.dayness));
    _lit.setRGB(0.80 * day + 0.03, 0.86 * day + 0.03, 0.88 * day + 0.04);
    if (CBZ.sunTint) _lit.multiply(CBZ.sunTint);
    // the side of thrown water away from the sun still sees the bright sky:
    // light grey, never the sea's body colour
    _shade.copy(_lit).multiplyScalar(0.72);
    _sea.setRGB(0.10 * day + 0.01, 0.30 * day + 0.02, 0.34 * day + 0.03);
    const sunT = CBZ.sunTarget || (CBZ.sun && CBZ.sun.target) || null;
    if (CBZ.sun && sunT) {
      _sunV.copy(CBZ.sun.position).sub(sunT.position);
      if (_sunV.lengthSq() > 1e-6) _sunV.normalize(); else _sunV.set(-0.34, 0.84, 0.42).normalize();
    } else _sunV.set(-0.34, 0.84, 0.42).normalize();
    if (crownMat) {
      const u = crownMat.uniforms;
      u.uLit.value.copy(_lit); u.uShade.value.copy(_shade); u.uSea.value.copy(_sea); u.uSun.value.copy(_sunV);
    }
    if (mat) { mat.uniforms.uLit.value.copy(_lit); mat.uniforms.uShade.value.copy(_shade); }
  }

  function crownTick(dt) {
    if (!crownMesh || !crownPos) return;
    impRefresh();
    const cap = crownBudget();
    let any = false, touched = false;
    for (let s = 0; s < crownSlot.length; s++) {
      const sl = crownSlot[s];
      if (s >= cap || !sl.live) {
        if (sl.live) { sl.live = false; crownCount--; }
        if (sl.dirty) { crownCollapse(s); sl.dirty = false; touched = true; }
        continue;
      }
      sl.age += dt;
      const t = sl.age / sl.ttl;
      if (t >= 1) { sl.live = false; crownCount--; crownCollapse(s); sl.dirty = false; touched = true; continue; }
      const r = sl.r0 + sl.gr * sl.age;
      // up fast, down slow: the rim peaks about a third of the way through
      const rise = Math.sin(Math.PI * Math.pow(t, 0.62));
      const hh = sl.h * rise;
      const fade = Math.min(1, t * 16) * (1 - Math.pow(t, 3));
      const b = s * CROWN_VERTS;
      const impT = impLive ? impNow : null;
      const cy0 = surfY(sl.x, sl.z) - (impT !== null ? impH(sl.x, sl.z, impT) : 0);
      const gx = (surfY(sl.x + 2, sl.z) - (impT !== null ? impH(sl.x + 2, sl.z, impT) : 0) - cy0) * 0.5;
      const gz = (surfY(sl.x, sl.z + 2) - (impT !== null ? impH(sl.x, sl.z + 2, impT) : 0) - cy0) * 0.5;
      // the lip curls outward and over as the sheet tops out and falls
      const curl = Math.min(1, t * 1.6);
      for (let k = 0; k <= CROWN_SEG; k++) {
        const ang = (k / CROWN_SEG) * Math.PI * 2;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        let by = cy0 + Math.max(-1.2, Math.min(1.2, gx * cs * r + gz * sn * r));
        if (impT !== null) by += impH(sl.x + cs * r, sl.z + sn * r, impT);
        // the rim is not level all the way round
        const wob = Math.max(0.4, 0.78 + 0.22 * Math.sin(ang * 3 + sl.seed * 6.1) +
          0.12 * Math.sin(ang * 7 - sl.seed * 3.3));
        const hAng = hh * wob;
        for (let j = 0; j < CROWN_RINGS; j++) {
          const fj = j / (CROWN_RINGS - 1);
          // a sheet that leans out and flares toward its lip
          let rr = r * (1 + 0.45 * fj + 0.55 * fj * fj * fj);
          let yy = by + 0.04 + hAng * Math.pow(fj, 0.85);
          if (j === CROWN_RINGS - 1) { rr += r * 0.18 * curl + hh * 0.06; yy -= hAng * 0.06 * curl; }
          const v = b + j * (CROWN_SEG + 1) + k;
          crownPos[v * 3] = sl.x + cs * rr;
          crownPos[v * 3 + 1] = yy;
          crownPos[v * 3 + 2] = sl.z + sn * rr;
          crownA[v] = sl.a0 * fade;
          crownSeed[v] = sl.seed;
          crownAge[v] = t;
        }
        for (let j = 0; j < CROWN_RINGS; j++) {
          const v = b + j * (CROWN_SEG + 1) + k;
          const vA = b + Math.max(0, j - 1) * (CROWN_SEG + 1) + k;
          const vB = b + Math.min(CROWN_RINGS - 1, j + 1) * (CROWN_SEG + 1) + k;
          const ux = crownPos[vB * 3] - crownPos[vA * 3];
          const uy = crownPos[vB * 3 + 1] - crownPos[vA * 3 + 1];
          const uz = crownPos[vB * 3 + 2] - crownPos[vA * 3 + 2];
          let nx = uy * cs, ny = -uz * sn - ux * cs, nz = uy * sn;
          if (nx * cs + nz * sn < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const inv = 1 / Math.max(1e-6, Math.sqrt(nx * nx + ny * ny + nz * nz));
          crownN[v * 3] = nx * inv; crownN[v * 3 + 1] = ny * inv; crownN[v * 3 + 2] = nz * inv;
        }
      }
      // THE RIM BREAKS INTO DROPS: from the time the sheet is up until it
      // falls, the rim sheds droplets outward and up at the speed it is
      // moving, at a rate that scales with the rim's length and height
      if (t > 0.15 && t < 0.85 && pos) {
        const rate = Math.min(500, 30 * (r + 0.5) * (sl.h + 0.5)) * (CBZ.qScale ? CBZ.qScale(0.35, 1) : 1);
        sl.shed += rate * dt;
        let n = sl.shed | 0;
        sl.shed -= n;
        if (n > 40) n = 40;
        const vRise = (sl.h / Math.max(0.1, sl.ttl)) * (t < 0.33 ? 2.2 : 0.6);
        for (let i = 0; i < n; i++) {
          const ang = fxRand() * Math.PI * 2;
          const cs = Math.cos(ang), sn = Math.sin(ang);
          const rr = r * (1.9 + 0.2 * fxRand());
          const out = sl.gr * 1.2 + 0.8 + fxRand() * (1.5 + sl.h * 0.25);
          spawnDrop(sl.x + cs * rr, cy0 + hh * (0.85 + 0.15 * fxRand()), sl.z + sn * rr,
            cs * out, vRise * (0.5 + fxRand()), sn * out,
            0.05 + fxRand() * 0.04 * Math.min(4, sl.h), 0, 0.6 + sl.h * 0.12 + fxRand() * 0.5, 0.95);
        }
      }
      // a big sheet coming down leaves a brief mist hanging over the water
      if (!sl.mist && t > 0.55 && sl.h > 3 && pos) {
        sl.mist = true;
        const m = Math.min(14, 3 + (sl.h / 3) | 0);
        for (let i = 0; i < m; i++) {
          const ang = fxRand() * Math.PI * 2, rr = r * (1 + fxRand());
          spawnMist(sl.x + Math.cos(ang) * rr, cy0 + sl.h * (0.15 + 0.3 * fxRand()), sl.z + Math.sin(ang) * rr,
            Math.cos(ang) * 0.6, 0.2 + fxRand() * 0.4, Math.sin(ang) * 0.6,
            Math.max(1, r * 0.8 + sl.h * 0.25), 2.5 + fxRand() * 2, 0.10);
        }
      }
      sl.dirty = true;
      touched = true;
      any = true;
    }
    crownMesh.visible = any;
    if (touched) {
      crownGeo.attributes.position.needsUpdate = true;
      crownGeo.attributes.aA.needsUpdate = true;
      crownGeo.attributes.aSeed.needsUpdate = true;
      crownGeo.attributes.aAge.needsUpdate = true;
      crownGeo.attributes.normal.needsUpdate = true;
    }
  }

  function crownClearAll() {
    if (!crownPos) return;
    for (let s = 0; s < crownSlot.length; s++) { crownSlot[s].live = false; crownSlot[s].dirty = false; crownCollapse(s); }
    crownCount = 0;
    if (crownMesh) crownMesh.visible = false;
  }

  // Not latched on failure: a call before CBZ.scene exists retries later.
  function build() {
    if (!fxOn()) return;
    buildPoints();
    buildCrown();
  }

  // ============================================================
  //  THE FIELD ADAPTERS — surface marks become field stamps
  // ============================================================
  // A ring (a crest travelling out) is a displacement the field turns into
  // real rings; a wash (white water standing where something went in) is
  // slow foam. `dia` is the mark's starting diameter.
  function fieldRing(x, z, dia, alpha) {
    if (!CBZ.waterWakeStamp) return false;
    const r = Math.max(0.12, dia * 0.5);
    const a = alpha == null ? 0.7 : alpha;
    return CBZ.waterWakeStamp({ x: x, z: z, r: r, amp: Math.min(0.5, 0.012 + 0.05 * r * a), ff: 0.35 * a, fs: 0 });
  }
  function fieldWash(x, z, dia, alpha) {
    if (!CBZ.waterWakeStamp) return false;
    const a = alpha == null ? 0.6 : alpha;
    return CBZ.waterWakeStamp({ x: x, z: z, r: Math.max(0.2, dia * 0.5), amp: 0, ff: 0.2 * a, fs: Math.min(1, 0.9 * a), ring: false });
  }

  // ============================================================
  //  THE PUBLIC PRIMITIVES
  // ============================================================
  // One particle, fully specified (water_impact.js builds its vocabularies
  // from this). Airborne unless `ride`: a riding mark goes into the field —
  // `ring` as a travelling crest, otherwise as a patch of foam.
  //   x,y,z  vx,vy,vz  size (start diameter, m)  grow (m/s)  ttl (s)
  //   ring  ride  alpha
  CBZ.waterEmit = function (o) {
    if (!o || !fxOn()) return false;
    const x = +o.x || 0, z = +o.z || 0;
    const size = o.size > 0 ? +o.size : 0.14;
    const alpha = o.alpha == null ? 1 : +o.alpha;
    if (o.ride || o.ring) {
      // the field spreads a ring by itself; a mark that was authored to grow
      // large over its life is a bigger disturbance at birth
      const grow = Number.isFinite(o.grow) ? Math.max(0, +o.grow) : 0;
      const ttl = o.ttl > 0 ? +o.ttl : 0.6;
      const dia = size + grow * ttl * 0.35;
      return o.ring ? fieldRing(x, z, dia, alpha) : fieldWash(x, z, dia, alpha);
    }
    build();
    return spawnDrop(x, +o.y || 0, z, +o.vx || 0, +o.vy || 0, +o.vz || 0,
      size, Number.isFinite(o.grow) ? +o.grow : 0, o.ttl > 0 ? +o.ttl : 0.6, alpha);
  };

  // Surface marks never run out now (the field holds them all); kept for the
  // callers that size their bursts against it.
  CBZ.waterFoamFree = function () { return fxOn() ? 999 : 0; };
  CBZ.waterEmitFree = function () {
    if (!fxOn()) return 0;
    build();
    if (!pos) return 0;
    return Math.max(0, budget() - count);
  };

  // The legacy strength dial (0.15 person-ish .. 9 a falling megalodon),
  // translated into what the one door actually reads: a body's mass and
  // speed. Mass ~ the square of the dial (1 = a 78 kg person at 5.4 m/s).
  CBZ.waterSplashAt = function (x, y, z, strength) {
    if (!fxOn() || !CBZ.waterHit) return false;
    const s = Math.max(0.15, Math.min(9, +strength || 1));
    try {
      return !!CBZ.waterHit(x, y, z, { kind: "body", mass: 78 * s * s, speed: 3 + s * 2.4 });
    } catch (e) { return false; }
  };

  // A small ring (a stroke, a paddle blade, a drip).
  CBZ.waterRippleAt = function (x, z, size) {
    if (!fxOn()) return;
    fieldRing(x, z, size > 0 ? size : 0.35, 0.7);
  };

  // ============================================================
  //  CBZ.waterWakeFor — the hook
  // ============================================================
  function fin(v) { return Number.isFinite(v) ? +v : null; }
  function pickPos(a, b, c, d) {
    if (a > 0 && Number.isFinite(a)) return +a;
    if (b > 0 && Number.isFinite(b)) return +b;
    if (c > 0 && Number.isFinite(c)) return +c;
    return +d;
  }
  // v_hull = sqrt(L g / 2pi): the honest scale for "how fast is fast" at
  // any length.
  function hullSpeed(loa) { return Math.sqrt(Math.max(1, loa) * 9.81 / 6.2831853); }
  const MIN_WAKE_SPD = 0.3;

  const _st = {
    x: 0, z: 0, sx: 0, sz: 0, h: 0, fx: 0, fz: 1, rx: 1, rz: 0,
    spd: 0, vSign: 0, planing: 0, steer: 0, trim: 0, churn: 0,
    loa: 6.2, beam: 2.1, draft: 0.5, massT: 1.6, scale: 1, planeMs: 6,
    kind: "boat", engine: true, dg: 1,
  };
  function frameStamp() {
    const n = CBZ.now;
    return Number.isFinite(n) ? n : frameSeq;
  }
  let frameSeq = 0;

  function resolve(obj, opts, dt) {
    const st = _st;
    const p = (obj && (obj.pos || obj.position)) || null;
    const ox = opts ? fin(opts.x) : null, oz = opts ? fin(opts.z) : null;
    st.x = ox != null ? ox : (p ? +p.x : NaN);
    st.z = oz != null ? oz : (p ? +p.z : NaN);
    if (!Number.isFinite(st.x) || !Number.isFinite(st.z)) return null;
    const hs = (obj && obj._hullSpec) || null;
    const dims = (obj && obj.dims) || null;
    st.kind = (opts && opts.kind) || "boat";
    st.loa = pickPos(opts && opts.loa, hs && hs.loa, dims && dims.length, 6.2);
    st.beam = pickPos(opts && opts.beam, hs && hs.beam, dims && dims.width, 2.1);
    st.draft = pickPos(opts && opts.draft, hs && hs.draft, null, Math.max(0.1, st.beam * 0.22));
    // a hull with no declared tonnage displaces its own block
    st.massT = pickPos(opts && opts.massT, hs && hs.massT, null, st.loa * st.beam * st.draft * 0.45 * 1.025);
    st.scale = Math.max(0.15, Math.min(2.2, pickPos(opts && opts.scale, hs && hs.wakeScale, null, 1)));
    st.engine = st.kind === "boat" ? !(hs && hs.engine === false) : false;

    let vs = opts ? fin(opts.speed) : null;
    if (vs == null) vs = fin(obj && obj.v);
    const vx = +(obj && obj.vx) || 0, vz = +(obj && obj.vz) || 0;
    if (vs == null) vs = Math.sqrt(vx * vx + vz * vz);
    st.vSign = vs; st.spd = Math.abs(vs);
    let h = opts ? fin(opts.heading) : null;
    if (h == null) h = fin(obj && obj.heading);
    if (h == null) h = (vx * vx + vz * vz) > 1e-6 ? Math.atan2(vx, vz) : 0;
    // astern, the wake leaves off the bow end: the source runs backwards
    st.h = h; st.fx = Math.sin(h); st.fz = Math.cos(h);
    st.rx = st.fz; st.rz = -st.fx;
    st.sx = st.x - st.fx * st.loa * 0.48;
    st.sz = st.z - st.fz * st.loa * 0.48;

    st.planeMs = pickPos(opts && opts.planeMs, hs && hs.planeMs, null, 1.9 * hullSpeed(st.loa));
    let pl = fin(obj && obj._planing);
    if (pl == null && opts) pl = fin(opts.planing);
    if (pl == null) {
      const a = st.planeMs * 0.80, b = st.planeMs * 1.25;
      pl = clamp01((st.spd - a) / Math.max(1e-3, b - a));
      pl = pl * pl * (3 - 2 * pl);
    }
    st.planing = st.vSign < 0 ? 0 : clamp01(pl);
    let sIn = fin(obj && obj._steerInput);
    if (sIn == null && opts) sIn = fin(opts.steer);
    st.steer = sIn == null ? 0 : Math.max(-1, Math.min(1, sIn));
    const tr = fin(obj && obj._trim);
    st.trim = tr == null ? 0 : tr;

    // throttle: published if the helm has it, recovered from acceleration if not
    let thr = fin(obj && obj._throttle);
    if (thr != null) thr = clamp01(Math.abs(thr));
    else {
      const prev = Number.isFinite(obj._wakePrevV) ? obj._wakePrevV : st.spd;
      const dv = (st.spd - prev) / Math.max(1e-3, dt);
      obj._wakePrevV = st.spd;
      thr = clamp01(dv / 5);
      if (st.vSign < -1.2) thr = Math.max(thr, 0.8);
      if (st.spd > 0.5) thr = Math.max(thr, 0.25 + 0.5 * Math.min(1, st.spd / Math.max(1, st.planeMs)));
    }
    if (!st.engine) thr = 0;
    const sm = Math.min(1, dt * 6);
    obj._wakeThr = (obj._wakeThr == null ? thr : obj._wakeThr + (thr - obj._wakeThr) * sm);
    st.churn = obj._wakeThr;

    // spray thins with camera distance (it costs less far away, it does not
    // vanish); the field and the twin do not read this
    const cam = CBZ.camera;
    let camD = 0;
    if (cam) { const cx = st.x - cam.position.x, cz = st.z - cam.position.z; camD = Math.sqrt(cx * cx + cz * cz); }
    st.dg = camD <= 90 ? 1 : Math.max(0.22, 1 - (camD - 90) / 400);
    if (camD > 900) st.dg = 0;
    if (st.dg > 0 && CBZ.qScale) st.dg *= CBZ.qScale(0.45, 1);
    return st;
  }

  /* THE WAKE'S SIZE, as the field displacement a hull pushes along. It grows
     with speed against the hull's own wave speed (squared below it: a slow
     hull makes almost nothing) and with draft (how deep it pushes), and
     falls as a planing hull lifts out. Sized with a CPU mirror of the field
     step so the diverging waves carry a visible slope (0.3 m texels):
       runabout 13.6 m/s: dep 0.43 -> slope ~0.12 one length astern, ~0.25 at
                          three, ~0.16 at ten; crest ~0.1 m
       cruiser 7.3 m/s:   dep 0.54 -> slope ~0.23 at one length, ~0.05 at ten;
                          crest ~0.27 m
       PWC 15 m/s:        dep 0.34 -> slope ~0.08-0.19
       kayak 1.8 m/s:     dep ~0.1 (slower than the field's waves: rings, no V) */
  function wakeDep(st) {
    let f = Math.min(1.2, st.spd / Math.max(0.5, 0.4 * Math.sqrt(9.81 * st.loa)));
    if (f < 1) f *= f;
    return Math.min(0.8, 0.45 * f * (1 - 0.2 * st.planing) * Math.min(1, Math.sqrt(st.draft / 0.5)));
  }
  // the crest the CPU twin rings with (what another hull or a swimmer feels)
  function wakeAmp(st) { return 0.45 * wakeDep(st); }

  // Per-object scratch allocated once (never per frame).
  function acc(obj) {
    let a = obj._wakeAcc;
    if (!a) a = obj._wakeAcc = { spray: 0, roost: 0, blade: 0, side: 1 };
    return a;
  }
  const _src = { x: 0, z: 0, fx: 0, fz: 1, hl: 1, hb: 1, dep: 0, ff: 0, fs: 0, rim: false, ox: 0, oz: 0, key: 0 };

  function fieldHull(obj, st, A, dt) {
    if (!CBZ.waterWakeSource) return;
    const vN = Math.min(1.6, st.spd / st.planeMs);
    const dir = st.vSign < -0.05 ? -1 : 1;
    const moving = clamp01((st.spd - 1.2) / 2.5);
    // 1. THE HULL pushes water aside over its own waterplane. No foam: the
    //    displacement makes waves, and only waves that get steep enough
    //    break white (the field does that itself). A planing hull is lifted
    //    onto its after third, so its footprint shortens and moves aft.
    _src.x = st.x; _src.z = st.z; _src.fx = st.fx * dir; _src.fz = st.fz * dir;
    _src.hl = st.loa * (0.44 - 0.16 * st.planing); _src.hb = st.beam * 0.44;
    _src.ox = -st.loa * 0.14 * st.planing * dir; _src.oz = 0;
    _src.dep = wakeDep(st);
    _src.ff = 0; _src.fs = 0; _src.rim = false; _src.key = 0;
    CBZ.waterWakeSource(obj, _src);
    // 2. THE BOW CURL AND THE CHINES: a thin line of broken water along the
    //    forward sides where the bow wave breaks over (displacement), or along
    //    the chines where a planing hull throws its sheet.
    const curl = st.scale * moving * (0.35 * Math.min(1, vN * vN) * (1 - st.planing) + 0.6 * st.planing);
    if (curl > 0.02) {
      _src.ox = st.loa * (0.24 - 0.3 * st.planing) * dir; _src.oz = 0;
      _src.hl = st.loa * 0.2; _src.hb = st.beam * 0.5;
      _src.dep = 0; _src.ff = curl; _src.fs = 0; _src.rim = true; _src.key = 2;
      CBZ.waterWakeSource(obj, _src);
    }
    // 3. THE WASH ASTERN: aerated water off the transom and the drive, a
    //    little wider than the stern. Bright at the transom (fast foam, gone
    //    in two or three lengths), with a pale aerated track about one beam
    //    wide that lingers (slow foam). A paddled hull has no drive.
    //    Coverage at a point ~ rate * 1.19 * hl / v, so the rate carries v:
    //    the transom reads ~1, a planing track ~0.5.
    const churn = st.engine ? st.churn : 0;
    const hlW = Math.max(0.5, st.loa * 0.10 + st.spd * 0.06);
    const wash = st.engine ? st.scale * (2.4 + 3 * churn) * Math.min(1, 0.3 + vN) : 0.03 * vN;
    if (wash > 0.02) {
      _src.ox = -st.loa * 0.5 * dir; _src.oz = st.steer * st.beam * 0.15;
      _src.hl = hlW; _src.hb = st.beam * (0.42 - 0.18 * st.planing);
      _src.dep = 0; _src.ff = wash; _src.fs = wash * 0.25; _src.rim = false; _src.key = 1;
      CBZ.waterWakeSource(obj, _src);
    }
    // 3. PADDLE BLADES: a hull with no engine moving under its own power
    //    makes rings where the blade goes in, alternating sides.
    if (!st.engine && st.kind === "boat" && st.spd > 0.4 && CBZ.waterWakeStamp) {
      A.blade += dt;
      const cad = 0.62;
      if (A.blade >= cad) {
        A.blade = 0; A.side = -A.side;
        const off = st.beam * 0.5 + 0.45;
        CBZ.waterWakeStamp({
          x: st.x + st.rx * off * A.side + st.fx * st.loa * 0.08,
          z: st.z + st.rz * off * A.side + st.fz * st.loa * 0.08,
          r: 0.22, amp: 0.035, ff: 0.18, fs: 0.04,
        });
      }
    }
  }

  // ---- airborne spray: planing hulls throw sheets, displacement hulls beads
  function emitPlaningSpray(st, A, dt) {
    const pl = st.planing;
    A.spray += (4 + 18 * pl) * Math.min(1.4, st.spd / st.planeMs) * st.scale * st.dg * dt;
    let n = A.spray | 0;
    A.spray -= n;
    if (n > 6) n = 6;
    const cx = st.x + st.fx * st.loa * 0.16, cz = st.z + st.fz * st.loa * 0.16;
    const cy = surfY(cx, cz) + 0.06 + Math.max(0, st.trim) * st.loa * 0.30;
    const off = st.beam * 0.50;
    const lat = 2.4 + 5.4 * pl + st.spd * 0.10;
    for (let k = 0; k < n; k++) {
      const s = (k & 1) ? 1 : -1;
      const j = (fxRand() - 0.5) * st.loa * 0.30;
      // a planing hull heels into its turn: the inside chine throws harder
      const bias = 1 + 0.45 * st.steer * s;
      spawnDrop(cx + st.fx * j + st.rx * off * s, cy, cz + st.fz * j + st.rz * off * s,
        st.rx * lat * bias * s + st.fx * st.spd * 0.30,
        0.9 + pl * 2.0 + fxRand() * 0.9,
        st.rz * lat * bias * s + st.fz * st.spd * 0.30,
        (0.11 + fxRand() * 0.13) * (0.7 + st.beam * 0.24 + pl * 0.5), -0.04,
        0.34 + pl * 0.34, (0.50 + pl * 0.42) * st.dg);
    }
    // the rooster tail: ballistic, and it collapses as the hull comes off the plane
    if (pl > 0.42 && st.engine) {
      A.roost += (2.5 + 12 * pl) * st.scale * st.dg * dt;
      let m = A.roost | 0;
      A.roost -= m;
      if (m > 5) m = 5;
      const ty = surfY(st.sx, st.sz) + 0.05;
      const up = 2.2 + pl * 4.6 + st.spd * 0.12;
      for (let k = 0; k < m; k++) {
        const j = (fxRand() - 0.5) * st.beam * 0.9;
        spawnDrop(st.sx + st.rx * j, ty, st.sz + st.rz * j,
          -st.fx * (0.8 + st.spd * 0.10) + st.rx * (fxRand() - 0.5) * 1.5,
          up * (0.75 + fxRand() * 0.5),
          -st.fz * (0.8 + st.spd * 0.10) + st.rz * (fxRand() - 0.5) * 1.5,
          (0.13 + fxRand() * 0.16) * (0.7 + st.beam * 0.22 + pl * 0.45), -0.03,
          0.6 + pl * 0.6, (0.50 + pl * 0.38) * st.dg);
      }
    }
    // the fine mist a fast hull leaves hanging behind its spray: a few faint
    // puffs, not a cloud
    if (pl > 0.5 && st.spd > 8) {
      A.mist = (A.mist || 0) + (1.5 + 2.5 * pl) * st.dg * dt;
      if (A.mist >= 1) {
        A.mist -= 1;
        spawnMist(st.sx + st.rx * (fxRand() - 0.5) * st.beam, surfY(st.sx, st.sz) + 0.4 + fxRand() * 0.6,
          st.sz + st.rz * (fxRand() - 0.5) * st.beam,
          st.fx * st.spd * 0.25, 0.3, st.fz * st.spd * 0.25,
          st.beam * (0.7 + 0.5 * fxRand()), 1.2 + fxRand() * 0.8, 0.07 + 0.04 * pl);
      }
    }
  }
  function emitDisplacementSpray(st, A, dt) {
    const vN = Math.min(1, st.spd / st.planeMs);
    A.spray += (0.4 + 2.6 * vN * vN) * st.scale * st.dg * dt;
    let n = A.spray | 0;
    A.spray -= n;
    if (n <= 0) return;
    if (n > 2) n = 2;
    const bx = st.x + st.fx * st.loa * 0.40, bz = st.z + st.fz * st.loa * 0.40;
    const by = surfY(bx, bz) + 0.05;
    const off = st.beam * 0.46;
    for (let k = 0; k < n; k++) {
      const s = (k & 1) ? 1 : -1;
      spawnDrop(bx + st.rx * off * s, by, bz + st.rz * off * s,
        st.rx * (0.5 + vN * 1.0) * s + st.fx * st.spd * 0.16,
        0.35 + vN * 0.55,
        st.rz * (0.5 + vN * 1.0) * s + st.fz * st.spd * 0.16,
        0.07 + fxRand() * 0.07, -0.03, 0.22 + vN * 0.14, (0.30 + vN * 0.22) * st.dg);
    }
  }

  //   CBZ.waterWakeFor(car, dt)                        a hull
  //   CBZ.waterWakeFor(ref, dt, {x, z, speed, heading, loa, beam, kind})
  // Returns true iff this call owned the object's wake this frame.
  CBZ.waterWakeFor = function (obj, dt, opts) {
    if (!obj || !fxOn()) return false;
    dt = Math.min(0.1, +dt || 0);
    if (!(dt > 0)) return false;
    if (!CBZ.waterModeOn || !CBZ.waterModeOn()) return false;
    const sp = frameStamp();
    if (obj._wakeStamp === sp) return true;            // already handled this frame
    obj._wakeStamp = sp;
    const st = resolve(obj, opts, dt);
    if (!st) return false;
    if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(st.x, st.z)) return true;
    // the twin keeps every track, wherever anybody is looking
    if (CBZ.waterWakeTrack && st.spd >= MIN_WAKE_SPD) {
      CBZ.waterWakeTrack(obj, st.x, st.z, st.spd, wakeAmp(st), Math.max(0.4, st.beam * 0.5), dt);
    }
    if (st.spd < MIN_WAKE_SPD) return true;
    const A = acc(obj);
    fieldHull(obj, st, A, dt);
    if (st.kind === "boat" && st.dg > 0) {
      build();
      if (pos) {
        if (st.planing > 0.12) emitPlaningSpray(st, A, dt);
        else emitDisplacementSpray(st, A, dt);
      }
    }
    return true;
  };

  /* The driving set compiled before anybody drives (core/fxwarm.js warms it
     in idle time): the spray and the crown are built empty and linked. */
  CBZ.waterFxWarmObjects = function () {
    try { buildPoints(); buildCrown(); } catch (e) {}
    const out = [];
    [points, crownMesh].forEach(function (o) { if (o) out.push(o); });
    return out;
  };

  // ============================================================
  //  THE SWEEPS — sources that do not call the hook themselves
  // ============================================================
  function isMarine(car) {
    if (!car) return false;
    if (CBZ.isMarineHull) return !!CBZ.isMarineHull(car);
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }

  // Every marine car and every sea-craft hull. One that already called the
  // hook this frame (the helm, the autopilot, the ride) is a no-op.
  function sweepHulls(dt) {
    const cars = CBZ.cityCars;
    if (cars && cars.length) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (!car || car.dead || !car.pos || !isMarine(car)) continue;
        CBZ.waterWakeFor(car, dt);
      }
    }
    const sc = CBZ.seaCraft && CBZ.seaCraft.list ? CBZ.seaCraft.list() : null;
    if (sc && sc.length) {
      for (let i = 0; i < sc.length; i++) {
        const r = sc[i];
        if (!r || r.dead || r._sinking || r._engulf || !r.pos) continue;
        CBZ.waterWakeFor(r, dt);
      }
    }
  }

  /* SWIMMERS — the player, survivor bots and floating peds. A body at the
     surface is a small hull (a 1.8 m ellipse with a few centimetres of
     displacement), so it drags rings behind it rather than a V (it is slower
     than the field's waves). Arms put rings and fast foam in on a stroke
     cadence, the kick leaves slow foam at the feet, and treading makes small
     rings around the shoulders. */
  const _swOpt = { kind: "swim", loa: 1.8, beam: 0.5, draft: 0.25, massT: 0.08, scale: 0.4, x: 0, z: 0, speed: 0, heading: 0 };
  function swimmer(ref, x, z, y, dt, beat) {
    let m = ref._swimWk;
    if (!m) m = ref._swimWk = { x: x, z: z, t: 0, side: 1, have: false };
    if (!m.have) { m.x = x; m.z = z; m.have = true; return; }
    const dx = x - m.x, dz = z - m.z;
    m.x = x; m.z = z;
    const spd = Math.sqrt(dx * dx + dz * dz) / Math.max(1e-3, dt);
    if (spd > 12) return;                                   // a teleport, not a swim
    const sy = surfY(x, z);
    if (y > sy + 0.6 || y < sy - 2.6) return;               // not at the surface
    const fx = spd > 0.05 ? dx / (spd * dt) : Math.sin(ref.heading || 0);
    const fz = spd > 0.05 ? dz / (spd * dt) : Math.cos(ref.heading || 0);
    if (spd > 0.25 && CBZ.waterWakeSource) {
      _src.x = x; _src.z = z; _src.fx = fx; _src.fz = fz;
      _src.hl = 0.85; _src.hb = 0.26; _src.ox = 0; _src.oz = 0;
      _src.dep = 0.03 * Math.min(1.5, spd); _src.ff = 0.05 * Math.min(1, spd); _src.fs = 0;
      _src.rim = true; _src.key = 0;
      CBZ.waterWakeSource(ref, _src);
      // the kick
      _src.ox = -0.95; _src.hl = 0.35; _src.hb = 0.22; _src.dep = 0;
      _src.ff = 0.18 * Math.min(1, spd); _src.fs = 0.08 * Math.min(1, spd); _src.rim = false; _src.key = 1;
      CBZ.waterWakeSource(ref, _src);
      _swOpt.x = x; _swOpt.z = z; _swOpt.speed = Math.min(4, spd); _swOpt.heading = Math.atan2(fx, fz);
      if (CBZ.waterWakeTrack) CBZ.waterWakeTrack(ref, x, z, spd, 0.012 * Math.min(2, spd), 0.35, dt);
    }
    if (!CBZ.waterWakeStamp) return;
    // arm entries on the stroke (an explicit beat when the swimmer has one)
    m.t += dt;
    const cad = spd > 0.25 ? 0.58 : 0.85;
    if (beat === true || (beat == null && m.t >= cad)) {
      m.t = 0; m.side = -m.side;
      const rx = fz, rz = -fx;
      if (spd > 0.25) {
        CBZ.waterWakeStamp({ x: x + fx * 0.75 + rx * 0.32 * m.side, z: z + fz * 0.75 + rz * 0.32 * m.side,
          r: 0.16, amp: 0.025, ff: 0.12, fs: 0.02 });
      } else {
        // treading: sculling hands and a bobbing head, small rings
        CBZ.waterWakeStamp({ x: x + rx * 0.4 * m.side, z: z + rz * 0.4 * m.side, r: 0.22, amp: 0.016, ff: 0.08, fs: 0 });
      }
    }
  }
  function sweepSwimmers(dt) {
    const P = CBZ.player;
    if (P && P.pos && CBZ.citySwimming && CBZ.citySwimming() && !P.driving) {
      const s = CBZ.citySwimState ? CBZ.citySwimState() : null;
      if (!s || !s.headUnder || (s.submergence || 0) < 0.98) swimmer(P, P.pos.x, P.pos.z, P.pos.y + 1.2, dt, P._swimBeat ? true : null);
      P._swimBeat = false;
    }
    const bots = CBZ.bots;
    if (bots && bots.length) {
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (!b || b.dead || !b.pos || b._aboard) continue;
        if (!(b.swim || (b.char && b.char.swimming))) { if (b._swimWk) b._swimWk.have = false; continue; }
        swimmer(b, b.pos.x, b.pos.z, b.pos.y + 1.2, dt, null);
      }
    }
  }

  // Everything else afloat that is MOVING (a body on the swell, a flooded car
  // carried by the current), from water_float.js's census, at 10 Hz.
  const _occOpt = { kind: "drift", loa: 2.2, beam: 0.9, draft: 0.3, scale: 0.35, x: 0, z: 0, speed: 0, heading: 0 };
  const _occOut = [];
  let occAcc = 0;
  function sweepDrift(dt) {
    if (!CBZ.waterOccupants) return;
    occAcc += dt;
    if (occAcc < 0.10) return;
    const step = occAcc;
    occAcc = 0;
    let list;
    try { list = CBZ.waterOccupants(_occOut); } catch (e) { return; }
    if (!list || !list.length) return;
    let n = 0;
    for (let i = 0; i < list.length && n < 8; i++) {
      const o = list[i];
      if (!o || !o.ref || !o.moving) continue;
      if (o.kind === "boat" || o.kind === "player") continue;
      const ref = o.ref;
      const hx = ref._wakeOx, hz = ref._wakeOz;
      ref._wakeOx = o.x; ref._wakeOz = o.z;
      if (!Number.isFinite(hx)) continue;
      const dx = o.x - hx, dz = o.z - hz;
      const spd = Math.sqrt(dx * dx + dz * dz) / step;
      if (!(spd > 0.3) || spd > 30) continue;
      const car = o.kind === "car";
      _occOpt.x = o.x; _occOpt.z = o.z;
      _occOpt.speed = Math.min(8, spd);
      _occOpt.heading = Math.atan2(dx, dz);
      _occOpt.loa = car ? 4.2 : 1.6;
      _occOpt.beam = car ? 1.8 : 0.5;
      _occOpt.draft = car ? 0.7 : 0.2;
      _occOpt.massT = car ? 1.4 : 0.08;
      _occOpt.scale = car ? 0.55 : 0.30;
      if (CBZ.waterWakeFor(ref, step, _occOpt)) n++;
    }
  }

  /* ANIMALS AT THE SURFACE: a dolphin running at the surface, a shark with
     its back out, a turtle: anything aquatic whose body cuts the waterline
     makes the same displacement wake, sized by its own length, and a fin
     slices a thin bright line. Deep swimmers leave no mark. */
  const _aniOpt = { kind: "animal", loa: 2, beam: 0.6, draft: 0.4, massT: 0.2, scale: 0.4, x: 0, z: 0, speed: 0, heading: 0 };
  let aniAcc = 0;
  const _aniPick = [];
  function sweepAnimals(dt) {
    if (typeof CBZ.cityWildlifeList !== "function") return;
    aniAcc += dt;
    if (aniAcc < 0.05) return;
    const step = aniAcc;
    aniAcc = 0;
    const cam = CBZ.camera;
    if (!cam) return;
    let L;
    try { L = CBZ.cityWildlifeList(); } catch (e) { return; }
    if (!L || !L.length) return;
    const cx = cam.position.x, cz = cam.position.z;
    _aniPick.length = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a || a.dead || !a.pos || !a.species || !a.species.aquatic) continue;
      const dx = a.pos.x - cx, dz = a.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 400 * 400) continue;
      _aniPick.push(a); a._wkD2 = d2;
    }
    if (!_aniPick.length) return;
    _aniPick.sort(function (p, q) { return p._wkD2 - q._wkD2; });
    let n = 0;
    for (let i = 0; i < _aniPick.length && n < 8; i++) {
      const a = _aniPick[i];
      const x = a.pos.x, z = a.pos.z;
      const hx = a._wakeOx, hz = a._wakeOz;
      a._wakeOx = x; a._wakeOz = z;
      if (!Number.isFinite(hx)) continue;
      const sc = a.group && a.group.scale ? Math.max(0.2, a.group.scale.x || 1) : 1;
      let len = 1.6 * sc;
      if (typeof CBZ.marineBodyLen === "function") { try { len = +CBZ.marineBodyLen(a) || len; } catch (e) {} }
      const sy = surfY(x, z);
      // how much of the body is out: the back (and the fin) at or above the surface
      const top = a.pos.y + len * 0.12;
      if (!(top > sy - 0.15)) continue;
      const ddx = x - hx, ddz = z - hz;
      const spd = Math.sqrt(ddx * ddx + ddz * ddz) / step;
      if (!(spd > 0.4) || spd > 30) continue;
      _aniOpt.x = x; _aniOpt.z = z;
      _aniOpt.speed = Math.min(14, spd);
      _aniOpt.heading = Math.atan2(ddx, ddz);
      _aniOpt.loa = Math.max(0.6, len);
      _aniOpt.beam = Math.max(0.25, len * 0.2);
      _aniOpt.draft = Math.max(0.15, len * 0.12);
      _aniOpt.massT = Math.max(0.02, 0.012 * len * len * len);
      _aniOpt.scale = Math.min(0.9, 0.25 + len * 0.05);
      // a body only half out displaces half as much
      _aniOpt.scale *= clamp01((top - (sy - 0.15)) / Math.max(0.2, len * 0.15));
      if (CBZ.waterWakeFor(a, step, _aniOpt)) n++;
      // the dorsal fin: a thin bright cut at the surface just ahead of mid-body
      if (CBZ.waterWakeSource && a.pos.y + len * 0.2 > sy) {
        const fx = ddx / (spd * step), fz = ddz / (spd * step);
        _src.x = x; _src.z = z; _src.fx = fx; _src.fz = fz; _src.ox = len * 0.05; _src.oz = 0;
        _src.hl = Math.max(0.15, len * 0.05); _src.hb = Math.max(0.05, len * 0.012);
        _src.dep = 0; _src.ff = 0.9 * Math.min(1, spd / 3); _src.fs = 0.08; _src.rim = false; _src.key = 3;
        CBZ.waterWakeSource(a, _src);
      }
    }
  }

  let rainAcc = 0;
  function emitRain(dt) {
    const w = CBZ.weather;
    if (!w || !w.raining) { rainAcc = 0; return; }
    const cam = CBZ.camera;
    if (!cam || !CBZ.cityWaterAt || !CBZ.waterHit) return;
    const inten = Math.max(0, Math.min(1, +w.intensity || 0));
    const rate = inten * (CBZ.qScale ? CBZ.qScale(8, 40) : 30);
    rainAcc += dt * rate;
    let n = rainAcc | 0;
    if (n <= 0) return;
    rainAcc -= n;
    if (n > 8) n = 8;
    for (let i = 0; i < n; i++) {
      const a = fxRand() * Math.PI * 2;
      const r = 3 + Math.sqrt(fxRand()) * 34;
      const x = cam.position.x + Math.cos(a) * r, z = cam.position.z + Math.sin(a) * r;
      CBZ.waterHit(x, surfY(x, z), z, { kind: "drop", quiet: true });
    }
  }

  function hideAll() {
    if (points) points.visible = false;
    if (crownMesh) crownMesh.visible = false;
  }

  // Order 60 (PRESENTATION): after vehicles, buoyancy (38.5) and the swimmer
  // (45.8) have settled every position this reads, before the field steps
  // (60.5) and before the HUD.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.PRESENTATION : 60, function (dt) {
    frameSeq++;
    if (!fxOn()) { hideAll(); return; }
    if (!CBZ.waterModeOn || !CBZ.waterModeOn()) {
      hideAll();
      count = 0;
      crownClearAll();
      return;
    }
    dt = Math.min(0.1, dt || 0);
    sweepHulls(dt);
    sweepSwimmers(dt);
    sweepDrift(dt);
    sweepAnimals(dt);
    emitRain(dt);
    if (!points && !count) { if (crownMesh) { sceneLight(); crownTick(dt); } return; }
    build();
    if (!points || !pos) return;
    sceneLight();
    crownTick(dt);

    // ---- integrate the airborne water ------------------------------------
    // drops: ballistic, gone into the live surface (landing water stays in
    // the field as the rings and foam of whatever threw it); mist: drifts,
    // slows, rises a little and fades
    const mistDrag = Math.exp(-dt * 1.6), puffDrag = Math.exp(-dt * 0.35);
    for (let i = count - 1; i >= 0; i--) {
      life[i] += dt;
      const t = life[i] / maxLife[i];
      if (t >= 1) { killDrop(i); continue; }
      if (aKind[i] > 1.5) {
        // a puff of spray: ballistic, slowed by the air, back into the sea
        vel[i * 3] *= puffDrag; vel[i * 3 + 1] = vel[i * 3 + 1] * puffDrag - 9.81 * dt; vel[i * 3 + 2] *= puffDrag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        aVel[i * 3] = vel[i * 3]; aVel[i * 3 + 1] = vel[i * 3 + 1]; aVel[i * 3 + 2] = vel[i * 3 + 2];
        if (vel[i * 3 + 1] < 0 && pos[i * 3 + 1] < base[i]) { killDrop(i); continue; }
        aSize[i] = size0[i] + grow[i] * life[i];
        aAlpha[i] = alpha0[i] * Math.min(1, t * 10) * Math.min(1, (1 - t) * 3);
        continue;
      }
      if (aKind[i] > 0.5) {
        vel[i * 3] *= mistDrag; vel[i * 3 + 1] = vel[i * 3 + 1] * mistDrag + 0.15 * dt; vel[i * 3 + 2] *= mistDrag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        aSize[i] = size0[i] + grow[i] * life[i];
        aAlpha[i] = alpha0[i] * Math.min(1, t * 6) * (1 - t);
        continue;
      }
      vel[i * 3 + 1] -= 9.81 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      aVel[i * 3] = vel[i * 3]; aVel[i * 3 + 1] = vel[i * 3 + 1]; aVel[i * 3 + 2] = vel[i * 3 + 2];
      if (vel[i * 3 + 1] < 0 && pos[i * 3 + 1] < base[i]) { killDrop(i); continue; }
      aAlpha[i] = alpha0[i] * Math.min(1, (1 - t) * 3);
    }
    points.visible = count > 0;
    geo.setDrawRange(0, count);
    if (count > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
      geo.attributes.aKind.needsUpdate = true;
    }
    // perspective point-size scale in device pixels, re-read each frame (the
    // quality slider moves the pixel ratio live); aspect keeps streaks honest
    const cam = CBZ.camera, r = CBZ.renderer;
    if (cam && r && r.domElement) {
      const h = r.domElement.height || 600, w = r.domElement.width || 800;
      mat.uniforms.uPix.value = (h * 0.5) / Math.tan((cam.fov || 62) * 0.5 * Math.PI / 180);
      mat.uniforms.uAspect.value = w / Math.max(1, h);
      mat.uniforms.uHalfH.value = h * 0.5;
    }
  });

  CBZ.waterParticleCount = function () { return count; };
  CBZ.waterFxAudit = function () {
    return {
      drops: count, dropBudget: budget(), crowns: crownCount, built: !!points,
      visible: { spray: !!(points && points.visible), crown: !!(crownMesh && crownMesh.visible) },
      field: CBZ.waterWakeAudit ? CBZ.waterWakeAudit() : null,
    };
  };
})();
