/* ============================================================
   world/tsunami_whitewater.js — THE BORE ON THE LAND, AND ITS WHITE WATER.

   2026-10-20, after three passes that painted the tsunami onto its water.
   What the storyboard showed: flat white blotches lying on a brown sheet
   (cow print), and no wall: from the sea a flat sea with a band of white
   spots at the coast, from the coast nothing rising over the beach. Every
   one of those passes drew the white water as a TEXTURE on a surface, and
   the wall as a pre-shaped wave that stopped being true the moment the
   water was on the land.

   What Miyako, Kesennuma, Natori, Khao Lak and Banda Aceh show instead:
     - a DARK bore 3-10 m high, debris-laden, running up the streets with a
       steep front;
     - its front is a tumbling AERATED MASS: grey-white lumps of foam with
       height and shadow, rolling forward and up, with spray and mist torn
       off the top;
     - where it hits a building it climbs the facade and bursts;
     - where it goes over a wall or a quay edge it pours as a sheet;
     - behind it the water is a fast brown torrent of standing waves and
       boils (that half is the sheet's, world/water_spec.js).

   So the bore is GEOMETRY and the white water is VOLUME, both laid where
   the run-up field (world/tsunami_runup.js) says the water actually is:

   THE SCAN (CPU, at the field's own 30 Hz). Every cell edge of the field
   is one of:
     FRONT     wet | dry, the water going toward the dry side: the bore's
               leading edge. Placed on the depth's 12 cm contour (linear
               along the edge, so it slides continuously as the cell fills),
               facing down the depth gradient, as tall as the water within
               10 m behind it above the ground ahead, heaped by its speed.
     STEP      wet | wet with the surface dropping more than 0.9 m across
               one edge and the water going over it: a CASCADE (free fall
               over a lip: the quay edge in the backwash, a wall) or a bore
               running over water already there (the second crest over the
               standing flood, the sea pouring over the shore).
     IMPACT    street | standing building with the water driving into the
               wall: the burst up the facade.
   Plus, while the director publishes it (after the crash), the SEA FRONT:
   the straight wave still running along the island's flanks, sampled off
   the same formula the sheet is drawn by (CBZ.waterFrontFormulaDrop).

   DRAW 1, THE WALL: one instanced mesh, a piece per FRONT/STEP record
   (7 x 14 vertices). A bore piece is a hydraulic-jump profile: a back slope
   rising off the water behind, a crest leaning forward over a bulging
   roller face, the toe tucked under the ground ahead; a cascade piece is a
   flat sheet on the upper water and a parabolic nappe down to the lower.
   The vertex shader lumps it with a world-space 3D noise rolling down the
   face (pieces overlap and agree, because nothing is per-instance) and
   takes its normal through the lumps. Dark mud body, aerated grey on the
   roller, lit by the scene's sun and sky.

   DRAW 2, THE WHITE WATER: one mesh of camera-facing quads, a ring buffer
   of particles spawned from the same records, animated on the GPU from
   their spawn state (ballistic + drag), written to the GPU only where new
   ones were born, and depth-sorted back to front on every render by
   reordering the index buffer alone. Four kinds:
     CLUMP   the roller: lumps launched forward and up off the face at the
             front's own speed, falling back onto it;
     MIST    big soft puffs off the crest, rising and blown back;
     SPLASH  thrown up a facade or off a cascade's foot;
     SPRAY   small fast clots off the lip.
   Each is a lumpy lit ball, not a disc: a sphere normal bent by two noise
   octaves, lit from the sun with wrap, darkened by how deep inside the
   mass it was born (low on the face = in the shadow of the rest) and by
   facing away from the sun, the silhouette eaten into by the same noise.
   Coloured clean grey-white at the top to the mud at the foot.

   BUDGET (phone law): quality 0-1: 256 wall pieces, 900 particles; 2: 400 /
   1500; 3-4: 480 / 2048. Two draw calls, nothing allocates per frame, the
   scan is two passes of comparisons over <= 160 x 160 cells at 30 Hz.
   LOD: past ~180 m from the camera the sort drops a share of the
   particles (down to 35% at 600 m) and the shader grows the rest by the
   same factor, so the far front keeps its coverage for a fraction of the
   fill; particles under ~2 px fade instead of speckling; none ever covers
   more than ~45% of the screen height.

   API
     CBZ.tsuWhite.attach(parent)   meshes go under `parent` (world-aligned)
     CBZ.tsuWhite.detach()
     CBZ.tsuWhite.seaFront(spec)   {cx, cz, dx, dz, s, half, turbid} | null
     CBZ.tsuWhite.burst(spec)      {x, z, dx, dz, width, y, H} the crash
     CBZ.tsuWhite.stats()          the books
   ============================================================ */
