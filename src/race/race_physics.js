/* ============================================================
   race/race_physics.js — THE CAR, as forces. No THREE, no DOM.

   A 4-wheel planar vehicle model driven on the banked bullring of
   race_core.js. Everything a stock car does on a half-mile comes out
   of the forces, nothing is scripted:

   TYRES   per wheel: slip angle → lateral force through a simplified
           Pacejka magic formula (B,C,D), longitudinal force from the
           drive / brake demand, both inside one friction circle
           (combined slip: a wheel that is spinning or locked loses its
           side grip, which is what spins a car on power or on the
           brakes). Load sensitivity: mu falls as the load rises, so
           weight transfer costs total grip like it does on a real car.
   LOADS   static 52/48 split, downforce q*CLA (45% front), longitudinal
           and lateral transfer from the tyre forces through a 0.40 m
           CG, split front/rear by roll stiffness.
   BANK    the car is 2.5D: the dynamics are horizontal (x,z), the body
           rides y = surfaceY. The bank enters exactly: the surface
           normal carries m(g cos b + a_in sin b) and its horizontal
           part pushes the car toward the infield, the tyres' cross-
           slope force is projected by cos b. Solved implicitly, so a
           24 deg turn carries the speed a real 24 deg turn does.
   POWER   torque curve, 5-speed sequential with auto-shift, clutch slip
           off the line, rev limiter, engine braking, drag CDA 0.85,
           rolling resistance, grass at half grip.
   BRAKES  front-biased, per-wheel threshold clamp (abs assist, on for
           everyone: stock cars have no ABS, but threshold braking is a
           driver skill we give both the AI and the thumb), per-wheel
           brake heat that rises with the power put into the disc.
   DRAFT   a car in another car's wake loses up to 30% of its drag
           (and a little front downforce); the car in front gains a
           small bump-draft when the pair is nose to tail.
   CONTACT SAFER wall + pit wall per corner of the body (restitution
           0.2, scrub friction, yaw kick from the lever arm), car-car
           as 3 circles along each body with impulse + friction at the
           contact point: a tap in the rear quarter yaws the other car
           and the tyres finish the spin. Damage by impact energy to
           front/rear/left/right, engine and aero; power and downforce
           fall, drag rises.

   Substeps at <= 1/120 s. stepAll(cars, inputs, dt) is the game path
   (draft once per frame, dynamics + contact per substep); step(car,
   input, dt) moves one car alone (tests, replays).

   Attitude for the visual: rotation.order = 'YXZ';
   rotation.set(-car.pitch, car.yaw, car.roll). pitch > 0 = nose up,
   roll > 0 = the car's LEFT side up. Both include the banked road.

   PROGRESS: car.lapS is continuous race distance (metres, starts
   negative on the grid behind the line). car.lap = completed laps
   (0 until the car has crossed the line twice: the first crossing
   starts lap 1). Reversing lowers lapS; a lap is only credited at a
   new high-water mark, so backing over the line and re-crossing it
   never counts twice. car.finished is the game's to set.
============================================================ */
(function (root) {
  "use strict";

  const core = (root && root.CBZ && root.CBZ.race && root.CBZ.race.core) ||
    (typeof require === "function" ? require("./race_core.js") : null);
  const D = core.DIMS, L = D.L, PIT = core.PIT;

  const G = 9.81, RHO = 1.225;

  // ---- the car (modern cup car, short-track package) -----------------------
  const SPEC = {
    mass: 1540, izz: 2450,              // kg, kg m^2
    wb: 2.794, track: 1.72, cgH: 0.40,  // m
    frontW: 0.52,                       // static weight on the front axle
    rollF: 0.60,                        // front share of lateral load transfer (oval setup: tight, stable)
    halfLen: 2.46, halfWid: 0.995,
    rWheel: 0.35,                       // tyre OD ~0.70 m
    mu: 1.43, loadSens: 0.09, fz0: 3800,// peak friction, its load sensitivity, nominal wheel load
    B: 17.5, C: 1.38,                   // magic formula: peak slip ~6 deg, a slide keeps ~82%
    muRear: 1.03,                       // rear stagger/setup: the rear holds a touch more (a stable racer)
    cda: 0.85, cla: 2.35, dfFront: 0.42,// drag area, lift area (downforce 30% of weight @ 200 km/h)
    crr: 0.013,
    power: 505e3,                       // W (peak, for reference: the curve below makes it)
    idle: 1500, redline: 9800, shiftUp: 9350, shiftDown: 5600,
    torque: [[1000, 330], [3000, 420], [5000, 520], [6500, 575], [7500, 585], [8500, 565], [9300, 530], [9800, 490]],
    gears: [2.90, 2.05, 1.60, 1.27, 1.00], final: 4.70, rev: 2.9, eff: 0.90,
    shiftTime: 0.06,
    brakeMax: 31000, brakeBias: 0.64,   // N at the contact patches with the pedal floored
    maxSteer: 0.38,                     // rad at the road wheels (~22 deg)
    wallE: 0.20, wallMu: 0.45,
    carE: 0.25, carMu: 0.35, carR: 1.0, carZ: 1.46,
  };

  // ---- helpers --------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sgn = (v) => (v < 0 ? -1 : 1);
  const TWO_PI = Math.PI * 2;

  function torqueAt(sp, rpm) {
    const t = sp.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (rpm <= t[i][0]) { const f = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * f; }
    }
    return t[t.length - 1][1];
  }
  const RPM_PER_RADS = 60 / TWO_PI;

  /* maxDriveForce(v) — the most the engine can push at the contact patch in
     the best gear at road speed v (m/s), ignoring grip. The AI's speed planner
     reads it so its acceleration pass matches the car it drives. */
  function maxDriveForce(v, sp) {
    sp = sp || SPEC;
    let best = 0;
    for (let g = 0; g < sp.gears.length; g++) {
      const ratio = sp.gears[g] * sp.final;
      let rpm = Math.max(Math.abs(v) / sp.rWheel * ratio * RPM_PER_RADS, 4500);
      if (rpm > sp.redline) continue;
      const f = torqueAt(sp, rpm) * ratio * sp.eff / sp.rWheel;
      if (f > best) best = f;
    }
    return best;
  }

  // load sensitivity: mu ∝ (Fz/Fz0)^-ls (a heavily loaded tyre grips less per newton)
  function loadMu(sp, fz) { return Math.pow(Math.max(fz, 300) / sp.fz0, -sp.loadSens); }

  // magic formula shape (normalised, peak 1)
  function mf(sp, a) {
    const x = sp.B * a;
    return Math.sin(sp.C * Math.atan(x));
  }
  const SLIP_PEAK = (sp) => Math.tan(Math.PI / (2 * sp.C)) / sp.B;

  /* Surface at (s,u): slope angle across the track (rad, rising outward),
     grip multiplier, and whether it is grass. */
  function surfaceAt(s, u, o) {
    if (physics.flat) { o.slope = 0; o.grip = 1; o.grass = false; return o; }   // test rig: an endless flat pad
    if (u >= D.INNER) { o.slope = core.frame(s, _fs).bank; o.grip = 1; o.grass = false; return o; }
    if (u >= D.APRON_IN) { o.slope = Math.atan(D.APRON_RISE / D.APRON_W); o.grip = 1; o.grass = false; return o; }
    o.slope = 0;
    // pit road + its lane blends are paved; the grass strip before the pit wall is not
    const sd = core.ds(0, s);
    const inPitZone = sd >= PIT.inS && sd <= PIT.outS;
    const paved = inPitZone && u >= PIT.u - PIT.w / 2 - 0.5 &&
      (u < PIT.wallU - PIT_WALL_HALF || sd < PIT.s0 || sd > PIT.s1);
    o.grass = !paved; o.grip = paved ? 1 : 0.5;
    return o;
  }
  const _fs = {}, _sf = { slope: 0, grip: 1, grass: false };
  const PIT_WALL_HALF = 0.3;

  // ---- construction --------------------------------------------------------
  function makeWheel() { return { spin: 0, steer: 0, compress: 0, slip: 0, slipRatio: 0, load: 0, brakeHeat: 0, onGrass: false }; }

  function createCar(opts) {
    opts = opts || {};
    const sp = Object.assign({}, SPEC, opts.spec || {});
    const s = core.wrapS(opts.s || 0), u = opts.u || 0;
    const f = core.frame(s, {});
    const car = {
      id: opts.id == null ? 0 : opts.id, number: opts.number == null ? 0 : opts.number,
      spec: sp,
      pos: { x: f.x + f.nx * u, y: core.surfaceY(s, u), z: f.z + f.nz * u },
      yaw: f.yaw, pitch: 0, roll: 0,
      vel: { x: 0, z: 0 }, speed: 0, latSpeed: 0, yawRate: 0,
      s, u, lap: 0, lapS: s > L / 2 ? s - L : s, finished: false,
      rpm: sp.idle, gear: 1, throttle: 0, brake: 0, steer: 0,
      wheels: [makeWheel(), makeWheel(), makeWheel(), makeWheel()],
      fx: { backfire: 0, sparks: 0, smoke: 0, impact: null, impactSeq: 0 },
      damage: { front: 0, rear: 0, left: 0, right: 0, engine: 0, aero: 0 },
      draft: 0, pit: null,
      g: { long: 0, lat: 0 },            // felt acceleration in g (HUD, camera shake)
      onGrass: false, wallContact: 0, carContact: 0,
      assist: Object.assign({ abs: 1, tc: 1, stab: 0 }, opts.assist || {}),
      isPlayer: !!opts.isPlayer,
      // timing
      t: 0, lapTimes: [], lastLap: 0, bestLap: 0, lapStartT: null, _lapHW: 0,
      // internals
      _aIn: 0, _aLong: 0, _aLat: 0, _shiftT: 0, _thrPrev: 0, _revT: 0,
      _dragMul: 1, _dfMul: 1,
      _joltF: 0, _joltR: 0,               // a hit bounces that axle's tyres light for a moment
    };
    car._lapHW = Math.floor(car.lapS / L);
    // static loads for the first substep
    const w = sp.mass * G;
    car.wheels[0].load = car.wheels[1].load = w * sp.frontW / 2;
    car.wheels[2].load = car.wheels[3].load = w * (1 - sp.frontW) / 2;
    attitude(car);
    return car;
  }

  // ---- one substep of one car ----------------------------------------------
  function substep(car, inp, h) {
    const sp = car.spec, m = sp.mass, dmg = car.damage, W = car.wheels;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    // car axes in world: forward (sy, cy), left (cy, -sy)
    let vf = car.vel.x * sy + car.vel.z * cy;
    let vl = car.vel.x * cy - car.vel.z * sy;
    const r = car.yawRate;
    const speedAbs = Math.hypot(vf, vl);

    // ---- surface under the car ----
    surfaceAt(car.s, car.u, _sf);
    const slope = _sf.slope, grip = _sf.grip;
    car.onGrass = _sf.grass;
    const cb = Math.cos(slope), sb = Math.sin(slope);

    // ---- inputs, gearbox, reverse ----
    let thr = clamp(inp.throttle || 0, 0, 1), brk = clamp(inp.brake || 0, 0, 1);
    let steerIn = clamp(inp.steer || 0, -1, 1);
    // reverse: stopped + brake held, brake becomes reverse throttle; throttle exits.
    // input.hold is a parked car's foot on the brake (the grid, a car you got
    // out of, a handbrake): it never engages reverse. (Without it the whole
    // field backed 15 m off the grid while the lights came on.)
    if (car.gear === -1) {
      if (inp.hold || (thr > 0.1 && vf > -1)) car.gear = 1;
      else { const t = thr; thr = brk; brk = t; }
    } else if (inp.hold) car._revT = 0;
    else if (brk > 0.3 && thr < 0.05 && Math.abs(vf) < 0.6) {
      car._revT += h; if (car._revT > 0.45) { car.gear = -1; car._revT = 0; }
    } else car._revT = 0;

    // ---- aero ----
    const q = 0.5 * RHO * (vf * vf + vl * vl);
    const df = q * sp.cla * (1 - 0.6 * dmg.aero) * car._dfMul;
    const drag = q * sp.cda * (1 + 0.25 * dmg.aero) * car._dragMul;

    // ---- engine ----
    const reverse = car.gear === -1;
    const ratio = (reverse ? sp.rev : sp.gears[car.gear - 1]) * sp.final;
    const wheelW = Math.abs(vf) / sp.rWheel;
    const rpmWheel = wheelW * ratio * RPM_PER_RADS;
    // clutch slips off the line: engine holds a launch rpm under throttle
    const rpmTarget = Math.max(rpmWheel, sp.idle + thr * (car.gear <= 1 ? 3800 : 0));
    car.rpm += (clamp(rpmTarget, sp.idle, sp.redline + 150) - car.rpm) * Math.min(1, h * 18);
    let driveF = 0;
    if (car._shiftT > 0) car._shiftT -= h;
    else if (thr > 0 && car.rpm < sp.redline) {
      driveF = torqueAt(sp, car.rpm) * thr * ratio * sp.eff / sp.rWheel * (1 - 0.55 * dmg.engine);
    } else if (thr === 0 && rpmWheel > sp.idle * 1.2) {
      driveF = -Math.min(900, 45 * ratio * sp.eff / sp.rWheel * (car.rpm / 6000)); // engine braking
    }
    if (reverse) { driveF = -driveF; if (vf < -8) driveF = 0; }
    // auto-shift
    if (!reverse && car._shiftT <= 0) {
      if (car.rpm > sp.shiftUp && car.gear < sp.gears.length) {
        car.gear++; car._shiftT = sp.shiftTime; car.fx.backfire = Math.max(car.fx.backfire, 0.8);
      } else if (car.gear > 1) {
        const lower = wheelW * sp.gears[car.gear - 2] * sp.final * RPM_PER_RADS;
        if (car.rpm < sp.shiftDown && lower < sp.shiftUp - 600) { car.gear--; car._shiftT = sp.shiftTime * 0.7; }
      }
    }
    // lift-off crackle
    if (car._thrPrev > 0.7 && thr < 0.2 && car.rpm > 7000) car.fx.backfire = 1;
    car._thrPrev = thr;

    // ---- loads: static + downforce + transfer from last substep's felt accel ----
    const aIn = car._aIn;
    const nBody = m * Math.max(0, G * cb + aIn * sb);
    const nF = nBody * sp.frontW + df * sp.dfFront - m * car._aLong * sp.cgH / sp.wb;
    const nR = nBody + df - nF;
    const latT = m * car._aLat * sp.cgH / sp.track;       // + = left turn → load to the right wheels
    const dF = latT * sp.rollF, dR = latT * (1 - sp.rollF);
    W[0].load = Math.max(0, nF / 2 - dF); W[1].load = Math.max(0, nF / 2 + dF);
    W[2].load = Math.max(0, nR / 2 - dR); W[3].load = Math.max(0, nR / 2 + dR);

    // ---- steering + stability assist ----
    let delta = steerIn * sp.maxSteer;
    const beta = speedAbs > 3 ? Math.atan2(vl, Math.abs(vf)) : 0;
    if (car.assist.stab > 0 && vf > 5) {
      const ex = beta - clamp(beta, -0.05, 0.05);
      delta = clamp(delta + car.assist.stab * 0.9 * ex, -sp.maxSteer, sp.maxSteer);
      if (driveF > 0) driveF *= 1 - car.assist.stab * clamp((Math.abs(beta) - 0.07) / 0.12, 0, 0.8);
    }
    // a touch of Ackermann
    const ack = delta * delta * sgn(delta) * 0.08;
    W[0].steer = delta + (delta > 0 ? ack : 0);
    W[1].steer = delta + (delta < 0 ? ack : 0);
    W[2].steer = W[3].steer = 0;

    // ---- tyres ----
    const a = sp.wb * (1 - sp.frontW), b = sp.wb * sp.frontW, tw = sp.track / 2;
    const vReg = Math.max(Math.abs(vf), 4);
    let FxL = 0, FzL = 0, Mz = 0, sumLat = 0, sumLong = 0;
    const alphaPeak = SLIP_PEAK(sp);
    const brakeTot = brk * sp.brakeMax;
    const rollSign = Math.abs(vf) > 0.3 ? sgn(vf) : 0;
    for (let i = 0; i < 4; i++) {
      const w = W[i], front = i < 2;
      const px = (i & 1) ? -tw : tw, pz = front ? a : -b;
      const wvx = vl + r * pz, wvz = vf - r * px;          // contact-point velocity, car frame (x left, z fwd)
      const d = w.steer, cd = Math.cos(d), sd = Math.sin(d);
      const vLong = wvx * sd + wvz * cd;
      const vLat = wvx * cd - wvz * sd;
      const fz = w.load;
      const mu = sp.mu * grip * loadMu(sp, fz) * (front ? 1 - car._joltF : sp.muRear * (1 - car._joltR));
      const fMax = mu * fz;
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), vReg * 0.999));
      let fy = -fMax * mf(sp, alpha);
      if (speedAbs < 1.2) fy = -clamp(vLat * m * 12, -fMax, fMax); // parking-lot regime: no slip angles at rest
      const fyDemand = Math.abs(fy);
      // longitudinal demand
      let fx = 0;
      if (!front) fx += driveF / 2;
      const bShare = brakeTot * (front ? sp.brakeBias : 1 - sp.brakeBias) / 2;
      let bApplied = 0;
      if (bShare > 0 && Math.abs(vLong) > 0.05) { bApplied = bShare; fx -= bShare * sgn(vLong); }
      else if (bShare > 0) fx -= clamp(vLong * m * 2, -bShare, bShare);   // holding still
      fx -= sp.crr * fz * (w.onGrass ? 3 : 1) * rollSign;
      // assists clamp the demand at the threshold (abs for brakes, tc for drive)
      let sat = false;
      const lim = fMax * 0.96;
      const braking = bApplied > 0 && sgn(fx) !== sgn(vLong);
      if (braking && car.assist.abs) {
        // threshold braking keeps the car pointed: the rears give the side force full
        // priority (a braked rear that lets go is a spin), the fronts keep 70% of it
        const l2 = front ? Math.max(0.55 * fMax, Math.sqrt(Math.max(0, lim * lim - 0.49 * fyDemand * fyDemand)))
                         : Math.max(0.15 * fMax, Math.sqrt(Math.max(0, lim * lim - fyDemand * fyDemand)));
        if (Math.abs(fx) > l2) fx = sgn(fx) * l2;
      } else if (!braking && !front && driveF !== 0 && car.assist.tc) {
        // traction control (both directions): drive gets what the cornering leaves (never below 25%)
        const l2 = Math.max(0.25 * fMax, Math.sqrt(Math.max(0, lim * lim - 0.9 * fyDemand * fyDemand)));
        if (Math.abs(fx) > l2) fx = sgn(fx) * l2;
      }
      if (Math.abs(fx) > fMax) { fx = sgn(fx) * fMax * 0.82; sat = true; }
      // friction circle
      const ux = fx / (fMax || 1);
      if (sat) fy *= 0.35;
      else fy *= Math.sqrt(Math.max(0, 1 - ux * ux));
      const fyMax = Math.sqrt(Math.max(0, fMax * fMax - fx * fx));
      if (Math.abs(fy) > fyMax) fy = sgn(fy) * fyMax;
      // wheel frame → car frame
      const cfx = fx * sd + fy * cd;            // left
      const cfz = fx * cd - fy * sd;            // forward
      FxL += cfx; FzL += cfz;
      Mz += pz * cfx - px * cfz;
      sumLat += cfx; sumLong += cfz;
      // visual outputs
      const comb = Math.hypot(Math.abs(alpha) / alphaPeak, Math.abs(ux) * 1.02);
      w.slip = sat ? 1 : clamp((comb - 0.85) / 0.6, 0, 1);
      w.slipRatio = sat ? (bApplied > 0 ? -1 : 0.4) : ux * 0.08;
      const ang = sat && bApplied > 0 ? 0 : (vLong / sp.rWheel) * (1 + (sat ? 0.6 : 0));
      w.spin = (w.spin + ang * h) % TWO_PI;
      w.compress = clamp((fz - sp.mass * G / 4) / 210000, -0.05, 0.07);
      w.onGrass = _sf.grass;
      // brake heat: rises with disc power, cools with airflow
      const pw = bApplied * Math.abs(vLong);
      w.brakeHeat = clamp(w.brakeHeat + h * (pw / 1.0e6 - w.brakeHeat * (0.05 + Math.abs(vf) * 0.002)), 0, 1);
    }

    // ---- sum forces in world ----
    // drag + rolling are along the velocity; tyres already carry rolling
    let fwx = FxL * cy + FzL * sy, fwz = -FxL * sy + FzL * cy;
    if (speedAbs > 0.1) { const k = drag / speedAbs; fwx -= car.vel.x * k; fwz -= car.vel.z * k; }
    // bank: implicit horizontal balance. With n the outward normal and F_in the
    // tyres' inward force, the car's inward acceleration is
    //   a_in = F_in / (m cos b) + g tan b  (surface normal carries the rest).
    const fr = core.frame(car.s, _fr);
    const fnOut = fwx * fr.nx + fwz * fr.nz;              // tyre force along +n (outward)
    const aOut = fnOut / (m * cb) - G * Math.tan(slope);  // net outward accel
    const ax = (fwx - fnOut * fr.nx) / m + aOut * fr.nx;
    const az = (fwz - fnOut * fr.nz) / m + aOut * fr.nz;
    car._aIn = -aOut;
    // felt accelerations (drive the transfer) — filtered lightly
    const k = Math.min(1, h * 30);
    car._aLong += (sumLong / m - car._aLong) * k;
    car._aLat += (sumLat / m - car._aLat) * k;

    // ---- integrate ----
    car.vel.x += ax * h; car.vel.z += az * h;
    car.yawRate += Mz / sp.izz * h;
    // at rest: kill creep
    if (speedAbs < 0.25 && thr === 0 && Math.abs(driveF) < 1) { car.vel.x *= 0.8; car.vel.z *= 0.8; car.yawRate *= 0.8; }
    car.pos.x += car.vel.x * h; car.pos.z += car.vel.z * h;
    car.yaw += car.yawRate * h;
    if (car.yaw > Math.PI) car.yaw -= TWO_PI; else if (car.yaw < -Math.PI) car.yaw += TWO_PI;

    car.throttle = thr; car.brake = brk; car.steer = steerIn;
    track(car, h);
    walls(car);
  }
  const _fr = {};

  // ---- track position, laps, timing ----
  function track(car, h) {
    const prev = car.s;
    core.nearest(car.pos.x, car.pos.z, prev, _nn);
    // far off the racing surface (across the infield) the hinted search loses the car: rescan
    if (Math.abs(_nn.u) > 40) core.nearest(car.pos.x, car.pos.z, null, _nn);
    car.s = _nn.s; car.u = _nn.u;
    let d = core.ds(prev, car.s);
    // a jump no car can drive in one substep is a cut across the infield: it never gains
    // distance (a forward jump is booked as the long way round, backwards)
    if (Math.abs(d) > 30 && d > 0) d -= L;
    car.lapS += d;
    car.t += h;
    const fl = Math.floor(car.lapS / L);
    if (fl > car._lapHW) {
      car._lapHW = fl;
      if (fl >= 1) {
        if (car.lapStartT != null) {
          const lt = car.t - car.lapStartT;
          car.lapTimes.push(lt); car.lastLap = lt;
          if (!car.bestLap || lt < car.bestLap) car.bestLap = lt;
        }
        car.lapStartT = car.t;
      } else if (fl === 0) car.lapStartT = car.t;   // the start: crossing from the grid
    }
    car.lap = Math.max(0, car._lapHW);
  }
  const _nn = {};

  // ---- walls ----
  const CORNERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];     // (x = left sign, z = fwd sign)
  function walls(car) {
    if (physics.flat) return;
    const sp = car.spec;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const fr = core.frame(car.s, _fr);
    const sd = core.ds(0, car.s);
    const pitWall = sd > PIT.s0 && sd < PIT.s1 && car.u < D.APRON_IN;
    let hit = false;
    for (let c = 0; c < 4; c++) {
      const lx = CORNERS[c][0] * sp.halfWid, lz = CORNERS[c][1] * sp.halfLen;
      const rx = lx * cy + lz * sy, rz = -lx * sy + lz * cy;  // corner offset in world
      const uc = car.u + rx * fr.nx + rz * fr.nz;
      let pen = 0, nx = 0, nz = 0;
      if (uc > D.WALL_U) { pen = uc - D.WALL_U; nx = -fr.nx; nz = -fr.nz; }
      else if (pitWall) {
        if (car.u > PIT.wallU && uc < PIT.wallU + PIT_WALL_HALF) { pen = PIT.wallU + PIT_WALL_HALF - uc; nx = fr.nx; nz = fr.nz; }
        else if (car.u <= PIT.wallU && uc > PIT.wallU - PIT_WALL_HALF) { pen = uc - (PIT.wallU - PIT_WALL_HALF); nx = -fr.nx; nz = -fr.nz; }
      }
      if (pen <= 0) continue;
      hit = true;
      contactStatic(car, rx, rz, nx, nz, pen, sp.wallE, sp.wallMu);
    }
    car.wallContact = hit ? 1 : Math.max(0, car.wallContact - 0.05);
  }

  // impulse of one car against a static surface at world offset (rx,rz)
  function contactStatic(car, rx, rz, nx, nz, pen, e, fmu) {
    const sp = car.spec, m = sp.mass, I = sp.izz;
    const vpx = car.vel.x + car.yawRate * rz, vpz = car.vel.z - car.yawRate * rx;
    const vn = vpx * nx + vpz * nz;
    // push out
    car.pos.x += nx * pen; car.pos.z += nz * pen;
    if (vn >= 0) return;
    const rn = rz * nx - rx * nz;
    const j = -(1 + e) * vn / (1 / m + rn * rn / I);
    car.vel.x += j * nx / m; car.vel.z += j * nz / m; car.yawRate += rn * j / I;
    // scrub
    const tx = -nz, tz = nx;
    const vpx2 = car.vel.x + car.yawRate * rz, vpz2 = car.vel.z - car.yawRate * rx;
    const vt = vpx2 * tx + vpz2 * tz;
    const rt = rz * tx - rx * tz;
    let jt = -vt / (1 / m + rt * rt / I);
    jt = clamp(jt, -fmu * j, fmu * j);
    car.vel.x += jt * tx / m; car.vel.z += jt * tz / m; car.yawRate += rt * jt / I;
    const mag = -vn;
    car.fx.sparks = Math.max(car.fx.sparks, clamp(Math.abs(vt) / 25 + mag / 10, 0, 1));
    jolt(car, partOf(car, rx, rz), mag * 0.7);
    if (mag > 1.2) {
      damageHit(car, partOf(car, rx, rz), mag, rx, rz, nx, nz);
    }
  }

  /* A hit shakes the axle it lands on: the tyres there run light for a few
     tenths (suspension bounce), so a tap in the rear quarter of a car that is
     already using its rear grip turns it around. */
  function jolt(car, part, mag) {
    const j = clamp((mag - 0.8) / 8, 0, 0.6);
    if (j <= 0) return;
    if (part === "rear") car._joltR = Math.max(car._joltR, j);
    else if (part === "front") car._joltF = Math.max(car._joltF, j);
    else { car._joltR = Math.max(car._joltR, j * 0.7); car._joltF = Math.max(car._joltF, j * 0.4); }
  }

  function partOf(car, rx, rz) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const lz = rx * sy + rz * cy, lx = rx * cy - rz * sy;
    if (Math.abs(lz) > car.spec.halfLen * 0.55) return lz > 0 ? "front" : "rear";
    return lx > 0 ? "left" : "right";
  }

  function damageHit(car, part, mag, rx, rz, nx, nz) {
    const d = car.damage;
    const e = (mag / 30) * (mag / 30);                     // a 30 m/s square hit writes that corner off
    d[part] = clamp(d[part] + e, 0, 1);
    if (part === "front") { d.engine = clamp(d.engine + e * 0.55, 0, 1); d.aero = clamp(d.aero + e * 0.5, 0, 1); }
    else if (part === "rear") d.aero = clamp(d.aero + e * 0.45, 0, 1);
    else d.aero = clamp(d.aero + e * 0.15, 0, 1);
    car.fx.smoke = Math.max(car.fx.smoke, clamp((d.engine - 0.35) / 0.4, 0, 1));
    if (mag > 2.5 && (!car.fx.impact || mag > car.fx.impact.mag)) {
      car.fx.impact = { x: car.pos.x + rx, y: car.pos.y + 0.5, z: car.pos.z + rz, nx, nz, mag, part };
      car.fx.impactSeq++;
    }
  }

  // ---- car-car contact ----------------------------------------------------
  const _ca = [0, 0, 0], _cb = [0, 0, 0];
  function collidePair(A, B) {
    const dx0 = B.pos.x - A.pos.x, dz0 = B.pos.z - A.pos.z;
    if (dx0 * dx0 + dz0 * dz0 > 36) return false;
    const sp = A.spec, R = sp.carR + B.spec.carR;
    const ay = Math.sin(A.yaw), ac = Math.cos(A.yaw), by = Math.sin(B.yaw), bc = Math.cos(B.yaw);
    let any = false;
    for (let i = -1; i <= 1; i++) {
      const arx = ay * sp.carZ * i, arz = ac * sp.carZ * i;
      for (let k = -1; k <= 1; k++) {
        const brx = by * B.spec.carZ * k, brz = bc * B.spec.carZ * k;
        const dx = (B.pos.x + brx) - (A.pos.x + arx), dz = (B.pos.z + brz) - (A.pos.z + arz);
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = R - d;
        // contact point: midway between surfaces
        const cxw = A.pos.x + arx + nx * sp.carR, czw = A.pos.z + arz + nz * sp.carR;
        const ra_x = cxw - A.pos.x, ra_z = czw - A.pos.z, rb_x = cxw - B.pos.x, rb_z = czw - B.pos.z;
        pairImpulse(A, B, ra_x, ra_z, rb_x, rb_z, nx, nz, pen);
        any = true;
      }
    }
    return any;
  }

  function pairImpulse(A, B, rax, raz, rbx, rbz, nx, nz, pen) {
    const mA = A.spec.mass, mB = B.spec.mass, IA = A.spec.izz, IB = B.spec.izz;
    // separate (split by mass)
    const corr = pen * 0.5;
    A.pos.x -= nx * corr; A.pos.z -= nz * corr; B.pos.x += nx * corr; B.pos.z += nz * corr;
    const vax = A.vel.x + A.yawRate * raz, vaz = A.vel.z - A.yawRate * rax;
    const vbx = B.vel.x + B.yawRate * rbz, vbz = B.vel.z - B.yawRate * rbx;
    const rvx = vbx - vax, rvz = vbz - vaz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const ran = raz * nx - rax * nz, rbn = rbz * nx - rbx * nz;
    const e = A.spec.carE;
    const j = -(1 + e) * vn / (1 / mA + 1 / mB + ran * ran / IA + rbn * rbn / IB);
    A.vel.x -= j * nx / mA; A.vel.z -= j * nz / mA; A.yawRate -= ran * j / IA;
    B.vel.x += j * nx / mB; B.vel.z += j * nz / mB; B.yawRate += rbn * j / IB;
    // rub friction
    const tx = -nz, tz = nx;
    const vt = rvx * tx + rvz * tz;
    const rat = raz * tx - rax * tz, rbt = rbz * tx - rbx * tz;
    let jt = -vt / (1 / mA + 1 / mB + rat * rat / IA + rbt * rbt / IB);
    const lim = A.spec.carMu * j; jt = clamp(jt, -lim, lim);
    A.vel.x -= jt * tx / mA; A.vel.z -= jt * tz / mA; A.yawRate -= rat * jt / IA;
    B.vel.x += jt * tx / mB; B.vel.z += jt * tz / mB; B.yawRate += rbt * jt / IB;
    const mag = -vn;
    const sp = clamp(Math.abs(vt) / 18 + mag / 8, 0, 1);
    A.fx.sparks = Math.max(A.fx.sparks, sp); B.fx.sparks = Math.max(B.fx.sparks, sp);
    A.carContact = B.carContact = 1;
    jolt(A, partOf(A, rax, raz), mag); jolt(B, partOf(B, rbx, rbz), mag);
    if (mag > 1.5) {
      damageHit(A, partOf(A, rax, raz), mag * 0.8, rax, raz, -nx, -nz);
      damageHit(B, partOf(B, rbx, rbz), mag * 0.8, rbx, rbz, nx, nz);
    }
    stats.contacts++;
    if (mag > 3) stats.hardContacts++;
  }
  const stats = { contacts: 0, hardContacts: 0 };

  function collideAll(cars) {
    const n = cars.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) collidePair(cars[i], cars[j]);
  }

  // ---- drafting (once per frame) ------------------------------------------
  const DRAFT_LEN = 25, DRAFT_W = 2.0;
  function draftAll(cars) {
    const n = cars.length;
    for (let i = 0; i < n; i++) { cars[i].draft = 0; cars[i]._bump = 0; }
    for (let i = 0; i < n; i++) {
      const A = cars[i];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const B = cars[j];
        const gap = core.ds(A.s, B.s) - 4.9;               // B ahead of A by gap (bumper to bumper)
        if (gap < -0.5 || gap > DRAFT_LEN) continue;
        const du = Math.abs(B.u - A.u);
        if (du > DRAFT_W + 1.2) continue;
        const lat = clamp(1 - Math.max(0, du - 0.4) / (DRAFT_W + 0.8), 0, 1);
        const close = 1 - clamp(gap, 0, DRAFT_LEN) / DRAFT_LEN;
        const d = lat * (0.25 + 0.75 * close * close) * (B.speed > 15 ? 1 : 0);
        if (d > A.draft) A.draft = d;
        if (gap < 6) B._bump = Math.max(B._bump, lat * (1 - gap / 6));
      }
    }
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      c._dragMul = (1 - 0.30 * c.draft) * (1 - 0.08 * c._bump);
      c._dfMul = 1 - 0.12 * c.draft;                       // dirty air: the trailing car loses a little downforce
    }
  }

  // ---- body attitude (surface + weight transfer) --------------------------
  function attitude(car) {
    surfaceAt(car.s, car.u, _sf);
    const fr = core.frame(car.s, _fr);
    const tg = Math.tan(_sf.slope);
    const gx = fr.nx * tg, gz = fr.nz * tg;               // height gradient (rises outward)
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const pSurf = Math.atan(gx * sy + gz * cy);
    const rSurf = Math.atan(gx * cy - gz * sy);
    const pBody = clamp(car._aLong * 0.0024, -0.06, 0.05);
    const rBody = clamp(car._aLat * 0.0020, -0.05, 0.05);
    car.pitch = pSurf + pBody;
    car.roll = rSurf + rBody;
    car.pos.y = core.surfaceY(car.s, car.u);
    const cyV = Math.cos(car.yaw), syV = Math.sin(car.yaw);
    car.speed = car.vel.x * syV + car.vel.z * cyV;
    car.latSpeed = car.vel.x * cyV - car.vel.z * syV;
    car.g.long = car._aLong / G; car.g.lat = car._aLat / G;
  }

  // ---- public stepping -----------------------------------------------------
  const MAX_H = 1 / 120;
  function beginFrame(car, dt) {
    car.fx.impact = null;
    const dec = Math.exp(-dt * 6);
    car.fx.backfire *= dec; car.fx.sparks *= Math.exp(-dt * 10);
    car.carContact = Math.max(0, car.carContact - dt * 4);
    const jd = Math.exp(-dt * 5);
    car._joltF *= jd; car._joltR *= jd;
    car.fx.smoke = Math.max(car.fx.smoke * Math.exp(-dt * 0.5), clamp((car.damage.engine - 0.35) / 0.4, 0, 1));
  }
  const ZERO_IN = { steer: 0, throttle: 0, brake: 0 };

  function step(car, input, dt) {
    dt = clamp(dt, 0, 0.1);
    if (dt <= 0) return car;
    beginFrame(car, dt);
    const n = Math.ceil(dt / MAX_H - 1e-9), h = dt / n;
    for (let i = 0; i < n; i++) substep(car, input || ZERO_IN, h);
    attitude(car);
    return car;
  }

  /* stepAll(cars, inputs, dt): the game path. inputs[i] feeds cars[i]
     (null = coast). Draft once per frame; dynamics + contact per substep. */
  function stepAll(cars, inputs, dt) {
    dt = clamp(dt, 0, 0.1);
    if (dt <= 0) return;
    for (const c of cars) beginFrame(c, dt);
    draftAll(cars);
    const n = Math.ceil(dt / MAX_H - 1e-9), h = dt / n;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < cars.length; i++) substep(cars[i], (inputs && inputs[i]) || ZERO_IN, h);
      collideAll(cars);
    }
    for (const c of cars) attitude(c);
  }

  /* assistSteer(car, raw, dt) → smoothed steer for the player. Feed it the
     RAW thumb every frame (digital buttons: -1 / 0 / +1, or a stick -1..1)
     and pass what it returns as input.steer. It
       - maps full deflection to the lock that reaches about the tyres' limit
         at this speed on this banking (wheelbase/R + ~the peak slip angle,
         R from ~1.35 g flat, ~3 g on a 24 deg turn), so a held button
         corners hard but does not simply spin a car at 200 km/h; below
         ~15 m/s the full lock stays available;
       - winds on slowly (a tap is a small correction, a hold is a turn) and
         centres quickly.
     The stability assist inside the physics (car.assist.stab 0..1, 0.5
     suggested for the player) catches small slides. It is not a rail: carry
     too much speed into turn 1 and the car still goes up the track or
     around. */
  function assistSteer(car, raw, dt) {
    const sp = car.spec;
    raw = clamp(raw || 0, -1, 1);
    const v = Math.max(Math.abs(car.speed), 1);
    const bank = car.u > D.INNER ? core.frame(car.s, _fr).bank : 0;
    const aLim = G * (1.35 + 4 * Math.sin(bank));
    const lim = clamp((Math.atan(sp.wb * aLim / (v * v)) + SLIP_PEAK(sp) * 0.85) / sp.maxSteer, 0.2, 1);
    const target = raw * lim;
    const prev = car._assistSteer || 0;
    const back = Math.abs(target) < Math.abs(prev) || sgn(target) !== sgn(prev);
    const rate = back ? 4.0 : 2.4 - 1.4 * clamp((v - 15) / 35, 0, 1);  // lock per second: ~1.0/s winding on at racing speed
    const step = rate * clamp(dt, 0, 0.1);
    const out = prev + clamp(target - prev, -step, step);
    car._assistSteer = out;
    return out;
  }

  /* gripEstimate() — steady-state friction the planner should assume
     (the tyre's mu at its typical cornering load, times the circle loss
     from load transfer). The AI builds its speed profile with it. */
  function gripEstimate(sp) { return gripAt(1.25, sp); }
  /* gripAt(nG) — steady friction with the car pressed down by nG g (bank +
     downforce), including the loss to lateral load transfer. */
  function gripAt(nG, sp) {
    sp = sp || SPEC;
    const fz = sp.mass * G / 4 * nG;
    return sp.mu * loadMu(sp, fz) * 1.0;
  }

  const physics = {
    SPEC, G, RHO,
    flat: false,                   // tests only: an endless flat pad, no walls
    createCar, step, stepAll, collideAll, draftAll, assistSteer,
    maxDriveForce, gripEstimate, gripAt, slipPeak: () => SLIP_PEAK(SPEC), torqueAt: (rpm) => torqueAt(SPEC, rpm), stats,
    brakeDecel(v, sp) {            // what the brakes (abs clamp) can do at speed v on a flat surface, m/s^2
      sp = sp || SPEC;
      const q = 0.5 * RHO * v * v;
      const n = sp.mass * G + q * sp.cla;
      return Math.min(sp.brakeMax, gripEstimate(sp) * 0.96 * n) / sp.mass + (q * sp.cda + sp.crr * n) / sp.mass;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = physics;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.physics = physics;
  }
})(typeof window !== "undefined" ? window : null);
