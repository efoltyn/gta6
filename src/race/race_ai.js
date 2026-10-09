/* ============================================================
   race/race_ai.js — THE DRIVERS. No THREE, no DOM.

   An AI driver presses the same three inputs the player does
   (steer, throttle, brake) into the same race_physics car. No rails,
   no teleport, no speed writes: if it goes fast, the tyres let it.

   PLAN (once, shared by the field):
     LINE   a minimum-curvature line u(s) relaxed inside the racing
            surface: high on the straights, down to the bottom groove at
            mid-turn, back up to the wall on exit (the bullring line).
     SPEED  per 2 m of line: the cornering limit from curvature, bank
            and downforce (the same tyre friction the physics uses,
            physics.gripEstimate), then a forward pass with the engine
            (physics.maxDriveForce) and a backward pass with the brakes
            (physics.brakeDecel), both inside the friction circle. The
            backward pass puts the brake points where the car can
            actually stop.

   DRIVE (per frame): pure pursuit on u(s) + a lane offset with a
   speed-scaled lookahead, a speed controller on the profile scaled by
   the driver's pace, and racecraft that moves the offset:
     - a car ahead in my lane: sit in its draft, pull out high or low
       when the tow has closed the gap, commit to the side;
     - side by side: never steer into an overlapping car (hard room
       limit on my lane), lift if boxed in behind;
     - defend: a car closing behind on the inside gets the inside
       taken away before it overlaps (aggression scales it);
     - mistakes ∝ (1 - skill): a late brake, a lift, running wide, a
       wiggle. Overdriven entries can spin the car for real;
     - recovery: spun or stopped → reverse off the wall if pointed at
       it, turn back to the race direction, wait for a gap in traffic,
       rejoin.

   RUBBER BAND (fair, documented): only when the game marks a car
   car.isPlayer. A driver behind the player gains up to +3% of its
   pace, one ahead loses up to 3%, scaled by the gap (full at 200 m).
   Pace is a fraction of the planner's limit speed; the band is clamped
   at PACE_MAX + 0.01 (the measured top of the lap-time plateau), so no
   car is ever asked to corner faster than its tyres allow.

   FIELD: ai.field(n, seed) → [{skill, aggression, seed}] spreading 9
   cars over ~1.0-1.5 s a lap (measured in tools/race-check-physics.mjs).
============================================================ */
(function (root) {
  "use strict";

  const core = (root && root.CBZ && root.CBZ.race && root.CBZ.race.core) ||
    (typeof require === "function" ? require("./race_core.js") : null);
  const physics = (root && root.CBZ && root.CBZ.race && root.CBZ.race.physics) ||
    (typeof require === "function" ? require("./race_physics.js") : null);
  const D = core.DIMS, L = D.L, G = physics.G, PIT = core.PIT;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sgn = (v) => (v < 0 ? -1 : 1);

  const ROOM = 3.0;                        // centre-to-centre lateral room a driver leaves alongside (car 1.99 m wide)

  // ---- the plan ------------------------------------------------------------
  const SP = 2.0;                         // line sample spacing (m of centreline)
  const U_LO = D.INNER + 1.5;             // bottom groove: 0.5 m off the apron edge with a 2 m car
  const U_HI = D.WALL_U - 2.1;             // top: a car's width off the wall face (the body swings out on exit)
  let PLAN = null;

  function buildPlan() {
    const spec = physics.SPEC;
    const M = Math.round(L / SP), ds = L / M;
    const cx = new Float64Array(M), cz = new Float64Array(M), nx = new Float64Array(M), nz = new Float64Array(M);
    const bank = new Float64Array(M), U = new Float64Array(M);
    const f = {};
    for (let i = 0; i < M; i++) {
      core.frame(i * ds, f);
      cx[i] = f.x; cz[i] = f.z; nx[i] = f.nx; nz[i] = f.nz; bank[i] = f.bank;
    }
    /* minimum-curvature relaxation: Gauss-Seidel on the second difference
       (sum |P[i-1] - 2P[i] + P[i+1]|^2 → min), each point moving only along
       its own normal inside [U_LO, U_HI]. Midpoint averaging would minimise
       LENGTH (the string hugs the infield); the bi-harmonic stencil minimises
       CURVATURE, which on an oval is the high-low-high line. Coarse to fine. */
    const px = (i) => cx[i] + nx[i] * U[i], pz = (i) => cz[i] + nz[i] * U[i];
    for (const stride of [12, 6, 3, 2, 1]) {
      const iters = stride === 1 ? 900 : 500;
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < M; i++) {
          const a = (i - stride + M) % M, b = (i + stride) % M;
          const a2 = (i - 2 * stride + 2 * M) % M, b2 = (i + 2 * stride) % M;
          const tx = (4 * (px(a) + px(b)) - px(a2) - px(b2)) / 6;
          const tz = (4 * (pz(a) + pz(b)) - pz(a2) - pz(b2)) / 6;
          const du = (tx - px(i)) * nx[i] + (tz - pz(i)) * nz[i];
          U[i] = clamp(U[i] + du * 0.9, U_LO, U_HI);
        }
      }
    }
    // curvature of the line + its own length per sample
    const K = new Float64Array(M), SEG = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const a = (i - 2 + M) % M, b = (i + 2) % M, j = (i + 1) % M;
      const ax = cx[a] + nx[a] * U[a], az = cz[a] + nz[a] * U[a];
      const px = cx[i] + nx[i] * U[i], pz = cz[i] + nz[i] * U[i];
      const bx = cx[b] + nx[b] * U[b], bz = cz[b] + nz[b] * U[b];
      const d1x = px - ax, d1z = pz - az, d2x = bx - px, d2z = bz - pz;
      const cross = d1x * d2z - d1z * d2x;        // x east, z south: a LEFT turn is negative here
      const la = Math.hypot(d1x, d1z), lb = Math.hypot(d2x, d2z), lc = Math.hypot(bx - ax, bz - az);
      K[i] = -2 * cross / (la * lb * lc || 1);
      SEG[i] = Math.hypot(cx[j] + nx[j] * U[j] - px, cz[j] + nz[j] * U[j] - pz);
    }
    // smooth curvature a little (the relaxation leaves sample noise)
    const K2 = new Float64Array(M);
    for (let i = 0; i < M; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += K[(i + j + M) % M]; K2[i] = s / 7; }

    // cornering limit
    /* The tyre's mu falls with load, and a 24 deg bank at speed loads the car
       to ~2.3 g, so the planner asks physics.gripAt(normal load) instead of
       assuming one friction number: fixed point on v. */
    const m = spec.mass, kA = 0.5 * physics.RHO * spec.cla / m, VTOP = 90;
    const muAt = (i, v) => {
      const k = Math.abs(K2[i]), b = K2[i] >= 0 ? bank[i] : -bank[i];
      const nG = Math.max(0.2, Math.cos(b) + v * v * k * Math.sin(b) / G + kA * v * v / G);   // normal load in g
      return physics.gripAt(nG);
    };
    const VLIM = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const k = Math.abs(K2[i]), b = K2[i] >= 0 ? bank[i] : -bank[i];
      const cb = Math.cos(b), sb = Math.sin(b);
      let v = 50;
      for (let it = 0; it < 12; it++) {
        const mu = muAt(i, v);
        const den = k * (cb - mu * sb) - mu * kA;
        v = den <= 1e-6 ? VTOP : Math.min(VTOP, Math.sqrt(G * (sb + mu * cb) / den));
      }
      VLIM[i] = v;
    }
    function latUse(i, v) {
      const k = Math.abs(K2[i]), b = K2[i] >= 0 ? bank[i] : -bank[i];
      const need = Math.abs(v * v * k * Math.cos(b) - G * Math.sin(b));
      const have = muAt(i, v) * (G * Math.cos(b) + v * v * k * Math.sin(b) + kA * v * v);
      return clamp(need / have, 0, 1);
    }
    // forward (engine) and backward (brakes) passes, twice round the loop
    const V = Float64Array.from(VLIM);
    for (let lapPass = 0; lapPass < 3; lapPass++) {
      for (let i0 = 0; i0 < M; i0++) {
        const i = i0, j = (i + 1) % M, v = V[i];
        const q = 0.5 * physics.RHO * v * v;
        const lu = latUse(i, v);
        const grip = muAt(i, v) * (m * G + q * spec.cla) * Math.sqrt(1 - lu * lu);
        const a = (Math.min(physics.maxDriveForce(v) * 0.97, grip) - q * spec.cda - spec.crr * m * G) / m;
        V[j] = Math.min(V[j], Math.sqrt(Math.max(0, v * v + 2 * a * SEG[i])));
      }
      for (let i0 = M - 1; i0 >= 0; i0--) {
        const i = i0, j = (i + 1) % M, v = V[j];
        const lu = latUse(j, v);
        const a = physics.brakeDecel(v) * Math.sqrt(1 - lu * lu) * 0.97;
        V[i] = Math.min(V[i], Math.sqrt(v * v + 2 * a * SEG[i]));
      }
    }
    PLAN = { M, ds, U, K: K2, V, VLIM, bank };
    return PLAN;
  }

  function sample(arr, s) {
    const f = core.wrapS(s) / PLAN.ds;
    const i = Math.floor(f) % PLAN.M, j = (i + 1) % PLAN.M, a = f - Math.floor(f);
    return arr[i] * (1 - a) + arr[j] * a;
  }
  const lineU = (s) => sample(PLAN.U, s);
  // clamp with a 1 m easing band at each bound: the path never kinks into a limit,
  // so a car following it never arrives at the wall pointing outward
  function softClamp(u, lo, hi) {
    if (hi - lo < 2) return clamp(u, lo, hi);
    if (u > hi - 1) return hi - 1 + Math.tanh(u - (hi - 1));
    if (u < lo + 1) return lo + 1 - Math.tanh(lo + 1 - u);
    return u;
  }
  const lineV = (s) => sample(PLAN.V, s);

  // ---- rng -----------------------------------------------------------------
  function rng(seed) {
    let t = (seed >>> 0) || 1;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- a driver ------------------------------------------------------------
  const _fr = {}, _tp = {};

  function create(car, opts) {
    if (!PLAN) buildPlan();
    opts = opts || {};
    const skill = clamp(opts.skill == null ? 0.8 : opts.skill, 0, 1);
    const aggression = clamp(opts.aggression == null ? 0.5 : opts.aggression, 0, 1);
    const drv = {
      car, skill, aggression, rand: rng(opts.seed == null ? car.id * 7919 + 17 : opts.seed),
      pace: opts.pace == null ? paceOf(skill) : opts.pace,   // fraction of the limit speed
      laneU: car.u, w: 0, passSide: 0, passT: 0, gridU: car.u,
      mistake: null, mistakeT: 0,
      recover: 0, revT: 0, stuckT: 0, t: 0,
      input: { steer: 0, throttle: 0, brake: 0 },
      rb: 0, state: "race",
      cruise: 1,            // the game sets ~0.7 after the flag: a cool-down lap that stays out of the way
      yellow: 0,            // the caution's pace cap (race_session), 0 = green
      drive(c, cars, dt) { return driveOne(this, c || this.car, cars || [], dt); },
    };
    return drv;
  }

  /* skill → pace (fraction of the planner's limit speed). Measured alone, clean
     (tools/race-check-physics.mjs): 0.95-0.975 → 14.02 s (the plateau: past it
     the car slides and loses what it gains), 0.94 → 14.10, 0.86 → 14.98,
     0.84 → 15.32. skill 1 = PACE_MAX, skill 0.45 = 0.85: ~1.1 s a lap. */
  const PACE_MAX = 0.96;
  function paceOf(skill) { return PACE_MAX - (1 - skill) * 0.20; }

  function driveOne(d, car, cars, dt) {
    const inp = d.input;
    d.t += dt;
    const v = car.speed;
    const fr = core.frame(car.s, _fr);
    const fwdx = Math.sin(car.yaw), fwdz = Math.cos(car.yaw);
    // heading error vs the race direction (+ = nose pointing left of the tangent / toward the infield)
    const cosE = fwdx * fr.tx + fwdz * fr.tz;
    const sinE = -(fwdx * fr.nx + fwdz * fr.nz);
    const headErr = Math.atan2(sinE, cosE);

    // ---- recovery -------------------------------------------------------
    if (d.state === "race") {
      if (Math.abs(headErr) > 1.25 || v < -1) { d.state = "recover"; d.recover = 0; }
      // stuck = asking for power and not moving (so a car held on the grid never trips it)
      else if (v < 2 && d.input.throttle > 0.4) { d.stuckT += dt; if (d.stuckT > 1.2) { d.state = "recover"; d.recover = 0; } }
      else d.stuckT = 0;
    }
    if (d.state === "recover") return recover(d, car, cars, dt, headErr);

    // ---- mistakes ---------------------------------------------------------
    if (d.mistake) { d.mistakeT -= dt; if (d.mistakeT <= 0) d.mistake = null; }
    else if (d.rand() < dt * (0.004 + 0.035 * (1 - d.skill) * (1 - d.skill))) {
      const r = d.rand();
      d.mistake = r < 0.3 ? "late" : r < 0.55 ? "lift" : r < 0.8 ? "wide" : "wiggle";
      d.mistakeT = d.mistake === "late" ? 2.5 : d.mistake === "wide" ? 1.6 : d.mistake === "lift" ? 0.5 : 0.8;
      d.wigPhase = d.rand() * 6.28;
    }

    // ---- rubber band -------------------------------------------------------
    d.rb = 0;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o.isPlayer && o !== car) { d.rb = clamp((o.lapS - car.lapS) / 200, -1, 1) * 0.03; break; }
    }
    // pace applies to the speed profile; the limit is 1.0
    let pace = Math.min(PACE_MAX + 0.01, d.pace * (1 + d.rb)) * d.cruise;
    if (d.mistake === "late") pace = Math.min(1.04, pace * 1.045);   // overdriving: the one way past the limit
    // damage slows a sensible driver down
    pace *= 1 - 0.05 * car.damage.aero;
    // under the caution (race_session: somebody on the track) everybody backs off
    if (d.yellow > 0) pace = Math.min(pace, d.yellow);

    // ---- racecraft: where do I want to be across the track -----------------
    /* The path is a blend of the racing line and an absolute LANE (a groove at
       constant height on the banking): pathU(s) = mix(lineU(s), laneU, w).
       Passing, defending and running wide set the lane and push w to 1; with
       nothing to do w decays and the car flows back onto the line. A lane is
       absolute on purpose: an offset riding the line would swing the car into
       the wall on exit where the line itself climbs to the top. */
    let uMin = D.INNER + 1.1, uMax = D.WALL_U - 2.0;
    let vCap = Infinity, flinch = 0, roomUp = false;
    const myUdot = car.vel.x * fr.nx + car.vel.z * fr.nz;
    // below the racing surface (apron, grass, behind the pit wall): climb back gently
    const behindPitWall = pitSide(car);
    if (behindPitWall) { uMin = PIT.u - PIT.w / 2 + 1.2; uMax = PIT.wallU - 1.4; }
    else if (car.u < D.INNER + 1.1) uMin = car.u - 1;
    let ahead = null, aheadGap = 1e9;
    let threat = null, threatGap = -1e9;
    const plannedU = (s) => softClamp(lineU(s) * (1 - d.w) + d.laneU * d.w, uMin, uMax);
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === car) continue;
      const gap = core.ds(car.s, o.s);                  // + = o ahead
      // lateral gap now and 0.4 s from now (on corner exit the line climbs ~10 m/s: now is too late)
      const duNow = o.u - car.u;
      const duSoon = duNow + (o.vel.x * fr.nx + o.vel.z * fr.nz - myUdot) * 0.4;
      const du = Math.abs(duSoon) < Math.abs(duNow) && sgn(duSoon) === sgn(duNow) ? duSoon : duNow;
      // overlapping (or about to): give room (hard)
      if (Math.abs(gap) < 6.0 + Math.max(0, v - o.speed) * 0.4 && Math.abs(du) < 3.8) {
        if (du > 0) { uMax = Math.min(uMax, o.u - ROOM); roomUp = true; } else uMin = Math.max(uMin, o.u + ROOM);
        // flinch: already closer than a car's width plus a hand → ease away now
        const c = ROOM - Math.abs(du);
        if (c > 0) flinch += (du > 0 ? -1 : 1) * c;
      }
      // a crawling / spun car is seen from much further (a stopped car needs ~80 m at 50 m/s)
      const slow = o.speed < 25;
      if (gap > 0 && gap < (slow ? 130 : 45) && Math.abs(plannedU(o.s) - o.u) < (slow ? 3.6 : 2.4) && gap < aheadGap) { ahead = o; aheadGap = gap; }
      if (gap < -4.8 && gap > -18 && o.speed > v - 1 && gap > threatGap) { threat = o; threatGap = gap; }
    }
    if (uMin > uMax) { const mid = (uMin + uMax) / 2; uMin = uMax = mid; }

    let laneT = null;
    if (d.mistake === "wide") laneT = car.u + 2.5;
    // the start: hold your column until the field has strung out into turn 1
    if (car.lapS < 110 && car.lap === 0) { laneT = d.gridU; d.w = 1; }
    if (behindPitWall) laneT = PIT.fastU;
    else if (car.u < D.INNER - 0.5) laneT = car.u + 2.5;
    if (ahead) {
      const vMine = lineV(ahead.s) * pace;
      const closing = v - ahead.speed;
      const wantsPass = vMine > ahead.speed + 0.4 || ahead.speed < 30 || closing > 1.5;
      const tooClose = aheadGap - 5 < 5 + Math.max(0, closing) * 1.2;   // the draft has closed the gap: pull out now
      if (wantsPass && (tooClose || d.passSide !== 0 || ahead.speed < 30)) {
        const side = chooseSide(d, car, ahead, cars, uMin, uMax);
        if (side !== 0) { d.passSide = side; d.passT = 2.5; laneT = ahead.u + side * passRoom(ahead); }
      }
      // not passing and it sits just ahead, a little above or below: hold my side of it
      // instead of following the line into its door
      if (laneT == null && aheadGap < 9 && Math.abs(ahead.u - car.u) > 1.0) {
        laneT = ahead.u > car.u ? Math.min(car.u + 0.3, ahead.u - ROOM) : Math.max(car.u - 0.3, ahead.u + ROOM);
      }
      if (Math.abs(ahead.u - car.u) < (ahead.speed < 25 ? 3.6 : 2.4)) {
        // still in its lane: never faster than I could stop to its speed a car length behind it
        const room = Math.max(0, aheadGap - 4.9 - 2.5);
        vCap = Math.min(vCap, Math.sqrt(Math.max(0, ahead.speed) ** 2 + 2 * 9 * room) - 0.3);
      }
    }
    if (d.passT > 0) { d.passT -= dt; if (d.passT <= 0) d.passSide = 0; }
    if (laneT == null && d.passSide !== 0) laneT = d.laneU;           // hold the lane until clear
    // defend: a car closing behind to the inside, not yet alongside → take the inside away
    // only while the attacker is still more than a car length back: once its nose is
    // near my bumper the move is over and I hold my lane (a late block is a wreck)
    if (laneT == null && threat && d.aggression > 0.25 && threat.u < car.u - 1.2) {
      // squeeze, never chop: cover the inside but leave the attacker its own lane below
      laneT = threatGap < -9 ? Math.max(threat.u + ROOM + 0.3, car.u - 2.5 * d.aggression) : d.laneU;
      if (threatGap >= -9 && d.w < 0.5) laneT = null;
    }
    const rate = 2.2 + d.aggression * 1.3;                            // m/s the lane may move
    // the blend weight moves no faster than the lane rate in metres: a lane 6 m off the
    // line fades in over ~2 s, never as a 5 m step that would snap the car sideways
    const wRate = (r) => dt * Math.min(r, rate / Math.max(0.5, Math.abs(d.laneU - lineU(car.s))));
    if (laneT != null) {
      d.laneU += clamp(laneT - d.laneU, -rate * dt, rate * dt);
      d.w = Math.min(1, d.w + wRate(2.5));
    } else {
      d.laneU += clamp(car.u - d.laneU, -rate * dt, rate * dt);       // a free lane follows me: no snap when the weight fades
      d.w = Math.max(0, d.w - wRate(0.7));
    }

    // ---- steer: path-following (feed-forward curvature + Stanley heading/cross-track) ----
    /* Pure pursuit overshoots the swing from the bottom groove up to the wall
       on exit (it aims at a point, arrives pointing outward). This follows the
       PATH: the line's curvature as feed-forward, the heading error to the
       path's own direction (the line's slope du/ds), and the cross-track error
       through atan(k e / v), plus yaw-rate feedback, which is also what
       counter-steers a stepping rear. */
    const sp = car.spec;
    const pathU = plannedU;
    const uP = pathU(car.s);
    const slope = (pathU(car.s + 3) - pathU(car.s - 3)) / 6;          // du/ds, + = heading outward (right)
    const kFF = sample(PLAN.K, car.s + Math.max(v, 0) * 0.12);
    const kC = fr.k;
    const kappa = kFF * (1 - d.w) + d.w * kC / Math.max(0.5, 1 + kC * d.laneU);   // a lane is a constant-height arc
    const psiErr = -Math.atan(slope) - headErr;                         // + = the path wants the nose further left
    const eCT = car.u - uP;                                             // + = I am outside (right) of the path
    let delta = Math.atan(sp.wb * kappa) + kappa * v * v / G * 0.010
      + psiErr * 0.9
      + Math.atan(1.6 * eCT / (Math.abs(v) + 6))
      + (kappa * v - car.yawRate) * (0.05 + 0.06 * clamp((v - 20) / 30, 0, 1));
    // a driver never asks the fronts for more than their peak slip angle: steering past it
    // only slides them (the pursuit loop would wind on lock as the car runs wide)
    const vfw = Math.max(Math.abs(v), 5);
    const aF = sp.wb * (1 - sp.frontW);
    const betaF = Math.atan2(car.latSpeed + aF * car.yawRate, vfw);
    const aMax = physics.slipPeak() * 1.05;
    if (v > 8) delta = clamp(delta, betaF - aMax, betaF + aMax);
    let steer = clamp(delta / sp.maxSteer, -1, 1);
    // the wall: steer down off it before the body touches (steer + = left = toward -u)
    if (D.WALL_U - 1.0 - car.u < 0.9 && v > 8) steer += clamp((0.9 - (D.WALL_U - 1.0 - car.u)) * 0.12, 0, 0.12);
    // flinch away from a car that is too close alongside
    if (flinch !== 0) steer += clamp(-flinch * 0.10, -0.15, 0.15) * (v > 20 ? 1 : 0.5);
    if (d.mistake === "wiggle") steer += Math.sin(d.t * 9 + d.wigPhase) * 0.10;
    steer += (d.rand() - 0.5) * 0.02 * (1 - d.skill);

    // ---- speed --------------------------------------------------------------
    let vt = lineV(car.s + Math.max(v, 0) * 0.15) * pace;
    // running wide of where I meant to be: lift until the nose comes back
    // a car alongside on my outside: if I am drifting up toward it, lift until I can hold my lane
    if (roomUp && car.u > uMax - 0.6) vt = Math.min(vt, v - 1 - 2 * (car.u - (uMax - 0.6)));
    const wideErr = car.u - pathU(car.s);
    if (wideErr > 0.8) vt -= (wideErr - 0.8) * 2.5;
    // the wall: a car that is drifting up into it lifts
    const wallGap = D.WALL_U - 1.0 - car.u;                        // m between my flank and the wall face
    if (wallGap < 0.9) vt -= (0.9 - wallGap) * 4;
    vt = Math.min(vt, vCap);
    let thr = 0, brk = 0;
    const e = vt - v;
    if (e < -0.5) { brk = clamp(-e * 0.22 + 0.15, 0, 1); }
    else thr = clamp(0.35 + e * 0.5, 0, 1);
    if (d.mistake === "lift") thr = Math.min(thr, 0.25);
    if (d.mistake === "late") brk *= 0.6;
    // don't power on while the rear is already gone
    const rearSlip = Math.max(car.wheels[2].slip, car.wheels[3].slip);
    if (rearSlip > 0.5) thr *= 0.5;

    inp.steer = clamp(steer, -1, 1); inp.throttle = thr; inp.brake = brk;
    return inp;
  }

  // true when the car is on the pit-road side of the pit wall
  function pitSide(car) {
    const sd = core.ds(0, car.s);
    return car.u < PIT.wallU && sd > PIT.s0 - 3 && sd < PIT.s1;
  }

  // a crawling or sideways car takes more room than one at speed
  function passRoom(o) { return o.speed < 25 ? 4.5 : 3.2; }

  function chooseSide(d, car, ahead, cars, uMin, uMax) {
    const loBound = D.INNER + 1.1, hiBound = D.WALL_U - 2.0;
    const cand = [];
    for (const side of [1, -1]) {
      const u = ahead.u + side * passRoom(ahead);
      if (u < loBound || u > hiBound) continue;
      if (u < uMin - 0.2 || u > uMax + 0.2) continue;
      let blocked = false;
      for (let i = 0; i < cars.length; i++) {
        const o = cars[i];
        if (o === car || o === ahead) continue;
        const g = core.ds(car.s, o.s);
        if (g > -6 && g < 18 && Math.abs(o.u - u) < ROOM - 0.3) { blocked = true; break; }
        // and nobody in the way while I cross to it
        const lo = Math.min(car.u, u) - ROOM * 0.75, hi = Math.max(car.u, u) + ROOM * 0.75;
        if (g > -5.5 && g < 14 && o.u > lo && o.u < hi) { blocked = true; break; }
      }
      if (blocked) continue;
      let cost = Math.abs(u - lineU(car.s));
      if (side === d.passSide) cost -= 4;                  // commitment
      if (side === -1) cost -= 0.8 * d.aggression;         // the bottom is the shorter way round
      cand.push([cost, side]);
    }
    if (!cand.length) return 0;
    cand.sort((a, b) => a[0] - b[0]);
    return cand[0][1];
  }

  function recover(d, car, cars, dt, headErr) {
    const inp = d.input;
    d.recover += dt;
    const v = car.speed;
    inp.throttle = 0; inp.brake = 0; inp.steer = 0;
    const pointedOut = headErr < -0.9 && car.u > D.WALL_U - 3;       // nose into the wall
    const backing = d.revT > 0;
    if (backing) {
      d.revT -= dt;
      inp.brake = 1;                                                // stopped + brake = reverse
      inp.steer = clamp(headErr * 2, -1, 1);                        // reversing: steer toward the error swings the nose back
      if (Math.abs(headErr) < 0.5) d.revT = 0;
      return inp;
    }
    if (Math.abs(headErr) > 1.9 || pointedOut || (Math.abs(v) < 1.5 && d.recover > 2.5 && Math.abs(headErr) > 0.6)) {
      // stop first (in reverse gear the throttle pedal is the brake)
      if (v > 1.5) { inp.brake = 1; return inp; }
      if (v < -1.5) { inp.throttle = 0.6; return inp; }
      d.revT = 1.6; d.recover = 0; inp.brake = 1; return inp;
    }
    // pointed roughly right: steer back to the race direction, low line, wait for a gap
    let wait = false;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === car) continue;
      const g = core.ds(car.s, o.s);
      if (g < 0 && g > -35 && Math.abs(o.u - car.u) < 3 && o.speed > v + 8) { wait = true; break; }
    }
    // a spun car gets down out of the groove: the apron, then rejoin from the bottom
    const tgtU = pitSide(car) ? PIT.fastU : D.INNER - 2.5;
    const Ld = 10 + Math.max(v, 0) * 0.3;
    core.toWorld(car.s + Ld, clamp(tgtU, car.u - 6, car.u + 4), 0, _tp);
    const dx = _tp.x - car.pos.x, dz = _tp.z - car.pos.z;
    const lx = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
    const kappa = 2 * lx / Math.max(dx * dx + dz * dz, 1);
    inp.steer = clamp(Math.atan(car.spec.wb * kappa) / car.spec.maxSteer, -1, 1);
    if (wait && v < 10) { inp.brake = 0.4; }
    else inp.throttle = v < 25 ? 0.6 : 0.3;
    if (Math.abs(headErr) < 0.25 && (v > 25 || (v > 12 && car.u < D.INNER))) { d.state = "race"; d.stuckT = 0; d.laneU = car.u; d.w = 1; }
    if (d.recover > 12) { d.state = "race"; d.stuckT = 0; }
    return inp;
  }

  /* field(n, seed) → n driver presets, fastest first, spread so the field
     covers ~1.0-1.5 s a lap. */
  function field(n, seed) {
    const r = rng(seed == null ? 12345 : seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      const skill = clamp(1.0 - f * 0.55 + (r() - 0.5) * 0.04, 0.3, 1);
      out.push({ skill, aggression: clamp(0.25 + r() * 0.7, 0, 1), seed: (r() * 1e9) | 0 });
    }
    return out;
  }

  const ai = {
    create, field, paceOf, buildPlan,
    plan() { return PLAN || buildPlan(); },
    lineU(s) { if (!PLAN) buildPlan(); return lineU(s); },
    lineV(s) { if (!PLAN) buildPlan(); return lineV(s); },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ai;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.ai = ai;
  }
})(typeof window !== "undefined" ? window : null);
