/* ============================================================
   world/tsunami_silt.js — WHERE THE WATER IS BROWN, AND WHY.

   The tsunami's mud used to be ONE NUMBER (uDwSediment) laid over the whole
   sea on the wave's side of a ruled line, so from the air the ocean went
   brown-black to the horizon with a hard edge against the turquoise lee. A
   tsunami does not do that. Offshore it is clean sea lifted into a swell with
   a white line on it. The water turns brown where it has SCOURED something:
   on the land it ran over, in the shallows it tore up, and in the plumes the
   backwash pours out to sea from where the land drained, which drift with the
   current, spread, and fade back into sea colour over minutes.

   So the sediment is a FIELD, physically placed:

     SOURCE   every cell of the run-up grid (world/tsunami_runup.js) that has
              water standing on LAND loads the silt cell over it toward a full
              suspension, faster where the flow is fast; the shelf the bore is
              surging over picks up a lighter load. The flow there becomes the
              cell's carried current.
     CARRY    semi-Lagrangian advection of the load AND of its own current, so
              a backwash jet keeps going out to sea after it leaves the land and
              slows over ~25 s; a weak spreading drift away from the island.
     SPREAD   eddy diffusion (6 m^2/s at this scale); the current itself
              spreads to the still sea ahead of it, so a jet leaves the coast.
     FADE     settling: ~5 minutes on the sea, seconds on drained ground.

   One low-res RGBA8 texture (R = load) over the sea around the island, linear
   filtered, uploaded at the field's 5 Hz tick: world/water_spec.js samples it
   as the sea's turbidity mask. CBZ.waterTurbidAt(x, z) is the CPU twin every
   consumer reads (the underwater medium, the swimmer's torrent): the field,
   plus the run-up's own land water, plus a flash flood's water, plus the
   current at that point.

   COST: 80 x 80 cells, 5 Hz: one pass over the run-up grid to seed, two
   bilinear advections, one diffusion. ~0.3 ms a tick on a phone, nothing
   allocated per tick, and the whole thing sleeps once the sea is clean.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;

  const N = 80;                 // cells per side
  const TICK = 0.2;             // s
  const MARGIN_MIN = 260;       // m of sea around the run-up domain
  const D_EDDY = 6;             // m^2/s: a plume ~80 m wide after ten minutes
  const K_JET = 0.35;           // per tick: how fast a current spreads to the still sea beside it
  const TAU_SEA = 300;          // s: a plume settles over five minutes
  const TAU_DRY = 6;            // s: drained ground holds no water to be brown
  const TAU_VEL = 25;           // s: a backwash jet slows offshore
  const SPREAD = 0.22;          // m/s: the plume's own slow spread off the island
  const LAND_LOAD = 0.95;       // a full suspension
  const SHELF_LOAD = 0.55;      // the shallows the bore tore up
  const SHELF_DEPTH = 7;        // m of rest water the bore scours

  const NN = N * N;
  const c = new Float32Array(NN), c2 = new Float32Array(NN);
  const vu = new Float32Array(NN), vv = new Float32Array(NN);
  const vu2 = new Float32Array(NN), vv2 = new Float32Array(NN);
  const wLand = new Float32Array(NN), wShelf = new Float32Array(NN);
  const su = new Float32Array(NN), sv = new Float32Array(NN);
  const dry = new Uint8Array(NN);
  const rx = new Float32Array(NN), rz = new Float32Array(NN);   // the spreading drift, per cell (m/s)
  let x0 = 0, z0 = 0, size = 1, cell = 1, cx = 0, cz = 0, key = "";
  let live = false, acc = 0, maxC = 0, ticks = 0, msLast = 0;
  let tex = null, texData = null, texDirty = false;

  function clear() {
    c.fill(0); vu.fill(0); vv.fill(0); dry.fill(0);
    maxC = 0; live = false; texDirty = true;
  }
  function domainFor(F) {
    const k = F.x0 + "|" + F.z0 + "|" + F.size;
    if (k === key) return;
    key = k;
    const half = F.size * 0.5 + Math.max(MARGIN_MIN, F.size * 0.6);
    cx = F.x0 + F.size * 0.5; cz = F.z0 + F.size * 0.5;
    x0 = cx - half; z0 = cz - half; size = 2 * half; cell = size / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = (i + 0.5) * cell - half, wz = (j + 0.5) * cell - half;
      const r = Math.sqrt(wx * wx + wz * wz) || 1;
      rx[j * N + i] = SPREAD * wx / r; rz[j * N + i] = SPREAD * wz / r;
    }
    clear();
  }

  // bilinear read of `a` at fractional cell coords (centres at i + 0.5)
  function bil(a, fx, fz) {
    fx -= 0.5; fz -= 0.5;
    if (fx < 0) fx = 0; else if (fx > N - 1.001) fx = N - 1.001;
    if (fz < 0) fz = 0; else if (fz > N - 1.001) fz = N - 1.001;
    const i = fx | 0, j = fz | 0, ax = fx - i, az = fz - j, k = j * N + i;
    return (a[k] * (1 - ax) + a[k + 1] * ax) * (1 - az) + (a[k + N] * (1 - ax) + a[k + N + 1] * ax) * az;
  }

  /* ---- SOURCE: the run-up grid, cell by cell --------------------------- */
  let colOf = null;           // run-up column -> silt column (the run-up domain sits inside ours)
  function seed(F) {
    wLand.fill(0); wShelf.fill(0); su.fill(0); sv.fill(0); dry.fill(0);
    const n = F.n, dx = F.cell, h = F.h, zb = F.zb, u = F.u, v = F.v, forced = F.forced, rest = F.restY;
    const inv = 1 / cell, shelf = rest - SHELF_DEPTH, lift = rest + 0.6;
    if (!colOf || colOf.length !== n) colOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const si = Math.floor((F.x0 + (i + 0.5) * dx - x0) * inv);
      colOf[i] = si < 0 ? 0 : si >= N ? N - 1 : si;
    }
    for (let j = 0; j < n; j++) {
      let sj = Math.floor((F.z0 + (j + 0.5) * dx - z0) * inv);
      sj = sj < 0 ? 0 : sj >= N ? N - 1 : sj;
      const row = sj * N, kr = j * n;
      for (let i = 0; i < n; i++) {
        const k = kr + i, s = row + colOf[i], hk = h[k];
        if (forced[k] === 0) {
          if (hk > 0.05) { wLand[s] += 1; su[s] += u[k]; sv[s] += v[k]; }
          else if (zb[k] > rest) dry[s] = 1;
        } else if (zb[k] > shelf && zb[k] + hk > lift) wShelf[s] += 1;
      }
    }
    // run-up cells per silt cell
    return (cell / dx) * (cell / dx);
  }

  function step(dt) {
    const T0 = typeof performance !== "undefined" ? performance.now() : 0;
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    if (F) domainFor(F);
    if (!F && !live) return;
    // no field: nothing is on the land any more, the sea carries what it has
    if (!F) { wLand.fill(0); wShelf.fill(0); }
    const per = F ? seed(F) : 1;
    // ---- source + the land's current becomes the cell's current
    for (let s = 0; s < NN; s++) {
      if (F && wLand[s] > 0) {
        const f = Math.min(1, wLand[s] / per);
        const mu = su[s] / wLand[s], mv = sv[s] / wLand[s];
        const sp = Math.sqrt(mu * mu + mv * mv);
        c[s] += (LAND_LOAD - c[s]) * Math.min(1, f * (0.5 + 0.35 * sp) * dt);
        const b = Math.min(1, f * 3 * dt);
        vu[s] += (mu - vu[s]) * b; vv[s] += (mv - vv[s]) * b;
      }
      if (F && wShelf[s] > 0) {
        const f = Math.min(1, wShelf[s] / per);
        if (c[s] < SHELF_LOAD) c[s] += (SHELF_LOAD - c[s]) * Math.min(1, f * 0.25 * dt);
      }
    }
    // ---- carry: the load and its current, back-traced along the current
    //      (one set of bilinear weights for all three fields)
    const kv = Math.exp(-dt / TAU_VEL), inv = 1 / cell, lim = N - 1.001;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const s = j * N + i;
        const sea = wLand[s] > 0 ? 0 : 1;
        let fx = i - (vu[s] + sea * rx[s]) * dt * inv, fz = j - (vv[s] + sea * rz[s]) * dt * inv;
        fx = fx < 0 ? 0 : fx > lim ? lim : fx;
        fz = fz < 0 ? 0 : fz > lim ? lim : fz;
        const i0 = fx | 0, j0 = fz | 0, ax = fx - i0, az = fz - j0, k = j0 * N + i0;
        const w00 = (1 - ax) * (1 - az), w10 = ax * (1 - az), w01 = (1 - ax) * az, w11 = ax * az;
        c2[s] = c[k] * w00 + c[k + 1] * w10 + c[k + N] * w01 + c[k + N + 1] * w11;
        vu2[s] = (vu[k] * w00 + vu[k + 1] * w10 + vu[k + N] * w01 + vu[k + N + 1] * w11) * kv;
        vv2[s] = (vv[k] * w00 + vv[k + 1] * w10 + vv[k + N] * w01 + vv[k + N + 1] * w11) * kv;
      }
    }
    /* ---- spread + fade. The load diffuses (eddies); the CURRENT spreads
       much faster, weighted by the load it carries, which is what lets a
       backwash jet leave the coast at all (a still sea cell back-traces onto
       itself and would never learn the jet is coming) and fan out as it goes. */
    const kd = Math.min(0.2, D_EDDY * dt / (cell * cell));
    const fSea = Math.exp(-dt / TAU_SEA), fDry = Math.exp(-dt / TAU_DRY);
    let mx = 0;
    for (let j = 0; j < N; j++) {
      const jm = j > 0 ? -N : 0, jp = j < N - 1 ? N : 0;
      for (let i = 0; i < N; i++) {
        const s = j * N + i;
        const im = i > 0 ? -1 : 0, ip = i < N - 1 ? 1 : 0;
        const a = s + im, b = s + ip, cc = s + jm, d = s + jp;
        const lap = c2[a] + c2[b] + c2[cc] + c2[d] - 4 * c2[s];
        let v = c2[s] + kd * lap;
        v *= (dry[s] && wLand[s] === 0) ? fDry : (wLand[s] > 0 ? 1 : fSea);
        // the open edge of the domain is clean sea
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) v = 0;
        v = v < 1e-4 ? 0 : v > 1 ? 1 : v;
        c[s] = v;
        if (wLand[s] > 0) { vu[s] = vu2[s]; vv[s] = vv2[s]; }
        else {
          const wa = c2[a] + 0.02, wb = c2[b] + 0.02, wc = c2[cc] + 0.02, wd = c2[d] + 0.02, wt = wa + wb + wc + wd;
          const nu = (vu2[a] * wa + vu2[b] * wb + vu2[cc] * wc + vu2[d] * wd) / wt;
          const nv = (vv2[a] * wa + vv2[b] * wb + vv2[cc] * wc + vv2[d] * wd) / wt;
          // only a faster neighbour drags: momentum spreads, it is not averaged away
          const kj = (nu * nu + nv * nv > vu2[s] * vu2[s] + vv2[s] * vv2[s]) ? K_JET : K_JET * 0.3;
          vu[s] = vu2[s] + (nu - vu2[s]) * kj; vv[s] = vv2[s] + (nv - vv2[s]) * kj;
        }
        if (v > mx) mx = v;
      }
    }
    maxC = mx;
    live = mx > 0.004 || !!F;
    if (!live) clear();
    texDirty = true;
    ticks++;
    if (T0) msLast = performance.now() - T0;
  }

  if (CBZ.onUpdate) CBZ.onUpdate(28.4, function (dt) {
    acc += Math.max(0, Math.min(0.1, dt || 0));
    if (acc < TICK) return;
    step(acc); acc = 0;
  });

  /* ---- THE GPU COPY: R = load. Linear filtered: the plume is soft by nature,
     and the sea shader breaks its edge with its own noise. */
  function texture() {
    const THREE = typeof window !== "undefined" ? window.THREE : null;
    if (!THREE) return null;
    if (!tex) {
      texData = new Uint8Array(NN * 4);
      tex = new THREE.DataTexture(texData, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false; tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.name = "tsunami-silt";
      texDirty = true;
    }
    if (texDirty) {
      for (let s = 0; s < NN; s++) {
        const o = s * 4;
        texData[o] = Math.round(c[s] * 255);
        texData[o + 1] = 0; texData[o + 2] = 0; texData[o + 3] = 255;
      }
      tex.needsUpdate = true;
      texDirty = false;
    }
    return tex;
  }

  function at(x, z) {
    if (!live) return 0;
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > N || fz > N) return 0;
    return bil(c, fx, fz);
  }

  CBZ.tsuSilt = {
    get live() { return live; },
    get max() { return maxC; },
    // x0, z0, size (m) of the texture's square, for the shader
    bounds: function (out) { out = out || {}; out.x0 = x0; out.z0 = z0; out.size = size; return out; },
    texture: texture,
    at: at,
    flowAt: function (x, z, out) {
      out = out || {};
      const fx = (x - x0) / cell, fz = (z - z0) / cell;
      if (!live || fx < 0 || fz < 0 || fx > N || fz > N) { out.x = 0; out.z = 0; return out; }
      out.x = bil(vu, fx, fz); out.z = bil(vv, fx, fz);
      return out;
    },
    step: step,
    reset: function () { key = ""; clear(); },
    audit: function () {
      let area = 0;
      for (let s = 0; s < NN; s++) if (c[s] > 0.1) area++;
      return { live: live, n: N, cellM: +cell.toFixed(1), sizeM: Math.round(size), max: +maxC.toFixed(3),
        brownAreaM2: Math.round(area * cell * cell), ticks: ticks, msLast: +msLast.toFixed(3) };
    },
  };

  /* ============================================================
     CBZ.waterTurbidAt(x, z, out) — HOW THICK THE WATER IS HERE, AND WHERE IT
     IS GOING. The one question the underwater medium and the swimmer ask:
       out.turb    0 clear .. 1 a full suspension
       out.u/v     the current (m/s), out.speed its size
       out.src     "flood" | "runup" | "silt" | "sea"
     A flash flood's water and the run-up's water on the land are mud by what
     they are; the sea is as brown as the silt field says; the current is the
     solved flow where there is one, else the disaster event's.
     ============================================================ */
  const _rs = {}, _ff = {}, _ev = {}, _sf = {};
  CBZ.waterTurbidAt = function (x, z, out) {
    out = out || {};
    out.turb = 0; out.u = 0; out.v = 0; out.speed = 0; out.src = "sea";
    const FF = CBZ.flashflood;
    if (FF && FF.live && FF.depthAt) {
      const d = FF.depthAt(x, z);
      if (d > 0.05) {
        FF.flowAt(x, z, _ff);
        out.turb = 0.88; out.u = _ff.x || 0; out.v = _ff.z || 0; out.src = "flood";
      }
    }
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    if (out.src === "sea" && F) {
      const r = F.sample(x, z, _rs);
      if (r.in > 0.5 && r.forced < 0.5 && r.depth > 0.05) {
        out.turb = LAND_LOAD; out.u = r.u; out.v = r.v; out.src = "runup";
      }
    }
    const s = at(x, z);
    if (s > out.turb) { out.turb = s; if (out.src === "sea") out.src = "silt"; }
    if (out.src === "sea" || out.src === "silt") {
      const e = CBZ.waterEventSample ? CBZ.waterEventSample(x, z, null, _ev) : null;
      if (e && e.active && e.wet) { out.u = e.currentX || 0; out.v = e.currentZ || 0; }
      else if (s > 0.02) { CBZ.tsuSilt.flowAt(x, z, _sf); out.u = _sf.x; out.v = _sf.z; }
    }
    out.speed = Math.hypot(out.u, out.v);
    return out;
  };
})();
