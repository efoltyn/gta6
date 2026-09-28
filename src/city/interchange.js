/* ============================================================
   city/interchange.js — THE GRADE-SEPARATED INTERCHANGE.

   The highway network (highwaynet.js) meets itself in flush T-junctions.
   Traffic AI drives axis-aligned records and keeps using the at-grade T,
   so the T stays. What this file adds is the thing a real freeway has
   there: a FLYOVER for the crossing movement. It diverges from the stem's
   inbound carriageway on a deceleration lane, peels away past a painted
   gore, climbs on a smooth vertical curve, crosses OVER the through route
   on a real bridge (slab + box girder, parapets, hammerhead piers outside
   the lanes and in the median, expansion joints over every pier), comes
   down on retained fill and merges into the far carriageway through an
   acceleration lane.

   WHICH side is "inbound" and which carriageway is "far" is NOT typed here:
   it is read from CBZ.roadLaneCenter (config.js), the same function every
   driver steers by, so the flyover leaves and joins the lanes the cars
   actually use under either traffic convention.

   PHYSICS (the part that must be exactly right):
     • the ramp surface is ONE moving-platform rig (systems/platforms_moving.js)
       holding ONE deck whose height comes from `topAt` — the planned
       profile, linearly interpolated between 2 m stations. CBZ.mpGroundAt
       serves it to the player's feet and to the car the player is driving,
       STEP_UP-gated, so it can only be climbed from its at-grade ends.
       AI cars never pass fromY, so traffic on the road below is never
       lifted onto the deck (the reason this is not a floorAt provider).
     • parapets, retaining walls and piers are CBZ.orientedCollider records
       with honest vertical bands: a parapet 7 m up does not stop a car
       passing beneath it; a pier stops everything from its footing to its
       soffit and nothing on the deck above it.
     • the profile is proven by CBZ.highwayFlyoverPlan (pure math, no
       THREE) — max grade, station steps, soffit clearance — see the node
       harness in the wave report.

   Geometry reuses the highway kit (highways.js CBZ._hwyKit): the same
   asphalt material, the same paint/furniture vertex-colour meshes, so the
   whole interchange is a handful of draw calls.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const DEG = Math.PI / 180;

  // ---- design constants (metres) ------------------------------------------
  const R = {
    laneHalf: 1.9,        // one 3.8 m ramp lane
    shoulder: 1.4,        // paved each side of it (parapets stand on the outer 0.45)
    grade: 0.05,          // 5 % max on the tangents
    clearTop: 7.6,        // deck top wherever the ramp is over another deck
    vc: 64,               // vertical-curve length (box-smoothing window)
    step: 2,              // station spacing
    taper: 60,            // diverge taper (lane appears)
    decel: 140,           // parallel deceleration lane
    divR: 420, divA: 6 * DEG,  // the peel-away curve past the gore
    mainR: 115,           // the flyover's main curve
    sR: 620,              // reverse curve that sets the lane beside the far carriageway
    accel: 170,           // parallel acceleration lane
    taperOut: 70,         // merge taper (lane disappears)
    gap: 1.0,             // ground between the descending ramp and the far deck edge
    slab: 0.35, girder: 1.3,   // bridge section depth = 1.65
    bridgeY: 2.6,         // above this the ramp is a bridge on piers; below it retained fill
    noseGap: 4.9,         // gore nose: lane inner edge this far outside the mainline edge line
  };
  R.half = R.laneHalf + R.shoulder;

  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // Turtle over the local frame: through route along z' at x'=0, stem along +x'.
  function walk(segs, x0, z0, hx0, hz0, step) {
    const out = [];
    let x = x0, z = z0, hx = hx0, hz = hz0, s = 0;
    out.push({ x, z, hx, hz, s, zone: segs[0].zone });
    for (const g of segs) {
      if (g.len <= 1e-6 && !g.ang) continue;
      if (!g.ang) {
        const n = Math.max(1, Math.ceil(g.len / step)), ds = g.len / n;
        for (let i = 0; i < n; i++) { x += hx * ds; z += hz * ds; s += ds; out.push({ x, z, hx, hz, s, zone: g.zone }); }
      } else {
        const L = Math.abs(g.ang) * g.r;
        const n = Math.max(1, Math.ceil(L / step)), dA = g.ang / n, chord = 2 * g.r * Math.sin(Math.abs(dA) / 2);
        for (let i = 0; i < n; i++) {
          // chord along the mid-angle heading: exact on a circle
          const c = Math.cos(dA / 2), sn = Math.sin(dA / 2);
          const mx = hx * c - hz * sn, mz = hx * sn + hz * c;
          x += mx * chord; z += mz * chord; s += L / n;
          const c2 = Math.cos(dA), s2 = Math.sin(dA);
          const nx = hx * c2 - hz * s2, nz = hx * s2 + hz * c2; hx = nx; hz = nz;
          out.push({ x, z, hx, hz, s, zone: g.zone });
        }
      }
    }
    return out;
  }

  /* CBZ.highwayFlyoverPlan(q) — PURE. q (local frame):
       Ht/Hs    through/stem deck half-widths (incl. shoulders)
       travT/travS  their travelled half-widths (edge-line offsets)
       medT     through median half (piers may stand inside it)
       sIn      z' side of the stem's inbound lanes (±1)
       tDir     z' direction of travel on the far carriageway (±1)
       gy       at-grade deck top
     Returns samples [{x,z,hx,hz,s,y,zone,eIn,eOut,hug,over}] plus zones. */
  CBZ.highwayFlyoverPlan = function (q) {
    const sIn = q.sIn >= 0 ? 1 : -1, tDir = q.tDir >= 0 ? 1 : -1;
    const gy = q.gy != null ? q.gy : 0.085;
    const zc0 = sIn * (q.travS + R.laneHalf);               // decel lane centre, adjacent to the edge line
    const xD = -(q.Ht + R.gap + R.half);                     // descent alignment beside the far deck
    const xM = -(q.travT + R.laneHalf);                      // accel lane centre, adjacent to its edge line
    const shift = xM - xD;                                   // > 0: the reverse curve moves toward the through route
    const aS = Math.acos(1 - shift / (2 * R.sR));
    // heading after the diverge arc, then the main turn onto tDir
    const phi1 = Math.atan2(sIn * Math.sin(R.divA), -Math.cos(R.divA));
    const dMain = wrapA(Math.atan2(tDir, 0) - phi1);
    const phiD = Math.atan2(tDir, 0);
    const sgnS = Math.sign(wrapA(0 - phiD));                 // turn toward +x' first

    function build(L2, L4) {
      const segs = [
        { len: R.taper + R.decel, zone: "cutD" },
        { r: R.divR, ang: sIn > 0 ? -R.divA : R.divA, zone: "div" },
        { len: L2, zone: "climb" },
        { r: R.mainR, ang: dMain, zone: "main" },
        { len: L4, zone: "desc" },
        { r: R.sR, ang: sgnS * aS, zone: "rev" },
        { r: R.sR, ang: -sgnS * aS, zone: "rev" },
        { len: R.accel, zone: "cutM" },
        { len: R.taperOut, zone: "cutM" },
      ];
      // heading -x' rotated toward +z' needs a NEGATIVE angle in this turtle
      // ((hx,hz) -> (hx c - hz s, hx s + hz c)); the sign above encodes that.
      let S = walk(segs, 0, zc0, -1, 0, R.step);
      // translate along x' so the main curve ends exactly on the descent line
      let endMain = null;
      for (let i = 0; i < S.length; i++) if (S[i].zone === "main") endMain = S[i];
      const dx = xD - endMain.x;
      for (const p of S) p.x += dx;
      return { S, T0: dx };
    }
    function edges(S) {
      let noseD = null, noseM = null, sRev = null;
      for (const p of S) {
        // lane inner edge distance outside the stem's edge line (diverge side)
        const latD = sIn * p.z - R.laneHalf - q.travS;
        if (noseD == null && p.zone !== "cutD" && latD >= R.noseGap) noseD = p.s;
        if (sRev == null && p.zone === "rev") sRev = p.s;
      }
      noseM = sRev;
      return { noseD, noseM };
    }
    // is any part of this station's deck ABOVE another deck (0.3 m slack)?
    // Beside a deck is not over it: the ramp may climb alongside the stem.
    function over(p) {
      const nx = -p.hz, nz = p.hx;
      for (let k = -4; k <= 4; k++) {
        const o = (k / 4) * R.half;
        const x = p.x + nx * o, z = p.z + nz * o;
        if (Math.abs(x) <= q.Ht + 0.3) return true;                          // through route
        if (x >= q.Ht - 1 && Math.abs(z) <= q.Hs + 0.3) return true;         // stem
      }
      return false;
    }
    function profile(S, nD, nM) {
      const n = S.length, req = new Float64Array(n), y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = S[i];
        p.over = p.s > nD && p.s < nM && over(p);
        req[i] = p.over ? R.clearTop : gy;
      }
      // tent envelope at the design grade, then a box filter of length vc:
      // convolution can never steepen a slope, so max grade <= R.grade holds.
      for (let i = 0; i < n; i++) {
        let v = gy;
        for (let k = 0; k < n; k++) if (req[k] > gy) { const t = req[k] - R.grade * Math.abs(S[k].s - S[i].s); if (t > v) v = t; }
        y[i] = v;
      }
      const out = new Float64Array(n), half = R.vc / 2;
      // trapezoid-weighted moving average over |s' - s| <= half
      for (let i = 0; i < n; i++) {
        let sum = 0, w = 0;
        for (let k = i; k >= 0 && S[i].s - S[k].s <= half; k--) { const ww = k === i ? 0.5 : 1; sum += y[k] * ww; w += ww; }
        for (let k = i; k < n && S[k].s - S[i].s <= half; k++) { const ww = k === i ? 0.5 : 1; sum += y[k] * ww; w += ww; }
        out[i] = sum / w;
      }
      return { raw: y, y: out };
    }

    let L2 = 20, L4 = 20, plan = null;
    for (let iter = 0; iter < 80; iter++) {
      const B = build(L2, L4), E = edges(B.S);
      if (E.noseD == null || E.noseM == null) return null;
      const P = profile(B.S, E.noseD, E.noseM);
      // the first/last stations the profile leaves grade
      let rise = null, fall = null;
      for (let i = 0; i < B.S.length; i++) if (P.raw[i] > gy + 1e-6) { if (rise == null) rise = B.S[i].s; fall = B.S[i].s; }
      if (rise == null) return null;
      const needL2 = rise < E.noseD + R.vc / 2 + 12;
      const needL4 = fall > E.noseM - R.vc / 2 - 12;
      if (!needL2 && !needL4) {
        for (let i = 0; i < B.S.length; i++) B.S[i].y = P.y[i];
        plan = { S: B.S, T0: B.T0, noseD: E.noseD, noseM: E.noseM, L2, L4 };
        break;
      }
      if (needL2) L2 += 8;
      if (needL4) L4 += 8;
    }
    if (!plan) return null;
    const S = plan.S;
    // cross-section per station: inner = the side facing the mainline it is
    // attached to at that end. hug = inner edge snapped to a mainline edge line.
    const sMid = (plan.noseD + plan.noseM) / 2;
    for (const p of S) {
      const nx = -p.hz, nz = p.hx;                        // left normal
      // which side of the lane faces the attached mainline?
      let side;
      if (p.s < sMid) side = Math.sign(nz * (-sIn)) || 1;    // stem lies toward z'=0 from the ramp
      else side = Math.sign(nx * 1) || 1;                    // through route lies toward +x'
      p.side = side;                                      // +1: inner edge on the LEFT normal
      p.eOut = R.half;
      if (p.s <= plan.noseD) {                            // diverge: hug the stem edge line
        p.hug = true;
        p.eIn = Math.max(R.laneHalf, Math.abs(p.z) - q.travS);   // |z| is the lane centre offset
        // taper: the lane appears out of the stem's shoulder, whose outer
        // edge it starts on (lane centre +1.1 m == the old deck edge)
        const e0 = Math.max(0.2, (q.Hs - q.travS) - R.laneHalf);
        if (p.s < R.taper) p.eOut = e0 + (R.half - e0) * (p.s / R.taper);
      } else if (p.s >= plan.noseM) {                      // merge: hug the far carriageway edge line
        p.hug = true;
        p.eIn = Math.max(R.laneHalf, Math.abs(p.x) - q.travT);
        const tEnd = S[S.length - 1].s;
        const e0 = Math.max(0.2, (q.Ht - q.travT) - R.laneHalf);
        if (tEnd - p.s < R.taperOut) p.eOut = e0 + (R.half - e0) * ((tEnd - p.s) / R.taperOut);
      } else { p.hug = false; p.eIn = R.half; }
      p.bridge = p.y > R.bridgeY;
    }
    // ---- piers: hammerhead columns under the centreline, outside every lane ----
    function pierOK(p) {
      const hw = 0.7 + 0.5;
      if (Math.abs(p.x) <= q.Ht + hw) {
        if (Math.abs(p.x) <= Math.max(0, q.medT - 1.25) && q.medT >= 1.2) return true;   // in the through median
        return false;
      }
      if (p.x >= q.Ht - 1 - hw && Math.abs(p.z) <= q.Hs + hw) return false; // stem deck
      return true;
    }
    // candidate stations are INTERPOLATED every 0.5 m (a 2 m station grid
    // would step straight over the 1.2 m median window)
    function interp(sq) {
      let i = 0;
      while (i < S.length - 2 && S[i + 1].s < sq) i++;
      const a = S[i], b = S[i + 1], t = Math.max(0, Math.min(1, (sq - a.s) / (b.s - a.s)));
      const hx = a.hx + (b.hx - a.hx) * t, hz = a.hz + (b.hz - a.hz) * t, hl = Math.hypot(hx, hz) || 1;
      return { s: sq, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, hx: hx / hl, hz: hz / hl,
        eIn: a.eIn + (b.eIn - a.eIn) * t, eOut: a.eOut + (b.eOut - a.eOut) * t, side: a.side, bridge: true, hug: false };
    }
    const piers = [];
    let a0 = -1, a1 = -1;
    for (let i = 0; i < S.length; i++) if (S[i].bridge) { if (a0 < 0) a0 = i; a1 = i; }
    if (a0 >= 0) {
      const sA = S[a0].s, sB = S[a1].s;
      let last = sA;                                      // abutment
      for (;;) {
        let pick = null;
        for (let sq = last + 18; sq <= Math.min(sB - 10, last + 40); sq += 0.5) {
          const c = interp(sq);
          if (!pierOK(c)) continue;
          if (!pick || Math.abs(sq - last - 32) < Math.abs(pick.s - last - 32)) pick = c;
        }
        if (!pick) {   // no legal station in a normal span: the nearest legal one beyond
          for (let sq = last + 40; sq <= sB - 10; sq += 0.5) { const c = interp(sq); if (pierOK(c)) { pick = c; break; } }
        }
        if (!pick) break;
        piers.push(pick); last = pick.s;
      }
    }
    return {
      samples: S, T0: plan.T0, noseD: plan.noseD, noseM: plan.noseM, L2: plan.L2, L4: plan.L4,
      piers: piers, abut: a0 >= 0 ? [a0, a1] : null, R: R, sIn: sIn, tDir: tDir,
      depthAt: function (p) { return p.bridge ? R.slab + R.girder : R.slab; },
    };
  };
  CBZ.highwayFlyoverConst = R;

  // ============================================================
  //  PLANNING IN THE WORLD (highwaynet.js calls this at order 91, before the
  //  continent reads the relief gate): pick the T, plan the ramp, hand the
  //  mainlines their cuts/pier gaps, return relief corridors.
  // ============================================================
  let _plans = [];
  let _rig = null;
  CBZ.cityInterchanges = function () { return _plans; };

  function sgn(v) { return v < 0 ? -1 : 1; }

  /* planSlip(q, travS, travT, Hs, Ht, gy) — PURE, local frame. The slip in
     quadrant q (z' sign) on the stem's side of the through route. */
  const SLIP_R = 30, SLIP_L = 95;
  function planSlip(q, travS, travT, Hs, Ht, gy) {
    const lcS = travS + R.laneHalf, lcT = travT + R.laneHalf;
    const segs = [{ len: SLIP_L, zone: "a" }, { r: SLIP_R, ang: -q * Math.PI / 2, zone: "arc" }, { len: SLIP_L, zone: "b" }];
    const T = walk(segs, lcT + SLIP_R + SLIP_L, q * lcS, -1, 0, R.step);
    const arcLen = SLIP_R * Math.PI / 2, sT1 = SLIP_L, sT2 = SLIP_L + arcLen, sMid = (sT1 + sT2) / 2, sEnd = T[T.length - 1].s;
    let nose1 = null, nose2 = null;
    const e0S = Math.max(0.2, (Hs - travS) - R.laneHalf), e0T = Math.max(0.2, (Ht - travT) - R.laneHalf);
    for (const p of T) {
      const first = p.s < sMid;
      const d = first ? Math.abs(p.z) : Math.abs(p.x), trav = first ? travS : travT;
      const dx = first ? 0 : -1, dz = first ? -q : 0;
      p.side = Math.sign(-p.hz * dx + p.hx * dz) || 1;
      p.hug = d - R.laneHalf - trav < R.noseGap;
      // reach the (axis-aligned) edge line exactly along this station's
      // rotated normal, or a grass sliver opens inside the gore on the curve
      const perp = first ? Math.abs(p.hx) : Math.abs(p.hz);
      p.eIn = p.hug ? Math.max(R.laneHalf, (d - trav) / Math.max(0.35, perp)) : R.half;
      p.eOut = R.half;
      if (p.s < R.taper) p.eOut = e0S + (R.half - e0S) * (p.s / R.taper);
      if (sEnd - p.s < R.taper) p.eOut = e0T + (R.half - e0T) * ((sEnd - p.s) / R.taper);
      p.y = gy; p.bridge = false;
      if (!p.hug && nose1 == null) nose1 = p.s;
      if (!p.hug) nose2 = p.s;
    }
    if (nose1 == null) return null;
    let xN1 = 0, zN2 = 0;
    for (const p of T) { if (p.s <= nose1) xN1 = p.x; if (p.s <= nose2) zN2 = p.z; }
    return { S: T, q: q, sT1: sT1, sT2: sT2, nose1: nose1, nose2: nose2,
      xNose1: xN1, xMax: T[0].x, zNose2: zN2, zMax: Math.abs(T[T.length - 1].z) };
  }
  CBZ.highwaySlipPlan = planSlip;

  /* spec: { through: route, stem: route, recs: {id -> highway rec}, city } */
  CBZ.planInterchange = function (spec) {
    const thr = spec.through, stem = spec.stem, city = spec.city;
    const tRec = spec.recs[thr.id], sRec = spec.recs[stem.id];
    if (!tRec || !sRec || !stem.roads || !stem.roads.length || !thr.roads) return null;
    const s0 = stem.pts[0], s1 = stem.pts[1];
    if (Math.abs(s1.z - s0.z) > 0.5) return null;                  // stem must start horizontal
    const Z0 = s0.z, sStem = sgn(s1.x - s0.x);
    // the through leg: vertical, containing Z0
    let X0 = null, thrRec = null;
    for (const r of thr.roads) {
      if (!r.vertical) continue;
      if (Math.abs(Z0 - r.z) <= r.len / 2 && Math.abs((s0.x - sStem * tRec.half) - r.x) < 1.5) { X0 = r.x; thrRec = r; }
    }
    if (X0 == null) return null;
    const stemRec = stem.roads[0];
    const L = CBZ.roadLaneCenter || function (r, d) { return d; };
    const sIn = sgn(L(stemRec, -sStem, 0));                        // z side of the inbound lanes
    let tDir = 1;
    if (sgn(L(thrRec, 1, 0)) !== -sStem) tDir = -1;                 // the far carriageway's travel
    const TS = tRec.spec, SS = sRec.spec;
    const plan = CBZ.highwayFlyoverPlan({
      Ht: tRec.half, Hs: sRec.half, travT: TS.trav, travS: SS.trav, medT: TS.medHalf,
      sIn: sIn, tDir: tDir, gy: tRec.deckY,
    });
    if (!plan) return null;
    const S = plan.samples;
    // room checks: the stem and the through leg must hold the whole ramp
    const stemLen = Math.abs(s1.x - s0.x) + tRec.half;
    if (plan.T0 > stemLen - 30) return null;
    const endZ = Z0 + S[S.length - 1].z;
    if (endZ < thrRec.z - thrRec.len / 2 + 160 || endZ > thrRec.z + thrRec.len / 2 - 160) return null;
    // local -> world
    const W = function (x, z) { return { x: X0 + sStem * x, z: Z0 + z }; };
    for (const p of S.concat(plan.piers)) {
      const w = W(p.x, p.z); p.wx = w.x; p.wz = w.z;
      p.whx = sStem * p.hx; p.whz = p.hz;
    }
    const G = { plan: plan, S: S, X0: X0, Z0: Z0, sStem: sStem, sIn: sIn, tDir: tDir, W: W, tRec: tRec, sRec: sRec,
      thrRec: thrRec, stemRec: stemRec, thrId: thr.id, stemId: stem.id };
    // ---- cuts: the outer shoulder the ramp lane takes over -------------------
    let dEnd = null, mBeg = null;
    for (const p of S) { if (p.s <= plan.noseD) dEnd = p; if (mBeg == null && p.s >= plan.noseM) mBeg = p; }
    const xa = X0 + sStem * dEnd.x, xb = X0 + sStem * (S[0].x + 1);
    const za = Z0 + sIn * (SS.trav + 0.05), zb = Z0 + sIn * (sRec.half + 0.5);
    sRec.cuts.push({ minX: Math.min(xa, xb), maxX: Math.max(xa, xb), minZ: Math.min(za, zb), maxZ: Math.max(za, zb) });
    const zc = Z0 + mBeg.z, zd = Z0 + S[S.length - 1].z + tDir * 1;
    const xc = X0 - sStem * (TS.trav + 0.05), xd = X0 - sStem * (tRec.half + 0.5);
    tRec.cuts.push({ minX: Math.min(xc, xd), maxX: Math.max(xc, xd), minZ: Math.min(zc, zd), maxZ: Math.max(zc, zd) });
    // ---- piers standing in the through median clear the barrier ------------
    for (const p of plan.piers) {
      if (Math.abs(p.x) < TS.medHalf) tRec.barrierGaps.push({ x: p.wx, z: p.wz, r: 3.2 });
    }
    // ---- AT-GRADE SLIP RAMPS in the two stem-side quadrants: every movement
    //      of the T gets a visible ramp. A slip is a connector, the same
    //      curve whichever way traffic uses it: it rides the stem's outer lane
    //      line, a 90 degree curve through the quadrant, then the through
    //      route's outer lane line, each end attached through a taper, a
    //      parallel lane and a painted gore exactly like the flyover's.
    G.slips = [];
    let flyStemCut = Infinity;
    for (const p of S) if (p.s <= plan.noseD) flyStemCut = Math.min(flyStemCut, p.x);
    for (const q of [-1, 1]) {
      const SLp = planSlip(q, SS.trav, TS.trav, sRec.half, tRec.half, tRec.deckY + 0.0015);
      if (!SLp) continue;
      const T = SLp.S;
      // the flyover owns the stem shoulder from its own nose on
      if (q === sIn && SLp.xMax + 5 >= flyStemCut) continue;
      // never stand a flyover pier on (or within 0.3 m of) a slip deck
      let clash = false;
      for (const pr of plan.piers) for (const t of T) if (Math.hypot(pr.x - t.x, pr.z - t.z) < Math.max(t.eIn, t.eOut) + 1.0) { clash = true; break; }
      if (clash) { console.warn("[interchange] slip q=" + q + " clears no pier; skipped"); continue; }
      for (const t of T) { const w = W(t.x, t.z); t.wx = w.x; t.wz = w.z; t.whx = sStem * t.hx; t.whz = t.hz; }
      // cuts: the slip takes over each mainline's outer shoulder while attached
      const xs0 = X0 + sStem * SLp.xNose1, xs1 = X0 + sStem * (SLp.xMax + 1);
      const zs0 = Z0 + q * (SS.trav + 0.05), zs1 = Z0 + q * (sRec.half + 0.5);
      sRec.cuts.push({ minX: Math.min(xs0, xs1), maxX: Math.max(xs0, xs1), minZ: Math.min(zs0, zs1), maxZ: Math.max(zs0, zs1) });
      const zt0 = Z0 + SLp.zNose2, zt1 = Z0 + q * (SLp.zMax + 1);
      const xt0 = X0 + sStem * (TS.trav + 0.05), xt1 = X0 + sStem * (tRec.half + 0.5);
      tRec.cuts.push({ minX: Math.min(xt0, xt1), maxX: Math.max(xt0, xt1), minZ: Math.min(zt0, zt1), maxZ: Math.max(zt0, zt1) });
      G.slips.push(SLp);
    }
    _plans.push(G);
    // ---- relief corridors (terrain flat under the whole footprint) ---------
    const cor = [];
    for (let i = 0; i < S.length - 1; i += 10) {
      const a = S[i], b = S[Math.min(S.length - 1, i + 10)];
      cor.push({ x0: a.wx, z0: a.wz, x1: b.wx, z1: b.wz, half: R.half + 8,
        minX: Math.min(a.wx, b.wx), maxX: Math.max(a.wx, b.wx), minZ: Math.min(a.wz, b.wz), maxZ: Math.max(a.wz, b.wz) });
    }
    void city;
    return { corridors: cor, plan: G };
  };

  // ============================================================
  //  THE BUILD (late pass, from highways.js after every deck exists)
  // ============================================================
  CBZ.buildInterchanges = function (city) {
    if (_rig && _rig.release) { try { _rig.release(); } catch (e) {} }
    _rig = null;
    const list = _plans; _plans = [];
    const built = [];
    for (const G of list) {
      try { buildOne(G, city); built.push(G); } catch (e) { console.error("[interchange]", e); }
    }
    _plans = built;
  };
  // plans belong to one world
  if (CBZ.addLandmass) CBZ.addLandmass(function () { _plans = []; }, -999);

  function buildOne(G, city) {
    const K = CBZ._hwyKit, THREE = window.THREE;
    if (!K || !THREE) return;
    const M = K.mats(), col = K.col;
    const S = G.S, P = G.plan, n = S.length;
    const group = new THREE.Group();
    group.name = "interchange";
    group.userData.terrain = true;
    city.root.add(group);

    // colour contrast that makes a flyover read from the air: pale parapet
    // caps and outer faces, a darker traffic face, a dark weathered fascia band
    // along the deck edge, mid-grey girders and a darker soffit
    const WHITE = col(0xe6e9ec), JOINT = col(0x3b3d41), CONC = col(0xc8c5ba), CONC_D = col(0x5f5d58),
      CONC_S = col(0x8f8d86), GIRDER = col(0x9c9a92), CAP = col(0xe0ddd2), CUSH_Y = col(0xe2b418), CUSH_K = col(0x1f1f21), EARTH = col(0x6d6a5c);

    // world cross-section helpers
    function lnorm(p) { return { x: -p.whz, z: p.whx }; }              // left normal in world
    // inner side sign in WORLD left-normal terms (mirroring x flips it)
    function innerW(p) { return p.side * G.sStem; }
    function edgePt(p, lat, dy) {
      const nl = lnorm(p);
      return [p.wx + nl.x * lat, p.y + (dy || 0), p.wz + nl.z * lat];
    }
    function innerLat(p) { return innerW(p) * p.eIn; }
    function outerLat(p) { return -innerW(p) * p.eOut; }
    // deck edge on WORLD side w (+1 = left normal). "Inner" flips sides at the
    // middle of the flyover (it faces the stem, then the through route), so
    // anything strung between two stations pairs edges by world side, never
    // by inner/outer — or it would cut diagonally across the deck at the flip.
    function latSide(p, w) { return w * (innerW(p) === w ? p.eIn : p.eOut); }

    // ---- chunks along the ramp (deck/paint/furniture merged per 400 m) ------
    const chunks = [];
    function C(s) {
      const k = Math.floor(s / 400);
      return chunks[k] || (chunks[k] = { deck: new K.Acc(true), paint: new K.Acc(false), furn: new K.Acc(false), s0: k * 400 });
    }
    const R0 = P.R;
    const sG = R0.taper + R0.decel;                                     // gore point (diverge)
    let iG = 0, iND = 0, iNM = n - 1, iAcc = n - 1;
    for (let i = 0; i < n; i++) {
      if (S[i].s <= sG) iG = i;
      if (S[i].s <= P.noseD) iND = i;
      if (S[i].s < P.noseM) iNM = i + 1;
      if (S[i].zone === "cutM" && iAcc === n - 1) iAcc = i;
    }
    // ---- deck + paint of one ramp (the flyover, then each slip) -----------------
    // S: stations; iG/iND: diverge gore start / nose; iNM/iAcc: merge nose /
    // accel lane start; tIn/tOut: taper lengths in stations; C: its chunks
    function surface(S, n, iG, iND, iNM, iAcc, tIn, tOut, C, deckMat) {
      const laneAttr = [0, 3.8, 0, 0];
      for (let i = 0; i < n - 1; i++) {
        const a = S[i], b = S[i + 1], c = C((a.s + b.s) / 2);
        const aL = latSide(a, 1), aR = latSide(a, -1), bL = latSide(b, 1), bR = latSide(b, -1);
        const aI = edgePt(a, aL), aO = edgePt(a, aR);
        const bI = edgePt(b, bL), bO = edgePt(b, bR);
        const va = a.s - c.s0, vb = b.s - c.s0;
        // aSec: lateral from lane centre, along, edge-line offset (rumble outside it), inner
        const sa = function (lat, v) { return [lat, v, 2.0, 0]; };
        c.deck.tri(aI, aO, bO, null, true, sa(aL, va), sa(aR, va), sa(bR, vb), laneAttr);
        c.deck.tri(aI, bO, bI, null, true, sa(aL, va), sa(bR, vb), sa(bL, vb), laneAttr);
      }

      // ---- paint ----------------------------------------------------------------
      function line(i0, i1, latFn, w, color, dash) {
        for (let i = i0; i < i1; i++) {
          const a = S[i], b = S[i + 1];
          if (dash) { const ph = (a.s % dash[1]); if (ph > dash[0]) continue; }
          const la = latFn(a), lb = latFn(b), c = C(a.s);
          c.paint.quad(edgePt(a, la - w / 2, 0.012), edgePt(a, la + w / 2, 0.012), edgePt(b, lb + w / 2, 0.012), edgePt(b, lb - w / 2, 0.012), color, true);
        }
      }
      const innerLane = function (p) { return innerW(p) * (R0.laneHalf + 0.1); };
      const hugLine = function (p) { return innerW(p) * (p.eIn - 0.1); };
      // lane edge lines on both world sides; on the attached side the decel /
      // accel lane zones get the dotted line below instead
      for (const w of [1, -1]) {
        const i0 = tIn, i1 = n - 1 - tOut;
        for (let i = i0; i < i1; i++) {
          if (innerW(S[i]) === w && (i < iG || i >= iAcc)) continue;
          line(i, i + 1, function () { return w * (R0.laneHalf + 0.1); }, 0.2, WHITE);
        }
      }
      // decel / accel lane lines: wide dotted, on the mainline edge
      line(tIn, iG, hugLine, 0.3, WHITE, [1.2, 4]);
      line(iAcc, n - 1 - tOut, hugLine, 0.3, WHITE, [1.2, 4]);
      // gores: the mainline edge line continues, the ramp's own edge line starts,
      // chevrons fill the wedge between them
      line(iG, iND, hugLine, 0.2, WHITE);
          line(iNM, iAcc, hugLine, 0.2, WHITE);
      function chevrons(i0, i1) {
        for (let i = i0; i < i1; i += 3) {
          const a = S[i], b = S[Math.min(i1, i + 2)];
          const la0 = innerLane(a), la1 = hugLine(a), lb1 = hugLine(b);
          if (Math.abs(la1 - la0) < 0.8) continue;
          const c = C(a.s), w = 0.25;
          // a diagonal bar from the lane line (at a) to the mainline line (at b)
          c.paint.quad(edgePt(a, la0 - w, 0.013), edgePt(a, la0 + w, 0.013), edgePt(b, lb1 + w, 0.013), edgePt(b, lb1 - w, 0.013), WHITE, true);
        }
      }
      chevrons(iG, iND); chevrons(iNM, iAcc);
    }
    surface(S, n, iG, iND, iNM, iAcc, Math.round(R0.taper / R0.step), Math.round(R0.taperOut / R0.step), C, M.ramp || M.asphalt);

    // ---- structure -------------------------------------------------------------
    const colliders = [];
    function oc(cx, cz, hw, hd, yaw, y0, y1) {
      colliders.push(CBZ.orientedCollider ? CBZ.orientedCollider(cx, cz, hw, hd, yaw, y0, y1)
        : { minX: cx - Math.max(hw, hd), maxX: cx + Math.max(hw, hd), minZ: cz - Math.max(hw, hd), maxZ: cz + Math.max(hw, hd), y0: y0, y1: y1 });
    }
    const PAR_H = 1.07;
    function quadF(c, a, b, cc, d, color) { c.furn.quad(a, b, cc, d, color); }
    for (let i = 0; i < n - 1; i++) {
      const a = S[i], b = S[i + 1], c = C(a.s);
      const elevated = a.y > 0.3 || b.y > 0.3;
      if (!elevated) continue;
      const bridge = a.bridge && b.bridge;
      // parapets on each side where the side is free (not hugging a mainline)
      for (const w of [1, -1]) {
        if ((a.hug && innerW(a) === w) || (b.hug && innerW(b) === w)) continue;
        const la = latSide(a, w), lb = latSide(b, w);
        const inw = -Math.sign(la) * 0.42;                  // parapet thickness, inward
        const A0 = edgePt(a, la), A1 = edgePt(a, la + inw * (la ? 1 : 0)), B0 = edgePt(b, lb), B1 = edgePt(b, lb + inw);
        const up = function (p, h) { return [p[0], p[1] + h, p[2]]; };
        quadF(c, A0, B0, up(B0, PAR_H), up(A0, PAR_H), CONC);                   // outer face
        quadF(c, A1, B1, up(B1, PAR_H), up(A1, PAR_H), CONC_S);                 // traffic face
        quadF(c, up(A0, PAR_H), up(B0, PAR_H), up(B1, PAR_H), up(A1, PAR_H), CAP);  // cap
        // below the deck: fascia (bridge) or retaining wall to the ground (fill)
        const drop = bridge ? R0.slab + 0.55 : Math.max(a.y, b.y) + 0.4;   // a 0.9 m fascia beam on the bridge
        const down = function (p, d) { return [p[0], p[1] - d, p[2]]; };
        quadF(c, A0, B0, down(B0, bridge ? drop : b.y + 0.4), down(A0, bridge ? drop : a.y + 0.4), bridge ? CONC_D : CONC_S);
        // collider: the parapet (and the wall under it on fill), height-banded
        const Ma = edgePt(a, la + inw / 2), Mb = edgePt(b, lb + inw / 2);
        const mx = (Ma[0] + Mb[0]) / 2, mz = (Ma[2] + Mb[2]) / 2;
        const len = Math.hypot(B0[0] - A0[0], B0[2] - A0[2]);
        const yaw = Math.atan2(B0[0] - A0[0], B0[2] - A0[2]);
        const top = Math.max(a.y, b.y) + PAR_H;
        const bot = bridge ? Math.min(a.y, b.y) - 0.3 : -1.5;
        oc(mx, mz, 0.24, len / 2 + 0.05, yaw, bot, top);
      }
      if (bridge) {
        // slab soffit + box girder (trapezoid)
        const la = latSide(a, 1), lao = latSide(a, -1), lb = latSide(b, 1), lbo = latSide(b, -1);
        const sd = R0.slab;
        const ctrA = (la + lao) / 2, ctrB = (lb + lbo) / 2, wA = Math.abs(la - lao), wB = Math.abs(lb - lbo);
        quadF(c, edgePt(a, la, -sd), edgePt(b, lb, -sd), edgePt(b, lbo, -sd), edgePt(a, lao, -sd), CONC_D);
        const gd = R0.girder, tA = wA * 0.28, tB = wB * 0.28, bA = wA * 0.2, bB = wB * 0.2;
        for (const s of [-1, 1]) {
          quadF(c, edgePt(a, ctrA + s * tA, -sd), edgePt(b, ctrB + s * tB, -sd), edgePt(b, ctrB + s * bB, -sd - gd), edgePt(a, ctrA + s * bA, -sd - gd), GIRDER);
        }
        quadF(c, edgePt(a, ctrA - bA, -sd - gd), edgePt(b, ctrB - bB, -sd - gd), edgePt(b, ctrB + bB, -sd - gd), edgePt(a, ctrA + bA, -sd - gd), CONC_D);
      }
    }
    // abutment end walls where the bridge meets the fill
    if (P.abut) {
      for (const i of P.abut) {
        const p = S[i], c = C(p.s);
        const la = innerLat(p), lo = outerLat(p);
        quadF(c, edgePt(p, la, -0.3), edgePt(p, lo, -0.3), [edgePt(p, lo)[0], -0.2, edgePt(p, lo)[2]], [edgePt(p, la)[0], -0.2, edgePt(p, la)[2]], CONC_S);
        // joint across the deck
        c.paint.quad(edgePt(p, la, 0.014), edgePt(p, lo, 0.014), [edgePt(p, lo)[0] + p.whx * 0.3, p.y + 0.014, edgePt(p, lo)[2] + p.whz * 0.3],
          [edgePt(p, la)[0] + p.whx * 0.3, p.y + 0.014, edgePt(p, la)[2] + p.whz * 0.3], JOINT, true);
      }
    }
    // piers: pile cap, column, hammerhead; expansion joint on the deck above
    for (const p of P.piers) {
      const c = C(p.s);
      const soffit = p.y - R0.slab - R0.girder;
      const hx = p.whx, hz = p.whz;
      c.furn.box(p.wx, 0.25, p.wz, hx, hz, 1.6, 0.35, 1.6, EARTH);                        // footing
      c.furn.box(p.wx, soffit / 2, p.wz, hx, hz, 0.7, soffit / 2, 0.7, CONC);             // column
      const capW = (p.eIn + p.eOut) * 0.42;
      c.furn.box(p.wx, soffit - 0.55, p.wz, hx, hz, 0.75, 0.55, capW, CONC_D);             // hammerhead
      for (const s of [-1, 1]) {                                                            // bearings
        const nl = lnorm(p);
        c.furn.box(p.wx + nl.x * s * capW * 0.6, soffit + 0.06, p.wz + nl.z * s * capW * 0.6, hx, hz, 0.3, 0.06, 0.3, JOINT);
      }
      oc(p.wx, p.wz, 0.72, 0.72, Math.atan2(hx, hz), -2, soffit);
      const la = innerLat(p), lo = outerLat(p);
      c.paint.quad(edgePt(p, la, 0.016), edgePt(p, lo, 0.016),
        [edgePt(p, lo)[0] + hx * 0.35, p.y + 0.016, edgePt(p, lo)[2] + hz * 0.35],
        [edgePt(p, la)[0] + hx * 0.35, p.y + 0.016, edgePt(p, la)[2] + hz * 0.35], JOINT, true);
    }
    // crash cushions + chevron signs at the two gore noses
    // crash cushion + object marker at the DIVERGE nose (the merge nose has
    // nothing facing traffic: its wedge opens behind the drivers)
    for (const iN of [iND]) {
      const p = S[iN], c = C(p.s);
      const lat = innerW(p) * (R0.half + 0.25);           // the physical nose: ramp edge | stem shoulder
      const e = edgePt(p, lat);
      const fx = -p.whx, fz = -p.whz;                     // faces the approaching traffic
      c.furn.box(e[0] + fx * 1.2, p.y + 0.45, e[2] + fz * 1.2, p.whx, p.whz, 1.1, 0.45, 0.35, CUSH_Y);
      c.furn.box(e[0] + fx * 2.1, p.y + 0.46, e[2] + fz * 2.1, p.whx, p.whz, 0.12, 0.46, 0.36, CUSH_K);
      oc(e[0] + fx * 1.2, e[2] + fz * 1.2, 0.4, 1.15, Math.atan2(p.whx, p.whz), p.y - 0.5, p.y + 0.9);
      if (CBZ.highwayChevronSign) CBZ.highwayChevronSign(e[0] + fx * 2.8, p.y, e[2] + fz * 2.8, fx, fz);
    }

    function emit(chunks, deckMat) {
      for (const ch of chunks) {
        if (!ch) continue;
        const d = ch.deck.mesh(deckMat);
        if (d) { d.receiveShadow = true; d.castShadow = true; group.add(d); }
        const detail = [];
        const pm = ch.paint.mesh(M.paint);
        if (pm) { pm.renderOrder = 1; pm.userData.roadPaint = true; group.add(pm); detail.push(pm); }
        const fm = ch.furn.mesh(M.furn);
        if (fm) { fm.castShadow = true; fm.receiveShadow = true; group.add(fm); }
        if (d && detail.length && K.registerChunk) K.registerChunk(d, detail);
      }
    }
    // depth-ordered over the mainline it hugs through the diverge/merge
    // tapers (highways.js deckLayer: the flyover is layer 5, slips 4)
    emit(chunks, K.deckLayer ? K.deckLayer("ramp", 5) : (M.ramp || M.asphalt));
    // ---- the at-grade slip ramps: same surface builder, ordinary asphalt -------
    for (const SL of (G.slips || [])) {
      const sc = [];
      const C2 = function (s) {
        const k = Math.floor(s / 400);
        return sc[k] || (sc[k] = { deck: new K.Acc(true), paint: new K.Acc(false), furn: new K.Acc(false), s0: k * 400 });
      };
      const T = SL.S, m = T.length;
      let jG = 0, jND = 0, jNM = m - 1, jAcc = m - 1;
      for (let i = 0; i < m; i++) {
        if (T[i].s <= SL.sT1) jG = i;
        if (T[i].s <= SL.nose1) jND = i;
        if (T[i].s < SL.nose2) jNM = i + 1;
        if (T[i].s <= SL.sT2) jAcc = i;
      }
      surface(T, m, jG, jND, jNM, jAcc, Math.round(R0.taper / R0.step), Math.round(R0.taper / R0.step), C2, M.asphalt);
      emit(sc, K.deckLayer ? K.deckLayer("asphalt", 4) : M.asphalt);   // 1.5 mm over the mainline shoulder
    }
    if (CBZ.colliders) for (const c of colliders) CBZ.colliders.push(c);

    // ---- gantries before the split -------------------------------------------
    if (CBZ.highwayGantry) {
      const card = function (dz) { return dz < 0 ? "NORTH" : "SOUTH"; };      // -Z is north
      const thrNum = parseInt(String(G.thrId).replace(/\D/g, ""), 10) || 1;
      const exitNo = String(Math.max(1, Math.round(Math.abs(G.Z0 - (G.thrRec.z - G.thrRec.len / 2)) / 1000) + 1));
      const hx = -G.sStem, hz = 0;                                            // inbound travel direction (world)
      const rz = hx;                                                          // right vector z of heading (hx,hz): (-hz, hx)
      const exitRight = sgn(rz) === G.sIn;
      const arrowA = (exitRight ? 1 : -1) * Math.PI / 4;
      const SS = G.sRec.spec;
      const place = function (xLocal, outerOff, panels, panelOff) {
        const x = G.X0 + G.sStem * xLocal;
        const outer = outerOff;
        const gz = G.Z0 + G.sIn * outer / 2;
        const pz = G.Z0 + G.sIn * (panelOff != null ? panelOff : SS.medHalf + (SS.trav - SS.medHalf) / 2);
        CBZ.highwayGantry({ x: x, z: gz, px: x, pz: pz, tx: hx, tz: hz, y0: G.sRec.deckY,
          span: outer, panelSpan: SS.trav - SS.medHalf + 4, panels: panels });
      };
      const thru = { routes: [thrNum], dir: card(-G.tDir), arrow: 0 };
      const exitP = { routes: [thrNum], dir: card(G.tDir), arrow: arrowA, exit: exitNo };
      const stemLen = Math.abs(G.stemRec.len) - 40;
      place(Math.min(P.T0 + 300, stemLen), G.sRec.half + 1.2, exitRight ? [thru, exitP] : [exitP, thru]);
      place(P.T0 - (R0.taper + R0.decel) + 12, G.sRec.half + R0.half * 2 + 1.5, [
        { routes: [thrNum], dir: card(G.tDir), arrow: arrowA, exit: exitNo },
      ], SS.trav + R0.laneHalf);                                             // over the exit lane
    }

    // ---- THE RAMP SURFACE: one static rig, one deck, height from the plan ------
    if (CBZ.movingPlatform) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of S) { x0 = Math.min(x0, p.wx); x1 = Math.max(x1, p.wx); z0 = Math.min(z0, p.wz); z1 = Math.max(z1, p.wz); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const anchor = new THREE.Object3D();
      anchor.position.set(cx, 0, cz);
      anchor.name = "interchange-rig";
      group.add(anchor);
      // coarse grid of station indices for the lookup
      const CELL = 16, grid = new Map();
      const key = function (ix, iz) { return ix * 100003 + iz; };
      for (let i = 0; i < n - 1; i++) {
        const a = S[i], reach = Math.max(a.eIn, a.eOut) + 1;
        const gx0 = Math.floor((a.wx - reach - cx) / CELL), gx1 = Math.floor((a.wx + reach - cx) / CELL);
        const gz0 = Math.floor((a.wz - reach - cz) / CELL), gz1 = Math.floor((a.wz + reach - cz) / CELL);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const k = key(gx, gz); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(i);
        }
      }
      const topAt = function (lx, lz) {
        const L = grid.get(key(Math.floor(lx / CELL), Math.floor(lz / CELL)));
        if (!L) return NaN;
        const x = lx + cx, z = lz + cz;
        let best = NaN, bd = 1e9;
        for (let k = 0; k < L.length; k++) {
          const i = L[k], a = S[i], b = S[i + 1];
          const ex = b.wx - a.wx, ez = b.wz - a.wz, l2 = ex * ex + ez * ez;
          let t = l2 > 0 ? ((x - a.wx) * ex + (z - a.wz) * ez) / l2 : 0;
          if (t < -0.02 || t > 1.02) continue;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const px = a.wx + ex * t, pz = a.wz + ez * t;
          const nl = lnorm(a), lat = (x - px) * nl.x + (z - pz) * nl.z;
          const inr = innerW(a) * lat >= 0;                                    // on the inner side?
          const lim = inr ? a.eIn + (b.eIn - a.eIn) * t : a.eOut + (b.eOut - a.eOut) * t;
          if (Math.abs(lat) > lim + 0.05) continue;
          const d = Math.abs(lat);
          if (d < bd) { bd = d; best = a.y + (b.y - a.y) * t; }
        }
        return best;
      };
      G.topAt = function (x, z) { return topAt(x - cx, z - cz); };
      _rig = CBZ.movingPlatform(anchor, {
        id: "interchange-flyover", yaw: false, tilt: false, riders: true, onLeave: "none",
        decks: [{ x: 0, z: 0, w: (x1 - x0) + 12, d: (z1 - z0) + 12, top: 0, topAt: topAt }],
      });
    }
    G.group = group;
  }
})();
