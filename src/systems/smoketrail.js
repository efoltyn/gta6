/* ============================================================
   systems/smoketrail.js — CBZ.smokeTrail: the smoke a moving thing leaves,
   drawn as shaded TUBES.

   A rocket's trail (weapons/munitions.js) and a volcanic bomb's
   (world/volcanofx.js) were rows of camera-facing puff sprites laid by
   distance: from far away a string of beads, from close a hard bar of
   overlapping discs (2026-10-29, "flat is so dumb"). A trail is a tube of
   smoke: continuous, widening and thinning as it ages, lit on the side
   toward the sun and dark on the far side, drifting on the wind, meandering
   and tearing at its edges as it decays into turbulence.

   Each trail is its last NP positions. The strip faces the camera in the
   vertex shader; the fragment shader shades it as the round tube it stands
   for (a normal that runs from the rim across to the eye on the axis) and
   tears it with value noise along its length. One draw per pool, however
   many trails are live.

   API
     const P = CBZ.smokeTrail.pool(parent, nTrails, nPts)
     const h = P.open({ w0, w1, life, a0, col, rise, wind, drag })
                         half-widths at birth and at the end of a point's life
                         (m), its life (s), opacity, linear colour (THREE.Color),
                         rise (m/s), wind share 0..1, drag on the launch velocity
     P.push(h, x, y, z, vx, vy, vz)   lay a point at the newest end
     P.head(h, x, y, z)               move the newest end (the nozzle) along
     P.close(h)                       the source is gone: the trail ages out
     P.alive(h)                       still this source's trail (not recycled)
     P.update(dt)                     age, drift, rebuild (once a frame)
     CBZ.smokeTrail.shared()          the scene-wide pool (rocket trails),
                                      ticked on CBZ.onAlways
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const VS = [
    "attribute vec3 aDir; attribute float aSide; attribute float aW; attribute float aA; attribute float aU; attribute float aK; attribute vec3 aCol;",
    "uniform float uTime;",
    "varying vec3 vS; varying vec3 vV; varying float vA; varying float vU; varying float vX; varying float vK; varying float vW; varying vec3 vCol;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vec3 V = normalize(cameraPosition - wp.xyz);",
    "  vec3 D = normalize(mat3(modelMatrix) * aDir + vec3(1e-5, 2e-5, 0.0));",
    "  vec3 S = cross(D, V); float sl = length(S);",
    "  S = sl > 1e-4 ? S / sl : vec3(0.0, 1.0, 0.0);",
    "  vec3 B = normalize(cross(S, D) + vec3(0.0, 1e-5, 0.0));",
    // an old trail meanders: the whole tube wanders off its line as it decays
    "  vec3 mw = (S * sin(aU * 0.09 + uTime * 0.6) + B * cos(aU * 0.067 - uTime * 0.45)) * aW * 0.55 * aK;",
    "  wp.xyz += S * aSide * aW + mw;",
    "  vS = S; vV = V; vA = aA; vU = aU; vX = aSide; vK = aK; vW = max(aW, 0.05); vCol = aCol;",
    "  vec4 mvPosition = viewMatrix * wp;",
    "  gl_Position = projectionMatrix * mvPosition;",
    "#include <fog_vertex>",
    "}",
  ].join("\n");
  const FS = [
    "uniform vec3 uSunDir; uniform float uTime; uniform float uDay;",
    "varying vec3 vS; varying vec3 vV; varying float vA; varying float vU; varying float vX; varying float vK; varying float vW; varying vec3 vCol;",
    "#include <fog_pars_fragment>",
    "float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "void main() {",
    "  float x = clamp(vX, -1.0, 1.0);",
    // along the tube in units of its own width, so a pencil-thin trail and a
    // booster's column both come out as a rope of billows, not noise soup
    "  float L = vU / max(vW * 1.5, 0.25);",
    "  float n1 = vn(vec2(L * 0.85 - uTime * 0.3, vK * 2.0));",
    "  float n2 = vn(vec2(L * 2.2 + 3.1, x * 2.0 + uTime * 0.5));",
    // the silhouette bulges and pinches along the length: lumps, not a ruler edge
    "  float rad = 0.6 + 0.4 * n1 + 0.12 * (n2 - 0.5);",
    "  float xr = x / rad;",
    "  if (abs(xr) >= 1.0) discard;",
    "  float c = sqrt(1.0 - xr * xr);",
    // the lump's own normal: across at its rim, toward the eye on its axis
    "  vec3 n = normalize(normalize(vS) * xr + normalize(vV) * c);",
    "  float lam = clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);",
    "  float tor = n2 * 0.6 + vn(vec2(L * 5.3, x * 5.0 - uTime * 0.8)) * 0.4;",
    // young smoke is a dense rope; old smoke is torn into rags
    "  float a = vA * smoothstep(0.0, 0.3, c) * smoothstep(0.08 + 0.35 * vK, 0.46 + 0.25 * vK, tor + c * 0.5);",
    "  if (a < 0.004) discard;",
    "  vec3 col = vCol * mix(0.42, 1.2, lam * uDay + 0.3 * (1.0 - uDay)) * (0.8 + 0.32 * n2);",
    "  gl_FragColor = vec4(col, a);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
    "}",
  ].join("\n");

  const _sun = new THREE.Vector3(0.5, 0.7, 0.3);
  function sunDir() {
    const s = CBZ.sun;
    if (s && s.position) {
      let dx = s.position.x, dy = s.position.y, dz = s.position.z;
      const tg = s.target;
      if (tg && tg.position) { dx -= tg.position.x; dy -= tg.position.y; dz -= tg.position.z; }
      const L = Math.hypot(dx, dy, dz);
      if (L > 1e-4) _sun.set(dx / L, dy / L, dz / L);
    }
    return _sun;
  }
  function dayNow() {
    const h = CBZ.sunHeight != null ? CBZ.sunHeight : 0.5;
    return Math.max(0, Math.min(1, 0.5 + 2.2 * h));
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pool(parent, NT, NP) {
    NT = Math.max(1, NT | 0); NP = Math.max(3, NP | 0);
    const NV = NT * NP * 2;
    const pos = new Float32Array(NV * 3), dir = new Float32Array(NV * 3), side = new Float32Array(NV);
    const wid = new Float32Array(NV), alp = new Float32Array(NV), uu = new Float32Array(NV), kk = new Float32Array(NV);
    const colA = new Float32Array(NV * 3);
    for (let i = 0; i < NV; i++) side[i] = (i & 1) ? 1 : -1;
    const idx = [];
    for (let t = 0; t < NT; t++) for (let k = 0; k < NP - 1; k++) {
      const a = (t * NP + k) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    const dyn = function (name, arr, n) { const b = new THREE.BufferAttribute(arr, n); b.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, b); return b; };
    const aPos = dyn("position", pos, 3), aDir = dyn("aDir", dir, 3), aW = dyn("aW", wid, 1), aA = dyn("aA", alp, 1);
    const aU = dyn("aU", uu, 1), aK = dyn("aK", kk, 1), aC = dyn("aCol", colA, 3);
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) }, uTime: { value: 0 }, uDay: { value: 1 },
      }]),
      vertexShader: VS, fragmentShader: FS, fog: true,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = "smokeTrails";
    mesh.visible = false;
    mesh.userData.noHit = true; mesh.userData.transient = true;
    mesh.raycast = function () {};
    if (parent) parent.add(mesh);
    const tr = [];
    for (let t = 0; t < NT; t++) {
      const pts = [];
      for (let k = 0; k < NP; k++) pts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1e9, u: 0 });
      tr.push({ pts: pts, head: 0, n: 0, live: false, closed: true, gen: 0, born: 0, last: 0, u: 0,
        w0: 0.3, w1: 2, life: 2, a0: 0.5, r: 0.5, g: 0.5, b: 0.5, rise: 0.25, wind: 1, drag: 1.2 });
    }
    let time = 0, live = 0;
    const WIND_X = 0.9, WIND_Z = 0.45;
    const P = {
      mesh: mesh, NT: NT, NP: NP,
      open(o) {
        o = o || {};
        // a free trail, else the oldest closed one, else the oldest of all
        let T = null;
        for (let t = 0; t < NT; t++) if (!tr[t].live) { T = tr[t]; break; }
        if (!T) for (let t = 0; t < NT; t++) { const c = tr[t]; if (c.closed && (!T || c.born < T.born)) T = c; }
        if (!T) for (let t = 0; t < NT; t++) { const c = tr[t]; if (!T || c.born < T.born) T = c; }
        T.gen++; T.live = true; T.closed = false; T.n = 0; T.head = 0; T.u = 0; T.born = T.last = time;
        T.w0 = o.w0 != null ? +o.w0 : 0.3; T.w1 = o.w1 != null ? +o.w1 : 2;
        T.life = o.life > 0 ? +o.life : 2; T.a0 = o.a0 != null ? +o.a0 : 0.5;
        const c = o.col || { r: 0.6, g: 0.6, b: 0.6 };
        T.r = c.r; T.g = c.g; T.b = c.b;
        T.rise = o.rise != null ? +o.rise : 0.25; T.wind = o.wind != null ? +o.wind : 1; T.drag = o.drag != null ? +o.drag : 1.2;
        return { T: T, gen: T.gen };
      },
      alive(h) { return !!(h && h.T && h.T.gen === h.gen); },
      push(h, x, y, z, vx, vy, vz) {
        if (!P.alive(h)) return;
        const T = h.T;
        T.last = time;
        if (T.n > 0) {
          const p = T.pts[(T.head + NP - 1) % NP];
          T.u += Math.hypot(x - p.x, y - p.y, z - p.z);
        }
        const q = T.pts[T.head];
        q.x = x; q.y = y; q.z = z; q.age = 0; q.u = T.u;
        q.vx = vx || 0; q.vy = vy || 0; q.vz = vz || 0;
        T.head = (T.head + 1) % NP;
        T.n = Math.min(NP, T.n + 1);
      },
      head(h, x, y, z) {
        if (!P.alive(h) || h.T.n === 0) return;
        const T = h.T, q = T.pts[(T.head + NP - 1) % NP];
        T.last = time;
        if (T.n > 1) { const p = T.pts[(T.head + NP - 2) % NP]; q.u = p.u + Math.hypot(x - p.x, y - p.y, z - p.z); T.u = q.u; }
        q.x = x; q.y = y; q.z = z;
      },
      // metres since the newest laid point (for laying by distance)
      since(h, x, y, z) {
        if (!P.alive(h) || h.T.n === 0) return Infinity;
        const T = h.T, q = T.pts[(T.head + NP - 1) % NP];
        return Math.hypot(x - q.x, y - q.y, z - q.z);
      },
      close(h) { if (P.alive(h)) h.T.closed = true; },
      update(dt) {
        if (!(dt > 0)) return;
        if (dt > 0.1) dt = 0.1;
        time += dt;
        const U = mat.uniforms;
        U.uTime.value = time;
        U.uSunDir.value.copy(sunDir());
        U.uDay.value = dayNow();
        live = 0;
        for (let t = 0; t < NT; t++) {
          const T = tr[t];
          const kmin = NP - T.n;
          let alive = false;
          for (let k = 0; k < NP; k++) {
            // oldest first, in ring order from the head
            const p = T.pts[(T.head + k) % NP];
            const o = (t * NP + k) * 2;
            const valid = T.live && k >= kmin && p.age < T.life;
            if (T.live && k >= kmin) {
              p.age += dt;
              // the launch velocity dies on drag; the wind and the heat take over
              const dg = Math.exp(-T.drag * dt);
              p.vx *= dg; p.vy *= dg; p.vz *= dg;
              const wk = T.wind * Math.min(1, p.age * 3);
              p.x += (p.vx + WIND_X * wk) * dt; p.y += (p.vy + T.rise) * dt; p.z += (p.vz + WIND_Z * wk) * dt;
            }
            const u = valid ? clamp(p.age / T.life, 0, 1) : 1;
            if (valid) alive = true;
            const pn = T.pts[(T.head + Math.min(k + 1, NP - 1)) % NP], pp = T.pts[(T.head + Math.max(k - 1, kmin)) % NP];
            let dx = pn.x - pp.x, dy = pn.y - pp.y, dz = pn.z - pp.z;
            if (dx * dx + dy * dy + dz * dz < 1e-8) { dx = 0; dy = 1; dz = 0; }
            // grows fast then slows, like an expanding wake
            const w = valid ? T.w0 + (T.w1 - T.w0) * (1 - (1 - u) * (1 - u)) : 0;
            // the newest points fade in, so the smoke forms behind the nozzle
            const a = valid ? T.a0 * Math.pow(1 - u, 1.5) * clamp((k - kmin) / 2, 0.15, 1) * clamp(p.age / 0.08, 0.25, 1) : 0;
            for (let e = 0; e < 2; e++) {
              const v = o + e;
              pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
              dir[v * 3] = dx; dir[v * 3 + 1] = dy; dir[v * 3 + 2] = dz;
              wid[v] = w; alp[v] = a; uu[v] = p.u; kk[v] = u;
              colA[v * 3] = T.r; colA[v * 3 + 1] = T.g; colA[v * 3 + 2] = T.b;
            }
          }
          // aged out, and its source closed it or stopped feeding it: free
          if (!alive && T.live && T.n > 0 && (T.closed || time - T.last > 0.5)) T.live = false;
          if (alive) { live++; }
        }
        aPos.needsUpdate = aDir.needsUpdate = aW.needsUpdate = aA.needsUpdate = aU.needsUpdate = aK.needsUpdate = aC.needsUpdate = true;
        mesh.visible = live > 0;
      },
      get live() { return live; },
      dispose() { if (mesh.parent) mesh.parent.remove(mesh); g.dispose(); mat.dispose(); },
    };
    return P;
  }

  // the scene-wide pool rocket trails are laid in, ticked once a frame
  let SH = null;
  function shared() {
    if (!SH) {
      SH = pool(null, 48, 36);
      if (CBZ.onAlways) CBZ.onAlways(52.4, function (dt) { SH.update(dt); });
    }
    const sc = CBZ.scene;
    if (sc && SH.mesh.parent !== sc) sc.add(SH.mesh);
    return SH;
  }

  CBZ.smokeTrail = { pool: pool, shared: shared };
})();
