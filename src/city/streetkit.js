/* ============================================================
   city/streetkit.js — THE DOWNTOWN STREET, BUILT AS ONE THING.

   The grid used to be a stack of layers patching each other: a checker
   ground plane, avenue asphalt at y 0.040 and cross streets at 0.065
   OVERLAPPING at all 49 junctions, 36 flat beige sidewalk planes, kerb
   BOXES standing 14 cm proud of the footway, hundreds of decal meshes,
   and props.js painting a flat fan of untextured asphalt over the square
   block corners and trimming the kerb boxes by matching their geometry
   signature. Read at street level it was a diorama.

   This file replaces all of it with ONE cross-section, solved once and
   used by BOTH the renderer and physics:

        lot pad    footway          kerb   gutter   carriageway
        0.125  /‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾|  pan  ______________ 0.05
               back slope   granite    |0.13 face
                            top 0.30   |0.45 concrete pan (road shader)

   - ONE road surface: strips between junctions plus one junction piece per
     crossing whose four corners are the kerb-return arcs, at ONE height.
     Nothing overlaps anything, anywhere. The piece is built in polar rings
     around each arc centre, so the gutter band follows the curve exactly.
   - Blocks with ROUNDED corners (the radius roadrules.js solves), a real
     kerb (vertical face + granite top band), scored concrete footway,
     pedestrian KERB RAMPS with tactile warning pads at every crosswalk
     landing, and flared DRIVEWAY aprons at every approach.js crossing.
   - heightAt(x,z) is the analytic surface every vertex above was sampled
     from, so the player, peds and cars stand exactly on what is drawn:
     they step up the kerb, walk down the ramps, roll over the apron.
   - US MUTCD markings (double yellow, 3 m / 9 m lane dashes, solid lane
     lines into the stop bar, edge lines, 0.6 m stop bars behind
     continental crosswalks, real arrow polygons, parking T-marks), one
     merged mesh per colour; ironwork and grime merged; all hash-seeded.

   Draw calls for the whole grid street layer: road+apron 1, footway 1,
   kerb 1, tactile 1, paint 2, ironwork 1, grime 1 (+ lot pads and the
   avenue medians, built by world.js).

   CBZ.streetKit.build(ctx) is called by city/world.js; see there for ctx.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- THE CROSS-SECTION (metres). One table; everything reads it. ----
  const P = {
    yRoad: 0.05,        // carriageway top (carlamps.js decals at 0.08 stay above it)
    yWalk: 0.18,        // footway / kerb top: a 13 cm kerb face over the gutter
    yLot: 0.125,        // lot pad: under buildings.js's 0.14 foundation slab top
    kerbTop: 0.30,      // granite kerb top band
    gutter: 0.45,       // concrete gutter pan (drawn by the asphalt shader)
    backRun: 0.40,      // the footway's back edge eases down to the lot pad
    rampLip: 0.013,     // a dropped kerb keeps a 13 mm lip
    rampRun: 1.40,      // 0.117 m over 1.4 m = 8.3 %, the ADA maximum
    driveLip: 0.02,
    driveRun: 1.0,
    flare: 0.6,         // ramp flares along the kerb
    tactile: 0.61,      // detectable warning pad depth (24 in)
    skirt: 1.2,         // grid edge: road eases down to the harbour apron
    apron: 29,          // harbour apron out to the seawall line
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hsh(x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    let h = (Math.round(x * 16) * 374761393 + Math.round(z * 16) * 668265263 + salt * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ==================================================================
     GEOMETRY SOLVE — pure math, no THREE. Exposed for node checks.
     ================================================================== */
  function solve(ctx) {
    const X = ctx.xLines, Z = ctx.zLines, N = X.length - 1;
    const ROAD = ctx.ROAD, BLK = ctx.BLK, step = BLK + ROAD;
    const h = ROAD / 2, H = BLK / 2, L = ctx.lotHalf != null ? ctx.lotHalf : H - 2, FW = H - L;
    // The arc centre must sit inside the lot square or the corner geometry
    // below (rays from the arc centre) would not cover the footway.
    const R = clamp(ctx.cornerR != null ? ctx.cornerR : 4.8, FW + 0.5, h);
    const S = h + R;
    const laneW = ctx.laneW || 3.6, nL = ctx.lanesPerDir || 2;
    const medHalf = (ctx.aveMedian || 0) / 2;
    const isAve = ctx.isAvenue || function () { return false; };
    const near = h + 0.6, xw = clamp(0.16 * ROAD, 1.8, 3.0);
    const cw0 = near, cw1 = near + xw, stop0 = cw1 + 1.2, stop1 = stop0 + 0.6;
    const minX = X[0] - h, maxX = X[N] + h, minZ = Z[0] - h, maxZ = Z[N] + h;
    const KT = P.kerbTop;
    const fa = P.flare / R;                                   // flare, radians of arc

    // crosswalk landing ranges on a corner arc (alpha from the road-A kerb)
    const aA0 = Math.asin(clamp((S - cw1) / R, 0, 1)), aA1 = Math.asin(clamp((S - cw0) / R, 0, 1));
    const aB0 = Math.acos(clamp((S - cw0) / R, 0, 1)), aB1 = Math.acos(clamp((S - cw1) / R, 0, 1));

    // the shared arc parameter list: uniform 6 deg plus every breakpoint the
    // road, the kerb, the ramps and the lot corner need. Road rings and kerb
    // stations use the SAME table, so the kerb line and the road edge are
    // the same polyline.
    const HALF = Math.PI / 2, QTR = Math.PI / 4;
    const BP = [QTR, aA0, aA1, aB0, aB1, aA0 - fa, aA1 + fa, aB0 - fa, aB1 + fa]
      .filter(function (a) { return a > 0.01 && a < HALF - 0.01; });
    const al = [0, HALF].concat(BP);
    for (let k = 1; k < 15; k++) {
      const a = k * HALF / 15;
      if (al.every(function (b) { return Math.abs(a - b) >= 0.02; })) al.push(a);
    }
    al.sort(function (a, b) { return a - b; });
    const ALPHA = [];
    for (let k = 0; k < al.length; k++) if (!ALPHA.length || al[k] - ALPHA[ALPHA.length - 1] > 1e-9) ALPHA.push(al[k]);
    ALPHA[0] = 0; ALPHA[ALPHA.length - 1] = HALF;
    const CA = ALPHA.map(Math.cos), SA = ALPHA.map(Math.sin);
    CA[0] = 1; SA[0] = 0; CA[CA.length - 1] = 0; SA[SA.length - 1] = 1;
    let K45 = ALPHA.indexOf(QTR);
    if (K45 < 0) { K45 = 0; let bd = 9; ALPHA.forEach(function (a, k) { if (Math.abs(a - QTR) < bd) { bd = Math.abs(a - QTR); K45 = k; } }); ALPHA[K45] = QTR; }
    CA[K45] = SA[K45] = Math.SQRT1_2;

    // ring e-samples (metres from the kerb) along every ray; the last one is
    // the junction centre-line. 8.65 = the avenue median edge.
    const E = [0, 0.15, P.gutter, 0.8, 1.4, 2.4, 3.9, 5.6, 7.3].concat(medHalf > 0.05 ? [h - medHalf] : [], [h]);
    const ELAST = S - R;

    function cwA(i, j, sz) { return (sz > 0 ? j < N : j > 0) && i > 0 && i < N; }
    function cwB(i, j, sx) { return (sx > 0 ? i < N : i > 0) && j > 0 && j < N; }
    function legA(j, sz) { return sz > 0 ? j < N : j > 0; }
    function legB(i, sx) { return sx > 0 ? i < N : i > 0; }
    function blockAt(i, j, sx, sz) {           // the block in quadrant (sx,sz) of junction (i,j)
      const bi = sx > 0 ? i : i - 1, bj = sz > 0 ? j : j - 1;
      return (bi >= 0 && bi < N && bj >= 0 && bj < N) ? { bi: bi, bj: bj } : null;
    }
    // drop ranges on each corner (junction i,j quadrant sx,sz), merged
    const cornerDrops = new Map();
    function ckey(i, j, sx, sz) { return i * 4096 + j * 4 + (sx > 0 ? 2 : 0) + (sz > 0 ? 1 : 0); }
    function mergeRanges(rs) {
      rs.sort(function (a, b) { return a[0] - b[0]; });
      const out = [];
      for (const r of rs) {
        if (out.length && r[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
        else out.push([r[0], r[1]]);
      }
      return out;
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
        if (!blockAt(i, j, sx, sz)) continue;
        const rs = [];
        if (cwA(i, j, sz)) rs.push([aA0, aA1]);
        if (cwB(i, j, sx)) rs.push([aB0, aB1]);
        if (rs.length) cornerDrops.set(ckey(i, j, sx, sz), mergeRanges(rs));
      }
    }
    function dropCorner(rs, a) {
      let d = 0;
      for (let k = 0; k < rs.length; k++) {
        const r = rs[k];
        if (a >= r[0] && a <= r[1]) return 1;
        const dist = a < r[0] ? r[0] - a : a - r[1];
        d = Math.max(d, 1 - sstep(dist / fa));
      }
      return d;
    }
    // driveways: one per block at most, from approach.js
    const drives = ctx.driveways || [];
    function profile(d, delta, lip, run) {
      const drop = delta * (P.yWalk - P.yRoad - lip);
      const k = d <= KT ? 1 : Math.max(0, 1 - (d - KT) / run);
      return P.yWalk - drop * k;
    }

    // ---- THE SURFACE. Every street vertex is sampled from this, and so is
    //      the city floor. Returns null off the grid (caller falls back).
    const out = { region: -1, d: 0 };
    function probe(x, z) {
      if (x < minX || x > maxX || z < minZ || z > maxZ) {
        const dOut = Math.max(minX - x, x - maxX, minZ - z, z - maxZ);
        out.region = -1;
        return dOut < P.skirt ? P.yRoad * (1 - dOut / P.skirt) : null;
      }
      let bi = Math.floor((x - X[0]) / step), bj = Math.floor((z - Z[0]) / step);
      if (bi < 0) bi = 0; else if (bi > N - 1) bi = N - 1;
      if (bj < 0) bj = 0; else if (bj > N - 1) bj = N - 1;
      const px = x - (X[bi] + X[bi + 1]) * 0.5, pz = z - (Z[bj] + Z[bj + 1]) * 0.5;
      const ax = px < 0 ? -px : px, az = pz < 0 ? -pz : pz;
      const kk = H - R, qx = ax - kk, qz = az - kk;
      let sd, corner = false;
      if (qx > 0 && qz > 0) { sd = Math.sqrt(qx * qx + qz * qz) - R; corner = true; }
      else sd = (ax > az ? ax : az) - H;
      if (sd > 0) { out.region = 0; return P.yRoad; }
      const d = -sd;
      out.d = d;
      const ox = ax - L, oz = az - L;
      const dl = (ox > 0 && oz > 0) ? Math.sqrt(ox * ox + oz * oz) : (ox > oz ? ox : oz);
      if (dl <= 0) { out.region = 2; return P.yLot; }
      out.region = 1;
      let y = P.yLot + (P.yWalk - P.yLot) * sstep(dl / P.backRun);
      if (corner) {
        const ji = bi + (px > 0 ? 1 : 0), jj = bj + (pz > 0 ? 1 : 0);
        const rs = cornerDrops.get(ckey(ji, jj, px > 0 ? -1 : 1, pz > 0 ? -1 : 1));
        if (rs) {
          const dl2 = dropCorner(rs, Math.atan2(qz, qx));
          if (dl2 > 0) { const f = profile(d, dl2, P.rampLip, P.rampRun); if (f < y) y = f; }
        }
      } else {
        const dv = drives[bi * N + bj];
        if (dv) {
          let face, along;
          if (ax >= az) { face = px > 0 ? "x+" : "x-"; along = z; } else { face = pz > 0 ? "z+" : "z-"; along = x; }
          if (face === dv.face) {
            const dist = Math.abs(along - dv.at) - dv.half;
            const delta = dist <= 0 ? 1 : 1 - sstep(dist / dv.flare);
            if (delta > 0) { const f = profile(d, delta, P.driveLip, P.driveRun); if (f < y) y = f; }
          }
        }
      }
      return y;
    }
    function heightAt(x, z) { return probe(x, z); }
    function regionAt(x, z) { probe(x, z); return out.region; }
    // distance from a road point to the nearest kerb line (build time only)
    function kerbDist(x, z) {
      const ci = Math.floor((x - X[0]) / step), cj = Math.floor((z - Z[0]) / step);
      let best = 99;
      for (let bi = ci - 1; bi <= ci + 1; bi++) for (let bj = cj - 1; bj <= cj + 1; bj++) {
        if (bi < 0 || bj < 0 || bi >= N || bj >= N) continue;
        const px = Math.abs(x - (X[bi] + X[bi + 1]) * 0.5), pz = Math.abs(z - (Z[bj] + Z[bj + 1]) * 0.5);
        const qx = px - (H - R), qz = pz - (H - R);
        const sd = (qx > 0 && qz > 0) ? Math.sqrt(qx * qx + qz * qz) - R : Math.max(px, pz) - H;
        if (sd < best) best = sd;
      }
      return Math.max(0, best);
    }

    return {
      X: X, Z: Z, N: N, ROAD: ROAD, BLK: BLK, step: step, h: h, H: H, L: L, FW: FW, R: R, S: S,
      laneW: laneW, nL: nL, medHalf: medHalf, isAve: isAve,
      cw0: cw0, cw1: cw1, stop0: stop0, stop1: stop1,
      minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
      ALPHA: ALPHA, CA: CA, SA: SA, K45: K45, E: E, ELAST: ELAST, fa: fa,
      aA0: aA0, aA1: aA1, aB0: aB0, aB1: aB1,
      cwA: cwA, cwB: cwB, legA: legA, legB: legB, blockAt: blockAt,
      cornerDrops: cornerDrops, ckey: ckey, dropCorner: dropCorner, drives: drives,
      heightAt: heightAt, regionAt: regionAt, kerbDist: kerbDist,
    };
  }

  /* ==================================================================
     MESH ACCUMULATOR — flat arrays, winding solved per triangle.
     ================================================================== */
  function Acc(opts) {
    this.pos = []; this.uv = []; this.col = opts && opts.color ? [] : null;
    this.lane = opts && opts.lane ? [] : null;
    this.nrm = opts && opts.normals ? [] : null;
    this.idx = [];
  }
  Acc.prototype.v = function (x, y, z, u, v, c, lane, n) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z); this.uv.push(u, v);
    if (this.col) this.col.push(c == null ? 1 : c, c == null ? 1 : c, c == null ? 1 : c);
    if (this.lane) { if (lane) this.lane.push(lane[0], lane[1], lane[2]); else this.lane.push(0, 99, 0); }
    if (this.nrm) { if (n) this.nrm.push(n[0], n[1], n[2]); else this.nrm.push(0, 1, 0); }
    return i;
  };
  // triangle facing `up` (+y) or, for vertical faces, facing (nx,nz)
  Acc.prototype.t = function (a, b, c, nx, ny, nz) {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    if (wx * wx + wy * wy + wz * wz < 1e-14) return;         // degenerate (zero-width dup station)
    const dot = nx == null ? wy : wx * nx + wy * (ny || 0) + wz * nz;
    if (dot < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  };
  Acc.prototype.q = function (a, b, c, d, nx, ny, nz) { this.t(a, b, c, nx, ny, nz); this.t(a, c, d, nx, ny, nz); };
  Acc.prototype.geo = function (THREE, computeNormals) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    if (this.col) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.col), 3));
    if (this.lane) g.setAttribute("asphaltLane", new THREE.BufferAttribute(new Float32Array(this.lane), 3));
    const n = this.pos.length / 3;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    if (this.nrm && !computeNormals) g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    else g.computeVertexNormals();
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };

  /* ==================================================================
     TEXTURES — small sRGB canvases, deterministic.
     ================================================================== */
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function texOf(THREE, c, wrap) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;      // authored sRGB: decode it
    try { if (CBZ.renderer && CBZ.renderer.capabilities) t.anisotropy = Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    return t;
  }
  function lcg(seed) { let s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function speckle(g, w, h, n, rnd, base, amp, size) {
    for (let i = 0; i < n; i++) {
      const v = base + (rnd() - 0.5) * amp;
      g.fillStyle = "rgb(" + v + "," + v + "," + (v - 3) + ")";
      g.globalAlpha = 0.25 + rnd() * 0.5;
      g.fillRect(rnd() * w, rnd() * h, size, size);
    }
    g.globalAlpha = 1;
  }
  // footway: 4 slabs of 1.5 m along u (6 m period), one slab across v
  function footwayCanvas() {
    const c = canvas(512, 128), g = c.getContext("2d"), rnd = lcg(71);
    const tones = [150, 143, 156, 146];
    for (let s = 0; s < 4; s++) {
      const t = tones[s];
      g.fillStyle = "rgb(" + t + "," + (t - 2) + "," + (t - 7) + ")";
      g.fillRect(s * 128, 0, 128, 128);
      // trowel mottle
      for (let i = 0; i < 26; i++) {
        g.globalAlpha = 0.05 + rnd() * 0.06;
        g.fillStyle = rnd() < 0.5 ? "#6f6a62" : "#c4bfb4";
        const r = 8 + rnd() * 26;
        g.beginPath(); g.arc(s * 128 + rnd() * 128, rnd() * 128, r, 0, 6.3); g.fill();
      }
      g.globalAlpha = 1;
    }
    speckle(g, 512, 128, 2600, rnd, 128, 70, 1.5);
    // a hairline crack in one slab, gum spots in another
    g.strokeStyle = "rgba(70,66,60,0.55)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(290, 8); g.lineTo(304, 44); g.lineTo(298, 80); g.lineTo(312, 122); g.stroke();
    g.fillStyle = "rgba(60,58,56,0.35)";
    for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(20 + rnd() * 100, 20 + rnd() * 90, 1.5 + rnd() * 2, 0, 6.3); g.fill(); }
    // tooled joints between the 1.5 m slabs, with the trowelled edge beside them
    for (let s = 0; s <= 4; s++) {
      const x = s * 128;
      g.fillStyle = "rgba(78,74,68,0.95)"; g.fillRect(x - 2, 0, 4, 128);
      g.fillStyle = "rgba(190,186,178,0.5)"; g.fillRect(x + 2, 0, 1, 128);
    }
    return c;
  }
  // plaza: 2 x 2 big slabs (3 m) with joints on the tile edges
  function plazaCanvas() {
    const c = canvas(256, 256), g = c.getContext("2d"), rnd = lcg(113);
    const tones = [[152, 150, 146], [146, 144, 141], [157, 154, 148], [149, 147, 143]];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const t = tones[i * 2 + j];
      g.fillStyle = "rgb(" + t[0] + "," + t[1] + "," + t[2] + ")"; g.fillRect(i * 128, j * 128, 128, 128);
    }
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.04 + rnd() * 0.05; g.fillStyle = rnd() < 0.5 ? "#6f6a62" : "#cfc9be";
      g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 10 + rnd() * 30, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;
    speckle(g, 256, 256, 2600, rnd, 130, 70, 1.4);
    g.fillStyle = "rgba(80,76,70,0.9)";
    for (let k = 0; k <= 2; k++) { g.fillRect(k * 128 - 2, 0, 3, 256); g.fillRect(0, k * 128 - 2, 256, 3); }
    return c;
  }
  // kerb: top half = granite top (v 0..0.5), bottom half = sawn face; 4 x 1 m stones
  function kerbCanvas() {
    const c = canvas(256, 128), g = c.getContext("2d"), rnd = lcg(29);
    for (let s = 0; s < 4; s++) {
      const t = 166 + ((s * 37) % 11) - 5;
      g.fillStyle = "rgb(" + t + "," + t + "," + (t - 4) + ")"; g.fillRect(s * 64, 0, 64, 64);
      const f = t - 16;
      g.fillStyle = "rgb(" + f + "," + (f - 1) + "," + (f - 5) + ")"; g.fillRect(s * 64, 64, 64, 64);
    }
    speckle(g, 256, 128, 2400, rnd, 140, 110, 1.2);
    // road grime on the lower face, tyre scuffs on the arris
    const gr = g.createLinearGradient(0, 64, 0, 128);
    gr.addColorStop(0, "rgba(40,38,36,0)"); gr.addColorStop(0.55, "rgba(40,38,36,0.18)"); gr.addColorStop(1, "rgba(28,27,26,0.55)");
    g.fillStyle = gr; g.fillRect(0, 64, 256, 64);
    g.fillStyle = "rgba(30,30,30,0.25)";
    for (let i = 0; i < 9; i++) g.fillRect(rnd() * 256, 58 + rnd() * 10, 6 + rnd() * 20, 2);
    g.fillStyle = "rgba(70,66,60,0.9)";
    for (let s = 0; s <= 4; s++) g.fillRect(s * 64 - 1, 0, 2, 128);
    g.fillStyle = "rgba(210,208,200,0.35)"; g.fillRect(0, 60, 256, 3);     // worn arris
    return c;
  }
  // tactile truncated domes on federal yellow, 6 x 6 per tile (0.36 m)
  function tactileCanvas() {
    const c = canvas(128, 128), g = c.getContext("2d");
    g.fillStyle = "rgb(206,160,34)"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const x = 10.67 + i * 21.33, y = 10.67 + j * 21.33;
      const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
      gr.addColorStop(0, "rgb(236,196,70)"); gr.addColorStop(0.7, "rgb(214,168,40)"); gr.addColorStop(1, "rgb(150,112,20)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 7.5, 0, 6.3); g.fill();
    }
    const rnd = lcg(5);
    for (let i = 0; i < 400; i++) { g.fillStyle = "rgba(60,50,30," + (0.05 + rnd() * 0.12) + ")"; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    return c;
  }
  // ironwork atlas: left = manhole, right = valve cover
  function ironCanvas() {
    const c = canvas(256, 128), g = c.getContext("2d"), rnd = lcg(9);
    g.fillStyle = "rgb(58,56,54)"; g.fillRect(0, 0, 256, 128);
    // manhole: rim ring, raised concentric rings + radial ribs, polished tops
    const cx = 64, cy = 64;
    g.fillStyle = "rgb(84,82,78)"; g.beginPath(); g.arc(cx, cy, 63, 0, 6.3); g.fill();
    g.fillStyle = "rgb(40,39,38)"; g.beginPath(); g.arc(cx, cy, 57, 0, 6.3); g.fill();
    g.fillStyle = "rgb(62,60,57)"; g.beginPath(); g.arc(cx, cy, 55, 0, 6.3); g.fill();
    g.strokeStyle = "rgb(96,93,88)"; g.lineWidth = 3;
    for (const r of [12, 24, 36, 48]) { g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.stroke(); }
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); g.stroke();
    }
    g.fillStyle = "rgb(34,33,32)"; g.fillRect(cx - 7, cy - 2, 14, 4);      // pick hole
    // valve cover
    const vx = 192, vy = 64;
    g.fillStyle = "rgb(88,84,78)"; g.beginPath(); g.arc(vx, vy, 62, 0, 6.3); g.fill();
    g.fillStyle = "rgb(52,50,47)"; g.beginPath(); g.arc(vx, vy, 52, 0, 6.3); g.fill();
    g.strokeStyle = "rgb(92,88,82)"; g.lineWidth = 4;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(vx - 44, vy + k * 12); g.lineTo(vx + 44, vy + k * 12); g.stroke(); }
    // rust and wear
    for (let i = 0; i < 700; i++) {
      g.fillStyle = rnd() < 0.3 ? "rgba(110,62,30," + (0.1 + rnd() * 0.2) + ")" : "rgba(20,20,20," + (0.08 + rnd() * 0.15) + ")";
      g.fillRect(rnd() * 256, rnd() * 128, 2, 2);
    }
    return c;
  }
  // grime (multiplicative): left = oil blot, right = tyre streak. White = no change.
  function grimeCanvas() {
    const c = canvas(256, 128), g = c.getContext("2d"), rnd = lcg(333);
    g.fillStyle = "#fff"; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 9; i++) {
      const x = 64 + (rnd() - 0.5) * 50, y = 64 + (rnd() - 0.5) * 50, r = 14 + rnd() * 26;
      const gr = g.createRadialGradient(x, y, 1, x, y, r);
      gr.addColorStop(0, "rgba(90,90,96,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
    }
    g.fillStyle = "#fff"; g.fillRect(126, 0, 4, 128);
    for (let k = 0; k < 3; k++) {
      const gr = g.createLinearGradient(130, 0, 256, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(70,70,74,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(130, k * 40 + 4, 126, 36);
    }
    const fade = g.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, "rgba(255,255,255,0.9)"); fade.addColorStop(0.25, "rgba(255,255,255,0)"); fade.addColorStop(0.75, "rgba(255,255,255,0)"); fade.addColorStop(1, "rgba(255,255,255,0.9)");
    g.fillStyle = fade; g.fillRect(130, 0, 126, 128);
    return c;
  }

  /* ==================================================================
     BUILD
     ================================================================== */
  function build(ctx) {
    const THREE = window.THREE;
    const G = solve(ctx);
    const X = G.X, Z = G.Z, N = G.N, h = G.h, H = G.H, R = G.R, S = G.S, FW = G.FW, KT = P.kerbTop;
    const CA = G.CA, SA = G.SA, ALPHA = G.ALPHA, E = G.E, KN = ALPHA.length, M = E.length;
    const root = ctx.root;
    const Y = P.yRoad;
    const stats = { roadVerts: 0, footwayVerts: 0, kerbVerts: 0, paintQuads: 0, arrows: 0, crosswalks: 0, stopBars: 0,
      tMarks: 0, manholes: 0, valves: 0, grime: 0, ramps: 0, tactilePads: 0, driveways: 0, drawCalls: 0 };
    const meshes = {};

    function finish(name, geo, material, opt) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      m.receiveShadow = true; m.castShadow = false;
      m.matrixAutoUpdate = false; m.updateMatrix();
      // A land floor is not disposable scenery (farcull) and not batchable.
      m.userData.terrain = true;
      if (opt && opt.decal) { m.userData.roadPaint = true; m.renderOrder = opt.order != null ? opt.order : 1; }
      if (opt && opt.surface) { m.userData.worldSurface = true; }
      root.add(m);
      meshes[name] = m;
      stats.drawCalls++;
      return m;
    }

    // ---------------------------------------------------------------
    // 1) THE ROAD: junction pieces (polar rings round each arc) + strips
    // ---------------------------------------------------------------
    const road = new Acc({ lane: true });
    function roadVert(x, z, ji, jj, strip) {
      // lane attribute: (u median-relative, e to kerb, w lane weight)
      let u, w = 1, ave;
      if (strip) { u = strip.vertical ? x - strip.line : z - strip.line; ave = strip.ave; }
      else {
        const dx = x - X[ji], dz = z - Z[jj];
        if (Math.abs(dz) >= Math.abs(dx)) { u = dx; w = clamp(1 - (S - Math.abs(dz)) / 5, 0, 1); ave = G.isAve(ji); }
        else { u = dz; w = clamp(1 - (S - Math.abs(dx)) / 5, 0, 1); ave = false; }
      }
      if (ave) u = (u < 0 ? -1 : 1) * Math.max(0, Math.abs(u) - G.medHalf);
      const e = G.kerbDist(x, z);
      return road.v(x, Y, z, x * 0.25, z * 0.25, null, [u, e, w]);
    }
    // the ray endpoint on the junction's own centre lines (bitwise shared by
    // mirrored quadrants and by the rectangular outer quadrants)
    function rayEnd(i, j, sx, sz, k) {
      const cx = X[i] + sx * S, cz = Z[j] + sz * S;
      if (k === G.K45) return [X[i], Z[j]];
      if (CA[k] > SA[k]) return [X[i], cz - sz * SA[k] * (S / CA[k])];
      return [cx - sx * CA[k] * (S / SA[k]), Z[j]];
    }
    const rowsA = new Map(), rowsB = new Map();     // quadrant key -> [vertex idx from kerb (e=0) to centre]
    function qkey(i, j, sx, sz) { return G.ckey(i, j, sx, sz); }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
        const hasA = G.legA(j, sz), hasB = G.legB(i, sx);
        if (G.blockAt(i, j, sx, sz)) {
          // POLAR quadrant: rays from the arc centre, rings of constant e
          const cx = X[i] + sx * S, cz = Z[j] + sz * S;
          const grid = [];
          for (let k = 0; k < KN; k++) {
            const col = [];
            const rmax = CA[k] > SA[k] ? S / CA[k] : S / SA[k];
            for (let m = 0; m < M; m++) {
              let x, z;
              if (m === M - 1) { const pe = rayEnd(i, j, sx, sz, k); x = pe[0]; z = pe[1]; }
              else {
                const e = E[m];
                const rho = e <= 0.8 ? R + e : R + 0.8 + (e - 0.8) * (rmax - R - 0.8) / (G.ELAST - 0.8);
                x = cx - sx * CA[k] * rho; z = cz - sz * SA[k] * rho;
              }
              col.push(roadVert(x, z, i, j, null));
            }
            grid.push(col);
          }
          for (let k = 0; k < KN - 1; k++) for (let m = 0; m < M - 1; m++) {
            road.q(grid[k][m], grid[k + 1][m], grid[k + 1][m + 1], grid[k][m + 1]);
          }
          rowsA.set(qkey(i, j, sx, sz), grid[0]);
          rowsB.set(qkey(i, j, sx, sz), grid[KN - 1]);
        } else {
          // RECTANGULAR quadrant: no block here (the grid's outer edge)
          const xs = [], zs = [];
          if (hasB) { for (let k = G.K45; k < KN; k++) xs.push(rayEnd(i, j, sx, sz, k)[0]); }
          else { for (let m = M - 1; m >= 0; m--) xs.push(m === M - 1 ? X[i] : X[i] + sx * (h - E[m])); }
          if (hasA) { for (let k = G.K45; k >= 0; k--) zs.push(rayEnd(i, j, sx, sz, k)[1]); }
          else { for (let m = M - 1; m >= 0; m--) zs.push(m === M - 1 ? Z[j] : Z[j] + sz * (h - E[m])); }
          const grid = [];
          for (let a = 0; a < xs.length; a++) { const col = []; for (let b = 0; b < zs.length; b++) col.push(roadVert(xs[a], zs[b], i, j, null)); grid.push(col); }
          for (let a = 0; a < xs.length - 1; a++) for (let b = 0; b < zs.length - 1; b++) road.q(grid[a][b], grid[a + 1][b], grid[a + 1][b + 1], grid[a][b + 1]);
          // rows facing the strips, ordered kerb/outer edge -> centre line
          if (hasA) rowsA.set(qkey(i, j, sx, sz), grid.map(function (col) { return col[zs.length - 1]; }).reverse());
          if (hasB) rowsB.set(qkey(i, j, sx, sz), grid[xs.length - 1].slice().reverse());
        }
      }
    }
    // strips between junction pieces
    function stripRows(rowNeg, rowPos) {         // (-side kerb..centre) + (centre..+side kerb)
      return rowNeg.concat(rowPos.slice(0, rowPos.length - 1).reverse());
    }
    const INNER = 4;                             // interior rows (shadow/tessellation)
    for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {          // strips of road A (vertical line i)
      const lo = stripRows(rowsA.get(qkey(i, j, -1, 1)), rowsA.get(qkey(i, j, 1, 1)));
      const hi = stripRows(rowsA.get(qkey(i, j + 1, -1, -1)), rowsA.get(qkey(i, j + 1, 1, -1)));
      const strip = { vertical: true, line: X[i], ave: G.isAve(i) };
      const rows = [lo];
      for (let r = 1; r <= INNER; r++) {
        const f = r / (INNER + 1), row = [];
        for (let c = 0; c < lo.length; c++) {
          const x = road.pos[lo[c] * 3], z0 = road.pos[lo[c] * 3 + 2], z1 = road.pos[hi[c] * 3 + 2];
          row.push(roadVert(x, z0 + (z1 - z0) * f, 0, 0, strip));
        }
        rows.push(row);
      }
      rows.push(hi);
      for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < lo.length - 1; c++) road.q(rows[r][c], rows[r][c + 1], rows[r + 1][c + 1], rows[r + 1][c]);
    }
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) {          // strips of road B (horizontal line j)
      const lo = stripRows(rowsB.get(qkey(i, j, 1, -1)), rowsB.get(qkey(i, j, 1, 1)));
      const hi = stripRows(rowsB.get(qkey(i + 1, j, -1, -1)), rowsB.get(qkey(i + 1, j, -1, 1)));
      const strip = { vertical: false, line: Z[j], ave: false };
      const rows = [lo];
      for (let r = 1; r <= INNER; r++) {
        const f = r / (INNER + 1), row = [];
        for (let c = 0; c < lo.length; c++) {
          const z = road.pos[lo[c] * 3 + 2], x0 = road.pos[lo[c] * 3], x1 = road.pos[hi[c] * 3];
          row.push(roadVert(x0 + (x1 - x0) * f, z, 0, 0, strip));
        }
        rows.push(row);
      }
      rows.push(hi);
      for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < lo.length - 1; c++) road.q(rows[r][c], rows[r][c + 1], rows[r + 1][c + 1], rows[r + 1][c]);
    }
    // THE HARBOUR APRON: the ring from the grid edge out to the seawall line,
    // skirted down from the road height, sharing every edge vertex of the
    // road so no crack can open between them.
    {
      const edge = { s: [], n: [], w: [], e: [] };
      const nv = road.pos.length / 3, eps = 1e-6;
      for (let v = 0; v < nv; v++) {
        const x = road.pos[v * 3], z = road.pos[v * 3 + 2];
        if (Math.abs(z - G.minZ) < eps) edge.s.push(v);
        if (Math.abs(z - G.maxZ) < eps) edge.n.push(v);
        if (Math.abs(x - G.minX) < eps) edge.w.push(v);
        if (Math.abs(x - G.maxX) < eps) edge.e.push(v);
      }
      const ap = new Map();
      function av(x, z, y) {
        const k = x.toFixed(4) + "," + z.toFixed(4);
        let i = ap.get(k);
        if (i == null) { i = road.v(x, y, z, x * 0.25, z * 0.25, null, [0, 99, 0]); ap.set(k, i); }
        return i;
      }
      const SK = P.skirt, AP = P.apron;
      function uniq(list, key) {
        list.sort(function (a, b) { return road.pos[a * 3 + key] - road.pos[b * 3 + key]; });
        const out = [];
        for (const v of list) if (!out.length || Math.abs(road.pos[out[out.length - 1] * 3 + key] - road.pos[v * 3 + key]) > 1e-5) out.push(v);
        return out;
      }
      // south / north: full width incl. the corner squares
      [["s", G.minZ, -1], ["n", G.maxZ, 1]].forEach(function (sd) {
        const inner = uniq(edge[sd[0]], 0), z0 = sd[1], dir = sd[2];
        const cols = [];
        cols.push([av(G.minX - AP, z0, 0), av(G.minX - AP, z0 + dir * SK, 0), av(G.minX - AP, z0 + dir * AP, 0)]);
        cols.push([av(G.minX - SK, z0, 0), av(G.minX - SK, z0 + dir * SK, 0), av(G.minX - SK, z0 + dir * AP, 0)]);
        for (const v of inner) { const x = road.pos[v * 3]; cols.push([v, av(x, z0 + dir * SK, 0), av(x, z0 + dir * AP, 0)]); }
        cols.push([av(G.maxX + SK, z0, 0), av(G.maxX + SK, z0 + dir * SK, 0), av(G.maxX + SK, z0 + dir * AP, 0)]);
        cols.push([av(G.maxX + AP, z0, 0), av(G.maxX + AP, z0 + dir * SK, 0), av(G.maxX + AP, z0 + dir * AP, 0)]);
        for (let c = 0; c < cols.length - 1; c++) for (let r = 0; r < 2; r++) road.q(cols[c][r], cols[c + 1][r], cols[c + 1][r + 1], cols[c][r + 1]);
      });
      [["w", G.minX, -1], ["e", G.maxX, 1]].forEach(function (sd) {
        const inner = uniq(edge[sd[0]], 2), x0 = sd[1], dir = sd[2];
        const cols = [];
        for (const v of inner) { const z = road.pos[v * 3 + 2]; cols.push([v, av(x0 + dir * SK, z, 0), av(x0 + dir * AP, z, 0)]); }
        for (let c = 0; c < cols.length - 1; c++) for (let r = 0; r < 2; r++) road.q(cols[c][r], cols[c + 1][r], cols[c + 1][r + 1], cols[c][r + 1]);
      });
    }
    stats.roadVerts = road.pos.length / 3;
    // THE MATERIAL: CBZ.roadMat (wet-weather driver) + the procedural asphalt
    const roadMat = CBZ.roadMat
      ? CBZ.roadMat({ color: 0xffffff, detailRepeat: 1, normalScale: 0.3 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff });
    if (CBZ.asphaltDetail) {
      CBZ.asphaltDetail(roadMat, {
        origin: { x: (G.minX + G.maxX) / 2, z: (G.minZ + G.maxZ) / 2 },
        lanes: { laneW: G.laneW, lanesPerDir: G.nL, median: 0 },   // u is median-relative already
        gutter: P.gutter,
      });
    } else roadMat.color.setRGB(0.08, 0.08, 0.085);
    // The library's roughness map scatters metre-scale glossy blotches that
    // mirror the sky (the "camouflage" read at noon); the shader owns the
    // roughness variation here (polish, tar, oil), so drop the map.
    if (roadMat.roughnessMap) { roadMat.roughnessMap = null; roadMat.needsUpdate = true; }
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(roadMat, 0.10);
    const roadMesh = finish("mainland-city-surface", road.geo(THREE, false), roadMat, { surface: true });

    // ---------------------------------------------------------------
    // 2) BLOCKS: kerb + footway (+ ramps, aprons) per block perimeter
    // ---------------------------------------------------------------
    const foot = new Acc({ color: true });
    const kerb = new Acc({ color: true, normals: true });
    const tact = new Acc({});
    const lotLoops = [];                         // per block: [{x,y,z}] back-edge loop
    // depth samples across a full-width (FW) footway; corners squeeze them
    const DS = [0, KT, 0.6, 0.9, KT + P.driveRun, FW - P.backRun, KT + P.rampRun, FW];
    DS.sort(function (a, b) { return a - b; });
    function depths(dmax) {
      const out = [];
      for (let k = 0; k < DS.length; k++) {
        const d = DS[k];
        const v = d <= KT ? d : KT + (d - KT) * (dmax - KT) / (FW - KT);
        if (out.length && v - out[out.length - 1] < 1e-4) continue;
        out.push(k === DS.length - 1 ? dmax : v);
      }
      return out;
    }
    function footTone(x, z) { return 0.94 + hsh(Math.floor(x / 1.5), Math.floor(z / 1.5), 41) * 0.1; }
    for (let bi = 0; bi < N; bi++) for (let bj = 0; bj < N; bj++) {
      const dv = G.drives[bi * N + bj] || null;
      const segs = [];
      // corner helper: station list over alpha, in the requested direction
      function cornerSeg(ji, jj, sx, sz, forward) {
        const cx = X[ji] + sx * S, cz = Z[jj] + sz * S;
        const st = [];
        for (let n = 0; n < KN; n++) {
          const k = forward ? n : KN - 1 - n;
          const kx = cx - sx * CA[k] * R, kz = cz - sz * SA[k] * R;
          const rl = (R - FW) / Math.max(CA[k], SA[k]);
          st.push({ x: kx, z: kz, nx: sx * CA[k], nz: sz * SA[k], dmax: k === 0 || k === KN - 1 ? FW : R - rl,
            s: R * ALPHA[k], tone: 1.04, a: ALPHA[k], corner: G.ckey(ji, jj, sx, sz) });
        }
        return st;
      }
      // face helper: straight kerb from (x0,z0) to (x1,z1), inward normal (nx,nz)
      function faceSeg(x0, z0, x1, z1, nx, nz, face) {
        const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
        const ts = [];
        const n = Math.ceil(len / 0.8);
        for (let k = 0; k <= n; k++) ts.push(k * len / n);
        let dA = null, dB = null;
        if (dv && dv.face === face) {
          // driveway: apron edges get a duplicated station (crisp tone step)
          const along0 = nz !== 0 ? x0 : z0, sgn = nz !== 0 ? dx : dz;
          const tc = (dv.at - along0) * sgn;
          dA = tc - dv.half - dv.flare; dB = tc + dv.half + dv.flare;
          [dA, dB, tc - dv.half, tc + dv.half].forEach(function (t) { if (t > 0 && t < len) ts.push(t); });
          ts.sort(function (a, b) { return a - b; });
        }
        const st = [];
        for (let k = 0; k < ts.length; k++) {
          const t = ts[k];
          if (k && Math.abs(t - ts[k - 1]) < 1e-3 && !(dA != null && (Math.abs(t - dA) < 1e-3 || Math.abs(t - dB) < 1e-3))) continue;
          const onApron = dA != null && t > dA + 1e-3 && t < dB - 1e-3;
          const base = { x: x0 + dx * t, z: z0 + dz * t, nx: nx, nz: nz, dmax: FW, s: t, a: -1, corner: -1 };
          if (dA != null && (Math.abs(t - dA) < 1e-3 || Math.abs(t - dB) < 1e-3)) {
            // the boundary: one station outside the apron, one inside
            const inFirst = Math.abs(t - dB) < 1e-3;
            st.push(Object.assign({}, base, { tone: inFirst ? 1.12 : null }));
            st.push(Object.assign({}, base, { tone: inFirst ? null : 1.12 }));
          } else st.push(Object.assign({}, base, { tone: onApron ? 1.12 : null }));
        }
        if (dv && dv.face === face) stats.driveways++;
        return st;
      }
      const x0 = X[bi], x1 = X[bi + 1], z0 = Z[bj], z1 = Z[bj + 1];
      // CCW loop: SW corner, south face, SE corner, east face, NE, north, NW, west
      segs.push(cornerSeg(bi, bj, 1, 1, true));
      segs.push(faceSeg(x0 + S, z0 + h, x1 - S, z0 + h, 0, 1, "z-"));
      segs.push(cornerSeg(bi + 1, bj, -1, 1, false));
      segs.push(faceSeg(x1 - h, z0 + S, x1 - h, z1 - S, -1, 0, "x+"));
      segs.push(cornerSeg(bi + 1, bj + 1, -1, -1, true));
      segs.push(faceSeg(x1 - S, z1 - h, x0 + S, z1 - h, 0, -1, "z+"));
      segs.push(cornerSeg(bi, bj + 1, 1, -1, false));
      segs.push(faceSeg(x0 + h, z1 - S, x0 + h, z0 + S, 1, 0, "x-"));
      const loop = [];
      for (const st of segs) {
        const fcols = [], kcols = [], fcolsFace = [];
        for (const s of st) {
          const ds = depths(s.dmax);
          const tone = s.tone != null ? s.tone : 1;
          // footway (d >= KT)
          const fc = [];
          for (const d of ds) {
            if (d < KT - 1e-6) continue;
            const x = s.x + s.nx * d, z = s.z + s.nz * d;
            const y = G.heightAt(x, z);
            const kerbGrime = 1 - 0.07 * (1 - sstep((d - KT) / 0.6));
            fc.push(foot.v(x, y, z, s.s / 6, (d - KT) / (FW - KT), tone * kerbGrime * footTone(x, z)));
          }
          fcols.push(fc);
          // kerb top band (0..KT)
          const yk0 = G.heightAt(s.x, s.z), xk1 = s.x + s.nx * KT, zk1 = s.z + s.nz * KT, yk1 = G.heightAt(xk1, zk1);
          kcols.push([
            kerb.v(s.x, yk0, s.z, s.s / 4, 0.53, 1, null, [0, 1, 0]),
            kerb.v(xk1, yk1, zk1, s.s / 4, 0.98, 1, null, [0, 1, 0]),
          ]);
          // kerb face: from under the road up to the kerb top, facing the road
          const fh = Math.max(0.005, yk0 - Y);
          fcolsFace.push([
            kerb.v(s.x, Y - 0.03, s.z, s.s / 4, 0.5 - Math.min(0.5, (fh + 0.03) / 0.32), 0.86, null, [-s.nx, 0, -s.nz]),
            kerb.v(s.x, yk0, s.z, s.s / 4, 0.5, 0.86, null, [-s.nx, 0, -s.nz]),
          ]);
          const last = fc[fc.length - 1];
          loop.push({ x: foot.pos[last * 3], y: foot.pos[last * 3 + 1], z: foot.pos[last * 3 + 2] });
        }
        for (let c = 0; c < st.length - 1; c++) {
          const A = fcols[c], B = fcols[c + 1];
          const n = Math.min(A.length, B.length);
          for (let r = 0; r < n - 1; r++) foot.q(A[r], B[r], B[r + 1], A[r + 1]);
          kerb.q(kcols[c][0], kcols[c + 1][0], kcols[c + 1][1], kcols[c][1]);
          const nx = -(st[c].nx + st[c + 1].nx) / 2, nz = -(st[c].nz + st[c + 1].nz) / 2;
          kerb.q(fcolsFace[c][0], fcolsFace[c + 1][0], fcolsFace[c + 1][1], fcolsFace[c][1], nx, 0, nz);
        }
        // tactile pad over the full-drop crosswalk landing on a corner
        if (st.length && st[0].corner >= 0) {
          const rs = G.cornerDrops.get(st[0].corner);
          if (rs) {
            for (const r of rs) {
              const cols = [];
              let s0 = null;
              for (const s of st) {
                if (s.a < r[0] - 1e-6 || s.a > r[1] + 1e-6) continue;
                const dd = Math.min(KT + P.tactile, s.dmax - 0.08);
                if (dd <= KT + 0.1) continue;
                if (s0 == null) s0 = s.s;
                const col = [];
                for (const d of [KT + 0.02, (KT + 0.02 + dd) / 2, dd]) {
                  const x = s.x + s.nx * d, z = s.z + s.nz * d;
                  col.push(tact.v(x, G.heightAt(x, z) + 0.004, z, Math.abs(s.s - s0) / 0.36, (d - KT) / 0.36));
                }
                cols.push(col);
              }
              for (let c = 0; c < cols.length - 1; c++) for (let rr = 0; rr < 2; rr++) tact.q(cols[c][rr], cols[c + 1][rr], cols[c + 1][rr + 1], cols[c][rr + 1]);
              if (cols.length > 1) { stats.tactilePads++; stats.ramps++; }
            }
          }
        }
      }
      // back-edge loop for the lot pad (drop exact duplicates)
      const clean = [];
      for (const p of loop) {
        const q = clean[clean.length - 1];
        if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6) continue;
        clean.push(p);
      }
      if (clean.length > 2 && Math.abs(clean[0].x - clean[clean.length - 1].x) < 1e-6 && Math.abs(clean[0].z - clean[clean.length - 1].z) < 1e-6) clean.pop();
      lotLoops[bi * N + bj] = clean;
    }
    stats.footwayVerts = foot.pos.length / 3;
    stats.kerbVerts = kerb.pos.length / 3;

    const footTex = texOf(THREE, footwayCanvas());
    const footMat = new THREE.MeshLambertMaterial({ map: footTex, vertexColors: true });
    const kerbTex = texOf(THREE, kerbCanvas());
    const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex, vertexColors: true });
    const tactTex = texOf(THREE, tactileCanvas());
    const tactMat = new THREE.MeshLambertMaterial({ map: tactTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    [footMat, kerbMat, tactMat].forEach(function (m) { if (CBZ.terrainFogScale) CBZ.terrainFogScale(m, 0.10); });
    finish("street-footway", foot.geo(THREE, true), footMat);
    finish("street-kerb", kerb.geo(THREE, false), kerbMat);
    finish("street-tactile", tact.geo(THREE, true), tactMat, { decal: true, order: 1 });

    // ---------------------------------------------------------------
    // 3) MARKINGS — US MUTCD, one merged mesh per colour
    // ---------------------------------------------------------------
    const white = new Acc({ color: true }), yellow = new Acc({ color: true });
    const PY = Y + 0.003;
    // a quad from four world points (winding fixed by Acc)
    function pquad(acc, pts, tone) {
      const a = acc.v(pts[0][0], PY, pts[0][1], 0, 0, tone), b = acc.v(pts[1][0], PY, pts[1][1], 1, 0, tone),
        c = acc.v(pts[2][0], PY, pts[2][1], 1, 1, tone), d = acc.v(pts[3][0], PY, pts[3][1], 0, 1, tone);
      acc.q(a, b, c, d); stats.paintQuads++;
    }
    // frame: origin (ox,oz), forward (fx,fz), lateral (rx,rz); rect in (lat,fwd)
    function frameRect(acc, F, l0, l1, f0, f1, tone) {
      function w(l, f) { return [F.ox + F.rx * l + F.fx * f, F.oz + F.rz * l + F.fz * f]; }
      pquad(acc, [w(l0, f0), w(l1, f0), w(l1, f1), w(l0, f1)], tone);
    }
    function frameTri(acc, F, a, b, c, tone) {
      function w(p) { return [F.ox + F.rx * p[0] + F.fx * p[1], F.oz + F.rz * p[0] + F.fz * p[1]]; }
      const A = w(a), B = w(b), C = w(c);
      const ia = acc.v(A[0], PY, A[1], 0, 0, tone), ib = acc.v(B[0], PY, B[1], 1, 0, tone), ic = acc.v(C[0], PY, C[1], 0, 1, tone);
      acc.t(ia, ib, ic);
    }
    function wornTone(x, z, salt) { const t = hsh(Math.round(x * 2), Math.round(z * 2), salt); return 0.72 + t * 0.28 - (t < 0.06 ? 0.25 : 0); }
    const LW = 0.12;                       // line width (4-6 in)
    const DEP0 = G.cw1 + 0.5;              // lines resume 0.5 m past the crosswalk
    const SOLID = 15;                      // solid lane line into the stop bar
    // per strip: vertical (road A line i between j and j+1) / horizontal
    function paintStrip(vertical, li, j0) {
      const ave = vertical && G.isAve(li);
      const base = ave ? G.medHalf : 0;
      const L0 = vertical ? X[li] : Z[li];
      const T0 = vertical ? Z[j0] : X[j0];
      const len = G.step;
      // frame: lateral u along x (vertical) / z (horizontal), forward along the road
      const F = vertical ? { ox: L0, oz: T0, rx: 1, rz: 0, fx: 0, fz: 1 } : { ox: T0, oz: L0, rx: 0, rz: 1, fx: 1, fz: 0 };
      const y0 = G.stop0, y1 = len - G.stop0;
      // centreline: double yellow (a solid yellow each side of the median on the avenues)
      const yo = ave ? base + 0.04 : 0.06;
      frameRect(yellow, F, yo, yo + LW, y0, y1, wornTone(F.ox, F.oz, 3));
      frameRect(yellow, F, -yo - LW, -yo, y0, y1, wornTone(F.ox, F.oz, 4));
      const edgeU = base + G.nL * G.laneW;
      for (let s = -1; s <= 1; s += 2) {
        // side s travels +forward when s > 0 (the lane contract in config.js)
        const barNear = s > 0 ? len - G.stop0 : G.stop0, barFar = s > 0 ? len - G.stop1 : G.stop1;
        // lane lines
        for (let k = 1; k < G.nL; k++) {
          const u = s * (base + k * G.laneW);
          const solidA = s > 0 ? barFar - SOLID : barFar, solidB = s > 0 ? barFar : barFar + SOLID;
          frameRect(white, F, u - LW / 2, u + LW / 2, Math.min(solidA, solidB), Math.max(solidA, solidB), wornTone(F.ox + u, F.oz, 5));
          // dashes from the departure end: 3 m on, 9 m off
          const dep = s > 0 ? DEP0 : len - DEP0;
          for (let q = 0; q < 8; q++) {
            const a = s > 0 ? dep + q * 12 : dep - q * 12 - 3, b = a + 3;
            if (s > 0 ? b > solidA - 1 : a < solidB + 1) break;
            frameRect(white, F, u - LW / 2, u + LW / 2, a, b, wornTone(F.ox + u + a, F.oz + a, 6));
          }
        }
        // edge line (outside the travel lanes, parking beyond it)
        const eu = s * (edgeU + LW / 2);
        frameRect(white, F, eu - LW / 2, eu + LW / 2, DEP0, len - DEP0, wornTone(F.ox + eu, F.oz, 7));
        // stop bar across the approach lanes, 0.6 m
        const u0 = s * (yo + LW + 0.05), u1 = s * edgeU;
        frameRect(white, F, Math.min(u0, u1), Math.max(u0, u1), Math.min(barNear, barFar), Math.max(barNear, barFar), 0.92);
        stats.stopBars++;
        // parking T-marks where a block (and so a kerb) lines this side
        const blk = vertical ? { bi: s > 0 ? li : li - 1, bj: j0 } : { bi: j0, bj: s > 0 ? li : li - 1 };
        if (blk.bi >= 0 && blk.bi < N && blk.bj >= 0 && blk.bj < N) {
          const a0 = h + 6.5, a1 = len - h - 6.5, BAY = 6.4;
          const nb = Math.floor((a1 - a0) / BAY);
          if (nb > 0) {
            const start = a0 + ((a1 - a0) - nb * BAY) / 2;
            const dv = G.drives[blk.bi * N + blk.bj];
            const faceHere = vertical ? (s > 0 ? "x-" : "x+") : (s > 0 ? "z-" : "z+");
            for (let b = 0; b <= nb; b++) {
              const t = start + b * BAY;
              if (dv && dv.face === faceHere && Math.abs((T0 + t) - dv.at) < dv.half + dv.flare + 0.4) continue;
              const su0 = s * (edgeU + LW), su1 = s * Math.min(edgeU + LW + 1.0, h - P.gutter - 0.1);
              frameRect(white, F, Math.min(su0, su1), Math.max(su0, su1), t - 0.05, t + 0.05, 0.85);
              stats.tMarks++;
            }
          }
        }
      }
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) paintStrip(true, i, j);
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) paintStrip(false, j, i);
    // crosswalks (continental) + arrows, per junction leg
    const ARROWS = {
      through: [[[-0.13, 0], [0.13, 0], [0.13, 1.9], [-0.13, 1.9]], [[-0.45, 1.9], [0.45, 1.9], [0, 3.0]]],
      // lateral + = toward the kerb (a right turn), - = toward the centre line
      right: [[[-0.13, 0], [0.13, 0], [0.13, 1.66], [-0.13, 1.66]], [[-0.13, 1.66], [0.72, 1.66], [0.72, 1.92], [-0.13, 1.92]], [[0.72, 1.34], [0.72, 2.24], [1.35, 1.79]]],
      left: [[[-0.13, 0], [0.13, 0], [0.13, 1.66], [-0.13, 1.66]], [[-0.72, 1.66], [0.13, 1.66], [0.13, 1.92], [-0.72, 1.92]], [[-0.72, 1.34], [-0.72, 2.24], [-1.35, 1.79]]],
      throughRight: [[[-0.13, 0], [0.13, 0], [0.13, 1.9], [-0.13, 1.9]], [[-0.45, 1.9], [0.45, 1.9], [0, 3.0]],
        [[0.13, 0.9], [0.62, 0.9], [0.62, 1.14], [0.13, 1.14]], [[0.62, 0.6], [0.62, 1.44], [1.18, 1.02]]],
    };
    function drawArrow(F, shape) {
      for (const poly of ARROWS[shape]) {
        if (poly.length === 4) { frameTri(white, F, poly[0], poly[1], poly[2], 0.9); frameTri(white, F, poly[0], poly[2], poly[3], 0.9); }
        else frameTri(white, F, poly[0], poly[1], poly[2], 0.9);
      }
      stats.arrows++;
    }
    const midtown = ctx.isMidtown || function () { return false; };
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      // legs: road A (vertical) +/-z, road B (horizontal) +/-x
      for (const sg of [-1, 1]) {
        // crosswalk across road A on leg sg (bars run along z)
        if (G.cwA(i, j, sg)) {
          const F = { ox: X[i], oz: Z[j], rx: 1, rz: 0, fx: 0, fz: sg };
          for (let k = -7; k <= 7; k++) frameRect(white, F, k * 1.1 - 0.25, k * 1.1 + 0.25, G.cw0, G.cw1, wornTone(X[i] + k, Z[j] + sg, 8));
          stats.crosswalks++;
        }
        if (G.cwB(i, j, sg)) {
          const F = { ox: X[i], oz: Z[j], rx: 0, rz: 1, fx: sg, fz: 0 };
          for (let k = -7; k <= 7; k++) frameRect(white, F, k * 1.1 - 0.25, k * 1.1 + 0.25, G.cw0, G.cw1, wornTone(X[i] + sg, Z[j] + k, 9));
          stats.crosswalks++;
        }
        // Midtown approach arrows: lanes that drive INTO this junction on leg sg
        if (midtown(i, j)) {
          const aBase = G.stop1 + 3.0;
          if (G.legA(j, sg)) {
            // approaching from leg sg travelling -sg: lanes on side s = -sg (u sign)
            const s = -sg, ave = G.isAve(i), base = ave ? G.medHalf : 0;
            for (let idx = 0; idx < G.nL; idx++) {
              const u = s * (base + (idx + 0.5) * G.laneW);
              const F = { ox: X[i] + u, oz: Z[j] + sg * (aBase + 3.0), rx: s, rz: 0, fx: 0, fz: -sg };
              drawArrow(F, idx === 0 ? "left" : (idx === G.nL - 1 ? "throughRight" : "through"));
            }
          }
          if (G.legB(i, sg)) {
            const s = -sg;
            for (let idx = 0; idx < G.nL; idx++) {
              const u = s * ((idx + 0.5) * G.laneW);
              const F = { ox: X[i] + sg * (aBase + 3.0), oz: Z[j] + u, rx: 0, rz: s, fx: -sg, fz: 0 };
              drawArrow(F, idx === 0 ? "left" : (idx === G.nL - 1 ? "throughRight" : "through"));
            }
          }
        }
      }
    }
    function paintMat(r, g, b) {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      m.color.setRGB(r, g, b);                   // LINEAR paint albedo, set explicitly
      if (CBZ.roadPaintWear) CBZ.roadPaintWear(m);
      if (CBZ.terrainFogScale) CBZ.terrainFogScale(m, 0.10);
      return m;
    }
    finish("street-paint-white", white.geo(THREE, true), paintMat(0.60, 0.61, 0.60), { decal: true, order: 1 });
    finish("street-paint-yellow", yellow.geo(THREE, true), paintMat(0.62, 0.40, 0.05), { decal: true, order: 1 });

    // ---------------------------------------------------------------
    // 4) IRONWORK + GRIME — hash-seeded, merged
    // ---------------------------------------------------------------
    const iron = new Acc({});
    function disc(acc, x, z, y, r, u0, u1, seg) {
      const c = acc.v(x, y, z, (u0 + u1) / 2, 0.5);
      const ring = [];
      for (let k = 0; k < seg; k++) {
        const a = k / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        ring.push(acc.v(x + ca * r, y, z + sa * r, (u0 + u1) / 2 + ca * (u1 - u0) / 2, 0.5 + sa * 0.5));
      }
      for (let k = 0; k < seg; k++) acc.t(c, ring[k], ring[(k + 1) % seg]);
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
      for (const vertical of [true, false]) {
        const L0 = vertical ? X[i] : Z[i], T0 = vertical ? Z[j] : X[j];
        const cnt = 1 + (hsh(L0, T0, 51) < 0.45 ? 1 : 0);
        for (let q = 0; q < cnt; q++) {
          const t = G.stop1 + 4 + hsh(L0 + q, T0, 52) * (G.step - 2 * G.stop1 - 8);
          const s = hsh(L0, T0 + q, 53) < 0.5 ? -1 : 1, idx = hsh(L0 + q, T0 + q, 54) < 0.6 ? 0 : 1;
          const base = vertical && G.isAve(i) ? G.medHalf : 0;
          const u = s * (base + (idx + 0.5) * G.laneW);
          const x = vertical ? L0 + u : T0 + t, z = vertical ? T0 + t : L0 + u;
          disc(iron, x, z, Y + 0.002, 0.38, 0, 0.5, 18); stats.manholes++;
        }
        // a water valve cover near the gutter
        if (hsh(L0, T0, 55) < 0.7) {
          const t = 8 + hsh(L0, T0, 56) * (G.step - 16), s = hsh(L0, T0, 57) < 0.5 ? -1 : 1;
          const u = s * (h - 1.0);
          const x = vertical ? L0 + u : T0 + t, z = vertical ? T0 + t : L0 + u;
          disc(iron, x, z, Y + 0.002, 0.14, 0.5, 1.0, 10); stats.valves++;
        }
      }
    }
    // a manhole in some junction boxes
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      if (hsh(X[i], Z[j], 58) < 0.4) { disc(iron, X[i] + (hsh(X[i], Z[j], 59) - 0.5) * 6, Z[j] + (hsh(X[i], Z[j], 60) - 0.5) * 6, Y + 0.002, 0.38, 0, 0.5, 18); stats.manholes++; }
    }
    const ironTex = texOf(THREE, ironCanvas(), false);
    const ironMat = new THREE.MeshLambertMaterial({ map: ironTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -5 });
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(ironMat, 0.10);
    finish("street-ironwork", iron.geo(THREE, true), ironMat, { decal: true, order: 1 });

    // grime: oil where cars idle behind the stop bar, tyre marks at the bar
    const grime = new Acc({});
    function gquad(F, l0, l1, f0, f1, u0, u1) {
      function w(l, f) { return [F.ox + F.rx * l + F.fx * f, F.oz + F.rz * l + F.fz * f]; }
      const p = [w(l0, f0), w(l1, f0), w(l1, f1), w(l0, f1)];
      const a = grime.v(p[0][0], Y + 0.004, p[0][1], u0, 0), b = grime.v(p[1][0], Y + 0.004, p[1][1], u1, 0),
        c = grime.v(p[2][0], Y + 0.004, p[2][1], u1, 1), d = grime.v(p[3][0], Y + 0.004, p[3][1], u0, 1);
      grime.q(a, b, c, d); stats.grime++;
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      for (const sg of [-1, 1]) for (const axisA of [true, false]) {
        if (axisA ? !G.legA(j, sg) : !G.legB(i, sg)) continue;
        const s = -sg;
        for (let idx = 0; idx < G.nL; idx++) {
          const hk = hsh(X[i] * 3 + idx, Z[j] * 3 + sg, axisA ? 61 : 62);
          const base = axisA && G.isAve(i) ? G.medHalf : 0;
          const u = s * (base + (idx + 0.5) * G.laneW);
          const F = axisA ? { ox: X[i] + u, oz: Z[j], rx: s, rz: 0, fx: 0, fz: sg } : { ox: X[i], oz: Z[j] + u, rx: 0, rz: s, fx: sg, fz: 0 };
          // oil blot where an idling car's engine sits (~2.5 m behind the bar)
          if (hk < 0.75) { const f = G.stop1 + 2.2 + hk * 1.6, r = 0.55 + hk * 0.5; gquad(F, -r, r, f - r, f + r, 0, 0.5); }
          // tyre marks: two dark streaks in the wheel paths
          if (hk > 0.45) {
            const f0 = G.stop1 + 0.3, f1 = f0 + 3 + hk * 5;
            gquad(F, -0.95, -0.7, f0, f1, 0.5, 1.0); gquad(F, 0.7, 0.95, f0, f1, 0.5, 1.0);
          }
        }
      }
    }
    const grimeTex = texOf(THREE, grimeCanvas(), false);
    const grimeMat = new THREE.MeshBasicMaterial({ map: grimeTex, fog: false, toneMapped: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 });
    finish("street-grime", grime.geo(THREE, true), grimeMat, { decal: true, order: 2 });

    // ---------------------------------------------------------------
    // 5) RED KERB paint (hydrant fire lanes), merged; flushed by finishRed
    // ---------------------------------------------------------------
    const red = new Acc({});
    let redCount = 0;
    function paintRedKerb(bi, bj, px, pz) {
      if (bi < 0 || bj < 0 || bi >= N || bj >= N) return false;
      const bx = (X[bi] + X[bi + 1]) / 2, bz = (Z[bj] + Z[bj + 1]) / 2;
      const dx = px - bx, dz = pz - bz;
      const alongX = Math.abs(dz) >= Math.abs(dx);          // kerb runs along x (a z-face)
      const sgn = alongX ? (dz >= 0 ? 1 : -1) : (dx >= 0 ? 1 : -1);
      const lim = H - R - 0.2;
      const c = clamp(alongX ? dx : dz, -lim + 2.1, lim - 2.1);
      const nIn = [alongX ? 0 : -sgn, alongX ? -sgn : 0];
      const cols = [];
      for (let k = 0; k <= 12; k++) {
        const t = c - 2.1 + k * 0.35;
        const kx = alongX ? bx + t : bx + sgn * H, kz = alongX ? bz + sgn * H : bz + t;
        const top0 = G.heightAt(kx + nIn[0] * 0.01, kz + nIn[1] * 0.01);
        const x2 = kx + nIn[0] * KT, z2 = kz + nIn[1] * KT;
        const out = 0.004;
        cols.push([
          red.v(kx - nIn[0] * out, Y + 0.01, kz - nIn[1] * out, 0, 0),
          red.v(kx - nIn[0] * out, top0 + 0.003, kz - nIn[1] * out, 0, 0),
          red.v(x2, G.heightAt(x2, z2) + 0.004, z2, 0, 0),
        ]);
      }
      for (let k = 0; k < cols.length - 1; k++) {
        red.q(cols[k][0], cols[k + 1][0], cols[k + 1][1], cols[k][1], -nIn[0], 0, -nIn[1]);
        red.q(cols[k][1], cols[k + 1][1], cols[k + 1][2], cols[k][2]);
      }
      redCount++;
      return true;
    }
    function finishRed() {
      const g = red.geo(THREE, true);
      if (!g) return null;
      const m = new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      m.color.setRGB(0.42, 0.035, 0.03);
      return finish("street-red-kerb", g, m, { decal: true, order: 1 });
    }

    // ---------------------------------------------------------------
    // 6) LOT PADS — a fan to the footway's exact back-edge loop
    // ---------------------------------------------------------------
    function lotPad(acc, bi, bj, uvScale) {
      const loop = lotLoops[bi * N + bj];
      if (!loop || loop.length < 3) return;
      const cx = (X[bi] + X[bi + 1]) / 2, cz = (Z[bj] + Z[bj + 1]) / 2;
      const c = acc.v(cx, P.yLot, cz, cx * uvScale, cz * uvScale, 1);
      const ids = loop.map(function (p) { return acc.v(p.x, p.y, p.z, p.x * uvScale, p.z * uvScale, 1); });
      for (let k = 0; k < ids.length; k++) acc.t(c, ids[k], ids[(k + 1) % ids.length]);
    }
    function lotMesh(name, list, material, uvScale) {
      const acc = new Acc({});
      for (const l of list) lotPad(acc, l.bi, l.bj, uvScale);
      if (CBZ.terrainFogScale) CBZ.terrainFogScale(material, 0.10);
      return finish(name, acc.geo(THREE, true), material);
    }
    function plazaMaterial() {
      return new THREE.MeshLambertMaterial({ map: texOf(THREE, plazaCanvas()) });
    }

    return {
      profile: P, solve: G, meshes: meshes, stats: stats, roadMaterial: roadMat,
      heightAt: G.heightAt, regionAt: G.regionAt,
      paintRedKerb: paintRedKerb, finishRed: finishRed, redCount: function () { return redCount; },
      lotMesh: lotMesh, plazaMaterial: plazaMaterial,
      roadMesh: roadMesh,
    };
  }

  CBZ.streetKit = { profile: P, solve: solve, build: build };
})();
