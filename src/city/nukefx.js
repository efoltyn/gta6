/* ============================================================
   city/nukefx.js — the nuclear (and MOAB) spectacle.

   This file DRAWS. Damage, casualties, glass, fires and sound belong to
   systems/impactbus.js's analytic detonation field; this file plugs into it
   by name (CBZ.impact.fx("nuke"|"moab", composer)) and paints the event.

   THE CLOUD IS ONE RAYMARCHED VOLUME. A single box-proxy mesh runs a
   fragment shader that marches a density field through the cloud:

     head   a torus that starts as a sphere (ring radius 0) and opens into
            the toroidal cap. Its noise coordinates rotate around the tube,
            so the cap ROLLS: up the middle, out over the top, down the rim.
     stem   a flared column of dust drawn up off the deck into the head.
     surge  the base surge, a low dust torus rolling out along the ground.
     shell  the Wilson condensation dome riding the shock front, drawn
            analytically (ray/sphere) so it stays razor thin and cheap.

   Lighting per sample: Beer-Lambert extinction, sun transmittance read off
   the analytic envelope (no nested march), Henyey-Greenstein forward
   scatter, sky/ground ambient with height occlusion, and a blackbody
   emission term for the fireball that cools white -> yellow -> orange ->
   ember and keeps glowing inside the cap after the skin has gone to smoke.
   The fragment writes its own depth at the first dense sample, so the city
   occludes it properly and a cloud past the far plane is still drawn.

   COST: one draw call. Empty box space costs one envelope evaluation and no
   texture fetch. Step count rides the quality tier and on-screen coverage.
   No lights are added (an added light recompiles every r128 material), no
   per-frame allocation, one 1.1 MB noise atlas built in idle slices.

   Public surface (kept stable for strategic.js, impactbus.js, disasters.js,
   ordnance.js, bunkers.js, crashfx.js and the tools):
     CBZ.cityNukeFX(x,y,z,opts)      fire the spectacle without the bus
     CBZ.cityNukeWhiteout(fade,peak,dbl)
     CBZ.cityNukeFxAbort()
     CBZ.nukeYield/nukeRings/nukeLethalAt/nukeDims(R)   the physical model
     CBZ.cityBombWalk(points,opts) / CBZ.cityBombWalkActive()
     CBZ.nukeFxDebug() / nukeFxSize() / nukeFxAudit()
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;
  if (!THREE || !scene) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.NUKE_FX_V1 == null) C.NUKE_FX_V1 = true;        // master: off = crashfx near field only
  if (C.NUKE_FX_SKY == null) C.NUKE_FX_SKY = true;      // fog tint + world light drive
  if (C.NUKE_FX_GLASS == null) C.NUKE_FX_GLASS = true;  // shatter ladder for field-less calls
  if (C.NUKE_FX_MOAB == null) C.NUKE_FX_MOAB = true;
  if (C.BOMB_WALK_V1 == null) C.BOMB_WALK_V1 = true;
  if (C.NUKE_FX_PULSE == null) C.NUKE_FX_PULSE = true;
  if (C.NUKE_REAL_SCALE == null) C.NUKE_REAL_SCALE = true;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(u) { u = clamp(u, 0, 1); return 1 - (1 - u) * (1 - u); }
  function floorAt(x, z) { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; }
  function camPos() { return CBZ.camera && CBZ.camera.position ? CBZ.camera.position : null; }
  function camDist(x, y, z) {
    const c = camPos();
    return c ? Math.hypot(c.x - x, c.y - y, c.z - z) : 500;
  }
  function tier() { return CBZ.qualityLevel == null ? 3 : clamp(CBZ.qualityLevel, 0, 4); }
  let _rs = 0x51ed77;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  /* ============================================================
     THE PHYSICAL MODEL. The yield is inverted out of the bus row:
     R_fireball = 50*W^(1/3) m and the nuke row fixes R = 14*9 = 126 m, so
     W = 16 kt, Hiroshima class. Rings are Glasstone & Dolan surface-burst
     overpressure radii scaled by W^(1/3); the fatality curve is the USSBS
     Hiroshima survey. impactbus.js and strategic.js read these; there is no
     second table anywhere.
     ============================================================ */
  function yieldKt(R) { return Math.pow(Math.max(1, R) / 50, 3); }
  function cubeRt(W) { return Math.pow(Math.max(0.001, W), 1 / 3); }
  const CLOUD_TOP_M = 10000, CAP_DIA_20KT = 5500, CAP_THICK_20KT = 4300, STEM_OF_CAP = 1 / 3;
  const RING_1KT = { p20: 200, p10: 300, p5: 440, p2: 800, p1: 1300 };
  const USSBS = [
    [0.5, 0.860], [1.0, 0.830], [1.5, 0.510], [2.0, 0.216],
    [2.5, 0.049], [3.0, 0.024], [4.0, 0.003], [5.0, 0.000],
  ];
  const HIROSHIMA_KT = 15;
  // The mature (minutes-old) stabilised cloud.
  function nukeDims(R) {
    const W = yieldKt(R);
    const k = Math.pow(W / 20, 1 / 3);
    const capW = CAP_DIA_20KT * k, capH = CAP_THICK_20KT * k;
    return {
      W: W, fireball: R, capW: capW, capH: capH,
      capY: CLOUD_TOP_M - capH * 0.5, top: CLOUD_TOP_M,
      stemW: capW * STEM_OF_CAP, base: RING_1KT.p2 * cubeRt(W),
    };
  }
  function nukeRings(R) {
    const W = yieldKt(R);
    const k = cubeRt(W);
    const hk = Math.pow(W / HIROSHIMA_KT, 1 / 3);
    return {
      W: +W.toFixed(2), fireball: R,
      psi20: RING_1KT.p20 * k, psi10: RING_1KT.p10 * k,
      psi5: RING_1KT.p5 * k, psi2: RING_1KT.p2 * k, psi1: RING_1KT.p1 * k,
      fatal: USSBS.map(function (b) { return [b[0] * 1000 * hk, b[1]]; }),
      rad500: 1100 * Math.pow(W / 20, 0.2),     // prompt dose attenuates in air: not W^(1/3)
    };
  }
  function nukeLethalAt(r, R) {
    const T = nukeRings(R);
    if (r <= T.fireball) return 1;
    const f = T.fatal;
    let prev = T.fireball, prevV = 1;
    for (let i = 0; i < f.length; i++) {
      if (r <= f[i][0]) {
        const u = (r - prev) / Math.max(1, f[i][0] - prev);
        return Math.max(0, prevV + (f[i][1] - prevV) * u);
      }
      prev = f[i][0]; prevV = f[i][1];
    }
    return 0;
  }
  CBZ.nukeYield = function (R) { return yieldKt(R == null ? 126 : R); };
  CBZ.nukeRings = function (R) { return nukeRings(R == null ? 126 : R); };
  CBZ.nukeLethalAt = function (r, R) { return nukeLethalAt(r, R == null ? 126 : R); };
  CBZ.nukeDims = function (R) { return nukeDims(R == null ? 126 : R); };

  // Effective near-field radius of a bus row: radius*power (126 m for the nuke).
  function fireR(row, opts) {
    const pw = Math.max(0.1, +row.power || 1);
    const rr = Math.max(1, +row.radius || 14);
    const sc = (opts && opts.scale > 0) ? +opts.scale : 1;
    return Math.max(8, rr * pw * sc);
  }
  // 5 psi / 2 psi / 1 psi / 0.5 psi as fractions of the 1 psi reach.
  const GLASS_K_REAL = [0.339, 0.615, 1.000, 1.250];
  const GLASS_K = [0.42, 0.85, 1.35, 2.10];
  function glassLadder(kind) {
    if (kind === "nuke" && C.NUKE_REAL_SCALE !== false) {
      if (CBZ.impact && CBZ.impact.row) {
        try {
          const row = CBZ.impact.row("nuke");
          if (row && row.wave && row.wave.glassK && row.wave.glassK.length) return row.wave.glassK;
        } catch (e) {}
      }
      return GLASS_K_REAL;
    }
    return GLASS_K;
  }

  /* ============================================================
     STYLES. Every length is a multiple of the fireball radius R, so the
     whole event keeps its proportions at any yield. Times are seconds.
       formation: 0..form s, the cloud a player watches go up.
       aftermath: form..dur s, slow growth toward a stabilised anvil, then
                  it thins out and is gone.
     ============================================================ */
  /* THE NUKE TIMELINE IS MEASURED, NOT STYLED (2026-10-09, owner: "way too
     fake"). The old curve topped the cloud out at ~5 km and deleted it at
     3.5 minutes; a 16 kt surface burst's cloud is still climbing at 3
     minutes and stands for the better part of an hour. The numbers below
     are Glasstone & Dolan's 20 kt cloud-rise and cap-diameter curves (their
     Fig. 2.12 / Table 2.12 family) cube-rooted to this row's yield:
        t      10 s   20 s   40 s   60 s   90 s   180 s   300 s   600 s
        top    0.9    1.7    2.9    3.9    5.1    7.5     9.2     10.5 km
        cap Ø  0.45   0.8    1.4    2.0    2.6    3.8     4.6     5.2 km
     fitted as top = TOP*(1-e^(-t/170))^0.85 and capØ = CAP*(1-e^(-t/150))^0.9.
     The fireball reaches ~70% of its final radius inside the first 20 ms
     (the hydrodynamic phase is over before the first frame) and is fully
     grown by ~1 s; it is drawn as an opaque, brightness-limited sphere until
     its own smoke takes it over at 2-4 s. */
  // The prevailing wind the cloud and the fallout ride: out of the WSW, the
  // way a mid-latitude westerly carries a plume. Published for the news
  // and for anything that wants to know which suburbs the dust falls on.
  const WIND = [0.866, 0.5];
  CBZ.nukeWind = function () { return { x: WIND[0], z: WIND[1], speed: REAL.wind }; };
  const REAL = { top: 10800, topTau: 170, topP: 0.85, cap: 5300, capTau: 150, capP: 0.9, kt: 16, life: 900, wind: 7.5 };
  const STYLE = {
    nuke: {
      real: true,
      rFrac: 1.0, form: 34, dur: REAL.life,
      rise: 17.0, riseTau: 11, riseLate: 40.0,  // cap centre height / R (formation, aftermath)
      ring: 4.1, ringLate: 11.0,                 // torus ring radius / R
      tube: 2.6, tubeLate: 6.0,                  // torus minor radius / R
      flat: 0.66, flatLate: 0.5,                 // vertical squash of the tube
      stem: 1.9, stemLate: 3.6,                  // stem radius / R
      surgeK: 6.8, surgeMax: 16,                 // base surge ring radius coefficient / cap
      shell: true, emit: 7.0, heatTau: 5.5, glowTau: 13,
      // nitrogen-dioxide red-brown while hot, water-condensate grey-white cold
      smokeHot: [0.42, 0.24, 0.15], smokeCool: [0.66, 0.63, 0.60], dust: [0.47, 0.40, 0.33],
      sigma: 0.030, white: 0.85, whitePeak: 1, dbl: true, shatter: 4, shake: 9,
    },
    moab: {
      rFrac: 0.35, form: 12, dur: 40,
      rise: 5.0, riseTau: 5, riseLate: 7.0,
      ring: 1.2, ringLate: 2.0,
      tube: 1.5, tubeLate: 2.2,
      flat: 0.85, flatLate: 0.75,
      stem: 0.55, stemLate: 0.8,
      surgeK: 3.2, surgeMax: 5,
      shell: false, emit: 4.0, heatTau: 1.6, glowTau: 3,
      smokeHot: [0.30, 0.20, 0.14], smokeCool: [0.34, 0.31, 0.29], dust: [0.52, 0.44, 0.36],
      sigma: 0.045, white: 0.7, whitePeak: 0.8, dbl: false, shatter: 1, shake: 4.5,
    },
  };

  /* ============================================================
     THE NOISE ATLAS. 64^3 tileable noise stored as 64 slices of 64x64 in an
     8x8 atlas with a 1-texel wrap border (528x528 RGBA8), so it works in
     WebGL1 and WebGL2 alike. Channels:
       R  perlin-worley billow (low frequency: the big cauliflower lumps)
       G  worley fbm           (mid: edge erosion)
       B  perlin fbm           (fine: wisps)
     Built in idle slices after boot, finished synchronously only if a
     warhead lands before the build did (behind the whiteout).
     ============================================================ */
  const NS = 64, TILE = NS + 2, ATL = TILE * 8;
  const noise = { data: null, tex: null, z: 0, done: false };
  function ihash(x, y, z, s) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function wrapi(i, p) { i %= p; return i < 0 ? i + p : i; }
  function perlin(x, y, z, P, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    let acc = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const gx = wrapi(xi + dx, P), gy = wrapi(yi + dy, P), gz = wrapi(zi + dz, P);
      const th = ihash(gx, gy, gz, s) * 6.2831853, ph = Math.acos(ihash(gx, gy, gz, s + 7) * 2 - 1);
      const g0 = Math.sin(ph) * Math.cos(th), g1 = Math.sin(ph) * Math.sin(th), g2 = Math.cos(ph);
      const d = g0 * (xf - dx) + g1 * (yf - dy) + g2 * (zf - dz);
      acc += d * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return acc;                                  // ~[-0.87, 0.87]
  }
  function worley(x, y, z, P, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const wx = wrapi(cx, P), wy = wrapi(cy, P), wz = wrapi(cz, P);
      const fx = cx + ihash(wx, wy, wz, s) - x;
      const fy = cy + ihash(wx, wy, wz, s + 1) - y;
      const fz = cz + ihash(wx, wy, wz, s + 2) - z;
      const d = fx * fx + fy * fy + fz * fz;
      if (d < best) best = d;
    }
    return Math.min(1, Math.sqrt(best));        // 0 at a feature point
  }
  const _vox = new Uint8Array(NS * NS * 4);
  function buildSlice(z) {
    const f = 1 / NS;
    for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
      const px = x * f, py = y * f, pz = z * f;
      // R: perlin fbm remapped by inverted worley = rounded billows
      const pf = perlin(px * 4, py * 4, pz * 4, 4, 11) * 0.62 +
                 perlin(px * 8, py * 8, pz * 8, 8, 12) * 0.28 +
                 perlin(px * 16, py * 16, pz * 16, 16, 13) * 0.10;
      const w1 = 1 - worley(px * 4, py * 4, pz * 4, 4, 21);
      const p01 = clamp(pf * 0.9 + 0.5, 0, 1);
      const billow = clamp((p01 - (1 - w1)) / (1 - (1 - w1) * 0.999) , 0, 1) * 0.55 + w1 * 0.45;
      // G: worley fbm
      const wg = (1 - worley(px * 6, py * 6, pz * 6, 6, 31)) * 0.62 +
                 (1 - worley(px * 12, py * 12, pz * 12, 12, 32)) * 0.26 +
                 (1 - worley(px * 24, py * 24, pz * 24, 24, 33)) * 0.12;
      // B: fine perlin
      const pb = perlin(px * 16, py * 16, pz * 16, 16, 41) * 0.66 + perlin(px * 32, py * 32, pz * 32, 32, 42) * 0.34;
      const o = (y * NS + x) * 4;
      _vox[o] = Math.round(clamp(billow, 0, 1) * 255);
      _vox[o + 1] = Math.round(clamp(wg, 0, 1) * 255);
      _vox[o + 2] = Math.round(clamp(pb * 0.9 + 0.5, 0, 1) * 255);
      _vox[o + 3] = 255;
    }
    // copy into the atlas tile with its wrap border
    const tx = (z % 8) * TILE, ty = Math.floor(z / 8) * TILE;
    const D = noise.data;
    for (let j = 0; j < TILE; j++) {
      const sy = wrapi(j - 1, NS);
      for (let i = 0; i < TILE; i++) {
        const sx = wrapi(i - 1, NS);
        const si = (sy * NS + sx) * 4, di = ((ty + j) * ATL + tx + i) * 4;
        D[di] = _vox[si]; D[di + 1] = _vox[si + 1]; D[di + 2] = _vox[si + 2]; D[di + 3] = 255;
      }
    }
  }
  function noiseStep(budgetMs) {
    if (noise.done) return true;
    if (!noise.data) noise.data = new Uint8Array(ATL * ATL * 4);
    const t0 = performance.now();
    while (noise.z < NS) {
      buildSlice(noise.z++);
      if (budgetMs != null && performance.now() - t0 > budgetMs) break;
    }
    if (noise.z >= NS) {
      noise.tex = new THREE.DataTexture(noise.data, ATL, ATL, THREE.RGBAFormat);
      noise.tex.magFilter = THREE.LinearFilter;
      noise.tex.minFilter = THREE.LinearFilter;
      noise.tex.generateMipmaps = false;
      noise.tex.wrapS = noise.tex.wrapT = THREE.ClampToEdgeWrapping;
      noise.tex.needsUpdate = true;
      noise.done = true;
      if (U) U.uNoise.value = noise.tex;
    }
    return noise.done;
  }
  let idleArmed = false;
  function armIdleBuild() {
    if (idleArmed || noise.done) return;
    idleArmed = true;
    const ric = window.requestIdleCallback;
    const tick = function (deadline) {
      if (noise.done) return;
      const budget = deadline && deadline.timeRemaining ? Math.max(1, deadline.timeRemaining() - 1) : 4;
      noiseStep(Math.min(budget, 6));
      if (!noise.done) {
        if (ric) ric(tick, { timeout: 2000 }); else setTimeout(tick, 50);
      }
    };
    setTimeout(function () { if (ric) ric(tick, { timeout: 2000 }); else tick(null); }, 4000);
  }

  /* ============================================================
     THE VOLUME SHADER
     ============================================================ */
  const VS = [
    "varying vec3 vWorld;",
    "void main() {",
    "  vec4 w = modelMatrix * vec4(position, 1.0);",
    "  vWorld = w.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * w;",
    // keep the proxy inside the far plane: the fragment writes its own depth
    "  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);",
    "}",
  ].join("\n");

  const FS = [
    "uniform sampler2D uNoise;",
    "uniform mat4 projectionMatrix;",   // r128 only predeclares it in the vertex stage
    "uniform vec3 uGZ;",
    "uniform vec3 uBoxMin; uniform vec3 uBoxMax;",   // the MARCH box (head, stem, surge)
    "uniform vec4 uHead;",      // ringR, tube, centreY (above ground), flat
    "uniform vec4 uStem;",      // radius, top, base flare, presence
    "uniform vec4 uSurge;",     // ringR, tube, flat, presence
    "uniform vec4 uShell;",     // radius, opacity, centreY, thickness
    "uniform vec4 uHeat;",      // head temperature, emission gain, core glow, fire light gain
    "uniform vec4 uRoll;",      // head roll, stem rise, surge roll, time
    "uniform vec4 uBall;",      // fireball radius, centreY, temperature, opacity
    "uniform vec4 uSkirt;",     // front radius, wall height, wall opacity, inner haze height
    "uniform vec4 uMisc;",      // head presence, inner haze density, ball gain, (spare)
    "uniform vec2 uDrift;",     // wind shear: xz offset of the cap relative to the deck
    "uniform vec4 uCollar;",    // condensation collar: height, inner R, outer R, opacity
    "uniform float uSigma; uniform float uSteps; uniform float uHazeL; uniform float uFade;",
    "uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGndCol; uniform vec3 uFogCol;",
    "uniform vec3 uSmokeHot; uniform vec3 uSmokeCool; uniform vec3 uDust; uniform float uCool;",
    "varying vec3 vWorld;",
    "",
    "vec4 noise4(vec3 p) {",
    "  p = fract(p);",
    "  float zf = p.z * 64.0; float z0 = floor(zf); float fz = zf - z0; float z1 = mod(z0 + 1.0, 64.0);",
    "  vec2 inner = p.xy * 64.0 + 1.5;",
    "  vec2 t0 = vec2(mod(z0, 8.0), floor(z0 / 8.0)) * 66.0;",
    "  vec2 t1 = vec2(mod(z1, 8.0), floor(z1 / 8.0)) * 66.0;",
    "  return mix(texture2D(uNoise, (t0 + inner) / 528.0), texture2D(uNoise, (t1 + inner) / 528.0), fz);",
    "}",
    "float smax(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }",
    // the wind shears the column: everything above the deck leans downwind,
    // the cap most of all
    "vec3 drifted(vec3 q) { q.xz -= uDrift * clamp(q.y / max(uHead.z, 1.0), 0.0, 1.25); return q; }",
    "",
    // envelopes: ~1 at the core, 0 at the surface, negative outside
    "float headEnv(vec3 q) {",
    "  float rho = length(q.xz);",
    "  vec2 m = vec2(rho - uHead.x, (q.y - uHead.z) / uHead.w);",
    "  float tor = 1.0 - length(m) / uHead.y;",
    "  float dr = uHead.x + uHead.y * 0.55;",
    "  vec3 d = vec3(q.x / dr, (q.y - uHead.z - uHead.y * uHead.w * 0.22) / (uHead.y * uHead.w * 0.95), q.z / dr);",
    "  return smax(tor, 1.0 - length(d), 0.35) - (1.0 - uMisc.x) * 1.6;",
    "}",
    "float stemEnv(vec3 q) {",
    "  float top = max(uStem.y, 1.0);",
    "  float u = clamp(q.y / top, 0.0, 1.0);",
    "  float r = uStem.x * (1.0 + uStem.z * exp(-u * 6.0)) * (1.0 + 0.9 * smoothstep(0.7, 1.0, u));",
    "  float e = 1.0 - length(q.xz) / r;",
    "  return e - smoothstep(top * 0.72, top * 1.1, q.y) * 1.6 - (1.0 - uStem.w) * 1.4;",
    "}",
    "float surgeEnv(vec3 q) {",
    "  float rho = length(q.xz);",
    "  vec2 m = vec2(rho - uSurge.x, q.y / uSurge.z - uSurge.y * 0.55);",
    "  float tor = 1.0 - length(m) / uSurge.y;",
    "  float sheet = min(1.0 - rho / (uSurge.x + uSurge.y * 0.4), 1.0 - q.y / (uSurge.y * uSurge.z * 0.8)) * 0.95;",
    "  return max(tor, sheet) - (1.0 - uSurge.w) * 1.4;",
    "}",
    "float envAll(vec3 q) {",
    "  vec3 qd = drifted(q);",
    "  return max(max(headEnv(qd), stemEnv(qd)), surgeEnv(q));",
    "}",
    "",
    "vec3 heatCol(float x) {",
    "  vec3 c = mix(vec3(0.0), vec3(0.55, 0.06, 0.01), smoothstep(0.05, 0.2, x));",
    "  c = mix(c, vec3(1.0, 0.36, 0.06), smoothstep(0.2, 0.45, x));",
    "  c = mix(c, vec3(1.0, 0.72, 0.30), smoothstep(0.45, 0.72, x));",
    "  c = mix(c, vec3(1.0, 0.96, 0.90), smoothstep(0.72, 1.0, x));",
    "  return c;",
    "}",
    // rotate a point about the tube of a ring (poloidal roll), fading to zero on the axis
    "vec3 rollAbout(vec3 q, float ringR, float cy, float ang) {",
    "  float rho = length(q.xz);",
    "  vec2 dir = rho > 1e-3 ? q.xz / rho : vec2(1.0, 0.0);",
    "  float a = ang * smoothstep(0.0, max(ringR, 1.0) * 0.45, rho);",
    "  vec2 m = vec2(rho - ringR, q.y - cy);",
    "  float cs = cos(a), sn = sin(a);",
    "  m = vec2(cs * m.x - sn * m.y, sn * m.x + cs * m.y);",
    "  return vec3(dir.x * (ringR + m.x), m.y + cy, dir.y * (ringR + m.x));",
    "}",
    // ray / sphere: near and far hit distances, (-1,-1) on a miss
    "vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {",
    "  vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r;",
    "  float h = b * b - cc; if (h <= 0.0) return vec2(-1.0);",
    "  h = sqrt(h); return vec2(-b - h, -b + h);",
    "}",
    // ray / vertical cylinder about the ground-zero axis
    "vec2 cylHit(vec3 ro, vec3 rd, float r) {",
    "  vec2 o = ro.xz - uGZ.xz; vec2 d = rd.xz;",
    "  float a = dot(d, d); if (a < 1e-8) return vec2(-1.0);",
    "  float b = dot(o, d); float cc = dot(o, o) - r * r;",
    "  float h = b * b - a * cc; if (h <= 0.0) return vec2(-1.0);",
    "  h = sqrt(h); return vec2((-b - h) / a, (-b + h) / a);",
    "}",
    "",
    "void main() {",
    "  vec3 ro = cameraPosition;",
    "  vec3 rd = normalize(vWorld - ro);",
    "  float tGround = rd.y < 0.0 ? (uGZ.y - ro.y) / rd.y : 1e9;",
    "  vec3 acc = vec3(0.0); float T = 1.0; float tHit = -1.0;",
    "  float cosT = dot(rd, uSunDir);",
    "  float g = 0.35;",
    "  float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.25 + 0.55;",
    "",
    // ---- THE FIREBALL: an opaque, brightness-limited sphere. Its surface
    // is mottled (cooler cells, the granulation every Trinity frame shows),
    // slightly darker at the limb, and its lower edge sits in its own dust.
    "  float tBall = -1.0; vec3 ballC = vec3(0.0); float ballA = 0.0;",
    "  if (uBall.w > 0.002) {",
    "    vec3 bc = uGZ + vec3(0.0, uBall.y, 0.0);",
    "    vec2 hb = sphereHit(ro, rd, bc, uBall.x);",
    "    float th = hb.x > 0.0 ? hb.x : hb.y;",
    "    if (th > 0.0 && th < tGround) {",
    "      vec3 n = (ro + rd * th - bc) / uBall.x;",
    "      float mu = clamp(dot(-rd, n), 0.0, 1.0);",
    "      vec4 nb = noise4(n * 0.62 + vec3(0.0, -uRoll.w * 0.035, uRoll.w * 0.011));",
    "      vec4 nc = noise4(n * 1.9 + vec3(0.31, uRoll.w * 0.05, 0.17));",
    "      float cells = smoothstep(0.35, 0.9, nb.g) * 0.6 + smoothstep(0.3, 0.85, nc.g) * 0.4;",
    "      float temp = uBall.z * (0.80 + 0.20 * cells) * (0.86 + 0.14 * pow(mu, 0.5));",
    "      temp -= (1.0 - smoothstep(0.0, 0.35, n.y + 0.25)) * 0.18 * (1.0 - uBall.z);",
    "      ballC = heatCol(clamp(temp, 0.0, 1.0)) * uMisc.z * (0.55 + 0.45 * cells);",
    "      ballA = uBall.w * smoothstep(0.0, 0.08, mu + 0.02);",
    "      tBall = th;",
    "    }",
    "  }",
    "",
    // ---- THE VOLUME: head, stem and base surge, marched inside its own box
    "  vec3 inv = 1.0 / (sign(rd) * max(abs(rd), vec3(1e-5)) + vec3(step(abs(rd), vec3(0.0))) * 1e-5);",
    "  vec3 ta = (uBoxMin - ro) * inv, tb = (uBoxMax - ro) * inv;",
    "  vec3 tmn = min(ta, tb), tmx = max(ta, tb);",
    "  float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);",
    "  float t1 = min(min(tmx.x, tmx.y), tmx.z);",
    "  t1 = min(t1, tGround);",
    "  if (tBall > 0.0 && ballA > 0.6) t1 = min(t1, tBall);",
    "  if (t1 > t0) {",
    "    float n = max(uSteps, 4.0);",
    "    float stepL = max((t1 - t0) / (n * 1.5), 3.0);",
    "    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));",
    "    float t = t0 + stepL * jit;",
    "    vec3 headC = vec3(uDrift.x, uHead.z, uDrift.y);",
    "    vec3 fireLight = heatCol(clamp(uHeat.x * 0.9 + 0.25, 0.0, 1.0)) * uHeat.w;",
    "    float shadowL = max(uHead.y, 40.0);",
    "    for (int i = 0; i < 140; i++) {",
    "      if (float(i) >= n * 1.9 || t > t1 || T < 0.02) break;",
    "      vec3 q = ro + rd * t - uGZ;",
    "      vec3 qd = drifted(q);",
    "      float eh = headEnv(qd), es = stemEnv(qd), eu = surgeEnv(q);",
    "      float e = max(max(eh, es), eu);",
    "      if (e < -0.35) { t += stepL * (1.0 + clamp((-e - 0.35) * 2.0, 0.0, 3.0)); continue; }",
    // advected noise coordinates, blended by which part dominates
    "      float wh = exp(6.0 * (eh - e)), ws = exp(6.0 * (es - e)), wu = exp(6.0 * (eu - e));",
    "      float wsum = wh + ws + wu;",
    "      vec3 ch = rollAbout(qd, uHead.x, uHead.z, uRoll.x) / (uHead.y * 3.4) + vec3(0.0, -uRoll.w * 0.004, 0.0);",
    "      float tw = qd.y * 0.00025 + uRoll.w * 0.006;",
    "      vec2 sxz = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * qd.xz;",
    "      vec3 cs = vec3(sxz.x / (uStem.x * 2.2 + 1.0), (qd.y - uRoll.y) / (uStem.x * 4.0 + 1.0), sxz.y / (uStem.x * 2.2 + 1.0));",
    "      vec3 cu = rollAbout(q, uSurge.x, uSurge.y * uSurge.z * 0.55, -uRoll.z) / (uSurge.y * 3.2 + 1.0);",
    "      vec3 c = (ch * wh + cs * ws + cu * wu) / wsum;",
    "      vec4 n1 = noise4(c);",
    "      float base = e + (n1.r - 0.5) * 0.95 + (n1.g - 0.5) * 0.35;",
    "      if (base > 0.0) {",
    "        vec4 n2 = noise4(c * 3.07 + vec3(0.37, 0.11, 0.73));",
    "        float d = base - (1.0 - (n2.g * 0.65 + n2.b * 0.35)) * 0.34 * (1.0 - clamp(base * 1.6, 0.0, 1.0));",
    "        d = clamp(d * 1.7, 0.0, 1.0) * uFade;",
    "        if (d > 0.002) {",
    "          float a = 1.0 - exp(-d * uSigma * stepL);",
    // sun transmittance from the analytic envelope, two taps toward the sun
    "          float o1 = envAll(q + uSunDir * shadowL * 0.45);",
    "          float o2 = envAll(q + uSunDir * shadowL * 1.3);",
    "          float od = max(o1 + 0.35, 0.0) + max(o2 + 0.35, 0.0) * 1.4 + d * 0.6;",
    "          float Ts = exp(-od * 2.6);",
    "          float up = envAll(q + vec3(0.0, shadowL * 0.7, 0.0));",
    "          float occ = clamp(0.85 - up * 1.1, 0.12, 1.0);",
    "          float dustW = (ws + wu) / wsum;",
    "          vec3 alb = mix(mix(uSmokeHot, uSmokeCool, uCool), uDust, dustW);",
    "          vec3 amb = mix(uGndCol, uSkyCol, 0.3 + 0.7 * occ) * (0.16 + 0.55 * occ);",
    "          float fl = exp(-length(q - headC) / (uHead.y * 1.4 + 20.0));",
    "          vec3 lit = alb * (uSunCol * Ts * phase * 2.1 + amb + fireLight * fl * (0.6 + 0.4 * (1.0 - n1.g)));",
    // blackbody emission: the head's heat, breaking through the smoke skin
    "          float heat = uHeat.x * smoothstep(-0.15, 0.55, eh) * (wh / wsum);",
    "          heat = max(heat, uHeat.z * smoothstep(0.25, 0.85, eh + (n1.r - 0.5) * 0.6) * (wh / wsum));",
    "          float skin = smoothstep(0.15, 0.55, heat + (n2.g - 0.5) * 0.55);",
    "          vec3 em = heatCol(heat) * uHeat.y * skin * (0.35 + heat * heat * 1.8);",
    "          vec3 col = lit + em;",
    "          acc += T * a * col;",
    "          T *= 1.0 - a;",
    "          if (tHit < 0.0 && T < 0.7) tHit = t;",
    "        }",
    "      }",
    "      t += stepL;",
    "    }",
    "  }",
    // the fireball sits behind whatever smoke the march found in front of it
    "  if (tBall > 0.0) { acc += T * ballC * ballA; T *= 1.0 - ballA; if (tHit < 0.0 && ballA > 0.3) tHit = tBall; }",
    "",
    // ---- THE DUST SKIRT: the wall of dirt and debris the shock front picks
    // up off the deck and pushes outward, analytic (ray vs the front's
    // cylinder), with a low pall of dust filling everything behind it.
    "  vec3 skirtF = vec3(0.0); float skirtFA = 0.0; float tSkirtF = -1.0;",
    "  if (uSkirt.z > 0.002) {",
    "    vec2 hc = cylHit(ro, rd, uSkirt.x);",
    "    vec3 dl = uDust * (uSunCol * (0.55 + 0.45 * max(uSunDir.y, 0.0)) * 0.9 + uSkyCol * 0.45 + uGndCol * 0.2);",
    // inner pall: path length inside the cylinder and under the haze height
    "    if (uMisc.y > 0.0 && hc.y > 0.0) {",
    "      float a0 = max(hc.x, 0.0), a1 = min(hc.y, tGround);",
    "      float hy = uSkirt.w;",
    "      if (abs(rd.y) > 1e-4) {",
    "        float ty = (uGZ.y + hy - ro.y) / rd.y;",
    "        if (rd.y > 0.0) a1 = min(a1, ty); else a0 = max(a0, ty);",
    "      } else if (ro.y > uGZ.y + hy) { a1 = a0; }",
    "      float L = max(a1 - a0, 0.0);",
    // no hard rim, no flat lid: thin toward the front and toward the top
    "      vec3 pm = ro + rd * (0.5 * (a0 + a1)) - uGZ;",
    "      float edge = (1.0 - smoothstep(uSkirt.x * 0.45, uSkirt.x, length(pm.xz))) * (1.0 - smoothstep(hy * 0.25, hy, pm.y));",
    "      float ia = (1.0 - exp(-L * uMisc.y)) * edge;",
    "      acc += T * dl * 0.85 * ia; T *= 1.0 - ia;",
    "    }",
    "    for (int k = 0; k < 2; k++) {",
    "      float th = k == 0 ? hc.x : hc.y;",
    "      if (th <= 0.0 || th > tGround) continue;",
    "      vec3 ph = ro + rd * th - uGZ;",
    "      if (ph.y > uSkirt.y * 2.2) continue;",
    "      float ang = atan(ph.z, ph.x);",
    "      vec4 nw = noise4(vec3(ang * 1.9, ph.y / (uSkirt.y * 2.4) - uRoll.w * 0.05, uSkirt.x * 0.0004));",
    "      vec4 nv = noise4(vec3(ang * 6.1, ph.y / (uSkirt.y * 0.9), 0.5 + uRoll.w * 0.02));",
    "      float hgt = uSkirt.y * (0.55 + 0.9 * nw.r);",
    "      float prof = (1.0 - smoothstep(hgt * 0.35, hgt, ph.y)) * (0.55 + 0.45 * nv.g);",
    "      float mu = max(abs(dot(rd.xz, normalize(ph.xz))) / max(length(rd.xz), 1e-4), 0.12);",
    "      float sa = clamp((1.0 - exp(-uSkirt.z * prof / mu)), 0.0, 0.96);",
    "      vec3 sc = dl * (0.75 + 0.35 * nv.b);",
    "      if (k == 1) { acc += T * sc * sa; T *= 1.0 - sa; }",
    "      else { skirtF = sc * sa; skirtFA = sa; tSkirtF = th; }",
    "    }",
    "  }",
    "",
    // ---- THE WILSON CLOUD: condensation in the rarefaction behind the
    // front — a pale dome, translucent face-on, dense at the limb, with
    // the brightest band low down where the air is wettest.
    "  vec3 frontC = vec3(0.0); float frontA = 0.0; vec3 backC = vec3(0.0); float backA = 0.0; float tFront = -1.0;",
    "  if (uShell.y > 0.001) {",
    "    vec3 sc = uGZ + vec3(0.0, uShell.z, 0.0);",
    "    vec2 hs = sphereHit(ro, rd, sc, uShell.x);",
    "    for (int k = 0; k < 2; k++) {",
    "      float th = k == 0 ? hs.x : hs.y;",
    "      if (th <= 0.0 || th > tGround) continue;",
    "      vec3 ph = ro + rd * th;",
    "      vec3 nrm = (ph - sc) / uShell.x;",
    "      float mu = max(abs(dot(rd, nrm)), 0.05);",
    "      vec4 nv = noise4(nrm * 1.7 + vec3(uRoll.w * 0.015));",
    "      vec4 nw = noise4(nrm * 5.3 + vec3(0.2, uRoll.w * 0.03, 0.6));",
    "      float nn = nv.r * 0.55 + nw.g * 0.45;",
    "      float band = smoothstep(-0.02, 0.12, nrm.y) * (0.55 + 0.45 * (1.0 - smoothstep(0.1, 0.75, nrm.y)));",
    // a condensation shell has no hard edge: it is mist of uneven thickness,
    // so the limb fades out instead of drawing a glass rim, and it is patchy
    "      float sa = (1.0 - exp(-uShell.y * uShell.w / mu)) * smoothstep(0.35, 0.78, nn) * band * smoothstep(0.02, 0.32, mu);",
    "      sa = clamp(sa, 0.0, 0.55);",
    "      vec3 scol = uSkyCol * 1.05 + uSunCol * (0.45 + 0.55 * max(dot(nrm, uSunDir), 0.0)) * 0.95;",
    "      if (k == 0) { frontC = scol * sa; frontA = sa; tFront = th; } else { backC = scol * sa; backA = sa; }",
    "    }",
    "  }",
    // ---- CONDENSATION AT ALTITUDE: the collar skirt left standing around
    // the stem where the head punched through a moist layer.
    "  if (uCollar.w > 0.002 && abs(rd.y) > 1e-4) {",
    "    float th = (uGZ.y + uCollar.x - ro.y) / rd.y;",
    "    if (th > 0.0 && th < tGround) {",
    "      vec3 ph = ro + rd * th - uGZ;",
    "      float rho = length(ph.xz - uDrift * clamp(uCollar.x / max(uHead.z, 1.0), 0.0, 1.25));",
    "      vec4 nc = noise4(vec3(ph.xz / (uCollar.z * 1.4), 0.37 + uRoll.w * 0.004));",
    "      float ring = smoothstep(uCollar.y, uCollar.y * 1.35, rho) * (1.0 - smoothstep(uCollar.z * 0.7, uCollar.z * (0.95 + 0.25 * nc.r), rho));",
    "      float ca = clamp((1.0 - exp(-uCollar.w / max(abs(rd.y), 0.05))) * ring * smoothstep(0.25, 0.7, nc.g), 0.0, 0.85);",
    "      vec3 ccol = uSkyCol * 0.9 + uSunCol * 0.75;",
    "      if (tHit < 0.0 || th < tHit) { acc = ccol * ca + (1.0 - ca) * acc; } else { acc += T * ccol * ca; }",
    "      T *= 1.0 - ca;",
    "    }",
    "  }",
    "  if (tSkirtF > 0.0) { acc = skirtF + (1.0 - skirtFA) * acc; T *= 1.0 - skirtFA; }",
    "  acc += T * backC; T *= 1.0 - backA;",
    "  acc = frontC + (1.0 - frontA) * acc;",
    "  float alpha = 1.0 - T * (1.0 - frontA);",
    "  if (alpha < 0.004) discard;",
    "  if (tHit < 0.0) tHit = tSkirtF > 0.0 ? tSkirtF : (tFront > 0.0 ? tFront : max(length(ro.xz - uGZ.xz) * 0.85, 1.0));",
    // aerial perspective: huge things far away still fade into the air
    "  float hz = (1.0 - exp(-tHit / uHazeL)) * 0.55;",
    "  acc = mix(acc, uFogCol * alpha, hz);",
    "#ifdef HAS_FRAG_DEPTH",
    "  vec4 clip = projectionMatrix * viewMatrix * vec4(ro + rd * tHit, 1.0);",
    "  gl_FragDepthEXT = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);",
    "#endif",
    "  gl_FragColor = vec4(acc / alpha, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);",
    "}",
  ].join("\n");

  let U = null;             // shared uniforms (one live cloud at a time)
  let mesh = null;
  let meshFailed = false;
  function v3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
  function buildMesh() {
    if (mesh || meshFailed) return mesh;
    try {
      const R = CBZ.renderer;
      const fragDepth = !!(R && R.capabilities && (R.capabilities.isWebGL2 ||
        (R.extensions && R.extensions.has && R.extensions.has("EXT_frag_depth"))));
      U = {
        uNoise: { value: noise.tex },
        uGZ: { value: new THREE.Vector3() },
        uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
        uHead: { value: new THREE.Vector4(0, 100, 50, 1) },
        uStem: { value: new THREE.Vector4(10, 0, 1, 0) },
        uSurge: { value: new THREE.Vector4(0, 10, 0.5, 0) },
        uShell: { value: new THREE.Vector4(1, 0, 0, 10) },
        uHeat: { value: new THREE.Vector4(1, 5, 0, 1) },
        uRoll: { value: new THREE.Vector4() },
        uBall: { value: new THREE.Vector4(1, 0, 1, 0) },
        uSkirt: { value: new THREE.Vector4(1, 30, 0, 0) },
        uMisc: { value: new THREE.Vector4(1, 0, 1, 0) },
        uDrift: { value: new THREE.Vector2() },
        uCollar: { value: new THREE.Vector4(1000, 100, 400, 0) },
        uSigma: { value: 0.03 }, uSteps: { value: 48 }, uHazeL: { value: 9000 }, uFade: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
        uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.7) },
        uGndCol: { value: new THREE.Color(0.3, 0.28, 0.25) }, uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uSmokeHot: { value: v3(STYLE.nuke.smokeHot) }, uSmokeCool: { value: v3(STYLE.nuke.smokeCool) },
        uDust: { value: v3(STYLE.nuke.dust) }, uCool: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: U, vertexShader: VS, fragmentShader: FS,
        defines: fragDepth ? { HAS_FRAG_DEPTH: 1 } : {},
        transparent: true, depthWrite: false, depthTest: true,
        side: THREE.BackSide, fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      mat.extensions = { fragDepth: fragDepth };
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.name = "nukeCloudVolume";
      mesh.frustumCulled = false;
      mesh.renderOrder = 60;           // after the world's opaque + ordinary transparent layers
      mesh.visible = false;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = true;
      scene.add(mesh);
    } catch (e) {
      meshFailed = true; mesh = null;
    }
    return mesh;
  }

  /* ============================================================
     THE FLASH (#nukeFlash, one DOM layer). A double pulse: first maximum,
     the dip while the shock front is opaque, then the longer second pulse.
     ============================================================ */
  // u = t / style.white (0.85 s for the nuke). The first maximum and the
  // minimum are over inside a frame or two (they are millisecond events);
  // the SECOND maximum — the thermal pulse — peaks at t_max = 0.0417*W^0.44
  // = 0.14 s for 16 kt and is what actually blinds. After ~0.5 s the
  // overlay is gone and the overexposed WORLD (fireball light, below)
  // carries the rest: you see the fireball, you do not see a white card.
  const FLASH_DOUBLE = [
    [0.000, 1.00], [0.012, 0.55], [0.035, 0.50], [0.165, 0.94],
    [0.330, 0.48], [0.600, 0.13], [1.000, 0.00],
  ];
  const FLASH_SINGLE = [[0.0, 1.0], [0.22, 0.45], [1.0, 0.0]];
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
  let flashEl = null, flash = null;
  function flashDiv() {
    if (typeof document === "undefined" || !document.body) return null;
    if (flashEl && flashEl.parentNode) return flashEl;
    flashEl = document.getElementById("nukeFlash");
    if (!flashEl) {
      flashEl = document.createElement("div");
      flashEl.id = "nukeFlash";
      // over the HUD, under the pause/menu layers (115+)
      flashEl.style.cssText = "position:fixed;inset:0;background:#fffaf0;opacity:0;pointer-events:none;z-index:80";
      document.body.appendChild(flashEl);
    }
    flashEl.style.transition = "none";
    return flashEl;
  }
  function whiteout(fadeSec, peak, dbl) {
    const el = flashDiv();
    if (!el) return;
    const dur = Math.max(0.12, fadeSec == null ? 2.4 : +fadeSec || 0.12);
    const pk = peak == null ? 1 : clamp(+peak || 0, 0, 1);
    if (flash && flash.peak > pk && flash.t < flash.dur * 0.5) return;
    flash = { t: 0, dur: dur, peak: pk, keys: dbl && C.NUKE_FX_PULSE ? FLASH_DOUBLE : FLASH_SINGLE };
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
    if (flashEl) { try { flashEl.style.opacity = "0"; } catch (e) {} }
  }
  CBZ.cityNukeWhiteout = whiteout;

  /* ============================================================
     THE TIMELINE — every shape parameter as a function of time. This is
     the whole choreography; the shader only draws what this returns.
     ============================================================ */
  function shapeAt(L, t, out) {
    if (L.style.real) return shapeReal(L, t, out);
    out.ballA = 0; out.skirtA = 0; out.pall = 0; out.headP = 1; out.ballGain = 1; out.driftX = 0; out.driftZ = 0;
    const P = L.style, R = L.R;
    const late = sstep(P.form, P.form + (P.dur - P.form) * 0.75, t);   // aftermath growth
    // fireball: Taylor-Sedov R ~ t^0.4 to full size at 1 s, then swelling as it mixes
    const fb = R * (t < 1 ? Math.max(0.08, Math.pow(t, 0.4)) : 1 + 0.35 * easeOut((t - 1) / 5));
    const g = easeOut((t - 1.2) / (P.form - 1.2));                      // formation growth 0..1
    const open = sstep(1.8, 11, t);                                     // sphere -> torus
    const tube = fb * (1 - g) + R * P.tube * g;
    out.tube = tube + (R * P.tubeLate - R * P.tube) * late;
    out.ring = (R * P.ring * g * open) + (R * P.ringLate - R * P.ring) * late;
    out.flat = (1 - open) + P.flat * open + (P.flatLate - P.flat) * late;
    // rise: the ball sits on the deck, then climbs fast and decelerates
    const lift = L.lift || 0;
    const riseN = Math.min(1, (1 - Math.exp(-Math.max(0, t - 0.7) / P.riseTau)) /
                              (1 - Math.exp(-(P.form - 0.7) / P.riseTau)));
    const cyForm = lift + tube * out.flat * 0.5 + R * (P.rise - 0.5) * riseN;
    out.cy = cyForm + (lift + R * P.riseLate - cyForm) * late;
    // stem: dust drawn up off the deck to meet the head
    out.stemR = R * (0.55 + (P.stem - 0.55) * g) + (R * P.stemLate - R * P.stem) * late;
    out.stemTop = Math.max(0, out.cy - out.tube * out.flat * 0.2) * (0.35 + 0.65 * sstep(0.8, 5.0, t)) * sstep(0.6, 1.6, t);
    out.stemFlare = 1.3 + 0.5 * g;
    out.stemP = sstep(1.0, 3.5, t);
    // base surge: out along the deck, decelerating
    out.surgeR = Math.min(R * P.surgeMax, R * P.surgeK * 0.09 * Math.pow(Math.max(0, t - 0.4), 0.8));
    out.surgeTube = R * 0.45 + out.surgeR * 0.10;
    out.surgeFlat = 0.5;
    out.surgeP = sstep(0.4, 2.0, t) * (1 - sstep(P.form * 1.2, P.form * 3.5, t));
    // Wilson condensation shell on the shock front
    if (P.shell) {
      const sr = CBZ.impact && CBZ.impact.shockDistance
        ? CBZ.impact.shockDistance(t, L.eff) : 343 * t + R;
      out.shellR = Math.max(R * 1.05, sr);
      out.shellA = sstep(0.12, 0.3, t) * (1 - sstep(0.8, 2.4, t)) * 0.05;
    } else { out.shellR = 1; out.shellA = 0; }
    // heat: white-hot ball, cooling; the core keeps an ember glow inside the cap
    out.heat = Math.exp(-t / P.heatTau) * (t < 0.25 ? 1 : 0.96);
    out.glow = 0.55 * Math.exp(-t / P.glowTau);
    out.emit = P.emit * (t < 0.6 ? 2.2 - t * 2 : 1) * (C.NUKE_FX_PULSE && P.dbl ? pulseK(t, P) : 1);
    out.fireLight = 2.4 * Math.exp(-t / (P.heatTau * 0.9));
    out.cool = sstep(2, P.form * 0.8, t);
    out.fade = 1 - sstep(P.dur - (P.dur - P.form) * 0.45, P.dur, t);
    return out;
  }
  /* THE REAL TIMELINE (nuke). Every length is metres for THIS yield; the
     curves are REAL's, cube-rooted from 16 kt so a bigger row grows a
     bigger, higher, slower cloud without a second table. */
  function shapeReal(L, t, out) {
    const P = L.style, R = L.R;
    if (!(L.maxR > 0)) L.maxR = R * 26;
    if (L.windX == null) { L.windX = WIND[0]; L.windZ = WIND[1]; }
    const W = yieldKt(L.eff || R);
    const ks = Math.pow(Math.max(0.1, W) / REAL.kt, 1 / 3);       // linear scale vs 16 kt
    const kh = Math.pow(Math.max(0.1, W) / REAL.kt, 0.2);         // cloud height scales slower
    const tt = Math.max(0, t);
    // -- fireball: ~67% of its radius in the first frame, full by ~1 s, then
    // swelling a third again as it entrains air and stops being a ball
    const fb = R * (1 - 0.33 * Math.exp(-tt / 0.22)) * (1 + 0.35 * easeOut((tt - 1) / 6));
    out.ballR = fb;
    // the ball sits on the deck (a surface burst is a dome with a skirt of
    // its own dust) and starts to lift once buoyancy wins, ~2 s
    out.ballY = (L.lift || 0) + fb * 0.28 + R * 1.4 * sstep(1.5, 6, tt) * sstep(1.5, 6, tt);
    // 1.0 white-hot -> 0.72 yellow (1 s) -> 0.55 orange (2.5 s) -> red
    out.ballT = clamp(1.0 - 0.28 * sstep(0.05, 1.0, tt) - 0.2 * sstep(1.0, 3.0, tt) - 0.22 * sstep(2.5, 6.0, tt), 0, 1);
    out.ballGain = 1.0 + 5.0 * Math.exp(-tt / 0.18) + 0.9 * Math.exp(-tt / 1.6);
    // opaque until its own smoke closes over it
    out.ballA = 1 - sstep(1.8, 5.0, tt);
    // -- the rising head (Glasstone's rise and cap curves)
    const top = REAL.top * kh * Math.pow(1 - Math.exp(-tt / REAL.topTau), REAL.topP);
    const capW = Math.max(fb * 2.05, REAL.cap * ks * Math.pow(1 - Math.exp(-tt / REAL.capTau), REAL.capP));
    const half = capW * 0.5;
    const open = sstep(2.5, 14, tt);                                  // ball -> toroid
    out.flat = (1 - open) * 1.0 + open * (0.86 - 0.26 * sstep(40, 420, tt));
    out.ring = half * (0.46 * open);
    out.tube = Math.max(fb * (1 - open) + half * 0.56 * open, fb * 0.9);
    const ballTop = out.ballY + fb;
    const capTop = Math.max(ballTop, top);
    out.cy = Math.max(out.ballY, capTop - out.tube * out.flat * 0.95);
    out.headP = sstep(0.9, 2.6, tt);                                  // smoke skin over the ball
    // -- stem: dirt and debris drawn up into the toroid's low pressure
    out.stemR = Math.max(R * 0.7, capW * (0.085 + 0.075 * sstep(20, 300, tt)));
    out.stemTop = Math.max(0, out.cy - out.tube * out.flat * 0.3) * Math.pow(clamp((tt - 1.5) / 16, 0, 1), 0.5);
    out.stemFlare = 1.1 + 0.3 * sstep(5, 60, tt);
    out.stemP = sstep(2.0, 6.0, tt) * (1 - 0.45 * sstep(240, 800, tt));
    // -- base surge: the dust cloud that rolls out along the deck and stays
    out.surgeR = Math.min(R * 11 * ks, 150 * ks * Math.pow(Math.max(0, tt - 0.6), 0.6));
    out.surgeTube = R * 0.45 + out.surgeR * 0.10;
    out.surgeFlat = 0.5;
    out.surgeP = sstep(0.6, 3.0, tt) * (1 - 0.6 * sstep(300, 850, tt));
    // -- the shock-front dust wall, analytic, for as long as the front is
    // still lifting dirt (out to the 1 psi contour)
    const sr = CBZ.impact && CBZ.impact.shockDistance ? CBZ.impact.shockDistance(tt, L.eff) : 343 * tt + R;
    out.frontR = Math.max(R * 1.1, Math.min(L.maxR * 1.05, sr));
    const reachK = clamp(out.frontR / Math.max(1, L.maxR), 0, 1);
    out.skirtH = (18 + 50 * (1 - reachK)) * ks;
    out.skirtA = sstep(0.12, 0.45, tt) * (1 - sstep(0.75, 1.05, reachK)) * 0.95;
    // dust left standing behind the front: rises and thins over minutes
    out.pallH = (25 + 160 * sstep(0.5, 40, tt)) * ks;
    out.pall = (0.0017 * sstep(0.3, 2.5, tt) * (1 - 0.7 * sstep(20, 400, tt)) + 0.0004) / ks * (1 - sstep(P.dur * 0.8, P.dur, tt));
    // -- Wilson cloud: forms as the negative phase passes (~0.3 s), thickest
    // at 1-2 s, evaporates by ~4 s as the air rewarms
    if (P.shell) {
      out.shellR = Math.max(R * 1.1, sr * 0.82);
      out.shellA = sstep(0.25, 0.8, tt) * (1 - sstep(2.2, 4.2, tt)) * 0.010;
    } else { out.shellR = 1; out.shellA = 0; }
    // -- heat: the head keeps an incandescent core while the skin goes to
    // red-brown NO2 smoke and then to grey-white condensate
    out.heat = clamp(0.9 * Math.exp(-Math.max(0, tt - 1) / 4.5), 0, 1);
    out.glow = 0.62 * Math.exp(-tt / 16);
    out.emit = P.emit * (tt < 0.6 ? 2.2 - tt * 2 : 1);
    out.fireLight = 2.4 * Math.exp(-tt / 5);
    out.cool = sstep(6, 70, tt);
    out.fade = 1 - sstep(P.dur * 0.72, P.dur, tt);
    // -- condensation at altitude: one collar skirt left at the wet layer
    // the head crossed (no ice cap: 16 kt stops well under the tropopause)
    out.collarY = 1500 * kh;
    const crossed = sstep(out.collarY + out.tube * 0.2, out.collarY + out.tube * 1.2, out.cy);
    out.collarA = crossed * (1 - sstep(70, 150, tt)) * 0.06;
    out.collarIn = out.stemR * 1.5;
    out.collarOut = Math.max(out.stemR * 2.2, (out.ring + out.tube) * 0.8);
    // -- wind shear leans the column downwind over the minutes
    const wv = REAL.wind * Math.min(tt, 600) * (0.15 + 0.85 * sstep(10, 120, tt));
    out.driftX = L.windX * wv; out.driftZ = L.windZ * wv;
    return out;
  }
  // The double flash rides the fireball too (the dip darkens the world, not only the div).
  function pulseK(t, P) {
    const w = P.white * 0.72;
    if (t >= w) return 1;
    return 1 - (1 - t / w) * (1 - keyAt(FLASH_DOUBLE, t / P.white)) * 0.9;
  }
  const _S = {};
  const _sunV = new THREE.Vector3();

  /* ============================================================
     THE SEQUENCE
     ============================================================ */
  let live = null;

  function beginSequence(x, y, z, styleName, row, opts) {
    const P = STYLE[styleName] || STYLE.nuke;
    if (!noise.done) noiseStep(null);          // under the whiteout: finish the atlas now
    if (!buildMesh()) return null;
    const gy = floorAt(x, z);
    const radius = fireR(row, opts);
    const R = Math.max(5, radius * P.rFrac);
    const wave = row.wave || null;
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const maxR = (wave && wave.maxR ? wave.maxR : radius * 4) * sc;
    const spd = wave && wave.speed ? wave.speed : 150;
    // an airburst seats the fireball above the deck (clamped so a stray y can't orbit it)
    const burstY = Math.max(gy, Math.min(gy + R * 3, y == null ? gy : (+y || gy)));
    live = {
      kind: row.id || styleName, styleName: styleName, style: P,
      x: x, y: gy, z: z, by: burstY, lift: Math.max(0, burstY - gy - R * 0.5),
      R: R, eff: radius, maxR: maxR, spd: spd, t: 0, dur: P.dur, r: 0,
      pending: [], dustAcc: 0, fogK: 0,
      detonationId: opts._carBlastId || 0,
      mode: (CBZ.game && CBZ.game.mode) || null,
      quiet: !!opts.quiet, byPlayer: !!opts.byPlayer,
      burnR: styleName === "nuke" ? nukeRings(radius).psi2 : 0,
      roll: 0, rollS: 0, rise: 0, steps: 0, box: { min: [0, 0, 0], max: [0, 0, 0] },
      windX: WIND[0], windZ: WIND[1],
    };
    U.uGZ.value.set(x, gy, z);
    U.uSmokeHot.value.set(P.smokeHot[0], P.smokeHot[1], P.smokeHot[2]);
    U.uSmokeCool.value.set(P.smokeCool[0], P.smokeCool[1], P.smokeCool[2]);
    U.uDust.value.set(P.dust[0], P.dust[1], P.dust[2]);
    U.uSigma.value = P.sigma * (126 / Math.max(40, R)) * (styleName === "moab" ? 0.6 : 1);
    mesh.visible = true;

    // Glass: a bus-fired nuke carries its panes in the physical field; a
    // direct call (probe, MOAB) keeps a ladder timed to the front.
    const fieldOwnsGlass = styleName === "nuke" && !!opts._carBlastId &&
      C.IMPACT_SHOCKWAVE !== false && !opts.noDamage;
    if (!fieldOwnsGlass && C.NUKE_FX_GLASS) {
      const GK = glassLadder(styleName);
      const nShatter = Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(1, P.shatter) : P.shatter));
      const step = GK.length / nShatter;
      for (let i = 0; i < nShatter; i++) {
        const k = GK[Math.min(GK.length - 1, Math.max(0, Math.round((i + 0.5) * step - 0.5)))];
        const rr = maxR * k;
        const arrive = styleName === "nuke" && CBZ.impact && CBZ.impact.shockArrival
          ? CBZ.impact.shockArrival(rr, radius) : rr / Math.max(1, spd);
        live.pending.push({ t: Math.max(0.08, arrive), shatter: rr });
      }
    }
    if (!live.quiet) {
      // Blinding at any range, but a distant burst doesn't hold the screen white.
      const d = camDist(x, burstY + R, z);
      // light that reaches the eye straight off the fireball blinds; light
      // scattered by the air from behind you only washes the picture
      let face = 1;
      if (CBZ.camera && CBZ.camera.getWorldDirection) {
        try {
          const f = CBZ.camera.getWorldDirection(_corner), cp = camPos();
          const dx = x - cp.x, dy = burstY + R - cp.y, dz = z - cp.z, dl = Math.hypot(dx, dy, dz) || 1;
          face = clamp(0.8 + 0.2 * ((f.x * dx + f.y * dy + f.z * dz) / dl) * 1.6, 0.8, 1);
        } catch (e) {}
      }
      const pk = P.whitePeak * clamp(1.25 - d / 20000, 0.7, 1) * face;
      whiteout(P.white, pk, P.dbl);
      if (styleName !== "nuke" && CBZ.shake) {
        try { CBZ.shake(P.shake * clamp(1.25 - d / 420, 0.1, 1)); } catch (e) {}
      }
    }
    return live;
  }

  function frontRadius(dt) {
    const L = live;
    if (CBZ.impact && CBZ.impact.waveState) {
      try {
        const ws = CBZ.impact.waveState();
        for (let i = 0; i < ws.length; i++) {
          if (ws[i].kind !== L.kind) continue;
          if (L.detonationId && ws[i].detonationId && ws[i].detonationId !== L.detonationId) continue;
          L.r = ws[i].r; return L.r;
        }
      } catch (e) {}
    }
    if (L.styleName === "nuke" && CBZ.impact && CBZ.impact.shockDistance) {
      L.r = Math.min(L.maxR, CBZ.impact.shockDistance(L.t, L.eff));
    } else L.r = Math.min(L.maxR, L.r + L.spd * dt);
    return L.r;
  }

  const _fogTint = new THREE.Color();
  const _corner = new THREE.Vector3();
  function stepSequence(dt) {
    const L = live, P = L.style;
    L.t += dt;
    const t = L.t;
    if (L.mode && CBZ.game && CBZ.game.mode !== L.mode) { endSequence(); return; }
    if (t >= L.dur) { endSequence(); return; }

    for (let i = L.pending.length - 1; i >= 0; i--) {
      if (t >= L.pending[i].t) {
        const p = L.pending.splice(i, 1)[0];
        if (p.shatter != null && CBZ.cityShatter) { try { CBZ.cityShatter(L.x, L.z, p.shatter); } catch (e) {} }
      }
    }

    // The pressure front is invisible air; what you see is dust it lifts.
    const r = frontRadius(dt);
    if (t < 9 && r < L.maxR && CBZ.cityDustKick) {
      L.dustAcc += dt;
      if (L.dustAcc > 0.18) {
        L.dustAcc = 0;
        const nd = Math.round(CBZ.qScale ? CBZ.qScale(1, 4) : 3);
        const cp = camPos();
        for (let i = 0; i < nd; i++) {
          // bias the kicks toward the part of the ring the player can see
          let a = rng() * 6.2832;
          if (cp && rng() < 0.7) a = Math.atan2(cp.z - L.z, cp.x - L.x) + (rng() - 0.5) * 1.6;
          const px = L.x + Math.cos(a) * r, pz = L.z + Math.sin(a) * r;
          if (cp && Math.hypot(px - cp.x, pz - cp.z) > 1600) continue;
          try { CBZ.cityDustKick(px, floorAt(px, pz) + 0.6, pz, 2.2); } catch (e) {}
        }
      }
    }

    // Sky: a warm, short-lived tint. The air does not stay incandescent.
    if (C.NUKE_FX_SKY && scene.fog && scene.fog.color) {
      const burn = Math.exp(-Math.max(0, t - 0.4) / 3.2);
      const d = camDist(L.x, L.by + L.R, L.z);
      const near = clamp(1.15 - d / 9000, 0.25, 1);
      let k;
      if (t < 0.5) { _fogTint.setHex(0xfff1dc); k = 0.55 * pulseK(t, P); }
      else { _fogTint.setHex(0xff8a3c); k = 0.42 * burn; }
      k *= near * (L.styleName === "moab" ? 0.4 : 1);
      L.fogK = k;
      if (k > 0.004) scene.fog.color.lerp(_fogTint, clamp(k, 0, 0.8));
      // THE DUST STAYS. A surface burst puts hundreds of thousands of tonnes
      // of pulverised city into the air: a brown-grey pall that stands over
      // the whole valley for the rest of the event, and downwind of the
      // column the sky goes dark with what is falling out of it.
      L.dustK = 0; L.falloutK = 0;
      if (P.real) {
        const cp = camPos();
        if (cp) {
          const rx = cp.x - L.x, rz = cp.z - L.z, dist = Math.hypot(rx, rz);
          const along = rx * L.windX + rz * L.windZ, across = Math.abs(rx * L.windZ - rz * L.windX);
          const life = 1 - sstep(P.dur * 0.75, P.dur, t);
          const kd = sstep(1.5, 14, t) * life * clamp(1.25 - dist / 14000, 0, 1) * 0.26;
          const kf = along > 0 ? sstep(40, 260, t) * life * Math.exp(-across / 2600) *
            clamp(along / 1800, 0, 1) * Math.exp(-along / 24000) * 0.5 : 0;
          L.dustK = kd; L.falloutK = kf;
          if (kd > 0.004) scene.fog.color.lerp(_fogTint.setHex(0x8f8170), clamp(kd, 0, 0.6));
          if (kf > 0.004) scene.fog.color.lerp(_fogTint.setHex(0x4a4540), clamp(kf, 0, 0.6));
        }
      }
    }

    // ---- the cloud ------------------------------------------------------
    const S = shapeAt(L, t, _S);
    L.rollS = 1.4 * (1 - Math.exp(-t / 12)) + 0.006 * t;   // poloidal roll: fast early, bounded (no winding)
    L.rise += dt * (S.stemR > 0 ? 35 + 60 * Math.exp(-t / 8) : 0);
    U.uHead.value.set(S.ring, Math.max(4, S.tube), S.cy, Math.max(0.3, S.flat));
    U.uStem.value.set(S.stemR, S.stemTop, S.stemFlare, S.stemP);
    U.uSurge.value.set(S.surgeR, S.surgeTube, S.surgeFlat, S.surgeP);
    U.uShell.value.set(S.shellR, S.shellA, L.by - L.y, Math.max(8, S.shellR * 0.05));
    U.uHeat.value.set(S.heat, S.emit, S.glow, S.fireLight);
    U.uRoll.value.set(L.rollS, L.rise, L.rollS * 0.8, t);
    U.uCool.value = S.cool;
    U.uFade.value = S.fade;
    U.uBall.value.set(S.ballR || 1, S.ballY || 0, S.ballT == null ? 1 : S.ballT, S.ballA || 0);
    U.uSkirt.value.set(S.frontR || 1, S.skirtH || 30, S.skirtA || 0, S.pallH || 0);
    U.uMisc.value.set(S.headP == null ? 1 : S.headP, S.pall || 0, S.ballGain || 1, 0);
    U.uDrift.value.set(S.driftX || 0, S.driftZ || 0);
    U.uCollar.value.set(S.collarY || 1000, S.collarIn || 100, S.collarOut || 400, S.collarA || 0);

    // THE MARCH BOX holds head, stem and surge (and leans with the drift);
    // the PROXY box around it also covers the analytic parts — fireball,
    // Wilson dome, dust wall and pall — which cost no march steps.
    const dx = S.driftX || 0, dz = S.driftZ || 0;
    const headR = S.ring + S.tube * 1.25;
    const surgeR = S.surgeP > 0.01 ? S.surgeR + S.surgeTube * 1.4 : 0;
    const stemW = S.stemP > 0.01 ? S.stemR * (1 + S.stemFlare) * 1.2 : 0;
    const top = S.cy + S.tube * S.flat * 1.5 + 20;
    const mx0 = Math.min(-headR + Math.min(0, dx * 1.25), -stemW, -surgeR) - 10;
    const mx1 = Math.max(headR + Math.max(0, dx * 1.25), stemW, surgeR) + 10;
    const mz0 = Math.min(-headR + Math.min(0, dz * 1.25), -stemW, -surgeR) - 10;
    const mz1 = Math.max(headR + Math.max(0, dz * 1.25), stemW, surgeR) + 10;
    U.uBoxMin.value.set(L.x + mx0, L.y - 2, L.z + mz0);
    U.uBoxMax.value.set(L.x + mx1, L.y + top, L.z + mz1);
    const shellR = S.shellA > 0.0005 ? S.shellR : 0;
    const skirtR = (S.skirtA > 0.002 || S.pall > 0) ? (S.frontR || 0) + 5 : 0;
    const ballR = S.ballA > 0.002 ? (S.ballR || 0) * 1.02 : 0;
    const px0 = Math.min(mx0, -shellR, -skirtR, -ballR), px1 = Math.max(mx1, shellR, skirtR, ballR);
    const pz0 = Math.min(mz0, -shellR, -skirtR, -ballR), pz1 = Math.max(mz1, shellR, skirtR, ballR);
    const ptop = Math.max(top, shellR ? (L.by - L.y) + shellR : 0, skirtR ? Math.max((S.skirtH || 0) * 2.3, S.pallH || 0) + 5 : 0, (S.ballY || 0) + ballR + 5);
    mesh.position.set(L.x + (px0 + px1) * 0.5, L.y - 2 + (ptop + 2) * 0.5, L.z + (pz0 + pz1) * 0.5);
    mesh.scale.set(px1 - px0, ptop + 2, pz1 - pz0);
    L.box.min[0] = L.x + mx0; L.box.min[1] = L.y; L.box.min[2] = L.z + mz0;
    L.box.max[0] = L.x + mx1; L.box.max[1] = L.y + top; L.box.max[2] = L.z + mz1;
    const halfW = Math.max(mx1 - mx0, mz1 - mz0) * 0.5;

    // step budget: quality tier, and fewer when the volume fills the view
    const cp = camPos();
    let steps = [28, 36, 48, 60, 72][Math.round(tier())];
    if (cp) {
      const cx = clamp(cp.x, L.x - halfW, L.x + halfW), cy = clamp(cp.y, L.y, L.y + top), cz = clamp(cp.z, L.z - halfW, L.z + halfW);
      const dIn = Math.hypot(cp.x - cx, cp.y - cy, cp.z - cz);
      const span = Math.max(halfW * 2, top);
      const cover = dIn <= 0 ? 1 : clamp(span / (dIn * 1.1), 0, 1);   // ~fraction of the view it spans
      steps *= 1 - 0.4 * cover;
    }
    L.steps = steps;
    U.uSteps.value = steps;

    // the lights of the world, read every frame (daynight moves them)
    const sun = CBZ.sun, hemi = CBZ.hemi;
    if (sun) {
      _sunV.copy(sun.position);
      if (sun.target) _sunV.sub(sun.target.position);
      if (_sunV.lengthSq() < 1e-6) _sunV.set(0.4, 0.8, 0.2);
      _sunV.normalize();
      if (_sunV.y < 0.02) _sunV.y = 0.02;
      U.uSunDir.value.copy(_sunV).normalize();
      U.uSunCol.value.copy(sun.color).multiplyScalar(Math.min(3, sun.intensity || 0));
    }
    if (hemi) {
      U.uSkyCol.value.copy(hemi.color).multiplyScalar(Math.min(3, hemi.intensity || 0) * 0.9);
      U.uGndCol.value.copy(hemi.groundColor || hemi.color).multiplyScalar(Math.min(3, hemi.intensity || 0) * 0.7);
    }
    if (scene.fog && scene.fog.color) {
      U.uFogCol.value.copy(scene.fog.color);
      U.uHazeL.value = Math.max(6000, (scene.fog.far || 1000) * 7);
    }
  }

  function endSequence() {
    live = null;
    if (mesh) mesh.visible = false;
  }
  CBZ.cityNukeFxAbort = endSequence;

  /* ============================================================
     THE COMPOSERS — what the bus calls: fn(x, y, z, row, opts). Draw only.
     A MOAB (or a master-revert) also fires crashfx's conventional near field.
     ============================================================ */
  function nearField(x, y, z, row, opts) {
    const fn = CBZ.cityAirstrikeExplosion || CBZ.cityExplosion;
    if (!fn) return;
    try {
      fn(x, z, {
        power: Math.max(0.5, (+row.power || 4) * (opts.scale > 0 ? +opts.scale : 1)),
        radius: Math.max(1, +row.radius || 14), y: y,
        byPlayer: !!opts.byPlayer, noDamage: !!opts.noDamage,
        ordnance: row.id || "nuke", _impact: true,
      });
    } catch (e) {}
  }
  function compose(styleName) {
    return function (x, y, z, row, opts) {
      opts = opts || {};
      row = row || {};
      if (!C.NUKE_FX_V1 || styleName === "moab") nearField(x, y, z, row, opts);
      if (!C.NUKE_FX_V1) return;
      if (live) {
        // one cloud on screen at a time; a second flash still lands
        if (!opts.quiet) whiteout(STYLE[styleName].white * 0.4, 0.6, false);
        if (live.styleName === "moab" && styleName === "nuke") endSequence(); else return;
      }
      try { beginSequence(x, y, z, styleName, row, opts); } catch (e) { try { endSequence(); } catch (e2) {} }
    };
  }
  const composeNuke = compose("nuke");
  const composeMoab = compose("moab");

  CBZ.cityNukeFX = function (x, y, z, opts) {
    opts = opts || {};
    const kind = opts.kind === "moab" ? "moab" : "nuke";
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    row = Object.assign(
      { id: kind, power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
        wave: kind === "moab" ? { speed: 140, maxR: 320 } : { model: "nuclear", speed: 343, maxR: 3276 } },
      row || {}, opts.row || {}
    );
    if (opts.power != null) row.power = opts.power;
    if (opts.radius != null) row.radius = opts.radius;
    if (opts.wave !== undefined) row.wave = opts.wave;
    (kind === "moab" ? composeMoab : composeNuke)(x, y == null ? floorAt(x, z) + 1.2 : y, z, row, opts);
    return live;
  };

  /* ============================================================
     CBZ.cityBombWalk(points, opts) — carpet bombing as a SEQUENCE: one
     pooled small blast fired along the line on a stagger, dust merging
     between impacts. Default is draw-only (the B-2 run simulates and
     detonates its own bombs); `detonate: true` fires each through
     CBZ.detonate for callers without a bomb sim. Decimated to WALK_POINTS,
     never truncated, so a stick keeps its length.
     ============================================================ */
  const walks = [];
  const WALK_MAX = 2, WALK_POINTS = 24;
  CBZ.cityBombWalk = function (points, opts) {
    opts = opts || {};
    if (!points || !points.length) return null;
    const kind = opts.kind || "bomb";
    const interval = clamp(opts.interval == null ? 0.24 : +opts.interval, 0.06, 3);
    const willDetonate = opts.detonate === true;
    const budget = willDetonate ? WALK_POINTS
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
      detonate: willDetonate, by: opts.by || null, byPlayer: !!opts.byPlayer, scale: opts.scale || 1,
      dirx: opts.dirx || 0, dirz: opts.dirz || 0, onEach: opts.onEach || null, prev: null, dead: false,
    };
    if (C.BOMB_WALK_V1 === false) {
      for (let i = 0; i < pts.length; i++) dropOne(walk, pts[i]);
      return { cancel: function () {}, points: pts.length };
    }
    while (walks.length >= WALK_MAX) walks.shift();
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
    if (walk.detonate) {
      if (CBZ.detonate) {
        try {
          CBZ.detonate(p.x, y, p.z, walk.kind, {
            by: walk.by, byPlayer: walk.byPlayer, scale: walk.scale, dirx: walk.dirx, dirz: walk.dirz,
          });
        } catch (e) {}
      } else if (CBZ.cityAirstrikeExplosion) {
        try { CBZ.cityAirstrikeExplosion(p.x, p.z, { power: 2.4, radius: 13, byPlayer: walk.byPlayer }); } catch (e) {}
      }
    }
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
      let fired = 0;          // a stalled frame drops at most 3 bombs at once
      while (walk.i < walk.pts.length && walk.t >= walk.i * walk.interval && fired < 3) {
        dropOne(walk, walk.pts[walk.i]);
        walk.i++; fired++;
      }
      if (walk.i >= walk.pts.length) walks.splice(w, 1);
    }
  }

  /* ============================================================
     WIRING — register with the bus whenever it shows up; wrap crashfx's
     run-reset so a fresh run never inherits a cloud.
     ============================================================ */
  let wired = false;
  function wire() {
    if (wired || !CBZ.impact || !CBZ.impact.fx) return;
    wired = true;
    try {
      CBZ.impact.fx("nuke", composeNuke);
      CBZ.impact.fx("moab", composeMoab);
      if (C.NUKE_FX_MOAB && CBZ.impact.row && CBZ.impact.define) {
        const row = CBZ.impact.row("moab");
        if (row && row.fx === "heavy") CBZ.impact.define("moab", Object.assign({}, row, { fx: "moab" }));
      }
    } catch (e) {}
  }
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

  /* onAlways(9.62): after crashfx@9.5 and daynight@2 (which rewrites fog
     colour every frame, so the tint above is stateless), before sky@99
     (which paints its horizon FROM fog colour). On the ALWAYS chain so a
     nuke that kills the player still finishes and cleans up. */
  if (CBZ.onAlways) CBZ.onAlways(9.62, function (dt) {
    wire();
    wrapReset();
    if (!noise.done && CBZ.game && CBZ.game.state === "playing") armIdleBuild();
    if (!live && !walks.length && !flash) return;
    const d = dt > 0.25 ? 0.25 : dt;
    if (flash) { try { stepFlash(d); } catch (e) { flash = null; } }
    if (live) { try { stepSequence(d); } catch (e) { endSequence(); } }
    if (walks.length) { try { stepWalks(d); } catch (e) { walks.length = 0; } }
  });

  /* THE FIREBALL LIGHTS THE WORLD — onAlways(94.6), the one slot after
     core/gfx.js's finalize (@94.5, the last writer of sun/hemi). Values
     only, never an added light, and stateless because daynight + finalize
     rewrite them next frame. */
  const _lightC = new THREE.Color();
  const FIRE_WHITE = new THREE.Color(0xfff6e4);
  const FIRE_ORANGE = new THREE.Color(0xff7c2a);
  const FIRE_EMBER = new THREE.Color(0xc4491a);
  function fireLum(t, L) {
    const P = L.style;
    const flashK = Math.max(0, 1 - t / Math.max(0.01, P.white * 0.72)) * pulseK(t, P);
    const burn = Math.exp(-Math.max(0, t - 0.6) / (P.heatTau * 0.9)) * (1 - sstep(P.form * 0.6, P.form, t));
    return clamp(Math.max(flashK, burn * 0.7), 0, 1);
  }
  function lightAtten(L) {
    const d = camDist(L.x, L.by + L.R, L.z);
    // the real fireball lights the whole valley, not a 300 m bubble
    if (L.style.real) return 1 - 0.55 * clamp((d - 3000) / 14000, 0, 1);
    return d <= 300 ? 1 : 1 - 0.78 * clamp((d - 300) / 2100, 0, 1);
  }
  const _fbDir = new THREE.Vector3(), _sunOff = new THREE.Vector3();
  const DUST_C = new THREE.Color(0x9a8b78);
  /* After the light: the column's own SHADOW and the dust. The cap is miles
     wide and between the sun and the city — standing under it the day
     goes dim; the pall browns the sky light and pulls the horizon in. */
  function cloudShade(L) {
    const P = L.style;
    if (!P.real || !CBZ.sun) return;
    const S = shapeAt(L, L.t, _S2);
    const cp = camPos(); if (!cp) return;
    const sun = CBZ.sun;
    _sunOff.copy(sun.position);
    if (sun.target) _sunOff.sub(sun.target.position);
    if (_sunOff.lengthSq() < 1e-6) return;
    _sunOff.normalize();
    // head centre (with the drift) and an effective radius
    const hx = L.x + (S.driftX || 0) - cp.x, hy = L.y + S.cy - cp.y, hz = L.z + (S.driftZ || 0) - cp.z;
    const along = hx * _sunOff.x + hy * _sunOff.y + hz * _sunOff.z;
    let shade = 0;
    if (along > 0) {
      const off = Math.sqrt(Math.max(0, hx * hx + hy * hy + hz * hz - along * along));
      const rr = S.ring + S.tube * 0.95;
      shade = (1 - sstep(rr * 0.6, rr * 1.08, off)) * sstep(6, 30, L.t) * (S.fade == null ? 1 : S.fade);
    }
    const dk = (L.dustK || 0) + (L.falloutK || 0);
    const k = clamp(shade * 0.78 + dk * 0.55, 0, 0.85);
    L.shadeK = shade;
    if (k > 0.004) {
      sun.intensity *= 1 - k;
      if (CBZ.hemi) {
        CBZ.hemi.intensity *= 1 - k * 0.45;
        if (CBZ.hemi.color) CBZ.hemi.color.lerp(DUST_C, clamp(dk * 0.8 + shade * 0.25, 0, 0.6));
      }
    }
    if (dk > 0.004 && scene.fog && scene.fog.far) {
      scene.fog.far *= 1 - clamp(dk * 0.9, 0, 0.55);
      scene.fog.near *= 1 - clamp(dk * 0.9, 0, 0.55);
    }
  }
  const _S2 = {};
  if (CBZ.onAlways) CBZ.onAlways(94.6, function () {
    if (!live || !C.NUKE_FX_SKY) return;
    const L = live;
    try { cloudShade(L); } catch (e) {}
    const k = fireLum(L.t, L) * lightAtten(L) * (L.styleName === "moab" ? 0.5 : 1);
    if (k <= 0.004) return;
    // HARD SHADOWS OFF THE FIREBALL. For the first seconds the brightest
    // thing in the sky is not the sun; the key light swings to come from
    // the ball, so every building throws a long shadow straight away from
    // ground zero — the photographs' shadow-on-the-wall.
    const sun0 = CBZ.sun;
    if (L.style.real && sun0 && sun0.target && L.t < 5) {
      const w = clamp(k * 1.6, 0, 1) * (1 - sstep(2.5, 5, L.t));
      if (w > 0.01) {
        const tp = sun0.target.position;
        const S = shapeAt(L, L.t, _S2);
        _fbDir.set(L.x - tp.x, L.y + (S.ballY || L.R) - tp.y, L.z - tp.z);
        const dl = _fbDir.length();
        if (dl > 1) {
          _fbDir.multiplyScalar(1 / dl);
          if (_fbDir.y < 0.06) { _fbDir.y = 0.06; _fbDir.normalize(); }
          _sunOff.copy(sun0.position).sub(tp);
          const len = _sunOff.length() || 100;
          _sunOff.multiplyScalar(1 / len).lerp(_fbDir, w).normalize();
          sun0.position.copy(tp).addScaledVector(_sunOff, len);
        }
      }
    }
    if (L.t < 0.45) _lightC.copy(FIRE_WHITE).lerp(FIRE_ORANGE, L.t / 0.45);
    else _lightC.copy(FIRE_ORANGE).lerp(FIRE_EMBER, clamp((L.t - 0.45) / 7, 0, 1));
    const sun = CBZ.sun, hemi = CBZ.hemi, bnc = CBZ.bounce;
    if (sun) { sun.intensity *= 1 + 2.0 * k; if (sun.color) sun.color.lerp(_lightC, 0.8 * k); }
    if (hemi) {
      hemi.intensity *= 1 + 3.0 * k;
      if (hemi.color) hemi.color.lerp(_lightC, 0.85 * k);
      if (hemi.groundColor) hemi.groundColor.lerp(_lightC, 0.7 * k);
    }
    if (bnc && bnc.color) { bnc.color.lerp(_lightC, 0.8 * k); bnc.intensity *= 1 + 1.5 * k; }
  });

  /* ============================================================
     NUMBERS FOR PROBES
     ============================================================ */
  CBZ.nukeFxDebug = function () {
    let L = null;
    if (live) {
      const S = shapeAt(live, live.t, {});
      L = {
        kind: live.kind, t: +live.t.toFixed(2), r: +live.r.toFixed(1),
        x: +live.x.toFixed(1), z: +live.z.toFixed(1), gy: +live.y.toFixed(1), burstY: +live.by.toFixed(1),
        R: +live.R.toFixed(1), eff: +live.eff.toFixed(1), maxR: +live.maxR.toFixed(1),
        burnR: +live.burnR.toFixed(1), fogK: +live.fogK.toFixed(3),
        capW: +((S.ring + S.tube) * 2).toFixed(0), riseH: +S.cy.toFixed(0),
        capWNow: +((S.ring + S.tube) * 2).toFixed(0), capYNow: +(S.cy + live.y).toFixed(0),
        stemWNow: +(S.stemR * 2).toFixed(0), surgeR: +S.surgeR.toFixed(0),
        shellR: +S.shellR.toFixed(0), shellA: +S.shellA.toFixed(4),
        heat: +S.heat.toFixed(3), fade: +S.fade.toFixed(3), steps: Math.round(live.steps),
        ballR: +(S.ballR || 0).toFixed(0), ballA: +(S.ballA || 0).toFixed(2), ballT: +(S.ballT || 0).toFixed(2),
        frontR: +(S.frontR || 0).toFixed(0), skirtA: +(S.skirtA || 0).toFixed(2), pall: +(S.pall || 0).toFixed(5),
        drift: [+(S.driftX || 0).toFixed(0), +(S.driftZ || 0).toFixed(0)], cloudTop: +(S.cy + S.tube * S.flat).toFixed(0),
        lum: +fireLum(live.t, live).toFixed(3),
        box: live.box, volume: !!(mesh && mesh.visible), pending: live.pending.length,
      };
    }
    return {
      wired: wired, live: L,
      flash: flash ? { t: +flash.t.toFixed(2), dur: flash.dur, peak: flash.peak, keys: flash.keys.length } : null,
      walks: walks.map(function (w) { return { kind: w.kind, i: w.i, n: w.pts.length }; }),
      noise: { done: noise.done, slices: noise.z },
      mesh: { built: !!mesh, failed: meshFailed },
      q: tier(),
    };
  };

  CBZ.nukeFxSize = function (kind, opts) {
    opts = opts || {};
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    row = row || { power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
      wave: kind === "moab" ? { speed: 140, maxR: 320 } : { model: "nuclear", speed: 343, maxR: 3276 } };
    const eff = fireR(row, opts);
    const R = Math.max(5, eff * P.rFrac);
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const reach = (row.wave ? row.wave.maxR : eff * 4) * sc;
    const L = { style: P, R: R, eff: eff, lift: 0 };
    const S = shapeAt(L, P.form, {});
    const RD = kind === "nuke" ? nukeDims(R) : null;
    return {
      kind: kind, nearField: +eff.toFixed(1), fireball: +R.toFixed(1), R: +R.toFixed(1),
      capW: +((S.ring + S.tube) * 2).toFixed(1), capY: +S.cy.toFixed(1),
      capH: +(S.tube * S.flat * 2).toFixed(1), stemW: +(S.stemR * 2).toFixed(1),
      cloudTop: +(S.cy + S.tube * S.flat).toFixed(1),
      yieldKt: RD ? +RD.W.toFixed(2) : null, mature: RD,
      reach: +reach.toFixed(1),
      burnR: +(kind === "nuke" ? nukeRings(eff).psi2 : 0).toFixed(1),
      volumeDraws: 1, whiteDome: !!P.shell, groundRings: 0,
    };
  };

  // The event as numbers, without firing it: beats, zones, formation shape.
  CBZ.nukeFxAudit = function (kind, opts) {
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    const S = CBZ.nukeFxSize(kind, opts);
    const T = kind === "nuke" ? nukeRings(S.nearField) : null;
    const zones = T ? {
      fireball: S.fireball, severe: +T.psi20.toFixed(1), flatten: +T.psi5.toFixed(1),
      burn: +T.psi2.toFixed(1), glass: +T.psi1.toFixed(1), rad500: +T.rad500.toFixed(1), reach: S.reach,
    } : { fireball: S.fireball, reach: S.reach };
    const L = { style: P, R: S.R, eff: S.nearField, lift: 0 };
    const at = function (t) {
      const s = shapeAt(L, t, {});
      return { t: t, capW: Math.round((s.ring + s.tube) * 2), capY: Math.round(s.cy),
        stemW: Math.round(s.stemR * 2), surgeR: Math.round(s.surgeR), heat: +s.heat.toFixed(2) };
    };
    const beats = {
      whiteout: 0, secondMax: P.dbl ? +(0.185 * P.white).toFixed(3) : -1,
      shellOut: P.shell ? 2.6 : -1, formation: P.form, end: P.dur,
      glassAt: glassLadder(kind).map(function (k) {
        const rr = S.reach * k;
        return +(kind === "nuke" && CBZ.impact && CBZ.impact.shockArrival
          ? CBZ.impact.shockArrival(rr, S.fireball) : rr / (kind === "moab" ? 140 : 343)).toFixed(2);
      }),
    };
    const form = at(P.form);
    const ok = {
      zonesOrdered: !T || (zones.flatten < zones.burn && zones.burn < zones.glass),
      capWiderThanStem: form.capW > form.stemW * 2.5,
      capAboveGround: form.capY > S.R * 4,
      endsClean: shapeAt(L, P.dur, {}).fade <= 0.001,
      noGroundRings: true,
    };
    return { kind: kind, beats: beats, zones: zones, size: S,
      curve: [0.5, 1, 3, 8, 15, 26, P.form, P.form + 60].map(at), ok: ok };
  };
})();
