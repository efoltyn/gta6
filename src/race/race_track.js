/* ============================================================
   race/race_track.js — THE RACING SURFACE of the bullring.

   Everything here is swept off race_core's frame(s) in (s,u), so it
   follows the curve, the dogleg and the bank exactly:
     - the banked surface: grooved grey concrete in the turns, dark
       asphalt on the straights, a sealed seam where they meet, a slight
       crown, the rubbered-in groove and the marbles above it, the white
       outer line and the yellow line at the apron (all in two tiling
       1024x512 canvases whose V spans the 19 m surface)
     - the apron, the painted rumble ribs where it meets the banking,
       the infield (mown grass), pit road + pit wall + painted boxes
     - the SAFER barrier on its concrete wall, the catch fence (posts,
       cables, chain-link that leans in at the top) and crossover gates
     - tyre marks: one dynamic mesh, a ring buffer fed by skid(), faded
       on the GPU by age, plus a permanent baked set in the turns
   It also carries the KIT the venue shares (mesher, canvases, the light
   field, the stand profile), exported as CBZ.race.track.kit.

   API: CBZ.race.track.build(THREE, core, {quality}) →
        { group, update(dt), skid(x,y,z,yaw,width,strength), dispose }
============================================================ */
(function (root) {
  "use strict";

  // =====================================================================
  // KIT: shared by race_track and race_venue
  // =====================================================================
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canvas(w, h) {
    if (typeof document === "undefined" || !document || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  function tex(THREE, cv, wrap) {
    if (!cv) return null;
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  function css(c) { return "rgb(" + (c[0] * 255 | 0) + "," + (c[1] * 255 | 0) + "," + (c[2] * 255 | 0) + ")"; }

  /* Mesher: indexed quads/tris with position, normal, uv, colour. Winding
     is decided by a FACE hint (the direction the face should look), so
     callers list corners in any cyclic order and never think about it. */
  function Mesher(opts) {
    opts = opts || {};
    this.P = []; this.N = []; this.UV = []; this.C = []; this.I = [];
    this.nv = 0; this.uvScale = opts.uvScale || 4; this.lit = opts.lit || null;
  }
  Mesher.prototype.v = function (p, nx, ny, nz, u, v, c) {
    this.P.push(p[0], p[1], p[2]); this.N.push(nx, ny, nz); this.UV.push(u, v);
    const k = this.lit ? this.lit(p[0], p[1], p[2]) : 1;
    this.C.push(c[0] * k, c[1] * k, c[2] * k);
    return this.nv++;
  };
  Mesher.prototype._uv = function (p, nx, ny, nz) {
    const S = this.uvScale, ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return [p[0] / S, p[2] / S];
    if (ax >= az) return [p[2] / S, p[1] / S];
    return [p[0] / S, p[1] / S];
  };
  Mesher.prototype.quad = function (a, b, c, d, col, face, uvs) {
    const e1x = c[0] - a[0], e1y = c[1] - a[1], e1z = c[2] - a[2];
    const e2x = d[0] - b[0], e2y = d[1] - b[1], e2z = d[2] - b[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    let q = [a, b, c, d], t = uvs;
    if (face && nx * face[0] + ny * face[1] + nz * face[2] < 0) {
      nx = -nx; ny = -ny; nz = -nz; q = [a, d, c, b];
      if (t) t = [t[0], t[1], t[6], t[7], t[4], t[5], t[2], t[3]];
    }
    const i0 = this.nv;
    for (let k = 0; k < 4; k++) {
      const uv = t ? [t[k * 2], t[k * 2 + 1]] : this._uv(q[k], nx, ny, nz);
      this.v(q[k], nx, ny, nz, uv[0], uv[1], col);
    }
    this.I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  Mesher.prototype.tri = function (a, b, c, col, face, uvs) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    let q = [a, b, c], t = uvs;
    if (face && nx * face[0] + ny * face[1] + nz * face[2] < 0) {
      nx = -nx; ny = -ny; nz = -nz; q = [a, c, b]; if (t) t = [t[0], t[1], t[4], t[5], t[2], t[3]];
    }
    const i0 = this.nv;
    for (let k = 0; k < 3; k++) {
      const uv = t ? [t[k * 2], t[k * 2 + 1]] : this._uv(q[k], nx, ny, nz);
      this.v(q[k], nx, ny, nz, uv[0], uv[1], col);
    }
    this.I.push(i0, i0 + 1, i0 + 2);
  };
  /* box from a centre and three half-extent vectors (any orientation) */
  Mesher.prototype.boxv = function (c, X, Y, Z, col, opt) {
    const ax = [X, Y, Z];
    for (let f = 0; f < 3; f++) {
      const A = ax[f], B = ax[(f + 1) % 3], C = ax[(f + 2) % 3];
      for (let sg = -1; sg <= 1; sg += 2) {
        if (opt && opt.noBottom && f === 1 && sg < 0) continue;
        const cc = [c[0] + A[0] * sg, c[1] + A[1] * sg, c[2] + A[2] * sg];
        const P = (b, e) => [cc[0] + B[0] * b + C[0] * e, cc[1] + B[1] * b + C[1] * e, cc[2] + B[2] * b + C[2] * e];
        this.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), (opt && opt.cols && opt.cols[f * 2 + (sg > 0 ? 1 : 0)]) || col, [A[0] * sg, A[1] * sg, A[2] * sg]);
      }
    }
  };
  /* axis-aligned-in-yaw box: centre (x, y bottom, z), size w (local x), h, d (local z) */
  Mesher.prototype.box = function (x, y, z, w, h, d, yaw, col, opt) {
    const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
    this.boxv([x, y + h / 2, z], [c * w / 2, 0, -s * w / 2], [0, h / 2, 0], [s * d / 2, 0, c * d / 2], col, opt);
  };
  /* a beam (square or n-sided prism) between two points */
  Mesher.prototype.beam = function (p0, p1, r, col, sides) {
    sides = sides || 4;
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const l = Math.hypot(dx, dy, dz); if (l < 1e-6) return;
    dx /= l; dy /= l; dz /= l;
    let ux = 0, uy = 1, uz = 0; if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let bx = dy * uz - dz * uy, by = dz * ux - dx * uz, bz = dx * uy - dy * ux;
    const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    const cx = by * dz - bz * dy, cy = bz * dx - bx * dz, cz = bx * dy - by * dx;
    const off = sides === 4 ? Math.PI / 4 : 0;
    for (let k = 0; k < sides; k++) {
      const a0 = off + k / sides * Math.PI * 2, a1 = off + (k + 1) / sides * Math.PI * 2;
      const o0 = [(Math.cos(a0) * bx + Math.sin(a0) * cx) * r, (Math.cos(a0) * by + Math.sin(a0) * cy) * r, (Math.cos(a0) * bz + Math.sin(a0) * cz) * r];
      const o1 = [(Math.cos(a1) * bx + Math.sin(a1) * cx) * r, (Math.cos(a1) * by + Math.sin(a1) * cy) * r, (Math.cos(a1) * bz + Math.sin(a1) * cz) * r];
      this.quad([p0[0] + o0[0], p0[1] + o0[1], p0[2] + o0[2]], [p0[0] + o1[0], p0[1] + o1[1], p0[2] + o1[2]],
        [p1[0] + o1[0], p1[1] + o1[1], p1[2] + o1[2]], [p1[0] + o0[0], p1[1] + o0[1], p1[2] + o0[2]], col,
        [o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]]);
    }
  };
  Mesher.prototype.geometry = function (THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  };

  /* Buckets: one Mesher per material key ('struct', 'struct#2' = chunk 2) */
  function Buckets(opts) { this.m = {}; this.opts = opts || {}; }
  Buckets.prototype.get = function (key, opts) { return this.m[key] || (this.m[key] = new Mesher(Object.assign({}, this.opts, opts || {}))); };
  Buckets.prototype.emit = function (THREE, group, mats) {
    for (const key in this.m) {
      const me = this.m[key]; if (!me.nv) continue;
      const mat = mats[key.split("#")[0]];
      const mesh = new THREE.Mesh(me.geometry(THREE), mat);
      mesh.name = key; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
    }
    this.m = {};
  };
  /* quadrant chunk of a world point (for per-quadrant culling of the big meshes) */
  function chunk(x, z) { return ((Math.floor((Math.atan2(z, x) / (Math.PI * 2) + 1) * 4)) % 4 + 4) % 4; }

  /* THE STAND PROFILE (venue builds it, track reads it for the tower spots).
     Section across u at any s, outside the SAFER wall:
       wall top → walkway (10.9..12.4) → retaining wall + front parapet →
       lower tier T1 rows → cross-aisle → vom wall → upper tier T2 rows →
       rear riser → top concourse → outer parapet → the outer wall to grade.
     Rows: 0.78 m tread, 0.51 m riser = a 33 deg rake (Bristol-steep). */
  const STAND = { WALK: 10.9, U0: 12.4, TREAD: 0.78, RISER: 0.51, T1: 20, CROSS: 2.0, VOMH: 2.3, T2: 18, LIFT: 2.2, CONC: 3.0, PARA: 1.1 };
  STAND.uC0 = STAND.U0 + STAND.T1 * STAND.TREAD;
  STAND.uC1 = STAND.uC0 + STAND.CROSS;
  STAND.uTop = STAND.uC1 + STAND.T2 * STAND.TREAD;
  STAND.uBack = STAND.uTop + STAND.CONC;
  STAND.rake = Math.atan2(STAND.RISER, STAND.TREAD);
  function standSection(core, s, o) {
    o = o || {};
    const D = core.DIMS;
    o.wallTop = core.surfaceY(s, D.WALL_U) + D.WALL_H;
    o.y0 = o.wallTop + STAND.LIFT;                                  // first row tread
    o.yX = o.y0 + STAND.T1 * STAND.RISER;                           // cross-aisle
    o.y2 = o.yX + STAND.VOMH;                                       // first upper row
    o.yTop = o.y2 + (STAND.T2 - 1) * STAND.RISER;                   // last row
    o.yConc = o.yTop + STAND.RISER;                                 // concourse deck
    return o;
  }
  /* front-stretch suites: where the main grandstand carries the glass boxes */
  const SUITES = { s0: -78, s1: 78, depth: 9, overhang: 4, lift: 3.0, storey: 3.4 };
  function inSuites(core, s) { const d = core.ds(0, s); return d > SUITES.s0 && d < SUITES.s1; }

  /* THE DRIVERS' TUNNEL. How you get from the car park to the cars: in at the
     main gate in the back of the grandstand, down a 1:8 ramp under the stands,
     under the SAFER wall, the racing surface, the apron and pit road, and up a
     straight flight of stairs INSIDE the garage block (the pass-through bay 7),
     out of its roller door onto pit road and through the crew gap in the pit
     wall to the grid. The bullrings do it this way: the infield is an island
     inside the track, and you go under.
     It is ONE straight corridor in the world, along +z (the S/F normal: at
     s = 0 the frame is axis-aligned), at x = TUNNEL.x, and its "u" is the same
     u the frame has at s = 0 (u = z - z0). Pure numbers: race_track cuts the
     infield grass round the stairwell and opens the pit wall in front of the
     bay, race_venue draws it, and Gang City (city/island_speedway.js) turns
     the same numbers into floors, ceilings and walls you walk. */
  const PIT_GAP_HW = 1.1;          // half-width of the crew gap in the pit wall (a 2.2 m opening)
  function tunnelSpec(core) {
    const PIT = core.PIT, f0 = core.frame(0, {});
    const garageF = PIT.u - PIT.w / 2 - 0.6, garageB = garageF - 9, garageH = 5.2;   // race_venue's garage block
    const bay = 7, bayS = PIT.boxS(bay);
    const T = {
      x: 3.0, hw: 1.4, z0: f0.z,                   // the stair lane is the left side of bay 7 (x 0.5..9.3 there)
      floor: -3.6, clear: 3.0, grade: 1 / 8,       // 3.0 m clear under a 0.6 m lid; a 1:8 ramp
      uMouth: STAND.uBack + SUITES.depth - 1.5,    // the back of the main gate's recess
      riser: 0.18, tread: 0.3,
      garage: { uF: garageF, uB: garageB, H: garageH, ceil: 4.0 },
      bay, bayS, bayS0: bayS - PIT.boxLen / 2, bayS1: bayS + PIT.boxLen / 2, doorHW: 3.4,
      pitGap: [bayS - PIT_GAP_HW, bayS + PIT_GAP_HW],
    };
    T.uRampEnd = T.uMouth + T.floor / T.grade;                     // where the ramp reaches the tunnel floor
    T.steps = Math.round(-T.floor / T.riser);
    T.uStairBot = garageF - 0.8;                                   // the flight starts inside the building
    T.uStairTop = T.uStairBot - T.steps * T.tread;
    T.lid = T.floor + T.clear;                                     // the tunnel ceiling (under the lid)
    /* the walking surface along the corridor (u), and the ceiling over it */
    T.floorAt = function (u) {
      if (u >= T.uMouth) return 0;
      if (u > T.uRampEnd) return (u - T.uMouth) * T.grade;
      if (u > T.uStairBot) return T.floor;
      if (u > T.uStairTop) { const k = Math.min(T.steps, Math.floor((T.uStairBot - u) / T.tread) + 1); return T.floor + k * T.riser; }
      return 0;
    };
    T.ceilAt = function (u) { return u > T.uRampEnd ? Math.min(0, (u - T.uMouth) * T.grade) + T.clear : T.lid; };
    /* a corridor point in the circuit's world: across d (+x), along u */
    T.at = function (d, u, y) { return [T.x + d, y, T.z0 + u]; };
    return T;
  }

  /* light towers: evenly spaced by arc length round the back of the stands */
  function towerSpots(core, n) {
    const D = core.DIMS, L = D.L, f = {};
    const U = STAND.uBack, th0 = core.frame(0, f).heading;
    const total = L + U * Math.PI * 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const target = (i + 0.5) / n * total;
      let lo = 0, hi = L;
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2;
        let th = core.frame(m, f).heading - th0; if (th < -1e-6) th += Math.PI * 2;
        if (m + U * th < target) lo = m; else hi = m;
      }
      const s = (lo + hi) / 2;
      out.push({ s, u: inSuites(core, s) ? STAND.uBack + SUITES.depth - 0.9 : STAND.uBack - 0.8 });
    }
    return out;
  }
  /* the baked light: gaussian pools round the lamp aim points on the track.
     brightness 0.42 (dark lot) .. ~1.16 (the racing surface) */
  function lightField(core, spots) {
    const ax = [], az = [], f = {};
    for (const sp of spots) { core.toWorld(sp.s, -1, 0, f); ax.push(f.x); az.push(f.z); }
    const inv = 1 / (2 * 30 * 30), n = ax.length;
    return function (x, y, z) {
      let s = 0;
      for (let i = 0; i < n; i++) { const dx = x - ax[i], dz = z - az[i]; s += Math.exp(-(dx * dx + dz * dz) * inv); }
      if (s > 1.35) s = 1.35;
      return 0.42 + 0.55 * s;
    };
  }
  /* arc length along the offset line u (for texture U that doesn't stretch) */
  function arcAt(core, s, u, f) { return s + u * (core.frame(s, f).heading - core.T.H[0]); }

  const kit = { rng, canvas, tex, rgb, css, Mesher, Buckets, chunk, STAND, standSection, SUITES, inSuites, tunnelSpec, towerSpots, lightField, arcAt };

  // =====================================================================
  // TEXTURES
  // =====================================================================
  const REP = 16;                      // metres of surface per texture repeat along s
  function surfaceTex(THREE, core, concrete, seed) {
    const W = 1024, H = 512, cv = canvas(W, H); if (!cv) return null;
    const D = core.DIMS, g = cv.getContext("2d"), R = rng(seed);
    const span = D.WALL_U - D.INNER;                 // 19 m across
    const py = (u) => H - (u - D.INNER) / span * H;  // canvas y of a u (flipY: v=0 is the bottom)
    const pxm = W / REP;
    // base
    g.fillStyle = concrete ? "#9c9c98" : "#2b2c2e"; g.fillRect(0, 0, W, H);
    // aggregate grain
    for (let i = 0; i < 26000; i++) {
      const v = concrete ? 120 + R() * 70 : 22 + R() * 40;
      g.fillStyle = "rgba(" + (v | 0) + "," + (v | 0) + "," + ((v + (concrete ? -4 : 3)) | 0) + "," + (0.35 + R() * 0.4).toFixed(2) + ")";
      const s = 1 + R() * 2.2; g.fillRect(R() * W, R() * H, s, s);
    }
    if (concrete) {
      // longitudinal tining (the grooves), then slab joints across and along
      for (let y = 0; y < H; y += 3) { g.fillStyle = "rgba(60,60,58," + (0.08 + R() * 0.07).toFixed(3) + ")"; g.fillRect(0, y, W, 1); }
      g.fillStyle = "rgba(40,40,38,0.55)";
      for (let x = 0; x < W; x += pxm * 4) g.fillRect(x, 0, 2, H);
      for (let u = D.INNER + 4.75; u < D.WALL_U - 0.5; u += 4.75) g.fillRect(0, py(u), W, 2);
      // hairline patches (poured-in sealant squiggles)
      g.strokeStyle = "rgba(25,25,25,0.5)"; g.lineWidth = 1.5;
      for (let i = 0; i < 10; i++) { let x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.3) * 30; y += (R() - 0.5) * 20; g.lineTo(x, y); } g.stroke(); }
    } else {
      // sealer tar snakes on the asphalt
      g.strokeStyle = "rgba(8,8,9,0.7)"; g.lineWidth = 3;
      for (let i = 0; i < 9; i++) { let x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += R() * 40; y += (R() - 0.5) * 26; g.lineTo(x, y); } g.stroke(); }
    }
    // the rubbered-in groove: a dark band with streaks along s
    const gu0 = concrete ? -7.2 : -6.0, gu1 = concrete ? 0.5 : 2.0;
    const gy0 = py(gu1), gy1 = py(gu0);
    const grd = g.createLinearGradient(0, gy0 - 30, 0, gy1 + 30);
    const dk = concrete ? "30,30,30" : "6,6,7";
    grd.addColorStop(0, "rgba(" + dk + ",0)"); grd.addColorStop(0.2, "rgba(" + dk + "," + (concrete ? 0.55 : 0.45) + ")");
    grd.addColorStop(0.75, "rgba(" + dk + "," + (concrete ? 0.62 : 0.5) + ")"); grd.addColorStop(1, "rgba(" + dk + ",0)");
    g.fillStyle = grd; g.fillRect(0, gy0 - 30, W, gy1 - gy0 + 60);
    for (let i = 0; i < 180; i++) {
      const y = gy0 + R() * (gy1 - gy0); g.fillStyle = "rgba(" + dk + "," + (0.15 + R() * 0.3).toFixed(2) + ")";
      g.fillRect(0, y, W, 1 + R() * 3);
    }
    // marbles: rubber crumbs above the groove
    for (let i = 0; i < 5000; i++) {
      const u = gu1 + 0.6 + Math.pow(R(), 0.8) * 5.5, y = py(u);
      g.fillStyle = "rgba(12,12,12," + (0.4 + R() * 0.5).toFixed(2) + ")";
      const s = 1.5 + R() * 2.5; g.fillRect(R() * W, y, s, s);
    }
    // the shoulder (past the white line) is dirtier
    g.fillStyle = concrete ? "rgba(70,68,62,0.35)" : "rgba(50,48,44,0.3)"; g.fillRect(0, 0, W, py(D.HALF_W));
    // lines: white at the top edge of the surface, yellow at the apron
    g.fillStyle = "#e9e7df"; g.fillRect(0, py(D.HALF_W), W, 0.16 / span * H);
    g.fillStyle = "#e4b41c"; g.fillRect(0, py(D.INNER + 0.3), W, 0.18 / span * H);
    return tex(THREE, cv, true);
  }
  function grassTex(THREE, seed) {
    const S = 512, cv = canvas(S, S); if (!cv) return null;
    const g = cv.getContext("2d"), R = rng(seed);
    g.fillStyle = "#2f5a26"; g.fillRect(0, 0, S, S);
    g.fillStyle = "#3b6e2d"; g.fillRect(0, 0, S, S / 2);   // two mown stripes per repeat
    for (let i = 0; i < 30000; i++) {
      const v = R(); g.fillStyle = v < 0.5 ? "rgba(20,48,16,0.35)" : "rgba(90,130,60,0.25)";
      g.fillRect(R() * S, R() * S, 1 + R() * 2, 2 + R() * 3);
    }
    return tex(THREE, cv, true);
  }
  function noiseTex(THREE, seed) {
    const S = 256, cv = canvas(S, S); if (!cv) return null;
    const g = cv.getContext("2d"), R = rng(seed);
    g.fillStyle = "#e8e8e8"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { const v = 190 + R() * 65 | 0; g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.6)"; const s = 1 + R() * 3; g.fillRect(R() * S, R() * S, s, s); }
    for (let i = 0; i < 18; i++) { g.fillStyle = "rgba(120,120,120,0.08)"; g.beginPath(); g.arc(R() * S, R() * S, 10 + R() * 40, 0, 7); g.fill(); }
    return tex(THREE, cv, true);
  }
  function linkTex(THREE) {
    const S = 64, cv = canvas(S, S); if (!cv) return null;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, S, S); g.strokeStyle = "rgba(190,196,200,1)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.moveTo(S, 0); g.lineTo(0, S);
    g.moveTo(-S / 2, S / 2); g.lineTo(S / 2, -S / 2); g.moveTo(S / 2, S * 1.5); g.lineTo(S * 1.5, S / 2);
    g.moveTo(-S / 2, S / 2); g.lineTo(S / 2, S * 1.5); g.moveTo(S / 2, -S / 2); g.lineTo(S * 1.5, S / 2);
    g.stroke();
    return tex(THREE, cv, true);
  }
  /* the markings atlas: white, yellow, red, black, grey seam + a checker band */
  const MK = { white: [0, 0, 64, 64], yellow: [64, 0, 64, 64], red: [128, 0, 64, 64], black: [192, 0, 64, 64], seam: [0, 64, 64, 64], chk: [0, 128, 256, 128] };
  function markTex(THREE) {
    const cv = canvas(256, 256); if (!cv) return null;
    const g = cv.getContext("2d");
    const fill = (r, c) => { g.fillStyle = c; g.fillRect(r[0], r[1], r[2], r[3]); };
    fill(MK.white, "#eeece4"); fill(MK.yellow, "#e8b81e"); fill(MK.red, "#c0161b"); fill(MK.black, "#0d0d0e"); fill(MK.seam, "#3b3a37");
    fill([64, 64, 192, 64], "#eeece4");
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) & 1 ? "#0d0d0e" : "#eeece4"; g.fillRect(i * 16, 128 + j * 32, 16, 32); }
    return tex(THREE, cv, false);
  }
  function mkUV(r, fu0, fv0, fu1, fv1) {
    // a sub-rect of an atlas region (fractions), flipY-aware; order: (u0v0)(u1v0)(u1v1)(u0v1)
    const A = 256, pad = 2;
    const x0 = (r[0] + pad + (r[2] - 2 * pad) * fu0) / A, x1 = (r[0] + pad + (r[2] - 2 * pad) * fu1) / A;
    const y0 = 1 - (r[1] + pad + (r[3] - 2 * pad) * fv0) / A, y1 = 1 - (r[1] + pad + (r[3] - 2 * pad) * fv1) / A;
    return [x0, y0, x1, y0, x1, y1, x0, y1];
  }
  function streakTex(THREE, seed) {
    const W = 64, H = 128, cv = canvas(W, H); if (!cv) return null;
    const g = cv.getContext("2d"), R = rng(seed);
    g.clearRect(0, 0, W, H);
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, W - 1 - x) / (W * 0.18); const a = Math.min(1, edge) * (0.55 + R() * 0.45);
      g.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")"; g.fillRect(x, 0, 1, H);
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = "rgba(255,255,255," + (R() * 0.4).toFixed(2) + ")"; g.fillRect(R() * W, R() * H, 1, 3 + R() * 10); }
    const t = tex(THREE, cv, true); if (t) t.encoding = THREE.LinearEncoding;
    return t;
  }

  // =====================================================================
  // BUILD
  // =====================================================================
  function build(THREE, core, opts) {
    opts = opts || {};
    const hi = opts.quality !== "low";
    const D = core.DIMS, L = D.L, PIT = core.PIT;
    const group = new THREE.Group(); group.name = "race_track";
    const spots = towerSpots(core, hi ? 18 : 12);
    const lit = lightField(core, spots);
    const B = new Buckets({ lit });
    const F = {}, F2 = {};

    // ---- materials --------------------------------------------------------------
    const T = {
      concrete: surfaceTex(THREE, core, true, 11), asphalt: surfaceTex(THREE, core, false, 12),
      grass: grassTex(THREE, 13), noise: noiseTex(THREE, 14), link: linkTex(THREE), mark: markTex(THREE), streak: streakTex(THREE, 15),
    };
    if (T.link) T.link.anisotropy = 1;
    const M = {
      concrete: new THREE.MeshLambertMaterial({ map: T.concrete, vertexColors: true }),
      asphalt: new THREE.MeshLambertMaterial({ map: T.asphalt, vertexColors: true }),
      grass: new THREE.MeshLambertMaterial({ map: T.grass, vertexColors: true }),
      struct: new THREE.MeshLambertMaterial({ map: T.noise, vertexColors: true }),
      mark: new THREE.MeshLambertMaterial({ map: T.mark, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      link: new THREE.MeshLambertMaterial({ map: T.link, color: 0xb9c0c6, transparent: false, alphaTest: 0.35, side: THREE.DoubleSide }),
      signs: null,
    };
    const signs = signAtlas(THREE);
    M.signs = new THREE.MeshLambertMaterial({ map: signs.tex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });

    const W3 = (s, u, y) => { core.toWorld(s, u, y, F); return [F.x, F.y, F.z]; };
    const up = [0, 1, 0];
    const white = [1, 1, 1];

    // ---- sample lists ------------------------------------------------------------
    const TURN_K = 0.6 / D.R_TURN;
    function samples(stepStraight, stepTurn, extra) {
      const out = [];
      let s = 0;
      while (s < L - 0.01) { out.push(s); const k = Math.abs(core.frame(s, F).k); s += k > TURN_K * 0.5 ? stepTurn : stepStraight; }
      if (extra) for (const e of extra) out.push(core.wrapS(e));
      out.sort((a, b) => a - b);
      const clean = [];
      for (const v of out) if (!clean.length || v - clean[clean.length - 1] > 0.05) clean.push(v);
      clean.push(L);
      return clean;
    }
    // concrete / asphalt seams
    // concrete = the turns: well into the spirals, never the tri-oval dogleg
    const isConcrete = (s) => Math.abs(core.frame(s, F).k) > 0.6 / D.R_TURN && Math.abs(core.ds(0, s)) > D.DOGLEG_HALF + 2;
    const seams = [];
    { let prev = isConcrete(0); for (let s = 0.5; s <= L; s += 0.5) { const c = isConcrete(s); if (c !== prev) seams.push(s - 0.25); prev = c; } }

    // ---- the racing surface ----------------------------------------------------------
    const US = hi ? [-9, -8, -6.5, -5, -3, -1, 1, 3, 5, 7, 8.2, 9, 10] : [-9, -7, -4, -1, 2, 5, 8, 9, 10];
    const sS = samples(hi ? 3 : 6, hi ? 1.6 : 3.2, seams);
    const span = D.WALL_U - D.INNER;
    const crown = (u) => 0.03 * Math.sin(Math.PI * (u - D.INNER) / span);
    for (let i = 0; i < sS.length - 1; i++) {
      const s0 = sS[i], s1 = sS[i + 1], sm = (s0 + s1) / 2;
      const me = B.get(isConcrete(sm) ? "concrete" : "asphalt");
      for (let j = 0; j < US.length - 1; j++) {
        const ua = US[j], ub = US[j + 1];
        const a = W3(s0, ua), b = W3(s1, ua), c = W3(s1, ub), d = W3(s0, ub);
        a[1] += crown(ua); b[1] += crown(ua); c[1] += crown(ub); d[1] += crown(ub);
        const va = (ua - D.INNER) / span, vb = (ub - D.INNER) / span;
        me.quad(a, b, c, d, white, up, [s0 / REP, va, s1 / REP, va, s1 / REP, vb, s0 / REP, vb]);
      }
    }

    // ---- apron -----------------------------------------------------------------------
    {
      const me = B.get("struct"), col = rgb(0xa4a39d), step = samples(hi ? 4 : 8, hi ? 2.5 : 5);
      const UA = [D.APRON_IN, D.INNER - 1.2, D.INNER];
      for (let i = 0; i < step.length - 1; i++) {
        const s0 = step[i], s1 = step[i + 1];
        for (let j = 0; j < UA.length - 1; j++) me.quad(W3(s0, UA[j]), W3(s1, UA[j]), W3(s1, UA[j + 1]), W3(s0, UA[j + 1]), col, up);
      }
    }

    // ---- infield grass: the inner apron edge, less the stairwell of the drivers' tunnel ----
    {
      const me = B.get("grass", { uvScale: 16 }), ol = core.outline(D.APRON_IN, hi ? 4 : 8);
      const TU = tunnelSpec(core);
      const contour = [], holes = [[]];
      for (let i = 0; i < ol.length; i += 2) contour.push(new THREE.Vector2(ol[i], ol[i + 1]));
      for (const [d, u] of [[-TU.hw, TU.uStairBot], [TU.hw, TU.uStairBot], [TU.hw, TU.uStairTop], [-TU.hw, TU.uStairTop]]) {
        const p = TU.at(d, u, 0); holes[0].push(new THREE.Vector2(p[0], p[2]));
      }
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
      if (!THREE.ShapeUtils.isClockWise(holes[0])) holes[0].reverse();
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = contour.concat(holes[0]);
      for (const f of faces) {
        const a = all[f[0]], b = all[f[1]], c = all[f[2]];
        me.tri([a.x, -0.02, a.y], [b.x, -0.02, b.y], [c.x, -0.02, c.y], white, up);
      }
    }

    // ---- pit road (asphalt fast lane, concrete boxes) + pit wall ---------------------------
    const pitU = (s) => {                                    // centre offset + width along the pit road
      const d = core.ds(0, s), a = Math.abs(d);
      if (a <= PIT.s1) return [PIT.u, PIT.w];
      const f = Math.min(1, (a - PIT.s1) / (PIT.outS - PIT.s1)), e = f * f * (3 - 2 * f);
      return [PIT.u + (D.APRON_IN + 2.2 - PIT.u) * e, PIT.w + (5 - PIT.w) * e];
    };
    const pitY = (s, u) => Math.max(0, core.surfaceY(s, u)) + 0.035;
    {
      const me = B.get("struct"), asp = rgb(0x3a3b3d), conc = rgb(0x8e8d88);
      for (let s = PIT.inS; s < PIT.outS - 0.01; s += hi ? 2 : 4) {
        const s1 = Math.min(PIT.outS, s + (hi ? 2 : 4));
        const [c0, w0] = pitU(s), [c1, w1] = pitU(s1);
        const boxes0 = Math.abs(core.ds(0, s)) < PIT.s1 && Math.abs(core.ds(0, s1)) <= PIT.s1 + 0.01;
        const lanes = boxes0 ? [[-0.5, -0.5 + 8 / PIT.w, conc], [-0.5 + 8 / PIT.w, 0.5, asp]] : [[-0.5, 0.5, asp]];
        for (const [fa, fb, col] of lanes) {
          const ua0 = c0 + w0 * fa, ub0 = c0 + w0 * fb, ua1 = c1 + w1 * fa, ub1 = c1 + w1 * fb;
          me.quad(W3(s, ua0, pitY(s, ua0)), W3(s1, ua1, pitY(s1, ua1)), W3(s1, ub1, pitY(s1, ub1)), W3(s, ub0, pitY(s, ub0)), col, up);
        }
      }
      // pit wall: a concrete wall between the grass strip and the pit road
      const wc = rgb(0xd9d7d0), h = 1.05, t = 0.3;
      /* a crew gap in front of the tunnel's pass-through bay: the way from the
         garages over to the grid on foot (PIT_GAP_HW each side of the bay) */
      const TU = tunnelSpec(core), g0 = TU.bayS - PIT_GAP_HW, g1 = TU.bayS + PIT_GAP_HW;
      const cuts = [PIT.s0 - 6];
      for (let s = PIT.s0 - 6 + (hi ? 3 : 6); s < PIT.s1 + 6 - 0.01; s += hi ? 3 : 6) if (s < g0 || s > g1) cuts.push(s);
      cuts.push(g0, g1, PIT.s1 + 6); cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i], s1 = cuts[i + 1];
        if (s1 - s < 0.05 || (s >= g0 - 1e-6 && s1 <= g1 + 1e-6)) continue;
        const ui = PIT.wallU - t, uo = PIT.wallU + t;
        const bi0 = W3(s, ui, 0), bi1 = W3(s1, ui, 0), bo0 = W3(s, uo, 0), bo1 = W3(s1, uo, 0);
        const ti0 = W3(s, ui, h), ti1 = W3(s1, ui, h), to0 = W3(s, uo, h), to1 = W3(s1, uo, h);
        core.frame(s, F2);
        me.quad(bi0, bi1, ti1, ti0, wc, [-F2.nx, 0, -F2.nz]);
        me.quad(bo0, bo1, to1, to0, wc, [F2.nx, 0, F2.nz]);
        me.quad(ti0, ti1, to1, to0, wc, up);
      }
      // wall ends (and the two faces of the crew gap)
      for (const [se, sg] of [[PIT.s0 - 6, -1], [PIT.s1 + 6, 1], [g0, 1], [g1, -1]]) {
        core.frame(se, F2);
        me.quad(W3(se, PIT.wallU - t, 0), W3(se, PIT.wallU + t, 0), W3(se, PIT.wallU + t, h), W3(se, PIT.wallU - t, h), wc, [F2.tx * sg, 0, F2.tz * sg]);
      }
    }

    // ---- markings (one atlas mesh) ------------------------------------------------------------
    const mk = B.get("mark");
    /* paint a patch from s0..s1, u0..u1 in atlas region r; y follows the ground under it */
    function patch(s0, s1, u0, u1, r, yf, fu0, fu1) {
      const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 2.5));
      yf = yf || ((s, u) => core.surfaceY(s, u) + (u >= D.INNER ? crown(Math.min(u, D.WALL_U)) : 0) + 0.012);
      fu0 = fu0 == null ? 0 : fu0; fu1 = fu1 == null ? 1 : fu1;
      for (let i = 0; i < n; i++) {
        const sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
        const fa = fu0 + (fu1 - fu0) * i / n, fb = fu0 + (fu1 - fu0) * (i + 1) / n;
        mk.quad(W3(sa, u0, yf(sa, u0)), W3(sb, u0, yf(sb, u0)), W3(sb, u1, yf(sb, u1)), W3(sa, u1, yf(sa, u1)), white, up, mkUV(r, fa, 0, fb, 1));
      }
    }
    // start/finish: a white line across and a checker band behind it
    patch(-0.3, 0.3, D.INNER, D.WALL_U, MK.white);
    {
      const us = [D.INNER, -4.25, 0.5, 5.25, D.WALL_U];
      for (let j = 0; j < 4; j++) {
        const u0 = us[j], u1 = us[j + 1], y = (s, u) => core.surfaceY(s, u) + crown(u) + 0.012;
        mk.quad(W3(0.3, u0, y(0.3, u0)), W3(2.3, u0, y(2.3, u0)), W3(2.3, u1, y(2.3, u1)), W3(0.3, u1, y(0.3, u1)), white, up, mkUV(MK.chk, 0, 0, 1, 1).map((v, k) => (k & 1) ? v : v));
      }
    }
    // concrete/asphalt seams: a dark sealed joint across the surface
    for (const s of seams) patch(s - 0.09, s + 0.09, D.INNER, D.WALL_U, MK.seam);
    // grid boxes, two-wide: open-back boxes around each slot (10 cars)
    for (let i = 0; i < 10; i++) {
      const sl = core.GRID.slot(i), s = sl.s, u = sl.u, hl = 2.9, hw = 1.45, lw = 0.12;
      patch(s + hl - lw, s + hl, u - hw, u + hw, MK.white);          // front bar
      patch(s - hl, s + hl, u - hw, u - hw + lw, MK.white);          // sides
      patch(s - hl, s + hl, u + hw - lw, u + hw, MK.white);
    }
    // rumble ribs: red and white on the apron's top metre in the turns
    {
      let s = 0, k = 0;
      while (s < L) {
        const len = 1.0;
        if (isConcrete(s) && isConcrete(s + len)) patch(s, s + len, D.INNER - 1.2, D.INNER, (k & 1) ? MK.white : MK.red);
        s += len; k++;
      }
    }
    // pit road: edge lines, the speed-limit lines, the 12 boxes, the commitment lines
    {
      const py = (s, u) => pitY(s, u) + 0.01;
      for (let s = PIT.inS; s < PIT.outS - 0.01; s += 4) {
        const s1 = Math.min(PIT.outS, s + 4);
        const [c0, w0] = pitU(s), [c1, w1] = pitU(s1);
        const eo0 = c0 - w0 / 2, eo1 = c1 - w1 / 2;
        mk.quad(W3(s, eo0, py(s, eo0)), W3(s1, eo1, py(s1, eo1)), W3(s1, eo1 + 0.15, py(s1, eo1 + 0.15)), W3(s, eo0 + 0.15, py(s, eo0 + 0.15)), white, up, mkUV(MK.white, 0, 0, 1, 1));
      }
      const fastEdge = PIT.u - PIT.w / 2 + 8;
      patch(PIT.s0, PIT.s1, fastEdge - 0.08, fastEdge + 0.08, MK.white, py);
      for (const s of [PIT.s0, PIT.s1]) patch(s - 0.2, s + 0.2, PIT.u - PIT.w / 2, PIT.u + PIT.w / 2, MK.white, py);
      for (let b = 0; b < PIT.boxes; b++) {
        const s = PIT.boxS(b), u0 = PIT.u - PIT.w / 2 + 0.3, u1 = fastEdge - 0.3;
        patch(s - PIT.boxLen / 2 + 0.2, s - PIT.boxLen / 2 + 0.35, u0, u1, MK.yellow, py);
        patch(s + PIT.boxLen / 2 - 0.35, s + PIT.boxLen / 2 - 0.2, u0, u1, MK.yellow, py);
        patch(s - 0.9, s + 0.9, u1 - 0.12, u1, MK.white, py);                  // the stall mark where the car stops
      }
      // commitment lines: a solid line along the bottom of the surface into pit entry, and across the apron
      patch(PIT.inS - 40, PIT.inS, D.INNER + 0.1, D.INNER + 0.4, MK.white);
      patch(PIT.inS - 0.25, PIT.inS + 0.25, D.APRON_IN, D.INNER, MK.white);
      patch(PIT.outS, PIT.outS + 40, D.INNER + 0.1, D.INNER + 0.4, MK.white);
      patch(PIT.outS - 0.25, PIT.outS + 0.25, D.APRON_IN, D.INNER, MK.white);
    }

    // ---- SAFER barrier on its concrete wall -------------------------------------------------
    const wS = samples(hi ? 3 : 6, hi ? 2 : 4);
    const gates = [L * 0.14, L * 0.36, L * 0.64, L * 0.86];
    {
      const face = B.get("signs"), st = B.get("struct"), conc = rgb(0xc8c6be), foam = rgb(0x8d8f93);
      // sponsor panels every ~48 m on the SAFER face, the plain steel face elsewhere
      const panels = [];
      for (let s = 20; s < L - 30; s += 48) panels.push([s, s + 12, (panels.length) % signs.sponsors.length]);
      const inPanel = (s) => { for (const p of panels) if (s >= p[0] && s < p[1]) return p; return null; };
      for (let i = 0; i < wS.length - 1; i++) {
        const s0 = wS[i], s1 = wS[i + 1], sm = (s0 + s1) / 2;
        core.frame(sm, F2);
        const inward = [-F2.nx, 0, -F2.nz];
        const y0a = core.surfaceY(s0, D.WALL_U), y0b = core.surfaceY(s1, D.WALL_U);
        const pn = inPanel(sm);
        let uv;
        if (pn) { const r = signs.sponsors[pn[2]]; const fa = 1 - (s0 - pn[0]) / 12, fb = 1 - (s1 - pn[0]) / 12; /* inward faces read with s running right-to-left */ uv = signs.uv(r, fa, 0, fb, 1); }
        else uv = signs.uv(signs.safer, 0, 0, 1, 1);
        // uv order a(s0,bottom) b(s1,bottom) c(s1,top) d(s0,top): atlas v0 is the TOP of the tile
        face.quad(W3(s0, D.WALL_U, y0a), W3(s1, D.WALL_U, y0b), W3(s1, D.WALL_U, y0b + D.WALL_H), W3(s0, D.WALL_U, y0a + D.WALL_H), white, inward,
          [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]]);
        // foam box top, concrete wall top
        const uf = D.WALL_U + 0.55;
        st.quad(W3(s0, D.WALL_U, y0a + D.WALL_H), W3(s1, D.WALL_U, y0b + D.WALL_H), W3(s1, uf, y0b + D.WALL_H), W3(s0, uf, y0a + D.WALL_H), foam, up);
        st.quad(W3(s0, uf, y0a + D.WALL_H + 0.05), W3(s1, uf, y0b + D.WALL_H + 0.05), W3(s1, D.WALL_U + D.WALL_T, y0b + D.WALL_H + 0.05), W3(s0, D.WALL_U + D.WALL_T, y0a + D.WALL_H + 0.05), conc, up);
        st.quad(W3(s0, uf, y0a + D.WALL_H), W3(s1, uf, y0b + D.WALL_H), W3(s1, uf, y0b + D.WALL_H + 0.05), W3(s0, uf, y0a + D.WALL_H + 0.05), conc, inward);
      }
      // crossover gates: dark seams in the SAFER face
      for (const g of gates) for (const e of [-1.6, 1.6]) {
        const s = g + e; core.frame(s, F2);
        const y0 = core.surfaceY(s, D.WALL_U);
        face.quad(W3(s - 0.04, D.WALL_U - 0.02, y0), W3(s + 0.04, D.WALL_U - 0.02, y0), W3(s + 0.04, D.WALL_U - 0.02, y0 + D.WALL_H), W3(s - 0.04, D.WALL_U - 0.02, y0 + D.WALL_H), white, [-F2.nx, 0, -F2.nz], signs.uv(signs.black, 0, 0, 1, 1));
      }
    }

    // ---- catch fence ---------------------------------------------------------------------
    {
      const st = B.get("struct"), ln = B.get("link"), steel = rgb(0x8a9097), gateCol = rgb(0xd8b020);
      const UP = D.WALL_U + 0.4, LEAN = 1.25, VERT = D.FENCE_H - 1.5;
      const top = (s) => core.surfaceY(s, D.WALL_U) + D.WALL_H + 0.05;
      // posts
      const postStep = hi ? 4.5 : 9;
      const pS = samples(postStep, postStep * 0.75);
      for (const s of pS) {
        if (s >= L) break;
        const y = top(s), gate = gates.some((g) => Math.abs(core.ds(g, s)) < 1.7);
        const a = W3(s, UP, y), b = W3(s, UP, y + VERT), c = W3(s, UP - LEAN, y + D.FENCE_H);
        st.beam(a, b, 0.07, steel); st.beam(b, c, 0.06, steel);
        if (gate) st.beam(a, b, 0.1, gateCol);
      }
      // gate frames (heavier posts + rails)
      for (const g of gates) {
        const y = top(g);
        for (const e of [-1.6, 1.6]) st.beam(W3(g + e, UP - 0.05, y), W3(g + e, UP - 0.05, y + VERT), 0.1, gateCol);
        for (const h of [0.2, VERT * 0.5, VERT]) st.beam(W3(g - 1.6, UP - 0.05, y + h), W3(g + 1.6, UP - 0.05, y + h), 0.05, gateCol);
      }
      // chain-link: a vertical sheet and the inward-leaning top
      for (let i = 0; i < wS.length - 1; i++) {
        const s0 = wS[i], s1 = wS[i + 1], ya = top(s0), yb = top(s1);
        const U0 = s0 / 0.9, U1 = s1 / 0.9;
        ln.quad(W3(s0, UP, ya), W3(s1, UP, yb), W3(s1, UP, yb + VERT), W3(s0, UP, ya + VERT), white, null, [U0, 0, U1, 0, U1, VERT / 0.9, U0, VERT / 0.9]);
        const lh = Math.hypot(LEAN, D.FENCE_H - VERT) / 0.9;
        ln.quad(W3(s0, UP, ya + VERT), W3(s1, UP, yb + VERT), W3(s1, UP - LEAN, yb + D.FENCE_H), W3(s0, UP - LEAN, ya + D.FENCE_H), white, null, [U0, 0, U1, 0, U1, lh, U0, lh]);
        // cables on the track side + the top rail
        for (const h of [1.3, 2.7, 4.1]) st.beam(W3(s0, UP - 0.12, ya + h), W3(s1, UP - 0.12, yb + h), 0.035, steel, 3);
        st.beam(W3(s0, UP - LEAN, ya + D.FENCE_H), W3(s1, UP - LEAN, yb + D.FENCE_H), 0.05, steel, 3);
      }
    }

    // ---- tyre marks: baked streaks + the live ring buffer, ONE draw -------------------------
    const PERM = hi ? 360 : 180, RING = hi ? 1400 : 600, NQ = PERM + RING;
    const tPos = new Float32Array(NQ * 12), tUV = new Float32Array(NQ * 8), tFade = new Float32Array(NQ * 12);
    const tIdx = []; for (let q = 0; q < NQ; q++) { const b = q * 4; tIdx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    for (let q = PERM; q < NQ; q++) for (let k = 0; k < 4; k++) tFade[(q * 4 + k) * 3] = -1e6;   // unborn: faded out
    function putQuad(q, L0, R0, L1, R1, v0, v1, birth, str, perm) {
      const P = [L0, R0, R1, L1], UVs = [0, v0, 1, v0, 1, v1, 0, v1];
      for (let k = 0; k < 4; k++) {
        const o = (q * 4 + k);
        tPos[o * 3] = P[k][0]; tPos[o * 3 + 1] = P[k][1]; tPos[o * 3 + 2] = P[k][2];
        tUV[o * 2] = UVs[k * 2]; tUV[o * 2 + 1] = UVs[k * 2 + 1];
        tFade[o * 3] = birth; tFade[o * 3 + 1] = str; tFade[o * 3 + 2] = perm;
      }
    }
    // baked: dark arcs through the turns, a little below the groove centre, drifting up on exit
    {
      const R = rng(77); let q = 0;
      const turnS = []; for (let s = 0; s < L; s += 1) if (isConcrete(s)) turnS.push(s);
      while (q < PERM - 10) {
        const s0 = turnS[(R() * turnS.length) | 0], len = 8 + R() * 22, n = Math.max(2, Math.round(len / 2.2));
        let u = -6 + R() * 7; const du = (R() - 0.3) * 0.12, w = 0.22 + R() * 0.12, str = 0.25 + R() * 0.45;
        let prev = null;
        for (let i = 0; i <= n && q < PERM; i++) {
          const s = s0 + i * len / n; u += du * len / n;
          const y = (uu) => core.surfaceY(s, uu) + crown(uu) + 0.02;
          const Lp = W3(s, u - w / 2, y(u - w / 2)), Rp = W3(s, u + w / 2, y(u + w / 2));
          if (prev) { putQuad(q++, prev[0], prev[1], Lp, Rp, (i - 1) * 0.7, i * 0.7, 0, str * (1 - Math.abs(i / n - 0.5)), 1); }
          prev = [Lp, Rp];
        }
      }
      for (; q < PERM; q++) for (let k = 0; k < 4; k++) tFade[(q * 4 + k) * 3 + 1] = 0;
    }
    const tGeo = new THREE.BufferGeometry();
    const aPos = new THREE.BufferAttribute(tPos, 3), aUV = new THREE.BufferAttribute(tUV, 2), aFade = new THREE.BufferAttribute(tFade, 3);
    aPos.setUsage(THREE.DynamicDrawUsage); aUV.setUsage(THREE.DynamicDrawUsage); aFade.setUsage(THREE.DynamicDrawUsage);
    tGeo.setAttribute("position", aPos); tGeo.setAttribute("uv", aUV); tGeo.setAttribute("aFade", aFade);
    tGeo.setIndex(tIdx);
    tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), Math.max(-D.bbox.x0, D.bbox.x1) + 20);
    const U_NOW = { value: 0 };
    const rubberMat = new THREE.MeshBasicMaterial({ color: 0x050505, map: T.streak, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    rubberMat.onBeforeCompile = function (sh) {
      sh.uniforms.uNow = U_NOW;
      sh.vertexShader = "attribute vec3 aFade;\nuniform float uNow;\nvarying float vA;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n  vA = aFade.z > 0.5 ? aFade.y * 0.55 : aFade.y * 0.85 * clamp(1.0 - (uNow - aFade.x) / 45.0, 0.0, 1.0);");
      sh.fragmentShader = "varying float vA;\n" + sh.fragmentShader.replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\n  diffuseColor.a *= vA;");
    };
    const rubber = new THREE.Mesh(tGeo, rubberMat); rubber.name = "tyremarks"; rubber.renderOrder = 1;
    rubber.matrixAutoUpdate = false; rubber.updateMatrix();

    // live marks: strips that continue while a wheel keeps sliding
    const strips = []; for (let i = 0; i < 24; i++) strips.push({ x: 0, z: 0, t: -9, s: 0, L: [0, 0, 0], R: [0, 0, 0], v: 0 });
    let ring = 0, dirtyLo = Infinity, dirtyHi = -1, now = 0;
    const NR = {}, cL = [0, 0, 0], cR = [0, 0, 0];
    function corners(x, z, yaw, w, hint, outL, outR) {
      core.nearest(x, z, hint, NR);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);             // car's left = (cos yaw, -sin yaw)
      const lx = cy * w / 2, lz = -sy * w / 2;
      core.frame(NR.s, F2);
      const du = lx * F2.nx + lz * F2.nz;
      const yOf = (u) => core.surfaceY(NR.s, u) + (u > D.INNER && u < D.WALL_U ? crown(u) : 0) + 0.02;
      outL[0] = x + lx; outL[2] = z + lz; outL[1] = yOf(NR.u + du);
      outR[0] = x - lx; outR[2] = z - lz; outR[1] = yOf(NR.u - du);
      return NR.s;
    }
    function skid(x, y, z, yaw, width, strength) {
      width = width || 0.3; strength = strength == null ? 1 : strength;
      let best = null, bd = 3.24;
      for (const st of strips) {
        if (now - st.t > 0.35) continue;
        const d = (x - st.x) * (x - st.x) + (z - st.z) * (z - st.z);
        if (d < bd && d > 0.0004) { bd = d; best = st; }
      }
      if (best) {
        const s = corners(x, z, yaw, width, best.s, cL, cR);
        const len = Math.sqrt(bd), v1 = best.v + len / 1.2;
        const q = PERM + ring; ring = (ring + 1) % RING;
        putQuad(q, best.L, best.R, cL, cR, best.v, v1, now, strength, 0);
        dirtyLo = Math.min(dirtyLo, q); dirtyHi = Math.max(dirtyHi, q);
        best.x = x; best.z = z; best.t = now; best.s = s; best.v = v1;
        best.L[0] = cL[0]; best.L[1] = cL[1]; best.L[2] = cL[2]; best.R[0] = cR[0]; best.R[1] = cR[1]; best.R[2] = cR[2];
      } else {
        // start a strip: the oldest slot
        let o = strips[0]; for (const st of strips) if (st.t < o.t) o = st;
        const fx = Math.sin(yaw) * 0.25, fz = Math.cos(yaw) * 0.25;
        const s = corners(x - fx, z - fz, yaw, width, null, o.L, o.R);
        o.x = x - fx; o.z = z - fz; o.t = now; o.s = s; o.v = 0;
        // lay the first short piece at once
        const s2 = corners(x, z, yaw, width, s, cL, cR);
        const q = PERM + ring; ring = (ring + 1) % RING;
        putQuad(q, o.L, o.R, cL, cR, 0, 0.4, now, strength, 0);
        dirtyLo = Math.min(dirtyLo, q); dirtyHi = Math.max(dirtyHi, q);
        o.x = x; o.z = z; o.s = s2; o.v = 0.4;
        o.L[0] = cL[0]; o.L[1] = cL[1]; o.L[2] = cL[2]; o.R[0] = cR[0]; o.R[1] = cR[1]; o.R[2] = cR[2];
      }
    }
    function flush() {
      if (dirtyHi < 0) return;
      for (const [a, per] of [[aPos, 12], [aUV, 8], [aFade, 12]]) {
        a.updateRange.offset = dirtyLo * per; a.updateRange.count = (dirtyHi - dirtyLo + 1) * per; a.needsUpdate = true;
      }
      dirtyLo = Infinity; dirtyHi = -1;
    }

    // ---- emit -------------------------------------------------------------------------------
    B.emit(THREE, group, M);
    group.add(rubber);
    group.traverse((o) => { if (o.isMesh && o.name === "grass") o.renderOrder = -1; });

    function update(dt) { now += dt || 0; U_NOW.value = now; flush(); }
    function dispose() {
      group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      for (const k in M) if (M[k]) M[k].dispose();
      rubberMat.dispose();
      for (const k in T) if (T[k]) T[k].dispose();
      if (signs.tex) signs.tex.dispose();
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, skid, dispose, seams: seams.slice(), spots };
  }

  /* THE SIGN ATLAS (1024x1024): the SAFER steel face, eight invented
     sponsors, a flag, flat colour chips. Shared by the venue. */
  const SPONSORS = [
    ["VARRO FUEL", "#c8102e", "#ffffff", 0], ["KELDRIN TIRES", "#111111", "#f2c230", 1], ["BRAKEWELL", "#0b3d91", "#ffffff", 2],
    ["TRAXIS", "#f36f21", "#141414", 3], ["NORVANE", "#ffffff", "#0a5c36", 0], ["SUNHOLT", "#ffd200", "#b31b1b", 2],
    ["QUILLON", "#2a2a2e", "#35c4f0", 1], ["OSSEN OIL", "#006a4e", "#ffffff", 3],
  ];
  function signAtlas(THREE) {
    const A = 1024, cv = canvas(A, A);
    const rect = (x, y, w, h) => [x, y, w, h];
    const out = {
      safer: rect(0, 0, 512, 128), black: rect(520, 8, 48, 48), white: rect(584, 8, 48, 48), yellow: rect(648, 8, 48, 48), glass: rect(712, 8, 48, 48),
      flag: rect(520, 64, 304, 160), checker: rect(840, 64, 160, 96), sponsors: [], sponsorsWide: [],
    };
    for (let i = 0; i < 8; i++) out.sponsors.push(rect((i & 1) * 512, 256 + (i >> 1) * 128, 512, 128));
    for (let i = 0; i < 4; i++) out.sponsorsWide.push(rect(0, 768 + i * 64, 1024, 64));
    out.uv = function (r, fu0, fv0, fu1, fv1) {
      // order a(u0,top) b(u1,top) c(u1,bottom) d(u0,bottom), with v0 = the TOP edge of the tile
      const p = 1.5;
      const x0 = (r[0] + p + (r[2] - 2 * p) * fu0) / A, x1 = (r[0] + p + (r[2] - 2 * p) * fu1) / A;
      const y0 = 1 - (r[1] + p + (r[3] - 2 * p) * fv0) / A, y1 = 1 - (r[1] + p + (r[3] - 2 * p) * fv1) / A;
      return [x0, y0, x1, y0, x1, y1, x0, y1];
    };
    /* uv for a quad listed bottom-left, bottom-right, top-right, top-left */
    out.uvBL = function (r, fu0, fu1) { const t = out.uv(r, fu0 == null ? 0 : fu0, 0, fu1 == null ? 1 : fu1, 1); return [t[6], t[7], t[4], t[5], t[2], t[3], t[0], t[1]]; };
    out.tex = null;
    if (!cv) return out;
    const g = cv.getContext("2d");
    g.fillStyle = "#808080"; g.fillRect(0, 0, A, A);
    // SAFER face: white-painted steel tubes with dark gaps between them
    { const [x, y, w, h] = out.safer; g.fillStyle = "#ecebe6"; g.fillRect(x, y, w, h);
      g.fillStyle = "#3a3c40"; for (const f of [0.26, 0.51, 0.76]) g.fillRect(x, y + h * f, w, 4);
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x, y + h - 10, w, 10);
      g.fillStyle = "rgba(20,20,20,0.35)"; for (let i = 0; i < 60; i++) g.fillRect(x + Math.random() * w, y + h * (0.55 + Math.random() * 0.4), 6 + Math.random() * 30, 2); }
    const chip = (r, c) => { g.fillStyle = c; g.fillRect(r[0], r[1], r[2], r[3]); };
    chip(out.black, "#0b0b0c"); chip(out.white, "#f2f2ee"); chip(out.yellow, "#e8b81e"); chip(out.glass, "#1d2a3a");
    // the flag
    { const [x, y, w, h] = out.flag;
      for (let i = 0; i < 13; i++) { g.fillStyle = i & 1 ? "#ffffff" : "#b22234"; g.fillRect(x, y + i * h / 13, w, h / 13 + 1); }
      g.fillStyle = "#3c3b6e"; g.fillRect(x, y, w * 0.4, h * 7 / 13);
      g.fillStyle = "#ffffff"; for (let r = 0; r < 9; r++) for (let c = 0; c < (r & 1 ? 5 : 6); c++) g.fillRect(x + 6 + c * 20 + (r & 1 ? 10 : 0), y + 5 + r * 9.2, 3, 3); }
    { const [x, y, w, h] = out.checker; for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) & 1 ? "#0d0d0e" : "#f2f2ee"; g.fillRect(x + i * w / 10, y + j * h / 6, w / 10 + 0.5, h / 6 + 0.5); } }
    // sponsors
    const logo = (x, y, h, kind, c) => {
      g.fillStyle = c; g.strokeStyle = c; g.lineWidth = h * 0.12;
      if (kind === 0) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + h * 0.55, y); g.lineTo(x + h * 1.1, y + h); g.closePath(); g.fill(); }
      else if (kind === 1) { g.beginPath(); g.arc(x + h / 2, y + h / 2, h * 0.42, 0, 7); g.stroke(); g.beginPath(); g.arc(x + h / 2, y + h / 2, h * 0.16, 0, 7); g.fill(); }
      else if (kind === 2) { for (let k = 0; k < 3; k++) g.fillRect(x + k * h * 0.3, y + h * 0.15, h * 0.18, h * 0.7); }
      else { g.beginPath(); g.moveTo(x, y + h * 0.2); g.lineTo(x + h * 0.6, y + h * 0.5); g.lineTo(x, y + h * 0.8); g.lineTo(x + h * 0.25, y + h * 0.5); g.closePath(); g.fill(); }
    };
    const word = (txt, x, y, w, h, c, px) => {
      g.fillStyle = c; g.textAlign = "center"; g.textBaseline = "middle";
      let size = px; g.font = "900 " + size + "px Impact, 'Arial Black', 'Oswald', sans-serif";
      const m = g.measureText(txt); if (m && m.width > w) { size = Math.floor(size * w / m.width); g.font = "900 " + size + "px Impact, 'Arial Black', 'Oswald', sans-serif"; }
      g.fillText(txt, x + w / 2, y + h / 2 + 2);
    };
    SPONSORS.forEach((sp, i) => {
      const [x, y, w, h] = out.sponsors[i];
      g.fillStyle = sp[1]; g.fillRect(x, y, w, h);
      g.fillStyle = sp[2]; g.fillRect(x, y + h - 8, w, 3);
      logo(x + 22, y + 26, 72, sp[3], sp[2]);
      word(sp[0], x + 110, y + 8, w - 130, h - 16, sp[2], 78);
    });
    for (let i = 0; i < 4; i++) {
      const [x, y, w, h] = out.sponsorsWide[i], a = SPONSORS[i * 2], b = SPONSORS[i * 2 + 1];
      g.fillStyle = a[1]; g.fillRect(x, y, w / 2, h); g.fillStyle = b[1]; g.fillRect(x + w / 2, y, w / 2, h);
      word(a[0], x + 20, y, w / 2 - 40, h, a[2], 48); word(b[0], x + w / 2 + 20, y, w / 2 - 40, h, b[2], 48);
    }
    out.tex = tex(THREE, cv, false);
    return out;
  }
  kit.signAtlas = signAtlas;
  kit.SPONSORS = SPONSORS;

  const api = { build, kit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.track = api;
  }
})(typeof window !== "undefined" ? window : null);
