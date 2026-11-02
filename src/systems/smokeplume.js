/* ============================================================
   systems/smokeplume.js — CBZ.smokePlumes: a fire's smoke as raymarched
   PLUMES, not point sprites.

   A wildfire's smoke was hundreds of soft round point sprites: from any
   distance a scatter of grey dots, and nothing like what a burning hillside
   puts up (2026-10-29, "flat is so dumb"). What it puts up is a few
   CONVECTION COLUMNS: each fire front's heat lifts one plume that entrains
   air and widens as it climbs (~0.3 m of radius per metre), bends over
   downwind more the stronger the wind, lit on its sun side, dark in its own
   shadow, glowing orange at its foot over the flames, and diluting into the
   sky at its top. Vegetation smoke is tan-grey and pales as it thins; a
   house or a car burns black.

   So: the fire's sources (systems/wildfire.js buildSources: burning trees,
   grass blocks, houses, cars) are clustered every frame into at most
   PLUMES persistent slots that ease toward their clusters (a plume never
   pops), and one box-proxy volume marches all of them on the shared
   Perlin-Worley billow atlas (systems/volfx.js CBZ.volNoise), each slot's
   billow scale constant so its noise never stretches. One draw call.

   API
     const P = CBZ.smokePlumes.create(parent)
     P.update(dt, sources, wx, wz, windSpeed, mag)   sources: [{x,y,z?,w,kind}]
     P.dispose()
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const PLUMES = 8;

  const VS = [
    "varying vec3 vWorld;",
    "void main() {",
    "  vec4 w = modelMatrix * vec4(position, 1.0);",
    "  vWorld = w.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * w;",
    "  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);",
    "}",
  ].join("\n");
  const FS = [
    "uniform mat4 projectionMatrix;",
    "uniform sampler2D uAtlas; uniform float uHasAtlas;",
    "uniform vec4 uP[PLUMES];",   // base x, y, z (world), strength (0 = off)
    "uniform vec4 uQ[PLUMES];",   // tone (0 vegetation .. 1 black), base radius, height, glow
    "uniform vec3 uWind;",        // direction x, z, lean (m across per m up, at the top)
    "uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform float uTime; uniform float uSteps;",
    "uniform vec3 uSunDir; uniform float uDay;",
    "uniform vec3 uVegLit; uniform vec3 uVegShade; uniform vec3 uBlkLit; uniform vec3 uBlkShade; uniform vec3 uGlowCol;",
    "uniform vec4 uFog; uniform vec3 uFogCol;",
    "varying vec3 vWorld;",
    "float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }",
    "float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),",
    "             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }",
    "vec4 noiseA(vec3 p) {",
    "  if (uHasAtlas > 0.5) {",
    "    p = fract(p);",
    "    float zf = p.z * 64.0; float z0 = floor(zf); float fz = zf - z0; float z1 = mod(z0 + 1.0, 64.0);",
    "    vec2 inner = p.xy * 64.0 + 1.5;",
    "    vec2 t0 = vec2(mod(z0, 8.0), floor(z0 / 8.0)) * 66.0;",
    "    vec2 t1 = vec2(mod(z1, 8.0), floor(z1 / 8.0)) * 66.0;",
    "    return mix(texture2D(uAtlas, (t0 + inner) / 528.0), texture2D(uAtlas, (t1 + inner) / 528.0), fz);",
    "  }",
    "  vec3 x = p * 4.0;",
    "  return vec4(vn3(x) * 0.65 + vn3(x * 2.1 + 3.1) * 0.35, vn3(x * 1.7 + 7.3), vn3(x * 4.3 + 1.7), 1.0);",
    "}",
    // the field: the strongest plume's envelope at q, and which plume owns it
    "float gTone; float gH; float gSc; float gGlow; float gStr;",
    "float field(vec3 q) {",
    "  float best = -9.0;",
    "  for (int i = 0; i < PLUMES; i++) {",
    "    vec4 P = uP[i];",
    "    if (P.w <= 0.001) continue;",
    "    vec4 Q = uQ[i];",
    "    float h = q.y - P.y, H = Q.z;",
    "    if (h < -3.0 || h > H * 1.45) continue;",
    "    float hp = max(h, 0.0);",
    // the column bends over downwind, more and more as it loses its own lift
    "    vec2 c = P.xz + uWind.xy * uWind.z * hp * (0.35 + 0.65 * min(hp / H, 1.2));",
    "    float r = Q.y + 0.3 * hp;",
    "    float e = 1.0 - length(q.xz - c) / r;",
    "    e -= smoothstep(H * 0.65, H * 1.35, h) * 1.4;",       // it dilutes into the sky
    "    e = min(e, (h + 2.0) / 2.5);",                          // rooted on the fire
    "    e -= (1.0 - min(P.w, 1.0)) * 0.6;",                    // a weak fire, a thin plume
    "    if (e > best) { best = e; gTone = Q.x; gH = h / H; gSc = Q.y * 1.4 + 4.0; gGlow = Q.w; gStr = P.w; }",
    "  }",
    "  return best;",
    "}",
    "void main() {",
    "  vec3 ro = cameraPosition;",
    "  vec3 rd = normalize(vWorld - ro);",
    "  vec3 inv = 1.0 / (sign(rd) * max(abs(rd), vec3(1e-5)) + vec3(step(abs(rd), vec3(0.0))) * 1e-5);",
    "  vec3 ta = (uBoxMin - ro) * inv, tb = (uBoxMax - ro) * inv;",
    "  vec3 tmn = min(ta, tb), tmx = max(ta, tb);",
    "  float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);",
    "  float t1 = min(min(tmx.x, tmx.y), tmx.z);",
    "  if (!(t1 > t0)) discard;",
    "  float baseL = max((t1 - t0) / max(uSteps, 8.0), 0.5);",
    "  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));",
    "  vec3 acc = vec3(0.0); float T = 1.0; float tW = 0.0; float wSum = 0.0;",
    "  float t = t0 + baseL * jit;",
    "  for (int i = 0; i < SP_MAXI; i++) {",
    "    if (t > t1 || T < 0.03) break;",
    "    vec3 q = ro + rd * t;",
    "    float e = field(q);",
    "    float sc = gSc;",
    "    float stepL = clamp(sc * 0.28, baseL * 0.3, baseL * 1.6);",
    "    if (e < -0.6) { t += stepL + (-e - 0.6) * sc * 0.5; continue; }",
    "    float tone = gTone, hrel = gH, glow = gGlow, str = gStr;",
    // the billows ride up the column and off downwind; a constant scale per
    // plume, so the clock never stretches the noise
    "    vec3 c = (q - vec3(uWind.x * uTime * 2.5, uTime * 2.2, uWind.y * uTime * 2.5)) / sc * 0.42;",
    "    vec4 A1 = noiseA(c);",
    "    float base = e + (A1.r - 0.5) * 1.05 + (A1.g - 0.5) * 0.3;",
    "    float d = 0.0;",
    "    if (base > -0.08) {",
    "      vec4 A2 = noiseA(c * 3.07 + vec3(0.37, 0.11 - uTime * 0.02, 0.73));",
    "      float b2 = base + ((A2.r - 0.5) * 0.3 + (A2.g - 0.5) * 0.18) * (1.0 - smoothstep(0.15, 0.7, base));",
    "      d = smoothstep(-0.02, 0.15, b2) * (0.55 + 0.45 * smoothstep(0.08, 0.6, b2));",
    // vegetation smoke thins as it climbs; black smoke stays thick
    "      d *= mix(mix(1.0, 0.3, clamp(hrel, 0.0, 1.0)), mix(1.0, 0.65, clamp(hrel, 0.0, 1.0)), tone) * min(str, 1.0);",
    "    }",
    "    if (d > 0.003) {",
    "      float a = 1.0 - exp(-d * mix(2.2, 4.0, tone) * stepL / sc);",
    "      float o1 = field(q + uSunDir * sc * 0.6);",
    "      float o2 = field(q + uSunDir * sc * 1.7);",
    "      float od = max(o1 + 0.35, 0.0) + max(o2 + 0.35, 0.0) * 1.3 + d * 0.45;",
    "      float Ts = exp(-od * 2.0);",
    "      float ms = 0.22 * exp(-od * 0.5);",
    "      float powder = 1.0 - exp(-d * 3.0);",
    "      vec3 lit = mix(uVegLit, uBlkLit, tone), sh = mix(uVegShade, uBlkShade, tone);",
    "      vec3 col = mix(sh, lit, clamp((Ts * (0.6 + 0.4 * powder) + ms) * uDay, 0.0, 1.0));",
    // the flames light the foot of the column from inside
    // (a house's or a tower's flames are drawn at its windows: its black
    // smoke takes only a little of their light)
    "      col += uGlowCol * glow * (1.0 - 0.75 * tone) * exp(-max(hrel, 0.0) * 15.0) * (0.35 + 0.65 * (1.0 - Ts));",
    "      float wgt = T * a;",
    "      acc += wgt * col; tW += wgt * t; wSum += wgt;",
    "      T *= 1.0 - a;",
    "    }",
    "    t += stepL;",
    "  }",
    "  float alpha = 1.0 - T;",
    "  if (!(alpha > 0.004)) discard;",
    "  float tHit = wSum > 1e-4 ? tW / wSum : t0;",
    "  vec3 cOut = max(acc / alpha, vec3(0.0));",
    "  if (uFog.x > 0.5) cOut = mix(cOut, uFogCol, smoothstep(uFog.y, uFog.z, tHit));",
    "#ifdef HAS_FRAG_DEPTH",
    "  vec4 clip = projectionMatrix * viewMatrix * vec4(ro + rd * tHit, 1.0);",
    "  gl_FragDepthEXT = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);",
    "#endif",
    "  gl_FragColor = vec4(cOut, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  gl_FragColor = vec4(clamp(gl_FragColor.rgb, 0.0, 1.0) * alpha, alpha);",
    "}",
  ].join("\n");

  function lin(r, g, b) { return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(); }
  function q01() { return CBZ.qScale ? CBZ.qScale(0, 1) : 1; }
  let _box = null;

  function create(parent) {
    const R = CBZ.renderer;
    const fragDepth = !!(R && R.capabilities && (R.capabilities.isWebGL2 ||
      (R.extensions && R.extensions.has && R.extensions.has("EXT_frag_depth"))));
    const vec4s = function () { const a = []; for (let i = 0; i < PLUMES; i++) a.push(new THREE.Vector4()); return a; };
    const U = {
      uAtlas: { value: null }, uHasAtlas: { value: 0 },
      uP: { value: vec4s() }, uQ: { value: vec4s() },
      uWind: { value: new THREE.Vector3(1, 0, 0.5) },
      uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uSteps: { value: Math.round(18 + 14 * q01()) },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) }, uDay: { value: 1 },
      uVegLit: { value: lin(206, 198, 184) }, uVegShade: { value: lin(96, 90, 84) },
      uBlkLit: { value: lin(74, 70, 66) }, uBlkShade: { value: lin(22, 21, 20) },
      uGlowCol: { value: lin(255, 120, 36) },
      uFog: { value: new THREE.Vector4() }, uFogCol: { value: new THREE.Color() },
    };
    const VN = CBZ.volNoise;
    if (VN) {
      if (VN.done && VN.tex) { U.uAtlas.value = VN.tex; U.uHasAtlas.value = 1; }
      else {
        if (VN.onReady) VN.onReady(function (tex) { U.uAtlas.value = tex; U.uHasAtlas.value = 1; });
        if (VN.arm) { try { VN.arm(); } catch (e) {} }
      }
    }
    const defs = { PLUMES: PLUMES, SP_MAXI: Math.round(36 + 28 * q01()) };
    if (fragDepth) defs.HAS_FRAG_DEPTH = 1;
    const mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VS, fragmentShader: FS, defines: defs,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    mat.extensions = { fragDepth: fragDepth };
    const mesh = new THREE.Mesh(_box || (_box = new THREE.BoxGeometry(1, 1, 1)), mat);
    mesh.name = "smokePlumes"; mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.visible = false;
    mesh.userData.noHit = true; mesh.userData.transient = true;
    mesh.raycast = function () {};
    if (parent) parent.add(mesh);

    // persistent slots: each eases toward the cluster it was matched to
    const slots = [];
    for (let i = 0; i < PLUMES; i++) slots.push({ x: 0, y: 0, z: 0, s: 0, ts: 0, tone: 0, tt: 0, tx: 0, ty: 0, tz: 0, used: false, H: 20, r: 3 });
    const CELL = 26;
    const cl = [];
    let time = 0;
    const _sun = new THREE.Vector3();

    function cluster(sources) {
      cl.length = 0;
      const map = {};
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const w = s.w > 0 ? s.w : 0;
        if (w <= 0.01) continue;
        const key = Math.floor(s.x / CELL) + "," + Math.floor(s.z / CELL);
        let c = map[key];
        if (!c) { c = map[key] = { w: 0, x: 0, y: 0, z: 0, blk: 0 }; cl.push(c); }
        const black = s.kind === 2 || s.kind === 3;
        // a house or a car throws far more smoke than its flames suggest
        const ww = black ? w * 1.8 : w;
        c.w += ww; c.x += s.x * ww; c.z += s.z * ww; c.y += (s.y != null ? s.y - 1.5 : 0) * ww;
        if (black) c.blk += ww;
      }
      for (let i = 0; i < cl.length; i++) { const c = cl[i]; c.x /= c.w; c.y /= c.w; c.z /= c.w; c.blk /= c.w; }
      cl.sort(function (a, b) { return b.w - a.w; });
      if (cl.length > PLUMES) cl.length = PLUMES;
    }

    const P = {
      mesh: mesh,
      update(dt, sources, wx, wz, wspd, mag) {
        if (!(dt > 0)) return;
        if (dt > 0.1) dt = 0.1;
        time += dt;
        cluster(sources || []);
        for (let i = 0; i < PLUMES; i++) slots[i].used = false;
        // match each cluster (strongest first) to the nearest slot near it,
        // else to a free slot, else to the weakest if this one is stronger
        for (let k = 0; k < cl.length; k++) {
          const c = cl[k];
          let best = -1, bd = CELL * 1.6;
          for (let i = 0; i < PLUMES; i++) {
            const s = slots[i]; if (s.used || s.s <= 0.01) continue;
            const d = Math.hypot(s.x - c.x, s.z - c.z);
            if (d < bd) { bd = d; best = i; }
          }
          if (best < 0) {
            let weak = -1, ws = 1e9;
            for (let i = 0; i < PLUMES; i++) { const s = slots[i]; if (s.used) continue; if (s.s < ws) { ws = s.s; weak = i; } }
            if (weak >= 0 && (slots[weak].s <= 0.01 || slots[weak].s < c.w * 0.5)) {
              best = weak;
              const s = slots[best];
              if (s.s <= 0.01) { s.x = c.x; s.y = c.y; s.z = c.z; }
            }
          }
          if (best < 0) continue;
          const s = slots[best];
          s.used = true; s.tx = c.x; s.ty = c.y; s.tz = c.z;
          s.ts = Math.min(3, c.w * 0.55); s.tt = c.blk;
        }
        const ux = wspd > 0 ? wx : 1, uz = wspd > 0 ? wz : 0;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, any = false;
        const lean = Math.min(2.2, (wspd || 0) / ((wspd || 0) + 4) * 1.6);
        const mg = mag != null ? +mag : 0.5;
        const sh = CBZ.sunHeight != null ? CBZ.sunHeight : 0.5;
        const day = Math.max(0.08, Math.min(1, 0.5 + 2.2 * sh)), night = 1 - day;
        for (let i = 0; i < PLUMES; i++) {
          const s = slots[i];
          if (!s.used) s.ts = 0;
          // a plume builds over a few seconds and dies more slowly than its fire
          const rate = s.ts > s.s ? 0.7 : 0.25;
          s.s += (s.ts - s.s) * Math.min(1, rate * dt);
          if (s.s < 0.01 && s.ts <= 0) s.s = 0;
          const k = Math.min(1, 1.6 * dt);
          s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; s.z += (s.tz - s.z) * k;
          s.tone += (s.tt - s.tone) * Math.min(1, 0.8 * dt);
          const st = Math.sqrt(Math.max(s.s, 0));
          s.H = (14 + 26 * st) * (0.7 + 0.6 * mg);
          s.r = 1.4 + 2.6 * st;
          U.uP.value[i].set(s.x, s.y, s.z, s.s);
          // firelight on the foot of the column: a warm tint by day, a glow by night
          U.uQ.value[i].set(s.tone, s.r, s.H, Math.min(1, s.ts) * (0.28 + 0.6 * night));
          if (s.s <= 0.001) continue;
          any = true;
          const H = s.H * 1.45, rT = s.r + 0.3 * H + 2;
          const lx = ux * lean * H, lz = uz * lean * H;
          x0 = Math.min(x0, s.x - rT, s.x + lx - rT); x1 = Math.max(x1, s.x + rT, s.x + lx + rT);
          z0 = Math.min(z0, s.z - rT, s.z + lz - rT); z1 = Math.max(z1, s.z + rT, s.z + lz + rT);
          y0 = Math.min(y0, s.y - 3); y1 = Math.max(y1, s.y + H + 2);
        }
        mesh.visible = any;
        if (!any) return;
        U.uWind.value.set(ux, uz, lean);
        U.uTime.value = time;
        const sun = CBZ.sun;
        if (sun && sun.position) {
          _sun.copy(sun.position);
          if (sun.target && sun.target.position) _sun.sub(sun.target.position);
          if (_sun.lengthSq() > 1e-6) U.uSunDir.value.copy(_sun.normalize());
        }
        U.uDay.value = day;
        const f = CBZ.scene && CBZ.scene.fog;
        if (f && f.isFog) { U.uFog.value.set(1, f.near, f.far, 0); U.uFogCol.value.copy(f.color); } else U.uFog.value.x = 0;
        // the box: every live plume, its lean and its crown, in world space
        // (the parent may be offset: the shader marches world coordinates)
        let px = 0, py = 0, pz = 0;
        if (mesh.parent && mesh.parent.matrixWorld) { const e = mesh.parent.matrixWorld.elements; px = e[12]; py = e[13]; pz = e[14]; }
        mesh.position.set((x0 + x1) / 2 - px, (y0 + y1) / 2 - py, (z0 + z1) / 2 - pz);
        mesh.scale.set(Math.max(0.1, x1 - x0), Math.max(0.1, y1 - y0), Math.max(0.1, z1 - z0));
        U.uBoxMin.value.set(x0, y0, z0); U.uBoxMax.value.set(x1, y1, z1);
      },
      get live() { let n = 0; for (let i = 0; i < PLUMES; i++) if (slots[i].s > 0.001) n++; return n; },
      dispose() { if (mesh.parent) mesh.parent.remove(mesh); mat.dispose(); },
    };
    return P;
  }

  CBZ.smokePlumes = { create: create, PLUMES: PLUMES };
})();
