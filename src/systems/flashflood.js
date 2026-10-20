/* ============================================================
   systems/flashflood.js — A FLASH FLOOD THAT IS ROUTED, NOT SCRIPTED
   (2026-10-14 rewrite)

   WHAT WAS WRONG. The old flood was a straight line. CBZ.groundWaterFrontSet
   swept a plane across the island at a fixed 9.5 m/s, on a bearing picked by
   "the lowest of 16 ring samples", and the depth behind it was one number
   minus how high you stood above a 54 m drainage ring. It crossed hills and
   valleys at the same speed, never pooled anywhere it was not told to, never
   rose against anything, and the water you saw was paint on the ground
   (the weather coat) with spray thrown off the line. Cars floated at a
   threshold and were then FLUNG like a tsunami had hit them.

   WHAT IT IS NOW. A real 2-D flood-routing solve over the island's own
   terrain: the local-inertial shallow-water scheme (Bates, Horritt & Hervouet
   2010; de Almeida et al. 2012 — the LISFLOOD-FP model hydrologists use for
   exactly this) on a grid of 2.5 m+ cells:

       q <- (q - g h_f dt dEta/dx) / (1 + g dt n^2 |q| / h_f^(7/3))
       h <- h + dt (sum of q in - q out) / dx + sources

   So nothing about where the water goes is authored. Rain falls hardest on
   the high ground upstream (a storm cell, orographic), the channels collect
   it, and a front runs DOWN the drainage at the speed Manning friction gives
   that depth on that slope: fast and deep in a channel, slow and shallow on
   the floodplain, ponding in every dip and underpass, banking up against
   every wall. Buildings are porous: water seeps through doors and gaps, so a
   ground floor fills behind the street and holds its water after the street
   drains. Bridges constrict the channel and the debris the flood carries
   (logs, boards, cars) jams against them, the water backs up behind the jam,
   the load climbs, and the bridge fails — releasing the pond behind it as a
   second surge. The sewer takes the street water until it surcharges, and
   then the manhole lids blow off and the drains spout. When the storm is
   spent the water recedes and leaves a mud film and a high-water line on
   every wall it stood against.

   ONE WATER TRUTH. The solve is the ground-water field: it is installed into
   city/waterfield.js through CBZ.groundWaterFieldSet, so groundWaterAt /
   groundWaterFlowAt / shoreAt — the queries swimming, drowning, the
   knock-down physics, buoyancy, gore and the bots already ask — answer from
   it. The surface you SEE is drawn from the very same arrays, with the one
   water material (world/water_spec.js CBZ.waterSeaMaterial, kind
   "external": caller-built geometry, the sea's shading) plus a mud/foam tail.
   It is not a private plane: there is no other answer it could disagree with.

   CARS are bodies, priced: buoyancy against weight (a car floats at 0.6 m),
   hydrodynamic drag against tyre friction (0.3 m of fast water slides one),
   engines stall at 0.3 m, floating cars turn with the current, ship water and
   sink, and come to rest where the water leaves them, still solid.

   PHONE. The solve only touches the wet bounding box; one draw call for the
   surface, one per debris kind, one for the spray, one for lids, two for the
   high-water marks. Grid build is sliced across the warning's frames.

   Driven by the flashflood def in systems/disasters.js (start in warn, tick
   every frame, clear at the end). Inert unless started.
   Ratchet: CBZ.flashflood.audit(). Lab: src/lab/kits/flood-valley.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || null;

  // ---- physics constants -------------------------------------------------
  const G = 9.81, RHO = 1000;
  const N_MAX = 144;            // cells per side, cap
  const CELL_MIN = 2.5;         // metres, floor on the cell size
  const H_DRY = 0.003;          // m: below this a face carries nothing
  const H_SHOW = 0.012;         // m: below this a cell is dry to the queries
  // m: below this a cell DRAWS dry: a rain sheet a centimetre or two deep is
  // the wet-ground look (weather.js), not a water surface — drawing it
  // z-fights the ground into contour bands
  const H_DRAW = 0.06;
  const FR_MAX = 1.6;           // Froude cap (flash floods run supercritical)
  const THETA = 0.8;            // flux diffusion weight (de Almeida 2012)
  const MAN_ROAD = 0.016, MAN_GRASS = 0.035, MAN_ROOM = 0.06, MAN_CHANNEL = 0.03;
  const INFIL_GRASS = 0.0008;   // m/s: the soil is saturated by the storm (time-compressed)
  const WALL_W = 0.07, DOOR_W = 0.32;   // wall face porosity: gaps, doors
  // the car
  const CAR_M = 1400, CAR_CLEAR = 0.15, CAR_FLOAT_D = 0.6, CAR_CD = 1.1;
  const CAR_MU_S = 0.45, CAR_MU_K = 0.35, CAR_STALL_D = 0.3;
  // spray / debris budgets (one draw call each)
  const N_SPRAY = 640, N_FLOT = 27, N_LOGS = 20;

  let F = null;                  // the live flood (grid + bodies + render)
  let silt = null;               // the surface left behind after clear({keepSilt})
  // a PRIVATE lcg for FX only (spray kicks, debris spin) so this file never
  // perturbs the seeded hazard stream; placement uses hashes, not this.
  let rngS = 0x9e3779b9;
  function rnd() { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; }
  function hash01(i, salt) {
    let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca77); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ======================================================================
     THE GRID
     ====================================================================== */
  function makeGrid(W) {
    // a square grid centred on the bounds
    const span = Math.max(W.x1 - W.x0, W.z1 - W.z0);
    const c = Math.max(CELL_MIN, W.cell || 0, span / N_MAX);
    const n = Math.min(N_MAX, Math.ceil(span / c));
    const x0w = (W.x0 + W.x1) / 2 - n * c / 2, z0w = (W.z0 + W.z1) / 2 - n * c / 2;
    const N2 = n * n;
    return {
      n: n, c: c, x0: x0w, z0: z0w,
      zb: new Float32Array(N2), h: new Float32Array(N2),
      man: new Float32Array(N2),           // Manning n^2
      inf: new Float32Array(N2),           // infiltration m/s
      rain: new Float32Array(N2),          // storm weight (m/s at intensity 1)
      qx: new Float32Array((n + 1) * n), qz: new Float32Array(n * (n + 1)),
      wx: new Float32Array((n + 1) * n), wz: new Float32Array(n * (n + 1)),
      wx0: new Float32Array((n + 1) * n), wz0: new Float32Array(n * (n + 1)),
      out: new Float32Array(N2), scl: new Float32Array(N2), rowOld: new Float32Array(n),
      ux: new Float32Array(N2), uz: new Float32Array(N2),
      hmax: new Float32Array(N2), etaMax: new Float32Array(N2),
      wetT: new Float32Array(N2),          // seconds this cell has been wet
      drawH: new Float32Array(N2),         // depth a cell needs before it draws as water
      siltK: new Float32Array(N2),         // 0 none, (0..1] mud film: its drying clock (1 = long dry)
      siltTh: new Float32Array(N2),        // 0..1 how much settled (deep, slow, standing water leaves most)
      wetSum: new Float32Array(N2),        // seconds this cell has been wet, ever
      combX: new Float32Array(N2), combZ: new Float32Array(N2),   // the last of the flow over it
      ocean: new Uint8Array(N2),
      room: new Int16Array(N2),            // building index + 1 (ground floor), 0 outside
      bridgeOf: new Int16Array(N2),        // bridge index + 1
      wall: new Float32Array(N2),          // signed distance to the nearest wall (+ outside)
      built: 0,                            // cells whose bed has been sampled
      bb: { i0: n, i1: -1, j0: n, j1: -1 },
    };
  }
  function cellX(g, i) { return g.x0 + (i + 0.5) * g.c; }
  function cellZ(g, j) { return g.z0 + (j + 0.5) * g.c; }

  // the bed, sampled a slice at a time (a phone never sees a 20k-call frame)
  function buildSlice(W, g, budget) {
    const n = g.n, N2 = n * n;
    const end = Math.min(N2, g.built + budget);
    for (let k = g.built; k < end; k++) {
      const i = k % n, j = (k / n) | 0;
      const x = cellX(g, i), z = cellZ(g, j);
      let y = +W.ground(x, z);
      if (!Number.isFinite(y)) y = W.seaY - 5;
      g.zb[k] = y;
      const road = W.onRoad ? !!W.onRoad(x, z) : false;
      g.man[k] = (road ? MAN_ROAD : MAN_GRASS);
      g.inf[k] = road ? 0 : INFIL_GRASS;
    }
    g.built = end;
    return end >= N2;
  }

  // everything that needs the whole bed: sea, rivers, rooms, bridges, rain
  function finishGrid(W, g, opts) {
    const n = g.n, c = g.c, N2 = n * n;
    // n^2 for the solve
    for (let k = 0; k < N2; k++) g.man[k] = g.man[k] * g.man[k];
    // THE SEA: below sea level AND connected to the domain edge (an inland
    // hollow below datum is a pond the flood fills, not ocean)
    const sea = W.seaY;
    const stack = [];
    for (let i = 0; i < n; i++) { stack.push(i, (n - 1) * n + i, i * n, i * n + n - 1); }
    while (stack.length) {
      const k = stack.pop();
      if (g.ocean[k] || !(g.zb[k] < sea + 0.02)) continue;
      g.ocean[k] = 1;
      const i = k % n, j = (k / n) | 0;
      if (i > 0) stack.push(k - 1); if (i < n - 1) stack.push(k + 1);
      if (j > 0) stack.push(k - n); if (j < n - 1) stack.push(k + n);
    }
    // RIVER CHANNELS: smoother bed (a channel is the fastest water there is)
    const rivers = W.rivers || [];
    for (const r of rivers) forEachCellNearLine(g, r.pts, (r.width || 8) * 0.5 + c * 0.5, function (k) { if (!g.ocean[k]) { g.man[k] = MAN_CHANNEL * MAN_CHANNEL; g.inf[k] = 0; } });
    // face widths default open; closed at the domain edge
    g.wx0.fill(1); g.wz0.fill(1);
    for (let j = 0; j < n; j++) { g.wx0[j * (n + 1)] = 0; g.wx0[j * (n + 1) + n] = 0; }
    for (let i = 0; i < n; i++) { g.wz0[i] = 0; g.wz0[n * n + i] = 0; }
    // BUILDINGS: the ground floor is a room. Its bed is the slab; its walls
    // are porous faces (gaps, vents) with the door side far more open.
    g.wall.fill(1e3);
    const B = W.buildings || [];
    for (let b = 0; b < B.length; b++) {
      const bd = B[b];
      const hx = bd.w / 2, hz = bd.d / 2;
      const i0 = Math.max(0, Math.floor((bd.x - hx - g.x0) / c) - 1), i1 = Math.min(n - 1, Math.floor((bd.x + hx - g.x0) / c) + 1);
      const j0 = Math.max(0, Math.floor((bd.z - hz - g.z0) / c) - 1), j1 = Math.min(n - 1, Math.floor((bd.z + hz - g.z0) / c) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * n + i, x = cellX(g, i), z = cellZ(g, j);
        // signed distance to this footprint's outline (negative inside)
        const dx = Math.abs(x - bd.x) - hx, dz = Math.abs(z - bd.z) - hz;
        const sd = dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
        if (sd < g.wall[k]) g.wall[k] = sd;
        if (sd < 0) {
          g.room[k] = b + 1;
          if (Number.isFinite(bd.floorY)) g.zb[k] = Math.max(g.zb[k], bd.floorY);
          g.man[k] = MAN_ROOM * MAN_ROOM; g.inf[k] = 0;
        }
      }
    }
    // faces between a room and anything else are walls
    for (let j = 0; j < n; j++) for (let i = 1; i < n; i++) {
      const a = j * n + i - 1, b = a + 1;
      if (g.room[a] !== g.room[b]) {
        const r = g.room[a] || g.room[b], bd = B[r - 1];
        g.wx0[j * (n + 1) + i] = bd && (bd.door === "-x" || bd.door === "+x") ? DOOR_W : WALL_W;
      }
    }
    for (let j = 1; j < n; j++) for (let i = 0; i < n; i++) {
      const a = (j - 1) * n + i, b = a + n;
      if (g.room[a] !== g.room[b]) {
        const r = g.room[a] || g.room[b], bd = B[r - 1];
        // the door is on -z unless the building says otherwise
        const door = !bd || !bd.door || bd.door === "-z" || bd.door === "+z";
        g.wz0[j * n + i] = door ? DOOR_W : WALL_W;
      }
    }
    // BRIDGES: the cells under a deck
    const BR = W.bridges || [];
    for (let b = 0; b < BR.length; b++) {
      const br = BR[b];
      const r = Math.hypot(br.len, br.width) * 0.5 + c;
      const i0 = Math.max(0, Math.floor((br.x - r - g.x0) / c)), i1 = Math.min(n - 1, Math.floor((br.x + r - g.x0) / c));
      const j0 = Math.max(0, Math.floor((br.z - r - g.z0) / c)), j1 = Math.min(n - 1, Math.floor((br.z + r - g.z0) / c));
      br.cells = [];
      let bedSum = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = cellX(g, i) - br.x, z = cellZ(g, j) - br.z;
        const al = x * br.ax + z * br.az, ac = -x * br.az + z * br.ax;
        if (Math.abs(al) <= br.len / 2 && Math.abs(ac) <= Math.max(br.width / 2, c * 0.55)) {
          const k = j * n + i;
          g.bridgeOf[k] = b + 1; br.cells.push(k); bedSum += g.zb[k];
        }
      }
      br.bed = br.cells.length ? bedSum / br.cells.length : br.soffitY - 3;
      br.open = Math.max(1, br.len * Math.max(0.5, br.soffitY - br.bed));
    }
    g.wx.set(g.wx0); g.wz.set(g.wz0);
    // a sheet on a slope is wet ground, not a water surface: the steeper the
    // ground, the deeper the water has to be before it draws
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.drawH[j * n + i] = H_DRAW + 0.6 * Math.min(0.5, steepAt(g, i, j));

    // ---- THE STORM: where the rain falls and how hard ----------------------
    // the cell sits over the high ground (orographic lift), a fringe of
    // ordinary heavy rain everywhere else; normalised to the volume budget.
    const st = W.storm || coarseStorm(W);
    let wsum = 0, land = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (g.ocean[k]) { g.rain[k] = 0; continue; }
      land++;
      // a roof sheds to its gutters, which is the sewer's roof term
      if (g.room[k]) { g.rain[k] = 0; continue; }
      const d = Math.hypot(cellX(g, i) - st.x, cellZ(g, j) - st.z) / st.r;
      const oro = 1 + Math.max(0, g.zb[k] - sea) * 0.035;
      const w = (0.04 + Math.exp(-d * d)) * oro;
      g.rain[k] = w; wsum += w;
    }
    const landArea = land * c * c;
    const volume = opts.volume > 0 ? opts.volume : landArea * 0.30 * (opts.volumeScale > 0 ? opts.volumeScale : 1);
    const stormSecs = Math.max(1, opts.stormSecs || 10);
    const srcs = W.sources || [];
    const inflowShare = srcs.length ? clamp(opts.inflowShare != null ? opts.inflowShare : 0.6, 0, 1) : 0;
    const rate = wsum > 0 ? volume * (1 - inflowShare) / (wsum * c * c * stormSecs) : 0;
    for (let k = 0; k < N2; k++) g.rain[k] *= rate;
    const sources = [];
    let shareSum = 0;
    for (const s of srcs) shareSum += s.share || 1;
    for (const s of srcs) {
      // the river enters across its whole width, not down one drain: spread
      // the inflow over the land cells within the channel's half-width
      const rad = Math.max(c * 1.5, (s.width || 8) * 0.6);
      const ks = [];
      const i0 = Math.floor((s.x - rad - g.x0) / c), i1 = Math.floor((s.x + rad - g.x0) / c);
      const j0 = Math.floor((s.z - rad - g.z0) / c), j1 = Math.floor((s.z + rad - g.z0) / c);
      for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
        const k = j * n + i;
        if (!g.ocean[k] && !g.room[k] && Math.hypot(cellX(g, i) - s.x, cellZ(g, j) - s.z) <= rad) ks.push(k);
      }
      if (!ks.length) ks.push(clamp(Math.floor((s.z - g.z0) / c), 0, n - 1) * n + clamp(Math.floor((s.x - g.x0) / c), 0, n - 1));
      sources.push({ ks: ks, x: s.x, z: s.z, q: volume * inflowShare * ((s.share || 1) / (shareSum || 1)) / stormSecs });
    }
    g.sources = sources;
    g.storm = st;
    g.volume = volume;
    g.landArea = landArea;
  }

  /* THE STORM CELL sits over the high ground (orographic lift): the
     centroid of the top 15% of the land by height, from a coarse 24x24 look
     at the terrain, so it is known the moment the warning starts (the wind
     blows off it) without waiting for the full grid. */
  function coarseStorm(W) {
    if (W.storm) return W.storm;
    const N = 24, sx0 = W.x0, sz0 = W.z0, dx = (W.x1 - W.x0) / N, dz = (W.z1 - W.z0) / N;
    const pts = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = sx0 + (i + 0.5) * dx, z = sz0 + (j + 0.5) * dz, y = +W.ground(x, z);
      if (Number.isFinite(y) && y > W.seaY + 0.2) pts.push({ x: x, z: z, y: y });
    }
    const span = Math.max(W.x1 - W.x0, W.z1 - W.z0);
    if (!pts.length) return (W.storm = { x: (W.x0 + W.x1) / 2, z: (W.z0 + W.z1) / 2, r: span * 0.3 });
    const ys = pts.map(function (p) { return p.y; }).sort(function (a, b) { return a - b; });
    const cut = ys[Math.floor(ys.length * 0.85)];
    let ax = 0, az = 0, aw = 0;
    for (const p of pts) if (p.y >= cut) { const w = p.y - cut + 0.5; ax += p.x * w; az += p.z * w; aw += w; }
    return (W.storm = { x: ax / aw, z: az / aw, r: span * 0.28 });
  }

  function forEachCellNearLine(g, pts, rad, fn) {
    if (!pts || pts.length < 2) return;
    const n = g.n, c = g.c;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const minX = Math.min(a.x, b.x) - rad, maxX = Math.max(a.x, b.x) + rad;
      const minZ = Math.min(a.z, b.z) - rad, maxZ = Math.max(a.z, b.z) + rad;
      const i0 = Math.max(0, Math.floor((minX - g.x0) / c)), i1 = Math.min(n - 1, Math.floor((maxX - g.x0) / c));
      const j0 = Math.max(0, Math.floor((minZ - g.z0) / c)), j1 = Math.min(n - 1, Math.floor((maxZ - g.z0) / c));
      const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = cellX(g, i), z = cellZ(g, j);
        const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / L2, 0, 1);
        if (Math.hypot(x - a.x - vx * t, z - a.z - vz * t) <= rad) fn(j * n + i);
      }
    }
  }

  /* ======================================================================
     THE SOLVE (local inertial shallow water)
     ====================================================================== */
  function hydro(t) {
    // storm intensity 0..1 on the flood's own clock (warning first)
    const Wd = F.warnSecs, A = F.activeSecs;
    if (t < Wd) return 0.25 + 0.35 * (t / Wd);
    const u = (t - Wd) / A;
    if (u < 0.10) return 0.6 + 0.4 * (u / 0.10);
    if (u < 0.28) return 1;
    if (u < 0.45) return 1 - (u - 0.28) / 0.17;
    return 0;
  }
  function drainBoost(t) {
    // the recession: the storm is spent, the soil and the drains take the
    // standing water. Gentle while the event runs (a front still on its way
    // downstream keeps going); after the horn the AFTERMATH (see clear)
    // drains what is left over the calm. It was min(0.45, 0.06 + 0.09 t)
    // m/s: half a metre of street water gone in three seconds, which is the
    // "dries up way too fast" the owner saw. Now a slow seep takes the thin
    // sheets first and drainProp() brings the deep hollows down last.
    if (F.ending) return Math.min(0.02, 0.003 + F.after * 0.0012);
    const u = (t - F.warnSecs) / F.activeSecs;
    return u > 0.85 ? 0.12 * (u - 0.85) / 0.15 : 0;
  }

  /* THE LEVEL DROPS, IT DOES NOT FADE. Over the last DRAIN_LAST seconds of
     the aftermath every pond also loses a share of its own depth (h * w /
     time left): the deep low cells hold water longest and still reach the
     mud exactly at AFTER_SECS, so nothing is left to snap away at the end. */
  const DRAIN_LAST = 8;
  function drainProp(dt) {
    if (!F.ending) return 0;
    const rem = AFTER_SECS - F.after;
    if (rem >= DRAIN_LAST) return 0;
    const r = Math.max(0, rem), w = (1 - r / DRAIN_LAST) * (1 - r / DRAIN_LAST);
    return Math.min(1, w * dt / Math.max(dt, r));
  }

  function stepGrid(dt) {
    const g = F.grid, n = g.n, c = g.c, n1 = n + 1;
    const zb = g.zb, h = g.h, qx = g.qx, qz = g.qz, wx = g.wx, wz = g.wz, man = g.man;
    const out = g.out, scl = g.scl;
    const I = hydro(F.t), Iin = hydro(Math.max(0, F.t - F.lag));
    const boost = drainBoost(F.t), prop = drainProp(dt);
    // ---- sources (they also widen the active box) ----
    if (I > 0) {
      const rain = g.rain;
      // rain lands on the whole island; we only ADD it where it is falling
      // hard enough to matter (cheap: the rain array is zero at sea)
      for (let k = 0, N2 = n * n; k < N2; k++) {
        const r = rain[k];
        if (r > 0) h[k] += r * I * dt;
      }
      F.vIn += F.rainTotal * I * dt;
      g.bb.i0 = 0; g.bb.i1 = n - 1; g.bb.j0 = 0; g.bb.j1 = n - 1;
    }
    for (let s = 0; s < g.sources.length; s++) {
      const S = g.sources[s];
      if (Iin > 0) {
        const dh = S.q * Iin * dt / (c * c * S.ks.length);
        for (let m = 0; m < S.ks.length; m++) { h[S.ks[m]] += dh; grow(g, S.ks[m]); }
        F.vIn += S.q * Iin * dt;
      }
    }
    sewerStep(dt, I);
    // ---- the active box, one cell of margin ----
    const bb = g.bb;
    if (bb.i1 < bb.i0) return;
    // the window: the wet box plus one dry ring. Its outer faces sit between
    // two dry cells and carry nothing, so nothing outside needs touching.
    const i0 = Math.max(0, bb.i0 - 1), i1 = Math.min(n - 1, bb.i1 + 1);
    const j0 = Math.max(0, bb.j0 - 1), j1 = Math.min(n - 1, bb.j1 + 1);
    const gdt = G * dt;
    // ---- face fluxes ----
    // de Almeida et al. (2012): the previous flux is blended with its two
    // neighbours along the flow axis (theta = 0.8), which damps the
    // checkerboard the plain scheme rings with on steep, shallow ground
    const TH = THETA, TH2 = (1 - THETA) * 0.5;
    for (let j = j0; j <= j1; j++) {
      const row = j * n, frow = j * n1;
      const iA = Math.max(1, i0), iB = Math.min(n - 1, i1 + 1);
      let oL = qx[frow + iA - 1];
      for (let i = iA; i <= iB; i++) {
        const f = frow + i;
        const w = wx[f];
        const oC = qx[f];
        const a = row + i - 1, b = a + 1;
        const za = zb[a], zbb = zb[b];
        const ea = za + h[a], eb = zbb + h[b];
        const hf = (ea > eb ? ea : eb) - (za > zbb ? za : zbb);
        if (hf <= H_DRY || w <= 0) { qx[f] = 0; oL = oC; continue; }
        let q = TH * oC + TH2 * (oL + (i < n ? qx[f + 1] : 0));
        oL = oC;
        const nn = 0.5 * (man[a] + man[b]);
        q = (q - gdt * hf * (eb - ea) / c) / (1 + gdt * nn * (q < 0 ? -q : q) / (hf * hf * Math.cbrt(hf)));
        const qm = FR_MAX * hf * Math.sqrt(G * hf);
        qx[f] = q > qm ? qm : q < -qm ? -qm : q;
      }
    }
    const jA = Math.max(1, j0), jB = Math.min(n - 1, j1 + 1);
    const oD = g.rowOld;
    for (let i = i0; i <= i1; i++) oD[i] = qz[(jA - 1) * n + i];
    for (let j = jA; j <= jB; j++) {
      const frow = j * n;
      for (let i = i0; i <= i1; i++) {
        const f = frow + i;
        const w = wz[f];
        const oC = qz[f];
        const a = (j - 1) * n + i, b = a + n;
        const za = zb[a], zbb = zb[b];
        const ea = za + h[a], eb = zbb + h[b];
        const hf = (ea > eb ? ea : eb) - (za > zbb ? za : zbb);
        if (hf <= H_DRY || w <= 0) { qz[f] = 0; oD[i] = oC; continue; }
        let q = TH * oC + TH2 * (oD[i] + (j < n ? qz[f + n] : 0));
        oD[i] = oC;
        const nn = 0.5 * (man[a] + man[b]);
        q = (q - gdt * hf * (eb - ea) / c) / (1 + gdt * nn * (q < 0 ? -q : q) / (hf * hf * Math.cbrt(hf)));
        const qm = FR_MAX * hf * Math.sqrt(G * hf);
        qz[f] = q > qm ? qm : q < -qm ? -qm : q;
      }
    }
    // ---- positivity: no cell may give more than it holds ----
    const ji0 = j0, ji1 = j1, ii0 = i0, ii1 = i1;
    for (let j = ji0; j <= ji1; j++) for (let i = ii0; i <= ii1; i++) out[j * n + i] = 0;
    for (let j = j0; j <= j1; j++) for (let i = Math.max(1, i0); i <= Math.min(n - 1, i1 + 1); i++) {
      const f = j * n1 + i, q = qx[f] * wx[f];
      if (q > 0) out[j * n + i - 1] += q; else if (q < 0) out[j * n + i] -= q;
    }
    for (let j = Math.max(1, j0); j <= Math.min(n - 1, j1 + 1); j++) for (let i = i0; i <= i1; i++) {
      const f = j * n + i, q = qz[f] * wz[f];
      if (q > 0) out[(j - 1) * n + i] += q; else if (q < 0) out[j * n + i] -= q;
    }
    for (let j = ji0; j <= ji1; j++) for (let i = ii0; i <= ii1; i++) {
      const k = j * n + i, o = out[k] * dt;
      scl[k] = o > h[k] * c && o > 0 ? (h[k] * c) / o : 1;
    }
    for (let j = j0; j <= j1; j++) for (let i = Math.max(1, i0); i <= Math.min(n - 1, i1 + 1); i++) {
      const f = j * n1 + i, q = qx[f];
      if (q > 0) { const s = scl[j * n + i - 1]; if (s < 1) qx[f] = q * s; }
      else if (q < 0) { const s = scl[j * n + i]; if (s < 1) qx[f] = q * s; }
    }
    for (let j = Math.max(1, j0); j <= Math.min(n - 1, j1 + 1); j++) for (let i = i0; i <= i1; i++) {
      const f = j * n + i, q = qz[f];
      if (q > 0) { const s = scl[(j - 1) * n + i]; if (s < 1) qz[f] = q * s; }
      else if (q < 0) { const s = scl[j * n + i]; if (s < 1) qz[f] = q * s; }
    }
    // ---- depths, velocities, the next active box ----
    const k0 = dt / c, sea = F.seaY;
    let ni0 = n, ni1 = -1, nj0 = n, nj1 = -1, hm = 0;
    const ux = g.ux, uz = g.uz, inf = g.inf, ocean = g.ocean;
    for (let j = ji0; j <= ji1; j++) {
      for (let i = ii0; i <= ii1; i++) {
        const k = j * n + i;
        const fl = j * n1 + i, fr = fl + 1, fd = j * n + i, fu = fd + n;
        const qxl = qx[fl] * wx[fl], qxr = qx[fr] * wx[fr];
        const qzd = qz[fd] * wz[fd], qzu = qz[fu] * wz[fu];
        let hk = h[k] + k0 * (qxl - qxr + qzd - qzu);
        if (ocean[k]) {
          // the sea takes everything that reaches it
          const lev = sea - zb[k], keep = lev > 0 ? lev : 0;
          if (hk > keep) F.vSea += (hk - keep) * c * c;
          hk = keep;
        } else {
          const loss = (inf[k] + boost) * dt + hk * prop;
          if (loss > 0 && hk > 0) { const l = hk < loss ? hk : loss; hk -= l; F.vSoak += l * c * c; }
        }
        if (hk < 1e-6) hk = 0;
        h[k] = hk;
        if (hk > H_DRY && !ocean[k]) {
          const hh = hk > 0.05 ? hk : 0.05;
          let vx = 0.5 * (qx[fl] + qx[fr]) / hh, vz = 0.5 * (qz[fd] + qz[fu]) / hh;
          // a film a few millimetres deep under a fast face is not moving at
          // q/h: cap the cell's speed at its own supercritical limit
          const vm = FR_MAX * Math.sqrt(G * hh), v2 = vx * vx + vz * vz;
          if (v2 > vm * vm) { const sc = vm / Math.sqrt(v2); vx *= sc; vz *= sc; }
          ux[k] = vx; uz[k] = vz;
          if (i < ni0) ni0 = i; if (i > ni1) ni1 = i;
          if (j < nj0) nj0 = j; if (j > nj1) nj1 = j;
          if (hk > hm) hm = hk;
        } else { ux[k] = 0; uz[k] = 0; }
      }
    }
    // a source that has not started yet still owns its cell
    bb.i0 = ni0; bb.i1 = ni1; bb.j0 = nj0; bb.j1 = nj1;
    F.hLive = hm;
  }
  function grow(g, k) {
    const n = g.n, i = k % n, j = (k / n) | 0, bb = g.bb;
    if (i < bb.i0) bb.i0 = i; if (i > bb.i1) bb.i1 = i;
    if (j < bb.j0) bb.j0 = j; if (j > bb.j1) bb.j1 = j;
  }

  /* ======================================================================
     THE SEWER: inlets until it surcharges, then the lids blow
     ====================================================================== */
  function sewerStep(dt, I) {
    const S = F.sewer, g = F.grid;
    if (!S || !S.holes.length) return;
    const c2 = g.c * g.c;
    let inflow = S.roof * I;                         // roofs and gutters upstream
    if (S.V < S.cap) {
      for (const m of S.holes) {
        if (m.spout > 0) continue;
        const d = g.h[m.k];
        if (d <= 0.01) continue;
        const q = Math.min(m.popped ? 0.9 : 0.35, d * c2 / dt * 0.5);
        g.h[m.k] -= q * dt / c2;
        inflow += q;
      }
    }
    S.V += (inflow - S.outfall) * dt;
    if (S.V < 0) S.V = 0;
    if (S.V > S.cap) {
      // SURCHARGED: the pipe network is full and still being fed, so the
      // pressure goes up the shafts — the lowest lids go first
      const excess = (S.V - S.cap);
      S.V = S.cap;
      S.popCd -= dt;
      let spouting = 0;
      for (const m of S.holes) if (m.spout > 0) spouting++;
      if ((spouting === 0 || excess / dt > spouting * 0.8) && S.popCd <= 0) {
        let best = null;
        for (const m of S.holes) if (!m.popped && (!best || m.y < best.y)) best = m;
        if (best) { popLid(best); S.popCd = 0.45; spouting++; }
      }
      if (spouting) for (const m of S.holes) if (m.spout > 0) {
        g.h[m.k] += excess / spouting / c2;
        m.spout = 1.5;
        m.rate = excess / spouting / Math.max(dt, 1e-4);
        grow(g, m.k);
      }
    }
    for (const m of S.holes) if (m.spout > 0) { m.spout -= dt; if (m.spout <= 0) m.rate = 0; }
  }
  function popLid(m) {
    m.popped = true; m.popT = F.t; m.spout = 1.5;
    m.vy = 5.5 + rnd() * 3; m.vx = (rnd() - 0.5) * 2.5; m.vz = (rnd() - 0.5) * 2.5;
    m.ly = m.y + 0.03; m.lx = m.x; m.lz = m.z; m.rx = 0; m.rz = 0; m.flying = true;
    F.stats.lidsPopped++;
    event("manhole", "lid blown at " + m.x.toFixed(1) + "," + m.z.toFixed(1));
    if (CBZ.sfxAt) CBZ.sfxAt("explosion", m.x, m.z, { volume: 0.35 });
  }

  /* ======================================================================
     FIELD QUERIES (what the rest of the game asks, via waterfield.js)
     ====================================================================== */
  // wet-weighted bilinear over cell centres; dry cells do not drag the level
  function sample(x, z, out) {
    const g = F && F.grid;
    out.d = 0; out.eta = -Infinity; out.ux = 0; out.uz = 0; out.bed = 0;
    if (!g || !F.ready) return out;
    const n = g.n;
    const fx = (x - g.x0) / g.c - 0.5, fz = (z - g.z0) / g.c - 0.5;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < -1 || j < -1 || i >= n || j >= n) return out;
    const tx = fx - i, tz = fz - j;
    let we = 0, eta = 0, ux = 0, uz = 0, wb = 0, bed = 0;
    for (let b = 0; b < 4; b++) {
      const ii = i + (b & 1), jj = j + (b >> 1);
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const w = ((b & 1) ? tx : 1 - tx) * ((b >> 1) ? tz : 1 - tz);
      const k = jj * n + ii;
      wb += w; bed += g.zb[k] * w;
      if (g.h[k] > H_SHOW && !g.ocean[k]) { we += w; eta += (g.zb[k] + g.h[k]) * w; ux += g.ux[k] * w; uz += g.uz[k] * w; }
    }
    if (wb > 0) out.bed = bed / wb;
    if (we <= 1e-4) return out;
    out.eta = eta / we; out.ux = ux / we; out.uz = uz / we;
    out.d = out.eta - out.bed;
    if (out.d < 0) out.d = 0;
    return out;
  }
  const _s = { d: 0, eta: 0, ux: 0, uz: 0, bed: 0 };
  function depthAt(x, z) { return sample(x, z, _s).d; }
  function levelAt(x, z) { const s = sample(x, z, _s); return s.d > 0 ? s.eta : -Infinity; }
  function flowAt(x, z, out) {
    out = out || {};
    const s = sample(x, z, _s);
    out.x = s.d > 0 ? s.ux : 0; out.z = s.d > 0 ? s.uz : 0; out.speed = Math.hypot(out.x, out.z);
    return out;
  }
  // the object waterfield.js holds while the flood is live
  const FIELD = {
    owner: "flashflood",
    depthAt: depthAt,
    levelAt: levelAt,
    flowAt: flowAt,
  };

  /* ======================================================================
     THE ISLAND, READ (never hard-coded)
     ====================================================================== */
  function pt(p) { return Array.isArray(p) ? { x: +p[0], z: +p[1] } : { x: +p.x, z: +p.z }; }
  function polyline(r) {
    const raw = Array.isArray(r) ? r : (r.pts || r.points || r.path || r.line || r.centerline || r.centreline || null);
    if (!raw || raw.length < 2) return null;
    return raw.map(pt).filter(function (p) { return Number.isFinite(p.x) && Number.isFinite(p.z); });
  }
  function normBridge(b, ground) {
    if (!b) return null;
    let x = +b.x, z = +b.z, len = +(b.len || b.length || b.span), width = +(b.width || b.w);
    let ax = null, az = null;
    if (b.minX != null && b.maxX != null && !Number.isFinite(x)) {
      x = (b.minX + b.maxX) / 2; z = (b.minZ + b.maxZ) / 2;
      const sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
      if (sx >= sz) { len = sx; width = sz; ax = 1; az = 0; } else { len = sz; width = sx; ax = 0; az = 1; }
    }
    if (b.ax != null) { ax = +b.ax; az = +b.az; }
    else if (b.dir) { ax = +b.dir.x; az = +b.dir.z; }
    else if (ax == null) { const y = +(b.yaw != null ? b.yaw : b.rotY != null ? b.rotY : b.angle || 0); ax = Math.cos(y); az = -Math.sin(y); }
    const m = Math.hypot(ax, az) || 1; ax /= m; az /= m;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(len > 0)) return null;
    width = width > 0 ? width : 6;
    const deckY = +(b.deckY != null ? b.deckY : b.top != null ? b.top : b.y != null ? b.y : ground(x, z) + 3);
    const soffitY = +(b.soffitY != null ? b.soffitY : b.soffit != null ? b.soffit : deckY - 0.6);
    return {
      _ffBridge: true, src: b, x: x, z: z, ax: ax, az: az, len: len, width: width, deckY: deckY, soffitY: soffitY,
      group: b.group || b.mesh || b.obj || null, colliders: b.colliders || [], platforms: b.platforms || [],
      cap: +b.cap || 0, state: "standing", jam: 0, jamN: 0, load: 0, peakLoad: 0, failT: null, cells: null,
      etaUp: 0, etaDn: 0, block: 0, maxBlock: 0,
    };
  }
  function islandWorld(ctx) {
    const I = CBZ.island || {};
    const A = (ctx && ctx.arena) || (CBZ.surv && CBZ.surv.arena) || {};
    const pick = function (o, names) { for (const k of names) if (o && typeof o[k] === "function") return o[k].bind(o); return null; };
    const ground = pick(I, ["groundAt", "heightAt", "groundHeightAt", "floorAt"]) || pick(A, ["groundHeightAt"]) || function (x, z) { return CBZ.floorAt ? +CBZ.floorAt(x, z) : 0; };
    const cx = Number.isFinite(+I.cx) ? +I.cx : (I.center ? +I.center.x : ctx ? ctx.cx : 0);
    const cz = Number.isFinite(+I.cz) ? +I.cz : (I.center ? +I.center.z : ctx ? ctx.cz : 0);
    const R = +(I.radius || I.R || (ctx && ctx.R) || A.radius || 120);
    const bnd = I.bounds || null;
    const x0 = bnd ? +bnd.minX : cx - R - 12, x1 = bnd ? +bnd.maxX : cx + R + 12;
    const z0 = bnd ? +bnd.minZ : cz - R - 12, z1 = bnd ? +bnd.maxZ : cz + R + 12;
    const seaY = Number.isFinite(+I.seaY) ? +I.seaY : (CBZ.survSeaMeanY ? +CBZ.survSeaMeanY() : (A.oceanY != null ? +A.oceanY : -0.5));
    // rivers / riverbeds: the upstream end of each is where the catchment's
    // flood enters the island
    const rivers = [], sources = [];
    const rl = I.rivers || I.riverbeds || I.channels || A.rivers || [];
    for (const r of rl) {
      const pts = polyline(r);
      if (!pts || pts.length < 2) continue;
      const a = pts[0], b = pts[pts.length - 1];
      const up = ground(a.x, a.z) >= ground(b.x, b.z) ? a : b;
      rivers.push({ pts: pts, width: +(r.width || r.w || 8) });
      sources.push({ x: up.x, z: up.z, share: +(r.share || 1), width: +(r.width || r.w || 8) });
    }
    const bridges = [];
    for (const b of (I.bridges || A.bridges || [])) { const nb = normBridge(b, ground); if (nb) bridges.push(nb); }
    const buildings = [];
    for (const b of (A.fragile || [])) {
      if (!b || b.fallen || !(b.w > 0) || !(b.d > 0)) continue;
      buildings.push({ x: b.ox != null ? b.ox : b.x, z: b.oz != null ? b.oz : b.z, w: b.w, d: b.d,
        floorY: Number.isFinite(b.floorTop) ? b.floorTop : (Number.isFinite(b.gy) ? b.gy + 0.1 : undefined), door: "-z", src: b });
    }
    // the arena's onRoad is a FOOTPRINT test (x, z, w, d): a point is a 0x0 footprint
    const road = pick(I, ["onRoad"]) || (typeof A.onRoad === "function" ? A.onRoad : null);
    const onRoad = road ? function (x, z) { return !!road(x, z, 0, 0); } : null;
    return {
      ground: ground, x0: x0, z0: z0, x1: x1, z1: z1, seaY: seaY, cx: cx, cz: cz, R: R,
      rivers: rivers, sources: sources, bridges: bridges, buildings: buildings,
      cars: A.cars || [], manholes: I.manholes || A.manholes || null, onRoad: onRoad,
      storm: I.storm || null, parent: A.root || null,
    };
  }

  /* ======================================================================
     START / TICK / CLEAR
     ====================================================================== */
  function event(who, what) {
    if (!F) return;
    F.events.push({ t: +F.t.toFixed(2), who: who, what: what });
    if (F.events.length > 200) F.events.shift();
  }

  function start(world, opts) {
    finish({ keepSilt: false });
    if (silt) { disposeSilt(); }
    opts = opts || {};
    const W = world;
    // bridges arrive in whatever shape the island publishes: normalise once
    W.bridges = (W.bridges || []).map(function (b) { return b && b._ffBridge ? b : normBridge(b, W.ground); }).filter(Boolean);
    const g = makeGrid(W);
    F = {
      W: W, grid: g, t: 0, ready: false, seaY: W.seaY,
      warnSecs: Math.max(0.5, opts.warnSecs || 6), activeSecs: Math.max(4, opts.activeSecs || 30),
      lag: opts.lag != null ? opts.lag : 3,
      opts: opts, vIn: 0, vSea: 0, vSoak: 0, rainTotal: 0, hLive: 0, events: [],
      cars: [], debris: [], bridges: W.bridges || [], sewer: null,
      stats: { cellsTouched: 0, maxDepth: 0, maxDepthAt: null, maxSpeed: 0, lidsPopped: 0, carsStalled: 0, carsSliding: 0, carsFloated: 0, carsSwept: 0,
        bridgesFailed: 0, solveMs: 0, renderMs: 0, bodyMs: 0, frames: 0, worstFrameMs: 0, frontSpeed: 0, roomsFlooded: 0 },
      front: { pts: [], prevArea: 0, track: null },
      render: null, parent: W.parent || CBZ.scene || null,
      roomMax: new Float32Array((W.buildings || []).length),
    };
    coarseStorm(W);
    // the stormSecs budget for normalisation: integral of hydro() over the event
    const Wd = F.warnSecs, Ad = F.activeSecs;
    opts.stormSecs = Wd * 0.425 + Ad * 0.345;
    F.stormSecs = opts.stormSecs;
    // bed sampled in slices; the rest of setup runs when it is complete
    if (opts.sync) { buildSlice(W, g, g.n * g.n); finishSetup(); }
    return true;
  }

  function finishSetup() {
    const W = F.W, g = F.grid, n = g.n;
    finishGrid(W, g, F.opts);
    let rt = 0;
    for (let k = 0; k < n * n; k++) rt += g.rain[k];
    F.rainTotal = rt * g.c * g.c;
    // ---- the sewer and its manholes ----
    const holes = [];
    const mh = W.manholes && W.manholes.length ? W.manholes : deriveManholes(W, g);
    for (const m of mh) {
      const p = pt(m);
      const i = clamp(Math.floor((p.x - g.x0) / g.c), 0, n - 1), j = clamp(Math.floor((p.z - g.z0) / g.c), 0, n - 1);
      const k = j * n + i;
      if (g.ocean[k] || g.room[k]) continue;
      holes.push({ x: p.x, z: p.z, k: k, y: +W.ground(p.x, p.z), popped: false, spout: 0, rate: 0, mesh: m.mesh || m.lid || null, flying: false, lx: p.x, ly: 0, lz: p.z });
    }
    // capacity: ~30 m of 0.9 m pipe per inlet; outfall drains it to sea
    // ~30 m of 0.6 m pipe per inlet; roofs and gutters feed it with the storm
    F.sewer = { holes: holes, V: 0, cap: holes.length * 6, outfall: holes.length * 0.08, roof: holes.length * 0.45, popCd: 0 };
    // ---- the cars ----
    for (const car of (W.cars || [])) F.cars.push(carBody(car));
    // ---- the debris the flood will pick up ----
    seedDebris(W, g);
    F.ready = true;
    // the field becomes the island's ground water
    if (CBZ.groundWaterFieldSet) CBZ.groundWaterFieldSet(FIELD);
    if (THREE && F.parent) buildRender();
    event("flood", "grid " + n + "x" + n + " @ " + g.c.toFixed(2) + " m, volume " + Math.round(g.volume) + " m3, " + g.sources.length + " river source(s), " + holes.length + " manholes, " + F.bridges.length + " bridge(s), " + F.cars.length + " cars");
  }

  function deriveManholes(W, g) {
    // real streets carry an inlet every ~25-40 m, at the low points first;
    // with no published list, walk a 24 m lattice of road and keep the
    // lowest dozen that are not crowded together
    if (!W.onRoad) return [];
    const cand = [];
    const step = 24;
    for (let x = W.x0 + step / 2; x < W.x1; x += step) for (let z = W.z0 + step / 2; z < W.z1; z += step) {
      // snap to the nearest road sample in this lattice cell
      for (let t = 0; t < 9; t++) {
        const px = x + ((t % 3) - 1) * 6, pz = z + (((t / 3) | 0) - 1) * 6;
        if (W.R > 0 && Math.hypot(px - W.cx, pz - W.cz) > W.R * 0.9) continue;   // a street grid's lines run on past the town
        if (W.onRoad(px, pz)) { const y = +W.ground(px, pz); if (y > W.seaY + 0.3) cand.push({ x: px, z: pz, y: y }); break; }
      }
    }
    cand.sort(function (a, b) { return a.y - b.y; });
    const keep = [];
    for (const c of cand) {
      if (keep.length >= 12) break;
      if (keep.every(function (k) { return Math.hypot(k.x - c.x, k.z - c.z) > 30; })) keep.push(c);
    }
    return keep;
  }

  /* ---------------- bodies: cars ---------------- */
  function carBody(car) {
    const cl = car.collider || {};
    const sx = cl.maxX != null ? cl.maxX - cl.minX : 2.2, sz = cl.maxZ != null ? cl.maxZ - cl.minZ : 4.4;
    const L = Math.max(sx, sz), Wd = Math.min(sx, sz);
    const gp = car.group ? car.group.position : { x: car.x, y: 0, z: car.z };
    const ground = bedAt(gp.x, gp.z);
    const A = L * Wd;
    return {
      car: car, x: gp.x, z: gp.z, vx: 0, vz: 0, yaw: car.group ? car.group.rotation.y : (car.rotY || 0), yr: 0,
      L: L, Wd: Wd, A: A, kb: CAR_M / (RHO * A * (CAR_FLOAT_D - CAR_CLEAR)),
      lift: (gp.y || 0) - ground, x0: gp.x, z0: gp.z,
      state: "parked", stalled: false, moving: false, floating: false, swept: false, moved: 0, floatT: 0, restT: 0,
      maxD: 0, jammed: null, pitch: 0, roll: 0, freed: false,
    };
  }
  function freeCar(cb) {
    if (cb.freed) return;
    cb.freed = true;
    const car = cb.car;
    car.flung = true;                               // the arena's reset puts it back
    const cl = car.collider;
    if (cl && CBZ.colliders) { const i = CBZ.colliders.indexOf(cl); if (i >= 0) CBZ.colliders.splice(i, 1); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function settleCar(cb) {
    // where the water left it, it is a wreck you can still hide behind
    const cl = cb.car.collider;
    if (!cl || !CBZ.colliders) return;
    const ca = Math.abs(Math.cos(cb.yaw)), sa = Math.abs(Math.sin(cb.yaw));
    const hx = (cb.Wd * ca + cb.L * sa) / 2, hz = (cb.L * ca + cb.Wd * sa) / 2;
    cl.minX = cb.x - hx; cl.maxX = cb.x + hx; cl.minZ = cb.z - hz; cl.maxZ = cb.z + hz;
    if (CBZ.colliders.indexOf(cl) === -1) CBZ.colliders.push(cl);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  const _cs = { d: 0, eta: 0, ux: 0, uz: 0, bed: 0 };
  function stepCars(dt) {
    const g = F.grid, S = F.stats;
    for (let i = 0; i < F.cars.length; i++) {
      const cb = F.cars[i];
      if (cb.jammed) { holdOnJam(cb, cb.jammed); continue; }
      const s = sample(cb.x, cb.z, _cs);
      const d = s.d;
      if (d > cb.maxD) cb.maxD = d;
      if (d < 0.02 && !cb.moving && !cb.floating) continue;
      if (!cb.stalled && d >= CAR_STALL_D) { cb.stalled = true; S.carsStalled++; if (cb.state === "parked") cb.state = "stalled"; }
      // the cabin ships water: buoyancy bleeds away once it is afloat
      const B = RHO * G * cb.A * cb.kb * Math.max(0, d - CAR_CLEAR);
      const Wt = CAR_M * G;
      const Nn = Wt - B;
      const floating = Nn <= 0;
      if (floating && !cb.floating) { cb.floating = true; if (!cb.everFloat) { cb.everFloat = true; S.carsFloated++; } freeCar(cb); cb.state = "floating"; }
      else if (!floating && cb.floating) { cb.floating = false; cb.state = cb.moved > 2 ? "stranded" : "stalled"; }
      if (cb.floating) { cb.floatT += dt; cb.kb *= Math.exp(-dt / 22); }
      // drag on the projected side against the current
      const rx = s.ux - cb.vx, rz = s.uz - cb.vz, rs = Math.hypot(rx, rz);
      let fx = 0, fz = 0;
      if (rs > 1e-3 && d > 0.02) {
        const ax = Math.sin(cb.yaw), az = Math.cos(cb.yaw);
        const dot = Math.abs((ax * rx + az * rz) / rs);
        const crs = Math.sqrt(Math.max(0, 1 - dot * dot));
        const proj = cb.L * crs + cb.Wd * dot;
        const Fm = 0.5 * RHO * CAR_CD * Math.min(d, 1.4) * proj * rs * rs;
        fx = Fm * rx / rs; fz = Fm * rz / rs;
      }
      const M = CAR_M * 1.25;                       // + entrained water (added mass)
      const vs = Math.hypot(cb.vx, cb.vz);
      if (!floating) {
        const fric = Nn * (cb.moving ? CAR_MU_K : CAR_MU_S);
        if (!cb.moving) {
          if (Math.hypot(fx, fz) > fric) { cb.moving = true; freeCar(cb); if (!cb.everSlid) { cb.everSlid = true; S.carsSliding++; } cb.state = "sliding"; }
        }
        if (cb.moving) {
          let ax = fx / M, az = fz / M;
          if (vs > 1e-3) { ax -= Nn * CAR_MU_K / M * cb.vx / vs; az -= Nn * CAR_MU_K / M * cb.vz / vs; }
          const nvx = cb.vx + ax * dt, nvz = cb.vz + az * dt;
          if (vs > 1e-3 && nvx * cb.vx + nvz * cb.vz <= 0) { cb.vx = 0; cb.vz = 0; }
          else { cb.vx = nvx; cb.vz = nvz; }
          if (Math.hypot(cb.vx, cb.vz) < 0.03 && Math.hypot(fx, fz) < Nn * CAR_MU_S) {
            cb.vx = 0; cb.vz = 0; cb.moving = false; cb.state = cb.moved > 2 ? "stranded" : "stalled";
            if (cb.moved > 0.3) settleCar(cb);
          }
        }
      } else {
        cb.vx += fx / M * dt; cb.vz += fz / M * dt;
        cb.moving = true;
      }
      // yaw: a floating or sliding car swings its long axis into the current
      // (the heavy engine end trails upstream)
      if ((cb.moving || floating) && rs > 0.2) {
        const want = Math.atan2(s.ux, s.uz);
        let da = want - cb.yaw;
        da = Math.atan2(Math.sin(2 * da), Math.cos(2 * da)) / 2;   // the axis, either end
        cb.yr += (da * (floating ? 0.9 : 0.35) - cb.yr * 0.8) * dt * 3;
        cb.yaw += cb.yr * dt;
      }
      // integrate, against walls (a room cell is solid to a car)
      if (cb.vx || cb.vz) {
        const nx = cb.x + cb.vx * dt, nz = cb.z + cb.vz * dt;
        const k = cellOf(g, nx, nz);
        if (k >= 0 && g.room[k]) { cb.vx *= -0.15; cb.vz *= -0.15; }
        else {
          cb.moved += Math.hypot(nx - cb.x, nz - cb.z);
          cb.x = nx; cb.z = nz;
          if (!cb.swept && Math.hypot(cb.x - cb.x0, cb.z - cb.z0) > 2) { cb.swept = true; S.carsSwept++; event("car", "swept " + (cb.car.name || i) + " at depth " + d.toFixed(2)); }
        }
        bridgeCatch(cb, true);
      }
      // the body's height: afloat on the level, else on the bed
      const t = F.t;
      if (floating) {
        const draft = CAR_CLEAR + CAR_M / (RHO * cb.A * cb.kb);
        cb.y = s.eta - Math.min(draft, d) + Math.sin(t * 1.7 + i) * 0.05;
        cb.pitch += ((0.13 + Math.sin(t * 1.1 + i) * 0.05) - cb.pitch) * Math.min(1, dt * 2);
        cb.roll = Math.sin(t * 1.3 + i * 2) * 0.07;
      } else {
        cb.y = s.bed + cb.lift;
        cb.pitch += (0 - cb.pitch) * Math.min(1, dt * 3);
        cb.roll *= 0.9;
      }
      const gp = cb.car.group;
      if (gp && (cb.moving || floating || cb.moved > 0)) {
        gp.position.set(cb.x, cb.y, cb.z);
        gp.rotation.set(cb.pitch, cb.yaw, cb.roll);
      }
    }
  }
  // the grid's own bed (bilinear over cell centres): what bodies sit on, so a
  // car's height and the water's depth are measured from the same ground
  function bedAt(x, z) {
    const g = F.grid, n = g.n;
    const fx = clamp((x - g.x0) / g.c - 0.5, 0, n - 1.001), fz = clamp((z - g.z0) / g.c - 0.5, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * n + i;
    const i1 = Math.min(n - 1, i + 1) - i, j1 = (Math.min(n - 1, j + 1) - j) * n;
    return (g.zb[k] * (1 - tx) + g.zb[k + i1] * tx) * (1 - tz) + (g.zb[k + j1] * (1 - tx) + g.zb[k + j1 + i1] * tx) * tz;
  }
  function cellOf(g, x, z) {
    const i = Math.floor((x - g.x0) / g.c), j = Math.floor((z - g.z0) / g.c);
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return -1;
    return j * g.n + i;
  }

  /* ---------------- bodies: debris (boards, branches, tyres, logs) ------- */
  function seedDebris(W, g) {
    // what the water picks up: scattered across the land it will cross, more
    // of it near the channels and the storm (deterministic, no rng draw)
    const n = g.n, st = g.storm;
    const pick = [];
    for (let k = 0; k < n * n; k++) {
      if (g.ocean[k] || g.room[k] || g.bridgeOf[k]) continue;
      const i = k % n, j = (k / n) | 0;
      const d = Math.hypot(cellX(g, i) - st.x, cellZ(g, j) - st.z) / (st.r * 2.4);
      if (hash01(k, 77) < 0.25 * Math.exp(-d * d)) pick.push(k);
    }
    // A RIVER IN SPATE IS FULL OF TREES: the flood undercuts the banks of the
    // upper channel and takes what grows there, so the logs start on the
    // river's banks (upper 60% of its length) or at its source; boards,
    // branches and tyres lie about the land it will cross
    const banks = [];
    for (const r of (W.rivers || [])) {
      const P = r.pts; if (!P || P.length < 2) continue;
      const up = +W.ground(P[0].x, P[0].z) >= +W.ground(P[P.length - 1].x, P[P.length - 1].z);
      const pts = up ? P : P.slice().reverse();
      let L = 0; const seg = [];
      for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); seg.push(l); L += l; }
      banks.push({ pts: pts, seg: seg, L: L, half: (r.width || 8) / 2 + 1.5 });
    }
    function onBank(p) {
      const B = banks[p % banks.length];
      let t = hash01(p, 21) * 0.6 * B.L;
      for (let i = 0; i < B.seg.length; i++) {
        if (t <= B.seg[i] || i === B.seg.length - 1) {
          const a = B.pts[i], b = B.pts[i + 1], u = Math.min(1, t / (B.seg[i] || 1));
          const dx = (b.x - a.x) / (B.seg[i] || 1), dz = (b.z - a.z) / (B.seg[i] || 1);
          const side = hash01(p, 22) < 0.5 ? -1 : 1, off = B.half * (0.6 + hash01(p, 23) * 0.6);
          return { x: a.x + (b.x - a.x) * u - dz * side * off, z: a.z + (b.z - a.z) * u + dx * side * off };
        }
        t -= B.seg[i];
      }
      return null;
    }
    const total = N_FLOT + N_LOGS;
    for (let p = 0; p < total; p++) {
      const log = p >= N_FLOT;
      let x, z;
      const src = g.sources.length ? g.sources[p % g.sources.length] : null;
      const bank = log && banks.length && p % 3 !== 0 ? onBank(p) : null;
      if (bank) { x = bank.x; z = bank.z; }
      else if (src && (log || p % 3 === 0)) {
        x = src.x + (hash01(p, 5) - 0.5) * g.c * 4; z = src.z + (hash01(p, 6) - 0.5) * g.c * 4;
      } else if (pick.length) {
        const k = pick[Math.floor(hash01(p, 9) * pick.length)];
        x = cellX(g, k % n) + (hash01(p, 3) - 0.5) * g.c; z = cellZ(g, (k / n) | 0) + (hash01(p, 4) - 0.5) * g.c;
      } else continue;
      const kind = log ? 3 : p % 3;
      const size = log ? 5 + hash01(p, 11) * 4 : 0.75 + hash01(p, 12) * 0.5;
      F.debris.push({
        kind: kind, slot: 0, x: x, z: z, vx: 0, vz: 0, y: +W.ground(x, z), state: "seed",
        len: log ? size : [2.2, 2.3, 0.62][kind] * size, s: size,
        draft: log ? 0.22 : [0.04, 0.08, 0.16][kind], yaw: hash01(p, 13) * 6.28, spin: (hash01(p, 14) - 0.5) * 2,
        rx: hash01(p, 15) * 6.28, ph: hash01(p, 16) * 6.28, jam: null,
      });
    }
    const per = [0, 0, 0, 0];
    for (const d of F.debris) d.slot = per[d.kind]++;
    F.debrisPer = per;
  }
  const _ds = { d: 0, eta: 0, ux: 0, uz: 0, bed: 0 };
  function stepDebris(dt) {
    let afloat = 0, stranded = 0, jammed = 0;
    for (let i = 0; i < F.debris.length; i++) {
      const p = F.debris[i];
      if (p.state === "jammed") { jammed++; holdOnJam(p, p.jam); continue; }
      const s = sample(p.x, p.z, _ds);
      if (p.state === "seed" || p.state === "stranded") {
        if (s.d > p.draft * 1.4) { p.state = "afloat"; }
        else { if (p.state === "stranded") stranded++; p.y = s.bed; continue; }
      }
      // afloat: carried by the current (logs lag it a little)
      const tau = p.kind === 3 ? 1.1 : 0.6;
      p.vx += (s.ux - p.vx) * Math.min(1, dt / tau);
      p.vz += (s.uz - p.vz) * Math.min(1, dt / tau);
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      const k = cellOf(F.grid, nx, nz);
      if (k >= 0 && F.grid.room[k]) { p.vx *= -0.3; p.vz *= -0.3; }
      else { p.x = nx; p.z = nz; }
      const sp = Math.hypot(p.vx, p.vz);
      if (p.kind === 3 && sp > 0.3) {
        // a log in a current travels end-on
        const want = Math.atan2(p.vx, p.vz);
        let da = want - p.yaw; da = Math.atan2(Math.sin(2 * da), Math.cos(2 * da)) / 2;
        p.yaw += da * Math.min(1, dt * 0.8);
      } else p.yaw += p.spin * dt * Math.min(1, sp);
      p.rx += sp * dt * (p.kind === 3 ? 0.3 : 1.2);
      p.y = (s.d > 0 ? s.eta : s.bed) - p.draft * 0.5 + Math.sin(F.t * 2.1 + p.ph) * 0.05;
      if (s.d < p.draft * 0.8) { p.state = "stranded"; p.vx = p.vz = 0; p.y = s.bed; stranded++; continue; }
      afloat++;
      bridgeCatch(p, false);
    }
    F.stats.debrisAfloat = afloat; F.stats.debrisStranded = stranded; F.stats.debrisJammed = jammed;
  }

  /* ---------------- bridges: catch, jam, back up, fail ------------------- */
  const _bs = { d: 0, eta: 0, ux: 0, uz: 0, bed: 0 };
  function bridgeCatch(b, isCar) {
    for (let k = 0; k < F.bridges.length; k++) {
      const br = F.bridges[k];
      if (br.state === "failed") continue;
      const rx = b.x - br.x, rz = b.z - br.z;
      const al = rx * br.ax + rz * br.az;
      if (Math.abs(al) > br.len / 2 + 0.5) continue;
      const ac = -rx * br.az + rz * br.ax;            // across the deck (the flow's way)
      const half = br.width / 2;
      if (Math.abs(ac) > half + 1.5) continue;
      // which side is upstream: the side the thing is coming FROM
      const vac = -b.vx * br.az + b.vz * br.ax;
      if (Math.abs(vac) < 0.05) continue;
      const fromSide = vac > 0 ? -1 : 1;              // moving +ac: came from -ac
      if (ac * fromSide < half - 0.4) continue;      // already under or past
      // it passes beneath only if it clears the soffit (logs and cars do not)
      const lvl = sample(b.x, b.z, _bs).eta;
      const top = lvl + (isCar ? 1.0 : (b.kind === 3 ? 0.45 : 0.15));
      const tooLong = !isCar && b.kind === 3 && b.len > 4;   // spans a pier gap
      if (top < br.soffitY && !tooLong && !isCar) continue;
      if (isCar && lvl + 0.9 < br.soffitY && br.soffitY - br.bed > 2.2) continue;  // a car slides under a tall arch
      // JAMMED against the upstream face
      b.jam = br; b.jammed = br; b.state = "jammed";
      b.jamAl = clamp(al, -br.len / 2 + 0.8, br.len / 2 - 0.8);
      b.jamSide = fromSide;
      b.vx = b.vz = 0;
      const area = isCar ? b.L * 1.4 : (b.kind === 3 ? b.len * 0.6 * 1.6 : b.len * 0.25);
      br.jam += area; br.jamN++;
      if (br.state === "standing") { br.state = "jamming"; event("bridge", "debris jamming bridge " + k); }
      if (isCar) { b.state = "jammed"; b.moving = false; }
      return true;
    }
    return false;
  }
  function holdOnJam(b, br) {
    if (br.state === "failed") {
      b.jammed = null; b.jam = null;
      b.state = b.car ? "floating" : "afloat";
      return;
    }
    const lvl = sample(br.x, br.z, _bs).eta;
    const ac = b.jamSide * (br.width / 2 + (b.car ? b.Wd / 2 : 0.3));
    b.x = br.x + br.ax * b.jamAl - br.az * ac;
    b.z = br.z + br.az * b.jamAl + br.ax * ac;
    if (b.car) {
      b.y = Number.isFinite(lvl) ? lvl - 0.6 : b.y;
      b.yaw = Math.atan2(br.ax, br.az);              // broadside against the deck
      const gp = b.car.group;
      if (gp) { gp.position.set(b.x, b.y, b.z); gp.rotation.set(0.25, b.yaw, 0.1); }
    } else {
      b.yaw = Math.atan2(br.ax, br.az);
      b.y = Number.isFinite(lvl) ? lvl - b.draft * 0.4 : b.y;
    }
  }
  function stepBridges(dt) {
    const g = F.grid;
    for (let k = 0; k < F.bridges.length; k++) {
      const br = F.bridges[k];
      if (!br.cells || !br.cells.length) continue;
      if (br.state === "failed") { animateFall(br, dt); continue; }
      // the levels either side, half a cell beyond the deck edges
      const off = br.width / 2 + g.c;
      const sa = sample(br.x - br.az * off, br.z + br.ax * off, _bs); const ea = sa.d > 0 ? sa.eta : sa.bed;
      const sb = sample(br.x + br.az * off, br.z - br.ax * off, _bs); const eb = sb.d > 0 ? sb.eta : sb.bed;
      const up = Math.max(ea, eb), dn = Math.min(ea, eb);
      br.etaUp = up; br.etaDn = dn;
      // a structure answers to a SUSTAINED load: the bore's first slap is a
      // fraction of a second, the pond behind a jam is for keeps
      const kh = Math.min(1, dt / 3);
      br.headS = (br.headS || 0) + (Math.max(0, up - dn) - (br.headS || 0)) * kh;
      const sc = sample(br.x, br.z, _bs);
      const v = Math.hypot(sc.ux, sc.uz);
      // what the jam blocks of the open waterway, and what the deck blocks
      // once the water is above its soffit (pressure flow), and the weir over
      // the deck once it is overtopped
      br.block = Math.min(0.9, br.jam / br.open);
      if (br.block > br.maxBlock) br.maxBlock = br.block;
      const depth = Math.max(0.05, up - br.bed);
      let deck = 1;
      if (up > br.soffitY) {
        const under = Math.max(0.05, br.soffitY - br.bed);
        const over = Math.max(0, up - br.deckY);
        deck = clamp((under + over) / depth, 0.12, 1);
        if (!br.overtopped && over > 0.05) { br.overtopped = true; event("bridge", "bridge " + k + " overtopped"); }
      }
      const wf = (1 - br.block) * deck;
      for (const c of br.cells) setCellFaces(g, c, wf);
      // THE LOAD: the head across the bridge on the blocked face plus the
      // current's drag on the jam and the submerged deck
      // what stands in the water: the jam, the deck face once the level is
      // over the soffit, and the piers (~8% of the waterway)
      const head = br.headS;
      const wetH = Math.max(0, Math.min(up, br.deckY) - br.bed);
      const blockedA = Math.min(br.len * wetH, br.jam + Math.max(0, Math.min(up, br.deckY) - br.soffitY) * br.len + 0.08 * br.len * Math.min(wetH, br.soffitY - br.bed));
      br.blockedA = blockedA;
      // hydrostatic thrust of the head on the blocked face + drag on it
      const F_h = RHO * G * head * blockedA;
      const F_d = 0.5 * RHO * 2.0 * v * v * blockedA;
      br.load = F_h + F_d;
      if (br.load > br.peakLoad) br.peakLoad = br.load;
      // a light road bridge: ~25 kN per square metre of the waterway it spans
      // (it rides out clean water and the bore over its deck; a jam with a
      // pond behind it is what kills it)
      const cap = br.cap > 0 ? br.cap : 25000 * br.len * Math.max(1, br.deckY - br.bed);
      br.capN = cap;
      // overload works the bearings and scours the abutments: damage
      // accumulates while the load is over capacity, and it lets go
      if (br.load > cap) br.dmg = (br.dmg || 0) + (br.load / cap - 1 + 0.15) * dt;
      else if (br.dmg > 0) br.dmg = Math.max(0, br.dmg - dt * 0.02);
      if (br.dmg > 1) failBridge(br, k, ea >= eb ? 1 : -1);
    }
  }
  function setCellFaces(g, k, w) {
    const n = g.n, i = k % n, j = (k / n) | 0, n1 = n + 1;
    g.wx[j * n1 + i] = g.wx0[j * n1 + i] * w;
    g.wx[j * n1 + i + 1] = g.wx0[j * n1 + i + 1] * w;
    g.wz[j * n + i] = g.wz0[j * n + i] * w;
    g.wz[(j + 1) * n + i] = g.wz0[(j + 1) * n + i] * w;
  }
  function failBridge(br, k, upSide) {
    br.state = "failed"; br.failT = F.t; br.fall = { t: 0, side: -upSide, vy: 0, y: 0, rot: 0 };
    F.stats.bridgesFailed++;
    event("bridge", "bridge " + k + " FAILED at load " + Math.round(br.load / 1000) + " kN (cap " + Math.round(br.capN / 1000) + " kN), jam " + br.jamN + " pieces, head " + (br.etaUp - br.etaDn).toFixed(2) + " m");
    // the wreck still sits in the channel and takes a share of the waterway
    const g = F.grid;
    for (const c of br.cells) setCellFaces(g, c, 0.7);
    br.jam = 0;
    // the deck stops being something to stand on
    for (const c of br.colliders) { const i = CBZ.colliders ? CBZ.colliders.indexOf(c) : -1; if (i >= 0) CBZ.colliders.splice(i, 1); }
    for (const p of br.platforms) { const i = CBZ.platforms ? CBZ.platforms.indexOf(p) : -1; if (i >= 0) CBZ.platforms.splice(i, 1); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (br.src) br.src.failed = true;
    if (CBZ.sfxAt) CBZ.sfxAt("collapse", br.x, br.z, { volume: 1 });
    if (CBZ.shake && CBZ.camera && Math.hypot(CBZ.camera.position.x - br.x, CBZ.camera.position.z - br.z) < 70) CBZ.shake(0.35);
    if (CBZ.debris && CBZ.debris.chips) {
      try { CBZ.debris.chips(br.x, br.soffitY, br.z, { kind: "concrete", count: 30, power: 1.4, spread: br.len * 0.3 }); } catch (e) {}
    }
    if (F.render) burst(br.x, br.soffitY, br.z, 90, 4, br.len * 0.5);
  }
  function animateFall(br, dt) {
    const f = br.fall, gp = br.group;
    if (!f || f.done) return;
    f.t += dt;
    const target = br.bed - br.deckY + 0.5;      // the deck lands on the bed
    f.vy -= G * dt; f.y += f.vy * dt;
    if (f.y < target) { f.y = target; f.done = true; }
    f.rot = Math.min(0.55, f.rot + dt * 0.7);
    if (gp) {
      if (!br.home) br.home = { x: gp.position.x, y: gp.position.y, z: gp.position.z, rx: gp.rotation.x, ry: gp.rotation.y, rz: gp.rotation.z };
      const H = br.home;
      const shove = Math.min(1, f.t * 1.2) * 2.5 * f.side;
      gp.position.set(H.x - br.az * shove, H.y + f.y, H.z + br.ax * shove);
      // tip about the deck's long axis, downstream — only when the group's
      // origin IS the deck (a deck baked in world coordinates under an
      // origin-0 group would swing round the world origin: drop it instead)
      const local = Math.hypot(H.x - br.x, H.z - br.z) < br.len * 0.5;
      if (local) gp.rotation.set(H.rx + br.ax * f.rot * f.side, H.ry, H.rz - br.az * f.rot * f.side);
    }
  }

  /* ======================================================================
     MEASURE (front speed, depths, rooms)
     ====================================================================== */
  function measure(dt) {
    const g = F.grid, n = g.n, S = F.stats, bb = g.bb;
    if (bb.i1 < bb.i0) return;
    let wetArea = 0;
    const fpts = F.front.pts; fpts.length = 0;
    for (let j = bb.j0; j <= bb.j1; j++) for (let i = bb.i0; i <= bb.i1; i++) {
      const k = j * n + i;
      const h = g.h[k];
      if (h <= H_SHOW || g.ocean[k]) { if (g.wetT[k] > 0 && h <= H_SHOW) { g.wetT[k] = 0; } continue; }
      wetArea++;
      if (g.hmax[k] === 0) S.cellsTouched++;
      if (h > g.hmax[k]) { g.hmax[k] = h; g.etaMax[k] = g.zb[k] + h; }
      g.wetT[k] += dt;
      g.wetSum[k] += dt;
      if (!g.room[k] && h > S.maxDepth) { S.maxDepth = h; S.maxDepthAt = [+cellX(g, i).toFixed(1), +cellZ(g, j).toFixed(1)]; }
      const sp = Math.hypot(g.ux[k], g.uz[k]);
      if (h > 0.1 && sp > S.maxSpeed) S.maxSpeed = sp;
      // the silt is combed the way the last of the water ran off it
      if (sp > 0.25) { g.combX[k] = g.ux[k] / sp; g.combZ[k] = g.uz[k] / sp; }
      if (g.room[k]) { const r = g.room[k] - 1; if (h > F.roomMax[r]) F.roomMax[r] = h; }
      // THE FRONT: freshly wet cells, moving, with dry ground ahead
      if (g.wetT[k] < 1.2 && sp > 0.6 && h > 0.08 && fpts.length < 400) fpts.push(k);
    }
    let rooms = 0;
    for (let r = 0; r < F.roomMax.length; r++) if (F.roomMax[r] > 0.05) rooms++;
    S.roomsFlooded = rooms;
    S.wetArea = Math.round(wetArea * g.c * g.c);
    // FRONT SPEED, measured: the flow speed of the leading cells is the
    // celerity the flood is advancing at (local inertial fronts move with the
    // water behind them); keep a smoothed running value and the peak.
    if (fpts.length) {
      let sum = 0, w = 0;
      for (let t = 0; t < fpts.length; t++) { const k = fpts[t]; const sp = Math.hypot(g.ux[k], g.uz[k]); sum += sp * g.h[k]; w += g.h[k]; }
      const v = w > 0 ? sum / w : 0;
      S.frontSpeedNow = v;
      S.frontSpeed = Math.max(S.frontSpeed, v);
      S.frontSpeedSum = (S.frontSpeedSum || 0) + v * dt; S.frontSpeedT = (S.frontSpeedT || 0) + dt;
    } else S.frontSpeedNow = 0;
  }
  // a tracer for the kit: when did the water (> thr) first reach (x,z)
  function arrival(x, z, thr) {
    const g = F && F.grid;
    if (!g) return null;
    const k = cellOf(g, x, z);
    return k >= 0 && g.hmax[k] > (thr || 0.05) ? true : false;
  }

  /* ======================================================================
     RENDER: the surface (one water material), spray, debris, lids, marks
     ====================================================================== */
  function floodMaterial() {
    /* aShow: 1 where this vertex carries water, a bank or silt, 0 where the
       sheet has nothing to say (dry ground, open sea). Interpolated and cut
       at 0.5, so the sheet ends half a cell past its last drawn vertex and
       never as the grid's square. Before it, every open-sea cell of the grid
       was parked 8 cm under mean sea level as OPAQUE MUD: the swell's troughs
       dipped through it and the translucent sea showed it, so the whole
       domain read as a flickering brown square around the island, and it
       stayed for the rest of the match (the sheet is kept as the silt). */
    const decl = "attribute vec4 aFlow;\nattribute float aWall;\nattribute float aShow;\nattribute float aDepth;\nvarying vec4 vFf;\nvarying float vWall;\nvarying float vShow;\nvarying float vDep;";
    // aFlow arrives as normalised bytes (half the upload): velocity in
    // +-10 m/s around 0.5, foam and silt as 0..1
    const tail = "  vFf = vec4((aFlow.xy - 0.5) * 20.0, aFlow.zw);\n  vWall = aWall;\n  vShow = aShow;\n  vDep = aDepth;";
    const fdecl = [
      "varying vec4 vFf;",
      "varying float vWall;",
      "varying float vShow;",
      "varying float vDep;",
      "float ffHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      "float ffNoise(vec2 p) {",
      "  vec2 i = floor(p), f = fract(p);",
      "  vec2 u = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(ffHash(i), ffHash(i + vec2(1.0, 0.0)), u.x), mix(ffHash(i + vec2(0.0, 1.0)), ffHash(i + vec2(1.0, 1.0)), u.x), u.y);",
      "}",
      "float ffFbm(vec2 p) { return ffNoise(p) * 0.62 + ffNoise(p * 2.31 + 17.7) * 0.38; }",
      // streaks along the local flow, by the two-phase flow-map trick so the
      // pattern moves with the water without shearing apart over time
      "float ffStreak(vec2 p, vec2 fl) {",
      "  float sp = length(fl);",
      "  vec2 fd = sp > 0.02 ? fl / sp : vec2(1.0, 0.0);",
      "  vec2 ax = vec2(-fd.y, fd.x);",
      "  float T = 1.7;",
      "  float p0 = fract(uSeaTime / T), p1 = fract(uSeaTime / T + 0.5);",
      "  vec2 q0 = p - fl * (p0 * T), q1 = p - fl * (p1 * T);",
      "  float a = ffFbm(vec2(dot(q0, fd) * 0.35, dot(q0, ax) * 1.6));",
      "  float b = ffFbm(vec2(dot(q1, fd) * 0.35, dot(q1, ax) * 1.6) + 7.3);",
      "  return mix(a, b, abs(1.0 - 2.0 * p0));",
      "}",
    ].join("\n");
    /* FLOODWATER, from the Ahr valley 2021, Derbyshire 2019 and every
       street-level flash flood clip: OPAQUE (a few centimetres of it hide the
       kerb), a turbid milky BROWN-GREY that is lighter and greyer where it is
       churned, mottled with silt plumes, and a poor mirror: the sky it shows
       is weak, brown-tinted and torn up by the chop. Its foam is DIRTY
       off-white-tan, broken into clumps and streaks that ride the current,
       and only where the water is fast, falling, slamming a wall or jammed
       on a bridge; slack water carries a sparse scum and nothing else. The
       last few centimetres at the margin are wet ground showing through.
       The old sheet was a near-black chocolate with a 45% sky mirror and a
       foam colour mixed in flat: a glossy blue-grey slab. */
    const ftail = [
      // the wall line: the street's water never stands inside a building
      // (the room has its own level, drawn by the room sheet)
      "  if (vWall < 0.0 || vShow < 0.5) discard;",
      "  {",
      "    vec3 fN = normalize(vSeaNormal);",
      "    if (under > 0.5) fN = -fN;",
      "    vec2 fl = vFf.xy;",
      "    float sp = length(fl);",
      "    float near = 1.0 - smoothstep(22.0, 70.0, vSeaMisc.y);",
      "    float st = mix(0.5, ffStreak(vSeaWorld.xz, fl), near);",
      "    float fine = mix(0.5, ffStreak(vSeaWorld.xz * 2.3 + 9.1, fl * 2.3), near);",
      "    float blot = ffFbm(vSeaWorld.xz * 0.045 + 3.1);",
      "    float rough = clamp(sp / 3.5, 0.0, 1.0);",
      // THE CHOP, by screen derivatives of the moving pattern (no extra
      // taps): boils and ripples riding the flow, rougher the faster it runs
      "    float hgt = st * 0.65 + fine * 0.35;",
      "    vec2 pX = dFdx(vSeaWorld.xz), pY = dFdy(vSeaWorld.xz);",
      "    float hX = dFdx(hgt), hY = dFdy(hgt);",
      "    float det = pX.x * pY.y - pX.y * pY.x;",
      "    vec2 gW = abs(det) > 1e-6 ? vec2(pY.y * hX - pX.y * hY, -pY.x * hX + pX.x * hY) / det : vec2(0.0);",
      "    float amp = (0.10 + 0.55 * rough) * near;",
      "    vec3 rN = normalize(fN - vec3(gW.x, 0.0, gW.y) * amp);",
      "    vec3 L = normalize(uSunDir);",
      "    float ndl = max(dot(rN, L), 0.0);",
      "    float skyT = smoothstep(-0.12, 0.72, reflect(-V, rN).y);",
      "    #ifdef USE_FOG",
      "      vec3 skyC = mix(fogColor * 1.05, fogColor * 0.62, skyT);",
      "    #else",
      "      vec3 skyC = mix(uSkyLow, uSkyHigh, skyT);",
      "    #endif",
      // THE BODY: a suspension, two-tone with the silt plumes riding the flow
      "    vec3 body = mix(vec3(0.100, 0.080, 0.054), vec3(0.150, 0.121, 0.083), smoothstep(0.25, 0.85, blot));",
      "    body *= 0.90 + 0.20 * st;",
      // churned water carries more silt and more air: paler, greyer
      "    body = mix(body, vec3(0.165, 0.148, 0.118), rough * 0.40);",
      "    float dep = vDep * vDep * 2.0;",
      // the margin: a centimetre or two over the ground reads as wet ground
      "    body = mix(body * 0.62, body, smoothstep(0.02, 0.22, dep));",
      "    vec3 col = body * (0.55 + 0.45 * ndl);",
      // a poor mirror: the surface Fresnel, cut by the chop, tinted by the body under it
      "    float mf = 0.02 + 0.98 * pow(1.0 - clamp(dot(rN, V), 0.0, 1.0), 5.0);",
      "    col = mix(col, skyC * vec3(0.92, 0.88, 0.80), clamp(mf * (0.45 - 0.25 * rough), 0.0, 0.24));",
      "    col += uSunColor * pow(max(dot(rN, normalize(L + V)), 0.0), mix(90.0, 28.0, rough)) * (0.16 + 0.45 * mf) * (1.0 - 0.55 * rough);",
      // FOAM: the CPU says where (the churning front band, steep faces, the
      // walls it piles against, the bridge jams); the moving pattern says
      // what shape: clumps and streaks along the flow, never a band
      "    float fa = clamp(vFf.z + smoothstep(2.2, 6.0, sp) * 0.45, 0.0, 1.0);",
      "    float pat = st * 0.55 + fine * 0.45;",
      "    float thr = 1.0 - fa * 0.60;",
      "    float fm = smoothstep(thr, thr + 0.12, pat) * step(0.02, fa);",
      // slack water: a sparse scum of bubbles and litter in lines
      "    fm = max(fm, smoothstep(0.93, 0.99, 1.0 - abs(st * 2.0 - 1.0)) * (1.0 - rough) * 0.28 * near);",
      "    fm = mix(fa * 0.40, fm, near) * 0.85;",
      // dirty off-white-tan, darker at its thin margins (the water shows through)
      "    vec3 foamC = mix(body * 1.45, vec3(0.37, 0.335, 0.275), smoothstep(thr + 0.03, thr + 0.28, pat));",
      "    foamC *= 0.62 + 0.38 * ndl;",
      "    col = mix(col, foamC, fm);",
      // where the water has gone the silt mesh takes over (flashflood-silt)
      "    float siltK = smoothstep(0.0, 0.06, vFf.w);",
      "    outAlpha = (1.0 - siltK) * mix(0.55, 1.0, smoothstep(0.015, 0.12, dep));",
      "    if (outAlpha < 0.01) discard;",
      "    outColor = col;",
      "    solid = 1.0;",
      "  }",
    ].join("\n");
    if (CBZ.waterSeaMaterial) {
      try {
        const m = CBZ.waterSeaMaterial({ kind: "external", name: "CBZ Flash Flood", vertexDecl: decl, vertexTail: tail, fragDecl: fdecl, fragTail: ftail,
          horizonFuse: false, transparent: true, depthWrite: true });
        // blended for the margin (outAlpha); it still writes its depth
        m.transparent = true;
        if (m.userData.waterUniforms && m.userData.waterUniforms.uSeaOpacity) m.userData.waterUniforms.uSeaOpacity.value = 1;
        m.userData.floodField = true;
        // the silt film lies 4.5 cm over the ground: pull it forward so a
        // far slope never z-fights it into a flicker
        m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
        return m;
      } catch (e) { if (window.console) console.warn("[flashflood] water material:", e && e.message); }
    }
    return new THREE.MeshLambertMaterial({ color: 0x3a2c1e, vertexColors: false });
  }

  /* THE SILT FILM: the flood sheet's own vertices, drawn by a Lambert
     material (so it takes the scene's light and shadow exactly as the
     ground it lies on does) with the one flood residue look
     (world/water_spec.js cbzFloodResidue). Its edge is cut mid-cell on a
     noise-warped threshold so the grid never shows, with the wrack line in
     the band just inside it. It dries on its own clock (siltK, per cell) plus
     uSiltAge, the seconds since the flood ended, which keeps running after
     the solve has gone: like the burn scar it ages on, for the match. */
  function siltMaterial(waterMat) {
    const WU = waterMat && waterMat.userData && waterMat.userData.waterUniforms;
    const U = {
      uSiltAge: { value: 0 },
      uSlSun: WU && WU.uSunDir ? WU.uSunDir : { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSlSunC: WU && WU.uSunColor ? WU.uSunColor : { value: new THREE.Color(1, 0.95, 0.85) },
      uSlSky: WU && WU.uSkyLow ? WU.uSkyLow : { value: new THREE.Color(0.7, 0.75, 0.78) },
    };
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    m.name = "flashflood-silt";
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
    const GL = CBZ.floodResidueGLSL ? CBZ.floodResidueGLSL() : "";
    const DRY = (CBZ.floodResidueDrySecs || 150).toFixed(1);
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aFlow;\nattribute float aWall;\nattribute float aShow;\nattribute float aDepth;\nvarying vec4 vSlF;\nvarying vec3 vSlW;\nvarying vec3 vSlN;\nvarying vec2 vSlS;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSlF = vec4((aFlow.xy - 0.5) * 20.0, aFlow.zw);\nvSlW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSlN = normalize(mat3(modelMatrix) * objectNormal);\nvSlS = vec2(aShow, aDepth) + vec2(0.0, aWall < 0.0 ? -9.0 : 0.0);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", ["#include <common>",
          "uniform float uSiltAge; uniform vec3 uSlSun; uniform vec3 uSlSunC; uniform vec3 uSlSky;",
          "varying vec4 vSlF; varying vec3 vSlW; varying vec3 vSlN; varying vec2 vSlS;",
          "float slGloss;", GL].join("\n"))
        .replace("#include <color_fragment>", ["#include <color_fragment>",
          "{",
          "  if (vSlS.y < -1.0) discard;",                 // inside a building
          "  float sk = smoothstep(0.0, 0.06, vSlF.w);",
          "  if (sk < 0.02) discard;",
          // the reach: a ragged contour, not the grid's square
          "  float rag = cbzRsN(vSlW.xz * 0.45 + 7.0) * 0.6 + cbzRsN(vSlW.xz * 1.7) * 0.4;",
          "  float cut = 0.5 + (rag - 0.5) * 0.36;",
          "  if (vSlS.x < cut) discard;",
          "  float edge = 1.0 - smoothstep(cut, cut + 0.24, vSlS.x);",
          "  float dry = clamp((max(vSlF.w, 0.1) - 0.1) / 0.9 + uSiltAge / " + DRY + ", 0.0, 1.0);",
          "  slGloss = 0.0;",
          "  vec4 rs = cbzFloodResidue(vSlW.xz, clamp(vSlS.y, 0.0, 1.0), dry, edge, vSlF.xy, slGloss);",
          "  diffuseColor.rgb = rs.rgb;",
          "  diffuseColor.a = rs.a * sk;",
          "  if (diffuseColor.a < 0.01) discard;",
          "}"].join("\n"))
        .replace("#include <envmap_fragment>", ["#include <envmap_fragment>",
          "{",
          // wet mud shines: a tight sun glint and a little (brown) sky at grazing
          "  vec3 sV = normalize(cameraPosition - vSlW);",
          "  vec3 sN = normalize(vSlN);",
          "  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(sN, sV), 0.0), 5.0);",
          "  float sp = pow(max(dot(sN, normalize(uSlSun + sV)), 0.0), mix(60.0, 300.0, slGloss));",
          "  outgoingLight = mix(outgoingLight, uSlSky * vec3(0.55, 0.52, 0.46), clamp(fr * slGloss * 0.45, 0.0, 0.4));",
          "  outgoingLight += uSlSunC * sp * slGloss * 0.7;",
          "}"].join("\n"));
    };
    m.customProgramCacheKey = function () { return "flashflood-silt"; };
    m.userData.siltU = U;
    return m;
  }

  function buildRender() {
    const g = F.grid, n = g.n, N2 = n * n;
    const R = F.render = { parent: F.parent };
    const geo = new THREE.BufferGeometry();
    // position stays float; the normal and the flow ride as normalised bytes
    const pos = new Float32Array(N2 * 3), nor = new Int8Array(N2 * 3), flow = new Uint8Array(N2 * 4), wall = new Float32Array(N2);
    for (let k = 0; k < N2; k++) {
      pos[k * 3] = cellX(g, k % n); pos[k * 3 + 1] = g.zb[k] - 3; pos[k * 3 + 2] = cellZ(g, (k / n) | 0);
      nor[k * 3 + 1] = 127;
      flow[k * 4] = 128; flow[k * 4 + 1] = 128;
      wall[k] = Math.max(-g.c, Math.min(g.c, g.wall[k]));
    }
    const idx = new (N2 > 65535 ? Uint32Array : Uint16Array)((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const aP = new THREE.BufferAttribute(pos, 3), aN = new THREE.BufferAttribute(nor, 3, true), aF = new THREE.BufferAttribute(flow, 4, true);
    aP.setUsage(THREE.DynamicDrawUsage); aN.setUsage(THREE.DynamicDrawUsage); aF.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", aP); geo.setAttribute("normal", aN); geo.setAttribute("aFlow", aF);
    geo.setAttribute("aWall", new THREE.BufferAttribute(wall, 1));
    const aS = new THREE.BufferAttribute(new Uint8Array(N2), 1, true); aS.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aShow", aS);
    // water: sqrt(depth / 2 m); silt: how thick the film is
    const aD = new THREE.BufferAttribute(new Uint8Array(N2), 1, true); aD.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aDepth", aD);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = floodMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "flashflood-surface";
    mesh.frustumCulled = false;
    mesh.userData.noCoat = true; mesh.userData.transient = true; mesh.userData.floodField = true;
    mesh.receiveShadow = false; mesh.castShadow = false;
    R.parent.add(mesh);
    R.mesh = mesh; R.ys = new Float32Array(N2); R.drawn = new Uint8Array(N2);
    // THE SILT: the same sheet, drawn a second time by a lit, blended film
    // material (the scene's own light, like the ground under it) that only
    // shows where the water has gone. Shares every byte of the upload.
    const sm = new THREE.Mesh(geo, siltMaterial(mat));
    sm.name = "flashflood-silt";
    sm.frustumCulled = false; sm.receiveShadow = true; sm.castShadow = false;
    sm.userData.noCoat = true; sm.userData.transient = true;
    R.parent.add(sm);
    R.silt = sm;
    // ---- the rooms: one quad per ground floor at the room's own level ----
    const B = F.W.buildings || [];
    if (B.length) {
      const rg = new THREE.BufferGeometry();
      const rp = new Float32Array(B.length * 12), rn = new Float32Array(B.length * 12), rf = new Uint8Array(B.length * 16), rw = new Float32Array(B.length * 4).fill(1);
      for (let v = 0; v < B.length * 4; v++) { rf[v * 4] = 128; rf[v * 4 + 1] = 128; }
      const ri = new Uint16Array(B.length * 6);
      for (let b = 0; b < B.length; b++) {
        const bd = B[b], hx = bd.w / 2 - 0.22, hz = bd.d / 2 - 0.22;
        const cs = [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]];
        for (let v = 0; v < 4; v++) { rp[b * 12 + v * 3] = bd.x + cs[v][0]; rp[b * 12 + v * 3 + 1] = -1e4; rp[b * 12 + v * 3 + 2] = bd.z + cs[v][1]; rn[b * 12 + v * 3 + 1] = 1; }
        const a = b * 4; ri.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], b * 6);
      }
      const rP = new THREE.BufferAttribute(rp, 3); rP.setUsage(THREE.DynamicDrawUsage);
      rg.setAttribute("position", rP); rg.setAttribute("normal", new THREE.BufferAttribute(rn, 3));
      rg.setAttribute("aFlow", new THREE.BufferAttribute(rf, 4, true)); rg.setAttribute("aWall", new THREE.BufferAttribute(rw, 1));
      rg.setAttribute("aShow", new THREE.BufferAttribute(new Uint8Array(B.length * 4).fill(255), 1, true));
      rg.setAttribute("aDepth", new THREE.BufferAttribute(new Uint8Array(B.length * 4).fill(255), 1, true));
      rg.setIndex(new THREE.BufferAttribute(ri, 1));
      const rm = new THREE.Mesh(rg, mat);
      rm.name = "flashflood-rooms"; rm.frustumCulled = false; rm.userData.noCoat = true; rm.userData.transient = true;
      R.parent.add(rm); R.rooms = rm;
    }
    buildSpray(R); buildDebrisMeshes(R); buildLids(R);
  }

  function buildSpray(R) {
    const pos = new Float32Array(N_SPRAY * 3), col = new Float32Array(N_SPRAY * 3);
    R.spray = [];
    for (let i = 0; i < N_SPRAY; i++) {
      const foam = i % 2 === 0;
      // dirty spray: tan-grey froth and brown droplets (0.8 linear was paper white)
      col[i * 3] = foam ? 0.46 : 0.22; col[i * 3 + 1] = foam ? 0.42 : 0.17; col[i * 3 + 2] = foam ? 0.35 : 0.11;
      pos[i * 3 + 1] = -1e4;
      R.spray.push({ x: 0, y: -1e4, z: 0, vx: 0, vy: 0, vz: 0, kill: 0, dead: true });
    }
    const g = new THREE.BufferGeometry();
    const a = new THREE.BufferAttribute(pos, 3); a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", a); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
    m.frustumCulled = false; m.renderOrder = 3; m.userData.transient = true; m.userData.noCoat = true;
    R.parent.add(m); R.sprayMesh = m;
  }
  function burst(x, y, z, count, up, spread) {
    const R = F.render; if (!R) return;
    let n = 0;
    for (let i = 0; i < R.spray.length && n < count; i++) {
      const p = R.spray[i]; if (!p.dead) continue;
      p.x = x + (rnd() - 0.5) * spread; p.z = z + (rnd() - 0.5) * spread; p.y = y + rnd() * 0.3;
      p.vx = (rnd() - 0.5) * 3; p.vz = (rnd() - 0.5) * 3; p.vy = up * (0.5 + rnd() * 0.7);
      p.kill = y - 0.4; p.dead = false; n++;
    }
    F.stats.sprayLaunched = (F.stats.sprayLaunched || 0) + n;
  }

  function buildDebrisMeshes(R) {
    // boards, snapped branches, tyres, and LOGS: real flotsam shapes
    const plank = new THREE.BoxGeometry(2.2, 0.05, 0.22);
    const br = new THREE.CylinderGeometry(0.04, 0.1, 2.3, 6, 1).toNonIndexed(); br.rotateZ(Math.PI / 2);
    const tw = new THREE.CylinderGeometry(0.018, 0.035, 0.9, 5, 1).toNonIndexed(); tw.rotateZ(Math.PI / 2 - 0.6); tw.translate(0.35, 0.28, 0);
    const branch = new THREE.BufferGeometry();
    for (const k of ["position", "normal", "uv"]) {
      const A = br.attributes[k], B = tw.attributes[k];
      const arr = new Float32Array(A.array.length + B.array.length); arr.set(A.array, 0); arr.set(B.array, A.array.length);
      branch.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
    }
    br.dispose(); tw.dispose();
    const tyre = new THREE.TorusGeometry(0.31, 0.11, 7, 16);
    // a log: a tapered trunk with two broken limb stubs, unit length on +z
    const trunk = new THREE.CylinderGeometry(0.17, 0.24, 1, 8, 1).toNonIndexed(); trunk.rotateX(Math.PI / 2);
    const stub = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5, 1).toNonIndexed(); stub.rotateZ(1.0); stub.translate(0.2, 0.15, 0.15);
    const log = new THREE.BufferGeometry();
    for (const k of ["position", "normal", "uv"]) {
      const A = trunk.attributes[k], B = stub.attributes[k];
      const arr = new Float32Array(A.array.length + B.array.length); arr.set(A.array, 0); arr.set(B.array, A.array.length);
      log.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
    }
    trunk.dispose(); stub.dispose();
    const kit = [
      [plank, 0x86684a], [branch, 0x4b3a2a], [tyre, 0x1f1f20], [log, 0x5a4532],
    ];
    R.debris = kit.map(function (K, i) {
      const im = new THREE.InstancedMesh(K[0], new THREE.MeshLambertMaterial({ color: K[1] }), Math.max(1, F.debrisPer[i]));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.castShadow = true; im.userData.transient = true; im.userData.noCoat = true;
      R.parent.add(im);
      return im;
    });
    R.dummy = new THREE.Object3D();
  }

  function buildLids(R) {
    const holes = F.sewer ? F.sewer.holes : [];
    const own = holes.filter(function (m) { return !m.mesh; });
    if (!own.length) return;
    // a cast-iron lid: a ribbed disc, flush with the road
    const geo = new THREE.CylinderGeometry(0.33, 0.33, 0.045, 18, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x2a2826 }), own.length);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.userData.transient = true; im.userData.noCoat = true;
    own.forEach(function (m, i) { m.slot = i; m.ly = m.y + 0.03; });
    R.parent.add(im); R.lids = im; R.lidList = own;
    updateLids(0);
  }
  function updateLids(dt) {
    const R = F.render; if (!R || !R.lids) return;
    const d = R.dummy || (R.dummy = new THREE.Object3D());
    for (const m of R.lidList) {
      if (m.flying) {
        m.vy -= G * dt; m.lx += m.vx * dt; m.ly += m.vy * dt; m.lz += m.vz * dt; m.rx += 7 * dt; m.rz += 4 * dt;
        const gy = sample(m.lx, m.lz, _ds);
        const floor = (gy.d > 0.1 ? gy.eta - 0.02 : gy.bed + 0.03);
        if (m.ly < floor && m.vy < 0) { m.ly = floor; m.flying = false; m.rx = 0; m.rz = 0.0; if (CBZ.sfxAt) CBZ.sfxAt("collapse", m.lx, m.lz, { volume: 0.15 }); }
      }
      d.position.set(m.lx, m.ly, m.lz);
      d.rotation.set(m.rx, 0, m.rz);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      R.lids.setMatrixAt(m.slot, d.matrix);
    }
    R.lids.instanceMatrix.needsUpdate = true;
  }

  // the surface mesh: rows of the wet box (plus a margin) every frame
  function updateSurface(full) {
    const R = F.render; if (!R || !R.mesh) return;
    const g = F.grid, n = g.n, bb = g.bb, ys = R.ys, drawn = R.drawn;
    const geo = R.mesh.geometry;
    const P = geo.attributes.position.array, Nn = geo.attributes.normal.array, Fl = geo.attributes.aFlow.array, Sh = geo.attributes.aShow.array, Dp = geo.attributes.aDepth.array;
    let j0, j1, i0, i1;
    if (full) { j0 = 0; j1 = n - 1; i0 = 0; i1 = n - 1; }
    else {
      if (!R.box) R.box = { i0: n, i1: -1, j0: n, j1: -1 };
      // everything that was drawn last frame or is wet this frame
      i0 = Math.max(0, Math.min(R.box.i0, bb.i0) - 2); i1 = Math.min(n - 1, Math.max(R.box.i1, bb.i1) + 2);
      j0 = Math.max(0, Math.min(R.box.j0, bb.j0) - 2); j1 = Math.min(n - 1, Math.max(R.box.j1, bb.j1) + 2);
      if (bb.i1 < bb.i0 && R.box.i1 < R.box.i0) return;
      if (i1 < i0 || j1 < j0) return;
    }
    const h = g.h, zb = g.zb, room = g.room, ocean = g.ocean, siltK = g.siltK;
    // pass 1: heights
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      let y, d = 0;
      const wet = h[k] > g.drawH[k] && !ocean[k];
      if (wet && !room[k]) { y = zb[k] + h[k]; d = 1; }
      else {
        // the wet neighbours' level, OUTSIDE rooms (the street's sheet runs
        // flat to the wall line and is cut there by aWall)
        let s = 0, w = 0, sn = 0;
        for (let b = 0; b < 8; b++) {
          const di = b < 3 ? b - 1 : b === 3 ? -1 : b === 4 ? 1 : b - 6;
          const dj = b < 3 ? -1 : b < 5 ? 0 : 1;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const kk = jj * n + ii;
          if (h[kk] > g.drawH[kk] && !ocean[kk] && !room[kk]) { s += zb[kk] + h[kk]; w++; }
          else if (siltK[kk] > 0) sn++;
        }
        if (room[k] && w) { y = s / w; d = 2; }
        else if (w) {
          // a bank (ground above the level): run flat into it so the terrain
          // cuts the true shoreline; a front on a downslope: down to the ground
          y = Math.min(s / w, zb[k] - 0.05); d = 2;
        } else if (ocean[k]) { y = F.seaY - 0.08; d = 0; }
        else if (siltK[k] > 0) { y = zb[k] + 0.045; d = 3; }
        else if (sn && !room[k]) { y = zb[k] + 0.045; d = 0; }
        else { y = zb[k] - 3; d = 0; }
      }
      ys[k] = y; drawn[k] = d;
    }
    // pass 2: normals, flow, foam, silt
    let ni0 = n, ni1 = -1, nj0 = n, nj1 = -1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      const y = ys[k];
      P[k * 3 + 1] = y;
      const yl = i > i0 ? ys[k - 1] : y, yr = i < i1 ? ys[k + 1] : y;
      const yd = j > j0 ? ys[k - n] : y, yu = j < j1 ? ys[k + n] : y;
      let gx = (yr - yl) / (2 * g.c), gz = (yu - yd) / (2 * g.c);
      if (gx > 3) gx = 3; else if (gx < -3) gx = -3;
      if (gz > 3) gz = 3; else if (gz < -3) gz = -3;
      const il = 127 / Math.sqrt(gx * gx + 1 + gz * gz);
      Nn[k * 3] = Math.round(-gx * il); Nn[k * 3 + 1] = Math.round(il); Nn[k * 3 + 2] = Math.round(-gz * il);
      const dk = drawn[k];
      Sh[k] = dk ? 255 : 0;
      if (dk) { if (i < ni0) ni0 = i; if (i > ni1) ni1 = i; if (j < nj0) nj0 = j; if (j > nj1) nj1 = j; }
      if (dk === 1) {
        const sp = Math.hypot(g.ux[k], g.uz[k]);
        // foam: the leading churn band, steep faces, the bridge jam, the spouts
        let foam = g.wetT[k] < 2.2 && h[k] > 0.1 ? (1 - g.wetT[k] / 2.2) * Math.min(1, sp / 2) : 0;
        const steep = Math.min(1, Math.hypot(gx, gz) * 2.2);
        if (steep * Math.min(1, sp / 3) > foam) foam = steep * Math.min(1, sp / 3);
        if (g.bridgeOf[k] && F.bridges[g.bridgeOf[k] - 1].block > 0.15) foam = Math.max(foam, 0.8);
        // water driven against a wall piles up and breaks on it: the froth
        // hugs the facade and the corners, not the open street
        const wd = g.wall[k];
        if (wd > 0 && wd < g.c * 1.5 && sp > 0.5) { const fw = (1 - wd / (g.c * 1.5)) * Math.min(1, sp / 2.5) * 0.85; if (fw > foam) foam = fw; }
        Fl[k * 4] = clamp(Math.round((g.ux[k] / 20 + 0.5) * 255), 0, 255);
        Fl[k * 4 + 1] = clamp(Math.round((g.uz[k] / 20 + 0.5) * 255), 0, 255);
        Fl[k * 4 + 2] = Math.round(foam * 255); Fl[k * 4 + 3] = 0;
        // depth, sqrt over 2 m: fine at the shallow margin where it matters
        Dp[k] = Math.round(Math.sqrt(Math.min(1, h[k] / 2)) * 255);
      } else if (dk === 3) {
        // the film: combed the way the last of the water ran, and its thickness
        Fl[k * 4] = clamp(Math.round((g.combX[k] / 20 + 0.5) * 255), 0, 255);
        Fl[k * 4 + 1] = clamp(Math.round((g.combZ[k] / 20 + 0.5) * 255), 0, 255);
        Fl[k * 4 + 2] = 0; Fl[k * 4 + 3] = Math.round((0.1 + 0.9 * siltK[k]) * 255);   // 0.1.. so a fresh film is fully a film
        Dp[k] = Math.round(g.siltTh[k] * 255);
      } else {
        Fl[k * 4] = 128; Fl[k * 4 + 1] = 128; Fl[k * 4 + 2] = 0;
        Fl[k * 4 + 3] = dk === 2 && siltK[k] > 0 ? 77 : 0;
        Dp[k] = 0;
      }
    }
    if (!R.box) R.box = { i0: n, i1: -1, j0: n, j1: -1 };
    R.box.i0 = ni0; R.box.i1 = ni1; R.box.j0 = nj0; R.box.j1 = nj1;
    const P3 = geo.attributes.position, N3 = geo.attributes.normal, F4 = geo.attributes.aFlow, S1 = geo.attributes.aShow, D1 = geo.attributes.aDepth;
    const off = j0 * n, cnt = (j1 - j0 + 1) * n;
    P3.updateRange.offset = off * 3; P3.updateRange.count = cnt * 3; P3.needsUpdate = true;
    N3.updateRange.offset = off * 3; N3.updateRange.count = cnt * 3; N3.needsUpdate = true;
    F4.updateRange.offset = off * 4; F4.updateRange.count = cnt * 4; F4.needsUpdate = true;
    S1.updateRange.offset = off; S1.updateRange.count = cnt; S1.needsUpdate = true;
    D1.updateRange.offset = off; D1.updateRange.count = cnt; D1.needsUpdate = true;
    R.uploadBytes = cnt * 21;
    // the room sheets
    if (R.rooms) {
      const B = F.W.buildings, rp = R.rooms.geometry.attributes.position;
      for (let b = 0; b < B.length; b++) {
        const k = cellOf(g, B[b].x, B[b].z);
        const y = k >= 0 && room[k] === b + 1 && h[k] > H_DRAW ? zb[k] + h[k] : -1e4;
        for (let v = 0; v < 4; v++) rp.array[b * 12 + v * 3 + 1] = y;
      }
      rp.needsUpdate = true;
    }
  }

  function steepAt(g, i, j) {
    const n = g.n, k = j * n + i;
    const gx = (g.zb[k + (i < n - 1 ? 1 : 0)] - g.zb[k - (i > 0 ? 1 : 0)]) / (2 * g.c);
    const gz = (g.zb[k + (j < n - 1 ? n : 0)] - g.zb[k - (j > 0 ? n : 0)]) / (2 * g.c);
    return Math.hypot(gx, gz);
  }
  /* silt: a cell that held water and is now dry wears a film that dries
     out. siltK is its drying clock (0.02 the moment the water leaves, +1 per
     DRY_SECS, the shader adds the time since the flood ended); siltTh is
     how much settled there: deep water, and water that stood a long time
     (the hollows, the slack behind a wall) leave the most. It was a 22 s
     clock with no thickness at all: one wet tint that was "dry" before the
     round's card had gone. */
  const DRY_SECS = (CBZ.floodResidueDrySecs || 150);
  const SILT_MIN_H = 0.06;            // m of peak water that leaves a film (what was drawn as water)
  function siltThick(g, k, i, j) {
    const flat = 1 - Math.min(1, steepAt(g, i, j) / 0.14) * 0.55;
    return clamp((0.10 + 0.45 * Math.min(1, g.hmax[k] / 1.0) + 0.45 * Math.min(1, g.wetSum[k] / 40)) * flat, 0, 1);
  }
  function updateSilt(dt) {
    const g = F.grid, n = g.n, bb = g.bb;
    const R = F.render;
    const box = R && R.box && R.box.i1 >= R.box.i0 ? R.box : bb;
    if (box.i1 < box.i0) return;
    for (let j = box.j0; j <= box.j1; j++) for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (g.hmax[k] < SILT_MIN_H || g.room[k] || g.ocean[k]) continue;
      if (g.h[k] > H_DRAW) { g.siltK[k] = 0; continue; }
      if (g.siltK[k] <= 0 && steepAt(g, i, j) > 0.14) continue;   // mud does not settle on a slope
      if (g.siltK[k] <= 0) { g.siltK[k] = 0.02; g.siltTh[k] = siltThick(g, k, i, j); }
      else g.siltK[k] = Math.min(1, g.siltK[k] + dt / DRY_SECS);
    }
  }

  function updateSpray(dt) {
    const R = F.render; if (!R || !R.sprayMesh) return;
    const g = F.grid, n = g.n;
    const arr = R.sprayMesh.geometry.attributes.position.array;
    const fp = F.front.pts;
    let budget = 40;
    // sources: the front, the manhole spouts
    const holes = F.sewer ? F.sewer.holes : [];
    for (let i = 0; i < R.spray.length; i++) {
      const p = R.spray[i];
      if (p.dead) {
        if (budget <= 0) continue;
        let spawned = false;
        if (holes.length && rnd() < 0.35) {
          const m = holes[(rnd() * holes.length) | 0];
          if (m.spout > 0 && m.rate > 0.02) {
            const s = sample(m.x, m.z, _ds);
            const base = s.d > 0 ? s.eta : m.y;
            p.x = m.x + (rnd() - 0.5) * 0.3; p.z = m.z + (rnd() - 0.5) * 0.3; p.y = base;
            const head = Math.min(1.6, 0.4 + m.rate * 0.9);
            p.vy = Math.sqrt(2 * G * head) * (0.8 + rnd() * 0.3); p.vx = (rnd() - 0.5) * 1.2; p.vz = (rnd() - 0.5) * 1.2;
            p.kill = base - 0.1; p.dead = false; spawned = true;
          }
        }
        if (!spawned && fp.length) {
          const k = fp[(rnd() * fp.length) | 0];
          const x = cellX(g, k % n) + (rnd() - 0.5) * g.c, z = cellZ(g, (k / n) | 0) + (rnd() - 0.5) * g.c;
          const eta = g.zb[k] + g.h[k];
          const ux = g.ux[k], uz = g.uz[k], sp = Math.hypot(ux, uz);
          p.x = x; p.z = z; p.y = eta - 0.05;
          p.vx = ux * (0.7 + rnd() * 0.5) + (rnd() - 0.5) * 1.5; p.vz = uz * (0.7 + rnd() * 0.5) + (rnd() - 0.5) * 1.5;
          p.vy = 0.8 + rnd() * 1.4 + sp * 0.25;
          p.kill = eta - 0.3; p.dead = false; spawned = true;
        }
        if (spawned) { budget--; F.stats.sprayLaunched = (F.stats.sprayLaunched || 0) + 1; }
      } else {
        p.vy -= G * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < p.kill && p.vy < 0) { p.dead = true; p.y = -1e4; }
      }
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    R.sprayMesh.geometry.attributes.position.needsUpdate = true;
  }

  function updateDebrisMeshes() {
    const R = F.render; if (!R || !R.debris) return;
    const d = R.dummy;
    for (const p of F.debris) {
      const im = R.debris[p.kind];
      if (p.state === "seed") {
        // lying where the flood will find it
        d.position.set(p.x, p.y + (p.kind === 3 ? 0.2 : 0.05), p.z);
        d.rotation.set(p.kind === 2 ? Math.PI / 2 : 0, p.yaw, 0);
      } else if (p.state === "stranded") {
        d.position.set(p.x, p.y + (p.kind === 3 ? 0.2 : p.kind === 2 ? 0.11 : 0.04), p.z);
        d.rotation.set(p.kind === 2 ? Math.PI / 2 : 0, p.yaw, 0);
      } else {
        d.position.set(p.x, p.y, p.z);
        d.rotation.set(p.kind === 3 ? Math.sin(p.rx) * 0.08 : p.rx, p.yaw, p.kind === 3 ? 0 : p.rx * 0.4);
      }
      if (p.kind === 3) d.scale.set(1, 1, p.len); else d.scale.setScalar(p.s);
      d.updateMatrix();
      im.setMatrixAt(p.slot, d.matrix);
    }
    for (const im of R.debris) im.instanceMatrix.needsUpdate = true;
  }

  /* the HIGH-WATER LINE: on every wall the flood stood against, a crisp
     dark tide line at the highest level it reached, a scum band under it
     and a mottled mud film below (world/water_spec.js cbzWaterline, the
     tsunami's too), dark while wet and paling as it dries on the silt's
     clock. One mesh: per vertex, the metres it lies under the line. It was
     a flat 7 cm brown strip over a 0.38-alpha brown box. Built once, near
     the end; the water in front of it hides it until the level drops. */
  function buildMarks() {
    const R = F.render; if (!R || R.marks || !THREE) return;
    const g = F.grid, B = F.W.buildings || [];
    const P = [], Bv = [];
    for (const bd of B) {
      // the street's peak level along each side of the footprint
      const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const s of sides) {
        const hx = bd.w / 2, hz = bd.d / 2;
        const ox = bd.x + s[0] * (hx + g.c * 0.6), oz = bd.z + s[1] * (hz + g.c * 0.6);
        const k = cellOf(g, ox, oz);
        if (k < 0 || g.hmax[k] < 0.15 || g.room[k]) continue;
        const top = g.etaMax[k], foot = g.zb[k] - 0.05;
        const L = s[0] === 0 ? bd.w : bd.d;
        const cxs = bd.x + s[0] * (hx + 0.03), czs = bd.z + s[1] * (hz + 0.03);
        const tx = s[0] === 0 ? 1 : 0, tz = s[0] === 0 ? 0 : 1;
        const ax = cxs - tx * L / 2, az = czs - tz * L / 2, bx = cxs + tx * L / 2, bz = czs + tz * L / 2;
        const y1 = top + 0.07;
        P.push(ax, foot, az, bx, foot, bz, ax, y1, az, bx, foot, bz, bx, y1, bz, ax, y1, az);
        const b0 = top - foot, b1 = top - y1;
        Bv.push(b0, b0, b1, b0, b1, b1);
      }
    }
    if (!P.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute("aBelow", new THREE.BufferAttribute(new Float32Array(Bv), 1));
    geo.computeVertexNormals();
    const SU = R.silt && R.silt.material.userData.siltU;
    const uAge = SU ? SU.uSiltAge : { value: 0 };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.name = "flashflood-highwater";
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    const GL = CBZ.floodResidueGLSL ? CBZ.floodResidueGLSL() : "";
    const DRY = (CBZ.floodResidueDrySecs || 150).toFixed(1);
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uSiltAge = uAge;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aBelow;\nvarying float vHwB;\nvarying vec3 vHwP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHwB = aBelow;\nvHwP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSiltAge;\nvarying float vHwB;\nvarying vec3 vHwP;\n" + GL)
        .replace("#include <color_fragment>", ["#include <color_fragment>",
          "{",
          "  float wet = 1.0 - clamp(uSiltAge / (" + DRY + " * 0.8), 0.0, 1.0);",
          "  vec4 wl = cbzWaterline(vHwB, vHwP.x + vHwP.z, vHwP.y, wet);",
          "  if (wl.a < 0.01) discard;",
          "  diffuseColor.rgb = wl.rgb;",
          "  diffuseColor.a = wl.a;",
          "}"].join("\n"));
    };
    mat.customProgramCacheKey = function () { return "flashflood-highwater"; };
    const m = new THREE.Mesh(geo, mat);
    m.name = "flashflood-highwater";
    m.userData.transient = true; m.userData.noCoat = true; m.frustumCulled = false;
    R.parent.add(m);
    R.marks = [m];
    F.stats.marks = P.length / 18;
  }

  let roarCd = 0;
  function roar(dt) {
    roarCd -= dt;
    if (roarCd > 0 || !CBZ.sfxAt || !CBZ.camera) return;
    roarCd = 0.55;
    const fp = F.front.pts, g = F.grid, n = g.n;
    if (!fp.length) return;
    const cp = CBZ.camera.position;
    let best = -1, bd = 1e18;
    for (let t = 0; t < fp.length; t += 3) {
      const k = fp[t], dx = cellX(g, k % n) - cp.x, dz = cellZ(g, (k / n) | 0) - cp.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) CBZ.sfxAt("water", cellX(g, best % n), cellZ(g, (best / n) | 0), { volume: 0.9 });
  }

  /* ---- the per-frame tick (driven by the def) ---------------------------- */
  function tick(dt) {
    if (!F) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    const t0 = performance.now();
    if (!F.ready) {
      // the bed, sliced: ~2.5k ground samples a frame
      if (buildSlice(F.W, F.grid, 2500)) finishSetup();
      F.t += dt;
      return;
    }
    F.t += dt;
    // substeps by the CFL limit of the deepest live water
    const g = F.grid;
    const cmax = Math.sqrt(G * Math.max(0.5, F.hLive)) + 6;
    const sub = Math.max(1, Math.ceil(dt / (0.7 * g.c / cmax)));
    const h = dt / sub;
    const ts = performance.now();
    for (let s = 0; s < sub; s++) { stepBridges(h); stepGrid(h); }
    const tb = performance.now();
    measure(dt);
    stepCars(dt); stepDebris(dt);
    const tr = performance.now();
    if (F.render) {
      const mu = F.render.mesh && F.render.mesh.material.userData.waterUniforms;
      if (mu && CBZ.waterDriveCommonUniforms) CBZ.waterDriveCommonUniforms(mu);
      updateSilt(dt);
      updateSurface(false);
      updateSpray(dt);
      updateDebrisMeshes();
      updateLids(dt);
      roar(dt);
      const u = (F.t - F.warnSecs) / F.activeSecs;
      if (u > 0.9 && !F.render.marks) buildMarks();
    } else updateSiltNoRender(dt);
    const te = performance.now();
    const S = F.stats;
    S.solveMs += tb - ts; S.bodyMs += tr - tb; S.renderMs += te - tr; S.frames++;
    const fm = te - t0;
    if (fm > S.worstFrameMs) S.worstFrameMs = fm;
    S.lastFrameMs = fm; S.substeps = sub;
  }
  function updateSiltNoRender(dt) { updateSilt(dt); }

  function disposeObj(o) {
    if (!o) return;
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material.dispose) o.material.dispose();
  }
  function disposeSilt() {
    if (!silt) return;
    for (const o of silt.objs) disposeObj(o);
    if (silt.waterMat && silt.waterMat.dispose) silt.waterMat.dispose();
    silt = null;
  }

  /* THE AFTERMATH. clear({keepSilt}) at the horn does not snap the water
     off: the flood keeps running for a few seconds with the inflow gone and
     the drains open, so the streets visibly empty, the debris and the cars
     settle where the water leaves them, and the mud shows. Then it freezes
     into the silt film, the tide marks and the wrecks. Its own frame hook,
     because the def that drove it has ended. */
  // s the water takes to go down after the horn: most of the calm (the
  // director's calm is 12-20 s and waits on busy() for the rest)
  const AFTER_SECS = 16;
  let afterHooked = false;
  function hookAfter() { if (!afterHooked && CBZ.onAlways) { afterHooked = true; CBZ.onAlways(48, afterTick); } }
  function afterTick(dt) {
    // the film the last flood left goes on drying, for the rest of the match
    if (silt && silt.U && !F) {
      silt.age += Math.min(0.25, Math.max(0, dt || 0));
      silt.U.uSiltAge.value = silt.age;
      if ((silt.lightT -= dt || 0) <= 0 && silt.WU && CBZ.waterDriveCommonUniforms) { silt.lightT = 0.5; try { CBZ.waterDriveCommonUniforms(silt.WU); } catch (e) {} }
    }
    if (!F || !F.ending) return;
    F.after += Math.min(0.1, dt || 0);
    tick(dt);
    let v = 0;
    const g = F.grid;
    if (F.after > 1) for (let k = 0; k < g.h.length; k += 7) if (!g.ocean[k]) v += g.h[k];
    if (F.after >= AFTER_SECS || (F.after > 1 && v * 7 * g.c * g.c < 2)) finish({ keepSilt: true });
  }
  function clear(o) {
    o = o || {};
    if (!F) return;
    if (o.keepSilt && F.render && F.ready && !F.ending && !o.now) {
      F.ending = true; F.after = 0;
      hookAfter();
      event("flood", "the storm is spent: draining");
      return;
    }
    finish(o);
  }
  function finish(o) {
    o = o || {};
    if (!F) return;
    if (CBZ.groundWaterFieldSet && CBZ.groundWaterField && CBZ.groundWaterField() === FIELD) CBZ.groundWaterFieldSet(null);
    const R = F.render;
    if (R) {
      if (o.keepSilt && R.mesh) {
        // the water is gone: what it carried comes to rest where it was
        for (const cb of F.cars) if (cb.floating || cb.moving) {
          cb.floating = cb.moving = false; cb.vx = cb.vz = 0;
          cb.y = bedAt(cb.x, cb.z) + cb.lift;
          if (cb.car.group) { cb.car.group.position.set(cb.x, cb.y, cb.z); cb.car.group.rotation.set(0, cb.yaw, 0.04); }
          cb.state = cb.moved > 2 ? "stranded" : "stalled";
          settleCar(cb);
        }
        for (const p of F.debris) if (p.state === "afloat" || p.state === "jammed") { p.state = "stranded"; p.y = bedAt(p.x, p.z); }
        // ...and everything still wet becomes mud where it stood
        const g = F.grid;
        for (let k = 0; k < g.h.length; k++) if (g.h[k] > H_SHOW && !g.ocean[k]) {
          const i = k % g.n, j = (k / g.n) | 0;
          if (g.hmax[k] >= SILT_MIN_H && !g.room[k] && steepAt(g, i, j) <= 0.14) { g.siltK[k] = 0.02; g.siltTh[k] = Math.max(g.siltTh[k], siltThick(g, k, i, j)); }
          g.h[k] = 0;
        }
        g.bb.i0 = 0; g.bb.i1 = g.n - 1; g.bb.j0 = 0; g.bb.j1 = g.n - 1;
        F.ready = true;
        updateSurface(true);
        buildMarks();
        // the water sheet has nothing left to draw: drop it (its geometry
        // is the silt's, so only its material goes) and keep the film
        if (R.mesh.parent) R.mesh.parent.remove(R.mesh);
        const WU = R.mesh.material && R.mesh.material.userData && R.mesh.material.userData.waterUniforms;
        const keep = (R.silt ? [R.silt] : []).concat(R.marks || []);
        // stranded debris stays where it lies
        if (R.debris) { updateDebrisMeshes(); for (const im of R.debris) keep.push(im); }
        if (R.lids) keep.push(R.lids);
        silt = { objs: keep, U: R.silt ? R.silt.material.userData.siltU : null, WU: WU, age: 0, lightT: 0, waterMat: R.mesh.material };
        hookAfter();
        disposeObj(R.sprayMesh);
        // the room sheets share the water material: take them without it
        if (R.rooms) { if (R.rooms.parent) R.rooms.parent.remove(R.rooms); R.rooms.geometry.dispose(); }
      } else {
        for (const k of ["mesh", "silt", "sprayMesh", "rooms", "lids"]) disposeObj(R[k]);
        if (R.debris) R.debris.forEach(disposeObj);
        if (R.marks) R.marks.forEach(disposeObj);
      }
    }
    lastStats = null;
    try { lastStats = stats(); } catch (e) { lastStats = Object.assign({}, F.stats); }
    lastEvents = F.events;
    F = null;
  }
  let lastStats = null, lastEvents = null;

  function frontPoints(max) {
    const out = [];
    if (!F || !F.ready) return out;
    const g = F.grid, n = g.n, fp = F.front.pts;
    const step = Math.max(1, Math.floor(fp.length / (max || 6)));
    for (let t = 0; t < fp.length && out.length < (max || 6); t += step) out.push({ x: cellX(g, fp[t] % n), z: cellZ(g, (fp[t] / n) | 0) });
    return out;
  }
  function threatAt(x, z) {
    if (!F || !F.ready) return 0;
    const s = sample(x, z, _s);
    if (s.d > 0.05) return clamp(0.4 + s.d * 0.3 + Math.hypot(s.ux, s.uz) * 0.05, 0, 1);
    return 0;
  }

  function stats() {
    if (!F) return lastStats;
    const S = F.stats;
    const fr = Math.max(1, S.frames);
    const out = Object.assign({}, S, {
      t: F ? +F.t.toFixed(2) : null,
      frontSpeedMean: S.frontSpeedT ? +(S.frontSpeedSum / S.frontSpeedT).toFixed(2) : 0,
      solveMsPerFrame: +(S.solveMs / fr).toFixed(3), bodyMsPerFrame: +(S.bodyMs / fr).toFixed(3), renderMsPerFrame: +(S.renderMs / fr).toFixed(3),
      frameMs: +((S.solveMs + S.bodyMs + S.renderMs) / fr).toFixed(3),
    });
    if (F) {
      const g = F.grid;
      out.grid = g.n + "x" + g.n + "@" + g.c.toFixed(2) + "m";
      out.volumeIn = Math.round(F.vIn); out.volumeToSea = Math.round(F.vSea); out.volumeSoaked = Math.round(F.vSoak);
      let v = 0; for (let k = 0; k < g.h.length; k++) if (!g.ocean[k]) v += g.h[k];
      out.volumeStanding = Math.round(v * g.c * g.c);
      let sc = 0; for (let k = 0; k < g.siltK.length; k++) if (g.siltK[k] > 0) sc++;
      out.siltArea = Math.round(sc * g.c * g.c);
      out.bridges = F.bridges.map(function (b) { return { state: b.state, jamPieces: b.jamN, maxBlock: +b.maxBlock.toFixed(2), peakLoadKN: Math.round(b.peakLoad / 1000), capKN: Math.round((b.capN || 0) / 1000), overtopped: !!b.overtopped, failT: b.failT != null ? +b.failT.toFixed(2) : null, headM: +(b.etaUp - b.etaDn).toFixed(2) }; });
      out.cars = F.cars.map(function (c) { return { state: c.state, stalled: c.stalled, floated: !!c.everFloat, swept: c.swept, movedM: +c.moved.toFixed(1), maxDepth: +c.maxD.toFixed(2), jammed: !!c.jammed }; });
      const dc = { seed: 0, afloat: 0, stranded: 0, jammed: 0, logsJammed: 0 };
      for (const p of F.debris) { dc[p.state]++; if (p.state === "jammed" && p.kind === 3) dc.logsJammed++; }
      out.debris = dc;
      out.sewer = F.sewer ? { fill: +(F.sewer.V / Math.max(1, F.sewer.cap)).toFixed(2), manholes: F.sewer.holes.length } : null;
      out.uploadBytes = F.render ? F.render.uploadBytes || 0 : 0;
    }
    return out;
  }

  CBZ.flashflood = {
    start: start, tick: tick, clear: clear, islandWorld: islandWorld,
    // the water is still going down (the director's calm waits on it)
    busy: function () { return !!(F && F.ending); },
    depthAt: depthAt, levelAt: levelAt, flowAt: flowAt, frontPoints: frontPoints, threatAt: threatAt,
    stats: stats, arrival: arrival,
    storm: function () { return F ? F.W.storm : null; },
    events: function () { return F ? F.events.slice() : (lastEvents || []).slice(); },
    // the bodies, for tools (positions/states; read-only)
    bodies: function () {
      if (!F) return null;
      return {
        debris: F.debris.map(function (p) { return { kind: ["board", "branch", "tyre", "log"][p.kind], state: p.state, x: +p.x.toFixed(1), z: +p.z.toFixed(1), len: +p.len.toFixed(1) }; }),
        cars: F.cars.map(function (c) { return { name: c.car.name || null, state: c.state, x: +c.x.toFixed(1), z: +c.z.toFixed(1), y: +(c.y || 0).toFixed(2) }; }),
      };
    },
    get live() { return !!F; },
    get ready() { return !!(F && F.ready); },
    get mesh() { return F && F.render ? F.render.mesh : null; },
    audit: function () {
      const S = F ? F.stats : lastStats;
      return {
        live: !!F, ready: !!(F && F.ready),
        grid: F ? F.grid.n + "x" + F.grid.n : null,
        maxDepth: S ? +S.maxDepth.toFixed(2) : 0,
        frontSpeed: S ? +S.frontSpeed.toFixed(2) : 0,
        carsSwept: S ? S.carsSwept : 0, carsFloated: S ? S.carsFloated : 0,
        bridgesFailed: S ? S.bridgesFailed : 0, lidsPopped: S ? S.lidsPopped : 0,
        debrisAfloat: S ? S.debrisAfloat || 0 : 0, debrisStranded: S ? S.debrisStranded || 0 : 0,
        sprayLaunched: S ? S.sprayLaunched || 0 : 0,
        fieldInstalled: !!(CBZ.groundWaterField && CBZ.groundWaterField() === FIELD),
        siltLeft: !!silt,
        drawCallsOwned: F && F.render ? 1 + (F.render.silt ? 1 : 0) + (F.render.rooms ? 1 : 0) + 1 + (F.render.debris ? F.render.debris.length : 0) + (F.render.lids ? 1 : 0) + (F.render.marks ? 1 : 0) : 0,
      };
    },
  };
})();
