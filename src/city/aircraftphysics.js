/* ============================================================
   city/aircraftphysics.js — SHARED flight-model core for every aircraft in
   the city: the police gunship + fighter jets (aircraft.js) AND the player's
   missile chopper + F-22 (playeraircraft.js). Both used to run two totally
   disconnected scripted-kinematics styles (lerp-to-target for the AI,
   velocity+drag with a hard min-speed floor for the player) with NO lift,
   drag, stall, ground-effect or ETL model anywhere. This file gives them ONE
   small, cheap, shared aero core so "realistic" means the same thing on both
   sides of the fight.

   WHY a separate file instead of duplicating the math in each consumer: the
   stall curve / ETL ramp / ground-effect falloff are exactly the kind of
   tunable that drifts out of sync if hand-copied twice — one bug fix here
   fixes the gunship AND the player heli at once. It's pure math (no THREE
   scene objects touched), so it's trivially headless-safe and dirt cheap
   (a handful of multiplies + one small table lookup per aircraft per frame).

   WHAT'S IN HERE
   --------------
   • localVelocity(vx,vy,vz, heading, pitch, roll) — world→body-frame velocity
     via plain trig (NOT THREE.Quaternion: the headless harness's THREE stub
     has no setFromEuler/applyQuaternion, and r128's Euler order here is the
     same XYZ convention every consumer already uses via group.rotation.set
     (pitch, heading, roll) — so three scalar rotations reproduce the same
     transform without a hard three.js dependency).
   • liftCoeff(aoaDeg) — samples a small hardcoded Cl(alpha) keypoint table:
     rises from 0, peaks ~16-18deg, then DROPS HARD past ~20deg — the stall.
   • aeroForces(local, opts) — given a body-frame velocity, returns the lift
     (perpendicular to velocity in the pitch plane) and a 6-directional drag
     vector (separate coefficient per local axis SIGN, so sideways/backwards
     motion bleeds off faster than streamlined forward flight), plus the AoA
     and a `stalled` flag.
   • groundEffectMul(heightAboveGround, span) — lift bonus ramping up as the
     aircraft gets within ~1-1.25x rotor-diameter/wingspan of the ground.
   • etlMul(forwardSpeed, loSpd, hiSpd) — helicopter effective-translational-
     lift ramp: ~0.85 hovering → 1.0 once forward airspeed clears the band.
   • homingSteer(dir, toTargetX, toTargetY, toTargetZ, turnRateRad, dt) —
     proportional-nav-lite missile guidance: blends the missile's current
     heading toward the target bearing at a capped turn rate, so a
     manoeuvring target can out-turn it but a straight-flying one gets run
     down. Pure direction math, no scene access.

   • heliStep / planeStep — the player's helicopter and EVERY player
     fixed-wing (jets, airliners, props, the B-2): pure state-in/state-out
     flight steps, flown headless by tools/heli-flight-check.mjs and
     tools/plane-flight-check.mjs. Attitude convention for both: pitch + =
     nose up, roll + = right wing down, heading increasing = turning left.

   Nothing here owns state — every consumer keeps its own craft object and
   passes scalars in, scalars out. Load this BEFORE aircraft.js (which is the
   first consumer) and before playeraircraft.js.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;          // pure-math module — no THREE/scene dependency at all

  // ---- Cl(alpha) stall curve --------------------------------------------
  // (angleDeg, Cl) keypoints for the POSITIVE half only — rises through the
  // linear region, peaks around 16-18deg (the real-world ballpark for a
  // simple wing/rotor section before separation), then collapses hard past
  // 20deg (the stall), and tapers toward a small residual at 90deg (flat
  // plate / fully-stalled drag-dominated regime). liftCoeff() mirrors this
  // table by SIGN for negative AoA, so the curve is odd-symmetric about 0 —
  // nose-down flight stalls and recovers exactly the same way nose-up does.
  const CL_CURVE = [
    [0, 0.05], [4, 0.55], [8, 0.95], [12, 1.25], [16, 1.42], [18, 1.46],
    [20, 1.30], [24, 0.75], [30, 0.45], [40, 0.30], [60, 0.18], [90, 0.05],
  ];
  function liftCoeff(aoaDeg) {
    const neg = aoaDeg < 0;
    const a = neg ? -aoaDeg : aoaDeg;
    let v;
    if (a >= 90) v = CL_CURVE[CL_CURVE.length - 1][1];
    else {
      v = CL_CURVE[0][1];
      for (let i = 0; i < CL_CURVE.length - 1; i++) {
        const p0 = CL_CURVE[i], p1 = CL_CURVE[i + 1];
        if (a >= p0[0] && a <= p1[0]) {
          const t = (p1[0] - p0[0]) > 0.0001 ? (a - p0[0]) / (p1[0] - p0[0]) : 0;
          v = p0[1] + (p1[1] - p0[1]) * t;
          break;
        }
      }
    }
    return neg ? -v : v;
  }
  const STALL_AOA = 20;   // |AoA| beyond this = stalled (lift has already collapsed in the curve)

  // ---- world → body-frame velocity (plain trig, no THREE.Quaternion) ----
  // Order matches every consumer's group.rotation.set(pitch, heading, roll)
  // (THREE's default Euler order 'XYZ' applied as world rotations X then Y
  // then Z). To go world→local we undo it in reverse: un-yaw (heading) about
  // world Y, then un-pitch about the resulting local X, then un-roll about
  // the resulting local Z. Returns {x (right+), y (up+), z (forward+)}.
  function localVelocity(vx, vy, vz, heading, pitch, roll) {
    // undo heading (yaw about Y)
    const ch = Math.cos(-heading), sh = Math.sin(-heading);
    let x1 = vx * ch + vz * sh;
    let z1 = -vx * sh + vz * ch;
    let y1 = vy;
    // undo pitch (rotation about local X)
    const cp = Math.cos(-(pitch || 0)), sp = Math.sin(-(pitch || 0));
    let y2 = y1 * cp - z1 * sp;
    let z2 = y1 * sp + z1 * cp;
    // undo roll (rotation about local Z)
    const cr = Math.cos(-(roll || 0)), sr = Math.sin(-(roll || 0));
    let x3 = x1 * cr - y2 * sr;
    let y3 = x1 * sr + y2 * cr;
    return { x: x3, y: y3, z: z2 };
  }

  // ---- body-frame → world velocity (the EXACT inverse of localVelocity) ----
  // Needed wherever a consumer integrates a force (thrust/lift/drag) that was
  // computed in the body frame and has to be added back into a world-space
  // velocity. Hand-deriving this inline (undo each of localVelocity's three
  // rotations in reverse, each inverted) is easy to get subtly wrong (a sign
  // flip silently produces a "flyable but physically nonsense" craft) — this
  // is verified to round-trip localVelocity(worldVelocity(local)) === local
  // for arbitrary heading/pitch/roll, so every consumer should call THIS
  // rather than re-deriving its own inverse.
  function worldVelocity(lx, ly, lz, heading, pitch, roll) {
    const ch = Math.cos(-heading), sh = Math.sin(-heading);
    const cp = Math.cos(-(pitch || 0)), sp = Math.sin(-(pitch || 0));
    const cr = Math.cos(-(roll || 0)), sr = Math.sin(-(roll || 0));
    // undo step 3 (roll rotation applied to x1,y2 in the forward transform)
    const x1 = lx * cr + ly * sr;
    const y2 = -lx * sr + ly * cr;
    // undo step 2 (pitch rotation applied to y1,z1)
    const y1 = cp * y2 + sp * lz;
    const z1 = -sp * y2 + cp * lz;
    // undo step 1 (yaw rotation applied to vx,vz)
    const wx = ch * x1 - sh * z1;
    const wz = sh * x1 + ch * z1;
    return { x: wx, y: y1, z: wz };
  }

  // ---- six-directional drag ------------------------------------------------
  // dragCoef = {px,nx, py,ny, pz,nz} — one coefficient per local axis SIGN.
  // Streamlined forward (+z) flight gets the smallest coefficient; sideways
  // (x) and backwards (-z)/vertical (y) motion bleed off much faster — a heli
  // pirouette or a sideways slide scrubs speed quickly, exactly like the real
  // thing, while a clean forward dash stays efficient.
  function axisDrag(local, coef) {
    const dx = -Math.sign(local.x) * (local.x * local.x) * (local.x >= 0 ? coef.px : coef.nx);
    const dy = -Math.sign(local.y) * (local.y * local.y) * (local.y >= 0 ? coef.py : coef.ny);
    const dz = -Math.sign(local.z) * (local.z * local.z) * (local.z >= 0 ? coef.pz : coef.nz);
    return { x: dx, y: dy, z: dz };
  }

  // ---- full aero step --------------------------------------------------
  // local: body-frame velocity {x,y,z} (z=forward). opts:
  //   liftScale  — overall lift force scalar (rotor disc area / wing area proxy)
  //   dragCoef   — {px,nx,py,ny,pz,nz} six-axis drag coefficients
  //   groundMul  — ground-effect multiplier (1 = none, see groundEffectMul)
  //   etl        — ETL/efficiency multiplier (1 = full authority)
  //   incidenceDeg — fixed WING INCIDENCE added to the measured AoA before the
  //     Cl lookup (does NOT affect the reported/returned aoaDeg, which stays
  //     the true relative-wind angle for stall/HUD purposes). A real wing is
  //     mounted at a few degrees relative to the fuselage specifically so
  //     trimmed cruise flight doesn't need constant back-pressure on the
  //     stick — without it, level flight at a sane liftScale either can't
  //     hold altitude (too little lift) or floats away the instant you
  //     accelerate (too much). Default 0 (no behaviour change for any
  //     existing caller — only the player jet opts in).
  // Returns { liftLocal:{x,y,z}, dragLocal:{x,y,z}, aoaDeg, speed, stalled }.
  // Lift acts perpendicular to the velocity vector IN THE PITCH PLANE (the
  // local y/z plane) — i.e. it pushes toward local +y when AoA is positive,
  // scaled by Cl * speed^2, which is the standard "perpendicular to relative
  // wind, magnitude grows with the square of airspeed" lift law.
  function aeroForces(local, opts) {
    opts = opts || {};
    const liftScale = opts.liftScale != null ? opts.liftScale : 1;
    const dragCoef = opts.dragCoef || { px: 0.05, nx: 0.05, py: 0.05, ny: 0.05, pz: 0.012, nz: 0.06 };
    const groundMul = opts.groundMul != null ? opts.groundMul : 1;
    const etl = opts.etl != null ? opts.etl : 1;
    const incidenceDeg = opts.incidenceDeg || 0;
    const speed = Math.hypot(local.x, local.y, local.z);
    // AoA: angle between the forward axis and the velocity vector in the
    // pitch (y/z) plane. atan2(localY, localZ) — nose-up relative wind (sinking
    // through the air faster than flying forward) reads as a positive AoA.
    const aoaRad = Math.atan2(local.y, Math.max(0.0001, Math.abs(local.z)));
    const aoaSigned = local.z < 0 ? (Math.PI - aoaRad) * Math.sign(aoaRad || 1) : aoaRad;
    const aoaDeg = aoaSigned * 180 / Math.PI;
    const cl = liftCoeff(aoaDeg + incidenceDeg);
    const liftMag = cl * speed * speed * 0.5 * liftScale * groundMul * etl;
    // perpendicular-to-velocity direction within the local y/z plane, tipped
    // toward +y (up) — i.e. rotate the (y,z) velocity direction by +90deg.
    const planeLen = Math.hypot(local.y, local.z) || 1;
    const py = local.z / planeLen, pz = -local.y / planeLen;   // 90° CCW in (y,z)
    // keep lift pointing broadly "up" relative to the nose (flip if the
    // perpendicular came out pointing down for this velocity quadrant)
    const sgn = py >= 0 ? 1 : -1;
    const liftLocal = { x: 0, y: py * sgn * liftMag, z: pz * sgn * liftMag };
    const dragLocal = axisDrag(local, dragCoef);
    // stall threshold is on the CURVE input (aoaDeg+incidence — where Cl
    // actually collapses), not the raw relative-wind angle, so `stalled`
    // matches the lift that was actually computed above.
    return { liftLocal, dragLocal, aoaDeg, speed, stalled: Math.abs(aoaDeg + incidenceDeg) > STALL_AOA };
  }

  // ---- ground effect -----------------------------------------------------
  // heightAboveGround in metres, span = rotor diameter / wingspan. Ramps the
  // multiplier from 1 (no bonus) up to ~1.18 as the aircraft sinks under
  // ~1.25x span, peaking right at the ground (real ground effect is strongest
  // within about half a rotor/wing span). Smoothstep, clamped, cheap.
  function groundEffectMul(heightAboveGround, span) {
    const s = Math.max(1, span || 10);
    const thresh = s * 1.25;
    if (heightAboveGround >= thresh || heightAboveGround < 0) return 1;
    const t = 1 - Math.max(0, heightAboveGround) / thresh;     // 0 at threshold, 1 at the ground
    const smooth = t * t * (3 - 2 * t);
    return 1 + smooth * 0.18;
  }

  // ---- helicopter ETL (effective translational lift) --------------------
  // forwardSpeed in m/s (use the body-frame +z component). Smoothsteps from
  // ~0.85 (mushy hover, rotor working in its own disturbed downwash) up to
  // 1.0 once airspeed clears hiSpd (clean air, full efficiency). Defaults
  // roughly match 16-24kt (~8.2-12.3 m/s).
  function etlMul(forwardSpeed, loSpd, hiSpd) {
    const lo = loSpd != null ? loSpd : 8.2, hi = hiSpd != null ? hiSpd : 12.3;
    const sp = Math.max(0, forwardSpeed);
    if (sp <= lo) return 0.85;
    if (sp >= hi) return 1.0;
    const t = (sp - lo) / (hi - lo);
    const smooth = t * t * (3 - 2 * t);
    return 0.85 + smooth * 0.15;
  }

  // ---- proportional-navigation-LITE missile homing -----------------------
  // dir: current unit travel direction {x,y,z}. toTargetX/Y/Z: vector FROM the
  // missile TO the target (not normalized — pass the raw delta). turnRateRad
  // is the max radians/sec the missile can re-aim. Returns a NEW unit
  // direction nudged toward the target bearing, capped by the turn rate — so
  // a target that breaks hard (the bearing swings faster than turnRateRad)
  // keeps out-running the correction, but anything flying straight gets
  // tracked down. Pure vector math, intentionally simple (this is "lite" nav,
  // not true PN with closing-velocity gain) so it stays predictable/tunable.
  const _hs_tl = { x: 0, y: 0, z: 0 };
  function homingSteer(dir, toTargetX, toTargetY, toTargetZ, turnRateRad, dt) {
    const tl = Math.hypot(toTargetX, toTargetY, toTargetZ);
    if (tl < 0.0001) return dir;
    const tx = toTargetX / tl, ty = toTargetY / tl, tz = toTargetZ / tl;
    // angle between current dir and the target bearing
    let dot = dir.x * tx + dir.y * ty + dir.z * tz;
    dot = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(dot);
    const maxStep = turnRateRad * dt;
    if (angle <= maxStep || angle < 1e-5) return { x: tx, y: ty, z: tz };
    // slerp-lite: lerp then renormalize (cheap, good enough at these small
    // per-frame angles and avoids a full quaternion slerp dependency)
    const k = maxStep / angle;
    _hs_tl.x = dir.x + (tx - dir.x) * k;
    _hs_tl.y = dir.y + (ty - dir.y) * k;
    _hs_tl.z = dir.z + (tz - dir.z) * k;
    const l = Math.hypot(_hs_tl.x, _hs_tl.y, _hs_tl.z) || 1;
    return { x: _hs_tl.x / l, y: _hs_tl.y / l, z: _hs_tl.z / l };
  }

  // ---- THE PLAYER HELICOPTER, one pure step ------------------------------
  // Pure state in, state out (no scene, no keys), so a node check can fly it.
  //
  // Frame: heading h, nose = (sin h, cos h). The camera sits behind the nose,
  // so screen-RIGHT is (-cos h, sin h) and a LEFT turn is h INCREASING (the
  // planes' A/D and Q/E already turn that way). The old heli had both signs
  // backwards (A turned right, E slid left) AND an un-trimmable torque yaw
  // that turned the nose whenever W or UP was held, so hands-on-the-stick it
  // flew circles.
  //
  // inp: { cycF, cycR, pedal, coll } each -1..1
  //   cycF  cyclic fore/aft (+ forward)      cycR  lateral cyclic (+ right)
  //   pedal + = nose LEFT                    coll  collective (+ up)
  // env: { top, vlift, authority, onGround, autorotating, sink }
  // st (mutated): vx, vy, vz, heading, yawRate, bank, pitch, roll
  //   pitch/roll are the attitude the airframe SHOWS, in the one convention
  //   every craft shares: pitch + = nose UP, roll + = RIGHT wing down
  //   (playeraircraft.js setCraftRotation turns that into the group's
  //   rotation).
  const HELI_PEDAL_RATE = 1.15;    // rad/s at full pedal (a full turn in ~5.5 s)
  const HELI_BANK_MAX = 0.42;      // rad of commanded bank at full lateral cyclic
  const HELI_BANK_TURN = 0.75;     // rad/s turn at full bank in cruise
  const HELI_BACK_TOP = 12;        // m/s flying backwards
  const HELI_SIDE_TOP = 14;        // m/s sideways at the hover
  function heliStep(st, inp, dt, env) {
    const auth = env.authority != null ? env.authority : 1;
    const top = env.top || 40;
    const cycF = (inp.cycF || 0) * auth, cycR = (inp.cycR || 0) * auth;
    const pedal = (inp.pedal || 0) * auth, coll = inp.coll || 0;
    const h0 = st.heading || 0;
    let fx = Math.sin(h0), fz = Math.cos(h0), rx = -fz, rz = fx;
    // body-frame horizontal velocity
    let vf = st.vx * fx + st.vz * fz, vr = st.vx * rx + st.vz * rz;
    const parked = env.onGround && coll <= 0;
    // forward speed decides how much a sideways stick banks-and-turns (cruise)
    // versus slides (hover): 0 below 4 m/s, 1 above 14
    const t = Math.max(0, Math.min(1, (vf - 4) / 10)), cruise = t * t * (3 - 2 * t);
    // bank follows the lateral stick, levels itself hands-off
    const bankCmd = parked ? 0 : cycR * HELI_BANK_MAX;
    st.bank = (st.bank || 0) + (bankCmd - (st.bank || 0)) * Math.min(1, dt * 3);
    // yaw: the pedals, plus the coordinated turn a bank makes at speed. The
    // rate EASES to its target and the target is exactly 0 with hands off, so
    // nothing can spin the nose on its own.
    const pedalRate = parked ? 0 : pedal * HELI_PEDAL_RATE;
    // (g*tan(bank)/v is the true rate, but at 50 m/s that is a 70-second
    // circle; a game heli turns on the bank it shows, full stick ~8 s round)
    const bankRate = (!parked && cruise > 0) ? -HELI_BANK_TURN * (st.bank / HELI_BANK_MAX) * cruise : 0;
    st.yawRate = (st.yawRate || 0) + (pedalRate + bankRate - (st.yawRate || 0)) * Math.min(1, dt * 5);
    if (Math.abs(st.yawRate) < 1e-4 && !pedalRate && !bankRate) st.yawRate = 0;
    const dh = st.yawRate * dt;
    st.heading = h0 + dh;
    // a banked turn carries the flight path round with the nose (the rotor's
    // lift is what turns it); a pedal turn at speed is a skid the side drag
    // below straightens out
    const share = Math.abs(st.yawRate) > 1e-6 ? Math.max(0, Math.min(1, bankRate / st.yawRate)) : 0;
    const carry = dh * share;
    if (carry) {
      const c = Math.cos(carry), s = Math.sin(carry);
      const x = st.vx * c + st.vz * s, z = -st.vx * s + st.vz * c;
      st.vx = x; st.vz = z;
    }
    fx = Math.sin(st.heading); fz = Math.cos(st.heading); rx = -fz; rz = fx;
    vf = st.vx * fx + st.vz * fz; vr = st.vx * rx + st.vz * rz;
    // cyclic: each body axis eases toward the speed the stick asks for; hands
    // off that is zero, the trimmed hover holds still
    const wantF = parked ? 0 : (cycF >= 0 ? cycF * top : cycF * HELI_BACK_TOP);
    const wantR = parked ? 0 : cycR * HELI_SIDE_TOP * (1 - cruise);
    const kF = parked ? 6 : (Math.abs(wantF) > Math.abs(vf) ? 0.55 : 0.8);
    const kR = parked ? 6 : 1.6;
    vf += (wantF - vf) * Math.min(1, dt * kF);
    vr += (wantR - vr) * Math.min(1, dt * kR);
    if (!cycF && Math.abs(vf) < 0.02) vf = 0;
    if (!cycR && Math.abs(vr) < 0.02) vr = 0;
    st.vx = fx * vf + rx * vr; st.vz = fz * vf + rz * vr;
    if (Math.hypot(st.vx, st.vz) > top) { const s = top / Math.hypot(st.vx, st.vz); st.vx *= s; st.vz *= s; }
    // collective
    if (env.autorotating) {
      st.vy += ((env.sink != null ? env.sink : -6) - st.vy) * Math.min(1, dt * 3);
    } else {
      st.vy += (coll * (env.vlift || 14) - st.vy) * Math.min(1, dt * 3);
      if (!coll && Math.abs(st.vy) < 0.02) st.vy = 0;
    }
    // what the airframe SHOWS: nose down to accelerate and a little in cruise,
    // nose up to flare; bank into the turn, a smaller lean for a hover slide
    const tp = -Math.max(-0.35, Math.min(0.35, (wantF - vf) * 0.012 + vf * 0.0035));
    const tr = Math.max(-0.5, Math.min(0.5, st.bank * (0.45 + 0.55 * cruise) + (wantR - vr) * 0.012));
    st.pitch = (st.pitch || 0) + (tp - (st.pitch || 0)) * Math.min(1, dt * 4);
    st.roll = (st.roll || 0) + (tr - (st.roll || 0)) * Math.min(1, dt * 4);
    st.forward = vf;
    return st;
  }

  // ---- EVERY FIXED-WING THE PLAYER FLIES, one pure step --------------------
  // The F-22, a stolen base jet, the airliners, the prop planes and the B-2
  // all fly through here; the per-class row C is the personality.
  //
  // Same frame as heliStep: nose = (sin h, cos h), a RIGHT turn is h
  // DECREASING. pitch + = nose up, roll + = right wing down.
  //
  // inp: { pitch, roll, yaw, thr } each -1..1
  //   pitch + = pull back (nose up)      roll + = stick right (bank right)
  //   yaw   + = right rudder             thr  + = throttle up, - = down/brakes
  // env: { onGround, agl, authority, groundMul }
  // C:   { vmax, thrust, dragK, vstall, vminfly, vr, gacc, rollMax, rollRate,
  //        turnK, pitchMax, pitchRate, bleed, autoLevel, span }
  //   rollRate / pitchRate are rad/s at full stick; autoLevel is how fast a
  //   released bank fades (per s); turnK is the turn rate per sin(bank).
  // st (mutated): airspeed, thr, heading, pitch, roll, yawRate, sag, stalled,
  //   vx, vy, vz
  //
  // The stick flies the attitude: roll asks for a bank (proportional, rate
  // limited), pitch moves the nose at a rate and the nose STAYS where you
  // left it. Hands off, bank and pitch fade gently back to level, and with
  // wings level nothing turns the nose, so the plane flies straight. A bank
  // turns the plane its way (coordinated: the nose follows the lift), pulling
  // in a bank tightens the turn instead of only lifting the nose. The flight
  // path IS the nose (plus the stall sag), so what the airframe shows is
  // where it goes.
  const PLANE_PITCH_LEVEL = 0.35;   // per s: how gently a released nose eases to the horizon
  const PLANE_THR_RATE = 0.6;       // throttle travel per s (idle to full in ~1.7 s)
  const PLANE_ROTATE_MAX = 0.28;    // rad of nose-up the gear allows on the runway
  function clamp1(v) { return v > 1 ? 1 : (v < -1 ? -1 : (v || 0)); }
  function planeStep(st, inp, dt, env, C) {
    const auth = env.authority != null ? env.authority : 1;
    const onGround = !!env.onGround, agl = env.agl || 0;
    const pIn = clamp1(inp.pitch) * auth, rIn = clamp1(inp.roll) * auth;
    const yIn = clamp1(inp.yaw) * auth, tIn = clamp1(inp.thr);
    // throttle
    st.thr = Math.max(0, Math.min(1, (st.thr || 0) + tIn * PLANE_THR_RATE * dt));
    // airspeed: engine against drag, a climb bleeds it, a dive builds it
    let v = st.airspeed || 0;
    let pitch = st.pitch || 0, roll = st.roll || 0;
    v += (st.thr * C.thrust - C.dragK * v * v) * dt;
    v -= C.bleed * Math.sin(pitch) * dt;
    if (onGround) {
      v -= 0.4 * dt;                               // rolling friction
      if (tIn < 0) v -= C.gacc * 0.6 * dt;         // wheel brakes on throttle-down
      if (tIn <= 0 && v < 0.6) v = 0;              // parked stays parked
    } else if (tIn < 0 && st.thr <= 0) {
      v -= C.gacc * 0.2 * dt;                      // speed brakes: keep holding THR- at idle
    }
    v = Math.max(0, Math.min(C.vmax * 1.05, v));

    // ROLL: the stick asks for a bank, reached at up to rollRate
    if (onGround) roll += (0 - roll) * Math.min(1, dt * 6);
    else if (rIn) {
      const d = rIn * C.rollMax - roll;
      roll += Math.max(-C.rollRate, Math.min(C.rollRate, d * 3)) * dt;
    } else roll *= Math.max(0, 1 - C.autoLevel * dt);
    roll = Math.max(-C.rollMax, Math.min(C.rollMax, roll));
    const sr = Math.sin(roll), cr = Math.cos(roll);

    // PITCH: the stick moves the nose at a rate; hands off it holds, easing
    // gently to the horizon. On the runway the nosewheel holds it down until
    // rotate speed, and the tail limits how far you can lift it.
    if (onGround) {
      if (v >= C.vr && pIn > 0) pitch += pIn * C.pitchRate * dt;
      else pitch += (0 - pitch) * Math.min(1, dt * 3);
      pitch = Math.max(0, Math.min(PLANE_ROTATE_MAX, pitch));
    } else {
      if (pIn) pitch += pIn * C.pitchRate * (pIn > 0 ? Math.abs(cr) : 1) * dt;
      else pitch *= Math.max(0, 1 - PLANE_PITCH_LEVEL * dt);
      pitch = Math.max(-C.pitchMax, Math.min(C.pitchMax, pitch));
    }

    // STALL: under vstall the wing cannot hold the nose; it drops and the
    // bank wallows out. Flying speed back = control back.
    const stalled = !onGround && v < C.vstall && agl > 2;
    if (stalled) {
      pitch += (-0.5 - pitch) * Math.min(1, dt * 1.2);
      roll *= Math.max(0, 1 - 0.5 * dt);
    }

    // YAW: a coordinated bank turn (the nose follows the lift), a pull in the
    // bank tightens it, the rudder adds a flat yaw. A right bank turns right
    // (heading decreasing). On the ground the rudder and the stick both steer
    // the nosewheel.
    let yawRate = 0;
    if (!onGround && v > C.vminfly) {
      const pull = pIn > 0 ? pIn * C.pitchRate * 0.6 * Math.abs(sr) : 0;
      // the rudder: a flat yaw, weaker than the class's own bank turn
      yawRate = -(C.turnK * sr + pull * Math.sign(sr)) - yIn * C.turnK * 0.8;
    } else if (onGround && v > 0.5) {
      yawRate = -clamp1(yIn + rIn) * 0.9 * Math.min(1, v / C.vr);
    }
    st.heading = (st.heading || 0) + yawRate * dt;

    // SAG: under the lift band gravity wins; it fades once flying speed returns
    const liftFrac = onGround ? 1
      : Math.max(0, Math.min(1, (v - C.vminfly) / Math.max(1, C.vstall - C.vminfly)));
    let sag = Math.min(25, (st.sag || 0) + (1 - liftFrac) * 9.8 * dt);
    sag *= Math.max(0, 1 - (0.8 + 3.2 * liftFrac) * dt);

    // the flight path is the nose
    const cp = Math.cos(pitch);
    st.vx = Math.sin(st.heading) * cp * v;
    st.vz = Math.cos(st.heading) * cp * v;
    st.vy = Math.sin(pitch) * v - sag;
    const gm = env.groundMul || 1;
    if (!onGround && gm > 1) st.vy += (gm - 1) * 6;   // a floaty cushion right at the deck
    st.airspeed = v; st.pitch = pitch; st.roll = roll; st.sag = sag;
    st.yawRate = yawRate; st.stalled = stalled;
    return st;
  }

  CBZ.aeroPhysics = {
    liftCoeff, localVelocity, worldVelocity, aeroForces, groundEffectMul, etlMul, homingSteer,
    heliStep, planeStep, STALL_AOA,
  };
})();
