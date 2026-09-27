/* ============================================================
   world/island_roads.js — THE DISASTER ISLAND'S STREETS.

   The island's roads were a 7 m ribbon of tiling "asphalt" laid at a fixed
   height, avenues and cross-streets stacked through each other at every
   crossing, with a yellow dash every 6 m and nothing else: no kerb, no
   sidewalk, no junction, no signs, and black at night. This file is the
   whole street kit that replaced them. world/disaster_arena.js scans the
   grid lines (layRoadLine) and calls two things here:

     plan(o)   pure topology: the scanned runs become PIECES (road between two
               junction mouths, or a junction and a dead end) and JUNCTIONS
               (4-way, T, bend) with their legs. No two road surfaces ever
               overlap: every piece stops exactly at the 7 x 7 junction square,
               which is laid by itself with its own non-directional asphalt.
     build(o)  everything you see, in 7 draw calls:
                 roads      road-aligned asphalt (aggregate, wheel paths, oil
                            drip lines, sealed cracks, patches, gutter pans)
                 junctions  non-directional asphalt in every crossing square
                 sidewalks  real 0.15 m concrete: curb faces on the road side,
                            skirts into the ground behind, rounded corner
                            returns, curb ramps at crosswalks, driveway aprons
                 paint      ONE decal mesh: centre lines, edge lines, stop bars,
                            yield teeth, ladder crosswalks, manholes, grates,
                            curb inlets, oil stains, tactile pads
                 furniture  STOP / YIELD / SPEED LIMIT / barricades on steel
                            posts, cobra-head street light poles
                 lenses     street light lenses (MeshBasic, lit by night)
                 pools      additive light pools under each head, opacity
                            rides CBZ.nightAmount. No real THREE lights.
               It also answers surfaceHeightAt(x, z): the terrain everywhere,
               plus the sidewalk top on a sidewalk and the station pads.

   Everything is deterministic (position hashes + a fixed-seed PRNG local to
   this file); the arena's rng() stream is never touched. Colour maps are
   canvases uploaded as sRGB (texture.encoding = sRGBEncoding) and authored
   so they DECODE to real linear albedo (asphalt ~0.05, concrete ~0.2).
============================================================ */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const CBZ = G.CBZ = G.CBZ || {};

  // ---- street section (metres) -------------------------------------------
  const HW = 3.5;          // half road width (curb face)
  const WALK = 5.5;        // sidewalk back edge from the centre line
  const GUT = 0.35;        // concrete gutter pan
  const LIFT = 0.04;       // asphalt over the grass plain (city constant)
  const CURB = 0.15;       // sidewalk top over the ground
  const RAMP = 1.0;        // curb ramp / driveway apron run
  const APP = 9.5;         // approach zone either side of a crossing line
  const FIL = 1.5;         // corner curb return radius
  const DBL = 10;          // double yellow before a junction
  const CW0 = 5.5, CW1 = 7.5;          // crosswalk band (from the junction centre)
  const SB0 = 8.1, SB1 = 8.55;         // stop bar
  const EDGE_OFF = HW - GUT - 0.12 - 0.06;   // white edge line centre
  const TEX_V = 28;        // road texture repeat along (m)

  // ---- deterministic hashing ---------------------------------------------
  function ihash(a, b, s) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((s | 0) + 0x27d4eb2f, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  // world-position hash (decimetre grid, like CBZ.hash01) — no dependency
  function wh(x, z, s) { return ihash(Math.round(x * 10), Math.round(z * 10), s); }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wnoise(x, z, cell, salt) {       // smooth world value noise
    const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = ihash(ix, iz, salt), b = ihash(ix + 1, iz, salt), c = ihash(ix, iz + 1, salt), d = ihash(ix + 1, iz + 1, salt);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  const clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* ======================================================================
     PLAN — runs → pieces + junctions (pure; node-testable)
     o = { cx, cz, GRID, runs: { ave: [runs x5], cross: [runs x5] } }
     A run is [a, b] in metres along its line, relative to cx (cross-streets)
     or cz (avenues). Line index m = 0..4 sits at (m - 2) * GRID.
     ====================================================================== */
  function subtract(runs, lo, hi) {
    const out = [];
    for (const r of runs) {
      if (r[1] <= lo || r[0] >= hi) { out.push(r); continue; }
      if (r[0] < lo) out.push([r[0], lo]);
      if (r[1] > hi) out.push([hi, r[1]]);
    }
    return out;
  }
  // the run that forms a junction leg on side s: it carries on at least 2 m
  // past the approach point and has reached it (a run that starts a few
  // metres short of the square is pulled in to meet it)
  function legRun(runs, L, s) {
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (s > 0 ? (r[1] >= L + APP + 2 && r[0] <= L + APP) : (r[0] <= L - APP - 2 && r[1] >= L - APP)) return i;
    }
    return -1;
  }
  function plan(o) {
    const GR = o.GRID, cx = o.cx, cz = o.cz;
    const lines = {
      ave: [0, 1, 2, 3, 4].map(function (m) { return ((o.runs.ave && o.runs.ave[m]) || []).map(function (r) { return [r[0], r[1]]; }); }),
      cross: [0, 1, 2, 3, 4].map(function (m) { return ((o.runs.cross && o.runs.cross[m]) || []).map(function (r) { return [r[0], r[1]]; }); }),
    };
    let junctions = [];
    const jKey = {};
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const Lz = (j - 2) * GR, Lx = (i - 2) * GR;
      const N = legRun(lines.ave[i], Lz, 1) >= 0, S = legRun(lines.ave[i], Lz, -1) >= 0;
      const E = legRun(lines.cross[j], Lx, 1) >= 0, W = legRun(lines.cross[j], Lx, -1) >= 0;
      if ((N || S) && (E || W)) {
        const jn = { i: i, j: j, x: cx + Lx, z: cz + Lz, N: N, S: S, E: E, W: W, n: 0 };
        junctions.push(jn); jKey[i + "," + j] = jn;
      }
    }
    function cutAt(fam, m, L, plus, minus) {
      let runs = lines[fam][m];
      if (plus) { const k = legRun(runs, L, 1); if (k >= 0) runs[k][0] = Math.min(runs[k][0], L + HW); }
      if (minus) { const k = legRun(runs, L, -1); if (k >= 0) runs[k][1] = Math.max(runs[k][1], L - HW); }
      runs = subtract(runs, minus ? L - HW : L - APP, plus ? L + HW : L + APP);
      lines[fam][m] = runs;
    }
    for (const jn of junctions) {
      cutAt("ave", jn.i, (jn.j - 2) * GR, jn.N, jn.S);
      cutAt("cross", jn.j, (jn.i - 2) * GR, jn.E, jn.W);
    }
    // near-misses: a run that ENDS inside another road's corridor where no
    // junction was formed backs off to the approach point, so no road ever
    // stubs into the side of another (that overlap is a z-fight on TBDR)
    for (let pass = 0; pass < 2; pass++) {
      for (const fam of ["ave", "cross"]) {
        const other = fam === "ave" ? "cross" : "ave";
        for (let m = 0; m < 5; m++) {
          const mine = (m - 2) * GR;
          for (let n = 0; n < 5; n++) {
            if (jKey[fam === "ave" ? m + "," + n : n + "," + m]) continue;
            const Lp = (n - 2) * GR;
            const hits = lines[other][n].some(function (r) { return r[0] < mine + WALK + 0.5 && r[1] > mine - WALK - 0.5; });
            if (!hits) continue;
            const out = [];
            for (const r of lines[fam][m]) {
              let a = r[0], b = r[1];
              const aIn = a > Lp - APP && a < Lp + APP, bIn = b > Lp - APP && b < Lp + APP;
              if (aIn && bIn) continue;
              if (bIn) b = Lp - APP;
              if (aIn) a = Lp + APP;
              out.push([a, b]);
            }
            lines[fam][m] = out;
          }
        }
      }
    }
    for (const fam of ["ave", "cross"]) for (let m = 0; m < 5; m++) {
      lines[fam][m] = lines[fam][m].filter(function (r) { return r[1] - r[0] >= 5.9; });
    }
    // legs, re-read from what survived
    const EPS = 1e-6;
    const starts = function (runs, t) { return runs.some(function (r) { return Math.abs(r[0] - t) < EPS; }); };
    const ends = function (runs, t) { return runs.some(function (r) { return Math.abs(r[1] - t) < EPS; }); };
    junctions = junctions.filter(function (jn) {
      const Lz = (jn.j - 2) * GR, Lx = (jn.i - 2) * GR;
      jn.N = starts(lines.ave[jn.i], Lz + HW); jn.S = ends(lines.ave[jn.i], Lz - HW);
      jn.E = starts(lines.cross[jn.j], Lx + HW); jn.W = ends(lines.cross[jn.j], Lx - HW);
      jn.n = (jn.N ? 1 : 0) + (jn.S ? 1 : 0) + (jn.E ? 1 : 0) + (jn.W ? 1 : 0);
      const ok = (jn.N || jn.S) && (jn.E || jn.W);
      if (!ok) delete jKey[jn.i + "," + jn.j];
      return ok;
    });
    const pieces = [];
    for (const fam of ["ave", "cross"]) for (let m = 0; m < 5; m++) {
      const vertical = fam === "ave";
      const fixed = (vertical ? cx : cz) + (m - 2) * GR;
      for (const r of lines[fam][m]) {
        const p = {
          vertical: vertical, m: m, fixed: fixed, a: r[0], b: r[1],
          ox: vertical ? fixed : cx, oz: vertical ? cz : fixed,
          Ax: vertical ? 0 : 1, Az: vertical ? 1 : 0, Cx: vertical ? 1 : 0, Cz: vertical ? 0 : 1,
          jA: null, jB: null,
        };
        for (let n = 0; n < 5; n++) {
          const L = (n - 2) * GR;
          const jn = jKey[vertical ? m + "," + n : n + "," + m];
          if (!jn) continue;
          if (Math.abs(p.a - (L + HW)) < EPS) p.jA = jn;
          if (Math.abs(p.b - (L - HW)) < EPS) p.jB = jn;
        }
        pieces.push(p);
      }
    }
    return { pieces: pieces, junctions: junctions };
  }
  function px(p, t, off) { return p.ox + p.Ax * t + p.Cx * off; }
  function pz(p, t, off) { return p.oz + p.Az * t + p.Cz * off; }
  // lane side (sign of the across offset) for traffic travelling sigma * A
  function laneSide(p, sigma) { return sigma * (p.vertical ? -1 : 1); }
  function rectPL(p, t0, t1, o0, o1) {
    const xa = px(p, t0, o0), xb = px(p, t1, o1), za = pz(p, t0, o0), zb = pz(p, t1, o1);
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
  }

  /* ======================================================================
     ZONES — the walkable concrete as axis-aligned rects (+ corner returns)
     ====================================================================== */
  function makeZones(P, o) {
    const zones = [], roads = [];
    const cuts = o.cuts || [];
    function addZone(r, extra) { const z = Object.assign(r, extra); zones.push(z); return z; }
    for (const p of P.pieces) {
      roads.push(rectPL(p, p.a, p.b, -HW, HW));
      const a2 = p.a + (p.jA ? 2 : 0), b2 = p.b - (p.jB ? 2 : 0);
      for (const s of [-1, 1]) {
        if (b2 - a2 < 0.05) continue;
        const z = addZone(rectPL(p, a2, b2, s * HW, s * WALK), {
          kind: "side", axis: p.vertical ? "z" : "x", edge: p.fixed + s * HW, edgeDir: s, aprons: [], piece: p, side: s,
        });
        const base = p.vertical ? p.oz : p.ox;
        // curb ramps where the crosswalks land
        if (p.jA) z.aprons.push([base + p.a - HW + CW0, base + p.a - HW + CW1]);
        if (p.jB) z.aprons.push([base + p.b + HW - CW1, base + p.b + HW - CW0]);
        // driveway aprons: a station's cut AABB (grown 0.5 m) over this strip
        for (const c of cuts) {
          if (c.x1 + 0.5 < z.x0 || c.x0 - 0.5 > z.x1 || c.z1 + 0.5 < z.z0 || c.z0 - 0.5 > z.z1) continue;
          const u0 = Math.max(z.axis === "z" ? z.z0 : z.x0, z.axis === "z" ? c.z0 : c.x0);
          const u1 = Math.min(z.axis === "z" ? z.z1 : z.x1, z.axis === "z" ? c.z1 : c.x1);
          if (u1 - u0 > 0.3) z.aprons.push([u0, u1]);
        }
        z.aprons.sort(function (A, B) { return A[0] - B[0]; });
        const merged = [];
        for (const ap of z.aprons) {
          const last = merged[merged.length - 1];
          if (last && ap[0] <= last[1] + 0.3) last[1] = Math.max(last[1], ap[1]); else merged.push([ap[0], ap[1]]);
        }
        z.aprons = merged;
      }
      // dead ends: a concrete return across the end of the road
      if (!p.jA) addZone(rectPL(p, p.a - 2, p.a, -WALK, WALK), { kind: "end", axis: p.vertical ? "x" : "z", aprons: [], piece: p, endSign: -1 });
      if (!p.jB) addZone(rectPL(p, p.b, p.b + 2, -WALK, WALK), { kind: "end", axis: p.vertical ? "x" : "z", aprons: [], piece: p, endSign: 1 });
    }
    for (const jn of P.junctions) {
      const X = jn.x, Z = jn.z;
      roads.push({ x0: X - HW, x1: X + HW, z0: Z - HW, z1: Z + HW });
      if (!jn.N) addZone({ x0: X - HW, x1: X + HW, z0: Z + HW, z1: Z + WALK }, { kind: "band", axis: "x", aprons: [] });
      if (!jn.S) addZone({ x0: X - HW, x1: X + HW, z0: Z - WALK, z1: Z - HW }, { kind: "band", axis: "x", aprons: [] });
      if (!jn.E) addZone({ x0: X + HW, x1: X + WALK, z0: Z - HW, z1: Z + HW }, { kind: "band", axis: "z", aprons: [] });
      if (!jn.W) addZone({ x0: X - WALK, x1: X - HW, z0: Z - HW, z1: Z + HW }, { kind: "band", axis: "z", aprons: [] });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const legX = sx > 0 ? jn.E : jn.W, legZ = sz > 0 ? jn.N : jn.S;
        const r = { x0: Math.min(X + sx * HW, X + sx * WALK), x1: Math.max(X + sx * HW, X + sx * WALK),
          z0: Math.min(Z + sz * HW, Z + sz * WALK), z1: Math.max(Z + sz * HW, Z + sz * WALK) };
        addZone(r, { kind: "corner", axis: "x", aprons: [],
          fillet: (legX && legZ) ? { jx: X, jz: Z, sx: sx, sz: sz, fx: X + sx * (HW + FIL), fz: Z + sz * (HW + FIL) } : null });
      }
    }
    // spatial buckets (8 m) over everything
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    for (const r of zones.concat(roads)) {
      if (r.x0 < minX) minX = r.x0; if (r.z0 < minZ) minZ = r.z0; if (r.x1 > maxX) maxX = r.x1; if (r.z1 > maxZ) maxZ = r.z1;
    }
    const CELL = 8;
    if (minX > maxX) { minX = maxX = minZ = maxZ = 0; }
    const ox = minX - 1, oz = minZ - 1;
    const nx = Math.max(1, Math.ceil((maxX - ox + 1) / CELL)), nz = Math.max(1, Math.ceil((maxZ - oz + 1) / CELL));
    const wb = new Array(nx * nz), rb = new Array(nx * nz);
    function insert(bk, r, idx) {
      const i0 = Math.max(0, Math.floor((r.x0 - ox) / CELL)), i1 = Math.min(nx - 1, Math.floor((r.x1 - ox) / CELL));
      const k0 = Math.max(0, Math.floor((r.z0 - oz) / CELL)), k1 = Math.min(nz - 1, Math.floor((r.z1 - oz) / CELL));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) { const c = k * nx + i; (bk[c] || (bk[c] = [])).push(idx); }
    }
    zones.forEach(function (z, i) { insert(wb, z, i); });
    roads.forEach(function (r, i) { insert(rb, r, i); });
    function cellOf(x, z) {
      const i = Math.floor((x - ox) / CELL), k = Math.floor((z - oz) / CELL);
      if (i < 0 || k < 0 || i >= nx || k >= nz) return -1;
      return k * nx + i;
    }
    // height of the concrete above the ground at (x, z) in zone Z; -1 = the
    // corner return's asphalt (road)
    function zoneH(Z, x, z) {
      const f = Z.fillet;
      if (f) {
        const u = (x - f.jx) * f.sx, w = (z - f.jz) * f.sz;
        if (u < HW + FIL && w < HW + FIL && Math.hypot(x - f.fx, z - f.fz) > FIL) return -1;
        return CURB;
      }
      if (Z.aprons.length) {
        const al = Z.axis === "z" ? z : x;
        for (let i = 0; i < Z.aprons.length; i++) {
          const ap = Z.aprons[i];
          if (al >= ap[0] && al <= ap[1]) {
            const d = ((Z.axis === "z" ? x : z) - Z.edge) * Z.edgeDir;
            return LIFT + (CURB - LIFT) * clamp01(d / RAMP);
          }
        }
      }
      return CURB;
    }
    // walk height at (x, z): >= 0 concrete height, -1 road, -2 nothing
    function walkAt(x, z) {
      const c = cellOf(x, z);
      if (c < 0) return -2;
      const zl = wb[c];
      if (zl) for (let i = 0; i < zl.length; i++) {
        const Z = zones[zl[i]];
        if (x >= Z.x0 && x <= Z.x1 && z >= Z.z0 && z <= Z.z1) return zoneH(Z, x, z);
      }
      const rl = rb[c];
      if (rl) for (let i = 0; i < rl.length; i++) {
        const r = roads[rl[i]];
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return -1;
      }
      return -2;
    }
    return { zones: zones, roads: roads, walkAt: walkAt, zoneH: zoneH };
  }

  /* ======================================================================
     TEXTURE BAKERS (cached; sRGB colour maps)
     ====================================================================== */
  const LUT = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) { const v = i / 4096; LUT[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  function s8(v) { return LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0]; }
  function makeCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    try { const c = document.createElement("canvas"); c.width = w; c.height = h; return c.getContext ? c : null; } catch (e) { return null; }
  }
  // periodic lattice noise over a w x h pixel canvas (tiles seamlessly)
  function lattice(w, h, cell, salt) {
    const nx = Math.max(1, Math.round(w / cell)), ny = Math.max(1, Math.round(h / cell));
    const L = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) L[j * nx + i] = ihash(i, j, salt);
    const sx = nx / w, sy = ny / h;
    return function (x, y) {
      const gx = x * sx, gy = y * sy;
      let ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      ix %= nx; iy %= ny; if (ix < 0) ix += nx; if (iy < 0) iy += ny;
      const ix1 = ix + 1 === nx ? 0 : ix + 1, iy1 = iy + 1 === ny ? 0 : iy + 1;
      const a = L[iy * nx + ix], b = L[iy * nx + ix1], c = L[iy1 * nx + ix], d = L[iy1 * nx + ix1];
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  }
  function crackPts(r, x0, y0, ang, len, step, wob) {
    const pts = [[x0, y0]];
    let x = x0, y = y0, a = ang;
    for (let s = 0; s < len; s += step) {
      a += (r() - 0.5) * wob;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    return pts;
  }
  function strokePts(ctx, pts, offs) {
    for (const o of offs) {
      ctx.beginPath(); ctx.moveTo(pts[0][0] + o[0], pts[0][1] + o[1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + o[0], pts[i][1] + o[1]);
      ctx.stroke();
    }
  }
  // tar-sealed crack: a 5 cm glossy black band with the crack inside it
  function sealed(ctx, pts, ppm, offs) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(9,9,10,0.6)"; ctx.lineWidth = Math.max(2, 0.045 * ppm); strokePts(ctx, pts, offs);
    ctx.strokeStyle = "rgba(95,95,100,0.16)"; ctx.lineWidth = Math.max(1, 0.012 * ppm);
    strokePts(ctx, pts.map(function (q) { return [q[0] - 0.01 * ppm, q[1] - 0.01 * ppm]; }), offs);
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1; strokePts(ctx, pts, offs);
  }
  function hairline(ctx, pts, offs, a) {
    ctx.lineCap = "round"; ctx.strokeStyle = "rgba(6,6,6," + (a || 0.6) + ")"; ctx.lineWidth = 1; strokePts(ctx, pts, offs);
  }

  /* The asphalt pixel pass, shared by the road (u across 7 m, directional)
     and the junction (tiles both ways). Values are LINEAR albedo. */
  function paintAsphalt(img, W, H, ppm, road, patches) {
    const d = img.data;
    const n1 = lattice(W, H, 1.6 * ppm, 101), n2 = lattice(W, H, 0.45 * ppm, 102), n3 = lattice(W, H, 0.12 * ppm, 103);
    const oilN = lattice(W, H, 0.35 * ppm, 104), oilL = lattice(W, H, 1.2 * ppm, 105);
    const gutPx = GUT * ppm, jp = H / 9;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const h2 = ihash(x, y, 9);
        let r, g, b;
        if (road && (x < gutPx || x >= W - gutPx)) {
          // concrete gutter pan: joints every 3.1 m, a dirt line at the seam,
          // grit and a brown silt line against the curb
          const e = x < gutPx ? x : W - 1 - x;         // px from the curb
          let v = 0.19 * (0.86 + 0.28 * n2(x, y)) * (0.93 + 0.14 * h2);
          if (gutPx - e < 0.05 * ppm) v *= 0.55;        // seam grime
          const m = y % jp;
          if (m < 1.2 || jp - m < 0.8) v *= 0.42;       // tooled joint
          const silt = clamp01(1 - e / (0.08 * ppm));
          r = v * (1 - 0.4 * silt) + 0.06 * silt; g = v * (1 - 0.42 * silt) + 0.05 * silt; b = v * (0.95 - 0.45 * silt) + 0.035 * silt;
        } else {
          let v = 0.047 * (0.8 + 0.4 * n1(x, y)) * (0.9 + 0.2 * n2(x, y)) * (0.93 + 0.14 * n3(x, y));
          let wheel = 0, oil = 0;
          if (road) {
            const a = Math.abs(x / ppm - 3.5);
            const d1 = (a - 0.9) / 0.3, d2 = (a - 2.6) / 0.3, d3 = (a - 1.75) / 0.24;
            wheel = Math.exp(-d1 * d1) + Math.exp(-d2 * d2);
            oil = Math.exp(-d3 * d3) * clamp01((oilN(x, y) * 0.7 + oilL(x, y) * 0.6) - 0.35);
          } else {
            const cx0 = x / W - 0.5, cy0 = y / H - 0.5;
            oil = clamp01(0.55 - Math.hypot(cx0, cy0) * 1.6) * oilN(x, y);
          }
          v *= 1 - 0.14 * wheel;                   // polished darker wheel paths
          v *= 1 - 0.55 * oil;                     // drip line
          if (patches) for (const pa of patches) {
            if (x >= pa.x0 && x < pa.x1 && y >= pa.y0 && y < pa.y1) { v = pa.tone * (0.9 + 0.2 * n2(x + 37, y)) ; wheel = 0.6; break; }
          }
          // aggregate: 1 px (~1.4 cm) stones, pale ones sparse and soft —
          // 2 px stones at up to 3.3x read as white snow on screen
          const h1 = ihash(x, y, 7);
          const con = 1 - 0.6 * Math.min(1, wheel);
          if (h1 > 0.93) v *= 1 + (0.25 + 0.55 * h2) * con;     // pale aggregate
          else if (h1 < 0.08) v *= 1 - 0.35 * con;             // voids / dark chips
          v *= 0.9 + 0.2 * h2;
          r = v; g = v; b = v * 1.03;
        }
        d[i] = s8(r); d[i + 1] = s8(g); d[i + 2] = s8(b); d[i + 3] = 255;
      }
    }
  }
  const _tex = {};
  function finishTex(THREE, c, wrapS, wrapT, renderer) {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = wrapS; t.wrapT = wrapT;
    try { t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4; } catch (e) { t.anisotropy = 4; }
    t.needsUpdate = true;
    return t;
  }
  function bakeRoad(THREE, lo, renderer) {
    const key = "road" + lo;
    if (_tex[key] !== undefined) return _tex[key];
    const W = lo ? 256 : 512, H = W * 4, ppm = W / 7;
    const c = makeCanvas(W, H);
    if (!c) return (_tex[key] = null);
    const ctx = c.getContext("2d"), img = ctx.createImageData(W, H);
    const P = function (u0, u1, v0, v1, tone) { return { x0: (u0 + 3.5) * ppm, x1: (u1 + 3.5) * ppm, y0: v0 * ppm, y1: v1 * ppm, tone: tone }; };
    const patches = [P(0.55, 2.75, 5.0, 7.3, 0.034), P(-2.95, -1.15, 17.2, 20.6, 0.058), P(-0.9, 0.9, 25.1, 26.3, 0.04)];
    paintAsphalt(img, W, H, ppm, true, patches);
    ctx.putImageData(img, 0, 0);
    const r = mulberry(0x51a7);
    const wrap = [[0, -H], [0, 0], [0, H]];
    // patch edges: crisp saw cuts, tar sealed
    ctx.lineJoin = "miter";
    for (const pa of patches) {
      ctx.strokeStyle = "rgba(8,8,9,0.5)"; ctx.lineWidth = Math.max(1.5, 0.025 * ppm);
      ctx.strokeRect(pa.x0, pa.y0, pa.x1 - pa.x0, pa.y1 - pa.y0);
    }
    // cold joints at the gutter pans
    ctx.strokeStyle = "rgba(8,8,9,0.6)"; ctx.lineWidth = Math.max(1, 0.02 * ppm);
    ctx.beginPath(); ctx.moveTo(GUT * ppm, 0); ctx.lineTo(GUT * ppm, H); ctx.moveTo(W - GUT * ppm, 0); ctx.lineTo(W - GUT * ppm, H); ctx.stroke();
    // the longitudinal centre-joint crack: periodic meander, gated in runs
    const gate = lattice(1, H, 3 * ppm, 211);
    let run = [];
    for (let y = 0; y <= H; y += 5) {
      const on = gate(0, y) > 0.38;
      const x = W / 2 + ppm * (0.035 * Math.sin(2 * Math.PI * 3 * y / H + 1.3) + 0.02 * Math.sin(2 * Math.PI * 7 * y / H) + 0.012 * Math.sin(2 * Math.PI * 17 * y / H));
      if (on) run.push([x, y]);
      if ((!on || y + 5 > H) && run.length > 1) { sealed(ctx, run, ppm, wrap); run = []; }
      else if (!on) run = [];
    }
    // transverse cracks, gutter seam to gutter seam (one runs part way)
    [[4.2, 1], [13.6, 0.55], [22.9, 1]].forEach(function (tc, k) {
      const pts = crackPts(r, GUT * ppm + (k === 1 ? W * 0.4 : 0), tc[0] * ppm, (r() - 0.5) * 0.2, (W - 2 * GUT * ppm) * tc[1], 4, 0.42);
      sealed(ctx, pts, ppm, wrap);
    });
    // alligator cracking in an outer wheel path
    {
      const xc = (3.5 - 2.6) * ppm, y0 = 9.0 * ppm, y1 = 11.6 * ppm, sp = 0.12 * ppm;
      const cols = Math.round(0.7 * ppm / sp), rows = Math.round((y1 - y0) / sp);
      const pt = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        pt.push([xc - 0.35 * ppm + i * sp + (r() - 0.5) * sp * 0.7, y0 + j * sp + (r() - 0.5) * sp * 0.7]);
      }
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(xc - 0.4 * ppm, y0, 0.8 * ppm, y1 - y0);
      ctx.strokeStyle = "rgba(4,4,4,0.7)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const p = pt[j * (cols + 1) + i];
        const edgeFade = Math.min(i, cols - i, j, rows - j);
        if (i < cols && r() < (edgeFade ? 0.85 : 0.4)) { const q = pt[j * (cols + 1) + i + 1]; ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        if (j < rows && r() < (edgeFade ? 0.85 : 0.4)) { const q = pt[(j + 1) * (cols + 1) + i]; ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      }
      ctx.stroke();
    }
    // stray hairlines + discrete oil drips down each lane centre
    for (let k = 0; k < 7; k++) {
      const pts = crackPts(r, (GUT + 0.3 + r() * 6) * ppm, r() * H, r() * Math.PI * 2, (0.4 + r() * 1.4) * ppm, 3, 0.6);
      hairline(ctx, pts, wrap, 0.5);
    }
    for (let k = 0; k < 26; k++) {
      const lane = r() < 0.5 ? -1.75 : 1.75, x = (3.5 + lane + (r() - 0.5) * 0.35) * ppm, y = r() * H;
      const rad = (0.03 + r() * 0.07) * ppm;
      ctx.fillStyle = "rgba(0,0,0," + (0.12 + r() * 0.2).toFixed(3) + ")";
      for (const o of wrap) { ctx.beginPath(); ctx.ellipse(x, y + o[1], rad, rad * (1 + r()), 0, 0, Math.PI * 2); ctx.fill(); }
    }
    const t = finishTex(THREE, c, THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, renderer);
    return (_tex[key] = t);
  }
  function bakeJunction(THREE, lo, renderer) {
    const key = "junc" + lo;
    if (_tex[key] !== undefined) return _tex[key];
    const W = lo ? 256 : 512, ppm = W / 7;
    const c = makeCanvas(W, W);
    if (!c) return (_tex[key] = null);
    const ctx = c.getContext("2d"), img = ctx.createImageData(W, W);
    const patches = [{ x0: 4.3 * ppm, x1: 5.8 * ppm, y0: 1.0 * ppm, y1: 2.5 * ppm, tone: 0.036 }];
    paintAsphalt(img, W, W, ppm, false, patches);
    ctx.putImageData(img, 0, 0);
    const offs = [];
    for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) offs.push([ox, oy]);
    const r = mulberry(0x7c11);
    ctx.strokeStyle = "rgba(8,8,9,0.5)"; ctx.lineWidth = Math.max(1.5, 0.025 * ppm);
    ctx.strokeRect(patches[0].x0, patches[0].y0, patches[0].x1 - patches[0].x0, patches[0].y1 - patches[0].y0);
    sealed(ctx, crackPts(r, 0.6 * ppm, 5.2 * ppm, -0.5, 4.8 * ppm, 4, 0.5), ppm, offs);
    sealed(ctx, crackPts(r, 2.2 * ppm, 0.2 * ppm, 1.2, 3.4 * ppm, 4, 0.5), ppm, offs);
    for (let k = 0; k < 6; k++) hairline(ctx, crackPts(r, r() * W, r() * W, r() * 6.28, (0.4 + r()) * ppm, 3, 0.6), offs, 0.5);
    const t = finishTex(THREE, c, THREE.RepeatWrapping, THREE.RepeatWrapping, renderer);
    return (_tex[key] = t);
  }
  // one 2.0 m (u, across) x 1.5 m (v, along) broom-finished panel
  function bakeWalk(THREE, lo, renderer) {
    const key = "walk" + lo;
    if (_tex[key] !== undefined) return _tex[key];
    const W = lo ? 128 : 256;
    const c = makeCanvas(W, W);
    if (!c) return (_tex[key] = null);
    const ctx = c.getContext("2d"), img = ctx.createImageData(W, W), d = img.data;
    const n1 = lattice(W, W, W / 3, 301), n2 = lattice(W, W, W / 12, 302);
    const m = W / 42, j = Math.max(1, W / 128);
    for (let y = 0; y < W; y++) {
      const broom = 0.965 + 0.07 * ihash(0, y, 305) + 0.02 * ihash(1, y >> 1, 306);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, h = ihash(x, y, 307);
        const e = Math.min(x, y, W - 1 - x, W - 1 - y);
        let v = 0.2 * (0.88 + 0.24 * n1(x, y)) * (0.95 + 0.1 * n2(x, y)) * (0.96 + 0.08 * h);
        if (e < j) v *= 0.36;                         // scored joint
        else if (e < m) v *= 1.04;                    // tooled margin: smooth
        else v *= broom;
        d[i] = s8(v); d[i + 1] = s8(v * 0.985); d[i + 2] = s8(v * 0.95); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const r = mulberry(0x3a1);
    for (let k = 0; k < 9; k++) {             // gum spots
      ctx.fillStyle = "rgba(24,24,24," + (0.2 + r() * 0.25).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(m + r() * (W - 2 * m), m + r() * (W - 2 * m), 0.8 + r() * 1.6 * W / 256, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(92,62,30,0.1)";     // an old leaf / rust stain
    ctx.beginPath(); ctx.ellipse(W * 0.66, W * 0.3, W * 0.09, W * 0.05, 0.6, 0, Math.PI * 2); ctx.fill();
    const t = finishTex(THREE, c, THREE.RepeatWrapping, THREE.RepeatWrapping, renderer);
    return (_tex[key] = t);
  }
  /* Decal atlas, 4 x 4 cells: 0 paint (wear alpha), 1 manhole, 2 grate,
     3 oil stain, 4 solid dark, 5 light pool (radial), 7 tactile pad. */
  function bakeDecals(THREE, lo, renderer) {
    const key = "decal" + lo;
    if (_tex[key] !== undefined) return _tex[key];
    const S = lo ? 256 : 512, C = S / 4;
    const c = makeCanvas(S, S);
    if (!c) return (_tex[key] = null);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(S, S), d = img.data;
    const wear = lattice(C, C, C / 6, 401), wear2 = lattice(C, C, C / 20, 402);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, cell = ((y / C) | 0) * 4 + ((x / C) | 0), lx = x % C, ly = y % C;
      const h = ihash(x, y, 403);
      let r = 0, g = 0, b = 0, a = 0;
      if (cell === 0) {        // thermoplastic paint: worn by tyres, grit showing through
        const w = wear(lx, ly) * 0.7 + wear2(lx, ly) * 0.3;
        a = Math.round(255 * clamp01(0.95 - clamp01((w - 0.62) * 3) * 0.75 - (h < 0.08 ? 0.5 : 0)));   // 0..255, not 0..1 (was invisible paint)
        r = g = b = 255;
      } else if (cell === 1) { // cast iron manhole cover
        const dx = lx - C / 2 + 0.5, dy = ly - C / 2 + 0.5, rr = Math.hypot(dx, dy), R0 = C / 2 - 2;
        if (rr <= R0) {
          let v = 0.045;
          if (rr > R0 - C * 0.06) v = 0.075;                                   // rim
          else if (((Math.floor((dx + dy) / (C * 0.07)) + Math.floor((dx - dy) / (C * 0.07))) & 1) === 0) v = 0.062;  // diamond tread
          if (Math.abs(rr - R0 * 0.55) < C * 0.012) v = 0.03;
          v *= 0.85 + 0.3 * h;
          r = s8(v * 1.08); g = s8(v * 0.98); b = s8(v * 0.9); a = rr > R0 - 1 ? 180 : 255;
        }
      } else if (cell === 2) { // curb-side grate: frame + slots
        const fr = C * 0.07;
        const inFrame = lx < fr || ly < fr || lx >= C - fr || ly >= C - fr;
        const slot = !inFrame && (Math.floor((lx - fr) / (C * 0.086)) % 2 === 1);
        const v = inFrame ? 0.07 : slot ? 0.004 : 0.05;
        r = s8(v * (0.9 + 0.2 * h)); g = s8(v * (0.88 + 0.2 * h)); b = s8(v * 0.85); a = 255;
      } else if (cell === 3) { // oil stain
        const dx = (lx - C / 2) / (C / 2), dy = (ly - C / 2) / (C / 2);
        const rr = Math.hypot(dx, dy) + (wear(lx * 2, ly * 2) - 0.5) * 0.5;
        a = clamp01((0.85 - rr) * 1.6) * 150 * (0.8 + 0.2 * h);
        r = g = b = 4;
      } else if (cell === 4) { r = g = b = 3; a = 255; }
      else if (cell === 5) {   // light pool falloff
        const rr = Math.hypot(lx - C / 2 + 0.5, ly - C / 2 + 0.5) / (C / 2);
        const f = clamp01(1 - rr); const v = f * f * (3 - 2 * f);
        r = g = b = 255; a = Math.round(255 * v);
      } else if (cell === 7) { // detectable warning: yellow, truncated domes
        const sp = C / 9, qx = (lx % sp) - sp / 2, qy = (ly % sp) - sp / 2;
        const dome = Math.hypot(qx, qy) < sp * 0.3;
        r = dome ? 215 : 190; g = dome ? 160 : 136; b = dome ? 30 : 18; a = 245;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    const t = finishTex(THREE, c, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, renderer);
    t.premultiplyAlpha = false;
    return (_tex[key] = t);
  }
  /* Sign atlas, 4 x 4 cells: 0 STOP, 1 YIELD, 2 SPEED LIMIT 25, 3 ALL WAY,
     4 aluminium back, 5 white (tinted by vertex colour), 6 barricade rail. */
  const SIGN_M = { 0: 0.86, 1: 0.96, 2: 0.8, 3: 0.5 };   // metres one cell spans
  function bakeSigns(THREE, lo, renderer) {
    const key = "sign" + lo;
    if (_tex[key] !== undefined) return _tex[key];
    const S = lo ? 256 : 512, C = S / 4;
    const c = makeCanvas(S, S);
    if (!c) return (_tex[key] = null);
    const ctx = c.getContext("2d");
    const FONT = "Helvetica, Arial, sans-serif";
    const cellXY = function (i) { return [(i % 4) * C, Math.floor(i / 4) * C]; };
    ctx.fillStyle = "#8f9296"; ctx.fillRect(0, 0, S, S);
    // STOP (R1-1): 30 in octagon, white border
    {
      const o = cellXY(0), m = SIGN_M[0], cx = o[0] + C / 2, cy = o[1] + C / 2;
      const oct = function (rad) {
        ctx.beginPath();
        for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; ctx.lineTo(cx + Math.cos(a) * rad, cy - Math.sin(a) * rad); }
        ctx.closePath();
      };
      const R0 = 0.406 / m * C;
      ctx.fillStyle = "#ffffff"; oct(R0); ctx.fill();
      ctx.fillStyle = "#b3121b"; oct(R0 * 0.93); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(C * 0.25) + "px " + FONT;
      ctx.fillText("STOP", cx, cy + C * 0.01, R0 * 1.55);
    }
    // YIELD (R1-2): inverted triangle, red band, white centre
    {
      const o = cellXY(1), m = SIGN_M[1], cx = o[0] + C / 2, cy = o[1] + C / 2;
      const side = 0.9 / m * C, hgt = side * Math.sqrt(3) / 2;
      const tri = function (s) {
        const hh = s * Math.sqrt(3) / 2;
        ctx.beginPath(); ctx.moveTo(cx - s / 2, cy - hh / 2); ctx.lineTo(cx + s / 2, cy - hh / 2); ctx.lineTo(cx, cy + hh / 2); ctx.closePath();
      };
      ctx.fillStyle = "#ffffff"; tri(side); ctx.fill();
      ctx.fillStyle = "#b3121b"; tri(side * 0.95); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.save(); ctx.translate(0, -hgt * 0.02); tri(side * 0.52); ctx.restore(); ctx.fill();
      ctx.fillStyle = "#b3121b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(C * 0.075) + "px " + FONT;
      ctx.fillText("YIELD", cx, cy - hgt * 0.2, side * 0.36);
    }
    // SPEED LIMIT 25 (R2-1): 24 x 30 in
    {
      const o = cellXY(2), m = SIGN_M[2], cx = o[0] + C / 2, cy = o[1] + C / 2;
      const w = 0.6 / m * C, h = 0.75 / m * C;
      ctx.fillStyle = "#f4f4f2"; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(2, C * 0.012);
      ctx.strokeRect(cx - w / 2 + C * 0.02, cy - h / 2 + C * 0.02, w - C * 0.04, h - C * 0.04);
      ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(C * 0.1) + "px " + FONT;
      ctx.fillText("SPEED", cx, cy - h * 0.3, w * 0.8);
      ctx.fillText("LIMIT", cx, cy - h * 0.13, w * 0.8);
      ctx.font = "bold " + Math.round(C * 0.3) + "px " + FONT;
      ctx.fillText("25", cx, cy + h * 0.18, w * 0.84);
    }
    // ALL WAY (R1-3P): 18 x 6 in plaque, white on red
    {
      const o = cellXY(3), m = SIGN_M[3], cx = o[0] + C / 2, cy = o[1] + C / 2;
      const w = 0.45 / m * C, h = 0.15 / m * C;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = "#b3121b"; ctx.fillRect(cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4);
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(h * 0.62) + "px " + FONT;
      ctx.fillText("ALL WAY", cx, cy + h * 0.03, w * 0.88);
    }
    // aluminium sign back (brushed)
    {
      const o = cellXY(4);
      ctx.fillStyle = "#a4a7ab"; ctx.fillRect(o[0], o[1], C, C);
      for (let y = 0; y < C; y += 2) { ctx.fillStyle = "rgba(255,255,255," + (ihash(y, 4, 501) * 0.08).toFixed(3) + ")"; ctx.fillRect(o[0], o[1] + y, C, 1); }
    }
    { const o = cellXY(5); ctx.fillStyle = "#ffffff"; ctx.fillRect(o[0], o[1], C, C); }
    // Type III barricade rail: orange / white 45-degree stripes on a 2.4 x 0.2 m board
    {
      const o = cellXY(6);
      ctx.fillStyle = "#f4f4f2"; ctx.fillRect(o[0], o[1], C, C);
      ctx.save(); ctx.beginPath(); ctx.rect(o[0], o[1], C, C); ctx.clip();
      ctx.fillStyle = "#e0561a";
      const pxm = C / 2.4, pym = C / 0.2, dx = 0.2 * pxm, sw = 0.15 * pxm;
      for (let k = -2; k < 18; k++) {
        const x0 = o[0] + k * 0.3 * pxm;
        ctx.beginPath(); ctx.moveTo(x0, o[1] + C); ctx.lineTo(x0 + sw, o[1] + C); ctx.lineTo(x0 + sw + dx, o[1]); ctx.lineTo(x0 + dx, o[1]); ctx.closePath(); ctx.fill();
      }
      void pym;
      ctx.restore();
    }
    const t = finishTex(THREE, c, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, renderer);
    return (_tex[key] = t);
  }
  // uv of local (lx, ly) (y up, metres) inside atlas cell i, where the cell
  // spans mx by my metres
  function cellUV(i, n, lx, ly, mx, my, out) {
    const cw = 1 / n, u0 = (i % n) * cw, v1 = 1 - Math.floor(i / n) * cw;
    out[0] = u0 + (0.5 + lx / mx) * cw;
    out[1] = v1 - (0.5 - ly / my) * cw;
    return out;
  }

  /* ======================================================================
     GEOMETRY ACCUMULATOR (non-indexed, flat normals, winding self-checked)
     ====================================================================== */
  function Acc() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  // V = [x, y, z, u, v, r, g, b]; N = intended outward normal
  Acc.prototype.tri = function (A, B, C, nx, ny, nz) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) return;
    if (cx * nx + cy * ny + cz * nz < 0) { const T = B; B = C; C = T; }
    for (const V of [A, B, C]) {
      this.p.push(V[0], V[1], V[2]); this.n.push(nx, ny, nz); this.uv.push(V[3], V[4]); this.c.push(V[5], V[6], V[7]);
    }
  };
  Acc.prototype.quad = function (A, B, C, D, nx, ny, nz) { this.tri(A, B, C, nx, ny, nz); this.tri(A, C, D, nx, ny, nz); };
  Acc.prototype.geo = function (THREE) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  Acc.prototype.count = function () { return this.p.length / 3; };

  /* ======================================================================
     BUILD
     o = { THREE, root, cx, cz, R, plan, ground, cuts, pads, quality,
           renderer, colliders, onUpdate, modeOn }
     ====================================================================== */
  function build(o) {
    const THREE = o.THREE, P = o.plan, ground = o.ground;
    const lo = o.quality != null && o.quality <= 1;
    const pads = o.pads || [];
    const Z = makeZones(P, o);
    const base = function (x, z) { const g = ground(x, z); return g > 0 ? g : 0; };
    // the rendered surface: asphalt or concrete top
    function surfY(x, z) {
      const h = Z.walkAt(x, z);
      return base(x, z) + (h >= 0 ? h : LIFT);
    }
    // ---- the walkable floor the physics reads ----
    function surfaceHeightAt(x, z) {
      const g = ground(x, z);
      let y = g;
      const h = Z.walkAt(x, z);
      if (h >= 0) y = (g > 0 ? g : 0) + h;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.top > y) y = p.top;
      }
      return y;
    }
    const V = function (x, y, z, u, v, r, g, b) { return [x, y, z, u, v, r, g, b]; };
    const uvT = [0, 0];

    /* ---------------- ROADS (directional asphalt) ---------------- */
    const roadA = new Acc(), juncA = new Acc();
    const OFFS = [-3.5, -3.15, -1.75, 0, 1.75, 3.15, 3.5];
    function roadTone(x, z) {
      const n = wnoise(x, z, 23, 0x5a1) * 0.6 + wnoise(x, z, 7, 0x5a2) * 0.4;
      const k = 0.88 + 0.22 * n;
      return [k * 1.01, k, k * 0.985];
    }
    function vRoad(p, t, off, vOff) {
      const x = px(p, t, off), z = pz(p, t, off), c = roadTone(x, z);
      return V(x, base(x, z) + LIFT, z, (off + HW) / 7, (t + vOff) / TEX_V, c[0], c[1], c[2]);
    }
    for (const p of P.pieces) {
      const vOff = Math.floor(wh(p.fixed, p.a, 0x7011) * 8) * 3.5;
      const ta = p.jA ? p.a : p.a + GUT, tb = p.jB ? p.b : p.b - GUT;
      const n = Math.max(1, Math.ceil((tb - ta) / 2));
      for (let k = 0; k < n; k++) {
        const t0 = ta + (tb - ta) * k / n, t1 = ta + (tb - ta) * (k + 1) / n;
        for (let c = 0; c < OFFS.length - 1; c++) {
          roadA.quad(vRoad(p, t0, OFFS[c], vOff), vRoad(p, t0, OFFS[c + 1], vOff), vRoad(p, t1, OFFS[c + 1], vOff), vRoad(p, t1, OFFS[c], vOff), 0, 1, 0);
        }
      }
      // dead-end gutter pans across the road end (u = distance from the curb)
      const endPan = function (e, sgn) {
        for (let c = 0; c < OFFS.length - 1; c++) {
          const mk = function (t, off) {
            const x = px(p, t, off), z = pz(p, t, off), col = roadTone(x, z);
            return V(x, base(x, z) + LIFT, z, Math.abs(e - t) / 7, (off + HW) / TEX_V, col[0], col[1], col[2]);
          };
          const t0 = e - sgn * GUT;
          roadA.quad(mk(t0, OFFS[c]), mk(t0, OFFS[c + 1]), mk(e, OFFS[c + 1]), mk(e, OFFS[c]), 0, 1, 0);
        }
      };
      if (!p.jA) endPan(p.a, -1);
      if (!p.jB) endPan(p.b, 1);
    }
    /* ---------------- JUNCTIONS ---------------- */
    for (const jn of P.junctions) {
      const X = jn.x, Zc = jn.z;
      const x0 = X - HW + (jn.W ? 0 : GUT), x1 = X + HW - (jn.E ? 0 : GUT);
      const z0 = Zc - HW + (jn.S ? 0 : GUT), z1 = Zc + HW - (jn.N ? 0 : GUT);
      const hsw = wh(X, Zc, 0x1a1) < 0.5, fu = wh(X, Zc, 0x1a2) < 0.5, fv = wh(X, Zc, 0x1a3) < 0.5;
      const mk = function (x, z) {
        let u = (x - X + HW) / 7, v = (z - Zc + HW) / 7;
        if (fu) u = 1 - u; if (fv) v = 1 - v;
        if (hsw) { const t = u; u = v; v = t; }
        const c = roadTone(x, z);
        return V(x, base(x, z) + LIFT, z, u, v, c[0], c[1], c[2]);
      };
      const N = 3;
      for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
        const xa = x0 + (x1 - x0) * i / N, xb = x0 + (x1 - x0) * (i + 1) / N;
        const za = z0 + (z1 - z0) * k / N, zb = z0 + (z1 - z0) * (k + 1) / N;
        juncA.quad(mk(xa, za), mk(xb, za), mk(xb, zb), mk(xa, zb), 0, 1, 0);
      }
      // gutter pans along the closed sides (road texture, u from the curb)
      const pan = function (ax0, ax1, az0, az1, curbAxis, curbVal) {
        const segs = 3;
        for (let s = 0; s < segs; s++) {
          const mkp = function (x, z) {
            const c = roadTone(x, z);
            const u = Math.abs((curbAxis === "z" ? z : x) - curbVal) / 7;
            const v = (curbAxis === "z" ? x : z) / TEX_V;
            return V(x, base(x, z) + LIFT, z, u, v, c[0], c[1], c[2]);
          };
          if (curbAxis === "z") {
            const xa = ax0 + (ax1 - ax0) * s / segs, xb = ax0 + (ax1 - ax0) * (s + 1) / segs;
            roadA.quad(mkp(xa, az0), mkp(xb, az0), mkp(xb, az1), mkp(xa, az1), 0, 1, 0);
          } else {
            const za = az0 + (az1 - az0) * s / segs, zb = az0 + (az1 - az0) * (s + 1) / segs;
            roadA.quad(mkp(ax0, za), mkp(ax1, za), mkp(ax1, zb), mkp(ax0, zb), 0, 1, 0);
          }
        }
      };
      if (!jn.N) pan(X - HW, X + HW, Zc + HW - GUT, Zc + HW, "z", Zc + HW);
      if (!jn.S) pan(X - HW, X + HW, Zc - HW, Zc - HW + GUT, "z", Zc - HW);
      if (!jn.E) pan(X + HW - GUT, X + HW, z0, z1, "x", X + HW);
      if (!jn.W) pan(X - HW, X - HW + GUT, z0, z1, "x", X - HW);
    }
    /* ---------------- CORNER RETURNS: arcs shared by road + walk ------- */
    const ARC = 6;
    function arcPts(f) {
      const pts = [];
      for (let k = 0; k <= ARC; k++) {
        const th = (k / ARC) * Math.PI / 2;
        pts.push([f.fx - f.sx * FIL * Math.cos(th), f.fz - f.sz * FIL * Math.sin(th)]);
      }
      return pts;   // from (HW, HW+FIL) to (HW+FIL, HW) in local |u|,|w|
    }
    for (const zn of Z.zones) {
      if (!zn.fillet) continue;
      const f = zn.fillet, pts = arcPts(f);
      const cxp = f.jx + f.sx * HW, czp = f.jz + f.sz * HW;
      const mk = function (x, z) {
        const d = Math.max(0, Math.hypot(x - f.fx, z - f.fz) - FIL);
        const c = roadTone(x, z);
        return V(x, base(x, z) + LIFT, z, Math.min(d, GUT) / 7, (x + z) / TEX_V, c[0], c[1], c[2]);
      };
      const cv = mk(cxp, czp);
      for (let k = 0; k < ARC; k++) roadA.tri(cv, mk(pts[k][0], pts[k][1]), mk(pts[k + 1][0], pts[k + 1][1]), 0, 1, 0);
    }

    /* ---------------- SIDEWALKS ---------------- */
    const walkA = new Acc();
    function tone(x, z, salt) {
      const k = (0.86 + 0.2 * wh(Math.floor(x / 1.5), Math.floor(z / 1.5), salt)) * (0.9 + 0.14 * wnoise(x, z, 9, 0x6b1));
      return k;
    }
    function skirtBot(x, z) { const g = ground(x, z); return Math.min(g, g > 0 ? g : 0) - 0.25; }
    // vertical face between two top points, down to the curb foot or the skirt foot
    function face(x0, z0, y0, x1, z1, y1, nx, nz, kind, uAlong) {
      const b0 = kind === "curb" ? base(x0, z0) : skirtBot(x0, z0);
      const b1 = kind === "curb" ? base(x1, z1) : skirtBot(x1, z1);
      if (y0 - b0 < 0.005 && y1 - b1 < 0.005) return;
      const k = kind === "curb" ? 0.94 : 0.72;
      const L = Math.hypot(x1 - x0, z1 - z0) / 1.5;
      walkA.quad(V(x0, b0, z0, uAlong, 0, k, k, k), V(x1, b1, z1, uAlong + L, 0, k, k, k),
        V(x1, y1, z1, uAlong + L, 0.08, k, k, k), V(x0, y0, z0, uAlong, 0.08, k, k, k), nx, 0, nz);
    }
    function faceKind(x, z) {
      const h = Z.walkAt(x, z);
      return h === -1 ? "curb" : h === -2 ? "skirt" : null;
    }
    function buildRectZone(zn) {
      const alongZ = zn.axis === "z";
      const A0 = alongZ ? zn.z0 : zn.x0, A1 = alongZ ? zn.z1 : zn.x1;
      const C0 = alongZ ? zn.x0 : zn.z0, C1 = alongZ ? zn.x1 : zn.z1;
      const W2 = function (a, c) { return alongZ ? [c, a] : [a, c]; };   // (along, across) -> [x, z]
      // chunk breakpoints: apron ends + <= 3 m
      const brk = [A0, A1];
      for (const ap of zn.aprons) { if (ap[0] > A0 + 0.01 && ap[0] < A1 - 0.01) brk.push(ap[0]); if (ap[1] > A0 + 0.01 && ap[1] < A1 - 0.01) brk.push(ap[1]); }
      if (zn.kind === "end") {        // the road mouth vs the sidewalk ends
        const f = zn.piece.fixed;
        brk.push(f - HW, f + HW);
      }
      brk.sort(function (a, b) { return a - b; });
      const cuts = [];
      for (let i = 0; i < brk.length - 1; i++) {
        const a = brk[i], b = brk[i + 1], n = Math.max(1, Math.ceil((b - a) / 3 - 1e-6));
        for (let k = 0; k < n; k++) cuts.push([a + (b - a) * k / n, a + (b - a) * (k + 1) / n]);
      }
      const isApron = function (a, b) {
        const m = (a + b) / 2;
        return zn.aprons.some(function (ap) { return m > ap[0] && m < ap[1]; });
      };
      const hAt = function (c, apron) {
        if (!apron) return CURB;
        return LIFT + (CURB - LIFT) * clamp01((c - zn.edge) * zn.edgeDir / RAMP);
      };
      const salt = 0x6b2 + (zn.kind === "side" ? 1 : 2);
      for (let ci = 0; ci < cuts.length; ci++) {
        const a = cuts[ci][0], b = cuts[ci][1];
        const ap = isApron(a, b);
        let cols = [C0, C1];
        if (ap) { const e = zn.edge, r = zn.edge + zn.edgeDir * RAMP; cols = [C0, C1, r].sort(function (p, q) { return p - q; }); void e; }
        const mid = W2((a + b) / 2, (C0 + C1) / 2);
        const tk = tone(mid[0], mid[1], salt) * (ap ? 0.93 : 1);
        const top = function (al, c) {
          const w = W2(al, c), y = base(w[0], w[1]) + hAt(c, ap);
          const k = tk * (0.97 + 0.06 * wh(w[0], w[1], 0x6b3));
          return V(w[0], y, w[1], (c - C0) / 2, (al - A0) / 1.5, k, k * 0.99, k * 0.97);
        };
        for (let k = 0; k < cols.length - 1; k++) {
          walkA.quad(top(a, cols[k]), top(a, cols[k + 1]), top(b, cols[k + 1]), top(b, cols[k]), 0, 1, 0);
        }
        // long edges
        for (const side of [-1, 1]) {
          const c = side < 0 ? C0 : C1;
          if (ap && Math.abs(c - zn.edge) < 1e-6) continue;       // apron meets the road flush
          const s = W2((a + b) / 2, c + side * 0.05);
          const kind = faceKind(s[0], s[1]);
          if (!kind) continue;
          const w0 = W2(a, c), w1 = W2(b, c);
          const n = W2(0, side);
          face(w0[0], w0[1], base(w0[0], w0[1]) + hAt(c, ap), w1[0], w1[1], base(w1[0], w1[1]) + hAt(c, ap), n[0], n[1], kind, a / 1.5);
        }
        // chunk ends
        for (const endS of [-1, 1]) {
          const al = endS < 0 ? a : b;
          const zoneEnd = endS < 0 ? ci === 0 : ci === cuts.length - 1;
          const n = W2(endS, 0);
          if (zoneEnd) {
            const s = W2(al + endS * 0.05, (C0 + C1) / 2);
            const kind = faceKind(s[0], s[1]);
            if (kind) {
              for (let k = 0; k < cols.length - 1; k++) {
                const w0 = W2(al, cols[k]), w1 = W2(al, cols[k + 1]);
                face(w0[0], w0[1], base(w0[0], w0[1]) + hAt(cols[k], ap), w1[0], w1[1], base(w1[0], w1[1]) + hAt(cols[k + 1], ap), n[0], n[1], kind, cols[k] / 1.5);
              }
              continue;
            }
          }
          // flare: an apron chunk against full-height concrete
          if (!ap) continue;
          let nbFull;
          if (zoneEnd) {
            const s = W2(al + endS * 0.05, zn.edge + zn.edgeDir * 0.02);
            const h = Z.walkAt(s[0], s[1]);
            nbFull = h > LIFT + 0.02;
          } else {
            const nb = cuts[ci + endS];
            nbFull = !isApron(nb[0], nb[1]);
          }
          if (!nbFull) continue;
          const e = zn.edge, r = zn.edge + zn.edgeDir * RAMP;
          const p0 = W2(al, e), p1 = W2(al, r);
          const y0 = base(p0[0], p0[1]), y1 = base(p1[0], p1[1]);
          const k = tk * 0.94;
          walkA.tri(V(p0[0], y0 + LIFT, p0[1], 0, 0, k, k, k), V(p0[0], y0 + CURB, p0[1], 0, 0.08, k, k, k), V(p1[0], y1 + CURB, p1[1], 0.6, 0.08, k, k, k), -n[0], 0, -n[1]);
        }
      }
    }
    function buildFilletZone(zn) {
      const f = zn.fillet, pts = arcPts(f);
      const L = function (u, w) { return [f.jx + f.sx * u, f.jz + f.sz * w]; };
      // ring from the arc end (HW+FIL, HW) round the outside to the arc start (HW, HW+FIL)
      const ring = [L(HW + FIL, HW), L(WALK, HW), L(WALK, WALK), L(HW, WALK), L(HW, HW + FIL)];
      for (let k = 1; k < ARC; k++) ring.push(pts[k]);
      const cvx = f.fx, cvz = f.fz;
      const tk = tone(cvx, cvz, 0x6b5);
      const top = function (x, z) {
        const k = tk * (0.97 + 0.06 * wh(x, z, 0x6b3));
        return V(x, base(x, z) + CURB, z, (x - zn.x0) / 2, (z - zn.z0) / 2, k, k * 0.99, k * 0.97);
      };
      const cV = top(cvx, cvz);
      for (let k = 0; k < ring.length; k++) {
        const A = ring[k], B = ring[(k + 1) % ring.length];
        walkA.tri(cV, top(A[0], A[1]), top(B[0], B[1]), 0, 1, 0);
        // edge face: outward normal, classify just outside
        const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
        let nx = B[1] - A[1], nz = -(B[0] - A[0]);
        const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
        if ((mx - cvx) * nx + (mz - cvz) * nz < 0) { nx = -nx; nz = -nz; }
        const kind = faceKind(mx + nx * 0.05, mz + nz * 0.05);
        if (!kind) continue;
        face(A[0], A[1], base(A[0], A[1]) + CURB, B[0], B[1], base(B[0], B[1]) + CURB, nx, nz, kind, k * 0.3);
      }
    }
    for (const zn of Z.zones) { if (zn.fillet) buildFilletZone(zn); else buildRectZone(zn); }

    /* ---------------- PAINT + DECALS (one mesh) ---------------- */
    const decA = new Acc();
    const WHITE = [0.56, 0.56, 0.54], YELLOW = [0.56, 0.36, 0.035];
    const DN = 4;
    function decalQuad(p, t0, t1, o0, o1, cell, col, lift) {
      // a road-aligned quad in piece coords; uv spans the cell
      const mk = function (t, off, u, v) {
        const x = px(p, t, off), z = pz(p, t, off);
        cellUV(cell, DN, (u - 0.5) * 0.94, (v - 0.5) * 0.94, 1, 1, uvT);
        return V(x, surfY(x, z) + (lift || 0.006), z, uvT[0], uvT[1], col[0], col[1], col[2]);
      };
      decA.quad(mk(t0, o0, 0, 0), mk(t0, o1, 1, 0), mk(t1, o1, 1, 1), mk(t1, o0, 0, 1), 0, 1, 0);
    }
    function line(p, t0, t1, off, w, col) {        // split into <= 3 m quads
      const n = Math.max(1, Math.ceil((t1 - t0) / 3));
      for (let k = 0; k < n; k++) decalQuad(p, t0 + (t1 - t0) * k / n, t0 + (t1 - t0) * (k + 1) / n, off - w / 2, off + w / 2, 0, col);
    }
    function spot(x, z, size, ang, cell, col, sx, sz) {   // rotated world-space square
      const ca = Math.cos(ang), sa = Math.sin(ang), hx = (sx || size) / 2, hz = (sz || size) / 2;
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) {
        const lx = q[0] * hx, lz = q[1] * hz, wx = x + lx * ca - lz * sa, wz = z + lx * sa + lz * ca;
        cellUV(cell, DN, q[0] * 0.47, q[1] * 0.47, 1, 1, uvT);
        return V(wx, surfY(wx, wz) + 0.007, wz, uvT[0], uvT[1], col[0], col[1], col[2]);
      });
      decA.quad(c[0], c[1], c[2], c[3], 0, 1, 0);
    }
    function tj(p, end, dist) { return end === "A" ? p.a - HW + dist : p.b + HW - dist; }
    const furn = [];            // furniture requests
    const lights = [];
    let lightSide = 1;
    const inCut = function (x, z, grow) {
      const cuts = o.cuts || [];
      for (const c of cuts) if (x >= c.x0 - grow && x <= c.x1 + grow && z >= c.z0 - grow && z <= c.z1 + grow) return true;
      return false;
    };
    for (const p of P.pieces) {
      const len = p.b - p.a;
      // centre line: double yellow approaching each junction, broken elsewhere
      const dbl = [];
      if (p.jA) dbl.push([tj(p, "A", SB1), tj(p, "A", SB1 + DBL)]);
      if (p.jB) dbl.push([tj(p, "B", SB1 + DBL), tj(p, "B", SB1)]);
      const cA = p.jA ? tj(p, "A", SB1) : p.a + 1.5, cB = p.jB ? tj(p, "B", SB1) : p.b - 1.5;
      if (cB - cA > 1) {
        let solid = [];
        for (const d of dbl) solid.push([Math.max(cA, d[0]), Math.min(cB, d[1])]);
        solid = solid.filter(function (s) { return s[1] > s[0]; }).sort(function (x, y) { return x[0] - y[0]; });
        if (solid.length === 2 && solid[1][0] <= solid[0][1] + 3) solid = [[solid[0][0], Math.max(solid[0][1], solid[1][1])]];
        for (const s of solid) { line(p, s[0], s[1], -0.12, 0.1, YELLOW); line(p, s[0], s[1], 0.12, 0.1, YELLOW); }
        // broken: 3 m dash / 9 m gap through the open stretch(es)
        let open = [[cA, cB]];
        for (const s of solid) {
          const nx = [];
          for (const q of open) { if (s[1] <= q[0] || s[0] >= q[1]) nx.push(q); else { if (s[0] > q[0]) nx.push([q[0], s[0]]); if (s[1] < q[1]) nx.push([s[1], q[1]]); } }
          open = nx;
        }
        for (const q of open) {
          if (q[1] - q[0] < 4) continue;
          for (let t = q[0] + 1.5; t + 3 <= q[1] - 0.5; t += 12) line(p, t, t + 3, 0, 0.12, YELLOW);
        }
      }
      // white edge lines, stopping at the crosswalks
      const eA = p.jA ? tj(p, "A", CW1 + 0.3) : p.a + 0.8, eB = p.jB ? tj(p, "B", CW1 + 0.3) : p.b - 0.8;
      if (eB - eA > 1) { line(p, eA, eB, -EDGE_OFF, 0.12, WHITE); line(p, eA, eB, EDGE_OFF, 0.12, WHITE); }
      // junction mouths: crosswalk, stop bar / yield teeth, drain, signs
      for (const end of ["A", "B"]) {
        const jn = end === "A" ? p.jA : p.jB;
        if (!jn) continue;
        const sigmaIn = end === "A" ? -1 : 1;               // travel toward the junction
        const ls = laneSide(p, sigmaIn);                     // approach lane side
        // continental crosswalk: 6 bars parallel to traffic
        const c0 = tj(p, end, CW0), c1 = tj(p, end, CW1);
        for (let k = 0; k < 6; k++) {
          const oc = -2.625 + k * 1.05;
          decalQuad(p, Math.min(c0, c1), Math.max(c0, c1), oc - 0.25, oc + 0.25, 0, WHITE);
        }
        // tactile pads on both curb ramps
        for (const s of [-1, 1]) {
          const t0 = tj(p, end, CW0 + 0.1), t1 = tj(p, end, CW1 - 0.1);
          const mkT = function (t, off, u, v) {
            const x = px(p, t, off), z = pz(p, t, off);
            cellUV(7, DN, (u - 0.5) * 0.94, (v - 0.5) * 0.94, 1, 1, uvT);
            return V(x, surfY(x, z) + 0.006, z, uvT[0], uvT[1], 0.9, 0.9, 0.9);
          };
          decA.quad(mkT(Math.min(t0, t1), s * (HW + 0.02), 0, 0), mkT(Math.min(t0, t1), s * (HW + 0.62), 1, 0),
            mkT(Math.max(t0, t1), s * (HW + 0.62), 1, 1), mkT(Math.max(t0, t1), s * (HW + 0.02), 0, 1), 0, 1, 0);
        }
        const famLegs = p.vertical ? (jn.N ? 1 : 0) + (jn.S ? 1 : 0) : (jn.E ? 1 : 0) + (jn.W ? 1 : 0);
        const control = jn.n === 4 ? "stop" : (jn.n === 3 && famLegs === 1) ? "yield" : null;
        const lo0 = ls > 0 ? 0.2 : -2.9, lo1 = ls > 0 ? 2.9 : -0.2;
        if (control === "stop") {
          const s0 = tj(p, end, SB0), s1 = tj(p, end, SB1);
          decalQuad(p, Math.min(s0, s1), Math.max(s0, s1), lo0, lo1, 0, WHITE);
        } else if (control === "yield") {
          for (let k = 0; k < 4; k++) {
            const oc = ls * (0.55 + k * 0.72);
            const tb0 = tj(p, end, SB0), tap = tj(p, end, SB0 + 0.6);
            const mk = function (t, off, u, v) {
              const x = px(p, t, off), z = pz(p, t, off);
              cellUV(0, DN, (u - 0.5) * 0.94, (v - 0.5) * 0.94, 1, 1, uvT);
              return V(x, surfY(x, z) + 0.006, z, uvT[0], uvT[1], WHITE[0], WHITE[1], WHITE[2]);
            };
            decA.tri(mk(tb0, oc - 0.22, 0, 0), mk(tb0, oc + 0.22, 1, 0), mk(tap, oc, 0.5, 1), 0, 1, 0);
          }
        }
        // storm drain in the approach-side gutter + the inlet slot in the curb
        {
          const td = tj(p, end, 9.6), sgn = ls;
          const x = px(p, td, sgn * (HW - 0.18)), z = pz(p, td, sgn * (HW - 0.18));
          const along = Math.atan2(p.Az, p.Ax);
          spot(x, z, 0, along, 2, [0.9, 0.9, 0.9], 0.9, 0.34);
          const cx0 = px(p, td, sgn * (HW - 0.003)), cz0 = pz(p, td, sgn * (HW - 0.003));
          if (Z.walkAt(px(p, td, sgn * (HW + 0.05)), pz(p, td, sgn * (HW + 0.05))) >= CURB - 0.001) {
            const b0 = base(cx0, cz0);
            const xa = cx0 - p.Ax * 0.5, za = cz0 - p.Az * 0.5, xb = cx0 + p.Ax * 0.5, zb = cz0 + p.Az * 0.5;
            cellUV(4, DN, 0, 0, 1, 1, uvT);
            const u = uvT[0], v = uvT[1];
            decA.quad(V(xa, b0 + LIFT + 0.006, za, u, v, 1, 1, 1), V(xb, b0 + LIFT + 0.006, zb, u, v, 1, 1, 1),
              V(xb, b0 + 0.125, zb, u, v, 1, 1, 1), V(xa, b0 + 0.125, za, u, v, 1, 1, 1), -sgn * p.Cx, 0, -sgn * p.Cz);
          }
        }
        // the sign on the right-hand corner of the approach, facing it
        if (control) {
          const ts = tj(p, end, SB1 + 0.5), off = ls * 4.45;
          furn.push({ kind: control, x: px(p, ts, off), z: pz(p, ts, off), nx: -sigmaIn * p.Ax, nz: -sigmaIn * p.Az, allWay: control === "stop" });
        }
      }
      // manholes (one per block, in a lane) and oil stains where cars wait/park
      if (len > 14) {
        const h = wh(p.fixed, p.a, 0x3b1);
        const t = p.a + 7 + (len - 14) * h, off = (wh(p.fixed, p.a, 0x3b2) < 0.5 ? -1 : 1) * 1.75;
        spot(px(p, t, off), pz(p, t, off), 0.76, h * 6.28, 1, [0.95, 0.95, 0.95]);
        const nOil = Math.floor(len / 11);
        for (let k = 0; k < nOil; k++) {
          const tt = p.a + 6 + (len - 12) * wh(p.fixed + k, p.a, 0x3b3);
          if (Math.abs(tt - t) < 1.5) continue;
          const oo = (wh(p.fixed, tt, 0x3b4) < 0.5 ? -1 : 1) * (1.75 + (wh(p.fixed, tt, 0x3b5) - 0.5) * 0.7);
          const sz = 0.7 + wh(p.fixed, tt, 0x3b6) * 0.9;
          spot(px(p, tt, oo), pz(p, tt, oo), 0, wh(tt, p.fixed, 0x3b7) * 6.28, 3, [1, 1, 1], sz * 1.3, sz);
        }
      }
      // speed limit for traffic leaving the start of the piece
      if (len >= 24 && wh(p.fixed, p.a, 0x5e1) < 0.6) {
        const t = p.a + 11.5, off = laneSide(p, 1) * 4.45;
        const x = px(p, t, off), z = pz(p, t, off);
        if (!inCut(x, z, 1.2)) furn.push({ kind: "speed", x: x, z: z, nx: -p.Ax, nz: -p.Az });
      }
      // street lights, ~32 m apart, alternating sides
      const usable = len - 22;
      if (usable >= 0) {
        const n = 1 + Math.floor(usable / 30);
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? (p.a + p.b) / 2 : p.a + 11 + usable * k / (n - 1);
          let side = lightSide; lightSide = -lightSide;
          let x = px(p, t, side * 4.25), z = pz(p, t, side * 4.25);
          if (inCut(x, z, 1.5) || furn.some(function (f) { return Math.hypot(f.x - x, f.z - z) < 2.5; })) {
            side = -side; x = px(p, t, side * 4.25); z = pz(p, t, side * 4.25);
            if (inCut(x, z, 1.5) || furn.some(function (f) { return Math.hypot(f.x - x, f.z - z) < 2.5; })) continue;
          }
          lights.push({ p: p, t: t, side: side, x: x, z: z });
        }
      }
      // dead ends: a Type III barricade on the concrete return
      for (const end of ["A", "B"]) {
        if (end === "A" ? p.jA : p.jB) continue;
        const e = end === "A" ? p.a - 1.0 : p.b + 1.0;
        furn.push({ kind: "barricade", x: px(p, e, 0), z: pz(p, e, 0), nx: end === "A" ? p.Ax : -p.Ax, nz: end === "A" ? p.Az : -p.Az });
      }
    }

    /* ---------------- FURNITURE (signs, posts, poles) ---------------- */
    const furA = new Acc(), lensA = new Acc(), poolA = new Acc();
    const SN = 4;
    const STEEL = [0.3, 0.31, 0.32], DARK = [0.06, 0.065, 0.07], CONC = [0.24, 0.235, 0.225];
    function cellMid(i) { cellUV(i, SN, 0, 0, 1, 1, uvT); return [uvT[0], uvT[1]]; }
    // oriented box: centre, unit axis (dx,dz) in XZ, half extents along/side/up
    function obox(A, x, y, z, dx, dz, hl, hw, hh, cell, col) {
      const ex = -dz, ez = dx;
      const m = cellMid(cell);
      const P8 = function (a, s, u) { return [x + dx * a * hl + ex * s * hw, y + u * hh, z + dz * a * hl + ez * s * hw]; };
      const Vx = function (q) { return V(q[0], q[1], q[2], m[0], m[1], col[0], col[1], col[2]); };
      const F = [
        [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], dx, 0, dz],
        [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1], -dx, 0, -dz],
        [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1], ex, 0, ez],
        [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], -ex, 0, -ez],
        [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], 0, 1, 0],
        [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], 0, -1, 0],
      ];
      for (const f of F) {
        A.quad(Vx(P8.apply(null, f[0])), Vx(P8.apply(null, f[1])), Vx(P8.apply(null, f[2])), Vx(P8.apply(null, f[3])), f[4], f[5], f[6]);
      }
    }
    // a flat sign plate facing (nx, nz): local polygon pts (m), atlas cell
    function plate(cx0, cy0, cz0, nx, nz, pts, cell, mx, my) {
      const rx = nz, rz = -nx;                     // viewer's right
      const fr = function (q) {
        const x = cx0 + rx * q[0] + nx * 0.035, y = cy0 + q[1], z = cz0 + rz * q[0] + nz * 0.035;
        cellUV(cell, SN, q[0], q[1], mx, my, uvT);
        return V(x, y, z, uvT[0], uvT[1], 0.8, 0.8, 0.8);
      };
      const bm = cellMid(4);
      const bk = function (q) {
        return V(cx0 + rx * q[0] + nx * 0.025, cy0 + q[1], cz0 + rz * q[0] + nz * 0.025, bm[0], bm[1], 0.55, 0.56, 0.57);
      };
      const c = fr([0, 0]), cb = bk([0, 0]);
      for (let k = 0; k < pts.length; k++) {
        const A = pts[k], B = pts[(k + 1) % pts.length];
        furA.tri(c, fr(A), fr(B), nx, 0, nz);
        furA.tri(cb, bk(A), bk(B), -nx, 0, -nz);
      }
    }
    const OCT = [];
    for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; OCT.push([Math.cos(a) * 0.406, Math.sin(a) * 0.406]); }
    const TRI = [[-0.45, 0.39], [0.45, 0.39], [0, -0.39]];
    const RECT = function (w, h) { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; };
    let nSigns = 0;
    for (const f of furn) {
      const y0 = surfY(f.x, f.z);
      if (f.kind === "barricade") {
        const rx = f.nz, rz = -f.nx;
        for (const s of [-1, 1]) obox(furA, f.x + rx * s * 1.05, y0 + 0.8, f.z + rz * s * 1.05, f.nx, f.nz, 0.04, 0.04, 0.8, 5, [0.62, 0.62, 0.6]);
        for (const hy of [0.55, 1.0, 1.45]) {
          const rail = RECT(2.4, 0.2);
          plate(f.x, y0 + hy, f.z, f.nx, f.nz, rail, 6, 2.4, 0.2);
          plate(f.x, y0 + hy, f.z, -f.nx, -f.nz, rail, 6, 2.4, 0.2);
        }
        nSigns++;
        continue;
      }
      // galvanised 2 in square post, face centre ~2.4 m
      const top = f.kind === "stop" ? 2.55 : f.kind === "yield" ? 2.5 : 2.6;
      obox(furA, f.x, y0 + top / 2, f.z, f.nx, f.nz, 0.03, 0.03, top / 2, 5, STEEL);
      const cy0 = y0 + top - 0.45;
      if (f.kind === "stop") {
        plate(f.x, cy0, f.z, f.nx, f.nz, OCT, 0, SIGN_M[0], SIGN_M[0]);
        if (f.allWay) plate(f.x, cy0 - 0.56, f.z, f.nx, f.nz, RECT(0.45, 0.15), 3, SIGN_M[3], SIGN_M[3]);
      } else if (f.kind === "yield") {
        plate(f.x, cy0 + 0.05, f.z, f.nx, f.nz, TRI, 1, SIGN_M[1], SIGN_M[1]);
      } else if (f.kind === "speed") {
        plate(f.x, cy0 + 0.02, f.z, f.nx, f.nz, RECT(0.6, 0.75), 2, SIGN_M[2], SIGN_M[2]);
      }
      nSigns++;
    }
    // cobra-head poles: tapered hex shaft, footing, arm, head; lens + pool
    const POLE_H = 7.6, ARM = 2.0;
    const colliders = o.colliders;
    for (const L of lights) {
      const p = L.p, y0 = surfY(L.x, L.z);
      const dx = -L.side * p.Cx, dz = -L.side * p.Cz;          // toward the road
      obox(furA, L.x, y0 + 0.12, L.z, dx, dz, 0.2, 0.2, 0.14, 5, CONC);   // footing
      const SEG = 6;
      for (let k = 0; k < SEG; k++) {
        const a0 = k / SEG * Math.PI * 2, a1 = (k + 1) / SEG * Math.PI * 2, am = (a0 + a1) / 2;
        const r0 = 0.11, r1 = 0.065, yb = y0 + 0.26, yt = y0 + POLE_H;
        const m = cellMid(5);
        const q = function (a, r, y) { return V(L.x + Math.cos(a) * r, y, L.z + Math.sin(a) * r, m[0], m[1], STEEL[0], STEEL[1], STEEL[2]); };
        furA.quad(q(a0, r0, yb), q(a1, r0, yb), q(a1, r1, yt), q(a0, r1, yt), Math.cos(am), 0.05, Math.sin(am));
      }
      obox(furA, L.x, y0 + POLE_H + 0.02, L.z, dx, dz, 0.09, 0.09, 0.08, 5, STEEL);     // cap
      obox(furA, L.x + dx * ARM / 2, y0 + POLE_H - 0.05, L.z + dz * ARM / 2, dx, dz, ARM / 2, 0.045, 0.045, 5, STEEL);
      const hx = L.x + dx * (ARM + 0.2), hz = L.z + dz * (ARM + 0.2), hy = y0 + POLE_H - 0.1;
      obox(furA, hx, hy, hz, dx, dz, 0.38, 0.17, 0.075, 5, DARK);
      // lens (faces down)
      const ex = -dz, ez = dx, ly = hy - 0.075 - 0.004;
      const lv = function (a, s) { return V(hx + dx * a * 0.3 + ex * s * 0.13, ly, hz + dz * a * 0.3 + ez * s * 0.13, 0, 0, 1, 1, 1); };
      lensA.quad(lv(-1, -1), lv(1, -1), lv(1, 1), lv(-1, 1), 0, -1, 0);
      // pool on the ground under the head: road part + sidewalk part
      const tC = L.t, oC = L.side * (4.25 - ARM - 0.2);
      const RAD = 4.6;
      const tRows = [tC - RAD, tC - RAD / 3, tC + RAD / 3, tC + RAD];
      const clampHW = function (v) { return Math.max(-HW + 0.001, Math.min(HW - 0.001, v)); };
      const far = oC - L.side * RAD;               // the pool's edge across the road
      const rc = [clampHW(far), clampHW((far + oC) / 2), oC, L.side * (HW - 0.001)].sort(function (a, b) { return a - b; });
      const wc = [L.side * (HW + 0.001), L.side * (HW + RAMP), L.side * WALK].sort(function (a, b) { return a - b; });
      const pv = function (t, off) {
        const x = px(p, t, off), z = pz(p, t, off);
        const lx = (off - oC), lz = (t - tC);
        cellUV(5, DN, lx, lz, RAD * 2 / 0.92, RAD * 2 / 0.92, uvT);
        return V(x, surfY(x, z) + 0.014, z, uvT[0], uvT[1], 1, 1, 1);
      };
      for (const cols of [rc, wc]) {
        for (let r = 0; r < tRows.length - 1; r++) for (let c = 0; c < cols.length - 1; c++) {
          poolA.quad(pv(tRows[r], cols[c]), pv(tRows[r], cols[c + 1]), pv(tRows[r + 1], cols[c + 1]), pv(tRows[r + 1], cols[c]), 0, 1, 0);
        }
      }
      if (colliders) colliders.push({ minX: L.x - 0.14, maxX: L.x + 0.14, minZ: L.z - 0.14, maxZ: L.z + 0.14, y0: y0 - 0.2, y1: y0 + POLE_H, ref: null, noCam: true });
    }

    /* ---------------- MATERIALS + MESHES ---------------- */
    const roadTex = bakeRoad(THREE, lo, o.renderer), juncTex = bakeJunction(THREE, lo, o.renderer);
    const walkTex = bakeWalk(THREE, lo, o.renderer), decTex = bakeDecals(THREE, lo, o.renderer), signTex = bakeSigns(THREE, lo, o.renderer);
    const lam = function (map, extra) {
      const m = new THREE.MeshLambertMaterial(Object.assign({ color: 0xffffff, vertexColors: true }, extra || {}));
      if (map) m.map = map;
      else m.color.setRGB(0.05, 0.05, 0.052);     // no canvas (headless): plain asphalt tone
      return m;
    };
    const roadMat = lam(roadTex); roadMat.name = "survival-asphalt";
    const juncMat = lam(juncTex); juncMat.name = "survival-asphalt-junction";
    const walkMat = lam(walkTex); walkMat.name = "survival-sidewalk";
    if (!walkTex) walkMat.color.setRGB(0.2, 0.2, 0.19);
    const decMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (decTex) decMat.map = decTex; else decMat.opacity = 0.9;
    decMat.name = "survival-road-paint";
    const furMat = lam(signTex); furMat.name = "survival-street-furniture";
    if (!signTex) furMat.color.setRGB(0.4, 0.4, 0.4);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lensMat.color.setRGB(0.3, 0.3, 0.29); lensMat.name = "survival-streetlight-lens";
    const poolMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    if (decTex) poolMat.map = decTex;
    poolMat.color.setRGB(1.0, 0.72, 0.42); poolMat.name = "survival-streetlight-pool";

    const meshes = {};
    function add(name, acc, mat, setup) {
      const g = acc.geo(THREE);
      if (!g) return null;
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.userData.dynamic = true;             // never batch-merged (own maps / live materials)
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (setup) setup(m);
      o.root.add(m);
      meshes[name] = m;
      return m;
    }
    add("survival-roads", roadA, roadMat, function (m) { m.receiveShadow = true; });
    add("survival-junctions", juncA, juncMat, function (m) { m.receiveShadow = true; });
    add("survival-sidewalks", walkA, walkMat, function (m) { m.receiveShadow = true; });
    add("survival-road-paint", decA, decMat, function (m) { m.renderOrder = 1; m.userData.roadPaint = true; m.receiveShadow = true; });
    add("survival-street-furniture", furA, furMat, function (m) { m.castShadow = true; m.receiveShadow = true; });
    const lensMesh = add("survival-streetlight-lens", lensA, lensMat, function (m) { m.userData.roadPaint = true; m.userData.noCoat = true; });
    const poolMesh = add("survival-streetlight-pools", poolA, poolMat, function (m) { m.renderOrder = 2; m.visible = false; m.userData.roadPaint = true; });

    // night: lenses glow, pools fade in. One colour + one opacity per frame.
    let lastK = -1;
    function night(n) {
      const k = clamp01((n - 0.3) / 0.4);
      if (Math.abs(k - lastK) < 0.003) return;
      lastK = k;
      lensMat.color.setRGB(0.3 + 0.75 * k, 0.3 + 0.6 * k, 0.29 + 0.36 * k);
      poolMat.opacity = 0.5 * k;
      if (poolMesh) poolMesh.visible = k > 0.01;
    }
    if (o.onUpdate) o.onUpdate(48.3, function () {
      if (o.modeOn && !o.modeOn()) return;
      // the island's light is pinned to a clear day by survival.js, so the
      // clock's nightAmount would switch lamps on at noon: ask how dark the
      // scene actually is (storms, ash, the nuke's winter light them up)
      night(CBZ.lightsOnAmount ? CBZ.lightsOnAmount() : (CBZ.nightAmount || 0));
    });
    void lensMesh;

    const stats = {
      pieces: P.pieces.length, junctions: P.junctions.length,
      fourWay: P.junctions.filter(function (j) { return j.n === 4; }).length,
      tee: P.junctions.filter(function (j) { return j.n === 3; }).length,
      deadEnds: P.pieces.reduce(function (s, p) { return s + (p.jA ? 0 : 1) + (p.jB ? 0 : 1); }, 0),
      signs: nSigns, lights: lights.length, zones: Z.zones.length,
      verts: { road: roadA.count(), junc: juncA.count(), walk: walkA.count(), paint: decA.count(), furniture: furA.count(), pools: poolA.count() },
      draws: Object.keys(meshes).length,
    };
    return { surfaceHeightAt: surfaceHeightAt, walkAt: Z.walkAt, meshes: meshes, stats: stats, night: night };
  }

  CBZ.islandRoadKit = {
    plan: plan, build: build, makeZones: makeZones,
    bakeRoad: bakeRoad, bakeJunction: bakeJunction, bakeWalk: bakeWalk, bakeDecals: bakeDecals, bakeSigns: bakeSigns,
    C: { HW: HW, WALK: WALK, GUT: GUT, LIFT: LIFT, CURB: CURB, RAMP: RAMP, APP: APP },
  };
})();
