/* ============================================================
   city/carwheels.js — THE CAR WHEEL. One mesh per wheel, built once per
   (radius, width, style, rimFrac) and shared by every car in the city.

   WHAT IT REPLACES. playercars.js built a wheel from three meshes: a
   28-sided CylinderGeometry tyre (a black puck with square edges), a grey
   0.03 m cylinder "brake disc" stuck on its cap, and a rim made of boxes
   laid on that cap. From the door plate it read as a hockey puck with a
   plate on it, and it cost three draw calls a wheel (twelve a car).

   WHAT A WHEEL IS NOW, in the wheel's own frame (axle = local +Y, +Y is
   outboard; the caller lays it on its side with rotation.z = -+PI/2):
     - a LATHED TYRE: bead, a sidewall that bulges past the rim flange, a
       rounded shoulder, a flat tread with two circumferential grooves;
     - a DISHED RIM: a flange + lip that sits proud of the bead, a barrel
       you can see down through the spokes, the spoke face recessed into it;
     - SPOKES per style (sport5, twin10, mesh, turbine, sixlug, steel, aero,
       wire), a hub boss, a centre cap, lug nuts;
     - a BRAKE ROTOR (and dust shield) behind the spokes, spinning with the
       wheel as a real rotor does.
   All of it is ONE BufferGeometry with vertex colours and a `uv` whose u
   picks a texel of carfx.js's 8x1 WHEEL RAMP (green = roughness, blue =
   metalness). So rubber is matte, the alloy is a metal, the chrome is a
   mirror and the rotor is dull steel, in one draw call with one shared
   material (CBZ.vehicleMat("wheel")).

   The CALIPER is separate on purpose: it must not spin. caliperGeo() is
   authored in the CAR ROOT frame (no rotation needed), so addWheels drops it
   in as a plain root child and mergeStaticCarParts bakes all four into the
   caliper material's bucket (one draw call for the whole car).

   STEERING. Front wheels yaw now. collectWheels() (playercars.js) flags the
   front axle `userData.steers` and sets rotation.order = "YXZ": the matrix
   is Ry(steer) * Rx(spin) * Rz(lay on side), so the existing spin writes
   (rotation.x -= ...) still turn the wheel about its axle and rotation.y
   turns it about the vertical. CBZ.carWheelSteer drives rotation.y.

   CONTRACT KEPT: geometry.parameters.radiusTop is set on every wheel geo,
   because vehicles.js applyFlatVisual and crashdeform.js popWheel read the
   tyre radius from there (they were written against CylinderGeometry).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  // texel index into carfx's wheel ramp. carfx owns the numbers; this is the
  // fallback so the builder still runs (and verifies in node) without it.
  const CH = CBZ.WHEEL_CH || { tread: 0, side: 1, alloy: 2, chrome: 3, rotor: 4, satin: 5, gloss: 6, dark: 7 };
  const RAMP_W = CBZ.WHEEL_RAMP_W || 8;

  function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  const COL = {
    tread: rgb(0x1b1c1f), groove: rgb(0x0d0e10), side: rgb(0x232427),
    alloy: rgb(0xc9ced4), alloyDk: rgb(0x7c828a), chrome: rgb(0xeef0f3),
    rotor: rgb(0x6a6d72), shield: rgb(0x1a1b1e), hat: rgb(0x2a2c30),
    cap: rgb(0x24272c), lug: rgb(0xb8bcc2), steel: rgb(0x3b3e43), steelDk: rgb(0x26282c),
    aero: rgb(0x2d3137), black: rgb(0x16171a),
  };

  // ---- a tiny triangle accumulator: position / normal / colour / uv -------
  function Acc() { this.p = []; this.n = []; this.c = []; this.u = []; }
  // one triangle; winding is FIXED to agree with the supplied normals, so no
  // builder below has to get clockwise-vs-counter right by hand.
  Acc.prototype.tri = function (a, b, c, na, nb, nc, col, ch) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const sx = na[0] + nb[0] + nc[0], sy = na[1] + nb[1] + nc[1], sz = na[2] + nb[2] + nc[2];
    if (gx * sx + gy * sy + gz * sz < 0) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; }
    const u = (ch + 0.5) / RAMP_W;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    for (let i = 0; i < 3; i++) { this.c.push(col[0], col[1], col[2]); this.u.push(u, 0.5); }
  };
  Acc.prototype.quadFlat = function (a, b, c, d, out, col, ch) {
    // flat quad a-b-c-d; normal from geometry, turned to face `out`
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const n = [nx, ny, nz];
    this.tri(a, b, c, n, n, n, col, ch);
    this.tri(a, c, d, n, n, n, col, ch);
  };
  Acc.prototype.geometry = function (radius, width) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    if (radius != null) g.parameters = { radiusTop: radius, radiusBottom: radius, height: width };
    g._shared = true;
    return g;
  };

  /* LATHE about the local Y axis (optionally about a parallel axis at cx,cz).
     prof: [{ r, y, col, ch, crease }] — segment i (prof[i] -> prof[i+1])
     wears prof[i].col / .ch. Walk the profile COUNTER-CLOCKWISE around the
     solid in the (r, y) plane and the normal (dy, -dr) faces out of it; a
     flat disc walked INWARD (r decreasing) faces +Y. */
  function lathe(acc, prof, segs, opt) {
    opt = opt || {};
    const a0 = opt.a0 || 0, a1 = opt.a1 == null ? Math.PI * 2 : opt.a1;
    const cx = opt.cx || 0, cz = opt.cz || 0, smooth = opt.smooth !== false;
    const nS = prof.length - 1, segN = [];
    for (let i = 0; i < nS; i++) {
      const dr = prof[i + 1].r - prof[i].r, dy = prof[i + 1].y - prof[i].y;
      const l = Math.hypot(dr, dy) || 1;
      segN.push([dy / l, -dr / l]);
    }
    function nAt(i, seg) {                         // 2D normal at profile point i for segment seg
      if (!smooth || prof[i].crease) return segN[seg];
      const other = i === seg ? seg - 1 : seg + 1;
      if (other < 0 || other >= nS) return segN[seg];
      const x = segN[seg][0] + segN[other][0], y = segN[seg][1] + segN[other][1];
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    }
    const cosT = [], sinT = [];
    for (let k = 0; k <= segs; k++) {
      const t = a0 + (a1 - a0) * (k / segs);
      cosT.push(Math.cos(t)); sinT.push(Math.sin(t));
    }
    for (let i = 0; i < nS; i++) {
      const A = prof[i], B = prof[i + 1];
      const nA = nAt(i, i), nB = nAt(i + 1, i);
      for (let k = 0; k < segs; k++) {
        const c0 = cosT[k], s0 = sinT[k], c1 = cosT[k + 1], s1 = sinT[k + 1];
        const pA0 = [cx + A.r * c0, A.y, cz + A.r * s0], pA1 = [cx + A.r * c1, A.y, cz + A.r * s1];
        const pB0 = [cx + B.r * c0, B.y, cz + B.r * s0], pB1 = [cx + B.r * c1, B.y, cz + B.r * s1];
        const qA0 = [nA[0] * c0, nA[1], nA[0] * s0], qA1 = [nA[0] * c1, nA[1], nA[0] * s1];
        const qB0 = [nB[0] * c0, nB[1], nB[0] * s0], qB1 = [nB[0] * c1, nB[1], nB[0] * s1];
        if (B.r > 1e-6) acc.tri(pA0, pB0, pB1, qA0, qB0, qB1, A.col, A.ch);
        if (A.r > 1e-6) acc.tri(pA0, pB1, pA1, qA0, qB1, qA1, A.col, A.ch);
      }
    }
  }

  /* A SPOKE: a hexahedron from the hub (r0, angle a0) to the lip (r1, a1),
     width w0 -> w1, FRONT face at yf0 -> yf1 (the concave/convex face line),
     thickness t behind it. `caps` false drops the two end faces (they are
     buried in the hub and the barrel anyway). */
  function spoke(acc, s, col, ch) {
    const P = function (e, side, front) {
      const a = e ? s.a1 : s.a0, r = e ? s.r1 : s.r0, hw = (e ? s.w1 : s.w0) * 0.5 * side;
      const y = (e ? s.yf1 : s.yf0) - (front ? 0 : s.t);
      const c = Math.cos(a), sn = Math.sin(a);
      return [r * c - sn * hw, y, r * sn + c * hw];
    };
    const v = [];
    for (let e = 0; e < 2; e++) for (let sd = -1; sd <= 1; sd += 2) for (let f = 0; f < 2; f++) v.push(P(e, sd, f === 1));
    // index: e*4 + (sd<0?0:2) + front
    const I = function (e, sd, f) { return v[e * 4 + (sd < 0 ? 0 : 2) + f]; };
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 8; i++) { cx += v[i][0]; cy += v[i][1]; cz += v[i][2]; }
    cx /= 8; cy /= 8; cz /= 8;
    function face(a, b, c, d) {
      const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx, my = (a[1] + b[1] + c[1] + d[1]) / 4 - cy, mz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
      acc.quadFlat(a, b, c, d, [mx, my, mz], col, ch);
    }
    face(I(0, -1, 1), I(1, -1, 1), I(1, 1, 1), I(0, 1, 1));            // front
    if (s.back !== false) face(I(0, -1, 0), I(0, 1, 0), I(1, 1, 0), I(1, -1, 0));   // back
    face(I(0, -1, 0), I(1, -1, 0), I(1, -1, 1), I(0, -1, 1));          // side -
    face(I(0, 1, 0), I(0, 1, 1), I(1, 1, 1), I(1, 1, 0));              // side +
    if (s.caps) {
      face(I(0, -1, 0), I(0, -1, 1), I(0, 1, 1), I(0, 1, 0));
      face(I(1, -1, 0), I(1, 1, 0), I(1, 1, 1), I(1, -1, 1));
    }
  }

  function pt(r, y, col, ch, crease) { return { r: r, y: y, col: col, ch: ch, crease: !!crease }; }

  // ---- per-style rim recipes ----------------------------------------------
  //  face: spoke-face depth as a fraction of the half-width (1 = flush with the
  //  tyre's outboard wall, 0 = the tyre's centre plane — a deep dish)
  //  lugs: count (0 = centre-lock / covered)  metal: the lip + spoke finish
  const STYLE = {
    sport5:  { face: 0.46, lugs: 5, metal: "alloy" },
    twin10:  { face: 0.44, lugs: 5, metal: "alloy" },
    mesh:    { face: 0.40, lugs: 0, metal: "alloy" },
    turbine: { face: 0.48, lugs: 5, metal: "alloy" },
    sixlug:  { face: 0.40, lugs: 6, metal: "alloy" },
    steel:   { face: 0.30, lugs: 4, metal: "steel" },
    aero:    { face: 0.62, lugs: 0, metal: "alloy" },
    wire:    { face: 0.02, lugs: 0, metal: "chrome" },
  };
  const SEG_TYRE = 24, SEG_RIM = 24, SEG_HUB = 14;

  function buildWheel(R, W, style, rf) {
    const S = STYLE[style] ? style : "sport5";
    const st = STYLE[S];
    const acc = new Acc();
    const h = W * 0.5, rr = R * rf, s = R - rr;
    const g = Math.min(0.009, W * 0.03);                 // groove depth
    const mc = st.metal === "chrome" ? COL.chrome : st.metal === "steel" ? COL.steel : COL.alloy;
    const mch = st.metal === "chrome" ? CH.chrome : st.metal === "steel" ? CH.satin : CH.alloy;

    // ---- TYRE (walked CCW: inboard bead -> tread -> outboard bead) ----------
    lathe(acc, [
      pt(rr, -0.78 * h, COL.side, CH.side),
      pt(rr + 0.45 * s, -1.0 * h, COL.side, CH.side),
      pt(R - 0.12 * s, -0.93 * h, COL.side, CH.side),
      pt(R, -0.62 * h, COL.tread, CH.tread),
      pt(R, -0.36 * h, COL.groove, CH.tread, true),
      pt(R - g, -0.30 * h, COL.groove, CH.tread, true),
      pt(R, -0.24 * h, COL.tread, CH.tread, true),
      pt(R, 0.24 * h, COL.groove, CH.tread, true),
      pt(R - g, 0.30 * h, COL.groove, CH.tread, true),
      pt(R, 0.36 * h, COL.tread, CH.tread, true),
      pt(R, 0.62 * h, COL.side, CH.side),
      pt(R - 0.12 * s, 0.93 * h, COL.side, CH.side),
      pt(rr + 0.45 * s, 1.0 * h, COL.side, CH.side),
      pt(rr, 0.78 * h, COL.side, CH.side),
    ], SEG_TYRE);

    // ---- RIM flange, lip and barrel (CCW round the metal: up the outside,
    //      over the lip, down the inside of the barrel) ----------------------
    const yF = st.face * h;                              // spoke face at the lip end
    const barrelIn = rr * 0.95;
    lathe(acc, [
      pt(rr * 1.005, 0.72 * h, mc, mch),
      pt(rr * 1.06, 0.86 * h, mc, mch),
      pt(rr * 1.045, 0.96 * h, mc, mch),
      pt(barrelIn, 0.90 * h, S === "wire" ? COL.chrome : COL.alloyDk, S === "wire" ? CH.chrome : CH.dark, true),
      pt(barrelIn, -0.70 * h, COL.alloyDk, CH.dark),
    ], SEG_RIM);

    // ---- ROTOR + dust shield behind the spokes (faces outboard, +Y) --------
    const t = Math.max(0.026, W * 0.10);                // spoke thickness
    const yR = Math.max(-0.55 * h, yF - t - 0.045);     // rotor plane
    lathe(acc, [
      pt(barrelIn, yR - 0.012, COL.shield, CH.satin),
      pt(rr * 0.80, yR, COL.rotor, CH.rotor, true),
      pt(rr * 0.30, yR, COL.rotor, CH.rotor),
    ], 20);
    // inboard closing disc (seen from the other side of the car, under the body)
    lathe(acc, [pt(0, -0.74 * h, COL.shield, CH.satin), pt(rr * 1.04, -0.74 * h, COL.shield, CH.satin)], 16);

    // ---- HUB boss + centre cap ----------------------------------------------
    const rHub = rr * (S === "wire" ? 0.24 : S === "steel" ? 0.30 : 0.34);
    const rise = S === "wire" ? 0.30 * h : S === "aero" || S === "steel" ? 0.02 * h : 0.10 * h;
    const yH = yF + rise;                                 // hub face sits proud of the lip end: concave spokes
    const rCap = rHub * 0.5;
    const capCol = S === "wire" ? COL.chrome : COL.cap, capCh = S === "wire" ? CH.chrome : CH.gloss;
    lathe(acc, [
      pt(rHub, yH - 0.035, mc, mch),
      pt(rHub * 0.97, yH + 0.004, mc, mch, true),
      pt(rCap, yH + 0.008, capCol, capCh, true),
      pt(rCap * 0.9, yH + 0.016, capCol, capCh),
      pt(0, yH + 0.02, capCol, capCh),
    ], SEG_HUB);
    // lug nuts on the boss, between the cap and the spoke roots
    for (let i = 0; i < st.lugs; i++) {
      const a = (i / st.lugs) * Math.PI * 2 + Math.PI / st.lugs;
      const rl = rHub * 0.74, lr = Math.max(0.009, rr * 0.05);
      lathe(acc, [pt(lr, yH, COL.lug, CH.chrome), pt(lr, yH + 0.016, COL.lug, CH.chrome, true), pt(0, yH + 0.016, COL.lug, CH.chrome)],
        6, { cx: Math.cos(a) * rl, cz: Math.sin(a) * rl, smooth: false });
    }

    // ---- SPOKES / FACE per style --------------------------------------------
    const r0 = rHub * 0.92, r1 = rr * 0.955;
    function spokes(n, w0, w1, skew, extra) {
      extra = extra || {};
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (extra.phase || 0);
        spoke(acc, {
          a0: a, a1: a + skew, r0: r0, r1: r1, w0: w0, w1: w1,
          yf0: yH + (extra.dy || 0), yf1: yF + (extra.dy || 0), t: extra.t || t, caps: false, back: extra.back,
        }, extra.col || mc, extra.ch == null ? mch : extra.ch);
      }
    }
    if (S === "sport5") spokes(5, rr * 0.22, rr * 0.30, 0);
    else if (S === "twin10") { spokes(5, rr * 0.09, rr * 0.12, 0, { phase: -0.13 }); spokes(5, rr * 0.09, rr * 0.12, 0, { phase: 0.13 }); }
    else if (S === "turbine") spokes(10, rr * 0.10, rr * 0.17, 0.50);
    else if (S === "sixlug") spokes(6, rr * 0.24, rr * 0.28, 0, { t: t * 1.25 });
    else if (S === "mesh") {
      spokes(6, rr * 0.07, rr * 0.08, 0.55);
      spokes(6, rr * 0.07, rr * 0.08, -0.55, { dy: -0.006 });     // the cross family sits a hair behind
    } else if (S === "wire") {
      // laced: 20 thin chrome wires, alternate lean, from a proud hub to a sunk lip
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2, sk = (i & 1) ? 0.32 : -0.32;
        spoke(acc, { a0: a, a1: a + sk, r0: rHub * 0.85, r1: r1, w0: 0.011, w1: 0.009, yf0: yH - (i & 1) * 0.008, yf1: yF + 0.004, t: 0.008, caps: false, back: true },
          COL.chrome, CH.chrome);
      }
      // knock-off spinner: a two-eared bar across the cap
      for (let e = 0; e < 2; e++) {
        const a = e * Math.PI;
        spoke(acc, { a0: a, a1: a, r0: rCap * 0.2, r1: rHub * 1.15, w0: rCap * 0.55, w1: rCap * 0.35, yf0: yH + 0.034, yf1: yH + 0.016, t: 0.016, caps: true },
          COL.chrome, CH.chrome);
      }
    } else if (S === "steel") {
      // pressed steelie: an outer ring, a raised inner dish, and bridges whose
      // gaps are the vent holes (the rotor shows through them)
      lathe(acc, [pt(barrelIn, yF - 0.004, COL.steel, CH.satin), pt(rr * 0.72, yF, COL.steel, CH.satin)], SEG_RIM);
      lathe(acc, [pt(rr * 0.52, yF + 0.006, COL.steel, CH.satin), pt(rHub, yH - 0.002, COL.steel, CH.satin)], SEG_RIM);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spoke(acc, { a0: a, a1: a, r0: rr * 0.50, r1: rr * 0.74, w0: rr * 0.20, w1: rr * 0.24, yf0: yF + 0.006, yf1: yF, t: 0.02, caps: false, back: false },
          COL.steel, CH.satin);
      }
    } else if (S === "aero") {
      // flush aero cover over a five-fin face
      lathe(acc, [pt(barrelIn, yF - 0.012, COL.aero, CH.gloss), pt(rr * 0.86, yF, COL.aero, CH.gloss), pt(rHub, yH - 0.002, COL.aero, CH.gloss)], SEG_RIM);
      spokes(5, rr * 0.05, rr * 0.07, 0.2, { t: 0.012, dy: 0.008, back: false, col: COL.alloy, ch: CH.alloy });
    }
    return acc.geometry(R, W);
  }

  const cache = new Map();
  function wheelGeo(radius, width, style, rimFrac) {
    const rf = rimFrac || 0.66;
    const key = radius.toFixed(4) + "|" + width.toFixed(4) + "|" + (style || "sport5") + "|" + rf.toFixed(3);
    let geo = cache.get(key);
    if (!geo) { geo = buildWheel(radius, width, style || "sport5", rf); cache.set(key, geo); }
    return geo;
  }

  /* CALIPER in the CAR ROOT frame, centred on the wheel centre: an arc block
     straddling the rotor edge near the top of the wheel, a touch behind the
     vertical. Near-vertical on purpose: the front wheels now steer about the
     vertical through their centre, and a caliper on that line barely moves
     relative to the rim at full lock (it stays behind the spokes). */
  const calCache = new Map();
  function caliperGeo(radius, width, rimFrac, side, style) {
    const rf = rimFrac || 0.66, sd = side < 0 ? -1 : 1;
    const key = radius.toFixed(4) + "|" + width.toFixed(4) + "|" + rf.toFixed(3) + "|" + sd + "|" + (style || "");
    let geo = calCache.get(key);
    if (geo) return geo;
    const st = STYLE[style] || STYLE.sport5;
    const h = width * 0.5, rr = radius * rf, yF = st.face * h;
    const t = Math.max(0.026, width * 0.10), yR = Math.max(-0.55 * h, yF - t - 0.045);
    const y0 = yR - 0.028, y1 = yR + 0.028, q0 = rr * 0.60, q1 = rr * 0.87;
    const phi = 0.22, span = 0.62;
    // world direction up-and-back (0, cos phi, -sin phi) mapped into the
    // wheel's local frame for this side's lay-down rotation
    const lx = -sd * Math.cos(phi), lz = -Math.sin(phi), tc = Math.atan2(lz, lx);
    const acc = new Acc();
    const col = [1, 1, 1];
    lathe(acc, [pt(q0, y0, col, 0, true), pt(q1, y0, col, 0, true), pt(q1, y1, col, 0, true), pt(q0, y1, col, 0, true), pt(q0, y0, col, 0, true)],
      3, { a0: tc - span / 2, a1: tc + span / 2, smooth: false });
    [tc - span / 2, tc + span / 2].forEach(function (a, k) {
      const c = Math.cos(a), s = Math.sin(a);
      const P = function (r, y) { return [r * c, y, r * s]; };
      const out = k ? [-s, 0, c] : [s, 0, -c];
      acc.quadFlat(P(q0, y0), P(q1, y0), P(q1, y1), P(q0, y1), out, col, 0);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(acc.p, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(acc.n, 3));
    // into the car frame: the same lay-down rotation the wheel gets
    geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(-sd * Math.PI / 2));
    geo.computeBoundingSphere();
    geo._shared = true;
    calCache.set(key, geo);
    return geo;
  }

  /* FRONT-WHEEL STEER. Driven car: the steering input itself (so the wheels
     turn while parked, as a real car's do). Everything else: the bicycle
     model run backwards — steer = atan(yawRate * wheelbase / v) — which is
     what the AI's arc through a junction actually implies. */
  const LOCK = 0.45;
  function steerWheels(car, list, dt, visual) {
    if (!car || !list || !list.length || !dt) return;
    let want;
    if (car._steerInput != null && (car.player || car === CBZ.cityPlayerCar)) {
      want = car._steerInput * LOCK;
    } else {
      const hd = car.heading || 0;
      if (car._wsHead == null) car._wsHead = hd;
      let d = hd - car._wsHead;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      car._wsHead = hd;
      const v = car.v || 0;
      if (Math.abs(v) < 0.6) want = car._wsSteer || 0;
      else {
        const dims = visual && visual.userData && visual.userData.vehicleDims;
        const wb = (dims && dims.wheelbase) || 2.7;
        want = Math.atan((d / dt) * wb / v);
      }
    }
    if (want > LOCK) want = LOCK; else if (want < -LOCK) want = -LOCK;
    const cur = car._wsSteer || 0;
    const s = cur + (want - cur) * Math.min(1, dt * 9);
    car._wsSteer = s;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (!w.userData || !w.userData.steers) continue;
      if (w.rotation.order !== "YXZ") w.rotation.order = "YXZ";
      w.rotation.y = s;
    }
  }

  // flag the front axle + switch every wheel to the steer-safe Euler order
  function tagSteer(list) {
    let maxZ = -Infinity;
    for (let i = 0; i < list.length; i++) if (list[i].position.z > maxZ) maxZ = list[i].position.z;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      w.rotation.order = "YXZ";                 // identical matrix while rotation.y is 0
      if (w.userData) w.userData.steers = maxZ > 0.2 && w.position.z > maxZ - 0.3;
    }
  }

  function wheelMat() {
    if (CBZ.vehicleMat) {
      const m = CBZ.vehicleMat("wheel");
      if (m && m.isMaterial) return m;
    }
    if (!wheelMat._fb) {
      wheelMat._fb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
      wheelMat._fb._shared = true;
    }
    return wheelMat._fb;
  }

  CBZ.carWheels = {
    STYLES: Object.keys(STYLE),
    wheelGeo: wheelGeo,
    caliperGeo: caliperGeo,
    wheelMat: wheelMat,
    tagSteer: tagSteer,
    steer: steerWheels,
  };
  CBZ.carWheelSteer = steerWheels;
})();
