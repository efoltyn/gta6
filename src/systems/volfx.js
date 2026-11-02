/* ============================================================
   systems/volfx.js — THE VOLUMETRIC FIRE AND SMOKE (CBZ.volfx), and the
   shared 3D noise every volume in the game marches (CBZ.volNoise).

   OWNER (2026-10-20, Cell Block Z): "the RPG explosion is very 2D, and fire
   sucks." Both were stacks of camera-facing sprites (city/crashfx.js's
   spawnPuff): a soft disc that turns to face you wherever you stand, so a
   fireball was a pile of flat cards and a debris fire was a fountain of
   orange dots. You can see them rotate as you walk round them.

   This file is the nuke's technique (city/nukefx.js: one box-proxy mesh, a
   fragment shader that marches a density field through it, Beer-Lambert
   extinction, a blackbody emission term) brought down to the scale of a
   rocket and a burning pile of debris, on THE SAME noise atlas. The atlas
   used to live inside nukefx.js; it lives here now and nukefx reads it, so
   there is one 64^3 noise volume in the game, built once in idle slices.

   WHAT A REAL HE DETONATION LOOKS LIKE (the reference this is built to):
     - the fireball reaches ~90% of its radius within about a millisecond and
       its luminous phase is over in tens of milliseconds: a short, hard
       flash, not a lingering orange ball. Here: white-hot for ~40 ms,
       through orange to nothing by ~0.2 s.
     - what is left is a dark grey-black ball of detonation soot and
       pulverised material that rolls and climbs quickly, lit on the side
       facing the light and from inside by the dying fire.
     - a ring of dust off the floor and the walls races out with the shock,
       in the colour of whatever was hit.
     - sparks (burning fragments) in fast straight streaks, a few embers.
     - indoors the smoke hits the ceiling and spreads under it.
   WHAT A FIRE LOOKS LIKE: a turbulent flame body, yellow-white at the root,
   orange in the middle, red and broken at the tips, leaning with the air;
   dark sooty smoke rising off the tips; the light on everything round it
   flickering with the flame.

   HOW IT IS DRAWN. Each live effect is one axis-aligned box mesh (BackSide,
   depth-tested, no depth write) sized at spawn to the room it is in: five
   short rays (up, and the four horizontals) against CBZ.losBlockers find the
   ceiling and the walls, and the box stops just short of them. Inside it the
   shader marches the field. Because the box never pokes through a wall or a
   ceiling, the walls in front of it occlude it and the walls behind it never
   swallow it. Every box shares ONE program (the materials differ only in
   uniform values), compiled at boot by core/fxwarm.js with everything else.

   COST (iPad): one draw call per live effect, frustum culled; empty box
   space is skipped on the envelope test without a texture fetch; step count
   rides the quality slider (CBZ.qScale) and is capped on phones. No lights
   are added: the fire's flicker drives crashfx's one pooled flash light
   (an added light would recompile every r128 material). No per-frame
   allocation. If the atlas has not finished building yet the shader falls
   back to ALU value noise on the same branch of the same program.

   Sparks are one LineSegments-style ribbon mesh (one draw call): each spark
   is a camera-facing quad stretched along its own velocity, bright at the
   head and fading to nothing at the tail, so a fragment reads as a streak.

   API
     CBZ.volfx.blast(x, y, z, o)   o: { P, soot:[r,g,b], dust:[r,g,b],
                                        nrm:{x,y,z}, floorY, dustOn, life }
                                   -> true when a volume was spawned
     CBZ.volfx.fire(x, y, z, o)    o: { size, dur, soot }  -> handle | null
                                   handle: { alive, flicker, x, y, z, size }
     CBZ.volfx.sparks(x, y, z, n, o)  o: { speed, nrm, ember, floorY, life }
     CBZ.volfx.reset() / audit()
     CBZ.volNoise                  { done, tex, z, step(ms), finish(), arm(), onReady(fn) }
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.volfx) return;
  const THREE = window.THREE;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function floorAt(x, z, y) { return CBZ.floorAt ? (CBZ.floorAt(x, z, y) || 0) : 0; }
  let _rs = 0x2f6b31;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }
  function mobile() { return !!CBZ.isMobileDevice; }
  function q01() { return CBZ.qScale ? CBZ.qScale(0, 1) : 1; }

  /* ============================================================
     THE NOISE ATLAS (moved here from city/nukefx.js, unchanged).
     64^3 tileable noise stored as 64 slices of 64x64 in an 8x8 atlas with a
     1-texel wrap border (528x528 RGBA8), so it works in WebGL1 and 2 alike.
       R  perlin-worley billow (low frequency: the big cauliflower lumps)
       G  worley fbm           (mid: edge erosion)
       B  perlin fbm           (fine: wisps)
     Built in idle slices once a game is playing; finish() completes it
     synchronously (the nuke does that behind its whiteout).
     ============================================================ */
  const NS = 64, TILE = NS + 2, ATL = TILE * 8;
  const noise = { data: null, tex: null, z: 0, done: false };
  const readyFns = [];
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
    return acc;
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
    return Math.min(1, Math.sqrt(best));
  }
  const _vox = new Uint8Array(NS * NS * 4);
  function buildSlice(z) {
    const f = 1 / NS;
    for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
      const px = x * f, py = y * f, pz = z * f;
      const pf = perlin(px * 4, py * 4, pz * 4, 4, 11) * 0.62 +
                 perlin(px * 8, py * 8, pz * 8, 8, 12) * 0.28 +
                 perlin(px * 16, py * 16, pz * 16, 16, 13) * 0.10;
      const w1 = 1 - worley(px * 4, py * 4, pz * 4, 4, 21);
      const p01 = clamp(pf * 0.9 + 0.5, 0, 1);
      const billow = clamp((p01 - (1 - w1)) / (1 - (1 - w1) * 0.999), 0, 1) * 0.55 + w1 * 0.45;
      const wg = (1 - worley(px * 6, py * 6, pz * 6, 6, 31)) * 0.62 +
                 (1 - worley(px * 12, py * 12, pz * 12, 12, 32)) * 0.26 +
                 (1 - worley(px * 24, py * 24, pz * 24, 24, 33)) * 0.12;
      const pb = perlin(px * 16, py * 16, pz * 16, 16, 41) * 0.66 + perlin(px * 32, py * 32, pz * 32, 32, 42) * 0.34;
      const o = (y * NS + x) * 4;
      _vox[o] = Math.round(clamp(billow, 0, 1) * 255);
      _vox[o + 1] = Math.round(clamp(wg, 0, 1) * 255);
      _vox[o + 2] = Math.round(clamp(pb * 0.9 + 0.5, 0, 1) * 255);
      _vox[o + 3] = 255;
    }
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
      for (let i = 0; i < readyFns.length; i++) { try { readyFns[i](noise.tex); } catch (e) {} }
      readyFns.length = 0;
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
  CBZ.volNoise = {
    get done() { return noise.done; },
    get tex() { return noise.tex; },
    get z() { return noise.z; },
    step: noiseStep,
    finish: function () { return noiseStep(null); },
    arm: armIdleBuild,
    onReady: function (fn) { if (noise.done) { try { fn(noise.tex); } catch (e) {} } else readyFns.push(fn); },
  };

  const scene = CBZ.scene;
  if (!scene) return;

  /* ============================================================
     THE VOLUME SHADER — one program, two fields (uMode 0 blast, 1 fire)
     ============================================================ */
  const VS = [
    "varying vec3 vWorld;",
    "void main() {",
    "  vec4 w = modelMatrix * vec4(position, 1.0);",
    "  vWorld = w.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * w;",
    "#ifdef HEAVY",
    "  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);",
    "#endif",
    "}",
  ].join("\n");

  const FS = [
    "uniform sampler2D uNoise; uniform float uHasNoise;",
    "uniform vec3 uC; uniform vec3 uBoxMin; uniform vec3 uBoxMax;",
    "uniform float uMode; uniform float uT; uniform float uSteps; uniform float uSeed;",
    "uniform vec4 uBall;",    // fireball radius, fireball temperature, smoke radius, smoke rise
    "uniform vec4 uSmoke;",   // sigma, fade, ceiling squash, dust presence
    "uniform vec4 uShock;",   // shell radius, shell alpha, dust ring radius, dust ring height
    "uniform vec4 uFire;",    // flame height, base radius, intensity, smoke presence
    "uniform vec4 uHeat;",    // emission gain, core glow, fire-light gain, floor y (local)
    "uniform vec3 uNrm; uniform vec2 uWind; uniform float uCeil;",
    // HEAVY: the stick axis a carpet's merged cloud is drawn along (xyz from
    // uC, 0 for one bomb), the newest fireball's seat, and the heavy look
    // (dust share of the cloud, fine octave on, time scale, spare)
    "uniform vec3 uSeg; uniform vec3 uFC; uniform vec4 uHv;",
    "#ifdef HEAVY",
    "uniform mat4 projectionMatrix;",
    "#endif",
    "uniform vec3 uSoot; uniform vec3 uDust;",
    "uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uAmb; uniform vec3 uGnd;",
    "uniform vec3 uFogCol; uniform vec3 uFogP; uniform float uTM;",
    "varying vec3 vWorld;",
    "",
    "float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }",
    "float vn(vec3 p) {",
    "  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(h13(i), h13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 0.0)), h13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),",
    "             mix(mix(h13(i + vec3(0.0, 0.0, 1.0)), h13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 1.0)), h13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);",
    "}",
    // the shared atlas (city/nukefx.js reads the same texture), or ALU value
    // noise while the atlas is still being built
    "vec4 noise4(vec3 p) {",
    "  if (uHasNoise > 0.5) {",
    "    p = fract(p);",
    "    float zf = p.z * 64.0; float z0 = floor(zf); float fz = zf - z0; float z1 = mod(z0 + 1.0, 64.0);",
    "    vec2 inner = p.xy * 64.0 + 1.5;",
    "    vec2 t0 = vec2(mod(z0, 8.0), floor(z0 / 8.0)) * 66.0;",
    "    vec2 t1 = vec2(mod(z1, 8.0), floor(z1 / 8.0)) * 66.0;",
    "    return mix(texture2D(uNoise, (t0 + inner) / 528.0), texture2D(uNoise, (t1 + inner) / 528.0), fz);",
    "  }",
    "  vec3 q = p * 6.0;",
    "  float a = vn(q) * 0.65 + vn(q * 2.03 + 3.1) * 0.35;",
    "  float b = vn(q * 1.7 + 7.3);",
    "  return vec4(a, b, a * 0.5 + b * 0.5, 1.0);",
    "}",
    "vec3 heatCol(float x) {",
    "  vec3 c = mix(vec3(0.0), vec3(0.55, 0.05, 0.01), smoothstep(0.03, 0.2, x));",
    "  c = mix(c, vec3(1.0, 0.30, 0.04), smoothstep(0.2, 0.45, x));",
    "  c = mix(c, vec3(1.0, 0.66, 0.22), smoothstep(0.45, 0.72, x));",
    "  c = mix(c, vec3(1.0, 0.95, 0.84), smoothstep(0.72, 1.0, x));",
    "  return c;",
    "}",
    "vec3 smokeCentre() { return uNrm * uBall.x * 0.35 + vec3(uWind.x * uT * 0.18, uBall.w, uWind.y * uT * 0.18); }",
    // blast envelope: ~1 at the core, 0 at the skin, negative outside; .y = dust share
    "vec2 envBlast(vec3 q) {",
    "  float hs = dot(uSeg, uSeg) > 1e-4 ? clamp(dot(q, uSeg) / dot(uSeg, uSeg), 0.0, 1.0) : 0.0;",
    "  q -= uSeg * hs;",
    "  vec3 sc = smokeCentre();",
    "  vec3 d = q - sc;",
    "  d.y /= max(0.35, 1.0 - 0.5 * uSmoke.z); d.xz /= 1.0 + 0.7 * uSmoke.z;",
    "  float e = 1.0 - length(d) / uBall.z;",
    // the debris-laden stalk the ball drags up off the seat
    "  float h = clamp(dot(q, sc) / max(dot(sc, sc), 1e-3), 0.0, 1.0);",
    "  float es = 1.0 - length(q - sc * h) / (uBall.z * 0.42);",
    "  e = max(e, es - 0.3);",
    "  float dw = 0.0;",
    "  if (uSmoke.w > 0.001) {",
    "    float rho = length(q.xz); float yy = q.y - uHeat.w;",
    "    vec2 m = vec2((rho - uShock.z) / max(uShock.z * 0.45, 0.4), yy / uShock.w - 0.35);",
    "    float ring = 1.0 - length(m);",
    "    float disc = min(1.0 - rho / (uShock.z + 0.2), 1.0 - yy / (uShock.w * 0.7)) * 0.55;",
    "    float ed = max(ring, disc) - (1.0 - uSmoke.w) * 1.4;",
    "    dw = smoothstep(-0.1, 0.25, ed - e);",
    "    e = max(e, ed);",
    "  }",
    "  return vec2(e, dw);",
    "}",
    // a ray against a sphere at the seat: near and far hits
    "vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {",
    "  vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r;",
    "  float h = b * b - cc; if (h <= 0.0) return vec2(-1.0);",
    "  h = sqrt(h); return vec2(-b - h, -b + h);",
    "}",
    "",
    "void main() {",
    "  vec3 ro = cameraPosition;",
    "  vec3 rd = normalize(vWorld - ro);",
    "  vec3 inv = 1.0 / (sign(rd) * max(abs(rd), vec3(1e-5)) + vec3(step(abs(rd), vec3(0.0))) * 1e-5);",
    "  vec3 ta = (uBoxMin - ro) * inv, tb = (uBoxMax - ro) * inv;",
    "  vec3 tmn = min(ta, tb), tmx = max(ta, tb);",
    "  float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);",
    "  float t1 = min(min(tmx.x, tmx.y), tmx.z);",
    "  if (t1 <= t0) discard;",
    "  float n = max(uSteps, 4.0);",
    "  float stepL = (t1 - t0) / n;",
    "  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));",
    "  float t = t0 + stepL * jit;",
    "  vec3 acc = vec3(0.0); vec3 accE = vec3(0.0); float T = 1.0; float tHit = -1.0;",
    "  vec3 seed = vec3(uSeed, uSeed * 1.73, uSeed * 0.61);",
    "#ifdef HEAVY",
    // the step is the cloud's scale, not the box's (the box also holds the
    // dust skirt, which is wide and low): fine where the cloud is, skipped
    // fast where it is not
    "  stepL = min(stepL, uBall.z * 0.13);",
    "  t = t0 + stepL * jit;",
    // ---------------- THE HEAVY BLAST (a bomb, a cruise missile's warhead) ---
    // Same field as the light blast, drawn as a cloud that is metres to tens of
    // metres across: three octaves of billow, a hard cauliflower skin, and two
    // shadows per sample (the whole cloud's, read off the envelope toward the
    // sun, and the lump's own, one short tap toward the sun through the real
    // density), so every lump has a lit crown and a dark crevice. Deep inside
    // the sky light is occluded; the underside sees the ground's bounce.
    "  {",
    "    vec3 sc = smokeCentre();",
    "    float ts = max(1.0, uHv.z);",
    "    float roll = uT * 0.8 / ts;",
    "    float cr = cos(roll), sr = sin(roll);",
    "    vec3 Lk = uKeyDir;",
    "    float cosT = dot(rd, Lk);",
    "    float ph = 0.55 + 1.1 * pow(max(cosT, 0.0), 8.0) + 0.25 * max(-cosT, 0.0);",
    "    float rs = uBall.z;",
    "    float tFirst = -1.0;",
    "    for (int i = 0; i < 96; i++) {",
    "      if (float(i) >= n * 2.0 || T < 0.02) break;",
    "      vec3 q = ro + rd * t - uC;",
    "      vec2 ev = envBlast(q);",
    "      if (ev.x > -0.35) {",
    "        float hs = dot(uSeg, uSeg) > 1e-4 ? clamp(dot(q, uSeg) / dot(uSeg, uSeg), 0.0, 1.0) : 0.0;",
    "        vec3 along = uSeg * hs;",
    "        vec3 d = q - along - sc;",
    "        float rho = length(d.xz); vec2 dir = rho > 1e-3 ? d.xz / rho : vec2(1.0, 0.0);",
    "        vec2 m = vec2(rho, d.y); m = vec2(cr * m.x - sr * m.y, sr * m.x + cr * m.y);",
    "        vec3 c = (vec3(dir.x * m.x, m.y, dir.y * m.x) + along) / (rs * 2.1) + seed + vec3(0.0, -uT * 0.03 / ts, 0.0);",
    "        vec4 n1 = noise4(c);",
    "        float base = ev.x + (n1.r - 0.5) * 0.9 + (n1.g - 0.5) * 0.3;",
    "        if (base > -0.06) {",
    "          vec4 n2 = noise4(c * 2.9 + vec3(0.37, 0.11, 0.73));",
    "          float det = (n2.r - 0.5) * 0.34 + (n2.g - 0.5) * 0.16;",
    "          if (uHv.y > 0.5 && base < 0.3) { vec4 n3 = noise4(c * 8.3 + vec3(0.71, 0.29, 0.13)); det += (n3.g - 0.5) * 0.13 + (n3.b - 0.5) * 0.05; }",
    "          float b2 = base + det * (1.0 - smoothstep(0.15, 0.7, base));",
    "          float dens = smoothstep(-0.02, 0.2, b2) * (0.55 + 0.45 * smoothstep(0.1, 0.6, b2)) * uSmoke.y;",
    "          float a = 1.0 - exp(-dens * uSmoke.x * stepL);",
    "          if (a > 0.002) {",
    "            if (tFirst < 0.0) tFirst = t;",
    // the cloud's own shadow: two envelope taps toward the light
    "            float o1 = envBlast(q + Lk * rs * 0.5).x;",
    "            float o2 = envBlast(q + Lk * rs * 1.25).x;",
    "            float big = max(o1 + 0.3, 0.0) * 1.5 + max(o2 + 0.3, 0.0) * 1.0;",
    // the lump's own shadow: the density one short step toward the light
    "            vec3 q2 = q + Lk * rs * 0.14;",
    "            float e2 = envBlast(q2).x;",
    "            float h2 = dot(uSeg, uSeg) > 1e-4 ? clamp(dot(q2, uSeg) / dot(uSeg, uSeg), 0.0, 1.0) : 0.0;",
    "            vec3 d2 = q2 - uSeg * h2 - sc;",
    "            float rho2 = length(d2.xz); vec2 dir2 = rho2 > 1e-3 ? d2.xz / rho2 : vec2(1.0, 0.0);",
    "            vec2 m2 = vec2(rho2, d2.y); m2 = vec2(cr * m2.x - sr * m2.y, sr * m2.x + cr * m2.y);",
    "            vec4 nl = noise4((vec3(dir2.x * m2.x, m2.y, dir2.y * m2.x) + uSeg * h2) / (rs * 2.1) + seed + vec3(0.0, -uT * 0.03 / ts, 0.0));",
    "            float bl = e2 + (nl.r - 0.5) * 0.9 + (nl.g - 0.5) * 0.3;",
    "            float loc = max(bl, 0.0) * 2.4;",
    "            float Ts = exp(-(big + loc) * 1.7);",
    // what the multiply-scattered light still carries into the shadow side
    "            float ms = 0.32 * exp(-(big + loc) * 0.4);",
    "            float up = clamp(0.5 + 0.5 * (q.y - sc.y) / rs, 0.0, 1.0);",
    "            float occ = exp(-max(ev.x, 0.0) * 1.6);",
    "            vec3 alb = mix(mix(uSoot, uDust, uHv.x), uDust, ev.y);",
    "            vec3 amb = mix(uGnd * 1.1, uAmb, up) * (0.42 + 0.58 * occ);",
    "            vec3 fq = q - uFC;",
    "            float fl = uHeat.z / (1.0 + dot(fq, fq) / (uBall.x * uBall.x + 0.3));",
    "            float powder = 1.0 - exp(-dens * 4.0);",
    "            vec3 lit = alb * (uKeyCol * (Ts * ph * 2.1 + ms) * (0.6 + 0.4 * powder) + amb + vec3(1.0, 0.42, 0.1) * fl);",
    // the fireball: white-hot, then orange, then gone; then a glow in the core
    // the fireball: turbulent, not a lamp. White-hot cells, orange tongues,
    // and the detonation soot closing over it in streaks as it cools
    "            float rf = length(fq) + (n1.r - 0.5) * uBall.x * 0.8;",
    "            float hot = uBall.y * (1.0 - smoothstep(uBall.x * 0.25, uBall.x * 1.05, rf)) * (0.7 + 0.6 * n2.g);",
    "            hot = max(hot, uHeat.y * smoothstep(0.3, 0.85, base + (n1.g - 0.5) * 0.6) * (1.0 - ev.y) * exp(-length(fq) / (uBall.x * 1.6 + 1.0)));",
    "            float sootIn = smoothstep(0.42, 0.62, n2.r * 0.7 + n1.b * 0.3 + 0.55 * (1.0 - uBall.y));",
    "            hot = clamp(hot * (1.0 - 0.85 * sootIn), 0.0, 1.0);",
    "            vec3 em = heatCol(hot) * uHeat.x * hot * (0.35 + hot * 1.7);",
    "            acc += T * a * lit; accE += T * a * em;",
    "            T *= 1.0 - a;",
    "            if (tHit < 0.0 && T < 0.5) tHit = t;",
    "          }",
    "        }",
    "        t += stepL;",
    "      } else {",
    "        t += stepL * (1.0 + clamp((-ev.x - 0.35) * 4.0, 0.0, 6.0));",
    "      }",
    "      if (t > t1) break;",
    "    }",
    "    if (tHit < 0.0) tHit = tFirst;",
    // the pressure wave: a faint pale shell racing out for a few frames
    "    if (uShock.y > 0.002) {",
    "      vec2 hsh = sphereHit(ro, rd, uC + uFC, uShock.x);",
    "      float th = hsh.x > 0.0 ? hsh.x : hsh.y;",
    "      if (th > t0 && th < t1) {",
    "        vec3 nrm = (ro + rd * th - uC - uFC) / uShock.x;",
    "        float limb = 1.0 - abs(dot(rd, nrm));",
    "        float sa = uShock.y * limb * limb * limb;",
    "        acc += T * (uAmb * 1.4 + uKeyCol * 0.4 + uDust * 0.5) * sa;",
    "        T *= 1.0 - sa;",
    "      }",
    "    }",
    "  }",
    "#else",
    "  if (uMode < 0.5) {",
    // ---------------- THE BLAST ----------------
    "    vec3 sc = smokeCentre();",
    "    vec3 fc = uNrm * uBall.x * 0.25;",
    "    float roll = uT * 0.8;",
    "    float cr = cos(roll), sr = sin(roll);",
    "    for (int i = 0; i < 40; i++) {",
    "      if (float(i) >= n || T < 0.03) break;",
    "      vec3 q = ro + rd * t - uC;",
    "      vec2 ev = envBlast(q);",
    "      if (ev.x > -0.3) {",
    // noise rolls outward-and-up about the ball's centre: the radial/vertical
    // plane turns over with time (the roll every HE smoke ball shows)
    "        vec3 d = q - sc;",
    "        float rho = length(d.xz); vec2 dir = rho > 1e-3 ? d.xz / rho : vec2(1.0, 0.0);",
    "        vec2 m = vec2(rho, d.y); m = vec2(cr * m.x - sr * m.y, sr * m.x + cr * m.y);",
    "        vec3 c = vec3(dir.x * m.x, m.y, dir.y * m.x) / (uBall.z * 2.4) + seed + vec3(0.0, -uT * 0.05, 0.0);",
    "        vec4 n1 = noise4(c);",
    "        float base = ev.x + (n1.r - 0.5) * 0.95 + (n1.g - 0.5) * 0.35;",
    "        if (base > 0.0) {",
    "          float dens = clamp(base * 2.2, 0.0, 1.0);",
    "          if (base < 0.4) { vec4 n2 = noise4(c * 3.1 + vec3(0.37, 0.11, 0.73)); dens *= 0.45 + 0.9 * n2.g; }",
    "          dens *= uSmoke.y;",
    "          float a = 1.0 - exp(-dens * uSmoke.x * stepL);",
    "          if (a > 0.001) {",
    // one tap of the envelope toward the light: the lit side is bright, the
    // core and the shadow side are soot (this is what gives the lit edges)
    "            float o1 = envBlast(q + uKeyDir * uBall.z * 0.6).x;",
    "            float Ts = exp(-max(o1 + 0.3, 0.0) * 2.6 - dens * 0.6);",
    "            float up = clamp(0.5 + 0.5 * (q.y - sc.y) / uBall.z, 0.0, 1.0);",
    "            vec3 alb = mix(uSoot, uDust, ev.y);",
    "            vec3 amb = mix(uGnd, uAmb, up) * (0.55 + 0.45 * (1.0 - dens));",
    "            vec3 fq = q - fc;",
    "            float fl = uHeat.z / (1.0 + dot(fq, fq) / (uBall.x * uBall.x + 0.3));",
    "            vec3 lit = alb * (uKeyCol * Ts * 1.5 + amb + vec3(1.0, 0.42, 0.1) * fl);",
    // the fireball: white-hot, then orange, then gone; afterwards a little
    // glow left deep in the core, broken up by the soot
    "            float rf = length(fq) + (n1.r - 0.5) * uBall.x * 0.7;",
    "            float hot = uBall.y * (1.0 - smoothstep(uBall.x * 0.3, uBall.x * 1.05, rf));",
    "            hot = max(hot, uHeat.y * smoothstep(0.3, 0.85, base + (n1.g - 0.5) * 0.6) * (1.0 - ev.y));",
    "            hot = clamp(hot, 0.0, 1.0);",
    "            vec3 em = heatCol(hot) * uHeat.x * hot * (0.35 + hot * 1.7);",
    "            acc += T * a * lit; accE += T * a * em;",
    "            T *= 1.0 - a;",
    "            if (tHit < 0.0 && T < 0.6) tHit = t;",
    "          }",
    "        }",
    "        t += stepL;",
    "      } else {",
    "        t += stepL * (1.0 + clamp((-ev.x - 0.3) * 2.0, 0.0, 2.0));",
    "      }",
    "      if (t > t1) break;",
    "    }",
    // the pressure wave: a faint pale shell racing out for a few frames
    "    if (uShock.y > 0.002) {",
    "      vec2 hs = sphereHit(ro, rd, uC, uShock.x);",
    "      float th = hs.x > 0.0 ? hs.x : hs.y;",
    "      if (th > t0 && th < t1) {",
    "        vec3 nrm = (ro + rd * th - uC) / uShock.x;",
    "        float limb = 1.0 - abs(dot(rd, nrm));",
    "        float sa = uShock.y * limb * limb * limb;",
    "        acc += T * (uAmb * 1.4 + uKeyCol * 0.4 + uDust * 0.5) * sa;",
    "        T *= 1.0 - sa;",
    "      }",
    "    }",
    "  } else {",
    // ---------------- THE FIRE ----------------
    "    float H = uFire.x, Rb = uFire.y;",
    "    for (int i = 0; i < 40; i++) {",
    "      if (float(i) >= n || T < 0.03) break;",
    "      vec3 q = ro + rd * t - uC;",
    "      float u = q.y / H;",
    "      vec3 ql = q; ql.xz -= uWind * H * 0.3 * u * u;",
    "      float rho = length(ql.xz);",
    // the flame body: wide at the root, narrowing and breaking up at the tips
    "      float r = Rb * (1.0 - 0.78 * smoothstep(0.0, 1.05, u)) * (0.72 + 0.28 * smoothstep(-0.05, 0.12, u));",
    "      float ef = min(min(1.0 - rho / max(r, 0.04), (1.08 - u) * 2.4), (u + 0.04) * 12.0);",
    "      if (ef > -0.6) {",
    "        vec3 c = vec3(ql.x / (Rb * 2.6), ql.y / (H * 1.15) - uT * 1.3, ql.z / (Rb * 2.6)) + seed;",
    "        vec4 n1 = noise4(c);",
    "        float df = ef + (n1.r - 0.5) * 1.3 + (n1.b - 0.5) * 0.6 * u;",
    "        if (df > 0.0) {",
    "          float dens = clamp(df * 3.0, 0.0, 1.0) * uFire.z;",
    "          float temp = clamp(1.0 - u * 0.95 + (n1.g - 0.5) * 0.5 + (1.0 - rho / max(r, 0.04)) * 0.3 - 0.1, 0.0, 1.0) * (0.6 + 0.4 * uFire.z);",
    "          float a = 1.0 - exp(-dens * 7.0 * stepL);",
    "          vec3 em = heatCol(temp) * uHeat.x * (0.45 + temp * 1.3);",
    "          accE += T * a * em;",
    "          T *= 1.0 - a * 0.45;",
    "          if (tHit < 0.0 && a > 0.2) tHit = t;",
    "        }",
    "      }",
    // the soot off the tips: a column that widens as it climbs, and spreads
    // flat under a ceiling
    "      if (uFire.w > 0.001) {",
    "        float ys = q.y - H * 0.55;",
    "        if (ys > -0.3) {",
    "          float spread = smoothstep(uCeil - 1.2, uCeil, q.y) * (1.2 + H * 0.6);",
    "          vec2 off = uWind * max(ys, 0.0) * 0.35;",
    "          float rs = Rb * 0.55 + max(ys, 0.0) * 0.38 + spread;",
    "          float es = 1.0 - length(q.xz - off) / rs;",
    "          if (es > -0.5) {",
    "            vec3 cs = vec3((q.x - off.x) / (rs * 2.0 + 0.6), (q.y - uT * 0.9) / 2.4, (q.z - off.y) / (rs * 2.0 + 0.6)) + seed * 1.31;",
    "            vec4 n2 = noise4(cs);",
    "            float b2 = es + (n2.r - 0.5) * 1.0 + (n2.g - 0.5) * 0.3;",
    "            if (b2 > 0.0) {",
    "              float ds = clamp(b2 * 1.6, 0.0, 1.0) * smoothstep(-0.3, H * 0.5, ys) * uFire.w;",
    "              float a = 1.0 - exp(-ds * uSmoke.x * stepL);",
    "              float under = exp(-max(ys, 0.0) / max(H, 0.3));",
    "              vec3 lit = uSoot * (uAmb + uKeyCol * 0.6 * clamp(0.4 + n2.b, 0.0, 1.0)) + vec3(1.0, 0.4, 0.1) * uFire.z * uHeat.z * under * 0.12;",
    "              acc += T * a * lit;",
    "              T *= 1.0 - a;",
    "              if (tHit < 0.0 && T < 0.6) tHit = t;",
    "            }",
    "          }",
    "        }",
    "      }",
    "      t += stepL;",
    "      if (t > t1) break;",
    "    }",
    "  }",
    "#endif",
    "  float alpha = 1.0 - T;",
    "  if (alpha < 0.004 && dot(accE, accE) < 1e-5) discard;",
    "  alpha = max(alpha, 1e-3);",
    "  if (uFogP.x > 0.5) {",
    "    float dist = tHit > 0.0 ? tHit : t0;",
    "    float f = uFogP.x < 1.5 ? smoothstep(uFogP.y, uFogP.z, dist) : 1.0 - exp(-uFogP.y * uFogP.y * dist * dist);",
    "    acc = mix(acc, uFogCol * alpha, f); accE *= 1.0 - f;",
    "  }",
    // what the smoke scatters is a colour behind an alpha; what the fire
    // emits is light ADDED on top (premultiplied output may exceed alpha)
    // HEAVY: the cloud is metres to a hundred metres across and stands among
    // buildings, so its occlusion is per pixel, at the first dense sample (a
    // tower in front of the cloud hides it; the cloud in front of a tower is
    // drawn over it), not the proxy box's face
    "#if defined(HEAVY) && defined(HAS_FRAG_DEPTH)",
    "  {",
    "    float tD = tHit > 0.0 ? tHit : t0;",
    "    vec4 clip = projectionMatrix * viewMatrix * vec4(ro + rd * tD, 1.0);",
    "    gl_FragDepthEXT = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);",
    "  }",
    "#endif",
    "  if (uTM < 0.5) accE = 1.0 - exp(-accE);",
    "  gl_FragColor = vec4(acc / alpha, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  vec3 sC = gl_FragColor.rgb * alpha;",
    "  gl_FragColor = vec4(accE, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  gl_FragColor = vec4(sC + gl_FragColor.rgb, alpha);",
    "}",
  ].join("\n");

  // global uniforms: ONE object per name, referenced by every material
  const G = {
    uNoise: { value: noise.tex }, uHasNoise: { value: noise.done ? 1 : 0 },
    uKeyDir: { value: new THREE.Vector3(0.35, 0.85, 0.25).normalize() },
    uKeyCol: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.45, 0.48, 0.52) },
    uGnd: { value: new THREE.Color(0.25, 0.23, 0.21) },
    uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uFogP: { value: new THREE.Vector3(0, 0, 0) },
    uTM: { value: 1 },
  };
  CBZ.volNoise.onReady(function (tex) { G.uNoise.value = tex; G.uHasNoise.value = 1; });

  const R0_ = CBZ.renderer;
  const FRAG_DEPTH = !!(R0_ && R0_.capabilities && (R0_.capabilities.isWebGL2 ||
    (R0_.extensions && R0_.extensions.has && R0_.extensions.has("EXT_frag_depth"))));
  function makeMat(heavy) {
    const U = {
      uNoise: G.uNoise, uHasNoise: G.uHasNoise,
      uKeyDir: G.uKeyDir, uKeyCol: G.uKeyCol, uAmb: G.uAmb, uGnd: G.uGnd, uFogCol: G.uFogCol, uFogP: G.uFogP, uTM: G.uTM,
      uC: { value: new THREE.Vector3() }, uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
      uMode: { value: 0 }, uT: { value: 0 }, uSteps: { value: 16 }, uSeed: { value: 0 },
      uBall: { value: new THREE.Vector4(1, 0, 1, 0) }, uSmoke: { value: new THREE.Vector4(1, 1, 0, 0) },
      uShock: { value: new THREE.Vector4(1, 0, 1, 0.5) }, uFire: { value: new THREE.Vector4(1, 0.4, 0, 0) },
      uHeat: { value: new THREE.Vector4(4, 0, 0, -1) },
      uNrm: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uCeil: { value: 99 },
      uSoot: { value: new THREE.Vector3(0.08, 0.075, 0.07) }, uDust: { value: new THREE.Vector3(0.4, 0.38, 0.35) },
      uSeg: { value: new THREE.Vector3() }, uFC: { value: new THREE.Vector3() }, uHv: { value: new THREE.Vector4(0, 1, 1, 0) },
    };
    const defs = {};
    if (heavy) { defs.HEAVY = 1; if (FRAG_DEPTH) defs.HAS_FRAG_DEPTH = 1; }
    const mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VS, fragmentShader: FS, defines: defs,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.BackSide, fog: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    if (heavy) mat.extensions = { fragDepth: FRAG_DEPTH };
    return mat;
  }

  /* HEAVY slots: bombs and missile warheads (kg >= HEAVY_KG of TNT). Their
     own program (the HEAVY define above), outdoors-sized boxes that are refit
     every frame as the cloud climbs, and a carpet's stick merges into a few
     long clouds instead of one volume per bomb. A phone keeps fewer. */
  const BLAST_CAP = 4, FIRE_CAP = 6, HEAVY_CAP = 8, HEAVY_KG = 4;
  const slots = [];
  let unitBox = null, built = false, failed = false;
  function buildPools() {
    if (built || failed) return built;
    try {
      unitBox = new THREE.BoxGeometry(1, 1, 1);
      unitBox._shared = true;
      for (let i = 0; i < BLAST_CAP + FIRE_CAP + HEAVY_CAP; i++) {
        const kind = i < BLAST_CAP ? "blast" : i < BLAST_CAP + FIRE_CAP ? "fire" : "heavy";
        const m = new THREE.Mesh(unitBox, makeMat(kind === "heavy"));
        m.name = kind === "heavy" ? "volfxHeavy" : "volfx";
        if (kind === "heavy") m.frustumCulled = false;
        m.renderOrder = 9;
        m.visible = false;
        m.castShadow = false; m.receiveShadow = false;
        m.userData.noHit = true; m.userData.transient = true;
        m.raycast = function () {};
        scene.add(m);
        slots.push({ mesh: m, U: m.material.uniforms, kind: kind, live: false, t: 0, born: 0 });
      }
      built = true;
    } catch (e) { failed = true; }
    return built;
  }
  // built at load, hidden: core/fxwarm.js compiles the program at play start
  try { buildPools(); } catch (e) {}

  /* ---- the room the effect is in --------------------------------------------- */
  const _rc = new THREE.Raycaster(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  function probe(x, y, z, dx, dy, dz, far) {
    if (!CBZ.losRaycast || !CBZ.losBlockers || !CBZ.losBlockers.length) return far;
    _ro.set(x, y, z); _rd.set(dx, dy, dz);
    _rc.set(_ro, _rd); _rc.near = 0; _rc.far = far;
    let hits;
    try { hits = CBZ.losRaycast(_rc, CBZ.losBlockers); } catch (e) { return far; }
    let best = far;
    if (hits) for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h.distance > 0.02 && h.distance < best) best = h.distance;
    }
    return best;
  }
  const _box = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, ceil: false };
  // half extents wanted (hx, up); floor gy; returns the box clipped to the room
  function fitRoom(x, y, z, hx, up, gy) {
    const py = Math.max(gy + 0.4, Math.min(y, gy + 1.6));
    const px = probe(x, py, z, 1, 0, 0, hx), nx = probe(x, py, z, -1, 0, 0, hx);
    const pz = probe(x, py, z, 0, 0, 1, hx), nz = probe(x, py, z, 0, 0, -1, hx);
    const cu = probe(x, Math.max(py, y), z, 0, 1, 0, up + 0.5);
    const top = Math.max(py, y) + cu;
    _box.ceil = cu < up + 0.5 - 1e-3;
    _box.x0 = x - Math.max(0.15, nx - 0.04); _box.x1 = x + Math.max(0.15, px - 0.04);
    _box.z0 = z - Math.max(0.15, nz - 0.04); _box.z1 = z + Math.max(0.15, pz - 0.04);
    _box.y0 = gy + 0.01;
    _box.y1 = Math.max(_box.y0 + 0.6, Math.min(gy + up + (y - gy), _box.ceil ? top - 0.04 : 1e9));
    return _box;
  }
  function place(s, B) {
    const U = s.U, m = s.mesh;
    U.uBoxMin.value.set(B.x0, B.y0, B.z0); U.uBoxMax.value.set(B.x1, B.y1, B.z1);
    m.position.set((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2);
    m.scale.set(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0);
    m.updateMatrix(); m.updateMatrixWorld(true);
    if (!m.parent) scene.add(m);
  }
  function heavyCap() { return mobile() ? 4 : Math.max(4, Math.round(4 + 4 * q01())); }
  function take(kind) {
    let best = null, n = 0;
    const cap = kind === "heavy" ? heavyCap() : 1e9;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]; if (s.kind !== kind) continue;
      if (n++ >= cap) break;
      if (!s.live) return s;
      if (!best || s.born < best.born) best = s;
    }
    // full: recycle the oldest, but never a blast still in its first seconds
    if (best && (kind === "fire" || best.t > (kind === "heavy" ? 6 : 2.5))) return best;
    return null;
  }

  /* ---- light and air: read off the scene's own lights, once a second -------- */
  let lightCd = 0;
  const _ld = new THREE.Vector3();
  function readLights(dt) {
    lightCd -= dt;
    if (lightCd > 0) return;
    lightCd = 1;
    G.uTM.value = CBZ.toneMappingOn ? 1 : 0;
    let key = null, kI = 0, hemi = null, amb = null;
    const ch = scene.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (o.isDirectionalLight && o.visible && o.intensity > kI) { key = o; kI = o.intensity; }
      else if (o.isHemisphereLight && o.visible && !hemi) hemi = o;
      else if (o.isAmbientLight && o.visible && !amb) amb = o;
    }
    if (key) {
      _ld.copy(key.position);
      if (key.target) _ld.sub(key.target.position);
      if (_ld.lengthSq() > 1e-6) G.uKeyDir.value.copy(_ld.normalize());
      G.uKeyCol.value.copy(key.color).multiplyScalar(Math.min(2.5, key.intensity) * 0.6);
    } else G.uKeyCol.value.setRGB(0.5, 0.5, 0.5);
    const A = G.uAmb.value, Gd = G.uGnd.value;
    A.setRGB(0, 0, 0); Gd.setRGB(0, 0, 0);
    if (hemi) {
      A.copy(hemi.color).multiplyScalar(hemi.intensity * 0.7);
      Gd.copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.7);
    }
    if (amb) {
      A.r += amb.color.r * amb.intensity * 0.7; A.g += amb.color.g * amb.intensity * 0.7; A.b += amb.color.b * amb.intensity * 0.7;
      Gd.r += amb.color.r * amb.intensity * 0.7; Gd.g += amb.color.g * amb.intensity * 0.7; Gd.b += amb.color.b * amb.intensity * 0.7;
    }
    if (!hemi && !amb) { A.setRGB(0.35, 0.37, 0.4); Gd.setRGB(0.2, 0.19, 0.18); }
    const f = scene.fog;
    if (f && f.isFogExp2) { G.uFogP.value.set(2, f.density, 0); G.uFogCol.value.copy(f.color); }
    else if (f && f.isFog) { G.uFogP.value.set(1, f.near, f.far); G.uFogCol.value.copy(f.color); }
    else G.uFogP.value.set(0, 0, 0);
  }
  function stepsFor(kind) {
    const q = q01();
    if (kind === "blast") return Math.round(Math.min(mobile() ? 18 : 30, 12 + 18 * q));
    return Math.round(Math.min(mobile() ? 16 : 26, 11 + 15 * q));
  }
  function windNow() {
    let wx = 1, wz = 0, sp = 0;
    if (CBZ.weatherWind) {
      try { const w = CBZ.weatherWind(); if (w) { if (Number.isFinite(w.x)) wx = w.x; if (Number.isFinite(w.z)) wz = w.z; sp = +w.speed || 0; } } catch (e) {}
    }
    const l = Math.hypot(wx, wz) || 1, s = Math.max(0.2, Math.min(3, sp * 0.3));
    return { x: wx / l * s, z: wz / l * s };
  }

  /* ============================================================
     THE BLAST
     ============================================================ */
  function blast(x, y, z, o) {
    o = o || {};
    if (!buildPools()) return false;
    if (o.kg >= HEAVY_KG) return heavyBlast(x, y, z, o);
    const s = take("blast");
    if (!s) return false;
    const P = clamp(o.P || 1, 0.3, 2.6);
    const R0 = 0.8 + 0.72 * P;                          // fireball radius: RPG ~2.2 m
    const life = (o.life || (5.5 + 2.2 * P)) * (mobile() ? 0.8 : 1);
    const gy = o.floorY != null ? o.floorY : floorAt(x, z, y + 0.5);
    let nx = 0, ny = 0, nz = 0;
    if (o.nrm) { const l = Math.hypot(o.nrm.x || 0, o.nrm.y || 0, o.nrm.z || 0); if (l > 1e-4) { nx = o.nrm.x / l; ny = o.nrm.y / l; nz = o.nrm.z / l; } }
    // the visual seat stands a little off the struck face
    const cx = x + nx * 0.25, cy = Math.max(gy + 0.25, y + ny * 0.25), cz = z + nz * 0.25;
    const rsMax = R0 * (0.9 + 0.55 * Math.sqrt(life));
    const riseMax = R0 * 1.4 + 0.45 * life;
    const W = windNow();
    const hx = rsMax * 1.15 + 1 + Math.hypot(W.x, W.z) * life * 0.18;
    const B = fitRoom(cx, cy, cz, hx, riseMax + rsMax * 1.1, gy);
    s.live = true; s.t = 0; s.born = performance.now(); s.life = life; s.P = P; s.R0 = R0;
    s.seatY = cy - gy; s.ceilL = B.ceil ? (B.y1 - cy) : 1e9; s.indoor = B.ceil;
    s.rsMax = rsMax;
    const U = s.U;
    U.uMode.value = 0;
    U.uC.value.set(cx, cy, cz);
    U.uNrm.value.set(nx, ny, nz);
    U.uWind.value.set(W.x, W.z);
    U.uSeed.value = rng() * 7.31;
    U.uSteps.value = stepsFor("blast");
    U.uHeat.value.set(4.2, 0, 0, gy - cy);
    U.uCeil.value = B.ceil ? B.y1 - cy : 99;
    const so = o.soot || [0.075, 0.07, 0.066];
    U.uSoot.value.set(so[0], so[1], so[2]);
    const du = o.dust || [0.42, 0.4, 0.37];
    U.uDust.value.set(du[0], du[1], du[2]);
    s.dustOn = o.dustOn !== false && (cy - gy) < 3;
    place(s, B);
    blastUniforms(s, 1 / 60);            // the detonation frame already shows the flash
    s.mesh.visible = true;
    return true;
  }
  function blastUniforms(s, t) {
    const U = s.U, R0 = s.R0, life = s.life;
    U.uT.value = t;
    const rf = R0 * (0.35 + 0.65 * (1 - Math.exp(-t / 0.03)));
    const temp = t < 0.04 ? 1 : Math.exp(-(t - 0.04) / 0.065);
    let rs = Math.max(rf * 1.02, R0 * (0.9 + 0.55 * Math.sqrt(Math.max(0, t - 0.05))));
    let rise = R0 * 1.4 * (1 - Math.exp(-t / 0.75)) + 0.45 * t;
    // a ceiling stops the climb and the ball spreads flat under it
    let squash = 0;
    if (s.ceilL < 1e8) {
      const want = rise + rs * 0.6;
      if (want > s.ceilL) {
        squash = clamp((want - s.ceilL) / Math.max(0.5, rs), 0, 1);
        rise = Math.max(0, Math.min(rise, s.ceilL - rs * 0.35));
      }
    }
    const fade = t > life * 0.5 ? clamp(1 - (t - life * 0.5) / (life * 0.5), 0, 1) : 1;
    // the same soot spread through a bigger ball is thinner
    const sig = 2.8 * Math.pow(R0 / rs, 1.6) * (s.indoor ? 1.25 : 1);
    U.uBall.value.set(rf, temp, rs, rise);
    U.uSmoke.value.set(sig, fade * fade * (3 - 2 * fade), squash, s.dustOn ? clamp(1 - t / 4.5, 0, 1) : 0);
    U.uShock.value.set(R0 * 0.6 + 60 * t, t < 0.13 ? 0.22 * (1 - t / 0.13) : 0,
      R0 * (0.6 + 2.6 * (1 - Math.exp(-t / 0.35))), 0.3 + 0.9 * (1 - Math.exp(-t / 0.6)));
    U.uHeat.value.x = 4.2;
    U.uHeat.value.y = 0.5 * Math.exp(-t / 0.4);
    U.uHeat.value.z = 2.6 * Math.exp(-t / 0.12) + 0.25 * Math.exp(-t / 0.8);
  }

  /* ============================================================
     THE HEAVY BLAST — a bomb or a missile warhead, sized by its charge.

     Everything scales off the TNT-equivalent charge W the blast law already
     resolves for the ordnance (systems/breach.js CBZ.blastLaw.CHARGES):
       lengths   x sc = (W / 0.9 kg)^(1/3)   Hopkinson-Cranz: the RPG is 1
       times     x ts = sqrt(sc)             a buoyant thermal rises at
                                             ~sqrt(g R): bigger is slower
     so the RPG's proportions hold at every size and a Mk-84 (459 kg) is an
     8x RPG drawn 2.8x slower: a ~32 m fireball that is white for ~0.1 s and
     orange-gone by ~0.6 s, a brown-grey cloud that climbs ~80 m in 10 s and
     ~120 m by 30 s, and a dust skirt that runs ~70 m out along the street.
     The cloud is dust-laden (a bomb digs; it is not a fuel fire), so it is
     drawn in the struck surface's colour shot through with detonation soot.

     A CARPET MERGES. A bomb that lands within about two fireball radii of
     the newest end of a young heavy cloud extends that cloud along the
     stick instead of opening another volume: the cloud's envelope is a
     capsule (uSeg) and its newest fireball sits at uFC. A 27-bomb stick is a
     handful of long walls of smoke, which is what a stick looks like.
     ============================================================ */
  const _hb = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, ceil: false };
  function heavyBlast(x, y, z, o) {
    const kg = +o.kg;
    const sc = Math.cbrt(kg / 0.9), ts = Math.sqrt(sc);
    const R0 = 2.0 * sc;
    const gy = o.floorY != null ? o.floorY : floorAt(x, z, y + 0.5);
    const cy = Math.max(gy + 0.25, y);
    // a young cloud whose newest end is near: feed it
    if (o.merge !== false) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.kind !== "heavy" || !s.live || s.indoor) continue;
        if (s.t > 5 * s.ts || Math.abs(cy - (s.cy + s.seg.y)) > s.R0 * 1.5) continue;
        const ex = s.cx + s.seg.x, ez = s.cz + s.seg.z;
        const near = Math.hypot(x - ex, z - ez);
        if (near > (s.R0 + R0) * 1.15 || near < 0.5) continue;
        // extend along the stick only while it stays roughly straight
        const sl = Math.hypot(s.seg.x, s.seg.z);
        const nx = x - s.cx, nz = z - s.cz, nl = Math.hypot(nx, nz);
        if (sl > 1 && (s.seg.x * nx + s.seg.z * nz) / (sl * nl) < 0.85) continue;
        if (nl > 260) continue;
        s.seg.x = nx; s.seg.y = cy - s.cy; s.seg.z = nz;
        s.U.uSeg.value.set(s.seg.x, s.seg.y, s.seg.z);
        // the newest bomb's fireball, on the cloud's own clock
        s.tF = 0; s.fcx = nx; s.fcy = cy - s.cy; s.fcz = nz;
        s.R0 = Math.max(s.R0, R0);
        s.life = Math.min(70, Math.max(s.life, s.t + s.life0 * 0.85));
        s.merged++;
        return true;
      }
    }
    const s = take("heavy");
    if (!s) return false;
    const life = Math.min(70, 14 * ts + 8) * (mobile() ? 0.8 : 1);
    let nx = 0, ny = 0, nz = 0;
    if (o.nrm) { const l = Math.hypot(o.nrm.x || 0, o.nrm.y || 0, o.nrm.z || 0); if (l > 1e-4) { nx = o.nrm.x / l; ny = o.nrm.y / l; nz = o.nrm.z / l; } }
    const px = x + nx * R0 * 0.15, py = cy + ny * R0 * 0.15, pz = z + nz * R0 * 0.15;
    // indoors (a ceiling close over the seat): the room holds it, as for a rocket
    const cu = probe(px, py + 0.2, pz, 0, 1, 0, R0 * 3);
    const indoor = cu < R0 * 3 - 1e-3;
    s.live = true; s.t = 0; s.tF = 0; s.born = performance.now();
    s.life = s.life0 = life; s.R0 = R0; s.sc = sc; s.ts = ts; s.kg = kg;
    s.cx = px; s.cy = py; s.cz = pz; s.gy = gy; s.indoor = indoor; s.merged = 0;
    s.seg = s.seg || { x: 0, y: 0, z: 0 }; s.seg.x = s.seg.y = s.seg.z = 0;
    s.fcx = nx * R0 * 0.1; s.fcy = ny * R0 * 0.1; s.fcz = nz * R0 * 0.1;
    s.seatY = py - gy; s.ceilL = indoor ? cu : 1e9;
    s.dustOn = o.dustOn !== false && (py - gy) < R0 * 0.6;
    s.windX = 0; s.windZ = 0;
    const U = s.U;
    U.uMode.value = 0;
    U.uC.value.set(px, py, pz);
    U.uNrm.value.set(nx, ny, nz);
    const W = windNow();
    U.uWind.value.set(W.x * ts, W.z * ts);
    U.uSeed.value = rng() * 7.31;
    U.uSteps.value = heavySteps();
    U.uCeil.value = indoor ? cu : 99;
    U.uSeg.value.set(0, 0, 0);
    const so = o.soot || [0.075, 0.07, 0.066];
    U.uSoot.value.set(so[0], so[1], so[2]);
    const du = o.dust || [0.42, 0.4, 0.37];
    U.uDust.value.set(du[0], du[1], du[2]);
    // a ground burst is mostly the ground thrown up; an airburst or a hit up a
    // facade is mostly its own soot and the wall's dust
    U.uHv.value.set(s.dustOn ? 0.62 : 0.4, q01() > 0.45 && !mobile() ? 1 : 0, ts, 0);
    heavyUniforms(s, 1 / 60);
    s.mesh.visible = true;
    return true;
  }
  function heavySteps() {
    const q = q01();
    return Math.round(Math.min(mobile() ? 22 : 48, 18 + 30 * q));
  }
  function heavyUniforms(s, t) {
    const U = s.U, R0 = s.R0, ts = s.ts, life = s.life;
    U.uT.value = t;
    const tf = s.tF;                                       // the newest fireball's age
    const rf = R0 * (0.35 + 0.65 * (1 - Math.exp(-tf / (0.03 * ts))));
    const temp = tf < 0.04 * ts ? 1 : Math.exp(-(tf - 0.04 * ts) / (0.1 * ts));
    let rs = Math.max(rf * 1.02, R0 * (0.9 + 0.72 * Math.sqrt(Math.max(0, t / ts - 0.05))));
    let rise = R0 * (1.3 * (1 - Math.exp(-t / (0.5 * ts))) + 6.5 * (1 - Math.exp(-t / (5 * ts))));
    let squash = 0.18 * (1 - Math.exp(-t / (4 * ts)));       // the top spreads as it slows: a dirty mushroom
    if (s.indoor) {
      const want = rise + rs * 0.6;
      if (want > s.ceilL) {
        squash = clamp((want - s.ceilL) / Math.max(0.5, rs), 0, 1);
        rise = Math.max(0, Math.min(rise, s.ceilL - rs * 0.35));
      }
    }
    const fade = t > life * 0.55 ? clamp(1 - (t - life * 0.55) / (life * 0.45), 0, 1) : 1;
    const sig = 2.8 * Math.pow(R0 / rs, 1.5) / s.sc * (s.indoor ? 1.25 : 1);
    U.uBall.value.set(rf, temp, rs, rise);
    U.uSmoke.value.set(sig, fade * fade * (3 - 2 * fade), squash, s.dustOn ? clamp(1 - t / (7 * ts), 0, 1) : 0);
    const shock = tf < 0.13 * ts ? 0.2 * (1 - tf / (0.13 * ts)) : 0;
    U.uShock.value.set(R0 * 0.6 + 340 * tf, shock,
      R0 * (0.8 + 4.2 * (1 - Math.exp(-t / (0.6 * ts)))), R0 * (0.22 + 0.75 * (1 - Math.exp(-t / (1.4 * ts)))));
    U.uHeat.value.set(4.2, 0.5 * Math.exp(-tf / (0.45 * ts)), 2.6 * Math.exp(-tf / (0.14 * ts)) + 0.3 * Math.exp(-tf / (0.9 * ts)), s.gy - s.cy);
    U.uFC.value.set(s.fcx, s.fcy, s.fcz);
    // the box: the capsule's extent plus the cloud, refit as it climbs
    const sx = s.seg.x, sy = s.seg.y, sz = s.seg.z;
    const wv = U.uWind.value, drift = Math.hypot(wv.x, wv.y) * t * 0.18;
    const skirt = U.uSmoke.value.w > 0.01 ? U.uShock.value.z * 1.5 : 0;
    const hx = Math.max(rs * 1.25, skirt) + drift + 2;
    const top = Math.max(sy, 0) + rise + rs * 1.15 + 2;
    const B = _hb;
    B.x0 = s.cx + Math.min(0, sx) - hx; B.x1 = s.cx + Math.max(0, sx) + hx;
    B.z0 = s.cz + Math.min(0, sz) - hx; B.z1 = s.cz + Math.max(0, sz) + hx;
    B.y0 = s.gy + 0.01; B.y1 = s.cy + (s.indoor ? Math.min(top, s.ceilL - 0.04) : top);
    if (s.indoor) {
      const R = fitRoom(s.cx, s.cy, s.cz, hx, s.ceilL, s.gy);
      B.x0 = Math.max(B.x0, R.x0); B.x1 = Math.min(B.x1, R.x1); B.z0 = Math.max(B.z0, R.z0); B.z1 = Math.min(B.z1, R.z1);
    }
    place(s, B);
  }

  /* ============================================================
     THE FIRE
     ============================================================ */
  function fire(x, y, z, o) {
    o = o || {};
    if (!buildPools()) return null;
    const s = take("fire");
    if (!s) return null;
    if (s.live && s.handle) s.handle.alive = false;
    const size = clamp(o.size || 1, 0.2, 3);
    const dur = Math.max(2, o.dur || 30);
    const gy = y != null ? y : floorAt(x, z);
    const H = 0.4 + 1.1 * size, Rb = 0.22 + 0.34 * size;
    const W = windNow();
    const up = H * 4.2 + 2;
    const hx = Rb * 2 + H * 0.9 + Math.hypot(W.x, W.z) * H * 0.5 + 1.2;
    const B = fitRoom(x, gy + 0.3, z, hx, up, gy);
    s.live = true; s.t = 0; s.born = performance.now(); s.life = dur; s.size = size; s.H = H; s.Rb = Rb;
    s.ph = rng() * 50; s.emb = 0.2 + rng() * 0.3;
    const U = s.U;
    U.uMode.value = 1;
    U.uC.value.set(x, gy, z);
    U.uNrm.value.set(0, 0, 0);
    U.uWind.value.set(W.x, W.z);
    U.uSeed.value = rng() * 7.31;
    U.uSteps.value = stepsFor("fire");
    U.uCeil.value = B.ceil ? B.y1 - gy : 99;
    const so = o.soot || [0.05, 0.046, 0.043];
    U.uSoot.value.set(so[0], so[1], so[2]);
    U.uSmoke.value.set(1.6, 1, 0, 0);
    U.uHeat.value.set(3.2, 0, 1, 0);
    place(s, B);
    s.handle = { alive: true, flicker: 0, x: x, y: gy, z: z, size: size, level: 0 };
    fireUniforms(s, 1 / 60);
    s.mesh.visible = true;
    return s.handle;
  }
  function fireUniforms(s, t) {
    const U = s.U;
    U.uT.value = t;
    const grow = clamp(t / 0.8, 0, 1);
    const die = clamp((s.life - t) / (s.life * 0.3), 0, 1);
    const k = grow * die;
    const ph = s.ph + t;
    const flick = 0.82 + 0.1 * Math.sin(ph * 11.3) + 0.06 * Math.sin(ph * 23.1 + 1.7) + 0.04 * Math.sin(ph * 5.3);
    U.uFire.value.set(s.H * (0.45 + 0.55 * k) * (0.92 + 0.08 * flick), s.Rb * (0.6 + 0.4 * k), k * flick, clamp(k * 1.2, 0, 1) * 0.85);
    U.uHeat.value.z = flick;
    if (s.handle) { s.handle.flicker = flick; s.handle.level = k; }
  }

  /* ============================================================
     SPARKS: streaks stretched along their own velocity
     ============================================================ */
  const SPARK_CAP = 192;
  const sp = {
    n: 0, x: new Float32Array(SPARK_CAP), y: new Float32Array(SPARK_CAP), z: new Float32Array(SPARK_CAP),
    vx: new Float32Array(SPARK_CAP), vy: new Float32Array(SPARK_CAP), vz: new Float32Array(SPARK_CAP),
    age: new Float32Array(SPARK_CAP), life: new Float32Array(SPARK_CAP), fl: new Float32Array(SPARK_CAP),
    ember: new Uint8Array(SPARK_CAP), heat: new Float32Array(SPARK_CAP),
  };
  let sparkMesh = null, sparkGeo = null;
  function buildSparks() {
    if (sparkMesh || failed) return sparkMesh;
    try {
      const V = SPARK_CAP * 4;
      sparkGeo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
      const oth = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(V * 4), 4);
      const side = new THREE.BufferAttribute(new Float32Array(V), 1);
      for (let i = 0; i < SPARK_CAP; i++) { side.array[i * 4] = -1; side.array[i * 4 + 1] = 1; side.array[i * 4 + 2] = -1; side.array[i * 4 + 3] = 1; }
      [pos, oth, col].forEach(function (a) { if (a.setUsage) a.setUsage(THREE.DynamicDrawUsage); });
      sparkGeo.setAttribute("position", pos);
      sparkGeo.setAttribute("aOther", oth);
      sparkGeo.setAttribute("aCol", col);
      sparkGeo.setAttribute("aSide", side);
      const idx = new Uint16Array(SPARK_CAP * 6);
      for (let i = 0; i < SPARK_CAP; i++) {
        const b = i * 4, o = i * 6;
        idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1; idx[o + 3] = b + 1; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
      }
      sparkGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      sparkGeo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uRes: { value: new THREE.Vector2(1280, 720) }, uWidth: { value: 2.2 } },
        vertexShader: [
          "uniform vec2 uRes; uniform float uWidth;",
          "attribute vec3 aOther; attribute vec4 aCol; attribute float aSide;",
          "varying vec4 vCol; varying float vEdge;",
          "void main() {",
          "  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "  vec4 b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);",
          "  if (a.w < 0.05 || b.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vEdge = 0.0; return; }",
          "  vec2 sa = a.xy / a.w * uRes, sb = b.xy / b.w * uRes;",
          "  vec2 d = sa - sb; float l = length(d);",
          "  vec2 nrm = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(1.0, 0.0);",
          "  float w = uWidth * clamp(3.0 / a.w, 0.6, 1.6);",
          "  a.xy += nrm * aSide * w / uRes * a.w;",
          "  gl_Position = a;",
          "  vCol = aCol; vEdge = aSide;",
          "}",
        ].join("\n"),
        fragmentShader: [
          "varying vec4 vCol; varying float vEdge;",
          "void main() {",
          "  float e = 1.0 - abs(vEdge);",
          "  float a = vCol.a * smoothstep(0.0, 0.7, e);",
          "  if (a < 0.01) discard;",
          "  gl_FragColor = vec4(vCol.rgb * a, a);",
          "}",
        ].join("\n"),
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      sparkMesh = new THREE.Mesh(sparkGeo, mat);
      sparkMesh.name = "volfxSparks";
      sparkMesh.frustumCulled = false;
      sparkMesh.renderOrder = 10;
      sparkMesh.userData.noHit = true; sparkMesh.userData.transient = true;
      sparkMesh.raycast = function () {};
      sparkMesh.visible = false;
      scene.add(sparkMesh);
    } catch (e) { sparkMesh = null; }
    return sparkMesh;
  }
  try { buildSparks(); } catch (e) {}

  function sparks(x, y, z, count, o) {
    o = o || {};
    if (!buildSparks()) return 0;
    if (!sparkMesh.parent) scene.add(sparkMesh);
    const speed = o.speed || 14, ember = !!o.ember;
    const gy = o.floorY != null ? o.floorY : floorAt(x, z, y + 0.5);
    const n0 = o.nrm || null;
    let made = 0;
    for (let k = 0; k < count; k++) {
      let i;
      if (sp.n < SPARK_CAP) i = sp.n++;
      else { i = (rng() * SPARK_CAP) | 0; }            // full: overwrite one at random
      // a direction on the sphere, pushed into the hemisphere the face opens to
      let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      if (n0) { const d = dx * n0.x + dy * n0.y + dz * n0.z; if (d < 0) { dx -= 2 * d * n0.x; dy -= 2 * d * n0.y; dz -= 2 * d * n0.z; } }
      if (!ember && dy < -0.2 && y - gy < 0.6) dy = -dy;
      const v = ember ? (0.4 + rng() * 1.2) : speed * (0.4 + rng() * 0.8);
      sp.x[i] = x + dx * 0.15; sp.y[i] = y + dy * 0.15; sp.z[i] = z + dz * 0.15;
      sp.vx[i] = dx * v; sp.vy[i] = dy * v + (ember ? 1.2 + rng() * 1.4 : 1.5); sp.vz[i] = dz * v;
      sp.age[i] = 0; sp.life[i] = ember ? 1.4 + rng() * 1.6 : (o.life || 0.45) * (0.6 + rng() * 0.9);
      sp.fl[i] = gy; sp.ember[i] = ember ? 1 : 0; sp.heat[i] = 0.75 + rng() * 0.25;
      made++;
    }
    sparkMesh.visible = true;
    return made;
  }
  function stepSparks(dt) {
    if (!sparkMesh || !sp.n) { if (sparkMesh) { sparkMesh.visible = false; sparkGeo.setDrawRange(0, 0); } return; }
    // compact out the dead
    let w = 0;
    for (let i = 0; i < sp.n; i++) {
      sp.age[i] += dt;
      if (sp.age[i] >= sp.life[i]) continue;
      if (w !== i) {
        sp.x[w] = sp.x[i]; sp.y[w] = sp.y[i]; sp.z[w] = sp.z[i];
        sp.vx[w] = sp.vx[i]; sp.vy[w] = sp.vy[i]; sp.vz[w] = sp.vz[i];
        sp.age[w] = sp.age[i]; sp.life[w] = sp.life[i]; sp.fl[w] = sp.fl[i]; sp.ember[w] = sp.ember[i]; sp.heat[w] = sp.heat[i];
      }
      w++;
    }
    sp.n = w;
    const pos = sparkGeo.attributes.position.array, oth = sparkGeo.attributes.aOther.array, col = sparkGeo.attributes.aCol.array;
    for (let i = 0; i < sp.n; i++) {
      const em = sp.ember[i] === 1;
      const drag = em ? 0.9 : 0.6, g = em ? -0.6 : 9.8;
      const k = Math.max(0, 1 - drag * dt);
      sp.vx[i] *= k; sp.vz[i] *= k; sp.vy[i] = sp.vy[i] * k - g * dt;
      if (em) { sp.vx[i] += (rng() - 0.5) * 2 * dt; sp.vz[i] += (rng() - 0.5) * 2 * dt; }
      sp.x[i] += sp.vx[i] * dt; sp.y[i] += sp.vy[i] * dt; sp.z[i] += sp.vz[i] * dt;
      if (sp.y[i] < sp.fl[i] + 0.02 && sp.vy[i] < 0) {       // bounce off the floor, losing most of it
        sp.y[i] = sp.fl[i] + 0.02; sp.vy[i] *= -0.3; sp.vx[i] *= 0.5; sp.vz[i] *= 0.5;
      }
      const u = sp.age[i] / sp.life[i];
      const streak = em ? 0.06 : 0.035;
      const tx = sp.x[i] - sp.vx[i] * streak, ty = sp.y[i] - sp.vy[i] * streak, tz = sp.z[i] - sp.vz[i] * streak;
      const hot = sp.heat[i] * (1 - u);
      const r = 1.0, gg = em ? 0.35 + 0.3 * hot : 0.55 + 0.4 * hot, b = em ? 0.06 : 0.15 + 0.5 * hot * hot;
      const aH = (em ? 0.9 * (u < 0.1 ? u / 0.1 : 1) * (1 - u) : 1.0 * (1 - u * u)) * (0.85 + 0.15 * Math.sin(sp.age[i] * 40 + i));
      const o = i * 12, c = i * 16;
      // verts 0,1 = head (left/right), 2,3 = tail
      pos[o] = sp.x[i]; pos[o + 1] = sp.y[i]; pos[o + 2] = sp.z[i];
      pos[o + 3] = sp.x[i]; pos[o + 4] = sp.y[i]; pos[o + 5] = sp.z[i];
      pos[o + 6] = tx; pos[o + 7] = ty; pos[o + 8] = tz;
      pos[o + 9] = tx; pos[o + 10] = ty; pos[o + 11] = tz;
      oth[o] = tx; oth[o + 1] = ty; oth[o + 2] = tz;
      oth[o + 3] = tx; oth[o + 4] = ty; oth[o + 5] = tz;
      // the tail's "other" is projected BEYOND the head so its side vector
      // matches the head's (same screen direction)
      oth[o + 6] = tx * 2 - sp.x[i]; oth[o + 7] = ty * 2 - sp.y[i]; oth[o + 8] = tz * 2 - sp.z[i];
      oth[o + 9] = oth[o + 6]; oth[o + 10] = oth[o + 7]; oth[o + 11] = oth[o + 8];
      for (let v = 0; v < 4; v++) {
        const cc = c + v * 4;
        col[cc] = r; col[cc + 1] = gg; col[cc + 2] = b; col[cc + 3] = v < 2 ? aH : 0;
      }
    }
    const A = sparkGeo.attributes;
    A.position.updateRange.offset = 0; A.position.updateRange.count = sp.n * 12; A.position.needsUpdate = true;
    A.aOther.updateRange.offset = 0; A.aOther.updateRange.count = sp.n * 12; A.aOther.needsUpdate = true;
    A.aCol.updateRange.offset = 0; A.aCol.updateRange.count = sp.n * 16; A.aCol.needsUpdate = true;
    sparkGeo.setDrawRange(0, sp.n * 6);
    sparkMesh.visible = sp.n > 0;
    const cv = CBZ.renderer && CBZ.renderer.domElement;
    if (cv) sparkMesh.material.uniforms.uRes.value.set(Math.max(1, cv.width) * 0.5, Math.max(1, cv.height) * 0.5);
    const pr = CBZ.renderer && CBZ.renderer.getPixelRatio ? CBZ.renderer.getPixelRatio() : 1;
    sparkMesh.material.uniforms.uWidth.value = 1.3 * pr;
  }

  /* ============================================================
     CLODS: what a bomb throws out of the ground — dirt, broken pavement,
     masonry — in dark streaks that arc out and fall, the radial fan every
     frame of a real ground burst shows in the first second. Drawn like the
     sparks (one ribbon mesh, one draw), but alpha-blended (they are dark
     matter, not light) and as wide as the lump really is, in metres.
     ============================================================ */
  const CLOD_CAP = 320;
  const cl = {
    n: 0, x: new Float32Array(CLOD_CAP), y: new Float32Array(CLOD_CAP), z: new Float32Array(CLOD_CAP),
    vx: new Float32Array(CLOD_CAP), vy: new Float32Array(CLOD_CAP), vz: new Float32Array(CLOD_CAP),
    age: new Float32Array(CLOD_CAP), life: new Float32Array(CLOD_CAP), fl: new Float32Array(CLOD_CAP),
    w: new Float32Array(CLOD_CAP), r: new Float32Array(CLOD_CAP), g: new Float32Array(CLOD_CAP), b: new Float32Array(CLOD_CAP),
    hot: new Float32Array(CLOD_CAP), landed: new Uint8Array(CLOD_CAP),
  };
  let clodMesh = null, clodGeo = null;
  function buildClods() {
    if (clodMesh || failed) return clodMesh;
    try {
      const V = CLOD_CAP * 4;
      clodGeo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
      const oth = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(V * 4), 4);
      const side = new THREE.BufferAttribute(new Float32Array(V * 2), 2);
      for (let i = 0; i < CLOD_CAP; i++) {
        const o = i * 8;
        side.array[o] = -1; side.array[o + 2] = 1; side.array[o + 4] = -1; side.array[o + 6] = 1;
      }
      [pos, oth, col, side].forEach(function (a) { if (a.setUsage) a.setUsage(THREE.DynamicDrawUsage); });
      clodGeo.setAttribute("position", pos);
      clodGeo.setAttribute("aOther", oth);
      clodGeo.setAttribute("aCol", col);
      clodGeo.setAttribute("aSide", side);          // x: -1 / +1 across, y: the width in metres
      const idx = new Uint16Array(CLOD_CAP * 6);
      for (let i = 0; i < CLOD_CAP; i++) {
        const b = i * 4, o = i * 6;
        idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1; idx[o + 3] = b + 1; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
      }
      clodGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      clodGeo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uRes: { value: new THREE.Vector2(640, 360) } },
        vertexShader: [
          "uniform vec2 uRes;",
          "attribute vec3 aOther; attribute vec4 aCol; attribute vec2 aSide;",
          "varying vec4 vCol; varying float vEdge;",
          "void main() {",
          "  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "  vec4 b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);",
          "  if (a.w < 0.1 || b.w < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vEdge = 0.0; return; }",
          "  vec2 sa = a.xy / a.w * uRes, sb = b.xy / b.w * uRes;",
          "  vec2 d = sa - sb; float l = length(d);",
          "  vec2 nrm = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(1.0, 0.0);",
          // the lump's true width in pixels at this depth, never under a pixel
          "  float px = max(0.8, aSide.y * projectionMatrix[1][1] * uRes.y / a.w);",
          "  a.xy += nrm * aSide.x * px / uRes * a.w;",
          "  gl_Position = a;",
          "  vCol = aCol; vCol.a *= clamp(px / 0.8, 0.25, 1.0); vEdge = aSide.x;",
          "}",
        ].join("\n"),
        fragmentShader: [
          "varying vec4 vCol; varying float vEdge;",
          "void main() {",
          "  float e = 1.0 - abs(vEdge);",
          "  float a = vCol.a * smoothstep(0.0, 0.55, e);",
          "  if (a < 0.01) discard;",
          "  gl_FragColor = vec4(vCol.rgb, a);",
          "  #include <tonemapping_fragment>",
          "  #include <encodings_fragment>",
          "}",
        ].join("\n"),
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.NormalBlending, toneMapped: true,
      });
      clodMesh = new THREE.Mesh(clodGeo, mat);
      clodMesh.name = "volfxClods";
      clodMesh.frustumCulled = false;
      clodMesh.renderOrder = 8;
      clodMesh.userData.noHit = true; clodMesh.userData.transient = true;
      clodMesh.raycast = function () {};
      clodMesh.visible = false;
      scene.add(clodMesh);
    } catch (e) { clodMesh = null; }
    return clodMesh;
  }
  try { buildClods(); } catch (e) {}

  /* clods(x, y, z, count, o)
       o.speed   m/s of the fastest throw (a Mk-84 throws ~70)
       o.size    the biggest lump, metres (smaller ones down to a third)
       o.col     [r,g,b] the ground's colour (darkened here: wet, fresh, in shadow)
       o.nrm     the face it came off (a wall hit throws out of the wall)
       o.cone    0..1, how upright the fan is (1 = a column of dirt, 0 = flat out)
       o.hot     0..1 of the lumps that leave burning (an incendiary fill, a fuel hit) */
  function clods(x, y, z, count, o) {
    o = o || {};
    if (!buildClods()) return 0;
    if (!clodMesh.parent) scene.add(clodMesh);
    const speed = o.speed || 30, size = o.size || 0.4, cone = o.cone == null ? 0.55 : o.cone;
    const gy = o.floorY != null ? o.floorY : floorAt(x, z, y + 0.5);
    const c = o.col || [0.32, 0.28, 0.24], n0 = o.nrm || null;
    let made = 0;
    for (let k = 0; k < count; k++) {
      let i;
      if (cl.n < CLOD_CAP) i = cl.n++;
      else { i = (rng() * CLOD_CAP) | 0; }
      // a fan about the face normal (the ground's is up), steep near its axis
      let dx, dy, dz;
      const az = rng() * 6.2832;
      // elevation: a ground burst throws mostly at 35-70 degrees, a few near vertical
      const el = 0.45 + (0.95 + 0.25 * cone) * Math.pow(rng(), 1.3 - 0.7 * cone);
      const ce = Math.cos(Math.min(1.5, el)), se = Math.sin(Math.min(1.5, el));
      if (n0 && Math.abs(n0.y) < 0.7) {
        // off a wall: out along the normal, spread about it
        const hx = n0.x, hz = n0.z, hl = Math.hypot(hx, hz) || 1;
        const tx = -hz / hl, tz = hx / hl;
        const u = (rng() - 0.5) * 1.6, v = rng() * 1.1 - 0.25;
        dx = hx / hl + tx * u; dy = v; dz = hz / hl + tz * u;
      } else { dx = Math.cos(az) * ce; dy = se; dz = Math.sin(az) * ce; }
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const big = Math.pow(rng(), 2.2);                       // most lumps are small
      const v = speed * (0.3 + 0.7 * rng()) * (1 - 0.45 * big);
      cl.x[i] = x + dx * 0.5; cl.y[i] = Math.max(gy + 0.1, y) + dy * 0.5; cl.z[i] = z + dz * 0.5;
      cl.vx[i] = dx * v; cl.vy[i] = dy * v; cl.vz[i] = dz * v;
      cl.age[i] = -rng() * 0.05; cl.life[i] = 2.5 + rng() * 3.5 + v * 0.06;
      cl.fl[i] = gy; cl.w[i] = size * (0.3 + 0.7 * big);
      const sh = 0.55 + 0.45 * rng();
      cl.r[i] = c[0] * sh * 0.62; cl.g[i] = c[1] * sh * 0.6; cl.b[i] = c[2] * sh * 0.58;
      cl.hot[i] = rng() < (o.hot || 0) ? 1 : 0; cl.landed[i] = 0;
      made++;
    }
    clodMesh.visible = true;
    return made;
  }
  function stepClods(dt) {
    if (!clodMesh || !cl.n) { if (clodMesh) { clodMesh.visible = false; clodGeo.setDrawRange(0, 0); } return; }
    let w = 0;
    for (let i = 0; i < cl.n; i++) {
      cl.age[i] += dt;
      if (cl.age[i] >= cl.life[i]) continue;
      if (w !== i) {
        cl.x[w] = cl.x[i]; cl.y[w] = cl.y[i]; cl.z[w] = cl.z[i];
        cl.vx[w] = cl.vx[i]; cl.vy[w] = cl.vy[i]; cl.vz[w] = cl.vz[i];
        cl.age[w] = cl.age[i]; cl.life[w] = cl.life[i]; cl.fl[w] = cl.fl[i]; cl.w[w] = cl.w[i];
        cl.r[w] = cl.r[i]; cl.g[w] = cl.g[i]; cl.b[w] = cl.b[i]; cl.hot[w] = cl.hot[i]; cl.landed[w] = cl.landed[i];
      }
      w++;
    }
    cl.n = w;
    const pos = clodGeo.attributes.position.array, oth = clodGeo.attributes.aOther.array;
    const col = clodGeo.attributes.aCol.array, sd = clodGeo.attributes.aSide.array;
    for (let i = 0; i < cl.n; i++) {
      if (cl.age[i] < 0) { for (let v = 0; v < 4; v++) col[i * 16 + v * 4 + 3] = 0; continue; }
      if (!cl.landed[i]) {
        // quadratic drag on a lump: fast small grit slows, big clods carry
        const sp = Math.hypot(cl.vx[i], cl.vy[i], cl.vz[i]);
        const k = Math.max(0, 1 - (0.012 / Math.max(0.05, cl.w[i])) * sp * dt);
        cl.vx[i] *= k; cl.vz[i] *= k; cl.vy[i] = cl.vy[i] * k - 9.81 * dt;
        cl.x[i] += cl.vx[i] * dt; cl.y[i] += cl.vy[i] * dt; cl.z[i] += cl.vz[i] * dt;
        if (cl.y[i] < cl.fl[i] + 0.05 && cl.vy[i] < 0) {
          cl.y[i] = cl.fl[i] + 0.05; cl.landed[i] = 1;
          cl.life[i] = Math.min(cl.life[i], cl.age[i] + 0.6);
        }
      }
      const u = cl.age[i] / cl.life[i];
      // the streak: the lump's last ~0.07 s of travel (what a shutter sees)
      const st = cl.landed[i] ? 0 : 0.07;
      const tx = cl.x[i] - cl.vx[i] * st, ty = cl.y[i] - cl.vy[i] * st, tz = cl.z[i] - cl.vz[i] * st;
      const a = (cl.landed[i] ? 0.5 * (1 - u) : 0.92) * (1 - u * u * u);
      const o = i * 12, c = i * 16, so = i * 8;
      pos[o] = cl.x[i]; pos[o + 1] = cl.y[i]; pos[o + 2] = cl.z[i];
      pos[o + 3] = cl.x[i]; pos[o + 4] = cl.y[i]; pos[o + 5] = cl.z[i];
      pos[o + 6] = tx; pos[o + 7] = ty + (st ? 0 : 0.01); pos[o + 8] = tz;
      pos[o + 9] = tx; pos[o + 10] = ty + (st ? 0 : 0.01); pos[o + 11] = tz;
      oth[o] = tx; oth[o + 1] = ty; oth[o + 2] = tz;
      oth[o + 3] = tx; oth[o + 4] = ty; oth[o + 5] = tz;
      oth[o + 6] = tx * 2 - cl.x[i]; oth[o + 7] = ty * 2 - cl.y[i]; oth[o + 8] = tz * 2 - cl.z[i];
      oth[o + 9] = oth[o + 6]; oth[o + 10] = oth[o + 7]; oth[o + 11] = oth[o + 8];
      const hot = cl.hot[i] ? Math.max(0, 1 - cl.age[i] / 1.6) : 0;
      for (let v = 0; v < 4; v++) {
        const cc = c + v * 4;
        col[cc] = cl.r[i] + hot * 1.6; col[cc + 1] = cl.g[i] + hot * 0.7; col[cc + 2] = cl.b[i] + hot * 0.15;
        col[cc + 3] = v < 2 ? a : a * 0.35;
        sd[so + v * 2 + 1] = cl.w[i] * (v < 2 ? 1 : 0.7);
      }
    }
    const A = clodGeo.attributes;
    A.position.updateRange.offset = 0; A.position.updateRange.count = cl.n * 12; A.position.needsUpdate = true;
    A.aOther.updateRange.offset = 0; A.aOther.updateRange.count = cl.n * 12; A.aOther.needsUpdate = true;
    A.aCol.updateRange.offset = 0; A.aCol.updateRange.count = cl.n * 16; A.aCol.needsUpdate = true;
    A.aSide.updateRange.offset = 0; A.aSide.updateRange.count = cl.n * 8; A.aSide.needsUpdate = true;
    clodGeo.setDrawRange(0, cl.n * 6);
    clodMesh.visible = cl.n > 0;
    const cv = CBZ.renderer && CBZ.renderer.domElement;
    if (cv) clodMesh.material.uniforms.uRes.value.set(Math.max(1, cv.width) * 0.5, Math.max(1, cv.height) * 0.5);
  }

  /* ============================================================
     GLARE: a fireball is brighter than anything a screen can show, so what
     sells it is what it does to the lens and the air round it — a soft bloom
     several times the fireball's own size (no star: news footage of a strike
     shows the bloom and the blown-out frame, not a filter effect). One pooled additive sprite per live glare (8), world-sized,
     depth-tested (a building in front of it hides it), never added as a
     light. city/nukefx.js and the heavy blasts both use it.
     ============================================================ */
  const GLARE_CAP = 8;
  const glares = [];
  let glareTex = null;
  function glareTexture() {
    if (glareTex) return glareTex;
    const S = 256, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const x = cv.getContext("2d");
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, "rgba(255,255,255,1)");
    g.addColorStop(0.06, "rgba(255,252,240,0.95)");
    g.addColorStop(0.16, "rgba(255,236,200,0.42)");
    g.addColorStop(0.35, "rgba(255,214,160,0.13)");
    g.addColorStop(0.65, "rgba(255,200,140,0.035)");
    g.addColorStop(1.0, "rgba(255,190,130,0)");
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    glareTex = new THREE.CanvasTexture(cv);
    glareTex.encoding = THREE.sRGBEncoding;
    return glareTex;
  }
  function glare(x, y, z, o) {
    o = o || {};
    if (typeof document === "undefined") return null;
    let g = null;
    for (let i = 0; i < glares.length; i++) if (!glares[i].live) { g = glares[i]; break; }
    if (!g && glares.length < GLARE_CAP) {
      const m = new THREE.SpriteMaterial({ map: glareTexture(), color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false });
      const sp = new THREE.Sprite(m);
      sp.name = "volfxGlare"; sp.renderOrder = 70; sp.frustumCulled = false;
      sp.userData.noHit = true; sp.userData.transient = true; sp.raycast = function () {};
      scene.add(sp);
      g = { sp: sp, live: false };
      glares.push(g);
    }
    if (!g) {                                            // full: the dimmest goes
      g = glares[0];
      for (let i = 1; i < glares.length; i++) if (glares[i].peak * glares[i].k < g.peak * g.k) g = glares[i];
    }
    g.live = true; g.t = 0; g.x = x; g.y = y; g.z = z;
    g.r = o.r || 20; g.peak = o.peak == null ? 1 : o.peak; g.hold = o.hold || 0.05; g.tau = o.tau || 0.25;
    g.grow = o.grow || 0; g.k = 1; g.track = o.track || null;
    const c = o.col || [1, 0.92, 0.78];
    g.sp.material.color.setRGB(c[0], c[1], c[2]);
    g.sp.position.set(x, y, z);
    g.sp.visible = true;
    stepGlare(g, 0);
    return g;
  }
  function stepGlare(g, dt) {
    g.t += dt;
    const t = g.t;
    let k = t < g.hold ? 1 : Math.exp(-(t - g.hold) / g.tau);
    if (g.track) { try { const r = g.track(g, t); if (r === false) k = 0; else if (r != null) k = r; } catch (e) {} }
    g.k = k;
    if (k < 0.004) { g.live = false; g.sp.visible = false; return; }
    const s = g.r * (1 + g.grow * Math.min(1, t)) * (0.55 + 0.45 * k);
    g.sp.scale.set(s, s, 1);
    g.sp.position.set(g.x, g.y, g.z);
    g.sp.material.opacity = Math.min(1, g.peak * k);
  }
  function stepGlares(dt) { for (let i = 0; i < glares.length; i++) if (glares[i].live) stepGlare(glares[i], dt); }

  /* ============================================================
     THE FRAME — onAlways(9.55): after crashfx's puffs (9.5), before the
     rocket updater (52) whose detonation spawns a blast already posed for
     its first frame.
     ============================================================ */
  function frame(dt) {
    if (!noise.done && CBZ.game && CBZ.game.state === "playing") armIdleBuild();
    if (!built) return;
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    let any = false;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.live) continue;
      any = true;
      s.t += d;
      if (s.t >= s.life) {
        s.live = false; s.mesh.visible = false;
        if (s.handle) { s.handle.alive = false; s.handle = null; }
        continue;
      }
      if (s.kind === "blast") blastUniforms(s, s.t);
      else if (s.kind === "heavy") { s.tF += d; heavyUniforms(s, s.t); }
      else {
        fireUniforms(s, s.t);
        // embers lofted off the flame
        s.emb -= d;
        if (s.emb <= 0) {
          s.emb = (0.18 + rng() * 0.3) / Math.max(0.35, q01());
          const U = s.U.uC.value, k = s.handle ? s.handle.level : 1;
          if (k > 0.2) sparks(U.x + (rng() - 0.5) * s.Rb, U.y + s.H * (0.4 + rng() * 0.5), U.z + (rng() - 0.5) * s.Rb, 1, { ember: true, floorY: U.y });
        }
      }
    }
    if (any) readLights(d);
    stepSparks(d);
    stepClods(d);
    stepGlares(d);
  }
  if (CBZ.onAlways) CBZ.onAlways(9.55, frame);

  function reset() {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      s.live = false; s.mesh.visible = false;
      if (s.handle) { s.handle.alive = false; s.handle = null; }
    }
    sp.n = 0;
    if (sparkMesh) { sparkMesh.visible = false; sparkGeo.setDrawRange(0, 0); }
    cl.n = 0;
    if (clodMesh) { clodMesh.visible = false; clodGeo.setDrawRange(0, 0); }
    for (let i = 0; i < glares.length; i++) { glares[i].live = false; glares[i].sp.visible = false; }
  }
  function audit() {
    let b = 0, f = 0, h = 0, merged = 0;
    for (let i = 0; i < slots.length; i++) if (slots[i].live) {
      if (slots[i].kind === "blast") b++; else if (slots[i].kind === "heavy") { h++; merged += slots[i].merged || 0; } else f++;
    }
    return {
      built: built, failed: failed, blasts: b, blastCap: BLAST_CAP, fires: f, fireCap: FIRE_CAP,
      heavy: h, heavyCap: heavyCap(), heavyMerged: merged, fragDepth: FRAG_DEPTH,
      heavySteps: heavySteps(),
      sparks: sp.n, sparkCap: SPARK_CAP, clods: cl.n, clodCap: CLOD_CAP,
      glares: glares.filter(function (g) { return g.live; }).length, noise: noise.done, noiseSlices: noise.z,
      steps: { blast: stepsFor("blast"), fire: stepsFor("fire") },
    };
  }
  CBZ.volfx = { blast: blast, fire: fire, sparks: sparks, clods: clods, glare: glare, reset: reset, audit: audit };
})();
