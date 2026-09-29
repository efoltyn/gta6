/* ============================================================
   race/race_core.js — THE CIRCUIT, as numbers. No THREE, no DOM.

   Everything in src/race/ is authored against this one file: the
   track builder, the stadium, the car physics, the AI, the cameras.
   It runs in a page (window.CBZ.race.core) and in plain node
   (require → module.exports), so the dimension and physics checks in
   tools/race-core-check.mjs read the same numbers the game draws.

   THE PLACE: a concrete short-track bullring, the colosseum kind.
   Real references (Bristol-class half-mile): ~0.53 mi / 850 m lap,
   ~200 m straights, 24-30 deg banking in the turns, 5-9 deg on the
   straights, a 12-18 m racing surface, a flat-ish apron inside, a
   SAFER wall + catch fence outside, and the stands on EVERY side.
   Ours: 18 m surface, 24 deg turns, 6 deg straights, a gentle
   tri-oval dogleg on the front stretch where the start/finish line,
   the gantry and the main grandstand are, and a pit road inside the
   front stretch.

   AUTHORED AS A CURVATURE DIAGRAM (the way circuits are): straight →
   clothoid spiral → constant-radius arc → spiral → straight. Heading
   is the integral of curvature, position the integral of heading, so
   the line is C2 wherever it matters and bank (derived FROM curvature)
   can never jump. The layout is mirror-symmetric about the x axis
   through the S/F apex, so it closes by construction; the residual
   numeric gap is spread along the lap.

   FRAME CONVENTION (every src/race file uses it):
     s  metres along the centreline, 0 = start/finish, increases in the
        race direction (counter-clockwise from above: LEFT turns).
     u  metres across, along the OUTWARD normal. u<0 infield / apron /
        pit road; u>0 toward the wall and the stands.
     world: x east, z south (three.js default, y up). The venue centre
        is the origin; y=0 is infield grade.
============================================================ */
(function (root) {
  "use strict";

  const DEG = Math.PI / 180;

  // ---- cross-section (metres) ---------------------------------------------
  const HALF_W = 9.0;        // racing surface half-width (18 m, ~59 ft)
  const APRON_W = 7.0;       // inside apron (flat-ish, 5% up to the surface)
  const APRON_RISE = 0.30;   // apron inner edge → track inner edge
  const SHOULDER = 1.0;      // surface continues past the outer line to the wall face
  const WALL_H = 1.2;        // SAFER barrier height above the surface at its foot
  const WALL_T = 0.9;        // SAFER foam + steel box + concrete wall behind
  const FENCE_H = 6.5;       // catch fence above the wall top
  const PIT_GAP = 3.0;       // grass strip between apron and pit wall
  const PIT_WALL_T = 0.6;
  const PIT_W = 13.0;        // pit road: 5 m fast lane + 8 m pit boxes
  const BANK_TURN = 24 * DEG;
  const BANK_STRAIGHT = 6 * DEG;

  // ---- plan (curvature diagram) -------------------------------------------
  const R_TURN = 64;         // centreline radius at the middle of the turns
  const SPIRAL = 26;         // clothoid length each side of every turn
  // back straight length is SOLVED (see segments), not typed
  const FRONT_HALF = 58;     // straight run each side of the dogleg
  const DOGLEG_HALF = 30;    // curved half-length of the tri-oval dogleg
  const DOGLEG = 7 * DEG;    // heading change across each dogleg half (a gentle LEFT: the third corner of the tri-oval)

  const STEP = 0.5;          // sample spacing (m)

  /* Segment list for the WHOLE lap starting at the S/F apex heading +x.
     Each: [length, k0, k1] with curvature linear across the segment.
     Positive curvature = left (toward the infield). */
  /* The loop is a palindrome (D F T B T F D), so it is mirror-symmetric about
     the x=0 axis through the apex; it CLOSES only if the half-lap reaches x=0 at
     the middle of the back straight. So BACK = twice the x the first half has
     run by the end of turn 2, measured by integrating the first half. */
  function segments() {
    const kT = 1 / R_TURN;
    const kD = DOGLEG / DOGLEG_HALF;
    const turnAngle = Math.PI - DOGLEG;               // each end turns 180 less one dogleg half
    const arc = turnAngle / kT - SPIRAL;              // spirals each add kT*SPIRAL/2
    const turn = [[SPIRAL, 0, kT], [arc, kT, kT], [SPIRAL, kT, 0]];
    // the dogleg is a pair of spirals meeting at the apex: curvature peaks on
    // the line and fades to zero at each end, so bank never steps
    const half = [[DOGLEG_HALF, 2 * kD, 0], [FRONT_HALF, 0, 0], ...turn];
    const xEnd = integrate(half).x;
    return [...half, [2 * xEnd, 0, 0], ...turn, [FRONT_HALF, 0, 0], [DOGLEG_HALF, 0, 2 * kD]];
  }
  function integrate(segs) {
    let x = 0, z = 0, th = 0;
    for (const g of segs) {
      const n = Math.ceil(g[0] / 0.05), h = g[0] / n;
      for (let j = 0; j < n; j++) {
        const km = g[1] + (g[2] - g[1]) * (j + 0.5) / n;
        const thm = th + km * h / 2;
        x += Math.cos(thm) * h; z -= Math.sin(thm) * h; th += km * h;
      }
    }
    return { x, z, th };
  }

  function build() {
    const segs = segments();
    let L = 0; for (const g of segs) L += g[0];
    const N = Math.round(L / STEP);
    const ds = L / N;
    const X = new Float64Array(N + 1), Z = new Float64Array(N + 1);
    const H = new Float64Array(N + 1), K = new Float64Array(N + 1);
    // curvature at arc length s
    function kAt(s) {
      let a = 0;
      for (const g of segs) {
        if (s <= a + g[0] + 1e-9) { const f = (s - a) / g[0]; return g[1] + (g[2] - g[1]) * f; }
        a += g[0];
      }
      return 0;
    }
    // integrate: heading θ in the (x, north) plane, dx = cosθ, dz = -sinθ
    let x = 0, z = 0, th = 0;
    const SUB = 8;
    for (let i = 0; i <= N; i++) {
      X[i] = x; Z[i] = z; H[i] = th; K[i] = kAt(i * ds);
      if (i === N) break;
      for (let j = 0; j < SUB; j++) {
        const s0 = (i + j / SUB) * ds, h = ds / SUB;
        const k0 = kAt(s0), km = kAt(s0 + h / 2), k1 = kAt(s0 + h);
        const thm = th + (k0 + km) * 0.25 * h;           // heading at the sub-step middle
        x += Math.cos(thm) * h; z -= Math.sin(thm) * h;
        th += (k0 + 4 * km + k1) / 6 * h;
      }
    }
    // spread the (tiny) closure gap along the lap so sample N == sample 0
    const gx = X[N] - X[0], gz = Z[N] - Z[0];
    for (let i = 0; i <= N; i++) { X[i] -= gx * i / N; Z[i] -= gz * i / N; }
    // centre the plan on the origin
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i <= N; i++) { X[i] -= cx; Z[i] -= cz; }
    return { L, N, ds, X, Z, H, K, closure: Math.hypot(gx, gz), bbox: { x0: x0 - cx, x1: x1 - cx, z0: z0 - cz, z1: z1 - cz } };
  }

  const T = build();
  const L = T.L, N = T.N, DS = T.ds;
  const K_TURN = 1 / R_TURN;

  const wrapS = (s) => ((s % L) + L) % L;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // bank from curvature, continuous because curvature is
  const BANK = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const f = clamp(Math.abs(T.K[i]) / K_TURN, 0, 1);
    const e = f * f * (3 - 2 * f);                      // smoothstep so the transitions ease
    BANK[i] = BANK_STRAIGHT + (BANK_TURN - BANK_STRAIGHT) * e;
  }

  /* frame(s, out?) → centreline point, unit tangent, outward normal, bank,
     curvature. Linear between samples (0.5 m apart, invisible). */
  function frame(s, o) {
    o = o || {};
    const f = wrapS(s) / DS;
    let i = Math.floor(f); if (i >= N) i = N - 1;
    const a = f - i, b = 1 - a;
    const th = T.H[i] * b + T.H[i + 1] * a;
    o.x = T.X[i] * b + T.X[i + 1] * a;
    o.z = T.Z[i] * b + T.Z[i + 1] * a;
    o.tx = Math.cos(th); o.tz = -Math.sin(th);          // tangent (race direction)
    o.nx = Math.sin(th); o.nz = Math.cos(th);           // outward normal (right of travel)
    o.heading = th;                                     // radians, math convention in (x, north)
    o.yaw = Math.atan2(o.tx, o.tz);                     // three.js yaw: rotation.y that faces +z → tangent
    o.bank = BANK[i] * b + BANK[i + 1] * a;
    o.k = T.K[i] * b + T.K[i + 1] * a;
    return o;
  }

  /* surfaceY(s,u) → the height of whatever you drive or stand on at (s,u)
     inside the wall: banked racing surface, apron, infield grade. */
  const INNER = -HALF_W, APRON_IN = -HALF_W - APRON_W, WALL_U = HALF_W + SHOULDER;
  function surfaceY(s, u) {
    if (u < APRON_IN) return 0;
    if (u < INNER) return APRON_RISE * (u - APRON_IN) / APRON_W;
    const bank = frame(s, _f).bank;
    return APRON_RISE + (Math.min(u, WALL_U) - INNER) * Math.tan(bank);
  }
  const _f = {};

  // world position of (s,u), y on the surface unless given
  function toWorld(s, u, y, o) {
    o = o || {};
    frame(s, _w);
    o.x = _w.x + _w.nx * u; o.z = _w.z + _w.nz * u;
    o.y = y == null ? surfaceY(s, u) : y;
    return o;
  }
  const _w = {};

  /* nearest(x, z, hintS?) → {s, u}. With a hint it searches ±40 m around it
     (the per-frame path: cars move < 2 m a tick); without, a coarse full
     scan then a refine. Good anywhere inside the stadium. */
  const _n = {};
  function nearest(x, z, hintS, o) {
    o = o || {};
    let best = Infinity, bi = 0;
    if (hintS != null) {
      const c = Math.round(wrapS(hintS) / DS), W = Math.round(40 / DS);
      for (let j = -W; j <= W; j++) {
        const i = ((c + j) % N + N) % N;
        const dx = x - T.X[i], dz = z - T.Z[i], d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
    } else {
      for (let i = 0; i < N; i += 8) {
        const dx = x - T.X[i], dz = z - T.Z[i], d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
      for (let j = -8; j <= 8; j++) {
        const i = ((bi + j) % N + N) % N;
        const dx = x - T.X[i], dz = z - T.Z[i], d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
    }
    // project onto the local tangent, twice, for sub-sample precision
    let sEst = bi * DS;
    for (let k = 0; k < 2; k++) {
      frame(sEst, _n);
      sEst += (x - _n.x) * _n.tx + (z - _n.z) * _n.tz;
    }
    frame(sEst, _n);
    o.s = wrapS(sEst);
    o.u = (x - _n.x) * _n.nx + (z - _n.z) * _n.nz;
    return o;
  }

  // ---- pit road, grid, lines ------------------------------------------------
  const PIT_U = APRON_IN - PIT_GAP - PIT_WALL_T - PIT_W / 2;   // pit road centre offset
  const PIT = {
    u: PIT_U, w: PIT_W,
    wallU: APRON_IN - PIT_GAP - PIT_WALL_T / 2,                 // the pit wall between apron and pit road
    fastU: PIT_U + PIT_W / 2 - 2.5,                              // fast-lane centre (track side)
    boxU: PIT_U - PIT_W / 2 + 4.0,                               // pit-box centre (garage side)
    s0: -86, s1: 86,                                             // straight part of pit road
    inS: -150, outS: 150,                                        // blend from the apron (turn 4 exit / turn 1 entry)
    boxes: 12, boxLen: 11.5,
    speed: 22.4,                                                 // pit-road speed limit, m/s (~80 km/h)
  };
  PIT.boxS = function (i) { return PIT.s0 + 12 + i * PIT.boxLen; };

  const GRID = {
    rowGap: 8.0, colU: 3.6, firstS: -10,
    slot(i) { const r = i >> 1; return { s: wrapS(this.firstS - r * this.rowGap), u: (i & 1) ? this.colU : -this.colU }; },
  };

  const DIMS = {
    L, N, DS, HALF_W, APRON_W, APRON_RISE, SHOULDER, WALL_H, WALL_T, FENCE_H,
    WALL_U, APRON_IN, INNER, BANK_TURN, BANK_STRAIGHT, R_TURN, SPIRAL,
    FRONT_HALF, DOGLEG_HALF, DOGLEG, closure: T.closure, bbox: T.bbox,
  };

  const core = {
    DIMS, PIT, GRID, T, BANK,
    frame, surfaceY, toWorld, nearest, wrapS, clamp,
    /* signed arc distance from a to b in (-L/2, L/2] */
    ds(a, b) { let d = wrapS(b) - wrapS(a); if (d > L / 2) d -= L; if (d <= -L / 2) d += L; return d; },
    /* the flat-plan outline at offset u, as [x,z,...] (for maps and builders) */
    outline(u, step) {
      step = step || 2; const out = [], f = {};
      for (let s = 0; s < L; s += step) { frame(s, f); out.push(f.x + f.nx * u, f.z + f.nz * u); }
      return out;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.core = core;
  }
})(typeof window !== "undefined" ? window : null);
