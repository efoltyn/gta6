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

   THE AUTOPILOT IS NOT THE PHYSICS, and the line between them is load
   bearing. `step()` is the aeroplane: it takes a stick position, and a
   human holding full aileron rolls inverted and stays there, because
   that is what an aeroplane does. `steerTo()` and `holdAltitude()` are
   the PILOT: they command a bank ANGLE, capped by the preset's
   `bankLimit`, and hold it with a proportional loop on the measured
   bank. Every limit in this file that is about airmanship rather than
   aerodynamics lives on that side of the line. See steerTo() for the
   failure this cost us — a roll RATE command with no angle feedback is
   an integrator with no stop, and it flew 173 aircraft into the ground.

   WHAT IT DOES NOT DO, on purpose: no collision (the caller owns the
   world), no damage model, no weapons (systems/ordnance.js), no camera
   (systems/camera.js and the caller). It is a rigid body with wings.

   USE:
     const af = CBZ.airframe.make({preset:"bomber", groundAt: fn});
     af.place(x, y, z, headingRad);
     af.step(dt, {pitch:-1..1, roll:-1..1, yaw:-1..1, throttle:0..1, brake});
     af.applyTo(mesh);            // position + quaternion, one call
     af.bank();                   // signed, +ve = right wing down

   Flags: AIRFRAME_V1 (master), AIRFRAME_BANK_HOLD_V1 (the bank-angle
   autopilot; false restores the rate command it replaced).
   Audit: CBZ.airframeAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.AIRFRAME_V1 == null) CBZ.CONFIG.AIRFRAME_V1 = true;
  if (CBZ.CONFIG.AIRFRAME_V1 === false) return;
  // The autopilot's bank-angle loop (see steerTo). One-line revert to the
  // rate command it replaced, kept live because it is also the only honest
  // way to A/B the thing in a running match.
  if (CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 == null) CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 = true;

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
  //
  //      bankLimit is the AUTOPILOT's limit, in radians, and it is a claim
  //      about the aeroplane's job rather than its structure: a bomber holds
  //      a camera steady (30°, standard rate for a heavy), a fighter is
  //      allowed to fight (60°, ~2 g), a freighter carries cargo that is not
  //      strapped down as well as anyone says it is (25°). Nothing in step()
  //      reads it — a human on the stick still has every degree of roll the
  //      airframe has, up to and including inverted.
  const PRESETS = {
    // cruise 120, top 254, stalls ~51 — heavy, slow to answer, hard to stop
    bomber: {
      maxThrust: 7.5, liftK: 0.00195, dragK: 0.000116, inducedK: 0.030, grip: 0.85,
      pitchRate: 0.55, rollRate: 1.05, yawRate: 0.28,
      stallSpeed: 55, maxSpeed: 254, gearHeight: 3.4, rollDamp: 2.4, trim: 0.03,
      bankLimit: 0.52,
    },
    // cruise 160, top 403, stalls ~68 — twitchy, fast, unforgiving slow
    fighter: {
      maxThrust: 13, liftK: 0.00110, dragK: 0.000080, inducedK: 0.030, grip: 1.70,
      pitchRate: 1.35, rollRate: 2.80, yawRate: 0.55,
      stallSpeed: 66, maxSpeed: 403, gearHeight: 2.1, rollDamp: 3.4, trim: 0.03,
      bankLimit: 1.05,
    },
    // cruise 115, top 207 — the freighter: it goes where it is pointed, later
    transport: {
      maxThrust: 6.0, liftK: 0.00185, dragK: 0.000140, inducedK: 0.030, grip: 0.70,
      pitchRate: 0.46, rollRate: 0.80, yawRate: 0.24,
      stallSpeed: 53, maxSpeed: 207, gearHeight: 3.8, rollDamp: 2.0, trim: 0.04,
      bankLimit: 0.44,
    },
  };
  airframe.presets = PRESETS;

  const G = 9.81;
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  const _tmp = new THREE.Vector3(), _acc = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  // bank() gets its OWN scratch. It is called from inside step() between the
  // two places _f/_u/_r are refreshed, and from holdAltitude() either side of
  // _e — a shared temporary here is a silent aliasing bug waiting for the
  // next edit.
  const _bf = new THREE.Vector3(), _bu = new THREE.Vector3();

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sm(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  // ---- Bank-hold loop gain, 1/s: the attitude error is multiplied by this
  //      to get a commanded roll RATE. ~0.4 s to settle, and BANK_KP × dt
  //      stays well under 1 even at the engine's worst clamped frame (0.1 s),
  //      which is what keeps it stable on a slow machine — the property the
  //      rate command it replaced did not have.
  const BANK_KP = 2.2;

  // ---- NOSE-UP AUTHORITY vs BANK. Wings level, the elevator lifts. On its
  //      side, "up" elevator points at the HORIZON, and pulling is a turn
  //      into the ground — which is exactly how an altitude hold kills an
  //      aeroplane that is already over. Full pull inside the limit, faded to
  //      nothing by knife-edge, so the roll loop unwinds the bank BEFORE the
  //      pitch loop is allowed to do anything about the altitude. Down
  //      elevator is never limited: lowering the nose is always allowed.
  function pullAuth(bank, lim) {
    const b = Math.abs(bank);
    if (b <= lim) return 1;
    return 1 - sm((b - lim) / Math.max(0.15, Math.PI / 2 - lim));
  }

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
    // BANK ANGLE, signed, +ve = right wing down — deliberately the SAME sign
    // as a positive roll input, so an autopilot error term needs no sign
    // gymnastics and a reader can check it against the stick.
    //
    // It is measured by projecting the wing's "up" onto the HORIZONTAL RIGHT
    // axis at the current heading. The obvious-looking projection onto
    // (−sin h, 0, cos h) is the horizontal BACKWARD axis, and picking it by
    // mistake yields a number that is zero in a 90° bank and equal to the
    // PITCH angle in level flight. That mistake shipped, and it is why the
    // roll damper below used to roll the aeroplane in proportion to how
    // nose-up it was. Right is (cos h, 0, −sin h). Check it at h = 0.
    af.bank = function () {
      af.forward(_bf); af.up(_bu);
      const h = Math.atan2(-_bf.x, -_bf.z);
      const rx = Math.cos(h), rz = -Math.sin(h);
      return Math.atan2(-(_bu.x * rx + _bu.z * rz), _bu.y);
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
      //
      //      IT WAS GATED OFF BY THE STICK (`|rollIn| < 0.05`), which meant
      //      the one term that rights an aeroplane was disabled exactly
      //      whenever something was steering it — and an AI is steering it
      //      always. A recovery term that switches off under command is not a
      //      recovery term. Attenuate with stick pressure instead of gating:
      //      at full deflection the commanded roll rate still out-rates the
      //      damper by better than 7:1, so a human keeps every degree of
      //      authority he had, including rolling inverted and staying there
      //      as long as he holds it.
      const legacyRoll = CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 === false;
      if (!af.grounded && speed > P.stallSpeed * 0.5 &&
          !(legacyRoll && Math.abs(rollIn) >= 0.05)) {
        const damp = P.rollDamp * 0.06 * (legacyRoll ? 1 : 1 - 0.85 * Math.abs(rollIn));
        const b = legacyRoll
          ? Math.atan2(_u.x * -Math.sin(af.heading()) + _u.z * Math.cos(af.heading()), _u.y)
          : af.bank();
        _q.setFromAxisAngle(_f, clamp(b, -1, 1) * damp * dt * auth);
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
    // is the whole AI pilot — and it is an AUTOPILOT, which is the entire
    // point of the shape below.
    //
    // ---- THE FAILURE MODE THIS FUNCTION EXISTS TO RECORD ----------------
    // The first version returned `roll = clamp(lateralError × gain, -1, 1)`.
    // step() applies roll as a RATE. **A rate command with no angle feedback
    // is an integrator with no stop.** With the shipped gain of 2.0 anything
    // more than ~30° off the nose saturates the command, so the aeroplane
    // rolls at full rate and NOTHING anywhere asks how far over it already
    // is. Measured on a bomber in bomb-survivor (2026-08-07, 181 s, 4463
    // samples): 58% of flight time past 60° of bank, peak 179.6° — inverted.
    // holdAltitude() then did the killing: at 90° of bank the lift vector
    // points at the horizon, so "nose up to hold 450 m" is a turn straight
    // into the deck at full throttle. 24 AI aircraft lost in three minutes,
    // every one of them with no killer, wings past vertical, not stalled and
    // not grounded until the last frame.
    //
    // The fix is the shape a real autopilot has: command a bank ANGLE, hold
    // it with a proportional loop on the MEASURED bank, and clamp the
    // COMMAND rather than the stick. Saturating a bank-angle command is
    // harmless — it means "roll to the limit and stop there" — and recovery
    // from an upset falls out for free: at 90° of bank with a 30° limit the
    // error is −60° and the loop is already commanding full opposite roll.
    // It is also frame-rate honest, where the rate command was not: a
    // proportional attitude loop settles on the same angle whether it is
    // ticked at 5 Hz or 200 Hz.
    //
    // The limit lives HERE and not in step() on purpose. step() is the
    // physics and knows nothing about bank limits; a human on the stick
    // still rolls inverted whenever he likes.
    af.steerTo = function (target, opts) {
      opts = opts || {};
      const bank = af.bank();
      const lim = opts.bankLimit != null ? opts.bankLimit
        : (P.bankLimit != null ? P.bankLimit : 0.6);
      _tmp.copy(target).sub(af.pos);
      const dist = _tmp.length();
      if (dist < 0.01) return { pitch: 0, roll: 0, yaw: 0, dist: 0, ahead: 1, bank: bank, wantBank: 0 };
      _tmp.multiplyScalar(1 / dist);
      af.forward(_f); af.up(_u); af.right(_r);
      const fwdDot = _tmp.dot(_f);
      const rightDot = _tmp.dot(_r);
      const upDot = _tmp.dot(_u);
      const gain = opts.gain != null ? opts.gain : 2.6;

      if (CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 === false) {
        // the rate command, kept only so the bug above can be measured
        return {
          pitch: clamp(upDot * gain + (opts.pitchBias || 0), -1, 1),
          roll: clamp(rightDot * gain * (fwdDot > -0.2 ? 1 : -1), -1, 1),
          yaw: clamp(rightDot * 0.35, -1, 1),
          dist: dist, ahead: fwdDot, bank: bank, wantBank: null,
        };
      }

      // ---- the turn is a HEADING error, taken in the horizontal plane. Body
      //      lateral error cannot tell "he is off to my right" from "I am
      //      rolled ninety degrees", and feeding that to a roll loop is how
      //      the spiral started. A heading error is blind to attitude, which
      //      is what a turn actually has to null.
      const hMag = Math.hypot(_tmp.x, _tmp.z);
      let hErr = 0;
      if (hMag > 1e-3) {
        hErr = Math.atan2(-_tmp.x, -_tmp.z) - af.heading();
        while (hErr > Math.PI) hErr -= Math.PI * 2;
        while (hErr < -Math.PI) hErr += Math.PI * 2;
        // dead astern is ±180° and the sign there is a coin toss that flips
        // every frame. Break the tie with the wing he is actually on.
        if (Math.abs(hErr) > Math.PI * 0.97) hErr = (rightDot >= 0 ? 1 : -1) * Math.abs(hErr);
      }
      // beyond ~1/gain radians of heading error this is simply "turn as hard
      // as this aeroplane is allowed to" — a bounded, meaningful saturation
      const wantBank = clamp(hErr * gain, -1, 1) * lim;
      // Attitude error → roll RATE, expressed in stick units. Dividing by
      // rollRate is what keeps the loop preset-independent: the bomber and
      // the fighter both settle on their commanded bank in about half a
      // second even though one rolls 2.7× faster than the other.
      const roll = clamp((wantBank - bank) * BANK_KP / P.rollRate, -1, 1);

      let pitch = clamp(upDot * gain + (opts.pitchBias || 0), -1, 1);
      if (pitch > 0) pitch *= pullAuth(bank, lim);
      const yaw = clamp(rightDot * 0.35, -1, 1);
      return {
        pitch: pitch, roll: roll, yaw: yaw, dist: dist, ahead: fwdDot,
        bank: bank, wantBank: wantBank, hErr: hErr,
      };
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
    //
    // THE FOURTH TERM IS BANK, and leaving it out is what made this function
    // the murder weapon. An altitude hold that does not look at the wings
    // will happily command maximum nose-up at 90° of bank, where nose-up is
    // a level turn into the ground. Two things follow from the wings:
    //
    //   · inside the limit, a banked wing carries its load at 1/cos φ, so
    //     holding altitude in a turn genuinely needs more angle of attack.
    //     That is a real term, and putting it in the FEED-FORWARD (where the
    //     rest of the trim already lives) is why a turn no longer sags.
    //   · past the limit, nose-up authority fades out (pullAuth) so the roll
    //     loop unwinds the bank first and the pitch loop gets its turn once
    //     the lift vector is pointing somewhere useful again.
    af.holdAltitude = function (targetY, base, opts) {
      opts = opts || {};
      const out = base || { pitch: 0, roll: 0, yaw: 0 };
      const climbCap = opts.climbRate != null ? opts.climbRate : 22;
      const spd = Math.max(20, af.speed);
      const bank = af.bank();
      const lim = opts.bankLimit != null ? opts.bankLimit
        : (P.bankLimit != null ? P.bankLimit : 0.6);

      const wantVy = clamp((targetY - af.pos.y) * 0.12, -climbCap, climbCap);
      const wantGamma = clamp(wantVy / spd, -0.40, 0.40);        // flight path
      // load factor of a COORDINATED turn, 1/cos φ — credited only out to the
      // autopilot's own limit, because past that the answer runs away to
      // infinity and the aeroplane should be levelling, not pulling
      const nz = CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 === false ? 1
        : 1 / Math.max(0.5, Math.cos(Math.min(Math.abs(bank), lim)));
      // invert cl = 0.34 + aoa×2.6 + trim for the cl that gives exactly n_z g
      const clNeeded = G * nz / (P.liftK * spd * spd);
      const aoaTrim = clamp((clNeeded - 0.34 - P.trim) / 2.6, -0.10, 0.50);
      const wantPitch = clamp(wantGamma + aoaTrim, -0.50, 0.62);

      _e.setFromQuaternion(af.quat, "YXZ");                      // .x = nose-up
      out.pitch = clamp(out.pitch + (wantPitch - _e.x) * 3.2, -1, 1);
      if (out.pitch > 0 && CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 !== false) {
        out.pitch *= pullAuth(bank, lim);
      }
      return out;
    };

    af.dispose = function () { af.alive = false; liveCount--; };
    return af;
  };

  CBZ.airframeAudit = function () {
    const limits = {};
    for (const k in PRESETS) limits[k] = Math.round(PRESETS[k].bankLimit * 180 / Math.PI);
    return {
      live: liveCount, presets: Object.keys(PRESETS),
      bankHold: CBZ.CONFIG.AIRFRAME_BANK_HOLD_V1 !== false,
      // the ratchet this file owns: no preset may hand its autopilot a bank
      // limit an aeroplane cannot fly out of. Pinned under 90.
      bankLimitDeg: limits,
      overBank: Object.keys(limits).filter(function (k) { return limits[k] >= 80; }).length,
    };
  };
})();
