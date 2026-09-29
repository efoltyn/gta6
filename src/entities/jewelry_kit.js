/* ============================================================
   entities/jewelry_kit.js — REAL JEWELRY. One kit, every body, every case.

   OWNER: "jewelry … as if it was drawn by a little kid" — the chain was two
   straight box strands meeting in a V in front of the chest, the cross two
   boxes, a diamond an 8-face octahedron, earrings sat 16 cm in front of the
   ear lobe (on the cheek), the grill was a bar glued across closed lips and
   the tennis bracelet's band kind ("bandFine") did not exist, so it drew a
   5 cm speck. All of it Lambert with a self-glow standing in for metal.

   What a piece is made of now:
     · METAL is metal: MeshStandardMaterial, metalness 1, real F0 base colours
       (18k gold, rhodium white gold, platinum, sterling, steel, rose), a
       polished roughness, and its OWN street environment (sky,
       sun, a skyline of lit windows, kerb, asphalt) so gold has something to
       reflect on every quality tier. core/gfx.js's envFollowsSky patch dims
       that reflection at night like every other PBR surface.
     · A DIAMOND is a round brilliant: table, star, bezel and upper-girdle
       facets on the crown, a girdle band, lower-girdle and pavilion mains to a
       culet (112 flat facets), mirror-finished, with FIRE: three slow-moving
       virtual lamps in view space, dispersed into R/G/B lobes, flash off
       whichever facet lines up, so a stone twinkles as you or it move.
     · PAVÉ (an iced chain, a bust-down, a grill) perturbs the surface normal
       per ~1 mm cell before lighting: the env and the sun see a field of
       micro-stones, not a smooth white bar.
     · A CHAIN is links. Each link is a swept stadium torus; curb links lie
       flat and alternate their tilt, a Miami Cuban is fat and tight, a
       rivière is a line of graduated brilliants in collets. The whole chain
       is draped over THIS body: round the collar at the base of the neck
       (lifted onto the trapezius at the nape), off the sides of the neck and
       down the upper chest to the pendant, laid on the real torso surface
       (rig.torsoFrontZ / torsoShape) with the chain's own thickness of
       clearance, bridged over dips like a chain under its own tension. One
       merged geometry per (piece, body shape), cached and ref-counted.
     · A PENDANT hangs from a bail at the bottom of the chain, rests on the
       chest along the chord below the bail (never into it), and SWINGS: a
       damped pendulum driven by the body's own tilt and world acceleration —
       lean forward and it hangs off the chest, stop short and it sways.
     · LOD without a look drop: past ~5 m a 7 mm link is under a pixel, so
       the chain swaps to a swept tube along the same path in the same
       material. Up close it is always the links.

   UNITS. Everything is authored in METRES and converted at the mount:
   body/neck anchors are rig units (1 u = humanScale m, 0.70 on the shipped
   rig), the ring rides the hand mesh (metres), the bracelet the forearm
   frame (hand scale = u per metre). No per-body table anywhere.

   INSTANCING. Every mesh built here is marked userData.pedInstSkip, which
   entities/pedinstance.js honours: a draped chain is per body shape, and
   letting it claim an instance pool would push whole crowds out of
   instancing (the pool table is the scarce thing). Jewelry draws itself —
   a handful of calls for the few bodies within dressing range.

   API (CBZ.jewel):
     mat(name)                      shared PBR finish (gold, white, platinum,
                                    silver, steel, steelBrushed, rose, ice,
                                    diamond, black)
     necklace(rig, style)           -> Group on rig.body (styles: curb, cuban,
                                    riviera, cable)
     ring(parentHand, finger, style)-> Group on the hand (solitaire, rock, pinky)
     earrings(rig, style)           -> [Group, Group] on rig.neck (hoop, stud)
     grill(rig)                     -> meshes riding the teeth (shown when the
                                    mouth opens, like the teeth themselves)
     tiara(rig)                     -> Group on rig.neck
     bracelet(anchor, place, style) -> Group on a measured wrist (tennis)
     display(kind)                  -> a shop piece (city/jewelry.js)
     release(obj)                   -> detach + drop cache refs
   Pure maths for node checks: CBZ.jewel._test.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  if (!THREE) return;
  if (CBZ.jewel && CBZ.jewel.version) return;

  const PI = Math.PI, TAU = PI * 2;
  const LOD_NEAR = 5.0;          // metres: links up to here, the swept tube past it
  const SWING_D = 22;            // metres: pendants swing within this of the camera

  function nowS() { return (root.performance && root.performance.now ? root.performance.now() : Date.now()) / 1000; }

  /* ================================================================ finishes
     Base colours are LINEAR F0 (r128 has no colour management: a hex here is
     used as-is and sRGB-encoded on output), from measured spectral
     reflectance: gold (1.00, .77, .34) toned to 18k, rhodium, platinum
     (.67, .64, .59), silver (.97, .96, .92), iron/steel, copper-gold rose. */
  const FINISH = {
    gold:         { color: 0xf5c46e, rough: 0.19, env: 1.30 },
    goldSatin:    { color: 0xeab766, rough: 0.34, env: 1.10 },
    rose:         { color: 0xf2a88a, rough: 0.21, env: 1.25 },
    white:        { color: 0xdedcd6, rough: 0.15, env: 1.35 },   // rhodium-plated white gold
    platinum:     { color: 0xcfc9bf, rough: 0.20, env: 1.30 },
    silver:       { color: 0xf3f0e8, rough: 0.23, env: 1.20 },
    steel:        { color: 0xb2b4b8, rough: 0.22, env: 1.15 },
    steelBrushed: { color: 0xa4a6aa, rough: 0.40, env: 1.00 },
    black:        { color: 0x1a1b1e, rough: 0.30, env: 0.90 },   // PVD / ceramic
    ice:          { color: 0xe9edf2, rough: 0.10, env: 1.65, sparkle: "pave" },
    iceGold:      { color: 0xf6d18a, rough: 0.12, env: 1.55, sparkle: "pave" },
    diamond:      { color: 0xf7faff, rough: 0.02, env: 2.20, sparkle: "gem" },
  };
  // the fire uniform reads the clock itself (WebGLUniforms re-reads .value on
  // every upload), so no system has to remember to tick it
  const U_TIME = { get value() { return nowS() % 3600; } };
  const _mats = Object.create(null);
  const _allMats = [];
  function sparkleCompile(kind) {
    return function (shader) {
      shader.uniforms.cbzJTime = U_TIME;
      shader.vertexShader = "varying vec3 vCbzJ;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\n\tvCbzJ = position;");
      const pave = kind === "pave";
      const head = [
        "varying vec3 vCbzJ;",
        "uniform float cbzJTime;",
        "vec3 cbzJHash(vec3 c) {",
        "  return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);",
        "}",
      ].join("\n");
      let frag = head + "\n" + shader.fragmentShader;
      // PAVÉ: each ~1 mm cell is its own tilted stone before ANY lighting runs
      if (pave) {
        frag = frag.replace("#include <normal_fragment_maps>", [
          "#include <normal_fragment_maps>",
          "\t{",
          "\t\tvec3 cbzH = cbzJHash(floor(vCbzJ * 820.0));",
          "\t\tnormal = normalize(normal + (cbzH - 0.5) * 1.35);",
          "\t}",
        ].join("\n"));
      }
      // FIRE: virtual lamps in view space, a hair apart per colour (dispersion)
      frag = frag.replace("#include <emissivemap_fragment>", [
        "#include <emissivemap_fragment>",
        "\t{",
        "\t\tvec3 cbzV = normalize(vViewPosition);",
        "\t\tvec3 cbzR = reflect(-cbzV, normal);",
        "\t\tvec3 cbzS = cbzJHash(floor(vCbzJ * " + (pave ? "260.0" : "140.0") + ")) - 0.5;",
        "\t\tfloat cbzT = cbzJTime;",
        "\t\tvec3 cbzF = vec3(0.0);",
        "\t\tfor (int i = 0; i < 3; i++) {",
        "\t\t\tfloat fi = float(i);",
        "\t\t\tvec3 L = normalize(vec3(sin(cbzT * 0.53 + fi * 2.09) * 0.85, 0.45 + 0.4 * sin(cbzT * 0.31 + fi * 1.3), 0.7 + 0.3 * cos(cbzT * 0.47 + fi * 2.09)) + cbzS * 0.5);",
        "\t\t\tvec3 d = normalize(cross(L, vec3(0.0, 1.0, 0.0)) + 1e-4) * 0.018;",
        "\t\t\tcbzF.r += pow(max(dot(cbzR, normalize(L - d)), 0.0), " + (pave ? "380.0" : "720.0") + ");",
        "\t\t\tcbzF.g += pow(max(dot(cbzR, L), 0.0), " + (pave ? "380.0" : "720.0") + ");",
        "\t\t\tcbzF.b += pow(max(dot(cbzR, normalize(L + d)), 0.0), " + (pave ? "380.0" : "720.0") + ");",
        "\t\t}",
        "\t\tfloat cbzSky = 1.0;",
        "\t\t#if NUM_HEMI_LIGHTS > 0",
        "\t\t\tcbzSky = clamp(dot(hemisphereLights[0].skyColor, vec3(0.2126, 0.7152, 0.0722)) / 0.45, 0.18, 1.0);",
        "\t\t#endif",
        "\t\ttotalEmissiveRadiance += cbzF * " + (pave ? "1.4" : "2.6") + " * cbzSky;",
        "\t}",
      ].join("\n"));
      shader.fragmentShader = frag;
    };
  }
  function mat(name) {
    const key = FINISH[name] ? name : "gold";
    let m = _mats[key];
    if (m) return m;
    const F = FINISH[key];
    m = new THREE.MeshStandardMaterial({
      color: F.color, metalness: 1.0, roughness: F.rough,
      envMap: jewelEnv(), envMapIntensity: F.env,
    });
    if (F.sparkle === "gem") m.flatShading = true;
    if (F.sparkle) {
      m.onBeforeCompile = sparkleCompile(F.sparkle);
      m.customProgramCacheKey = function () { return "cbzJewel|" + F.sparkle; };
    }
    m._shared = true;
    m.name = "jewel-" + key;
    _mats[key] = m;
    _allMats.push(m);
    return m;
  }
  // a finish with a z-bias so it can lie exactly over another surface (grill caps on teeth)
  const _biased = Object.create(null);
  function matBiased(name) {
    if (_biased[name]) return _biased[name];
    const m = mat(name).clone();
    m.onBeforeCompile = mat(name).onBeforeCompile;
    m.customProgramCacheKey = mat(name).customProgramCacheKey;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
    m._shared = true;
    _allMats.push(m);
    return (_biased[name] = m);
  }

  /* ================================================================ environment
     The world's PMREM (world/carfx.js) is a 4-stop gradient with one soft
     sun: fine for paint, dead for a polished facet, and absent on the low
     tiers. Jewelry carries its own: the same street (vehicleEnvCanvas when
     it exists) plus the hard little lamps a stone actually catches — lit
     windows, a shop sign, the sun's core. It stays a CANVAS equirect (each
     renderer converts it to a mipmapped cube itself): the portrait card, the
     mugshot and the item icons draw these same materials through their own
     WebGLRenderers, and a PMREM target baked on the main one is an unbound
     (black) texture in any other context — gold would go black there. */
  let _env = null, _envTried = 0;
  function envCanvas() {
    const W = 512, H = 256;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    let base = null;
    try { base = CBZ.vehicleEnvCanvas ? CBZ.vehicleEnvCanvas() : null; } catch (e) { base = null; }
    if (base) g.drawImage(base, 0, 0, W, H);
    else {
      let gr = g.createLinearGradient(0, 0, 0, H * 0.5);
      gr.addColorStop(0, "#6f9fd6"); gr.addColorStop(1, "#e8eef4");
      g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.5);
      gr = g.createLinearGradient(0, H * 0.5, 0, H);
      gr.addColorStop(0, "#56524d"); gr.addColorStop(1, "#141416");
      g.fillStyle = gr; g.fillRect(0, H * 0.5, W, H * 0.5);
    }
    const hz = H * 0.5;
    const blob = function (x, y, rx, ry, col, a) {
      const gg = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gg.addColorStop(0, col); gg.addColorStop(0.35, col); gg.addColorStop(1, "rgba(255,255,255,0)");
      g.save(); g.globalAlpha = a; g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      g.fillStyle = gg; g.beginPath(); g.arc(0, 0, Math.max(rx, ry), 0, TAU); g.fill(); g.restore();
    };
    // a softbox sky strip overhead (the brightest broad thing a ring sees)
    blob(W * 0.62, H * 0.08, 70, 14, "#ffffff", 0.75);
    blob(W * 0.20, H * 0.18, 10, 10, "#ffffff", 1.0);             // the sun's core
    // lamps: lit windows / signs along the skyline, deterministic
    let s = 11;
    const rnd = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = hz - 4 - rnd() * 34, w = 2 + rnd() * 5, h = 2 + rnd() * 4;
      const warm = rnd() < 0.6;
      g.fillStyle = warm ? "#fff1d2" : "#e8f3ff";
      g.fillRect(x, y, w, h);
    }
    // the kerb line + a pale pavement band just under the horizon
    g.fillStyle = "rgba(210,206,198,0.9)"; g.fillRect(0, hz + 1, W, 2);
    return c;
  }
  function jewelEnv() {
    if (_env) return _env;
    if (typeof document === "undefined" || !THREE.CanvasTexture || _envTried > 3) return null;
    _envTried++;
    try {
      const tex = new THREE.CanvasTexture(envCanvas());
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
      tex.needsUpdate = true;
      _env = tex;
      for (let i = 0; i < _allMats.length; i++) { _allMats[i].envMap = _env; _allMats[i].needsUpdate = true; }
    } catch (e) { _env = null; }
    return _env;
  }

  /* ================================================================ geometry kit
     Accumulate positions/normals/indices, bake to one BufferGeometry. A
     transform is { o, x, y, z, s }: origin, orthonormal basis, uniform scale. */
  function Geo() { this.p = []; this.n = []; this.i = []; this.v = 0; }
  Geo.prototype.vert = function (x, y, z, nx, ny, nz) { this.p.push(x, y, z); this.n.push(nx, ny, nz); return this.v++; };
  Geo.prototype.tri = function (a, b, c) { this.i.push(a, b, c); };
  Geo.prototype.add = function (src, T) {
    const base = this.v, P = src.p, N = src.n;
    for (let k = 0; k < P.length; k += 3) {
      const px = P[k], py = P[k + 1], pz = P[k + 2], nx = N[k], ny = N[k + 1], nz = N[k + 2];
      if (T) {
        const s = T.s == null ? 1 : T.s, X = T.x, Y = T.y, Z = T.z, O = T.o;
        this.p.push(O[0] + s * (X[0] * px + Y[0] * py + Z[0] * pz), O[1] + s * (X[1] * px + Y[1] * py + Z[1] * pz), O[2] + s * (X[2] * px + Y[2] * py + Z[2] * pz));
        this.n.push(X[0] * nx + Y[0] * ny + Z[0] * nz, X[1] * nx + Y[1] * ny + Z[1] * nz, X[2] * nx + Y[2] * ny + Z[2] * nz);
      } else { this.p.push(px, py, pz); this.n.push(nx, ny, nz); }
    }
    const I = src.i;
    for (let k = 0; k < I.length; k++) this.i.push(I[k] + base);
    this.v += P.length / 3;
    return this;
  };
  Geo.prototype.build = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setIndex(this.v > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.i), 1) : new THREE.BufferAttribute(new Uint16Array(this.i), 1));
    g.computeBoundingSphere();
    return g;
  };
  Geo.prototype.empty = function () { return this.v === 0; };
  function T(o, x, y, z, s) { return { o: o, x: x, y: y, z: z, s: s == null ? 1 : s }; }

  // small vector helpers on arrays
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vlen = (a) => Math.sqrt(vdot(a, a));
  const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // rotate basis vectors (u, v) by angle a in their plane
  const vrot = (u, v, a) => { const c = Math.cos(a), s = Math.sin(a); return [vadd(vmul(u, c), vmul(v, s)), vadd(vmul(u, -s), vmul(v, c))]; };

  /* ---- a flat-faceted solid from triangles: each triangle its own 3 verts,
     its face normal pointing away from `ctr` (every solid here is convex). */
  function facets(tris, ctr) {
    const out = { p: [], n: [], i: [] };
    let v = 0;
    for (let t = 0; t < tris.length; t++) {
      let a = tris[t][0], b = tris[t][1], c = tris[t][2];
      let n = vcross(vsub(b, a), vsub(c, a));
      if (vlen(n) < 1e-12) continue;
      const m = vmul(vadd(vadd(a, b), c), 1 / 3);
      if (vdot(n, vsub(m, ctr)) < 0) { const q = b; b = c; c = q; n = vmul(n, -1); }
      n = vnorm(n);
      out.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      out.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
      out.i.push(v, v + 1, v + 2); v += 3;
    }
    return out;
  }

  /* ---- THE ROUND BRILLIANT, girdle radius 1, table up (+Y).
     Tolkowsky-ish proportions: table 56%, crown 16% of diameter, pavilion
     43%. 8 main directions; 112 facets. */
  let _brill = null;
  function brilliant() {
    if (_brill) return _brill;
    const hc = 0.32, tr = 0.56, gT = 0.018, gB = -0.018, pd = 0.86;
    const at = (a, r, y) => [r * Math.cos(a), y, r * Math.sin(a)];
    const crownY = (r) => gT + (hc - gT) * (1 - r) / (1 - tr);
    const Tv = [], Sv = [], G = [], B = [], L = [];
    for (let k = 0; k < 8; k++) {
      Tv.push(at(k * PI / 4, tr, hc));
      Sv.push(at((k + 0.5) * PI / 4, 0.80, crownY(0.80) + 0.012));       // stars stand a hair proud: the facets read
      L.push(at(k * PI / 4, 0.44, -pd + (gB + pd) * 0.44 - 0.01));
    }
    for (let j = 0; j < 16; j++) { G.push(at(j * PI / 8, 1, gT)); B.push(at(j * PI / 8, 1, gB)); }
    const C = [0, hc, 0], K = [0, -pd, 0];
    const tris = [];
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8, km = (k + 7) % 8, g0 = G[2 * k], g1 = G[2 * k + 1], g2 = G[(2 * k + 2) % 16];
      tris.push([C, Tv[k], Tv[k1]]);                                         // table
      tris.push([Tv[k], Tv[k1], Sv[k]]);                                     // star
      tris.push([Tv[k], Sv[km], g0], [Tv[k], g0, Sv[k]]);                    // bezel kite
      tris.push([Sv[k], g0, g1], [Sv[k], g1, g2]);                           // upper girdle
      const b0 = B[2 * k], b1 = B[2 * k + 1], b2 = B[(2 * k + 2) % 16];
      tris.push([b0, b1, L[k]], [b1, b2, L[k1]], [b1, L[k1], L[k]]);         // lower girdle
      tris.push([L[k], L[k1], K]);                                           // pavilion main
    }
    for (let j = 0; j < 16; j++) { const j1 = (j + 1) % 16; tris.push([G[j], G[j1], B[j1]], [G[j], B[j1], B[j]]); }
    return (_brill = facets(tris, [0, -0.2, 0]));
  }
  /* A MELEE stone (pavé, a tennis line, a rim of small stones): the same
     proportions cut with 8 crown + 8 pavilion facets and a table (32). Under
     ~2.5 mm a full brilliant's 112 facets are sub-pixel from any distance
     the game is played at; the flash is what reads, and this still flashes. */
  let _lite = null;
  function brilliantLite() {
    if (_lite) return _lite;
    const hc = 0.32, tr = 0.56, pd = 0.80;
    const at = (a, r, y) => [r * Math.cos(a), y, r * Math.sin(a)];
    const Tv = [], G = [];
    for (let k = 0; k < 8; k++) { Tv.push(at((k + 0.5) * PI / 4, tr, hc)); G.push(at(k * PI / 4, 1, 0)); }
    const C = [0, hc, 0], K = [0, -pd, 0], tris = [];
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8;
      tris.push([C, Tv[k], Tv[k1]], [Tv[k], G[k1], Tv[k1]], [Tv[k], G[k], G[k1]], [G[k], G[k1], K]);
    }
    return (_lite = facets(tris, [0, -0.2, 0]));
  }
  // a stone laid with its table facing `up` at centre `c`, girdle radius r
  // (real metres AFTER any transform: melee below 1.3 mm radius takes the lite cut)
  function addStone(geo, c, up, r, twist, lite) {
    const Y = vnorm(up);
    let X = Math.abs(Y[1]) < 0.9 ? vnorm(vcross([0, 1, 0], Y)) : vnorm(vcross([1, 0, 0], Y));
    let Z = vcross(X, Y);
    if (twist) { const q = vrot(X, Z, twist); X = q[0]; Z = q[1]; }
    geo.add(lite ? brilliantLite() : brilliant(), T(c, X, Y, Z, r));
  }

  /* ---- a swept tube along a polyline (open or closed), elliptical section:
     radius r across (`side`), r*fz along the reference normal. `nrm` = the
     per-point reference normal (else a parallel-transported frame). */
  function sweep(geo, pts, r, nT, closed, nrm, fz) {
    const n = pts.length;
    if (n < 2) return;
    fz = fz || 1;
    const tan = [];
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      tan.push(vnorm(vsub(b, a)));
    }
    let ref = nrm ? null : (Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const base = geo.v;
    for (let i = 0; i < n; i++) {
      const t = tan[i];
      let N0 = nrm ? nrm[i] : ref;
      N0 = vnorm(vsub(N0, vmul(t, vdot(N0, t))));
      if (!nrm) ref = N0;
      const Bv = vcross(t, N0);
      for (let j = 0; j < nT; j++) {
        const a = j / nT * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const p = vadd(pts[i], vadd(vmul(Bv, r * ca), vmul(N0, r * fz * sa)));
        const nn = vnorm(vadd(vmul(Bv, ca * fz), vmul(N0, sa)));
        geo.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2]);
      }
    }
    const rings = closed ? n : n - 1;
    for (let i = 0; i < rings; i++) {
      const i1 = (i + 1) % n;
      for (let j = 0; j < nT; j++) {
        const j1 = (j + 1) % nT;
        const a = base + i * nT + j, b = base + i * nT + j1, c = base + i1 * nT + j1, d = base + i1 * nT + j;
        geo.tri(a, c, b); geo.tri(a, d, c);
      }
    }
  }
  // a torus of centreline radius R, tube r, in the plane (u, v) about centre c
  function torusInto(geo, c, u, v, R, r, nR, nT, fz, a0, a1) {
    const pts = [], nrm = [], full = a1 == null;
    const A0 = a0 || 0, A1 = full ? TAU : a1, N = full ? nR : nR + 1;
    const w = vcross(u, v);
    for (let k = 0; k < N; k++) {
      const a = A0 + (A1 - A0) * k / (full ? nR : nR);
      pts.push(vadd(c, vadd(vmul(u, R * Math.cos(a)), vmul(v, R * Math.sin(a)))));
      nrm.push(w);
    }
    sweep(geo, pts, r, nT, full, nrm, fz);
  }
  // a closed cylinder from p0 to p1, radius r (prongs, collet walls)
  function rod(geo, p0, p1, r, seg, cap) {
    const ax = vsub(p1, p0), L = vlen(ax);
    if (L < 1e-9) return;
    const Y = vmul(ax, 1 / L);
    const X = Math.abs(Y[1]) < 0.9 ? vnorm(vcross([0, 1, 0], Y)) : vnorm(vcross([1, 0, 0], Y));
    const Z = vcross(X, Y);
    const base = geo.v;
    for (let e = 0; e < 2; e++) for (let j = 0; j < seg; j++) {
      const a = j / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const nn = vadd(vmul(X, ca), vmul(Z, sa));
      const p = vadd(e ? p1 : p0, vmul(nn, r));
      geo.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2]);
    }
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      geo.tri(base + j, base + seg + j1, base + j1); geo.tri(base + j, base + seg + j, base + seg + j1);
    }
    if (cap) {                                                  // a rounded tip at p1 (a prong's bead)
      const tip = vadd(p1, vmul(Y, r * 0.9)), t = geo.vert(tip[0], tip[1], tip[2], Y[0], Y[1], Y[2]);
      for (let j = 0; j < seg; j++) geo.tri(base + seg + j, t, base + seg + (j + 1) % seg);
    }
  }
  // lathe a (r, y) profile round +Y, normals from the profile
  function latheInto(geo, T0, prof, seg) {
    const src = { p: [], n: [], i: [] };
    const np = prof.length;
    for (let k = 0; k < np; k++) {
      const a = prof[Math.max(0, k - 1)], b = prof[Math.min(np - 1, k + 1)];
      const tr = b[0] - a[0], ty = b[1] - a[1];
      let nr = ty, ny = -tr;                                    // outward for a profile walked bottom-in → top-out
      const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
      for (let j = 0; j <= seg; j++) {
        const t = j / seg * TAU, c = Math.cos(t), s = Math.sin(t);
        src.p.push(prof[k][0] * c, prof[k][1], prof[k][0] * s);
        src.n.push(nr * c, ny, nr * s);
      }
    }
    for (let k = 0; k < np - 1; k++) for (let j = 0; j < seg; j++) {
      const a = k * (seg + 1) + j, b = a + 1, c = a + seg + 2, d = a + seg + 1;
      src.i.push(a, c, b, a, d, c);
    }
    geo.add(src, T0);
  }

  /* ---- ONE CHAIN LINK: a stadium torus in its own frame (X along the chain,
     Y across in the link plane, Z the link-plane normal). Lo/Wo outer length
     and width, r wire radius, fz flattens the wire (a curb's cut faces). */
  const _links = new Map();
  function linkTemplate(Lo, Wo, r, fz, nC, nT) {
    const key = [Lo, Wo, r, fz, nC, nT].join("|");
    if (_links.has(key)) return _links.get(key);
    const Lc = Lo - 2 * r, Wc = Wo - 2 * r, rc = Wc / 2, sx = Math.max(0, Lc / 2 - rc);
    const per = 2 * PI * rc + 4 * sx;
    const src = { p: [], n: [], i: [] };
    for (let k = 0; k < nC; k++) {
      let t = k / nC * per, cx, cy, nx, ny;
      const arc = PI * rc;
      if (t < arc) { const a = -PI / 2 + t / rc; cx = sx + rc * Math.cos(a); cy = rc * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
      else if ((t -= arc) < 2 * sx) { cx = sx - t; cy = rc; nx = 0; ny = 1; }
      else if ((t -= 2 * sx) < arc) { const a = PI / 2 + t / rc; cx = -sx + rc * Math.cos(a); cy = rc * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
      else { t -= arc; cx = -sx + t; cy = -rc; nx = 0; ny = -1; }
      for (let j = 0; j < nT; j++) {
        const a = j / nT * TAU, ca = Math.cos(a), sa = Math.sin(a);
        src.p.push(cx + nx * r * ca, cy + ny * r * ca, r * fz * sa);
        const qx = nx * ca * fz, qy = ny * ca * fz, qz = sa, ql = Math.hypot(qx, qy, qz) || 1;
        src.n.push(qx / ql, qy / ql, qz / ql);
      }
    }
    for (let k = 0; k < nC; k++) {
      const k1 = (k + 1) % nC;
      for (let j = 0; j < nT; j++) {
        const j1 = (j + 1) % nT, a = k * nT + j, b = k * nT + j1, c = k1 * nT + j1, d = k1 * nT + j;
        src.i.push(a, c, b, a, d, c);
      }
    }
    _links.set(key, src);
    return src;
  }

  /* ================================================================ styles
     Real sizes, metres. half = the chain's half-thickness off the surface. */
  const CHAIN = {
    // 7 mm curb (the everyday gold chain), polished flat-cut links
    curb:    { kind: "links", Lo: 0.0100, Wo: 0.0072, r: 0.00135, fz: 0.62, tilt: 0.36, pitchK: 1.55, flat: true,  finish: "gold",  half: 0.0012, drop: 0.150, pendant: "cross", seg: [12, 5] },
    // 13 mm Miami Cuban, iced
    cuban:   { kind: "links", Lo: 0.0160, Wo: 0.0130, r: 0.0027, fz: 0.70, tilt: 0.42, pitchK: 1.35, flat: true,  finish: "ice",   half: 0.0024, drop: 0.125, pendant: "medallion" },
    // fine 2 mm cable chain
    cable:   { kind: "links", Lo: 0.0036, Wo: 0.0024, r: 0.00042, fz: 1.0, tilt: 0,    pitchK: 2.0,  flat: false, finish: "white", half: 0.0006, drop: 0.110, pendant: "solitaire", seg: [8, 4] },
    // the rivière: graduated brilliants in collets, a drop stone at the front
    riviera: { kind: "stones", dMin: 0.0026, dMax: 0.0052, gap: 0.00035, finish: "white", half: 0.0017, drop: 0.030, pendant: "drop" },
  };

  /* THE BODY IS STYLISED LARGER THAN LIFE (an adult's torso is 0.92 u =
     64 cm across, the neck column 20 cm): a chain sized to a real 45 cm
     chest reads as thread on this one. Body-worn pieces take this factor;
     the hand and wrist are real-scale (fphands) and take none. */
  const BODY_K = 1.2;
  function humanScale(rig) {
    const hs = rig && rig.group && rig.group.userData ? rig.group.userData.humanScale : 0;
    return hs > 0 ? hs : (CBZ.HUMAN_SCALE > 0 ? CBZ.HUMAN_SCALE : 0.70);
  }

  /* ================================================================ THE DRAPE
     Where a chain of `st` lies on this body, body-local rig units. Returns a
     closed loop (pts + outward normals) starting at the bottom centre, and
     the bail (the lowest front point) with its rest frame for a pendant. */
  function superOut(R, ox, oz, dx, dz) {
    // distance from (ox, oz) along unit (dx, dz) to where the section R ends
    const inside = function (x, z) {
      const zz = z - R.zc, lim = zz >= 0 ? R.zf : R.zb;
      return Math.pow(Math.abs(x / R.a), R.n) + Math.pow(Math.abs(zz / lim), R.n) < 1;
    };
    if (!inside(ox, oz)) return 0;
    let lo = 0, hi = 0.05;
    while (inside(ox + dx * hi, oz + dz * hi) && hi < 2) hi *= 2;
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (inside(ox + dx * m, oz + dz * m)) lo = m; else hi = m; }
    return hi;
  }
  function drape(rig, st) {
    const S = rig.torsoShape;
    const vs = S.vs > 0 ? S.vs : 1, U = 1 / humanScale(rig);
    const clr = (st.half * BODY_K + 0.0020) * U;
    const tb = S.tb != null ? S.tb : 0.05 * vs, tf = S.tf || 0;
    const rx0 = S.nRx + 0.022 * vs, rz0 = S.nRz + 0.022 * vs, nZc = S.nZc || 0;
    const yc0 = S.yN - 0.012 * vs;                                  // the ring the chain rests on
    const notch = S.yN - tf - 0.03 * vs;
    const yB = notch - st.drop * BODY_K * U;
    const Rsec = S.at(yc0);
    // the collar band, clothed dims (the bigger of clothed / bare): scale by ring height
    const collarRows = [[S.yN - 0.05 * vs, 1.07], [S.yN - 0.012 * vs, 1.02], [S.yN + 0.019 * vs, 1.0], [S.yN + 0.038 * vs, 0.99]];
    const collarM = function (y) {
      if (y < collarRows[0][0] || y > collarRows[3][0]) return 0;
      for (let i = 0; i < 3; i++) if (y <= collarRows[i + 1][0]) {
        const f = (y - collarRows[i][0]) / (collarRows[i + 1][0] - collarRows[i][0]);
        return collarRows[i][1] + (collarRows[i + 1][1] - collarRows[i][1]) * f;
      }
      return 0;
    };
    // ---- the back loop: phi 0 (+x side) → pi/2 (nape) → pi (-x side)
    const backR = function (phi) {
      const dx = Math.cos(phi), dz = -Math.sin(phi);
      const m = 1.02;
      const dc = 1 / Math.sqrt((dx / (m * rx0)) * (dx / (m * rx0)) + (dz / (m * rz0)) * (dz / (m * rz0)));
      const dt = superOut(Rsec, 0, nZc, dx, dz);
      return Math.max(dc, dt) + clr;
    };
    const X0 = backR(0);
    const backPt = function (phi) {
      const d = backR(phi), s = Math.sin(phi);
      return [Math.cos(phi) * d, yc0 + tb * Math.pow(Math.max(0, s), 1.5), nZc - s * d];
    };
    // ---- the front: side of the neck → down the upper chest → the bail
    const surfZ = function (x, y) {
      let z = rig.torsoFrontZ(x, y);
      if (!isFinite(z)) z = nZc;
      const R = S.at(y);
      z = Math.max(z, R.zc);
      const c = Math.sqrt(Math.max(0, 1 - (x / (1.05 * rx0)) * (x / (1.05 * rx0))));
      const m = collarM(y + tf * Math.pow(c, 1.5));
      if (m > 0 && Math.abs(x) < m * rx0) z = Math.max(z, nZc + m * rz0 * Math.sqrt(1 - (x / (m * rx0)) * (x / (m * rx0))));
      return z;
    };
    const kC = 2.1, coshK = Math.cosh(kC) - 1, wV = st.pendant ? 0.30 : 0.12;
    const shape = function (u) { return (1 - wV) * (1 - (Math.cosh(kC * (1 - u)) - 1) / coshK) + wV * u; };
    const frontPt = function (u, side) {
      const x = side * X0 * (1 - u), y = yc0 - (yc0 - yB) * shape(u);
      return [x, y, surfZ(x, y) + clr];
    };
    // assemble: bottom → right front up → back → left front down (closed)
    const NF = 34, NB = 26, pts = [];
    for (let k = NF; k >= 1; k--) pts.push(frontPt(k / NF, 1));
    for (let k = 0; k <= NB; k++) pts.push(backPt(k / NB * PI));
    for (let k = 1; k < NF; k++) pts.push(frontPt(k / NF, -1));
    const n = pts.length;
    // taut-chain relax: Laplacian pull (the bottom pinned), then back onto/out of the body
    const push = function (p) {
      if (p[2] <= nZc) {                                            // behind the neck axis: keep the loop's radius
        const dx = p[0], dz = p[2] - nZc, d = Math.hypot(dx, dz) || 1e-6;
        const phi = Math.atan2(-dz, dx), need = backR(Math.max(0, Math.min(PI, phi)));
        if (d < need) { p[0] = dx / d * need; p[2] = nZc + dz / d * need; }
      } else {
        const z = surfZ(p[0], p[1]) + clr;
        if (p[2] < z) p[2] = z;
      }
    };
    for (let it = 0; it < 4; it++) {
      const cp = pts.map((p) => p.slice());
      for (let i = 1; i < n; i++) {
        const a = cp[(i - 1 + n) % n], b = cp[(i + 1) % n];
        for (let c = 0; c < 3; c++) pts[i][c] = cp[i][c] * 0.5 + (a[c] + b[c]) * 0.25;
      }
      for (let i = 1; i < n; i++) push(pts[i]);
    }
    push(pts[0]);
    // outward normals: the body's surface normal in front, radial round the neck
    const nrm = [];
    const e = 0.004;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      let N;
      if (p[2] > nZc + 0.3 * X0 || p[1] < yc0 - 0.06 * vs) {
        const zx = (surfZ(p[0] + e, p[1]) - surfZ(p[0] - e, p[1])) / (2 * e);
        const zy = (surfZ(p[0], p[1] + e) - surfZ(p[0], p[1] - e)) / (2 * e);
        N = vnorm([-zx, -zy, 1]);
      } else N = vnorm([p[0], 0.25, p[2] - nZc]);
      nrm.push(N);
    }
    for (let it = 0; it < 3; it++) {
      const cp = nrm.map((v) => v.slice());
      for (let i = 0; i < n; i++) nrm[i] = vnorm(vadd(vadd(cp[i], vmul(cp[(i - 1 + n) % n], 0.5)), vmul(cp[(i + 1) % n], 0.5)));
    }
    // the bail and the pendant's rest frame: it lies along the CHORD from the
    // bail to the surface a pendant-length below (never through the chest)
    const bail = pts[0].slice();
    const Lp = 0.045 * BODY_K * U;
    const zLow = surfZ(0, bail[1] - Lp) + clr + 0.0022 * BODY_K * U;   // the pendant's own back half-thickness off the chest
    const down = vnorm([0, -Lp, Math.max(0, zLow - bail[2])]);
    return { pts, nrm, bail, down, U, K: BODY_K, X0, yc0, zFront: nZc + 0.35 * X0 };
  }

  /* ---- links along a closed path ---- */
  function arcTable(pts) {
    const n = pts.length, cum = [0];
    for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + vlen(vsub(pts[i % n], pts[i - 1])));
    return cum;
  }
  function sampleAt(pts, nrm, cum, s) {
    const n = pts.length, L = cum[n];
    s = ((s % L) + L) % L;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / Math.max(1e-9, cum[lo + 1] - cum[lo]);
    const a = pts[lo], b = pts[(lo + 1) % n];
    const p = vadd(a, vmul(vsub(b, a), f));
    const t = vnorm(vsub(b, a));
    let N = vnorm(vadd(vmul(nrm[lo], 1 - f), vmul(nrm[(lo + 1) % n], f)));
    N = vnorm(vsub(N, vmul(t, vdot(N, t))));
    return { p, t, N };
  }
  function linksGeo(D, st) {
    const geo = new Geo();
    const U = D.U * (D.K || 1);
    const Lo = st.Lo * U, Wo = st.Wo * U, r = st.r * U;
    const tpl = linkTemplate(Lo, Wo, r, st.fz, st.seg ? st.seg[0] : 12, st.seg ? st.seg[1] : 6);
    const cum = arcTable(D.pts), L = cum[cum.length - 1];
    const pitch = Lo - st.pitchK * 2 * r;
    const count = Math.max(8, Math.round(L / pitch));
    const step = L / count;
    for (let i = 0; i < count; i++) {
      const sm = sampleAt(D.pts, D.nrm, cum, (i + 0.5) * step);
      const Bv = vcross(sm.N, sm.t);                               // across the chain, in the surface
      let Y, Z;
      if (st.flat) { const q = vrot(Bv, sm.N, (i & 1 ? 1 : -1) * st.tilt); Y = q[0]; Z = q[1]; }
      else if (i & 1) { Y = sm.N; Z = vmul(Bv, -1); } else { Y = Bv; Z = sm.N; }
      // lift a tilted link so its low edge still clears the surface
      const lift = st.flat ? Math.sin(st.tilt) * Wo * 0.5 * 0.6 : (i & 1 ? Wo * 0.5 - r : 0);
      geo.add(tpl, T(vadd(sm.p, vmul(sm.N, lift)), sm.t, Y, Z, 1));
    }
    return geo.build();
  }
  function stonesGeo(D, st) {
    const gGem = new Geo(), gMet = new Geo();
    const U = D.U * (D.K || 1), cum = arcTable(D.pts), L = cum[cum.length - 1], n = D.pts.length;
    // STONES ACROSS THE FRONT, a fine cable chain round the back (a rivière's
    // stones stop where the collar and the hair take over; nobody sees the
    // nape, and the back half would double the bill for nothing)
    const zCut = D.zFront != null ? D.zFront : -Infinity;
    let iR = 0, iL = n - 1;
    while (iR < n - 1 && D.pts[iR + 1][2] > zCut) iR++;
    while (iL > 0 && D.pts[iL - 1][2] > zCut) iL--;
    const sR = cum[iR], sL = cum[iL] - L;                        // stones on [sL, sR] (through s = 0, the bail)
    const size = function (s) {
      const e = Math.abs(s);
      return (st.dMin + (st.dMax - st.dMin) * Math.exp(-Math.pow(e / (0.085 * U), 2))) * U;
    };
    let s = sL;
    while (s < sR) {
      const d = size(s + size(s) / 2);
      const sm = sampleAt(D.pts, D.nrm, cum, s + d / 2);
      const Bv = vcross(sm.N, sm.t);
      const rr = d / 2;
      // the collet under the girdle + four claws over it
      const base = vadd(sm.p, vmul(sm.N, -rr * 0.2));
      torusInto(gMet, vadd(base, vmul(sm.N, rr * 0.15)), sm.t, Bv, rr * 0.98, rr * 0.16, 8, 3, 1);
      for (let k = 0; k < 4; k++) {
        const a = PI / 4 + k * PI / 2, dir = vadd(vmul(sm.t, Math.cos(a)), vmul(Bv, Math.sin(a)));
        rod(gMet, vadd(base, vmul(dir, rr * 0.95)), vadd(vadd(base, vmul(dir, rr * 0.86)), vmul(sm.N, rr * 0.62)), rr * 0.12, 4, true);
      }
      addStone(gGem, vadd(base, vmul(sm.N, rr * 0.42)), sm.N, rr * 0.94, 0, rr < 0.0021 * U);
      s += d + st.gap * U;
    }
    // the back: a 1.6 mm round snake chain from the last stone round the nape
    // to the first (what a rivière's back actually is under the hair)
    const back0 = sR, back1 = sL + L, cnt = Math.max(8, Math.round((back1 - back0) / (0.012 * U)));
    const bp = [], bn = [];
    for (let i = 0; i <= cnt; i++) {
      const sm = sampleAt(D.pts, D.nrm, cum, back0 + i * (back1 - back0) / cnt);
      bp.push(sm.p); bn.push(sm.N);
    }
    sweep(gMet, bp, 0.0008 * U, 6, false, bn, 1);
    return { gem: gGem.build(), metal: gMet.build() };
  }
  function tubeGeo(D, r, fz) {
    const geo = new Geo();
    sweep(geo, D.pts, r, 6, true, D.nrm, fz);
    return geo.build();
  }

  /* ================================================================ PENDANTS
     Authored in metres, hanging from the bail at the origin down -Y, face +Z. */
  const _pend = new Map();
  function pendantParts(kind) {
    if (_pend.has(kind)) return _pend.get(kind);
    const parts = [];                                              // [{ geo, finish }]
    const put = (g, f) => { if (!g.empty()) parts.push({ geo: g.build(), finish: f }); };
    if (kind === "cross") {
      // a polished Latin cross, 42 x 26 mm, 3 mm thick, bevelled edges
      const gold = new Geo();
      torusInto(gold, [0, -0.0032, 0], [0, 1, 0], [0, 0, 1], 0.0026, 0.0007, 12, 5);   // bail
      const sh = new THREE.Shape();
      const w = 0.0036, top = -0.0062, bot = -0.0062 - 0.042, arm = top - 0.011, aw = 0.013;
      sh.moveTo(-w, top); sh.lineTo(w, top); sh.lineTo(w, arm + w); sh.lineTo(aw, arm + w); sh.lineTo(aw, arm - w);
      sh.lineTo(w, arm - w); sh.lineTo(w, bot); sh.lineTo(-w, bot); sh.lineTo(-w, arm - w); sh.lineTo(-aw, arm - w);
      sh.lineTo(-aw, arm + w); sh.lineTo(-w, arm + w); sh.lineTo(-w, top);
      const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0007, bevelSegments: 2, curveSegments: 1 });
      ex.translate(0, 0, -0.0009);
      const ng = ex.index ? ex.toNonIndexed() : ex;
      ng.computeVertexNormals();
      const pa = ng.attributes.position.array, na = ng.attributes.normal.array;
      const src = { p: Array.from(pa), n: Array.from(na), i: [] };
      for (let k = 0; k < pa.length / 3; k++) src.i.push(k);
      gold.add(src, null);
      ex.dispose(); if (ng !== ex) ng.dispose();
      put(gold, "gold");
    } else if (kind === "medallion") {
      // a 46 mm iced medallion: polished rim, pavé face, a centre brilliant
      // in a bezel, 20 stones round the rim, a fat bail
      const R = 0.023, cy = -0.0065 - R;
      const rim = new Geo(), face = new Geo(), gem = new Geo();
      torusInto(rim, [0, -0.0047, 0], [0, 1, 0], [0, 0, 1], 0.0034, 0.0011, 14, 6);
      const Tm = T([0, cy, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], 1);   // lathe axis → +Z
      latheInto(rim, Tm, [[0.0, -0.0022], [R - 0.0012, -0.0022], [R, -0.0016], [R + 0.0003, 0.0], [R, 0.0016], [R - 0.0014, 0.0022], [R - 0.0026, 0.0014]], 36);
      latheInto(face, Tm, [[R - 0.0026, 0.0014], [R - 0.006, 0.0012], [0.0065, 0.0010], [0.0, 0.0010]], 36);
      latheInto(rim, Tm, [[0.0066, 0.0010], [0.0058, 0.0024], [0.0, 0.0024]], 20);        // the bezel cup
      addStone(gem, [0, cy, 0.0030], [0, 0, 1], 0.0052, 0);
      for (let k = 0; k < 20; k++) {
        const a = k / 20 * TAU, rr = R - 0.0042;
        addStone(gem, [Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.0019], [0, 0, 1], 0.0014, a, true);
      }
      put(rim, "white"); put(face, "ice"); put(gem, "diamond");
    } else if (kind === "solitaire" || kind === "drop") {
      // a round brilliant in a four-claw basket under a small bail
      const big = kind === "drop";
      const r = big ? 0.0042 : 0.0032;
      const met = new Geo(), gem = new Geo();
      torusInto(met, [0, -0.0022, 0], [0, 1, 0], [0, 0, 1], 0.0018, 0.00055, 10, 5);
      const c = [0, -0.0042 - r, 0.0010];
      torusInto(met, vadd(c, [0, 0, -r * 0.35]), [1, 0, 0], [0, 1, 0], r * 0.62, r * 0.12, 12, 4);
      for (let k = 0; k < 4; k++) {
        const a = PI / 4 + k * PI / 2, d = [Math.cos(a), Math.sin(a), 0];
        rod(met, vadd(c, vadd(vmul(d, r * 0.6), [0, 0, -r * 0.4])), vadd(c, vadd(vmul(d, r * 0.92), [0, 0, r * 0.28])), r * 0.11, 5, true);
      }
      rod(met, [0, -0.0035, 0.0005], vadd(c, [0, r * 0.9, -r * 0.2]), 0.0005, 5, false);
      addStone(gem, c, [0, 0, 1], r, 0);
      put(met, "white"); put(gem, "diamond");
    }
    _pend.set(kind, parts);
    return parts;
  }
  const swingers = new Set();
  function makePendant(kind, D, anchor, finishOverride) {
    const parts = pendantParts(kind);
    if (!parts.length) return null;
    const pivot = new THREE.Group();
    pivot.name = "jewel-pendant";
    pivot.position.set(D.bail[0], D.bail[1], D.bail[2]);
    // rest frame: X across, Y = up the chord, Z = out of the chest
    const X = [1, 0, 0], Y = vmul(D.down, -1), Z = vcross(X, Y);
    const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(X[0], X[1], X[2]), new THREE.Vector3(Y[0], Y[1], Y[2]), new THREE.Vector3(Z[0], Z[1], Z[2]));
    pivot.quaternion.setFromRotationMatrix(m4);
    pivot.scale.setScalar(D.U * (D.K || 1));
    const swing = new THREE.Group();
    pivot.add(swing);
    for (let i = 0; i < parts.length; i++) {
      const m = new THREE.Mesh(parts[i].geo, mat(finishOverride && parts[i].finish === "gold" ? finishOverride : parts[i].finish));
      tag(m);
      swing.add(m);
    }
    pivot.userData.swing = { node: swing, a: 0, b: 0, va: 0, vb: 0, anchor: anchor, pv: null, pa: null, t: 0 };
    tag(pivot);
    swingers.add(pivot);
    return pivot;
  }

  /* ================================================================ necklace
     cache: per (style, body shape, scale) — near/far geometries + drape */
  const _chainCache = new Map();
  function chainRecord(rig, style) {
    const st = CHAIN[style];
    const key = style + "|" + (rig.torsoShape.key || "") + "|" + humanScale(rig).toFixed(3);
    let rec = _chainCache.get(key);
    if (rec) { rec.refs++; return rec; }
    const D = drape(rig, st);
    rec = { key, style, D, refs: 1, near: null, far: null, gem: null };
    if (st.kind === "links") {
      rec.near = linksGeo(D, st);
      rec.far = tubeGeo(D, st.Wo * 0.42 * D.U * D.K, 0.55);
    } else {
      const g = stonesGeo(D, st);
      rec.near = g.metal; rec.gem = g.gem;
      rec.far = tubeGeo(D, st.dMin * 0.55 * D.U * D.K, 0.7);
    }
    _chainCache.set(key, rec);
    trimCache();
    return rec;
  }
  function trimCache() {
    if (_chainCache.size <= 96) return;
    for (const [k, r] of _chainCache) {
      if (_chainCache.size <= 80) break;
      if (r.refs > 0) continue;
      for (const g of [r.near, r.far, r.gem]) if (g) g.dispose();
      _chainCache.delete(k);
    }
  }
  const necklaces = new Set();
  function tag(o) { o.userData.pedInstSkip = true; o.castShadow = false; o.receiveShadow = false; return o; }
  /* A NEW BODY SHAPE COSTS ~6 ms (the drape + ~170 links), so at most ONE is
     built per frame: a crowd walking into range cannot stack them into a
     hitch. The group is mounted at once (the wearer's state is consistent)
     and filled when its turn comes — within a frame or two, far too fast to
     notice at the 30 m a ped is dressed. A cached shape fills immediately. */
  let _buildBudget = 1;
  const pending = new Set();
  function fillNecklace(grp) {
    const J = grp.userData.jewel;
    const rig = J.rig, style = J.style, st = CHAIN[style];
    const rec = chainRecord(rig, style);
    const chain = tag(new THREE.Mesh(rec.near, mat(st.finish)));
    grp.add(chain);
    let stones = null;
    if (rec.gem) { stones = tag(new THREE.Mesh(rec.gem, mat("diamond"))); grp.add(stones); }
    if (st.pendant) {
      const p = makePendant(st.pendant, rec.D, rig.body);
      if (p) grp.add(p);
    }
    J.rec = rec; J.chain = chain; J.stones = stones; J.far = false; J.rig = null;
    necklaces.add(grp);
  }
  function necklace(rig, style, now) {
    if (!rig || !rig.body || !rig.torsoShape || typeof rig.torsoFrontZ !== "function" || !rig.torsoShape.at) return null;
    if (!CHAIN[style]) style = "curb";
    const grp = new THREE.Group();
    grp.name = "jewel-necklace";
    grp.userData.jewel = { rec: null, chain: null, stones: null, far: false, rig: rig, style: style };
    tag(grp);
    rig.body.add(grp);
    const key = style + "|" + (rig.torsoShape.key || "") + "|" + humanScale(rig).toFixed(3);
    if (now || _chainCache.has(key) || _buildBudget > 0) {
      if (!_chainCache.has(key)) _buildBudget--;
      fillNecklace(grp);
    } else pending.add(grp);
    return grp;
  }

  /* ================================================================ rings
     On the hand mesh (fphands frame: fingers along -Z, back of the hand +Y,
     metres), at the base of finger `fi` (2 = ring finger, 3 = little). */
  const _ringGeo = new Map();
  function ringParts(style, fr) {
    const key = style + "|" + fr.toFixed(4);
    if (_ringGeo.has(key)) return _ringGeo.get(key);
    const met = new Geo(), gem = new Geo();
    const R = fr + 0.0011;                                         // the band's inner radius sits on the skin
    let metal = "platinum";
    if (style === "pinky") {
      // a gold cluster pinky: a wide band, a domed head, seven stones
      metal = "gold";
      torusInto(met, [0, 0, 0], [1, 0, 0], [0, 1, 0], R + 0.0011, 0.0013, 22, 6, 1.9);
      latheInto(met, T([0, R + 0.0016, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 1), [[0.0056, -0.0010], [0.0060, 0.0006], [0.0050, 0.0016], [0.0, 0.0019]], 18);
      addStone(gem, [0, R + 0.0038, 0], [0, 1, 0], 0.0017, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; addStone(gem, [Math.cos(a) * 0.0036, R + 0.0031, Math.sin(a) * 0.0036], [Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25], 0.0012, a, true); }
    } else {
      const rock = style === "rock";
      const sr = rock ? 0.0056 : 0.0033;                           // girdle radius: 11 mm rock, 6.6 mm solitaire
      torusInto(met, [0, 0, 0], [1, 0, 0], [0, 1, 0], R + 0.0009, 0.0010, 24, 6, 1.35);
      // the head: a basket under the stone, four (rock: six) claws over it
      const c = [0, R + 0.0020 + sr * 0.86, 0];
      torusInto(met, vadd(c, [0, -sr * 0.55, 0]), [1, 0, 0], [0, 0, 1], sr * 0.55, sr * 0.10, 14, 4);
      const nC = rock ? 6 : 4;
      for (let k = 0; k < nC; k++) {
        const a = (k + 0.5) / nC * TAU, d = [Math.cos(a), 0, Math.sin(a)];
        rod(met, vadd([0, R + 0.0012, 0], vmul(d, sr * 0.25)), vadd(c, vadd(vmul(d, sr * 0.97), [0, sr * 0.26, 0])), sr * 0.085, 5, true);
      }
      addStone(gem, c, [0, 1, 0], sr, 0);
      if (rock) for (let k = 0; k < 10; k++) {                    // pavé shoulders
        const a = PI / 2 + (k < 5 ? 1 : -1) * (0.55 + (k % 5) * 0.16);
        const Ro = R + 0.0017;
        addStone(gem, [Math.cos(a) * Ro, Math.sin(a) * Ro, 0], [Math.cos(a), Math.sin(a), 0], 0.0008, 0, true);
      }
    }
    const out = { metal: met.build(), gem: gem.empty() ? null : gem.build(), finish: metal };
    _ringGeo.set(key, out);
    return out;
  }
  function ring(hand, finger, style) {
    if (!hand || !hand.add) return null;
    const F = finger || { x: 0.012, z: -0.095, r: 0.0091, splay: 0.05 };
    const P = ringParts(style || "solitaire", F.r || 0.009);
    const grp = new THREE.Group();
    grp.name = "jewel-ring";
    // a hair down the proximal phalanx, the band's axis along the finger
    const sp = F.splay || 0;
    grp.position.set(F.x + Math.sin(sp) * 0.006, 0, F.z - Math.cos(sp) * 0.006);
    grp.rotation.set(0, -sp, 0);
    const m = tag(new THREE.Mesh(P.metal, mat(P.finish)));
    grp.add(m);
    if (P.gem) grp.add(tag(new THREE.Mesh(P.gem, mat("diamond"))));
    tag(grp);
    hand.add(grp);
    return grp;
  }

  /* ================================================================ earrings
     At the real lobe (CBZ.charHeadLandmarks, character.js). */
  const _earGeo = new Map();
  function earParts(style) {
    if (_earGeo.has(style)) return _earGeo.get(style);
    const met = new Geo(), gem = new Geo();
    // ear frame: origin = the piercing, +X out of the head, +Y up, +Z forward
    if (style === "stud") {
      addStone(gem, [0.0012, 0, 0], [1, 0, 0], 0.0030, 0);
      for (let k = 0; k < 4; k++) {
        const a = PI / 4 + k * PI / 2, d = [0, Math.cos(a), Math.sin(a)];
        rod(met, vadd([-0.0004, 0, 0], vmul(d, 0.0022)), vadd([0.0022, 0, 0], vmul(d, 0.0030)), 0.00035, 4, true);
      }
      torusInto(met, [-0.0002, 0, 0], [0, 1, 0], [0, 0, 1], 0.0021, 0.00035, 10, 4);
      rod(met, [-0.0002, 0, 0], [-0.0085, 0, 0], 0.0004, 5, false);   // the post through the lobe
    } else {
      // a 24 mm polished gold hoop, 2.4 mm tube, hanging from the piercing
      torusInto(met, [0.0006, -0.012, 0.0015], [0, 1, 0], [0, 0, 1], 0.012, 0.0012, 36, 7);
    }
    const out = { metal: met.build(), gem: gem.empty() ? null : gem.build(), finish: style === "stud" ? "white" : "gold" };
    _earGeo.set(style, out);
    return out;
  }
  function earrings(rig, style) {
    const lm = CBZ.charHeadLandmarks && CBZ.charHeadLandmarks(rig);
    if (!lm || !rig.neck) return [];
    const P = earParts(style === "stud" ? "stud" : "hoop");
    const U = 1 / humanScale(rig);
    const out = [];
    for (const s of [-1, 1]) {
      const grp = new THREE.Group();
      grp.name = "jewel-earring";
      grp.position.set(s * lm.lobe[0], lm.lobe[1], lm.lobe[2]);
      grp.rotation.set(0, s > 0 ? lm.earYaw : PI - lm.earYaw, 0);   // parallel to the ear, which swings out about its front edge
      grp.scale.setScalar(U * lm.earK);                           // the rig's ear is stylised larger than life: so is what hangs from it
      grp.add(tag(new THREE.Mesh(P.metal, mat(P.finish))));
      if (P.gem) grp.add(tag(new THREE.Mesh(P.gem, mat("diamond"))));
      tag(grp);
      rig.neck.add(grp);
      out.push(grp);
    }
    return out;
  }

  /* ================================================================ grill
     Iced caps over the teeth themselves: a child of each teeth strip, so it
     shows exactly when the teeth show (the mouth opens to talk / snarl) and
     rides their pose; drawn a hair in front with a depth bias. Face units:
     character.js TEETH_W 0.100, TEETH_H 0.014 (read off the strip's bounds). */
  const _grillGeo = new Map();
  function grillGeo(up, w, h) {
    const key = (up ? "U" : "L") + w.toFixed(4) + h.toFixed(4);
    if (_grillGeo.has(key)) return _grillGeo.get(key);
    const geo = new Geo();
    const n = 8, gap = w * 0.012, cw = (w - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * (cw + gap), xc = x0 + cw / 2, t = xc / (w / 2);
      const hh = h * (1 - 0.35 * t * t) * (i === 3 || i === 4 ? 1.06 : 1);
      // one cap: a rounded plate following the arch
      const pts = [];
      const seg = 6;
      for (let k = 0; k <= seg; k++) {
        const u = k / seg, x = x0 + cw * u, tt = x / (w / 2);
        pts.push([x, 0, -0.006 * tt * tt + 0.0024]);
      }
      const bot = up ? -hh : hh, base = geo.v;
      for (let k = 0; k <= seg; k++) {
        const p = pts[k], bulge = Math.sin(k / seg * PI) * 0.0009;
        const nx = (k / seg - 0.5) * 0.6;
        geo.vert(p[0], up ? -hh * 0.06 : hh * 0.06, p[2] + bulge * 0.6, nx, 0.2 * (up ? 1 : -1), 1);
        geo.vert(p[0], (up ? -hh * 0.5 : hh * 0.5), p[2] + bulge, nx, 0, 1);
        geo.vert(p[0], bot * 0.97, p[2] + bulge * 0.5, nx, 0.3 * (up ? -1 : 1), 1);
      }
      for (let k = 0; k < seg; k++) {
        const r0 = base + k * 3, r1 = base + (k + 1) * 3;
        for (let j = 0; j < 2; j++) {
          if (up) { geo.tri(r0 + j, r1 + j + 1, r1 + j); geo.tri(r0 + j, r0 + j + 1, r1 + j + 1); }
          else { geo.tri(r0 + j, r1 + j, r1 + j + 1); geo.tri(r0 + j, r1 + j + 1, r0 + j + 1); }
        }
      }
    }
    // normalise the per-vertex normals we hand-set
    for (let k = 0; k < geo.n.length; k += 3) { const v = vnorm([geo.n[k], geo.n[k + 1], geo.n[k + 2]]); geo.n[k] = v[0]; geo.n[k + 1] = v[1]; geo.n[k + 2] = v[2]; }
    const g = geo.build();
    _grillGeo.set(key, g);
    return g;
  }
  function grill(rig) {
    const M = rig && rig.mouthIn;
    if (!M || !M.teethUp) return [];
    const out = [];
    for (const t of [M.teethUp, M.teethLow]) {
      if (!t || !t.geometry) continue;
      const up = t === M.teethUp;
      if (!t.geometry.boundingBox) t.geometry.computeBoundingBox();
      const bb = t.geometry.boundingBox;
      const w = Math.max(0.02, bb.max.x - bb.min.x), h = Math.max(0.004, bb.max.y - bb.min.y);
      const m = tag(new THREE.Mesh(grillGeo(up, w, h), matBiased("ice")));
      m.name = "jewel-grill";
      t.add(m);
      out.push(m);
    }
    return out;
  }

  /* ================================================================ tiara
     An arc of platinum across the front of the crown, a row of brilliants in
     the band, seven peaks (tallest at the centre) each a ring of small
     stones round a bigger one. Neck frame, sized by the head (hk). */
  let _tiara = null;
  function tiaraParts() {
    if (_tiara) return _tiara;
    const met = new Geo(), gem = new Geo();
    const R = 0.0985, a0 = -1.05, a1 = 1.05, N = 44;               // metres, round the crown
    const at = (a, y, dr) => [Math.sin(a) * (R + (dr || 0)), y, Math.cos(a) * (R + (dr || 0))];
    const band = [];
    for (let k = 0; k <= N; k++) band.push(at(a0 + (a1 - a0) * k / N, 0, 0));
    const nrm = band.map((p) => vnorm([p[0], 0, p[2]]));
    sweep(met, band, 0.0024, 6, false, nrm, 0.45);
    for (let k = 0; k <= 30; k++) { const a = a0 + (a1 - a0) * (k + 0.5) / 31; addStone(gem, at(a, 0, 0.0012), [Math.sin(a), 0, Math.cos(a)], 0.0015, 0, true); }
    for (let p = 0; p < 7; p++) {
      const a = -0.84 + p * 0.28, hgt = 0.013 + 0.021 * Math.exp(-Math.pow((p - 3) / 1.6, 2));
      const out = [Math.sin(a), 0, Math.cos(a)], tan = [Math.cos(a), 0, -Math.sin(a)];
      const c = vadd(at(a, 0.0035 + hgt * 0.55, 0), [0, 0, 0]);
      const ring = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16 * TAU;
        ring.push(vadd(c, vadd(vmul(tan, Math.sin(t) * hgt * 0.30), [0, Math.cos(t) * hgt * 0.52, 0])));
      }
      sweep(met, ring, 0.0008, 5, true, ring.map(() => out), 1);
      for (let k = 0; k < 10; k++) {
        const t = (k + 0.5) / 10 * TAU;
        addStone(gem, vadd(c, vadd(vmul(tan, Math.sin(t) * hgt * 0.30), [0, Math.cos(t) * hgt * 0.52, 0])), out, 0.0011, t, true);
      }
      addStone(gem, vadd(c, vmul(out, 0.0012)), out, Math.min(0.0045, hgt * 0.2), 0);
      rod(met, at(a, 0.0015, 0), vadd(c, [0, -hgt * 0.5, 0]), 0.0007, 5, false);
    }
    return (_tiara = { metal: met.build(), gem: gem.build() });
  }
  function tiara(rig) {
    const lm = CBZ.charHeadLandmarks && CBZ.charHeadLandmarks(rig);
    if (!lm || !rig.neck) return null;
    const P = tiaraParts();
    const grp = new THREE.Group();
    grp.name = "jewel-tiara";
    grp.position.set(0, lm.crownBandY, lm.headZ);
    grp.rotation.set(-0.28, 0, 0);                                   // sits back on the head
    // fitted to THIS head, not to a real one: the rig's skull is stylised
    // (0.60 u), so the arc is sized to its band line (0.325 u x hk) and the
    // stones grow with it — a tiara is made for the head that wears it
    grp.scale.setScalar(0.325 * lm.hk / 0.0985);
    grp.add(tag(new THREE.Mesh(P.metal, mat("platinum"))));
    grp.add(tag(new THREE.Mesh(P.gem, mat("diamond"))));
    tag(grp);
    rig.neck.add(grp);
    return grp;
  }

  /* ================================================================ bracelet
     The tennis bracelet on a MEASURED wrist (watch.js wristPlace): a line of
     brilliants in four-claw boxes all the way round the wrist ellipse. */
  const _brace = new Map();
  function braceletGeo(fit) {
    const key = fit.key;
    if (_brace.has(key)) return _brace.get(key);
    const met = new Geo(), gem = new Geo();
    const s = fit.s, clr = 0.0026 * s;
    const a = fit.a + clr, b = fit.b + clr;                        // wrist frame: X across(12 o'clock), Z dorsal, Y along
    const per = PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const d = 0.0034 * s, n = Math.max(12, Math.round(per / (d * 1.12)));
    for (let k = 0; k < n; k++) {
      const t = k / n * TAU, p = [a * Math.cos(t), 0, b * Math.sin(t)];
      const N = vnorm([Math.cos(t) / a, 0, Math.sin(t) / b]);
      const tan = vnorm([-a * Math.sin(t), 0, b * Math.cos(t)]);
      const Bv = [0, 1, 0];
      const base = vadd(p, vmul(N, d * 0.1));
      // the box: a square-ish collet wall
      torusInto(met, base, tan, Bv, d * 0.52, d * 0.13, 8, 4, 1);
      for (let q = 0; q < 4; q++) {
        const ang = PI / 4 + q * PI / 2, dir = vadd(vmul(tan, Math.cos(ang)), vmul(Bv, Math.sin(ang)));
        rod(met, vadd(base, vmul(dir, d * 0.45)), vadd(vadd(base, vmul(dir, d * 0.44)), vmul(N, d * 0.36)), d * 0.07, 4, true);
      }
      addStone(gem, vadd(base, vmul(N, d * 0.22)), N, d * 0.46, 0, true);
    }
    const out = { metal: met.build(), gem: gem.build() };
    _brace.set(key, out);
    return out;
  }
  function bracelet(anchor, place) {
    if (!anchor || !place || !place.fit) return null;
    const G = braceletGeo(place.fit);
    const grp = new THREE.Group();
    grp.name = "jewel-bracelet";
    grp.position.copy(place.pos);
    grp.position.y -= 0.012 * place.fit.s;                          // just below the watch line, toward the hand
    grp.quaternion.copy(place.quat);
    grp.add(tag(new THREE.Mesh(G.metal, mat("white"))));
    grp.add(tag(new THREE.Mesh(G.gem, mat("diamond"))));
    tag(grp);
    anchor.add(grp);
    return grp;
  }

  /* ================================================================ shop pieces
     city/jewelry.js's case: the SAME pieces on velvet forms, real metres.
     necklace kinds drape round a neck form of radius `r` (origin = form axis
     at the chain's resting height), rings stand on a finger cone. */
  function displayNecklace(style, r) {
    const st = CHAIN[style] || CHAIN.curb;
    // a form "rig": a cylinder neck on a sloped bust
    const D = (function () {
      const pts = [], nrm = [], n = 64, drop = style === "riviera" ? 0.018 : 0.05;
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU;                                      // 0 = front
        const x = Math.sin(a) * (r + 0.002), zc = Math.cos(a);
        const front = Math.max(0, zc);
        const y = -drop * Math.pow(front, 3.2) + 0.004 * (1 - front);
        const z = zc * (r + 0.002) + front * front * drop * 0.55;
        pts.push([x, y, z]);
        nrm.push(vnorm([Math.sin(a), 0.35 * front, zc]));
      }
      const bail = pts[0].slice();
      return { pts, nrm, bail, down: vnorm([0, -1, 0.35]), U: 1, K: 1 };
    })();
    const grp = new THREE.Group();
    if (st.kind === "links") grp.add(tag(new THREE.Mesh(linksGeo(D, st), mat(st.finish))));
    else { const g = stonesGeo(D, st); grp.add(tag(new THREE.Mesh(g.metal, mat(st.finish)))); grp.add(tag(new THREE.Mesh(g.gem, mat("diamond")))); }
    if (st.pendant) { const p = makePendant(st.pendant, D, null); if (p) { swingers.delete(p); grp.add(p); } }
    return grp;
  }
  function displayRing(style) {
    const P = ringParts(style, 0.0092);
    const grp = new THREE.Group();
    // stand the ring on its cone: band axis vertical, head to the customer
    const inner = new THREE.Group();
    inner.rotation.x = PI / 2;                                      // head +Y → the customer, band axis → vertical
    inner.add(tag(new THREE.Mesh(P.metal, mat(P.finish))));
    if (P.gem) inner.add(tag(new THREE.Mesh(P.gem, mat("diamond"))));
    grp.add(inner);
    return grp;
  }
  function displayGrill() {
    const grp = new THREE.Group();
    const w = 0.052, h = 0.009;
    const m = tag(new THREE.Mesh(grillGeo(true, w, h), mat("ice")));
    m.position.set(0, h + 0.002, 0);
    grp.add(m);
    return grp;
  }
  function displayTiara() {
    const P = tiaraParts();
    const grp = new THREE.Group();
    grp.add(tag(new THREE.Mesh(P.metal, mat("platinum"))));
    grp.add(tag(new THREE.Mesh(P.gem, mat("diamond"))));
    grp.scale.setScalar(0.66);
    return grp;
  }

  /* ================================================================ release */
  function release(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    const J = obj.userData && obj.userData.jewel;
    if (J && J.rec) { J.rec.refs = Math.max(0, J.rec.refs - 1); J.rec = null; trimCache(); }
    necklaces.delete(obj);
    pending.delete(obj);
    obj.traverse(function (o) { if (o.userData && o.userData.swing) swingers.delete(o); });
  }

  /* ================================================================ first person
     THE RING IN YOUR VIEW. Every first-person hand (fpsmode's fists and gun
     hands, the steering wheel, the pickup lens, the bail-out) is made by
     fpHands.makeHand / attachGrip; wrapping both registers each RIGHT hand,
     and the player's worn ring (bling.js: setPlayerRing) is put on it at the
     same finger base the body's hand wears it. It draws in the viewmodel's
     order, through its transparent-sorted variant when the hand uses one. */
  const fpHandsR = [];
  let _playerRing = null, _fpT = 0;
  const _fpMats = new Map();
  function fpVariant(m) {
    let v = _fpMats.get(m);
    if (!v) {
      v = m.clone();
      v.onBeforeCompile = m.onBeforeCompile; v.customProgramCacheKey = m.customProgramCacheKey;
      v.transparent = true; v.opacity = 1; v.depthWrite = true; v.depthTest = true;
      v._shared = true;
      _allMats.push(v);
      _fpMats.set(m, v);
    }
    return v;
  }
  function noteHand(h) {
    if (h && h.isMesh && h.userData && h.userData.side > 0 && fpHandsR.indexOf(h) < 0) {
      fpHandsR.push(h);
      if (fpHandsR.length > 48) fpHandsR.shift();
      if (_playerRing) syncFpRings();
    }
    return h;
  }
  function wrapFpHands() {
    const H = CBZ.fpHands;
    if (!H) return false;
    if (H._jewelWrapped) return true;
    ["makeHand", "attachGrip"].forEach(function (k) {
      const o = H[k];
      if (typeof o !== "function") return;
      H[k] = function () { const r = o.apply(this, arguments); try { noteHand(r); } catch (e) { /* a ring never breaks a hand */ } return r; };
    });
    H._jewelWrapped = true;
    return true;
  }
  wrapFpHands();
  function syncFpRings() {
    const F = CBZ.fpHands && CBZ.fpHands.FINGERS;
    for (let i = 0; i < fpHandsR.length; i++) {
      const h = fpHandsR[i], cur = h.userData.jewelRing;
      if (cur && cur.style === _playerRing) {
        if (cur.ro !== (h.renderOrder || 0)) { cur.ro = h.renderOrder || 0; cur.obj.traverse(function (o) { o.renderOrder = cur.ro; }); }
        continue;
      }
      if (cur) { release(cur.obj); h.userData.jewelRing = null; }
      if (!_playerRing) continue;
      const obj = ring(h, F ? F[_playerRing === "pinky" ? 3 : 2] : null, _playerRing);
      if (!obj) continue;
      const tr = !!(h.material && h.material.transparent), ro = h.renderOrder || 0;
      obj.traverse(function (o) { o.renderOrder = ro; o.frustumCulled = false; if (o.isMesh && tr) o.material = fpVariant(o.material); });
      h.userData.jewelRing = { style: _playerRing, obj: obj, ro: ro };
    }
  }
  function setPlayerRing(style) {
    style = style || null;
    if (style === _playerRing) return;
    _playerRing = style;
    wrapFpHands();
    syncFpRings();
  }

  /* ================================================================ per frame
     LOD (links / tube) and the pendulum. Reads matrixWorld (last frame's is
     plenty for a swing) — no world-matrix updates are forced. */
  const _cam = [0, 0, 0];
  function camPos() {
    const c = CBZ.camera;
    if (!c || !c.matrixWorld) return null;
    const e = c.matrixWorld.elements;
    _cam[0] = e[12]; _cam[1] = e[13]; _cam[2] = e[14];
    return _cam;
  }
  function attached(o) {
    for (let i = 0; o && i < 40; i++) { if (o.visible === false) return false; if (o.isScene) return true; o = o.parent; }
    return false;
  }
  let _lastT = 0;
  const _sv = new THREE.Vector3(), _sq = new THREE.Quaternion();
  function tick() {
    const t = nowS();
    let dt = _lastT ? t - _lastT : 0.016;
    _lastT = t;
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 20);
    if (!_env) jewelEnv();
    _buildBudget = 1;
    if (pending.size) {
      for (const grp of pending) {
        pending.delete(grp);
        if (grp.parent) { _buildBudget--; fillNecklace(grp); }
        break;
      }
    }
    _fpT -= dt;
    if (_fpT <= 0) { _fpT = 0.5; wrapFpHands(); if (_playerRing || fpHandsR.some(function (h) { return h.userData.jewelRing; })) syncFpRings(); }
    const cam = camPos();
    // ---- LOD
    necklaces.forEach(function (grp) {
      const J = grp.userData.jewel;
      if (!J || !J.rec) { necklaces.delete(grp); return; }
      if (!grp.parent) { release(grp); return; }                 // stripped without a release (a portrait): drop its cache ref
      let far = false;
      if (cam) {
        const e = grp.matrixWorld.elements, dx = e[12] - cam[0], dy = e[13] - cam[1], dz = e[14] - cam[2];
        far = dx * dx + dy * dy + dz * dz > LOD_NEAR * LOD_NEAR;
      }
      if (far !== J.far) {
        J.far = far;
        J.chain.geometry = far ? J.rec.far : J.rec.near;
        if (J.stones) J.stones.visible = !far;
        if (far) J.chain.material = mat(J.rec.style === "riviera" ? "ice" : (CHAIN[J.rec.style] || CHAIN.curb).finish);
        else J.chain.material = mat((CHAIN[J.rec.style] || CHAIN.curb).finish);
      }
    });
    // ---- pendulums
    swingers.forEach(function (pv) {
      const W = pv.userData.swing;
      if (!pv.parent || !W.anchor) { if (!pv.parent) swingers.delete(pv); return; }
      const e = W.anchor.matrixWorld.elements;
      if (cam) {
        const dx = e[12] - cam[0], dy = e[13] - cam[1], dz = e[14] - cam[2];
        if (dx * dx + dy * dy + dz * dz > SWING_D * SWING_D) return;
      }
      if (!attached(pv)) return;
      // world acceleration of the body (finite differences, smoothed)
      const px = e[12], py = e[13], pz = e[14];
      let ax = 0, ay = 0, az = 0;
      if (W.pv) {
        const vx = (px - W.pv[0]) / dt, vy = (py - W.pv[1]) / dt, vz = (pz - W.pv[2]) / dt;
        if (W.pa) { ax = (vx - W.pa[0]) / dt; ay = (vy - W.pa[1]) / dt; az = (vz - W.pa[2]) / dt; }
        W.pa = [vx, vy, vz];
      }
      W.pv = [px, py, pz];
      const am = Math.hypot(ax, ay, az);
      if (am > 25) { ax *= 25 / am; ay *= 25 / am; az *= 25 / am; }
      if (!(am < 1e6)) { ax = ay = az = 0; W.pa = null; }
      // effective gravity (world), into the anchor's frame (rotation only)
      const gx = -ax * 0.6, gy = -9.81 - ay * 0.6, gz = -az * 0.6;
      const c0 = Math.hypot(e[0], e[1], e[2]) || 1, c1 = Math.hypot(e[4], e[5], e[6]) || 1, c2 = Math.hypot(e[8], e[9], e[10]) || 1;
      const lx = (e[0] * gx + e[1] * gy + e[2] * gz) / c0, ly = (e[4] * gx + e[5] * gy + e[6] * gz) / c1, lz = (e[8] * gx + e[9] * gy + e[10] * gz) / c2;
      // …then into the pendant's rest frame (its quaternion within the anchor;
      // the necklace group itself carries no rotation)
      _sv.set(lx, ly, lz).applyQuaternion(_sq.copy(pv.quaternion).conjugate());
      const rx = _sv.x, ry = _sv.y, rz = _sv.z;
      let ta = Math.atan2(-rz, -ry), tb = Math.atan2(rx, -ry);
      if (ta > 0) ta = 0;                                           // never into the chest
      ta = Math.max(-1.35, ta); tb = Math.max(-1.1, Math.min(1.1, tb));
      const w = 9.5, z = 0.32;
      W.va += (w * w * (ta - W.a) - 2 * z * w * W.va) * dt; W.a += W.va * dt;
      W.vb += (w * w * (tb - W.b) - 2 * z * w * W.vb) * dt; W.b += W.vb * dt;
      if (W.a > 0) { W.a = 0; if (W.va > 0) W.va = -W.va * 0.25; }     // it bumps the chest, it does not pass it
      W.node.rotation.set(W.a, 0, W.b);
    });
  }
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(40.5, tick);
  else if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(40.5, tick);

  CBZ.jewel = {
    version: 1,
    FINISH: FINISH, CHAIN: CHAIN,
    mat: mat, env: jewelEnv, tag: tag,
    necklace: necklace, ring: ring, earrings: earrings, grill: grill, tiara: tiara, bracelet: bracelet,
    setPlayerRing: setPlayerRing,
    display: { necklace: displayNecklace, ring: displayRing, grill: displayGrill, tiara: displayTiara },
    release: release,
    tick: tick,
    // a clone of a kit finish made elsewhere (watch.js's first-person variants):
    // keep it on the environment when that arrives
    adopt: function (m) { if (m && _allMats.indexOf(m) < 0) { _allMats.push(m); if (_env) { m.envMap = _env; m.needsUpdate = true; } } return m; },
    count: function () { return { necklaces: necklaces.size, pendants: swingers.size, cached: _chainCache.size }; },
    _test: { brilliant, linkTemplate, drape, linksGeo, stonesGeo, tubeGeo, pendantParts, ringParts, earParts, grillGeo, tiaraParts, braceletGeo, superOut, Geo, sweep, humanScale },
  };
})();
