/* ============================================================
   city/airframe_kit.js — THE SHAPES EVERY CIVIL AIRCRAFT IS CUT FROM.

   One frame for every airframe in this kit: NOSE +Z, PORT +X, UP +Y (the
   cockpit.js canonical frame and the helicopter frame). A consumer that wants
   the airport's nose-+X convention wraps the finished airframe in a group
   turned a quarter (city/airframes.js does that for the apron fleet).

   What an aeroplane is made of, and nothing else:
     body(sections)          a smooth superellipse loft along -Z, nose first.
                             Stations [z, cy, halfW, hTop, hBot, n] are
                             Catmull-Rom blended; P(u, th, off) is a point on
                             the skin at station u, angle th (0 = port, pi/2 =
                             crown, pi = starboard), pushed `off` along the
                             section normal (negative = the inside liner).
     patch(...)              a grid of that skin between two stations and two
                             angles (functions of the station allowed).
     cell(B, rect, hole)     a skin cell PERFORATED by a window or door: a
                             ring of quads from the cell edge in to the hole
                             outline, sampled so neighbouring cells share their
                             edges exactly. This is how a window is a HOLE you
                             see through, not a dark decal.
     reveal / pane           the frame depth of that hole, and the glass in it.
     wing(stations)          a real aerofoil (NACA 4-digit thickness, a little
                             camber) swept along any span path — wings,
                             winglets, fins, tailplanes, control surfaces,
                             propeller and rotor blades.
     lathe(profile)          revolved bodies: nacelles, spinners, tyres.
     sweep(profile, z0, z1)  a 2D section run along Z: bins, sidewalls, rails.
     tube(points, r)         struts, rails, handles.
     merge(list)             ONE indexed geometry per material.

   No geometry here knows what aircraft it belongs to. Pure functions of
   numbers; every result is a THREE.BufferGeometry.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function spow(v, e) { return v < 0 ? -Math.pow(-v, e) : Math.pow(v, e); }
  // Catmull-Rom on a list of numbers, u in [0, n-1]
  function crAt(arr, u) {
    const n = arr.length;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
    const t = Math.max(0, Math.min(1, u - i));
    const p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(n - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  // ---------------------------------------------------------------------------
  //  THE LOFT
  // ---------------------------------------------------------------------------
  function body(sections, cx) {
    cx = cx || 0;
    const col = function (k) { return sections.map(function (s) { return s[k]; }); };
    const Z = col(0), CY = col(1), W = col(2), HT = col(3), HB = col(4), N = col(5);
    const last = sections.length - 1;
    for (let i = 1; i <= last; i++) {
      if (!(Z[i] < Z[i - 1])) throw new Error("airframe_kit.body: stations must run nose to tail (z strictly falling) at " + i);
    }
    function st(u) {
      return {
        z: crAt(Z, u), cy: crAt(CY, u), w: Math.max(0, crAt(W, u)), ht: Math.max(0, crAt(HT, u)),
        hb: Math.max(0, crAt(HB, u)), n: Math.max(1.6, crAt(N, u)),
      };
    }
    function raw(s, th) {
      const c = Math.cos(th), sn = Math.sin(th), e = 2 / s.n;
      return [cx + s.w * spow(c, e), s.cy + (sn >= 0 ? s.ht : s.hb) * spow(sn, e)];
    }
    function P(u, th, off) { return Pst(st(u), th, off); }
    function Pst(s, th, off) {
      const p = raw(s, th);
      if (off) {
        const a = raw(s, th - 0.004), b = raw(s, th + 0.004);
        let nx = b[1] - a[1], ny = -(b[0] - a[0]);
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (nx * (p[0] - cx) + ny * (p[1] - s.cy) < 0) { nx = -nx; ny = -ny; }
        p[0] += nx * off; p[1] += ny * off;
      }
      return [p[0], p[1], s.z];
    }
    // z -> u through a dense monotone table (the loft is sampled hundreds of
    // thousands of times while a type is built; a bisection per call was most
    // of the build time)
    const LUTN = Math.max(64, last * 96);
    const LZ = new Float64Array(LUTN + 1);
    for (let i = 0; i <= LUTN; i++) LZ[i] = crAt(Z, i / LUTN * last);
    function uOfZ(z) {
      if (z >= LZ[0]) return 0;
      if (z <= LZ[LUTN]) return last;
      let lo = 0, hi = LUTN;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (LZ[m] > z) lo = m; else hi = m; }
      const f = (LZ[lo] - z) / ((LZ[lo] - LZ[hi]) || 1);
      return (lo + f) / LUTN * last;
    }
    // point by axial z instead of station parameter; sections are cached by
    // z (the skin lattice revisits the same stations constantly)
    const ZC = new Map();
    function stZ(z) { let s = ZC.get(z); if (!s) { s = st(uOfZ(z)); ZC.set(z, s); } return s; }
    function at(z, th, off) { return Pst(stZ(z), th, off); }
    // the angle whose skin point sits at height y on the section at z (the
    // port side, th in [-pi/2, pi/2]); mirror with pi - th for starboard
    function thAtY(z, y) {
      const s = st(uOfZ(z));
      const h = y >= s.cy ? s.ht : s.hb;
      if (h <= 1e-6) return 0;
      const q = clamp((y - s.cy) / h, -1, 1);
      return Math.asin(clamp(spow(q, s.n / 2), -1, 1));
    }
    // half width of the section at z, at height y (for floors and bulkheads)
    function halfWidthAt(z, y) {
      const s = st(uOfZ(z));
      const h = y >= s.cy ? s.ht : s.hb;
      if (h <= 1e-6) return 0;
      const q = Math.abs((y - s.cy) / h);
      if (q >= 1) return 0;
      return s.w * Math.pow(1 - Math.pow(q, s.n), 1 / s.n);
    }
    // the closed outline of the section at z (for bulkheads), port first, ccw
    function section(z, off, n) {
      const u = uOfZ(z), out = [];
      n = n || 40;
      for (let i = 0; i < n; i++) { const p = P(u, i / n * TAU, off || 0); out.push([p[0], p[1]]); }
      return out;
    }
    return { P: P, at: at, st: st, uOfZ: uOfZ, last: last, cx: cx, z0: Z[0], z1: Z[last],
      thAtY: thAtY, halfWidthAt: halfWidthAt, section: section };
  }

  // ---------------------------------------------------------------------------
  //  GRIDS AND ORIENTATION
  // ---------------------------------------------------------------------------
  // an indexed grid f(a,b) a,b in [0,1]; faces point AWAY from inside(a,b)
  // (tested on the middle quad) unless `flip`, which points them TOWARD it
  function grid(nu, nv, f, inside, flip) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p = f(i / nu, j / nv);
      pos.push(p[0], p[1], p[2]); uv.push(i / nu, j / nv);
    }
    const V = function (i, j) { return i * (nv + 1) + j; };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      idx.push(V(i, j), V(i + 1, j), V(i, j + 1), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1));
    }
    if (inside) orient(pos, idx, inside((Math.floor(nu / 2) + 0.5) / nu, (Math.floor(nv / 2) + 0.5) / nv),
      V(nu >> 1, nv >> 1), V((nu >> 1) + 1, nv >> 1), V(nu >> 1, (nv >> 1) + 1), flip);
    return geo(pos, uv, idx);
  }
  // flip the winding of idx so triangle (a,b,c)'s normal points away from q
  function orient(pos, idx, q, a, b, c, flip) {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    let away = nx * (ax - q[0]) + ny * (ay - q[1]) + nz * (az - q[2]) >= 0;
    if (flip) away = !away;
    if (!away) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  function geo(pos, uv, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv || new Array(pos.length / 3 * 2).fill(0), 2));
    if (idx) g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // a patch of a body's skin: z0..z1 (z0 nearer the nose), th0..th1 (numbers or
  // functions of t in [0,1] along z), pushed `off` outward. `flip` = liner.
  function patch(B, z0, z1, th0, th1, off, nu, nv, flip) {
    const u0 = B.uOfZ(z0), u1 = B.uOfZ(z1);
    const T0 = typeof th0 === "function" ? th0 : function () { return th0; };
    const T1 = typeof th1 === "function" ? th1 : function () { return th1; };
    return grid(nu || 24, nv || 16, function (a, b) {
      return B.P(u0 + (u1 - u0) * a, T0(a) + (T1(a) - T0(a)) * b, off || 0);
    }, function (a) {
      const s = B.st(u0 + (u1 - u0) * a);
      return [B.cx, s.cy, s.z];
    }, flip);
  }

  // ---------------------------------------------------------------------------
  //  PERFORATED SKIN — windows and doors are HOLES
  // ---------------------------------------------------------------------------
  // hole outlines live in the skin's own (z, th) parameter space.
  //   roundRect(zc, tc, dz, dt, sq)  superellipse, half extents dz metres /
  //                                  dt radians, sq = squareness (2 = ellipse)
  //   quadHole(corners, r)           four (z, th) corners, corners rounded by
  //                                  r (0..0.5 of the shorter edge)
  function roundRect(zc, tc, dz, dt, sq, n) {
    const e = 2 / (sq || 4), out = [];
    n = n || 32;
    for (let i = 0; i < n; i++) {
      const ph = i / n * TAU;
      out.push([zc + dz * spow(Math.cos(ph), e), tc + dt * spow(Math.sin(ph), e)]);
    }
    return out;
  }
  function quadHole(c, r, n) {
    r = r == null ? 0.22 : r; n = n || 6;
    const out = [];
    for (let k = 0; k < 4; k++) {
      const p0 = c[(k + 3) % 4], p1 = c[k], p2 = c[(k + 1) % 4];
      const a = [lerp(p1[0], p0[0], r), lerp(p1[1], p0[1], r)];
      const b = [lerp(p1[0], p2[0], r), lerp(p1[1], p2[1], r)];
      for (let i = 0; i <= n; i++) {
        const t = i / n, s = 1 - t;
        out.push([s * s * a[0] + 2 * s * t * p1[0] + t * t * b[0], s * s * a[1] + 2 * s * t * p1[1] + t * t * b[1]]);
      }
    }
    return out;
  }
  function centroid(poly) {
    let z = 0, t = 0;
    for (const p of poly) { z += p[0]; t += p[1]; }
    return [z / poly.length, t / poly.length];
  }
  // ray from c along (dz, dt) (metric: th scaled by m) → first hit on poly
  function rayPoly(c, dz, dt, poly, m) {
    let best = Infinity;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ax = a[0] - c[0], ay = (a[1] - c[1]) * m, bx = b[0] - c[0], by = (b[1] - c[1]) * m;
      const ex = bx - ax, ey = by - ay;
      const den = dz * ey - dt * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = (ax * ey - ay * ex) / den;          // distance along the ray
      const r = (ax * dt - ay * dz) / den;          // fraction along the edge
      if (s > 1e-9 && r >= -1e-9 && r <= 1 + 1e-9 && s < best) best = s;
    }
    return best === Infinity ? 0 : best;
  }
  // Edge samples on a GLOBAL lattice (multiples of `step`) plus the two ends,
  // so any two regions that share an edge share its vertices — the skin is
  // one watertight surface however it was divided up.
  function axisSamples(a, b, step) {
    const out = [a];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const k0 = Math.floor(lo / step) + 1, k1 = Math.ceil(hi / step) - 1;
    const mid = [];
    for (let k = k0; k <= k1; k++) {
      const v = k * step;
      if (v - lo > step * 0.2 && hi - v > step * 0.2) mid.push(v);
    }
    if (a > b) mid.reverse();
    return out.concat(mid, [b]);
  }
  // the cell rectangle's boundary, corners exact.
  // z0 is the NOSE side (larger z). Walk: (z0,t0)->(z1,t0)->(z1,t1)->(z0,t1)
  function rectRing(z0, z1, t0, t1, zStep, tStep) {
    const zs = axisSamples(z0, z1, zStep), ts = axisSamples(t0, t1, tStep);
    const out = [];
    for (let i = 0; i < zs.length - 1; i++) out.push([zs[i], t0]);
    for (let i = 0; i < ts.length - 1; i++) out.push([z1, ts[i]]);
    for (let i = zs.length - 1; i > 0; i--) out.push([zs[i], t1]);
    for (let i = ts.length - 1; i > 0; i--) out.push([z0, ts[i]]);
    return out;
  }
  // A skin cell [z0..z1] x [t0..t1] with `hole` cut out of it. Rings step from
  // the cell edge to the hole outline in parameter space and are mapped onto
  // the loft, so every vertex sits ON the curved skin.
  function cell(B, z0, z1, t0, t1, hole, off, opts) {
    opts = opts || {};
    const K = opts.rings || 3;
    const outer = rectRing(z0, z1, t0, t1, opts.zStep || 0.3, opts.tStep || TAU / 64);
    const c = centroid(hole);
    const s0 = B.st(B.uOfZ(c[0]));
    const m = Math.max(0.2, (s0.w + s0.ht) * 0.5);          // metres per radian here
    const inner = outer.map(function (p) {
      const dz = p[0] - c[0], dt = (p[1] - c[1]) * m;
      const l = Math.hypot(dz, dt) || 1;
      const s = rayPoly(c, dz / l, dt / l, hole, m);
      return [c[0] + dz / l * s, c[1] + dt / l * s / m];
    });
    const n = outer.length, pos = [], idx = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      for (let i = 0; i < n; i++) {
        const zz = lerp(outer[i][0], inner[i][0], t), tt = lerp(outer[i][1], inner[i][1], t);
        const p = B.at(zz, tt, off || 0);
        pos.push(p[0], p[1], p[2]);
      }
    }
    for (let k = 0; k < K; k++) for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + (i + 1) % n, cc = (k + 1) * n + i, d = (k + 1) * n + (i + 1) % n;
      idx.push(a, b, cc, b, d, cc);
    }
    const sc = B.st(B.uOfZ(c[0]));
    orient(pos, idx, [B.cx, sc.cy, sc.z], idx[0], idx[1], idx[2], !!opts.flip);
    return geo(pos, null, idx);
  }
  // a plain (unperforated) region on the same global lattice
  function solidCell(B, z0, z1, t0, t1, off, opts) {
    opts = opts || {};
    const zs = axisSamples(z0, z1, opts.zStep || 0.3), ts = axisSamples(t0, t1, opts.tStep || TAU / 64);
    const pos = [], idx = [], nv = ts.length;
    for (let i = 0; i < zs.length; i++) for (let j = 0; j < nv; j++) {
      const p = B.at(zs[i], ts[j], off || 0);
      pos.push(p[0], p[1], p[2]);
    }
    for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < nv - 1; j++) {
      const a = i * nv + j, b = (i + 1) * nv + j, c = i * nv + j + 1, d = (i + 1) * nv + j + 1;
      idx.push(a, b, c, b, d, c);
    }
    const mi = zs.length >> 1;
    const s = B.st(B.uOfZ(zs[Math.max(0, mi - 1)] * 0.5 + zs[Math.min(zs.length - 1, mi)] * 0.5));
    // test on a quad in the middle of the grid
    const qi = Math.max(0, Math.min(zs.length - 2, mi - 1)), qj = Math.max(0, Math.min(nv - 2, (nv >> 1) - 1));
    const a0 = qi * nv + qj;
    const tri = [a0, (qi + 1) * nv + qj, a0 + 1];
    orient(pos, idx, [B.cx, s.cy, s.z], tri[0], tri[1], tri[2], !!opts.flip);
    return geo(pos, null, idx);
  }
  // the frame depth of a hole: a strip from the skin (off0) to the liner (off1)
  // around the hole outline, facing INTO the opening
  function reveal(B, hole, off0, off1) {
    const n = hole.length, pos = [], idx = [];
    for (const off of [off0, off1]) for (let i = 0; i < n; i++) {
      const p = B.at(hole[i][0], hole[i][1], off);
      pos.push(p[0], p[1], p[2]);
    }
    for (let i = 0; i < n; i++) {
      const a = i, b = (i + 1) % n, c = n + i, d = n + (i + 1) % n;
      idx.push(a, b, c, b, d, c);
    }
    const c = centroid(hole), p = B.at(c[0], c[1], (off0 + off1) / 2);
    orient(pos, idx, p, idx[0], idx[1], idx[2], true);
    return geo(pos, null, idx);
  }
  // glass filling a hole outline, set `off` from the skin (negative = inset)
  function pane(B, hole, off, rings) {
    const n = hole.length, K = rings || 3, pos = [], idx = [];
    const c = centroid(hole);
    for (let k = 0; k < K; k++) {
      const t = k / K;
      for (let i = 0; i < n; i++) {
        const p = B.at(lerp(hole[i][0], c[0], t), lerp(hole[i][1], c[1], t), off || 0);
        pos.push(p[0], p[1], p[2]);
      }
    }
    const pc = B.at(c[0], c[1], off || 0); pos.push(pc[0], pc[1], pc[2]);
    const ci = K * n;
    for (let k = 0; k < K - 1; k++) for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + (i + 1) % n, cc = (k + 1) * n + i, d = (k + 1) * n + (i + 1) % n;
      idx.push(a, b, cc, b, d, cc);
    }
    for (let i = 0; i < n; i++) idx.push((K - 1) * n + i, (K - 1) * n + (i + 1) % n, ci);
    const s = B.st(B.uOfZ(c[0]));
    orient(pos, idx, [B.cx, s.cy, s.z], idx[0], idx[1], idx[2], false);
    return geo(pos, null, idx);
  }
  // a thin tube tracing a closed (z, th) outline on the skin (seams, frames)
  function seam(B, poly, off, r) {
    const pts = poly.map(function (p) { const q = B.at(p[0], p[1], off); return new THREE.Vector3(q[0], q[1], q[2]); });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), Math.max(12, poly.length), r || 0.012, 3, true);
  }
  // an open (z, th) path on the skin as a tube (cheat lines of a set width are
  // patches; this is for piping and the door gap)
  function line(B, pts2, off, r) {
    const pts = pts2.map(function (p) { const q = B.at(p[0], p[1], off); return new THREE.Vector3(q[0], q[1], q[2]); });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false), Math.max(8, pts2.length * 3), r || 0.012, 4, false);
  }

  // ---------------------------------------------------------------------------
  //  AEROFOILS
  // ---------------------------------------------------------------------------
  // NACA 4-digit thickness (closed trailing edge), x in [0,1]
  function naca(x, t) {
    return 5 * t * (0.2969 * Math.sqrt(Math.max(0, x)) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  }
  // stations: [{le:[x,y,z], c: chord, t: thickness ratio, cam?: camber}]
  // chord runs from the leading edge along `chordDir` (default -Z, aft).
  // opts: {M: section samples, sub: subdivisions between stations, up: [x,y,z]
  // preferred thickness direction sign, cap: close the ends}
  function wing(stations, opts) {
    opts = opts || {};
    const M = opts.M || 20, sub = opts.sub || 1;
    const C = opts.chordDir || [0, 0, -1];
    const UP = opts.up || [0, 1, 0];
    // subdivide the station list linearly (smooth enough between authored ones)
    let S = [];
    for (let i = 0; i < stations.length; i++) {
      if (i === 0) { S.push(stations[0]); continue; }
      const a = stations[i - 1], b = stations[i];
      for (let k = 1; k <= sub; k++) {
        const t = k / sub;
        S.push({ le: [lerp(a.le[0], b.le[0], t), lerp(a.le[1], b.le[1], t), lerp(a.le[2], b.le[2], t)],
          c: lerp(a.c, b.c, t), t: lerp(a.t, b.t, t), cam: lerp(a.cam || 0, b.cam || 0, t),
          cut: t < 1 ? (a.cut == null ? 1 : a.cut) : (b.cut == null ? 1 : b.cut) });
      }
    }
    if (opts.cap !== false) {
      const f = S[0], l = S[S.length - 1];
      S = [Object.assign({}, f, { t: f.t * 0.02 })].concat(S, [Object.assign({}, l, { t: l.t * 0.02 })]);
    }
    const n = S.length;
    // per-station thickness direction: perpendicular to span and chord
    const T = S.map(function (s, i) {
      const a = S[Math.max(0, i - 1)].le, b = S[Math.min(n - 1, i + 1)].le;
      let sx = b[0] - a[0], sy = b[1] - a[1], sz = b[2] - a[2];
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      let tx = sy * C[2] - sz * C[1], ty = sz * C[0] - sx * C[2], tz = sx * C[1] - sy * C[0];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (tx * UP[0] + ty * UP[1] + tz * UP[2] < 0) { tx = -tx; ty = -ty; tz = -tz; }
      return [tx, ty, tz];
    });
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      const s = S[i], d = T[i];
      for (let j = 0; j < M; j++) {
        const ph = j / M * TAU;
        // `cut` < 1 stops the section short of the trailing edge (the wing box
        // ahead of a flap): full-chord thickness, blunt aft face
        const x = (s.cut == null ? 1 : s.cut) * (1 + Math.cos(ph)) / 2;   // TE .. 0 at LE
        const yt = naca(x, s.t), yc = (s.cam || 0) * 4 * x * (1 - x) * s.t;
        const y = Math.sin(ph) >= 0 ? yc + yt : yc - yt;
        pos.push(s.le[0] + C[0] * x * s.c + d[0] * y * s.c,
                 s.le[1] + C[1] * x * s.c + d[1] * y * s.c,
                 s.le[2] + C[2] * x * s.c + d[2] * y * s.c);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, dd = (i + 1) * M + (j + 1) % M;
      idx.push(a, c, b, b, c, dd);
    }
    // orientation: a point of the upper surface must face away from the mean line
    // test on a quad between two REAL stations (the end caps collapse to the
    // mean line, where "outward" is undefined)
    const capped = opts.cap !== false;
    const mi = Math.max(capped ? 1 : 0, Math.min(n - (capped ? 3 : 2), (n >> 1) - 1));
    const s = S[mi], s2 = S[mi + 1];
    const q = [(s.le[0] + s2.le[0]) / 2 + C[0] * 0.4 * (s.c + s2.c) / 2, (s.le[1] + s2.le[1]) / 2 + C[1] * 0.4 * (s.c + s2.c) / 2,
      (s.le[2] + s2.le[2]) / 2 + C[2] * 0.4 * (s.c + s2.c) / 2];
    const j0 = Math.round(M * 0.25);
    orient(pos, idx, q, idx[(mi * M + j0) * 6], idx[(mi * M + j0) * 6 + 1], idx[(mi * M + j0) * 6 + 2], false);
    return geo(pos, null, idx);
  }

  // ---------------------------------------------------------------------------
  //  REVOLVED AND SWEPT BODIES
  // ---------------------------------------------------------------------------
  // profile [[r, z]...] revolved about the Z axis (front = larger z first)
  function lathe(profile, seg, phiStart, phiLen) {
    const pts = profile.map(function (p) { return new THREE.Vector2(Math.max(0, p[0]), p[1]); });
    const g = new THREE.LatheGeometry(pts, seg || 24, phiStart || 0, phiLen || TAU);
    g.rotateX(Math.PI / 2);                   // lathe axis +Y → +Z
    g.computeVertexNormals();
    return g;
  }
  // a 2D section [[x,y]...] (closed unless open) swept straight along Z
  function sweep(profile, z0, z1, closed, flip) {
    const n = profile.length, pos = [], idx = [];
    for (const z of [z0, z1]) for (const p of profile) pos.push(p[0], p[1], z);
    const m = closed === false ? n - 1 : n;
    for (let i = 0; i < m; i++) {
      const a = i, b = (i + 1) % n, c = n + i, d = n + (i + 1) % n;
      idx.push(a, b, c, b, d, c);
    }
    let cx = 0, cy = 0; for (const p of profile) { cx += p[0]; cy += p[1]; }
    orient(pos, idx, [cx / n, cy / n, (z0 + z1) / 2], idx[0], idx[1], idx[2], !!flip);
    return geo(pos, null, idx);
  }
  // a flat polygon [[x,y]...] (+ holes) in the plane z, facing +Z or -Z
  function flat(outline, holes, z, facePlusZ) {
    const c = outline.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    const h = (holes || []).map(function (hh) { return hh.map(function (p) { return new THREE.Vector2(p[0], p[1]); }); });
    const shape = new THREE.Shape(c);
    for (const hh of h) shape.holes.push(new THREE.Path(hh));
    const g = new THREE.ShapeGeometry(shape, 4);
    if (!facePlusZ) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      const nn = g.attributes.normal;
      for (let i = 0; i < nn.count; i++) nn.setZ(i, -nn.getZ(i));
    }
    g.translate(0, 0, z);
    return g;
  }
  function tube(pts, r, seg, radial) {
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); })),
      seg || 16, r, radial || 6, false);
  }
  // a rounded box (the soft furniture primitive: cushions, bins, consoles)
  function rbox(w, h, d, r, seg) {
    const g = new THREE.BoxGeometry(w, h, d, seg || 3, seg || 3, seg || 3);
    r = Math.min(r || 0.02, w / 2, h / 2, d / 2);
    const p = g.attributes.position, hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const cx = clamp(v.x, -hw, hw), cy = clamp(v.y, -hh, hh), cz = clamp(v.z, -hd, hd);
      const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz, l = Math.hypot(dx, dy, dz) || 1;
      p.setXYZ(i, cx + dx / l * r, cy + dy / l * r, cz + dz / l * r);
    }
    g.computeVertexNormals();
    return g;
  }
  function xf(g, x, y, z, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, "YXZ")),
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    g.applyMatrix4(m);
    return g;
  }
  function mirrorX(g) {
    const c = g.clone();
    c.scale(-1, 1, 1);
    // a mirror inverts winding: swap two indices of every triangle
    if (c.index) {
      const a = c.index.array;
      for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      c.index.needsUpdate = true;
    } else {
      const p = c.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
      }
    }
    c.computeVertexNormals();
    return c;
  }

  // ---------------------------------------------------------------------------
  //  MERGE — ONE indexed geometry from many (position/normal/uv)
  // ---------------------------------------------------------------------------
  function merge(list) {
    list = list.filter(Boolean);
    if (!list.length) return null;
    let nv = 0, ni = 0;
    const parts = list.map(function (g) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const c = g.attributes.position.count;
      const ix = g.index ? g.index.array : null;
      nv += c; ni += ix ? ix.length : c;
      return { g: g, c: c, ix: ix };
    });
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const q of parts) {
      const g = q.g;
      P.set(g.attributes.position.array.subarray(0, q.c * 3), vo * 3);
      N.set(g.attributes.normal.array.subarray(0, q.c * 3), vo * 3);
      if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, q.c * 2), vo * 2);
      if (q.ix) { for (let k = 0; k < q.ix.length; k++) I[io + k] = q.ix[k] + vo; io += q.ix.length; }
      else { for (let k = 0; k < q.c; k++) I[io + k] = vo + k; io += q.c; }
      vo += q.c;
    }
    for (const q of parts) q.g.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }
  // a per-material bucket: put(key, geometry) ... bake() -> {key: geometry}
  function bucket() {
    const m = new Map();
    return {
      put: function (key, g) { if (!g) return g; let a = m.get(key); if (!a) m.set(key, a = []); a.push(g); return g; },
      bake: function () { const out = {}; m.forEach(function (list, k) { out[k] = merge(list); }); m.clear(); return out; },
      keys: function () { return Array.from(m.keys()); },
    };
  }
  function tris(g) { return g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0; }

  CBZ.airframeKit = {
    clamp: clamp, lerp: lerp, spow: spow, crAt: crAt,
    body: body, grid: grid, patch: patch,
    roundRect: roundRect, quadHole: quadHole, cell: cell, solidCell: solidCell, axisSamples: axisSamples,
    reveal: reveal, pane: pane, seam: seam, line: line,
    naca: naca, wing: wing, lathe: lathe, sweep: sweep, flat: flat, tube: tube, rbox: rbox,
    xf: xf, mirrorX: mirrorX, merge: merge, bucket: bucket, tris: tris,
  };
})();
