/* ============================================================
   world/textures_surface.js — THE PROCEDURAL SURFACE LIBRARY.

   WHY THIS EXISTS: before this file the entire game shipped ZERO
   normal maps and ZERO bump maps. Every surface was either flat
   vertex colour or geometric detail (a wall is a box, a kerb is a
   thinner box), so at any distance closer than ~4m the world read as
   painted cardboard: an asphalt road and a plaster wall differ only in
   hue, never in how light scatters off them. src/vendor/WaterReflect.js
   already proves the fix works in this build — it synthesises a tiling
   CanvasTexture NORMAL MAP at runtime because the CDN water-normals
   asset is blocked — so this file generalises exactly that technique
   into a shared, cached, tier-aware library of tiling
   colour + normal + roughness maps for the surfaces the world is
   actually made of.

   NO ASSETS, NO NETWORK. Everything is drawn into an offscreen canvas
   from deterministic hash noise (CBZ.hashN — never Math.random, per the
   determinism law: these are baked once at load and must be identical
   on every client of a multiplayer world).

   DRAW-CALL SAFETY (read this before you texture anything shared):
   core/batch.js REFUSES to merge any material carrying a `.map`
   (mergeableKey/mergeableKeyV2 both bail on `mat.map`). Texturing a
   material that thousands of static meshes share would therefore un-merge
   them and re-create the ~2200-draw-call world batching exists to kill.
   This library is consequently only ever attached to materials that are
   ALREADY excluded from merging — one shared road material, one shared
   ground material, vehicle/glass materials, and the handful of merged
   output materials core/gfx.js promotes AFTER the batcher has run. It is
   never attached to the per-box materials CBZ.cmat()/CBZ.mat() hand out.

   PUBLIC API (safe for any other file to call):
     CBZ.surfaceMaps(name, opts) -> { map, normalMap, roughnessMap } | null
        opts: { repeat, res, srgb }   — cached per (name|repeat|res)
     CBZ.surfaceApply(material, name, opts) -> material
        attaches the maps + sane roughness/metalness/normalScale defaults
        for that surface, respects the live quality tier, sets
        material.needsUpdate, and no-ops on tier 0 / flag off.
     CBZ.surfaceDefaults(name) -> { roughness, metalness, normalScale, repeat }
     CBZ.surfaceNames -> string[]
   Names: asphalt, concrete, plaster, metal, dirt, grass, sand, wood, glass.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // GFX_SURFACE_TEX (owner: "make the world like 100x realer feeling").
  // On → CBZ.surfaceApply attaches procedural colour/normal/roughness maps.
  // Flip false (or ?cfg_GFX_SURFACE_TEX=0) for a one-line revert to the exact
  // prior untextured behaviour — every consumer feature-detects the return.
  if (CBZ.CONFIG.GFX_SURFACE_TEX == null) CBZ.CONFIG.GFX_SURFACE_TEX = true;
  // Base texture edge in pixels. Halved automatically on quality tiers 0-1.
  if (CBZ.CONFIG.GFX_SURFACE_RES == null) CBZ.CONFIG.GFX_SURFACE_RES = 256;
  // Anisotropic filtering cap for these maps. Roads seen at grazing angles are
  // the single biggest beneficiary; 4 is cheap on every GPU that reports it.
  if (CBZ.CONFIG.GFX_SURFACE_ANISO == null) CBZ.CONFIG.GFX_SURFACE_ANISO = 4;

  // ---- deterministic noise ------------------------------------------------
  // CBZ.hashN is the house order-independent avalanche hash (core/seed.js).
  // Lattice coordinates are wrapped modulo the octave period BEFORE hashing,
  // which is what makes every field below seamlessly tileable.
  const hashN = CBZ.hashN || function (a, b, c) {
    let h = ((a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  function lat(xi, yi, per, salt) {
    const x = ((xi % per) + per) % per, y = ((yi % per) + per) % per;
    return hashN(x, y, salt) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // periodic value noise on a `per`x`per` lattice
  function vnoise(x, y, per, salt) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = lat(xi, yi, per, salt), b = lat(xi + 1, yi, per, salt);
    const c = lat(xi, yi + 1, per, salt), d = lat(xi + 1, yi + 1, per, salt);
    const x0 = a + (b - a) * u, x1 = c + (d - c) * u;
    return x0 + (x1 - x0) * v;
  }
  // fbm over `oct` octaves; u,v are 0..1 texture coords, `base` the first period
  function fbm(u, v, base, oct, salt) {
    let amp = 0.5, per = base, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += vnoise(u * per, v * per, per, salt + o * 7919) * amp;
      norm += amp;
      amp *= 0.5; per *= 2;
    }
    return sum / (norm || 1);
  }
  // ridged variant — thin bright/dark veins (cracks, wood grain, sand ripples)
  function ridge(u, v, base, oct, salt) {
    return 1 - Math.abs(fbm(u, v, base, oct, salt) * 2 - 1);
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // ---- surface authors ----------------------------------------------------
  // Each author fills three parallel fields over an NxN grid:
  //   col   Float32Array(N*N*3)  linear-ish sRGB colour 0..1 (see srgb note)
  //   hgt   Float32Array(N*N)    height 0..1 -> becomes the normal map
  //   rgh   Float32Array(N*N)    roughness 0..1
  // Height is deliberately authored at a HIGHER frequency than colour: the
  // eye reads "material" from specular breakup far more than from albedo.
  const SURFACES = {
    // ---- detail: the world-projected micro normal core/gfx.js stamps on
    //      every merged surface at the tiers with `normals`. It USED to be
    //      the concrete author above (pores at 96 and grit at 200 per tile,
    //      tiled every 0.42 m at 0.55 strength) — which is why, on the
    //      fastest tier, a painted steel boom read as a painted steel boom
    //      and on the high tier the same boom read as sandpaper. A blanket
    //      detail map cannot know what it is on, so it may only carry what
    //      EVERY surface shares: a broad, soft undulation (a panel is never
    //      dead flat) and a faint medium breakup. No pores, no grit.
    detail: {
      def: { roughness: 0.88, metalness: 0.0, normalScale: 0.35, repeat: 1 },
      author: function (u, v, out) {
        const broad = fbm(u, v, 3, 2, 0x0d81);
        const mid = fbm(u, v, 11, 2, 0x0d82);
        const l = 0.5;
        out.r = l; out.g = l; out.b = l;
        out.h = broad * 0.72 + mid * 0.28;
        out.q = 0.88;
      },
    },
    // ---- asphalt: aggregate stones in bitumen, hairline cracks -----------
    asphalt: {
      def: { roughness: 0.92, metalness: 0.02, normalScale: 0.85, repeat: 6 },
      author: function (u, v, out) {
        const grain = fbm(u, v, 48, 3, 0x0a51);     // aggregate speckle
        const blotch = fbm(u, v, 4, 3, 0x0a52);     // patch/repair mottling
        const fine = fbm(u, v, 128, 1, 0x0a53);     // sub-stone grit
        const crack = Math.pow(clamp01(ridge(u, v, 6, 3, 0x0a54)), 22) * 0.9;
        const l = 0.16 + grain * 0.10 + blotch * 0.05 + fine * 0.03 - crack * 0.10;
        out.r = l * 1.00; out.g = l * 1.01; out.b = l * 1.06;   // asphalt reads faintly blue
        out.h = grain * 0.62 + fine * 0.30 - crack * 0.55;
        out.q = 0.97 - grain * 0.13 - blotch * 0.06;
      },
    },
    // ---- concrete: poured, pitted, water-stained -------------------------
    concrete: {
      def: { roughness: 0.90, metalness: 0.02, normalScale: 0.55, repeat: 4 },
      author: function (u, v, out) {
        const stain = fbm(u, v, 3, 4, 0x0b61);
        const pore = fbm(u, v, 96, 2, 0x0b62);
        const grit = fbm(u, v, 200, 1, 0x0b63);
        const l = 0.46 + stain * 0.16 - pore * 0.09 + grit * 0.04;
        out.r = l * 1.02; out.g = l * 1.00; out.b = l * 0.97;
        out.h = pore * 0.55 + grit * 0.25 + stain * 0.20;
        out.q = 0.94 - stain * 0.10 + pore * 0.05;
      },
    },
    // ---- plaster / stucco: troweled render on a facade -------------------
    plaster: {
      def: { roughness: 0.86, metalness: 0.0, normalScale: 0.65, repeat: 3 },
      author: function (u, v, out) {
        const trowel = fbm(u * 1.0, v * 0.42, 10, 3, 0x0c71);   // stretched sweeps
        const tooth = fbm(u, v, 72, 2, 0x0c72);
        const dirt = Math.pow(clamp01(1 - v + fbm(u, v, 5, 3, 0x0c73) * 0.35), 4) * 0.10;
        const l = 0.70 + trowel * 0.14 - tooth * 0.07 - dirt;
        out.r = l * 1.03; out.g = l * 1.00; out.b = l * 0.95;   // warm render
        out.h = trowel * 0.55 + tooth * 0.45;
        out.q = 0.88 - trowel * 0.08 + tooth * 0.08;
      },
    },
    // ---- painted metal: brushed panel, shallow dents, chipped paint ------
    metal: {
      def: { roughness: 0.40, metalness: 0.65, normalScale: 0.35, repeat: 3 },
      author: function (u, v, out) {
        const brush = fbm(u * 6.0, v * 0.25, 24, 2, 0x0d81);    // long streaks
        const dent = fbm(u, v, 7, 3, 0x0d82);
        const chip = Math.pow(clamp01(fbm(u, v, 26, 2, 0x0d83)), 7) * 0.8;
        const l = 0.55 + brush * 0.10 + dent * 0.06 - chip * 0.22;
        out.r = l * 1.00; out.g = l * 1.01; out.b = l * 1.04;
        out.h = brush * 0.35 + dent * 0.55 - chip * 0.35;
        out.q = 0.34 + brush * 0.14 + chip * 0.45;              // chips are matte
      },
    },
    // ---- dirt / gravel: loose ground, small stones -----------------------
    dirt: {
      def: { roughness: 0.96, metalness: 0.0, normalScale: 1.10, repeat: 8 },
      author: function (u, v, out) {
        const stone = Math.pow(fbm(u, v, 40, 2, 0x0e91), 1.6);
        const soil = fbm(u, v, 6, 4, 0x0e92);
        const grit = fbm(u, v, 150, 1, 0x0e93);
        const l = 0.24 + soil * 0.14 + stone * 0.12 + grit * 0.04;
        out.r = l * 1.16; out.g = l * 0.96; out.b = l * 0.72;   // earth brown
        out.h = stone * 0.70 + grit * 0.20 + soil * 0.10;
        out.q = 0.99 - stone * 0.06;
      },
    },
    // ---- grass: clumped blades, not a flat green sheet -------------------
    grass: {
      def: { roughness: 0.95, metalness: 0.0, normalScale: 0.75, repeat: 14 },
      author: function (u, v, out) {
        const clump = fbm(u, v, 9, 3, 0x0fa1);
        const blade = fbm(u * 0.35, v * 3.0, 90, 2, 0x0fa2);    // vertical streaks
        const dry = Math.pow(clamp01(fbm(u, v, 4, 3, 0x0fa3)), 3);
        const l = 0.24 + clump * 0.12 + blade * 0.08;
        out.r = l * (0.62 + dry * 0.62);
        out.g = l * 1.28;
        out.b = l * (0.50 + dry * 0.12);
        out.h = blade * 0.62 + clump * 0.38;
        out.q = 0.96 - clump * 0.05;
      },
    },
    // ---- sand: wind ripples + fine grain ---------------------------------
    sand: {
      def: { roughness: 0.93, metalness: 0.0, normalScale: 0.60, repeat: 10 },
      author: function (u, v, out) {
        const rip = 0.5 + 0.5 * Math.sin((v * 26 + fbm(u, v, 5, 2, 0x10b1) * 9) * Math.PI * 2 / 6);
        const drift = fbm(u, v, 7, 3, 0x10b2);
        const grain = fbm(u, v, 180, 1, 0x10b3);
        const l = 0.62 + rip * 0.07 + drift * 0.09 + grain * 0.03;
        out.r = l * 1.10; out.g = l * 1.01; out.b = l * 0.80;
        out.h = rip * 0.55 + drift * 0.30 + grain * 0.15;
        out.q = 0.95 - grain * 0.06;
      },
    },
    // ---- wood: ring grain along one axis, knots --------------------------
    wood: {
      def: { roughness: 0.68, metalness: 0.0, normalScale: 0.60, repeat: 4 },
      author: function (u, v, out) {
        const warp = fbm(u, v, 5, 3, 0x11c1);
        const rings = 0.5 + 0.5 * Math.sin((u * 18 + warp * 5.2) * Math.PI * 2 / 3);
        const fibre = fbm(u * 0.2, v * 4.0, 110, 2, 0x11c2);
        const knot = Math.pow(clamp01(fbm(u, v, 4, 2, 0x11c3)), 9) * 0.7;
        const l = 0.34 + rings * 0.13 + fibre * 0.05 - knot * 0.16;
        out.r = l * 1.28; out.g = l * 0.92; out.b = l * 0.58;
        out.h = rings * 0.55 + fibre * 0.35 - knot * 0.30;
        out.q = 0.62 + rings * 0.12 + knot * 0.20;
      },
    },
    // ---- glass grime: streaks + dust in the corners ----------------------
    // Mostly a ROUGHNESS map: clean glass mirrors, dirty glass scatters. The
    // colour field stays near-white so it can multiply a tinted glass mat.
    glass: {
      def: { roughness: 0.10, metalness: 0.10, normalScale: 0.18, repeat: 2 },
      author: function (u, v, out) {
        const run = fbm(u * 4.0, v * 0.30, 30, 3, 0x12d1);      // rain runs
        const dust = fbm(u, v, 8, 3, 0x12d2);
        const edge = Math.pow(clamp01(1 - Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) * 5), 3);
        const soil = clamp01(run * 0.5 + dust * 0.35 + edge * 0.5);
        const l = 0.94 - soil * 0.12;
        out.r = l; out.g = l * 1.005; out.b = l * 1.02;
        out.h = run * 0.6 + dust * 0.4;
        out.q = 0.05 + soil * 0.55;
      },
    },
  };

  CBZ.surfaceNames = Object.keys(SURFACES);
  CBZ.surfaceDefaults = function (name) {
    const s = SURFACES[name];
    return s ? { roughness: s.def.roughness, metalness: s.def.metalness, normalScale: s.def.normalScale, repeat: s.def.repeat } : null;
  };

  // ---- baking -------------------------------------------------------------
  // One bake per (name, resolution): the three canvases are produced together
  // because they share the same noise evaluation (evaluating the fields twice
  // would double the only expensive part of this file).
  const bakeCache = new Map();   // "name|res" -> { color, normal, rough } canvases
  const texCache = new Map();    // "name|res|repeat" -> { map, normalMap, roughnessMap }

  function bake(name, N) {
    const key = name + "|" + N;
    let got = bakeCache.get(key);
    if (got) return got;
    const s = SURFACES[name];
    if (!s) return null;

    const col = new Float32Array(N * N * 3);
    const hgt = new Float32Array(N * N);
    const rgh = new Float32Array(N * N);
    const out = { r: 0, g: 0, b: 0, h: 0, q: 0.9 };
    for (let y = 0; y < N; y++) {
      const v = y / N;
      for (let x = 0; x < N; x++) {
        const u = x / N;
        out.r = out.g = out.b = 0.5; out.h = 0.5; out.q = 0.9;
        s.author(u, v, out);
        const i = y * N + x;
        col[i * 3] = clamp01(out.r);
        col[i * 3 + 1] = clamp01(out.g);
        col[i * 3 + 2] = clamp01(out.b);
        hgt[i] = clamp01(out.h);
        rgh[i] = clamp01(out.q);
      }
    }

    // colour canvas
    const cCol = document.createElement("canvas"); cCol.width = cCol.height = N;
    const gCol = cCol.getContext("2d");
    const dCol = gCol.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      dCol.data[i * 4] = (col[i * 3] * 255) | 0;
      dCol.data[i * 4 + 1] = (col[i * 3 + 1] * 255) | 0;
      dCol.data[i * 4 + 2] = (col[i * 3 + 2] * 255) | 0;
      dCol.data[i * 4 + 3] = 255;
    }
    gCol.putImageData(dCol, 0, 0);

    // normal canvas — central differences on the height field, wrapped so the
    // normal map tiles as seamlessly as the height that produced it.
    const cNrm = document.createElement("canvas"); cNrm.width = cNrm.height = N;
    const gNrm = cNrm.getContext("2d");
    const dNrm = gNrm.createImageData(N, N);
    const STR = N * 0.028;    // slope gain: keeps apparent bumpiness res-independent
    for (let y = 0; y < N; y++) {
      const ym = (y - 1 + N) % N, yp = (y + 1) % N;
      for (let x = 0; x < N; x++) {
        const xm = (x - 1 + N) % N, xp = (x + 1) % N;
        const dx = (hgt[y * N + xp] - hgt[y * N + xm]) * STR;
        const dz = (hgt[yp * N + x] - hgt[ym * N + x]) * STR;
        // tangent-space normal of the height field
        let nx = -dx, ny = -dz, nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        const i = y * N + x;
        dNrm.data[i * 4] = ((nx * 0.5 + 0.5) * 255) | 0;
        dNrm.data[i * 4 + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
        dNrm.data[i * 4 + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
        dNrm.data[i * 4 + 3] = 255;
      }
    }
    gNrm.putImageData(dNrm, 0, 0);

    // roughness canvas (three.js samples the GREEN channel; we fill all three
    // so the same canvas can double as a metalness/AO source if ever needed)
    const cRgh = document.createElement("canvas"); cRgh.width = cRgh.height = N;
    const gRgh = cRgh.getContext("2d");
    const dRgh = gRgh.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const q = (rgh[i] * 255) | 0;
      dRgh.data[i * 4] = q; dRgh.data[i * 4 + 1] = q; dRgh.data[i * 4 + 2] = q; dRgh.data[i * 4 + 3] = 255;
    }
    gRgh.putImageData(dRgh, 0, 0);

    got = { color: cCol, normal: cNrm, rough: cRgh };
    bakeCache.set(key, got);
    return got;
  }

  function anisoCap() {
    const cap = +CBZ.CONFIG.GFX_SURFACE_ANISO || 0;
    if (cap <= 1) return 1;
    try {
      const max = CBZ.renderer && CBZ.renderer.capabilities && CBZ.renderer.capabilities.getMaxAnisotropy
        ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1;
      return Math.max(1, Math.min(cap, max));
    } catch (e) { return 1; }
  }

  function mkTex(canvas, repeat, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisoCap();
    // r128 encoding API (NOT .colorSpace — that lands in r152). Colour maps are
    // authored as sRGB bytes; normal/roughness are DATA and must stay linear.
    if (srgb && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }

  // Live texture resolution: half-size on the two cheapest tiers so a weak GPU
  // pays a quarter of the upload/sampling cost (tier 0 never gets here at all).
  function resFor() {
    const base = Math.max(64, +CBZ.CONFIG.GFX_SURFACE_RES || 256);
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    return q <= 1 ? Math.max(64, base >> 1) : base;
  }

  // Textures are OFF entirely on tier 0 (the emergency tier already kills the
  // shadow pass; it must stay at least as cheap as it is today) and whenever
  // the feature flag is down.
  function texturesOn() {
    if (!CBZ.CONFIG.GFX_SURFACE_TEX) return false;
    return (CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel) >= 1;
  }
  CBZ.surfaceTexOn = texturesOn;

  /* CBZ.surfaceMaps(name, opts)
     -> { map, normalMap, roughnessMap, defaults } or null when disabled.
     Cached: calling this a thousand times with the same (name, repeat) hands
     back the SAME three THREE.Texture instances, so a thousand materials cost
     one upload — and, more importantly, materials that share textures stay
     eligible to share a material instance. */
  function surfaceMaps(name, opts) {
    opts = opts || {};
    const s = SURFACES[name];
    if (!s) return null;
    if (opts.force !== true && !texturesOn()) return null;
    const N = opts.res ? Math.max(64, opts.res | 0) : resFor();
    const repeat = opts.repeat != null ? +opts.repeat : s.def.repeat;
    const key = name + "|" + N + "|" + repeat;
    let got = texCache.get(key);
    if (got) return got;
    const canvases = bake(name, N);
    if (!canvases) return null;
    got = {
      map: mkTex(canvases.color, repeat, opts.srgb !== false),
      normalMap: mkTex(canvases.normal, repeat, false),
      roughnessMap: mkTex(canvases.rough, repeat, false),
      defaults: s.def,
    };
    texCache.set(key, got);
    return got;
  }
  CBZ.surfaceMaps = surfaceMaps;

  /* CBZ.surfaceApply(material, name, opts)
     Attach the library to a MeshStandardMaterial (or anything that accepts the
     same fields). Silently no-ops on tier 0 / flag off / unknown name, so a
     caller can wire it unconditionally.
       opts.repeat        world tiling density (defaults per surface)
       opts.color         false → leave material.color/map alone (normal +
                          roughness only). Use this when the caller owns the
                          albedo (e.g. hash-tinted building facades).
       opts.normalScale   override the surface's default bump strength
       opts.roughness /
       opts.metalness     override the surface's PBR defaults              */
  function surfaceApply(material, name, opts) {
    opts = opts || {};
    if (!material) return material;
    const maps = surfaceMaps(name, opts);
    if (!maps) return material;
    const d = maps.defaults;
    if (opts.color !== false && "map" in material) material.map = maps.map;
    if ("normalMap" in material) {
      material.normalMap = maps.normalMap;
      const ns = opts.normalScale != null ? +opts.normalScale : d.normalScale;
      if (material.normalScale && material.normalScale.set) material.normalScale.set(ns, ns);
    }
    if ("roughnessMap" in material) material.roughnessMap = maps.roughnessMap;
    if ("roughness" in material) material.roughness = opts.roughness != null ? +opts.roughness : d.roughness;
    if ("metalness" in material) material.metalness = opts.metalness != null ? +opts.metalness : d.metalness;
    material.needsUpdate = true;
    return material;
  }
  CBZ.surfaceApply = surfaceApply;

  /* CBZ.surfaceStandard(name, opts) — convenience: a brand-new
     MeshStandardMaterial already dressed in a surface. opts.color sets the
     base tint (the surface albedo multiplies it). */
  CBZ.surfaceStandard = function (name, opts) {
    opts = opts || {};
    const m = new THREE.MeshStandardMaterial({
      color: opts.tint != null ? opts.tint : 0xffffff,
      roughness: 0.9,
      metalness: 0.0,
      envMap: CBZ.ENV || null,
    });
    return surfaceApply(m, name, opts);
  };
})();
