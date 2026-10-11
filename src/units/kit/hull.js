/* ============================================================
   units/kit/hull.js — CBZ.hullKit: THE WHEELED-VEHICLE BODY KIT.

   What a wheeled vehicle file (src/units/vehicles/<id>.js) builds its body
   from, so the Humvee and the M35 (and the Stryker, the technical, the HIMARS
   when their agents want it) do not each grow a private geometry library.
   It is the body half; CBZ.vehicleDrive (kit/vehicle.js) stays the maths half.

   1. GEOMETRY  HK.geo() -> G, a bucket per material key, raw triangles with
                explicit normals (winding is fixed from the normal, so no caller
                ever gets a face inside out):
                  G.box  G.cyl  G.sphere  G.loft  G.sect  G.prof  G.lathe  G.grid
                  G.save/tf/restore (a transform stack), G.c(colour) per part
                G.build() -> { key: BufferGeometry } with box-projected UVs (the
                camouflage texture lands on every face at true scale) and
                per-vertex weathering: mud up the lower body, dark undersides.
   2. PAINT     HK.scheme(nation, arena) -> scheme id; HK.mats(scheme) -> the
                shared materials (camouflage paint, canvas, gunmetal, rubber,
                armoured glass, lamps, crew). The paint is a real pattern per
                nation and ground: NATO three-tone, CARC tan, Gulf sand, Nordic
                splinter, two-tone olive/sand, olive drab, winter whitewash.
                HK.flagMat(nation): the side's flag (city/flags.js) as a decal.
   3. WHEELS    HK.tyre(r, w, o) / HK.rim(...) geometry; the rig poses them as
                one InstancedMesh per part per vehicle.
   4. RIG       HK.WheeledRig(o): the per-vehicle controller, on the vehicle
                contract (docs/npcwar/ARCHITECTURE.md): mark(nation, ground,
                side), fire(shot), damage(vs, res), muzzleWorld(out),
                aimTurret(rel, el, dt), settle(); HK.animate(veh, dt, ctx) is a
                def's animate and runs update(dt, v, w, steer, veh, ctx) alive,
                wrecked(dt, veh) dead. It spins and
                steers the wheels (Ackermann), runs each wheel's suspension over
                the real ground (CBZ.floorAt), springs the body (squat, dive,
                roll), scans with the gun when nothing is in sight, kicks the gun
                on every round, shows the crew who are actually aboard, and
                draws the exhaust, the dust, the damage smoke, the fire and the
                burnt-out wreck.
   5. FX        HK.fx(n, additive): a world-space particle pool (one Points
                draw, soft sprites, fog-aware) parented to the vehicle so it
                leaves with it.

   Conventions: metres, ground at y=0, nose +Z, +X is the vehicle's LEFT
   (driver side on a US vehicle). Pure functions until build time: loads in
   node without THREE (tools/npcwar-check.mjs). Every load redefines the kit,
   which is what lets the shot service hot-swap it.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI;
  function T() { return W.THREE; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
  function rngOf(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // sRGB hex -> linear [r, g, b] (vertex colours and plain material colours
  // are linear in r128 with an sRGB output; the textures are tagged sRGB)
  function lin(hex) {
    const f = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
  }

  /* ================================================================ 1. GEOMETRY */
  // affine: [r00 r01 r02 r10 r11 r12 r20 r21 r22 tx ty tz]
  function aff(x, y, z, rx, ry, rz) {
    const a = Math.cos(rx || 0), b = Math.sin(rx || 0), c = Math.cos(ry || 0), d = Math.sin(ry || 0), e = Math.cos(rz || 0), f = Math.sin(rz || 0);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    // three's Euler XYZ: R = Rx Ry Rz
    return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c, x || 0, y || 0, z || 0];
  }
  function mul(A, B) {
    const o = new Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
      o[9 + r] = A[r * 3] * B[9] + A[r * 3 + 1] * B[10] + A[r * 3 + 2] * B[11] + A[9 + r];
    }
    return o;
  }
  function tp(M, p) { return [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[9], M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + M[10], M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + M[11]]; }
  function tn(M, n) { return [M[0] * n[0] + M[1] * n[1] + M[2] * n[2], M[3] * n[0] + M[4] * n[1] + M[5] * n[2], M[6] * n[0] + M[7] * n[1] + M[8] * n[2]]; }
  const ID = aff(0, 0, 0, 0, 0, 0);
  const AX = { x: aff(0, 0, 0, 0, 0, -PI / 2), y: ID, z: aff(0, 0, 0, PI / 2, 0, 0) };
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  function Geo() {
    this.b = {};            // key -> { P: [], N: [], C: [], raw: bool }
    this.key = "paint";
    this.col = [1, 1, 1];
    this.M = ID;
    this.stack = [];
  }
  const GP = Geo.prototype;
  GP.m = function (key) { this.key = key; return this; };
  // part colour: a multiplier on the material (paint) or the colour itself (crew)
  // (a number <= 1 is a plain grey multiplier, a bigger one an sRGB hex)
  GP.c = function (c) { this.col = typeof c === "number" ? (c <= 1 ? [c, c, c] : lin(c)) : (c || [1, 1, 1]); return this; };
  GP.save = function () { this.stack.push([this.M, this.key, this.col]); return this; };
  GP.restore = function () { const s = this.stack.pop(); if (s) { this.M = s[0]; this.key = s[1]; this.col = s[2]; } return this; };
  GP.tf = function (x, y, z, rx, ry, rz) { this.M = mul(this.M, aff(x, y, z, rx, ry, rz)); return this; };
  GP.bucket = function () {
    let b = this.b[this.key];
    if (!b) b = this.b[this.key] = { P: [], N: [], C: [] };
    return b;
  };
  // one triangle in LOCAL part space through matrix L; winding follows the normals
  GP.tri = function (L, a, b, c, na, nb, nc) {
    const M = L ? mul(this.M, L) : this.M;
    let A = tp(M, a), B = tp(M, b), C = tp(M, c);
    let NA = norm(tn(M, na)), NB = norm(tn(M, nb || na)), NC = norm(tn(M, nc || na));
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-14) return;
    if (gx * (NA[0] + NB[0] + NC[0]) + gy * (NA[1] + NB[1] + NC[1]) + gz * (NA[2] + NB[2] + NC[2]) < 0) {
      let t = B; B = C; C = t; t = NB; NB = NC; NC = t;
    }
    const k = this.bucket(), col = this.col;
    k.P.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    k.N.push(NA[0], NA[1], NA[2], NB[0], NB[1], NB[2], NC[0], NC[1], NC[2]);
    k.C.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  };
  GP.quad = function (L, a, b, c, d, n) { this.tri(L, a, b, c, n); this.tri(L, a, c, d, n); };
  // BOX centred at (x,y,z), size w h d, rotated rx ry rz (Euler XYZ)
  GP.box = function (x, y, z, w, h, d, rx, ry, rz) {
    const L = aff(x, y, z, rx, ry, rz), X = w / 2, Y = h / 2, Z = d / 2;
    this.quad(L, [X, -Y, -Z], [X, Y, -Z], [X, Y, Z], [X, -Y, Z], [1, 0, 0]);
    this.quad(L, [-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z], [-1, 0, 0]);
    this.quad(L, [-X, Y, -Z], [-X, Y, Z], [X, Y, Z], [X, Y, -Z], [0, 1, 0]);
    this.quad(L, [-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z], [0, -1, 0]);
    this.quad(L, [-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z], [0, 0, 1]);
    this.quad(L, [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z], [X, -Y, -Z], [0, 0, -1]);
    return this;
  };
  // CYLINDER along `axis` (x|y|z), rTop at the + end. opts: { flat, open, a0, a1 (arc) }
  GP.cyl = function (x, y, z, rTop, rBot, len, axis, seg, rx, ry, rz, opts) {
    opts = opts || {};
    seg = seg || 12;
    const L = mul(aff(x, y, z, rx, ry, rz), AX[axis || "y"]);
    const h = len / 2, sl = (rBot - rTop) / len;
    const a0 = opts.a0 || 0, a1 = opts.a1 == null ? 2 * PI : opts.a1, full = a1 - a0 >= 2 * PI - 1e-6;
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const p0 = [c0 * rBot, -h, s0 * rBot], p1 = [c1 * rBot, -h, s1 * rBot], p2 = [c1 * rTop, h, s1 * rTop], p3 = [c0 * rTop, h, s0 * rTop];
      if (opts.flat) {
        const cm = Math.cos((t0 + t1) / 2), sm = Math.sin((t0 + t1) / 2), n = [cm, sl, sm];
        this.quad(L, p0, p1, p2, p3, n);
      } else {
        const n0 = [c0, sl, s0], n1 = [c1, sl, s1];
        this.tri(L, p0, p1, p2, n0, n1, n1); this.tri(L, p0, p2, p3, n0, n1, n0);
      }
      if (!opts.open) {
        if (rTop > 1e-4) this.tri(L, [0, h, 0], p3, p2, [0, 1, 0]);
        if (rBot > 1e-4) this.tri(L, [0, -h, 0], p1, p0, [0, -1, 0]);
      }
    }
    if (!full && !opts.open) {
      // close an arc's two cut faces
      [a0, a1].forEach(function (t, k) {
        const c = Math.cos(t), s = Math.sin(t);
        const n = k === 0 ? [s, 0, -c] : [-s, 0, c];
        this.quad(L, [0, -h, 0], [c * rBot, -h, s * rBot], [c * rTop, h, s * rTop], [0, h, 0], n);
      }, this);
    }
    return this;
  };
  // TUBE between two points a -> b (a limb, a bar, a strut), radii r0 at a, r1 at b
  GP.tube = function (a, b, r0, r1, seg) {
    seg = seg || 7;
    const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const ring = function (p, r, t) { const c = Math.cos(t), s = Math.sin(t); return [p[0] + (u[0] * c + v[0] * s) * r, p[1] + (u[1] * c + v[1] * s) * r, p[2] + (u[2] * c + v[2] * s) * r]; };
    const nrm = function (t) { const c = Math.cos(t), s = Math.sin(t); return [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]; };
    for (let i = 0; i < seg; i++) {
      const t0 = i * 2 * PI / seg, t1 = (i + 1) * 2 * PI / seg;
      this.tri(null, ring(a, r0, t0), ring(a, r0, t1), ring(b, r1, t1), nrm(t0), nrm(t1), nrm(t1));
      this.tri(null, ring(a, r0, t0), ring(b, r1, t1), ring(b, r1, t0), nrm(t0), nrm(t1), nrm(t0));
      this.tri(null, a, ring(a, r0, t1), ring(a, r0, t0), [-d[0], -d[1], -d[2]]);
      this.tri(null, b, ring(b, r1, t0), ring(b, r1, t1), d);
    }
    return this;
  };
  // ELLIPSOID (or a cap of one: v0..v1 of the polar angle, 0 = top)
  GP.sphere = function (x, y, z, r, seg, sx, sy, sz, v0, v1, rx, ry, rz) {
    seg = seg || 10;
    sx = sx || 1; sy = sy || 1; sz = sz || 1;
    v0 = v0 || 0; v1 = v1 == null ? PI : v1;
    const L = aff(x, y, z, rx, ry, rz), rows = Math.max(3, Math.round(seg * (v1 - v0) / PI));
    const P = function (u, v) { return [Math.sin(v) * Math.cos(u) * r * sx, Math.cos(v) * r * sy, Math.sin(v) * Math.sin(u) * r * sz]; };
    const Nn = function (u, v) { return norm([Math.sin(v) * Math.cos(u) / sx, Math.cos(v) / sy, Math.sin(v) * Math.sin(u) / sz]); };
    for (let j = 0; j < rows; j++) {
      const va = v0 + (v1 - v0) * j / rows, vb = v0 + (v1 - v0) * (j + 1) / rows;
      for (let i = 0; i < seg * 2; i++) {
        const ua = i * PI / seg, ub = (i + 1) * PI / seg;
        this.tri(L, P(ua, va), P(ub, va), P(ub, vb), Nn(ua, va), Nn(ub, va), Nn(ub, vb));
        this.tri(L, P(ua, va), P(ub, vb), P(ua, vb), Nn(ua, va), Nn(ub, vb), Nn(ua, vb));
      }
    }
    if (v1 < PI - 1e-3) {             // close a cap's open rim
      const yb = Math.cos(v1) * r * sy;
      for (let i = 0; i < seg * 2; i++) {
        const ua = i * PI / seg, ub = (i + 1) * PI / seg;
        this.tri(L, [0, yb, 0], P(ub, v1), P(ua, v1), [0, -1, 0]);
      }
    }
    return this;
  };
  /* LOFT — a flat-shaded solid through CONVEX slices along one axis. Faces are
     oriented away from the local slab centre (convex slices make that exact).
       'x': pts [z, y] (side profile)  'y': pts [x, z] (plan)  'z': pts [x, y] (section) */
  GP.loft = function (axis, slices) {
    const V = axis === "z" ? function (a, p, q) { return [p, q, a]; }
      : axis === "y" ? function (a, p, q) { return [p, a, q]; }
        : function (a, p, q) { return [a, q, p]; };
    const rings = slices.map(function (s) { return s.pts.map(function (pt) { return V(s.a, pt[0], pt[1]); }); });
    const cent = rings.map(function (r) {
      const c = [0, 0, 0];
      for (let i = 0; i < r.length; i++) { c[0] += r[i][0]; c[1] += r[i][1]; c[2] += r[i][2]; }
      return [c[0] / r.length, c[1] / r.length, c[2] / r.length];
    });
    const self = this;
    function face(A, B, C, ref) {
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) return;
      n = [n[0] / l, n[1] / l, n[2] / l];
      const m = [(A[0] + B[0] + C[0]) / 3 - ref[0], (A[1] + B[1] + C[1]) / 3 - ref[1], (A[2] + B[2] + C[2]) / 3 - ref[2]];
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
      self.tri(null, A, B, C, n);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1], n = r0.length;
      const ref = [(cent[i][0] + cent[i + 1][0]) / 2, (cent[i][1] + cent[i + 1][1]) / 2, (cent[i][2] + cent[i + 1][2]) / 2];
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        face(r0[j], r0[k], r1[k], ref);
        face(r0[j], r1[k], r1[j], ref);
      }
    }
    const last = rings.length - 1;
    [[0, 1], [last, last - 1]].forEach(function (pr) {
      const r = rings[pr[0]], c = cent[pr[0]], ref = cent[pr[1]];
      for (let j = 0; j < r.length; j++) face(c, r[j], r[(j + 1) % r.length], ref);
    });
    return this;
  };
  GP.sect = function (slices) { return this.loft("z", slices.map(function (s) { return { a: s[0], pts: s[1] }; })); };
  GP.prof = function (x0, x1, pts, pts1) { return this.loft("x", [{ a: x0, pts: pts }, { a: x1, pts: pts1 || pts }]); };
  GP.plan = function (slices) { return this.loft("y", slices.map(function (s) { return { a: s[0], pts: s[1] }; })); };
  // LATHE about the X axis: profile [[radius, x], ...] (open ends), smooth
  GP.lathe = function (prof, seg, L0) {
    const L = L0 || ID, n = prof.length, nr = [];
    for (let i = 0; i < n; i++) {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)];
      const dr = b[0] - a[0], dx = b[1] - a[1];
      nr.push(norm([-dr, dx, 0]).slice(0, 2));      // (x-component, radial-component)
    }
    // orient: the widest point's normal points away from the axis
    let wi = 0;
    for (let i = 0; i < n; i++) if (prof[i][0] > prof[wi][0]) wi = i;
    const sg = nr[wi][1] < 0 ? -1 : 1;
    for (let j = 0; j < seg; j++) {
      const t0 = j * 2 * PI / seg, t1 = (j + 1) * 2 * PI / seg;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      for (let i = 0; i < n - 1; i++) {
        const A = prof[i], B = prof[i + 1], na = nr[i], nb = nr[i + 1];
        const p00 = [A[1], A[0] * c0, A[0] * s0], p01 = [A[1], A[0] * c1, A[0] * s1];
        const p10 = [B[1], B[0] * c0, B[0] * s0], p11 = [B[1], B[0] * c1, B[0] * s1];
        const n00 = [sg * na[0], sg * na[1] * c0, sg * na[1] * s0], n01 = [sg * na[0], sg * na[1] * c1, sg * na[1] * s1];
        const n10 = [sg * nb[0], sg * nb[1] * c0, sg * nb[1] * s0], n11 = [sg * nb[0], sg * nb[1] * c1, sg * nb[1] * s1];
        this.tri(L, p00, p01, p11, n00, n01, n11);
        this.tri(L, p00, p11, p10, n00, n11, n10);
      }
    }
    return this;
  };
  /* GRID — a smooth surface through rows of points (rows[j][i] = [x,y,z]),
     both faces when `two` (canvas: the inside is seen from the open tail). */
  GP.grid = function (rows, two, inCol) {
    const J = rows.length, I = rows[0].length, NN = [];
    for (let j = 0; j < J; j++) {
      NN.push([]);
      for (let i = 0; i < I; i++) {
        const a = rows[j][Math.max(0, i - 1)], b = rows[j][Math.min(I - 1, i + 1)];
        const c = rows[Math.max(0, j - 1)][i], d = rows[Math.min(J - 1, j + 1)][i];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        NN[j].push(norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]));
      }
    }
    const self = this;
    function sheet(flip) {
      for (let j = 0; j < J - 1; j++) {
        for (let i = 0; i < I - 1; i++) {
          const f = function (n) { return flip ? [-n[0], -n[1], -n[2]] : n; };
          self.tri(null, rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], f(NN[j][i]), f(NN[j][i + 1]), f(NN[j + 1][i + 1]));
          self.tri(null, rows[j][i], rows[j + 1][i + 1], rows[j + 1][i], f(NN[j][i]), f(NN[j + 1][i + 1]), f(NN[j + 1][i]));
        }
      }
    }
    sheet(false);
    if (two) { const keep = this.col; if (inCol) this.c(inCol); sheet(true); this.col = keep; }
    return this;
  };

  /* THE BUILD. Box-projected UVs at `uv` metres per texture tile, weathering
     in the vertex colour: mud up to `mud` metres, undersides in shadow. */
  GP.build = function (o) {
    const THREE = T();
    o = o || {};
    const uvS = 1 / (o.uv || 2.6), mudTop = o.mud == null ? 0.85 : o.mud;
    const mudC = o.mudCol || [0.70, 0.62, 0.50];
    const out = {};
    const self = this;
    Object.keys(this.b).forEach(function (key) {
      const k = self.b[key], n = k.P.length / 3;
      if (!n) return;
      const raw = o.raw && o.raw[key];
      const P = new Float32Array(k.P), N = new Float32Array(k.N), C = new Float32Array(k.C), U = new Float32Array(n * 2);
      for (let t = 0; t < n; t += 3) {
        const i = t * 3;
        const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
        const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
        const gx = Math.abs(uy * vz - uz * vy), gy = Math.abs(uz * vx - ux * vz), gz = Math.abs(ux * vy - uy * vx);
        for (let q = 0; q < 3; q++) {
          const j = t + q, x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
          let a, b;
          if (gx >= gy && gx >= gz) { a = z; b = y; } else if (gy >= gz) { a = x; b = z; } else { a = x; b = y; }
          U[j * 2] = a * uvS; U[j * 2 + 1] = b * uvS;
          if (raw) continue;
          let f = 1;
          const ny = N[j * 3 + 1];
          if (ny < -0.35) f *= 0.62 + 0.38 * (1 + ny) / 0.65;           // undersides
          const m = mudTop > 0 ? Math.pow(clamp((mudTop - y) / mudTop, 0, 1), 1.4) * 0.85 : 0;
          C[j * 3] *= f * (1 - m * (1 - mudC[0]));
          C[j * 3 + 1] *= f * (1 - m * (1 - mudC[1]));
          C[j * 3 + 2] *= f * (1 - m * (1 - mudC[2]));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      g.setAttribute("color", new THREE.BufferAttribute(C, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      out[key] = g;
    });
    this.b = {};
    return out;
  };

  /* ================================================================ 2. PAINT */
  /* Real schemes, sRGB. NATO three-tone is the CARC green/brown/black of
     every US and German vehicle in Europe; CARC tan 686A is the Gulf War and
     Iraq colour; the Kingdom of Kesh paints its army Gulf sand; Veridia's
     Nordic army wears a splinter pattern; Solara two-tone olive and sand;
     Mbeya plain olive drab. In snow everyone whitewashes over the base. */
  const SCHEMES = {
    nato3: { base: "#4d5638", layers: [{ col: "#5d4b34", n: 15, r: [38, 80], st: 1.7 }, { col: "#202119", n: 15, r: [16, 34], st: 1.9 }], uniform: 0x6c6c4e, vest: 0x5e6046, canvas: "#57593b", gear: 0x4b4d36 },
    tan: { base: "#b19a74", layers: [], uniform: 0xa38d68, vest: 0x8c7a58, canvas: "#a08c64", gear: 0x8d7b5a },
    sand: { base: "#c7b089", layers: [{ col: "#b8a07a", n: 10, r: [50, 110], st: 1.4 }], uniform: 0xb39f7c, vest: 0x9a8662, canvas: "#ad9a72", gear: 0x9a8662 },
    splinter: { base: "#6c7752", layers: [{ col: "#3e4b2e", n: 26, shard: 1 }, { col: "#1f241c", n: 12, shard: 1 }, { col: "#8a8d6f", n: 9, shard: 1 }], uniform: 0x5f6a48, vest: 0x4e5a3c, canvas: "#59603f", gear: 0x4e5a3c },
    solara: { base: "#585c3c", layers: [{ col: "#b39d72", n: 13, r: [40, 92], st: 1.5 }], uniform: 0x8f8460, vest: 0x6b6646, canvas: "#62603f", gear: 0x6b6646 },
    olive: { base: "#4d4c30", layers: [{ col: "#45442b", n: 8, r: [60, 120], st: 1.2 }], uniform: 0x55553a, vest: 0x46462f, canvas: "#4f4e33", gear: 0x46462f },
    winter: { base: "#dfe2e0", layers: [{ col: "#4d5638", n: 16, r: [14, 46], st: 2.2 }, { col: "#c9cdcc", n: 10, r: [40, 80], st: 1.6 }], uniform: 0xd8dbd8, vest: 0xbfc3c0, canvas: "#d4d7d4", gear: 0x9da199 },
  };
  // ground: the battle's `ground` (the open maps' skin sand|snow|grass, or a
  // map id: city, island, field, arena, dunes...)
  function scheme(nation, ground, team) {
    nation = nation || (team === "red" ? "kesh" : "republic");
    if (ground === "snow") return "winter";
    const desert = ground === "sand" || ground === "dunes";
    switch (nation) {
      case "kesh": return "sand";
      case "veridia": return desert ? "tan" : "splinter";
      case "solara": return desert ? "sand" : "solara";
      case "mbeya": return "olive";
      default: return desert ? "tan" : "nato3";
    }
  }
  function canvasEl(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  // a smooth blob, tiled so the pattern has no seam
  function blob(g, S, cx, cy, r, st, rot, rnd) {
    const k = 9, pts = [];
    for (let i = 0; i < k; i++) {
      const a = i * 2 * PI / k, rr = r * (0.55 + rnd() * 0.65);
      const x = Math.cos(a) * rr * st, y = Math.sin(a) * rr;
      pts.push([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      g.beginPath();
      const m0 = [(pts[0][0] + pts[k - 1][0]) / 2, (pts[0][1] + pts[k - 1][1]) / 2];
      g.moveTo(cx + ox + m0[0], cy + oy + m0[1]);
      for (let i = 0; i < k; i++) {
        const p = pts[i], q = pts[(i + 1) % k];
        g.quadraticCurveTo(cx + ox + p[0], cy + oy + p[1], cx + ox + (p[0] + q[0]) / 2, cy + oy + (p[1] + q[1]) / 2);
      }
      g.closePath(); g.fill();
    }
  }
  function shard(g, S, cx, cy, rnd) {
    const k = 3 + Math.floor(rnd() * 3), pts = [];
    const L = 40 + rnd() * 90, a0 = rnd() * PI;
    for (let i = 0; i < k; i++) {
      const a = a0 + i * 2 * PI / k + (rnd() - 0.5) * 0.9, rr = L * (0.3 + rnd() * 0.7);
      pts.push([Math.cos(a) * rr * 1.6, Math.sin(a) * rr * 0.7]);
    }
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      g.beginPath();
      g.moveTo(cx + ox + pts[0][0], cy + oy + pts[0][1]);
      for (let i = 1; i < k; i++) g.lineTo(cx + ox + pts[i][0], cy + oy + pts[i][1]);
      g.closePath(); g.fill();
    }
  }
  // grain: per-pixel noise, a low-frequency mottle, worn speckles, rain streaks
  function weather(g, S, rnd, amt, streak) {
    const img = g.getImageData(0, 0, S, S), d = img.data;
    const G = 8, mot = [];
    for (let i = 0; i < G * G; i++) mot.push((rnd() - 0.5) * 2);
    const col = [];
    for (let x = 0; x < S; x++) col.push(streak ? (rnd() < 0.08 ? (rnd() - 0.4) * 10 : 0) : 0);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = x / S * G, fy = y / S * G, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const m = function (a, b) { return mot[((b % G) * G + (a % G))]; };
        const mo = (m(ix, iy) * (1 - tx) + m(ix + 1, iy) * tx) * (1 - ty) + (m(ix, iy + 1) * (1 - tx) + m(ix + 1, iy + 1) * tx) * ty;
        const n = (rnd() - 0.5) * amt + mo * amt * 0.9 + col[x];
        const i = (y * S + x) * 4;
        d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 0.9, 0, 255);
      }
    }
    // chipped paint: small pale and dark flecks
    for (let k = 0; k < S * 3; k++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), i = (y * S + x) * 4, v = rnd() < 0.6 ? 22 : -26;
      d[i] = clamp(d[i] + v, 0, 255); d[i + 1] = clamp(d[i + 1] + v, 0, 255); d[i + 2] = clamp(d[i + 2] + v, 0, 255);
    }
    g.putImageData(img, 0, 0);
  }
  const TEX = {};
  function camoTexture(id) {
    const THREE = T();
    if (TEX["c:" + id] !== undefined) return TEX["c:" + id];
    const sc = SCHEMES[id] || SCHEMES.nato3, S = 512, c = canvasEl(S, S);
    if (!c || !THREE) return (TEX["c:" + id] = null);
    const g = c.getContext ? c.getContext("2d") : null, rnd = rngOf(id.length * 977 + id.charCodeAt(0) * 31);
    if (!g || !g.getImageData) return (TEX["c:" + id] = null);
    g.fillStyle = sc.base; g.fillRect(0, 0, S, S);
    sc.layers.forEach(function (L) {
      g.fillStyle = L.col;
      for (let i = 0; i < L.n; i++) {
        if (L.shard) shard(g, S, rnd() * S, rnd() * S, rnd);
        else blob(g, S, rnd() * S, rnd() * S, L.r[0] + rnd() * (L.r[1] - L.r[0]), L.st || 1.5, (rnd() - 0.5) * 0.9, rnd);
      }
    });
    weather(g, S, rnd, id === "winter" ? 9 : 7, true);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return (TEX["c:" + id] = t);
  }
  // cotton duck canvas: weave, seams, creases
  function canvasTexture(id) {
    const THREE = T();
    if (TEX["k:" + id] !== undefined) return TEX["k:" + id];
    const sc = SCHEMES[id] || SCHEMES.nato3, S = 256, c = canvasEl(S, S);
    if (!c || !THREE) return (TEX["k:" + id] = null);
    const g = c.getContext ? c.getContext("2d") : null, rnd = rngOf(id.length * 131 + 7);
    if (!g || !g.getImageData) return (TEX["k:" + id] = null);
    g.fillStyle = sc.canvas; g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.04;
    for (let y = 0; y < S; y += 2) { g.fillStyle = y % 4 ? "#000" : "#fff"; g.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 2) { g.fillStyle = x % 4 ? "#fff" : "#000"; g.fillRect(x, 0, 1, S); }
    g.fillStyle = "#000";
    for (let i = 0; i < 10; i++) {                 // soft creases
      const x = rnd() * S, y = rnd() * S, a = rnd() * PI, l = 40 + rnd() * 90;
      g.globalAlpha = 0.04 + rnd() * 0.04;
      g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-l / 2, -3, l, 6); g.restore();
    }
    g.globalAlpha = 0.16; g.fillRect(0, S / 2 - 1, S, 2);   // a sewn seam
    g.globalAlpha = 1;
    weather(g, S, rnd, 8, false);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return (TEX["k:" + id] = t);
  }
  function colOf(THREE, hex) { const c = new THREE.Color(); const l = lin(hex); c.setRGB(l[0], l[1], l[2]); return c; }
  const MATS = {};
  /* THE MATERIALS of one scheme, shared by every vehicle that wears it. All
     but the glass carry the vertex colour (weathering + part tints). */
  function mats(id) {
    const THREE = T();
    if (MATS[id]) return MATS[id];
    const sc = SCHEMES[id] || SCHEMES.nato3;
    const L = function (hex, o) {
      o = o || {};
      const m = new THREE.MeshLambertMaterial({ color: o.map ? 0xffffff : colOf(THREE, hex), vertexColors: true, map: o.map || null });
      if (o.em) { m.emissive = colOf(THREE, o.em); m.emissiveIntensity = o.ei || 1; }
      return m;
    };
    const paintMap = camoTexture(id), canvasMap = canvasTexture(id);
    const glass = new THREE.MeshPhongMaterial({ color: colOf(THREE, 0x1b2627), specular: colOf(THREE, 0x8fa2a6), shininess: 90 });
    const M = {
      paint: paintMap ? L(0, { map: paintMap }) : L(parseInt(sc.base.slice(1), 16)),
      canvas: canvasMap ? L(0, { map: canvasMap }) : L(parseInt(sc.canvas.slice(1), 16)),
      dark: L(0x2a2b28), metal: L(0x45463f), rubber: L(0x262523), black: L(0x121212),
      glass: glass,
      lamp: L(0xe8e4d2, { em: 0x3a3628 }), amber: L(0xd08422, { em: 0x2a1404 }), tail: L(0x9a1a12, { em: 0x2a0402 }),
      crew: L(0xffffff), gear: L(sc.gear),
      sc: sc,
    };
    return (MATS[id] = M);
  }
  // the side's flag as a decal (city/flags.js, the game's one flag system)
  const FLAGM = {};
  function flagMat(nation) {
    const THREE = T();
    if (!nation || !CBZ.flags || !CBZ.flags.texture) return null;
    if (FLAGM[nation] !== undefined) return FLAGM[nation];
    let tex = null;
    try { tex = CBZ.flags.texture(nation); } catch (e) { tex = null; }
    if (!tex) return (FLAGM[nation] = null);
    const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return (FLAGM[nation] = m);
  }
  function flagRatio(nation) {
    try { const d = CBZ.flags.designFor(nation); if (d && d.ratio) return d.ratio[0] / d.ratio[1]; } catch (e) {}
    return 2 / 3;
  }
  /* decals: quads on the body, each [cx, cy, cz, nx, nz, w] (vertical faces,
     outward normal nx/nz); the flag reads correctly (hoist forward) on both
     sides. One geometry per (type, nation ratio). */
  function decalGeo(list, ratio) {
    const THREE = T();
    const P = [], N = [], U = [];
    list.forEach(function (d) {
      const cx = d[0], cy = d[1], cz = d[2], nx = d[3], nz = d[4], w = d[5], h = w * ratio, o = 0.004;
      // the viewer's right on this face is up x n = (nz, 0, -nx), so A B C
      // below wind CCW seen from outside; the hoist goes toward the nose on
      // both flanks, so the right flank (-x) flips u
      const rx = nz, rz = -nx, flip = nx < -0.5;
      const p = function (s, t) { return [cx + nx * o + rx * s * w / 2, cy + t * h / 2, cz + nz * o + rz * s * w / 2]; };
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        const q = p(c[0], c[1]);
        P.push(q[0], q[1], q[2]); N.push(nx, 0, nz);
        U.push(flip ? (1 - c[0]) / 2 : (c[0] + 1) / 2, (c[1] + 1) / 2);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(U), 2));
    g.computeBoundingSphere();
    return g;
  }
  // meshes from a built bucket set: one draw per material
  function meshes(parent, geos, M, name, shadow) {
    const THREE = T(), out = [];
    Object.keys(geos).forEach(function (k) {
      const mat = M[k];
      if (!mat) return;
      const m = new THREE.Mesh(geos[k], mat);
      m.name = name ? name + ":" + k : k;
      m.userData.hkKey = k;                 // rig.mark swaps the scheme's material by this key
      m.castShadow = shadow !== false; m.receiveShadow = true;
      parent.add(m); out.push(m);
    });
    return out;
  }
  // a crew figure mesh (or an instanced bench of them) that rig.mark can
  // re-dress in the scheme's uniform
  function figMesh(kind, schemeId, skin, M, count, box) {
    const THREE = T();
    const geo = figure(kind, schemeId, skin);
    if (box && !geo._hkBounds) {             // an instanced bench culls with its vehicle
      geo._hkBounds = true;
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3], box[4], box[5]));
      geo.boundingSphere = new THREE.Sphere(); geo.boundingBox.getBoundingSphere(geo.boundingSphere);
    }
    const m = count ? new THREE.InstancedMesh(geo, M.crew, count) : new THREE.Mesh(geo, M.crew);
    m.userData.hkFig = { kind: kind, skin: skin };
    m.userData.hkKey = "crew";
    m.castShadow = false;
    return m;
  }

  /* ================================================================ 3. WHEELS */
  /* A TYRE: lathe-turned carcass (bead, bulging sidewall, square shoulder,
     crowned tread) plus a real lug pattern. `o.lug`: "ndt" (the Humvee's
     non-directional bar tread) or "xtr" (the M35's military cross-country
     chevrons). Centred on the axle, outer face +X. */
  function tyre(G, r, w, rim, o) {
    o = o || {};
    G.m("rubber").c(0xd6d0c6);
    const h = w / 2;
    G.lathe([[rim * 1.02, -h * 0.80], [r * 0.80, -h * 0.98], [r * 0.93, -h * 1.0], [r * 0.985, -h * 0.90], [r * 0.995, -h * 0.55], [r, 0],
      [r * 0.995, h * 0.55], [r * 0.985, h * 0.90], [r * 0.93, h * 1.0], [r * 0.80, h * 0.98], [rim * 1.02, h * 0.80]], 30);
    // lugs proud of the carcass
    const n = o.lugs || 22, dep = o.dep || 0.022;
    for (let i = 0; i < n; i++) {
      const a = i * 2 * PI / n;
      [-1, 1].forEach(function (s) {
        const aa = a + (s > 0 ? PI / n : 0);
        const y = Math.cos(aa) * (r + dep * 0.4), z = Math.sin(aa) * (r + dep * 0.4);
        // Rx(aa) stands the lug's +Y on the radius (0, cos aa, sin aa); the
        // yaw angles it across the tread (a chevron half on the "xtr")
        if (o.lug === "xtr") G.box(s * w * 0.25, y, z, w * 0.46, dep, r * 0.10, aa, s * 0.6, 0);
        else G.box(s * w * 0.27, y, z, w * 0.40, dep, r * 0.15, aa, s * 0.25, 0);
      });
      // shoulder blocks wrap onto the sidewall
      [-1, 1].forEach(function (s) {
        const aa = a + (s > 0 ? PI / n : 0);
        G.box(s * h * 0.97, Math.cos(aa) * r * 0.93, Math.sin(aa) * r * 0.93, 0.02, r * 0.10, r * 0.12, aa, 0, 0);
      });
    }
  }

  /* THE M2HB .50 (Browning), in gun space: pivot at the cradle trunnion, +Z
     down the barrel. 1.65 m overall: receiver with feed cover and backplate,
     spade grips and butterfly trigger, the perforated barrel support, the
     1.14 m barrel, flash hider, carrying handle, the ammunition can and belt
     on the feed (left) side. Returns the muzzle's z. */
  function m2(G) {
    G.m("dark").c(1);
    G.box(0, 0.03, -0.05, 0.13, 0.17, 0.72);
    G.box(0, 0.125, -0.05, 0.12, 0.02, 0.50);
    G.box(0, 0.05, -0.43, 0.15, 0.12, 0.04);
    [-1, 1].forEach(function (s) { G.cyl(s * 0.06, 0.03, -0.50, 0.018, 0.018, 0.12, "y", 6); });
    G.box(0, 0.04, -0.47, 0.06, 0.02, 0.03);
    G.cyl(0, 0.03, 0.43, 0.045, 0.045, 0.24, "z", 10);
    G.m("black").c(1);
    for (let i = 0; i < 4; i++) G.cyl(0, 0.03, 0.34 + i * 0.06, 0.047, 0.047, 0.015, "z", 10);
    G.m("dark").c(1);
    G.cyl(0, 0.03, 0.96, 0.024, 0.026, 0.86, "z", 8);
    G.cyl(0, 0.03, 1.41, 0.030, 0.030, 0.07, "z", 8);
    G.box(0, 0.10, 0.62, 0.03, 0.08, 0.10);
    G.cyl(0, 0.14, 0.62, 0.012, 0.012, 0.16, "z", 6);
    G.m("paint").c(0.8).box(0.15, -0.02, -0.05, 0.11, 0.18, 0.30);
    G.m("dark").c(1);
    for (let i = 0; i < 6; i++) G.box(0.09, 0.07 - i * 0.004, -0.05 + (i - 2.5) * 0.008, 0.04, 0.012, 0.012);
    return 1.46;
  }

  /* ================================================================ 5. FX */
  const FX_VS = [
    "attribute float size; attribute float alpha; attribute vec3 tint;",
    "uniform float uScale; varying float vA; varying vec3 vC;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vA = alpha; vC = tint;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_PointSize = size * uScale / max(0.2, -mvPosition.z);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}"].join("\n");
  const FX_FS = [
    "varying float vA; varying vec3 vC;",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  vec2 p = gl_PointCoord - 0.5; float d = length(p);",
    "  float a = vA * smoothstep(0.5, 0.12, d) * (0.85 + 0.15 * sin(p.x * 23.0 + p.y * 17.0));",
    "  if (a < 0.004) discard;",
    "  gl_FragColor = vec4(vC, a);",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
    "}"].join("\n");
  function Fx(n, additive) {
    const THREE = T();
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n); this.g = new Float32Array(n); this.drag = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.next = 0; this.live = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aTint = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    [this.aPos, this.aSize, this.aAlpha, this.aTint].forEach(function (a) { if (a.setUsage) a.setUsage(THREE.DynamicDrawUsage); });
    geo.setAttribute("position", this.aPos); geo.setAttribute("size", this.aSize);
    geo.setAttribute("alpha", this.aAlpha); geo.setAttribute("tint", this.aTint);
    // an EMPTY box: Box3.setFromObject (cameras, the studio floor, the
    // footprint) must not count a pool that lives at the world origin
    geo.boundingBox = new THREE.Box3();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: FX_VS, fragmentShader: FX_FS, fog: true,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.name = additive ? "fx-glow" : "fx-smoke";
    pts.renderOrder = additive ? 3 : 2;
    // WORLD SPACE, parented to the vehicle so it leaves with it
    pts.matrixAutoUpdate = false;
    pts.updateMatrixWorld = function () { this.matrixWorld.identity(); };
    pts.onBeforeRender = function (renderer, scene, camera) {
      let h = 800;
      try { h = renderer.getDrawingBufferSize ? renderer.getDrawingBufferSize(_v2).y : renderer.domElement.height; } catch (e) {}
      uni.uScale.value = h * 0.5 * camera.projectionMatrix.elements[5];
    };
    this.points = pts;
    for (let i = 0; i < n; i++) this.aAlpha.array[i] = 0;
  }
  let _v2 = null;
  Fx.prototype.emit = function (x, y, z, vx, vy, vz, life, s0, s1, a0, rgb, g, drag) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.col[i * 3] = rgb[0]; this.col[i * 3 + 1] = rgb[1]; this.col[i * 3 + 2] = rgb[2];
    this.g[i] = g || 0; this.drag[i] = drag == null ? 1.2 : drag;
    this.live = Math.max(this.live, 1);
  };
  Fx.prototype.step = function (dt) {
    if (!this.live) return;
    let any = 0;
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, C = this.aTint.array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (A[i] !== 0) A[i] = 0; continue; }
      any++;
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.g[i] * 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      P[i * 3] = this.pos[i * 3]; P[i * 3 + 1] = this.pos[i * 3 + 1]; P[i * 3 + 2] = this.pos[i * 3 + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      // fade in fast, out slow
      A[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
      C[i * 3] = this.col[i * 3]; C[i * 3 + 1] = this.col[i * 3 + 1]; C[i * 3 + 2] = this.col[i * 3 + 2];
    }
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aTint.needsUpdate = true;
    if (!any) { this.live = 0; }
  };

  /* ================================================================ 4. RIG */
  const _m4 = { e: null };
  function mw(root, x, y, z, out) {
    const e = root.matrixWorld.elements;
    out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    return out;
  }
  function dw(root, x, y, z, out) {     // a direction, local -> world
    const e = root.matrixWorld.elements;
    out[0] = e[0] * x + e[4] * y + e[8] * z; out[1] = e[1] * x + e[5] * y + e[9] * z; out[2] = e[2] * x + e[6] * y + e[10] * z;
    return out;
  }
  // particle colours, linear, made once (no allocation per puff)
  const FXC = {
    flash: lin(0xffc070), gas: lin(0xb8b4aa), brass: lin(0xc8a040), soot: lin(0x2c2b29), haze: lin(0x8f9294),
    black: lin(0x1e1d1c), grey: lin(0x6e6c69), fire1: lin(0xff8a2a), fire2: lin(0xffc050),
  };
  const DUST = {                                        // sRGB of what a tyre throws up
    sand: [0xcaa77a, 1.0], dunes: [0xcaa77a, 1.0], grass: [0x9a8a68, 0.55], snow: [0xf2f4f6, 0.9], field: [0xb0a894, 0.35],
    island: [0xb5ab92, 0.45], arena: [0xa8a49a, 0.30], city: [0xa29e96, 0.25], gov: [0xa29e96, 0.25],
    harbor: [0xb0a894, 0.35], marina: [0xb0a894, 0.30], speedway: [0xa8a49a, 0.35],
  };
  /* o = { root, body, wheels:[{x,y,z,r,steer}], tyreIM, rimIM, wheelbase, track,
           travel:[bump, droop], turret, gun, tube, muzzle, tcfg:{rate,elevRate,elevMin,elevMax},
           figs:{ seatName: Object3D | [Object3D...] }, gunner:{ obj, calm, fight },
           ringStand:{ seat, standing, seated }, troops:{ im, max }, exhaust:{ p:[x,y,z], d:[x,y,z], soot },
           engine:[x,y,z], cabin:[x,y,z], arena, mass, seed, tailgate, shield, scan }
     dust from the rear-most wheels' contact patches. */
  function WheeledRig(o) {
    const THREE = T();
    if (!_v2 && THREE) _v2 = new THREE.Vector2();
    Object.assign(this, o);
    this.rimIMs = o.rimIMs || [];
    this.t = 0; this.lv = 0; this.pitch = 0; this.pv = 0; this.roll = 0; this.rv = 0;
    this.rec = 0; this.recV = 0; this.aimT = -99; this.lastShot = null; this.dead = false;
    this.acc = { dust: 0, ex: 0, dmg: 0, fire: 0 };
    this._has = {};
    this.body0 = o.body ? o.body.position.y : 0;
    this.wheels.forEach(function (w) { w.spin = 0; w.off = 0; w.sq = 1; });
    this.smoke = new Fx(160, false); this.glow = new Fx(48, true);
    o.root.add(this.smoke.points); o.root.add(this.glow.points);
    this.setGround(o.ground || o.arena);
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, "YXZ");
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._m = new THREE.Matrix4();
    this._a = [0, 0, 0]; this._b = [0, 0, 0];
    this.flat = -1;
    this.settle();
  }
  const RP = WheeledRig.prototype;
  RP.settle = function () { this.poseWheels(0); };
  RP.setGround = function (g) {
    const d = DUST[g] || DUST.field;
    this.dustCol = lin(d[0]); this.dustK = d[1];
  };
  /* THE SIDE'S MARKINGS (the battle calls this right after build): the
     scheme for the nation and the ground goes on every tagged mesh, the crew
     change into its uniform, the nation's flag goes on the decal spots, the
     dust takes the ground's colour. Idempotent. */
  RP.mark = function (nation, ground, side) {
    const THREE = T();
    const sid = (side && side.side) || side || this.side || null;
    const id = scheme(nation, ground, typeof sid === "string" ? sid : null);
    this.setGround(ground);
    const flagId = nation || (sid === "red" ? "kesh" : "republic");
    if (id === this.schemeId && flagId === this.flagId) return;
    this.schemeId = id; this.flagId = flagId;
    const M = mats(id);
    this.root.traverse(function (o) {
      const ud = o.userData;
      if (!ud || !ud.hkKey) return;
      if (ud.hkFig) {
        const old = o.geometry, g = figure(ud.hkFig.kind, id, ud.hkFig.skin);
        if (old._hkBounds && !g._hkBounds) {          // an instanced bench keeps its vehicle-sized bounds
          g._hkBounds = true; g.boundingBox = old.boundingBox.clone(); g.boundingSphere = old.boundingSphere.clone();
        }
        o.geometry = g;
      }
      if (M[ud.hkKey]) o.material = M[ud.hkKey];
    });
    // the flag decals
    if (this.decal) {
      const D = this.decal;
      if (D.mesh && D.mesh.parent) D.mesh.parent.remove(D.mesh);
      D.mesh = null;
      const fm = flagMat(flagId);
      if (fm) {
        const ratio = flagRatio(flagId), key = ratio.toFixed(3);
        if (!D.cache[key]) D.cache[key] = decalGeo(D.list, ratio);
        D.mesh = new THREE.Mesh(D.cache[key], fm); D.mesh.name = "flags";
        D.parent.add(D.mesh);
      }
    }
  };
  /* EVERY ROUND (the contract's fire(shot, from)): a rig with fire owns its
     effects. The .50 kicks, flashes, blows gas and throws brass. */
  RP.fire = function (shot) {
    const k = shot && shot.kind;
    this.fired(k === "cannon" ? 1 : k === "autocannon" ? 0.5 : 0.3);
  };
  // EVERY HIT THAT LANDS (contract damage(vs, res)): show it at once
  RP.damage = function (vs, res) {
    if (!vs) return;
    this.hurtLook(vs, 0, null);
    if (res && res.pen && this.root.parent) {
      // a penetration: a flash of spall at the hull
      const a = this._a, E = this.cabin || this.engine || [0, 1, 0];
      mw(this.root, E[0], E[1], E[2], a);
      this.glow.emit(a[0], a[1], a[2], 0, 0.5, 0, 0.12, 0.6, 1.6, 0.9, FXC.flash, 0, 0);
    }
  };
  RP.poseWheels = function (steer) {
    const ws = this.wheels, wb = this.wheelbase || 3.3, tw = this.track || 1.8;
    // Ackermann: the inside wheel turns tighter
    const d = -steer, ad = Math.abs(d);
    let inner = d, outer = d;
    if (ad > 1e-3) {
      const R = wb / Math.tan(ad);
      inner = Math.sign(d) * Math.atan(wb / Math.max(0.5, R - tw / 2));
      outer = Math.sign(d) * Math.atan(wb / (R + tw / 2));
    }
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      let yaw = 0;
      if (w.steer) { const isInner = (d > 0) === (w.x > 0); yaw = (isInner ? inner : outer) * w.steer; }
      const left = w.x < 0;
      this._e.set(left ? -w.spin : w.spin, yaw + (left ? PI : 0), 0, "YXZ");
      this._q.setFromEuler(this._e);
      this._p.set(w.x, w.y + w.off - (w.sq < 1 ? w.r * (1 - w.sq) : 0), w.z);
      this._s.set(1, w.sq, w.sq < 1 ? 1.04 : 1);
      this._m.compose(this._p, this._q, this._s);
      if (this.tyreIM) this.tyreIM.setMatrixAt(i, this._m);
      if (this.rimIMs.length) {
        this._s.set(1, 1, 1);
        this._m.compose(this._p, this._q, this._s);
        for (let k = 0; k < this.rimIMs.length; k++) this.rimIMs[k].setMatrixAt(i, this._m);
      }
    }
    if (this.tyreIM) this.tyreIM.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < this.rimIMs.length; k++) this.rimIMs[k].instanceMatrix.needsUpdate = true;
  };
  RP.aimTurret = function (rel, el, dt) {
    if (!this.turret || this.jammed) return;
    const tc = this.tcfg || {};
    this.aimT = this.t;
    this.turret.rotation.y = wrap(this.turret.rotation.y + clamp(wrap(rel - this.turret.rotation.y), -(tc.rate || 1.5) * dt, (tc.rate || 1.5) * dt));
    if (this.gun) {
      const cur = -this.gun.rotation.x, want = clamp(el, tc.elevMin == null ? -0.2 : tc.elevMin, tc.elevMax == null ? 0.8 : tc.elevMax);
      this.gun.rotation.x = -(cur + clamp(want - cur, -(tc.elevRate || 1) * dt, (tc.elevRate || 1) * dt));
    }
  };
  RP.muzzleWorld = function (out) {
    if (!this.muzzle) return null;
    this.muzzle.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.muzzle.matrixWorld);
  };
  // one round left the gun: the barrel kicks, gas and brass come out
  RP.fired = function (k) {
    this.recV -= 1.6 * (k || 0.3) * 4;
    if (!this.muzzle || !this.root.parent) return;
    const THREE = T();
    const p = this.muzzleWorld(this._p || new THREE.Vector3());
    const e = this.muzzle.matrixWorld.elements, fx = e[8], fy = e[9], fz = e[10];
    const r = Math.random;
    this.glow.emit(p.x + fx * 0.15, p.y + fy * 0.15, p.z + fz * 0.15, fx * 2, fy * 2, fz * 2, 0.06, 0.55, 0.9, 1.0, FXC.flash, 0, 0);
    this.smoke.emit(p.x + fx * 0.3, p.y + fy * 0.3, p.z + fz * 0.3, fx * 3 + (r() - 0.5), fy * 3 + 0.4, fz * 3 + (r() - 0.5), 0.9 + r() * 0.5, 0.25, 1.4, 0.28, FXC.gas, -0.03, 2.5);
    // brass and links out of the right side of the receiver
    if (this.gun) {
      const g = this.gun.matrixWorld.elements;
      const bx = g[12] + g[8] * 0.05, by = g[13] + g[9] * 0.05, bz = g[14] + g[10] * 0.05;
      this.smoke.emit(bx, by, bz, -g[0] * 2.2 + (r() - 0.5), 1.4 + r(), -g[2] * 2.2 + (r() - 0.5), 0.5, 0.05, 0.05, 1.0, FXC.brass, 1, 0.2);
    }
  };
  RP.crew = function (u) {
    const seats = u.seats || [], F = this.figs || {};
    let pax = 0;
    const has = this._has;
    for (const k in has) has[k] = false;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i], on = !!(s.man || s.implicit);
      if (!s.crew) { if (on) pax++; continue; }
      if (on) has[s.seat] = true;
    }
    const engaged = !!(u.tgt && !u.tgt.dead && u.sees);
    for (const k in F) {
      const f = F[k];
      if (k === "passenger") { for (let i = 0; i < f.length; i++) f[i].visible = i < pax; continue; }
      if (f) f.visible = !!has[k];
    }
    if (this.troops) this.troops.im.count = Math.min(this.troops.max, pax);
    // the gunner stands tall to look round when nothing is in his sights,
    // and gets down behind the shield on the grips when he is shooting
    if (this.gunner && this.gunner.obj) {
      const g = this.gunner, want = engaged ? g.fight : g.calm;
      g.obj.position.y += (want - g.obj.position.y) * Math.min(1, this.dt * 4);
      g.obj.visible = !!has[g.seat || "gunner"];
    }
    // a man who rides a ring mount stands up in it to fight, sits to ride
    if (this.ringStand) {
      const R = this.ringStand, on = !!has[R.seat];
      R.standing.visible = on && engaged;
      R.seated.visible = on && !engaged;
    }
    if (this.tailgate) {
      const want = u.dismounted ? this.tailgate.open : 0;
      this.tailgate.obj.rotation.x += (want - this.tailgate.obj.rotation.x) * Math.min(1, this.dt * 3);
    }
  };
  /* THE FRAME. dt is the animation step, v/w/steer the drive state, u the unit. */
  RP.update = function (dt, v, w, steer, u, ctx) {
    if (!(dt > 0)) return;
    this.dt = dt; this.t += dt;
    const root = this.root, ws = this.wheels, vs = u && u.vs;
    // ---- wheels: roll by distance, ride the ground on their own springs
    const ground = (ctx && ctx.groundAt) || CBZ.floorAt, live = !!root.parent;
    const bump = this.travel ? this.travel[0] : 0.18, droop = this.travel ? this.travel[1] : 0.18;
    let heave = 0;
    for (let i = 0; i < ws.length; i++) {
      const wh = ws[i];
      wh.spin = (wh.spin + v * dt / wh.r) % (2 * PI);
      let want = 0;
      if (ground && live) {
        const p = mw(root, wh.x, 0, wh.z, this._a);
        let gy = p[1];
        try { gy = ground(p[0], p[2]); } catch (e) {}
        want = clamp(gy - p[1], -droop, bump);
      }
      if (this.flat === i) want -= wh.r * 0.12;
      wh.off += (want - wh.off) * Math.min(1, dt * 16);
      heave += wh.off;
    }
    heave /= ws.length;
    // ---- the sprung body: squat under power, dive on the brakes, lean out of a turn
    const acc = clamp((v - this.lv) / dt, -12, 12); this.lv = v;
    const pt = clamp(-acc * (this.pitchK || 0.006), -0.05, 0.05), rt = clamp(v * w * (this.rollK || 0.006), -0.07, 0.07);
    this.pv += ((pt - this.pitch) * 70 - this.pv * 10) * dt; this.pitch += this.pv * dt;
    this.rv += ((rt - this.roll) * 60 - this.rv * 9) * dt; this.roll += this.rv * dt;
    if (this.body) {
      const idle = vs && vs.hp <= 0 ? 0 : 1;
      this.body.rotation.x = this.pitch + Math.sin(this.t * 61) * 0.0007 * idle;
      this.body.rotation.z = this.roll + Math.sin(this.t * 47) * 0.0005 * idle;
      this.body.position.y = this.body0 + heave * 0.55 + (this.sag || 0);
    }
    this.poseWheels(steer || 0);
    // ---- the gun: recoil spring; the gunner scans when nothing is in his sights
    this.recV += (-this.rec * 900 - this.recV * 38) * dt; this.rec += this.recV * dt;
    if (this.rec > 0) { this.rec = 0; this.recV = Math.min(0, this.recV); }
    if (this.tube) this.tube.position.z = this.rec * 0.06;
    if (u) {
      this.crew(u);
      if (this.turret && !this.jammed && this.scan !== false && this.t - this.aimT > 2.5 && (!u.tgt || u.tgt.dead)) {
        const tc = this.tcfg || {}, sweep = Math.sin(this.t * 0.22 + (this.seed || 0)) * 1.25;
        this.turret.rotation.y = wrap(this.turret.rotation.y + clamp(wrap(sweep - this.turret.rotation.y), -(tc.rate || 1) * 0.25 * dt, (tc.rate || 1) * 0.25 * dt));
        if (this.gun) this.gun.rotation.x += (-0.04 - this.gun.rotation.x) * Math.min(1, dt * 1.5);
        if (u.tur) u.tur.yaw = this.turret.rotation.y;
      }
      if (vs) this.hurtLook(vs, dt, u);
    }
    // ---- exhaust and dust
    if (live) this.emitDrive(dt, v, acc, u);
    this.smoke.step(dt); this.glow.step(dt);
  };
  RP.emitDrive = function (dt, v, acc, u) {
    const r = Math.random, root = this.root, a = this._a, d = this._b;
    const sp = Math.abs(v);
    if (this.exhaust && !(u && u.vs && u.vs.hp <= 0)) {
      const E = this.exhaust;
      const load = clamp(acc * 0.4, 0, 1);
      const rate = 3 + load * 14 + sp * 0.2;
      this.acc.ex += dt * rate;
      this.acc.ex = Math.min(this.acc.ex, 6);
      while (this.acc.ex >= 1) {
        this.acc.ex -= 1;
        mw(root, E.p[0], E.p[1], E.p[2], a); dw(root, E.d[0], E.d[1], E.d[2], d);
        const soot = load * (E.soot || 0.5);
        const c = soot > 0.25 ? FXC.soot : FXC.haze;
        this.smoke.emit(a[0], a[1], a[2], d[0] * 2.2 + (r() - 0.5) * 0.4, d[1] * 2.2 + 0.35, d[2] * 2.2 + (r() - 0.5) * 0.4,
          1.0 + r() * 0.8 + soot, 0.18, 0.9 + soot * 1.4, 0.10 + soot * 0.5, c, -0.02, 1.6);
      }
    }
    if (sp > 1.4 && this.dustK > 0) {
      this.acc.dust += dt * (sp - 1.2) * 1.6 * this.dustK;
      const ws = this.wheels;
      let rear = ws[0].z;
      for (let i = 1; i < ws.length; i++) if (ws[i].z < rear) rear = ws[i].z;
      this.acc.dust = Math.min(this.acc.dust, 6);
      while (this.acc.dust >= 1) {
        this.acc.dust -= 1;
        const wh = ws[Math.floor(r() * ws.length)];
        const zz = v >= 0 ? rear : -rear;
        mw(root, wh.x + (r() - 0.5) * 0.3, 0.12, zz - Math.sign(v || 1) * wh.r * 0.8, a);
        dw(root, 0, 0, -Math.sign(v || 1), d);
        const vv = Math.min(sp, 16);
        this.smoke.emit(a[0], a[1], a[2], d[0] * vv * 0.25 + (r() - 0.5) * 1.2, 0.5 + r() * 0.9, d[2] * vv * 0.25 + (r() - 0.5) * 1.2,
          1.6 + r() * 1.8, 0.7, 3.2 + vv * 0.12, 0.30 * this.dustK + 0.08, this.dustCol, -0.01, 0.9);
      }
    }
  };
  /* DAMAGE STATES: a hit hull smokes from the engine, a burning one burns, a
     mobility kill sits on a flat (or shot-off) wheel, a firepower kill hangs
     its gun. */
  RP.hurtLook = function (vs, dt, u) {
    const r = Math.random, a = this._a;
    const frac = vs.maxHp > 0 ? clamp(vs.hp / vs.maxHp, 0, 1) : 1;   // a wreck sits far below 0 hp
    if (vs.mobility && this.flat < 0) this.flat = (this.seed || 0) % this.wheels.length;
    if (this.flat >= 0) this.wheels[this.flat].sq = 0.86;
    if (vs.firepower && !this.jammed) { this.jammed = true; if (this.gun) this.gun.rotation.x = 0.22; }
    const E = this.engine || [0, 1, 1];
    // burning: the hit set it alight, or it is a wreck still burning out
    const hot = vs.burning || (this.dead && u && u.burnT > 0);
    if (frac < 0.55 || hot) {
      this.acc.dmg += dt * (hot ? 12 : (0.55 - frac) * 16);
      this.acc.dmg = Math.min(this.acc.dmg, 6);
      while (this.acc.dmg >= 1) {
        this.acc.dmg -= 1;
        mw(this.root, E[0] + (r() - 0.5) * 0.6, E[1] + 0.3, E[2] + (r() - 0.5) * 0.6, a);
        if (hot) this.smoke.emit(a[0], a[1], a[2], (r() - 0.5) * 0.6, 2.4 + r() * 1.5, (r() - 0.5) * 0.6, 4 + r() * 3, 0.7, 5.5, 0.6, FXC.black, -0.08, 0.5);
        else this.smoke.emit(a[0], a[1], a[2], (r() - 0.5) * 0.5, 1.6 + r() * 1.2, (r() - 0.5) * 0.5, 2.5 + r() * 2, 0.4, 3.0, 0.35, FXC.grey, -0.06, 0.6);
      }
    }
    if (vs.burning && !this.dead) this.burn(dt, E, 10);
  };
  // the flames (was a second RP.fire, which silently replaced the contract's
  // fire(shot) above: no rig on this kit ever flashed or kicked on a round)
  RP.burn = function (dt, at, rate) {
    const r = Math.random, a = this._a;
    this.acc.fire += dt * rate;
    this.acc.fire = Math.min(this.acc.fire, 6);
    while (this.acc.fire >= 1) {
      this.acc.fire -= 1;
      mw(this.root, at[0] + (r() - 0.5) * 0.9, at[1] + r() * 0.2, at[2] + (r() - 0.5) * 0.9, a);
      this.glow.emit(a[0], a[1], a[2], (r() - 0.5) * 0.4, 1.2 + r() * 1.8, (r() - 0.5) * 0.4, 0.45 + r() * 0.4, 0.5, 1.3, 0.75, r() < 0.5 ? FXC.fire1 : FXC.fire2, -0.05, 0.8);
    }
  };
  /* THE WRECK (called from the sim's wreck step): the crew is gone, the gun
     hangs, it burns where it was hit, the tyres burn off and the hull settles
     onto its rims; a catastrophic kill throws the gun shield askew. */
  RP.wrecked = function (dt, u) {
    if (!(dt > 0)) return;
    this.dt = dt; this.t += dt;
    if (!this.dead) {
      this.dead = true;
      this.cat = !!(u && u.burnT > 0 && u.vs && (u.vs.wreck || u.vs.burning));
      const F = this.figs || {};
      for (const k in F) { const f = F[k]; if (Array.isArray(f)) f.forEach(function (x) { x.visible = false; }); else if (f) f.visible = false; }
      if (this.gunner && this.gunner.obj) this.gunner.obj.visible = false;
      if (this.ringStand) { this.ringStand.standing.visible = false; this.ringStand.seated.visible = false; }
      if (this.troops) this.troops.im.count = 0;
      if (this.gun) this.gun.rotation.x = 0.3;
      if (this.cat && this.shield) { this.shield.rotation.z = 0.32; this.shield.rotation.x = -0.18; this.shield.position.y -= 0.12; }
      this.burnt = 0;
    }
    const burning = u && u.burnT > 0;
    if (burning) {
      this.burnt += dt;
      this.burn(dt, this.cabin || this.engine || [0, 1.2, 0], 16);
      this.burn(dt, this.engine || [0, 1, 1], 8);
      // tyres burn away over a minute: the hull settles onto its rims
      const k = clamp(this.burnt / 50, 0, 1);
      for (let i = 0; i < this.wheels.length; i++) this.wheels[i].sq = 1 - k * 0.22;
      this.sag = -k * (this.wheels[0].r * 0.22);
      if (this.body) this.body.position.y = this.body0 + this.sag;
      this.poseWheels(0);
    }
    if (u && u.vs) this.hurtLook(u.vs, dt * (burning ? 1 : 0.3), u);
    this.smoke.step(dt); this.glow.step(dt);
  };

  /* ================================================================ crew figures */
  /* A soldier as a few lofted pieces in one vertex-coloured geometry (helmet,
     face, combat shirt, plate carrier, arms). Kinds: "seated" (head and
     shoulders over a seat), "gunner" (standing, hands forward on spade
     grips), "bench" (a rifleman sitting sideways on a troop bench, rifle
     upright between his knees). Origin at the hips. */
  const FIG = {};
  const SKIN = [0x8d5a3b, 0xc79a78, 0x5e3a26, 0xb98a68];
  function figure(kind, schemeId, skinI) {
    const key = kind + "|" + schemeId + "|" + skinI;
    if (FIG[key]) return FIG[key];
    const sc = SCHEMES[schemeId] || SCHEMES.nato3;
    const G = new Geo(); G.m("crew");
    const uni = sc.uniform, vest = sc.vest, helm = sc.gear, skin = SKIN[skinI % SKIN.length];
    const torso = function (y0) {
      G.c(uni).sect([[-0.11, [[-0.17, y0], [0.17, y0], [0.19, y0 + 0.36], [0.20, y0 + 0.52], [-0.20, y0 + 0.52], [-0.19, y0 + 0.36]]],
        [0.11, [[-0.17, y0], [0.17, y0], [0.19, y0 + 0.36], [0.20, y0 + 0.52], [-0.20, y0 + 0.52], [-0.19, y0 + 0.36]]]]);
      // plate carrier with pouches
      G.c(vest).box(0, y0 + 0.30, 0, 0.36, 0.34, 0.26);
      G.box(0, y0 + 0.20, 0.14, 0.30, 0.10, 0.05); G.box(-0.09, y0 + 0.20, 0.155, 0.08, 0.09, 0.05); G.box(0.09, y0 + 0.20, 0.155, 0.08, 0.09, 0.05);
      // neck, head, helmet with cover, goggles band
      G.c(skin).cyl(0, y0 + 0.57, 0, 0.055, 0.06, 0.09, "y", 8);
      G.sphere(0, y0 + 0.70, 0.01, 0.10, 8, 0.9, 1.1, 1.0);
      G.c(helm).sphere(0, y0 + 0.73, -0.005, 0.125, 9, 1.0, 0.85, 1.08, 0, PI * 0.55);
      G.c(0x2a2a26).box(0, y0 + 0.755, 0.10, 0.18, 0.03, 0.04);
    };
    if (kind === "gunner") {
      torso(0);
      // arms forward onto the spade grips at chest height (hands at y 0.46, z 0.40)
      G.c(uni);
      [-1, 1].forEach(function (s) {
        G.tube([s * 0.20, 0.47, 0.0], [s * 0.21, 0.33, 0.20], 0.055, 0.048);
        G.tube([s * 0.21, 0.33, 0.20], [s * 0.07, 0.45, 0.38], 0.046, 0.04);
        G.c(0x3a3830).sphere(s * 0.065, 0.46, 0.40, 0.042, 6); G.c(uni);
      });
      // legs below the ring (rarely seen, but the ring is open)
      G.c(uni).box(0.09, -0.35, 0, 0.13, 0.7, 0.15); G.box(-0.09, -0.35, 0, 0.13, 0.7, 0.15);
    } else if (kind === "bench") {
      torso(0);
      G.c(uni);
      // thighs forward, shins down, boots
      [-1, 1].forEach(function (s) {
        G.box(s * 0.10, 0.0, 0.20, 0.14, 0.14, 0.42);
        G.box(s * 0.10, -0.22, 0.40, 0.12, 0.44, 0.13);
        G.c(0x3a2f24).box(s * 0.10, -0.43, 0.45, 0.12, 0.08, 0.24); G.c(uni);
        G.cyl(s * 0.17, 0.30, 0.13, 0.045, 0.05, 0.30, "y", 6, -0.9, 0, 0);
      });
      // the rifle, muzzle up between the knees
      G.c(0x23241f).box(0, 0.12, 0.36, 0.05, 0.85, 0.09, -0.12, 0, 0);
    } else {
      torso(0);
      G.c(uni);
      [-1, 1].forEach(function (s) { G.cyl(s * 0.21, 0.32, 0.12, 0.05, 0.055, 0.30, "y", 6, -0.9, 0, 0); });
    }
    const geo = G.build({ mud: 0 }).crew;
    return (FIG[key] = geo);
  }

  /* the wheel set of one vehicle: one InstancedMesh for the tyres and one per
     rim material, n wheels. Their bounds are the running gear's envelope
     (box {min,max} in vehicle space) so they cull, and measure, with the
     vehicle and not as one tyre at its origin. */
  function wheelSet(root, tyreGeo, rimGeos, M, n, box) {
    const THREE = T();
    const all = [tyreGeo].concat(Object.keys(rimGeos).map(function (k) { return rimGeos[k]; }));
    all.forEach(function (g) {
      if (g._hkBounds) return;
      g._hkBounds = true;
      g.boundingBox = new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3], box[4], box[5]));
      g.boundingSphere = new THREE.Sphere(); g.boundingBox.getBoundingSphere(g.boundingSphere);
    });
    const tyreIM = new THREE.InstancedMesh(tyreGeo, M.rubber, n);
    tyreIM.name = "tyres"; tyreIM.castShadow = true; tyreIM.receiveShadow = true; root.add(tyreIM);
    const rimIMs = Object.keys(rimGeos).map(function (k) {
      const im = new THREE.InstancedMesh(rimGeos[k], M[k], n);
      im.name = "rims:" + k; im.castShadow = true; im.receiveShadow = true; root.add(im);
      return im;
    });
    return { tyreIM: tyreIM, rimIMs: rimIMs };
  }
  /* THE UNIT'S animate(veh, dt, ctx) for a hull on a WheeledRig (the
     contract: every sim step, on the battle clock, alive or wrecked). */
  function animate(veh, dt, ctx) {
    const r = veh && veh.rig;
    if (!r || !(r instanceof WheeledRig)) { if (ctx && ctx.shared) ctx.shared(dt); return; }
    if (ctx && ctx.dead) r.wrecked(dt, veh);
    else r.update(dt, ctx ? ctx.speed : (veh.ds ? veh.ds.v : 0), ctx ? ctx.yawRate : 0, ctx ? ctx.steer : 0, veh, ctx);
  }
  // per-type geometry built once per LOAD OF THIS KIT: a unit file keeps its
  // body here, not in its own closure, so a hot-swapped kit rebuilds it
  const CACHE = {};
  function cache(key, fn) { return CACHE[key] || (CACHE[key] = fn()); }

  CBZ.hullKit = {
    cache: cache, wheelSet: wheelSet, animate: animate, figMesh: figMesh,
    geo: function () { return new Geo(); },
    lin: lin, rng: rngOf, scheme: scheme, mats: mats, flagMat: flagMat, flagRatio: flagRatio,
    decalGeo: decalGeo, meshes: meshes, tyre: tyre, m2: m2, figure: figure, WheeledRig: WheeledRig, Fx: Fx,
    SCHEMES: SCHEMES, aff: aff, clamp: clamp, wrap: wrap,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.hullKit;
})();