(function () {
  "use strict";
  const ROOT = typeof window !== "undefined" ? window : globalThis;
  const CBZ = ROOT.CBZ;
  if (!CBZ) return;

  const G = 9.81;
  const T_WET = 0.12;          // m: the front is this contour of the depth
  const DROP = 0.9;            // m of surface lost across one edge: a step
  const MAX_REC = 4096;
  const RF = 12;               // floats per record
  // record: 0 x, 1 base y, 2 z, 3 H (crest over base), 4 nx, 5 nz,
  //         6 Hb (water behind, over base), 7 kind, 8 adv (m/s), 9 strength,
  //         10 spawn weight, 11 width (m)
  // RAPID: a steep run of surface that is not a step (the sea pouring over
  // the shore spreads its drop across a band of cells): white water, no wall
  const K_BORE = 0, K_CASCADE = 1, K_IMPACT = 2, K_RAPID = 3;
  const recs = new Float32Array(MAX_REC * RF);
  let nRec = 0;

  const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

  function tierBudget() {
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    return q >= 3 ? { walls: 480, parts: 2048 } : q >= 2 ? { walls: 400, parts: 1500 } : { walls: 256, parts: 900 };
  }

  function push(x, y, z, H, nx, nz, Hb, kind, adv, str, wgt, width) {
    if (nRec >= MAX_REC) return;
    const o = nRec * RF;
    recs[o] = x; recs[o + 1] = y; recs[o + 2] = z; recs[o + 3] = H;
    recs[o + 4] = nx; recs[o + 5] = nz; recs[o + 6] = Hb; recs[o + 7] = kind;
    recs[o + 8] = adv; recs[o + 9] = str; recs[o + 10] = wgt; recs[o + 11] = width;
    nRec++;
  }

  /* ---- THE SCAN ------------------------------------------------------ */
  let Fn = 0, Fdx = 1, Fx0 = 0, Fz0 = 0, Fzb = null, Fh = null, Fu = null, Fv = null, Fforced = null, Fref = null;
  let solid = new Uint8Array(0);            // a standing building's cell
  const _q = {};
  const book = { fronts: 0, cascades: 0, overWater: 0, rapids: 0, impacts: 0, sea: 0 };
  // the drawn surface at a cell (its bed when dry)
  function etaK(k) { return Fh[k] > 0.02 ? Fzb[k] + Fh[k] : Fzb[k]; }
  function hC(i, j) {
    i = i < 0 ? 0 : i >= Fn ? Fn - 1 : i; j = j < 0 ? 0 : j >= Fn ? Fn - 1 : j;
    const h = Fh[j * Fn + i]; return h > 2 ? 2 : h;
  }
  function eC(i, j) {
    i = i < 0 ? 0 : i >= Fn ? Fn - 1 : i; j = j < 0 ? 0 : j >= Fn ? Fn - 1 : j;
    const k = j * Fn + i; return Fh[k] > 0.02 ? Fzb[k] + Fh[k] : Fzb[k];
  }
  // a smooth facing for the record at cell (i, j): down the gradient of
  // `fn`, never more than ~70 degrees off the edge it was found on
  const _n = [0, 0];
  function facing(fn, i, j, dirx, dirz) {
    let nx = -(fn(i + 1, j) - fn(i - 1, j)), nz = -(fn(i, j + 1) - fn(i, j - 1));
    let L = Math.hypot(nx, nz);
    if (L < 1e-3) { _n[0] = dirx; _n[1] = dirz; return _n; }
    nx /= L; nz /= L;
    if (nx * dirx + nz * dirz < 0.35) {
      nx += dirx * 1.5; nz += dirz * 1.5; L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    }
    _n[0] = nx; _n[1] = nz; return _n;
  }

  function edge(a, b, ex, ez, i, j) {
    const sa = solid[a] === 1, sb = solid[b] === 1;
    if (sa !== sb) {
      // ---- IMPACT: the street's water driving into a standing wall
      const s = sa ? b : a, sg = sa ? -1 : 1;
      const hs = Fh[s];
      if (hs < 0.25 || Fforced[s]) return;
      const dirx = ex * sg, dirz = ez * sg;
      const adv = Fu[s] * dirx + Fv[s] * dirz;
      if (adv < 1.0) return;
      const si = sa ? i + ex : i, sj = sa ? j + ez : j;
      const px = Fx0 + (si + 0.5) * Fdx + dirx * Fdx * 0.5, pz = Fz0 + (sj + 0.5) * Fdx + dirz * Fdx * 0.5;
      const run = Math.min(14, hs + adv * adv / (2 * G));
      const str = smooth(1.0, 4.5, adv) * smooth(0.25, 1.2, hs);
      if (str < 0.03) return;
      book.impacts++;
      push(px, Fzb[s], pz, run, dirx, dirz, hs, K_IMPACT, adv, str, str * run * 0.7, Fdx);
      return;
    }
    if (sa) return;                                   // inside a building
    const ha = Fh[a], hb = Fh[b];
    const wa = ha >= T_WET, wb = hb >= T_WET;
    if (wa && wb) {
      // ---- STEP: the surface falls more than DROP across this edge
      const ea = Fzb[a] + ha, eb = Fzb[b] + hb, d = ea - eb;
      if (d < DROP && d > -DROP) return;
      const up = d > 0 ? a : b, lo = d > 0 ? b : a, sg = d > 0 ? 1 : -1;
      if (Fforced[up] && Fforced[lo]) return;         // the open sea is the director's
      const dirx = ex * sg, dirz = ez * sg;
      const drop = d > 0 ? d : -d;
      const adv = Fforced[up] ? 0.75 * Math.sqrt(G * drop) : Fu[up] * dirx + Fv[up] * dirz;
      if (adv < 0.4) return;
      const ui = d > 0 ? i : i + ex, uj = d > 0 ? j : j + ez;
      const px = Fx0 + (ui + 0.5) * Fdx + dirx * Fdx * 0.5, pz = Fz0 + (uj + 0.5) * Fdx + dirz * Fdx * 0.5;
      const eLo = d > 0 ? eb : ea;
      /* A STEP, NOT A SLOPE. The sea pouring over the shore spreads its
         drop over a band of cells; only the edge that drops harder than the
         ones just above and below it along the flow is the step (the lip,
         the bore's jump). The rest of the band is a rapid: white water off
         it, no wall. The sea's own edge (up forced) is always the step. */
      const dk = (ex + ez * Fn) * sg;
      const ii = ui - ex * sg, jj = uj - ez * sg, i2 = ui + 2 * ex * sg, j2 = uj + 2 * ez * sg;
      const dUp = ii >= 0 && jj >= 0 && ii < Fn && jj < Fn ? etaK(up - dk) - etaK(up) : 0;
      const dDn = i2 >= 0 && j2 >= 0 && i2 < Fn && j2 < Fn ? etaK(lo) - etaK(lo + dk) : 0;
      if (!Fforced[up] && drop < 1.2 * Math.max(dUp, dDn)) {
        if (((i + j) & 1) || drop < 1.2) return;
        const str = smooth(0.4, 3.0, adv) * smooth(1.2, 3.0, drop);
        book.rapids++;
        push(px, eLo, pz, drop, dirx, dirz, drop, K_RAPID, adv, str, 0.35 * str * drop, Fdx);
        return;
      }
      const nn = facing(eC, ui, uj, dirx, dirz);
      if (Fzb[up] > eLo - 0.1 && Fzb[up] - Fzb[lo] > 0.6) {
        // free fall over a lip: the quay edge, a wall, a kerb of the shore
        const str = smooth(0.4, 2.0, adv) * smooth(DROP, 2.0, drop);
        book.cascades++;
        push(px, eLo, pz, drop, nn[0], nn[1], drop, K_CASCADE, adv, str, str * drop, Fdx);
      } else {
        // a bore running over water that is already there
        const H = Math.min(16, drop + 0.55 * adv * adv / (2 * G));
        const str = smooth(0.3, 2.2, adv) * smooth(DROP, 1.6, drop);
        book.overWater++;
        push(px, eLo, pz, H, nn[0], nn[1], drop, K_BORE, adv, str, str * H, Fdx);
      }
      return;
    }
    if (!wa && !wb) return;
    // ---- FRONT: wet | dry
    const wet = wa ? a : b, dry = wa ? b : a, sg = wa ? 1 : -1;
    if (Fforced[dry]) return;      // a tongue running out over the drained seabed: backwash, not a bore
    const dirx = ex * sg, dirz = ez * sg;
    const hw = Fh[wet], hd = Fh[dry];
    const fr = Math.min(1, Math.max(0, (hw - T_WET) / Math.max(1e-4, hw - hd)));
    const wi = wa ? i : i + ex, wj = wa ? j : j + ez;
    const px = Fx0 + (wi + 0.5) * Fdx + dirx * Fdx * fr, pz = Fz0 + (wj + 0.5) * Fdx + dirz * Fdx * fr;
    const nn = facing(hC, wi, wj, dirx, dirz);
    const nx = nn[0], nz = nn[1];
    const base = Fzb[dry] + hd;
    const etaW = Fzb[wet] + hw;
    let adv;
    if (Fforced[wet]) adv = 0.75 * Math.sqrt(G * Math.max(0, etaW - base));
    else adv = Fu[wet] * nx + Fv[wet] * nz;
    if (adv < 0.3) return;
    // the water within ten metres behind the edge (the edge itself tapers to nothing)
    let etaMax = etaW, etaB = etaW;
    for (let s = 0; s < 3; s++) {
      const dist = s === 0 ? 3 : s === 1 ? 6 : 10;
      const r = Fref.sample(px - nx * dist, pz - nz * dist, _q);
      if (!(r.in > 0) || !(r.depth > 0.05)) continue;
      if (r.eta > etaMax) etaMax = r.eta;
      if (s === 1) etaB = r.eta;
    }
    const H = Math.min(16, Math.max(0, etaMax - base) + 0.55 * adv * adv / (2 * G));
    const str = smooth(0.3, 2.2, adv) * smooth(0.25, 0.9, H);
    if (str < 0.04) return;
    book.fronts++;
    push(px, base, pz, H, nx, nz, Math.max(0, etaB - base), K_BORE, adv, str, str * H, Fdx);
  }

  function scanField(F) {
    Fn = F.n; Fdx = F.cell; Fx0 = F.x0; Fz0 = F.z0; Fzb = F.zb; Fh = F.h; Fu = F.u; Fv = F.v;
    Fforced = F.forced; Fref = F;
    const n = Fn, h = Fh, bid = F.bid, blocks = F.blocks;
    if (solid.length !== n * n) solid = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) { const b = bid[k]; solid[k] = b >= 0 && blocks[b] && !blocks[b].fallen ? 1 : 0; }
    for (let j = 0; j < n; j++) {
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const a = row + i, wa = h[a] >= T_WET;
        if (i < n - 1 && (wa || h[a + 1] >= T_WET)) edge(a, a + 1, 1, 0, i, j);
        if (j < n - 1 && (wa || h[a + n] >= T_WET)) edge(a, a + n, 0, 1, i, j);
      }
    }
    Fref = null;
  }

  /* THE SEA FRONT after the crash: the straight wave still running along
     the flanks. The step is read off the very formula the sheet is drawn
     by, so the wall stands exactly on the sheet's ramp (fd -1 .. +7). */
  function scanSea(sf, F) {
    if (!sf || !CBZ.waterFrontFormulaDrop) return;
    const mean = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
    const dx = sf.dx, dz = sf.dz, px = -dz, pz = dx;
    const SP = 3.5;
    for (let l = -sf.half; l <= sf.half; l += SP) {
      const bx = sf.cx + dx * (sf.s + 7) + px * l, bz = sf.cz + dz * (sf.s + 7) + pz * l;
      if (F) {
        const r = F.sample(bx, bz, _q);
        if (r.in > 0.5 && r.forced < 0.5) continue;           // the land: the field's own fronts
        const r2 = F.sample(bx - dx * 9, bz - dz * 9, _q);
        if (r2.in > 0.5 && r2.forced < 0.5) continue;
      }
      const dA = CBZ.waterFrontFormulaDrop(bx + dx * 2, bz + dz * 2);
      const dB = CBZ.waterFrontFormulaDrop(bx - dx * 10, bz - dz * 10);
      const step = dA - dB;
      if (step < 0.6) continue;
      const adv = Number.isFinite(sf.v) ? Math.max(4, Math.min(14, sf.v * 0.25)) : 9;
      const H = Math.min(16, step * 1.12 + 0.55 * adv * adv / (2 * G) * 0.5);
      const str = smooth(0.6, 3.0, step);
      book.sea++;
      push(bx, mean - dA, bz, H, dx, dz, step, K_BORE, adv, str, str * H * (SP / 2.5), SP);
    }
  }

  /* ============================================================
     THE GPU HALF (built lazily on the first attach)
     ============================================================ */
  const S = {
    parent: null, built: false, T: 0, lastFieldT: -1, seaFront: null, turbid: 0.85,
    wall: null, wallGeo: null, wallMat: null, wallCap: 0, wallN: 0,
    partMat: null, foam: null, mist: null, lastBirth: -1e9,
    light: null, budget: null, rnd: 1, nField: 0,
    spawned: 0, cum: null, cumN: 0, cumTot: 0,
  };
  function rnd() {
    S.rnd = (S.rnd + 0x6D2B79F5) >>> 0;
    let t = S.rnd;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const NOISE3 = [
    "float h31( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }",
    "float vn3( vec3 x ) {",
    "  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( mix( h31( i ), h31( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),",
    "                   mix( h31( i + vec3( 0.0, 1.0, 0.0 ) ), h31( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),",
    "              mix( mix( h31( i + vec3( 0.0, 0.0, 1.0 ) ), h31( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),",
    "                   mix( h31( i + vec3( 0.0, 1.0, 1.0 ) ), h31( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );",
    "}",
  ].join("\n");
  const NOISE2 = [
    "float h21( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }",
    "float vn2( vec2 p ) {",
    "  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );",
    "}",
  ].join("\n");

  function lightUniforms() {
    return {
      uSunDir: { value: new THREE.Vector3(0.42, 0.79, -0.09) },
      uSunCol: { value: new THREE.Color(1.0, 0.96, 0.88) },
      uSkyCol: { value: new THREE.Color(0.62, 0.72, 0.86) },
      uGndCol: { value: new THREE.Color(0.22, 0.24, 0.18) },
    };
  }

  /* ---- DRAW 1: THE WALL --------------------------------------------- */
  const W_COLS = 6, W_ROWS = 13;
  function buildWall(cap, light) {
    const geo = new THREE.InstancedBufferGeometry();
    const nv = (W_COLS + 1) * (W_ROWS + 1);
    const pos = new Float32Array(nv * 3);
    for (let r = 0; r <= W_ROWS; r++) for (let c = 0; c <= W_COLS; c++) {
      const k = (r * (W_COLS + 1) + c) * 3;
      pos[k] = c / W_COLS - 0.5;         // u: across the front, -0.5 .. 0.5
      pos[k + 1] = r / W_ROWS;           // p: along the profile, back 0 .. toe 1
      pos[k + 2] = 0;
    }
    const idx = [];
    for (let r = 0; r < W_ROWS; r++) for (let c = 0; c < W_COLS; c++) {
      const a = r * (W_COLS + 1) + c, b = a + 1, d = a + W_COLS + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const iA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const iB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const iC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    iA.setUsage(THREE.DynamicDrawUsage); iB.setUsage(THREE.DynamicDrawUsage); iC.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iA", iA); geo.setAttribute("iB", iB); geo.setAttribute("iC", iC);
    geo.instanceCount = 0;

    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uT: { value: 0 }, uTurb: { value: 0.85 },
      // LINEAR (through ACES + sRGB they land much lighter than they read)
      uMud: { value: new THREE.Color(0.060, 0.050, 0.038) },
      uSea: { value: new THREE.Color(0.040, 0.075, 0.066) },
      uFoamC: { value: new THREE.Color(0.52, 0.53, 0.50) },
      uFoamM: { value: new THREE.Color(0.33, 0.295, 0.24) },
    });
    uni.uSunDir = light.uSunDir; uni.uSunCol = light.uSunCol; uni.uSkyCol = light.uSkyCol; uni.uGndCol = light.uGndCol;

    const VERT = [
      "attribute vec4 iA;",   // x, base y, z, H (crest over base)
      "attribute vec4 iB;",   // nx, nz, Hb (water behind, over base), kind (0 bore, 1 cascade)
      "attribute vec4 iC;",   // adv (m/s), strength, width (m), -
      "uniform float uT;",
      "varying vec3 vW;",
      "varying vec3 vN;",
      "varying vec4 vF;",     // p, lump, kind, H
      "#include <fog_pars_vertex>",
      NOISE3,
      // the rest shape: world position of (u, p) on this piece
      "vec3 boreAt( float u, float p ) {",
      "  float H = iA.w, Hb = min( iB.z, iA.w ), adv = iC.x;",
      "  vec2 n = iB.xy, t = vec2( -iB.y, iB.x );",
      // the ends sit lower, so the overlapping pieces of one front read as one
      "  float eu = abs( u ) * 2.0;",
      "  float Ht = max( Hb, H * ( 1.0 - 0.38 * smoothstep( 0.30, 1.0, eu ) ) );",
      "  float f, y;",
      "  if ( iB.w < 0.5 ) {",
      // THE BORE: a back slope off the water behind, a crest leaning forward,
      // a roller face bulging out over the toe, the toe under the ground
      "    float Lb = max( 3.0, 1.6 * Ht );",
      "    float cz = -0.35 * Ht;",
      "    if ( p < 0.5 ) {",
      "      float s = p / 0.5, e = s * s * ( 3.0 - 2.0 * s );",
      "      f = mix( cz - Lb, cz, s );",
      "      y = mix( Hb - 0.3, Ht, e );",
      "    } else {",
      "      float s = ( p - 0.5 ) / 0.5, a = s * 3.14159265;",
      "      f = mix( cz, 0.0, s ) + 0.32 * Ht * sin( a ) * ( 1.0 - 0.25 * s );",
      "      y = Ht * ( 0.5 + 0.5 * cos( a ) ) - 0.45 * s * s;",
      "    }",
      "  } else {",
      // THE CASCADE: the sheet on the upper water, then the nappe falling free
      "    float vh = max( 1.2, adv );",
      "    if ( p < 0.5 ) { f = mix( -3.5, 0.0, p / 0.5 ); y = Ht - 0.04; }",
      "    else {",
      "      float s = ( p - 0.5 ) / 0.5, tau = s * sqrt( 2.0 * max( Ht, 0.2 ) / 9.81 );",
      "      f = vh * tau; y = Ht - 4.905 * tau * tau - 0.35 * s * s;",
      "    }",
      "  }",
      "  vec2 xz = iA.xz + n * f + t * u * iC.z;",
      "  return vec3( xz.x, iA.y + y, xz.y );",
      "}",
      // the tumbling: lumps rolling down the face and evolving, in WORLD space
      // (the overlapping pieces agree where they meet)
      "float lump( vec3 w ) {",
      "  vec3 q = w * 0.40 + vec3( uT * 0.33, uT * 1.25, -uT * 0.27 );",
      "  return vn3( q ) * 0.66 + vn3( q * 2.13 + vec3( 3.1, uT * 0.9, 7.7 ) ) * 0.34;",
      "}",
      "void main() {",
      "  float u = position.x, p = position.y;",
      "  float dp = p < 0.97 ? 0.03 : -0.03;",
      "  vec3 P0 = boreAt( u, p ), Pu = boreAt( u + 0.04, p ), Pp = boreAt( u, p + dp );",
      "  vec3 N0 = normalize( cross( Pu - P0, ( Pp - P0 ) * sign( dp ) ) );",
      "  float H = iA.w;",
      // where it boils: the roller (the crest and the face), a little on the back
      "  float zone = iB.w < 0.5 ? ( 0.25 + 0.75 * smoothstep( 0.30, 0.52, p ) * ( 1.0 - 0.55 * smoothstep( 0.88, 1.0, p ) ) ) : 0.35 * smoothstep( 0.5, 0.7, p );",
      "  float amp = clamp( 0.17 * H, 0.15, 1.5 ) * zone * ( 0.4 + 0.6 * iC.y );",
      "  float l0 = lump( P0 ), lu = lump( Pu ), lp = lump( Pp );",
      "  vec3 Q0 = P0 + N0 * ( l0 - 0.45 ) * amp;",
      "  vec3 Qu = Pu + N0 * ( lu - 0.45 ) * amp;",
      "  vec3 Qp = Pp + N0 * ( lp - 0.45 ) * amp;",
      "  vec3 N = normalize( cross( Qu - Q0, ( Qp - Q0 ) * sign( dp ) ) );",
      "  vW = Q0;",
      "  vN = N;",
      "  vF = vec4( p, l0, iB.w, H );",
      "  vec4 mvPosition = viewMatrix * vec4( Q0, 1.0 );",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const FRAG = [
      "uniform float uT, uTurb;",
      "uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol, uMud, uSea, uFoamC, uFoamM;",
      "varying vec3 vW;",
      "varying vec3 vN;",
      "varying vec4 vF;",
      "#include <fog_pars_fragment>",
      NOISE3,
      "void main() {",
      "  vec3 V = normalize( cameraPosition - vW );",
      "  vec3 N = normalize( vN );",
      "  if ( dot( N, V ) < 0.0 ) N = -N;",
      "  float p = vF.x, lumpV = vF.y;",
      "  bool casc = vF.z > 0.5;",
      // fine churn, as a bump through the screen derivatives (Mikkelsen's
      // unparametrised bump: no tangents, no per-piece frame)
      "  vec3 fq = vW * vec3( 1.1, casc ? 0.35 : 1.1, 1.1 ) + vec3( 0.0, uT * ( casc ? 6.0 : 2.2 ), uT * 0.4 );",
      "  float fine = vn3( fq ) * 0.6 + vn3( fq * 2.3 + 4.0 ) * 0.4;",
      "  vec3 dpx = dFdx( vW ), dpy = dFdy( vW );",
      "  float fx = dFdx( fine ), fy = dFdy( fine );",
      "  vec3 r1 = cross( dpy, N ), r2 = cross( N, dpx );",
      "  float det = dot( dpx, r1 );",
      "  float fp = max( length( dpx ), length( dpy ) );",
      "  float bk = ( 1.0 - smoothstep( 0.15, 0.6, fp ) ) * 0.55;",
      "  if ( abs( det ) > 1e-6 ) N = normalize( N - bk * ( r1 * fx + r2 * fy ) / det );",
      "  float ndl = max( dot( N, uSunDir ), 0.0 );",
      "  float wrap = clamp( ( dot( N, uSunDir ) + 0.55 ) / 1.55, 0.0, 1.0 );",
      "  vec3 hemi = mix( uGndCol, uSkyCol, 0.5 + 0.5 * N.y );",
      // the body: dark, a suspension (sea-green only while it is clean)
      "  vec3 body = mix( uSea, uMud, clamp( uTurb * 1.15, 0.0, 1.0 ) ) * ( 0.62 + 0.55 * lumpV );",
      "  vec3 Rv = reflect( -V, N );",
      "  float fres = pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 5.0 );",
      "  vec3 bodyLit = body * ( hemi * 0.75 + uSunCol * ndl * 0.55 );",
      "  bodyLit += mix( uGndCol, uSkyCol, smoothstep( -0.1, 0.6, Rv.y ) ) * ( 0.04 + 0.30 * fres ) * ( 1.0 - 0.5 * uTurb );",
      "  vec3 Hh = normalize( uSunDir + V );",
      "  bodyLit += uSunCol * pow( max( dot( N, Hh ), 0.0 ), 70.0 ) * 0.45;",
      // the aerated roller: grey, lumpy, torn, never paper
      "  float cov;",
      "  if ( !casc ) {",
      "    float roll = smoothstep( 0.40, 0.56, p ) * ( 1.0 - 0.35 * smoothstep( 0.9, 1.0, p ) );",
      "    float torn = smoothstep( 0.30, 0.70, lumpV * 0.55 + fine * 0.45 + 0.08 );",
      "    cov = roll * mix( 0.35, 1.0, torn ) + ( 1.0 - roll ) * 0.35 * smoothstep( 0.60, 0.80, fine );",
      "  } else {",
      "    float fall = smoothstep( 0.5, 0.62, p );",
      "    cov = mix( 0.15 * smoothstep( 0.55, 0.8, fine ), 0.25 + 0.6 * smoothstep( 0.35, 0.75, fine ), fall );",
      "  }",
      "  vec3 fAlb = mix( uFoamC, uFoamM, clamp( uTurb * ( 0.55 + 0.45 * ( 1.0 - p ) ), 0.0, 1.0 ) );",
      "  float ao = 0.55 + 0.45 * smoothstep( 0.2, 0.8, lumpV );",
      "  vec3 foamLit = fAlb * ( hemi * 0.85 * ao + uSunCol * wrap * 0.62 * ( 0.7 + 0.3 * ao ) );",
      "  foamLit += uSunCol * pow( max( dot( N, Hh ), 0.0 ), 24.0 ) * 0.08;",
      "  vec3 col = mix( bodyLit, foamLit, clamp( cov, 0.0, 1.0 ) );",
      "  gl_FragColor = vec4( col, 1.0 );",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Wall", uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.DoubleSide, fog: true, extensions: { derivatives: true },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "tsunami-bore-wall";
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.userData.noCoat = true;
    mesh.userData.terrain = true;        // batch.js / farcull.js keep their hands off
    mesh.visible = false;
    S.wall = mesh; S.wallGeo = geo; S.wallMat = mat; S.wallCap = cap;
  }

  // the strongest records first when there are more than the cap
  let order = new Uint32Array(0), keyW = new Float32Array(0);
  function fillWalls() {
    const geo = S.wallGeo;
    if (!geo) return;
    const A = geo.attributes.iA.array, B = geo.attributes.iB.array, C = geo.attributes.iC.array;
    let m = 0;
    if (order.length < nRec) { order = new Uint32Array(MAX_REC); keyW = new Float32Array(MAX_REC); }
    for (let r = 0; r < nRec; r++) {
      const o = r * RF;
      if (recs[o + 7] === K_IMPACT || recs[o + 7] === K_RAPID) continue;
      order[m] = r; keyW[r] = recs[o + 10]; m++;
    }
    let sel = order.subarray(0, m);
    if (m > S.wallCap) { sel.sort((x, y) => keyW[y] - keyW[x]); sel = sel.subarray(0, S.wallCap); m = S.wallCap; }
    for (let q = 0; q < m; q++) {
      const o = sel[q] * RF, k = q * 4;
      const str = recs[o + 9], Hb = recs[o + 6], H = recs[o + 3];
      // a weak front is mostly the water behind it, not a wall
      A[k] = recs[o]; A[k + 1] = recs[o + 1]; A[k + 2] = recs[o + 2]; A[k + 3] = Hb + (H - Hb) * (0.35 + 0.65 * str);
      B[k] = recs[o + 4]; B[k + 1] = recs[o + 5]; B[k + 2] = Hb; B[k + 3] = recs[o + 7];
      C[k] = recs[o + 8]; C[k + 1] = str; C[k + 2] = recs[o + 11] * 2.2; C[k + 3] = 0;
    }
    S.wallN = m;
    geo.instanceCount = m;
    if (m > 0) {
      for (const nm of ["iA", "iB", "iC"]) {
        const at = geo.attributes[nm];
        at.updateRange.offset = 0; at.updateRange.count = m * 4; at.needsUpdate = true;
      }
    }
    S.wall.visible = m > 0;
  }


  /* ---- DRAWS 2 + 3: THE WHITE WATER ---------------------------------
     Two pools, one shader: the FOAM (clumps, splash, spray: short lives)
     and the MIST (long lives). Each is a ring whose turnover is never
     shorter than the longest life in it, so nothing is overwritten while it
     is still on screen; each is sorted back to front for every render. The
     mist draws after the foam: it is thin enough that the few places where
     a puff behind a clump lands over it read as haze, not as an error. */
  const P_CLUMP = 0, P_MIST = 1, P_SPLASH = 2, P_SPRAY = 3;
  // per kind: drag (1/s), gravity (m/s^2)
  const KDRAG = [0.9, 1.5, 0.6, 0.35], KGRAV = [7.0, -0.5, 9.0, 9.8];
  const FOAM_LIFE = 2.0, MIST_LIFE = 4.6;
  function partMaterial(light) {
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uT: { value: 0 }, uTurb: { value: 0.85 }, uPx: { value: 450 }, uMaxPx: { value: 380 },
      uSunV: { value: new THREE.Vector3(0, 1, 0) },
      // LINEAR: aerated water is grey-white at its cleanest, the mud at its foot
      uFoamC: { value: new THREE.Color(0.66, 0.67, 0.64) },
      uFoamM: { value: new THREE.Color(0.40, 0.355, 0.29) },
      uMist: { value: new THREE.Color(0.62, 0.62, 0.60) },
    });
    uni.uSunDir = light.uSunDir; uni.uSunCol = light.uSunCol; uni.uSkyCol = light.uSkyCol; uni.uGndCol = light.uGndCol;
    const VERT = [
      "attribute vec4 aP;",    // x, y, z, birth time
      "attribute vec4 aV;",    // vx, vy, vz, life (s)
      "attribute vec4 aK;",    // kind, size (m), growth, seed
      "attribute vec4 aS;",    // base y, H, nx, nz (the front it came off)
      "uniform float uT, uTurb, uPx, uMaxPx;",
      "uniform vec3 uSunDir;",
      "varying vec2 vUV;",
      "varying vec4 vA;",      // alpha, kind, seed, rotation
      "varying vec2 vL;",      // self-shadow, mud share
      "#include <fog_pars_vertex>",
      "void main() {",
      "  float tau = uT - aP.w;",
      "  vUV = position.xy; vA = vec4( 0.0 ); vL = vec2( 1.0, 0.0 );",
      "  if ( tau < 0.0 || tau > aV.w ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }",
      "  float kd = aK.x;",
      "  bool mist = kd > 0.5 && kd < 1.5;",
      "  float drag = kd < 0.5 ? " + KDRAG[0].toFixed(2) + " : kd < 1.5 ? " + KDRAG[1].toFixed(2) + " : kd < 2.5 ? " + KDRAG[2].toFixed(2) + " : " + KDRAG[3].toFixed(2) + ";",
      "  float grav = kd < 0.5 ? " + KGRAV[0].toFixed(2) + " : kd < 1.5 ? " + KGRAV[1].toFixed(2) + " : kd < 2.5 ? " + KGRAV[2].toFixed(2) + " : " + KGRAV[3].toFixed(2) + ";",
      "  float e = ( 1.0 - exp( -drag * tau ) ) / drag;",
      "  vec3 p = aP.xyz + vec3( aV.x * e, aV.y * tau - 0.5 * grav * tau * tau, aV.z * e );",
      "  p.y = max( p.y, aS.x - 0.3 );",
      "  float x = tau / max( 0.01, aV.w );",
      "  float size = aK.y * ( 1.0 + aK.z * x );",
      "  float a = smoothstep( 0.0, mist ? 0.18 : 0.06, x ) * ( 1.0 - smoothstep( mist ? 0.45 : 0.62, 1.0, x ) );",
      "  a *= kd < 0.5 ? 0.92 : mist ? 0.30 : kd < 2.5 ? 0.85 : 0.75;",
      "  vec4 mvPosition = viewMatrix * vec4( p, 1.0 );",
      "  float dz = -mvPosition.z;",
      // LOD: the sort keeps fewer far away; the survivors grow to cover for them
      "  float keep = clamp( 1.0 - ( dz - 180.0 ) / 650.0, 0.35, 1.0 );",
      "  size /= sqrt( keep );",
      "  float px = size * projectionMatrix[1][1] * uPx / max( 0.5, dz );",
      "  if ( px > uMaxPx ) size *= uMaxPx / px;",
      "  a *= smoothstep( 0.8, 2.6, px ) * smoothstep( 1.0, 4.5, dz );",
      // spin: the noise turns, the lighting does not
      "  float rot = aK.w * 6.2832 + tau * ( aK.w - 0.5 ) * 2.2;",
      "  mvPosition.xy += position.xy * size;",
      "  gl_Position = projectionMatrix * mvPosition;",
      // deep in the mass is in its own shadow; a face turned from the sun is darker
      "  float lift = clamp( ( p.y - aS.x ) / max( 0.6, aS.y ), 0.0, 1.2 );",
      "  vec2 sxz = uSunDir.xz; float sl = length( sxz );",
      "  float toward = sl > 0.01 ? dot( aS.zw, sxz / sl ) : 0.0;",
      "  float sh = mist ? 0.85 + 0.15 * min( lift, 1.0 ) : mix( 0.38, 1.0, smoothstep( 0.0, 1.0, lift ) ) * ( 0.78 + 0.22 * toward );",
      "  vL = vec2( sh, uTurb * ( mist ? 0.35 : 0.45 + 0.55 * ( 1.0 - min( lift, 1.0 ) ) ) );",
      "  vA = vec4( a, kd, aK.w, rot );",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");
    const FRAG = [
      "uniform vec3 uSunV, uSunCol, uSkyCol, uGndCol, uFoamC, uFoamM, uMist;",
      "varying vec2 vUV;",
      "varying vec4 vA;",
      "varying vec2 vL;",
      "#include <fog_pars_fragment>",
      NOISE2,
      "void main() {",
      "  float r2 = dot( vUV, vUV );",
      "  if ( r2 > 1.0 || vA.x < 0.003 ) discard;",
      "  float cr = cos( vA.w ), sr = sin( vA.w );",
      "  vec2 q = vec2( cr * vUV.x - sr * vUV.y, sr * vUV.x + cr * vUV.y ) * 1.6 + vA.z * 37.0;",
      "  float n1 = vn2( q ), n2 = vn2( q * 2.3 + 5.1 );",
      "  float lumpy = n1 * 0.62 + n2 * 0.38;",
      "  bool mist = vA.y > 0.5 && vA.y < 1.5;",
      "  float edge = 1.0 - r2;",
      // the silhouette is eaten in where the lumps are low: cauliflower, not a disc
      "  float m = mist ? edge * edge * ( 0.55 + 0.45 * lumpy ) : smoothstep( 0.02, 0.42, edge + ( lumpy - 0.5 ) * 0.75 );",
      "  float alpha = vA.x * m;",
      "  if ( alpha < 0.004 ) discard;",
      // a lumpy ball: the sphere normal bent by the lumps, lit from the sun
      "  vec3 N = normalize( vec3( vUV + ( vec2( n1, n2 ) - 0.5 ) * 0.9, sqrt( max( 0.0, edge ) ) + 0.2 ) );",
      "  float wrap = clamp( ( dot( N, uSunV ) + 0.5 ) / 1.5, 0.0, 1.0 );",
      "  vec3 amb = mix( uGndCol, uSkyCol, 0.55 + 0.45 * N.y );",
      "  float ao = 0.60 + 0.40 * lumpy;",
      "  vec3 alb = mist ? mix( uMist, uFoamM, vL.y ) : mix( uFoamC, uFoamM, clamp( vL.y, 0.0, 1.0 ) );",
      "  vec3 col = mist ? alb * ( amb * 0.95 + uSunCol * 0.45 * vL.x ) : alb * ( amb * 0.80 * ao * ( 0.55 + 0.45 * vL.x ) + uSunCol * wrap * 0.70 * vL.x );",
      "  gl_FragColor = vec4( col, alpha );",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    return new THREE.ShaderMaterial({
      name: "CBZ Bore White Water", uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: true,
    });
  }

  function buildPool(cap, mat, name, order, maxLife) {
    const geo = new THREE.BufferGeometry();
    const nv = cap * 4;
    const aC = new Float32Array(nv * 2);
    const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
    for (let i = 0; i < cap; i++) for (let c = 0; c < 4; c++) { aC[(i * 4 + c) * 2] = CX[c]; aC[(i * 4 + c) * 2 + 1] = CY[c]; }
    const mk = () => { const a = new THREE.BufferAttribute(new Float32Array(nv * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aP = mk(), aV = mk(), aK = mk(), aS = mk();
    for (let i = 0; i < nv; i++) aP.array[i * 4 + 3] = 1e9;   // dead until born
    geo.setAttribute("position", new THREE.BufferAttribute(aC, 2));   // the corner
    geo.setAttribute("aP", aP); geo.setAttribute("aV", aV); geo.setAttribute("aK", aK); geo.setAttribute("aS", aS);
    const idx = new THREE.BufferAttribute(new Uint16Array(cap * 6), 1);
    idx.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData.noCoat = true;
    mesh.userData.terrain = true;
    mesh.visible = false;
    const pool = { mesh: mesh, geo: geo, aP: aP, aV: aV, aK: aK, aS: aS, idx: idx, keys: new Uint32Array(cap),
      cap: cap, head: 0, dirtyLo: -1, dirtyHi: -1, acc: 0, alive: 0, maxLife: maxLife, lastBirth: -1e9 };
    mesh.onBeforeRender = function (renderer, scene, camera) { sortPool(pool, renderer, camera); };
    return pool;
  }

  // one particle into a pool's ring (4 identical vertices but the corner)
  function emit(pool, x, y, z, vx, vy, vz, life, kind, size, grow, baseY, H, nx, nz) {
    const i = pool.head; pool.head = (pool.head + 1) % pool.cap;
    const P = pool.aP.array, Vv = pool.aV.array, K = pool.aK.array, Sa = pool.aS.array;
    const seed = rnd();
    life = Math.min(life, pool.maxLife);
    for (let c = 0; c < 4; c++) {
      const o = (i * 4 + c) * 4;
      P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = S.T;
      Vv[o] = vx; Vv[o + 1] = vy; Vv[o + 2] = vz; Vv[o + 3] = life;
      K[o] = kind; K[o + 1] = size; K[o + 2] = grow; K[o + 3] = seed;
      Sa[o] = baseY; Sa[o + 1] = H; Sa[o + 2] = nx; Sa[o + 3] = nz;
    }
    if (pool.dirtyLo < 0) { pool.dirtyLo = i; pool.dirtyHi = i; }
    else if (i === pool.dirtyHi + 1) pool.dirtyHi = i;
    else { pool.dirtyLo = 0; pool.dirtyHi = pool.cap - 1; }        // wrapped: the whole ring
    S.spawned++;
    pool.lastBirth = S.T; S.lastBirth = S.T;
  }
  // the time a ballistic particle comes back down to `floorY` (or its life)
  function landT(y0, vy, g, floorY, life) {
    if (g <= 0) return life;
    const c = y0 - floorY, disc = vy * vy + 2 * g * c;
    if (disc <= 0) return Math.min(life, 0.3);
    const t = (vy + Math.sqrt(disc)) / g;
    return Math.max(0.25, Math.min(life, t));
  }
  /* Hand the GPU only what was born since its last upload. Three resets an
     attribute's updateRange.count to -1 when it uploads; until it has, a
     second batch (two sim steps between renders) widens the same range. */
  function flushPool(pool) {
    if (pool.dirtyLo < 0) return;
    const off = pool.dirtyLo * 16, cnt = (pool.dirtyHi - pool.dirtyLo + 1) * 16;
    for (const at of [pool.aP, pool.aV, pool.aK, pool.aS]) {
      const ur = at.updateRange;
      if (ur.count === -1) { ur.offset = off; ur.count = cnt; }
      else { const lo = Math.min(ur.offset, off), hi = Math.max(ur.offset + ur.count, off + cnt); ur.offset = lo; ur.count = hi - lo; }
      at.needsUpdate = true;
    }
    pool.dirtyLo = -1; pool.dirtyHi = -1;
  }

  /* ---- THE SORT (every render, for that render's camera) ------------- */
  function sortPool(pool, renderer, camera) {
    const cap = pool.cap;
    const e = camera.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
    // the sun in view space, for the balls' lighting
    const sd = S.light.uSunDir.value, vi = camera.matrixWorldInverse.elements;
    S.partMat.uniforms.uSunV.value.set(vi[0] * sd.x + vi[4] * sd.y + vi[8] * sd.z, vi[1] * sd.x + vi[5] * sd.y + vi[9] * sd.z, vi[2] * sd.x + vi[6] * sd.y + vi[10] * sd.z).normalize();
    const P = pool.aP.array, Vv = pool.aV.array, K = pool.aK.array, Sa = pool.aS.array, T = S.T, keys = pool.keys;
    let m = 0;
    for (let i = 0; i < cap; i++) {
      const o = i * 16;
      const tau = T - P[o + 3];
      if (!(tau >= 0) || tau > Vv[o + 3]) continue;
      const kd = K[o] | 0, dr = KDRAG[kd], gr = KGRAV[kd];
      const ef = (1 - Math.exp(-dr * tau)) / dr;
      const x = P[o] + Vv[o] * ef - cx;
      const y = Math.max(P[o + 1] + Vv[o + 1] * tau - 0.5 * gr * tau * tau, Sa[o] - 0.3) - cy;
      const z = P[o + 2] + Vv[o + 2] * ef - cz;
      const dz = x * fx + y * fy + z * fz;
      if (dz < 0.5) continue;
      // LOD: the same keep share the shader grows the survivors by
      const keep = Math.min(1, Math.max(0.35, 1 - (dz - 180) / 650));
      if (keep < 1 && K[o + 3] > keep) continue;
      let q = Math.round(dz * 16); q = q > 65535 ? 65535 : q;
      keys[m++] = (((65535 - q) << 16) | i) >>> 0;      // far first
    }
    const ks = keys.subarray(0, m);
    ks.sort();
    const ix = pool.idx.array;
    for (let j = 0; j < m; j++) {
      const v = (ks[j] & 0xffff) * 4, o = j * 6;
      ix[o] = v; ix[o + 1] = v + 1; ix[o + 2] = v + 2; ix[o + 3] = v; ix[o + 4] = v + 2; ix[o + 5] = v + 3;
    }
    if (m > 0) { pool.idx.updateRange.offset = 0; pool.idx.updateRange.count = m * 6; pool.idx.needsUpdate = true; }
    pool.geo.setDrawRange(0, m * 6);
    pool.alive = m;
    const ph = renderer && renderer.domElement ? renderer.domElement.height : 900;
    S.partMat.uniforms.uPx.value = ph * 0.5;
    S.partMat.uniforms.uMaxPx.value = ph * 0.45;
  }

  /* ---- spawning from the records ------------------------------------- */
  function buildCum() {
    if (!S.cum || S.cum.length < MAX_REC) S.cum = new Float32Array(MAX_REC);
    let tot = 0;
    for (let r = 0; r < nRec; r++) { tot += Math.max(0, recs[r * RF + 10]); S.cum[r] = tot; }
    S.cumN = nRec; S.cumTot = tot;
  }
  function pick() {
    const x = rnd() * S.cumTot, c = S.cum;
    let lo = 0, hi = S.cumN - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }
  function spawnFrom(r, mist) {
    const o = r * RF;
    const x0 = recs[o], by = recs[o + 1], z0 = recs[o + 2], H = Math.max(0.4, recs[o + 3]);
    const nx = recs[o + 4], nz = recs[o + 5], Hb = recs[o + 6], kind = recs[o + 7];
    const adv = recs[o + 8], width = recs[o + 11];
    const tx = -nz, tz = nx;
    const l = (rnd() - 0.5) * width * 1.4;
    const hs = Math.max(0.7, Math.min(2.4, Math.sqrt(H / 3)));
    const k = rnd();
    const F = S.foam, M = S.mist, Hm = Math.max(1, H);
    if (kind === K_IMPACT) {
      // up the facade and back off it
      const x = x0 + tx * l - nx * 0.4, z = z0 + tz * l - nz * 0.4;
      if (mist) {
        const y = by + H * (0.5 + 0.5 * rnd());
        emit(M, x, y, z, -nx * (1 + 2 * rnd()), 0.6 + 1.4 * rnd(), -nz * (1 + 2 * rnd()), 2.2 + 1.6 * rnd(), P_MIST, (2.2 + 2.5 * rnd()) * hs, 1.8, by, Hm, -nx, -nz);
      } else {
        const vy = Math.sqrt(2 * G * Math.max(0.5, H)) * (0.55 + 0.5 * rnd());
        const vb = 0.6 + 2.2 * rnd(), vl = (rnd() - 0.5) * 2.5;
        const y = by + Math.min(Hb, 1.5) * rnd();
        const life = landT(y, vy, KGRAV[P_SPLASH], by + 0.2, FOAM_LIFE);
        emit(F, x, y, z, -nx * vb + tx * vl, vy, -nz * vb + tz * vl, life, P_SPLASH, (0.7 + 1.1 * rnd()) * hs, 1.0, by, Hm, -nx, -nz);
      }
      return;
    }
    if (kind === K_CASCADE) {
      const tf = Math.sqrt(2 * Math.max(0.2, H) / G), vh = Math.max(1.2, adv);
      const fx = x0 + nx * vh * tf + tx * l, fz = z0 + nz * vh * tf + tz * l;
      if (mist) {
        emit(M, fx, by + 0.5 + rnd(), fz, nx * 0.8, 0.8 + 1.2 * rnd(), nz * 0.8, 2.0 + 1.5 * rnd(), P_MIST, (2.0 + 2.5 * rnd()) * hs, 2.0, by, Hm, nx, nz);
      } else if (k < 0.8) {
        // the foot: the sheet punching into the water below
        const vy = (1.2 + 2.8 * rnd()) * Math.sqrt(Hm / 2);
        const life = landT(by + 0.2, vy, KGRAV[P_CLUMP], by, FOAM_LIFE);
        emit(F, fx, by + 0.2, fz, nx * vh * 0.5 + tx * (rnd() - 0.5) * 1.5, vy, nz * vh * 0.5 + tz * (rnd() - 0.5) * 1.5, life, P_CLUMP, (0.8 + 1.2 * rnd()) * hs, 0.9, by, Hm, nx, nz);
      } else {
        // clots off the lip
        const x = x0 + tx * l, z = z0 + tz * l, y = by + H;
        const life = landT(y, 0.5, KGRAV[P_SPRAY], by, FOAM_LIFE);
        emit(F, x, y, z, nx * (vh + 1.5 * rnd()), 0.3 + 1.2 * rnd(), nz * (vh + 1.5 * rnd()), life, P_SPRAY, 0.35 + 0.5 * rnd(), 0.6, by, Hm, nx, nz);
      }
      return;
    }
    if (kind === K_RAPID) {
      // white water tumbling down a steep run of surface (the sea pouring
      // over the shore, the backwash down a bank): low, fast, broken
      const x = x0 + tx * l + nx * (rnd() - 0.5) * width, z = z0 + tz * l + nz * (rnd() - 0.5) * width;
      const y = by + H * (0.2 + 0.7 * rnd());
      if (mist) {
        emit(M, x, y + 0.5, z, nx * adv * 0.4, 0.6 + 1.0 * rnd(), nz * adv * 0.4, 2.0 + 1.5 * rnd(), P_MIST, (1.6 + 2.0 * rnd()) * hs, 1.8, by, Hm, nx, nz);
      } else {
        const vy = 0.8 + 2.2 * rnd();
        const life = landT(y, vy, KGRAV[P_CLUMP], by, FOAM_LIFE);
        emit(F, x, y, z, nx * adv * 0.8 + tx * (rnd() - 0.5), vy, nz * adv * 0.8 + tz * (rnd() - 0.5), life, P_CLUMP, (0.6 + 1.0 * rnd()) * hs, 0.6, by, Hm, nx, nz);
      }
      return;
    }
    // ---- THE BORE: the roller face, the crest, the lip
    const Ht = Math.max(Hb, H);
    if (mist) {
      // mist off the crest, blown back over the water behind
      const fc = -0.35 * Ht + (rnd() - 0.6) * 1.5;
      const x = x0 + nx * fc + tx * l, z = z0 + nz * fc + tz * l, y = by + Ht * (0.85 + 0.3 * rnd());
      const back = 1.2 + 2.5 * rnd();
      emit(M, x, y, z, nx * (adv * 0.65 - back), 0.7 + 1.6 * rnd(), nz * (adv * 0.65 - back), 2.4 + 2.2 * rnd(), P_MIST, (2.0 + 2.6 * rnd()) * hs, 2.2, by, Ht, nx, nz);
      return;
    }
    const fwd = adv * (0.82 + 0.25 * rnd());
    if (k < 0.78) {
      // a lump of the roller: off the face (the wall's own profile, a little
      // proud of it), forward at the front's own speed and up, falling back on
      const s = rnd();
      const a = s * Math.PI * 0.85;
      const f = -0.35 * Ht * (1 - s) + 0.32 * Ht * Math.sin(a) * (1 - 0.25 * s) + 0.35;
      const yf = by + Ht * (0.5 + 0.5 * Math.cos(a));
      const x = x0 + nx * f + tx * l, z = z0 + nz * f + tz * l;
      const vy = (1.2 + 3.6 * rnd()) * (0.55 + 0.45 * hs) * (1.05 - 0.5 * s);
      const life = landT(yf, vy, KGRAV[P_CLUMP], by + 0.15, FOAM_LIFE);
      const lat = (rnd() - 0.5) * 1.6;
      emit(F, x, yf, z, nx * fwd + tx * lat, vy, nz * fwd + tz * lat, life, P_CLUMP, (0.7 + 1.1 * rnd()) * hs, 0.5, by, Ht, nx, nz);
    } else {
      // clots torn off the lip, thrown ahead of the wall
      const fc = -0.2 * Ht;
      const x = x0 + nx * fc + tx * l, z = z0 + nz * fc + tz * l, y = by + Ht * (0.92 + 0.1 * rnd());
      const vy = 2.0 + 4.0 * rnd();
      const life = landT(y, vy, KGRAV[P_SPRAY], by, FOAM_LIFE);
      emit(F, x, y, z, nx * (adv + 1.5 + 2.5 * rnd()), vy, nz * (adv + 1.5 + 2.5 * rnd()), life, P_SPRAY, (0.3 + 0.55 * rnd()) * Math.sqrt(hs), 0.8, by, Ht, nx, nz);
    }
  }
  function spawnStep(dt) {
    if (!S.foam || S.cumTot <= 0 || !(dt > 0)) return;
    // each ring turns over no faster than its longest life; a short front
    // gets a share in proportion to its size, never the whole budget
    const F = S.foam, M = S.mist;
    F.acc += Math.min(F.cap / FOAM_LIFE, S.cumTot * 5.5) * dt;
    M.acc += Math.min(M.cap / MIST_LIFE, S.cumTot * 1.2) * dt;
    const nf = Math.min(Math.floor(F.acc), F.cap >> 2), nm = Math.min(Math.floor(M.acc), M.cap >> 2);
    F.acc -= Math.floor(F.acc); M.acc -= Math.floor(M.acc);
    for (let i = 0; i < nf; i++) spawnFrom(pick(), false);
    for (let i = 0; i < nm; i++) spawnFrom(pick(), true);
  }

  function build() {
    if (S.built || typeof THREE === "undefined") return S.built;
    const B = S.budget = tierBudget();
    S.light = lightUniforms();
    buildWall(B.walls, S.light);
    S.partMat = partMaterial(S.light);
    S.foam = buildPool(Math.round(B.parts * 0.72), S.partMat, "tsunami-whitewater-foam", 7, FOAM_LIFE);
    S.mist = buildPool(B.parts - Math.round(B.parts * 0.72), S.partMat, "tsunami-whitewater-mist", 8, MIST_LIFE);
    S.built = true;
    return true;
  }

  function syncLight() {
    const L = S.light, sun = CBZ.sun, hemi = CBZ.hemi;
    if (sun && sun.matrixWorld) {
      const sm = sun.matrixWorld.elements;
      const tg = sun.target && sun.target.matrixWorld ? sun.target.matrixWorld.elements : null;
      const dx = sm[12] - (tg ? tg[12] : 0), dy = sm[13] - (tg ? tg[13] : 0), dz = sm[14] - (tg ? tg[14] : 0);
      const len = Math.hypot(dx, dy, dz) || 1;
      L.uSunDir.value.set(dx / len, dy / len, dz / len);
      const si = sun.intensity;
      L.uSunCol.value.setRGB(sun.color.r * si, sun.color.g * si, sun.color.b * si);
    }
    if (hemi) {
      const hi = hemi.intensity;
      L.uSkyCol.value.setRGB(hemi.color.r * hi, hemi.color.g * hi, hemi.color.b * hi);
      L.uGndCol.value.setRGB(hemi.groundColor.r * hi, hemi.groundColor.g * hi, hemi.groundColor.b * hi);
    }
  }

  function resetBook() { book.fronts = book.cascades = book.overWater = book.rapids = book.impacts = book.sea = 0; }
  // the field's records only when the field has stepped (30 Hz); the sea
  // front's every frame, after them
  function rescan(F, fieldToo) {
    if (fieldToo) {
      nRec = 0; resetBook();
      if (F) scanField(F);
      S.nField = nRec;
    } else { nRec = S.nField; book.sea = 0; }
    scanSea(S.seaFront, F);
    buildCum();
    fillWalls();
  }

  function tick(dt) {
    if (!S.parent || !S.built) return;
    dt = Math.max(0, Math.min(0.1, dt || 0));
    S.T += dt;
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    const ft = F ? F.t : -1;
    const fieldToo = ft !== S.lastFieldT;
    if (fieldToo || S.seaFront || nRec > S.nField) { S.lastFieldT = ft; rescan(F, fieldToo); }
    const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
    // run-up water on the land is flood water whatever the sea is doing
    const tb = ev && ev.kind === "tsunami" && Number.isFinite(ev.sediment) ? Math.max(0.6, ev.sediment) : 0.85;
    S.turbid += (tb - S.turbid) * Math.min(1, dt * 2);
    spawnStep(dt);
    flushPool(S.foam); flushPool(S.mist);
    syncLight();
    S.wallMat.uniforms.uT.value = S.T; S.wallMat.uniforms.uTurb.value = S.turbid;
    S.partMat.uniforms.uT.value = S.T; S.partMat.uniforms.uTurb.value = S.turbid;
    // the white water outlives its source by its longest life
    S.foam.mesh.visible = S.T - S.foam.lastBirth < FOAM_LIFE + 0.1;
    S.mist.mesh.visible = S.T - S.mist.lastBirth < MIST_LIFE + 0.1;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(28.4, tick);

  function attach(parent) {
    if (!parent || !build()) return false;
    S.parent = parent;
    for (const m of [S.wall, S.foam.mesh, S.mist.mesh]) {
      if (m.parent !== parent) parent.add(m);
      m.position.set(0, 0, 0);
    }
    return true;
  }
  function detach() {
    for (const m of [S.wall, S.foam && S.foam.mesh, S.mist && S.mist.mesh]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      m.visible = false;
    }
    S.parent = null; S.seaFront = null; nRec = 0; S.nField = 0; S.cumTot = 0;
    if (S.wallGeo) S.wallGeo.instanceCount = 0;
  }

  /* THE CRASH: the standing wave comes down along its whole front at once.
     {x, z} the face's toe at its centre, {dx, dz} travel, width, y = the
     water it lands in, H = how tall it stood. */
  function burst(spec) {
    if (!spec || !S.built || !S.parent) return 0;
    const dx = spec.dx, dz = spec.dz, tx = -dz, tz = dx;
    const W = spec.width || 200, H = Math.max(2, spec.H || 10), y0 = Number.isFinite(spec.y) ? spec.y : 0;
    const hs = Math.max(1, Math.min(3.2, Math.sqrt(H / 3)));
    const nf = Math.min(S.foam.cap >> 1, Math.round(W * 1.2)), nm = Math.min(S.mist.cap >> 1, Math.round(W * 0.45));
    for (let i = 0; i < nf + nm; i++) {
      const l = (rnd() - 0.5) * W * 0.95;
      // the lip falls forward and down; what it throws goes up and on
      const yy = y0 + H * (0.25 + 0.7 * rnd());
      const f = -0.1 * H + rnd() * 0.3 * H;
      const x = spec.x + dx * f + tx * l, z = spec.z + dz * f + tz * l;
      if (i < nf) {
        const vy = 2 + 6 * rnd(), fw = 4 + 8 * rnd();
        const life = landT(yy, vy, KGRAV[P_CLUMP], y0, FOAM_LIFE);
        emit(S.foam, x, yy, z, dx * fw, vy, dz * fw, life, P_CLUMP, (1.2 + 2.0 * rnd()) * hs, 0.9, y0, H, dx, dz);
      } else {
        const fw = 2 + 5 * rnd();
        emit(S.mist, x, yy + H * 0.2, z, dx * fw, 1.5 + 3 * rnd(), dz * fw, 3 + 1.5 * rnd(), P_MIST, (3.5 + 4 * rnd()) * hs, 2.4, y0, H, dx, dz);
      }
    }
    flushPool(S.foam); flushPool(S.mist);
    S.foam.mesh.visible = true; S.mist.mesh.visible = true;
    return nf + nm;
  }

  CBZ.tsuWhite = {
    attach: attach, detach: detach,
    seaFront: function (spec) { S.seaFront = spec && Number.isFinite(spec.s) ? spec : null; },
    burst: burst,
    stats: function () {
      return {
        records: nRec, fronts: book.fronts, overWater: book.overWater, cascades: book.cascades, rapids: book.rapids,
        impacts: book.impacts, seaFront: book.sea,
        walls: S.wallN, wallCap: S.wallCap,
        foam: S.foam ? S.foam.alive : 0, mist: S.mist ? S.mist.alive : 0,
        particleCap: S.foam ? S.foam.cap + S.mist.cap : 0,
        spawned: S.spawned, attached: !!S.parent,
      };
    },
    // the scan alone, for headless checks: (field, seaFront?) -> records
    _scan: function (F, sea) {
      nRec = 0; resetBook();
      if (F) scanField(F);
      scanSea(sea || null, F);
      return { n: nRec, recs: recs, RF: RF, book: Object.assign({}, book) };
    },
  };
})();
