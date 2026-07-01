/* ============================================================
   systems/dustfx.js — pooled drift/burnout DUST for cars.

   ARCHITECTURE mirrors systems/weather.js's rain cloud, because it's the
   same problem shape: lots of tiny short-lived motes that should never cost
   a per-instance Mesh/draw-call. ONE shared BufferGeometry + ONE shared
   THREE.Points for every car in the city, positions written straight into a
   preallocated Float32Array every frame (no allocation once warmed up).
   Unlike weather's camera-relative RING (rain always surrounds you), dust
   motes are one-shot puffs seeded at a wheel and released, so this uses a
   plain ring-buffer SPAWN pointer (oldest slot recycled first on overrun —
   same idiom as city/crashfx.js's pooled burst rings) instead of distance
   culling.

   PER-MOTE FADE: PointsMaterial has no per-vertex opacity in r128, and a
   flat material opacity would leave "dead" motes sitting onscreen as solid
   grey dots once their velocity settles. Fix (same trick as
   city/interiormap.js's hand-rolled ShaderMaterial): a tiny custom point
   shader reads a per-vertex `aFade` attribute (baked from age/life every
   frame, one Float32 write loop) and shrinks + fades each point toward zero
   as it ages — genuine per-mote fade-out, still ONE draw call total.

   SIGNAL: reuses the exact same slip magnitude vehicles.js already computes
   for rubber (skidAmt for the player / aiSlipStep's returned slip for AI) —
   see the vehicles.js hook comment for exact call sites. This file doesn't
   duplicate any tire-physics math; it only reacts to a slip value handed in.

   API:
     CBZ.cityDriftDust(x, y, z, opts) — spawn a small burst of dust/smoke
       motes at a rear wheel. opts.amt (0..1 slip strength) scales count/
       spread/opacity — a light drift kicks a wisp, a full burnout boils a
       proper cloud. Caller throttles cadence (vehicles.js only calls this a
       few times/sec, same cadence as its existing emitTireSmoke calls); a
       hard MAX cap on live motes protects this file even if a caller ever
       forgets to throttle.

   DETERMINISM: every scatter/velocity jitter runs off a local seeded LCG —
   NEVER Math.random() — same as weather.js/crashfx.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  let _rs = 550101;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  // ---- pooled cloud (single shared geometry/material for ALL cars) ----
  const MAX = 220;                 // hard cap on live dust motes, citywide
  const positions = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);      // per-mote drift velocity
  const age = new Float32Array(MAX);
  const life = new Float32Array(MAX).fill(-1); // -1 = empty slot (never drawn)
  const baseSize = new Float32Array(MAX);      // per-mote starting point size
  const fade = new Float32Array(MAX);          // baked every frame: 0..1, feeds the shader
  let ring = 0;                     // next spawn slot (ring buffer — oldest evicted first)
  let liveCount = 0;                 // highest index ever spawned (draw-range bound)

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const sizeAttr = new THREE.BufferAttribute(baseSize, 1);
  const fadeAttr = new THREE.BufferAttribute(fade, 1);
  posAttr.setUsage && posAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage && sizeAttr.setUsage(THREE.DynamicDrawUsage);
  fadeAttr.setUsage && fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("aSize", sizeAttr);
  geo.setAttribute("aFade", fadeAttr);
  geo.setDrawRange(0, 0);

  // hand-rolled point shader (array-of-strings GLSL, matching this codebase's
  // existing ShaderMaterial convention in city/interiormap.js): per-vertex
  // size + fade so dead motes actually shrink to nothing instead of sticking
  // around as static dots once a flat PointsMaterial.opacity settles.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xb8ada0) } },
    transparent: true,
    depthWrite: false,
    vertexShader: [
      "attribute float aSize;",
      "attribute float aFade;",
      "varying float vFade;",
      "void main() {",
      "  vFade = aFade;",
      "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  gl_PointSize = aSize * (60.0 / max(1.0, -mv.z)) * (0.3 + 0.7 * aFade);",
      "  gl_Position = projectionMatrix * mv;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "precision mediump float;",
      "uniform vec3 uColor;",
      "varying float vFade;",
      "void main() {",
      // soft round dot: fade to transparent past the point's radius so it
      // doesn't read as a hard square sprite.
      "  vec2 d = gl_PointCoord - vec2(0.5);",
      "  float r = length(d) * 2.0;",
      "  float edge = 1.0 - smoothstep(0.6, 1.0, r);",
      "  gl_FragColor = vec4(uColor, vFade * edge * 0.5);",
      "}",
    ].join("\n"),
  });
  mat._shared = true;

  const cloud = new THREE.Points(geo, mat);
  cloud.frustumCulled = false;   // motes scatter across the whole street network; not worth reculling
  cloud.renderOrder = 6;
  cloud.visible = false;
  scene.add(cloud);

  function spawnMote(x, y, z, vx, vy, vz, life0, sz) {
    const i = ring; ring = (ring + 1) % MAX;
    if (ring > liveCount) liveCount = ring;
    const o = i * 3;
    positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
    vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    age[i] = 0; life[i] = life0; baseSize[i] = sz;
  }

  // CBZ.cityDriftDust(x,y,z,opts): a small burst at a rear wheel touching the
  // road. amt (0..1) scales count/spread/opacity. Cheap: a handful of motes,
  // written straight into the pooled arrays, zero allocation.
  CBZ.cityDriftDust = function (x, y, z, opts) {
    opts = opts || {};
    const amt = Math.max(0, Math.min(1, opts.amt == null ? 0.6 : opts.amt));
    if (amt <= 0.05) return;
    const n = Math.max(1, Math.round(2 + amt * 4));   // 2..6 motes per call
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const sp = (0.4 + rng() * 0.9) * (0.5 + amt * 0.7);
      spawnMote(
        x + (rng() - 0.5) * 0.6, (y == null ? 0.25 : y) + rng() * 0.25, z + (rng() - 0.5) * 0.6,
        Math.cos(a) * sp, 0.4 + rng() * 0.9, Math.sin(a) * sp,
        0.7 + rng() * 0.6 + amt * 0.4,
        1.1 + rng() * 0.9 + amt * 0.8
      );
    }
  };

  // ---- per-frame: age + drift + fade every live mote; one Float32 write loop,
  //      no allocation in the hot path (mirrors weather.js's rain updater). ----
  CBZ.onAlways(9.8, function (dt) {
    if (!dt || dt <= 0 || liveCount === 0) return;
    const g = CBZ.game;
    if (g && g.mode !== "city") { cloud.visible = false; return; }

    let anyAlive = false;
    for (let i = 0; i < liveCount; i++) {
      if (life[i] < 0 || age[i] >= life[i]) { fade[i] = 0; continue; } // empty/fully-faded — invisible, untouched
      anyAlive = true;
      age[i] += dt;
      const t = Math.min(1, age[i] / life[i]);
      const o = i * 3;
      // gentle rise + outward drift that slows as the puff expands (buoyant
      // dust/smoke, same shape as crashfx's smoke puffs, just far cheaper).
      vel[o + 1] += 0.35 * dt;
      vel[o] *= (1 - 0.6 * dt); vel[o + 2] *= (1 - 0.6 * dt);
      positions[o] += vel[o] * dt;
      positions[o + 1] += vel[o + 1] * dt;
      positions[o + 2] += vel[o + 2] * dt;
      // ease in over the first 15%, then ease back out to zero — a genuine
      // per-mote fade via the vertex shader, not a shared material opacity.
      fade[i] = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      if (age[i] >= life[i]) fade[i] = 0;
    }
    posAttr.needsUpdate = true;
    fadeAttr.needsUpdate = true;
    if (anyAlive) {
      cloud.visible = true;
      geo.setDrawRange(0, liveCount);
    } else {
      cloud.visible = false;
      liveCount = 0; // every slot fully aged out — cheap fast-path reset
    }
  });

  // fresh run → clear the pool so a new game doesn't inherit stray dust.
  CBZ.cityDriftDustReset = function () {
    liveCount = 0; ring = 0;
    positions.fill(0); age.fill(0); life.fill(-1); fade.fill(0);
    cloud.visible = false;
    geo.setDrawRange(0, 0);
  };
})();
