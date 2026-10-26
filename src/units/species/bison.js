/* ============================================================
   units/species/bison.js — THE AMERICAN BISON (Bison bison), and the
   shared LARGE-UNGULATE ENGINE (CBZ.ungulateKit) its three siblings ride:
   moose.js, elk.js and caribou.js are data + their own antlers over this
   engine (units/manifest.js's `needs` loads this file first).

   OWNED BY: the bison agent (bison, moose, elk, caribou).

   WHAT WAS HERE: the bestiary's box bison (city/wildlife/snow_ungulates.js:
   ~20 axis-aligned boxes on four posts, scale 1.3, hp 200) walked by the
   discovered box rig and fought by creature_combat's generic RAM.

   THE ENGINE (one implementation for four animals)
     BODY      one SkinnedMesh per animal on ONE shared geometry per variant
               (species x sex x coat tint x horns/antlers), 33 bones: the
               kit's quadruped table (2 neck, 3 tail, ears, a mane HACKLE, a
               HUMP) plus a PASTERN/HOOF bone per leg. Unguligrade legs:
               humerus/femur, radius/tibia, a long cannon (metacarpus /
               metatarsus), and a sloped pastern onto a CLOVEN hoof with
               dewclaws. Lofted torso (spec tables from real proportions),
               muscled legs (triceps, forearm, ham, gaskin, the point of the
               hock), head with a hinged jaw, eyes, ears; horns and antlers
               are swept tubes and palms (rotation-minimising frames) on the
               head bone. Coat = vertex colours from sRGB reference colours.
               The geometry's bounding BOX is the hide, not the antlers, so
               the battle's measured body (separation, hit zones) is the
               animal and a 1.5 m rack is not a 1.5 m wide target.
     GAIT      CBZ.quadGait with a per-species footfall table (walk, trot,
               gallop; the moose and caribou live in the trot). Every hoof
               plants; legs are 2-bone IK + cannon + pastern with abduction;
               forelegs fold at the carpus in swing, hind at the hock; the
               body rocks in the gallop, bounces in the trot, nods in the walk.
     IDLE      grazing (head to the grass), chewing the cud, ear flicks,
               tail swishes, looking about, lying down (sternal, legs folded
               under) when nothing is near.
     REACTIONS flinch by where it was hit, lame legs (toe-touching, the body
               drops on the bad leg), blown (open-mouthed, head low), death
               handed to systems/quadruped_ragdoll.js through invisible
               markers; the skin follows the solved points.
     FIGHT     physical damage: every blow is an impact of a real mass at a
               real speed (E = 1/2 mu v^2 on the reduced mass), delivered as a
               fraction of what the TARGET's mass can soak, sharp (horn,
               antler, hoof edge) or blunt. Acts: CHARGE (head down, run
               through, the light are TOSSED), HOOK (horn sweep upward), BUTT,
               STRIKE (rear and chop with both forefeet), STOMP (trample the
               downed), KICK (both hind feet at what is behind), ANTLER (gore
               and twist), SPAR (lock antlers and shove), THREAT (the species'
               display and mock charges: never commit to armour).
     NERVE     per species: the bison herd charges and STAMPEDES as one and
               breaks as one; the moose stands its ground; elk and caribou
               flee as a herd and turn at bay only when caught or blown.
     SPEED     earned: real top speed, a mass-limited acceleration, a
               stamina tank (the caribou runs for ever), slower when hurt.

   THE BISON (reference: plains bison, NPS / Meagher 1986 Mammalian Species)
     bull  shoulder (hump) 1.86 m, nose to rump 3.2 m, 900 kg, horns ~0.5 m
     cow   shoulder 1.55 m, 480 kg
     top speed 56 km/h (15.6 m/s), runs for kilometres, turns on its
     forefeet. The HUMP is the neural spines of the thoracic vertebrae,
     anchoring the neck muscles that swing the head as a plough. Long woolly
     cape over head, hump, shoulders and forelegs (dark), short sun-bleached
     hair behind; beard; black horns that run out sideways and curve up.
     The tail goes UP before a charge. A herd stampedes together.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function cmix(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
    const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
    const bl = (a & 255) * (1 - t) + (b & 255) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function cmul(a, k) {
    const r = clamp(Math.round(((a >> 16) & 255) * k), 0, 255), g = clamp(Math.round(((a >> 8) & 255) * k), 0, 255), b = clamp(Math.round((a & 255) * k), 0, 255);
    return (r << 16) | (g << 8) | b;
  }
  // smooth, cheap coat noise (-1..1)
  function nz(x, y, z) {
    return 0.5 * Math.sin(x * 11.3 + y * 3.1 + 1.7) * Math.sin(z * 9.7 - y * 5.3 + 0.4) +
      0.3 * Math.sin(x * 23.9 - z * 17.1 + y * 7.7) + 0.2 * Math.sin(y * 31.0 + x * 13.3 - z * 29.0);
  }
  // reference colours are sRGB (what a photo shows); vertex colours are linear
  const _lin = new Map();
  function lin(hex) {
    let v = _lin.get(hex);
    if (v === undefined) {
      const f = function (c) { c /= 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); };
      v = (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
      if (_lin.size < 60000) _lin.set(hex, v);
    }
    return v;
  }
  function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001; }
  function env(p, a, b, c, d) { return p < a || p > d ? 0 : p < b ? sstep(a, b, p) : p < c ? 1 : 1 - sstep(c, d, p); }

  // =========================================================================
  //  GEOMETRY HELPERS (the kit's loft + a swept tube for horns and antlers)
  // =========================================================================
  // radial post-displacement of the rings a loft just wrote (wool, manes)
  function displace(G, v0, S, fn) {
    const p = G.p, rings = Math.round((G.n - v0) / S);
    for (let r = 0; r < rings; r++) {
      const base = v0 + r * S;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < S; j++) { const k = (base + j) * 3; cx += p[k]; cy += p[k + 1]; cz += p[k + 2]; }
      cx /= S; cy /= S; cz /= S;
      const t = rings > 1 ? r / (rings - 1) : 0;
      for (let j = 0; j < S; j++) {
        const k = (base + j) * 3, a = TAU * j / S;
        const m = fn(t, Math.cos(a), Math.sin(a), j, r, p[k], p[k + 1], p[k + 2]);
        p[k] = cx + (p[k] - cx) * m; p[k + 1] = cy + (p[k + 1] - cy) * m; p[k + 2] = cz + (p[k + 2] - cz) * m;
      }
    }
  }
  function v3n(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
  function v3x(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3d(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  /* A SWEPT TUBE along a 3-D polyline, with rotation-minimising frames, so a
     horn can curl out sideways and an antler beam can run back and up (the
     kit's loft takes one fixed side vector and flips on such curves).
       pts  [[x, y, z], ...]      rad  [[ra, rb], ...] per point (ra along N)
       nrm  a hint for N (the "ra" axis: a palm's width)
       colour(x, y, z, ca, sa, t) -> linear hex; wts the bone weights
       end caps are fans (a tip closes to a point when its radius is ~0) */
  function sweep(G, pts, rad, S, colour, wts, nrm) {
    const n = pts.length;
    if (n < 2) return;
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      T.push(v3n([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
    }
    let N = nrm ? nrm.slice() : [0, 1, 0];
    let d = v3d(N, T[0]);
    N = [N[0] - T[0][0] * d, N[1] - T[0][1] * d, N[2] - T[0][2] * d];
    if (Math.hypot(N[0], N[1], N[2]) < 1e-4) N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    v3n(N);
    const base = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        d = v3d(N, T[i]);
        N = [N[0] - T[i][0] * d, N[1] - T[i][1] * d, N[2] - T[i][2] * d];
        if (Math.hypot(N[0], N[1], N[2]) < 1e-5) N = v3x(T[i], [0, 0, 1]);
        v3n(N);
      }
      const B = v3n(v3x(T[i], N));
      const P = pts[i], ra = rad[i][0], rb = rad[i][1], t = i / (n - 1);
      base.push(G.n);
      for (let j = 0; j < S; j++) {
        const a = TAU * j / S, ca = Math.cos(a), sa = Math.sin(a);
        const x = P[0] + N[0] * ca * ra + B[0] * sa * rb;
        const y = P[1] + N[1] * ca * ra + B[1] * sa * rb;
        const z = P[2] + N[2] * ca * ra + B[2] * sa * rb;
        G.vert(x, y, z, colour(x, y, z, ca, sa, t), wts);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const A = base[i], Bb = base[i + 1];
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        G.ix.push(A + j, A + j1, Bb + j);
        G.ix.push(A + j1, Bb + j1, Bb + j);
      }
    }
    // caps
    for (let e = 0; e < 2; e++) {
      const i = e === 0 ? 0 : n - 1, P = pts[i], R = base[i];
      const c = G.vert(P[0] + T[i][0] * (e ? 1 : -1) * rad[i][1] * 0.3, P[1] + T[i][1] * (e ? 1 : -1) * rad[i][1] * 0.3, P[2] + T[i][2] * (e ? 1 : -1) * rad[i][1] * 0.3,
        colour(P[0], P[1], P[2], 1, 0, e), wts);
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        if (e === 0) G.ix.push(c, R + j1, R + j); else G.ix.push(c, R + j, R + j1);
      }
    }
  }
  // a smooth curve through control points (Catmull-Rom), n samples
  function curve(cp, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) * (cp.length - 1), k = Math.min(cp.length - 2, Math.floor(u)), t = u - k;
      const p0 = cp[Math.max(0, k - 1)], p1 = cp[k], p2 = cp[k + 1], p3 = cp[Math.min(cp.length - 1, k + 2)];
      const t2 = t * t, t3 = t2 * t;
      const f = function (a, b, c, d) { return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
    return out;
  }
  // point at fraction t along a polyline (by arc length) + its tangent
  function along(pts, t) {
    let L = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); seg.push(l); L += l; }
    let s = clamp(t, 0, 1) * L;
    for (let i = 0; i < seg.length; i++) {
      if (s <= seg[i] || i === seg.length - 1) {
        const k = seg[i] > 0 ? clamp(s / seg[i], 0, 1) : 0, a = pts[i], b = pts[i + 1];
        return { p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)], t: v3n([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), L: L };
      }
      s -= seg[i];
    }
    return { p: pts[pts.length - 1].slice(), t: [1, 0, 0], L: L };
  }
  /* A TINE: a tapering, slightly curved tube grown off a point in a
     direction, bent toward `bend` over its length. */
  function tine(X, at, dir, len, r0, bend, part, nrm) {
    v3n(dir);
    const cp = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3, b = bend ? t * t * 0.35 : 0;
      cp.push([at[0] + (dir[0] + (bend ? bend[0] * b : 0)) * len * t, at[1] + (dir[1] + (bend ? bend[1] * b : 0)) * len * t, at[2] + (dir[2] + (bend ? bend[2] * b : 0)) * len * t]);
    }
    const pts = curve(cp, 6), rad = [];
    for (let i = 0; i < pts.length; i++) { const t = i / (pts.length - 1), r = r0 * (1 - 0.88 * Math.pow(t, 0.9)); rad.push([r, r]); }
    X.sweep(pts, rad, 6, part, nrm);
  }

  // =========================================================================
  //  THE SKELETON: the kit's table + a pastern/hoof bone per leg
  // =========================================================================
  let _table = null;
  function table() {
    if (_table) return _table;
    const T = CBZ.quadRig.bones({ neck: 2, tail: 3, tailStops: [0, 0.34, 0.67], ears: true, hackle: true, hump: true });
    const PARENT = T.PARENT.slice();
    let n = T.NB;
    const PAW = [];
    for (let L = 0; L < 4; L++) { PAW.push(n++); PARENT.push(T.LEGB[L][2]); }
    function bindPoints(D) {
      const P = T.bindPoints(D);
      for (let L = 0; L < 4; L++) {
        const f = P[T.LEGB[L][2]], c = L < 2 ? D.fc : D.hc;
        P.push([f[0], f[1] - c, f[2]]);
      }
      return P;
    }
    _table = { BN: T.BN, LEGB: T.LEGB, PAW: PAW, PARENT: PARENT, NB: n, spec: T.spec, bindPoints: bindPoints };
    return _table;
  }

  /* DIMENSIONS. A species' dims(sex) returns the raw numbers (metres, nose
     +X, up +Y, ground 0, left = -Z); finish() derives the rest the engine
     and the kit read. */
  function finish(D) {
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    D.n = { x: -D.u.y, y: D.u.x };
    const Hs = D.Hs;
    D.hp = function (d, h) { return { x: D.headP.x + (D.u.x * d + D.n.x * h) * Hs, y: D.headP.y + (D.u.y * d + D.n.y * h) * Hs }; };
    D.jawP = D.hp(D.jaw[0], D.jaw[1]);
    D.earP = Object.assign(D.hp(D.ear.d, D.ear.h), { z: D.ear.z * Hs });
    D.eyeP = Object.assign(D.hp(D.eye.d, D.eye.h), { z: D.eye.z * Hs });
    D.mouth = D.hp(D.jaw[2] - 0.04, D.jaw[3] + 0.03);
    D.K = D.withers / 0.62;
    D.FJ = D.FJ || { x: D.shX, y: D.sh };
    D.HJ = D.HJ || { x: D.hipX, y: D.hipH };
    D.neckB = D.neckB || { x: D.NECK[0][0], y: D.NECK[0][1] };
    D.hackleP = D.hackleP || { x: (D.neckB.x + D.headP.x) / 2, y: (D.neckB.y + D.headP.y) / 2 + 0.1 * D.H };
    D.humpP = D.humpP || { x: D.shX - 0.05 * D.H, y: D.withers - 0.25 * D.H };
    D.legLen = D.legLen || (D.FJ.y * 0.95);
    D.feet = [
      // the forehoof stands BEHIND the point of the shoulder: the humerus
      // runs back-down to the elbow and the forearm is a vertical column
      { x: D.FJ.x - (D.foreBack != null ? D.foreBack : 0.09 * D.H) + D.pdx, z: -D.legZf, front: true },
      { x: D.FJ.x - (D.foreBack != null ? D.foreBack : 0.09 * D.H) + D.pdx, z: D.legZf, front: true },
      { x: D.HJ.x + D.pdx - 0.03 * D.H, z: -D.legZh, front: false },
      { x: D.HJ.x + D.pdx - 0.03 * D.H, z: D.legZh, front: false },
    ];
    return D;
  }

  // =========================================================================
  //  GEOMETRY
  // =========================================================================
  function buildGeometry(spec, D, V) {
    const LK = CBZ.loftKit, G = LK.geo(), T = table(), BN = T.BN, LEGB = T.LEGB, PAW = T.PAW;
    const H = D.H, Hs = D.Hs;
    const col = spec.colour(D, V);
    const C = function (part) { return function (x, y, z, ca, sa, R, t) { return lin(col(part, x, y, z, ca, sa, t)); }; };
    const CS = function (part) { return function (x, y, z, ca, sa, t) { return lin(col(part, x, y, z, ca, sa, t)); }; };
    const loft = function (st, S, part, opts, disp) {
      const v0 = G.n;
      LK.loft(G, st, S, C(part), opts || {});
      if (disp) displace(G, v0, S, disp);
      return v0;
    };
    const X = {
      G: G, D: D, V: V, BN: BN, LEGB: LEGB, PAW: PAW, C: C, CS: CS, loft: loft, lin: lin, col: col,
      sweep: function (pts, rad, S, part, nrm, wts) { sweep(G, pts, rad, S, CS(part), wts || [BN.head, 1], nrm); },
      ellipsoid: function (cx, cy, cz, rx, ry, rz, S, part, wts) { LK.ellipsoid(G, cx, cy, cz, rx, ry, rz, S, C(part), wts); },
      displace: function (v0, S, fn) { displace(G, v0, S, fn); },
      curve: curve, along: along, tine: function (at, dir, len, r0, bend, part, nrm) { tine(X, at, dir, len, r0, bend, part, nrm); },
      hairFn: function (amp, ph, mask) {
        return function (t, ca, sa, j, r, x, y, z) {
          const k = mask ? mask(t, ca, sa, x, y, z) : 1;
          if (k <= 0) return 1;
          const a = TAU * j / 24;
          const lock = 0.5 * Math.sin(a * 5 + ph + t * 7) + 0.3 * Math.sin(a * 11 - ph * 1.7 + t * 13) + 0.2 * Math.sin(a * 17 + ph * 0.6 - t * 19);
          return 1 + k * amp * (0.55 + 0.45 * lock);
        };
      },
    };

    // ---- TORSO: rump -> loin -> flank -> ribs -> withers/hump -> point of shoulder
    const xs = D.shX - 0.1 * H, xh = D.hipX + 0.15 * H;
    const tor = D.TOR.map(function (r) {
      const wP = clamp((xs - r[0]) / (xs - xh), 0, 1);
      return { x: r[0], y: r[1], rt: r[2], rb: r[3], w: r[4], sq: r[6] || 0.92, wts: [BN.pelvis, wP, BN.chest, 1 - wP], hk: r[5] || 0, hkBone: BN.hump };
    });
    const vT = loft(tor, 28, "torso", { capLen: 0.75 });
    if (spec.torsoHair) displace(G, vT, 28, spec.torsoHair(X));
    const torsoEnd = G.n;

    // ---- NECK (chest -> neck0 -> neck1 -> head), mane on the hackle bone
    const NK = D.NECK, nN = NK.length;
    const nst = NK.map(function (r, i) {
      const t = i / (nN - 1);
      let wts;
      if (t < 0.25) wts = [BN.chest, 1 - t / 0.25, BN.neck, t / 0.25];
      else if (t < 0.6) wts = [BN.neck, 1 - (t - 0.25) / 0.35 * 0.6, BN.neck1, (t - 0.25) / 0.35 * 0.6];
      else wts = [BN.neck1, 1 - (t - 0.6) / 0.4 * 0.5, BN.head, (t - 0.6) / 0.4 * 0.5];
      return { x: r[0], y: r[1], rt: r[2], rb: r[3], w: r[4], sq: r[5] || 0.95, wts: wts, hk: r[6] || 0, hkBone: BN.hackle };
    });
    const vN = loft(nst, 24, "neck", { capLen: 0.5 });
    if (spec.neckHair) displace(G, vN, 24, spec.neckHair(X));

    // ---- HEAD along its own axis (d forward, h toward the brow)
    const vH = loft(D.HEAD.map(function (r) {
      const p = D.hp(r[0], r[1]);
      return { x: p.x, y: p.y, rt: r[2] * Hs, rb: r[3] * Hs, w: r[4] * Hs, sq: r[5], wts: [BN.head, 1] };
    }), 22, "head", { capLen: 0.45 });
    if (spec.headHair) displace(G, vH, 22, spec.headHair(X));
    // nostrils: two dark slits on the front of the muzzle
    const NS = D.nostril;
    if (NS) {
      for (let s = -1; s <= 1; s += 2) {
        const p = D.hp(NS[0], NS[1]);
        LK.ellipsoid(G, p.x, p.y, s * NS[2] * Hs, NS[3] * Hs, NS[4] * Hs, NS[3] * 0.8 * Hs, 8, C("nostril"), [BN.head, 1]);
      }
    }
    // the lower jaw: hinge -> chin, on the jaw bone
    const J0 = D.jawP, J1 = D.hp(D.jaw[2], D.jaw[3]), JR = D.jawR;
    loft([0, 0.35, 0.7, 1].map(function (t, i) {
      return { x: lerp(J0.x, J1.x, t), y: lerp(J0.y, J1.y, t), rt: JR[0][i] * Hs, rb: JR[1][i] * Hs, w: JR[2][i] * Hs, wts: [BN.jaw, 1] };
    }), 14, "jaw", { capLen: 0.7 });
    // eyes: a dark, glossy eye with a sliver of white and a heavy lid
    for (let s = -1; s <= 1; s += 2) {
      const E = D.eyeP, ez = s * E.z, r = D.eye.r * Hs;
      const fx = 0.35, fy = 0.15, fz = s * 0.9, fl = Math.hypot(fx, fy, fz);
      LK.ellipsoid(G, E.x, E.y, ez, r * 1.15, r, r * 0.8, 12, function (x, y, z) {
        const dx = (x - E.x) / (r * 1.15), dy = (y - E.y) / r, dz = (z - ez) / (r * 0.8), dl = Math.hypot(dx, dy, dz) || 1;
        const dot = (dx * fx + dy * fy + dz * fz) / (dl * fl);
        return lin(dot > 0.8 ? 0x0a0806 : dot > 0.45 ? col("eye", x, y, z, 0, 0, 0) : dot > 0.3 ? 0xb8ac9c : col("lid", x, y, z, 0, 0, 0));
      }, [BN.head, 1]);
    }
    // ears: a leaf, cupped forward, on the ear bones
    const EA = D.ear;
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, len = EA.len * Hs, wd = EA.w * Hs;
      const dir = v3n([EA.dir[0], EA.dir[1], EA.dir[2] * s]);
      const pts = [], rad = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        pts.push([E.x + dir[0] * len * t, E.y + dir[1] * len * t, s * E.z + dir[2] * len * t]);
        const wv = wd * (t < 0.45 ? 0.55 + t / 0.45 * 0.45 : 1 - Math.pow((t - 0.45) / 0.55, 1.6) * 0.92);
        rad.push([wv, wd * 0.18 * (1 - t * 0.6)]);
      }
      sweep(G, pts, rad, 10, function (x, y, z, ca, sa, t) { return lin(col(sa * s > 0.2 ? "earIn" : "ear", x, y, z, ca, sa, t)); }, [eb, 1], [0, 1, 0]);
    }

    // ---- TAIL (three bones), hanging
    const TP = D.tailP, TL = D.tailL, TR = D.tailR, tst = [];
    const prof = D.tailProf || [1, 0.85, 0.72, 0.65, 0.6, 0.62, 0.7];
    for (let i = 0; i < prof.length; i++) {
      const t = i / (prof.length - 1), seg = Math.min(2, Math.floor(t * 3)), f = t * 3 - seg;
      const wts = seg < 2 ? [BN["tail" + seg], 1 - f * 0.5, BN["tail" + (seg + 1)], f * 0.5] : [BN.tail2, 1];
      const r = TR * prof[i];
      tst.push({ x: TP.x - TL * t, y: TP.y, rt: r, rb: r * (D.tailFlat || 1), w: r * 0.9, wts: wts });
    }
    const vTl = loft(tst, 10, "tail", { capLen: 0.9, side: [0, 0, 1] });
    const tailEnd = G.n;
    if (spec.tailHair) displace(G, vTl, 10, spec.tailHair(X));

    // ---- LEGS (bind: straight down from each joint; the IK bends them)
    const pts = T.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], x = P0[0], y0 = P0[1];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc, hh = front ? D.fh : D.hh;
      const k = front ? D.lk : D.lkh;
      const ring = function (y, rt, rb, w, wts) { return { x: x, y: y, z: z, rt: rt * k, rb: rb * k, w: w * k, wts: wts }; };
      const yE = y0 - a, yC = y0 - a - b, yF = y0 - a - b - c;
      const hair = spec.legHair ? spec.legHair(X, front) : null;
      let v;
      if (front) {
        v = loft([
          ring(y0 + 0.12 * H, 0.12, 0.13, 0.10, [ids[0], 1]),
          ring(y0, 0.13, 0.15, 0.10, [ids[0], 1]),
          ring(y0 - a * 0.5, 0.09, 0.16, 0.095, [ids[0], 1]),          // the triceps mass
          ring(yE + 0.03 * H, 0.075, 0.12, 0.085, [ids[0], 0.7, ids[1], 0.3]),
          ring(yE, 0.075, 0.105, 0.08, [ids[0], 0.5, ids[1], 0.5]),   // the elbow (olecranon behind)
        ], 14, "upper", { capLen: 0.6 }, hair && hair(0));
        v = loft([
          ring(yE, 0.08, 0.08, 0.08, [ids[1], 1]),
          ring(yE - b * 0.18, 0.085, 0.07, 0.078, [ids[1], 1]),       // forearm muscles in front
          ring(yE - b * 0.55, 0.06, 0.05, 0.058, [ids[1], 1]),
          ring(yC + 0.04 * H, 0.05, 0.046, 0.052, [ids[1], 0.8, ids[2], 0.2]),
          ring(yC, 0.052, 0.05, 0.06, [ids[1], 0.5, ids[2], 0.5]),   // the carpus (the "knee")
        ], 12, "fore", { capLen: 0.6 }, hair && hair(1));
      } else {
        v = loft([
          ring(y0 + 0.16 * H, 0.15, 0.17, 0.12, [ids[0], 1]),
          ring(y0, 0.17, 0.20, 0.13, [ids[0], 1]),                     // the ham: quadriceps / hamstrings
          ring(y0 - a * 0.5, 0.15, 0.17, 0.115, [ids[0], 1]),
          ring(yE + 0.04 * H, 0.10, 0.11, 0.09, [ids[0], 0.7, ids[1], 0.3]),
          ring(yE, 0.09, 0.10, 0.085, [ids[0], 0.5, ids[1], 0.5]),     // the stifle
        ], 14, "thigh", { capLen: 0.6 }, hair && hair(0));
        v = loft([
          ring(yE, 0.085, 0.10, 0.08, [ids[1], 1]),
          ring(yE - b * 0.3, 0.06, 0.10, 0.068, [ids[1], 1]),          // the gaskin
          ring(yE - b * 0.7, 0.04, 0.06, 0.046, [ids[1], 1]),
          ring(yC + 0.03 * H, 0.04, 0.065, 0.05, [ids[1], 0.75, ids[2], 0.25]),
          ring(yC, 0.042, 0.07, 0.052, [ids[1], 0.5, ids[2], 0.5]),   // the hock + the point of the hock
        ], 12, "gaskin", { capLen: 0.6 }, hair && hair(1));
      }
      void v;
      // the cannon: slim, with the flexor tendons behind
      loft([
        ring(yC, front ? 0.048 : 0.044, front ? 0.046 : 0.055, front ? 0.054 : 0.05, [ids[2], 1]),
        ring(yC - c * 0.25, 0.032, 0.036, 0.036, [ids[2], 1]),
        ring(yC - c * 0.7, 0.03, 0.036, 0.034, [ids[2], 1]),
        ring(yF + 0.02 * H, 0.036, 0.045, 0.042, [ids[2], 0.7, PAW[Lg], 0.3]),
        ring(yF, 0.04, 0.05, 0.046, [ids[2], 0.5, PAW[Lg], 0.5]),   // the fetlock
      ], 10, "cannon", { capLen: 0.6 });
      // the pastern: sloping forward-down to the coronet
      const hk = D.hoofK * H, pdx = D.pdx;
      const yG = yF - hh, coronY = yG + 0.06 * hk;
      sweep(G, [[x, yF, z], [x + pdx * 0.45, lerp(yF, coronY, 0.55), z], [x + pdx * 0.75, coronY + 0.01 * hk, z]],
        [[0.038 * k, 0.034 * k], [0.032 * k, 0.03 * k], [0.034 * k, 0.03 * k]], 10, CS("pastern"), [PAW[Lg], 1], [1, 0, 0]);
      // dewclaws: two small dark horns behind the fetlock
      for (let s = -1; s <= 1; s += 2) {
        LK.ellipsoid(G, x - 0.04 * k, yF - 0.045 * hk, z + s * 0.022 * k, 0.018 * hk, 0.012 * hk, 0.011 * hk, 6, C("hoof"), [PAW[Lg], 1]);
      }
      // the cloven hoof: two digits, a wedge each, flat on the ground
      const hx = x + pdx * 0.75;
      for (let s = -1; s <= 1; s += 2) {
        const zc = z + s * 0.024 * hk;
        const st = [
          [-0.045, 0.046, 0.022, 0.044, 0.024], [-0.01, 0.042, 0.03, 0.042, 0.03],
          [0.035, 0.032, 0.028, 0.032, 0.028], [0.07, 0.018, 0.016, 0.018, 0.02], [0.088, 0.008, 0.006, 0.008, 0.01],
        ].map(function (r) {
          return { x: hx + r[0] * hk, y: yG + r[1] * hk, z: zc + s * 0.004 * hk, rt: r[2] * hk, rb: r[3] * hk, w: r[4] * hk, sq: 0.8, wts: [PAW[Lg], 1] };
        });
        LK.loft(G, st, 10, C("hoof"), { capLen: 0.4 });
      }
    }
    const bodyEnd = G.n;
    void torsoEnd;

    // ---- the species' own parts: horns, antlers, beard, bell, wool
    if (spec.extras) spec.extras(X);

    const geo = LK.toGeometry(G, { boundingSphere: [0, D.withers * 0.6, 0, D.bsR || 3.2 * H] });
    // THE MEASURED BODY IS THE HIDE: the box the battle reads (separation
    // circle, hit zones, aim heights) spans the body, never the rack
    let x0 = 1e9, x1 = -1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < bodyEnd; i++) {
      if (i >= vTl && i < tailEnd) continue;           // the tail hangs; its bind pose points straight back
      const px = G.p[i * 3], py = G.p[i * 3 + 1], pz = G.p[i * 3 + 2];
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py > y1) y1 = py; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
    }
    const THREE = W.THREE;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, y1, z1));
    return geo;
  }

  // =========================================================================
  //  BUILD
  // =========================================================================
  const _geo = new Map();
  const _mat = {};
  function coatMat(id) {
    const THREE = W.THREE;
    let m = _mat[id];
    if (!m) {
      m = _mat[id] = new THREE.MeshStandardMaterial({ vertexColors: true, skinning: true, roughness: 0.92, metalness: 0 });
      m._shared = true; m.name = id + "-coat";
    }
    return m;
  }
  let _mkGeo = null, _mkMat = null;
  function markerGeo(w, h, d) {
    const THREE = W.THREE, key = w + "|" + h + "|" + d;
    _mkGeo = _mkGeo || new Map();
    let gg = _mkGeo.get(key);
    if (!gg) { gg = new THREE.BoxGeometry(w, h, d); gg._shared = true; _mkGeo.set(key, gg); }
    return gg;
  }
  function marker(group, w, h, d, x, y, z, tag) {
    const THREE = W.THREE;
    if (!_mkMat) { _mkMat = new THREE.MeshBasicMaterial({ visible: false }); _mkMat._shared = true; }
    const m = new THREE.Mesh(markerGeo(+w.toFixed(3), +h.toFixed(3), +d.toFixed(3)), _mkMat);
    m.position.set(x, y, z);
    m.visible = false; m.castShadow = false; m.userData.ungMarker = tag;
    group.add(m);
    return m;
  }
  const _dims = {};
  function dimsOf(spec, sex) {
    const k = spec.id + "|" + sex;
    return _dims[k] || (_dims[k] = finish(spec.dims(sex)));
  }
  const _gt = {};
  function gaitOf(spec, D) {
    const k = spec.id + "|" + D.sex;
    return _gt[k] || (_gt[k] = spec.gait(D, CBZ.quadGait.TABLES.HORSE));
  }

  function build(spec, ctx) {
    const THREE = W.THREE, QR = CBZ.quadRig;
    if (!THREE || !QR || !CBZ.loftKit || !CBZ.quadGait) return null;
    const seed = Math.abs(ctx && ctx.seed != null ? (ctx.seed | 0) : Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6));
    const idx = seed % 7919;                          // the spawn index on either side
    const r = mkRng(seed * 2654435761 + spec.salt);
    const sex = spec.sexOf(idx, r);
    const D = dimsOf(spec, sex);
    const V = spec.variant(sex, r, idx);
    const key = spec.id + "|" + sex + "|" + V.key;
    let geo = _geo.get(key);
    if (!geo) { geo = buildGeometry(spec, D, V); _geo.set(key, geo); }
    const T = table();
    const rig = QR.makeSkeleton(T, D, spec.id);
    const mesh = QR.skinnedMesh(geo, coatMat(spec.id), rig);
    mesh.name = spec.id + "-body";
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    group.name = spec.id;
    rig.spec = spec; rig.D = D; rig.table = T; rig.sex = sex; rig.male = sex === "male"; rig.V = V;
    rig.G = CBZ.quadGait.create(D, gaitOf(spec, D));
    rig.st = newState(r);
    rig.ctl = { x: 0, z: 0, y: 0, heading: 0, ground: null, alert: 0.3, aggr: 0, fear: 0, tired: 0, rest: 0, graze: 0, act: null, inj: null, lookAt: null, tailUp: 0 };
    rig.group = group;
    // ---- markers the corpse solver discovers (invisible: legs, head, tail)
    const H = D.H;
    rig.mk = [];
    for (let L = 0; L < 4; L++) {
      const f = D.feet[L], J = L < 2 ? D.FJ : D.HJ;
      const full = marker(group, 0.1 * H, J.y, 0.1 * H, f.x, J.y / 2, f.z, "leg");
      const foot = marker(group, 0.06 * H, 0.14 * H, 0.06 * H, f.x, 0.07 * H, f.z, "foot");
      rig.mk.push({ full: full, foot: foot, fx: f.x, fz: f.z, fy: 0.07 * H, ky: J.y / 2 });
    }
    const hc = D.hp(D.HEAD[Math.floor(D.HEAD.length / 2)][0], 0);
    rig.mkHead = marker(group, 0.14 * H, 0.14 * H, 0.14 * H, hc.x, hc.y, 0, "head");
    rig.mkHead0 = { x: hc.x, y: hc.y, z: 0 };
    rig.mkTail = marker(group, 0.08, 0.08, 0.08, D.tailP.x - 0.1 * H, D.tailP.y - 0.15 * H, 0, "tail");
    rig.mkTail0 = { x: rig.mkTail.position.x, y: rig.mkTail.position.y, z: 0 };
    rig.frame = -1;
    mesh.onBeforeRender = function (renderer) { corpseHook(rig, renderer); };
    group.userData.ungRig = rig;
    // stand it up: a body that is never animated (a still, a far LOD) is
    // still standing on its hooves, not hanging in the bind pose
    const c = rig.ctl;
    for (let i = 0; i < 24; i++) pose(rig, 1 / 30, c);
    rig.st.px = null;
    for (let i = 0; i < rig.G.feet.length; i++) rig.G.feet[i].init = false;
    return group;
  }

  // =========================================================================
  //  POSE
  // =========================================================================
  function newState(r) {
    r = r || Math.random;
    return { px: null, pz: null, ph: 0, v: 0, acc: 0, turn: 0, t: r() * 10,
      alert: 0.3, aggr: 0, fear: 0, tired: 0, lie: 0, graze: 0, idleT: 0, grazeT: 3 + r() * 8, grazing: false,
      lookY: 0, lookP: 0, lookTY: 0, lookTP: 0, lookT: 1 + r() * 2, chew: 0,
      earT: [r() * 3, r() * 3], earF: [0, 0], swishT: 1 + r() * 3, swish: 0, swSide: 1, shakeT: 10 + r() * 20, shake: 0,
      sway: 0, actW: 0, ak: null, ap: 0, aside: 1, tailUp: 0, hackle: 0,
      fl: { t: 0, k: 0, loc: 0, side: 1 }, inj: [0, 0, 0, 0], wasPost: false, deadK: 0, lastT: 0 };
  }
  const _ik = [0, 0];
  function legIK(rig, Lg, bx, by, br, yaw, fx, fy, fz, fa, pawA) {
    const D = rig.D, b = rig.bones, T = rig.table, ids = T.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const off = rig.bindPos[ids[0]];
    const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
    const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
    const jz = off.z;
    const rx = fx - bx, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const tx = bx + rx * cy - fz * sy, tz = rx * sy + fz * cy;
    const dz = tz - jz, dyv = Math.max(0.05, jy - fy);
    const ab = clamp(-Math.atan2(dz, dyv), -0.6, 0.6);
    const ty = jy - Math.hypot(dyv, dz);
    const wx = tx - cl * Math.cos(fa), wy = ty - cl * Math.sin(fa);
    CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
    const t1 = _ik[0], t2 = _ik[1];
    b[ids[0]].rotation.set(ab, 0, t1 + HALF - br);
    b[ids[1]].rotation.set(0, 0, t2 - t1);
    b[ids[2]].rotation.set(0, 0, fa - t2);
    b[T.PAW[Lg]].rotation.set(0, 0, pawA - fa - HALF);
  }

  const OV = [0, 1, 2, 3].map(function () { return { w: 0, x: 0, y: 0, z: 0, a: 0, paw: 0 }; });

  function pose(rig, dt, c) {
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const QG = CBZ.quadGait, S = rig.spec.look;
    const D = rig.D, H = D.H, b = rig.bones, bp = rig.bindPos, BN = rig.table.BN, st = rig.st, G = rig.G;
    st.t += dt;
    const gx = c.x, gz = c.z, h = c.heading || 0;
    // ---- MEASURED motion: whatever moved the body, the legs answer to it
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - st.ph) / dt;
    if (mdx * mdx + mdz * mdz > 9) { v = 0; turn = 0; QG.reset(G, gx, gz, h, c.ground, c.y); }
    st.px = gx; st.pz = gz; st.ph = h;
    const vPrev = st.v;
    st.v = approach(st.v, clamp(v, -4, 24), 8, dt);
    st.acc = approach(st.acc, clamp((st.v - vPrev) / dt, -10, 10), 4, dt);
    st.turn = approach(st.turn, clamp(turn, -6, 6), 8, dt);
    const av = Math.abs(st.v);

    // ---- the action channel (fight hook / preview)
    const A = c.act;
    if (A) { st.ak = A.kind; st.ap = A.p; st.aside = A.side || 1; }
    st.actW = approach(st.actW, A ? 1 : 0, A ? 12 : 5, dt);
    const aw = st.actW, ak = aw > 0.01 ? st.ak : null, ap = st.ap;

    // ---- moods
    st.alert = approach(st.alert, clamp(c.alert || 0, 0, 1), 4, dt);
    st.aggr = approach(st.aggr, clamp(c.aggr || 0, 0, 1), 4, dt);
    st.fear = approach(st.fear, clamp(c.fear || 0, 0, 1), 4, dt);
    st.tired = approach(st.tired, clamp(c.tired || 0, 0, 1), 1.5, dt);
    st.tailUp = approach(st.tailUp, clamp(c.tailUp || 0, 0, 1), 3, dt);
    st.hackle = approach(st.hackle, Math.max(st.aggr * S.hackleAggr, st.fear * 0.3), 3, dt);
    if (c.inj) for (let i = 0; i < 4; i++) st.inj[i] = approach(st.inj[i], c.inj[i], 2, dt);
    // idle: graze in bouts, lie down after a long quiet
    const quiet = av < 0.25 && !ak;
    if (quiet) st.idleT += dt; else st.idleT = 0;
    st.grazeT -= dt;
    if (st.grazeT <= 0) { st.grazing = !st.grazing; st.grazeT = st.grazing ? 4 + Math.random() * 9 : 2 + Math.random() * 5; }
    const wantGraze = c.graze && st.grazing && st.alert < 0.6 && av < 1.6 && !ak ? 1 : 0;
    st.graze = approach(st.graze, wantGraze, wantGraze ? 1.2 : 3.5, dt);
    const wantLie = c.rest && st.idleT > 14 && st.alert < 0.5 ? 1 : 0;
    st.lie = approach(st.lie, wantLie, wantLie ? 0.6 : 2.5, dt);
    // look about, flick ears, swish the tail, chew the cud
    st.lookT -= dt;
    if (st.lookT <= 0) {
      const busy = av > 2 || ak;
      st.lookT = 1.4 + Math.random() * 3;
      st.lookTY = busy ? 0 : (Math.random() - 0.5) * (1.2 - st.aggr);
      st.lookTP = busy ? 0 : (Math.random() - 0.4) * 0.3;
    }
    if (c.lookAt) {
      const la = wrapPi(Math.atan2(c.lookAt.z - gz, c.lookAt.x - gx) - h);
      st.lookTY = clamp(-la, -1.0, 1.0);
    }
    st.lookY = approach(st.lookY, st.lookTY, 2.5, dt);
    st.lookP = approach(st.lookP, st.lookTP, 2.5, dt);
    for (let e = 0; e < 2; e++) {
      st.earT[e] -= dt;
      if (st.earT[e] <= 0) { st.earT[e] = 1.2 + Math.random() * 4; st.earF[e] = 1; }
      st.earF[e] = Math.max(0, st.earF[e] - dt * 4);
    }
    st.swishT -= dt;
    if (st.swishT <= 0) { st.swishT = 1.5 + Math.random() * 4; st.swish = 1; st.swSide = Math.random() < 0.5 ? -1 : 1; }
    st.swish = Math.max(0, st.swish - dt * 1.4);
    st.shakeT -= dt;
    if (st.shakeT <= 0 && quiet && st.aggr < 0.3) { st.shake = 0.9; st.shakeT = 15 + Math.random() * 30; }
    st.shake = Math.max(0, st.shake - dt);
    if (quiet && st.graze < 0.3) st.chew += dt * 9; else if (st.graze > 0.5) st.chew += dt * 6;
    // flinch
    const F = st.fl;
    if (F.t > 0) F.t = Math.max(0, F.t - dt);
    const fk = F.t > 0 ? F.k * Math.sin(PI * Math.min(1, F.t / 0.45)) * (F.t / 0.45) : 0;

    // ---- GAIT (standing; a body in the air, lying down or rearing does not step)
    const rearing = (ak === "strike" || ak === "rear") && aw > 0.5;
    const postK = Math.max(st.lie, 0);
    if (postK < 0.08) {
      if (st.wasPost) { QG.reset(G, gx, gz, h, c.ground, c.y); st.wasPost = false; }
      QG.step(G, dt, st.v, st.turn, gx, gz, h, c.ground, c.y);
    } else st.wasPost = true;
    const M = G.mix, ph = G.phase * TAU;
    const moveK = clamp(av / 0.6, 0, 1) * (1 - postK);
    const wlk = (M.wW || 0) * moveK, trt = (M.wT || 0) * moveK, gal = (M.wG || 0) * moveK;

    // ---- BODY: pelvis + chest positions and pitch
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0, roll = 0;
    // the walk: a gentle heave twice a stride; the trot: a bounce; the gallop: the rocking horse
    const bob = -(0.008 * wlk * (0.5 - 0.5 * Math.cos(2 * ph)) + S.trotBounce * trt * Math.abs(Math.sin(2 * ph))) * H;
    pY += bob; cY += bob;
    roll += 0.03 * wlk * Math.sin(ph);
    const rock = S.gallopRock * gal;
    pR += rock * Math.sin(ph + 0.4); cR += rock * Math.sin(ph + 0.4);
    pY += 0.05 * H * gal * Math.sin(ph - 1.2); cY += 0.06 * H * gal * Math.sin(ph + 0.2);
    pY -= 0.03 * H * gal; cY -= 0.04 * H * gal;
    // starts drive from the hindquarters (front lifts), stops sit back on the hocks
    cY += clamp(st.acc, -6, 6) * 0.004 * H; pY -= clamp(st.acc, -6, 6) * 0.004 * H;
    cR += clamp(st.acc, -6, 6) * 0.006;
    // fear: hindquarters bunched; aggression: the forehand braced low
    pY -= 0.05 * H * st.fear; cY -= 0.03 * H * st.aggr;
    const lame = Math.max(st.inj[0], st.inj[1], st.inj[2], st.inj[3]);
    cY -= 0.025 * H * st.tired;
    // breathing: deeper and quicker when blown
    const br = Math.sin(st.t * (1.2 + st.tired * 4)) * (0.003 + st.tired * 0.008) * H;
    cY += br;
    if (fk > 0) {
      if (F.loc === 1) { cY -= 0.08 * H * fk; cR -= 0.1 * fk; roll += 0.07 * F.side * fk; }
      else if (F.loc === 2) { pY -= 0.1 * H * fk; pR += 0.12 * fk; roll -= 0.07 * F.side * fk; }
      else if (F.loc === 3) { roll += 0.1 * F.side * fk; }
    }
    for (let i = 0; i < 4; i++) {
      if (st.inj[i] < 0.05) continue;
      const load = G.feet[i].sw ? 0 : st.inj[i];
      const side = i % 2 === 0 ? -1 : 1;
      roll += side * 0.05 * load * moveK;
      if (i < 2) cY -= 0.03 * H * load * moveK; else pY -= 0.03 * H * load * moveK;
    }

    // ---- ACTIONS
    let neckP = 0, neckY = 0, headP = 0, headR = 0, jawA = 0, earBack = 0, tailUp = st.tailUp, lift = 0;
    for (let i = 0; i < 4; i++) OV[i].w = 0;
    if (ak) {
      switch (ak) {
        case "charge": {
          // the head goes down and the horns/brow come round to the front
          neckP -= S.chargeNeck * aw; headP -= S.chargeHead * aw; earBack += aw; tailUp = Math.max(tailUp, S.tailCharge * aw);
          cY -= 0.04 * H * aw;
          break;
        }
        case "hook": {
          // low, then the upward sweep of the head with a twist to one side
          const down = env(ap, 0, 0.3, 0.42, 0.55), up = env(ap, 0.42, 0.6, 0.7, 1);
          neckP += (-S.chargeNeck * down + 0.45 * up) * aw;
          headP += (-S.chargeHead * down + 0.25 * up) * aw;
          neckY += 0.35 * st.aside * up * aw; headR += 0.45 * st.aside * up * aw;
          cY += (-0.05 * down + 0.06 * up) * H * aw; cX += 0.06 * H * up * aw; pY -= 0.02 * H * up * aw;
          earBack += aw; tailUp = Math.max(tailUp, 0.7 * aw);
          break;
        }
        case "butt": {
          const e = env(ap, 0, 0.35, 0.5, 1), thrust = env(ap, 0.3, 0.45, 0.55, 0.8);
          neckP -= (S.chargeNeck * 0.8 * e) * aw; headP -= (S.chargeHead * 0.8 * e) * aw;
          cX += 0.14 * H * thrust * aw; pX += 0.08 * H * thrust * aw; cY -= 0.04 * H * e * aw;
          earBack += aw;
          break;
        }
        case "antler": {
          // head down, the tines forward, a thrust and a hard twist
          const e = env(ap, 0, 0.3, 0.65, 1), thrust = env(ap, 0.3, 0.45, 0.55, 0.85);
          neckP -= (0.5 * e) * aw; headP -= (0.5 * e) * aw;
          headR += 0.5 * st.aside * env(ap, 0.45, 0.6, 0.7, 0.95) * aw;
          neckY += 0.25 * st.aside * env(ap, 0.45, 0.6, 0.7, 0.95) * aw;
          cX += 0.12 * H * thrust * aw; cY -= 0.05 * H * e * aw;
          earBack += aw;
          break;
        }
        case "spar": {
          // locked: heads low, braced, shoving in surges
          const surge = 0.5 + 0.5 * Math.sin(st.t * 3.4);
          neckP -= 0.55 * aw; headP -= 0.45 * aw;
          cX += 0.06 * H * surge * aw; pX += 0.04 * H * surge * aw; cY -= 0.06 * H * aw; pY -= 0.04 * H * aw;
          headR += 0.15 * Math.sin(st.t * 1.7) * aw;
          earBack += aw;
          for (let L = 2; L < 4; L++) { const o = OV[L]; void o; }
          break;
        }
        case "strike":
        case "rear": {
          // rear on the hocks, then both forefeet chop down (twice in a strike)
          const up = ak === "rear" ? env(ap, 0, 0.3, 0.75, 1) : env(ap, 0, 0.3, 0.42, 0.62);
          const up2 = ak === "strike" ? env(ap, 0.62, 0.72, 0.78, 0.95) * 0.6 : 0;
          const e = Math.max(up, up2);
          const rise = S.rearRise * H;
          cY += rise * e * aw; cR += S.rearPitch * e * aw; pY -= 0.08 * H * e * aw; pR += 0.15 * e * aw; pX += 0.05 * H * e * aw;
          for (let L = 0; L < 2; L++) {
            const o = OV[L], sg = L === 0 ? -1 : 1;
            const chop = ak === "strike" ? sstep(0.42, 0.55, ap) * (1 - sstep(0.6, 0.66, ap)) + sstep(0.78, 0.88, ap) : 0;
            o.w = aw * Math.max(e, chop * 0.8);
            const reach = (0.35 + 0.2 * chop) * H;
            o.x = cX + reach; o.y = Math.max(D.fh, cY - (0.55 - 0.35 * chop) * H - (L === 1 ? 0.06 * H : 0)); o.z = sg * D.legZf;
            o.a = -HALF + 1.6 * e * (1 - chop * 0.7); o.paw = -1.0 * e;
          }
          neckP += (0.25 * e) * aw; headP -= 0.2 * e * aw; earBack += aw;
          break;
        }
        case "stomp": {
          // standing over it: the forefeet come down in turn, the head low and watching
          const k = (ap * 3) % 1, Lg = Math.floor(ap * 3) % 2;
          const o = OV[Lg], sg = Lg === 0 ? -1 : 1;
          const lift2 = Math.sin(PI * k);
          o.w = aw; o.x = cX + 0.3 * H; o.y = D.fh + 0.42 * H * lift2; o.z = sg * D.legZf * 0.9;
          o.a = -HALF + 0.9 * lift2; o.paw = -0.6 * lift2;
          cY += 0.08 * H * lift2 * aw; cR += 0.1 * lift2 * aw;
          neckP -= 0.3 * aw; headP -= 0.2 * aw; earBack += aw;
          break;
        }
        case "kick": {
          // the buck: forehand down, both hind feet lashed out behind
          const e = env(ap, 0.1, 0.4, 0.55, 0.9);
          pY += 0.18 * H * e * aw; pR -= 0.25 * e * aw; cY -= 0.08 * H * e * aw; cR -= 0.15 * e * aw;
          for (let L = 2; L < 4; L++) {
            const o = OV[L], sg = L === 2 ? -1 : 1;
            o.w = aw * e; o.x = pX - 0.75 * H; o.y = pY - 0.35 * H; o.z = sg * D.legZh;
            o.a = PI - 0.25; o.paw = -0.3;
          }
          neckP -= 0.25 * e * aw; earBack += aw; tailUp = Math.max(tailUp, e);
          break;
        }
        case "threat": {
          // the species' display: head low and swinging (bison), hackles up and
          // ears pinned (moose), head high and stamping (elk, caribou)
          const sw = Math.sin(st.t * 2.6);
          neckP += (S.threatNeck) * aw; headP += S.threatHead * aw;
          neckY += S.threatSwing * sw * aw;
          earBack += S.threatEars * aw; tailUp = Math.max(tailUp, S.tailThreat * aw);
          if (S.threatPaw) {
            // pawing the ground with one forefoot
            const k = (st.t * 1.6) % 1, o = OV[0];
            o.w = aw; o.x = cX + (0.2 - 0.35 * k) * H; o.y = D.fh + 0.12 * H * Math.sin(PI * k); o.z = -D.legZf; o.a = -HALF - 0.4 * Math.sin(PI * k); o.paw = -0.5 * Math.sin(PI * k);
          }
          break;
        }
        case "bellow": {
          const e = env(ap, 0, 0.2, 0.8, 1);
          neckP += S.bellowNeck * e * aw; headP += S.bellowHead * e * aw; jawA += 0.35 * e * aw;
          break;
        }
      }
    }
    void lift; void rearing;
    if (st.aggr > 0.05) { earBack = Math.max(earBack, st.aggr * S.aggrEars); }

    // ---- GRAZE (head to the grass) and LIE (sternal), blended in
    const gz2 = st.graze * (1 - aw);
    neckP += S.grazeNeck * gz2; headP += S.grazeHead * gz2;
    cY -= 0.02 * H * gz2;
    const wL = st.lie, wSt = 1 - wL;
    const Lb = D.shX - D.hipX;
    const lCY = D.lieC * H, lPY = D.lieP * H;
    const lP = Math.atan2(lCY - lPY, Lb);
    pY = pY * wSt + lPY * wL; cY = cY * wSt + lCY * wL;
    pR = pR * wSt + lP * wL; cR = cR * wSt + lP * wL;

    // ---- spine bend into turns
    const chestYaw = clamp(st.turn * 0.05, -0.15, 0.15) * (1 - wL) + (F.loc === 3 ? 0.12 * F.side * fk : 0);
    const pelvYaw = -chestYaw * 0.7;
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(-roll * 0.6, pelvYaw, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(roll, chestYaw, cR);

    // ---- LEGS
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, Ft = G.feet[Lg];
      const bx = front ? cX : pX, by = front ? cY : pY, brr = front ? cR : pR;
      const off = bp[rig.table.LEGB[Lg][0]];
      const jx = bx + Math.cos(brr) * off.x - Math.sin(brr) * off.y, jy = by + Math.sin(brr) * off.x + Math.cos(brr) * off.y;
      const hh = front ? D.fh : D.hh;
      let fx = Ft.lx - D.pdx, fy = Ft.ly + hh, fz = Ft.lz;
      const u = Ft.u, flex = Ft.sw ? Math.pow(Math.sin(PI * u), 0.8) : 0;
      const colA = Math.atan2(fy - jy, fx - jx);
      let fa, paw;
      if (front) {
        fa = Ft.sw ? colA - S.carpusFold * flex * (u < 0.85 ? 1 : (1 - u) / 0.15) : colA * 0.75 - HALF * 0.25;
        paw = Ft.sw ? -1.2 * flex : 0;
      } else {
        const back = clamp((D.feet[Lg].x - Ft.lx) / (0.45 * H), -1, 1);
        fa = Ft.sw ? -HALF - 0.55 * Math.sin(PI * u) * (1 - u) + 0.25 * u * u : -HALF + 0.08 - 0.32 * back;
        paw = Ft.sw ? -0.9 * flex : 0.15 * Math.max(0, back);
      }
      if (st.inj[Lg] > 0.05 && !Ft.sw) fy += 0.05 * H * st.inj[Lg] * moveK;   // a lame leg barely loads
      // lying: forelegs folded under the chest (carpus flexed), hind folded beside
      if (wL > 0.001) {
        const z = (Lg % 2 === 0 ? -1 : 1) * (front ? D.legZf * 1.05 : D.legZh * 1.6);
        const lx = front ? cX - 0.02 * H : pX + 0.28 * H, ly = 0.05 * H;
        const la = front ? PI - 0.15 : 0.1;
        fx = lerp(fx, lx, wL); fy = lerp(fy, ly, wL); fz = lerp(fz, z, wL); fa = lerp(fa, la, wL); paw = lerp(paw, front ? -1.4 : -0.6, wL);
      }
      const o = OV[Lg];
      if (o.w > 0.001) { fx = lerp(fx, o.x, o.w); fy = lerp(fy, o.y, o.w); fz = lerp(fz, o.z, o.w); fa = lerp(fa, o.a, o.w); paw = lerp(paw, o.paw, o.w); }
      legIK(rig, Lg, bx, by, brr, front ? chestYaw : pelvYaw, fx, fy, fz, fa, paw);
    }

    // ---- HUMP (rides with the forehand's work) and the HACKLES (the mane goes up)
    const hb = bp[BN.hump];
    b[BN.hump].position.set(hb.x, hb.y + (0.012 * Math.abs(Math.sin(ph)) * (wlk + trt + gal)) * H, 0);
    const kb = bp[BN.hackle];
    b[BN.hackle].position.set(kb.x, kb.y + 0.05 * H * st.hackle, 0);

    // ---- NECK / HEAD / JAW
    const tired = st.tired, lowHead = Math.max(tired * 0.5, lame * 0.4);
    neckP += S.neck0 + st.alert * S.alertNeck - S.walkNeck * wlk - S.trotNeck * trt - S.gallopNeck * gal - lowHead * 0.2
      + st.lookP * 0.5 - cR * 0.85 + S.lieNeck * wL;
    neckP += S.nod * (wlk + 0.5 * trt) * Math.sin(2 * ph + 0.8) + S.gallopNod * gal * Math.sin(ph + 1.2);
    if (fk > 0 && F.loc === 0) { neckY += 0.4 * F.side * fk; neckP += 0.2 * fk; }
    if (st.shake > 0) headR += 0.35 * Math.sin(st.shake * 30) * Math.sin(PI * st.shake / 0.9);
    neckY += st.lookY * (1 - aw * 0.8) * (1 - gz2 * 0.5) - chestYaw * 0.8 + st.turn * 0.05;
    b[BN.neck].rotation.set(0, neckY * 0.55, neckP * 0.55);
    b[BN.neck1].rotation.set(0, neckY * 0.45, neckP * 0.45);
    if (fk > 0 && F.loc === 0) headR += 0.25 * F.side * fk;
    b[BN.head].rotation.set(headR, st.lookY * 0.2 * (1 - aw), headP - neckP * 0.3 + st.lookP * 0.3);
    // the cud: a sideways grind; blown: mouth open
    const chewA = (st.chew > 0 ? 0.05 + 0.04 * Math.sin(st.chew) : 0) * (1 - aw);
    const pant = tired * (0.12 + 0.05 * Math.sin(st.t * 8));
    jawA += chewA + pant;
    b[BN.jaw].rotation.set(0, 0.04 * Math.sin(st.chew) * (1 - aw), -clamp(jawA, 0, 0.6));

    // ---- EARS: forward when alert, swivel, flick, pinned back in a fight
    earBack = clamp(earBack + st.fear * 0.5, 0, 1);
    for (let e = 0; e < 2; e++) {
      const bone = b[e === 0 ? BN.earL : BN.earR], sg = e === 0 ? -1 : 1, fl = st.earF[e];
      bone.rotation.set(sg * (0.15 * fl - 0.35 * earBack), sg * (0.45 * earBack - 0.25 * st.alert - 0.15 * st.lookY * sg + 0.3 * fl), -0.25 * earBack + 0.15 * st.alert);
    }

    // ---- TAIL: hangs; swishes at flies; lifts in alarm, in the run and before a charge
    st.sway += dt * TAU * (G.mix.f || 0.8) * 0.5;
    const sws = st.swish, swA = sws > 0 ? Math.sin(PI * (1 - sws)) * Math.sin((1 - sws) * 14) * st.swSide : 0;
    const hang = S.tailHang - S.tailRunLift * (gal + 0.5 * trt) - S.tailUpLift * tailUp + 0.1 * st.fear * 0;
    const sw2 = 0.12 * (wlk + trt) * Math.sin(st.sway);
    b[BN.tail0].rotation.set(0, sw2 + 0.5 * swA, hang);
    b[BN.tail1].rotation.set(0, sw2 * 0.6 + 0.6 * swA, S.tailCurl * tailUp);
    b[BN.tail2].rotation.set(0, sw2 * 0.4 + 0.7 * swA, S.tailCurl * 0.6 * tailUp);
  }

  // =========================================================================
  //  THE CORPSE: the skin follows the solver's discovered points
  // =========================================================================
  function corpseHook(rig, renderer) {
    const fr = renderer && renderer.info && renderer.info.render ? renderer.info.render.frame : -2;
    if (fr === rig.frame) return;
    rig.frame = fr;
    const u = rig.unit;
    let dead = u ? !!u.dead : false;
    if (!u) {
      const q = rig.group.quaternion;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      const m0 = rig.mk[0].foot.position;
      dead = upY < 0.8 || Math.abs(m0.x - rig.mk[0].fx) > 0.02 || Math.abs(m0.y - rig.mk[0].fy) > 0.02;
    }
    if (!dead) return;
    const t = now(), dt = rig.st.lastT ? clamp(t - rig.st.lastT, 0, 0.1) : 0.016;
    rig.st.lastT = t;
    corpsePose(rig, dt);
    rig.bones[0].updateMatrixWorld(true);
    if (rig.skeleton) rig.skeleton.update();
  }
  function corpsePose(rig, dt) {
    const D = rig.D, H = D.H, b = rig.bones, BN = rig.table.BN, st = rig.st;
    st.deadK = Math.min(1, st.deadK + dt * 2.2);
    const k = st.deadK;
    b[BN.pelvis].position.set(D.hipX, D.hipH, 0); b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.set(D.shX, D.sh, 0); b[BN.chest].rotation.set(0, 0, 0);
    let moved = false;
    for (let L = 0; L < 4; L++) {
      const mk = rig.mk[L], fp = mk.foot.position;
      if (Math.abs(fp.x - mk.fx) > 0.01 || Math.abs(fp.y - mk.fy) > 0.01 || Math.abs(fp.z - mk.fz) > 0.01) moved = true;
    }
    for (let L = 0; L < 4; L++) {
      const front = L < 2, mk = rig.mk[L], fp = mk.foot.position;
      const J = front ? D.FJ : D.HJ, hh = front ? D.fh : D.hh;
      // relaxed: the limp leg folds a little at every joint
      const rx = J.x + (front ? 0.1 : -0.06) * H, ry = hh + (J.y - hh) * 0.3;
      const fx = moved ? fp.x - D.pdx : lerp(mk.fx - D.pdx, rx, k), fy = moved ? fp.y + hh - mk.fy : lerp(hh, ry, k), fz = moved ? fp.z : mk.fz;
      const fa = front ? -HALF - 0.6 * k : -HALF - 0.2 * k;
      if (front) legIK(rig, L, D.shX, D.sh, 0, 0, fx, fy, fz, fa, -0.6 * k);
      else legIK(rig, L, D.hipX, D.hipH, 0, 0, fx, fy, fz, fa, -0.5 * k);
    }
    const h0 = rig.mkHead0, h1 = rig.mkHead.position, nb = D.neckB;
    let dp = 0, dy = 0;
    if (Math.abs(h1.x - h0.x) + Math.abs(h1.y - h0.y) + Math.abs(h1.z - h0.z) > 0.01) {
      dp = Math.atan2(h1.y - nb.y, h1.x - nb.x) - Math.atan2(h0.y - nb.y, h0.x - nb.x);
      dy = -Math.atan2(h1.z, h1.x - nb.x);
    } else dp = -0.35 * k;
    dp = clamp(dp, -1.2, 0.8); dy = clamp(dy, -1.0, 1.0);
    b[BN.neck].rotation.set(0, dy * 0.55, dp * 0.6);
    b[BN.neck1].rotation.set(0, dy * 0.45, dp * 0.4);
    b[BN.head].rotation.set(0, 0, -0.1 * k);
    b[BN.jaw].rotation.set(0, 0, -0.15 * k);
    b[BN.earL].rotation.set(0.3 * k, 0.3 * k, -0.3 * k); b[BN.earR].rotation.set(-0.3 * k, -0.3 * k, -0.3 * k);
    b[BN.tail0].rotation.set(0, 0.2 * k, rig.spec.look.tailHang); b[BN.tail1].rotation.set(0, 0.2 * k, 0); b[BN.tail2].rotation.set(0, 0.1 * k, 0);
  }

  // =========================================================================
  //  THE BRAIN: one per animal, on its own row (m._ung)
  // =========================================================================
  const LIVE = [];
  const HERD = {};          // per species|team: the herd's state, refreshed once a frame
  function herdOf(m, spec) {
    const k = spec.id + "|" + m.team;
    let hd = HERD[k];
    if (!hd) hd = HERD[k] = { all: 0, alive: 0, x: 0, z: 0, v: 0, charge: 0, flee: 0, t: -1, panic: 0, broke: false, recentHits: 0 };
    return hd;
  }
  function herdTick(hd, spec, team, t) {
    if (hd.t === t) return;
    hd.t = t;
    let all = 0, alive = 0, sx = 0, sz = 0, sv = 0, ch = 0, fl = 0;
    for (let i = 0; i < LIVE.length; i++) {
      const u = LIVE[i];
      if (u.team !== team || !u._ung || u._ung.spec !== spec) continue;
      all++;
      if (u.dead || u.fled) continue;
      alive++; sx += u.pos.x; sz += u.pos.z;
      const vv = Math.abs(u._ung.rig.st.v);
      sv += vv;
      if (u._ung.mode === "charge") ch++;
      if (u.state === "flee") fl++;
    }
    hd.all = all; hd.alive = alive;
    if (alive) { hd.x = sx / alive; hd.z = sz / alive; hd.v = sv / alive; }
    hd.charge = alive ? ch / alive : 0; hd.flee = alive ? fl / alive : 0;
  }
  function massOf(t) {
    if (t._mass > 0) return t._mass;
    if (t.vehicle) return t.mass || 8000;
    if (CBZ.bodyMass) { try { return CBZ.bodyMass(t); } catch (e) {} }
    return t.beast ? 150 : 78;
  }
  function famOf(t) {
    if (!t.species || !CBZ.unitMoves) return "bite";
    try { return CBZ.unitMoves.family(t.species); } catch (e) { return "bite"; }
  }
  /* WHAT IS IN FRONT OF IT: armour, a man, a predator, a rival of its own
     kind (horns and antlers: a shoving match), something much bigger,
     something small (a dog, a wolf), or another grazer */
  function kindOf(L, t) {
    if (t.vehicle) return "armour";
    if (!t.beast) return "man";
    const ms = massOf(t), me = L.mass;
    const fam = famOf(t);
    if (t._ung || /bison|moose|elk|caribou|deer|stag|bighorn|goat|sheep|cow|bull|buffalo/.test(String(t.species && t.species.id))) {
      if (ms > me * 2.5) return "big";
      return "rival";
    }
    if (ms > me * 1.6) return "big";
    if (ms < 70) return "small";
    if (fam === "pounce" || fam === "maul" || fam === "bite" || fam === "lunge") return "predator";
    return "rival";
  }
  function faceOf(t, out) {
    let h;
    if (t.vehicle) h = t.h != null ? t.h : (t.heading || 0);
    else if (t.beast) h = t.heading || 0;
    else { const y = t.yaw || 0; out.x = Math.sin(y); out.z = Math.cos(y); return out; }
    out.x = Math.cos(h); out.z = Math.sin(h); return out;
  }
  const _fo = { x: 0, z: 0 };

  function brainOf(m) {
    let L = m._ung;
    if (L) return L;
    const rig = m.group && m.group.userData && m.group.userData.ungRig;
    if (!rig) return null;
    const spec = rig.spec, R = spec.REAL[rig.sex];
    const k = m._sizeMul || 1;
    L = m._ung = {
      rig: rig, spec: spec, R: R, male: rig.male, sta: 1, lastHp: m.hp, hitT: 9, shotT: 9, dmgEma: 0,
      mass: R.mass * k * k * k, f: "close", fT: 0, cd: 0.3, hitDone: false, hits: 0, p0: 0, side: (m.i & 1) ? 1 : -1,
      act: { kind: null, p: 0, side: 1 }, fightAt: -9, kindTgt: null, kind: "man", mode: "march",
      inj: [0, 0, 0, 0], bayT: 0, threat: null, bellowCd: 4 + ((m.i * 7) % 13), tick: 0, mc: 0, pass: 0,
    };
    rig.unit = m;
    m.tn = Object.assign({}, m.tn);
    if (m.maxHp < 1e6) { m.maxHp = Math.round(m.maxHp * R.hpK); m.hp = Math.min(m.hp, m.maxHp); L.lastHp = m.hp; }
    m._mass = L.mass;
    m._jawL = { x: rig.D.mouth.x, y: rig.D.mouth.y, z: 0 };
    m._jawGripL = m._jawL;
    LIVE.push(m);
    // the team collar rides the neck (a box on a fixed spot does not follow a head)
    const THREE = W.THREE, g = m.group;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const ch = g.children[i];
      if (!ch.isMesh || ch === rig.mesh || !(ch.userData && ch.userData.teamCollar)) continue;
      const D = rig.D, NK = D.NECK, mid = NK[Math.floor(NK.length * 0.45)];
      const rad = Math.max(mid[2], mid[3], mid[4]) * 1.02;
      const key = "ucollar" + rad.toFixed(3);
      _mkGeo = _mkGeo || new Map();
      let tg = _mkGeo.get(key);
      if (!tg) { tg = new THREE.TorusGeometry(rad, 0.022 * D.H, 6, 28); tg._shared = true; _mkGeo.set(key, tg); }
      ch.geometry = tg;
      const nb = D.neckB, hp0 = D.headP, dir = new THREE.Vector3(hp0.x - nb.x, hp0.y - nb.y, 0).normalize();
      ch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ch.position.set(mid[0] - nb.x, mid[1] - nb.y, 0);
      ch.scale.set(1, 1, 1);
      rig.bones[rig.table.BN.neck].add(ch);
      break;
    }
    return L;
  }

  // the slow layer: speed, stamina, nerve, wounds, the herd — on the unit's own tuning
  function brain(m, L, dt) {
    const rig = L.rig, st = rig.st, tn = m.tn, R = L.R, spec = L.spec;
    const vM = Math.abs(st.v), tnow = now();
    const hd = herdOf(m, spec);
    herdTick(hd, spec, m.team, Math.round(tnow * 30));
    // STAMINA: R.sta = seconds of flat-out running in the tank
    if (vM > R.top * 0.55) L.sta -= dt * (vM / R.top) / R.sta;
    else L.sta += dt * (vM < 3 ? 0.03 : 0.012) * R.recover;
    L.sta = clamp(L.sta, 0, 1);
    // WOUNDS: read off the hp the funnel took
    const t = m.tgt;
    const close = t && !t.dead ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    if (m.hp < L.lastHp) {
      let drop = L.lastHp - m.hp;
      /* THE HIDE AND THE BULK. A light animal's teeth, or a man's fists, on
         something many times its weight reach only so far through the hide,
         the wool and the muscle (a wolf pack takes HOURS over a moose). The
         shared driver bills a bite at about what it does to a man; the soak
         is the mass ratio: a wolf on a moose loses ~55%, a lion on a bison
         ~25%, a bear on a moose nothing. Rounds are the ballistics' business
         and are never soaked (a hit with no attacker at teeth range). */
      const at = m.tgt && !m.tgt.dead ? m.tgt : null;
      if (at && !at.vehicle && m.hp > 0 && Math.hypot(at.pos.x - m.pos.x, at.pos.z - m.pos.z) < (m.reach || 3) + (at.reach || 2) + 0.5 &&
          (at.beast || at.fists || !at.armed)) {
        const soak = clamp(1 - 1.6 * Math.sqrt(massOf(at) / L.mass), 0, 0.85);
        if (soak > 0) { const back = drop * soak; m.hp = Math.min(m.maxHp, m.hp + back); drop -= back; }
      }
      L.hitT = 0; L.dmgEma += drop;
      const melee = t && close < (m.reach || 3) + 1.5;
      if (!melee) L.shotT = 0;
      let loc = Math.random(), side = Math.random() < 0.5 ? -1 : 1;
      loc = loc < 0.15 ? 0 : loc < 0.45 ? 1 : loc < 0.72 ? 3 : 2;
      if (t && close < 5) { const rel = wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0)); side = rel > 0 ? 1 : -1; if (Math.abs(rel) < 0.7) loc = Math.random() < 0.5 ? 0 : 1; else if (Math.abs(rel) > 2.3) loc = 2; }
      const kk = clamp(drop / (m.maxHp * 0.15), 0.25, 1);
      st.fl.t = 0.45; st.fl.k = kk; st.fl.loc = loc; st.fl.side = side;
      if (loc === 1 || loc === 2) {
        const leg = (loc === 1 ? 0 : 2) + (side < 0 ? 0 : 1);
        L.inj[leg] = Math.min(1, L.inj[leg] + drop / m.maxHp * 1.6);
      }
      hd.recentHits += 1;
      // caught: something is on it. A grazer turns at bay
      if (melee) { L.bayT = Math.max(L.bayT, 6 + Math.random() * 4); L.threat = t; }
      if ((L.f === "spar") && kk > 0.8) { L.f = "recover"; L.fT = 0; }
    }
    L.lastHp = m.hp;
    L.hitT += dt; L.shotT += dt;
    L.dmgEma *= Math.exp(-dt / 3);
    hd.recentHits *= Math.exp(-dt / 4);
    if (L.bayT > 0) L.bayT -= dt;
    // NERVE
    const hpF = m.maxHp > 0 ? m.hp / m.maxHp : 1;
    const quit = R.quit;
    const policy = spec.nerve(m, L, hd, { hpF: hpF, close: close, tgt: t });
    tn.brave = hpF >= quit && policy !== "flee";
    tn.prey = policy === "flee";
    L.mode = policy === "flee" ? "flee" : L.mode === "flee" ? "march" : L.mode;
    // SPEED: earned by distance, stamina, wounds, mass-limited acceleration
    const lame = Math.max(L.inj[0], L.inj[1], L.inj[2], L.inj[3]);
    const k = m._sizeMul || 1;
    const top = lerp(R.cruise, R.top, sstep(0.05, 0.35, L.sta)) * (1 - 0.55 * lame) * (hpF < 0.35 ? 0.8 : 1) * Math.pow(k, 0.15);
    const d = close;
    let want;
    if (m.state === "flee" || m.slot === "fallback") { want = top; L.mode = "flee"; }
    else if (t && t.vehicle) { want = Math.min(top, R.march); L.mode = "march"; }
    else if (d < R.chargeAt) { want = top; L.mode = "charge"; }
    else if (d < R.chargeAt * 2.5) { want = Math.min(top, R.march * 1.4); L.mode = "march"; }
    else { want = Math.min(top, R.march); L.mode = "march"; }
    // THE STAMPEDE: a herd that is running runs together
    if (spec.herd && hd.alive > 2 && Math.hypot(m.pos.x - hd.x, m.pos.z - hd.z) < 45 && (hd.charge > 0.3 || hd.flee > 0.3)) {
      want = Math.max(want, Math.min(top, hd.v * 1.05 + 1));
      if (hd.charge > 0.3 && L.mode === "march" && t) L.mode = "charge";
    }
    // the speed it is driving at: rises at its real acceleration, falls faster;
    // a body that was stopped by something (a collision, a fight) starts again from there
    if (L.vCmd == null) L.vCmd = Math.max(2.5, vM);
    if (vM < L.vCmd * 0.35 && L.vCmd > 5 && L.hitT > 0.5 && m.slot !== "fallback") L.vCmd = Math.max(2.5, vM + 1);
    if (want > L.vCmd) L.vCmd = Math.min(want, L.vCmd + R.accel * dt);
    else L.vCmd = Math.max(want, L.vCmd - R.accel * 1.6 * dt);
    tn.chase = Math.max(2.5, L.vCmd);
    tn.march = Math.min(R.march, top);
  }

  // =========================================================================
  //  ANIMATE (the battle's per-frame hook)
  // =========================================================================
  function animate(m, dt) {
    const L = brainOf(m);
    if (!L) return;
    if (!(dt > 0)) dt = 0.016;
    /* THE SIM CLOCK. The render pass calls this on wall time (and every
       2nd/4th frame far off); motion is measured and speed is earned on the
       battle's own clock (CBZ.now, ms), so the dial, slow motion and the LOD
       skip do not read as the animal stopping. A puppet with no clock (the
       shot service) falls back to the frame's dt. */
    const cn = typeof CBZ.now === "number" ? CBZ.now : null;
    let sdt = dt;
    if (cn != null && L.cn != null && cn > L.cn) sdt = Math.min(0.6, (cn - L.cn) / 1000);
    L.cn = cn;
    dt = sdt;
    brain(m, L, dt);
    const rig = L.rig, c = rig.ctl, tnow = now(), spec = L.spec;
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y;
    c.heading = typeof m.heading === "number" ? m.heading : 0;
    c.ground = CBZ.floorAt || null;
    const t = m.tgt, live = t && !t.dead;
    const d = live ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    const flee = m.state === "flee" || m.slot === "fallback";
    c.alert = live || flee || L.hitT < 5 ? 1 : 0.3;
    c.aggr = !flee && live && d < 20 ? 1 : (L.f === "threat" ? 1 : 0);
    c.fear = flee ? 1 : 0;
    c.tired = clamp(1 - L.sta * 1.4, 0, 1);
    c.rest = !live && !m.hunt && !flee && L.hitT > 20;
    c.graze = !live && !flee && L.hitT > 8;
    c.inj = L.inj;
    c.lookAt = live && d < 60 ? t.pos : null;
    c.tailUp = (L.mode === "charge" && !flee) ? 1 : flee ? spec.look.tailFlee : 0;
    const fresh = tnow - L.fightAt < 0.3;
    if (!fresh && L.f !== "close") { L.f = "close"; L.fT = 0; }
    c.act = fresh && L.act.kind ? L.act : null;
    // the charge posture outside the bubble: head down for the last strides
    if (!c.act && L.mode === "charge" && live && d < spec.look.chargeHeadAt && Math.abs(rig.st.v) > 4) {
      L.act.kind = "charge"; L.act.p = 0; c.act = L.act;
    }
    // the bellow / bugle: standing, an enemy in sight, nothing on top of it
    L.bellowCd -= dt;
    if (!c.act && L.male && L.bellowCd <= 0 && Math.abs(rig.st.v) < 1 && live && d > 15 && d < 150) {
      L.bellowT = 1.8; L.bellowCd = 18 + Math.random() * 20;
    }
    if (L.bellowT > 0) {
      L.bellowT -= dt;
      if (!c.act && Math.abs(rig.st.v) < 2.5) { L.act.kind = "bellow"; L.act.p = 1 - L.bellowT / 1.8; c.act = L.act; }
    }
    pose(rig, dt, c);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, c.heading);
  }

  // =========================================================================
  //  THE FIGHT (inside the strike bubble; step.js hands the body over)
  // =========================================================================
  const RES = { inRange: true, dealt: 0, missed: false };
  const JKG = 45;           // J per kg of target a blow must carry to take a whole life
  function go(L, f) { L.f = f; L.fT = 0; L.hitDone = false; L.hits = 0; }
  /* THE BLOW, as physics: a body part of effK x the animal's mass arrives at
     v m/s; what the target takes is the impact energy on the reduced mass
     over what its own mass can soak, times how sharp the weapon is. The
     funnel scales every animal strike by what the TARGET absorbs
     (meleeAbsorb); this number already is that, so it is handed over net. */
  function blow(L, m, tgt, effK, v, sharp, cap) {
    const mA = L.mass * effK, mT = massOf(tgt);
    const mu = mA * mT / (mA + mT);
    const E = 0.5 * mu * v * v;
    const frac = Math.min(cap || 1.3, E / (JKG * mT)) * sharp;
    const hp = tgt.maxHp > 0 && tgt.maxHp < 1e6 ? tgt.maxHp : (tgt.beast ? 200 : 120);
    return frac * hp;
  }
  function strike(m, tgt, o, amt) {
    if (!(amt > 0)) return 0;
    const ab = CBZ.meleeAbsorb ? Math.max(0.05, CBZ.meleeAbsorb(tgt)) : 1;
    if (o.onHit) o.onHit(amt / ab);
    RES.dealt += amt;
    return amt;
  }
  function slide(m, x, z, step, tgt, keep) {
    m.pos.x += x * step; m.pos.z += z * step;
    if (tgt && keep > 0) {
      const dx = m.pos.x - tgt.pos.x, dz = m.pos.z - tgt.pos.z, d = Math.hypot(dx, dz) || 1e-3;
      if (d < keep) { m.pos.x = tgt.pos.x + dx / d * keep; m.pos.z = tgt.pos.z + dz / d * keep; }
    }
    if (CBZ.micro && CBZ.micro.resolveCircle) CBZ.micro.resolveCircle(m.pos, m.rad || 1, m.pos.y, 1.8);
    if (CBZ.floorAt) { const y = CBZ.floorAt(m.pos.x, m.pos.z); if (isFinite(y)) m.pos.y = y; }
  }
  /* WHAT THE BLOW DOES TO THE BODY IT LANDS ON: a man (or anything light)
     thrown, a man knocked flat, a beast shoved back by its share of the
     momentum. */
  function toss(m, tgt, ux, uz, vUp, vOut, landDmg) {
    if (tgt.dead || tgt.vehicle || tgt._tossed || tgt._apeHeld) return false;
    const side = Math.random() < 0.5 ? -1 : 1;
    tgt._tossed = {
      by: m, age: 0, lift: 0, dmg: landDmg, down: 0,
      x0: tgt.pos.x, y0: tgt.pos.y, z0: tgt.pos.z,
      vx: ux * vOut - uz * side * 1.2, vz: uz * vOut + ux * side * 1.2, vy: vUp,
      rx: tgt.group ? tgt.group.rotation.x : 0,
    };
    if (tgt.beast && tgt._atkAnim >= 0 && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(tgt); } catch (e) {} }
    if (CBZ.shake) { try { CBZ.shake(0.25); } catch (e) {} }
    return true;
  }
  function knock(m, tgt, ux, uz, power, dur) {
    if (tgt.dead || tgt.vehicle) return;
    if (!tgt.beast) {
      if (CBZ.verbs && CBZ.verbs.knockdown) { try { CBZ.verbs.knockdown(tgt, { dir: { x: ux, z: uz }, power: power, dur: dur }); } catch (e) {} }
      tgt.ko = Math.max(tgt.ko || 0, dur);
    }
  }
  function shove(L, m, tgt, ux, uz, v) {
    if (tgt.vehicle || tgt.dead) return;
    const mT = massOf(tgt), share = L.mass / (L.mass + mT);
    const dist = clamp(v * share * 0.35, 0, 2.5);
    if (dist < 0.05) return;
    tgt.pos.x += ux * dist; tgt.pos.z += uz * dist;
    if (CBZ.micro && CBZ.micro.resolveCircle) CBZ.micro.resolveCircle(tgt.pos, tgt.rad || 0.5, tgt.pos.y, 1.8);
    if (tgt.beast && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(tgt); } catch (e) {} }
  }
  function blood(m, tgt, style) {
    if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, tgt, style); } catch (e) {} }
  }

  function fight(m, tgt, dt, o) {
    RES.inRange = true; RES.dealt = 0; RES.missed = false;
    const L = brainOf(m);
    if (!L) return CBZ.creatureFight ? CBZ.creatureFight(m, tgt, dt, o) : RES;
    if (!tgt || tgt.dead) { go(L, "close"); return RES; }
    L.fightAt = now();
    const spec = L.spec, R = L.R, st = L.rig.st;
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-3, ux = dx / d, uz = dz / d;
    const keep = Math.max((m.rad || 1) + (tgt.rad || 0.45), (m.noseR || 1.5) * 0.86);
    if (L.kindTgt !== tgt) { L.kindTgt = tgt; L.kind = kindOf(L, tgt); }
    const kind = L.kind;
    const rate = Math.max(0.3, o.rate || 1);
    const move = function (step) { if (o.move) o.move(m, ux, uz, step); else slide(m, ux, uz, step, tgt, keep); };
    L.fT += dt; L.cd -= dt;
    const h0 = m.heading || 0;
    const rel = wrapPi(Math.atan2(dz, dx) - h0);
    const behind = Math.abs(rel) > 2.2;
    const downed = !!(tgt.ko > 0 || tgt._tossed || (tgt.beast && tgt.hp < tgt.maxHp * 0.15));
    // A PLAYER IS DRIVING (src/battle/player.js): play exactly the latched move
    const Y = o.youMove || null;
    if (Y) {
      if (L.yMove !== Y || (m._atkAnim === 0 && L.yAge > 0.05)) {
        L.yMove = Y; L.yAge = 0;
        go(L, spec.moveAct[Y.id] || (Y.style === "ram" ? "charge" : Y.style === "stomp" ? "stomp" : "hook"));
        L.p0 = d;
      }
      L.yAge += dt;
    } else L.yMove = null;
    let want = Math.atan2(dz, dx), turnRate = R.turn;
    const act = L.act;
    act.side = L.side;
    switch (L.f) {
      case "close": {
        act.kind = null;
        if (kind === "armour") { go(L, "threat"); break; }
        // turn to face it (a kick wants it behind)
        const pick = spec.pick(L, m, tgt, { kind: kind, d: d, keep: keep, behind: behind, downed: downed, rel: rel });
        if (pick === "kick" && behind && L.cd <= 0 && d < keep + 1.2) { go(L, "kick"); break; }
        if (pick === "charge" && L.cd <= 0 && d > keep + 1.2) { L.p0 = d; go(L, "charge"); break; }
        if (d > keep + 0.35) { move(Math.max(st.v, (o.speed || 6) * 0.6) * dt); break; }
        if (Math.abs(rel) > 0.5 && pick !== "kick") break;      // still coming round
        if (L.cd > 0) break;
        if (pick && pick !== "charge") go(L, pick === "kick" ? "hook" : pick);
        else go(L, R.weapon === "horns" ? "hook" : "strike");
        break;
      }
      case "charge": {
        // full tilt at it, head down: the hit comes at contact, then run through
        act.kind = "charge"; act.p = Math.min(1, L.fT / 1.2);
        const v = Math.max(Math.abs(st.v), (o.speed || 8));
        if (!L.hitDone) {
          if (d > keep + 0.3) slide(m, ux, uz, v * dt, tgt, keep);
          if (d <= keep + 0.45) {
            L.hitDone = true;
            const vHit = clamp(Math.abs(st.v), 3, R.top);
            const dmg = blow(L, m, tgt, 1.0, vHit, spec.ramSharp, 1.3);
            strike(m, tgt, o, dmg);
            const light = massOf(tgt) < L.mass * 0.2 && massOf(tgt) < 160;
            if (light && !tgt.dead) toss(m, tgt, ux, uz, 2.5 + vHit * 0.45, 2 + vHit * 0.35, blow(L, m, tgt, 0.06, vHit, 1, 1));
            else if (!tgt.dead) { shove(L, m, tgt, ux, uz, vHit); knock(m, tgt, ux, uz, 1.4, 2.4); }
            blood(m, tgt, "gore");
            L.pass = light ? (spec.passThrough || 2.5) : 0;
          } else if (L.fT > 1.2) { RES.missed = true; go(L, "recover"); }
        } else {
          // carried through: the light thing went over the horns; the heavy one stopped us
          if (L.pass > 0) { const s = Math.min(L.pass, v * 0.7 * dt); L.pass -= s; slide(m, Math.cos(h0), Math.sin(h0), s, null, 0); want = h0; }
          if (L.fT > 0.35 + (L.pass > 0 ? 0.6 : 0) || L.pass <= 0) { go(L, "recover"); L.cd = 0.4 / rate; }
        }
        turnRate = R.turn * 0.4;
        break;
      }
      case "hook":
      case "butt":
      case "antler": {
        const T = (L.f === "butt" ? 0.6 : 0.8) / rate, p = L.fT / T;
        act.kind = L.f; act.p = Math.min(1, p);
        if (p > 0.25 && p < 0.5) move(0.5 * dt / T);
        if (p >= 0.55 && !L.hitDone) {
          L.hitDone = true;
          if (d < keep + 0.6) {
            const wpn = L.f === "butt" ? spec.blows.butt : L.f === "antler" ? spec.blows.antler : spec.blows.hook;
            const dmg = blow(L, m, tgt, wpn[0], wpn[1], wpn[2], 1.0);
            strike(m, tgt, o, dmg);
            const light = massOf(tgt) < L.mass * 0.18 && massOf(tgt) < 140;
            if (L.f === "hook" && light && !tgt.dead && Math.random() < spec.hookToss) toss(m, tgt, ux, uz, 4.5, 1.6, blow(L, m, tgt, 0.05, 6, 1, 1));
            else if (!tgt.dead) { knock(m, tgt, ux, uz, L.f === "butt" ? 1.0 : 1.2, 1.6); shove(L, m, tgt, ux, uz, wpn[1] * 0.5); }
            if (wpn[2] > 1.2) blood(m, tgt, "gore");
          } else RES.missed = true;
        }
        if (p >= 1) { L.side = -L.side; go(L, "recover"); L.cd = 0.15 / rate; }
        break;
      }
      case "strike": {
        const T = 1.1 / rate, p = L.fT / T;
        act.kind = "strike"; act.p = Math.min(1, p);
        if (p > 0.3 && p < 0.55) move(0.6 * dt / T);
        if ((p >= 0.52 && L.hits === 0) || (p >= 0.84 && L.hits === 1)) {
          L.hits++;
          if (d < keep + 0.8) {
            const wpn = spec.blows.strike;
            strike(m, tgt, o, blow(L, m, tgt, wpn[0], wpn[1], wpn[2], 1.0));
            if (L.hits === 1) knock(m, tgt, ux, uz, 1.3, 2.2);
            if (L.hits === 2) blood(m, tgt, "stomp");
          } else if (L.hits === 1) RES.missed = true;
        }
        if (p >= 1) go(L, tgt.ko > 0 && kind === "man" ? "stomp" : "recover");
        break;
      }
      case "stomp": {
        const T = 1.0 / rate, p = L.fT / T;
        act.kind = "stomp"; act.p = Math.min(1, p);
        if (d > keep * 0.8) move(Math.min(d - keep * 0.8, 3 * dt));
        const due = Math.floor(p * 3 + 0.35);
        if (due > L.hits && L.hits < 3) {
          L.hits++;
          if (d < keep + 0.6) {
            const wpn = spec.blows.stomp;
            strike(m, tgt, o, blow(L, m, tgt, wpn[0], wpn[1], wpn[2], 1.0));
            if (!tgt.beast) tgt.ko = Math.max(tgt.ko || 0, 0.8);
            if (L.hits === 3) blood(m, tgt, "stomp");
          }
        }
        if (p >= 1) go(L, "recover");
        break;
      }
      case "kick": {
        // the rump to it, both hind feet
        const T = 0.75 / rate, p = L.fT / T;
        act.kind = "kick"; act.p = Math.min(1, p);
        want = Math.atan2(-dz, -dx); turnRate = R.turn * 0.6;
        if (p >= 0.45 && !L.hitDone) {
          L.hitDone = true;
          const back = Math.abs(wrapPi(Math.atan2(dz, dx) - h0)) > 2.0;
          if (back && d < keep + 1.0) {
            const wpn = spec.blows.kick;
            strike(m, tgt, o, blow(L, m, tgt, wpn[0], wpn[1], wpn[2], 1.0));
            knock(m, tgt, ux, uz, 1.5, 2.0); shove(L, m, tgt, ux, uz, wpn[1] * 0.6);
          } else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.2 / rate; }
        break;
      }
      case "spar": {
        // locked with a rival: shove in surges, twist at the end
        act.kind = "spar"; act.p = 0;
        if (d > keep + 0.1) move(Math.min(d - keep, 2 * dt));
        L.tick += dt;
        if (L.tick >= 0.45) {
          L.tick -= 0.45;
          const wpn = spec.blows.spar;
          if (d < keep + 0.7) {
            strike(m, tgt, o, blow(L, m, tgt, wpn[0], wpn[1], wpn[2], 1.0));
            // the heavier animal drives the lighter one back
            shove(L, m, tgt, ux, uz, 1.5 * (L.mass / (L.mass + massOf(tgt))) * 2);
          } else { go(L, "close"); break; }
        }
        if (L.fT > 2.4) go(L, R.weapon === "antlers" ? "antler" : "hook");
        break;
      }
      case "threat": {
        // armour: the display, mock charges, never commit
        act.kind = "threat"; act.p = 0;
        const hold = keep + 4;
        L.mc += dt;
        if (spec.mockCharge && L.mc > 3.5) {
          const e = L.mc - 3.5;
          if (e < 0.6) slide(m, ux, uz, 7 * dt, tgt, keep + 1.5);
          else if (e < 1.4) slide(m, -ux, -uz, 3 * dt, tgt, keep);
          else L.mc = 0;
        } else if (d < hold) slide(m, -ux, -uz, 2.5 * dt, tgt, keep);
        if (kind !== "armour") go(L, "close");
        break;
      }
      case "recover": {
        act.kind = null;
        const T = 0.45 / rate;
        if (L.fT < T * 0.6 && d < keep + 0.4) slide(m, -ux, -uz, 1.0 * dt, tgt, keep);
        if (L.fT >= T) { go(L, "close"); L.cd = Math.max(L.cd, 0.25 / rate); }
        break;
      }
      default: go(L, "close");
    }
    if (Y) {
      const busy = L.f !== "close" && L.f !== "recover" && L.f !== "threat";
      if (!busy || L.yAge > 2.5) { m._atkAnim = -1; L.yMove = null; if (L.f !== "close") go(L, "close"); L.cd = 0; }
      else m._atkAnim = Math.min(0.99, 0.01 + L.yAge / 1.5);
    }
    // face the work (a heavy animal turns slower than a cat; the bison spins on its forefeet)
    const dh = wrapPi(want - h0);
    m.heading = h0 + clamp(dh, -turnRate * dt, turnRate * dt);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
    RES.inRange = d < keep + 1;
    return RES;
  }

  // WHAT A POSSESSED UNGULATE THROWS ON ATTACK (src/units/kit/moves.js contract)
  function moves(m, tgt, ctx) {
    const L = brainOf(m);
    if (!L) return null;
    ctx = ctx || {};
    const spec = L.spec, YM = spec.YM;
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 3, n = ctx.n || 1;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.45);
    if (!tgt) return YM[spec.ymDefault];
    if (dist > reach * 1.05 && dist < reach * 3.2 && running) return YM[spec.ymCharge];
    if (ctx.downed) return YM[spec.ymStomp];
    const rel = wrapPi(Math.atan2(tgt.pos.z - m.pos.z, tgt.pos.x - m.pos.x) - (m.heading || 0));
    if (Math.abs(rel) > 2.2 && YM[spec.ymKick]) return YM[spec.ymKick];
    const rot = spec.ymRotation(L, n);
    return YM[rot] || YM[spec.ymDefault];
  }

  // a posed frame for tools (shot service): CBZ.ungulateKit.preview(unit, "hook", 0.5)
  const _pv = { kind: null, p: 0, side: 1 };
  function preview(m, kind, p, dt) {
    const L = brainOf(m);
    if (!L) return false;
    const rig = L.rig, c = rig.ctl;
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y; c.heading = m.heading || 0; c.ground = CBZ.floorAt || null;
    c.alert = 1; c.aggr = kind ? 0.6 : 0; c.act = null; c.graze = 0; c.rest = 0;
    if (kind === "graze") { c.graze = 1; c.alert = 0; rig.st.grazing = true; rig.st.grazeT = 99; kind = null; }
    if (kind === "lie") { c.rest = 1; c.alert = 0; rig.st.idleT = 99; kind = null; }
    if (kind) { _pv.kind = kind; _pv.p = p; c.act = _pv; }
    for (let i = 0; i < 40; i++) pose(rig, dt || 1 / 30, c);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, c.heading);
    return true;
  }

  /* THE GRAZER'S NERVE (elk, caribou): flee, as a herd, unless caught
     (something is on it: it turns at bay), or run to a standstill with the
     pursuer at its heels (blown: it turns and faces it). */
  function grazerNerve(m, L, hd, o) {
    if (o.hpF < L.R.quit) return "flee";
    const th = L.threat;
    if (L.bayT > 0 && th && !th.dead && !th.fled && Math.hypot(th.pos.x - m.pos.x, th.pos.z - m.pos.z) < 8) {
      if (!m.tgt || m.tgt.dead) m.tgt = th;
      return "fight";
    }
    if (L.sta < 0.12 && o.tgt && !o.tgt.vehicle && o.close < 6) return "fight";
    return "flee";
  }

  /* REGISTER A SPECIES on the engine. The species file passes its spec; this
     returns the unitKit def (stats + hooks). */
  function def(spec) {
    return {
      kind: "species", stats: spec.STATS,
      build: function (ctx) { return build(spec, ctx); },
      animate: animate, fight: fight, moves: moves,
    };
  }

  CBZ.ungulateKit = {
    def: def, build: build, animate: animate, fight: fight, moves: moves, preview: preview, pose: pose,
    grazerNerve: grazerNerve, dims: dimsOf, LIVE: LIVE, HERD: HERD, blow: blow, env: env,
    util: { clamp: clamp, lerp: lerp, sstep: sstep, cmix: cmix, cmul: cmul, nz: nz, lin: lin, v3n: v3n, curve: curve, mkRng: mkRng },
  };

  // =========================================================================
  //  THE BISON
  // =========================================================================
  const STATS = {
    hp: 520, spd: 1.6, danger: 0.6, bite: 70, scale: 1,
    chase: 15, march: 4, dmg: 70, rate: 1.0,
    brave: true, prey: false,
    // the round's numbers (weapons/ballistics.js): a bull, the thick skull of the brow
    mass: 900, hide: 12, skull: 90, ribs: 26, plan: "quad",
  };
  const REAL = {
    male: { mass: 900, top: 15.6, cruise: 7, march: 4, accel: 4.2, sta: 70, recover: 1, hpK: 1, quit: 0.12, chargeAt: 45, turn: 4.2, weapon: "horns" },
    female: { mass: 480, top: 16.2, cruise: 7.5, march: 4, accel: 4.8, sta: 80, recover: 1.1, hpK: 0.66, quit: 0.25, chargeAt: 40, turn: 4.8, weapon: "horns" },
  };
  const COATS = [
    // cape (long wool), cape tips (sun-bleached), body behind, belly, lower legs
    { cape: 0x3a2a1d, tip: 0x5c4431, body: 0x6e5034, back: 0x7a5a3a, belly: 0x3b2b1f, leg: 0x2b1f16, face: 0x2a1e15, mop: 0x34261a },  // plains, summer
    { cape: 0x33251a, tip: 0x4d3a2a, body: 0x5c4430, back: 0x684d35, belly: 0x33261b, leg: 0x251b13, face: 0x241a12, mop: 0x2e2117 },  // dark
    { cape: 0x463121, tip: 0x6e5038, body: 0x80603e, back: 0x8c6a46, belly: 0x463424, leg: 0x2f2218, face: 0x30231a, mop: 0x3e2c1e },  // rufous, bleached
  ];
  const FEAT = { nose: 0x16130f, nostril: 0x050404, lip: 0x1f1a16, eye: 0x1a120c, lid: 0x20170f, horn: 0x1a1714, hornBase: 0x4a4540, hoof: 0x1c1916, earIn: 0x5a4636, tongue: 0x5a3434 };

  function bisonDims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.84, Gt = male ? 1 : 0.86, Hs = male ? 1.14 : 0.95, hump = male ? 1 : 0.72;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.85 * H;
    D.hipX = -0.85 * H; D.hipH = 1.18 * H; D.shX = 0.6 * H; D.sh = 1.2 * H;
    D.HJ = { x: -0.85 * H, y: 1.08 * H }; D.FJ = { x: 0.62 * H, y: 1.0 * H };
    D.fa = 0.32 * H; D.fb = 0.34 * H; D.fc = 0.22 * H; D.fh = 0.13 * H;
    D.ha = 0.38 * H; D.hb = 0.38 * H; D.hc = 0.29 * H; D.hh = 0.13 * H;
    D.pdx = 0.05 * H; D.hoofK = 1.05; D.lk = 1.38 * g; D.lkh = 1.3 * g;
    D.legZf = 0.2 * H * Math.sqrt(Gt); D.legZh = 0.2 * H * Math.sqrt(Gt);
    // the barrel: rump -> loin -> flank -> ribs -> the HUMP over the shoulders -> point of shoulder
    // [x, yc, rt, rb, w, hk(hump bone), sq]
    const rows = [
      [-1.32, 1.24, 0.13, 0.16, 0.16, 0, 0.9],
      [-1.22, 1.22, 0.23, 0.29, 0.30, 0, 0.92],
      [-1.02, 1.19, 0.28, 0.37, 0.38, 0, 0.92],
      [-0.76, 1.16, 0.30, 0.40, 0.39, 0, 0.92],
      [-0.46, 1.13, 0.35, 0.41, 0.41, 0, 0.92],
      [-0.16, 1.13, 0.42 + 0.02 * hump, 0.43, 0.43, 0.1, 0.92],
      [0.10, 1.14, 0.50 + 0.04 * hump, 0.48, 0.43, 0.45, 0.9],
      [0.30, 1.16, 0.56 + 0.08 * hump, 0.55, 0.41, 0.85, 0.88],
      [0.46, 1.18, 0.58 + 0.10 * hump, 0.56, 0.38, 1, 0.86],
      [0.62, 1.20, 0.50 + 0.10 * hump, 0.54, 0.34, 1, 0.88],
      [0.78, 1.22, 0.38 + 0.06 * hump, 0.46, 0.30, 0.7, 0.9],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g * 1.0, r[5], r[6]]; });
    // a short, enormously deep neck running forward and DOWN to a low-carried head
    D.NECK = [
      [0.70, 1.30, 0.40, 0.48, 0.30, 0.95, 0.6],
      [0.88, 1.22, 0.33, 0.42, 0.27, 0.95, 0.5],
      [1.02, 1.16, 0.27, 0.33, 0.23, 0.95, 0.2],
      [1.12, 1.12, 0.21, 0.23, 0.2, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6] * hump]; });
    D.headP = { x: 1.12 * H, y: 1.12 * H };
    D.headAng = -0.82;
    // [d, h, rt (brow side), rb (throat side), w, sq]
    D.HEAD = [
      [-0.08, 0.0, 0.17, 0.19, 0.17, 1],
      [0.02, 0.01, 0.19, 0.19, 0.20, 0.95],
      [0.13, 0.01, 0.17, 0.17, 0.20, 0.9],
      [0.24, 0.0, 0.135, 0.15, 0.175, 0.85],
      [0.36, -0.01, 0.105, 0.125, 0.14, 0.8],
      [0.47, -0.01, 0.09, 0.105, 0.125, 0.75],
      [0.55, -0.01, 0.082, 0.09, 0.12, 0.7],
      [0.595, -0.012, 0.06, 0.062, 0.10, 0.75],
    ];
    D.nostril = [0.59, -0.01, 0.055, 0.016, 0.02];
    D.jaw = [0.24, -0.11, 0.57, -0.075];
    D.jawR = [[0.03, 0.028, 0.024, 0.018], [0.05, 0.045, 0.036, 0.028], [0.11, 0.09, 0.075, 0.06]];
    D.eye = { d: 0.25, h: 0.035, z: 0.155, r: 0.022 };
    D.ear = { d: 0.1, h: -0.03, z: 0.17, len: 0.13, w: 0.05, dir: [-0.3, 0.05, 1] };
    D.tailP = { x: -1.3 * H, y: 1.36 * H }; D.tailL = 0.5 * H; D.tailR = 0.045 * g;
    D.tailProf = [1, 0.8, 0.62, 0.55, 0.55, 0.85, 1.3, 1.1];
    D.humpP = { x: 0.4 * H, y: 1.5 * H };
    D.hackleP = { x: 0.95 * H, y: 1.3 * H };
    D.lieC = 0.62; D.lieP = 0.58;
    D.bsR = 2.6 * H;
    return D;
  }

  function bisonColour(D, V) {
    const P = COATS[V.tint], F = FEAT, H = D.H;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y, Hs = D.Hs;
    // the cape line: long dark wool in front of it, short bleached hair behind
    function capeK(x, y) { return sstep(-0.32 * H, -0.05 * H, x + (y - 1.2 * H) * 0.35); }
    function grain(c, x, y, z, amt) { return cmul(c, 1 + nz(x / H, y / H, z / H) * amt); }
    return function (part, x, y, z, ca, sa, t) {
      switch (part) {
        case "torso": {
          const ck = capeK(x, y);
          let c = cmix(P.body, P.back, sstep(0.3, 0.95, ca) * 0.6);
          if (ca < -0.25) c = cmix(c, P.belly, sstep(-0.25, -0.75, ca));
          const cape = cmix(P.cape, P.tip, sstep(0.2, 0.9, ca) * 0.7 * (0.6 + 0.4 * nz(x * 2, y * 2, z * 2)));
          c = cmix(c, cape, ck);
          return grain(c, x, y, z, ck > 0.5 ? 0.12 : 0.05);
        }
        case "neck": return grain(cmix(P.cape, P.tip, sstep(0.3, 0.95, ca) * 0.6), x, y, z, 0.12);
        case "head": {
          const dx = x - hpX, dy = y - hpY;
          const d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.5 && h > -0.05) return d > 0.57 ? F.nose : cmix(P.face, F.nose, (d - 0.5) / 0.07);
          if (d > 0.46) return F.lip;
          if (d < 0.2) return grain(cmix(P.mop, P.tip, sstep(0.3, 0.9, ca) * 0.35), x, y, z, 0.14);
          return grain(P.face, x, y, z, 0.08);
        }
        case "mop": return grain(cmix(P.mop, P.tip, 0.25 + 0.3 * sstep(0, 1, ca)), x, y, z, 0.16);
        case "beard": return grain(cmix(P.mop, 0x1e1610, 0.4), x, y, z, 0.15);
        case "jaw": return ca > 0.45 ? F.tongue : (t > 0.75 ? F.lip : cmix(P.face, P.mop, 0.4));
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return cmix(P.mop, P.face, 0.3);
        case "earIn": return F.earIn;
        case "tail": return t > 0.7 ? grain(0x1c140e, x, y, z, 0.15) : grain(cmix(P.body, P.belly, 0.4), x, y, z, 0.06);
        case "upper": case "fore": return grain(cmix(P.cape, P.leg, part === "fore" ? 0.35 : 0), x, y, z, 0.12);
        case "thigh": return grain(cmix(P.body, P.belly, sstep(0.2, -0.6, ca) * 0.5), x, y, z, 0.05);
        case "gaskin": return grain(cmix(P.body, P.leg, 0.45), x, y, z, 0.05);
        case "cannon": case "pastern": return grain(P.leg, x, y, z, 0.05);
        case "hoof": return F.hoof;
        case "horn": return cmix(F.hornBase, F.horn, sstep(0.0, 0.55, t));
      }
      return P.body;
    };
  }

  const BISON_SPEC = {
    id: "bison", salt: 0xb150, STATS: STATS, REAL: REAL, herd: true,
    // a war herd: bulls and cows (a mixed herd runs roughly 1 bull to 2 cows)
    sexOf: function (idx) { return idx % 3 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length), horn = Math.floor(r() * 3); return { tint: tint, horn: horn, key: tint + "|" + horn }; },
    dims: bisonDims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.68, lift: 0.045 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.46, lift: 0.06 },
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.30, lift: 0.08 },     // transverse
        ],
        trans: [[1.7 / k, 2.4 / k], [4.4 / k, 5.6 / k]],
        fMax: 2.4 * k, f0: 0.95 * k, fV: 0.42 * k, strideMax: 1.5,
        vMove: 0.12, turnMove: 0.35, turnF: 1.4,
        settleRate: 2.0, restLift: 0.03, restStep: 0.06,
      });
    },
    colour: bisonColour,
    look: {
      neck0: 0, alertNeck: 0.12, walkNeck: 0.06, trotNeck: 0.04, gallopNeck: 0.08, lieNeck: 0.05, nod: 0.03, gallopNod: 0.08,
      trotBounce: 0.012, gallopRock: 0.09, carpusFold: 1.7,
      chargeNeck: 0.35, chargeHead: 0.4, chargeHeadAt: 22, hackleAggr: 0.3, aggrEars: 0.5,
      threatNeck: -0.25, threatHead: -0.15, threatSwing: 0.3, threatEars: 0.6, threatPaw: true, tailThreat: 0.8,
      bellowNeck: 0.15, bellowHead: 0.35, grazeNeck: -0.55, grazeHead: -0.2,
      rearRise: 0.45, rearPitch: 0.55,
      tailHang: 1.45, tailRunLift: 0.25, tailUpLift: 1.5, tailCurl: 0.5, tailCharge: 1, tailFlee: 0.6,
    },
    // the long wool: cape over the hump and shoulders, mop on the brow, chaps on the forelegs
    torsoHair: function (X) {
      const H = X.D.H;
      return X.hairFn(0.11, 1.3 + X.V.tint, function (t, ca, sa, x, y) {
        return sstep(-0.3 * H, 0.05 * H, x + (y - 1.2 * H) * 0.35) * (ca > -0.5 ? 1 : 0.4);
      });
    },
    neckHair: function (X) { return X.hairFn(0.12, 2.1, null); },
    headHair: function (X) {
      const D = X.D;
      return X.hairFn(0.1, 0.7, function (t) { return 1 - sstep(0.25, 0.5, t); });
    },
    legHair: function (X, front) {
      if (!front) return null;
      return function (seg) { return X.hairFn(seg === 0 ? 0.16 : 0.22, 3.3 + seg, function (t) { return seg === 0 ? 1 : 1 - sstep(0.45, 0.9, t); }); };
    },
    tailHair: function (X) { return X.hairFn(0.35, 0.4, function (t) { return sstep(0.6, 0.8, t); }); },
    extras: function (X) {
      const D = X.D, BN = X.BN, Hs = D.Hs, male = D.male;
      // the MOP: a woolly cap over the brow and poll, between the horns
      const mop = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4, p = D.hp(lerp(-0.1, 0.24, t), lerp(0.08, 0.06, t));
        mop.push({ x: p.x, y: p.y, rt: lerp(0.12, 0.07, t) * Hs * (male ? 1 : 0.8), rb: 0.1 * Hs, w: lerp(0.2, 0.15, t) * Hs * (male ? 1.05 : 0.9), wts: [BN.head, 1] });
      }
      const v0 = X.G.n;
      X.loft(mop, 18, "mop", { capLen: 0.6 });
      X.displace(v0, 18, X.hairFn(0.16, 1.9, function (t, ca) { return ca > -0.2 ? 1 : 0.3; }));
      // the BEARD: hangs from the chin and throat
      const bp = [], br = [];
      const b0 = D.hp(0.3, -0.13), b1 = D.hp(0.46, -0.1);
      const bl = (male ? 0.26 : 0.12) * Hs;
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        bp.push([lerp(b0.x, b1.x, 0.5) - 0.03 * t, lerp(b0.y, b1.y, 0.5) - bl * t, 0]);
        br.push([(0.09 - 0.05 * t) * Hs, (0.07 - 0.04 * t) * Hs]);
      }
      const vb = X.G.n;
      X.sweep(bp, br, 12, "beard", [1, 0, 0], [BN.head, 0.6, BN.jaw, 0.4]);
      X.displace(vb, 12, X.hairFn(0.25, 0.9, null));
      // the HORNS: out sideways from the skull, then up and in; black tips
      const hs = male ? 1 : 0.72, thick = male ? 1 : 0.62, curl = [0, 0.04, -0.03][X.V.horn];
      for (let s = -1; s <= 1; s += 2) {
        const B = D.hp(0.07, 0.07);
        const z0 = s * 0.15 * Hs;
        const cp = [
          [B.x, B.y, z0],
          [B.x - 0.01, B.y + 0.01 * hs, z0 + s * 0.11 * hs],
          [B.x - 0.04 * hs, B.y + 0.09 * hs, z0 + s * (0.17 + curl) * hs],
          [B.x - 0.08 * hs, B.y + 0.2 * hs, z0 + s * (0.15 + curl) * hs],
          [B.x - 0.09 * hs, B.y + 0.27 * hs, z0 + s * (0.09 + curl * 0.5) * hs],
        ];
        const pts = curve(cp, 10), rad = [];
        for (let i = 0; i < pts.length; i++) { const t = i / (pts.length - 1), r = (0.05 - 0.046 * Math.pow(t, 1.15)) * thick * Hs; rad.push([r, r * 0.92]); }
        X.sweep(pts, rad, 10, "horn", [0, 1, 0]);
      }
    },
    nerve: function (m, L, hd, o) {
      // a beaten bison quits; a herd that has lost most of itself stampedes AWAY
      if (hd.all >= 4 && hd.alive / hd.all < 0.3) hd.broke = true;
      if (hd.broke) return "flee";
      if (o.tgt && o.tgt.vehicle && L.hitT < 3 && L.dmgEma > m.maxHp * 0.15) return "flee";
      return "fight";
    },
    blows: {
      // [mass fraction behind the weapon, speed m/s, sharpness]
      hook: [0.15, 5.5, 2.0],     // the horn sweep: head and neck, the point goes in
      butt: [0.22, 4.0, 1.0],     // the boss of the brow: blunt
      antler: [0.15, 5.5, 2.0],
      strike: [0.25, 4.5, 1.4],
      stomp: [0.35, 3.5, 1.3],
      kick: [0.2, 6.0, 1.3],
      spar: [0.3, 2.0, 0.8],
    },
    ramSharp: 1.5, hookToss: 0.7, mockCharge: true,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1 && Math.random() < 0.25) return "kick";
      if (c.kind === "rival") return Math.random() < 0.4 ? "spar" : "hook";
      if ((c.kind === "man" || c.kind === "small" || c.kind === "predator") && c.d > c.keep + 1.4) return "charge";
      return Math.random() < 0.65 ? "hook" : "butt";
    },
    moveAct: { bison_charge: "charge", bison_hook: "hook", bison_butt: "butt", bison_trample: "stomp", bison_kick: "kick" },
    YM: {
      bison_charge: { id: "bison_charge", style: "ram", pow: 1, dur: 1.2, rng: 1.2, leap: 1.4, cd: 1.0 },
      bison_hook: { id: "bison_hook", style: "gore", pow: 1, dur: 0.8, rng: 1.05, cd: 0.4 },
      bison_butt: { id: "bison_butt", style: "ram", pow: 1, dur: 0.6, rng: 1.0, cd: 0.4 },
      bison_trample: { id: "bison_trample", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.5 },
      bison_kick: { id: "bison_kick", style: "stomp", pow: 1, dur: 0.75, rng: 1.1, cd: 0.6 },
    },
    ymDefault: "bison_hook", ymCharge: "bison_charge", ymStomp: "bison_trample", ymKick: "bison_kick",
    ymRotation: function (L, n) { return n % 3 === 0 ? "bison_butt" : "bison_hook"; },
  };

  if (CBZ.unitKit) CBZ.unitKit.register("bison", def(BISON_SPEC));
  if (typeof module !== "undefined" && module.exports) module.exports = { STATS: STATS, REAL: REAL };
})();
