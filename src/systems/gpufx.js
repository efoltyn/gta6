/* ============================================================
   systems/gpufx.js — CBZ.gpuParticles: THE particle engine.

   One engine for every fire, smoke, spark, ash, dust and tumbling rock in
   the game, simulated on the GPU with three r187 TSL compute and drawn as
   instanced geometry: a pool is a set of storage buffers, one compute pass
   and ONE draw call however many particles are alive. Runs under the
   WebGPURenderer (?gpu=webgpu). Under the classic WebGLRenderer it reports
   `on === false` and every call is a no-op, so the old FX keep today's look
   exactly (callers branch on CBZ.gpuParticles.on).

   THE LOOKS (one pool each, built on first use):
     smoke   lit, soft, billowing puffs: the scene's sun, sky and every
             clustered point light (core/clusterlights.js) light them, so a
             fire lights its own smoke from below. Buoyant while hot, carried
             by the wind, stirred by curl noise, they grow as they entrain air.
     dust    the same body, heavier and warmer-toned: a rock's impact, a
             collapse, a density current's grit. Sinks instead of rising.
     fire    incandescent gas: a flame tongue per particle, coloured by its
             own temperature on a blackbody ramp (white-yellow core, orange,
             dull red), additive, soft against the ground it burns on.
     spark   embers and spatter: tiny white-hot streaks stretched along
             their velocity, ballistic, bouncing off the ground, cooling red.
     ash     lit flakes: falling, fluttering, settling on the height field.
     rock    REAL 3D ROCKS (instanced lumpy icosahedra, MeshStandard-lit):
             rigid bodies that fall, bounce, roll and tumble down the height
             field on the GPU, glowing in their cracks while hot, and shedding
             lit ash/dust into the smoke pool as they go (GPU -> GPU, an
             atomic ring, no CPU in the loop).

   PHYSICS, per particle per frame (one compute pass per pool):
     gravity        g, scaled by (1 - buoyancy * temperature) for gases
     buoyancy       hot gas accelerates upward, then cools (per-look rate)
     wind           drag toward the wind velocity (CBZ.weatherWind, or
                    setWind), stronger with height (a log-ish profile)
     turbulence     curl noise (examples/jsm/tsl/math/curlNoise.js), so
                    smoke curls and fire licks instead of drifting straight
     ground         a baked HEIGHT FIELD (setGround): particles stop on it,
                    sparks and rocks bounce, rocks roll on its slope normal
     soft particles examples/jsm/tsl/utils/SoftParticles.js: a puff fades
                    where it meets the opaque scene, no hard intersection line

   API (all no-ops when !on)
     const GP = CBZ.gpuParticles
     GP.on                                    true under the WebGPU renderer, after init
     GP.emit(look, o)                         spawn o.n particles (see EMIT below)
     GP.rock(o)                               throw one rock {x,y,z,vx,vy,vz,size,temp,spin,shed}
     GP.setGround(groundAt, cx, cz, size, res)  bake the height field (sliced over frames)
     GP.ensureGround(groundAt, cx, cz, size)    the same, unless a covering field is already baked
     GP.setWind(x, y, z)                      override the wind (null = follow the weather)
     GP.light(look, o)                        (convenience) a clustered light, see clusterlights.js
     GP.clear([look])                         kill every particle (a mode reset)
     GP.stats()                               { pools: {look: {max, emitted, frameEmit}}, computeMs }
   EMIT o (every field optional):
     x y z                 where (world)          n        how many (default 1)
     r                     spawn radius (sphere)  rUp      vertical spread factor (default 1)
     vx vy vz              velocity               vr       random velocity spread (m/s)
     life lifeR            seconds, +- random     size grow  start size, end size (m)
     temp                  0..1 heat (buoyancy, glow, colour)
     tone                  smoke/dust: 0 white steam .. 0.5 ash grey .. 1 soot black
     buoy drag turb        override the look's buoyancy / wind coupling / turbulence
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.gpuParticles) return;
  const THREE = window.THREE;
  const TSL = THREE.TSL;
  CBZ.CONFIG = CBZ.CONFIG || {};
  // ?cfg_GPU_PARTICLES=0 keeps the WebGPU renderer but turns the engine off
  if (CBZ.CONFIG.GPU_PARTICLES == null) CBZ.CONFIG.GPU_PARTICLES = true;

  const GP = {
    on: false,
    pools: {},
    computeMs: 0,
  };
  CBZ.gpuParticles = GP;
  // the no-op face, so a caller never null-checks
  GP.emit = function () { return 0; };
  GP.rock = function () { return false; };
  GP.setGround = function () {};
  GP.ensureGround = function () {};
  GP.setWind = function () {};
  GP.clear = function () {};
  GP.stats = function () { return { on: false }; };
  GP.light = function (look, o) { return CBZ.clusterLights ? CBZ.clusterLights.add(o) : null; };

  const R0 = CBZ.renderer;
  if (!R0 || !R0.isWebGPURenderer || !TSL || CBZ.CONFIG.GPU_PARTICLES === false) return;

  const {
    Fn, If, uniform, instancedArray, storage, instanceIndex, float, uint, int, vec2, vec3, vec4, mat4,
    hash, mix, smoothstep, clamp, max, min, exp, sqrt, sin, cos, length, normalize, dot, cross, abs,
    floor, fract, pow, texture, uv, positionLocal, cameraWorldMatrix, varying, select, atomicAdd,
  } = TSL;
  const curlNoise = THREE.Addons && THREE.Addons.curlNoise;
  const softParticles = THREE.Addons && THREE.Addons.softParticles;

  /* ---- THE SHARED FIELD: time, wind, gravity, the ground -------------- */
  const U = {
    dt: uniform(0), time: uniform(0), frame: uniform(0, "uint"),
    wind: uniform(new THREE.Vector3(1.2, 0, 0.4)),
    g: uniform(9.8),
    // the height field: origin x/z, size (m), resolution (cells a side), on
    gOrigin: uniform(new THREE.Vector2(-512, -512)), gSize: uniform(1024), gRes: uniform(2), gOn: uniform(0),
    gFlat: uniform(-1e5),       // ground for points outside the field (or no field)
  };
  const GRES = 256;
  const heights = instancedArray(new Float32Array(GRES * GRES), "float");
  // CPU copy for the bake slices and for CPU-side queries
  const hCPU = heights.value.array;
  let windOverride = null;
  const QS = function (lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; };

  /* the ground under (x, z), bilinear over the baked field (inlined node
     builders, not layout functions: a uniform read inside a shared layout
     function went missing from the second kernel that called it) */
  const heightAt = (px, pz) => {
    const res1 = U.gRes.sub(1.0);
    const u = px.sub(U.gOrigin.x).div(U.gSize).mul(res1);
    const v = pz.sub(U.gOrigin.y).div(U.gSize).mul(res1);
    const inside = U.gOn.greaterThan(0.5).and(u.greaterThanEqual(0.0)).and(v.greaterThanEqual(0.0)).and(u.lessThan(res1)).and(v.lessThan(res1));
    const uc = clamp(u, 0.0, res1.sub(1.001)), vc = clamp(v, 0.0, res1.sub(1.001));
    const iu = floor(uc), iv = floor(vc);
    const fu = uc.sub(iu), fv = vc.sub(iv);
    const i0 = uint(iv.mul(U.gRes).add(iu));
    const ri = uint(U.gRes);
    const h00 = heights.element(i0), h10 = heights.element(i0.add(uint(1)));
    const h01 = heights.element(i0.add(ri)), h11 = heights.element(i0.add(ri).add(uint(1)));
    return select(inside, mix(mix(h00, h10, fu), mix(h01, h11, fu), fv), U.gFlat);
  };
  const groundNormal = (px, pz) => {
    const e = max(U.gSize.div(U.gRes), 0.5);
    const hx0 = heightAt(px.sub(e), pz), hx1 = heightAt(px.add(e), pz);
    const hz0 = heightAt(px, pz.sub(e)), hz1 = heightAt(px, pz.add(e));
    return normalize(vec3(hx0.sub(hx1), e.mul(2.0), hz0.sub(hz1)));
  };

  /* the wind at a height: calm in the first metre, the free wind by ~30 m */
  const windAt = (y, gy) => {
    const hz = max(y.sub(gy), 0.0);
    const k = float(0.35).add(float(0.65).mul(smoothstep(0.0, 30.0, hz)));
    return U.wind.mul(k);
  };

  /* ---- the shared textures -------------------------------------------- */
  /* A 2x2 atlas of billowy puffs. Built on the CPU once (~10 ms) from a
     seeded value-noise fbm, so it is identical on every client and costs no
     fetch. R: density, a gaussian body whose silhouette is eaten by the fbm
     into cauliflower lobes and that is ZERO well inside the quad (a puff
     whose density reaches its quad's edge is drawn as a square: the "2D
     card" look); G: an erosion noise the look thresholds harder as the puff
     ages, so it thins into wisps instead of fading as a disc; B, A: the
     surface normal of the density read as a height (x, y), so every lobe
     takes the light on its own crown and shades its own crevice. */
  function puffAtlas() {
    const S = 256, H = S / 2, D = new Uint8Array(S * S * 4);
    const den = new Float32Array(H * H);
    let seed = 0x9e3779b9 >>> 0;
    const L = 64, lat = new Float32Array(L * L);
    for (let i = 0; i < L * L; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; lat[i] = seed / 4294967296; }
    const vn = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = lat[((yi & 63) * L) + (xi & 63)], b = lat[((yi & 63) * L) + ((xi + 1) & 63)];
      const c = lat[(((yi + 1) & 63) * L) + (xi & 63)], d = lat[(((yi + 1) & 63) * L) + ((xi + 1) & 63)];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const fbm = (x, y, o) => { let s = 0, w = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += w * vn(x * f, y * f); n += w; w *= 0.5; f *= 2.03; } return s / n; };
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const ox = (tx * 2 + ty) * 17.3 + 3.1, oy = (ty * 3 + tx) * 11.9 + 7.7;
      for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
        const u = (x + 0.5) / H * 2 - 1, v = (y + 0.5) / H * 2 - 1;
        const r2 = u * u + v * v;
        const n1 = fbm(u * 2.6 + ox, v * 2.6 + oy, 5);
        const body = Math.exp(-r2 * 4.2);
        let d = body * (0.35 + 1.1 * n1);
        d = smooth(0.16, 0.72, d) * (1 - smooth(0.72, 0.92, Math.sqrt(r2)));
        den[y * H + x] = d;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
        const u = (x + 0.5) / H * 2 - 1, v = (y + 0.5) / H * 2 - 1;
        const d = den[y * H + x];
        const xl = den[y * H + Math.max(0, x - 2)], xr = den[y * H + Math.min(H - 1, x + 2)];
        const yd = den[Math.max(0, y - 2) * H + x], yu = den[Math.min(H - 1, y + 2) * H + x];
        // the normal of the density as a height field, plus the ball it sits on
        let nx = (xl - xr) * 2.2 + u * 0.55, ny = (yd - yu) * 2.2 + v * 0.55;
        const nl = Math.hypot(nx, ny); if (nl > 0.95) { nx *= 0.95 / nl; ny *= 0.95 / nl; }
        const n2 = fbm(u * 5.3 + oy, v * 5.3 + ox, 4);
        const o = ((ty * H + y) * S + tx * H + x) * 4;
        D[o] = Math.round(255 * Math.max(0, Math.min(1, d)));
        D[o + 1] = Math.round(255 * n2);
        D[o + 2] = Math.round(255 * (0.5 + 0.5 * nx));
        D[o + 3] = Math.round(255 * (0.5 + 0.5 * ny));
      }
    }
    const t = new THREE.DataTexture(D, S, S, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  let _atlas = null;
  function atlas() { return _atlas || (_atlas = puffAtlas()); }

  /* the blackbody ramp a temperature 0..1 glows on (linear, unclamped: the
     hot end is HDR and the tone map rolls it off) */
  const blackbody = (t) => {
    const c0 = vec3(0.35, 0.03, 0.004);   // dull red, ~600 C
    const c1 = vec3(1.0, 0.22, 0.02);     // orange, ~900 C
    const c2 = vec3(1.6, 0.78, 0.22);     // yellow, ~1100 C
    const c3 = vec3(2.6, 2.1, 1.5);       // white-yellow core
    const a = mix(c0, c1, smoothstep(0.0, 0.4, t));
    const b = mix(a, c2, smoothstep(0.35, 0.7, t));
    return mix(b, c3, smoothstep(0.7, 1.0, t));
  };

  /* ---- THE LOOKS --------------------------------------------------------
     max: particles in the pool (phone .. desktop); gpu: slots reserved for
     GPU-side spawns (the rocks shed into them); cool: temperature decay /s;
     buoy, drag, turb: defaults per particle; g: gravity coupling;
     bounce: restitution off the ground (0 = stop), stick: settle on it. */
  const LOOKS = {
    smoke: { max: [3000, 14000], gpu: 2048, cool: 0.22, buoy: 5.0, drag: 0.9, turb: 1.4, g: 0.15, bounce: 0, lit: true, order: 9 },
    dust:  { max: [1500, 8000], gpu: 1024, cool: 0.9, buoy: 1.2, drag: 1.1, turb: 1.0, g: 0.5, bounce: 0, lit: true, order: 9, slope: 0.8 },
    fire:  { max: [1500, 7000], gpu: 0, cool: 1.6, buoy: 14.0, drag: 1.2, turb: 2.6, g: 0.05, bounce: 0, lit: false, order: 10 },
    spark: { max: [600, 3000], gpu: 512, cool: 0.45, buoy: 1.5, drag: 0.25, turb: 1.2, g: 1.0, bounce: 0.35, lit: false, order: 11 },
    ash:   { max: [800, 4000], gpu: 0, cool: 0.5, buoy: 0.0, drag: 2.2, turb: 0.9, g: 0.08, bounce: 0, lit: true, order: 9 },
    rock:  { max: [48, 160], gpu: 0, cool: 0.08, buoy: 0, drag: 0.02, turb: 0, g: 1.0, bounce: 0.32, lit: true, order: 3 },
  };
  const SPAWN = 2048;     // spawn slots per pool per frame

  /* ============================================================
     A POOL: storage (P pos+age, V vel+life, A size0 size1 seed temp,
     B drag buoy turb tone), a CPU spawn staging buffer, a spawn kernel, an
     update kernel and one draw.
     ============================================================ */
  function makePool(name, shedInto) {
    const L = LOOKS[name];
    const MAX = Math.max(64, Math.round(QS(L.max[0], L.max[1])));
    const GPUN = Math.min(L.gpu, Math.floor(MAX / 3));
    const CPUN = MAX - GPUN;
    const isRock = name === "rock";
    /* ONE interleaved buffer per pool (a stage may bind only 8 storage
       buffers): lanes P pos+age, V vel+life, A size0 size1 seed temp,
       B drag buoy turb tone, and for a rock Q orientation, W spin+radius */
    const SW = isRock ? 6 : 4;
    const D = instancedArray(MAX * SW, "vec4");
    const lane = (k) => ({ element: (i) => D.element(uint(i).mul(uint(SW)).add(uint(k))) });
    const P = lane(0), V = lane(1), A = lane(2), B = lane(3);
    const Q = isRock ? lane(4) : null, W = isRock ? lane(5) : null;
    // the draw reads the same buffer read-only (a vertex stage may not write)
    const DR = storage(D.value, "vec4", MAX * SW).toReadOnly();
    const laneR = (k) => DR.element(instanceIndex.mul(uint(SW)).add(uint(k)));
    const stage = new Float32Array(SPAWN * SW * 4);
    const S = instancedArray(stage, "vec4");
    const pu = { n: uniform(0, "uint"), head: uniform(0, "uint"), cpuN: uniform(CPUN, "uint") };
    // GPU ring (shed particles land here): an atomic counter
    let gpuCounter = null;
    if (GPUN > 0 && R0.backend && R0.backend.isWebGPUBackend) {
      const ca = new THREE.StorageBufferAttribute(new Uint32Array(1), 1);
      gpuCounter = storage(ca, "uint", 1).toAtomic();
    }
    const pool = { name, L, MAX, CPUN, GPUN, SW, D, laneR, P, V, A, B, Q, W, S, stage, pu, gpuCounter,
      head: 0, pending: 0, emitted: 0, frameEmit: 0, mesh: null, kSpawn: null, kUpdate: null, shedInto: shedInto || null };

    // ---- spawn: copy the staged particles into the ring
    pool.kSpawn = Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(pu.n), () => {
        const slot = pu.head.add(i).mod(pu.cpuN);
        const b = i.mul(uint(SW));
        P.element(slot).assign(S.element(b));
        V.element(slot).assign(S.element(b.add(uint(1))));
        A.element(slot).assign(S.element(b.add(uint(2))));
        B.element(slot).assign(S.element(b.add(uint(3))));
        if (isRock) {
          Q.element(slot).assign(S.element(b.add(uint(4))));
          W.element(slot).assign(S.element(b.add(uint(5))));
        }
      });
    })().compute(SPAWN);

    // ---- the update
    pool.kUpdate = isRock ? rockKernel(pool) : gasKernel(pool);
    return pool;
  }

  /* a GPU-side spawn into another pool's GPU ring (the rocks' shed) */
  function gpuSpawn(target, p, v, a, b) {
    if (!target || !target.gpuCounter) return;
    const k = atomicAdd(target.gpuCounter.element(0), uint(1)).toVar();
    const slot = target.pu.cpuN.add(k.mod(uint(target.GPUN)));
    target.P.element(slot).assign(p);
    target.V.element(slot).assign(v);
    target.A.element(slot).assign(a);
    target.B.element(slot).assign(b);
  }

  /* GAS / SPARK / ASH: integrate one particle */
  function gasKernel(pool) {
    const { P, V, A, B, MAX, L } = pool;
    const isSpark = pool.name === "spark", isAsh = pool.name === "ash";
    return Fn(() => {
      const i = instanceIndex;
      const v4 = V.element(i).toVar();
      If(v4.w.greaterThan(0.0), () => {
        const p4 = P.element(i).toVar();
        const a4 = A.element(i).toVar();
        const b4 = B.element(i).toVar();
        const dt = U.dt;
        const age = p4.w.add(dt);
        If(age.greaterThanEqual(v4.w), () => {
          V.element(i).assign(vec4(0.0));
          P.element(i).assign(vec4(0.0, -1e4, 0.0, 0.0));
        }).Else(() => {
          const pos = p4.xyz.toVar(), vel = v4.xyz.toVar();
          const temp = a4.w.mul(exp(dt.mul(-L.cool))).toVar();
          const gy = heightAt(pos.x, pos.z);
          // gravity, eased off by buoyancy while the gas is hot
          const up = b4.y.mul(temp).sub(U.g.mul(L.g));
          vel.y.addAssign(up.mul(dt));
          // drag toward the moving air
          const air = windAt(pos.y, gy);
          // (a plume is carried sideways by the wind it entrains, but its
          // vertical motion is its own buoyancy's: the vertical drag is a third)
          const kd = float(1.0).sub(exp(b4.x.negate().mul(dt)));
          const kdy = float(1.0).sub(exp(b4.x.negate().mul(dt).mul(0.33)));
          vel.addAssign(air.sub(vel).mul(vec3(kd, kdy, kd)));
          // curl turbulence: stronger in hot young gas, scaled by the look
          if (curlNoise && L.turb > 0) {
            const ph = pos.mul(isAsh ? 0.35 : 0.11).add(vec3(0.0, U.time.mul(isAsh ? 0.6 : 0.22), a4.z.mul(13.0)));
            const c = curlNoise(ph);
            vel.addAssign(c.mul(b4.z).mul(dt).mul(float(0.6).add(temp.mul(0.8))));
          }
          if (isAsh) {
            // a flake flutters: it sideslips as it falls, at its own phase
            const ph2 = U.time.mul(float(2.5).add(a4.z.mul(2.0))).add(a4.z.mul(40.0));
            vel.x.addAssign(sin(ph2).mul(0.9).mul(dt));
            vel.z.addAssign(cos(ph2.mul(1.3)).mul(0.9).mul(dt));
          }
          /* A DENSITY CURRENT FLOWS DOWNHILL. Dust is heavier than the air
             round it, so near the ground the slope's own gravity drives it
             down the fall line (and into the gullies): a base surge or a
             rockfall's grit runs down the cone as a billowing, ground-hugging
             cloud instead of hanging where it was thrown. */
          if (L.slope > 0) {
            const nS = groundNormal(pos.x, pos.z);
            const near = float(1.0).sub(smoothstep(a4.x.mul(0.6), a4.x.mul(2.5).add(2.0), pos.y.sub(gy)));
            const heavy = near.mul(float(1.0).sub(temp.mul(0.7))).mul(U.g).mul(L.slope).mul(dt);
            vel.x.addAssign(nS.x.mul(heavy)); vel.z.addAssign(nS.z.mul(heavy));
          }
          pos.addAssign(vel.mul(dt));
          // the ground: stop on it (gas spreads along it), sparks bounce
          const r = a4.x.mul(isSpark ? 0.05 : 0.35);
          If(pos.y.lessThan(gy.add(r)), () => {
            pos.y.assign(gy.add(r));
            if (L.bounce > 0) {
              const n = groundNormal(pos.x, pos.z);
              const vn = dot(vel, n);
              If(vn.lessThan(0.0), () => {
                vel.subAssign(n.mul(vn.mul(1.0 + L.bounce)));
                vel.mulAssign(0.7);
              });
            } else {
              vel.y.assign(max(vel.y, 0.0));
              const fr = exp(dt.mul(-4.0));
              vel.x.mulAssign(fr); vel.z.mulAssign(fr);
              if (isAsh) vel.mulAssign(0.0);
            }
          });
          P.element(i).assign(vec4(pos, age));
          V.element(i).assign(vec4(vel, v4.w));
          A.element(i).assign(vec4(a4.xyz, temp));
        });
      });
    })().compute(MAX);
  }

  /* ROCKS: rigid bodies on the height field */
  function rockKernel(pool) {
    const { P, V, A, B, Q, W, MAX } = pool;
    // the instance matrices the draw reads (written here every frame)
    const mAttr = new THREE.StorageInstancedBufferAttribute(new Float32Array(MAX * 16), 16);
    pool.mAttr = mAttr;
    const M = storage(mAttr, "mat4", MAX);
    // per-instance heat for the draw (temp, seed)
    const heatAttr = new THREE.StorageInstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    pool.heatAttr = heatAttr;
    const HT = storage(heatAttr, "vec4", MAX);
    return Fn(() => {
      const i = instanceIndex;
      const v4 = V.element(i).toVar();
      const live = v4.w.greaterThan(0.0);
      If(live, () => {
        const p4 = P.element(i).toVar(), a4 = A.element(i).toVar(), b4 = B.element(i).toVar();
        const q = Q.element(i).toVar(), w4 = W.element(i).toVar();
        const dt = U.dt;
        const age = p4.w.add(dt);
        const pos = p4.xyz.toVar(), vel = v4.xyz.toVar(), w = w4.xyz.toVar();
        const rad = w4.w;
        const temp = max(a4.w.sub(dt.mul(0.08).div(max(rad, 0.2))), 0.0).toVar();
        // gravity and a little air drag
        vel.y.subAssign(U.g.mul(dt));
        vel.mulAssign(float(1.0).sub(dt.mul(b4.x)));
        pos.addAssign(vel.mul(dt));
        const gy = heightAt(pos.x, pos.z);
        const contact = pos.y.lessThan(gy.add(rad)).toVar();
        If(contact, () => {
          const n = groundNormal(pos.x, pos.z);
          pos.y.assign(gy.add(rad));
          const vn = dot(vel, n);
          If(vn.lessThan(0.0), () => {
            // the bounce: restitution off the normal, falling off for slow hits
            const e = select(vn.lessThan(-2.5), float(0.32), float(0.0));
            vel.subAssign(n.mul(vn.mul(e.add(1.0))));
          });
          // ROLLING: friction drags the contact point toward rolling without
          // slipping, so w -> n x v / r and the slope's own gravity keeps it going
          const vt = vel.sub(n.mul(dot(vel, n)));
          const wRoll = cross(n, vt).div(max(rad, 0.1));
          w.assign(mix(w, wRoll, min(dt.mul(9.0), 1.0)));
          vel.subAssign(vt.mul(min(dt.mul(0.55), 1.0)));      // rolling resistance
        }).Else(() => {
          w.mulAssign(float(1.0).sub(dt.mul(0.05)));
        });
        // integrate the orientation: q += 0.5 dt (w,0) q
        const wq = vec4(w, 0.0);
        const dq = vec4(
          wq.w.mul(q.x).add(wq.x.mul(q.w)).add(wq.y.mul(q.z)).sub(wq.z.mul(q.y)),
          wq.w.mul(q.y).sub(wq.x.mul(q.z)).add(wq.y.mul(q.w)).add(wq.z.mul(q.x)),
          wq.w.mul(q.z).add(wq.x.mul(q.y)).sub(wq.y.mul(q.x)).add(wq.z.mul(q.w)),
          wq.w.mul(q.w).sub(wq.x.mul(q.x)).sub(wq.y.mul(q.y)).sub(wq.z.mul(q.z)),
        );
        q.assign(normalize(q.add(dq.mul(dt.mul(0.5)))));
        // come to rest: slow and on the ground for a while
        const speed = length(vel);
        const dead = age.greaterThan(v4.w);
        // SHED: a hot or fast rock leaves ash and grit behind it (GPU -> GPU)
        const shedP = pool.shedInto;
        if (shedP && shedP.gpuCounter) {
          const rr = hash(i.add(U.frame.mul(uint(7919))));
          const rate = b4.w.mul(float(2.0).add(speed.mul(0.9))).mul(rad.mul(1.4).add(0.3)).mul(select(contact, float(1.6), float(0.7)));
          If(rr.lessThan(rate.mul(dt)).and(dead.not()), () => {
            const r2 = hash(i.add(U.frame.mul(uint(31337))).add(uint(17)));
            const r3 = hash(i.add(U.frame.mul(uint(1013))).add(uint(91)));
            const off = vec3(r2.sub(0.5), r3.mul(0.6), r3.sub(r2)).mul(rad.mul(1.6));
            const hot = temp;
            gpuSpawn(shedP,
              vec4(pos.add(off), 0.0),
              vec4(vel.mul(0.25).add(vec3(0.0, float(0.6).add(hot.mul(2.5)), 0.0)), float(2.4).add(r2.mul(2.6)).add(rad.mul(1.5))),
              vec4(rad.mul(0.9).add(0.25), rad.mul(3.2).add(1.4), r3, hot.mul(0.7)),
              vec4(0.8, float(1.2).add(hot.mul(5.0)), 1.2, float(0.62).add(hot.mul(0.2))));
          });
        }
        If(dead, () => {
          V.element(i).assign(vec4(0.0));
          P.element(i).assign(vec4(0.0, -1e4, 0.0, 0.0));
        }).Else(() => {
          P.element(i).assign(vec4(pos, age));
          V.element(i).assign(vec4(vel, v4.w));
          A.element(i).assign(vec4(a4.xyz, temp));
          Q.element(i).assign(q);
          W.element(i).assign(vec4(w, rad));
        });
      });
      // THE MATRIX the draw reads: position, orientation, the rock's own size
      // (a dead rock draws at scale 0)
      const pp = P.element(i), qq = Q.element(i), sz = select(V.element(i).w.greaterThan(0.0), W.element(i).w, float(0.0));
      const x2 = qq.x.add(qq.x), y2 = qq.y.add(qq.y), z2 = qq.z.add(qq.z);
      const xx = qq.x.mul(x2), xy = qq.x.mul(y2), xz = qq.x.mul(z2);
      const yy = qq.y.mul(y2), yz = qq.y.mul(z2), zz = qq.z.mul(z2);
      const wx = qq.w.mul(x2), wy = qq.w.mul(y2), wz = qq.w.mul(z2);
      const sx = sz, sy = sz.mul(A.element(i).y), sz2 = sz;
      M.element(i).assign(mat4(
        vec4(float(1.0).sub(yy.add(zz)).mul(sx), xy.add(wz).mul(sx), xz.sub(wy).mul(sx), 0.0),
        vec4(xy.sub(wz).mul(sy), float(1.0).sub(xx.add(zz)).mul(sy), yz.add(wx).mul(sy), 0.0),
        vec4(xz.add(wy).mul(sz2), yz.sub(wx).mul(sz2), float(1.0).sub(xx.add(yy)).mul(sz2), 0.0),
        vec4(pp.xyz, 1.0),
      ));
      HT.element(i).assign(vec4(A.element(i).w, A.element(i).z, sz, 0.0));
    })().compute(MAX);
  }

  /* ============================================================
     THE DRAWS
     ============================================================ */
  /* camera-facing quad corners in world space */
  const camRight = vec3(cameraWorldMatrix.element(0).x, cameraWorldMatrix.element(0).y, cameraWorldMatrix.element(0).z);
  const camUp = vec3(cameraWorldMatrix.element(1).x, cameraWorldMatrix.element(1).y, cameraWorldMatrix.element(1).z);

  function quadGeo() {
    const g = new THREE.PlaneGeometry(1, 1);
    return g;
  }

  function gasMesh(pool) {
    const { P, V, A, B, L, name } = pool;
    const lit = L.lit;
    const mat = lit ? new THREE.MeshLambertNodeMaterial() : new THREE.MeshBasicNodeMaterial();
    mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = true;
    const pA = pool.laneR(0), vA = pool.laneR(1), aA = pool.laneR(2), bA = pool.laneR(3);
    const life = vA.w, age = pA.w;
    const k = clamp(age.div(max(life, 0.001)), 0.0, 1.0);
    const seed = aA.z;
    const isSpark = name === "spark", isFire = name === "fire", isAsh = name === "ash";
    // size over life: gases grow as they entrain air (fast at first)
    let size = mix(aA.x, aA.y, float(1.0).sub(exp(k.mul(-3.2))));
    if (isFire) size = aA.x.mul(float(1.0).add(k.mul(0.6))).mul(float(1.0).sub(k.mul(k).mul(0.55)));
    if (isSpark) size = aA.x;
    const alive = select(life.greaterThan(0.0), float(1.0), float(0.0));
    // corner: rotated in the screen plane (gases), or stretched along the velocity (sparks)
    const c = positionLocal.xy;     // -0.5 .. 0.5
    let world, rotCS = vec2(1.0, 0.0);
    if (isSpark) {
      const vel = vA.xyz;
      const vs = length(vel);
      const dir = select(vs.greaterThan(0.01), vel.div(vs), camUp);
      const side = normalize(cross(dir, pA.xyz.sub(TSL.cameraPosition)).add(vec3(1e-4, 0.0, 0.0)));
      const len = size.mul(float(1.0).add(vs.mul(0.05).min(4.0)));
      world = pA.xyz.add(dir.mul(c.y.mul(len))).add(side.mul(c.x.mul(size)));
    } else {
      // a puff turns slowly as it rolls; a flame tongue stays upright
      const rot = isFire ? seed.sub(0.5).mul(0.5) : seed.mul(6.2832).add(age.mul(seed.sub(0.5).mul(0.5)));
      const cr = cos(rot), sr = sin(rot);
      rotCS = vec2(cr, sr);
      const rx = c.x.mul(cr).sub(c.y.mul(sr)), ry = c.x.mul(sr).add(c.y.mul(cr));
      const lift = isFire ? size.mul(0.3) : float(0.0);     // a tongue stands on its base
      world = pA.xyz.add(camRight.mul(rx.mul(size))).add(camUp.mul(ry.mul(size).add(lift)));
    }
    mat.positionNode = world.mul(alive).add(vec3(0.0, float(-1e4).mul(float(1.0).sub(alive)), 0.0));
    // fragment: the puff's own shape from the atlas (variant by seed), eroded with age
    const tile = floor(seed.mul(3.999));
    const tUv = uv().mul(0.5).add(vec2(fract(tile.mul(0.5)), floor(tile.mul(0.5)).mul(0.5)));
    const tex = texture(atlas(), tUv);
    const vK = varying(k), vT = varying(aA.w), vTone = varying(bA.w), vSeed = varying(seed);
    let alpha, color;
    if (isFire) {
      // a flame tongue: the puff stretched up, scrolled, cut by its own noise
      const fUv = uv().sub(0.5);
      const tongue = smoothstep(0.5, 0.05, length(vec2(fUv.x.mul(1.35), fUv.y.add(0.12).mul(0.8))));
      const lick = texture(atlas(), uv().mul(vec2(0.5, 0.35)).add(vec2(fract(vSeed.mul(7.0)).mul(0.5), fract(U.time.mul(0.35).add(vSeed)).mul(0.5)))).g;
      const body = tongue.mul(smoothstep(0.25, 0.75, tex.r.mul(0.6).add(lick.mul(0.7))));
      const heat = vT.mul(float(0.55).add(body.mul(0.6)));
      alpha = body.mul(smoothstep(0.0, 0.12, vK)).mul(float(1.0).sub(smoothstep(0.55, 1.0, vK)));
      color = blackbody(heat);
      mat.blending = THREE.AdditiveBlending;
    } else if (isSpark) {
      const sUv = uv().sub(0.5);
      const core = smoothstep(0.5, 0.0, length(vec2(sUv.x.mul(2.0), sUv.y)));
      alpha = core.mul(float(1.0).sub(smoothstep(0.7, 1.0, vK)));
      color = blackbody(vT.mul(0.85).add(0.15));
      mat.blending = THREE.AdditiveBlending;
    } else if (isAsh) {
      const aUv = uv().sub(0.5);
      alpha = smoothstep(0.5, 0.3, length(aUv)).mul(float(1.0).sub(smoothstep(0.8, 1.0, vK))).mul(0.9);
      color = mix(vec3(0.20, 0.19, 0.18), vec3(0.42, 0.40, 0.37), vSeed);
    } else {
      // smoke / dust: the billow; its edge eaten into wisps as it ages (the
      // erosion threshold climbs with age), never faded as a disc
      const erode = tex.g.mul(0.35).add(0.05).mul(vK.mul(1.3));
      const den = smoothstep(erode, erode.add(0.45), tex.r);
      const fadeIn = smoothstep(0.0, 0.05, vK), fadeOut = float(1.0).sub(smoothstep(0.55, 1.0, vK));
      const thick = name === "dust" ? 0.5 : 0.42;
      alpha = den.mul(fadeIn).mul(fadeOut).mul(thick);
      const tone = vTone;
      const base = name === "dust"
        ? mix(vec3(0.36, 0.31, 0.25), vec3(0.11, 0.095, 0.08), tone)
        : mix(mix(vec3(0.80, 0.80, 0.78), vec3(0.30, 0.29, 0.28), smoothstep(0.0, 0.5, tone)), vec3(0.035, 0.032, 0.03), smoothstep(0.5, 1.0, tone));
      color = base;
      // each lobe's own normal (the atlas), turned with the quad into view space
      const vR = varying(rotCS);
      const nt = vec2(tex.b, tex.a).mul(2.0).sub(1.0);
      const nv = vec2(nt.x.mul(vR.x).sub(nt.y.mul(vR.y)), nt.x.mul(vR.y).add(nt.y.mul(vR.x)));
      const nrm = normalize(vec3(nv, sqrt(max(float(1.0).sub(dot(nv, nv)), 0.04))));
      mat.normalNode = nrm;
      // the hot young underside glows on its own (the fire under it)
      mat.emissiveNode = blackbody(vT).mul(vT.mul(vT)).mul(smoothstep(0.25, -0.6, nrm.y)).mul(1.1);
    }
    if (softParticles && !isSpark) {
      try { alpha = softParticles({ opacity: alpha, distance: isFire ? 0.6 : 1.6 }); } catch (e) { /* no depth copy: hard edges */ }
    }
    mat.colorNode = color;
    mat.opacityNode = alpha;
    mat.alphaTest = 0.0;
    mat.premultipliedAlpha = false;
    if (isFire || isSpark) { mat.toneMapped = true; }
    const mesh = new THREE.Mesh(quadGeo(), mat);
    mesh.count = pool.MAX;
    mesh.frustumCulled = false;
    mesh.renderOrder = L.order;
    mesh.name = "gpufx-" + name;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = false;
    return mesh;
  }

  let _rockGeo = null;
  function rockGeo() {
    if (_rockGeo) return _rockGeo;
    let g = new THREE.IcosahedronGeometry(1, 2);
    // r187 polyhedra are non-indexed: a corner shared by six faces is moved
    // by a function of its POSITION, so it moves as one and the rock stays closed
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // a broken block: a lumpy ball with a few big flat fracture faces
      let k = 0.88 + 0.2 * Math.sin(x * 3.1 + 1.3) * Math.sin(y * 2.7 + 0.4) * Math.sin(z * 3.3 + 2.2);
      k = Math.min(k, 1 / (1 + 0.55 * Math.max(0, x * 0.62 + y * 0.5 - 0.3)));
      k = Math.min(k, 1 / (1 + 0.6 * Math.max(0, -y * 0.8 + z * 0.3 - 0.35)));
      k = Math.min(k, 1 / (1 + 0.5 * Math.max(0, -x * 0.7 - z * 0.45 - 0.4)));
      p.setXYZ(i, x * k * 1.05, y * k * 0.84, z * k);
    }
    g.computeVertexNormals();     // per face (non-indexed): a rock has edges
    _rockGeo = g;
    return g;
  }
  function rockMesh(pool) {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0.0 });
    const HT = storage(pool.heatAttr, "vec4", pool.MAX).toReadOnly();
    const h = HT.element(instanceIndex);
    const vTemp = varying(h.x), vSeed = varying(h.y);
    // basalt: near black, a little variation per block
    mat.colorNode = mix(vec3(0.045, 0.04, 0.037), vec3(0.11, 0.1, 0.095), vSeed);
    // the cracks glow while it is hot: a cellular-ish pattern off the local
    // position, opening wider the hotter the rock
    const pl = positionLocal.mul(3.1).add(vec3(vSeed.mul(9.0)));
    const crack = abs(sin(pl.x.add(sin(pl.y.mul(1.7)).mul(1.2))).mul(sin(pl.z.mul(1.3).add(sin(pl.x.mul(2.1))))));
    const open = smoothstep(float(0.18).add(vTemp.mul(0.3)), 0.0, crack);
    mat.emissiveNode = blackbody(vTemp).mul(open.mul(vTemp).add(vTemp.mul(vTemp).mul(0.25))).mul(1.6);
    const mesh = new THREE.InstancedMesh(rockGeo(), mat, pool.MAX);
    mesh.instanceMatrix = pool.mAttr;
    mesh.count = pool.MAX;
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = "gpufx-rock";
    mesh.renderOrder = pool.L.order;
    return mesh;
  }

  /* ============================================================
     THE ENGINE
     ============================================================ */
  let parent = null;
  function root() {
    if (parent && parent.parent) return parent;
    if (!CBZ.scene) return null;
    parent = new THREE.Group();
    parent.name = "gpufx";
    parent.matrixAutoUpdate = false;
    CBZ.scene.add(parent);
    for (const k in GP.pools) if (GP.pools[k].mesh) parent.add(GP.pools[k].mesh);
    return parent;
  }
  function pool(name) {
    let p = GP.pools[name];
    if (p) return p;
    if (!LOOKS[name]) return null;
    // a rock's kernel writes into its shed target's GPU ring: build that first
    p = makePool(name, name === "rock" ? pool("smoke") : null);
    GP.pools[name] = p;
    p.mesh = name === "rock" ? rockMesh(p) : gasMesh(p);
    const r = root(); if (r) r.add(p.mesh);
    return p;
  }

  /* CPU -> the staging buffer */
  const rnd = Math.random;
  function stageOne(p, x, y, z, vx, vy, vz, life, s0, s1, temp, drag, buoy, turb, tone) {
    if (p.pending >= SPAWN) return false;
    const o = p.pending * (p.name === "rock" ? 24 : 16), S = p.stage;
    S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = 0;
    S[o + 4] = vx; S[o + 5] = vy; S[o + 6] = vz; S[o + 7] = life;
    S[o + 8] = s0; S[o + 9] = s1; S[o + 10] = rnd(); S[o + 11] = temp;
    S[o + 12] = drag; S[o + 13] = buoy; S[o + 14] = turb; S[o + 15] = tone;
    p.pending++;
    return true;
  }
  function emit(look, o) {
    if (!GP.on || !o) return 0;
    const p = pool(look);
    if (!p || look === "rock") return 0;
    const L = p.L;
    const n = Math.max(0, Math.min(SPAWN, o.n == null ? 1 : o.n | 0));
    const x = +o.x || 0, y = +o.y || 0, z = +o.z || 0, r = +o.r || 0, rUp = o.rUp == null ? 1 : +o.rUp;
    const vx = +o.vx || 0, vy = +o.vy || 0, vz = +o.vz || 0, vr = +o.vr || 0;
    const life = o.life > 0 ? +o.life : 3, lifeR = o.lifeR != null ? +o.lifeR : life * 0.3;
    const s0 = o.size > 0 ? +o.size : 1, s1 = o.grow > 0 ? +o.grow : s0 * 3;
    const temp = o.temp != null ? +o.temp : 0;
    const drag = o.drag != null ? +o.drag : L.drag, buoy = o.buoy != null ? +o.buoy : L.buoy;
    const turb = o.turb != null ? +o.turb : L.turb, tone = o.tone != null ? +o.tone : 0.5;
    let k = 0;
    for (let i = 0; i < n; i++) {
      let dx = 0, dy = 0, dz = 0;
      if (r > 0) { do { dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1; } while (dx * dx + dy * dy + dz * dz > 1); }
      const ex = vr ? (rnd() * 2 - 1) * vr : 0, ey = vr ? (rnd() * 2 - 1) * vr : 0, ez = vr ? (rnd() * 2 - 1) * vr : 0;
      if (!stageOne(p, x + dx * r, y + dy * r * rUp, z + dz * r, vx + ex, vy + ey, vz + ez,
        Math.max(0.05, life + (rnd() * 2 - 1) * lifeR), s0 * (0.8 + 0.4 * rnd()), s1 * (0.8 + 0.4 * rnd()), temp, drag, buoy, turb, tone)) break;
      k++;
    }
    p.emitted += k; p.frameEmit += k;
    return k;
  }
  function rock(o) {
    if (!GP.on || !o) return false;
    const p = pool("rock");
    if (!p || p.pending >= SPAWN) return false;
    const o6 = p.pending * 24, S = p.stage;
    const size = o.size > 0 ? +o.size : 0.6;
    // a random orientation, a tumble
    let qx = rnd() - 0.5, qy = rnd() - 0.5, qz = rnd() - 0.5, qw = rnd() - 0.5;
    const ql = Math.hypot(qx, qy, qz, qw) || 1; qx /= ql; qy /= ql; qz /= ql; qw /= ql;
    const sp = o.spin != null ? +o.spin : 4;
    S[o6] = +o.x || 0; S[o6 + 1] = +o.y || 0; S[o6 + 2] = +o.z || 0; S[o6 + 3] = 0;
    S[o6 + 4] = +o.vx || 0; S[o6 + 5] = +o.vy || 0; S[o6 + 6] = +o.vz || 0; S[o6 + 7] = o.life > 0 ? +o.life : 30;
    S[o6 + 8] = size; S[o6 + 9] = 0.75 + 0.3 * rnd(); S[o6 + 10] = rnd(); S[o6 + 11] = o.temp != null ? +o.temp : 0;
    S[o6 + 12] = 0.02; S[o6 + 13] = 0; S[o6 + 14] = 0; S[o6 + 15] = o.shed != null ? +o.shed : 1;
    S[o6 + 16] = qx; S[o6 + 17] = qy; S[o6 + 18] = qz; S[o6 + 19] = qw;
    S[o6 + 20] = (rnd() - 0.5) * sp; S[o6 + 21] = (rnd() - 0.5) * sp; S[o6 + 22] = (rnd() - 0.5) * sp; S[o6 + 23] = size;
    p.pending++; p.emitted++; p.frameEmit++;
    return true;
  }

  /* ---- the height field: baked off a groundAt, a slice of rows a frame -- */
  let bake = null;
  function setGround(groundAt, cx, cz, size, res) {
    if (typeof groundAt !== "function") { U.gOn.value = 0; bake = null; return; }
    res = Math.max(16, Math.min(GRES, res | 0 || GRES));
    size = size > 0 ? +size : 600;
    bake = { fn: groundAt, x0: (+cx || 0) - size / 2, z0: (+cz || 0) - size / 2, size, res, row: 0 };
    lastGround = { fn: groundAt, cx: +cx || 0, cz: +cz || 0, size };
  }
  /* the same field asked for twice (an eruption, then the wildfire it lights)
     is baked once; a covering field already in place is kept */
  let lastGround = null;
  function ensureGround(groundAt, cx, cz, size, res) {
    const L = lastGround;
    if (L && L.fn === groundAt && Math.abs(L.cx - cx) + Math.abs(L.cz - cz) + (size > L.size ? size - L.size : 0) < 1) return;
    if (L && L.fn === groundAt && L.size >= size + 2 * Math.max(Math.abs(L.cx - cx), Math.abs(L.cz - cz))) return;
    setGround(groundAt, cx, cz, size, res);
  }
  function bakeSlice(budgetMs) {
    if (!bake) return;
    const t0 = performance.now();
    const B = bake, step = B.size / (B.res - 1);
    while (B.row < B.res && performance.now() - t0 < budgetMs) {
      const z = B.z0 + B.row * step, o = B.row * B.res;
      for (let i = 0; i < B.res; i++) {
        let h = 0;
        try { h = +B.fn(B.x0 + i * step, z) || 0; } catch (e) { h = 0; }
        hCPU[o + i] = h;
      }
      B.row++;
    }
    if (B.row >= B.res) {
      heights.value.needsUpdate = true;
      U.gOrigin.value.set(B.x0, B.z0); U.gSize.value = B.size; U.gRes.value = B.res; U.gOn.value = 1;
      GP.ground = { x0: B.x0, z0: B.z0, size: B.size, res: B.res };
      bake = null;
    }
  }

  /* ---- the frame ---------------------------------------------------- */
  let frameNo = 0;
  function step(dt) {
    if (!GP.on) return;
    if (bake) bakeSlice(4);
    if (!root()) return;
    const R = CBZ.renderer;
    // the wind: the weather's, unless pinned
    if (windOverride) U.wind.value.copy(windOverride);
    else if (CBZ.weatherWind) {
      try {
        const w = CBZ.weatherWind();
        const sp = Math.max(0.6, +w.speed || 0);
        const L = Math.hypot(w.x, w.z) || 1;
        U.wind.value.set(w.x / L * sp, 0, w.z / L * sp);
      } catch (e) { /* keep the last wind */ }
    }
    U.g.value = (CBZ.TUNE && CBZ.TUNE.gravity > 0) ? Math.min(30, CBZ.TUNE.gravity) : 9.8;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 20);
    U.dt.value = dt; U.time.value += dt; U.frame.value = ++frameNo;
    const t0 = performance.now();
    for (const k in GP.pools) {
      const p = GP.pools[k];
      if (p.pending > 0) {
        const SW = p.name === "rock" ? 24 : 16;
        p.S.value.needsUpdate = true;
        if (p.S.value.clearUpdateRanges) { p.S.value.clearUpdateRanges(); p.S.value.addUpdateRange(0, p.pending * SW); }
        p.pu.n.value = p.pending; p.pu.head.value = p.head;
        R.compute(p.kSpawn);
        p.head = (p.head + p.pending) % p.CPUN;
        p.pending = 0;
      }
      p.frameEmit = 0;
    }
    // rocks first: they shed into the gas pools this same frame
    if (GP.pools.rock) R.compute(GP.pools.rock.kUpdate);
    for (const k in GP.pools) if (k !== "rock") R.compute(GP.pools[k].kUpdate);
    GP.computeMs = performance.now() - t0;
  }

  function clear(look) {
    for (const k in GP.pools) {
      if (look && k !== look) continue;
      const p = GP.pools[k];
      p.pending = 0;
      // a zero-life spawn over the whole ring is the cheapest clear: rebuild the storage
      p.D.value.array.fill(0); p.D.value.needsUpdate = true;
    }
  }

  function stats() {
    const out = { on: GP.on, backend: R0.cbzBackend, computeMs: +GP.computeMs.toFixed(3), pools: {} };
    for (const k in GP.pools) {
      const p = GP.pools[k];
      out.pools[k] = { max: p.MAX, emitted: p.emitted, gpuRing: p.GPUN };
    }
    if (GP.ground) out.ground = GP.ground;
    return out;
  }

  // the live face (after the renderer's init: compute before it throws)
  function goLive() {
    GP.on = true;
    GP.emit = emit;
    GP.rock = rock;
    GP.setGround = setGround;
    GP.ensureGround = ensureGround;
    GP.setWind = function (x, y, z) { windOverride = x == null ? null : new THREE.Vector3(+x || 0, +y || 0, +z || 0); };
    GP.clear = clear;
    GP.stats = stats;
    GP.pool = pool;
    GP.step = step;
    GP.U = U;
    GP.heightAtCPU = function (x, z) {
      const g = GP.ground; if (!g) return null;
      const u = (x - g.x0) / g.size * (g.res - 1), v = (z - g.z0) / g.size * (g.res - 1);
      if (u < 0 || v < 0 || u >= g.res - 1 || v >= g.res - 1) return null;
      const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv, o = iv * g.res + iu;
      return (hCPU[o] * (1 - fu) + hCPU[o + 1] * fu) * (1 - fv) + (hCPU[o + g.res] * (1 - fu) + hCPU[o + g.res + 1] * fu) * fv;
    };
  }
  (R0.cbzReady || Promise.resolve()).then(function () {
    try { goLive(); } catch (e) { console.error("[gpufx] init", e); }
  });

  /* the clock: the GAME's dt while playing (so a frozen-rAF CBZ.stepSim
     storyboard advances it tick for tick), nothing while paused */
  if (CBZ.onAlways) {
    CBZ.onAlways(96.5, function (dt) {
      if (!GP.on) return;
      const playing = !CBZ.game || CBZ.game.state === "playing";
      try { step(playing ? dt : 0); } catch (e) { console.error("[gpufx]", e); GP.on = false; }
    });
  }
})();
