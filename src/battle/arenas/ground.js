"use strict";
/* src/battle/arenas/ground.js — NPC War: THE GROUND REMEMBERS.

   A battle used to leave nothing on the ground it was fought on. Two hundred
   men crossed a dune and the sand behind them was as smooth as before; a
   500 lb bomb drew a fireball and the place it fell was the same flat sand a
   second later; a body past the corpse budget sank through the floor. Real
   ground is a record of the fight, and this file is that record:

     EARTHWORKS  berms, foxholes, snow drifts and CRATERS are part of the
                 ground's height (deform), so MAP.groundAt — what every man
                 stands on, what terrain sight cuts with, what the camera
                 floors on — dips into a crater and rises over a berm. A
                 crater is a real bowl with a raised lip and an ejecta apron,
                 drawn as its own mesh while the terrain under it gives up
                 the disc (a shader discard over a shared list of circles).
     MARKS       boot prints, paw and hoof prints, tank-track and tyre bands,
                 scorch: ONE instanced decal layer (a 2x-multiply overlay on
                 a 4x2 atlas), 12 288 marks in a ring, conformed to the slope
                 and stamped by stride as bodies move near the lens. Sand
                 takes them deep, snow takes them blue, grass takes them
                 faint, concrete takes only rubber.
     SPRAY       every detonation throws the ground it hit: grains and clods
                 on ballistic arcs and a slow dust ring, GPU-integrated from
                 one Points buffer (no per-frame CPU per particle).
     BLOWING     sand streaming off dune crests (spindrift off snow): a
                 static Points cloud animated entirely by one time uniform.
     REMAINS     a body or a wreck past the live budget is BAKED — its last
                 pose, world transforms and colours appended into a big
                 static vertex batch — instead of sinking out of the world.
                 Thousands of dead cost a handful of draw calls.

   Blasts reach here through studio.boom and ordnance.blast (wrapped once at
   begin), so every rocket, shell, bomb and wreck explosion digs, scorches,
   sprays and breaks cover (CBZ.battleCover.damage) by the same path.

   PUBLIC  CBZ.battleGround = {
     begin(ctx) -> groundAt         ctx = { id, surface, soft, groundAt, tint }
     deform(x, z), berm(ax,az,bx,bz,h,w), pit(x,z,r,d), drift(x,z,dx,dz,len,w,h)
     crater(x, z, r, depth), scorch(x, z, r), blast(x, y, z, R, power, src)
     patchTerrain(material)         make a terrain material give up crater discs
     mark(x, z, yaw, tile, w, l, strength)
     blowing(points, opts)          crest points [{x,y,z}] -> streaming grains
     keepBody(group) -> bool        bake a body / wreck into the remains
     stats() } */

