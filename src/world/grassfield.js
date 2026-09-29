/* ============================================================
   world/grassfield.js — REAL GRASS UNDER YOUR FEET.

   OWNER (2026-09-29): "when you just walk on grass, it's just fucking green.
   There's no actual grass. It just looks fake. All the ground looks fake."

   WHY IT LOOKED FAKE. Every lawn, park, verge and meadow in Gang City was a
   flat triangle with a painted texture: city/cityground.js's splat (blades
   drawn in a 512² map), metro_ground.js's lawn (one 14 cm hash square per
   texel), the continent's groundSkin (a grass photo multiplied into a vertex
   colour). Up close a painted texture is a carpet, and nothing stood up out
   of it. The one real grass renderer in the repo (src/integrations/grass.js,
   the vendored three-grass-demo) planted TWO 3 m discs at the two parks
   nearest the spawn, only in the Vite build (index.html never loads the
   module bridge), with an unlit ShaderMaterial that ignored the sun, fog and
   shadows, and skipped itself on tier 0. It was deleted with this file.

   WHAT IT IS NOW. Real blades, instanced on the GPU, in a disc round the
   camera, on every surface that is grass:

     COVER (CBZ.groundCover) — one question, asked of whoever owns the
       ground: "at (x,z), how much grass, how tall, what colour, and how
       high is the surface?" Providers register in priority order and the
       first that OWNS the point answers (an owner can answer "no grass",
       which is how a road or a house blocks the continent's meadow under
       it):
          10 city/cityground.js   the downtown + every town (the lot splat)
          20 city/metro_ground.js the metros (lawn pads, courtyards, parks;
                                  houses, drives, paths and lots excluded)
          90 city/continent.js    the backcountry plate (its own vertex
                                  colour decides meadow vs dirt vs sand;
                                  roads, POIs and water excluded)
       A provider returns the ground colour under the grass, so a blade is
       coloured FROM the surface it grows out of and the field fades into
       its own ground with no ring.

     BLADES — three pools (one draw call each), one per geometric LOD:
          L0  0-14 m   7-vertex curved blade (3 segments + tip)
          L1  14-32 m  5-vertex blade
          L2  32-R m   1 triangle
       Each blade is one instance: root (x,y,z), height, yaw, lean, a rank,
       a type (blade, clover/daisy, dandelion, vetch, seed head, broadleaf
       weed) and a colour (the ground's, varied by clump, with a dry tip).
       Mowed lawns are short and even; wild meadow is knee high in clumps
       with seed heads and flowers. Chunks of 6 x 6 m are generated on the
       CPU from a world-space jittered grid (so a blade is always in the
       same place) under a per-frame millisecond budget, nearest first.

     DISTANCE — no ring. Every blade has a rank r in [0,1). The share of
       blades wanted at distance d is (A/d)^2 (constant blades per screen
       area); a blade whose rank is above that share shrinks to nothing, the
       survivors widen by 1/sqrt(share) so the field keeps its coverage, and
       past 0.72 R everything sinks smoothly into the ground texture below.
       Chunks are generated with only the ranks their nearest point can
       ever need, so the far field costs far fewer blades than the near.

     LIFE — wind from systems/weather.js (direction + speed) as travelling
       gusts plus a per-blade flutter; the player (0.6 m) and the driven car
       (2.4 m) push the blades aside and flatten them.

     LIGHT — MeshLambertMaterial like the ground skin, normal bent toward
       up so a blade takes the ground's light (the handoff), both faces lit
       the same, receives the sun's shadow, fog scaled like the lot ground
       (terrainFogScale 0.10) so it hazes with what it stands on.

   BUDGET (per quality tier; iPad/phone x0.6 density; never zero):
          tier     0     1     2     3     4
          D0/m²   10    18    28    36    40    blades per m² inside A
          A m      6     8    10    10    12    full-density radius
          R m     28    40    56    64    68    grass ends (fades from 0.72R)
       Measured in plain node (tools/grass-check.mjs): a full meadow at tier
       3 is ~55k live blades (~280k vertices) in 3 draw calls; the downtown
       spawn a fraction of that.

   SEAM WITH THE FAR FIELD: the grass owns 0..R (<= 72 m); the ground
   shaders' near detail runs to ~250 m and hands the macro colour to the far
   field unchanged. Blades are coloured from the provider's ground colour,
   so whatever the far field paints into the continent's vertex colours is
   what the grass grows out of.

   API
     CBZ.groundCover.register(name, fn(x, z, out) -> owned, pri)
     CBZ.groundCover.at(x, z, out)
     CBZ.grassField.stats()        live counts, pools, ms
     CBZ.grassField.setEnabled(b)
     CBZ.grassField._gen / _tier   pure pieces (plain-node checks)
============================================================ */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G.CBZ = G.CBZ || {});
  // hot-loop Math, bound once (a global lookup per call is measurable here)
  const imul = Math.imul, floor = Math.floor, round = Math.round, sqrt = Math.sqrt, mmin = Math.min, mmax = Math.max;

  /* ==================================================================
     COVER REGISTRY
     ================================================================== */
  const providers = (CBZ._groundCoverProviders = CBZ._groundCoverProviders || []);
  function resetOut(o) {
    o.g = 0; o.y = 0; o.wild = 0; o.dry = 0; o.flw = 0; o.h = 1;
    o.r = 0.12; o.gr = 0.2; o.b = 0.05; o.src = "";
    return o;
  }
  CBZ.groundCover = {
    register: function (name, fn, pri) {
      for (let i = 0; i < providers.length; i++) if (providers[i].name === name) providers.splice(i--, 1);
      providers.push({ name: name, fn: fn, pri: pri == null ? 50 : pri });
      providers.sort(function (a, b) { return a.pri - b.pri; });
    },
    at: function (x, z, out) {
      resetOut(out);
      for (let i = 0; i < providers.length; i++) {
        let owned = false;
        try { owned = providers[i].fn(x, z, out); } catch (e) { owned = false; }
        if (owned) { out.src = providers[i].name; return true; }
      }
      return false;
    },
    providers: function () { return providers.map(function (p) { return p.name + "@" + p.pri; }); },
  };

  /* ==================================================================
     TIERS
     ================================================================== */
  const TIERS = [
    { D0: 10, A: 6, R: 28 },
    { D0: 18, A: 8, R: 40 },
    { D0: 28, A: 10, R: 56 },
    { D0: 36, A: 10, R: 64 },
    { D0: 40, A: 12, R: 68 },
  ];
  const CHUNK = 6;
  const RING = [14, 32];            // L0 | L1 | L2 boundaries (m)
  const HYST = 2;                   // a chunk keeps its ranks this much closer
  function tier(q, device) {
    const t = TIERS[Math.max(0, Math.min(4, q == null ? 2 : q | 0))];
    const k = device && device !== "desktop" ? 0.6 : 1;
    return { D0: Math.max(6, Math.round(t.D0 * k)), A: t.A, R: t.R, q: q };
  }
  function want(d, T) { if (d <= T.A) return 1; const k = T.A / d; return k * k; }

  /* ==================================================================
     HASHES (world-space, seed-free: a blade is always where it was)
     ================================================================== */
  function hash(ix, iz, s) {
    let h = imul(ix | 0, 374761393) ^ imul(iz | 0, 668265263) ^ imul(s | 0, 2246822519);
    h = imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function sm(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, z, s) {
    const xi = floor(x), zi = floor(z), tx = sm(x - xi), tz = sm(z - zi);
    const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }

  // blade types (the shader keys width profile + head colour off these)
  const T_BLADE = 0, T_WHITE = 1, T_YELLOW = 2, T_PURPLE = 3, T_SEED = 4, T_WEED = 5;

  /* ==================================================================
     NEAR == FAR. The owner: "long distance and short distance should look
     the same; what changes is the horizon you can see, not what's in it."
     A flower's head is not the ground's colour, so a field with flowers in
     it would average lighter than the ground it fades into. So the green
     blades are pre-compensated, per channel, for the flowers and seed heads
     the same cover will grow: the AREA-weighted mean of the whole population
     (blade gradient, heads, relative sizes, all mirrored from the vertex
     shader below) is exactly the ground colour. tools/grass-check.mjs
     re-derives it independently through the tone map.
     ================================================================== */
  const HEADS = [null, [0.78, 0.78, 0.72], [0.82, 0.56, 0.035], [0.32, 0.15, 0.48], null, null];
  // per type: I = area per (height x width unit), A = mean non-head colour
  // coefficient (gradient), Hs = head share of the area — the shader's own
  // profile / height remap / gradient, integrated
  function typeStats(type) {
    let I = 0, A = 0, Hs = 0;
    const N = 128;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N;
      let prof = Math.pow(1 - t, 0.8), dy = 1, y = t, head = 0;
      if (type >= 1 && type <= 3) { dy = t < 0.4 ? 2.1 : 0.27; y = t < 0.4 ? t * 2.1 : 0.84 + (t - 0.4) * 0.27; prof = t < 0.2 ? 0.35 : t < 0.9 ? 1.5 : 0; head = t >= 0.2 ? 1 : 0; }
      else if (type === 4) { prof = t < 0.5 ? 0.55 : t < 0.9 ? 1.25 : 0; head = Math.min(1, Math.max(0, (t - 0.45) / 0.15)); head = head * head * (3 - 2 * head); }
      else if (type === 5) { prof = Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * 1.4; dy = 0.6; y = t * 0.6; }
      const w = prof * dy / N;
      I += w; A += w * (0.7 + 0.9 * y) * (1 - head); Hs += w * head;
    }
    return { I: I, A: A / I, Hs: Hs / I };
  }
  const TS = [0, 1, 2, 3, 4, 5].map(typeStats);
  const WEEDTINT = [0.85, 0.95, 0.8], SEEDTINT = [1.5, 1.2, 0.7];
  // population weights (share x mean height x mean width x area) of each
  // type for a cover — the generator's own rules below, in expectation
  function population(wild, flw, dry, w) {
    for (let t = 0; t < 6; t++) w[t] = 0;
    if (wild < 0.5) {
      const f = Math.min(1, flw * 0.9) / 0.9;
      w[0] = (1 - 0.9 * f) * 1.0 * 1.05; w[1] = 0.55 * f * 0.8 * 1.05; w[5] = 0.2 * f * 0.55 * 2.2; w[2] = 0.15 * f * 1.3 * 1.05;
    } else {
      const sd = Math.min(1, 0.12 + 0.2 * dry), f = Math.min(1 - sd, flw);
      w[0] = (1 - sd - f) * 1.25; w[4] = sd * 1.25;
      w[1] = 0.4 * f * 1.25; w[2] = 0.35 * f * 1.25; w[3] = 0.15 * f * 1.25; w[5] = 0.1 * f * 0.35 * 2.6;
    }
    for (let t = 0; t < 6; t++) w[t] *= TS[t].I;
    return w;
  }
  const _pw = new Float64Array(6), _K = new Float64Array(3);
  // per-channel factor for the green blades (blade + weed) so the mean is c
  let _mk0 = -1, _mk1 = -1, _mk2 = -1, _mk3 = -1, _mk4 = -1, _mk5 = -1;
  function compensate(wild, flw, dry, c0, c1, c2, K) {
    // the cover is constant over most of a chunk: remember the last answer
    if (wild === _mk0 && flw === _mk1 && dry === _mk2 && c0 === _mk3 && c1 === _mk4 && c2 === _mk5) return K;
    _mk0 = wild; _mk1 = flw; _mk2 = dry; _mk3 = c0; _mk4 = c1; _mk5 = c2;
    population(wild, flw, dry, _pw);
    let W = 0; for (let t = 0; t < 6; t++) W += _pw[t];
    for (let ch = 0; ch < 3; ch++) {
      const cc = Math.max(1e-4, ch === 0 ? c0 : ch === 1 ? c1 : c2);
      let fixed = 0;
      for (let t = 1; t <= 3; t++) fixed += _pw[t] * (TS[t].A * cc + TS[t].Hs * HEADS[t][ch]);
      fixed += _pw[4] * (TS[4].A + TS[4].Hs * SEEDTINT[ch]) * cc;     // seed heads ripen FROM the ground's colour
      const green = (_pw[0] * TS[0].A + _pw[5] * TS[5].A * WEEDTINT[ch]) * cc;
      K[ch] = green > 0 ? Math.max(0.2, Math.min(1.25, (W * cc - fixed) / green)) : 1;
    }
    return K;
  }

  /* ==================================================================
     CHUNK GENERATOR — pure. Writes blades into typed arrays at `at`,
     returns the count. `frac` = the largest rank share this chunk needs.
     ================================================================== */
  const CG = 0.25;                  // cover sample spacing (m)
  const CN = round(CHUNK / CG) + 1;
  const covG = new Float32Array(CN * CN), covY = new Float32Array(CN * CN), covW = new Float32Array(CN * CN);
  const covD = new Float32Array(CN * CN), covF = new Float32Array(CN * CN), covH = new Float32Array(CN * CN);
  const covC = new Float32Array(CN * CN * 3);
  const covSet = new Uint8Array(CN * CN);
  const covK1 = new Float32Array(CN * CN), covK2 = new Float32Array(CN * CN);
  const cout = resetOut({});
  function gen(cx0, cz0, frac, T, cover, A, at, cap) {
    // A: { pos: F32 x4, par: F32 x4, col: U8 x4 }
    covSet.fill(0);
    const s = 1 / sqrt(T.D0);
    const i0 = Math.ceil(cx0 / s), i1 = floor((cx0 + CHUNK - 1e-6) / s);
    const j0 = Math.ceil(cz0 / s), j1 = floor((cz0 + CHUNK - 1e-6) / s);
    let n = 0;
    function sample(k, x, z) {
      if (covSet[k]) return;
      covSet[k] = 1;
      if (!cover(x, z, cout)) { covG[k] = 0; return; }
      covG[k] = cout.g; covY[k] = cout.y; covW[k] = cout.wild; covD[k] = cout.dry; covF[k] = cout.flw; covH[k] = cout.h;
      covC[k * 3] = cout.r; covC[k * 3 + 1] = cout.gr; covC[k * 3 + 2] = cout.b;
      // the clump fields, once per 25 cm sample instead of once per blade
      covK1[k] = vnoise(x / 1.3, z / 1.3, 23); covK2[k] = vnoise(x / 4.1, z / 4.1, 29);
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const r = hash(i, j, 11);
        if (r >= frac) continue;
        const x = (i + (hash(i, j, 13) - 0.5) * 0.9) * s, z = (j + (hash(i, j, 17) - 0.5) * 0.9) * s;
        // nearest cover sample decides the density; the 4 round it the height
        let gx = (x - cx0) / CG, gz = (z - cz0) / CG;
        if (gx < 0) gx = 0; else if (gx > CN - 1.001) gx = CN - 1.001;
        if (gz < 0) gz = 0; else if (gz > CN - 1.001) gz = CN - 1.001;
        const nx = round(gx), nz = round(gz), kn = nz * CN + nx;
        sample(kn, cx0 + nx * CG, cz0 + nz * CG);
        const g = covG[kn];
        if (g <= 0.001 || hash(i, j, 19) >= g) continue;
        if (n >= cap) return n;
        // surface height: bilinear over the 4 samples round the blade
        const bx = gx | 0, bz = gz | 0, tx = gx - bx, tz = gz - bz;
        const k00 = bz * CN + bx, k10 = k00 + 1, k01 = k00 + CN, k11 = k01 + 1;
        sample(k00, cx0 + bx * CG, cz0 + bz * CG); sample(k10, cx0 + (bx + 1) * CG, cz0 + bz * CG);
        sample(k01, cx0 + bx * CG, cz0 + (bz + 1) * CG); sample(k11, cx0 + (bx + 1) * CG, cz0 + (bz + 1) * CG);
        let y;
        if (covG[k00] > 0 && covG[k10] > 0 && covG[k01] > 0 && covG[k11] > 0) {
          const ya = covY[k00] + (covY[k10] - covY[k00]) * tx, yb = covY[k01] + (covY[k11] - covY[k01]) * tx;
          y = ya + (yb - ya) * tz;
        } else y = covY[kn];
        const wild = covW[kn], dry = covD[kn], flw = covF[kn], hk = covH[kn];
        // CLUMPS: a 1.3 m + 4 m field lifts / drops whole tussocks and
        // shifts their green (a meadow is never one height or one colour)
        const c1 = covK1[kn], c2 = covK2[kn];
        const clump = c1 * 0.6 + c2 * 0.4;
        let type = T_BLADE, h, wm, bend;
        const hr = hash(i, j, 31), hf = hash(i, j, 37);
        if (wild < 0.5) {
          // MOWED: 6-11 cm, even, a little overgrown where the clump says so
          h = (0.06 + 0.035 * hr + 0.025 * clump) * hk;
          wm = 0.8 + 0.5 * hash(i, j, 41);
          bend = 0.15 + 0.35 * hash(i, j, 43);
          if (hf < flw * 0.9) { type = hf < flw * 0.55 ? T_WHITE : (hf < flw * 0.75 ? T_WEED : T_YELLOW); }
          if (type === T_WHITE) h *= 0.8;                 // clover sits in the sward
          if (type === T_YELLOW) h *= 1.3;
          if (type === T_WEED) { h *= 0.55; wm = 2.2; }
        } else {
          // WILD MEADOW: 20-65 cm in clumps, seed heads, flowers, weeds
          h = (0.2 + 0.25 * hr + 0.3 * clump * clump) * hk * (0.5 + 0.5 * wild);
          wm = 0.9 + 0.7 * hash(i, j, 41);
          bend = 0.25 + 0.55 * hash(i, j, 43);
          const seed = 0.12 + 0.2 * dry;
          if (hf < seed) type = T_SEED;
          else if (hf < seed + flw) {
            const q = (hf - seed) / mmax(1e-4, flw);
            type = q < 0.4 ? T_WHITE : q < 0.75 ? T_YELLOW : q < 0.9 ? T_PURPLE : T_WEED;
            if (type === T_WEED) { h *= 0.35; wm = 2.6; } else h *= 0.85 + 0.3 * hash(i, j, 47);
          }
        }
        // colour: the ground's own green, varied per clump and per blade
        const k3 = kn * 3;
        const v = (0.86 + 0.28 * hash(i, j, 53)) * (0.9 + 0.2 * c2);
        const warm = (clump - 0.5) * 0.16 + (hash(i, j, 59) - 0.5) * 0.08;
        let cr = covC[k3] * v * (1 + warm), cg = covC[k3 + 1] * v, cb = covC[k3 + 2] * v * (1 - warm);
        if (type === T_BLADE || type === T_WEED) {
          compensate(wild, flw, dry, covC[k3], covC[k3 + 1], covC[k3 + 2], _K);
          cr *= _K[0]; cg *= _K[1]; cb *= _K[2];
          if (type === T_WEED) { cr *= WEEDTINT[0]; cg *= WEEDTINT[1]; cb *= WEEDTINT[2]; }
        }
        const p = (at + n) * 4;
        A.pos[p] = x; A.pos[p + 1] = y; A.pos[p + 2] = z; A.pos[p + 3] = h;
        A.par[p] = hash(i, j, 61) * 6.2832; A.par[p + 1] = bend; A.par[p + 2] = r; A.par[p + 3] = type * 4 + mmin(3.9, wm);
        A.col[p] = round(sqrt(mmin(1, cr)) * 255);
        A.col[p + 1] = round(sqrt(mmin(1, cg)) * 255);
        A.col[p + 2] = round(sqrt(mmin(1, cb)) * 255);
        // tip variation, symmetric round 0.5 (the shader keeps it zero-mean);
        // drier ground and wild grass vary more
        A.col[p + 3] = round(mmax(0, mmin(1, 0.5 + (hash(i, j, 67) - 0.5) * (0.5 + 0.5 * dry + 0.3 * wild))) * 255);
        n++;
      }
    }
    return n;
  }

  /* ==================================================================
     THE SHADER (Lambert, patched)
     ================================================================== */
  const VERT_PARS = [
    "attribute vec4 aGfPos;", "attribute vec4 aGfPar;", "attribute vec4 aGfCol;",
    "uniform vec4 uGfWind;",        // dir x, dir z, strength, time
    "uniform vec4 uGfLod;",         // A, R, fade start, max widen
    "uniform vec4 uGfPush[2];",     // x, z, radius, strength
    "varying vec3 vGfCol;",
  ].join("\n");
  const VERT_BEGIN = [
    "float gfT = position.y;",
    "vec3 gfRoot = aGfPos.xyz;",
    "float gfH = aGfPos.w;",
    "float gfType = floor( aGfPar.w / 4.0 );",
    "float gfWm = aGfPar.w - gfType * 4.0;",
    "float gfD = distance( gfRoot, cameraPosition );",
    // the share of blades this distance wants; survivors widen to keep coverage
    "float gfA = uGfLod.x / max( gfD, uGfLod.x );",
    "float gfWant = gfA * gfA * ( 1.0 - smoothstep( uGfLod.z, uGfLod.y, gfD ) );",
    // (smoothstep with equal edges is undefined in GLSL: guard the far end)
    "float gfKeep = gfWant > 1e-4 ? 1.0 - smoothstep( gfWant * 0.72, gfWant, aGfPar.z ) : 0.0;",
    "gfH *= gfKeep;",
    "vec3 transformed = gfRoot;",
    "vec3 gfN = vec3( 0.0, 1.0, 0.0 );",
    "vGfCol = vec3( 0.0 );",
    "if ( gfH > 0.003 ) {",
    "  float gfWiden = min( uGfLod.w, inversesqrt( max( gfWant, 0.02 ) ) );",
    // width profile + height remap per type (flowers: stalk, then a head)
    "  float gfW = 0.022 * gfWm;",
    "  float gfProf = pow( 1.0 - gfT, 0.8 );",
    "  float gfY = gfT;",
    "  float gfHead = 0.0;",
    "  if ( gfType > 0.5 && gfType < 3.5 ) {",               // flowers
    "    gfY = gfT < 0.4 ? gfT * 2.1 : 0.84 + ( gfT - 0.4 ) * 0.27;",
    "    gfProf = gfT < 0.2 ? 0.35 : ( gfT < 0.9 ? 1.5 : 0.0 );",
    "    gfHead = step( 0.2, gfT );",
    "    gfW = 0.013 * gfWm;",
    "  } else if ( gfType > 3.5 && gfType < 4.5 ) {",        // seed head
    "    gfProf = gfT < 0.5 ? 0.55 : ( gfT < 0.9 ? 1.25 : 0.0 );",
    "    gfHead = smoothstep( 0.45, 0.6, gfT );",
    "  } else if ( gfType > 4.5 ) {",                        // broadleaf weed: a rosette leaf
    "    gfProf = sin( 3.1416 * clamp( gfT * 0.9 + 0.1, 0.0, 1.0 ) ) * 1.4;",
    "    gfY = gfT * 0.6;",
    "  }",
    "  gfW *= gfProf * gfWiden;",
    "  float gfYaw = aGfPar.x;",
    "  vec2 gfAcross = vec2( cos( gfYaw ), sin( gfYaw ) );",
    "  vec2 gfFace = vec2( -gfAcross.y, gfAcross.x );",
    // lean: the blade's own curl plus the wind (travelling gusts + flutter)
    "  vec2 gfOff = gfFace * aGfPar.y * 0.55;",
    "  float gfPh = dot( gfRoot.xz, uGfWind.xy ) * 0.21 - uGfWind.w * 1.7;",
    "  float gfGust = 0.55 + 0.45 * sin( gfPh ) * sin( gfPh * 0.37 + 1.3 );",
    "  float gfFl = sin( uGfWind.w * 3.3 + gfYaw * 5.0 + gfRoot.x * 1.7 + gfRoot.z * 1.3 ) * 0.28;",
    "  gfOff += uGfWind.xy * uGfWind.z * ( gfGust + gfFl ) * 0.6;",
    // the player and the driven car push the blades aside and flatten them
    "  for ( int i = 0; i < 2; i++ ) {",
    "    vec2 gfDv = gfRoot.xz - uGfPush[ i ].xy;",
    "    float gfDl = length( gfDv );",
    "    float gfK = ( 1.0 - smoothstep( uGfPush[ i ].z * 0.35, uGfPush[ i ].z, gfDl ) ) * uGfPush[ i ].w;",
    "    gfOff += ( gfDv / max( gfDl, 1e-3 ) ) * gfK * 1.6;",
    "  }",
    "  float gfBend = min( length( gfOff ), 1.4 );",
    "  gfOff = gfBend > 1e-4 ? gfOff / length( gfOff ) * gfBend : vec2( 0.0 );",
    "  float gfT2 = gfY * gfY;",
    "  vec2 gfTip = gfOff * gfH * gfT2;",
    // keep the blade's length: what leans over comes down
    "  float gfUp = gfH * gfY * ( 1.0 - 0.32 * gfBend * gfBend * gfY );",
    "  transformed = gfRoot + vec3( gfAcross.x * gfW * position.x + gfTip.x, max( gfUp, 0.0 ) + 0.004, gfAcross.y * gfW * position.x + gfTip.y );",
    // normal bent toward up: a blade takes the ground's light
    "  gfN = normalize( vec3( gfFace.x * 0.35 - gfOff.x * 0.2, 1.0, gfFace.y * 0.35 - gfOff.y * 0.2 ) );",
    // colour: dark root (the thatch shades it), bright tip, a dry tip,
    // width-weighted mean = the ground colour (no ring at the fade)
    "  vec3 gfC = aGfCol.rgb * aGfCol.rgb;",
    "  float gfGrad = 0.7 + 0.9 * gfY;",
    // tip variation is ZERO-MEAN round the ground colour (alpha 0.5 = none):
    // some tips sun-dried toward straw, as many a deeper green, so the
    // field's average is the ground's own colour at every distance
    "  float gfTv = ( aGfCol.a * 2.0 - 1.0 ) * smoothstep( 0.35, 1.0, gfY );",
    "  gfC *= 1.0 + gfTv * vec3( 0.30, 0.06, -0.40 );",
    "  gfC *= gfGrad;",
    "  if ( gfHead > 0.0 ) {",
    "    vec3 gfHc = gfType < 1.5 ? vec3( 0.78, 0.78, 0.72 ) : ( gfType < 2.5 ? vec3( 0.82, 0.56, 0.035 ) : ( gfType < 3.5 ? vec3( 0.32, 0.15, 0.48 ) : aGfCol.rgb * aGfCol.rgb * vec3( 1.5, 1.2, 0.7 ) ) );",
    "    gfC = mix( gfC, gfHc, gfHead );",
    "  }",
    "  vGfCol = gfC;",
    "}",
  ].join("\n");

  function makeMaterial(THREE, U) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    mat.name = "grass-blades";
    mat.onBeforeCompile = function (sh) {
      const vs = sh.vertexShader;
      if (vs.indexOf("#include <begin_vertex>") < 0 || vs.indexOf("#include <beginnormal_vertex>") < 0) return;
      Object.assign(sh.uniforms, U);
      // three computes the normal BEFORE the position; the blade's frame is
      // built in the position block, so hoist that block above the normal
      let v = vs.replace("#include <common>", "#include <common>\n" + VERT_PARS);
      v = v.replace("#include <beginnormal_vertex>", VERT_BEGIN + "\nvec3 objectNormal = gfN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( 1.0, 0.0, 0.0 );\n#endif");
      v = v.replace("#include <begin_vertex>", "");
      // one light for both faces: a thin blade is lit through
      v = v.replace("#include <lights_lambert_vertex>", "#include <lights_lambert_vertex>\n#ifdef DOUBLE_SIDED\nvLightBack = vLightFront;\nvIndirectBack = vIndirectFront;\n#endif");
      sh.vertexShader = v;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGfCol;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vGfCol;");
    };
    mat.customProgramCacheKey = function () { return "cbzGrassField1"; };
    // hazes with the lot ground it stands on (same scale as streetkit's lotMesh)
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(mat, 0.10);
    return mat;
  }

  // base blade per LOD: x = side (-1..1), y = t along the blade
  function bladeGeometry(THREE, lod) {
    let P, I;
    if (lod === 0) {
      P = [-1, 0, 1, 0, -1, 0.33, 1, 0.33, -1, 0.66, 1, 0.66, 0, 1];
      I = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
    } else if (lod === 1) {
      P = [-1, 0, 1, 0, -1, 0.5, 1, 0.5, 0, 1];
      I = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    } else {
      P = [-1, 0, 1, 0, 0, 1];
      I = [0, 1, 2];
    }
    const pos = new Float32Array((P.length / 2) * 3);
    for (let i = 0; i < P.length / 2; i++) { pos[i * 3] = P[i * 2]; pos[i * 3 + 1] = P[i * 2 + 1]; }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(I);
    return g;
  }

  /* ==================================================================
     POOLS — one InstancedBufferGeometry per LOD, a first-fit range
     allocator inside it (a chunk's blades are contiguous), instanceCount
     = the high-water mark, so vertex work tracks the blades actually live.
     ================================================================== */
  function Pool(THREE, lod, cap, mat) {
    this.cap = cap;
    this.A = { pos: new Float32Array(cap * 4), par: new Float32Array(cap * 4), col: new Uint8Array(cap * 4) };
    this.free = [[0, cap]];
    this.hwm = 0; this.used = 0;
    this.dirty0 = Infinity; this.dirty1 = -1;
    if (!THREE) return;
    const g = bladeGeometry(THREE, lod);
    this.aPos = new THREE.InstancedBufferAttribute(this.A.pos, 4);
    this.aPar = new THREE.InstancedBufferAttribute(this.A.par, 4);
    this.aCol = new THREE.InstancedBufferAttribute(this.A.col, 4, true);
    [this.aPos, this.aPar, this.aCol].forEach(function (a) { if (a.setUsage) a.setUsage(THREE.DynamicDrawUsage); });
    g.setAttribute("aGfPos", this.aPos); g.setAttribute("aGfPar", this.aPar); g.setAttribute("aGfCol", this.aCol);
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, mat);
    m.name = "grass-field-L" + lod;
    m.frustumCulled = false;            // the field is always round the camera
    m.castShadow = false; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.userData.grassField = true; m.userData.noBatch = true; m.userData.roadPaint = true;
    this.mesh = m; this.geo = g;
  }
  Pool.prototype.alloc = function (n) {
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f[1] >= n) {
        const s = f[0];
        f[0] += n; f[1] -= n;
        if (!f[1]) this.free.splice(i, 1);
        this.used += n;
        if (s + n > this.hwm) this.hwm = s + n;
        return s;
      }
    }
    return -1;
  };
  Pool.prototype.release = function (s, n) {
    if (n <= 0) return;
    // collapse the blades (height 0) so a stale range under the hwm draws nothing
    for (let k = s; k < s + n; k++) this.A.pos[k * 4 + 3] = 0;
    this.mark(s, n);
    this.used -= n;
    const F = this.free;
    let i = 0;
    while (i < F.length && F[i][0] < s) i++;
    F.splice(i, 0, [s, n]);
    if (i + 1 < F.length && F[i][0] + F[i][1] === F[i + 1][0]) { F[i][1] += F[i + 1][1]; F.splice(i + 1, 1); }
    if (i > 0 && F[i - 1][0] + F[i - 1][1] === F[i][0]) { F[i - 1][1] += F[i][1]; F.splice(i, 1); }
    // lower the high-water mark when the tail frees up
    const last = F[F.length - 1];
    if (last && last[0] + last[1] === this.cap) this.hwm = Math.min(this.hwm, last[0]);
  };
  Pool.prototype.mark = function (s, n) {
    if (s < this.dirty0) this.dirty0 = s;
    if (s + n > this.dirty1) this.dirty1 = s + n;
  };
  Pool.prototype.flush = function () {
    if (!this.geo) return;
    this.geo.instanceCount = this.hwm;
    this.mesh.visible = this.hwm > 0;
    if (this.dirty1 < 0) return;
    const off = this.dirty0, cnt = this.dirty1 - this.dirty0;
    [this.aPos, this.aPar, this.aCol].forEach(function (a) {
      a.updateRange.offset = off * 4; a.updateRange.count = cnt * 4; a.needsUpdate = true;
    });
    this.dirty0 = Infinity; this.dirty1 = -1;
  };
  Pool.prototype.dispose = function () {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.geo) this.geo.dispose();
  };

  /* ==================================================================
     THE FIELD — chunk set round the camera, regenerated under a budget
     ================================================================== */
  const scratch = { pos: null, par: null, col: null };
  function Field(THREE, T, scene) {
    this.T = T;
    this.U = {
      uGfWind: { value: THREE ? new THREE.Vector4(1, 0, 0.3, 0) : null },
      uGfLod: { value: THREE ? new THREE.Vector4(T.A, T.R, T.R * 0.72, 3.2) : null },
      uGfPush: { value: THREE ? [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] : null },
    };
    this.mat = THREE ? makeMaterial(THREE, this.U) : null;
    // capacity per LOD, measured not guessed: the camera at 25 spots inside
    // a chunk, every chunk it would hold at each LOD with the ranks it
    // would carry, wall-to-wall grass; the worst spot, +25 % for a chunk
    // regenerating (its old range is freed first) and allocator slack
    const cap = [0, 0, 0];
    for (let sx = 0; sx < 5; sx++) for (let sz = 0; sz < 5; sz++) {
      const cx = (sx + 0.5) * CHUNK / 5, cz = (sz + 0.5) * CHUNK / 5, need = [0, 0, 0];
      const n = Math.ceil(T.R / CHUNK) + 1;
      for (let ci = -n; ci <= n; ci++) for (let cj = -n; cj <= n; cj++) {
        const x0 = ci * CHUNK, z0 = cj * CHUNK;
        const dx = cx < x0 ? x0 - cx : cx > x0 + CHUNK ? cx - x0 - CHUNK : 0;
        const dz = cz < z0 ? z0 - cz : cz > z0 + CHUNK ? cz - z0 - CHUNK : 0;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > T.R) continue;
        need[lodOf(d)] += Math.ceil(CHUNK * CHUNK * T.D0 * fracFor(d, T) * 1.05);
      }
      for (let l = 0; l < 3; l++) cap[l] = Math.max(cap[l], need[l]);
    }
    for (let l = 0; l < 3; l++) cap[l] = Math.ceil(cap[l] * 1.25 + CHUNK * CHUNK * T.D0 * 1.2);
    this.pools = cap.map(function (c, l) { return new Pool(THREE, l, c, this.mat); }, this);
    if (scene) for (const p of this.pools) scene.add(p.mesh);
    this.chunks = new Map();      // key -> { cx, cz, lod, frac, s, n }
    this.stats = { chunks: 0, blades: 0, genMs: 0, gens: 0, starved: 0, lastGenMs: 0 };
  }
  function lodOf(d) { return d < RING[0] ? 0 : d < RING[1] ? 1 : 2; }
  // the share a chunk must carry: what its nearest point wants, a step
  // closer, rounded UP to a half-octave (1, .71, .5, .35 ...) so a chunk you
  // walk toward regenerates a dozen times on the way in, not every frame
  function fracFor(d, T) {
    const w = Math.min(1, want(Math.max(0, d - HYST), T));
    if (w >= 1) return 1;
    const k = Math.floor(-2 * Math.log2(w));
    return Math.min(1, Math.pow(2, -k / 2));
  }
  Field.prototype.update = function (camX, camZ, budgetMs, now, cover) {
    const T = this.T, R = T.R;
    // at rest with nothing owed: nothing to do (the blades are on the GPU)
    if (this._idle && Math.abs(camX - this._cx) < 0.25 && Math.abs(camZ - this._cz) < 0.25) return 0;
    this._cx = camX; this._cz = camZ;
    const ci0 = Math.floor((camX - R) / CHUNK), ci1 = Math.floor((camX + R) / CHUNK);
    const cj0 = Math.floor((camZ - R) / CHUNK), cj1 = Math.floor((camZ + R) / CHUNK);
    const todo = [];
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const x0 = ci * CHUNK, z0 = cj * CHUNK;
      const dx = camX < x0 ? x0 - camX : camX > x0 + CHUNK ? camX - x0 - CHUNK : 0;
      const dz = camZ < z0 ? z0 - camZ : camZ > z0 + CHUNK ? camZ - z0 - CHUNK : 0;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > R) continue;
      const key = ci * 65536 + cj;
      seen.add(key);
      const c = this.chunks.get(key);
      const lod = lodOf(d), frac = fracFor(d, T);
      // regenerate when it moved to a finer LOD or needs more ranks than it has
      if (!c) todo.push({ key: key, ci: ci, cj: cj, d: d, lod: lod, frac: frac, p: d });
      else if (lod < c.lod || frac > c.frac + 1e-6) todo.push({ key: key, ci: ci, cj: cj, d: d, lod: lod, frac: frac, p: d });
      // receding: coarser geometry and fewer ranks, once clearly past the
      // boundary, and only after everything that is missing or too thin
      else if (lod > c.lod && d > (lod === 1 ? RING[0] : RING[1]) + HYST * 2) {
        // a finer pool under pressure lets go of what it no longer needs at
        // once (usually behind you); it grows back coarser after the rest
        const fp = this.pools[c.lod];
        if (fp.used > fp.cap * 0.8) { fp.release(c.s, c.n); this.chunks.delete(key); todo.push({ key: key, ci: ci, cj: cj, d: d, lod: lod, frac: frac, p: d + 500 }); }
        else todo.push({ key: key, ci: ci, cj: cj, d: d, lod: lod, frac: frac, p: d + 1000 });
      }
    }
    // drop everything out of range
    for (const [key, c] of this.chunks) if (!seen.has(key)) { this.pools[c.lod].release(c.s, c.n); this.chunks.delete(key); }
    todo.sort(function (a, b) { return a.p - b.p; });
    const t0 = now();
    let gens = 0;
    for (const t of todo) {
      if (gens > 0 && now() - t0 > budgetMs) break;
      const pool = this.pools[t.lod];
      // generate into a scratch block, then copy into a fresh range
      const need = Math.ceil(CHUNK * CHUNK * T.D0 * t.frac * 1.15) + 8;
      if (!scratch.pos || scratch.pos.length < need * 4) {
        scratch.pos = new Float32Array(need * 4 * 2); scratch.par = new Float32Array(need * 4 * 2); scratch.col = new Uint8Array(need * 4 * 2);
      }
      const old = this.chunks.get(t.key);
      if (pool.cap - pool.used + (old && old.lod === t.lod ? old.n : 0) < need) { this.stats.starved++; continue; }
      const n = gen(t.ci * CHUNK, t.cj * CHUNK, t.frac, T, cover, scratch, 0, need);
      gens++;
      // free the old range first: a regenerating chunk usually lands back in it
      if (old) { this.pools[old.lod].release(old.s, old.n); this.chunks.delete(t.key); }
      const s = n ? pool.alloc(n) : 0;
      if (n && s < 0) { this.stats.starved++; continue; }
      if (n) {
        pool.A.pos.set(scratch.pos.subarray(0, n * 4), s * 4);
        pool.A.par.set(scratch.par.subarray(0, n * 4), s * 4);
        pool.A.col.set(scratch.col.subarray(0, n * 4), s * 4);
        pool.mark(s, n);
      }
      this.chunks.set(t.key, { lod: t.lod, frac: t.frac, s: s, n: n });
    }
    const dt = now() - t0;
    this.stats.lastGenMs = dt; this.stats.genMs += dt; this.stats.gens += gens;
    this.stats.pending = Math.max(0, todo.length - gens);
    for (const p of this.pools) p.flush();
    let blades = 0;
    for (const p of this.pools) blades += p.used;
    this.stats.chunks = this.chunks.size; this.stats.blades = blades;
    this._idle = todo.length - gens <= 0;
    return todo.length - gens;
  };
  Field.prototype.dispose = function () {
    for (const p of this.pools) p.dispose();
    if (this.mat) this.mat.dispose();
    this.chunks.clear();
  };

  /* ==================================================================
     LIVE WIRING
     ================================================================== */
  let field = null, fieldTier = -1, fieldArena = null, enabled = true, time = 0;
  const nowFn = (G.performance && G.performance.now) ? function () { return G.performance.now(); } : Date.now;
  function coverFn(x, z, out) { return CBZ.groundCover.at(x, z, out); }
  function teardown() { if (field) { field.dispose(); field = null; } }
  function tick(dt) {
    const g = CBZ.game, THREE = G.THREE;
    if (!THREE || !CBZ.scene || !CBZ.camera) return;
    const inCity = g && g.mode === "city" && CBZ.city && CBZ.city.arena;
    const cam = CBZ.camera.position;
    if (!enabled || !inCity) { if (field) for (const p of field.pools) p.mesh.visible = false; return; }
    const q = CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel;
    // a rebuilt world or a new tier: start clean
    if (field && (fieldTier !== q || fieldArena !== CBZ.city.arena)) teardown();
    if (!field) {
      field = new Field(THREE, tier(q, CBZ.deviceClass), CBZ.scene);
      fieldTier = q; fieldArena = CBZ.city.arena;
    }
    // from an aircraft the blades are sub-pixel: stop feeding them
    const ground = typeof CBZ.floorAt === "function" ? CBZ.floorAt(cam.x, cam.z) : 0;
    if (cam.y - (ground || 0) > field.T.R * 0.9) { for (const p of field.pools) p.mesh.visible = false; return; }
    time += Math.min(0.1, dt || 0);
    const U = field.U;
    const W = CBZ.weather;
    const wx = W && isFinite(W.windX) ? W.windX : 0.8, wz = W && isFinite(W.windZ) ? W.windZ : 0.6;
    const wl = Math.hypot(wx, wz) || 1;
    const ws = 0.18 + Math.min(1, (W && isFinite(W.wind) ? W.wind : 3) / 14) * 0.75;
    U.uGfWind.value.set(wx / wl, wz / wl, ws, time);
    const P = CBZ.player;
    const p0 = U.uGfPush.value[0], p1 = U.uGfPush.value[1];
    p0.set(0, 0, 0, 0); p1.set(0, 0, 0, 0);
    if (P && P.pos && !P.dead) {
      const veh = P.driving && P._vehicle ? P._vehicle : null;
      const vp = veh && (veh.pos || (veh.group && veh.group.position));
      if (vp) p1.set(vp.x, vp.z, 2.6, 1);
      else p0.set(P.pos.x, P.pos.z, 0.65, 1);
    }
    // budget: generous until the near field is in, then a sliver a frame
    const near = field.stats.chunks < 20;
    field.update(cam.x, cam.z, near ? 4 : 1.2, nowFn, coverFn);
  }
  if (CBZ.onAlways) CBZ.onAlways(90, tick);

  CBZ.grassField = {
    setEnabled: function (on) { enabled = !!on; if (!enabled && field) for (const p of field.pools) p.mesh.visible = false; },
    stats: function () {
      if (!field) return { live: false, providers: CBZ.groundCover.providers() };
      return Object.assign({ live: true, tier: field.T, pools: field.pools.map(function (p) { return { cap: p.cap, used: p.used, hwm: p.hwm }; }), providers: CBZ.groundCover.providers() }, field.stats);
    },
    rebuild: teardown,
    _gen: gen, _tier: tier, _typeStats: TS, _compensate: compensate, _want: want, _Field: Field, _Pool: Pool, CHUNK: CHUNK, RING: RING,
  };
})();
