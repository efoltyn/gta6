/* ============================================================
   src/world/water_wakefield.js — THE WAKE FIELD: everything that disturbs water.

   One simulated surface around the camera that every source stamps into and
   every sea shader reads. It is what turns a boat's passage, a swimmer's arms
   and a body going in into WATER that moves: rings that spread and interfere,
   a V of waves off a hull, foam that is laid down and decays.

   GPU STATE. A ping-pong pair of N x N render targets over a square box
   centred near the camera, snapped to its own texel grid. Half float when the
   GPU can render to it (RGBA = h, h_prev, fast foam, slow foam); otherwise
   two RGBA8 pairs (h and h_prev packed to 16 bits each, and the two foams).
   Each sim step:
     - a damped 2-D wave equation on h with signal speed C. A source moving at
       v > C leaves a V of half-angle asin(C/v): C = 2.2 m/s gives ~18 deg for
       a displacement hull at 7 m/s (Kelvin is 19.5), ~8 deg for a planing hull
       at 15 m/s, and rings dragged behind a swimmer or a kayak (v < C);
     - sources are DISPLACEMENTS: a hull adds -d0 * (shape now - shape at the
       last step) to h and h_prev, so water is pushed aside where the hull
       arrives and released where it left. A still hull costs nothing and
       nothing accumulates; a moving one radiates its wake. An impact is the
       same displacement once (a crater, then rings);
     - two foam channels: fast (bow and chine spray, ~3 s) and slow (prop
       wash, transom boil, impact patches, ~14 s), plus foam where the field's
       own crests get steep enough to break.
   The box grows with camera height (power-of-two steps, history resampled)
   so a ship's wake is still there from an aircraft.

   THE SEAM (builder of the sea shaders calls these; they never change shape):
     CBZ.waterWakeGLSL()      GLSL that declares the uniforms and defines
                              vec4 cbzWake(vec2 worldXZ): .xy surface slope
                              (dh/dx, dh/dz), .z foam 0..1, .w height (m).
                              Zero outside the box (faded over its last texels)
                              and when the field is off. Legal in vertex and
                              fragment shaders.
     CBZ.waterWakeUniforms()  the SAME uniform objects every call; their
                              .value is updated here each step.
   SOURCES (water_wake.js and water_impact.js are the callers):
     CBZ.waterWakeSource(ref, o)  a moving source this frame (hull, swimmer,
                                  fin): o = {x,z,fx,fz, hl,hb, dep, ff, fs,
                                  rim, ox,oz (offset along/across)}
     CBZ.waterWakeStamp(o)        a one-off disturbance: {x,z,r,amp,ff,fs}
   CPU TWIN (gameplay reads this, never the texture):
     CBZ.waterWakeTrack(ref, x, z, spd, amp, sigma, dt)  a hull's track
     CBZ.waterWakeRing(x, z, amp, sigma)                 an impact's ring
     CBZ.waterWakeHeightAt(x, z, self)  metres of wake/ring height at (x,z)
       from every recent track and ring except `self`'s own track
   AUDIT: CBZ.waterWakeAudit()

   COST. Nothing exists until a source appears in a water mode. No sim pass
   once no source is alive and the field has settled (it fades out and
   stops). One N x N pass per step (two in the RGBA8 fallback) at a fixed
   30 Hz step, never more than one per frame. Targets are disposed when the
   water mode ends. No allocation on the tick path.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- the numbers ---------------------------------------------------------
  const N = 512;                 // texels per side
  const BASE_SIZE = 153.6;       // m: 0.30 m texels near the water
  const MAX_SIZE = BASE_SIZE * 16;
  const C = 2.2;                 // m/s: signal speed of the field
  const DT = 1 / 30;             // s: fixed sim step
  const TAU_WAVE = 8;            // s: e-folding of wave motion
  const TAU_FAST = 3.0;          // s: bow / chine spray foam
  const TAU_SLOW = 14.0;         // s: aerated prop wash, transom, impact patches
  const H_RANGE = 2.0;           // m: packed-mode height range (+-)
  const SETTLE_T = 22;           // s without a source before the field stops
  const FADE_T = 3;              // s of fade-out at the end of that
  const SRC_MAX = 24;            // sources per step (uniform array)
  const STAMP_MAX = 16;          // queued one-off stamps
  const FWD_SHIFT = 0.28;        // box centre leads the camera by this x size

  const _ro = { has: false };
  function on() { return CBZ.CONFIG ? CBZ.CONFIG.WATER_V2 !== false : true; }
  function waterMode() {
    const g = CBZ.game;
    if (!g) return false;
    return CBZ.waterModeOn ? !!CBZ.waterModeOn() : g.mode === "city";
  }

  // ============================================================
  //  1. THE SEAM — uniforms shared by reference, GLSL by value
  // ============================================================
  const dummy = new THREE.DataTexture(new Uint8Array([127, 255, 127, 255]), 1, 1);
  dummy.needsUpdate = true;
  const U = {
    uWakeTex: { value: dummy },
    uWakeFoamTex: { value: dummy },
    uWakeBox: { value: new THREE.Vector4(0, 0, 1, 0) },        // minX, minZ, size, gain
    uWakeInfo: { value: new THREE.Vector4(1 / N, N, 0, H_RANGE) }, // texel uv, N, packed, range
  };
  CBZ.waterWakeUniforms = function () { return U; };

  CBZ.waterWakeGLSL = function () {
    return [
      "uniform sampler2D uWakeTex;",
      "uniform sampler2D uWakeFoamTex;",
      "uniform vec4 uWakeBox;",
      "uniform vec4 uWakeInfo;",
      "float cbzWakeH(vec2 uv) {",
      "  vec4 s = texture(uWakeTex, uv);",
      "  if (uWakeInfo.z > 0.5) return ((s.r * 65280.0 + s.g * 255.0) / 65535.0 * 2.0 - 1.0) * uWakeInfo.w;",
      "  return s.r;",
      "}",
      "vec4 cbzWake(vec2 p) {",
      "  if (uWakeBox.w <= 0.001) return vec4(0.0);",
      "  vec2 uv = (p - uWakeBox.xy) / uWakeBox.z;",
      "  vec2 e = min(uv, 1.0 - uv) * uWakeInfo.y;",
      "  float fade = smoothstep(2.0, 48.0, min(e.x, e.y)) * uWakeBox.w;",
      "  if (fade <= 0.0) return vec4(0.0);",
      "  float t = uWakeInfo.x;",
      "  float h = cbzWakeH(uv);",
      "  float dx = cbzWakeH(uv + vec2(t, 0.0)) - cbzWakeH(uv - vec2(t, 0.0));",
      "  float dz = cbzWakeH(uv + vec2(0.0, t)) - cbzWakeH(uv - vec2(0.0, t));",
      "  vec2 slope = vec2(dx, dz) / (2.0 * uWakeBox.z * t);",
      "  vec4 f = uWakeInfo.z > 0.5 ? texture(uWakeFoamTex, uv) : texture(uWakeTex, uv).baba;",
      "  float foam = clamp(f.r + f.g, 0.0, 1.0);",
      "  return vec4(slope * fade, foam * fade, h * fade);",
      "}",
    ].join("\n");
  };

  // ============================================================
  //  2. THE SIM (GPU)
  // ============================================================
  let R = null;                   // the renderer we built for
  let packed = false;
  let rtA = null, rtB = null;     // state ping-pong (read = rtA)
  let ftA = null, ftB = null;     // foam ping-pong (packed mode only)
  let simScene = null, simCam = null, simMesh = null, simMat = null, foamMat = null;
  let built = false, buildFailed = false;
  const box = { minX: 0, minZ: 0, size: BASE_SIZE, valid: false };
  let gain = 0;                   // the seam's global gain (fade in/out)
  let quietT = 1e9;               // s since a source was last seen
  let acc = 0;                    // step accumulator
  let stepSeq = 0;
  const AUD = { steps: 0, sources: 0, stamps: 0, lastSources: 0, resizes: 0, builds: 0, disposes: 0 };

  const BAND_MAX = 4;             // air-shock fronts crossing the box per step
  const bandU = [];
  for (let i = 0; i < BAND_MAX * 2; i++) bandU.push(new THREE.Vector4());
  const bandQ = new Float32Array(BAND_MAX * 7);   // x, z, r0, r1, width, foam, ruffle
  let bandN = 0;
  const srcU = [];                // uniform vec4 array
  for (let i = 0; i < SRC_MAX * 3; i++) srcU.push(new THREE.Vector4());

  const VS = [
    "precision highp float;",
    "in vec3 position;",
    "out vec2 vUv;",
    "void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  ].join("\n");

  // One fragment program, two roles in packed mode (state / foam) chosen by
  // define. Sources: a = (x0, z0, x1, z1) the segment the source moved along
  // this step; b = (dirX, dirZ, halfLen, +-halfBeam; negative = foam on the
  // rim only); c = (hull displacement, one-off displacement, fast foam, slow
  // foam), per step.
  function fragSrc(role) {
    return [
      "precision highp float;",
      "#define SRC_MAX " + SRC_MAX,
      role === "foam" ? "#define FOAM_ONLY 1" : "",
      packed ? "#define PACKED 1" : "",
      "uniform sampler2D uPrev;",
      "uniform sampler2D uPrevFoam;",
      "uniform vec4 uOld;",       // old minX, minZ, size, valid
      "uniform vec4 uNew;",       // new minX, minZ, size, texel(m)
      "uniform vec4 uK;",         // C^2(courant), velocity damp, fast keep, slow keep
      "uniform vec4 uK2;",        // diffusion, height keep, packed foam floor, H range
      "uniform int uSrcN;",
      "uniform vec4 uSrc[" + (SRC_MAX * 3) + "];",
      "uniform int uBandN;",
      "uniform vec4 uBand[" + (BAND_MAX * 2) + "];",
      // value noise: foam is laid as lace with ragged edges, never as a flat
      // disc of uniform coverage
      "float h21(vec2 p) { p = mod(p, 997.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      "float vnz(vec2 p) {",
      "  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0)), u.x), u.y);",
      "}",
      "float lace(vec2 w) { return 0.5 * vnz(w * 0.45) + 0.32 * vnz(w * 1.3 + 17.0) + 0.18 * vnz(w * 3.7 - 5.0); }",
      "in vec2 vUv;",
      "layout(location = 0) out vec4 oCol;",
      "float unpack16(vec2 v) { return ((v.x * 65280.0 + v.y * 255.0) / 65535.0 * 2.0 - 1.0) * uK2.w; }",
      "vec2 pack16(float h) {",
      "  float x = clamp(h / uK2.w * 0.5 + 0.5, 0.0, 1.0) * 65535.0;",
      "  float hi = floor(x / 256.0);",
      "  return vec2(hi, floor(x - hi * 256.0)) / 255.0;",
      "}",
      // the old state at a world point: (h, hPrev, foamFast, foamSlow)
      "vec4 st(vec2 w) {",
      "  if (uOld.w < 0.5) return vec4(0.0);",
      "  vec2 uv = (w - uOld.xy) / uOld.z;",
      "  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);",
      "#ifdef PACKED",
      "  vec4 s = texture(uPrev, uv);",
      "  vec4 f = texture(uPrevFoam, uv);",
      "  return vec4(unpack16(s.rg), unpack16(s.ba), f.r, f.g);",
      "#else",
      "  return texture(uPrev, uv);",
      "#endif",
      "}",
      "float shapeAt(vec2 q, vec4 b) {",
      "  float u = dot(q, b.xy) / b.z;",
      "  float w = dot(q, vec2(-b.y, b.x)) / abs(b.w);",
      "  float r2 = u * u + w * w;",
      "  return r2 < 9.0 ? exp(-2.2 * r2) : 0.0;",
      "}",
      "void main() {",
      "  vec2 W = uNew.xy + vUv * uNew.z;",
      "  float dx = uNew.w;",
      "  vec4 c = st(W);",
      "  float hL = st(W - vec2(dx, 0.0)).x, hR = st(W + vec2(dx, 0.0)).x;",
      "  float hD = st(W - vec2(0.0, dx)).x, hU = st(W + vec2(0.0, dx)).x;",
      "  float lap = hL + hR + hD + hU - 4.0 * c.x;",
      // sponge: waves leaving the box are absorbed, not reflected
      "  vec2 e = min(vUv, 1.0 - vUv) * " + N.toFixed(1) + ";",
      "  float sponge = clamp(min(e.x, e.y) / 24.0, 0.0, 1.0);",
      "  float edgeK = smoothstep(4.0, 56.0, min(e.x, e.y));",
      "  float h = (c.x + (c.x - c.y) * uK.y * mix(0.82, 1.0, sponge) + uK.x * lap + uK2.x * lap) * uK2.y;",
      "  float hp = c.x;",
      "  float ff = c.z * uK.z, fs = c.w * uK.w;",
      // the field's own crests break white where they get steep (slope 0.35:
      // the bow curl and the nearest crests, not the whole displaced width)
      "  float slope = length(vec2(hR - hL, hU - hD)) / (2.0 * dx);",
      "  float lc = lace(W);",
      "  float lk = smoothstep(0.30, 0.75, lc);",
      "  ff += min(0.25, max(0.0, slope - 0.35) * 0.6) * (0.4 + 0.8 * lk);",
      "  for (int i = 0; i < SRC_MAX; i++) {",
      "    if (i >= uSrcN) break;",
      "    vec4 a = uSrc[i * 3], b = uSrc[i * 3 + 1], s = uSrc[i * 3 + 2];",
      "    vec2 p0 = a.xy, p1 = a.zw, d = p1 - p0;",
      "    float reach = 3.0 * max(b.z, abs(b.w)) + length(d);",
      "    vec2 m = W - (p0 + p1) * 0.5;",
      "    if (dot(m, m) > reach * reach) continue;",
      // displacement: where the body is now minus where it was
      "    float dsp = 0.0;",
      "    if (s.x != 0.0) dsp -= s.x * (shapeAt(W - p1, b) - shapeAt(W - p0, b));",
      "    if (s.y != 0.0) dsp -= s.y * shapeAt(W - p1, b);",
      "    dsp *= edgeK;",
      "    h += dsp; hp += dsp;",
      // foam over the swept capsule (filled, or on its rim)
      "    if (s.z > 0.0 || s.w > 0.0) {",
      "      float L2 = dot(d, d);",
      "      float t = L2 > 1e-6 ? clamp(dot(W - p0, d) / L2, 0.0, 1.0) : 0.0;",
      "      vec2 q = W - (p0 + d * t);",
      "      float u = dot(q, b.xy) / b.z;",
      "      float w = dot(q, vec2(-b.y, b.x)) / abs(b.w);",
      "      float r = sqrt(u * u + w * w);",
      "      float fm = b.w < 0.0 ? exp(-7.0 * (r - 1.0) * (r - 1.0)) : (r < 3.0 ? exp(-2.2 * r * r) : 0.0);",
      "      float fl = clamp(fm * (0.45 + 0.9 * lk) - (1.0 - fm) * 0.35 * (1.0 - lk), 0.0, 1.0);",
      "      fl *= edgeK;",
      "      ff += s.z * fl; fs += s.w * fl;",
      "    }",
      "  }",
      "  for (int i = 0; i < " + BAND_MAX + "; i++) {",
      "    if (i >= uBandN) break;",
      "    vec4 a = uBand[i * 2], b = uBand[i * 2 + 1];",       // (x, z, r0, r1), (width, foam, ruffle, 0)
      "    float d = length(W - a.xy);",
      "    float m = smoothstep(a.z - b.x, a.z, d) * (1.0 - smoothstep(a.w, a.w + b.x, d));",
      "    if (m <= 0.0) continue;",
      "    float rf = b.z * m * (vnz(W * 1.9) - 0.5) * 2.0;",
      "    rf *= edgeK;",
      "    h += rf; hp += rf;",
      "    ff += b.y * m * edgeK * (0.3 + 0.9 * lk);",
      "  }",
      "  ff = clamp(ff - uK2.z, 0.0, 1.0);",
      "  fs = clamp(fs - uK2.z, 0.0, 1.0);",
      "#ifdef PACKED",
      "#ifdef FOAM_ONLY",
      "  oCol = vec4(ff, fs, 0.0, 1.0);",
      "#else",
      "  oCol = vec4(pack16(h), pack16(hp));",
      "#endif",
      "#else",
      "  oCol = vec4(h, hp, ff, fs);",
      "#endif",
      "}",
    ].join("\n");
  }

  function makeRT(type, filter) {
    return new THREE.WebGLRenderTarget(N, N, {
      type: type, format: THREE.RGBAFormat,
      minFilter: filter, magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
  }

  function simUniforms() {
    return {
      uPrev: { value: null }, uPrevFoam: { value: dummy },
      uOld: { value: new THREE.Vector4() }, uNew: { value: new THREE.Vector4() },
      uK: { value: new THREE.Vector4() }, uK2: { value: new THREE.Vector4() },
      uSrcN: { value: 0 }, uSrc: { value: srcU },
      uBandN: { value: 0 }, uBand: { value: bandU },
    };
  }

  function build() {
    if (built || buildFailed) return built;
    R = CBZ.renderer;
    if (!R || !R.extensions) return false;
    try {
      const ext = R.extensions;
      const half = !!(ext.has && (ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float")));
      packed = !half;
      U.uWakeInfo.value.z = packed ? 1 : 0;
      if (packed) {
        rtA = makeRT(THREE.UnsignedByteType, THREE.NearestFilter); rtB = makeRT(THREE.UnsignedByteType, THREE.NearestFilter);
        ftA = makeRT(THREE.UnsignedByteType, THREE.LinearFilter); ftB = makeRT(THREE.UnsignedByteType, THREE.LinearFilter);
      } else {
        rtA = makeRT(THREE.HalfFloatType, THREE.LinearFilter); rtB = makeRT(THREE.HalfFloatType, THREE.LinearFilter);
      }
      simScene = new THREE.Scene();
      simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      simMat = new THREE.RawShaderMaterial({
        name: "CBZ Wake Field", glslVersion: THREE.GLSL3,
        vertexShader: VS, fragmentShader: fragSrc("state"), uniforms: simUniforms(),
        depthTest: false, depthWrite: false,
      });
      if (packed) {
        foamMat = new THREE.RawShaderMaterial({
          name: "CBZ Wake Foam", glslVersion: THREE.GLSL3,
          vertexShader: VS, fragmentShader: fragSrc("foam"), uniforms: simUniforms(),
          depthTest: false, depthWrite: false,
        });
        // the two programs read the same numbers: share the uniform objects
        const a = simMat.uniforms, b = foamMat.uniforms;
        for (const k in a) b[k] = a[k];
      }
      simMesh = new THREE.Mesh(geo, simMat);
      simMesh.frustumCulled = false;
      simScene.add(simMesh);
      built = true;
      box.valid = false;
      AUD.builds++;
    } catch (e) {
      buildFailed = true;
      try { console.warn("[wakefield] build failed", e); } catch (_) {}
      dispose();
    }
    return built;
  }

  function dispose() {
    [rtA, rtB, ftA, ftB].forEach(function (t) { if (t) t.dispose(); });
    rtA = rtB = ftA = ftB = null;
    if (simMesh) { simMesh.geometry.dispose(); simMesh = null; }
    if (simMat) { simMat.dispose(); simMat = null; }
    if (foamMat) { foamMat.dispose(); foamMat = null; }
    simScene = null; simCam = null;
    if (built) AUD.disposes++;
    built = false;
    box.valid = false;
    gain = 0;
    U.uWakeTex.value = dummy; U.uWakeFoamTex.value = dummy;
    U.uWakeBox.value.w = 0;
    srcN = 0; stampN = 0; bandN = 0;
  }

  // ---- the box -------------------------------------------------------------
  const _fwd = new THREE.Vector3();
  function wantSize(alt) {
    let s = BASE_SIZE;
    // power-of-two growth with height: 0.3 m texels at sea level, the whole
    // harbour from a rooftop, a ship's wake from an aircraft
    while (s < MAX_SIZE && alt > s * 0.22) s *= 2;
    // hysteresis: only shrink once well below the threshold
    if (s < box.size && alt > box.size * 0.5 * 0.16) s = box.size;
    return s;
  }
  // the box for this step: returns true when it moved or resized
  const nb = { minX: 0, minZ: 0, size: BASE_SIZE };
  // A big event (a meteor, a blast) asks the box to hold it whole for a while.
  const hold = { x: 0, z: 0, rad: 0, until: -1 };
  CBZ.waterWakeHold = function (x, z, rad, secs) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(rad > 0)) return;
    const until = twT + Math.max(1, +secs || 6);
    if (hold.until > twT && hold.rad > rad) return;      // a bigger one is being held
    hold.x = x; hold.z = z; hold.rad = rad; hold.until = until;
    quietT = 0;
  };
  function placeBox() {
    const cam = CBZ.camera;
    if (!cam) return;
    const sea = CBZ.waterSeaY ? +CBZ.waterSeaY() || 0 : 0;
    const alt = Math.max(0, cam.position.y - sea);
    let size = wantSize(alt);
    cam.getWorldDirection(_fwd);
    const fl = Math.hypot(_fwd.x, _fwd.z) || 1;
    let cx = cam.position.x + (_fwd.x / fl) * size * FWD_SHIFT;
    let cz = cam.position.z + (_fwd.z / fl) * size * FWD_SHIFT;
    if (hold.until > twT) {
      const dx = hold.x - cam.position.x, dz = hold.z - cam.position.z, d = Math.hypot(dx, dz);
      // in view (ahead of the camera, or close enough to be around it)
      if ((dx * _fwd.x + dz * _fwd.z) / fl > -0.3 * d || d < hold.rad) {
        // centred between the eye and the event, big enough for both with a
        // margin wide enough that its fade never reaches the event
        const need = (d * 0.5 + hold.rad) * 2 * 1.25;
        while (size < MAX_SIZE && size < need) size *= 2;
        cx = cam.position.x + dx * 0.5; cz = cam.position.z + dz * 0.5;
      }
    }
    const tx = size / N;
    nb.size = size;
    nb.minX = Math.floor((cx - size * 0.5) / tx) * tx;
    nb.minZ = Math.floor((cz - size * 0.5) / tx) * tx;
  }

  // ============================================================
  //  3. SOURCES
  // ============================================================
  // Per-frame moving sources, kept nearest-first up to SRC_MAX. Each ref
  // remembers where it was at the last sim step so a fast hull lays a
  // continuous stamp, not a dotted line.
  const sRef = new Array(SRC_MAX).fill(null);
  const sBuf = new Float32Array(SRC_MAX * 14);
  const sD2 = new Float32Array(SRC_MAX);
  let srcN = 0;
  // o: x,z (centre), fx,fz (heading unit), hl,hb, dep (m), ff,fs (foam per
  // second), rim (bool), ox,oz (offset along/across the heading), key (0..3:
  // which sub-source of this ref, so a hull's body and transom keep separate
  // histories)
  CBZ.waterWakeSource = function (ref, o) {
    if (!ref || !o || !on()) return false;
    const cam = CBZ.camera;
    let d2 = 0;
    if (cam) { const dx = o.x - cam.position.x, dz = o.z - cam.position.z; d2 = dx * dx + dz * dz; }
    // outside any box we could have: nothing to draw into
    const lim = box.size * 0.9 + 60;
    if (d2 > lim * lim) return false;
    quietT = 0;
    let i = srcN;
    if (srcN >= SRC_MAX) {
      let far = -1, fd = d2;
      for (let k = 0; k < SRC_MAX; k++) if (sD2[k] > fd) { fd = sD2[k]; far = k; }
      if (far < 0) return false;
      i = far;
    } else srcN++;
    sRef[i] = ref; sD2[i] = d2;
    const b = i * 14;
    const fx = +o.fx || 0, fz = +o.fz || 1;
    const ox = +o.ox || 0, oz = +o.oz || 0;
    sBuf[b] = o.x + fx * ox + fz * oz; sBuf[b + 1] = o.z + fz * ox - fx * oz;
    sBuf[b + 2] = fx; sBuf[b + 3] = fz;
    sBuf[b + 4] = Math.max(0.05, +o.hl || 0.5); sBuf[b + 5] = Math.max(0.05, +o.hb || 0.5);
    sBuf[b + 6] = +o.dep || 0; sBuf[b + 7] = +o.ff || 0; sBuf[b + 8] = +o.fs || 0;
    sBuf[b + 9] = o.rim ? 1 : 0; sBuf[b + 10] = (o.key | 0);
    return true;
  };

  // One-off stamps (an impact, a stroke, a blade, a raindrop): queued until
  // the next step consumes them. Bigger ones win when the queue is full.
  const qBuf = new Float32Array(STAMP_MAX * 6);
  let stampN = 0;
  CBZ.waterWakeStamp = function (o) {
    if (!o || !on()) return false;
    const x = +o.x, z = +o.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const cam = CBZ.camera;
    if (cam) {
      const dx = x - cam.position.x, dz = z - cam.position.z, lim = box.size * 0.9 + 60;
      const held = hold.until > twT && Math.hypot(x - hold.x, z - hold.z) < hold.rad * 1.2;
      if (!held && dx * dx + dz * dz > lim * lim) return false;
    }
    quietT = 0;
    const r = Math.max(0.05, +o.r || 0.4);
    // a disturbance cannot stand taller than a fifth of its own width: a
    // stroke's ring is a centimetre or two, never a crest over a head
    const a0 = +o.amp || 0, amp = Math.sign(a0) * Math.min(Math.abs(a0), 0.2 * r);
    const w = Math.abs(amp) * r + (+o.ff || 0) + (+o.fs || 0);
    let i = stampN;
    if (stampN >= STAMP_MAX) {
      let lo = -1, lw = w;
      for (let k = 0; k < STAMP_MAX; k++) {
        const b = k * 6, kw = Math.abs(qBuf[b + 3]) * qBuf[b + 2] + qBuf[b + 4] + qBuf[b + 5];
        if (kw < lw) { lw = kw; lo = k; }
      }
      if (lo < 0) return false;
      i = lo;
    } else stampN++;
    const b = i * 6;
    qBuf[b] = x; qBuf[b + 1] = z; qBuf[b + 2] = r; qBuf[b + 3] = amp;
    qBuf[b + 4] = Math.max(0, +o.ff || 0); qBuf[b + 5] = Math.max(0, +o.fs || 0);
    AUD.stamps++;
    if (o.ring !== false && Math.abs(amp) > 0.004) CBZ.waterWakeRing(x, z, Math.abs(amp) * 0.55, Math.max(0.35, r * 0.8));
    return true;
  };

  /* CBZ.waterWakeBand(x, z, r0, r1, o): a pressure front crossing the water
     between radii r0 and r1 this frame (an air shock): it ruffles the water
     as it passes, nothing more. o = {width (m), ruffle (m)}. Bands from one centre coalesce until the next step. */
  CBZ.waterWakeBand = function (x, z, r0, r1, o) {
    if (!on() || !Number.isFinite(x) || !Number.isFinite(z) || !(r1 > 0)) return false;
    const cam = CBZ.camera;
    if (cam) {
      // does the band reach the box at all?
      const d = Math.hypot(cam.position.x - x, cam.position.z - z), reach = box.size * 0.9 + 60;
      if (r1 < d - reach || r0 > d + reach) return false;
    }
    o = o || {};
    let i = -1;
    for (let k = 0; k < bandN; k++) if (bandQ[k * 7] === x && bandQ[k * 7 + 1] === z) { i = k; break; }
    if (i < 0) {
      if (bandN >= BAND_MAX) return false;
      i = bandN++;
      bandQ[i * 7] = x; bandQ[i * 7 + 1] = z; bandQ[i * 7 + 2] = Math.max(0, r0); bandQ[i * 7 + 3] = r1;
    } else {
      bandQ[i * 7 + 2] = Math.min(bandQ[i * 7 + 2], Math.max(0, r0)); bandQ[i * 7 + 3] = Math.max(bandQ[i * 7 + 3], r1);
    }
    bandQ[i * 7 + 4] = Math.max(0.5, +o.width || 3);
    // no foam: a front moving at hundreds of m/s sweeps its whole radius before
    // any foam can fade, so even a trace of it painted a disc on the sea
    bandQ[i * 7 + 5] = 0;
    bandQ[i * 7 + 6] = Math.min(0.03, Math.max(0, +o.ruffle || 0.01));
    quietT = 0;
    return true;
  };

  // per-ref memory of the last stamped position, one per sub-source key
  function memOf(ref, key) {
    let m = ref._wkMem;
    if (!m) m = ref._wkMem = [null, null, null, null];
    let e = m[key & 3];
    if (!e) e = m[key & 3] = { x: 0, z: 0, seq: -9 };
    return e;
  }

  // Fill the uniform array for one step from the frame's sources and stamps.
  function packSources(step) {
    let n = 0;
    const tx = box.size / N;
    const minR = tx * 0.8;                         // never much thinner than a texel
    for (let i = 0; i < stampN && n < SRC_MAX; i++, n++) {
      const b = i * 6, r = Math.max(minR, qBuf[b + 2]);
      srcU[n * 3].set(qBuf[b], qBuf[b + 1], qBuf[b], qBuf[b + 1]);
      srcU[n * 3 + 1].set(1, 0, r, r);
      srcU[n * 3 + 2].set(0, qBuf[b + 3], Math.min(1, qBuf[b + 4]), Math.min(1, qBuf[b + 5]));
    }
    stampN = 0;
    for (let i = 0; i < srcN && n < SRC_MAX; i++) {
      const ref = sRef[i];
      sRef[i] = null;
      if (!ref) continue;
      const b = i * 14;
      const x = sBuf[b], z = sBuf[b + 1];
      const mem = memOf(ref, sBuf[b + 10]);
      // a source that was stamped at the previous step moves from there; one
      // that is new (or skipped steps, or teleported) starts where it is
      let x0 = x, z0 = z;
      if (mem.seq === step - 1) {
        const ddx = x - mem.x, ddz = z - mem.z;
        if (ddx * ddx + ddz * ddz < 25 * 25) { x0 = mem.x; z0 = mem.z; }
      }
      mem.x = x; mem.z = z; mem.seq = step;
      const hl = Math.max(minR, sBuf[b + 4]), hb = Math.max(minR, sBuf[b + 5]);
      srcU[n * 3].set(x0, z0, x, z);
      srcU[n * 3 + 1].set(sBuf[b + 2], sBuf[b + 3], hl, sBuf[b + 9] > 0.5 ? -hb : hb);
      srcU[n * 3 + 2].set(sBuf[b + 6], 0, Math.min(1, sBuf[b + 7] * DT), Math.min(1, sBuf[b + 8] * DT));
      n++;
    }
    AUD.lastSources = n;
    AUD.sources += n;
    srcN = 0;
    return n;
  }

  // ============================================================
  //  4. THE STEP
  // ============================================================
  const _cc = new THREE.Color();
  function step(fresh) {
    const u = simMat.uniforms;
    const n = packSources(stepSeq);
    u.uSrcN.value = n;
    for (let i = 0; i < bandN; i++) {
      const q = i * 7;
      bandU[i * 2].set(bandQ[q], bandQ[q + 1], bandQ[q + 2], bandQ[q + 3]);
      bandU[i * 2 + 1].set(Math.max(bandQ[q + 4], nb.size / N * 2), bandQ[q + 5], bandQ[q + 6], 0);
    }
    u.uBandN.value = bandN;
    bandN = 0;
    u.uOld.value.set(box.minX, box.minZ, box.size, (box.valid && !fresh) ? 1 : 0);
    u.uNew.value.set(nb.minX, nb.minZ, nb.size, nb.size / N);
    const courant = C * DT / (nb.size / N);
    u.uK.value.set(courant * courant, Math.exp(-DT / TAU_WAVE), Math.exp(-DT / TAU_FAST), Math.exp(-DT / TAU_SLOW));
    // diffusion keeps the grid from ringing; the height keep lets a carried
    // depression relax once its source is gone; the floor lets 8-bit foam
    // actually reach zero
    u.uK2.value.set(0.02, 0.9993, packed ? 0.6 / 255 : 0.0004, H_RANGE);
    if (nb.size !== box.size && box.valid) AUD.resizes++;
    u.uPrev.value = rtA.texture;
    u.uPrevFoam.value = packed ? ftA.texture : dummy;

    const prevRT = R.getRenderTarget();
    const prevAuto = R.autoClear;
    const xr = R.xr && R.xr.enabled;
    R.autoClear = false;
    if (R.xr) R.xr.enabled = false;
    simMesh.material = simMat;
    R.setRenderTarget(rtB);
    R.render(simScene, simCam);
    if (packed) {
      simMesh.material = foamMat;
      R.setRenderTarget(ftB);
      R.render(simScene, simCam);
      simMesh.material = simMat;
    }
    R.setRenderTarget(prevRT);
    R.autoClear = prevAuto;
    if (R.xr) R.xr.enabled = xr;

    let t = rtA; rtA = rtB; rtB = t;
    if (packed) { t = ftA; ftA = ftB; ftB = t; }
    box.minX = nb.minX; box.minZ = nb.minZ; box.size = nb.size; box.valid = true;
    U.uWakeTex.value = rtA.texture;
    U.uWakeFoamTex.value = packed ? ftA.texture : dummy;
    U.uWakeBox.value.set(box.minX, box.minZ, box.size, gain);
    U.uWakeInfo.value.x = 1 / N;
    stepSeq++;
    AUD.steps++;
  }

  // After the source producers (water_wake.js runs at 60) and before render.
  CBZ.onUpdate(60.5, function (dt) {
    if (!on() || !waterMode()) { if (built) dispose(); return; }
    dt = Math.min(0.1, Math.max(0, +dt || 0));
    twinTick(dt);
    const anything = srcN > 0 || stampN > 0 || bandN > 0;
    if (!anything) quietT += dt;
    if (!anything && !built) return;               // never built: zero cost
    if (!built && !build()) { srcN = 0; stampN = 0; return; }
    if (quietT > SETTLE_T) {
      // settled: the seam reads zero, the sim stops, the history is stale
      gain = 0; U.uWakeBox.value.w = 0; box.valid = false; acc = 0;
      return;
    }
    const fresh = !box.valid;
    gain = quietT > SETTLE_T - FADE_T ? Math.max(0, (SETTLE_T - quietT) / FADE_T) : 1;
    acc += dt;
    if (acc < DT && !fresh) { U.uWakeBox.value.w = gain; return; }
    acc = Math.max(0, Math.min(DT, acc - DT));     // at most one step a frame
    placeBox();
    try { step(fresh); } catch (e) {
      try { console.warn("[wakefield] step failed", e); } catch (_) {}
      buildFailed = true; dispose();
    }
  });
  // leaving the water mode while paused (a menu back to the title) also frees it
  if (CBZ.onAlways) {
    CBZ.onAlways(60.5, function () {
      if (built && (!on() || !waterMode())) dispose();
    });
  }

  // ============================================================
  //  5. THE CPU TWIN — what gameplay feels of the field
  // ============================================================
  // Every track point radiates a ring at the field's speed C, crest followed
  // by trough, fading with age and spreading. The envelope of a moving hull's
  // rings is its wake V; a kayak downstream of a speedboat rises and rolls
  // as that envelope reaches it. Deterministic: tracks come from gameplay
  // positions, never from the texture, and they are kept whatever the camera
  // is looking at.
  const TRK_MAX = 16, TRK_PTS = 72, TRK_STRIDE = 5, EMIT_T = 0.2, TRK_AGE = 18;
  const RING_MAX = 24, RING_AGE = 9;
  const TW_TAU = 6;
  const trk = [];
  for (let i = 0; i < TRK_MAX; i++) {
    trk.push({ ref: null, buf: new Float32Array(TRK_PTS * TRK_STRIDE), head: 0, n: 0, acc: 0, seen: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  }
  const rings = new Float32Array(RING_MAX * 5);   // x, z, t0, amp, sigma
  let ringHead = 0;
  let twT = 0;                                     // the twin's own clock (sim time)

  function twinTick(dt) {
    twT += dt;
    for (let i = 0; i < TRK_MAX; i++) {
      const T = trk[i];
      if (!T.ref) continue;
      T.seen += dt;
      if (T.seen > TRK_AGE) { T.ref = null; T.n = 0; T.head = 0; }
    }
  }

  function trackOf(ref) {
    let free = -1, old = -1, oldSeen = -1;
    for (let i = 0; i < TRK_MAX; i++) {
      const T = trk[i];
      if (T.ref === ref) return T;
      if (!T.ref) { if (free < 0) free = i; }
      else if (T.seen > oldSeen) { oldSeen = T.seen; old = i; }
    }
    const k = free >= 0 ? free : old;
    if (k < 0) return null;
    const T = trk[k];
    T.ref = ref; T.n = 0; T.head = 0; T.acc = EMIT_T; T.seen = 0;
    return T;
  }

  // amp: the wake's crest height (m) this hull makes at this speed; sigma:
  // the crest's width (m), about the hull's half-beam.
  CBZ.waterWakeTrack = function (ref, x, z, spd, amp, sigma, dt) {
    if (!ref || !(amp > 0.002) || !(spd > 0.4)) return;
    const T = trackOf(ref);
    if (!T) return;
    T.seen = 0;
    T.acc += Math.min(0.2, +dt || 0);
    if (T.acc < EMIT_T) return;
    T.acc = 0;
    const o = T.head * TRK_STRIDE, b = T.buf;
    b[o] = x; b[o + 1] = z; b[o + 2] = twT;
    // per-point strength: rings emitted C*EMIT_T apart overlap over sigma, so
    // the envelope sums ~sigma/(C*EMIT_T) of them
    b[o + 3] = amp * Math.min(1, (C * EMIT_T) / Math.max(0.3, sigma)) * 1.1;
    b[o + 4] = Math.max(0.4, sigma);
    T.head = (T.head + 1) % TRK_PTS;
    if (T.n < TRK_PTS) T.n++;
    // bounding box of the live points + their furthest ring, for a cheap reject
    let mx = 1e9, Mx = -1e9, mz = 1e9, Mz = -1e9;
    for (let k = 0; k < T.n; k++) {
      const q = k * TRK_STRIDE;
      if (b[q] < mx) mx = b[q]; if (b[q] > Mx) Mx = b[q];
      if (b[q + 1] < mz) mz = b[q + 1]; if (b[q + 1] > Mz) Mz = b[q + 1];
    }
    const pad = C * TRK_AGE + 4;
    T.minX = mx - pad; T.maxX = Mx + pad; T.minZ = mz - pad; T.maxZ = Mz + pad;
  };

  CBZ.waterWakeRing = function (x, z, amp, sigma) {
    if (!(amp > 0.003) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const o = ringHead * 5;
    rings[o] = x; rings[o + 1] = z; rings[o + 2] = twT;
    rings[o + 3] = Math.min(1.5, amp); rings[o + 4] = Math.max(0.3, sigma || 0.6);
    ringHead = (ringHead + 1) % RING_MAX;
  };

  // crest-then-trough profile, peak ~0.71 at u = -0.707 scaled to 1
  function ringH(r, age, amp, sig) {
    const R0 = C * age;
    const u = (r - R0) / sig;
    if (u > 3 || u < -3) return 0;
    return -amp * 1.65 * u * Math.exp(-u * u) * Math.exp(-age / TW_TAU) / Math.sqrt(1 + R0 / (4 * sig));
  }

  CBZ.waterWakeHeightAt = function (x, z, self) {
    let h = 0;
    for (let i = 0; i < TRK_MAX; i++) {
      const T = trk[i];
      if (!T.ref || T.ref === self || T.n === 0) continue;
      if (x < T.minX || x > T.maxX || z < T.minZ || z > T.maxZ) continue;
      const b = T.buf;
      for (let k = 0; k < T.n; k++) {
        const q = k * TRK_STRIDE;
        const age = twT - b[q + 2];
        if (age > TRK_AGE || age < 0) continue;
        const dx = x - b[q], dz = z - b[q + 1];
        const sig = b[q + 4];
        const R0 = C * age, lim = R0 + 3 * sig;
        const d2 = dx * dx + dz * dz;
        if (d2 > lim * lim) continue;
        const lo = R0 - 3 * sig;
        if (lo > 0 && d2 < lo * lo) continue;
        h += ringH(Math.sqrt(d2), age, b[q + 3], sig);
      }
    }
    for (let i = 0; i < RING_MAX; i++) {
      const o = i * 5;
      const amp = rings[o + 3];
      if (!(amp > 0)) continue;
      const age = twT - rings[o + 2];
      if (age > RING_AGE || age < 0) continue;
      const dx = x - rings[o], dz = z - rings[o + 1];
      h += ringH(Math.sqrt(dx * dx + dz * dz), age, amp, rings[o + 4]);
    }
    return h;
  };

  /* ONE QUESTION FOR EVERYTHING AFLOAT: what is the water doing here?
       CBZ.waterSample(x, z, out, self) -> out {
         y      the surface (swell, impact rings, a tsunami bore, floodwater
                over a street) plus the wake twin (every hull's wake but
                `self`'s own)
         depth  metres of water under that surface (0 = dry)
         vx,vz  the water's own horizontal velocity (current, surge, backwash)
         wet    1 where there is water }
     Built on the sea's one CPU query (CBZ.waterSurfaceAt) when it is there;
     otherwise the sea-only height with still water. Hulls, floating bodies
     and swimmers all read this, so they all do what the water does. */
  const _ws = { y: 0, depth: 0, vx: 0, vz: 0, wet: 0 };
  const _cur = { x: 0, z: 0 };
  CBZ.waterSample = function (x, z, out, self) {
    out = out || {};
    if (typeof CBZ.waterSurfaceAt === "function") {
      _ws.y = 0; _ws.depth = 0; _ws.vx = 0; _ws.vz = 0; _ws.wet = 0;
      const r = CBZ.waterSurfaceAt(x, z, _ws) || _ws;
      out.y = +r.y || 0; out.depth = Math.max(0, +r.depth || 0);
      out.vx = +r.vx || 0; out.vz = +r.vz || 0;
      out.wet = r.wet == null ? (out.depth > 0 ? 1 : 0) : +r.wet;
    } else {
      out.y = CBZ.citySeaHeightAt ? +CBZ.citySeaHeightAt(x, z) || 0 : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
      out.wet = CBZ.cityWaterAt && CBZ.cityWaterAt(x, z) ? 1 : 0;
      out.depth = out.wet ? (CBZ.cityWaterDepthAt ? Math.max(0, +CBZ.cityWaterDepthAt(x, z) || 0) : 8) : 0;
      out.vx = 0; out.vz = 0;
      // the sea's own ambient current, where the water field has one
      const wf = CBZ.waterField;
      if (out.wet && wf && typeof wf.currentAt === "function") {
        try { const c = wf.currentAt(x, z, undefined, _cur); if (c) { out.vx = +c.x || 0; out.vz = +c.z || 0; } } catch (e) {}
      }
    }
    out.wake = out.wet ? CBZ.waterWakeHeightAt(x, z, self) : 0;
    out.y += out.wake;
    return out;
  };

  // a new match starts on calm water
  CBZ.waterWakeReset = function () {
    for (let i = 0; i < TRK_MAX; i++) { trk[i].ref = null; trk[i].n = 0; trk[i].head = 0; }
    rings.fill(0);
    box.valid = false; quietT = 1e9; srcN = 0; stampN = 0;
  };

  // ============================================================
  //  6. AUDIT
  // ============================================================
  let _rb = null;
  // IEEE half -> float (a half-float target reads back as 16-bit words)
  function half(u) {
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    if (e === 0) return s * f * 5.960464477539063e-8;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  CBZ.waterWakeAudit = function () {
    let tracks = 0, live = 0;
    for (let i = 0; i < TRK_MAX; i++) if (trk[i].ref) { tracks++; live += trk[i].n; }
    const out = {
      built: built, failed: buildFailed, target: built ? (packed ? "rgba8-packed" : "half-float") : null,
      n: N, box: +box.size.toFixed(1), texel: +(box.size / N).toFixed(3),
      at: [+(box.minX + box.size / 2).toFixed(1), +(box.minZ + box.size / 2).toFixed(1)],
      c: C, dt: DT, gain: +gain.toFixed(2), quietT: +Math.min(999, quietT).toFixed(1),
      steps: AUD.steps, sourcesThisStep: AUD.lastSources, sourcesTotal: AUD.sources, stamps: AUD.stamps,
      resizes: AUD.resizes, builds: AUD.builds, disposes: AUD.disposes,
      tracks: tracks, trackPoints: live, maxH: null, foamSum: null, complete: null,
    };
    // read the whole state back (audit only: it stalls the GPU). Direct GL so
    // the half-float target is read as what it is, 16-bit words.
    if (built && box.valid && R) {
      const prev = R.getRenderTarget();
      try {
        const gl = R.getContext();
        R.setRenderTarget(rtA);
        out.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        let mh = 0, fs = 0, wet = 0, sat = 0;
        const hb = new Float32Array(N * N);              // heights, for the slope stats
        if (packed) {
          if (!_rb || !(_rb instanceof Uint8Array)) _rb = new Uint8Array(N * N * 4);
          gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, _rb);
          for (let i = 0; i < N * N; i++) {
            const hv = ((_rb[i * 4] * 256 + _rb[i * 4 + 1]) / 65535 * 2 - 1) * H_RANGE;
            hb[i] = hv;
            if (Math.abs(hv) > mh) mh = Math.abs(hv);
          }
          R.setRenderTarget(ftA);
          gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, _rb);
          for (let i = 0; i < N * N; i++) { const f = (_rb[i * 4] + _rb[i * 4 + 1]) / 255; fs += f; if (f > 0.05) wet++; if (f > 0.95) sat++; }
        } else {
          // RGBA/FLOAT is the read every float colour buffer accepts; the
          // implementation's own pair (often HALF_FLOAT) is the fallback
          const asHalf = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.HALF_FLOAT &&
            gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) === gl.RGBA;
          if (!_rb || !(_rb instanceof Float32Array)) _rb = new Float32Array(N * N * 4);
          gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, _rb);
          let err = gl.getError();
          let src = _rb, dec = function (v) { return v; };
          if (err && asHalf) {
            const hb = new Uint16Array(N * N * 4);
            gl.readPixels(0, 0, N, N, gl.RGBA, gl.HALF_FLOAT, hb);
            err = gl.getError(); src = hb; dec = half;
          }
          out.readGlError = err;
          for (let i = 0; i < N * N; i++) {
            const h0 = dec(src[i * 4]);
            hb[i] = h0;
            if (Math.abs(h0) > mh) mh = Math.abs(h0);
            const f = Math.min(1, dec(src[i * 4 + 2]) + dec(src[i * 4 + 3]));
            fs += f; if (f > 0.05) wet++; if (f > 0.95) sat++;
          }
        }
        // the waves the field carries: how steep, and over how much water
        const tx = box.size / N, a2 = tx * tx;
        let ms = 0, s10 = 0, s25 = 0;
        for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
          const k = j * N + i;
          const sx = hb[k + 1] - hb[k - 1], sz = hb[k + N] - hb[k - N];
          const s = Math.sqrt(sx * sx + sz * sz) / (2 * tx);
          if (s > ms) ms = s;
          if (s > 0.1) s10++;
          if (s > 0.25) s25++;
        }
        out.maxH = +mh.toFixed(4); out.foamSum = +fs.toFixed(2);
        out.foamM2 = +(wet * a2).toFixed(1);
        out.foamSaturatedM2 = +(sat * a2).toFixed(1);
        out.maxSlope = +ms.toFixed(3);
        out.slopeOver010M2 = +(s10 * a2).toFixed(1);
        out.slopeOver025M2 = +(s25 * a2).toFixed(1);
        out.glError = gl.getError();
      } catch (e) { out.readErr = String(e && e.message || e); }
      try { R.setRenderTarget(prev); } catch (_) {}
    }
    return out;
  };
})();
