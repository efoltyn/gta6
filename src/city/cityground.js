/* ============================================================
   city/cityground.js — THE GROUND BETWEEN THE KERB AND THE WALL.

   OWNER: "the ground throughout the gang city game is slop — interestingly
   simple for how big the game is."

   WHAT IT WAS (city/world.js + city/streetkit.js, before this file):
     - every residential lawn: CBZ.checkerTex(GRASS_A, GRASS_B, 2) — the
       two-tone draughts board — with a grass photo drawn over it and the
       checker then painted BACK on top at 38 % "to keep the island's checker
       identity", tiled every 8 m. Four-metre mint squares on every yard.
     - every industrial yard: one flat colour, no texture at all.
     - every commercial / downtown lot: a 256 px canvas of four 3 m slabs,
       repeated every 6 m, the same five specks in the same places.
     - driveways (approach.js): a flat 0x8f9298 sheet with two painted white
       edge lines, like a car park bay glued onto the lawn.
     - parks: a 3.2 m grass tile, gravel paths and a plaza as separate
       overlay planes, each one colour-tinted tile.
     One surface kind per district, one tile per surface, one flat triangle
     fan per block, no transitions, no contact, no relief.

   WHAT IT IS NOW. ONE material on ONE mesh for every lot pad in the grid,
   and what you stand on is decided per pixel from what the parcel actually
   is:

     SPLAT (a 1024² data map over the grid, ~0.3 m a texel, baked once from
     the real lots, buildings, doors, driveways and park layouts):
         R grass   G earth (mulch / trampled soil / decomposed granite)
         B asphalt A pavers        concrete = whatever is left
     MODIFIERS (same grid):
         R contact grime  (drip line at every wall, dirt at the footway edge)
         G stain          (wheel tracks and oil on driveways and yards)
         B wear           (bald lawn, cracked paving, weeds in the joints)
         A earth tone     (0 dark mulch/loam .. 1 tan gravel)

     DETAIL: three 512² packed data textures (lum + height per surface),
     authored below — grass blades with soil between, pebbled earth, asphalt
     aggregate, saw-cut concrete slabs, running-bond pavers. The organic ones
     are read twice (the second read rotated 37° at 0.61x) and switched by a
     9 m noise, so no tile can be counted; the structured ones (slabs, bricks)
     are read once, but every slab and every brick gets its OWN tone from a
     world-space hash of its id, so the repeat vanishes where the joints are
     honest about the grid.

     BLEND: height-aware. At a lawn/paving edge the tall blades win over the
     slab and the joints lose to everything, so a transition is grass
     spilling over an edge instead of a cross-fade.

     LIGHT: MeshStandardMaterial. The blended height becomes a real bumped
     normal (screen-derivative, faded with distance so nothing sparkles from
     the air) and a per-surface roughness; the same height drives a cavity
     term. When it rains (CBZ.weather.intensity) paving darkens, its
     roughness drops and puddles stand in the low spots.

   The footway (streetkit's footMat) is dressed by dressPaving(): world-space
   blots, gum spots and a 13 m / 41 m mottle over its 6 m canvas, plus the
   same wetness, so the pattern that repeated every 6 m is gone.

   COLOUR IS DECODED BY HAND. Custom samplers in r128 are sampled raw, so
   every tint here is converted sRGB -> linear in JS once, and the detail
   maps are LINEAR multipliers (mean 0.5 = x1.0), never colours. There is no
   canvas and no texture.encoding to get wrong (the pale-road bug).

   COST: one draw call for every lot pad (was three), no geometry change, no
   new lights, no per-frame CPU beyond one uniform ease. Boot: ~3 detail
   bakes of 512² + one splat pass over the parcels (measured in plain node,
   see CBZ.cityGround.stats).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const TEX = 512;              // detail map edge (POT: repeat + mipmaps)
  /* THE LAWN'S COLOURS (sRGB display hexes, decoded to linear below).
     WAS 0x5f7e37 / 0x958a52: decoded, the lawn reflected (0.114, 0.209,
     0.038) — 21 % green at a green/blue ratio of 5.5, so every downtown yard
     and park rendered as a lit, saturated green sheet next to the metro's
     turf (0.086, 0.125, 0.047; g/b 2.7) and the continent's meadow (0.099,
     0.135, 0.058 after its grey ease). Real mown turf, measured off aerial
     and street photographs of US lawns and parks, sits near 9-14 % green
     with g/r 1.3-1.5 and g/b 2.4-3; dried-out grass runs straw-tan. These
     are now the continent's own meadow / straw, plus a deeper irrigated /
     shaded green for the lush patches, so one lawn is one colour at every
     distance and across every ground system. */
  const GRASS_HEX = 0x566a3c, DRY_HEX = 0x857a57, LUSH_HEX = 0x445a30;
  const SPLAT = 1024;           // splat edge over the grid (POT: mipmaps from the air)
  const stats = { bakeMs: 0, paintMs: 0, paints: 0, lots: 0 };

  /* ==================================================================
     NOISE — deterministic, periodic (for the tiling maps) and plain (for
     the splat painter). Never Math.random.
     ================================================================== */
  function hash3(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function sm(t) { return t * t * (3 - 2 * t); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lcg(seed) {
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  // periodic fbm rasterised on the coarsest grid that carries it, then
  // bilinearly upsampled (a mottle with an 80 px period has nothing at 1 px)
  function field(N, base, oct, salt) {
    const top = Math.max(2, base | 0) << Math.max(0, oct - 1);
    let M = 8;
    while (M < top * 4 && M < N) M <<= 1;
    if (M > N) M = N;
    const coarse = new Float32Array(M * M);
    let norm = 0;
    for (let o = 0, amp = 0.5; o < oct; o++, amp *= 0.5) norm += amp;
    for (let o = 0, per = Math.max(2, base | 0), amp = 0.5; o < oct; o++, per *= 2, amp *= 0.5) {
      const lat = new Float32Array(per * per);
      for (let y = 0; y < per; y++) for (let x = 0; x < per; x++) lat[y * per + x] = hash3(x, y, salt + o * 7919);
      for (let y = 0; y < M; y++) {
        const fy = y / M * per, yi = Math.floor(fy), ty = sm(fy - yi), y0 = yi % per, y1 = (yi + 1) % per;
        for (let x = 0; x < M; x++) {
          const fx = x / M * per, xi = Math.floor(fx), tx = sm(fx - xi), x0 = xi % per, x1 = (xi + 1) % per;
          const a = lat[y0 * per + x0], b = lat[y0 * per + x1], c = lat[y1 * per + x0], d = lat[y1 * per + x1];
          coarse[y * M + x] += ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty) * amp / norm;
        }
      }
    }
    if (M === N) return coarse;
    const out = new Float32Array(N * N), s = M / N;
    for (let y = 0; y < N; y++) {
      const fy = y * s, y0 = fy | 0, ty = fy - y0, r0 = y0 * M, r1 = ((y0 + 1) % M) * M;
      for (let x = 0; x < N; x++) {
        const fx = x * s, x0 = fx | 0, tx = fx - x0, x1 = (x0 + 1) % M;
        const p = coarse[r0 + x0] + (coarse[r0 + x1] - coarse[r0 + x0]) * tx;
        const q = coarse[r1 + x0] + (coarse[r1 + x1] - coarse[r1 + x0]) * tx;
        out[y * N + x] = p + (q - p) * ty;
      }
    }
    return out;
  }
  // plain value noise for the painter (world metres in, 0..1 out)
  function vn(x, z, salt) {
    const xi = Math.floor(x), zi = Math.floor(z), tx = sm(x - xi), tz = sm(z - zi);
    const a = hash3(xi, zi, salt), b = hash3(xi + 1, zi, salt), c = hash3(xi, zi + 1, salt), d = hash3(xi + 1, zi + 1, salt);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }
  // shift a lum field so its mean is exactly 0.5 (the shader maps 0.5 -> x1.0,
  // so the authored tint IS the surface's average colour)
  function centre(f) {
    let s = 0;
    for (let i = 0; i < f.length; i++) s += f[i];
    const k = 0.5 - s / f.length;
    for (let i = 0; i < f.length; i++) f[i] = clamp01(f[i] + k);
    return f;
  }
  // splat a soft disc into (L,H) with wrap, keeping the taller surface
  function pebble(L, H, N, cx, cy, r, lum, top) {
    const r2 = r * r, R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const x = ((Math.round(cx) + dx) % N + N) % N, y = ((Math.round(cy) + dy) % N + N) % N, i = y * N + x;
      const k = 1 - d2 / r2, h = top * (0.45 + 0.55 * Math.sqrt(k));
      if (h > H[i]) { H[i] = h; L[i] = lum * (0.8 + 0.3 * k); }
    }
  }

  /* ==================================================================
     DETAIL AUTHORS — each returns two Float32 fields (lum, height), 0..1.
     ================================================================== */
  function grassField(N) {
    const L = new Float32Array(N * N), H = new Float32Array(N * N);
    const soil = field(N, 16, 2, 101), clump = field(N, 6, 3, 103);
    // the soil and thatch you see between blades
    for (let i = 0; i < L.length; i++) { L[i] = 0.16 + 0.12 * soil[i]; H[i] = 0.05 + 0.08 * soil[i]; }
    // blades seen from above: short dashes of every heading, tips brighter,
    // clumps lighter or darker as a whole (a lawn is never one green)
    const rnd = lcg(0x6a55), n = Math.round(N * N * 0.16);
    for (let b = 0; b < n; b++) {
      const x = rnd() * N, y = rnd() * N, len = 3 + rnd() * 8, ang = rnd() * 6.2832;
      const cl = clump[((y | 0) % N) * N + ((x | 0) % N)];
      const tone = 0.42 + rnd() * 0.36 + (cl - 0.5) * 0.34, vig = 0.65 + rnd() * 0.35;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let s = 0; s <= len; s += 0.7) {
        const px = ((Math.floor(x + ca * s)) % N + N) % N, py = ((Math.floor(y + sa * s)) % N + N) % N, i = py * N + px;
        const t = s / len, h = (0.3 + 0.7 * t) * vig;
        if (h > H[i]) { H[i] = h; L[i] = tone * (0.72 + 0.4 * t); }
      }
    }
    return [centre(L), H];
  }
  function earthField(N) {
    const L = new Float32Array(N * N), H = new Float32Array(N * N);
    const f = field(N, 8, 4, 201), grit = field(N, 128, 1, 203), crack = field(N, 5, 3, 205);
    for (let i = 0; i < L.length; i++) {
      // dry-soil crazing: the ridge of a low-frequency field, thin and dark
      const r = 1 - Math.abs(crack[i] * 2 - 1), r2 = r * r, r4 = r2 * r2, r8 = r4 * r4, c = r8 * r8 * r8 * r4;   // r^28
      L[i] = 0.42 + (f[i] - 0.5) * 0.4 + (grit[i] - 0.5) * 0.18 - c * 0.22;
      H[i] = 0.22 + f[i] * 0.3 + (grit[i] - 0.5) * 0.12 - c * 0.2;
    }
    const rnd = lcg(0x3e71), n = Math.round(N * N / 90);
    for (let p = 0; p < n; p++) {
      const r = 0.8 + rnd() * rnd() * 4.2;
      pebble(L, H, N, rnd() * N, rnd() * N, r, 0.35 + rnd() * 0.55, 0.7 + rnd() * 0.3);
    }
    for (let i = 0; i < L.length; i++) H[i] = clamp01(H[i]);
    return [centre(L), H];
  }
  function asphaltField(N) {
    const L = new Float32Array(N * N), H = new Float32Array(N * N);
    const mot = field(N, 4, 3, 301), grain = field(N, 256, 1, 303), fine = field(N, 64, 2, 305);
    for (let i = 0; i < L.length; i++) {
      L[i] = 0.46 + (mot[i] - 0.5) * 0.16 + (grain[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.1;
      H[i] = 0.3 + (grain[i] - 0.5) * 0.4 + (fine[i] - 0.5) * 0.2;
    }
    // exposed aggregate: the stones the tyres polished out of the binder
    const rnd = lcg(0x9a1d), n = Math.round(N * N / 55);
    for (let p = 0; p < n; p++) pebble(L, H, N, rnd() * N, rnd() * N, 0.6 + rnd() * 1.4, 0.45 + rnd() * 0.5, 0.75 + rnd() * 0.25);
    for (let i = 0; i < L.length; i++) H[i] = clamp01(H[i]);
    return [centre(L), H];
  }
  // concrete: a 3 m tile of FOUR 1.5 m saw-cut slabs (joints at 0 and N/2 —
  // the wrap IS a joint, so the tile seam is a real one)
  function concreteField(N) {
    const L = new Float32Array(N * N), H = new Float32Array(N * N);
    const mot = field(N, 4, 4, 401), pore = field(N, 200, 1, 403), trowel = field(N, 12, 2, 405);
    const S = N / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // broom finish: fine streaks across the slab, direction alternating by slab
      const sx = (x / S) | 0, sy = (y / S) | 0, across = ((sx + sy) & 1) ? x : y;
      const broom = hash3(across, 0, 407 + sx * 3 + sy) - 0.5;
      const pr = pore[i] < 0.2 ? (0.2 - pore[i]) * 2.2 : 0;
      L[i] = 0.5 + (mot[i] - 0.5) * 0.14 + (trowel[i] - 0.5) * 0.06 + broom * 0.05 - pr * 0.35;
      H[i] = 0.72 + (mot[i] - 0.5) * 0.08 + broom * 0.05 - pr * 0.5;
      // saw-cut joint ~9 mm, dirt caught either side, a worn arris
      const jx = Math.min(x % S, S - (x % S)), jy = Math.min(y % S, S - (y % S)), j = Math.min(jx, jy);
      if (j < 1.6) { L[i] = 0.16; H[i] = 0.02; }
      else if (j < 4.5) { const k = (4.5 - j) / 2.9; L[i] -= 0.1 * k; H[i] -= 0.22 * k * k; }
      else if (j < 6.5) L[i] += 0.03;
    }
    // hairline cracks wandering across two of the four slabs
    const rnd = lcg(0x51ab);
    for (let c = 0; c < 3; c++) {
      let x = (0.1 + rnd() * 0.8) * N, y = (0.1 + rnd() * 0.8) * N, a = rnd() * 6.28;
      const steps = 60 + (rnd() * 90) | 0;
      for (let s = 0; s < steps; s++) {
        a += (rnd() - 0.5) * 0.7;
        x += Math.cos(a) * 1.6; y += Math.sin(a) * 1.6;
        const px = ((x | 0) % N + N) % N, py = ((y | 0) % N + N) % N, i = py * N + px;
        L[i] = Math.min(L[i], 0.22); H[i] = Math.min(H[i], 0.25);
        const i2 = py * N + ((px + 1) % N);
        L[i2] = Math.min(L[i2], 0.34);
      }
    }
    for (let i = 0; i < L.length; i++) H[i] = clamp01(H[i]);
    return [centre(L), H];
  }
  // pavers: running bond, 8 x 16 units of 0.2 x 0.1 m in a 1.6 m tile.
  // THE SHADER DERIVES EACH PAVER'S ID WITH THE SAME ARITHMETIC
  // (col = floor(u*8 + 0.5*mod(row,2)), row = floor(v*16)) — keep them in step.
  function paverField(N) {
    const L = new Float32Array(N * N), H = new Float32Array(N * N);
    const grain = field(N, 128, 2, 501), mot = field(N, 8, 2, 503);
    const BW = N / 8, BH = N / 16;
    for (let y = 0; y < N; y++) {
      const row = (y / BH) | 0, off = (row & 1) ? BW / 2 : 0, by = y - row * BH;
      for (let x = 0; x < N; x++) {
        const i = y * N + x, xo = (x + off) % N, bx = xo % BW;
        const e = Math.min(bx, BW - 1 - bx, by, BH - 1 - by);
        if (e < 1.2) { L[i] = 0.56 + (grain[i] - 0.5) * 0.2; H[i] = 0.05; continue; }   // swept joint sand
        const chip = hash3((xo / BW) | 0, row, 509) < 0.12 && e < 3 ? 0.08 : 0;
        L[i] = 0.5 + (grain[i] - 0.5) * 0.22 + (mot[i] - 0.5) * 0.08 - (e < 3 ? (3 - e) * 0.03 : 0) - chip;
        H[i] = Math.min(1, 0.5 + e * 0.12) - chip * 2;
      }
    }
    for (let i = 0; i < L.length; i++) H[i] = clamp01(H[i]);
    return [centre(L), H];
  }

  function pack(N, a, b, c, d) {
    const out = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      out[i * 4] = Math.round(clamp01(a[i]) * 255); out[i * 4 + 1] = Math.round(clamp01(b[i]) * 255);
      out[i * 4 + 2] = Math.round(clamp01(c[i]) * 255); out[i * 4 + 3] = Math.round(clamp01(d[i]) * 255);
    }
    return out;
  }
  // The three packed maps, baked once per page (the world rebuilds reuse them).
  //   T1: grass lum, grass height, earth lum, earth height         (organic)
  //   T2: asphalt lum, asphalt height, grass dryness, weed mask     (organic)
  //   T3: concrete lum, concrete height, paver lum, paver height    (structured)
  let _detail = null;
  function bakeDetail(N) {
    const t0 = Date.now();
    /* A pure function of N and this file: kept in the bake cache
       (core/bakecache.js), since the ten 1 MB float fields it builds on the
       way were ~20 MB of garbage at the city build's heap peak. */
    const sig = CBZ.bakeSig ? CBZ.bakeSig("detail:" + N) : null;
    const hit = sig && CBZ.bakeGet ? CBZ.bakeGet("city-ground-detail", sig) : null;
    if (hit && hit.T1 && hit.T1.length === N * N * 4) { stats.bakeMs = Date.now() - t0; return { N, T1: hit.T1, T2: hit.T2, T3: hit.T3 }; }
    const g = grassField(N), e = earthField(N), a = asphaltField(N), c = concreteField(N), p = paverField(N);
    const dry = field(N, 5, 3, 601), weed = field(N, 24, 2, 603);
    const out = { N, T1: pack(N, g[0], g[1], e[0], e[1]), T2: pack(N, a[0], a[1], dry, weed), T3: pack(N, c[0], c[1], p[0], p[1]) };
    if (sig && CBZ.bakePut) CBZ.bakePut("city-ground-detail", sig, { T1: out.T1, T2: out.T2, T3: out.T3 });
    stats.bakeMs = Date.now() - t0;
    return out;
  }

  /* ==================================================================
     THE SPLAT PAINTER — what each parcel is made of, from what stands on it.
     ================================================================== */
  function distOf(lot, districts) {
    // a town parcel names its own surface kind (towngen: zone -> kind)
    if (lot.groundKind) return { kind: lot.groundKind, wealth: isFinite(lot.groundWealth) ? lot.groundWealth : 0.5 };
    const d = districts && districts[lot.district];
    return { kind: (d && d.kind) || "residential", wealth: d && isFinite(d.wealth) ? d.wealth : 0.5 };
  }
  function faceOf(lot, b) {
    const ap = b && b.approach;
    if (ap && (ap.nx || ap.nz)) return { nx: ap.nx, nz: ap.nz, half: ap.half || 2.7, drive: true };
    const d = b && b.door;
    if (d && isFinite(d.x) && isFinite(d.z)) {
      const dx = d.x - (isFinite(b.ox) ? b.ox : lot.cx), dz = d.z - (isFinite(b.oz) ? b.oz : lot.cz);
      if (Math.abs(dx) > Math.abs(dz)) return { nx: dx > 0 ? 1 : -1, nz: 0, half: 0, drive: false };
      return { nx: 0, nz: dz > 0 ? 1 : -1, half: 0, drive: false };
    }
    return { nx: 0, nz: 1, half: 0, drive: false };
  }

  // one texel: returns [grass, earth, asph, pave] and [grime, stain, wear, tone]
  function paintTexel(o, x, z, S, M) {
    const lx = x - o.cx, lz = z - o.cz;
    const dE = Math.min(o.hw - Math.abs(lx), o.hd - Math.abs(lz));          // to the footway's back edge
    if (dE < -0.8) return false;
    let g = 0, e = 0, a = 0, p = 0, grime = 0, stain = 0, wear = o.wear, tone = 0.35;
    const edge = dE > 0 ? dE : 0;
    grime = 0.3 * Math.exp(-edge / 0.22);                                    // grit washed off the footway

    if (o.park) {
      const P = o.park, ax = Math.abs(lx), az = Math.abs(lz);
      const inLawn = ax < P.lw / 2 && az < P.ld / 2;
      const r = Math.hypot(lx, lz);
      if (!inLawn) { p = 1; wear = 0.2; }                                  // the paved rim outside the edging
      else if (r < P.plazaR + 0.2) { p = 1; wear = 0.1; grime = Math.max(grime, 0.25 * Math.exp(-Math.abs(r - 1.9) / 0.3)); }
      else if (ax < P.pw / 2 || az < P.pw / 2) {                            // decomposed-granite paths
        e = 1; tone = 0.92; wear = 0.25;
        const eg = P.pw / 2 - Math.min(ax, az);                             // steel edging collects dark fines
        grime = Math.max(grime, 0.35 * Math.exp(-eg / 0.12));
      } else {
        g = 1; wear = 0.06 + 0.5 * Math.exp(-Math.max(0, Math.min(ax, az) - P.pw / 2) / 0.5);   // lawn scuffed at the path edge
        // DESIRE LINES: people cut the corner across the lawn to the fountain
        // instead of walking the paths round it; one or two diagonals per
        // park (by the lot's hash), a bald track frayed along its length
        if (P.desire) {
          const dg = P.desire === 1 ? Math.abs(lx - lz) : P.desire === 2 ? Math.abs(lx + lz) : Math.min(Math.abs(lx - lz), Math.abs(lx + lz));
          const dd = dg * 0.7071 + (vn(x / 1.7, z / 1.7, 83) - 0.5) * 0.35;
          wear = Math.max(wear, 0.95 * Math.exp(-(dd * dd) / (0.42 * 0.42)) * (0.7 + 0.3 * vn(x / 5, z / 5, 89)));
        }
        for (const t of P.trees) {                                          // a mulch ring round every trunk
          const d = Math.hypot(x - t.x, z - t.z);
          if (d < 1.25) { const k = sm(clamp01((1.25 - d) / 0.25)); g = 1 - k; e = k; tone = 0.04; }
        }
        for (const bq of P.benches) {                                       // feet wear the turf bald at a bench
          const d = Math.hypot(x - bq.x, z - bq.z);
          wear = Math.max(wear, 0.9 * Math.exp(-d / 1.1));
        }
      }
      writeTexel(S, M, o.i, g, e, a, p, grime, stain, wear, tone);
      return true;
    }

    const B = o.b;
    let dB = 99;
    if (B) {
      const qx = Math.abs(lx - B.x) - B.hw, qz = Math.abs(lz - B.z) - B.hd;
      dB = (qx > 0 || qz > 0) ? Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) : Math.max(qx, qz);
    }
    if (dB < -0.05) {
      // UNDER THE SLAB: what a parcel is when the building comes down —
      // compacted fill with the old floor's concrete broken through it.
      const k = vn(x / 3.1, z / 3.1, 71);
      e = k < 0.55 ? 1 : 0.3; tone = 0.6; wear = 1; stain = 0.3;
      writeTexel(S, M, o.i, g, e, a, p, 0.1, stain, wear, tone);
      return true;
    }
    grime = Math.max(grime, dB < 99 ? Math.exp(-Math.max(0, dB) / 0.32) : 0);   // drip line / splash-back at the wall

    const F = o.face, al = lx * F.nx + lz * F.nz, lat = F.nx ? lz : lx;
    const inDrive = F.drive && B && Math.abs(lat) <= F.half && al > o.front - 0.05;

    switch (o.kind) {
      case "core":                      // Midtown: two-tone pavers wall to kerb
        p = 1; wear = Math.max(wear, 0.04); break;
      case "commercial":
        if (o.wealth >= 0.55) p = 1;    // the better streets paved, the rest poured
        wear = Math.max(wear, 0.14); stain = 0.25; break;
      case "industrial":
        a = 1; wear = Math.max(wear, 0.55); stain = 0.5;
        if (dB < 1.2) { a = 0; }        // a poured apron along the loading wall
        if (dE < 0.5) { a = 0; e = 1; tone = 0.62; wear = 0.95; }   // gravel strip at the fence line
        break;
      case "projects":
        g = 1; wear = Math.max(wear, 0.5); tone = 0.4;
        if (dB < 1.1) g = 0;            // the perimeter walk every block of flats has
        break;
      default:                          // residential
        g = 1; tone = 0.35;
        if (dB < 0.75) { g = 0; e = 1; tone = 0.03; }                       // planting bed at the facade
    }
    if (g > 0) {
      // THE LAWN'S EDGES. Turf beside a hot footway browns and thins (kerb
      // heat, salt, feet cutting the corner): a worn band, frayed by the
      // shader's 2.3 m bald noise, never a ruled line.
      wear = Math.max(wear, 0.5 * Math.exp(-edge / 0.45));
    }
    if (o.walk != null && B && !inDrive && al > o.front - 0.05) {
      // THE FRONT WALK. A house without a driveway still has a path from the
      // footway to its door: a 1.2 m poured walk, the turf scuffed along it.
      const off = Math.abs(lat - o.walk);
      if (off < 0.6) { g = 0; e = 0; a = 0; p = 0; wear = Math.max(0.12, wear * 0.4); stain = 0.15; }
      else if (g > 0 && off < 1.1) wear = Math.max(wear, 0.6 * (1 - (off - 0.6) / 0.5));
    }
    if (inDrive) {
      // the driveway: pour-concrete (asphalt in the yards), wheel tracks,
      // an oil drip where cars stand, the lawn scuffed along its edges
      g = 0; e = 0; a = o.kind === "industrial" ? 1 : 0; p = o.kind === "core" ? 1 : 0;
      const tk = Math.abs(Math.abs(lat) - 0.8);
      stain = Math.max(stain, 0.85 * Math.exp(-(tk * tk) / (0.24 * 0.24)));
      const oil = Math.hypot(lat * 1.6, al - (o.front + 2.2));
      stain = Math.max(stain, 0.9 * Math.exp(-oil / 0.7));
      wear = Math.max(0.2, wear * 0.5);
    } else if (F.drive && B && (g > 0)) {
      const off = Math.abs(lat) - F.half;
      if (off > 0 && off < 0.6 && al > o.front) wear = Math.max(wear, 0.55 * (1 - off / 0.6));
    }
    writeTexel(S, M, o.i, g, e, a, p, grime, stain, wear, tone);
    return true;
  }
  function writeTexel(S, M, i, g, e, a, p, grime, stain, wear, tone) {
    const sum = g + e + a + p;
    if (sum > 1) { g /= sum; e /= sum; a /= sum; p /= sum; }
    const j = i * 4;
    // (v * 255 + 0.5) | 0 is Math.round for v >= 0, without the call
    S[j] = (g * 255 + 0.5) | 0; S[j + 1] = (e * 255 + 0.5) | 0; S[j + 2] = (a * 255 + 0.5) | 0; S[j + 3] = (p * 255 + 0.5) | 0;
    M[j] = (clamp01(grime) * 255 + 0.5) | 0; M[j + 1] = (clamp01(stain) * 255 + 0.5) | 0;
    M[j + 2] = (clamp01(wear) * 255 + 0.5) | 0; M[j + 3] = (clamp01(tone) * 255 + 0.5) | 0;
  }

  // Paint every grid parcel into the live splat. Safe to call again (a
  // rebuilt block, a demolition): each parcel's rectangle is repainted whole.
  function paintLot(state, lot) {
    // the downtown's splat paints the grid parcels out of city.lots; a
    // town's was handed exactly its own parcels
    if (!lot || (state.main && !lot.grid) || !isFinite(lot.cx)) return false;
    const S = state.S.image.data, Mo = state.M.image.data;
    const x0 = state.x0, z0 = state.z0, cell = state.cell, N = state.N;
    const b = lot.building || null;
    const D = distOf(lot, state.districts);
    const o = {
      cx: lot.cx, cz: lot.cz, hw: (lot.w || 30) / 2, hd: (lot.d || 30) / 2, i: 0,
      kind: D.kind, wealth: D.wealth,
      // poorer streets wear harder; a crew's building lets its yard go
      wear: 0.08 + (1 - D.wealth) * 0.22 + (lot.kind === "abandoned" ? 0.4 : 0),
      park: null, b: null, face: faceOf(lot, b), front: 0, walk: null,
    };
    if (b && b.park) {
      const w = lot.w || 30, d = lot.d || 30, bo = Math.min(w, d) * 0.23;
      o.park = {
        lw: w - 1.6, ld: d - 1.6, pw: 2.2, plazaR: Math.min(w, d) * 0.17,
        desire: 1 + ((hash3(Math.round(lot.cx), Math.round(lot.cz), 97) * 3) | 0),
        trees: lot.groundTrees || [],
        benches: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(function (s) {
          return { x: lot.cx + s[0] * bo + (s[0] === 0 ? 2 : 0), z: lot.cz + s[1] * bo + (s[1] === 0 ? 2 : 0) };
        }),
      };
    } else if (b && isFinite(b.w) && isFinite(b.d) && b.w > 1) {
      o.b = { x: (isFinite(b.ox) ? b.ox : lot.cx) - lot.cx, z: (isFinite(b.oz) ? b.oz : lot.cz) - lot.cz, hw: b.w / 2, hd: b.d / 2 };
      o.front = o.b.x * o.face.nx + o.b.z * o.face.nz + (o.face.nx ? o.b.hw : o.b.hd);
      // a lawned parcel whose door is not served by a driveway gets a front walk
      const dr = b.door;
      if (!o.face.drive && dr && isFinite(dr.x) && isFinite(dr.z) && (D.kind === "residential" || D.kind === "projects"))
        o.walk = o.face.nx ? dr.z - lot.cz : dr.x - lot.cx;
    }
    const ix0 = Math.max(0, Math.floor((lot.cx - o.hw - 1 - x0) / cell)), ix1 = Math.min(N - 1, Math.ceil((lot.cx + o.hw + 1 - x0) / cell));
    const iz0 = Math.max(0, Math.floor((lot.cz - o.hd - 1 - z0) / cell)), iz1 = Math.min(N - 1, Math.ceil((lot.cz + o.hd + 1 - z0) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = z0 + (iz + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        o.i = iz * N + ix;
        paintTexel(o, x0 + (ix + 0.5) * cell, z, S, Mo);
      }
    }
    return true;
  }
  function paint(state) {
    if (!state) return;
    const t0 = Date.now();
    let lots = 0;
    for (const lot of state.lots) if (paintLot(state, lot)) lots++;
    state.S.needsUpdate = true; state.M.needsUpdate = true;
    state.painted = true; state.cursor = state.lots.length; state.bIx = null;
    stats.paintMs = Date.now() - t0; stats.paints++; stats.lots = lots;
  }
  /* ==================================================================
     coverAt — THE GRASS FIELD'S QUESTION (world/grassfield.js). Where the
     splat says lawn, blades grow: the same R channel the shader paints, the
     same bald-patch rule (wear x the same 2.3 m noise, cgNoise ported to
     JS), the same lush-to-straw rule. The colour handed back is the lawn's
     own linear albedo, so the blades average to the ground under them.
     Owns every point inside a splat (a paved texel answers "no grass").
     ================================================================== */
  function fract(v) { return v - Math.floor(v); }
  function cgHashJ(px, py) {
    let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031);
    const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
    x += d; y += d; z += d;
    return fract((x + y) * z);
  }
  function cgNoiseJ(px, py) {
    const ix = Math.floor(px), iy = Math.floor(py);
    let fx = px - ix, fy = py - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = cgHashJ(ix, iy), b = cgHashJ(ix + 1, iy), c = cgHashJ(ix, iy + 1), d = cgHashJ(ix + 1, iy + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  function lin(hex) {
    const f = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
  }
  const LAWN = lin(GRASS_HEX), STRAW = lin(DRY_HEX), LUSHC = lin(LUSH_HEX);   // == uCgGrass / uCgDry / uCgLush
  const GTMP = [0, 0, 0];
  function underBuilding(st, x, z) {
    if (!st.bIx) {
      st.bIx = new Map();
      for (const lot of st.lots) {
        const b = lot && lot.building;
        if (!b || b.park || !(b.w > 1) || !(b.d > 1)) continue;
        const bx = isFinite(b.ox) ? b.ox : lot.cx, bz = isFinite(b.oz) ? b.oz : lot.cz;
        const R = { x0: bx - b.w / 2 - 0.2, x1: bx + b.w / 2 + 0.2, z0: bz - b.d / 2 - 0.2, z1: bz + b.d / 2 + 0.2 };
        for (let ix = Math.floor(R.x0 / 16); ix <= Math.floor(R.x1 / 16); ix++)
          for (let iz = Math.floor(R.z0 / 16); iz <= Math.floor(R.z1 / 16); iz++) {
            const k = ix * 100003 + iz; let l = st.bIx.get(k); if (!l) st.bIx.set(k, l = []); l.push(R);
          }
      }
    }
    const l = st.bIx.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (l) for (let i = 0; i < l.length; i++) { const R = l[i]; if (x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1) return true; }
    return false;
  }
  function coverAt(x, z, out) {
    for (let k = 0; k < states.length; k++) {
      const st = states[k];
      const u = (x - st.x0) / st.cell, v = (z - st.z0) / st.cell;
      if (!(u >= 0 && v >= 0 && u < st.N && v < st.N)) continue;
      const i = ((v | 0) * st.N + (u | 0)) * 4;
      const S = st.S.image.data, M = st.M.image.data;
      const g0 = S[i] / 255;
      if (g0 < 0.04) { out.g = 0; return true; }
      // the splat is painted 0.8 m past the lot under the footway's back edge
      // (the kerb mesh hides it); a blade must stand on the lot pad itself
      // (checked a blade's jitter round the sample: 15 cm each way)
      const SK = CBZ.streetKit;
      if (SK && SK.regionAt && SK.surfaces && SK.surfaces.length &&
          (SK.regionAt(x, z) !== 2 || SK.regionAt(x - 0.15, z - 0.15) !== 2 || SK.regionAt(x + 0.15, z - 0.15) !== 2 ||
           SK.regionAt(x - 0.15, z + 0.15) !== 2 || SK.regionAt(x + 0.15, z + 0.15) !== 2)) { out.g = 0; return true; }
      // and never under a building: the splat's texel (0.3-0.6 m) straddles
      // a wall, the building's own footprint does not
      if (underBuilding(st, x, z)) { out.g = 0; return true; }
      const wear = M[i + 2] / 255;
      // the shader's bald rule: wear x a 2.3 m noise through a steep gain
      const wn = wear * (0.55 + 0.9 * cgNoiseJ(x / 2.3 + 9.1, z / 2.3 + 9.1));
      const bald = sm(clamp01((wn - 0.55) / 0.3));
      const g = g0 * (1 - bald) * (1 - 0.45 * wear);
      if (g < 0.03) { out.g = 0; return true; }
      // lush..straw: the 41 m field + wear (the map's own dryness averages 0.5)
      const m41 = cgNoiseJ(x / 41 + 1.7, z / 41 + 1.7);
      const dry = clamp01(0.275 + sm(clamp01((m41 - 0.45) / 0.4)) * 0.45 + wear * 0.35 - 0.3);
      out.g = g;
      out.dry = dry;
      // the shader's lush patches (a 23 m field), so the blades match the turf
      const lush = (1 - sm(clamp01((cgNoiseJ(x / 23 + 12.4, z / 23 + 12.4) - 0.2) / 0.35))) * (1 - dry) * 0.8;
      for (let c = 0; c < 3; c++) GTMP[c] = LAWN[c] + (LUSHC[c] - LAWN[c]) * lush;
      out.r = (GTMP[0] + (STRAW[0] - GTMP[0]) * dry) * 0.95;
      out.gr = (GTMP[1] + (STRAW[1] - GTMP[1]) * dry) * 0.95;
      out.b = (GTMP[2] + (STRAW[2] - GTMP[2]) * dry) * 0.95;
      // a neglected yard (projects, abandoned lots) runs to seed and weeds
      out.wild = wear > 0.5 ? 0.35 + wear * 0.5 : 0;
      out.h = 1 + wear * 0.5;
      out.flw = 0.015 + 0.05 * wear;
      const ys = SK && SK.heightAt ? SK.heightAt(x, z) : null;
      out.y = ys != null ? ys : (typeof CBZ.floorAt === "function" ? CBZ.floorAt(x, z) : 0.16);
      return true;
    }
    return false;
  }
  if (CBZ.groundCover) CBZ.groundCover.register("cityground", coverAt, 10);

  /* THE TOWNS PAINT AFTER THE LOAD. A town's lot ground is ~0.1 s of splat
     work each, and a dozen of them were a second and more of boot for ground
     nobody can see from the downtown. So the world build only QUEUES them
     (order 68) and this tick paints a few parcels per frame inside a small
     budget; each town's texture uploads once, when its last parcel is done.
     Until then it reads as plain concrete — out past the draw-in distance. */
  const queue = [];
  const BUDGET_MS = 3;
  function enqueue(state) {
    if (queue.indexOf(state) < 0) { state.cursor = 0; state.painted = false; queue.push(state); }
  }
  function drain(budget) {
    const t0 = Date.now();
    while (queue.length) {
      const st = queue[0];
      while (st.cursor < st.lots.length) {
        paintLot(st, st.lots[st.cursor++]);
        if (Date.now() - t0 >= budget) return;
      }
      st.S.needsUpdate = true; st.M.needsUpdate = true; st.painted = true;
      stats.paints++;
      queue.shift();
      if (Date.now() - t0 >= budget) return;
    }
  }
  if (CBZ.onAlways) CBZ.onAlways(94, function () { if (queue.length) drain(BUDGET_MS); });

  /* ==================================================================
     SHADERS
     ================================================================== */
  const NOISE_GLSL = [
    "float cgHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }",
    "float cgNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( cgHash( i ), cgHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( cgHash( i + vec2( 0.0, 1.0 ) ), cgHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }",
  ].join("\n");

  const GROUND_PARS = [
    "varying vec3 vCgW;",
    "uniform sampler2D uCgS;", "uniform sampler2D uCgM;",
    "uniform sampler2D uCgT1;", "uniform sampler2D uCgT2;", "uniform sampler2D uCgT3;",
    "uniform vec4 uCgRect;",
    "uniform vec3 uCgGrass;", "uniform vec3 uCgDry;", "uniform vec3 uCgLush;", "uniform vec3 uCgLoam;", "uniform vec3 uCgGravel;",
    "uniform vec3 uCgAsph;", "uniform vec3 uCgConc;", "uniform vec3 uCgPavA;", "uniform vec3 uCgPavB;",
    "uniform float uCgWet;",
    NOISE_GLSL,
    // organic anti-tile: a second read rotated 37 deg at 0.61x, switched by a slow noise
    "vec4 cgTap( sampler2D m, vec2 uv, float k ) {",
    "  vec4 a = texture2D( m, uv );",
    "  vec4 b = texture2D( m, mat2( 0.8, -0.6, 0.6, 0.8 ) * uv * 0.61 + vec2( 0.37, 0.71 ) );",
    "  return mix( a, b, k ); }",
    // Mikkelsen's derivative bump (three's perturbNormalArb, renamed: it only
    // exists under USE_BUMPMAP)
    "vec3 cgPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd ) {",
    "  vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );",
    "  vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );",
    "  vec3 R1 = cross( vSigmaY, surf_norm );",
    "  vec3 R2 = cross( surf_norm, vSigmaX );",
    "  float fDet = dot( vSigmaX, R1 ) * fd;",
    "  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );",
    "  return normalize( abs( fDet ) * surf_norm - vGrad ); }",
  ].join("\n");

  const GROUND_MAIN = [
    "float cgHt = 0.0;",
    "float cgRough = 0.9;",
    "{",
    "  vec2 xz = vCgW.xz;",
    "  float cgDist = length( vViewPosition );",
    "  vec2 suv = ( xz - uCgRect.xy ) * uCgRect.zw;",
    // the splat frays at the scale of a blade (6 cm grain, ~9 cm reach)
    "  vec2 jit = vec2( cgNoise( xz * 7.0 ), cgNoise( xz * 7.0 + 31.7 ) ) - 0.5;",
    "  vec4 cgSp = texture2D( uCgS, suv + jit * 0.09 * uCgRect.zw );",
    "  vec4 cgMo = texture2D( uCgM, suv );",
    "  float n9 = cgNoise( xz / 9.0 );",
    "  float m13 = cgNoise( xz / 13.0 + 5.3 ), m41 = cgNoise( xz / 41.0 + 1.7 );",
    "  float kT = smoothstep( 0.3, 0.7, n9 );",
    "  vec4 t1 = cgTap( uCgT1, xz / 1.8, kT );",
    "  vec4 t2 = cgTap( uCgT2, xz / 2.4, 1.0 - kT );",
    "  vec4 tc = texture2D( uCgT3, xz / 3.0 );",
    "  vec4 tp = texture2D( uCgT3, xz / 1.6 );",
    // wear takes the lawn down to soil in patches, never in a smooth fade
    "  float wearN = cgMo.b * ( 0.55 + 0.9 * cgNoise( xz / 2.3 + 9.1 ) );",
    "  float bald = smoothstep( 0.55, 0.85, wearN + ( 0.5 - t1.y ) * 0.25 );",
    "  float wC0 = max( 0.0, 1.0 - cgSp.r - cgSp.g - cgSp.b - cgSp.a );",
    "  vec4 wv = vec4( cgSp.r * ( 1.0 - bald ), cgSp.g + cgSp.r * bald, cgSp.b, cgSp.a );",
    // height-aware blend: tall blades overlap an edge, joints lose to everything
    "  vec4 hv = vec4( t1.y, t1.w * 0.8, t2.y * 0.6, tp.w * 0.75 );",
    "  float hc = tc.y * 0.7;",
    "  vec4 bw = wv * ( 0.2 + hv );",
    "  float bc = wC0 * ( 0.2 + hc );",
    "  float mx = max( max( max( bw.x, bw.y ), max( bw.z, bw.w ) ), bc ) - 0.18;",
    "  bw = max( bw - mx, 0.0 ); bc = max( bc - mx, 0.0 );",
    "  float ws = bw.x + bw.y + bw.z + bw.w + bc + 1e-5;",
    "  bw /= ws; bc /= ws;",
    // GRASS: lush to straw by a 41 m field, the map's own dryness and wear
    "  float dry = clamp( t2.z * 0.55 + smoothstep( 0.45, 0.85, m41 ) * 0.45 + cgMo.b * 0.35 - 0.3, 0.0, 1.0 );",
    // lush: the low half of a 23 m field (irrigated, shaded, the low ground
    // where water stands) goes a deeper green; never where it is dry
    "  float lush = ( 1.0 - smoothstep( 0.2, 0.55, cgNoise( xz / 23.0 + 12.4 ) ) ) * ( 1.0 - dry );",
    "  vec3 cG = mix( mix( uCgGrass, uCgLush, lush * 0.8 ), uCgDry, dry ) * ( 0.3 + 1.4 * t1.x );",
    "  cG *= mix( vec3( 1.0 ), vec3( 0.9, 1.05, 0.86 ), m13 );",
    // EARTH: mulch/loam .. decomposed granite by the painted tone
    "  vec3 cE = mix( uCgLoam, uCgGravel, cgMo.a ) * ( 0.4 + 1.2 * t1.z );",
    // ASPHALT
    "  vec3 cA = uCgAsph * ( 0.5 + 1.0 * t2.x );",
    // CONCRETE: every 1.5 m slab its own pour
    "  float slab = cgHash( floor( xz / 1.5 ) + 17.0 );",
    "  vec3 cC = uCgConc * ( 0.5 + 1.0 * tc.x ) * ( 0.92 + 0.14 * slab );",
    // PAVERS: every unit its own tone, a two-tone blend laid at random
    "  vec2 pu = xz / 1.6;",
    "  float prow = floor( pu.y * 16.0 );",
    "  float pcol = floor( pu.x * 8.0 + 0.5 * mod( prow, 2.0 ) );",
    "  float ph = cgHash( vec2( pcol, prow ) + 3.0 );",
    "  vec3 cP = mix( uCgPavA, uCgPavB, step( 0.64, ph ) ) * ( 0.5 + 1.0 * tp.z ) * ( 0.88 + 0.24 * cgHash( vec2( prow, pcol ) + 11.0 ) );",
    "  vec3 col = cG * bw.x + cE * bw.y + cA * bw.z + cP * bw.w + cC * bc;",
    // weeds in the joints and cracks of worn paving
    "  float joint = bc * ( 1.0 - smoothstep( 0.05, 0.3, tc.y ) ) + bw.w * ( 1.0 - smoothstep( 0.05, 0.3, tp.w ) ) + bw.z * ( 1.0 - smoothstep( 0.1, 0.25, t2.y ) ) * 0.5;",
    "  float weed = clamp( joint * smoothstep( 0.45, 0.85, t2.w ) * cgMo.b * 1.6, 0.0, 1.0 );",
    "  col = mix( col, uCgGrass * ( 0.6 + 0.6 * t1.x ), weed );",
    // stains: wheel tracks and oil, shaped into blots rather than smears
    "  float stN = cgNoise( xz / 0.9 + 2.0 ) * 0.6 + cgNoise( xz / 3.1 ) * 0.4;",
    "  float stain = cgMo.g * smoothstep( 0.3, 0.72, stN ) * ( 1.0 - bw.x );",
    "  col *= 1.0 - 0.42 * stain;",
    // contact grime at every wall and at the footway edge
    "  float gr = clamp( cgMo.r * ( 0.7 + 0.6 * cgNoise( xz / 1.3 + 4.0 ) ), 0.0, 1.0 );",
    "  col *= 1.0 - 0.4 * gr;",
    // cavity: the low parts of every surface hold shade and dirt
    "  float h01 = bw.x * t1.y + bw.y * t1.w + bw.z * t2.y + bw.w * tp.w + bc * tc.y;",
    "  col *= 0.8 + 0.28 * h01;",
    "  col *= 1.0 + 0.1 * ( m13 - 0.5 ) + 0.08 * ( m41 - 0.5 );",
    // rain: paving darkens and puddles in its lows; soil and turf darken less
    "  float paved = bw.z + bw.w + bc;",
    "  float pud = uCgWet * paved * smoothstep( 0.6, 0.8, cgNoise( xz / 2.7 + 7.0 ) * 0.7 + ( 1.0 - h01 ) * 0.3 );",
    "  col *= 1.0 - uCgWet * ( 0.3 * paved + 0.2 * ( 1.0 - paved ) ) - 0.22 * pud;",
    "  diffuseColor.rgb *= col;",
    "  float rgh = bw.x * 1.0 + bw.y * 0.96 + bw.z * 0.84 + bw.w * 0.76 + bc * 0.88;",
    "  rgh = mix( rgh, 0.94, weed ) + gr * 0.05;",
    "  rgh = mix( rgh, 0.42, uCgWet * paved );",
    "  cgRough = clamp( mix( rgh, 0.08, pud ), 0.05, 1.0 );",
    // relief, in metres: blades 2 cm, pebbles 8 mm, bevels 7 mm, joints 6 mm
    "  float ht = bw.x * t1.y * 0.02 + bw.y * t1.w * 0.008 + bw.z * t2.y * 0.004 + bw.w * tp.w * 0.007 + bc * tc.y * 0.006;",
    "  cgHt = ht * ( 1.0 - smoothstep( 10.0, 48.0, cgDist ) ) * ( 1.0 - pud );",
    "}",
  ].join("\n");

  function srgbLin(hex) {
    const f = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return new window.THREE.Vector3(f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255));
  }

  // one shared wetness, eased a beat behind the rain (puddles form and drain)
  const wetU = { value: 0 };
  if (CBZ.onAlways) CBZ.onAlways(93, function (dt) {
    const tgt = CBZ.weather && typeof CBZ.weather.intensity === "number" ? CBZ.weather.intensity : 0;
    const r = dt ? Math.min(1, dt * 0.35) : 0;
    wetU.value += (tgt - wetU.value) * r;
    if (wetU.value < 0.002) wetU.value = 0;
  });

  function dataTex(THREE, data, N, repeat, mips) {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.generateMipmaps = !!mips;
    try { if (CBZ.renderer && CBZ.renderer.capabilities) t.anisotropy = Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    t.needsUpdate = true;
    return t;
  }

  let live = null;           // the downtown's splat state (a rebuilt world replaces it)
  let states = [];           // every splat of the current world: the downtown + each town
  let detailTex = null;

  /* material(ctx) — the lot-pad material for a freshly built grid.
       ctx: { lots, districts, xLines, zLines }
     The splat starts painted from the lots alone (district surfaces, no
     buildings yet); the landmass pass below repaints it once buildings,
     doors, driveways and parks exist. */
  function material(ctx) {
    const THREE = window.THREE;
    if (!_detail) _detail = bakeDetail(TEX);
    if (!detailTex) detailTex = {
      T1: dataTex(THREE, _detail.T1, TEX, true, true),
      T2: dataTex(THREE, _detail.T2, TEX, true, true),
      T3: dataTex(THREE, _detail.T3, TEX, true, true),
    };
    const xL = ctx.xLines, zL = ctx.zLines;
    const x0 = xL[0], z0 = zL[0];
    const span = Math.max(xL[xL.length - 1] - x0, zL[zL.length - 1] - z0, 1);
    // ctx.main === false: a TOWN's lot ground (towngen). Same material, same
    // program; its own splat over its own grid, smaller (a town spans ~300 m,
    // so 512 texels is ~0.6 m each), painted from the parcels it was handed.
    const main = ctx.main !== false;
    const NS = main ? SPLAT : Math.max(128, Math.min(SPLAT, ctx.splat || 512));
    const cell = span / NS;
    const S = dataTex(THREE, new Uint8Array(NS * NS * 4), NS, false, true);
    const M = dataTex(THREE, new Uint8Array(NS * NS * 4), NS, false, true);
    const state = { S, M, x0, z0, cell, N: NS, main, lots: ctx.lots || [], districts: ctx.districts || [] };
    if (main) { live = state; states = [state]; }     // a new world: the downtown is laid first
    else states.push(state);
    // The landmass pass (order 68) paints once buildings exist; painting the
    // bare lots first as well would only double the boot cost. Without the
    // registry (a page that never runs landmasses) paint what there is now.
    // A town built INSIDE a world build (ctx.paintNow false) waits for that
    // same pass, when approach.js has laid its driveways; one built on its
    // own (a studio page) paints at once, its buildings already stand.
    if (!CBZ.addLandmass || (!main && ctx.paintNow !== false)) paint(state);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.2 });
    mat.name = "city-ground";
    const U = {
      uCgS: { value: S }, uCgM: { value: M },
      uCgT1: { value: detailTex.T1 }, uCgT2: { value: detailTex.T2 }, uCgT3: { value: detailTex.T3 },
      uCgRect: { value: new THREE.Vector4(x0, z0, 1 / span, 1 / span) },
      uCgGrass: { value: srgbLin(GRASS_HEX) }, uCgDry: { value: srgbLin(DRY_HEX) }, uCgLush: { value: srgbLin(LUSH_HEX) },
      uCgLoam: { value: srgbLin(0x463426) }, uCgGravel: { value: srgbLin(0xa89674) },
      uCgAsph: { value: srgbLin(0x464749) }, uCgConc: { value: srgbLin(0x807d76) },
      uCgPavA: { value: srgbLin(0x68645f) }, uCgPavB: { value: srgbLin(0x9e8c70) },
      uCgWet: wetU,
    };
    mat.userData.cityGround = true;
    mat.onBeforeCompile = function (sh) {
      const vs = sh.vertexShader, fs = sh.fragmentShader;
      if (vs.indexOf("#include <project_vertex>") < 0 || fs.indexOf("#include <color_fragment>") < 0 ||
          fs.indexOf("#include <roughnessmap_fragment>") < 0 || fs.indexOf("#include <normal_fragment_maps>") < 0) return;
      Object.assign(sh.uniforms, U);
      sh.vertexShader = vs
        .replace("#include <common>", "#include <common>\nvarying vec3 vCgW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCgW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      sh.fragmentShader = fs
        .replace("#include <common>", "#include <common>\n" + GROUND_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + GROUND_MAIN)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = cgRough;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" +
          "normal = cgPerturb( - vViewPosition, normal, vec2( dFdx( cgHt ), dFdy( cgHt ) ), faceDirection );");
    };
    // terrainFogScale wraps onBeforeCompile with a generic closure whose
    // source every fog-scaled material shares: the program key must be ours.
    mat.customProgramCacheKey = function () { return "cbzCityGround2"; };
    return mat;
  }

  /* dressPaving(material) — world-space breakup for a tiled Lambert paving
     material (the footway). Call BEFORE terrainFogScale (it chains). */
  function dressPaving(mat) {
    if (!mat || mat.userData && mat.userData.cityPaving) return mat;
    mat.userData = mat.userData || {};
    mat.userData.cityPaving = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh) {
      if (prev) prev.call(this, sh);
      if (sh.vertexShader.indexOf("#include <project_vertex>") < 0 || sh.fragmentShader.indexOf("#include <color_fragment>") < 0) return;
      sh.uniforms.uCgWet = wetU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCgW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCgW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCgW;\nuniform float uCgWet;\n" + NOISE_GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\n{\n" +
          "  vec2 xz = vCgW.xz;\n" +
          "  float m13 = cgNoise( xz / 13.0 + 5.3 ), m41 = cgNoise( xz / 41.0 + 1.7 );\n" +
          "  float k = 1.0 + 0.09 * ( m13 - 0.5 ) + 0.07 * ( m41 - 0.5 );\n" +
          // soft blots (spills, drips, a planter's rust) 0.4-1.2 m, sparse
          "  float b = cgNoise( xz / 0.8 + 3.3 ) * 0.55 + cgNoise( xz / 2.6 + 8.1 ) * 0.45;\n" +
          "  float blot = smoothstep( 0.66, 0.86, b );\n" +
          // gum: one 22 cm cell in ~14 holds a flattened dark dot
          "  vec2 gc = floor( xz / 0.22 );\n" +
          "  vec2 gf = fract( xz / 0.22 ) - 0.5 + ( vec2( cgHash( gc + 7.0 ), cgHash( gc + 13.0 ) ) - 0.5 ) * 0.5;\n" +
          "  float gum = step( 0.93, cgHash( gc + 41.0 ) ) * ( 1.0 - smoothstep( 0.07, 0.17, length( gf ) ) );\n" +
          "  k *= 1.0 - 0.16 * blot - 0.3 * gum;\n" +
          "  k *= 1.0 - uCgWet * 0.3;\n" +
          "  diffuseColor.rgb *= k;\n" +
          "}");
    };
    mat.customProgramCacheKey = function () { return "cbzCityPaving1"; };
    mat.needsUpdate = true;
    return mat;
  }

  CBZ.cityGround = {
    material: material,
    dressPaving: dressPaving,
    // repaint (after a demolition, a rebuilt parcel) — cheap, a few ms
    repaint: function () { for (const st of states) paint(st); },
    // finish every queued town now (plain-node checks, a page that needs it)
    flush: function () { drain(1e9); },
    stats: function () { return Object.assign({ splat: SPLAT, detail: TEX, live: !!live, surfaces: states.length }, stats); },
    coverAt: coverAt,
    palette: { grass: GRASS_HEX, dry: DRY_HEX, lush: LUSH_HEX },   // sRGB display hexes (tools/grass-check.mjs)
    _bakeDetail: bakeDetail,     // plain-node checks
    _paint: paint,
  };

  // The real paint, once buildings, doors, approaches (order 67) and parks
  // exist. Order 68: straight after approach.js solves the driveways.
  if (CBZ.addLandmass) CBZ.addLandmass(function cityGroundPaint(city) {
    if (live && city && city.lots) live.lots = city.lots;
    queue.length = 0;
    for (const st of states) {
      if (st.main) paint(st);          // the downtown: now, it is where you are
      else enqueue(st);                // each town: after the load, a few parcels a frame
    }
    return null;
  }, 68);
})();
