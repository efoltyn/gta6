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
     - a near-black TYRE: lathed sidewalls that bulge past the rim flange
       (plus a rim-protector ridge on low-profile tyres), a rounded shoulder
       with the only rubber sheen, and a real TREAD: 24 leaning shoulder
       blocks a side, two circumferential grooves and a centre rib;
     - a DISHED RIM: a flange + lip that sits proud of the bead, a barrel
       you can see down through the spokes, the spoke face recessed into it;
     - SPOKES per style (sport5, twin10, mesh, turbine, sixlug, steel, aero,
       wire), a hub boss, a centre cap, lug nuts;
     - a BRAKE ROTOR (and dust shield) behind the spokes, spinning with the
       wheel as a real rotor does.
   All of it is ONE BufferGeometry with vertex colours and a `uv` whose u
   picks a texel of carfx.js's 16x1 WHEEL RAMP (green = roughness, blue =
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
  const CH = CBZ.WHEEL_CH || {
    tread: 0, side: 1, alloy: 2, chrome: 3, rotor: 4, satin: 5, gloss: 6, dark: 7,
    groove: 8, shoulder: 9, face: 10, pocket: 11, hat: 12, lip: 13,
  };
  const RAMP_W = CBZ.WHEEL_RAMP_W || 16;

  function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  // Rubber is NEAR-BLACK (the old 0x1b/0x23 greys read as grey plastic next
  // to the rim); the material's env diffuse fill keeps it from going to a
  // hole in shade. Sidewall a hair lighter than the tread, the shoulder a
  // hair lighter again (it also carries the only rubber sheen, CH.shoulder).
  const COL = {
    tread: rgb(0x151618), groove: rgb(0x0a0b0c), wall: rgb(0x101113),
    side: rgb(0x1c1d20), shoulder: rgb(0x1e1f22),
    alloy: rgb(0xc4c9cf), alloyDk: rgb(0x5d636b), chrome: rgb(0xeef0f3),
    face: rgb(0xd9dde2), pocket: rgb(0x383c42), lip: rgb(0xe4e7ea),
    rotor: rgb(0x8c8f93), rotorEdge: rgb(0x5a5d61), hole: rgb(0x0e0f10),
    shield: rgb(0x17181b), hat: rgb(0x2e3034),
    cap: rgb(0x1d1f23), lug: rgb(0xb8bcc2), steel: rgb(0x3b3e43), steelDk: rgb(0x26282c),
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
    // two-tone: the FRONT face wears col/ch (machined bright), the flanks,
    // back and caps wear s.sideCol/sideCh (the painted pocket) when given
    const sc = s.sideCol || col, sch = s.sideCol ? s.sideCh : ch;
    function face(a, b, c, d, fc, fch) {
      const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx, my = (a[1] + b[1] + c[1] + d[1]) / 4 - cy, mz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
      acc.quadFlat(a, b, c, d, [mx, my, mz], fc, fch);
    }
    face(I(0, -1, 1), I(1, -1, 1), I(1, 1, 1), I(0, 1, 1), col, ch);            // front
    if (s.back !== false) face(I(0, -1, 0), I(0, 1, 0), I(1, 1, 0), I(1, -1, 0), sc, sch);   // back
    face(I(0, -1, 0), I(1, -1, 0), I(1, -1, 1), I(0, -1, 1), sc, sch);          // side -
    face(I(0, 1, 0), I(0, 1, 1), I(1, 1, 1), I(1, 1, 0), sc, sch);              // side +
    if (s.caps) {
      face(I(0, -1, 0), I(0, -1, 1), I(0, 1, 1), I(0, 1, 0), sc, sch);
      face(I(1, -1, 0), I(1, 1, 0), I(1, 1, 1), I(1, -1, 1), sc, sch);
    }
  }

  function pt(r, y, col, ch, crease) { return { r: r, y: y, col: col, ch: ch, crease: !!crease }; }

  // one quad with per-corner normals (winding fixed by Acc.tri)
  function quadN(acc, a, b, c, d, na, nb, nc, nd, col, ch) {
    acc.tri(a, b, c, na, nb, nc, col, ch);
    acc.tri(a, c, d, na, nc, nd, col, ch);
  }
  function P(r, a, y) { return [r * Math.cos(a), y, r * Math.sin(a)]; }
  function NR(a) { return [Math.cos(a), 0, Math.sin(a)]; }          // radial out
  const NY = [0, 1, 0], NYm = [0, -1, 0];

  /* ---- THE TREAD: a real block pattern, not a lathe with two lines on it.
     Five lanes across the face: an outboard and an inboard SHOULDER lane cut
     into N blocks by transverse slots, a circumferential GROOVE inside each,
     and a continuous CENTRE RIB. The slots lean (a V, mirrored across the
     centreline, so the tyre is directional like a real performance tread)
     and the two shoulders are staggered half a pitch. Every slot and groove
     floor sits at R - g and is groove-dark; the block walls are cut square.
     At each tread edge a cap closes the lane down to R - g, so the shoulder
     roll (a coarser lathe that starts a hair below R) meets the blocks as a
     real stepped edge instead of a crack.
       e: tread half-width (fraction of h), b: shoulder lane inner edge,
       c: rib half-width. */
  function tread(acc, R, g, h, N) {
    const e = 0.64 * h, b = 0.30 * h, c = 0.18 * h;
    const f = 0.70, pitch = (Math.PI * 2) / N, lean = 0.32 * pitch, li = lean * (b - c) / (e - c);
    const rg = R - g;
    const T = COL.tread, G = COL.groove, Wl = COL.wall;
    for (let side = -1; side <= 1; side += 2) {
      const ph = side > 0 ? 0.5 : 0;
      const yin = side * b, yout = side * e, ygr = side * c;
      const nIn = side > 0 ? NYm : NY, nOut = side > 0 ? NY : NYm;   // face the groove / face out
      for (let k = 0; k < N; k++) {
        // the lean runs from the rib edge (ygr) out to the tread edge, so a
        // slot floor and the groove floor beside it are ONE straight quad
        const a0 = (k + ph) * pitch, a1 = a0 + f * pitch, a2 = a0 + pitch;
        const i0 = a0 + li, i1 = a1 + li, i2 = a2 + li;                // block edges at yin
        const o0 = a0 + lean, o1 = a1 + lean, o2 = a2 + lean;          // the same edges at the tread edge
        // block top (radial normals: the face reads round)
        quadN(acc, P(R, i0, yin), P(R, i1, yin), P(R, o1, yout), P(R, o0, yout), NR(i0), NR(i1), NR(o1), NR(o0), T, CH.tread);
        // slot floor + the groove floor in line with it, rib edge to tread edge
        quadN(acc, P(rg, a1, ygr), P(rg, a2, ygr), P(rg, o2, yout), P(rg, o1, yout), NR(a1), NR(a2), NR(o2), NR(o1), G, CH.groove);
        // groove floor beside the block
        quadN(acc, P(rg, a0, ygr), P(rg, a1, ygr), P(rg, i1, yin), P(rg, i0, yin), NR(a0), NR(a1), NR(i1), NR(i0), G, CH.groove);
        // transverse walls: block trailing face, next block's leading face
        const t1 = [-Math.sin(i1), 0, Math.cos(i1)], t2 = [Math.sin(i2), 0, -Math.cos(i2)];
        acc.quadFlat(P(rg, i1, yin), P(R, i1, yin), P(R, o1, yout), P(rg, o1, yout), t1, Wl, CH.groove);
        acc.quadFlat(P(rg, i2, yin), P(R, i2, yin), P(R, o2, yout), P(rg, o2, yout), t2, Wl, CH.groove);
        // block wall down into the circumferential groove
        acc.quadFlat(P(rg, i0, yin), P(rg, i1, yin), P(R, i1, yin), P(R, i0, yin), nIn, Wl, CH.groove);
        // tread-edge caps (block end + slot end) so the shoulder meets a step
        acc.quadFlat(P(rg, o0, yout), P(rg, o1, yout), P(R, o1, yout), P(R, o0, yout), nOut, T, CH.tread);
        acc.quadFlat(P(rg, o1, yout), P(rg, o2, yout), P(R, o2, yout), P(R, o1, yout), nOut, Wl, CH.groove);
      }
    }
    // centre rib: continuous, square-walled
    for (let k = 0; k < N; k++) {
      const a0 = k * pitch, a1 = a0 + pitch;
      quadN(acc, P(R, a0, -c), P(R, a1, -c), P(R, a1, c), P(R, a0, c), NR(a0), NR(a1), NR(a1), NR(a0), T, CH.tread);
      acc.quadFlat(P(rg, a0, c), P(rg, a1, c), P(R, a1, c), P(R, a0, c), NY, Wl, CH.groove);
      acc.quadFlat(P(rg, a0, -c), P(rg, a1, -c), P(R, a1, -c), P(R, a0, -c), NYm, Wl, CH.groove);
    }
  }

  // ---- per-style rim recipes ----------------------------------------------
  //  face: spoke-face depth as a fraction of the half-width (1 = flush with the
  //  tyre's outboard wall, 0 = the tyre's centre plane — a deep dish)
  //  lugs: count (0 = centre-lock / covered)  metal: the lip + spoke finish
  //  twoTone: machined bright spoke faces over gunmetal-painted flanks/pockets
  //  drilled: cross-drilled rotor
  const STYLE = {
    sport5:  { face: 0.46, lugs: 5, metal: "alloy", twoTone: true, drilled: true },
    twin10:  { face: 0.44, lugs: 5, metal: "alloy", twoTone: true, drilled: true },
    mesh:    { face: 0.40, lugs: 0, metal: "alloy", drilled: true },
    turbine: { face: 0.48, lugs: 5, metal: "alloy", twoTone: true, drilled: true },
    sixlug:  { face: 0.40, lugs: 6, metal: "alloy", twoTone: true },
    steel:   { face: 0.30, lugs: 4, metal: "steel" },
    aero:    { face: 0.62, lugs: 0, metal: "alloy" },
    wire:    { face: 0.02, lugs: 0, metal: "chrome" },
  };
  const SEG_SIDE = 24, SEG_RIM = 20, SEG_HUB = 10, SEG_ROTOR = 14, TREAD_N = 24;

  // rotor plane + thickness, shared by the wheel and the caliper so they agree
  function rotorFrame(W, st) {
    const h = W * 0.5, yF = st.face * h;
    const t = Math.max(0.026, W * 0.10);                 // spoke thickness
    return { h: h, yF: yF, t: t, yR: Math.max(-0.55 * h, yF - t - 0.045), T: 0.024 };
  }

  function buildWheel(R, W, style, rf) {
    const S = STYLE[style] ? style : "sport5";
    const st = STYLE[S];
    const acc = new Acc();
    const rf_ = rotorFrame(W, st);
    const h = rf_.h, rr = R * rf, s = R - rr;
    const g = Math.min(0.011, Math.max(0.006, W * 0.04)); // tread depth
    const chrome = st.metal === "chrome", steel = st.metal === "steel";
    const mc = chrome ? COL.chrome : steel ? COL.steel : COL.alloy;
    const mch = chrome ? CH.chrome : steel ? CH.satin : CH.alloy;
    const lipC = chrome ? COL.chrome : steel ? COL.steel : COL.lip;
    const lipCh = chrome ? CH.chrome : steel ? CH.satin : CH.lip;
    const faceC = st.twoTone ? COL.face : mc, faceCh = st.twoTone ? CH.face : mch;
    const flankC = st.twoTone ? COL.pocket : mc, flankCh = st.twoTone ? CH.pocket : mch;

    // ---- TYRE ---------------------------------------------------------------
    tread(acc, R, g, h, TREAD_N);
    // SIDEWALLS. Outboard, walked from the tread edge down to the bead (the
    // CCW order): a rounded shoulder (the sheen channel), the sidewall
    // bulging PAST the rim flange at mid-height, and on low-profile tyres a
    // rim-protector ridge standing proud of the flange; the bead tucks in
    // behind the flange. Inboard gets the same silhouette in fewer rings.
    const Sd = COL.side, Sh = COL.shoulder;
    const r0 = R - 0.35 * g;                                // starts under the block tops
    const rProt = Math.max(rr * 1.075, rr + 0.12 * s);
    const lowPro = rf >= 0.66 && (rr + 0.40 * s) > rProt + 0.018;
    const out = [
      pt(r0, 0.64 * h, Sh, CH.shoulder),
      pt(R - 0.05 * s, 0.80 * h, Sh, CH.shoulder),
      pt(R - 0.22 * s, 0.96 * h, Sd, CH.side),
      pt(rr + 0.40 * s, 1.00 * h, Sd, CH.side),
    ];
    if (lowPro) {
      out.push(pt(rProt + 0.006, 1.035 * h, Sd, CH.side));
      out.push(pt(rProt - 0.006, 0.985 * h, Sd, CH.side, true));
    } else {
      out.push(pt(rr + 0.16 * s, 0.97 * h, Sd, CH.side));
    }
    out.push(pt(rr * 1.065, 0.90 * h, Sd, CH.side));
    out.push(pt(rr, 0.80 * h, Sd, CH.side));
    // sidewall rings: only as many as the tread-edge caps can hide the chord
    // sag of (the shoulder starts 0.35 g under the block tops, caps reach g)
    const segSide = Math.max(18, Math.min(SEG_SIDE, Math.ceil(Math.PI / Math.acos(1 - 0.6 * g / R))));
    lathe(acc, out, segSide);
    lathe(acc, [
      pt(rr, -0.80 * h, Sd, CH.side),
      pt(rr + 0.40 * s, -1.00 * h, Sh, CH.shoulder),
      pt(r0, -0.64 * h, Sh, CH.shoulder),
    ], segSide);

    // ---- RIM flange, polished lip and barrel (CCW round the metal: up the
    //      outside, over the lip, down the inside of the barrel) -------------
    const yF = rf_.yF;
    const barrelIn = rr * 0.95;
    const barC = chrome ? COL.chrome : steel ? COL.steelDk : COL.alloyDk;
    const barCh = chrome ? CH.chrome : steel ? CH.satin : CH.dark;
    lathe(acc, [
      pt(rr * 1.06, 0.86 * h, lipC, lipCh),
      pt(rr * 1.055, 0.95 * h, lipC, lipCh),
      pt(rr * 1.02, 0.97 * h, lipC, lipCh),
      pt(barrelIn * 1.005, 0.93 * h, barC, barCh, true),     // the lip's inner edge: a hard break into the barrel
      pt(barrelIn, -0.70 * h, barC, barCh),
    ], SEG_RIM);

    // ---- BRAKES behind the spokes (all faces outboard, +Y): dust shield,
    //      the rotor's outer edge (its thickness), a bare-steel friction ring,
    //      the step up to a dark hat. Spins with the wheel as a rotor does. ---
    const yR = rf_.yR, TT = rf_.T;
    const rOut = rr * 0.84, rIn = rr * 0.52, rHat = rr * 0.50, hatY = yR + 0.016;
    lathe(acc, [
      pt(barrelIn, yR - 0.034, COL.shield, CH.satin),
      pt(rOut, yR - TT, COL.rotorEdge, CH.rotor, true),
      pt(rOut, yR, COL.rotor, CH.rotor, true),
      pt(rIn, yR, COL.hat, CH.hat, true),
      pt(rHat, hatY, COL.hat, CH.hat, true),
      pt(rr * 0.20, hatY, COL.hat, CH.hat),
    ], SEG_ROTOR);
    if (st.drilled) {
      // cross-drilled: two staggered rings of holes, dark dots on the face
      const hs = Math.max(0.0035, rr * 0.022);
      for (let ring = 0; ring < 2; ring++) {
        const rH = rr * (0.63 + ring * 0.11), n = 10;
        for (let i = 0; i < n; i++) {
          const a = (i + ring / 2) / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
          const tx = -sn * hs, tz = c * hs, rx = c * hs, rz = sn * hs;
          const x = rH * c, z = rH * sn, y = yR + 0.0008;
          acc.quadFlat([x - rx, y, z - rz], [x + tx, y, z + tz], [x + rx, y, z + rz], [x - tx, y, z - tz], NY, COL.hole, CH.groove);
        }
      }
    }
    // inboard closing disc (seen from the other side of the car, under the body)
    lathe(acc, [pt(0, -0.74 * h, COL.shield, CH.satin), pt(rr * 1.04, -0.74 * h, COL.shield, CH.satin)], 16);

    // ---- HUB boss + centre cap ----------------------------------------------
    const rHub = rr * (S === "wire" ? 0.24 : S === "steel" ? 0.30 : 0.34);
    const rise = S === "wire" ? 0.30 * h : S === "aero" || S === "steel" ? 0.02 * h : 0.10 * h;
    const yH = yF + rise;                                 // hub face sits proud of the lip end: concave spokes
    const rCap = rHub * 0.5;
    const hubC = st.twoTone ? COL.pocket : mc, hubCh = st.twoTone ? CH.pocket : mch;
    const capCol = chrome ? COL.chrome : COL.cap, capCh = chrome ? CH.chrome : CH.gloss;
    lathe(acc, [
      pt(rHub, yH - 0.035, hubC, hubCh),
      pt(rHub * 0.97, yH + 0.004, hubC, hubCh, true),
      pt(rCap * 1.08, yH + 0.004, faceC, faceCh, true),       // a machined ring round the cap
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
    const s0 = rHub * 0.92, s1 = rr * 0.955, t = rf_.t;
    function spokes(n, w0, w1, skew, extra) {
      extra = extra || {};
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (extra.phase || 0);
        spoke(acc, {
          a0: a, a1: a + skew, r0: s0, r1: s1, w0: w0, w1: w1,
          yf0: yH + (extra.dy || 0), yf1: yF + (extra.dy || 0), t: extra.t || t, caps: false, back: extra.back,
          sideCol: extra.col ? null : flankC, sideCh: flankCh,
        }, extra.col || faceC, extra.ch == null ? faceCh : extra.ch);
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
        spoke(acc, { a0: a, a1: a + sk, r0: rHub * 0.85, r1: s1, w0: 0.011, w1: 0.009, yf0: yH - (i & 1) * 0.008, yf1: yF + 0.004, t: 0.008, caps: false, back: true },
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
      spokes(5, rr * 0.05, rr * 0.07, 0.2, { t: 0.012, dy: 0.008, back: false, col: COL.face, ch: CH.face });
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

  /* CALIPER in the CAR ROOT frame, centred on the wheel centre, up and a
     touch behind the vertical. Near-vertical on purpose: the front wheels
     steer about the vertical through their centre, and a caliper on that
     line barely moves relative to the rim at full lock.
     SHAPE: a convex D-section swept along an arc — a rounded outboard piston
     housing standing in front of the friction ring, a bridge over the
     rotor's outer edge, a shallower inboard half behind it — with the arc
     ends tapered, so it reads as a cast caliper hugging the disc, not a box
     floating in front of it. The rotor edge disappears into it. */
  const calCache = new Map();
  function caliperGeo(radius, width, rimFrac, side, style) {
    const rf = rimFrac || 0.66, sd = side < 0 ? -1 : 1;
    const key = radius.toFixed(4) + "|" + width.toFixed(4) + "|" + rf.toFixed(3) + "|" + sd + "|" + (style || "");
    let geo = calCache.get(key);
    if (geo) return geo;
    const st = STYLE[style] || STYLE.sport5;
    const fr = rotorFrame(width, st), rr = radius * rf, yR = fr.yR, TT = fr.T;
    const rOut = rr * 0.84, q0 = rr * 0.60, q1 = Math.min(rr * 0.915, rOut + 0.03);
    const col = [1, 1, 1];
    // the D-section, walked CCW in (r, y): outboard face first
    const sec = [
      [q0, yR + 0.003], [q0 + 0.006, yR + 0.022], [q0 + 0.018, yR + 0.031],
      [q1 - 0.014, yR + 0.033], [q1 - 0.002, yR + 0.022], [q1, yR - TT - 0.004],
      [q1 - 0.016, yR - TT - 0.016], [rOut - 0.02, yR - TT - 0.016],
    ];
    const phi = 0.22, span = 0.62, n = 6;
    const lx = -sd * Math.cos(phi), lz = -Math.sin(phi), tc = Math.atan2(lz, lx);
    // centroid of the section: the arc ends taper toward it
    let cr = 0, cy = 0;
    for (let i = 0; i < sec.length; i++) { cr += sec[i][0]; cy += sec[i][1]; }
    cr /= sec.length; cy /= sec.length;
    const ring = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n, a = tc - span / 2 + span * u;
      const taper = 1 - 0.28 * Math.pow(Math.abs(u * 2 - 1), 3);  // ends pinch in
      ring.push(sec.map(function (p) {
        const r = cr + (p[0] - cr) * taper, y = cy + (p[1] - cy) * taper;
        return [r * Math.cos(a), y, r * Math.sin(a)];
      }));
    }
    const acc = new Acc();
    const m = sec.length;
    // smooth section normals (2D, averaged across neighbouring edges)
    const en = [];
    for (let i = 0; i < m; i++) {
      const A = sec[i], B = sec[(i + 1) % m];
      const dr = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dr, dy) || 1;
      en.push([dy / l, -dr / l]);
    }
    const vn = [];
    for (let i = 0; i < m; i++) {
      const p = en[(i + m - 1) % m], q = en[i];
      const x = p[0] + q[0], y = p[1] + q[1], l = Math.hypot(x, y) || 1;
      vn.push([x / l, y / l]);
    }
    // the section is CW or CCW depending on walk; orient normals away from the centroid
    for (let i = 0; i < m; i++) {
      if ((sec[i][0] - cr) * vn[i][0] + (sec[i][1] - cy) * vn[i][1] < 0) { vn[i][0] = -vn[i][0]; vn[i][1] = -vn[i][1]; }
    }
    for (let k = 0; k < n; k++) {
      const a0 = tc - span / 2 + span * (k / n), a1 = tc - span / 2 + span * ((k + 1) / n);
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const N = function (idx, a) { return [vn[idx][0] * Math.cos(a), vn[idx][1], vn[idx][0] * Math.sin(a)]; };
        quadN(acc, ring[k][i], ring[k + 1][i], ring[k + 1][j], ring[k][j], N(i, a0), N(i, a1), N(j, a1), N(j, a0), col, 0);
      }
    }
    // end caps: fans from the (tapered) section centroid
    [0, n].forEach(function (k) {
      const a = tc - span / 2 + span * (k / n);
      const nrm = k ? [-Math.sin(a), 0, Math.cos(a)] : [Math.sin(a), 0, -Math.cos(a)];
      const cc = [cr * Math.cos(a), cy, cr * Math.sin(a)];
      for (let i = 0; i < m; i++) acc.tri(cc, ring[k][i], ring[k][(i + 1) % m], nrm, nrm, nrm, col, 0);
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
