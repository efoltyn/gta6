/* world/tsunami_scene.js — WHAT THE SEA SHOWS WHEN IT LEAVES, AND WHAT IT LEAVES BEHIND.

   The survival tsunami (systems/disasters.js) moves ONE number, the sea's
   surge, and that was the whole picture: the drawdown exposed "more beach",
   and when the flood went home the island looked exactly as it had before it
   came. Every piece of reference footage (Tohoku 2011, Indian Ocean 2004)
   says the opposite on both ends:

   1. THE DRAWDOWN. The bared shelf is not beach. It is dark, wet, glistening
      mud and sand with the reef showing through it, weed lying flat where the
      water dropped it, tide pools holding the sky, fish flapping on the mud,
      and boats that were floating a minute ago lying on their sides.
   2. THE AFTERMATH. Everywhere the water went it left a film of grey-brown
      silt, dark and shining while wet and paling as it dries, standing
      puddles, streaks combed seaward by the drain, a sharp wrack line where
      it stopped, and a high-water stain on every wall it stood against.

   This file is that dressing and nothing else. It never moves the water, it
   only ASKS the water (CBZ.survSeaMeanY / survFloodDepthMeanAt / the
   published event) — the tsunami's own director stays the single source of
   truth. Everything is built lazily on the first flood event of a session.

   DRAW CALLS (all six, only while they have anything to show):
     band   the exposed-seabed skin (wet sheen, ripples, weed, pools)   1
     reef   rock + coral outcrops on the band (instanced)               1
     fish   stranded fish, flopping in the vertex shader (instanced)    1
     boats  four lofted dinghies lying on their bilges (merged)         1
     mud    the silt drape over the island (64x64 DataTexture)          1
     stain  high-water marks on standing buildings (instanced)          1
   CPU: uniforms per frame; water queries / texture writes at 5 Hz, and
   only while an event or the drying is in progress. */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const DRAW_MAX = 7.6;     // m: the deepest drawdown disasters.js can roll (6.7 * 1.13)
  const DRY_SECS = 120;     // s for a flooded surface to go from soaked to dry silt
  const MUD_N = 64;         // wetness/mud cells per side over the island
  const MUD_LIFT = 0.13;    // m the silt drape rides above the ground
  const BAND_LIFT = 0.08;   // m the seabed skin rides above the bed
  const SLOW = 0.2;         // s between the 5 Hz passes

  // ---- tiny deterministic rng -------------------------------------------------
  function rngOf(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ---- shared shader bits -----------------------------------------------------
  const NOISE = [
    "float tsH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
    "float tsN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(tsH(i), tsH(i + vec2(1.0, 0.0)), f.x), mix(tsH(i + vec2(0.0, 1.0)), tsH(i + vec2(1.0, 1.0)), f.x), f.y); }",
  ].join("\n");
  // sky + sun shared by every glossy surface here (refreshed at 5 Hz)
  const U = {
    uTime: { value: 0 },
    uSky: { value: new THREE.Color(0.62, 0.7, 0.78) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  };
  // the wet-surface sheen: sky by fresnel + a tight sun glint, scaled by gloss
  const SHEEN = [
    "vec3 tsSheen(vec3 col, vec3 wp, vec3 n, float gloss, float mirror) {",
    "  vec3 V = normalize(cameraPosition - wp);",
    "  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);",
    "  vec3 Rv = reflect(-V, n);",
    "  float sp = pow(max(dot(Rv, uSunDir), 0.0), mix(70.0, 500.0, mirror));",
    // capped: at the grazing angles a standing eye sees the bared shelf from,
    // an uncapped fresnel turned the whole wet band into a white sky mirror
    // (read as snow); wet mud keeps its own dark colour under the sheen
    "  col = mix(col, uSky * mix(0.55, 0.8, mirror), clamp(fr * gloss * mix(0.28, 0.7, mirror), 0.0, 0.7));",
    "  return col + uSunCol * sp * gloss * mix(1.2, 3.5, mirror);",
    "}",
  ].join("\n");

  // ---- state ------------------------------------------------------------------
  let A = null;              // the arena this scene is built for
  let S = null;              // built parts
  let clock = 0, slowAcc = 0;
  const tsu = { active: false, phase: "", t: 0, cx: 0, cz: 0, dx: 1, dz: 0, frontS: -1e9, ahead: 0 };
  const flood = { active: false };
  let drying = false;        // mud / stain still drying after the water left
  let events = 0;            // how many flood events this arena has seen (audit)

  function live() {
    return !!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.surv && CBZ.surv.arena);
  }
  function gh(x, z) { return A.groundHeightAt(x, z); }
  function meanY() { return CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : (A.oceanY != null ? A.oceanY : -0.8); }
  function depthAt(x, z) {
    if (CBZ.survFloodDepthMeanAt) return CBZ.survFloodDepthMeanAt(x, z);
    return meanY() - gh(x, z);
  }

  /* =============================================================================
     1. THE EXPOSED SEABED
     ============================================================================= */
  function buildBand() {
    const cx = A.center.x, cz = A.center.z, R = A.radius;
    const oy = A.oceanY != null ? A.oceanY : -0.8;
    const SECT = 192, RINGS = 24, NR = RINGS + 1;
    const r0 = new Float32Array(SECT), r1 = new Float32Array(SECT);
    for (let s = 0; s < SECT; s++) {
      const a = (s / SECT) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      let f0 = -1, f1 = -1;
      for (let r = R * 0.9; r < R + 110; r += 0.25) {
        const g = gh(cx + c * r, cz + sn * r);
        if (f0 < 0 && g < oy + 0.35) f0 = r;
        if (f0 >= 0 && g < oy - DRAW_MAX - 0.9) { f1 = r; break; }
      }
      if (f0 < 0) f0 = R + 10;
      if (f1 < 0) f1 = f0 + 32;
      r0[s] = f0 - 1.5; r1[s] = f1;
    }
    const nv = (SECT + 1) * NR;
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const bandR = new Float32Array(SECT * NR), bandG = new Float32Array(SECT * NR);
    let v = 0;
    for (let s = 0; s <= SECT; s++) {
      const ss = s % SECT;
      const a = (s / SECT) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (let k = 0; k < NR; k++) {
        const t = k / RINGS;
        const r = r0[ss] + (r1[ss] - r0[ss]) * t;
        const x = cx + c * r, z = cz + sn * r, g = gh(x, z);
        pos[v * 3] = x; pos[v * 3 + 1] = g + BAND_LIFT; pos[v * 3 + 2] = z;
        uv[v * 2] = t; uv[v * 2 + 1] = s / SECT;
        if (s < SECT) { bandR[ss * NR + k] = r; bandG[ss * NR + k] = g; }
        v++;
      }
    }
    const idx = [];
    for (let s = 0; s < SECT; s++) {
      for (let k = 0; k < RINGS; k++) {
        const a0 = s * NR + k, b0 = a0 + 1, d0 = a0 + NR, e0 = d0 + 1;
        idx.push(a0, d0, b0, b0, d0, e0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const nrm = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) nrm[i * 3 + 1] = 1;     // lit as flat ground; the sheen does the rest
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const BU = {
      uSea: { value: oy }, uFront: { value: new THREE.Vector4(cx, cz, 1, 0) },
      uFrontS: { value: -1e9 }, uAhead: { value: 0 }, uDry: { value: 0 }, uOn: { value: 0 },
      uCenter: { value: new THREE.Vector2(cx, cz) },
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4;
    mat.name = "tsunami-seabed-skin";
    mat.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, BU, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSbW;\nvarying float vSbT;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSbW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSbT = uv.x;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "varying vec3 vSbW; varying float vSbT;",
          "uniform float uSea; uniform vec4 uFront; uniform float uFrontS; uniform float uAhead;",
          "uniform float uDry; uniform float uOn; uniform vec2 uCenter; uniform float uTime;",
          "uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol;",
          NOISE, SHEEN,
          "float sbGloss; float sbPool; vec3 sbN;",
        ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{",
          "  vec2 p = vSbW.xz;",
          // the sea's local level, front-aware: the CPU twin is CBZ.waterFrontDropAt
          "  float fd = dot(p - uFront.xy, uFront.zw) - uFrontS;",
          "  float fk = clamp((fd + 1.0) / 8.0, 0.0, 1.0);",
          "  float seaL = uSea - uAhead * fk * fk * (3.0 - 2.0 * fk);",
          "  float above = (vSbW.y - " + BAND_LIFT.toFixed(3) + ") - seaL;",
          "  float vd = length(cameraPosition - vSbW);",
          "  float nearK = 1.0 - smoothstep(14.0, 55.0, vd);",
          "  float n1 = tsN(p * 0.21), n2 = tsN(p * 0.83 + 7.1), n3 = tsN(p * 3.3 + 2.7);",
          // sand where the swash worked it, black-brown mud in the lows
          "  vec3 sand = vec3(0.135, 0.112, 0.080);",
          "  vec3 mud = vec3(0.060, 0.052, 0.040);",
          "  float muddy = smoothstep(0.38, 0.72, n1 * 0.7 + n2 * 0.3);",
          "  vec3 col = mix(sand, mud, muddy);",
          // ripple marks running along the shore, warped so they are not rings
          "  float rr = length(p - uCenter);",
          "  float rip = sin(rr * 8.5 + n2 * 7.0 + n1 * 4.0);",
          "  col *= 1.0 + 0.16 * rip * nearK * (1.0 - muddy * 0.7);",
          // weed mats lying flat where the water dropped them
          "  float wm = tsN(p * 0.095 + 3.3) * 0.72 + n3 * 0.18 + n2 * 0.1;",
          "  float weed = smoothstep(0.60, 0.68, wm);",
          "  vec3 weedC = mix(vec3(0.030, 0.045, 0.018), vec3(0.075, 0.058, 0.022), n2);",
          "  weedC *= 0.8 + 0.4 * tsN(p * 6.0);",
          "  col = mix(col, weedC, weed * 0.92);",
          // tide pools in the lows (never on the weed)
          "  float pm = tsN(p * 0.062 + 11.0) * 0.68 + n2 * 0.22 + n3 * 0.10;",
          "  sbPool = smoothstep(0.64, 0.675, pm) * (1.0 - weed);",
          "  col = mix(col, vec3(0.028, 0.030, 0.030), sbPool);",
          // shell grit and pebbles, near the eye only
          "  float sp = step(0.94, tsH(floor(p * 5.0))) * nearK * (1.0 - sbPool);",
          "  col = mix(col, vec3(0.30, 0.28, 0.24), sp * 0.55);",
          // wet: darkest and shiniest right behind the retreating water
          "  float fresh = 1.0 - 0.45 * smoothstep(0.0, 3.5, above);",
          "  sbGloss = mix(0.55 + 0.25 * weed, 1.0, sbPool) * fresh * (1.0 - uDry * 0.75);",
          "  col *= mix(1.0, 0.78, sbGloss * (1.0 - sbPool));",
          "  sbN = normalize(vec3((n3 - 0.5) * 0.18 * (1.0 - sbPool) + rip * 0.04 * nearK, 1.0, (n2 - 0.5) * 0.18 * (1.0 - sbPool)));",
          "  diffuseColor.rgb = col;",
          // only where the sea has actually left; soft at the band's two rims
          "  float edge = smoothstep(0.0, 0.10, vSbT) * (1.0 - smoothstep(0.93, 1.0, vSbT));",
          "  diffuseColor.a = uOn * edge * smoothstep(-0.35, 0.02, above);",
          "  if (diffuseColor.a < 0.01) discard;",
          "}",
        ].join("\n"))
        .replace("#include <envmap_fragment>", "#include <envmap_fragment>\noutgoingLight = tsSheen(outgoingLight, vSbW, sbN, sbGloss, sbPool);");
    };
    mat.customProgramCacheKey = () => "tsunami-scene-band";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "tsunami-seabed-skin";
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.userData.terrain = true;
    mesh.visible = false;
    A.root.add(mesh);
    return { mesh, U: BU, SECT, NR, bandR, bandG, r0, r1 };
  }

  // Where on the band (along the ray at angle a) the bed sits at height g.
  function bandPoint(a, g) {
    const B = S.band, cx = A.center.x, cz = A.center.z;
    let aa = a % (Math.PI * 2); if (aa < 0) aa += Math.PI * 2;
    const s = Math.round((aa / (Math.PI * 2)) * B.SECT) % B.SECT;
    const o = s * B.NR;
    let r = B.bandR[o + B.NR - 1];
    for (let k = 0; k < B.NR - 1; k++) {
      const g0 = B.bandG[o + k], g1 = B.bandG[o + k + 1];
      if (g0 >= g && g1 <= g) { const f = g0 === g1 ? 0 : (g0 - g) / (g0 - g1); r = B.bandR[o + k] + (B.bandR[o + k + 1] - B.bandR[o + k]) * f; break; }
    }
    const x = cx + Math.cos(aa) * r, z = cz + Math.sin(aa) * r;
    return { x, z, y: gh(x, z), r };
  }

  // ---- reef: rock and coral outcrops, packed where the drawdown bares them -----
  function jitterGeo(detail, amp, seed) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const rnd = rngOf(seed);
    const table = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = Math.round(p.getX(i) * 1000) + "," + Math.round(p.getY(i) * 1000) + "," + Math.round(p.getZ(i) * 1000);
      let j = table.get(k);
      if (j == null) { j = 1 + (rnd() - 0.5) * 2 * amp; table.set(k, j); }
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
    }
    g.computeVertexNormals();                  // non-indexed: facets stay
    const col = new Float32Array(p.count * 3).fill(1);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }
  function buildReef() {
    const rnd = rngOf(90210);
    const oy = A.oceanY != null ? A.oceanY : -0.8;
    const N = Math.round(CBZ.qScale ? CBZ.qScale(110, 220) : 180);
    const geo = jitterGeo(1, 0.22, 77);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    mat.name = "tsunami-reef";
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const sc = new THREE.Vector3(), pv = new THREE.Vector3(), c = new THREE.Color();
    // linear albedo; the rig lifts these a long way (see disaster_arena's rock note)
    const kinds = [
      [0x1d1b18, 0.40],   // dark basalt
      [0x2a2620, 0.20],   // weathered rock
      [0x4a3f33, 0.14],   // dead coral, bleached-brown
      [0x3e2a26, 0.10],   // dead coral, pinkish
      [0x1f2a14, 0.16],   // rock under an encrusting weed coat
    ];
    let i = 0;
    while (i < N) {
      const a = rnd() * Math.PI * 2;
      const g = oy - 0.5 - Math.pow(rnd(), 0.8) * (DRAW_MAX - 0.2);
      const P = bandPoint(a, g);
      const nc = Math.min(N - i, 2 + Math.floor(rnd() * 5));
      let pick = rnd(), kind = 0;
      for (let k = 0; k < kinds.length; k++) { pick -= kinds[k][1]; if (pick <= 0) { kind = k; break; } }
      const coral = kind === 2 || kind === 3;
      for (let j = 0; j < nc; j++) {
        const ox = P.x + (rnd() - 0.5) * 3.2, oz = P.z + (rnd() - 0.5) * 3.2;
        const y = gh(ox, oz);
        const s = (coral ? 0.35 : 0.28) + rnd() * rnd() * (coral ? 1.1 : 1.3);
        sc.set(s * (0.8 + rnd() * 0.6), s * (coral ? 0.35 + rnd() * 0.25 : 0.4 + rnd() * 0.45), s * (0.8 + rnd() * 0.6));
        e.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
        q.setFromEuler(e);
        pv.set(ox, y + sc.y * (coral ? 0.35 : 0.2), oz);
        m4.compose(pv, q, sc);
        mesh.setMatrixAt(i, m4);
        c.setHex(kinds[kind][0]).multiplyScalar(0.8 + rnd() * 0.4);
        mesh.setColorAt(i, c);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;                 // r128 culls instances by the unit geometry
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.terrain = true;
    mesh.name = "tsunami-reef";
    A.root.add(mesh);
    return mesh;
  }

  // ---- fish: a flat silhouette lying on its side, flopping in the vertex shader -
  function fishGeo() {
    const NU = 14, NJ = 6;
    const pos = [], col = [], idx = [];
    const back = [0.035, 0.050, 0.060], lat = [0.16, 0.17, 0.17], belly = [0.36, 0.36, 0.35], fin = [0.08, 0.09, 0.10];
    for (let i = 0; i < NU; i++) {
      const u = i / (NU - 1);                 // 0 tail tip .. 1 snout
      let hd, th;
      if (u < 0.16) { const k = u / 0.16; hd = 0.20 - 0.15 * k; th = 0.006 + 0.012 * k; }
      else {
        const k = (u - 0.16) / 0.84;
        hd = 0.05 + 0.15 * Math.sin(Math.PI * Math.pow(k, 0.72));
        if (u > 0.97) hd *= (1 - u) / 0.03 * 0.6 + 0.4;
        th = 0.018 + 0.05 * Math.sin(Math.PI * Math.pow(k, 0.8));
      }
      const tailFork = u < 0.05 ? (0.05 - u) / 0.05 : 0;
      for (let j = 0; j <= NJ; j++) {
        const s = -1 + (2 * j) / NJ;
        const zz = s * hd;
        // the fork: the middle of the tail edge is cut back
        const xx = (u - 0.5) + (tailFork > 0 ? (1 - Math.abs(s)) * 0.06 * tailFork : 0);
        const yy = th * Math.sqrt(Math.max(0, 1 - s * s));
        pos.push(xx, yy, zz);
        let c;
        if (u < 0.16) c = fin;
        else if (s > 0.35) c = back;
        else if (s > -0.15) c = lat;
        else c = belly;
        let k = 1;
        if (u > 0.78 && u < 0.86 && Math.abs(s - 0.25) < 0.2) k = 0.25;   // the eye
        col.push(c[0] * k, c[1] * k, c[2] * k);
      }
    }
    for (let i = 0; i < NU - 1; i++) {
      for (let j = 0; j < NJ; j++) {
        const a = i * (NJ + 1) + j, b = a + 1, d = a + NJ + 1, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function buildFish() {
    const N = Math.round(CBZ.qScale ? CBZ.qScale(70, 150) : 120);
    const geo = fishGeo();
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aFish", attr);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    mat.name = "tsunami-fish";
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aFish;\nuniform float uTime;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "{",
          "  float ft = uTime * aFish.y + aFish.x;",
          "  float fc = fract(ft);",
          "  float hop = fc < 0.22 ? sin(fc / 0.22 * 3.14159) : 0.0;",   // the flop: a C-curl off the mud
          "  float bend = position.x * position.x * 4.0;",
          "  transformed.y += bend * 0.30 * hop + hop * hop * 0.30;",
          "  transformed.z += bend * 0.10 * hop * aFish.w;",
          "  float rest = step(0.5, fract(ft * 0.5 + 0.25)) * (1.0 - step(0.001, hop));",
          "  float tail = smoothstep(0.05, -0.5, position.x);",
          "  transformed.y += abs(sin(uTime * 19.0 + aFish.x * 37.0)) * 0.07 * tail * rest;",   // tail slaps
          "  transformed *= aFish.z;",
          "}",
        ].join("\n"));
    };
    mat.customProgramCacheKey = () => "tsunami-scene-fish";
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.name = "tsunami-fish";
    A.root.add(mesh);
    return { mesh, attr, N, x: new Float32Array(N), z: new Float32Array(N), show: new Float32Array(N) };
  }
  // Re-scatter per tsunami: most of the fish on the side the sea left from.
  function scatterFish() {
    const F = S.fish, rnd = rngOf(1000 + events * 7919);
    const oy = A.oceanY != null ? A.oceanY : -0.8;
    const appr = Math.atan2(-tsu.dz, -tsu.dx);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const sc = new THREE.Vector3(), pv = new THREE.Vector3();
    const arr = F.attr.array;
    for (let i = 0; i < F.N; i++) {
      const a = rnd() < 0.75 ? appr + (rnd() + rnd() + rnd() - 1.5) * 0.9 : rnd() * Math.PI * 2;
      // most on the flat foreshore (bared by every drawdown), the rest down the shelf
      const g = rnd() < 0.6 ? oy - 0.45 - rnd() * 1.1 : oy - 1.5 - rnd() * 4.2;
      const P = bandPoint(a, g);
      const x = P.x + (rnd() - 0.5) * 2, z = P.z + (rnd() - 0.5) * 2;
      const len = 0.28 + rnd() * rnd() * 0.55;
      e.set(0, rnd() * 6.28, 0); q.setFromEuler(e);
      sc.set(len, len, len);
      pv.set(x, gh(x, z) + 0.03, z);
      m4.compose(pv, q, sc);
      F.mesh.setMatrixAt(i, m4);
      F.x[i] = x; F.z[i] = z; F.show[i] = 0;
      arr[i * 4] = rnd() * 10;                // phase
      arr[i * 4 + 1] = 0.35 + rnd() * 0.5;    // flops per second
      arr[i * 4 + 2] = 0;                     // shown (0 = collapsed)
      arr[i * 4 + 3] = rnd() < 0.5 ? -1 : 1;  // which way it curls
    }
    F.mesh.instanceMatrix.needsUpdate = true;
    F.attr.needsUpdate = true;
  }

  // ---- stranded boats: four lofted dinghies lying on their bilges --------------
  function addDinghy(P, C, I, M, o) {
    const NS = 14, J = 10, L = o.L, B = o.B, D = o.D;
    const hb = (u) => {
      if (u < 0.45) return B * 0.5 * (0.74 + 0.26 * Math.sin((u / 0.45) * Math.PI / 2));
      return B * 0.5 * Math.max(0.015, Math.pow(Math.cos(((u - 0.45) / 0.55) * Math.PI / 2), 0.75));
    };
    const sheer = (u) => D + 0.16 * u * u * u + 0.04 * (1 - u) * (1 - u) * (1 - u);
    const keel = (u) => D * 0.92 * Math.pow(Math.max(0, (u - 0.62) / 0.38), 1.7) + 0.06 * Math.max(0, (0.15 - u) / 0.15);
    const v = new THREE.Vector3();
    const start = P.length / 3;
    const push = (x, y, z, c) => { v.set(x, y, z).applyMatrix4(M); P.push(v.x, v.y, v.z); C.push(c[0], c[1], c[2]); };
    const grid = (inner) => {
      const b0 = P.length / 3;
      for (let i = 0; i < NS; i++) {
        const u = i / (NS - 1), h = hb(u), kk = keel(u), sh = sheer(u);
        for (let j = 0; j <= J; j++) {
          const s = -1 + (2 * j) / J, as = Math.abs(s);
          let x = h * s, y = kk + (sh - kk) * Math.pow(as, 1.8);
          const z = (u - 0.5) * L;
          let c;
          if (inner) {
            x *= Math.max(0, h - 0.035) / h; y = Math.min(sh, y + 0.035);
            c = y < D * 0.25 ? o.bilge : o.inner;
          } else {
            c = y < D * 0.32 ? o.bottom : (y > sh - 0.07 ? o.stripe : o.paint);
          }
          push(x, y, z, c);
        }
      }
      for (let i = 0; i < NS - 1; i++) {
        for (let j = 0; j < J; j++) {
          const a = b0 + i * (J + 1) + j, b = a + 1, d = a + J + 1, e = d + 1;
          I.push(a, b, d, b, e, d);
        }
      }
      return b0;
    };
    const out = grid(false), inn = grid(true);
    // gunwale rims: join the outer and inner sheer lines along both sides
    for (const j of [0, J]) {
      for (let i = 0; i < NS - 1; i++) {
        const a = out + i * (J + 1) + j, b = out + (i + 1) * (J + 1) + j;
        const c = inn + i * (J + 1) + j, d = inn + (i + 1) * (J + 1) + j;
        I.push(a, b, c, b, d, c);
      }
    }
    // transom: a flat plate fanned off the stern section
    const hub = P.length / 3;
    push(0, (keel(0) + sheer(0)) * 0.5, -L * 0.5 - 0.005, o.stripe);
    for (let j = 0; j < J; j++) I.push(hub, out + j, out + j + 1);
    // thwarts: planks you sit on
    const plank = (u, w, t, dz, y) => {
      const b0 = P.length / 3, hw = hb(u) * w, z = (u - 0.5) * L;
      const pts = [[-hw, y, z - dz], [hw, y, z - dz], [hw, y, z + dz], [-hw, y, z + dz],
        [-hw, y - t, z - dz], [hw, y - t, z - dz], [hw, y - t, z + dz], [-hw, y - t, z + dz]];
      for (const p of pts) push(p[0], p[1], p[2], o.wood);
      const f = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4]];
      for (const q of f) I.push(b0 + q[0], b0 + q[1], b0 + q[2], b0 + q[0], b0 + q[2], b0 + q[3]);
    };
    plank(0.55, 0.93, 0.045, 0.12, D * 0.66);
    plank(0.12, 0.90, 0.045, 0.16, D * 0.60);
    plank(0.80, 0.80, 0.045, 0.10, D * 0.70);
    return start;
  }
  function buildBoats() {
    const rnd = rngOf(4242 + events);
    const appr = Math.atan2(-tsu.dz, -tsu.dx);
    const oy = A.oceanY != null ? A.oceanY : -0.8;
    const P = [], C = [], I = [];
    const paints = [
      [[0.34, 0.33, 0.30], [0.30, 0.05, 0.04]],   // white-ish, red bottom
      [[0.03, 0.09, 0.20], [0.06, 0.06, 0.07]],   // navy
      [[0.05, 0.16, 0.08], [0.25, 0.05, 0.04]],   // green
      [[0.30, 0.20, 0.04], [0.06, 0.08, 0.12]],   // yellow
    ];
    const spots = [appr + 0.22, appr - 0.48, appr + 1.3, appr + Math.PI + 0.5];
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    for (let b = 0; b < spots.length; b++) {
      const Pt = bandPoint(spots[b], oy - 1.1 - rnd() * 2.8);
      const L = 3.0 + rnd() * 1.4, Bm = L * (0.38 + rnd() * 0.05), D = 0.5 + rnd() * 0.12;
      const pc = paints[b % paints.length];
      const o = {
        L, B: Bm, D,
        paint: pc[0], bottom: pc[1],
        stripe: [pc[0][0] * 0.6, pc[0][1] * 0.6, pc[0][2] * 0.6],
        inner: [0.20, 0.19, 0.17], bilge: [0.07, 0.06, 0.045], wood: [0.17, 0.11, 0.06],
      };
      const roll = (rnd() < 0.5 ? -1 : 1) * (0.95 + rnd() * 0.35);   // on its bilge, gunwale to the mud
      e.set((rnd() - 0.5) * 0.12, rnd() * 6.28, roll, "YXZ");
      q.setFromEuler(e);
      pv.set(Pt.x, Pt.y, Pt.z);
      M.compose(pv, q, one);
      const s0 = addDinghy(P, C, I, M, o);
      // settle it: lowest point of the hull 12 cm into the mud
      let minC = Infinity;
      for (let i = s0; i < P.length / 3; i++) {
        const cl = P[i * 3 + 1] - gh(P[i * 3], P[i * 3 + 2]);
        if (cl < minC) minC = cl;
      }
      const drop = minC + 0.12;
      for (let i = s0; i < P.length / 3; i++) P[i * 3 + 1] -= drop;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    mat.name = "tsunami-stranded-boats";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "tsunami-stranded-boats";
    mesh.castShadow = false; mesh.receiveShadow = true;
    A.root.add(mesh);
    return mesh;
  }

  /* =============================================================================
     2. THE AFTERMATH
     ============================================================================= */
  function buildMud() {
    const cx = A.center.x, cz = A.center.z, R = A.radius;
    const oy = A.oceanY != null ? A.oceanY : -0.8;
    const H = R + 30, span = 2 * H, ox = cx - H, oz = cz - H;
    const N = MUD_N, NN = N * N;
    const gnd = new Float32Array(NN), land = new Uint8Array(NN);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ox + (i + 0.5) * span / N, z = oz + (j + 0.5) * span / N;
        const k = j * N + i;
        gnd[k] = gh(x, z);
        land[k] = gnd[k] > oy + 0.1 && Math.hypot(x - cx, z - cz) < H ? 1 : 0;
      }
    }
    const data = new Uint8Array(NN * 4);
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false; tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    // the drape: a grid on the ground, only the part over the island kept
    const SEG = Math.round(CBZ.qScale ? CBZ.qScale(110, 150) : 140);
    const NV = SEG + 1;
    const pos = new Float32Array(NV * NV * 3), nrm = new Float32Array(NV * NV * 3);
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NV; i++) {
        const x = ox + (i / SEG) * span, z = oz + (j / SEG) * span, k = j * NV + i;
        pos[k * 3] = x; pos[k * 3 + 1] = gh(x, z) + MUD_LIFT; pos[k * 3 + 2] = z;
      }
    }
    const keepR = R + 22;
    const inR = (k) => Math.hypot(pos[k * 3] - cx, pos[k * 3 + 2] - cz) < keepR;
    const idx = [];
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * NV + i, b = a + 1, d = a + NV, e = d + 1;
        if (!(inR(a) || inR(b) || inR(d) || inR(e))) continue;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();                 // the silt takes the hillside's light
    geo.computeBoundingSphere();
    const MU = {
      uMud: { value: tex },
      uMudO: { value: new THREE.Vector2(ox, oz) },
      uMudS: { value: 1 / span },
      uDrain: { value: new THREE.Vector2(-1, 0) },
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4;
    mat.name = "tsunami-silt";
    mat.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, MU, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vMdW;\nvarying vec3 vMdN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMdW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMdN = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "varying vec3 vMdW; varying vec3 vMdN;",
          "uniform sampler2D uMud; uniform vec2 uMudO; uniform float uMudS; uniform vec2 uDrain;",
          "uniform float uTime; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol;",
          NOISE, SHEEN,
          "float mdGloss; float mdPud; float n2; float n3;",
        ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{",
          "  vec4 m = texture2D(uMud, (vMdW.xz - uMudO) * uMudS);",
          "  if (m.r < 0.004) discard;",
          "  float level = m.r * 25.0 - 2.0;",
          // metres of water that stood over THIS point at the peak, off the real
          // ground under the fragment: the inland limit is a contour, not a cell
          "  float reach = level - (vMdW.y - " + MUD_LIFT.toFixed(3) + ");",
          "  float wet = m.g, thick = m.b;",
          "  vec2 p = vMdW.xz;",
          "  vec2 pr = vec2(-uDrain.y, uDrain.x);",
          "  float n1 = tsN(p * 0.17); n2 = tsN(p * 0.71 + 5.0); n3 = tsN(p * 2.9 + 1.3);",
          // silt combed out along the drain
          "  float streak = tsN(vec2(dot(p, pr) * 0.55, dot(p, uDrain) * 0.045) + n1 * 0.9);",
          "  float cover = smoothstep(0.0, 0.3, reach);",
          "  vec3 siltDry = vec3(0.235, 0.215, 0.180);",
          "  vec3 siltWet = vec3(0.070, 0.060, 0.047);",
          "  float wk = wet * wet * (3.0 - 2.0 * wet);",
          "  vec3 col = mix(siltDry, siltWet, wk);",
          "  col *= 0.82 + 0.36 * n2;",
          "  col *= 1.0 - 0.30 * smoothstep(0.45, 0.85, streak);",
          "  float a = cover * (0.32 + 0.40 * thick + 0.18 * n1) * mix(0.72, 1.0, wk);",
          "  a *= 0.72 + 0.40 * smoothstep(0.3, 0.85, streak);",
          // standing puddles, shrinking as it dries
          "  float pth = 0.60 + (1.0 - wet) * 0.22;",
          "  mdPud = smoothstep(pth, pth + 0.035, n1 * 0.62 + n2 * 0.28 + n3 * 0.10) * cover;",
          "  col = mix(col, vec3(0.040, 0.037, 0.030), mdPud);",
          "  a = max(a, mdPud * 0.95);",
          // the wrack line where the water stopped, and the scum just below it
          "  float lr = reach + 0.05 - (n2 - 0.5) * 0.14;",
          "  float line = 1.0 - smoothstep(0.0, 0.16, abs(lr));",
          "  float scum = (1.0 - smoothstep(0.0, 0.12, abs(lr - 0.26))) * smoothstep(0.42, 0.6, n3);",
          "  col = mix(col, vec3(0.030, 0.026, 0.020), line);",
          "  col = mix(col, vec3(0.30, 0.29, 0.26), scum * 0.85);",
          "  a = max(a, max(line * 0.9, scum * 0.75));",
          "  mdGloss = wk * (0.45 + 0.55 * mdPud) + mdPud * 0.25 * (1.0 - wk);",
          "  diffuseColor.rgb = col;",
          "  diffuseColor.a = clamp(a, 0.0, 1.0);",
          "  if (diffuseColor.a < 0.01) discard;",
          "}",
        ].join("\n"))
        .replace("#include <envmap_fragment>", [
          "#include <envmap_fragment>",
          "{",
          "  vec3 mn = normalize(vMdN + vec3((n3 - 0.5) * 0.14, 0.0, (n2 - 0.5) * 0.14) * (1.0 - mdPud));",
          "  outgoingLight = tsSheen(outgoingLight, vMdW, mn, mdGloss, mdPud);",
          "}",
        ].join("\n"));
    };
    mat.customProgramCacheKey = () => "tsunami-scene-silt";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "tsunami-silt";
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.userData.terrain = true;
    mesh.visible = false;
    A.root.add(mesh);
    return {
      mesh, tex, data, MU, N, ox, oz, span, gnd, land,
      lvl: new Float32Array(NN).fill(-99), dep: new Float32Array(NN), wet: new Float32Array(NN),
      lb: new Uint8Array(NN), any: false,
    };
  }
  function levelByte(l) { return Math.max(1, Math.min(255, Math.round(((l + 2) / 25) * 255))); }

  // One 5 Hz pass over the cells. `query` = the water is up somewhere, so ask it.
  function mudTick(dt, query) {
    const M = S.mud, N = M.N, NN = N * N;
    let changed = false, stillWet = false;
    if (query) {
      const step = M.span / N;
      for (let j = 0; j < N; j++) {
        const z = M.oz + (j + 0.5) * step;
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (!M.land[k]) continue;
          const x = M.ox + (i + 0.5) * step;
          const d = depthAt(x, z);
          if (d > 0.04) {
            const l = M.gnd[k] + d;
            if (l > M.lvl[k] + 0.02) { M.lvl[k] = l; M.lb[k] = levelByte(l); changed = true; }
            if (d > M.dep[k]) M.dep[k] = d;
            if (M.wet[k] < 1) { M.wet[k] = 1; changed = true; }
            M.any = true;
          }
        }
      }
    }
    const dry = dt / DRY_SECS;
    const data = M.data;
    for (let k = 0; k < NN; k++) {
      if (M.lvl[k] < -90) continue;
      if (M.wet[k] > 0) {
        // a cell is only drying once the water is off it; while submerged the
        // query above pins it to 1 every pass
        M.wet[k] = Math.max(0, M.wet[k] - dry);
        stillWet = true; changed = true;
      }
      data[k * 4 + 1] = Math.round(M.wet[k] * 255);
      data[k * 4 + 2] = Math.round(clamp01(M.dep[k] / 3) * 255);
      data[k * 4 + 3] = 255;
    }
    if (changed) {
      // levels, dilated two cells past the reach so the bilinear filter never
      // drags the flood's level down before the real contour on the ground
      const lb = M.lb;
      for (let k = 0; k < NN; k++) data[k * 4] = lb[k];
      for (let pass = 0; pass < 2; pass++) {
        const src = new Uint8Array(NN);
        for (let k = 0; k < NN; k++) src[k] = data[k * 4];
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const k = j * N + i;
            if (lb[k]) continue;
            let m = 0;
            for (let dj = -1; dj <= 1; dj++) {
              const jj = j + dj; if (jj < 0 || jj >= N) continue;
              for (let di = -1; di <= 1; di++) {
                const ii = i + di; if (ii < 0 || ii >= N) continue;
                const v = src[jj * N + ii]; if (v > m) m = v;
              }
            }
            if (m > data[k * 4]) data[k * 4] = m;
          }
        }
      }
      M.tex.needsUpdate = true;
    }
    M.mesh.visible = M.any;
    return stillWet;
  }

  // ---- the high-water stain: open box shells around the standing buildings -----
  function buildStain() {
    const list = (A.fragile || []).slice();
    const N = Math.max(1, list.length);
    const P = [], Nn = [], I = [];
    const face = (ax, az, nx, nz) => {
      // one side of the unit shell, y 0..1, facing (nx, nz)
      const b0 = P.length / 3;
      const px = -nz, pz = nx;            // along the face
      const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
      for (const c of corners) {
        P.push(ax + px * c[0], c[1], az + pz * c[0]);
        Nn.push(nx, 0, nz);
      }
      I.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    };
    face(0, 0.5, 0, 1); face(0, -0.5, 0, -1); face(0.5, 0, 1, 0); face(-0.5, 0, -1, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3));
    geo.setIndex(I);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aStain", attr);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
    mat.name = "tsunami-highwater-stain";
    mat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aStain;\nvarying vec4 vSt;\nvarying vec3 vStP;\nvarying float vStY;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "vSt = aStain;",
          "vStY = position.y;",
          "#ifdef USE_INSTANCING",
          "vStP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;",
          "#else",
          "vStP = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          "#endif",
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vSt;\nvarying vec3 vStP;\nvarying float vStY;\n" + NOISE)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{",
          "  float H = vSt.x;",
          "  float below = (1.0 - vStY) * H;",               // m under the high-water line
          "  float along = vStP.x + vStP.z;",
          "  float b = below + (tsN(vec2(along * 0.9, 3.0)) - 0.5) * 0.10;",
          "  if (b < 0.0 || vSt.y < 0.01) discard;",
          "  float wet = vSt.z;",
          "  float up = clamp(vStY, 0.0, 1.0);",
          "  float drip = smoothstep(0.35, 0.8, tsN(vec2(along * 2.3, vStP.y * 0.13)));",
          "  float mott = tsN(vec2(along * 0.7, vStP.y * 0.6));",
          "  vec3 mud = mix(vec3(0.20, 0.18, 0.145), vec3(0.075, 0.065, 0.050), wet);",
          "  float a = mix(0.62, 0.30, up) * (0.78 + 0.30 * drip + 0.12 * mott);",
          "  a *= smoothstep(0.02, 0.10, b);",
          // the crisp dark line at the top, then the scum band just under it
          "  float line = 1.0 - smoothstep(0.035, 0.085, b);",
          "  float scum = smoothstep(0.08, 0.11, b) * (1.0 - smoothstep(0.22, 0.34, b)) * smoothstep(0.35, 0.6, tsN(vec2(along * 4.0, vStP.y * 5.0)));",
          "  vec3 col = mud * (0.85 + 0.3 * mott);",
          "  col = mix(col, vec3(0.025, 0.022, 0.018), line);",
          "  col = mix(col, vec3(0.34, 0.33, 0.30), scum * 0.9);",
          "  a = max(a, max(line * 0.92, scum * 0.8));",
          "  diffuseColor.rgb = col;",
          "  diffuseColor.a = clamp(a, 0.0, 1.0) * vSt.y;",
          "}",
        ].join("\n"));
    };
    mat.customProgramCacheKey = () => "tsunami-scene-stain";
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.name = "tsunami-highwater-stain";
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) mesh.setMatrixAt(i, zero);
    A.root.add(mesh);
    return {
      mesh, attr, list, N, zero,
      lvl: new Float32Array(N).fill(-99), cur: new Float32Array(N), wet: new Float32Array(N), show: new Float32Array(N),
    };
  }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function stainTick(dt, query) {
    const T = S.stain, arr = T.attr.array;
    let any = false, wetLeft = false, dirtyM = false;
    for (let i = 0; i < T.list.length; i++) {
      const b = T.list[i];
      if (b.fallen || T.lvl[i] < -90) {
        if (arr[i * 4 + 1] !== 0 || T.lvl[i] > -90) { T.mesh.setMatrixAt(i, T.zero); dirtyM = true; }
        arr[i * 4 + 1] = 0;
        if (b.fallen) T.lvl[i] = -99;
        if (!query || b.fallen) continue;
      }
      const base = b.gy != null ? b.gy : gh(b.x, b.z);
      if (query) {
        const d = depthAt(b.x, b.z);
        const cur = d > 0 ? gh(b.x, b.z) + d : -99;
        T.cur[i] = cur;
        if (d > 0.04) T.wet[i] = 1;
        if (cur > T.lvl[i] && cur - base > 0.3) {
          T.lvl[i] = cur;
          const H = cur - base + 0.05;
          _p.set(b.x, base - 0.05, b.z);
          _s.set((b.w || 4) + 0.6, H, (b.d || 4) + 0.6);
          _m4.compose(_p, _q, _s);
          T.mesh.setMatrixAt(i, _m4);
          dirtyM = true;
          arr[i * 4] = H;
        }
      } else T.cur[i] = -99;
      if (T.lvl[i] < -90) continue;
      // reveal once the water has dropped off the mark (never a line riding the surface)
      const target = T.lvl[i] - T.cur[i] > 0.3 ? 1 : 0;
      T.show[i] += (target - T.show[i]) * Math.min(1, dt * 1.5);
      if (T.cur[i] < -90 || T.cur[i] < T.lvl[i] - 0.05) T.wet[i] = Math.max(0, T.wet[i] - dt / DRY_SECS);
      if (T.wet[i] > 0) wetLeft = true;
      arr[i * 4 + 1] = T.show[i];
      arr[i * 4 + 2] = T.wet[i];
      any = true;
    }
    if (dirtyM) T.mesh.instanceMatrix.needsUpdate = true;
    T.attr.needsUpdate = true;
    T.mesh.visible = any;
    return wetLeft;
  }

  /* =============================================================================
     LIFECYCLE
     ============================================================================= */
  function ensureBuilt() {
    if (S) return;
    S = {};
    S.band = buildBand();
    S.reef = buildReef();
    S.fish = buildFish();
    S.boats = buildBoats();
    S.mud = buildMud();
    S.stain = buildStain();
  }
  function clearAftermath() {
    drying = false;
    if (!S) return;
    const M = S.mud;
    M.lvl.fill(-99); M.dep.fill(0); M.wet.fill(0); M.lb.fill(0); M.data.fill(0);
    M.any = false; M.tex.needsUpdate = true; M.mesh.visible = false;
    const T = S.stain;
    T.lvl.fill(-99); T.wet.fill(0); T.show.fill(0); T.cur.fill(-99);
    T.attr.array.fill(0); T.attr.needsUpdate = true;
    for (let i = 0; i < T.N; i++) T.mesh.setMatrixAt(i, T.zero);
    T.mesh.instanceMatrix.needsUpdate = true; T.mesh.visible = false;
  }
  function clearAll() {
    tsu.active = false; flood.active = false;
    clearAftermath();
    if (!S) return;
    S.band.mesh.visible = false; S.band.U.uOn.value = 0;
    S.fish.mesh.visible = false; S.fish.show.fill(0);
    const fa = S.fish.attr.array; for (let i = 0; i < S.fish.N; i++) fa[i * 4 + 2] = 0;
    S.fish.attr.needsUpdate = true;
  }
  function bindArena(arena) {
    if (A === arena) return;
    if (S && A) {                                  // a different arena: drop the old parts
      for (const k of ["band", "reef", "fish", "boats", "mud", "stain"]) {
        const m = S[k] && (S[k].mesh || S[k]);
        if (m && m.parent) m.parent.remove(m);
      }
    }
    S = null; A = arena;
    tsu.active = false; flood.active = false; drying = false; events = 0;
    // a new match (arena.reset) wipes the island's evidence with the rest
    if (A && typeof A.reset === "function" && !A._tsuSceneWrapped) {
      const orig = A.reset;
      A.reset = function () { const r = orig.apply(this, arguments); if (A === this) clearAll(); return r; };
      A._tsuSceneWrapped = true;
    }
  }

  function startTsunami(e) {
    ensureBuilt();
    clearAftermath();                              // a new wave writes its own mark
    events++;
    tsu.active = true; tsu.t = 0;
    tsu.cx = +e.cx || A.center.x; tsu.cz = +e.cz || A.center.z;
    tsu.dx = Number.isFinite(e.dx) ? e.dx : 1; tsu.dz = Number.isFinite(e.dz) ? e.dz : 0;
    scatterFish();
    S.mud.MU.uDrain.value.set(-tsu.dx, -tsu.dz);
  }

  function refreshLight() {
    const sc = CBZ.scene;
    if (sc && sc.fog && sc.fog.color) U.uSky.value.copy(sc.fog.color).multiplyScalar(0.95);
    const sun = CBZ.sun;
    if (sun && sun.position) {
      const tp = sun.target && sun.target.position ? sun.target.position : null;
      const v = U.uSunDir.value.copy(sun.position);
      if (tp) v.sub(tp);
      if (v.lengthSq() > 1e-6) v.normalize();
      U.uSunCol.value.copy(sun.color).multiplyScalar(Math.min(1.4, (sun.intensity || 1) * 0.55));
    }
  }

  function slowPass(dt) {
    refreshLight();
    const water = tsu.active || flood.active;
    // fish: flapping only where the mud is bare
    if (tsu.active && (tsu.phase === "warn" || tsu.phase === "sweep")) {
      const F = S.fish, fa = F.attr.array;
      let any = false;
      for (let i = 0; i < F.N; i++) {
        const tgt = depthAt(F.x[i], F.z[i]) < -0.04 ? 1 : 0;
        F.show[i] += (tgt - F.show[i]) * 0.55;
        if (F.show[i] < 0.02 && tgt === 0) F.show[i] = 0;
        fa[i * 4 + 2] = F.show[i];
        if (F.show[i] > 0) any = true;
      }
      F.attr.needsUpdate = true;
      F.mesh.visible = any;
    } else if (S.fish.mesh.visible) {
      S.fish.mesh.visible = false;
    }
    if (water || drying) {
      const w1 = mudTick(dt, water);
      const w2 = stainTick(dt, water);
      drying = !water && (w1 || w2);
    }
  }

  // 48.2: after the ocean has taken this frame's surge (47.9) and the beach's
  // wet line has read it (47.95), before the camera (50).
  if (CBZ.onUpdate) CBZ.onUpdate(48.2, function (dt) {
    if (!live()) return;
    const arena = CBZ.surv.arena;
    if (arena !== A) bindArena(arena);
    if (!A || !A.root || typeof A.groundHeightAt !== "function") return;
    dt = Math.max(0, Math.min(0.25, dt || 0));
    clock += dt;
    U.uTime.value = clock % 1000;

    const e = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
    const isT = !!(e && e.owner === "survival-tsunami");
    const isF = !!(e && e.owner === "survival-flood");
    if (isT && !tsu.active) startTsunami(e);
    if (!isT && tsu.active) { tsu.active = false; drying = true; }
    if (isF && !flood.active) {
      ensureBuilt(); flood.active = true; events++;
      S.mud.MU.uDrain.value.set(-(+e.dx || 1), -(+e.dz || 0));
    }
    if (!isF && flood.active) { flood.active = false; drying = true; }
    if (!S) return;

    if (tsu.active) {
      tsu.t += dt;
      tsu.phase = e.phase || "";
      if (Number.isFinite(e.dx)) { tsu.dx = e.dx; tsu.dz = e.dz; }
      tsu.frontS = Number.isFinite(e.frontS) ? e.frontS : -1e9;
      tsu.ahead = +e.aheadDrop || 0;
    }
    // the seabed skin: per-frame uniforms only
    const B = S.band;
    const bareing = tsu.active && (tsu.phase === "warn" || tsu.phase === "sweep");
    B.mesh.visible = bareing;
    if (bareing) {
      B.U.uOn.value = 1;
      B.U.uSea.value = meanY();
      B.U.uFront.value.set(tsu.cx, tsu.cz, tsu.dx, tsu.dz);
      B.U.uFrontS.value = tsu.frontS;
      B.U.uAhead.value = tsu.ahead;
      B.U.uDry.value = clamp01(tsu.t / 60);
    }

    slowAcc += dt;
    if (slowAcc >= SLOW) { const s = slowAcc; slowAcc = 0; slowPass(s); }
  });

  /* Tools / probes: what the scene holds right now. */
  CBZ.tsunamiScene = {
    audit() {
      if (!S) return { built: false };
      let reached = 0, wet = 0, maxLvl = -99;
      for (let k = 0; k < S.mud.lvl.length; k++) {
        if (S.mud.lvl[k] > -90) { reached++; if (S.mud.lvl[k] > maxLvl) maxLvl = S.mud.lvl[k]; }
        if (S.mud.wet[k] > 0) wet++;
      }
      let stained = 0; for (let i = 0; i < S.stain.N; i++) if (S.stain.lvl[i] > -90) stained++;
      let fishShown = 0; for (let i = 0; i < S.fish.N; i++) if (S.fish.show[i] > 0.5) fishShown++;
      return {
        built: true, events, tsunami: tsu.active ? tsu.phase : null, flood: flood.active, drying,
        mudCells: reached, wetCells: wet, maxLevel: +maxLvl.toFixed(2),
        stainedBuildings: stained, fishShown, fish: S.fish.N, reef: S.reef.count,
        visible: {
          band: S.band.mesh.visible, fish: S.fish.mesh.visible, mud: S.mud.mesh.visible, stain: S.stain.mesh.visible,
        },
      };
    },
    reset: clearAll,
  };
})();
