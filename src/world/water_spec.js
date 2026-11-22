/* ============================================================
   src/world/water_spec.js — THE ONE WATER.

   What the sea is, written once and read by everything:

   1. THE WAVE FIELD. A Gerstner spectrum: two long swell rows from their own
      bearing, eight wind-sea bands (2-120 m, three fixed bearings each) and
      four capillary rows that exist only per pixel. The live wind sets every
      row's amplitude through a Pierson-Moskowitz envelope (peak ~0.88 U^2,
      Hs ~0.13 U^2/g, fetch-capped at 120 m / 4 m), and the water column under
      a point (the baked shore field) shoals each row to the shore. The SAME
      rows and the same live amplitudes drive the vertex displacement, the
      per-pixel analytic normal and the CPU twin (CBZ.waterWaveHeight / Slope
      / OrbitalAt / SurfaceAt), so every hull rides the crest that is drawn.
   2. THE OPTICS. cbzWaterShade(): one function every water surface ends in.
      Schlick Fresnel (F0 0.02) on the true normal, the dome's own sky in the
      reflected ray, Beer-Lambert body colour from the water column lit by the
      scene's lights, one GGX sun/moon lobe whose width is the slope variance
      the pixel cannot resolve, a crest glow, and one foam look.
   3. Materials, geometry, the shore field, entry rings, the tsunami face.

   Everything is closed-form on the shared clock; no Math.random anywhere.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  if (!THREE) return;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // Flags other files read. WATER_V2 is the master switch the sibling water
  // files (buoyancy, wakes, underwater) gate on.
  if (CFG.WATER_V2 == null) CFG.WATER_V2 = true;
  if (CFG.WATER_UNDERWATER == null) CFG.WATER_UNDERWATER = true;
  if (CFG.WATER_BUOYANCY == null) CFG.WATER_BUOYANCY = true;
  if (CFG.WATER_WAKE_FX == null) CFG.WATER_WAKE_FX = true;
  if (CFG.WATER_ENTRY_PHYSICS == null) CFG.WATER_ENTRY_PHYSICS = true;
  function entryPhysicsOn() { return CFG.WATER_ENTRY_PHYSICS !== false && CFG.WATER_V2 !== false; }
  CBZ.waterEntryPhysicsOn = entryPhysicsOn;
  if (CFG.WATER_SWASH == null) CFG.WATER_SWASH = true;
  // The sea is alpha-blended over the seabed geometry under it; its alpha is
  // the light that crosses the surface and the water column (cbzWaterShade).
  if (CFG.SEA_TRANSLUCENT == null) CFG.SEA_TRANSLUCENT = true;
  function translucentOn() { return CFG.SEA_TRANSLUCENT !== false && CFG.WATER_V2 !== false; }
  CBZ.seaTranslucentOn = translucentOn;
  // Past this window the sheet is opaque (no seabed is drawn that far out).
  const CLARITY_NEAR = 25, CLARITY_FAR = 60;   // m from the eye: nothing past it is seen through
  const VEIL_K = 0.115;      // the veil's extinction per metre (green channel of the body model)

  // ============================================================
  //  1. THE WAVE SPECTRUM
  // ============================================================
  /* Two parts, split where the mesh stops carrying waves:
     ROWS (6-150 m): Gerstner rows the vertices displace and the CPU twin
       evaluates. Two swell rows from their own bearing; five wind bands
       (120 down to 6 m), each spread over five directions -60..+60 degrees
       about the wind with a cos^2s weight and its own irrational wavelength
       jitter, so the sum is short-crested (a crest runs a few wavelengths and
       ends) rather than a set of ruled lines. The wind rows turn with a slow
       (60 s) bearing.
     DETAIL (under ~5 m): a noise height field per pixel (cbzDetail): four
       octaves of value noise around 2 / 0.8 / 0.3 / 0.12 m in two layers
       drifting different ways with the wind, gust-modulated, its amplitude
       the short-wave share of the same spectrum; each octave fades into
       roughness as the pixel's footprint outgrows it. */
  const G_ACC = 9.81, TAU = Math.PI * 2, GOLD = 2.39996323;
  const GRP_SWELL = 0, GRP_WIND = 1;
  const WIND_BANDS = 5, BAND_DIRS = 5, SPREAD = Math.PI / 3;
  const LAM_MAX = 120, LAM_MIN = 6;
  const SWELL_DIR = Math.atan2(0.8, 0.6);     // the far-storm swell's travel bearing
  const SWELL_AMP = [0.08, 0.06];             // m: a low long swell under any wind
  const SHORE_AMP = 0.42;                     // m: the summed amplitude allowed at the waterline
  const SEA_BREEZE = 6.0;                     // m/s: the open sea is never calmer than this
  const INLAND_CALM = 0.26, RIVER_CALM = 0.15;
  const Q_MAX = 0.85;                         // crest sharpening: trochoidal, never a cusp
  CBZ.WATER_INLAND_CALM = INLAND_CALM;
  CBZ.WATER_SWELL_AMP = SHORE_AMP;
  const BAND_R = Math.pow(LAM_MIN / LAM_MAX, 1 / (WIND_BANDS - 1));
  function bandLam(b) { return LAM_MAX * Math.pow(BAND_R, b); }
  // the detail octaves: noise cell (m); a feature spans ~2 cells
  const DETAIL_CELL = [1.0, 0.4, 0.15, 0.06];
  const DETAIL_LAYERS = [2, 2, 2, 1];
  // row: [dirX, dirZ, k, omega, phase, lambda, group, shoalDepth, band, relAngle]
  // shoalDepth: the water depth (m) at which a row reaches full height; long
  // rows feel the bottom first. dirX/dirZ of wind rows follow the wind.
  const WAVES = [];
  (function buildSpectrum() {
    const push = function (lam, th, grp, band, rel) {
      const k = TAU / lam;
      const h = Math.max(3.5, Math.min(12, 0.1 * lam + 3));
      WAVES.push([Math.cos(th), Math.sin(th), k, Math.sqrt(G_ACC * k), 0, lam, grp, h, band, rel]);
    };
    push(150, SWELL_DIR - 0.10, GRP_SWELL, -1, 0);
    push(105, SWELL_DIR + 0.16, GRP_SWELL, -1, 0);
    for (let b = 0; b < WIND_BANDS; b++) {
      for (let j = 0; j < BAND_DIRS; j++) {
        const rel = (j / (BAND_DIRS - 1) - 0.5) * 2 * SPREAD + ((b * GOLD) % 1 - 0.5) * 0.18;
        const jit = 1 + 0.17 * (((j * 0.6180339887 + b * 0.4142135624) % 1) - 0.5);
        push(bandLam(b) * jit, rel, GRP_WIND, b, rel);
      }
    }
    WAVES.sort(function (a, b) { return b[5] - a[5]; });
    for (let i = 0; i < WAVES.length; i++) WAVES[i][4] = ((i * 0.618034) % 1) * TAU;
  })();
  const N_WAVES = WAVES.length;                                   // 27
  const N_GEO = N_WAVES;
  const N_PACK = Math.ceil(N_WAVES / 4);
  CBZ.WATER_WAVES = WAVES;

  // ---- live state, shared by reference with every material ----
  const rowA = new Float32Array(N_PACK * 4);   // m, per row, before a surface's multipliers
  const rowTail = new Float32Array(N_PACK * 4);// slope variance of rows i..end (unresolved tail)
  const rowK = new Float32Array(N_WAVES * 4);  // kx, kz, omega, phase (the wind rows turn)
  const waveCtl = new THREE.Vector4(Q_MAX, 0.05, 0.5, 0);   // x Gerstner Q, y mesh spacing per metre, z mesh spacing floor
  const waveSum = new THREE.Vector2(0.14, 0.3);         // summed amplitude: swell rows, wind rows
  const waveRough = new THREE.Vector4(0.01, 0, 6, 0);   // x base unresolved slope variance, y whitecap 0..1, z wind m/s
  const detailAmp = new THREE.Vector4(0, 0, 0, 0);      // per detail octave: noise amplitude (m)
  const detailVar = new THREE.Vector4(0, 0, 0, 0);      // per detail octave: its slope variance
  let arenaMulMax = 1;                                   // the roughest multiplier a surface asked for (Q budget)

  // ---- the wind: weather.js's vector, eased so the sea builds and dies ----
  const WIND = { x: 0.882, z: 0.471, speed: SEA_BREEZE, w01: 0.5, q: Q_MAX, hs: 0, lamP: 0, cap01: 0, mss: 0, stamp: -1, t: -1 };
  const windDirShade = new THREE.Vector2(0.882, 0.471);   // the slow bearing the wind rows and foam follow
  const _wt = { x: 1, z: 0, speed: 0 };
  function windTarget(out) {
    let x = 0.882, z = 0.471, sp = 0;
    if (typeof CBZ.weatherWind === "function") {
      try {
        const w = CBZ.weatherWind();
        if (w && Number.isFinite(w.x) && Number.isFinite(w.z) && (w.x * w.x + w.z * w.z) > 1e-6) {
          x = w.x; z = w.z; sp = Number.isFinite(+w.speed) ? +w.speed : 0;
        }
      } catch (e) {}
    } else if (CBZ.world && CBZ.world.wind && Number.isFinite(CBZ.world.wind.x)) {
      x = CBZ.world.wind.x; z = CBZ.world.wind.z; sp = +CBZ.world.wind.speed || 0;
    }
    const m = Math.hypot(x, z) || 1;
    out.x = x / m; out.z = z / m; out.speed = Math.max(SEA_BREEZE, sp);
    return out;
  }
  function smooth(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  // PM energy (relative) in a band of geometric width around wavelength lam
  function pmBand(lam, wp) {
    const w = Math.sqrt(TAU * G_ACC / lam);
    return Math.pow(w, -4) * Math.exp(-1.25 * Math.pow(wp / w, 4));
  }
  const _bandE = new Float64Array(WIND_BANDS), _bandW = new Float64Array(WIND_BANDS);

  // The spectrum for the live wind: per-row amplitudes and directions, the Q
  // that keeps the Gerstner sum from looping, the detail field's amplitudes,
  // and the slope variance nothing resolves.
  function computeSpectrum() {
    const U = WIND.speed;
    const lamP = Math.min(0.88 * U * U, LAM_MAX);
    const wp = Math.sqrt(TAU * G_ACC / lamP);
    const hs = Math.min(4, 0.6 * 0.21 * U * U / G_ACC);
    // the bands the rows carry, and the virtual bands below them the detail carries
    let sum = 0, shortVar = 0;
    for (let b = 0; b < WIND_BANDS; b++) { _bandE[b] = pmBand(bandLam(b), wp); sum += _bandE[b]; _bandW[b] = 0; }
    const shortE = [];
    for (let b = WIND_BANDS; b < WIND_BANDS + 4; b++) { const e = pmBand(bandLam(b), wp); shortE.push(e); sum += e; }
    const sc = sum > 0 ? (hs / 4) * (hs / 4) / sum : 0;
    for (let q = 0; q < shortE.length; q++) { const k = TAU / bandLam(WIND_BANDS + q); shortVar += k * k * shortE[q] * sc; }
    // spreading: cos^2s(theta/2) about the wind, narrower in a stronger wind
    const s2 = 2 * (3 + 3 * Math.min(1, U / 20));
    const bx = windDirShade.x, bz = windDirShade.y, ba = Math.atan2(bz, bx);
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      if (r[6] === GRP_WIND) { const a = ba + r[9]; r[0] = Math.cos(a); r[1] = Math.sin(a); _bandW[r[8]] += Math.pow(Math.cos(r[9] * 0.5), s2); }
    }
    let res = 0, sS = 0, sW = 0;
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      let a;
      if (r[6] === GRP_SWELL) { a = r[5] > 120 ? SWELL_AMP[0] : SWELL_AMP[1]; sS += a; }
      else {
        const w = Math.pow(Math.cos(r[9] * 0.5), s2), wb = _bandW[r[8]];
        a = wb > 1e-9 ? Math.sqrt(2 * _bandE[r[8]] * sc * w / wb) : 0;
        sW += a;
      }
      rowA[i] = a;
      rowK[i * 4] = r[0] * r[2]; rowK[i * 4 + 1] = r[1] * r[2]; rowK[i * 4 + 2] = r[3]; rowK[i * 4 + 3] = r[4];
      res += 0.5 * (r[2] * a) * (r[2] * a);
    }
    // Cox-Munk: the total mean-square slope of a wind sea. What the rows do
    // not carry goes to the detail field (the short gravity waves the
    // spectrum puts there, and half of what is left) and to roughness.
    const cm = 0.003 + 0.00512 * U;
    const un = Math.max(0, cm - res - shortVar);
    const detTot = shortVar + 0.5 * un;
    for (let o = 0; o < 4; o++) {
      const S = detTot * (o < 2 ? 0.3 : 0.2);
      detailVar.setComponent(o, S);
      detailAmp.setComponent(o, DETAIL_CELL[o] * Math.sqrt(S / (0.373 * DETAIL_LAYERS[o])));
    }
    let tail = 0;
    for (let i = N_WAVES - 1; i >= 0; i--) {
      const ka = WAVES[i][2] * rowA[i];
      tail += 0.5 * ka * ka;
      rowTail[i] = tail;
    }
    // Q: sum(Q k a) < 0.9 at the roughest multiplier any surface uses
    let steep = 0;
    for (let i = 0; i < N_GEO; i++) steep += WAVES[i][2] * rowA[i];
    steep *= Math.max(1, arenaMulMax);
    WIND.q = Math.min(Q_MAX, 0.9 / Math.max(1e-6, steep));
    waveCtl.x = WIND.q;
    waveSum.set(sS, sW);
    let m0 = 0;
    for (let i = 0; i < N_GEO; i++) m0 += 0.5 * rowA[i] * rowA[i];
    WIND.hs = 4 * Math.sqrt(m0);
    WIND.lamP = lamP;
    // whitecap cover (Monahan ~U^3.41), as 0..1 of a gale's
    WIND.cap01 = Math.min(1, 3.84e-6 * Math.pow(U, 3.41) / 0.1) * smooth(5.5, 7.5, U);
    WIND.mss = cm;
    waveRough.set(0.5 * un + 0.0006, WIND.cap01, U, 0);
  }

  function windTick() {
    const tNow = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    const stamp = CBZ.now || Math.floor(tNow * 120);
    if (stamp === WIND.stamp) return WIND;
    const dt = WIND.t < 0 ? 1e3 : Math.min(2, Math.max(0, tNow - WIND.t));
    WIND.t = tNow; WIND.stamp = stamp;
    windTarget(_wt);
    // the bearing turns over ~25 s, the sea state builds over ~12 s
    const kd = 1 - Math.exp(-dt / 25), ks = 1 - Math.exp(-dt / 12), kv = 1 - Math.exp(-dt / 60);
    let nx = WIND.x + (_wt.x - WIND.x) * kd, nz = WIND.z + (_wt.z - WIND.z) * kd;
    const nm = Math.hypot(nx, nz);
    if (nm < 1e-3) { nx = _wt.x; nz = _wt.z; } else { nx /= nm; nz /= nm; }
    WIND.x = nx; WIND.z = nz;
    let sx = windDirShade.x + (nx - windDirShade.x) * kv, sz = windDirShade.y + (nz - windDirShade.y) * kv;
    const sm = Math.hypot(sx, sz);
    if (sm < 1e-3) { sx = nx; sz = nz; } else { sx /= sm; sz /= sm; }
    windDirShade.set(sx, sz);
    WIND.speed += (_wt.speed - WIND.speed) * ks;
    WIND.w01 = Math.max(0, Math.min(1, WIND.speed / 24));
    computeSpectrum();
    tierCtl();
    return WIND;
  }
  CBZ.waterWind = function () { return windTick(); };

  // What builder-side physics wants to know about the sea, in one record.
  const _ss = { hs: 0, peakLen: 0, wind: 0, windDir: { x: 1, z: 0 }, cap01: 0 };
  CBZ.waterSeaState = function () {
    windTick();
    _ss.hs = WIND.hs; _ss.peakLen = WIND.lamP; _ss.wind = WIND.speed;
    _ss.windDir.x = WIND.x; _ss.windDir.z = WIND.z; _ss.cap01 = WIND.cap01;
    return _ss;
  };

  // ---- shared clock (the SIM clock once a match runs; wall time on a title)
  CBZ.waterClock = function () {
    const g = CBZ.game;
    const sim = CBZ.now;
    if (g && g.state !== "title" && Number.isFinite(sim) && sim > 0) return (sim * 0.001) % 3600;
    const ms = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    return (ms * 0.001) % 3600;
  };

  // ---- registered inland bodies (lakes): calm water, CPU and GPU ----------
  const MAX_INLAND = 4;
  CBZ.WATER_MAX_INLAND = MAX_INLAND;
  const SEA_LAMPS = 6;
  CBZ.WATER_SEA_LAMPS = SEA_LAMPS;
  let inlandRecs = [];
  const inlandVecs = [];
  for (let i = 0; i < MAX_INLAND; i++) inlandVecs.push(new THREE.Vector4(1e6, 1e6, 1.0, 0.0));
  function lakeOn() { return CFG.WATER_V2 !== false; }
  CBZ.waterSyncInlandBodies = function (city) {
    inlandRecs.length = 0;
    const list = (city && city.waterBodies) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.waterBodies) || [];
    for (let i = 0; i < list.length && inlandRecs.length < MAX_INLAND; i++) {
      const b = list[i];
      if (!b) continue;
      let cx, cz, r;
      if (b.kind === "circle") { cx = +b.cx; cz = +b.cz; r = +b.r; }
      else if (b.minX != null) { cx = (+b.minX + +b.maxX) / 2; cz = (+b.minZ + +b.maxZ) / 2; r = Math.max(+b.maxX - +b.minX, +b.maxZ - +b.minZ) / 2; }
      else continue;
      if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(r > 0)) continue;
      inlandRecs.push({ cx: cx, cz: cz, r: r });
    }
    const lw = lakeOn() ? 1.0 : 0.0;
    for (let i = 0; i < MAX_INLAND; i++) {
      const rec = inlandRecs[i];
      if (rec) inlandVecs[i].set(rec.cx, rec.cz, rec.r, lw);
      else inlandVecs[i].set(1e6, 1e6, 1.0, 0.0);
    }
    return inlandVecs;
  };
  CBZ.waterInlandVectors = function () { return inlandVecs; };
  // 1 deep inside a registered lake, 0 on open sea (cbzInlandFactor's twin)
  function inlandAt(x, z) {
    if (!lakeOn()) return 0;
    let f = 0;
    for (let i = 0; i < inlandRecs.length; i++) {
      const b = inlandRecs[i];
      const dx = x - b.cx, dz = z - b.cz, c = b.r * 1.15, dd = dx * dx + dz * dz;
      if (dd >= c * c) continue;
      const v = 1 - smooth(b.r * 0.55, c, Math.sqrt(dd));
      if (v > f) f = v;
    }
    return f;
  }
  CBZ.waterInlandFactorAt = inlandAt;

  // ---- THE SHORE FIELD, READ ON THE CPU -----------------------------------
  // Every sea's baked field (RGBA8): R land ramp (the cut), G = 1 - depth/2.4,
  // B = depth/30, A = surf exposure. The CPU reads the very bytes the GPU
  // samples, bilinearly, so the shoaling a hull feels is the shoaling drawn.
  // cityGeo: the city's field (set when its sea is built); arenaGeo: the
  // island sea's (set by waterSetField / cleared by waterClearField).
  let cityGeo = null, arenaGeo = null;
  function geoFrom(tex, b) {
    const im = tex && tex.image;
    if (!im || !im.data || !(im.width > 1) || !b) return null;
    return { data: im.data, w: im.width, h: im.height, x0: b.x, z0: b.y, x1: b.z, z1: b.w };
  }
  function fieldDepth(G, x, z) {
    if (!G) return 30;
    const u = (x - G.x0) / Math.max(1, G.x1 - G.x0), v = (z - G.z0) / Math.max(1, G.z1 - G.z0);
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 30;
    const fx = u * G.w - 0.5, fz = v * G.h - 0.5;
    let ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const x0 = ix < 0 ? 0 : ix > G.w - 1 ? G.w - 1 : ix, x1 = ix + 1 < 0 ? 0 : ix + 1 > G.w - 1 ? G.w - 1 : ix + 1;
    const z0 = iz < 0 ? 0 : iz > G.h - 1 ? G.h - 1 : iz, z1 = iz + 1 < 0 ? 0 : iz + 1 > G.h - 1 ? G.h - 1 : iz + 1;
    const d = G.data;
    const a = (z0 * G.w + x0) * 4, b = (z0 * G.w + x1) * 4, c = (z1 * G.w + x0) * 4, e = (z1 * G.w + x1) * 4;
    const g = ((d[a + 1] * (1 - tx) + d[b + 1] * tx) * (1 - tz) + (d[c + 1] * (1 - tx) + d[e + 1] * tx) * tz) / 255;
    const bl = ((d[a + 2] * (1 - tx) + d[b + 2] * tx) * (1 - tz) + (d[c + 2] * (1 - tx) + d[e + 2] * tx) * tz) / 255;
    return Math.max(bl * 30, (1 - g) * 2.4);
  }
  CBZ.waterFieldDepthAt = function (x, z, arena) { return fieldDepth(arena ? arenaGeo : cityGeo, x, z); };

  // ---- SWASH: the one run-up function the sea and the sand both read ------
  const SWASH_RANGE = 6.0;
  CBZ.WATER_SWASH_RANGE = SWASH_RANGE;
  const SWASH_PH = [0.00310, 0.00470];
  function swashOn() { return CFG.WATER_SWASH !== false && CFG.WATER_V2 !== false; }
  function swashPair(x, z, t, out) {
    out = out || {};
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    if (!swashOn()) { out.s = 0; out.v = 0; return out; }
    const ph = x * SWASH_PH[0] + z * SWASH_PH[1];
    const a0 = t * 0.35 + ph * 1.7;
    const a1 = t * 0.61 + ph * 2.9 + 1.70;
    const a2 = t * 1.10 + ph * 4.3 + 3.40;
    out.s = (0.60 * Math.sin(a0) + 0.30 * Math.sin(a1) + 0.10 * Math.sin(a2)) * SWASH_RANGE;
    out.v = (0.60 * 0.35 * Math.cos(a0) + 0.30 * 0.61 * Math.cos(a1) + 0.10 * 1.10 * Math.cos(a2)) * SWASH_RANGE;
    return out;
  }
  const _swash = { s: 0, v: 0 };
  CBZ.waterSwashAt = function (x, z, t) { return swashPair(x, z, t, _swash).s; };
  CBZ.waterSwashVelAt = function (x, z, t) { return swashPair(x, z, t, _swash).v; };
  CBZ.waterSwashPair = swashPair;

  // ---- sea level and the one way to move it (storm tide, tsunami) ---------
  const SEA_Y_FALLBACK = -0.48;
  const SHORE_CUT_PER_M = 0.055;
  let _surge = 0;
  function seaY() { return (CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK) + _surge; }
  CBZ.waterSeaY = seaY;
  CBZ.waterSurge = function () { return _surge; };
  CBZ.waterSurgeSet = function (m) {
    _surge = Number.isFinite(+m) ? +m : 0;
    return _surge;
  };

  /* ---- ENTRY RINGS: what a body, a boat or a meteor does to the sea --------
     Each slot is a splash: (x, z, t0, amplitude) and (source radius, k0,
     life, serial). Two parts, closed-form, CPU and GPU identical:
       the CAVITY, a dent the size of the source that fills in ~sqrt(R/g);
       the RING, the deep-water dispersion of the splash: at radius r and age
       t the wave present is the one whose GROUP speed carries it there,
       k = g t^2 / 4 r^2, phase g t^2 / 4 r. Long waves lead, short ones
       trail, the packet centre runs out at the group speed of k0 and widens
       as it goes; amplitude falls as 1/sqrt(r) and with age, and is capped at
       a steepness of k a = 0.28 so even a metres-high meteor ring is a wave.
     The leading crest of a steep ring breaks white (the 4th component). */
  const MAX_SURFACE_IMPULSES = 8;
  const surfaceImpulses = [], surfaceImpulseShapes = [];
  for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
    surfaceImpulses.push(new THREE.Vector4(0, 0, -1e6, 0));
    surfaceImpulseShapes.push(new THREE.Vector4(1, 1, 1, 0));
  }
  let surfaceImpulseSerial = 0;
  let lastSurfaceImpulse = null;
  const _surfaceImpulseSample = { h: 0, x: 0, z: 0, foam: 0 };
  // res: the resolution (m) the caller can carry: rings shorter than ~3x it fade
  function sampleSurfaceImpulses(x, z, t, res, out) {
    out = out || _surfaceImpulseSample;
    out.h = 0; out.x = 0; out.z = 0; out.foam = 0;
    if (!entryPhysicsOn()) return out;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      const q = surfaceImpulses[i], sh = surfaceImpulseShapes[i];
      const age = t - q.z, life = sh.z;
      if (!(q.w > 0) || age < 0 || age >= life) continue;
      const dx = x - q.x, dz = z - q.y;
      const r = Math.sqrt(dx * dx + dz * dz);
      const Rs = sh.x, k0 = sh.y;
      const tau = 0.9 * Math.sqrt(Rs / G_ACC) + 0.12;
      const fill = Math.exp(-age / tau);
      const core = -q.w * Math.exp(-r * r / (Rs * Rs)) * fill;
      let dHdr = core * (-2 * r / (Rs * Rs));
      const re = r + 0.5 * Rs;
      const th = G_ACC * age * age / (4 * re);
      const kl = th / re;
      const u = (kl / k0 - 1) / 0.5;
      const lamL = TAU / Math.max(kl, 1e-4);
      const env = Math.exp(-u * u) * smooth(2.5 * res, 4 * res, lamL);
      const A = Math.min(q.w, 0.28 / k0) * Math.sqrt(Rs / (Rs + r)) * Math.exp(-age / life) * (1 - fill);
      const c = Math.cos(th), s = Math.sin(th);
      const ring = A * env * c;
      dHdr += A * env * s * kl;
      out.h += core + ring;
      if (r > 1e-5) { const k = dHdr / r; out.x += dx * k; out.z += dz * k; }
      const steep = A * env * kl;
      // the splash rim, and only the first crests near the source break: partial
      // cover, so the one foam look tears it into patches (never a ruled ring)
      const rim = Math.exp(-((r - Rs) / (0.5 * Rs)) * ((r - Rs) / (0.5 * Rs))) * fill * Math.min(1, q.w * 4) * 0.75;
      out.foam = Math.max(out.foam, Math.max(smooth(0.14, 0.28, steep) * smooth(0.3, 0.9, c) * (1 - smooth(1.2 * Rs, 3 * Rs, r)) * 0.7, rim));
    }
    return out;
  }
  // spec: { amplitude m, radius m (the source), wavelength m?, life s? }
  CBZ.waterSurfaceImpulse = function (x, z, spec) {
    if (!entryPhysicsOn()) return false;
    x = +x; z = +z; spec = spec || {};
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const t = CBZ.waterClock();
    const amp = Math.max(0.01, Math.min(6, +spec.amplitude || 0.12));
    const radius = Math.max(0.15, Math.min(40, +spec.radius || 0.8));
    const lam = Math.max(0.6, Math.min(160, +spec.wavelength || radius * 2.6));
    const k0 = TAU / lam;
    const T0 = Math.sqrt(TAU * lam / G_ACC);
    const life = Math.max(1, Math.min(60, +spec.life || Math.max(1.5, Math.min(40, 5 * T0))));
    // a free slot, else the one with the least energy left
    let slot = -1, weakest = 1e30;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      const q = surfaceImpulses[i], sh = surfaceImpulseShapes[i];
      const age = t - q.z;
      if (!(q.w > 0) || age >= sh.z || age < 0) { slot = i; break; }
      const e = q.w * q.w * sh.x * Math.exp(-2 * age / Math.max(0.01, sh.z));
      if (e < weakest) { weakest = e; slot = i; }
    }
    const newE = amp * amp * radius;
    if (weakest < 1e30 && newE < weakest * 0.5 && slot >= 0 && surfaceImpulses[slot].w > 0 && t - surfaceImpulses[slot].z < surfaceImpulseShapes[slot].z) return false;
    const serial = ++surfaceImpulseSerial;
    surfaceImpulses[slot].set(x, z, t, amp);
    surfaceImpulseShapes[slot].set(radius, k0, life, serial);
    lastSurfaceImpulse = { x: x, z: z, amplitude: amp, radius: radius, wavelength: lam, life: life, serial: serial };
    return true;
  };
  CBZ.waterSurfaceImpulseClear = function () {
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      surfaceImpulses[i].set(0, 0, -1e6, 0);
      surfaceImpulseShapes[i].set(1, 1, 1, 0);
    }
    lastSurfaceImpulse = null;
  };
  CBZ.waterSurfaceImpulseAudit = function () {
    const t = CBZ.waterClock();
    let active = 0;
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      if (surfaceImpulses[i].w > 0 && t - surfaceImpulses[i].z >= 0 &&
          t - surfaceImpulses[i].z < surfaceImpulseShapes[i].z) active++;
    }
    return { active: active, capacity: MAX_SURFACE_IMPULSES,
      last: lastSurfaceImpulse ? Object.assign({}, lastSurfaceImpulse) : null };
  };

  // ============================================================
  //  2. THE WAVE FIELD ON THE CPU (term for term the vertex program)
  // ============================================================
  function camDist(x, z) {
    const cam = CBZ.camera;
    if (!cam) return 0;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  // the mesh spacing at a distance from the eye (cbzMeshSpacing)
  function meshSpacing(dist, floor) { return Math.max(waveCtl.y * dist, Math.max(waveCtl.z, floor || 0)); }
  // where a surface point is: its shoaling depth, its calm, its multipliers
  const _ctxA = { mulS: 1, mulW: 1, depth: 30, calm: 1 }, _ctxB = { mulS: 1, mulW: 1, depth: 30, calm: 1 };
  function ctxAt(x, z, arena, mulS, mulW, out) {
    out.mulS = mulS; out.mulW = mulW;
    let depth = fieldDepth(arena ? arenaGeo : cityGeo, x, z), calm = 1;
    if (!arena) {
      const inl = inlandAt(x, z), riv = riverAt(x, z);
      calm = (1 + (INLAND_CALM - 1) * inl) * (1 + (RIVER_CALM - 1) * riv);
      depth *= 1 - Math.max(inl, riv);
    }
    out.depth = depth; out.calm = calm;
    return out;
  }
  function shoreFrac(C) { return Math.min(1, SHORE_AMP / Math.max(0.001, waveSum.x * C.mulS + waveSum.y * C.mulW)); }
  // the amplitude of row i at a context (cbzRowAmp)
  function rowAmp(i, C, fs) {
    const r = WAVES[i];
    const m = r[6] === GRP_SWELL ? C.mulS : C.mulW;
    return rowA[i] * m * C.calm * (fs + (1 - fs) * smooth(0, r[7], C.depth));
  }
  // Sum at PARAMETRIC (px,pz). out.h height, out.dx/dz the Gerstner shift and,
  // with deriv, the displaced sheet's slope (sx, sz) and fold (1 - J).
  const _ev = { h: 0, dx: 0, dz: 0, sx: 0, sz: 0, fold: 0 };
  function evalSum(px, pz, t, C, sp, deriv, out) {
    const Q = waveCtl.x, fs = shoreFrac(C);
    let h = 0, dx = 0, dz = 0, hx = 0, hz = 0, sxx = 0, szz = 0, sxz = 0;
    for (let i = 0; i < N_GEO; i++) {
      const r = WAVES[i];
      const lod = smooth(3, 5, r[5] / sp);
      if (lod <= 0) break;                    // rows are sorted long -> short
      const a = rowAmp(i, C, fs) * lod;
      if (!(a > 1e-7)) continue;
      const th = r[0] * r[2] * px + r[1] * r[2] * pz - r[3] * t + r[4];
      const s = Math.sin(th), c = Math.cos(th);
      h += a * s;
      dx += Q * a * r[0] * c; dz += Q * a * r[1] * c;
      if (deriv) {
        const ka = r[2] * a;
        hx += ka * r[0] * c; hz += ka * r[1] * c;
        sxx += Q * ka * r[0] * r[0] * s; szz += Q * ka * r[1] * r[1] * s; sxz += Q * ka * r[0] * r[1] * s;
      }
    }
    out.h = h; out.dx = dx; out.dz = dz;
    if (deriv) {
      const ny = (1 - sxx) * (1 - szz) - sxz * sxz;
      const nx = -hz * sxz - (1 - szz) * hx;
      const nz = -sxz * hx - hz * (1 - sxx);
      const iy = 1 / Math.max(0.05, ny);
      out.sx = -nx * iy; out.sz = -nz * iy;
      out.fold = Math.max(0, 1 - ny);
    }
    return out;
  }
  // Height (and slope) at WORLD (x,z): one fixed-point step inverts the
  // Gerstner shift (sum Q k a < 0.9, so it converges to well under a cm), and
  // the second pass reads the context at the parametric point, as the GPU does.
  function surfaceEval(x, z, t, arena, mulS, mulW, deriv, out) {
    windTick();
    const sp = meshSpacing(camDist(x, z), 0);
    // fixed-point inversion of the Gerstner shift: two steps hold a gale's
    // steep crests to centimetres
    evalSum(x, z, t, ctxAt(x, z, arena, mulS, mulW, _ctxA), sp, false, _ev);
    let px = x - _ev.dx, pz = z - _ev.dz;
    evalSum(px, pz, t, ctxAt(px, pz, arena, mulS, mulW, _ctxB), sp, false, _ev);
    px = x - _ev.dx; pz = z - _ev.dz;
    evalSum(px, pz, t, ctxAt(px, pz, arena, mulS, mulW, _ctxB), sp, deriv, _ev);
    const imp = sampleSurfaceImpulses(px, pz, t, sp * 1.2, _surfaceImpulseSample);
    out.h = _ev.h + imp.h;
    if (deriv) { out.sx = _ev.sx + imp.x; out.sz = _ev.sz + imp.z; out.fold = _ev.fold; }
    return out;
  }
  const _se = { h: 0, sx: 0, sz: 0, fold: 0 };
  // ampScale/chopScale given: an island surface's own multipliers (swell, wind)
  CBZ.waterWaveHeight = function (x, z, t, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const arena = Number.isFinite(ampScale);
    const ms = arena ? ampScale : 1, mw = arena ? (Number.isFinite(chopScale) ? chopScale : ampScale) : 1;
    return seaY() + surfaceEval(x, z, t, arena, ms, mw, false, _se).h;
  };
  CBZ.waterWaveSlope = function (x, z, t, out, ampScale, chopScale) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const arena = Number.isFinite(ampScale);
    const ms = arena ? ampScale : 1, mw = arena ? (Number.isFinite(chopScale) ? chopScale : ampScale) : 1;
    surfaceEval(x, z, t, arena, ms, mw, true, _se);
    out = out || {};
    out.x = _se.sx; out.z = _se.sz; out.fold = _se.fold;
    return out;
  };
  // Just the entry-ring term (m), for sheets that ride a plane fit of the swell.
  CBZ.waterImpulseHeightAt = function (x, z, t) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    return sampleSurfaceImpulses(x, z, t, meshSpacing(camDist(x, z), 0) * 1.2, _surfaceImpulseSample).h;
  };
  CBZ.waterImpulseSample = function (x, z, t, out) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    const s = sampleSurfaceImpulses(x, z, t, meshSpacing(camDist(x, z), 0) * 1.2, _surfaceImpulseSample);
    out = out || {};
    out.h = s.h; out.x = s.x; out.z = s.z; out.foam = s.foam;
    return out;
  };
  CBZ.waterImpulsesLive = function (t) {
    if (!entryPhysicsOn()) return false;
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    for (let i = 0; i < MAX_SURFACE_IMPULSES; i++) {
      const q = surfaceImpulses[i];
      if (q.w > 0 && t - q.z >= 0 && t - q.z < surfaceImpulseShapes[i].z) return true;
    }
    return false;
  };
  // Orbital velocity of the surface water (m/s): a cork on a Gerstner row
  // rides a circle of radius a at omega; the small net drift is Stokes drift.
  CBZ.waterOrbitalAt = function (x, z, t, out) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    out = out || {};
    windTick();
    const C = ctxAt(x, z, false, 1, 1, _ctxA), fs = shoreFrac(C), sp = meshSpacing(camDist(x, z), 0);
    let vx = 0, vz = 0;
    for (let i = 0; i < N_GEO; i++) {
      const r = WAVES[i];
      const lod = smooth(3, 5, r[5] / sp);
      if (lod <= 0) break;
      const a = rowAmp(i, C, fs) * lod;
      if (!(a > 1e-7)) continue;
      const th = r[2] * (r[0] * x + r[1] * z) - r[3] * t + r[4];
      const v = a * r[3] * Math.sin(th);
      vx += v * r[0]; vz += v * r[1];
    }
    out.x = vx; out.z = vz;
    return out;
  };
  // How big the sea is here relative to the open ocean (1 offshore, the
  // shore fraction at the waterline, less in a lake or river).
  function ampRatio(x, z, group) {
    windTick();
    const C = ctxAt(x, z, false, 1, 1, _ctxA), fs = shoreFrac(C);
    let a = 0, b = 0;
    for (let i = 0; i < N_GEO; i++) {
      if (group >= 0 && WAVES[i][6] !== group) continue;
      a += rowAmp(i, C, fs); b += rowA[i];
    }
    return b > 1e-6 ? a / b : 1;
  }
  CBZ.waterAmpAt = function (x, z) { return ampRatio(x, z, -1); };
  CBZ.waterChopAmpAt = function (x, z) { return ampRatio(x, z, GRP_WIND); };
  CBZ.waterDeepFactorAt = function (x, z) { return smooth(0, 12, fieldDepth(cityGeo, x, z)); };

  // ============================================================
  //  3. WHAT THE WATER TOUCHES — contact foam, river flow, the sky
  // ============================================================
  // CONTACT FOAM: the six nearest floating or standing things to the camera,
  // each a capsule (centre, half axis, radius, strength), from the
  // registries that already know where they are. CBZ.waterFoamSource(fn)
  // adds a provider; fn(push) calls push(x, z, hx, hz, radius, strength).
  // RIVER FLOW: the four channel segments nearest the camera; the CPU twin
  // CBZ.waterFlowAt reads the same four.
  const water2 = new THREE.Vector4(1, 1, 0, 0);    // y unused, z contact foam live, w river flow live
  const FOAM_N = 6;
  const foamA = [], foamB = [];
  for (let i = 0; i < FOAM_N; i++) foamA.push(new THREE.Vector4(0, 0, 0, 0));
  for (let i = 0; i < FOAM_N / 2; i++) foamB.push(new THREE.Vector4(0, 0, 0, 0));
  const FLOW_N = 4;
  const flowA = [], flowB = [];
  for (let i = 0; i < FLOW_N; i++) flowA.push(new THREE.Vector4(0, 0, 1, 0));
  for (let i = 0; i < FLOW_N / 2; i++) flowB.push(new THREE.Vector4(0, 0, 0, 0));
  const RIVER_SPEED = 0.95;

  const foamProviders = [];
  CBZ.waterFoamSource = function (fn) {
    if (typeof fn === "function" && foamProviders.indexOf(fn) < 0) foamProviders.push(fn);
    return fn;
  };
  const cand = [];
  let candN = 0, candCx = 0, candCz = 0;
  function pushFoam(x, z, hx, hz, r, s) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(s > 0.01)) return;
    const dx = x - candCx, dz = z - candCz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 260 * 260) return;
    let c = cand[candN];
    if (!c) c = cand[candN] = { x: 0, z: 0, hx: 0, hz: 0, r: 0, s: 0, d2: 0 };
    c.x = x; c.z = z; c.hx = +hx || 0; c.hz = +hz || 0; c.r = Math.max(0.15, +r || 0.5); c.s = s; c.d2 = d2;
    candN++;
  }
  function hullFoam(rec, moving) {
    if (!rec || rec.dead || !rec.pos || rec._far) return;
    const sp = rec._hullSpec || null;
    const loa = sp && sp.loa > 0 ? sp.loa : 6.2, beam = sp && sp.beam > 0 ? sp.beam : 2.1;
    const h = +rec.heading || 0;
    const v = Math.abs(+rec.v || 0);
    pushFoam(rec.pos.x, rec.pos.z, Math.sin(h) * loa * 0.40, Math.cos(h) * loa * 0.40, beam * 0.5,
      0.30 + Math.min(0.65, v * 0.06) * (moving ? 1 : 0.5));
  }
  const _occ = [];
  let occTick = 0;
  function gatherFoam() {
    candN = 0;
    const cam = CBZ.camera;
    if (!cam) return;
    candCx = cam.position.x; candCz = cam.position.z;
    const cars = CBZ.cityCars;
    if (cars && cars.length) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || c.dead || !c.pos) continue;
        const marine = c._hullSpec || (c._playerCarFeel && c._playerCarFeel.marine) || (c.model && c.model.body === "boat");
        if (marine) hullFoam(c, true);
      }
    }
    if (CBZ.seaCraft && typeof CBZ.seaCraft.list === "function") {
      const L = CBZ.seaCraft.list() || [];
      for (let i = 0; i < L.length; i++) if (L[i] && !L[i]._sinking) hullFoam(L[i], true);
    }
    const S = CBZ.sharkSeaScene;
    if (S && S.built && S.group && S.group.visible && S.obstacles) {
      for (let i = 0; i < S.obstacles.length; i++) {
        const o = S.obstacles[i];
        if (o) pushFoam(o.x, o.z, 0, 0, o.r || 0.3, 0.55);
      }
    }
    if (typeof CBZ.waterOccupants === "function") {
      let L = _occ;
      if ((++occTick % 3) === 1) { try { L = CBZ.waterOccupants(_occ); } catch (e) { L = null; } }
      if (L) for (let i = 0; i < L.length; i++) {
        const o = L[i];
        if (!o || o.kind === "boat") continue;
        if (!(o.submergence > 0.02) || o.submergence > 0.98) continue;
        const big = o.kind === "car";
        pushFoam(o.x, o.z, 0, 0, big ? 1.3 : 0.4, (o.moving ? 0.42 : 0.22) * (big ? 1.2 : 1));
      }
    }
    for (let i = 0; i < foamProviders.length; i++) {
      try { foamProviders[i](pushFoam); } catch (e) {}
    }
    for (let k = 0; k < FOAM_N; k++) {
      let best = -1, bd = 1e30;
      for (let i = 0; i < candN; i++) {
        const c = cand[i];
        if (c.d2 < 0) continue;
        const reach = Math.sqrt(c.hx * c.hx + c.hz * c.hz) + c.r;
        const d = Math.sqrt(c.d2) - reach;
        if (d < bd) { bd = d; best = i; }
      }
      const A = foamA[k], B = foamB[k >> 1];
      if (best < 0) {
        A.set(0, 0, 0, 0);
        if (k & 1) { B.z = 0; B.w = 0; } else { B.x = 0; B.y = 0; }
        continue;
      }
      const c = cand[best];
      c.d2 = -1;
      // fade out before a nearer source can take the slot, so a swap never pops
      const fade = 1 - Math.min(1, Math.max(0, (Math.max(0, bd) - 140) / 80));
      A.set(c.x, c.z, c.hx, c.hz);
      if (k & 1) { B.z = c.r; B.w = c.s * fade; } else { B.x = c.r; B.y = c.s * fade; }
    }
    water2.z = candN > 0 ? 1 : 0;
  }

  let flowSegs = null, flowSrc = null;
  function riverSegments() {
    const list = typeof CBZ.cityRivers === "function" ? CBZ.cityRivers() : null;
    if (!list || !list.length) { flowSegs = null; flowSrc = null; return null; }
    if (flowSrc === list.length && flowSegs) return flowSegs;
    const segs = [];
    for (let r = 0; r < list.length; r++) {
      const rv = list[r];
      const p = rv && rv.pts, h = rv && rv.half;
      if (!p || p.length < 2) continue;
      for (let i = 0; i + 1 < p.length; i++) {
        const hw = Array.isArray(h) ? (h[i] + h[i + 1]) * 0.5 : (+h || 40);
        segs.push({ x0: p[i].x, z0: p[i].z, x1: p[i + 1].x, z1: p[i + 1].z, hw: hw, d: 0 });
      }
    }
    flowSegs = segs; flowSrc = list.length;
    return segs;
  }
  const _usedSeg = [];
  function gatherFlow() {
    const cam = CBZ.camera;
    const segs = CFG.WATER_RIVER_FLOW === false ? null : riverSegments();
    if (!cam || !segs || !segs.length) {
      for (let i = 0; i < FLOW_N; i++) flowA[i].set(0, 0, 1, 0);
      for (let i = 0; i < FLOW_N / 2; i++) flowB[i].set(0, 0, 0, 0);
      water2.w = 0;
      return;
    }
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz || 1;
      let t = ((cx - s.x0) * vx + (cz - s.z0) * vz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      s.d = Math.hypot(cx - s.x0 - vx * t, cz - s.z0 - vz * t) - s.hw;
    }
    let live = 0;
    _usedSeg.length = 0;
    for (let k = 0; k < FLOW_N; k++) {
      let best = -1, bd = 1e30;
      for (let i = 0; i < segs.length; i++) {
        if (_usedSeg.indexOf(i) >= 0) continue;
        if (segs[i].d < bd) { bd = segs[i].d; best = i; }
      }
      const B = flowB[k >> 1];
      if (best < 0 || bd > 1500) {
        flowA[k].set(0, 0, 1, 0);
        if (k & 1) { B.z = 0; B.w = 0; } else { B.x = 0; B.y = 0; }
        continue;
      }
      _usedSeg.push(best);
      const s = segs[best];
      flowA[k].set(s.x0, s.z0, s.x1, s.z1);
      if (k & 1) { B.z = s.hw; B.w = RIVER_SPEED; } else { B.x = s.hw; B.y = RIVER_SPEED; }
      live++;
    }
    water2.w = live > 0 ? 1 : 0;
  }
  // CPU twin of cbzFlowAt(): (x, z) the surface current, f 0..1 inside a channel
  CBZ.waterFlowAt = function (x, z, out) {
    out = out || {};
    out.x = 0; out.z = 0; out.f = 0;
    if (!(water2.w > 0.5)) return out;
    for (let k = 0; k < FLOW_N; k++) {
      const A = flowA[k], B = flowB[k >> 1];
      const hw = (k & 1) ? B.z : B.x, sp = (k & 1) ? B.w : B.y;
      if (!(hw > 0)) continue;
      const abx = A.z - A.x, abz = A.w - A.y, L2 = Math.max(abx * abx + abz * abz, 1);
      let t = ((x - A.x) * abx + (z - A.y) * abz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - A.x - abx * t, z - A.y - abz * t);
      const f = 1 - smooth(hw * 0.70, hw * 1.02, d);
      if (f > out.f) {
        const q = d / hw, il = 1 / Math.sqrt(L2), v = sp * (1 - 0.55 * q * q);
        out.x = abx * il * v; out.z = abz * il * v; out.f = f;
      }
    }
    return out;
  };
  const _flowQ = { x: 0, z: 0, f: 0 };
  function riverAt(x, z) { return CBZ.waterFlowAt(x, z, _flowQ).f; }

  function flowGLSL() {
    const L = ["uniform vec4 uFlowA[" + FLOW_N + "];", "uniform vec4 uFlowB[" + (FLOW_N / 2) + "];",
      "vec3 cbzFlowAt(vec2 p) {", "  vec3 best = vec3(0.0);"];
    for (let k = 0; k < FLOW_N; k++) {
      const hs = "uFlowB[" + (k >> 1) + "]." + ((k & 1) ? "zw" : "xy");
      L.push("  { vec4 a = uFlowA[" + k + "]; vec2 hs = " + hs + ";");
      L.push("    if (hs.x > 0.0) {");
      L.push("      vec2 ab = a.zw - a.xy; float L2 = max(dot(ab, ab), 1.0);");
      L.push("      float tt = clamp(dot(p - a.xy, ab) / L2, 0.0, 1.0);");
      L.push("      float d = length(p - a.xy - ab * tt);");
      L.push("      float f = 1.0 - smoothstep(hs.x * 0.70, hs.x * 1.02, d);");
      L.push("      if (f > best.z) { float q = d / hs.x; best = vec3(ab * inversesqrt(L2) * hs.y * (1.0 - 0.55 * q * q), f); }");
      L.push("    } }");
    }
    L.push("  return best;", "}");
    return L.join("\n");
  }
  function foamGLSL() {
    const L = ["uniform vec4 uFoamA[" + FOAM_N + "];", "uniform vec4 uFoamB[" + (FOAM_N / 2) + "];",
      "float cbzContactFoam(vec2 p) {", "  float f = 0.0;"];
    for (let k = 0; k < FOAM_N; k++) {
      const rs = "uFoamB[" + (k >> 1) + "]." + ((k & 1) ? "zw" : "xy");
      L.push("  { vec4 a = uFoamA[" + k + "]; vec2 rs = " + rs + ";");
      L.push("    if (rs.y > 0.0) {");
      L.push("      vec2 q = p - a.xy; float L2 = max(dot(a.zw, a.zw), 0.0001);");
      L.push("      float tt = clamp(dot(q, a.zw) / L2, -1.0, 1.0);");
      L.push("      float d = max(0.0, length(q - a.zw * tt) - rs.x);");
      L.push("      f = max(f, rs.y * exp(-d / (0.35 + rs.x * 0.45)));");
      L.push("    } }");
    }
    L.push("  return clamp(f, 0.0, 1.0);", "}");
    return L.join("\n");
  }

  // ---- THE LIGHT THE WATER SEES: shared uniform objects, one drive a frame.
  // Every water material (and the tsunami's face and flood sheets) holds
  // these same objects, so they can never disagree about the sky.
  //   uKeyDir/uKeyRad  the key light (sun by day, moon by night): direction
  //                    and colour x intensity, exactly what lights the land
  //   uSkyAmb          the hemisphere's sky light (ambient on the water body)
  //   uGlintDir/Rad    the visible disc the specular path points at, and its
  //                    radiance (the key's, cut by the cloud deck)
  //   uSkyTex/uSkyTint the dome's own painted sky; uSkyLow/High its analytic
  //                    stand-in (horizon = fog colour) when no dome exists
  const LIGHT = {
    uKeyDir: { value: new THREE.Vector3(-0.34, 0.84, 0.42).normalize() },
    uKeyRad: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uSkyAmb: { value: new THREE.Color(0.55, 0.62, 0.72) },
    uGlintDir: { value: new THREE.Vector3(-0.34, 0.84, 0.42).normalize() },
    uGlintRad: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uSkyTex: { value: null },
    uSkyTint: { value: new THREE.Vector4(1, 1, 1, 0) },
    uSkyLow: { value: new THREE.Color(0xb6c4c8) },
    uSkyHigh: { value: new THREE.Color(0x42699a) },
    uFoamTex: { value: null },
    uWindDir: { value: windDirShade },
    uWaveRough: { value: waveRough },
    uPixAng: { value: 0.0012 },
  };
  CBZ.waterLightUniforms = function () {
    if (!LIGHT.uFoamTex.value) LIGHT.uFoamTex.value = CBZ.waterFoamTexture();
    return LIGHT;
  };
  const skyRef = { tex: null, tint: new THREE.Color(1, 1, 1), top: null };
  function gatherSky() {
    skyRef.tex = null; skyRef.top = null;
    const dome = CBZ.skyDome || (CBZ.micro && CBZ.micro.skyDome) || null;
    const m = dome && dome.material;
    if (!m) return;
    if (m.map && m.map.image) {
      skyRef.tex = m.map;
      skyRef.tint.copy(m.color || skyRef.tint.setRGB(1, 1, 1));
    } else if (m.uniforms && m.uniforms.topColor) {
      skyRef.top = m.uniforms.topColor.value;
    }
  }
  const _v3 = new THREE.Vector3(), _sunS = new THREE.Vector3();
  const _bodyC = new THREE.Color();
  function lightTick() {
    const L = LIGHT;
    // the angle one pixel spans: the footprint scale every water pixel uses
    const cam = CBZ.camera, cv = CBZ.renderer && CBZ.renderer.domElement;
    if (cam && cam.isPerspectiveCamera && cv && cv.height > 0) {
      L.uPixAng.value = 2 * Math.tan((cam.fov || 60) * Math.PI / 360) / ((cam.zoom || 1) * cv.height);
    }
    const sun = CBZ.sun, sunT = CBZ.sunTarget || (sun && sun.target) || null;
    if (sun && sunT) {
      _v3.copy(sun.position).sub(sunT.position);
      if (_v3.lengthSq() > 1e-6) L.uKeyDir.value.copy(_v3.normalize());
      const si = Number.isFinite(sun.intensity) ? sun.intensity : 1;
      L.uKeyRad.value.setRGB(sun.color.r * si, sun.color.g * si, sun.color.b * si);
    } else if (CBZ.sunTint) L.uKeyRad.value.copy(CBZ.sunTint);
    const hemi = CBZ.hemi;
    const fog = CBZ.scene && CBZ.scene.fog && CBZ.scene.fog.color;
    if (hemi && hemi.color) {
      const hi = Number.isFinite(hemi.intensity) ? hemi.intensity : 1;
      L.uSkyAmb.value.setRGB(hemi.color.r * hi, hemi.color.g * hi, hemi.color.b * hi);
    } else if (fog) L.uSkyAmb.value.copy(fog).multiplyScalar(0.7);
    // the glint follows the disc the sky draws (core/sky.js places it from
    // sunAngle; the moon opposite), not the key light's floored elevation
    const a = CBZ.sunAngle;
    let gw = 1;
    if (Number.isFinite(a)) {
      _sunS.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
      if (_sunS.y < 0) _sunS.set(Math.cos(a + Math.PI) * 80, Math.sin(a + Math.PI) * 95, -10).normalize();
      gw = smooth(0.0, 0.05, _sunS.y);
      L.uGlintDir.value.copy(_sunS);
    } else L.uGlintDir.value.copy(L.uKeyDir.value);
    const W = CBZ.weather;
    const oc = W ? Math.max(0, Math.min(1, +W.overcast || 0)) : 0;
    L.uGlintRad.value.copy(L.uKeyRad.value).multiplyScalar(gw * (1 - 0.92 * oc));
    if (fog) L.uSkyLow.value.copy(fog);
    if (skyRef.top) L.uSkyHigh.value.copy(skyRef.top);
    else L.uSkyHigh.value.copy(L.uSkyLow.value).multiplyScalar(0.55);
    const tx = CFG.WATER_SKY_REFLECT === false ? null : skyRef.tex;
    if (tx) {
      // the equirect lookup wraps in u across the atan seam
      if (tx.wrapS !== THREE.RepeatWrapping) { tx.wrapS = THREE.RepeatWrapping; tx.needsUpdate = true; }
      L.uSkyTex.value = tx;
      L.uSkyTint.value.set(skyRef.tint.r, skyRef.tint.g, skyRef.tint.b, 1);
    } else L.uSkyTint.value.w = 0;
    // the colour deep clear water shows under this light (the veil's target)
    const E = L.uKeyRad.value, A = L.uSkyAmb.value, ly = Math.max(0, L.uKeyDir.value.y);
    _bodyC.setRGB(BODY_RINF[0] * (E.r * ly + A.r), BODY_RINF[1] * (E.g * ly + A.g), BODY_RINF[2] * (E.b * ly + A.b));
  }
  // R-infinity of clear sea water (0.33 bb / (a + bb)), see cbzWaterShade
  const BODY_RINF = [0.33 * 0.010 / 0.460, 0.33 * 0.012 / 0.102, 0.33 * 0.013 / 0.073];

  let sceneStamp = -1;
  function sceneTick() {
    const stamp = CBZ.now || Math.floor((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.12);
    if (stamp === sceneStamp) return;
    sceneStamp = stamp;
    windTick();
    gatherFoam();
    gatherFlow();
    gatherSky();
    lightTick();
  }
  CBZ.waterSceneTick = sceneTick;

  // ============================================================
  //  4. SHARED GLSL
  // ============================================================
  function gnum(v) {
    let s = (+v).toPrecision(9);
    if (s.indexOf(".") < 0 && s.indexOf("e") < 0 && s.indexOf("E") < 0) s += ".0";
    return s;
  }
  // The rows: L = (lambda, shoal depth, group, k) is constant; K = (kx, kz,
  // omega, phase) is a uniform (the wind rows turn with the wind). Sorted
  // long -> short so loops can stop early. Amplitudes are packed 4 a vec4.
  const WAVE_GLSL = (function () {
    const Lr = [];
    for (let i = 0; i < N_WAVES; i++) {
      const r = WAVES[i];
      Lr.push("vec4(" + [r[5], r[7], r[6], r[2]].map(gnum).join(", ") + ")");
    }
    return [
      "uniform vec4 uRowA[" + N_PACK + "];",
      "uniform vec4 uRowTail[" + N_PACK + "];",
      "uniform vec4 uRowK[" + N_WAVES + "];",
      "uniform vec4 uWaveCtl;",
      "uniform vec2 uWaveSum;",
      "uniform vec4 uSeaMul;",          // x swell, y wind multiplier, z mesh spacing floor, w longest row drawn
      "uniform vec4 uDetailA;",         // the detail octaves' noise amplitudes (m)
      "uniform vec4 uDetailV;",         // ...and their slope variances
      "const vec4 CBZ_WL[" + N_WAVES + "] = vec4[" + N_WAVES + "](" + Lr.join(",\n  ") + ");",
      "float cbzShoreFrac(vec2 mul) { return min(1.0, " + gnum(SHORE_AMP) + " / max(0.001, dot(uWaveSum, mul))); }",
      "float cbzRowAmp(int i, vec2 mul, float depth, float calm, float fs) {",
      "  vec4 L = CBZ_WL[i];",
      "  float m = L.z < 0.5 ? mul.x : mul.y;",
      "  return uRowA[i >> 2][i & 3] * m * calm * (fs + (1.0 - fs) * smoothstep(0.0, L.y, depth));",
      "}",
      // the mesh spacing at a distance from the eye (radial and tangential
      // spacing are equal on the disc): rows shorter than ~4 of it cannot be
      // carried by vertices and are left to the pixel normal
      "float cbzMeshSpacing(float dist) { return max(uWaveCtl.y * dist, max(uWaveCtl.z, uSeaMul.z)); }",
      "vec3 cbzWaveDisp(vec2 p, float t, vec2 mul, float depth, float calm, float sp) {",
      "  float fs = cbzShoreFrac(mul); float Q = uWaveCtl.x;",
      "  vec3 d = vec3(0.0);",
      "  for (int i = 0; i < " + N_GEO + "; i++) {",
      "    vec4 L = CBZ_WL[i];",
      "    float lod = smoothstep(3.0, 5.0, L.x / sp);",
      "    if (lod <= 0.0) break;",
      "    if (L.x > uSeaMul.w) continue;",
      "    float a = cbzRowAmp(i, mul, depth, calm, fs) * lod;",
      "    vec4 K = uRowK[i];",
      "    float th = dot(p, K.xy) - t * K.z + K.w;",
      "    float c = cos(th);",
      "    vec2 dir = K.xy / L.w;",
      "    d += vec3(Q * a * dir.x * c, a * sin(th), Q * a * dir.y * c);",
      "  }",
      "  return d;",
      "}",
      // Per pixel: every row the pixel can resolve, faded as its wavelength
      // nears 2.5 pixel footprints (fp: the LONG axis of the footprint);
      // what fades goes into slope variance.
      // Returns (slope x, slope z, Jacobian, height); st = (summed amplitude, unresolved mss).
      "vec4 cbzWaveSurf(vec2 p, float t, vec2 mul, float depth, float calm, float fp, out vec2 st) {",
      "  float fs = cbzShoreFrac(mul); float Q = uWaveCtl.x;",
      "  float h = 0.0, hx = 0.0, hz = 0.0, sxx = 0.0, szz = 0.0, sxz = 0.0, asum = 0.0, mss = 0.0;",
      "  float cut = 2.5 * fp;",
      "  for (int i = 0; i < " + N_WAVES + "; i++) {",
      "    vec4 L = CBZ_WL[i];",
      "    if (L.x < cut) { mss += uRowTail[i >> 2][i & 3] * mul.y * mul.y * calm * calm; break; }",
      "    if (L.x > uSeaMul.w) continue;",
      "    float f = smoothstep(cut, cut * 1.6, L.x);",
      "    float a = cbzRowAmp(i, mul, depth, calm, fs);",
      "    float ka = L.w * a;",
      "    mss += 0.5 * ka * ka * (1.0 - f * f);",
      "    a *= f; ka *= f;",
      "    vec4 K = uRowK[i];",
      "    float th = dot(p, K.xy) - t * K.z + K.w;",
      "    float s = sin(th), c = cos(th);",
      "    vec2 dir = K.xy / L.w;",
      "    h += a * s; asum += a;",
      "    hx += ka * dir.x * c; hz += ka * dir.y * c;",
      "    float qs = Q * ka * s;",
      "    sxx += qs * dir.x * dir.x; szz += qs * dir.y * dir.y; sxz += qs * dir.x * dir.y;",
      "  }",
      "  float ny = (1.0 - sxx) * (1.0 - szz) - sxz * sxz;",
      "  float nx = -hz * sxz - (1.0 - szz) * hx;",
      "  float nz = -sxz * hx - hz * (1.0 - sxx);",
      "  float iy = 1.0 / max(0.05, ny);",
      "  st = vec2(asum, mss);",
      "  return vec4(-nx * iy, -nz * iy, ny, h);",
      "}",
      /* THE DETAIL FIELD: short-crested chop under the rows. Value noise
         with its analytic gradient (quintic), lattice wrapped at 289 so the
         hash never sees a large coordinate; octaves around 2 / 0.8 / 0.3 /
         0.12 m, two layers drifting different ways so it boils instead of
         sliding; a 20-60 m gust field makes calmer and rougher lanes.
         Returns (slope x, slope z, unresolved mss). w: the wind bearing. */
      "float cbzNHash(vec2 i) { vec3 q = fract(vec3(i.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
      "vec3 cbzVNoiseD(vec2 p) {",
      "  vec2 i = floor(p), f = fract(p);",
      "  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);",
      "  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);",
      "  i = mod(i, 289.0);",
      "  vec2 i1 = mod(i + 1.0, 289.0);",
      "  float a = cbzNHash(i), b = cbzNHash(vec2(i1.x, i.y)), c = cbzNHash(vec2(i.x, i1.y)), d = cbzNHash(i1);",
      "  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;",
      "  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y - 0.5, du * (vec2(k1, k2) + k4 * u.yx));",
      "}",
      "float cbzGust(vec2 p, float t, vec2 w) { return 0.4 + 1.2 * (cbzVNoiseD(p * 0.025 - w * t * 0.04).x + 0.5); }",
      "vec3 cbzDetail(vec2 p, float t, float fp, vec2 w, float k) {",
      "  vec2 c = vec2(-w.y, w.x);",
      // layer B runs 50 degrees off the wind, at its own pace
      "  vec2 wb = w * 0.643 + c * 0.766; vec2 cb = vec2(-wb.y, wb.x);",
      "  float g = cbzGust(p, t, w) * k;",
      "  vec2 s = vec2(0.0); float left = 0.0;",
      "  for (int o = 0; o < 4; o++) {",
      "    float cell = o == 0 ? 1.0 : (o == 1 ? 0.4 : (o == 2 ? 0.15 : 0.06));",
      "    float A = uDetailA[o] * g, V = uDetailV[o] * g * g;",
      "    float f = smoothstep(2.5 * fp, 4.0 * fp, 2.0 * cell);",
      "    left += V * (1.0 - f * f);",
      "    if (f <= 0.0) continue;",
      // phase speed of a wave the octave's size, for the drift
      "    float sp = sqrt(" + gnum(G_ACC) + " * cell / 3.14159) * 0.6;",
      "    vec2 qa = vec2(dot(p, w), dot(p, c)) / cell - vec2(sp * t / cell, 0.0) + float(o) * 17.3;",
      "    vec3 na = cbzVNoiseD(qa);",
      "    s += (w * na.y + c * na.z) * (A * f / cell);",
      "    if (o < 3) {",
      "      vec2 qb = vec2(dot(p, wb), dot(p, cb)) / (cell * 1.37) - vec2(sp * 0.7 * t / cell, 0.0) + float(o) * 5.1;",
      "      vec3 nb = cbzVNoiseD(qb);",
      "      s += (wb * nb.y + cb * nb.z) * (A * f / (cell * 1.37));",
      "    }",
      "  }",
      "  return vec3(s, left);",
      "}",
    ].join("\n");
  })();
  CBZ.waterWaveDecl = function () { return WAVE_GLSL; };

  // Statements declaring hName/dxName/dzName (height and slope) at pExpr, for
  // sheets that only want the field as a height (world/tsunami_flow.js). The
  // program must include CBZ.waterWaveDecl() and the common uniforms.
  // ampExpr / chopExpr are the surface's swell and wind multipliers.
  CBZ.waterWaveGLSL = function (pExpr, tExpr, ampExpr, hName, dxName, dzName, chopExpr) {
    return [
      "float " + hName + " = 0.0;",
      "float " + dxName + " = 0.0;",
      "float " + dzName + " = 0.0;",
      "{",
      "  vec2 wvP = " + pExpr + "; vec2 wvT;",
      "  vec4 wvS = cbzWaveSurf(wvP, " + tExpr + ", vec2(" + ampExpr + ", " + (chopExpr || ampExpr) + "), 0.0, 1.0,",
      "    cbzMeshSpacing(length(wvP - cameraPosition.xz)) * 1.6, wvT);",
      "  " + hName + " = wvS.w; " + dxName + " = wvS.x; " + dzName + " = wvS.y;",
      "}",
    ].join("\n");
  };

  const INLAND_FN = [
    "uniform vec4 uInlandBodies[" + MAX_INLAND + "];",
    // length(), not distance(): a page shader with a local named `distance`
    // must still compile with this grafted in
    "float cbzInlandFactor(vec2 p) {",
    "  float f = 0.0;",
    "  for (int i = 0; i < " + MAX_INLAND + "; i++) {",
    "    vec4 b = uInlandBodies[i];",
    "    float d = length(p - b.xy);",
    "    f = max(f, b.w * (1.0 - smoothstep(b.z * 0.55, b.z * 1.15, d)));",
    "  }",
    "  return f;",
    "}",
  ].join("\n");

  // The baked shore field: R land ramp, G = 1 - depth/2.4, B = depth/30,
  // A = surf exposure. Outside it (or with none) the sea is open and deep.
  const FIELD_GLSL = [
    "uniform sampler2D uSeaLandMask;",
    "uniform vec4 uSeaLandBounds;",
    "uniform float uSeaHasLandMask;",
    "vec4 cbzWaterField(vec2 p) {",
    "  vec4 f = vec4(0.0, 0.0, 1.0, 1.0);",
    "  if (uSeaHasLandMask > 0.5) {",
    "    vec2 uv = (p - uSeaLandBounds.xy) / max(vec2(1.0), uSeaLandBounds.zw - uSeaLandBounds.xy);",
    "    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) f = textureLod(uSeaLandMask, uv, 0.0);",
    "  }",
    "  return f;",
    "}",
    "float cbzFieldDepth(vec4 f) { return max(f.b * 30.0, (1.0 - f.g) * 2.4); }",
  ].join("\n");

  // Entry rings, GLSL twin of sampleSurfaceImpulses: (height, dh/dx, dh/dz, foam).
  const IMPULSE_GLSL = [
    "uniform vec4 uWaterImpulses[" + MAX_SURFACE_IMPULSES + "];",
    "uniform vec4 uWaterImpulseShapes[" + MAX_SURFACE_IMPULSES + "];",
    "vec4 cbzEntryImpulse(vec2 p, float nowT, float res) {",
    "  vec4 o = vec4(0.0);",
    "  for (int i = 0; i < " + MAX_SURFACE_IMPULSES + "; i++) {",
    "    vec4 q = uWaterImpulses[i];",
    "    vec4 sh = uWaterImpulseShapes[i];",
    "    float age = nowT - q.z;",
    "    if (q.w <= 0.0 || age < 0.0 || age >= sh.z) continue;",
    "    vec2 dp = p - q.xy;",
    "    float r = length(dp);",
    "    float Rs = sh.x, k0 = sh.y;",
    "    float tau = 0.9 * sqrt(Rs / " + gnum(G_ACC) + ") + 0.12;",
    "    float fill = exp(-age / tau);",
    "    float core = -q.w * exp(-r * r / (Rs * Rs)) * fill;",
    "    float dHdr = core * (-2.0 * r / (Rs * Rs));",
    "    float re = r + 0.5 * Rs;",
    "    float th = " + gnum(G_ACC) + " * age * age / (4.0 * re);",
    "    float kl = th / re;",
    "    float u = (kl / k0 - 1.0) / 0.5;",
    "    float lamL = " + gnum(TAU) + " / max(kl, 0.0001);",
    "    float env = exp(-u * u) * smoothstep(2.5 * res, 4.0 * res, lamL);",
    "    float A = min(q.w, 0.28 / k0) * sqrt(Rs / (Rs + r)) * exp(-age / sh.z) * (1.0 - fill);",
    "    float c = cos(th), s = sin(th);",
    "    dHdr += A * env * s * kl;",
    "    o.x += core + A * env * c;",
    "    if (r > 0.00001) o.yz += dp * (dHdr / r);",
    "    float steep = A * env * kl;",
    "    float rr = (r - Rs) / (0.5 * Rs);",
    "    float rim = exp(-rr * rr) * fill * min(1.0, q.w * 4.0) * 0.75;",
    "    o.w = max(o.w, max(smoothstep(0.14, 0.28, steep) * smoothstep(0.3, 0.9, c) * (1.0 - smoothstep(1.2 * Rs, 3.0 * Rs, r)) * 0.7, rim));",
    "  }",
    "  return o;",
    "}",
  ].join("\n");

  /* THE SEA'S LEVEL UNDER A TRAVELLING WAVE: ahead of a tsunami front the
     sea sits aheadDrop lower, and the island's lee gets a smaller, later
     share. CPU twin: frontFormulaDrop() below.
       uSeaFront  (cx, cz, dx, dz)     uSeaFrontS (frontS, aheadDrop, surge)
       uSeaLee    (Lb, La, lc, Lw)     uSeaLee2   (D0, sMid, sMax, on)       */
  const LEE_EXP = 1.3, LEE_SPREAD = 0.35;
  const LEE_GLSL = CBZ.waterLeeGLSL = [
    "float cbzLeeShadowP(vec2 xz, vec4 F, vec4 L, vec4 L2) {",
    "  vec2 r = xz - F.xy;",
    "  float s = dot(r, F.zw);",
    "  float rl = dot(r, vec2(-F.w, F.z)) - L.z, rs = s - L2.y;",
    "  float e = pow(clamp(0.5 - 0.5 * rs / max(length(vec2(rl, rs)), 1.0), 0.0, 1.0), " + gnum(LEE_EXP) + ");",
    "  float D = L2.x + " + gnum(LEE_SPREAD) + " * max(0.0, s - L2.z);",
    "  return (1.0 - e) * (1.0 - smoothstep(L.w, L.w + D, abs(rl)));",
    "}",
  ].join("\n");
  CBZ.waterLeeUniformsFill = function (F, L, L2) {
    const e = waterEvent, lee = e && e.lee && e.lee.on ? e.lee : null;
    if (!lee) { L2.w = 0; return false; }
    F.set(+e.cx || 0, +e.cz || 0, +e.dx || 0, +e.dz || 0);
    L.set(+lee.b || 0, +lee.a || 0, +lee.lc || 0, Math.max(1, +lee.lw || 1));
    L2.set(Math.max(1, +lee.d0 || 20), +lee.sMid || 0, +lee.sMax || 0, 1);
    return true;
  };
  const FRONT_DROP_GLSL = [
    "uniform vec4 uSeaFront;",
    "uniform vec3 uSeaFrontS;",
    "uniform vec4 uSeaLee;",
    "uniform vec4 uSeaLee2;",
    LEE_GLSL,
    "float cbzLeeShadow(vec2 xz) { return cbzLeeShadowP(xz, uSeaFront, uSeaLee, uSeaLee2); }",
    "float cbzFrontDrop(vec2 xz) {",
    "  if (uSeaFrontS.y < 0.001 && uSeaLee2.w < 0.5) return 0.0;",
    "  float fk = clamp((dot(xz - uSeaFront.xy, uSeaFront.zw) - uSeaFrontS.x + 1.0) / 8.0, 0.0, 1.0);",
    "  fk = fk * fk * (3.0 - 2.0 * fk);",
    "  float d = max(uSeaFrontS.y, 0.0) * fk;",
    "  if (uSeaLee2.w > 0.5) d += cbzLeeShadow(xz) * mix(uSeaLee.x, uSeaLee.y, fk);",
    "  return d;",
    "}",
  ].join("\n");

  // B's wake field (world/water_wake.js), evaluated when a material is built:
  // .xy extra slope, .z foam cover, .w height offset (m).
  function wakeDecl() {
    return (typeof CBZ.waterWakeGLSL === "function") ? CBZ.waterWakeGLSL() : "vec4 cbzWake(vec2 xz){ return vec4(0.0); }";
  }

  // Everything both stages of a sea program share.
  function commonDecl() {
    return [
      "uniform float uSeaTime;",
      "uniform float uSeaY;",
      WAVE_GLSL,
      FIELD_GLSL,
      INLAND_FN,
      flowGLSL(),
      IMPULSE_GLSL,
      FRONT_DROP_GLSL,
    ].join("\n");
  }
  CBZ.waterVertexDecl = function () {
    return [commonDecl(), wakeDecl(), "varying vec4 vSeaP;"].join("\n");
  };

  /* ============================================================
     THE OPTICS: ONE SHADING MODEL FOR EVERY WATER SURFACE
     ============================================================
     cbzWaterShade(P, fq, N, V, mss, depth, turb, foam, crest, allow, fp, t)
       fq     the foam pattern's coordinates (world xz on a sea, the face's own on a wall)
       P      world position; N the true surface normal; V toward the eye
       mss    slope variance the normal does not carry (roughness)
       depth  metres of water under the surface (the bed is that far down)
       turb   0 clear .. 1 a mud suspension
       foam   0..1 foam cover from every source
       crest  0..1 how far up a thin crest this is (backlit glow)
       allow  0..1 how much of the real geometry behind may show through
       fp     the pixel's footprint on the water (m)
     returns (straight colour, alpha): the sheet blends over the bed it covers,
     so alpha is the light the surface and the column stop.

     The body is a medium, not a paint: absorption a and backscatter bb per
     metre (clear sea: red dies first; silt raises both and browns it),
     R-infinity = 0.33 bb / (a + bb) lit by the scene's own sun and sky, and
     Beer-Lambert transmittance over the path down to the bed and back up.
     Scalar alpha cannot tint what is behind per channel, so the sheet's
     alpha carries the green transmittance and the colour adds the difference
     against a sand estimate. */
  const SHADE_GLSL = [
    "uniform vec3 uKeyDir;",
    "uniform vec3 uKeyRad;",
    "uniform vec3 uSkyAmb;",
    "uniform vec3 uGlintDir;",
    "uniform vec3 uGlintRad;",
    "uniform sampler2D uSkyTex;",
    "uniform vec4 uSkyTint;",
    "uniform vec3 uSkyLow;",
    "uniform vec3 uSkyHigh;",
    "uniform sampler2D uFoamTex;",
    "uniform vec2 uWindDir;",
    "uniform vec4 uWaveRough;",
    "uniform float uPixAng;",          // radians one pixel spans (the footprint's scale)
    "float cbzHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
    // value noise, lattice wrapped so the hash never sees a large coordinate
    "float cbzSNoise(vec2 p) {",
    "  vec2 i = mod(floor(p), 289.0), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  vec2 i1 = mod(i + 1.0, 289.0);",
    "  return mix(mix(cbzHash(i), cbzHash(vec2(i1.x, i.y)), f.x), mix(cbzHash(vec2(i.x, i1.y)), cbzHash(i1), f.x), f.y);",
    "}",
    /* The dome's radiance along a reflected ray, as a rough surface sees it:
       the unresolved facets spread the lobe (a blurrier mip) and, seen at a
       grazing angle, turn their mean reflection up the sky (facets facing the
       eye are the ones it sees), so a rough far sea mirrors the darker sky
       above the horizon instead of the white haze on it. */
    "vec3 cbzSky(vec3 R, float m) {",
    "  float ry = max(R.y, 0.0);",
    "  ry += (1.0 - ry) * clamp(m * 1.1, 0.0, 0.55);",
    "  vec3 a = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 0.55, ry));",
    "  if (uSkyTint.w > 0.5) {",
    "    vec3 d = normalize(vec3(R.x, max(ry, 0.004), R.z));",
    "    float u = atan(d.z, -d.x) * 0.15915494 + 0.5;",
    "    float v = 1.0 - acos(clamp(d.y, -1.0, 1.0)) * 0.31830989;",
    "    vec3 tx = textureLod(uSkyTex, vec2(u, v), clamp(log2(1.0 + 330.0 * m), 0.0, 8.0)).rgb * uSkyTint.rgb;",
    // the dome is painted with distant land and haze bands near its horizon:
    // those are not mirrored (a hard silhouette in the water); the low sky is
    // its analytic gradient, the dome's clouds and deck come in above it
    "    a = mix(a, tx, smoothstep(0.10, 0.30, d.y));",
    "  }",
    "  return a;",
    "}",
    "float cbzSchlick(float c) { float x = 1.0 - clamp(c, 0.0, 1.0); float x2 = x * x; return 0.02 + 0.98 * x2 * x2 * x; }",
    "float cbzGGX(float nh, float m2) { float d = nh * nh * (m2 - 1.0) + 1.0; return m2 / (3.14159265 * d * d); }",
    /* ONE FOAM LOOK. Cover erodes a pattern of bubbly clumps (soft value
       noise at ~1 m and ~0.4 m) laced with bubble walls (the foam tile, a
       second tap stretched down the wind so a gale's old foam lies in
       streaks): thick cover is solid but mottled, thin cover breaks into
       clumps and lace, every transition soft. A diffuse body (albedo
       0.76-0.9) lit by the key and the sky, so it greys under overcast and
       goes dark at night. Past a few pixels per clump it is its mean cover. */
    "vec4 cbzFoamLook(vec2 p, float cov, vec3 N, float fp, float t) {",
    "  vec2 w = normalize(uWindDir); vec2 c = vec2(-w.y, w.x);",
    "  float st = mix(1.6, 4.0, uWaveRough.y);",
    // clumps first; the bubble walls are looked up through a warp by them so
    // no wall runs straight, and every octave smaller than ~3 pixels is its mean
    "  float kb = 1.0 - smoothstep(0.15, 0.45, fp);",
    "  float blob = cbzSNoise(p * 0.9 + vec2(t * 0.05, -t * 0.03)) * 0.6 + mix(0.5, cbzSNoise(p * 2.3 - vec2(t * 0.07, t * 0.04)), kb) * 0.4;",
    "  vec2 wq = p + (vec2(blob, cbzSNoise(p * 0.7 + 9.1)) - 0.5) * 0.9;",
    "  float lace = mix(0.5, texture(uFoamTex, wq * 0.23 + vec2(t * 0.011, -t * 0.008)).r, 1.0 - smoothstep(0.08, 0.25, fp));",
    "  float lace2 = mix(0.5, texture(uFoamTex, vec2(dot(wq, w) * 0.09 / st - t * 0.004, dot(wq, c) * 0.09)).g, 1.0 - smoothstep(0.25, 0.75, fp));",
    "  float n = blob * 0.55 + (lace * 0.6 + lace2 * 0.4) * 0.45;",
    "  cov = clamp(cov, 0.0, 1.0);",
    "  float thr = 1.0 - cov;",
    "  float soft = 0.16 + 0.3 * smoothstep(0.02, 0.5, fp);",
    "  float o = smoothstep(thr - soft, thr + soft * 0.6, n) * smoothstep(0.0, 0.25, cov);",
    "  o = mix(o, cov * 0.9, smoothstep(0.12, 0.45, fp));",
    "  float alb = 0.76 + 0.14 * blob;",
    "  vec3 Nf = normalize(N + vec3(blob - 0.5, 0.0, lace - 0.5) * 0.35);",
    "  vec3 lit = alb * (uKeyRad * max(dot(Nf, uKeyDir), 0.0) + uSkyAmb * (0.55 + 0.45 * Nf.y));",
    "  return vec4(lit, clamp(o, 0.0, 0.96));",
    "}",
    "vec4 cbzWaterShade(vec3 P, vec2 fq, vec3 N, vec3 V, float mss, float depth, float turb, float foam, float crest, float allow, float fp, float t) {",
    "  float m2 = clamp(mss, 0.0004, 0.5); float m = sqrt(m2);",
    "  float ndv = max(dot(N, V), 0.0);",
    // a rough sea never shows a facet edge-on: at grazing the mean slope turns facets back toward the eye
    "  float F = cbzSchlick(max(ndv, 1.1 * m));",
    "  vec3 R = reflect(-V, N);",
    "  vec3 sky = cbzSky(R, m);",
    "  turb = clamp(turb, 0.0, 1.0);",
    "  float aer = clamp(foam, 0.0, 1.0);",
    // clear tropical water: red dies in metres, blue carries; little scatter.
    // Silt raises absorption (browning) far more than backscatter: a heavy
    // load reflects only ~5-8% (dark brown-grey), so its gloss reads; the bubbles under
    // foam scatter grey and the water above them tints it turquoise.
    "  vec3 ab = vec3(0.35, 0.045, 0.02) + turb * vec3(1.6, 1.9, 2.5);",
    "  vec3 bb = vec3(0.0035, 0.0045, 0.0055) + turb * vec3(0.57, 0.45, 0.43) + aer * vec3(0.3);",
    "  vec3 ext = ab + vec3(0.02) + turb * vec3(9.0) + aer * vec3(0.6);",
    "  vec3 Rinf = 0.33 * bb / (ab + bb);",
    "  vec3 L = uKeyDir;",
    // a clear body is lit through the surface; a suspension scatters at the
    // surface, so its light follows the surface's relief
    "  vec3 E = mix(uKeyRad * max(L.y, 0.0) + uSkyAmb, uKeyRad * max(dot(N, L), 0.0) + uSkyAmb * (0.55 + 0.45 * N.y), turb);",
    "  float cosT = sqrt(max(0.0, 1.0 - (1.0 - ndv * ndv) / 1.7769));",
    "  float pf = 1.0 + 1.0 / max(cosT, 0.2);",
    "  vec3 Tr = exp(-ext * max(depth, 0.0) * pf);",
    "  vec3 body = Rinf * E * (1.0 - Tr);",
    // light through a thin crest, looking toward the light
    "  vec3 Lh = normalize(vec3(L.x, max(L.y, 0.0) * 0.3, L.z));",
    "  float back = pow(clamp(dot(-V, Lh), 0.0, 1.0), 4.0);",
    "  body += uKeyRad * exp(-ext * 1.2) * (0.07 * back * clamp(crest, 0.0, 4.0) * (1.0 - 0.7 * turb));",
    /* What lies behind the sheet shows through it only as far as physics
       lets it: (1 - Fresnel) of the surface (the flat one too, so a grazing
       view is a mirror) times the transmittance along the refracted path
       down the column. Near the eye the column is the first 2.5 m (a
       swimmer, a hull below its waterline); from ~30 m out it is the real
       depth, so deep water is opaque and only shallows show their sand. */
    "  float eyeD = length(cameraPosition - P);",
    // (blended on the column itself over a long range: a jump from 2.5 m to
    // the real depth a few metres out drew a disc on the sea round the camera)
    "  float colD = mix(min(max(depth, 0.0), 2.5), max(depth, 0.0), smoothstep(10.0, 90.0, eyeD));",
    "  vec3 TrV = exp(-ext * colD * pf);",
    "  float tb = TrV.g * clamp(allow, 0.0, 1.0);",
    // Refraction bends a low sight line steeply down, so from near the
    // surface you see the bed under the water in front of you, never a rock
    // or a reef far off under it. The rasteriser's ray runs on straight, so
    // deep water only shows what is behind it when you look down into it;
    // a film or the shallows (the bed is right there) show at any angle.
    "  tb *= mix(1.0, smoothstep(0.22, 0.55, abs(V.y)), smoothstep(0.3, 1.5, depth));",
    "  float Fs = max(F, cbzSchlick(abs(V.y)));",
    "  vec3 bedEst = vec3(0.36, 0.33, 0.26) * E;",
    "  vec3 sub = body + (Tr - tb) * bedEst * (1.0 - smoothstep(colD, colD + 1.0, depth));",
    "  vec3 col = mix(sub, sky, F);",
    // ONE lobe for the sun or the moon, as wide as the slope the pixel cannot
    // resolve; the glitter in it comes from the per-pixel normal
    "  vec3 H = normalize(uGlintDir + V);",
    "  float nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.05), nl = max(dot(N, uGlintDir), 0.0);",
    "  float spec = 3.14159265 * cbzGGX(nh, m2) * cbzSchlick(vh) * nl / (4.0 * vh * vh);",
    "  col += uGlintRad * spec;",
    "  vec4 fo = cbzFoamLook(fq, foam, N, fp, t);",
    "  col = mix(col, fo.rgb, fo.a);",
    "  float alpha = 1.0 - (1.0 - Fs) * tb * (1.0 - fo.a);",
    "  return vec4(col / max(alpha, 0.02), alpha);",
    "}",
    // from below: Snell's window (refract() decides; total internal reflection
    // outside it shows the water column)
    "vec4 cbzWaterShadeUnder(vec3 N, vec3 V, float mss, vec3 tirCol) {",
    "  vec3 n = -N;",
    "  float cw = clamp(dot(n, V), 0.0, 1.0);",
    "  float k = 1.0 - 1.7769 * (1.0 - cw * cw);",
    "  float win = smoothstep(-0.06, 0.32, k);",
    "  vec3 rt = refract(-V, n, 1.333);",
    "  vec3 ru = normalize(rt + vec3(0.0, 0.002, 0.0));",
    "  vec3 skyW = cbzSky(ru, sqrt(clamp(mss, 0.0004, 0.5))) * 0.9 + uGlintRad * pow(max(dot(ru, uGlintDir), 0.0), 48.0) * 0.6;",
    "  return vec4(mix(tirCol, skyW, win), 1.0);",
    "}",
  ].join("\n");
  CBZ.waterShadeGLSL = function () { return SHADE_GLSL; };

  /* WET GROUND, for an alpha-blended overlay over whatever ground is drawn
     under it: returns (A, B) with the result A + B * ground. Bottom up:
     a deposit (lit albedo, cover), the soaking (water in the pores darkens
     what is under it by ~45%), something lying on top (weed: lit colour,
     cover), and the water on it through cbzWaterShade: a film of a few
     millimetres where soaked (the gloss: sky by Fresnel and the sun lobe),
     real standing water where `film` is centimetres. Blend with
     alpha = 1 - B, colour = A / alpha. Needs CBZ.waterShadeGLSL() first. */
  CBZ.waterWetGroundGLSL = function () {
    return [
      "vec4 cbzWetGround(vec3 P, vec3 N, vec3 V, float soak, float film, vec3 depAlb, float depCover, vec3 topC, float topCover, float turbW, float fp, float t) {",
      "  vec3 E = uKeyRad * max(dot(N, uKeyDir), 0.0) + uSkyAmb * (0.55 + 0.45 * N.y);",
      "  vec3 A = depCover * depAlb * E; float B = 1.0 - depCover;",
      "  float dk = 0.45 * clamp(soak, 0.0, 1.0);",
      "  A *= 1.0 - dk; B *= 1.0 - dk;",
      "  A = A * (1.0 - topCover) + topC * E * topCover * (1.0 - 0.3 * soak); B *= 1.0 - topCover;",
      "  float flatW = smoothstep(0.004, 0.03, film);",
      "  float cw = max(clamp(soak, 0.0, 1.0), smoothstep(0.0, 0.004, film));",
      "  vec3 Nw = normalize(mix(N, vec3(0.0, 1.0, 0.0), flatW));",
      "  vec4 sh = cbzWaterShade(P, P.xz, Nw, V, mix(0.03, 0.003, flatW), film + 0.002 * soak, turbW, 0.0, 0.0, 1.0, fp, t);",
      "  float k = cw * sh.a;",
      "  A = cw * sh.rgb * sh.a + (1.0 - k) * A; B *= 1.0 - k;",
      "  return vec4(A, B);",
      "}",
    ].join("\n");
  };

  // The sea's own pieces: shore surf, whitecaps, contact foam, flow ripples, lamps.
  function seaFragLib() {
    return [
      SHADE_GLSL,
      "uniform vec4 uSwash;",          // x run-up range (m), z on
      "uniform vec4 uWater2;",
      foamGLSL(),
      "vec2 cbzSwash(vec2 p, float t) {",
      "  if (uSwash.z < 0.5) return vec2(0.0);",
      "  float ph = dot(p, vec2(" + gnum(SWASH_PH[0]) + ", " + gnum(SWASH_PH[1]) + "));",
      "  float a0 = t * 0.35 + ph * 1.7;",
      "  float a1 = t * 0.61 + ph * 2.9 + 1.70;",
      "  float a2 = t * 1.10 + ph * 4.3 + 3.40;",
      "  float s = 0.60 * sin(a0) + 0.30 * sin(a1) + 0.10 * sin(a2);",
      "  float v = 0.21 * cos(a0) + 0.183 * cos(a1) + 0.11 * cos(a2);",
      "  return vec2(s, v) * uSwash.x;",
      "}",
      // Surf: waves break where the water is about as deep as they are tall,
      // and the broken bores run in along the depth contours to the swash edge.
      "float cbzSurfFoam(vec2 p, float depth, float Hloc, float expo, float t) {",
      "  if (expo < 0.01) return 0.0;",
      "  float Hb = max(0.12, Hloc);",
      "  float zone = 1.0 - smoothstep(0.9 * Hb, 1.8 * Hb, depth);",
      "  if (zone <= 0.0) return 0.0;",
      "  float n = cbzHash(floor(p * 0.25));",
      "  float band = sin(depth * 5.0 / Hb + t * 1.25 + n * 1.5 + dot(p, vec2(0.013, 0.021)));",
      "  float bore = smoothstep(0.25, 0.95, band) * zone;",
      "  vec2 sw = cbzSwash(p, t);",
      "  float adv = clamp(sw.y / max(uSwash.x, 0.01) * 3.0, 0.0, 1.0);",
      "  float edge = 1.0 - smoothstep(0.0, 0.10 + 0.22 * adv, depth);",
      "  return clamp(bore * 0.85 + zone * 0.18 + edge * 0.9, 0.0, 1.0) * expo;",
      "}",
      // Whitecaps: steep crests (low Jacobian) only, more with the wind; far
      // away, where the crests are sub-pixel, their mean cover.
      "float cbzWhitecap(float J, float hN, float fp, vec2 p, float t) {",
      "  float cap = uWaveRough.y;",
      "  if (cap < 0.002) return 0.0;",
      "  float thr = mix(0.42, 0.10, sqrt(cap));",
      "  float c = smoothstep(thr, thr + 0.12, 1.0 - J) * smoothstep(0.05, 0.55, hN) * clamp(cap * 8.0, 0.0, 1.0);",
      // breaking is patchy along a crest: irregular patches, never a ruled claw
      "  c *= smoothstep(0.3, 0.7, cbzSNoise(p * 0.11 + vec2(t * 0.03, -t * 0.02)) * 0.7 + cbzSNoise(p * 0.37 - t * 0.05) * 0.3);",
      "  return mix(c, cap * 0.35, smoothstep(0.8, 10.0, fp));",
      "}",
      /* Short low ripples riding a current (rivers, the flood on the land):
         three rows across the flow, half carried by it and half standing
         against it (the waves a bed pins in fast water). (slope x, slope z, foam) */
      "vec3 cbzFlowRipple(vec2 p, vec2 v, float k, float fp, float t) {",
      "  float sp = length(v);",
      "  if (sp < 0.02 || k <= 0.0) return vec3(0.0);",
      "  vec2 d = v / sp; vec2 c = vec2(-d.y, d.x);",
      "  vec3 o = vec3(0.0);",
      "  for (int i = 0; i < 3; i++) {",
      "    float fi = float(i);",
      "    float lam = 1.7 * pow(0.6, fi);",
      "    float f = smoothstep(2.5 * fp, 4.0 * fp, lam);",
      "    if (f <= 0.0) break;",
      "    vec2 dir = normalize(d + c * (fi - 1.0) * 0.35);",
      "    float kk = " + gnum(TAU) + " / lam;",
      "    float ph = mod(fi, 2.0) < 0.5 ? kk * dot(dir, p - v * t) : kk * dot(dir, p) + fi * 1.7;",
      "    float a = (0.06 + 0.05 * min(sp, 4.0)) * k * f / kk;",
      "    o.xy += dir * (kk * a * cos(ph));",
      "    o.z = max(o.z, smoothstep(0.7, 1.0, sin(ph)) * smoothstep(1.5, 4.0, sp) * k);",
      "  }",
      "  return o;",
      "}",
      "uniform vec4 uSeaLamps[" + SEA_LAMPS + "];",
      "uniform vec4 uSeaLampC;",
      "vec3 cbzLampGlints(vec3 N, vec3 V, vec3 P, float m2) {",
      "  float acc = 0.0;",
      "  for (int i = 0; i < " + SEA_LAMPS + "; i++) {",
      "    if (float(i) >= uSeaLampC.w) break;",
      "    vec4 Lp = uSeaLamps[i];",
      "    vec3 Ld = Lp.xyz - P;",
      "    float dl = length(Ld);",
      "    vec3 Lu = Ld / max(dl, 0.01);",
      "    vec3 H = normalize(Lu + V);",
      "    float vh = max(dot(V, H), 0.05);",
      "    acc += cbzGGX(max(dot(N, H), 0.0), max(m2, 0.002)) * cbzSchlick(vh) * max(dot(N, Lu), 0.0) / (4.0 * vh * vh) * Lp.w / (1.0 + dl * 0.012);",
      "  }",
      "  return uSeaLampC.rgb * acc;",
      "}",
    ].join("\n");
  }
  CBZ.waterFragmentDecl = function () {
    return [commonDecl(), wakeDecl(), seaFragLib(), "varying vec4 vSeaP;"].join("\n");
  };
  CBZ.waterClarityGLSL = function () { return "uniform vec4 uClarity;"; };

  // ============================================================
  //  5. SHARED UNIFORMS
  // ============================================================
  // Never through UniformsUtils.merge(): it clones every value and severs the
  // references the drivers write through. Only the fog block is cloned.
  CBZ.waterCommonUniforms = function () {
    const u = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    const Lt = CBZ.waterLightUniforms();
    for (const k in Lt) u[k] = Lt[k];
    // the old names, the same objects (sheets that shade themselves read them)
    u.uSunDir = Lt.uKeyDir;
    u.uSunColor = Lt.uKeyRad;
    u.uSeaTime = { value: 0 };
    u.uSeaY = { value: CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK };
    // a sheet's own tint hook (no water shader reads it; kept for callers)
    u.uSeaColor = { value: new THREE.Color(0x0a2a33) };
    u.uSeaLandMask = { value: null };
    u.uSeaLandBounds = { value: new THREE.Vector4(0, 0, 1, 1) };
    u.uSeaHasLandMask = { value: 0 };
    // The shoreline cut: the field's R ramp is discarded above this. Raising
    // it walks the waterline inland (a surge); 0.5 is the real coast.
    u.uShoreCut = { value: 0.5 };
    u.uSeaFront = { value: new THREE.Vector4(0, 0, 1, 0) };
    u.uSeaFrontS = { value: new THREE.Vector3(-1e9, 0, 0) };
    u.uSeaLee = { value: new THREE.Vector4(0, 0, 0, 1) };
    u.uSeaLee2 = { value: new THREE.Vector4(20, 0, 0, 0) };
    u.uInlandBodies = { value: inlandVecs };
    u.uWaterImpulses = { value: surfaceImpulses };
    u.uWaterImpulseShapes = { value: surfaceImpulseShapes };
    u.uImpLive = { value: 0 };
    u.uRowA = { value: rowA };
    u.uRowTail = { value: rowTail };
    u.uRowK = { value: rowK };
    u.uDetailA = { value: detailAmp };
    u.uDetailV = { value: detailVar };
    u.uWaveCtl = { value: waveCtl };
    u.uWaveSum = { value: waveSum };
    // x swell / y wind multiplier (an island's sea state), z the mesh spacing
    // floor, w the longest row this surface draws
    u.uSeaMul = { value: new THREE.Vector4(1, 1, 0, 1e5) };
    u.uSwash = { value: new THREE.Vector4(SWASH_RANGE, 1.0, swashOn() ? 1 : 0, 0) };
    u.uSeaLamps = { value: [] };
    for (let i = 0; i < SEA_LAMPS; i++) u.uSeaLamps.value.push(new THREE.Vector4(0, -1e4, 0, 0));
    u.uSeaLampC = { value: new THREE.Vector4(1.0, 0.72, 0.42, 0) };
    u.uWater2 = { value: water2 };
    u.uFoamA = { value: foamA };
    u.uFoamB = { value: foamB };
    u.uFlowA = { value: flowA };
    u.uFlowB = { value: flowB };
    // x see-through allowance, z/w the distance window it lives in
    u.uClarity = { value: new THREE.Vector4(translucentOn() ? 1 : 0, 0, CLARITY_NEAR, CLARITY_FAR) };
    u.uCaustic = { value: CBZ.waterCausticTexture() };
    if (typeof CBZ.waterWakeUniforms === "function") { try { Object.assign(u, CBZ.waterWakeUniforms()); } catch (e) {} }
    return u;
  };

  // Per-frame driver for any sea material's uniform block.
  CBZ.waterDriveCommonUniforms = function (u) {
    if (!u) return;
    sceneTick();
    if (u.uSeaTime) u.uSeaTime.value = CBZ.waterClock();
    if (u.uImpLive) u.uImpLive.value = CBZ.waterImpulsesLive(u.uSeaTime ? u.uSeaTime.value : undefined) ? 1 : 0;
    if (u.uSeaY && !u.fixedSeaY) u.uSeaY.value = seaY();
    if (u.uShoreCut) u.uShoreCut.value = 0.5 + Math.min(0.42, Math.max(0, _surge) * SHORE_CUT_PER_M);
    if (u.uSeaFront) {
      const e = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
      const lee = e && e.lee && e.lee.on ? e.lee : null;
      if (e && (e.aheadDrop > 0.001 || lee)) {
        u.uSeaFront.value.set(+e.cx || 0, +e.cz || 0, +e.dx || 0, +e.dz || 0);
        u.uSeaFrontS.value.set(Number.isFinite(e.frontS) ? +e.frontS : -1e9, Math.max(0, +e.aheadDrop || 0), _surge);
      } else u.uSeaFrontS.value.y = 0;
      if (u.uSeaLee) {
        if (lee) {
          u.uSeaLee.value.set(+lee.b || 0, +lee.a || 0, +lee.lc || 0, Math.max(1, +lee.lw || 1));
          u.uSeaLee2.value.set(Math.max(1, +lee.d0 || 20), +lee.sMid || 0, +lee.sMax || 0, 1);
        } else u.uSeaLee2.value.w = 0;
      }
    }
    if (u.uSwash) { u.uSwash.value.x = SWASH_RANGE; u.uSwash.value.z = swashOn() ? 1 : 0; }
    if (u.uClarity) {
      u.uClarity.value.x = translucentOn() && !u.noClarity ? 1 : 0;
      u.uClarity.value.z = CLARITY_NEAR; u.uClarity.value.w = CLARITY_FAR;
    }
    veilDrive(u);
    causticDrive(u);
  };

  /* THE VEIL — what the water column does to a body seen through it. A
     submerged animal's own materials are patched with one Beer-Lambert term
     over the length of water between it and the eye (|CP| b / (a + b) for an
     eye a above and a fragment b below the surface), fading it toward the
     colour deep water has under the live light. Cached clone per source
     material; chained onto any onBeforeCompile it already has. The camera
     under water is world/water_underwater.js's business, so the veil stands
     down there. The eye is rebuilt from viewMatrix because Lambert materials
     are not sent cameraPosition. */
  const VEIL_U = {
    uVeilSeaY: { value: 0 },
    uVeilK: { value: VEIL_K },
    uVeilColor: { value: new THREE.Color(0x11384f) },
  };
  CBZ.waterVeilUniforms = VEIL_U;
  const _veilCache = new WeakMap();
  function veilBefore(shader) {
    if (shader.vertexShader.indexOf("#include <project_vertex>") < 0) return;
    if (shader.vertexShader.indexOf("#include <common>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <tonemapping_fragment>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <common>") < 0) return;
    shader.uniforms.uVeilSeaY = VEIL_U.uVeilSeaY;
    shader.uniforms.uVeilK = VEIL_U.uVeilK;
    shader.uniforms.uVeilColor = VEIL_U.uVeilColor;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCbzVeilW;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n" +
        "vec4 cbzVeilP = vec4( transformed, 1.0 );\n" +
        "#ifdef USE_INSTANCING\n  cbzVeilP = instanceMatrix * cbzVeilP;\n#endif\n" +
        "vCbzVeilW = ( modelMatrix * cbzVeilP ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vCbzVeilW;\nuniform float uVeilSeaY;\nuniform float uVeilK;\nuniform vec3 uVeilColor;")
      .replace("#include <tonemapping_fragment>",
        "vec3 cbzVeilEye = -vec3( dot( viewMatrix[0].xyz, viewMatrix[3].xyz ),\n" +
        "                         dot( viewMatrix[1].xyz, viewMatrix[3].xyz ),\n" +
        "                         dot( viewMatrix[2].xyz, viewMatrix[3].xyz ) );\n" +
        "float cbzAC = cbzVeilEye.y - uVeilSeaY;\n" +
        "float cbzBP = vCbzVeilW.y - uVeilSeaY;\n" +
        "if ( uVeilK > 0.0 && cbzAC > 0.0 && cbzBP < 0.0 ) {\n" +
        "  float cbzL = length( vCbzVeilW - cbzVeilEye ) * ( -cbzBP ) / max( 0.05, cbzAC - cbzBP );\n" +
        "  gl_FragColor.rgb = mix( uVeilColor, gl_FragColor.rgb, exp( -cbzL * uVeilK ) );\n" +
        "}\n#include <tonemapping_fragment>");
  }
  CBZ.waterVeilMaterial = function (mat) {
    if (!mat || !translucentOn()) return mat;
    if (mat.userData && mat.userData.cbzVeiled) return mat;
    const hit = _veilCache.get(mat);
    if (hit) return hit;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return mat;
    let clone;
    try { clone = mat.clone(); } catch (e) { return mat; }
    const prev = mat.onBeforeCompile;
    const prevSrc = (prev && prev !== THREE.Material.prototype.onBeforeCompile) ? String(prev) : "";
    clone.onBeforeCompile = prev
      ? function (sh) { prev.call(this, sh); veilBefore(sh); }
      : veilBefore;
    clone.customProgramCacheKey = function () { return "cbzVeil|" + prevSrc; };
    clone.userData = Object.assign({}, clone.userData, { cbzVeiled: true });
    clone.needsUpdate = true;
    _veilCache.set(mat, clone);
    _veilCache.set(clone, clone);
    return clone;
  };
  CBZ.waterVeilApply = function (obj) {
    if (!obj || !translucentOn()) return false;
    let n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) {
        let changed = false;
        const out = m.map(function (x) { const y = CBZ.waterVeilMaterial(x); if (y !== x) changed = true; return y; });
        if (changed) { o.material = out; n++; }
      } else {
        const y = CBZ.waterVeilMaterial(m);
        if (y !== m) { o.material = y; n++; }
      }
    });
    return n > 0;
  };
  function veilDrive() {
    VEIL_U.uVeilK.value = translucentOn() ? VEIL_K : 0;
    let y = seaY();
    if (CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.survSeaMeanY) {
      const iy = CBZ.survSeaMeanY();
      if (Number.isFinite(iy)) y = iy;
    }
    VEIL_U.uVeilSeaY.value = y;
    VEIL_U.uVeilColor.value.copy(_bodyC);
  }

  // ============================================================
  //  6. THE FOAM TILE AND THE CAUSTIC TILE (procedural, deterministic)
  // ============================================================
  // Foam: R and G are two bubble laces (cell walls of Worley noise at two
  // scales each, different seeds), histogram-flattened to 0..1 so a cover of
  // c keeps exactly the top c of the pattern. Tileable, integer-hashed.
  let foamTex = null;
  CBZ.waterFoamTexture = function () {
    if (foamTex) return foamTex;
    const N = 128;
    const ih = function (x, y, s) {
      let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    function walls(C, seed, out, wgt, width) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = x / N * C, v = y / N * C, ix = Math.floor(u), iy = Math.floor(v);
        let f1 = 1e9, f2 = 1e9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx, cy = iy + dy;
          const wx = ((cx % C) + C) % C, wy = ((cy % C) + C) % C;
          const px = cx + ih(wx, wy, seed), py = cy + ih(wx, wy, seed + 7);
          const d = (px - u) * (px - u) + (py - v) * (py - v);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        const e = Math.sqrt(f2) - Math.sqrt(f1);
        const w = Math.max(0, 1 - e / width);
        const i = y * N + x;
        out[i] = Math.max(out[i], w * wgt);
      }
    }
    function flatten(a) {
      const idx = new Uint32Array(a.length);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      idx.sort(function (p, q) { return a[p] - a[q] || p - q; });
      const o = new Float32Array(a.length);
      for (let r = 0; r < idx.length; r++) o[idx[r]] = r / (idx.length - 1);
      return o;
    }
    const A = new Float32Array(N * N), B = new Float32Array(N * N);
    walls(6, 11, A, 1.0, 0.42); walls(17, 29, A, 0.82, 0.38);
    walls(5, 43, B, 1.0, 0.45); walls(13, 71, B, 0.85, 0.40);
    for (let i = 0; i < N * N; i++) { A[i] += ih(i, 3, 5) * 0.06; B[i] += ih(i, 9, 2) * 0.06; }
    const fa = flatten(A), fb = flatten(B);
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = Math.round(fa[i] * 255); data[i * 4 + 1] = Math.round(fb[i] * 255);
      data[i * 4 + 2] = 0; data[i * 4 + 3] = 255;
    }
    foamTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
    foamTex.magFilter = THREE.LinearFilter;
    foamTex.minFilter = THREE.LinearMipmapLinearFilter;
    foamTex.generateMipmaps = true;
    foamTex.name = "cbz-water-foam";
    foamTex.needsUpdate = true;
    return foamTex;
  };

  // A tiling multi-direction ripple normal map. The sea no longer uses it
  // (its normal is analytic); world/water_wake.js's sheets still sample it.
  let rippleTex = null;
  CBZ.waterRippleTexture = function () {
    if (rippleTex) return rippleTex;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const waves = [
      [2, 1, 0.34, 0.2], [3, -2, 0.23, 1.1], [5, 4, 0.14, 2.4],
      [7, -3, 0.09, 0.7], [11, 5, 0.055, 1.8], [13, -8, 0.035, 2.9],
    ];
    for (let y = 0; y < N; y++) {
      const v = y / N * Math.PI * 2;
      for (let x = 0; x < N; x++) {
        const u = x / N * Math.PI * 2;
        let dx = 0, dz = 0;
        for (let k = 0; k < waves.length; k++) {
          const w = waves[k], c = Math.cos(w[0] * u + w[1] * v + w[3]) * w[2];
          dx += w[0] * c; dz += w[1] * c;
        }
        const nx = -dx * 0.12, nz = -dz * 0.12, inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        const q = (y * N + x) * 4;
        data[q] = Math.round((nx * inv * 0.5 + 0.5) * 255);
        data[q + 1] = Math.round((nz * inv * 0.5 + 0.5) * 255);
        data[q + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        data[q + 3] = 255;
      }
    }
    rippleTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
    rippleTex.magFilter = THREE.LinearFilter;
    rippleTex.minFilter = THREE.LinearMipmapLinearFilter;
    rippleTex.generateMipmaps = true;
    rippleTex.name = "cbz-water-ripples";
    rippleTex.needsUpdate = true;
    return rippleTex;
  };

  // Caustics: two orthogonal integer-frequency sine sums; the bright
  // filaments are where the field nulls. For seabed / hull light webs.
  let causticTex = null;
  CBZ.waterCausticTexture = function () {
    if (causticTex) return causticTex;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const A = [[3, 1, 0.40], [-2, 3, 0.90], [5, -4, 1.70], [1, 6, 2.50]];
    const B = [[-7, 2, 0.30], [4, 7, 1.20], [2, -5, 2.10], [6, 3, 0.60]];
    const NORM = 1 / A.length;
    for (let y = 0; y < N; y++) {
      const v = y / N * Math.PI * 2;
      for (let x = 0; x < N; x++) {
        const u = x / N * Math.PI * 2;
        let sa = 0, sb = 0;
        for (let k = 0; k < A.length; k++) sa += Math.sin(A[k][0] * u + A[k][1] * v + A[k][2]);
        for (let k = 0; k < B.length; k++) sb += Math.sin(B[k][0] * u + B[k][1] * v + B[k][2]);
        const d = Math.sqrt(sa * sa + sb * sb) * NORM;
        let c = Math.pow(Math.max(0, 1 - d), 5);
        c = Math.min(1, c * 1.45 + 0.045);
        const q = (y * N + x) * 4;
        const b8 = Math.round(c * 255);
        data[q] = b8; data[q + 1] = b8; data[q + 2] = b8; data[q + 3] = 255;
      }
    }
    causticTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
    causticTex.magFilter = THREE.LinearFilter;
    causticTex.minFilter = THREE.LinearMipmapLinearFilter;
    causticTex.generateMipmaps = true;
    causticTex.name = "cbz-water-caustics";
    causticTex.needsUpdate = true;
    return causticTex;
  };

  // ============================================================
  //  7. THE SURFACE GEOMETRY
  // ============================================================
  // A camera-centred radial disc whose rings grow geometrically at the same
  // rate as the angular spacing (2 pi / sectors), so a quad is square at
  // every range: ~0.5 m at your feet, ~5 m at 100 m, ~50 m at a kilometre.
  // core/quality.js tiers pick the sector count; the ring count follows.
  const TIER_SECTORS = [72, 96, 128, 160, 192];
  const INNER_R = 0.5;
  // past the flight fog at any lens the game uses
  const OUTER_R = 32000;
  CBZ.waterTierParams = function (tier) {
    if (!Number.isFinite(tier)) tier = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    tier = Math.max(0, Math.min(TIER_SECTORS.length - 1, tier | 0));
    const sectors = TIER_SECTORS[tier], spacing = TAU / sectors;
    const rings = Math.ceil(Math.log(OUTER_R / INNER_R) / Math.log(1 + spacing)) + 1;
    return { sectors: sectors, rings: rings, spacing: spacing };
  };
  function tierCtl() {
    const p = CBZ.waterTierParams();
    waveCtl.y = p.spacing; waveCtl.z = INNER_R;
  }

  CBZ.waterBuildSurfaceGeometry = function (opts) {
    opts = opts || {};
    const p = CBZ.waterTierParams(opts.tier);
    const NA = Math.max(8, (opts.sectors | 0) || p.sectors);
    const r0 = opts.innerRadius > 0 ? +opts.innerRadius : INNER_R;
    const r1 = opts.outerRadius > 0 ? +opts.outerRadius : OUTER_R;
    const NR = Math.max(8, (opts.rings | 0) || (Math.ceil(Math.log(r1 / r0) / Math.log(1 + TAU / NA)) + 1));
    const count = 1 + NR * NA;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    nrm[0] = 0; nrm[1] = 1; nrm[2] = 0;
    const growth = Math.pow(r1 / r0, 1 / Math.max(1, NR - 1));
    let rr = r0;
    for (let i = 0; i < NR; i++) {
      const ru = i / (NR - 1);
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * TAU;
        const k = 1 + i * NA + j;
        pos[k * 3] = Math.cos(a) * rr; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = Math.sin(a) * rr;
        nrm[k * 3 + 1] = 1;
        uvs[k * 2] = ru; uvs[k * 2 + 1] = j / NA;
      }
      rr *= growth;
    }
    const triCount = NA + (NR - 1) * NA * 2;
    const idx = count > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    let w = 0;
    for (let j = 0; j < NA; j++) {
      const j1 = (j + 1) % NA;
      idx[w++] = 0; idx[w++] = 1 + j1; idx[w++] = 1 + j;
    }
    for (let i = 0; i < NR - 1; i++) {
      const base = 1 + i * NA, next = 1 + (i + 1) * NA;
      for (let j = 0; j < NA; j++) {
        const j1 = (j + 1) % NA;
        idx[w++] = base + j; idx[w++] = base + j1; idx[w++] = next + j1;
        idx[w++] = base + j; idx[w++] = next + j1; idx[w++] = next + j;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    stampBounds(geo, r1);
    geo.userData.waterRadial = { rings: NR, sectors: NA, inner: r0, outer: r1 };
    return geo;
  };
  // The transform never moves (the disc is re-centred in the vertex program),
  // so the bounds are authored: XZ covers the disc and SEA_WORLD_BOUNDS, Y flat.
  function stampBounds(geo, r1) {
    const B = CBZ.SEA_WORLD_BOUNDS;
    let x0 = -r1, x1 = r1, z0 = -r1, z1 = r1;
    if (B && Number.isFinite(B.minX)) {
      x0 = Math.min(x0, B.minX); x1 = Math.max(x1, B.maxX);
      z0 = Math.min(z0, B.minZ); z1 = Math.max(z1, B.maxZ);
    }
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0),
      Math.max(r1, Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) * 1.45);
  }
  CBZ.waterBuildSeaGeometry = function (tier) {
    return CBZ.waterBuildSurfaceGeometry({ tier: tier });
  };

  // ============================================================
  //  8. THE SHARED VERTEX BODY
  // ============================================================
  // wp0Expr: the undisplaced vertex in world space. Declares wXZ (parametric
  // point), wWorld, wNormal, wDisp, wHeight, wDist, wInland, wDepth, wCalm,
  // wSp and wImp (the entry rings). opts.arena: no lakes/rivers and the
  // island's own front handling; opts.worldXZ: the mesh is already laid out
  // in world XZ (not the camera disc).
  CBZ.waterVertexBody = function (wp0Expr, opts) {
    const arena = !!(opts && opts.arena);
    const L = [];
    L.push("vec4 wBase = " + wp0Expr + ";");
    L.push(opts && opts.worldXZ ? "vec2 wXZ = wBase.xz;" : "vec2 wXZ = vec2(cameraPosition.x + wBase.x, cameraPosition.z + wBase.z);");
    L.push("float wDist = length(wXZ - cameraPosition.xz);");
    L.push(arena ? "float wInland = 0.0; float wRiver = 0.0;" : "float wInland = cbzInlandFactor(wXZ); float wRiver = cbzFlowAt(wXZ).z;");
    L.push("float wCalm = mix(1.0, " + gnum(INLAND_CALM) + ", wInland) * mix(1.0, " + gnum(RIVER_CALM) + ", wRiver);");
    L.push("float wDepth = cbzFieldDepth(cbzWaterField(wXZ)) * (1.0 - max(wInland, wRiver));");
    L.push("float wSp = " + (opts && opts.meshMinGLSL ? "max(cbzMeshSpacing(wDist), " + opts.meshMinGLSL + ")" : "cbzMeshSpacing(wDist)") + ";");
    L.push("vec3 wDisp = cbzWaveDisp(wXZ, uSeaTime, uSeaMul.xy, wDepth, wCalm, wSp);");
    L.push("vec4 wImp = cbzEntryImpulse(wXZ, uSeaTime, wSp * 1.2);");
    L.push("float wHeight = wDisp.y + wImp.x;");
    L.push("vec3 wWorld = vec3(wXZ.x + wDisp.x, wBase.y + wHeight" + (arena ? "" : " - cbzFrontDrop(wXZ)") + ", wXZ.y + wDisp.z);");
    L.push("wWorld.y += cbzWake(wWorld.xz).w;");
    L.push("vec3 wNormal = vec3(0.0, 1.0, 0.0);");
    L.push("vSeaP = vec4(wXZ, wCalm, wInland);");
    return L.join("\n");
  };

  // ============================================================
  //  8b. THE ONE SEA MATERIAL
  // ============================================================
  //   "city"      the camera disc; shoaling from the city's baked field,
  //               lakes and rivers calm it; the field's R ramp cuts dry land.
  //   "arena"     the same disc on an island's own field and sea state
  //               (uSeaMul); opts.vertexTail / fragInputs add the flood.
  //   "external"  geometry the caller displaces (or a flat sheet): its own
  //               position and normal, plus only the short rows (pixel ripple).
  // opts: { kind, name, fieldTex, fieldBounds, uniforms, vertexDecl,
  //   vertexTail, fragDecl, fragHead, fragInputs (before shading: may change
  //   depth, turb, foamC, slope, mss, allow, crest), fragTail (after shading:
  //   may change outColor, solid, outAlpha), fogScale, horizonFuse, transparent,
  //   depthWrite, cutGuard, worldXZ, meshMin }
  CBZ.waterSeaMaterial = function (opts) {
    opts = opts || {};
    const kind = opts.kind === "arena" || opts.kind === "external" ? opts.kind : "city";
    const U = opts.uniforms || CBZ.waterCommonUniforms();
    if (opts.fieldTex) {
      U.uSeaLandMask.value = opts.fieldTex;
      if (opts.fieldBounds) U.uSeaLandBounds.value.copy(opts.fieldBounds);
      U.uSeaHasLandMask.value = 1;
    }
    if (kind === "city" && U.uSeaHasLandMask.value > 0.5) cityGeo = geoFrom(U.uSeaLandMask.value, U.uSeaLandBounds.value);
    if (!U.uSeaOpacity) U.uSeaOpacity = { value: 1 };
    if (kind === "external") {
      if (!U.uClip) U.uClip = { value: new THREE.Vector4(0, 0, -1, 0) };
      // a page's own sheet: no long rows of ours on it, only the pixel ripple
      U.uSeaMul.value.w = 6.0;
    }
    const VARY = [
      "varying vec3 vSeaWorld;",
      "varying vec3 vSeaNormal;",
      "varying vec4 vSeaMisc;",          // x calm, y distance, z inland, w unused
    ].join("\n");
    const body = kind === "external" ? [
      "  vec4 wB = modelMatrix * vec4(position, 1.0);",
      "  vec3 wWorld = wB.xyz;",
      "  vec3 wNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);",
      "  float wDist = length(wWorld.xz - cameraPosition.xz);",
      "  float wCalm = 1.0; float wInland = 0.0;",
      "  vSeaP = vec4(wWorld.xz, 1.0, 0.0);",
    ].join("\n") : CBZ.waterVertexBody("modelMatrix * vec4(position, 1.0)", { arena: kind === "arena", worldXZ: !!opts.worldXZ, meshMinGLSL: opts.meshMinGLSL });
    const fogScale = Number.isFinite(opts.fogScale) ? opts.fogScale : (kind === "city" ? 0.66 : 1.0);
    const vs = [
      CBZ.waterVertexDecl(),
      opts.vertexDecl || "",
      VARY,
      "#include <fog_pars_vertex>",
      "void main() {",
      body,
      opts.vertexTail || "",
      "  vSeaWorld = wWorld;",
      "  vSeaNormal = wNormal;",
      "  vSeaMisc = vec4(wCalm, wDist, wInland, 0.0);",
      "  vec4 mvPosition = viewMatrix * vec4(wWorld, 1.0);",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      fogScale !== 1 ? "  #ifdef USE_FOG\n    vFogDepth *= " + gnum(fogScale) + ";\n  #endif" : "",
      "}",
    ].join("\n");
    const cut = kind === "city"
      ? "  if (uSeaHasLandMask > 0.5 && field.r > cbzShoreCutAt(vSeaWorld.xz)) discard;"
      : kind === "arena"
        ? "  if (uSeaHasLandMask > 0.5 && field.r > uShoreCut" + (opts.cutGuard ? " && " + opts.cutGuard : "") + ") discard;"
        : "  if (uClip.z > 0.0 && abs(vSeaWorld.x - uClip.x) < uClip.z && abs(vSeaWorld.z - uClip.y) < uClip.z) discard;";
    const fs = [
      CBZ.waterFragmentDecl(),
      CBZ.waterClarityGLSL(),
      "uniform float uShoreCut;",
      "uniform float uSeaOpacity;",
      "uniform float uImpLive;",
      // the shoreline cut where the surge has actually arrived
      "float cbzShoreCutAt(vec2 xz) {",
      "  if (uSeaFrontS.y < 0.001 && uSeaLee2.w < 0.5) return uShoreCut;",
      "  return 0.5 + min(0.42, max(0.0, uSeaFrontS.z - cbzFrontDrop(xz)) * " + gnum(SHORE_CUT_PER_M) + ");",
      "}",
      kind === "external" ? "uniform vec4 uClip;" : "",
      opts.fragDecl || "",
      VARY,
      "#include <fog_pars_fragment>",
      "void main() {",
      "  vec4 field = cbzWaterField(vSeaWorld.xz);",
      opts.fragHead || "",
      cut,
      "  float under = gl_FrontFacing ? 0.0 : 1.0;",
      "  vec3 V = normalize(cameraPosition - vSeaWorld);",
      "  float dist = vSeaMisc.y;",
      "  vec2 sp = vSeaP.xy;",
      /* The pixel's footprint on the water, its LONG axis, from the eye
         distance and the view's elevation: smooth across the mesh's
         triangles (a screen derivative of a per-triangle linear varying is
         constant per triangle and drew rays along the disc's sectors). */
      "  float eyeD = length(cameraPosition - vSeaWorld);",
      "  float fp = max(eyeD * uPixAng / max(abs(V.y), 0.04), 0.002);",
      "  vec3 rflow = uWater2.w > 0.5 ? cbzFlowAt(vSeaWorld.xz) : vec3(0.0);",
      "  float calm = vSeaMisc.x;",
      kind === "external" ? "  float depth = 30.0;" : "  float depth = cbzFieldDepth(field) * (1.0 - max(vSeaMisc.z, rflow.z));",
      "  vec2 wst;",
      "  vec4 ws = cbzWaveSurf(sp, uSeaTime, uSeaMul.xy, depth, calm, fp, wst);",
      "  vec2 slope = ws.xy;",
      kind === "external" ? "  { vec3 gN = normalize(vSeaNormal); slope += -gN.xz / max(0.2, gN.y); }" : "",
      "  float J = ws.z;",
      "  float hN = clamp(ws.w / max(0.05, wst.x), -1.0, 1.0);",
      "  float mss = wst.y + uWaveRough.x * uSeaMul.y * uSeaMul.y * calm * calm;",
      // the short-crested chop under the rows (cbzDetail)
      "  vec3 dtl = cbzDetail(sp, uSeaTime, fp, normalize(uWindDir), uSeaMul.y * calm * mix(0.35, 1.0, smoothstep(0.0, 1.5, depth)));",
      "  slope += dtl.xy; mss += dtl.z;",
      "  float foamC = 0.0;",
      "  if (uImpLive > 0.5) { vec4 eI = cbzEntryImpulse(sp, uSeaTime, fp); slope += eI.yz; foamC = max(foamC, eI.w); }",
      "  vec4 wk = cbzWake(vSeaWorld.xz);",
      "  slope += wk.xy; foamC = max(foamC, wk.z);",
      "  if (rflow.z > 0.01) { vec3 fr = cbzFlowRipple(vSeaWorld.xz, rflow.xy, rflow.z, fp, uSeaTime); slope += fr.xy; foamC = max(foamC, fr.z * 0.5); }",
      "  float turb = 0.0;",
      "  float crest = max(hN, 0.0);",
      "  float allow = uClarity.x * (1.0 - smoothstep(uClarity.z, uClarity.w, eyeD));",
      // the wave-made foam is kept apart so a surface's own inputs can gate it
      // (the flood owns its froth inside the run-up field)
      kind === "external" ? "  float surfF = 0.0;" : "  float surfF = cbzSurfFoam(vSeaWorld.xz, depth, wst.x, field.a, uSeaTime);",
      "  float capF = cbzWhitecap(J, hN, fp, vSeaWorld.xz, uSeaTime) * calm;",
      "  if (uWater2.z > 0.5 && dist < 240.0) foamC = max(foamC, cbzContactFoam(vSeaWorld.xz) * 0.85);",
      opts.fragInputs || "",
      "  foamC = max(foamC, max(surfF, capF));",
      "  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));",
      // outside Snell's window a swimmer sees the water column mirrored
      "  #ifdef USE_FOG",
      "    vec3 cbzTir = fogColor * 0.55;",
      "  #else",
      "    vec3 cbzTir = uSkyLow * 0.2;",
      "  #endif",
      "  vec4 sh = under > 0.5 ? cbzWaterShadeUnder(N, V, mss, cbzTir)",
      "    : cbzWaterShade(vSeaWorld, vSeaWorld.xz, N, V, mss, depth, turb, clamp(foamC, 0.0, 1.0), crest, allow, fp, uSeaTime);",
      "  vec3 outColor = sh.rgb;",
      "  if (uSeaLampC.w > 0.5 && under < 0.5) outColor += cbzLampGlints(N, V, vSeaWorld, max(mss, 0.002)) * (1.0 - clamp(foamC, 0.0, 1.0)) / max(sh.a, 0.02);",
      "  float foam = foamC;",
      "  float solid = 0.0;",
      "  float outAlpha = 1.0;",
      opts.fragTail || "",
      opts.horizonFuse === true ?
        "  #ifdef USE_FOG\n  outColor = mix(outColor, fogColor, smoothstep(3600.0, 6400.0, dist));\n  #endif" : "",
      "  gl_FragColor = vec4(outColor, uSeaOpacity * max(sh.a, solid) * outAlpha);",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    const clear = translucentOn() || opts.transparent === true || U.uSeaOpacity.value < 0.999;
    const mat = new THREE.ShaderMaterial({
      name: opts.name || "CBZ Water",
      uniforms: U,
      vertexShader: vs,
      fragmentShader: fs,
      fog: true,
      transparent: clear,
      // the sea keeps its depth while blending; it draws after the bodies it shows
      depthWrite: opts.depthWrite == null ? true : !!opts.depthWrite,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    mat.userData.waterUniforms = U;
    mat.userData.waterKind = kind;
    mat.userData.waterMode = "water-v4-" + kind;
    if (CBZ.groundMaskAttach) { try { CBZ.groundMaskAttach(mat); } catch (e) {} }
    seaMaterials.push(mat);
    return mat;
  };
  const seaMaterials = [];
  CBZ.waterSeaMaterials = function () { return seaMaterials; };

  // ============================================================
  //  8c. A BAKED SHORE FIELD FOR ANY HEIGHTFIELD WORLD
  // ============================================================
  //   R  0.5 - depth/8 m: > 0.5 is dry land (uShoreCut moves with sea level)
  //   G  1 - depth/2.4 m (fine depth in the shallows)
  //   B  depth/30 m
  //   A  surf exposure (1: open water everywhere an island meets the sea)
  // Baked in time slices into a private array and published whole when done,
  // so the GPU and the CPU (which reads tex.image.data) never see a half field.
  const FIELD_RANGE = 8.0;
  CBZ.waterFieldCut = function (surge, margin) {
    return 0.5 + ((+surge || 0) + (margin == null ? 0.6 : +margin)) / FIELD_RANGE;
  };
  CBZ.waterBakeField = function (o) {
    o = o || {};
    const N = Math.max(64, Math.min(1024, o.size | 0 || 512));
    const cx = +o.cx || 0, cz = +o.cz || 0, half = Math.max(50, +o.half || 800);
    const groundAt = o.groundAt, seaY0 = Number.isFinite(+o.seaY) ? +o.seaY : 0;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255; }
    const work = new Uint8Array(data.length);
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const bounds = new THREE.Vector4(cx - half, cz - half, cx + half, cz + half);
    let row = 0;
    const h = {
      tex: tex, bounds: bounds, done: typeof groundAt !== "function", baked: true,
      step: function (ms) {
        if (h.done) return true;
        const now = function () { return typeof performance !== "undefined" ? performance.now() : Date.now(); };
        const until = now() + Math.max(0.5, +ms || 2);
        for (; row < N; row++) {
          if (now() > until) break;
          const z = cz - half + (row + 0.5) / N * half * 2;
          for (let c = 0; c < N; c++) {
            const x = cx - half + (c + 0.5) / N * half * 2;
            let g = +groundAt(x, z);
            if (!Number.isFinite(g)) g = seaY0 - 60;
            const depth = seaY0 - g;
            const q = (row * N + c) * 4;
            work[q] = Math.round(Math.max(0, Math.min(1, 0.5 - depth / FIELD_RANGE)) * 255);
            work[q + 1] = Math.round(Math.max(0, Math.min(1, 1 - depth / 2.4)) * 255);
            work[q + 2] = Math.round(Math.max(0, Math.min(1, depth / 30)) * 255);
            work[q + 3] = 255;
          }
        }
        if (row >= N) {
          data.set(work);
          h.done = true; tex.needsUpdate = true;
          if (h.onDone) { try { h.onDone(h); } catch (e) {} }
        }
        return h.done;
      },
    };
    return h;
  };

  // ============================================================
  //  9. MODE-SCOPED DISASTER WATER
  // ============================================================
  // The island / shark-sim sea: the one sea material in "arena" mode on the
  // camera disc, cut to the span the island's haze has to reach.
  CBZ.waterBuildDisasterGeometry = function (span, segments) {
    const outer = Math.max(400, (+span || 2048) * 0.78);
    const geo = CBZ.waterBuildSurfaceGeometry({ tier: CBZ.qualityLevel, outerRadius: outer });
    const rings = geo.userData.waterRadial.rings;
    // re-centred on the camera in the vertex program: the mesh sits at x = z = 0
    geo.userData.waterDisasterGrid = { span: +span || 2048, segments: segments | 0 || rings, radial: true, outer: outer };
    return geo;
  };

  // The islands' directors write their sea state as amp/chop around a calm
  // baseline of 0.86 / 0.72; the multiplier on the live spectrum is the ratio.
  const ARENA_AMP0 = 0.86, ARENA_CHOP0 = 0.72;
  function arenaMulS(amp) { return Math.max(0, Math.min(2.5, (Number.isFinite(+amp) ? +amp : ARENA_AMP0) / ARENA_AMP0)); }
  function arenaMulW(chop) { return Math.max(0, Math.min(2.5, (Number.isFinite(+chop) ? +chop : ARENA_CHOP0) / ARENA_CHOP0)); }
  CBZ.waterArenaMul = function (amp, chop, out) {
    out = out || {};
    out.s = arenaMulS(amp); out.w = arenaMulW(chop);
    return out;
  };

  CBZ.waterDisasterSurfaceY = function (x, z, meanY, amp, chop, t) {
    if (!Number.isFinite(t)) t = CBZ.waterClock();
    let wave = surfaceEval(x, z, t, true, arenaMulS(amp), arenaMulW(chop), false, _se).h;
    // a flood a metre deep carries no metre-high swell: inside the run-up
    // field the swell scales with the depth under it, as the vertex stage does
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    if (F) {
      const r = F.sample(x, z, _runSY);
      if (r.in > 0) { const k = Math.min(1, Math.max(0, r.depth / 2.5)); wave *= 1 - r.in + r.in * k; }
    }
    return meanY + wave;
  };
  const _runSY = {};

  /* ============================================================
     WHAT FLOODWATER LEAVES (2026-10-19). One look for the residue of every
     flood in the game: the flash flood's silt (systems/flashflood.js) and
     the tsunami's (world/tsunami_scene.js), and the waterline on the walls
     they stood against.

     OWNER: "it dries up way too fast and just leaves a weird colour on the
     ground. Wildfires leave a very real colour." The old films were one flat
     tint each (a 0.38-alpha brown box on the walls, an opaque brown sheet or
     a 64-cell grey veil on the ground) with a clock that dried them in 22 s.
     What the Ahr valley 2021, Derbyshire 2019 and the Tohoku "black tsunami"
     deposits look like instead:
       - a brown-grey MUD AND SILT FILM, thickest where the water was deep,
         slow and stood longest (the lows, the slack behind things), thin and
         patchy on the rises, so the ground shows through it;
       - dark, glossy and near-black-brown while wet; it dries from the thin
         edges and the high spots inward to a PALE grey-tan crust, the thick
         pans last, and those shrink into plates (mud cracks);
       - the drift the water carried, stranded in a ragged WRACK LINE at the
         high-water mark (twigs, grass, litter, the odd pale scrap);
       - on every wall a crisp dark tide line at the peak with a scum band
         under it and a mottled film below, darker while wet.
     Like the burn scar it is texture on the ground, never a colour pasted on
     it: per-cell inputs, world-space noise at three scales so the grid never
     shows, ragged edges. Seven value-noise taps a fragment: phone money.

     cbzFloodResidue(p, thick, dry, edge, comb, out gloss) -> (albedo, cover)
       p     world xz
       thick 0..1 how much settled here
       dry   0..1 the drying clock (0 just emerged, 1 long dry)
       edge  0..1 inside the high-water band, where the wrack is stranded
       comb  the direction the last of the water ran (zero: none)
     cbzWaterline(b, along, y, wet) -> (albedo, cover)
       b metres below the high-water line, along a coordinate along the wall
     ============================================================ */
  CBZ.floodResidueDrySecs = 150;
  CBZ.floodResidueGLSL = function () {
    return [
      "float cbzRsH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
      "float cbzRsN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(cbzRsH(i), cbzRsH(i + vec2(1.0, 0.0)), f.x), mix(cbzRsH(i + vec2(0.0, 1.0)), cbzRsH(i + vec2(1.0, 1.0)), f.x), f.y); }",
      "vec4 cbzFloodResidue(vec2 p, float thick, float dry, float edge, vec2 comb, out float gloss) {",
      "  float n1 = cbzRsN(p * 0.13);",            // ~8 m: where it settled thicker
      "  float n2 = cbzRsN(p * 0.61 + 5.3);",      // ~1.6 m mottling
      "  float n3 = cbzRsN(p * 2.7 - 3.1);",       // ~0.4 m grain
      // combed out along the last of the flow
      "  float cl = length(comb);",
      "  vec2 cd = cl > 0.01 ? comb / cl : vec2(1.0, 0.0);",
      /* NOT A COMB (2026-10-20): this was noise stretched 13:1 along the
         drain direction, looked up at (dot(p, perp), dot(p, dir)) with p the
         world position: long ruled smears across the whole aftermath, and on
         the flash flood (whose drain direction changes cell to cell) arcs
         swung about the world origin. What the last of the water leaves is
         irregular: lobes and tongues pushed a metre or two down the drain,
         an isotropic field displaced along it (bounded, so it never smears). */
      "  float stri = cl > 0.01 ? cbzRsN(p * 0.45 + cd * (n1 * 2.2 - 1.1) + 7.7) : 0.5;",
      // the mottling only where something settled (it used to lay a faint
      // film on every wetted cell, deposit or not)
      "  float th = clamp(thick * (0.62 + 0.76 * n1) + ((n2 - 0.5) * 0.26 + (stri - 0.5) * 0.2) * smoothstep(0.0, 0.12, thick), 0.0, 1.0);",
      // the drying front: thin film and the rises first, the thick lows last
      "  float dk = clamp(dry * 1.75 - th * 0.8 - (n2 - 0.5) * 0.34 - (n3 - 0.5) * 0.12, 0.0, 1.0);",
      "  float d = smoothstep(0.22, 0.52, dk);",
      "  vec3 wetC = mix(vec3(0.030, 0.026, 0.020), vec3(0.050, 0.043, 0.033), n2);",
      // dried silt and sand: a pale warm tan, browner where it lies thick
      "  vec3 dryC = mix(vec3(0.20, 0.172, 0.130), vec3(0.27, 0.235, 0.180), n2 * 0.6 + n3 * 0.4);",
      "  dryC *= mix(vec3(1.0), vec3(0.88, 0.82, 0.72), th);",
      "  vec3 col = mix(wetC, dryC, d);",
      // half-dry: a damp darker rim just behind the drying front
      "  col *= 1.0 - 0.22 * smoothstep(0.10, 0.22, dk) * (1.0 - smoothstep(0.22, 0.42, dk));",
      // thick dried mud shrinks into plates
      "  float cr = 1.0 - abs(cbzRsN(p * 1.15 + n2 * 0.7) * 2.0 - 1.0);",
      "  float crack = smoothstep(0.90, 0.97, cr) * smoothstep(0.45, 0.8, th) * smoothstep(0.62, 0.95, dk);",
      "  col *= 1.0 - 0.6 * crack;",
      // coverage: thick buries the ground, thin lets it through; wet soil darkens more
      "  float a = smoothstep(0.03, 0.5, th) * (0.5 + 0.48 * smoothstep(0.25, 0.75, th));",
      "  a = max(a, (1.0 - d) * smoothstep(0.0, 0.2, thick) * 0.6);",
      // a thin film that has dried is a dusting the ground shows through
      "  a *= mix(1.0, 0.3, d * (1.0 - smoothstep(0.3, 0.7, th)));",
      // water still standing in the deepest pockets
      "  float pud = smoothstep(0.74, 0.82, th + n3 * 0.06) * (1.0 - smoothstep(0.12, 0.5, dry * 1.3));",
      "  col = mix(col, vec3(0.028, 0.024, 0.019), pud);",
      "  a = max(a, pud);",
      // the wrack: what the water carried, dropped where it stopped
      "  float clump = smoothstep(0.55, 0.78, cbzRsN(p * 1.9 + 11.0) * 0.6 + n3 * 0.4);",
      "  float bits = smoothstep(0.80, 0.93, cbzRsN(p * 6.3 + 2.0));",
      // a sheet that carried nothing strands little
      "  edge *= 0.3 + 0.7 * smoothstep(0.0, 0.1, thick);",
      "  float wr = edge * clump;",
      "  col = mix(col, mix(vec3(0.026, 0.021, 0.014), vec3(0.07, 0.056, 0.038), n3), wr);",
      "  col = mix(col, vec3(0.30, 0.29, 0.26), edge * bits * (1.0 - wr) * 0.6);",
      "  a = max(a, max(wr * 0.95, edge * bits * 0.55));",
      "  gloss = (1.0 - d) * (0.35 + 0.65 * pud);",
      "  return vec4(col, clamp(a, 0.0, 1.0));",
      "}",
      "vec4 cbzWaterline(float b, float along, float y, float wet) {",
      "  b += (cbzRsN(vec2(along * 0.9, 3.0)) - 0.5) * 0.10;",
      "  if (b < 0.0) return vec4(0.0);",
      "  float drip = smoothstep(0.35, 0.8, cbzRsN(vec2(along * 2.3, y * 0.13)));",
      "  float mott = cbzRsN(vec2(along * 0.7, y * 0.6));",
      "  vec3 mud = mix(vec3(0.20, 0.18, 0.145), vec3(0.075, 0.065, 0.050), wet);",
      // the film is heaviest low down, where the water stood longest
      "  float a = mix(0.30, 0.62, smoothstep(0.1, 1.6, b)) * (0.78 + 0.30 * drip + 0.12 * mott);",
      "  a *= smoothstep(0.02, 0.10, b);",
      "  float line = 1.0 - smoothstep(0.035, 0.085, b);",
      "  float scum = smoothstep(0.08, 0.11, b) * (1.0 - smoothstep(0.22, 0.34, b)) * smoothstep(0.35, 0.6, cbzRsN(vec2(along * 4.0, y * 5.0)));",
      "  vec3 col = mud * (0.85 + 0.3 * mott);",
      "  col = mix(col, vec3(0.025, 0.022, 0.018), line);",
      "  col = mix(col, vec3(0.34, 0.33, 0.30), scum * 0.9);",
      "  return vec4(col, clamp(max(a, max(line * 0.92, scum * 0.8)), 0.0, 1.0));",
      "}",
    ].join("\n");
  };

  /* THE RUN-UP FIELD, READ ON THE GPU. One RGBA8 texel per cell, nearest-
     sampled and blended by hand (float textures cannot be linearly filtered
     on every phone; four fetches always can): RG = the drawn surface (16
     bit), B = sqrt(depth / 25), A = speed / 16. Returns (surface, depth,
     speed, inside weight) and the surface slope through `grad`. The CPU
     twin is world/tsunami_runup.js sample(). */
  const RUN_ENC = CBZ.waterRunupEnc = { lo: -16, span: 64, depth: 25, speed: 16, dryLift: 0.6 };
  const RUN_GLSL = [
    "uniform sampler2D uRunTex;",
    "uniform vec4 uRunB;",
    "uniform float uRunOn;",
    "vec4 cbzRunTexel(vec2 c) { return texture2D(uRunTex, (c + 0.5) / uRunB.w); }",
    "vec4 cbzRun(vec2 xz, out vec2 grad) {",
    "  grad = vec2(0.0);",
    "  vec2 g = (xz - uRunB.xy) / uRunB.z * uRunB.w - 0.5;",
    "  float e = min(min(g.x + 0.5, g.y + 0.5), min(uRunB.w - 0.5 - g.x, uRunB.w - 0.5 - g.y));",
    "  float w = clamp(e / 1.5, 0.0, 1.0);",
    "  if (w <= 0.0) return vec4(0.0);",
    "  vec2 i0 = clamp(floor(g), vec2(0.0), vec2(uRunB.w - 2.0));",
    "  vec2 f = clamp(g - i0, 0.0, 1.0);",
    "  vec4 a = cbzRunTexel(i0), b = cbzRunTexel(i0 + vec2(1.0, 0.0));",
    "  vec4 c = cbzRunTexel(i0 + vec2(0.0, 1.0)), d = cbzRunTexel(i0 + vec2(1.0, 1.0));",
    "  vec4 ee = (floor(vec4(a.r, b.r, c.r, d.r) * 255.0 + 0.5) * 256.0 + floor(vec4(a.g, b.g, c.g, d.g) * 255.0 + 0.5)) * " + gnum(RUN_ENC.span / 65535) + " + " + gnum(RUN_ENC.lo) + ";",
    "  vec4 dd = vec4(a.b, b.b, c.b, d.b); dd = dd * dd * " + gnum(RUN_ENC.depth) + ";",
    "  vec4 sp = vec4(a.a, b.a, c.a, d.a) * " + gnum(RUN_ENC.speed) + ";",
    "  vec4 wq = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);",
    "  float cell = uRunB.z / uRunB.w;",
    // the surface slope as a vector (+x, +z): the water runs down it
    "  grad = vec2(mix(ee.y - ee.x, ee.w - ee.z, f.y), mix(ee.z - ee.x, ee.w - ee.y, f.x)) / cell;",
    "  return vec4(dot(ee, wq), dot(dd, wq), dot(sp, wq), w);",
    "}",
  ].join("\n");

  CBZ.makeDisasterWaterMaterial = function (opts) {
    opts = opts || {};
    const U = CBZ.waterCommonUniforms();
    // the director's sea state (0.86 / 0.72 is calm); uSeaMul carries the ratio
    U.uDisasterAmp = { value: Number.isFinite(opts.amp) ? +opts.amp : ARENA_AMP0 };
    U.uDisasterChop = { value: Number.isFinite(opts.chop) ? +opts.chop : ARENA_CHOP0 };
    U.uSeaMul.value.x = arenaMulS(U.uDisasterAmp.value);
    U.uSeaMul.value.y = arenaMulW(U.uDisasterChop.value);
    U.uSeaOpacity = { value: Number.isFinite(opts.opacity) ? +opts.opacity : 1.0 };
    U.uDisasterOpacity = U.uSeaOpacity;
    U.uDisasterFoam = { value: Number.isFinite(opts.foam) ? +opts.foam : 0.45 };
    U.uDisasterTint = U.uSeaColor;
    // the silt field: where the water carries mud (world/tsunami_silt.js)
    U.uSiltTex = { value: null };
    U.uSiltB = { value: new THREE.Vector4(0, 0, 1, 0) };   // x0, z0, size, on
    U.uDwFrontC = { value: new THREE.Vector2(0, 0) };     // event origin, world XZ
    U.uDwFrontDir = { value: new THREE.Vector2(1, 0) };   // unit travel direction
    U.uDwFrontS = { value: -1e9 };                        // front position along it
    U.uDwFrontRun = { value: 110 };
    U.uDwAhead = { value: 0 };                            // m the sheet sits lower ahead of the front
    U.uDwMud = { value: new THREE.Color(0x17170f) };
    U.uDwFlow = { value: new THREE.Vector2(1, 0) };
    U.uDwFlowSpd = { value: 0 };
    U.uDwStand = { value: 0 };
    U.uDwChurn = { value: 0 };                            // 0..1.5: the boil behind the front
    U.uDwSed = { value: 0 };                              // 0..1: the event's own mud load
    // (cx, cz, r, sink): the sheet is pulled `sink` m down inside r so no
    // swell crest stripes the island's plain while the sea is calm
    U.uDwDryDisc = { value: new THREE.Vector4(0, 0, 0, 0) };
    U.uDwSilt = { value: new THREE.Color(0x10201f) };
    U.uDwFoam = { value: new THREE.Color(0x4b4d47) };
    // THE RUN-UP FIELD (world/tsunami_runup.js): while attached, the sheet
    // over its domain IS the field's surface, its swell scaled by the depth
    // under it, its dry cells discarded
    U.uRunTex = { value: null };
    U.uRunB = { value: new THREE.Vector4(0, 0, 1, 2) };   // x0, z0, size (m), cells per side
    U.uRunOn = { value: 0 };
    U.uRunRest = { value: -0.8 };
    U.uRunOverlay = { value: 0 };

    const vDecl = [
      RUN_GLSL,
      "varying vec4 vRun;",
      "uniform vec4 uDwDryDisc;",
      "uniform vec2 uDwFrontC;",
      "uniform vec2 uDwFrontDir;",
      "uniform float uDwFrontS;",
      "uniform float uDwAhead;",
    ].join("\n");
    const vTail = [
      "  float dwDisc = 1.0 - smoothstep(uDwDryDisc.z - 8.0, uDwDryDisc.z, length(wWorld.xz - uDwDryDisc.xy));",
      "  wWorld.y -= uDwDryDisc.w * dwDisc;",
      // ahead of a tsunami front the island's plain keeps its calm-sea sink
      "  float dwAk = uDwAhead > 0.001 ? smoothstep(-1.0, 7.0, dot(wWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS) : 0.0;",
      "  wWorld.y -= cbzFrontDrop(wWorld.xz) + dwAk * 3.0 * dwDisc * step(uDwDryDisc.w, 0.01);",
      "  vec2 rG = vec2(0.0);",
      "  vec4 rS = uRunOn > 0.5 ? cbzRun(wXZ, rG) : vec4(0.0);",
      "  if (rS.w > 0.0) {",
      "    float rk = clamp(rS.y / 2.5, 0.0, 1.0);",
      "    wWorld.y = mix(wWorld.y, rS.x + wHeight * rk, rS.w);",
      "    wWorld.xz = mix(wWorld.xz, wXZ + wDisp.xz * rk, rS.w);",
      "  }",
      "  vRun = vec4(rS.y, rS.z, length(rG), rS.w);",
    ].join("\n");
    const fDecl = [
      RUN_GLSL,
      "varying vec4 vRun;",
      "uniform float uRunRest;",
      "uniform float uRunOverlay;",
      "uniform sampler2D uSiltTex;",
      "uniform vec4 uSiltB;",
      "uniform vec2 uDwFrontC;",
      "uniform vec2 uDwFrontDir;",
      "uniform float uDwFrontS;",
      "uniform vec2 uDwFlow;",
      "uniform float uDwChurn;",
      "uniform float uDwSed;",
      "uniform float uDwFrontRun;",
      "float cbzSilt(vec2 xz) {",
      "  if (uSiltB.w < 0.5) return 0.0;",
      "  vec2 uv = (xz - uSiltB.xy) / uSiltB.z;",
      "  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));",
      "  if (e <= 0.0) return 0.0;",
      "  return textureLod(uSiltTex, uv, 0.0).r * clamp(e * 40.0, 0.0, 1.0);",
      "}",
      // value noise for the silt's mottling (a fract hash: no sin of large coordinates)
      "float cbzVNoise(vec2 p) {",
      "  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(cbzHash(i), cbzHash(i + vec2(1.0, 0.0)), f.x), mix(cbzHash(i + vec2(0.0, 1.0)), cbzHash(i + vec2(1.0, 1.0)), f.x), f.y);",
      "}",
    ].join("\n");
    /* THE FLOOD IS THE SEA. What makes the water on the land different is
       only what the one shading model is told: its depth (the run-up's), the
       mud it carries (the run-up on the land, the silt field at sea), its own
       surface slope, the current that ripples it and the froth where it runs
       fast and steep. No private colours, normals or highlights. */
    const fInputs = [
      "  float rLand = dwRun.w * smoothstep(uRunRest - 1.2, uRunRest + 0.3, dwRun.x - dwRun.y) * smoothstep(0.0, 0.03, dwRun.y);",
      "  float dwSilt = cbzSilt(vSeaWorld.xz);",
      "  if (dwSilt > 0.004) {",
      "    vec2 sq = vSeaWorld.xz * 0.035 + uDwFlow * uSeaTime * 0.012;",
      "    float sn = cbzVNoise(sq) * 0.62 + cbzVNoise(sq * 2.31 + 17.7) * 0.38;",
      "    dwSilt = clamp(dwSilt * (0.45 + 1.1 * sn) - 0.04, 0.0, 1.0);",
      "  }",
      "  turb = max(dwSilt, 0.92 * rLand);",
      // the bore's own load behind its front, settling out over the run behind it
      "  float fdS = dot(vSeaWorld.xz - uDwFrontC, uDwFrontDir) - uDwFrontS;",
      "  float behind = (1.0 - smoothstep(-2.0, 3.0, fdS)) * exp(min(0.0, fdS) / max(uDwFrontRun * 2.0, 1.0));",
      "  turb = max(turb, uDwSed * behind);",
      /* INSIDE THE RUN-UP FIELD, sea and land alike, the water is the field's:
         its depth, its own surface slope, the current rippling it, the mud a
         moving flood stirs, its froth. One rule across the old shoreline, so
         there is no seam where the land starts. */
      "  float rIn = dwRun.w;",
      // the shore's surf and the open sea's whitecaps are not the flood's: its
      // froth is its own (the shelf field reads a depth of 0 on the land)
      "  surfF *= 1.0 - rIn; capF *= 1.0 - rIn;",
      "  if (rIn > 0.001) {",
      "    depth = mix(depth, dwRun.y, rIn);",
      // the wave rows and the chop were shoaled on the shelf's depth; on the
      // flood they are as big as its own depth lets them be (the vertex stage
      // scales the swell the same way), and a puddle is mirror-flat
      "    float rk = clamp(dwRun.y / 2.5, 0.0, 1.0);",
      "    slope -= ws.xy * (1.0 - rk) * rIn;",
      "    mss = mix(mss, mss * rk + 0.0008, rIn);",
      "    float spd = min(dwRun.z, 6.0);",
      "    turb = max(turb, rIn * smoothstep(0.4, 2.5, spd) * max(uDwSed, 0.6));",
      "    slope += dwRunGv * rIn;",
      // it runs down its own surface, or the event's bearing where it is flat
      "    float dGl = length(dwRunGv);",
      "    vec2 fl = dGl > 0.004 ? normalize(mix(uDwFlow, -dwRunGv / dGl, smoothstep(0.004, 0.03, dGl)) + vec2(0.0001, 0.0)) : uDwFlow;",
      /* THE FLOOD'S RELIEF is the sea's own detail field carried by the
         current: two staggered lookups along the filtered flow velocity,
         cross-faded so neither visibly resets, amplitude from the speed,
         every octave fading into roughness by footprint like the sea's. Its
         orientation is the wind's, never a run-up cell's, so no tiling. */
      "    slope -= dtl.xy * rIn;",
      "    float fT = 1.5;",
      "    float ph0 = fract(uSeaTime / fT), ph1 = fract(uSeaTime / fT + 0.5);",
      "    vec2 vel = fl * spd;",
      "    float kf = rIn * (0.2 + 0.8 * smoothstep(0.3, 3.0, spd)) * clamp(dwRun.y / 0.3, 0.0, 1.0);",
      "    vec2 wdir = normalize(uWindDir);",
      "    vec3 fd0 = cbzDetail(vSeaWorld.xz - vel * (ph0 * fT), uSeaTime, fp, wdir, kf);",
      "    vec3 fd1 = cbzDetail(vSeaWorld.xz - vel * (ph1 * fT) + 17.3, uSeaTime, fp, wdir, kf);",
      "    float fw = 1.0 - abs(ph0 * 2.0 - 1.0);",
      "    vec3 fdd = fd0 * fw + fd1 * (1.0 - fw);",
      "    slope += fdd.xy; mss += fdd.z * rIn;",
      /* FROTH IS WHERE THE FLOW BREAKS, nowhere else. Supercritical water
         (Froude number over ~1) on a steep surface is a hydraulic jump, the
         race round a corner or off a kerb; a thin fast sheet at the advancing
         edge tears white. A standing or slow flood carries none. It lies in
         torn patches carried by the current, never as a blanket. */
      "    float Fr = dwRun.z / sqrt(9.81 * max(dwRun.y, 0.02));",
      "    float jump = smoothstep(0.9, 1.7, Fr) * smoothstep(0.04, 0.2, dwRunG);",
      "    float lip = (1.0 - smoothstep(0.06, 0.35, dwRun.y)) * smoothstep(1.2, 3.0, dwRun.z);",
      "    vec2 fc = vec2(-uDwFlow.y, uDwFlow.x);",
      "    float streak = smoothstep(0.45, 0.8, cbzSNoise(vec2(dot(vSeaWorld.xz - vel * (ph0 * fT), uDwFlow) * 0.12, dot(vSeaWorld.xz, fc) * 0.3)));",
      "    foamC = max(foamC, rIn * max(jump, lip) * mix(0.35, 1.0, streak) * 0.9);",
      // a thin scum line where the water thins to nothing
      "    foamC = max(foamC, rIn * (1.0 - smoothstep(0.015, 0.06, dwRun.y)) * smoothstep(0.006, 0.02, dwRun.y) * 0.3 * streak);",
      "  }",
      // behind the bore at sea: the boil of its first tens of metres
      "  if (uDwChurn > 0.001) {",
      "    float zone = (1.0 - smoothstep(-2.0, 3.0, fdS)) * exp(min(0.0, fdS) / 30.0);",
      "    foamC = max(foamC, uDwChurn * zone * (1.0 - rIn) * 0.8);",
      "    mss += 0.02 * uDwChurn * zone;",
      "  }",
    ].join("\n");
    /* THE LAND IS THE OVERLAY'S, THE SEA IS THE SHEET'S. The camera disc's
       vertices are metres apart a hundred metres out; a run-up a metre deep
       over rising ground, interpolated that coarsely, lies under the ground.
       So the field's land is drawn by a grid at the field's own cells
       (runOverlaySync), same uniforms, same shading; one per-pixel test
       partitions them along one contour. */
    const RUN_LAND = "(dwRun.x - dwRun.y > uRunRest - 0.5)";
    const fHead = [
      "  vec4 dwRun = vec4(0.0); vec2 dwRunGv = vec2(0.0);",
      "  if (uRunOn > 0.5 && vRun.w > 0.01) {",
      "    dwRun = cbzRun(vSeaWorld.xz, dwRunGv);",
      "    if (dwRun.w > 0.5 && dwRun.y < 0.006) discard;",
      "    if (uRunOverlay > 0.5 && dwRun.w > 0.5 && " + RUN_LAND + ") discard;",
      "  }",
      "  float dwRunG = length(dwRunGv);",
    ].join("\n");
    const fHeadOverlay = [
      "  vec2 dwRunGv = vec2(0.0);",
      "  vec4 dwRun = cbzRun(vSeaWorld.xz, dwRunGv);",
      "  float dwRunG = length(dwRunGv);",
      "  if (uRunOn < 0.5 || dwRun.w < 0.5 || dwRun.y < 0.006 || !" + RUN_LAND + ") discard;",
    ].join("\n");
    const build = function (overlay) {
      return CBZ.waterSeaMaterial({
        kind: "arena", uniforms: U, name: overlay ? "CBZ Run-up Water" : (opts.name || "CBZ Disaster Water"),
        vertexDecl: vDecl, vertexTail: vTail, fragDecl: fDecl, fragInputs: fInputs,
        fragHead: overlay ? fHeadOverlay : fHead, cutGuard: "dwRun.w < 0.5", worldXZ: overlay,
        meshMinGLSL: overlay ? "uRunB.z / max(uRunB.w, 1.0)" : null,
        transparent: opts.transparent === true,
        depthWrite: opts.depthWrite == null ? (U.uSeaOpacity.value >= 0.999) : !!opts.depthWrite,
      });
    };
    const mat = build(false);
    mat.opacity = U.uSeaOpacity.value;
    mat.userData.waterMode = "shared-disaster-fresnel";
    mat.userData.buildRunOverlayMaterial = function () { return build(true); };
    return mat;
  };

  /* THE RUN-UP OVERLAY: one grid vertex per field cell centre, laid in world
     XZ, displaced and shaded by the sea's own program (worldXZ), so the flood
     on the land is drawn at the resolution it is solved at. Built lazily the
     first time a field is attached, rebuilt only when the field's domain
     changes, hidden whenever no field is attached. */
  function runOverlaySync(target, mat, u, F) {
    let ov = mat.userData.runOverlay;
    if (!F || !(u.uRunOn.value > 0.5)) {
      if (ov) ov.visible = false;
      u.uRunOverlay.value = 0;
      return;
    }
    const parent = target && target.isObject3D ? target.parent : null;
    if (!ov) {
      if (!parent || !mat.userData.buildRunOverlayMaterial) { u.uRunOverlay.value = 0; return; }
      ov = new THREE.Mesh(new THREE.BufferGeometry(), mat.userData.buildRunOverlayMaterial());
      ov.name = "tsunami-runup-overlay";
      ov.frustumCulled = false;
      ov.renderOrder = target.renderOrder;
      ov.userData.waterSurface = true;
      ov.userData.noCoat = true;
      ov.userData.terrain = true;        // batch.js / farcull.js keep their hands off
      ov.userData.key = "";
      mat.userData.runOverlay = ov;
    }
    if (parent && ov.parent !== parent) parent.add(ov);
    const key = F.x0 + "|" + F.z0 + "|" + F.size + "|" + F.n;
    if (ov.userData.key !== key) {
      const n = F.n | 0, cell = F.size / n;
      const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3;
        pos[k] = F.x0 + (i + 0.5) * cell; pos[k + 2] = F.z0 + (j + 0.5) * cell;
        nor[k + 1] = 1;
      }
      const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)((n - 1) * (n - 1) * 6);
      let o = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      ov.geometry.dispose();
      ov.geometry = g;
      ov.userData.key = key;
    }
    // the sheet's blend state, whatever the event has done to it
    const om = ov.material;
    if (om.transparent !== mat.transparent) { om.transparent = mat.transparent; om.needsUpdate = true; }
    om.depthWrite = mat.depthWrite; om.opacity = mat.opacity;
    // the grid IS world XZ (the arena root sits at the origin, as the disc assumes)
    ov.position.set(0, 0, 0);
    ov.visible = true;
    u.uRunOverlay.value = 1;
  }

  // Hand an arena sea its baked field (CBZ.waterBakeField handle).
  /* NO SHORE: the open sea between the isles (world/archipelago.js toSea).
     The sheet forgets the last island's land mask, and the baked field goes
     with it (it held the island's ground function). */
  CBZ.waterClearField = function (target) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u) return false;
    if (u.uSeaHasLandMask) u.uSeaHasLandMask.value = 0;
    if (u.uSeaLandMask) u.uSeaLandMask.value = null;
    const old = mat.userData.waterField;
    if (old && old.baked && old.tex) { old.done = true; old.tex.dispose(); }
    mat.userData.waterField = null;
    if (mat.userData.waterKind === "arena") arenaGeo = null;
    return true;
  };
  CBZ.waterSetField = function (target, field) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u || !field || !field.tex) return false;
    u.uSeaLandMask.value = field.tex;
    u.uSeaLandBounds.value.copy(field.bounds);
    u.uSeaHasLandMask.value = 1;
    /* A FIELD BAKED HERE IS THE SEA'S OWN: the one it replaces goes (each
       Isles island the sea moves to bakes a new 512x512 shore field; the old
       ones stayed on the GPU with their 1 MB arrays, 2 a round trip) */
    const old = mat.userData.waterField;
    if (old && old !== field && old.baked && old.tex && old.tex !== field.tex) { old.done = true; old.tex.dispose(); }
    mat.userData.waterField = field;
    // the CPU twin reads the same bytes (published whole when a bake completes)
    if (mat.userData.waterKind === "arena") {
      arenaGeo = geoFrom(field.tex, field.bounds);
      if (field.baked && !field.done) field.onDone = function () { if (mat.userData.waterField === field) arenaGeo = geoFrom(field.tex, field.bounds); };
    }
    return true;
  };

  const _siltB = {};
  CBZ.waterDriveDisasterSurface = function (target, state) {
    const mat = target && target.material ? target.material : target;
    const u = mat && mat.userData && mat.userData.waterUniforms;
    if (!u) return false;
    CBZ.waterDriveCommonUniforms(u);
    // The island's field is in DEPTH units, so its land cut follows the live
    // surge in metres (the city's ramp cut written above does not apply).
    u.uShoreCut.value = CBZ.waterFieldCut(_surge, 0.6);
    // finish baking the field a slice per frame, off the load path
    const fld = mat.userData && mat.userData.waterField;
    if (fld && !fld.done) fld.step(2.5);
    state = state || {};
    if (u.uRunOn) {
      const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
      const tx = F ? F.texture() : null;
      if (tx) {
        u.uRunTex.value = tx;
        u.uRunB.value.set(F.x0, F.z0, F.size, F.n);
        u.uRunRest.value = F.restY;
        u.uRunOn.value = 1;
      } else u.uRunOn.value = 0;
      if (u.uRunOverlay) runOverlaySync(target, mat, u, tx ? F : null);
    }
    // the director's sea state, as multipliers on the live spectrum
    if (Number.isFinite(state.amp)) u.uDisasterAmp.value = +state.amp;
    if (Number.isFinite(state.chop)) u.uDisasterChop.value = +state.chop;
    u.uSeaMul.value.x = arenaMulS(u.uDisasterAmp.value);
    u.uSeaMul.value.y = arenaMulW(u.uDisasterChop.value);
    arenaMulMax = Math.max(u.uSeaMul.value.x, u.uSeaMul.value.y);
    if (u.uDwSed) u.uDwSed.value = Math.max(0, Math.min(1, +state.sediment || 0));
    if (Number.isFinite(state.foam)) u.uDisasterFoam.value = +state.foam;
    if (Number.isFinite(state.opacity)) {
      u.uDisasterOpacity.value = +state.opacity;
      mat.opacity = +state.opacity;
      if (+state.opacity < 0.999 && !mat.transparent) { mat.transparent = true; mat.needsUpdate = true; }
      /* SEA_TRANSLUCENT made this number mean something. Before it, the sea was
         built transparent:false and a runtime opacity was simply ignored by the
         renderer; now the sheet really does fade — so the moment it stops being
         a full-bodied sea it must also stop writing depth, or a half-faded
         tsunami punches a hole in everything behind it. */
      if (translucentOn() && mat.userData && mat.userData.waterUniforms === u) {
        const solid = +state.opacity >= 0.999;
        if (mat.depthWrite !== solid) mat.depthWrite = solid;
      }
    }
    // the silt field: where the water is brown (world/tsunami_silt.js)
    if (u.uSiltB) {
      const SL = CBZ.tsuSilt;
      const stx = SL && SL.live ? SL.texture() : null;
      if (stx) {
        const b = SL.bounds(_siltB);
        u.uSiltTex.value = stx;
        u.uSiltB.value.set(b.x0, b.z0, b.size, 1);
      } else u.uSiltB.value.w = 0;
    }
    // ---- the turbid-front block. Absent from `state` = untouched, so an
    //      existing caller keeps its clean water without knowing this exists.
    if (u.uDwFrontC) {
      if (state.frontC) u.uDwFrontC.value.set(+state.frontC[0] || 0, +state.frontC[1] || 0);
      if (state.frontDir) {
        const dx = +state.frontDir[0] || 0, dz = +state.frontDir[1] || 0;
        const l = Math.hypot(dx, dz) || 1;
        u.uDwFrontDir.value.set(dx / l, dz / l);
        // A caller that has a front but no opinion about the flow is flowing
        // the way the front is going, which is true of every bore.
        if (!state.flowDir && u.uDwFlow) u.uDwFlow.value.set(dx / l, dz / l);
      }
      if (state.flowDir && u.uDwFlow) {
        const fx = +state.flowDir[0] || 0, fz = +state.flowDir[1] || 0;
        const fl = Math.hypot(fx, fz) || 1;
        u.uDwFlow.value.set(fx / fl, fz / fl);
      }
      /* CAPPED, and not for physics. The undertow really does run past 9 m/s,
         but the detail tile is a ~24 m pattern: advecting it that fast smears
         it into a grey blur, so the SEEN speed saturates where the eye stops
         reading translation and starts reading motion blur. The direction is
         never capped, which is the half that carries the undertow. */
      if (Number.isFinite(state.flowSpeed) && u.uDwFlowSpd) {
        u.uDwFlowSpd.value = Math.max(0, Math.min(4.5, +state.flowSpeed));
      }
      if (Number.isFinite(state.stand) && u.uDwStand) {
        u.uDwStand.value = Math.max(0, Math.min(1, +state.stand));
      }
      if (Number.isFinite(state.frontS)) u.uDwFrontS.value = +state.frontS;
      if (u.uDwChurn) u.uDwChurn.value = Number.isFinite(state.churn) ? Math.max(0, Math.min(1.5, +state.churn)) : 0;
      if (u.uDwAhead) u.uDwAhead.value = Number.isFinite(state.aheadDrop) ? Math.max(0, +state.aheadDrop) : 0;
      if (Number.isFinite(state.frontRun)) u.uDwFrontRun.value = Math.max(1, +state.frontRun);
      if (state.mud != null) u.uDwMud.value.set(state.mud);
    }
    return true;
  };

  /* ============================================================
     THE BORE FACE: ONE BREAKING BORE, SHARED BY BOTH TSUNAMIS.

     2026-09-27 REWRITE. The last version was a clean, glassy, pale mint
     Hokusai curl with a neat white cap and a backlit turquoise lip: a toy
     wave, and at landfall a tan striped curtain. Tohoku and Aceh footage
     shows neither. A tsunami bore is:

       a STEEP DARK WALL (green-grey offshore, brown/grey-black once it has
         scoured the shelf) whose front is
       a ROLLING WHITEWATER AVALANCHE: lumpy cauliflower boils of dirty foam
         tumbling forward over the crest and pouring down the wall in tongues,
       flecked with DEBRIS (planks, wreckage) carried inside the churn,
       with SPRAY AND MIST blown BACK off the crest by the wind, and
       a CHURNING SKIRT of foam where the foot meets the water ahead of it.
       Far out and small, all of that averages to a WHITE LINE on the horizon.

     So the geometry is not a curl any more. The path runs back tail -> crest
     -> a near-vertical front -> a low boiling skirt, and `curl` throws the
     upper front forward into an overhang that is itself a mass of boils.

     EVERYTHING MOVES ON THE GPU. The old face rewrote ~1550 vertices, ran
     computeVertexNormals and six CPU-animated foam layers every frame (seven
     draw calls). Now the per-frame CPU cost is a handful of uniform writes:
       draw 1  the wall (+ skirt), vertex shader displaces it (swell, throw,
               crest lobes, cellular boils) and takes its own normal by
               finite differences; fragment paints foam, holes, tongues,
               debris and the far white line.
       draw 2  crest spray + mist: GPU-animated point sprites.

     CBZ.tsuFaceBuild({width, height, rnd}) -> handle   (caller adds handle.group)
     CBZ.tsuFaceUpdate(handle, {t, dt, height, turbid, curl, foam, x, y, z,
                                dirX, dirZ, seaY?, fade?})
       seaY (optional, world y of the water surface) seats the skirt and the
       wake on the water; without it the live waterEvent level is used.
     CBZ.tsuFaceDispose(handle)

     THE LINEAR-HEX TRAP: every colour constant below is LINEAR and goes
     through ACES + sRGB, so it lands much lighter than it reads here.
     ============================================================ */
  // [forward z (m at H=34), height 0..1] back tail -> crest -> front -> skirt
  const TSU_PATH = [
    [-26.0, 0.00], [-16.0, 0.10], [-9.0, 0.30], [-4.5, 0.58], [-1.6, 0.84], [0.6, 0.97],
    [2.4, 1.00],                                                   // crest
    [3.9, 0.95], [4.7, 0.83], [5.0, 0.66], [4.8, 0.48], [4.6, 0.32], [4.9, 0.19], // the wall
    [6.2, 0.11], [8.4, 0.06], [10.6, 0.025], [13.0, 0.0],        // the skirt
  ];
  const TSU_CREST_K = 6, TSU_TOE_K = 12;
  /* THIS FACE IS THE WAVE AT SEA ONLY (2026-10-20). Once it breaks, the
     bore on the land is world/tsunami_whitewater.js: geometry laid on the
     run-up field's own fronts, and white water as lit volume. The face's
     32-column bending (tsuBoreBands) that tried to drag one straight wave
     along a ragged front is gone; at the crash the caller fades it out
     (`fade`) while the crash burst and the bore take over. */
  const TSU_COLS = 224;
  const TSU_ROWS = 50;

  function cmr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  /* Rows along the path, spaced by WEIGHTED arc length: the front and the
     crest carry the boils and get ~3x the row density of the back tail and
     the skirt. Returns [{k, z, yf, arc}] with z/arc in metres at H=34. */
  function tsuRowsLayout(rows) {
    const K = TSU_PATH, n = K.length, SUB = 24, S = [];
    for (let i = 0; i < n - 1; i++) {
      const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(n - 1, i + 2)];
      for (let s = 0; s < SUB; s++) {
        const u = s / SUB;
        S.push([i + u, cmr(a[0], b[0], c[0], d[0], u), cmr(a[1], b[1], c[1], d[1], u)]);
      }
    }
    S.push([n - 1, K[n - 1][0], K[n - 1][1]]);
    const arc = [0], wa = [0];
    for (let i = 1; i < S.length; i++) {
      const L = Math.hypot(S[i][1] - S[i - 1][1], (S[i][2] - S[i - 1][2]) * 34);
      const k = S[i][0];
      const w = k < TSU_CREST_K - 2 ? 0.55 : (k > TSU_TOE_K + 0.5 ? 1.5 : 1.6);
      arc.push(arc[i - 1] + L); wa.push(wa[i - 1] + L * w);
    }
    const out = [], tot = wa[wa.length - 1];
    let j = 1;
    for (let r = 0; r < rows; r++) {
      const target = tot * r / (rows - 1);
      while (j < wa.length - 1 && wa[j] < target) j++;
      const f = Math.max(0, Math.min(1, (target - wa[j - 1]) / Math.max(1e-6, wa[j] - wa[j - 1])));
      const L = (A, B) => A + (B - A) * f;
      out.push({ k: L(S[j - 1][0], S[j][0]), z: L(S[j - 1][1], S[j][1]), yf: L(S[j - 1][2], S[j][2]), arc: L(arc[j - 1], arc[j]) });
    }
    return out;
  }
  const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* ---- shared GLSL: hashes, value fbm, a boiling cellular field ---------- */
  const TSU_GLSL_NOISE = [
    "float h21( vec2 p ) {",
    "  vec3 q = fract( vec3( p.xyx ) * 0.1031 );",
    "  q += dot( q, q.yzx + 33.33 );",
    "  return fract( ( q.x + q.y ) * q.z );",
    "}",
    "vec2 h22( vec2 p ) {",
    "  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );",
    "  q += dot( q, q.yzx + 33.33 );",
    "  return fract( ( q.xx + q.yz ) * q.zy );",
    "}",
    "vec4 h42( vec2 p ) {",
    "  vec4 q = fract( vec4( p.xyxy ) * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );",
    "  q += dot( q, q.wzxy + 33.33 );",
    "  return fract( ( q.xxyz + q.yzzw ) * q.zywx );",
    "}",
    "float vn( vec2 p ) {",
    "  vec2 i = floor( p ), f = fract( p );",
    "  f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ),",
    "              mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );",
    "}",
    /* THE BOIL. Worley with every feature point orbiting on its own clock,
       SMOOTH-MINNED (log-sum-exp over the 3x3 cells) so the caps are
       rounded billows with soft creases between them. Plain F1 shades as
       flat Voronoi plates: styrofoam, not whitewater. .x = billow height
       0..1, .yz = the height's slope direction (weighted offset to the
       nearby centres), so the fragment gets its bump normal for free. */
    "vec3 cellB( vec2 q, float T ) {",
    "  vec2 i = floor( q ), f = fract( q );",
    "  float S = 0.0; vec2 G = vec2( 0.0 );",
    "  for ( int yy = -1; yy <= 1; yy++ ) {",
    "    for ( int xx = -1; xx <= 1; xx++ ) {",
    "      vec2 g = vec2( float( xx ), float( yy ) );",
    "      vec2 o = h22( i + g );",
    "      o = 0.5 + 0.38 * sin( T * ( 0.7 + o.yx * 1.1 ) + o * 6.2831 );",
    "      vec2 r = g + o - f;",
    "      float w = exp( -7.0 * dot( r, r ) );",
    "      S += w; G += w * r;",
    "    }",
    "  }",
    "  float d = -log( max( S, 1e-6 ) ) / 7.0;",
    "  return vec3( clamp( 1.0 - d * 1.9, 0.0, 1.0 ), G / max( S, 1e-6 ) );",
    "}",
  ].join("\n");

  function tsuLightUniforms() {
    return {
      uSunDir: { value: new THREE.Vector3(0.42, 0.79, -0.09) },
      uSunCol: { value: new THREE.Color(1.0, 0.96, 0.88) },
      uSkyCol: { value: new THREE.Color(0.62, 0.72, 0.86) },
      uGndCol: { value: new THREE.Color(0.22, 0.24, 0.18) },
    };
  }

  /* ============================================================
     THE WALL MATERIAL.
     Vertex: the rest pose (baked per vertex at build) is scaled to the live
     height, swayed, thrown forward by `curl`, lobed along the crest, seated
     on the sea at the skirt, and then BOILED: the cellular field, scrolling
     over the crest and down the front at the roll speed, pushes the surface
     out along its normal wherever the whitewater is. Normal = cross of two
     finite-difference neighbours run through the same function.
     Fragment: where the whitewater is (the torn lip, the foot, the skirt,
     the far white line) and the boil relief, then the sea's own
     cbzWaterShade on that normal and foam cover.
     ============================================================ */
  function tsuWallMaterial(light) {
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uTime: { value: 0 }, uTurbid: { value: 0 }, uCurl: { value: 0.5 }, uCurlN: { value: 0.4 },
      uH: { value: 34 }, uHs: { value: 1 }, uFoam: { value: 0.7 },
      uSkirt: { value: 1 }, uSeaLocal: { value: 0.5 },
      uLumpS: { value: 4 }, uLumpA: { value: 1.5 }, uRollV: { value: 3 },
      uLobe: { value: new THREE.Vector4() }, uLobeFrom: { value: 0.79 },
      uLP: { value: new THREE.Vector3() }, uHalfW: { value: 160 },
      uFade: { value: 1 },
    });
    // the light uniforms are SHARED objects across the face's materials
    uni.uSunDir = light.uSunDir; uni.uSunCol = light.uSunCol;
    uni.uSkyCol = light.uSkyCol; uni.uGndCol = light.uGndCol;
    // the water's one light and its shading library (cbzWaterShade)
    Object.assign(uni, CBZ.waterLightUniforms());

    const VERT = [
      "attribute vec4 aFace;",   // x (m), arc (m at build H), height fraction, side 0 back..1 front
      "attribute vec4 aFaceD;",  // d(yf)/d(arc), d(side)/d(arc), skirt 0..1, skirt distance 0..1
      "attribute vec3 aTx;",     // rest tangent per metre along the front
      "attribute vec3 aTs;",     // rest tangent per metre of arc
      "uniform float uTime, uTurbid, uCurl, uH, uHs, uSkirt, uSeaLocal, uLumpS, uLumpA, uRollV, uLobeFrom, uHalfW;",
      "uniform vec4 uLobe;",
      "uniform vec3 uLP;",
      "varying vec4 vFace;",
      "varying vec4 vAux;",      // skirt, skirt distance, roll mask, boil height
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "#include <fog_pars_vertex>",
      TSU_GLSL_NOISE,
      // where the whitewater is: the roller on the upper front (deeper with
      // sediment), a little over the back of the crest, the foot, the skirt
      "float rollMask( float u, float side, float sk, float sdn ) {",
      "  float lo = mix( 0.88, 0.80, uTurbid );",
      "  float r = smoothstep( lo, lo + 0.22, u ) * mix( 0.30, 1.0, side ) * ( 1.0 - sk );",
      "  r = max( r, side * ( 1.0 - sk ) * ( 1.0 - smoothstep( 0.12, 0.30, u ) ) * 0.65 );",
      "  r = max( r, sk * ( 1.0 - smoothstep( 0.0, 0.8, sdn ) ) * ( 0.55 + 0.45 * uTurbid ) );",
      "  return r;",
      "}",
      "vec3 shape( vec3 p, float x, float arcL, float u, float side, float sk, float sdn ) {",
      "  float T = uTime;",
      "  float ch = 1.0 + uTurbid * 1.35;",
      "  float A0 = T * 1.55 + x * 0.052 + arcL * 0.05;",
      "  float A1 = -T * 2.10 + x * 0.091 - arcL * 0.03;",
      "  p.x += sin( A1 ) * 0.34 * u * ch;",
      "  p.y += ( sin( A0 ) * ( 0.16 + 0.72 * u ) + sin( A1 ) * 0.22 * u ) * ch;",
      "  p.z += sin( A0 * 0.77 ) * ( 0.08 + 0.78 * u ) * ch;",
      // the throw: the upper front runs ahead of its own foot
      "  float cw = u * u * mix( 0.45, 1.0, side ) * ( 1.0 - sk );",
      "  p.z += uCurl * 8.0 * uHs * cw;",
      // the crest is never one height: lobes, and chunks thrown up out of it
      "  float lr = max( 0.0, ( u - uLobeFrom ) / ( 1.0 - uLobeFrom ) );",
      "  float lw = lr * lr * ( 1.0 - sk );",
      "  float lobe = sin( x * 0.041 + T * 0.85 + uLP.x ) * 0.56 + sin( x * 0.108 - T * 1.37 + uLP.y ) * 0.30",
      "             + sin( x * 0.283 + T * 2.31 + uLP.z ) * 0.19 + sin( x * 0.71 - T * 3.4 + uLP.x * 2.1 ) * 0.11;",
      "  float s1 = max( 0.0, sin( x * 0.34 + T * 2.9 + uLP.y * 1.7 ) );",
      "  float s2 = max( 0.0, sin( x * 0.155 - T * 1.9 + uLP.z * 2.3 ) );",
      "  float fg = s1 * s1 * s1 * 0.72 + s2 * s2 * 0.5;",
      "  p.y += lw * ( lobe * uLobe.x + fg * uLobe.z );",
      "  p.z += lw * ( lobe * uLobe.y + fg * uLobe.w );",
      // the skirt is SEATED ON THE SEA, a low mound running out ahead
      "  float mound = uSeaLocal + 0.28 + ( 0.05 + 0.07 * uTurbid ) * uH * pow( 1.0 - sdn, 1.6 );",
      "  p.y = mix( p.y, mound, sk );",
      "  p.z += sk * sdn * ( uSkirt - 1.0 ) * 8.1 * ( uH / 34.0 );",
      "  return p;",
      "}",
      "float boil( float x, float arcL, float roll ) {",
      "  if ( roll < 0.01 ) return 0.0;",
      // A LITTLE LONGER DOWN THE FALL LINE, NOT COMBED (2026-10-20): at 2.4:1
      // the billows were ridges, and edge-on from the beach a field of
      // ridges is a field of lines. 1.25:1 keeps them pouring, and round.
      "  vec2 q = vec2( x / uLumpS, ( arcL - uTime * uRollV ) / ( uLumpS * 1.25 ) );",
      "  float a = cellB( q, uTime ).x;",
      "  float b = cellB( q * 2.13 + vec2( 5.2 + uTime * 0.25, 1.7 ), uTime * 1.3 ).x;",
      "  return a * 0.68 + b * 0.32;",
      "}",
      "void main() {",
      "  vec3 sc = vec3( 1.0, uHs, uHs );",
      "  float x = aFace.x, u = aFace.z, side = aFace.w, sk = aFaceD.z, sdn = aFaceD.w;",
      "  float arcL = aFace.y * uHs;",
      "  const float EX = 0.7, ES = 0.6;",
      "  vec3 p0 = shape( position * sc, x, arcL, u, side, sk, sdn );",
      "  vec3 px = shape( ( position + aTx * EX ) * sc, x + EX, arcL, u, side, sk, sdn );",
      "  float u2 = u + aFaceD.x * ES, sd2 = clamp( side + aFaceD.y * ES, 0.0, 1.0 );",
      "  vec3 ps = shape( ( position + aTs * ES ) * sc, x, arcL + ES * uHs, u2, sd2, sk, sdn );",
      "  vec3 n0 = normalize( cross( ps - p0, px - p0 ) );",   // outward
      "  float roll = rollMask( clamp( u, 0.0, 1.0 ), side, sk, sdn );",
      "  float amp = uLumpA * roll;",
      "  float b0 = boil( x, arcL, roll );",
      "  float bx = boil( x + EX, arcL, roll );",
      "  float bs = boil( x, arcL + ES * uHs, rollMask( clamp( u2, 0.0, 1.0 ), sd2, sk, sdn ) );",
      "  vec3 q0 = p0 + n0 * b0 * amp;",
      "  vec3 qx = px + n0 * bx * amp;",
      "  vec3 qs = ps + n0 * bs * amp;",
      "  vec3 nL = normalize( cross( qs - q0, qx - q0 ) );",
      "  vFace = vec4( x, arcL, u, side );",
      "  vAux = vec4( sk, sdn, roll, b0 );",
      "  vec4 wp = modelMatrix * vec4( q0, 1.0 );",
      "  vWPos = wp.xyz;",
      "  vNrm = normalize( mat3( modelMatrix ) * nL );",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const FRAG = [
      "uniform float uTime, uTurbid, uCurlN, uH, uHs, uFoam, uLumpS, uRollV, uHalfW, uFade;",
      "uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol;",
      SHADE_GLSL,
      "varying vec4 vFace;",
      "varying vec4 vAux;",
      "varying vec3 vWPos;",
      "varying vec3 vNrm;",
      "#include <fog_pars_fragment>",
      TSU_GLSL_NOISE,
      // the top octaves fade with distance: a metre octave on a nine-pixel wave crawls
      "float fbm( vec2 p, float fine ) {",
      "  float s = 0.0, w = 0.0, a = 0.5;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.03;",
      "  s += a * vn( p ); w += a; a *= 0.52; p *= 2.07;",
      "  s += a * fine * vn( p ); w += a * fine;",
      "  return s / max( w, 0.0001 );",
      "}",
      "void main() {",
      "  vec3 toCam = cameraPosition - vWPos;",
      "  float dist = length( toCam );",
      "  vec3 V = toCam / max( dist, 0.001 );",
      "  float fine = 1.0 - smoothstep( 140.0, 560.0, dist );",
      /* THE FOOTPRINT, in the face's own metres (x along the front, arc up
         the profile): every octave smaller than ~2 pixels eases to its mean.
         Seen edge-on (the beach looking along a 300 m front) one pixel spans
         tens of metres of x, and metre cells resolved there as hairlines. */
      "  float fpw = max( length( vec2( dFdx( vFace.x ), dFdx( vFace.y ) ) ), length( vec2( dFdy( vFace.x ), dFdy( vFace.y ) ) ) );",
      "  fine = min( fine, 1.0 - smoothstep( 0.35, 1.1, fpw ) );",
      "  float x = vFace.x, arc = vFace.y, up = clamp( vFace.z, 0.0, 1.0 ), side = vFace.w;",
      "  float sk = vAux.x, sdn = vAux.y, roll = vAux.z, boilV = vAux.w;",
      "  float T = uTime, tb = uTurbid;",
      "  float fall = arc - T * uRollV;",
      "  float nA = fbm( vec2( x * 0.045, fall * 0.06 ), fine );",
      "  float nB = fbm( vec2( x * 0.30, fall * 0.34 ), fine );",
      // churn cells, round (a touch long down the fall line), filtered by footprint
      "  float kA = 1.0 - smoothstep( 0.22, 0.55, fpw / ( uLumpS * 0.55 ) );",
      "  float kB = 1.0 - smoothstep( 0.22, 0.55, fpw / ( uLumpS * 0.22 ) );",
      "  vec3 cA = kA > 0.01 ? cellB( vec2( x, fall * 0.8 ) / ( uLumpS * 0.55 ), T * 1.2 ) : vec3( 0.6, 0.0, 0.0 );",
      "  cA = mix( vec3( 0.6, 0.0, 0.0 ), cA, kA );",
      "  vec3 cB = ( fine > 0.03 && kB > 0.01 ) ? cellB( vec2( x, fall * 0.8 ) / ( uLumpS * 0.22 ) + 7.7, T * 1.7 ) : vec3( 0.6, 0.0, 0.0 );",
      "  cB = mix( vec3( 0.6, 0.0, 0.0 ), cB, kB * fine );",
      /* TORN CHURN (2026-10-20). This was FLOW STREAKS: noise at 15:1 and
         16:1 (x * 0.85 against fall * 0.055), "fine lines running with the
         water" by design, and the owner's "fake streaks / brush scratches"
         on every shot of the face. Whitewater pouring down a wall is torn
         into clots and holes, not ribbons: the same two scales now, round,
         domain-warped by the big churn, and filtered by footprint. */
      "  float stk = fbm( vec2( x, fall ) * 0.32 + vec2( nA, nB ) * 1.6, fine );",
      "  float stk2 = mix( 0.5, vn( vec2( x, fall ) * 0.95 - nB * 2.0 + 3.1 ), fine );",
      "  float streak = smoothstep( 0.30, 0.72, stk * 0.65 + stk2 * 0.35 );",
      // ---- foam coverage (2026-09-27 WATER PASS)
      /* The last pass read as a grey mountain range with snow on it: a matte
         body streaked with vertical gullies (tongues, runs, lace, streaked
         normals) under a uniform fluffy white cap. Tohoku footage says the
         opposite: the FACE is dark, clean and GLOSSY, the white water is a
         ragged churn at the LIP and an explosion at the FOOT where the water
         hits land, and the only light band on the face is the thinning water
         just under the lip. So: no face streaks at all, a narrow torn lip,
         a violent base. */
      "  float jag = fbm( vec2( x * 0.05 - T * 0.02, 3.7 ), 0.4 );",
      "  float jag2 = fbm( vec2( x * 0.19 + T * 0.05, 8.1 ), fine );",
      "  float edge = mix( 0.92, 0.86, tb ) - ( jag - 0.5 ) * 0.10 - ( jag2 - 0.5 ) * 0.06 - 0.03 * uCurlN;",
      "  float rollF = smoothstep( edge - 0.015, edge + 0.04, up ) * smoothstep( 0.2, 0.7, side ) * ( 1.0 - sk );",
      "  float backF = ( 1.0 - side ) * smoothstep( 0.86, 0.98, up + ( nB - 0.5 ) * 0.2 );",
      // the foot: whitewater climbing the lower wall where it hits the land
      "  float footTop = 0.10 + 0.12 * tb + ( jag2 - 0.5 ) * 0.10 + ( jag - 0.5 ) * 0.08;",
      "  float footF = side * ( 1.0 - sk ) * ( 1.0 - smoothstep( footTop - 0.03, footTop + 0.04, up ) );",
      "  float skirtF = sk * smoothstep( 0.30 - 0.14 * tb, 0.58, nB * 0.6 + cA.x * 0.4 ) * ( 1.0 - smoothstep( 0.35, 1.0, sdn ) );",
      "  float foam = max( max( rollF, backF ), max( footF, skirtF ) );",
      /* HOLES: churn is torn, never a blanket. Dark water shows through
         between the boils, most at the ragged margins of each band. */
      "  float hole = 1.0 - smoothstep( 0.20 + 0.08 * tb, 0.42 + 0.08 * tb, cA.x * 0.55 + nB * 0.45 );",
      "  foam *= 1.0 - hole * mix( 0.85, 0.45, rollF );",
      // ...and combed into flow streaks everywhere but the very top of the churn
      "  float core = smoothstep( edge + 0.02, edge + 0.10, up ) * ( 1.0 - sk );",
      /* THE WHITE LINE. Far out (or while the face is still low) the churn is
         sub-pixel and what the eye sees is a bright white line on the sea.
         (DECLARED HERE, before its first use. From 2026-09-28 to 2026-10-20
         the line below read `far` two lines before this declaration: an
         undeclared identifier is a GLSL compile error, so the whole bore
         face failed to link and was never drawn. The tsunami was its spray
         sprites and the flat wake shreds with no wave under them, which is
         the "white part at the top" the owner kept seeing.) */
      "  float far = max( smoothstep( 280.0, 900.0, dist ), 1.0 - smoothstep( 3.5, 9.0, uH ) );",
      "  foam *= mix( mix( 0.22 + 0.78 * streak, 1.0, core * 0.55 ), 1.0, far );",
      "  foam = clamp( foam * ( 0.85 + 0.30 * uFoam ), 0.0, 1.0 );",
      "  foam = mix( foam, max( foam, smoothstep( 0.40, 0.75, up + 0.25 * side ) * ( 1.0 - sk ) ), far );",
      // ---- normal
      "  vec3 nrm = normalize( vNrm );",
      "  if ( dot( nrm, V ) < 0.0 ) nrm = -nrm;",
      "  vec3 Tt = cross( vec3( 0.0, 1.0, 0.0 ), nrm );",
      "  float tl = length( Tt );",
      "  Tt = tl > 0.08 ? Tt / tl : vec3( 1.0, 0.0, 0.0 );",
      "  vec3 Bt = cross( nrm, Tt );",
      /* RIPPLES ON THE FACE: wide, low, slightly slanted swells climbing the
         wall (a bore's face is being fed from below), the slope taken by
         finite differences so every crest of every ripple catches the sky. */
      "  vec2 rq = vec2( x * 0.24 + arc * 0.03, arc * 0.36 + T * uRollV * 0.40 );",
      "  float r0 = fbm( rq, fine ), rx = fbm( rq + vec2( 0.35, 0.0 ), fine ), ry = fbm( rq + vec2( 0.0, 0.35 ), fine );",
      "  vec2 rq2 = vec2( x * 0.80 - arc * 0.08, arc * 1.15 + T * uRollV * 1.0 ) + 17.0;",
      "  float s0 = vn( rq2 ), sx = vn( rq2 + vec2( 0.3, 0.0 ) ), sy = vn( rq2 + vec2( 0.0, 0.3 ) );",
      "  vec2 gW = ( vec2( rx - r0, ry - r0 ) * 3.2 + vec2( sx - s0, sy - s0 ) * 1.6 * fine ) * mix( 1.0, 0.35, smoothstep( 0.4, 0.9, 1.0 - dot( nrm, V ) ) );",
      "  vec2 gA = cA.yz * 3.0, gB = cB.yz * 3.0;",
      "  vec2 g = ( gA * 0.55 + gB * 0.35 * fine ) * foam + gW * ( 1.0 - foam );",
      "  vec3 N = normalize( nrm - ( Tt * g.x + Bt * g.y ) * 0.45 * ( 1.0 - far * 0.7 ) );",
      "  float ndl = max( dot( N, uSunDir ), 0.0 );",
      /* ONE WATER. The face is the sea standing up, shaded by the sea's own
         function: the same body (deep, opaque behind it), the same sky in its
         Fresnel, the same sun lobe, the same foam look in the face's own
         coordinates, and the mud it scoured as turbidity. What is its own is
         the light through the thin water under the lip and in the curl. */
      "  float band = side * ( 1.0 - sk ) * smoothstep( edge - 0.34, edge - 0.03, up ) * ( 1.0 - smoothstep( edge - 0.01, edge + 0.05, up ) );",
      "  float underC = side * ( 1.0 - sk ) * smoothstep( 0.55, 0.85, up ) * ( 1.0 - smoothstep( -0.55, 0.05, N.y ) );",
      "  float thinL = max( underC, band * 0.6 ) * ( 0.8 + 0.4 * r0 );",
      "  float mssF = 0.006 + 0.03 * roll * ( 1.0 - foam ) + 0.02 * far;",
      "  vec4 shF = cbzWaterShade( vWPos, vec2( x, fall ) * 0.55, N, V, mssF, 30.0, tb, foam, thinL * 3.0, 0.0, fpw, T );",
      "  vec3 col = shF.rgb;",
      // ---- alpha: the back tail melts into the sea, the skirt is patches, the ends dissolve
      "  float a = mix( smoothstep( 0.0, 0.14, up ), 1.0, side );",
      "  a *= mix( 1.0, clamp( skirtF * 1.3 + 0.18 * ( 1.0 - smoothstep( 0.0, 0.9, sdn ) ), 0.0, 1.0 ), sk );",
      "  a *= 1.0 - smoothstep( 0.88, 1.0, abs( x ) / uHalfW );",
      // the crash hand-off: the wave comes down and the bore takes over
      "  a *= uFade;",
      "  if ( a < 0.02 ) discard;",
      "  gl_FragColor = vec4( col, a );",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Face",
      uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: true,
      extensions: { derivatives: true },
    });
    mat.userData.uni = uni;
    return mat;
  }

  /* ============================================================
     THE CREST SPRAY: one Points draw, fully GPU-animated.
     Three populations in one buffer:
       DROPLETS (kind 0): small, dense, launched up off the lip and dragged
         back and down by the wind.
       MIST (kind 1): soft puffs that rise and stream far back behind the
         crest; the plume you see torn off every big breaker.
       VEIL (kind 2): huge, faint, slow puffs hugging the crest and the top
         of the front. They are what dissolves the lip's silhouette into the
         sky: without them the crest is a hard cut-out edge, which is the
         single strongest "this is a mesh" tell.
     The wind blows toward local -z (against the travel), which is what
     tears plumes back off a real bore. Every sprite is a round, lumpy,
     alpha-falloff puff computed in the fragment shader: never a card, never
     a triangle, and it fades out before it reaches the lens.
     ============================================================ */
  function tsuSprayBuild(W, H, hJitAt, zJitAt, rnd0, light) {
    /* ONE draw off the caller's stream, then a private one: the sprite count
       is a look knob, and tuning it must never reroll the caller's seeded
       gameplay stream (the survival director's bearing, timing, crowd). */
    let st = (Math.floor(rnd0() * 4294967296) >>> 0) || 1;
    const rnd = function () {
      st = (st + 0x6D2B79F5) >>> 0;
      let t = st;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const N = Math.max(600, Math.min(1800, Math.round(W * 3.0)));
    const zs = H / 34;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), kind = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = ((i + rnd()) / N - 0.5) * W * 0.96;
      pos[i * 3] = x;
      pos[i * 3 + 1] = hJitAt(x) * H;
      pos[i * 3 + 2] = 2.6 * zs + zJitAt(x);
      seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
      const k = rnd();
      kind[i] = k < 0.26 ? 0 : (k < 0.50 ? 1 : (k < 0.62 ? 2 : 3));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uTime: { value: 0 }, uHs: { value: 1 }, uH: { value: H }, uCurl: { value: 0.5 },
      uTurbid: { value: 0 }, uSpray: { value: 1 }, uWind: { value: 6 }, uScale: { value: 450 },
      uSeaLocal: { value: 0.5 }, uHalfW: { value: W * 0.5 }, uFade: { value: 1 },
      uClean: { value: new THREE.Color(0.86, 0.88, 0.88) },
      uMud: { value: new THREE.Color(0.42, 0.385, 0.32) },
    });
    uni.uSunCol = light.uSunCol; uni.uSkyCol = light.uSkyCol;
    const VERT = [
      "attribute vec4 aSeed;",
      "attribute float aKind;",
      "uniform float uTime, uHs, uH, uCurl, uTurbid, uSpray, uWind, uScale, uSeaLocal, uHalfW, uFade;",
      "uniform vec3 uClean, uMud, uSunCol, uSkyCol;",
      "varying vec4 vCol;",
      "varying vec3 vPuff;",   // seed, lumpiness, kind
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vec4 s = aSeed;",
      "  float kd = aKind;",
      "  float L = kd > 2.5 ? 2.2 + 1.8 * s.y : ( kd > 1.5 ? 5.0 + 4.0 * s.y : ( kd > 0.5 ? 3.4 + 2.6 * s.y : 1.3 + 1.2 * s.y ) );",
      "  float cyc = uTime / L + s.x;",
      "  float life = fract( cyc );",
      "  float gen = floor( cyc );",
      "  float tt = life * L;",
      "  float sh = sqrt( max( 0.15, uHs ) );",
      "  vec3 p = position * vec3( 1.0, uHs, uHs );",
      "  p.x += ( fract( sin( gen * 12.9898 + s.z * 78.233 ) * 43758.5453 ) - 0.5 ) * 4.0;",
      "  p.z += uCurl * 8.0 * uHs * 0.8;",
      "  float size, a;",
      "  float ground = 1.0;",
      "  if ( kd > 2.5 ) {",
      /* THE FOOT BURST: where the wall's base slams into the land it
         explodes UP, a boiling white column thrown forward onto the street.
         Born on the water at the toe, launched to 15-55% of the wall. */
      "    float hmax = uH * ( 0.15 + 0.40 * s.w * s.w );",
      "    float g = 7.0;",
      "    float vy = sqrt( 2.0 * g * hmax );",
      "    p.y = uSeaLocal + 0.5 + max( 0.0, vy * tt - 0.5 * g * tt * tt );",
      "    p.z = position.z * uHs + ( 2.8 + 1.5 * s.z ) * uH / 34.0 + ( 1.5 + 3.5 * s.z ) * tt;",
      "    p.x += ( s.y - 0.5 ) * 3.0 * tt;",
      "    size = ( 4.0 + 9.0 * s.z ) * ( 0.4 + 0.6 * uHs ) * ( 0.5 + 1.3 * life );",
      "    a = 0.62 * smoothstep( 0.0, 0.1, life ) * pow( 1.0 - life, 1.1 );",
      "    ground = 0.0;",
      "  } else if ( kd > 1.5 ) {",
      /* the veil: a churning cloud ON the roller, not behind it. s.w is how
         far down the front a puff is born (0 = the lip, 1 = 12% down the
         wall); the deep ones sit out in front of the face and tumble down
         with the roll, the high ones lift off the lip and blow back. */
      "    float dn = s.w;",
      "    p.y += -uH * 0.12 * dn + ( 0.25 + 1.0 * ( 1.0 - dn ) ) * sh * tt - dn * 1.3 * sh * tt - 1.2 * tt * tt;",
      "    p.z += ( 1.4 + 2.6 * dn + 2.0 * s.z ) * uH / 34.0 - uWind * 0.30 * ( 1.0 - dn ) * tt;",
      "    p.x += ( s.y - 0.5 ) * 1.2 * tt;",
      "    size = ( 6.0 + 10.0 * s.z ) * ( 0.35 + 0.65 * uHs ) * ( 0.75 + 0.7 * life );",
      "    a = 0.22 * ( 1.0 - 0.5 * dn ) * sin( 3.14159 * life );",
      "  } else if ( kd > 0.5 ) {",
      "    p.y += uH * 0.03 + ( 1.0 + 2.6 * s.w ) * sh * tt - 2.4 * tt * tt;",
      "    p.z -= uWind * ( 0.9 * tt + 0.10 * tt * tt );",
      "    p.x += ( s.z - 0.5 ) * 1.6 * tt;",
      "    size = ( 7.0 + 10.0 * s.z ) * ( 0.4 + 0.6 * uHs ) * ( 1.0 + 1.4 * life );",
      "    a = 0.30 * sin( 3.14159 * life );",
      "  } else {",
      "    float vy = ( 2.5 + 7.0 * s.w ) * sh;",
      "    p.y += vy * tt - 3.4 * tt * tt;",
      "    p.z += ( 0.8 + 2.2 * s.z ) * tt - uWind * 0.6 * tt * tt;",
      "    p.x += ( s.z - 0.5 ) * 2.0 * tt;",
      "    size = ( 0.6 + 1.3 * s.y ) * ( 0.6 + 0.4 * uHs ) * ( 1.0 + 1.5 * life );",
      "    a = 0.50 * smoothstep( 0.0, 0.08, life ) * pow( 1.0 - life, 1.3 );",
      "  }",
      // no crest to tear where the wave has tapered into the sea
      "  a *= uSpray * mix( 1.0, smoothstep( 0.25, 0.6, position.y / max( 0.001, uH / uHs ) ), ground );",
      /* SPRAY IS AIR AND WATER, NOT A DUST CLOUD (2026-10-20). Seen from
         the sea behind the bore, 400-odd mist puffs at 0.66 alpha in the full
         mud colour laid a tan band over the whole island: the "brown haze"
         that hid the wave. Torn-off spray of a filthy wave is still pale
         (the droplets scatter white); it takes only part of the mud, and the
         mist is thinner. */
      "  vec3 c = mix( uClean, uMud, smoothstep( 0.0, 0.7, uTurbid ) * mix( 0.12, 0.45, step( 2.5, kd ) ) ) * ( 0.9 + 0.1 * s.y );",
      // spray scatters light from everywhere: the key and the whole sky
      "  vec3 lit = uSkyCol * 0.9 + uSunCol * 0.85;",
      "  vCol = vec4( c * lit, a * uFade );",
      "  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );",
      "  float dz = -mvPosition.z;",
      // a puff that reaches the lens fades instead of filling the frame
      "  vCol.a *= smoothstep( 1.5, 9.0, dz );",
      "  vPuff = vec3( s.z * 17.0 + gen * 3.1, s.w, kd );",
      "  gl_Position = projectionMatrix * mvPosition;",
      // a droplet smaller than a couple of pixels is a white dot, not spray:
      // it fades out instead of being clamped up to a one-pixel speck
      "  float psz = size * projectionMatrix[1][1] * uScale / max( 0.5, dz );",
      "  vCol.a *= smoothstep( 1.2, 3.5, psz );",
      "  gl_PointSize = vCol.a > 0.003 ? clamp( psz, 1.0, 420.0 ) : 0.0;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");
    const FRAG = [
      "varying vec4 vCol;",
      "varying vec3 vPuff;",
      "#include <fog_pars_fragment>",
      TSU_GLSL_NOISE,
      "void main() {",
      "  vec2 c = gl_PointCoord * 2.0 - 1.0;",
      "  float d = dot( c, c );",
      "  if ( d > 1.0 ) discard;",
      "  float a = vCol.a * ( 1.0 - d ) * ( 1.0 - d );",
      // the big puffs are lumpy, not discs: a cheap two-octave billow inside the falloff
      "  if ( vPuff.z > 0.5 ) {",
      "    vec2 q = gl_PointCoord * 2.6 + vec2( vPuff.x, vPuff.x * 0.7 );",
      "    float n = vn( q ) * 0.65 + vn( q * 2.3 + 4.1 ) * 0.35;",
      "    a *= smoothstep( 0.15, 0.85, n + 0.35 * ( 1.0 - d ) );",
      "  }",
      "  gl_FragColor = vec4( vCol.rgb, a );",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    const mat = new THREE.ShaderMaterial({
      name: "CBZ Bore Spray", uniforms: uni, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    return { points: pts, geo: geo, mat: mat, count: N };
  }

  /* THE WAKE SHREDS ARE GONE (2026-10-20). Sixty flat tapered strips, one
     flat colour each, sliding back over the sea behind the front: from any
     height they read as exactly what they were, white lines painted on the
     water. The churn behind a bore is the sea's own surface (its froth, chop
     and boiling displacement: dwFroth / dwChopGrad / uDwChurn), and the
     breaking white water is volume on the bore's fronts
     (world/tsunami_whitewater.js). */
  CBZ.tsuFaceBuild = function (opts) {
    opts = opts || {};
    const H = Number.isFinite(opts.height) ? +opts.height : 34;
    const W = Number.isFinite(opts.width) ? +opts.width : 320;
    const zs = H / 34;
    const rnd = typeof opts.rnd === "function" ? opts.rnd : Math.random;
    const grp = new THREE.Group();
    const ROWS = TSU_ROWS, COLS = TSU_COLS;
    const geoms = [], mats = [];
    const light = tsuLightUniforms();

    /* The crest is not a ruler: per-column height and forward-lead jitter,
       drawn on ~10 m knots and smoothstepped between (per-column draws at
       this pitch would be corduroy), plus beating sines for runs of taller
       and lower crest, plus an end taper so the wave dies into the sea
       sideways instead of stopping on a vertical edge. */
    const zJit = [], hJit = [];
    const phA = rnd() * 6.283, phB = rnd() * 6.283, phC = rnd() * 6.283, phD = rnd() * 6.283;
    const KSTEP = Math.max(3, Math.round(10 / (W / COLS))), KN = Math.ceil(COLS / KSTEP) + 2;
    const knH = [], knZ = [];
    for (let k = 0; k < KN; k++) { knH.push(0.96 + rnd() * 0.08); knZ.push((rnd() - 0.5) * 2.0); }
    const knot = function (arr, c) {
      const f = c / KSTEP, i = Math.min(KN - 2, Math.floor(f)), a = f - i;
      return arr[i] + (arr[i + 1] - arr[i]) * a * a * (3 - 2 * a);
    };
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.14);
      const taper = 0.08 + 0.92 * edge * edge * (3 - 2 * edge);
      const lf = 1 + 0.035 * Math.sin(u * 9.7 + phA) + 0.02 * Math.sin(u * 23 + phB) + 0.01 * Math.sin(u * 57 + phD);
      zJit.push(knot(knZ, c) + Math.sin(u * 6.9 + phC) * 1.8 + Math.sin(u * 31 + phD) * 0.6);
      hJit.push(knot(knH, c) * lf * taper);
    }
    let hMean = 0; for (let c = 0; c <= COLS; c++) hMean += hJit[c];
    hMean /= COLS + 1;
    let hVar = 0; for (let c = 0; c <= COLS; c++) { const d = hJit[c] - hMean; hVar += d * d; }
    const crestVar = Math.sqrt(hVar / (COLS + 1)) / Math.max(0.001, hMean);
    const endTaper = Math.min(hJit[0], hJit[COLS]) / Math.max(0.001, hMean);
    const colAt = (x) => Math.max(0, Math.min(COLS, Math.round((x / W + 0.5) * COLS)));

    // ---- the rest pose, baked once
    const lay = tsuRowsLayout(ROWS);
    let arcToe = 0, arcEnd = lay[ROWS - 1].arc;
    for (let r = 1; r < ROWS; r++) if (lay[r - 1].k <= TSU_TOE_K && lay[r].k >= TSU_TOE_K) {
      const f = (TSU_TOE_K - lay[r - 1].k) / Math.max(1e-6, lay[r].k - lay[r - 1].k);
      arcToe = lay[r - 1].arc + (lay[r].arc - lay[r - 1].arc) * f;
    }
    const rowSide = [], rowSk = [], rowSd = [];
    for (let r = 0; r < ROWS; r++) {
      const k = lay[r].k;
      rowSide.push(smooth01(TSU_CREST_K - 0.8, TSU_CREST_K + 0.8, k));
      rowSk.push(smooth01(TSU_TOE_K - 0.3, TSU_TOE_K + 1.0, k));
      rowSd.push(Math.max(0, Math.min(1, (lay[r].arc - arcToe) / Math.max(1e-6, arcEnd - arcToe))));
    }
    const n = ROWS * (COLS + 1);
    const pos = new Float32Array(n * 3);
    const face = new Float32Array(n * 4), faceD = new Float32Array(n * 4);
    const tx = new Float32Array(n * 3), ts = new Float32Array(n * 3);
    for (let r = 0; r < ROWS; r++) {
      const L = lay[r], yf = L.yf, side = rowSide[r];
      for (let c = 0; c <= COLS; c++) {
        const vi = r * (COLS + 1) + c, x = (c / COLS - 0.5) * W;
        pos[vi * 3] = x;
        pos[vi * 3 + 1] = yf * H * hJit[c];
        pos[vi * 3 + 2] = L.z * zs + zJit[c] * Math.max(Math.max(0, yf), side);
        face[vi * 4] = x; face[vi * 4 + 1] = L.arc * zs; face[vi * 4 + 2] = yf; face[vi * 4 + 3] = side;
      }
    }
    // tangents and d/darc of the row parameters, by central differences
    for (let r = 0; r < ROWS; r++) {
      const r0 = Math.max(0, r - 1), r1 = Math.min(ROWS - 1, r + 1);
      const da = Math.max(1e-4, (lay[r1].arc - lay[r0].arc) * zs);
      const dyf = (lay[r1].yf - lay[r0].yf) / da, dsd = (rowSide[r1] - rowSide[r0]) / da;
      for (let c = 0; c <= COLS; c++) {
        const vi = r * (COLS + 1) + c;
        const a0 = r0 * (COLS + 1) + c, a1 = r1 * (COLS + 1) + c;
        for (let k = 0; k < 3; k++) ts[vi * 3 + k] = (pos[a1 * 3 + k] - pos[a0 * 3 + k]) / da;
        const c0 = Math.max(0, c - 1), c1 = Math.min(COLS, c + 1);
        const b0 = r * (COLS + 1) + c0, b1 = r * (COLS + 1) + c1;
        const dx = Math.max(1e-4, pos[b1 * 3] - pos[b0 * 3]);
        for (let k = 0; k < 3; k++) tx[vi * 3 + k] = (pos[b1 * 3 + k] - pos[b0 * 3 + k]) / dx;
        faceD[vi * 4] = dyf; faceD[vi * 4 + 1] = dsd; faceD[vi * 4 + 2] = rowSk[r]; faceD[vi * 4 + 3] = rowSd[r];
      }
    }
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
      const a0 = r * (COLS + 1) + c, b0 = a0 + 1, a1 = a0 + COLS + 1, b1 = a1 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aFace", new THREE.BufferAttribute(face, 4));
    geo.setAttribute("aFaceD", new THREE.BufferAttribute(faceD, 4));
    geo.setAttribute("aTx", new THREE.BufferAttribute(tx, 3));
    geo.setAttribute("aTs", new THREE.BufferAttribute(ts, 3));
    geo.setIndex(idx);
    geoms.push(geo);
    const wallMat = tsuWallMaterial(light);
    const wu = wallMat.uniforms;
    wu.uH.value = H;
    wu.uHalfW.value = W * 0.5;
    wu.uLumpS.value = Math.max(1.6, Math.min(3.2, H * 0.16));
    wu.uLP.value.set(rnd() * 6.283, rnd() * 6.283, rnd() * 6.283);
    mats.push(wallMat);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.renderOrder = 3;
    wall.frustumCulled = false;     // the vertex shader throws it well past its rest bounds
    grp.add(wall);

    const spray = tsuSprayBuild(W, H, (x) => hJit[colAt(x)], (x) => zJit[colAt(x)], rnd, light);
    spray.mat.uniforms.uFade = wu.uFade;         // ONE fade for wall and spray
    geoms.push(spray.geo); mats.push(spray.mat); grp.add(spray.points);

    return {
      group: grp, wall: wall, basePos: new Float32Array(pos),
      cols: COLS, rows: ROWS, baseH: H, width: W,
      // evidence: relative std-dev of crest height along the front (0 = a
      // ruler), and the end columns' height as a fraction of the mean
      crestVar: crestVar, endTaper: endTaper,
      spray: spray, light: light,
      drawCalls: 2, sprayCount: spray.count,
      foams: [spray.points], streaks: [],
      geoms: geoms, mats: mats,
    };
  };

  /* Per-frame: uniform writes only. The wall, the spray and the wake all
     animate on the GPU from the same clock and the same live height, so
     nothing can tear away from the lip it belongs to. */
  CBZ.tsuFaceUpdate = function (h, s) {
    if (!h || !h.wall) return false;
    s = s || {};
    const t = Number.isFinite(s.t) ? +s.t : 0;
    const H = Math.max(0.3, Number.isFinite(s.height) ? +s.height : h.baseH);
    const hs = H / Math.max(0.001, h.baseH);
    const turbid = Math.max(0, Math.min(1, Number.isFinite(s.turbid) ? +s.turbid : 0));
    const curl = Math.max(0, Math.min(1.6, Number.isFinite(s.curl) ? +s.curl : 0.5));
    const foamGain = Number.isFinite(s.foam) ? +s.foam : 0.7;

    if (Number.isFinite(s.x) && Number.isFinite(s.z)) h.group.position.set(s.x, +s.y || 0, s.z);
    if (Number.isFinite(s.dirX) && Number.isFinite(s.dirZ)) h.group.rotation.y = Math.atan2(s.dirX, s.dirZ);
    // where the sea is, in the face's own frame (the skirt and wake sit on it)
    let seaY = Number.isFinite(s.seaY) ? +s.seaY : NaN;
    if (!Number.isFinite(seaY)) {
      const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
      if (ev && Number.isFinite(ev.level)) seaY = ev.level;
    }
    const seaLocal = Number.isFinite(seaY) ? Math.max(-1, Math.min(H * 0.3, seaY - h.group.position.y)) : 0.5;

    const u = h.wall.material.uniforms;
    // s.fade 0..1: the crash hand-off (wall and spray together)
    u.uFade.value = Number.isFinite(s.fade) ? Math.max(0, Math.min(1, +s.fade)) : 1;
    u.uTime.value = t;
    u.uTurbid.value = turbid;
    u.uCurl.value = curl;
    u.uCurlN.value = Math.min(1, curl / 1.2);
    u.uH.value = H;
    u.uHs.value = hs;
    u.uFoam.value = foamGain;
    u.uSeaLocal.value = seaLocal;
    u.uSkirt.value = 0.75 + 0.45 * turbid;
    u.uLumpA.value = Math.max(0.25, Math.min(1.3, H * 0.032)) * (0.75 + 0.45 * turbid);
    u.uRollV.value = (2.4 + 2.6 * turbid + 1.2 * curl) * Math.sqrt(Math.max(0.2, hs));
    /* THE LIP TEARS HARDEST WHEN IT IS BROKEN: curl is smallest exactly then
       (the callers fold the overhang at the crash), so sediment drives the
       crest raggedness too. */
    u.uLobe.value.set(
      H * 0.013 * (0.35 + 0.80 * curl + 0.95 * turbid),
      (2.4 * curl + 3.2 * turbid) * hs,
      H * 0.013 * (0.25 + 1.05 * turbid + 0.35 * curl),
      (0.6 + 1.8 * turbid) * hs);
    u.uLobeFrom.value = 0.79 - 0.13 * turbid;

    // the scene's ACTUAL light, shared by all three materials
    const L = h.light, sun = CBZ.sun, hemi = CBZ.hemi;
    if (sun) {
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

    if (h.spray) {
      const su = h.spray.mat.uniforms;
      su.uTime.value = t; su.uHs.value = hs; su.uH.value = H;
      su.uCurl.value = curl; su.uTurbid.value = turbid;
      // a wave standing up hard, or one breaking through a town, tears the most
      const burst = Number.isFinite(s.spray) ? Math.max(0, +s.spray) : 1;
      su.uSpray.value = Math.min(2.0, (0.45 + 0.55 * curl + 0.55 * turbid) * (0.6 + 0.5 * foamGain) * burst);
      su.uWind.value = 4.5 + 3.5 * Math.sqrt(Math.max(0.2, hs));
      su.uSeaLocal.value = seaLocal;
      const r = CBZ.renderer;
      const ph = r && r.domElement ? r.domElement.height : 900;
      su.uScale.value = ph * 0.5;
    }
    return true;
  };

  CBZ.tsuFaceDispose = function (h) {
    if (!h) return false;
    if (h.group && h.group.parent) h.group.parent.remove(h.group);
    for (let i = 0; i < (h.geoms || []).length; i++) h.geoms[i].dispose();
    for (let i = 0; i < (h.mats || []).length; i++) if (h.mats[i].dispose) h.mats[i].dispose();
    h.group = null; h.wall = null; h.spray = null; h.geoms = []; h.mats = [];
    return true;
  };

  // One arena-scoped physical descriptor. Directors publish phase/front/level;
  // swimmers, debris and tests sample it. A curling bore may still have a
  // presentation mesh because it is not a single-valued height field, but it
  // owns no second collision or wetness truth.
  let waterEvent = null;
  CBZ.waterEventSet = function (spec) {
    if (!spec) { waterEvent = null; return null; }
    if (!waterEvent || (spec.owner && waterEvent.owner !== spec.owner)) waterEvent = {};
    for (const k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) waterEvent[k] = spec[k];
    return waterEvent;
  };
  CBZ.waterEventGet = function () { return waterEvent; };
  CBZ.waterEventClear = function (owner) {
    if (!waterEvent || (owner && waterEvent.owner !== owner)) return false;
    waterEvent = null; return true;
  };
  /* THE CPU TWIN OF uDwAhead: metres the water at (x,z) sits BELOW the
     published mean because the tsunami front has not reached it yet. Every
     survival water query subtracts this, so the swimmer, the drowning test,
     the debris and the bots all agree with the sheet that is drawn. */
  // the island's shadow at (x, z) for a published lee record (cbzLeeShadow)
  function leeShadow(e, L, x, z) {
    const dx = +e.dx || 0, dz = +e.dz || 0, rx = x - (+e.cx || 0), rz = z - (+e.cz || 0);
    const s = rx * dx + rz * dz;
    const rl = (-rx * dz + rz * dx) - (+L.lc || 0), rs = s - (+L.sMid || 0);
    let c = 0.5 - 0.5 * rs / Math.max(Math.hypot(rl, rs), 1);
    c = c < 0 ? 0 : c > 1 ? 1 : c;
    const ex = Math.pow(c, LEE_EXP);
    const lw = Math.max(1, +L.lw || 1), D = Math.max(1, +L.d0 || 20) + LEE_SPREAD * Math.max(0, s - (+L.sMax || 0));
    let t = (Math.abs(rl) - lw) / D; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return (1 - ex) * (1 - t * t * (3 - 2 * t));
  }
  CBZ.waterLeeShadow = function (x, z) {
    const e = waterEvent;
    return e && e.lee && e.lee.on ? leeShadow(e, e.lee, x, z) : 0;
  };
  function frontFormulaDrop(x, z) {
    const e = waterEvent;
    const L = e && e.lee && e.lee.on ? e.lee : null;
    if (!e || (!(e.aheadDrop > 0.001) && !L)) return 0;
    const fd = (x - (+e.cx || 0)) * (+e.dx || 0) + (z - (+e.cz || 0)) * (+e.dz || 0) - (Number.isFinite(e.frontS) ? +e.frontS : -1e9);
    let k = (fd + 1) / 8; k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    let d = Math.max(0, +e.aheadDrop || 0) * k;
    if (L) d += leeShadow(e, L, x, z) * ((+L.b || 0) + ((+L.a || 0) - (+L.b || 0)) * k);
    return d;
  }
  /* THE STRAIGHT FRONT, alone: what the SEA does (the drawn-back water ahead
     of the bore, the raised water behind it). The run-up field forces its
     open-sea cells to exactly this, so the sheet is continuous across the
     field's edge. */
  CBZ.waterFrontFormulaDrop = frontFormulaDrop;
  /* ...AND ON THE LAND, THE RUN-UP FIELD (world/tsunami_runup.js). While a
     field is attached its surface IS the water inside its domain: the drop
     is whatever puts the published mean onto the field's surface (a dry cell
     sits 0.6 m under its own bed, so every depth query reads it as dry).
     Its edge fades to the formula over a cell and a half. */
  const _runS = {};
  function runupField() { return CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null; }
  function runupMean() {
    return CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : seaY();
  }
  CBZ.waterFrontDropAt = function (x, z) {
    const base = frontFormulaDrop(x, z);
    const F = runupField();
    if (!F) return base;
    const r = F.sample(x, z, _runS);
    if (!(r.in > 0)) return base;
    const d = runupMean() - r.eta;
    return r.in >= 1 ? d : base + (d - base) * r.in;
  };
  CBZ.waterEventSample = function (x, z, t, out) {
    out = out || {};
    const e = waterEvent;
    if (!e) { out.active = false; out.wet = false; return out; }
    const dx = Number.isFinite(e.dx) ? e.dx : 0, dz = Number.isFinite(e.dz) ? e.dz : 0;
    const s = (x - (+e.cx || 0)) * dx + (z - (+e.cz || 0)) * dz;
    const fd = s - (Number.isFinite(e.frontS) ? e.frontS : 1e9);
    const phase = e.phase || "";
    const wet = phase === "flooded" || phase === "drain" || (phase === "sweep" && fd <= (Number.isFinite(e.frontWet) ? e.frontWet : -2));
    const mean = Number.isFinite(e.level) ? e.level : 0;
    const amp = Number.isFinite(e.waveAmp) ? e.waveAmp : 1;
    const chop = Number.isFinite(e.chopAmp) ? e.chopAmp : amp;
    out.active = true; out.owner = e.owner || ""; out.kind = e.kind || ""; out.phase = phase;
    const drop = CBZ.waterFrontDropAt(x, z);
    out.wet = wet; out.frontDistance = fd; out.mean = mean - drop;
    out.height = CBZ.waterDisasterSurfaceY(x, z, mean - drop, amp, chop, t);
    let flow = wet && Number.isFinite(e.flow) ? e.flow : 0;
    /* THE RIVER BEHIND A BORE IS FASTEST RIGHT BEHIND IT. A tsunami front
       drags the water in its first few tens of metres at close to its own
       speed; further back the flood slows to a deep, heavy current. So the
       published flow is the flood's, and the last 45 m behind a live front
       run up to 2.2x it: caught near the wall you are going where it goes. */
    if (phase === "sweep" && e.kind === "tsunami" && fd < 0) flow *= 1 + 1.2 * Math.max(0, 1 + fd / 45);
    out.currentX = dx * flow; out.currentZ = dz * flow;
    /* ON THE LAND THE CURRENT IS THE FIELD'S: down the street it is running
       down, round the building it is splitting on, back to sea on the
       backwash — never one heading for the whole island. */
    const F = runupField();
    if (F) {
      const r = F.sample(x, z, _runS);
      if (r.in > 0) {
        // on the forced open sea the current stays the director's
        const k = r.in * (1 - r.forced);
        out.wet = r.in >= 1 ? r.depth > 0.05 : (r.depth > 0.05 || out.wet);
        out.currentX = out.currentX * (1 - k) + r.u * k;
        out.currentZ = out.currentZ * (1 - k) + r.v * k;
        out.runup = true; out.depth = r.depth; out.speed = r.speed;
        flow = Math.hypot(out.currentX, out.currentZ) * (r.u * dx + r.v * dz < 0 ? -1 : 1);
      }
    }
    out.foam = phase === "sweep" ? Math.max(0, 1 - Math.abs(fd) / Math.max(1, +e.frontWidth || 18)) : 0;
    /* THE SEDIMENT LOAD AND THE UNDERTOW, on the same descriptor, because they
       are the same water. `sediment` is the bore's own load (the wall's
       colour, the white water's dirt) and the honest "is this a debris soup"
       test for anything entrained in it; the SEA's colour is the silt field's
       (world/tsunami_silt.js), placed where the scour was. `undertow` is the flow being NEGATIVE — the drain dragging seaward —
       which is the half of a tsunami that actually drowns people, and it is a
       sign, not a second field. */
    out.sediment = out.wet && Number.isFinite(e.sediment) ? e.sediment : 0;
    out.undertow = flow < 0 ? -flow : 0;
    return out;
  };

  // The event's current at (x,z), the part of waterEventSample a hull needs
  // every probe (no height evaluation): the director's flow behind the front,
  // the run-up field's own velocity where it holds the water.
  function eventCurrent(x, z, out) {
    out.x = 0; out.z = 0;
    const e = waterEvent;
    if (!e) return out;
    const dx = Number.isFinite(e.dx) ? e.dx : 0, dz = Number.isFinite(e.dz) ? e.dz : 0;
    const fd = (x - (+e.cx || 0)) * dx + (z - (+e.cz || 0)) * dz - (Number.isFinite(e.frontS) ? e.frontS : 1e9);
    const phase = e.phase || "";
    const wet = phase === "flooded" || phase === "drain" || (phase === "sweep" && fd <= (Number.isFinite(e.frontWet) ? e.frontWet : -2));
    let flow = wet && Number.isFinite(e.flow) ? e.flow : 0;
    if (phase === "sweep" && e.kind === "tsunami" && fd < 0) flow *= 1 + 1.2 * Math.max(0, 1 + fd / 45);
    out.x = dx * flow; out.z = dz * flow;
    const F = runupField();
    if (F) {
      const r = F.sample(x, z, _runS);
      if (r.in > 0) {
        const k = r.in * (1 - r.forced);
        out.x = out.x * (1 - k) + r.u * k;
        out.z = out.z * (1 - k) + r.v * k;
      }
    }
    return out;
  }

  /* ============================================================
     THE ONE DOOR: CBZ.waterSurfaceAt(x, z, out)
     ============================================================
     Everything a hull, a swimmer or a piece of debris needs from the water
     at one point, from the same sources the shaders draw:
       y      the surface (swell, entry rings, the tsunami's drawdown and
              front, the run-up field on the land, the city's rain ponds)
       depth  the water column under it (0 where dry)
       vx,vz  the water's own velocity: the event current / run-up field,
              river channels, standing floodwater running off
       wet    1 where there is water
     Island modes (survival, the isles, shark sim) read the island's sea
     (CBZ.survSeaHeightAt: arena mean + front drop + arena-field shoaling +
     the run-up field) and its ground; the city reads citySeaHeightAt and its
     bathymetry; a page with an adopted sea reads that sheet's level. */
  const _cur = { x: 0, z: 0 }, _gwf = { x: 0, z: 0, speed: 0 };
  let pageSeaY = null;
  CBZ.waterPageSeaY = function (y) { if (Number.isFinite(+y)) pageSeaY = +y; return pageSeaY; };
  CBZ.waterSurfaceAt = function (x, z, out) {
    out = out || {};
    const g = CBZ.game;
    let y, depth = 0, vx = 0, vz = 0;
    if (g && CBZ.islandModeOn && CBZ.islandModeOn(g.mode) && CBZ.survSeaHeightAt) {
      y = CBZ.survSeaHeightAt(x, z);
      const bed = CBZ.survSeaBedYAt ? CBZ.survSeaBedYAt(x, z) : y - 30;
      depth = Math.max(0, y - bed);
      eventCurrent(x, z, _cur);
      vx = _cur.x; vz = _cur.z;
    } else if (CBZ.citySeaHeightAt && pageSeaY == null) {
      y = CBZ.citySeaHeightAt(x, z);
      const bedD = CBZ.citySeaBedDepth ? +CBZ.citySeaBedDepth(x, z) || 0 : 0;
      if (bedD > 0) depth = Math.max(0, bedD + (y - seaY()));
      const fl = CBZ.cityFloodDepthAt ? +CBZ.cityFloodDepthAt(x, z) || 0 : 0;
      if (fl > depth) depth = fl;
      const rv = CBZ.waterFlowAt(x, z, _flowQ);
      vx = rv.x; vz = rv.z;
      if (fl > 0 && CBZ.groundWaterFlowAt) {
        const w = CBZ.groundWaterFlowAt(x, z, _gwf);
        vx += w.x; vz += w.z;
      }
      if (waterEvent) { eventCurrent(x, z, _cur); vx += _cur.x; vz += _cur.z; }
    } else if (pageSeaY != null) {
      y = pageSeaY; depth = 30;
    } else {
      y = CBZ.waterWaveHeight(x, z);
      depth = 30;
    }
    out.y = y; out.depth = depth; out.vx = vx; out.vz = vz;
    out.wet = depth > 0.02 ? 1 : 0;
    return out;
  };

  /* ============================================================
     10. CAUSTICS ON THE FLOOR, POOLS, AND THE SEAS NOBODY ELSE DRIVES
     ============================================================ */

  /* ---- SEABED CAUSTICS ---------------------------------------------------
     The web of focused sunlight on a shallow sandy bottom. Applied to the
     FLOOR's own material (a patched clone, chained onto any hook it already
     has, exactly like the veil above), so it is right from above — seen
     through the translucent sea — and from below, with no extra geometry.
     Only fragments below the live sea level get it, it dims and blurs with
     the depth of water the light has crossed (gone by ~20 m), and it follows
     the sun. Uses the same tile, scale and drift as the shallow-water glints
     in cbzShadeSea, so the two line up. */
  const CAU_U = {
    uCauSeaY: { value: -0.48 },
    uCauTime: { value: 0 },
    uCauSun: { value: new THREE.Vector4(1, 1, 1, 0) },   // rgb sun * gain, w = on
    uCauTex: { value: null },
  };
  CBZ.waterCausticUniforms = CAU_U;
  const _cauCache = new WeakMap();
  function cauBefore(shader) {
    if (shader.vertexShader.indexOf("#include <project_vertex>") < 0) return;
    if (shader.vertexShader.indexOf("#include <common>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <tonemapping_fragment>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <common>") < 0) return;
    if (!CAU_U.uCauTex.value) CAU_U.uCauTex.value = CBZ.waterCausticTexture();
    shader.uniforms.uCauSeaY = CAU_U.uCauSeaY;
    shader.uniforms.uCauTime = CAU_U.uCauTime;
    shader.uniforms.uCauSun = CAU_U.uCauSun;
    shader.uniforms.uCauTex = CAU_U.uCauTex;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCbzCauW;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n" +
        "vec4 cbzCauP = vec4( transformed, 1.0 );\n" +
        "#ifdef USE_INSTANCING\n  cbzCauP = instanceMatrix * cbzCauP;\n#endif\n" +
        "vCbzCauW = ( modelMatrix * cbzCauP ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vCbzCauW;\nuniform float uCauSeaY;\nuniform float uCauTime;\nuniform vec4 uCauSun;\nuniform sampler2D uCauTex;")
      .replace("#include <tonemapping_fragment>",
        "if ( uCauSun.w > 0.0 && vCbzCauW.y < uCauSeaY ) {\n" +
        "  float cbzCd = uCauSeaY - vCbzCauW.y;\n" +
        "  vec2 cbzCp = vCbzCauW.xz;\n" +
        "  vec2 cbzCa = cbzCp * 0.21 + vec2( uCauTime * 0.031, uCauTime * 0.017 );\n" +
        "  vec2 cbzCb = vec2( cbzCp.y, -cbzCp.x ) * 0.17 + vec2( -uCauTime * 0.023, uCauTime * 0.029 );\n" +
        "  float cbzCc = min( texture2D( uCauTex, cbzCa ).r, texture2D( uCauTex, cbzCb ).r );\n" +
        // light that has crossed cd metres of water no longer focuses: the
        // web dims, and right at the waterline there is no lens yet
        "  float cbzCk = exp( -cbzCd * 0.15 ) * smoothstep( 0.05, 0.7, cbzCd );\n" +
        "  gl_FragColor.rgb += gl_FragColor.rgb * uCauSun.rgb * ( cbzCc * cbzCc * 1.6 * cbzCk * uCauSun.w );\n" +
        "}\n#include <tonemapping_fragment>");
  }
  CBZ.waterCausticMaterial = function (mat) {
    if (!mat || CFG.WATER_CAUSTICS === false) return mat;
    if (mat.userData && mat.userData.cbzCaustic) return mat;
    const hit = _cauCache.get(mat);
    if (hit) return hit;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return mat;
    let clone;
    try { clone = mat.clone(); } catch (e) { return mat; }
    const prev = mat.onBeforeCompile;
    const prevSrc = (prev && prev !== THREE.Material.prototype.onBeforeCompile) ? String(prev) : "";
    clone.onBeforeCompile = prev ? function (sh) { prev.call(this, sh); cauBefore(sh); } : cauBefore;
    clone.customProgramCacheKey = function () { return "cbzCaustic|" + prevSrc; };
    clone.userData = Object.assign({}, clone.userData, { cbzCaustic: true });
    clone.needsUpdate = true;
    _cauCache.set(mat, clone);
    _cauCache.set(clone, clone);
    return clone;
  };
  CBZ.waterCausticsApply = function (obj) {
    if (!obj || CFG.WATER_CAUSTICS === false) return false;
    let n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const y = CBZ.waterCausticMaterial(o.material);
      if (y !== o.material) { o.material = y; n++; }
    });
    return n > 0;
  };
  // driven from waterDriveCommonUniforms (one sea is always driven)
  function causticDrive(u) {
    CAU_U.uCauTime.value = u && u.uSeaTime ? u.uSeaTime.value : CBZ.waterClock();
    let y = u && u.uCauSeaY ? u.uCauSeaY.value : seaY();
    if (CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.survSeaMeanY) {
      const iy = CBZ.survSeaMeanY();
      if (Number.isFinite(iy)) y = iy;
    }
    CAU_U.uCauSeaY.value = y;
    const s = u && u.uSunColor ? u.uSunColor.value : null;
    const L = u && u.uSunDir ? u.uSunDir.value : null;
    const up = L ? Math.max(0, Math.min(1, (L.y + 0.05) / 0.35)) : 1;
    const day = Math.max(0, Math.min(1, CBZ.dayness == null ? 1 : +CBZ.dayness));
    const g = 0.85 * up * (0.25 + 0.75 * day);
    if (s) CAU_U.uCauSun.value.set(s.r * g, s.g * g, s.b * g, CFG.WATER_CAUSTICS === false ? 0 : 1);
  }

  /* ---- POOL WATER ---------------------------------------------------------
     Swimming pools, spas and fountain basins were opaque turquoise Lambert
     slabs. Real pool water is a still, clear surface: the sky and the sun on
     top (the same reflected dome every sea uses), a faint wind ripple, and
     THROUGH it the bright tiled floor with the sunlight caustic web dancing
     across it — that web is what makes a pool read as a pool from any
     distance. The floor is drawn here (the water slab is opaque, the basin is
     under it), at uPoolDepth below the surface, so no extra mesh is needed.
     One shared material; world XZ drives the pattern, so it survives
     batch.js merging. */
  let poolMat = null;
  CBZ.waterPoolMaterial = function () {
    if (poolMat) return poolMat;
    const U = CBZ.waterCommonUniforms();
    U.uPoolDepth = { value: 1.6 };
    U.uPoolTile = { value: new THREE.Color(0x8fd8e6) };
    U.uPoolLine = { value: new THREE.Color(0x2c6f8a) };
    // still water: only the capillary rows, at a sheltered tenth of the wind
    U.uSeaMul.value.set(0, 0.12, 0, 1.4);
    const vs = [
      "varying vec3 vPW;",
      "varying vec3 vPN;",
      "varying vec4 vSeaP;",
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vec4 lp = vec4(position, 1.0);",
      "  vec4 ln = vec4(normal, 0.0);",
      "  #ifdef USE_INSTANCING",
      "    lp = instanceMatrix * lp; ln = instanceMatrix * ln;",
      "  #endif",
      "  vec4 wp = modelMatrix * lp;",
      "  vPW = wp.xyz;",
      "  vPN = normalize((modelMatrix * ln).xyz);",
      "  vSeaP = vec4(wp.xz, 1.0, 0.0);",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");
    const fs = [
      CBZ.waterFragmentDecl(),
      "uniform float uPoolDepth;",
      "uniform vec3 uPoolTile;",
      "uniform vec3 uPoolLine;",
      "uniform sampler2D uCaustic;",
      "varying vec3 vPW;",
      "varying vec3 vPN;",
      "#include <fog_pars_fragment>",
      "void main() {",
      "  vec3 V = normalize(cameraPosition - vPW);",
      "  vec2 p = vPW.xz;",
      "  float fp = max(max(length(dFdx(p)), length(dFdy(p))), 0.002);",
      "  vec2 st;",
      "  vec4 ws = cbzWaveSurf(p, uSeaTime, uSeaMul.xy, 30.0, 1.0, fp, st);",
      "  vec3 dtl = cbzDetail(p, uSeaTime, fp, normalize(uWindDir), 0.12);",
      "  vec3 N = normalize(vec3(-(ws.x + dtl.x), 1.0, -(ws.y + dtl.y)));",
      "  vec3 E = uKeyRad * max(uKeyDir.y, 0.0) + uSkyAmb;",
      // the basin's side band is the tank wall
      "  if (vPN.y < 0.5) {",
      "    gl_FragColor = vec4(uPoolLine * E * 0.4, 1.0);",
      "  } else {",
      // the tiled floor seen through the surface (Snell shift by the depth)
      "    vec3 rt = refract(-V, N, 0.75);",
      "    vec2 fpp = p + rt.xz / max(0.2, -rt.y) * uPoolDepth;",
      "    vec2 tg = abs(fract(fpp / 0.25) - 0.5);",
      "    vec3 floorC = mix(uPoolTile, uPoolLine, smoothstep(0.47, 0.5, max(tg.x, tg.y)) * 0.35);",
      "    vec2 ca = fpp * 0.34 + vec2(uSeaTime * 0.04, uSeaTime * 0.022);",
      "    vec2 cb = vec2(fpp.y, -fpp.x) * 0.27 + vec2(-uSeaTime * 0.03, uSeaTime * 0.037);",
      "    float cau = min(texture(uCaustic, ca).r, texture(uCaustic, cb).r);",
      "    vec3 bed = floorC * (E + uKeyRad * max(uKeyDir.y, 0.0) * cau * cau * 1.6);",
      "    vec4 sh = cbzWaterShade(vPW, vPW.xz, N, V, uWaveRough.x * 0.02, uPoolDepth, 0.0, 0.0, 0.0, 1.0, fp, uSeaTime);",
      // the shade expects the floor behind it: composite it here, per channel
      "    float cosT = sqrt(max(0.0, 1.0 - (1.0 - dot(N, V) * dot(N, V)) / 1.7769));",
      "    vec3 Tr = exp(-(vec3(0.45, 0.09, 0.06) + 0.04) * uPoolDepth * (1.0 + 1.0 / max(cosT, 0.2)));",
      "    vec3 c = sh.rgb * sh.a + bed * (1.0 - sh.a) * (Tr / max(Tr.g, 0.001));",
      "    gl_FragColor = vec4(c, 1.0);",
      "  }",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");
    poolMat = new THREE.ShaderMaterial({
      name: "CBZ Pool Water", uniforms: U, vertexShader: vs, fragmentShader: fs, fog: true,
    });
    poolMat.userData.waterUniforms = U;
    poolMat.userData.selfDrive = true;
    poolMat.userData.waterMode = "water-v4-pool";
    poolMat._shared = true;
    selfDriven.push(poolMat);
    return poolMat;
  };

  /* ---- THE SEAS NOBODY ELSE DRIVES ---------------------------------------
     The city sea is driven by city/world.js's day/night tick and the island
     sea by disaster_arena.js. Anything else built from this family (pools,
     a page's adopted sea) is driven here, once a frame, even while paused —
     a frozen pool next to a moving sea is the first thing an eye notices. */
  const selfDriven = [];
  CBZ.waterSelfDrive = function (mat) {
    if (mat && mat.userData && mat.userData.waterUniforms && selfDriven.indexOf(mat) < 0) selfDriven.push(mat);
    return mat;
  };
  function driveSelf() {
    for (let i = 0; i < selfDriven.length; i++) {
      const m = selfDriven[i];
      if (m && m.userData && m.userData.waterUniforms) CBZ.waterDriveCommonUniforms(m.userData.waterUniforms);
    }
  }
  if (CBZ.onAlways) CBZ.onAlways(93.6, driveSelf);
  else if (CBZ.onUpdate) CBZ.onUpdate(93.6, driveSelf);
  else {
    // a page that registers its loop after this file (microboot pages):
    // retry the hook on the next few animation frames
    let tries = 0;
    const hook = function () {
      if (CBZ.onAlways) { CBZ.onAlways(93.6, driveSelf); return; }
      if (CBZ.onUpdate) { CBZ.onUpdate(93.6, driveSelf); return; }
      if (++tries < 600 && typeof requestAnimationFrame === "function") requestAnimationFrame(hook);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(hook);
  }

  CBZ.waterSpecReady = true;
})();
