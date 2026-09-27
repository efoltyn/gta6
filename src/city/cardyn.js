/* ============================================================
   city/cardyn.js — THE CHASSIS: tyres, gearbox, suspension.

   A PURE module: no THREE, no scene, no CBZ reads inside the step. It is
   loaded in the browser by a <script> tag (before vehicles.js) and in node
   by require(), which is how tools/car-dyn-sim.mjs drives scripted
   manoeuvres (0-60, 60-0, skid-pad roll, handbrake drift, countersteer
   catch) against it and prints numbers you can hold against real cars.

   WHAT IT REPLACES. The driven car used to be a stack of arcade
   multipliers: forward speed integrated on its own, heading turned by a
   clamped bicycle yaw that ignored the tyres entirely, sideways velocity
   "bled" by a grip factor, drift made by multiplying lateral slip by 0.93
   while SPACE was held, and the body lean an exponential chase of a
   steering-key-shaped target. None of it could understeer, none of it
   could snap, and a skid was whatever a timer said it was.

   WHAT IT IS NOW. A planar two-axle ("bicycle") model with real state
   (forward speed vx, lateral speed vy, yaw rate r) integrated at 120 Hz:
     - each axle has a load (static weight split + longitudinal load
       transfer through the CG height), a friction budget mu*Fz, and a
       slip-angle tyre curve that rises to a peak and falls to a sliding
       value — so grip is real, sliding is real, and recovery is real;
     - FRICTION CIRCLE: drive/brake force on an axle spends the same budget
       its cornering force needs, so power oversteers a RWD car, braking in
       a corner washes the nose out, and a spinning tyre holds a drift;
     - HANDBRAKE locks the rear: the rear then slides at HB_SLIDE of its
       peak, opposite its own patch velocity — the tail comes round because
       the physics says so, not because a flag said "drift";
     - an automatic 5-speed with torque cut on the upshift, clutch slip off
       the line and wheelspin, whose rpm is what the engine voice sings;
     - a per-car SPRING-DAMPER body (pitch / roll / heave) driven by the
       specific forces the tyres just produced — nose dives under braking,
       squats on launch, rolls OUT of the corner, overshoots and settles.
   ============================================================ */
