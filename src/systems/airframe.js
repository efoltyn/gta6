/* ============================================================
   systems/airframe.js — HOW AN AEROPLANE MOVES. One model, every aircraft.

   WHY. The engine can already BUILD aeroplanes (city/aircraft.js,
   world/airbase.js) and already flies them on RAILS (city/airtraffic.js
   moves airliners along routes; city/aircraftphysics.js handles the
   player's ride inside the city's own vehicle stack). What it never had
   was a small, standalone answer to "given a stick, a throttle and one
   second, where is this aeroplane now?" — usable by a slice page, an AI
   wingman, a cinematic camera rig and a player cockpit alike, with no
   city underneath it.

   THE MODEL — arcade in its numbers, honest in its shape. Six forces,
   in the order they matter to how it FEELS:

     1. THRUST      along the nose (−Z local), throttle × maxThrust.
     2. LIFT        along local up, ∝ v² — which is the one term that
                    makes an aeroplane an aeroplane: it flies because it
                    is fast, so losing speed loses altitude, and pulling
                    hard costs speed. Everything below follows from it.
     3. GRAVITY     straight down, always, no exceptions.
     4. DRAG        ∝ v², plus INDUCED drag that rises with how hard the
                    wing is working (a hard turn bleeds energy).
     5. GRIP        velocity is pulled toward the nose over time. This is
                    the arcade term and it is deliberate: without it a
                    keyboard pilot drifts sideways forever and reports
                    the controls as "broken". With it, pointing the nose
                    somewhere eventually takes you there.
     6. CONTROL AUTHORITY ∝ airspeed. A stationary aeroplane on the ramp
                    does not pirouette on the stick, and a stalled one
                    barely answers — which is what makes a stall READ as
                    a stall rather than as a bug.

   STALL is not a state machine, it is a curve: below `stallSpeed` the
   lift coefficient falls off (smoothstep, not a cliff), so the nose
   drops, the aeroplane accelerates, and it flies again. It recovers by
   physics, so nothing has to write recovery logic.

   GROUND is a callback, not a plane. `groundAt(x,z)` lets the same
   airframe roll on a runway pad, belly into a dune and fly over a
   mountain without knowing what any of those are.

   WHAT IT DOES NOT DO, on purpose: no collision (the caller owns the
   world), no damage model, no weapons (systems/ordnance.js), no camera
   (systems/camera.js and the caller). It is a rigid body with wings.

   USE:
     const af = CBZ.airframe.make({preset:"bomber", groundAt: fn});
     af.place(x, y, z, headingRad);
     af.step(dt, {pitch:-1..1, roll:-1..1, yaw:-1..1, throttle:0..1, brake});
     af.applyTo(mesh);            // position + quaternion, one call

   Flags: AIRFRAME_V1 (master). Audit: CBZ.airframeAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.AIRFRAME_V1 == null) CBZ.CONFIG.AIRFRAME_V1 = true;
  if (CBZ.CONFIG.AIRFRAME_V1 === false) return;

  const airframe = (CBZ.airframe = CBZ.airframe || {});
  let liveCount = 0;

  // ---- PRESETS. Each one is a claim about how the aircraft should feel,
  //      not a spec sheet. Every number below is DERIVED, not dialled, and
  //      the three equations that derive them are worth stating because a
  //      hand-tuned lift constant is how an arcade flight model ends up
  //      pulling 24 g in level cruise and flying itself into the ground:
  //
  //        liftK = G / (v_cruise² × baseCl)   ← level flight at cruise costs
  //                                             exactly one gravity
  //        dragK = maxThrust / v_max²         ← top speed IS the drag
  //                                             equilibrium, not a clamp
  //        v_stall = √(G / (liftK × clMax))   ← falls out of the first two;
  //                                             stallSpeed only LABELS it
  //
  //      baseCl = 0.34 and clMax ≈ 1.93 (0.34 + 0.6×2.6 + trim) come from the
  //      cl curve in step(). Accelerations are m/s². Speeds are m/s.
  const PRESETS = {
    // cruise 120, top 254, stalls ~51 — heavy, slow to answer, hard to stop
    bomber: {
      maxThrust: 7.5, liftK: 0.00195, dragK: 0.000116, inducedK: 0.030, grip: 0.85,
      pitchRate: 0.55, rollRate: 1.05, yawRate: 0.28,
      stallSpeed: 55, maxSpeed: 254, gearHeight: 3.4, rollDamp: 2.4, trim: 0.03,
    },
    // cruise 160, top 403, stalls ~68 — twitchy, fast, unforgiving slow
    fighter: {
      maxThrust: 13, liftK: 0.00110, dragK: 0.000080, inducedK: 0.030, grip: 1.70,
      pitchRate: 1.35, rollRate: 2.80, yawRate: 0.55,
      stallSpeed: 66, maxSpeed: 403, gearHeight: 2.1, rollDamp: 3.4, trim: 0.03,
    },
    // cruise 115, top 207 — the freighter: it goes where it is pointed, later
    transport: {
      maxThrust: 6.0, liftK: 0.00185, dragK: 0.000140, inducedK: 0.030, grip: 0.70,
      pitchRate: 0.46, rollRate: 0.80, yawRate: 0.24,
      stallSpeed: 53, maxSpeed: 207, gearHeight: 3.8, rollDamp: 2.0, trim: 0.04,
    },
  };
  airframe.presets = PRESETS;

  const G = 9.81;
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  const _tmp = new THREE.Vector3(), _acc = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sm(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  airframe.make = function (spec) {
    spec = spec || {};
    const P = Object.assign({}, PRESETS[spec.preset] || PRESETS.fighter, spec);
    const groundAt = spec.groundAt || function () { return 0; };
    liveCount++;

    const af = {
      spec: P,
      pos: new THREE.Vector3(0, 200, 0),
      vel: new THREE.Vector3(0, 0, 0),
      quat: new THREE.Quaternion(),
      throttle: 0.6,
      speed: 0,
      agl: 0,
      gLoad: 1,
      stalled: false,
      grounded: false,
      alive: true,
      // vertical speed at the instant the wheels last met the ground. The
      // caller decides what counts as a crash — this file only reports the
      // arrival, because "how hard is too hard" is a game rule, not physics.
      touchdownSpeed: 0,
      // last control input, kept so a caller can echo it into an animation
      ctrl: { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brake: 0 },
    };

    af.place = function (x, y, z, heading, pitch) {
      af.pos.set(x, y, z);
      _e.set(pitch || 0, heading || 0, 0, "YXZ");
      af.quat.setFromEuler(_e);
      af.vel.set(0, 0, 0);
      return af;
    };
    // launch already flying: the caller gives a heading and an airspeed and
    // the velocity comes out consistent with the attitude, every time.
    af.launch = function (x, y, z, heading, speed) {
      af.place(x, y, z, heading, -0.03);
      af.forward(_f);
      af.vel.copy(_f).multiplyScalar(speed != null ? speed : P.stallSpeed * 1.9);
      af.throttle = 0.85;
      return af;
    };

    af.forward = function (out) { return (out || _f).set(0, 0, -1).applyQuaternion(af.quat); };
    af.up = function (out) { return (out || _u).set(0, 1, 0).applyQuaternion(af.quat); };
    af.right = function (out) { return (out || _r).set(1, 0, 0).applyQuaternion(af.quat); };
    af.heading = function () {
      af.forward(_f);
      return Math.atan2(-_f.x, -_f.z);
    };

    af.step = function (dt, ctrl) {
      if (!af.alive || !(dt > 0)) return af;
      ctrl = ctrl || af.ctrl;
      const pitchIn = clamp(ctrl.pitch || 0, -1, 1);
      const rollIn = clamp(ctrl.roll || 0, -1, 1);
      const yawIn = clamp(ctrl.yaw || 0, -1, 1);
      const brake = clamp(ctrl.brake || 0, 0, 1);
      if (ctrl.throttle != null) af.throttle = clamp(ctrl.throttle, 0, 1);
      af.ctrl.pitch = pitchIn; af.ctrl.roll = rollIn; af.ctrl.yaw = yawIn;
      af.ctrl.throttle = af.throttle; af.ctrl.brake = brake;

      const v = af.vel;
      const speed = v.length();
      af.speed = speed;
      af.forward(_f); af.up(_u); af.right(_r);

      const ground = groundAt(af.pos.x, af.pos.z);
      af.agl = af.pos.y - ground - P.gearHeight;
      const wasGrounded = af.grounded;
      af.grounded = af.agl <= 0.05;

      // ---- 6. control authority ∝ airspeed (see header)
      const auth = clamp(speed / (P.stallSpeed * 1.15), 0, 1.35);
      // On the ground the stick does nothing until the wheels are light —
      // steering there is the RUDDER, which is why yaw keeps its authority.
      // But the elevator MUST bite at rotation speed or the aeroplane rolls
      // down the runway forever with the stick in its lap, which is the bug
      // a flat 0.15 ground factor produces and nobody spots until takeoff.
      const rotating = speed > P.stallSpeed * 0.75;
      const airAuth = af.grounded ? auth * (rotating ? 0.70 : 0.15) : auth;

      _q.setFromAxisAngle(_r, pitchIn * P.pitchRate * airAuth * dt); af.quat.premultiply(_q);
      _q.setFromAxisAngle(_f, -rollIn * P.rollRate * airAuth * dt); af.quat.premultiply(_q);
      _q.setFromAxisAngle(_u, -yawIn * P.yawRate * (af.grounded ? Math.min(1, speed / 30) : auth) * dt);
      af.quat.premultiply(_q);
      af.quat.normalize();
      af.forward(_f); af.up(_u); af.right(_r);

      // ---- roll damping toward wings-level. Real aeroplanes have positive
      //      dihedral stability; without this a keyboard pilot ends every
      //      flight inverted and blames the controls.
      if (!af.grounded && Math.abs(rollIn) < 0.05 && speed > P.stallSpeed * 0.5) {
        const bank = Math.atan2(_u.x * -Math.sin(af.heading()) + _u.z * Math.cos(af.heading()), _u.y);
        _q.setFromAxisAngle(_f, clamp(bank, -1, 1) * P.rollDamp * 0.06 * dt * auth);
        af.quat.premultiply(_q);
        af.quat.normalize();
        af.forward(_f); af.up(_u); af.right(_r);
      }

      _acc.set(0, 0, 0);

      // ---- 1. thrust
      _acc.addScaledVector(_f, P.maxThrust * af.throttle);

      // ---- 2. lift ∝ v², with the STALL CURVE (see header)
      const stallT = sm((speed - P.stallSpeed * 0.55) / (P.stallSpeed * 0.55));
      af.stalled = stallT < 0.6 && !af.grounded;
      // angle of attack proxy: how much of the velocity is "under" the wing
      const aoa = speed > 1 ? clamp(-_tmp.copy(v).normalize().dot(_u), -0.6, 0.6) : 0;
      const cl = (0.34 + aoa * 2.6 + P.trim) * stallT;
      const lift = P.liftK * speed * speed * cl;
      _acc.addScaledVector(_u, lift);
      af.gLoad = lift / G;

      // ---- 3. gravity
      _acc.y -= G;

      // ---- 4. drag: parasitic + induced (a hard turn bleeds energy)
      if (speed > 0.01) {
        const parasitic = P.dragK * speed * speed;
        const induced = P.inducedK * lift * Math.abs(cl);
        _acc.addScaledVector(_tmp.copy(v).multiplyScalar(1 / speed), -(parasitic + induced));
      }

      v.addScaledVector(_acc, dt);

      // ---- 5. grip: pull velocity toward the nose (the arcade term)
      const sp2 = v.length();
      if (sp2 > 0.5 && !af.grounded) {
        _tmp.copy(_f).multiplyScalar(sp2);
        v.lerp(_tmp, clamp(P.grip * dt * (0.3 + stallT * 0.7), 0, 0.9));
      }
      // top speed is a drag equilibrium in theory and a clamp in practice —
      // the clamp is here so a dive cannot outrun the collision step
      const sp3 = v.length();
      if (sp3 > P.maxSpeed) v.multiplyScalar(P.maxSpeed / sp3);

      af.pos.addScaledVector(v, dt);

      // ---- the ground
      const g2 = groundAt(af.pos.x, af.pos.z);
      const floor = g2 + P.gearHeight;
      if (af.pos.y <= floor) {
        const vy = v.y;
        af.pos.y = floor;
        af.grounded = true;
        if (vy < 0) v.y = 0;
        // WHEEL DRAG IS A FORCE, NOT A DECAY. Scaling ground speed by a
        // fixed fraction per second makes rolling resistance grow with
        // speed, which silently imposes a top taxi speed of thrust/decay —
        // 21 m/s for the bomber, a third of what it needs to rotate. The
        // aeroplane then accelerates down the runway forever and never
        // flies, and nothing in the model says why. A constant deceleration
        // opposing the roll is both the real physics and the fix.
        const horiz = Math.hypot(v.x, v.z);
        if (horiz > 0.01) {
          const decel = (0.28 + brake * 9.0) * dt;
          const f = Math.max(0, 1 - decel / horiz);
          v.x *= f; v.z *= f;
        }
        _e.setFromQuaternion(af.quat, "YXZ");
        _e.x += (0 - _e.x) * Math.min(1, dt * 3.0);
        _e.z += (0 - _e.z) * Math.min(1, dt * 3.0);
        af.quat.setFromEuler(_e);
        // a hard arrival is the caller's business, not ours — report it
        if (!wasGrounded) af.touchdownSpeed = -vy;
      }
      af.speed = v.length();
      return af;
    };

    af.applyTo = function (obj) {
      if (!obj) return af;
      obj.position.copy(af.pos);
      obj.quaternion.copy(af.quat);
      return af;
    };

    // Where the nose is pointing, `dist` ahead — the one query a camera, an
    // AI wingman and a lead-pursuit solution all want.
    af.pointAhead = function (dist, out) {
      af.forward(_f);
      return (out || new THREE.Vector3()).copy(af.pos).addScaledVector(_f, dist);
    };

    // Steer toward a world point: returns {pitch, roll, yaw} for step(). This
    // is the whole AI pilot — everything an autopilot needs is the error in
    // the aeroplane's OWN axes, which is what makes it a three-line loop.
    af.steerTo = function (target, opts) {
      opts = opts || {};
      _tmp.copy(target).sub(af.pos);
      const dist = _tmp.length();
      if (dist < 0.01) return { pitch: 0, roll: 0, yaw: 0 };
      _tmp.multiplyScalar(1 / dist);
      af.forward(_f); af.up(_u); af.right(_r);
      const fwdDot = _tmp.dot(_f);
      const rightDot = _tmp.dot(_r);
      const upDot = _tmp.dot(_u);
      // bank to turn: the roll command IS the lateral error, and pitch pulls
      // the nose through the turn. That is how aeroplanes turn and why an
      // autopilot that only yaws looks like a boat.
      const gain = opts.gain != null ? opts.gain : 2.6;
      const roll = clamp(rightDot * gain * (fwdDot > -0.2 ? 1 : -1), -1, 1);
      const pitch = clamp(upDot * gain + (opts.pitchBias || 0), -1, 1);
      const yaw = clamp(rightDot * 0.35, -1, 1);
      return { pitch: pitch, roll: roll, yaw: yaw, dist: dist, ahead: fwdDot };
    };

    // Hold an altitude — the other half of every autopilot, kept separate so
    // a caller can mix "fly to X" with "stay at 400 m".
    //
    // THREE TERMS, PLUS THE ONE THAT MATTERS. The naive autopilot (elevator
    // ∝ altitude error) is an undamped second-order loop: it arrives at the
    // target at maximum climb rate, sails through, and porpoises wider every
    // cycle until it stalls or hits something — and it gets WORSE at low
    // frame rates, which is how it survives testing on a fast machine.
    //
    // So this is the real cascade — altitude → vertical speed → pitch
    // ATTITUDE → elevator — and it carries the term that makes the whole
    // thing settle instead of hunt: a FEED-FORWARD TRIM. The autopilot does
    // not discover the nose-up attitude that holds level flight by sinking
    // until the error is big enough to notice; it INVERTS the lift equation
    // in step() and asks directly, "at this speed, what angle of attack is
    // one gravity?" The feedback loop is then only correcting the residue,
    // which is what a feedback loop is for.
    af.holdAltitude = function (targetY, base, opts) {
      opts = opts || {};
      const out = base || { pitch: 0, roll: 0, yaw: 0 };
      const climbCap = opts.climbRate != null ? opts.climbRate : 22;
      const spd = Math.max(20, af.speed);

      const wantVy = clamp((targetY - af.pos.y) * 0.12, -climbCap, climbCap);
      const wantGamma = clamp(wantVy / spd, -0.40, 0.40);        // flight path
      // invert cl = 0.34 + aoa×2.6 + trim for the cl that gives exactly 1 g
      const clNeeded = G / (P.liftK * spd * spd);
      const aoaTrim = clamp((clNeeded - 0.34 - P.trim) / 2.6, -0.10, 0.50);
      const wantPitch = clamp(wantGamma + aoaTrim, -0.50, 0.62);

      _e.setFromQuaternion(af.quat, "YXZ");                      // .x = nose-up
      out.pitch = clamp(out.pitch + (wantPitch - _e.x) * 3.2, -1, 1);
      return out;
    };

    af.dispose = function () { af.alive = false; liveCount--; };
    return af;
  };

  CBZ.airframeAudit = function () {
    return { live: liveCount, presets: Object.keys(PRESETS) };
  };
})();