CBZ.battleGround = (function () {
  const G = {
    ctx: null, base: null, gl: false,
    surface: "sand", soft: true,
    feats: [], grid: new Map(), CELL: 16,
    craters: [], marksN: 0, sprays: 0, kept: 0, keptVerts: 0,
  };
  function h01(a, b, s) {
    let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function sm(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  /* ============================================================ EARTHWORKS */
  function cellKey(i, j) { return i * 100003 + j; }
  function addFeat(f) {
    G.feats.push(f);
    const r = f.reach;
    const i0 = Math.floor((f.minX - 0) / G.CELL), i1 = Math.floor(f.maxX / G.CELL);
    const j0 = Math.floor(f.minZ / G.CELL), j1 = Math.floor(f.maxZ / G.CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = cellKey(i, j);
      let a = G.grid.get(k);
      if (!a) { a = []; G.grid.set(k, a); }
      a.push(f);
    }
    void r;
    return f;
  }
  function segDist(px, pz, f) {
    const dx = f.bx - f.ax, dz = f.bz - f.az, L2 = dx * dx + dz * dz || 1;
    let t = ((px - f.ax) * dx + (pz - f.az) * dz) / L2;
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = f.ax + dx * tc - px, qz = f.az + dz * tc - pz;
    return { d: Math.sqrt(qx * qx + qz * qz), t: t };
  }
  // CRATER PROFILE: a parabolic bowl rising to a sharp lip at r, then a rim
  // that falls back to the old ground over 0.7 r. t = distance / r.
  function craterAt(t, D) {
    const Hr = D * 0.24;
    if (t < 1) return -D + (D + Hr) * t * t;
    const u = (t - 1) / 0.7;
    if (u >= 1) return 0;
    return Hr * (1 - u) * (1 - u) * (1 + 2 * u);
  }
  function featH(f, x, z) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) return 0;
    switch (f.k) {
      case 0: {                                   // crater
        const d = Math.hypot(x - f.x, z - f.z);
        return craterAt(d / f.r, f.d);
      }
      case 1: {                                   // berm: a rounded bank along a segment
        const s = segDist(x, z, f);
        if (s.d >= f.w) return 0;
        const end = s.t < 0 ? 1 + s.t * f.L / f.w : s.t > 1 ? 1 - (s.t - 1) * f.L / f.w : 1;
        return f.h * (0.5 + 0.5 * Math.cos(Math.PI * s.d / f.w)) * sm(end);
      }
      case 2: {                                   // pit / foxhole
        const d = Math.hypot(x - f.x, z - f.z) / f.r;
        if (d >= 1.6) return 0;
        if (d < 1) return -f.d * (1 - Math.pow(d, 6));
        return f.d * 0.18 * Math.sin(Math.PI * (d - 1) / 0.6);   // the spoil thrown up round it
      }
      case 3: {                                   // drift: a tapering tail downwind of a thing
        const rx = x - f.x, rz = z - f.z;
        const a = rx * f.dx + rz * f.dz, c = -rx * f.dz + rz * f.dx;
        if (a < -f.w * 0.6 || a > f.len) return 0;
        const across = Math.abs(c) / (f.w * (1 - 0.5 * Math.max(0, a) / f.len));
        if (across >= 1) return 0;
        const along = a < 0 ? sm(1 + a / (f.w * 0.6)) : Math.pow(1 - a / f.len, 1.6);
        return f.h * along * (0.5 + 0.5 * Math.cos(Math.PI * across));
      }
    }
    return 0;
  }
  function deform(x, z) {
    if (!G.feats.length) return 0;
    const a = G.grid.get(cellKey(Math.floor(x / G.CELL), Math.floor(z / G.CELL)));
    if (!a) return 0;
    let h = 0, cr = 0;
    for (let i = 0; i < a.length; i++) {
      const f = a[i];
      const v = featH(f, x, z);
      if (f.k === 0) { if (v < cr) cr = v; else if (cr >= 0 && v > cr) cr = v; }
      else h += v;
    }
    // overlapping craters do not sum: the deepest bowl wins, the rims merge
    return h + cr;
  }
  function berm(ax, az, bx, bz, hgt, w) {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return addFeat({ k: 1, ax: ax, az: az, bx: bx, bz: bz, h: hgt, w: w, L: L,
      minX: Math.min(ax, bx) - w, maxX: Math.max(ax, bx) + w, minZ: Math.min(az, bz) - w, maxZ: Math.max(az, bz) + w });
  }
  function pit(x, z, r, d) {
    return addFeat({ k: 2, x: x, z: z, r: r, d: d, minX: x - r * 1.6, maxX: x + r * 1.6, minZ: z - r * 1.6, maxZ: z + r * 1.6 });
  }
  function drift(x, z, dx, dz, len, w, hgt) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const R = len + w;
    return addFeat({ k: 3, x: x, z: z, dx: dx, dz: dz, len: len, w: w, h: hgt, minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R });
  }

  /* ============================================================ TERRAIN DISCS
     The terrain mesh gives up every crater's bowl so the crater mesh can be
     seen: one shared uniform array, read by every material patched here. */
  const MAXC = 48;
  const U = { uCr: { value: [] }, uCrN: { value: 0 } };
  function initU() { if (!U.uCr.value.length) for (let i = 0; i < MAXC; i++) U.uCr.value.push(new THREE.Vector4(0, 0, 0, 0)); }
  const CR_DECL = "uniform vec4 uCr[" + MAXC + "];\nuniform int uCrN;\nvarying vec3 vCrW;\n";
  const CR_TEST = "for (int ci = 0; ci < " + MAXC + "; ci++) { if (ci >= uCrN) break; vec2 cd = vCrW.xz - uCr[ci].xy; if (dot(cd, cd) < uCr[ci].z) discard; }\n";
  function patchTerrain(mat) {
    if (!mat || mat.userData.crPatched) return mat;
    initU();
    mat.userData.crPatched = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uCr = U.uCr; sh.uniforms.uCrN = U.uCrN;
      sh.vertexShader = "varying vec3 vCrW;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = CR_DECL + sh.fragmentShader.replace("void main() {", "void main() {\n" + CR_TEST);
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
    mat.customProgramCacheKey = function () { return (key ? key() : "") + "|cr"; };
    mat.needsUpdate = true;
    return mat;
  }

  /* ============================================================ CRATERS */
  const SURF = {
    sand:     { pit: [0.45, 0.34, 0.22], wall: [0.62, 0.47, 0.3], ejecta: [0.7, 0.55, 0.36], tint: [1, 1, 1], marks: 1, scorch: 0.85 },
    snow:     { pit: [0.24, 0.2, 0.17], wall: [0.38, 0.33, 0.29], ejecta: [0.55, 0.52, 0.5], tint: [0.86, 0.92, 1.1], marks: 1, scorch: 0.8 },
    grass:    { pit: [0.24, 0.18, 0.12], wall: [0.33, 0.25, 0.17], ejecta: [0.36, 0.3, 0.2], tint: [0.95, 1, 0.92], marks: 0.55, scorch: 0.9 },
    forest:   { pit: [0.2, 0.15, 0.1], wall: [0.28, 0.21, 0.14], ejecta: [0.3, 0.24, 0.16], tint: [0.95, 0.95, 0.9], marks: 0.7, scorch: 0.9 },
    concrete: { pit: [0.3, 0.3, 0.29], wall: [0.42, 0.41, 0.39], ejecta: [0.5, 0.49, 0.46], tint: [1, 1, 1], marks: 0, scorch: 1 },
  };
  function surf() { return SURF[G.surface] || SURF.sand; }
  let crMat = null;
  function craterMat() {
    if (crMat) return crMat;
    crMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    crMat.onBeforeCompile = function (sh) {
      sh.vertexShader = "attribute float aA;\nvarying float vA;\nvarying vec3 vCw;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvA = aA; vCw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = "varying float vA;\nvarying vec3 vCw;\n" +
        "float cH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
        sh.fragmentShader.replace("#include <color_fragment>",
          "#include <color_fragment>\n" +
          "{ float g = cH(floor(vCw.xz * 7.0)); float c = cH(floor(vCw.xz * 1.6) + 3.1);\n" +
          "  diffuseColor.rgb *= 0.88 + 0.16 * g + 0.1 * (c - 0.5);\n" +
          "  diffuseColor.a *= vA; }");
    };
    crMat.customProgramCacheKey = function () { return "npcwar-crater1"; };
    return crMat;
  }
  function craterMesh(c) {
    const RINGS = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.84, 0.94, 1.0, 1.08, 1.2, 1.34, 1.5, 1.7];
    const SEG = 40;
    const S = surf();
    const pos = [], col = [], al = [], idx = [];
    for (let r = 0; r < RINGS.length; r++) {
      for (let s = 0; s < SEG; s++) {
        const a = (s / SEG) * Math.PI * 2;
        const jag = 1 + (h01(s, c.seed, 5) - 0.5) * 0.08 * (r > 0 ? 1 : 0);
        const t = RINGS[r] * jag;
        const x = c.x + Math.cos(a) * t * c.r, z = c.z + Math.sin(a) * t * c.r;
        const y = G.base(x, z) + deform(x, z) + 0.015;
        pos.push(x, y, z);
        // colour: a scorched floor, raw walls, and an ejecta apron thrown out in rays
        const ray = h01(Math.round(a * 7), c.seed, 9);
        let k;
        if (t < 0.55) k = mix3(S.pit, [0.08, 0.07, 0.06], (1 - t / 0.55) * 0.55 * S.scorch);
        else if (t < 1.05) k = mix3(S.pit, S.wall, (t - 0.55) / 0.5);
        else k = mix3(S.wall, S.ejecta, Math.min(1, (t - 1.05) / 0.4));
        const v = 0.9 + 0.2 * h01(r, s, c.seed);
        col.push(k[0] * v, k[1] * v, k[2] * v);
        // the apron fades out in rays, the bowl is solid
        const fade = t < 1.15 ? 1 : Math.max(0, 1 - (t - 1.15) / (0.55 * (0.55 + ray * 0.9)));
        al.push(r === RINGS.length - 1 ? 0 : fade);
      }
    }
    for (let r = 0; r < RINGS.length - 1; r++) for (let s = 0; s < SEG; s++) {
      const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, cc = (r + 1) * SEG + s, d = (r + 1) * SEG + (s + 1) % SEG;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aA", new THREE.Float32BufferAttribute(al, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, craterMat());
    m.receiveShadow = true;
    m.renderOrder = -4;
    m.userData.dynamic = true;
    m.name = "crater";
    CBZ.scene.add(m);
    return m;
  }
  function mix3(a, b, t) { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  function crater(x, z, r, depth) {
    if (!G.base) return null;
    // a hit inside an old crater's lip widens it instead of stacking rims
    for (let i = 0; i < G.craters.length; i++) {
      const c = G.craters[i];
      if (Math.hypot(c.x - x, c.z - z) < c.r * 0.8 && r <= c.r * 1.1) { c.hits++; return c; }
    }
    if (G.craters.length >= MAXC) return null;
    const c = { x: x, z: z, r: r, d: depth, hits: 1, seed: (G.craters.length * 7919 + 13) | 0, mesh: null };
    // the old ground under the crater, measured BEFORE the dig, so the
    // mesh and the dent agree about where the lip meets the field
    const f = addFeat({ k: 0, x: x, z: z, r: r, d: depth, minX: x - r * 1.7, maxX: x + r * 1.7, minZ: z - r * 1.7, maxZ: z + r * 1.7 });
    c.feat = f;
    G.craters.push(c);
    if (G.gl) {
      initU();
      const v = U.uCr.value[G.craters.length - 1];
      v.set(x, z, (r * 0.97) * (r * 0.97), 0);
      U.uCrN.value = G.craters.length;
      c.mesh = craterMesh(c);
    }
    // the lip of a crater is cover: a ring of low points on the inner wall
    if (CBZ.battleCover) {
      const n = Math.max(6, Math.round(r * 2.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        CBZ.battleCover.terrain(x + Math.cos(a) * r * 0.62, z + Math.sin(a) * r * 0.62, -Math.cos(a), -Math.sin(a),
          Math.min(2.2, depth * 0.9 + depth * 0.24), "crater");
      }
    }
    return c;
  }

  /* ============================================================ MARKS */
  const MK = { cap: 12288, mesh: null, head: 0, attr: null, dirtyLo: 1e9, dirtyHi: -1, wrapped: false };
  const TILE = { boot: 0, paw: 1, hoof: 2, track: 3, tyre: 4, scorch: 5, smudge: 6, drag: 7 };
  function atlas() {
    const S = 128, c = document.createElement("canvas");
    c.width = S * 4; c.height = S * 2;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(128,128,128,0)"; g.fillRect(0, 0, c.width, c.height);
    const tile = function (i, fn) { g.save(); g.translate((i % 4) * S, ((i / 4) | 0) * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
    const sole = function (sc, grow) {
      g.beginPath();
      g.ellipse(64, 40, 21 * sc + grow, 30 * sc + grow, 0, 0, Math.PI * 2);      // the forefoot
      g.ellipse(64, 96, 17 * sc + grow, 21 * sc + grow, 0, 0, Math.PI * 2);      // the heel
      g.rect(51 - grow, 50, 26 + grow * 2, 40);                                   // the waist
    };
    // 0 BOOT: a lit rim of displaced sand, a dark impression, lug rows
    tile(0, function () {
      g.filter = "blur(2px)";
      g.fillStyle = "rgba(158,154,148,0.9)"; sole(1, 7); g.fill();
      g.filter = "blur(1px)";
      g.fillStyle = "rgba(88,84,80,1)"; sole(1, 0); g.fill();
      g.filter = "none";
      g.fillStyle = "rgba(66,62,58,1)";
      for (let y = 16; y < 64; y += 9) for (let x = 46; x < 84; x += 10) g.fillRect(x, y, 6, 4);
      for (let y = 82; y < 112; y += 9) for (let x = 50; x < 80; x += 10) g.fillRect(x, y, 6, 4);
    });
    // 1 PAW: four toes and the trilobed pad
    tile(1, function () {
      g.filter = "blur(2px)";
      g.fillStyle = "rgba(150,146,140,0.8)";
      g.beginPath(); g.ellipse(64, 78, 30, 26, 0, 0, Math.PI * 2); g.fill();
      g.filter = "blur(1px)";
      g.fillStyle = "rgba(84,80,76,1)";
      g.beginPath(); g.moveTo(40, 92); g.quadraticCurveTo(64, 56, 88, 92); g.quadraticCurveTo(64, 104, 40, 92); g.fill();
      [[36, 52], [54, 36], [74, 36], [92, 52]].forEach(function (p) { g.beginPath(); g.ellipse(p[0], p[1], 9, 12, 0, 0, Math.PI * 2); g.fill(); });
    });
    // 2 HOOF: two crescents
    tile(2, function () {
      g.filter = "blur(1.5px)";
      g.fillStyle = "rgba(152,148,142,0.8)"; g.beginPath(); g.ellipse(64, 64, 40, 50, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(80,76,72,1)";
      g.beginPath(); g.ellipse(48, 64, 16, 40, 0.1, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(80, 64, 16, 40, -0.1, 0, Math.PI * 2); g.fill();
    });
    // 3 TRACK: a band of grousers with the displaced berm along both edges
    tile(3, function () {
      g.filter = "blur(1.5px)";
      g.fillStyle = "rgba(160,156,150,0.75)"; g.fillRect(0, 0, 14, S); g.fillRect(S - 14, 0, 14, S);
      g.fillStyle = "rgba(96,92,88,1)"; g.fillRect(12, 0, S - 24, S);
      g.filter = "none";
      g.fillStyle = "rgba(70,66,62,1)";
      for (let y = 0; y < S; y += 16) g.fillRect(14, y, S - 28, 7);
    });
    // 4 TYRE: a chevron tread band
    tile(4, function () {
      g.filter = "blur(1px)";
      g.fillStyle = "rgba(100,96,92,0.95)"; g.fillRect(28, 0, 72, S);
      g.fillStyle = "rgba(74,70,66,1)";
      for (let y = -16; y < S + 16; y += 14) {
        g.beginPath(); g.moveTo(30, y); g.lineTo(64, y + 10); g.lineTo(98, y); g.lineTo(98, y + 5); g.lineTo(64, y + 15); g.lineTo(30, y + 5); g.fill();
      }
    });
    // 5 SCORCH: a black core, raking streaks, a soot halo
    tile(5, function () {
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, "rgba(20,18,16,1)"); gr.addColorStop(0.45, "rgba(34,31,28,0.9)"); gr.addColorStop(1, "rgba(60,56,52,0)");
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.strokeStyle = "rgba(26,24,22,0.55)"; g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        const a = i * 2.3999, l = 34 + (i * 37 % 26);
        g.lineWidth = 2 + (i % 4); g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke();
      }
    });
    // 6 SMUDGE: disturbed ground, where something heavy lay or slid
    tile(6, function () {
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 60);
      gr.addColorStop(0, "rgba(98,94,90,0.8)"); gr.addColorStop(1, "rgba(110,106,100,0)");
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    });
    // 7 DRAG: two heel grooves
    tile(7, function () {
      g.filter = "blur(2px)"; g.fillStyle = "rgba(92,88,84,0.9)";
      g.fillRect(36, 0, 14, S); g.fillRect(78, 0, 14, S);
    });
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  function marksInit() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const aM = new THREE.InstancedBufferAttribute(new Float32Array(MK.cap * 4), 4);
    aM.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aMark", aM);
    const S = surf();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas() }, uTint: { value: new THREE.Vector3(S.tint[0], S.tint[1], S.tint[2]) },
        uFar: { value: new THREE.Vector2(140, 320) } },
      vertexShader: [
        "attribute vec4 aMark;",
        "varying vec2 vUv; varying float vS; varying float vD;",
        "void main() {",
        "  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);",
        "  vUv = vec2(aMark.x + uv.x * 0.25, aMark.y + uv.y * 0.5);",
        "  vS = aMark.z;",
        "  vD = length(w.xyz - cameraPosition);",
        "  gl_Position = projectionMatrix * viewMatrix * w;",
        "}"].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap; uniform vec3 uTint; uniform vec2 uFar;",
        "varying vec2 vUv; varying float vS; varying float vD;",
        "void main() {",
        "  vec4 t = texture2D(uMap, vUv);",
        "  float k = t.a * vS * (1.0 - smoothstep(uFar.x, uFar.y, vD));",
        // 2x multiply: 0.5 is neutral, under darkens, over lifts the rim
        "  vec3 c = mix(vec3(0.5), t.rgb * uTint, k);",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"].join("\n"),
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    const m = new THREE.InstancedMesh(geo, mat, MK.cap);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MK.cap; i++) m.setMatrixAt(i, zero);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = MK.cap;
    m.frustumCulled = false;
    m.renderOrder = -3;
    m.userData.dynamic = true;
    m.name = "battle-marks";
    CBZ.scene.add(m);
    MK.mesh = m; MK.attr = aM;
  }
  const _q = { m: null, p: null, s: null, q: null, n: null, up: null, qy: null };
  function mark(x, z, yaw, tile, w, l, strength) {
    if (!MK.mesh) return;
    if (!_q.m) {
      _q.m = new THREE.Matrix4(); _q.p = new THREE.Vector3(); _q.s = new THREE.Vector3(); _q.q = new THREE.Quaternion();
      _q.n = new THREE.Vector3(); _q.up = new THREE.Vector3(0, 1, 0); _q.qy = new THREE.Quaternion();
    }
    const gA = G.ground;
    const y = gA(x, z);
    const e = Math.max(0.3, Math.min(w, l) * 0.6);
    _q.n.set(gA(x - e, z) - gA(x + e, z), 2 * e, gA(x, z - e) - gA(x, z + e)).normalize();
    _q.q.setFromUnitVectors(_q.up, _q.n);
    _q.qy.setFromAxisAngle(_q.up, yaw);
    _q.q.multiply(_q.qy);
    _q.p.set(x, y + 0.025, z);
    _q.s.set(w, 1, l);
    _q.m.compose(_q.p, _q.q, _q.s);
    const i = MK.head;
    MK.mesh.setMatrixAt(i, _q.m);
    const a = MK.attr.array;
    a[i * 4] = (tile % 4) * 0.25; a[i * 4 + 1] = tile < 4 ? 0.5 : 0; a[i * 4 + 2] = strength; a[i * 4 + 3] = 0;
    if (i < MK.dirtyLo) MK.dirtyLo = i;
    if (i > MK.dirtyHi) MK.dirtyHi = i;
    MK.head = (i + 1) % MK.cap;
    if (MK.head === 0) MK.wrapped = true;
    G.marksN++;
  }
  function marksFlush() {
    if (!MK.mesh || MK.dirtyHi < 0) return;
    const lo = MK.dirtyLo, n = MK.dirtyHi - lo + 1;
    const im = MK.mesh.instanceMatrix;
    im.updateRange.offset = lo * 16; im.updateRange.count = n * 16; im.needsUpdate = true;
    MK.attr.updateRange.offset = lo * 4; MK.attr.updateRange.count = n * 4; MK.attr.needsUpdate = true;
    MK.dirtyLo = 1e9; MK.dirtyHi = -1;
  }
  // a dark burn on the ground, any surface
  function scorch(x, z, r) {
    const S = surf();
    mark(x, z, h01(x * 10, z * 10, 3) * 6.28, TILE.scorch, r * 2, r * 2, Math.min(1, 0.6 + S.scorch * 0.4));
  }

  /* STAMP BY STRIDE. Every body near the lens leaves its feet in the ground
     it walks: men a boot each 0.72 m alternating sides, animals a paw or hoof
     sized by the animal, tracked hulls two grouser bands, wheeled ones two
     tyre bands. A body far from the camera stamps nothing (nobody is there
     to see it, and a thousand men must not cost a thousand matrices a
     frame); a vehicle always stamps, because a tank's track is read from a
     kilometre up. */
  const PRINT_R2 = 150 * 150;
  let emitBudget = 0;
  function feet(dt) {
    if (!MK.mesh || !G.ctx || dt <= 0) return;
    const S = surf();
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || typeof men === "undefined") return;
    emitBudget = 260;
    for (let i = 0; i < men.length && emitBudget > 0; i++) {
      const m = men[i];
      if (!m || m.dead || !m.pos || m.air || m.swim || m.seated || m.inVehicle) continue;
      if (m.group && m.group.visible === false) continue;
      if (m.vehicle) { if (S.marks > 0 || G.surface === "concrete") treads(m, S); continue; }
      if (S.marks <= 0) continue;
      const dx = m.pos.x - cam.x, dz = m.pos.z - cam.z;
      if (dx * dx + dz * dz > PRINT_R2) { m._gpX = undefined; continue; }
      if (m._gpX === undefined) { m._gpX = m.pos.x; m._gpZ = m.pos.z; m._gpS = 1; continue; }
      const mx = m.pos.x - m._gpX, mz = m.pos.z - m._gpZ;
      const d2 = mx * mx + mz * mz;
      const beast = !!m.beast;
      const size = beast ? Math.max(0.35, Math.min(3, m.rad || 0.6)) : 1;
      const stride = beast ? 0.45 + size * 0.75 : 0.72;
      if (d2 < stride * stride) continue;
      if (d2 > 36) { m._gpX = m.pos.x; m._gpZ = m.pos.z; continue; }    // teleported / respawned
      const d = Math.sqrt(d2), hx = mx / d, hz = mz / d;
      const yaw = Math.atan2(hx, hz);
      m._gpS = -m._gpS;
      const off = (beast ? 0.28 * size : 0.12) * m._gpS;
      const px = m.pos.x + hz * off, pz = m.pos.z - hx * off;
      if (beast) {
        const hoof = m.species && /bison|buffalo|horse|zebra|deer|elk|moose|giraffe|camel|cow|antelope|gazelle|boar|rhino|hippo/.test(m.species.id || "");
        const w = 0.09 + size * 0.11;
        mark(px, pz, yaw, hoof ? TILE.hoof : TILE.paw, w, w * (hoof ? 1.15 : 1.05), S.marks);
        if (size > 1.2) mark(px - hx * stride * 0.4, pz - hz * stride * 0.4, yaw, hoof ? TILE.hoof : TILE.paw, w, w * 1.1, S.marks * 0.9);
      } else {
        mark(px, pz, yaw, TILE.boot, 0.13, 0.31, S.marks * (m.speed > 3.5 ? 1 : 0.85));
      }
      m._gpX = m.pos.x; m._gpZ = m.pos.z;
      emitBudget--;
    }
  }
  function treads(u, S) {
    if (u._gpX === undefined) { u._gpX = u.pos.x; u._gpZ = u.pos.z; return; }
    const mx = u.pos.x - u._gpX, mz = u.pos.z - u._gpZ, d2 = mx * mx + mz * mz;
    if (d2 < 1.1 * 1.1) return;
    if (d2 > 100) { u._gpX = u.pos.x; u._gpZ = u.pos.z; return; }
    const d = Math.sqrt(d2), hx = mx / d, hz = mz / d;
    const st = (u.def && ((u.def.stats && u.def.stats.drive) || u.def.drive)) || "wheeled";
    const tracked = st === "tracked";
    const half = (u.vwid || 1.6) * (tracked ? 0.8 : 0.82);
    const yaw = Math.atan2(hx, hz);
    const k = G.surface === "concrete" ? 0.25 : S.marks;
    const cx = u._gpX + mx * 0.5, cz = u._gpZ + mz * 0.5;
    for (const s of [-1, 1]) {
      mark(cx + hz * half * s, cz - hx * half * s, yaw, tracked ? TILE.track : TILE.tyre,
        tracked ? Math.max(0.5, (u.vwid || 1.6) * 0.36) : 0.32, d * 1.06, k);
    }
    u._gpX = u.pos.x; u._gpZ = u.pos.z;
    emitBudget -= 2;
  }

  /* ============================================================ SPRAY */
  const SP = { cap: 8192, pts: null, head: 0, t: 0, a: {} };
  function sprayInit() {
    const g = new THREE.BufferGeometry();
    const mk = function (n, k) { const a = new THREE.BufferAttribute(new Float32Array(SP.cap * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); SP.a[k] = a; return a; };
    mk(3, "position"); mk(3, "aV"); mk(3, "aC"); mk(4, "aT");
    // birth far in the past: nothing draws until it is thrown
    for (let i = 0; i < SP.cap; i++) SP.a.aT.array[i * 4] = -1e4;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } },
      vertexShader: [
        "attribute vec3 aV; attribute vec3 aC; attribute vec4 aT;",
        "uniform float uTime; uniform float uScale;",
        "varying vec3 vC; varying float vA;",
        "void main() {",
        "  float t = uTime - aT.x;",
        "  float life = aT.z;",
        "  vC = aC; vA = 0.0;",
        "  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }",
        "  vec3 p;",
        "  float sz = aT.y;",
        "  if (aT.w > 0.5) {",
        // dust: drag-limited, swelling, rising a little, thinning
        "    float k = 1.0 - exp(-t * 1.6);",
        "    p = position + aV * k / 1.6 + vec3(0.0, 0.6 * t, 0.0);",
        "    sz *= 1.0 + t * 1.8;",
        "    vA = 0.55 * (1.0 - t / life) * smoothstep(0.0, 0.15, t);",
        "  } else {",
        // grains and clods: ballistic, never below where they were thrown from
        "    p = position + aV * t + vec3(0.0, -4.9, 0.0) * t * t;",
        "    p.y = max(p.y, position.y - 0.3);",
        "    vA = 0.95 * (1.0 - smoothstep(life * 0.6, life, t));",
        "  }",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  gl_PointSize = max(1.0, sz * uScale / -mv.z);",
        "  gl_Position = projectionMatrix * mv;",
        "}"].join("\n"),
      fragmentShader: [
        "varying vec3 vC; varying float vA;",
        "void main() {",
        "  vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);",
        "  if (r > 0.25) discard;",
        "  gl_FragColor = vec4(vC, vA * (1.0 - r * 3.2));",
        "}"].join("\n"),
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    pts.userData.dynamic = true;
    pts.name = "battle-spray";
    CBZ.scene.add(pts);
    SP.pts = pts;
  }
  function spray(x, y, z, R, power) {
    if (!SP.pts) return;
    const S = surf();
    const n = Math.max(40, Math.min(900, Math.round(30 + R * R * power * 1.1)));
    const now = SP.t;
    const P = SP.a.position.array, V = SP.a.aV.array, C = SP.a.aC.array, T = SP.a.aT.array;
    const lo = SP.head;
    const base = S.ejecta;
    for (let k = 0; k < n; k++) {
      const i = SP.head;
      const dust = k % 4 === 0;
      const a = h01(k, G.sprays, 11) * 6.2832, up = h01(k, G.sprays, 13);
      const sp = (dust ? 3 + up * 5 : 4 + up * 11) * Math.min(2.4, 0.6 + Math.sqrt(R) * 0.3);
      const vy = dust ? 0.8 + up * 2 : 5 + up * 13 * Math.min(1.8, 0.5 + power * 0.4);
      const off = h01(k, G.sprays, 17) * R * 0.15;
      P[i * 3] = x + Math.cos(a) * off; P[i * 3 + 1] = y + 0.1; P[i * 3 + 2] = z + Math.sin(a) * off;
      V[i * 3] = Math.cos(a) * sp; V[i * 3 + 1] = vy; V[i * 3 + 2] = Math.sin(a) * sp;
      const v = dust ? 1.05 : 0.7 + h01(k, 3, G.sprays) * 0.45;
      C[i * 3] = base[0] * v; C[i * 3 + 1] = base[1] * v; C[i * 3 + 2] = base[2] * v;
      T[i * 4] = now + (dust ? 0.05 : h01(k, 5, G.sprays) * 0.06);
      T[i * 4 + 1] = dust ? 0.9 + R * 0.12 : 0.05 + h01(k, 7, G.sprays) * 0.09 * Math.min(3, R * 0.25);
      T[i * 4 + 2] = dust ? 3 + R * 0.12 : 2.2;
      T[i * 4 + 3] = dust ? 1 : 0;
      SP.head = (SP.head + 1) % SP.cap;
    }
    G.sprays++;
    ["position", "aV", "aC", "aT"].forEach(function (k) {
      const A = SP.a[k];
      if (SP.head > lo) { A.updateRange.offset = lo * A.itemSize; A.updateRange.count = (SP.head - lo) * A.itemSize; }
      else { A.updateRange.offset = 0; A.updateRange.count = -1; }
      A.needsUpdate = true;
    });
  }

  /* ============================================================ BLOWING */
  function blowing(points, o) {
    if (!G.gl || !points || !points.length) return null;
    o = o || {};
    const per = o.per || 8;
    const n = points.length * per;
    const pos = new Float32Array(n * 3), sd = new Float32Array(n * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      for (let k = 0; k < per; k++) {
        const j = i * per + k;
        pos[j * 3] = p.x + (h01(i, k, 1) - 0.5) * (o.spread || 6);
        pos[j * 3 + 1] = p.y + 0.05;
        pos[j * 3 + 2] = p.z + (h01(i, k, 2) - 0.5) * (o.spread || 6);
        sd[j * 3] = h01(i, k, 3); sd[j * 3 + 1] = 0.6 + h01(i, k, 4) * 0.8; sd[j * 3 + 2] = p.h || 1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aS", new THREE.BufferAttribute(sd, 3));
    const col = o.color || [0.86, 0.7, 0.48];
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(o.wx || 1, o.wz || 0) },
        uCol: { value: new THREE.Vector3(col[0], col[1], col[2]) }, uScale: { value: 500 },
        uTravel: { value: o.travel || 9 }, uSize: { value: o.size || 0.05 } },
      vertexShader: [
        "attribute vec3 aS; uniform float uTime; uniform vec2 uWind; uniform float uScale; uniform float uTravel; uniform float uSize;",
        "varying float vA;",
        "void main() {",
        "  float ph = fract(uTime * 0.32 * aS.y + aS.x);",
        // gusts: whole stretches of crest smoke at once, then go quiet
        "  float gust = 0.35 + 0.65 * smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(uTime * 0.7 + position.x * 0.021 + position.z * 0.017));",
        "  vec3 p = position;",
        "  p.xz += uWind * ph * uTravel * aS.y;",
        "  p.y += sin(ph * 3.1416) * (0.35 + 0.5 * aS.y) - ph * aS.z * 0.45;",
        "  p.xz += vec2(-uWind.y, uWind.x) * sin(ph * 9.0 + aS.x * 30.0) * 0.25;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  float d = -mv.z;",
        "  vA = sin(ph * 3.1416) * gust * (1.0 - smoothstep(70.0, 160.0, d));",
        "  gl_PointSize = max(1.0, uSize * uScale / d);",
        "  gl_Position = projectionMatrix * mv;",
        "}"].join("\n"),
      fragmentShader: [
        "uniform vec3 uCol; varying float vA;",
        "void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard;",
        "  gl_FragColor = vec4(uCol, vA * 0.55 * (1.0 - r * 3.5)); }"].join("\n"),
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    pts.userData.dynamic = true;
    pts.name = "battle-blowing";
    CBZ.scene.add(pts);
    G.blow = pts;
    return pts;
  }

  /* ============================================================ REMAINS
     A body is baked, not deleted. Its meshes, in the pose they died in, are
     appended into a static vertex batch with their materials' colours. */
  const RB = { cap: 196608, list: [], mat: null };
  function rbNew() {
    if (!RB.mat) RB.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const g = new THREE.BufferGeometry();
    const mk = function (k) { const a = new THREE.BufferAttribute(new Float32Array(RB.cap * 3), 3); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a; };
    mk("position"); mk("normal"); mk("color");
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, RB.mat);
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.userData.dynamic = true;
    m.name = "battle-remains";
    CBZ.scene.add(m);
    const b = { mesh: m, n: 0 };
    RB.list.push(b);
    return b;
  }
  const _bv = {};
  function keepBody(group) {
    if (!G.gl || !group) return false;
    if (!_bv.v) { _bv.v = new THREE.Vector3(); _bv.n = new THREE.Vector3(); _bv.nm = new THREE.Matrix3(); _bv.c = new THREE.Color(); }
    group.updateMatrixWorld(true);
    const parts = [];
    let verts = 0;
    group.traverse(function (o) {
      if (!o.isMesh || !o.visible || o.isInstancedMesh) return;
      let vis = true;
      for (let p = o.parent; p && p !== group.parent; p = p.parent) if (p.visible === false) { vis = false; break; }
      if (!vis) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || mat.visible === false || (mat.transparent && mat.opacity < 0.5)) return;
      const n = g.index ? g.index.count : g.attributes.position.count;
      if (n > 40000) return;
      parts.push({ o: o, g: g, mat: mat, n: n });
      verts += n;
    });
    if (!verts) return false;
    let b = RB.list[RB.list.length - 1];
    if (!b || b.n + verts > RB.cap) b = rbNew();
    if (verts > RB.cap) return false;
    const P = b.mesh.geometry.attributes.position, N = b.mesh.geometry.attributes.normal, C = b.mesh.geometry.attributes.color;
    const start = b.n;
    for (let pi = 0; pi < parts.length; pi++) {
      const it = parts[pi], o = it.o, g = it.g;
      const pos = g.attributes.position, nor = g.attributes.normal, vc = g.attributes.color;
      const idx = g.index;
      _bv.nm.getNormalMatrix(o.matrixWorld);
      const mc = it.mat.color || _bv.c.setRGB(0.5, 0.5, 0.5);
      const useVC = !!(vc && it.mat.vertexColors);
      for (let k = 0; k < it.n; k++) {
        const vi = idx ? idx.getX(k) : k;
        _bv.v.fromBufferAttribute(pos, vi);
        if (o.isSkinnedMesh && o.boneTransform) { o.boneTransform(vi, _bv.v); }
        _bv.v.applyMatrix4(o.matrixWorld);
        if (nor) _bv.n.fromBufferAttribute(nor, vi).applyMatrix3(_bv.nm).normalize(); else _bv.n.set(0, 1, 0);
        const w = b.n;
        P.array[w * 3] = _bv.v.x; P.array[w * 3 + 1] = _bv.v.y; P.array[w * 3 + 2] = _bv.v.z;
        N.array[w * 3] = _bv.n.x; N.array[w * 3 + 1] = _bv.n.y; N.array[w * 3 + 2] = _bv.n.z;
        let r = mc.r, gg = mc.g, bb = mc.b;
        if (useVC) { r *= vc.getX(vi); gg *= vc.getY(vi); bb *= vc.getZ(vi); }
        if (it.mat.map && !useVC) { r *= 0.85; gg *= 0.85; bb *= 0.85; }
        C.array[w * 3] = r; C.array[w * 3 + 1] = gg; C.array[w * 3 + 2] = bb;
        b.n++;
      }
    }
    [P, N, C].forEach(function (A) {
      A.updateRange.offset = start * 3; A.updateRange.count = (b.n - start) * 3; A.needsUpdate = true;
    });
    b.mesh.geometry.setDrawRange(0, b.n);
    G.kept++; G.keptVerts += verts;
    return true;
  }

  /* ============================================================ BLAST */
  // studio.boom scale: radius 2.5-34 m, power 0.5-4. ordnance.blast scale:
  // radius 26-1100, power 110-1800. One crater rule for both, in metres.
  function blast(x, y, z, R, power, src) {
    if (!G.ctx) return;
    const ord = src === "ordnance";
    let cr = ord ? 0.085 * R : 0.085 * R * Math.sqrt(Math.max(0.1, power));
    cr = Math.min(42, cr);
    const g0 = G.ground(x, z);
    const onGround = y - g0 < Math.max(3, cr * 1.5);
    const S = surf();
    if (G.gl) spray(x, Math.max(y, g0), z, Math.max(1.5, cr * 2.2), ord ? 2.5 : power);
    if (onGround) {
      if (G.soft && cr >= 0.45) {
        crater(x, z, cr, cr * (G.surface === "snow" ? 0.42 : G.surface === "sand" ? 0.32 : 0.36));
        scorch(x, z, cr * (G.surface === "snow" ? 1.6 : 1.25));
      } else scorch(x, z, Math.max(0.8, cr * 1.4));
    }
    if (CBZ.battleCover) {
      const coverR = ord ? R * 0.22 : R * 0.5;
      const pw = ord ? Math.min(40, power / 30) : power;
      CBZ.battleCover.damage(x, z, coverR, pw);
    }
    void S;
  }

  /* ============================================================ BEGIN */
  let wrapped = false;
  function wrapBlasts() {
    if (wrapped) return;
    wrapped = true;
    const st = CBZ.studio;
    if (st && st.boom) {
      const boom0 = st.boom;
      st.boom = function (pos, opts) {
        const r = boom0.apply(this, arguments);
        try { if (pos) blast(pos.x, pos.y || 0, pos.z, (opts && opts.radius) || 18, (opts && opts.power) || 1, "boom"); } catch (e) { console.warn("[ground] boom", e); }
        return r;
      };
    }
    const O = CBZ.ordnance;
    if (O && O.blast) {
      const b0 = O.blast;
      O.blast = function (x, y, z, radius, power) {
        const r = b0.apply(this, arguments);
        try { blast(x, y, z, radius || 46, power || 190, "ordnance"); } catch (e) { console.warn("[ground] ordnance", e); }
        return r;
      };
    }
  }
  function begin(ctx) {
    G.ctx = ctx;
    G.surface = ctx.surface || "sand";
    G.soft = ctx.soft !== false;
    G.base = ctx.groundAt;
    G.feats.length = 0; G.grid.clear(); G.craters.length = 0;
    U.uCrN.value = 0;
    G.gl = !!(CBZ.micro && CBZ.micro.renderer) && typeof document !== "undefined";
    const base = ctx.groundAt;
    G.ground = function (x, z) { return base(x, z) + deform(x, z); };
    if (CBZ.battleCover) { CBZ.battleCover.reset(); CBZ.battleCover.ground(G.ground); }
    return G.ground;
  }
  // after the field is up: the decal layer, the spray pool, the hooks
  function arm() {
    if (G.gl && !MK.mesh) { try { marksInit(); } catch (e) { console.warn("[ground] marks", e); } }
    if (G.gl && !SP.pts) { try { sprayInit(); } catch (e) { console.warn("[ground] spray", e); } }
    wrapBlasts();
  }
  let lastSim = 0;
  function frame() {
    if (!G.ctx) return;
    const t = typeof simT === "number" ? simT : 0;
    const dt = t - lastSim; lastSim = t;
    if (SP.pts) {
      SP.t = t;
      SP.pts.material.uniforms.uTime.value = t;
      const R = CBZ.micro && CBZ.micro.renderer;
      if (R) { const h = R.domElement.height || 800; SP.pts.material.uniforms.uScale.value = h * 0.5 / Math.tan((CBZ.camera ? CBZ.camera.fov : 60) * Math.PI / 360); }
    }
    if (G.blow) {
      G.blow.material.uniforms.uTime.value = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
      if (SP.pts) G.blow.material.uniforms.uScale.value = SP.pts.material.uniforms.uScale.value;
    }
    if (dt > 0 && dt < 1) feet(dt);
    marksFlush();
  }
  CBZ.npcwar.onBoot(function () {
    if (CBZ.micro && CBZ.micro.onFrame) CBZ.micro.onFrame(function () { try { frame(); } catch (e) { if (!G._warned) { G._warned = true; console.warn("[ground] frame", e); } } });
  });

  return {
    begin: begin, arm: arm, deform: deform, berm: berm, pit: pit, drift: drift,
    crater: crater, scorch: scorch, blast: blast, mark: mark, TILE: TILE,
    patchTerrain: patchTerrain, blowing: blowing, keepBody: keepBody,
    craters: function () { return G.craters; },
    surface: function () { return G.surface; },
    stats: function () {
      return { surface: G.surface, soft: G.soft, earthworks: G.feats.length - G.craters.length, craters: G.craters.length,
        marks: G.marksN, sprays: G.sprays, remains: G.kept, remainVerts: G.keptVerts, remainBatches: RB.list.length };
    },
  };
})();