(function (root) {
  "use strict";
  const G = 9.81;

  // ---- TUNING — one line of why each ------------------------------------
  const SUBSTEP = 1 / 120;          // tyre forces are stiff; 120 Hz explicit steps stay stable even when a frame is 0.2 s
  const MAX_SUBSTEPS = 12;          // a 0.1 s hitch still integrates; a longer one is clamped rather than exploding
  const MU_BASE = 0.50, MU_SLOPE = 0.05; // carDynamics' arcade grip (≈2.5..11) -> peak friction 0.63 g (semi) .. 1.05 g (super)
  const FRONT_BIAS = 0.87;          // front axle ~10% weaker than the rear: road cars leave the factory understeering, so a lift never spins them
  const REAR_DRIFT_K = 0.12;        // rear grip lost per unit of FEEL 'drift' above 1: loose-tailed classes, still stable on a lift
  const UNDER_K = 0.28;             // extra front weakness per unit of soft 'roll' above a sedan: tall and heavy pushes wide
  const SLIDE_RATIO = 0.80;         // sliding friction / peak: a lit tyre keeps 80%, so drifts hold and spins are catchable
  const SPIN_KEEP = 0.88;          // a spinning drive tyre still pushes at 88% of peak (real tyres: ~0.8-0.9 at full slip)
  const MU_LONG = 1.12;             // tyres grip ~10% harder in line than sideways (longitudinal vs lateral peak)
  const SLIDE_SPAN = 1.6;           // slip past the peak (in peak units) over which grip falls to the sliding value
  const V_EPS = 3.0;                // m/s floor in the slip-angle denominator: no parking-lot singularity
  const KIN_V0 = 1.0, KIN_V1 = 4.0; // below V0 the car turns on pure wheelbase geometry, above V1 purely on its tyres
  const LOAD_XFER = 0.75;           // share of textbook longitudinal load transfer the tyres see (the rest is soaked by anti-dive/anti-squat links)
  const IZ_K = 1.0;                 // yaw inertia = IZ_K*m*a*b — the textbook 'dynamic index' of a car is ~1
  const ENGINE_K = 0.30;            // carDynamics' arcade accel (≈14..55) -> 1st-gear peak drive accel in m/s^2
  const GEAR_EXP = 0.4;             // drive falls with gear as (top1/topN)^EXP — between constant torque (0) and constant power (1)
  const SHIFT_CUT = 0.14;           // s of torque cut on an upshift — the dip you feel in your back and hear in the note
  const BRAKE_K = 0.34;             // arcade brake (15..38) -> demand m/s^2: tyre-limited for cars, brake-limited for trucks
  const BRAKE_BIAS = 0.66;          // front share of brake force, as on every road car
  const ABS_STEER = 0.40;           // ABS keeps at least this share of cornering grip under full braking
  const HB_SLIDE = 0.72;            // a locked rear slides at this share of its peak
  const ROLL_RES = 0.16;            // m/s^2 rolling resistance
  const ENGINE_BRAKE = 0.75;        // m/s^2 of engine braking off-throttle at the redline (scales with rpm)
  const REV_DRIVE = 0.6;            // reverse gear pulls at this share of 1st
  const REV_MAX = 13;               // m/s — the old reverse cap, kept (crash/runover thresholds were tuned around it)
  const STEER_RATE_LO = 4.5;        // input units / s at parking speed: 0.22 s lock to centre
  const STEER_RATE_HI = 2.0;        // at motorway speed the wheel is slower — no twitch lane changes
  const STEER_RETURN = 6.5;         // self-centring rate when the key is released (caster)
  const AY_FLOOR = 0.6;             // share of the limit the speed-lock always offers, before the car has loaded up
  const STEER_ASSIST = 1.1;         // front wheels may point this many peak-slips past the front axle's travel: full lock = the limit
  const IDLE_REV = 0.12;            // rpm fraction at idle
  const LAUNCH_REV = 0.55;          // clutch-slip rpm fraction with the throttle pinned at a standstill
  const CLUTCH_REV = 0.34;          // below this rpm fraction in 1st the clutch slips (the engine never stalls)

  // ---- THE GEARBOX (moved here from vehicles.js — one owner) ------------
  // top-of-gear points as fractions of the car's own top speed.
  const GEAR_TOP = [0.14, 0.30, 0.50, 0.74, 1.01];
  // per-gear torque band [revFrac, mul] (revFrac = this gear's own 0..1 band):
  // 1st bites off idle, middle gears hump, top is long and flat. modshop.js
  // Stage N reshapes a COPY of this (car._perfGearTorque).
  const GEAR_TORQUE = [
    [[0, 0.62], [0.18, 1.0], [0.55, 0.96], [1, 0.74]],
    [[0, 0.7], [0.3, 1.0], [0.65, 0.92], [1, 0.7]],
    [[0, 0.68], [0.35, 0.97], [0.7, 0.88], [1, 0.66]],
    [[0, 0.64], [0.4, 0.92], [0.75, 0.82], [1, 0.62]],
    [[0, 0.6], [0.45, 0.84], [0.8, 0.76], [1, 0.58]],
  ];
  function lerpCurve(curve, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 1; i < curve.length; i++) {
      if (t <= curve[i][0]) {
        const a = curve[i - 1], b = curve[i], span = b[0] - a[0];
        return a[1] + (b[1] - a[1]) * (span > 1e-5 ? (t - a[0]) / span : 0);
      }
    }
    return curve[curve.length - 1][1];
  }
  function bandFrac(gear, sN) {
    const lo = gear === 0 ? 0 : GEAR_TOP[gear - 1];
    const f = (sN - lo) / Math.max(0.05, GEAR_TOP[gear] - lo);
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }
  const _gf = { gear: 0, revFrac: 0 };
  function gearFor(sN) {
    let gear = 0; while (gear < GEAR_TOP.length - 1 && sN >= GEAR_TOP[gear]) gear++;
    _gf.gear = gear; _gf.revFrac = bandFrac(gear, sN);
    return _gf;
  }
  const gearMul = GEAR_TOP.map(function (t) { return Math.pow(GEAR_TOP[0] / t, GEAR_EXP); });

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---- CLASS TABLE: what the arcade numbers can't say ---------------------
  // wf = front weight fraction; drive = front share of drive torque
  // (1 FWD, 0 RWD, between = AWD split). Class = playercars FEEL class for the
  // driven car, else vehicles.js's bodyKind.
  const CLASS = {
    super:    { wf: 0.43, drive: 0.30 },   // mid-engine, rear-biased AWD
    sports:   { wf: 0.46, drive: 0.15 },
    coupe:    { wf: 0.48, drive: 0.15 },
    muscle:   { wf: 0.53, drive: 0.0 },    // nose-heavy V8, all the torque at the back: the tail steps out
    lowrider: { wf: 0.55, drive: 0.0 },
    sedan:    { wf: 0.58, drive: 0.55 },
    compact:  { wf: 0.62, drive: 1.0 },    // FWD hatch: pushes wide, never power-oversteers
    hatch:    { wf: 0.62, drive: 1.0 },
    suv:      { wf: 0.54, drive: 0.45 },
    pickup:   { wf: 0.57, drive: 0.0 },
    van:      { wf: 0.55, drive: 0.0 },
    semi:     { wf: 0.45, drive: 0.0 },
    motorcycle: { wf: 0.48, drive: 0.0 },
  };
  const CLASS_DEF = { wf: 0.56, drive: 0.5 };

  // Build (into `out`, no allocation) the physical parameters for a car from
  // carDynamics()'s record D and a class key. Cheap enough to run per frame.
  function params(D, kind, out) {
    const P = out || {};
    const C = CLASS[kind] || CLASS_DEF;
    const roll = D.roll == null ? 0.6 : Math.max(0.3, D.roll);
    const drift = D.drift || 1;
    const L = Math.max(1.6, D.wheelbase || 2.62);
    P.L = L; P.wf = C.wf; P.drive = C.drive;
    P.a = L * (1 - C.wf);                // CG -> front axle
    P.b = L * C.wf;                      // CG -> rear axle
    P.h = 0.40 + 0.30 * roll;            // CG height: the soft cars ARE the tall ones
    P.k2 = IZ_K * P.a * P.b;             // yaw radius of gyration squared
    const surf = D.surfMul == null ? 1 : Math.max(0.2, D.surfMul);
    const baseGrip = (D.grip || 7) / surf;
    P.mu = G * (MU_BASE + MU_SLOPE * baseGrip) * surf;   // peak friction, m/s^2
    P.fBias = FRONT_BIAS * (1 - UNDER_K * Math.max(0, roll - 0.6));
    P.rBias = clamp(1 - REAR_DRIFT_K * (drift - 1), 0.85, 1.08);   // FEEL drift 1.35 (muscle) -> rear 0.96: loose, not a spinner
    const turnMul = clamp((D.turn || 2.6) / 2.6, 0.4, 1.7);
    P.alphaPeak = (0.085 + 0.035 * roll) / Math.sqrt(turnMul);   // stiff sidewalls peak early
    P.steerLock = D.steerLock || 0.56;
    P.steerRate = Math.sqrt(turnMul);
    P.top = Math.max(5, D.top || 35);
    P.engine = ENGINE_K * Math.max(1, D.accel || 30);
    P.brake = BRAKE_K * Math.max(1, D.brake || 30);
    // aero drag sized so the engine's top-gear pull meets it at exactly D.top:
    // the top speed emerges from the physics and lands where carDynamics says.
    const topPull = P.engine * gearMul[4] * lerpCurve(GEAR_TORQUE[4], bandFrac(4, 1)) - ROLL_RES;
    P.cd = Math.max(0.0002, topPull / (P.top * P.top));
    P.torque = D.torqueTable || GEAR_TORQUE;
    // ---- body spring-damper, from the same 'roll' softness number --------
    const hz = clamp(2.4 - 0.9 * roll, 0.9, 2.3);
    const zeta = clamp(0.55 - 0.15 * roll, 0.28, 0.55);
    P.wR = 2 * Math.PI * hz; P.zR = zeta;
    P.wP = 2 * Math.PI * hz * 1.15; P.zP = zeta + 0.05;   // pitch a touch stiffer (anti-dive geometry)
    P.wH = 2 * Math.PI * hz * 1.3; P.zH = zeta;
    P.rollGrad = (3.6 * roll / 0.6) * Math.PI / 180;       // rad per g: sedan 3.6°/g, super 2.4, SUV 6.9, van 7.8
    P.pitchGrad = (1.8 * Math.pow(roll / 0.6, 0.7)) * Math.PI / 180;  // rad per g of dive/squat
    P.maxRoll = 0.14; P.maxPitch = 0.09;
    return P;
  }

  function newState() {
    return {
      vx: 0, vy: 0, r: 0, steer: 0, delta: 0, gear: 0, rpm: IDLE_REV, shiftT: 0, shifted: false,
      axF: 0, ax: 0, ay: 0, alphaF: 0, alphaR: 0, sF: 0, sR: 0, wsF: 0, wsR: 0,
      hbSlide: 0, brakeSatF: 0, brakeSatR: 0, skid: 0, skidF: 0, skidR: 0, squeal: 0, beta: 0,
      heading: 0, throttleOut: 0, braking: false, reversing: false,
    };
  }

  // tyre lateral force shape, in units of the axle's lateral budget.
  // s = slip / peak slip. Rises (stiffness 2/peak), peaks at s=1, falls to
  // SLIDE_RATIO by s = 1+SLIDE_SPAN.
  function tyreShape(s) {
    const m = s < 0 ? -s : s;
    const f = m <= 1 ? m * (2 - m) : 1 - (1 - SLIDE_RATIO) * Math.min(1, (m - 1) / SLIDE_SPAN);
    return s < 0 ? -f : f;
  }

  // One frame. S = state (mutated), In = { throttle 0..1 (W), brake 0..1 (S),
  // handbrake bool, steer -1..1 target, air bool, flatPull rad bias }, P =
  // params(). Positive steer / positive r / positive vy all mean the car's
  // "+heading" side (this repo: A key).
  function step(S, In, P, dt) {
    if (!(dt > 0)) return S;
    dt = Math.min(dt, SUBSTEP * MAX_SUBSTEPS);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6));
    const h = dt / n;
    const wKey = clamp(In.throttle || 0, 0, 1), sKey = clamp(In.brake || 0, 0, 1);
    const hb = !!In.handbrake, air = !!In.air;

    // ---- steering: eased input, speed-sensitive lock, countersteer room ----
    const spd0 = Math.hypot(S.vx, S.vy);
    const sn = clamp(spd0 / 30, 0, 1);
    const tgt = clamp(In.steer || 0, -1, 1);
    const returning = Math.abs(tgt) < Math.abs(S.steer) && tgt * S.steer >= 0;
    const rate = (returning ? STEER_RETURN : STEER_RATE_LO + (STEER_RATE_HI - STEER_RATE_LO) * sn) * P.steerRate;
    const ds = tgt - S.steer, mx = rate * dt;
    S.steer += ds > mx ? mx : ds < -mx ? -mx : ds;

    // ---- pedals -> drive / brake / reverse intent --------------------------
    // W drives forward, S brakes while rolling forward and reverses once
    // stopped; mirrored while rolling backward. Same contract as before.
    let drive = 0, brake = 0;
    if (S.vx > 0.5) { drive = wKey; brake = sKey; }
    else if (S.vx < -0.5) { drive = -sKey; brake = wKey; }
    else { drive = wKey - sKey; }
    S.braking = brake > 0; S.reversing = drive < 0;
    S.throttleOut = Math.abs(drive);

    // ---- gearbox (once per frame; torque cut runs down in the substeps) ----
    const sN = Math.max(0, S.vx) / P.top;
    let gear = S.gear;
    while (gear < GEAR_TOP.length - 1 && sN >= GEAR_TOP[gear]) gear++;
    while (gear > 0 && sN < GEAR_TOP[gear - 1] * 0.9) gear--;
    S.shifted = gear > S.gear && drive > 0;
    if (S.shifted) S.shiftT = SHIFT_CUT;
    S.gear = gear;
    const torque = lerpCurve(P.torque[Math.min(gear, P.torque.length - 1)], bandFrac(gear, sN));

    let wsF = 0, wsR = 0, satF = 0, satR = 0, hbSl = 0, sFmax = 0, sRmax = 0;
    let axSum = 0, aySum = 0;
    for (let i = 0; i < n; i++) {
      const vx = S.vx, vy = S.vy, r = S.r;
      const avx = vx < 0 ? -vx : vx;
      const sgn = vx >= 0 ? 1 : -1;
      // STEERING ASSIST, the way a real driver's hands work: the front wheels
      // may point at most STEER_ASSIST x peak slip beyond where the front
      // axle is actually travelling. Full lock at speed therefore rides the
      // tyre's peak instead of scrubbing past it — and because it is measured
      // from the front axle's own velocity, the same rule hands you all the
      // opposite lock a slide needs: countersteer follows the drift for free.
      // Below that, a geometric floor (the lock that pulls AY_FLOOR of the
      // limit) keeps low-speed turns crisp; the rack caps everything; reverse
      // gets the full rack.
      const spd = Math.hypot(vx, vy);
      const beta = avx > 0.5 ? Math.atan2(vy, avx) : 0;
      let lockPos = P.steerLock, lockNeg = P.steerLock;
      if (vx > 0) {
        const thF = Math.atan2(vy + P.a * r, Math.max(avx, V_EPS));
        const kA = P.alphaPeak * STEER_ASSIST;
        const floorLock = spd > 1 ? P.L * P.mu * AY_FLOOR / (spd * spd) : 9;
        lockPos = Math.min(P.steerLock, Math.max(floorLock, thF + kA));
        lockNeg = Math.min(P.steerLock, Math.max(floorLock, -thF + kA));
      }
      const delta = (S.steer >= 0 ? S.steer * lockPos : S.steer * lockNeg) + (In.flatPull || 0);
      S.delta = delta; S.beta = beta;
      const cd = Math.cos(delta), sd = Math.sin(delta);

      // ---- loads (per unit mass, m/s^2) with longitudinal transfer --------
      const tr = S.axF * P.h / P.L * LOAD_XFER;
      const FzF = Math.max(0.15 * G, G * P.wf - tr), FzR = Math.max(0.15 * G, G * (1 - P.wf) + tr);
      // longitudinal budget per axle; the class balance (fBias/rBias) is a
      // CORNERING trait, so it scales only the lateral share below
      const capF = air ? 0 : (P.mu / G) * MU_LONG * FzF;
      const capR = air ? 0 : (P.mu / G) * MU_LONG * FzR;
      const latF0 = P.fBias / MU_LONG, latR0 = P.rBias / MU_LONG;

      // ---- longitudinal demand per axle ----------------------------------
      let eng = 0;
      if (drive > 0) eng = drive * P.engine * torque * gearMul[gear] * (S.shiftT > 0 ? 0.1 : 1);
      else if (drive < 0) eng = drive * P.engine * REV_DRIVE * lerpCurve(P.torque[0], avx / REV_MAX);
      if (drive < 0 && vx < -REV_MAX) eng = 0;
      const brk = brake * P.brake;
      let dF = eng * P.drive - brk * BRAKE_BIAS * sgn;
      let dR = eng * (1 - P.drive) - (hb ? 0 : brk * (1 - BRAKE_BIAS) * sgn);
      // engine braking off-throttle, through the driven wheels
      if (drive === 0 && brake === 0 && avx > 1) {
        const eb = ENGINE_BRAKE * S.rpm * sgn;
        dF -= eb * P.drive; dR -= eb * (1 - P.drive);
      }

      // ---- front axle: friction circle + slip curve -----------------------
      let FxF = 0, FyF = 0, FxR = 0, FyR = 0;
      const vfy = vy + P.a * r;
      const vlF = vx * cd + vfy * sd, vtF = -vx * sd + vfy * cd;
      const alphaF = Math.atan2(vtF, Math.max(Math.abs(vlF), V_EPS));
      if (capF > 0) {
        let latCapF = capF;
        if (Math.abs(dF) > capF) {                         // wheelspin (drive) or ABS at the limit (brake)
          const over = (Math.abs(dF) - capF) / capF;
          if (drive !== 0 && Math.sign(dF) === Math.sign(drive)) { wsF = Math.max(wsF, Math.min(1, over)); FxF = Math.sign(dF) * capF * (1 - (1 - SPIN_KEEP) * Math.min(1, over)); }
          else { satF = Math.max(satF, Math.min(1, 0.5 + over)); FxF = Math.sign(dF) * capF * 0.97; }
        } else FxF = dF;
        latCapF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF));
        if (brk > 0) latCapF = Math.max(latCapF, ABS_STEER * capF);
        if (wsF > 0) latCapF = Math.min(latCapF, capF * 0.6);      // a lit tyre has little left for cornering
        latCapF *= latF0;
        const s = alphaF / P.alphaPeak;
        if (Math.abs(s) > sFmax) sFmax = Math.abs(s);
        FyF = -latCapF * tyreShape(s);
      }
      S.alphaF = alphaF;

      // ---- rear axle ------------------------------------------------------
      const vry = vy - P.b * r;
      const alphaR = Math.atan2(vry, Math.max(avx, V_EPS));
      if (capR > 0) {
        const pv = Math.hypot(vx, vry);
        if (hb && pv > 0.4) {
          // LOCKED: pure sliding friction opposite the patch's own velocity
          const f = HB_SLIDE * capR * latR0 / pv;
          FxR = -vx * f; FyR = -vry * f;
          hbSl = Math.max(hbSl, clamp((pv - 1.5) / 6, 0, 1));
          if (avx < 0.5 && dR > 0) FxR += Math.min(dR, capR * 0.3);   // can still creep off the line
        } else {
          if (Math.abs(dR) > capR) {
            const over = (Math.abs(dR) - capR) / capR;
            if (drive !== 0 && Math.sign(dR) === Math.sign(drive)) { wsR = Math.max(wsR, Math.min(1, over)); FxR = Math.sign(dR) * capR * (1 - (1 - SPIN_KEEP) * Math.min(1, over)); }
            else { satR = Math.max(satR, Math.min(1, 0.5 + over)); FxR = Math.sign(dR) * capR * 0.97; }
          } else FxR = dR;
          let latCapR = Math.sqrt(Math.max(0, capR * capR - FxR * FxR));
          if (brk > 0) latCapR = Math.max(latCapR, ABS_STEER * capR);
          if (wsR > 0) latCapR = Math.min(latCapR, capR * 0.6);
          latCapR *= latR0;
          const s = alphaR / P.alphaPeak;
          if (Math.abs(s) > sRmax) sRmax = Math.abs(s);
          FyR = -latCapR * tyreShape(s);
        }
      }
      S.alphaR = alphaR;

      // ---- body forces (per unit mass) ------------------------------------
      const drag = (air ? 0 : ROLL_RES * clamp(avx, 0, 1)) + P.cd * vx * vx;
      const Fx = FxF * cd - FyF * sd + FxR - drag * sgn;
      const FyFb = FxF * sd + FyF * cd;
      const Fy = FyFb + FyR;
      const Mz = P.a * FyFb - P.b * FyR;

      // ---- integrate: dynamic model blended with kinematic at crawl ------
      let nvx = vx + (Fx + vy * r) * h;
      // brakes/drag/engine-brake never push a car backward through zero
      if (drive === 0 && vx !== 0 && nvx * vx < 0) nvx = 0;
      let nvy = vy + (Fy - vx * r) * h;
      let nr = r + (Mz / P.k2) * h;
      const wDyn = air ? 1 : sstep(KIN_V0, KIN_V1, avx);
      if (wDyn < 1) {
        // below KIN_V1 the wheels roll where they point: yaw from wheelbase
        // geometry (turning circle = L / tan(lock)); lateral speed of a car
        // pivoting about its rear axle.
        const rK = hb ? nr : vx * Math.tan(delta) / P.L;
        const vyK = rK * P.b;
        nr = rK + (nr - rK) * wDyn;
        nvy = vyK + (nvy - vyK) * wDyn;
      }
      if (air) nr *= 1 - 0.3 * h;
      S.vx = nvx; S.vy = nvy; S.r = nr;
      S.heading += nr * h;
      if (S.shiftT > 0) S.shiftT -= h;
      // the specific force the body feels, for suspension + head
      axSum += Fx; aySum += Fy;
      S.axF += (Fx - S.axF) * Math.min(1, h * 14);   // load transfer lags the force a touch (sprung mass)
    }
    if (S.vx > P.top * 1.02) S.vx = P.top * 1.02;
    if (S.vx < -REV_MAX) S.vx = -REV_MAX;
    // settle to a true stop instead of creeping on float dust
    if (!air && drive === 0 && Math.abs(S.vx) < 0.05 && Math.abs(S.vy) < 0.05) { S.vx = 0; S.vy = 0; S.r *= 0.5; }
    S.ax = axSum / n; S.ay = aySum / n;
    S.sF = sFmax; S.sR = sRmax; S.wsF = wsF; S.wsR = wsR; S.hbSlide = hbSl;
    S.brakeSatF = satF; S.brakeSatR = satR;

    // ---- engine rpm (0..1 of redline) — what the voice sings --------------
    const avx = Math.abs(S.vx);
    let rpmT;
    if (drive < 0) rpmT = IDLE_REV + (avx / REV_MAX) * 0.6;
    else {
      rpmT = Math.max(0, S.vx) / (P.top * GEAR_TOP[gear]);          // true in-gear rpm
      if (gear === 0 && rpmT < CLUTCH_REV) rpmT = Math.max(rpmT, IDLE_REV + drive * (LAUNCH_REV - IDLE_REV));
      const spin = Math.max(P.drive > 0 ? wsF : 0, P.drive < 1 ? wsR : 0);
      rpmT += spin * 0.45 * drive;                                  // lit tyres let the motor flare
      if (S.shiftT > 0) rpmT *= 0.92;
    }
    rpmT = clamp(rpmT, IDLE_REV, 1.05);
    const engaged = !(gear === 0 && rpmT <= CLUTCH_REV + 0.05) && wsF + wsR === 0;
    const k = engaged ? 22 : (rpmT > S.rpm ? 7 : 3.5);
    S.rpm += (rpmT - S.rpm) * Math.min(1, dt * k);

    // ---- how hard the tyres are working (0..1) — one honest signal --------
    const spdK = clamp((Math.hypot(S.vx, S.vy) - 2.5) / 5, 0, 1);
    const latR = clamp((sRmax - 1.0) / 1.4, 0, 1) * spdK;
    const latF = clamp((sFmax - 1.0) / 1.6, 0, 1) * spdK;
    const burnK = clamp(avx / 1.5, 0.35, 1);                         // a burnout smokes even nearly stationary
    const brkK = clamp((avx - 6) / 20, 0, 1);
    S.skidR = Math.max(latR, (P.drive < 1 ? wsR : 0) * burnK, hbSl * 0.9, satR * brkK * 0.7);
    S.skidF = Math.max(latF, (P.drive > 0 ? wsF : 0) * burnK, satF * brkK * 0.7);
    S.skid = Math.max(S.skidR, S.skidF * 0.8);
    // squeal starts BEFORE the slide: tyres sing as they approach the peak
    const near = clamp((Math.max(sFmax, sRmax) - 0.7) / 0.3, 0, 1) * 0.28 * spdK;
    S.squeal = Math.max(S.skid, near);
    return S;
  }

  // ---- THE BODY on its springs ------------------------------------------
  // sp = { p, pv, r, rv, h, hv }. ax, ay = specific forces (m/s^2, body frame,
  // +x forward, +y the +heading side). Pitch sign: + is NOSE DOWN (this rig's
  // rotation.x); roll sign: + raises the +heading side (rotation.z), so a
  // turn toward +heading (ay > 0) rolls the body OUT with a positive angle.
  function newSusp() { return { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 }; }
  function suspStep(sp, ax, ay, P, dt) {
    if (!(dt > 0)) return sp;
    dt = Math.min(dt, 0.1);
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const hh = dt / n;
    const pT = clamp(-ax / G * P.pitchGrad, -P.maxPitch, P.maxPitch);
    const rT = clamp(ay / G * P.rollGrad, -P.maxRoll, P.maxRoll);
    for (let i = 0; i < n; i++) {
      sp.pv += (P.wP * P.wP * (pT - sp.p) - 2 * P.zP * P.wP * sp.pv) * hh; sp.p += sp.pv * hh;
      sp.rv += (P.wR * P.wR * (rT - sp.r) - 2 * P.zR * P.wR * sp.rv) * hh; sp.r += sp.rv * hh;
      sp.hv += (-P.wH * P.wH * sp.h - 2 * P.zH * P.wH * sp.hv) * hh; sp.h += sp.hv * hh;
    }
    sp.p = clamp(sp.p, -P.maxPitch * 1.4, P.maxPitch * 1.4);
    sp.r = clamp(sp.r, -P.maxRoll * 1.4, P.maxRoll * 1.4);
    sp.h = clamp(sp.h, -0.14, 0.1);
    return sp;
  }
  // a vertical kick (m/s, negative = body thrown DOWN onto its springs)
  function suspKick(sp, dv) { sp.hv += dv; return sp; }

  const API = {
    params, step, newState, newSusp, suspStep, suspKick, tyreShape,
    gearFor, lerpCurve, GEAR_TOP, GEAR_TORQUE, REV_MAX, G,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.CBZ) root.CBZ.carDyn = API;
})(typeof window !== "undefined" ? window : globalThis);
