/* ============================================================
   entities/gait.js — CBZ.gait, HOW A HUMAN FOOT MEETS THE GROUND.

   The human legs were two sine waves: the thigh swung +-A about the hip, the
   knee folded on a cosine, and the stride was tuned so that ON AVERAGE a step
   covered the ground the body travelled. On average is not at every instant:
   a sinusoidal hip moves the planted foot fastest at mid-stance and not at
   all at the ends, the knee's own fold moved it again, and every joint was a
   damp chasing its target a few frames late. The planted foot skated. The
   dog (city/dogmodel.js) has planted its feet for real since it shipped; this
   is the same law for people, with the parts a person has that a dog doesn't.

   EVERY FOOT PLANTS. At touchdown its world contact is recorded; for the whole
   stance the leg is SOLVED onto that point (closed-form two-bone IK with hip
   roll, in the rig's own segment lengths), so a foot on the floor cannot
   slide whatever the body does — speed up, stop, turn, strafe, step down a
   kerb. A swinging foot arcs from where it lifted to a landing predicted from
   the body's MEASURED velocity (Raibert: half a stance's travel ahead of the
   hip), so the next stance starts under the body and ends behind it.

   THE FOOT ROLLS, IT DOES NOT SLIDE. A real stance is three rockers: the heel
   strikes with the toes up and the foot rolls down about the HEEL; it lies
   flat while the shin passes over it; the heel rises and the foot rolls up
   about the BALL to toe-off. The contact point is the pivot of whichever
   rocker is running, and the ankle is placed from it, so the pivot is the
   thing that stays put. The heel rise is not timed, it is FORCED: when the
   shin leans past what the ankle can dorsiflex (the shoe's own range,
   foot.userData.flex) the heel has to come up, exactly as it does in a body.

   THE NUMBERS ARE A PERSON'S (gait literature, scaled by Froude similarity):
     cadence  walk 1.3 steps/s at 0.5 m/s .. 2.2 at 2.4; run 2.75 at 2.5 m/s ..
              3.9 at 8 m/s (Cavanagh & Kram 1989, Dorn 2012); scaled by
              sqrt(0.92 / leg) for this body's stature (dynamic similarity:
              a child's patter is a short leg's pendulum, not a style)
     duty     walk 0.64 .. 0.58 of the cycle on the ground (double support
              shrinking with speed); run 0.38 .. 0.20 (a sprinter is in the
              air most of the time)
     walk-run the transition at ~2.1-2.7 m/s for an adult (Fr ~0.5)
   …then held to what THIS rig can reach: the stance sweep (the ground a
   planted foot passes under the hip) is capped at a share of the real leg
   (the voxel legs are a stylised 37% of stature), and cadence rises to meet
   the cap rather than let a foot be dragged.

   THE BODY OVER THE FEET. The hips drop exactly as far as the planted legs
   need to reach their feet (the double-support dip of a walk falls out of
   the geometry), a running body is lowest at mid-stance (spring-mass), the
   weight shifts over the stance foot, starts lean in and stops lean back off
   the measured acceleration, a slope leans the body into it and shortens the
   step, a body aiming a rifle walks soft and level (the "Groucho" walk), and
   a turn on the spot is taken in PIVOT STEPS: the planted feet twist on their
   balls until the hip can't, then the worse foot steps round.

   API (character.js animChar is the only caller in the game; tools call the
   same functions):
     CBZ.gait.mix(v, o, out)       pure: cadence/duty/stride for a speed
     CBZ.gait.pre(ch, speed, dt)   measure the root, return the speed the legs
                                   should animate (the MEASURED one)
     CBZ.gait.phaseDelta(ch, speed, dt)  radians of ch.phase this frame
     CBZ.gait.body(ch, out)        bob / lean / shift targets for animChar
     CBZ.gait.post(ch, dt)         plant, swing, solve the legs (after the
                                   leg roots follow the pelvis)
     CBZ.gait.footPitch(ch, i)     the stance/swing foot pitch ankleSolve uses
     CBZ.gait.LEG_LIMITS, legInRange(ch)  the leg's anatomical range
   Rig conventions (entities/character.js): model faces +Z, ll is the leg on
   -X (physical right), rl on +X; negative rotation.x swings a thigh forward,
   knees fold positive; feet pitch + toes down.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ) return;

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const frac = (x) => x - Math.floor(x);
  function wrap(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }

  const LIMB_TUCK = 0.02;            // character.js: the knee pivot sits this far above the thigh box end
  const REF_LEG = 0.92;              // the adult leg the literature's numbers are measured on (m)
  // touchdown of each leg in the cycle (fraction of ch.phase / 2pi). These are
  // the legacy sine's own extremes (ll most forward at sin(phase) = -1), so
  // every layer that still reads ch.phase — the arm counter-swing, the
  // shoulder counter-rotation, meleeposes' gait yaw — stays in step with feet.
  const TD = [0.75, 0.25];
  const SIDE = [-1, 1];              // ll on -X, rl on +X
  const LEGS = ["ll", "rl"];
  const TOE_OUT = 0.07;              // each foot's toes turned out from the heading (+yaw turns toes to +X)
  const FAR_OUT = 62, FAR_IN = 52;   // metres from the camera: past FAR_OUT the far body walks the sine legs
  const HIP_YAW = 0.85;              // how far the legs turn under the pelvis toward a sideways travel (~49 deg)

  /* ---- THE LEG'S RANGE (radians, rig channels) -----------------------------
     hip flexion (thigh forward) to ~125 deg, extension ~35 deg past vertical,
     abduction ~45 / adduction ~25, knee 0..150 deg, never backward. The IK
     clamps its own output into this; tools/gait-check.mjs holds every clip
     to it. (The arms' range is character.js's ARM_LIMITS.) */
  const LEG_LIMITS = Object.freeze({ flex: 2.20, ext: 0.62, abd: 0.78, add: 0.44, knee: 2.62, kneeExt: 0.0 });
  function legInRange(ch, eps) {
    const e = eps || 1e-3, bad = [];
    for (let i = 0; i < 2; i++) {
      const leg = ch && ch.parts && ch.parts[i ? "rl" : "ll"];
      if (!leg) continue;
      const k = leg.userData.low ? leg.userData.low.rotation.x : 0;
      const x = leg.rotation.x, z = leg.rotation.z * SIDE[i];   // + = abduction (outward)
      if (x < -LEG_LIMITS.flex - e) bad.push((i ? "rl" : "ll") + " hip over-flexed");
      if (x > LEG_LIMITS.ext + e) bad.push((i ? "rl" : "ll") + " hip over-extended");
      if (z > LEG_LIMITS.abd + e) bad.push((i ? "rl" : "ll") + " hip abduction");
      if (z < -LEG_LIMITS.add - e) bad.push((i ? "rl" : "ll") + " hip adduction");
      if (k > LEG_LIMITS.knee + e) bad.push((i ? "rl" : "ll") + " knee over-flexed");
      if (k < LEG_LIMITS.kneeExt - e) bad.push((i ? "rl" : "ll") + " knee backward");
    }
    return bad.length ? bad : true;
  }

  /* ---- THE MIX (pure) --------------------------------------------------------
     v      ground speed, m/s (measured)
     o.L    this rig's hip-to-sole leg, m     o.H  stature, m
     o.crouch 0..1  o.aim 0..1  o.lat 0..1 (share of the motion that is sideways)
     o.back 0..1 (share that is backward)  o.grad slope (rise / run, along travel)
     o.step  the body's stride multiplier (profile gait.step: a woman's shorter stride)
     out: { wRun, duty, fc (cycles/s), steps (steps/s), step (m), sweep (m),
            lift (m), bobW, bobR (m), psiTD, psiLO (rad) } */
  function mix(v, o, out) {
    out = out || {};
    o = o || {};
    const L = o.L > 0.2 ? o.L : 0.665;
    const H = o.H > 0.5 ? o.H : 1.82;
    // the timing (walk or run, cadence) is the STATURE's: a 1.82 m man walks at
    // 2 m/s; his drawn leg length only limits how far a foot can sweep
    const Le = 0.53 * H;
    const k = Math.sqrt(REF_LEG / Le);                // Froude time scaling
    const vr = Math.abs(v) / k;                        // the same Froude number on the reference leg
    const crouch = clamp01(o.crouch || 0), aim = clamp01(o.aim || 0);
    const lat = clamp01(o.lat || 0), back = clamp01(o.back || 0);
    // a crouch, a raised rifle, sideways and backward all RUN later
    const tr = 2.1 + 0.5 * crouch + 0.6 * aim + 0.5 * lat + 0.6 * back;
    const wRun = sstep(tr, tr + 0.6, vr);
    // natural cadence (steps/s on the reference leg)
    const vw = Math.min(vr, 2.6);
    const fWalk = 0.95 + 0.72 * vw - 0.08 * vw * vw;
    const fRun = 2.45 + 0.09 * vr + 0.012 * vr * vr;
    let steps = lerp(fWalk, fRun, wRun) * k;
    const stepMul = o.step > 0 ? o.step : 1;
    steps /= stepMul;
    // shorter, quicker steps: crouched, aiming, sideways, backward, on a slope
    const grad = Math.abs(o.grad || 0);
    steps *= 1 + 0.16 * crouch + 0.12 * aim + 0.30 * lat + 0.18 * back + 0.55 * Math.min(0.6, grad);
    let duty = lerp(0.66 - 0.035 * Math.min(vr, 2.4), Math.max(0.20, 0.47 - 0.035 * vr), wRun);
    // what THIS leg can sweep under the hip while planted (contact to
    // contact). Sideways the hip abducts/adducts, which reaches far less far
    // than it swings fore and aft: a side-step is a short step.
    const sMax = L * (lerp(1.02 + 0.20 * sstep(1.4, 2.3, vr) + 0.20 * crouch, 1.00 - 0.08 * crouch, wRun)) * (1 - 0.72 * lat);
    let fc = steps / 2;
    if (v > 1e-3) {
      let sweep = duty * Math.abs(v) / fc;
      if (sweep > sMax) {
        // a run gives up ground time first (more flight), a walk can't (it
        // would stop being a walk): it steps quicker
        const dMin = wRun > 0.5 ? 0.20 : duty;
        duty = Math.max(dMin, sMax * fc / Math.abs(v));
        sweep = duty * Math.abs(v) / fc;
        if (sweep > sMax) { fc = duty * Math.abs(v) / sMax; sweep = sMax; }
      }
      out.sweep = sweep;
    } else out.sweep = 0;
    out.wRun = wRun; out.duty = duty; out.fc = fc; out.steps = fc * 2;
    out.step = v > 1e-3 ? Math.abs(v) / (fc * 2) : 0;
    const sprint = sstep(4.5, 7.0, vr);
    // swing clearance at the ankle: a walk barely clears, a sprint folds the
    // heel up toward the seat (the knee does that, from the ankle's path)
    out.lift = L * (lerp(0.07 + 0.03 * clamp01(vr / 2), 0.20 + 0.30 * sprint, wRun) * (1 - 0.35 * crouch) * (1 - 0.3 * aim));
    out.liftPeak = lerp(0.45, 0.36, wRun);           // where in the swing the foot is highest
    // the hips' own vertical: up over a walking leg, down into a running one
    // (the walk's double-support dip is the planted legs' geometry, solved in
    // post), and a stance knee is never locked: a soft walk, a sprung run
    // (on this leg every centimetre of hip drop is ~10 degrees of knee: a walk
    // gets its dip from the planted geometry alone and a hair of softness)
    out.bobW = 0;
    out.bobR = (0.016 + 0.003 * vr) * wRun * (1 - 0.6 * aim);
    out.soft = lerp(0.005 + 0.004 * clamp01(vr / 1.6), 0.030 + 0.004 * Math.min(vr, 8), wRun);
    // the foot's rockers (+ toes down): heel strike / midfoot / forefoot
    const a = clamp01(vr / 1.4);
    out.psiTD = lerp(-0.24 * a, lerp(-0.10, 0.12, sprint), wRun) * (1 - 0.5 * crouch);
    out.psiLO = lerp(0.50 * a + 0.05, 0.80, wRun);
    out.heelRise = lerp(0.52, 0.30, wRun);            // stance share where a free heel would rise
    out.vr = vr; out.k = k;
    return out;
  }

  /* ---- THIS RIG'S LEG (model units: the rig is authored at 1/humanScale) ---- */
  function geo(ch) {
    let g = ch._gG;
    const ll = ch.parts && ch.parts.ll, rl = ch.parts && ch.parts.rl;
    const foot = ll && ll.userData && ll.userData.foot;
    if (g && g.foot === foot) return g;
    if (!ll || !rl || !foot || !ll.userData.low) return null;
    const P = ch.profile || {};
    const dims = foot.userData.dims || {};
    const T = Math.max(0.1, -ll.userData.low.position.y || ((P.legUp || 0.48) - LIMB_TUCK));
    const S = Math.max(0.1, -foot.position.y);
    const ha = Math.max(0.02, foot.position.y - (dims.sole != null ? dims.sole : -(S + 0.1)));
    const D = dims.D || 0.5;
    const hipY = ch.hipY > 0 ? ch.hipY : 0.95;
    const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || (ch.model ? ch.model.scale.y : 0.7) || 0.7;
    const met = ch.metric || (ch.group && ch.group.userData && ch.group.userData.characterMetric);
    g = ch._gG = {
      foot, T, S, ha, D,
      hb: 0.27 * D,                 // heel contact behind the ankle (footwear: ankle at -0.20 D, heel at -0.50 D, rounded)
      bf: 0.40 * D,                 // the ball ahead of it
      W: dims.W || 0.3,
      hipX: Math.abs(ll.userData._rootX != null ? ll.userData._rootX : ll.position.x) || (P.hipX || 0.23),
      hipY, s,
      Lw: hipY * s,                 // hip -> sole, metres
      Hw: met && met.height > 0.5 ? met.height : 2.6 * s * (P.statureMul || 1),
      dmax: (T + S) * 0.999,
    };
    return g;
  }

  /* ---- PER-RIG STATE ------------------------------------------------------- */
  function footRec() {
    return { sw: false, u: 0, ur: 3, dur: 0.3, x: 0, y: 0, z: 0, yaw: 0,
      ax: 0, ay: 0, az: 0, sx: 0, sy: 0, sz: 0, syaw: 0, spsi: 0, tx: 0, ty: 0, tz: 0, tyaw: 0,
      tyOk: false, psi: 0, psiW: 0, idle: false, tw: 0, gy: null, cl0: null, pcl: null };
  }
  function state(ch) {
    let G = ch._gv;
    if (!G) {
      G = ch._gv = {
        px: null, pz: null, py: 0, pyaw: 0, vx: 0, vz: 0, v: 0, vf: 0, acc: 0, yawRate: 0,
        tread: false, still: 0, ox: 0, oz: 0, carried: false, grad: 0,
        moving: false, init: false, w: 0, drop: 0, shx: 0, shy: 0, restT: 0,
        lat: 0, back: 0, aim: 0, aimK: 0, M: mix(0, null, {}),
        feet: [footRec(), footRec()],
      };
    }
    return G;
  }

  /* ---- PRE: what the root actually did -------------------------------------
     Called at the very top of animChar, every frame, whatever pose follows.
     Returns the speed the body's legs should be animated with: the MEASURED
     ground speed (a man held on a wall does not run on the spot), unless the
     root does not move at all and the caller still says it walks (a baked
     crowd clip, a turntable), when the ground runs under him instead. */
  function pre(ch, speed, dt) {
    const g = ch && ch.group;
    if (!g) return speed;
    const G = state(ch);
    // back out last frame's shift of the hips (post's weight shift / reach drop)
    if (ch.body && (G.shx || G.shy)) { ch.body.position.x -= G.shx; ch.body.position.y -= G.shy; }
    G.shx = G.shy = 0;
    const x = g.position.x, z = g.position.z, y = g.position.y, yaw = g.rotation.y;
    if (G.px == null || !(dt > 0)) {
      G.px = x; G.pz = z; G.py = y; G.pyaw = yaw;
      return speed;
    }
    let dx = x - G.px, dz = z - G.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 9 || Math.abs(y - G.py) > 2.5) { G.init = false; dx = dz = 0; G.vx = G.vz = 0; }  // a teleport is not a stride
    const dyaw = wrap(yaw - G.pyaw);
    G.yawRate = damp(G.yawRate, clamp(dyaw / dt, -9, 9), 14, dt);
    const meas = Math.sqrt(dx * dx + dz * dz) / dt;
    const told = speed > 0.2 ? speed : 0;
    // A ROOT THAT NEVER MOVES BUT IS TOLD TO WALK: the ground runs under him
    // (several zero-motion frames in a row, so a body animated twice in one
    // frame does not flip into it on the second call)
    if (meas < 1e-5 && told > 0) G.still++; else G.still = 0;
    const tread = told > 0 && G.still >= 4;
    if (tread !== G.tread) { G.tread = tread; G.init = false; G.ox = G.oz = 0; }
    let vx, vz;
    if (tread) {
      // the direction a baked clip walks in (local), default straight ahead
      const gd = ch.gaitDir;
      const lx = gd ? gd.x || 0 : 0, lz = gd ? (gd.z == null ? 1 : gd.z) : 1;
      const ll = Math.hypot(lx, lz) || 1;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      vx = (lx * c + lz * s) / ll * told; vz = (-lx * s + lz * c) / ll * told;
      G.ox += vx * dt; G.oz += vz * dt;
    } else if (meas < 1e-5 && G.v > 0.2 && G.still > 0) {
      vx = G.vx; vz = G.vz;                     // a duplicate call this frame: nothing new
    } else {
      vx = dx / dt; vz = dz / dt;
    }
    // CARRIED: told to stand, yet the root moves (a deck, a lift, a mount, a
    // shove): the planted feet ride with it instead of being left behind
    G.carried = !tread && told === 0 && meas > 0.35;
    if (G.carried) {
      for (let i = 0; i < 2; i++) {
        const F = G.feet[i];
        F.x += dx; F.z += dz; F.y += y - G.py;
        F.sx += dx; F.sz += dz; F.sy += y - G.py;
      }
      vx = vz = 0;
    }
    const k = 1 - Math.exp(-22 * dt);
    G.vx += (vx - G.vx) * k; G.vz += (vz - G.vz) * k;
    const v = Math.hypot(G.vx, G.vz);
    // the share of the motion that is forward / sideways / backward (body frame)
    /* THE HIPS TURN TOWARD THE TRAVEL. Nobody side-shuffles at a walk: a man
       moving sideways while he faces (a rifle on a target) turns his pelvis
       and legs toward where he is going and keeps his shoulders where he
       looks. The legs carry that yaw (outermost, about the vertical at the
       hip); what is left sideways in the hips' own frame is a diagonal step
       the hip can actually make. A backward diagonal turns them the other
       way (it becomes a backpedal). */
    let hyT = 0;
    if (v > 0.15) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const f = (G.vx * s + G.vz * c) / v, r = (G.vx * c - G.vz * s) / v;
      const rel = Math.atan2(r, f);
      let relH = rel;
      if (relH > PI / 2) relH -= PI; else if (relH < -PI / 2) relH += PI;
      hyT = clamp(relH * 0.78, -HIP_YAW, HIP_YAW) * sstep(0.2, 0.7, v);
      G.hy = damp(G.hy || 0, hyT, 6, dt);
      const rh = rel - G.hy;
      G.lat = damp(G.lat, Math.abs(Math.sin(rh)), 8, dt);
      G.back = damp(G.back, Math.max(0, -Math.cos(rh)), 8, dt);
    } else {
      G.hy = damp(G.hy || 0, 0, 3, dt);
      G.lat = damp(G.lat, 0, 4, dt); G.back = damp(G.back, 0, 4, dt);
    }
    // acceleration along the facing (starts lean in, stops lean back)
    const vfNow = G.vx * Math.sin(yaw) + G.vz * Math.cos(yaw);
    G.acc = damp(G.acc, clamp((vfNow - G.vf) / dt, -12, 12), 6, dt);
    G.vf = vfNow;
    // the slope under the travel, from the root's own rise
    const run = Math.sqrt(d2);
    if (run > 0.004 && !tread) G.grad = damp(G.grad, clamp((y - G.py) / run, -0.8, 0.8), 5, dt);
    else G.grad = damp(G.grad, 0, 1.5, dt);
    G.px = x; G.pz = z; G.py = y; G.pyaw = yaw;
    G.v = v;
    // a rifle at the shoulder (actorweapons' ready pose stamps ch._aimHold)
    if (ch._aimHold > 0) { ch._aimHold -= dt; G.aim = 1; } else G.aim = ch.aimingPose ? 1 : 0;
    G.aimK = damp(G.aimK, G.aim, 6, dt);
    const eff = tread ? told : v;
    const gg = geo(ch), mo = _mo;
    mo.L = gg ? gg.Lw : 0; mo.H = gg ? gg.Hw : 0; mo.crouch = ch._cb || 0; mo.aim = G.aimK;
    mo.lat = G.lat; mo.back = G.back; mo.grad = G.grad; mo.step = ch.gait && ch.gait.step;
    G.M = mix(eff, mo, G.M);
    // STARTING: the first step is taken by the foot that is further behind,
    // at once (the phase is set so that leg is at the start of its swing)
    const movingNow = eff > 0.2;
    if (movingNow && !G.moving && G.init && ch.phase != null) {
      const F0 = G.feet[0], F1 = G.feet[1];
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const vxn = v > 0.05 ? G.vx / v : fx, vzn = v > 0.05 ? G.vz / v : fz;
      const b0 = (F0.x - x) * vxn + (F0.z - z) * vzn, b1 = (F1.x - x) * vxn + (F1.z - z) * vzn;
      const lead = b0 < b1 ? 0 : 1;                       // the foot further back lifts first
      if (!F0.sw && !F1.sw) ch.phase = (TD[lead] + G.M.duty + 0.001) * TAU;
    }
    G.moving = movingNow;
    return tread ? told : v;
  }

  // radians of ch.phase for this frame: PI per step, at the mix's cadence
  function phaseDelta(ch, speed, dt) {
    const G = ch && ch._gv;
    if (!G) return mixPhaseFallback(speed, dt);
    if (!G.moving) return 0;
    return G.M.fc * TAU * dt;
  }
  function mixPhaseFallback(speed, dt) {
    if (!(speed > 0.2)) return 0;
    const M = mix(speed, null, _mf);
    return M.fc * TAU * dt;
  }
  const _mf = {}, _mo = {};

  /* ---- BODY TARGETS for animChar's locomotion branch ------------------------
     Returns model-unit offsets/angles: bob (the hips' vertical), lean (pitch),
     roll, and the gait clock fraction. animChar damps toward them. */
  function body(ch, out) {
    out = out || {};
    const G = ch._gv, g = geo(ch);
    out.bob = 0; out.lean = 0; out.roll = 0; out.yaw = 0; out.aim = 0; out.c = 0;
    if (!G || !g) return out;
    const M = G.M, c = frac((ch.phase || 0) / TAU);
    out.c = c;
    const s = g.s;
    if (G.moving) {
      // mid-stance of each leg: a walking body vaults over it (highest), a
      // running one sinks into it (lowest)
      const cms = TD[1] + M.duty * 0.5;
      const w = Math.cos(4 * PI * (c - cms));
      out.bob = (M.bobW * w - M.bobR * w - M.soft) / s;
    }
    // a raised rifle walks soft: the hips ride lower, the knees take the bumps
    out.bob -= 0.025 * G.aimK * (G.moving ? 1 : 0.5) / s;
    // lean: into the run, into a start, back off a stop, into a hill; a body
    // going backward leans the other way
    const fwd = 1 - 2 * G.back;
    out.lean = clamp(G.acc * 0.028, -0.10, 0.14) + G.grad * (G.moving ? 0.42 : 0.15) * fwd;
    out.aim = G.aimK;
    // sideways travel rolls the body into the side it is going (a strafe)
    if (G.moving && G.lat > 0.2) {
      const yaw = ch.group.rotation.y;
      const r = (G.vx * Math.cos(yaw) - G.vz * Math.sin(yaw));
      out.roll = clamp(-r * 0.025, -0.08, 0.08);
    }
    return out;
  }

  /* ---- FOOT GEOMETRY ---------------------------------------------------------
     The ankle from a contact. (px, py, pz): the sole point under the ankle when
     the foot lies flat; yaw: the foot's heading; psi: its pitch (+ toes down).
     Toes up rolls about the heel, toes down about the ball. World metres. */
  const _ank = { x: 0, y: 0, z: 0 };
  function ankleFrom(g, px, py, pz, yaw, psi, out) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const s = g.s, ha = g.ha * s;
    const c = Math.cos(psi), sn = Math.sin(psi);
    let up, fw, ox;
    if (psi < 0) { const hb = g.hb * s; ox = -hb; up = ha * c - hb * sn; fw = ha * sn + hb * c; }
    else { const bf = g.bf * s; ox = bf; up = ha * c + bf * sn; fw = ha * sn - bf * c; }
    out.x = px + fx * (ox + fw); out.z = pz + fz * (ox + fw); out.y = py + up;
    return out;
  }

  function groundY(x, z, fromY) {
    const M = CBZ.moves;
    if (M && M.ground) { const y = M.ground(x, z, fromY); if (y != null) return y; }
    return null;
  }

  /* ---- THE LEG IK (closed form, model units) ---------------------------------
     t: the ankle relative to the hip root, in the model frame (the legs'
     parent). The thigh hangs along -Y; leg.rotation = (theta, 0, phi) in Euler
     XYZ (Rx(theta) Rz(phi)), the knee folds k about the thigh's own X. */
  const _ik = { th: 0, ph: 0, k: 0, reach: 0 };
  function legIK(tx, ty, tz, T, S, out) {
    let d = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const dmax = (T + S) * 0.9995, dmin = Math.abs(T - S) + 0.08;
    out.reach = 0;
    if (d > dmax) { const f = dmax / d; out.reach = d - dmax; tx *= f; ty *= f; tz *= f; d = dmax; }
    else if (d < dmin) { const f = dmin / Math.max(d, 1e-6); tx *= f; ty *= f; tz *= f; d = dmin; }
    const ck = clamp((d * d - T * T - S * S) / (2 * T * S), -1, 1);
    let k = Math.acos(ck);
    const a = T + S * Math.cos(k), b = S * Math.sin(k);
    const sp = clamp(tx / Math.max(a, 1e-6), -0.92, 0.92);
    const ph = Math.asin(sp), c = a * Math.cos(ph);
    const th = wrap(Math.atan2(tz, ty) - Math.atan2(-b, -c));
    out.th = th; out.ph = ph; out.k = k;
    return out;
  }

  // world -> model (the legs' parent), metres in, model units out
  function toModel(ch, G, wx, wy, wz, out) {
    const g = ch.group, m = ch.model, s = geo(ch).s;
    const yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
    const dx = wx - (g.position.x + G.ox), dz = wz - (g.position.z + G.oz), dy = wy - g.position.y;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    out.x = (lx - (m ? m.position.x : 0)) / s;
    out.y = (dy - (m ? m.position.y : 0)) / s;
    out.z = (lz - (m ? m.position.z : 0)) / s;
    return out;
  }
  // model -> world (metres)
  function toWorld(ch, G, mx, my, mz, out) {
    const g = ch.group, m = ch.model, s = geo(ch).s;
    const yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
    const lx = mx * s + (m ? m.position.x : 0), ly = my * s + (m ? m.position.y : 0), lz = mz * s + (m ? m.position.z : 0);
    out.x = g.position.x + G.ox + lx * c + lz * sn;
    out.y = g.position.y + ly;
    out.z = g.position.z + G.oz - lx * sn + lz * c;
    return out;
  }

  // where a foot belongs at rest / under a stride, body frame (metres)
  function neutralLat(ch, G, g) {
    const base = g.hipX * g.s;
    const stZ = ch.stanceZ || 0;                       // + narrows (a woman's walk), - widens (a toddler's)
    const moving = G.moving ? 1 : 0;
    // (wider crouched, aiming, side-stepping and on a slope: a folded knee
    // cannot carry the foot in under the body, the hip has no roll for it)
    const k = lerp(0.95, 0.66 - 0.10 * G.M.wRun + 0.30 * G.lat, moving) + 0.22 * (ch._cb || 0) + 0.10 * G.aimK + 0.9 * Math.min(0.35, Math.abs(G.grad));
    return Math.max(0.035, base * k - stZ * g.Lw * 0.55);
  }
  const _p = { x: 0, y: 0, z: 0 }, _q = { x: 0, y: 0, z: 0 };

  function plantInit(ch, G, g) {
    const grp = ch.group, yaw = grp.rotation.y + (G.hy || 0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lat = neutralLat(ch, G, g);
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i], lx = SIDE[i] * lat;
      F.x = grp.position.x + G.ox + lx * c;
      F.z = grp.position.z + G.oz - lx * s;
      const gy = groundY(F.x, F.z, grp.position.y + 0.6);
      F.y = gy != null && Math.abs(gy - grp.position.y) < 0.6 ? gy : grp.position.y;
      F.yaw = yaw + (G.hy || 0) + SIDE[i] * TOE_OUT;    // a touch of toe-out
      F.sw = false; F.u = 0; F.psi = 0; F.idle = false;
      ankleFrom(g, F.x, F.y, F.z, F.yaw, 0, _ank);
      F.ax = _ank.x; F.ay = _ank.y; F.az = _ank.z;
    }
    G.init = true; G.restT = 0;
  }

  function liftFoot(F, dur, psi) {
    F.sw = true; F.u = 0; F.dur = Math.max(0.12, dur);
    F.sx = F.ax; F.sy = F.ay; F.sz = F.az; F.syaw = F.yaw; F.spsi = psi;
    F.tyOk = false; F.gy = null;
  }

  // the landing: contact under the predicted hip, half a stance ahead of it
  function swingTarget(ch, G, g, i, F, tRem) {
    const grp = ch.group, M = G.M;
    const yaw0 = grp.rotation.y;
    const yawP = yaw0 + clamp(G.yawRate, -4, 4) * Math.min(tRem, 0.5) + (G.hy || 0);
    const c = Math.cos(yawP), s = Math.sin(yawP);
    const lat = neutralLat(ch, G, g) * SIDE[i];
    let ahead = 0, vx = 0, vz = 0;
    if (G.moving && !F.idle) {
      const tSt = M.duty / M.fc;                        // the stance this foot is about to start
      vx = G.vx; vz = G.vz;
      // a little short of half: the trailing foot reaches further (it rolls
      // up onto its ball) than a stiff-ankled heel strike can in front
      ahead = lerp(0.42, 0.5, M.wRun) * tSt;
    }
    // the predicted root, plus the Raibert lead along the velocity
    let rx = grp.position.x + G.ox + G.vx * (G.moving ? tRem : 0) + vx * ahead;
    let rz = grp.position.z + G.oz + G.vz * (G.moving ? tRem : 0) + vz * ahead;
    // sideways travel is less of a lead (a side-step does not reach as far)
    if (G.moving && G.lat > 0.05) {
      const lr = (vx * c - vz * s) * ahead;               // lateral share of the lead
      rx -= lr * 0.35 * c; rz += lr * 0.35 * s;
    }
    let tx = rx + lat * c, tz = rz - lat * s;
    // NO CROSSOVER: the swing foot lands on its own side of the planted one
    const O = G.feet[1 - i];
    const minSep = Math.max(0.06, g.W * g.s * 0.55);
    const olx = (O.x - (grp.position.x + G.ox)) * c - (O.z - (grp.position.z + G.oz)) * s;
    let tlx = (tx - (grp.position.x + G.ox)) * c - (tz - (grp.position.z + G.oz)) * s;
    if (SIDE[i] > 0 && tlx < olx + minSep) { const d = olx + minSep - tlx; tx += d * c; tz -= d * s; tlx += d; }
    if (SIDE[i] < 0 && tlx > olx - minSep) { const d = tlx - (olx - minSep); tx -= d * c; tz += d * s; tlx -= d; }
    F.tx = tx; F.tz = tz;
    F.tyaw = yawP + SIDE[i] * TOE_OUT;
    // the ground there: asked once the foot is on its way down (one query a step)
    if (!F.tyOk && F.u > 0.45) {
      const gy = groundY(tx, tz, grp.position.y + 0.6);
      F.gy = gy != null && Math.abs(gy - grp.position.y) < 0.7 ? gy : null;
      F.tyOk = true;
    }
    const along = (tx - (grp.position.x + G.ox)) * Math.sin(yaw0) + (tz - (grp.position.z + G.oz)) * Math.cos(yaw0);
    F.ty = F.gy != null ? F.gy : grp.position.y + G.grad * along;
  }

  /* the stance foot's pitch at stance progress sp (0 touchdown .. 1 toe-off),
     forward travel; mirrored for a body going backward */
  function stancePsi(M, sp, dir) {
    let p;
    if (sp < 0.14) p = M.psiTD * (1 - ease(sp / 0.14));
    else if (sp < M.heelRise) p = 0;
    else p = M.psiLO * Math.pow(clamp01((sp - M.heelRise) / (1 - M.heelRise)), 1.7);
    return p * dir;
  }
  function swingPsi(M, F, u, dir) {
    const mid = -0.10 * dir;
    if (u < 0.4) return lerp(F.spsi, mid, ease(u / 0.4));
    return lerp(mid, M.psiTD * dir * (F.idle ? 0 : 1), ease((u - 0.4) / 0.6));
  }

  /* ---- POST: plant, swing, solve --------------------------------------------
     After animChar's pose writers and legRootsFollow (the leg roots are where
     the pelvis draws its hip joints), before the ankle solve. Owns the legs at
     weight ch._gv.w: 1 whenever the body is on its feet and no other system
     claims them (a fight stance's own foot IK, a fall, a kick). */
  const _t = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  const _hip = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  function post(ch, dt) {
    const G = ch && ch._gv, g = ch && geo(ch);
    if (!G || !g || !ch.group || !ch.model || !ch.body) return;
    const grp = ch.group, mdl = ch.model;
    // who else has the legs
    const MP = CBZ.meleePoses;
    let want = ch._gOn ? 1 : 0;
    if (want) {
      if (Math.abs(grp.rotation.x) + Math.abs(grp.rotation.z) > 0.25 || Math.abs(grp.scale.y - 1) > 0.02) want = 0;
      else if (Math.abs(mdl.rotation.x) + Math.abs(mdl.rotation.z) > 0.05) want = 0;
      else if (ch.koT > 0 || ch.koPose || (MP && MP.fallActive && MP.fallActive(ch))) want = 0;
      else if (ch.kickT > 0 || (ch.footStep && ch.footStep.on)) want = 0;
      else if (ch._sKeepLegs) want = 0;                // a soldier move that keys its own legs (a dive, a crawl)
      else want = 1 - clamp01(ch._mK || 0);             // the fight stance solves its own feet
      /* DISTANCE LOD. The solve costs ~10 us a body; past ~60 m a planted
         foot's centimetres are under a pixel, so a far body walks the cheap
         sine legs at the same cadence (blended, with hysteresis: no pop). */
      const cam = CBZ.camera && CBZ.camera.position;
      if (cam && want > 0) {
        const dx = grp.position.x - cam.x, dz = grp.position.z - cam.z, d2 = dx * dx + dz * dz;
        G.far = G.far ? d2 > FAR_IN * FAR_IN : d2 > FAR_OUT * FAR_OUT;
        if (G.far) want = 0;
      }
    }
    if (!(dt > 0)) dt = 0;                           // a paused frame re-poses, it does not step
    G.w = want > G.w ? Math.min(want, damp(G.w, want, 9, dt) + (dt > 0 ? 0.004 : 0)) : damp(G.w, want, 18, dt);
    if (want === 0 && G.w < 0.02) G.w = 0;
    const W0 = G.w;
    if (W0 <= 0) {
      G.init = false; ch._gFootW = 0;
      for (const k of LEGS) {
        const leg = ch.parts[k];
        if (leg && leg.rotation.order !== "XYZ") { leg.rotation.y = 0; leg.rotation.order = "XYZ"; }
      }
      return;
    }
    if (!G.init) plantInit(ch, G, g);
    const M = G.M, yaw = grp.rotation.y;
    const c = frac((ch.phase || 0) / TAU);
    const moving = G.moving;
    const dir = G.back > 0.5 ? -1 : 1;
    const alongK = 1 - G.lat;                          // a side-step keeps its foot flat
    let swinging = 0;
    for (let i = 0; i < 2; i++) if (G.feet[i].sw) swinging++;

    /* A LIMP IS TIME, NOT A POSE: an antalgic gait spends as little of the
       cycle as it can on the hurt leg and hurries the good one through
       (character.js legHurt: side < 0 is ll). The body's dip onto the hurt
       side is animChar's; the feet stay planted through it. */
    const lh = ch.legHurt, hurtI = lh && lh.sev > 0.02 ? (lh.side < 0 ? 0 : 1) : -1;
    const lsev = hurtI >= 0 ? Math.min(1, lh.sev) : 0;
    const dutyOf = (i) => hurtI < 0 ? M.duty : i === hurtI ? M.duty * (1 - 0.30 * lsev) : Math.min(0.86, M.duty * (1 + 0.14 * lsev));
    // ---- the clock decides who is on the ground (moving) ----
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i];
      const DU = dutyOf(i);
      if (moving) {
        const cl = frac(c - TD[i]);
        const wrapped = F.pcl != null && cl + 0.5 < F.pcl;    // the cycle came round: touchdown is due
        F.pcl = cl;
        const inStance = cl < DU;
        if (F.sw) {
          if (F.idle) { F.u += dt / F.dur; }   // (dt 0: no progress)
          else {
            const u = wrapped ? 1 : clamp01((cl - F.cl0) / Math.max(0.05, 1 - F.cl0));
            const nu = Math.max(F.u, u);
            if (dt > 0) F.ur = (nu - F.u) / dt || F.ur;
            F.u = nu;
          }
          if (F.u >= 1 || wrapped) touchdown(ch, G, g, F, i);
        } else if (!inStance) {
          // its swing window: lift (late in it only if there is still time
          // to get the foot through, else it waits for the next one)
          const u0 = (cl - DU) / (1 - DU);
          if ((1 - u0) * (1 - DU) / M.fc > 0.07) {
            liftFoot(F, (1 - DU) / M.fc, F.psi);
            F.idle = false; F.cl0 = DU; F.u = u0;
          }
        } else if (cl > 0.45 * DU) {
          /* EARLY TOE-OFF. A trailing foot whose knee has folded deep or whose
             foot stands on its toes (a low crouch-run, a steep step down) is
             not pushing any more: it leaves now, and its swing is timed from
             here to the next footfall. (A walk keeps one foot down: only if
             the other one is.) */
          const leg = i ? ch.parts.rl : ch.parts.ll;
          const knee = leg.userData.low ? leg.userData.low.rotation.x : 0;
          const other = G.feet[1 - i];
          if ((F.psi > 1.12 || knee > 1.95) && (!other.sw || other.u > 0.82 || M.wRun > 0.5)) {
            liftFoot(F, (1 - cl) / M.fc, F.psi);
            F.idle = false; F.cl0 = cl; F.u = 0;
          }
        }
      } else if (F.sw) {
        // stopping mid-swing: the foot finishes its step under the body
        F.idle = true; F.pcl = null;
        F.u += dt * Math.max(F.ur || 0, 1 / 0.32);
        if (F.u >= 1) touchdown(ch, G, g, F, i);
      } else F.pcl = null;
    }

    // ---- at rest: the worst-placed foot steps back under the body ----
    if (!moving) {
      G.restT += dt;
      swinging = (G.feet[0].sw ? 1 : 0) + (G.feet[1].sw ? 1 : 0);
      if (!swinging && G.restT > 0.07) {
        const lat = neutralLat(ch, G, g);
        const yH = yaw + (G.hy || 0);
        const cy = Math.cos(yH), sy = Math.sin(yH);
        let worst = -1, ws = 1;
        for (let i = 0; i < 2; i++) {
          const F = G.feet[i];
          const nx = grp.position.x + G.ox + SIDE[i] * lat * cy, nz = grp.position.z + G.oz - SIDE[i] * lat * sy;
          const off = Math.hypot(F.x - nx, F.z - nz) / (0.085 * g.Lw / 0.665);
          const tw = Math.abs(wrap(F.yaw - (yH + SIDE[i] * TOE_OUT))) / 0.40;
          const sc = Math.max(off, tw);
          if (sc > ws) { ws = sc; worst = i; }
        }
        if (worst >= 0) {
          const F = G.feet[worst];
          liftFoot(F, 0.30 * Math.sqrt(g.Lw / 0.665), 0);
          F.idle = true; F.ur = 1 / F.dur;
          G.restT = 0;
        }
      }
    } else G.restT = 0;

    // ---- where each ankle is this frame (world) ----
    const lift = Math.max(M.lift, 0.035 * g.Lw / 0.665);
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i];
      if (F.sw) {
        const tRem = F.idle ? (1 - F.u) * F.dur : (1 - F.u) * (1 - (F.cl0 != null ? F.cl0 : M.duty)) / Math.max(0.2, M.fc);
        swingTarget(ch, G, g, i, F, tRem);
        const psiT = F.idle ? 0 : M.psiTD * dir * alongK;
        ankleFrom(g, F.tx, F.ty, F.tz, F.tyaw, psiT, _ank);
        // a run's foot stays back early in the swing (the heel folds up
        // behind) and whips through late; a walk carries it evenly
        const dly = F.idle ? 0 : 0.14 * M.wRun;
        const e = ease(clamp01((F.u - dly) / (1 - dly)));
        F.ax = lerp(F.sx, _ank.x, e); F.az = lerp(F.sz, _ank.z, e);
        const pk = F.idle ? 0.5 : M.liftPeak;
        const arc = Math.sin(PI * Math.pow(clamp01(F.u), Math.log(0.5) / Math.log(pk)));
        F.ay = lerp(F.sy, _ank.y, ease(F.u)) + (F.idle ? 0.045 * g.Lw / 0.665 : lift) * arc;
        F.yaw = F.syaw + wrap(F.tyaw - F.syaw) * e;
        F.psi = swingPsi(M, F, F.u, dir * alongK);
        F.psiW = F.idle ? 0.6 : 1;
      } else {
        // TURNING ON THE SPOT: a planted foot pivots on its ball once the hip
        // has turned it as far as it goes
        const yH = yaw + (G.hy || 0);
        const tw = wrap(F.yaw - yH), TW = 0.55;
        if (Math.abs(tw) > TW) {
          const ny = yH + (tw > 0 ? TW : -TW);
          const bf = g.bf * g.s;
          const bx = F.x + Math.sin(F.yaw) * bf, bz = F.z + Math.cos(F.yaw) * bf;
          F.x = bx - Math.sin(ny) * bf; F.z = bz - Math.cos(ny) * bf; F.yaw = ny;
        }
        let psi = 0;
        if (moving && !F.idle) {
          const cl = frac(c - TD[i]);
          psi = stancePsi(M, clamp01(cl / dutyOf(i)), dir) * alongK;
        }
        F.psi = psi; F.psiW = 1;
        ankleFrom(g, F.x, F.y, F.z, F.yaw, psi, _ank);
        F.ax = _ank.x; F.ay = _ank.y; F.az = _ank.z;
      }
    }

    // ---- the hips come down as far as the planted legs need ----
    for (let i = 0; i < 2; i++) {
      const leg = i ? ch.parts.rl : ch.parts.ll;
      _hip[i].x = leg.position.x; _hip[i].y = leg.position.y; _hip[i].z = leg.position.z;
    }
    let need = 0;
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i];
      const wgt = F.sw ? sstep(0.55, 0.85, F.u) : 1;
      if (wgt <= 0) continue;
      toModel(ch, G, F.ax, F.ay, F.az, _p);
      const tx = _p.x - _hip[i].x, ty = _p.y - _hip[i].y, tz = _p.z - _hip[i].z;
      const R = g.dmax * g.dmax - tx * tx - tz * tz;
      const dn = R > 0 ? -ty - Math.sqrt(R) : -ty - 0.05;
      if (dn > 0) need = Math.max(need, dn * wgt);
    }
    need = Math.min(need, g.hipY * 0.45);
    if (need > G.drop) G.drop = need; else G.drop = damp(G.drop, need, 16, dt);
    // the weight over the stance foot (sideways), metres -> model units
    let shift = 0;
    if (!G.carried) {
      let n = 0, sx = 0;
      for (let i = 0; i < 2; i++) {
        if (G.feet[i].sw) continue;
        toModel(ch, G, G.feet[i].ax, G.feet[i].ay, G.feet[i].az, _q);
        sx += _q.x; n++;
      }
      const tgt = n ? (sx / n) * (n === 1 ? lerp(0.30, 0.10, M.wRun) : 0.12) * (1 - 0.5 * G.aimK) : 0;
      G.shxT = damp(G.shxT || 0, tgt, moving ? 9 : 5, dt);
      shift = G.shxT;
    }
    const dropW = G.drop * W0, shW = shift * W0;
    ch.body.position.y -= dropW; ch.body.position.x += shW;
    G.shy = -dropW; G.shx = shW;
    for (let i = 0; i < 2; i++) { _hip[i].y -= dropW; _hip[i].x += shW; }
    ch.parts.ll.position.y -= dropW; ch.parts.rl.position.y -= dropW;
    ch.parts.ll.position.x += shW; ch.parts.rl.position.x += shW;

    // ---- solve the legs (in the hips' yawed frame) ----
    const HY = G.hy || 0, cH = Math.cos(HY), sH = Math.sin(HY);
    const ik = (i) => {
      const tx = _p.x - _hip[i].x, ty = _p.y - _hip[i].y, tz = _p.z - _hip[i].z;
      legIK(tx * cH - tz * sH, ty, tx * sH + tz * cH, g.T, g.S, _ik);
    };
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i], leg = i ? ch.parts.rl : ch.parts.ll, low = leg.userData.low;
      let psi = F.psi;
      toModel(ch, G, F.ax, F.ay, F.az, _p);
      ik(i);
      /* THE ANKLE DECIDES THE ROLL. A planted foot's pitch must be one the
         ankle can make over this shin (the shoe's own range: a work boot
         barely flexes): when the shin leans past it the HEEL HAS TO RISE (late
         stance), and a foot planted far ahead of a stiff ankle lands with
         its toes higher (heel strike). The ankle solve draws exactly this
         pitch, so the pivot the ankle was placed from is the pivot drawn. */
      if (!F.sw) {
        // (a boot's authored range is how far its shaft lets the foot HANG;
        // the ankle inside it still dorsiflexes ~14 degrees under a stance)
        const fl = (leg.userData.foot && leg.userData.foot.userData.flex) || [-0.35, 0.7];
        const dorsi = Math.min(fl[0], -0.24), plant = Math.max(fl[1], 0.30);
        for (let it = 0; it < 3; it++) {
          const shin = _ik.th + _ik.k + (mdl.rotation.x || 0);
          const lo = shin + dorsi + 0.012, hi = shin + plant - 0.012;
          const want = lo > hi ? (lo + hi) / 2 : clamp(psi, lo, hi);
          if (Math.abs(want - psi) < 1e-4) break;
          psi = want; F.psi = psi;
          ankleFrom(g, F.x, F.y, F.z, F.yaw, psi, _ank);
          F.ax = _ank.x; F.ay = _ank.y; F.az = _ank.z;
          toModel(ch, G, F.ax, F.ay, F.az, _p);
          ik(i);
        }
      }
      const th = clamp(_ik.th, -LEG_LIMITS.flex, LEG_LIMITS.ext);
      const ab = clamp(_ik.ph * SIDE[i], -LEG_LIMITS.add, LEG_LIMITS.abd) * SIDE[i];
      const kn = clamp(_ik.k, 0, LEG_LIMITS.knee);
      // the hip's yaw is outermost (about the vertical at the joint): YXZ.
      // With no yaw the two orders are the same rotation, so a writer that
      // assumes XYZ is unaffected; the order goes back when the gait lets go.
      if (leg.rotation.order !== "YXZ") leg.rotation.order = "YXZ";
      // (one Euler write per joint: each channel write re-derives the quaternion)
      if (W0 >= 0.999) {
        leg.rotation.set(th, HY, ab);
        low.rotation.set(kn, 0, 0);
      } else {
        const lr = leg.rotation, kr = low.rotation;
        lr.set(lerp(lr.x, th, W0), lerp(lr.y, HY, W0), lerp(lr.z, ab, W0));
        kr.set(lerp(kr.x, kn, W0), lerp(kr.y, 0, W0), lerp(kr.z, 0, W0));
      }
      leg.scale.y = 1;
      // THE FOOT, EXACTLY: its heading on the ground (a planted foot keeps it
      // through a turn), its rocker pitch, its sole level across. Composed as
      // a world orientation and brought into the shin's frame, because an
      // Euler "undo the hip roll" about a foot pitched up on its ball swings
      // the ball sideways along the floor. (At partial weight the ankle solve
      // blends it, see footPitch.)
      const foot = leg.userData.foot;
      if (foot && W0 >= 0.98 && THREE()) footOrient(foot, yaw, leg, low, F.yaw, F.psi);
    }
    ch._gFootW = W0;
  }
  // foot local = (shin world)^-1 * (heading, pitch); the rig's group and
  // model carry only a yaw and a scale while the gait owns the legs
  let _fq = null;
  function THREE() { return W.THREE; }
  function footOrient(foot, yaw, leg, low, fyaw, psi) {
    const T3 = W.THREE;
    if (!_fq) _fq = { p: new T3.Quaternion(), w: new T3.Quaternion(), e: new T3.Euler(), y: new T3.Vector3(0, 1, 0), x: new T3.Vector3(1, 0, 0), t: new T3.Quaternion() };
    const Q = _fq;
    // parent (the knee group) in the world: yaw * leg * knee
    Q.p.setFromAxisAngle(Q.y, yaw);
    Q.p.multiply(leg.quaternion).multiply(low.quaternion);
    // wanted: heading, then pitch about the foot's own lateral axis (+ toes down)
    Q.w.setFromAxisAngle(Q.y, fyaw);
    Q.t.setFromAxisAngle(Q.x, psi);
    Q.w.multiply(Q.t);
    foot.quaternion.copy(Q.p.invert().multiply(Q.w));
  }
  function touchdown(ch, G, g, F, i) {
    // the swing's own last target is the contact (no pop)
    F.sw = false; F.u = 0; F.idle = false;
    F.x = F.tx; F.z = F.tz; F.y = F.ty; F.yaw = F.tyaw;
  }
  // the foot pitch for ankleSolve: { psi (world, + toes down), w } or null
  const _fp = { psi: 0, w: 0 };
  function footPitch(ch, i) {
    const G = ch && ch._gv;
    if (!G || !(ch._gFootW > 0)) return null;
    const F = G.feet[i];
    _fp.psi = F.psi; _fp.w = ch._gFootW * F.psiW;
    return _fp;
  }
  // which feet are on the ground (tools, footstep sounds)
  function contacts(ch) {
    const G = ch && ch._gv;
    if (!G || !(ch._gFootW > 0)) return null;
    return G.feet;
  }
  // forget the feet (teleport, spawn): the next frame plants them under the body
  function reset(ch) { if (ch && ch._gv) { ch._gv.init = false; ch._gv.px = null; } }

  CBZ.gait = {
    mix, pre, phaseDelta, body, post, footPitch, contacts, reset, geo, legIK, ankleFrom,
    LEG_LIMITS, legInRange, TD, SIDE,
  };
})();
